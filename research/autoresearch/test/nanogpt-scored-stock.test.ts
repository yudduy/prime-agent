import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import { nanoGptScoredBenchmarkIds, nanoGptScoredBoundaryConditions } from "../src/nanogpt-scored-protocol.js";
import {
	acquireNanoGptScoredStockPidLock,
	assertNanoGptScoredStockRunAccepted,
	buildNanoGptStockRunManifest,
	buildNanoGptStockSubmitRequest,
	NANOGPT_STOCK_IDENTITY_PATCH_SHA256,
	NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE,
	NANOGPT_STOCK_MAX_SUBMISSIONS,
	NANOGPT_STOCK_MAX_TASK_EVALUATIONS,
	NANOGPT_STOCK_SCORED_BRANCH,
	NANOGPT_STOCK_SCORED_TREATMENT,
	parseNanoGptScoredStockArgs,
	selectNanoGptScoredStockAttempt,
	selectNanoGptStockParentJobIds,
} from "../src/nanogpt-scored-stock.js";
import type { JobStatus, JobView } from "../src/types.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUT_PARENT = join(REPOSITORY_ROOT, ".autoresearch", "nanogpt-scored");
const STOCK_PATCH_PATH = fileURLToPath(new URL("../fixtures/nanogpt/stock-identity.patch", import.meta.url));
const FAUX_PINS = {
	staticEvaluatorSha256: "1".repeat(64),
	environmentSha256: "2".repeat(64),
	environmentSealSha256: "3".repeat(64),
	datasetManifestSha256: "4".repeat(64),
	workerSha256: "5".repeat(64),
	transportSha256: "6".repeat(64),
} as const;

function job(
	mode: "smoke-10" | "score-1" | "score-3",
	thresholdPassed = "true",
	options: {
		readonly apparatusAttempt?: number;
		readonly status?: JobStatus;
		readonly statusAt?: string;
		readonly measurement?: boolean;
	} = {},
): JobView {
	const apparatusAttempt = options.apparatusAttempt ?? 0;
	const jobId = `job_${mode.replaceAll("-", "_")}_a${apparatusAttempt}`;
	const benchmarkIds = [...nanoGptScoredBenchmarkIds(mode)];
	return {
		proposal: {
			jobId,
			manifestDigest: sha256Text(`manifest:${mode}:${apparatusAttempt}`),
			branchId: NANOGPT_STOCK_SCORED_BRANCH,
			lane: "nanogpt",
			benchmarkIds,
			budgetClass: mode === "smoke-10" ? "smoke" : "screen",
			treatment: NANOGPT_STOCK_SCORED_TREATMENT,
			proposal: {
				hypothesis: "fixed",
				mechanism: "fixed",
				predictedOutcome: "fixed",
				boundaryConditions: [...nanoGptScoredBoundaryConditions(FAUX_PINS), `apparatusAttempt=${apparatusAttempt}`],
				parentJobIds: [],
			},
			candidate: { digest: NANOGPT_STOCK_IDENTITY_PATCH_SHA256, byteLength: 116, mediaType: "text/x-diff" },
			candidateFormat: "unified-diff",
			requireFreshMeasurement: true,
		},
		state: {
			jobId,
			status: options.status ?? "succeeded",
			statusAt: options.statusAt ?? "2026-08-30T07:30:00.000Z",
			externalJobId: `nanogpt-scored-v1:${"a".repeat(64)}`,
			reason: null,
		},
		measurement:
			options.measurement === false
				? null
				: {
						jobId,
						manifestDigest: sha256Text(`manifest:${mode}:${apparatusAttempt}`),
						verifierEpoch: `nanogpt-scored-v1-${"b".repeat(24)}`,
						measuredAt: "2026-08-30T07:31:00.000Z",
						tasks: benchmarkIds.map((benchmarkId) => ({
							benchmarkId,
							status: "accepted",
							metrics: {},
							verifier: { passed: true, checks: ["faux"], errors: [] },
							runtimeMs: 1,
						})),
						hardware: { slurmJobId: "1700000" },
						provenance: { mode, thresholdPassed },
						stdout: null,
						stderr: null,
					},
	};
}

describe("NanoGPT scored stock CLI", () => {
	it("parses one explicit safe command and rejects output paths outside the evidence root", () => {
		const outputDir = join(OUTPUT_PARENT, "stock-test-args");
		assert.deepEqual(
			parseNanoGptScoredStockArgs(["--output-dir", outputDir, "--mode", "smoke-10", "--submit-and-wait"]),
			{ outputDir, mode: "smoke-10", command: "submit-and-wait" },
		);
		assert.throws(
			() => parseNanoGptScoredStockArgs(["--output-dir", "/tmp/out", "--mode", "smoke-10", "--readiness"]),
			/must be a child/,
		);
		assert.throws(
			() =>
				parseNanoGptScoredStockArgs([
					"--output-dir",
					outputDir,
					"--mode",
					"smoke-10",
					"--readiness",
					"--reconcile",
				]),
			/Choose exactly one/,
		);
	});

	it("builds the exact stock proposal and enforces staged threshold lineage", async () => {
		const stockPatch = await readFile(STOCK_PATCH_PATH, "utf8");
		const smoke = buildNanoGptStockSubmitRequest("smoke-10", FAUX_PINS, stockPatch, []);
		assert.equal(sha256Text(smoke.candidate.content), NANOGPT_STOCK_IDENTITY_PATCH_SHA256);
		assert.deepEqual(smoke.proposal.parentJobIds, []);
		assert.equal(smoke.proposal.boundaryConditions.at(-1), "apparatusAttempt=0");
		assert.equal(smoke.requireFreshMeasurement, true);
		assert.deepEqual(selectNanoGptStockParentJobIds("score-1", [job("smoke-10")]), ["job_smoke_10_a0"]);
		assert.deepEqual(selectNanoGptStockParentJobIds("score-3", [job("score-1")]), ["job_score_1_a0"]);
		assert.throws(() => selectNanoGptStockParentJobIds("score-3", [job("score-1", "false")]), /did not pass/);

		const failed = job("smoke-10", "true", { apparatusAttempt: 0, status: "failed" });
		const acceptedRetry = job("smoke-10", "true", { apparatusAttempt: 1 });
		assert.deepEqual(selectNanoGptStockParentJobIds("score-1", [failed, acceptedRetry]), ["job_smoke_10_a1"]);
		const retry = buildNanoGptStockSubmitRequest("smoke-10", FAUX_PINS, stockPatch, [], 1);
		assert.equal(retry.proposal.boundaryConditions.at(-1), "apparatusAttempt=1");
		assert.notEqual(sha256Json(retry.proposal), sha256Json(smoke.proposal));
	});

	it("selects the current apparatus attempt and rejects non-accepted CLI outcomes", () => {
		const failed = job("smoke-10", "true", { apparatusAttempt: 0, status: "failed" });
		const active = job("smoke-10", "true", {
			apparatusAttempt: 1,
			status: "running",
			measurement: false,
		});
		assert.equal(
			selectNanoGptScoredStockAttempt("smoke-10", [failed, active])?.proposal.jobId,
			active.proposal.jobId,
		);
		assert.throws(() => assertNanoGptScoredStockRunAccepted("smoke-10", failed), /not scientifically accepted/);
		assert.throws(() => assertNanoGptScoredStockRunAccepted("smoke-10", active), /observed running/);
		const acceptedMiss = job("score-1", "false", { apparatusAttempt: 1 });
		assert.doesNotThrow(() => assertNanoGptScoredStockRunAccepted("score-1", acceptedMiss));
		assert.throws(
			() =>
				selectNanoGptScoredStockAttempt("smoke-10", [
					active,
					job("smoke-10", "true", { apparatusAttempt: 0, status: "running", measurement: false }),
				]),
			/parallel active apparatus attempt/,
		);
	});

	it("hash-binds the prospective amendment, pins, candidate, and allocation", async () => {
		const stockPatch = await readFile(STOCK_PATCH_PATH, "utf8");
		const manifest = buildNanoGptStockRunManifest({
			command: "submit-and-wait",
			mode: "smoke-10",
			pins: FAUX_PINS,
			stockPatch,
			apparatusAttempt: 0,
		});
		const { manifestDigest, ...body } = manifest;
		assert.equal(manifestDigest, sha256Json(body));
		assert.equal(
			manifest.campaignAmendmentSha256,
			"0aece581a2cc9e49672f598129a9f298353114368962a4fca0e09b0f7e9751ab",
		);
		assert.equal(manifest.candidatePatchSha256, NANOGPT_STOCK_IDENTITY_PATCH_SHA256);
		assert.equal(manifest.apparatusAttempt, 0);
		assert.equal(manifest.maxApparatusAttemptsPerMode, NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE);
		assert.equal(NANOGPT_STOCK_MAX_SUBMISSIONS, 8);
		assert.equal(NANOGPT_STOCK_MAX_TASK_EVALUATIONS, 26);
		assert.deepEqual(manifest.resources, {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			gpus: 1,
			worldSize: 1,
			cpus: 8,
			memory: "32G",
			wallTime: "00:30:00",
		});
	});

	it("excludes concurrent controllers and recovers only a dead-owner lock", async () => {
		await mkdir(OUTPUT_PARENT, { recursive: true });
		const outputDir = await mkdtemp(join(OUTPUT_PARENT, "stock-lock-test-"));
		try {
			const held = await acquireNanoGptScoredStockPidLock(outputDir);
			await assert.rejects(acquireNanoGptScoredStockPidLock(outputDir), /locked by active process/);
			await held.release();
			await writeFile(
				join(outputDir, ".controller.lock"),
				`${JSON.stringify({ schemaVersion: 1, pid: Number.MAX_SAFE_INTEGER, token: "stale" })}\n`,
				{ encoding: "utf8", mode: 0o600 },
			);
			const recovered = await acquireNanoGptScoredStockPidLock(outputDir);
			await recovered.release();
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});
});

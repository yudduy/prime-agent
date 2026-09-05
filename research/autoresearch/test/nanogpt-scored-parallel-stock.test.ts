import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import {
	type NanoGptScoredParallelMode,
	type NanoGptScoredParallelPins,
	nanoGptScoredParallelBenchmarkIds,
	nanoGptScoredParallelBoundaryConditions,
	nanoGptScoredParallelVerifierEpoch,
} from "../src/nanogpt-scored-parallel-protocol.js";
import {
	buildNanoGptScoredParallelStockRunManifest,
	buildNanoGptScoredParallelStockSubmitRequest,
	NANOGPT_STOCK_PARALLEL_BRANCH,
	NANOGPT_STOCK_PARALLEL_MAX_APPARATUS_ATTEMPTS_PER_MODE,
	NANOGPT_STOCK_PARALLEL_MAX_SUBMISSIONS,
	NANOGPT_STOCK_PARALLEL_MAX_TASK_EVALUATIONS,
	NANOGPT_STOCK_PARALLEL_TREATMENT,
	parseNanoGptScoredParallelStockArgs,
	selectNanoGptScoredParallelParentJobIds,
	selectNanoGptScoredParallelStockAttempt,
} from "../src/nanogpt-scored-parallel-stock.js";
import { NANOGPT_STOCK_IDENTITY_PATCH_SHA256 } from "../src/nanogpt-scored-stock.js";
import type { JobStatus, JobView } from "../src/types.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUT_PARENT = join(REPOSITORY_ROOT, ".autoresearch", "nanogpt-scored");
const STOCK_PATCH_PATH = fileURLToPath(new URL("../fixtures/nanogpt/stock-identity.patch", import.meta.url));
const PINS: NanoGptScoredParallelPins = {
	staticEvaluatorSha256: "1".repeat(64),
	environmentSha256: "2".repeat(64),
	environmentSealSha256: "3".repeat(64),
	datasetManifestSha256: "4".repeat(64),
	parallelWorkerSha256: "5".repeat(64),
	baseWorkerSha256: "6".repeat(64),
	parallelTransportSha256: "7".repeat(64),
	hostAggregationSha256: "8".repeat(64),
};

function job(
	mode: NanoGptScoredParallelMode,
	options: {
		readonly attempt?: number;
		readonly status?: JobStatus;
		readonly thresholdPassed?: "true" | "false" | "null";
		readonly measured?: boolean;
		readonly verifierEpoch?: string;
	} = {},
): JobView {
	const attempt = options.attempt ?? 0;
	const jobId = `parallel_${mode.replaceAll("-", "_")}_a${attempt}`;
	const manifestDigest = sha256Text(`parallel-manifest:${mode}:${attempt}`);
	const benchmarkIds = [...nanoGptScoredParallelBenchmarkIds(mode)];
	const measured = options.measured ?? true;
	return {
		proposal: {
			jobId,
			manifestDigest,
			branchId: NANOGPT_STOCK_PARALLEL_BRANCH,
			lane: "nanogpt",
			benchmarkIds,
			budgetClass: mode === "smoke-10" ? "smoke" : mode === "score-3" ? "screen" : "confirm",
			treatment: NANOGPT_STOCK_PARALLEL_TREATMENT,
			proposal: {
				hypothesis: "fixed",
				mechanism: "fixed",
				predictedOutcome: "fixed",
				boundaryConditions: [...nanoGptScoredParallelBoundaryConditions(PINS), `apparatusAttempt=${attempt}`],
				parentJobIds: [],
			},
			candidate: {
				digest: NANOGPT_STOCK_IDENTITY_PATCH_SHA256,
				byteLength: 116,
				mediaType: "text/x-diff",
			},
			candidateFormat: "unified-diff",
			requireFreshMeasurement: true,
		},
		state: {
			jobId,
			status: options.status ?? "succeeded",
			statusAt: "2026-08-30T09:30:00.000Z",
			externalJobId: `nanogpt-scored-parallel-v2:${"a".repeat(64)}`,
			reason: null,
		},
		measurement: !measured
			? null
			: {
					jobId,
					manifestDigest,
					verifierEpoch: options.verifierEpoch ?? nanoGptScoredParallelVerifierEpoch(PINS),
					measuredAt: "2026-08-30T09:31:00.000Z",
					tasks: benchmarkIds.map((benchmarkId) => ({
						benchmarkId,
						status: "accepted",
						metrics: {},
						verifier: { passed: true, checks: ["parallel-v2"], errors: [] },
						runtimeMs: 1,
					})),
					hardware: { maxConcurrentChildren: "4" },
					provenance: {
						mode,
						thresholdPassed: options.thresholdPassed ?? (mode === "smoke-10" ? "null" : "true"),
					},
					stdout: null,
					stderr: null,
				},
	};
}

describe("NanoGPT scored parallel stock CLI", () => {
	it("isolates the v2 evidence namespace and exposes only v2 modes", () => {
		const outputDir = join(OUTPUT_PARENT, "parallel-v2-test");
		const v1OutputDir = join(OUTPUT_PARENT, "stock-v1");
		assert.deepEqual(
			parseNanoGptScoredParallelStockArgs([
				"--output-dir",
				outputDir,
				"--v1-output-dir",
				v1OutputDir,
				"--mode",
				"score-3",
				"--submit-and-wait",
			]),
			{ outputDir, v1OutputDir, mode: "score-3", command: "submit-and-wait" },
		);
		assert.throws(
			() =>
				parseNanoGptScoredParallelStockArgs([
					"--output-dir",
					v1OutputDir,
					"--v1-output-dir",
					v1OutputDir,
					"--mode",
					"score-3",
					"--readiness",
				]),
			/isolated/,
		);
		assert.throws(
			() => parseNanoGptScoredParallelStockArgs(["--output-dir", outputDir, "--mode", "score-1", "--readiness"]),
			/Unsupported --mode/,
		);
	});

	it("builds fresh exact-set proposals and keeps v1 out of controller parentage", async () => {
		const stockPatch = await readFile(STOCK_PATCH_PATH, "utf8");
		const smoke = buildNanoGptScoredParallelStockSubmitRequest("smoke-10", PINS, stockPatch, []);
		assert.equal(sha256Text(smoke.candidate.content), NANOGPT_STOCK_IDENTITY_PATCH_SHA256);
		assert.equal(smoke.requireFreshMeasurement, true);
		assert.deepEqual(smoke.proposal.parentJobIds, []);
		assert.deepEqual(smoke.benchmarkIds, nanoGptScoredParallelBenchmarkIds("smoke-10"));

		const score3Parents = selectNanoGptScoredParallelParentJobIds("score-3", [job("smoke-10")], PINS);
		assert.deepEqual(score3Parents, ["parallel_smoke_10_a0"]);
		const score3 = buildNanoGptScoredParallelStockSubmitRequest("score-3", PINS, stockPatch, score3Parents);
		assert.equal(score3.benchmarkIds.length, 3);
		assert.match(score3.proposal.mechanism, /fresh independent one-L40S\/world-size-one\/no-requeue/);
		assert.deepEqual(selectNanoGptScoredParallelParentJobIds("replay-8", [job("score-3")], PINS), [
			"parallel_score_3_a0",
		]);
		assert.throws(
			() =>
				selectNanoGptScoredParallelParentJobIds("replay-8", [job("score-3", { thresholdPassed: "false" })], PINS),
			/missed the threshold/,
		);
	});

	it("selects one epoch-bound whole-stage apparatus attempt", () => {
		const failed = job("score-3", { attempt: 0, status: "failed", measured: false });
		const active = job("score-3", { attempt: 1, status: "running", measured: false });
		assert.equal(
			selectNanoGptScoredParallelStockAttempt("score-3", [failed, active], PINS)?.proposal.jobId,
			active.proposal.jobId,
		);
		const stale = job("score-3", { verifierEpoch: `nanogpt-scored-parallel-v2-${"f".repeat(24)}` });
		assert.equal(selectNanoGptScoredParallelStockAttempt("score-3", [stale], PINS), null);
		assert.throws(
			() => selectNanoGptScoredParallelStockAttempt("score-3", [active, job("score-3", { attempt: 1 })], PINS),
			/duplicate apparatus attempts/,
		);
		assert.equal(NANOGPT_STOCK_PARALLEL_MAX_APPARATUS_ATTEMPTS_PER_MODE, 2);
		assert.equal(NANOGPT_STOCK_PARALLEL_MAX_SUBMISSIONS, 6);
		assert.equal(NANOGPT_STOCK_PARALLEL_MAX_TASK_EVALUATIONS, 24);
	});

	it("hash-binds four-way scheduling, separate accounting, and the Boolean-only v1 gate", async () => {
		const stockPatch = await readFile(STOCK_PATCH_PATH, "utf8");
		const v1OutputDir = join(OUTPUT_PARENT, "stock-v1");
		const manifest = buildNanoGptScoredParallelStockRunManifest({
			command: "submit-and-wait",
			mode: "replay-8",
			pins: PINS,
			stockPatch,
			apparatusAttempt: 0,
			v1OutputDir,
		});
		const { manifestDigest, ...body } = manifest;
		assert.equal(manifestDigest, sha256Json(body));
		assert.equal(manifest.verifierEpoch, nanoGptScoredParallelVerifierEpoch(PINS));
		assert.deepEqual(manifest.v1Gate, {
			outputDir: v1OutputDir,
			branchId: "nanogpt-stock-scored-v1",
			treatment: "stock-anchor",
			mode: "score-1",
			numericMeasurementsReused: false,
		});
		assert.deepEqual(manifest.resources, {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			children: 8,
			maxConcurrentChildren: 4,
			gpusPerChild: 1,
			worldSizePerChild: 1,
			cpusPerChild: 8,
			memoryPerChild: "32G",
			wallTimePerChild: "06:00:00",
			noRequeue: true,
		});
		assert.deepEqual(manifest.accounting, [
			"wallClockMs",
			"queueWaitMsSum",
			"childRuntimeMsSum",
			"gpuMilliseconds",
			"gpuHours",
			"requested",
			"allocated",
		]);
	});
});

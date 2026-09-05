import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import {
	NANOGPT_BASELINE_SHA256,
	NANOGPT_CONTRACT_ID,
	NANOGPT_PROGRAM_SHA256,
	NANOGPT_SPEEDRUN_COMMIT,
} from "../src/nanogpt-contract.js";
import {
	buildNanoGptScoredParallelChildRequest,
	buildNanoGptScoredParallelStageRequest,
	type NanoGptScoredParallelMode,
	type NanoGptScoredParallelPins,
	type NanoGptScoredParallelStageRequest,
	type NanoGptScoredV1ScoreOneBridge,
	nanoGptScoredParallelBenchmarkIds,
	nanoGptScoredParallelExternalHandle,
	nanoGptScoredParallelStageIdentity,
	nanoGptScoredParallelVerifierEpoch,
} from "../src/nanogpt-scored-parallel-protocol.js";
import {
	DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
	loadNanoGptScoredParallelPins,
	NANOGPT_SCORED_PARALLEL_PREPARE_REMOTE,
	NANOGPT_SCORED_PARALLEL_REMOTE_ROOT,
	type NanoGptScoredParallelTransportConfig,
	SshNanoGptScoredParallelTransport,
} from "../src/nanogpt-scored-parallel-transport.js";
import { NANOGPT_SCORED_DATASET_ROOT, NANOGPT_SCORED_ENVIRONMENT_DIR } from "../src/nanogpt-scored-transport.js";

const CANDIDATE_PATCH = "--- a/train_gpt_simple.py\n+++ b/train_gpt_simple.py\n@@ -1 +1 @@\n-old\n+new\n";
const CANDIDATE_SHA256 = sha256Text("parallel-candidate-source");
const ENVIRONMENT_MANIFEST =
	'{"environmentSpecSha256": "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b", "kernelBenchVerifiedCommit": "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e", "numpy": "2.5.2", "pip": "25.2", "python": "3.12.3", "schemaVersion": 1, "torch": "2.11.0+cu128", "torchCuda": "12.8"}\n';
const ENVIRONMENT_SEAL =
	'{"environmentManifestSha256": "71ddfe105be64b7122d7b6d143ea1a6c26a5b9de30cc414a9cbd9df7cd314de8", "environmentSpecSha256": "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b", "pipFreezeSha256": "b85ceb87080994284c997e0ea3742246df1a12d4fc2551a9d8412d87160766d9", "schemaVersion": 1}\n';
const ENVIRONMENT_RUNTIME = {
	python: "3.12.3",
	pip: "25.2",
	torch: "2.11.0+cu128",
	torchCuda: "12.8",
	numpy: "2.5.2",
};
const ENVIRONMENT_EXECUTABLES = {
	python: {
		path: `${NANOGPT_SCORED_ENVIRONMENT_DIR}/bin/python`,
		linkTarget: "python3",
		python3LinkTarget: "/usr/bin/python3",
		resolvedPath: "/usr/bin/python3.12",
		sha256: "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118",
		size: 8_020_928,
	},
	torchrun: {
		path: `${NANOGPT_SCORED_ENVIRONMENT_DIR}/bin/torchrun`,
		sha256: "7ff57f7f5ee11cc74839fda7b12e2a97fd2808dd00ae1eafd05f302df5def748",
		size: 367,
		mode: 0o555,
	},
};

let temporaryRoot = "";
let pins: NanoGptScoredParallelPins;
let datasetManifest = "";

function config(evidence: string): NanoGptScoredParallelTransportConfig {
	return {
		...DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
		localEvidenceDir: evidence,
		pollIntervalMs: 1,
		commandTimeoutMs: 1_000,
		readinessTimeoutMs: 1_000,
		dispatchVisibilityGraceMs: 1,
		resultVisibilityGraceMs: 1,
		reconcileTimeoutMs: null,
	};
}

function bridge(): NanoGptScoredV1ScoreOneBridge {
	return {
		contract: "nanogpt-track3-scored-confirmatory-v1",
		mode: "score-1",
		verifierEpoch: `nanogpt-scored-v1-${"1".repeat(24)}`,
		stageIdentity: "2".repeat(64),
		requestDigest: "3".repeat(64),
		resultDigest: "4".repeat(64),
		receiptDigest: "5".repeat(64),
		candidateSha256: CANDIDATE_SHA256,
		trainSteps: 3_289,
		meanValidationLossExclusiveUpperBound: 3.27859,
		accepted: true,
		thresholdPassed: true,
		numericMeasurementsReused: false,
	};
}

function stage(mode: NanoGptScoredParallelMode): NanoGptScoredParallelStageRequest {
	const candidatePatch = {
		digest: sha256Text(CANDIDATE_PATCH),
		byteLength: Buffer.byteLength(CANDIDATE_PATCH),
		mediaType: "text/x-diff",
	};
	const staticEvidence = {
		contract: NANOGPT_CONTRACT_ID,
		repositoryCommit: NANOGPT_SPEEDRUN_COMMIT,
		programSha256: NANOGPT_PROGRAM_SHA256,
		evaluatorSha256: pins.staticEvaluatorSha256,
		baselineSha256: NANOGPT_BASELINE_SHA256,
		patchSha256: candidatePatch.digest,
		candidateSha256: CANDIDATE_SHA256,
		trainSteps: 3_289,
		frozenSegmentSha256: [0, 1, 2, 3].map((index) => sha256Text(`frozen-${index}`)),
		editableSegmentSha256: [0, 1, 2].map((index) => sha256Text(`editable-${index}`)),
	};
	const stageIdentity = nanoGptScoredParallelStageIdentity({
		branchId: "parallel-transport-test",
		treatment: "stock",
		verifierEpoch: nanoGptScoredParallelVerifierEpoch(pins),
		candidatePatchSha256: candidatePatch.digest,
		candidateSha256: CANDIDATE_SHA256,
	});
	const v1Bridge = mode === "smoke-10" ? null : bridge();
	return buildNanoGptScoredParallelStageRequest({
		stageIdentity,
		mode,
		jobId: `job_${mode.replaceAll("-", "_")}`,
		manifestDigest: sha256Text(`manifest-${mode}`),
		branchId: "parallel-transport-test",
		treatment: "stock",
		candidatePatch,
		staticEvidence,
		benchmarkIds: nanoGptScoredParallelBenchmarkIds(mode),
		v1Bridge,
		priorStage:
			mode === "smoke-10"
				? null
				: {
						mode: mode === "score-3" ? "smoke-10" : "score-3",
						stageIdentity,
						requestDigest: "6".repeat(64),
						resultDigest: "7".repeat(64),
						receiptDigest: "8".repeat(64),
						accepted: true,
						thresholdPassed: mode === "score-3" ? null : true,
						fullExactSet: true,
						numericMeasurementsReused: false,
						v1BridgeDigest: mode === "score-3" ? null : sha256Json(v1Bridge),
					},
		pins,
	});
}

function ok(stdout: string): CompilerGymWarmCommandResult {
	return { exitCode: 0, stdout, stderr: "", wallMs: 1 };
}

class FauxFarmShare implements CompilerGymWarmCommandRunner {
	readonly stage: NanoGptScoredParallelStageRequest;
	readonly requests: CompilerGymWarmCommandRequest[] = [];
	readonly childRequests = new Map<string, Record<string, unknown>>();
	readonly logs = new Map<string, Buffer>();
	readonly submitted = new Set<string>();
	preparedAssets: string[][] = [];
	sbatchCount = 0;
	activePolls = 0;
	maxActivePolls = 0;
	ambiguous = false;

	constructor(stageRequest: NanoGptScoredParallelStageRequest) {
		this.stage = stageRequest;
	}

	private source(command: CompilerGymWarmCommandRequest): string {
		const remote = command.argv.at(-1) ?? "";
		for (const match of remote.matchAll(/'([A-Za-z0-9+/=]{100,})'/g)) {
			const decoded = Buffer.from(match[1], "base64").toString("utf8");
			if (decoded.includes("import ") || decoded.includes("from ")) return decoded;
		}
		return "";
	}

	private digest(command: CompilerGymWarmCommandRequest): string {
		const remote = command.argv.at(-1) ?? "";
		const child = this.stage.children
			.map((_, index) => buildChildDigest(this.stage, index))
			.find((digest) => remote.includes(digest));
		if (!child) throw new Error(`Could not identify child digest in ${remote.slice(-300)}`);
		return child;
	}

	async run(command: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		this.requests.push(command);
		const source = this.source(command);
		if (source.includes("sealed scored environment is missing")) {
			const files = (JSON.parse(datasetManifest) as { files: readonly unknown[] }).files;
			return ok(
				JSON.stringify({
					schemaVersion: 1,
					environmentDirectory: NANOGPT_SCORED_ENVIRONMENT_DIR,
					environmentManifest: ENVIRONMENT_MANIFEST,
					environmentManifestSha256: pins.environmentSha256,
					environmentSeal: ENVIRONMENT_SEAL,
					environmentSealSha256: pins.environmentSealSha256,
					runtime: ENVIRONMENT_RUNTIME,
					executables: ENVIRONMENT_EXECUTABLES,
					datasetDirectory: NANOGPT_SCORED_DATASET_ROOT,
					datasetManifest,
					datasetManifestSha256: pins.datasetManifestSha256,
					dataFiles: files,
				}),
			);
		}
		const digest = this.digest(command);
		if (source.includes("prepared NanoGPT parallel asset set changed")) {
			const payload = JSON.parse(command.input ?? "null") as {
				files: readonly { path: string; content: string }[];
			};
			this.preparedAssets.push(payload.files.map((file) => file.path).sort());
			const childFile = payload.files.find((file) => file.path === "child-request.json");
			if (!childFile) throw new Error("Missing child request fixture");
			this.childRequests.set(digest, JSON.parse(Buffer.from(childFile.content, "base64").toString("utf8")));
			return ok(
				JSON.stringify({
					prepared: `${NANOGPT_SCORED_PARALLEL_REMOTE_ROOT}/jobs/${digest}`,
					childRequestDigest: digest,
				}),
			);
		}
		if (source.includes("dispatch-intent.json")) {
			if (this.ambiguous)
				return ok(JSON.stringify({ kind: "ambiguous", reason: "refusing automatic resubmission" }));
			if (!this.submitted.has(digest)) {
				this.submitted.add(digest);
				this.sbatchCount++;
			}
			return ok(
				JSON.stringify({ kind: "submitted", slurmJobId: String(1_800_000 + childIndex(this.stage, digest)) }),
			);
		}
		if (source.includes("terminal-result-visibility-grace")) {
			this.activePolls++;
			this.maxActivePolls = Math.max(this.maxActivePolls, this.activePolls);
			await delay(5);
			this.activePolls--;
			const index = childIndex(this.stage, digest);
			const child = this.childRequests.get(digest);
			if (!child) throw new Error("Missing prepared child request");
			const spec = child.childSpec as Record<string, unknown>;
			const log = Buffer.from(`child ${index} seed ${String(spec.seed)}\n`, "utf8");
			const logSha256 = sha256Text(log.toString("utf8"));
			this.logs.set(digest, log);
			const slurmJobId = String(1_800_000 + index);
			const workerResult = {
				schemaVersion: 1,
				contract: this.stage.contract,
				ok: true,
				verifierEpoch: this.stage.verifierEpoch,
				stageIdentity: this.stage.stageIdentity,
				stageRequestDigest: this.stage.requestDigest,
				childRequestDigest: digest,
				childSpecDigest: child.childSpecDigest,
				mode: this.stage.mode,
				index,
				seed: spec.seed,
				candidateSha256: CANDIDATE_SHA256,
				effectiveTrainSteps: this.stage.effectiveTrainSteps,
				validationLossDecimal: `3.20000000${index}`,
				validationLossNanounits: 3_200_000_000 + index,
				optimizerSteps: this.stage.effectiveTrainSteps,
				peakVramMb: 30_000 + index,
				runtimeMs: 1_000,
				startedAt: "2026-08-30T09:00:00.000Z",
				finishedAt: "2026-08-30T09:00:01.000Z",
				observed: {
					slurmJobId,
					hardware: {
						cluster: "Stanford FarmShare",
						gpu: "NVIDIA L40S",
						gpuUuid: `GPU-faux-${index}`,
						gpus: 1,
						worldSize: 1,
					},
					log: {
						remoteName: `trial-${String(index).padStart(3, "0")}.log`,
						byteLength: log.byteLength,
						sha256: logSha256,
					},
				},
				execution: { cleanJobDirectory: true, freshCandidateMaterialization: true, priorMeasurementsReused: false },
				sourceIntegrity: { preRunCandidateSha256: CANDIDATE_SHA256, postRunCandidateSha256: CANDIDATE_SHA256 },
				pins,
				failure: null,
			};
			const raw = Buffer.from(JSON.stringify(workerResult), "utf8");
			return ok(
				JSON.stringify({
					kind: "result",
					resultBase64: raw.toString("base64"),
					resultByteLength: raw.byteLength,
					resultSha256: sha256Text(raw.toString("utf8")),
					log: workerResult.observed.log,
					scheduler: {
						raw: {
							jobIdRaw: slurmJobId,
							jobName: `pngp-${digest.slice(0, 24)}`,
							workDir: `${NANOGPT_SCORED_PARALLEL_REMOTE_ROOT}/jobs/${digest}`,
							state: "COMPLETED",
							exitCode: "0:0",
							submit: "2026-08-30T01:59:59",
							start: "2026-08-30T02:00:00",
							end: "2026-08-30T02:00:01",
							elapsedRaw: "1",
							allocTres: "cpu=10,gres/gpu=1,mem=32G",
							reqTres: "cpu=8,gres/gpu=1,mem=32G",
						},
						normalized: {
							state: "COMPLETED",
							exitCode: "0:0",
							submitAt: "2026-08-30T08:59:59.000Z",
							startAt: "2026-08-30T09:00:00.000Z",
							endAt: "2026-08-30T09:00:01.000Z",
							elapsedSeconds: 1,
							queueWaitMs: 1_000,
							runtimeMs: 1_000,
							requested: { cpus: 8, gpus: 1, memoryMiB: 32_768 },
							allocated: { cpus: 10, gpus: 1, memoryMiB: 32_768 },
						},
					},
				}),
			);
		}
		if (source.includes("unsafe NanoGPT scored trial log name")) {
			const bytes = this.logs.get(digest);
			if (!bytes) throw new Error("Missing child log fixture");
			return ok(
				JSON.stringify({
					name: `trial-${String(childIndex(this.stage, digest)).padStart(3, "0")}.log`,
					byteLength: bytes.byteLength,
					sha256: sha256Text(bytes.toString("utf8")),
					contentBase64: bytes.toString("base64"),
				}),
			);
		}
		throw new Error(`Unexpected faux command: ${source.slice(0, 120)}`);
	}
}

function buildChildDigest(stageRequest: NanoGptScoredParallelStageRequest, index: number): string {
	return buildNanoGptScoredParallelChildRequest(stageRequest, index).childRequestDigest;
}

function childIndex(stageRequest: NanoGptScoredParallelStageRequest, digest: string): number {
	const index = stageRequest.children.findIndex(
		(_, candidate) => buildChildDigest(stageRequest, candidate) === digest,
	);
	if (index < 0) throw new Error("Unknown child digest");
	return index;
}

before(async () => {
	temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "nanogpt-parallel-transport-")));
	datasetManifest = await readFile(DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG.localDatasetManifestPath, "utf8");
	pins = await loadNanoGptScoredParallelPins(config(join(temporaryRoot, "pins")));
});

after(async () => {
	await rm(temporaryRoot, { recursive: true, force: true });
});

describe("NanoGPT scored parallel transport", () => {
	it("dispatches exact score-3 children concurrently, archives every log, and resumes without redispatch", async () => {
		const request = stage("score-3");
		const runner = new FauxFarmShare(request);
		const transport = new SshNanoGptScoredParallelTransport(config(join(temporaryRoot, "score3")), {
			commandRunner: runner,
		});
		const first = await transport.execute(request, CANDIDATE_PATCH, new AbortController().signal);
		assert.equal(first.children.length, 3);
		assert.equal(runner.sbatchCount, 3);
		assert.equal(runner.maxActivePolls, 3);
		assert.deepEqual(
			first.children.map((child) => child.workerResult.index),
			[0, 1, 2],
		);
		assert.ok(first.children.every((child) => child.scheduler.normalized.allocated.cpus === 10));
		assert.ok(
			first.children.every((child) => child.archive.manifestSha256 === sha256Text(child.archive.canonicalManifest)),
		);
		assert.ok(
			runner.preparedAssets.every((paths) => paths.includes("base-worker.py") && paths.includes("worker.py")),
		);
		assert.match(NANOGPT_SCORED_PARALLEL_PREPARE_REMOTE, /os\.fsync/);
		const resumed = await transport.resume(
			request,
			CANDIDATE_PATCH,
			nanoGptScoredParallelExternalHandle(request.requestDigest),
			new AbortController().signal,
		);
		assert.deepEqual(resumed, first);
		assert.equal(runner.sbatchCount, 3);
	});

	it("fails closed on an ambiguous pre-sbatch intent without producing a partial completion", async () => {
		const request = stage("score-3");
		const runner = new FauxFarmShare(request);
		runner.ambiguous = true;
		const transport = new SshNanoGptScoredParallelTransport(config(join(temporaryRoot, "ambiguous")), {
			commandRunner: runner,
		});
		await assert.rejects(
			transport.execute(request, CANDIDATE_PATCH, new AbortController().signal),
			/AggregateError|refusing automatic resubmission/,
		);
		assert.equal(runner.sbatchCount, 0);
	});
});

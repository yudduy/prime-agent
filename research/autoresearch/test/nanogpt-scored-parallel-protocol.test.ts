import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	buildNanoGptScoredParallelChildCompletion,
	buildNanoGptScoredParallelChildRequest,
	buildNanoGptScoredParallelStageReceipt,
	buildNanoGptScoredParallelStageRequest,
	buildNanoGptScoredParallelStageResult,
	NANOGPT_SCORED_LOSS_NANOUNITS_PER_UNIT,
	NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
	NANOGPT_SCORED_THRESHOLD_NANOUNITS,
	type NanoGptScoredParallelChildCompletion,
	type NanoGptScoredParallelChildRequest,
	type NanoGptScoredParallelMode,
	type NanoGptScoredParallelPins,
	type NanoGptScoredParallelPriorStage,
	type NanoGptScoredParallelStageRequest,
	type NanoGptScoredV1ScoreOneBridge,
	nanoGptScoredParallelBenchmarkIds,
	nanoGptScoredParallelStageIdentity,
	nanoGptScoredParallelVerifierEpoch,
	parseNanoGptScoredParallelChildCompletion,
	parseNanoGptScoredParallelChildWorkerResult,
	parseNanoGptScoredParallelStageReceipt,
	parseNanoGptScoredParallelStageResult,
	verifyNanoGptScoredParallelChildRequest,
	verifyNanoGptScoredParallelStageRequest,
} from "../src/nanogpt-scored-parallel-protocol.js";
import type { NanoGptScoredStaticEvidence } from "../src/nanogpt-scored-protocol.js";

const PINS: NanoGptScoredParallelPins = {
	staticEvaluatorSha256: sha256Text("parallel-static-evaluator"),
	environmentSha256: sha256Text("parallel-environment"),
	environmentSealSha256: sha256Text("parallel-environment-seal"),
	datasetManifestSha256: sha256Text("parallel-dataset"),
	parallelWorkerSha256: sha256Text("parallel-worker"),
	baseWorkerSha256: sha256Text("immutable-v1-worker"),
	parallelTransportSha256: sha256Text("parallel-transport"),
	hostAggregationSha256: sha256Text("host-aggregation"),
};
const PATCH = "--- a/train_gpt_simple.py\n+++ b/train_gpt_simple.py\n@@ -1 +1 @@\n-old\n+new\n";
const CANDIDATE_SHA256 = sha256Text("parallel-candidate-source");

function staticEvidence(): NanoGptScoredStaticEvidence {
	return {
		contract: "nanogpt-track3-static-contract-v1",
		repositoryCommit: "38e258afefb1ce206dd7595aa71d7740da405742",
		programSha256: "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08",
		evaluatorSha256: PINS.staticEvaluatorSha256,
		baselineSha256: "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e",
		patchSha256: sha256Text(PATCH),
		candidateSha256: CANDIDATE_SHA256,
		trainSteps: 3_200,
		frozenSegmentSha256: [0, 1, 2, 3].map((index) => sha256Text(`parallel-frozen-${index}`)),
		editableSegmentSha256: [0, 1, 2].map((index) => sha256Text(`parallel-editable-${index}`)),
	};
}

function v1Bridge(): NanoGptScoredV1ScoreOneBridge {
	return {
		contract: "nanogpt-track3-scored-confirmatory-v1",
		mode: "score-1",
		verifierEpoch: `nanogpt-scored-v1-${"1".repeat(24)}`,
		stageIdentity: sha256Text("v1-stage"),
		requestDigest: sha256Text("v1-request"),
		resultDigest: sha256Text("v1-result"),
		receiptDigest: sha256Text("v1-receipt"),
		candidateSha256: CANDIDATE_SHA256,
		trainSteps: 3_200,
		meanValidationLossExclusiveUpperBound: 3.27859,
		accepted: true,
		thresholdPassed: true,
		numericMeasurementsReused: false,
	};
}

function stageRequests(): {
	readonly smoke: NanoGptScoredParallelStageRequest;
	readonly score3: NanoGptScoredParallelStageRequest;
	readonly replay8: NanoGptScoredParallelStageRequest;
} {
	const evidence = staticEvidence();
	const stageIdentity = nanoGptScoredParallelStageIdentity({
		branchId: "parallel-protocol",
		treatment: "candidate-a",
		verifierEpoch: nanoGptScoredParallelVerifierEpoch(PINS),
		candidatePatchSha256: evidence.patchSha256,
		candidateSha256: evidence.candidateSha256,
	});
	const build = (
		mode: NanoGptScoredParallelMode,
		bridge: NanoGptScoredV1ScoreOneBridge | null,
		priorStage: NanoGptScoredParallelPriorStage | null,
	): NanoGptScoredParallelStageRequest =>
		buildNanoGptScoredParallelStageRequest({
			stageIdentity,
			mode,
			jobId: `parallel-${mode}`,
			manifestDigest: sha256Text(`parallel-manifest-${mode}`),
			branchId: "parallel-protocol",
			treatment: "candidate-a",
			candidatePatch: {
				digest: sha256Text(PATCH),
				byteLength: Buffer.byteLength(PATCH),
				mediaType: "text/x-diff",
			},
			staticEvidence: evidence,
			benchmarkIds: nanoGptScoredParallelBenchmarkIds(mode),
			v1Bridge: bridge,
			priorStage,
			pins: PINS,
		});
	const smoke = build("smoke-10", null, null);
	const bridge = v1Bridge();
	const score3 = build("score-3", bridge, {
		mode: "smoke-10",
		stageIdentity,
		requestDigest: smoke.requestDigest,
		resultDigest: sha256Text("smoke-result"),
		receiptDigest: sha256Text("smoke-receipt"),
		accepted: true,
		thresholdPassed: null,
		fullExactSet: true,
		numericMeasurementsReused: false,
		v1BridgeDigest: null,
	});
	const replay8 = build("replay-8", bridge, {
		mode: "score-3",
		stageIdentity,
		requestDigest: score3.requestDigest,
		resultDigest: sha256Text("score3-result"),
		receiptDigest: sha256Text("score3-receipt"),
		accepted: true,
		thresholdPassed: true,
		fullExactSet: true,
		numericMeasurementsReused: false,
		v1BridgeDigest: sha256Json(bridge),
	});
	return { smoke, score3, replay8 };
}

function lossDecimal(nanounits: number): string {
	const whole = Math.floor(nanounits / NANOGPT_SCORED_LOSS_NANOUNITS_PER_UNIT);
	const fraction = nanounits % NANOGPT_SCORED_LOSS_NANOUNITS_PER_UNIT;
	return `${whole}.${String(fraction).padStart(9, "0")}`;
}

function childCompletion(
	stage: NanoGptScoredParallelStageRequest,
	index: number,
	lossNanounits = 3_200_000_000,
	allOverlap = false,
): NanoGptScoredParallelChildCompletion {
	const child = buildNanoGptScoredParallelChildRequest(stage, index);
	const base = Date.parse("2026-08-30T09:00:00.000Z");
	const wave = allOverlap || stage.mode !== "replay-8" ? 0 : Math.floor(index / 4);
	const submit = base;
	const start = base + 10_000 + wave * 25_000;
	const end = start + 20_000;
	const remoteName = `child-${String(index).padStart(3, "0")}.log`;
	const logSha256 = sha256Text(`${stage.requestDigest}:${index}:log`);
	const workerResult = {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		ok: true,
		verifierEpoch: stage.verifierEpoch,
		stageIdentity: stage.stageIdentity,
		stageRequestDigest: stage.requestDigest,
		childRequestDigest: child.childRequestDigest,
		childSpecDigest: child.childSpecDigest,
		mode: stage.mode,
		index,
		seed: stage.seeds[index],
		candidateSha256: CANDIDATE_SHA256,
		effectiveTrainSteps: stage.effectiveTrainSteps,
		validationLossDecimal: lossDecimal(lossNanounits),
		validationLossNanounits: lossNanounits,
		optimizerSteps: stage.effectiveTrainSteps,
		peakVramMb: 30_000 + index,
		runtimeMs: 18_000,
		startedAt: new Date(start + 1_000).toISOString(),
		finishedAt: new Date(end - 1_000).toISOString(),
		observed: {
			slurmJobId: String(1_800_000 + index),
			hardware: {
				cluster: "Stanford FarmShare",
				gpu: "NVIDIA L40S",
				gpuUuid: `GPU-parallel-${index % 4}`,
				gpus: 1,
				worldSize: 1,
			},
			log: { remoteName, byteLength: 1_000 + index, sha256: logSha256 },
		},
		execution: {
			cleanJobDirectory: true,
			freshCandidateMaterialization: true,
			priorMeasurementsReused: false,
		},
		sourceIntegrity: {
			preRunCandidateSha256: CANDIDATE_SHA256,
			postRunCandidateSha256: CANDIDATE_SHA256,
		},
		pins: PINS,
		failure: null,
	} as const;
	const scheduler = {
		raw: {
			jobIdRaw: workerResult.observed.slurmJobId,
			jobName: `pngp-${child.childRequestDigest.slice(0, 24)}`,
			workDir: `/scratch/parallel/${child.childRequestDigest}`,
			state: "COMPLETED+",
			exitCode: "0:0 ",
			submit: new Date(submit - 7 * 60 * 60 * 1_000).toISOString().replace(".000Z", ""),
			start: new Date(start - 7 * 60 * 60 * 1_000).toISOString().replace(".000Z", ""),
			end: new Date(end - 7 * 60 * 60 * 1_000).toISOString().replace(".000Z", ""),
			elapsedRaw: "20",
			allocTres: "billing=10,cpu=10,gres/gpu=1,mem=32G,node=1",
			reqTres: "billing=8,cpu=8,gres/gpu=1,mem=32G,node=1",
		},
		normalized: {
			state: "COMPLETED",
			exitCode: "0:0",
			submitAt: new Date(submit).toISOString(),
			startAt: new Date(start).toISOString(),
			endAt: new Date(end).toISOString(),
			elapsedSeconds: 20,
			queueWaitMs: start - submit,
			runtimeMs: end - start,
			requested: { cpus: 8, gpus: 1, memoryMiB: 32_768 },
			allocated: { cpus: 10, gpus: 1, memoryMiB: 32_768 },
		},
	} as const;
	const log = workerResult.observed.log;
	const canonicalManifest = `${canonicalJson(
		toJsonValue({
			schemaVersion: 1,
			childRequestDigest: child.childRequestDigest,
			logs: [{ ...log, relativePath: `logs/${log.sha256}.log` }],
		}),
	)}\n`;
	return buildNanoGptScoredParallelChildCompletion(
		{
			workerResult,
			jobScriptSha256: sha256Text(`parallel-job-script:${child.childRequestDigest}`),
			scheduler,
			archive: {
				canonicalManifest,
				manifestByteLength: Buffer.byteLength(canonicalManifest),
				manifestSha256: sha256Text(canonicalManifest),
				log: { ...log, relativePath: `logs/${log.sha256}.log` },
			},
		},
		child,
		stage,
	);
}

describe("NanoGPT scored parallel v2 requests", () => {
	it("binds the host aggregator into the epoch and deterministically derives exact child requests", () => {
		const { smoke, score3, replay8 } = stageRequests();
		assert.match(smoke.verifierEpoch, /^nanogpt-scored-parallel-v2-[0-9a-f]{24}$/);
		assert.notEqual(
			nanoGptScoredParallelVerifierEpoch(PINS),
			nanoGptScoredParallelVerifierEpoch({ ...PINS, hostAggregationSha256: sha256Text("changed aggregator") }),
		);
		assert.deepEqual([smoke.trials, score3.trials, replay8.trials], [1, 3, 8]);
		assert.deepEqual(
			[smoke.effectiveTrainSteps, score3.effectiveTrainSteps, replay8.effectiveTrainSteps],
			[10, 3_200, 3_200],
		);
		assert.deepEqual(
			[
				smoke.launch.maxConcurrentChildren,
				score3.launch.maxConcurrentChildren,
				replay8.launch.maxConcurrentChildren,
			],
			[1, 3, 4],
		);
		assert.equal(smoke.v1Bridge, null);
		assert.equal(score3.v1Bridge?.thresholdPassed, true);
		assert.equal(score3.v1Bridge?.numericMeasurementsReused, false);
		assert.equal(replay8.priorStage?.v1BridgeDigest, sha256Json(replay8.v1Bridge));
		const first = buildNanoGptScoredParallelChildRequest(score3, 1);
		const second = buildNanoGptScoredParallelChildRequest(score3, 1);
		assert.deepEqual(second, first);
		assert.equal(first.childSpec.index, 1);
		assert.equal(first.childSpec.seed, score3.seeds[1]);
		assert.equal(first.launch.noRequeue, true);
		assert.deepEqual(first.measurementEncoding, {
			runtimeMsRounding: "half-even-to-nearest-integer",
			peakVramMbRounding: "ceil-to-whole-MiB",
		});
		verifyNanoGptScoredParallelStageRequest(replay8);
		verifyNanoGptScoredParallelChildRequest(first, score3);
	});

	it("rejects bridge use in smoke, bridge omission in widening, and unknown schema fields", () => {
		const { smoke, score3 } = stageRequests();
		assert.throws(
			() => verifyNanoGptScoredParallelStageRequest({ ...smoke, v1Bridge: v1Bridge() }),
			/digest mismatch|smoke must be fresh/,
		);
		assert.throws(
			() => verifyNanoGptScoredParallelStageRequest({ ...score3, v1Bridge: null }),
			/digest mismatch|requires its exact v1 gate/,
		);
		assert.throws(
			() =>
				verifyNanoGptScoredParallelStageRequest({
					...score3,
					unexpected: true,
				} as NanoGptScoredParallelStageRequest),
			/must contain exactly/,
		);
	});
});

describe("NanoGPT scored parallel v2 aggregation and receipts", () => {
	it("sorts by stable seed index, admits only the full set, and uses exact integer threshold comparison", () => {
		const { score3 } = stageRequests();
		const equalChildren = score3.children.map((_, index) =>
			childCompletion(score3, index, NANOGPT_SCORED_THRESHOLD_NANOUNITS),
		);
		const equality = buildNanoGptScoredParallelStageResult(score3, [...equalChildren].reverse());
		assert.deepEqual(
			equality.children.map((child) => child.workerResult.index),
			[0, 1, 2],
		);
		assert.equal(equality.thresholdPassed, false);
		assert.equal(equality.lossSumNanounits, score3.trials * NANOGPT_SCORED_THRESHOLD_NANOUNITS);
		assert.equal(equality.accounting.requested.cpusPerChild, 8);
		assert.equal(equality.accounting.allocated.totalAllocatedCpus, 30);
		assert.equal(equality.accounting.allocated.maxConcurrentChildrenObserved, 3);
		assert.deepEqual(equality.accounting.gpuHours, {
			numeratorGpuMilliseconds: 60_000,
			denominatorMillisecondsPerHour: 3_600_000,
		});
		const below = buildNanoGptScoredParallelStageResult(
			score3,
			score3.children.map((_, index) => childCompletion(score3, index, NANOGPT_SCORED_THRESHOLD_NANOUNITS - 1)),
		);
		assert.equal(below.thresholdPassed, true);
		assert.throws(
			() => buildNanoGptScoredParallelStageResult(score3, equalChildren.slice(0, 2)),
			/full exact child set/,
		);
		assert.throws(
			() => buildNanoGptScoredParallelStageResult(score3, [equalChildren[0], equalChildren[0], equalChildren[2]]),
			/duplicate or missing stable seed index/,
		);
	});

	it("enforces four-child width and binds every script, sacct row, log, and GPU UUID into the receipt", () => {
		const { replay8 } = stageRequests();
		const children = replay8.children.map((_, index) => childCompletion(replay8, index));
		const result = buildNanoGptScoredParallelStageResult(replay8, children);
		assert.equal(result.accounting.allocated.maxConcurrentChildrenObserved, 4);
		assert.equal(result.children[0].scheduler.raw.submit, "2026-08-30T02:00:00");
		assert.equal(result.children[0].scheduler.raw.state, "COMPLETED+");
		assert.equal(result.children[0].scheduler.raw.exitCode, "0:0 ");
		assert.equal(result.children[0].scheduler.normalized.state, "COMPLETED");
		assert.equal(result.children[0].scheduler.normalized.exitCode, "0:0");
		assert.equal(result.children[0].scheduler.normalized.submitAt, "2026-08-30T09:00:00.000Z");
		assert.notEqual(result.children[0].scheduler.raw.submit, result.children[0].scheduler.normalized.submitAt);
		assert.deepEqual(Object.keys(JSON.parse(result.children[0].archive.canonicalManifest)).sort(), [
			"childRequestDigest",
			"logs",
			"schemaVersion",
		]);
		const receipt = buildNanoGptScoredParallelStageReceipt(replay8, result);
		assert.equal(receipt.children.length, 8);
		for (const [index, evidence] of receipt.children.entries()) {
			assert.equal(evidence.index, index);
			assert.match(evidence.jobScriptSha256, /^[0-9a-f]{64}$/);
			assert.match(evidence.sacctRawSha256, /^[0-9a-f]{64}$/);
			assert.match(evidence.logSha256, /^[0-9a-f]{64}$/);
			assert.equal(evidence.gpuUuid, `GPU-parallel-${index % 4}`);
			assert.equal(evidence.schedulerState, "COMPLETED");
			assert.equal(evidence.schedulerExitCode, "0:0");
		}
		assert.deepEqual(parseNanoGptScoredParallelStageResult(result, replay8), result);
		assert.deepEqual(parseNanoGptScoredParallelStageReceipt(receipt, replay8, result), receipt);
		const tampered = structuredClone(receipt);
		(tampered.children[0] as { gpuUuid: string }).gpuUuid = "GPU-tampered";
		assert.throws(
			() => parseNanoGptScoredParallelStageReceipt(tampered, replay8, result),
			/does not bind every child completion/,
		);
		const allOverlap = replay8.children.map((_, index) => childCompletion(replay8, index, 3_200_000_000, true));
		assert.throws(
			() => buildNanoGptScoredParallelStageResult(replay8, allOverlap),
			/resource accounting is outside its exact bounds/,
		);
	});

	it("rejects decimal/nanounit disagreement and non-authoritative child evidence", () => {
		const { smoke } = stageRequests();
		const childRequest: NanoGptScoredParallelChildRequest = buildNanoGptScoredParallelChildRequest(smoke, 0);
		const completion = childCompletion(smoke, 0);
		const badWorker = structuredClone(completion.workerResult) as unknown as Record<string, unknown>;
		badWorker.validationLossDecimal = "3.100000000";
		assert.throws(
			() => parseNanoGptScoredParallelChildWorkerResult(badWorker, childRequest, smoke),
			/loss decimal and nanounits disagree/,
		);
		const badCompletion = structuredClone(completion) as unknown as Record<string, unknown>;
		const scheduler = badCompletion.scheduler as { normalized: { allocated: { cpus: number } } };
		scheduler.normalized.allocated.cpus = 8;
		assert.throws(
			() => parseNanoGptScoredParallelChildCompletion(badCompletion, childRequest, smoke),
			/scheduler evidence is not authoritative|completion is not bound/,
		);
		const contradictoryRaw = structuredClone(completion) as unknown as Record<string, unknown>;
		const contradictoryScheduler = contradictoryRaw.scheduler as { raw: { state: string } };
		contradictoryScheduler.raw.state = "FAILED";
		assert.throws(
			() => parseNanoGptScoredParallelChildCompletion(contradictoryRaw, childRequest, smoke),
			/scheduler evidence is not authoritative/,
		);
	});
});

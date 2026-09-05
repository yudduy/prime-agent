import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import type { NanoGptScoredStaticGate } from "../src/nanogpt-scored-adapter.js";
import {
	NanoGptScoredParallelAdapter,
	type NanoGptScoredParallelV1BridgeLoader,
	nanoGptScoredParallelApparatusAttemptBoundaryCondition,
	nanoGptScoredParallelBudgetClass,
} from "../src/nanogpt-scored-parallel-adapter.js";
import {
	buildNanoGptScoredParallelChildCompletion,
	buildNanoGptScoredParallelChildRequest,
	buildNanoGptScoredParallelStageResult,
	NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
	type NanoGptScoredParallelArchiveEvidence,
	type NanoGptScoredParallelChildCompletion,
	type NanoGptScoredParallelChildWorkerResult,
	type NanoGptScoredParallelMode,
	type NanoGptScoredParallelPins,
	type NanoGptScoredParallelSchedulerEvidence,
	type NanoGptScoredParallelStageRequest,
	type NanoGptScoredV1ScoreOneBridge,
	nanoGptScoredParallelBenchmarkIds,
	nanoGptScoredParallelBoundaryConditions,
	nanoGptScoredParallelChildJobName,
	nanoGptScoredParallelExternalHandle,
} from "../src/nanogpt-scored-parallel-protocol.js";
import type {
	NanoGptScoredParallelTransport,
	NanoGptScoredParallelTransportCompletion,
} from "../src/nanogpt-scored-parallel-transport.js";
import type { NanoGptScoredStaticEvidence } from "../src/nanogpt-scored-protocol.js";
import type { EvaluationContext, EvaluationJob } from "../src/types.js";

const PINS: NanoGptScoredParallelPins = {
	staticEvaluatorSha256: sha256Text("parallel-adapter-static"),
	environmentSha256: sha256Text("parallel-adapter-environment"),
	environmentSealSha256: sha256Text("parallel-adapter-environment-seal"),
	datasetManifestSha256: sha256Text("parallel-adapter-dataset"),
	parallelWorkerSha256: sha256Text("parallel-adapter-worker"),
	baseWorkerSha256: sha256Text("parallel-adapter-base-worker"),
	parallelTransportSha256: sha256Text("parallel-adapter-transport"),
	hostAggregationSha256: sha256Text("parallel-adapter-host-aggregation"),
};

const CANDIDATE_PATCH = [
	"--- a/train_gpt_simple.py",
	"+++ b/train_gpt_simple.py",
	"@@ -281 +281 @@",
	"-    train_steps = 3290",
	"+    train_steps = 3200",
	"",
].join("\n");
const CANDIDATE_SHA256 = sha256Text(`parallel-candidate:${CANDIDATE_PATCH}`);
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function staticEvidence(candidatePatch = CANDIDATE_PATCH): NanoGptScoredStaticEvidence {
	return {
		contract: "nanogpt-track3-static-contract-v1",
		repositoryCommit: "38e258afefb1ce206dd7595aa71d7740da405742",
		programSha256: "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08",
		evaluatorSha256: PINS.staticEvaluatorSha256,
		baselineSha256: "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e",
		patchSha256: sha256Text(candidatePatch),
		candidateSha256: CANDIDATE_SHA256,
		trainSteps: 3_200,
		frozenSegmentSha256: [0, 1, 2, 3].map((index) => sha256Text(`parallel-frozen-${index}`)),
		editableSegmentSha256: [0, 1, 2].map((index) => sha256Text(`parallel-editable-${index}`)),
	};
}

const fakeStaticGate: NanoGptScoredStaticGate = async (candidatePatch) => staticEvidence(candidatePatch);

function evaluationJob(
	mode: NanoGptScoredParallelMode,
	options: {
		readonly jobId?: string;
		readonly parentJobIds?: readonly string[];
		readonly apparatusAttempt?: number;
	} = {},
): EvaluationJob {
	const apparatusAttempt = options.apparatusAttempt ?? 0;
	const jobId = options.jobId ?? `parallel_${mode.replaceAll("-", "_")}_${apparatusAttempt}`;
	const parentJobIds = [...(options.parentJobIds ?? [])];
	const candidateDigest = sha256Text(CANDIDATE_PATCH);
	return {
		jobId,
		manifestDigest: sha256Json({ jobId, mode, apparatusAttempt, parentJobIds, candidateDigest }),
		branchId: "parallel-adapter-test",
		lane: "nanogpt",
		benchmarkIds: [...nanoGptScoredParallelBenchmarkIds(mode)],
		budgetClass: nanoGptScoredParallelBudgetClass(mode),
		treatment: "candidate-a",
		proposal: {
			hypothesis: `${mode} preserves the fixed candidate`,
			mechanism: "fresh verifier-bound one-GPU child measurements",
			predictedOutcome: "complete stable-index aggregation",
			boundaryConditions: [
				...nanoGptScoredParallelBoundaryConditions(PINS),
				nanoGptScoredParallelApparatusAttemptBoundaryCondition(apparatusAttempt),
			],
			parentJobIds,
		},
		candidate: {
			digest: candidateDigest,
			byteLength: Buffer.byteLength(CANDIDATE_PATCH),
			mediaType: "text/x-diff",
		},
		candidateFormat: "unified-diff",
		requireFreshMeasurement: true,
		candidateContent: CANDIDATE_PATCH,
	};
}

function context(handles: string[] = []): EvaluationContext {
	return {
		signal: new AbortController().signal,
		async recordExternalJobId(handle: string): Promise<void> {
			handles.push(handle);
		},
	};
}

function bridgeFor(evidence: NanoGptScoredStaticEvidence): NanoGptScoredV1ScoreOneBridge {
	return {
		contract: "nanogpt-track3-scored-confirmatory-v1",
		mode: "score-1",
		verifierEpoch: `nanogpt-scored-v1-${"1".repeat(24)}`,
		stageIdentity: sha256Text("parallel-v1-score-one-stage"),
		requestDigest: sha256Text("parallel-v1-score-one-request"),
		resultDigest: sha256Text("parallel-v1-score-one-result"),
		receiptDigest: sha256Text("parallel-v1-score-one-receipt"),
		candidateSha256: evidence.candidateSha256,
		trainSteps: evidence.trainSteps,
		meanValidationLossExclusiveUpperBound: 3.27859,
		accepted: true,
		thresholdPassed: true,
		numericMeasurementsReused: false,
	};
}

function bridgeLoader(calls: string[]): NanoGptScoredParallelV1BridgeLoader {
	return async (job, evidence) => {
		calls.push(job.jobId);
		assert.equal(job.candidate.digest, evidence.patchSha256);
		assert.equal(evidence.candidateSha256, CANDIDATE_SHA256);
		return bridgeFor(evidence);
	};
}

function lossDecimal(nanounits: number): string {
	const whole = Math.floor(nanounits / 1_000_000_000);
	const fraction = nanounits % 1_000_000_000;
	return `${whole}.${String(fraction).padStart(9, "0")}`;
}

function lossFor(mode: NanoGptScoredParallelMode, index: number): number {
	if (mode === "smoke-10") return 3_100_000_000 + index;
	return mode === "score-3" ? 3_200_000_000 + index : 3_210_000_000 + index;
}

function childCompletion(
	stage: NanoGptScoredParallelStageRequest,
	index: number,
	dispatchOrdinal: number,
	ok: boolean,
): NanoGptScoredParallelChildCompletion {
	const child = buildNanoGptScoredParallelChildRequest(stage, index);
	const base = Date.parse("2026-08-30T09:00:00.000Z") + dispatchOrdinal * 180_000;
	const wave = stage.mode === "replay-8" ? Math.floor(index / 4) : 0;
	const submit = base;
	const start = base + 10_000 + wave * 25_000;
	const end = start + 20_000;
	const log = {
		remoteName: `trial-${String(index).padStart(3, "0")}.log`,
		byteLength: 1_000 + index,
		sha256: sha256Text(`${stage.requestDigest}:${dispatchOrdinal}:${index}:log`),
	};
	const shared = {
		schemaVersion: 1 as const,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		verifierEpoch: stage.verifierEpoch,
		stageIdentity: stage.stageIdentity,
		stageRequestDigest: stage.requestDigest,
		childRequestDigest: child.childRequestDigest,
		childSpecDigest: child.childSpecDigest,
		mode: stage.mode,
		index,
		seed: stage.seeds[index] ?? -1,
		candidateSha256: stage.staticEvidence.candidateSha256,
		effectiveTrainSteps: stage.effectiveTrainSteps,
		runtimeMs: 18_000,
		startedAt: new Date(start + 1_000).toISOString(),
		finishedAt: new Date(end - 1_000).toISOString(),
		observed: {
			slurmJobId: String(1_900_000 + dispatchOrdinal * 100 + index),
			hardware: {
				cluster: "Stanford FarmShare" as const,
				gpu: "NVIDIA L40S" as const,
				gpuUuid: `GPU-parallel-${dispatchOrdinal}-${index}`,
				gpus: 1 as const,
				worldSize: 1 as const,
			},
			log,
		},
		execution: {
			cleanJobDirectory: true as const,
			freshCandidateMaterialization: true as const,
			priorMeasurementsReused: false as const,
		},
		sourceIntegrity: {
			preRunCandidateSha256: stage.staticEvidence.candidateSha256,
			postRunCandidateSha256: stage.staticEvidence.candidateSha256,
		},
		pins: stage.pins,
	};
	const nanounits = lossFor(stage.mode, index);
	const workerResult: NanoGptScoredParallelChildWorkerResult = ok
		? {
				...shared,
				ok: true,
				validationLossDecimal: lossDecimal(nanounits),
				validationLossNanounits: nanounits,
				optimizerSteps: stage.effectiveTrainSteps,
				peakVramMb: 30_000 + index,
				failure: null,
			}
		: {
				...shared,
				ok: false,
				validationLossDecimal: null,
				validationLossNanounits: null,
				optimizerSteps: null,
				peakVramMb: null,
				failure: { kind: "runtime", message: "synthetic child apparatus failure" },
			};
	const scheduler: NanoGptScoredParallelSchedulerEvidence = {
		raw: {
			jobIdRaw: workerResult.observed.slurmJobId,
			jobName: nanoGptScoredParallelChildJobName(child.childRequestDigest),
			workDir: `/scratch/parallel-adapter/${child.childRequestDigest}`,
			state: "COMPLETED",
			exitCode: "0:0",
			submit: new Date(submit).toISOString(),
			start: new Date(start).toISOString(),
			end: new Date(end).toISOString(),
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
	};
	const canonicalManifest = `${canonicalJson(
		toJsonValue({
			schemaVersion: 1,
			childRequestDigest: child.childRequestDigest,
			logs: [{ ...log, relativePath: `logs/${log.sha256}.log` }],
		}),
	)}\n`;
	const archive: NanoGptScoredParallelArchiveEvidence = {
		canonicalManifest,
		manifestByteLength: Buffer.byteLength(canonicalManifest),
		manifestSha256: sha256Text(canonicalManifest),
		log: { ...log, relativePath: `logs/${log.sha256}.log` },
	};
	return buildNanoGptScoredParallelChildCompletion(
		{
			workerResult,
			jobScriptSha256: sha256Text(`job-script:${child.childRequestDigest}`),
			scheduler,
			archive,
		},
		child,
		stage,
	);
}

type DispatchPlan = "complete" | "missing" | "failed" | "throw";

interface DispatchRecord {
	readonly kind: "execute" | "resume";
	readonly request: NanoGptScoredParallelStageRequest;
	readonly generatedIndices: readonly number[];
	readonly returnedChildren: readonly NanoGptScoredParallelChildCompletion[];
}

class FakeParallelTransport implements NanoGptScoredParallelTransport {
	readonly records: DispatchRecord[] = [];
	executeCalls = 0;
	resumeCalls = 0;
	archiveVerifyCalls = 0;
	private ordinal = 0;

	constructor(private readonly plans: DispatchPlan[] = []) {}

	private dispatch(
		kind: "execute" | "resume",
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		externalHandle: string | null,
		signal: AbortSignal,
	): NanoGptScoredParallelTransportCompletion {
		assert.equal(candidatePatch, CANDIDATE_PATCH);
		assert.equal(signal.aborted, false);
		if (externalHandle !== null) {
			assert.equal(externalHandle, nanoGptScoredParallelExternalHandle(request.requestDigest));
		}
		const plan = this.plans.shift() ?? "complete";
		const ordinal = this.ordinal++;
		if (plan === "throw") {
			this.records.push({ kind, request, generatedIndices: [], returnedChildren: [] });
			throw new Error("synthetic interrupted transport");
		}
		const generatedIndices = request.children.map((_, index) => index);
		let children = generatedIndices.map((index) =>
			childCompletion(request, index, ordinal, plan !== "failed" || index !== 1),
		);
		children = [...children].reverse();
		if (plan === "missing") children = children.slice(0, -1);
		this.records.push({ kind, request, generatedIndices, returnedChildren: children });
		return {
			schemaVersion: 1,
			stageRequestDigest: request.requestDigest,
			externalHandle: nanoGptScoredParallelExternalHandle(request.requestDigest),
			children,
		};
	}

	execute(
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelTransportCompletion> {
		this.executeCalls++;
		return Promise.resolve().then(() => this.dispatch("execute", request, candidatePatch, null, signal));
	}

	resume(
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		externalHandle: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelTransportCompletion> {
		this.resumeCalls++;
		return Promise.resolve().then(() => this.dispatch("resume", request, candidatePatch, externalHandle, signal));
	}

	verifyArchiveEvidence(
		request: NanoGptScoredParallelStageRequest,
		completion: NanoGptScoredParallelTransportCompletion,
		signal: AbortSignal,
	): Promise<void> {
		this.archiveVerifyCalls++;
		assert.equal(signal.aborted, false);
		assert.equal(completion.stageRequestDigest, request.requestDigest);
		assert.equal(completion.externalHandle, nanoGptScoredParallelExternalHandle(request.requestDigest));
		return Promise.resolve();
	}
}

async function stateRoot(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `prime-nanogpt-parallel-${label}-`));
	temporaryDirectories.push(root);
	return root;
}

function receiptPath(root: string, request: NanoGptScoredParallelStageRequest): string {
	return join(root, "slots", request.stageIdentity.slice(0, 2), request.stageIdentity, `${request.mode}.json`);
}

async function assertMissing(path: string): Promise<void> {
	await assert.rejects(readFile(path), (error: unknown) => {
		return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
	});
}

function adapter(
	root: string,
	transport: NanoGptScoredParallelTransport,
	bridgeCalls: string[],
): NanoGptScoredParallelAdapter {
	return new NanoGptScoredParallelAdapter({
		stateDir: root,
		pins: PINS,
		transport,
		v1BridgeLoader: bridgeLoader(bridgeCalls),
		staticGate: fakeStaticGate,
		now: () => new Date("2026-08-30T12:00:00.000Z"),
	});
}

describe("NanoGPT scored parallel adapter", () => {
	it("runs a fresh 1 -> 3 -> 8 lineage with an exact Boolean-only v1 bridge and stable aggregation", async () => {
		const root = await stateRoot("lineage");
		const transport = new FakeParallelTransport();
		const bridgeCalls: string[] = [];
		const subject = adapter(root, transport, bridgeCalls);
		const handles: string[] = [];
		const smoke = evaluationJob("smoke-10");
		const score3 = evaluationJob("score-3", { parentJobIds: [smoke.jobId] });
		const replay8 = evaluationJob("replay-8", { parentJobIds: [score3.jobId] });

		const smokeOutcome = await subject.evaluate(smoke, context(handles));
		const score3Outcome = await subject.evaluate(score3, context(handles));
		const replay8Outcome = await subject.evaluate(replay8, context(handles));

		assert.deepEqual(
			transport.records.map((record) => record.request.mode),
			["smoke-10", "score-3", "replay-8"],
		);
		assert.deepEqual(
			transport.records.map((record) => record.generatedIndices),
			[[0], [0, 1, 2], [0, 1, 2, 3, 4, 5, 6, 7]],
		);
		assert.equal(handles.length, 3);
		assert.equal(transport.archiveVerifyCalls, 5);
		assert.deepEqual(bridgeCalls, [score3.jobId]);
		const scoreRequest = transport.records[1]?.request;
		const replayRequest = transport.records[2]?.request;
		assert.ok(scoreRequest?.v1Bridge);
		assert.equal(scoreRequest.v1Bridge.numericMeasurementsReused, false);
		assert.equal(scoreRequest.priorStage?.numericMeasurementsReused, false);
		assert.equal(scoreRequest.priorStage?.thresholdPassed, null);
		assert.equal(replayRequest?.v1Bridge?.receiptDigest, scoreRequest.v1Bridge.receiptDigest);
		assert.equal(replayRequest?.priorStage?.v1BridgeDigest, sha256Json(scoreRequest.v1Bridge));
		assert.equal(replayRequest?.priorStage?.numericMeasurementsReused, false);
		assert.deepEqual(Object.keys(scoreRequest.v1Bridge).sort(), [
			"accepted",
			"candidateSha256",
			"contract",
			"meanValidationLossExclusiveUpperBound",
			"mode",
			"numericMeasurementsReused",
			"receiptDigest",
			"requestDigest",
			"resultDigest",
			"stageIdentity",
			"thresholdPassed",
			"trainSteps",
			"verifierEpoch",
		]);

		for (const record of transport.records) {
			const aggregated = buildNanoGptScoredParallelStageResult(record.request, record.returnedChildren);
			assert.deepEqual(
				aggregated.children.map((child) => child.workerResult.index),
				record.generatedIndices,
			);
			assert.equal(aggregated.fullExactSet, true);
			assert.equal(aggregated.priorNumericMeasurementsReused, false);
		}
		const allChildDigests = transport.records.flatMap((record) =>
			record.returnedChildren.map((child) => child.childRequestDigest),
		);
		assert.equal(new Set(allChildDigests).size, 12);
		const allSlurmIds = transport.records.flatMap((record) =>
			record.returnedChildren.map((child) => child.workerResult.observed.slurmJobId),
		);
		assert.equal(new Set(allSlurmIds).size, 12);
		assert.equal(smokeOutcome.tasks.length, 1);
		assert.equal(score3Outcome.tasks.length, 3);
		assert.equal(replay8Outcome.tasks.length, 8);
		assert.deepEqual(
			score3Outcome.tasks.map((task) => task.metrics.validation_loss),
			[3.2, 3.200000001, 3.200000002],
		);
		assert.equal(score3Outcome.provenance.frontierEligible, "false");
		assert.equal(replay8Outcome.provenance.frontierEligible, "true");
		assert.equal(replay8Outcome.provenance.recordEligible, "true");
		assert.equal(replay8Outcome.provenance.priorNumericMeasurementsReused, "false");
		const replayStored = JSON.parse(await readFile(receiptPath(root, replayRequest), "utf8")) as {
			stageReceipt: { children: readonly { index: number; seed: number }[] };
		};
		assert.deepEqual(
			replayStored.stageReceipt.children.map(({ index, seed }) => ({ index, seed })),
			replayRequest.seeds.map((seed, index) => ({ index, seed })),
		);
	});

	it("seals no receipt for missing or failed children and reruns every child on a new apparatus attempt", async () => {
		const root = await stateRoot("apparatus-retry");
		const transport = new FakeParallelTransport(["complete", "missing", "failed", "complete"]);
		const bridgeCalls: string[] = [];
		const subject = adapter(root, transport, bridgeCalls);
		const smoke = evaluationJob("smoke-10", { jobId: "parallel-smoke-parent" });
		await subject.evaluate(smoke, context());

		const first = evaluationJob("score-3", {
			jobId: "parallel-score3-attempt-0",
			parentJobIds: [smoke.jobId],
			apparatusAttempt: 0,
		});
		await assert.rejects(subject.evaluate(first, context()), /full exact child set/);
		const firstRecord = transport.records[1];
		assert.ok(firstRecord);
		await assertMissing(receiptPath(root, firstRecord.request));

		const second = evaluationJob("score-3", {
			jobId: "parallel-score3-attempt-1",
			parentJobIds: [smoke.jobId],
			apparatusAttempt: 1,
		});
		await assert.rejects(subject.evaluate(second, context()), /refuses failed child results/);
		const secondRecord = transport.records[2];
		assert.ok(secondRecord);
		await assertMissing(receiptPath(root, secondRecord.request));

		const third = evaluationJob("score-3", {
			jobId: "parallel-score3-attempt-2",
			parentJobIds: [smoke.jobId],
			apparatusAttempt: 2,
		});
		const recovered = await subject.evaluate(third, context());
		const scoreRecords = transport.records.slice(1);
		assert.deepEqual(
			scoreRecords.map((record) => record.generatedIndices),
			[
				[0, 1, 2],
				[0, 1, 2],
				[0, 1, 2],
			],
		);
		assert.deepEqual(
			scoreRecords.map((record) => record.returnedChildren.length),
			[2, 3, 3],
		);
		assert.equal(
			secondRecord.returnedChildren.some((child) => !child.workerResult.ok),
			true,
		);
		assert.equal(new Set(scoreRecords.map((record) => record.request.requestDigest)).size, 3);
		assert.deepEqual(bridgeCalls, [first.jobId, second.jobId, third.jobId]);
		assert.equal(transport.archiveVerifyCalls, 5);
		assert.equal(recovered.provenance.apparatusAttempt, "2");
		assert.equal(recovered.provenance.accepted, "true");
		assert.equal(recovered.provenance.fullExactSet, "true");
		assert.ok(
			(await readFile(receiptPath(root, scoreRecords[2]?.request ?? firstRecord.request), "utf8")).endsWith("\n"),
		);
	});

	it("resumes an interrupted exact request and then serves the receipt idempotently without redispatch", async () => {
		const root = await stateRoot("resume");
		const job = evaluationJob("smoke-10", { jobId: "parallel-resume-smoke" });
		const handles: string[] = [];
		const interruptedTransport = new FakeParallelTransport(["throw"]);
		const interrupted = adapter(root, interruptedTransport, []);
		await assert.rejects(interrupted.evaluate(job, context(handles)), /synthetic interrupted transport/);
		assert.equal(handles.length, 1);
		assert.equal(interruptedTransport.executeCalls, 1);

		const resumedTransport = new FakeParallelTransport();
		const resumedAdapter = adapter(root, resumedTransport, []);
		const resumed = await resumedAdapter.resume(job, handles[0] ?? "", context());
		assert.equal(resumedTransport.executeCalls, 0);
		assert.equal(resumedTransport.resumeCalls, 1);
		assert.equal(resumedTransport.archiveVerifyCalls, 1);
		assert.equal(resumedTransport.records[0]?.kind, "resume");
		assert.equal(
			handles[0],
			nanoGptScoredParallelExternalHandle(resumedTransport.records[0]?.request.requestDigest ?? "0".repeat(64)),
		);

		const idleTransport = new FakeParallelTransport();
		const restarted = adapter(root, idleTransport, []);
		const idempotent = await restarted.evaluate(job, context());
		assert.equal(idleTransport.executeCalls, 0);
		assert.equal(idleTransport.resumeCalls, 0);
		assert.equal(idleTransport.archiveVerifyCalls, 1);
		assert.equal(idempotent.provenance.requestDigest, resumed.provenance.requestDigest);
		assert.equal(idempotent.provenance.resultDigest, resumed.provenance.resultDigest);
		assert.equal(idempotent.provenance.receiptDigest, resumed.provenance.receiptDigest);
	});
});

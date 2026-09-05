import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { ResearchController } from "../src/controller.js";
import {
	NanoGptScoredAdapter,
	type NanoGptScoredStaticGate,
	type NanoGptScoredTransport,
	type NanoGptScoredTransportArchiveEvidence,
	type NanoGptScoredTransportCompletion,
	validateNanoGptScoredCandidatePatch,
} from "../src/nanogpt-scored-adapter.js";
import {
	assessNanoGptScoredWorkerResult,
	buildNanoGptScoredRequest,
	NANOGPT_SCORED_CONTRACT_ID,
	NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND,
	NANOGPT_SCORED_TRIAL_SEEDS,
	type NanoGptScoredMode,
	type NanoGptScoredRequest,
	type NanoGptScoredStaticEvidence,
	type NanoGptScoredVerifierPins,
	nanoGptScoredBenchmarkIds,
	nanoGptScoredBoundaryConditions,
	nanoGptScoredBudgetClass,
	nanoGptScoredExternalHandle,
	nanoGptScoredStageIdentity,
	nanoGptScoredVerifierEpoch,
	parseNanoGptScoredWorkerResult,
	verifyNanoGptScoredRequest,
} from "../src/nanogpt-scored-protocol.js";
import type { EvaluationContext, EvaluationJob, JobStatus, SubmitRequest } from "../src/types.js";

const PINS: NanoGptScoredVerifierPins = {
	staticEvaluatorSha256: sha256Text("faux-static-evaluator"),
	environmentSha256: sha256Text("faux-nanogpt-environment"),
	environmentSealSha256: sha256Text("faux-nanogpt-environment-seal"),
	datasetManifestSha256: sha256Text("faux-full-fineweb-manifest"),
	workerSha256: sha256Text("faux-scored-worker"),
	transportSha256: sha256Text("faux-scored-transport"),
};
const CANDIDATE_PATCH = [
	"--- a/train_gpt_simple.py",
	"+++ b/train_gpt_simple.py",
	"@@ -281 +281 @@",
	"-    train_steps = 3290",
	"+    train_steps = 3200",
	"",
].join("\n");

const temporaryDirectories: string[] = [];
const archivedEvidence = new Map<string, NanoGptScoredTransportArchiveEvidence>();

afterEach(async () => {
	archivedEvidence.clear();
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function staticEvidence(candidatePatch = CANDIDATE_PATCH): NanoGptScoredStaticEvidence {
	return {
		contract: "nanogpt-track3-static-contract-v1",
		repositoryCommit: "38e258afefb1ce206dd7595aa71d7740da405742",
		programSha256: "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08",
		evaluatorSha256: sha256Text("faux-static-evaluator"),
		baselineSha256: "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e",
		patchSha256: sha256Text(candidatePatch),
		candidateSha256: sha256Text(`candidate-source:${candidatePatch}`),
		trainSteps: 3200,
		frozenSegmentSha256: [0, 1, 2, 3].map((index) => sha256Text(`frozen-${index}`)),
		editableSegmentSha256: [0, 1, 2].map((index) => sha256Text(`editable-${index}`)),
	};
}

const fauxStaticGate: NanoGptScoredStaticGate = async (candidatePatch) => staticEvidence(candidatePatch);

function evaluationJob(
	mode: NanoGptScoredMode,
	options: {
		readonly jobId?: string;
		readonly parentJobIds?: readonly string[];
		readonly branchId?: string;
		readonly treatment?: string;
		readonly candidatePatch?: string;
	} = {},
): EvaluationJob {
	const candidatePatch = options.candidatePatch ?? CANDIDATE_PATCH;
	const candidateDigest = sha256Text(candidatePatch);
	const jobId = options.jobId ?? `job_${mode.replaceAll("-", "_")}`;
	const branchId = options.branchId ?? "nanogpt-confirmatory";
	const treatment = options.treatment ?? "candidate-a";
	const parentJobIds = [...(options.parentJobIds ?? [])];
	const manifestDigest = sha256Json({ jobId, branchId, treatment, mode, candidateDigest, parentJobIds });
	return {
		jobId,
		manifestDigest,
		branchId,
		lane: "nanogpt",
		benchmarkIds: [...nanoGptScoredBenchmarkIds(mode)],
		budgetClass: nanoGptScoredBudgetClass(mode),
		treatment,
		proposal: {
			hypothesis: `${mode} preserves the candidate result`,
			mechanism: "fixed candidate-specific staged replay",
			predictedOutcome: "complete verifier-owned measurements",
			boundaryConditions: [...nanoGptScoredBoundaryConditions(PINS), "apparatusAttempt=0"],
			parentJobIds,
		},
		candidate: { digest: candidateDigest, byteLength: Buffer.byteLength(candidatePatch), mediaType: "text/x-diff" },
		candidateFormat: "unified-diff",
		requireFreshMeasurement: true,
		candidateContent: candidatePatch,
	};
}

function executionContext(handles: string[] = []): EvaluationContext {
	return {
		signal: new AbortController().signal,
		async recordExternalJobId(handle: string): Promise<void> {
			handles.push(handle);
		},
	};
}

function workerResult(
	request: NanoGptScoredRequest,
	options: {
		readonly losses?: readonly number[];
		readonly startedAtOffsetMs?: number;
		readonly overlap?: boolean;
		readonly slurmJobId?: string;
	} = {},
): unknown {
	const losses = options.losses ?? request.seeds.map(() => 3.2);
	const base = Date.parse("2026-08-28T20:00:00.000Z") + (options.startedAtOffsetMs ?? 0);
	const trials = request.seeds.map((seed, index) => {
		const start = base + index * (options.overlap ? 500 : 2_000);
		const finish = start + 1_000;
		return {
			index,
			seed,
			startedAt: new Date(start).toISOString(),
			finishedAt: new Date(finish).toISOString(),
			finalValidationLoss: losses[index] ?? 3.2,
			optimizerSteps: request.effectiveTrainSteps,
			peakVramMb: 30_000 + index,
			runtimeMs: 1_000,
			logSha256: sha256Text(`${request.requestDigest}:${index}`),
		};
	});
	return {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_CONTRACT_ID,
		ok: true,
		requestDigest: request.requestDigest,
		externalHandle: nanoGptScoredExternalHandle(request.requestDigest),
		slurmJobId: options.slurmJobId ?? "1702000",
		mode: request.mode,
		candidateSha256: request.staticEvidence.candidateSha256,
		trainSteps: request.staticEvidence.trainSteps,
		effectiveTrainSteps: request.effectiveTrainSteps,
		trials,
		startedAt: new Date(base - 1_000).toISOString(),
		finishedAt: new Date(base + request.trials * 2_000).toISOString(),
		hardware: {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			gpuUuid: "GPU-faux-l40s",
			gpus: 1,
			worldSize: 1,
		},
		execution: {
			trialExecution: "sequential",
			cleanJobDirectory: true,
			freshCandidateMaterialization: true,
			priorMeasurementsReused: false,
		},
		sourceIntegrity: {
			preRunCandidateSha256: request.staticEvidence.candidateSha256,
			postRunCandidateSha256: request.staticEvidence.candidateSha256,
		},
		pins: request.pins,
		failure: null,
	};
}

function failedWorkerResult(request: NanoGptScoredRequest): unknown {
	return {
		...(workerResult(request) as Record<string, unknown>),
		ok: false,
		trials: [],
		failure: { kind: "trial-execution", message: "faux retryable apparatus failure" },
	};
}

function transportCompletion(request: NanoGptScoredRequest, worker: unknown): NanoGptScoredTransportCompletion {
	const result = parseNanoGptScoredWorkerResult(worker, request);
	const logs = result.trials.map((trial) => ({
		requestDigest: request.requestDigest,
		remoteName: `trial-${String(trial.index).padStart(3, "0")}.log`,
		logSha256: trial.logSha256,
		byteLength: 32 + trial.index,
		path: `/tmp/faux-nanogpt-evidence/${request.requestDigest.slice(0, 2)}/${request.requestDigest}/logs/${trial.logSha256}.log`,
	}));
	const canonicalManifest = `${canonicalJson(
		toJsonValue({
			schemaVersion: 1,
			requestDigest: request.requestDigest,
			logs: logs.map((log) => ({
				remoteName: log.remoteName,
				logSha256: log.logSha256,
				byteLength: log.byteLength,
				relativePath: `logs/${log.logSha256}.log`,
			})),
		}),
	)}\n`;
	const archive = {
		canonicalManifest,
		manifestByteLength: Buffer.byteLength(canonicalManifest),
		manifestSha256: sha256Text(canonicalManifest),
		logs,
	};
	archivedEvidence.set(request.requestDigest, archive);
	return {
		schemaVersion: 1,
		requestDigest: request.requestDigest,
		externalHandle: nanoGptScoredExternalHandle(request.requestDigest),
		jobScriptSha256: sha256Text(`job-script:${request.requestDigest}`),
		scheduler: {
			slurmJobId: result.slurmJobId,
			jobName: `pngs-${request.requestDigest.slice(0, 24)}`,
			workDir: `/scratch/faux/nanogpt/jobs/${request.requestDigest}`,
			state: "COMPLETED",
			exitCode: "0:0",
		},
		workerResult: result,
		archive,
	};
}

class FauxTransport implements NanoGptScoredTransport {
	readonly modes: NanoGptScoredMode[] = [];
	executeCalls = 0;
	resumeCalls = 0;
	archiveReadCalls = 0;
	active = 0;
	maxActive = 0;

	constructor(
		private readonly lossForMode: (mode: NanoGptScoredMode) => number = () => 3.2,
		private readonly latencyMs = 0,
	) {}

	async execute(request: NanoGptScoredRequest): Promise<NanoGptScoredTransportCompletion> {
		this.executeCalls++;
		this.modes.push(request.mode);
		this.active++;
		this.maxActive = Math.max(this.maxActive, this.active);
		try {
			if (this.latencyMs > 0) await delay(this.latencyMs);
			return transportCompletion(
				request,
				workerResult(request, { losses: request.seeds.map(() => this.lossForMode(request.mode)) }),
			);
		} finally {
			this.active--;
		}
	}

	async resume(request: NanoGptScoredRequest): Promise<NanoGptScoredTransportCompletion> {
		this.resumeCalls++;
		return transportCompletion(
			request,
			workerResult(request, { losses: request.seeds.map(() => this.lossForMode(request.mode)) }),
		);
	}

	readArchiveEvidence(requestDigest: string): Promise<NanoGptScoredTransportArchiveEvidence> {
		this.archiveReadCalls++;
		const evidence = archivedEvidence.get(requestDigest);
		if (!evidence) return Promise.reject(new Error("missing faux archived evidence"));
		return Promise.resolve(evidence);
	}
}

class FailThenSucceedTransport implements NanoGptScoredTransport {
	executeCalls = 0;

	execute(request: NanoGptScoredRequest): Promise<NanoGptScoredTransportCompletion> {
		this.executeCalls++;
		return Promise.resolve(
			transportCompletion(request, this.executeCalls === 1 ? failedWorkerResult(request) : workerResult(request)),
		);
	}

	readArchiveEvidence(requestDigest: string): Promise<NanoGptScoredTransportArchiveEvidence> {
		const evidence = archivedEvidence.get(requestDigest);
		if (!evidence) return Promise.reject(new Error("missing faux archived evidence"));
		return Promise.resolve(evidence);
	}
}

function protocolRequest(mode: NanoGptScoredMode): NanoGptScoredRequest {
	const evidence = staticEvidence();
	const candidatePatch = {
		digest: evidence.patchSha256,
		byteLength: Buffer.byteLength(CANDIDATE_PATCH),
		mediaType: "text/x-diff",
	};
	const stageIdentity = nanoGptScoredStageIdentity({
		branchId: "protocol-test",
		treatment: "candidate-a",
		verifierEpoch: nanoGptScoredVerifierEpoch(PINS),
		candidatePatchSha256: evidence.patchSha256,
		candidateSha256: evidence.candidateSha256,
	});
	const priorMode =
		mode === "smoke-10" ? null : mode === "score-1" ? "smoke-10" : mode === "score-3" ? "score-1" : "score-3";
	return buildNanoGptScoredRequest({
		stageIdentity,
		mode,
		jobId: `job_${mode}`,
		manifestDigest: sha256Text(`manifest:${mode}`),
		branchId: "protocol-test",
		treatment: "candidate-a",
		candidatePatch,
		staticEvidence: evidence,
		benchmarkIds: nanoGptScoredBenchmarkIds(mode),
		priorStage:
			priorMode === null
				? null
				: {
						mode: priorMode,
						jobId: `job_${priorMode}`,
						requestDigest: sha256Text(`request:${priorMode}`),
						resultDigest: sha256Text(`result:${priorMode}`),
						receiptDigest: sha256Text(`receipt:${priorMode}`),
					},
		pins: PINS,
	});
}

describe("NanoGPT scored host protocol", () => {
	it("fixes the 1/3/8 seed prefixes, strict threshold, and host-only eight-trial eligibility", () => {
		assert.deepEqual(nanoGptScoredBenchmarkIds("score-1").length, 1);
		assert.deepEqual(nanoGptScoredBenchmarkIds("score-3").length, 3);
		assert.deepEqual(nanoGptScoredBenchmarkIds("replay-8").length, 8);
		assert.deepEqual(NANOGPT_SCORED_TRIAL_SEEDS.slice(0, 3), [0xc0ffee, 0xc0ffef, 0xc0fff0]);
		assert.match(nanoGptScoredVerifierEpoch(PINS), /^nanogpt-scored-v1-[0-9a-f]{24}$/);

		const screenRequest = protocolRequest("score-3");
		const screen = assessNanoGptScoredWorkerResult(workerResult(screenRequest), screenRequest);
		assert.equal(screen.thresholdPassed, true);
		assert.equal(screen.frontierEligible, false);
		assert.equal(screen.recordEligible, false);
		assert.ok(screen.tasks.every((task) => task.metrics.verified_steps === undefined));

		const replayRequest = protocolRequest("replay-8");
		assert.throws(
			() => verifyNanoGptScoredRequest({ ...replayRequest, unexpected: true } as NanoGptScoredRequest),
			/must contain exactly/,
		);
		const replay = assessNanoGptScoredWorkerResult(workerResult(replayRequest), replayRequest);
		assert.equal(replay.frontierEligible, true);
		assert.equal(replay.recordEligible, true);
		assert.ok(replay.tasks.every((task) => task.metrics.verified_steps === 3200));

		const equality = assessNanoGptScoredWorkerResult(
			workerResult(replayRequest, {
				losses: replayRequest.seeds.map(() => NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND),
			}),
			replayRequest,
		);
		assert.equal(equality.thresholdPassed, false);
		assert.equal(equality.frontierEligible, false);
		assert.ok(equality.tasks.every((task) => task.metrics.verified_steps === undefined));
	});

	it("rejects partial successful results, overlapping trials, and source-integrity drift", () => {
		const request = protocolRequest("score-3");
		const valid = workerResult(request) as Record<string, unknown>;
		assert.throws(
			() => parseNanoGptScoredWorkerResult({ ...valid, trials: (valid.trials as unknown[]).slice(0, 2) }, request),
			/every fixed trial/,
		);
		assert.throws(() => parseNanoGptScoredWorkerResult(workerResult(request, { overlap: true }), request), /overlap/);
		assert.throws(
			() =>
				parseNanoGptScoredWorkerResult(
					{
						...valid,
						sourceIntegrity: {
							...(valid.sourceIntegrity as Record<string, unknown>),
							postRunCandidateSha256: sha256Text("mutated"),
						},
					},
					request,
				),
			/bound to the exact request/,
		);
	});

	it("uses the existing static contract to admit a literal candidate patch", async () => {
		const evidence = await validateNanoGptScoredCandidatePatch(CANDIDATE_PATCH);
		assert.equal(evidence.patchSha256, sha256Text(CANDIDATE_PATCH));
		assert.equal(evidence.trainSteps, 3200);
		assert.equal(evidence.frozenSegmentSha256.length, 4);
		assert.equal(evidence.editableSegmentSha256.length, 3);
	});
});

describe("NanoGPT scored adapter state and promotion", () => {
	it("requires candidate smoke, exact parent lineage, and passing 1/3 screens before replay-8", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-stage-"));
		temporaryDirectories.push(root);
		const transport = new FauxTransport();
		const adapter = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport,
			staticGate: fauxStaticGate,
		});
		const smoke = evaluationJob("smoke-10");
		const scoreOne = evaluationJob("score-1", { parentJobIds: [smoke.jobId] });
		const scoreThree = evaluationJob("score-3", { parentJobIds: [scoreOne.jobId] });
		const replay = evaluationJob("replay-8", { parentJobIds: [scoreThree.jobId] });

		await assert.rejects(
			adapter.evaluate(scoreOne, executionContext()),
			/requires a completed candidate-specific smoke-10/,
		);
		await adapter.evaluate(smoke, executionContext());
		await assert.rejects(
			adapter.evaluate(evaluationJob("score-1", { parentJobIds: ["wrong-parent"] }), executionContext()),
			/must name the exact smoke-10 controller job/,
		);
		const oneOutcome = await adapter.evaluate(scoreOne, executionContext());
		const threeOutcome = await adapter.evaluate(scoreThree, executionContext());
		const replayOutcome = await adapter.evaluate(replay, executionContext());

		assert.deepEqual(transport.modes, ["smoke-10", "score-1", "score-3", "replay-8"]);
		assert.ok(oneOutcome.tasks.every((task) => task.metrics.verified_steps === undefined));
		assert.ok(threeOutcome.tasks.every((task) => task.metrics.verified_steps === undefined));
		assert.ok(replayOutcome.tasks.every((task) => task.metrics.verified_steps === 3200));
		assert.equal(replayOutcome.provenance.frontierEligible, "true");
		assert.equal(replayOutcome.provenance.recordEligible, "true");
	});

	it("kills widening after a valid screen misses the strict loss threshold", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-kill-"));
		temporaryDirectories.push(root);
		const transport = new FauxTransport((mode) => (mode === "score-1" ? 3.4 : 3.2));
		const adapter = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport,
			staticGate: fauxStaticGate,
		});
		const smoke = evaluationJob("smoke-10");
		const scoreOne = evaluationJob("score-1", { parentJobIds: [smoke.jobId] });
		await adapter.evaluate(smoke, executionContext());
		const one = await adapter.evaluate(scoreOne, executionContext());
		assert.equal(one.provenance.thresholdPassed, "false");
		await assert.rejects(
			adapter.evaluate(evaluationJob("score-3", { parentJobIds: [scoreOne.jobId] }), executionContext()),
			/cannot widen after score-1 missed the fixed threshold/,
		);
		assert.deepEqual(transport.modes, ["smoke-10", "score-1"]);
	});

	it("serializes concurrent duplicate dispatches for one candidate stage", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-serial-"));
		temporaryDirectories.push(root);
		const transport = new FauxTransport(() => 3.2, 20);
		const adapter = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport,
			staticGate: fauxStaticGate,
		});
		const smoke = evaluationJob("smoke-10");
		await Promise.all([adapter.evaluate(smoke, executionContext()), adapter.evaluate(smoke, executionContext())]);
		assert.equal(transport.maxActive, 1);
		assert.deepEqual(transport.modes, ["smoke-10"]);
	});

	it("leaves an apparatus-failed stage unsealed so a new request can retry cleanly", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-retry-"));
		temporaryDirectories.push(root);
		const transport = new FailThenSucceedTransport();
		const adapter = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport,
			staticGate: fauxStaticGate,
		});
		const failedJob = evaluationJob("smoke-10", { jobId: "job_smoke_failed" });
		const failed = await adapter.evaluate(failedJob, executionContext());
		assert.ok(failed.tasks.every((task) => task.status === "failed"));
		assert.equal(failed.provenance.accepted, "false");
		assert.equal(failed.provenance.receiptDigest, undefined);

		const retryJob = evaluationJob("smoke-10", { jobId: "job_smoke_retry" });
		retryJob.proposal.boundaryConditions[retryJob.proposal.boundaryConditions.length - 1] = "apparatusAttempt=1";
		const retried = await adapter.evaluate(retryJob, executionContext());
		assert.ok(retried.tasks.every((task) => task.status === "accepted"));
		assert.equal(retried.provenance.accepted, "true");
		assert.equal(retried.provenance.apparatusAttempt, "1");
		assert.match(retried.provenance.receiptDigest ?? "", /^[0-9a-f]{64}$/);
		assert.equal(transport.executeCalls, 2);
	});

	it("rejects malformed Unicode in request-bound job text before transport dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-unicode-"));
		temporaryDirectories.push(root);
		const transport = new FauxTransport();
		const adapter = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport,
			staticGate: fauxStaticGate,
		});
		await assert.rejects(
			adapter.evaluate(evaluationJob("smoke-10", { treatment: `candidate-${"\ud800"}` }), executionContext()),
			/well-formed Unicode/,
		);
		assert.equal(transport.executeCalls, 0);
	});

	it("recovers a content-addressed result after adapter restart without redispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-restart-"));
		temporaryDirectories.push(root);
		const firstTransport = new FauxTransport();
		const first = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport: firstTransport,
			staticGate: fauxStaticGate,
		});
		const smoke = evaluationJob("smoke-10");
		const handles: string[] = [];
		const firstOutcome = await first.evaluate(smoke, executionContext(handles));
		assert.equal(firstTransport.executeCalls, 1);
		assert.equal(handles.length, 1);

		const secondTransport = new FauxTransport();
		const second = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport: secondTransport,
			staticGate: fauxStaticGate,
		});
		const resumed = await second.resume(smoke, handles[0] ?? "", executionContext());
		const idempotent = await second.evaluate(smoke, executionContext());
		assert.equal(secondTransport.executeCalls, 0);
		assert.equal(secondTransport.resumeCalls, 0);
		assert.equal(secondTransport.archiveReadCalls, 2);
		assert.equal(resumed.provenance.recoveredContentAddressedResult, "true");
		assert.equal(resumed.provenance.schedulerState, "COMPLETED");
		assert.equal(resumed.provenance.schedulerExitCode, "0:0");
		assert.match(resumed.provenance.jobScriptSha256 ?? "", /^[0-9a-f]{64}$/);
		assert.match(resumed.provenance.archiveManifestSha256 ?? "", /^[0-9a-f]{64}$/);
		assert.equal(idempotent.provenance.resultDigest, firstOutcome.provenance.resultDigest);
	});

	it("refuses successful receipt recovery when archived log evidence no longer verifies", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-archive-recovery-"));
		temporaryDirectories.push(root);
		const smoke = evaluationJob("smoke-10");
		const first = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport: new FauxTransport(),
			staticGate: fauxStaticGate,
		});
		const completed = await first.evaluate(smoke, executionContext());
		const requestDigest = completed.provenance.requestDigest;
		const archive = archivedEvidence.get(requestDigest);
		assert.ok(archive);
		archivedEvidence.set(requestDigest, { ...archive, manifestSha256: sha256Text("tampered archive") });

		const restarted = new NanoGptScoredAdapter({
			stateDir: root,
			pins: PINS,
			transport: new FauxTransport(),
			staticGate: fauxStaticGate,
		});
		await assert.rejects(restarted.evaluate(smoke, executionContext()), /archive manifest bytes changed/);
	});
});

function submitRequest(mode: NanoGptScoredMode, parentJobIds: readonly string[]): SubmitRequest {
	return {
		branchId: "controller-nanogpt",
		lane: "nanogpt",
		benchmarkIds: [...nanoGptScoredBenchmarkIds(mode)],
		budgetClass: nanoGptScoredBudgetClass(mode),
		treatment: "candidate-a",
		proposal: {
			hypothesis: `${mode} passes its fixed verifier`,
			mechanism: "candidate-specific staged scoring",
			predictedOutcome: "verified fixed-seed evidence",
			boundaryConditions: [...nanoGptScoredBoundaryConditions(PINS), "apparatusAttempt=0"],
			parentJobIds: [...parentJobIds],
		},
		candidate: { format: "unified-diff", content: CANDIDATE_PATCH },
		requireFreshMeasurement: true,
	};
}

async function waitForStatus(controller: ResearchController, jobId: string, expected: JobStatus): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (controller.status([jobId])[0]?.state.status === expected) return;
		await delay(5);
	}
	throw new Error(`Timed out waiting for ${jobId} to become ${expected}`);
}

it("integrates with the existing NanoGPT controller lane without exposing early screens to generic comparison", async () => {
	const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-controller-"));
	temporaryDirectories.push(root);
	const transport = new FauxTransport();
	const adapter = new NanoGptScoredAdapter({
		stateDir: join(root, "scored-state"),
		pins: PINS,
		transport,
		staticGate: fauxStaticGate,
	});
	const allowed = [
		...new Set(
			(["smoke-10", "score-1", "score-3", "replay-8"] as const).flatMap((mode) => nanoGptScoredBenchmarkIds(mode)),
		),
	];
	const controller = await ResearchController.open({
		ledgerPath: join(root, "evidence.jsonl"),
		artifactDir: join(root, "controller-artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "score", direction: "maximize" },
			kernelbench: { name: "fast_at_1", direction: "maximize" },
			nanogpt: { name: "verified_steps", direction: "minimize" },
		},
		allowedBenchmarks: { "compiler-gym": [], kernelbench: [], nanogpt: allowed },
		maxInflight: { nanogpt: 4 },
	});

	const smoke = await controller.submit(submitRequest("smoke-10", []));
	await waitForStatus(controller, smoke.jobId, "succeeded");
	const one = await controller.submit(submitRequest("score-1", [smoke.jobId]));
	await waitForStatus(controller, one.jobId, "succeeded");
	const three = await controller.submit(submitRequest("score-3", [one.jobId]));
	await waitForStatus(controller, three.jobId, "succeeded");

	for (const jobId of [smoke.jobId, one.jobId, three.jobId]) {
		const measurement = controller.status([jobId])[0]?.measurement;
		assert.ok(measurement);
		assert.ok(measurement.tasks.every((task) => task.metrics.verified_steps === undefined));
	}
	assert.throws(
		() => controller.compare("controller-nanogpt", "nanogpt", "candidate-a", "candidate-a"),
		/no deployable candidate evidence/,
	);

	const replay = await controller.submit(submitRequest("replay-8", [three.jobId]));
	await waitForStatus(controller, replay.jobId, "succeeded");
	const replayMeasurement = controller.status([replay.jobId])[0]?.measurement;
	assert.ok(replayMeasurement);
	assert.equal(replayMeasurement.tasks.length, 8);
	assert.ok(replayMeasurement.tasks.every((task) => task.metrics.verified_steps === 3200));
	assert.equal(replayMeasurement.provenance.frontierEligible, "true");
	assert.equal(replayMeasurement.provenance.recordEligible, "true");
	assert.deepEqual(transport.modes, ["smoke-10", "score-1", "score-3", "replay-8"]);
	controller.verifyLedger();
});

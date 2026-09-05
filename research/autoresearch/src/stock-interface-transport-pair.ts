import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
	DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
	FarmShareCompilerGymAdapter,
	type FarmShareCompilerGymConfig,
} from "./compiler-gym-adapter.js";
import {
	DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG,
	FarmShareCompilerGymWarmBackend,
} from "./compiler-gym-warm-farmshare-backend.js";
import {
	type CompilerGymWarmPilotRecordEvidence,
	createFarmShareCompilerGymWarmPilotRecordEvidenceProvider,
	materializeCompilerGymWarmPilotRecordEvidence,
	validateCompilerGymWarmPilotRecordEvidence,
} from "./compiler-gym-warm-pilot-record-evidence.js";
import {
	COMPILER_GYM_WARM_LAUNCH_CONTRACT,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
	type CompilerGymWarmCleanupVerification,
	ProtocolCompilerGymWarmTransport,
	parseCompilerGymWarmHandle,
} from "./compiler-gym-warm-transport.js";
import {
	expectedStockCpuProvenance,
	STOCK_CPU_MAX_SUBMISSIONS,
	STOCK_CPU_TASKS,
	type StockCpuEvaluationRequest,
} from "./stock-cpu-protocol.js";
import {
	evaluateStockInterfaceParityCandidate,
	openStockInterfaceParityController,
	STOCK_INTERFACE_PARITY_TREATMENT,
	type StockInterfaceParityEvaluationEnvelope,
	type StockInterfaceParityToolTrace,
} from "./stock-interface-parity-protocol.js";
import type { BranchBudgetStatus, EvaluationAdapter, JobView } from "./types.js";

export const STOCK_INTERFACE_TRANSPORT_PAIR_PROTOCOL = "compiler-gym-stock-interface-transport-pair-v1" as const;
export const STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_NUMERATOR = 9n;
export const STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_DENOMINATOR = 10n;

export type StockInterfaceTransportArm = "stock-cold-control" | "stock-warm-treatment";

export const STOCK_INTERFACE_TRANSPORT_REQUESTS: readonly StockCpuEvaluationRequest[] = [
	{
		actions: ["-mem2reg", "-sroa", "-instcombine", "-simplifycfg", "-adce", "-dce", "-dse"],
		hypothesis:
			"Promoting stack variables and then combining, simplifying, and deleting dead code should remove redundant IR in both programs.",
		mechanism:
			"SSA promotion exposes constants, then local combination, CFG simplification, and dead-code passes remove the exposed instructions.",
		predictedOutcome: "Both fixed tasks remain verifier-valid and improve substantially over the empty sequence.",
		boundaryConditions: ["Fixed cBench task pair", "LLVM 10 pass space", "Raw IR count is primary"],
	},
	{
		actions: [
			"-mem2reg",
			"-sroa",
			"-ipsccp",
			"-globalopt",
			"-constprop",
			"-instcombine",
			"-simplifycfg",
			"-reassociate",
			"-gvn",
			"-sccp",
			"-jump-threading",
			"-instcombine",
			"-simplifycfg",
			"-adce",
			"-dce",
			"-dse",
			"-globaldce",
			"-deadargelim",
		],
		hypothesis:
			"Interprocedural and global propagation can expose constants and unreachable paths missed by local cleanup.",
		mechanism:
			"IPO and sparse propagation expose facts that GVN, jump threading, repeated simplification, and dead-code elimination consume.",
		predictedOutcome: "Both fixed tasks remain verifier-valid and improve on candidate C1.",
		boundaryConditions: ["Fixed cBench task pair", "LLVM 10 pass space", "Raw IR count is primary"],
	},
	{
		actions: [
			"-mem2reg",
			"-sroa",
			"-ipsccp",
			"-globalopt",
			"-constprop",
			"-instcombine",
			"-simplifycfg",
			"-reassociate",
			"-newgvn",
			"-sccp",
			"-jump-threading",
			"-loop-rotate",
			"-licm",
			"-tailcallelim",
			"-instcombine",
			"-simplifycfg",
			"-gvn",
			"-adce",
			"-dce",
			"-dse",
			"-globaldce",
			"-deadargelim",
		],
		hypothesis:
			"Loop canonicalization and invariant-code motion may expose additional repeated work after scalar propagation.",
		mechanism:
			"Loop rotation, LICM, tail-call elimination, and a second simplification sweep expose and remove loop-local redundancy.",
		predictedOutcome: "Both fixed tasks remain verifier-valid, with any regression retained as measured evidence.",
		boundaryConditions: ["Fixed cBench task pair", "LLVM 10 pass space", "No unrolling or vectorization"],
	},
	{
		actions: [
			"-mem2reg",
			"-sroa",
			"-ipsccp",
			"-globalopt",
			"-constprop",
			"-instcombine",
			"-simplifycfg",
			"-reassociate",
			"-gvn",
			"-sccp",
			"-jump-threading",
			"-instcombine",
			"-simplifycfg",
			"-mergereturn",
			"-bdce",
			"-adce",
			"-dce",
			"-dse",
			"-deadargelim",
			"-globaldce",
			"-constmerge",
			"-instcombine",
			"-simplifycfg",
			"-ipsccp",
			"-globalopt",
			"-globaldce",
			"-deadargelim",
			"-adce",
		],
		hypothesis:
			"Return merging and bit-tracking dead-code elimination may remove residual instructions without loop expansion.",
		mechanism:
			"Return merging, BDCE, repeated IPO, constant merging, and cleanup consume residual scalar and control-flow redundancy.",
		predictedOutcome: "Both fixed tasks remain verifier-valid and recover the strongest task-local tradeoff.",
		boundaryConditions: ["Fixed cBench task pair", "LLVM 10 pass space", "Fourth and final fixed candidate"],
	},
] as const;

export const STOCK_INTERFACE_TRANSPORT_EXPECTED = [
	{
		candidateId: "C1",
		requestSha256: sha256Json(STOCK_INTERFACE_TRANSPORT_REQUESTS[0]),
		candidateSha256: sha256Text(JSON.stringify(STOCK_INTERFACE_TRANSPORT_REQUESTS[0].actions)),
		tasks: [
			{ benchmarkId: STOCK_CPU_TASKS[0], irInstructionCount: 2075, objectTextSizeBytes: 11_639 },
			{ benchmarkId: STOCK_CPU_TASKS[1], irInstructionCount: 16_406, objectTextSizeBytes: 159_685 },
		],
	},
	{
		candidateId: "C2",
		requestSha256: sha256Json(STOCK_INTERFACE_TRANSPORT_REQUESTS[1]),
		candidateSha256: sha256Text(JSON.stringify(STOCK_INTERFACE_TRANSPORT_REQUESTS[1].actions)),
		tasks: [
			{ benchmarkId: STOCK_CPU_TASKS[0], irInstructionCount: 1958, objectTextSizeBytes: 21_408 },
			{ benchmarkId: STOCK_CPU_TASKS[1], irInstructionCount: 13_756, objectTextSizeBytes: 165_434 },
		],
	},
	{
		candidateId: "C3",
		requestSha256: sha256Json(STOCK_INTERFACE_TRANSPORT_REQUESTS[2]),
		candidateSha256: sha256Text(JSON.stringify(STOCK_INTERFACE_TRANSPORT_REQUESTS[2].actions)),
		tasks: [
			{ benchmarkId: STOCK_CPU_TASKS[0], irInstructionCount: 1948, objectTextSizeBytes: 22_624 },
			{ benchmarkId: STOCK_CPU_TASKS[1], irInstructionCount: 14_238, objectTextSizeBytes: 174_693 },
		],
	},
	{
		candidateId: "C4",
		requestSha256: sha256Json(STOCK_INTERFACE_TRANSPORT_REQUESTS[3]),
		candidateSha256: sha256Text(JSON.stringify(STOCK_INTERFACE_TRANSPORT_REQUESTS[3].actions)),
		tasks: [
			{ benchmarkId: STOCK_CPU_TASKS[0], irInstructionCount: 1958, objectTextSizeBytes: 21_408 },
			{ benchmarkId: STOCK_CPU_TASKS[1], irInstructionCount: 13_751, objectTextSizeBytes: 165_362 },
		],
	},
] as const;

export const STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256 = sha256Json(STOCK_INTERFACE_TRANSPORT_REQUESTS);

const STOCK_INTERFACE_TRANSPORT_HARDWARE = {
	cluster: "Stanford FarmShare",
	partition: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.partition,
	cpuConstraint: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.cpuConstraint,
} as const;

const STOCK_INTERFACE_TRANSPORT_VERIFIER_CHECKS = [
	"farmshare-environment-seal-v2",
	"pinned-cbench-patch-and-source",
	"pinned-action-space",
	"raw-metrics",
	"20-base-semantic-callbacks",
] as const;

export const STOCK_INTERFACE_TRANSPORT_FARMSHARE_CONFIG: FarmShareCompilerGymConfig = {
	...DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
	pythonPath: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
	compilerGymCache: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache,
	compilerGymSiteData: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData,
	compatibilityLibraryDir: COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath,
	maxParallelTasks: COMPILER_GYM_WARM_LAUNCH_CONTRACT.ntasks,
	requestTimeoutMs: DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG.resultTimeoutMs,
};

export interface StockInterfaceTransportClock {
	nowNs(): bigint;
}

export interface StockInterfaceTransportArmRuntime {
	adapter: EvaluationAdapter;
	closeAndVerify(
		artifactDir: string,
		clock: StockInterfaceTransportClock,
	): Promise<StockInterfaceTransportCleanupEvidence>;
}

export interface StockInterfaceTransportCleanupEvidence {
	verification: CompilerGymWarmCleanupVerification | null;
	recordEvidence: CompilerGymWarmPilotRecordEvidence | null;
}

export interface StockInterfaceTransportCallObservation {
	position: number;
	candidateId: string;
	requestSha256: string;
	startedNs: string;
	finishedNs: string;
	durationNs: string;
	envelope: StockInterfaceParityEvaluationEnvelope;
}

export interface StockInterfaceTransportArmObservation {
	arm: StockInterfaceTransportArm;
	branchId: string;
	controllerLifetime: "one-controller-one-ledger-four-sequential-calls-v1";
	ledgerPath: string;
	artifactDir: string;
	calls: StockInterfaceTransportCallObservation[];
	trace: StockInterfaceParityToolTrace;
	jobs: JobView[];
	budget: BranchBudgetStatus;
	cleanup: StockInterfaceTransportCleanupEvidence;
}

export interface StockInterfaceTransportPairAnalysis {
	protocol: typeof STOCK_INTERFACE_TRANSPORT_PAIR_PROTOCOL;
	integrityPassed: true;
	requestSetSha256: string;
	coldCallSumNs: string;
	warmCallSumNs: string;
	warmOverCold: { numerator: string; denominator: string };
	latencyGatePassed: boolean;
	decision: "promote-to-agent-facing-cpu-screen" | "keep-stock-cold";
}

export interface StockInterfaceTransportPairRunOptions {
	outputDir: string;
	branchId: string;
	armOrder: readonly [StockInterfaceTransportArm, StockInterfaceTransportArm];
	workerSha256: string;
	clock?: StockInterfaceTransportClock;
	createRuntime?: (
		arm: StockInterfaceTransportArm,
		workerSha256: string,
	) => Promise<StockInterfaceTransportArmRuntime> | StockInterfaceTransportArmRuntime;
}

function traceFixture(): StockInterfaceParityToolTrace {
	return { callCount: 0, duplicateCount: 0, evaluatorWaitMs: 0, jobIds: [], requests: [], modelFeedbackBytes: [] };
}

function interval(
	startedNs: bigint,
	finishedNs: bigint,
): Pick<StockInterfaceTransportCallObservation, "startedNs" | "finishedNs" | "durationNs"> {
	if (startedNs < 0n || finishedNs <= startedNs) throw new Error("Typed-call monotonic interval must increase");
	return {
		startedNs: startedNs.toString(10),
		finishedNs: finishedNs.toString(10),
		durationNs: (finishedNs - startedNs).toString(10),
	};
}

function defaultClock(): StockInterfaceTransportClock {
	return { nowNs: () => process.hrtime.bigint() };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function throwCombined(primary: unknown, cleanup: unknown): never {
	if (primary !== undefined && cleanup !== undefined) {
		throw new AggregateError([primary, cleanup], "Stock transport arm and cleanup both failed");
	}
	throw primary ?? cleanup;
}

export async function runStockInterfaceTransportArm(input: {
	arm: StockInterfaceTransportArm;
	branchId: string;
	outputDir: string;
	runtime: StockInterfaceTransportArmRuntime;
	clock?: StockInterfaceTransportClock;
}): Promise<StockInterfaceTransportArmObservation> {
	const clock = input.clock ?? defaultClock();
	const outputDir = resolve(input.outputDir);
	await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 });
	await mkdir(outputDir, { mode: 0o700 });
	const evaluationDir = join(outputDir, "evaluation");
	await mkdir(evaluationDir, { mode: 0o700 });
	const controller = await openStockInterfaceParityController(evaluationDir, input.runtime.adapter);
	const trace = traceFixture();
	const calls: StockInterfaceTransportCallObservation[] = [];
	let primaryError: unknown;
	let cleanupError: unknown;
	let cleanup: StockInterfaceTransportCleanupEvidence | undefined;
	try {
		for (const [position, request] of STOCK_INTERFACE_TRANSPORT_REQUESTS.entries()) {
			const startedNs = clock.nowNs();
			const envelope = await evaluateStockInterfaceParityCandidate(controller, input.branchId, request, trace);
			const finishedNs = clock.nowNs();
			calls.push({
				position,
				candidateId: STOCK_INTERFACE_TRANSPORT_EXPECTED[position].candidateId,
				requestSha256: sha256Json(request),
				...interval(startedNs, finishedNs),
				envelope,
			});
		}
		controller.verifyLedger();
	} catch (error) {
		primaryError = error;
	} finally {
		try {
			cleanup = await input.runtime.closeAndVerify(join(evaluationDir, "artifacts"), clock);
		} catch (error) {
			cleanupError = error;
		}
	}
	if (primaryError !== undefined || cleanupError !== undefined) throwCombined(primaryError, cleanupError);
	if (!cleanup) throw new Error("Stock transport arm did not return cleanup evidence");
	controller.verifyLedger();
	return {
		arm: input.arm,
		branchId: input.branchId,
		controllerLifetime: "one-controller-one-ledger-four-sequential-calls-v1",
		ledgerPath: join(evaluationDir, "evidence.jsonl"),
		artifactDir: join(evaluationDir, "artifacts"),
		calls,
		trace,
		jobs: controller.statusForBranch(input.branchId),
		budget: controller.budgetStatus(input.branchId),
		cleanup,
	};
}

function sumDurations(calls: readonly StockInterfaceTransportCallObservation[]): bigint {
	let sum = 0n;
	let previousFinished: bigint | null = null;
	for (const [index, call] of calls.entries()) {
		const started = BigInt(call.startedNs);
		const finished = BigInt(call.finishedNs);
		const duration = BigInt(call.durationNs);
		if (started < 0n || finished <= started || duration !== finished - started) {
			throw new Error(`Invalid typed-call interval at position ${index}`);
		}
		if (previousFinished !== null && started < previousFinished) {
			throw new Error(`Typed-call interval overlaps its predecessor at position ${index}`);
		}
		sum += duration;
		previousFinished = finished;
	}
	return sum;
}

function decisionProjection(call: StockInterfaceTransportCallObservation): unknown {
	const measurement = call.envelope.job.measurement;
	return {
		position: call.position,
		candidateId: call.candidateId,
		requestSha256: call.requestSha256,
		request: call.envelope.request,
		submitted: {
			jobId: call.envelope.submitted.jobId,
			manifestDigest: call.envelope.submitted.manifestDigest,
			duplicate: call.envelope.submitted.duplicate,
		},
		job: {
			jobId: call.envelope.job.jobId,
			manifestDigest: call.envelope.job.manifestDigest,
			parentJobIds: call.envelope.job.parentJobIds,
			candidateDigest: call.envelope.job.candidateDigest,
			status: call.envelope.job.state.status,
			verifierEpoch: measurement?.verifierEpoch ?? null,
			hardware: measurement?.hardware ?? null,
			provenance: measurement?.provenance ?? null,
			tasks:
				measurement?.tasks.map((task) => ({
					benchmarkId: task.benchmarkId,
					status: task.status,
					irInstructionCount: task.metrics.IrInstructionCount ?? null,
					objectTextSizeBytes: task.metrics.ObjectTextSizeBytes ?? null,
					verifier: task.verifier,
				})) ?? [],
		},
		budget: call.envelope.budget,
	};
}

function verifyArm(observation: StockInterfaceTransportArmObservation): void {
	assert.equal(observation.controllerLifetime, "one-controller-one-ledger-four-sequential-calls-v1");
	assert.equal(observation.calls.length, STOCK_CPU_MAX_SUBMISSIONS);
	assert.equal(observation.jobs.length, STOCK_CPU_MAX_SUBMISSIONS);
	assert.equal(observation.trace.callCount, STOCK_CPU_MAX_SUBMISSIONS);
	assert.equal(observation.trace.duplicateCount, 0);
	assert.equal(new Set(observation.trace.jobIds).size, STOCK_CPU_MAX_SUBMISSIONS);
	assert.equal(sha256Json(observation.trace.requests), STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256);
	assert.deepEqual(
		observation.trace.jobIds,
		observation.calls.map((call) => call.envelope.job.jobId),
	);
	const expectedProvenance = expectedStockCpuProvenance(COMPILER_GYM_EVALUATOR_SHA256);
	for (const [position, call] of observation.calls.entries()) {
		const expected = STOCK_INTERFACE_TRANSPORT_EXPECTED[position];
		const durableJob = observation.jobs.find((job) => job.proposal.jobId === call.envelope.job.jobId);
		assert.ok(durableJob, `Durable job is missing at position ${position}`);
		assert.equal(call.position, position);
		assert.equal(call.candidateId, expected.candidateId);
		assert.equal(call.requestSha256, expected.requestSha256);
		assert.equal(sha256Json(call.envelope.request), expected.requestSha256);
		assert.equal(call.envelope.submitted.duplicate, false);
		assert.equal(call.envelope.job.jobId, call.envelope.submitted.jobId);
		assert.equal(call.envelope.job.manifestDigest, call.envelope.submitted.manifestDigest);
		assert.equal(call.envelope.job.candidateDigest, expected.candidateSha256);
		assert.deepEqual(
			call.envelope.job.parentJobIds,
			position === 0 ? [] : [observation.calls[position - 1].envelope.job.jobId],
		);
		assert.equal(call.envelope.job.state.status, "succeeded");
		assert.ok(call.envelope.job.measurement);
		assert.equal(durableJob.proposal.jobId, call.envelope.job.jobId);
		assert.equal(durableJob.proposal.manifestDigest, call.envelope.job.manifestDigest);
		assert.equal(durableJob.proposal.branchId, observation.branchId);
		assert.equal(durableJob.proposal.lane, "compiler-gym");
		assert.deepEqual(durableJob.proposal.benchmarkIds, [...STOCK_CPU_TASKS]);
		assert.equal(durableJob.proposal.budgetClass, "smoke");
		assert.equal(durableJob.proposal.treatment, STOCK_INTERFACE_PARITY_TREATMENT);
		assert.equal(durableJob.proposal.candidateFormat, "llvm-pass-sequence");
		assert.equal(durableJob.proposal.requireFreshMeasurement, true);
		assert.deepEqual(durableJob.proposal.candidate, {
			digest: expected.candidateSha256,
			byteLength: Buffer.byteLength(JSON.stringify(call.envelope.request.actions)),
			mediaType: "application/vnd.prime.llvm-pass-sequence",
		});
		assert.deepEqual(durableJob.proposal.proposal, {
			hypothesis: call.envelope.request.hypothesis,
			mechanism: call.envelope.request.mechanism,
			predictedOutcome: call.envelope.request.predictedOutcome,
			boundaryConditions: call.envelope.request.boundaryConditions,
			parentJobIds: call.envelope.job.parentJobIds,
		});
		const { jobId: _jobId, manifestDigest: _manifestDigest, ...manifestBody } = durableJob.proposal;
		assert.equal(sha256Json(manifestBody), durableJob.proposal.manifestDigest);
		assert.equal(sha256Json(durableJob.state), sha256Json(call.envelope.job.state));
		assert.equal(sha256Json(durableJob.measurement), sha256Json(call.envelope.job.measurement));
		assert.equal(call.envelope.job.measurement.reuse, undefined);
		assert.equal(call.envelope.job.measurement.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
		assert.deepEqual(call.envelope.job.measurement.hardware, STOCK_INTERFACE_TRANSPORT_HARDWARE);
		assert.deepEqual(call.envelope.job.measurement.provenance, expectedProvenance);
		assert.deepEqual(
			call.envelope.job.measurement.tasks.map((task) => ({
				benchmarkId: task.benchmarkId,
				status: task.status,
				irInstructionCount: task.metrics.IrInstructionCount,
				objectTextSizeBytes: task.metrics.ObjectTextSizeBytes,
				verifierPassed: task.verifier.passed,
				verifierChecks: task.verifier.checks,
				verifierErrors: task.verifier.errors,
			})),
			expected.tasks.map((task) => ({
				benchmarkId: task.benchmarkId,
				status: "accepted",
				irInstructionCount: task.irInstructionCount,
				objectTextSizeBytes: task.objectTextSizeBytes,
				verifierPassed: true,
				verifierChecks: [...STOCK_INTERFACE_TRANSPORT_VERIFIER_CHECKS],
				verifierErrors: [],
			})),
		);
		const completedTasks = (position + 1) * STOCK_CPU_TASKS.length;
		assert.deepEqual(call.envelope.budget, {
			branchId: observation.branchId,
			submissions: position + 1,
			taskEvaluations: completedTasks,
			actualTaskEvaluations: completedTasks,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: STOCK_CPU_MAX_SUBMISSIONS,
			maxTaskEvaluations: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
			remainingSubmissions: STOCK_CPU_MAX_SUBMISSIONS - position - 1,
			remainingTaskEvaluations: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length - completedTasks,
		});
	}
	assert.deepEqual(observation.budget, observation.calls.at(-1)?.envelope.budget);
	sumDurations(observation.calls);
}

function verifyCleanup(observation: StockInterfaceTransportArmObservation): void {
	if (observation.arm === "stock-cold-control") {
		for (const call of observation.calls) assert.equal(call.envelope.job.state.externalJobId, null);
		assert.equal(observation.cleanup.verification, null);
		assert.equal(observation.cleanup.recordEvidence, null);
		return;
	}
	const verification = observation.cleanup.verification;
	const evidence = observation.cleanup.recordEvidence;
	assert.ok(verification);
	assert.notEqual(verification.mode, "acquisition");
	if (verification.mode === "acquisition") throw new Error("Warm treatment never acquired a reusable allocation");
	assert.equal(verification.mode, "shutdown");
	assert.equal(verification.schedulerAbsent, true);
	assert.equal(verification.accountingState, "COMPLETED");
	assert.deepEqual(verification.acknowledgedRanks, [0, 1]);
	assert.ok(evidence);
	validateCompilerGymWarmPilotRecordEvidence(evidence);
	const handles = observation.calls.map((call, index) => {
		const externalJobId = call.envelope.job.state.externalJobId;
		assert.ok(externalJobId, `Warm call ${index} is missing its durable allocation handle`);
		return parseCompilerGymWarmHandle(externalJobId);
	});
	assert.equal(new Set(handles.map((handle) => handle.poolDigest)).size, 1);
	assert.equal(new Set(handles.map((handle) => handle.slurmId)).size, 1);
	assert.equal(new Set(handles.map((handle) => handle.requestDigest)).size, STOCK_CPU_MAX_SUBMISSIONS);
	for (const handle of handles) {
		assert.equal(handle.poolDigest, verification.poolDigest);
		assert.equal(handle.slurmId, verification.slurmId);
	}
	assert.equal(evidence.schedulerAbsent, true);
	assert.equal(evidence.acquisition.poolDigest, verification.poolDigest);
	assert.equal(evidence.cleanup.mode, "shutdown");
	assert.deepEqual(evidence.cleanup.acknowledgedRanks, [0, 1]);
	assert.equal(evidence.cleanup.poolDigest, verification.poolDigest);
	assert.equal(evidence.cleanup.slurmId, verification.slurmId);
	assert.match(verification.poolDigest, /^[a-f0-9]{64}$/);
	assert.match(verification.slurmId, /^[1-9][0-9]*$/);
	assert.deepEqual(
		evidence.acknowledgements.map((acknowledgement) => acknowledgement.rank),
		[0, 1],
	);
	const finalCallFinishedNs = BigInt(observation.calls.at(-1)?.finishedNs ?? "-1");
	assert.ok(
		BigInt(evidence.schedulerAbsentAtHostNs) > finalCallFinishedNs,
		"Scheduler absence must be observed after the final typed call",
	);
	assert.equal(evidence.accounting.jobIdRaw, verification.slurmId);
	assert.equal(evidence.accounting.state, "COMPLETED");
	assert.equal(evidence.accounting.exitCode, "0:0");
	assert.equal(evidence.accounting.allocCpus, 4);
	assert.equal(
		evidence.accounting.cpuTimeRawSeconds,
		evidence.accounting.elapsedRawSeconds * evidence.accounting.allocCpus,
	);
}

export function analyzeStockInterfaceTransportPair(
	cold: StockInterfaceTransportArmObservation,
	warm: StockInterfaceTransportArmObservation,
): StockInterfaceTransportPairAnalysis {
	assert.equal(cold.arm, "stock-cold-control");
	assert.equal(warm.arm, "stock-warm-treatment");
	assert.equal(cold.branchId, warm.branchId, "Matched arms must use the same branch identity");
	verifyArm(cold);
	verifyArm(warm);
	verifyCleanup(cold);
	verifyCleanup(warm);
	assert.equal(cold.calls.length, warm.calls.length);
	for (let index = 0; index < cold.calls.length; index++) {
		assert.equal(
			sha256Json(decisionProjection(cold.calls[index])),
			sha256Json(decisionProjection(warm.calls[index])),
			`Transport changed decision-relevant evidence at position ${index}`,
		);
	}
	const coldCallSum = sumDurations(cold.calls);
	const warmCallSum = sumDurations(warm.calls);
	const latencyGatePassed =
		warmCallSum * STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_DENOMINATOR <=
		coldCallSum * STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_NUMERATOR;
	return {
		protocol: STOCK_INTERFACE_TRANSPORT_PAIR_PROTOCOL,
		integrityPassed: true,
		requestSetSha256: STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256,
		coldCallSumNs: coldCallSum.toString(10),
		warmCallSumNs: warmCallSum.toString(10),
		warmOverCold: { numerator: warmCallSum.toString(10), denominator: coldCallSum.toString(10) },
		latencyGatePassed,
		decision: latencyGatePassed ? "promote-to-agent-facing-cpu-screen" : "keep-stock-cold",
	};
}

async function createProductionRuntime(
	arm: StockInterfaceTransportArm,
	workerSha256: string,
): Promise<StockInterfaceTransportArmRuntime> {
	if (!/^[a-f0-9]{64}$/.test(workerSha256)) throw new Error("Worker pin must be a lowercase SHA-256 digest");
	if (arm === "stock-cold-control") {
		const adapter = new FarmShareCompilerGymAdapter(STOCK_INTERFACE_TRANSPORT_FARMSHARE_CONFIG);
		assert.equal(adapter.deterministicMeasurementReuse, undefined);
		return {
			adapter,
			async closeAndVerify() {
				assert.equal(await adapter.closeAndVerify(), undefined);
				return { verification: null, recordEvidence: null };
			},
		};
	}
	const workerPath = fileURLToPath(new URL("../evaluators/compiler_gym_warm_worker.py", import.meta.url));
	const evaluatorPath = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
	const [workerSource, evaluatorSource] = await Promise.all([
		readFile(workerPath, "utf8"),
		readFile(evaluatorPath, "utf8"),
	]);
	if (sha256Text(workerSource) !== workerSha256) throw new Error("Pinned warm worker differs from local source");
	if (sha256Text(evaluatorSource) !== COMPILER_GYM_EVALUATOR_SHA256) {
		throw new Error("Pinned CompilerGym evaluator differs from local source");
	}
	const backend = new FarmShareCompilerGymWarmBackend();
	const transport = new ProtocolCompilerGymWarmTransport(backend, {
		workerSha256,
		evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
		cleanupTimeoutMs: DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG.cleanupTimeoutMs,
	});
	const adapter = new FarmShareCompilerGymAdapter(STOCK_INTERFACE_TRANSPORT_FARMSHARE_CONFIG, {
		warmTransport: transport,
	});
	assert.equal(adapter.deterministicMeasurementReuse, undefined);
	const provider = createFarmShareCompilerGymWarmPilotRecordEvidenceProvider(backend);
	return {
		adapter,
		async closeAndVerify(artifactDir, clock) {
			const verification = await adapter.closeAndVerify();
			if (!verification || verification.mode === "acquisition") {
				throw new Error("Warm treatment did not produce a close verification for an acquired allocation");
			}
			const cleanupObservedAtNs = clock.nowNs();
			const input = await provider.collect(verification);
			const recordEvidence = await materializeCompilerGymWarmPilotRecordEvidence(
				input,
				verification,
				cleanupObservedAtNs,
				artifactDir,
			);
			return { verification, recordEvidence };
		},
	};
}

function validateArmOrder(
	value: readonly StockInterfaceTransportArm[],
): asserts value is readonly [StockInterfaceTransportArm, StockInterfaceTransportArm] {
	assert.equal(value.length, 2, "Arm order must contain exactly two arms");
	assert.deepEqual(
		new Set(value),
		new Set<StockInterfaceTransportArm>(["stock-cold-control", "stock-warm-treatment"]),
	);
}

export async function runStockInterfaceTransportPair(options: StockInterfaceTransportPairRunOptions): Promise<{
	protocol: typeof STOCK_INTERFACE_TRANSPORT_PAIR_PROTOCOL;
	branchId: string;
	armOrder: readonly [StockInterfaceTransportArm, StockInterfaceTransportArm];
	workerSha256: string;
	launchContractSha256: string;
	requestSetSha256: string;
	arms: StockInterfaceTransportArmObservation[];
	analysis: StockInterfaceTransportPairAnalysis;
}> {
	validateArmOrder(options.armOrder);
	if (!options.branchId.trim() || options.branchId.length > 128) throw new Error("Pair branch ID is invalid");
	if (!/^[a-f0-9]{64}$/.test(options.workerSha256)) throw new Error("Worker pin must be a lowercase SHA-256 digest");
	const outputDir = resolve(options.outputDir);
	await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 });
	await mkdir(outputDir, { mode: 0o700 });
	const createRuntime = options.createRuntime ?? createProductionRuntime;
	const observations: StockInterfaceTransportArmObservation[] = [];
	for (const arm of options.armOrder) {
		const runtime = await createRuntime(arm, options.workerSha256);
		observations.push(
			await runStockInterfaceTransportArm({
				arm,
				branchId: options.branchId,
				outputDir: join(outputDir, arm),
				runtime,
				clock: options.clock,
			}),
		);
	}
	const cold = observations.find((observation) => observation.arm === "stock-cold-control");
	const warm = observations.find((observation) => observation.arm === "stock-warm-treatment");
	if (!cold || !warm) throw new Error("Matched pair did not execute both arms");
	const analysis = analyzeStockInterfaceTransportPair(cold, warm);
	const result = {
		protocol: STOCK_INTERFACE_TRANSPORT_PAIR_PROTOCOL,
		branchId: options.branchId,
		armOrder: [...options.armOrder] as [StockInterfaceTransportArm, StockInterfaceTransportArm],
		workerSha256: options.workerSha256,
		launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
		requestSetSha256: STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256,
		arms: observations,
		analysis,
	};
	await writeFile(join(outputDir, "result.json"), `${canonicalJson(toJsonValue(result))}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	return result;
}

function optionMap(argv: readonly string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith("--") || value === undefined || values.has(key)) {
			throw new Error(
				"Usage: stock-interface-transport-pair --output-dir <path> --branch-id <id> --worker-sha256 <digest> --arm-order <cold,warm|warm,cold>",
			);
		}
		values.set(key, value);
	}
	return values;
}

async function main(): Promise<void> {
	const values = optionMap(process.argv.slice(2));
	for (const key of values.keys()) {
		if (key !== "--output-dir" && key !== "--branch-id" && key !== "--worker-sha256" && key !== "--arm-order") {
			throw new Error(`Unknown option ${key}`);
		}
	}
	const outputDir = values.get("--output-dir");
	const branchId = values.get("--branch-id");
	const workerSha256 = values.get("--worker-sha256");
	const orderText = values.get("--arm-order");
	if (!outputDir || !branchId || !workerSha256 || !orderText) throw new Error("All pair options are required");
	const order = orderText.split(",") as StockInterfaceTransportArm[];
	validateArmOrder(order);
	const result = await runStockInterfaceTransportPair({
		outputDir,
		branchId,
		workerSha256,
		armOrder: order,
	});
	process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
	main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

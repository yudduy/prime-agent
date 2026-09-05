import { sha256Json, sha256Text } from "./canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
	DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
} from "./compiler-gym-adapter.js";
import type { BranchBudgetStatus, JobView, SubmitResult } from "./types.js";

export const REDUCED_CPU_STUDY_PROTOCOL_VERSION = "reduced-prime-compiler-gym-study-v1" as const;
export const REDUCED_CPU_STUDY_ARMS = ["stock", "M", "M+R"] as const;
export type ReducedCpuStudyArm = (typeof REDUCED_CPU_STUDY_ARMS)[number];

export const REDUCED_CPU_SEARCH_TASKS = [
	"benchmark://cbench-v1/qsort",
	"benchmark://cbench-v1/blowfish",
	"benchmark://cbench-v1/bzip2",
] as const;
export const REDUCED_CPU_VALIDATION_TASK = "benchmark://cbench-v1/dijkstra" as const;
export const REDUCED_CPU_ALL_TASKS = [...REDUCED_CPU_SEARCH_TASKS, REDUCED_CPU_VALIDATION_TASK] as const;
export type ReducedCpuSearchTask = (typeof REDUCED_CPU_SEARCH_TASKS)[number];
export type ReducedCpuTask = (typeof REDUCED_CPU_ALL_TASKS)[number];

export const REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM = 4 as const;
export const REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM = 5 as const;
export const REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM = 13 as const;
export const REDUCED_CPU_CALIBRATION_BRANCH_ID = "reduced-cpu-study-calibration-v1" as const;
export const REDUCED_CPU_CALIBRATION_TREATMENT = "reduced-cpu-study:calibration" as const;
export const REDUCED_CPU_REQUIRED_VERIFIER_CHECKS = [
	"farmshare-environment-seal-v2",
	"pinned-cbench-patch-and-source",
	"pinned-action-space",
	"raw-metrics",
	"20-base-semantic-callbacks",
] as const;

export const REDUCED_CPU_EXPECTED_HARDWARE = {
	cluster: "Stanford FarmShare",
	partition: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.partition,
	cpuConstraint: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.cpuConstraint,
} as const;

export const REDUCED_CPU_EXPECTED_PROVENANCE = {
	adapter: "farmshare-compiler-gym",
	evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
	environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
	upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
	compilerGym: "0.2.5",
	llvm: "10.0.0",
} as const;

export interface ReducedCpuCandidateRequest {
	actions: string[];
	hypothesis: string;
	mechanism: string;
	predictedOutcome: string;
	boundaryConditions: string[];
}

export interface ReducedCpuTaskEvidence {
	benchmarkId: ReducedCpuTask;
	irInstructionCount: number;
	objectTextSizeBytes: number;
	verifierPassed: true;
}

export interface ReducedCpuCalibration {
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	verifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
	jobId: string;
	manifestDigest: string;
	tasks: ReducedCpuTaskEvidence[];
	hardware: Record<string, string>;
	provenance: Record<string, string>;
}

export interface ReducedCpuCalibrationEnvelope {
	schemaVersion: 1;
	type: "reduced_cpu_study_calibration";
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	branchId: typeof REDUCED_CPU_CALIBRATION_BRANCH_ID;
	submitted: SubmitResult;
	job: JobView;
}

export interface ReducedCpuCandidateTaskEvidence {
	benchmarkId: ReducedCpuSearchTask;
	irInstructionCount: number | null;
	objectTextSizeBytes: number | null;
	status: string | null;
	verifierPassed: boolean;
}

export interface ReducedCpuCandidateEvidence {
	arm: ReducedCpuStudyArm;
	branchId: string;
	ordinal: 1 | 2 | 3 | 4;
	jobId: string;
	manifestDigest: string;
	candidateDigest: string;
	actions: string[];
	parentJobIds: string[];
	verifierValid: boolean;
	tasks: ReducedCpuCandidateTaskEvidence[];
	invalidReasons: string[];
}

export interface ReducedCpuChampionScore {
	jobId: string;
	worstNormalizedIrRatio: number;
	meanNormalizedIrRatio: number;
	normalizedIrRatios: Array<{
		benchmarkId: ReducedCpuSearchTask;
		numerator: number;
		denominator: number;
		exact: string;
	}>;
}

export interface ReducedCpuChampionSelection {
	policy: "worst-normalized-ir-then-mean-v1";
	arm: ReducedCpuStudyArm;
	calibrationJobId: string;
	eligible: ReducedCpuChampionScore[];
	excluded: Array<{ jobId: string; reasons: string[] }>;
	rankedJobIds: string[];
	selectedJobId: string | null;
}

export interface ReducedCpuCandidateTwoClassification {
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	arm: ReducedCpuStudyArm;
	branchId: string;
	candidate1JobId: string;
	candidate2JobId: string;
	candidate1Digest: string;
	candidate2Digest: string;
	candidate1Actions: string[];
	verifierValid: boolean;
	exactSinglePassInsertion: boolean;
	insertedAction: string | null;
	insertionIndex: number | null;
	perTask: Array<{
		benchmarkId: ReducedCpuSearchTask;
		candidate1Ir: number | null;
		candidate2Ir: number | null;
		delta: number | null;
		nonImproving: boolean;
	}>;
	nonImprovingOnAllTasks: boolean;
	eligibleForRetest: boolean;
	reasons: string[];
}

export interface ReducedCpuRetestDirective {
	schemaVersion: 1;
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	type: "reduced_cpu_host_retest_directive";
	arm: "M+R";
	branchId: string;
	candidateOrdinal: 4;
	sourceCandidate1JobId: string;
	sourceCandidate2JobId: string;
	sourceCandidate1Digest: string;
	sourceCandidate2Digest: string;
	baseCandidate3JobId: string;
	expectedParentJobIds: [string];
	insertedAction: string;
	insertionIndex: number;
	baseCandidate3Digest: string;
	actions: string[];
	candidateDigest: string;
}

export interface SealedReducedCpuRetestDirective {
	directive: ReducedCpuRetestDirective;
	directiveSha256: string;
}

export interface ReducedCpuChampionValidationEvidence {
	arm: ReducedCpuStudyArm;
	branchId: string;
	searchChampionJobId: string;
	jobId: string;
	manifestDigest: string;
	candidateDigest: string;
	parentJobIds: [string];
	verifierValid: boolean;
	task: {
		benchmarkId: typeof REDUCED_CPU_VALIDATION_TASK;
		irInstructionCount: number | null;
		objectTextSizeBytes: number | null;
		status: string | null;
		verifierPassed: boolean;
	};
	invalidReasons: string[];
}

export interface ReducedCpuResurrectionAssessment {
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	arm: "M+R";
	branchId: string;
	directiveSha256: string;
	candidate3JobId: string;
	candidate4JobId: string;
	exactDirectiveReapplication: boolean;
	compatibleFreshVerifierEvidence: boolean;
	candidate4SemanticVerifierPassed: boolean;
	perTask: Array<{
		benchmarkId: ReducedCpuSearchTask;
		candidate3Ir: number | null;
		candidate4Ir: number | null;
		delta: number | null;
		practicalDelta: number;
		nonWorse: boolean;
		strictlyImproves: boolean;
		practicallyImproves: boolean;
	}>;
	nonWorseOnAllTasks: boolean;
	strictlyImprovesAtLeastOneTask: boolean;
	practicallyImprovesAtLeastOneTask: boolean;
	executionValid: boolean;
	resurrectionSucceeded: boolean;
	gatePassed: boolean;
	reasons: string[];
}

export interface ReducedCpuMeasuredRecallReceipt {
	schemaVersion: 1;
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	type: "reduced_cpu_measured_recall_receipt";
	arm: "M" | "M+R";
	branchId: string;
	compactionEventSequence: number;
	recallEventSequence: number;
	candidate3ProviderRequestSequence: number;
	recalledJobIds: [string, string];
	recallResultSha256: string;
	providerIncludedRecallSha256: string;
	candidate3JobId: string;
	verified: boolean;
}

export interface ReducedCpuArmBlock {
	arm: ReducedCpuStudyArm;
	branchId: string;
	candidates: ReducedCpuCandidateEvidence[];
	championSelection: ReducedCpuChampionSelection;
	validation: ReducedCpuChampionValidationEvidence | null;
	resurrection: ReducedCpuResurrectionAssessment | null;
	recallReceipt: ReducedCpuMeasuredRecallReceipt | null;
}

export interface ReducedCpuPairwiseBlockComparison {
	leftArm: ReducedCpuStudyArm;
	rightArm: ReducedCpuStudyArm;
	leftJobId: string;
	rightJobId: string;
	tasks: Array<{
		benchmarkId: ReducedCpuTask;
		leftIr: number;
		rightIr: number;
		leftImprovement: number;
		practicalDelta: number;
	}>;
	decision: "left-practical-win" | "right-practical-win" | "practical-tie" | "mixed";
}

export interface ReducedCpuBlockComparisonDecision {
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	valid: boolean;
	invalidReasons: string[];
	practicalDeltaPolicy: "max-3-ir-or-half-percent-calibration-v1";
	pairwise: ReducedCpuPairwiseBlockComparison[];
	rankedArms: ReducedCpuStudyArm[];
	descriptiveBestArm: ReducedCpuStudyArm | null;
	transferEligibility: Array<{
		challengerArm: "M" | "M+R";
		referenceArm: "stock" | "M";
		standardPathPassed: boolean;
		earlyDominancePathPassed: boolean;
		passed: boolean;
	}>;
	transferEligibleArm: ReducedCpuStudyArm | null;
}

export interface ReducedCpuStudyEvaluationEnvelope {
	schemaVersion: 1;
	type: "reduced_cpu_study_search_evaluation";
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	arm: ReducedCpuStudyArm;
	branchId: string;
	ordinal: 1 | 2 | 3 | 4;
	request: ReducedCpuCandidateRequest;
	submitted: SubmitResult;
	job: JobView;
	budget: BranchBudgetStatus;
	retestDirectiveSha256: string | null;
}

export interface ReducedCpuChampionValidationEnvelope {
	schemaVersion: 1;
	type: "reduced_cpu_study_champion_validation";
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	arm: ReducedCpuStudyArm;
	branchId: string;
	championSelection: ReducedCpuChampionSelection;
	submitted: SubmitResult;
	job: JobView;
	validation: ReducedCpuChampionValidationEvidence;
	budget: BranchBudgetStatus;
}

const REQUEST_KEYS = ["actions", "hypothesis", "mechanism", "predictedOutcome", "boundaryConditions"] as const;
const CALIBRATION_ENVELOPE_KEYS = ["schemaVersion", "type", "protocolVersion", "branchId", "submitted", "job"] as const;
const RETEST_DIRECTIVE_KEYS = [
	"schemaVersion",
	"protocolVersion",
	"type",
	"arm",
	"branchId",
	"candidateOrdinal",
	"sourceCandidate1JobId",
	"sourceCandidate2JobId",
	"sourceCandidate1Digest",
	"sourceCandidate2Digest",
	"baseCandidate3JobId",
	"expectedParentJobIds",
	"insertedAction",
	"insertionIndex",
	"baseCandidate3Digest",
	"actions",
	"candidateDigest",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
		throw new Error(`${path} keys mismatch: expected=${sortedExpected.join(",")} received=${actual.join(",")}`);
	}
}

function nonemptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function sha256(value: unknown, path: string): string {
	const digest = nonemptyString(value, path);
	if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return digest;
}

function safeNonnegativeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function stringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${path} must be a string array`);
	}
	return [...value];
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
	return sameStringArray([...left].sort(), [...right].sort());
}

function isSearchOrdinal(value: number): value is 1 | 2 | 3 | 4 {
	return Number.isInteger(value) && value >= 1 && value <= REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM;
}

function expectedManifestDigest(job: JobView): string {
	const { jobId: _jobId, manifestDigest: _manifestDigest, ...body } = job.proposal;
	return sha256Json(body);
}

function expectedSearchParentJobIds(ordinal: 1 | 2 | 3 | 4, priorJobId: string | null): string[] {
	if (ordinal === 1) return [];
	if (!priorJobId) throw new Error(`Candidate ${ordinal} requires the immediately preceding candidate as parent`);
	return [priorJobId];
}

function validateAction(value: string, path: string): void {
	if (!/^-[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${path} is not an LLVM pass flag`);
}

export function reducedCpuSearchTreatment(arm: ReducedCpuStudyArm): string {
	return `reduced-cpu-study:${arm}:search`;
}

export function reducedCpuValidationTreatment(arm: ReducedCpuStudyArm): string {
	return `reduced-cpu-study:${arm}:champion-validation`;
}

export function parseReducedCpuCandidateRequest(value: unknown): ReducedCpuCandidateRequest {
	const parsed = record(value, "request");
	exactKeys(parsed, REQUEST_KEYS, "request");
	const actions = stringArray(parsed.actions, "request.actions");
	if (actions.length > 256) throw new Error("request.actions may contain at most 256 pass flags");
	actions.forEach((action, index) => {
		validateAction(action, `request.actions[${index}]`);
	});
	return {
		actions,
		hypothesis: nonemptyString(parsed.hypothesis, "request.hypothesis"),
		mechanism: nonemptyString(parsed.mechanism, "request.mechanism"),
		predictedOutcome: nonemptyString(parsed.predictedOutcome, "request.predictedOutcome"),
		boundaryConditions: stringArray(parsed.boundaryConditions, "request.boundaryConditions"),
	};
}

function exactStringRecord(
	value: unknown,
	expected: Readonly<Record<string, string>>,
	path: string,
): Record<string, string> {
	const parsed = record(value, path);
	exactKeys(parsed, Object.keys(expected), path);
	const result: Record<string, string> = {};
	for (const [key, expectedValue] of Object.entries(expected)) {
		const observed = nonemptyString(parsed[key], `${path}.${key}`);
		if (observed !== expectedValue) {
			throw new Error(`${path}.${key} mismatch: expected ${expectedValue}, received ${observed}`);
		}
		result[key] = observed;
	}
	return result;
}

function parseAcceptedTask(value: unknown, expectedBenchmarkId: ReducedCpuTask, path: string): ReducedCpuTaskEvidence {
	const parsed = record(value, path);
	exactKeys(parsed, ["benchmarkId", "status", "metrics", "verifier", "runtimeMs"], path);
	if (parsed.benchmarkId !== expectedBenchmarkId) throw new Error(`${path}.benchmarkId mismatch`);
	if (parsed.status !== "accepted") throw new Error(`${path}.status must be accepted`);
	if (typeof parsed.runtimeMs !== "number" || !Number.isFinite(parsed.runtimeMs) || parsed.runtimeMs < 0) {
		throw new Error(`${path}.runtimeMs must be a finite nonnegative number`);
	}
	const verifier = record(parsed.verifier, `${path}.verifier`);
	exactKeys(verifier, ["passed", "checks", "errors"], `${path}.verifier`);
	if (verifier.passed !== true) throw new Error(`${path}.verifier.passed must be true`);
	if (
		!sameStringArray(stringArray(verifier.checks, `${path}.verifier.checks`), REDUCED_CPU_REQUIRED_VERIFIER_CHECKS)
	) {
		throw new Error(`${path}.verifier.checks must match the CompilerGym v2 check sequence`);
	}
	if (stringArray(verifier.errors, `${path}.verifier.errors`).length !== 0) {
		throw new Error(`${path}.verifier.errors must be empty`);
	}
	const metrics = record(parsed.metrics, `${path}.metrics`);
	return {
		benchmarkId: expectedBenchmarkId,
		irInstructionCount: safeNonnegativeInteger(metrics.IrInstructionCount, `${path}.metrics.IrInstructionCount`),
		objectTextSizeBytes: safeNonnegativeInteger(metrics.ObjectTextSizeBytes, `${path}.metrics.ObjectTextSizeBytes`),
		verifierPassed: true,
	};
}

export function parseReducedCpuCalibration(value: unknown): ReducedCpuCalibration {
	const envelope = record(value, "calibration");
	exactKeys(envelope, CALIBRATION_ENVELOPE_KEYS, "calibration");
	if (envelope.schemaVersion !== 1) throw new Error("calibration.schemaVersion must be 1");
	if (envelope.type !== "reduced_cpu_study_calibration") throw new Error("calibration.type mismatch");
	if (envelope.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION) {
		throw new Error("calibration.protocolVersion mismatch");
	}
	if (envelope.branchId !== REDUCED_CPU_CALIBRATION_BRANCH_ID) throw new Error("calibration.branchId mismatch");

	const submitted = record(envelope.submitted, "calibration.submitted");
	exactKeys(submitted, ["jobId", "acceptedAt", "manifestDigest", "duplicate"], "calibration.submitted");
	const job = record(envelope.job, "calibration.job");
	exactKeys(job, ["proposal", "state", "measurement"], "calibration.job");
	const proposal = record(job.proposal, "calibration.job.proposal");
	exactKeys(
		proposal,
		[
			"jobId",
			"manifestDigest",
			"branchId",
			"lane",
			"benchmarkIds",
			"budgetClass",
			"treatment",
			"proposal",
			"candidate",
			"candidateFormat",
			"requireFreshMeasurement",
		],
		"calibration.job.proposal",
	);
	const jobId = nonemptyString(proposal.jobId, "calibration.job.proposal.jobId");
	const manifestDigest = sha256(proposal.manifestDigest, "calibration.job.proposal.manifestDigest");
	if (jobId !== `job_${manifestDigest.slice(0, 24)}`) throw new Error("calibration proposal job ID mismatch");
	if (
		expectedManifestDigest({
			proposal: proposal as unknown as JobView["proposal"],
			state: {} as JobView["state"],
			measurement: null,
		}) !== manifestDigest
	) {
		throw new Error("calibration proposal manifest digest mismatch");
	}
	if (proposal.branchId !== REDUCED_CPU_CALIBRATION_BRANCH_ID) throw new Error("calibration proposal branch mismatch");
	if (proposal.lane !== "compiler-gym") throw new Error("calibration proposal lane mismatch");
	if (
		!sameStringSet(stringArray(proposal.benchmarkIds, "calibration.job.proposal.benchmarkIds"), REDUCED_CPU_ALL_TASKS)
	) {
		throw new Error("calibration must cover exactly all four reduced-study tasks");
	}
	if (proposal.budgetClass !== "smoke") throw new Error("calibration proposal budget mismatch");
	if (proposal.treatment !== REDUCED_CPU_CALIBRATION_TREATMENT) throw new Error("calibration treatment mismatch");
	if (proposal.candidateFormat !== "llvm-pass-sequence") throw new Error("calibration candidate format mismatch");
	if (proposal.requireFreshMeasurement !== true) throw new Error("calibration must require a fresh measurement");
	const candidate = record(proposal.candidate, "calibration.job.proposal.candidate");
	exactKeys(candidate, ["digest", "byteLength", "mediaType"], "calibration.job.proposal.candidate");
	if (candidate.digest !== sha256Text("[]") || candidate.byteLength !== 2) {
		throw new Error("calibration candidate must be the empty pass sequence");
	}
	if (candidate.mediaType !== "application/vnd.prime.llvm-pass-sequence") {
		throw new Error("calibration candidate media type mismatch");
	}
	const proposalDetails = record(proposal.proposal, "calibration.job.proposal.proposal");
	exactKeys(
		proposalDetails,
		["hypothesis", "mechanism", "predictedOutcome", "boundaryConditions", "parentJobIds"],
		"calibration.job.proposal.proposal",
	);
	if (stringArray(proposalDetails.parentJobIds, "calibration.job.proposal.proposal.parentJobIds").length !== 0) {
		throw new Error("calibration proposal must not have parents");
	}

	if (submitted.jobId !== jobId || submitted.manifestDigest !== manifestDigest || submitted.duplicate !== false) {
		throw new Error("calibration submitted identity or freshness mismatch");
	}
	if (typeof submitted.acceptedAt !== "string" || !Number.isFinite(Date.parse(submitted.acceptedAt))) {
		throw new Error("calibration.submitted.acceptedAt must be a timestamp");
	}
	const state = record(job.state, "calibration.job.state");
	exactKeys(state, ["jobId", "status", "statusAt", "externalJobId", "reason"], "calibration.job.state");
	if (state.jobId !== jobId || state.status !== "succeeded") throw new Error("calibration job did not succeed");
	if (typeof state.statusAt !== "string" || !Number.isFinite(Date.parse(state.statusAt))) {
		throw new Error("calibration job state timestamp is invalid");
	}
	if (state.externalJobId !== null && typeof state.externalJobId !== "string") {
		throw new Error("calibration external job ID must be a string or null");
	}
	if (state.reason !== null && typeof state.reason !== "string") {
		throw new Error("calibration state reason must be a string or null");
	}
	const measurement = record(job.measurement, "calibration.job.measurement");
	exactKeys(
		measurement,
		["jobId", "manifestDigest", "verifierEpoch", "measuredAt", "tasks", "hardware", "provenance", "stdout", "stderr"],
		"calibration.job.measurement",
	);
	if (measurement.jobId !== jobId || measurement.manifestDigest !== manifestDigest) {
		throw new Error("calibration measurement identity mismatch");
	}
	if (typeof measurement.measuredAt !== "string" || !Number.isFinite(Date.parse(measurement.measuredAt))) {
		throw new Error("calibration measuredAt is invalid");
	}
	if (measurement.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		throw new Error("calibration verifier epoch is not current");
	}
	const hardware = exactStringRecord(
		measurement.hardware,
		REDUCED_CPU_EXPECTED_HARDWARE,
		"calibration.job.measurement.hardware",
	);
	const provenance = exactStringRecord(
		measurement.provenance,
		REDUCED_CPU_EXPECTED_PROVENANCE,
		"calibration.job.measurement.provenance",
	);
	if (!Array.isArray(measurement.tasks) || measurement.tasks.length !== REDUCED_CPU_ALL_TASKS.length) {
		throw new Error("calibration measurement must contain exactly four task records");
	}
	const measurementTasks: unknown[] = measurement.tasks;
	const tasks = REDUCED_CPU_ALL_TASKS.map((benchmarkId) => {
		const matching = measurementTasks.filter((task) => isRecord(task) && task.benchmarkId === benchmarkId);
		if (matching.length !== 1) throw new Error(`calibration must contain exactly one ${benchmarkId} record`);
		return parseAcceptedTask(matching[0], benchmarkId, `calibration.task[${benchmarkId}]`);
	});
	return {
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		jobId,
		manifestDigest,
		tasks,
		hardware,
		provenance,
	};
}

function taskEvidenceById(
	candidate: ReducedCpuCandidateEvidence,
	benchmarkId: ReducedCpuSearchTask,
): ReducedCpuCandidateTaskEvidence | undefined {
	return candidate.tasks.find((task) => task.benchmarkId === benchmarkId);
}

function acceptedCandidateTaskEvidence(task: ReducedCpuCandidateTaskEvidence): boolean {
	return (
		task.irInstructionCount !== null &&
		Number.isSafeInteger(task.irInstructionCount) &&
		task.irInstructionCount >= 0 &&
		task.status === "accepted" &&
		task.verifierPassed
	);
}

export function isReducedCpuMeasuredVerifierRejection(candidate: ReducedCpuCandidateEvidence): boolean {
	if (candidate.verifierValid || candidate.invalidReasons.length === 0) return false;
	if (candidate.tasks.length !== REDUCED_CPU_SEARCH_TASKS.length) return false;
	const rejectedTasks: ReducedCpuSearchTask[] = [];
	for (const benchmarkId of REDUCED_CPU_SEARCH_TASKS) {
		const matches = candidate.tasks.filter((task) => task.benchmarkId === benchmarkId);
		if (matches.length !== 1) return false;
		const task = matches[0];
		if (acceptedCandidateTaskEvidence(task)) continue;
		if (task.status !== "rejected" || task.verifierPassed) return false;
		if (
			(task.irInstructionCount !== null &&
				(!Number.isSafeInteger(task.irInstructionCount) || task.irInstructionCount < 0)) ||
			(task.objectTextSizeBytes !== null &&
				(!Number.isSafeInteger(task.objectTextSizeBytes) || task.objectTextSizeBytes < 0))
		) {
			return false;
		}
		rejectedTasks.push(benchmarkId);
	}
	if (rejectedTasks.length === 0) return false;
	const expected = rejectedTasks.map((benchmarkId) => `${benchmarkId} is not verifier-valid measured evidence`).sort();
	return sameStringArray([...candidate.invalidReasons].sort(), expected);
}

export function buildReducedCpuCandidateEvidence(input: {
	job: JobView;
	candidateContent: string;
	arm: ReducedCpuStudyArm;
	branchId: string;
	ordinal: number;
	priorJobId: string | null;
	calibration: ReducedCpuCalibration;
}): ReducedCpuCandidateEvidence {
	if (!isSearchOrdinal(input.ordinal)) throw new Error("candidate ordinal must be 1 through 4");
	const { job } = input;
	const invalidReasons: string[] = [];
	let actions: string[] = [];
	try {
		actions = stringArray(JSON.parse(input.candidateContent) as unknown, "candidate actions");
		actions.forEach((action, index) => {
			validateAction(action, `candidate actions[${index}]`);
		});
	} catch (error) {
		invalidReasons.push(error instanceof Error ? error.message : String(error));
	}
	if (job.proposal.branchId !== input.branchId) invalidReasons.push("branch ID mismatch");
	if (job.proposal.lane !== "compiler-gym") invalidReasons.push("lane mismatch");
	if (job.proposal.budgetClass !== "smoke") invalidReasons.push("budget class mismatch");
	if (job.proposal.treatment !== reducedCpuSearchTreatment(input.arm)) invalidReasons.push("treatment mismatch");
	if (!sameStringSet(job.proposal.benchmarkIds, REDUCED_CPU_SEARCH_TASKS))
		invalidReasons.push("search task set mismatch");
	if (job.proposal.candidateFormat !== "llvm-pass-sequence") invalidReasons.push("candidate format mismatch");
	if (job.proposal.requireFreshMeasurement !== true) invalidReasons.push("fresh-measurement requirement is missing");
	if (job.proposal.candidate.digest !== sha256Text(input.candidateContent))
		invalidReasons.push("candidate digest mismatch");
	if (job.proposal.candidate.byteLength !== Buffer.byteLength(input.candidateContent)) {
		invalidReasons.push("candidate byte length mismatch");
	}
	if (job.proposal.candidate.mediaType !== "application/vnd.prime.llvm-pass-sequence") {
		invalidReasons.push("candidate media type mismatch");
	}
	const computedManifest = expectedManifestDigest(job);
	if (computedManifest !== job.proposal.manifestDigest) invalidReasons.push("proposal manifest digest mismatch");
	if (job.proposal.jobId !== `job_${computedManifest.slice(0, 24)}`) invalidReasons.push("proposal job ID mismatch");
	const expectedParents = expectedSearchParentJobIds(input.ordinal, input.priorJobId);
	if (!sameStringArray(job.proposal.proposal.parentJobIds, expectedParents)) invalidReasons.push("lineage mismatch");
	if (job.state.jobId !== job.proposal.jobId || job.state.status !== "succeeded") {
		invalidReasons.push("job state is not a succeeded matching identity");
	}
	if (!Number.isFinite(Date.parse(job.state.statusAt))) invalidReasons.push("job state timestamp is invalid");
	if (job.state.externalJobId !== null && typeof job.state.externalJobId !== "string") {
		invalidReasons.push("external job ID is invalid");
	}
	if (job.state.reason !== null && typeof job.state.reason !== "string")
		invalidReasons.push("job state reason is invalid");
	const measurement = job.measurement;
	if (!measurement) invalidReasons.push("measurement is missing");
	if (measurement && measurement.jobId !== job.proposal.jobId) invalidReasons.push("measurement job ID mismatch");
	if (measurement && measurement.manifestDigest !== job.proposal.manifestDigest) {
		invalidReasons.push("measurement manifest digest mismatch");
	}
	if (measurement?.reuse !== undefined) invalidReasons.push("measurement reuse is forbidden");
	if (measurement && measurement.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		invalidReasons.push("verifier epoch mismatch");
	}
	if (measurement && !Number.isFinite(Date.parse(measurement.measuredAt))) {
		invalidReasons.push("measurement timestamp is invalid");
	}
	if (measurement && sha256Json(measurement.hardware) !== sha256Json(input.calibration.hardware)) {
		invalidReasons.push("hardware differs from calibration");
	}
	if (measurement && sha256Json(measurement.provenance) !== sha256Json(input.calibration.provenance)) {
		invalidReasons.push("provenance differs from calibration");
	}
	if (
		measurement &&
		!sameStringSet(
			measurement.tasks.map((task) => task.benchmarkId),
			REDUCED_CPU_SEARCH_TASKS,
		)
	) {
		invalidReasons.push("measurement task set mismatch");
	}
	const tasks = REDUCED_CPU_SEARCH_TASKS.map((benchmarkId): ReducedCpuCandidateTaskEvidence => {
		const matches = measurement?.tasks.filter((task) => task.benchmarkId === benchmarkId) ?? [];
		if (matches.length !== 1) {
			invalidReasons.push(`${benchmarkId} does not have exactly one task record`);
			return {
				benchmarkId,
				irInstructionCount: null,
				objectTextSizeBytes: null,
				status: null,
				verifierPassed: false,
			};
		}
		const task = matches[0];
		const ir = task.metrics.IrInstructionCount;
		const objectSize = task.metrics.ObjectTextSizeBytes;
		const validMetrics =
			Number.isSafeInteger(ir) && Number(ir) >= 0 && Number.isSafeInteger(objectSize) && Number(objectSize) >= 0;
		if (
			task.status !== "accepted" ||
			!task.verifier.passed ||
			task.verifier.errors.length !== 0 ||
			!sameStringArray(task.verifier.checks, REDUCED_CPU_REQUIRED_VERIFIER_CHECKS) ||
			!validMetrics
		) {
			invalidReasons.push(`${benchmarkId} is not verifier-valid measured evidence`);
		}
		return {
			benchmarkId,
			irInstructionCount: Number.isSafeInteger(ir) && Number(ir) >= 0 ? Number(ir) : null,
			objectTextSizeBytes: Number.isSafeInteger(objectSize) && Number(objectSize) >= 0 ? Number(objectSize) : null,
			status: task.status,
			verifierPassed: task.verifier.passed,
		};
	});
	return {
		arm: input.arm,
		branchId: input.branchId,
		ordinal: input.ordinal,
		jobId: job.proposal.jobId,
		manifestDigest: job.proposal.manifestDigest,
		candidateDigest: job.proposal.candidate.digest,
		actions,
		parentJobIds: [...job.proposal.proposal.parentJobIds],
		verifierValid: invalidReasons.length === 0,
		tasks,
		invalidReasons: [...new Set(invalidReasons)],
	};
}

export function buildReducedCpuChampionValidationEvidence(input: {
	job: JobView;
	candidateContent: string;
	arm: ReducedCpuStudyArm;
	branchId: string;
	searchChampion: ReducedCpuCandidateEvidence;
	calibration: ReducedCpuCalibration;
}): ReducedCpuChampionValidationEvidence {
	const { job, searchChampion } = input;
	const invalidReasons: string[] = [];
	let actions: string[] = [];
	try {
		actions = stringArray(JSON.parse(input.candidateContent) as unknown, "validation candidate actions");
		actions.forEach((action, index) => {
			validateAction(action, `validation candidate actions[${index}]`);
		});
	} catch (error) {
		invalidReasons.push(error instanceof Error ? error.message : String(error));
	}
	if (searchChampion.arm !== input.arm || searchChampion.branchId !== input.branchId) {
		invalidReasons.push("search champion scope mismatch");
	}
	if (!searchChampion.verifierValid) invalidReasons.push("search champion is not verifier-valid");
	if (!sameStringArray(actions, searchChampion.actions))
		invalidReasons.push("validation candidate bytes differ from champion");
	if (job.proposal.branchId !== input.branchId) invalidReasons.push("validation branch ID mismatch");
	if (job.proposal.lane !== "compiler-gym") invalidReasons.push("validation lane mismatch");
	if (job.proposal.budgetClass !== "confirm") invalidReasons.push("validation budget class mismatch");
	if (job.proposal.treatment !== reducedCpuValidationTreatment(input.arm))
		invalidReasons.push("validation treatment mismatch");
	if (!sameStringArray(job.proposal.benchmarkIds, [REDUCED_CPU_VALIDATION_TASK])) {
		invalidReasons.push("validation task set mismatch");
	}
	if (job.proposal.candidateFormat !== "llvm-pass-sequence")
		invalidReasons.push("validation candidate format mismatch");
	if (job.proposal.requireFreshMeasurement !== true)
		invalidReasons.push("validation fresh-measurement requirement is missing");
	if (job.proposal.candidate.digest !== sha256Text(input.candidateContent)) {
		invalidReasons.push("validation candidate digest mismatch");
	}
	if (job.proposal.candidate.digest !== searchChampion.candidateDigest) {
		invalidReasons.push("validation candidate digest differs from champion");
	}
	if (job.proposal.candidate.byteLength !== Buffer.byteLength(input.candidateContent)) {
		invalidReasons.push("validation candidate byte length mismatch");
	}
	if (job.proposal.candidate.mediaType !== "application/vnd.prime.llvm-pass-sequence") {
		invalidReasons.push("validation candidate media type mismatch");
	}
	const computedManifest = expectedManifestDigest(job);
	if (computedManifest !== job.proposal.manifestDigest) invalidReasons.push("validation manifest digest mismatch");
	if (job.proposal.jobId !== `job_${computedManifest.slice(0, 24)}`) invalidReasons.push("validation job ID mismatch");
	if (!sameStringArray(job.proposal.proposal.parentJobIds, [searchChampion.jobId])) {
		invalidReasons.push("validation lineage mismatch");
	}
	if (job.state.jobId !== job.proposal.jobId || job.state.status !== "succeeded") {
		invalidReasons.push("validation job state is not a succeeded matching identity");
	}
	if (!Number.isFinite(Date.parse(job.state.statusAt))) invalidReasons.push("validation state timestamp is invalid");
	if (job.state.externalJobId !== null && typeof job.state.externalJobId !== "string") {
		invalidReasons.push("validation external job ID is invalid");
	}
	if (job.state.reason !== null && typeof job.state.reason !== "string") {
		invalidReasons.push("validation job state reason is invalid");
	}
	const measurement = job.measurement;
	if (!measurement) invalidReasons.push("validation measurement is missing");
	if (measurement && measurement.jobId !== job.proposal.jobId)
		invalidReasons.push("validation measurement job ID mismatch");
	if (measurement && measurement.manifestDigest !== job.proposal.manifestDigest) {
		invalidReasons.push("validation measurement manifest digest mismatch");
	}
	if (measurement?.reuse !== undefined) invalidReasons.push("validation measurement reuse is forbidden");
	if (measurement && measurement.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		invalidReasons.push("validation verifier epoch mismatch");
	}
	if (measurement && !Number.isFinite(Date.parse(measurement.measuredAt))) {
		invalidReasons.push("validation measurement timestamp is invalid");
	}
	if (measurement && sha256Json(measurement.hardware) !== sha256Json(input.calibration.hardware)) {
		invalidReasons.push("validation hardware differs from calibration");
	}
	if (measurement && sha256Json(measurement.provenance) !== sha256Json(input.calibration.provenance)) {
		invalidReasons.push("validation provenance differs from calibration");
	}
	const matches = measurement?.tasks.filter((task) => task.benchmarkId === REDUCED_CPU_VALIDATION_TASK) ?? [];
	if (measurement && (measurement.tasks.length !== 1 || matches.length !== 1)) {
		invalidReasons.push("validation measurement must contain exactly dijkstra");
	}
	const measuredTask = matches[0];
	const ir = measuredTask?.metrics.IrInstructionCount;
	const objectSize = measuredTask?.metrics.ObjectTextSizeBytes;
	const validMetrics =
		Number.isSafeInteger(ir) && Number(ir) >= 0 && Number.isSafeInteger(objectSize) && Number(objectSize) >= 0;
	if (
		!measuredTask ||
		measuredTask.status !== "accepted" ||
		!measuredTask.verifier.passed ||
		measuredTask.verifier.errors.length !== 0 ||
		!sameStringArray(measuredTask.verifier.checks, REDUCED_CPU_REQUIRED_VERIFIER_CHECKS) ||
		!validMetrics
	) {
		invalidReasons.push("dijkstra validation is not verifier-valid measured evidence");
	}
	return {
		arm: input.arm,
		branchId: input.branchId,
		searchChampionJobId: searchChampion.jobId,
		jobId: job.proposal.jobId,
		manifestDigest: job.proposal.manifestDigest,
		candidateDigest: job.proposal.candidate.digest,
		parentJobIds: [searchChampion.jobId],
		verifierValid: invalidReasons.length === 0,
		task: {
			benchmarkId: REDUCED_CPU_VALIDATION_TASK,
			irInstructionCount: Number.isSafeInteger(ir) && Number(ir) >= 0 ? Number(ir) : null,
			objectTextSizeBytes: Number.isSafeInteger(objectSize) && Number(objectSize) >= 0 ? Number(objectSize) : null,
			status: measuredTask?.status ?? null,
			verifierPassed: measuredTask?.verifier.passed ?? false,
		},
		invalidReasons: [...new Set(invalidReasons)],
	};
}

interface ExactRatio {
	numerator: number;
	denominator: number;
}

function compareRatio(left: ExactRatio, right: ExactRatio): number {
	if (left.denominator === 0 || right.denominator === 0) {
		const leftValue =
			left.denominator === 0
				? left.numerator === 0
					? 0
					: Number.POSITIVE_INFINITY
				: left.numerator / left.denominator;
		const rightValue =
			right.denominator === 0
				? right.numerator === 0
					? 0
					: Number.POSITIVE_INFINITY
				: right.numerator / right.denominator;
		return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
	}
	const leftProduct = BigInt(left.numerator) * BigInt(right.denominator);
	const rightProduct = BigInt(right.numerator) * BigInt(left.denominator);
	return leftProduct < rightProduct ? -1 : leftProduct > rightProduct ? 1 : 0;
}

function compareMeanRatios(left: readonly ExactRatio[], right: readonly ExactRatio[]): number {
	const commonDenominator = (ratios: readonly ExactRatio[]): bigint =>
		ratios.reduce((product, ratio) => product * BigInt(ratio.denominator), 1n);
	if (left.some((ratio) => ratio.denominator === 0) || right.some((ratio) => ratio.denominator === 0)) {
		const leftMean = left.reduce((sum, ratio) => sum + ratio.numerator / ratio.denominator, 0) / left.length;
		const rightMean = right.reduce((sum, ratio) => sum + ratio.numerator / ratio.denominator, 0) / right.length;
		return leftMean < rightMean ? -1 : leftMean > rightMean ? 1 : 0;
	}
	const leftDenominator = commonDenominator(left);
	const rightDenominator = commonDenominator(right);
	const leftNumerator = left.reduce(
		(sum, ratio) => sum + BigInt(ratio.numerator) * (leftDenominator / BigInt(ratio.denominator)),
		0n,
	);
	const rightNumerator = right.reduce(
		(sum, ratio) => sum + BigInt(ratio.numerator) * (rightDenominator / BigInt(ratio.denominator)),
		0n,
	);
	const leftProduct = leftNumerator * rightDenominator;
	const rightProduct = rightNumerator * leftDenominator;
	return leftProduct < rightProduct ? -1 : leftProduct > rightProduct ? 1 : 0;
}

export function selectReducedCpuChampion(
	arm: ReducedCpuStudyArm,
	candidates: readonly ReducedCpuCandidateEvidence[],
	calibration: ReducedCpuCalibration,
): ReducedCpuChampionSelection {
	const excluded: Array<{ jobId: string; reasons: string[] }> = [];
	const scored: Array<{ evidence: ReducedCpuChampionScore; ratios: ExactRatio[]; digest: string }> = [];
	for (const candidate of candidates) {
		const reasons = [...candidate.invalidReasons];
		if (candidate.arm !== arm) reasons.push("arm mismatch");
		const ratios = REDUCED_CPU_SEARCH_TASKS.map((benchmarkId): ExactRatio | null => {
			const task = taskEvidenceById(candidate, benchmarkId);
			const calibrationTask = calibration.tasks.find((item) => item.benchmarkId === benchmarkId);
			if (task?.irInstructionCount === null || task?.irInstructionCount === undefined || !calibrationTask)
				return null;
			return { numerator: task.irInstructionCount, denominator: calibrationTask.irInstructionCount };
		});
		if (ratios.some((ratio) => ratio === null)) reasons.push("normalized search evidence is incomplete");
		if (!candidate.verifierValid || reasons.length > 0) {
			excluded.push({ jobId: candidate.jobId, reasons: [...new Set(reasons)] });
			continue;
		}
		const exactRatios = ratios.filter((ratio): ratio is ExactRatio => ratio !== null);
		const worst = [...exactRatios].sort((left, right) => compareRatio(right, left))[0];
		const normalizedIrRatios = exactRatios.map((ratio, index) => ({
			benchmarkId: REDUCED_CPU_SEARCH_TASKS[index],
			...ratio,
			exact:
				ratio.denominator === 0
					? ratio.numerator === 0
						? "0/0"
						: "infinity"
					: `${ratio.numerator}/${ratio.denominator}`,
		}));
		scored.push({
			evidence: {
				jobId: candidate.jobId,
				worstNormalizedIrRatio:
					worst.denominator === 0 ? Number.POSITIVE_INFINITY : worst.numerator / worst.denominator,
				meanNormalizedIrRatio:
					exactRatios.reduce((sum, ratio) => sum + ratio.numerator / ratio.denominator, 0) / exactRatios.length,
				normalizedIrRatios,
			},
			ratios: exactRatios,
			digest: candidate.candidateDigest,
		});
	}
	const ranked = [...scored].sort((left, right) => {
		const leftWorst = [...left.ratios].sort((a, b) => compareRatio(b, a))[0];
		const rightWorst = [...right.ratios].sort((a, b) => compareRatio(b, a))[0];
		return (
			compareRatio(leftWorst, rightWorst) ||
			compareMeanRatios(left.ratios, right.ratios) ||
			left.digest.localeCompare(right.digest) ||
			left.evidence.jobId.localeCompare(right.evidence.jobId)
		);
	});
	return {
		policy: "worst-normalized-ir-then-mean-v1",
		arm,
		calibrationJobId: calibration.jobId,
		eligible: scored.map((item) => item.evidence),
		excluded,
		rankedJobIds: ranked.map((item) => item.evidence.jobId),
		selectedJobId: ranked[0]?.evidence.jobId ?? null,
	};
}

export function deriveReducedCpuSinglePassInsertion(
	base: readonly string[],
	candidate: readonly string[],
): { action: string; index: number } | null {
	if (candidate.length !== base.length + 1) return null;
	const matches: Array<{ action: string; index: number }> = [];
	for (let index = 0; index < candidate.length; index++) {
		const without = [...candidate.slice(0, index), ...candidate.slice(index + 1)];
		if (sameStringArray(without, base)) matches.push({ action: candidate[index], index });
	}
	return matches.length === 1 ? matches[0] : null;
}

export function classifyReducedCpuCandidateTwo(
	candidate1: ReducedCpuCandidateEvidence,
	candidate2: ReducedCpuCandidateEvidence,
): ReducedCpuCandidateTwoClassification {
	const reasons: string[] = [];
	if (candidate1.arm !== candidate2.arm) reasons.push("candidate arms differ");
	if (candidate1.branchId !== candidate2.branchId) reasons.push("candidate branches differ");
	if (candidate1.ordinal !== 1 || candidate2.ordinal !== 2) reasons.push("expected candidate ordinals 1 and 2");
	if (!sameStringArray(candidate2.parentJobIds, [candidate1.jobId]))
		reasons.push("candidate 2 lineage is not candidate 1");
	const insertion = deriveReducedCpuSinglePassInsertion(candidate1.actions, candidate2.actions);
	if (!insertion) reasons.push("candidate 2 is not one unambiguous pass insertion into candidate 1");
	const perTask = REDUCED_CPU_SEARCH_TASKS.map((benchmarkId) => {
		const first = taskEvidenceById(candidate1, benchmarkId)?.irInstructionCount ?? null;
		const second = taskEvidenceById(candidate2, benchmarkId)?.irInstructionCount ?? null;
		const delta = first === null || second === null ? null : second - first;
		return {
			benchmarkId,
			candidate1Ir: first,
			candidate2Ir: second,
			delta,
			nonImproving: delta !== null && delta >= 0,
		};
	});
	const verifierValid = candidate1.verifierValid && candidate2.verifierValid;
	if (!verifierValid) reasons.push("candidate 1 or candidate 2 is not verifier-valid");
	const nonImprovingOnAllTasks = perTask.every((task) => task.nonImproving);
	if (!nonImprovingOnAllTasks) reasons.push("candidate 2 is not non-improving on every search task");
	return {
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		arm: candidate2.arm,
		branchId: candidate2.branchId,
		candidate1JobId: candidate1.jobId,
		candidate2JobId: candidate2.jobId,
		candidate1Digest: candidate1.candidateDigest,
		candidate2Digest: candidate2.candidateDigest,
		candidate1Actions: [...candidate1.actions],
		verifierValid,
		exactSinglePassInsertion: insertion !== null,
		insertedAction: insertion?.action ?? null,
		insertionIndex: insertion?.index ?? null,
		perTask,
		nonImprovingOnAllTasks,
		eligibleForRetest: reasons.length === 0,
		reasons,
	};
}

export function buildReducedCpuRetestDirective(
	classification: ReducedCpuCandidateTwoClassification,
	candidate3: ReducedCpuCandidateEvidence,
): ReducedCpuRetestDirective {
	if (classification.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION) {
		throw new Error("candidate 2 classification protocol mismatch");
	}
	if (
		!classification.eligibleForRetest ||
		classification.insertedAction === null ||
		classification.insertionIndex === null
	) {
		throw new Error("candidate 2 is not eligible for a sealed retest");
	}
	if (classification.arm !== "M+R" || candidate3.arm !== "M+R")
		throw new Error("retest directives are limited to M+R");
	if (classification.branchId !== candidate3.branchId)
		throw new Error("candidate 3 branch differs from classification");
	if (!sameStringArray(candidate3.parentJobIds, [classification.candidate2JobId])) {
		throw new Error("candidate 3 lineage is not candidate 2");
	}
	if (candidate3.ordinal !== 3 || !candidate3.verifierValid)
		throw new Error("candidate 3 must be verifier-valid ordinal 3");
	if (sameStringArray(candidate3.actions, classification.candidate1Actions)) {
		throw new Error("candidate 3 must be a changed base relative to candidate 1");
	}
	if (classification.insertionIndex > candidate3.actions.length) {
		throw new Error("the sealed insertion index is outside candidate 3");
	}
	const actions = [...candidate3.actions];
	actions.splice(classification.insertionIndex, 0, classification.insertedAction);
	if (sameStringArray(actions, candidate3.actions)) throw new Error("retest must change candidate 3");
	return {
		schemaVersion: 1,
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		type: "reduced_cpu_host_retest_directive",
		arm: "M+R",
		branchId: candidate3.branchId,
		candidateOrdinal: 4,
		sourceCandidate1JobId: classification.candidate1JobId,
		sourceCandidate2JobId: classification.candidate2JobId,
		sourceCandidate1Digest: classification.candidate1Digest,
		sourceCandidate2Digest: classification.candidate2Digest,
		baseCandidate3JobId: candidate3.jobId,
		expectedParentJobIds: [candidate3.jobId],
		insertedAction: classification.insertedAction,
		insertionIndex: classification.insertionIndex,
		baseCandidate3Digest: candidate3.candidateDigest,
		actions,
		candidateDigest: sha256Text(JSON.stringify(actions)),
	};
}

export function maybeBuildReducedCpuRetestDirective(
	classification: ReducedCpuCandidateTwoClassification,
	candidate3: ReducedCpuCandidateEvidence,
): ReducedCpuRetestDirective | null {
	if (classification.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION) {
		throw new Error("candidate 2 classification protocol mismatch");
	}
	if (classification.arm !== "M+R" || candidate3.arm !== "M+R") {
		throw new Error("retest directives are limited to M+R");
	}
	if (classification.branchId !== candidate3.branchId) {
		throw new Error("candidate 3 branch differs from classification");
	}
	if (candidate3.ordinal !== 3) throw new Error("retest base must be candidate 3");
	if (!sameStringArray(candidate3.parentJobIds, [classification.candidate2JobId])) {
		throw new Error("candidate 3 lineage is not candidate 2");
	}
	if (
		!classification.exactSinglePassInsertion ||
		classification.insertedAction === null ||
		classification.insertionIndex === null
	) {
		throw new Error("candidate 2 violates the common exact one-pass insertion contract");
	}
	if (!classification.verifierValid || !classification.nonImprovingOnAllTasks) return null;
	if (!classification.eligibleForRetest) {
		throw new Error("candidate 2 classification contains non-scientific eligibility failures");
	}
	if (!candidate3.verifierValid) return null;
	if (sameStringArray(candidate3.actions, classification.candidate1Actions)) return null;
	if (classification.insertionIndex > candidate3.actions.length) return null;
	return buildReducedCpuRetestDirective(classification, candidate3);
}

export function sealReducedCpuRetestDirective(directive: ReducedCpuRetestDirective): SealedReducedCpuRetestDirective {
	return { directive: structuredClone(directive), directiveSha256: sha256Json(directive) };
}

export function parseSealedReducedCpuRetestDirective(value: unknown): SealedReducedCpuRetestDirective {
	const sealed = record(value, "sealed retest directive");
	exactKeys(sealed, ["directive", "directiveSha256"], "sealed retest directive");
	const directive = record(sealed.directive, "sealed retest directive.directive");
	exactKeys(directive, RETEST_DIRECTIVE_KEYS, "sealed retest directive.directive");
	if (directive.schemaVersion !== 1 || directive.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION) {
		throw new Error("sealed retest directive version mismatch");
	}
	if (directive.type !== "reduced_cpu_host_retest_directive" || directive.arm !== "M+R") {
		throw new Error("sealed retest directive type or arm mismatch");
	}
	if (directive.candidateOrdinal !== 4) throw new Error("sealed retest directive must target candidate 4");
	const insertionIndex = safeNonnegativeInteger(directive.insertionIndex, "directive.insertionIndex");
	const actions = stringArray(directive.actions, "directive.actions");
	actions.forEach((action, index) => {
		validateAction(action, `directive.actions[${index}]`);
	});
	const expectedParentJobIds = stringArray(directive.expectedParentJobIds, "directive.expectedParentJobIds");
	if (expectedParentJobIds.length !== 1 || expectedParentJobIds[0] !== directive.baseCandidate3JobId) {
		throw new Error("sealed retest directive parent lineage mismatch");
	}
	const parsed: ReducedCpuRetestDirective = {
		schemaVersion: 1,
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		type: "reduced_cpu_host_retest_directive",
		arm: "M+R",
		branchId: nonemptyString(directive.branchId, "directive.branchId"),
		candidateOrdinal: 4,
		sourceCandidate1JobId: nonemptyString(directive.sourceCandidate1JobId, "directive.sourceCandidate1JobId"),
		sourceCandidate2JobId: nonemptyString(directive.sourceCandidate2JobId, "directive.sourceCandidate2JobId"),
		sourceCandidate1Digest: sha256(directive.sourceCandidate1Digest, "directive.sourceCandidate1Digest"),
		sourceCandidate2Digest: sha256(directive.sourceCandidate2Digest, "directive.sourceCandidate2Digest"),
		baseCandidate3JobId: nonemptyString(directive.baseCandidate3JobId, "directive.baseCandidate3JobId"),
		expectedParentJobIds: [expectedParentJobIds[0]],
		insertedAction: nonemptyString(directive.insertedAction, "directive.insertedAction"),
		insertionIndex,
		baseCandidate3Digest: sha256(directive.baseCandidate3Digest, "directive.baseCandidate3Digest"),
		actions,
		candidateDigest: sha256(directive.candidateDigest, "directive.candidateDigest"),
	};
	validateAction(parsed.insertedAction, "directive.insertedAction");
	if (parsed.candidateDigest !== sha256Text(JSON.stringify(parsed.actions))) {
		throw new Error("sealed retest directive candidate digest mismatch");
	}
	const directiveSha256 = sha256(sealed.directiveSha256, "sealed retest directive.directiveSha256");
	if (directiveSha256 !== sha256Json(parsed)) throw new Error("sealed retest directive hash mismatch");
	return { directive: parsed, directiveSha256 };
}

export function assessReducedCpuResurrection(input: {
	classification: ReducedCpuCandidateTwoClassification;
	candidate3: ReducedCpuCandidateEvidence;
	candidate4: ReducedCpuCandidateEvidence;
	sealedDirective: SealedReducedCpuRetestDirective;
	calibration: ReducedCpuCalibration;
}): ReducedCpuResurrectionAssessment {
	const reasons: string[] = [];
	let exactDirectiveReapplication = false;
	try {
		const rebuilt = sealReducedCpuRetestDirective(
			buildReducedCpuRetestDirective(input.classification, input.candidate3),
		);
		exactDirectiveReapplication =
			rebuilt.directiveSha256 === input.sealedDirective.directiveSha256 &&
			sha256Json(rebuilt.directive) === sha256Json(input.sealedDirective.directive) &&
			input.candidate4.ordinal === 4 &&
			input.candidate4.arm === "M+R" &&
			input.candidate4.branchId === input.candidate3.branchId &&
			sameStringArray(input.candidate4.parentJobIds, input.sealedDirective.directive.expectedParentJobIds) &&
			sameStringArray(input.candidate4.actions, input.sealedDirective.directive.actions) &&
			input.candidate4.candidateDigest === input.sealedDirective.directive.candidateDigest;
	} catch (error) {
		reasons.push(error instanceof Error ? error.message : String(error));
	}
	if (!exactDirectiveReapplication) reasons.push("candidate 4 is not the exact sealed insertion into candidate 3");
	const candidate4SemanticVerifierPassed = input.candidate4.verifierValid;
	const candidate4SemanticVerifierRejected = isReducedCpuMeasuredVerifierRejection(input.candidate4);
	const compatibleFreshVerifierEvidence =
		input.candidate3.verifierValid && (candidate4SemanticVerifierPassed || candidate4SemanticVerifierRejected);
	if (!compatibleFreshVerifierEvidence)
		reasons.push("candidate 3 or candidate 4 lacks compatible fresh integrity-bound verifier evidence");
	if (candidate4SemanticVerifierRejected) reasons.push("candidate 4 is semantically verifier-rejected");
	const perTask = REDUCED_CPU_SEARCH_TASKS.map((benchmarkId) => {
		const third = taskEvidenceById(input.candidate3, benchmarkId)?.irInstructionCount ?? null;
		const fourth = taskEvidenceById(input.candidate4, benchmarkId)?.irInstructionCount ?? null;
		const delta = third === null || fourth === null ? null : fourth - third;
		const calibrationIr = input.calibration.tasks.find(
			(task) => task.benchmarkId === benchmarkId,
		)?.irInstructionCount;
		if (calibrationIr === undefined) throw new Error(`missing resurrection calibration for ${benchmarkId}`);
		const practicalDelta = practicalReducedCpuDelta(calibrationIr);
		return {
			benchmarkId,
			candidate3Ir: third,
			candidate4Ir: fourth,
			delta,
			practicalDelta,
			nonWorse: delta !== null && delta <= 0,
			strictlyImproves: delta !== null && delta < 0,
			practicallyImproves: delta !== null && delta <= -practicalDelta,
		};
	});
	const nonWorseOnAllTasks = perTask.every((task) => task.nonWorse);
	const strictlyImprovesAtLeastOneTask = perTask.some((task) => task.strictlyImproves);
	const practicallyImprovesAtLeastOneTask = perTask.some((task) => task.practicallyImproves);
	const executionValid = exactDirectiveReapplication && compatibleFreshVerifierEvidence;
	const resurrectionSucceeded =
		executionValid && candidate4SemanticVerifierPassed && nonWorseOnAllTasks && practicallyImprovesAtLeastOneTask;
	if (!nonWorseOnAllTasks) reasons.push("reapplied pass worsens candidate 3 on at least one search task");
	if (!practicallyImprovesAtLeastOneTask) {
		reasons.push("reapplied pass does not practically improve candidate 3 on any search task");
	}
	return {
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		arm: "M+R",
		branchId: input.candidate3.branchId,
		directiveSha256: input.sealedDirective.directiveSha256,
		candidate3JobId: input.candidate3.jobId,
		candidate4JobId: input.candidate4.jobId,
		exactDirectiveReapplication,
		compatibleFreshVerifierEvidence,
		candidate4SemanticVerifierPassed,
		perTask,
		nonWorseOnAllTasks,
		strictlyImprovesAtLeastOneTask,
		practicallyImprovesAtLeastOneTask,
		executionValid,
		resurrectionSucceeded,
		gatePassed: resurrectionSucceeded,
		reasons: [...new Set(reasons)],
	};
}

export function practicalReducedCpuDelta(calibrationIr: number): number {
	if (!Number.isSafeInteger(calibrationIr) || calibrationIr < 0) {
		throw new Error("calibration IR must be a nonnegative safe integer");
	}
	return Math.max(3, calibrationIr * 0.005);
}

function completeBlockTaskValues(
	block: ReducedCpuArmBlock,
): { jobId: string; values: Map<ReducedCpuTask, number> } | null {
	const selectedJobId = block.championSelection.selectedJobId;
	const selected = block.candidates.find((candidate) => candidate.jobId === selectedJobId);
	if (!selected || !selected.verifierValid || !block.validation?.verifierValid) return null;
	if (
		block.validation.arm !== block.arm ||
		block.validation.branchId !== block.branchId ||
		block.validation.searchChampionJobId !== selected.jobId ||
		block.validation.candidateDigest !== selected.candidateDigest ||
		!sameStringArray(block.validation.parentJobIds, [selected.jobId])
	) {
		return null;
	}
	const values = new Map<ReducedCpuTask, number>();
	for (const task of selected.tasks) {
		if (task.irInstructionCount === null) return null;
		values.set(task.benchmarkId, task.irInstructionCount);
	}
	const validationIr = block.validation.task.irInstructionCount;
	if (validationIr === null) return null;
	values.set(REDUCED_CPU_VALIDATION_TASK, validationIr);
	return { jobId: selected.jobId, values };
}

function compareBlockScores(
	left: { arm: ReducedCpuStudyArm; values: Map<ReducedCpuTask, number> },
	right: { arm: ReducedCpuStudyArm; values: Map<ReducedCpuTask, number> },
	calibration: ReducedCpuCalibration,
): number {
	const ratios = (block: { values: Map<ReducedCpuTask, number> }): ExactRatio[] =>
		REDUCED_CPU_ALL_TASKS.map((benchmarkId) => ({
			numerator: block.values.get(benchmarkId) ?? Number.MAX_SAFE_INTEGER,
			denominator: calibration.tasks.find((task) => task.benchmarkId === benchmarkId)?.irInstructionCount ?? 0,
		}));
	const leftRatios = ratios(left);
	const rightRatios = ratios(right);
	const leftWorst = [...leftRatios].sort((a, b) => compareRatio(b, a))[0];
	const rightWorst = [...rightRatios].sort((a, b) => compareRatio(b, a))[0];
	return (
		compareRatio(leftWorst, rightWorst) ||
		compareMeanRatios(leftRatios, rightRatios) ||
		REDUCED_CPU_STUDY_ARMS.indexOf(left.arm) - REDUCED_CPU_STUDY_ARMS.indexOf(right.arm)
	);
}

function measuredRecallReceiptIsValid(block: ReducedCpuArmBlock): boolean {
	if (block.arm === "stock") return block.recallReceipt === null;
	const receipt = block.recallReceipt;
	const candidate1 = block.candidates.find((candidate) => candidate.ordinal === 1);
	const candidate2 = block.candidates.find((candidate) => candidate.ordinal === 2);
	const candidate3 = block.candidates.find((candidate) => candidate.ordinal === 3);
	return (
		receipt !== null &&
		receipt.schemaVersion === 1 &&
		receipt.protocolVersion === REDUCED_CPU_STUDY_PROTOCOL_VERSION &&
		receipt.type === "reduced_cpu_measured_recall_receipt" &&
		receipt.arm === block.arm &&
		receipt.branchId === block.branchId &&
		receipt.verified === true &&
		candidate1 !== undefined &&
		candidate2 !== undefined &&
		candidate3 !== undefined &&
		sameStringArray(receipt.recalledJobIds, [candidate1.jobId, candidate2.jobId]) &&
		receipt.candidate3JobId === candidate3.jobId &&
		Number.isSafeInteger(receipt.compactionEventSequence) &&
		receipt.compactionEventSequence >= 0 &&
		Number.isSafeInteger(receipt.recallEventSequence) &&
		receipt.recallEventSequence >= 0 &&
		Number.isSafeInteger(receipt.candidate3ProviderRequestSequence) &&
		receipt.candidate3ProviderRequestSequence >= 0 &&
		receipt.compactionEventSequence < receipt.recallEventSequence &&
		receipt.recallEventSequence < receipt.candidate3ProviderRequestSequence &&
		/^[a-f0-9]{64}$/.test(receipt.recallResultSha256) &&
		receipt.providerIncludedRecallSha256 === receipt.recallResultSha256
	);
}

function transferEligibilityAgainst(
	challenger: ReducedCpuArmBlock,
	reference: ReducedCpuArmBlock,
	calibration: ReducedCpuCalibration,
): {
	challengerArm: "M" | "M+R";
	referenceArm: "stock" | "M";
	standardPathPassed: boolean;
	earlyDominancePathPassed: boolean;
	passed: boolean;
} {
	if (challenger.arm === "stock" || reference.arm === "M+R") {
		throw new Error("invalid transfer eligibility comparison");
	}
	const challengerFinal = completeBlockTaskValues(challenger);
	const referenceFinal = completeBlockTaskValues(reference);
	if (!challengerFinal || !referenceFinal) throw new Error("transfer comparison requires complete blocks");
	const challengerSelected = challenger.candidates.find(
		(candidate) => candidate.jobId === challenger.championSelection.selectedJobId,
	);
	const referenceSelected = reference.candidates.find(
		(candidate) => candidate.jobId === reference.championSelection.selectedJobId,
	);
	if (!challengerSelected || !referenceSelected) throw new Error("transfer comparison champion is missing");
	const preCompactionSelection = selectReducedCpuChampion(
		challenger.arm,
		challenger.candidates.filter((candidate) => candidate.ordinal <= 2),
		calibration,
	);
	const preCompactionChampion = challenger.candidates.find(
		(candidate) => candidate.jobId === preCompactionSelection.selectedJobId,
	);
	const postCompactionContribution =
		challengerSelected.ordinal >= 3 &&
		preCompactionChampion !== undefined &&
		REDUCED_CPU_SEARCH_TASKS.every((task) => {
			const selectedIr = taskEvidenceById(challengerSelected, task)?.irInstructionCount;
			const priorIr = taskEvidenceById(preCompactionChampion, task)?.irInstructionCount;
			return (
				selectedIr !== null &&
				selectedIr !== undefined &&
				priorIr !== null &&
				priorIr !== undefined &&
				selectedIr <= priorIr
			);
		}) &&
		REDUCED_CPU_SEARCH_TASKS.some((task) => {
			const selectedIr = taskEvidenceById(challengerSelected, task)?.irInstructionCount;
			const priorIr = taskEvidenceById(preCompactionChampion, task)?.irInstructionCount;
			return (
				selectedIr !== null &&
				selectedIr !== undefined &&
				priorIr !== null &&
				priorIr !== undefined &&
				selectedIr < priorIr
			);
		});
	const mechanismGate =
		measuredRecallReceiptIsValid(challenger) &&
		(challenger.arm === "M+R" ? challenger.resurrection?.resurrectionSucceeded === true : true);
	const searchRawNonWorse = REDUCED_CPU_SEARCH_TASKS.every(
		(task) =>
			(challengerFinal.values.get(task) ?? Number.POSITIVE_INFINITY) <= (referenceFinal.values.get(task) ?? -1),
	);
	const practicalSearchImprovement = REDUCED_CPU_SEARCH_TASKS.some((task) => {
		const challengerIr = challengerFinal.values.get(task);
		const referenceIr = referenceFinal.values.get(task);
		const calibrationIr = calibration.tasks.find((item) => item.benchmarkId === task)?.irInstructionCount;
		return (
			challengerIr !== undefined &&
			referenceIr !== undefined &&
			calibrationIr !== undefined &&
			referenceIr - challengerIr >= practicalReducedCpuDelta(calibrationIr)
		);
	});
	const validationRawNonWorse =
		(challengerFinal.values.get(REDUCED_CPU_VALIDATION_TASK) ?? Number.POSITIVE_INFINITY) <=
		(referenceFinal.values.get(REDUCED_CPU_VALIDATION_TASK) ?? -1);
	const standardPathPassed =
		postCompactionContribution &&
		mechanismGate &&
		searchRawNonWorse &&
		practicalSearchImprovement &&
		validationRawNonWorse;

	const early = challenger.candidates.find((candidate) => candidate.ordinal === 3 && candidate.verifierValid);
	const earlyDominatesReference =
		early !== undefined &&
		referenceSelected.ordinal === 4 &&
		REDUCED_CPU_SEARCH_TASKS.every((task) => {
			const earlyIr = taskEvidenceById(early, task)?.irInstructionCount;
			const referenceIr = referenceFinal.values.get(task);
			return earlyIr !== null && earlyIr !== undefined && referenceIr !== undefined && earlyIr <= referenceIr;
		}) &&
		REDUCED_CPU_SEARCH_TASKS.some((task) => {
			const earlyIr = taskEvidenceById(early, task)?.irInstructionCount;
			const referenceIr = referenceFinal.values.get(task);
			return earlyIr !== null && earlyIr !== undefined && referenceIr !== undefined && earlyIr < referenceIr;
		}) &&
		challenger.candidates
			.filter((candidate) => candidate.ordinal <= 2)
			.every((candidate) =>
				REDUCED_CPU_SEARCH_TASKS.some((task) => {
					const candidateIr = taskEvidenceById(candidate, task)?.irInstructionCount;
					const referenceIr = referenceFinal.values.get(task);
					return (
						candidateIr === null ||
						candidateIr === undefined ||
						referenceIr === undefined ||
						candidateIr > referenceIr
					);
				}),
			);
	const finalRawNonWorse = REDUCED_CPU_ALL_TASKS.every(
		(task) =>
			(challengerFinal.values.get(task) ?? Number.POSITIVE_INFINITY) <= (referenceFinal.values.get(task) ?? -1),
	);
	const earlyDominancePathPassed =
		postCompactionContribution && mechanismGate && earlyDominatesReference && finalRawNonWorse;
	return {
		challengerArm: challenger.arm,
		referenceArm: reference.arm,
		standardPathPassed,
		earlyDominancePathPassed,
		passed: standardPathPassed || earlyDominancePathPassed,
	};
}

export function decideReducedCpuBlockComparisons(
	blocks: readonly ReducedCpuArmBlock[],
	calibration: ReducedCpuCalibration,
): ReducedCpuBlockComparisonDecision {
	const invalidReasons: string[] = [];
	const byArm = new Map<ReducedCpuStudyArm, ReducedCpuArmBlock>();
	for (const block of blocks) {
		if (byArm.has(block.arm)) invalidReasons.push(`duplicate block for ${block.arm}`);
		else byArm.set(block.arm, block);
	}
	for (const arm of REDUCED_CPU_STUDY_ARMS) {
		const block = byArm.get(arm);
		if (!block) {
			invalidReasons.push(`missing block for ${arm}`);
			continue;
		}
		if (block.candidates.length !== REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM) {
			invalidReasons.push(`${arm} does not contain exactly four search candidates`);
		}
		const orderedCandidates = [...block.candidates].sort((left, right) => left.ordinal - right.ordinal);
		if (
			!sameStringArray(
				orderedCandidates.map((candidate) => String(candidate.ordinal)),
				["1", "2", "3", "4"],
			) ||
			new Set(orderedCandidates.map((candidate) => candidate.jobId)).size !== REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM
		) {
			invalidReasons.push(`${arm} candidate ordinals or job identities are not unique and complete`);
		}
		for (let index = 0; index < orderedCandidates.length; index++) {
			const expectedParents = index === 0 ? [] : [orderedCandidates[index - 1].jobId];
			if (!sameStringArray(orderedCandidates[index].parentJobIds, expectedParents)) {
				invalidReasons.push(`${arm} candidate lineage is not the exact four-job chain`);
				break;
			}
			if (
				!orderedCandidates[index].verifierValid &&
				!isReducedCpuMeasuredVerifierRejection(orderedCandidates[index])
			) {
				invalidReasons.push(`${arm} candidate ${orderedCandidates[index].ordinal} has apparatus-invalid evidence`);
			}
		}
		if (
			orderedCandidates.length >= 2 &&
			deriveReducedCpuSinglePassInsertion(orderedCandidates[0].actions, orderedCandidates[1].actions) === null
		) {
			invalidReasons.push(`${arm} candidate 2 is not candidate 1 plus one exact unambiguous pass insertion`);
		}
		if (block.candidates.some((candidate) => candidate.arm !== arm || candidate.branchId !== block.branchId)) {
			invalidReasons.push(`${arm} candidate scope mismatch`);
		}
		const recomputedSelection = selectReducedCpuChampion(arm, block.candidates, calibration);
		if (sha256Json(recomputedSelection) !== sha256Json(block.championSelection)) {
			invalidReasons.push(`${arm} champion selection does not match the deterministic policy`);
		}
		if (arm !== "M+R" && block.resurrection !== null) {
			invalidReasons.push(`${arm} must not contain M+R resurrection evidence`);
		}
		if (!measuredRecallReceiptIsValid(block)) {
			invalidReasons.push(
				arm === "stock"
					? "stock must not contain a measured-recall receipt"
					: `${arm} lacks an exact compaction-to-recall-to-candidate-3 receipt`,
			);
		}
		if (arm === "M+R" && orderedCandidates.length === REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM) {
			try {
				const classification = classifyReducedCpuCandidateTwo(orderedCandidates[0], orderedCandidates[1]);
				const expectedDirective = maybeBuildReducedCpuRetestDirective(classification, orderedCandidates[2]);
				if (expectedDirective === null) {
					if (block.resurrection !== null) {
						invalidReasons.push("M+R contains resurrection evidence although the retest was dormant");
					}
				} else if (block.resurrection === null) {
					invalidReasons.push("M+R omitted an eligible host retest");
				} else {
					const recomputed = assessReducedCpuResurrection({
						classification,
						candidate3: orderedCandidates[2],
						candidate4: orderedCandidates[3],
						sealedDirective: sealReducedCpuRetestDirective(expectedDirective),
						calibration,
					});
					if (sha256Json(recomputed) !== sha256Json(block.resurrection)) {
						invalidReasons.push("M+R resurrection assessment does not match the canonical recomputation");
					} else if (!recomputed.executionValid) {
						invalidReasons.push("M+R host retest execution is invalid");
					}
				}
			} catch (error) {
				invalidReasons.push(
					`M+R retest contract invalid: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (!completeBlockTaskValues(block))
			invalidReasons.push(`${arm} lacks a verified selected champion and dijkstra validation`);
	}
	if (invalidReasons.length > 0) {
		return {
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			valid: false,
			invalidReasons,
			practicalDeltaPolicy: "max-3-ir-or-half-percent-calibration-v1",
			pairwise: [],
			rankedArms: [],
			descriptiveBestArm: null,
			transferEligibility: [],
			transferEligibleArm: null,
		};
	}
	const complete = REDUCED_CPU_STUDY_ARMS.map((arm) => {
		const block = byArm.get(arm);
		if (!block) throw new Error(`missing validated block for ${arm}`);
		const values = completeBlockTaskValues(block);
		if (!values) throw new Error(`incomplete validated block for ${arm}`);
		return { arm, ...values };
	});
	const pairwise: ReducedCpuPairwiseBlockComparison[] = [];
	for (let leftIndex = 0; leftIndex < complete.length; leftIndex++) {
		for (let rightIndex = leftIndex + 1; rightIndex < complete.length; rightIndex++) {
			const left = complete[leftIndex];
			const right = complete[rightIndex];
			const tasks = REDUCED_CPU_ALL_TASKS.map((benchmarkId) => {
				const leftIr = left.values.get(benchmarkId);
				const rightIr = right.values.get(benchmarkId);
				const calibrationIr = calibration.tasks.find(
					(task) => task.benchmarkId === benchmarkId,
				)?.irInstructionCount;
				if (leftIr === undefined || rightIr === undefined || calibrationIr === undefined) {
					throw new Error(`missing comparison evidence for ${benchmarkId}`);
				}
				return {
					benchmarkId,
					leftIr,
					rightIr,
					leftImprovement: rightIr - leftIr,
					practicalDelta: practicalReducedCpuDelta(calibrationIr),
				};
			});
			const leftNonWorse = tasks.every((task) => task.leftImprovement >= -task.practicalDelta);
			const leftStrict = tasks.some((task) => task.leftImprovement >= task.practicalDelta);
			const rightNonWorse = tasks.every((task) => task.leftImprovement <= task.practicalDelta);
			const rightStrict = tasks.some((task) => task.leftImprovement <= -task.practicalDelta);
			const decision =
				leftNonWorse && leftStrict
					? "left-practical-win"
					: rightNonWorse && rightStrict
						? "right-practical-win"
						: tasks.every((task) => Math.abs(task.leftImprovement) < task.practicalDelta)
							? "practical-tie"
							: "mixed";
			pairwise.push({
				leftArm: left.arm,
				rightArm: right.arm,
				leftJobId: left.jobId,
				rightJobId: right.jobId,
				tasks,
				decision,
			});
		}
	}
	const ranked = [...complete].sort((left, right) => compareBlockScores(left, right, calibration));
	const stockBlock = byArm.get("stock");
	const measuredBlock = byArm.get("M");
	const retestBlock = byArm.get("M+R");
	if (!stockBlock || !measuredBlock || !retestBlock) throw new Error("validated blocks disappeared");
	const measuredVsStock = transferEligibilityAgainst(measuredBlock, stockBlock, calibration);
	const retestVsStock = transferEligibilityAgainst(retestBlock, stockBlock, calibration);
	const retestVsMeasured = transferEligibilityAgainst(retestBlock, measuredBlock, calibration);
	const transferEligibleArm: ReducedCpuStudyArm | null =
		retestVsStock.passed && retestVsMeasured.passed ? "M+R" : measuredVsStock.passed ? "M" : null;
	return {
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		valid: true,
		invalidReasons: [],
		practicalDeltaPolicy: "max-3-ir-or-half-percent-calibration-v1",
		pairwise,
		rankedArms: ranked.map((item) => item.arm),
		descriptiveBestArm: ranked[0]?.arm ?? null,
		transferEligibility: [measuredVsStock, retestVsStock, retestVsMeasured],
		transferEligibleArm,
	};
}

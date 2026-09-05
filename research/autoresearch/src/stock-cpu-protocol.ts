import assert from "node:assert/strict";
import { sha256Json, sha256Text } from "./canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "./compiler-gym-adapter.js";
import type { ArtifactRef, JobView, ProposalRecord, TaskMeasurement } from "./types.js";

export const STOCK_CPU_BRANCH_ID = "stock-prime-core-cpu-smoke-v2";
export const STOCK_CPU_TREATMENT = "stock-prime-core-isolated";
export const STOCK_CPU_PROTOCOL_VERSION = "stock-prime-core-compiler-gym-v2";
export const STOCK_CPU_MAX_SUBMISSIONS = 4;
export const STOCK_CPU_TASKS = ["benchmark://cbench-v1/blowfish", "benchmark://cbench-v1/bzip2"] as const;

export const STOCK_CPU_CHAMPION_POLICY = {
	id: "accepted-v2-pareto-minimax-ir-v1",
	eligibility:
		"A candidate must be a succeeded stock-branch job with exact task coverage, accepted verifier-passed task records, nonnegative safe-integer IR and object-size metrics, internally consistent job and manifest IDs, and exact CompilerGym v2 provenance.",
	paretoRule: "Remove every candidate dominated on raw IrInstructionCount across the complete fixed task set.",
	objective:
		"On the Pareto frontier, lexicographically minimize the task-local IrInstructionCount/calibration ratios sorted from worst to best.",
	tieBreakers: ["raw IrInstructionCount vector in STOCK_CPU_TASKS order", "candidate digest", "job ID"],
} as const;

export interface StockCpuEvaluationRequest {
	actions: string[];
	hypothesis: string;
	mechanism: string;
	predictedOutcome: string;
	boundaryConditions: string[];
}

export interface StockCpuProvenance extends Record<string, string> {
	adapter: "farmshare-compiler-gym";
	evaluatorSha256: string;
	environmentSpecSha256: typeof COMPILER_GYM_ENVIRONMENT_SPEC_SHA256;
	cbenchPatchSha256: typeof COMPILER_GYM_CBENCH_PATCH_SHA256;
	upstreamCbenchSourceSha256: typeof COMPILER_GYM_UPSTREAM_CBENCH_SHA256;
	installedCbenchSourceSha256: typeof COMPILER_GYM_INSTALLED_CBENCH_SHA256;
	distributionManifestSha256: typeof COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256;
	compatibilityTreeManifestSha256: typeof COMPILER_GYM_COMPATIBILITY_TREE_SHA256;
	libtinfoSha256: typeof COMPILER_GYM_LIBTINFO_SHA256;
	compilerGym: "0.2.5";
	llvm: "10.0.0";
}

export interface StockCpuTaskEvidence {
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	irInstructionCount: number;
	objectTextSizeBytes: number;
	verifierPassed: true;
}

export interface StockCpuCalibration {
	jobId: string;
	manifestDigest: string;
	tasks: StockCpuTaskEvidence[];
	provenance: StockCpuProvenance;
}

export interface StockCpuCandidateSelectionEvidence {
	jobId: string;
	candidateDigest: string;
	irInstructionCounts: Record<string, number>;
	objectTextSizeBytes: Record<string, number>;
	normalizedIrRatios: Array<{
		benchmarkId: string;
		numerator: number;
		denominator: number;
		exact: string;
	}>;
}

export interface StockCpuChampionSelection {
	policy: typeof STOCK_CPU_CHAMPION_POLICY;
	expectedVerifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
	expectedProvenance: StockCpuProvenance;
	calibrationJobId: string;
	eligibleCandidates: StockCpuCandidateSelectionEvidence[];
	excludedCandidates: Array<{ jobId: string; reasons: string[] }>;
	paretoFrontierJobIds: string[];
	rankedParetoJobIds: string[];
	selectedJobId: string | null;
}

export interface StockCpuCompletionGate {
	requiredJobs: typeof STOCK_CPU_MAX_SUBMISSIONS;
	requiredAcceptedV2TaskRecords: number;
	observedJobs: number;
	terminalJobs: number;
	durableMeasurementJobs: number;
	observedTaskRecords: number;
	acceptedV2TaskRecords: number;
	fullyAcceptedJobIds: string[];
	rejectedJobs: Array<{ jobId: string; reasons: string[] }>;
	passed: boolean;
}

export interface StockCpuSelectionScope {
	branchId: string;
	treatment: string;
	requireFreshMeasurements: boolean;
}

export type StockCpuSelectionScopeOptions = Partial<StockCpuSelectionScope>;

export const STOCK_CPU_DEFAULT_SELECTION_SCOPE: StockCpuSelectionScope = {
	branchId: STOCK_CPU_BRANCH_ID,
	treatment: STOCK_CPU_TREATMENT,
	requireFreshMeasurements: false,
};

const REQUEST_KEYS = new Set(["actions", "hypothesis", "mechanism", "predictedOutcome", "boundaryConditions"]);
const CALIBRATION_REQUEST_KEYS = [
	"branchId",
	"treatment",
	"benchmarks",
	"actions",
	"hypothesis",
	"mechanism",
	"predictedOutcome",
	"boundaryConditions",
	"parentJobIds",
] as const;
const PROPOSAL_RECORD_KEYS = [
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
] as const;
const PROPOSAL_DETAILS_KEYS = [
	"hypothesis",
	"mechanism",
	"predictedOutcome",
	"boundaryConditions",
	"parentJobIds",
] as const;
const PROVENANCE_KEYS = [
	"adapter",
	"evaluatorSha256",
	"environmentSpecSha256",
	"cbenchPatchSha256",
	"upstreamCbenchSourceSha256",
	"installedCbenchSourceSha256",
	"distributionManifestSha256",
	"compatibilityTreeManifestSha256",
	"libtinfoSha256",
	"compilerGym",
	"llvm",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordField(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = [...keys].sort();
	const actual = Object.keys(record).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${path} keys mismatch: expected=${expected.join(",")} received=${actual.join(",")}`);
	}
}

function stringField(record: Record<string, unknown>, key: string, path = key): string {
	const value = record[key];
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function stringArrayField(record: Record<string, unknown>, key: string, path = key): string[] {
	const value = record[key];
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${path} must be a string array`);
	}
	return [...value];
}

function exactStringArray(value: unknown, expected: readonly string[], path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${path} must be a string array`);
	}
	if (JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new Error(`${path} must exactly equal ${JSON.stringify(expected)}`);
	}
	return [...value];
}

function nonnegativeSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function finiteNonnegativeNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${path} must be a finite nonnegative number`);
	}
	return value;
}

function sha256Field(value: unknown, path: string): string {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
		throw new Error(`${path} must be a lowercase SHA-256 digest`);
	}
	return value;
}

function timestampField(value: unknown, path: string): string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new Error(`${path} must be an ISO-compatible timestamp`);
	}
	return value;
}

function artifactRef(value: unknown, path: string): ArtifactRef {
	const record = recordField(value, path);
	exactKeys(record, ["digest", "byteLength", "mediaType"], path);
	return {
		digest: sha256Field(record.digest, `${path}.digest`),
		byteLength: nonnegativeSafeInteger(record.byteLength, `${path}.byteLength`),
		mediaType: stringField(record, "mediaType", `${path}.mediaType`),
	};
}

function optionalArtifactRef(value: unknown, path: string): void {
	if (value !== null) artifactRef(value, path);
}

function assertEqual<T>(actual: T, expected: T, path: string): void {
	if (actual !== expected) {
		throw new Error(`${path} mismatch: expected ${String(expected)}, received ${String(actual)}`);
	}
}

function resolveSelectionScope(options: StockCpuSelectionScopeOptions): StockCpuSelectionScope {
	const scope = { ...STOCK_CPU_DEFAULT_SELECTION_SCOPE, ...options };
	if (!scope.branchId.trim()) throw new Error("selection scope branchId must be a non-empty string");
	if (!scope.treatment.trim()) throw new Error("selection scope treatment must be a non-empty string");
	if (typeof scope.requireFreshMeasurements !== "boolean") {
		throw new Error("selection scope requireFreshMeasurements must be a boolean");
	}
	return scope;
}

function proposalManifestBody(proposal: ProposalRecord): Omit<ProposalRecord, "jobId" | "manifestDigest"> {
	const { jobId: _jobId, manifestDigest: _manifestDigest, ...body } = proposal;
	return body;
}

function assertProposalIdentity(proposal: ProposalRecord): void {
	const expectedManifestDigest = sha256Json(proposalManifestBody(proposal));
	assertEqual(proposal.manifestDigest, expectedManifestDigest, "job.proposal.manifestDigest");
	assertEqual(proposal.jobId, `job_${expectedManifestDigest.slice(0, 24)}`, "job.proposal.jobId");
}

function parseProposalRecord(value: unknown): ProposalRecord {
	const record = recordField(value, "job.proposal");
	exactKeys(record, PROPOSAL_RECORD_KEYS, "job.proposal");
	const proposalDetails = recordField(record.proposal, "job.proposal.proposal");
	exactKeys(proposalDetails, PROPOSAL_DETAILS_KEYS, "job.proposal.proposal");
	const lane = stringField(record, "lane", "job.proposal.lane");
	const budgetClass = stringField(record, "budgetClass", "job.proposal.budgetClass");
	const candidateFormat = stringField(record, "candidateFormat", "job.proposal.candidateFormat");
	if (lane !== "compiler-gym") throw new Error("job.proposal.lane must be compiler-gym");
	if (budgetClass !== "smoke") throw new Error("job.proposal.budgetClass must be smoke");
	if (candidateFormat !== "llvm-pass-sequence") {
		throw new Error("job.proposal.candidateFormat must be llvm-pass-sequence");
	}
	const proposal: ProposalRecord = {
		jobId: stringField(record, "jobId", "job.proposal.jobId"),
		manifestDigest: sha256Field(record.manifestDigest, "job.proposal.manifestDigest"),
		branchId: stringField(record, "branchId", "job.proposal.branchId"),
		lane,
		benchmarkIds: exactStringArray(record.benchmarkIds, STOCK_CPU_TASKS, "job.proposal.benchmarkIds"),
		budgetClass,
		treatment: stringField(record, "treatment", "job.proposal.treatment"),
		proposal: {
			hypothesis: stringField(proposalDetails, "hypothesis", "job.proposal.proposal.hypothesis"),
			mechanism: stringField(proposalDetails, "mechanism", "job.proposal.proposal.mechanism"),
			predictedOutcome: stringField(proposalDetails, "predictedOutcome", "job.proposal.proposal.predictedOutcome"),
			boundaryConditions: stringArrayField(
				proposalDetails,
				"boundaryConditions",
				"job.proposal.proposal.boundaryConditions",
			),
			parentJobIds: stringArrayField(proposalDetails, "parentJobIds", "job.proposal.proposal.parentJobIds"),
		},
		candidate: artifactRef(record.candidate, "job.proposal.candidate"),
		candidateFormat,
	};
	assertProposalIdentity(proposal);
	return proposal;
}

export function expectedStockCpuProvenance(evaluatorSha256: string): StockCpuProvenance {
	sha256Field(evaluatorSha256, "expected evaluator SHA-256");
	return {
		adapter: "farmshare-compiler-gym",
		evaluatorSha256,
		environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
		cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
		upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
		installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
		distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
		compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
		libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
		compilerGym: "0.2.5",
		llvm: "10.0.0",
	};
}

function parseExactProvenance(value: unknown, expected: StockCpuProvenance, path: string): StockCpuProvenance {
	const record = recordField(value, path);
	exactKeys(record, PROVENANCE_KEYS, path);
	for (const [key, expectedValue] of Object.entries(expected)) {
		assertEqual(record[key], expectedValue, `${path}.${key}`);
	}
	return { ...expected };
}

function parseAcceptedTask(value: unknown, expectedBenchmarkId: string, path: string): StockCpuTaskEvidence {
	const record = recordField(value, path);
	exactKeys(record, ["benchmarkId", "status", "metrics", "verifier", "runtimeMs"], path);
	assertEqual(record.benchmarkId, expectedBenchmarkId, `${path}.benchmarkId`);
	assertEqual(record.status, "accepted", `${path}.status`);
	finiteNonnegativeNumber(record.runtimeMs, `${path}.runtimeMs`);
	const metrics = recordField(record.metrics, `${path}.metrics`);
	const verifier = recordField(record.verifier, `${path}.verifier`);
	exactKeys(verifier, ["passed", "checks", "errors"], `${path}.verifier`);
	assertEqual(verifier.passed, true, `${path}.verifier.passed`);
	stringArrayField(verifier, "checks", `${path}.verifier.checks`);
	const errors = stringArrayField(verifier, "errors", `${path}.verifier.errors`);
	if (errors.length > 0) throw new Error(`${path}.verifier.errors must be empty for an accepted task`);
	return {
		benchmarkId: expectedBenchmarkId as StockCpuTaskEvidence["benchmarkId"],
		irInstructionCount: nonnegativeSafeInteger(metrics.IrInstructionCount, `${path}.metrics.IrInstructionCount`),
		objectTextSizeBytes: nonnegativeSafeInteger(metrics.ObjectTextSizeBytes, `${path}.metrics.ObjectTextSizeBytes`),
		verifierPassed: true,
	};
}

export function parseStockCpuCalibration(
	value: unknown,
	expectedCampaignConfigSha256: string,
	expectedEvaluatorSha256: string,
): StockCpuCalibration {
	sha256Field(expectedCampaignConfigSha256, "expected campaign config SHA-256");
	const expectedProvenance = expectedStockCpuProvenance(expectedEvaluatorSha256);
	const root = recordField(value, "calibration");
	assertEqual(root.type, "compiler_gym_evaluation", "calibration.type");
	assertEqual(root.campaignConfigSha256, expectedCampaignConfigSha256, "calibration.campaignConfigSha256");

	const request = recordField(root.request, "calibration.request");
	exactKeys(request, CALIBRATION_REQUEST_KEYS, "calibration.request");
	const requestBranchId = stringField(request, "branchId", "calibration.request.branchId");
	assertEqual(request.treatment, "calibration", "calibration.request.treatment");
	exactStringArray(request.benchmarks, STOCK_CPU_TASKS, "calibration.request.benchmarks");
	exactStringArray(request.actions, [], "calibration.request.actions");
	const requestHypothesis = stringField(request, "hypothesis", "calibration.request.hypothesis");
	const requestMechanism = stringField(request, "mechanism", "calibration.request.mechanism");
	const requestPredictedOutcome = stringField(request, "predictedOutcome", "calibration.request.predictedOutcome");
	const requestBoundaryConditions = stringArrayField(
		request,
		"boundaryConditions",
		"calibration.request.boundaryConditions",
	);
	const requestParentJobIds = exactStringArray(request.parentJobIds, [], "calibration.request.parentJobIds");

	const job = recordField(root.job, "calibration.job");
	exactKeys(job, ["proposal", "state", "measurement"], "calibration.job");
	const proposal = parseProposalRecord(job.proposal);
	assertEqual(proposal.branchId, requestBranchId, "job.proposal.branchId");
	assertEqual(proposal.treatment, "calibration", "job.proposal.treatment");
	assertEqual(proposal.proposal.hypothesis, requestHypothesis, "job.proposal.proposal.hypothesis");
	assertEqual(proposal.proposal.mechanism, requestMechanism, "job.proposal.proposal.mechanism");
	assertEqual(proposal.proposal.predictedOutcome, requestPredictedOutcome, "job.proposal.proposal.predictedOutcome");
	if (JSON.stringify(proposal.proposal.boundaryConditions) !== JSON.stringify(requestBoundaryConditions)) {
		throw new Error("job proposal boundaryConditions do not match the calibration request");
	}
	if (JSON.stringify(proposal.proposal.parentJobIds) !== JSON.stringify(requestParentJobIds)) {
		throw new Error("job proposal parentJobIds do not match the calibration request");
	}
	assertEqual(proposal.candidate.digest, sha256Text("[]"), "job.proposal.candidate.digest");
	assertEqual(proposal.candidate.byteLength, 2, "job.proposal.candidate.byteLength");
	assertEqual(
		proposal.candidate.mediaType,
		"application/vnd.prime.llvm-pass-sequence",
		"job.proposal.candidate.mediaType",
	);

	const submitted = recordField(root.submitted, "calibration.submitted");
	exactKeys(submitted, ["jobId", "acceptedAt", "manifestDigest", "duplicate"], "calibration.submitted");
	assertEqual(submitted.jobId, proposal.jobId, "calibration.submitted.jobId");
	assertEqual(submitted.manifestDigest, proposal.manifestDigest, "calibration.submitted.manifestDigest");
	timestampField(submitted.acceptedAt, "calibration.submitted.acceptedAt");
	if (typeof submitted.duplicate !== "boolean") throw new Error("calibration.submitted.duplicate must be boolean");

	const state = recordField(job.state, "calibration.job.state");
	exactKeys(state, ["jobId", "status", "statusAt", "externalJobId", "reason"], "calibration.job.state");
	assertEqual(state.jobId, proposal.jobId, "calibration.job.state.jobId");
	assertEqual(state.status, "succeeded", "calibration.job.state.status");
	timestampField(state.statusAt, "calibration.job.state.statusAt");
	if (state.externalJobId !== null && typeof state.externalJobId !== "string") {
		throw new Error("calibration.job.state.externalJobId must be a string or null");
	}
	if (state.reason !== null && typeof state.reason !== "string") {
		throw new Error("calibration.job.state.reason must be a string or null");
	}

	const measurement = recordField(job.measurement, "calibration.job.measurement");
	exactKeys(
		measurement,
		["jobId", "manifestDigest", "verifierEpoch", "measuredAt", "tasks", "hardware", "provenance", "stdout", "stderr"],
		"calibration.job.measurement",
	);
	assertEqual(measurement.jobId, proposal.jobId, "calibration.job.measurement.jobId");
	assertEqual(measurement.manifestDigest, proposal.manifestDigest, "calibration.job.measurement.manifestDigest");
	assertEqual(measurement.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH, "calibration.job.measurement.verifierEpoch");
	timestampField(measurement.measuredAt, "calibration.job.measurement.measuredAt");
	const hardware = recordField(measurement.hardware, "calibration.job.measurement.hardware");
	if (!Object.values(hardware).every((item) => typeof item === "string")) {
		throw new Error("calibration.job.measurement.hardware must contain only strings");
	}
	const provenance = parseExactProvenance(
		measurement.provenance,
		expectedProvenance,
		"calibration.job.measurement.provenance",
	);
	optionalArtifactRef(measurement.stdout, "calibration.job.measurement.stdout");
	optionalArtifactRef(measurement.stderr, "calibration.job.measurement.stderr");
	if (!Array.isArray(measurement.tasks)) throw new Error("calibration.job.measurement.tasks must be an array");
	const measurementTasks = measurement.tasks;
	if (measurementTasks.length !== STOCK_CPU_TASKS.length) {
		throw new Error("calibration.job.measurement.tasks must contain the exact stock task coverage");
	}
	const tasks = STOCK_CPU_TASKS.map((benchmarkId, index) =>
		parseAcceptedTask(measurementTasks[index], benchmarkId, `calibration.job.measurement.tasks[${index}]`),
	);
	return { jobId: proposal.jobId, manifestDigest: proposal.manifestDigest, tasks, provenance };
}

export function parseStockCpuEvaluationRequest(value: unknown): StockCpuEvaluationRequest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Request must be an object");
	}
	const record = value as Record<string, unknown>;
	const unknown = Object.keys(record).filter((key) => !REQUEST_KEYS.has(key));
	const missing = [...REQUEST_KEYS].filter((key) => !(key in record));
	if (unknown.length > 0 || missing.length > 0) {
		throw new Error(`Request keys mismatch: missing=${missing.join(",")} unknown=${unknown.join(",")}`);
	}
	const actions = stringArrayField(record, "actions");
	if (actions.length > 256) throw new Error("actions may contain at most 256 pass flags");
	for (const action of actions) {
		if (!/^-[a-z0-9][a-z0-9-]*$/.test(action)) throw new Error(`Invalid LLVM pass flag: ${action}`);
	}
	return {
		actions,
		hypothesis: stringField(record, "hypothesis"),
		mechanism: stringField(record, "mechanism"),
		predictedOutcome: stringField(record, "predictedOutcome"),
		boundaryConditions: stringArrayField(record, "boundaryConditions"),
	};
}

export function latestStockParent(jobs: readonly JobView[]): string[] {
	if (jobs.length === 0) return [];
	const latest = [...jobs]
		.sort((left, right) => {
			const timeOrder = left.state.statusAt.localeCompare(right.state.statusAt);
			return timeOrder === 0 ? left.proposal.jobId.localeCompare(right.proposal.jobId) : timeOrder;
		})
		.at(-1);
	assert.ok(latest);
	return [latest.proposal.jobId];
}

export function parseStockChampion(text: string, allowedJobIds: readonly string[]): string | null {
	const matches = [...text.matchAll(/(?:^|\n)CHAMPION (NONE|job_[a-f0-9]{24})(?:\n|$)/g)];
	if (matches.length === 0) return null;
	const value = matches.at(-1)?.[1];
	if (!value || value === "NONE") return null;
	if (!allowedJobIds.includes(value)) throw new Error(`Champion is not a submitted job: ${value}`);
	return value;
}

export function parseStockChampionReport(
	text: string,
	allowedJobIds: readonly string[],
): { line: string; jobId: string | null } {
	const line = text.trim().split("\n").at(-1) ?? "";
	if (!/^CHAMPION (?:NONE|job_[a-f0-9]{24})$/.test(line)) {
		throw new Error("Assistant response must end with an exact CHAMPION line");
	}
	return { line, jobId: parseStockChampion(line, allowedJobIds) };
}

interface Ratio {
	numerator: number;
	denominator: number;
}

interface EligibleCandidate {
	evidence: StockCpuCandidateSelectionEvidence;
	irByTask: number[];
	ratioVector: Ratio[];
}

function ratioIsInfinite(ratio: Ratio): boolean {
	return ratio.denominator === 0 && ratio.numerator > 0;
}

function compareRatios(left: Ratio, right: Ratio): number {
	const leftInfinite = ratioIsInfinite(left);
	const rightInfinite = ratioIsInfinite(right);
	if (leftInfinite || rightInfinite) return leftInfinite === rightInfinite ? 0 : leftInfinite ? 1 : -1;
	if (left.denominator === 0 && left.numerator === 0) {
		return right.denominator === 0 && right.numerator === 0 ? 0 : right.numerator === 0 ? 0 : -1;
	}
	if (right.denominator === 0 && right.numerator === 0) return left.numerator === 0 ? 0 : 1;
	const leftProduct = BigInt(left.numerator) * BigInt(right.denominator);
	const rightProduct = BigInt(right.numerator) * BigInt(left.denominator);
	return leftProduct < rightProduct ? -1 : leftProduct > rightProduct ? 1 : 0;
}

function exactRatio(ratio: Ratio): string {
	if (ratioIsInfinite(ratio)) return "infinity";
	if (ratio.denominator === 0) return "0/0";
	return `${ratio.numerator}/${ratio.denominator}`;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function jobIdentityReasons(job: JobView): string[] {
	const reasons: string[] = [];
	try {
		sha256Field(job.proposal.manifestDigest, "proposal.manifestDigest");
		sha256Field(job.proposal.candidate.digest, "proposal.candidate.digest");
		const expectedManifestDigest = sha256Json(proposalManifestBody(job.proposal));
		if (job.proposal.manifestDigest !== expectedManifestDigest)
			reasons.push("proposal manifest digest is inconsistent");
		if (job.proposal.jobId !== `job_${expectedManifestDigest.slice(0, 24)}`)
			reasons.push("proposal job ID is inconsistent");
	} catch (error) {
		reasons.push(error instanceof Error ? error.message : String(error));
	}
	if (job.state.jobId !== job.proposal.jobId) reasons.push("state job ID does not match proposal");
	if (job.measurement && job.measurement.jobId !== job.proposal.jobId) {
		reasons.push("measurement job ID does not match proposal");
	}
	if (job.measurement && job.measurement.manifestDigest !== job.proposal.manifestDigest) {
		reasons.push("measurement manifest digest does not match proposal");
	}
	return reasons;
}

function candidateEligibility(
	job: JobView,
	calibration: StockCpuCalibration,
	scope: StockCpuSelectionScope,
): { candidate: EligibleCandidate | null; reasons: string[] } {
	const reasons = jobIdentityReasons(job);
	if (job.proposal.branchId !== scope.branchId) {
		reasons.push(
			scope.branchId === STOCK_CPU_BRANCH_ID
				? "job is not on the stock CPU branch"
				: `job is not on the required branch ${scope.branchId}`,
		);
	}
	if (job.proposal.lane !== "compiler-gym") reasons.push("job is not a CompilerGym candidate");
	if (!sameStringArray(job.proposal.benchmarkIds, STOCK_CPU_TASKS))
		reasons.push("proposal task coverage is not exact");
	if (job.proposal.budgetClass !== "smoke") reasons.push("job does not use the smoke budget class");
	if (job.proposal.treatment !== scope.treatment) {
		reasons.push(
			scope.treatment === STOCK_CPU_TREATMENT
				? "job treatment does not match the stock baseline"
				: `job treatment does not match the required treatment ${scope.treatment}`,
		);
	}
	if (job.proposal.candidateFormat !== "llvm-pass-sequence") reasons.push("candidate format is not LLVM passes");
	if (job.state.status !== "succeeded") reasons.push(`job status is ${job.state.status}, not succeeded`);
	const measurement = job.measurement;
	if (!measurement) {
		reasons.push("measurement is missing");
		return { candidate: null, reasons };
	}
	if (scope.requireFreshMeasurements && measurement.reuse !== undefined) {
		reasons.push("measurement was reused but fresh measurements are required");
	}
	if (measurement.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		reasons.push(`verifier epoch is ${measurement.verifierEpoch}, not CompilerGym v2`);
	}
	try {
		parseExactProvenance(measurement.provenance, calibration.provenance, "measurement.provenance");
	} catch (error) {
		reasons.push(error instanceof Error ? error.message : String(error));
	}
	if (
		measurement.tasks.length !== STOCK_CPU_TASKS.length ||
		!sameStringArray(
			measurement.tasks.map((task) => task.benchmarkId),
			STOCK_CPU_TASKS,
		)
	) {
		reasons.push("measurement task coverage is not exact");
	}

	const taskEvidence: StockCpuTaskEvidence[] = [];
	if (measurement.tasks.length === STOCK_CPU_TASKS.length) {
		for (const [index, benchmarkId] of STOCK_CPU_TASKS.entries()) {
			const task = measurement.tasks[index];
			if (!task || task.benchmarkId !== benchmarkId) continue;
			try {
				taskEvidence.push(parseCandidateTask(task, benchmarkId, index));
			} catch (error) {
				reasons.push(error instanceof Error ? error.message : String(error));
			}
		}
	}
	if (reasons.length > 0 || taskEvidence.length !== STOCK_CPU_TASKS.length) {
		return { candidate: null, reasons: [...new Set(reasons)] };
	}

	const irByTask = taskEvidence.map((task) => task.irInstructionCount);
	const ratioByTask = taskEvidence.map((task, index) => ({
		numerator: task.irInstructionCount,
		denominator: calibration.tasks[index].irInstructionCount,
	}));
	const ratioVector = [...ratioByTask].sort((left, right) => compareRatios(right, left));
	return {
		reasons: [],
		candidate: {
			evidence: {
				jobId: job.proposal.jobId,
				candidateDigest: job.proposal.candidate.digest,
				irInstructionCounts: Object.fromEntries(
					taskEvidence.map((task) => [task.benchmarkId, task.irInstructionCount]),
				),
				objectTextSizeBytes: Object.fromEntries(
					taskEvidence.map((task) => [task.benchmarkId, task.objectTextSizeBytes]),
				),
				normalizedIrRatios: ratioByTask.map((ratio, index) => ({
					benchmarkId: STOCK_CPU_TASKS[index],
					...ratio,
					exact: exactRatio(ratio),
				})),
			},
			irByTask,
			ratioVector,
		},
	};
}

function parseCandidateTask(task: TaskMeasurement, benchmarkId: string, index: number): StockCpuTaskEvidence {
	const path = `measurement.tasks[${index}]`;
	if (task.status !== "accepted") throw new Error(`${path}.status is ${task.status}, not accepted`);
	if (task.verifier.passed !== true) throw new Error(`${path}.verifier.passed is not true`);
	if (task.verifier.errors.length > 0) throw new Error(`${path}.verifier.errors is not empty`);
	return {
		benchmarkId: benchmarkId as StockCpuTaskEvidence["benchmarkId"],
		irInstructionCount: nonnegativeSafeInteger(task.metrics.IrInstructionCount, `${path}.metrics.IrInstructionCount`),
		objectTextSizeBytes: nonnegativeSafeInteger(
			task.metrics.ObjectTextSizeBytes,
			`${path}.metrics.ObjectTextSizeBytes`,
		),
		verifierPassed: true,
	};
}

function dominates(left: EligibleCandidate, right: EligibleCandidate): boolean {
	return (
		left.irByTask.every((value, index) => value <= right.irByTask[index]) &&
		left.irByTask.some((value, index) => value < right.irByTask[index])
	);
}

function compareEligibleCandidates(left: EligibleCandidate, right: EligibleCandidate): number {
	for (let index = 0; index < left.ratioVector.length; index++) {
		const order = compareRatios(left.ratioVector[index], right.ratioVector[index]);
		if (order !== 0) return order;
	}
	for (let index = 0; index < left.irByTask.length; index++) {
		const order = left.irByTask[index] - right.irByTask[index];
		if (order !== 0) return order;
	}
	const digestOrder = left.evidence.candidateDigest.localeCompare(right.evidence.candidateDigest);
	return digestOrder === 0 ? left.evidence.jobId.localeCompare(right.evidence.jobId) : digestOrder;
}

export function selectStockCpuChampion(
	jobs: readonly JobView[],
	calibration: StockCpuCalibration,
	scopeOptions: StockCpuSelectionScopeOptions = {},
): StockCpuChampionSelection {
	const scope = resolveSelectionScope(scopeOptions);
	const eligible: EligibleCandidate[] = [];
	const excludedCandidates: Array<{ jobId: string; reasons: string[] }> = [];
	for (const job of [...jobs].sort((left, right) => left.proposal.jobId.localeCompare(right.proposal.jobId))) {
		const result = candidateEligibility(job, calibration, scope);
		if (result.candidate) eligible.push(result.candidate);
		else excludedCandidates.push({ jobId: job.proposal.jobId, reasons: result.reasons });
	}
	const frontier = eligible.filter(
		(candidate) => !eligible.some((other) => other !== candidate && dominates(other, candidate)),
	);
	const ranked = [...frontier].sort(compareEligibleCandidates);
	return {
		policy: STOCK_CPU_CHAMPION_POLICY,
		expectedVerifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		expectedProvenance: { ...calibration.provenance },
		calibrationJobId: calibration.jobId,
		eligibleCandidates: eligible.map((candidate) => candidate.evidence),
		excludedCandidates,
		paretoFrontierJobIds: frontier.map((candidate) => candidate.evidence.jobId).sort(),
		rankedParetoJobIds: ranked.map((candidate) => candidate.evidence.jobId),
		selectedJobId: ranked[0]?.evidence.jobId ?? null,
	};
}

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "invalid", "failed", "cancelled"]);

function acceptedV2TaskRecordCount(
	job: JobView,
	calibration: StockCpuCalibration,
	scope: StockCpuSelectionScope,
): number {
	const measurement = job.measurement;
	if (!measurement || measurement.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) return 0;
	if (scope.requireFreshMeasurements && measurement.reuse !== undefined) return 0;
	try {
		parseExactProvenance(measurement.provenance, calibration.provenance, "measurement.provenance");
	} catch {
		return 0;
	}
	let accepted = 0;
	for (const [index, benchmarkId] of STOCK_CPU_TASKS.entries()) {
		const task = measurement.tasks[index];
		if (!task || task.benchmarkId !== benchmarkId) continue;
		try {
			parseCandidateTask(task, benchmarkId, index);
			accepted += 1;
		} catch {
			// The per-job rejection evidence reports the exact failed contract.
		}
	}
	return accepted;
}

export function assessStockCpuCompletion(
	jobs: readonly JobView[],
	calibration: StockCpuCalibration,
	scopeOptions: StockCpuSelectionScopeOptions = {},
): StockCpuCompletionGate {
	const scope = resolveSelectionScope(scopeOptions);
	const fullyAcceptedJobIds: string[] = [];
	const rejectedJobs: Array<{ jobId: string; reasons: string[] }> = [];
	for (const job of [...jobs].sort((left, right) => left.proposal.jobId.localeCompare(right.proposal.jobId))) {
		const eligibility = candidateEligibility(job, calibration, scope);
		if (eligibility.candidate) fullyAcceptedJobIds.push(job.proposal.jobId);
		else rejectedJobs.push({ jobId: job.proposal.jobId, reasons: eligibility.reasons });
	}
	const requiredAcceptedV2TaskRecords = STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length;
	const terminalJobs = jobs.filter((job) => TERMINAL_JOB_STATUSES.has(job.state.status)).length;
	const durableMeasurementJobs = jobs.filter((job) => job.measurement !== null).length;
	const observedTaskRecords = jobs.reduce((total, job) => total + (job.measurement?.tasks.length ?? 0), 0);
	const acceptedV2TaskRecords = jobs.reduce(
		(total, job) => total + acceptedV2TaskRecordCount(job, calibration, scope),
		0,
	);
	return {
		requiredJobs: STOCK_CPU_MAX_SUBMISSIONS,
		requiredAcceptedV2TaskRecords,
		observedJobs: jobs.length,
		terminalJobs,
		durableMeasurementJobs,
		observedTaskRecords,
		acceptedV2TaskRecords,
		fullyAcceptedJobIds,
		rejectedJobs,
		passed:
			jobs.length === STOCK_CPU_MAX_SUBMISSIONS &&
			terminalJobs === STOCK_CPU_MAX_SUBMISSIONS &&
			durableMeasurementJobs === STOCK_CPU_MAX_SUBMISSIONS &&
			observedTaskRecords === requiredAcceptedV2TaskRecords &&
			acceptedV2TaskRecords === requiredAcceptedV2TaskRecords &&
			fullyAcceptedJobIds.length === STOCK_CPU_MAX_SUBMISSIONS,
	};
}

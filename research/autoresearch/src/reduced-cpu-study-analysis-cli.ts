import assert from "node:assert/strict";
import { chmod, lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	analyzeReducedCpuStudy,
	type ReducedCpuStudyAnalysis,
	type ReducedCpuStudyArmAnalysisEvidence,
} from "./analyze-reduced-cpu-study.js";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import {
	REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS,
	type ReducedCpuCompactionAudit,
	type ReducedCpuStudyArmResult,
	type ReducedCpuStudyResult,
} from "./reduced-cpu-study.js";
import {
	REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS,
	type ReducedCpuStudyArmPreregistration,
	type ReducedCpuStudyPreregistration,
	readAndVerifyReducedCpuStudyPreregistration,
} from "./reduced-cpu-study-preregistration.js";
import {
	assessReducedCpuResurrection,
	buildReducedCpuCandidateEvidence,
	buildReducedCpuChampionValidationEvidence,
	classifyReducedCpuCandidateTwo,
	maybeBuildReducedCpuRetestDirective,
	parseReducedCpuCalibration,
	REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM,
	REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM,
	REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM,
	REDUCED_CPU_STUDY_ARMS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	type ReducedCpuArmBlock,
	type ReducedCpuCalibration,
	type ReducedCpuCalibrationEnvelope,
	type ReducedCpuCandidateEvidence,
	type ReducedCpuStudyArm,
	reducedCpuSearchTreatment,
	reducedCpuValidationTreatment,
	sealReducedCpuRetestDirective,
	selectReducedCpuChampion,
} from "./reduced-cpu-study-protocol.js";
import type { JobStateRecord, JobView, MeasurementRecord, ProposalRecord } from "./types.js";

export const REDUCED_CPU_AUTHORITATIVE_ANALYSIS_PROTOCOL =
	"reduced-prime-compiler-gym-authoritative-analysis-v1" as const;
export const REDUCED_CPU_COMPACTION_BOUNDARY_MESSAGE =
	"HOST_REDUCED_CPU_COMPACTION_BOUNDARY_V1: apply the common native compaction policy now." as const;

export interface ReducedCpuEvaluationIdentity {
	scope: string;
	jobId: string;
	manifestDigest: string;
	externalJobId: string | null;
}

export interface ReducedCpuEvaluationIdentitySummary {
	count: number;
	jobIdsUnique: true;
	manifestDigestsUnique: true;
	externalJobIdsUniqueWhenPresent: true;
	externalJobIdsPresent: number;
	externalJobIdsAbsent: number;
	coldAdapterExternalIdentityLimitation: "null-allowed-dispatch-claims-are-the-exclusive-attempt-identity";
}

export interface ReducedCpuAuthoritativeDecision {
	authority: "post-run-model-free-analyzer-only";
	runnerBlockDecisionDisposition: "ignored-preliminary-nonauthoritative";
	status: ReducedCpuStudyAnalysis["overall"]["status"];
	winnerArm: ReducedCpuStudyArm | null;
	gpuTransferAuthorized: boolean;
	gpuTransferEligibleArm: "M" | "M+R" | null;
	reason: string;
}

export interface ReducedCpuAuthoritativeAnalysisArtifact {
	schemaVersion: 1;
	type: "reduced_cpu_study_authoritative_analysis";
	protocol: typeof REDUCED_CPU_AUTHORITATIVE_ANALYSIS_PROTOCOL;
	studyProtocol: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	bindings: {
		preregistrationPath: string;
		preregistrationFileSha256: string;
		preregistrationSha256: string;
		resultPath: string;
		resultFileSha256: string;
		calibrationPath: string;
		calibrationFileSha256: string;
		calibrationParsedSha256: string;
	};
	integrity: {
		resultCompleted: true;
		preregistrationAndSourcesVerified: true;
		calibrationVerified: true;
		armLedgersVerified: true;
		armArtifactsVerified: true;
		armTerminalFilesVerified: true;
		dispatchClaimsVerified: true;
		compactionEvidenceVerified: true;
		usageRecomputedFromPersistedSessions: true;
		crossArmSessionAuditPassed: true;
		identities: ReducedCpuEvaluationIdentitySummary;
	};
	analysis: ReducedCpuStudyAnalysis;
	decision: ReducedCpuAuthoritativeDecision;
}

interface ReplayedArmLedger {
	eventCount: number;
	jobs: JobView[];
}

interface ReconstructedArm {
	arm: ReducedCpuStudyArm;
	registration: ReducedCpuStudyArmPreregistration;
	raw: ReducedCpuStudyArmResult;
	block: ReducedCpuArmBlock;
	sealedRetestDirective: ReducedCpuStudyArmAnalysisEvidence["sealedRetestDirective"];
	sessionText: string;
	evaluatorCpuSeconds: number;
	ledgerEventCount: number;
}

const RESULT_KEYS = [
	"schemaVersion",
	"type",
	"protocolVersion",
	"outcome",
	"failure",
	"outputDir",
	"calibrationResultPath",
	"calibrationResultSha256",
	"model",
	"defaultSystemPrompt",
	"providerMaxRetries",
	"transport",
	"providerTracker",
	"activeToolsByArm",
	"startedAt",
	"finishedAt",
	"calendarMs",
	"agentActiveMs",
	"evaluatorWaitMs",
	"budgetStopReason",
	"arms",
	"blockDecision",
	"strictLedgerIntegrityPassed",
	"strictLedgerEventCount",
	"sourceIntegrityPassed",
	"noRetries",
	"noReplacements",
	"noDuplicates",
	"campaignIdentityAudit",
	"noMeasurementReuse",
	"noCrossArmEvidence",
	"completionPassed",
] as const;

const ARM_RESULT_KEYS = [
	"arm",
	"branchId",
	"sessionId",
	"sessionFile",
	"resolvedModelSnapshot",
	"resolvedModelSnapshotSha256",
	"activeToolNames",
	"candidates",
	"candidateTwo",
	"retestDirective",
	"resurrection",
	"championSelection",
	"validation",
	"compaction",
	"isolation",
	"recall",
	"recallReceipt",
	"providerGraph",
	"providerDispatches",
	"usage",
	"outputTokens",
	"agentActiveMs",
	"evaluatorWaitMs",
	"calendarMs",
	"budgetStopReason",
	"branchBudget",
	"jobs",
	"artifactIntegrityPassed",
	"completionPassed",
	"failures",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys drifted`);
}

function nonemptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function digest(value: unknown, label: string): string {
	const parsed = nonemptyString(value, label);
	if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
	return parsed;
}

function finiteNonnegative(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${label} must be finite and nonnegative`);
	}
	return value;
}

function timestamp(value: unknown, label: string): string {
	const parsed = nonemptyString(value, label);
	if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} must be a timestamp`);
	return parsed;
}

function sameJson(left: unknown, right: unknown): boolean {
	return sha256Json(left) === sha256Json(right);
}

function validateUsage(value: Usage, label: string): void {
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
		if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
			throw new Error(`${label}.${key} must be a nonnegative safe integer`);
		}
	}
	if (value.totalTokens !== value.input + value.output + value.cacheRead + value.cacheWrite) {
		throw new Error(`${label}.totalTokens does not equal its token components`);
	}
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
		finiteNonnegative(value.cost[key], `${label}.cost.${key}`);
	}
	const componentCost = value.cost.input + value.cost.output + value.cost.cacheRead + value.cost.cacheWrite;
	if (Math.abs(componentCost - value.cost.total) > 1e-12) {
		throw new Error(`${label}.cost.total does not equal its cost components`);
	}
}

function addUsage(left: Usage, right: Usage): Usage {
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		totalTokens: left.totalTokens + right.totalTokens,
		cost: {
			input: left.cost.input + right.cost.input,
			output: left.cost.output + right.cost.output,
			cacheRead: left.cost.cacheRead + right.cost.cacheRead,
			cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
			total: left.cost.total + right.cost.total,
		},
	};
}

function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function sessionRecords(sessionText: string): Record<string, unknown>[] {
	if (!sessionText.endsWith("\n")) throw new Error("persisted session must end with a newline");
	const lines = sessionText.slice(0, -1).split("\n");
	if (lines.length === 0 || lines.some((line) => line.length === 0)) {
		throw new Error("persisted session contains missing or empty JSONL records");
	}
	return lines.map((line, index) => record(JSON.parse(line) as unknown, `session line ${index + 1}`));
}

export function verifyReducedCpuCompactionEvidence(compaction: ReducedCpuCompactionAudit, sessionText: string): void {
	if (compaction.instruction !== REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS) {
		throw new Error("compaction instructions drifted");
	}
	if (compaction.keepRecentTokens !== REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS) {
		throw new Error("compaction keep-recent policy drifted");
	}
	if (!compaction.summary || compaction.summarySha256 !== sha256Text(compaction.summary)) {
		throw new Error("compaction summary or summary hash is invalid");
	}
	if (
		!compaction.firstKeptEntryId ||
		!compaction.expectedFirstKeptEntryId ||
		compaction.firstKeptEntryId !== compaction.expectedFirstKeptEntryId
	) {
		throw new Error("compaction cutpoint does not match its host-owned boundary");
	}
	if (!Number.isSafeInteger(compaction.tokensBefore) || compaction.tokensBefore <= 0) {
		throw new Error("compaction tokensBefore must be a positive safe integer");
	}
	if (
		compaction.fromHook !== false ||
		compaction.paidProviderCalls !== 1 ||
		compaction.transportAttempts !== 1 ||
		compaction.startEvents !== 1 ||
		compaction.endEvents !== 1 ||
		compaction.extensionErrors.length !== 0 ||
		compaction.usageAvailable !== true
	) {
		throw new Error("compaction structural call/event evidence is invalid");
	}
	if (!compaction.providerPayloadPriority) throw new Error("compaction provider payload did not request priority");
	if (!compaction.providerPayloadToolsAbsent) throw new Error("compaction provider payload exposed tools");
	if (
		!Number.isSafeInteger(compaction.providerResponseStatus) ||
		compaction.providerResponseStatus < 200 ||
		compaction.providerResponseStatus >= 300
	) {
		throw new Error("compaction provider response was not 2xx");
	}
	digest(compaction.providerPayloadSha256, "compaction.providerPayloadSha256");
	validateUsage(compaction.usage, "compaction.usage");
	const records = sessionRecords(sessionText);
	const persisted = records.filter((entry) => entry.type === "compaction");
	if (persisted.length !== 1) throw new Error("session must persist exactly one compaction entry");
	const entry = persisted[0];
	if (
		entry.summary !== compaction.summary ||
		entry.firstKeptEntryId !== compaction.firstKeptEntryId ||
		entry.tokensBefore !== compaction.tokensBefore ||
		entry.fromHook !== false ||
		entry.customInstructions !== REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS
	) {
		throw new Error("persisted compaction entry differs from the audited compaction result");
	}
	const compactionIndex = records.indexOf(entry);
	const boundaryMatches = records.filter((candidate) => candidate.id === compaction.firstKeptEntryId);
	if (boundaryMatches.length !== 1) {
		throw new Error("compaction cutpoint does not identify exactly one persisted host boundary message");
	}
	const boundary = boundaryMatches[0];
	if (
		boundary.type !== "message" ||
		!isRecord(boundary.message) ||
		boundary.message.role !== "user" ||
		boundary.message.content !== REDUCED_CPU_COMPACTION_BOUNDARY_MESSAGE
	) {
		throw new Error("compaction cutpoint target is not the exact neutral host boundary message");
	}
	if (records.indexOf(boundary) !== compactionIndex - 1) {
		throw new Error("compaction host boundary is not immediately before the persisted compaction entry");
	}
}

export interface ReducedCpuPersistedUsageReconciliation {
	normalAssistantMessageCount: number;
	blockedAssistantMessageCount: number;
	normalAssistantUsage: Usage;
	recomputedArmUsage: Usage;
}

export function reconcileReducedCpuArmUsage(input: {
	sessionText: string;
	compactionUsage: Usage;
	rawArmUsage: Usage;
	rawOutputTokens: number;
	expectedAgentProviderCalls: number;
}): ReducedCpuPersistedUsageReconciliation {
	validateUsage(input.compactionUsage, "compaction.usage");
	validateUsage(input.rawArmUsage, "arm.usage");
	const assistantMessages = sessionRecords(input.sessionText).flatMap((entry) => {
		if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant") return [];
		return [entry.message as unknown as AssistantMessage];
	});
	let normalAssistantUsage = zeroUsage();
	let normalAssistantMessageCount = 0;
	let blockedAssistantMessageCount = 0;
	for (const [index, message] of assistantMessages.entries()) {
		validateUsage(message.usage, `session assistant ${index + 1}.usage`);
		if (message.stopReason === "aborted") {
			if (!sameJson(message.usage, zeroUsage())) {
				throw new Error("aborted blocked assistant message contains paid usage");
			}
			blockedAssistantMessageCount++;
			continue;
		}
		normalAssistantMessageCount++;
		normalAssistantUsage = addUsage(normalAssistantUsage, message.usage);
	}
	if (normalAssistantMessageCount !== input.expectedAgentProviderCalls) {
		throw new Error(
			`persisted normal assistant message count expected ${input.expectedAgentProviderCalls}, got ${normalAssistantMessageCount}`,
		);
	}
	const recomputedArmUsage = addUsage(normalAssistantUsage, input.compactionUsage);
	if (!sameJson(recomputedArmUsage, input.rawArmUsage)) {
		throw new Error("raw arm usage differs from persisted assistant plus compaction usage");
	}
	if (input.rawOutputTokens !== recomputedArmUsage.output) {
		throw new Error("raw arm output tokens differ from recomputed paid usage");
	}
	return {
		normalAssistantMessageCount,
		blockedAssistantMessageCount,
		normalAssistantUsage,
		recomputedArmUsage,
	};
}

function isMissing(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

async function assertMissing(path: string): Promise<void> {
	try {
		await lstat(path);
		throw new Error(`analysis output already exists: ${path}`);
	} catch (error) {
		if (isMissing(error)) return;
		throw error;
	}
}

async function readPrivateRegularFile(pathInput: string, label: string): Promise<string> {
	const path = resolve(pathInput);
	if (!isAbsolute(pathInput) || path !== pathInput) throw new Error(`${label} path must be normalized and absolute`);
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular symlink-free file`);
	if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${label} must be mode 0600`);
	if ((await realpath(path)) !== path) throw new Error(`${label} path must be canonical`);
	return readFile(path, "utf8");
}

export async function writeReducedCpuStudyAnalysisExclusive(pathInput: string, value: unknown): Promise<void> {
	const path = resolve(pathInput);
	if (!isAbsolute(pathInput) || path !== pathInput) throw new Error("analysis path must be normalized and absolute");
	const serialized = `${canonicalJson(toJsonValue(value))}\n`;
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(serialized, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(path, 0o600);
}

function parseCompletedResult(value: unknown): ReducedCpuStudyResult {
	const parsed = record(value, "campaign result");
	exactKeys(parsed, RESULT_KEYS, "campaign result");
	if (parsed.schemaVersion !== 1 || parsed.type !== "reduced_cpu_study") throw new Error("result schema drifted");
	if (parsed.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION) throw new Error("result protocol drifted");
	if (parsed.outcome !== "succeeded" || parsed.failure !== null || parsed.completionPassed !== true) {
		throw new Error("campaign result is not a completed successful study");
	}
	for (const key of [
		"strictLedgerIntegrityPassed",
		"sourceIntegrityPassed",
		"noRetries",
		"noReplacements",
		"noDuplicates",
		"noMeasurementReuse",
		"noCrossArmEvidence",
	] as const) {
		if (parsed[key] !== true) throw new Error(`campaign completion gate failed: ${key}`);
	}
	if (parsed.budgetStopReason !== null) throw new Error("completed campaign records a budget stop");
	const startedAt = timestamp(parsed.startedAt, "result.startedAt");
	const finishedAt = timestamp(parsed.finishedAt, "result.finishedAt");
	if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("campaign timestamps are reversed");
	finiteNonnegative(parsed.calendarMs, "result.calendarMs");
	finiteNonnegative(parsed.agentActiveMs, "result.agentActiveMs");
	finiteNonnegative(parsed.evaluatorWaitMs, "result.evaluatorWaitMs");
	if (!Array.isArray(parsed.arms) || parsed.arms.length !== REDUCED_CPU_STUDY_ARMS.length) {
		throw new Error("campaign result must contain exactly three arms");
	}
	for (const [index, arm] of parsed.arms.entries()) {
		exactKeys(record(arm, `result.arms[${index}]`), ARM_RESULT_KEYS, `result.arms[${index}]`);
	}
	return parsed as unknown as ReducedCpuStudyResult;
}

function jobFromCalibrationEnvelope(envelope: ReducedCpuCalibrationEnvelope): JobView {
	return envelope.job;
}

function replayArmLedger(contents: string, expectedArm: ReducedCpuStudyArm, branchId: string): ReplayedArmLedger {
	const events = verifyLedgerContentsStrict(contents);
	const proposals = new Map<string, ProposalRecord>();
	const states = new Map<string, JobStateRecord>();
	const measurements = new Map<string, MeasurementRecord>();
	let armStartCount = 0;
	let armTerminalCount = 0;
	for (const event of events) {
		if (event.kind === "proposal") {
			const proposal = record(event.payload, `ledger proposal ${event.sequence}`) as unknown as ProposalRecord;
			const jobId = nonemptyString(proposal.jobId, `ledger proposal ${event.sequence}.jobId`);
			if (proposals.has(jobId)) throw new Error(`duplicate ledger proposal ${jobId}`);
			proposals.set(jobId, proposal);
			continue;
		}
		if (event.kind === "job_state") {
			const state = record(event.payload, `ledger state ${event.sequence}`) as unknown as JobStateRecord;
			const jobId = nonemptyString(state.jobId, `ledger state ${event.sequence}.jobId`);
			if (!proposals.has(jobId)) throw new Error(`ledger state precedes proposal for ${jobId}`);
			states.set(jobId, state);
			continue;
		}
		if (event.kind === "measurement") {
			const measurement = record(
				event.payload,
				`ledger measurement ${event.sequence}`,
			) as unknown as MeasurementRecord;
			const jobId = nonemptyString(measurement.jobId, `ledger measurement ${event.sequence}.jobId`);
			if (!proposals.has(jobId)) throw new Error(`ledger measurement precedes proposal for ${jobId}`);
			if (measurements.has(jobId)) throw new Error(`duplicate ledger measurement for ${jobId}`);
			measurements.set(jobId, measurement);
			continue;
		}
		if (event.kind === "run_manifest" && isRecord(event.payload)) {
			if (event.payload.type === "reduced_cpu_arm_start") {
				if (
					event.payload.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
					event.payload.arm !== expectedArm ||
					event.payload.branchId !== branchId
				) {
					throw new Error(`${expectedArm} ledger start manifest is inconsistent`);
				}
				armStartCount++;
			}
			if (event.payload.type === "reduced_cpu_arm_terminal") {
				if (
					event.payload.arm !== expectedArm ||
					event.payload.branchId !== branchId ||
					event.payload.completionPassed !== true
				) {
					throw new Error(`${expectedArm} ledger terminal manifest is inconsistent`);
				}
				armTerminalCount++;
			}
		}
	}
	if (armStartCount !== 1 || armTerminalCount !== 1) {
		throw new Error(`${expectedArm} ledger requires exactly one start and one successful terminal manifest`);
	}
	const jobs = [...proposals.values()].map((proposal): JobView => {
		if (proposal.branchId !== branchId) throw new Error(`${expectedArm} ledger contains a foreign branch`);
		const state = states.get(proposal.jobId);
		const measurement = measurements.get(proposal.jobId);
		if (!state || state.status !== "succeeded") throw new Error(`${proposal.jobId} is not terminal succeeded`);
		if (!measurement) throw new Error(`${proposal.jobId} has no measurement`);
		if (measurement.jobId !== proposal.jobId || measurement.manifestDigest !== proposal.manifestDigest) {
			throw new Error(`${proposal.jobId} measurement identity drifted`);
		}
		if (measurement.reuse !== undefined) throw new Error(`${proposal.jobId} reused a measurement`);
		return { proposal, state, measurement };
	});
	return { eventCount: events.length, jobs };
}

function jobMap(jobs: readonly JobView[], label: string): Map<string, JobView> {
	const result = new Map<string, JobView>();
	for (const job of jobs) {
		const jobId = nonemptyString(job.proposal.jobId, `${label}.jobId`);
		if (result.has(jobId)) throw new Error(`${label} contains duplicate job ${jobId}`);
		result.set(jobId, job);
	}
	return result;
}

function assertSameJobSets(left: readonly JobView[], right: readonly JobView[], label: string): void {
	const leftById = jobMap(left, `${label}.ledger`);
	const rightById = jobMap(right, `${label}.result`);
	assert.deepEqual([...leftById.keys()].sort(), [...rightById.keys()].sort(), `${label} job identities drifted`);
	for (const [jobId, job] of leftById) {
		if (!sameJson(job, rightById.get(jobId))) throw new Error(`${label} result job differs from ledger job ${jobId}`);
	}
}

function orderedSearchJobs(jobs: readonly JobView[], arm: ReducedCpuStudyArm): JobView[] {
	const search = jobs.filter((job) => job.proposal.treatment === reducedCpuSearchTreatment(arm));
	if (search.length !== REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM) {
		throw new Error(`${arm} must contain exactly four search jobs`);
	}
	const remaining = new Map(search.map((job) => [job.proposal.jobId, job]));
	const ordered: JobView[] = [];
	let parent: string | null = null;
	while (remaining.size > 0) {
		const expected: string[] = parent === null ? [] : [parent];
		const matches: JobView[] = [...remaining.values()].filter((job) =>
			sameJson(job.proposal.proposal.parentJobIds, expected),
		);
		if (matches.length !== 1) throw new Error(`${arm} search lineage is not one exact chain`);
		const next: JobView = matches[0];
		ordered.push(next);
		remaining.delete(next.proposal.jobId);
		parent = next.proposal.jobId;
	}
	return ordered;
}

async function verifyJobArtifacts(store: ArtifactStore, jobs: readonly JobView[]): Promise<void> {
	for (const job of jobs) {
		await store.readString(job.proposal.candidate);
		if (job.measurement?.stdout) await store.readString(job.measurement.stdout);
		if (job.measurement?.stderr) await store.readString(job.measurement.stderr);
	}
}

async function readClaim(path: string, label: string): Promise<{ value: Record<string, unknown>; text: string }> {
	const text = await readPrivateRegularFile(path, label);
	return { value: record(JSON.parse(text) as unknown, label), text };
}

async function verifyDispatchClaims(input: {
	registration: ReducedCpuStudyArmPreregistration;
	raw: ReducedCpuStudyArmResult;
	preregistrationSha256: string;
	calibrationSha256: string;
	orderedSearch: readonly JobView[];
	validation: JobView;
	championSelection: ReducedCpuStudyArmResult["championSelection"];
	store: ArtifactStore;
}): Promise<void> {
	const operations = [
		...input.registration.operationClaims.candidates.map((claim, index) => ({
			operation: `candidate-${index + 1}`,
			intentPath: claim.intentPath,
			resultPath: claim.resultPath,
			job: input.orderedSearch[index],
		})),
		{
			operation: "champion-validation",
			intentPath: input.registration.operationClaims.validation.intentPath,
			resultPath: input.registration.operationClaims.validation.resultPath,
			job: input.validation,
		},
	];
	for (const operation of operations) {
		if (!operation.job) throw new Error(`${input.raw.arm} ${operation.operation} has no bound job`);
		const intent = await readClaim(operation.intentPath, `${input.raw.arm} ${operation.operation} intent`);
		const result = await readClaim(operation.resultPath, `${input.raw.arm} ${operation.operation} result`);
		exactKeys(
			intent.value,
			[
				"type",
				"protocolVersion",
				"preregistrationSha256",
				"arm",
				"branchId",
				"operation",
				"requestSha256",
				"calibrationSha256",
				"providerOrdinal",
				"deadlineMs",
				"claimedAt",
			],
			`${input.raw.arm} ${operation.operation} intent`,
		);
		exactKeys(
			result.value,
			[
				"type",
				"protocolVersion",
				"arm",
				"branchId",
				"operation",
				"intentSha256",
				"jobId",
				"manifestDigest",
				"recordedAt",
			],
			`${input.raw.arm} ${operation.operation} result`,
		);
		if (
			intent.value.type !== "reduced_cpu_dispatch_intent" ||
			intent.value.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
			intent.value.preregistrationSha256 !== input.preregistrationSha256 ||
			intent.value.calibrationSha256 !== input.calibrationSha256 ||
			intent.value.arm !== input.raw.arm ||
			intent.value.branchId !== input.raw.branchId ||
			intent.value.operation !== operation.operation
		) {
			throw new Error(`${input.raw.arm} ${operation.operation} intent binding drifted`);
		}
		digest(intent.value.preregistrationSha256, `${input.raw.arm} ${operation.operation}.preregistrationSha256`);
		digest(intent.value.calibrationSha256, `${input.raw.arm} ${operation.operation}.calibrationSha256`);
		digest(intent.value.requestSha256, `${input.raw.arm} ${operation.operation}.requestSha256`);
		if (!Number.isSafeInteger(intent.value.providerOrdinal) || Number(intent.value.providerOrdinal) < 1) {
			throw new Error(`${input.raw.arm} ${operation.operation} has no provider-bound dispatch ordinal`);
		}
		finiteNonnegative(intent.value.deadlineMs, `${input.raw.arm} ${operation.operation}.deadlineMs`);
		timestamp(intent.value.claimedAt, `${input.raw.arm} ${operation.operation}.claimedAt`);
		timestamp(result.value.recordedAt, `${input.raw.arm} ${operation.operation}.recordedAt`);
		let expectedRequest: unknown;
		if (operation.operation === "champion-validation") {
			expectedRequest = { championSelection: input.championSelection };
		} else {
			const candidateContent = await input.store.readString(operation.job.proposal.candidate);
			expectedRequest = {
				actions: JSON.parse(candidateContent) as unknown,
				hypothesis: operation.job.proposal.proposal.hypothesis,
				mechanism: operation.job.proposal.proposal.mechanism,
				predictedOutcome: operation.job.proposal.proposal.predictedOutcome,
				boundaryConditions: operation.job.proposal.proposal.boundaryConditions,
			};
		}
		if (intent.value.requestSha256 !== sha256Json(expectedRequest)) {
			throw new Error(`${input.raw.arm} ${operation.operation} intent request hash drifted`);
		}
		if (
			result.value.type !== "reduced_cpu_dispatch_result" ||
			result.value.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
			result.value.arm !== input.raw.arm ||
			result.value.branchId !== input.raw.branchId ||
			result.value.operation !== operation.operation ||
			result.value.intentSha256 !== sha256Text(intent.text) ||
			result.value.jobId !== operation.job.proposal.jobId ||
			result.value.manifestDigest !== operation.job.proposal.manifestDigest
		) {
			throw new Error(`${input.raw.arm} ${operation.operation} result binding drifted`);
		}
	}
}

function sumTaskRuntimeSeconds(jobs: readonly JobView[]): number {
	return (
		jobs.reduce(
			(total, job) => total + (job.measurement?.tasks.reduce((sum, task) => sum + task.runtimeMs, 0) ?? 0),
			0,
		) / 1_000
	);
}

function recomputeEvaluatorWaitMs(jobs: readonly JobView[]): number {
	return jobs.reduce((total, job) => {
		const waits = job.measurement?.tasks.map((task) => task.metrics.schedulerAndEvaluatorWallMs ?? 0) ?? [];
		return total + Math.max(0, ...waits);
	}, 0);
}

async function verifyArmTerminal(
	registration: ReducedCpuStudyArmPreregistration,
	raw: ReducedCpuStudyArmResult,
): Promise<void> {
	const text = await readPrivateRegularFile(
		join(registration.absoluteOutputDir, "terminal.json"),
		`${raw.arm} terminal`,
	);
	const value = record(JSON.parse(text) as unknown, `${raw.arm} terminal`);
	if (
		value.type !== "reduced_cpu_arm_terminal" ||
		value.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
		value.arm !== raw.arm ||
		value.branchId !== raw.branchId ||
		value.outcome !== "succeeded" ||
		value.failure !== null
	) {
		throw new Error(`${raw.arm} terminal file is not a bound success`);
	}
	timestamp(value.finishedAt, `${raw.arm} terminal.finishedAt`);
}

async function reconstructArm(input: {
	registration: ReducedCpuStudyArmPreregistration;
	raw: ReducedCpuStudyArmResult;
	calibration: ReducedCpuCalibration;
	preregistrationSha256: string;
	calibrationSha256: string;
}): Promise<ReconstructedArm> {
	const { registration, raw, calibration } = input;
	if (raw.arm !== registration.id) throw new Error(`arm slot ${registration.executionOrdinal} identity drifted`);
	if (raw.resolvedModelSnapshotSha256 !== sha256Json(raw.resolvedModelSnapshot)) {
		throw new Error(`${raw.arm} resolved-model snapshot hash drifted`);
	}
	if (
		raw.branchId !== raw.sessionId ||
		!raw.branchId ||
		!raw.completionPassed ||
		!raw.artifactIntegrityPassed ||
		raw.failures.length !== 0 ||
		raw.budgetStopReason !== null
	) {
		throw new Error(`${raw.arm} did not pass all raw arm completion gates`);
	}
	finiteNonnegative(raw.outputTokens, `${raw.arm}.outputTokens`);
	finiteNonnegative(raw.agentActiveMs, `${raw.arm}.agentActiveMs`);
	finiteNonnegative(raw.evaluatorWaitMs, `${raw.arm}.evaluatorWaitMs`);
	finiteNonnegative(raw.calendarMs, `${raw.arm}.calendarMs`);
	if (raw.outputTokens !== raw.usage.output) throw new Error(`${raw.arm} output-token evidence drifted`);
	if (
		raw.providerDispatches !== raw.providerGraph.actualPaidCalls ||
		raw.providerGraph.compactionCalls !== 1 ||
		raw.providerGraph.compactionProviderCalls !== 1 ||
		raw.providerGraph.unexpectedBlocked !== 0
	) {
		throw new Error(`${raw.arm} provider graph raw accounting drifted`);
	}
	if (raw.branchBudget.branchId !== raw.branchId) throw new Error(`${raw.arm} branch budget scope drifted`);
	if (raw.arm === "stock") {
		if (raw.recall !== null || raw.recallReceipt !== null)
			throw new Error("Stock contains forbidden recall evidence");
	} else if (!raw.recall?.passed || !raw.recallReceipt?.verified) {
		throw new Error(`${raw.arm} lacks successful receipt-bound recall evidence`);
	}
	if (!raw.providerGraph.passed || !raw.compaction.passed || !raw.isolation.passed) {
		throw new Error(`${raw.arm} provider, compaction, or isolation audit failed`);
	}
	if (
		raw.compaction.paidProviderCalls !== 1 ||
		raw.compaction.transportAttempts !== 1 ||
		raw.compaction.startEvents !== 1 ||
		raw.compaction.endEvents !== 1 ||
		!raw.compaction.usageAvailable ||
		raw.compaction.extensionErrors.length !== 0
	) {
		throw new Error(`${raw.arm} native compaction evidence is incomplete`);
	}
	if (raw.branchBudget.submissions !== REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM) {
		throw new Error(`${raw.arm} submission count drifted`);
	}
	if (
		raw.branchBudget.taskEvaluations !== REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM ||
		raw.branchBudget.actualTaskEvaluations !== REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM ||
		raw.branchBudget.reusedTaskEvaluations !== 0 ||
		raw.branchBudget.unevaluatedTaskEvaluations !== 0
	) {
		throw new Error(`${raw.arm} evaluator task accounting drifted`);
	}
	if (raw.jobs.length !== REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM) throw new Error(`${raw.arm} result job count drifted`);
	const ledgerText = await readPrivateRegularFile(
		join(registration.absoluteOutputDir, "evidence.jsonl"),
		`${raw.arm} ledger`,
	);
	const replayed = replayArmLedger(ledgerText, raw.arm, raw.branchId);
	assertSameJobSets(replayed.jobs, raw.jobs, raw.arm);
	const expectedTreatments = new Set([reducedCpuSearchTreatment(raw.arm), reducedCpuValidationTreatment(raw.arm)]);
	if (replayed.jobs.some((job) => !expectedTreatments.has(job.proposal.treatment))) {
		throw new Error(`${raw.arm} ledger contains an unexpected treatment`);
	}
	const store = new ArtifactStore(join(registration.absoluteOutputDir, "artifacts"));
	await verifyJobArtifacts(store, replayed.jobs);
	const orderedSearch = orderedSearchJobs(replayed.jobs, raw.arm);
	const candidates: ReducedCpuCandidateEvidence[] = [];
	for (const [index, job] of orderedSearch.entries()) {
		const content = await store.readString(job.proposal.candidate);
		candidates.push(
			buildReducedCpuCandidateEvidence({
				job,
				candidateContent: content,
				arm: raw.arm,
				branchId: raw.branchId,
				ordinal: index + 1,
				priorJobId: index === 0 ? null : orderedSearch[index - 1].proposal.jobId,
				calibration,
			}),
		);
	}
	if (!sameJson(candidates, raw.candidates)) throw new Error(`${raw.arm} recorded candidates differ from raw jobs`);
	const candidateTwo = classifyReducedCpuCandidateTwo(candidates[0], candidates[1]);
	if (!candidateTwo.exactSinglePassInsertion) throw new Error(`${raw.arm} candidate 2 violates the common contract`);
	if (!sameJson(candidateTwo, raw.candidateTwo)) throw new Error(`${raw.arm} candidate-2 classification drifted`);
	const championSelection = selectReducedCpuChampion(raw.arm, candidates, calibration);
	if (!sameJson(championSelection, raw.championSelection)) throw new Error(`${raw.arm} champion selection drifted`);
	const validationJobs = replayed.jobs.filter(
		(job) => job.proposal.treatment === reducedCpuValidationTreatment(raw.arm),
	);
	if (validationJobs.length !== 1) throw new Error(`${raw.arm} requires exactly one validation job`);
	const selected = candidates.find((candidate) => candidate.jobId === championSelection.selectedJobId);
	if (!selected) throw new Error(`${raw.arm} has no selected search champion`);
	const validationContent = await store.readString(validationJobs[0].proposal.candidate);
	const validation = buildReducedCpuChampionValidationEvidence({
		job: validationJobs[0],
		candidateContent: validationContent,
		arm: raw.arm,
		branchId: raw.branchId,
		searchChampion: selected,
		calibration,
	});
	if (!sameJson(validation, raw.validation)) throw new Error(`${raw.arm} validation evidence drifted`);
	let sealedRetestDirective: ReducedCpuStudyArmAnalysisEvidence["sealedRetestDirective"] = null;
	let resurrection: ReducedCpuStudyArmResult["resurrection"] = null;
	if (raw.arm === "M+R") {
		const directive = maybeBuildReducedCpuRetestDirective(candidateTwo, candidates[2]);
		sealedRetestDirective = directive === null ? null : sealReducedCpuRetestDirective(directive);
		if (sealedRetestDirective) {
			resurrection = assessReducedCpuResurrection({
				classification: candidateTwo,
				candidate3: candidates[2],
				candidate4: candidates[3],
				sealedDirective: sealedRetestDirective,
				calibration,
			});
		}
	}
	if (!sameJson(sealedRetestDirective, raw.retestDirective) || !sameJson(resurrection, raw.resurrection)) {
		throw new Error(`${raw.arm} retest directive or resurrection assessment drifted`);
	}
	await verifyDispatchClaims({
		registration,
		raw,
		preregistrationSha256: input.preregistrationSha256,
		calibrationSha256: input.calibrationSha256,
		orderedSearch,
		validation: validationJobs[0],
		championSelection,
		store,
	});
	await verifyArmTerminal(registration, raw);
	const sessionsRoot = join(registration.absoluteOutputDir, "sessions");
	const relativeSession = relative(sessionsRoot, raw.sessionFile);
	if (
		!isAbsolute(raw.sessionFile) ||
		relativeSession === ".." ||
		relativeSession.startsWith(`..${sep}`) ||
		isAbsolute(relativeSession)
	) {
		throw new Error(`${raw.arm} session file escaped its neutral slot`);
	}
	const sessionText = await readPrivateRegularFile(raw.sessionFile, `${raw.arm} session`);
	verifyReducedCpuCompactionEvidence(raw.compaction, sessionText);
	const usageReconciliation = reconcileReducedCpuArmUsage({
		sessionText,
		compactionUsage: raw.compaction.usage,
		rawArmUsage: raw.usage,
		rawOutputTokens: raw.outputTokens,
		expectedAgentProviderCalls: raw.providerGraph.agentProviderCalls,
	});
	if (usageReconciliation.blockedAssistantMessageCount !== raw.providerGraph.actualIntentionalBlocked) {
		throw new Error(`${raw.arm} persisted blocked-assistant accounting drifted`);
	}
	const workspaceEntries = (await readdir(join(registration.absoluteOutputDir, "workspace"))).sort();
	if (!sameJson(workspaceEntries, [...raw.isolation.workspaceEntries].sort()) || workspaceEntries.length !== 0) {
		throw new Error(`${raw.arm} workspace isolation drifted`);
	}
	if (raw.evaluatorWaitMs !== recomputeEvaluatorWaitMs(replayed.jobs)) {
		throw new Error(`${raw.arm} evaluator wait accounting drifted`);
	}
	return {
		arm: raw.arm,
		registration,
		raw,
		block: {
			arm: raw.arm,
			branchId: raw.branchId,
			candidates,
			championSelection,
			validation,
			resurrection,
			recallReceipt: raw.recallReceipt,
		},
		sealedRetestDirective,
		sessionText,
		evaluatorCpuSeconds: sumTaskRuntimeSeconds(replayed.jobs),
		ledgerEventCount: replayed.eventCount,
	};
}

export function verifyReducedCpuEvaluationIdentities(
	identities: readonly ReducedCpuEvaluationIdentity[],
): ReducedCpuEvaluationIdentitySummary {
	if (identities.length === 0) throw new Error("evaluation identity set is empty");
	const jobIds = new Set<string>();
	const manifestDigests = new Set<string>();
	const externalJobIds = new Set<string>();
	for (const identity of identities) {
		const jobId = nonemptyString(identity.jobId, `${identity.scope}.jobId`);
		const manifestDigest = digest(identity.manifestDigest, `${identity.scope}.manifestDigest`);
		if (jobIds.has(jobId)) throw new Error(`campaign-wide duplicate job ID: ${jobId}`);
		if (manifestDigests.has(manifestDigest)) {
			throw new Error(`campaign-wide duplicate manifest digest: ${manifestDigest}`);
		}
		if (identity.externalJobId !== null) {
			const externalJobId = nonemptyString(identity.externalJobId, `${identity.scope}.externalJobId`);
			if (externalJobIds.has(externalJobId)) {
				throw new Error(`campaign-wide duplicate external job ID: ${externalJobId}`);
			}
			externalJobIds.add(externalJobId);
		}
		jobIds.add(jobId);
		manifestDigests.add(manifestDigest);
	}
	return {
		count: identities.length,
		jobIdsUnique: true,
		manifestDigestsUnique: true,
		externalJobIdsUniqueWhenPresent: true,
		externalJobIdsPresent: externalJobIds.size,
		externalJobIdsAbsent: identities.length - externalJobIds.size,
		coldAdapterExternalIdentityLimitation: "null-allowed-dispatch-claims-are-the-exclusive-attempt-identity",
	};
}

function continuityEvidence(
	arm: ReconstructedArm,
	allArms: readonly ReconstructedArm[],
): ReducedCpuStudyArmAnalysisEvidence["continuity"] {
	const absentTools = new Set<string>(arm.raw.isolation.absentToolNames);
	const foreign = allArms.filter((candidate) => candidate.arm !== arm.arm);
	const localDigests = new Set(arm.block.candidates.map((candidate) => candidate.candidateDigest));
	const forbiddenJobIdsFound = foreign
		.flatMap((candidate) => candidate.raw.jobs.map((job) => job.proposal.jobId))
		.filter((jobId) => arm.sessionText.includes(jobId));
	const forbiddenCandidateDigestsFound = foreign
		.flatMap((candidate) => candidate.block.candidates.map((candidate) => candidate.candidateDigest))
		.filter((candidateDigest) => !localDigests.has(candidateDigest) && arm.sessionText.includes(candidateDigest));
	const recall = arm.raw.recall;
	return {
		compactionCount: arm.raw.compaction.startEvents,
		compactionAfterCandidateOrdinal: 2,
		recallAttempts: recall?.toolCallCount ?? 0,
		successfulRecallAttempts: recall?.passed ? 1 : 0,
		expectedRecalledJobIds: recall?.expectedJobIds ?? [],
		recalledJobIds: recall?.returnedJobIds ?? [],
		sealedContextAudit: {
			kernelStateInspected: arm.raw.isolation.ipythonStateMessagePresent === false,
			toolStateInspected:
				arm.raw.isolation.providerPayloadForbiddenToolMentions.length === 0 &&
				!arm.raw.activeToolNames.some((name) => absentTools.has(name)),
			workspaceStateInspected: arm.raw.isolation.workspaceEntries.length === 0,
			forbiddenPriorJobIdsFound: [...new Set(forbiddenJobIdsFound)].sort(),
			forbiddenPriorCandidateDigestsFound: [...new Set(forbiddenCandidateDigestsFound)].sort(),
		},
	};
}

function analysisEvidence(
	arm: ReconstructedArm,
	allArms: readonly ReconstructedArm[],
): ReducedCpuStudyArmAnalysisEvidence {
	const usage = arm.raw.usage;
	return {
		block: arm.block,
		integrityErrors: [],
		efficiency: {
			agentProviderCalls: arm.raw.providerGraph.agentProviderCalls,
			compactionProviderCalls: arm.raw.providerGraph.compactionProviderCalls,
			compactionTransportAttempts: arm.raw.providerGraph.compactionTransportAttempts,
			providerCalls: arm.raw.providerGraph.actualPaidCalls,
			blockedProviderCalls: arm.raw.providerGraph.actualIntentionalBlocked,
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheReadTokens: usage.cacheRead,
			cacheWriteTokens: usage.cacheWrite,
			totalTokens: usage.totalTokens,
			evaluatorDispatches: arm.raw.branchBudget.submissions,
			evaluatorTaskEvaluations: arm.raw.branchBudget.actualTaskEvaluations,
			evaluatorWallMs: arm.raw.evaluatorWaitMs,
			evaluatorCpuSeconds: arm.evaluatorCpuSeconds,
		},
		continuity: continuityEvidence(arm, allArms),
		sealedRetestDirective: arm.sealedRetestDirective,
	};
}

export function deriveReducedCpuAuthoritativeDecision(
	analysis: Pick<ReducedCpuStudyAnalysis, "overall">,
): ReducedCpuAuthoritativeDecision {
	const selected = analysis.overall.selectedArm;
	const gpuTransferEligibleArm =
		analysis.overall.status === "selected" && (selected === "M" || selected === "M+R") ? selected : null;
	return {
		authority: "post-run-model-free-analyzer-only",
		runnerBlockDecisionDisposition: "ignored-preliminary-nonauthoritative",
		status: analysis.overall.status,
		winnerArm: selected,
		gpuTransferAuthorized: gpuTransferEligibleArm !== null,
		gpuTransferEligibleArm,
		reason:
			gpuTransferEligibleArm === null
				? `${analysis.overall.reason}; no treatment GPU transfer is authorized`
				: `${analysis.overall.reason}; authorize exactly one ${gpuTransferEligibleArm} NanoGPT transfer check`,
	};
}

function validateCampaignAccounting(result: ReducedCpuStudyResult, arms: readonly ReconstructedArm[]): void {
	const tracker = result.providerTracker;
	const studyJobs = arms.flatMap((arm) => arm.raw.jobs);
	if (arms.length !== REDUCED_CPU_STUDY_ARMS.length || studyJobs.length !== 15) {
		throw new Error("campaign must contain exactly three arms and fifteen study jobs");
	}
	const jobIds = studyJobs.map((job) => job.proposal.jobId);
	const manifestDigests = studyJobs.map((job) => job.proposal.manifestDigest);
	const externalJobIds = studyJobs
		.map((job) => job.state.externalJobId)
		.filter((externalJobId): externalJobId is string => externalJobId !== null);
	const recomputedIdentityAudit = {
		jobCount: 15,
		expectedJobCount: 15,
		jobIdsUnique: new Set(jobIds).size === 15,
		manifestDigestsUnique: new Set(manifestDigests).size === 15,
		externalJobIdCount: externalJobIds.length,
		externalJobIdsValid: externalJobIds.every((externalJobId) => externalJobId.length > 0),
		externalJobIdsUnique: new Set(externalJobIds).size === externalJobIds.length,
		dispatchClaimPairCount: 15,
		expectedDispatchClaimPairCount: 15,
		dispatchClaimPairsExact: true,
		passed: true,
	};
	if (
		!recomputedIdentityAudit.jobIdsUnique ||
		!recomputedIdentityAudit.manifestDigestsUnique ||
		!recomputedIdentityAudit.externalJobIdsValid ||
		!recomputedIdentityAudit.externalJobIdsUnique
	) {
		throw new Error("campaign-wide study job identity audit failed");
	}
	if (!sameJson(result.campaignIdentityAudit, recomputedIdentityAudit)) {
		throw new Error("runner identity audit differs from the independent analyzer recomputation");
	}
	const sum = <K extends keyof ReducedCpuStudyArmResult>(key: K): number =>
		arms.reduce((total, arm) => total + Number(arm.raw[key]), 0);
	if (tracker.accepted !== sum("providerDispatches")) throw new Error("campaign provider dispatch accounting drifted");
	if (tracker.compactionCalls !== REDUCED_CPU_STUDY_ARMS.length) throw new Error("campaign compaction count drifted");
	if (
		tracker.intentionalBlocked !==
		arms.reduce((total, arm) => total + arm.raw.providerGraph.actualIntentionalBlocked, 0)
	) {
		throw new Error("campaign blocked-provider accounting drifted");
	}
	if (tracker.unexpectedBlocked !== 0) throw new Error("campaign contains an unexpected blocked provider call");
	const recomputedCompactionUsage = arms.reduce(
		(total, arm) => addUsage(total, arm.raw.compaction.usage),
		zeroUsage(),
	);
	validateUsage(tracker.compactionUsage, "campaign.providerTracker.compactionUsage");
	if (!sameJson(tracker.compactionUsage, recomputedCompactionUsage)) {
		throw new Error("campaign compaction usage differs from the three verified arm compactions");
	}
	if (tracker.outputTokens !== sum("outputTokens")) throw new Error("campaign output-token accounting drifted");
	if (tracker.activeMs !== sum("agentActiveMs") || result.agentActiveMs !== tracker.activeMs) {
		throw new Error("campaign active-time accounting drifted");
	}
	if (result.evaluatorWaitMs !== sum("evaluatorWaitMs")) throw new Error("campaign evaluator-time accounting drifted");
	if (result.strictLedgerEventCount !== arms.reduce((total, arm) => total + arm.raw.jobs.length, 0)) {
		throw new Error("campaign recorded job count drifted");
	}
}

function armByResult(
	result: ReducedCpuStudyResult,
	preregistration: ReducedCpuStudyPreregistration,
): Array<{ registration: ReducedCpuStudyArmPreregistration; raw: ReducedCpuStudyArmResult }> {
	const rawByArm = new Map<ReducedCpuStudyArm, ReducedCpuStudyArmResult>();
	for (const raw of result.arms) {
		if (!REDUCED_CPU_STUDY_ARMS.includes(raw.arm)) throw new Error(`unknown result arm ${String(raw.arm)}`);
		if (rawByArm.has(raw.arm)) throw new Error(`duplicate result arm ${raw.arm}`);
		rawByArm.set(raw.arm, raw);
	}
	return preregistration.executionOrder.map((arm, index) => {
		const registration = preregistration.arms[index];
		const raw = rawByArm.get(arm);
		if (!registration || registration.id !== arm || !raw) throw new Error(`missing bound arm ${arm}`);
		return { registration, raw };
	});
}

export async function analyzeCompletedReducedCpuStudy(input: {
	preregistrationPath: string;
}): Promise<{ artifact: ReducedCpuAuthoritativeAnalysisArtifact; analysisPath: string }> {
	const preregistrationPath = resolve(input.preregistrationPath);
	const verified = await readAndVerifyReducedCpuStudyPreregistration(preregistrationPath, {
		requireFreshExecution: false,
	});
	const preregistration = verified.preregistration;
	const analysisPath = join(preregistration.launch.campaignRoot, "analysis.json");
	await assertMissing(analysisPath);
	const resultText = await readPrivateRegularFile(preregistration.launch.resultPath, "campaign result");
	const result = parseCompletedResult(JSON.parse(resultText) as unknown);
	if (
		result.outputDir !== preregistration.launch.outputRoot ||
		result.calibrationResultPath !== preregistration.calibration.absolutePath ||
		result.calibrationResultSha256 !== preregistration.calibration.byteSha256 ||
		result.model !== preregistration.model.fullyQualifiedModel ||
		result.defaultSystemPrompt !== true ||
		result.providerMaxRetries !== preregistration.model.providerRetries ||
		result.transport !== preregistration.model.transport
	) {
		throw new Error("campaign result does not match its preregistered runtime and artifact paths");
	}
	const activeToolsByArm = record(result.activeToolsByArm, "result.activeToolsByArm");
	exactKeys(activeToolsByArm, REDUCED_CPU_STUDY_ARMS, "result.activeToolsByArm");
	for (const registration of preregistration.arms) {
		if (!sameJson(activeToolsByArm[registration.id], registration.registeredCustomTools)) {
			throw new Error(`${registration.id} registered tool set drifted from preregistration`);
		}
	}
	const calibrationText = await readPrivateRegularFile(preregistration.calibration.absolutePath, "calibration");
	if (sha256Text(calibrationText) !== preregistration.calibration.byteSha256) {
		throw new Error("calibration file bytes drifted");
	}
	const calibrationEnvelope = JSON.parse(calibrationText) as unknown as ReducedCpuCalibrationEnvelope;
	const calibration = parseReducedCpuCalibration(calibrationEnvelope);
	if (sha256Json(calibration) !== preregistration.calibration.parsedSha256) {
		throw new Error("calibration parsed identity drifted");
	}
	const reconstructed: ReconstructedArm[] = [];
	for (const arm of armByResult(result, preregistration)) {
		reconstructed.push(
			await reconstructArm({
				...arm,
				calibration,
				preregistrationSha256: preregistration.preregistrationSha256,
				calibrationSha256: preregistration.calibration.byteSha256,
			}),
		);
	}
	validateCampaignAccounting(result, reconstructed);
	const calibrationJob = jobFromCalibrationEnvelope(calibrationEnvelope);
	const identities = verifyReducedCpuEvaluationIdentities([
		{
			scope: "calibration",
			jobId: calibrationJob.proposal.jobId,
			manifestDigest: calibrationJob.proposal.manifestDigest,
			externalJobId: calibrationJob.state.externalJobId,
		},
		...reconstructed.flatMap((arm) =>
			arm.raw.jobs.map((job) => ({
				scope: arm.arm,
				jobId: job.proposal.jobId,
				manifestDigest: job.proposal.manifestDigest,
				externalJobId: job.state.externalJobId,
			})),
		),
	]);
	const armEvidence = reconstructed.map((arm) => analysisEvidence(arm, reconstructed));
	const analysis = analyzeReducedCpuStudy({ calibration, arms: armEvidence });
	if (analysis.overall.status === "invalid" || analysis.arms.some((arm) => !arm.valid)) {
		throw new Error("authoritative analysis rejected one or more completed arm evidence blocks");
	}
	const decision = deriveReducedCpuAuthoritativeDecision(analysis);
	const crossArmSessionAuditPassed = armEvidence.every(
		(arm) =>
			arm.continuity.sealedContextAudit.forbiddenPriorJobIdsFound.length === 0 &&
			arm.continuity.sealedContextAudit.forbiddenPriorCandidateDigestsFound.length === 0,
	);
	if (!crossArmSessionAuditPassed) throw new Error("cross-arm session evidence contamination was detected");
	const artifact: ReducedCpuAuthoritativeAnalysisArtifact = {
		schemaVersion: 1,
		type: "reduced_cpu_study_authoritative_analysis",
		protocol: REDUCED_CPU_AUTHORITATIVE_ANALYSIS_PROTOCOL,
		studyProtocol: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		bindings: {
			preregistrationPath,
			preregistrationFileSha256: verified.fileSha256,
			preregistrationSha256: preregistration.preregistrationSha256,
			resultPath: preregistration.launch.resultPath,
			resultFileSha256: sha256Text(resultText),
			calibrationPath: preregistration.calibration.absolutePath,
			calibrationFileSha256: preregistration.calibration.byteSha256,
			calibrationParsedSha256: preregistration.calibration.parsedSha256,
		},
		integrity: {
			resultCompleted: true,
			preregistrationAndSourcesVerified: true,
			calibrationVerified: true,
			armLedgersVerified: true,
			armArtifactsVerified: true,
			armTerminalFilesVerified: true,
			dispatchClaimsVerified: true,
			compactionEvidenceVerified: true,
			usageRecomputedFromPersistedSessions: true,
			crossArmSessionAuditPassed: true,
			identities,
		},
		analysis,
		decision,
	};
	await writeReducedCpuStudyAnalysisExclusive(analysisPath, artifact);
	return { artifact, analysisPath };
}

function parseCli(argv: readonly string[]): { preregistrationPath: string } {
	if (argv.length !== 2 || argv[0] !== "--preregistration" || !argv[1]) {
		throw new Error("Usage: reduced-cpu-study-analysis --preregistration <absolute-path>");
	}
	if (!isAbsolute(argv[1]) || resolve(argv[1]) !== argv[1]) {
		throw new Error("--preregistration must be a normalized absolute path");
	}
	return { preregistrationPath: argv[1] };
}

async function main(): Promise<void> {
	const result = await analyzeCompletedReducedCpuStudy(parseCli(process.argv.slice(2)));
	process.stdout.write(
		`${canonicalJson(
			toJsonValue({
				type: "reduced_cpu_study_analysis_complete",
				analysisPath: result.analysisPath,
				decision: result.artifact.decision,
			}),
		)}\n`,
	);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url) && import.meta.url === pathToFileURL(invokedPath).href) {
	void main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

import assert from "node:assert/strict";
import { chmod, mkdir, open, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type AssistantMessage, Type, type Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	type ExtensionAPI,
	type ExtensionError,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	type SessionManager as SessionManagerType,
	SettingsManager,
	type SettingsManager as SettingsManagerType,
} from "@earendil-works/pi-coding-agent";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { validateCompilerGymHardenedPaidResolvedModelSnapshot } from "./compiler-gym-hardened-paid-provider.js";
import type { ResearchController } from "./controller.js";
import {
	loadReducedCpuSearchEvidence,
	openReducedCpuStudyController,
	prepareReducedCpuRetestDirective,
	prepareReducedCpuStudyOutput,
	submitReducedCpuChampionValidation,
	submitReducedCpuSearchCandidate,
	verifyReducedCpuStudyArtifacts,
	verifyReducedCpuStudyLedgerStrict,
} from "./reduced-cpu-study-controller.js";
import {
	claimReducedCpuStudyAttemptLocks,
	REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS,
	REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT,
	type ReducedCpuStudyPreregistration,
	readAndVerifyReducedCpuStudyPreregistration,
} from "./reduced-cpu-study-preregistration.js";
import {
	assessReducedCpuResurrection,
	classifyReducedCpuCandidateTwo,
	decideReducedCpuBlockComparisons,
	isReducedCpuMeasuredVerifierRejection,
	parseReducedCpuCalibration,
	REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM,
	REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM,
	REDUCED_CPU_SEARCH_TASKS,
	REDUCED_CPU_STUDY_ARMS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	type ReducedCpuArmBlock,
	type ReducedCpuBlockComparisonDecision,
	type ReducedCpuCalibration,
	type ReducedCpuCandidateEvidence,
	type ReducedCpuCandidateTwoClassification,
	type ReducedCpuChampionSelection,
	type ReducedCpuChampionValidationEvidence,
	type ReducedCpuChampionValidationEnvelope,
	type ReducedCpuMeasuredRecallReceipt,
	type ReducedCpuResurrectionAssessment,
	type ReducedCpuStudyArm,
	type ReducedCpuStudyEvaluationEnvelope,
	type SealedReducedCpuRetestDirective,
	selectReducedCpuChampion,
} from "./reduced-cpu-study-protocol.js";
import {
	captureStockInterfaceParityResolvedModelSnapshot,
	type StockInterfaceParityResolvedModelSnapshot,
} from "./stock-interface-parity.js";
import type { JobView } from "./types.js";

export const REDUCED_CPU_OUTPUT_TOKEN_LIMIT = 32_000;
export const REDUCED_CPU_PROVIDER_DISPATCH_LIMIT = 17;
export const REDUCED_CPU_ACTIVE_MS_LIMIT = 600_000;
export const REDUCED_CPU_CALENDAR_MS_LIMIT = 900_000;
export const REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS = 1;
export const REDUCED_CPU_COMPACTION_INSTRUCTION = REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS;

const PROVIDER_TIMEOUT_MS = 120_000;

interface CliOptions {
	preregistrationPath: string;
	submit: boolean;
}

export type ArmPhase = "prefix" | "post-compaction" | "terminal";
type BudgetStopReason = "provider-dispatches" | "output-tokens" | "active-seconds" | "calendar-seconds";

export interface ProviderTracker {
	accepted: number;
	compactionCalls: number;
	intentionalBlocked: number;
	unexpectedBlocked: number;
	outputTokens: number;
	activeMs: number;
	compactionUsage: Usage;
	blockedReasons: string[];
}

interface ProviderRequestRecord {
	ordinal: number;
	eventSequence: number;
	payloadSha256: string;
	payload: unknown;
}

interface ToolDispatchRecord {
	toolName: string;
	providerOrdinal: number;
	eventSequence: number;
	isError: boolean;
	args: unknown;
	details: unknown;
}

export interface ArmGuardState {
	arm: ReducedCpuStudyArm;
	outputDir: string;
	branchId: string;
	preregistrationSha256: string;
	calibrationSha256: string;
	deadlineMs: number;
	studyStartedAtMs: number;
	phase: ArmPhase;
	stopAfterToolFailure: boolean;
	recallCompleted: boolean;
	currentProviderOrdinal: number;
	sealedRetest: SealedReducedCpuRetestDirective | null;
	toolDispatches: ToolDispatchRecord[];
	eventSequence: number;
	fatalGateErrors: string[];
	toolArgs: Map<string, unknown>;
	providerRequests: ProviderRequestRecord[];
	providerRequestStartedAtMs: number | null;
	providerWatchdog: ReturnType<typeof setTimeout> | null;
	expectedBlockedAssistantEnds: number;
	evaluatorSettlements: Set<Promise<void>>;
	evaluatorSettlementErrors: string[];
	compactionPreparation: {
		firstKeptEntryId: string;
		messagesToSummarize: number;
		turnPrefixMessages: number;
		isSplitTurn: boolean;
		customInstructions: string | null;
	} | null;
}

export interface ReducedCpuCompactionAudit {
	instruction: typeof REDUCED_CPU_COMPACTION_INSTRUCTION;
	keepRecentTokens: typeof REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS;
	summary: string;
	summarySha256: string;
	firstKeptEntryId: string;
	expectedFirstKeptEntryId: string;
	tokensBefore: number;
	fromHook: boolean;
	paidProviderCalls: 1;
	transportAttempts: 1;
	providerPayloadSha256: string;
	providerPayloadPriority: boolean;
	providerPayloadToolsAbsent: boolean;
	providerResponseStatus: number;
	usage: Usage;
	usageAvailable: true;
	startEvents: number;
	endEvents: number;
	extensionErrors: ExtensionError[];
	passed: boolean;
}

export interface ReducedCpuIsolationAudit {
	mode: "typed-evaluator-no-builtin-tools";
	activeToolNames: string[];
	absentToolNames: ["ipython", "bash", "edit"];
	workspaceEntries: string[];
	providerPayloadForbiddenToolMentions: string[];
	ipythonStateMessagePresent: boolean;
	passed: boolean;
}

export interface ReducedCpuRecallAudit {
	toolCallCount: number;
	returnedJobIds: string[];
	expectedJobIds: string[];
	foreignJobIds: string[];
	recallProviderOrdinal: number | null;
	laterEvaluationProviderOrdinal: number | null;
	causalProviderBoundary: boolean;
	passed: boolean;
}

export interface ReducedCpuProviderGraphAudit {
	expectedPaidCalls: number;
	actualPaidCalls: number;
	agentProviderCalls: number;
	compactionProviderCalls: 1;
	compactionTransportAttempts: 1;
	expectedIntentionalBlocked: 2;
	actualIntentionalBlocked: number;
	modelEvaluationCalls: number;
	uniqueEvaluationProviderOrdinals: number[];
	compactionCalls: number;
	unexpectedBlocked: number;
	passed: boolean;
}

export interface ReducedCpuStudyArmResult {
	arm: ReducedCpuStudyArm;
	branchId: string;
	sessionId: string;
	sessionFile: string;
	resolvedModelSnapshot: StockInterfaceParityResolvedModelSnapshot;
	resolvedModelSnapshotSha256: string;
	activeToolNames: string[];
	candidates: ReducedCpuCandidateEvidence[];
	candidateTwo: ReducedCpuCandidateTwoClassification;
	retestDirective: SealedReducedCpuRetestDirective | null;
	resurrection: ReducedCpuResurrectionAssessment | null;
	championSelection: ReducedCpuChampionSelection;
	validation: ReducedCpuChampionValidationEvidence | null;
	compaction: ReducedCpuCompactionAudit;
	isolation: ReducedCpuIsolationAudit;
	recall: ReducedCpuRecallAudit | null;
	recallReceipt: ReducedCpuMeasuredRecallReceipt | null;
	providerGraph: ReducedCpuProviderGraphAudit;
	providerDispatches: number;
	usage: Usage;
	outputTokens: number;
	agentActiveMs: number;
	evaluatorWaitMs: number;
	calendarMs: number;
	budgetStopReason: BudgetStopReason | null;
	branchBudget: ReturnType<ResearchController["budgetStatus"]>;
	jobs: JobView[];
	artifactIntegrityPassed: boolean;
	completionPassed: boolean;
	failures: string[];
}

export interface ReducedCpuStudyResult {
	schemaVersion: 1;
	type: "reduced_cpu_study";
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	outcome: "succeeded" | "budget-stopped" | "failed";
	failure: string | null;
	outputDir: string;
	calibrationResultPath: string;
	calibrationResultSha256: string;
	model: string;
	defaultSystemPrompt: true;
	providerMaxRetries: 0;
	transport: "sse";
	providerTracker: ProviderTracker;
	activeToolsByArm: Record<ReducedCpuStudyArm, string[]>;
	startedAt: string;
	finishedAt: string;
	calendarMs: number;
	agentActiveMs: number;
	evaluatorWaitMs: number;
	budgetStopReason: BudgetStopReason | null;
	arms: ReducedCpuStudyArmResult[];
	blockDecision: ReducedCpuBlockComparisonDecision | null;
	strictLedgerIntegrityPassed: boolean;
	strictLedgerEventCount: number;
	sourceIntegrityPassed: boolean;
	noRetries: boolean;
	noReplacements: boolean;
	noDuplicates: boolean;
	campaignIdentityAudit: ReducedCpuCampaignIdentityAudit;
	noMeasurementReuse: boolean;
	noCrossArmEvidence: boolean;
	completionPassed: boolean;
}

export interface ReducedCpuCampaignIdentityAudit {
	jobCount: number;
	expectedJobCount: number;
	jobIdsUnique: boolean;
	manifestDigestsUnique: boolean;
	externalJobIdCount: number;
	externalJobIdsValid: boolean;
	externalJobIdsUnique: boolean;
	dispatchClaimPairCount: number;
	expectedDispatchClaimPairCount: number;
	dispatchClaimPairsExact: boolean;
	passed: boolean;
}

export type DispatchSlot = "candidate-1" | "candidate-2" | "candidate-3" | "candidate-4" | "champion-validation";

const REDUCED_CPU_DISPATCH_SLOTS: readonly DispatchSlot[] = [
	"candidate-1",
	"candidate-2",
	"candidate-3",
	"candidate-4",
	"champion-validation",
];

export interface ReducedCpuDispatchClaimPair {
	arm: ReducedCpuStudyArm;
	branchId: string;
	operation: DispatchSlot;
	intentText: string;
	resultText: string;
}

export function auditReducedCpuCampaignJobIdentities(input: {
	jobs: readonly JobView[];
	dispatchClaimPairs: readonly ReducedCpuDispatchClaimPair[];
}): ReducedCpuCampaignIdentityAudit {
	const expectedJobCount = REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM * REDUCED_CPU_STUDY_ARMS.length;
	const jobIds = input.jobs.map((job) => job.proposal.jobId);
	const manifestDigests = input.jobs.map((job) => job.proposal.manifestDigest);
	const externalJobIds = input.jobs
		.map((job) => job.state.externalJobId)
		.filter((externalJobId): externalJobId is string => externalJobId !== null);
	const externalJobIdsValid = externalJobIds.every((externalJobId) => externalJobId.length > 0);
	const jobById = new Map(input.jobs.map((job) => [job.proposal.jobId, job]));
	const seenOperations = new Set<string>();
	const claimedJobIds = new Set<string>();
	const dispatchClaimPairsExact = input.dispatchClaimPairs.every((pair) => {
		let intent: unknown;
		let result: unknown;
		try {
			intent = JSON.parse(pair.intentText) as unknown;
			result = JSON.parse(pair.resultText) as unknown;
		} catch {
			return false;
		}
		if (!isRecord(intent) || !isRecord(result)) return false;
		const operationIdentity = `${pair.arm}:${pair.operation}`;
		if (
			!REDUCED_CPU_STUDY_ARMS.includes(pair.arm) ||
			!REDUCED_CPU_DISPATCH_SLOTS.includes(pair.operation) ||
			seenOperations.has(operationIdentity)
		) {
			return false;
		}
		seenOperations.add(operationIdentity);
		if (
			intent.type !== "reduced_cpu_dispatch_intent" ||
			result.type !== "reduced_cpu_dispatch_result" ||
			intent.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
			result.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
			intent.arm !== pair.arm ||
			result.arm !== pair.arm ||
			intent.branchId !== pair.branchId ||
			result.branchId !== pair.branchId ||
			intent.operation !== pair.operation ||
			result.operation !== pair.operation ||
			result.intentSha256 !== sha256Text(pair.intentText) ||
			typeof result.jobId !== "string" ||
			typeof result.manifestDigest !== "string"
		) {
			return false;
		}
		const job = jobById.get(result.jobId);
		if (
			!job ||
			job.proposal.branchId !== pair.branchId ||
			job.proposal.manifestDigest !== result.manifestDigest ||
			claimedJobIds.has(result.jobId)
		)
			return false;
		claimedJobIds.add(result.jobId);
		return true;
	});
	const expectedDispatchClaimPairCount = expectedJobCount;
	const audit = {
		jobCount: input.jobs.length,
		expectedJobCount,
		jobIdsUnique: new Set(jobIds).size === jobIds.length,
		manifestDigestsUnique: new Set(manifestDigests).size === manifestDigests.length,
		externalJobIdCount: externalJobIds.length,
		externalJobIdsValid,
		externalJobIdsUnique: new Set(externalJobIds).size === externalJobIds.length,
		dispatchClaimPairCount: input.dispatchClaimPairs.length,
		expectedDispatchClaimPairCount,
		dispatchClaimPairsExact:
			dispatchClaimPairsExact &&
			input.dispatchClaimPairs.length === expectedDispatchClaimPairCount &&
			seenOperations.size === expectedDispatchClaimPairCount &&
			claimedJobIds.size === expectedJobCount,
	};
	return {
		...audit,
		passed:
			audit.jobCount === audit.expectedJobCount &&
			audit.jobIdsUnique &&
			audit.manifestDigestsUnique &&
			audit.externalJobIdsValid &&
			audit.externalJobIdsUnique &&
			audit.dispatchClaimPairsExact,
	};
}

interface ArmRuntime {
	arm: ReducedCpuStudyArm;
	outputDir: string;
	branchId: string;
	workspace: string;
	session: AgentSession;
	sessionManager: SessionManagerType;
	settingsManager: SettingsManagerType;
	sessionFile: string;
	events: AgentSessionEvent[];
	extensionErrors: ExtensionError[];
	assistantMessages: AssistantMessage[];
	resolvedModelSnapshot: StockInterfaceParityResolvedModelSnapshot;
	startedAtMs: number;
	unsubscribe: () => void;
}

function parseOptions(argv: readonly string[]): CliOptions {
	let preregistrationPath: string | null = null;
	let submit = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--preregistration") {
			const value = argv[index + 1];
			if (!value) throw new Error(`${argument} requires a path`);
			preregistrationPath = resolve(value);
			index++;
			continue;
		}
		if (argument === "--submit" && !submit) {
			submit = true;
			continue;
		}
		throw new Error(`Unknown or duplicate argument: ${argument}`);
	}
	if (!preregistrationPath) {
		throw new Error("Usage: reduced-cpu-study --preregistration <absolute-path> --submit");
	}
	return { preregistrationPath, submit };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function stringLeaves(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringLeaves);
	if (isRecord(value)) return Object.values(value).flatMap(stringLeaves);
	return [];
}

function providerToolNames(payload: Record<string, unknown>): string[] {
	if (!Array.isArray(payload.tools)) return [];
	return payload.tools
		.map((tool) => (isRecord(tool) && typeof tool.name === "string" ? tool.name : null))
		.filter((name): name is string => name !== null)
		.sort();
}

function assertProviderPayload(payload: Record<string, unknown>, state: ArmGuardState): void {
	assert.equal(payload.model, FROZEN_CAMPAIGN.model.id, "provider payload model drifted");
	assert.equal(payload.service_tier, FROZEN_CAMPAIGN.model.serviceTier, "provider service tier drifted");
	assert.ok(isRecord(payload.reasoning), "provider reasoning payload is absent");
	assert.equal(payload.reasoning.effort, FROZEN_CAMPAIGN.model.thinkingLevel, "provider reasoning effort drifted");
	const expected =
		state.arm !== "stock" && state.phase === "post-compaction" && !state.recallCompleted
			? ["autoresearch_evaluate", "autoresearch_recall"]
			: ["autoresearch_evaluate"];
	assert.deepEqual(providerToolNames(payload), expected.sort(), "provider phase tool set drifted");
}

function sumUsage(messages: readonly AssistantMessage[]): Usage {
	return messages.reduce<Usage>(
		(total, message) => ({
			input: total.input + message.usage.input,
			output: total.output + message.usage.output,
			cacheRead: total.cacheRead + message.usage.cacheRead,
			cacheWrite: total.cacheWrite + message.usage.cacheWrite,
			totalTokens: total.totalTokens + message.usage.totalTokens,
			cost: {
				input: total.cost.input + message.usage.cost.input,
				output: total.cost.output + message.usage.cost.output,
				cacheRead: total.cost.cacheRead + message.usage.cost.cacheRead,
				cacheWrite: total.cost.cacheWrite + message.usage.cost.cacheWrite,
				total: total.cost.total + message.usage.cost.total,
			},
		}),
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	);
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

export function accountReducedCpuCompactionAttempt(input: {
	tracker: ProviderTracker;
	messages: readonly AssistantMessage[];
	activeMs: number;
	recordArmActiveMs: (delta: number) => void;
	recordArmOutputTokens: (tokens: number) => void;
}): void {
	if (!Number.isSafeInteger(input.activeMs) || input.activeMs < 0) {
		throw new Error("compaction active time must be a nonnegative integer");
	}
	input.tracker.activeMs += input.activeMs;
	input.recordArmActiveMs(input.activeMs);
	for (const message of input.messages) {
		input.tracker.compactionUsage = addUsage(input.tracker.compactionUsage, message.usage);
		input.tracker.outputTokens += message.usage.output;
		input.recordArmOutputTokens(message.usage.output);
	}
}

function expectedProviderCalls(arm: ReducedCpuStudyArm, retestActive: boolean): number {
	if (arm === "stock") return 5;
	if (arm === "M") return 6;
	return retestActive ? 5 : 6;
}

export function expectedReducedCpuProviderGraph(input: { arm: ReducedCpuStudyArm; retestActive: boolean }): {
	paidCalls: number;
	intentionalBlocked: 2;
	modelEvaluationCalls: 3 | 4;
	recallCalls: 0 | 1;
	compactionCalls: 1;
} {
	return {
		paidCalls: expectedProviderCalls(input.arm, input.retestActive),
		intentionalBlocked: 2,
		modelEvaluationCalls: input.arm === "M+R" && input.retestActive ? 3 : 4,
		recallCalls: input.arm === "stock" ? 0 : 1,
		compactionCalls: 1,
	};
}

export function reducedCpuActiveTools(arm: ReducedCpuStudyArm): string[] {
	return arm === "stock" ? ["autoresearch_evaluate"] : ["autoresearch_evaluate", "autoresearch_recall"];
}

export function reducedCpuEvaluationAllowed(input: {
	arm: ReducedCpuStudyArm;
	phase: ArmPhase;
	recallCompleted: boolean;
}): boolean {
	return !(input.arm !== "stock" && input.phase === "post-compaction" && !input.recallCompleted);
}

export function createReducedCpuArmOutputTokenCounter(): {
	current: () => number;
	record: (tokens: number) => void;
} {
	let outputTokens = 0;
	return {
		current: () => outputTokens,
		record: (tokens) => {
			if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error("output tokens must be nonnegative integers");
			outputTokens += tokens;
		},
	};
}

async function promptUntilSettled(session: AgentSession, prompt: string, deadlineMs: number): Promise<void> {
	if (Date.now() >= deadlineMs) throw new Error("calendar deadline expired before provider dispatch");
	await session.promptAndWait(prompt);
	if (Date.now() > deadlineMs) throw new Error("calendar deadline expired after settled model/evaluator execution");
}

export function reducedCpuDispatchBudgetReason(input: {
	tracker: ProviderTracker;
	armOutputTokens: number;
	armActiveMs: number;
	armStartedAtMs: number;
	studyStartedAtMs: number;
	nowMs: number;
}): BudgetStopReason | null {
	if (input.tracker.accepted >= REDUCED_CPU_PROVIDER_DISPATCH_LIMIT) return "provider-dispatches";
	if (
		input.armOutputTokens >= REDUCED_CPU_OUTPUT_TOKEN_LIMIT ||
		input.tracker.outputTokens >= REDUCED_CPU_OUTPUT_TOKEN_LIMIT * REDUCED_CPU_STUDY_ARMS.length
	) {
		return "output-tokens";
	}
	if (
		input.armActiveMs >= REDUCED_CPU_ACTIVE_MS_LIMIT ||
		input.tracker.activeMs >= REDUCED_CPU_ACTIVE_MS_LIMIT * REDUCED_CPU_STUDY_ARMS.length
	) {
		return "active-seconds";
	}
	if (
		input.nowMs - input.armStartedAtMs >= REDUCED_CPU_CALENDAR_MS_LIMIT ||
		input.nowMs - input.studyStartedAtMs >= REDUCED_CPU_CALENDAR_MS_LIMIT * REDUCED_CPU_STUDY_ARMS.length
	) {
		return "calendar-seconds";
	}
	return null;
}

export function reducedCpuProviderWatchdogDelay(deadlineMs: number, nowMs: number): number {
	return Math.max(0, Math.min(PROVIDER_TIMEOUT_MS, deadlineMs - nowMs));
}

export function reducedCpuEvaluationDeadlineDelay(deadlineMs: number, nowMs: number): number {
	return Math.max(0, deadlineMs - nowMs);
}

function createReducedCpuEvaluationDeadlineSignal(
	deadlineMs: number,
	upstream: AbortSignal | undefined,
): { signal: AbortSignal; expired: () => boolean; dispose: () => void } {
	const controller = new AbortController();
	let expired = false;
	const abortFromUpstream = (): void => controller.abort();
	if (upstream?.aborted) abortFromUpstream();
	else upstream?.addEventListener("abort", abortFromUpstream, { once: true });
	const timeout = setTimeout(
		() => {
			expired = true;
			controller.abort();
		},
		reducedCpuEvaluationDeadlineDelay(deadlineMs, Date.now()),
	);
	return {
		signal: controller.signal,
		expired: () => expired,
		dispose: () => {
			clearTimeout(timeout);
			upstream?.removeEventListener("abort", abortFromUpstream);
		},
	};
}

function failReducedCpuEvaluationDeadline(state: ArmGuardState, operation: string, cause?: unknown): never {
	const message = `${operation} exceeded the arm calendar deadline`;
	state.fatalGateErrors.push(message);
	state.stopAfterToolFailure = true;
	state.phase = "terminal";
	throw cause === undefined ? new Error(message) : new AggregateError([cause], message);
}

export function failReducedCpuProviderWatchdog(state: ArmGuardState, tracker: ProviderTracker): boolean {
	if (state.providerRequestStartedAtMs === null) return false;
	state.fatalGateErrors.push("accepted provider request exceeded the provider-active watchdog");
	state.stopAfterToolFailure = true;
	state.phase = "terminal";
	tracker.unexpectedBlocked++;
	tracker.blockedReasons.push(`${state.arm}:provider-active-watchdog`);
	return true;
}

export function enforceReducedCpuCandidateContinuation(
	state: ArmGuardState,
	candidate: ReducedCpuCandidateEvidence,
	source: "model-tool" | "host-candidate-4",
): void {
	if (candidate.verifierValid || isReducedCpuMeasuredVerifierRejection(candidate)) return;
	const message = `${source} candidate ${candidate.ordinal} has apparatus-invalid evidence: ${candidate.invalidReasons.join("; ")}`;
	state.fatalGateErrors.push(message);
	state.stopAfterToolFailure = true;
	state.phase = "terminal";
	throw new Error(message);
}

export function trackReducedCpuEvaluatorPromise<T>(state: ArmGuardState, promise: Promise<T>): Promise<T> {
	const settlement = promise.then(
		() => undefined,
		(error: unknown) => {
			state.evaluatorSettlementErrors.push(errorText(error));
		},
	);
	state.evaluatorSettlements.add(settlement);
	void settlement.then(() => state.evaluatorSettlements.delete(settlement));
	return promise;
}

export async function waitForReducedCpuEvaluatorSettlements(state: ArmGuardState): Promise<void> {
	while (state.evaluatorSettlements.size > 0) {
		await Promise.all([...state.evaluatorSettlements]);
	}
	if (state.evaluatorSettlementErrors.length > 0) {
		throw new Error(`evaluator settlement failed: ${state.evaluatorSettlementErrors.join("; ")}`);
	}
}

function clearReducedCpuProviderWatchdog(state: ArmGuardState): void {
	if (state.providerWatchdog === null) return;
	clearTimeout(state.providerWatchdog);
	state.providerWatchdog = null;
}

function armReducedCpuProviderWatchdog(state: ArmGuardState, tracker: ProviderTracker, abort: () => void): void {
	clearReducedCpuProviderWatchdog(state);
	const delayMs = reducedCpuProviderWatchdogDelay(state.deadlineMs, Date.now());
	state.providerWatchdog = setTimeout(() => {
		state.providerWatchdog = null;
		if (failReducedCpuProviderWatchdog(state, tracker)) abort();
	}, delayMs);
}

function budgetReason(tracker: ProviderTracker, activeMs: number, elapsedMs: number): BudgetStopReason | null {
	if (tracker.accepted > REDUCED_CPU_PROVIDER_DISPATCH_LIMIT) return "provider-dispatches";
	if (tracker.outputTokens > REDUCED_CPU_OUTPUT_TOKEN_LIMIT * REDUCED_CPU_STUDY_ARMS.length) return "output-tokens";
	if (activeMs > REDUCED_CPU_ACTIVE_MS_LIMIT * REDUCED_CPU_STUDY_ARMS.length) return "active-seconds";
	if (elapsedMs > REDUCED_CPU_CALENDAR_MS_LIMIT * REDUCED_CPU_STUDY_ARMS.length) return "calendar-seconds";
	return null;
}

function initialPrompt(): string {
	return [
		"Run the first two proposals of a bounded CompilerGym optimization branch.",
		`Search tasks are ${JSON.stringify(REDUCED_CPU_SEARCH_TASKS)}. Reduce raw IR while all semantic checks pass.`,
		"Candidate 2 must insert exactly one pass flag at exactly one index into candidate 1 without removing, replacing, or reordering any candidate-1 pass.",
		"Call autoresearch_evaluate exactly once per provider response. Inspect the typed result before the next proposal.",
		"Make exactly two evaluation calls. Do not summarize or select a champion.",
	].join("\n");
}

export function buildReducedCpuContinuationPrompt(arm: ReducedCpuStudyArm): string {
	if (arm !== "stock") return REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT;
	return [
		"Continue the bounded branch with candidates 3 and 4. Candidate 3 must genuinely change candidate 1's action sequence.",
		"Call autoresearch_evaluate exactly once per provider response and inspect candidate 3 before candidate 4.",
		"Evaluate candidate 4 normally.",
		"Do not select or report a champion.",
	].join("\n");
}

async function refreshedArmController(state: ArmGuardState): Promise<ResearchController> {
	return openReducedCpuStudyController({ outputDir: state.outputDir, arm: state.arm });
}

export async function appendReducedCpuArmTerminalManifest(input: {
	state: ArmGuardState;
	manifest: unknown;
	openController?: () => Promise<ResearchController>;
	verifyLedger?: (controller: ResearchController) => Promise<void>;
}): Promise<void> {
	const controller = await (input.openController ?? (() => refreshedArmController(input.state)))();
	await controller.appendRunManifest(input.manifest);
	await (
		input.verifyLedger ??
		((freshController) => verifyReducedCpuStudyLedgerStrict(freshController, input.state.outputDir))
	)(controller);
}

async function settleAndVerifyReducedCpuArm(state: ArmGuardState): Promise<void> {
	await waitForReducedCpuEvaluatorSettlements(state);
	const controller = await refreshedArmController(state);
	await controller.waitForIdle();
	await verifyReducedCpuStudyLedgerStrict(controller, state.outputDir);
}

function blockProvider(state: ArmGuardState, tracker: ProviderTracker, reason: string, abort: () => void): void {
	tracker.intentionalBlocked++;
	tracker.blockedReasons.push(`${state.arm}:${reason}`);
	state.phase = "terminal";
	state.expectedBlockedAssistantEnds++;
	abort();
}

export function consumeReducedCpuAssistantMessageEnd(input: {
	state: ArmGuardState;
	tracker: ProviderTracker;
	nowMs: number;
	stopReason: AssistantMessage["stopReason"];
}): { disposition: "accepted" | "expected-blocked" | "unexpected-unpaired"; activeMs: number } {
	if (input.state.providerRequestStartedAtMs !== null) {
		const activeMs = Math.max(0, input.nowMs - input.state.providerRequestStartedAtMs);
		input.state.providerRequestStartedAtMs = null;
		return { disposition: "accepted", activeMs };
	}
	if (input.stopReason === "aborted" && input.state.expectedBlockedAssistantEnds > 0) {
		input.state.expectedBlockedAssistantEnds--;
		return { disposition: "expected-blocked", activeMs: 0 };
	}
	input.state.fatalGateErrors.push("assistant message ended without a matching accepted or blocked provider request");
	input.state.stopAfterToolFailure = true;
	input.state.phase = "terminal";
	input.tracker.unexpectedBlocked++;
	input.tracker.blockedReasons.push(`${input.state.arm}:unexpected-unpaired-assistant-end`);
	return { disposition: "unexpected-unpaired", activeMs: 0 };
}

export async function runReducedCpuProviderGate<T>(input: {
	payload: T;
	state: ArmGuardState;
	tracker: ProviderTracker;
	calibration: ReducedCpuCalibration;
	studyStartedAtMs: number;
	armStartedAtMs: number;
	armActiveMs: number;
	armOutputTokens: number;
	abort: () => void;
	loadEvidence?: () => Promise<ReducedCpuCandidateEvidence[]>;
	prepareRetest?: () => Promise<SealedReducedCpuRetestDirective | null>;
}): Promise<T> {
	try {
		assert.ok(isRecord(input.payload), "Reduced CPU provider payload must be an object");
		assertProviderPayload(input.payload, input.state);
		if (input.state.phase === "terminal") {
			input.state.expectedBlockedAssistantEnds++;
			input.abort();
			return input.payload;
		}
		const reason = reducedCpuDispatchBudgetReason({
			tracker: input.tracker,
			armOutputTokens: input.armOutputTokens,
			armActiveMs: input.armActiveMs,
			armStartedAtMs: input.armStartedAtMs,
			studyStartedAtMs: input.studyStartedAtMs,
			nowMs: Date.now(),
		});
		if (reason) throw new Error(`budget gate: ${reason}`);
		let controller: ResearchController | null = null;
		let evidence: ReducedCpuCandidateEvidence[];
		if (input.loadEvidence) {
			evidence = await input.loadEvidence();
		} else {
			controller = await refreshedArmController(input.state);
			evidence = await loadReducedCpuSearchEvidence({
				controller,
				outputDir: input.state.outputDir,
				arm: input.state.arm,
				branchId: input.state.branchId,
				calibration: input.calibration,
			});
		}
		if (input.state.stopAfterToolFailure) {
			blockProvider(input.state, input.tracker, "failed-tool-no-replacement", input.abort);
			return input.payload;
		}
		if (input.state.phase === "prefix" && evidence.length >= 2) {
			blockProvider(input.state, input.tracker, "prefix-complete", input.abort);
			return input.payload;
		}
		if (input.state.phase === "post-compaction") {
			if (input.state.arm === "M+R" && evidence.length === 3) {
				input.state.sealedRetest = input.prepareRetest
					? await input.prepareRetest()
					: await prepareReducedCpuRetestDirective({
							controller: controller ?? (await refreshedArmController(input.state)),
							outputDir: input.state.outputDir,
							branchId: input.state.branchId,
							calibration: input.calibration,
						});
				if (input.state.sealedRetest) {
					blockProvider(input.state, input.tracker, "eligible-host-retest", input.abort);
					return input.payload;
				}
			}
			if (evidence.length >= 4) {
				blockProvider(input.state, input.tracker, "arm-complete", input.abort);
				return input.payload;
			}
		}
		input.tracker.accepted++;
		input.state.currentProviderOrdinal = input.tracker.accepted;
		input.state.eventSequence++;
		input.state.providerRequestStartedAtMs = Date.now();
		input.state.providerRequests.push({
			ordinal: input.tracker.accepted,
			eventSequence: input.state.eventSequence,
			payloadSha256: sha256Json(input.payload),
			payload: structuredClone(input.payload),
		});
		return input.payload;
	} catch (error) {
		input.state.fatalGateErrors.push(errorText(error));
		input.state.phase = "terminal";
		input.tracker.unexpectedBlocked++;
		input.tracker.blockedReasons.push(`${input.state.arm}:fatal-provider-gate`);
		input.state.expectedBlockedAssistantEnds++;
		input.abort();
		return input.payload;
	}
}

function providerAndToolGuardExtension(input: {
	state: ArmGuardState;
	tracker: ProviderTracker;
	calibration: ReducedCpuCalibration;
	studyStartedAtMs: number;
	armStartedAtMs: number;
	armActiveMs: () => number;
	armOutputTokens: () => number;
}) {
	return (pi: ExtensionAPI): void => {
		pi.on("before_provider_request", async (event, ctx) => {
			const acceptedBefore = input.tracker.accepted;
			const payload = await runReducedCpuProviderGate({
				payload: event.payload,
				state: input.state,
				tracker: input.tracker,
				calibration: input.calibration,
				studyStartedAtMs: input.studyStartedAtMs,
				armStartedAtMs: input.armStartedAtMs,
				armActiveMs: input.armActiveMs(),
				armOutputTokens: input.armOutputTokens(),
				abort: () => ctx.abort(),
			});
			if (input.tracker.accepted === acceptedBefore + 1 && input.state.providerRequestStartedAtMs !== null) {
				armReducedCpuProviderWatchdog(input.state, input.tracker, () => ctx.abort());
			}
			return payload;
		});
		pi.on("session_before_compact", (event) => {
			input.state.compactionPreparation = {
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				messagesToSummarize: event.preparation.messagesToSummarize.length,
				turnPrefixMessages: event.preparation.turnPrefixMessages.length,
				isSplitTurn: event.preparation.isSplitTurn,
				customInstructions: event.customInstructions ?? null,
			};
		});
		pi.on("tool_call", (event) => {
			input.state.toolArgs.set(event.toolCallId, event.input);
		});
		pi.on("tool_result", (event) => {
			input.state.eventSequence++;
			input.state.toolDispatches.push({
				toolName: event.toolName,
				providerOrdinal: input.state.currentProviderOrdinal,
				eventSequence: input.state.eventSequence,
				isError: event.isError,
				args: input.state.toolArgs.get(event.toolCallId),
				details: event.details,
			});
			input.state.toolArgs.delete(event.toolCallId);
			if (event.isError) input.state.stopAfterToolFailure = true;
			if (event.toolName === "autoresearch_recall" && !event.isError) {
				pi.setActiveTools(["autoresearch_evaluate"]);
			}
		});
	};
}

const CandidateSchema = Type.Object(
	{
		actions: Type.Array(Type.String(), { maxItems: 256 }),
		hypothesis: Type.String({ minLength: 1 }),
		mechanism: Type.String({ minLength: 1 }),
		predictedOutcome: Type.String({ minLength: 1 }),
		boundaryConditions: Type.Array(Type.String()),
	},
	{ additionalProperties: false },
);

export interface ReducedCpuProviderCandidateMeasurement {
	schemaVersion: 1;
	type: "reduced_cpu_candidate_measurement";
	candidateDigest: string;
	actions: string[];
	verifierValid: boolean;
	tasks: ReducedCpuCandidateEvidence["tasks"];
	invalidReasons: string[];
}

export function projectReducedCpuProviderCandidateMeasurement(
	candidate: ReducedCpuCandidateEvidence,
): ReducedCpuProviderCandidateMeasurement {
	return {
		schemaVersion: 1,
		type: "reduced_cpu_candidate_measurement",
		candidateDigest: candidate.candidateDigest,
		actions: [...candidate.actions],
		verifierValid: candidate.verifierValid,
		tasks: structuredClone(candidate.tasks),
		invalidReasons: [...candidate.invalidReasons],
	};
}

export function serializeReducedCpuProviderCandidateMeasurement(candidate: ReducedCpuCandidateEvidence): string {
	return JSON.stringify(projectReducedCpuProviderCandidateMeasurement(candidate));
}

export function inspectReducedCpuCompactionPayload(payload: unknown): {
	priority: boolean;
	toolsAbsent: boolean;
} {
	return {
		priority: isRecord(payload) && payload.service_tier === "priority",
		toolsAbsent: isRecord(payload) && !Object.hasOwn(payload, "tools"),
	};
}

function assertSingleToolCallForProvider(state: ArmGuardState): void {
	if (state.toolDispatches.some((record) => record.providerOrdinal === state.currentProviderOrdinal)) {
		throw new Error("each accepted provider response may issue exactly one study tool call");
	}
}

async function claimDispatchIntent(state: ArmGuardState, slot: DispatchSlot, request: unknown): Promise<string> {
	const directory = join(state.outputDir, ".dispatch-locks");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const value = {
		type: "reduced_cpu_dispatch_intent",
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		preregistrationSha256: state.preregistrationSha256,
		arm: state.arm,
		branchId: state.branchId,
		operation: slot,
		requestSha256: sha256Json(request),
		calibrationSha256: state.calibrationSha256,
		providerOrdinal: state.currentProviderOrdinal || null,
		deadlineMs: state.deadlineMs,
		claimedAt: new Date().toISOString(),
	};
	await writePrivateJson(join(directory, `${slot}.intent.json`), value, true);
	return sha256Text(`${JSON.stringify(value, null, 2)}\n`);
}

async function readReducedCpuDispatchClaimPairs(
	guards: readonly ArmGuardState[],
): Promise<ReducedCpuDispatchClaimPair[]> {
	return Promise.all(
		guards.flatMap((guard) =>
			REDUCED_CPU_DISPATCH_SLOTS.map(async (operation) => {
				const directory = join(guard.outputDir, ".dispatch-locks");
				return {
					arm: guard.arm,
					branchId: guard.branchId,
					operation,
					intentText: await readFile(join(directory, `${operation}.intent.json`), "utf8"),
					resultText: await readFile(join(directory, `${operation}.result.json`), "utf8"),
				};
			}),
		),
	);
}

async function claimDispatchResult(
	state: ArmGuardState,
	slot: DispatchSlot,
	intentSha256: string,
	job: { jobId: string; manifestDigest: string },
): Promise<void> {
	await writePrivateJson(
		join(state.outputDir, ".dispatch-locks", `${slot}.result.json`),
		{
			type: "reduced_cpu_dispatch_result",
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			arm: state.arm,
			branchId: state.branchId,
			operation: slot,
			intentSha256,
			jobId: job.jobId,
			manifestDigest: job.manifestDigest,
			recordedAt: new Date().toISOString(),
		},
		true,
	);
}

function evaluationTool(state: ArmGuardState, calibration: ReducedCpuCalibration) {
	return defineTool({
		name: "autoresearch_evaluate",
		label: "Evaluate CPU Candidate",
		description: "Submit one fresh LLVM pass sequence to the sealed branch-local evaluator.",
		promptSnippet: "autoresearch_evaluate: measure exactly one candidate on qsort, blowfish, and bzip2.",
		executionMode: "sequential",
		parameters: CandidateSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			trackReducedCpuEvaluatorPromise(
				state,
				(async () => {
					assertSingleToolCallForProvider(state);
					if (!reducedCpuEvaluationAllowed(state)) {
						throw new Error(
							"candidate 3 evaluation requires the exact typed recall in an earlier provider response",
						);
					}
					if (ctx.sessionManager.getSessionId() !== state.branchId) throw new Error("evaluation branch mismatch");
					const controller = await refreshedArmController(state);
					const existing = await loadReducedCpuSearchEvidence({
						controller,
						outputDir: state.outputDir,
						arm: state.arm,
						branchId: state.branchId,
						calibration,
					});
					const ordinal = existing.length + 1;
					if (ordinal < 1 || ordinal > 4) throw new Error("candidate dispatch slot is exhausted");
					const slot = `candidate-${ordinal}` as DispatchSlot;
					const intentSha256 = await claimDispatchIntent(state, slot, params);
					const deadline = createReducedCpuEvaluationDeadlineSignal(state.deadlineMs, signal);
					let envelope: ReducedCpuStudyEvaluationEnvelope;
					try {
						envelope = await submitReducedCpuSearchCandidate({
							controller,
							outputDir: state.outputDir,
							arm: state.arm,
							branchId: state.branchId,
							calibration,
							request: params,
							signal: deadline.signal,
						});
						if (deadline.expired()) failReducedCpuEvaluationDeadline(state, `candidate ${ordinal}`);
					} catch (error) {
						if (deadline.expired()) failReducedCpuEvaluationDeadline(state, `candidate ${ordinal}`, error);
						throw error;
					} finally {
						deadline.dispose();
					}
					await verifyReducedCpuStudyLedgerStrict(controller, state.outputDir);
					await claimDispatchResult(state, slot, intentSha256, envelope.job.proposal);
					const measured = await loadReducedCpuSearchEvidence({
						controller,
						outputDir: state.outputDir,
						arm: state.arm,
						branchId: state.branchId,
						calibration,
					});
					const candidate = measured.find((item) => item.ordinal === envelope.ordinal);
					if (!candidate) throw new Error(`ledger-derived candidate ${envelope.ordinal} is missing`);
					enforceReducedCpuCandidateContinuation(state, candidate, "model-tool");
					return {
						content: [
							{ type: "text" as const, text: serializeReducedCpuProviderCandidateMeasurement(candidate) },
						],
						details: envelope,
					};
				})(),
			),
	});
}

function sanitizedCandidate(candidate: ReducedCpuCandidateEvidence): unknown {
	return {
		ordinal: candidate.ordinal,
		jobId: candidate.jobId,
		manifestDigest: candidate.manifestDigest,
		candidateDigest: candidate.candidateDigest,
		actions: candidate.actions,
		verifierValid: candidate.verifierValid,
		tasks: candidate.tasks,
		invalidReasons: candidate.invalidReasons,
	};
}

function branchLocalRecallTool(state: ArmGuardState, calibration: ReducedCpuCalibration) {
	return defineTool({
		name: "autoresearch_recall",
		label: "Recall Evidence",
		description: "Recall exact typed candidate-1 and candidate-2 evidence from this branch's append-only ledger.",
		promptSnippet: "autoresearch_recall: recover this branch's two measured precompaction candidates.",
		executionMode: "sequential",
		parameters: Type.Object({}, { additionalProperties: false }),
		execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
			assertSingleToolCallForProvider(state);
			if (state.phase !== "post-compaction") throw new Error("recall is available only after compaction");
			if (state.recallCompleted) throw new Error("recall may execute exactly once");
			if (ctx.sessionManager.getSessionId() !== state.branchId) throw new Error("recall branch mismatch");
			const controller = await refreshedArmController(state);
			const candidates = await loadReducedCpuSearchEvidence({
				controller,
				outputDir: state.outputDir,
				arm: state.arm,
				branchId: state.branchId,
				calibration,
			});
			if (candidates.length !== 2)
				throw new Error(`recall expected exactly two candidates, received ${candidates.length}`);
			const evidence = candidates.map(sanitizedCandidate);
			const text = JSON.stringify({ evidence });
			const receiptSha256 = sha256Text(text);
			const details = {
				jobIds: [candidates[0].jobId, candidates[1].jobId],
				receiptSha256,
				returnedTextSha256: receiptSha256,
				returnedText: text,
			};
			state.recallCompleted = true;
			return { content: [{ type: "text", text }], details };
		},
	});
}

async function createArmRuntime(input: {
	arm: ReducedCpuStudyArm;
	preregistrationSha256: string;
	calibrationSha256: string;
	outputDir: string;
	workspace: string;
	sessionDir: string;
	calibration: ReducedCpuCalibration;
	tracker: ProviderTracker;
	studyStartedAtMs: number;
	deadlineMs: number;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: NonNullable<ReturnType<ModelRegistry["find"]>>;
}): Promise<{
	runtime: ArmRuntime;
	guard: ArmGuardState;
	activeMs: () => number;
	recordActiveMs: (delta: number) => void;
	armOutputTokens: () => number;
	recordArmOutputTokens: (tokens: number) => void;
}> {
	await mkdir(input.outputDir, { mode: 0o700 });
	await prepareReducedCpuStudyOutput(input.outputDir);
	await mkdir(input.workspace, { mode: 0o700 });
	await mkdir(input.sessionDir, { mode: 0o700 });
	const sessionManager = SessionManager.create(input.workspace, input.sessionDir);
	sessionManager.flushNow();
	const branchId = sessionManager.getSessionId();
	const guard: ArmGuardState = {
		arm: input.arm,
		preregistrationSha256: input.preregistrationSha256,
		calibrationSha256: input.calibrationSha256,
		deadlineMs: input.deadlineMs,
		studyStartedAtMs: input.studyStartedAtMs,
		outputDir: input.outputDir,
		branchId,
		phase: "prefix",
		stopAfterToolFailure: false,
		recallCompleted: false,
		currentProviderOrdinal: 0,
		sealedRetest: null,
		toolDispatches: [],
		eventSequence: 0,
		fatalGateErrors: [],
		toolArgs: new Map(),
		providerRequests: [],
		providerRequestStartedAtMs: null,
		providerWatchdog: null,
		expectedBlockedAssistantEnds: 0,
		evaluatorSettlements: new Set(),
		evaluatorSettlementErrors: [],
		compactionPreparation: null,
	};
	let activeMs = 0;
	const outputTokenCounter = createReducedCpuArmOutputTokenCounter();
	const armStartedAtMs = Date.now();
	const settingsManager = SettingsManager.inMemory({
		transport: "sse",
		compaction: {
			enabled: true,
			agentCallable: false,
			reserveTokens: 2_048,
			keepRecentTokens: REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS,
		},
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: PROVIDER_TIMEOUT_MS } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: input.workspace,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [
			providerAndToolGuardExtension({
				state: guard,
				tracker: input.tracker,
				calibration: input.calibration,
				studyStartedAtMs: input.studyStartedAtMs,
				armStartedAtMs,
				armActiveMs: () => activeMs,
				armOutputTokens: outputTokenCounter.current,
			}),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
	});
	await resourceLoader.reload();
	const evaluate = evaluationTool(guard, input.calibration);
	const recall = input.arm === "stock" ? null : branchLocalRecallTool(guard, input.calibration);
	const customTools = recall ? [evaluate, recall] : [evaluate];
	const { session } = await createAgentSession({
		cwd: input.workspace,
		authStorage: input.authStorage,
		modelRegistry: input.modelRegistry,
		model: input.model,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		serviceTier: FROZEN_CAMPAIGN.model.serviceTier,
		settingsManager,
		sessionManager,
		resourceLoader,
		noTools: "builtin",
		customTools,
		includeGoals: false,
		includeCompactSkill: false,
	});
	assert.equal(session.model?.provider, FROZEN_CAMPAIGN.model.provider);
	assert.equal(session.model?.id, FROZEN_CAMPAIGN.model.id);
	assert.equal(session.thinkingLevel, FROZEN_CAMPAIGN.model.thinkingLevel);
	assert.equal(session.serviceTier, FROZEN_CAMPAIGN.model.serviceTier);
	const resolvedModelSnapshot = await captureStockInterfaceParityResolvedModelSnapshot({
		authStorage: input.authStorage,
		modelRegistry: input.modelRegistry,
		session,
		provider: FROZEN_CAMPAIGN.model.provider,
		modelId: FROZEN_CAMPAIGN.model.id,
	});
	assert.deepEqual(
		validateCompilerGymHardenedPaidResolvedModelSnapshot(resolvedModelSnapshot),
		[],
		"paid model provenance validation failed",
	);
	session.setActiveToolsByName(["autoresearch_evaluate"]);
	assert.deepEqual(session.getActiveToolNames(), ["autoresearch_evaluate"]);
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error(`${input.arm} session is not persistent`);
	await chmod(sessionFile, 0o600);
	const events: AgentSessionEvent[] = [];
	const extensionErrors: ExtensionError[] = [];
	const assistantMessages: AssistantMessage[] = [];
	await session.bindExtensions({ onError: (error) => extensionErrors.push(structuredClone(error)) });
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		guard.eventSequence++;
		if (event.type === "message_end" && event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			const pairing = consumeReducedCpuAssistantMessageEnd({
				state: guard,
				tracker: input.tracker,
				nowMs: Date.now(),
				stopReason: message.stopReason,
			});
			if (pairing.disposition !== "accepted") return;
			clearReducedCpuProviderWatchdog(guard);
			activeMs += pairing.activeMs;
			input.tracker.activeMs += pairing.activeMs;
			assistantMessages.push(structuredClone(message));
			input.tracker.outputTokens += message.usage.output;
			outputTokenCounter.record(message.usage.output);
		}
	});
	return {
		runtime: {
			arm: input.arm,
			outputDir: input.outputDir,
			branchId,
			workspace: input.workspace,
			session,
			sessionManager,
			settingsManager,
			sessionFile,
			events,
			extensionErrors,
			assistantMessages,
			resolvedModelSnapshot,
			startedAtMs: armStartedAtMs,
			unsubscribe,
		},
		guard,
		activeMs: () => activeMs,
		recordActiveMs: (delta) => {
			activeMs += delta;
		},
		armOutputTokens: outputTokenCounter.current,
		recordArmOutputTokens: outputTokenCounter.record,
	};
}

function toolEnvelope(record: ToolDispatchRecord): ReducedCpuStudyEvaluationEnvelope | null {
	if (!isRecord(record.details) || record.details.type !== "reduced_cpu_study_search_evaluation") return null;
	return record.details as unknown as ReducedCpuStudyEvaluationEnvelope;
}

async function runNativeCompaction(input: {
	runtime: ArmRuntime;
	guard: ArmGuardState;
	tracker: ProviderTracker;
	deadlineMs: number;
	recordArmActiveMs: (delta: number) => void;
	recordArmOutputTokens: (tokens: number) => void;
}): Promise<{ audit: ReducedCpuCompactionAudit; activeMs: number; message: AssistantMessage }> {
	if (input.tracker.accepted >= REDUCED_CPU_PROVIDER_DISPATCH_LIMIT) {
		throw new Error("provider dispatch budget exhausted before compaction");
	}
	const eventStart = input.runtime.events.length;
	const extensionErrorStart = input.runtime.extensionErrors.length;
	const expectedFirstKeptEntryId = input.runtime.sessionManager.appendMessage({
		role: "user",
		content: "HOST_REDUCED_CPU_COMPACTION_BOUNDARY_V1: apply the common native compaction policy now.",
		timestamp: Date.now(),
	});
	input.tracker.accepted++;
	input.tracker.compactionCalls++;
	const started = Date.now();
	const messages: AssistantMessage[] = [];
	const payloads: unknown[] = [];
	const responseStatuses: number[] = [];
	let compactionTimedOut = false;
	const compactionPromise = input.runtime.session.compact(REDUCED_CPU_COMPACTION_INSTRUCTION, {
		providerOptions: {
			transport: "sse",
			serviceTier: "priority",
			timeoutMs: PROVIDER_TIMEOUT_MS,
			maxRetries: 0,
			maxRetryDelayMs: 0,
			sessionId: input.runtime.branchId,
			onPayload: (payload, model) => {
				assert.equal(model.provider, FROZEN_CAMPAIGN.model.provider);
				assert.equal(model.id, FROZEN_CAMPAIGN.model.id);
				payloads.push(structuredClone(payload));
			},
			onResponse: (response, model) => {
				assert.equal(model.provider, FROZEN_CAMPAIGN.model.provider);
				assert.equal(model.id, FROZEN_CAMPAIGN.model.id);
				responseStatuses.push(response.status);
			},
		},
		onProviderComplete: (message) => {
			messages.push(structuredClone(message));
		},
	});
	const remaining = Math.min(PROVIDER_TIMEOUT_MS, input.deadlineMs - Date.now());
	if (remaining <= 0) input.runtime.session.abortCompaction();
	const timeout = setTimeout(
		() => {
			compactionTimedOut = true;
			input.runtime.session.abortCompaction();
		},
		Math.max(0, remaining),
	);
	let result: Awaited<typeof compactionPromise>;
	let activeMs = 0;
	try {
		result = await compactionPromise;
	} finally {
		clearTimeout(timeout);
		activeMs = Date.now() - started;
		accountReducedCpuCompactionAttempt({
			tracker: input.tracker,
			messages,
			activeMs,
			recordArmActiveMs: input.recordArmActiveMs,
			recordArmOutputTokens: input.recordArmOutputTokens,
		});
	}
	if (compactionTimedOut) throw new Error("native compaction exceeded its deadline");
	const events = input.runtime.events.slice(eventStart);
	const startEvents = events.filter((event) => event.type === "compaction_start").length;
	const endEvents = events.filter((event) => event.type === "compaction_end").length;
	const entry = [...input.runtime.sessionManager.getEntries()]
		.reverse()
		.find((candidate) => candidate.type === "compaction");
	const fromHook = entry?.type === "compaction" && entry.fromHook === true;
	const extensionErrors = input.runtime.extensionErrors.slice(extensionErrorStart);
	const preparation = input.guard.compactionPreparation;
	assert.ok(preparation, "session_before_compact preparation audit is missing");
	assert.equal(preparation.firstKeptEntryId, expectedFirstKeptEntryId);
	assert.ok(preparation.messagesToSummarize > 0, "compaction summarized no prior messages");
	assert.equal(preparation.turnPrefixMessages, 0, "compaction retained a split-turn prefix");
	assert.equal(preparation.isSplitTurn, false, "compaction split a turn");
	assert.equal(preparation.customInstructions, REDUCED_CPU_COMPACTION_INSTRUCTION);
	assert.equal(messages.length, 1, "compaction must complete exactly one non-split provider response");
	assert.equal(payloads.length, 1, "compaction must send exactly one provider payload");
	assert.equal(responseStatuses.length, 1, "compaction must receive exactly one HTTP response");
	assert.ok(responseStatuses[0] >= 200 && responseStatuses[0] < 300, "compaction HTTP response failed");
	const message = messages[0];
	assert.ok(isRecord(payloads[0]), "compaction provider payload must be an object");
	const compactionPayloadAudit = inspectReducedCpuCompactionPayload(payloads[0]);
	const providerPayloadPriority = compactionPayloadAudit.priority;
	const providerPayloadToolsAbsent = compactionPayloadAudit.toolsAbsent;
	const audit: ReducedCpuCompactionAudit = {
		instruction: REDUCED_CPU_COMPACTION_INSTRUCTION,
		keepRecentTokens: REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS,
		summary: result.summary,
		summarySha256: sha256Text(result.summary),
		firstKeptEntryId: result.firstKeptEntryId,
		expectedFirstKeptEntryId,
		tokensBefore: result.tokensBefore,
		fromHook,
		paidProviderCalls: 1,
		transportAttempts: 1,
		providerPayloadSha256: sha256Json(payloads[0]),
		providerPayloadPriority,
		providerPayloadToolsAbsent,
		providerResponseStatus: responseStatuses[0],
		usage: structuredClone(message.usage),
		usageAvailable: true,
		startEvents,
		endEvents,
		extensionErrors,
		passed:
			result.summary.length > 0 &&
			result.firstKeptEntryId.length > 0 &&
			result.firstKeptEntryId === expectedFirstKeptEntryId &&
			result.tokensBefore > 0 &&
			!fromHook &&
			providerPayloadPriority &&
			providerPayloadToolsAbsent &&
			startEvents === 1 &&
			endEvents === 1 &&
			extensionErrors.length === 0,
	};
	return { audit, activeMs, message };
}

function evaluatorWaitMs(jobs: readonly JobView[]): number {
	return jobs.reduce((total, job) => {
		const waits = job.measurement?.tasks.map((task) => task.metrics.schedulerAndEvaluatorWallMs ?? 0) ?? [];
		return total + Math.max(0, ...waits);
	}, 0);
}

async function runArm(input: {
	runtime: ArmRuntime;
	guard: ArmGuardState;
	calibration: ReducedCpuCalibration;
	tracker: ProviderTracker;
	deadlineMs: number;
	activeMs: () => number;
	recordActiveMs: (delta: number) => void;
	armOutputTokens: () => number;
	recordArmOutputTokens: (tokens: number) => void;
}): Promise<ReducedCpuStudyArmResult> {
	const providerStart = input.tracker.accepted;
	const blockedStart = input.tracker.intentionalBlocked;
	const unexpectedStart = input.tracker.unexpectedBlocked;
	await promptUntilSettled(input.runtime.session, initialPrompt(), input.deadlineMs);
	let controller = await refreshedArmController(input.guard);
	let candidates = await loadReducedCpuSearchEvidence({
		controller,
		outputDir: input.runtime.outputDir,
		arm: input.runtime.arm,
		branchId: input.runtime.branchId,
		calibration: input.calibration,
	});
	assert.equal(candidates.length, 2, "prefix must produce exactly two durable candidates");
	if (input.guard.stopAfterToolFailure) throw new Error("prefix evaluator failed; replacement is forbidden");
	const candidateTwo = classifyReducedCpuCandidateTwo(candidates[0], candidates[1]);
	if (!candidateTwo.exactSinglePassInsertion) {
		throw new Error("candidate 2 violated the common one-pass insertion contract");
	}
	const precompactionBudgetReason = reducedCpuDispatchBudgetReason({
		tracker: input.tracker,
		armOutputTokens: input.armOutputTokens(),
		armActiveMs: input.activeMs(),
		armStartedAtMs: input.runtime.startedAtMs,
		studyStartedAtMs: input.guard.studyStartedAtMs,
		nowMs: Date.now(),
	});
	if (precompactionBudgetReason) {
		throw new Error(`precompaction budget gate: ${precompactionBudgetReason}`);
	}
	const compacted = await runNativeCompaction({
		runtime: input.runtime,
		guard: input.guard,
		tracker: input.tracker,
		deadlineMs: input.deadlineMs,
		recordArmActiveMs: input.recordActiveMs,
		recordArmOutputTokens: input.recordArmOutputTokens,
	});
	input.guard.eventSequence++;
	const compactionEventSequence = input.guard.eventSequence;
	input.guard.phase = "post-compaction";
	if (input.runtime.arm !== "stock") {
		input.runtime.session.setActiveToolsByName(["autoresearch_evaluate", "autoresearch_recall"]);
	}
	await promptUntilSettled(
		input.runtime.session,
		buildReducedCpuContinuationPrompt(input.runtime.arm),
		input.deadlineMs,
	);
	controller = await refreshedArmController(input.guard);
	candidates = await loadReducedCpuSearchEvidence({
		controller,
		outputDir: input.runtime.outputDir,
		arm: input.runtime.arm,
		branchId: input.runtime.branchId,
		calibration: input.calibration,
	});
	const retestDirective = input.guard.sealedRetest;
	if (input.runtime.arm === "M+R" && candidates.length === 3 && retestDirective) {
		const retestRequest = {
			actions: retestDirective.directive.actions,
			hypothesis: "Host-sealed exact reapplication of the eligible earlier one-pass insertion.",
			mechanism: `Reapply ${retestDirective.directive.insertedAction} at index ${retestDirective.directive.insertionIndex}.`,
			predictedOutcome: "Measure whether the earlier non-improving pass becomes useful after the changed base.",
			boundaryConditions: ["host-owned candidate 4", "fresh verifier evidence", "zero provider calls"],
		};
		const retestIntentSha256 = await claimDispatchIntent(input.guard, "candidate-4", retestRequest);
		const deadline = createReducedCpuEvaluationDeadlineSignal(input.deadlineMs, undefined);
		let retestEnvelope: ReducedCpuStudyEvaluationEnvelope;
		try {
			retestEnvelope = await trackReducedCpuEvaluatorPromise(
				input.guard,
				submitReducedCpuSearchCandidate({
					controller,
					outputDir: input.runtime.outputDir,
					arm: input.runtime.arm,
					branchId: input.runtime.branchId,
					calibration: input.calibration,
					request: retestRequest,
					sealedRetestDirective: retestDirective,
					signal: deadline.signal,
				}),
			);
			if (deadline.expired()) failReducedCpuEvaluationDeadline(input.guard, "host candidate 4");
		} catch (error) {
			if (deadline.expired()) failReducedCpuEvaluationDeadline(input.guard, "host candidate 4", error);
			throw error;
		} finally {
			deadline.dispose();
		}
		await verifyReducedCpuStudyLedgerStrict(controller, input.runtime.outputDir);
		await claimDispatchResult(input.guard, "candidate-4", retestIntentSha256, retestEnvelope.job.proposal);
		controller = await refreshedArmController(input.guard);
		candidates = await loadReducedCpuSearchEvidence({
			controller,
			outputDir: input.runtime.outputDir,
			arm: input.runtime.arm,
			branchId: input.runtime.branchId,
			calibration: input.calibration,
		});
		const hostCandidateFour = candidates.find((candidate) => candidate.ordinal === 4);
		if (!hostCandidateFour) throw new Error("host candidate 4 is missing after durable settlement");
		enforceReducedCpuCandidateContinuation(input.guard, hostCandidateFour, "host-candidate-4");
	}
	assert.equal(candidates.length, 4, "arm must produce exactly four candidates");
	if (input.guard.stopAfterToolFailure) throw new Error("evaluator failed; replacement is forbidden");
	const validationIntentSha256 = await claimDispatchIntent(input.guard, "champion-validation", {
		championSelection: selectReducedCpuChampion(input.runtime.arm, candidates, input.calibration),
	});
	const validationDeadline = createReducedCpuEvaluationDeadlineSignal(input.deadlineMs, undefined);
	let validationEnvelope: ReducedCpuChampionValidationEnvelope;
	try {
		validationEnvelope = await trackReducedCpuEvaluatorPromise(
			input.guard,
			submitReducedCpuChampionValidation({
				controller,
				outputDir: input.runtime.outputDir,
				arm: input.runtime.arm,
				branchId: input.runtime.branchId,
				calibration: input.calibration,
				signal: validationDeadline.signal,
			}),
		);
		if (validationDeadline.expired()) failReducedCpuEvaluationDeadline(input.guard, "champion validation");
	} catch (error) {
		if (validationDeadline.expired()) failReducedCpuEvaluationDeadline(input.guard, "champion validation", error);
		throw error;
	} finally {
		validationDeadline.dispose();
	}
	await verifyReducedCpuStudyLedgerStrict(controller, input.runtime.outputDir);
	await claimDispatchResult(
		input.guard,
		"champion-validation",
		validationIntentSha256,
		validationEnvelope.job.proposal,
	);
	controller = await refreshedArmController(input.guard);
	await verifyReducedCpuStudyLedgerStrict(controller, input.runtime.outputDir);
	await verifyReducedCpuStudyArtifacts({
		controller,
		outputDir: input.runtime.outputDir,
		branchId: input.runtime.branchId,
	});
	const jobs = controller.statusForBranch(input.runtime.branchId);
	const branchBudget = controller.budgetStatus(input.runtime.branchId);
	const championSelection = selectReducedCpuChampion(input.runtime.arm, candidates, input.calibration);
	assert.deepEqual(championSelection, validationEnvelope.championSelection);
	const evaluationRecords = input.guard.toolDispatches.filter(
		(record) => record.toolName === "autoresearch_evaluate" && !record.isError,
	);
	const uniqueEvaluationProviderOrdinals = [...new Set(evaluationRecords.map((record) => record.providerOrdinal))];
	const retestActive = retestDirective !== null;
	const expected = expectedReducedCpuProviderGraph({ arm: input.runtime.arm, retestActive });
	const providerGraph: ReducedCpuProviderGraphAudit = {
		expectedPaidCalls: expected.paidCalls,
		actualPaidCalls: input.tracker.accepted - providerStart,
		agentProviderCalls: input.tracker.accepted - providerStart - 1,
		compactionProviderCalls: 1,
		compactionTransportAttempts: compacted.audit.transportAttempts,
		expectedIntentionalBlocked: 2,
		actualIntentionalBlocked: input.tracker.intentionalBlocked - blockedStart,
		modelEvaluationCalls: evaluationRecords.length,
		uniqueEvaluationProviderOrdinals,
		compactionCalls: 1,
		unexpectedBlocked: input.tracker.unexpectedBlocked - unexpectedStart,
		passed:
			input.tracker.accepted - providerStart === expected.paidCalls &&
			input.tracker.intentionalBlocked - blockedStart === 2 &&
			evaluationRecords.length === expected.modelEvaluationCalls &&
			uniqueEvaluationProviderOrdinals.length === expected.modelEvaluationCalls &&
			input.tracker.unexpectedBlocked === unexpectedStart &&
			input.guard.fatalGateErrors.length === 0,
	};
	const activeToolNames = input.runtime.session.getActiveToolNames().sort();
	const workspaceEntries = await readdir(input.runtime.workspace);
	const payloadText = JSON.stringify(input.guard.providerRequests.map((request) => request.payload));
	const forbidden = ["ipython", "bash", "edit"].filter((name) => payloadText.includes(`"${name}"`));
	const contextText = JSON.stringify(input.runtime.sessionManager.buildSessionContext().messages);
	const isolation: ReducedCpuIsolationAudit = {
		mode: "typed-evaluator-no-builtin-tools",
		activeToolNames,
		absentToolNames: ["ipython", "bash", "edit"],
		workspaceEntries,
		providerPayloadForbiddenToolMentions: forbidden,
		ipythonStateMessagePresent: contextText.includes("<ipython_state>"),
		passed:
			workspaceEntries.length === 0 &&
			forbidden.length === 0 &&
			!contextText.includes("<ipython_state>") &&
			!activeToolNames.some((name) => ["ipython", "bash", "edit"].includes(name)),
	};
	let recall: ReducedCpuRecallAudit | null = null;
	let recallReceipt: ReducedCpuMeasuredRecallReceipt | null = null;
	if (input.runtime.arm !== "stock") {
		const recallRecords = input.guard.toolDispatches.filter(
			(record) => record.toolName === "autoresearch_recall" && !record.isError,
		);
		const record = recallRecords[0];
		const details = record && isRecord(record.details) ? record.details : null;
		const returnedJobIds =
			details && Array.isArray(details.jobIds)
				? details.jobIds.filter((id): id is string => typeof id === "string")
				: [];
		const expectedJobIds = candidates.slice(0, 2).map((candidate) => candidate.jobId);
		const receiptSha256 = details && typeof details.receiptSha256 === "string" ? details.receiptSha256 : "";
		const returnedText = details && typeof details.returnedText === "string" ? details.returnedText : "";
		const expectedReturnedText = JSON.stringify({ evidence: candidates.slice(0, 2).map(sanitizedCandidate) });
		const exactEmptyArgs = isRecord(record?.args) && Object.keys(record.args).length === 0;
		const candidate3Record = evaluationRecords.find((candidate) => toolEnvelope(candidate)?.ordinal === 3);
		const candidate3Envelope = candidate3Record ? toolEnvelope(candidate3Record) : null;
		const request = candidate3Record
			? input.guard.providerRequests.find((item) => item.ordinal === candidate3Record.providerOrdinal)
			: undefined;
		const requestStrings = request ? stringLeaves(request.payload) : [];
		const causal =
			record !== undefined &&
			candidate3Record !== undefined &&
			record.providerOrdinal < candidate3Record.providerOrdinal &&
			compactionEventSequence < record.eventSequence &&
			record.eventSequence < (request?.eventSequence ?? -1) &&
			exactEmptyArgs &&
			returnedText === expectedReturnedText &&
			requestStrings.includes(returnedText) &&
			sha256Text(returnedText) === receiptSha256;
		const foreignJobIds = returnedJobIds.filter((id) => !expectedJobIds.includes(id));
		recall = {
			toolCallCount: recallRecords.length,
			returnedJobIds,
			expectedJobIds,
			foreignJobIds,
			recallProviderOrdinal: record?.providerOrdinal ?? null,
			laterEvaluationProviderOrdinal: candidate3Record?.providerOrdinal ?? null,
			causalProviderBoundary: causal,
			passed:
				recallRecords.length === 1 &&
				JSON.stringify(returnedJobIds) === JSON.stringify(expectedJobIds) &&
				foreignJobIds.length === 0 &&
				causal,
		};
		recallReceipt = {
			schemaVersion: 1,
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			type: "reduced_cpu_measured_recall_receipt",
			arm: input.runtime.arm,
			branchId: input.runtime.branchId,
			compactionEventSequence,
			recallEventSequence: record?.eventSequence ?? -1,
			candidate3ProviderRequestSequence: request?.eventSequence ?? -1,
			recalledJobIds: [expectedJobIds[0], expectedJobIds[1]],
			recallResultSha256: receiptSha256,
			providerIncludedRecallSha256: requestStrings.includes(returnedText) ? sha256Text(returnedText) : "",
			candidate3JobId: candidate3Envelope?.job.proposal.jobId ?? "",
			verified: recall.passed,
		};
	}
	const resurrection =
		input.runtime.arm === "M+R" && retestDirective
			? assessReducedCpuResurrection({
					classification: candidateTwo,
					candidate3: candidates[2],
					candidate4: candidates[3],
					sealedDirective: retestDirective,
					calibration: input.calibration,
				})
			: null;
	const failures: string[] = [];
	if (!compacted.audit.passed) failures.push("native compaction audit failed");
	if (!isolation.passed) failures.push("typed evaluator isolation audit failed");
	if (recall && !recall.passed) failures.push("typed recall continuity audit failed");
	if (!providerGraph.passed) failures.push("provider graph audit failed");
	if (branchBudget.submissions !== REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM) failures.push("submission budget mismatch");
	if (branchBudget.taskEvaluations !== REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM) failures.push("task budget mismatch");
	if (branchBudget.reusedTaskEvaluations !== 0) failures.push("measurement reuse detected");
	if (new Set(jobs.map((job) => job.proposal.jobId)).size !== jobs.length) failures.push("duplicate job identity");
	const elapsed = Date.now() - input.runtime.startedAtMs;
	const armOutputTokens = input.armOutputTokens();
	const stopReason =
		armOutputTokens > REDUCED_CPU_OUTPUT_TOKEN_LIMIT
			? "output-tokens"
			: input.activeMs() > REDUCED_CPU_ACTIVE_MS_LIMIT
				? "active-seconds"
				: elapsed > REDUCED_CPU_CALENDAR_MS_LIMIT
					? "calendar-seconds"
					: null;
	if (stopReason) failures.push(`arm budget exceeded: ${stopReason}`);
	return {
		arm: input.runtime.arm,
		branchId: input.runtime.branchId,
		sessionId: input.runtime.sessionManager.getSessionId(),
		sessionFile: input.runtime.sessionFile,
		resolvedModelSnapshot: input.runtime.resolvedModelSnapshot,
		resolvedModelSnapshotSha256: sha256Json(input.runtime.resolvedModelSnapshot),
		activeToolNames,
		candidates,
		candidateTwo,
		retestDirective,
		resurrection,
		championSelection,
		validation: validationEnvelope.validation,
		compaction: compacted.audit,
		isolation,
		recall,
		recallReceipt,
		providerGraph,
		providerDispatches: input.tracker.accepted - providerStart,
		usage: sumUsage([...input.runtime.assistantMessages, compacted.message]),
		outputTokens: armOutputTokens,
		agentActiveMs: input.activeMs(),
		evaluatorWaitMs: evaluatorWaitMs(jobs),
		calendarMs: elapsed,
		budgetStopReason: stopReason,
		branchBudget,
		jobs,
		artifactIntegrityPassed: true,
		completionPassed: failures.length === 0,
		failures,
	};
}

async function writePrivateJson(path: string, value: unknown, exclusive = false): Promise<void> {
	const handle = await open(path, exclusive ? "wx" : "w", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(path, 0o600);
}

async function terminalizeArm(
	preregistration: ReducedCpuStudyPreregistration,
	arm: ReducedCpuStudyArm,
	value: { branchId: string | null; outcome: "succeeded" | "failed"; failure: string | null },
): Promise<void> {
	const output = preregistration.arms.find((candidate) => candidate.id === arm)?.absoluteOutputDir;
	if (!output) throw new Error(`missing preregistered output for ${arm}`);
	await mkdir(output, { recursive: true, mode: 0o700 });
	await writePrivateJson(
		join(output, "terminal.json"),
		{
			type: "reduced_cpu_arm_terminal",
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			arm,
			...value,
			finishedAt: new Date().toISOString(),
		},
		true,
	);
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	if (!options.submit) throw new Error("live provider dispatch requires the explicit --submit flag");
	const verified = await readAndVerifyReducedCpuStudyPreregistration(options.preregistrationPath, {
		requireFreshExecution: true,
	});
	const preregistration = verified.preregistration;
	assert.equal(REDUCED_CPU_COMPACTION_INSTRUCTION, preregistration.commonRuntime.forcedCompaction.instructions);
	assert.equal(
		REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS,
		preregistration.commonRuntime.forcedCompaction.keepRecentTokens,
	);
	await claimReducedCpuStudyAttemptLocks(preregistration);
	const startedAtMs = Date.now();
	const campaignDeadlineMs = startedAtMs + REDUCED_CPU_CALENDAR_MS_LIMIT * REDUCED_CPU_STUDY_ARMS.length;
	const tracker: ProviderTracker = {
		accepted: 0,
		compactionCalls: 0,
		intentionalBlocked: 0,
		unexpectedBlocked: 0,
		outputTokens: 0,
		activeMs: 0,
		compactionUsage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		blockedReasons: [],
	};
	const arms: ReducedCpuStudyArmResult[] = [];
	const runtimes: ArmRuntime[] = [];
	const guards: ArmGuardState[] = [];
	const terminalizedArms = new Set<ReducedCpuStudyArm>();
	let failure: string | null = null;
	let blockDecision: ReducedCpuBlockComparisonDecision | null = null;
	let strictLedgerIntegrityPassed = false;
	try {
		const calibrationText = await readFile(preregistration.calibration.absolutePath, "utf8");
		const calibration = parseReducedCpuCalibration(JSON.parse(calibrationText) as unknown);
		await mkdir(preregistration.launch.outputRoot, { mode: 0o700 });
		const authStorage = AuthStorage.create();
		const modelRegistry = ModelRegistry.create(authStorage);
		const model = modelRegistry.find(preregistration.model.provider, preregistration.model.modelId);
		if (!model) throw new Error("preregistered reduced CPU model is not registered");
		if (!modelRegistry.hasConfiguredAuth(model))
			throw new Error("preregistered reduced CPU model authentication is unavailable");
		assert.equal(authStorage.getAll()[preregistration.model.provider]?.type, "oauth", "Codex OAuth is required");
		assert.equal(model.api, "openai-codex-responses");
		await writePrivateJson(
			join(preregistration.launch.campaignRoot, "run-start.json"),
			{
				type: "reduced_cpu_study_start",
				protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
				preregistrationSha256: preregistration.preregistrationSha256,
				preregistrationFileSha256: verified.fileSha256,
				model: preregistration.model,
				limits: preregistration.limits,
				compaction: preregistration.commonRuntime.forcedCompaction,
				startedAt: new Date(startedAtMs).toISOString(),
			},
			true,
		);
		for (const arm of preregistration.executionOrder) {
			const armRegistration = preregistration.arms.find((candidate) => candidate.id === arm);
			if (!armRegistration) throw new Error(`missing preregistered arm ${arm}`);
			const armDeadlineMs = Math.min(campaignDeadlineMs, Date.now() + REDUCED_CPU_CALENDAR_MS_LIMIT);
			let runtime: ArmRuntime | null = null;
			let guard: ArmGuardState | null = null;
			try {
				const created = await createArmRuntime({
					arm,
					preregistrationSha256: preregistration.preregistrationSha256,
					calibrationSha256: preregistration.calibration.byteSha256,
					outputDir: armRegistration.absoluteOutputDir,
					workspace: join(armRegistration.absoluteOutputDir, "workspace"),
					sessionDir: join(armRegistration.absoluteOutputDir, "sessions"),
					calibration,
					tracker,
					studyStartedAtMs: startedAtMs,
					deadlineMs: armDeadlineMs,
					authStorage,
					modelRegistry,
					model,
				});
				runtime = created.runtime;
				guard = created.guard;
				runtimes.push(runtime);
				guards.push(guard);
				assert.deepEqual(
					runtime.session.getActiveToolNames().sort(),
					[...armRegistration.activeToolSetByPhase.preCompaction].sort(),
				);
				const controller = await refreshedArmController(guard);
				await controller.appendRunManifest({
					type: "reduced_cpu_arm_start",
					protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
					preregistrationSha256: preregistration.preregistrationSha256,
					arm,
					branchId: runtime.branchId,
					activeToolNames: runtime.session.getActiveToolNames(),
					resolvedModelSnapshot: runtime.resolvedModelSnapshot,
					resolvedModelSnapshotSha256: sha256Json(runtime.resolvedModelSnapshot),
					startedAt: new Date().toISOString(),
				});
				const armResult = await runArm({
					runtime,
					guard,
					calibration,
					tracker,
					deadlineMs: armDeadlineMs,
					activeMs: created.activeMs,
					recordActiveMs: created.recordActiveMs,
					armOutputTokens: created.armOutputTokens,
					recordArmOutputTokens: created.recordArmOutputTokens,
				});
				await settleAndVerifyReducedCpuArm(guard);
				arms.push(armResult);
				await appendReducedCpuArmTerminalManifest({
					state: guard,
					manifest: {
						type: "reduced_cpu_arm_terminal",
						arm,
						branchId: runtime.branchId,
						completionPassed: armResult.completionPassed,
						finishedAt: new Date().toISOString(),
					},
				});
				await terminalizeArm(preregistration, arm, {
					branchId: runtime.branchId,
					outcome: armResult.completionPassed ? "succeeded" : "failed",
					failure: armResult.completionPassed ? null : armResult.failures.join("; "),
				});
				terminalizedArms.add(arm);
				if (!armResult.completionPassed) {
					throw new Error(`${arm} failed completion gates: ${armResult.failures.join("; ")}`);
				}
			} catch (error) {
				let armError: unknown = error;
				if (guard) {
					try {
						await settleAndVerifyReducedCpuArm(guard);
					} catch (settlementError) {
						armError = new AggregateError([error, settlementError], `${arm} evaluator settlement failed`);
					}
				}
				if (!terminalizedArms.has(arm)) {
					await terminalizeArm(preregistration, arm, {
						branchId: runtime?.branchId ?? null,
						outcome: "failed",
						failure: errorText(armError),
					});
					terminalizedArms.add(arm);
				}
				throw armError;
			}
		}
		const blocks: ReducedCpuArmBlock[] = arms.map((arm) => ({
			arm: arm.arm,
			branchId: arm.branchId,
			candidates: arm.candidates,
			championSelection: arm.championSelection,
			validation: arm.validation,
			resurrection: arm.resurrection,
			recallReceipt: arm.recallReceipt,
		}));
		blockDecision = decideReducedCpuBlockComparisons(blocks, calibration);
		for (const arm of arms) {
			const controller = await openReducedCpuStudyController({
				outputDir:
					arm.jobs.length > 0 ? (guards.find((guard) => guard.branchId === arm.branchId)?.outputDir ?? "") : "",
				arm: arm.arm,
			});
			await verifyReducedCpuStudyLedgerStrict(
				controller,
				guards.find((guard) => guard.branchId === arm.branchId)?.outputDir ?? "",
			);
		}
		strictLedgerIntegrityPassed = true;
	} catch (error) {
		failure = errorText(error);
	} finally {
		for (const guard of guards) {
			try {
				await settleAndVerifyReducedCpuArm(guard);
			} catch (error) {
				failure = failure ?? errorText(error);
			}
		}
		for (const arm of preregistration.executionOrder) {
			if (terminalizedArms.has(arm)) continue;
			try {
				await terminalizeArm(preregistration, arm, {
					branchId: null,
					outcome: "failed",
					failure: failure ?? "campaign stopped before this claimed arm started",
				});
				terminalizedArms.add(arm);
			} catch (error) {
				failure = failure ?? errorText(error);
			}
		}
		for (const runtime of runtimes) {
			const guard = guards.find((candidate) => candidate.branchId === runtime.branchId);
			if (guard) clearReducedCpuProviderWatchdog(guard);
			runtime.unsubscribe();
			runtime.session.dispose();
		}
		let sourceIntegrityPassed = false;
		try {
			await readAndVerifyReducedCpuStudyPreregistration(options.preregistrationPath, {
				requireFreshExecution: false,
			});
			sourceIntegrityPassed = true;
		} catch (error) {
			failure = failure ?? errorText(error);
		}
		let dispatchClaimPairs: ReducedCpuDispatchClaimPair[] = [];
		try {
			dispatchClaimPairs = await readReducedCpuDispatchClaimPairs(guards);
		} catch (error) {
			failure = failure ?? `campaign dispatch claim audit failed: ${errorText(error)}`;
		}
		const campaignIdentityAudit = auditReducedCpuCampaignJobIdentities({
			jobs: arms.flatMap((arm) => arm.jobs),
			dispatchClaimPairs,
		});
		const noDuplicates = campaignIdentityAudit.passed;
		const noMeasurementReuse = arms.every((arm) => arm.branchBudget.reusedTaskEvaluations === 0);
		const noCrossArmEvidence =
			new Set(arms.map((arm) => arm.branchId)).size === arms.length &&
			arms.every((arm) => {
				const foreign = arms
					.filter((candidate) => candidate.arm !== arm.arm)
					.flatMap((candidate) => candidate.jobs.map((job) => job.proposal.jobId));
				const runtime = runtimes.find((candidate) => candidate.branchId === arm.branchId);
				return runtime
					? foreign.every((jobId) => !JSON.stringify(runtime.sessionManager.getEntries()).includes(jobId))
					: false;
			});
		const calendarMs = Date.now() - startedAtMs;
		const agentActiveMs = tracker.activeMs;
		const evaluatorMs = arms.reduce((total, arm) => total + arm.evaluatorWaitMs, 0);
		const stopReason = budgetReason(tracker, agentActiveMs, calendarMs);
		const completionPassed =
			failure === null &&
			arms.length === REDUCED_CPU_STUDY_ARMS.length &&
			arms.every((arm) => arm.completionPassed) &&
			strictLedgerIntegrityPassed &&
			sourceIntegrityPassed &&
			tracker.accepted <= REDUCED_CPU_PROVIDER_DISPATCH_LIMIT &&
			tracker.compactionCalls === REDUCED_CPU_STUDY_ARMS.length &&
			stopReason === null &&
			noDuplicates &&
			noMeasurementReuse &&
			noCrossArmEvidence;
		const result: ReducedCpuStudyResult = {
			schemaVersion: 1,
			type: "reduced_cpu_study",
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			outcome: completionPassed ? "succeeded" : stopReason ? "budget-stopped" : "failed",
			failure,
			outputDir: preregistration.launch.outputRoot,
			calibrationResultPath: preregistration.calibration.absolutePath,
			calibrationResultSha256: preregistration.calibration.byteSha256,
			model: preregistration.model.fullyQualifiedModel,
			defaultSystemPrompt: true,
			providerMaxRetries: 0,
			transport: "sse",
			providerTracker: tracker,
			activeToolsByArm: {
				stock: ["autoresearch_evaluate"],
				M: ["autoresearch_evaluate", "autoresearch_recall"],
				"M+R": ["autoresearch_evaluate", "autoresearch_recall"],
			},
			startedAt: new Date(startedAtMs).toISOString(),
			finishedAt: new Date().toISOString(),
			calendarMs,
			agentActiveMs,
			evaluatorWaitMs: evaluatorMs,
			budgetStopReason: stopReason,
			arms,
			blockDecision,
			strictLedgerIntegrityPassed,
			strictLedgerEventCount: arms.reduce((total, arm) => total + arm.jobs.length, 0),
			sourceIntegrityPassed,
			noRetries: true,
			noReplacements: arms.every((arm) => arm.providerGraph.unexpectedBlocked === 0),
			noDuplicates,
			campaignIdentityAudit,
			noMeasurementReuse,
			noCrossArmEvidence,
			completionPassed,
		};
		await writePrivateJson(preregistration.launch.resultPath, result, true);
		if (!completionPassed) process.exitCode = 1;
	}
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	void main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionFactory,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "./artifact-store.js";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256 } from "./compiler-gym-adapter.js";
import type { ResearchController } from "./controller.js";
import {
	assessHostOwnedTerminalization,
	createHostOwnedTerminalizationRuntimeTracker,
	type HostOwnedTerminalizationRuntimeTracker,
	recordHostOwnedProviderDispatch,
	recordHostOwnedToolExecution,
	recordIntentionalHostTerminalizationStop,
	shouldHostOwnTerminalization,
} from "./host-owned-terminalization.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import {
	assessStockCpuCompletion,
	expectedStockCpuProvenance,
	parseStockChampionReport,
	parseStockCpuCalibration,
	STOCK_CPU_MAX_SUBMISSIONS,
	STOCK_CPU_TASKS,
	type StockCpuCalibration,
	selectStockCpuChampion,
} from "./stock-cpu-protocol.js";
import {
	assessStockInterfaceParityQuality,
	buildStockInterfaceParityPrompt,
	createStockInterfaceParityTool,
	openStockInterfaceParityController,
	parseStockFeedbackProjectionPairPreregistration,
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_ACTIVE_SECONDS_LIMIT,
	STOCK_INTERFACE_PARITY_CALENDAR_SECONDS_LIMIT,
	STOCK_INTERFACE_PARITY_OUTPUT_TOKEN_LIMIT,
	STOCK_INTERFACE_PARITY_PREREGISTRATION,
	STOCK_INTERFACE_PARITY_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT,
	STOCK_INTERFACE_PARITY_REFERENCE,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	STOCK_INTERFACE_PARITY_TREATMENT,
	type StockFeedbackProjectionPairPreregistration,
	type StockInterfaceFeedbackView,
	type StockInterfaceParityBeforeSubmit,
	type StockInterfaceParityEvaluationSchema,
	type StockInterfaceParityFeedbackProjector,
	type StockInterfaceParityPrepareArguments,
	type StockInterfaceParityToolTrace,
} from "./stock-interface-parity-protocol.js";
import type { EvaluationAdapter, JobView } from "./types.js";

export interface StockInterfaceParityTrajectoryOptions {
	outputDir: string;
	calibrationResultPath: string;
	feedbackView: StockInterfaceFeedbackView;
	pairPreregistrationPath: string | null;
	terminalization: TerminalizationMode;
}

export type TerminalizationMode = "assistant-reported" | "host-owned";

export interface RepositorySnapshot {
	head: string;
	coreTreeHashes: Record<string, string>;
	coreWorktreeStatus: string;
	trackedDiffSha256: string;
	untrackedFileHashes: Record<string, string>;
	coreWorktreeDigest: string;
}

export interface PairPreregistrationAnchor {
	path: string;
	sha256: string;
	id: string;
	armId: string;
	record: unknown;
}

export interface PairPreregistrationLoaderInput {
	path: string;
	promptSha256: string;
	implementationBundleSha256: string;
	feedbackView: StockInterfaceFeedbackView;
	armId: string;
}

export type PairPreregistrationLoader = (input: PairPreregistrationLoaderInput) => Promise<PairPreregistrationAnchor>;

export interface StockInterfaceParityPromptDispatchContext {
	controller: ResearchController;
	outputDir: string;
	promptSha256: string;
	preregistrationPath: string;
	preregistrationSha256: string;
	pairAnchor: PairPreregistrationAnchor | null;
}

export type StockInterfaceParityBeforePromptDispatch = (
	input: StockInterfaceParityPromptDispatchContext,
) => Promise<unknown>;

export interface StockInterfaceParityTrajectoryOverrides {
	adapter?: EvaluationAdapter;
	evaluatorScriptPath?: string;
	expectedMeasurementEvaluatorSha256?: string;
	expectedMeasurementProvenance?: Readonly<Record<string, string>>;
	feedbackProjector?: StockInterfaceParityFeedbackProjector;
	beforeSubmit?: StockInterfaceParityBeforeSubmit;
	prepareArguments?: (
		args: unknown,
		providerDispatchOrdinal: number,
	) => ReturnType<StockInterfaceParityPrepareArguments>;
	evaluationSchema?: typeof StockInterfaceParityEvaluationSchema;
	promptBuilder?: (calibration: StockCpuCalibration) => string;
	pairAnchorLoader?: PairPreregistrationLoader;
	pairArmId?: string;
	additionalSourcePaths?: readonly string[];
	beforePromptDispatch?: StockInterfaceParityBeforePromptDispatch;
	stopProviderAfterForbiddenToolExecution?: boolean;
	latchForbiddenToolExecutionWithinResponse?: boolean;
	providerRequestGate?: StockInterfaceParityProviderRequestGate;
	additionalExtensionFactories?: readonly ExtensionFactory[];
	providerSessionId?: string;
	providerVisibleSystemPromptPolicy?: string;
	armMetadata?: {
		id: string;
		feedbackTopology: string;
	};
}

export interface ProviderBudgetTracker {
	outputTokens: number;
	providerCalls: number;
	blockedProviderCalls: number;
	blockedReasons: Array<
		"apparatus-gate" | "forbidden-tool-execution" | "output-token-checkpoint" | "provider-call-limit"
	>;
	apparatusGateFailures?: string[];
}

export interface StockInterfaceParityProviderRequestGateInput {
	payload: unknown;
	providerDispatchOrdinal: number;
	resolvedModel?: StockInterfaceParityResolvedModelSnapshot;
}

export interface StockInterfaceParityProviderRequestGateResult {
	allowed: boolean;
	reason: string | null;
}

export type StockInterfaceParityProviderRequestGate = (
	input: StockInterfaceParityProviderRequestGateInput,
) => StockInterfaceParityProviderRequestGateResult | Promise<StockInterfaceParityProviderRequestGateResult>;

export interface StockInterfaceParityResolvedModelDescriptor {
	provider: string;
	id: string;
	api: string;
	baseUrl: string;
	headerNames: string[];
}

export interface StockInterfaceParityResolvedModelSnapshot {
	registryModel: StockInterfaceParityResolvedModelDescriptor | null;
	sessionModel: StockInterfaceParityResolvedModelDescriptor | null;
	registryLoadErrorPresent: boolean;
	storedCredentialType: "api_key" | "oauth" | null;
	oauthProviderRegistered: boolean;
	requestAuthResolved: boolean;
	apiKeyPresent: boolean;
	selectedAuthSource: string | null;
	resolvedRequestHeaderNames: string[];
}

export type StockInterfaceParityResolvedModelSnapshotProvider =
	() => Promise<StockInterfaceParityResolvedModelSnapshot>;

interface OperationalGate {
	passed: boolean;
	checks: Record<string, boolean>;
	failures: string[];
}

const PROVIDER_TIMEOUT_MS = 120_000;
export const STOCK_INTERFACE_PARITY_SAME_RESPONSE_LATCH_ERROR =
	"Evaluator dispatch blocked after a forbidden tool execution in the same provider response" as const;
export const PRIME_RUNTIME_WORKTREE_PATHS = [
	"packages/ai",
	"packages/agent",
	"packages/coding-agent",
	"packages/tui",
] as const;

function parseOptions(argv: readonly string[]): StockInterfaceParityTrajectoryOptions {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(
				"Usage: stock-interface-parity --output-dir <path> --calibration-result <path> [--terminalization <assistant-reported|host-owned>] [--feedback-view <full|concise>] [--pair-preregistration <path>]",
			);
		}
		if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
		values.set(flag, value);
	}
	for (const flag of values.keys()) {
		if (
			flag !== "--output-dir" &&
			flag !== "--calibration-result" &&
			flag !== "--terminalization" &&
			flag !== "--feedback-view" &&
			flag !== "--pair-preregistration"
		) {
			throw new Error(`Unknown option: ${flag}`);
		}
	}
	const outputDir = values.get("--output-dir");
	const calibrationResultPath = values.get("--calibration-result");
	if (!outputDir || !calibrationResultPath) throw new Error("Both output paths are required");
	const terminalization = values.get("--terminalization") ?? "assistant-reported";
	if (terminalization !== "assistant-reported" && terminalization !== "host-owned") {
		throw new Error("--terminalization must be assistant-reported or host-owned");
	}
	const feedbackView = values.get("--feedback-view") ?? "full";
	if (feedbackView !== "full" && feedbackView !== "concise") {
		throw new Error("--feedback-view must be full or concise");
	}
	const pairPreregistrationPath = values.get("--pair-preregistration") ?? null;
	if (terminalization === "host-owned" && pairPreregistrationPath === null) {
		throw new Error("Host-owned feedback runs require --pair-preregistration");
	}
	if (terminalization === "assistant-reported" && feedbackView !== "full") {
		throw new Error("Concise feedback requires host-owned terminalization");
	}
	if (terminalization === "assistant-reported" && pairPreregistrationPath !== null) {
		throw new Error("Pair preregistration is only valid with host-owned terminalization");
	}
	return {
		outputDir: resolve(outputDir),
		calibrationResultPath: resolve(calibrationResultPath),
		feedbackView,
		pairPreregistrationPath: pairPreregistrationPath ? resolve(pairPreregistrationPath) : null,
		terminalization,
	};
}

function commandOutput(command: string, args: readonly string[], cwd: string): string {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
	return result.stdout.trim();
}

function commandBytes(command: string, args: readonly string[], cwd: string): Buffer {
	const result = spawnSync(command, args, { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`);
	}
	return result.stdout;
}

export function capturePrimeRuntimeWorktreeSnapshot(
	repoRoot: string,
	options: {
		expectedHead?: string;
		runtimePaths?: readonly string[];
	} = {},
): RepositorySnapshot {
	const expectedHead = options.expectedHead ?? FROZEN_CAMPAIGN.repositories.primeAgent.commit;
	const runtimePaths = options.runtimePaths ?? PRIME_RUNTIME_WORKTREE_PATHS;
	if (runtimePaths.length === 0 || new Set(runtimePaths).size !== runtimePaths.length) {
		throw new Error("Prime runtime worktree paths must be nonempty and unique");
	}
	for (const path of runtimePaths) {
		if (!path || path.startsWith("/") || path.split("/").includes("..")) {
			throw new Error(`Prime runtime worktree path must be repository-relative: ${path}`);
		}
	}
	const head = commandOutput("git", ["rev-parse", "HEAD"], repoRoot);
	if (head !== expectedHead) {
		throw new Error(`Prime Agent HEAD ${head} does not match the expected runtime commit ${expectedHead}`);
	}
	const coreTreeHashes = Object.fromEntries(
		runtimePaths.map((path) => [path, commandOutput("git", ["rev-parse", `HEAD:${path}`], repoRoot)]),
	);
	const trackedDiff = commandBytes(
		"git",
		["diff", "--binary", "--no-ext-diff", expectedHead, "--", ...runtimePaths],
		repoRoot,
	);
	const coreWorktreeStatus = commandBytes(
		"git",
		["status", "--porcelain=v1", "--untracked-files=all", "--", ...runtimePaths],
		repoRoot,
	).toString("utf8");
	const untrackedPaths = commandBytes("git", ["ls-files", "--others", "-z", "--", ...runtimePaths], repoRoot)
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.sort();
	const untrackedFileHashes = Object.fromEntries(
		untrackedPaths.map((path) => [
			path,
			createHash("sha256")
				.update(readFileSync(join(repoRoot, path)))
				.digest("hex"),
		]),
	);
	const trackedDiffSha256 = createHash("sha256").update(trackedDiff).digest("hex");
	const coreWorktreeDigest = sha256Json({
		coreWorktreeStatus,
		trackedDiffSha256,
		untrackedFileHashes,
	});
	return {
		head,
		coreTreeHashes,
		coreWorktreeStatus,
		trackedDiffSha256,
		untrackedFileHashes,
		coreWorktreeDigest,
	};
}

const repositorySnapshot = capturePrimeRuntimeWorktreeSnapshot;

async function loadCalibration(path: string): Promise<StockCpuCalibration & { sha256: string }> {
	const contents = await readFile(path, "utf8");
	const sha256 = sha256Text(contents);
	if (sha256 !== STOCK_INTERFACE_PARITY_REFERENCE.calibrationSha256) {
		throw new Error(
			`Calibration hash mismatch: expected ${STOCK_INTERFACE_PARITY_REFERENCE.calibrationSha256}, got ${sha256}`,
		);
	}
	const value: unknown = JSON.parse(contents);
	return {
		...parseStockCpuCalibration(value, sha256Json(FROZEN_CAMPAIGN), COMPILER_GYM_EVALUATOR_SHA256),
		sha256,
	};
}

function sumUsage(usages: readonly Usage[]): Usage {
	return usages.reduce<Usage>(
		(total, usage) => ({
			input: total.input + usage.input,
			output: total.output + usage.output,
			cacheRead: total.cacheRead + usage.cacheRead,
			cacheWrite: total.cacheWrite + usage.cacheWrite,
			totalTokens: total.totalTokens + usage.totalTokens,
			cost: {
				input: total.cost.input + usage.cost.input,
				output: total.cost.output + usage.cost.output,
				cacheRead: total.cost.cacheRead + usage.cost.cacheRead,
				cacheWrite: total.cost.cacheWrite + usage.cost.cacheWrite,
				total: total.cost.total + usage.cost.total,
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

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedHeaderNames(headers: Readonly<Record<string, string>> | undefined): string[] {
	return [...new Set(Object.keys(headers ?? {}).map((name) => name.toLowerCase()))].sort();
}

function resolvedModelDescriptor(model: Model<Api> | undefined): StockInterfaceParityResolvedModelDescriptor | null {
	if (!model) return null;
	return {
		provider: model.provider,
		id: model.id,
		api: model.api,
		baseUrl: model.baseUrl,
		headerNames: sortedHeaderNames(model.headers),
	};
}

export async function captureStockInterfaceParityResolvedModelSnapshot(input: {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	session: AgentSession | null;
	provider: string;
	modelId: string;
}): Promise<StockInterfaceParityResolvedModelSnapshot> {
	const registryModel = input.modelRegistry.find(input.provider, input.modelId);
	const requestAuth = registryModel ? await input.modelRegistry.getApiKeyAndHeaders(registryModel) : null;
	const selectedAuthSource = input.modelRegistry.getCurrentProviderAuthSourceToken(input.provider)?.source ?? null;
	return {
		registryModel: resolvedModelDescriptor(registryModel),
		sessionModel: resolvedModelDescriptor(input.session?.model),
		registryLoadErrorPresent: input.modelRegistry.getError() !== undefined,
		storedCredentialType: input.authStorage.get(input.provider)?.type ?? null,
		oauthProviderRegistered: input.authStorage.getOAuthProviders().some((provider) => provider.id === input.provider),
		requestAuthResolved: requestAuth?.ok === true,
		apiKeyPresent: requestAuth?.ok === true && Boolean(requestAuth.apiKey),
		selectedAuthSource,
		resolvedRequestHeaderNames: requestAuth?.ok === true ? sortedHeaderNames(requestAuth.headers) : [],
	};
}

export function stockInterfaceParityProviderCallLimit(terminalization: TerminalizationMode): number {
	return terminalization === "host-owned" ? STOCK_CPU_MAX_SUBMISSIONS : STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT;
}

export function createStockInterfaceParityProviderBudgetExtension(
	tracker: ProviderBudgetTracker,
	hostTracker: HostOwnedTerminalizationRuntimeTracker | null,
	providerCallLimit = STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT,
	stopProviderAfterForbiddenToolExecution = false,
	providerRequestGate?: StockInterfaceParityProviderRequestGate,
	resolvedModelSnapshotProvider?: StockInterfaceParityResolvedModelSnapshotProvider,
	latchForbiddenToolExecutionWithinResponse = false,
) {
	if (!Number.isSafeInteger(providerCallLimit) || providerCallLimit <= 0) {
		throw new Error("providerCallLimit must be a positive safe integer");
	}
	if (latchForbiddenToolExecutionWithinResponse && (!hostTracker || !stopProviderAfterForbiddenToolExecution)) {
		throw new Error(
			"Same-response forbidden-tool latching requires a host tracker and stop-after-forbidden provider policy",
		);
	}
	return (pi: ExtensionAPI): void => {
		const toolArgs = new Map<string, unknown>();
		let forbiddenAtProviderDispatch: number | null = null;
		if (hostTracker) {
			pi.on("tool_execution_start", (event) => {
				toolArgs.set(event.toolCallId, event.args);
			});
			pi.on("tool_execution_end", (event) => {
				const classification = recordHostOwnedToolExecution(hostTracker, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: toolArgs.get(event.toolCallId),
					result: event.result,
					isError: event.isError,
				});
				if (classification === "forbidden") forbiddenAtProviderDispatch = tracker.providerCalls;
				toolArgs.delete(event.toolCallId);
			});
		}
		if (latchForbiddenToolExecutionWithinResponse) {
			pi.on("tool_call", async () =>
				hostTracker && forbiddenAtProviderDispatch === tracker.providerCalls
					? { block: true, reason: STOCK_INTERFACE_PARITY_SAME_RESPONSE_LATCH_ERROR }
					: undefined,
			);
		}
		pi.on("before_provider_request", async (event, ctx) => {
			try {
				assert.ok(isRecord(event.payload), "Provider payload must be an object for parity budget enforcement");
				if (
					stopProviderAfterForbiddenToolExecution &&
					hostTracker &&
					hostTracker.forbiddenBoundaryEvents.length > 0
				) {
					tracker.blockedProviderCalls++;
					tracker.blockedReasons.push("forbidden-tool-execution");
					ctx.abort();
					return event.payload;
				}
				if (hostTracker && shouldHostOwnTerminalization(hostTracker)) {
					recordIntentionalHostTerminalizationStop(hostTracker);
					ctx.abort();
					return event.payload;
				}
				const blockedReason =
					tracker.outputTokens >= STOCK_INTERFACE_PARITY_OUTPUT_TOKEN_LIMIT
						? "output-token-checkpoint"
						: tracker.providerCalls >= providerCallLimit
							? "provider-call-limit"
							: null;
				if (blockedReason) {
					tracker.blockedProviderCalls++;
					tracker.blockedReasons.push(blockedReason);
					ctx.abort();
					return event.payload;
				}
				let gate: StockInterfaceParityProviderRequestGateResult | undefined;
				try {
					const resolvedModel = await resolvedModelSnapshotProvider?.();
					gate = await providerRequestGate?.({
						payload: structuredClone(event.payload),
						providerDispatchOrdinal: tracker.providerCalls + 1,
						resolvedModel,
					});
				} catch (error) {
					const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
					tracker.blockedProviderCalls++;
					tracker.blockedReasons.push("apparatus-gate");
					const apparatusGateFailures = tracker.apparatusGateFailures ?? [];
					apparatusGateFailures.push(message);
					tracker.apparatusGateFailures = apparatusGateFailures;
					ctx.abort();
					return event.payload;
				}
				if (gate && !gate.allowed) {
					tracker.blockedProviderCalls++;
					tracker.blockedReasons.push("apparatus-gate");
					const apparatusGateFailures = tracker.apparatusGateFailures ?? [];
					apparatusGateFailures.push(gate.reason ?? "provider request apparatus gate rejected");
					tracker.apparatusGateFailures = apparatusGateFailures;
					ctx.abort();
					return event.payload;
				}
				tracker.providerCalls++;
				if (hostTracker) recordHostOwnedProviderDispatch(hostTracker);
				return event.payload;
			} catch (error) {
				const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
				tracker.blockedProviderCalls++;
				tracker.blockedReasons.push("apparatus-gate");
				const apparatusGateFailures = tracker.apparatusGateFailures ?? [];
				apparatusGateFailures.push(message);
				tracker.apparatusGateFailures = apparatusGateFailures;
				ctx.abort();
				return event.payload;
			}
		});
	};
}

export function createStockInterfaceParityProviderBoundBeforeSubmit(
	trace: Pick<StockInterfaceParityToolTrace, "callCount">,
	providerTracker: Pick<ProviderBudgetTracker, "providerCalls">,
	delegate?: StockInterfaceParityBeforeSubmit,
): StockInterfaceParityBeforeSubmit {
	let lastProviderCallWithEvaluatorAttempt = 0;
	return async (input) => {
		const providerCall = providerTracker.providerCalls;
		if (trace.callCount >= providerCall || providerCall <= lastProviderCallWithEvaluatorAttempt) {
			throw new Error("Evaluator dispatch requires a distinct accepted provider response");
		}
		lastProviderCallWithEvaluatorAttempt = providerCall;
		await delegate?.(input);
	};
}

async function promptWithDeadline(session: AgentSession, prompt: string, deadlineMs: number): Promise<number> {
	const remainingMs = deadlineMs - Date.now();
	if (remainingMs <= 0) throw new Error("Parity calendar budget expired before the model turn");
	let watchdogFired = false;
	const watchdog = setTimeout(() => {
		watchdogFired = true;
		session.requestAbort();
	}, remainingMs);
	const startedAt = Date.now();
	try {
		await session.promptAndWait(prompt);
		await session.waitForRlmQuiescence();
	} finally {
		clearTimeout(watchdog);
	}
	if (watchdogFired) throw new Error("Parity calendar budget expired during the model turn");
	return Date.now() - startedAt;
}

function assistantCallShape(messages: readonly AssistantMessage[]): boolean {
	if (messages.length !== STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT) return false;
	for (const message of messages.slice(0, STOCK_CPU_MAX_SUBMISSIONS)) {
		const calls = message.content.filter((block) => block.type === "toolCall");
		if (calls.length !== 1 || calls[0].name !== STOCK_INTERFACE_PARITY_TOOL_NAME) return false;
	}
	return messages.at(-1)?.content.some((block) => block.type === "toolCall") === false;
}

function lineageIsExact(jobs: readonly JobView[], submittedJobIds: readonly string[]): boolean {
	if (jobs.length !== STOCK_CPU_MAX_SUBMISSIONS || submittedJobIds.length !== STOCK_CPU_MAX_SUBMISSIONS) return false;
	const byId = new Map(jobs.map((job) => [job.proposal.jobId, job]));
	return submittedJobIds.every((jobId, index) => {
		const job = byId.get(jobId);
		if (!job) return false;
		const expected = index === 0 ? [] : [submittedJobIds[index - 1]];
		return JSON.stringify(job.proposal.proposal.parentJobIds) === JSON.stringify(expected);
	});
}

function assessOperationalGate(input: {
	jobs: readonly JobView[];
	branchId: string;
	trace: StockInterfaceParityToolTrace;
	providerTracker: ProviderBudgetTracker;
	events: readonly AgentSessionEvent[];
	assistantMessages: readonly AssistantMessage[];
	completionPassed: boolean;
	championReportMatched: boolean;
	budget: ReturnType<Awaited<ReturnType<typeof openStockInterfaceParityController>>["budgetStatus"]>;
	userMessageCount: number;
	sourceIntegrityPassed: boolean;
	repositoryIntegrityPassed: boolean;
}): OperationalGate {
	const toolStarts = input.events.filter((event) => event.type === "tool_execution_start");
	const toolEnds = input.events.filter((event) => event.type === "tool_execution_end");
	const checks = {
		exactJobCount: input.jobs.length === STOCK_CPU_MAX_SUBMISSIONS,
		exactToolCalls:
			input.trace.callCount === STOCK_CPU_MAX_SUBMISSIONS &&
			toolStarts.length === STOCK_CPU_MAX_SUBMISSIONS &&
			toolEnds.length === STOCK_CPU_MAX_SUBMISSIONS,
		exactToolIdentity:
			toolStarts.every((event) => event.toolName === STOCK_INTERFACE_PARITY_TOOL_NAME) &&
			toolEnds.every((event) => event.toolName === STOCK_INTERFACE_PARITY_TOOL_NAME && event.isError === false),
		exactProviderCalls:
			input.providerTracker.providerCalls === STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT &&
			input.assistantMessages.length === STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT,
		providerCallShape: assistantCallShape(input.assistantMessages),
		providerBudgetUnblocked: input.providerTracker.blockedProviderCalls === 0,
		singleUserPrompt: input.userMessageCount === 1,
		noCompaction:
			input.events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end").length ===
			0,
		noDuplicateDispatch:
			input.trace.duplicateCount === 0 && new Set(input.trace.jobIds).size === STOCK_CPU_MAX_SUBMISSIONS,
		exactLineage: lineageIsExact(input.jobs, input.trace.jobIds),
		freshMeasurements: input.jobs.every(
			(job) => job.proposal.requireFreshMeasurement === true && job.measurement?.reuse === undefined,
		),
		exactLogicalTaskBudget: input.budget.taskEvaluations === STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
		exactActualTaskBudget: input.budget.actualTaskEvaluations === STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
		zeroReusedTasks: input.budget.reusedTaskEvaluations === 0,
		completionPassed: input.completionPassed,
		championReportMatched: input.championReportMatched,
		sourceIntegrityPassed: input.sourceIntegrityPassed,
		repositoryIntegrityPassed: input.repositoryIntegrityPassed,
		branchScope: input.jobs.every((job) => job.proposal.branchId === input.branchId),
	};
	const failures = Object.entries(checks)
		.filter(([, passed]) => !passed)
		.map(([name]) => name);
	return { passed: failures.length === 0, checks, failures };
}

function jsonSafe(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

function expectedMeasurementProvenance(
	value: Readonly<Record<string, string>> | undefined,
	evaluatorSha256: string,
): Record<string, string> {
	const provenance = value ? { ...value } : expectedStockCpuProvenance(evaluatorSha256);
	if (Object.keys(provenance).length === 0) throw new Error("Expected measurement provenance must be nonempty");
	for (const [key, item] of Object.entries(provenance)) {
		if (!key.trim() || !item.trim()) throw new Error("Expected measurement provenance must contain nonempty strings");
	}
	if (provenance.evaluatorSha256 !== evaluatorSha256) {
		throw new Error("Expected measurement provenance evaluator hash is inconsistent");
	}
	return provenance;
}

function projectJobsForStockSelection(jobs: readonly JobView[], provenance: Record<string, string>): JobView[] {
	return jobs.map((job) => {
		const projected = structuredClone(job);
		if (projected.measurement) projected.measurement.provenance = { ...provenance };
		return projected;
	});
}

async function sourceHashes(paths: readonly string[]): Promise<Record<string, string>> {
	return Object.fromEntries(
		await Promise.all(paths.map(async (path) => [path, sha256Text(await readFile(path, "utf8"))] as const)),
	);
}

export interface StockInterfaceParityImplementationBundleInput {
	evaluatorScriptPath: string;
	additionalSourcePaths?: readonly string[];
}

export interface StockInterfaceParityImplementationBundle {
	sourcePaths: string[];
	sourceHashes: Record<string, string>;
	sha256: string;
}

export function stockInterfaceParityImplementationSourcePaths(
	input: StockInterfaceParityImplementationBundleInput,
): string[] {
	const basePaths = [
		fileURLToPath(import.meta.url),
		fileURLToPath(new URL("./stock-interface-parity-protocol.ts", import.meta.url)),
		fileURLToPath(new URL("./stock-cpu-protocol.ts", import.meta.url)),
		fileURLToPath(new URL("./artifact-store.ts", import.meta.url)),
		fileURLToPath(new URL("./campaign.ts", import.meta.url)),
		fileURLToPath(new URL("./canonical-json.ts", import.meta.url)),
		fileURLToPath(new URL("./compiler-gym-adapter.ts", import.meta.url)),
		fileURLToPath(new URL("./controller.ts", import.meta.url)),
		fileURLToPath(new URL("./evaluation-adapter-output-error.ts", import.meta.url)),
		fileURLToPath(new URL("./host-owned-terminalization.ts", import.meta.url)),
		fileURLToPath(new URL("./ledger.ts", import.meta.url)),
		fileURLToPath(new URL("./types.ts", import.meta.url)),
		resolve(input.evaluatorScriptPath),
	];
	const paths = [...basePaths];
	const seen = new Set(paths);
	for (const path of input.additionalSourcePaths ?? []) {
		const resolved = resolve(path);
		if (seen.has(resolved)) throw new Error(`Duplicate implementation source path: ${resolved}`);
		seen.add(resolved);
		paths.push(resolved);
	}
	return paths;
}

export async function computeStockInterfaceParityImplementationBundle(
	input: StockInterfaceParityImplementationBundleInput,
): Promise<StockInterfaceParityImplementationBundle> {
	const sourcePaths = stockInterfaceParityImplementationSourcePaths(input);
	const hashes = await sourceHashes(sourcePaths);
	return { sourcePaths, sourceHashes: hashes, sha256: sha256Json(hashes) };
}

async function verifyJobArtifacts(
	evaluationDir: string,
	jobs: readonly JobView[],
): Promise<{ passed: boolean; verifiedRefs: number; error: string | null }> {
	const store = new ArtifactStore(join(evaluationDir, "artifacts"));
	let verifiedRefs = 0;
	try {
		for (const job of jobs) {
			await store.readString(job.proposal.candidate);
			verifiedRefs++;
			if (job.measurement?.stdout) {
				await store.readString(job.measurement.stdout);
				verifiedRefs++;
			}
			if (job.measurement?.stderr) {
				await store.readString(job.measurement.stderr);
				verifiedRefs++;
			}
		}
		return { passed: true, verifiedRefs, error: null };
	} catch (error) {
		return { passed: false, verifiedRefs, error: error instanceof Error ? error.message : String(error) };
	}
}

async function defaultPairPreregistrationLoader(
	input: PairPreregistrationLoaderInput,
): Promise<PairPreregistrationAnchor> {
	const contents = await readFile(input.path, "utf8");
	const value: unknown = JSON.parse(contents);
	const record: StockFeedbackProjectionPairPreregistration = parseStockFeedbackProjectionPairPreregistration(value, {
		promptSha256: input.promptSha256,
		implementationBundleSha256: input.implementationBundleSha256,
	});
	const expectedArmId = input.feedbackView === "full" ? "full-control" : "concise-treatment";
	assert.equal(input.armId, expectedArmId, "Stock feedback arm ID differs from its feedback view");
	assert.ok(record.runOrder.includes(input.feedbackView), `Pair preregistration omits ${input.feedbackView}`);
	return {
		path: input.path,
		sha256: sha256Text(contents),
		id: record.id,
		armId: input.armId,
		record,
	};
}

async function loadPairPreregistration(input: {
	path: string | null;
	promptSha256: string;
	implementationBundleSha256: string;
	feedbackView: StockInterfaceFeedbackView;
	armId: string;
	loader: PairPreregistrationLoader;
}): Promise<PairPreregistrationAnchor | null> {
	if (input.path === null) return null;
	const anchor = await input.loader({
		path: input.path,
		promptSha256: input.promptSha256,
		implementationBundleSha256: input.implementationBundleSha256,
		feedbackView: input.feedbackView,
		armId: input.armId,
	});
	assert.equal(resolve(anchor.path), resolve(input.path), "Pair preregistration loader changed the anchor path");
	assert.equal(anchor.armId, input.armId, "Pair preregistration loader returned the wrong arm");
	assert.ok(anchor.id.trim(), "Pair preregistration ID must be nonempty");
	assert.match(anchor.sha256, /^[a-f0-9]{64}$/, "Pair preregistration hash must be SHA-256");
	assert.equal(
		sha256Text(await readFile(anchor.path, "utf8")),
		anchor.sha256,
		"Pair preregistration loader returned the wrong hash",
	);
	return anchor;
}

export async function runStockInterfaceParityTrajectory(
	trajectoryOptions: StockInterfaceParityTrajectoryOptions,
	overrides: StockInterfaceParityTrajectoryOverrides = {},
) {
	const options: StockInterfaceParityTrajectoryOptions = {
		...trajectoryOptions,
		outputDir: resolve(trajectoryOptions.outputDir),
		calibrationResultPath: resolve(trajectoryOptions.calibrationResultPath),
		pairPreregistrationPath: trajectoryOptions.pairPreregistrationPath
			? resolve(trajectoryOptions.pairPreregistrationPath)
			: null,
	};
	if (options.terminalization !== "assistant-reported" && options.terminalization !== "host-owned") {
		throw new Error("terminalization must be assistant-reported or host-owned");
	}
	if (options.feedbackView !== "full" && options.feedbackView !== "concise") {
		throw new Error("feedbackView must be full or concise");
	}
	if (options.terminalization === "host-owned" && options.pairPreregistrationPath === null) {
		throw new Error("Host-owned feedback runs require a pair preregistration");
	}
	if (options.terminalization === "assistant-reported" && options.feedbackView !== "full") {
		throw new Error("Concise feedback requires host-owned terminalization");
	}
	if (options.terminalization === "assistant-reported" && options.pairPreregistrationPath !== null) {
		throw new Error("Pair preregistration is only valid with host-owned terminalization");
	}
	const hostOwnsTerminalization = options.terminalization === "host-owned";
	if (overrides.stopProviderAfterForbiddenToolExecution && !hostOwnsTerminalization) {
		throw new Error("Stopping after forbidden tool execution requires host-owned terminalization");
	}
	if (
		overrides.latchForbiddenToolExecutionWithinResponse &&
		(!hostOwnsTerminalization || !overrides.stopProviderAfterForbiddenToolExecution)
	) {
		throw new Error(
			"Same-response forbidden-tool latching requires host-owned terminalization and provider stop-after-forbidden",
		);
	}
	const providerCallLimit = stockInterfaceParityProviderCallLimit(options.terminalization);
	const protocolVersion = hostOwnsTerminalization
		? STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION
		: STOCK_INTERFACE_PARITY_PROTOCOL_VERSION;
	const pairArmId = overrides.pairArmId ?? (options.feedbackView === "full" ? "full-control" : "concise-treatment");
	if (!pairArmId.trim()) throw new Error("Pair arm ID must be nonempty");
	if (overrides.armMetadata && (!overrides.armMetadata.id.trim() || !overrides.armMetadata.feedbackTopology.trim())) {
		throw new Error("Arm metadata fields must be nonempty");
	}
	if (overrides.providerSessionId && !/^[A-Za-z0-9_-]{1,128}$/.test(overrides.providerSessionId)) {
		throw new Error("Provider session ID must contain only path-safe ASCII identifier characters");
	}
	if (
		overrides.providerVisibleSystemPromptPolicy !== undefined &&
		!overrides.providerVisibleSystemPromptPolicy.trim()
	) {
		throw new Error("Provider-visible system-prompt policy must be nonempty");
	}
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const repositoryBefore = repositorySnapshot(repoRoot);
	const startedAtMs = Date.now();
	const deadlineMs = startedAtMs + STOCK_INTERFACE_PARITY_CALENDAR_SECONDS_LIMIT * 1000;
	const evaluationDir = join(options.outputDir, "evaluation");
	const sessionDir = join(options.outputDir, "sessions");
	const workspace = join(options.outputDir, "workspace");
	await mkdir(dirname(options.outputDir), { recursive: true, mode: 0o700 });
	await mkdir(options.outputDir, { mode: 0o700 });
	await chmod(options.outputDir, 0o700);
	await mkdir(evaluationDir, { mode: 0o700 });
	await mkdir(sessionDir, { mode: 0o700 });
	await mkdir(workspace, { mode: 0o700 });

	const trustedEvaluatorScript = resolve(
		overrides.evaluatorScriptPath ?? fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url)),
	);
	const expectedMeasurementEvaluatorSha256 =
		overrides.expectedMeasurementEvaluatorSha256 ?? STOCK_INTERFACE_PARITY_REFERENCE.evaluatorSha256;
	if (!/^[a-f0-9]{64}$/.test(expectedMeasurementEvaluatorSha256)) {
		throw new Error("Expected measurement evaluator hash must be SHA-256");
	}
	const trustedEvaluatorSha256 = sha256Text(await readFile(trustedEvaluatorScript, "utf8"));
	if (trustedEvaluatorSha256 !== expectedMeasurementEvaluatorSha256) {
		throw new Error(`Trusted evaluator hash mismatch: ${trustedEvaluatorSha256}`);
	}
	const calibration = await loadCalibration(options.calibrationResultPath);
	const candidateExpectedProvenance = expectedMeasurementProvenance(
		overrides.expectedMeasurementProvenance,
		expectedMeasurementEvaluatorSha256,
	);
	const stockSelectionProvenance = expectedStockCpuProvenance(expectedMeasurementEvaluatorSha256);
	const selectionCalibration: StockCpuCalibration = {
		...calibration,
		provenance: stockSelectionProvenance,
	};
	const prompt = overrides.promptBuilder
		? overrides.promptBuilder(calibration)
		: buildStockInterfaceParityPrompt(calibration, { hostOwnsTerminalization });
	if (!prompt.trim()) throw new Error("Parity prompt must be nonempty");
	const implementationBundle = await computeStockInterfaceParityImplementationBundle({
		evaluatorScriptPath: trustedEvaluatorScript,
		additionalSourcePaths: overrides.additionalSourcePaths,
	});
	const { sourcePaths, sourceHashes: sourceHashesBefore, sha256: implementationBundleSha256 } = implementationBundle;
	const pairPreregistration = await loadPairPreregistration({
		path: options.pairPreregistrationPath,
		promptSha256: sha256Text(prompt),
		implementationBundleSha256,
		feedbackView: options.feedbackView,
		armId: pairArmId,
		loader: overrides.pairAnchorLoader ?? defaultPairPreregistrationLoader,
	});
	assert.equal(hostOwnsTerminalization, pairPreregistration !== null);
	const preregistration = {
		...STOCK_INTERFACE_PARITY_PREREGISTRATION,
		id: hostOwnsTerminalization
			? `${STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION}:${pairPreregistration?.armId ?? pairArmId}`
			: STOCK_INTERFACE_PARITY_PREREGISTRATION.id,
		claimClass: hostOwnsTerminalization
			? "directional-single-pair-arm"
			: STOCK_INTERFACE_PARITY_PREREGISTRATION.claimClass,
		arm: {
			...STOCK_INTERFACE_PARITY_PREREGISTRATION.arm,
			id: overrides.armMetadata?.id ?? STOCK_INTERFACE_PARITY_PREREGISTRATION.arm.id,
			feedbackTopology:
				overrides.armMetadata?.feedbackTopology ??
				(options.feedbackView === "concise"
					? "one synchronous typed evaluation call preserves complete details and shows the model a concise verified projection"
					: STOCK_INTERFACE_PARITY_PREREGISTRATION.arm.feedbackTopology),
			expectedProviderCalls: hostOwnsTerminalization
				? STOCK_CPU_MAX_SUBMISSIONS
				: STOCK_INTERFACE_PARITY_PREREGISTRATION.arm.expectedProviderCalls,
		},
		frozenCommon: {
			...STOCK_INTERFACE_PARITY_PREREGISTRATION.frozenCommon,
			evaluatorSha256: expectedMeasurementEvaluatorSha256,
		},
		budgets: {
			...STOCK_INTERFACE_PARITY_PREREGISTRATION.budgets,
			providerCallsHard: providerCallLimit,
		},
		protocolVersion,
		terminalization: options.terminalization,
		feedbackView: options.feedbackView,
		pairPreregistrationPath: pairPreregistration?.path ?? null,
		pairPreregistrationSha256: pairPreregistration?.sha256 ?? null,
		pairPreregistrationId: pairPreregistration?.id ?? null,
		pairArmId: pairPreregistration?.armId ?? null,
		implementationBundleSha256,
		frozenAt: new Date(startedAtMs).toISOString(),
		promptSha256: sha256Text(prompt),
		calibrationResultPath: options.calibrationResultPath,
		calibrationDenominatorProvenance: calibration.provenance,
		candidateExpectedProvenance,
		stockSelectionProjectedProvenance: stockSelectionProvenance,
		stopProviderAfterForbiddenToolExecution: overrides.stopProviderAfterForbiddenToolExecution ?? false,
		latchForbiddenToolExecutionWithinResponse: overrides.latchForbiddenToolExecutionWithinResponse ?? false,
		providerSessionId: overrides.providerSessionId ?? null,
		providerVisibleSystemPromptPolicy: overrides.providerVisibleSystemPromptPolicy ?? "default-template-unaltered",
		sourceHashes: sourceHashesBefore,
		repositorySnapshot: repositoryBefore,
	};
	const preregistrationPath = join(options.outputDir, "preregistration.json");
	await writeFile(preregistrationPath, `${JSON.stringify(preregistration, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(preregistrationPath, 0o600);
	const preregistrationSha256 = sha256Text(await readFile(preregistrationPath, "utf8"));

	const controller = await openStockInterfaceParityController(evaluationDir, overrides.adapter);
	await controller.appendRunManifest({
		type: "stock_interface_parity_trajectory",
		phase: "start",
		protocolVersion,
		terminalization: options.terminalization,
		feedbackView: options.feedbackView,
		pairPreregistrationSha256: pairPreregistration?.sha256 ?? null,
		pairPreregistrationId: pairPreregistration?.id ?? null,
		pairArmId: pairPreregistration?.armId ?? null,
		preregistrationSha256,
		promptSha256: sha256Text(prompt),
		calibrationResultSha256: calibration.sha256,
		model: `${FROZEN_CAMPAIGN.model.provider}/${FROZEN_CAMPAIGN.model.id}`,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		requestedServiceTier: FROZEN_CAMPAIGN.model.serviceTier,
		activeTools: [STOCK_INTERFACE_PARITY_TOOL_NAME],
		defaultSystemPrompt: true,
		measurementReuse: false,
		expectedMeasurementEvaluatorSha256,
		calibrationDenominatorProvenance: calibration.provenance,
		candidateExpectedProvenance,
		stockSelectionProjectedProvenance: stockSelectionProvenance,
		stopProviderAfterForbiddenToolExecution: overrides.stopProviderAfterForbiddenToolExecution ?? false,
		latchForbiddenToolExecutionWithinResponse: overrides.latchForbiddenToolExecutionWithinResponse ?? false,
		providerSessionId: overrides.providerSessionId ?? null,
		providerVisibleSystemPromptPolicy: overrides.providerVisibleSystemPromptPolicy ?? "default-template-unaltered",
		startedAt: new Date(startedAtMs).toISOString(),
	});

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find(FROZEN_CAMPAIGN.model.provider, FROZEN_CAMPAIGN.model.id);
	if (!model) throw new Error("openai-codex/gpt-5.6-luna is not registered");
	if (!modelRegistry.hasConfiguredAuth(model)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for Prime Agent");
	}
	let activeSession: AgentSession | null = null;
	const resolvedModelSnapshotProvider: StockInterfaceParityResolvedModelSnapshotProvider | undefined =
		overrides.providerRequestGate
			? () =>
					captureStockInterfaceParityResolvedModelSnapshot({
						authStorage,
						modelRegistry,
						session: activeSession,
						provider: FROZEN_CAMPAIGN.model.provider,
						modelId: FROZEN_CAMPAIGN.model.id,
					})
			: undefined;
	const providerTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
		apparatusGateFailures: [],
	};
	const hostTerminalizationTracker = hostOwnsTerminalization ? createHostOwnedTerminalizationRuntimeTracker() : null;
	const settingsManager = SettingsManager.inMemory({
		transport: "sse",
		compaction: { enabled: false, agentCallable: false, reserveTokens: 4096, keepRecentTokens: 1 },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: PROVIDER_TIMEOUT_MS } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [
			...(overrides.additionalExtensionFactories ?? []),
			createStockInterfaceParityProviderBudgetExtension(
				providerTracker,
				hostTerminalizationTracker,
				providerCallLimit,
				overrides.stopProviderAfterForbiddenToolExecution ?? false,
				overrides.providerRequestGate,
				resolvedModelSnapshotProvider,
				overrides.latchForbiddenToolExecutionWithinResponse ?? false,
			),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
	});
	await resourceLoader.reload();
	const sessionManager = SessionManager.create(workspace, sessionDir);
	if (overrides.providerSessionId) sessionManager.newSession({ id: overrides.providerSessionId });
	sessionManager.flushNow();
	const trace: StockInterfaceParityToolTrace = {
		callCount: 0,
		duplicateCount: 0,
		evaluatorWaitMs: 0,
		jobIds: [],
		requests: [],
		modelFeedbackBytes: [],
	};
	const parityTool = createStockInterfaceParityTool(controller, trace, {
		feedbackView: options.feedbackView,
		hostOwnsTerminalization,
		protocolVersion,
		prepareArguments: overrides.prepareArguments
			? (args) => overrides.prepareArguments!(args, providerTracker.providerCalls)
			: undefined,
		beforeSubmit: createStockInterfaceParityProviderBoundBeforeSubmit(trace, providerTracker, overrides.beforeSubmit),
		feedbackProjector: overrides.feedbackProjector,
		evaluationSchema: overrides.evaluationSchema,
	});
	const { session } = await createAgentSession({
		cwd: workspace,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		serviceTier: FROZEN_CAMPAIGN.model.serviceTier,
		settingsManager,
		sessionManager,
		resourceLoader,
		tools: [parityTool.name],
		customTools: [parityTool],
		includeGoals: false,
		includeCompactSkill: false,
	});
	activeSession = session;
	assert.equal(session.model?.provider, FROZEN_CAMPAIGN.model.provider);
	assert.equal(session.model?.id, FROZEN_CAMPAIGN.model.id);
	assert.equal(session.thinkingLevel, FROZEN_CAMPAIGN.model.thinkingLevel);
	assert.equal(session.serviceTier, FROZEN_CAMPAIGN.model.serviceTier);
	assert.deepEqual(session.getActiveToolNames(), [STOCK_INTERFACE_PARITY_TOOL_NAME]);
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("Parity session is not persistent");
	await chmod(sessionFile, 0o600);

	const events: AgentSessionEvent[] = [];
	const usages: Usage[] = [];
	const assistantMessages: AssistantMessage[] = [];
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			usages.push(structuredClone(message.usage));
			assistantMessages.push(structuredClone(message));
			providerTracker.outputTokens += message.usage.output;
		}
	});

	let promptWallMs = 0;
	let runFailure: string | null = null;
	let promptDispatchAttemptAnchor: unknown = null;
	try {
		if (overrides.beforePromptDispatch) {
			const anchor = await overrides.beforePromptDispatch({
				controller,
				outputDir: options.outputDir,
				promptSha256: sha256Text(prompt),
				preregistrationPath,
				preregistrationSha256,
				pairAnchor: pairPreregistration,
			});
			promptDispatchAttemptAnchor = anchor === undefined ? null : jsonSafe(anchor);
			await controller.appendRunManifest({
				type: "stock_interface_parity_prompt_dispatch_attempt",
				promptDispatchAttemptAnchor,
			});
		}
		promptWallMs = await promptWithDeadline(session, prompt, deadlineMs);
	} catch (error) {
		runFailure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	} finally {
		unsubscribe();
	}

	let ledgerIntegrityPassed = true;
	try {
		controller.verifyLedger();
		verifyLedgerContentsStrict(await readFile(join(evaluationDir, "evidence.jsonl"), "utf8"));
	} catch (error) {
		ledgerIntegrityPassed = false;
		runFailure ??= error instanceof Error ? error.message : String(error);
	}
	const jobs = controller.statusForBranch(session.sessionId);
	const measurementProvenanceIntegrityPassed = jobs.every(
		(job) =>
			job.measurement !== null && sha256Json(job.measurement.provenance) === sha256Json(candidateExpectedProvenance),
	);
	const selectionJobs = projectJobsForStockSelection(jobs, stockSelectionProvenance);
	const selectionScope = {
		branchId: session.sessionId,
		treatment: STOCK_INTERFACE_PARITY_TREATMENT,
		requireFreshMeasurements: true,
	};
	const completionGate = assessStockCpuCompletion(selectionJobs, selectionCalibration, selectionScope);
	const championSelection = selectStockCpuChampion(selectionJobs, selectionCalibration, selectionScope);
	const qualityGate = assessStockInterfaceParityQuality(championSelection);
	const latestAssistantText = assistantMessages.at(-1) ? assistantText(assistantMessages.at(-1)!) : "";
	let reportedChampionJobId: string | null = null;
	let championReportLine: string | null = null;
	let championReportMatched = false;
	try {
		const report = parseStockChampionReport(latestAssistantText, trace.jobIds);
		reportedChampionJobId = report.jobId;
		championReportLine = report.line;
		championReportMatched = reportedChampionJobId === championSelection.selectedJobId;
	} catch (error) {
		if (!hostOwnsTerminalization) {
			runFailure ??= error instanceof Error ? error.message : String(error);
		}
	}
	const sourceHashesAfter = await sourceHashes(sourcePaths);
	const sourceIntegrityPassed = sha256Json(sourceHashesBefore) === sha256Json(sourceHashesAfter);
	const repositoryAfter = repositorySnapshot(repoRoot);
	const repositoryIntegrityPassed = sha256Json(repositoryBefore) === sha256Json(repositoryAfter);
	const artifactIntegrity = await verifyJobArtifacts(evaluationDir, jobs);
	const evaluatorIntegrityPassed =
		measurementProvenanceIntegrityPassed &&
		jobs.every((job) => job.measurement?.provenance.evaluatorSha256 === expectedMeasurementEvaluatorSha256);
	const pairPreregistrationIntegrityPassed = pairPreregistration
		? sha256Text(await readFile(pairPreregistration.path, "utf8")) === pairPreregistration.sha256
		: true;
	const budget = controller.budgetStatus(session.sessionId);
	const userMessageCount = sessionManager
		.getBranch()
		.filter((entry) => entry.type === "message" && entry.message.role === "user").length;
	const hostTerminalizationAssessment =
		hostOwnsTerminalization && hostTerminalizationTracker
			? assessHostOwnedTerminalization(
					selectionJobs,
					selectionCalibration,
					{
						evaluatorDispatches: trace.callCount,
						postTerminalEvaluatorDispatches: hostTerminalizationTracker.postTerminalEvaluatorToolCalls,
						duplicateDispatches: trace.duplicateCount,
						providerDispatchesAfterTerminalMeasurement: hostTerminalizationTracker.postTerminalProviderDispatches,
						blockedProviderRequestsAfterTerminalMeasurement: 0,
						intentionalHostTerminalizationStops: hostTerminalizationTracker.terminalizationStops,
						ledgerIntegrityPassed,
						artifactIntegrityPassed: artifactIntegrity.passed,
						sourceIntegrityPassed,
						evaluatorIntegrityPassed,
						coreIntegrityPassed: repositoryIntegrityPassed,
						forbiddenBoundaryEvents: hostTerminalizationTracker.forbiddenBoundaryEvents,
						readOnlyDeviationEvents: hostTerminalizationTracker.readOnlyDeviationEvents,
						assistantReportText: latestAssistantText,
					},
					selectionScope,
				)
			: null;
	const successfulAssistantResponses = assistantMessages.filter((message) => message.stopReason !== "aborted").length;
	const operationalGate =
		hostOwnsTerminalization && hostTerminalizationTracker && hostTerminalizationAssessment
			? (() => {
					const checks = {
						exactJobCount: jobs.length === STOCK_CPU_MAX_SUBMISSIONS,
						exactToolCalls:
							trace.callCount === STOCK_CPU_MAX_SUBMISSIONS &&
							hostTerminalizationTracker.evaluatorToolCalls === STOCK_CPU_MAX_SUBMISSIONS &&
							hostTerminalizationTracker.postTerminalEvaluatorToolCalls === 0,
						exactProviderCalls:
							providerTracker.providerCalls === STOCK_CPU_MAX_SUBMISSIONS &&
							successfulAssistantResponses === STOCK_CPU_MAX_SUBMISSIONS &&
							hostTerminalizationTracker.providerDispatches === STOCK_CPU_MAX_SUBMISSIONS,
						providerTrackerConsistent:
							providerTracker.providerCalls === hostTerminalizationTracker.providerDispatches &&
							hostTerminalizationTracker.providerDispatchesAtTerminal === providerTracker.providerCalls,
						providerBudgetUnblocked: providerTracker.blockedProviderCalls === 0,
						exactHostTerminalizationStop: hostTerminalizationTracker.terminalizationStops === 1,
						zeroPostTerminalProviderDispatch: hostTerminalizationTracker.postTerminalProviderDispatches === 0,
						singleUserPrompt: userMessageCount === 1,
						noCompaction:
							events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end")
								.length === 0,
						noDuplicateDispatch:
							trace.duplicateCount === 0 && new Set(trace.jobIds).size === STOCK_CPU_MAX_SUBMISSIONS,
						exactLineage: lineageIsExact(jobs, trace.jobIds),
						freshMeasurements: jobs.every(
							(job) => job.proposal.requireFreshMeasurement === true && job.measurement?.reuse === undefined,
						),
						exactLogicalTaskBudget: budget.taskEvaluations === STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
						exactActualTaskBudget:
							budget.actualTaskEvaluations === STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
						zeroReusedTasks: budget.reusedTaskEvaluations === 0,
						exactFeedbackResults:
							trace.modelFeedbackBytes.length === STOCK_CPU_MAX_SUBMISSIONS &&
							trace.modelFeedbackBytes.every((bytes) => Number.isSafeInteger(bytes) && bytes > 0),
						pairPreregistrationBound: pairPreregistration !== null,
						pairPreregistrationIntegrityPassed,
						ledgerIntegrityPassed,
						artifactIntegrityPassed: artifactIntegrity.passed,
						sourceIntegrityPassed,
						repositoryIntegrityPassed,
						evaluatorIntegrityPassed,
						noForbiddenBoundaryEvents: hostTerminalizationTracker.forbiddenBoundaryEvents.length === 0,
						measurementQualified: hostTerminalizationAssessment.measurementQualified,
						terminalizationRuntimeConformant: hostTerminalizationAssessment.terminalizationRuntimeConformant,
					};
					const failures = Object.entries(checks)
						.filter(([, passed]) => !passed)
						.map(([name]) => name);
					return { passed: failures.length === 0, checks, failures };
				})()
			: assessOperationalGate({
					jobs,
					branchId: session.sessionId,
					trace,
					providerTracker,
					events,
					assistantMessages,
					completionPassed: completionGate.passed && ledgerIntegrityPassed,
					championReportMatched,
					budget,
					userMessageCount,
					sourceIntegrityPassed,
					repositoryIntegrityPassed,
				});
	if (!operationalGate.passed) runFailure ??= `Operational gate failed: ${operationalGate.failures.join(", ")}`;
	const finishedAtMs = Date.now();
	const knownRootMessageUsage = sumUsage(usages);
	const sessionStats = session.getSessionStats();
	const activeAgentMs = Math.max(0, promptWallMs - trace.evaluatorWaitMs);
	const activeAgentCheckpointExceeded = activeAgentMs / 1000 >= STOCK_INTERFACE_PARITY_ACTIVE_SECONDS_LIMIT;
	const decision = !operationalGate.passed
		? "integrity-invalid"
		: qualityGate.passed
			? "attainment-demonstrated"
			: "not-promising";
	await controller.appendRunManifest({
		type: "stock_interface_parity_trajectory",
		phase: "end",
		protocolVersion,
		terminalization: options.terminalization,
		feedbackView: options.feedbackView,
		pairPreregistrationSha256: pairPreregistration?.sha256 ?? null,
		pairPreregistrationId: pairPreregistration?.id ?? null,
		pairArmId: pairPreregistration?.armId ?? null,
		promptDispatchAttemptAnchor,
		decision,
		runFailure,
		operationalGate,
		qualityGate,
		championSelection,
		completionGate,
		trace,
		providerTracker,
		stopProviderAfterForbiddenToolExecution: overrides.stopProviderAfterForbiddenToolExecution ?? false,
		latchForbiddenToolExecutionWithinResponse: overrides.latchForbiddenToolExecutionWithinResponse ?? false,
		providerSessionId: overrides.providerSessionId ?? null,
		providerVisibleSystemPromptPolicy: overrides.providerVisibleSystemPromptPolicy ?? "default-template-unaltered",
		hostTerminalizationTracker,
		hostTerminalizationAssessment,
		artifactIntegrity,
		evaluatorIntegrityPassed,
		measurementProvenanceIntegrityPassed,
		pairPreregistrationIntegrityPassed,
		knownRootMessageUsage,
		attributedSessionTokens: sessionStats.tokens,
		promptWallMs,
		evaluatorWaitMs: trace.evaluatorWaitMs,
		activeAgentMs,
		activeAgentCheckpointExceeded,
		calendarMs: finishedAtMs - startedAtMs,
		sourceIntegrityPassed,
		repositoryIntegrityPassed,
		finishedAt: new Date(finishedAtMs).toISOString(),
	});
	controller.verifyLedger();
	sessionManager.flushNow();
	await session.disposeAsync();
	const ledgerContents = await readFile(join(evaluationDir, "evidence.jsonl"), "utf8");
	verifyLedgerContentsStrict(ledgerContents);
	const ledgerLines = ledgerContents.trim().split("\n");
	const terminalLedgerEvent = JSON.parse(ledgerLines.at(-1) ?? "{}") as { hash?: string };
	const sessionContents = await readFile(sessionFile, "utf8");
	const result = {
		ok: operationalGate.passed,
		decision,
		claimClass: hostOwnsTerminalization ? "directional-single-pair-arm" : "single-trajectory-feasibility",
		causalClaimAllowed: false,
		failure: runFailure,
		outputDir: options.outputDir,
		evaluationDir,
		preregistrationPath,
		protocolVersion,
		terminalization: options.terminalization,
		feedbackView: options.feedbackView,
		pairPreregistrationPath: pairPreregistration?.path ?? null,
		pairPreregistrationSha256: pairPreregistration?.sha256 ?? null,
		pairPreregistrationId: pairPreregistration?.id ?? null,
		pairArmId: pairPreregistration?.armId ?? null,
		promptDispatchAttemptAnchor,
		implementationBundleSha256,
		expectedMeasurementEvaluatorSha256,
		calibrationDenominatorProvenance: calibration.provenance,
		candidateExpectedProvenance,
		stockSelectionProjectedProvenance: stockSelectionProvenance,
		model: `${model.provider}/${model.id}`,
		thinkingLevel: session.thinkingLevel,
		requestedAndLocallyEffectiveServiceTier: session.serviceTier,
		upstreamServiceTierAcknowledgement: "not exposed by current provider response API",
		transport: settingsManager.getTransport(),
		providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
		sessionId: session.sessionId,
		sessionFile,
		sessionSha256: sha256Text(sessionContents),
		knownRootMessageUsage,
		attributedSessionTokens: sessionStats.tokens,
		providerTracker,
		stopProviderAfterForbiddenToolExecution: overrides.stopProviderAfterForbiddenToolExecution ?? false,
		latchForbiddenToolExecutionWithinResponse: overrides.latchForbiddenToolExecutionWithinResponse ?? false,
		providerSessionId: overrides.providerSessionId ?? null,
		providerVisibleSystemPromptPolicy: overrides.providerVisibleSystemPromptPolicy ?? "default-template-unaltered",
		hostTerminalizationTracker,
		hostTerminalizationAssessment,
		trace,
		jobs,
		budget,
		completionGate,
		championSelection,
		reportedChampionJobId,
		championReportLine,
		championReportMatched,
		operationalGate,
		artifactIntegrity,
		evaluatorIntegrityPassed,
		measurementProvenanceIntegrityPassed,
		pairPreregistrationIntegrityPassed,
		qualityGate,
		promptWallMs,
		evaluatorWaitMs: trace.evaluatorWaitMs,
		activeAgentMs,
		activeAgentCheckpointExceeded,
		calendarMs: finishedAtMs - startedAtMs,
		sourceHashesBefore,
		sourceHashesAfter,
		sourceIntegrityPassed,
		repositoryBefore,
		repositoryAfter,
		repositoryIntegrityPassed,
		ledgerSha256: sha256Text(ledgerContents),
		terminalLedgerEventHash: terminalLedgerEvent.hash ?? null,
		eventCounts: Object.fromEntries(
			[...new Set(events.map((event) => event.type))]
				.sort()
				.map((type) => [type, events.filter((event) => event.type === type).length]),
		),
		sessionStats: jsonSafe(sessionStats),
		finishedAt: new Date(finishedAtMs).toISOString(),
	};
	const resultPath = join(options.outputDir, "result.json");
	await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(resultPath, 0o600);
	return result;
}

async function main(): Promise<void> {
	const result = await runStockInterfaceParityTrajectory(parseOptions(process.argv.slice(2)));
	console.log(JSON.stringify(result));
	if (!result.ok) process.exitCode = 1;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

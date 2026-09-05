import assert from "node:assert/strict";
import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE,
	FarmShareCompilerGymIrDeltaScreenAdapter,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS,
	COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
	type CompilerGymIrDeltaScreenPreregistration,
	type CompilerGymIrDeltaScreenPrerequisiteIntegrity,
	type CompilerGymIrDeltaScreenSourceRecord,
	collectCompilerGymIrDeltaScreenImplementationClosure,
	parseCompilerGymIrDeltaScreenPreregistration,
	verifyCompilerGymIrDeltaScreenPrerequisites,
} from "./compiler-gym-ir-delta-screen-preregistration.js";
import {
	assertCompilerGymIrDeltaScreenRequestPolicy,
	assertCompilerGymIrDeltaScreenRequestSequence,
	assessCompilerGymIrDeltaScreenPair,
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_SCREEN_ARMS,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
	COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
	type CompilerGymIrDeltaScreenArm,
	type CompilerGymIrDeltaScreenArmResult,
	type CompilerGymIrDeltaScreenCandidateVector,
	CompilerGymIrDeltaScreenEvaluationSchema,
	type CompilerGymIrDeltaScreenPairAssessment,
	parseCompilerGymIrDeltaAggregateStdout,
	projectCompilerGymIrDeltaScreenFeedback,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import { STOCK_CPU_TASKS, type StockCpuEvaluationRequest } from "./stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	computeStockInterfaceParityImplementationBundle,
	type PairPreregistrationAnchor,
	type PairPreregistrationLoader,
	type RepositorySnapshot,
	runStockInterfaceParityTrajectory,
	type StockInterfaceParityProviderRequestGate,
	type StockInterfaceParityResolvedModelSnapshot,
	stockInterfaceParityImplementationSourcePaths,
} from "./stock-interface-parity.js";
import {
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	type StockInterfaceParityEvaluationEnvelope,
} from "./stock-interface-parity-protocol.js";
import type { JobView } from "./types.js";

export const COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL = "compiler-gym-ir-delta-paid-screen-runner-v2" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_SYSTEM_PROMPT_POLICY =
	"default-prime-template-with-preregistered-arm-neutral-path-normalization-v1" as const;

export type CompilerGymIrDeltaScreenArmDisposition =
	| "admitted-directional-arm"
	| "terminal-apparatus-invalid-not-treatment-result"
	| "terminal-scientific-policy-nonconformance";

export interface CompilerGymIrDeltaScreenProviderVisibilityEvidence {
	arm: CompilerGymIrDeltaScreenArm;
	providerSessionId: string;
	systemPromptEvents: number;
	workingDirectoryReplacements: number;
	conversationLogReplacements: number;
	normalizedSystemPromptSha256: string | null;
	normalizedSystemPromptMatchedPairAnchor: boolean | null;
	providerRequestBodySha256s: string[];
	firstProviderRequestBodyMatchedPairAnchor: boolean | null;
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	resolvedModelPolicy?: typeof COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY;
	resolvedModelSnapshots?: StockInterfaceParityResolvedModelSnapshot[];
	resolvedModelSnapshotSha256s?: string[];
	firstResolvedModelMatchedPairAnchor?: boolean | null;
	expectedRuntimeWorktreeSnapshotSha256: string;
	runtimeWorktreeSnapshotSha256s: string[];
	runtimeWorktreeSnapshotMatchesPreregistration: boolean[];
	runtimeWorktreeDispatchAnchors: Array<{
		providerDispatchOrdinal: number;
		path: string;
		sha256: string;
		snapshotSha256: string;
		matchedPreregistration: boolean;
	}>;
	failures: string[];
}

export interface CompilerGymIrDeltaScreenProviderVisibilityPairState {
	normalizedSystemPromptSha256: string | null;
	firstProviderRequestBodySha256: string | null;
	anchorArm: CompilerGymIrDeltaScreenArm | null;
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	firstResolvedModelSnapshotSha256: string | null;
	preregistrationSha256: string;
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot;
	expectedRuntimeWorktreeSnapshotSha256: string;
	runtimeWorktreeSnapshotProvider: () => RepositorySnapshot | Promise<RepositorySnapshot>;
}

export interface CompilerGymIrDeltaScreenProviderVisibilityRuntime {
	evidence: CompilerGymIrDeltaScreenProviderVisibilityEvidence;
	extensionFactory: ExtensionFactory;
	providerRequestGate: StockInterfaceParityProviderRequestGate;
}

type StockTrajectoryResult = Awaited<ReturnType<typeof runStockInterfaceParityTrajectory>>;

interface AssistantSessionRecord {
	stopReason: string;
	errorMessage: string | null;
	toolCalls: Array<{ name: string; arguments: unknown }>;
	emptyAbortContent: boolean;
	zeroUsage: boolean;
}

const EMPTY_ABORTED_ASSISTANT_CONTENT = [{ type: "text", text: "" }] as const;
const ZERO_ASSISTANT_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} as const;

export interface CompilerGymIrDeltaScreenArmAudit {
	arm: CompilerGymIrDeltaScreenArm;
	disposition: CompilerGymIrDeltaScreenArmDisposition;
	admitted: boolean;
	apparatusFailures: string[];
	policyFailures: string[];
	allowedStockRejectionFailures: string[];
	providerVisibility: CompilerGymIrDeltaScreenProviderVisibilityEvidence;
	accountingComplete: boolean;
	providerDispatches: number | null;
	evaluatorJobs: number | null;
	freshTaskEvaluations: number | null;
	candidates: CompilerGymIrDeltaScreenCandidateVector[];
	trajectoryResultPath: string;
	trajectoryResultSha256: string;
	sessionSha256: string;
	ledgerSha256: string;
	terminalLedgerEventHash: string | null;
}

export interface CompilerGymIrDeltaScreenRunnerPreflight {
	repoRoot: string;
	preregistrationPath: string;
	preregistrationSha256: string;
	preregistration: CompilerGymIrDeltaScreenPreregistration;
	implementationClosure: CompilerGymIrDeltaScreenSourceRecord[];
	implementationBundleSha256: string;
	runtimeWorktreeSnapshot: RepositorySnapshot;
	runtimeWorktreeSnapshotSha256: string;
	additionalSourcePaths: string[];
	prerequisiteIntegrity: CompilerGymIrDeltaScreenPrerequisiteIntegrity;
	globalAttemptLockPath: string;
	providerRequestAnchorPath: string;
	calibrationResultPath: string;
	evaluatorScriptPath: string;
}

export interface CompilerGymIrDeltaScreenRunResult {
	protocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL;
	screenProtocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL;
	pairId: typeof COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID;
	disposition:
		| "terminal-complete-directional-single-pair"
		| "terminal-apparatus-invalid-not-treatment-result"
		| "terminal-scientific-policy-nonconformance";
	preregistrationPath: string;
	preregistrationSha256: string;
	implementationBundleSha256: string;
	runtimeWorktreeSnapshotSha256: string;
	globalAttemptLockPath: string;
	globalAttemptLockSha256: string;
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	randomizedArmOrder: readonly [CompilerGymIrDeltaScreenArm, CompilerGymIrDeltaScreenArm];
	arms: CompilerGymIrDeltaScreenArmAudit[];
	pairApparatusFailures: string[];
	assessment: CompilerGymIrDeltaScreenPairAssessment | null;
	actualProviderDispatches: number | null;
	authorizedMaximumProviderDispatches: 8;
	actualEvaluatorJobs: number | null;
	actualFreshTaskEvaluations: number | null;
	causalClaimAllowed: false;
	replicationClaimAllowed: false;
	gpuPromotionAllowed: false;
	pairLedgerPath: string;
	pairLedgerSha256: string;
	terminalPairLedgerEventHash: string;
	startedAt: string;
	finishedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

async function assertPrivateRegularFile(path: string, label: string): Promise<void> {
	const metadata = await stat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`${label} must be a regular mode-0600 file: ${path}`);
	}
}

async function writeExclusivePrivateJson(path: string, value: unknown): Promise<string> {
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await assertPrivateRegularFile(path, "Exclusive screen artifact");
	return sha256Text(contents);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") return false;
		throw error;
	}
}

export function compilerGymIrDeltaScreenRuntimeWorktreeDispatchAnchorPath(input: {
	providerRequestAnchorPath: string;
	arm: CompilerGymIrDeltaScreenArm;
	providerDispatchOrdinal: number;
}): string {
	if (!Number.isSafeInteger(input.providerDispatchOrdinal) || input.providerDispatchOrdinal < 1) {
		throw new Error("Runtime-worktree provider dispatch ordinal must be a positive safe integer");
	}
	return `${resolve(input.providerRequestAnchorPath)}.runtime-worktree.${input.arm}.${input.providerDispatchOrdinal}.json`;
}

function exactRecord(actual: Readonly<Record<string, string>>, expected: Readonly<Record<string, string>>): boolean {
	return canonicalJson(toJsonValue(actual)) === canonicalJson(toJsonValue(expected));
}

function exactStringArray(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((item) => expected.includes(item));
}

function exactJsonValue(actual: unknown, expected: unknown): boolean {
	try {
		return canonicalJson(toJsonValue(actual)) === canonicalJson(toJsonValue(expected));
	} catch {
		return false;
	}
}

export function validateCompilerGymIrDeltaScreenResolvedModelSnapshot(
	snapshot: StockInterfaceParityResolvedModelSnapshot | undefined,
	policy: typeof COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY = COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
): string[] {
	if (!snapshot) return ["resolved model snapshot is absent immediately before provider dispatch"];
	const failures: string[] = [];
	if (
		canonicalJson(toJsonValue(policy)) !==
		canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY))
	) {
		failures.push("resolved model policy differs from the frozen paid-screen policy");
	}
	for (const [label, model] of [
		["registry", snapshot.registryModel],
		["session", snapshot.sessionModel],
	] as const) {
		if (!model) {
			failures.push(`${label} model is absent immediately before provider dispatch`);
			continue;
		}
		if (model.provider !== policy.provider) failures.push(`${label} model provider drifted`);
		if (model.id !== policy.id) failures.push(`${label} model ID drifted`);
		if (model.api !== policy.api) failures.push(`${label} model API drifted`);
		if (model.baseUrl !== policy.baseUrl) failures.push(`${label} model base URL drifted`);
		if (model.baseUrl.endsWith("/")) failures.push(`${label} model base URL violates no-trailing-slash policy`);
		if (!exactStringArray(model.headerNames, policy.allowedModelHeaderNames)) {
			failures.push(`${label} model has unexpected header names`);
		}
	}
	if (snapshot.registryLoadErrorPresent && !policy.registryLoadErrorAllowed) {
		failures.push("model registry reported a models.json load error");
	}
	if (snapshot.storedCredentialType !== policy.requiredStoredCredentialType) {
		failures.push("OpenAI Codex credential is not stored OAuth subscription authentication");
	}
	if (policy.oauthProviderRegistrationRequired && !snapshot.oauthProviderRegistered) {
		failures.push("built-in OpenAI Codex OAuth provider is not registered");
	}
	if (!snapshot.requestAuthResolved) failures.push("provider request authentication did not resolve");
	if (!snapshot.apiKeyPresent) failures.push("resolved OAuth subscription access token is absent");
	if (snapshot.selectedAuthSource !== policy.requiredAuthSource) {
		failures.push("provider request did not select the stored OAuth authentication source");
	}
	if (
		!policy.modelsJsonApiKeyFallbackAllowed &&
		(snapshot.selectedAuthSource === "models_json_key" || snapshot.selectedAuthSource === "models_json_command")
	) {
		failures.push("models.json API-key fallback was selected");
	}
	if (!exactStringArray(snapshot.resolvedRequestHeaderNames, policy.allowedResolvedRequestHeaderNames)) {
		failures.push("resolved provider request authentication has unexpected header names");
	}
	return failures;
}

const EXPECTED_SEMANTIC_REJECTION_OPERATIONAL_FAILURES = [
	"measurementQualified",
	"terminalizationRuntimeConformant",
] as const;

const POLICY_ALLOWED_OPERATIONAL_FAILURES = new Set([
	"exactJobCount",
	"exactToolCalls",
	"exactProviderCalls",
	"providerTrackerConsistent",
	"providerBudgetUnblocked",
	"exactHostTerminalizationStop",
	"noDuplicateDispatch",
	"exactLineage",
	"exactLogicalTaskBudget",
	"exactActualTaskBudget",
	"exactFeedbackResults",
	"noForbiddenBoundaryEvents",
	"measurementQualified",
	"terminalizationRuntimeConformant",
]);

function operationalGateFailureMessage(failures: readonly string[]): string {
	return `Operational gate failed: ${failures.join(", ")}`;
}

function isExpectedPolicyHardFailure(failure: string): boolean {
	return (
		failure === "stock CPU completion gate failed" ||
		failure === "host champion selection is empty" ||
		/^expected 4 evaluator dispatches, observed [0-3]$/.test(failure) ||
		failure.startsWith("forbidden boundary events: ")
	);
}

function replaceExactText(input: string, search: string, replacement: string): { value: string; count: number } {
	if (!search) return { value: input, count: 0 };
	const parts = input.split(search);
	return { value: parts.join(replacement), count: parts.length - 1 };
}

function countExactString(value: unknown, expected: string, seen = new Set<object>()): number {
	if (typeof value === "string") return value === expected ? 1 : 0;
	if (value === null || typeof value !== "object" || seen.has(value)) return 0;
	seen.add(value);
	return (Array.isArray(value) ? value : Object.values(value)).reduce(
		(total, item) => total + countExactString(item, expected, seen),
		0,
	);
}

function validateCompilerGymIrDeltaScreenProviderPayload(input: {
	payload: unknown;
	providerSessionId: string;
	normalizedSystemPrompt: string | null;
	actualWorkingDirectory: string | null;
	actualConversationLog: string | null;
}): string[] {
	if (!isRecord(input.payload)) return ["provider request payload is not an object"];
	const failures: string[] = [];
	const tools = Array.isArray(input.payload.tools) ? input.payload.tools : [];
	const serializedTool = tools.length === 1 && isRecord(tools[0]) ? tools[0] : null;
	const exactChecks: Array<[boolean, string]> = [
		[input.payload.model === "gpt-5.6-luna", "provider request model drifted"],
		[input.payload.store === false, "provider request store flag drifted"],
		[input.payload.stream === true, "provider request stream flag drifted"],
		[input.payload.prompt_cache_key === input.providerSessionId, "provider prompt-cache session ID drifted"],
		[input.payload.service_tier === "priority", "provider service tier drifted"],
		[input.payload.tool_choice === "auto", "provider tool choice drifted"],
		[input.payload.parallel_tool_calls === true, "provider parallel-tool flag drifted"],
		[
			input.payload.instructions === input.normalizedSystemPrompt,
			"provider instructions differ from normalized system prompt",
		],
		[Array.isArray(input.payload.input), "provider request input is not an array"],
		[Array.isArray(input.payload.tools) && tools.length === 1, "provider request tool count drifted"],
		[serializedTool !== null, "provider request tool is not an object"],
		[serializedTool?.type === "function", "provider request tool type drifted"],
		[serializedTool?.name === STOCK_INTERFACE_PARITY_TOOL_NAME, "provider request tool identity drifted"],
		[serializedTool?.strict === null, "provider request tool strict flag drifted"],
		[
			exactJsonValue(serializedTool?.parameters ?? null, CompilerGymIrDeltaScreenEvaluationSchema),
			"provider request tool parameters differ from the frozen paid-screen schema",
		],
		[
			countExactString(input.payload.input, buildCompilerGymIrDeltaScreenPrompt()) === 1,
			"provider request does not contain exactly one frozen user prompt",
		],
		[isRecord(input.payload.text) && input.payload.text.verbosity === "low", "provider text verbosity drifted"],
		[
			isRecord(input.payload.reasoning) &&
				input.payload.reasoning.effort === "xhigh" &&
				input.payload.reasoning.summary === "auto",
			"provider reasoning configuration drifted",
		],
	];
	for (const [passed, message] of exactChecks) if (!passed) failures.push(message);
	const serialized = JSON.stringify(input.payload);
	for (const forbidden of [
		...COMPILER_GYM_IR_DELTA_SCREEN_ARMS,
		input.actualWorkingDirectory,
		input.actualConversationLog,
	]) {
		if (forbidden && serialized.includes(forbidden)) {
			failures.push(`provider request retained forbidden arm-local text: ${forbidden}`);
		}
	}
	return failures;
}

export function createCompilerGymIrDeltaScreenProviderVisibilityPairState(input: {
	providerRequestAnchorPath: string;
	preregistrationSha256: string;
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot;
	runtimeWorktreeSnapshotProvider: () => RepositorySnapshot | Promise<RepositorySnapshot>;
}): CompilerGymIrDeltaScreenProviderVisibilityPairState {
	const expectedRuntimeWorktreeSnapshot = structuredClone(input.expectedRuntimeWorktreeSnapshot);
	return {
		normalizedSystemPromptSha256: null,
		firstProviderRequestBodySha256: null,
		anchorArm: null,
		providerRequestAnchorPath: resolve(input.providerRequestAnchorPath),
		providerRequestAnchorSha256: null,
		firstResolvedModelSnapshotSha256: null,
		preregistrationSha256: input.preregistrationSha256,
		expectedRuntimeWorktreeSnapshot,
		expectedRuntimeWorktreeSnapshotSha256: sha256Json(expectedRuntimeWorktreeSnapshot),
		runtimeWorktreeSnapshotProvider: input.runtimeWorktreeSnapshotProvider,
	};
}

export function createCompilerGymIrDeltaScreenProviderVisibilityRuntime(input: {
	arm: CompilerGymIrDeltaScreenArm;
	providerSessionId: string;
	pairState: CompilerGymIrDeltaScreenProviderVisibilityPairState;
	resolvedModelPolicy?: typeof COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY;
}): CompilerGymIrDeltaScreenProviderVisibilityRuntime {
	let normalizedSystemPrompt: string | null = null;
	let actualWorkingDirectory: string | null = null;
	let actualConversationLog: string | null = null;
	const evidence: CompilerGymIrDeltaScreenProviderVisibilityEvidence = {
		arm: input.arm,
		providerSessionId: input.providerSessionId,
		systemPromptEvents: 0,
		workingDirectoryReplacements: 0,
		conversationLogReplacements: 0,
		normalizedSystemPromptSha256: null,
		normalizedSystemPromptMatchedPairAnchor: null,
		providerRequestBodySha256s: [],
		firstProviderRequestBodyMatchedPairAnchor: null,
		providerRequestAnchorPath: input.pairState.providerRequestAnchorPath,
		providerRequestAnchorSha256: null,
		...(input.resolvedModelPolicy
			? {
					resolvedModelPolicy: structuredClone(input.resolvedModelPolicy),
					resolvedModelSnapshots: [],
					resolvedModelSnapshotSha256s: [],
					firstResolvedModelMatchedPairAnchor: null,
				}
			: {}),
		expectedRuntimeWorktreeSnapshotSha256: input.pairState.expectedRuntimeWorktreeSnapshotSha256,
		runtimeWorktreeSnapshotSha256s: [],
		runtimeWorktreeSnapshotMatchesPreregistration: [],
		runtimeWorktreeDispatchAnchors: [],
		failures: [],
	};
	const extensionFactory: ExtensionFactory = (pi: ExtensionAPI): void => {
		pi.on("before_agent_start", (event) => {
			evidence.systemPromptEvents++;
			if (evidence.systemPromptEvents !== 1) {
				evidence.failures.push(`expected one before_agent_start event, observed ${evidence.systemPromptEvents}`);
			}
			actualWorkingDirectory = event.systemPromptOptions.cwd.replace(/\\/g, "/");
			actualConversationLog = event.systemPromptOptions.messagesPath?.replace(/\\/g, "/") ?? null;
			if (event.systemPromptOptions.customPrompt !== undefined) {
				evidence.failures.push("paid screen replaced the default Prime system-prompt template");
			}
			if (!exactStringArray(event.systemPromptOptions.selectedTools ?? [], [STOCK_INTERFACE_PARITY_TOOL_NAME])) {
				evidence.failures.push("system-prompt active-tool set drifted");
			}
			if ((event.systemPromptOptions.contextFiles?.length ?? 0) !== 0) {
				evidence.failures.push("system prompt loaded project context files");
			}
			if ((event.systemPromptOptions.skills?.length ?? 0) !== 0) {
				evidence.failures.push("system prompt loaded skills");
			}
			let normalized = event.systemPrompt;
			if (actualConversationLog === null) {
				evidence.failures.push("persistent conversation-log path is absent from system-prompt options");
			} else {
				const replacement = replaceExactText(
					normalized,
					actualConversationLog,
					COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
				);
				normalized = replacement.value;
				evidence.conversationLogReplacements += replacement.count;
			}
			const workspaceReplacement = replaceExactText(
				normalized,
				actualWorkingDirectory,
				COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
			);
			normalized = workspaceReplacement.value;
			evidence.workingDirectoryReplacements += workspaceReplacement.count;
			if (evidence.workingDirectoryReplacements !== 1) {
				evidence.failures.push("system prompt did not expose the expected working-directory path");
			}
			if (evidence.conversationLogReplacements !== 1) {
				evidence.failures.push("system prompt did not expose the expected conversation-log path");
			}
			if (COMPILER_GYM_IR_DELTA_SCREEN_ARMS.some((arm) => normalized.includes(arm))) {
				evidence.failures.push("normalized system prompt still contains a treatment-arm label");
			}
			normalizedSystemPrompt = normalized;
			const normalizedSha256 = sha256Text(normalized);
			evidence.normalizedSystemPromptSha256 = normalizedSha256;
			if (input.pairState.normalizedSystemPromptSha256 === null) {
				input.pairState.normalizedSystemPromptSha256 = normalizedSha256;
				input.pairState.anchorArm = input.arm;
				evidence.normalizedSystemPromptMatchedPairAnchor = true;
			} else {
				evidence.normalizedSystemPromptMatchedPairAnchor =
					input.pairState.normalizedSystemPromptSha256 === normalizedSha256;
				if (!evidence.normalizedSystemPromptMatchedPairAnchor) {
					evidence.failures.push("normalized system prompt differs between paid-screen arms");
				}
			}
			return { systemPrompt: normalized };
		});
	};
	const providerRequestGate: StockInterfaceParityProviderRequestGate = async ({
		payload,
		providerDispatchOrdinal,
		resolvedModel,
	}) => {
		let runtimeWorktreeSnapshot: RepositorySnapshot;
		try {
			runtimeWorktreeSnapshot = await input.pairState.runtimeWorktreeSnapshotProvider();
		} catch (error) {
			const failure = `runtime worktree snapshot failed immediately before provider dispatch: ${errorText(error)}`;
			evidence.failures.push(failure);
			return { allowed: false, reason: failure };
		}
		const runtimeWorktreeSnapshotSha256 = sha256Json(runtimeWorktreeSnapshot);
		const runtimeWorktreeSnapshotMatchedPreregistration =
			runtimeWorktreeSnapshotSha256 === input.pairState.expectedRuntimeWorktreeSnapshotSha256 &&
			canonicalJson(toJsonValue(runtimeWorktreeSnapshot)) ===
				canonicalJson(toJsonValue(input.pairState.expectedRuntimeWorktreeSnapshot));
		evidence.runtimeWorktreeSnapshotSha256s.push(runtimeWorktreeSnapshotSha256);
		evidence.runtimeWorktreeSnapshotMatchesPreregistration.push(runtimeWorktreeSnapshotMatchedPreregistration);
		const runtimeWorktreeDispatchAnchorPath = compilerGymIrDeltaScreenRuntimeWorktreeDispatchAnchorPath({
			providerRequestAnchorPath: input.pairState.providerRequestAnchorPath,
			arm: input.arm,
			providerDispatchOrdinal,
		});
		const runtimeWorktreeDispatchAnchorSha256 = await writeExclusivePrivateJson(runtimeWorktreeDispatchAnchorPath, {
			protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
			pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
			preregistrationSha256: input.pairState.preregistrationSha256,
			arm: input.arm,
			providerDispatchOrdinal,
			expectedRuntimeWorktreeSnapshotSha256: input.pairState.expectedRuntimeWorktreeSnapshotSha256,
			runtimeWorktreeSnapshot,
			runtimeWorktreeSnapshotSha256,
			matchedPreregistration: runtimeWorktreeSnapshotMatchedPreregistration,
			capturedAt: new Date().toISOString(),
		});
		evidence.runtimeWorktreeDispatchAnchors.push({
			providerDispatchOrdinal,
			path: runtimeWorktreeDispatchAnchorPath,
			sha256: runtimeWorktreeDispatchAnchorSha256,
			snapshotSha256: runtimeWorktreeSnapshotSha256,
			matchedPreregistration: runtimeWorktreeSnapshotMatchedPreregistration,
		});
		if (!runtimeWorktreeSnapshotMatchedPreregistration) {
			evidence.failures.push("complete Prime runtime worktree snapshot differs from paid preregistration");
		}
		if (providerDispatchOrdinal !== evidence.providerRequestBodySha256s.length + 1) {
			evidence.failures.push("provider request ordinal drifted from captured request bodies");
		}
		let resolvedModelSnapshotSha256: string | null = null;
		if (input.resolvedModelPolicy) {
			evidence.failures.push(
				...validateCompilerGymIrDeltaScreenResolvedModelSnapshot(resolvedModel, input.resolvedModelPolicy),
			);
			if (resolvedModel) {
				const snapshot = structuredClone(resolvedModel);
				resolvedModelSnapshotSha256 = sha256Json(snapshot);
				evidence.resolvedModelSnapshots?.push(snapshot);
				evidence.resolvedModelSnapshotSha256s?.push(resolvedModelSnapshotSha256);
				if (input.pairState.firstResolvedModelSnapshotSha256 === null) {
					evidence.firstResolvedModelMatchedPairAnchor = true;
				} else {
					evidence.firstResolvedModelMatchedPairAnchor =
						input.pairState.firstResolvedModelSnapshotSha256 === resolvedModelSnapshotSha256;
					if (!evidence.firstResolvedModelMatchedPairAnchor) {
						evidence.failures.push("resolved model snapshot differs from the durable pair anchor");
					}
				}
			}
		}
		evidence.failures.push(
			...validateCompilerGymIrDeltaScreenProviderPayload({
				payload,
				providerSessionId: input.providerSessionId,
				normalizedSystemPrompt,
				actualWorkingDirectory,
				actualConversationLog,
			}),
		);
		const serializedRequestBody = JSON.stringify(payload);
		const requestBodySha256 = sha256Text(serializedRequestBody);
		evidence.providerRequestBodySha256s.push(requestBodySha256);
		if (providerDispatchOrdinal === 1) {
			if (input.pairState.firstProviderRequestBodySha256 === null) {
				if (evidence.failures.length > 0 || evidence.normalizedSystemPromptSha256 === null) {
					return { allowed: false, reason: evidence.failures.join("; ") || "normalized system prompt is absent" };
				}
				if (input.resolvedModelPolicy && (!resolvedModel || resolvedModelSnapshotSha256 === null)) {
					return { allowed: false, reason: "resolved model snapshot is absent from the provider request gate" };
				}
				const anchorSha256 = await writeExclusivePrivateJson(input.pairState.providerRequestAnchorPath, {
					protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
					pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
					preregistrationSha256: input.pairState.preregistrationSha256,
					providerSessionId: input.providerSessionId,
					providerVisibleWorkspace: COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
					providerVisibleConversationLog: COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
					normalizedSystemPromptSha256: evidence.normalizedSystemPromptSha256,
					resolvedModelPolicy: input.resolvedModelPolicy ?? null,
					resolvedModelSnapshot: resolvedModel ?? null,
					resolvedModelSnapshotSha256,
					expectedRuntimeWorktreeSnapshotSha256: input.pairState.expectedRuntimeWorktreeSnapshotSha256,
					firstRuntimeWorktreeSnapshotSha256: runtimeWorktreeSnapshotSha256,
					firstRuntimeWorktreeDispatchAnchorPath: runtimeWorktreeDispatchAnchorPath,
					firstRuntimeWorktreeDispatchAnchorSha256: runtimeWorktreeDispatchAnchorSha256,
					firstProviderRequestBodySha256: requestBodySha256,
					firstProviderRequestBody: serializedRequestBody,
					anchorArm: input.arm,
					createdAt: new Date().toISOString(),
				});
				input.pairState.firstProviderRequestBodySha256 = requestBodySha256;
				input.pairState.firstResolvedModelSnapshotSha256 = resolvedModelSnapshotSha256;
				input.pairState.providerRequestAnchorSha256 = anchorSha256;
				input.pairState.anchorArm ??= input.arm;
				evidence.firstProviderRequestBodyMatchedPairAnchor = true;
				evidence.providerRequestAnchorSha256 = anchorSha256;
			} else {
				await assertPrivateRegularFile(input.pairState.providerRequestAnchorPath, "Provider request parity anchor");
				const liveAnchor = await readFile(input.pairState.providerRequestAnchorPath, "utf8");
				const liveAnchorSha256 = sha256Text(liveAnchor);
				evidence.providerRequestAnchorSha256 = liveAnchorSha256;
				if (
					input.pairState.providerRequestAnchorSha256 === null ||
					liveAnchorSha256 !== input.pairState.providerRequestAnchorSha256
				) {
					evidence.failures.push("provider request parity anchor drifted between paid-screen arms");
				}
				try {
					const durableAnchor: unknown = JSON.parse(liveAnchor);
					if (
						!isRecord(durableAnchor) ||
						durableAnchor.firstProviderRequestBodySha256 !== requestBodySha256 ||
						durableAnchor.firstProviderRequestBody !== serializedRequestBody
					) {
						evidence.failures.push("first provider request bytes differ from the durable pair anchor");
					}
					if (
						input.resolvedModelPolicy &&
						(!resolvedModel ||
							!isRecord(durableAnchor) ||
							durableAnchor.resolvedModelSnapshotSha256 !== resolvedModelSnapshotSha256 ||
							canonicalJson(toJsonValue(durableAnchor.resolvedModelPolicy)) !==
								canonicalJson(toJsonValue(input.resolvedModelPolicy)) ||
							canonicalJson(toJsonValue(durableAnchor.resolvedModelSnapshot)) !==
								canonicalJson(toJsonValue(resolvedModel)))
					) {
						evidence.failures.push("resolved model evidence differs from the durable pair anchor");
					}
					if (
						!isRecord(durableAnchor) ||
						durableAnchor.expectedRuntimeWorktreeSnapshotSha256 !==
							input.pairState.expectedRuntimeWorktreeSnapshotSha256 ||
						durableAnchor.firstRuntimeWorktreeSnapshotSha256 !== runtimeWorktreeSnapshotSha256
					) {
						evidence.failures.push("runtime worktree evidence differs from the durable pair anchor");
					}
				} catch (error) {
					evidence.failures.push(`provider request parity anchor JSON failed: ${errorText(error)}`);
				}
				evidence.firstProviderRequestBodyMatchedPairAnchor =
					input.pairState.firstProviderRequestBodySha256 === requestBodySha256;
				if (!evidence.firstProviderRequestBodyMatchedPairAnchor) {
					evidence.failures.push("first provider request body differs between paid-screen arms");
				}
			}
		}
		return {
			allowed: evidence.failures.length === 0,
			reason: evidence.failures.length === 0 ? null : evidence.failures.join("; "),
		};
	};
	return { evidence, extensionFactory, providerRequestGate };
}

function parseAssistantSessionRecords(contents: string): AssistantSessionRecord[] {
	if (!contents.endsWith("\n")) throw new Error("Session JSONL is not newline terminated");
	const assistants: AssistantSessionRecord[] = [];
	for (const [index, line] of contents.slice(0, -1).split("\n").entries()) {
		if (!line) throw new Error(`Session JSONL contains an empty line at ${index + 1}`);
		const entry: unknown = JSON.parse(line);
		if (
			!isRecord(entry) ||
			entry.type !== "message" ||
			!isRecord(entry.message) ||
			entry.message.role !== "assistant"
		) {
			continue;
		}
		const content = entry.message.content;
		if (!Array.isArray(content)) throw new Error(`Assistant session message ${index + 1} lacks content`);
		const toolCalls = content.flatMap((block) => {
			if (!isRecord(block) || block.type !== "toolCall") return [];
			if (typeof block.name !== "string") throw new Error(`Assistant tool call ${index + 1} lacks a name`);
			return [{ name: block.name, arguments: block.arguments }];
		});
		assistants.push({
			stopReason: typeof entry.message.stopReason === "string" ? entry.message.stopReason : "missing",
			errorMessage: typeof entry.message.errorMessage === "string" ? entry.message.errorMessage : null,
			toolCalls,
			emptyAbortContent:
				canonicalJson(toJsonValue(content)) === canonicalJson(toJsonValue(EMPTY_ABORTED_ASSISTANT_CONTENT)),
			zeroUsage:
				isRecord(entry.message.usage) &&
				canonicalJson(toJsonValue(entry.message.usage)) === canonicalJson(toJsonValue(ZERO_ASSISTANT_USAGE)),
		});
	}
	return assistants;
}

function stockEnvelope(
	request: StockCpuEvaluationRequest,
	job: JobView,
	budget: StockTrajectoryResult["budget"],
): StockInterfaceParityEvaluationEnvelope {
	return {
		type: "typed_sync_compiler_gym_evaluation",
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		request: structuredClone(request),
		submitted: {
			jobId: job.proposal.jobId,
			acceptedAt: job.state.statusAt,
			manifestDigest: job.proposal.manifestDigest,
			duplicate: false,
		},
		job: {
			jobId: job.proposal.jobId,
			manifestDigest: job.proposal.manifestDigest,
			parentJobIds: [...job.proposal.proposal.parentJobIds],
			candidateDigest: job.proposal.candidate.digest,
			state: structuredClone(job.state),
			measurement: structuredClone(job.measurement),
		},
		budget: structuredClone(budget),
	};
}

function classifyCandidate(
	callIndex: 1 | 2 | 3 | 4,
	parsed: ReturnType<typeof parseCompilerGymIrDeltaAggregateStdout>,
): CompilerGymIrDeltaScreenCandidateVector {
	const verified = parsed.tasks.every((task) => task.outcome === "verified");
	if (!verified) {
		return { callIndex, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null };
	}
	const blowfish = parsed.tasks.find((task) => task.benchmarkId === STOCK_CPU_TASKS[0]);
	const bzip2 = parsed.tasks.find((task) => task.benchmarkId === STOCK_CPU_TASKS[1]);
	assert.ok(blowfish && bzip2, "IR-delta aggregate omitted a fixed task");
	return {
		callIndex,
		outcome: "verified",
		blowfishIr: blowfish.finalIrInstructionCount,
		bzip2Ir: bzip2.finalIrInstructionCount,
	};
}

export async function prepareCompilerGymIrDeltaScreenRun(input: {
	preregistrationPath: string;
	repoRoot?: string;
}): Promise<CompilerGymIrDeltaScreenRunnerPreflight> {
	const repoRoot = resolve(input.repoRoot ?? fileURLToPath(new URL("../../..", import.meta.url)));
	const preregistrationPath = resolve(input.preregistrationPath);
	await assertPrivateRegularFile(preregistrationPath, "Paid-screen preregistration");
	const preregistrationContents = await readFile(preregistrationPath, "utf8");
	const implementationClosure = await collectCompilerGymIrDeltaScreenImplementationClosure(repoRoot);
	const runtimeWorktreeSnapshot = capturePrimeRuntimeWorktreeSnapshot(repoRoot);
	const preregistration = parseCompilerGymIrDeltaScreenPreregistration(
		JSON.parse(preregistrationContents) as unknown,
		implementationClosure,
		runtimeWorktreeSnapshot,
	);
	if (`${canonicalJson(toJsonValue(preregistration))}\n` !== preregistrationContents) {
		throw new Error("Paid-screen preregistration is not canonical newline-terminated JSON");
	}
	const preregistrationSha256 = sha256Text(preregistrationContents);
	const prerequisiteIntegrity = await verifyCompilerGymIrDeltaScreenPrerequisites(repoRoot);
	const evaluatorScriptPath = resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const baseSourcePaths = new Set(stockInterfaceParityImplementationSourcePaths({ evaluatorScriptPath }));
	const closurePaths = COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS.map((path) => resolve(repoRoot, path));
	const additionalSourcePaths = closurePaths.filter((path) => !baseSourcePaths.has(path));
	const bundle = await computeStockInterfaceParityImplementationBundle({
		evaluatorScriptPath,
		additionalSourcePaths,
	});
	const globalAttemptLockPath = `${preregistrationPath}.attempt.lock`;
	const providerRequestAnchorPath = `${preregistrationPath}.provider-request-anchor.json`;
	if (await pathExists(globalAttemptLockPath)) {
		throw new Error(`Paid-screen preregistration was already attempted: ${globalAttemptLockPath}`);
	}
	if (await pathExists(providerRequestAnchorPath)) {
		throw new Error(
			`Paid-screen preregistration already has a provider request anchor: ${providerRequestAnchorPath}`,
		);
	}
	for (const arm of COMPILER_GYM_IR_DELTA_SCREEN_ARMS) {
		for (let providerDispatchOrdinal = 1; providerDispatchOrdinal <= 4; providerDispatchOrdinal++) {
			const runtimeAnchorPath = compilerGymIrDeltaScreenRuntimeWorktreeDispatchAnchorPath({
				providerRequestAnchorPath,
				arm,
				providerDispatchOrdinal,
			});
			if (await pathExists(runtimeAnchorPath)) {
				throw new Error(
					`Paid-screen preregistration already has a runtime-worktree dispatch anchor: ${runtimeAnchorPath}`,
				);
			}
		}
	}
	return {
		repoRoot,
		preregistrationPath,
		preregistrationSha256,
		preregistration,
		implementationClosure,
		implementationBundleSha256: bundle.sha256,
		runtimeWorktreeSnapshot,
		runtimeWorktreeSnapshotSha256: sha256Json(runtimeWorktreeSnapshot),
		additionalSourcePaths,
		prerequisiteIntegrity,
		globalAttemptLockPath,
		providerRequestAnchorPath,
		calibrationResultPath: resolve(repoRoot, preregistration.frozenCommon.calibrationArtifact.path),
		evaluatorScriptPath,
	};
}

export function createCompilerGymIrDeltaScreenPairAnchorLoader(
	preflight: CompilerGymIrDeltaScreenRunnerPreflight,
): PairPreregistrationLoader {
	return async (input): Promise<PairPreregistrationAnchor> => {
		if (resolve(input.path) !== preflight.preregistrationPath) {
			throw new Error("Paid-screen pair loader path drifted");
		}
		if (input.promptSha256 !== preflight.preregistration.frozenCommon.promptSha256) {
			throw new Error("Paid-screen pair loader prompt drifted");
		}
		if (input.implementationBundleSha256 !== preflight.implementationBundleSha256) {
			throw new Error("Paid-screen generic implementation bundle drifted");
		}
		if (!preflight.preregistration.randomization.armOrder.includes(input.armId as CompilerGymIrDeltaScreenArm)) {
			throw new Error("Paid-screen pair loader received an unknown arm");
		}
		const liveContents = await readFile(preflight.preregistrationPath, "utf8");
		if (sha256Text(liveContents) !== preflight.preregistrationSha256) {
			throw new Error("Paid-screen preregistration drifted after preflight");
		}
		return {
			path: preflight.preregistrationPath,
			sha256: preflight.preregistrationSha256,
			id: preflight.preregistration.pairId,
			armId: input.armId,
			record: preflight.preregistration,
		};
	};
}

function policyShapeFailures(assistants: readonly AssistantSessionRecord[]): string[] {
	const failures: string[] = [];
	if (assistants.length !== 4) failures.push(`expected four assistant responses, observed ${assistants.length}`);
	for (const [index, assistant] of assistants.entries()) {
		if (assistant.toolCalls.length !== 1) {
			failures.push(`assistant response ${index + 1} emitted ${assistant.toolCalls.length} tool calls`);
			continue;
		}
		if (assistant.toolCalls[0]?.name !== STOCK_INTERFACE_PARITY_TOOL_NAME) {
			failures.push(`assistant response ${index + 1} used the wrong tool`);
		}
	}
	return failures;
}

function providerFailures(
	assistants: readonly AssistantSessionRecord[],
	failure: string | null,
	ignoredAssistantIndex: number | null,
): string[] {
	const failures: string[] = [];
	for (const [index, assistant] of assistants.entries()) {
		if (index === ignoredAssistantIndex) continue;
		if (["aborted", "error", "length"].includes(assistant.stopReason) || assistant.errorMessage !== null) {
			failures.push(
				`assistant response ${index + 1} ended with ${assistant.stopReason}: ${assistant.errorMessage ?? ""}`,
			);
		}
		if (assistant.toolCalls.length > 0 && assistant.stopReason !== "toolUse") {
			failures.push(`assistant response ${index + 1} paired tool calls with ${assistant.stopReason}`);
		}
	}
	if (
		failure &&
		/(?:authentication|invalid_api_key|provider failed|network|ECONN|HTTP |timed? out|timeout)/i.test(failure)
	) {
		failures.push(`provider trajectory failure: ${failure}`);
	}
	return failures;
}

function policyAbortSentinelIndex(input: {
	assistants: readonly AssistantSessionRecord[];
	result: StockTrajectoryResult;
	policyDetected: boolean;
}): number | null {
	const { assistants, result } = input;
	const host = result.hostTerminalizationTracker;
	if (
		!input.policyDetected ||
		result.stopProviderAfterForbiddenToolExecution !== true ||
		result.providerTracker.blockedProviderCalls !== 1 ||
		!exactStringArray(result.providerTracker.blockedReasons, ["forbidden-tool-execution"]) ||
		!host ||
		host.forbiddenBoundaryEvents.length !== 1 ||
		assistants.length !== result.providerTracker.providerCalls + 1
	) {
		return null;
	}
	const sentinels = assistants.flatMap((assistant, index) =>
		assistant.stopReason === "aborted" &&
		assistant.errorMessage === "Request was aborted" &&
		assistant.toolCalls.length === 0 &&
		assistant.emptyAbortContent &&
		assistant.zeroUsage
			? [index]
			: [],
	);
	return sentinels.length === 1 && sentinels[0] === assistants.length - 1 ? sentinels[0] : null;
}

export async function auditCompilerGymIrDeltaScreenArm(input: {
	arm: CompilerGymIrDeltaScreenArm;
	outputDir: string;
	result: StockTrajectoryResult;
	providerVisibility: CompilerGymIrDeltaScreenProviderVisibilityEvidence;
	policyErrors?: readonly string[];
}): Promise<CompilerGymIrDeltaScreenArmAudit> {
	const { arm, result } = input;
	const apparatusFailures: string[] = [];
	const policyFailures = [...(input.policyErrors ?? [])];
	const candidates: CompilerGymIrDeltaScreenCandidateVector[] = [];
	const resultPath = join(input.outputDir, "result.json");
	const ledgerPath = join(input.outputDir, "evaluation", "evidence.jsonl");
	const readEvidence = async (path: string, label: string): Promise<string> => {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			apparatusFailures.push(`${label} could not be read: ${errorText(error)}`);
			return "";
		}
	};
	const resultContents = await readEvidence(resultPath, "trajectory result");
	const sessionContents = await readEvidence(result.sessionFile, "session evidence");
	const ledgerContents = await readEvidence(ledgerPath, "arm ledger");
	for (const [path, label] of [
		[resultPath, "trajectory result"],
		[result.sessionFile, "session evidence"],
	] as const) {
		try {
			await assertPrivateRegularFile(path, label);
		} catch (error) {
			apparatusFailures.push(errorText(error));
		}
	}
	if (!resultContents.endsWith("\n")) apparatusFailures.push("trajectory result is not newline terminated");
	try {
		const diskResult: unknown = JSON.parse(resultContents);
		if (canonicalJson(toJsonValue(diskResult)) !== canonicalJson(toJsonValue(result))) {
			apparatusFailures.push("trajectory result object differs from its durable result file");
		}
	} catch (error) {
		apparatusFailures.push(`trajectory result JSON failed: ${errorText(error)}`);
	}
	const promptDispatchAnchor = result.promptDispatchAttemptAnchor;
	if (!isRecord(promptDispatchAnchor)) {
		apparatusFailures.push("prompt-dispatch attempt anchor is absent");
	} else {
		const globalAttemptLockPath = promptDispatchAnchor.globalAttemptLockPath;
		const globalAttemptLockSha256 = promptDispatchAnchor.globalAttemptLockSha256;
		const armAttemptLockPath = promptDispatchAnchor.armAttemptLockPath;
		const armAttemptLockSha256 = promptDispatchAnchor.armAttemptLockSha256;
		if (
			typeof globalAttemptLockPath !== "string" ||
			typeof globalAttemptLockSha256 !== "string" ||
			typeof armAttemptLockPath !== "string" ||
			typeof armAttemptLockSha256 !== "string"
		) {
			apparatusFailures.push("prompt-dispatch attempt anchor fields are incomplete");
		} else {
			const expectedGlobalAttemptLockPath = `${result.pairPreregistrationPath}.attempt.lock`;
			const expectedArmAttemptLockPath = join(resolve(input.outputDir), "attempt.lock");
			if (resolve(globalAttemptLockPath) !== resolve(expectedGlobalAttemptLockPath)) {
				apparatusFailures.push("global attempt-lock path drifted in prompt-dispatch evidence");
			}
			if (resolve(armAttemptLockPath) !== expectedArmAttemptLockPath) {
				apparatusFailures.push("arm attempt-lock path drifted in prompt-dispatch evidence");
			}
			for (const [path, expectedSha256, label] of [
				[globalAttemptLockPath, globalAttemptLockSha256, "global attempt lock"],
				[armAttemptLockPath, armAttemptLockSha256, "arm attempt lock"],
			] as const) {
				try {
					await assertPrivateRegularFile(path, label);
					const contents = await readFile(path, "utf8");
					if (sha256Text(contents) !== expectedSha256) apparatusFailures.push(`${label} hash drifted`);
					const lock: unknown = JSON.parse(contents);
					if (!isRecord(lock) || lock.protocol !== COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL) {
						apparatusFailures.push(`${label} protocol drifted`);
					}
					if (
						label === "global attempt lock" &&
						(!isRecord(lock) ||
							canonicalJson(toJsonValue(lock.resolvedModelPolicy ?? null)) !==
								canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY)))
					) {
						apparatusFailures.push("global attempt-lock resolved-model policy drifted");
					}
					if (label === "arm attempt lock") {
						if (
							!isRecord(lock) ||
							lock.pairId !== COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID ||
							lock.arm !== arm ||
							lock.globalAttemptLockSha256 !== globalAttemptLockSha256 ||
							lock.promptSha256 !== sha256Text(buildCompilerGymIrDeltaScreenPrompt())
						) {
							apparatusFailures.push("arm attempt-lock claims drifted");
						}
					}
				} catch (error) {
					apparatusFailures.push(`${label} verification failed: ${errorText(error)}`);
				}
			}
		}
	}
	try {
		verifyLedgerContentsStrict(ledgerContents);
	} catch (error) {
		apparatusFailures.push(`arm ledger integrity failed: ${errorText(error)}`);
	}
	try {
		const terminalLedgerLine = ledgerContents.trimEnd().split("\n").at(-1);
		const terminalLedgerEvent: unknown = JSON.parse(terminalLedgerLine ?? "");
		if (
			!isRecord(terminalLedgerEvent) ||
			typeof terminalLedgerEvent.hash !== "string" ||
			terminalLedgerEvent.hash !== result.terminalLedgerEventHash
		) {
			apparatusFailures.push("embedded terminal ledger event hash drifted");
		}
	} catch (error) {
		apparatusFailures.push(`terminal ledger event evidence failed: ${errorText(error)}`);
	}
	const assistants = (() => {
		try {
			return parseAssistantSessionRecords(sessionContents);
		} catch (error) {
			apparatusFailures.push(`session evidence failed: ${errorText(error)}`);
			return [];
		}
	})();
	policyFailures.push(...policyShapeFailures(assistants));
	const policyDetected = policyFailures.length > 0;
	const ignoredPolicyAbortIndex = policyAbortSentinelIndex({ assistants, result, policyDetected });
	apparatusFailures.push(...providerFailures(assistants, result.failure, ignoredPolicyAbortIndex));
	const resolvedModelSnapshots = input.providerVisibility.resolvedModelSnapshots ?? [];
	const resolvedModelSnapshotSha256s = input.providerVisibility.resolvedModelSnapshotSha256s ?? [];
	const resolvedModelPolicy = input.providerVisibility.resolvedModelPolicy;
	const runtimeWorktreeSnapshotSha256s = input.providerVisibility.runtimeWorktreeSnapshotSha256s;
	const runtimeWorktreeSnapshotMatchesPreregistration =
		input.providerVisibility.runtimeWorktreeSnapshotMatchesPreregistration;
	const runtimeWorktreeDispatchAnchors = input.providerVisibility.runtimeWorktreeDispatchAnchors;

	const integrityChecks: Array<[boolean, string]> = [
		[result.outputDir === resolve(input.outputDir), "trajectory output directory drifted"],
		[result.evaluationDir === resolve(input.outputDir, "evaluation"), "trajectory evaluation directory drifted"],
		[result.claimClass === "directional-single-pair-arm", "trajectory claim class drifted"],
		[result.causalClaimAllowed === false, "trajectory enabled a causal claim"],
		[result.protocolVersion === STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION, "stock feedback protocol drifted"],
		[result.terminalization === "host-owned", "terminalization mode drifted"],
		[result.feedbackView === "full", "stock feedback view drifted"],
		[result.pairPreregistrationId === COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID, "pair identifier drifted"],
		[result.pairArmId === arm, "pair arm binding drifted"],
		[
			result.expectedMeasurementEvaluatorSha256 === COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			"expected evaluator drifted",
		],
		[result.stopProviderAfterForbiddenToolExecution === true, "forbidden-tool provider stop is disabled"],
		[result.providerSessionId === input.providerVisibility.providerSessionId, "provider session ID drifted"],
		[
			result.sessionId === input.providerVisibility.providerSessionId,
			"durable session ID differs from provider affinity ID",
		],
		[
			result.providerVisibleSystemPromptPolicy === COMPILER_GYM_IR_DELTA_SCREEN_SYSTEM_PROMPT_POLICY,
			"provider-visible system-prompt policy drifted",
		],
		[input.providerVisibility.arm === arm, "provider visibility arm binding drifted"],
		[input.providerVisibility.systemPromptEvents === 1, "provider system prompt event count drifted"],
		[
			input.providerVisibility.workingDirectoryReplacements === 1,
			"provider working-directory path was not normalized exactly once",
		],
		[
			input.providerVisibility.conversationLogReplacements === 1,
			"provider conversation-log path was not normalized exactly once",
		],
		[
			input.providerVisibility.normalizedSystemPromptSha256 !== null &&
				/^[a-f0-9]{64}$/.test(input.providerVisibility.normalizedSystemPromptSha256),
			"normalized provider system-prompt hash is absent",
		],
		[
			input.providerVisibility.normalizedSystemPromptMatchedPairAnchor === true,
			"normalized provider system prompt did not match the pair anchor",
		],
		[
			input.providerVisibility.firstProviderRequestBodyMatchedPairAnchor === true,
			"first provider request body did not match the pair anchor",
		],
		[
			input.providerVisibility.providerRequestAnchorSha256 !== null &&
				/^[a-f0-9]{64}$/.test(input.providerVisibility.providerRequestAnchorSha256),
			"durable provider request anchor hash is absent",
		],
		[
			canonicalJson(toJsonValue(resolvedModelPolicy ?? null)) ===
				canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY)),
			"provider resolved-model policy drifted",
		],
		[
			input.providerVisibility.firstResolvedModelMatchedPairAnchor === true,
			"resolved model snapshot did not match the durable pair anchor",
		],
		[
			resolvedModelSnapshots.length === result.providerTracker.providerCalls &&
				(policyDetected || resolvedModelSnapshots.length === 4),
			"resolved model evidence differs from accepted provider dispatch count",
		],
		[
			resolvedModelSnapshotSha256s.length === resolvedModelSnapshots.length &&
				resolvedModelSnapshots.every(
					(snapshot, index) => resolvedModelSnapshotSha256s[index] === sha256Json(snapshot),
				),
			"resolved model snapshot hash evidence drifted",
		],
		[
			resolvedModelSnapshots.every(
				(snapshot) => validateCompilerGymIrDeltaScreenResolvedModelSnapshot(snapshot).length === 0,
			),
			"one or more resolved model snapshots failed the frozen gate",
		],
		[
			input.providerVisibility.expectedRuntimeWorktreeSnapshotSha256 === sha256Json(result.repositoryBefore),
			"generic trajectory runtime snapshot differs from the paid preregistration",
		],
		[
			runtimeWorktreeSnapshotSha256s.length === result.providerTracker.providerCalls &&
				(policyDetected || runtimeWorktreeSnapshotSha256s.length === 4),
			"runtime worktree evidence differs from accepted provider dispatch count",
		],
		[
			runtimeWorktreeSnapshotMatchesPreregistration.length === runtimeWorktreeSnapshotSha256s.length &&
				runtimeWorktreeSnapshotMatchesPreregistration.every((matched) => matched),
			"one or more pre-dispatch runtime worktree snapshots differed from preregistration",
		],
		[
			runtimeWorktreeSnapshotSha256s.every(
				(snapshotSha256) => snapshotSha256 === input.providerVisibility.expectedRuntimeWorktreeSnapshotSha256,
			),
			"runtime worktree snapshot hash evidence drifted",
		],
		[
			runtimeWorktreeDispatchAnchors.length === runtimeWorktreeSnapshotSha256s.length,
			"durable runtime worktree dispatch-anchor count drifted",
		],
		[
			input.providerVisibility.failures.length === 0,
			`provider visibility gate failed: ${input.providerVisibility.failures.join("; ")}`,
		],
		[result.sourceIntegrityPassed, "source integrity failed"],
		[result.repositoryIntegrityPassed, "repository integrity failed"],
		[result.artifactIntegrity.passed, `artifact integrity failed: ${result.artifactIntegrity.error ?? "unknown"}`],
		[result.evaluatorIntegrityPassed, "evaluator integrity failed"],
		[result.measurementProvenanceIntegrityPassed, "measurement provenance integrity failed"],
		[result.pairPreregistrationIntegrityPassed, "pair preregistration integrity failed"],
		[result.providerMaxRetries === 0, "provider retries were enabled"],
		[result.transport === "sse", "provider transport drifted"],
		[result.model === "openai-codex/gpt-5.6-luna", "model drifted"],
		[result.thinkingLevel === "xhigh", "thinking level drifted"],
		[result.requestedAndLocallyEffectiveServiceTier === "priority", "service tier drifted"],
		[result.trace.duplicateCount === 0, "duplicate evaluator dispatch observed"],
		[result.budget.reusedTaskEvaluations === 0, "measurement reuse observed"],
		[result.budget.unevaluatedTaskEvaluations === 0, "unevaluated task budget observed"],
		[
			(result.eventCounts.compaction_start ?? 0) === 0 && (result.eventCounts.compaction_end ?? 0) === 0,
			"compaction observed",
		],
		[result.sessionSha256 === sha256Text(sessionContents), "embedded session hash drifted"],
		[result.ledgerSha256 === sha256Text(ledgerContents), "embedded ledger hash drifted"],
		[sha256Json(result.sourceHashesBefore) === sha256Json(result.sourceHashesAfter), "source hash records drifted"],
	];
	for (const [passed, message] of integrityChecks) if (!passed) apparatusFailures.push(message);
	if (input.providerVisibility.providerRequestBodySha256s.length !== result.providerTracker.providerCalls) {
		apparatusFailures.push("provider request body evidence differs from accepted provider dispatch count");
	}
	if (input.providerVisibility.providerRequestBodySha256s.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
		apparatusFailures.push("provider request body evidence contains an invalid hash");
	}
	try {
		await assertPrivateRegularFile(
			input.providerVisibility.providerRequestAnchorPath,
			"Provider request parity anchor",
		);
		const providerRequestAnchor = await readFile(input.providerVisibility.providerRequestAnchorPath, "utf8");
		if (sha256Text(providerRequestAnchor) !== input.providerVisibility.providerRequestAnchorSha256) {
			apparatusFailures.push("provider request parity anchor hash drifted during arm audit");
		}
		const anchor: unknown = JSON.parse(providerRequestAnchor);
		if (
			!isRecord(anchor) ||
			canonicalJson(toJsonValue(anchor.resolvedModelPolicy ?? null)) !==
				canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY)) ||
			anchor.resolvedModelSnapshotSha256 !== resolvedModelSnapshotSha256s[0] ||
			canonicalJson(toJsonValue(anchor.resolvedModelSnapshot ?? null)) !==
				canonicalJson(toJsonValue(resolvedModelSnapshots[0] ?? null))
		) {
			apparatusFailures.push("provider request parity anchor resolved-model evidence drifted");
		}
		if (
			!isRecord(anchor) ||
			anchor.expectedRuntimeWorktreeSnapshotSha256 !==
				input.providerVisibility.expectedRuntimeWorktreeSnapshotSha256 ||
			anchor.firstRuntimeWorktreeSnapshotSha256 !== runtimeWorktreeSnapshotSha256s[0]
		) {
			apparatusFailures.push("provider request parity anchor runtime-worktree evidence drifted");
		}
		if (
			isRecord(anchor) &&
			anchor.anchorArm === arm &&
			(anchor.firstRuntimeWorktreeDispatchAnchorPath !== runtimeWorktreeDispatchAnchors[0]?.path ||
				anchor.firstRuntimeWorktreeDispatchAnchorSha256 !== runtimeWorktreeDispatchAnchors[0]?.sha256)
		) {
			apparatusFailures.push("provider request parity anchor first runtime-worktree dispatch binding drifted");
		}
	} catch (error) {
		apparatusFailures.push(`provider request parity anchor audit failed: ${errorText(error)}`);
	}
	for (const [index, dispatchAnchor] of runtimeWorktreeDispatchAnchors.entries()) {
		try {
			await assertPrivateRegularFile(dispatchAnchor.path, `Runtime worktree dispatch anchor ${index + 1}`);
			const contents = await readFile(dispatchAnchor.path, "utf8");
			if (sha256Text(contents) !== dispatchAnchor.sha256) {
				apparatusFailures.push(`runtime worktree dispatch anchor ${index + 1} hash drifted`);
				continue;
			}
			const anchor: unknown = JSON.parse(contents);
			if (
				!isRecord(anchor) ||
				anchor.providerDispatchOrdinal !== index + 1 ||
				anchor.expectedRuntimeWorktreeSnapshotSha256 !==
					input.providerVisibility.expectedRuntimeWorktreeSnapshotSha256 ||
				anchor.runtimeWorktreeSnapshotSha256 !== dispatchAnchor.snapshotSha256 ||
				anchor.runtimeWorktreeSnapshotSha256 !== runtimeWorktreeSnapshotSha256s[index] ||
				anchor.matchedPreregistration !== true ||
				dispatchAnchor.matchedPreregistration !== true ||
				sha256Json(anchor.runtimeWorktreeSnapshot) !== dispatchAnchor.snapshotSha256
			) {
				apparatusFailures.push(`runtime worktree dispatch anchor ${index + 1} evidence drifted`);
			}
		} catch (error) {
			apparatusFailures.push(`runtime worktree dispatch anchor ${index + 1} audit failed: ${errorText(error)}`);
		}
	}

	const requests = result.trace.requests;
	try {
		assertCompilerGymIrDeltaScreenRequestSequence(requests);
	} catch (error) {
		policyFailures.push(errorText(error));
	}
	for (const [index, assistant] of assistants.entries()) {
		if (assistant.toolCalls.length !== 1 || assistant.toolCalls[0]?.name !== STOCK_INTERFACE_PARITY_TOOL_NAME)
			continue;
		const request = requests[index];
		if (!request) continue;
		try {
			if (canonicalJson(toJsonValue(assistant.toolCalls[0].arguments)) !== canonicalJson(toJsonValue(request))) {
				apparatusFailures.push(`assistant response ${index + 1} tool arguments differ from its evaluator request`);
			}
		} catch (error) {
			apparatusFailures.push(
				`assistant response ${index + 1} tool arguments could not be bound: ${errorText(error)}`,
			);
		}
	}
	const derivedOperationalFailures = Object.entries(result.operationalGate.checks)
		.filter(([, passed]) => !passed)
		.map(([name]) => name);
	if (!exactStringArray(derivedOperationalFailures, result.operationalGate.failures)) {
		apparatusFailures.push("stock operational failure list contradicts its check map");
	}
	if (result.operationalGate.passed !== (result.operationalGate.failures.length === 0)) {
		apparatusFailures.push("stock operational pass flag contradicts its failures");
	}

	const evidenceCounts = {
		traceCalls: result.trace.callCount,
		requests: requests.length,
		jobIds: result.trace.jobIds.length,
		feedback: result.trace.modelFeedbackBytes.length,
		jobs: result.jobs.length,
		submissions: result.budget.submissions,
		taskEvaluations: result.budget.taskEvaluations,
		actualTaskEvaluations: result.budget.actualTaskEvaluations,
	};
	if (
		evidenceCounts.traceCalls !== evidenceCounts.requests ||
		evidenceCounts.traceCalls !== evidenceCounts.jobIds ||
		evidenceCounts.traceCalls !== evidenceCounts.feedback ||
		evidenceCounts.traceCalls !== evidenceCounts.jobs ||
		evidenceCounts.traceCalls !== evidenceCounts.submissions
	) {
		apparatusFailures.push("evaluator request, job, feedback, and submission accounting is inconsistent");
	}
	if (
		evidenceCounts.taskEvaluations !== evidenceCounts.traceCalls * STOCK_CPU_TASKS.length ||
		evidenceCounts.actualTaskEvaluations !== evidenceCounts.traceCalls * STOCK_CPU_TASKS.length
	) {
		apparatusFailures.push("task accounting is inconsistent with durable evaluator jobs");
	}
	if (evidenceCounts.traceCalls > 4 || evidenceCounts.actualTaskEvaluations > 8) {
		apparatusFailures.push("per-arm evaluator or task dispatch cap was exceeded");
	}
	if (new Set(result.trace.jobIds).size !== result.trace.jobIds.length) {
		apparatusFailures.push("durable evaluator job identifiers are not unique");
	}
	const jobsById = new Map(result.jobs.map((job) => [job.proposal.jobId, job]));
	const artifactStore = new ArtifactStore(join(input.outputDir, "evaluation", "artifacts"));
	for (let index = 0; index < result.trace.jobIds.length; index++) {
		const callIndex = (index + 1) as 1 | 2 | 3 | 4;
		const jobId = result.trace.jobIds[index];
		const request = requests[index];
		const job = jobId ? jobsById.get(jobId) : undefined;
		if (!jobId || !request || !job) {
			apparatusFailures.push(`call ${callIndex} is missing its request or durable job`);
			continue;
		}
		const expectedParents = index === 0 ? [] : [result.trace.jobIds[index - 1] as string];
		if (!exactStringArray(job.proposal.proposal.parentJobIds, expectedParents)) {
			apparatusFailures.push(`call ${callIndex} lineage drifted`);
		}
		if (!job.measurement?.stdout) {
			apparatusFailures.push(`call ${callIndex} lacks aggregate stdout`);
			continue;
		}
		if (!exactRecord(job.measurement.provenance, COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE)) {
			apparatusFailures.push(`call ${callIndex} rich provenance drifted`);
		}
		try {
			const aggregateStdout = await artifactStore.readString(job.measurement.stdout);
			const parsed = parseCompilerGymIrDeltaAggregateStdout(
				aggregateStdout,
				stockEnvelope(request, job, result.budget),
				callIndex,
			);
			const candidate = classifyCandidate(callIndex, parsed);
			if (callIndex === 1 && candidate.outcome !== "verified") {
				apparatusFailures.push("the frozen S12 apparatus anchor was semantically rejected");
			}
			const expectedState = candidate.outcome === "verified" ? "succeeded" : "invalid";
			if (job.state.status !== expectedState) {
				apparatusFailures.push(`call ${callIndex} state ${job.state.status} contradicts ${candidate.outcome}`);
			}
			candidates.push(candidate);
		} catch (error) {
			apparatusFailures.push(`call ${callIndex} aggregate verification failed: ${errorText(error)}`);
		}
	}

	const host = result.hostTerminalizationTracker;
	if (!host) {
		apparatusFailures.push("host-owned terminalization tracker is absent");
	} else {
		for (const [passed, message] of [
			[
				host.providerDispatches === result.providerTracker.providerCalls,
				"host and provider dispatch accounting differ",
			],
			[host.evaluatorToolCalls === result.trace.callCount, "host and evaluator tool accounting differ"],
			[host.providerDispatches <= 4, "per-arm provider dispatch cap was exceeded"],
			[host.evaluatorToolCalls <= 4, "per-arm evaluator tool cap was exceeded"],
			[host.postTerminalProviderDispatches === 0, "provider dispatch occurred after terminal measurement"],
			[host.postTerminalEvaluatorToolCalls === 0, "evaluator dispatch occurred after terminal measurement"],
		] as const) {
			if (!passed) apparatusFailures.push(message);
		}
		if (!policyDetected && host.terminalizationStops !== 1) {
			apparatusFailures.push(`expected one host stop, observed ${host.terminalizationStops}`);
		}
		if (policyDetected && host.terminalizationStops > 1) {
			apparatusFailures.push(`policy stop recorded ${host.terminalizationStops} host terminalizations`);
		}
		if (host.forbiddenBoundaryEvents.length > 0 && !policyDetected) {
			apparatusFailures.push(`forbidden host boundary events: ${host.forbiddenBoundaryEvents.join("; ")}`);
		}
	}
	const providerBoundAssistantCount = assistants.length - (ignoredPolicyAbortIndex === null ? 0 : 1);
	if (result.providerTracker.providerCalls !== providerBoundAssistantCount) {
		apparatusFailures.push("provider dispatch count differs from durable assistant response count");
	}
	if (result.providerTracker.providerCalls > 4) apparatusFailures.push("per-arm provider dispatch cap was exceeded");
	if (result.providerTracker.blockedProviderCalls !== result.providerTracker.blockedReasons.length) {
		apparatusFailures.push("blocked provider request accounting is inconsistent");
	}
	if ((result.providerTracker.apparatusGateFailures?.length ?? 0) > 0) {
		apparatusFailures.push(
			`provider apparatus gate failures: ${result.providerTracker.apparatusGateFailures?.join("; ") ?? "unknown"}`,
		);
	}
	if (policyDetected) {
		if (
			result.providerTracker.blockedReasons.some((reason) => reason !== "forbidden-tool-execution") ||
			result.providerTracker.blockedProviderCalls > 1
		) {
			apparatusFailures.push("policy stop had an unexpected provider-budget block");
		}
	} else if (result.providerTracker.blockedProviderCalls !== 0) {
		apparatusFailures.push("admitted arm blocked a provider request outside host terminalization");
	}

	const hasSemanticRejection = candidates.some((candidate) => candidate.outcome === "complete-semantic-rejection");
	let allowedStockRejectionFailures: string[] = [];
	const hostAssessment = result.hostTerminalizationAssessment;
	if (!hostAssessment) {
		apparatusFailures.push("host-owned terminalization assessment is absent");
	} else if (policyDetected) {
		const unallowedOperationalFailures = result.operationalGate.failures.filter(
			(failure) => !POLICY_ALLOWED_OPERATIONAL_FAILURES.has(failure),
		);
		if (unallowedOperationalFailures.length > 0) {
			apparatusFailures.push(`policy stop had unallowed stock failures: ${unallowedOperationalFailures.join(", ")}`);
		}
		if (hostAssessment.hardFailures.some((failure) => !isExpectedPolicyHardFailure(failure))) {
			apparatusFailures.push(`policy stop had unallowed host failures: ${hostAssessment.hardFailures.join("; ")}`);
		}
		if (result.ok || result.operationalGate.passed) {
			apparatusFailures.push("policy-nonconformant arm unexpectedly passed the stock runtime gate");
		}
		const expectedFailure = operationalGateFailureMessage(result.operationalGate.failures);
		if (result.failure !== expectedFailure && !policyFailures.includes(result.failure ?? "")) {
			apparatusFailures.push(`policy stop had an unrecognized trajectory failure: ${result.failure ?? "null"}`);
		}
	} else if (hasSemanticRejection) {
		allowedStockRejectionFailures = [...EXPECTED_SEMANTIC_REJECTION_OPERATIONAL_FAILURES];
		if (!exactStringSet(result.operationalGate.failures, EXPECTED_SEMANTIC_REJECTION_OPERATIONAL_FAILURES)) {
			apparatusFailures.push(
				`semantic rejection stock failures were not exact: ${result.operationalGate.failures.join(", ")}`,
			);
		}
		if (result.ok || result.operationalGate.passed) {
			apparatusFailures.push("semantic rejection unexpectedly passed the stock runtime gate");
		}
		if (result.failure !== operationalGateFailureMessage(result.operationalGate.failures)) {
			apparatusFailures.push(
				`semantic rejection had an unrecognized trajectory failure: ${result.failure ?? "null"}`,
			);
		}
		if (!exactStringArray(hostAssessment.hardFailures, ["stock CPU completion gate failed"])) {
			apparatusFailures.push(
				`semantic rejection host failures were not exact: ${hostAssessment.hardFailures.join("; ")}`,
			);
		}
		if (hostAssessment.measurementQualified || hostAssessment.terminalizationRuntimeConformant) {
			apparatusFailures.push("semantic rejection host assessment unexpectedly qualified the stock completion gate");
		}
	} else {
		if (
			!result.ok ||
			!result.operationalGate.passed ||
			result.failure !== null ||
			result.operationalGate.failures.length > 0
		) {
			apparatusFailures.push(`fully verified arm failed its stock runtime gate: ${result.failure ?? "unknown"}`);
		}
		if (
			hostAssessment.hardFailures.length > 0 ||
			!hostAssessment.measurementQualified ||
			!hostAssessment.terminalizationRuntimeConformant
		) {
			apparatusFailures.push("fully verified arm failed its host-owned terminalization assessment");
		}
	}

	if (!policyDetected) {
		const exactBudget =
			result.providerTracker.providerCalls === 4 &&
			assistants.length === 4 &&
			result.trace.callCount === 4 &&
			result.jobs.length === 4 &&
			result.budget.actualTaskEvaluations === 8;
		if (!exactBudget)
			apparatusFailures.push("provider/evaluator/task accounting differs from the exact admitted arm budget");
		if (candidates.length !== 4)
			apparatusFailures.push(`candidate evidence count is ${candidates.length}, expected 4`);
	}
	const disposition: CompilerGymIrDeltaScreenArmDisposition =
		apparatusFailures.length > 0
			? "terminal-apparatus-invalid-not-treatment-result"
			: policyFailures.length > 0
				? "terminal-scientific-policy-nonconformance"
				: "admitted-directional-arm";
	return {
		arm,
		disposition,
		admitted: disposition === "admitted-directional-arm",
		apparatusFailures: unique(apparatusFailures),
		policyFailures: unique(policyFailures),
		allowedStockRejectionFailures,
		providerVisibility: structuredClone(input.providerVisibility),
		accountingComplete: true,
		providerDispatches: result.providerTracker.providerCalls,
		evaluatorJobs: result.trace.callCount,
		freshTaskEvaluations: result.budget.actualTaskEvaluations,
		candidates,
		trajectoryResultPath: resultPath,
		trajectoryResultSha256: sha256Text(resultContents),
		sessionSha256: sha256Text(sessionContents),
		ledgerSha256: sha256Text(ledgerContents),
		terminalLedgerEventHash: result.terminalLedgerEventHash,
	};
}

function pairDisposition(
	audits: readonly CompilerGymIrDeltaScreenArmAudit[],
	pairApparatusFailures: readonly string[],
): CompilerGymIrDeltaScreenRunResult["disposition"] {
	if (pairApparatusFailures.length > 0) return "terminal-apparatus-invalid-not-treatment-result";
	if (audits.some((audit) => audit.disposition === "terminal-apparatus-invalid-not-treatment-result")) {
		return "terminal-apparatus-invalid-not-treatment-result";
	}
	if (audits.some((audit) => audit.disposition === "terminal-scientific-policy-nonconformance")) {
		return "terminal-scientific-policy-nonconformance";
	}
	return audits.length === 2
		? "terminal-complete-directional-single-pair"
		: "terminal-apparatus-invalid-not-treatment-result";
}

export async function runCompilerGymIrDeltaScreenPair(input: {
	preregistrationPath: string;
	outputDir: string;
	repoRoot?: string;
}): Promise<CompilerGymIrDeltaScreenRunResult> {
	const startedAt = new Date().toISOString();
	const preflight = await prepareCompilerGymIrDeltaScreenRun({
		preregistrationPath: input.preregistrationPath,
		repoRoot: input.repoRoot,
	});
	const outputDir = resolve(input.outputDir);
	const outputParent = dirname(outputDir);
	const parentMetadata = await stat(outputParent);
	if (!parentMetadata.isDirectory()) throw new Error(`Paid-screen output parent is not a directory: ${outputParent}`);
	try {
		await mkdir(outputDir, { mode: 0o700 });
	} catch (error) {
		if (isRecord(error) && error.code === "EEXIST")
			throw new Error(`Paid-screen output already exists: ${outputDir}`);
		throw error;
	}
	await chmod(outputDir, 0o700);
	const pairLedgerPath = join(outputDir, "evidence.jsonl");
	const pairLedger = await EvidenceLedger.open(pairLedgerPath);
	await pairLedger.append("run_manifest", {
		type: "compiler_gym_ir_delta_paid_screen_pair",
		phase: "preflight",
		protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
		preregistrationPath: preflight.preregistrationPath,
		preregistrationSha256: preflight.preregistrationSha256,
		implementationBundleSha256: preflight.implementationBundleSha256,
		prerequisiteIntegrity: preflight.prerequisiteIntegrity,
		runtimeWorktreeSnapshotSha256: preflight.runtimeWorktreeSnapshotSha256,
		resolvedModelPolicy: preflight.preregistration.frozenCommon.resolvedModelPolicy,
		randomizedArmOrder: preflight.preregistration.randomization.armOrder,
		startedAt,
	});

	const pairAnchorLoader = createCompilerGymIrDeltaScreenPairAnchorLoader(preflight);
	const providerVisibilityPairState = createCompilerGymIrDeltaScreenProviderVisibilityPairState({
		providerRequestAnchorPath: preflight.providerRequestAnchorPath,
		preregistrationSha256: preflight.preregistrationSha256,
		expectedRuntimeWorktreeSnapshot: preflight.runtimeWorktreeSnapshot,
		runtimeWorktreeSnapshotProvider: () => capturePrimeRuntimeWorktreeSnapshot(preflight.repoRoot),
	});
	let globalAttemptLockSha256: string | null = null;
	const audits: CompilerGymIrDeltaScreenArmAudit[] = [];
	for (const [orderIndex, arm] of preflight.preregistration.randomization.armOrder.entries()) {
		const armOrdinal = orderIndex + 1;
		const armOutputDir = join(outputDir, "arms", `${String(armOrdinal).padStart(2, "0")}-${arm}`);
		const armAttemptLockPath = join(armOutputDir, "attempt.lock");
		const policyErrors: string[] = [];
		const actionDigests = new Set<string>();
		const artifactStore = new ArtifactStore(join(armOutputDir, "evaluation", "artifacts"));
		const providerVisibility = createCompilerGymIrDeltaScreenProviderVisibilityRuntime({
			arm,
			providerSessionId: preflight.preregistration.frozenCommon.providerSessionId,
			pairState: providerVisibilityPairState,
			resolvedModelPolicy: preflight.preregistration.frozenCommon.resolvedModelPolicy,
		});
		let trajectoryResult: StockTrajectoryResult;
		try {
			trajectoryResult = await runStockInterfaceParityTrajectory(
				{
					outputDir: armOutputDir,
					calibrationResultPath: preflight.calibrationResultPath,
					feedbackView: "full",
					pairPreregistrationPath: preflight.preregistrationPath,
					terminalization: "host-owned",
				},
				{
					adapter: new FarmShareCompilerGymIrDeltaScreenAdapter(),
					evaluatorScriptPath: preflight.evaluatorScriptPath,
					expectedMeasurementEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
					expectedMeasurementProvenance: COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE,
					evaluationSchema: CompilerGymIrDeltaScreenEvaluationSchema,
					promptBuilder: buildCompilerGymIrDeltaScreenPrompt,
					pairAnchorLoader,
					pairArmId: arm,
					additionalSourcePaths: preflight.additionalSourcePaths,
					stopProviderAfterForbiddenToolExecution: true,
					providerSessionId: preflight.preregistration.frozenCommon.providerSessionId,
					providerVisibleSystemPromptPolicy: COMPILER_GYM_IR_DELTA_SCREEN_SYSTEM_PROMPT_POLICY,
					additionalExtensionFactories: [providerVisibility.extensionFactory],
					providerRequestGate: providerVisibility.providerRequestGate,
					armMetadata: {
						id: arm,
						feedbackTopology:
							arm === "hidden-control"
								? "complete authoritative terminal envelope with host-only IR trace artifact"
								: "byte-identical control envelope plus one top-level irDeltaTrace field",
					},
					beforeSubmit: async ({ submissionOrdinal, request, existingJobs }) => {
						try {
							if (existingJobs.length + 1 !== submissionOrdinal) {
								throw new Error("scientific-policy-nonconformance: tool-call ordinal drifted");
							}
							assertCompilerGymIrDeltaScreenRequestPolicy(submissionOrdinal, request);
							const actionsSha256 = sha256Json(request.actions);
							if (actionDigests.has(actionsSha256)) {
								throw new Error(
									"scientific-policy-nonconformance: repeated candidate action vector within arm",
								);
							}
							actionDigests.add(actionsSha256);
						} catch (error) {
							policyErrors.push(errorText(error));
							throw error;
						}
					},
					feedbackProjector: (details, context) =>
						projectCompilerGymIrDeltaScreenFeedback({
							details,
							arm,
							callIndex: context.submissionOrdinal,
							readArtifact: (reference) => artifactStore.readString(reference),
						}),
					beforePromptDispatch: async (context) => {
						const liveClosure = await collectCompilerGymIrDeltaScreenImplementationClosure(preflight.repoRoot);
						const liveRuntimeWorktreeSnapshot = capturePrimeRuntimeWorktreeSnapshot(preflight.repoRoot);
						const livePreregistrationContents = await readFile(preflight.preregistrationPath, "utf8");
						parseCompilerGymIrDeltaScreenPreregistration(
							JSON.parse(livePreregistrationContents) as unknown,
							liveClosure,
							liveRuntimeWorktreeSnapshot,
						);
						if (sha256Text(livePreregistrationContents) !== preflight.preregistrationSha256) {
							throw new Error("Paid-screen preregistration drifted immediately before dispatch");
						}
						await verifyCompilerGymIrDeltaScreenPrerequisites(preflight.repoRoot);
						const liveBundle = await computeStockInterfaceParityImplementationBundle({
							evaluatorScriptPath: preflight.evaluatorScriptPath,
							additionalSourcePaths: preflight.additionalSourcePaths,
						});
						if (liveBundle.sha256 !== preflight.implementationBundleSha256) {
							throw new Error("Paid-screen implementation bundle drifted immediately before dispatch");
						}
						if (globalAttemptLockSha256 === null) {
							globalAttemptLockSha256 = await writeExclusivePrivateJson(preflight.globalAttemptLockPath, {
								protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
								pairId: preflight.preregistration.pairId,
								preregistrationSha256: preflight.preregistrationSha256,
								implementationBundleSha256: preflight.implementationBundleSha256,
								implementationClosureSha256: preflight.preregistration.implementationBundleSha256,
								runtimeWorktreeSnapshotSha256: preflight.runtimeWorktreeSnapshotSha256,
								randomizedArmOrder: preflight.preregistration.randomization.armOrder,
								firstArm: arm,
								outputDir,
								providerSessionId: preflight.preregistration.frozenCommon.providerSessionId,
								resolvedModelPolicy: preflight.preregistration.frozenCommon.resolvedModelPolicy,
								providerRequestAnchorPath: preflight.providerRequestAnchorPath,
								authorizedMaximumActualProviderDispatches: 8,
								createdAt: new Date().toISOString(),
							});
							await pairLedger.append("run_manifest", {
								type: "compiler_gym_ir_delta_paid_screen_attempt_lock",
								globalAttemptLockPath: preflight.globalAttemptLockPath,
								globalAttemptLockSha256,
								arm,
								armOrdinal,
							});
						} else {
							const lockContents = await readFile(preflight.globalAttemptLockPath, "utf8");
							if (sha256Text(lockContents) !== globalAttemptLockSha256) {
								throw new Error("Global paid-screen attempt lock drifted between arms");
							}
						}
						const armAttemptLockSha256 = await writeExclusivePrivateJson(armAttemptLockPath, {
							protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
							pairId: preflight.preregistration.pairId,
							arm,
							armOrdinal,
							globalAttemptLockSha256,
							armPreregistrationSha256: context.preregistrationSha256,
							promptSha256: context.promptSha256,
							createdAt: new Date().toISOString(),
						});
						await pairLedger.append("run_manifest", {
							type: "compiler_gym_ir_delta_paid_screen_arm_attempt",
							arm,
							armOrdinal,
							armAttemptLockPath,
							armAttemptLockSha256,
							armPreregistrationSha256: context.preregistrationSha256,
						});
						return {
							globalAttemptLockPath: preflight.globalAttemptLockPath,
							globalAttemptLockSha256,
							armAttemptLockPath,
							armAttemptLockSha256,
						};
					},
				},
			);
		} catch (error) {
			const message = errorText(error);
			const audit: CompilerGymIrDeltaScreenArmAudit = {
				arm,
				disposition: "terminal-apparatus-invalid-not-treatment-result",
				admitted: false,
				apparatusFailures: [
					`trajectory threw before a complete auditable result; paid-dispatch accounting is unknown: ${message}`,
				],
				policyFailures: unique(policyErrors),
				allowedStockRejectionFailures: [],
				providerVisibility: structuredClone(providerVisibility.evidence),
				accountingComplete: false,
				providerDispatches: null,
				evaluatorJobs: null,
				freshTaskEvaluations: null,
				candidates: [],
				trajectoryResultPath: join(armOutputDir, "result.json"),
				trajectoryResultSha256: "",
				sessionSha256: "",
				ledgerSha256: "",
				terminalLedgerEventHash: null,
			};
			audits.push(audit);
			await pairLedger.append("run_manifest", {
				type: "compiler_gym_ir_delta_paid_screen_arm",
				phase: "terminal",
				arm,
				armOrdinal,
				audit,
			});
			break;
		}
		let audit: CompilerGymIrDeltaScreenArmAudit;
		try {
			audit = await auditCompilerGymIrDeltaScreenArm({
				arm,
				outputDir: armOutputDir,
				result: trajectoryResult,
				providerVisibility: providerVisibility.evidence,
				policyErrors,
			});
		} catch (error) {
			audit = {
				arm,
				disposition: "terminal-apparatus-invalid-not-treatment-result",
				admitted: false,
				apparatusFailures: [
					`arm audit threw after trajectory completion; dispatch accounting is untrusted: ${errorText(error)}`,
				],
				policyFailures: unique(policyErrors),
				allowedStockRejectionFailures: [],
				providerVisibility: structuredClone(providerVisibility.evidence),
				accountingComplete: false,
				providerDispatches: null,
				evaluatorJobs: null,
				freshTaskEvaluations: null,
				candidates: [],
				trajectoryResultPath: join(armOutputDir, "result.json"),
				trajectoryResultSha256: "",
				sessionSha256: "",
				ledgerSha256: "",
				terminalLedgerEventHash: null,
			};
		}
		audits.push(audit);
		await pairLedger.append("run_manifest", {
			type: "compiler_gym_ir_delta_paid_screen_arm",
			phase: "terminal",
			arm,
			armOrdinal,
			audit,
		});
		if (!audit.admitted) break;
	}

	const pairApparatusFailures: string[] = [];
	if (globalAttemptLockSha256 !== null) {
		try {
			await assertPrivateRegularFile(preflight.globalAttemptLockPath, "Global paid-screen attempt lock");
			const liveGlobalAttemptLock = await readFile(preflight.globalAttemptLockPath, "utf8");
			if (sha256Text(liveGlobalAttemptLock) !== globalAttemptLockSha256) {
				pairApparatusFailures.push("global paid-screen attempt lock drifted after arm execution");
			}
		} catch (error) {
			pairApparatusFailures.push(`global paid-screen attempt lock verification failed: ${errorText(error)}`);
		}
	}
	if (providerVisibilityPairState.providerRequestAnchorSha256 === null) {
		pairApparatusFailures.push("durable first-provider-request parity anchor was never created");
	} else {
		if (providerVisibilityPairState.firstResolvedModelSnapshotSha256 === null) {
			pairApparatusFailures.push("durable provider request anchor lacks resolved-model evidence");
		}
		try {
			await assertPrivateRegularFile(preflight.providerRequestAnchorPath, "Provider request parity anchor");
			const liveProviderRequestAnchor = await readFile(preflight.providerRequestAnchorPath, "utf8");
			if (sha256Text(liveProviderRequestAnchor) !== providerVisibilityPairState.providerRequestAnchorSha256) {
				pairApparatusFailures.push("provider request parity anchor drifted after arm execution");
			}
		} catch (error) {
			pairApparatusFailures.push(`provider request parity anchor verification failed: ${errorText(error)}`);
		}
	}
	let assessment: CompilerGymIrDeltaScreenPairAssessment | null = null;
	if (audits.length === 2 && audits.every((audit) => audit.admitted)) {
		const control = audits.find((audit) => audit.arm === "hidden-control");
		const treatment = audits.find((audit) => audit.arm === "visible-ir-delta-treatment");
		assert.ok(control && treatment, "Admitted pair is missing a frozen arm");
		const controlResult: CompilerGymIrDeltaScreenArmResult = {
			arm: "hidden-control",
			candidates: control.candidates,
		};
		const treatmentResult: CompilerGymIrDeltaScreenArmResult = {
			arm: "visible-ir-delta-treatment",
			candidates: treatment.candidates,
		};
		assessment = assessCompilerGymIrDeltaScreenPair({ control: controlResult, treatment: treatmentResult });
	}
	const disposition = pairDisposition(audits, pairApparatusFailures);
	const sumCompleteAccounting = (
		selector: (audit: CompilerGymIrDeltaScreenArmAudit) => number | null,
	): number | null => {
		let total = 0;
		for (const audit of audits) {
			const value = selector(audit);
			if (!audit.accountingComplete || value === null) return null;
			total += value;
		}
		return total;
	};
	const actualProviderDispatches = sumCompleteAccounting((audit) => audit.providerDispatches);
	const actualEvaluatorJobs = sumCompleteAccounting((audit) => audit.evaluatorJobs);
	const actualFreshTaskEvaluations = sumCompleteAccounting((audit) => audit.freshTaskEvaluations);
	const finishedAt = new Date().toISOString();
	const terminalEvent = await pairLedger.append("run_manifest", {
		type: "compiler_gym_ir_delta_paid_screen_pair",
		phase: "terminal",
		disposition,
		assessment,
		pairApparatusFailures,
		actualProviderDispatches,
		actualEvaluatorJobs,
		actualFreshTaskEvaluations,
		finishedAt,
	});
	pairLedger.verify();
	const pairLedgerContents = await readFile(pairLedgerPath, "utf8");
	verifyLedgerContentsStrict(pairLedgerContents);
	if (globalAttemptLockSha256 === null) {
		throw new Error("Paid-screen runner terminated without a durable pre-dispatch attempt lock");
	}
	const result: CompilerGymIrDeltaScreenRunResult = {
		protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
		screenProtocol: COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL,
		pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
		disposition,
		preregistrationPath: preflight.preregistrationPath,
		preregistrationSha256: preflight.preregistrationSha256,
		implementationBundleSha256: preflight.implementationBundleSha256,
		runtimeWorktreeSnapshotSha256: preflight.runtimeWorktreeSnapshotSha256,
		globalAttemptLockPath: preflight.globalAttemptLockPath,
		globalAttemptLockSha256,
		providerRequestAnchorPath: preflight.providerRequestAnchorPath,
		providerRequestAnchorSha256: providerVisibilityPairState.providerRequestAnchorSha256,
		randomizedArmOrder: preflight.preregistration.randomization.armOrder,
		arms: audits,
		pairApparatusFailures,
		assessment,
		actualProviderDispatches,
		authorizedMaximumProviderDispatches: 8,
		actualEvaluatorJobs,
		actualFreshTaskEvaluations,
		causalClaimAllowed: false,
		replicationClaimAllowed: false,
		gpuPromotionAllowed: false,
		pairLedgerPath,
		pairLedgerSha256: sha256Text(pairLedgerContents),
		terminalPairLedgerEventHash: terminalEvent.hash,
		startedAt,
		finishedAt,
	};
	await writeExclusivePrivateJson(join(outputDir, "result.json"), result);
	return result;
}

function parseOptions(argv: readonly string[]): { preregistrationPath: string; outputDir: string } {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || !value) {
			throw new Error("Usage: compiler-gym-ir-delta-screen-runner --preregistration <path> --output-dir <new-path>");
		}
		if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
		values.set(flag, value);
	}
	for (const flag of values.keys()) {
		if (flag !== "--preregistration" && flag !== "--output-dir") throw new Error(`Unknown option: ${flag}`);
	}
	const preregistrationPath = values.get("--preregistration");
	const outputDir = values.get("--output-dir");
	if (!preregistrationPath || !outputDir) {
		throw new Error("Both --preregistration and --output-dir are required");
	}
	return { preregistrationPath, outputDir };
}

async function main(): Promise<void> {
	const result = await runCompilerGymIrDeltaScreenPair(parseOptions(process.argv.slice(2)));
	process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`);
	if (result.disposition !== "terminal-complete-directional-single-pair") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	void main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

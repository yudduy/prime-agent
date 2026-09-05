import { open, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	assertCompilerGymActionSpaceVisibilityProviderCallOrdinal,
	assertNoCompilerGymActionSpaceVisibilityLeakage,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_FLAGS_SHA256,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_SENTINEL,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_FLAGS_SHA256,
	type CompilerGymActionSpaceVisibilityArm,
	CompilerGymActionSpaceVisibilityEvaluationSchema,
	type CompilerGymActionSpaceVisibilityPrompts,
	normalizeCompilerGymActionSpaceVisibilityPrompt,
} from "./compiler-gym-action-space-visibility-protocol.js";
import {
	COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
	validateCompilerGymHardenedPaidResolvedModelSnapshot,
} from "./compiler-gym-hardened-paid-provider.js";
import type { RepositorySnapshot, StockInterfaceParityProviderRequestGate } from "./stock-interface-parity.js";

const EXACT_PAYLOAD_KEYS = [
	"include",
	"input",
	"instructions",
	"model",
	"parallel_tool_calls",
	"prompt_cache_key",
	"reasoning",
	"service_tier",
	"store",
	"stream",
	"text",
	"tool_choice",
	"tools",
] as const;
const EXACT_TOOL_KEYS = ["description", "name", "parameters", "strict", "type"] as const;
const STRONG_FORBIDDEN_PROVIDER_PATTERNS: readonly [RegExp, string][] = [
	[/\bdijkstra\b/i, "held-out benchmark"],
	[/\bheadroom\b/i, "prior headroom protocol"],
	[/73dc6ffb921da7a6e85b117f53be75252c3ece290bb0111b9efafaddf2213cd8/i, "prior artifact"],
	[/terminal-apparatus-invalid/i, "prior disposition"],
	[/2026-08-29-v2/i, "prior run ID"],
	[/\b292\b|\b260\b|\b269\b/, "prior outcome value"],
] as const;

export interface CompilerGymActionSpaceVisibilityProviderSpec {
	schemaVersion: 1;
	runnerProtocol: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL;
	pairId: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID;
	arms: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS;
	promptByArm: Record<CompilerGymActionSpaceVisibilityArm, string>;
	guideByArm: Record<CompilerGymActionSpaceVisibilityArm, string>;
	normalizedPrompt: string;
	normalizedPromptSha256: string;
	promptSha256ByArm: Record<CompilerGymActionSpaceVisibilityArm, string>;
	tool: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL;
	providerSessionId: string;
	providerVisibleWorkspace: string;
	providerVisibleConversationLog: string;
	agentRegistry: {
		agentDir: string;
		modelsJsonPath: string;
		modelsJsonPresent: false;
	};
	maxDispatchesPerArm: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM;
	modelPolicy: typeof COMPILER_GYM_HARDENED_PAID_MODEL_POLICY;
}

export interface CompilerGymActionSpaceVisibilityProviderPairEvidence {
	specSha256: string;
	preregistrationSha256: string;
	normalizedSystemPromptSha256: string | null;
	normalizedRequestBodySha256: string | null;
	resolvedModelSnapshotSha256: string | null;
	anchorArm: CompilerGymActionSpaceVisibilityArm | null;
	completedArms: CompilerGymActionSpaceVisibilityArm[];
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	previousTranscriptAnchorSha256: string | null;
	actualWorkspaces: string[];
	actualConversationLogs: string[];
	failures: string[];
}

export interface CompilerGymActionSpaceVisibilityProviderArmEvidence {
	arm: CompilerGymActionSpaceVisibilityArm;
	systemPromptEvents: number;
	workingDirectoryReplacements: number;
	conversationLogReplacements: number;
	normalizedSystemPromptSha256: string | null;
	normalizedSystemPromptMatchedPairAnchor: boolean | null;
	providerRequestAttempts: number;
	providerRequestBodySha256: string | null;
	normalizedProviderRequestBodySha256: string | null;
	guideReplacementCount: number;
	providerRequestMatchedPairAnchor: boolean | null;
	resolvedModelSnapshotSha256: string | null;
	resolvedModelMatchedPairAnchor: boolean | null;
	actualWorkspace: string | null;
	actualConversationLog: string | null;
	runtimeWorktreeSnapshotSha256: string | null;
	runtimeWorktreeMatchedPreregistration: boolean | null;
	runtimeWorktreeAnchorPath: string | null;
	runtimeWorktreeAnchorSha256: string | null;
	providerRequestTranscriptAnchorPath: string | null;
	providerRequestTranscriptAnchorSha256: string | null;
	failures: string[];
}

export interface CompilerGymActionSpaceVisibilityProviderRuntime {
	evidence: CompilerGymActionSpaceVisibilityProviderArmEvidence;
	extensionFactory: ExtensionFactory;
	providerRequestGate: StockInterfaceParityProviderRequestGate;
}

export interface CompilerGymActionSpaceVisibilityProviderGuard {
	spec: CompilerGymActionSpaceVisibilityProviderSpec;
	specSha256: string;
	pairEvidence: CompilerGymActionSpaceVisibilityProviderPairEvidence;
	runtimeForArm(arm: CompilerGymActionSpaceVisibilityArm): CompilerGymActionSpaceVisibilityProviderRuntime;
}

export interface CompilerGymActionSpaceVisibilityValidatedPayload {
	failures: string[];
	requestBody: string;
	requestBodySha256: string;
	normalizedRequestBody: string | null;
	normalizedRequestBodySha256: string | null;
	guideReplacementCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): string[] {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
		? []
		: [`${label} keys drifted`];
}

function exactJson(left: unknown, right: unknown): boolean {
	try {
		return canonicalJson(toJsonValue(left)) === canonicalJson(toJsonValue(right));
	} catch {
		return false;
	}
}

function replaceExactText(input: string, search: string, replacement: string): { value: string; count: number } {
	if (!search || search === replacement) return { value: input, count: 0 };
	const pieces = input.split(search);
	return { value: pieces.join(replacement), count: pieces.length - 1 };
}

function exactArmRecord<T>(
	value: Record<CompilerGymActionSpaceVisibilityArm, T>,
): Record<CompilerGymActionSpaceVisibilityArm, T> {
	if (
		Object.keys(value).length !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS.length ||
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS.some((arm) => !Object.hasOwn(value, arm))
	) {
		throw new Error("Visibility provider spec arm record drifted");
	}
	return value;
}

function parseGuideFlags(guide: string, expectedCount: number, expectedSha256: string, label: string): string[] {
	const flags = guide.split(", ");
	if (
		flags.length !== expectedCount ||
		new Set(flags).size !== expectedCount ||
		flags.some((flag) => !/^-[a-z0-9][a-z0-9-]*$/.test(flag)) ||
		sha256Json(flags) !== expectedSha256
	) {
		throw new Error(`${label} differs from its sealed action inventory`);
	}
	return flags;
}

function providerSpecActionFlags(spec: CompilerGymActionSpaceVisibilityProviderSpec): string[] {
	const controlFlags = parseGuideFlags(
		spec.guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[0]],
		26,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_FLAGS_SHA256,
		"Visibility control guide",
	);
	const treatmentFlags = parseGuideFlags(
		spec.guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
		124,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_FLAGS_SHA256,
		"Visibility treatment guide",
	);
	if (controlFlags.some((flag, index) => treatmentFlags[index] !== flag)) {
		throw new Error("Visibility treatment guide does not retain the stock prefix");
	}
	const control = new Set(controlFlags);
	const omitted = treatmentFlags.filter((flag) => !control.has(flag));
	if (omitted.length !== 98 || sha256Json(omitted) !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256) {
		throw new Error("Visibility treatment guide does not contain the sealed omitted complement");
	}
	return treatmentFlags;
}

function actionFlagLeakageFailures(value: string, allowedFlags: ReadonlySet<string>, label: string): string[] {
	const tokens = value.match(/(?<!-)-[a-z0-9][a-z0-9-]*/gi) ?? [];
	const leaked = [...new Set(tokens.filter((token) => allowedFlags.has(token.toLowerCase())))];
	return leaked.length === 0 ? [] : [`${label} leaks LLVM action flags outside the guide span`];
}

export function buildCompilerGymActionSpaceVisibilityProviderSpec(input: {
	prompts: CompilerGymActionSpaceVisibilityPrompts;
	providerSessionId: string;
	providerVisibleWorkspace: string;
	providerVisibleConversationLog: string;
	agentDir: string;
}): CompilerGymActionSpaceVisibilityProviderSpec {
	return validateCompilerGymActionSpaceVisibilityProviderSpec({
		schemaVersion: 1,
		runnerProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL,
		pairId: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID,
		arms: COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS,
		promptByArm: structuredClone(input.prompts.byArm),
		guideByArm: structuredClone(input.prompts.guideByArm),
		normalizedPrompt: input.prompts.normalized,
		normalizedPromptSha256: input.prompts.normalizedSha256,
		promptSha256ByArm: structuredClone(input.prompts.promptSha256ByArm),
		tool: COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL,
		providerSessionId: input.providerSessionId,
		providerVisibleWorkspace: input.providerVisibleWorkspace,
		providerVisibleConversationLog: input.providerVisibleConversationLog,
		agentRegistry: {
			agentDir: resolve(input.agentDir),
			modelsJsonPath: resolve(input.agentDir, "models.json"),
			modelsJsonPresent: false,
		},
		maxDispatchesPerArm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM,
		modelPolicy: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
	});
}

export function validateCompilerGymActionSpaceVisibilityProviderSpec(
	value: CompilerGymActionSpaceVisibilityProviderSpec,
): CompilerGymActionSpaceVisibilityProviderSpec {
	if (
		value.schemaVersion !== 1 ||
		value.runnerProtocol !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL ||
		value.pairId !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID ||
		!exactJson(value.arms, COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS) ||
		value.maxDispatchesPerArm !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM
	) {
		throw new Error("Visibility provider spec identity or one-dispatch policy drifted");
	}
	exactArmRecord(value.promptByArm);
	exactArmRecord(value.guideByArm);
	exactArmRecord(value.promptSha256ByArm);
	providerSpecActionFlags(value);
	if (
		!/^[A-Za-z0-9_-]{1,128}$/.test(value.providerSessionId) ||
		!value.providerVisibleWorkspace.startsWith("/") ||
		!value.providerVisibleConversationLog.startsWith("/") ||
		!value.agentRegistry.agentDir.startsWith("/") ||
		value.agentRegistry.modelsJsonPath !== resolve(value.agentRegistry.agentDir, "models.json") ||
		value.agentRegistry.modelsJsonPresent !== false
	) {
		throw new Error("Visibility provider spec paths, registry, or session ID are invalid");
	}
	if (
		!exactJson(value.tool, COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL) ||
		!exactJson(value.tool.parameters, CompilerGymActionSpaceVisibilityEvaluationSchema) ||
		!exactJson(value.modelPolicy, COMPILER_GYM_HARDENED_PAID_MODEL_POLICY)
	) {
		throw new Error("Visibility provider spec tool or model policy drifted");
	}
	for (const arm of COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS) {
		const prompt = value.promptByArm[arm];
		const guide = value.guideByArm[arm];
		if (sha256Text(prompt) !== value.promptSha256ByArm[arm]) {
			throw new Error(`Visibility ${arm} prompt hash drifted`);
		}
		const normalized = normalizeCompilerGymActionSpaceVisibilityPrompt(prompt, guide);
		if (normalized !== value.normalizedPrompt) {
			throw new Error(`Visibility ${arm} prompt differs outside its guide span`);
		}
	}
	if (sha256Text(value.normalizedPrompt) !== value.normalizedPromptSha256) {
		throw new Error("Visibility normalized prompt hash drifted");
	}
	assertNoCompilerGymActionSpaceVisibilityLeakage(value.normalizedPrompt);
	return structuredClone(value);
}

function strongLeakageFailures(serializedBody: string): string[] {
	return STRONG_FORBIDDEN_PROVIDER_PATTERNS.flatMap(([pattern, label]) =>
		pattern.test(serializedBody) ? [`provider request leaks ${label}`] : [],
	);
}

export function validateCompilerGymActionSpaceVisibilityProviderPayload(input: {
	payload: unknown;
	arm: CompilerGymActionSpaceVisibilityArm;
	providerDispatchOrdinal: number;
	normalizedSystemPrompt: string | null;
	spec: CompilerGymActionSpaceVisibilityProviderSpec;
}): CompilerGymActionSpaceVisibilityValidatedPayload {
	const requestBody = JSON.stringify(input.payload);
	const requestBodySha256 = sha256Text(requestBody);
	const failures: string[] = [];
	try {
		assertCompilerGymActionSpaceVisibilityProviderCallOrdinal(input.providerDispatchOrdinal);
	} catch (error) {
		failures.push(error instanceof Error ? error.message : String(error));
	}
	if (!COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS.includes(input.arm)) {
		failures.push("provider request arm is not part of the visibility pair");
	}
	if (!isRecord(input.payload)) {
		return {
			failures: [...failures, "provider request payload is not an object"],
			requestBody,
			requestBodySha256,
			normalizedRequestBody: null,
			normalizedRequestBodySha256: null,
			guideReplacementCount: 0,
		};
	}
	failures.push(...exactKeys(input.payload, EXACT_PAYLOAD_KEYS, "provider request payload"));
	const tools = Array.isArray(input.payload.tools) ? input.payload.tools : [];
	const tool = tools.length === 1 && isRecord(tools[0]) ? tools[0] : null;
	if (!tool) failures.push("provider request must contain exactly one object tool");
	else {
		failures.push(...exactKeys(tool, EXACT_TOOL_KEYS, "provider request tool"));
		if (
			tool.type !== "function" ||
			tool.name !== input.spec.tool.name ||
			tool.description !== input.spec.tool.description
		) {
			failures.push("provider request tool identity drifted");
		}
		if (tool.strict !== null) failures.push("provider request tool strict flag drifted");
		if (!exactJson(tool.parameters, input.spec.tool.parameters)) {
			failures.push("provider request tool schema drifted");
		}
	}
	for (const [passed, message] of [
		[input.payload.model === "gpt-5.6-luna", "provider request model drifted"],
		[input.payload.store === false, "provider request store flag drifted"],
		[input.payload.stream === true, "provider request stream flag drifted"],
		[input.payload.instructions === input.normalizedSystemPrompt, "provider request instructions drifted"],
		[input.payload.prompt_cache_key === input.spec.providerSessionId, "provider prompt-cache key drifted"],
		[input.payload.service_tier === "priority", "provider service tier drifted"],
		[input.payload.tool_choice === "auto", "provider tool choice drifted"],
		[input.payload.parallel_tool_calls === true, "provider parallel-tool flag drifted"],
		[exactJson(input.payload.include, ["reasoning.encrypted_content"]), "provider include list drifted"],
		[exactJson(input.payload.text, { verbosity: "low" }), "provider text configuration drifted"],
		[exactJson(input.payload.reasoning, { effort: "xhigh", summary: "auto" }), "provider reasoning drifted"],
	] as const) {
		if (!passed) failures.push(message);
	}
	const expectedInput = [
		{
			role: "user",
			content: [{ type: "input_text", text: input.spec.promptByArm[input.arm] }],
		},
	];
	if (!exactJson(input.payload.input, expectedInput)) {
		failures.push("provider request must contain only the exact arm prompt and no history");
	}
	for (const arm of COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS) {
		if (requestBody.includes(arm)) failures.push(`provider request retained arm-local text: ${arm}`);
	}
	let normalizedRequestBody: string | null = null;
	let normalizedRequestBodySha256: string | null = null;
	let guideReplacementCount = 0;
	if (requestBody.includes(COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_SENTINEL)) {
		failures.push("provider request already contains the reserved guide sentinel");
	} else {
		const replacement = replaceExactText(
			requestBody,
			input.spec.guideByArm[input.arm],
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_SENTINEL,
		);
		guideReplacementCount = replacement.count;
		if (guideReplacementCount !== 1) failures.push("provider request guide span does not occur exactly once");
		else {
			normalizedRequestBody = replacement.value;
			normalizedRequestBodySha256 = sha256Text(replacement.value);
			failures.push(...strongLeakageFailures(replacement.value));
			failures.push(
				...actionFlagLeakageFailures(
					replacement.value,
					new Set(providerSpecActionFlags(input.spec)),
					"provider request",
				),
			);
		}
	}
	return {
		failures,
		requestBody,
		requestBodySha256,
		normalizedRequestBody,
		normalizedRequestBodySha256,
		guideReplacementCount,
	};
}

function appendFailure(target: string[], failure: string): void {
	if (!target.includes(failure)) target.push(failure);
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
	const metadata = await stat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`Visibility provider anchor is not a private regular file: ${path}`);
	}
	return sha256Text(contents);
}

async function readPrivateJson(path: string, expectedSha256: string): Promise<unknown> {
	const metadata = await stat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`Visibility provider anchor is not a private regular file: ${path}`);
	}
	const contents = await readFile(path, "utf8");
	if (sha256Text(contents) !== expectedSha256) throw new Error(`Visibility provider anchor hash drifted: ${path}`);
	return JSON.parse(contents) as unknown;
}

export function createCompilerGymActionSpaceVisibilityProviderGuard(input: {
	spec: CompilerGymActionSpaceVisibilityProviderSpec;
	preregistrationSha256: string;
	providerRequestAnchorPath: string;
	activeAgentDir: string;
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot;
	runtimeWorktreeSnapshotProvider: () => RepositorySnapshot | Promise<RepositorySnapshot>;
}): CompilerGymActionSpaceVisibilityProviderGuard {
	if (!/^[a-f0-9]{64}$/.test(input.preregistrationSha256)) {
		throw new Error("Visibility provider preregistration hash is invalid");
	}
	const spec = validateCompilerGymActionSpaceVisibilityProviderSpec(input.spec);
	if (resolve(input.activeAgentDir) !== spec.agentRegistry.agentDir) {
		throw new Error("Active agent directory differs from the visibility provider spec");
	}
	const providerRequestAnchorPath = resolve(input.providerRequestAnchorPath);
	const expectedRuntimeWorktreeSnapshot = structuredClone(input.expectedRuntimeWorktreeSnapshot);
	const expectedRuntimeWorktreeSnapshotSha256 = sha256Json(expectedRuntimeWorktreeSnapshot);
	const allowedActionFlags = new Set(providerSpecActionFlags(spec));
	const specSha256 = sha256Json(spec);
	const pairEvidence: CompilerGymActionSpaceVisibilityProviderPairEvidence = {
		specSha256,
		preregistrationSha256: input.preregistrationSha256,
		normalizedSystemPromptSha256: null,
		normalizedRequestBodySha256: null,
		resolvedModelSnapshotSha256: null,
		anchorArm: null,
		completedArms: [],
		providerRequestAnchorPath,
		providerRequestAnchorSha256: null,
		previousTranscriptAnchorSha256: null,
		actualWorkspaces: [],
		actualConversationLogs: [],
		failures: [],
	};
	const initializedArms = new Set<CompilerGymActionSpaceVisibilityArm>();

	const runtimeForArm = (
		arm: CompilerGymActionSpaceVisibilityArm,
	): CompilerGymActionSpaceVisibilityProviderRuntime => {
		if (!COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS.includes(arm)) {
			throw new Error(`Unknown visibility provider arm: ${String(arm)}`);
		}
		if (initializedArms.has(arm)) throw new Error(`Visibility provider arm runtime already exists: ${arm}`);
		initializedArms.add(arm);
		let normalizedSystemPrompt: string | null = null;
		const evidence: CompilerGymActionSpaceVisibilityProviderArmEvidence = {
			arm,
			systemPromptEvents: 0,
			workingDirectoryReplacements: 0,
			conversationLogReplacements: 0,
			normalizedSystemPromptSha256: null,
			normalizedSystemPromptMatchedPairAnchor: null,
			providerRequestAttempts: 0,
			providerRequestBodySha256: null,
			normalizedProviderRequestBodySha256: null,
			guideReplacementCount: 0,
			providerRequestMatchedPairAnchor: null,
			resolvedModelSnapshotSha256: null,
			resolvedModelMatchedPairAnchor: null,
			actualWorkspace: null,
			actualConversationLog: null,
			runtimeWorktreeSnapshotSha256: null,
			runtimeWorktreeMatchedPreregistration: null,
			runtimeWorktreeAnchorPath: null,
			runtimeWorktreeAnchorSha256: null,
			providerRequestTranscriptAnchorPath: null,
			providerRequestTranscriptAnchorSha256: null,
			failures: [],
		};
		const extensionFactory: ExtensionFactory = (pi: ExtensionAPI): void => {
			pi.on("before_agent_start", (event) => {
				evidence.systemPromptEvents++;
				if (evidence.systemPromptEvents !== 1) appendFailure(evidence.failures, "expected one system-prompt event");
				if (event.systemPromptOptions.customPrompt !== undefined) {
					appendFailure(evidence.failures, "default system prompt was replaced");
				}
				if (!exactJson(event.systemPromptOptions.selectedTools ?? [], [spec.tool.name])) {
					appendFailure(evidence.failures, "active tools drifted");
				}
				if ((event.systemPromptOptions.contextFiles?.length ?? 0) !== 0) {
					appendFailure(evidence.failures, "context files were loaded");
				}
				if ((event.systemPromptOptions.skills?.length ?? 0) !== 0)
					appendFailure(evidence.failures, "skills were loaded");
				const workspace = event.systemPromptOptions.cwd.replace(/\\/g, "/");
				const conversationLog = event.systemPromptOptions.messagesPath?.replace(/\\/g, "/") ?? null;
				evidence.actualWorkspace = workspace;
				evidence.actualConversationLog = conversationLog;
				if (pairEvidence.actualWorkspaces.includes(workspace)) {
					appendFailure(evidence.failures, "visibility arms reused a local workspace");
				} else pairEvidence.actualWorkspaces.push(workspace);
				if (conversationLog) {
					if (pairEvidence.actualConversationLogs.includes(conversationLog)) {
						appendFailure(evidence.failures, "visibility arms reused a local conversation log");
					} else pairEvidence.actualConversationLogs.push(conversationLog);
				}
				let normalized = event.systemPrompt;
				if (!conversationLog) appendFailure(evidence.failures, "persistent conversation-log path is absent");
				else {
					const replacement = replaceExactText(normalized, conversationLog, spec.providerVisibleConversationLog);
					normalized = replacement.value;
					evidence.conversationLogReplacements = replacement.count;
				}
				const workspaceReplacement = replaceExactText(normalized, workspace, spec.providerVisibleWorkspace);
				normalized = workspaceReplacement.value;
				evidence.workingDirectoryReplacements = workspaceReplacement.count;
				if (evidence.workingDirectoryReplacements !== 1) {
					appendFailure(evidence.failures, "workspace normalization count drifted");
				}
				if (evidence.conversationLogReplacements !== 1) {
					appendFailure(evidence.failures, "conversation-log normalization count drifted");
				}
				for (const candidateArm of COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS) {
					if (normalized.includes(candidateArm))
						appendFailure(evidence.failures, "system prompt retained an arm ID");
				}
				for (const failure of strongLeakageFailures(normalized)) appendFailure(evidence.failures, failure);
				for (const failure of actionFlagLeakageFailures(
					normalized,
					allowedActionFlags,
					"normalized system prompt",
				)) {
					appendFailure(evidence.failures, failure);
				}
				normalizedSystemPrompt = normalized;
				evidence.normalizedSystemPromptSha256 = sha256Text(normalized);
				if (pairEvidence.normalizedSystemPromptSha256 === null) {
					pairEvidence.normalizedSystemPromptSha256 = evidence.normalizedSystemPromptSha256;
					evidence.normalizedSystemPromptMatchedPairAnchor = true;
				} else {
					evidence.normalizedSystemPromptMatchedPairAnchor =
						pairEvidence.normalizedSystemPromptSha256 === evidence.normalizedSystemPromptSha256;
					if (!evidence.normalizedSystemPromptMatchedPairAnchor) {
						appendFailure(evidence.failures, "normalized system prompt differs between visibility arms");
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
			evidence.providerRequestAttempts++;
			if (evidence.providerRequestAttempts !== 1) {
				appendFailure(evidence.failures, "visibility arm attempted more than one provider request");
				appendFailure(pairEvidence.failures, "visibility arm attempted more than one provider request");
				return { allowed: false, reason: evidence.failures.join("; ") };
			}
			if (evidence.systemPromptEvents !== 1 || normalizedSystemPrompt === null) {
				appendFailure(evidence.failures, "normalized system prompt is unavailable before provider dispatch");
			}
			try {
				await stat(spec.agentRegistry.modelsJsonPath);
				appendFailure(evidence.failures, "models.json appeared after preregistration");
			} catch (error) {
				if (!isRecord(error) || error.code !== "ENOENT") throw error;
			}
			let runtimeWorktreeSnapshot: RepositorySnapshot;
			try {
				runtimeWorktreeSnapshot = await input.runtimeWorktreeSnapshotProvider();
			} catch (error) {
				appendFailure(
					evidence.failures,
					`runtime worktree snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return { allowed: false, reason: evidence.failures.join("; ") };
			}
			const runtimeWorktreeSnapshotSha256 = sha256Json(runtimeWorktreeSnapshot);
			const runtimeWorktreeMatchedPreregistration =
				runtimeWorktreeSnapshotSha256 === expectedRuntimeWorktreeSnapshotSha256 &&
				exactJson(runtimeWorktreeSnapshot, expectedRuntimeWorktreeSnapshot);
			evidence.runtimeWorktreeSnapshotSha256 = runtimeWorktreeSnapshotSha256;
			evidence.runtimeWorktreeMatchedPreregistration = runtimeWorktreeMatchedPreregistration;
			if (!runtimeWorktreeMatchedPreregistration) {
				appendFailure(evidence.failures, "runtime worktree differs from preregistration");
			}
			const runtimeWorktreeAnchorPath = `${providerRequestAnchorPath}.runtime-worktree.${arm}.json`;
			evidence.runtimeWorktreeAnchorPath = runtimeWorktreeAnchorPath;
			evidence.runtimeWorktreeAnchorSha256 = await writeExclusivePrivateJson(runtimeWorktreeAnchorPath, {
				schemaVersion: 1,
				runnerProtocol: spec.runnerProtocol,
				pairId: spec.pairId,
				preregistrationSha256: input.preregistrationSha256,
				specSha256,
				arm,
				providerDispatchOrdinal,
				actualWorkspace: evidence.actualWorkspace,
				actualConversationLog: evidence.actualConversationLog,
				runtimeWorktreeSnapshot,
				runtimeWorktreeSnapshotSha256,
				expectedRuntimeWorktreeSnapshotSha256,
				matchedPreregistration: runtimeWorktreeMatchedPreregistration,
			});
			for (const failure of validateCompilerGymHardenedPaidResolvedModelSnapshot(resolvedModel)) {
				appendFailure(evidence.failures, failure);
			}
			const resolvedModelSnapshotSha256 = resolvedModel ? sha256Json(resolvedModel) : null;
			evidence.resolvedModelSnapshotSha256 = resolvedModelSnapshotSha256;
			if (pairEvidence.resolvedModelSnapshotSha256 === null && resolvedModelSnapshotSha256 !== null) {
				pairEvidence.resolvedModelSnapshotSha256 = resolvedModelSnapshotSha256;
				evidence.resolvedModelMatchedPairAnchor = true;
			} else {
				evidence.resolvedModelMatchedPairAnchor =
					resolvedModelSnapshotSha256 !== null &&
					resolvedModelSnapshotSha256 === pairEvidence.resolvedModelSnapshotSha256;
				if (!evidence.resolvedModelMatchedPairAnchor) {
					appendFailure(evidence.failures, "resolved model differs between visibility arms");
				}
			}
			const validated = validateCompilerGymActionSpaceVisibilityProviderPayload({
				payload,
				arm,
				providerDispatchOrdinal,
				normalizedSystemPrompt,
				spec,
			});
			evidence.providerRequestBodySha256 = validated.requestBodySha256;
			evidence.normalizedProviderRequestBodySha256 = validated.normalizedRequestBodySha256;
			evidence.guideReplacementCount = validated.guideReplacementCount;
			for (const failure of validated.failures) appendFailure(evidence.failures, failure);
			for (const failure of pairEvidence.failures) appendFailure(evidence.failures, failure);
			if (
				evidence.failures.length === 0 &&
				validated.normalizedRequestBody !== null &&
				validated.normalizedRequestBodySha256 !== null &&
				resolvedModel !== undefined &&
				resolvedModelSnapshotSha256 !== null &&
				normalizedSystemPrompt !== null &&
				evidence.runtimeWorktreeAnchorSha256 !== null
			) {
				if (pairEvidence.providerRequestAnchorSha256 === null) {
					const pairAnchorSha256 = await writeExclusivePrivateJson(providerRequestAnchorPath, {
						schemaVersion: 1,
						runnerProtocol: spec.runnerProtocol,
						pairId: spec.pairId,
						preregistrationSha256: input.preregistrationSha256,
						spec,
						specSha256,
						anchorArm: arm,
						providerSessionId: spec.providerSessionId,
						normalizedSystemPrompt,
						normalizedSystemPromptSha256: evidence.normalizedSystemPromptSha256,
						resolvedModelSnapshot: resolvedModel,
						resolvedModelSnapshotSha256,
						expectedRuntimeWorktreeSnapshotSha256,
						firstRuntimeWorktreeAnchorSha256: evidence.runtimeWorktreeAnchorSha256,
						firstRequestBody: validated.requestBody,
						firstRequestBodySha256: validated.requestBodySha256,
						normalizedRequestBody: validated.normalizedRequestBody,
						normalizedRequestBodySha256: validated.normalizedRequestBodySha256,
					});
					pairEvidence.providerRequestAnchorSha256 = pairAnchorSha256;
					pairEvidence.normalizedRequestBodySha256 = validated.normalizedRequestBodySha256;
					pairEvidence.anchorArm = arm;
					evidence.providerRequestMatchedPairAnchor = true;
				} else {
					try {
						const durable = await readPrivateJson(
							providerRequestAnchorPath,
							pairEvidence.providerRequestAnchorSha256,
						);
						if (
							!isRecord(durable) ||
							durable.runnerProtocol !== spec.runnerProtocol ||
							durable.pairId !== spec.pairId ||
							durable.preregistrationSha256 !== input.preregistrationSha256 ||
							durable.specSha256 !== specSha256 ||
							!exactJson(durable.spec, spec) ||
							durable.providerSessionId !== spec.providerSessionId ||
							durable.normalizedSystemPromptSha256 !== evidence.normalizedSystemPromptSha256 ||
							durable.resolvedModelSnapshotSha256 !== resolvedModelSnapshotSha256 ||
							durable.expectedRuntimeWorktreeSnapshotSha256 !== expectedRuntimeWorktreeSnapshotSha256 ||
							durable.normalizedRequestBodySha256 !== validated.normalizedRequestBodySha256 ||
							durable.normalizedRequestBody !== validated.normalizedRequestBody ||
							!COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS.includes(
								durable.anchorArm as CompilerGymActionSpaceVisibilityArm,
							)
						) {
							appendFailure(evidence.failures, "provider request pair anchor claims drifted between arms");
						}
					} catch (error) {
						appendFailure(
							evidence.failures,
							`provider request pair anchor revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					evidence.providerRequestMatchedPairAnchor =
						validated.normalizedRequestBodySha256 === pairEvidence.normalizedRequestBodySha256;
					if (!evidence.providerRequestMatchedPairAnchor) {
						appendFailure(evidence.failures, "provider request differs outside the exact action-guide span");
					}
				}
			}
			if (
				evidence.failures.length === 0 &&
				pairEvidence.providerRequestAnchorSha256 !== null &&
				validated.normalizedRequestBody !== null &&
				validated.normalizedRequestBodySha256 !== null &&
				evidence.runtimeWorktreeAnchorSha256 !== null
			) {
				const transcriptAnchorPath = `${providerRequestAnchorPath}.provider-request.${arm}.json`;
				const transcriptAnchorSha256 = await writeExclusivePrivateJson(transcriptAnchorPath, {
					schemaVersion: 1,
					runnerProtocol: spec.runnerProtocol,
					pairId: spec.pairId,
					preregistrationSha256: input.preregistrationSha256,
					specSha256,
					arm,
					providerDispatchOrdinal,
					providerSessionId: spec.providerSessionId,
					actualWorkspace: evidence.actualWorkspace,
					actualConversationLog: evidence.actualConversationLog,
					normalizedSystemPromptSha256: evidence.normalizedSystemPromptSha256,
					resolvedModelSnapshotSha256,
					runtimeWorktreeAnchorPath,
					runtimeWorktreeAnchorSha256: evidence.runtimeWorktreeAnchorSha256,
					pairRequestAnchorSha256: pairEvidence.providerRequestAnchorSha256,
					previousTranscriptAnchorSha256: pairEvidence.previousTranscriptAnchorSha256,
					requestBody: validated.requestBody,
					requestBodySha256: validated.requestBodySha256,
					normalizedRequestBody: validated.normalizedRequestBody,
					normalizedRequestBodySha256: validated.normalizedRequestBodySha256,
				});
				evidence.providerRequestTranscriptAnchorPath = transcriptAnchorPath;
				evidence.providerRequestTranscriptAnchorSha256 = transcriptAnchorSha256;
				pairEvidence.previousTranscriptAnchorSha256 = transcriptAnchorSha256;
				pairEvidence.completedArms.push(arm);
			}
			if (evidence.failures.length > 0) {
				for (const failure of evidence.failures) appendFailure(pairEvidence.failures, failure);
			}
			return {
				allowed: evidence.failures.length === 0,
				reason: evidence.failures.length === 0 ? null : evidence.failures.join("; "),
			};
		};
		return { evidence, extensionFactory, providerRequestGate };
	};

	return { spec, specSha256, pairEvidence, runtimeForArm };
}

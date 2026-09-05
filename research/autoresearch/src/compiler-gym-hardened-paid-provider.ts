import { open, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import type {
	RepositorySnapshot,
	StockInterfaceParityProviderRequestGate,
	StockInterfaceParityResolvedModelSnapshot,
} from "./stock-interface-parity.js";

export const COMPILER_GYM_HARDENED_PAID_MODEL_POLICY = {
	provider: "openai-codex",
	id: "gpt-5.6-luna",
	api: "openai-codex-responses",
	baseUrl: "https://chatgpt.com/backend-api",
	allowedModelHeaderNames: [] as readonly string[],
	allowedResolvedRequestHeaderNames: [] as readonly string[],
	requiredStoredCredentialType: "oauth",
	requiredAuthSource: "stored",
	oauthProviderRegistrationRequired: true,
	registryLoadErrorAllowed: false,
	modelsJsonApiKeyFallbackAllowed: false,
} as const;

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

export interface CompilerGymHardenedPaidProviderSpec<Arm extends string> {
	schemaVersion: 1;
	runnerProtocol: string;
	pairId: string;
	arms: readonly [Arm, Arm];
	prompt: string;
	tool: {
		name: string;
		description: string;
		parameters: unknown;
	};
	providerSessionId: string;
	providerVisibleWorkspace: string;
	providerVisibleConversationLog: string;
	agentRegistry: {
		agentDir: string;
		modelsJsonPath: string;
		modelsJsonPresent: false;
	};
	maxDispatchesPerArm: 4;
	modelPolicy: typeof COMPILER_GYM_HARDENED_PAID_MODEL_POLICY;
	guidance: {
		field: string;
		value: string;
		treatmentArm: Arm;
		consumerDispatchOrdinal: 4;
		producerResultOrdinal: 3;
		requiresAcceptedProducerResult: true;
		acceptedBenchmarkIds: readonly [string, string];
	};
}

export interface CompilerGymHardenedPaidGuidanceExposure {
	providerDispatchOrdinal: number;
	producerAccepted: boolean;
	treatmentExpected: boolean;
	occurrences: number;
	exactLocation: boolean;
	exposed: boolean;
}

export interface CompilerGymHardenedPaidProviderEvidence<Arm extends string> {
	arm: Arm;
	specSha256: string;
	systemPromptEvents: number;
	workingDirectoryReplacements: number;
	conversationLogReplacements: number;
	normalizedSystemPromptSha256: string | null;
	normalizedSystemPromptMatchedPairAnchor: boolean | null;
	providerRequestBodySha256s: string[];
	guidanceExposureByDispatch: CompilerGymHardenedPaidGuidanceExposure[];
	firstProviderRequestBodyMatchedPairAnchor: boolean | null;
	resolvedModelSnapshotSha256s: string[];
	firstResolvedModelMatchedPairAnchor: boolean | null;
	runtimeWorktreeSnapshotSha256s: string[];
	runtimeWorktreeSnapshotMatchesPreregistration: boolean[];
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	runtimeWorktreeDispatchAnchors: Array<{
		providerDispatchOrdinal: number;
		path: string;
		sha256: string;
		snapshotSha256: string;
	}>;
	providerRequestTranscriptAnchors: Array<{
		providerDispatchOrdinal: number;
		path: string;
		sha256: string;
		requestBodySha256: string;
		previousDispatchAnchorSha256: string | null;
	}>;
	failures: string[];
}

export interface CompilerGymHardenedPaidProviderRuntime<Arm extends string> {
	evidence: CompilerGymHardenedPaidProviderEvidence<Arm>;
	extensionFactory: ExtensionFactory;
	providerRequestGate: StockInterfaceParityProviderRequestGate;
}

export interface CompilerGymHardenedPaidProviderGuard<Arm extends string> {
	spec: CompilerGymHardenedPaidProviderSpec<Arm>;
	specSha256: string;
	runtimeForArm(arm: Arm): CompilerGymHardenedPaidProviderRuntime<Arm>;
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
	const parts = input.split(search);
	return { value: parts.join(replacement), count: parts.length - 1 };
}

function validateSpec<Arm extends string>(value: CompilerGymHardenedPaidProviderSpec<Arm>) {
	if (value.schemaVersion !== 1 || !value.runnerProtocol.trim() || !value.pairId.trim() || !value.prompt.trim()) {
		throw new Error("Hardened paid-provider spec identity and prompt must be nonempty");
	}
	if (value.arms.length !== 2 || new Set(value.arms).size !== 2) {
		throw new Error("Hardened paid-provider spec must contain exactly two distinct arms");
	}
	for (const arm of value.arms) {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(arm)) throw new Error(`Hardened paid-provider arm is not path-safe: ${arm}`);
	}
	if (!value.arms.includes(value.guidance.treatmentArm)) {
		throw new Error("Hardened paid-provider treatment arm is absent from the pair");
	}
	if (
		!value.tool.name.trim() ||
		!value.tool.description.trim() ||
		!value.providerVisibleWorkspace.startsWith("/") ||
		!value.providerVisibleConversationLog.startsWith("/") ||
		!value.agentRegistry.agentDir.startsWith("/") ||
		value.agentRegistry.modelsJsonPath !== resolve(value.agentRegistry.agentDir, "models.json") ||
		value.agentRegistry.modelsJsonPresent !== false ||
		!value.guidance.field.trim() ||
		!value.guidance.value.trim() ||
		value.maxDispatchesPerArm !== 4 ||
		value.guidance.consumerDispatchOrdinal !== 4 ||
		value.guidance.producerResultOrdinal !== 3 ||
		value.guidance.requiresAcceptedProducerResult !== true ||
		value.guidance.acceptedBenchmarkIds.length !== 2 ||
		new Set(value.guidance.acceptedBenchmarkIds).size !== 2 ||
		value.guidance.acceptedBenchmarkIds.some((benchmarkId) => !benchmarkId.trim())
	) {
		throw new Error("Hardened paid-provider frozen policy fields drifted");
	}
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(value.providerSessionId)) {
		throw new Error("Hardened paid-provider session ID is not path-safe");
	}
	if (!exactJson(value.modelPolicy, COMPILER_GYM_HARDENED_PAID_MODEL_POLICY)) {
		throw new Error("Hardened paid-provider resolved-model policy drifted");
	}
	return structuredClone(value);
}

export function validateCompilerGymHardenedPaidResolvedModelSnapshot(
	snapshot: StockInterfaceParityResolvedModelSnapshot | undefined,
): string[] {
	if (!snapshot) return ["resolved model snapshot is absent immediately before provider dispatch"];
	const policy = COMPILER_GYM_HARDENED_PAID_MODEL_POLICY;
	const failures: string[] = [];
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
		if (model.baseUrl !== policy.baseUrl || model.baseUrl.endsWith("/"))
			failures.push(`${label} model base URL drifted`);
		if (!exactJson(model.headerNames, policy.allowedModelHeaderNames))
			failures.push(`${label} model headers drifted`);
	}
	if (snapshot.registryLoadErrorPresent) failures.push("model registry reported a models.json load error");
	if (snapshot.storedCredentialType !== "oauth") failures.push("OpenAI Codex credential is not stored OAuth");
	if (!snapshot.oauthProviderRegistered) failures.push("OpenAI Codex OAuth provider is not registered");
	if (!snapshot.requestAuthResolved || !snapshot.apiKeyPresent)
		failures.push("stored OAuth request authentication did not resolve");
	if (snapshot.selectedAuthSource !== "stored") failures.push("provider request did not select stored OAuth");
	if (!exactJson(snapshot.resolvedRequestHeaderNames, [])) failures.push("resolved provider auth headers drifted");
	return failures;
}

function acceptedProducerResult<Arm extends string>(
	value: unknown,
	spec: CompilerGymHardenedPaidProviderSpec<Arm>,
): boolean {
	if (
		!isRecord(value) ||
		!isRecord(value.job) ||
		!isRecord(value.job.state) ||
		value.job.state.status !== "succeeded"
	) {
		return false;
	}
	const measurement = value.job.measurement;
	if (!isRecord(measurement) || !Array.isArray(measurement.tasks)) return false;
	const tasks: unknown[] = measurement.tasks;
	return spec.guidance.acceptedBenchmarkIds.every((benchmarkId) => {
		const matches = tasks.filter(
			(task): task is Record<string, unknown> => isRecord(task) && task.benchmarkId === benchmarkId,
		);
		return (
			matches.length === 1 &&
			matches[0]?.status === "accepted" &&
			isRecord(matches[0].verifier) &&
			matches[0].verifier.passed === true
		);
	});
}

function findJsonFieldOccurrences(value: unknown, field: string, path = "$"): Array<{ path: string; value: unknown }> {
	if (Array.isArray(value)) {
		return value.flatMap((item, index) => findJsonFieldOccurrences(item, field, `${path}[${index}]`));
	}
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([key, item]) => [
		...(key === field ? [{ path: `${path}.${key}`, value: item }] : []),
		...findJsonFieldOccurrences(item, field, `${path}.${key}`),
	]);
}

export function inspectCompilerGymHardenedPaidGuidanceStructure<Arm extends string>(input: {
	payloadInput: unknown[];
	arm: Arm;
	dispatchOrdinal: number;
	spec: CompilerGymHardenedPaidProviderSpec<Arm>;
}): CompilerGymHardenedPaidGuidanceExposure & { failures: string[] } {
	const base = {
		providerDispatchOrdinal: input.dispatchOrdinal,
		producerAccepted: false,
		treatmentExpected: false,
		occurrences: 0,
		exactLocation: false,
		exposed: false,
	};
	const fail = (failure: string) => ({ ...base, failures: [failure] });
	const outputs: Record<string, unknown>[] = [];
	let cursor = 1;
	for (let completedTurn = 0; completedTurn < input.dispatchOrdinal - 1; completedTurn++) {
		let messageItems = 0;
		while (cursor < input.payloadInput.length) {
			const item = input.payloadInput[cursor];
			if (!isRecord(item)) return fail("provider request transcript item is not an object");
			if (item.type === "reasoning") {
				if (
					exactKeys(item, ["content", "encrypted_content", "id", "summary", "type"], "provider reasoning item")
						.length
				) {
					return fail("provider request reasoning item shape drifted");
				}
				cursor++;
				continue;
			}
			if (item.type === "message") {
				messageItems++;
				const messageKeys = Object.hasOwn(item, "phase")
					? ["content", "id", "phase", "role", "status", "type"]
					: ["content", "id", "role", "status", "type"];
				if (
					messageItems > 1 ||
					exactKeys(item, messageKeys, "provider assistant message").length ||
					item.role !== "assistant" ||
					item.status !== "completed" ||
					(Object.hasOwn(item, "phase") && item.phase !== "commentary" && item.phase !== "final_answer")
				) {
					return fail("provider request assistant message shape drifted");
				}
				cursor++;
				continue;
			}
			break;
		}
		const call = input.payloadInput[cursor];
		if (
			!isRecord(call) ||
			call.type !== "function_call" ||
			exactKeys(call, ["arguments", "call_id", "id", "name", "type"], "provider function call").length ||
			call.name !== input.spec.tool.name ||
			typeof call.call_id !== "string" ||
			!call.call_id ||
			typeof call.id !== "string" ||
			!call.id ||
			typeof call.arguments !== "string"
		) {
			return fail("provider request function-call shape drifted");
		}
		cursor++;
		const output = input.payloadInput[cursor];
		if (
			!isRecord(output) ||
			output.type !== "function_call_output" ||
			exactKeys(output, ["call_id", "output", "type"], "provider function-call output").length ||
			output.call_id !== call.call_id ||
			typeof output.output !== "string"
		) {
			return fail("provider request function-call output shape drifted");
		}
		outputs.push(output);
		cursor++;
	}
	if (cursor !== input.payloadInput.length)
		return fail("provider request transcript contains unexpected trailing items");
	if (outputs.length !== input.dispatchOrdinal - 1) return fail("provider request tool-result count drifted");
	let occurrences = 0;
	let exactLocation = false;
	let producerAccepted = false;
	for (const [index, output] of outputs.entries()) {
		if (typeof output.output !== "string") return fail("provider request tool result is not serialized text");
		let parsed: unknown;
		try {
			parsed = JSON.parse(output.output);
		} catch {
			return fail("provider request tool result is not JSON");
		}
		if (index === input.spec.guidance.producerResultOrdinal - 1) {
			producerAccepted = acceptedProducerResult(parsed, input.spec);
		}
		const fieldOccurrences = findJsonFieldOccurrences(parsed, input.spec.guidance.field);
		occurrences += fieldOccurrences.length;
		if (fieldOccurrences.length > 0) {
			if (fieldOccurrences.some((occurrence) => occurrence.value !== input.spec.guidance.value)) {
				return fail("provider request guidance value drifted");
			}
			exactLocation =
				fieldOccurrences.length === 1 &&
				fieldOccurrences[0]?.path === `$.${input.spec.guidance.field}` &&
				index === input.spec.guidance.producerResultOrdinal - 1;
		}
	}
	const treatmentExpected =
		input.arm === input.spec.guidance.treatmentArm &&
		input.dispatchOrdinal === input.spec.guidance.consumerDispatchOrdinal &&
		producerAccepted;
	const exposure = {
		providerDispatchOrdinal: input.dispatchOrdinal,
		producerAccepted,
		treatmentExpected,
		occurrences,
		exactLocation,
		exposed: occurrences === 1 && exactLocation,
	};
	if (treatmentExpected && !exposure.exposed) {
		return { ...exposure, failures: ["treatment call four lacks exactly one structurally located guidance field"] };
	}
	if (!treatmentExpected && occurrences !== 0) {
		return { ...exposure, failures: ["guidance leaked outside accepted-result-three treatment call four"] };
	}
	return { ...exposure, failures: [] };
}

export function validateCompilerGymHardenedPaidProviderPayload<Arm extends string>(input: {
	payload: unknown;
	arm: Arm;
	dispatchOrdinal: number;
	normalizedSystemPrompt: string | null;
	spec: CompilerGymHardenedPaidProviderSpec<Arm>;
}): string[] {
	if (!isRecord(input.payload)) return ["provider request payload is not an object"];
	const failures = exactKeys(input.payload, EXACT_PAYLOAD_KEYS, "provider request payload");
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
		if (!exactJson(tool.parameters, input.spec.tool.parameters))
			failures.push("provider request tool schema drifted");
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
	if (!Array.isArray(input.payload.input)) return [...failures, "provider request input is not an array"];
	const expectedFirstInput = [{ role: "user", content: [{ type: "input_text", text: input.spec.prompt }] }];
	if (!exactJson(input.payload.input.slice(0, 1), expectedFirstInput))
		failures.push("provider first input prompt shape drifted");
	if (input.dispatchOrdinal === 1 && !exactJson(input.payload.input, expectedFirstInput)) {
		failures.push("first provider request input contains unexpected history");
	}
	const guidance = inspectCompilerGymHardenedPaidGuidanceStructure({
		payloadInput: input.payload.input,
		arm: input.arm,
		dispatchOrdinal: input.dispatchOrdinal,
		spec: input.spec,
	});
	failures.push(...guidance.failures);
	const serialized = JSON.stringify(input.payload);
	for (const forbidden of [...input.spec.arms]) {
		if (serialized.includes(forbidden)) failures.push(`provider request retained arm-local text: ${forbidden}`);
	}
	return failures;
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
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
		throw new Error(`Paid-provider anchor is not mode 0600: ${path}`);
	return sha256Text(contents);
}

export function createCompilerGymHardenedPaidProviderGuard<Arm extends string>(input: {
	spec: CompilerGymHardenedPaidProviderSpec<Arm>;
	preregistrationSha256: string;
	providerRequestAnchorPath: string;
	activeAgentDir: string;
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot;
	runtimeWorktreeSnapshotProvider: () => RepositorySnapshot | Promise<RepositorySnapshot>;
}): CompilerGymHardenedPaidProviderGuard<Arm> {
	if (!/^[a-f0-9]{64}$/.test(input.preregistrationSha256))
		throw new Error("Paid-provider preregistration hash is invalid");
	const spec = validateSpec(input.spec);
	if (resolve(input.activeAgentDir) !== spec.agentRegistry.agentDir) {
		throw new Error("Active Prime agent directory differs from the preregistered provider registry directory");
	}
	const specSha256 = sha256Json(spec);
	const expectedSnapshot = structuredClone(input.expectedRuntimeWorktreeSnapshot);
	const expectedSnapshotSha256 = sha256Json(expectedSnapshot);
	let normalizedSystemPromptSha256: string | null = null;
	let firstProviderRequestBodySha256: string | null = null;
	let firstResolvedModelSnapshotSha256: string | null = null;
	let providerRequestAnchorSha256: string | null = null;
	let anchorArm: Arm | null = null;
	const initializedArms = new Set<Arm>();

	const runtimeForArm = (arm: Arm): CompilerGymHardenedPaidProviderRuntime<Arm> => {
		if (!spec.arms.includes(arm)) throw new Error(`Unknown hardened paid-provider arm: ${String(arm)}`);
		if (initializedArms.has(arm)) throw new Error(`Hardened paid-provider arm runtime was already created: ${arm}`);
		initializedArms.add(arm);
		let normalizedSystemPrompt: string | null = null;
		let actualWorkspace: string | null = null;
		let actualConversationLog: string | null = null;
		const evidence: CompilerGymHardenedPaidProviderEvidence<Arm> = {
			arm,
			specSha256,
			systemPromptEvents: 0,
			workingDirectoryReplacements: 0,
			conversationLogReplacements: 0,
			normalizedSystemPromptSha256: null,
			normalizedSystemPromptMatchedPairAnchor: null,
			providerRequestBodySha256s: [],
			guidanceExposureByDispatch: [],
			firstProviderRequestBodyMatchedPairAnchor: null,
			resolvedModelSnapshotSha256s: [],
			firstResolvedModelMatchedPairAnchor: null,
			runtimeWorktreeSnapshotSha256s: [],
			runtimeWorktreeSnapshotMatchesPreregistration: [],
			providerRequestAnchorPath: resolve(input.providerRequestAnchorPath),
			providerRequestAnchorSha256: null,
			runtimeWorktreeDispatchAnchors: [],
			providerRequestTranscriptAnchors: [],
			failures: [],
		};
		const extensionFactory: ExtensionFactory = (pi: ExtensionAPI): void => {
			pi.on("before_agent_start", (event) => {
				evidence.systemPromptEvents++;
				if (evidence.systemPromptEvents !== 1) evidence.failures.push("expected exactly one system-prompt event");
				if (event.systemPromptOptions.customPrompt !== undefined)
					evidence.failures.push("default system prompt was replaced");
				if (!exactJson(event.systemPromptOptions.selectedTools ?? [], [spec.tool.name]))
					evidence.failures.push("active tools drifted");
				if ((event.systemPromptOptions.contextFiles?.length ?? 0) !== 0)
					evidence.failures.push("context files were loaded");
				if ((event.systemPromptOptions.skills?.length ?? 0) !== 0) evidence.failures.push("skills were loaded");
				actualWorkspace = event.systemPromptOptions.cwd.replace(/\\/g, "/");
				actualConversationLog = event.systemPromptOptions.messagesPath?.replace(/\\/g, "/") ?? null;
				let normalized = event.systemPrompt;
				if (!actualConversationLog) evidence.failures.push("persistent conversation-log path is absent");
				else {
					const replacement = replaceExactText(
						normalized,
						actualConversationLog,
						spec.providerVisibleConversationLog,
					);
					normalized = replacement.value;
					evidence.conversationLogReplacements = replacement.count;
				}
				const workspaceReplacement = replaceExactText(normalized, actualWorkspace, spec.providerVisibleWorkspace);
				normalized = workspaceReplacement.value;
				evidence.workingDirectoryReplacements = workspaceReplacement.count;
				if (evidence.workingDirectoryReplacements !== 1)
					evidence.failures.push("workspace normalization count drifted");
				if (evidence.conversationLogReplacements !== 1)
					evidence.failures.push("conversation-log normalization count drifted");
				if (spec.arms.some((candidate) => normalized.includes(candidate)))
					evidence.failures.push("system prompt retained an arm ID");
				normalizedSystemPrompt = normalized;
				evidence.normalizedSystemPromptSha256 = sha256Text(normalized);
				if (normalizedSystemPromptSha256 === null) {
					normalizedSystemPromptSha256 = evidence.normalizedSystemPromptSha256;
					evidence.normalizedSystemPromptMatchedPairAnchor = true;
				} else {
					evidence.normalizedSystemPromptMatchedPairAnchor =
						normalizedSystemPromptSha256 === evidence.normalizedSystemPromptSha256;
					if (!evidence.normalizedSystemPromptMatchedPairAnchor)
						evidence.failures.push("normalized system prompts differ by arm");
				}
				return { systemPrompt: normalized };
			});
		};
		const providerRequestGate: StockInterfaceParityProviderRequestGate = async ({
			payload,
			providerDispatchOrdinal,
			resolvedModel,
		}) => {
			if (evidence.systemPromptEvents !== 1 || normalizedSystemPrompt === null) {
				evidence.failures.push("normalized system prompt is unavailable before provider dispatch");
			}
			try {
				await stat(spec.agentRegistry.modelsJsonPath);
				evidence.failures.push("models.json appeared after preregistration");
			} catch (error) {
				if (!isRecord(error) || error.code !== "ENOENT") throw error;
			}
			if (providerDispatchOrdinal !== evidence.providerRequestBodySha256s.length + 1)
				evidence.failures.push("provider dispatch ordinal drifted");
			if (providerDispatchOrdinal > spec.maxDispatchesPerArm)
				evidence.failures.push("provider dispatch cap exceeded");
			evidence.failures.push(...validateCompilerGymHardenedPaidResolvedModelSnapshot(resolvedModel));
			const resolvedModelSha256 = resolvedModel ? sha256Json(resolvedModel) : null;
			if (resolvedModelSha256) evidence.resolvedModelSnapshotSha256s.push(resolvedModelSha256);
			if (firstResolvedModelSnapshotSha256 === null && resolvedModelSha256) {
				firstResolvedModelSnapshotSha256 = resolvedModelSha256;
				evidence.firstResolvedModelMatchedPairAnchor = true;
			} else {
				evidence.firstResolvedModelMatchedPairAnchor = resolvedModelSha256 === firstResolvedModelSnapshotSha256;
				if (!evidence.firstResolvedModelMatchedPairAnchor)
					evidence.failures.push("resolved model differs from pair anchor");
			}
			let runtimeSnapshot: RepositorySnapshot;
			try {
				runtimeSnapshot = await input.runtimeWorktreeSnapshotProvider();
			} catch (error) {
				evidence.failures.push(
					`runtime worktree snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return { allowed: false, reason: evidence.failures.join("; ") };
			}
			const runtimeSha256 = sha256Json(runtimeSnapshot);
			const runtimeMatched =
				runtimeSha256 === expectedSnapshotSha256 && exactJson(runtimeSnapshot, expectedSnapshot);
			evidence.runtimeWorktreeSnapshotSha256s.push(runtimeSha256);
			evidence.runtimeWorktreeSnapshotMatchesPreregistration.push(runtimeMatched);
			const runtimeAnchorPath = `${resolve(input.providerRequestAnchorPath)}.runtime-worktree.${arm}.${providerDispatchOrdinal}.json`;
			const runtimeAnchorSha256 = await writeExclusivePrivateJson(runtimeAnchorPath, {
				runnerProtocol: spec.runnerProtocol,
				pairId: spec.pairId,
				specSha256,
				preregistrationSha256: input.preregistrationSha256,
				arm,
				providerDispatchOrdinal,
				runtimeSnapshot,
				runtimeSha256,
				expectedSnapshotSha256,
				matched: runtimeMatched,
			});
			evidence.runtimeWorktreeDispatchAnchors.push({
				providerDispatchOrdinal,
				path: runtimeAnchorPath,
				sha256: runtimeAnchorSha256,
				snapshotSha256: runtimeSha256,
			});
			if (!runtimeMatched) evidence.failures.push("runtime worktree differs from preregistration");
			const payloadFailures = validateCompilerGymHardenedPaidProviderPayload({
				payload,
				arm,
				dispatchOrdinal: providerDispatchOrdinal,
				normalizedSystemPrompt,
				spec,
			});
			evidence.failures.push(...payloadFailures);
			if (isRecord(payload) && Array.isArray(payload.input)) {
				const guidance = inspectCompilerGymHardenedPaidGuidanceStructure({
					payloadInput: payload.input,
					arm,
					dispatchOrdinal: providerDispatchOrdinal,
					spec,
				});
				const { failures: _failures, ...exposure } = guidance;
				evidence.guidanceExposureByDispatch.push(exposure);
			}
			const serializedBody = JSON.stringify(payload);
			const bodySha256 = sha256Text(serializedBody);
			evidence.providerRequestBodySha256s.push(bodySha256);
			if (providerDispatchOrdinal === 1) {
				if (firstProviderRequestBodySha256 === null) {
					if (evidence.failures.length === 0) {
						firstProviderRequestBodySha256 = bodySha256;
						anchorArm = arm;
						providerRequestAnchorSha256 = await writeExclusivePrivateJson(
							resolve(input.providerRequestAnchorPath),
							{
								runnerProtocol: spec.runnerProtocol,
								pairId: spec.pairId,
								spec,
								specSha256,
								preregistrationSha256: input.preregistrationSha256,
								anchorArm,
								normalizedSystemPromptSha256,
								resolvedModel,
								resolvedModelSha256,
								expectedSnapshotSha256,
								firstRuntimeSnapshotSha256: runtimeSha256,
								firstProviderRequestBody: serializedBody,
								firstProviderRequestBodySha256: bodySha256,
							},
						);
						evidence.providerRequestAnchorSha256 = providerRequestAnchorSha256;
						evidence.firstProviderRequestBodyMatchedPairAnchor = true;
					}
				} else {
					try {
						const anchorPath = resolve(input.providerRequestAnchorPath);
						const metadata = await stat(anchorPath);
						if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
							evidence.failures.push("provider request pair anchor is not a private regular file");
						}
						const anchorContents = await readFile(anchorPath, "utf8");
						if (
							providerRequestAnchorSha256 === null ||
							sha256Text(anchorContents) !== providerRequestAnchorSha256
						) {
							evidence.failures.push("provider request pair anchor hash drifted between arms");
						}
						const durable: unknown = JSON.parse(anchorContents);
						if (
							!isRecord(durable) ||
							durable.runnerProtocol !== spec.runnerProtocol ||
							durable.pairId !== spec.pairId ||
							durable.specSha256 !== specSha256 ||
							!exactJson(durable.spec, spec) ||
							durable.preregistrationSha256 !== input.preregistrationSha256 ||
							durable.normalizedSystemPromptSha256 !== normalizedSystemPromptSha256 ||
							durable.resolvedModelSha256 !== resolvedModelSha256 ||
							durable.expectedSnapshotSha256 !== expectedSnapshotSha256 ||
							durable.firstRuntimeSnapshotSha256 !== runtimeSha256 ||
							durable.firstProviderRequestBodySha256 !== bodySha256 ||
							durable.firstProviderRequestBody !== serializedBody ||
							!spec.arms.includes(durable.anchorArm as Arm)
						) {
							evidence.failures.push("provider request pair anchor claims drifted between arms");
						}
					} catch (error) {
						evidence.failures.push(
							`provider request pair anchor revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					evidence.firstProviderRequestBodyMatchedPairAnchor = bodySha256 === firstProviderRequestBodySha256;
					if (!evidence.firstProviderRequestBodyMatchedPairAnchor)
						evidence.failures.push("first provider request body differs by arm");
					evidence.providerRequestAnchorSha256 = providerRequestAnchorSha256;
				}
			}
			if (evidence.failures.length === 0) {
				if (providerRequestAnchorSha256 === null || evidence.providerRequestAnchorSha256 === null) {
					evidence.failures.push("provider pair anchor is unavailable before dispatch transcript sealing");
				} else {
					const previousDispatchAnchorSha256 = evidence.providerRequestTranscriptAnchors.at(-1)?.sha256 ?? null;
					const transcriptAnchorPath = `${resolve(input.providerRequestAnchorPath)}.provider-request.${arm}.${providerDispatchOrdinal}.json`;
					const transcriptAnchorSha256 = await writeExclusivePrivateJson(transcriptAnchorPath, {
						schemaVersion: 1,
						runnerProtocol: spec.runnerProtocol,
						pairId: spec.pairId,
						preregistrationSha256: input.preregistrationSha256,
						specSha256,
						arm,
						providerDispatchOrdinal,
						providerSessionId: spec.providerSessionId,
						normalizedSystemPrompt,
						normalizedSystemPromptSha256: evidence.normalizedSystemPromptSha256,
						resolvedModel,
						resolvedModelSha256,
						runtimeWorktreeDispatchAnchorPath: runtimeAnchorPath,
						runtimeWorktreeDispatchAnchorSha256: runtimeAnchorSha256,
						pairRequestAnchorSha256: providerRequestAnchorSha256,
						previousDispatchAnchorSha256,
						requestBody: serializedBody,
						requestBodySha256: bodySha256,
						guidanceExposure: evidence.guidanceExposureByDispatch.at(-1),
					});
					evidence.providerRequestTranscriptAnchors.push({
						providerDispatchOrdinal,
						path: transcriptAnchorPath,
						sha256: transcriptAnchorSha256,
						requestBodySha256: bodySha256,
						previousDispatchAnchorSha256,
					});
				}
			}
			return {
				allowed: evidence.failures.length === 0,
				reason: evidence.failures.length ? evidence.failures.join("; ") : null,
			};
		};
		return { evidence, extensionFactory, providerRequestGate };
	};
	return { spec, specSha256, runtimeForArm };
}

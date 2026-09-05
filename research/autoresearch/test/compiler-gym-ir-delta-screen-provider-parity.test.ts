import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Context, fauxAssistantMessage, registerFauxProvider, type StreamOptions } from "@earendil-works/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "../../../packages/ai/src/models.js";
import { streamOpenAICodexResponses } from "../../../packages/ai/src/providers/openai-codex-responses.js";
import { sha256Text } from "../src/canonical-json.js";
import {
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_SCREEN_ARMS,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
	type CompilerGymIrDeltaScreenArm,
	CompilerGymIrDeltaScreenEvaluationSchema,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	type CompilerGymIrDeltaScreenProviderVisibilityRuntime,
	createCompilerGymIrDeltaScreenProviderVisibilityPairState,
	createCompilerGymIrDeltaScreenProviderVisibilityRuntime,
} from "../src/compiler-gym-ir-delta-screen-runner.js";
import { createHostOwnedTerminalizationRuntimeTracker } from "../src/host-owned-terminalization.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
	type StockInterfaceParityProviderRequestGate,
} from "../src/stock-interface-parity.js";
import {
	createStockInterfaceParityTool,
	openStockInterfaceParityController,
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	type StockInterfaceParityToolTrace,
} from "../src/stock-interface-parity-protocol.js";
import type { EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome } from "../src/types.js";

const PROVIDER_SESSION_ID = "compiler-gym-ir-delta-paid-screen-pair-neutral-v1";
const USER_PROMPT = buildCompilerGymIrDeltaScreenPrompt();
const ORIGINAL_FETCH = globalThis.fetch;
const CODEX_MODEL = getModel("openai-codex", "gpt-5.6-luna");
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUNTIME_WORKTREE_SNAPSHOT = capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT);

interface ProviderOptionSnapshot {
	maxRetries: number | undefined;
	maxRetryDelayMs: number | undefined;
	maxTokens: number | undefined;
	serviceTier: StreamOptions["serviceTier"];
	sessionId: string | undefined;
	timeoutMs: number | undefined;
	transport: StreamOptions["transport"];
}

interface ProviderCapture {
	context: Context;
	options: ProviderOptionSnapshot;
}

interface ProviderVisibilityPairFixture {
	captures: readonly [ProviderCapture, ProviderCapture];
	runtimes: Record<CompilerGymIrDeltaScreenArm, CompilerGymIrDeltaScreenProviderVisibilityRuntime>;
	sessionFiles: readonly [string, string];
}

interface CodexTransportCapture {
	body: string;
	headers: Record<string, string>;
	url: string;
}

interface SerializedCodexRequest {
	gate: { allowed: boolean; reason: string | null };
	payload: Record<string, unknown>;
	stopReason: string;
}

function serializedTool(payload: Record<string, unknown>): Record<string, unknown> {
	assert.ok(Array.isArray(payload.tools));
	const tool = payload.tools[0];
	assert.ok(typeof tool === "object" && tool !== null && !Array.isArray(tool));
	return tool as Record<string, unknown>;
}

function serializedActionSchema(payload: Record<string, unknown>): Record<string, unknown> {
	const parameters = serializedTool(payload).parameters;
	assert.ok(typeof parameters === "object" && parameters !== null && !Array.isArray(parameters));
	const properties = (parameters as Record<string, unknown>).properties;
	assert.ok(typeof properties === "object" && properties !== null && !Array.isArray(properties));
	const actions = (properties as Record<string, unknown>).actions;
	assert.ok(typeof actions === "object" && actions !== null && !Array.isArray(actions));
	return actions as Record<string, unknown>;
}

class NoDispatchAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	evaluate(_job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		throw new Error("Provider-visibility parity must not dispatch an evaluator");
	}
}

function traceFixture(): StockInterfaceParityToolTrace {
	return {
		callCount: 0,
		duplicateCount: 0,
		evaluatorWaitMs: 0,
		jobIds: [],
		requests: [],
		modelFeedbackBytes: [],
	};
}

function cloneContext(context: Context): Context {
	return JSON.parse(JSON.stringify(context)) as Context;
}

function optionSnapshot(options: StreamOptions | undefined): ProviderOptionSnapshot {
	return {
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		maxTokens: options?.maxTokens,
		serviceTier: options?.serviceTier,
		sessionId: options?.sessionId,
		timeoutMs: options?.timeoutMs,
		transport: options?.transport,
	};
}

function userText(context: Context): string[] {
	return context.messages.flatMap((message) => {
		if (message.role !== "user") return [];
		return typeof message.content === "string"
			? [message.content]
			: message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
	});
}

async function captureProviderVisibilityPair(
	root: string,
	armOrder: readonly [CompilerGymIrDeltaScreenArm, CompilerGymIrDeltaScreenArm] = COMPILER_GYM_IR_DELTA_SCREEN_ARMS,
): Promise<ProviderVisibilityPairFixture> {
	const providerRequestAnchorPath = join(root, "provider-request-anchor.json");
	const pairState = createCompilerGymIrDeltaScreenProviderVisibilityPairState({
		providerRequestAnchorPath,
		preregistrationSha256: "a".repeat(64),
		expectedRuntimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
		runtimeWorktreeSnapshotProvider: () => structuredClone(RUNTIME_WORKTREE_SNAPSHOT),
	});
	const runtimes = Object.fromEntries(
		COMPILER_GYM_IR_DELTA_SCREEN_ARMS.map((arm) => [
			arm,
			createCompilerGymIrDeltaScreenProviderVisibilityRuntime({
				arm,
				providerSessionId: PROVIDER_SESSION_ID,
				pairState,
			}),
		]),
	) as Record<CompilerGymIrDeltaScreenArm, CompilerGymIrDeltaScreenProviderVisibilityRuntime>;

	const controller = await openStockInterfaceParityController(
		join(root, "neutral-controller"),
		new NoDispatchAdapter(),
	);
	const parityTool = createStockInterfaceParityTool(controller, traceFixture(), {
		evaluationSchema: CompilerGymIrDeltaScreenEvaluationSchema,
		hostOwnsTerminalization: true,
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	});
	const faux = registerFauxProvider({
		provider: `faux-paid-screen-provider-parity-${process.pid}-${root.split("/").at(-1)}`,
		models: [{ id: "faux-1", reasoning: false }],
	});
	const model = faux.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((registeredModel) => ({
			id: registeredModel.id,
			name: registeredModel.name,
			api: registeredModel.api,
			reasoning: registeredModel.reasoning,
			input: registeredModel.input,
			cost: registeredModel.cost,
			contextWindow: registeredModel.contextWindow,
			maxTokens: registeredModel.maxTokens,
			baseUrl: registeredModel.baseUrl,
		})),
	});

	const captures: ProviderCapture[] = [];
	faux.setResponses(
		armOrder.map(() => (context, options) => {
			captures.push({ context: cloneContext(context), options: optionSnapshot(options) });
			return fauxAssistantMessage("provider-visible parity captured", { timestamp: 1_788_000_000_000 });
		}),
	);
	const sessionFiles: string[] = [];
	try {
		for (const arm of armOrder) {
			const armRoot = join(root, arm);
			const workspace = join(armRoot, "workspace");
			const sessionDir = join(armRoot, "sessions");
			await mkdir(workspace, { recursive: true, mode: 0o700 });
			const settingsManager = SettingsManager.inMemory({
				compaction: { enabled: false, agentCallable: false },
				autoRefine: { enabled: false },
				retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 5_000 } },
			});
			const resourceLoader = new DefaultResourceLoader({
				cwd: workspace,
				agentDir: join(root, "neutral-agent"),
				settingsManager,
				extensionFactories: [runtimes[arm].extensionFactory],
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				bundledSkillsDir: null,
			});
			await resourceLoader.reload();
			const sessionManager = SessionManager.create(workspace, sessionDir);
			sessionManager.newSession({ id: PROVIDER_SESSION_ID });
			sessionManager.flushNow();
			assert.equal(sessionManager.getSessionId(), PROVIDER_SESSION_ID);
			const sessionFile = sessionManager.getSessionFile();
			if (!sessionFile) throw new Error("Provider-visibility parity session must be persistent");
			sessionFiles.push(sessionFile);
			const { session } = await createAgentSession({
				cwd: workspace,
				authStorage,
				modelRegistry,
				model,
				thinkingLevel: "off",
				serviceTier: "default",
				settingsManager,
				sessionManager,
				resourceLoader,
				tools: [parityTool.name],
				customTools: [parityTool],
				includeGoals: false,
				includeCompactSkill: false,
			});
			try {
				await session.promptAndWait(USER_PROMPT);
			} finally {
				await session.disposeAsync();
			}
		}
	} finally {
		faux.unregister();
	}
	assert.equal(captures.length, 2);
	assert.equal(sessionFiles.length, 2);
	return {
		captures: captures as unknown as readonly [ProviderCapture, ProviderCapture],
		runtimes,
		sessionFiles: sessionFiles as unknown as readonly [string, string],
	};
}

function mockCodexToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_provider_parity" } }),
		"utf8",
	).toString("base64");
	return `header.${payload}.signature`;
}

function successfulCodexSse(): string {
	return `${[
		`data: ${JSON.stringify({
			type: "response.output_item.added",
			item: { type: "message", id: "msg_provider_parity", role: "assistant", status: "in_progress", content: [] },
		})}`,
		`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "captured" })}`,
		`data: ${JSON.stringify({
			type: "response.output_item.done",
			item: {
				type: "message",
				id: "msg_provider_parity",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "captured" }],
			},
		})}`,
		`data: ${JSON.stringify({
			type: "response.completed",
			response: {
				id: "resp_provider_parity",
				status: "completed",
				usage: {
					input_tokens: 5,
					output_tokens: 1,
					total_tokens: 6,
					input_tokens_details: { cached_tokens: 0 },
				},
			},
		})}`,
	].join("\n\n")}\n\n`;
}

function installCodexTransportMock(captures: CodexTransportCapture[]): void {
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const body = init?.body;
		if (typeof body !== "string") throw new Error("OpenAI Codex transport body must be serialized JSON text");
		captures.push({
			body,
			headers: Object.fromEntries(new Headers(init?.headers).entries()),
			url: input instanceof Request ? input.url : input.toString(),
		});
		return new Response(successfulCodexSse(), {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
}

// This is intentionally composed: a real AgentSession context is captured through Faux, then handed to the
// real Codex serializer. It does not claim one end-to-end SDK session using the live Codex provider registry.
async function serializeCodexRequest(input: {
	capture: ProviderCapture;
	runtime: CompilerGymIrDeltaScreenProviderVisibilityRuntime;
	mutate?: (payload: Record<string, unknown>) => void;
}): Promise<SerializedCodexRequest> {
	const abortController = new AbortController();
	let capturedPayload: Record<string, unknown> | null = null;
	let gate: SerializedCodexRequest["gate"] | null = null;
	const result = await streamOpenAICodexResponses(CODEX_MODEL, input.capture.context, {
		apiKey: mockCodexToken(),
		transport: "sse",
		serviceTier: "priority",
		reasoningEffort: "xhigh",
		reasoningSummary: "auto",
		textVerbosity: "low",
		sessionId: PROVIDER_SESSION_ID,
		maxRetries: 0,
		signal: abortController.signal,
		onPayload: async (payload) => {
			assert.equal(typeof payload, "object");
			assert.notEqual(payload, null);
			assert.equal(Array.isArray(payload), false);
			const actualPayload = structuredClone(payload) as Record<string, unknown>;
			input.mutate?.(actualPayload);
			capturedPayload = actualPayload;
			gate = await input.runtime.providerRequestGate({ payload: actualPayload, providerDispatchOrdinal: 1 });
			if (!gate.allowed) abortController.abort();
			return actualPayload;
		},
	}).result();
	if (capturedPayload === null || gate === null) throw new Error("OpenAI Codex onPayload did not run");
	return { gate, payload: capturedPayload, stopReason: result.stopReason };
}

function providerTrackerFixture(): ProviderBudgetTracker {
	return {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
		apparatusGateFailures: [],
	};
}

async function runBlockedBudgetGate(input: {
	root: string;
	name: string;
	expectedMessage: string;
	gate: StockInterfaceParityProviderRequestGate;
}): Promise<void> {
	const faux = registerFauxProvider({
		provider: `faux-paid-screen-gate-${input.name}-${process.pid}-${input.root.split("/").at(-1)}`,
		models: [{ id: "faux-1", reasoning: false }],
	});
	let responseFactoryCalls = 0;
	faux.setResponses([
		() => {
			responseFactoryCalls++;
			return fauxAssistantMessage("must not cross the apparatus gate");
		},
	]);
	const model = faux.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((registeredModel) => ({
			id: registeredModel.id,
			name: registeredModel.name,
			api: registeredModel.api,
			reasoning: registeredModel.reasoning,
			input: registeredModel.input,
			cost: registeredModel.cost,
			contextWindow: registeredModel.contextWindow,
			maxTokens: registeredModel.maxTokens,
			baseUrl: registeredModel.baseUrl,
		})),
	});
	const tracker = providerTrackerFixture();
	const hostTracker = createHostOwnedTerminalizationRuntimeTracker();
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false, agentCallable: false },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 5_000 } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: input.root,
		agentDir: join(input.root, "agent"),
		settingsManager,
		extensionFactories: [
			createStockInterfaceParityProviderBudgetExtension(tracker, hostTracker, 4, false, input.gate),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: input.root,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: "off",
		serviceTier: "default",
		settingsManager,
		sessionManager: SessionManager.inMemory(input.root),
		resourceLoader,
		tools: [],
		includeGoals: false,
		includeCompactSkill: false,
	});
	try {
		await session.promptAndWait("This provider request must be blocked before transport.");
	} finally {
		await session.disposeAsync();
		faux.unregister();
	}
	assert.equal(faux.state.callCount, 0);
	assert.equal(responseFactoryCalls, 0);
	assert.equal(faux.getPendingResponseCount(), 1);
	assert.equal(tracker.providerCalls, 0);
	assert.equal(tracker.blockedProviderCalls, 1);
	assert.deepEqual(tracker.blockedReasons, ["apparatus-gate"]);
	assert.equal(tracker.apparatusGateFailures?.length, 1);
	assert.match(tracker.apparatusGateFailures?.[0] ?? "", new RegExp(input.expectedMessage));
	assert.equal(hostTracker.providerDispatches, 0);
}

describe("CompilerGym paid-screen provider parity", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		globalThis.fetch = ORIGINAL_FETCH;
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("normalizes the default Prime context across two persistent arm-local sessions and anchors exact Codex bytes", async (t) => {
		t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-29T01:00:00.000Z") });
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-provider-parity-"));
		tempDirs.push(root);
		const fixture = await captureProviderVisibilityPair(root);
		const [control, treatment] = fixture.captures;
		assert.notEqual(fixture.sessionFiles[0], fixture.sessionFiles[1]);
		assert.equal((await stat(fixture.sessionFiles[0])).isFile(), true);
		assert.equal((await stat(fixture.sessionFiles[1])).isFile(), true);
		assert.deepEqual(control.context, treatment.context);
		assert.deepEqual(control.options, treatment.options);
		assert.equal(control.options.sessionId, PROVIDER_SESSION_ID);
		assert.equal(
			control.context.systemPrompt?.startsWith("You are a general purpose agent that uses code to solve tasks."),
			true,
		);
		assert.equal(
			control.context.systemPrompt?.includes(COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE),
			true,
		);
		assert.equal(
			control.context.systemPrompt?.includes(COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG),
			true,
		);
		assert.deepEqual(userText(control.context), [USER_PROMPT]);
		assert.deepEqual(
			control.context.tools?.map((tool) => tool.name),
			[STOCK_INTERFACE_PARITY_TOOL_NAME],
		);
		const providerVisibleJson = JSON.stringify({ context: control.context, options: control.options });
		for (const forbidden of [...COMPILER_GYM_IR_DELTA_SCREEN_ARMS, ...fixture.sessionFiles]) {
			assert.equal(providerVisibleJson.includes(forbidden), false, `provider context retained ${forbidden}`);
		}
		for (const arm of COMPILER_GYM_IR_DELTA_SCREEN_ARMS) {
			const evidence = fixture.runtimes[arm].evidence;
			assert.equal(evidence.systemPromptEvents, 1);
			assert.equal(evidence.workingDirectoryReplacements, 1);
			assert.equal(evidence.conversationLogReplacements, 1);
			assert.equal(evidence.normalizedSystemPromptMatchedPairAnchor, true);
			assert.equal(evidence.normalizedSystemPromptSha256, sha256Text(control.context.systemPrompt ?? ""));
			assert.deepEqual(evidence.failures, []);
		}

		const transportCaptures: CodexTransportCapture[] = [];
		installCodexTransportMock(transportCaptures);
		const controlRequest = await serializeCodexRequest({
			capture: control,
			runtime: fixture.runtimes["hidden-control"],
		});
		const treatmentRequest = await serializeCodexRequest({
			capture: treatment,
			runtime: fixture.runtimes["visible-ir-delta-treatment"],
		});
		assert.deepEqual(controlRequest.gate, { allowed: true, reason: null });
		assert.deepEqual(treatmentRequest.gate, { allowed: true, reason: null });
		assert.equal(controlRequest.stopReason, "stop");
		assert.equal(treatmentRequest.stopReason, "stop");
		assert.deepEqual(controlRequest.payload, treatmentRequest.payload);
		assert.equal(transportCaptures.length, 2);
		assert.equal(transportCaptures[0]?.body, JSON.stringify(controlRequest.payload));
		assert.equal(transportCaptures[1]?.body, transportCaptures[0]?.body);
		assert.deepEqual(transportCaptures[1]?.headers, transportCaptures[0]?.headers);
		const headers = transportCaptures[0]?.headers ?? {};
		assert.deepEqual(Object.keys(headers).sort(), [
			"accept",
			"authorization",
			"chatgpt-account-id",
			"content-type",
			"openai-beta",
			"originator",
			"session_id",
			"user-agent",
			"x-client-request-id",
		]);
		assert.equal(transportCaptures[0]?.url, "https://chatgpt.com/backend-api/codex/responses");
		assert.equal(headers.authorization, `Bearer ${mockCodexToken()}`);
		assert.equal(headers["chatgpt-account-id"], "acc_provider_parity");
		assert.equal(headers.originator, "pi");
		assert.equal(headers["openai-beta"], "responses=experimental");
		assert.equal(headers.accept, "text/event-stream");
		assert.equal(headers["content-type"], "application/json");
		assert.equal(headers.session_id, PROVIDER_SESSION_ID);
		assert.equal(headers["x-client-request-id"], PROVIDER_SESSION_ID);
		assert.match(headers["user-agent"] ?? "", /^pi \(.+\)$/);
		assert.equal(controlRequest.payload.prompt_cache_key, PROVIDER_SESSION_ID);
		assert.deepEqual(controlRequest.payload.include, ["reasoning.encrypted_content"]);
		const serializedTools = controlRequest.payload.tools;
		assert.equal(Array.isArray(serializedTools), true);
		const serializedTool = (serializedTools as Array<Record<string, unknown>>)[0];
		assert.equal(serializedTool?.strict, null);
		assert.deepEqual(serializedTool?.parameters, CompilerGymIrDeltaScreenEvaluationSchema);
		const durableAnchorText = await readFile(join(root, "provider-request-anchor.json"), "utf8");
		const durableAnchor = JSON.parse(durableAnchorText) as Record<string, unknown>;
		const exactRequestBytes = transportCaptures[0]?.body ?? "";
		assert.equal(durableAnchor.firstProviderRequestBody, exactRequestBytes);
		assert.equal(durableAnchor.firstProviderRequestBodySha256, sha256Text(exactRequestBytes));
		assert.equal(
			fixture.runtimes["visible-ir-delta-treatment"].evidence.firstProviderRequestBodyMatchedPairAnchor,
			true,
		);
	});

	it("anchors the same real provider bytes when the treatment arm is randomized first", async (t) => {
		t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-29T01:00:00.000Z") });
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-provider-reversed-"));
		tempDirs.push(root);
		const reversedOrder = ["visible-ir-delta-treatment", "hidden-control"] as const;
		const fixture = await captureProviderVisibilityPair(root, reversedOrder);
		assert.deepEqual(fixture.captures[0].context, fixture.captures[1].context);
		assert.deepEqual(fixture.captures[0].options, fixture.captures[1].options);
		const transportCaptures: CodexTransportCapture[] = [];
		installCodexTransportMock(transportCaptures);
		const firstRequest = await serializeCodexRequest({
			capture: fixture.captures[0],
			runtime: fixture.runtimes[reversedOrder[0]],
		});
		const secondRequest = await serializeCodexRequest({
			capture: fixture.captures[1],
			runtime: fixture.runtimes[reversedOrder[1]],
		});
		assert.deepEqual(firstRequest.gate, { allowed: true, reason: null });
		assert.deepEqual(secondRequest.gate, { allowed: true, reason: null });
		assert.equal(transportCaptures.length, 2);
		assert.equal(transportCaptures[0]?.body, transportCaptures[1]?.body);
		const durableAnchor = JSON.parse(await readFile(join(root, "provider-request-anchor.json"), "utf8")) as Record<
			string,
			unknown
		>;
		assert.equal(durableAnchor.anchorArm, reversedOrder[0]);
		assert.equal(durableAnchor.firstProviderRequestBody, transportCaptures[0]?.body);
		assert.equal(fixture.runtimes[reversedOrder[1]].evidence.firstProviderRequestBodyMatchedPairAnchor, true);
	});

	it("rejects a schema-valid first-request byte mutation before simulated transport", async (t) => {
		t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-29T01:00:00.000Z") });
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-provider-mutation-"));
		tempDirs.push(root);
		const fixture = await captureProviderVisibilityPair(root);
		const transportCaptures: CodexTransportCapture[] = [];
		installCodexTransportMock(transportCaptures);
		const anchorRequest = await serializeCodexRequest({
			capture: fixture.captures[0],
			runtime: fixture.runtimes["hidden-control"],
		});
		assert.equal(anchorRequest.gate.allowed, true);
		assert.equal(transportCaptures.length, 1);
		const mutatedRequest = await serializeCodexRequest({
			capture: fixture.captures[1],
			runtime: fixture.runtimes["visible-ir-delta-treatment"],
			mutate: (payload) => {
				payload.max_output_tokens = 16_383;
			},
		});
		assert.equal(mutatedRequest.gate.allowed, false);
		assert.match(mutatedRequest.gate.reason ?? "", /first provider request (?:bytes|body) differ/);
		assert.equal(mutatedRequest.stopReason, "aborted");
		assert.equal(transportCaptures.length, 1, "mutated request crossed the provider transport boundary");
	});

	it("rejects every paid-screen tool-schema or strictness mutation before provider transport", async (t) => {
		t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-29T01:00:00.000Z") });
		const mutations: Array<{
			name: string;
			expectedFailure: RegExp;
			mutate: (payload: Record<string, unknown>) => void;
		}> = [
			{
				name: "minimum",
				expectedFailure: /tool parameters differ from the frozen paid-screen schema/,
				mutate(payload) {
					serializedActionSchema(payload).minItems = 0;
				},
			},
			{
				name: "maximum",
				expectedFailure: /tool parameters differ from the frozen paid-screen schema/,
				mutate(payload) {
					serializedActionSchema(payload).maxItems = 47;
				},
			},
			{
				name: "nested-key",
				expectedFailure: /tool parameters differ from the frozen paid-screen schema/,
				mutate(payload) {
					serializedActionSchema(payload).uniqueItems = true;
				},
			},
			{
				name: "strictness",
				expectedFailure: /tool strict flag drifted/,
				mutate(payload) {
					serializedTool(payload).strict = true;
				},
			},
		];
		for (const mutation of mutations) {
			const root = await mkdtemp(join(tmpdir(), `prime-ir-delta-provider-${mutation.name}-`));
			tempDirs.push(root);
			const fixture = await captureProviderVisibilityPair(root);
			const transportCaptures: CodexTransportCapture[] = [];
			installCodexTransportMock(transportCaptures);
			const request = await serializeCodexRequest({
				capture: fixture.captures[0],
				runtime: fixture.runtimes[COMPILER_GYM_IR_DELTA_SCREEN_ARMS[0]],
				mutate: mutation.mutate,
			});
			assert.equal(request.gate.allowed, false, mutation.name);
			assert.match(request.gate.reason ?? "", mutation.expectedFailure, mutation.name);
			assert.equal(request.stopReason, "aborted", mutation.name);
			assert.equal(transportCaptures.length, 0, `${mutation.name} mutation crossed provider transport`);
		}
	});

	it("turns thrown and explicit apparatus gates into pre-transport aborts", async () => {
		const testCases: Array<{
			name: string;
			message: string;
			gate: StockInterfaceParityProviderRequestGate;
		}> = [
			{
				name: "throwing",
				message: "synthetic provider parity gate exception",
				gate: async (_input) => {
					throw new Error("synthetic provider parity gate exception");
				},
			},
			{
				name: "rejected",
				message: "synthetic provider parity gate rejection",
				gate: (_input) => ({ allowed: false, reason: "synthetic provider parity gate rejection" }),
			},
		];
		for (const testCase of testCases) {
			const root = await mkdtemp(join(tmpdir(), `prime-ir-delta-budget-${testCase.name}-`));
			tempDirs.push(root);
			await runBlockedBudgetGate({
				root,
				name: testCase.name,
				expectedMessage: testCase.message,
				gate: async (input) => {
					const result = await testCase.gate(input);
					return result;
				},
			});
		}
	});
});

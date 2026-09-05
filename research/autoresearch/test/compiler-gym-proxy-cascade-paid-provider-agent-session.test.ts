import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
	type CompilerGymPaidLiveEnvironmentGateEvidence,
} from "../src/compiler-gym-paid-live-environment-gate.js";
import {
	COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_PAID_TOOL,
	CompilerGymProxyCascadePaidEvaluationSchema,
} from "../src/compiler-gym-proxy-cascade-paid-protocol.js";
import {
	buildCompilerGymProxyCascadePaidProviderSpec,
	COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
	type CompilerGymProxyCascadePaidProviderArm,
	type CompilerGymProxyCascadePaidProviderArmEvidence,
	createCompilerGymProxyCascadePaidProviderGuard,
} from "../src/compiler-gym-proxy-cascade-paid-provider.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "../src/compiler-gym-proxy-cascade-protocol.js";
import { createHostOwnedTerminalizationRuntimeTracker } from "../src/host-owned-terminalization.js";
import type { StockCpuEvaluationRequest } from "../src/stock-cpu-protocol.js";
import {
	captureStockInterfaceParityResolvedModelSnapshot,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
	type RepositorySnapshot,
} from "../src/stock-interface-parity.js";

const ORIGINAL_FETCH = globalThis.fetch;
const PROVIDER_SESSION_ID = "paid-directional-pair";
const PROVIDER_VISIBLE_WORKSPACE = "/prime-agent-autoresearch/isolated-workspace";
const PROVIDER_VISIBLE_CONVERSATION_LOG = "/prime-agent-autoresearch/session.jsonl";
const PROMPT = "Propose one mechanistic LLVM pass-sequence candidate, then call the evaluator exactly once.";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const REQUESTS: readonly StockCpuEvaluationRequest[] = [
	{
		actions: ["-adce", "-instcombine"],
		hypothesis: "Candidate one removes dead instructions before local simplification.",
		mechanism: "Dead-code elimination exposes folds for instruction combining.",
		predictedOutcome: "Lower instruction count on the fixed development task.",
		boundaryConditions: ["Preserve verifier acceptance."],
	},
	{
		actions: ["-simplifycfg", "-dce"],
		hypothesis: "Candidate two simplifies control flow before deleting dead operations.",
		mechanism: "CFG folding makes additional operations unreachable.",
		predictedOutcome: "Lower instruction count than the first candidate on some programs.",
		boundaryConditions: ["May regress code size."],
	},
	{
		actions: ["-sroa", "-instcombine", "-adce"],
		hypothesis: "Candidate three scalarizes aggregates before cleanup.",
		mechanism: "Scalar replacement exposes redundant loads and stores.",
		predictedOutcome: "Lower instruction count when aggregate traffic is present.",
		boundaryConditions: ["Benefit depends on aggregate-heavy IR."],
	},
	{
		actions: ["-mem2reg", "-gvn", "-dce"],
		hypothesis: "Candidate four promotes memory before eliminating redundant values.",
		mechanism: "SSA promotion enables global value numbering and dead-code removal.",
		predictedOutcome: "Lower instruction count on memory-heavy code.",
		boundaryConditions: ["Benefit requires promotable allocas."],
	},
];
const SNAPSHOT: RepositorySnapshot = {
	head: "a".repeat(40),
	coreTreeHashes: { "packages/ai": "b".repeat(64) },
	coreWorktreeStatus: "",
	trackedDiffSha256: "c".repeat(64),
	untrackedFileHashes: {},
	coreWorktreeDigest: "d".repeat(64),
};

interface FetchCapture {
	body: string;
	payload: Record<string, unknown>;
	runIndex: number;
}

interface ArmRun {
	arm: CompilerGymProxyCascadePaidProviderArm;
	events: AgentSessionEvent[];
	providerEvidence: CompilerGymProxyCascadePaidProviderArmEvidence;
	providerTracker: ProviderBudgetTracker;
	hostTracker: ReturnType<typeof createHostOwnedTerminalizationRuntimeTracker>;
	sessionFile: string;
}

const tempDirectories: string[] = [];

afterEach(async () => {
	globalThis.fetch = ORIGINAL_FETCH;
	await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function mockCodexToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_proxy_cascade_test" } }),
		"utf8",
	).toString("base64url");
	return `header.${payload}.signature`;
}

function liveEnvironment(): CompilerGymPaidLiveEnvironmentGateEvidence {
	return {
		protocol: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
		probeSourceSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
		expectedResultSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
		commandSha256: "e".repeat(64),
		stdoutSha256: "f".repeat(64),
		wallMs: 1,
		pass: true,
	};
}

function artifact(seed: string) {
	return { digest: sha256Text(seed), byteLength: Buffer.byteLength(seed), mediaType: "application/json" };
}

function evaluation(input: { benchmarkId: string; ordinal: number; runIndex: number }) {
	const request = REQUESTS[input.ordinal - 1]!;
	const candidateSha256 = sha256Json(request.actions);
	const manifestDigest = sha256Json({
		benchmarkId: input.benchmarkId,
		candidateSha256,
		ordinal: input.ordinal,
		runIndex: input.runIndex,
	});
	const jobId = `job_${manifestDigest.slice(0, 24)}`;
	return {
		candidateOrdinal: input.ordinal,
		benchmarkId: input.benchmarkId,
		submitted: { jobId, manifestDigest, duplicate: false },
		job: {
			jobId,
			manifestDigest,
			candidateSha256,
			state: {
				jobId,
				status: "succeeded",
				statusAt: "2026-08-30T09:00:00.000Z",
				externalJobId: null,
				reason: null,
			},
			measurement: {
				jobId,
				manifestDigest,
				verifierEpoch: "compiler-gym-agent-session-fixture-v1",
				measuredAt: "2026-08-30T09:00:00.000Z",
				tasks: [
					{
						benchmarkId: input.benchmarkId,
						status: "accepted",
						metrics: { IrInstructionCount: 100 + input.ordinal },
						verifier: { passed: true, checks: ["semantic"], errors: [] },
						runtimeMs: 1,
					},
				],
				hardware: { host: "stubbed-no-network-runtime" },
				provenance: { adapter: "canonical-one-task" },
				stdout: artifact(`stdout-${input.runIndex}-${input.ordinal}-${input.benchmarkId}`),
				stderr: null,
			},
		},
	};
}

function envelope(input: { arm: CompilerGymProxyCascadePaidProviderArm; ordinal: number; runIndex: number }) {
	const evaluations = [
		evaluation({
			benchmarkId: COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
			ordinal: input.ordinal,
			runIndex: input.runIndex,
		}),
	];
	if (input.arm === "full-control") {
		evaluations.push(
			evaluation({
				benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
				ordinal: input.ordinal,
				runIndex: input.runIndex,
			}),
		);
	}
	return {
		submissionOrdinal: input.ordinal,
		request: structuredClone(REQUESTS[input.ordinal - 1]!),
		evaluations,
		cascadeSelection: null,
		budget: { completedSubmissions: input.ordinal, maximumSubmissions: 4 },
	};
}

function toolCallSse(request: StockCpuEvaluationRequest, ordinal: number): string {
	const argumentsJson = JSON.stringify(request);
	const functionCall = {
		type: "function_call",
		id: `fc_${ordinal}`,
		call_id: `call_${ordinal}`,
		name: COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.name,
		arguments: argumentsJson,
	};
	const reasoningEvents = Array.from({ length: ordinal === 2 ? 2 : 1 }, (_, index) => {
		const reasoning = {
			type: "reasoning",
			id: `rs_${ordinal}_${index + 1}`,
			content: [],
			encrypted_content: `encrypted-${ordinal}-${index + 1}`,
			summary: [{ type: "summary_text", text: `reasoning ${ordinal}.${index + 1}` }],
		};
		return [
			`data: ${JSON.stringify({ type: "response.output_item.added", item: reasoning })}`,
			`data: ${JSON.stringify({ type: "response.output_item.done", item: reasoning })}`,
		];
	}).flat();
	return `${[
		...reasoningEvents,
		`data: ${JSON.stringify({
			type: "response.output_item.added",
			item: { ...functionCall, arguments: "" },
		})}`,
		`data: ${JSON.stringify({ type: "response.function_call_arguments.delta", delta: argumentsJson })}`,
		`data: ${JSON.stringify({
			type: "response.function_call_arguments.done",
			arguments: argumentsJson,
		})}`,
		`data: ${JSON.stringify({ type: "response.output_item.done", item: functionCall })}`,
		`data: ${JSON.stringify({
			type: "response.completed",
			response: {
				id: `resp_${ordinal}`,
				status: "completed",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					total_tokens: 15,
					input_tokens_details: { cached_tokens: 0 },
				},
			},
		})}`,
	].join("\n\n")}\n\n`;
}

function installNoNetworkCodexTransport(input: {
	activeRunIndex: () => number;
	captures: FetchCapture[];
	invocations: { count: number };
}): void {
	globalThis.fetch = (async (resource: string | URL | Request, init?: RequestInit) => {
		input.invocations.count++;
		const url = resource instanceof Request ? resource.url : resource.toString();
		if (url !== CODEX_RESPONSES_URL) throw new Error(`Unexpected network access in paid-provider test: ${url}`);
		if (typeof init?.body !== "string") throw new Error("Codex request body was not serialized JSON text");
		const runIndex = input.activeRunIndex();
		const prior = input.captures.filter((capture) => capture.runIndex === runIndex).length;
		const ordinal = prior + 1;
		if (ordinal > 4) throw new Error(`Fifth provider transport reached fetch for run ${runIndex}`);
		const payload = JSON.parse(init.body) as Record<string, unknown>;
		input.captures.push({ body: init.body, payload, runIndex });
		const headers = new Headers(init.headers);
		assert.equal(headers.get("authorization"), `Bearer ${mockCodexToken()}`);
		assert.equal(headers.get("chatgpt-account-id"), "acc_proxy_cascade_test");
		return new Response(toolCallSse(REQUESTS[ordinal - 1]!, ordinal), {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
}

async function runArm(input: {
	arm: CompilerGymProxyCascadePaidProviderArm;
	guard: ReturnType<typeof createCompilerGymProxyCascadePaidProviderGuard>;
	root: string;
	runIndex: number;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
}): Promise<ArmRun> {
	const armRoot = join(input.root, `isolated-run-${input.runIndex}`);
	const workspace = join(armRoot, "workspace");
	const sessionDir = join(armRoot, "sessions");
	await Promise.all([
		mkdir(workspace, { recursive: true, mode: 0o700 }),
		mkdir(sessionDir, { recursive: true, mode: 0o700 }),
	]);
	const providerRuntime = input.guard.runtimeForArm(input.arm);
	const providerTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
		apparatusGateFailures: [],
	};
	const hostTracker = createHostOwnedTerminalizationRuntimeTracker();
	let activeSession: AgentSession | null = null;
	let toolOrdinal = 0;
	const tool = defineTool({
		name: COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.name,
		label: "Evaluate CompilerGym Candidate",
		description: COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.description,
		promptSnippet: "autoresearch_evaluate: synchronously evaluate one bounded candidate.",
		promptGuidelines: ["Make exactly four sequential calls and wait for each terminal result."],
		executionMode: "sequential",
		parameters: CompilerGymProxyCascadePaidEvaluationSchema,
		execute: async (_toolCallId, params, signal) => {
			signal?.throwIfAborted();
			toolOrdinal++;
			assert.ok(toolOrdinal >= 1 && toolOrdinal <= 4);
			assert.deepEqual(params, REQUESTS[toolOrdinal - 1]);
			const details = envelope({ arm: input.arm, ordinal: toolOrdinal, runIndex: input.runIndex });
			return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
		},
	});
	const settingsManager = SettingsManager.inMemory({
		transport: "sse",
		compaction: { enabled: false, agentCallable: false, reserveTokens: 4096, keepRecentTokens: 1 },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 5_000 } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: input.guard.spec.agentRegistry.agentDir,
		settingsManager,
		extensionFactories: [
			providerRuntime.extensionFactory,
			createStockInterfaceParityProviderBudgetExtension(
				providerTracker,
				hostTracker,
				4,
				true,
				providerRuntime.providerRequestGate,
				() =>
					captureStockInterfaceParityResolvedModelSnapshot({
						authStorage: input.authStorage,
						modelRegistry: input.modelRegistry,
						session: activeSession,
						provider: "openai-codex",
						modelId: "gpt-5.6-luna",
					}),
				true,
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
	sessionManager.newSession({ id: PROVIDER_SESSION_ID });
	sessionManager.flushNow();
	const model = input.modelRegistry.find("openai-codex", "gpt-5.6-luna");
	if (!model) throw new Error("openai-codex/gpt-5.6-luna is not registered in the test registry");
	const created = await createAgentSession({
		cwd: workspace,
		authStorage: input.authStorage,
		modelRegistry: input.modelRegistry,
		model,
		thinkingLevel: "xhigh",
		serviceTier: "priority",
		settingsManager,
		sessionManager,
		resourceLoader,
		tools: [tool.name],
		customTools: [tool],
		includeGoals: false,
		includeCompactSkill: false,
	});
	activeSession = created.session;
	const sessionFile = created.session.sessionFile;
	if (!sessionFile) throw new Error("Paid provider integration session is not persistent");
	const events: AgentSessionEvent[] = [];
	const unsubscribe = created.session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			providerTracker.outputTokens += event.message.usage.output;
		}
	});
	try {
		await created.session.promptAndWait(PROMPT);
	} catch {
		// The host-owned fifth continuation is intentionally aborted before transport.
	} finally {
		unsubscribe();
		sessionManager.flushNow();
		await created.session.disposeAsync();
	}
	assert.equal(toolOrdinal, 4);
	assert.equal((await stat(sessionFile)).isFile(), true);
	return {
		arm: input.arm,
		events,
		providerEvidence: providerRuntime.evidence,
		providerTracker,
		hostTracker,
		sessionFile,
	};
}

function inputItems(payload: Record<string, unknown>): Array<Record<string, unknown>> {
	assert.ok(Array.isArray(payload.input));
	return payload.input as Array<Record<string, unknown>>;
}

function visibleResults(payload: Record<string, unknown>): Array<Record<string, unknown>> {
	return inputItems(payload).filter((item) => item.type === "function_call_output");
}

describe("CompilerGym proxy-cascade paid provider AgentSession integration", () => {
	it("runs four real Codex-converted tool rounds per arm and blocks the fifth before stubbed transport", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-agent-session-"));
		tempDirectories.push(root);
		const agentDir = join(root, "neutral-agent");
		await mkdir(agentDir, { recursive: true, mode: 0o700 });
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"), { usePrimeCliConfig: false });
		authStorage.set("openai-codex", {
			type: "oauth",
			access: mockCodexToken(),
			refresh: "offline-refresh-token",
			expires: Date.now() + 60 * 60 * 1_000,
			accountId: "acc_proxy_cascade_test",
		});
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		const spec = buildCompilerGymProxyCascadePaidProviderSpec({
			runnerProtocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
			pairId: "compiler-gym-paid-directional-pair-v1",
			arms: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
			prompt: PROMPT,
			tool: COMPILER_GYM_PROXY_CASCADE_PAID_TOOL,
			providerSessionId: PROVIDER_SESSION_ID,
			providerVisibleWorkspace: PROVIDER_VISIBLE_WORKSPACE,
			providerVisibleConversationLog: PROVIDER_VISIBLE_CONVERSATION_LOG,
			agentRegistry: {
				agentDir,
				modelsJsonPath: join(agentDir, "models.json"),
				modelsJsonPresent: false,
			},
		});
		const guard = createCompilerGymProxyCascadePaidProviderGuard({
			spec,
			preregistrationSha256: "9".repeat(64),
			providerRequestAnchorPath: join(root, "provider-request-anchor.json"),
			activeAgentDir: agentDir,
			expectedRuntimeWorktreeSnapshot: SNAPSHOT,
			runtimeWorktreeSnapshotProvider: () => structuredClone(SNAPSHOT),
			liveEnvironmentEvidenceProvider: () => liveEnvironment(),
		});
		const captures: FetchCapture[] = [];
		const invocations = { count: 0 };
		let activeRunIndex = -1;
		installNoNetworkCodexTransport({ activeRunIndex: () => activeRunIndex, captures, invocations });
		const runs: ArmRun[] = [];
		for (const [runIndex, arm] of COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS.entries()) {
			activeRunIndex = runIndex;
			runs.push(await runArm({ arm, guard, root, runIndex, authStorage, modelRegistry }));
		}

		assert.equal(invocations.count, 8);
		assert.equal(captures.length, 8);
		assert.equal(captures.filter((capture) => capture.runIndex === 0).length, 4);
		assert.equal(captures.filter((capture) => capture.runIndex === 1).length, 4);
		assert.equal(captures[0]?.body, captures[4]?.body);
		assert.deepEqual(guard.pairEvidence.completedArms, [...COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS]);
		assert.equal(guard.pairEvidence.failures.length, 0);

		for (const [runIndex, arm] of COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS.entries()) {
			const armCaptures = captures.filter((capture) => capture.runIndex === runIndex);
			assert.deepEqual(
				armCaptures.map((capture) => visibleResults(capture.payload).length),
				[0, 1, 2, 3],
			);
			assert.deepEqual(
				armCaptures.map(
					(capture) => inputItems(capture.payload).filter((item) => item.type === "reasoning").length,
				),
				[0, 1, 3, 4],
			);
			for (const [dispatchIndex, capture] of armCaptures.entries()) {
				for (const result of visibleResults(capture.payload)) {
					assert.equal(typeof result.output, "string");
					const parsed = JSON.parse(result.output as string) as { evaluations: Array<{ benchmarkId: string }> };
					assert.deepEqual(
						parsed.evaluations.map((evaluationRecord) => evaluationRecord.benchmarkId),
						arm === "full-control"
							? [COMPILER_GYM_PROXY_CASCADE_BLOWFISH, COMPILER_GYM_PROXY_CASCADE_BZIP2]
							: [COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					);
				}
				assert.equal(visibleResults(capture.payload).length, dispatchIndex);
			}
		}

		for (const [runIndex, run] of runs.entries()) {
			assert.equal(run.arm, COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS[runIndex]);
			assert.equal(run.providerEvidence.providerRequestAttempts, 4);
			assert.deepEqual(
				run.providerEvidence.historyByDispatch.map((history) => history.observedPriorResultCount),
				[0, 1, 2, 3],
			);
			assert.equal(run.providerEvidence.runtimeWorktreeDispatchAnchors.length, 4);
			assert.equal(run.providerEvidence.liveEnvironmentDispatchAnchors.length, 4);
			assert.equal(run.providerEvidence.providerRequestTranscriptAnchors.length, 4);
			assert.equal(run.providerEvidence.firstProviderRequestBodyMatchedPairAnchor, true);
			assert.deepEqual(run.providerEvidence.failures, []);
			assert.equal(run.providerTracker.providerCalls, 4);
			assert.equal(run.providerTracker.blockedProviderCalls, 0);
			assert.deepEqual(run.providerTracker.blockedReasons, []);
			assert.equal(run.providerTracker.outputTokens, 20);
			assert.equal(run.hostTracker.providerDispatches, 4);
			assert.equal(run.hostTracker.evaluatorToolCalls, 4);
			assert.equal(run.hostTracker.providerDispatchesAtTerminal, 4);
			assert.equal(run.hostTracker.terminalizationStops, 1);
			assert.equal(run.hostTracker.postTerminalProviderDispatches, 0);
			assert.equal(run.hostTracker.postTerminalEvaluatorToolCalls, 0);
			assert.deepEqual(run.hostTracker.forbiddenBoundaryEvents, []);
			const persisted = await readFile(run.sessionFile, "utf8");
			const persistedAssistants = persisted
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as { type?: string; message?: Record<string, unknown> })
				.flatMap((entry) =>
					entry.type === "message" && entry.message?.role === "assistant" ? [entry.message] : [],
				);
			const blocked = persistedAssistants.filter((message) => message.stopReason === "aborted");
			assert.equal(blocked.length, 1);
			assert.equal(blocked[0]?.errorMessage, "Request was aborted");
			assert.deepEqual(blocked[0]?.content, [{ type: "text", text: "" }]);
			assert.deepEqual(blocked[0]?.usage, {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			});
			assert.equal((persisted.match(/"role":"toolResult"/g) ?? []).length, 4);
			assert.equal((persisted.match(/"stopReason":"toolUse"/g) ?? []).length, 4);
			assert.equal((persisted.match(/"stopReason":"aborted"/g) ?? []).length, 1);
			assert.equal(run.events.filter((event) => event.type === "tool_execution_end").length, 4);
		}
	});
});

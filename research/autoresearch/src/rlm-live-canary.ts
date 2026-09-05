import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { type AssistantMessage, Type, type Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	type CreateAgentSessionOptions,
	type CreateRlmSubagentRuntimeOptions,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	estimateTokens,
	findCutPoint,
	getAgentDir,
	getLatestCompactionEntry,
	ModelRegistry,
	type RlmSubagentRuntime,
	SessionManager,
	SettingsManager,
	type SubagentRuntimeHost,
} from "@earendil-works/pi-coding-agent";
import { ResearchController } from "./controller.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	JobView,
	SubmitRequest,
} from "./types.js";

const MODEL_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.6-luna";
const MODEL_SELECTOR = `${MODEL_PROVIDER}/${MODEL_ID}`;
const THINKING_LEVEL = "xhigh";
const SERVICE_TIER = "priority";
const PROVIDER_TIMEOUT_MS = 120_000;
const PROVIDER_WATCHDOG_MS = 135_000;
const RLM_QUIESCENCE_WATCHDOG_MS = 240_000;
const MAX_OUTPUT_TOKENS_PER_RESPONSE = 8_192;
const BENCHMARK_ID = "canary/rlm-child-parent";
const TREATMENT = "rlm-live-canary";
const CANDIDATE_CONTENT = '["-mem2reg"]';
const CHILD_NAME = "rlm-live-canary-child";
const CONTRACT_VERSION = "rlm-live-canary-v1";
const SYSTEM_PROMPT = [
	"You are a strict live integration canary.",
	"Follow every requested tool name, JSON argument, Python cell, ordering constraint, and completion line exactly.",
	"Never call an unrequested tool, never repeat a tool, and never add prose to an exact completion line.",
	"Tool results and agent messages are authoritative evidence; do not invent or alter them.",
].join("\n");
const COMPACTION_INSTRUCTIONS = [
	"Preserve the canary nonce, RLM child ID and depth, child-to-parent receipt, job ID, manifest digest,",
	"terminal measurement, child usage attribution, and the fact that each requested tool and evaluator ran exactly once.",
	"Distinguish admitted, measured, compacted, and reopened state. Do not invent missing evidence.",
].join(" ");

type AgentMessageController = NonNullable<CreateAgentSessionOptions["agentMessageController"]>;
type AgentMessage = NonNullable<Parameters<AgentSession["queueAgentMessagePrompt"]>[2]>;
type ToolStartEvent = Extract<AgentSessionEvent, { type: "tool_execution_start" }>;
type ToolEndEvent = Extract<AgentSessionEvent, { type: "tool_execution_end" }>;

interface ParsedArguments {
	outputDir: string;
}

interface CompactionCut {
	keepRecentTokens: number;
	firstKeptEntryIndex: number;
	firstKeptEntryId: string;
	isSplitTurn: boolean;
	turnStartIndex: number;
}

interface DeliveryEvidence {
	id: string;
	fromSessionId: string;
	toSessionId: string;
	message: string;
	deliveryStatus: "delivered" | "queued";
}

interface RoutedSession {
	session: AgentSession;
	parentSessionId?: string;
	depth: number;
}

interface ChildRecord {
	id: string;
	session: AgentSession;
	sessionDir: string;
	events: AgentSessionEvent[];
	assistantUsages: Usage[];
	unsubscribe: () => void;
}

interface ToolCounters {
	childEvaluate: number;
	status: number;
	recall: number;
}

class DeterministicRlmCanaryAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;
	resumeCalls = 0;

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls++;
		context.signal.throwIfAborted();
		assert.deepEqual(job.benchmarkIds, [BENCHMARK_ID]);
		assert.equal(job.candidateContent, CANDIDATE_CONTENT);
		return deterministicOutcome();
	}

	async resume(): Promise<EvaluationOutcome> {
		this.resumeCalls++;
		throw new Error("A terminal RLM canary job must never enter adapter resume");
	}
}

class InProcessAgentRouter {
	private readonly sessions = new Map<string, RoutedSession>();
	readonly deliveries: DeliveryEvidence[] = [];

	register(session: AgentSession, depth: number, parentSessionId?: string): void {
		assert.equal(this.sessions.has(session.sessionId), false, `Duplicate routed session ${session.sessionId}`);
		this.sessions.set(session.sessionId, { session, depth, parentSessionId });
	}

	unregister(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	controllerFor(current: () => AgentSession): AgentMessageController {
		return {
			listAgents: () => {
				const source = this.require(current().sessionId);
				return {
					current: this.endpoint(source),
					agents: [...this.sessions.values()]
						.filter((entry) => entry.session.sessionId !== source.session.sessionId)
						.map((entry) => ({
							...this.endpoint(entry),
							cwd: entry.session.sessionManager.getCwd(),
							isStreaming: entry.session.isStreaming,
							unfinishedActionCount: entry.session.unfinishedActionCount,
							parentSessionId: entry.parentSessionId,
							rlmDepth: entry.depth,
							status: entry.session.isSessionActive ? ("running" as const) : ("idle" as const),
						})),
				};
			},
			roster: () => {
				const source = this.require(current().sessionId);
				const entries = [...this.sessions.values()]
					.map((target) => ({ target, relationship: this.relationship(source, target) }))
					.filter(
						(value): value is { target: RoutedSession; relationship: "parent" | "child" | "sibling" } =>
							value.relationship !== undefined,
					)
					.map(({ target, relationship }) => ({
						relationship,
						name: target.session.sessionName ?? target.session.sessionId,
						id: target.session.sessionId,
						depth: target.depth,
						status: target.session.isSessionActive ? ("running" as const) : ("idle" as const),
					}));
				return {
					current: {
						name: source.session.sessionName ?? source.session.sessionId,
						id: source.session.sessionId,
						depth: source.depth,
					},
					entries,
				};
			},
			awaitPendingChildPublication: async (selector) => {
				const source = this.require(current().sessionId);
				return [...this.sessions.values()].find(
					(target) =>
						this.relationship(source, target) === "child" &&
						(target.session.sessionId === selector || target.session.sessionName === selector),
				)?.session.sessionId;
			},
			assertSessionNameAvailable: (input) => {
				const conflict = [...this.sessions.values()].some(
					(entry) =>
						entry.depth === input.depth &&
						entry.parentSessionId === input.parentSessionId &&
						entry.session.sessionName === input.name &&
						entry.session.sessionId !== input.ignoreSessionId,
				);
				if (conflict) throw new Error(`Canary agent name is already in use: ${input.name}`);
			},
			setSessionName: (name) => {
				const session = current();
				if (session.sessionName !== name) session.setSessionName(name);
			},
			sendAgentMessage: async (input) => this.send(current().sessionId, input),
		};
	}

	private require(sessionId: string): RoutedSession {
		const entry = this.sessions.get(sessionId);
		if (!entry) throw new Error(`Unknown routed canary session: ${sessionId}`);
		return entry;
	}

	private endpoint(entry: RoutedSession) {
		return {
			activeSessionId: entry.session.sessionId,
			sessionId: entry.session.sessionId,
			sessionName: entry.session.sessionName,
			runtimeKind: entry.depth > 0 ? ("subagent" as const) : ("top-level" as const),
		};
	}

	private relationship(source: RoutedSession, target: RoutedSession): "parent" | "child" | "sibling" | undefined {
		if (source.session.sessionId === target.session.sessionId) return undefined;
		if (source.parentSessionId === target.session.sessionId) return "parent";
		if (target.parentSessionId === source.session.sessionId) return "child";
		if (
			source.depth === target.depth &&
			source.parentSessionId !== undefined &&
			source.parentSessionId === target.parentSessionId
		) {
			return "sibling";
		}
		return undefined;
	}

	private async send(fromSessionId: string, input: Parameters<AgentMessageController["sendAgentMessage"]>[0]) {
		const source = this.require(fromSessionId);
		const target = [...this.sessions.values()].filter(
			(entry) => entry.session.sessionId === input.target || entry.session.sessionName === input.target,
		);
		assert.equal(target.length, 1, `Expected one routed target for ${input.target}`);
		const relationship = this.relationship(source, target[0]);
		assert.ok(relationship, "Canary router forbids non-family delivery");
		if (input.receiverRole !== undefined) assert.equal(input.receiverRole, relationship);

		const id = `agentmsg_${randomUUID()}`;
		const targetEndpoint = this.endpoint(target[0]);
		const sourceEndpoint = this.endpoint(source);
		const fromRelationship = relationship === "parent" ? "child" : relationship === "child" ? "parent" : "sibling";
		const content = [
			`[from ${fromRelationship}:${sourceEndpoint.sessionName ?? sourceEndpoint.sessionId}]`,
			"Agent-to-agent message received.",
			"Source: agent_message",
			`From: ${sourceEndpoint.sessionName ?? sourceEndpoint.sessionId}`,
			`To: ${targetEndpoint.sessionName ?? targetEndpoint.sessionId}`,
			`Message id: ${id}`,
			"",
			input.message,
		].join("\n");
		const customMessage: AgentMessage = {
			role: "custom",
			customType: "agent_message",
			content,
			display: true,
			details: {
				id,
				message: input.message,
				from: sourceEndpoint,
				fromRelationship,
				target: targetEndpoint,
			},
			timestamp: Date.now(),
		};

		const targetBusy =
			target[0].session.isSessionActive ||
			target[0].session.isStreaming ||
			target[0].session.unfinishedActionCount > 0;
		let deliveryStatus: "delivered" | "queued";
		if (targetBusy) {
			assert.equal(await target[0].session.queueAgentMessagePrompt(content, "steer", customMessage), true);
			deliveryStatus = "queued";
		} else {
			await target[0].session.acceptAgentMessagePrompt(content, { customMessage });
			deliveryStatus = "delivered";
		}
		this.deliveries.push({
			id,
			fromSessionId,
			toSessionId: target[0].session.sessionId,
			message: input.message,
			deliveryStatus,
		});
		const at = new Date().toISOString();
		return {
			id,
			source: "agent_message" as const,
			target: targetEndpoint,
			from: sourceEndpoint,
			message: input.message,
			deliveryStatus,
			...(deliveryStatus === "delivered" ? { deliveredAt: at } : { queuedAt: at }),
			deliveryMode: "steer" as const,
		};
	}
}

class InProcessRlmHost implements SubagentRuntimeHost {
	readonly children: ChildRecord[] = [];

	constructor(
		private readonly options: {
			cwd: string;
			agentDir: string;
			authStorage: AuthStorage;
			modelRegistry: ModelRegistry;
			settingsManager: SettingsManager;
			resourceLoader: DefaultResourceLoader;
			router: InProcessAgentRouter;
		},
	) {}

	async createRlmSubagentRuntime(options: CreateRlmSubagentRuntimeOptions): Promise<RlmSubagentRuntime> {
		assert.equal(options.rlmDepth, 1, "Live canary must create exactly one depth-1 child");
		assert.equal(options.rlmMaxDepth, 1, "Live canary must forbid grandchildren");
		assert.equal(options.model.provider, MODEL_PROVIDER);
		assert.equal(options.model.id, MODEL_ID);
		assert.equal(options.thinkingLevel, THINKING_LEVEL);
		assert.equal(options.serviceTier, SERVICE_TIER);
		const parentFile = options.parentSession.sessionFile;
		if (!parentFile) throw new Error("RLM live canary parent is not persistent");

		const childManager = SessionManager.create(this.options.cwd, options.sessionDir);
		childManager.newSession({ parentSession: parentFile, rlmDepth: options.rlmDepth });
		childManager.flushNow();
		let child!: AgentSession;
		const childController = this.options.router.controllerFor(() => child);
		({ session: child } = await createAgentSession({
			cwd: this.options.cwd,
			agentDir: this.options.agentDir,
			authStorage: this.options.authStorage,
			modelRegistry: this.options.modelRegistry,
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			serviceTier: options.serviceTier,
			scopedModels: options.scopedModels,
			settingsManager: this.options.settingsManager,
			sessionManager: childManager,
			resourceLoader: this.options.resourceLoader,
			tools: options.activeToolNames,
			customTools: options.customTools,
			includeGoals: false,
			includeCompactSkill: false,
			agentMessageController: childController,
			rlmDepth: options.rlmDepth,
			rlmMaxDepth: options.rlmMaxDepth,
			rlmSessionDir: options.sessionDir,
			rlmParentNodeId: options.rlmParentNodeId,
			rlmParentAgent: options.parentSession.sessionName ?? options.parentSession.sessionId,
			sessionStartEvent: { type: "session_start", reason: "startup" },
		}));
		if (child.sessionName !== options.sessionName) child.setSessionName(options.sessionName);
		this.options.router.register(child, options.rlmDepth, options.parentSession.sessionId);
		const record: ChildRecord = {
			id: options.id,
			session: child,
			sessionDir: options.sessionDir,
			events: [],
			assistantUsages: [],
			unsubscribe: () => {},
		};
		record.unsubscribe = child.subscribe((event) => {
			record.events.push(event);
			if (event.type === "message_end" && event.message.role === "assistant") {
				record.assistantUsages.push(structuredClone((event.message as AssistantMessage).usage));
			}
		});
		this.children.push(record);
		options.onSessionPublished?.(child);
		return { session: child };
	}

	completeRlmSubagentRuntime(): boolean {
		return true;
	}

	async deleteRlmSubagentRuntime(childId: string, session?: AgentSession): Promise<void> {
		const record = this.children.find((entry) => entry.id === childId);
		if (record) {
			record.unsubscribe();
			this.options.router.unregister(record.session.sessionId);
		}
		await (session ?? record?.session)?.disposeAsync();
	}

	async disposeAll(): Promise<void> {
		await Promise.allSettled(
			this.children.map(async (record) => {
				record.unsubscribe();
				this.options.router.unregister(record.session.sessionId);
				await record.session.disposeAsync();
			}),
		);
	}
}

function parseArguments(argv: readonly string[]): ParsedArguments {
	let outputDir: string | undefined;
	let confirmed = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--confirm-live-luna") {
			confirmed = true;
			continue;
		}
		if (argument === "--output-dir") {
			const value = argv[++index];
			if (!value?.trim()) throw new Error("--output-dir requires a non-empty path");
			outputDir = resolve(value);
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (!confirmed || !outputDir) {
		throw new Error("Usage: npm run autoresearch:rlm-live-canary -- --confirm-live-luna --output-dir <fresh-path>");
	}
	return { outputDir };
}

async function createFreshRunDirectory(outputDir: string): Promise<void> {
	await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 });
	await mkdir(outputDir, { recursive: false, mode: 0o700 });
	await chmod(outputDir, 0o700);
	assert.equal((await stat(outputDir)).mode & 0o777, 0o700);
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(path, 0o600);
}

function createSettings(compactionEnabled: boolean): SettingsManager {
	return SettingsManager.inMemory({
		transport: "sse",
		compaction: {
			enabled: compactionEnabled,
			agentCallable: false,
			reserveTokens: 1024,
			keepRecentTokens: 4096,
		},
		autoRefine: { enabled: false },
		retry: {
			enabled: false,
			maxRetries: 0,
			provider: { timeoutMs: PROVIDER_TIMEOUT_MS, maxRetries: 0, maxRetryDelayMs: 0 },
		},
	});
}

async function createResourceLoader(
	settingsManager: SettingsManager,
	agentDir: string,
	includeAgentMessage: boolean,
): Promise<DefaultResourceLoader> {
	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: !includeAgentMessage,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: SYSTEM_PROMPT,
		skillsOverride: includeAgentMessage
			? (base) => ({
					skills: base.skills.filter((skill) => skill.name === "agent-message"),
					diagnostics: base.diagnostics,
				})
			: undefined,
	});
	await resourceLoader.reload();
	if (includeAgentMessage) {
		assert.deepEqual(
			resourceLoader.getSkills().skills.map((skill) => skill.name),
			["agent-message"],
		);
	}
	return resourceLoader;
}

function requireLunaRuntime() {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const registeredModel = modelRegistry.find(MODEL_PROVIDER, MODEL_ID);
	if (!registeredModel) throw new Error(`${MODEL_SELECTOR} is not registered`);
	if (!modelRegistry.hasConfiguredAuth(registeredModel)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for Prime Agent");
	}
	const model = {
		...registeredModel,
		maxTokens: Math.min(registeredModel.maxTokens, MAX_OUTPUT_TOKENS_PER_RESPONSE),
	};
	return { authStorage, modelRegistry, model };
}

async function openController(
	outputDir: string,
	ledgerPath: string,
	adapter: DeterministicRlmCanaryAdapter,
): Promise<ResearchController> {
	return ResearchController.open({
		ledgerPath,
		artifactDir: join(outputDir, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": [BENCHMARK_ID],
			kernelbench: [],
			nanogpt: [],
		},
		allowedTreatments: [TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: 1,
		maxTaskEvaluationsPerBranch: 1,
	});
}

function submitRequest(branchId: string, nonce: string): SubmitRequest {
	return {
		branchId,
		lane: "compiler-gym",
		benchmarkIds: [BENCHMARK_ID],
		budgetClass: "smoke",
		treatment: TREATMENT,
		proposal: {
			hypothesis: `A live Luna RLM child completes one typed deterministic evaluation ${nonce}`,
			mechanism: "A depth-1 child invokes one host evaluator and explicitly messages its parent",
			predictedOutcome: "One terminal measurement, one parent receipt, and durable attributed child usage",
			boundaryConditions: [CONTRACT_VERSION, "single local deterministic adapter", "no GPU"],
			parentJobIds: [],
		},
		candidate: { format: "llvm-pass-sequence", content: CANDIDATE_CONTENT },
	};
}

function deterministicOutcome(): EvaluationOutcome {
	return {
		verifierEpoch: CONTRACT_VERSION,
		tasks: [
			{
				benchmarkId: BENCHMARK_ID,
				status: "accepted",
				metrics: { IrInstructionCount: 346, ObjectTextSizeBytes: 2048 },
				verifier: { passed: true, checks: ["deterministic-child-round-trip"], errors: [] },
				runtimeMs: 1,
			},
		],
		hardware: { host: "local-rlm-canary", accelerator: "none" },
		provenance: { adapter: "deterministic-rlm-live-canary" },
		stdout: "RLM child canary measurement accepted",
	};
}

function assertTerminalJob(job: JobView, branchId: string): void {
	assert.equal(job.proposal.branchId, branchId);
	assert.equal(job.proposal.lane, "compiler-gym");
	assert.deepEqual(job.proposal.benchmarkIds, [BENCHMARK_ID]);
	assert.equal(job.proposal.treatment, TREATMENT);
	assert.equal(job.state.status, "succeeded");
	assert.ok(job.measurement);
	assert.equal(job.measurement.verifierEpoch, CONTRACT_VERSION);
	assert.deepEqual(job.measurement.tasks, deterministicOutcome().tasks);
}

function createCanaryTools(
	controller: ResearchController,
	input: {
		nonce: string;
		parentSessionId: string;
		parentSessionFile: string;
		parentLaunchComplete: Promise<void>;
		counters: ToolCounters;
	},
) {
	const childEvaluate = defineTool({
		name: "autoresearch_child_canary",
		label: "Evaluate RLM Child Canary",
		description: "Run the one deterministic evaluator job from the depth-1 RLM child.",
		promptSnippet: "autoresearch_child_canary: run the fixed child evaluation exactly once.",
		executionMode: "sequential",
		parameters: Type.Object(
			{ nonce: Type.String({ minLength: 1, maxLength: 128 }) },
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			input.counters.childEvaluate++;
			assert.equal(input.counters.childEvaluate, 1, "Child evaluator tool was called more than once");
			assert.equal(params.nonce, input.nonce);
			assert.equal(ctx.sessionManager.getHeader()?.rlmDepth, 1);
			assert.equal(resolve(ctx.sessionManager.getHeader()?.parentSession ?? ""), resolve(input.parentSessionFile));
			await input.parentLaunchComplete;
			signal?.throwIfAborted();
			const submitted = await controller.submit(submitRequest(input.parentSessionId, input.nonce));
			assert.equal(submitted.duplicate, false);
			await controller.waitForIdle();
			const jobs = controller.statusForBranch(input.parentSessionId, [submitted.jobId]);
			assert.equal(jobs.length, 1);
			assertTerminalJob(jobs[0], input.parentSessionId);
			const details = {
				nonce: input.nonce,
				jobId: submitted.jobId,
				manifestDigest: submitted.manifestDigest,
				status: jobs[0].state.status,
				rlmDepth: ctx.sessionManager.getHeader()?.rlmDepth,
			};
			return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
		},
	});

	const status = defineTool({
		name: "autoresearch_status",
		label: "Read RLM Canary Status",
		description: "Read the exact terminal RLM canary job from the parent branch.",
		promptSnippet: "autoresearch_status: read the exact terminal child job once.",
		executionMode: "sequential",
		parameters: Type.Object(
			{ jobIds: Type.Array(Type.String(), { minItems: 1, maxItems: 1 }) },
			{ additionalProperties: false },
		),
		execute: async (_toolCallId, params) => {
			input.counters.status++;
			assert.equal(input.counters.status, 1, "Status tool was called more than once");
			const jobs = controller.statusForBranch(input.parentSessionId, params.jobIds);
			assert.equal(jobs.length, 1);
			assertTerminalJob(jobs[0], input.parentSessionId);
			const details = { jobs, budget: controller.budgetStatus(input.parentSessionId) };
			return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
		},
	});

	const recall = defineTool({
		name: "autoresearch_recall_child",
		label: "Recall Reopened RLM Canary",
		description: "Recall the terminal child measurement from the reopened durable parent ledger.",
		promptSnippet: "autoresearch_recall_child: prove reopened durable evidence once.",
		executionMode: "sequential",
		parameters: Type.Object({}, { additionalProperties: false }),
		execute: async () => {
			input.counters.recall++;
			assert.equal(input.counters.recall, 1, "Recall tool was called more than once");
			const jobs = controller.statusForBranch(input.parentSessionId);
			assert.equal(jobs.length, 1);
			assertTerminalJob(jobs[0], input.parentSessionId);
			const details = { jobs };
			return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
		},
	});

	return { childEvaluate, status, recall };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolvePromise!: () => void;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
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

function sumUsage(usages: readonly Usage[]): Usage {
	return usages.reduce(addUsage, emptyUsage());
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function assistantMessages(events: readonly AgentSessionEvent[]): AssistantMessage[] {
	return events
		.filter(
			(event): event is Extract<AgentSessionEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		)
		.map((event) => event.message as AssistantMessage);
}

function assertExactToolTurn(
	events: readonly AgentSessionEvent[],
	expectedCalls: ReadonlyArray<{ name: string; args: unknown }>,
	expectedFinalText: string,
): ToolEndEvent[] {
	const starts = events.filter((event): event is ToolStartEvent => event.type === "tool_execution_start");
	const ends = events.filter((event): event is ToolEndEvent => event.type === "tool_execution_end");
	const messages = assistantMessages(events);
	assert.deepEqual(
		messages.map((message) => message.stopReason),
		[...expectedCalls.map(() => "toolUse"), "stop"],
		"Unexpected assistant stop-reason sequence",
	);
	const calls = messages.flatMap((message) => message.content.filter((block) => block.type === "toolCall"));
	assert.deepEqual(
		calls.map((call) => ({ name: call.name, args: call.arguments })),
		expectedCalls,
		"Assistant tool-call sequence changed",
	);
	assert.deepEqual(
		starts.map((event) => ({ name: event.toolName, args: event.args })),
		expectedCalls,
		"Tool-start sequence changed",
	);
	assert.deepEqual(
		ends.map((event) => event.toolName),
		expectedCalls.map((call) => call.name),
		"Tool-end sequence changed",
	);
	for (let index = 0; index < expectedCalls.length; index++) {
		assert.equal(ends[index].toolCallId, starts[index].toolCallId);
		assert.equal(calls[index].id, starts[index].toolCallId);
		assert.equal(ends[index].isError, false, `${ends[index].toolName} returned an error`);
		assert.equal(assistantText(messages[index]), "", "Tool-call assistant message included prose");
	}
	assert.equal(assistantText(messages.at(-1)!), expectedFinalText);
	return ends;
}

function assertToolDetails(event: ToolEndEvent): unknown {
	assert.equal(event.isError, false);
	assert.ok(isRecord(event.result));
	assert.ok(Object.hasOwn(event.result, "details"));
	const content = event.result.content;
	assert.ok(Array.isArray(content) && content.length === 1);
	assert.ok(isRecord(content[0]) && content[0].type === "text" && typeof content[0].text === "string");
	assert.deepEqual(JSON.parse(content[0].text), event.result.details);
	return event.result.details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function promptWithTimeout(session: AgentSession, prompt: string): Promise<void> {
	let watchdogFired = false;
	const watchdog = setTimeout(() => {
		watchdogFired = true;
		session.requestAbort();
	}, PROVIDER_WATCHDOG_MS);
	try {
		await session.promptAndWait(prompt);
	} finally {
		clearTimeout(watchdog);
	}
	if (watchdogFired) throw new Error(`Provider turn exceeded ${PROVIDER_WATCHDOG_MS}ms and was aborted`);
}

async function waitForRlmQuiescenceWithTimeout(session: AgentSession): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			session.waitForRlmQuiescence(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => {
					for (const child of session.getRlmChildSnapshots())
						session.cancelRlmChildRun(child.id, "Canary timeout");
					session.requestAbort();
					reject(new Error(`RLM quiescence exceeded ${RLM_QUIESCENCE_WATCHDOG_MS}ms`));
				}, RLM_QUIESCENCE_WATCHDOG_MS);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function chooseCompactionCut(settingsManager: SettingsManager, sessionManager: SessionManager): CompactionCut {
	const branch = sessionManager.getBranch();
	const userIndices = branch
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => entry.type === "message" && entry.message.role === "user")
		.map(({ index }) => index);
	assert.equal(userIndices.length, 2, "RLM canary requires launch and status user turns before compaction");
	const latestUserIndex = userIndices[1];
	const keepRecentTokens = branch.slice(latestUserIndex).reduce((total, entry) => {
		return entry.type === "message" ? total + estimateTokens(entry.message) : total;
	}, 0);
	assert.ok(keepRecentTokens > 0);
	const cutPoint = findCutPoint(branch, 0, branch.length, keepRecentTokens);
	assert.ok(cutPoint.firstKeptEntryIndex > 0);
	assert.ok(
		cutPoint.firstKeptEntryIndex <= latestUserIndex,
		"Compaction cut must retain the complete status-and-measurement turn",
	);
	if (cutPoint.isSplitTurn) {
		assert.ok(cutPoint.turnStartIndex >= 0 && cutPoint.turnStartIndex < latestUserIndex);
	} else {
		assert.equal(cutPoint.firstKeptEntryIndex, latestUserIndex);
		assert.equal(cutPoint.turnStartIndex, -1);
	}
	const firstKeptEntry = branch[cutPoint.firstKeptEntryIndex];
	assert.ok(firstKeptEntry);
	settingsManager.applyOverrides({ compaction: { keepRecentTokens } });
	return {
		keepRecentTokens,
		firstKeptEntryIndex: cutPoint.firstKeptEntryIndex,
		firstKeptEntryId: firstKeptEntry.id,
		isSplitTurn: cutPoint.isSplitTurn,
		turnStartIndex: cutPoint.turnStartIndex,
	};
}

async function compactWithTimeout(session: AgentSession) {
	let watchdogFired = false;
	const watchdog = setTimeout(() => {
		watchdogFired = true;
		session.requestAbort();
	}, PROVIDER_WATCHDOG_MS);
	try {
		const result = await session.compact(COMPACTION_INSTRUCTIONS);
		if (watchdogFired) throw new Error(`Compaction exceeded ${PROVIDER_WATCHDOG_MS}ms and was aborted`);
		return result;
	} finally {
		clearTimeout(watchdog);
	}
}

function parsePersistedEntries(contents: string): Record<string, unknown>[] {
	return contents
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function persistedToolNames(entries: readonly Record<string, unknown>[]): string[] {
	return entries.flatMap((entry) => {
		if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "toolResult") return [];
		return typeof entry.message.toolName === "string" ? [entry.message.toolName] : [];
	});
}

function rawAssistantUsage(entries: readonly Record<string, unknown>[], targetId: string): Usage {
	const target = entries.find((entry) => entry.id === targetId);
	assert.ok(target && target.type === "message" && isRecord(target.message));
	assert.equal(target.message.role, "assistant");
	assert.ok(isRecord(target.message.usage));
	return target.message.usage as unknown as Usage;
}

async function main(): Promise<void> {
	const { outputDir } = parseArguments(process.argv.slice(2));
	await createFreshRunDirectory(outputDir);
	const startedAt = new Date().toISOString();
	const sessionDir = join(outputDir, "sessions");
	const ledgerPath = join(outputDir, "evidence.jsonl");
	await mkdir(sessionDir, { recursive: false, mode: 0o700 });
	await chmod(sessionDir, 0o700);

	let manifestController: ResearchController | undefined;
	let parentSession: AgentSession | undefined;
	let reopenedSession: AgentSession | undefined;
	let unsubscribeParent: (() => void) | undefined;
	let unsubscribeReopened: (() => void) | undefined;
	let rlmHost: InProcessRlmHost | undefined;
	let parentSessionFile: string | undefined;
	let parentSessionId: string | undefined;
	const parentLaunchGate = deferred();
	const parentEvents: AgentSessionEvent[] = [];
	const reopenedEvents: AgentSessionEvent[] = [];
	const parentAssistantUsages: Usage[] = [];
	const reopenedAssistantUsages: Usage[] = [];
	const counters: ToolCounters = { childEvaluate: 0, status: 0, recall: 0 };

	try {
		const initialAdapter = new DeterministicRlmCanaryAdapter();
		const controller = await openController(outputDir, ledgerPath, initialAdapter);
		manifestController = controller;
		await chmod(ledgerPath, 0o600);

		const runtime = requireLunaRuntime();
		const agentDir = getAgentDir();
		const settingsManager = createSettings(true);
		const resourceLoader = await createResourceLoader(settingsManager, agentDir, true);
		const parentManager = SessionManager.create(process.cwd(), sessionDir);
		parentManager.flushNow();
		parentSessionFile = parentManager.getSessionFile();
		if (!parentSessionFile) throw new Error("RLM live canary parent is not persistent");
		parentSessionId = parentManager.getSessionId();
		await chmod(parentSessionFile, 0o600);

		const nonce = randomUUID();
		const exactTools = createCanaryTools(controller, {
			nonce,
			parentSessionId,
			parentSessionFile,
			parentLaunchComplete: parentLaunchGate.promise,
			counters,
		});
		const router = new InProcessAgentRouter();
		let parent!: AgentSession;
		const parentMessageController = router.controllerFor(() => parent);
		rlmHost = new InProcessRlmHost({
			cwd: process.cwd(),
			agentDir,
			authStorage: runtime.authStorage,
			modelRegistry: runtime.modelRegistry,
			settingsManager,
			resourceLoader,
			router,
		});
		({ session: parent } = await createAgentSession({
			cwd: process.cwd(),
			agentDir,
			authStorage: runtime.authStorage,
			modelRegistry: runtime.modelRegistry,
			model: runtime.model,
			thinkingLevel: THINKING_LEVEL,
			serviceTier: SERVICE_TIER,
			settingsManager,
			sessionManager: parentManager,
			resourceLoader,
			tools: ["ipython", exactTools.childEvaluate.name, exactTools.status.name],
			customTools: [exactTools.childEvaluate, exactTools.status],
			includeGoals: false,
			includeCompactSkill: false,
			agentMessageController: parentMessageController,
			subagentRuntimeHost: rlmHost,
			rlmDepth: 0,
			rlmMaxDepth: 1,
		}));
		parentSession = parent;
		router.register(parent, 0);
		assert.equal(parent.rlmDepth, 0);
		assert.equal(parent.serviceTier, SERVICE_TIER);
		assert.deepEqual(parent.getActiveToolNames().sort(), [
			"autoresearch_child_canary",
			"autoresearch_status",
			"ipython",
		]);
		unsubscribeParent = parent.subscribe((event) => {
			parentEvents.push(event);
			if (event.type === "message_end" && event.message.role === "assistant") {
				parentAssistantUsages.push(structuredClone((event.message as AssistantMessage).usage));
			}
		});

		const startManifest = {
			schemaVersion: 1,
			type: "rlm_live_canary",
			phase: "start",
			contractVersion: CONTRACT_VERSION,
			startedAt,
			outputDir,
			ledgerPath,
			parentSessionId,
			parentSessionFile,
			model: MODEL_SELECTOR,
			thinkingLevel: THINKING_LEVEL,
			requestedServiceTier: SERVICE_TIER,
			providerTimeoutMs: PROVIDER_TIMEOUT_MS,
			agentRetries: 0,
			providerRetries: 0,
			rlmMaxDepth: 1,
		};
		await controller.appendRunManifest(startManifest);
		await writePrivateJson(join(outputDir, "manifest-start.json"), startManifest);

		const childReceiptMessage = `CHILD_COMPLETE ${nonce}\nReply exactly: PARENT_RECEIVED ${nonce}`;
		const childSendCode = [
			`receipt = await agent_message.send(${JSON.stringify(childReceiptMessage)}, receiver_role="parent")`,
			'print(receipt["deliveryStatus"])',
		].join("\n");
		const childPrompt = [
			`Call autoresearch_child_canary exactly once with this exact JSON argument: ${JSON.stringify({ nonce })}.`,
			`After that tool result, call ipython exactly once with this exact JSON argument: ${JSON.stringify({ code: childSendCode })}.`,
			`After the ipython result, reply exactly: CHILD_FINISHED ${nonce}`,
		].join("\n");
		const spawnCode = [
			`handle = await rlm(${JSON.stringify(childPrompt)}, name=${JSON.stringify(CHILD_NAME)}, model=${JSON.stringify(MODEL_SELECTOR)}, thinking=${JSON.stringify(THINKING_LEVEL)})`,
			"print(handle.rlm_child_id)",
			"print(handle.name)",
			"print(handle.model)",
		].join("\n");
		const launchPrompt = [
			`Call ipython exactly once with this exact JSON argument: ${JSON.stringify({ code: spawnCode })}.`,
			`After the tool result, reply exactly: RLM_ADMITTED ${nonce}`,
		].join("\n");
		const launchEventStart = parentEvents.length;
		await promptWithTimeout(parent, launchPrompt);
		assertExactToolTurn(
			parentEvents.slice(launchEventStart),
			[{ name: "ipython", args: { code: spawnCode } }],
			`RLM_ADMITTED ${nonce}`,
		);
		assert.equal(rlmHost.children.length, 1, "Parent admitted an unexpected number of RLM children");
		const childRecord = rlmHost.children[0];
		assert.equal(childRecord.id, basename(childRecord.sessionDir));
		assert.equal(childRecord.session.rlmDepth, 1);
		assert.equal(childRecord.session.model?.provider, MODEL_PROVIDER);
		assert.equal(childRecord.session.model?.id, MODEL_ID);
		assert.equal(childRecord.session.thinkingLevel, THINKING_LEVEL);
		assert.equal(childRecord.session.serviceTier, SERVICE_TIER);
		const childSessionFile = childRecord.session.sessionFile;
		if (!childSessionFile) throw new Error("RLM live canary child is not persistent");
		await chmod(childSessionFile, 0o600);
		assert.equal(childRecord.session.sessionManager.getHeader()?.rlmDepth, 1);
		assert.equal(
			resolve(childRecord.session.sessionManager.getHeader()?.parentSession ?? ""),
			resolve(parentSessionFile),
		);

		const receiptEventStart = parentEvents.length;
		parentLaunchGate.resolve();
		await waitForRlmQuiescenceWithTimeout(parent);
		await controller.waitForIdle();
		assertExactToolTurn(parentEvents.slice(receiptEventStart), [], `PARENT_RECEIVED ${nonce}`);
		const childEnds = assertExactToolTurn(
			childRecord.events,
			[
				{ name: "autoresearch_child_canary", args: { nonce } },
				{ name: "ipython", args: { code: childSendCode } },
			],
			`CHILD_FINISHED ${nonce}`,
		);
		const childToolDetails = assertToolDetails(childEnds[0]);
		assert.ok(isRecord(childToolDetails));
		assert.equal(childToolDetails.rlmDepth, 1);
		assert.equal(counters.childEvaluate, 1);
		assert.equal(initialAdapter.calls, 1);
		assert.equal(initialAdapter.resumeCalls, 0);
		assert.equal(router.deliveries.length, 1);
		assert.deepEqual(router.deliveries[0], {
			id: router.deliveries[0].id,
			fromSessionId: childRecord.session.sessionId,
			toSessionId: parentSessionId,
			message: childReceiptMessage,
			deliveryStatus: "delivered",
		});
		assert.equal(childRecord.session.repliedToParentSinceTask, true);
		assert.equal(
			parent.messages.filter(
				(message) =>
					message.role === "custom" &&
					message.customType === "agent_message" &&
					isRecord(message.details) &&
					message.details.message === childReceiptMessage,
			).length,
			1,
		);
		assert.equal(
			parent.messages.filter(
				(message) =>
					message.role === "custom" &&
					(message.customType === "rlm_child_terminal_notice" || message.customType === "rlm_child_failure"),
			).length,
			0,
			"Explicit child reply must suppress synthesized terminal/failure messages",
		);

		const jobs = controller.statusForBranch(parentSessionId);
		assert.equal(jobs.length, 1);
		assertTerminalJob(jobs[0], parentSessionId);
		assert.equal(childToolDetails.jobId, jobs[0].proposal.jobId);
		assert.equal(childToolDetails.manifestDigest, jobs[0].proposal.manifestDigest);

		const attributions = parentManager.getEntries().filter((entry) => entry.type === "child_usage_attributed");
		assert.equal(childRecord.assistantUsages.length, 3, "Child must produce two tool calls and one final answer");
		assert.equal(attributions.length, childRecord.assistantUsages.length);
		assert.deepEqual(
			attributions.map((entry) => entry.childUsage),
			childRecord.assistantUsages,
			"Persisted child usage does not match child assistant responses",
		);
		assert.deepEqual(
			attributions.map((entry) => entry.origin),
			["spawn_task", "spawn_task", "spawn_task"],
		);
		assert.equal(new Set(attributions.map((entry) => entry.targetId)).size, 1);
		const attributedChildUsage = sumUsage(attributions.map((entry) => entry.childUsage));
		assert.ok(attributedChildUsage.totalTokens > 0);
		const rawBeforeCompaction = parsePersistedEntries(await readFile(parentSessionFile, "utf8"));
		const rawParentUsage = rawAssistantUsage(rawBeforeCompaction, attributions[0].targetId);
		let expectedAggregateUsage = rawParentUsage;
		for (const attribution of attributions) {
			const parentContextTokens =
				expectedAggregateUsage.totalTokens ||
				expectedAggregateUsage.input +
					expectedAggregateUsage.output +
					expectedAggregateUsage.cacheRead +
					expectedAggregateUsage.cacheWrite;
			expectedAggregateUsage = addUsage(expectedAggregateUsage, attribution.childUsage);
			// Child work contributes billable usage and cost, but not model-facing parent context size.
			expectedAggregateUsage.totalTokens = parentContextTokens;
			assert.deepEqual(attribution.aggregateUsage, expectedAggregateUsage);
		}

		parent.setActiveToolsByName(["autoresearch_status"]);
		const statusArguments = { jobIds: [jobs[0].proposal.jobId] };
		const statusEventStart = parentEvents.length;
		await promptWithTimeout(
			parent,
			`Call autoresearch_status exactly once with this exact JSON argument: ${JSON.stringify(statusArguments)}. After the tool result, reply exactly: STATUS_COMPLETE ${nonce}`,
		);
		const statusEnds = assertExactToolTurn(
			parentEvents.slice(statusEventStart),
			[{ name: "autoresearch_status", args: statusArguments }],
			`STATUS_COMPLETE ${nonce}`,
		);
		assertToolDetails(statusEnds[0]);
		assert.equal(counters.status, 1);
		assert.equal(initialAdapter.calls, 1);

		const compactionCut = chooseCompactionCut(settingsManager, parentManager);
		const compactionEventStart = parentEvents.length;
		const compaction = await compactWithTimeout(parent);
		assert.equal(compaction.firstKeptEntryId, compactionCut.firstKeptEntryId);
		const compactionSummaryRequiredMarkers = [nonce, childRecord.id, `PARENT_RECEIVED ${nonce}`];
		for (const marker of compactionSummaryRequiredMarkers) {
			assert.ok(compaction.summary.includes(marker), `Compaction summary omitted required marker: ${marker}`);
		}
		const compactionEvents = parentEvents.slice(compactionEventStart);
		assert.deepEqual(
			compactionEvents.filter((event) => event.type === "compaction_start").map((event) => event.reason),
			["manual"],
		);
		const compactionEnds = compactionEvents.filter(
			(event): event is Extract<AgentSessionEvent, { type: "compaction_end" }> => event.type === "compaction_end",
		);
		assert.equal(compactionEnds.length, 1);
		assert.equal(compactionEnds[0].aborted, false);
		assert.equal(compactionEnds[0].willRetry, false);
		assert.equal(compactionEnds[0].errorMessage, undefined);
		assert.equal(
			getLatestCompactionEntry(parentManager.getBranch())?.firstKeptEntryId,
			compactionCut.firstKeptEntryId,
		);
		controller.verifyLedger();

		unsubscribeParent();
		unsubscribeParent = undefined;
		await parent.disposeAsync();
		parentSession = undefined;

		const restartAdapter = new DeterministicRlmCanaryAdapter();
		const restartedController = await openController(outputDir, ledgerPath, restartAdapter);
		manifestController = restartedController;
		await restartedController.waitForIdle();
		assert.equal(restartAdapter.calls, 0);
		assert.equal(restartAdapter.resumeCalls, 0);
		const duplicateProbe = await restartedController.submit(submitRequest(parentSessionId, nonce));
		assert.equal(duplicateProbe.duplicate, true);
		assert.equal(duplicateProbe.jobId, jobs[0].proposal.jobId);
		await restartedController.waitForIdle();
		assert.equal(restartAdapter.calls, 0, "Durable dedupe probe redispatched the evaluator");
		const restartedJobs = restartedController.statusForBranch(parentSessionId);
		assert.deepEqual(restartedJobs, jobs);

		const reopenedManager = await SessionManager.openAsync(parentSessionFile, sessionDir, process.cwd());
		assert.equal(reopenedManager.getSessionId(), parentSessionId);
		assert.equal(
			getLatestCompactionEntry(reopenedManager.getBranch())?.firstKeptEntryId,
			compactionCut.firstKeptEntryId,
		);
		const reopenedAttributions = reopenedManager
			.getEntries()
			.filter((entry) => entry.type === "child_usage_attributed");
		assert.deepEqual(reopenedAttributions, attributions);
		const reopenedTarget = reopenedManager
			.getEntries()
			.find((entry) => entry.type === "message" && entry.id === attributions[0].targetId);
		assert.ok(reopenedTarget && reopenedTarget.type === "message" && reopenedTarget.message.role === "assistant");
		assert.deepEqual(reopenedTarget.message.usage, attributions.at(-1)?.aggregateUsage);

		const reopenedSettings = createSettings(false);
		const reopenedResourceLoader = await createResourceLoader(reopenedSettings, agentDir, false);
		const reopenedTools = createCanaryTools(restartedController, {
			nonce,
			parentSessionId,
			parentSessionFile,
			parentLaunchComplete: Promise.resolve(),
			counters,
		});
		({ session: reopenedSession } = await createAgentSession({
			cwd: process.cwd(),
			agentDir,
			authStorage: runtime.authStorage,
			modelRegistry: runtime.modelRegistry,
			model: runtime.model,
			thinkingLevel: THINKING_LEVEL,
			serviceTier: SERVICE_TIER,
			settingsManager: reopenedSettings,
			sessionManager: reopenedManager,
			resourceLoader: reopenedResourceLoader,
			tools: [reopenedTools.recall.name],
			customTools: [reopenedTools.recall],
			includeGoals: false,
			includeCompactSkill: false,
			rlmDepth: 0,
			rlmMaxDepth: 1,
		}));
		assert.equal(reopenedSession.sessionId, parentSessionId);
		assert.equal(reopenedSession.sessionFile, parentSessionFile);
		assert.equal(reopenedSession.rlmDepth, 0);
		assert.deepEqual(reopenedSession.getActiveToolNames(), ["autoresearch_recall_child"]);
		const reopenedTree = reopenedSession.getContextTree();
		const persistedChildNode = reopenedTree.children.find((child) => child.id === childRecord.id);
		assert.ok(persistedChildNode, "Reopened context tree omitted the persisted RLM child");
		assert.ok(persistedChildNode.totalUsage.totalTokens > 0);
		unsubscribeReopened = reopenedSession.subscribe((event) => {
			reopenedEvents.push(event);
			if (event.type === "message_end" && event.message.role === "assistant") {
				reopenedAssistantUsages.push(structuredClone((event.message as AssistantMessage).usage));
			}
		});
		const reopenPrompt = `Call autoresearch_recall_child exactly once with {}. After the tool result, reply exactly: REOPEN_COMPLETE ${nonce}`;
		for (const forbidden of [
			jobs[0].proposal.jobId,
			jobs[0].proposal.manifestDigest,
			"IrInstructionCount",
			"ObjectTextSizeBytes",
			"346",
			"2048",
		]) {
			assert.equal(reopenPrompt.includes(forbidden), false, "Reopen prompt leaked durable evidence");
		}
		await promptWithTimeout(reopenedSession, reopenPrompt);
		const recallEnds = assertExactToolTurn(
			reopenedEvents,
			[{ name: "autoresearch_recall_child", args: {} }],
			`REOPEN_COMPLETE ${nonce}`,
		);
		assertToolDetails(recallEnds[0]);
		assert.equal(counters.recall, 1);
		assert.equal(restartAdapter.calls, 0);
		assert.equal(initialAdapter.calls + restartAdapter.calls, 1);

		unsubscribeReopened();
		unsubscribeReopened = undefined;
		await reopenedSession.disposeAsync();
		reopenedSession = undefined;

		const parentPersistedEntries = parsePersistedEntries(await readFile(parentSessionFile, "utf8"));
		const childPersistedEntries = parsePersistedEntries(await readFile(childSessionFile, "utf8"));
		const persistedAgentMessages = parentPersistedEntries.filter(
			(entry) => entry.type === "custom_message" && entry.customType === "agent_message",
		).length;
		assert.deepEqual(persistedToolNames(parentPersistedEntries), [
			"ipython",
			"autoresearch_status",
			"autoresearch_recall_child",
		]);
		assert.deepEqual(persistedToolNames(childPersistedEntries), ["autoresearch_child_canary", "ipython"]);
		assert.equal(parentPersistedEntries.filter((entry) => entry.type === "child_usage_attributed").length, 3);
		assert.equal(parentPersistedEntries.filter((entry) => entry.type === "compaction").length, 1);
		assert.equal(persistedAgentMessages, 1);
		assert.equal((await stat(parentSessionFile)).mode & 0o777, 0o600);
		assert.equal((await stat(childSessionFile)).mode & 0o777, 0o600);
		restartedController.verifyLedger();

		const endedAt = new Date().toISOString();
		const summary = {
			schemaVersion: 1,
			type: "rlm_live_canary",
			phase: "end",
			outcome: "succeeded",
			contractVersion: CONTRACT_VERSION,
			startedAt,
			endedAt,
			outputDir,
			ledgerPath,
			model: MODEL_SELECTOR,
			thinkingLevel: THINKING_LEVEL,
			requestedAndLocallyEffectiveServiceTier: SERVICE_TIER,
			upstreamServiceTierAcknowledgement: "not exposed by current provider response API",
			providerTimeoutMs: PROVIDER_TIMEOUT_MS,
			agentRetries: 0,
			providerRetries: 0,
			parent: { sessionId: parentSessionId, sessionFile: parentSessionFile, rlmDepth: 0 },
			child: {
				rlmChildId: childRecord.id,
				sessionId: childRecord.session.sessionId,
				sessionFile: childSessionFile,
				rlmDepth: 1,
				toolSequence: persistedToolNames(childPersistedEntries),
				assistantResponses: childRecord.assistantUsages.length,
				reopenedContextUsage: persistedChildNode.totalUsage,
			},
			parentReceipt: router.deliveries[0],
			persistedAgentMessages,
			knownUsage: {
				parentAssistant: sumUsage(parentAssistantUsages),
				childAssistant: sumUsage(childRecord.assistantUsages),
				reopenedParentAssistant: sumUsage(reopenedAssistantUsages),
				attributedChild: attributedChildUsage,
			},
			compactionUsageAccounting: "not exposed by current Prime Agent public API",
			childUsageAttributions: attributions.length,
			childUsageOrigin: "spawn_task",
			compaction: {
				...compactionCut,
				summary: compaction.summary,
				requiredMarkers: compactionSummaryRequiredMarkers,
			},
			persistedCompactions: 1,
			parentToolSequence: persistedToolNames(parentPersistedEntries),
			toolCalls: counters,
			adapterDispatches: { beforeRestart: initialAdapter.calls, afterRestart: restartAdapter.calls, total: 1 },
			dedupeProbe: {
				jobId: duplicateProbe.jobId,
				manifestDigest: duplicateProbe.manifestDigest,
				duplicate: duplicateProbe.duplicate,
			},
			job: {
				jobId: restartedJobs[0].proposal.jobId,
				manifestDigest: restartedJobs[0].proposal.manifestDigest,
				status: restartedJobs[0].state.status,
			},
		};
		await restartedController.appendRunManifest(summary);
		restartedController.verifyLedger();
		await writePrivateJson(join(outputDir, "manifest-end.json"), summary);
		await writePrivateJson(join(outputDir, "result.json"), { ok: true, ...summary });
		console.log(JSON.stringify({ ok: true, ...summary }));
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		const failure = {
			schemaVersion: 1,
			type: "rlm_live_canary",
			phase: "failure",
			outcome: "failed",
			contractVersion: CONTRACT_VERSION,
			startedAt,
			failedAt: new Date().toISOString(),
			outputDir,
			ledgerPath,
			parentSessionId: parentSessionId ?? null,
			parentSessionFile: parentSessionFile ?? null,
			model: MODEL_SELECTOR,
			providerTimeoutMs: PROVIDER_TIMEOUT_MS,
			error: message,
		};
		try {
			await manifestController?.appendRunManifest(failure);
			manifestController?.verifyLedger();
			await writePrivateJson(join(outputDir, "manifest-failure.json"), failure);
			await writePrivateJson(join(outputDir, "result.json"), { ok: false, ...failure });
		} catch {
			// Preserve the primary canary failure when evidence recording also fails.
		}
		throw error;
	} finally {
		parentLaunchGate.resolve();
		unsubscribeParent?.();
		unsubscribeReopened?.();
		await Promise.allSettled([
			...(parentSession ? [parentSession.disposeAsync()] : []),
			...(reopenedSession ? [reopenedSession.disposeAsync()] : []),
			...(rlmHost ? [rlmHost.disposeAll()] : []),
		]);
	}
}

await main();

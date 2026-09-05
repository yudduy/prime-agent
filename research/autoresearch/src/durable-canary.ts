import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	estimateTokens,
	findCutPoint,
	getAgentDir,
	getLatestCompactionEntry,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ResearchController } from "./controller.js";
import { createResearchTools } from "./tools.js";
import type { EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome, JobView } from "./types.js";

const MODEL_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.6-luna";
const THINKING_LEVEL = "xhigh";
const SERVICE_TIER = "priority";
const PROVIDER_TIMEOUT_MS = 120_000;
const PROVIDER_WATCHDOG_MS = 135_000;
const MAX_OUTPUT_TOKENS_PER_RESPONSE = 8_192;
const BENCHMARK_ID = "canary/durable-tool-loop";
const TREATMENT = "durable-canary";
const CANDIDATE_CONTENT = '["-mem2reg"]';
const SYSTEM_PROMPT = [
	"You are a strict live integration canary.",
	"Call only the tool named by the user, exactly once, with exactly the supplied arguments.",
	"After its result, return only the exact completion line requested by the user.",
	"Tool results are authoritative; do not invent or alter evidence.",
].join("\n");
const COMPACTION_INSTRUCTIONS =
	"Preserve the benchmark objective, verifier constraints, and distinction between proposed and measured outcomes. Do not invent missing evidence.";
const RECALL_PROMPT =
	"Call autoresearch_recall exactly once with {}. After the tool result, reply exactly: RECALL_COMPLETE";

type ToolStartEvent = Extract<AgentSessionEvent, { type: "tool_execution_start" }>;
type ToolEndEvent = Extract<AgentSessionEvent, { type: "tool_execution_end" }>;

interface WholeTurnCut {
	keepRecentTokens: number;
	firstKeptEntryIndex: number;
	firstKeptEntryId: string;
}

class DeterministicCanaryAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls++;
		context.signal.throwIfAborted();
		assert.deepEqual(job.benchmarkIds, [BENCHMARK_ID]);
		assert.equal(job.candidateContent, CANDIDATE_CONTENT);
		return {
			verifierEpoch: "durable-canary-v1",
			tasks: [
				{
					benchmarkId: BENCHMARK_ID,
					status: "accepted",
					metrics: { IrInstructionCount: 346, ObjectTextSizeBytes: 2048 },
					verifier: { passed: true, checks: ["deterministic-round-trip"], errors: [] },
					runtimeMs: 1,
				},
			],
			hardware: { host: "local-deterministic-canary" },
			provenance: { adapter: "deterministic-durable-canary" },
			stdout: "durable canary measurement accepted",
		};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOutputDir(argv: readonly string[]): string {
	if (argv.length === 0) {
		const stamp = new Date().toISOString().replaceAll(":", "-");
		return resolve(".autoresearch", "durable-canary", `${stamp}-${randomUUID().slice(0, 8)}`);
	}
	if (argv.length === 2 && argv[0] === "--output-dir" && argv[1].trim()) return resolve(argv[1]);
	throw new Error("Usage: npm run autoresearch:durable-canary -- [--output-dir <fresh-path>]");
}

async function createFreshRunDirectory(outputDir: string): Promise<void> {
	await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 });
	await mkdir(outputDir, { recursive: false, mode: 0o700 });
	await chmod(outputDir, 0o700);
	assert.equal((await stat(outputDir)).mode & 0o777, 0o700, "Canary run directory must have mode 0700");
}

async function writeJson(path: string, value: unknown): Promise<void> {
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

async function createResourceLoader(settingsManager: SettingsManager): Promise<DefaultResourceLoader> {
	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
		systemPrompt: SYSTEM_PROMPT,
	});
	await resourceLoader.reload();
	return resourceLoader;
}

function requireLunaRuntime() {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const registeredModel = modelRegistry.find(MODEL_PROVIDER, MODEL_ID);
	if (!registeredModel) throw new Error(`${MODEL_PROVIDER}/${MODEL_ID} is not registered`);
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
	adapter: DeterministicCanaryAdapter,
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

function assistantMessages(events: readonly AgentSessionEvent[]): AssistantMessage[] {
	return events
		.filter(
			(event): event is Extract<AgentSessionEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		)
		.map((event) => event.message as AssistantMessage);
}

function assertToolResultEnvelope(event: ToolEndEvent): unknown {
	assert.equal(event.isError, false, `${event.toolName} returned an error`);
	assert.ok(isRecord(event.result), `${event.toolName} result must be an object`);
	const content = event.result.content;
	assert.ok(Array.isArray(content) && content.length === 1, `${event.toolName} must return one content block`);
	assert.ok(isRecord(content[0]) && content[0].type === "text" && typeof content[0].text === "string");
	assert.ok(Object.hasOwn(event.result, "details"), `${event.toolName} result is missing details`);
	assert.deepEqual(JSON.parse(content[0].text), event.result.details, `${event.toolName} text/details diverged`);
	return event.result.details;
}

function assertExactToolTurn(
	events: readonly AgentSessionEvent[],
	toolName: string,
	expectedArgs: unknown,
	expectedFinalText: string,
): ToolEndEvent {
	const starts = events.filter((event): event is ToolStartEvent => event.type === "tool_execution_start");
	const ends = events.filter((event): event is ToolEndEvent => event.type === "tool_execution_end");
	const messages = assistantMessages(events);
	assert.deepEqual(
		messages.map((message) => message.stopReason),
		["toolUse", "stop"],
		`Unexpected assistant stop-reason sequence for ${toolName}`,
	);
	assert.deepEqual(
		starts.map((event) => event.toolName),
		[toolName],
		`Unexpected tool-start sequence for ${toolName}`,
	);
	assert.deepEqual(
		ends.map((event) => event.toolName),
		[toolName],
		`Unexpected tool-end sequence for ${toolName}`,
	);
	assert.deepEqual(starts[0].args, expectedArgs, `${toolName} arguments changed in transit`);
	assert.equal(ends[0].toolCallId, starts[0].toolCallId, `${toolName} start/end IDs differ`);
	const calls = messages.flatMap((message) => message.content.filter((block) => block.type === "toolCall"));
	assert.deepEqual(
		calls.map((call) => call.name),
		[toolName],
		`Unexpected assistant tool-call sequence for ${toolName}`,
	);
	assert.equal(calls[0].id, starts[0].toolCallId, `${toolName} assistant/event IDs differ`);
	assert.deepEqual(calls[0].arguments, expectedArgs, `${toolName} assistant arguments changed in transit`);
	assert.equal(assistantText(messages.at(-1)!), expectedFinalText, `${toolName} completion line changed`);
	assertToolResultEnvelope(ends[0]);
	return ends[0];
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

function chooseWholeTurnCut(settingsManager: SettingsManager, sessionManager: SessionManager): WholeTurnCut {
	const branch = sessionManager.getBranch();
	const userIndices = branch
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => entry.type === "message" && entry.message.role === "user")
		.map(({ index }) => index);
	assert.equal(userIndices.length, 2, "Durable canary requires exactly two completed pre-compaction turns");
	const latestUserIndex = userIndices[1];
	const keepRecentTokens = branch.slice(latestUserIndex).reduce((total, entry) => {
		return entry.type === "message" ? total + estimateTokens(entry.message) : total;
	}, 0);
	assert.ok(keepRecentTokens > 0, "Latest whole turn must have an estimated token footprint");
	const cutPoint = findCutPoint(branch, 0, branch.length, keepRecentTokens);
	assert.equal(cutPoint.isSplitTurn, false, "Durable canary forbids split-turn compaction");
	assert.equal(cutPoint.firstKeptEntryIndex, latestUserIndex, "Compaction must retain the complete status turn");
	assert.ok(cutPoint.firstKeptEntryIndex > 0, "Compaction must discard at least one earlier turn");
	const firstKeptEntry = branch[cutPoint.firstKeptEntryIndex];
	assert.ok(firstKeptEntry, "Compaction cut has no first retained entry");
	settingsManager.applyOverrides({ compaction: { keepRecentTokens } });
	return {
		keepRecentTokens,
		firstKeptEntryIndex: cutPoint.firstKeptEntryIndex,
		firstKeptEntryId: firstKeptEntry.id,
	};
}

async function compactWithTimeout(session: AgentSession) {
	let watchdogFired = false;
	const timeout = setTimeout(() => {
		watchdogFired = true;
		session.requestAbort();
	}, PROVIDER_WATCHDOG_MS);
	timeout.unref();
	let result: Awaited<ReturnType<AgentSession["compact"]>>;
	try {
		result = await session.compact(COMPACTION_INSTRUCTIONS);
	} finally {
		clearTimeout(timeout);
	}
	if (watchdogFired) throw new Error(`Compaction exceeded ${PROVIDER_WATCHDOG_MS}ms and was aborted`);
	return result;
}

function assertTerminalJob(job: JobView): void {
	assert.equal(job.state.status, "succeeded");
	assert.equal(job.proposal.lane, "compiler-gym");
	assert.deepEqual(job.proposal.benchmarkIds, [BENCHMARK_ID]);
	assert.equal(job.proposal.treatment, TREATMENT);
	assert.ok(job.measurement, "Canary terminal job is missing its measurement");
	assert.equal(job.measurement.verifierEpoch, "durable-canary-v1");
	assert.deepEqual(job.measurement.tasks, [
		{
			benchmarkId: BENCHMARK_ID,
			status: "accepted",
			metrics: { IrInstructionCount: 346, ObjectTextSizeBytes: 2048 },
			verifier: { passed: true, checks: ["deterministic-round-trip"], errors: [] },
			runtimeMs: 1,
		},
	]);
}

function parsePersistedSession(contents: string): unknown[] {
	return contents
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as unknown);
}

function persistedToolResults(entries: readonly unknown[]): Record<string, unknown>[] {
	return entries.filter((entry): entry is Record<string, unknown> => {
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return false;
		return entry.message.role === "toolResult";
	});
}

function persistedToolName(entry: Record<string, unknown>): string {
	assert.ok(isRecord(entry.message) && typeof entry.message.toolName === "string");
	return entry.message.toolName;
}

async function main(): Promise<void> {
	const outputDir = parseOutputDir(process.argv.slice(2));
	await createFreshRunDirectory(outputDir);
	const startedAt = new Date().toISOString();
	const sessionDir = join(outputDir, "sessions");
	const ledgerPath = join(outputDir, "evidence.jsonl");
	await mkdir(sessionDir, { recursive: false, mode: 0o700 });
	await chmod(sessionDir, 0o700);

	let manifestController: ResearchController | undefined;
	let initialSession: AgentSession | undefined;
	let restartedSession: AgentSession | undefined;
	let unsubscribeInitial: (() => void) | undefined;
	let unsubscribeRestarted: (() => void) | undefined;
	let sessionFile: string | undefined;
	let sessionId: string | undefined;
	const usages: Usage[] = [];

	try {
		const initialAdapter = new DeterministicCanaryAdapter();
		const controller = await openController(outputDir, ledgerPath, initialAdapter);
		manifestController = controller;
		await chmod(ledgerPath, 0o600);

		const initialRuntime = requireLunaRuntime();
		const initialSettings = createSettings(true);
		const initialResourceLoader = await createResourceLoader(initialSettings);
		const initialManager = SessionManager.create(process.cwd(), sessionDir);
		initialManager.flushNow();
		const initialTools = createResearchTools(controller, {
			enableRecall: false,
			enableCompare: false,
			submitScope: {
				lane: "compiler-gym",
				benchmarkIds: [BENCHMARK_ID],
				budgetClass: "smoke",
				treatment: TREATMENT,
			},
		}).filter((tool) => tool.name === "autoresearch_submit" || tool.name === "autoresearch_status");
		({ session: initialSession } = await createAgentSession({
			cwd: process.cwd(),
			authStorage: initialRuntime.authStorage,
			modelRegistry: initialRuntime.modelRegistry,
			model: initialRuntime.model,
			thinkingLevel: THINKING_LEVEL,
			serviceTier: SERVICE_TIER,
			settingsManager: initialSettings,
			sessionManager: initialManager,
			resourceLoader: initialResourceLoader,
			tools: initialTools.map((tool) => tool.name),
			customTools: initialTools,
			includeGoals: false,
			includeCompactSkill: false,
		}));
		sessionFile = initialSession.sessionFile;
		if (!sessionFile) throw new Error("Durable canary session is not persistent");
		sessionId = initialSession.sessionId;
		await chmod(sessionFile, 0o600);
		assert.deepEqual(initialSession.getActiveToolNames().sort(), ["autoresearch_status", "autoresearch_submit"]);
		assert.equal(initialSession.serviceTier, SERVICE_TIER);

		const initialEvents: AgentSessionEvent[] = [];
		unsubscribeInitial = initialSession.subscribe((event) => {
			initialEvents.push(event);
			if (event.type === "message_end" && event.message.role === "assistant") {
				usages.push(structuredClone((event.message as AssistantMessage).usage));
			}
		});

		const startManifest = {
			schemaVersion: 1,
			type: "durable_canary",
			phase: "start",
			startedAt,
			outputDir,
			ledgerPath,
			sessionId,
			sessionFile,
			model: `${MODEL_PROVIDER}/${MODEL_ID}`,
			thinkingLevel: THINKING_LEVEL,
			requestedServiceTier: SERVICE_TIER,
			providerTimeoutMs: PROVIDER_TIMEOUT_MS,
			agentRetries: 0,
			providerRetries: 0,
			transport: "sse",
		};
		await controller.appendRunManifest(startManifest);
		await writeJson(join(outputDir, "manifest-start.json"), startManifest);

		const submitArguments = {
			proposal: {
				hypothesis: "A typed tool round trip produces one durable deterministic measurement",
				mechanism: "The server-scoped submit tool dispatches one deterministic evaluator job",
				predictedOutcome: "Exactly one accepted job and one persisted measurement",
				boundaryConditions: ["durable canary only", "single deterministic adapter"],
				parentJobIds: [],
			},
			candidate: { format: "llvm-pass-sequence" as const, content: CANDIDATE_CONTENT },
		};
		const submitEventStart = initialEvents.length;
		await promptWithTimeout(
			initialSession,
			`Call autoresearch_submit exactly once with this exact JSON argument: ${JSON.stringify(submitArguments)}. After the tool result, reply exactly: SUBMIT_COMPLETE`,
		);
		const submitEnd = assertExactToolTurn(
			initialEvents.slice(submitEventStart),
			"autoresearch_submit",
			submitArguments,
			"SUBMIT_COMPLETE",
		);
		await controller.waitForIdle();
		assert.equal(initialAdapter.calls, 1, "Initial controller must dispatch exactly one evaluator job");
		const jobs = controller.statusForBranch(sessionId);
		assert.equal(jobs.length, 1, "Submit turn must create exactly one job");
		assertTerminalJob(jobs[0]);
		const submitDetails = assertToolResultEnvelope(submitEnd);
		assert.ok(isRecord(submitDetails), "Submit details must be an object");
		assert.equal(submitDetails.jobId, jobs[0].proposal.jobId);
		assert.equal(submitDetails.manifestDigest, jobs[0].proposal.manifestDigest);
		assert.equal(submitDetails.duplicate, false);
		assert.ok(
			typeof submitDetails.acceptedAt === "string" && Number.isFinite(Date.parse(submitDetails.acceptedAt)),
			"Submit details must include a valid acceptedAt timestamp",
		);

		const statusArguments = { jobIds: [jobs[0].proposal.jobId] };
		const expectedStatusDetails = {
			jobs: controller.statusForBranch(sessionId, statusArguments.jobIds),
			budget: controller.budgetStatus(sessionId),
		};
		const statusEventStart = initialEvents.length;
		await promptWithTimeout(
			initialSession,
			`The host has waited for the submitted job to become terminal. Call autoresearch_status exactly once with this exact JSON argument: ${JSON.stringify(statusArguments)}. After the tool result, reply exactly: STATUS_CHECKPOINT_COMPLETE`,
		);
		const statusEnd = assertExactToolTurn(
			initialEvents.slice(statusEventStart),
			"autoresearch_status",
			statusArguments,
			"STATUS_CHECKPOINT_COMPLETE",
		);
		assert.deepEqual(
			assertToolResultEnvelope(statusEnd),
			expectedStatusDetails,
			"Status checkpoint must exactly match terminal controller state",
		);

		const wholeTurnCut = chooseWholeTurnCut(initialSettings, initialManager);
		const compactionEventStart = initialEvents.length;
		const compaction = await compactWithTimeout(initialSession);
		assert.equal(compaction.firstKeptEntryId, wholeTurnCut.firstKeptEntryId);
		assert.ok(compaction.summary.trim().length > 0, "Compaction summary is empty");
		const compactionEvents = initialEvents.slice(compactionEventStart);
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
		assert.equal(compactionEnds[0].result?.firstKeptEntryId, wholeTurnCut.firstKeptEntryId);
		assert.equal(
			getLatestCompactionEntry(initialManager.getBranch())?.firstKeptEntryId,
			wholeTurnCut.firstKeptEntryId,
		);
		controller.verifyLedger();

		unsubscribeInitial();
		unsubscribeInitial = undefined;
		await initialSession.disposeAsync();
		initialSession = undefined;

		const restartAdapter = new DeterministicCanaryAdapter();
		const restartedController = await openController(outputDir, ledgerPath, restartAdapter);
		manifestController = restartedController;
		await restartedController.waitForIdle();
		assert.equal(restartAdapter.calls, 0, "Reopening a terminal ledger must not redispatch the evaluator job");
		assert.equal(initialAdapter.calls + restartAdapter.calls, 1, "Durable restart caused a duplicate dispatch");
		const restartedJobs = restartedController.statusForBranch(sessionId);
		assert.equal(restartedJobs.length, 1);
		assertTerminalJob(restartedJobs[0]);
		assert.deepEqual(restartedJobs, jobs, "Reopened controller state diverged from the durable ledger");

		const restartedManager = await SessionManager.openAsync(sessionFile, sessionDir, process.cwd());
		assert.equal(restartedManager.getSessionId(), sessionId, "Session ID changed across restart");
		assert.equal(
			getLatestCompactionEntry(restartedManager.getBranch())?.firstKeptEntryId,
			wholeTurnCut.firstKeptEntryId,
			"Reopened SessionManager did not recover the compaction entry",
		);

		const restartedRuntime = requireLunaRuntime();
		const restartedSettings = createSettings(false);
		const restartedResourceLoader = await createResourceLoader(restartedSettings);
		const recallTools = createResearchTools(restartedController, {
			enableRecall: true,
			enableCompare: false,
		}).filter((tool) => tool.name === "autoresearch_recall");
		assert.deepEqual(
			recallTools.map((tool) => tool.name),
			["autoresearch_recall"],
		);
		({ session: restartedSession } = await createAgentSession({
			cwd: process.cwd(),
			authStorage: restartedRuntime.authStorage,
			modelRegistry: restartedRuntime.modelRegistry,
			model: restartedRuntime.model,
			thinkingLevel: THINKING_LEVEL,
			serviceTier: SERVICE_TIER,
			settingsManager: restartedSettings,
			sessionManager: restartedManager,
			resourceLoader: restartedResourceLoader,
			tools: recallTools.map((tool) => tool.name),
			customTools: recallTools,
			includeGoals: false,
			includeCompactSkill: false,
		}));
		assert.equal(restartedSession.sessionId, sessionId);
		assert.equal(restartedSession.sessionFile, sessionFile);
		assert.deepEqual(restartedSession.getActiveToolNames(), ["autoresearch_recall"]);

		for (const forbidden of [
			jobs[0].proposal.jobId,
			jobs[0].proposal.manifestDigest,
			"IrInstructionCount",
			"ObjectTextSizeBytes",
			"346",
			"2048",
		]) {
			assert.equal(RECALL_PROMPT.includes(forbidden), false, "Recall prompt leaked durable evidence");
		}
		const expectedRecallDetails = structuredClone(restartedController.recall(sessionId));
		assert.deepEqual(expectedRecallDetails, restartedJobs);
		const restartedEvents: AgentSessionEvent[] = [];
		unsubscribeRestarted = restartedSession.subscribe((event) => {
			restartedEvents.push(event);
			if (event.type === "message_end" && event.message.role === "assistant") {
				usages.push(structuredClone((event.message as AssistantMessage).usage));
			}
		});
		const recallEventStart = restartedEvents.length;
		await promptWithTimeout(restartedSession, RECALL_PROMPT);
		const recallEnd = assertExactToolTurn(
			restartedEvents.slice(recallEventStart),
			"autoresearch_recall",
			{},
			"RECALL_COMPLETE",
		);
		assert.deepEqual(
			assertToolResultEnvelope(recallEnd),
			expectedRecallDetails,
			"Turn-scoped recall result.details must exactly match the reopened ledger",
		);
		assert.equal(restartAdapter.calls, 0, "Recall must not dispatch an evaluator job");
		assert.equal(initialAdapter.calls + restartAdapter.calls, 1, "Recall caused a duplicate dispatch");

		unsubscribeRestarted();
		unsubscribeRestarted = undefined;
		await restartedSession.disposeAsync();
		restartedSession = undefined;

		const persistedContents = await readFile(sessionFile, "utf8");
		const persistedEntries = parsePersistedSession(persistedContents);
		const toolResults = persistedToolResults(persistedEntries);
		assert.deepEqual(
			toolResults.map(persistedToolName),
			["autoresearch_submit", "autoresearch_status", "autoresearch_recall"],
			"Persisted JSONL tool-result sequence is incomplete or reordered",
		);
		const persistedCompactions = persistedEntries.filter(
			(entry): entry is Record<string, unknown> => isRecord(entry) && entry.type === "compaction",
		);
		assert.equal(persistedCompactions.length, 1, "Persisted JSONL must contain exactly one compaction");
		assert.equal(persistedCompactions[0].firstKeptEntryId, wholeTurnCut.firstKeptEntryId);
		const persistedRecall = toolResults.at(-1);
		assert.ok(persistedRecall && isRecord(persistedRecall.message));
		assert.deepEqual(
			persistedRecall.message.details,
			expectedRecallDetails,
			"Persisted recall details diverged from the reopened ledger",
		);
		assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
		restartedController.verifyLedger();

		const endedAt = new Date().toISOString();
		const summary = {
			schemaVersion: 1,
			type: "durable_canary",
			phase: "end",
			outcome: "succeeded",
			startedAt,
			endedAt,
			outputDir,
			ledgerPath,
			sessionId,
			sessionFile,
			model: `${MODEL_PROVIDER}/${MODEL_ID}`,
			thinkingLevel: THINKING_LEVEL,
			requestedAndLocallyEffectiveServiceTier: SERVICE_TIER,
			upstreamServiceTierAcknowledgement: "not exposed by current provider response API",
			providerTimeoutMs: PROVIDER_TIMEOUT_MS,
			agentRetries: 0,
			providerRetries: 0,
			knownAssistantUsage: sumUsage(usages),
			compactionUsageAccounting: "not exposed by current Prime Agent public API",
			compaction: wholeTurnCut,
			adapterDispatches: { beforeRestart: initialAdapter.calls, afterRestart: restartAdapter.calls, total: 1 },
			toolResultSequence: toolResults.map(persistedToolName),
			persistedCompactions: persistedCompactions.length,
			job: {
				jobId: restartedJobs[0].proposal.jobId,
				manifestDigest: restartedJobs[0].proposal.manifestDigest,
				status: restartedJobs[0].state.status,
			},
		};
		await restartedController.appendRunManifest(summary);
		restartedController.verifyLedger();
		await writeJson(join(outputDir, "manifest-end.json"), summary);
		await writeJson(join(outputDir, "result.json"), { ok: true, ...summary });
		console.log(JSON.stringify({ ok: true, ...summary }));
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		const failureManifest = {
			schemaVersion: 1,
			type: "durable_canary",
			phase: "failure",
			outcome: "failed",
			startedAt,
			failedAt: new Date().toISOString(),
			outputDir,
			ledgerPath,
			sessionId: sessionId ?? null,
			sessionFile: sessionFile ?? null,
			model: `${MODEL_PROVIDER}/${MODEL_ID}`,
			providerTimeoutMs: PROVIDER_TIMEOUT_MS,
			agentRetries: 0,
			providerRetries: 0,
			error: message,
		};
		try {
			await manifestController?.appendRunManifest(failureManifest);
			manifestController?.verifyLedger();
		} catch {
			// Preserve the primary canary error when failure-ledger recording also fails.
		}
		try {
			await writeJson(join(outputDir, "manifest-failure.json"), failureManifest);
			await writeJson(join(outputDir, "result.json"), { ok: false, ...failureManifest });
		} catch {
			// Preserve the primary canary error when failure-file recording also fails.
		}
		throw error;
	} finally {
		unsubscribeInitial?.();
		unsubscribeRestarted?.();
		await Promise.allSettled([
			...(initialSession ? [initialSession.disposeAsync()] : []),
			...(restartedSession ? [restartedSession.disposeAsync()] : []),
		]);
	}
}

await main();

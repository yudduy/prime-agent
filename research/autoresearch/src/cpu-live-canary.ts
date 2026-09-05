import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { type AssistantMessage, Type, type Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	type SessionStats,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG, FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";
import type { BranchBudgetStatus, JobView, SubmitResult } from "./types.js";

const TASK_ID = "benchmark://cbench-v1/blowfish";
const TREATMENT = "live-cpu-canary";
const CANDIDATE_CONTENT = JSON.stringify(["-mem2reg"]);
const PROVIDER_TIMEOUT_MS = 120_000;
const PROVIDER_WATCHDOG_MS = 135_000;
const EVALUATOR_WATCHDOG_MS = 420_000;
const MAX_OUTPUT_TOKENS_PER_RESPONSE = 8_192;
const PROMPT_PROTOCOL_VERSION = "compiler-gym-cpu-live-canary-v1";

const SubmitSchema = Type.Object({}, { additionalProperties: false });
const StatusSchema = Type.Object(
	{
		jobIds: Type.Array(Type.String(), { minItems: 1, maxItems: 1 }),
	},
	{ additionalProperties: false },
);

interface LiveResult {
	sessionId: string;
	sessionFile: string;
	sessionStats: SessionStats;
	knownUsage: Usage;
	submitPromptSha256: string;
	statusPromptSha256: string;
	submit: SubmitResult;
	job: JobView;
	budget: BranchBudgetStatus;
}

function parseOutputDir(argv: readonly string[]): string {
	if (argv.length === 2 && argv[0] === "--output-dir" && argv[1]) return resolve(argv[1]);
	throw new Error("Usage: npm run autoresearch:cpu-live-canary -- --output-dir <fresh-path>");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonSafe(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
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

function toolResult<T>(details: T): {
	content: Array<{ type: "text"; text: string }>;
	details: T;
	terminate: true;
} {
	return {
		content: [{ type: "text", text: JSON.stringify(details) }],
		details,
		terminate: true,
	};
}

function createCanaryTools(controller: ResearchController) {
	const submit = defineTool({
		name: "autoresearch_submit",
		label: "Submit Fixed CPU Canary",
		description: "Submit the server-scoped blowfish mem2reg canary exactly once.",
		promptSnippet: "autoresearch_submit: dispatch the fixed blowfish mem2reg canary.",
		executionMode: "sequential",
		parameters: SubmitSchema,
		execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) =>
			toolResult(
				await controller.submit({
					branchId: ctx.sessionManager.getSessionId(),
					lane: "compiler-gym",
					benchmarkIds: [TASK_ID],
					budgetClass: "smoke",
					treatment: TREATMENT,
					proposal: {
						hypothesis: "Promoting stack allocations to SSA form reduces raw LLVM IR instruction count",
						mechanism: "The LLVM mem2reg pass removes eligible loads, stores, and allocas",
						predictedOutcome: "blowfish passes semantic validation with fewer IR instructions than its input",
						boundaryConditions: ["CompilerGym 0.2.5", "LLVM 10", "fixed FarmShare CPU SKU"],
						parentJobIds: [],
					},
					candidate: { format: "llvm-pass-sequence", content: CANDIDATE_CONTENT },
				}),
			),
	});

	const status = defineTool({
		name: "autoresearch_status",
		label: "Read CPU Canary Status",
		description: "Read the authoritative branch-local result for the submitted canary.",
		promptSnippet: "autoresearch_status: read the exact submitted job after the host evaluator finishes.",
		executionMode: "sequential",
		parameters: StatusSchema,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
			toolResult({
				jobs: controller.statusForBranch(ctx.sessionManager.getSessionId(), params.jobIds),
				budget: controller.budgetStatus(ctx.sessionManager.getSessionId()),
			}),
	});

	return [submit, status];
}

async function promptWithWatchdog(session: AgentSession, prompt: string): Promise<void> {
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

async function waitForEvaluator(controller: ResearchController): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			controller.waitForIdle(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Evaluator wait exceeded ${EVALUATOR_WATCHDOG_MS}ms`)),
					EVALUATOR_WATCHDOG_MS,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function exactToolDetails(
	events: readonly AgentSessionEvent[],
	toolName: string,
	expectedArguments: Record<string, unknown>,
): unknown {
	const assistantEnds = events.filter(
		(event): event is Extract<AgentSessionEvent, { type: "message_end" }> =>
			event.type === "message_end" && event.message.role === "assistant",
	);
	assert.equal(assistantEnds.length, 1, "A canary turn must produce exactly one assistant response");
	const assistant = assistantEnds[0].message as AssistantMessage;
	assert.equal(
		assistant.stopReason,
		"toolUse",
		assistant.errorMessage ?? `Unexpected stop reason: ${assistant.stopReason}`,
	);
	const calls = assistant.content.filter((block) => block.type === "toolCall");
	assert.equal(calls.length, 1, "A canary turn must request exactly one tool call");
	assert.equal(calls[0].name, toolName);
	assert.deepEqual(calls[0].arguments, expectedArguments);
	const prose = assistant.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
	assert.equal(prose, "", "A canary tool-call response must not include prose");

	const starts = events.filter((event) => event.type === "tool_execution_start");
	const ends = events.filter((event) => event.type === "tool_execution_end");
	assert.equal(starts.length, 1, "A canary turn must start exactly one tool execution");
	assert.equal(ends.length, 1, "A canary turn must finish exactly one tool execution");
	assert.equal(starts[0].toolName, toolName);
	assert.deepEqual(starts[0].args, expectedArguments);
	assert.equal(ends[0].toolName, toolName);
	assert.equal(ends[0].toolCallId, starts[0].toolCallId);
	assert.equal(ends[0].toolCallId, calls[0].id);
	assert.equal(ends[0].isError, false);
	assert.ok(isRecord(ends[0].result), "Tool result envelope is missing");
	assert.equal(ends[0].result.terminate, true, "Canary tools must terminate without another provider response");
	return ends[0].result.details;
}

function parseSubmitDetails(value: unknown): SubmitResult {
	assert.ok(isRecord(value), "Submit tool details must be an object");
	assert.match(String(value.jobId), /^job_[a-f0-9]{24}$/);
	assert.match(String(value.manifestDigest), /^[a-f0-9]{64}$/);
	assert.equal(typeof value.acceptedAt, "string");
	assert.equal(value.duplicate, false);
	return {
		jobId: String(value.jobId),
		acceptedAt: String(value.acceptedAt),
		manifestDigest: String(value.manifestDigest),
		duplicate: false,
	};
}

function validateSuccessfulJob(job: JobView, expectedJobId: string): void {
	assert.equal(job.proposal.jobId, expectedJobId);
	assert.equal(job.proposal.branchId.trim().length > 0, true);
	assert.equal(job.proposal.lane, "compiler-gym");
	assert.deepEqual(job.proposal.benchmarkIds, [TASK_ID]);
	assert.equal(job.proposal.treatment, TREATMENT);
	assert.equal(job.state.status, "succeeded");
	assert.ok(job.measurement, "Succeeded canary job is missing its measurement");
	assert.equal(job.measurement.tasks.length, 1);
	const task = job.measurement.tasks[0];
	assert.equal(task.benchmarkId, TASK_ID);
	assert.equal(task.status, "accepted");
	assert.equal(task.verifier.passed, true);
	assert.equal(Number.isFinite(task.metrics.IrInstructionCount), true);
}

async function runLiveSession(controller: ResearchController, sessionDir: string): Promise<LiveResult> {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const registeredModel = modelRegistry.find(FROZEN_CAMPAIGN.model.provider, FROZEN_CAMPAIGN.model.id);
	if (!registeredModel) throw new Error("openai-codex/gpt-5.6-luna is not registered");
	if (!modelRegistry.hasConfiguredAuth(registeredModel)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for Prime Agent");
	}
	const model = {
		...registeredModel,
		maxTokens: Math.min(registeredModel.maxTokens, MAX_OUTPUT_TOKENS_PER_RESPONSE),
	};
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false, agentCallable: false },
		autoRefine: { enabled: false },
		retry: {
			enabled: false,
			maxRetries: 0,
			provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: PROVIDER_TIMEOUT_MS },
		},
	});
	const systemPrompt = [
		"You are a deterministic live integration canary.",
		"Call the one explicitly requested tool exactly once with the exact JSON arguments.",
		"Do not emit prose and do not call any unrequested tool.",
	].join("\n");
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
		systemPrompt,
	});
	await resourceLoader.reload();

	const sessionManager = SessionManager.create(process.cwd(), sessionDir);
	sessionManager.flushNow();
	const tools = createCanaryTools(controller);
	const { session } = await createAgentSession({
		cwd: process.cwd(),
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		serviceTier: FROZEN_CAMPAIGN.model.serviceTier,
		settingsManager,
		sessionManager,
		resourceLoader,
		tools: tools.map((tool) => tool.name),
		customTools: tools,
		includeGoals: false,
		includeCompactSkill: false,
	});
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("CPU live canary session is not persistent");
	await chmod(sessionFile, 0o600);
	assert.equal(session.model?.provider, FROZEN_CAMPAIGN.model.provider);
	assert.equal(session.model?.id, FROZEN_CAMPAIGN.model.id);
	assert.equal(session.model?.maxTokens, MAX_OUTPUT_TOKENS_PER_RESPONSE);
	assert.equal(session.thinkingLevel, FROZEN_CAMPAIGN.model.thinkingLevel);
	assert.equal(session.serviceTier, FROZEN_CAMPAIGN.model.serviceTier);

	const events: AgentSessionEvent[] = [];
	const usages: Usage[] = [];
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			usages.push(structuredClone((event.message as AssistantMessage).usage));
		}
	});

	try {
		session.setActiveToolsByName(["autoresearch_submit"]);
		assert.deepEqual(session.getActiveToolNames(), ["autoresearch_submit"]);
		const submitPrompt = "Call autoresearch_submit exactly once with {}. Do not call another tool or write prose.";
		const submitEventStart = events.length;
		await promptWithWatchdog(session, submitPrompt);
		const submit = parseSubmitDetails(exactToolDetails(events.slice(submitEventStart), "autoresearch_submit", {}));

		await waitForEvaluator(controller);
		const hostJobs = controller.statusForBranch(session.sessionId, [submit.jobId]);
		assert.equal(hostJobs.length, 1);
		validateSuccessfulJob(hostJobs[0], submit.jobId);

		session.setActiveToolsByName(["autoresearch_status"]);
		assert.deepEqual(session.getActiveToolNames(), ["autoresearch_status"]);
		const statusArguments = { jobIds: [submit.jobId] };
		const statusPrompt = `Call autoresearch_status exactly once with ${JSON.stringify(statusArguments)}. Do not call another tool or write prose.`;
		const statusEventStart = events.length;
		await promptWithWatchdog(session, statusPrompt);
		const statusDetails = exactToolDetails(events.slice(statusEventStart), "autoresearch_status", statusArguments);
		const expectedStatus = {
			jobs: controller.statusForBranch(session.sessionId, [submit.jobId]),
			budget: controller.budgetStatus(session.sessionId),
		};
		assert.deepEqual(jsonSafe(statusDetails), jsonSafe(expectedStatus));
		validateSuccessfulJob(expectedStatus.jobs[0], submit.jobId);
		assert.deepEqual(expectedStatus.budget, {
			branchId: session.sessionId,
			submissions: 1,
			taskEvaluations: 1,
			maxSubmissions: 1,
			maxTaskEvaluations: 1,
			remainingSubmissions: 0,
			remainingTaskEvaluations: 0,
		});

		const sessionStats = session.getSessionStats();
		assert.equal(sessionStats.assistantMessages, 2);
		assert.equal(sessionStats.toolCalls, 2);
		assert.equal(sessionStats.toolResults, 2);
		const knownUsage = sumUsage(usages);
		assert.ok(knownUsage.totalTokens > 0);

		return {
			sessionId: session.sessionId,
			sessionFile,
			sessionStats,
			knownUsage,
			submitPromptSha256: sha256Text(submitPrompt),
			statusPromptSha256: sha256Text(statusPrompt),
			submit,
			job: expectedStatus.jobs[0],
			budget: expectedStatus.budget,
		};
	} finally {
		unsubscribe();
		await session.disposeAsync();
	}
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(path, 0o600);
}

async function main(): Promise<void> {
	assert.ok(
		FROZEN_CAMPAIGN.lanes.compilerGym.devTasks.some((task) => task === TASK_ID),
		`${TASK_ID} is not in the frozen CompilerGym development set`,
	);
	const outputDir = parseOutputDir(process.argv.slice(2));
	await mkdir(dirname(outputDir), { recursive: true });
	await mkdir(outputDir, { mode: 0o700 });
	await chmod(outputDir, 0o700);
	const sessionDir = join(outputDir, "sessions");
	await mkdir(sessionDir, { mode: 0o700 });
	await chmod(sessionDir, 0o700);
	const ledgerPath = join(outputDir, "evidence.jsonl");
	const artifactDir = join(outputDir, "artifacts");
	await mkdir(artifactDir, { mode: 0o700 });
	await chmod(artifactDir, 0o700);
	const controllerOptions = {
		ledgerPath,
		artifactDir,
		adapters: [
			new FarmShareCompilerGymAdapter({
				...DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
				maxParallelTasks: 1,
			}),
		],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" as const },
			kernelbench: { name: "fastAtOne", direction: "maximize" as const },
			nanogpt: { name: "trainSteps", direction: "minimize" as const },
		},
		allowedBenchmarks: {
			"compiler-gym": [TASK_ID],
			kernelbench: [],
			nanogpt: [],
		},
		allowedTreatments: [TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: 1,
		maxTaskEvaluationsPerBranch: 1,
	};
	const controller = await ResearchController.open(controllerOptions);
	await chmod(ledgerPath, 0o600);
	const runId = randomUUID();
	const startedAt = new Date().toISOString();
	await controller.appendRunManifest({
		type: "compiler_gym_cpu_live_canary",
		phase: "start",
		runId,
		startedAt,
		promptProtocolVersion: PROMPT_PROTOCOL_VERSION,
		campaignId: FROZEN_CAMPAIGN.id,
		campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
		model: `${FROZEN_CAMPAIGN.model.provider}/${FROZEN_CAMPAIGN.model.id}`,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		requestedServiceTier: FROZEN_CAMPAIGN.model.serviceTier,
		providerTimeoutMs: PROVIDER_TIMEOUT_MS,
		providerMaxRetries: 0,
		maxOutputTokensPerResponse: MAX_OUTPUT_TOKENS_PER_RESPONSE,
		task: TASK_ID,
		treatment: TREATMENT,
		candidateFormat: "llvm-pass-sequence",
		candidateSha256: sha256Text(CANDIDATE_CONTENT),
		hardBranchBudgets: { maxSubmissions: 1, maxTaskEvaluations: 1 },
	});

	try {
		const live = await runLiveSession(controller, sessionDir);
		const reopenedManager = await SessionManager.openAsync(live.sessionFile, undefined, process.cwd());
		assert.equal(reopenedManager.getSessionId(), live.sessionId);
		const reopenedBranch = reopenedManager.getBranch();
		const persistedToolResults = reopenedBranch.filter(
			(entry) => entry.type === "message" && entry.message.role === "toolResult",
		);
		assert.equal(persistedToolResults.length, 2);
		assert.deepEqual(
			persistedToolResults.map((entry) =>
				entry.type === "message" && entry.message.role === "toolResult" ? entry.message.toolName : "",
			),
			["autoresearch_submit", "autoresearch_status"],
		);
		assert.equal(reopenedBranch.filter((entry) => entry.type === "compaction").length, 0);
		controller.verifyLedger();

		const endedAt = new Date().toISOString();
		const summary = {
			ok: true,
			runId,
			outputDir,
			startedAt,
			endedAt,
			model: `${FROZEN_CAMPAIGN.model.provider}/${FROZEN_CAMPAIGN.model.id}`,
			thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
			requestedAndLocallyEffectiveServiceTier: FROZEN_CAMPAIGN.model.serviceTier,
			upstreamServiceTierAcknowledgement: "not exposed by the current provider response API",
			sessionId: live.sessionId,
			sessionFile: live.sessionFile,
			sessionStats: live.sessionStats,
			knownAssistantUsage: live.knownUsage,
			submitPromptSha256: live.submitPromptSha256,
			statusPromptSha256: live.statusPromptSha256,
			jobId: live.submit.jobId,
			manifestDigest: live.submit.manifestDigest,
			job: live.job,
			branchBudget: live.budget,
			persistedToolResults: persistedToolResults.length,
			compactions: 0,
		};
		await controller.appendRunManifest({
			type: "compiler_gym_cpu_live_canary",
			phase: "end",
			outcome: "succeeded",
			...summary,
		});
		await writePrivateJson(join(outputDir, "result.json"), summary);
		console.log(JSON.stringify(summary));
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		const failedAt = new Date().toISOString();
		try {
			await controller.appendRunManifest({
				type: "compiler_gym_cpu_live_canary",
				phase: "end",
				outcome: "failed",
				runId,
				startedAt,
				failedAt,
				error: message,
			});
			controller.verifyLedger();
			await writePrivateJson(join(outputDir, "result.json"), {
				ok: false,
				runId,
				outputDir,
				startedAt,
				failedAt,
				error: message,
			});
		} catch {
			// Preserve the original canary failure if evidence recording also fails.
		}
		throw error;
	}
}

await main();

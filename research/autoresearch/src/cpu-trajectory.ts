import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	estimateTokens,
	findCutPoint,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";
import { classifyRemoval, findSingleRemoval, parseLlvmPassSequence, type RemovalOutcome } from "./diagnostics.js";
import { createResearchTools } from "./tools.js";
import type { JobView } from "./types.js";

type PilotArm = "control" | "M" | "W" | "R";
type CompactionSummaryPolicy = "model" | "sealed-isolation";

interface CliOptions {
	arm: PilotArm;
	iterations: number;
	outputDir: string;
	compactAfter: number | null;
	compactionSummaryPolicy: CompactionSummaryPolicy;
	outputTokenLimit: number;
	activeSecondsLimit: number;
	calendarSecondsLimit: number;
	calibrationResultPath: string;
}

const PILOT_TASKS = FROZEN_CAMPAIGN.lanes.compilerGym.smokeSearchTasks;

const ACTION_GUIDE = [
	"-mem2reg",
	"-sroa",
	"-instcombine",
	"-simplifycfg",
	"-reassociate",
	"-gvn",
	"-newgvn",
	"-sccp",
	"-ipsccp",
	"-adce",
	"-dce",
	"-bdce",
	"-dse",
	"-deadargelim",
	"-globalopt",
	"-globaldce",
	"-constmerge",
	"-constprop",
	"-jump-threading",
	"-licm",
	"-loop-rotate",
	"-loop-unroll",
	"-loop-vectorize",
	"-slp-vectorizer",
	"-tailcallelim",
	"-mergereturn",
] as const;

const PROMPT_PROTOCOL_VERSION = "compiler-gym-cpu-pilot-v7";
const PROVIDER_WATCHDOG_MS = 135_000;
const EVALUATOR_WATCHDOG_MS = 420_000;
const PLANNED_OUTPUT_TOKENS_PER_RESPONSE = 1_024;
const COMPACTION_RESERVE_TOKENS = 1_024;
const SEALED_COMPACTION_SUMMARY = [
	"# Sealed treatment-isolation boundary",
	"The compiler-optimization objective, calibration, verifier constraints, and host protocol remain authoritative.",
	"All earlier candidates, job identifiers, statuses, measurements, failures, and research decisions are intentionally omitted.",
	"Do not infer omitted evidence. Use only the retained neutral boundary and typed tools available to this arm.",
].join("\n\n");

interface FrontierSnapshot {
	jobId: string;
	acceptedAt: string;
	terminalAt: string;
	cumulativeAdmittedTaskEvaluations: number;
	cumulativeKnownAssistantUsage: Usage;
	cumulativeAgentActiveMs: number;
	cumulativeEvaluatorWaitMs: number;
	cumulativeCalendarMs: number;
	tasks: Array<{
		benchmarkId: string;
		status: string;
		irInstructionCount: number | null;
		objectTextSizeBytes: number | null;
		verifierPassed: boolean;
	}>;
}

interface ProtocolDeviation {
	phase: string;
	code: "assistant-acknowledgement" | "assistant-checkpoint" | "assistant-champion-selection";
	expected: string;
	actual: string;
}

interface RDiagnosticPromptContext {
	parentJobId: string;
	parentActions: string[];
	parentTasks: Array<{
		benchmarkId: string;
		irInstructionCount: number;
		verifierPassed: boolean;
	}>;
}

interface RDiagnosticRecord {
	mode: "leave-one-out";
	parentJobId: string;
	candidateJobId: string;
	parentActions: string[];
	candidateActions: string[];
	removedIndex: number;
	removedAction: string;
	outcome: RemovalOutcome | null;
	deltas: ReturnType<typeof classifyRemoval>["deltas"];
}

function positiveInteger(value: string | undefined, name: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
	return parsed;
}

function parseOptions(argv: readonly string[]): CliOptions {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(
				"Usage: npm run autoresearch:cpu-trajectory -- --arm <control|M|W|R> --iterations <n> --output-dir <path> --calibration-result <path> [--compact-after <n|none>] [--compaction-summary-policy <model|sealed-isolation>] [--output-token-limit <n>] [--active-seconds-limit <n>] [--calendar-seconds-limit <n>]",
			);
		}
		if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
		values.set(flag, value);
	}
	const allowed = new Set([
		"--arm",
		"--iterations",
		"--output-dir",
		"--compact-after",
		"--compaction-summary-policy",
		"--output-token-limit",
		"--active-seconds-limit",
		"--calendar-seconds-limit",
		"--calibration-result",
	]);
	for (const flag of values.keys()) if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
	const arm = values.get("--arm");
	if (arm !== "control" && arm !== "M" && arm !== "W" && arm !== "R") {
		throw new Error("--arm must be control, M, W, or R");
	}
	const iterations = positiveInteger(values.get("--iterations"), "--iterations");
	if (iterations > 20) throw new Error("--iterations must not exceed 20");
	const outputDir = values.get("--output-dir");
	if (!outputDir) throw new Error("--output-dir is required");
	const calibrationResultPath = values.get("--calibration-result");
	if (!calibrationResultPath) throw new Error("--calibration-result is required");
	const compactRaw = values.get("--compact-after") ?? "none";
	const compactAfter = compactRaw === "none" ? null : positiveInteger(compactRaw, "--compact-after");
	if (compactAfter !== null && compactAfter >= iterations) {
		throw new Error("--compact-after must be less than --iterations so later research can test continuity");
	}
	const compactionSummaryPolicy = values.get("--compaction-summary-policy") ?? "model";
	if (compactionSummaryPolicy !== "model" && compactionSummaryPolicy !== "sealed-isolation") {
		throw new Error("--compaction-summary-policy must be model or sealed-isolation");
	}
	if (compactionSummaryPolicy === "sealed-isolation" && compactAfter === null) {
		throw new Error("--compaction-summary-policy sealed-isolation requires --compact-after");
	}
	return {
		arm,
		iterations,
		outputDir: resolve(outputDir),
		compactAfter,
		compactionSummaryPolicy,
		outputTokenLimit: positiveInteger(values.get("--output-token-limit") ?? "32000", "--output-token-limit"),
		activeSecondsLimit: positiveInteger(values.get("--active-seconds-limit") ?? "600", "--active-seconds-limit"),
		calendarSecondsLimit: positiveInteger(
			values.get("--calendar-seconds-limit") ?? "900",
			"--calendar-seconds-limit",
		),
		calibrationResultPath: resolve(calibrationResultPath),
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

function calibrationEvidence(job: JobView): Array<Record<string, unknown>> {
	assert.equal(job.state.status, "succeeded", "Calibration must succeed before a trajectory starts");
	assert.ok(job.measurement, "Calibration measurement is missing");
	return job.measurement.tasks.map((task) => ({
		benchmarkId: task.benchmarkId,
		status: task.status,
		IrInstructionCount: task.metrics.IrInstructionCount,
		ObjectTextSizeBytes: task.metrics.ObjectTextSizeBytes,
		verifierPassed: task.verifier.passed,
	}));
}

function systemPrompt(arm: PilotArm, calibration: readonly Record<string, unknown>[]): string {
	const evidenceRule =
		arm === "M"
			? "After compaction, use autoresearch_recall to recover all branch-local measured outcomes, including failures."
			: "You have no evidence-search tool. Use only measurements still in context and exact-job autoresearch_status calls.";
	return [
		"You are running a bounded, falsifiable compiler-optimization trajectory.",
		"The objective is to reduce raw LLVM IR instruction count on every listed cBench task while preserving all trusted semantic callbacks.",
		"Never invent a metric, treat a prediction as a measurement, or infer success from a queued job.",
		"Do not combine task scales into a single score. Inspect every task and state tradeoffs explicitly in the proposal fields.",
		"Submit exactly one candidate per requested iteration. Change one mechanistic idea at a time unless a prior measured interaction justifies a sequence.",
		'Candidate content must be a JSON-encoded array of exact LLVM 10 pass flags, for example: ["-mem2reg","-instcombine"].',
		`Useful valid flags include: ${ACTION_GUIDE.join(", ")}. Repetition and order are allowed.`,
		`The exact tasks are ${JSON.stringify(PILOT_TASKS)}. The preregistered treatment is bound by the host and hidden from the prompt.`,
		`Authoritative empty-sequence calibration: ${JSON.stringify(calibration)}.`,
		evidenceRule,
		"Only the provided autoresearch tools are available. Do not request shell, web, file, or credential access.",
	].join("\n");
}

function iterationPrompt(
	iteration: number,
	iterations: number,
	previousJobId: string | null,
	useRecall: boolean,
	rDiagnostic: RDiagnosticPromptContext | null,
): string {
	const evidenceStep = previousJobId
		? useRecall
			? 'First call autoresearch_recall exactly once with {"lane":"compiler-gym","statuses":["succeeded","invalid","failed"],"limit":50}.'
			: `First call autoresearch_status exactly once with {"jobIds":["${previousJobId}"]}.`
		: "Use the authoritative calibration in the system prompt as the only measured starting evidence.";
	return [
		`Iteration ${iteration} of ${iterations}.`,
		evidenceStep,
		"Then call autoresearch_submit exactly once. The tool is server-bound to the exact tasks, smoke budget, and preregistered treatment; do not include those fields.",
		"Supply only proposal and candidate. Use candidate format llvm-pass-sequence and a JSON-encoded array as candidate content.",
		"Candidate lineage is server-bound to the latest accepted branch job. Do not include parentJobIds.",
		...(rDiagnostic
			? [
					"This is the R leave-one-out diagnostic checkpoint. Do not add, reorder, or replace passes.",
					`Authoritative parent payload: ${JSON.stringify(rDiagnostic)}.`,
					"Submit exactly the parent action array with one indexed occurrence removed. State the removed index and action in the hypothesis.",
				]
			: []),
		"Make the hypothesis falsifiable, name the mechanism, predict per-task direction, and state boundary conditions.",
		"After the submit tool returns, reply with exactly: SUBMITTED <job-id>",
	].join("\n");
}

function finalPrompt(arm: PilotArm, finalJobId: string): string {
	const evidenceStep =
		arm === "M"
			? 'Call autoresearch_recall exactly once with {"lane":"compiler-gym","statuses":["succeeded","invalid","failed"],"limit":50}.'
			: `Call autoresearch_status exactly once with {"jobIds":["${finalJobId}"]}.`;
	return [
		evidenceStep,
		"Select the strongest succeeded candidate from this trajectory using only authoritative per-task measurements and semantic validity.",
		"Do not select the system calibration. If no submitted candidate succeeded, reply exactly: CHAMPION NONE",
		"Otherwise reply with exactly: CHAMPION <job-id>",
	].join("\n");
}

function checkpointPrompt(jobId: string): string {
	return [
		`The host has waited for job ${jobId} to become terminal.`,
		`Call autoresearch_status exactly once with {"jobIds":["${jobId}"]}.`,
		"Inspect the authoritative per-task measurement, then reply exactly: EVIDENCE_RECORDED",
	].join("\n");
}

function successfulToolEnds(events: readonly AgentSessionEvent[], name: string): number {
	return events.filter(
		(event) => event.type === "tool_execution_end" && event.toolName === name && event.isError === false,
	).length;
}

function failedToolEnds(events: readonly AgentSessionEvent[], name: string): number {
	return events.filter(
		(event) => event.type === "tool_execution_end" && event.toolName === name && event.isError === true,
	).length;
}

function toolExecutionAccounting(events: readonly AgentSessionEvent[]) {
	const forTool = (name: string) => ({
		succeeded: successfulToolEnds(events, name),
		failed: failedToolEnds(events, name),
	});
	return {
		submit: forTool("autoresearch_submit"),
		status: forTool("autoresearch_status"),
		recall: forTool("autoresearch_recall"),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadCalibration(path: string): Promise<{
	job: JobView;
	evidence: Array<Record<string, unknown>>;
	resultSha256: string;
}> {
	const contents = await readFile(path, "utf8");
	const value: unknown = JSON.parse(contents);
	assert.ok(isRecord(value) && value.type === "compiler_gym_evaluation");
	assert.equal(value.campaignConfigSha256, sha256Json(FROZEN_CAMPAIGN));
	assert.ok(isRecord(value.request));
	assert.deepEqual(value.request.benchmarks, [...PILOT_TASKS]);
	assert.deepEqual(value.request.actions, []);
	assert.equal(value.request.treatment, "calibration");
	assert.ok(isRecord(value.job));
	const job = value.job as unknown as JobView;
	assert.deepEqual(job.proposal.benchmarkIds, [...PILOT_TASKS]);
	assert.equal(job.proposal.treatment, "calibration");
	assert.equal(job.proposal.candidate.digest, sha256Text("[]"));
	assert.ok(isRecord(value.submitted));
	assert.equal(value.submitted.jobId, job.proposal.jobId);
	assert.equal(value.submitted.manifestDigest, job.proposal.manifestDigest);
	return {
		job,
		evidence: calibrationEvidence(job),
		resultSha256: sha256Text(contents),
	};
}

function exactToolDetails(events: readonly AgentSessionEvent[], name: string): unknown {
	const ends = events.filter(
		(event): event is Extract<AgentSessionEvent, { type: "tool_execution_end" }> =>
			event.type === "tool_execution_end" && event.toolName === name,
	);
	assert.equal(ends.length, 1, `Expected exactly one ${name} result`);
	assert.equal(ends[0].isError, false, `${name} failed`);
	assert.ok(isRecord(ends[0].result) && Object.hasOwn(ends[0].result, "details"));
	return ends[0].result.details;
}

function jobIdsFromViews(value: unknown, requireCandidateContent: boolean): string[] {
	assert.ok(Array.isArray(value), "Evidence result must be an array");
	return value.map((item) => {
		assert.ok(isRecord(item) && isRecord(item.proposal) && typeof item.proposal.jobId === "string");
		if (requireCandidateContent) assert.equal(typeof item.candidateContent, "string");
		return item.proposal.jobId;
	});
}

function statusJobIds(value: unknown): string[] {
	assert.ok(isRecord(value) && Array.isArray(value.jobs), "Status details must contain jobs");
	return jobIdsFromViews(value.jobs, false);
}

function assertTurnSucceeded(events: readonly AgentSessionEvent[]): void {
	const assistantEnds = events.filter(
		(event): event is Extract<AgentSessionEvent, { type: "message_end" }> =>
			event.type === "message_end" && event.message.role === "assistant",
	);
	assert.ok(assistantEnds.length > 0, "Model turn produced no terminal assistant message");
	for (const event of assistantEnds) {
		const message = event.message as AssistantMessage;
		assert.notEqual(message.stopReason, "error", message.errorMessage ?? "Model turn ended with an error");
		assert.notEqual(message.stopReason, "aborted", "Model turn was aborted");
	}
}

function assertExactToolSequence(events: readonly AgentSessionEvent[], expectedNames: readonly string[]): void {
	const ends = events.filter(
		(event): event is Extract<AgentSessionEvent, { type: "tool_execution_end" }> =>
			event.type === "tool_execution_end",
	);
	assert.deepEqual(
		ends.map((event) => event.toolName),
		expectedNames,
		"Tool sequence diverged from the matched trajectory protocol",
	);
	for (const event of ends) assert.equal(event.isError, false, `${event.toolName} failed`);
}

function finalAssistantText(events: readonly AgentSessionEvent[]): string {
	const messages = events
		.filter(
			(event): event is Extract<AgentSessionEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		)
		.map((event) => event.message as AssistantMessage);
	return messages.length === 0 ? "" : assistantText(messages.at(-1)!);
}

function jsonSafe(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
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

async function compactWithWatchdog(session: AgentSession, instructions: string) {
	let watchdogFired = false;
	const watchdog = setTimeout(() => {
		watchdogFired = true;
		session.requestAbort();
	}, PROVIDER_WATCHDOG_MS);
	let result: Awaited<ReturnType<AgentSession["compact"]>>;
	try {
		result = await session.compact(instructions);
	} finally {
		clearTimeout(watchdog);
	}
	if (watchdogFired) throw new Error(`Compaction exceeded ${PROVIDER_WATCHDOG_MS}ms and was aborted`);
	return result;
}

function configureWholeTurnCompaction(settingsManager: SettingsManager, sessionManager: SessionManager): number {
	const branch = sessionManager.getBranch();
	const userIndices = branch
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => entry.type === "message" && entry.message.role === "user")
		.map(({ index }) => index);
	assert.ok(userIndices.length >= 2, "Whole-turn compaction requires at least two completed user turns");
	const latestUserIndex = userIndices.at(-1)!;
	const keepRecentTokens = branch.slice(latestUserIndex).reduce((total, entry) => {
		return entry.type === "message" ? total + estimateTokens(entry.message) : total;
	}, 0);
	assert.ok(keepRecentTokens > 0);
	const cutPoint = findCutPoint(branch, 0, branch.length, keepRecentTokens);
	assert.equal(cutPoint.firstKeptEntryIndex, latestUserIndex, "Compaction cut must preserve the latest whole turn");
	assert.equal(cutPoint.isSplitTurn, false, "Matched pilot forbids split-turn compaction");
	settingsManager.applyOverrides({ compaction: { keepRecentTokens } });
	return keepRecentTokens;
}

function sealedCompactionExtension(pi: ExtensionAPI): void {
	pi.on("session_before_compact", (event) => ({
		compaction: {
			summary: SEALED_COMPACTION_SUMMARY,
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
			details: { summaryPolicy: "sealed-isolation-v1" },
		},
	}));
}

interface ProviderBudgetTracker {
	outputTokens: number;
	providerCalls: number;
	blockedProviderCalls: number;
	blockedReasons: Array<"output-token-checkpoint" | "provider-call-limit">;
}

function providerBudgetExtension(tracker: ProviderBudgetTracker, outputTokenLimit: number, providerCallLimit: number) {
	return (pi: ExtensionAPI): void => {
		pi.on("before_provider_request", (event, ctx) => {
			assert.ok(isRecord(event.payload), "Provider payload must be an object for output-budget enforcement");
			const blockedReason =
				tracker.outputTokens >= outputTokenLimit
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
			tracker.providerCalls++;
			return event.payload;
		});
	};
}

function appendNeutralCompactionBoundary(
	sessionManager: SessionManager,
	model: { api: string; provider: string; id: string },
): string {
	const timestamp = Date.now();
	const boundaryId = sessionManager.appendMessage({
		role: "user",
		content: "HOST_SEALED_COMPACTION_BOUNDARY_V1: no experiment evidence is present in this turn.",
		timestamp,
	});
	sessionManager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "SEALED_BOUNDARY_READY" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: timestamp + 1,
	});
	return boundaryId;
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	if (options.iterations * PILOT_TASKS.length > 8) {
		throw new Error("The smoke campaign permits at most eight admitted task evaluations");
	}
	if (options.outputTokenLimit > 32_000) throw new Error("The smoke output-token cap is 32000");
	if (options.activeSecondsLimit > 600) throw new Error("The smoke active-agent cap is 600 seconds");
	if (options.calendarSecondsLimit > 900) throw new Error("The smoke calendar cap is 900 seconds");
	if (options.arm === "R" && options.iterations !== 4) throw new Error("The R smoke requires exactly four iterations");
	const validRunAssistantResponseLimit =
		2 + Math.max(0, options.iterations - 1) * 3 + 2 + (options.compactAfter === null ? 0 : 2);
	const compactionOutputTokenCeiling =
		options.compactAfter !== null && options.compactionSummaryPolicy === "model"
			? Math.floor(COMPACTION_RESERVE_TOKENS * 0.8)
			: 0;
	const validRunPlannedOutputTokenBudget =
		validRunAssistantResponseLimit * PLANNED_OUTPUT_TOKENS_PER_RESPONSE + compactionOutputTokenCeiling;
	if (options.outputTokenLimit < validRunPlannedOutputTokenBudget) {
		throw new Error(
			`--output-token-limit must be at least ${validRunPlannedOutputTokenBudget} for the exact valid-run call graph`,
		);
	}
	const startedAtMs = Date.now();
	const sessionDir = join(options.outputDir, "sessions");
	const ledgerPath = join(options.outputDir, "evidence.jsonl");
	await mkdir(dirname(options.outputDir), { recursive: true, mode: 0o700 });
	await mkdir(options.outputDir, { mode: 0o700 });
	await chmod(options.outputDir, 0o700);
	await mkdir(sessionDir, { mode: 0o700 });
	await chmod(sessionDir, 0o700);
	const loadedCalibration = await loadCalibration(options.calibrationResultPath);
	const calibrationJob = loadedCalibration.job;
	const calibration = loadedCalibration.evidence;

	const controller = await ResearchController.open({
		ledgerPath,
		artifactDir: join(options.outputDir, "artifacts"),
		adapters: [new FarmShareCompilerGymAdapter()],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": [...PILOT_TASKS],
			kernelbench: [],
			nanogpt: [],
		},
		allowedTreatments: [options.arm],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: options.iterations,
		maxTaskEvaluationsPerBranch: options.iterations * PILOT_TASKS.length,
	});
	await chmod(ledgerPath, 0o600);

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const registeredModel = modelRegistry.find(FROZEN_CAMPAIGN.model.provider, FROZEN_CAMPAIGN.model.id);
	if (!registeredModel) throw new Error("openai-codex/gpt-5.6-luna is not registered");
	if (!modelRegistry.hasConfiguredAuth(registeredModel)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for Prime Agent");
	}
	const model = registeredModel;

	const settingsManager = SettingsManager.inMemory({
		transport: "sse",
		compaction: {
			enabled: true,
			agentCallable: false,
			reserveTokens: COMPACTION_RESERVE_TOKENS,
			keepRecentTokens: 4096,
		},
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 120_000 } },
	});
	const providerBudgetTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
	};
	const prompt = systemPrompt(options.arm, calibration);
	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [
			providerBudgetExtension(providerBudgetTracker, options.outputTokenLimit, validRunAssistantResponseLimit),
			...(options.compactionSummaryPolicy === "sealed-isolation" ? [sealedCompactionExtension] : []),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
		systemPrompt: prompt,
	});
	await resourceLoader.reload();

	const sessionManager = SessionManager.create(process.cwd(), sessionDir);
	sessionManager.flushNow();
	const researchTools = createResearchTools(controller, {
		enableRecall: options.arm === "M",
		enableCompare: false,
		includeRecallCandidateContent: options.arm === "M",
		submitScope: {
			lane: "compiler-gym",
			benchmarkIds: PILOT_TASKS,
			budgetClass: "smoke",
			treatment: options.arm,
			bindParentToLatest: true,
		},
	});
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
		tools: researchTools.map((tool) => tool.name),
		customTools: researchTools,
		includeGoals: false,
		includeCompactSkill: false,
	});
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("CPU trajectory session is not persistent");
	await chmod(sessionFile, 0o600);
	assert.equal(session.model?.provider, FROZEN_CAMPAIGN.model.provider);
	assert.equal(session.model?.id, FROZEN_CAMPAIGN.model.id);
	assert.equal(session.thinkingLevel, FROZEN_CAMPAIGN.model.thinkingLevel);
	assert.equal(session.serviceTier, FROZEN_CAMPAIGN.model.serviceTier);
	assert.deepEqual(
		session.getActiveToolNames().sort(),
		(options.arm === "M"
			? ["autoresearch_recall", "autoresearch_status", "autoresearch_submit"]
			: ["autoresearch_status", "autoresearch_submit"]
		).sort(),
	);

	const events: AgentSessionEvent[] = [];
	const usages: Usage[] = [];
	const assistantMessages: AssistantMessage[] = [];
	const promptHashes: string[] = [];
	const frontierSnapshots: FrontierSnapshot[] = [];
	const protocolDeviations: ProtocolDeviation[] = [];
	let rDiagnosticRecord: RDiagnosticRecord | null = null;
	let agentActiveMs = 0;
	let evaluatorWaitMs = 0;
	let compactionMs = 0;
	let compactionCount = 0;
	let compactionKeepRecentTokens: number | null = null;
	let compactionFirstKeptEntryId: string | null = null;
	let sealedContextCheckCount = 0;
	let budgetStopReason: "output-tokens" | "active-agent-seconds" | "calendar-seconds" | null = null;
	const submittedJobIds: string[] = [];
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			usages.push(structuredClone(message.usage));
			assistantMessages.push(structuredClone(message));
			providerBudgetTracker.outputTokens += message.usage.output;
		}
	});
	const observedBudgetStop = (): typeof budgetStopReason => {
		const knownUsage = sumUsage(usages);
		if (knownUsage.output >= options.outputTokenLimit) return "output-tokens";
		if (agentActiveMs / 1000 >= options.activeSecondsLimit) return "active-agent-seconds";
		if ((Date.now() - startedAtMs) / 1000 >= options.calendarSecondsLimit) return "calendar-seconds";
		return null;
	};
	await controller.appendRunManifest({
		type: "compiler_gym_cpu_trajectory",
		phase: "start",
		promptProtocolVersion: PROMPT_PROTOCOL_VERSION,
		campaignId: FROZEN_CAMPAIGN.id,
		campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
		arm: options.arm,
		model: `${model.provider}/${model.id}`,
		thinkingLevel: session.thinkingLevel,
		requestedServiceTier: session.serviceTier,
		transport: settingsManager.getTransport(),
		providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
		systemPromptSha256: sha256Text(prompt),
		sessionId: session.sessionId,
		sessionFile,
		tasks: PILOT_TASKS,
		calibrationJobId: calibrationJob.proposal.jobId,
		calibrationResultPath: options.calibrationResultPath,
		calibrationResultSha256: loadedCalibration.resultSha256,
		calibrationAccounting: "shared campaign infrastructure; excluded from per-arm task-evaluation budget",
		controllerHardBudgets: {
			maxSubmissions: options.iterations,
			maxTaskEvaluations: options.iterations * PILOT_TASKS.length,
		},
		checkpointAccountingCeilings: {
			outputTokens: options.outputTokenLimit,
			activeAgentSeconds: options.activeSecondsLimit,
			calendarSeconds: options.calendarSecondsLimit,
		},
		iterationsRequested: options.iterations,
		compactAfter: options.compactAfter,
		validRunAssistantResponseLimit,
		plannedOutputTokensPerAssistantResponse: PLANNED_OUTPUT_TOKENS_PER_RESPONSE,
		hardProviderCallLimit: validRunAssistantResponseLimit,
		providerBudgetPolicy:
			"before-provider-request exact-call-count-v1; output tokens are checkpointed after each completed response because ChatGPT Codex rejects max_output_tokens",
		compactionReserveTokens: COMPACTION_RESERVE_TOKENS,
		compactionSummaryPolicy: options.compactionSummaryPolicy,
		sealedCompactionSummarySha256:
			options.compactionSummaryPolicy === "sealed-isolation" ? sha256Text(SEALED_COMPACTION_SUMMARY) : null,
		validRunPlannedOutputTokenBudget,
		startedAt: new Date(startedAtMs).toISOString(),
	});

	let championJobId: string | null = null;
	try {
		for (let index = 0; index < options.iterations; index++) {
			budgetStopReason = observedBudgetStop();
			if (budgetStopReason) break;
			const beforeIds = new Set(controller.statusForBranch(session.sessionId).map((job) => job.proposal.jobId));
			const afterCompaction = options.compactAfter !== null && index >= options.compactAfter;
			let rDiagnosticPrompt: RDiagnosticPromptContext | null = null;
			if (options.arm === "R" && index === options.iterations - 1) {
				const parentJobId = submittedJobIds.at(-1);
				assert.ok(parentJobId, "R diagnostic requires a measured parent candidate");
				const parent = (
					await controller.recallWithCandidateContent(session.sessionId, {
						lane: "compiler-gym",
						statuses: ["succeeded"],
						limit: 100,
					})
				).find((job) => job.proposal.jobId === parentJobId);
				assert.ok(parent?.measurement, "R diagnostic parent is not durably measured");
				const parentActions = parseLlvmPassSequence(parent.candidateContent);
				rDiagnosticPrompt = {
					parentJobId,
					parentActions,
					parentTasks: parent.measurement.tasks.map((task) => {
						const irInstructionCount = task.metrics.IrInstructionCount;
						assert.ok(irInstructionCount !== undefined);
						return {
							benchmarkId: task.benchmarkId,
							irInstructionCount,
							verifierPassed: task.verifier.passed,
						};
					}),
				};
			}
			const iterationRequest = iterationPrompt(
				index + 1,
				options.iterations,
				submittedJobIds.at(-1) ?? null,
				options.arm === "M" && afterCompaction,
				rDiagnosticPrompt,
			);
			promptHashes.push(sha256Text(iterationRequest));
			const turnEventStart = events.length;
			const agentStarted = Date.now();
			await promptWithWatchdog(session, iterationRequest);
			agentActiveMs += Date.now() - agentStarted;
			const turnEvents = events.slice(turnEventStart);
			assertTurnSucceeded(turnEvents);
			const expectedEvidenceTools =
				submittedJobIds.length === 0
					? []
					: options.arm === "M" && afterCompaction
						? ["autoresearch_recall"]
						: ["autoresearch_status"];
			assertExactToolSequence(turnEvents, [...expectedEvidenceTools, "autoresearch_submit"]);
			if (submittedJobIds.length > 0) {
				if (options.arm === "M" && afterCompaction) {
					assert.deepEqual(
						jobIdsFromViews(exactToolDetails(turnEvents, "autoresearch_recall"), true).sort(),
						[...submittedJobIds].sort(),
						"Post-compaction recall must recover every prior measured candidate",
					);
				} else {
					assert.deepEqual(statusJobIds(exactToolDetails(turnEvents, "autoresearch_status")), [
						submittedJobIds.at(-1),
					]);
				}
			}

			const newJobs = controller
				.statusForBranch(session.sessionId)
				.filter((job) => !beforeIds.has(job.proposal.jobId));
			assert.equal(newJobs.length, 1, "Each iteration must create exactly one non-duplicate job");
			const submitted = newJobs[0];
			assert.equal(submitted.proposal.treatment, options.arm);
			assert.deepEqual(submitted.proposal.benchmarkIds, [...PILOT_TASKS]);
			assert.deepEqual(
				submitted.proposal.proposal.parentJobIds,
				submittedJobIds.length === 0 ? [] : [submittedJobIds.at(-1)],
				"Candidate lineage diverged from the matched trajectory protocol",
			);
			if (rDiagnosticPrompt) {
				const submittedWithContent = (
					await controller.recallWithCandidateContent(session.sessionId, { limit: 100 })
				).find((job) => job.proposal.jobId === submitted.proposal.jobId);
				assert.ok(submittedWithContent);
				const candidateActions = parseLlvmPassSequence(submittedWithContent.candidateContent);
				const removal = findSingleRemoval(rDiagnosticPrompt.parentActions, candidateActions);
				assert.ok(removal, "R diagnostic candidate must remove exactly one indexed parent action");
				rDiagnosticRecord = {
					mode: "leave-one-out",
					parentJobId: rDiagnosticPrompt.parentJobId,
					candidateJobId: submitted.proposal.jobId,
					parentActions: rDiagnosticPrompt.parentActions,
					candidateActions,
					...removal,
					outcome: null,
					deltas: [],
				};
			}
			submittedJobIds.push(submitted.proposal.jobId);
			const submitDetails = exactToolDetails(turnEvents, "autoresearch_submit");
			assert.ok(isRecord(submitDetails));
			assert.equal(submitDetails.jobId, submitted.proposal.jobId);
			assert.equal(submitDetails.manifestDigest, submitted.proposal.manifestDigest);
			assert.equal(submitDetails.duplicate, false);
			assert.ok(typeof submitDetails.acceptedAt === "string");
			const expectedAcknowledgement = `SUBMITTED ${submitted.proposal.jobId}`;
			const actualAcknowledgement = finalAssistantText(turnEvents);
			if (actualAcknowledgement !== expectedAcknowledgement) {
				protocolDeviations.push({
					phase: `iteration-${index + 1}`,
					code: "assistant-acknowledgement",
					expected: expectedAcknowledgement,
					actual: actualAcknowledgement,
				});
			}

			const evaluatorStarted = Date.now();
			await waitForEvaluator(controller);
			evaluatorWaitMs += Date.now() - evaluatorStarted;
			const terminalJob = controller.statusForBranch(session.sessionId, [submitted.proposal.jobId])[0];
			assert.ok(terminalJob.measurement, "Terminal evaluator job is missing its measurement");
			if (rDiagnosticRecord?.candidateJobId === terminalJob.proposal.jobId) {
				const parentJob = controller.statusForBranch(session.sessionId, [rDiagnosticRecord.parentJobId])[0];
				assert.ok(parentJob.measurement);
				const classification = classifyRemoval(parentJob.measurement.tasks, terminalJob.measurement.tasks);
				rDiagnosticRecord.outcome = classification.outcome;
				rDiagnosticRecord.deltas = classification.deltas;
			}
			frontierSnapshots.push({
				jobId: submitted.proposal.jobId,
				acceptedAt: submitDetails.acceptedAt,
				terminalAt: terminalJob.state.statusAt,
				cumulativeAdmittedTaskEvaluations: controller.budgetStatus(session.sessionId).taskEvaluations,
				cumulativeKnownAssistantUsage: sumUsage(usages),
				cumulativeAgentActiveMs: agentActiveMs,
				cumulativeEvaluatorWaitMs: evaluatorWaitMs,
				cumulativeCalendarMs: Date.now() - startedAtMs,
				tasks: terminalJob.measurement.tasks.map((task) => ({
					benchmarkId: task.benchmarkId,
					status: task.status,
					irInstructionCount: task.metrics.IrInstructionCount ?? null,
					objectTextSizeBytes: task.metrics.ObjectTextSizeBytes ?? null,
					verifierPassed: task.verifier.passed,
				})),
			});

			budgetStopReason = observedBudgetStop();
			if (budgetStopReason) break;

			if (options.compactAfter === index + 1) {
				const checkpointRequest = checkpointPrompt(submitted.proposal.jobId);
				promptHashes.push(sha256Text(checkpointRequest));
				const checkpointEventStart = events.length;
				const checkpointStarted = Date.now();
				await promptWithWatchdog(session, checkpointRequest);
				agentActiveMs += Date.now() - checkpointStarted;
				const checkpointEvents = events.slice(checkpointEventStart);
				assertTurnSucceeded(checkpointEvents);
				assertExactToolSequence(checkpointEvents, ["autoresearch_status"]);
				const checkpointText = finalAssistantText(checkpointEvents);
				if (checkpointText !== "EVIDENCE_RECORDED") {
					protocolDeviations.push({
						phase: `checkpoint-after-iteration-${index + 1}`,
						code: "assistant-checkpoint",
						expected: "EVIDENCE_RECORDED",
						actual: checkpointText,
					});
				}
				assert.deepEqual(
					jsonSafe(exactToolDetails(checkpointEvents, "autoresearch_status")),
					jsonSafe({
						jobs: controller.statusForBranch(session.sessionId, [submitted.proposal.jobId]),
						budget: controller.budgetStatus(session.sessionId),
					}),
				);
				budgetStopReason = observedBudgetStop();
				if (budgetStopReason) break;
				const evidenceToSeal =
					options.compactionSummaryPolicy === "sealed-isolation"
						? await controller.recallWithCandidateContent(session.sessionId, { limit: 100 })
						: [];
				const sealedBoundaryId =
					options.compactionSummaryPolicy === "sealed-isolation"
						? appendNeutralCompactionBoundary(sessionManager, model)
						: null;
				compactionKeepRecentTokens = configureWholeTurnCompaction(settingsManager, sessionManager);
				const compactionEventStart = events.length;
				const compactionStarted = Date.now();
				const compaction = await compactWithWatchdog(
					session,
					"Summarize the research trajectory faithfully under the default format. Preserve the objective and verifier constraints, and keep hypotheses distinct from measured outcomes.",
				);
				const elapsed = Date.now() - compactionStarted;
				compactionMs += elapsed;
				agentActiveMs += elapsed;
				compactionCount++;
				assert.ok(compaction.summary.length > 0);
				compactionFirstKeptEntryId = compaction.firstKeptEntryId;
				if (options.compactionSummaryPolicy === "sealed-isolation") {
					assert.ok(sealedBoundaryId);
					assert.equal(compaction.summary, SEALED_COMPACTION_SUMMARY);
					assert.equal(compaction.firstKeptEntryId, sealedBoundaryId);
					const rebuiltContext = JSON.stringify(sessionManager.buildSessionContext().messages);
					for (const job of evidenceToSeal) {
						assert.equal(
							rebuiltContext.includes(job.proposal.jobId),
							false,
							`Sealed compaction leaked job ID ${job.proposal.jobId}`,
						);
						assert.equal(
							rebuiltContext.includes(job.proposal.manifestDigest),
							false,
							`Sealed compaction leaked manifest ${job.proposal.manifestDigest}`,
						);
						assert.equal(
							rebuiltContext.includes(job.candidateContent),
							false,
							`Sealed compaction leaked candidate ${job.proposal.jobId}`,
						);
					}
					sealedContextCheckCount++;
				}
				const compactionEvents = events.slice(compactionEventStart);
				assert.equal(compactionEvents.filter((event) => event.type === "compaction_start").length, 1);
				const compactionEnds = compactionEvents.filter((event) => event.type === "compaction_end");
				assert.equal(compactionEnds.length, 1);
				assert.equal(
					compactionEnds[0].type === "compaction_end" ? compactionEnds[0].errorMessage : "missing",
					undefined,
				);
				budgetStopReason = observedBudgetStop();
				if (budgetStopReason) break;
			}
		}

		assert.ok(submittedJobIds.length > 0, "Trajectory did not submit a candidate");
		if (!budgetStopReason) {
			const finalRequest = finalPrompt(options.arm, submittedJobIds.at(-1)!);
			promptHashes.push(sha256Text(finalRequest));
			const finalAgentStarted = Date.now();
			const finalEventStart = events.length;
			await promptWithWatchdog(session, finalRequest);
			agentActiveMs += Date.now() - finalAgentStarted;
			const finalEvents = events.slice(finalEventStart);
			assertTurnSucceeded(finalEvents);
			assertExactToolSequence(finalEvents, [options.arm === "M" ? "autoresearch_recall" : "autoresearch_status"]);
			if (options.arm === "M") {
				assert.deepEqual(
					jobIdsFromViews(exactToolDetails(finalEvents, "autoresearch_recall"), true).sort(),
					[...submittedJobIds].sort(),
				);
			} else {
				assert.deepEqual(statusJobIds(exactToolDetails(finalEvents, "autoresearch_status")), [
					submittedJobIds.at(-1),
				]);
			}
			const finalText = assistantMessages.map(assistantText).filter(Boolean).at(-1) ?? "";
			const championMatch = /^CHAMPION (NONE|job_[a-f0-9]{24})$/.exec(finalText);
			if (!championMatch) {
				protocolDeviations.push({
					phase: "final-selection",
					code: "assistant-champion-selection",
					expected: "CHAMPION <submitted-succeeded-job-id> or CHAMPION NONE",
					actual: finalText,
				});
			} else {
				const declared = championMatch[1] === "NONE" ? null : championMatch[1];
				if (
					declared &&
					(!submittedJobIds.includes(declared) ||
						controller.statusForBranch(session.sessionId, [declared])[0].state.status !== "succeeded")
				) {
					protocolDeviations.push({
						phase: "final-selection",
						code: "assistant-champion-selection",
						expected: "A submitted succeeded job ID",
						actual: finalText,
					});
				} else {
					championJobId = declared;
				}
			}
			budgetStopReason = observedBudgetStop();
		}

		const knownUsage = sumUsage(usages);
		const finishedAtMs = Date.now();
		await controller.appendRunManifest({
			type: "compiler_gym_cpu_trajectory",
			phase: "end",
			outcome: budgetStopReason ? "budget-stopped" : "succeeded",
			promptProtocolVersion: PROMPT_PROTOCOL_VERSION,
			campaignId: FROZEN_CAMPAIGN.id,
			campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
			arm: options.arm,
			features: FROZEN_CAMPAIGN.arms.find((arm) => arm.id === options.arm)?.features ?? null,
			model: `${model.provider}/${model.id}`,
			thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
			requestedServiceTier: FROZEN_CAMPAIGN.model.serviceTier,
			transport: settingsManager.getTransport(),
			providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
			upstreamServiceTierAcknowledgement: "not exposed by current provider response API",
			knownUsage,
			providerBudgetTracker: jsonSafe(providerBudgetTracker),
			compactionUsageAccounting:
				options.compactionSummaryPolicy === "sealed-isolation"
					? {
							providerCalls: 0,
							outputTokens: 0,
							source: "deterministic session_before_compact extension",
						}
					: "not exposed by current Prime Agent public API",
			systemPromptSha256: sha256Text(prompt),
			promptHashes,
			sessionId: session.sessionId,
			sessionFile,
			tasks: PILOT_TASKS,
			calibrationJobId: calibrationJob.proposal.jobId,
			calibrationResultPath: options.calibrationResultPath,
			calibrationResultSha256: loadedCalibration.resultSha256,
			submittedJobIds,
			championJobId,
			frontierSnapshots,
			protocolDeviations,
			rDiagnostic: rDiagnosticRecord,
			iterationsRequested: options.iterations,
			iterationsCompleted: submittedJobIds.length,
			outputTokenLimit: options.outputTokenLimit,
			hardProviderCallLimit: validRunAssistantResponseLimit,
			outputTokenBudgetEnforcement:
				"post-response checkpoint; ChatGPT Codex subscription backend rejects max_output_tokens",
			activeSecondsLimit: options.activeSecondsLimit,
			calendarSecondsLimit: options.calendarSecondsLimit,
			budgetCheckPolicy:
				"provider calls are hard-capped before dispatch; output tokens and time are checkpointed after completed model and evaluator calls",
			budgetStopReason,
			compactAfter: options.compactAfter,
			compactionSummaryPolicy: options.compactionSummaryPolicy,
			compactionCount,
			compactionMs,
			compactionKeepRecentTokens,
			compactionFirstKeptEntryId,
			sealedContextCheckCount,
			agentActiveMs,
			evaluatorWaitMs,
			calendarMs: finishedAtMs - startedAtMs,
			toolExecutions: toolExecutionAccounting(events),
			branchBudget: controller.budgetStatus(session.sessionId),
			sessionStats: jsonSafe(session.getSessionStats()),
		});
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		try {
			try {
				await waitForEvaluator(controller);
			} catch {
				// Preserve the primary failure while recording whatever evaluator state is durable.
			}
			const acceptedJobs = controller.statusForBranch(session.sessionId);
			await controller.appendRunManifest({
				type: "compiler_gym_cpu_trajectory",
				phase: "end",
				outcome: "failed",
				promptProtocolVersion: PROMPT_PROTOCOL_VERSION,
				campaignId: FROZEN_CAMPAIGN.id,
				campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
				arm: options.arm,
				transport: settingsManager.getTransport(),
				providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
				error: message,
				endedAt: new Date().toISOString(),
				sessionId: session.sessionId,
				submittedJobIds,
				acceptedJobIds: acceptedJobs.map((job) => job.proposal.jobId),
				frontierSnapshots,
				protocolDeviations,
				rDiagnostic: rDiagnosticRecord,
				iterationsRequested: options.iterations,
				iterationsCompleted: submittedJobIds.length,
				outputTokenLimit: options.outputTokenLimit,
				hardProviderCallLimit: validRunAssistantResponseLimit,
				outputTokenBudgetEnforcement:
					"post-response checkpoint; ChatGPT Codex subscription backend rejects max_output_tokens",
				compactAfter: options.compactAfter,
				compactionSummaryPolicy: options.compactionSummaryPolicy,
				providerBudgetTracker: jsonSafe(providerBudgetTracker),
				compactionUsageAccounting:
					options.compactionSummaryPolicy === "sealed-isolation"
						? {
								providerCalls: 0,
								outputTokens: 0,
								source: "deterministic session_before_compact extension",
							}
						: "not exposed by current Prime Agent public API",
				compactionCount,
				compactionFirstKeptEntryId,
				sealedContextCheckCount,
				taskMeasurementsCompleted: acceptedJobs.reduce(
					(total, job) => total + (job.measurement?.tasks.length ?? 0),
					0,
				),
				knownUsage: sumUsage(usages),
				agentActiveMs,
				evaluatorWaitMs,
				calendarMs: Date.now() - startedAtMs,
				toolExecutions: toolExecutionAccounting(events),
				branchBudget: controller.budgetStatus(session.sessionId),
				sessionStats: jsonSafe(session.getSessionStats()),
			});
			controller.verifyLedger();
			const failurePath = join(options.outputDir, "result.json");
			await writeFile(
				failurePath,
				`${JSON.stringify(
					{
						ok: false,
						outputDir: options.outputDir,
						arm: options.arm,
						transport: settingsManager.getTransport(),
						providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
						error: message,
						acceptedJobIds: acceptedJobs.map((job) => job.proposal.jobId),
						frontierSnapshots,
						protocolDeviations,
						rDiagnostic: rDiagnosticRecord,
						iterationsRequested: options.iterations,
						iterationsCompleted: submittedJobIds.length,
						outputTokenLimit: options.outputTokenLimit,
						hardProviderCallLimit: validRunAssistantResponseLimit,
						outputTokenBudgetEnforcement:
							"post-response checkpoint; ChatGPT Codex subscription backend rejects max_output_tokens",
						compactAfter: options.compactAfter,
						compactionSummaryPolicy: options.compactionSummaryPolicy,
						providerBudgetTracker: jsonSafe(providerBudgetTracker),
						compactionUsageAccounting:
							options.compactionSummaryPolicy === "sealed-isolation"
								? {
										providerCalls: 0,
										outputTokens: 0,
										source: "deterministic session_before_compact extension",
									}
								: "not exposed by current Prime Agent public API",
						compactionCount,
						compactionFirstKeptEntryId,
						sealedContextCheckCount,
						toolExecutions: toolExecutionAccounting(events),
						knownAssistantUsage: sumUsage(usages),
					},
					null,
					2,
				)}\n`,
				{ encoding: "utf8", mode: 0o600 },
			);
			await chmod(failurePath, 0o600);
		} catch {
			// Preserve the original trajectory failure if failure recording also fails.
		}
		throw error;
	} finally {
		unsubscribe();
		await session.disposeAsync();
	}

	controller.verifyLedger();
	const summary = {
		ok: true,
		outputDir: options.outputDir,
		arm: options.arm,
		transport: settingsManager.getTransport(),
		providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
		model: `${model.provider}/${model.id}`,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		requestedAndLocallyEffectiveServiceTier: FROZEN_CAMPAIGN.model.serviceTier,
		sessionId: session.sessionId,
		sessionFile,
		calibrationJobId: calibrationJob.proposal.jobId,
		calibrationResultPath: options.calibrationResultPath,
		calibrationResultSha256: loadedCalibration.resultSha256,
		startedAt: new Date(startedAtMs).toISOString(),
		finishedAt: new Date().toISOString(),
		submittedJobIds,
		championJobId,
		frontierSnapshots,
		protocolDeviations,
		rDiagnostic: rDiagnosticRecord,
		plannedOutputTokensPerAssistantResponse: PLANNED_OUTPUT_TOKENS_PER_RESPONSE,
		hardProviderCallLimit: validRunAssistantResponseLimit,
		compactionReserveTokens: COMPACTION_RESERVE_TOKENS,
		compactionSummaryPolicy: options.compactionSummaryPolicy,
		sealedCompactionSummarySha256:
			options.compactionSummaryPolicy === "sealed-isolation" ? sha256Text(SEALED_COMPACTION_SUMMARY) : null,
		validRunPlannedOutputTokenBudget,
		knownAssistantUsage: sumUsage(usages),
		providerBudgetTracker: jsonSafe(providerBudgetTracker),
		compactionUsageAccounting:
			options.compactionSummaryPolicy === "sealed-isolation"
				? {
						providerCalls: 0,
						outputTokens: 0,
						source: "deterministic session_before_compact extension",
					}
				: "not exposed by current Prime Agent public API",
		iterationsRequested: options.iterations,
		iterationsCompleted: submittedJobIds.length,
		outputTokenLimit: options.outputTokenLimit,
		outputTokenBudgetEnforcement:
			"post-response checkpoint; ChatGPT Codex subscription backend rejects max_output_tokens",
		compactAfter: options.compactAfter,
		budgetStopReason,
		compactionCount,
		compactionMs,
		compactionKeepRecentTokens,
		compactionFirstKeptEntryId,
		sealedContextCheckCount,
		agentActiveMs,
		evaluatorWaitMs,
		calendarMs: Date.now() - startedAtMs,
		toolExecutions: toolExecutionAccounting(events),
		branchBudget: controller.budgetStatus(session.sessionId),
		jobs: controller.statusForBranch(session.sessionId),
	};
	const resultPath = join(options.outputDir, "result.json");
	await writeFile(resultPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(resultPath, 0o600);
	console.log(JSON.stringify(summary));
}

await main();

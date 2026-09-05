import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { getAgentDir } from "../../config.js";
import type { AgentSession } from "../agent-session.js";
import { AuthStorage } from "../auth-storage.js";
import { createExtensionRuntime, defineTool, type ToolDefinition } from "../extensions/index.js";
import { ModelRegistry } from "../model-registry.js";
import { DefaultResourceLoader, type ResourceLoader } from "../resource-loader.js";
import { createAgentSession } from "../sdk.js";
import { SessionManager } from "../session-manager.js";
import { SettingsManager } from "../settings-manager.js";
import { errorText, PendingWork, type ResultSlot, runSession } from "./session.js";
import {
	DEFAULT_STRATEGY_LIMITS,
	type Evidence,
	type Strategy,
	type StrategyDecision,
	type StrategyEventData,
	type StrategyLimits,
	type StrategyRunOptions,
	type StrategyRunResult,
	type StrategyUsage,
	strategyDecisionSchema,
	type WorkReport,
	type WorkResult,
	workReportSchema,
} from "./types.js";

export type {
	Evidence,
	Strategy,
	StrategyDecision,
	StrategyLimits,
	StrategyRunEvent,
	StrategyRunOptions,
	StrategyRunResult,
	StrategyStopReason,
	StrategyUsage,
	WorkReport,
	WorkResult,
} from "./types.js";
export { DEFAULT_STRATEGY_LIMITS } from "./types.js";

const strategistPrompt = `You select the approach for a task. You do not execute the work.
Compare continuing the current approach with a plausible alternative. Explain why the next step is worth doing,
what it should teach, and the strongest objection to your choice. Repeated local changes without new evidence
deserve review, but a plateau alone does not require switching. Distinguish execution failures, missing information,
and evidence against an approach. Treat worker reports as claims and inspect recorded tool evidence when needed.
Use start only for the first approach, continue for another step within it, switch for a different approach, or stop.
Respect the fixed objective and limits. Stop may mean completion or that no useful next step remains; explain which.
Use choose_strategy as your final and sole tool call in that response. Your decision controls the next assignment.`;

const workerPrompt = `Carry out only the assigned work step using the selected approach.
Return when the assignment is complete, its premise fails, or the stated review condition is reached.
Use report_result as your final and sole tool call in that response. Report observations and unresolved questions
honestly, including contradictory evidence. Artifacts and observations in your report are claims, not host verification.
Do not launch other agents or leave background work running. The controller decides the next assignment.`;

function readLimits(overrides: Partial<StrategyLimits> = {}): StrategyLimits {
	const limits = { ...DEFAULT_STRATEGY_LIMITS, ...overrides };
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
	}
	if (limits.stepTimeoutMs > 2_147_483_647 || limits.runTimeoutMs > 2_147_483_647) {
		throw new Error("Strategy timeouts must fit a Node.js timer.");
	}
	return limits;
}

/** Run bounded work under a fresh strategic review after each step. */
export async function runWithStrategy(options: StrategyRunOptions): Promise<StrategyRunResult> {
	if (!options.objective.trim() || !options.successCriteria.trim()) {
		throw new Error("An objective and success criteria are required.");
	}
	const limits = readLimits(options.limits);
	const reservedTools = new Set(["choose_strategy", "report_result", "read_evidence"]);
	if (options.customTools?.some((tool) => reservedTools.has(tool.name))) {
		throw new Error("Custom tools cannot replace strategy tools.");
	}
	const cwd = resolve(options.cwd ?? process.cwd());
	const agentDir = options.agentDir ?? getAgentDir();
	const parentDir = resolve(options.outputDir ?? join(agentDir, "strategy-runs"));
	await mkdir(parentDir, { recursive: true });
	const outputDir = await mkdtemp(join(parentDir, "run-"));
	await mkdir(join(outputDir, "evidence"));
	const historyPath = join(outputDir, "history.jsonl");
	const strategies: Strategy[] = [];
	const steps: WorkResult[] = [];
	const evidence = new Map<string, Evidence>();
	const sessions = new Set<AgentSession>();
	const pendingWork = new PendingWork();
	const usage: StrategyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let sequence = 0;
	let currentStrategy: Strategy | undefined;
	let workerSession: AgentSession | undefined;
	let workReport: ResultSlot<WorkReport> = { closed: true };
	let runTimedOut = false;
	let assessment = "The work-step limit was reached.";
	let stopReason: StrategyRunResult["stopReason"] = "limit_reached";
	const runAbort = new AbortController();
	const cancel = () => runAbort.abort();
	options.signal?.addEventListener("abort", cancel, { once: true });
	if (options.signal?.aborted) cancel();
	const startedAt = Date.now();
	const runTimer = setTimeout(() => {
		runTimedOut = true;
		cancel();
	}, limits.runTimeoutMs);

	async function saveEvent(data: StrategyEventData): Promise<void> {
		const event = { ...structuredClone(data), sequence: sequence++, recordedAt: new Date().toISOString() };
		await appendFile(historyPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
		try {
			options.onEvent?.(event);
		} catch {
			// Observers cannot prevent cleanup or change the saved decision.
		}
	}

	function checkEvidence(ids: string[]): void {
		for (const id of ids) if (!evidence.has(id)) throw new Error(`Unknown evidence: ${id}`);
	}

	const readEvidence = defineTool({
		name: "read_evidence",
		label: "Read evidence",
		description: "Read a saved tool output by its evidence ID. Offsets are character offsets in the saved JSON.",
		parameters: Type.Object({
			id: Type.String(),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			length: Type.Optional(Type.Integer({ minimum: 1, maximum: 20_000 })),
		}),
		async execute(_id, params) {
			const record = evidence.get(params.id);
			if (!record) throw new Error(`Unknown evidence: ${params.id}`);
			const content = await readFile(record.path, "utf8");
			const offset = params.offset ?? 0;
			return {
				content: [{ type: "text", text: content.slice(offset, offset + (params.length ?? 12_000)) }],
				details: { id: record.id, offset, totalCharacters: content.length },
			};
		},
	});

	const reportResult = defineTool({
		name: "report_result",
		label: "Report result",
		description: "Finish this work step with observations, artifacts, and unresolved questions.",
		parameters: workReportSchema,
		executionMode: "sequential",
		async execute(_id, params) {
			if (workReport.closed) throw new Error("This work step has ended.");
			checkEvidence(params.evidenceIds);
			workReport.value = structuredClone(params);
			workReport.closed = true;
			return { content: [{ type: "text", text: "Work result recorded." }], details: params, terminate: true };
		},
	});

	async function closeSession(session: AgentSession): Promise<void> {
		await session.abort();
		await pendingWork.settle();
		await session.disposeAsync();
		sessions.delete(session);
		await saveEvent({ type: "session_closed", sessionId: session.sessionId });
	}

	try {
		await saveEvent({
			type: "run_started",
			objective: options.objective,
			successCriteria: options.successCriteria,
			cwd,
			limits,
		});
		const authStorage =
			options.authStorage ?? AuthStorage.create(options.agentDir ? join(agentDir, "auth.json") : undefined);
		const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		const savedSettings = SettingsManager.create(cwd, agentDir);
		function createSettings(): SettingsManager {
			const settings = SettingsManager.inMemory(savedSettings.getGlobalSettings());
			settings.applyOverrides(savedSettings.getProjectSettings());
			settings.applyOverrides(options.settings ?? {});
			settings.applyOverrides({ autoRefine: { enabled: false }, retry: { enabled: false } });
			return settings;
		}
		const baseLoader =
			options.resourceLoader ??
			new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: createSettings(),
				noExtensions: true,
			});
		if (!options.resourceLoader) await baseLoader.reload();
		let model = options.model;

		async function createSession(role: "strategist" | "worker", tools: ToolDefinition[]): Promise<AgentSession> {
			runAbort.signal.throwIfAborted();
			const settingsManager = createSettings();
			if (role === "strategist") settingsManager.applyOverrides({ compaction: { enabled: false } });
			const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
			const resourceLoader: ResourceLoader = {
				getExtensions: () => extensions,
				getSkills: () => baseLoader.getSkills(),
				getPrompts: () => baseLoader.getPrompts(),
				getThemes: () => baseLoader.getThemes(),
				getAgentsFiles: () => baseLoader.getAgentsFiles(),
				getSystemPrompt: () => baseLoader.getSystemPrompt(),
				getAppendSystemPrompt: () => [
					...baseLoader.getAppendSystemPrompt(),
					role === "strategist" ? strategistPrompt : workerPrompt,
				],
				extendResources: (paths) => baseLoader.extendResources(paths),
				reload: async () => {},
			};
			const toolNames =
				role === "strategist"
					? tools.map((tool) => tool.name)
					: [...(options.tools ?? ["ipython"]), ...tools.map((tool) => tool.name)];
			const { session } = await createAgentSession({
				cwd,
				agentDir,
				authStorage,
				modelRegistry,
				model,
				settingsManager,
				resourceLoader,
				thinkingLevel: options.thinkingLevel,
				serviceTier: options.serviceTier,
				sessionManager: SessionManager.create(cwd, join(outputDir, "sessions")),
				tools: toolNames,
				allowedToolNames: toolNames,
				customTools: tools,
				includeGoals: false,
				includeCompactSkill: false,
				autonomous: { enabled: false },
				rlmMaxDepth: 0,
				prewarmIpythonKernel: false,
			});
			sessions.add(session);
			model = session.model;
			session.agent.toolExecution = "sequential";
			session.agent.state.tools = session.agent.state.tools.map((tool) => ({
				...tool,
				execute: (...args) => pendingWork.track(() => tool.execute(...args)),
			}));
			session.agent.subscribe((event) => {
				if (event.type !== "message_end" || event.message.role !== "assistant") return;
				const reported = event.message.usage;
				usage.input += reported.input;
				usage.output += reported.output;
				usage.cacheRead += reported.cacheRead;
				usage.cacheWrite += reported.cacheWrite;
				usage.cost += reported.cost.total;
			});
			await saveEvent({
				type: "session_started",
				role,
				sessionId: session.sessionId,
				sessionFile: session.sessionFile,
			});
			return session;
		}

		function taskContext() {
			return {
				objective: options.objective,
				successCriteria: options.successCriteria,
				initialContext: options.initialContext,
				currentStrategy,
				strategies,
				latestResult: steps.at(-1),
				remainingSteps: limits.maxSteps - steps.length,
				remainingTimeMs: Math.max(0, limits.runTimeoutMs - (Date.now() - startedAt)),
			};
		}

		async function reviewStrategy(): Promise<StrategyDecision> {
			const result: ResultSlot<StrategyDecision> = { closed: false };
			const chooseStrategy = defineTool({
				name: "choose_strategy",
				label: "Choose strategy",
				description: "Choose the next work step or stop the run.",
				parameters: strategyDecisionSchema,
				executionMode: "sequential",
				async execute(_id, params) {
					if (result.closed) throw new Error("This strategic review has ended.");
					checkEvidence(params.evidenceIds);
					if (
						(!currentStrategy && ["continue", "switch"].includes(params.action)) ||
						(currentStrategy && params.action === "start")
					) {
						throw new Error(
							currentStrategy ? "Use continue, switch, or stop." : "Use start or stop for the first decision.",
						);
					}
					if (params.action === "continue" && params.approach !== currentStrategy?.approach) {
						throw new Error("Use switch to change the approach.");
					}
					result.value = structuredClone(params);
					result.closed = true;
					return {
						content: [{ type: "text", text: "Strategy decision recorded." }],
						details: params,
						terminate: true,
					};
				},
			});
			const session = await createSession("strategist", [readEvidence, chooseStrategy]);
			try {
				const review = await runSession({
					pendingWork,
					session,
					result,
					resultTool: "choose_strategy",
					maxTurns: limits.maxReviewTurns,
					timeoutMs: limits.stepTimeoutMs,
					signal: runAbort.signal,
					prompt: `Review the task and choose the next step.\n${JSON.stringify({ ...taskContext(), evidence: [...evidence.values()] })}`,
				});
				if (!review.value)
					throw new Error(`Strategic review ${review.status}: ${review.error ?? "no valid decision returned"}`);
				await saveEvent({ type: "decision", decision: review.value });
				return review.value;
			} finally {
				await closeSession(session);
			}
		}

		async function createWorker(): Promise<AgentSession> {
			const session = await createSession("worker", [...(options.customTools ?? []), readEvidence, reportResult]);
			const afterTool = session.agent.afterToolCall;
			session.agent.afterToolCall = (context, signal) =>
				pendingWork.track(async () => {
					const previous = await afterTool?.(context, signal);
					if (reservedTools.has(context.toolCall.name)) return previous;
					const output = { ...context.result, ...previous };
					const id = `evidence-${evidence.size + 1}`;
					const path = join(outputDir, "evidence", `${id}.json`);
					await writeFile(
						path,
						JSON.stringify({
							tool: context.toolCall.name,
							arguments: context.args,
							result: output,
							isError: previous?.isError ?? context.isError,
						}),
						{ flag: "wx", mode: 0o600 },
					);
					const record: Evidence = {
						id,
						sessionId: session.sessionId,
						step: steps.length + 1,
						toolName: context.toolCall.name,
						toolCallId: context.toolCall.id,
						isError: previous?.isError ?? context.isError,
						path,
						preview: output.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("\n")
							.slice(0, 1200),
					};
					evidence.set(id, record);
					await saveEvent({ type: "evidence", evidence: record });
					return {
						...previous,
						content: [
							...output.content,
							{ type: "text", text: `Saved as ${id}. Use read_evidence for the original output.` },
						],
					};
				});
			return session;
		}

		async function runStep(decision: Exclude<StrategyDecision, { action: "stop" }>): Promise<void> {
			if (!workerSession || !currentStrategy) throw new Error("No worker is assigned to the strategy.");
			const session = workerSession;
			const step = steps.length + 1;
			workReport = { closed: false };
			await saveEvent({
				type: "step_started",
				step,
				strategyId: currentStrategy.id,
				sessionId: session.sessionId,
				assignment: decision.nextStep,
			});
			const result = await runSession({
				pendingWork,
				session,
				result: workReport,
				resultTool: "report_result",
				maxTurns: limits.maxWorkerTurns,
				timeoutMs: limits.stepTimeoutMs,
				signal: runAbort.signal,
				prompt: `Carry out this work step.\n${JSON.stringify({
					objective: options.objective,
					successCriteria: options.successCriteria,
					initialContext: options.initialContext,
					assignment: decision,
					latestResult: steps.at(-1),
					evidence: decision.evidenceIds.map((id) => evidence.get(id)),
				})}`,
			});
			const work: WorkResult = {
				step,
				strategyId: currentStrategy.id,
				sessionId: session.sessionId,
				status: result.status,
				report: result.value,
				error: result.error,
				evidence: [...evidence.values()].filter((record) => record.step === step),
			};
			steps.push(work);
			currentStrategy.steps++;
			await saveEvent({ type: "step_finished", result: work });
		}

		while (!runAbort.signal.aborted) {
			const decision = await reviewStrategy();
			if (decision.action === "stop") {
				assessment = decision.reason;
				stopReason = "strategy_stop";
				break;
			}
			if (steps.length >= limits.maxSteps) break;
			if (decision.action === "start" || decision.action === "switch") {
				if (currentStrategy) currentStrategy.leftReason = decision.reason;
				if (workerSession) await closeSession(workerSession);
				workerSession = await createWorker();
				currentStrategy = {
					id: `strategy-${strategies.length + 1}`,
					approach: decision.approach,
					reason: decision.reason,
					sessionId: workerSession.sessionId,
					steps: 0,
				};
				strategies.push(currentStrategy);
			}
			await runStep(decision);
		}
	} catch (error) {
		assessment = errorText(error);
		stopReason = "error";
	} finally {
		clearTimeout(runTimer);
		options.signal?.removeEventListener("abort", cancel);
		for (const session of sessions) {
			try {
				await closeSession(session);
			} catch (error) {
				assessment = `Session cleanup failed: ${errorText(error)}`;
				stopReason = "error";
			}
		}
	}
	if (runAbort.signal.aborted) {
		stopReason = runTimedOut ? "limit_reached" : "cancelled";
		assessment = runTimedOut ? "The run time limit was reached." : "The caller cancelled the run.";
	}
	const result: StrategyRunResult = { assessment, stopReason, strategies, steps, usage, outputDir };
	await saveEvent({ type: "run_finished", result });
	return result;
}

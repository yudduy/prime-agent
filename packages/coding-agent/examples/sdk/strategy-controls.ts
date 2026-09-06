import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSession } from "../../src/core/agent-session.js";
import { defineTool } from "../../src/core/extensions/index.js";
import { type CreateAgentSessionOptions, createAgentSession } from "../../src/core/sdk.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { SettingsManager } from "../../src/core/settings-manager.js";
import type { ModelBudget } from "../../src/core/strategy/budget.js";
import { errorText, PendingWork, type ResultSlot, runSession } from "../../src/core/strategy/session.js";
import { type StrategyUsage, type WorkReport, workReportSchema } from "../../src/core/strategy/types.js";

export interface ControlOptions {
	mode: "continuous" | "fresh";
	sessionOptions: CreateAgentSessionOptions;
	objective: string;
	initialContext: string;
	modelBudget: ModelBudget;
	outputDir: string;
	signal: AbortSignal;
	maxSteps: number;
	maxTurns: number;
	stepTimeoutMs: number;
}

export async function runControl(options: ControlOptions): Promise<{
	steps: WorkReport[];
	sessionIds: string[];
	stopReason: string;
	usage: StrategyUsage;
}> {
	for (const value of [options.maxSteps, options.maxTurns, options.stepTimeoutMs]) {
		if (!Number.isSafeInteger(value) || value < 1) throw new Error("Control limits must be positive integers.");
	}
	const { sessionOptions, modelBudget, outputDir } = options;
	if (!sessionOptions.resourceLoader) throw new Error("Control runs require an explicitly scoped resource loader.");
	if (sessionOptions.customTools?.some((tool) => tool.name === "report_result")) {
		throw new Error("Custom tools cannot replace report_result.");
	}
	await mkdir(outputDir, { recursive: true });
	const historyPath = join(outputDir, "history.jsonl");
	await writeFile(historyPath, "", { flag: "wx", mode: 0o600 });
	const steps: WorkReport[] = [];
	const sessionIds: string[] = [];
	const receipts: Array<{ id: string; [key: string]: unknown }> = [];
	const outcomes: Array<{ step: number; status: string; error?: string }> = [];
	const usage: StrategyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	const pendingWork = new PendingWork();
	const runAbort = new AbortController();
	const signal = AbortSignal.any([options.signal, runAbort.signal]);
	let workerSession: AgentSession | undefined;
	let result: ResultSlot<WorkReport> = { closed: true };
	let step = 0;
	let hostError: string | undefined;
	let stopReason = "limit_reached";
	const saveEvent = (event: object) => appendFile(historyPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });

	const reportResult = defineTool({
		name: "report_result",
		label: "Report result",
		description:
			"Finish this work step. Set needsReview to true if work remains, false only if you claim completion.",
		parameters: workReportSchema,
		executionMode: "sequential",
		async execute(_id, params) {
			if (result.closed) throw new Error("This work step has ended.");
			for (const id of params.evidenceIds) {
				if (!receipts.some((receipt) => receipt.id === id)) throw new Error(`Unknown evidence: ${id}`);
			}
			result.value = structuredClone(params);
			result.closed = true;
			return { content: [{ type: "text", text: "Work result recorded." }], details: params, terminate: true };
		},
	});

	async function closeWorker(): Promise<void> {
		if (!workerSession) return;
		await workerSession.abort();
		await workerSession.waitForIdle();
		await pendingWork.settle();
		await workerSession.disposeAsync();
		await saveEvent({ type: "session_closed", sessionId: workerSession.sessionId });
		workerSession = undefined;
	}

	async function createWorker(): Promise<AgentSession> {
		const settingsManager = SettingsManager.inMemory(sessionOptions.settingsManager?.getGlobalSettings());
		settingsManager.applyOverrides(sessionOptions.settingsManager?.getProjectSettings() ?? {});
		settingsManager.applyOverrides({
			compaction: { enabled: false },
			retry: { enabled: false },
			autoRefine: { enabled: false },
		});
		const customTools = [...(sessionOptions.customTools ?? []), reportResult];
		const tools = [...new Set([...(sessionOptions.tools ?? customTools.map((tool) => tool.name)), "report_result"])];
		const { session } = await createAgentSession({
			...sessionOptions,
			customTools,
			tools,
			allowedToolNames: tools,
			settingsManager,
			sessionManager: SessionManager.create(sessionOptions.cwd ?? process.cwd(), join(outputDir, "sessions")),
			includeGoals: false,
			includeCompactSkill: false,
			initialGoal: undefined,
			autonomous: { enabled: false },
			rlmMaxDepth: 0,
			prewarmIpythonKernel: false,
		});
		workerSession = session;
		sessionIds.push(session.sessionId);
		modelBudget.attach(session.agent);
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
		const afterTool = session.agent.afterToolCall;
		session.agent.afterToolCall = (context, toolSignal) =>
			pendingWork
				.track(async () => {
					const previous = await afterTool?.(context, toolSignal);
					if (context.toolCall.name === "report_result") return previous;
					const output = { ...context.result, ...previous };
					const receipt = {
						id: `evidence-${receipts.length + 1}`,
						step,
						sessionId: session.sessionId,
						tool: context.toolCall.name,
						arguments: context.args,
						result: output,
						isError: previous?.isError ?? context.isError,
					};
					await saveEvent({ type: "tool_result", ...receipt });
					receipts.push(structuredClone(receipt));
					return {
						...previous,
						content: [...output.content, { type: "text" as const, text: `Saved as ${receipt.id}.` }],
					};
				})
				.catch((error: unknown) => {
					hostError = `Could not save tool evidence: ${errorText(error)}`;
					runAbort.abort();
					throw error;
				});
		await saveEvent({ type: "session_started", sessionId: session.sessionId, sessionFile: session.sessionFile });
		return session;
	}

	try {
		await saveEvent({ type: "run_started", mode: options.mode, objective: options.objective });
		for (step = 1; step <= options.maxSteps; step++) {
			if (signal.aborted || modelBudget.stopReason) break;
			if (options.mode === "fresh") await closeWorker();
			const session = workerSession ?? (await createWorker());
			result = { closed: false };
			const prompt = `Complete one bounded work step, then call report_result. Set needsReview=true when work remains; set false only if you claim completion. Worker reports are claims; observed tool results may contradict them.\n${JSON.stringify(
				{
					objective: options.objective,
					initialContext: options.initialContext,
					step,
					...(options.mode === "fresh" ? { previousReports: steps, observedToolResults: receipts, outcomes } : {}),
				},
			)}`;
			await saveEvent({ type: "step_started", step, sessionId: session.sessionId, prompt });
			const work = await runSession({
				session,
				prompt,
				result,
				resultTool: "report_result",
				pendingWork,
				signal,
				maxTurns: options.maxTurns,
				timeoutMs: options.stepTimeoutMs,
			});
			outcomes.push({ step, status: work.status, error: work.error });
			if (work.value) steps.push(work.value);
			await saveEvent({ type: "step_finished", step, sessionId: session.sessionId, ...work });
			if (work.status === "error" || hostError) {
				stopReason = "error";
				break;
			}
			if (signal.aborted || modelBudget.stopReason) break;
			if (work.value?.needsReview === false) {
				stopReason = "worker_stop";
				break;
			}
		}
	} catch (error) {
		hostError = errorText(error);
		stopReason = "error";
	} finally {
		await closeWorker();
	}
	if (hostError) stopReason = "error";
	else if (options.signal.aborted) stopReason = "cancelled";
	else if (modelBudget.stopReason) stopReason = modelBudget.usage.unreportedRequests > 0 ? "error" : "limit_reached";
	await saveEvent({ type: "run_finished", stopReason, error: hostError, usage, modelBudget: modelBudget.usage });
	return { steps, sessionIds, stopReason, usage };
}

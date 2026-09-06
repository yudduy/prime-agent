import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type AssistantMessage,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { heilbronnLimits } from "../../examples/sdk/16-heilbronn-strategy.js";
import { type ControlOptions, runControl } from "../../examples/sdk/strategy-controls.js";
import { defineTool } from "../../src/core/extensions/index.js";
import { ModelBudget, runWithStrategy, type StrategyDecision, type WorkReport } from "../../src/core/strategy/index.js";
import { createHarness, getMessageText, type Harness } from "./harness.js";

const call = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const report: WorkReport = {
	changes: "Saved the construction.",
	observations: ["Four measurements completed."],
	artifacts: [],
	unresolved: [],
	needsReview: false,
	evidenceIds: [],
};
const decide = (action: "start" | "continue"): StrategyDecision => ({
	action,
	approach: "Measure the current construction.",
	reason: "Finish the current measurement sequence.",
	nextStep: "Measure and report the construction.",
	expectedEvidence: "Completed measurements.",
	reviewWhen: "Four turns complete or a report arrives.",
	alternative: "Replace the construction.",
	concern: "Measurements may not improve the score.",
	evidenceIds: [],
});

function delayedResponse() {
	let notifyStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		notifyStarted = resolve;
	});
	let finish: () => void = () => {};
	let aborted = false;
	const response: FauxResponseFactory = (_context, options) =>
		new Promise<AssistantMessage>((resolve, reject) => {
			const signal = options?.signal;
			if (!signal) throw new Error("Expected a managed session cancellation signal.");
			const abort = () => {
				aborted = true;
				reject(new Error("Response interrupted before usage was reported."));
			};
			finish = () => {
				signal.removeEventListener("abort", abort);
				resolve(call("measure", {}));
			};
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
			notifyStarted();
		});
	return { response, started, finish: () => finish(), wasAborted: () => aborted };
}

describe("Heilbronn run boundaries", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		vi.useRealTimers();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});

	async function setup() {
		const harness = await createHarness();
		harnesses.push(harness);
		let measurements = 0;
		const measure = defineTool({
			name: "measure",
			label: "Measure",
			description: "Measure the construction.",
			parameters: Type.Object({}),
			async execute() {
				measurements++;
				return { content: [{ type: "text", text: `Measurement ${measurements} completed.` }], details: {} };
			},
		});
		const cancellation = new AbortController();
		const limits = {
			...heilbronnLimits,
			stepTimeoutMs: (500 * heilbronnLimits.stepTimeoutMs) / heilbronnLimits.runTimeoutMs,
			runTimeoutMs: 500,
		};
		const options: ControlOptions = {
			mode: "continuous",
			objective: "Improve a construction.",
			initialContext: "Measure the construction and preserve results.",
			outputDir: join(harness.tempDir, "run"),
			modelBudget: new ModelBudget({ maxRequests: 20, maxInputBytes: 1_000_000, maxReportedTokens: 1_000_000 }),
			signal: cancellation.signal,
			maxSteps: limits.maxSteps,
			maxTurns: limits.maxWorkerTurns,
			stepTimeoutMs: limits.stepTimeoutMs,
			sessionOptions: {
				cwd: harness.tempDir,
				agentDir: join(harness.tempDir, "agent"),
				model: harness.getModel(),
				authStorage: harness.authStorage,
				modelRegistry: harness.session.modelRegistry,
				resourceLoader: harness.session.resourceLoader,
				settingsManager: harness.settingsManager,
				tools: [measure.name],
				customTools: [measure],
			},
		};
		const slow = delayedResponse();
		const work = [
			fauxAssistantMessage([{ type: "text", text: "worker reasoning retained" }, fauxToolCall("measure", {})], {
				stopReason: "toolUse",
			}),
			call("measure", {}),
			call("measure", {}),
			slow.response,
		];
		const finish: FauxResponseFactory = (context) => {
			expect(context.messages.map(getMessageText).join("\n")).toContain("worker reasoning retained");
			expect(measurements).toBe(4);
			return call("report_result", report);
		};
		return { harness, options, limits, cancellation, slow, work, finish, measurements: () => measurements };
	}

	it("reviews completed turns while preserving the full attempt time limit", () => {
		expect(heilbronnLimits).toEqual({
			maxSteps: 20,
			maxWorkerTurns: 4,
			maxReviewTurns: 3,
			stepTimeoutMs: 1_200_000,
			runTimeoutMs: 1_200_000,
		});
	});

	it("a short step deadline interrupts the fourth response and stops on unknown usage", async () => {
		const { harness, options, cancellation, slow, work, finish, measurements } = await setup();
		harness.setResponses([...work, finish]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const timer = setTimeout(() => cancellation.abort(), 500);
		try {
			const running = runControl({ ...options, maxTurns: 8, stepTimeoutMs: 50 });
			await slow.started;
			await vi.advanceTimersByTimeAsync(50);
			const result = await running;
			expect(slow.wasAborted()).toBe(true);
			expect(cancellation.signal.aborted).toBe(false);
			expect(result.stopReason).toBe("error");
			expect(options.modelBudget.usage).toMatchObject({ requests: 4, unreportedRequests: 1 });
			expect(options.modelBudget.stopReason).toContain("without reported usage");
			expect(measurements()).toBe(3);
			expect(harness.getPendingResponseCount()).toBe(1);
		} finally {
			clearTimeout(timer);
		}
	});

	it("lets a slow fourth response settle and continues in the same worker", async () => {
		const { harness, options, limits, cancellation, slow, work, finish, measurements } = await setup();
		harness.setResponses([...work, finish, fauxAssistantMessage("must not run")]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const timer = setTimeout(() => cancellation.abort(), limits.runTimeoutMs);
		try {
			const running = runControl(options);
			await slow.started;
			await vi.advanceTimersByTimeAsync(50);
			expect(slow.wasAborted()).toBe(false);
			expect(measurements()).toBe(3);
			slow.finish();
			const result = await running;
			expect(result.stopReason).toBe("worker_stop");
			expect(result.sessionIds).toHaveLength(1);
			expect(options.modelBudget.usage).toMatchObject({ requests: 5, unreportedRequests: 0 });
			expect(options.modelBudget.stopReason).toBeUndefined();
			expect(measurements()).toBe(4);
			expect(harness.getPendingResponseCount()).toBe(1);
			const history = await readFile(join(options.outputDir, "history.jsonl"), "utf8");
			expect(history.match(/"type":"step_finished"/g)).toHaveLength(2);
			expect(history).toContain('"status":"turn_limit"');
		} finally {
			clearTimeout(timer);
		}
	});

	it("reviews after four completed worker turns and preserves the worker on continue", async () => {
		const { harness, options, limits, slow, work, finish, measurements } = await setup();
		harness.setResponses([
			call("choose_strategy", decide("start")),
			...work,
			(context) => {
				expect(measurements()).toBe(4);
				const text = context.messages.map(getMessageText).join("\n");
				expect(text).toContain('"status":"turn_limit"');
				expect(text).toContain("Measurement 4 completed.");
				expect(text).not.toContain("worker reasoning retained");
				return call("choose_strategy", decide("continue"));
			},
			finish,
			call("choose_strategy", { action: "stop", reason: "The measurements are recorded.", evidenceIds: [] }),
			fauxAssistantMessage("must not run"),
		]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const running = runWithStrategy({
			...options.sessionOptions,
			task: {
				objective: options.objective,
				successCriteria: "A verified improvement.",
				tools: [],
				createTools: () => options.sessionOptions.customTools ?? [],
			},
			outputDir: options.outputDir,
			modelBudget: options.modelBudget,
			limits,
		});
		await slow.started;
		await vi.advanceTimersByTimeAsync(50);
		expect(slow.wasAborted()).toBe(false);
		slow.finish();
		const result = await running;
		expect(result.stopReason).toBe("strategy_stop");
		expect(result.steps.map((step) => step.status)).toEqual(["turn_limit", "reported"]);
		expect(result.steps[0].sessionId).toBe(result.steps[1].sessionId);
		expect(options.modelBudget.usage).toMatchObject({ requests: 8, unreportedRequests: 0 });
		expect(measurements()).toBe(4);
		expect(harness.getPendingResponseCount()).toBe(1);
	});
});

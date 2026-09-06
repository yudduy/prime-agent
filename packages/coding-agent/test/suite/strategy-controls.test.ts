import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { type ControlOptions, runControl } from "../../examples/sdk/strategy-controls.js";
import { defineTool, type ToolDefinition } from "../../src/core/extensions/index.js";
import { ModelBudget } from "../../src/core/strategy/budget.js";
import type { WorkReport } from "../../src/core/strategy/types.js";
import { createHarness, getMessageText, type Harness } from "./harness.js";

const report = (needsReview = true): WorkReport => ({
	changes: "Edited the candidate.",
	observations: ["Claimed score=10 improvement"],
	artifacts: [],
	unresolved: [],
	needsReview,
	evidenceIds: [],
});
const call = (name: string, params: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, params), { stopReason: "toolUse" });

describe("strategy comparison controls", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(mode: ControlOptions["mode"], customTools: ToolDefinition[] = []) {
		const harness = await createHarness();
		harnesses.push(harness);
		const options: ControlOptions = {
			mode,
			objective: "Improve the score",
			initialContext: "Use observed measurements.",
			modelBudget: new ModelBudget({ maxRequests: 20, maxInputBytes: 1_000_000, maxReportedTokens: 1_000_000 }),
			outputDir: join(harness.tempDir, "control"),
			signal: new AbortController().signal,
			maxSteps: 3,
			maxTurns: 4,
			stepTimeoutMs: 10_000,
			sessionOptions: {
				cwd: harness.tempDir,
				agentDir: join(harness.tempDir, "agent"),
				model: harness.getModel(),
				authStorage: harness.authStorage,
				modelRegistry: harness.session.modelRegistry,
				resourceLoader: harness.session.resourceLoader,
				settingsManager: harness.settingsManager,
				tools: customTools.map((tool) => tool.name),
				customTools,
			},
		};
		return { harness, options };
	}

	it.each(["continuous", "fresh"] as const)("preserves receipts and uses %s worker context", async (mode) => {
		const measure = defineTool({
			name: "measure",
			label: "Measure",
			description: "Measure the candidate.",
			parameters: Type.Object({}),
			async execute() {
				return { content: [{ type: "text", text: "Observed score=100; no improvement" }], details: {} };
			},
		});
		const { harness, options } = await setup(mode, [measure]);
		harness.setResponses([
			fauxAssistantMessage([{ type: "text", text: "private-worker-narrative" }, fauxToolCall("measure", {})], {
				stopReason: "toolUse",
			}),
			call("report_result", report()),
			(context) => {
				const text = context.messages.map(getMessageText).join("\n");
				expect(text).toContain("Observed score=100; no improvement");
				expect(JSON.stringify(context)).toContain("Claimed score=10 improvement");
				expect(text.includes("private-worker-narrative")).toBe(mode === "continuous");
				expect(context.tools?.map((tool) => tool.name).sort()).toEqual(["measure", "report_result"]);
				return call("report_result", report(false));
			},
			fauxAssistantMessage("must not run"),
		]);
		const result = await runControl(options);
		expect(result.stopReason).toBe("worker_stop");
		expect(result.steps).toHaveLength(2);
		expect(result.sessionIds).toHaveLength(mode === "continuous" ? 1 : 2);
		expect(harness.getPendingResponseCount()).toBe(1);
		expect(options.modelBudget.usage.requests).toBe(3);
		expect(options.modelBudget.usage.reportedTokens).toBe(
			result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheWrite,
		);
		expect(harness.settingsManager.getAutoRefineSettings().enabled).toBe(true);
		const history = await readFile(join(options.outputDir, "history.jsonl"), "utf8");
		expect(history).toContain('"type":"tool_result"');
		expect(history).toContain("Observed score=100; no improvement");
		expect(history.match(/"type":"step_finished"/g)).toHaveLength(2);
		expect((await readdir(join(options.outputDir, "sessions"))).length).toBe(result.sessionIds.length);
	});

	it("does not execute tools after a terminal report", async () => {
		let executions = 0;
		const work = defineTool({
			name: "work",
			label: "Work",
			description: "Work",
			parameters: Type.Object({}),
			async execute() {
				executions++;
				return { content: [], details: {} };
			},
		});
		const { harness, options } = await setup("continuous", [work]);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("report_result", report(false)), fauxToolCall("work", {})], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("must not run"),
		]);
		expect((await runControl(options)).stopReason).toBe("worker_stop");
		expect(executions).toBe(0);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("stops at the shared budget and makes no requests when it is already exhausted", async () => {
		const { harness, options } = await setup("fresh");
		options.modelBudget = new ModelBudget({ maxRequests: 1, maxInputBytes: 1_000_000, maxReportedTokens: 1_000_000 });
		harness.setResponses([call("report_result", report()), fauxAssistantMessage("must not run")]);
		const first = await runControl(options);
		expect(first.stopReason).toBe("limit_reached");
		expect(first.sessionIds).toHaveLength(1);
		const second = await runControl({ ...options, outputDir: join(harness.tempDir, "exhausted") });
		expect(second.stopReason).toBe("limit_reached");
		expect(second.sessionIds).toHaveLength(0);
		expect(options.modelBudget.usage.requests).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("passes incomplete outcomes to a fresh worker without its predecessor's conversation", async () => {
		const { harness, options } = await setup("fresh");
		options.maxTurns = 1;
		harness.setResponses([
			fauxAssistantMessage("private unfinished attempt"),
			(context) => {
				const text = context.messages.map(getMessageText).join("\n");
				expect(text).not.toContain("private unfinished attempt");
				expect(text).toContain('"status":"turn_limit"');
				return call("report_result", report(false));
			},
		]);
		const result = await runControl(options);
		expect(result.stopReason).toBe("worker_stop");
		expect(result.steps).toHaveLength(1);
		expect(result.sessionIds).toHaveLength(2);
	});

	it.each(["timeout", "cancellation"])(
		"settles tool cleanup after %s before finishing or starting a worker",
		async (end) => {
			const controller = new AbortController();
			let settled = false;
			const wait = defineTool({
				name: "wait",
				label: "Wait",
				description: "Wait",
				parameters: Type.Object({}),
				async execute(_id, _params, signal) {
					await new Promise<void>((resolve) => {
						signal?.addEventListener(
							"abort",
							() =>
								setTimeout(() => {
									settled = true;
									resolve();
								}, 30),
							{ once: true },
						);
						if (end === "cancellation") controller.abort();
					});
					return { content: [{ type: "text", text: "Cleanup settled" }], details: {} };
				},
			});
			const { harness, options } = await setup("fresh", [wait]);
			options.signal = controller.signal;
			options.stepTimeoutMs = 50;
			harness.setResponses([
				call("wait", {}),
				() => {
					expect(settled).toBe(true);
					return call("report_result", report(false));
				},
			]);
			const result = await runControl(options);
			expect(settled).toBe(true);
			expect(result.stopReason).toBe(end === "timeout" ? "worker_stop" : "cancelled");
			expect(result.sessionIds).toHaveLength(end === "timeout" ? 2 : 1);
			expect(harness.getPendingResponseCount()).toBe(end === "timeout" ? 0 : 1);
		},
	);
});

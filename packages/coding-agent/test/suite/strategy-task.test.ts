import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineTool } from "../../src/core/extensions/index.js";
import {
	runWithStrategy,
	type StrategyRunEvent,
	type TaskCheck,
	type TaskDefinition,
} from "../../src/core/strategy/index.js";
import { createHarness, getMessageText, type Harness } from "./harness.js";

const call = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const conversation = (context: Context) => context.messages.map(getMessageText).join("\n");
const decision = (action: "start" | "switch", evidenceIds: string[] = []) =>
	call("choose_strategy", {
		action,
		evidenceIds,
		approach: action === "start" ? "Prove using a lemma" : "Prove by case analysis",
		reason: "Resolve the remaining question.",
		nextStep: "Inspect the statement and return.",
		expectedEvidence: "A proof or counterexample.",
		reviewWhen: "The statement is settled or a gap is found.",
		alternative: "Enumerate more cases.",
		concern: "Examples may not establish the general case.",
	});
const report = () =>
	call("report_result", {
		changes: "None",
		observations: ["The claim is proved."],
		artifacts: [],
		unresolved: [],
		needsReview: false,
		evidenceIds: [],
	});
const stop = () => call("choose_strategy", { action: "stop", reason: "My assessment is complete.", evidenceIds: [] });

describe("strategy tasks", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		vi.useRealTimers();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(task: Partial<TaskDefinition> = {}) {
		const harness = await createHarness();
		harnesses.push(harness);
		const events: StrategyRunEvent[] = [];
		const options = {
			task: {
				objective: "Prove the claim",
				successCriteria: "A checked proof covering all permitted inputs",
				tools: [],
				...task,
			},
			cwd: harness.tempDir,
			agentDir: join(harness.tempDir, "agent"),
			outputDir: join(harness.tempDir, "runs"),
			model: harness.getModel(),
			authStorage: harness.authStorage,
			modelRegistry: harness.session.modelRegistry,
			resourceLoader: harness.session.resourceLoader,
			onEvent: (event: StrategyRunEvent) => events.push(event),
		};
		return { harness, options, events };
	}

	it("uses a task without a score and preserves host evidence across a strategy switch", async () => {
		let checkedSteps = 0;
		let observedRunId = "";
		const createTools = vi.fn(({ runId }) => {
			observedRunId = runId;
			return [
				defineTool({
					name: "inspect_claim",
					label: "Inspect claim",
					description: "Inspect the claim",
					parameters: Type.Object({}),
					async execute() {
						return { content: [{ type: "text", text: "counterexample: x=0" }], details: {} };
					},
				}),
			];
		});
		const { harness, options, events } = await setup({
			constraints: ["Keep the theorem's domain fixed"],
			createTools,
			async checkResult(work, context) {
				expect(context.runId).toBe(observedRunId);
				expect(work.report?.observations).toEqual(["The claim is proved."]);
				work.report!.observations = ["This mutation must not change the saved worker claim"];
				return ++checkedSteps === 1
					? {
							status: "failed",
							summary: "The proposed proof uses a lemma with a counterexample",
							details: `${"x".repeat(2000)} independently-checked-x=0`,
						}
					: {
							status: "passed",
							summary: "The proof covers every permitted case",
							details: "Proof checker accepted the proof.",
						};
			},
		});
		harness.setResponses([
			(context) => {
				expect(conversation(context)).toContain("Keep the theorem's domain fixed");
				return decision("start");
			},
			call("inspect_claim", {}),
			report(),
			(context) => {
				expect(conversation(context)).toContain('"status":"failed"');
				return call("read_evidence", { id: "evidence-2" });
			},
			(context) => {
				expect(conversation(context)).toContain("independently-checked-x=0");
				return decision("switch", ["evidence-2"]);
			},
			(context) => {
				expect(conversation(context)).toContain("counterexample");
				return report();
			},
			stop(),
			fauxAssistantMessage("must not execute"),
		]);
		const result = await runWithStrategy(options);
		expect(result.check?.status).toBe("passed");
		expect(result.assessment).toBe("My assessment is complete.");
		expect(result.runId).toBe(observedRunId);
		expect(createTools).toHaveBeenCalledTimes(1);
		expect(result.steps[0].sessionId).not.toBe(result.steps[1].sessionId);
		expect(result.steps[0].report?.observations).toEqual(["The claim is proved."]);
		expect(result.steps[0].evidence.map((entry) => entry.source)).toEqual(["tool", "check"]);
		expect(result.steps[0].evidence[1].preview).toContain("[Preview truncated.");
		expect(result.steps[1].evidence[0].preview).not.toContain("[Preview truncated.");
		expect(JSON.parse(await readFile(result.steps[0].evidence[1].path, "utf8"))).toMatchObject({ status: "failed" });
		expect(harness.getPendingResponseCount()).toBe(1);
		const history = (await readFile(join(result.outputDir, "history.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(history).toEqual(JSON.parse(JSON.stringify(events)));
	});

	it.each(["inconclusive", "error", "invalid"] as const)(
		"keeps a %s check separate from the worker's claim and strategist's stop",
		async (kind) => {
			const { harness, options } = await setup({
				async checkResult() {
					if (kind === "error") throw new Error("proof service unavailable");
					if (kind === "invalid") return { status: "passed" } as TaskCheck;
					return {
						status: "inconclusive",
						summary: "An assumption is unresolved",
						details: "No definitive check is available.",
					};
				},
			});
			harness.setResponses([
				decision("start"),
				report(),
				(context) => {
					expect(conversation(context)).toContain(
						kind === "error"
							? "proof service unavailable"
							: kind === "invalid"
								? "invalid result"
								: "An assumption is unresolved",
					);
					return stop();
				},
			]);
			const result = await runWithStrategy(options);
			expect(result.stopReason).toBe("strategy_stop");
			expect(result.steps[0].status).toBe("reported");
			expect(result.check?.status).toBe(kind === "inconclusive" ? "inconclusive" : "error");
		},
	);

	it("does not imply verification when no work or checker ran", async () => {
		const checkResult = vi.fn(
			async (): Promise<TaskCheck> => ({ status: "passed", summary: "Checked", details: "" }),
		);
		const { harness, options } = await setup({ checkResult });
		harness.setResponses([stop()]);
		expect((await runWithStrategy(options)).check).toBeUndefined();
		expect(checkResult).not.toHaveBeenCalled();
	});

	it("checks incomplete work and replaces earlier success with the latest check", async () => {
		const { harness, options } = await setup({
			async checkResult(work) {
				return work.status === "reported"
					? { status: "passed", summary: "Checked this version", details: "" }
					: { status: "inconclusive", summary: "The new version is incomplete", details: "" };
			},
		});
		harness.setResponses([
			decision("start"),
			report(),
			decision("switch"),
			fauxAssistantMessage("Partial work"),
			fauxAssistantMessage("Still partial"),
			stop(),
		]);
		const result = await runWithStrategy(options);
		expect(result.steps.map((work) => work.check?.status)).toEqual(["passed", "inconclusive"]);
		expect(result.check?.status).toBe("inconclusive");
	});

	it.each(["cancel", "timeout"] as const)("awaits check cleanup after %s and rejects a late success", async (kind) => {
		const controller = new AbortController();
		let notifyStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			notifyStarted = resolve;
		});
		let finish: () => void = () => {};
		const cleanup = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let checkSignal: AbortSignal | undefined;
		const { harness, options, events } = await setup({
			async checkResult(_work, context) {
				checkSignal = context.signal;
				notifyStarted();
				await cleanup;
				return { status: "passed", summary: "Late result", details: "" };
			},
		});
		harness.setResponses([decision("start"), report(), stop()]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const running = runWithStrategy({ ...options, signal: controller.signal, limits: { stepTimeoutMs: 1000 } });
		await started;
		if (kind === "cancel") controller.abort();
		else await vi.advanceTimersByTimeAsync(1000);
		expect(checkSignal?.aborted).toBe(true);
		expect(events.filter((event) => event.type === "session_started" && event.role === "strategist")).toHaveLength(1);
		finish();
		const result = await running;
		expect(result.check?.status).toBe("error");
		expect(result.stopReason).toBe(kind === "cancel" ? "cancelled" : "strategy_stop");
	});
});

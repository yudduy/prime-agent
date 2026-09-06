import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStrategyArgs } from "../../examples/sdk/14-strategy.js";
import { defineTool } from "../../src/core/extensions/index.js";
import {
	ModelBudget,
	runWithStrategy,
	type StrategyDecision,
	type StrategyRunEvent,
	type StrategyRunOptions,
	type TaskDefinition,
	type WorkReport,
} from "../../src/core/strategy/index.js";
import { createHarness, getMessageText, type Harness } from "./harness.js";

function decision(
	action: "start" | "continue" | "switch",
	approach = "Tune the current method",
	ids: string[] = [],
): Exclude<StrategyDecision, { action: "stop" }> {
	return {
		action,
		approach,
		reason: "This next step can resolve the remaining uncertainty.",
		nextStep: "Measure the candidate and return the result.",
		expectedEvidence: "The measured score.",
		reviewWhen: "The measurement finishes or the setup fails.",
		alternative: "Replace the method.",
		concern: "Tuning may have reached its useful limit.",
		evidenceIds: ids,
	};
}

function report(ids: string[] = []): WorkReport {
	return {
		changes: "Adjusted the candidate.",
		observations: ["The score did not improve."],
		artifacts: [],
		unresolved: ["Is a different method needed?"],
		needsReview: true,
		evidenceIds: ids,
	};
}

function call(name: string, args: Record<string, unknown>) {
	return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
}

const stop = () =>
	call("choose_strategy", {
		action: "stop",
		reason: "The recorded result is sufficient for this task.",
		evidenceIds: [],
	});
const conversation = (context: Context) => context.messages.map(getMessageText).join("\n");

describe("strategy loop", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		vi.useRealTimers();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});

	async function setup(
		overrides: Partial<StrategyRunOptions> & {
			customTools?: ReturnType<NonNullable<TaskDefinition["createTools"]>>;
		} = {},
	) {
		const harness = await createHarness();
		harnesses.push(harness);
		const events: StrategyRunEvent[] = [];
		const options: StrategyRunOptions = {
			task: {
				objective: "Improve the candidate",
				successCriteria: "A measured improvement or an evidenced stop.",
				tools: [],
				createTools: () => overrides.customTools ?? [],
			},
			cwd: harness.tempDir,
			agentDir: join(harness.tempDir, "agent"),
			outputDir: join(harness.tempDir, "runs"),
			model: harness.getModel(),
			authStorage: harness.authStorage,
			modelRegistry: harness.session.modelRegistry,
			resourceLoader: harness.session.resourceLoader,
			onEvent: (event) => events.push(event),
			...overrides,
		};
		return { harness, events, options };
	}

	it("continues the same worker, switches to a fresh one, and saves evidence and history", async () => {
		const measure = defineTool({
			name: "measure",
			label: "Measure",
			description: "Return the measured score.",
			parameters: Type.Object({}),
			async execute() {
				return { content: [{ type: "text", text: "score=100; no improvement" }], details: {} };
			},
		});
		const { harness, events, options } = await setup({ customTools: [measure] });
		harness.setResponses([
			(context) => {
				expect(context.tools?.map((tool) => tool.name).sort()).toEqual(["choose_strategy", "read_evidence"]);
				for (const tool of context.tools ?? []) expect(tool.parameters).toMatchObject({ type: "object" });
				return call("choose_strategy", decision("start"));
			},
			fauxAssistantMessage([{ type: "text", text: "private-worker-narrative" }, fauxToolCall("measure", {})], {
				stopReason: "toolUse",
			}),
			call("report_result", report(["evidence-1"])),
			(context) => {
				expect(conversation(context)).not.toContain("private-worker-narrative");
				expect(conversation(context)).toContain("score=100");
				expect(conversation(context)).not.toContain("[Preview truncated.");
				return call("choose_strategy", decision("continue", undefined, ["evidence-1"]));
			},
			(context) => {
				expect(conversation(context)).toContain("private-worker-narrative");
				return call("measure", {});
			},
			call("report_result", report(["evidence-2"])),
			(context) => {
				expect(conversation(context)).not.toContain("private-worker-narrative");
				return call("choose_strategy", decision("switch", "Replace the method", ["evidence-2"]));
			},
			(context) => {
				expect(conversation(context)).not.toContain("private-worker-narrative");
				expect(conversation(context)).toContain("Replace the method");
				expect(conversation(context)).toContain("score=100");
				return call("report_result", report(["evidence-2"]));
			},
			stop(),
			fauxAssistantMessage("must not run"),
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("strategy_stop");
		expect(result.steps.map((step) => step.status)).toEqual(["reported", "reported", "reported"]);
		expect(result.steps[0].sessionId).toBe(result.steps[1].sessionId);
		expect(result.steps[2].sessionId).not.toBe(result.steps[1].sessionId);
		expect(result.strategies.map((strategy) => strategy.steps)).toEqual([2, 1]);
		expect(result.strategies[0].leftReason).toBeTruthy();
		expect(result.usage.output).toBeGreaterThan(0);
		expect(harness.getPendingResponseCount()).toBe(1);
		const reviews = events.filter((event) => event.type === "session_started" && event.role === "strategist");
		expect(new Set(reviews.map((event) => event.type === "session_started" && event.sessionId)).size).toBe(4);
		const saved = (await readFile(join(result.outputDir, "history.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(saved).toEqual(JSON.parse(JSON.stringify(events)));
		expect(saved.map((event) => event.sequence)).toEqual(saved.map((_event, index) => index));
		expect(JSON.parse(await readFile(result.steps[0].evidence[0].path, "utf8"))).toMatchObject({
			isError: false,
			result: { content: [{ type: "text", text: "score=100; no improvement" }] },
		});
		for (const event of events) {
			if (event.type === "session_started")
				expect(await readFile(event.sessionFile!, "utf8")).toContain(event.sessionId);
		}
		const closed = events.filter((event) => event.type === "session_closed").map((event) => event.sessionId);
		expect(closed).toContain(result.steps[0].sessionId);
	});

	it("blocks tools after accepting a terminal result in the same response", async () => {
		let executions = 0;
		const work = defineTool({
			name: "work",
			label: "Work",
			description: "Perform work.",
			parameters: Type.Object({}),
			async execute() {
				executions++;
				return { content: [], details: {} };
			},
		});
		const { harness, options } = await setup({ customTools: [work] });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			fauxAssistantMessage([fauxToolCall("report_result", report()), fauxToolCall("work", {})], {
				stopReason: "toolUse",
			}),
			stop(),
			fauxAssistantMessage("must not run"),
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("strategy_stop");
		expect(executions).toBe(0);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it.each(["reported", "turn_limit", "error"] as const)(
		"preserves each assignment for fresh review after %s work, continuation, and switching",
		async (status) => {
			const assignments = (["start", "continue", "switch"] as const).map((action, index) => ({
				...decision(action),
				nextStep: `Run test ${index + 1}.`,
				expectedEvidence: `Observation that distinguishes explanation ${index + 1}.`,
				reviewWhen: `Reconsider if prediction ${index + 1} fails.`,
			}));
			const { harness, options, events } = await setup({ limits: { maxWorkerTurns: 1 } });
			const work = () =>
				status === "reported"
					? call("report_result", report())
					: fauxAssistantMessage("Private worker reasoning", {
							stopReason: status === "error" ? "error" : "stop",
							errorMessage: status === "error" ? "fixture execution failed" : undefined,
						});
			harness.setResponses([
				call("choose_strategy", assignments[0]),
				work(),
				...assignments.flatMap((assignment, index) => [
					(context: Context) => {
						const state = JSON.parse(getMessageText(context.messages[0]).split("\n").slice(1).join("\n"));
						expect(state.latestResult).toMatchObject({ assignment, status });
						expect(conversation(context)).not.toContain("Private worker reasoning");
						return index < 2 ? call("choose_strategy", assignments[index + 1]) : stop();
					},
					...(index < 2 ? [work()] : []),
				]),
			]);
			const result = await runWithStrategy(options);
			expect(result.stopReason).toBe("strategy_stop");
			expect(result.steps).toMatchObject(assignments.map((assignment) => ({ assignment, status })));
			expect(result.steps[0].sessionId).toBe(result.steps[1].sessionId);
			expect(result.steps[2].sessionId).not.toBe(result.steps[1].sessionId);
			expect(events.filter((event) => event.type === "step_finished").map((event) => event.result)).toEqual(
				result.steps,
			);
			expect(harness.getPendingResponseCount()).toBe(0);
		},
	);

	it("continues the registered method when its wording changes and normalizes tool-only fields", async () => {
		const { harness, events, options } = await setup();
		const { evidenceIds: _ids, ...initial } = decision("start");
		harness.setResponses([
			call("choose_strategy", initial),
			call("report_result", report()),
			call("choose_strategy", decision("continue", "Apply the same method to the next part")),
			(context) => {
				expect(conversation(context)).toContain("Adjusted the candidate.");
				return call("report_result", report());
			},
			call("choose_strategy", { ...decision("continue"), action: "stop", reason: "Enough evidence." }),
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("strategy_stop");
		expect(result.strategies).toHaveLength(1);
		expect(result.steps[0].sessionId).toBe(result.steps[1].sessionId);
		const decisions = events.filter((event) => event.type === "decision").map((event) => event.decision);
		expect(decisions[0].evidenceIds).toEqual([]);
		expect(decisions[1]).toMatchObject({ action: "continue", approach: initial.approach });
		expect(decisions[2]).toEqual({ action: "stop", reason: "Enough evidence.", evidenceIds: [] });
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("requires a valid strategy decision before dispatch", async () => {
		const { harness, events, options } = await setup();
		harness.setResponses([
			call("choose_strategy", decision("continue")),
			call("choose_strategy", decision("continue")),
			call("choose_strategy", decision("continue")),
			fauxAssistantMessage("must not run"),
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("error");
		expect(events.some((event) => event.type === "step_started")).toBe(false);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("allows one correction for a missing decision", async () => {
		const { harness, options } = await setup();
		harness.setResponses([fauxAssistantMessage("I suggest stopping."), stop()]);
		expect((await runWithStrategy(options)).stopReason).toBe("strategy_stop");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("returns incomplete work to review without claiming the approach failed", async () => {
		const { harness, options } = await setup();
		harness.setResponses([
			call("choose_strategy", decision("start")),
			fauxAssistantMessage("Partial work."),
			fauxAssistantMessage("Still no report."),
			(context) => {
				expect(conversation(context)).toContain('"status":"incomplete"');
				return stop();
			},
		]);
		const result = await runWithStrategy(options);
		expect(result.steps[0]).toMatchObject({ status: "incomplete", report: undefined });
		expect(result.stopReason).toBe("strategy_stop");
	});

	it("enforces turn and step limits without another worker call", async () => {
		const tool = defineTool({
			name: "work",
			label: "Work",
			description: "Work",
			parameters: Type.Object({}),
			async execute() {
				return { content: [], details: {} };
			},
		});
		const { harness, options } = await setup({ customTools: [tool], limits: { maxWorkerTurns: 1, maxSteps: 1 } });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			call("work", {}),
			(context) => {
				expect(conversation(context)).toContain('"status":"turn_limit"');
				return call("choose_strategy", decision("continue"));
			},
			fauxAssistantMessage("must not run"),
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("limit_reached");
		expect(result.steps).toHaveLength(1);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("cancels an active tool and settles it before closing the session", async () => {
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
						() => {
							settled = true;
							resolve();
						},
						{ once: true },
					);
					controller.abort();
				});
				return { content: [], details: {} };
			},
		});
		const { harness, events, options } = await setup({ customTools: [wait], signal: controller.signal });
		harness.setResponses([call("choose_strategy", decision("start")), call("wait", {}), stop()]);
		const result = await runWithStrategy(options);
		expect(settled).toBe(true);
		expect(result.stopReason).toBe("cancelled");
		expect(result.steps[0].status).toBe("cancelled");
		expect(events.at(-2)?.type).toBe("session_closed");
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("lets a fresh reviewer read original evidence beyond its preview", async () => {
		const content = `${"x".repeat(3000)} full-output-proof`;
		const measure = defineTool({
			name: "measure",
			label: "Measure",
			description: "Measure",
			parameters: Type.Object({}),
			async execute() {
				return { content: [{ type: "text", text: content }], details: {} };
			},
		});
		const { harness, options } = await setup({ customTools: [measure] });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			call("measure", {}),
			call("report_result", report(["evidence-1"])),
			(context) => {
				expect(conversation(context)).toContain("full-output-proof");
				return call("read_evidence", { id: "../../not-registered" });
			},
			(context) => {
				expect(conversation(context)).toContain("Unknown evidence");
				return call("read_evidence", { id: "evidence-1" });
			},
			(context) => {
				expect(getMessageText(context.messages.at(-1))).toContain("full-output-proof");
				return stop();
			},
		]);
		expect((await runWithStrategy(options)).stopReason).toBe("strategy_stop");
	});

	it("shows the latest execution without a worker report and keeps older records readable", async () => {
		const contradiction = `${"trial\n".repeat(600)}The full search ran and contradicted the prediction.`;
		const measure = defineTool({
			name: "measure",
			label: "Measure",
			description: "Run the supplied search.",
			parameters: Type.Object({ script: Type.String() }),
			async execute(_id, params) {
				return {
					content: [
						{ type: "text", text: params.script === "first search" ? contradiction : "Second search completed." },
						{ type: "image", mimeType: "image/png", data: "unshown-image-data" },
					],
					details: { note: "unshown-machine-details" },
				};
			},
		});
		const { harness, options } = await setup({ customTools: [measure], limits: { maxWorkerTurns: 1 } });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			call("measure", { script: "first search" }),
			(context) => {
				const state = JSON.parse(getMessageText(context.messages[0]).split("\n").slice(1).join("\n"));
				expect(state.latestResult).toMatchObject({ status: "turn_limit" });
				expect(state.latestResult.report).toBeUndefined();
				expect(state.latestToolRecords.records).toHaveLength(1);
				expect(state.latestToolRecords.records[0]).toEqual({
					id: "evidence-1",
					tool: "measure",
					isError: false,
					arguments: { script: "first search" },
					result: [{ type: "text", text: contradiction }],
				});
				expect(conversation(context)).not.toContain("unshown-image-data");
				expect(conversation(context)).not.toContain("unshown-machine-details");
				return call("choose_strategy", decision("continue"));
			},
			call("measure", { script: "second search" }),
			(context) => {
				const state = JSON.parse(getMessageText(context.messages[0]).split("\n").slice(1).join("\n"));
				expect(state.latestToolRecords.records.map((record: { id: string }) => record.id)).toEqual(["evidence-2"]);
				expect(state.evidence.map((record: { id: string }) => record.id)).toEqual(["evidence-1", "evidence-2"]);
				return call("read_evidence", { id: "evidence-1" });
			},
			(context) => {
				expect(getMessageText(context.messages.at(-1))).toContain("contradicted the prediction");
				expect(getMessageText(context.messages.at(-1))).toContain("unshown-machine-details");
				return stop();
			},
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("strategy_stop");
		expect(result.steps).toHaveLength(2);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("bounds recent execution bytes while preserving error status, record ends, and access to omitted text", async () => {
		const output = `output-start ${'界"\\\n'.repeat(20_000)}middle-proof ${"trial\n".repeat(20_000)}output-end`;
		const measure = defineTool({
			name: "measure",
			label: "Measure",
			description: "Run a search.",
			parameters: Type.Object({ fail: Type.Boolean() }),
			async execute(_id, params) {
				if (params.fail) throw new Error(output);
				return { content: [{ type: "text", text: output }], details: {} };
			},
		});
		const { harness, options, events } = await setup({ customTools: [measure], limits: { maxWorkerTurns: 1 } });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			fauxAssistantMessage([fauxToolCall("measure", { fail: false }), fauxToolCall("measure", { fail: true })], {
				stopReason: "toolUse",
			}),
			async (context) => {
				const state = JSON.parse(getMessageText(context.messages[0]).split("\n").slice(1).join("\n"));
				expect(Buffer.byteLength(JSON.stringify(state.latestToolRecords))).toBeLessThanOrEqual(40_000);
				expect(state.latestToolRecords.records).toMatchObject([
					{ id: "evidence-1", isError: false },
					{ id: "evidence-2", isError: true },
				]);
				for (const record of state.latestToolRecords.records) {
					expect(record.excerpt).toContain("output-start");
					expect(record.excerpt).toContain("output-end");
					expect(record.excerpt).toContain("[Middle omitted; use read_evidence");
					expect(record.excerpt).not.toContain("middle-proof");
				}
				const event = events.find((event) => event.type === "evidence");
				if (event?.type !== "evidence") throw new Error("Missing saved evidence");
				const saved = await readFile(event.evidence.path, "utf8");
				expect(JSON.parse(saved).result.content[0].text).toBe(output);
				return call("read_evidence", { id: event.evidence.id, offset: saved.indexOf("middle-proof"), length: 100 });
			},
			(context) => {
				expect(getMessageText(context.messages.at(-1))).toContain("middle-proof");
				return stop();
			},
		]);
		expect((await runWithStrategy(options)).stopReason).toBe("strategy_stop");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("marks incomplete previews and exposes paging instructions when long arguments precede the result", async () => {
		const content = `Initial trials supported the method.\n${"trial\n".repeat(500)}Contradiction: the full search already ran and plateaued.`;
		const measure = defineTool({
			name: "measure",
			label: "Measure",
			description: "Run the supplied search.",
			parameters: Type.Object({ script: Type.String() }),
			async execute() {
				return { content: [{ type: "text", text: content }], details: {} };
			},
		});
		const { harness, options } = await setup({ customTools: [measure], limits: { maxWorkerTurns: 1 } });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			call("measure", { script: "setup\n".repeat(3000) }),
			(context) => {
				expect(conversation(context)).toContain('"status":"turn_limit"');
				expect(conversation(context)).toContain("[Preview truncated.");
				expect(conversation(context)).toContain("Contradiction:");
				return call("read_evidence", { id: "evidence-1" });
			},
			(context) => {
				expect(getMessageText(context.messages.at(-1))).toContain('"offset":12000');
				expect(getMessageText(context.messages.at(-1))).not.toContain("Contradiction:");
				return call("read_evidence", { id: "evidence-1", offset: 12000, length: 20000 });
			},
			(context) => {
				expect(getMessageText(context.messages.at(-1))).toContain("End of saved record.");
				expect(getMessageText(context.messages.at(-1))).toContain(
					"Contradiction: the full search already ran and plateaued.",
				);
				return stop();
			},
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("strategy_stop");
		expect(result.steps[0].report).toBeUndefined();
		expect(JSON.parse(await readFile(result.steps[0].evidence[0].path, "utf8")).result.content[0].text).toBe(content);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("passes tool execution failures to review as failures of execution", async () => {
		const broken = defineTool({
			name: "broken",
			label: "Broken",
			description: "Broken",
			parameters: Type.Object({}),
			async execute() {
				throw new Error("fixture service unavailable");
			},
		});
		const { harness, options } = await setup({ customTools: [broken] });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			call("broken", {}),
			call("report_result", report(["evidence-1"])),
			(context) => {
				expect(conversation(context)).toContain('"isError":true');
				expect(conversation(context)).toContain("fixture service unavailable");
				return stop();
			},
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("strategy_stop");
		expect(result.steps[0].evidence[0].isError).toBe(true);
	});

	it("passes a provider failure back to review without automatic retries", async () => {
		const { harness, options } = await setup();
		harness.setResponses([
			call("choose_strategy", decision("start")),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture provider failed" }),
			(context) => {
				expect(conversation(context)).toContain("fixture provider failed");
				return stop();
			},
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("strategy_stop");
		expect(result.steps[0].status).toBe("error");
	});

	it.each(["step", "run"] as const)("enforces the %s timeout while a tool runs", async (limit) => {
		let notifyStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			notifyStarted = resolve;
		});
		let settled = false;
		const wait = defineTool({
			name: "wait",
			label: "Wait",
			description: "Wait",
			parameters: Type.Object({}),
			async execute(_id, _params, signal) {
				notifyStarted();
				await new Promise<void>((resolve) =>
					signal?.addEventListener(
						"abort",
						() => {
							settled = true;
							resolve();
						},
						{ once: true },
					),
				);
				return { content: [], details: {} };
			},
		});
		const { harness, options } = await setup({
			customTools: [wait],
			limits: limit === "step" ? { stepTimeoutMs: 1000 } : { runTimeoutMs: 1000 },
		});
		harness.setResponses([call("choose_strategy", decision("start")), call("wait", {}), stop()]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const running = runWithStrategy(options);
		await started;
		await vi.advanceTimersByTimeAsync(1000);
		const result = await running;
		expect(settled).toBe(true);
		expect(result.stopReason).toBe(limit === "step" ? "strategy_stop" : "limit_reached");
		expect(result.steps[0].status).toBe(limit === "step" ? "timeout" : "cancelled");
	});

	it("does not call a provider when already cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		const { harness, options } = await setup({ signal: controller.signal });
		harness.setResponses([stop()]);
		expect((await runWithStrategy(options)).stopReason).toBe("cancelled");
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("stops when tool evidence cannot be saved", async () => {
		const work = defineTool({
			name: "work",
			label: "Work",
			description: "Work",
			parameters: Type.Object({}),
			async execute() {
				return { content: [], details: {} };
			},
		});
		const { harness, options } = await setup({ customTools: [work] });
		options.onEvent = (event) => {
			if (event.type === "session_started" && event.role === "worker") {
				mkdirSync(join(dirname(dirname(event.sessionFile!)), "evidence", "evidence-1.json"));
			}
		};
		harness.setResponses([call("choose_strategy", decision("start")), call("work", {}), stop()]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("error");
		expect(result.assessment).toContain("Could not save tool evidence");
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("validates action-specific fields before choosing work", async () => {
		const { harness, options } = await setup();
		harness.setResponses([
			call("choose_strategy", { action: "start", reason: "Try it", evidenceIds: [] }),
			(context) => {
				expect(conversation(context)).toContain("Work decisions require");
				return stop();
			},
		]);
		expect((await runWithStrategy(options)).steps).toHaveLength(0);
	});

	it("keeps project instructions while isolating managed session settings", async () => {
		const { harness, options } = await setup();
		options.resourceLoader = {
			...harness.session.resourceLoader,
			getAgentsFiles: () => ({
				agentsFiles: [{ path: join(harness.tempDir, "AGENTS.md"), content: "project-rule-marker" }],
			}),
		};
		harness.setResponses([
			(context) => {
				expect(context.systemPrompt).toContain("project-rule-marker");
				return stop();
			},
		]);
		expect((await runWithStrategy(options)).stopReason).toBe("strategy_stop");
		expect(harness.settingsManager.getAutoRefineSettings().enabled).toBe(true);
	});

	it("parses runner options without starting a run", () => {
		expect(parseStrategyArgs(["--help"])).toBeUndefined();
		expect(
			parseStrategyArgs(["--objective", "Fix it", "--success-criteria", "Checks pass", "--max-steps", "2"]),
		).toMatchObject({ task: { objective: "Fix it", successCriteria: "Checks pass" }, limits: { maxSteps: 2 } });
		for (const count of ["0", "-1", "1.5", "2x", "1e3"]) {
			expect(() =>
				parseStrategyArgs(["--objective", "Fix it", "--success-criteria", "Checks pass", `--max-steps=${count}`]),
			).toThrow("positive integer");
		}
		expect(() => parseStrategyArgs([])).toThrow("--objective");
	});

	it("shares the model request budget across reviewers and replacement workers", async () => {
		const modelBudget = new ModelBudget({ maxRequests: 4, maxInputBytes: 1_000_000, maxReportedTokens: 1_000_000 });
		const { harness, options } = await setup({ modelBudget });
		harness.setResponses([
			call("choose_strategy", decision("start")),
			call("report_result", report()),
			(context) => {
				expect(conversation(context)).toContain('"remainingModelBudget":{"requests":2');
				return call("choose_strategy", decision("switch", "Try another method"));
			},
			call("report_result", report()),
			stop(),
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("limit_reached");
		expect(result.assessment).toContain("model request limit");
		expect(result.strategies).toHaveLength(2);
		expect(result.modelBudget?.usage.requests).toBe(4);
		expect(result.modelBudget?.usage.reportedTokens).toBe(
			result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheWrite,
		);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("rejects oversized input before calling the provider", async () => {
		const modelBudget = new ModelBudget({ maxRequests: 4, maxInputBytes: 1, maxReportedTokens: 1_000_000 });
		const { harness, options } = await setup({ modelBudget });
		harness.setResponses([stop()]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("limit_reached");
		expect(result.assessment).toContain("input byte limit");
		expect(result.modelBudget?.usage.requests).toBe(0);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("keeps missing usage as a runtime error and prevents another request", async () => {
		const modelBudget = new ModelBudget({ maxRequests: 4, maxInputBytes: 1_000_000, maxReportedTokens: 1_000_000 });
		const { harness, options } = await setup({ modelBudget });
		harness.setResponses([
			() => {
				throw new Error("fixture transport failure");
			},
			stop(),
		]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("error");
		expect(result.assessment).toContain("fixture transport failure");
		expect(result.modelBudget?.usage.unreportedRequests).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("stops after reported token usage reaches the threshold, including cached input", async () => {
		const modelBudget = new ModelBudget({ maxRequests: 10, maxInputBytes: 1_000_000, maxReportedTokens: 1 });
		const { harness, options } = await setup({ modelBudget });
		harness.setResponses([call("choose_strategy", decision("start")), call("report_result", report())]);
		const result = await runWithStrategy(options);
		expect(result.stopReason).toBe("limit_reached");
		expect(result.assessment).toContain("token limit");
		expect(result.steps).toHaveLength(0);
		expect(result.modelBudget?.usage.reportedTokens).toBeGreaterThan(1);
		expect(harness.getPendingResponseCount()).toBe(1);
	});
});

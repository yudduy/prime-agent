import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("AgentSession provider request abort", () => {
	let harness: Harness | undefined;

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("does not dispatch a tool continuation after a pre-request extension abort", async () => {
		let providerRequestHooks = 0;
		let toolRuns = 0;
		const tool: AgentTool = {
			name: "continue_once",
			label: "Continue once",
			description: "Returns a deterministic result before the model continuation.",
			parameters: Type.Object({}),
			execute: async () => {
				toolRuns++;
				return { content: [{ type: "text", text: "continued" }], details: {} };
			},
		};

		harness = await createHarness({
			tools: [tool],
			extensionFactories: [
				(pi) => {
					pi.on("before_provider_request", (event, ctx) => {
						providerRequestHooks++;
						if (providerRequestHooks === 2) ctx.abort();
						return event.payload;
					});
				},
			],
		});
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("continue_once", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("must not be dispatched"),
		]);

		await harness.session.prompt("start");

		expect(providerRequestHooks).toBe(2);
		expect(toolRuns).toBe(1);
		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(1);
	});
});

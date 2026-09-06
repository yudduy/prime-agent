import { afterEach, describe, expect, it, vi } from "vitest";
import { streamSimpleOpenAICodexResponses } from "../src/providers/openai-codex-responses.js";
import type { Context, Model } from "../src/types.js";

const model: Model<"openai-codex-responses"> = {
	id: "gpt-5.1-codex",
	name: "Test Codex",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://codex.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};
const context: Context = {
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
};
const tokenPayload = Buffer.from(
	JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } }),
).toString("base64");
const apiKey = `test.${tokenPayload}.test`;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe.each(["HTTP 429", "transport error"])("Codex retry limit after %s", (failure) => {
	it.each([
		{ maxRetries: 0, expectedRequests: 1 },
		{ maxRetries: 1, expectedRequests: 2 },
		{ maxRetries: undefined, expectedRequests: 4 },
	])("makes $expectedRequests requests with maxRetries=$maxRetries", async ({ maxRetries, expectedRequests }) => {
		vi.useFakeTimers();
		const fetchMock = vi.fn(async () => {
			if (failure === "transport error") throw new Error("Connection failed");
			return new Response(JSON.stringify({ error: { message: "Rate limited" } }), { status: 429 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const resultPromise = streamSimpleOpenAICodexResponses(model, context, {
			apiKey,
			transport: "sse",
			maxRetries,
		}).result();
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(fetchMock).toHaveBeenCalledTimes(expectedRequests);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain(failure === "transport error" ? "Connection failed" : "usage limit");
	});
});

it.each(["sse", "auto"] as const)(
	"does not start %s transport after onPayload cancels the request",
	async (transport) => {
		const controller = new AbortController();
		const fetchMock = vi.fn(async () => new Response("Unexpected request", { status: 500 }));
		const websocketMock = vi.fn(() => {
			throw new Error("Unexpected WebSocket connection");
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("WebSocket", websocketMock);

		const result = await streamSimpleOpenAICodexResponses(model, context, {
			apiKey,
			transport,
			maxRetries: 0,
			signal: controller.signal,
			onPayload: async () => {
				controller.abort();
			},
		}).result();

		expect(result.stopReason).toBe("aborted");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(websocketMock).not.toHaveBeenCalled();
	},
);

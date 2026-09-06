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
		if (failure === "HTTP 429") expect(result.diagnostics).toBeUndefined();
		else expect(result.diagnostics).toHaveLength(expectedRequests);
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
		expect(result.diagnostics).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(websocketMock).not.toHaveBeenCalled();
	},
);

it("records safe SSE failure causes without retrying or persisting sensitive error fields", async () => {
	const secret = "sentinel-secret-in-transport-error";
	const cause = Object.assign(new Error(secret), {
		code: "UND_ERR_SOCKET",
		stack: secret,
		headers: { authorization: secret },
		body: secret,
		cause: Object.assign(new Error(secret), { code: "ECONNRESET", stack: secret, token: secret }),
	});
	const error = new TypeError("fetch failed", { cause });
	const fetchMock = vi.fn(async () => {
		throw error;
	});
	vi.stubGlobal("fetch", fetchMock);

	const result = await streamSimpleOpenAICodexResponses(model, context, {
		apiKey,
		transport: "sse",
		maxRetries: 0,
	}).result();

	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(result.stopReason).toBe("error");
	expect(result.errorMessage).toBe("fetch failed");
	expect(result.usage.totalTokens).toBe(0);
	expect(result.diagnostics).toEqual([
		{
			type: "provider_transport_failure",
			timestamp: expect.any(Number),
			error: { name: "TypeError", message: "SSE transport failed.", code: undefined },
			details: {
				transport: "sse",
				phase: "before_response_headers",
				attempt: 1,
				causes: [
					{ name: "Error", code: "UND_ERR_SOCKET" },
					{ name: "Error", code: "ECONNRESET" },
				],
			},
		},
	]);
	expect(JSON.stringify(result.diagnostics)).not.toContain(secret);
	expect(JSON.stringify(result.diagnostics)).not.toContain(apiKey);
	expect(JSON.stringify(result.diagnostics)).not.toContain("stack");
});

it("omits unknown cause names and codes and bounds cyclic cause chains", async () => {
	const secret = "sentinel-private-cause";
	const cause = { name: secret, code: secret, cause: {} };
	cause.cause = cause;
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new TypeError("fetch failed", { cause });
		}),
	);
	const result = await streamSimpleOpenAICodexResponses(model, context, {
		apiKey,
		transport: "sse",
		maxRetries: 0,
	}).result();
	expect(result.diagnostics?.[0].details?.causes).toEqual([{ name: "Error", code: undefined }]);
	expect(JSON.stringify(result.diagnostics)).not.toContain(secret);
});

it.each([
	{ name: "HeadersOverflowError", code: "UND_ERR_HEADERS_OVERFLOW" },
	{ name: "HTTPParserError", code: undefined },
])("preserves the standard $name cause without exposing response data", async ({ name, code }) => {
	const secret = "sentinel-private-response-data";
	const cause = Object.assign(new Error(secret), { name, code, stack: secret, data: secret });
	const fetchMock = vi.fn(async () => {
		throw new TypeError("fetch failed", { cause });
	});
	vi.stubGlobal("fetch", fetchMock);
	const result = await streamSimpleOpenAICodexResponses(model, context, {
		apiKey,
		transport: "sse",
		maxRetries: 0,
	}).result();

	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(result.stopReason).toBe("error");
	expect(result.errorMessage).toBe("fetch failed");
	expect(result.usage.totalTokens).toBe(0);
	expect(result.diagnostics?.[0].details).toEqual({
		transport: "sse",
		phase: "before_response_headers",
		attempt: 1,
		causes: [{ name, code }],
	});
	expect(JSON.stringify(result.diagnostics)).not.toContain(secret);
	expect(JSON.stringify(result.diagnostics)).not.toContain(apiKey);
	expect(JSON.stringify(result.diagnostics)).not.toContain("stack");
});

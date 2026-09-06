import type { Agent, StreamFn } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export interface ModelBudgetLimits {
	maxRequests: number;
	/** Cumulative UTF-8 bytes of serialized model contexts, including repeated input. */
	maxInputBytes: number;
	/** Checked between responses; one in-flight response can exceed this threshold. */
	maxReportedTokens: number;
}

export interface ModelBudgetUsage {
	requests: number;
	inputBytes: number;
	reportedTokens: number;
	unreportedRequests: number;
}

/** Shared across sequential sessions. Disable compaction when attaching this budget. */
export class ModelBudget {
	readonly limits: Readonly<ModelBudgetLimits>;
	private readonly counts: ModelBudgetUsage = { requests: 0, inputBytes: 0, reportedTokens: 0, unreportedRequests: 0 };
	private rejectedInput = false;
	private readonly attached = new WeakSet<Agent>();

	constructor(limits: ModelBudgetLimits) {
		for (const [name, value] of Object.entries(limits)) {
			if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
		}
		this.limits = Object.freeze({ ...limits });
	}

	get usage(): ModelBudgetUsage {
		return { ...this.counts };
	}

	get stopReason(): string | undefined {
		if (this.counts.unreportedRequests > 0)
			return "A model request ended without reported usage; further requests stopped.";
		if (this.rejectedInput) return "The cumulative model input byte limit was reached.";
		if (this.counts.reportedTokens >= this.limits.maxReportedTokens)
			return "The reported model token limit was reached.";
		if (this.counts.requests >= this.limits.maxRequests) return "The model request limit was reached.";
		return undefined;
	}

	attach(agent: Agent): void {
		if (this.attached.has(agent)) throw new Error("This model budget is already attached to the agent.");
		this.attached.add(agent);
		const beforeTurn = agent.shouldStopBeforeTurn;
		agent.shouldStopBeforeTurn = () => this.stopReason !== undefined || (beforeTurn?.() ?? false);
		agent.streamFn = this.wrap(agent.streamFn);
	}

	private wrap(stream: StreamFn): StreamFn {
		return async (model, context, options) => {
			const inputBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
			if (this.counts.inputBytes + inputBytes > this.limits.maxInputBytes) this.rejectedInput = true;
			const reason = this.stopReason;
			if (reason) return this.failure(model, reason);
			this.counts.requests++;
			this.counts.inputBytes += inputBytes;
			try {
				const response = await stream(model, context, { ...options, maxRetries: 0, transport: "sse" });
				void response.result().then((message) => {
					const usage = message.usage;
					const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
					if (!Number.isFinite(tokens) || tokens <= 0) this.counts.unreportedRequests++;
					else this.counts.reportedTokens += tokens;
				});
				return response;
			} catch (error) {
				this.counts.unreportedRequests++;
				return this.failure(model, error instanceof Error ? error.message : String(error));
			}
		};
	}

	private failure(model: Parameters<StreamFn>[0], reason: string) {
		const response = createAssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			api: model.api,
			provider: model.provider,
			model: model.id,
			content: [],
			stopReason: "error",
			errorMessage: reason,
			timestamp: Date.now(),
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		response.push({ type: "error", reason: "error", error: message });
		response.end();
		return response;
	}
}

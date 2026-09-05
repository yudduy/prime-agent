import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "../agent-session.js";

export interface SessionResult<T> {
	value?: T;
	status: "reported" | "incomplete" | "turn_limit" | "timeout" | "cancelled" | "error";
	error?: string;
}

export interface ResultSlot<T> {
	value?: T;
	closed: boolean;
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Agent cancellation can return before an aborted tool's cleanup has settled. */
export class PendingWork {
	private readonly pending = new Set<Promise<unknown>>();

	track<T>(operation: () => Promise<T>): Promise<T> {
		const promise = operation();
		this.pending.add(promise);
		void promise.then(
			() => this.pending.delete(promise),
			() => this.pending.delete(promise),
		);
		return promise;
	}

	async settle(): Promise<void> {
		while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
	}
}

/** Own one assignment, including its optional correction and cancellation. */
export async function runSession<T>(options: {
	session: AgentSession;
	prompt: string;
	result: ResultSlot<T>;
	resultTool: string;
	maxTurns: number;
	timeoutMs: number;
	signal: AbortSignal;
	pendingWork: PendingWork;
}): Promise<SessionResult<T>> {
	const { session, result, signal } = options;
	let turns = 0;
	let timedOut = false;
	let lastMessage: AgentMessage | undefined;
	const beforeTurn = session.agent.shouldStopBeforeTurn;
	const afterTurn = session.agent.shouldStopAfterTurn;
	const beforeTool = session.agent.beforeToolCall;
	const shouldStop = () => result.closed || signal.aborted || timedOut || turns >= options.maxTurns;
	const unsubscribe = session.agent.subscribe((event) => {
		if (event.type === "turn_end") {
			turns++;
			lastMessage = event.message;
		}
	});
	session.agent.shouldStopBeforeTurn = () => shouldStop() || (beforeTurn?.() ?? false);
	session.agent.shouldStopAfterTurn = async (context) => shouldStop() || (await afterTurn?.(context)) === true;
	session.agent.beforeToolCall = async (context, toolSignal) => {
		if (result.closed || signal.aborted || timedOut) return { block: true, reason: "This assignment has ended." };
		return beforeTool?.(context, toolSignal);
	};
	const abort = () => session.requestAbort();
	signal.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		abort();
	}, options.timeoutMs);
	try {
		for (let attempt = 0; attempt < 2 && !shouldStop(); attempt++) {
			await session.prompt(
				attempt === 0
					? options.prompt
					: `Return the required result using ${options.resultTool}. Use the evidence already gathered.`,
			);
			await session.waitForIdle();
			if (lastMessage?.role === "assistant" && lastMessage.stopReason === "error") {
				return { status: "error", error: lastMessage.errorMessage ?? "Provider request failed." };
			}
			if (lastMessage?.role === "assistant" && lastMessage.stopReason === "aborted") break;
			if (result.value !== undefined) break;
		}
		if (signal.aborted) return { status: "cancelled" };
		if (timedOut) return { status: "timeout" };
		if (result.value !== undefined) return { status: "reported", value: result.value };
		if (lastMessage?.role === "assistant" && lastMessage.stopReason === "aborted") {
			return { status: "error", error: "Session aborted without a controller cancellation." };
		}
		return { status: turns >= options.maxTurns ? "turn_limit" : "incomplete" };
	} catch (error) {
		return {
			status: signal.aborted ? "cancelled" : timedOut ? "timeout" : "error",
			error: errorText(error),
		};
	} finally {
		result.closed = true;
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
		await session.abort();
		await session.waitForIdle();
		await options.pendingWork.settle();
		unsubscribe();
		session.agent.shouldStopBeforeTurn = beforeTurn;
		session.agent.shouldStopAfterTurn = afterTurn;
		session.agent.beforeToolCall = beforeTool;
	}
}

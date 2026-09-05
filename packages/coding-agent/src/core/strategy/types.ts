import { type Static, Type } from "typebox";
import type { CreateAgentSessionOptions } from "../sdk.js";
import type { Settings } from "../settings-manager.js";

const text = Type.String({ minLength: 1 });
const evidenceIds = Type.Array(text);

export const strategyDecisionSchema = Type.Union([
	Type.Object(
		{
			action: Type.Union([Type.Literal("start"), Type.Literal("continue"), Type.Literal("switch")]),
			approach: text,
			reason: text,
			nextStep: text,
			expectedEvidence: text,
			reviewWhen: text,
			alternative: text,
			concern: text,
			evidenceIds,
		},
		{ additionalProperties: false },
	),
	Type.Object({ action: Type.Literal("stop"), reason: text, evidenceIds }, { additionalProperties: false }),
]);

export const workReportSchema = Type.Object(
	{
		changes: Type.String(),
		observations: Type.Array(text),
		artifacts: Type.Array(text),
		unresolved: Type.Array(text),
		needsReview: Type.Boolean(),
		evidenceIds,
	},
	{ additionalProperties: false },
);

export type StrategyDecision = Static<typeof strategyDecisionSchema>;
export type WorkReport = Static<typeof workReportSchema>;

export interface Strategy {
	id: string;
	approach: string;
	reason: string;
	sessionId: string;
	steps: number;
	leftReason?: string;
}

export interface StrategyLimits {
	maxSteps: number;
	maxWorkerTurns: number;
	maxReviewTurns: number;
	stepTimeoutMs: number;
	runTimeoutMs: number;
}

export const DEFAULT_STRATEGY_LIMITS: Readonly<StrategyLimits> = {
	maxSteps: 5,
	maxWorkerTurns: 12,
	maxReviewTurns: 3,
	stepTimeoutMs: 5 * 60_000,
	runTimeoutMs: 30 * 60_000,
};

export interface Evidence {
	id: string;
	sessionId: string;
	step: number;
	toolName: string;
	toolCallId: string;
	isError: boolean;
	path: string;
	preview: string;
}

export interface WorkResult {
	step: number;
	strategyId: string;
	sessionId: string;
	status: "reported" | "incomplete" | "turn_limit" | "timeout" | "cancelled" | "error";
	report?: WorkReport;
	error?: string;
	evidence: Evidence[];
}

export interface StrategyUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export type StrategyStopReason = "strategy_stop" | "limit_reached" | "cancelled" | "error";

export interface StrategyRunResult {
	assessment: string;
	stopReason: StrategyStopReason;
	strategies: Strategy[];
	steps: WorkResult[];
	usage: StrategyUsage;
	outputDir: string;
}

type EventData =
	| { type: "run_started"; objective: string; successCriteria: string; limits: StrategyLimits; cwd: string }
	| { type: "session_started"; role: "strategist" | "worker"; sessionId: string; sessionFile: string | undefined }
	| { type: "session_closed"; sessionId: string }
	| { type: "decision"; decision: StrategyDecision }
	| { type: "step_started"; step: number; strategyId: string; sessionId: string; assignment: string }
	| { type: "evidence"; evidence: Evidence }
	| { type: "step_finished"; result: WorkResult }
	| { type: "run_finished"; result: StrategyRunResult };

export type StrategyRunEvent = EventData & { sequence: number; recordedAt: string };
export type StrategyEventData = EventData;

export interface StrategyRunOptions
	extends Pick<
		CreateAgentSessionOptions,
		| "cwd"
		| "agentDir"
		| "model"
		| "authStorage"
		| "modelRegistry"
		| "thinkingLevel"
		| "serviceTier"
		| "resourceLoader"
	> {
	objective: string;
	successCriteria: string;
	initialContext?: string;
	settings?: Partial<Settings>;
	/** Worker tools. Defaults to ipython; custom tools must also be named here. */
	tools?: string[];
	customTools?: CreateAgentSessionOptions["customTools"];
	limits?: Partial<StrategyLimits>;
	/** Parent directory for a new run directory. Existing runs are never reopened. */
	outputDir?: string;
	signal?: AbortSignal;
	/** A synchronous observer. Its exceptions do not interrupt the saved run. */
	onEvent?: (event: StrategyRunEvent) => void;
}

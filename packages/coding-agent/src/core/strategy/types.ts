import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/index.js";
import type { CreateAgentSessionOptions } from "../sdk.js";
import type { Settings } from "../settings-manager.js";
import type { ModelBudget, ModelBudgetLimits, ModelBudgetUsage } from "./budget.js";

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

// Providers expect an object at the root of a function's parameter schema.
export const strategyToolSchema = Type.Object(
	{
		action: Type.Union([
			Type.Literal("start"),
			Type.Literal("continue"),
			Type.Literal("switch"),
			Type.Literal("stop"),
		]),
		reason: text,
		evidenceIds: Type.Optional(evidenceIds),
		approach: Type.Optional(text),
		nextStep: Type.Optional(text),
		expectedEvidence: Type.Optional(text),
		reviewWhen: Type.Optional(text),
		alternative: Type.Optional(text),
		concern: Type.Optional(text),
	},
	{ additionalProperties: false },
);

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

export type Evidence = {
	id: string;
	sessionId: string;
	step: number;
	isError: boolean;
	path: string;
	preview: string;
} & (
	| { source: "tool"; toolName: string; toolCallId: string }
	| { source: "check" }
	| { source: "step"; status: WorkResult["status"] }
);

export const taskCheckSchema = Type.Object(
	{
		status: Type.Union([
			Type.Literal("passed"),
			Type.Literal("failed"),
			Type.Literal("inconclusive"),
			Type.Literal("error"),
		]),
		summary: text,
		/** Original check output, such as test results or source-supported findings. */
		details: Type.String(),
	},
	{ additionalProperties: false },
);

export type TaskCheck = Static<typeof taskCheckSchema>;

export interface TaskContext {
	readonly runId: string;
	readonly cwd: string;
	readonly outputDir: string;
	readonly signal: AbortSignal;
}

export interface TaskDefinition {
	objective: string;
	successCriteria: string;
	constraints?: string[];
	initialContext?: string;
	/** Built-in worker tools. Defaults to ipython. */
	tools?: string[];
	/** Called once per run. All workers share these tools and the same run identity. */
	createTools?: (context: TaskContext) => ToolDefinition[];
	/** Host-owned check after each step. Must await its work and honor cancellation. */
	checkResult?: (result: WorkResult, context: TaskContext) => Promise<TaskCheck>;
}

export interface WorkResult {
	step: number;
	strategyId: string;
	sessionId: string;
	/** The controller's assignment, separate from the worker's account of what happened. */
	assignment: Exclude<StrategyDecision, { action: "stop" }>;
	status: "reported" | "incomplete" | "turn_limit" | "timeout" | "cancelled" | "error";
	report?: WorkReport;
	error?: string;
	evidence: Evidence[];
	check?: TaskCheck & { evidenceId: string };
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
	runId: string;
	assessment: string;
	stopReason: StrategyStopReason;
	strategies: Strategy[];
	steps: WorkResult[];
	usage: StrategyUsage;
	modelBudget?: { limits: Readonly<ModelBudgetLimits>; usage: ModelBudgetUsage };
	outputDir: string;
	check?: WorkResult["check"];
}

type EventData =
	| {
			type: "run_started";
			runId: string;
			objective: string;
			successCriteria: string;
			constraints: string[];
			limits: StrategyLimits;
			modelBudget?: Readonly<ModelBudgetLimits>;
			cwd: string;
	  }
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
	task: TaskDefinition;
	settings?: Partial<Settings>;
	limits?: Partial<StrategyLimits>;
	/** Shared model request/input budget. Disables automatic compaction. */
	modelBudget?: ModelBudget;
	/** Parent directory for a new run directory. Existing runs are never reopened. */
	outputDir?: string;
	signal?: AbortSignal;
	/** A synchronous observer. Its exceptions do not interrupt the saved run. */
	onEvent?: (event: StrategyRunEvent) => void;
}

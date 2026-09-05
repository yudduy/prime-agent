/** Connect an existing autoresearch controller to the strategy loop. */
import { setTimeout as delay } from "node:timers/promises";
import { type Static, Type } from "typebox";
import { defineTool, type TaskCheck, type TaskContext, type TaskDefinition, type WorkResult } from "../../src/index.js";

const parameters = Type.Object({
	proposal: Type.Object({
		hypothesis: Type.String({ minLength: 1 }),
		mechanism: Type.String({ minLength: 1 }),
		predictedOutcome: Type.String({ minLength: 1 }),
		boundaryConditions: Type.Array(Type.String()),
		parentJobIds: Type.Array(Type.String()),
	}),
	candidate: Type.Object({
		format: Type.Union([
			Type.Literal("llvm-pass-sequence"),
			Type.Literal("python-source"),
			Type.Literal("unified-diff"),
		]),
		content: Type.String({ minLength: 1, maxLength: 1_048_576 }),
	}),
	requireFreshMeasurement: Type.Optional(Type.Boolean()),
});

export interface ResearchScope {
	lane: "compiler-gym" | "kernelbench" | "nanogpt";
	benchmarkIds: string[];
	budgetClass: "smoke" | "screen" | "confirm";
	treatment: string;
}

export interface ResearchJob {
	proposal: { jobId: string };
	state: { status: string };
}

/** Structural interface: the SDK does not import research/ or own its evaluator. */
export interface ResearchController<Job extends ResearchJob> {
	submit(request: Static<typeof parameters> & ResearchScope & { branchId: string }): Promise<{ jobId: string }>;
	statusForBranch(branchId: string, jobIds?: readonly string[]): Job[];
	requestJobCancellation(jobId: string): void;
}

export interface ResearchTaskOptions<Job extends ResearchJob> {
	controller: ResearchController<Job>;
	scope: ResearchScope;
	objective: string;
	successCriteria: string;
	constraints?: string[];
	initialContext?: string;
	checkResult(jobs: Job[], work: WorkResult, context: TaskContext): Promise<TaskCheck>;
}

const terminal = new Set(["succeeded", "invalid", "failed", "cancelled"]);

export function createResearchTask<Job extends ResearchJob>(options: ResearchTaskOptions<Job>): TaskDefinition {
	const { controller } = options;
	const scope = structuredClone(options.scope);
	return {
		objective: options.objective,
		successCriteria: options.successCriteria,
		constraints: options.constraints,
		initialContext: [options.initialContext, `Evaluation scope: ${JSON.stringify(scope)}`].filter(Boolean).join("\n"),
		tools: [],
		createTools({ runId }) {
			async function waitForJob(jobId: string, signal?: AbortSignal): Promise<Job> {
				for (;;) {
					signal?.throwIfAborted();
					const job = controller.statusForBranch(runId, [jobId])[0];
					if (!job) throw new Error(`Missing submitted job: ${jobId}`);
					if (terminal.has(job.state.status)) return job;
					await delay(100, undefined, { signal });
				}
			}
			return [
				defineTool({
					name: "autoresearch_submit",
					label: "Evaluate candidate",
					description:
						"Submit one immutable candidate and wait for its measured result. Use parentJobIds from recalled evidence for a derivative candidate, or [] for an independent proposal.",
					parameters,
					executionMode: "sequential",
					async execute(_id, params, signal) {
						signal?.throwIfAborted();
						const { jobId } = await controller.submit({ ...params, ...scope, branchId: runId });
						try {
							const job = await waitForJob(jobId, signal);
							return { content: [{ type: "text", text: JSON.stringify(job) }], details: job };
						} catch (error) {
							controller.requestJobCancellation(jobId);
							await waitForJob(jobId);
							throw error;
						}
					},
				}),
				defineTool({
					name: "autoresearch_recall",
					label: "Recall results",
					description:
						"Read all submitted candidates and results in this strategy run, including previous workers and failed attempts.",
					parameters: Type.Object({}),
					async execute() {
						const jobs = controller.statusForBranch(runId);
						return { content: [{ type: "text", text: JSON.stringify(jobs) }], details: jobs };
					},
				}),
			];
		},
		checkResult: (work, context) =>
			options.checkResult(structuredClone(controller.statusForBranch(context.runId)), work, context),
	};
}

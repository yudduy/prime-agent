import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createResearchTask, type ResearchController, type ResearchJob } from "../../examples/sdk/research-task.js";
import { runWithStrategy, type StrategyRunEvent } from "../../src/core/strategy/index.js";
import { createHarness, getMessageText, type Harness } from "./harness.js";

interface RecordedJob extends ResearchJob {
	proposal: { jobId: string; branchId: string; parentJobIds: string[] };
	measurement: { valid: boolean } | null;
}

const call = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const conversation = (context: Context) => context.messages.map(getMessageText).join("\n");
const decision = (action: "start" | "switch") =>
	call("choose_strategy", {
		action,
		approach: action === "start" ? "Tune the recipe" : "Change the recipe",
		reason: "Test this approach",
		nextStep: "Submit a candidate and return after measurement",
		expectedEvidence: "A checked measurement",
		reviewWhen: "Measurement ends",
		alternative: "Keep the existing recipe",
		concern: "The approach may be ineffective",
		evidenceIds: [],
	});
const report = () =>
	call("report_result", {
		changes: "Submitted a candidate",
		observations: [],
		artifacts: [],
		unresolved: [],
		needsReview: true,
		evidenceIds: [],
	});
const stop = () =>
	call("choose_strategy", { action: "stop", reason: "Reviewed the available evidence", evidenceIds: [] });
const proposal = (parents: string[] = []) => ({
	proposal: {
		hypothesis: "A new recipe helps",
		mechanism: "Change the operation",
		predictedOutcome: "Meet the target",
		boundaryConditions: [],
		parentJobIds: parents,
	},
	candidate: { format: "unified-diff", content: "fixture candidate" },
});

function queue(onSubmit?: (job: RecordedJob) => void, onCancel?: (job: RecordedJob) => void) {
	const jobs: RecordedJob[] = [];
	const cancellations: string[] = [];
	const controller: ResearchController<RecordedJob> = {
		async submit(request) {
			const job: RecordedJob = {
				proposal: {
					jobId: `job-${jobs.length + 1}`,
					branchId: request.branchId,
					parentJobIds: request.proposal.parentJobIds,
				},
				state: { status: "running" },
				measurement: null,
			};
			for (const parent of request.proposal.parentJobIds) {
				expect(
					jobs.some(
						(candidate) =>
							candidate.proposal.jobId === parent && candidate.proposal.branchId === request.branchId,
					),
				).toBe(true);
			}
			jobs.push(job);
			if (onSubmit) onSubmit(job);
			else {
				job.state.status = jobs.length === 1 ? "invalid" : "succeeded";
				job.measurement = { valid: jobs.length !== 1 };
			}
			return { jobId: job.proposal.jobId };
		},
		statusForBranch(branchId, jobIds) {
			return jobs.filter(
				(job) => job.proposal.branchId === branchId && (!jobIds || jobIds.includes(job.proposal.jobId)),
			);
		},
		requestJobCancellation(jobId) {
			cancellations.push(jobId);
			const job = jobs.find((entry) => entry.proposal.jobId === jobId)!;
			if (onCancel) onCancel(job);
			else job.state.status = "cancelled";
		},
	};
	return { controller, jobs, cancellations };
}

describe("research strategy task", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(controller: ResearchController<RecordedJob>) {
		const harness = await createHarness();
		harnesses.push(harness);
		const events: StrategyRunEvent[] = [];
		const options = {
			task: createResearchTask({
				controller,
				scope: { lane: "nanogpt", benchmarkIds: ["fixture"], budgetClass: "smoke", treatment: "fixture" },
				objective: "Improve the recipe",
				successCriteria: "An independently validated candidate",
				async checkResult(jobs) {
					const latest = jobs.at(-1);
					return {
						status: latest?.measurement?.valid ? "passed" : "inconclusive",
						summary: "Fixture verifier inspected submitted jobs",
						details: JSON.stringify(jobs),
					};
				},
			}),
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

	it("keeps job lineage and contradictory evidence through a fresh worker and isolates another run", async () => {
		const { controller, jobs } = queue();
		const { harness, options } = await setup(controller);
		harness.setResponses([
			(context) => {
				expect(conversation(context)).toContain("Evaluation scope:");
				return decision("start");
			},
			call("autoresearch_submit", proposal()),
			report(),
			decision("switch"),
			(context) => {
				expect(context.tools?.map((tool) => tool.name)).not.toContain("ipython");
				return call("autoresearch_recall", {});
			},
			(context) => {
				expect(conversation(context)).toContain('"status":"invalid"');
				return call("autoresearch_submit", proposal(["job-1"]));
			},
			report(),
			stop(),
		]);
		const first = await runWithStrategy(options);
		expect(first.check?.status).toBe("passed");
		expect(jobs.map((job) => job.proposal.branchId)).toEqual([first.runId, first.runId]);
		expect(jobs[1].proposal.parentJobIds).toEqual(["job-1"]);
		expect(first.steps[0].sessionId).not.toBe(first.steps[1].sessionId);
		expect(first.steps[0].sessionId).not.toBe(first.runId);
		harness.setResponses([
			decision("start"),
			call("autoresearch_recall", {}),
			(context) => {
				const latestToolResult = context.messages.filter((message) => message.role === "toolResult").at(-1);
				expect(getMessageText(latestToolResult)).toContain("[]");
				return report();
			},
			stop(),
		]);
		const second = await runWithStrategy(options);
		expect(second.runId).not.toBe(first.runId);
		expect(second.check?.status).toBe("inconclusive");
	});

	it("does not return from submission until the external job has settled", async () => {
		let release: () => void = () => {};
		let notifySubmitted: () => void = () => {};
		const submitted = new Promise<void>((resolve) => {
			notifySubmitted = resolve;
		});
		const { controller } = queue((job) => {
			release = () => {
				job.state.status = "succeeded";
				job.measurement = { valid: true };
			};
			notifySubmitted();
		});
		const { harness, options, events } = await setup(controller);
		harness.setResponses([decision("start"), call("autoresearch_submit", proposal()), report(), stop()]);
		const running = runWithStrategy(options);
		await submitted;
		expect(events.some((event) => event.type === "step_finished")).toBe(false);
		expect(harness.getPendingResponseCount()).toBe(2);
		release();
		expect((await running).check?.status).toBe("passed");
	});

	it("awaits cancelled job cleanup before closing a worker or returning the run", async () => {
		const abort = new AbortController();
		let notifyCancelled: () => void = () => {};
		const cancelled = new Promise<void>((resolve) => {
			notifyCancelled = resolve;
		});
		let finishCleanup: () => void = () => {};
		const { controller, cancellations } = queue(
			() => abort.abort(),
			(job) => {
				finishCleanup = () => {
					job.state.status = "cancelled";
				};
				notifyCancelled();
			},
		);
		const { harness, options, events } = await setup(controller);
		harness.setResponses([decision("start"), call("autoresearch_submit", proposal()), report(), stop()]);
		const running = runWithStrategy({ ...options, signal: abort.signal });
		await cancelled;
		const worker = events.find((event) => event.type === "session_started" && event.role === "worker");
		expect(worker?.type).toBe("session_started");
		if (worker?.type !== "session_started") throw new Error("Expected a worker");
		expect(events.some((event) => event.type === "session_closed" && event.sessionId === worker.sessionId)).toBe(
			false,
		);
		expect(events.some((event) => event.type === "run_finished")).toBe(false);
		finishCleanup();
		const result = await running;
		expect(result.stopReason).toBe("cancelled");
		expect(cancellations).toEqual(["job-1"]);
		expect(harness.getPendingResponseCount()).toBe(2);
	});
});

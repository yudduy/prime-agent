import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { ResearchController } from "../src/controller.js";
import { assertReducedCpuFreshSettledJob } from "../src/reduced-cpu-study-controller.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	SubmitRequest,
} from "../src/types.js";

class HangingAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	private startEvaluation: (() => void) | null = null;
	private releaseEvaluation: (() => void) | null = null;
	readonly started = new Promise<void>((resolve) => {
		this.startEvaluation = resolve;
	});
	private readonly released = new Promise<void>((resolve) => {
		this.releaseEvaluation = resolve;
	});
	signalAborted = false;

	release(): void {
		if (!this.releaseEvaluation) throw new Error("release callback is unavailable");
		this.releaseEvaluation();
	}

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		if (!this.startEvaluation) throw new Error("start callback is unavailable");
		this.startEvaluation();
		context.signal.addEventListener(
			"abort",
			() => {
				this.signalAborted = true;
			},
			{ once: true },
		);
		await this.released;
		return {
			verifierEpoch: "settlement-test-v1",
			tasks: job.benchmarkIds.map((benchmarkId) => ({
				benchmarkId,
				status: "accepted",
				metrics: { score: 1 },
				verifier: { passed: true, checks: ["faux"], errors: [] },
				runtimeMs: 1,
			})),
			hardware: { host: "faux" },
			provenance: { adapter: "hanging" },
		};
	}
}

function options(root: string, adapter: EvaluationAdapter) {
	return {
		ledgerPath: join(root, "evidence.jsonl"),
		artifactDir: join(root, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "score", direction: "maximize" as const },
			kernelbench: { name: "unused", direction: "maximize" as const },
			nanogpt: { name: "unused", direction: "minimize" as const },
		},
		allowedBenchmarks: { "compiler-gym": ["task/a"], kernelbench: [], nanogpt: [] },
	};
}

function request(): SubmitRequest {
	return {
		branchId: "branch-settlement",
		lane: "compiler-gym",
		benchmarkIds: ["task/a"],
		budgetClass: "smoke",
		treatment: "settlement-test",
		proposal: {
			hypothesis: "exercise controller settlement",
			mechanism: "faux hanging adapter",
			predictedOutcome: "one durable terminal state",
			boundaryConditions: ["model-free"],
			parentJobIds: [],
		},
		candidate: { format: "llvm-pass-sequence", content: '["-mem2reg"]' },
		requireFreshMeasurement: true,
	};
}

describe("controller evaluator settlement", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("does not report idle after cancellation until the underlying adapter settles", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-controller-cancel-settlement-"));
		tempDirs.push(root);
		const adapter = new HangingAdapter();
		const controller = await ResearchController.open(options(root, adapter));
		const submitted = await controller.submit(request());
		await adapter.started;
		controller.requestJobCancellation(submitted.jobId);
		let idle = false;
		const settled = controller.waitForIdle().then(() => {
			idle = true;
		});
		await Promise.resolve();
		assert.equal(adapter.signalAborted, true);
		assert.equal(idle, false);
		adapter.release();
		await settled;
		const job = controller.status([submitted.jobId])[0];
		assert.equal(job.state.status, "failed");
		assert.ok(job.measurement);
		assert.equal(job.measurement.tasks[0].status, "failed");
		controller.verifyLedger();
	});

	it("durably contains a post-adapter measurement persistence failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-controller-persistence-settlement-"));
		tempDirs.push(root);
		const adapter = new HangingAdapter();
		const controller = await ResearchController.open(options(root, adapter));
		const submitted = await controller.submit(request());
		await adapter.started;
		const internals = controller as unknown as {
			ledger: {
				append: (kind: string, payload: unknown, recordedAt: string) => Promise<unknown>;
			};
		};
		const originalAppend = internals.ledger.append.bind(internals.ledger);
		let injected = false;
		internals.ledger.append = async (kind, payload, recordedAt) => {
			if (kind === "measurement" && !injected) {
				injected = true;
				throw new Error("injected measurement persistence failure");
			}
			return originalAppend(kind, payload, recordedAt);
		};
		adapter.release();
		await controller.waitForIdle();
		const job = controller.status([submitted.jobId])[0];
		assert.equal(injected, true);
		assert.equal(job.state.status, "failed");
		assert.equal(job.measurement, null);
		assert.match(job.state.reason ?? "", /injected measurement persistence failure/);
		assert.throws(() => assertReducedCpuFreshSettledJob(job, "faux search"), /without a durable measurement/);
		controller.verifyLedger();
	});
});

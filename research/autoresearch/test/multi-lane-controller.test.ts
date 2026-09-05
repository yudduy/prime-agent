import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ResearchController } from "../src/controller.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";
import type {
	BenchmarkLane,
	CandidateFormat,
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	JobStatus,
	SubmitRequest,
} from "../src/types.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolvePromise: (() => void) | null = null;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: () => {
			if (!resolvePromise) throw new Error("Deferred promise is unavailable");
			resolvePromise();
		},
	};
}

class DeferredLaneAdapter implements EvaluationAdapter {
	readonly started = deferred();
	readonly released = deferred();
	evaluateCalls = 0;

	constructor(
		readonly lane: "kernelbench" | "nanogpt",
		private readonly metric: string,
	) {}

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		this.evaluateCalls++;
		await context.recordExternalJobId(`${this.lane}:${job.jobId}`);
		this.started.resolve();
		await this.released.promise;
		return acceptedOutcome(job, this.metric, this.lane);
	}
}

class ImmediateCpuAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	evaluateCalls = 0;

	async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
		this.evaluateCalls++;
		return acceptedOutcome(job, "score", this.lane);
	}
}

class SharedGpuTracker {
	readonly activeJobIds = new Set<string>();
	maxActive = 0;

	start(jobId: string): void {
		if (this.activeJobIds.has(jobId)) throw new Error(`GPU job already active: ${jobId}`);
		this.activeJobIds.add(jobId);
		this.maxActive = Math.max(this.maxActive, this.activeJobIds.size);
	}

	finish(jobId: string): void {
		if (!this.activeJobIds.delete(jobId)) throw new Error(`GPU job is not active: ${jobId}`);
	}
}

class ControlledGpuAdapter implements EvaluationAdapter {
	evaluateCalls = 0;
	private readonly releases = new Map<string, ReturnType<typeof deferred>>();

	constructor(
		readonly lane: "kernelbench" | "nanogpt",
		private readonly metric: string,
		private readonly tracker: SharedGpuTracker,
	) {}

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		this.evaluateCalls++;
		const release = deferred();
		this.releases.set(job.jobId, release);
		this.tracker.start(job.jobId);
		try {
			await context.recordExternalJobId(`${this.lane}:${job.jobId}`);
			await release.promise;
			return acceptedOutcome(job, this.metric, this.lane);
		} finally {
			this.tracker.finish(job.jobId);
		}
	}

	release(jobId: string): void {
		const pending = this.releases.get(jobId);
		if (!pending) throw new Error(`GPU job has not started: ${jobId}`);
		pending.resolve();
	}

	releaseAll(): void {
		for (const pending of this.releases.values()) pending.resolve();
	}
}

function acceptedOutcome(job: EvaluationJob, metric: string, adapter: BenchmarkLane): EvaluationOutcome {
	return {
		verifierEpoch: `${adapter}-test-v1`,
		tasks: job.benchmarkIds.map((benchmarkId) => ({
			benchmarkId,
			status: "accepted",
			metrics: { [metric]: 1 },
			verifier: { passed: true, checks: ["faux-correctness"], errors: [] },
			runtimeMs: 1,
		})),
		hardware: { host: "faux" },
		provenance: { adapter },
	};
}

function request(lane: BenchmarkLane, benchmarkId: string, format: CandidateFormat, content: string): SubmitRequest {
	return {
		branchId: "multi-lane-branch",
		lane,
		benchmarkIds: [benchmarkId],
		budgetClass: "smoke",
		treatment: "control",
		proposal: {
			hypothesis: `${lane} can complete independently`,
			mechanism: "independent per-lane controller pumps",
			predictedOutcome: "one verifier-accepted measurement",
			boundaryConditions: ["faux-only"],
			parentJobIds: [],
		},
		candidate: { format, content },
	};
}

async function waitForStatus(controller: ResearchController, jobId: string, expected: JobStatus): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (controller.status([jobId])[0]?.state.status === expected) return;
		await delay(5);
	}
	throw new Error(`Timed out waiting for ${jobId} to become ${expected}`);
}

async function waitForCondition(condition: () => boolean, description: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (condition()) return;
		await delay(5);
	}
	throw new Error(`Timed out waiting for ${description}`);
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("continues CPU work while GPU lanes are pending and merges delayed results exactly once", async () => {
	const root = await mkdtemp(join(tmpdir(), "prime-multi-lane-controller-"));
	temporaryDirectories.push(root);
	const cpu = new ImmediateCpuAdapter();
	const kernelBench = new DeferredLaneAdapter("kernelbench", "fast_at_1");
	const nanoGpt = new DeferredLaneAdapter("nanogpt", "verified_steps");
	const ledgerPath = join(root, "evidence.jsonl");
	const controller = await ResearchController.open({
		ledgerPath,
		artifactDir: join(root, "artifacts"),
		adapters: [cpu, kernelBench, nanoGpt],
		metrics: {
			"compiler-gym": { name: "score", direction: "maximize" },
			kernelbench: { name: "fast_at_1", direction: "maximize" },
			nanogpt: { name: "verified_steps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": ["cpu/task"],
			kernelbench: ["gpu/kernel"],
			nanogpt: ["gpu/nanogpt"],
		},
		maxInflight: { "compiler-gym": 1, kernelbench: 1, nanogpt: 1 },
	});

	const kernelSubmission = await controller.submit(
		request("kernelbench", "gpu/kernel", "python-source", "ModelNew = Model\n"),
	);
	const nanoSubmission = await controller.submit(
		request("nanogpt", "gpu/nanogpt", "unified-diff", "diff --git a/train.py b/train.py\n"),
	);
	await Promise.all([kernelBench.started.promise, nanoGpt.started.promise]);

	const cpuSubmission = await controller.submit(request("compiler-gym", "cpu/task", "llvm-pass-sequence", "-mem2reg"));
	await waitForStatus(controller, cpuSubmission.jobId, "succeeded");
	assert.equal(cpu.evaluateCalls, 1);
	assert.equal(controller.status([kernelSubmission.jobId])[0]?.state.status, "running");
	assert.equal(controller.status([nanoSubmission.jobId])[0]?.state.status, "running");
	assert.equal(
		controller.status([kernelSubmission.jobId])[0]?.state.externalJobId,
		`kernelbench:${kernelSubmission.jobId}`,
	);
	assert.equal(controller.status([nanoSubmission.jobId])[0]?.state.externalJobId, `nanogpt:${nanoSubmission.jobId}`);

	nanoGpt.released.resolve();
	await waitForStatus(controller, nanoSubmission.jobId, "succeeded");
	assert.equal(controller.status([kernelSubmission.jobId])[0]?.state.status, "running");
	kernelBench.released.resolve();
	await controller.waitForIdle();

	assert.equal(kernelBench.evaluateCalls, 1);
	assert.equal(nanoGpt.evaluateCalls, 1);
	assert.deepEqual(
		controller.status().map((job) => job.state.status),
		["succeeded", "succeeded", "succeeded"],
	);
	controller.verifyLedger();
	const events = verifyLedgerContentsStrict(await readFile(ledgerPath, "utf8"));
	const measurementJobIds = events
		.filter((event) => event.kind === "measurement")
		.map((event) => {
			const payload = event.payload;
			if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
				throw new Error("Measurement payload is not an object");
			}
			const jobId = payload.jobId;
			assert.equal(typeof jobId, "string");
			return jobId;
		});
	assert.deepEqual(measurementJobIds, [cpuSubmission.jobId, nanoSubmission.jobId, kernelSubmission.jobId]);
});

it("caps aggregate GPU work at four while preserving CPU progress and one-time delayed merges", async () => {
	const root = await mkdtemp(join(tmpdir(), "prime-shared-gpu-capacity-"));
	temporaryDirectories.push(root);
	const tracker = new SharedGpuTracker();
	const cpu = new ImmediateCpuAdapter();
	const kernelBench = new ControlledGpuAdapter("kernelbench", "fast_at_1", tracker);
	const nanoGpt = new ControlledGpuAdapter("nanogpt", "verified_steps", tracker);
	const ledgerPath = join(root, "evidence.jsonl");
	const controller = await ResearchController.open({
		ledgerPath,
		artifactDir: join(root, "artifacts"),
		adapters: [cpu, kernelBench, nanoGpt],
		metrics: {
			"compiler-gym": { name: "score", direction: "maximize" },
			kernelbench: { name: "fast_at_1", direction: "maximize" },
			nanogpt: { name: "verified_steps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": ["cpu/task"],
			kernelbench: ["gpu/kernel"],
			nanogpt: ["gpu/nanogpt"],
		},
		maxInflight: { "compiler-gym": 1, kernelbench: 3, nanogpt: 2 },
	});

	const kernelSubmissions = await Promise.all(
		[0, 1, 2].map((index) =>
			controller.submit(
				request("kernelbench", "gpu/kernel", "python-source", `ModelNew = Model\n# kernel-${index}\n`),
			),
		),
	);
	const firstNanoSubmission = await controller.submit(
		request("nanogpt", "gpu/nanogpt", "unified-diff", "diff --git a/train.py b/train.py\n# nano-0\n"),
	);
	const waitingNanoSubmission = await controller.submit(
		request("nanogpt", "gpu/nanogpt", "unified-diff", "diff --git a/train.py b/train.py\n# nano-1\n"),
	);

	await Promise.all([
		...kernelSubmissions.map((submission) => waitForStatus(controller, submission.jobId, "running")),
		waitForStatus(controller, firstNanoSubmission.jobId, "running"),
	]);
	await waitForCondition(() => tracker.activeJobIds.size === 4, "four GPU adapters to start");
	assert.equal(tracker.activeJobIds.size, 4);
	assert.equal(tracker.maxActive, 4);
	assert.equal(kernelBench.evaluateCalls, 3);
	assert.equal(nanoGpt.evaluateCalls, 1);
	assert.equal(controller.status([waitingNanoSubmission.jobId])[0]?.state.status, "accepted");

	const cpuSubmission = await controller.submit(request("compiler-gym", "cpu/task", "llvm-pass-sequence", "-mem2reg"));
	await waitForStatus(controller, cpuSubmission.jobId, "succeeded");
	assert.equal(cpu.evaluateCalls, 1);
	assert.equal(tracker.activeJobIds.size, 4);

	kernelBench.release(kernelSubmissions[0]?.jobId ?? "");
	await waitForStatus(controller, kernelSubmissions[0]?.jobId ?? "", "succeeded");
	await waitForStatus(controller, waitingNanoSubmission.jobId, "running");
	assert.equal(nanoGpt.evaluateCalls, 2);
	assert.equal(tracker.activeJobIds.size, 4);
	assert.equal(tracker.maxActive, 4);

	kernelBench.releaseAll();
	nanoGpt.releaseAll();
	await controller.waitForIdle();
	assert.equal(tracker.activeJobIds.size, 0);
	assert.equal(tracker.maxActive, 4);
	assert.deepEqual(
		controller.status().map((job) => job.state.status),
		["succeeded", "succeeded", "succeeded", "succeeded", "succeeded", "succeeded"],
	);

	controller.verifyLedger();
	const events = verifyLedgerContentsStrict(await readFile(ledgerPath, "utf8"));
	const measurementJobIds = events.flatMap((event) => {
		if (event.kind !== "measurement") return [];
		const payload = event.payload;
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			throw new Error("Measurement payload is not an object");
		}
		const jobId = payload.jobId;
		assert.equal(typeof jobId, "string");
		return [jobId];
	});
	assert.equal(measurementJobIds.length, 6);
	assert.equal(new Set(measurementJobIds).size, 6);
});

it("rejects aggregate GPU limits above the four-job FarmShare QoS", async () => {
	const root = await mkdtemp(join(tmpdir(), "prime-invalid-gpu-capacity-"));
	temporaryDirectories.push(root);
	await assert.rejects(
		ResearchController.open({
			ledgerPath: join(root, "evidence.jsonl"),
			artifactDir: join(root, "artifacts"),
			adapters: [],
			metrics: {
				"compiler-gym": { name: "score", direction: "maximize" },
				kernelbench: { name: "fast_at_1", direction: "maximize" },
				nanogpt: { name: "verified_steps", direction: "minimize" },
			},
			allowedBenchmarks: { "compiler-gym": [], kernelbench: [], nanogpt: [] },
			maxGpuInflight: 5,
		}),
		/maxGpuInflight must be an integer between 1 and 4/,
	);
});

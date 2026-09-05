import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256Json } from "../src/canonical-json.js";
import {
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
	DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
	FarmShareCompilerGymAdapter,
} from "../src/compiler-gym-adapter.js";
import { ResearchController } from "../src/controller.js";
import type {
	DeterministicMeasurementReuseContract,
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	SubmitRequest,
} from "../src/types.js";

const REUSE_CONTRACT: DeterministicMeasurementReuseContract = {
	policy: "deterministic-verified-measurement-v1",
	contractKey: "reuse-faux-v1-score",
	lane: "compiler-gym",
	verifierEpoch: "reuse-test-v1",
	hardware: { host: "sealed-cpu" },
	provenance: { adapter: "reuse-faux", evaluator: "sealed-v1" },
	reusableMetricNames: ["score"],
};

type OutcomeMutation = (outcome: EvaluationOutcome) => EvaluationOutcome;

class ReuseFauxAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	readonly deterministicMeasurementReuse?: DeterministicMeasurementReuseContract;
	calls = 0;

	constructor(
		private readonly firstOutcomeMutation?: OutcomeMutation,
		optIn = true,
	) {
		if (optIn) this.deterministicMeasurementReuse = REUSE_CONTRACT;
	}

	async evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls++;
		const outcome: EvaluationOutcome = {
			verifierEpoch: REUSE_CONTRACT.verifierEpoch,
			tasks: job.benchmarkIds.map((benchmarkId, index) => ({
				benchmarkId,
				status: "accepted",
				metrics: { score: 10 + index, schedulerAndEvaluatorWallMs: 50 + index },
				verifier: { passed: true, checks: ["semantic"], errors: [] },
				runtimeMs: 50 + index,
			})),
			hardware: { ...REUSE_CONTRACT.hardware },
			provenance: { ...REUSE_CONTRACT.provenance },
			stdout: `fresh stdout for ${job.jobId}`,
			stderr: `fresh stderr for ${job.jobId}`,
		};
		return this.calls === 1 && this.firstOutcomeMutation ? this.firstOutcomeMutation(outcome) : outcome;
	}
}

function request(
	treatment: string,
	overrides: Partial<Pick<SubmitRequest, "branchId" | "benchmarkIds" | "budgetClass" | "candidate">> = {},
): SubmitRequest {
	return {
		branchId: overrides.branchId ?? "branch-a",
		lane: "compiler-gym",
		benchmarkIds: overrides.benchmarkIds ?? ["task/b", "task/a"],
		budgetClass: overrides.budgetClass ?? "smoke",
		treatment,
		proposal: {
			hypothesis: `${treatment} has distinct proposal text`,
			mechanism: `mechanism for ${treatment}`,
			predictedOutcome: `prediction for ${treatment}`,
			boundaryConditions: [treatment],
			parentJobIds: [],
		},
		candidate: overrides.candidate ?? {
			format: "llvm-pass-sequence",
			content: '["-mem2reg"]',
		},
	};
}

function controllerOptions(root: string, adapter: EvaluationAdapter) {
	return {
		ledgerPath: join(root, "evidence.jsonl"),
		artifactDir: join(root, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "score", direction: "maximize" as const },
			kernelbench: { name: "fast_at_1", direction: "maximize" as const },
			nanogpt: { name: "verified_steps", direction: "minimize" as const },
		},
		allowedBenchmarks: {
			"compiler-gym": ["task/a", "task/b"],
			kernelbench: [],
			nanogpt: [],
		},
	};
}

describe("deterministic verified-measurement reuse", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("opts the sealed FarmShare CompilerGym adapter into objective-only reuse", () => {
		const contract = new FarmShareCompilerGymAdapter().deterministicMeasurementReuse;
		assert.ok(contract);
		assert.equal(contract.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
		assert.equal(contract.provenance.evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
		assert.deepEqual(contract.reusableMetricNames, ["IrInstructionCount", "ObjectTextSizeBytes"]);
		assert.equal(contract.reusableMetricNames.includes("schedulerAndEvaluatorWallMs"), false);
		assert.equal(
			new FarmShareCompilerGymAdapter({
				...DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
				pythonPath: "/scratch/users/duynguy/other-python",
			}).deterministicMeasurementReuse,
			undefined,
		);
	});

	it("reuses only declared objective evidence while charging the logical budget", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-reuse-hit-"));
		tempDirs.push(root);
		const adapter = new ReuseFauxAdapter();
		const controller = await ResearchController.open(controllerOptions(root, adapter));
		const sourceSubmission = await controller.submit(request("control"));

		const targetRequest = request("M", { benchmarkIds: ["task/a", "task/b"] });
		targetRequest.proposal.parentJobIds = [sourceSubmission.jobId];
		const targetSubmission = await controller.submit(targetRequest);
		await controller.waitForIdle();

		assert.equal(adapter.calls, 1);
		const source = controller.status([sourceSubmission.jobId])[0];
		const target = controller.status([targetSubmission.jobId])[0];
		assert.equal(target.state.status, "succeeded");
		assert.ok(source.measurement);
		assert.ok(target.measurement?.reuse);
		assert.equal(target.measurement.reuse.sourceJobId, sourceSubmission.jobId);
		assert.equal(target.measurement.reuse.sourceManifestDigest, sourceSubmission.manifestDigest);
		assert.equal(target.measurement.reuse.sourceMeasurementDigest, sha256Json(source.measurement));
		assert.deepEqual(target.measurement.reuse.reusedMetricNames, ["score"]);
		assert.deepEqual(
			target.measurement.tasks.map((task) => task.metrics),
			[{ score: 10 }, { score: 11 }],
		);
		assert.deepEqual(
			target.measurement.tasks.map((task) => task.runtimeMs),
			[0, 0],
		);
		assert.equal(target.measurement.stdout, null);
		assert.equal(target.measurement.stderr, null);
		assert.deepEqual(target.measurement.hardware, source.measurement.hardware);
		assert.deepEqual(target.measurement.provenance, source.measurement.provenance);
		assert.equal(controller.compare("branch-a", "compiler-gym", "M", "control").orientedMeanDelta, 0);
		assert.deepEqual(controller.budgetStatus("branch-a"), {
			branchId: "branch-a",
			submissions: 2,
			taskEvaluations: 4,
			actualTaskEvaluations: 2,
			reusedTaskEvaluations: 2,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: null,
			maxTaskEvaluations: null,
			remainingSubmissions: null,
			remainingTaskEvaluations: null,
		});

		const events = (await readFile(join(root, "evidence.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { hash: string; kind: string; payload: { jobId?: string } });
		const sourceMeasurementEvent = events.find(
			(event) => event.kind === "measurement" && event.payload.jobId === sourceSubmission.jobId,
		);
		assert.equal(target.measurement.reuse.sourceMeasurementEventHash, sourceMeasurementEvent?.hash);
		controller.verifyLedger();
	});

	it("misses on epoch, hardware, provenance, task set, candidate digest, budget, or invalid evidence", async () => {
		const cases: Array<{
			name: string;
			mutation?: OutcomeMutation;
			target?: Partial<Pick<SubmitRequest, "benchmarkIds" | "budgetClass" | "candidate">>;
		}> = [
			{ name: "epoch", mutation: (outcome) => ({ ...outcome, verifierEpoch: "reuse-test-v2" }) },
			{ name: "hardware", mutation: (outcome) => ({ ...outcome, hardware: { host: "other-cpu" } }) },
			{ name: "provenance", mutation: (outcome) => ({ ...outcome, provenance: { adapter: "other" } }) },
			{ name: "task set", target: { benchmarkIds: ["task/a"] } },
			{
				name: "candidate digest",
				target: { candidate: { format: "llvm-pass-sequence", content: '["-instcombine"]' } },
			},
			{ name: "budget", target: { budgetClass: "screen" } },
			{
				name: "invalid evidence",
				mutation: (outcome) => ({
					...outcome,
					tasks: outcome.tasks.map((task) => ({
						...task,
						status: "rejected",
						verifier: { passed: false, checks: ["semantic"], errors: ["wrong answer"] },
					})),
				}),
			},
		];

		for (const testCase of cases) {
			const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-reuse-miss-"));
			tempDirs.push(root);
			const adapter = new ReuseFauxAdapter(testCase.mutation);
			const controller = await ResearchController.open(controllerOptions(root, adapter));
			await controller.submit(request("source"));
			await controller.waitForIdle();
			const target = await controller.submit(request(`target-${testCase.name}`, testCase.target));
			await controller.waitForIdle();
			assert.equal(adapter.calls, 2, testCase.name);
			assert.equal(controller.status([target.jobId])[0].measurement?.reuse, undefined, testCase.name);
		}
	});

	it("keeps non-opt-in adapters fresh and supports same-branch require-fresh retests", async () => {
		const nonOptRoot = await mkdtemp(join(tmpdir(), "prime-autoresearch-reuse-optout-"));
		tempDirs.push(nonOptRoot);
		const nonOptAdapter = new ReuseFauxAdapter(undefined, false);
		const nonOptController = await ResearchController.open(controllerOptions(nonOptRoot, nonOptAdapter));
		await nonOptController.submit(request("control"));
		await nonOptController.waitForIdle();
		await nonOptController.submit(request("M"));
		await nonOptController.waitForIdle();
		assert.equal(nonOptAdapter.calls, 2);

		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-reuse-fresh-"));
		tempDirs.push(root);
		const adapter = new ReuseFauxAdapter();
		const controller = await ResearchController.open(controllerOptions(root, adapter));
		await controller.submit(request("source"));
		await controller.waitForIdle();
		await controller.submit(request("cross-branch", { branchId: "branch-b" }));
		await controller.waitForIdle();
		const reused = await controller.submit(request("same-branch"));
		await controller.waitForIdle();
		const freshRequest = request("fresh-retest");
		freshRequest.requireFreshMeasurement = true;
		const fresh = await controller.submit(freshRequest);
		await controller.waitForIdle();
		const firstConfirmationRequest = request("confirm-1", { budgetClass: "confirm" });
		const firstConfirmation = await controller.submit(firstConfirmationRequest);
		await controller.waitForIdle();
		const secondConfirmationRequest = request("confirm-2", { budgetClass: "confirm" });
		const secondConfirmation = await controller.submit(secondConfirmationRequest);
		await controller.waitForIdle();

		assert.equal(adapter.calls, 5);
		assert.ok(controller.status([reused.jobId])[0].measurement?.reuse);
		assert.equal(controller.status([fresh.jobId])[0].measurement?.reuse, undefined);
		assert.equal(controller.status([firstConfirmation.jobId])[0].measurement?.reuse, undefined);
		assert.equal(controller.status([secondConfirmation.jobId])[0].measurement?.reuse, undefined);
		assert.deepEqual(controller.budgetStatus("branch-a"), {
			branchId: "branch-a",
			submissions: 5,
			taskEvaluations: 10,
			actualTaskEvaluations: 8,
			reusedTaskEvaluations: 2,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: null,
			maxTaskEvaluations: null,
			remainingSubmissions: null,
			remainingTaskEvaluations: null,
		});
	});

	it("survives restart, appends without rewriting, and flattens reuse to the fresh source", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-reuse-restart-"));
		tempDirs.push(root);
		const initialAdapter = new ReuseFauxAdapter();
		const initial = await ResearchController.open(controllerOptions(root, initialAdapter));
		const source = await initial.submit(request("source"));
		await initial.waitForIdle();
		const firstReuse = await initial.submit(request("first-reuse"));
		await initial.waitForIdle();
		assert.equal(initialAdapter.calls, 1);
		assert.equal(initial.status([firstReuse.jobId])[0].measurement?.reuse?.sourceJobId, source.jobId);
		const beforeRestart = await readFile(join(root, "evidence.jsonl"), "utf8");

		const restartedAdapter = new ReuseFauxAdapter();
		const restarted = await ResearchController.open(controllerOptions(root, restartedAdapter));
		await restarted.waitForIdle();
		const secondReuse = await restarted.submit(request("second-reuse"));
		await restarted.waitForIdle();
		const afterRestart = await readFile(join(root, "evidence.jsonl"), "utf8");

		assert.equal(restartedAdapter.calls, 0);
		assert.ok(afterRestart.startsWith(beforeRestart));
		assert.equal(restarted.status([secondReuse.jobId])[0].measurement?.reuse?.sourceJobId, source.jobId);
		assert.deepEqual(restarted.budgetStatus("branch-a"), {
			branchId: "branch-a",
			submissions: 3,
			taskEvaluations: 6,
			actualTaskEvaluations: 2,
			reusedTaskEvaluations: 4,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: null,
			maxTaskEvaluations: null,
			remainingSubmissions: null,
			remainingTaskEvaluations: null,
		});
		restarted.verifyLedger();
	});
});

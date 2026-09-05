import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { ArtifactStore } from "../src/artifact-store.js";
import { ResearchController } from "../src/controller.js";
import { classifyRemoval, findSingleRemoval, parseLlvmPassSequence } from "../src/diagnostics.js";
import {
	EVALUATION_ADAPTER_OUTPUT_ERROR_PROTOCOL,
	EvaluationAdapterOutputError,
} from "../src/evaluation-adapter-output-error.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "../src/ledger.js";
import { createResearchTools } from "../src/tools.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	ProposalRecord,
	SubmitRequest,
} from "../src/types.js";

class DeterministicAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	async evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls++;
		const score = job.candidateContent.includes("instcombine") ? 2 : 1;
		return {
			verifierEpoch: "test-v1",
			tasks: job.benchmarkIds.map((benchmarkId) => ({
				benchmarkId,
				status: "accepted",
				metrics: { score },
				verifier: { passed: true, checks: ["semantic"], errors: [] },
				runtimeMs: 1,
			})),
			hardware: { host: "test" },
			provenance: { adapter: "deterministic" },
			stdout: `score=${score}`,
		};
	}
}

class MultiEpochAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	async evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		const secondEpoch = job.candidateContent.includes("-gvn");
		return {
			verifierEpoch: secondEpoch ? "test-v2" : "test-v1",
			tasks: job.benchmarkIds.map((benchmarkId) => ({
				benchmarkId,
				status: "accepted",
				metrics: { score: secondEpoch ? 3 : 1 },
				verifier: { passed: true, checks: ["semantic"], errors: [] },
				runtimeMs: 1,
			})),
			hardware: { host: "test" },
			provenance: { adapter: "multi-epoch" },
		};
	}
}

class MislabelledVerifierAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	async evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls++;
		return {
			verifierEpoch: "test-v1",
			tasks: job.benchmarkIds.map((benchmarkId) => ({
				benchmarkId,
				status: "accepted",
				metrics: { score: 100 },
				verifier: { passed: false, checks: ["semantic"], errors: ["wrong answer"] },
				runtimeMs: 1,
			})),
			hardware: { host: "test" },
			provenance: { adapter: "mislabelled-verifier" },
		};
	}
}

class CandidateMatrixAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	async evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		const scores = job.candidateContent.includes("spiky")
			? [10, 0]
			: job.candidateContent.includes("balanced")
				? [6, 6]
				: [1, 1];
		return {
			verifierEpoch: "test-v1",
			tasks: job.benchmarkIds.map((benchmarkId, index) => ({
				benchmarkId,
				status: "accepted",
				metrics: { score: scores[index] ?? 0 },
				verifier: { passed: true, checks: ["semantic"], errors: [] },
				runtimeMs: 1,
			})),
			hardware: { host: "test" },
			provenance: { adapter: "candidate-matrix" },
		};
	}
}

const HOST_ONLY_STDOUT = "host-only-raw-stdout\n";
const HOST_ONLY_STDERR = "host-only-raw-stderr\n";

class HostEvidenceFailureAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	evaluate(): Promise<EvaluationOutcome> {
		this.calls++;
		throw new EvaluationAdapterOutputError({
			code: "test-output-invalid",
			message: "Evaluator output failed host validation",
			hostEvidence: { stage: "parse", exitCode: 3 },
			stdout: HOST_ONLY_STDOUT,
			stderr: HOST_ONLY_STDERR,
		});
	}
}

function request(treatment: string, content: string): SubmitRequest {
	return {
		branchId: "branch-a",
		lane: "compiler-gym",
		benchmarkIds: ["task/a", "task/b"],
		budgetClass: "smoke",
		treatment,
		proposal: {
			hypothesis: `${treatment} changes the score`,
			mechanism: "deterministic test adapter",
			predictedOutcome: "paired score increases",
			boundaryConditions: ["test only"],
			parentJobIds: [],
		},
		candidate: { format: "llvm-pass-sequence", content },
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

describe("autoresearch sidecar", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("detects a tampered hash-linked ledger", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-ledger-"));
		tempDirs.push(root);
		const path = join(root, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(path);
		await ledger.append("claim", { claim: "measured", support: true }, "2026-08-27T00:00:00.000Z");
		ledger.verify();

		const lines = (await readFile(path, "utf8")).trim().split("\n");
		const event = JSON.parse(lines[0]) as { payload: { support: boolean } };
		event.payload.support = false;
		await writeFile(path, `${JSON.stringify(event)}\n`, "utf8");

		await assert.rejects(EvidenceLedger.open(path), /Ledger hash mismatch/);
	});

	it("strictly verifies canonical immutable ledger bytes", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-strict-ledger-"));
		tempDirs.push(root);
		const path = join(root, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(path);
		await ledger.append("claim", { claim: "first" }, "2026-08-27T00:00:01.000Z");
		const canonical = await readFile(path, "utf8");
		assert.equal(verifyLedgerContentsStrict(canonical).length, 1);

		assert.throws(() => verifyLedgerContentsStrict(`${canonical.trim().replace("{", "{ ")}\n`), /not canonical JSON/);
		assert.throws(
			() => verifyLedgerContentsStrict(`${canonical.trim().replace("{", '{"extra":true,')}\n`),
			/unknown or missing envelope keys/,
		);
		assert.throws(() => verifyLedgerContentsStrict(canonical.trim()), /must end with one newline/);

		await ledger.append("claim", { claim: "earlier" }, "2026-08-27T00:00:00.000Z");
		const outOfOrder = await readFile(path, "utf8");
		assert.throws(() => verifyLedgerContentsStrict(outOfOrder), /Ledger timestamp decreased/);
	});

	it("validates and classifies a leave-one-out diagnostic", () => {
		assert.deepEqual(parseLlvmPassSequence('["-mem2reg","-instcombine","-simplifycfg"]'), [
			"-mem2reg",
			"-instcombine",
			"-simplifycfg",
		]);
		assert.deepEqual(findSingleRemoval(["-mem2reg", "-instcombine", "-simplifycfg"], ["-mem2reg", "-simplifycfg"]), {
			removedIndex: 1,
			removedAction: "-instcombine",
		});
		assert.equal(findSingleRemoval(["-mem2reg", "-instcombine"], ["-instcombine", "-mem2reg"]), null);
		const task = (benchmarkId: string, count: number) => ({
			benchmarkId,
			status: "accepted" as const,
			metrics: { IrInstructionCount: count },
			verifier: { passed: true, checks: ["semantic"], errors: [] },
			runtimeMs: 1,
		});
		assert.deepEqual(
			classifyRemoval([task("a", 10), task("b", 20)], [task("a", 10), task("b", 20)]).outcome,
			"exact-no-op-removal",
		);
		assert.deepEqual(
			classifyRemoval([task("a", 10), task("b", 20)], [task("a", 9), task("b", 20)]).outcome,
			"strictly-better-removal",
		);
	});

	it("deduplicates dispatch, persists measurements, recalls evidence, and compares paired tasks", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-controller-"));
		tempDirs.push(root);
		const adapter = new DeterministicAdapter();
		const controller = await ResearchController.open(controllerOptions(root, adapter));

		const baseline = await controller.submit(request("control", "-mem2reg"));
		const duplicate = await controller.submit(request("control", "-mem2reg"));
		assert.equal(duplicate.jobId, baseline.jobId);
		assert.equal(duplicate.duplicate, true);

		await controller.submit(request("M", "-mem2reg -instcombine"));
		await controller.waitForIdle();
		assert.equal(adapter.calls, 2);
		assert.equal(controller.status([baseline.jobId])[0].state.status, "succeeded");
		assert.equal(controller.recall("branch-a", { statuses: ["succeeded"] }).length, 2);
		const recalledWithCandidates = await controller.recallWithCandidateContent("branch-a", {
			statuses: ["succeeded"],
		});
		assert.deepEqual(recalledWithCandidates.map((job) => job.candidateContent).sort(), [
			"-mem2reg",
			"-mem2reg -instcombine",
		]);

		const comparison = controller.compare("branch-a", "compiler-gym", "M", "control");
		assert.equal(comparison.pairedTaskCount, 2);
		assert.equal(comparison.orientedMeanDelta, 1);
		assert.equal(comparison.verifierEpoch, "test-v1");
		controller.verifyLedger();

		const reopenedAdapter = new DeterministicAdapter();
		const reopened = await ResearchController.open(controllerOptions(root, reopenedAdapter));
		const afterRestart = await reopened.submit(request("control", "-mem2reg"));
		assert.equal(afterRestart.jobId, baseline.jobId);
		assert.equal(afterRestart.duplicate, true);
		await reopened.waitForIdle();
		assert.equal(reopenedAdapter.calls, 0);
		assert.equal(reopened.status().length, 2);
	});

	it("fails closed when an adapter accepts a task whose verifier failed", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-verifier-failure-"));
		tempDirs.push(root);
		const adapter = new MislabelledVerifierAdapter();
		const options = controllerOptions(root, adapter);
		const controller = await ResearchController.open(options);
		const submitted = await controller.submit(request("M", "-mislabelled"));
		await controller.waitForIdle();

		const completed = controller.status([submitted.jobId])[0];
		assert.equal(completed.measurement?.tasks[0].status, "accepted");
		assert.equal(completed.measurement?.tasks[0].verifier.passed, false);
		assert.equal(completed.state.status, "invalid");
		assert.equal(controller.recall("branch-a", { statuses: ["succeeded"] }).length, 0);

		const ledger = await EvidenceLedger.open(join(root, "evidence.jsonl"));
		await ledger.append("job_state", {
			...completed.state,
			status: "succeeded",
			statusAt: "2026-08-27T12:00:00.000Z",
			reason: null,
		});
		const reopenedAdapter = new MislabelledVerifierAdapter();
		const reopened = await ResearchController.open(controllerOptions(root, reopenedAdapter));
		const corrected = reopened.status([submitted.jobId])[0];
		assert.equal(corrected.state.status, "invalid");
		assert.match(corrected.state.reason ?? "", /Corrected legacy success/);
		assert.equal(reopenedAdapter.calls, 0);
		reopened.verifyLedger();
	});

	it("keeps raw adapter failure evidence durable and out of status and recall", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-host-evidence-"));
		tempDirs.push(root);
		const artifactDir = join(root, "artifacts");
		const adapter = new HostEvidenceFailureAdapter();
		const options = controllerOptions(root, adapter);
		const controller = await ResearchController.open(options);
		const submitted = await controller.submit(request("M", "-invalid-output"));
		await controller.waitForIdle();

		const completed = controller.status([submitted.jobId])[0];
		assert.equal(completed.state.status, "failed");
		assert.deepEqual(
			completed.measurement?.tasks.map((task) => task.verifier.errors),
			[["Evaluator output failed host validation"], ["Evaluator output failed host validation"]],
		);
		const modelVisible = JSON.stringify({ status: completed, recall: controller.recall("branch-a") });
		assert.equal(modelVisible.includes(HOST_ONLY_STDOUT.trim()), false);
		assert.equal(modelVisible.includes(HOST_ONLY_STDERR.trim()), false);

		const ledger = await EvidenceLedger.open(join(root, "evidence.jsonl"));
		const event = ledger.getEvents().find((candidate) => {
			if (candidate.kind !== "run_manifest") return false;
			const payload = candidate.payload as Record<string, unknown>;
			return payload.type === "evaluation_adapter_output_error";
		});
		assert.ok(event);
		const payload = event.payload as Record<string, unknown>;
		assert.equal(payload.protocol, EVALUATION_ADAPTER_OUTPUT_ERROR_PROTOCOL);
		assert.equal(payload.jobId, submitted.jobId);
		assert.equal(payload.code, "test-output-invalid");
		const store = new ArtifactStore(artifactDir);
		assert.equal(
			await store.readString(payload.stdoutArtifact as Parameters<ArtifactStore["readString"]>[0]),
			HOST_ONLY_STDOUT,
		);
		assert.equal(
			await store.readString(payload.stderrArtifact as Parameters<ArtifactStore["readString"]>[0]),
			HOST_ONLY_STDERR,
		);
		assert.equal(
			await store.readString(payload.hostEvidenceArtifact as Parameters<ArtifactStore["readString"]>[0]),
			'{"exitCode":3,"stage":"parse"}\n',
		);

		const reopened = await ResearchController.open(controllerOptions(root, new HostEvidenceFailureAdapter()));
		assert.equal(JSON.stringify(reopened.status()).includes(HOST_ONLY_STDOUT.trim()), false);
		reopened.verifyLedger();
	});

	it("selects one deployable candidate per treatment instead of a per-task Frankenstein", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-candidate-pair-"));
		tempDirs.push(root);
		const controller = await ResearchController.open(controllerOptions(root, new CandidateMatrixAdapter()));
		const control = await controller.submit(request("control", "-control"));
		await controller.submit(request("M", "-spiky"));
		const balancedA = await controller.submit(request("M", "-balanced-a"));
		const balancedB = await controller.submit(request("M", "-balanced-b"));
		await controller.waitForIdle();

		const balancedJobs = controller
			.status([balancedA.jobId, balancedB.jobId])
			.sort(
				(left, right) =>
					left.proposal.candidate.digest.localeCompare(right.proposal.candidate.digest) ||
					left.proposal.jobId.localeCompare(right.proposal.jobId),
			);
		const selectedBalanced = balancedJobs[0];
		const controlJob = controller.status([control.jobId])[0];
		const comparison = controller.compare("branch-a", "compiler-gym", "M", "control");

		assert.equal(comparison.comparisonPolicy, "candidate-paired-v1");
		assert.equal(comparison.leftJobId, selectedBalanced.proposal.jobId);
		assert.equal(comparison.leftCandidateDigest, selectedBalanced.proposal.candidate.digest);
		assert.equal(comparison.rightJobId, control.jobId);
		assert.equal(comparison.rightCandidateDigest, controlJob.proposal.candidate.digest);
		assert.deepEqual(comparison.benchmarkIds, ["task/a", "task/b"]);
		assert.deepEqual(
			comparison.paired.map((task) => task.left),
			[6, 6],
		);
		assert.equal(comparison.leftMean, 6);
		assert.equal(comparison.orientedMeanDelta, 5);
	});

	it("refuses to compare candidates from incompatible execution evidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-incompatible-pair-"));
		tempDirs.push(root);
		class IncompatibleHardwareAdapter extends DeterministicAdapter {
			override async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
				const outcome = await super.evaluate(job, context);
				return { ...outcome, hardware: { host: job.treatment } };
			}
		}
		const controller = await ResearchController.open(controllerOptions(root, new IncompatibleHardwareAdapter()));
		await controller.submit(request("control", "-mem2reg"));
		await controller.submit(request("M", "-mem2reg -instcombine"));
		await controller.waitForIdle();

		assert.throws(
			() => controller.compare("branch-a", "compiler-gym", "M", "control"),
			/no candidate pair with the same task set, budget, verifier epoch, hardware, and provenance/,
		);
	});

	it("requires an explicit verifier epoch when comparison evidence spans epochs", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-epochs-"));
		tempDirs.push(root);
		const controller = await ResearchController.open(controllerOptions(root, new MultiEpochAdapter()));
		await controller.submit(request("control", "-mem2reg"));
		await controller.submit(request("M", "-mem2reg -instcombine"));
		await controller.submit(request("M", "-gvn"));
		await controller.waitForIdle();

		assert.throws(() => controller.compare("branch-a", "compiler-gym", "M", "control"), /multiple verifier epochs/);
		const comparison = controller.compare("branch-a", "compiler-gym", "M", "control", "test-v1");
		assert.equal(comparison.verifierEpoch, "test-v1");
		assert.equal(comparison.pairedTaskCount, 2);
		assert.equal(comparison.orientedMeanDelta, 0);
	});

	it("resumes a durable external evaluation after controller restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-resume-"));
		tempDirs.push(root);
		const artifactDir = join(root, "artifacts");
		const candidate = await new ArtifactStore(artifactDir).putString(
			"-mem2reg",
			"application/vnd.prime.llvm-pass-sequence",
		);
		const proposal: ProposalRecord = {
			jobId: "job_resume",
			manifestDigest: "manifest-resume",
			branchId: "branch-a",
			lane: "compiler-gym",
			benchmarkIds: ["task/a", "task/b"],
			budgetClass: "smoke",
			treatment: "control",
			proposal: {
				hypothesis: "A durable external evaluation resumes",
				mechanism: "test adapter recovery",
				predictedOutcome: "paired score is restored",
				boundaryConditions: ["test only"],
				parentJobIds: [],
			},
			candidate,
			candidateFormat: "llvm-pass-sequence",
		};
		const ledger = await EvidenceLedger.open(join(root, "evidence.jsonl"));
		await ledger.append("proposal", proposal, "2026-08-27T00:00:00.000Z");
		await ledger.append(
			"job_state",
			{
				jobId: proposal.jobId,
				status: "accepted",
				statusAt: "2026-08-27T00:00:01.000Z",
				externalJobId: null,
				reason: null,
			},
			"2026-08-27T00:00:01.000Z",
		);
		await ledger.append(
			"job_state",
			{
				jobId: proposal.jobId,
				status: "queued",
				statusAt: "2026-08-27T00:00:02.000Z",
				externalJobId: null,
				reason: null,
			},
			"2026-08-27T00:00:02.000Z",
		);
		await ledger.append(
			"job_state",
			{
				jobId: proposal.jobId,
				status: "running",
				statusAt: "2026-08-27T00:00:03.000Z",
				externalJobId: "slurm-handle:job_resume",
				reason: null,
			},
			"2026-08-27T00:00:03.000Z",
		);

		class ResumableAdapter implements EvaluationAdapter {
			readonly lane = "compiler-gym" as const;
			resumeCalls: string[] = [];

			async evaluate(): Promise<EvaluationOutcome> {
				throw new Error("Fresh evaluation must not be called during recovery");
			}

			async resume(
				job: EvaluationJob,
				externalJobId: string,
				context: EvaluationContext,
			): Promise<EvaluationOutcome> {
				assert.equal(context.signal.aborted, false);
				this.resumeCalls.push(externalJobId);
				return {
					verifierEpoch: "test-v1",
					tasks: job.benchmarkIds.map((benchmarkId) => ({
						benchmarkId,
						status: "accepted",
						metrics: { score: 1 },
						verifier: { passed: true, checks: ["semantic"], errors: [] },
						runtimeMs: 1,
					})),
					hardware: { host: "test" },
					provenance: { adapter: "resumable" },
				};
			}
		}

		const adapter = new ResumableAdapter();
		const controller = await ResearchController.open(controllerOptions(root, adapter));
		await controller.waitForIdle();
		assert.deepEqual(adapter.resumeCalls, ["slurm-handle:job_resume"]);
		assert.equal(controller.status([proposal.jobId])[0].state.status, "succeeded");
		assert.equal(controller.status([proposal.jobId])[0].state.externalJobId, "slurm-handle:job_resume");
		controller.verifyLedger();
	});

	it("persists a stable external handle before terminal measurement", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-external-handle-"));
		tempDirs.push(root);
		class ExternalHandleAdapter extends DeterministicAdapter {
			override async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
				await context.recordExternalJobId(`stable:${job.jobId}`);
				return super.evaluate(job, context);
			}
		}
		const adapter = new ExternalHandleAdapter();
		const controller = await ResearchController.open(controllerOptions(root, adapter));
		const submitted = await controller.submit(request("control", "-mem2reg"));
		await controller.waitForIdle();
		const job = controller.status([submitted.jobId])[0];
		assert.equal(job.state.status, "succeeded");
		assert.equal(job.state.externalJobId, `stable:${submitted.jobId}`);
		controller.verifyLedger();
	});

	it("enforces branch budgets without charging duplicate submissions", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-budget-"));
		tempDirs.push(root);
		const adapter = new DeterministicAdapter();
		const controller = await ResearchController.open({
			...controllerOptions(root, adapter),
			maxSubmissionsPerBranch: 1,
			maxTaskEvaluationsPerBranch: 2,
		});

		const first = await controller.submit(request("control", "-mem2reg"));
		const duplicate = await controller.submit(request("control", "-mem2reg"));
		assert.equal(duplicate.jobId, first.jobId);
		assert.equal(duplicate.duplicate, true);
		assert.deepEqual(controller.budgetStatus("branch-a"), {
			branchId: "branch-a",
			submissions: 1,
			taskEvaluations: 2,
			actualTaskEvaluations: 0,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 2,
			maxSubmissions: 1,
			maxTaskEvaluations: 2,
			remainingSubmissions: 0,
			remainingTaskEvaluations: 0,
		});
		await assert.rejects(controller.submit(request("control", "-instcombine")), /Submission budget exhausted/);
		await controller.waitForIdle();
		assert.equal(adapter.calls, 1);
	});

	it("exposes only typed research operations", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-tools-"));
		tempDirs.push(root);
		const controller = await ResearchController.open(controllerOptions(root, new DeterministicAdapter()));
		const names = createResearchTools(controller).map((tool) => tool.name);
		assert.deepEqual(names, [
			"autoresearch_submit",
			"autoresearch_status",
			"autoresearch_recall",
			"autoresearch_compare",
		]);
	});

	it("normalizes an omitted parent list to an explicit root proposal", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-tool-parents-"));
		tempDirs.push(root);
		const adapter = new DeterministicAdapter();
		const controller = await ResearchController.open(controllerOptions(root, adapter));
		const submit = createResearchTools(controller, {
			enableRecall: false,
			enableCompare: false,
			submitScope: {
				lane: "compiler-gym",
				benchmarkIds: ["task/a", "task/b"],
				budgetClass: "smoke",
				treatment: "control",
			},
		}).find((tool) => tool.name === "autoresearch_submit");
		assert.ok(submit);
		const context = {
			sessionManager: { getSessionId: () => "branch-tool" },
		} as unknown as Parameters<typeof submit.execute>[4];
		await submit.execute(
			"tool-call",
			{
				proposal: {
					hypothesis: "A root candidate changes the score",
					mechanism: "deterministic test adapter",
					predictedOutcome: "paired score increases",
					boundaryConditions: ["test only"],
				},
				candidate: { format: "llvm-pass-sequence", content: "-mem2reg" },
			},
			undefined,
			undefined,
			context,
		);
		await controller.waitForIdle();
		assert.deepEqual(controller.statusForBranch("branch-tool")[0].proposal.proposal.parentJobIds, []);
		const duplicate = await submit.execute(
			"tool-call-explicit-root",
			{
				proposal: {
					hypothesis: "A root candidate changes the score",
					mechanism: "deterministic test adapter",
					predictedOutcome: "paired score increases",
					boundaryConditions: ["test only"],
					parentJobIds: [],
				},
				candidate: { format: "llvm-pass-sequence", content: "-mem2reg" },
			},
			undefined,
			undefined,
			context,
		);
		assert.equal((duplicate.details as { duplicate: boolean }).duplicate, true);
		await assert.rejects(
			submit.execute(
				"tool-call-missing-later-parent",
				{
					proposal: {
						hypothesis: "A derivative candidate changes the score",
						mechanism: "deterministic test adapter",
						predictedOutcome: "paired score increases again",
						boundaryConditions: ["test only"],
					},
					candidate: { format: "llvm-pass-sequence", content: "-instcombine" },
				},
				undefined,
				undefined,
				context,
			),
			/proposal.parentJobIds is required/,
		);
		assert.equal(controller.statusForBranch("branch-tool").length, 1);
		assert.equal(adapter.calls, 1);
	});

	it("server-binds a linear parent chain for matched scoped tools", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-bound-parents-"));
		tempDirs.push(root);
		const controller = await ResearchController.open(controllerOptions(root, new DeterministicAdapter()));
		const submit = createResearchTools(controller, {
			enableRecall: false,
			enableCompare: false,
			submitScope: {
				lane: "compiler-gym",
				benchmarkIds: ["task/a", "task/b"],
				budgetClass: "smoke",
				treatment: "control",
				bindParentToLatest: true,
			},
		}).find((tool) => tool.name === "autoresearch_submit");
		assert.ok(submit);
		const context = {
			sessionManager: { getSessionId: () => "branch-bound" },
		} as unknown as Parameters<typeof submit.execute>[4];
		const proposal = {
			hypothesis: "A bound candidate changes the score",
			mechanism: "deterministic test adapter",
			predictedOutcome: "paired score increases",
			boundaryConditions: ["test only"],
		};
		await submit.execute(
			"tool-call-root",
			{ proposal, candidate: { format: "llvm-pass-sequence", content: "-mem2reg" } },
			undefined,
			undefined,
			context,
		);
		await controller.waitForIdle();
		const rootJob = controller.statusForBranch("branch-bound")[0];
		assert.deepEqual(rootJob.proposal.proposal.parentJobIds, []);
		await submit.execute(
			"tool-call-child",
			{
				proposal: { ...proposal, hypothesis: "A bound child changes the score again" },
				candidate: { format: "llvm-pass-sequence", content: "-mem2reg -instcombine" },
			},
			undefined,
			undefined,
			context,
		);
		await controller.waitForIdle();
		const childJob = controller.statusForBranch("branch-bound")[1];
		assert.deepEqual(childJob.proposal.proposal.parentJobIds, [rootJob.proposal.jobId]);
	});

	it("keeps exact-job status branch-local", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-autoresearch-status-scope-"));
		tempDirs.push(root);
		const controller = await ResearchController.open(controllerOptions(root, new DeterministicAdapter()));
		const first = await controller.submit(request("control", "-mem2reg"));
		const foreignRequest = request("control", "-instcombine");
		foreignRequest.branchId = "branch-b";
		const foreign = await controller.submit(foreignRequest);

		assert.deepEqual(
			controller.statusForBranch("branch-a").map((job) => job.proposal.jobId),
			[first.jobId],
		);
		assert.throws(() => controller.statusForBranch("branch-a", [foreign.jobId]), /does not belong to branch/);
		const crossBranchParent = request("control", "-sroa");
		crossBranchParent.proposal.parentJobIds = [foreign.jobId];
		await assert.rejects(controller.submit(crossBranchParent), /Parent job belongs to another branch/);
		await controller.waitForIdle();
	});
});

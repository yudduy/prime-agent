import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	REDUCED_CPU_CALIBRATION_DEADLINE_MS,
	runReducedCpuCalibration,
	waitForReducedCpuCalibrationIdleWithDeadline,
} from "../src/reduced-cpu-study-calibration.js";
import {
	openReducedCpuStudyController,
	prepareReducedCpuRetestDirective,
	submitReducedCpuSearchCandidate,
	verifyReducedCpuStudyLedgerStrict,
} from "../src/reduced-cpu-study-controller.js";
import {
	assessReducedCpuResurrection,
	buildReducedCpuCandidateEvidence,
	buildReducedCpuRetestDirective,
	classifyReducedCpuCandidateTwo,
	decideReducedCpuBlockComparisons,
	isReducedCpuMeasuredVerifierRejection,
	parseReducedCpuCalibration,
	parseReducedCpuCandidateRequest,
	parseSealedReducedCpuRetestDirective,
	REDUCED_CPU_ALL_TASKS,
	REDUCED_CPU_CALIBRATION_BRANCH_ID,
	REDUCED_CPU_CALIBRATION_TREATMENT,
	REDUCED_CPU_EXPECTED_HARDWARE,
	REDUCED_CPU_EXPECTED_PROVENANCE,
	REDUCED_CPU_REQUIRED_VERIFIER_CHECKS,
	REDUCED_CPU_SEARCH_TASKS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	type ReducedCpuArmBlock,
	type ReducedCpuCalibration,
	type ReducedCpuCalibrationEnvelope,
	type ReducedCpuCandidateEvidence,
	type ReducedCpuStudyArm,
	reducedCpuSearchTreatment,
	sealReducedCpuRetestDirective,
	selectReducedCpuChampion,
} from "../src/reduced-cpu-study-protocol.js";
import type { EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome, JobView } from "../src/types.js";

const NOW = "2026-08-30T12:00:00.000Z";
const CALIBRATION_IR: Record<string, number> = Object.fromEntries(
	REDUCED_CPU_ALL_TASKS.map((task, index) => [task, 1_000 + index * 100]),
);

function acceptedTask(benchmarkId: string, irInstructionCount: number) {
	return {
		benchmarkId,
		status: "accepted" as const,
		metrics: { IrInstructionCount: irInstructionCount, ObjectTextSizeBytes: irInstructionCount * 2 },
		verifier: { passed: true, checks: [...REDUCED_CPU_REQUIRED_VERIFIER_CHECKS], errors: [] },
		runtimeMs: 10,
	};
}

function makeJob(input: {
	branchId: string;
	treatment: string;
	benchmarkIds: readonly string[];
	actions: readonly string[];
	parentJobIds: readonly string[];
	irByTask: Readonly<Record<string, number>>;
	budgetClass?: "smoke" | "confirm";
}): JobView {
	const content = JSON.stringify(input.actions);
	const candidate = {
		digest: sha256Text(content),
		byteLength: Buffer.byteLength(content),
		mediaType: "application/vnd.prime.llvm-pass-sequence",
	};
	const body = {
		branchId: input.branchId,
		lane: "compiler-gym" as const,
		benchmarkIds: [...input.benchmarkIds].sort(),
		budgetClass: input.budgetClass ?? ("smoke" as const),
		treatment: input.treatment,
		proposal: {
			hypothesis: "fixture hypothesis",
			mechanism: "fixture mechanism",
			predictedOutcome: "fixture outcome",
			boundaryConditions: ["fixture boundary"],
			parentJobIds: [...input.parentJobIds],
		},
		candidate,
		candidateFormat: "llvm-pass-sequence" as const,
		requireFreshMeasurement: true as const,
	};
	const manifestDigest = sha256Json(body);
	const jobId = `job_${manifestDigest.slice(0, 24)}`;
	return {
		proposal: { jobId, manifestDigest, ...body },
		state: { jobId, status: "succeeded", statusAt: NOW, externalJobId: "fixture-1", reason: null },
		measurement: {
			jobId,
			manifestDigest,
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			measuredAt: NOW,
			tasks: body.benchmarkIds.map((task) => acceptedTask(task, input.irByTask[task])),
			hardware: { ...REDUCED_CPU_EXPECTED_HARDWARE },
			provenance: { ...REDUCED_CPU_EXPECTED_PROVENANCE },
			stdout: null,
			stderr: null,
		},
	};
}

function calibrationEnvelope(): ReducedCpuCalibrationEnvelope {
	const job = makeJob({
		branchId: REDUCED_CPU_CALIBRATION_BRANCH_ID,
		treatment: REDUCED_CPU_CALIBRATION_TREATMENT,
		benchmarkIds: REDUCED_CPU_ALL_TASKS,
		actions: [],
		parentJobIds: [],
		irByTask: CALIBRATION_IR,
	});
	return {
		schemaVersion: 1,
		type: "reduced_cpu_study_calibration",
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		branchId: REDUCED_CPU_CALIBRATION_BRANCH_ID,
		submitted: {
			jobId: job.proposal.jobId,
			acceptedAt: NOW,
			manifestDigest: job.proposal.manifestDigest,
			duplicate: false,
		},
		job,
	};
}

function candidateEvidence(input: {
	arm: ReducedCpuStudyArm;
	branchId: string;
	ordinal: 1 | 2 | 3 | 4;
	actions: readonly string[];
	parentJobId: string | null;
	ir: number;
	calibration: ReducedCpuCalibration;
}): ReducedCpuCandidateEvidence {
	const irByTask = Object.fromEntries(REDUCED_CPU_SEARCH_TASKS.map((task) => [task, input.ir]));
	const job = makeJob({
		branchId: input.branchId,
		treatment: reducedCpuSearchTreatment(input.arm),
		benchmarkIds: REDUCED_CPU_SEARCH_TASKS,
		actions: input.actions,
		parentJobIds: input.parentJobId ? [input.parentJobId] : [],
		irByTask,
	});
	return buildReducedCpuCandidateEvidence({
		job,
		candidateContent: JSON.stringify(input.actions),
		arm: input.arm,
		branchId: input.branchId,
		ordinal: input.ordinal,
		priorJobId: input.parentJobId,
		calibration: input.calibration,
	});
}

function markSemanticVerifierRejected(candidate: ReducedCpuCandidateEvidence): void {
	candidate.verifierValid = false;
	candidate.invalidReasons = REDUCED_CPU_SEARCH_TASKS.map(
		(benchmarkId) => `${benchmarkId} is not verifier-valid measured evidence`,
	);
	for (const task of candidate.tasks) {
		task.status = "rejected";
		task.verifierPassed = false;
	}
}

function comparisonBlock(arm: ReducedCpuStudyArm, calibration: ReducedCpuCalibration): ReducedCpuArmBlock {
	const branchId = `comparison-${arm}`;
	const actions = ["-mem2reg", "-sroa", "-adce", "-instcombine"] as const;
	const candidates: ReducedCpuCandidateEvidence[] = [];
	for (let index = 0; index < actions.length; index++) {
		const ordinal = (index + 1) as 1 | 2 | 3 | 4;
		candidates.push(
			candidateEvidence({
				arm,
				branchId,
				ordinal,
				actions: actions.slice(0, index + 1),
				parentJobId: candidates[index - 1]?.jobId ?? null,
				ir: 900 - ordinal * 10,
				calibration,
			}),
		);
	}
	const championSelection = selectReducedCpuChampion(arm, candidates, calibration);
	const selected = candidates.find((candidate) => candidate.jobId === championSelection.selectedJobId);
	if (!selected) throw new Error("comparison fixture has no selected champion");
	return {
		arm,
		branchId,
		candidates,
		championSelection,
		validation: {
			arm,
			branchId,
			searchChampionJobId: selected.jobId,
			jobId: `${arm}-validation`,
			manifestDigest: "d".repeat(64),
			candidateDigest: selected.candidateDigest,
			parentJobIds: [selected.jobId],
			verifierValid: true,
			task: {
				benchmarkId: REDUCED_CPU_ALL_TASKS[3],
				irInstructionCount: 700,
				objectTextSizeBytes: 1_400,
				status: "accepted",
				verifierPassed: true,
			},
			invalidReasons: [],
		},
		resurrection: null,
		recallReceipt:
			arm === "stock"
				? null
				: {
						schemaVersion: 1,
						protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
						type: "reduced_cpu_measured_recall_receipt",
						arm,
						branchId,
						compactionEventSequence: 10,
						recallEventSequence: 11,
						candidate3ProviderRequestSequence: 12,
						recalledJobIds: [candidates[0].jobId, candidates[1].jobId],
						recallResultSha256: "a".repeat(64),
						providerIncludedRecallSha256: "a".repeat(64),
						candidate3JobId: candidates[2].jobId,
						verified: true,
					},
	};
}

class DeterministicFakeCompilerGymAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
		const actions: unknown = JSON.parse(job.candidateContent);
		if (!Array.isArray(actions)) throw new Error("fixture actions are not an array");
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: job.benchmarkIds.map((benchmarkId) =>
				acceptedTask(benchmarkId, (CALIBRATION_IR[benchmarkId] ?? 1_000) - actions.length * 10),
			),
			hardware: { ...REDUCED_CPU_EXPECTED_HARDWARE },
			provenance: { ...REDUCED_CPU_EXPECTED_PROVENANCE },
			stdout: "fixture stdout",
			stderr: "",
		};
	}
}

class ConditionalRetestFakeCompilerGymAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
		const actions: unknown = JSON.parse(job.candidateContent);
		if (!Array.isArray(actions) || !actions.every((action) => typeof action === "string")) {
			throw new Error("fixture actions are not a string array");
		}
		const improving = actions.includes("-improving");
		const invalid = actions.includes("-invalid");
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: job.benchmarkIds.map((benchmarkId) => {
				const task = acceptedTask(benchmarkId, improving ? 890 : 900);
				return invalid
					? {
							...task,
							status: "rejected" as const,
							verifier: { ...task.verifier, passed: false, errors: ["fixture semantic rejection"] },
						}
					: task;
			}),
			hardware: { ...REDUCED_CPU_EXPECTED_HARDWARE },
			provenance: { ...REDUCED_CPU_EXPECTED_PROVENANCE },
			stdout: "fixture stdout",
			stderr: "",
		};
	}
}

class IdentityRecordingFailingAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	callCount = 0;

	async evaluate(_job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		this.callCount++;
		await context.recordExternalJobId("external-calibration-fixture-1");
		throw new Error("fixture evaluator apparatus failure");
	}
}

test("calibration parser requires exact four-task current-epoch evidence", () => {
	const envelope = calibrationEnvelope();
	const parsed = parseReducedCpuCalibration(envelope);
	assert.equal(parsed.tasks.length, 4);
	assert.deepEqual(
		parsed.tasks.map((task) => task.benchmarkId),
		REDUCED_CPU_ALL_TASKS,
	);

	const drifted = structuredClone(envelope);
	assert.ok(drifted.job.measurement);
	drifted.job.measurement.tasks[0].verifier.checks = ["raw-metrics"];
	assert.throws(() => parseReducedCpuCalibration(drifted), /check sequence/);
});

test("request parser rejects arm, task, and lineage fields supplied by the model", () => {
	assert.deepEqual(
		parseReducedCpuCandidateRequest({
			actions: ["-mem2reg"],
			hypothesis: "h",
			mechanism: "m",
			predictedOutcome: "p",
			boundaryConditions: [],
		}),
		{
			actions: ["-mem2reg"],
			hypothesis: "h",
			mechanism: "m",
			predictedOutcome: "p",
			boundaryConditions: [],
		},
	);
	assert.throws(
		() =>
			parseReducedCpuCandidateRequest({
				actions: [],
				hypothesis: "h",
				mechanism: "m",
				predictedOutcome: "p",
				boundaryConditions: [],
				arm: "M+R",
			}),
		/keys mismatch/,
	);
});

test("candidate 2 remains valid evidence but strict all-task non-improvement alone makes it R-eligible", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const branchId = "fixture-mr";
	const first = candidateEvidence({
		arm: "M+R",
		branchId,
		ordinal: 1,
		actions: ["-mem2reg"],
		parentJobId: null,
		ir: 900,
		calibration,
	});
	const second = candidateEvidence({
		arm: "M+R",
		branchId,
		ordinal: 2,
		actions: ["-mem2reg", "-adce"],
		parentJobId: first.jobId,
		ir: 900,
		calibration,
	});
	const classification = classifyReducedCpuCandidateTwo(first, second);
	assert.equal(second.verifierValid, true);
	assert.equal(classification.eligibleForRetest, true);
	assert.equal(classification.insertedAction, "-adce");

	const improvingSecond = structuredClone(second);
	for (const task of improvingSecond.tasks) task.irInstructionCount = 899;
	const improvingClassification = classifyReducedCpuCandidateTwo(first, improvingSecond);
	assert.equal(improvingSecond.verifierValid, true);
	assert.equal(improvingClassification.eligibleForRetest, false);
	assert.equal(improvingClassification.nonImprovingOnAllTasks, false);
});

test("measured verifier rejection classifier accepts only explicit rejected tasks", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const measured = candidateEvidence({
		arm: "M+R",
		branchId: "fixture-rejection-classifier",
		ordinal: 4,
		actions: ["-mem2reg"],
		parentJobId: "candidate-3",
		ir: 900,
		calibration,
	});
	measured.verifierValid = false;
	measured.tasks[0].status = "rejected";
	measured.tasks[0].verifierPassed = false;
	measured.invalidReasons = [`${measured.tasks[0].benchmarkId} is not verifier-valid measured evidence`];
	assert.equal(isReducedCpuMeasuredVerifierRejection(measured), true);

	const failed = structuredClone(measured);
	failed.tasks[0].status = "failed";
	assert.equal(isReducedCpuMeasuredVerifierRejection(failed), false);

	const corrupt = structuredClone(measured);
	corrupt.invalidReasons.push("provenance differs from calibration");
	assert.equal(isReducedCpuMeasuredVerifierRejection(corrupt), false);
});

test("sealed candidate-4 reapplication requires a practical resurrection", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const branchId = "fixture-resurrection";
	const first = candidateEvidence({
		arm: "M+R",
		branchId,
		ordinal: 1,
		actions: ["-mem2reg"],
		parentJobId: null,
		ir: 900,
		calibration,
	});
	const second = candidateEvidence({
		arm: "M+R",
		branchId,
		ordinal: 2,
		actions: ["-mem2reg", "-adce"],
		parentJobId: first.jobId,
		ir: 900,
		calibration,
	});
	const third = candidateEvidence({
		arm: "M+R",
		branchId,
		ordinal: 3,
		actions: ["-sroa", "-mem2reg"],
		parentJobId: second.jobId,
		ir: 850,
		calibration,
	});
	const classification = classifyReducedCpuCandidateTwo(first, second);
	const sealed = sealReducedCpuRetestDirective(buildReducedCpuRetestDirective(classification, third));
	assert.deepEqual(parseSealedReducedCpuRetestDirective(sealed), sealed);
	const fourth = candidateEvidence({
		arm: "M+R",
		branchId,
		ordinal: 4,
		actions: sealed.directive.actions,
		parentJobId: third.jobId,
		ir: 844,
		calibration,
	});
	const assessment = assessReducedCpuResurrection({
		classification,
		candidate3: third,
		candidate4: fourth,
		sealedDirective: sealed,
		calibration,
	});
	assert.equal(assessment.gatePassed, true);

	const trivialFourth = structuredClone(fourth);
	for (const task of trivialFourth.tasks) task.irInstructionCount = 849;
	const subthreshold = assessReducedCpuResurrection({
		classification,
		candidate3: third,
		candidate4: trivialFourth,
		sealedDirective: sealed,
		calibration,
	});
	assert.equal(subthreshold.executionValid, true);
	assert.equal(subthreshold.resurrectionSucceeded, false);
	assert.equal(subthreshold.gatePassed, false);

	const rejectedFourth = structuredClone(fourth);
	markSemanticVerifierRejected(rejectedFourth);
	const rejectedAssessment = assessReducedCpuResurrection({
		classification,
		candidate3: third,
		candidate4: rejectedFourth,
		sealedDirective: sealed,
		calibration,
	});
	assert.equal(rejectedAssessment.exactDirectiveReapplication, true);
	assert.equal(rejectedAssessment.compatibleFreshVerifierEvidence, true);
	assert.equal(rejectedAssessment.candidate4SemanticVerifierPassed, false);
	assert.equal(rejectedAssessment.executionValid, true);
	assert.equal(rejectedAssessment.resurrectionSucceeded, false);
	assert.match(rejectedAssessment.reasons.join("\n"), /semantically verifier-rejected/);

	const failedFourth = structuredClone(rejectedFourth);
	failedFourth.tasks[0].status = "failed";
	const failedAssessment = assessReducedCpuResurrection({
		classification,
		candidate3: third,
		candidate4: failedFourth,
		sealedDirective: sealed,
		calibration,
	});
	assert.equal(failedAssessment.exactDirectiveReapplication, true);
	assert.equal(failedAssessment.compatibleFreshVerifierEvidence, false);
	assert.equal(failedAssessment.executionValid, false);
	assert.equal(failedAssessment.resurrectionSucceeded, false);
});

test("champion policy minimizes worst normalized IR ratio before mean", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const branchId = "fixture-champion";
	const first = candidateEvidence({
		arm: "stock",
		branchId,
		ordinal: 1,
		actions: ["-mem2reg"],
		parentJobId: null,
		ir: 900,
		calibration,
	});
	const second = candidateEvidence({
		arm: "stock",
		branchId,
		ordinal: 2,
		actions: ["-sroa"],
		parentJobId: first.jobId,
		ir: 800,
		calibration,
	});
	const selection = selectReducedCpuChampion("stock", [first, second], calibration);
	assert.equal(selection.selectedJobId, second.jobId);
	assert.deepEqual(selection.rankedJobIds, [second.jobId, first.jobId]);
});

test("block comparison rejects strictly ordered negative recall receipt sequences", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const blocks = (["stock", "M", "M+R"] as const).map((arm) => comparisonBlock(arm, calibration));
	assert.equal(decideReducedCpuBlockComparisons(blocks, calibration).valid, true);
	const measured = blocks.find((block) => block.arm === "M");
	if (!measured?.recallReceipt) throw new Error("comparison fixture is missing the M recall receipt");
	measured.recallReceipt.compactionEventSequence = -3;
	measured.recallReceipt.recallEventSequence = -2;
	measured.recallReceipt.candidate3ProviderRequestSequence = -1;
	const decision = decideReducedCpuBlockComparisons(blocks, calibration);
	assert.equal(decision.valid, false);
	assert.match(decision.invalidReasons.join("\n"), /M lacks an exact compaction-to-recall-to-candidate-3 receipt/);
});

test("block comparison independently rejects a candidate 2 that is not an exact insertion", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const blocks = (["stock", "M", "M+R"] as const).map((arm) => comparisonBlock(arm, calibration));
	const stock = blocks.find((block) => block.arm === "stock");
	if (!stock) throw new Error("comparison fixture is missing Stock");
	stock.candidates[1].actions = ["-adce"];
	stock.candidates[1].candidateDigest = sha256Text(JSON.stringify(stock.candidates[1].actions));
	stock.championSelection = selectReducedCpuChampion("stock", stock.candidates, calibration);
	const decision = decideReducedCpuBlockComparisons(blocks, calibration);
	assert.equal(decision.valid, false);
	assert.match(decision.invalidReasons.join("\n"), /candidate 2 is not candidate 1 plus one exact/);
});

test("block comparison admits an exact no-effect retest as valid negative evidence", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const blocks = (["stock", "M", "M+R"] as const).map((arm) => comparisonBlock(arm, calibration));
	const retest = blocks.find((block) => block.arm === "M+R");
	if (!retest?.validation) throw new Error("comparison fixture is missing M+R validation");
	const [candidate1, candidate2, candidate3, candidate4] = retest.candidates;
	for (let index = 0; index < REDUCED_CPU_SEARCH_TASKS.length; index++) {
		candidate2.tasks[index].irInstructionCount = candidate1.tasks[index].irInstructionCount;
		candidate4.tasks[index].irInstructionCount = candidate3.tasks[index].irInstructionCount;
	}
	const classification = classifyReducedCpuCandidateTwo(candidate1, candidate2);
	const sealed = sealReducedCpuRetestDirective(buildReducedCpuRetestDirective(classification, candidate3));
	candidate4.actions = [...sealed.directive.actions];
	candidate4.candidateDigest = sealed.directive.candidateDigest;
	retest.resurrection = assessReducedCpuResurrection({
		classification,
		candidate3,
		candidate4,
		sealedDirective: sealed,
		calibration,
	});
	assert.equal(retest.resurrection.executionValid, true);
	assert.equal(retest.resurrection.resurrectionSucceeded, false);
	retest.championSelection = selectReducedCpuChampion("M+R", retest.candidates, calibration);
	const selected = retest.candidates.find((candidate) => candidate.jobId === retest.championSelection.selectedJobId);
	if (!selected) throw new Error("M+R fixture has no selected champion");
	retest.validation.searchChampionJobId = selected.jobId;
	retest.validation.candidateDigest = selected.candidateDigest;
	retest.validation.parentJobIds = [selected.jobId];
	const decision = decideReducedCpuBlockComparisons(blocks, calibration);
	assert.equal(decision.valid, true);
	assert.notEqual(decision.transferEligibleArm, "M+R");
});

test("block comparison admits an exact semantic-rejected candidate 4 as valid negative evidence", () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const blocks = (["stock", "M", "M+R"] as const).map((arm) => comparisonBlock(arm, calibration));
	const retest = blocks.find((block) => block.arm === "M+R");
	if (!retest?.validation) throw new Error("comparison fixture is missing M+R validation");
	const [candidate1, candidate2, candidate3, candidate4] = retest.candidates;
	for (let index = 0; index < REDUCED_CPU_SEARCH_TASKS.length; index++) {
		candidate2.tasks[index].irInstructionCount = candidate1.tasks[index].irInstructionCount;
	}
	const classification = classifyReducedCpuCandidateTwo(candidate1, candidate2);
	const sealed = sealReducedCpuRetestDirective(buildReducedCpuRetestDirective(classification, candidate3));
	candidate4.actions = [...sealed.directive.actions];
	candidate4.candidateDigest = sealed.directive.candidateDigest;
	markSemanticVerifierRejected(candidate4);
	retest.resurrection = assessReducedCpuResurrection({
		classification,
		candidate3,
		candidate4,
		sealedDirective: sealed,
		calibration,
	});
	assert.equal(retest.resurrection.executionValid, true);
	assert.equal(retest.resurrection.candidate4SemanticVerifierPassed, false);
	assert.equal(retest.resurrection.resurrectionSucceeded, false);
	retest.championSelection = selectReducedCpuChampion("M+R", retest.candidates, calibration);
	const selected = retest.candidates.find((candidate) => candidate.jobId === retest.championSelection.selectedJobId);
	if (!selected) throw new Error("M+R fixture has no selected champion");
	retest.validation.searchChampionJobId = selected.jobId;
	retest.validation.candidateDigest = selected.candidateDigest;
	retest.validation.parentJobIds = [selected.jobId];
	const decision = decideReducedCpuBlockComparisons(blocks, calibration);
	assert.equal(decision.valid, true);
	assert.notEqual(decision.transferEligibleArm, "M+R");

	candidate4.tasks[0].status = "failed";
	retest.resurrection = assessReducedCpuResurrection({
		classification,
		candidate3,
		candidate4,
		sealedDirective: sealed,
		calibration,
	});
	const failedDecision = decideReducedCpuBlockComparisons(blocks, calibration);
	assert.equal(failedDecision.valid, false);
	assert.match(failedDecision.invalidReasons.join("\n"), /apparatus-invalid|execution is invalid/);
});

test("controller binds scope, enforces the same candidate-2 insertion in every arm, and audits fresh evidence", async () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const root = await mkdtemp(join(tmpdir(), "reduced-cpu-study-"));
	try {
		const request = (actions: string[]) => ({
			actions,
			hypothesis: "fixture hypothesis",
			mechanism: "fixture mechanism",
			predictedOutcome: "fixture outcome",
			boundaryConditions: [],
		});
		for (const arm of ["stock", "M", "M+R"] as const) {
			const outputDir = join(root, arm.toLowerCase().replace("+", "-plus-"));
			const controller = await openReducedCpuStudyController({
				outputDir,
				arm,
				adapter: new DeterministicFakeCompilerGymAdapter(),
			});
			const acceptedBranchId = `${arm}-accepted-branch`;
			await submitReducedCpuSearchCandidate({
				controller,
				outputDir,
				arm,
				branchId: acceptedBranchId,
				calibration,
				request: request(["-mem2reg"]),
			});
			const second = await submitReducedCpuSearchCandidate({
				controller,
				outputDir,
				arm,
				branchId: acceptedBranchId,
				calibration,
				request: request(["-mem2reg", "-adce"]),
			});
			assert.equal(second.ordinal, 2);
			assert.equal(second.job.proposal.requireFreshMeasurement, true);
			assert.equal(second.job.measurement?.reuse, undefined);

			const rejectedBranchId = `${arm}-rejected-branch`;
			await submitReducedCpuSearchCandidate({
				controller,
				outputDir,
				arm,
				branchId: rejectedBranchId,
				calibration,
				request: request(["-mem2reg"]),
			});
			await assert.rejects(
				submitReducedCpuSearchCandidate({
					controller,
					outputDir,
					arm,
					branchId: rejectedBranchId,
					calibration,
					request: request(["-sroa", "-adce"]),
				}),
				/exactly one unambiguous pass insertion/,
			);
			await verifyReducedCpuStudyLedgerStrict(controller, outputDir);
			const firstLedgerLine = (await readFile(join(outputDir, "evidence.jsonl"), "utf8")).split("\n")[0];
			assert.doesNotThrow(() => JSON.parse(firstLedgerLine));
			assert.equal((await stat(outputDir)).mode & 0o777, 0o700);
			assert.equal((await stat(join(outputDir, "evidence.jsonl"))).mode & 0o777, 0o600);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("M+R leaves R dormant and permits a normal candidate 4 for every scientific ineligibility condition", async () => {
	const calibration = parseReducedCpuCalibration(calibrationEnvelope());
	const root = await mkdtemp(join(tmpdir(), "reduced-cpu-dormant-r-"));
	const request = (actions: string[]) => ({
		actions,
		hypothesis: "fixture hypothesis",
		mechanism: "fixture mechanism",
		predictedOutcome: "fixture outcome",
		boundaryConditions: [],
	});
	const cases = [
		{
			name: "candidate-2-improved",
			candidate1: ["-mem2reg"],
			candidate2: ["-mem2reg", "-improving"],
			candidate3: ["-sroa"],
		},
		{
			name: "candidate-3-invalid",
			candidate1: ["-mem2reg"],
			candidate2: ["-mem2reg", "-adce"],
			candidate3: ["-invalid"],
		},
		{
			name: "candidate-3-unchanged",
			candidate1: ["-mem2reg"],
			candidate2: ["-mem2reg", "-adce"],
			candidate3: ["-mem2reg"],
		},
		{
			name: "insertion-index-out-of-bounds",
			candidate1: ["-mem2reg", "-sroa"],
			candidate2: ["-mem2reg", "-sroa", "-adce"],
			candidate3: ["-instcombine"],
		},
	] as const;
	try {
		for (const fixture of cases) {
			const outputDir = join(root, fixture.name);
			const branchId = `${fixture.name}-branch`;
			const controller = await openReducedCpuStudyController({
				outputDir,
				arm: "M+R",
				adapter: new ConditionalRetestFakeCompilerGymAdapter(),
			});
			for (const actions of [fixture.candidate1, fixture.candidate2, fixture.candidate3]) {
				await submitReducedCpuSearchCandidate({
					controller,
					outputDir,
					arm: "M+R",
					branchId,
					calibration,
					request: request([...actions]),
				});
			}
			assert.equal(
				await prepareReducedCpuRetestDirective({ controller, outputDir, branchId, calibration }),
				null,
				fixture.name,
			);
			const fourth = await submitReducedCpuSearchCandidate({
				controller,
				outputDir,
				arm: "M+R",
				branchId,
				calibration,
				request: request(["-gvn"]),
			});
			assert.equal(fourth.ordinal, 4, fixture.name);
			assert.equal(fourth.retestDirectiveSha256, null, fixture.name);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("calibration module writes one private four-task current-epoch artifact", async () => {
	const root = await mkdtemp(join(tmpdir(), "reduced-cpu-calibration-"));
	try {
		const outputDir = join(root, "calibration");
		const result = await runReducedCpuCalibration({
			outputDir,
			adapter: new DeterministicFakeCompilerGymAdapter(),
		});
		assert.equal(result.calibration.tasks.length, REDUCED_CPU_ALL_TASKS.length);
		assert.equal(result.calibration.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
		assert.equal(result.terminal.outcome, "success");
		assert.equal(result.terminal.deadlineMs, REDUCED_CPU_CALIBRATION_DEADLINE_MS);
		assert.equal(result.terminal.knownLedgerState.strictVerificationPassed, true);
		assert.equal((await stat(result.resultPath)).mode & 0o777, 0o600);
		assert.equal((await stat(result.terminalResultPath)).mode & 0o777, 0o600);
		assert.equal((await stat(join(outputDir, "attempt.lock"))).mode & 0o777, 0o600);
		assert.equal((await stat(join(outputDir, "start-intent.json"))).mode & 0o777, 0o600);
		const attemptLock = JSON.parse(await readFile(join(outputDir, "attempt.lock"), "utf8")) as {
			attemptId: string;
			attemptIdentitySha256: string;
			attemptIdentity: unknown;
		};
		const startIntent = JSON.parse(await readFile(join(outputDir, "start-intent.json"), "utf8")) as {
			attemptId: string;
			attemptIdentitySha256: string;
		};
		assert.equal(attemptLock.attemptId, startIntent.attemptId);
		assert.equal(attemptLock.attemptIdentitySha256, startIntent.attemptIdentitySha256);
		assert.equal(attemptLock.attemptIdentitySha256, sha256Json(attemptLock.attemptIdentity));
		const ledgerLines = (await readFile(join(outputDir, "evidence.jsonl"), "utf8")).trim().split("\n");
		const firstLedgerEvent = JSON.parse(ledgerLines[0]) as { kind: string; payload: { type?: string } };
		assert.equal(firstLedgerEvent.kind, "run_manifest");
		assert.equal(firstLedgerEvent.payload.type, "reduced_cpu_calibration_start_intent");
		await assert.rejects(
			runReducedCpuCalibration({ outputDir, adapter: new DeterministicFakeCompilerGymAdapter() }),
			/fresh output namespace; path already exists/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("calibration refuses every preexisting namespace before acquiring an attempt", async () => {
	const root = await mkdtemp(join(tmpdir(), "reduced-cpu-calibration-existing-"));
	try {
		const outputDir = join(root, "preexisting");
		await mkdir(outputDir, { mode: 0o700 });
		const adapter = new IdentityRecordingFailingAdapter();
		await assert.rejects(
			runReducedCpuCalibration({ outputDir, adapter }),
			/fresh output namespace; path already exists/,
		);
		assert.equal(adapter.callCount, 0);
		assert.deepEqual(await readdir(outputDir), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("calibration apparatus failure records one external attempt and durable terminal evidence", async () => {
	const root = await mkdtemp(join(tmpdir(), "reduced-cpu-calibration-failure-"));
	try {
		const outputDir = join(root, "attempt");
		const adapter = new IdentityRecordingFailingAdapter();
		await assert.rejects(runReducedCpuCalibration({ outputDir, adapter }), /current|succeed|verifier|calibration/i);
		assert.equal(adapter.callCount, 1);
		const terminal = JSON.parse(await readFile(join(outputDir, "result.json"), "utf8")) as {
			outcome: string;
			submitted: { jobId: string } | null;
			externalJobIdentities: Array<{ jobId: string; externalJobId: string | null; status: string }>;
			knownJobs: JobView[];
			knownLedgerState: { strictVerificationPassed: boolean; eventCount: number | null };
			calibrationPath: string | null;
			error: { message: string } | null;
		};
		assert.equal(terminal.outcome, "apparatus-invalid");
		assert.ok(terminal.submitted);
		assert.deepEqual(terminal.externalJobIdentities, [
			{
				jobId: terminal.submitted.jobId,
				externalJobId: "external-calibration-fixture-1",
				status: "failed",
			},
		]);
		assert.equal(terminal.knownJobs[0]?.state.externalJobId, "external-calibration-fixture-1");
		assert.equal(terminal.knownLedgerState.strictVerificationPassed, true);
		assert.ok((terminal.knownLedgerState.eventCount ?? 0) > 0);
		assert.equal(terminal.calibrationPath, null);
		assert.ok(terminal.error?.message);
		await assert.rejects(stat(join(outputDir, "calibration.json")), /ENOENT/);
		await assert.rejects(
			runReducedCpuCalibration({ outputDir, adapter }),
			/fresh output namespace; path already exists/,
		);
		assert.equal(adapter.callCount, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("calibration idle wait has a hard deadline", async () => {
	await assert.rejects(
		waitForReducedCpuCalibrationIdleWithDeadline(() => new Promise<void>(() => undefined), 5),
		/deadline exceeded after 5ms; attempt is terminal and must not be retried/,
	);
});

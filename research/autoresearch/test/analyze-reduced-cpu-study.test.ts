import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	analyzeReducedCpuStudy,
	type ReducedCpuStudyArmAnalysisEvidence,
	serializeReducedCpuStudyAnalysis,
} from "../src/analyze-reduced-cpu-study.js";
import { sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	assessReducedCpuResurrection,
	classifyReducedCpuCandidateTwo,
	maybeBuildReducedCpuRetestDirective,
	REDUCED_CPU_ALL_TASKS,
	REDUCED_CPU_SEARCH_TASKS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	REDUCED_CPU_VALIDATION_TASK,
	type ReducedCpuArmBlock,
	type ReducedCpuCalibration,
	type ReducedCpuCandidateEvidence,
	type ReducedCpuStudyArm,
	sealReducedCpuRetestDirective,
	selectReducedCpuChampion,
} from "../src/reduced-cpu-study-protocol.js";

type SearchVector = readonly [number, number, number];

const CALIBRATION_VALUES = [1_000, 2_000, 10_000, 800] as const;

const calibration: ReducedCpuCalibration = {
	protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
	jobId: "calibration-job",
	manifestDigest: "c".repeat(64),
	tasks: REDUCED_CPU_ALL_TASKS.map((benchmarkId, index) => ({
		benchmarkId,
		irInstructionCount: CALIBRATION_VALUES[index],
		objectTextSizeBytes: CALIBRATION_VALUES[index] * 10,
		verifierPassed: true,
	})),
	hardware: { host: "faux" },
	provenance: { evaluator: "faux" },
};

function actionsFor(arm: ReducedCpuStudyArm, ordinal: 1 | 2 | 3 | 4): string[] {
	if (arm === "M+R") {
		if (ordinal === 1) return ["-mem2reg"];
		if (ordinal === 2) return ["-mem2reg", "-adce"];
		if (ordinal === 3) return ["-sroa", "-mem2reg"];
		return ["-sroa", "-adce", "-mem2reg"];
	}
	return Array.from({ length: ordinal }, (_, index) => `-${arm.toLowerCase()}-pass-${index + 1}`);
}

function candidate(
	arm: ReducedCpuStudyArm,
	ordinal: 1 | 2 | 3 | 4,
	vector: SearchVector,
	priorJobId: string | null,
): ReducedCpuCandidateEvidence {
	const actions = actionsFor(arm, ordinal);
	return {
		arm,
		branchId: `${arm}-branch`,
		ordinal,
		jobId: `${arm}-job-${ordinal}`,
		manifestDigest: ordinal.toString(16).repeat(64),
		candidateDigest: sha256Text(JSON.stringify(actions)),
		actions,
		parentJobIds: priorJobId === null ? [] : [priorJobId],
		verifierValid: true,
		tasks: REDUCED_CPU_SEARCH_TASKS.map((benchmarkId, index) => ({
			benchmarkId,
			irInstructionCount: vector[index],
			objectTextSizeBytes: vector[index] * 10,
			status: "accepted",
			verifierPassed: true,
		})),
		invalidReasons: [],
	};
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

function block(
	arm: ReducedCpuStudyArm,
	vectors: readonly [SearchVector, SearchVector, SearchVector, SearchVector],
	dijkstraIr: number,
): { block: ReducedCpuArmBlock; sealedRetestDirective: ReducedCpuStudyArmAnalysisEvidence["sealedRetestDirective"] } {
	const candidates: ReducedCpuCandidateEvidence[] = [];
	for (let index = 0; index < vectors.length; index++) {
		const ordinal = (index + 1) as 1 | 2 | 3 | 4;
		candidates.push(candidate(arm, ordinal, vectors[index], candidates[index - 1]?.jobId ?? null));
	}
	const championSelection = selectReducedCpuChampion(arm, candidates, calibration);
	const selected = candidates.find((item) => item.jobId === championSelection.selectedJobId);
	if (!selected) throw new Error("fixture has no selected champion");
	let sealedRetestDirective: ReducedCpuStudyArmAnalysisEvidence["sealedRetestDirective"] = null;
	let resurrection: ReducedCpuArmBlock["resurrection"] = null;
	if (arm === "M+R") {
		const classification = classifyReducedCpuCandidateTwo(candidates[0], candidates[1]);
		const directive = maybeBuildReducedCpuRetestDirective(classification, candidates[2]);
		if (directive !== null) {
			sealedRetestDirective = sealReducedCpuRetestDirective(directive);
			resurrection = assessReducedCpuResurrection({
				classification,
				candidate3: candidates[2],
				candidate4: candidates[3],
				sealedDirective: sealedRetestDirective,
				calibration,
			});
		}
	}
	return {
		block: {
			arm,
			branchId: `${arm}-branch`,
			candidates,
			championSelection,
			validation: {
				arm,
				branchId: `${arm}-branch`,
				searchChampionJobId: selected.jobId,
				jobId: `${arm}-dijkstra-job`,
				manifestDigest: "d".repeat(64),
				candidateDigest: selected.candidateDigest,
				parentJobIds: [selected.jobId],
				verifierValid: true,
				task: {
					benchmarkId: REDUCED_CPU_VALIDATION_TASK,
					irInstructionCount: dijkstraIr,
					objectTextSizeBytes: dijkstraIr * 10,
					status: "accepted",
					verifierPassed: true,
				},
				invalidReasons: [],
			},
			resurrection,
			recallReceipt:
				arm === "stock"
					? null
					: {
							schemaVersion: 1,
							protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
							type: "reduced_cpu_measured_recall_receipt",
							arm,
							branchId: `${arm}-branch`,
							compactionEventSequence: 10,
							recallEventSequence: 11,
							candidate3ProviderRequestSequence: 12,
							recalledJobIds: [candidates[0].jobId, candidates[1].jobId],
							recallResultSha256: "a".repeat(64),
							providerIncludedRecallSha256: "a".repeat(64),
							candidate3JobId: candidates[2].jobId,
							verified: true,
						},
		},
		sealedRetestDirective,
	};
}

function armEvidence(
	arm: ReducedCpuStudyArm,
	vectors: readonly [SearchVector, SearchVector, SearchVector, SearchVector],
	dijkstraIr: number,
): ReducedCpuStudyArmAnalysisEvidence {
	const built = block(arm, vectors, dijkstraIr);
	const priorCandidates = built.block.candidates.slice(0, 2);
	const priorJobIds = priorCandidates.map((item) => item.jobId);
	const agentProviderCalls = arm === "stock" ? 4 : arm === "M" ? 5 : built.sealedRetestDirective ? 4 : 5;
	const compactionProviderCalls = 1;
	const providerCalls = agentProviderCalls + compactionProviderCalls;
	return {
		...built,
		integrityErrors: [],
		efficiency: {
			agentProviderCalls,
			compactionProviderCalls,
			compactionTransportAttempts: 1,
			providerCalls,
			blockedProviderCalls: 2,
			inputTokens: providerCalls * 100,
			outputTokens: providerCalls * 10,
			cacheReadTokens: providerCalls * 5,
			cacheWriteTokens: 0,
			totalTokens: providerCalls * 115,
			evaluatorDispatches: 5,
			evaluatorTaskEvaluations: 13,
			evaluatorWallMs: 1_000 + providerCalls,
			evaluatorCpuSeconds: 100 + providerCalls,
		},
		continuity: {
			compactionCount: 1,
			compactionAfterCandidateOrdinal: 2,
			recallAttempts: arm === "stock" ? 0 : 1,
			successfulRecallAttempts: arm === "stock" ? 0 : 1,
			expectedRecalledJobIds: arm === "stock" ? [] : priorJobIds,
			recalledJobIds: arm === "stock" ? [] : priorJobIds,
			sealedContextAudit: {
				kernelStateInspected: true,
				toolStateInspected: true,
				workspaceStateInspected: true,
				forbiddenPriorJobIdsFound: [],
				forbiddenPriorCandidateDigestsFound: [],
			},
		},
	};
}

const STOCK_VECTORS = [
	[950, 1_900, 9_500],
	[940, 1_900, 9_500],
	[930, 1_850, 9_300],
	[920, 1_800, 9_000],
] as const satisfies readonly [SearchVector, SearchVector, SearchVector, SearchVector];

const M_VECTORS = [
	[950, 1_900, 9_500],
	[940, 1_900, 9_500],
	[920, 1_800, 9_000],
	[915, 1_800, 9_000],
] as const satisfies readonly [SearchVector, SearchVector, SearchVector, SearchVector];

const MR_VECTORS = [
	[940, 1_900, 9_500],
	[940, 1_900, 9_500],
	[920, 1_800, 9_000],
	[910, 1_780, 8_900],
] as const satisfies readonly [SearchVector, SearchVector, SearchVector, SearchVector];

function validStudy() {
	return {
		calibration,
		arms: [
			armEvidence("stock", STOCK_VECTORS, 800),
			armEvidence("M", M_VECTORS, 795),
			armEvidence("M+R", MR_VECTORS, 790),
		],
	};
}

describe("reduced CPU study analyzer", () => {
	it("selects M+R only after both incremental wins and a genuine practical resurrection", () => {
		const analysis = analyzeReducedCpuStudy(validStudy());
		assert.deepEqual(
			analysis.comparisons.map((comparison) => [
				comparison.treatmentArm,
				comparison.comparatorArm,
				comparison.status,
			]),
			[
				["M", "stock", "win"],
				["M+R", "M", "win"],
				["M+R", "stock", "win"],
			],
		);
		assert.equal(analysis.overall.selectedArm, "M+R");
		assert.equal(analysis.overall.mPlusRIncrementalWinAgainstM, true);
		const resurrection = analysis.arms.find((arm) => arm.arm === "M+R")?.resurrection;
		assert.equal(resurrection?.eligible, true);
		assert.equal(resurrection?.earlierChild.nonImprovingOnAllSearchTasks, true);
		assert.equal(resurrection?.laterReapply.exactReapply, true);
		assert.equal(resurrection?.laterReapply.practicallyBetterOnAtLeastOneSearchTask, true);
	});

	it("uses task-local calibration and emits stable canonical JSON without raw-count averaging", () => {
		const input = validStudy();
		const first = analyzeReducedCpuStudy(input);
		const second = analyzeReducedCpuStudy({ calibration, arms: [...input.arms].reverse() });
		assert.equal(serializeReducedCpuStudyAnalysis(first), serializeReducedCpuStudyAnalysis(second));
		const m = first.arms.find((arm) => arm.arm === "M");
		assert.deepEqual(
			m?.selectedSearchTasks.map((task) => [task.benchmarkId, task.exactRatio, task.practicalMarginIr]),
			[
				[REDUCED_CPU_SEARCH_TASKS[0], "915/1000", 5],
				[REDUCED_CPU_SEARCH_TASKS[1], "1800/2000", 10],
				[REDUCED_CPU_SEARCH_TASKS[2], "9000/10000", 50],
			],
		);
		assert.equal(first.taskPolicy.rawCountAggregation, "forbidden");
		assert.doesNotMatch(serializeReducedCpuStudyAnalysis(first), /averageIr|meanIr|aggregateIr/);
		const mrVsM = first.comparisons.find(
			(comparison) => comparison.treatmentArm === "M+R" && comparison.comparatorArm === "M",
		);
		assert.equal(mrVsM?.efficiency.provider.agentProviderCalls.comparator, 5);
		assert.equal(mrVsM?.efficiency.provider.agentProviderCalls.treatment, 4);
		assert.equal(mrVsM?.efficiency.provider.compactionProviderCalls.comparator, 1);
		assert.equal(mrVsM?.efficiency.provider.compactionProviderCalls.treatment, 1);
		assert.equal(mrVsM?.efficiency.provider.compactionTransportAttempts.comparator, 1);
		assert.equal(mrVsM?.efficiency.provider.compactionTransportAttempts.treatment, 1);
		assert.equal(mrVsM?.efficiency.provider.providerCalls.comparator, 6);
		assert.equal(mrVsM?.efficiency.provider.providerCalls.treatment, 5);
	});

	it("requires one paid native compaction call and one transport attempt in each arm total", () => {
		const valid = analyzeReducedCpuStudy(validStudy());
		assert.deepEqual(
			valid.arms.map((arm) => [
				arm.arm,
				arm.efficiency.agentProviderCalls,
				arm.efficiency.compactionProviderCalls,
				arm.efficiency.compactionTransportAttempts,
				arm.efficiency.providerCalls,
				arm.efficiency.totalTokens,
			]),
			[
				["stock", 4, 1, 1, 5, 575],
				["M", 5, 1, 1, 6, 690],
				["M+R", 4, 1, 1, 5, 575],
			],
		);

		const missingCompaction = validStudy();
		const measured = missingCompaction.arms.find((arm) => arm.block.arm === "M");
		if (!measured) throw new Error("missing M fixture");
		measured.efficiency.compactionProviderCalls = 0;
		measured.efficiency.providerCalls = measured.efficiency.agentProviderCalls;
		const analysis = analyzeReducedCpuStudy(missingCompaction);
		const measuredAnalysis = analysis.arms.find((arm) => arm.arm === "M");
		assert.equal(measuredAnalysis?.valid, false);
		assert.match(
			measuredAnalysis?.invalidReasons.join("\n") ?? "",
			/exactly one paid native compaction provider call/,
		);

		const inconsistentTotal = validStudy();
		const stock = inconsistentTotal.arms.find((arm) => arm.block.arm === "stock");
		if (!stock) throw new Error("missing Stock fixture");
		stock.efficiency.providerCalls++;
		const totalAnalysis = analyzeReducedCpuStudy(inconsistentTotal);
		assert.match(
			totalAnalysis.arms.find((arm) => arm.arm === "stock")?.invalidReasons.join("\n") ?? "",
			/total provider calls do not equal agent plus compaction provider calls/,
		);

		const duplicateTransport = validStudy();
		const retest = duplicateTransport.arms.find((arm) => arm.block.arm === "M+R");
		if (!retest) throw new Error("missing M+R fixture");
		retest.efficiency.compactionTransportAttempts = 2;
		const transportAnalysis = analyzeReducedCpuStudy(duplicateTransport);
		assert.match(
			transportAnalysis.arms.find((arm) => arm.arm === "M+R")?.invalidReasons.join("\n") ?? "",
			/exactly one native compaction transport attempt/,
		);

		const executedWeakRetest = armEvidence(
			"M+R",
			[
				[940, 1_900, 9_500],
				[940, 1_900, 9_500],
				[920, 1_800, 9_000],
				[919, 1_800, 9_000],
			],
			790,
		);
		assert.equal(executedWeakRetest.block.resurrection?.gatePassed, false);
		assert.notEqual(executedWeakRetest.sealedRetestDirective, null);
		assert.equal(executedWeakRetest.efficiency.agentProviderCalls, 4);
		assert.equal(executedWeakRetest.efficiency.compactionProviderCalls, 1);
		assert.equal(executedWeakRetest.efficiency.providerCalls, 5);

		const dormantRetest = armEvidence(
			"M+R",
			[
				[950, 1_900, 9_500],
				[940, 1_890, 9_490],
				[920, 1_800, 9_000],
				[910, 1_790, 8_990],
			],
			790,
		);
		assert.equal(dormantRetest.block.resurrection, null);
		assert.equal(dormantRetest.sealedRetestDirective, null);
		assert.equal(dormantRetest.efficiency.agentProviderCalls, 5);
		assert.equal(dormantRetest.efficiency.compactionProviderCalls, 1);
		assert.equal(dormantRetest.efficiency.providerCalls, 6);
	});

	it("accepts the exact three-versus-four earlier-frontier path when the selected champion is mixed", () => {
		const stock = armEvidence(
			"stock",
			[
				[1_000, 2_000, 10_000],
				[990, 2_100, 10_000],
				[980, 2_200, 10_000],
				[900, 1_900, 9_000],
			],
			800,
		);
		const m = armEvidence(
			"M",
			[
				[1_000, 2_000, 10_000],
				[990, 2_100, 10_000],
				[895, 1_900, 9_000],
				[890, 1_900, 9_001],
			],
			800,
		);
		const analysis = analyzeReducedCpuStudy({
			calibration,
			arms: [stock, m, armEvidence("M+R", MR_VECTORS, 790)],
		});
		const comparison = analysis.comparisons.find(
			(item) => item.treatmentArm === "M" && item.comparatorArm === "stock",
		);
		assert.equal(comparison?.directChampionGate.passed, false);
		assert.equal(comparison?.earlierDominatingFrontierGate.passed, true);
		assert.equal(comparison?.earlierDominatingFrontierGate.treatmentFirstDominatingComparatorFinalProposal, 3);
		assert.equal(comparison?.earlierDominatingFrontierGate.comparatorFirstFinalFrontierProposal, 4);
		assert.equal(comparison?.earlierDominatingFrontierGate.proposalReductionFraction, 0.25);
		assert.equal(comparison?.winPath, "earlier-dominating-frontier");
	});

	it("reports mixed valid evidence as inconclusive and practical ties as nonwins", () => {
		const mixedM = armEvidence(
			"M",
			[
				[950, 1_950, 9_500],
				[940, 1_940, 9_400],
				[915, 1_801, 9_000],
				[916, 1_802, 9_001],
			],
			800,
		);
		const analysis = analyzeReducedCpuStudy({
			calibration,
			arms: [armEvidence("stock", STOCK_VECTORS, 800), mixedM, armEvidence("M+R", MR_VECTORS, 790)],
		});
		const mixed = analysis.comparisons.find((item) => item.treatmentArm === "M" && item.comparatorArm === "stock");
		assert.equal(mixed?.status, "inconclusive");

		const tiedM = armEvidence("M", STOCK_VECTORS, 800);
		const tied = analyzeReducedCpuStudy({
			calibration,
			arms: [armEvidence("stock", STOCK_VECTORS, 800), tiedM, armEvidence("M+R", MR_VECTORS, 790)],
		}).comparisons.find((item) => item.treatmentArm === "M" && item.comparatorArm === "stock");
		assert.equal(tied?.status, "nonwin");
		assert.equal(tied?.tiePreferredArm, "stock");
	});

	it("preserves measurements but invalidates treatment claims when continuity or recall attribution fails", () => {
		const input = validStudy();
		const m = input.arms.find((arm) => arm.block.arm === "M");
		if (!m) throw new Error("missing M fixture");
		m.continuity.recalledJobIds = ["foreign-job"];
		const analysis = analyzeReducedCpuStudy(input);
		const mAnalysis = analysis.arms.find((arm) => arm.arm === "M");
		assert.equal(mAnalysis?.measurementValid, true);
		assert.equal(mAnalysis?.treatmentClaimValid, false);
		assert.equal(mAnalysis?.continuity.status, "broken");
		assert.deepEqual(mAnalysis?.continuity.missingJobIds, ["M-job-1", "M-job-2"]);
		assert.deepEqual(mAnalysis?.continuity.unexpectedJobIds, ["foreign-job"]);
		assert.equal(
			analysis.comparisons.find((item) => item.treatmentArm === "M" && item.comparatorArm === "stock")?.status,
			"invalid",
		);
		assert.equal(analysis.overall.status, "invalid");
		assert.equal(analysis.overall.selectedArm, null);
	});

	it("rejects strictly ordered negative recall receipt sequences", () => {
		const input = validStudy();
		const measured = input.arms.find((arm) => arm.block.arm === "M");
		if (!measured?.block.recallReceipt) throw new Error("missing M recall receipt fixture");
		measured.block.recallReceipt.compactionEventSequence = -3;
		measured.block.recallReceipt.recallEventSequence = -2;
		measured.block.recallReceipt.candidate3ProviderRequestSequence = -1;
		const analysis = analyzeReducedCpuStudy(input);
		const measuredAnalysis = analysis.arms.find((arm) => arm.arm === "M");
		assert.equal(measuredAnalysis?.continuity.status, "broken");
		assert.equal(measuredAnalysis?.mechanismAttribution.recallUseReceiptValid, false);
		assert.equal(measuredAnalysis?.treatmentClaimValid, false);
		assert.equal(analysis.overall.status, "invalid");
	});

	it("keeps an exercised but ineffective recall treatment valid while withholding a feature win", () => {
		const ineffectiveM = armEvidence(
			"M",
			[
				[900, 1_790, 8_950],
				[910, 1_800, 9_000],
				[920, 1_810, 9_050],
				[930, 1_820, 9_100],
			],
			790,
		);
		const analysis = analyzeReducedCpuStudy({
			calibration,
			arms: [armEvidence("stock", STOCK_VECTORS, 800), ineffectiveM, armEvidence("M+R", MR_VECTORS, 790)],
		});
		const m = analysis.arms.find((arm) => arm.arm === "M");
		assert.equal(m?.continuity.status, "continuous");
		assert.equal(m?.mechanismAttribution.contributed, true);
		assert.equal(m?.mechanismAttribution.selectedChampionIsPostCompaction, false);
		assert.equal(m?.mechanismAttribution.postCompactionCandidateImprovesPreCompactionFrontier, false);
		assert.equal(m?.mechanismAttribution.winnerEligible, false);
		assert.equal(m?.treatmentClaimValid, true);
		assert.notEqual(
			analysis.comparisons.find((item) => item.treatmentArm === "M" && item.comparatorArm === "stock")?.status,
			"win",
		);
	});

	it("keeps harmful, no-effect, and subthreshold exact retests as valid negative evidence", () => {
		const cases = [
			{
				name: "harmful",
				candidate4: [901, 1_700, 8_500] as SearchVector,
			},
			{
				name: "no-effect",
				candidate4: [900, 1_700, 8_500] as SearchVector,
			},
			{
				name: "subthreshold",
				candidate4: [899, 1_700, 8_500] as SearchVector,
			},
		] as const;
		for (const fixture of cases) {
			const negativeRetest = armEvidence(
				"M+R",
				[[940, 1_900, 9_500], [940, 1_900, 9_500], [900, 1_700, 8_500], fixture.candidate4],
				790,
			);
			const analysis = analyzeReducedCpuStudy({
				calibration,
				arms: [armEvidence("stock", STOCK_VECTORS, 800), armEvidence("M", M_VECTORS, 795), negativeRetest],
			});
			const mr = analysis.arms.find((arm) => arm.arm === "M+R");
			assert.equal(mr?.measurementValid, true, fixture.name);
			assert.equal(mr?.resurrection?.executionValid, true, fixture.name);
			assert.equal(mr?.resurrection?.apparatusValid, true, fixture.name);
			assert.equal(mr?.resurrection?.resurrectionSucceeded, false, fixture.name);
			assert.equal(mr?.resurrection?.status, "executed-no-resurrection", fixture.name);
			assert.equal(mr?.treatmentClaimValid, true, fixture.name);
			const comparison = analysis.comparisons.find(
				(item) => item.treatmentArm === "M+R" && item.comparatorArm === "M",
			);
			assert.notEqual(comparison?.status, "invalid", fixture.name);
			assert.notEqual(comparison?.status, "win", fixture.name);
			assert.equal(comparison?.directChampionGate.mechanismWinnerEligible, false, fixture.name);
		}
	});

	it("treats a semantic-invalid candidate 3 as dormant R evidence without invalidating the arm", () => {
		const dormant = armEvidence("M+R", MR_VECTORS, 790);
		const candidate3 = dormant.block.candidates.find((candidate) => candidate.ordinal === 3);
		if (!candidate3) throw new Error("missing candidate 3 fixture");
		markSemanticVerifierRejected(candidate3);
		dormant.block.championSelection = selectReducedCpuChampion("M+R", dormant.block.candidates, calibration);
		dormant.sealedRetestDirective = null;
		dormant.block.resurrection = null;
		dormant.efficiency.agentProviderCalls = 5;
		dormant.efficiency.providerCalls = 6;
		const analysis = analyzeReducedCpuStudy({
			calibration,
			arms: [armEvidence("stock", STOCK_VECTORS, 800), armEvidence("M", M_VECTORS, 795), dormant],
		});
		const mr = analysis.arms.find((arm) => arm.arm === "M+R");
		assert.equal(mr?.measurementValid, true);
		assert.equal(mr?.resurrection?.status, "dormant");
		assert.equal(mr?.resurrection?.apparatusValid, true);
		assert.equal(mr?.resurrection?.resurrectionSucceeded, false);
		assert.equal(mr?.treatmentClaimValid, true);
		assert.notEqual(analysis.overall.status, "invalid");
	});

	it("admits an exact semantic-rejected candidate 4 as executed negative evidence", () => {
		const negative = armEvidence("M+R", MR_VECTORS, 790);
		const [candidate1, candidate2, candidate3, candidate4] = negative.block.candidates;
		if (!negative.sealedRetestDirective || !negative.block.validation) {
			throw new Error("missing eligible retest fixture evidence");
		}
		markSemanticVerifierRejected(candidate4);
		negative.block.resurrection = assessReducedCpuResurrection({
			classification: classifyReducedCpuCandidateTwo(candidate1, candidate2),
			candidate3,
			candidate4,
			sealedDirective: negative.sealedRetestDirective,
			calibration,
		});
		negative.block.championSelection = selectReducedCpuChampion("M+R", negative.block.candidates, calibration);
		const selected = negative.block.candidates.find(
			(candidate) => candidate.jobId === negative.block.championSelection.selectedJobId,
		);
		if (!selected) throw new Error("semantic-rejected fixture has no selected champion");
		negative.block.validation.searchChampionJobId = selected.jobId;
		negative.block.validation.candidateDigest = selected.candidateDigest;
		negative.block.validation.parentJobIds = [selected.jobId];
		const analysis = analyzeReducedCpuStudy({
			calibration,
			arms: [armEvidence("stock", STOCK_VECTORS, 800), armEvidence("M", M_VECTORS, 795), negative],
		});
		const mr = analysis.arms.find((arm) => arm.arm === "M+R");
		assert.equal(mr?.measurementValid, true);
		assert.equal(mr?.treatmentClaimValid, true);
		assert.equal(mr?.resurrection?.status, "executed-no-resurrection");
		assert.equal(mr?.resurrection?.executionValid, true);
		assert.equal(mr?.resurrection?.apparatusValid, true);
		assert.equal(mr?.resurrection?.resurrectionSucceeded, false);
		assert.equal(mr?.resurrection?.laterReapply.semanticVerifierPassed, false);
		assert.equal(mr?.resurrection?.laterReapply.semanticVerifierRejected, true);
		assert.match(mr?.resurrection?.reasons.join("\n") ?? "", /semantically verifier-rejected/);
		const comparison = analysis.comparisons.find((item) => item.treatmentArm === "M+R" && item.comparatorArm === "M");
		assert.notEqual(comparison?.status, "invalid");
		assert.notEqual(comparison?.status, "win");
		assert.equal(comparison?.directChampionGate.mechanismWinnerEligible, false);
		assert.notEqual(analysis.overall.status, "invalid");
	});

	it("invalidates an exact candidate 4 whose evaluator task failed instead of rejecting semantically", () => {
		const invalid = armEvidence("M+R", MR_VECTORS, 790);
		const [candidate1, candidate2, candidate3, candidate4] = invalid.block.candidates;
		if (!invalid.sealedRetestDirective || !invalid.block.validation) {
			throw new Error("missing eligible retest fixture evidence");
		}
		markSemanticVerifierRejected(candidate4);
		candidate4.tasks[0].status = "failed";
		invalid.block.resurrection = assessReducedCpuResurrection({
			classification: classifyReducedCpuCandidateTwo(candidate1, candidate2),
			candidate3,
			candidate4,
			sealedDirective: invalid.sealedRetestDirective,
			calibration,
		});
		invalid.block.championSelection = selectReducedCpuChampion("M+R", invalid.block.candidates, calibration);
		const selected = invalid.block.candidates.find(
			(candidate) => candidate.jobId === invalid.block.championSelection.selectedJobId,
		);
		if (!selected) throw new Error("failed-evaluator fixture has no selected champion");
		invalid.block.validation.searchChampionJobId = selected.jobId;
		invalid.block.validation.candidateDigest = selected.candidateDigest;
		invalid.block.validation.parentJobIds = [selected.jobId];
		const analysis = analyzeReducedCpuStudy({
			calibration,
			arms: [armEvidence("stock", STOCK_VECTORS, 800), armEvidence("M", M_VECTORS, 795), invalid],
		});
		const mr = analysis.arms.find((arm) => arm.arm === "M+R");
		assert.equal(mr?.measurementValid, false);
		assert.equal(mr?.treatmentClaimValid, false);
		assert.equal(mr?.resurrection?.status, "invalid-execution");
		assert.equal(mr?.resurrection?.executionValid, false);
		assert.equal(mr?.resurrection?.apparatusValid, false);
		assert.equal(mr?.resurrection?.resurrectionSucceeded, false);
		assert.match(mr?.invalidReasons.join("\n") ?? "", /apparatus|execution/);
		assert.equal(analysis.overall.status, "invalid");
	});

	it("independently rejects candidate 2 when it is not candidate 1 plus one exact insertion", () => {
		const input = validStudy();
		const stock = input.arms.find((arm) => arm.block.arm === "stock");
		if (!stock) throw new Error("missing Stock fixture");
		stock.block.candidates[1].actions = ["-stock-replacement"];
		stock.block.candidates[1].candidateDigest = sha256Text(JSON.stringify(stock.block.candidates[1].actions));
		stock.block.championSelection = selectReducedCpuChampion("stock", stock.block.candidates, calibration);
		const analysis = analyzeReducedCpuStudy(input);
		const stockAnalysis = analysis.arms.find((arm) => arm.arm === "stock");
		assert.equal(stockAnalysis?.measurementValid, false);
		assert.match(stockAnalysis?.invalidReasons.join("\n") ?? "", /candidate 2 is not candidate 1 plus one exact/);
		assert.equal(analysis.overall.status, "invalid");
	});
});

import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { compareParetoCoverage, type MinimizationParetoPoint } from "./pareto-coverage.js";
import {
	assessReducedCpuResurrection,
	classifyReducedCpuCandidateTwo,
	deriveReducedCpuSinglePassInsertion,
	isReducedCpuMeasuredVerifierRejection,
	maybeBuildReducedCpuRetestDirective,
	practicalReducedCpuDelta,
	REDUCED_CPU_ALL_TASKS,
	REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM,
	REDUCED_CPU_SEARCH_TASKS,
	REDUCED_CPU_STUDY_ARMS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	REDUCED_CPU_VALIDATION_TASK,
	type ReducedCpuArmBlock,
	type ReducedCpuCalibration,
	type ReducedCpuCandidateEvidence,
	type ReducedCpuSearchTask,
	type ReducedCpuStudyArm,
	type ReducedCpuTask,
	type SealedReducedCpuRetestDirective,
	selectReducedCpuChampion,
} from "./reduced-cpu-study-protocol.js";

export const REDUCED_CPU_STUDY_ANALYSIS_PROTOCOL = "reduced-prime-compiler-gym-study-analysis-v1" as const;

export interface ReducedCpuStudyEfficiencyEvidence {
	agentProviderCalls: number;
	compactionProviderCalls: number;
	compactionTransportAttempts: number;
	providerCalls: number;
	blockedProviderCalls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	evaluatorDispatches: number;
	evaluatorTaskEvaluations: number;
	evaluatorWallMs: number;
	evaluatorCpuSeconds: number;
}

export interface ReducedCpuStudyContinuityEvidence {
	compactionCount: number;
	compactionAfterCandidateOrdinal: number | null;
	recallAttempts: number;
	successfulRecallAttempts: number;
	expectedRecalledJobIds: string[];
	recalledJobIds: string[];
	sealedContextAudit: {
		kernelStateInspected: boolean;
		toolStateInspected: boolean;
		workspaceStateInspected: boolean;
		forbiddenPriorJobIdsFound: string[];
		forbiddenPriorCandidateDigestsFound: string[];
	};
}

export interface ReducedCpuStudyArmAnalysisEvidence {
	block: ReducedCpuArmBlock;
	integrityErrors: string[];
	efficiency: ReducedCpuStudyEfficiencyEvidence;
	continuity: ReducedCpuStudyContinuityEvidence;
	sealedRetestDirective: SealedReducedCpuRetestDirective | null;
}

export interface ReducedCpuNormalizedTaskValue {
	benchmarkId: ReducedCpuTask;
	irInstructionCount: number;
	calibrationIrInstructionCount: number;
	normalizedIr: number;
	exactRatio: string;
	practicalMarginIr: number;
	practicalMarginNormalized: number;
}

export interface ReducedCpuTaskComparison extends ReducedCpuNormalizedTaskValue {
	comparatorIrInstructionCount: number;
	comparatorNormalizedIr: number;
	treatmentMinusComparatorIr: number;
	treatmentMinusComparatorNormalized: number;
	nonWorse: boolean;
	practicallyBetter: boolean;
	practicallyWorse: boolean;
}

export type ReducedCpuPairwiseStatus = "win" | "nonwin" | "inconclusive" | "invalid";

export interface ReducedCpuPairwiseAnalysis {
	treatmentArm: ReducedCpuStudyArm;
	comparatorArm: ReducedCpuStudyArm;
	status: ReducedCpuPairwiseStatus;
	reasons: string[];
	tiePreferredArm: ReducedCpuStudyArm | null;
	directChampionGate: {
		searchNonWorseOnAllTasks: boolean;
		searchPracticallyBetterOnAtLeastOneTask: boolean;
		dijkstraNonWorse: boolean;
		mechanismWinnerEligible: boolean;
		passed: boolean;
		perTask: ReducedCpuTaskComparison[];
	};
	earlierDominatingFrontierGate: {
		objectiveTasks: readonly ReducedCpuSearchTask[];
		treatmentFirstDominatingComparatorFinalProposal: number | null;
		comparatorFirstFinalFrontierProposal: number | null;
		proposalsSaved: number | null;
		proposalReductionFraction: number | null;
		exactlyOneOfFourProposalsEarlier: boolean;
		finishesSearchFrontierNoWorse: boolean;
		dijkstraNonWorse: boolean;
		mechanismWinnerEligible: boolean;
		passed: boolean;
	};
	winPath: "direct-champion" | "earlier-dominating-frontier" | null;
	efficiency: ReducedCpuPairwiseEfficiency;
}

interface ReducedCpuCountComparison {
	comparator: number;
	treatment: number;
	treatmentMinusComparator: number;
	treatmentToComparatorRatio: number | null;
	reductionFraction: number | null;
}

export interface ReducedCpuPairwiseEfficiency {
	tokens: {
		input: ReducedCpuCountComparison;
		output: ReducedCpuCountComparison;
		cacheRead: ReducedCpuCountComparison;
		cacheWrite: ReducedCpuCountComparison;
		total: ReducedCpuCountComparison;
	};
	provider: {
		agentProviderCalls: ReducedCpuCountComparison;
		compactionProviderCalls: ReducedCpuCountComparison;
		compactionTransportAttempts: ReducedCpuCountComparison;
		providerCalls: ReducedCpuCountComparison;
		blockedProviderCalls: ReducedCpuCountComparison;
	};
	evaluator: {
		dispatches: ReducedCpuCountComparison;
		taskEvaluations: ReducedCpuCountComparison;
		wallMs: ReducedCpuCountComparison;
		cpuSeconds: ReducedCpuCountComparison;
	};
}

export interface ReducedCpuResurrectionAnalysis {
	arm: "M+R";
	status: "dormant" | "executed-no-resurrection" | "eligible-genuine-resurrection" | "invalid-execution";
	dormant: boolean;
	retestExecuted: boolean;
	executionValid: boolean;
	apparatusValid: boolean;
	resurrectionSucceeded: boolean;
	eligible: boolean;
	reasons: string[];
	earlierChild: {
		baseJobId: string | null;
		childJobId: string | null;
		verifierValid: boolean;
		nonImprovingOnAllSearchTasks: boolean;
		exactOnePassInsertion: boolean;
		insertedAction: string | null;
	};
	laterReapply: {
		baseJobId: string | null;
		childJobId: string | null;
		laterBaseChanged: boolean;
		exactReapply: boolean;
		verifierValid: boolean;
		semanticVerifierPassed: boolean;
		semanticVerifierRejected: boolean;
		nonWorseOnAllSearchTasks: boolean;
		practicallyBetterOnAtLeastOneSearchTask: boolean;
		perTask: ReducedCpuTaskComparison[];
	};
}

export interface ReducedCpuArmAnalysis {
	arm: ReducedCpuStudyArm;
	measurementValid: boolean;
	treatmentClaimValid: boolean;
	valid: boolean;
	invalidReasons: string[];
	selectedJobId: string | null;
	selectedSearchTasks: ReducedCpuNormalizedTaskValue[];
	dijkstraValidation: ReducedCpuNormalizedTaskValue | null;
	efficiency: ReducedCpuStudyEfficiencyEvidence;
	continuity: ReducedCpuStudyContinuityEvidence & {
		status: "not-exercised" | "compacted-control" | "continuous" | "broken";
		missingJobIds: string[];
		unexpectedJobIds: string[];
	};
	mechanismAttribution: {
		compactionBoundaryOrdinal: number | null;
		recallUseReceiptValid: boolean;
		sealedContextAuditPassed: boolean;
		selectedChampionIsPostCompaction: boolean;
		postCompactionCandidateImprovesPreCompactionFrontier: boolean;
		equivalentQualityWithFewerDeclaredResources: false;
		winnerEligible: boolean;
		contributed: boolean;
	};
	resurrection: ReducedCpuResurrectionAnalysis | null;
}

export interface ReducedCpuStudyAnalysis {
	schemaVersion: 1;
	protocol: typeof REDUCED_CPU_STUDY_ANALYSIS_PROTOCOL;
	studyProtocol: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	taskPolicy: {
		searchTasks: typeof REDUCED_CPU_SEARCH_TASKS;
		championValidationTask: typeof REDUCED_CPU_VALIDATION_TASK;
		candidateCountPerArm: typeof REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM;
		normalization: "task-local-ir-divided-by-task-local-calibration-ir";
		practicalMargin: "max-3-ir-or-half-percent-calibration-v1";
		rawCountAggregation: "forbidden";
	};
	tiePreference: typeof REDUCED_CPU_STUDY_ARMS;
	calibration: ReducedCpuNormalizedTaskValue[];
	arms: ReducedCpuArmAnalysis[];
	comparisons: ReducedCpuPairwiseAnalysis[];
	overall: {
		status: "selected" | "inconclusive" | "invalid";
		selectedArm: ReducedCpuStudyArm | null;
		reason: string;
		mPlusRIncrementalWinAgainstM: boolean;
		mPlusRWinAgainstStock: boolean;
	};
}

interface CompleteArm {
	evidence: ReducedCpuStudyArmAnalysisEvidence;
	analysis: ReducedCpuArmAnalysis;
	selected: ReducedCpuCandidateEvidence;
	values: Map<ReducedCpuTask, number>;
}

function nonnegativeFinite(value: number, path: string): void {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${path} must be finite and nonnegative`);
}

function nonnegativeInteger(value: number, path: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${path} must be a nonnegative safe integer`);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function calibrationByTask(calibration: ReducedCpuCalibration): Map<ReducedCpuTask, number> {
	const result = new Map<ReducedCpuTask, number>();
	for (const benchmarkId of REDUCED_CPU_ALL_TASKS) {
		const matches = calibration.tasks.filter((task) => task.benchmarkId === benchmarkId);
		if (matches.length !== 1) throw new Error(`Calibration must contain exactly one ${benchmarkId} task`);
		const ir = matches[0].irInstructionCount;
		if (!Number.isSafeInteger(ir) || ir <= 0) throw new Error(`Calibration IR for ${benchmarkId} must be positive`);
		result.set(benchmarkId, ir);
	}
	return result;
}

function normalizedTask(
	benchmarkId: ReducedCpuTask,
	irInstructionCount: number,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): ReducedCpuNormalizedTaskValue {
	const calibrationIrInstructionCount = calibrations.get(benchmarkId);
	if (calibrationIrInstructionCount === undefined) throw new Error(`Missing calibration for ${benchmarkId}`);
	const practicalMarginIr = practicalReducedCpuDelta(calibrationIrInstructionCount);
	return {
		benchmarkId,
		irInstructionCount,
		calibrationIrInstructionCount,
		normalizedIr: irInstructionCount / calibrationIrInstructionCount,
		exactRatio: `${irInstructionCount}/${calibrationIrInstructionCount}`,
		practicalMarginIr,
		practicalMarginNormalized: practicalMarginIr / calibrationIrInstructionCount,
	};
}

function candidateTask(candidate: ReducedCpuCandidateEvidence, benchmarkId: ReducedCpuSearchTask): number | null {
	const matches = candidate.tasks.filter((task) => task.benchmarkId === benchmarkId);
	if (matches.length !== 1) return null;
	return matches[0].irInstructionCount;
}

function comparisonTask(
	benchmarkId: ReducedCpuTask,
	treatmentIr: number,
	comparatorIr: number,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): ReducedCpuTaskComparison {
	const normalized = normalizedTask(benchmarkId, treatmentIr, calibrations);
	const comparatorNormalizedIr = comparatorIr / normalized.calibrationIrInstructionCount;
	const treatmentMinusComparatorIr = treatmentIr - comparatorIr;
	return {
		...normalized,
		comparatorIrInstructionCount: comparatorIr,
		comparatorNormalizedIr,
		treatmentMinusComparatorIr,
		treatmentMinusComparatorNormalized: treatmentMinusComparatorIr / normalized.calibrationIrInstructionCount,
		nonWorse: treatmentIr <= comparatorIr,
		practicallyBetter: comparatorIr - treatmentIr >= normalized.practicalMarginIr,
		practicallyWorse: treatmentIr - comparatorIr >= normalized.practicalMarginIr,
	};
}

function validateEfficiency(value: ReducedCpuStudyEfficiencyEvidence, arm: ReducedCpuStudyArm): void {
	nonnegativeInteger(value.agentProviderCalls, `${arm}.efficiency.agentProviderCalls`);
	nonnegativeInteger(value.compactionProviderCalls, `${arm}.efficiency.compactionProviderCalls`);
	nonnegativeInteger(value.compactionTransportAttempts, `${arm}.efficiency.compactionTransportAttempts`);
	nonnegativeInteger(value.providerCalls, `${arm}.efficiency.providerCalls`);
	nonnegativeInteger(value.blockedProviderCalls, `${arm}.efficiency.blockedProviderCalls`);
	nonnegativeInteger(value.inputTokens, `${arm}.efficiency.inputTokens`);
	nonnegativeInteger(value.outputTokens, `${arm}.efficiency.outputTokens`);
	nonnegativeInteger(value.cacheReadTokens, `${arm}.efficiency.cacheReadTokens`);
	nonnegativeInteger(value.cacheWriteTokens, `${arm}.efficiency.cacheWriteTokens`);
	nonnegativeInteger(value.totalTokens, `${arm}.efficiency.totalTokens`);
	nonnegativeInteger(value.evaluatorDispatches, `${arm}.efficiency.evaluatorDispatches`);
	nonnegativeInteger(value.evaluatorTaskEvaluations, `${arm}.efficiency.evaluatorTaskEvaluations`);
	nonnegativeFinite(value.evaluatorWallMs, `${arm}.efficiency.evaluatorWallMs`);
	nonnegativeFinite(value.evaluatorCpuSeconds, `${arm}.efficiency.evaluatorCpuSeconds`);
}

function sealedContextAuditPassed(value: ReducedCpuStudyContinuityEvidence): boolean {
	const audit = value.sealedContextAudit;
	return (
		audit.kernelStateInspected &&
		audit.toolStateInspected &&
		audit.workspaceStateInspected &&
		audit.forbiddenPriorJobIdsFound.length === 0 &&
		audit.forbiddenPriorCandidateDigestsFound.length === 0
	);
}

function recallUseReceiptValid(_value: ReducedCpuStudyContinuityEvidence, block: ReducedCpuArmBlock): boolean {
	if (block.arm === "stock") return block.recallReceipt === null;
	const receipt = block.recallReceipt;
	if (!receipt) return false;
	const sha256 = /^[0-9a-f]{64}$/;
	const ordered = [...block.candidates].sort((left, right) => left.ordinal - right.ordinal);
	const prior = ordered.slice(0, 2);
	const candidate3 = ordered[2];
	return (
		receipt.schemaVersion === 1 &&
		receipt.protocolVersion === REDUCED_CPU_STUDY_PROTOCOL_VERSION &&
		receipt.type === "reduced_cpu_measured_recall_receipt" &&
		receipt.arm === block.arm &&
		receipt.branchId === block.branchId &&
		receipt.verified &&
		candidate3 !== undefined &&
		sameStrings(
			receipt.recalledJobIds,
			prior.map((candidate) => candidate.jobId),
		) &&
		receipt.candidate3JobId === candidate3.jobId &&
		Number.isSafeInteger(receipt.compactionEventSequence) &&
		receipt.compactionEventSequence >= 0 &&
		Number.isSafeInteger(receipt.recallEventSequence) &&
		receipt.recallEventSequence >= 0 &&
		Number.isSafeInteger(receipt.candidate3ProviderRequestSequence) &&
		receipt.candidate3ProviderRequestSequence >= 0 &&
		receipt.compactionEventSequence < receipt.recallEventSequence &&
		receipt.recallEventSequence < receipt.candidate3ProviderRequestSequence &&
		sha256.test(receipt.recallResultSha256) &&
		receipt.providerIncludedRecallSha256 === receipt.recallResultSha256
	);
}

function analyzeContinuity(
	value: ReducedCpuStudyContinuityEvidence,
	block: ReducedCpuArmBlock,
): ReducedCpuArmAnalysis["continuity"] {
	nonnegativeInteger(value.compactionCount, "continuity.compactionCount");
	if (
		value.compactionAfterCandidateOrdinal !== null &&
		(!Number.isSafeInteger(value.compactionAfterCandidateOrdinal) ||
			value.compactionAfterCandidateOrdinal < 1 ||
			value.compactionAfterCandidateOrdinal >= REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM)
	) {
		throw new Error("continuity.compactionAfterCandidateOrdinal must be null or a search-candidate boundary");
	}
	nonnegativeInteger(value.recallAttempts, "continuity.recallAttempts");
	nonnegativeInteger(value.successfulRecallAttempts, "continuity.successfulRecallAttempts");
	if (value.successfulRecallAttempts > value.recallAttempts) {
		throw new Error("continuity.successfulRecallAttempts exceeds recallAttempts");
	}
	const orderedCandidates = [...block.candidates].sort((left, right) => left.ordinal - right.ordinal);
	const expected =
		block.arm === "stock"
			? []
			: orderedCandidates
					.slice(0, 2)
					.map((candidate) => candidate.jobId)
					.sort();
	const declaredExpected = [...new Set(value.expectedRecalledJobIds)].sort();
	const recalled = [...new Set(value.recalledJobIds)].sort();
	const missingJobIds = expected.filter((jobId) => !recalled.includes(jobId));
	const unexpectedJobIds = recalled.filter((jobId) => !expected.includes(jobId));
	const contextAuditPassed = sealedContextAuditPassed(value);
	const useReceiptValid = recallUseReceiptValid(value, block);
	let status: ReducedCpuArmAnalysis["continuity"]["status"];
	if (value.compactionCount === 0) status = "not-exercised";
	else if (
		block.arm === "stock" &&
		value.compactionCount === 1 &&
		value.compactionAfterCandidateOrdinal === 2 &&
		value.recallAttempts === 0 &&
		value.successfulRecallAttempts === 0 &&
		declaredExpected.length === 0 &&
		recalled.length === 0 &&
		useReceiptValid &&
		contextAuditPassed
	) {
		status = "compacted-control";
	} else if (
		block.arm !== "stock" &&
		value.compactionCount === 1 &&
		value.compactionAfterCandidateOrdinal === 2 &&
		value.recallAttempts === 1 &&
		value.successfulRecallAttempts === 1 &&
		sameStrings(declaredExpected, expected) &&
		missingJobIds.length === 0 &&
		unexpectedJobIds.length === 0 &&
		useReceiptValid &&
		contextAuditPassed
	) {
		status = "continuous";
	} else status = "broken";
	return {
		...value,
		expectedRecalledJobIds: expected,
		recalledJobIds: recalled,
		status,
		missingJobIds,
		unexpectedJobIds,
	};
}

function structuralInvalidReasons(
	evidence: ReducedCpuStudyArmAnalysisEvidence,
	calibration: ReducedCpuCalibration,
): string[] {
	const { block } = evidence;
	const reasons = [...evidence.integrityErrors];
	if (block.candidates.length !== REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM) {
		reasons.push("arm does not contain exactly four search candidates");
	}
	const ordered = [...block.candidates].sort((left, right) => left.ordinal - right.ordinal);
	if (
		!sameStrings(
			ordered.map((candidate) => String(candidate.ordinal)),
			["1", "2", "3", "4"],
		)
	) {
		reasons.push("candidate ordinals are not exactly 1,2,3,4");
	}
	const jobIds = new Set<string>();
	for (const [index, candidate] of ordered.entries()) {
		if (candidate.arm !== block.arm || candidate.branchId !== block.branchId)
			reasons.push("candidate scope mismatch");
		if (jobIds.has(candidate.jobId)) reasons.push(`duplicate candidate job ID ${candidate.jobId}`);
		jobIds.add(candidate.jobId);
		if (candidate.candidateDigest !== sha256Text(JSON.stringify(candidate.actions))) {
			reasons.push(`candidate ${candidate.ordinal} digest does not match its actions`);
		}
		const expectedParents = index === 0 ? [] : [ordered[index - 1]?.jobId ?? ""];
		if (!sameStrings(candidate.parentJobIds, expectedParents)) {
			reasons.push(`candidate ${candidate.ordinal} does not follow the exact prior-candidate parent chain`);
		}
		const measuredVerifierFailure = isReducedCpuMeasuredVerifierRejection(candidate);
		if (!candidate.verifierValid && !measuredVerifierFailure) {
			reasons.push(`candidate ${candidate.ordinal} has apparatus or integrity-invalid evidence`);
		}
		if (candidate.tasks.length !== REDUCED_CPU_SEARCH_TASKS.length) {
			reasons.push(`candidate ${candidate.ordinal} does not contain exactly three search tasks`);
		}
		for (const benchmarkId of REDUCED_CPU_SEARCH_TASKS) {
			const matches = candidate.tasks.filter((task) => task.benchmarkId === benchmarkId);
			if (matches.length !== 1) {
				reasons.push(`candidate ${candidate.ordinal} does not contain exactly one ${benchmarkId} task`);
				continue;
			}
			const task = matches[0];
			if (
				candidate.verifierValid &&
				(task.irInstructionCount === null ||
					!Number.isSafeInteger(task.irInstructionCount) ||
					task.irInstructionCount < 0 ||
					task.status !== "accepted" ||
					!task.verifierPassed)
			) {
				reasons.push(`candidate ${candidate.ordinal} ${benchmarkId} task is not accepted verifier-valid IR`);
			}
		}
	}
	if (ordered.length >= 2 && deriveReducedCpuSinglePassInsertion(ordered[0].actions, ordered[1].actions) === null) {
		reasons.push("candidate 2 is not candidate 1 plus one exact unambiguous pass insertion");
	}
	const recomputedChampion = selectReducedCpuChampion(block.arm, ordered, calibration);
	if (sha256Json(recomputedChampion) !== sha256Json(block.championSelection)) {
		reasons.push("champion selection does not match the canonical normalized ranking");
	}
	const selectedJobId = block.championSelection.selectedJobId;
	const selected = block.candidates.find((candidate) => candidate.jobId === selectedJobId);
	if (!selected) reasons.push("selected search champion is absent");
	if (!block.validation) reasons.push("dijkstra champion validation is absent");
	else {
		if (block.validation.arm !== block.arm || block.validation.branchId !== block.branchId) {
			reasons.push("dijkstra validation scope does not match the arm");
		}
		if (!block.validation.verifierValid) reasons.push("dijkstra champion validation is not verifier-valid");
		if (block.validation.searchChampionJobId !== selectedJobId)
			reasons.push("dijkstra validation is not for the champion");
		if (selected && block.validation.candidateDigest !== selected.candidateDigest) {
			reasons.push("dijkstra validation candidate digest does not match the champion");
		}
		if (selected && !sameStrings(block.validation.parentJobIds, [selected.jobId])) {
			reasons.push("dijkstra validation parent binding does not match the champion");
		}
		if (block.validation.task.benchmarkId !== REDUCED_CPU_VALIDATION_TASK)
			reasons.push("validation task is not dijkstra");
		if (
			block.validation.task.irInstructionCount === null ||
			!Number.isSafeInteger(block.validation.task.irInstructionCount) ||
			block.validation.task.irInstructionCount < 0 ||
			block.validation.task.status !== "accepted" ||
			!block.validation.task.verifierPassed
		) {
			reasons.push("dijkstra validation is not accepted verifier-valid IR");
		}
	}
	return [...new Set(reasons)].sort();
}

function completeArm(
	evidence: ReducedCpuStudyArmAnalysisEvidence,
	analysis: ReducedCpuArmAnalysis,
): CompleteArm | null {
	if (!analysis.valid) return null;
	const selectedJobId = evidence.block.championSelection.selectedJobId;
	const selected = evidence.block.candidates.find((candidate) => candidate.jobId === selectedJobId);
	const validationIr = evidence.block.validation?.task.irInstructionCount;
	if (!selected || validationIr === null || validationIr === undefined) return null;
	const values = new Map<ReducedCpuTask, number>();
	for (const benchmarkId of REDUCED_CPU_SEARCH_TASKS) {
		const ir = candidateTask(selected, benchmarkId);
		if (ir === null) return null;
		values.set(benchmarkId, ir);
	}
	values.set(REDUCED_CPU_VALIDATION_TASK, validationIr);
	return { evidence, analysis, selected, values };
}

function candidatePoint(candidate: ReducedCpuCandidateEvidence): MinimizationParetoPoint | null {
	if (!candidate.verifierValid) return null;
	const vector = REDUCED_CPU_SEARCH_TASKS.map((benchmarkId) => candidateTask(candidate, benchmarkId));
	if (vector.some((value) => value === null)) return null;
	return { id: candidate.jobId, vector: vector.filter((value): value is number => value !== null) };
}

function prefixPoints(arm: CompleteArm, count: number): MinimizationParetoPoint[] {
	return [...arm.evidence.block.candidates]
		.sort((left, right) => left.ordinal - right.ordinal)
		.slice(0, count)
		.map(candidatePoint)
		.filter((point): point is MinimizationParetoPoint => point !== null);
}

function firstFinalFrontierProposal(arm: CompleteArm): number | null {
	const final = prefixPoints(arm, REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM);
	for (let count = 1; count <= REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM; count++) {
		if (compareParetoCoverage(prefixPoints(arm, count), final).classification === "equivalent") return count;
	}
	return null;
}

function practicallyCovers(
	source: readonly MinimizationParetoPoint[],
	target: readonly MinimizationParetoPoint[],
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): boolean {
	const sourceFrontier = compareParetoCoverage(source, source).leftFrontier;
	const targetFrontier = compareParetoCoverage(target, target).leftFrontier;
	return (
		targetFrontier.length > 0 &&
		targetFrontier.every((targetGroup) =>
			sourceFrontier.some((sourceGroup) => {
				const comparisons = REDUCED_CPU_SEARCH_TASKS.map((benchmarkId, index) =>
					comparisonTask(benchmarkId, sourceGroup.vector[index], targetGroup.vector[index], calibrations),
				);
				return (
					comparisons.every((comparison) => comparison.nonWorse) &&
					comparisons.some((comparison) => comparison.practicallyBetter)
				);
			}),
		)
	);
}

function mechanismAttribution(
	evidence: ReducedCpuStudyArmAnalysisEvidence,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): ReducedCpuArmAnalysis["mechanismAttribution"] {
	const boundary = evidence.continuity.compactionAfterCandidateOrdinal;
	const selectedJobId = evidence.block.championSelection.selectedJobId;
	const selected = evidence.block.candidates.find((candidate) => candidate.jobId === selectedJobId);
	const selectedChampionIsPostCompaction = boundary !== null && selected !== undefined && selected.ordinal > boundary;
	const useReceiptValid = recallUseReceiptValid(evidence.continuity, evidence.block);
	const contextAuditPassed = sealedContextAuditPassed(evidence.continuity);
	let postCompactionCandidateImprovesPreCompactionFrontier = false;
	if (boundary !== null) {
		const ordered = [...evidence.block.candidates].sort((left, right) => left.ordinal - right.ordinal);
		const prePoints = ordered
			.filter((candidate) => candidate.ordinal <= boundary)
			.map(candidatePoint)
			.filter((point): point is MinimizationParetoPoint => point !== null);
		const postPoints = ordered
			.filter((candidate) => candidate.ordinal > boundary)
			.map(candidatePoint)
			.filter((point): point is MinimizationParetoPoint => point !== null);
		const preFrontier = compareParetoCoverage(prePoints, prePoints).leftFrontier;
		postCompactionCandidateImprovesPreCompactionFrontier = postPoints.some((post) =>
			preFrontier.some((pre) => {
				const tasks = REDUCED_CPU_SEARCH_TASKS.map((benchmarkId, index) =>
					comparisonTask(benchmarkId, post.vector[index], pre.vector[index], calibrations),
				);
				return tasks.every((task) => task.nonWorse) && tasks.some((task) => task.practicallyBetter);
			}),
		);
	}
	return {
		compactionBoundaryOrdinal: boundary,
		recallUseReceiptValid: useReceiptValid,
		sealedContextAuditPassed: contextAuditPassed,
		selectedChampionIsPostCompaction,
		postCompactionCandidateImprovesPreCompactionFrontier,
		equivalentQualityWithFewerDeclaredResources: false,
		winnerEligible: selectedChampionIsPostCompaction && postCompactionCandidateImprovesPreCompactionFrontier,
		contributed: evidence.block.arm !== "stock" && useReceiptValid && contextAuditPassed,
	};
}

function firstDominatingComparatorFinalProposal(
	treatment: CompleteArm,
	comparator: CompleteArm,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): number | null {
	const comparatorFinal = prefixPoints(comparator, REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM);
	for (let count = 1; count <= REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM; count++) {
		if (practicallyCovers(prefixPoints(treatment, count), comparatorFinal, calibrations)) return count;
	}
	return null;
}

function countComparison(comparator: number, treatment: number): ReducedCpuCountComparison {
	return {
		comparator,
		treatment,
		treatmentMinusComparator: treatment - comparator,
		treatmentToComparatorRatio: comparator === 0 ? (treatment === 0 ? 1 : null) : treatment / comparator,
		reductionFraction: comparator === 0 ? (treatment === 0 ? 0 : null) : (comparator - treatment) / comparator,
	};
}

function efficiencyComparison(treatment: CompleteArm, comparator: CompleteArm): ReducedCpuPairwiseEfficiency {
	const left = comparator.evidence.efficiency;
	const right = treatment.evidence.efficiency;
	return {
		tokens: {
			input: countComparison(left.inputTokens, right.inputTokens),
			output: countComparison(left.outputTokens, right.outputTokens),
			cacheRead: countComparison(left.cacheReadTokens, right.cacheReadTokens),
			cacheWrite: countComparison(left.cacheWriteTokens, right.cacheWriteTokens),
			total: countComparison(left.totalTokens, right.totalTokens),
		},
		provider: {
			agentProviderCalls: countComparison(left.agentProviderCalls, right.agentProviderCalls),
			compactionProviderCalls: countComparison(left.compactionProviderCalls, right.compactionProviderCalls),
			compactionTransportAttempts: countComparison(
				left.compactionTransportAttempts,
				right.compactionTransportAttempts,
			),
			providerCalls: countComparison(left.providerCalls, right.providerCalls),
			blockedProviderCalls: countComparison(left.blockedProviderCalls, right.blockedProviderCalls),
		},
		evaluator: {
			dispatches: countComparison(left.evaluatorDispatches, right.evaluatorDispatches),
			taskEvaluations: countComparison(left.evaluatorTaskEvaluations, right.evaluatorTaskEvaluations),
			wallMs: countComparison(left.evaluatorWallMs, right.evaluatorWallMs),
			cpuSeconds: countComparison(left.evaluatorCpuSeconds, right.evaluatorCpuSeconds),
		},
	};
}

function directionalGate(
	treatment: CompleteArm,
	comparator: CompleteArm,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): Omit<ReducedCpuPairwiseAnalysis, "status" | "reasons" | "tiePreferredArm" | "efficiency"> {
	const perTask = REDUCED_CPU_ALL_TASKS.map((benchmarkId) => {
		const treatmentIr = treatment.values.get(benchmarkId);
		const comparatorIr = comparator.values.get(benchmarkId);
		if (treatmentIr === undefined || comparatorIr === undefined) throw new Error(`Missing ${benchmarkId} comparison`);
		return comparisonTask(benchmarkId, treatmentIr, comparatorIr, calibrations);
	});
	const search = perTask.filter((task) => task.benchmarkId !== REDUCED_CPU_VALIDATION_TASK);
	const dijkstra = perTask.find((task) => task.benchmarkId === REDUCED_CPU_VALIDATION_TASK);
	if (!dijkstra) throw new Error("Missing dijkstra comparison");
	const mechanismWinnerEligible =
		(treatment.analysis.arm === "stock" || treatment.analysis.mechanismAttribution.winnerEligible) &&
		(treatment.analysis.arm !== "M+R" || treatment.analysis.resurrection?.resurrectionSucceeded === true);
	const directChampionGate = {
		searchNonWorseOnAllTasks: search.every((task) => task.nonWorse),
		searchPracticallyBetterOnAtLeastOneTask: search.some((task) => task.practicallyBetter),
		dijkstraNonWorse: dijkstra.nonWorse,
		mechanismWinnerEligible,
		passed:
			search.every((task) => task.nonWorse) &&
			search.some((task) => task.practicallyBetter) &&
			dijkstra.nonWorse &&
			mechanismWinnerEligible,
		perTask,
	};
	const treatmentFirst = firstDominatingComparatorFinalProposal(treatment, comparator, calibrations);
	const comparatorFirst = firstFinalFrontierProposal(comparator);
	const proposalsSaved = treatmentFirst === null || comparatorFirst === null ? null : comparatorFirst - treatmentFirst;
	const proposalReductionFraction =
		treatmentFirst === null || comparatorFirst === null ? null : (comparatorFirst - treatmentFirst) / comparatorFirst;
	const exactlyOneOfFourProposalsEarlier = treatmentFirst === 3 && comparatorFirst === 4;
	const finishesSearchFrontierNoWorse = compareParetoCoverage(
		prefixPoints(treatment, REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM),
		prefixPoints(comparator, REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM),
	).leftCoversRight.complete;
	const earlierDominatingFrontierGate = {
		objectiveTasks: REDUCED_CPU_SEARCH_TASKS,
		treatmentFirstDominatingComparatorFinalProposal: treatmentFirst,
		comparatorFirstFinalFrontierProposal: comparatorFirst,
		proposalsSaved,
		proposalReductionFraction,
		exactlyOneOfFourProposalsEarlier,
		finishesSearchFrontierNoWorse,
		dijkstraNonWorse: dijkstra.nonWorse,
		mechanismWinnerEligible,
		passed:
			exactlyOneOfFourProposalsEarlier &&
			finishesSearchFrontierNoWorse &&
			dijkstra.nonWorse &&
			mechanismWinnerEligible,
	};
	return {
		treatmentArm: treatment.analysis.arm,
		comparatorArm: comparator.analysis.arm,
		directChampionGate,
		earlierDominatingFrontierGate,
		winPath: directChampionGate.passed
			? "direct-champion"
			: earlierDominatingFrontierGate.passed
				? "earlier-dominating-frontier"
				: null,
	};
}

function invalidComparison(
	treatment: ReducedCpuArmAnalysis,
	comparator: ReducedCpuArmAnalysis,
): ReducedCpuPairwiseAnalysis {
	const reasons = [
		...treatment.invalidReasons.map((reason) => `${treatment.arm}: ${reason}`),
		...comparator.invalidReasons.map((reason) => `${comparator.arm}: ${reason}`),
	];
	return {
		treatmentArm: treatment.arm,
		comparatorArm: comparator.arm,
		status: "invalid",
		reasons,
		tiePreferredArm: null,
		directChampionGate: {
			searchNonWorseOnAllTasks: false,
			searchPracticallyBetterOnAtLeastOneTask: false,
			dijkstraNonWorse: false,
			mechanismWinnerEligible: false,
			passed: false,
			perTask: [],
		},
		earlierDominatingFrontierGate: {
			objectiveTasks: REDUCED_CPU_SEARCH_TASKS,
			treatmentFirstDominatingComparatorFinalProposal: null,
			comparatorFirstFinalFrontierProposal: null,
			proposalsSaved: null,
			proposalReductionFraction: null,
			exactlyOneOfFourProposalsEarlier: false,
			finishesSearchFrontierNoWorse: false,
			dijkstraNonWorse: false,
			mechanismWinnerEligible: false,
			passed: false,
		},
		winPath: null,
		efficiency: {
			tokens: {
				input: countComparison(0, 0),
				output: countComparison(0, 0),
				cacheRead: countComparison(0, 0),
				cacheWrite: countComparison(0, 0),
				total: countComparison(0, 0),
			},
			provider: {
				agentProviderCalls: countComparison(0, 0),
				compactionProviderCalls: countComparison(0, 0),
				compactionTransportAttempts: countComparison(0, 0),
				providerCalls: countComparison(0, 0),
				blockedProviderCalls: countComparison(0, 0),
			},
			evaluator: {
				dispatches: countComparison(0, 0),
				taskEvaluations: countComparison(0, 0),
				wallMs: countComparison(0, 0),
				cpuSeconds: countComparison(0, 0),
			},
		},
	};
}

function compareArms(
	treatmentAnalysis: ReducedCpuArmAnalysis,
	comparatorAnalysis: ReducedCpuArmAnalysis,
	treatment: CompleteArm | null,
	comparator: CompleteArm | null,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): ReducedCpuPairwiseAnalysis {
	if (!treatment || !comparator) return invalidComparison(treatmentAnalysis, comparatorAnalysis);
	const forward = directionalGate(treatment, comparator, calibrations);
	const reverse = directionalGate(comparator, treatment, calibrations);
	const practicalTie = forward.directChampionGate.perTask.every(
		(task) => Math.abs(task.treatmentMinusComparatorIr) < task.practicalMarginIr,
	);
	let status: ReducedCpuPairwiseStatus;
	let reasons: string[];
	let tiePreferredArm: ReducedCpuStudyArm | null = null;
	if (forward.winPath) {
		status = "win";
		reasons = [`${treatment.analysis.arm} passed the ${forward.winPath} win path`];
	} else if (reverse.winPath) {
		status = "nonwin";
		reasons = [`${comparator.analysis.arm} passed the reverse ${reverse.winPath} win path`];
	} else if (practicalTie) {
		status = "nonwin";
		tiePreferredArm = comparator.analysis.arm;
		reasons = [`practical tie resolved by ${REDUCED_CPU_STUDY_ARMS.join(" > ")} preference`];
	} else {
		status = "inconclusive";
		reasons = ["neither arm passed a directional win path"];
	}
	return {
		...forward,
		status,
		reasons,
		tiePreferredArm,
		efficiency: efficiencyComparison(treatment, comparator),
	};
}

function analyzeResurrection(
	evidence: ReducedCpuStudyArmAnalysisEvidence,
	calibration: ReducedCpuCalibration,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): ReducedCpuResurrectionAnalysis {
	const candidates = [...evidence.block.candidates].sort((left, right) => left.ordinal - right.ordinal);
	const [candidate1, candidate2, candidate3, candidate4] = candidates;
	const reasons: string[] = [];
	if (!candidate1 || !candidate2 || !candidate3 || !candidate4) reasons.push("all four candidates are required");
	const classification = candidate1 && candidate2 ? classifyReducedCpuCandidateTwo(candidate1, candidate2) : null;
	let expectedDirective: ReturnType<typeof maybeBuildReducedCpuRetestDirective> = null;
	let expectationFailed = false;
	if (classification && candidate3) {
		try {
			expectedDirective = maybeBuildReducedCpuRetestDirective(classification, candidate3);
		} catch (error) {
			expectationFailed = true;
			reasons.push(`retest eligibility contract failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	let recomputedAssessment: ReturnType<typeof assessReducedCpuResurrection> | null = null;
	if (classification && candidate3 && candidate4 && evidence.sealedRetestDirective) {
		recomputedAssessment = assessReducedCpuResurrection({
			classification,
			candidate3,
			candidate4,
			sealedDirective: evidence.sealedRetestDirective,
			calibration,
		});
	}
	const retestExecuted = evidence.sealedRetestDirective !== null || evidence.block.resurrection !== null;
	const dormant =
		!expectationFailed &&
		expectedDirective === null &&
		evidence.sealedRetestDirective === null &&
		evidence.block.resurrection === null;
	const expectedDirectiveMatches = Boolean(
		expectedDirective &&
			evidence.sealedRetestDirective &&
			sha256Json(expectedDirective) === sha256Json(evidence.sealedRetestDirective.directive),
	);
	const recordedAssessmentMatches = Boolean(
		recomputedAssessment &&
			evidence.block.resurrection &&
			sha256Json(recomputedAssessment) === sha256Json(evidence.block.resurrection),
	);
	const exactReapply = Boolean(
		expectedDirectiveMatches && recomputedAssessment?.exactDirectiveReapplication && recordedAssessmentMatches,
	);
	const laterBaseChanged = Boolean(candidate1 && candidate3 && !sameStrings(candidate1.actions, candidate3.actions));
	const perTask =
		candidate3 && candidate4
			? REDUCED_CPU_SEARCH_TASKS.flatMap((benchmarkId) => {
					const baseIr = candidateTask(candidate3, benchmarkId);
					const childIr = candidateTask(candidate4, benchmarkId);
					return baseIr === null || childIr === null
						? []
						: [comparisonTask(benchmarkId, childIr, baseIr, calibrations)];
				})
			: [];
	const verifierValid = Boolean(candidate3?.verifierValid && candidate4?.verifierValid);
	const semanticVerifierPassed = candidate4?.verifierValid ?? false;
	const semanticVerifierRejected = candidate4 ? isReducedCpuMeasuredVerifierRejection(candidate4) : false;
	const nonWorseOnAllSearchTasks =
		perTask.length === REDUCED_CPU_SEARCH_TASKS.length && perTask.every((task) => task.nonWorse);
	const practicallyBetterOnAtLeastOneSearchTask = perTask.some((task) => task.practicallyBetter);
	if (dormant) {
		if (!classification?.verifierValid) reasons.push("R dormant because candidate 1 or 2 is not verifier-valid");
		else if (!classification.nonImprovingOnAllTasks)
			reasons.push("R dormant because candidate 2 improved a search task");
		else if (!candidate3?.verifierValid) reasons.push("R dormant because candidate 3 is not verifier-valid");
		else if (!laterBaseChanged) reasons.push("R dormant because candidate 3 did not change the candidate-1 base");
		else reasons.push("R dormant because the sealed insertion cannot be applied to candidate 3");
	} else {
		if (expectedDirective === null && !expectationFailed) {
			reasons.push("retest evidence is present although R is dormant");
		}
		if (expectedDirective !== null && !evidence.sealedRetestDirective) {
			reasons.push("eligible sealed retest directive is absent");
		}
		if (expectedDirective !== null && evidence.sealedRetestDirective && !expectedDirectiveMatches) {
			reasons.push("sealed retest directive differs from the canonical eligible directive");
		}
		if (!recomputedAssessment) reasons.push("resurrection assessment could not be recomputed");
		if (!evidence.block.resurrection) reasons.push("recorded resurrection assessment is absent");
		if (recomputedAssessment && evidence.block.resurrection && !recordedAssessmentMatches) {
			reasons.push("recorded resurrection assessment differs from the recomputed assessment");
		}
		if (recomputedAssessment && !recomputedAssessment.executionValid) {
			reasons.push("host retest execution is not exact fresh verifier-valid evidence");
		}
	}
	const executionValid = Boolean(
		!dormant && expectedDirectiveMatches && recordedAssessmentMatches && recomputedAssessment?.executionValid,
	);
	const apparatusValid = dormant || executionValid;
	const resurrectionSucceeded = Boolean(executionValid && recomputedAssessment?.resurrectionSucceeded);
	if (executionValid && semanticVerifierRejected)
		reasons.push("reapplied candidate is semantically verifier-rejected");
	if (executionValid && !nonWorseOnAllSearchTasks) reasons.push("reapply is worse on at least one search task");
	if (executionValid && !practicallyBetterOnAtLeastOneSearchTask) {
		reasons.push("reapply has no practical search-task improvement");
	}
	const status: ReducedCpuResurrectionAnalysis["status"] = dormant
		? "dormant"
		: !executionValid
			? "invalid-execution"
			: resurrectionSucceeded
				? "eligible-genuine-resurrection"
				: "executed-no-resurrection";
	return {
		arm: "M+R",
		status,
		dormant,
		retestExecuted,
		executionValid,
		apparatusValid,
		resurrectionSucceeded,
		eligible: resurrectionSucceeded,
		reasons: [...new Set(reasons)],
		earlierChild: {
			baseJobId: candidate1?.jobId ?? null,
			childJobId: candidate2?.jobId ?? null,
			verifierValid: classification?.verifierValid ?? false,
			nonImprovingOnAllSearchTasks: classification?.nonImprovingOnAllTasks ?? false,
			exactOnePassInsertion: classification?.exactSinglePassInsertion ?? false,
			insertedAction: classification?.insertedAction ?? null,
		},
		laterReapply: {
			baseJobId: candidate3?.jobId ?? null,
			childJobId: candidate4?.jobId ?? null,
			laterBaseChanged,
			exactReapply,
			verifierValid,
			semanticVerifierPassed,
			semanticVerifierRejected,
			nonWorseOnAllSearchTasks,
			practicallyBetterOnAtLeastOneSearchTask,
			perTask,
		},
	};
}

function analyzeArm(
	evidence: ReducedCpuStudyArmAnalysisEvidence,
	calibration: ReducedCpuCalibration,
	calibrations: ReadonlyMap<ReducedCpuTask, number>,
): ReducedCpuArmAnalysis {
	validateEfficiency(evidence.efficiency, evidence.block.arm);
	const measurementInvalidReasons = structuralInvalidReasons(evidence, calibration);
	if (evidence.block.arm !== "M+R" && evidence.sealedRetestDirective !== null) {
		measurementInvalidReasons.push("sealed retest directive is forbidden outside M+R");
	}
	const selectedJobId = evidence.block.championSelection.selectedJobId;
	const selected = evidence.block.candidates.find((candidate) => candidate.jobId === selectedJobId);
	const selectedSearchTasks = selected
		? REDUCED_CPU_SEARCH_TASKS.flatMap((benchmarkId) => {
				const ir = candidateTask(selected, benchmarkId);
				return ir === null ? [] : [normalizedTask(benchmarkId, ir, calibrations)];
			})
		: [];
	const validationIr = evidence.block.validation?.task.irInstructionCount;
	const continuity = analyzeContinuity(evidence.continuity, evidence.block);
	const mechanism = mechanismAttribution(evidence, calibrations);
	const resurrection = evidence.block.arm === "M+R" ? analyzeResurrection(evidence, calibration, calibrations) : null;
	const treatmentInvalidReasons = [...measurementInvalidReasons];
	const expectedAgentProviderCalls =
		evidence.block.arm === "stock" ? 4 : evidence.block.arm === "M" ? 5 : evidence.sealedRetestDirective ? 4 : 5;
	const expectedProviderCalls = expectedAgentProviderCalls + 1;
	if (evidence.efficiency.agentProviderCalls !== expectedAgentProviderCalls) {
		treatmentInvalidReasons.push(
			`${evidence.block.arm} agent provider call graph expected ${expectedAgentProviderCalls}, got ${evidence.efficiency.agentProviderCalls}`,
		);
	}
	if (evidence.efficiency.compactionProviderCalls !== 1) {
		treatmentInvalidReasons.push(`${evidence.block.arm} must have exactly one paid native compaction provider call`);
	}
	if (evidence.efficiency.compactionTransportAttempts !== 1) {
		treatmentInvalidReasons.push(`${evidence.block.arm} must have exactly one native compaction transport attempt`);
	}
	if (
		evidence.efficiency.providerCalls !==
		evidence.efficiency.agentProviderCalls + evidence.efficiency.compactionProviderCalls
	) {
		treatmentInvalidReasons.push("total provider calls do not equal agent plus compaction provider calls");
	}
	if (evidence.efficiency.providerCalls !== expectedProviderCalls) {
		treatmentInvalidReasons.push(
			`${evidence.block.arm} provider call graph expected ${expectedProviderCalls}, got ${evidence.efficiency.providerCalls}`,
		);
	}
	if (evidence.efficiency.blockedProviderCalls !== 2) {
		treatmentInvalidReasons.push("arm must have exactly two intentional blocked provider continuations");
	}
	if (
		evidence.efficiency.totalTokens !==
		evidence.efficiency.inputTokens +
			evidence.efficiency.outputTokens +
			evidence.efficiency.cacheReadTokens +
			evidence.efficiency.cacheWriteTokens
	) {
		treatmentInvalidReasons.push("total token count does not equal the component token counts");
	}
	if (evidence.efficiency.evaluatorDispatches !== 5 || evidence.efficiency.evaluatorTaskEvaluations !== 13) {
		treatmentInvalidReasons.push("arm must contain exactly five evaluator dispatches and thirteen task evaluations");
	}
	if (evidence.block.arm === "stock") {
		if (continuity.status !== "compacted-control") {
			treatmentInvalidReasons.push("Stock did not preserve the fixed compacted-control schedule");
		}
	} else {
		if (continuity.status !== "continuous") {
			treatmentInvalidReasons.push(`${evidence.block.arm} compaction/recall continuity did not pass`);
		}
		if (!mechanism.contributed) {
			treatmentInvalidReasons.push(
				`${evidence.block.arm} lacks receipt-bound recall use in the accepted post-compaction proposal`,
			);
		}
	}
	if (evidence.block.arm === "M+R" && !resurrection?.apparatusValid) {
		treatmentInvalidReasons.push("M+R retest execution is apparatus-invalid");
	}
	const invalidReasons = [...new Set(treatmentInvalidReasons)].sort();
	const measurementValid = measurementInvalidReasons.length === 0;
	const treatmentClaimValid = invalidReasons.length === 0;
	return {
		arm: evidence.block.arm,
		measurementValid,
		treatmentClaimValid,
		valid: treatmentClaimValid,
		invalidReasons,
		selectedJobId,
		selectedSearchTasks,
		dijkstraValidation:
			validationIr === null || validationIr === undefined
				? null
				: normalizedTask(REDUCED_CPU_VALIDATION_TASK, validationIr, calibrations),
		efficiency: { ...evidence.efficiency },
		continuity,
		mechanismAttribution: mechanism,
		resurrection,
	};
}

export function analyzeReducedCpuStudy(input: {
	calibration: ReducedCpuCalibration;
	arms: readonly ReducedCpuStudyArmAnalysisEvidence[];
}): ReducedCpuStudyAnalysis {
	const calibrations = calibrationByTask(input.calibration);
	const evidenceByArm = new Map<ReducedCpuStudyArm, ReducedCpuStudyArmAnalysisEvidence>();
	for (const evidence of input.arms) {
		if (evidenceByArm.has(evidence.block.arm)) throw new Error(`Duplicate ${evidence.block.arm} arm evidence`);
		evidenceByArm.set(evidence.block.arm, evidence);
	}
	for (const arm of REDUCED_CPU_STUDY_ARMS) {
		if (!evidenceByArm.has(arm)) throw new Error(`Missing ${arm} arm evidence`);
	}
	const arms = REDUCED_CPU_STUDY_ARMS.map((arm) =>
		analyzeArm(evidenceByArm.get(arm)!, input.calibration, calibrations),
	);
	const completeByArm = new Map<ReducedCpuStudyArm, CompleteArm | null>(
		arms.map((analysis) => {
			const evidence = evidenceByArm.get(analysis.arm);
			if (!evidence) throw new Error(`Missing ${analysis.arm} evidence`);
			return [analysis.arm, completeArm(evidence, analysis)];
		}),
	);
	const comparisonSpecs = [
		["M", "stock"],
		["M+R", "M"],
		["M+R", "stock"],
	] as const;
	const comparisons = comparisonSpecs.map(([treatmentArm, comparatorArm]) => {
		const treatmentAnalysis = arms.find((arm) => arm.arm === treatmentArm);
		const comparatorAnalysis = arms.find((arm) => arm.arm === comparatorArm);
		if (!treatmentAnalysis || !comparatorAnalysis) throw new Error("Missing pairwise arm analysis");
		return compareArms(
			treatmentAnalysis,
			comparatorAnalysis,
			completeByArm.get(treatmentArm) ?? null,
			completeByArm.get(comparatorArm) ?? null,
			calibrations,
		);
	});
	const comparison = (treatmentArm: ReducedCpuStudyArm, comparatorArm: ReducedCpuStudyArm) =>
		comparisons.find((item) => item.treatmentArm === treatmentArm && item.comparatorArm === comparatorArm);
	const mVsStock = comparison("M", "stock");
	const mrVsM = comparison("M+R", "M");
	const mrVsStock = comparison("M+R", "stock");
	const anyInvalid = arms.some((arm) => !arm.valid);
	const mPlusRIncrementalWinAgainstM = mrVsM?.status === "win";
	const mPlusRWinAgainstStock = mrVsStock?.status === "win";
	let overall: ReducedCpuStudyAnalysis["overall"];
	if (anyInvalid) {
		overall = {
			status: "invalid",
			selectedArm: null,
			reason: "at least one arm is invalid, so no study-level selection is admissible",
			mPlusRIncrementalWinAgainstM,
			mPlusRWinAgainstStock,
		};
	} else if (mPlusRIncrementalWinAgainstM && mPlusRWinAgainstStock) {
		overall = {
			status: "selected",
			selectedArm: "M+R",
			reason: "M+R wins incrementally against M and also wins against Stock",
			mPlusRIncrementalWinAgainstM,
			mPlusRWinAgainstStock,
		};
	} else if (mVsStock?.status === "win") {
		overall = {
			status: "selected",
			selectedArm: "M",
			reason: "M wins against Stock and M+R does not clear both required comparisons",
			mPlusRIncrementalWinAgainstM,
			mPlusRWinAgainstStock,
		};
	} else {
		const inconclusive = comparisons.some((item) => item.status === "inconclusive");
		overall = {
			status: inconclusive ? "inconclusive" : "selected",
			selectedArm: "stock",
			reason: inconclusive
				? "no treatment clears the required comparisons; retain Stock provisionally under the tie preference"
				: "no treatment wins; retain Stock under the fixed tie preference",
			mPlusRIncrementalWinAgainstM,
			mPlusRWinAgainstStock,
		};
	}
	return {
		schemaVersion: 1,
		protocol: REDUCED_CPU_STUDY_ANALYSIS_PROTOCOL,
		studyProtocol: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		taskPolicy: {
			searchTasks: REDUCED_CPU_SEARCH_TASKS,
			championValidationTask: REDUCED_CPU_VALIDATION_TASK,
			candidateCountPerArm: REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM,
			normalization: "task-local-ir-divided-by-task-local-calibration-ir",
			practicalMargin: "max-3-ir-or-half-percent-calibration-v1",
			rawCountAggregation: "forbidden",
		},
		tiePreference: REDUCED_CPU_STUDY_ARMS,
		calibration: REDUCED_CPU_ALL_TASKS.map((benchmarkId) =>
			normalizedTask(benchmarkId, calibrations.get(benchmarkId)!, calibrations),
		),
		arms,
		comparisons,
		overall,
	};
}

export function serializeReducedCpuStudyAnalysis(analysis: ReducedCpuStudyAnalysis): string {
	return `${canonicalJson(toJsonValue(analysis))}\n`;
}

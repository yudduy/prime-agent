import {
	compareParetoCoverage,
	type MinimizationParetoPoint,
	type ParetoCoverageComparison,
} from "./pareto-coverage.js";
import type { StockInterfaceFeedbackView } from "./stock-interface-parity-protocol.js";

export interface FeedbackProjectionUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { total: number };
}

export interface FeedbackProjectionArmEvidence {
	feedbackView: StockInterfaceFeedbackView;
	operationalPassed: boolean;
	projectionIntegrityPassed: boolean;
	modelFeedbackBytes: readonly number[];
	points: readonly MinimizationParetoPoint[];
	selectedJobId: string | null;
	usage: FeedbackProjectionUsage;
	promptWallMs: number;
	evaluatorWaitMs: number;
	calendarMs: number;
}

export type FeedbackProjectionScreenDecision =
	| "directionally-promising-replication-required"
	| "integrity-invalid"
	| "negative-compression"
	| "negative-quality";

export interface FeedbackProjectionPairAnalysis {
	protocol: "feedback-projection-pair-analysis-v1";
	full: FeedbackProjectionArmEvidence & { totalModelFeedbackBytes: number };
	concise: FeedbackProjectionArmEvidence & { totalModelFeedbackBytes: number };
	compression: {
		ratio: number;
		reductionFraction: number;
		maximumAllowedRatio: number;
		passed: boolean;
	};
	proposalConditioningSensitivity: {
		scope: "feedback-results-before-a-later-provider-dispatch";
		fullBytes: number;
		conciseBytes: number;
		ratio: number;
		reductionFraction: number;
	};
	paretoCoverage: ParetoCoverageComparison;
	qualityGate: {
		requirement: "concise-covers-every-full-frontier-vector";
		passed: boolean;
	};
	efficiency: {
		inputTokenReductionFraction: number;
		totalTokenReductionFraction: number;
		costReductionFraction: number;
		promptWallReductionFraction: number;
	};
	operationalGatePassed: boolean;
	projectionIntegrityPassed: boolean;
	decision: FeedbackProjectionScreenDecision;
	replicationRecommended: boolean;
	gpuTransferAllowed: false;
}

function nonnegativeFinite(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`);
}

function validateArm(arm: FeedbackProjectionArmEvidence, expectedView: StockInterfaceFeedbackView): void {
	if (arm.feedbackView !== expectedView) throw new Error(`Expected ${expectedView} arm, got ${arm.feedbackView}`);
	if (arm.modelFeedbackBytes.length !== 4) {
		throw new Error(`${expectedView} arm must have exactly four model feedback records`);
	}
	for (const [index, bytes] of arm.modelFeedbackBytes.entries()) {
		if (!Number.isSafeInteger(bytes) || bytes <= 0) {
			throw new Error(`${expectedView} modelFeedbackBytes[${index}] must be a positive safe integer`);
		}
	}
	if (arm.points.length === 0) throw new Error(`${expectedView} arm has no measured objective vectors`);
	if (arm.selectedJobId !== null && !arm.points.some((point) => point.id === arm.selectedJobId)) {
		throw new Error(`${expectedView} selected job is absent from its measured points`);
	}
	nonnegativeFinite(arm.usage.input, `${expectedView}.usage.input`);
	nonnegativeFinite(arm.usage.output, `${expectedView}.usage.output`);
	nonnegativeFinite(arm.usage.cacheRead, `${expectedView}.usage.cacheRead`);
	nonnegativeFinite(arm.usage.cacheWrite, `${expectedView}.usage.cacheWrite`);
	nonnegativeFinite(arm.usage.totalTokens, `${expectedView}.usage.totalTokens`);
	nonnegativeFinite(arm.usage.cost.total, `${expectedView}.usage.cost.total`);
	nonnegativeFinite(arm.promptWallMs, `${expectedView}.promptWallMs`);
	nonnegativeFinite(arm.evaluatorWaitMs, `${expectedView}.evaluatorWaitMs`);
	nonnegativeFinite(arm.calendarMs, `${expectedView}.calendarMs`);
}

function reductionFraction(control: number, treatment: number): number {
	return control === 0 ? (treatment === 0 ? 0 : Number.NEGATIVE_INFINITY) : (control - treatment) / control;
}

export function analyzeFeedbackProjectionPair(input: {
	full: FeedbackProjectionArmEvidence;
	concise: FeedbackProjectionArmEvidence;
	maximumFeedbackRatio?: number;
}): FeedbackProjectionPairAnalysis {
	validateArm(input.full, "full");
	validateArm(input.concise, "concise");
	const maximumAllowedRatio = input.maximumFeedbackRatio ?? 0.25;
	if (!Number.isFinite(maximumAllowedRatio) || maximumAllowedRatio <= 0 || maximumAllowedRatio > 1) {
		throw new Error("maximumFeedbackRatio must be in (0, 1]");
	}
	const fullBytes = input.full.modelFeedbackBytes.reduce((total, value) => total + value, 0);
	const conciseBytes = input.concise.modelFeedbackBytes.reduce((total, value) => total + value, 0);
	const ratio = conciseBytes / fullBytes;
	const fullProposalConditioningBytes = input.full.modelFeedbackBytes
		.slice(0, -1)
		.reduce((total, value) => total + value, 0);
	const conciseProposalConditioningBytes = input.concise.modelFeedbackBytes
		.slice(0, -1)
		.reduce((total, value) => total + value, 0);
	const proposalConditioningRatio = conciseProposalConditioningBytes / fullProposalConditioningBytes;
	const paretoCoverage = compareParetoCoverage(input.concise.points, input.full.points);
	const operationalGatePassed = input.full.operationalPassed && input.concise.operationalPassed;
	const projectionIntegrityPassed = input.full.projectionIntegrityPassed && input.concise.projectionIntegrityPassed;
	const compressionPassed = ratio <= maximumAllowedRatio;
	const qualityPassed = paretoCoverage.leftCoversRight.complete;
	let decision: FeedbackProjectionScreenDecision;
	if (!operationalGatePassed || !projectionIntegrityPassed) decision = "integrity-invalid";
	else if (!compressionPassed) decision = "negative-compression";
	else if (!qualityPassed) decision = "negative-quality";
	else decision = "directionally-promising-replication-required";
	return {
		protocol: "feedback-projection-pair-analysis-v1",
		full: { ...input.full, totalModelFeedbackBytes: fullBytes },
		concise: { ...input.concise, totalModelFeedbackBytes: conciseBytes },
		compression: {
			ratio,
			reductionFraction: 1 - ratio,
			maximumAllowedRatio,
			passed: compressionPassed,
		},
		proposalConditioningSensitivity: {
			scope: "feedback-results-before-a-later-provider-dispatch",
			fullBytes: fullProposalConditioningBytes,
			conciseBytes: conciseProposalConditioningBytes,
			ratio: proposalConditioningRatio,
			reductionFraction: 1 - proposalConditioningRatio,
		},
		paretoCoverage,
		qualityGate: {
			requirement: "concise-covers-every-full-frontier-vector",
			passed: qualityPassed,
		},
		efficiency: {
			inputTokenReductionFraction: reductionFraction(input.full.usage.input, input.concise.usage.input),
			totalTokenReductionFraction: reductionFraction(input.full.usage.totalTokens, input.concise.usage.totalTokens),
			costReductionFraction: reductionFraction(input.full.usage.cost.total, input.concise.usage.cost.total),
			promptWallReductionFraction: reductionFraction(input.full.promptWallMs, input.concise.promptWallMs),
		},
		operationalGatePassed,
		projectionIntegrityPassed,
		decision,
		replicationRecommended: decision === "directionally-promising-replication-required",
		gpuTransferAllowed: false,
	};
}

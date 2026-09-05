import assert from "node:assert/strict";
import { toJsonValue } from "./canonical-json.js";
import type { CompilerGymIrDeltaScreenCandidateVector } from "./compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
	diceLcsSimilarity,
	projectCompilerGymLateNoveltyGuidanceFeedback,
} from "./compiler-gym-late-novelty-guidance.js";
import type { StockCpuEvaluationRequest } from "./stock-cpu-protocol.js";
import type { StockInterfaceParityEvaluationEnvelope } from "./stock-interface-parity-protocol.js";

export const COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL = "compiler-gym-late-structural-novelty-paid-screen-v2" as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID =
	"compiler-gym-late-structural-novelty-paid-screen-pair-v2" as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_ARMS = ["unchanged-control", "late-novelty-treatment"] as const;
export type CompilerGymLateNoveltyScreenArm = (typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_ARMS)[number];

export interface CompilerGymLateNoveltyScreenCall {
	callIndex: 1 | 2 | 3 | 4;
	actions: string[];
	outcome: CompilerGymIrDeltaScreenCandidateVector["outcome"];
	blowfishIr: number | null;
	bzip2Ir: number | null;
}

export interface CompilerGymLateNoveltyScreenArmResult {
	arm: CompilerGymLateNoveltyScreenArm;
	treatmentDelivered: boolean;
	calls: CompilerGymLateNoveltyScreenCall[];
}

export interface CompilerGymLateNoveltyArmAssessment {
	arm: CompilerGymLateNoveltyScreenArm;
	treatmentDelivered: boolean;
	parentVerified: boolean;
	callFourVerified: boolean;
	similarity: ReturnType<typeof diceLcsSimilarity> | null;
	strictlyDominatesParent: boolean;
	normalizedMinimaxParentRatio: { numerator: string; denominator: string; value: number } | null;
}

export interface CompilerGymLateNoveltyPairAssessment {
	protocol: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL;
	control: CompilerGymLateNoveltyArmAssessment;
	treatment: CompilerGymLateNoveltyArmAssessment;
	decision: "directional-win-promising" | "directional-loss" | "tie-or-inconclusive";
	nextGate: "one-fresh-randomized-replication" | "kill-late-novelty-v2";
	causalClaimAllowed: false;
	replicationClaimAllowed: false;
	gpuPromotionAllowed: false;
}

export function projectCompilerGymLateNoveltyScreenFeedback(input: {
	details: StockInterfaceParityEvaluationEnvelope;
	arm: CompilerGymLateNoveltyScreenArm;
	submissionOrdinal: number;
}):
	| StockInterfaceParityEvaluationEnvelope
	| (StockInterfaceParityEvaluationEnvelope & {
			call4Guidance: typeof COMPILER_GYM_LATE_NOVELTY_GUIDANCE;
	  }) {
	if (!COMPILER_GYM_LATE_NOVELTY_SCREEN_ARMS.includes(input.arm)) {
		throw new Error(`Unknown late-novelty paid-screen arm: ${String(input.arm)}`);
	}
	return projectCompilerGymLateNoveltyGuidanceFeedback({
		details: input.details,
		enabled: input.arm === "late-novelty-treatment",
		submissionOrdinal: input.submissionOrdinal,
	});
}

function exactCalls(calls: readonly CompilerGymLateNoveltyScreenCall[]): void {
	assert.equal(calls.length, 4, "Late-novelty admitted arm must contain four calls");
	for (const [index, call] of calls.entries()) {
		assert.equal(call.callIndex, index + 1, "Late-novelty call order drifted");
		assert.ok(call.actions.length >= 1 && call.actions.length <= 46, "Late-novelty action count drifted");
		toJsonValue(call);
	}
}

function assessArm(result: CompilerGymLateNoveltyScreenArmResult): CompilerGymLateNoveltyArmAssessment {
	exactCalls(result.calls);
	const parent = result.calls[2]!;
	const child = result.calls[3]!;
	const parentVerified =
		parent.outcome === "verified" &&
		parent.blowfishIr !== null &&
		Number.isSafeInteger(parent.blowfishIr) &&
		parent.blowfishIr > 0 &&
		parent.bzip2Ir !== null &&
		Number.isSafeInteger(parent.bzip2Ir) &&
		parent.bzip2Ir > 0;
	const callFourVerified =
		child.outcome === "verified" &&
		child.blowfishIr !== null &&
		Number.isSafeInteger(child.blowfishIr) &&
		child.blowfishIr > 0 &&
		child.bzip2Ir !== null &&
		Number.isSafeInteger(child.bzip2Ir) &&
		child.bzip2Ir > 0;
	const similarity = diceLcsSimilarity(child.actions, parent.actions);
	const strictlyDominatesParent =
		parentVerified &&
		callFourVerified &&
		child.blowfishIr! <= parent.blowfishIr! &&
		child.bzip2Ir! <= parent.bzip2Ir! &&
		(child.blowfishIr! < parent.blowfishIr! || child.bzip2Ir! < parent.bzip2Ir!);
	let normalizedMinimaxParentRatio: CompilerGymLateNoveltyArmAssessment["normalizedMinimaxParentRatio"] = null;
	if (parentVerified && callFourVerified) {
		const blowfish = { numerator: child.blowfishIr!, denominator: parent.blowfishIr! };
		const bzip2 = { numerator: child.bzip2Ir!, denominator: parent.bzip2Ir! };
		const maximum =
			BigInt(blowfish.numerator) * BigInt(bzip2.denominator) >=
			BigInt(bzip2.numerator) * BigInt(blowfish.denominator)
				? blowfish
				: bzip2;
		normalizedMinimaxParentRatio = {
			numerator: maximum.numerator.toString(10),
			denominator: maximum.denominator.toString(10),
			value: maximum.numerator / maximum.denominator,
		};
	}
	return {
		arm: result.arm,
		treatmentDelivered: result.treatmentDelivered,
		parentVerified,
		callFourVerified,
		similarity,
		strictlyDominatesParent,
		normalizedMinimaxParentRatio,
	};
}

function ratioStrictlyLower(
	left: NonNullable<CompilerGymLateNoveltyArmAssessment["normalizedMinimaxParentRatio"]>,
	right: NonNullable<CompilerGymLateNoveltyArmAssessment["normalizedMinimaxParentRatio"]>,
): boolean {
	return BigInt(left.numerator) * BigInt(right.denominator) < BigInt(right.numerator) * BigInt(left.denominator);
}

export function assessCompilerGymLateNoveltyScreenPair(input: {
	control: CompilerGymLateNoveltyScreenArmResult;
	treatment: CompilerGymLateNoveltyScreenArmResult;
}): CompilerGymLateNoveltyPairAssessment {
	assert.equal(input.control.arm, "unchanged-control");
	assert.equal(input.treatment.arm, "late-novelty-treatment");
	assert.equal(input.control.treatmentDelivered, false, "Late-novelty control cannot receive treatment guidance");
	const control = assessArm(input.control);
	const treatment = assessArm(input.treatment);
	const treatmentRatio = treatment.normalizedMinimaxParentRatio;
	const controlRatio = control.normalizedMinimaxParentRatio;
	const win =
		treatment.treatmentDelivered &&
		treatment.parentVerified &&
		treatment.callFourVerified &&
		treatment.similarity?.band === "low" &&
		treatment.strictlyDominatesParent &&
		!control.strictlyDominatesParent &&
		treatmentRatio !== null &&
		controlRatio !== null &&
		ratioStrictlyLower(treatmentRatio, controlRatio);
	const loss =
		treatment.treatmentDelivered &&
		control.strictlyDominatesParent &&
		!treatment.strictlyDominatesParent &&
		controlRatio !== null &&
		treatmentRatio !== null &&
		ratioStrictlyLower(controlRatio, treatmentRatio);
	const decision = win ? "directional-win-promising" : loss ? "directional-loss" : "tie-or-inconclusive";
	return {
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL,
		control,
		treatment,
		decision,
		nextGate: decision === "directional-win-promising" ? "one-fresh-randomized-replication" : "kill-late-novelty-v2",
		causalClaimAllowed: false,
		replicationClaimAllowed: false,
		gpuPromotionAllowed: false,
	};
}

export function lateNoveltyGuidanceFieldIsExact(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		Object.hasOwn(record, COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD) &&
		record[COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD] === COMPILER_GYM_LATE_NOVELTY_GUIDANCE
	);
}

export function requestForLateNoveltyCall(
	request: StockCpuEvaluationRequest,
	callIndex: 1 | 2 | 3 | 4,
	candidate: CompilerGymIrDeltaScreenCandidateVector,
): CompilerGymLateNoveltyScreenCall {
	assert.equal(candidate.callIndex, callIndex, "Late-novelty candidate/request call index drifted");
	return {
		callIndex,
		actions: [...request.actions],
		outcome: candidate.outcome,
		blowfishIr: candidate.blowfishIr,
		bzip2Ir: candidate.bzip2Ir,
	};
}

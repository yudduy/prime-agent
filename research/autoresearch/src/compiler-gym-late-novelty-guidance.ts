import assert from "node:assert/strict";
import { STOCK_CPU_TASKS } from "./stock-cpu-protocol.js";
import type { StockInterfaceParityEvaluationEnvelope } from "./stock-interface-parity-protocol.js";

export const COMPILER_GYM_LATE_NOVELTY_THRESHOLD = { numerator: 4, denominator: 5 } as const;
export const COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES = 128 as const;
export const COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD = "call4Guidance" as const;
export const COMPILER_GYM_LATE_NOVELTY_GUIDANCE =
	"Call 4: target 2*LCS(actions,parent)/(|actions|+|parent|)<0.80; override if explicit mechanism favors reuse." as const;

export type CompilerGymLateNoveltyBand = "low" | "high";

export type CompilerGymLateNoveltyTreatmentFeedback = StockInterfaceParityEvaluationEnvelope & {
	call4Guidance: typeof COMPILER_GYM_LATE_NOVELTY_GUIDANCE;
};

function isAcceptedTerminalFeedback(details: StockInterfaceParityEvaluationEnvelope): boolean {
	const measurement = details.job.measurement;
	if (
		details.job.state.status !== "succeeded" ||
		!measurement ||
		measurement.tasks.length !== STOCK_CPU_TASKS.length
	) {
		return false;
	}
	return STOCK_CPU_TASKS.every((benchmarkId) => {
		const matches = measurement.tasks.filter((task) => task.benchmarkId === benchmarkId);
		return matches.length === 1 && matches[0]?.status === "accepted" && matches[0].verifier.passed;
	});
}

export function longestCommonSubsequenceLength(left: readonly string[], right: readonly string[]): number {
	let previous = new Uint32Array(right.length + 1);
	for (const leftValue of left) {
		const current = new Uint32Array(right.length + 1);
		for (let index = 1; index <= right.length; index++) {
			current[index] =
				leftValue === right[index - 1] ? previous[index - 1] + 1 : Math.max(previous[index], current[index - 1]);
		}
		previous = current;
	}
	return previous[right.length];
}

export function diceLcsSimilarity(
	left: readonly string[],
	right: readonly string[],
): {
	lcsLength: number;
	numerator: number;
	denominator: number;
	similarity: number;
	band: CompilerGymLateNoveltyBand;
} {
	const denominator = left.length + right.length;
	if (denominator === 0) throw new Error("Dice-LCS similarity is undefined for two empty sequences");
	const lcsLength = longestCommonSubsequenceLength(left, right);
	const numerator = 2 * lcsLength;
	return {
		lcsLength,
		numerator,
		denominator,
		similarity: numerator / denominator,
		band:
			numerator * COMPILER_GYM_LATE_NOVELTY_THRESHOLD.denominator <
			COMPILER_GYM_LATE_NOVELTY_THRESHOLD.numerator * denominator
				? "low"
				: "high",
	};
}

export function projectCompilerGymLateNoveltyGuidanceFeedback(input: {
	details: StockInterfaceParityEvaluationEnvelope;
	enabled: boolean;
	submissionOrdinal: number;
}): StockInterfaceParityEvaluationEnvelope | CompilerGymLateNoveltyTreatmentFeedback {
	if (!Number.isSafeInteger(input.submissionOrdinal) || input.submissionOrdinal < 1 || input.submissionOrdinal > 4) {
		throw new Error("Late-novelty submission ordinal must be an integer from 1 through 4");
	}
	const control = structuredClone(input.details);
	if (!input.enabled || input.submissionOrdinal !== 3 || !isAcceptedTerminalFeedback(control)) return control;
	const treatment: CompilerGymLateNoveltyTreatmentFeedback = {
		...control,
		call4Guidance: COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
	};
	const serializedFieldBytes = Buffer.byteLength(
		JSON.stringify({ [COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD]: COMPILER_GYM_LATE_NOVELTY_GUIDANCE }),
		"utf8",
	);
	const serializedDeltaBytes =
		Buffer.byteLength(JSON.stringify(treatment), "utf8") - Buffer.byteLength(JSON.stringify(control), "utf8");
	assert.equal(
		serializedFieldBytes <= COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
		true,
		"Late-novelty serialized guidance field exceeds its frozen byte budget",
	);
	assert.equal(
		serializedDeltaBytes <= COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
		true,
		"Late-novelty model-feedback delta exceeds its frozen byte budget",
	);
	assert.deepEqual(
		Object.keys(treatment).filter((key) => !Object.hasOwn(control, key)),
		[COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD],
		"Late-novelty treatment must add exactly one top-level field",
	);
	return treatment;
}

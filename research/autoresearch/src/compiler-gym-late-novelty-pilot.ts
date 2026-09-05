import {
	COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
	type CompilerGymLateNoveltyTreatmentFeedback,
	projectCompilerGymLateNoveltyGuidanceFeedback,
} from "./compiler-gym-late-novelty-guidance.js";
import type { StockInterfaceParityEvaluationEnvelope } from "./stock-interface-parity-protocol.js";

export {
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
	type CompilerGymLateNoveltyTreatmentFeedback,
	projectCompilerGymLateNoveltyGuidanceFeedback,
} from "./compiler-gym-late-novelty-guidance.js";

export const COMPILER_GYM_LATE_NOVELTY_PILOT_PROTOCOL = "compiler-gym-late-structural-novelty-faux-pilot-v1" as const;
export const COMPILER_GYM_LATE_NOVELTY_PILOT_ARMS = ["unchanged-control", "late-novelty-treatment"] as const;
export type CompilerGymLateNoveltyPilotArm = (typeof COMPILER_GYM_LATE_NOVELTY_PILOT_ARMS)[number];
export const COMPILER_GYM_LATE_NOVELTY_FAUX_PILOT_POLICY = {
	schemaVersion: 1,
	classification: "apparatus-only-faux-prompt-wiring-not-treatment-evidence",
	treatmentResultOrdinal: 3,
	consumerProviderDispatchOrdinal: 4,
	maxSerializedDeltaBytes: COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
	authorizations: {
		liveProvider: false,
		paid: false,
		remoteEvaluator: false,
		gpu: false,
		treatmentClaim: false,
		promotion: false,
	},
} as const;

export function projectCompilerGymLateNoveltyPilotFeedback(input: {
	details: StockInterfaceParityEvaluationEnvelope;
	arm: CompilerGymLateNoveltyPilotArm;
	submissionOrdinal: number;
}): StockInterfaceParityEvaluationEnvelope | CompilerGymLateNoveltyTreatmentFeedback {
	if (!COMPILER_GYM_LATE_NOVELTY_PILOT_ARMS.includes(input.arm)) {
		throw new Error(`Unknown late-novelty pilot arm: ${String(input.arm)}`);
	}
	return projectCompilerGymLateNoveltyGuidanceFeedback({
		details: input.details,
		enabled: input.arm === "late-novelty-treatment",
		submissionOrdinal: input.submissionOrdinal,
	});
}

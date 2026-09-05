import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json } from "./canonical-json.js";

export const NANOGPT_SCORED_PARENT_CAMPAIGN_SHA256 =
	"31f6b78ac5c5ccb87a471e61bbad46e1f0d1b1c892eb7c678c1e8f5a8e02e2f4" as const;

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key));
		Object.freeze(value);
	}
	return value;
}

if (sha256Json(FROZEN_CAMPAIGN) !== NANOGPT_SCORED_PARENT_CAMPAIGN_SHA256) {
	throw new Error("NanoGPT scored amendment parent campaign hash changed");
}
if (
	FROZEN_CAMPAIGN.lanes.nanoGpt.gate.wideningSchedule.length !== 4 ||
	FROZEN_CAMPAIGN.lanes.nanoGpt.gate.wideningSchedule.some((value, index) => value !== ([1, 2, 4, 8] as const)[index])
) {
	throw new Error("NanoGPT scored amendment historical widening schedule changed");
}

export const NANOGPT_SCORED_AMENDMENT = deepFreeze({
	schemaVersion: 1,
	amendmentId: "prime-agent-autoresearch-v1-nanogpt-scored-widening-v1",
	frozenAt: "2026-08-30T07:18:44.000Z",
	campaignId: FROZEN_CAMPAIGN.id,
	parentCampaignConfigSha256: NANOGPT_SCORED_PARENT_CAMPAIGN_SHA256,
	historicalWideningSchedule: [1, 2, 4, 8],
	candidateSmoke: {
		mode: "smoke-10",
		trials: 1,
		effectiveTrainSteps: 10,
		scored: false,
	},
	successorScoredSchedule: [1, 3, 8],
	successorModes: ["score-1", "score-3", "replay-8"],
	finalEightSeedDecisionRuleChanged: false,
	interimWideningScheduleChanged: true,
	historicalEvidenceReclassification: "forbidden",
	crossProtocolAggregation: "forbidden",
	basis: "Prospective correction to match the user-approved one-seed, three-seed, eight-seed staged verifier before the first scored NanoGPT dispatch.",
} as const);

export const NANOGPT_SCORED_AMENDMENT_SHA256 = sha256Json(NANOGPT_SCORED_AMENDMENT);

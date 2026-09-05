import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FROZEN_CAMPAIGN } from "../src/campaign.js";
import { sha256Json } from "../src/canonical-json.js";
import {
	NANOGPT_SCORED_AMENDMENT,
	NANOGPT_SCORED_AMENDMENT_SHA256,
	NANOGPT_SCORED_PARENT_CAMPAIGN_SHA256,
} from "../src/nanogpt-scored-amendment.js";
import { nanoGptScoredBoundaryConditions } from "../src/nanogpt-scored-protocol.js";

const FAUX_PINS = {
	staticEvaluatorSha256: "1".repeat(64),
	environmentSha256: "2".repeat(64),
	environmentSealSha256: "3".repeat(64),
	datasetManifestSha256: "4".repeat(64),
	workerSha256: "5".repeat(64),
	transportSha256: "6".repeat(64),
} as const;

describe("NanoGPT scored campaign amendment", () => {
	it("preserves the historical campaign hash while prospectively selecting 1/3/8", () => {
		assert.equal(sha256Json(FROZEN_CAMPAIGN), NANOGPT_SCORED_PARENT_CAMPAIGN_SHA256);
		assert.deepEqual(FROZEN_CAMPAIGN.lanes.nanoGpt.gate.wideningSchedule, [1, 2, 4, 8]);
		assert.deepEqual(NANOGPT_SCORED_AMENDMENT.historicalWideningSchedule, [1, 2, 4, 8]);
		assert.deepEqual(NANOGPT_SCORED_AMENDMENT.successorScoredSchedule, [1, 3, 8]);
		assert.deepEqual(NANOGPT_SCORED_AMENDMENT.successorModes, ["score-1", "score-3", "replay-8"]);
		assert.equal(NANOGPT_SCORED_AMENDMENT.finalEightSeedDecisionRuleChanged, false);
		assert.equal(NANOGPT_SCORED_AMENDMENT.historicalEvidenceReclassification, "forbidden");
		assert.equal(NANOGPT_SCORED_AMENDMENT_SHA256, "0aece581a2cc9e49672f598129a9f298353114368962a4fca0e09b0f7e9751ab");
		assert.equal(Object.isFrozen(NANOGPT_SCORED_AMENDMENT), true);
		assert.equal(Object.isFrozen(NANOGPT_SCORED_AMENDMENT.candidateSmoke), true);
	});

	it("binds the amendment digest into every scored proposal boundary", () => {
		assert.ok(
			nanoGptScoredBoundaryConditions(FAUX_PINS).includes(
				`campaignAmendmentSha256=${NANOGPT_SCORED_AMENDMENT_SHA256}`,
			),
		);
	});
});

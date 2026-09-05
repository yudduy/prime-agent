import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Json } from "../src/canonical-json.js";
import { NANOGPT_SCORED_AMENDMENT_SHA256 } from "../src/nanogpt-scored-amendment.js";
import {
	NANOGPT_SCORED_PARALLEL_AMENDMENT,
	NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
} from "../src/nanogpt-scored-parallel-amendment.js";
import { NANOGPT_SCORED_CONTRACT_ID, NANOGPT_SCORED_TRIAL_SEEDS } from "../src/nanogpt-scored-protocol.js";

describe("NanoGPT scored parallel v2 amendment", () => {
	it("prospectively freezes v1 score-1 as a Boolean gate with no numeric reuse", () => {
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.frozenAt, "2026-08-30T08:25:00.000Z");
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.contract, NANOGPT_SCORED_CONTRACT_ID);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.campaignAmendmentSha256, NANOGPT_SCORED_AMENDMENT_SHA256);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.bridgeMode, "score-1");
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.bridgeRequiresAccepted, true);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.bridgeRequiresThresholdPassed, true);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.numericMeasurementsReused, false);
		assert.deepEqual(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.bridgeForbiddenForModes, ["smoke-10"]);
		assert.deepEqual(NANOGPT_SCORED_PARALLEL_AMENDMENT.parentV1.bridgeRequiredForModes, ["score-3", "replay-8"]);
	});

	it("freezes fresh full 1/3/8 stages, four-way width, and exact nanounit aggregation", () => {
		assert.deepEqual(NANOGPT_SCORED_PARALLEL_AMENDMENT.v2Stages.modes, ["smoke-10", "score-3", "replay-8"]);
		assert.deepEqual(NANOGPT_SCORED_PARALLEL_AMENDMENT.v2Stages.exactSeeds["smoke-10"], [
			NANOGPT_SCORED_TRIAL_SEEDS[0],
		]);
		assert.deepEqual(
			NANOGPT_SCORED_PARALLEL_AMENDMENT.v2Stages.exactSeeds["score-3"],
			NANOGPT_SCORED_TRIAL_SEEDS.slice(0, 3),
		);
		assert.deepEqual(NANOGPT_SCORED_PARALLEL_AMENDMENT.v2Stages.exactSeeds["replay-8"], NANOGPT_SCORED_TRIAL_SEEDS);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.v2Stages.freshMeasurementRequiredPerStage, true);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.v2Stages.partialChildSetsAccepted, false);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.launch.maxConcurrentChildren, 4);
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.launch.noRequeue, true);
		assert.deepEqual(NANOGPT_SCORED_PARALLEL_AMENDMENT.schedulerEvidence, {
			rawSacctStateAndExitCodePreservedByteForByte: true,
			normalizedSuccessGate: { state: "COMPLETED", exitCode: "0:0" },
			receiptBindsRawSacctSha256: true,
		});
		assert.equal(NANOGPT_SCORED_PARALLEL_AMENDMENT.aggregation.thresholdNanounits, 3_278_590_000);
		assert.equal(
			NANOGPT_SCORED_PARALLEL_AMENDMENT.aggregation.comparison,
			"sum-loss-nanounits<trials*threshold-nanounits",
		);
		assert.deepEqual(NANOGPT_SCORED_PARALLEL_AMENDMENT.aggregation.measurementEncoding, {
			runtimeMsRounding: "half-even-to-nearest-integer",
			peakVramMbRounding: "ceil-to-whole-MiB",
		});
		assert.equal(Object.isFrozen(NANOGPT_SCORED_PARALLEL_AMENDMENT), true);
		assert.equal(Object.isFrozen(NANOGPT_SCORED_PARALLEL_AMENDMENT.v2Stages.exactSeeds), true);
		assert.equal(sha256Json(NANOGPT_SCORED_PARALLEL_AMENDMENT), NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256);
		assert.equal(
			NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
			"ebd00c96c29b239063783d48403ede681bc642d78bc6f60830cc30abebe73cff",
		);
	});
});

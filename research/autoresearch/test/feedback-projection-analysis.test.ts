import assert from "node:assert/strict";
import { test } from "node:test";
import {
	analyzeFeedbackProjectionPair,
	type FeedbackProjectionArmEvidence,
} from "../src/feedback-projection-analysis.js";

function arm(
	feedbackView: "concise" | "full",
	vector: readonly [number, number],
	feedbackBytes: number,
): FeedbackProjectionArmEvidence {
	return {
		feedbackView,
		operationalPassed: true,
		projectionIntegrityPassed: true,
		modelFeedbackBytes: [feedbackBytes, feedbackBytes, feedbackBytes, feedbackBytes],
		points: [{ id: `${feedbackView}-job`, vector }],
		selectedJobId: `${feedbackView}-job`,
		usage: {
			input: feedbackView === "full" ? 100 : 50,
			output: 20,
			cacheRead: 10,
			cacheWrite: 0,
			totalTokens: feedbackView === "full" ? 130 : 80,
			cost: { total: feedbackView === "full" ? 1 : 0.75 },
		},
		promptWallMs: 100,
		evaluatorWaitMs: 50,
		calendarMs: 101,
	};
}

test("stops a compressed treatment that does not cover the control frontier", () => {
	const result = analyzeFeedbackProjectionPair({
		full: arm("full", [10, 10], 1_000),
		concise: arm("concise", [11, 11], 100),
	});

	assert.equal(result.compression.ratio, 0.1);
	assert.equal(result.compression.passed, true);
	assert.equal(result.proposalConditioningSensitivity.ratio, 0.1);
	assert.equal(result.paretoCoverage.classification, "right-covers");
	assert.equal(result.qualityGate.passed, false);
	assert.equal(result.decision, "negative-quality");
	assert.equal(result.replicationRecommended, false);
	assert.equal(result.gpuTransferAllowed, false);
});

test("requires replication when compression and whole-frontier quality both pass", () => {
	const result = analyzeFeedbackProjectionPair({
		full: arm("full", [10, 10], 1_000),
		concise: arm("concise", [9, 10], 250),
	});

	assert.equal(result.compression.passed, true);
	assert.equal(result.qualityGate.passed, true);
	assert.equal(result.decision, "directionally-promising-replication-required");
	assert.equal(result.replicationRecommended, true);
});

test("makes integrity and compression failures explicit", () => {
	const invalid = arm("concise", [9, 9], 100);
	invalid.projectionIntegrityPassed = false;
	assert.equal(
		analyzeFeedbackProjectionPair({ full: arm("full", [10, 10], 1_000), concise: invalid }).decision,
		"integrity-invalid",
	);
	assert.equal(
		analyzeFeedbackProjectionPair({
			full: arm("full", [10, 10], 1_000),
			concise: arm("concise", [9, 9], 251),
		}).decision,
		"negative-compression",
	);
});

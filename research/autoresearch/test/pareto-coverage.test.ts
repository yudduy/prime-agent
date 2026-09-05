import assert from "node:assert/strict";
import { test } from "node:test";
import { compareParetoCoverage, type MinimizationParetoPoint } from "../src/pareto-coverage.js";

function point(id: string, first: number, second: number): MinimizationParetoPoint {
	return { id, vector: [first, second] };
}

test("whole-Pareto coverage classifies the V4 stock frontier as covering typed", () => {
	const result = compareParetoCoverage(
		[point("job_8f691ab678e6b535b05b827f", 1_948, 14_047), point("job_e896a3cc37485f522d1145ec", 1_958, 13_792)],
		[point("job_a96d5a9620dc42b4fcd2927e", 1_959, 13_951)],
	);

	assert.equal(result.objectiveCount, 2);
	assert.equal(result.classification, "left-covers");
	assert.equal(result.leftCoversRight.fraction, 1);
	assert.equal(result.rightCoversLeft.fraction, 0);
	assert.deepEqual(result.leftCoversRight.witnesses, [
		{
			source: { vector: [1_958, 13_792], pointIds: ["job_e896a3cc37485f522d1145ec"] },
			target: { vector: [1_959, 13_951], pointIds: ["job_a96d5a9620dc42b4fcd2927e"] },
			strictObjectiveIndexes: [0, 1],
		},
	]);
	assert.deepEqual(result.rightCoversLeft.uncoveredTargets, result.leftFrontier);
});

test("coverage deduplicates equal vectors and excludes dominated vectors before comparison", () => {
	const result = compareParetoCoverage(
		[point("left-z", 10, 20), point("left-a", 10, 20), point("left-dominated", 11, 21)],
		[point("right", 10, 20)],
	);

	assert.equal(result.classification, "equivalent");
	assert.deepEqual(result.leftFrontier, [{ vector: [10, 20], pointIds: ["left-a", "left-z"] }]);
	assert.deepEqual(result.rightFrontier, [{ vector: [10, 20], pointIds: ["right"] }]);
	assert.deepEqual(result.leftCoversRight.witnesses[0]?.strictObjectiveIndexes, []);
	assert.equal(result.leftCoversRight.targetVectorCount, 1);
	assert.equal(result.rightCoversLeft.targetVectorCount, 1);
});

test("coverage exposes right-covering, incomparable, and empty-set classifications", async (t) => {
	await t.test("right covers", () => {
		const result = compareParetoCoverage([point("left", 20, 20)], [point("right", 10, 20)]);
		assert.equal(result.classification, "right-covers");
		assert.equal(result.rightCoversLeft.complete, true);
		assert.deepEqual(result.rightCoversLeft.witnesses[0]?.strictObjectiveIndexes, [0]);
	});

	await t.test("incomparable", () => {
		const result = compareParetoCoverage([point("left", 5, 20)], [point("right", 10, 10)]);
		assert.equal(result.classification, "incomparable");
		assert.equal(result.leftCoversRight.complete, false);
		assert.equal(result.rightCoversLeft.complete, false);
	});

	await t.test("empty frontier", () => {
		const result = compareParetoCoverage([], [point("right", 10, 10)]);
		assert.equal(result.classification, "not-comparable");
		assert.equal(result.objectiveCount, 2);
		assert.equal(result.leftCoversRight.fraction, 0);
		assert.equal(result.rightCoversLeft.fraction, null);
	});
});

test("coverage rejects ambiguous point identities and invalid objective vectors", () => {
	assert.throws(
		() => compareParetoCoverage([point("same", 1, 2), point("same", 2, 1)], [point("right", 1, 2)]),
		/duplicate point ID same/,
	);
	assert.throws(
		() => compareParetoCoverage([{ id: "left", vector: [1, Number.NaN] }], [point("right", 1, 2)]),
		/must be finite/,
	);
	assert.throws(
		() => compareParetoCoverage([{ id: "left", vector: [1, 2, 3] }], [point("right", 1, 2)]),
		/different objective counts/,
	);
});

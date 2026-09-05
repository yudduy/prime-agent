import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type SelectionCandidate, selectCandidate, synchronizeCheckpointGroups } from "../src/analyze-cpu-smoke.js";

const tasks = ["task/a", "task/b"] as const;

function candidate(
	stableId: string,
	candidateDigest: string,
	passCount: number,
	a: number,
	b: number,
): SelectionCandidate {
	return { stableId, candidateDigest, passCount, taskRatios: { "task/a": a, "task/b": b } };
}

describe("CPU smoke analysis selector", () => {
	it("orders by worst task, mean, pass count, digest, then stable identity", () => {
		const candidates = [
			candidate("worst", "f".repeat(64), 1, 0.4, 0.7),
			candidate("mean", "e".repeat(64), 1, 0.5, 0.6),
			candidate("passes", "d".repeat(64), 3, 0.4, 0.6),
			candidate("digest-z", "c".repeat(64), 2, 0.4, 0.6),
			candidate("digest-a-2", "b".repeat(64), 2, 0.4, 0.6),
			candidate("digest-a-1", "b".repeat(64), 2, 0.4, 0.6),
		];
		assert.equal(selectCandidate(candidates, tasks)?.stableId, "digest-a-1");
	});

	it("returns null for an empty eligible set", () => {
		assert.equal(selectCandidate([], tasks), null);
	});

	it("emits width checkpoints only after the same candidate ordinal terminates on both branches", () => {
		const checkpoints = synchronizeCheckpointGroups([
			[
				{ branch: "W-a", candidate: 1, cumulativeTaskEvaluations: 2 },
				{ branch: "W-a", candidate: 2, cumulativeTaskEvaluations: 4 },
			],
			[
				{ branch: "W-b", candidate: 1, cumulativeTaskEvaluations: 2 },
				{ branch: "W-b", candidate: 2, cumulativeTaskEvaluations: 4 },
			],
		]);
		assert.deepEqual(
			checkpoints.map((checkpoint) => checkpoint.reduce((sum, item) => sum + item.cumulativeTaskEvaluations, 0)),
			[4, 8],
		);
		assert.deepEqual(
			checkpoints.map((checkpoint) => checkpoint.map((item) => `${item.branch}:${item.candidate}`)),
			[
				["W-a:1", "W-b:1"],
				["W-a:2", "W-b:2"],
			],
		);
	});

	it("rejects unequal branch depths instead of leaking arrival-order checkpoints", () => {
		assert.throws(() => synchronizeCheckpointGroups([[1, 2], [1]]), /equal checkpoint counts/);
	});
});

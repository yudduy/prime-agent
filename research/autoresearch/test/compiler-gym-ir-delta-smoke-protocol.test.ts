import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Text } from "../src/canonical-json.js";
import {
	assessCompilerGymIrDeltaSmoke,
	COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL,
	type CompilerGymIrDeltaSmokeBlock,
	parseCompilerGymIrDeltaSmokeInput,
} from "../src/compiler-gym-ir-delta-smoke-protocol.js";

const ACTIONS = ["-mem2reg", "-gvn"];
const ACTION_INDICES = [7, 42];

function block(blockId: "r1" | "r2", ratio: number): CompilerGymIrDeltaSmokeBlock {
	return {
		blockId,
		candidateId: "L46",
		candidateSha256: sha256Text(JSON.stringify(ACTIONS)),
		benchmarkId: "benchmark://cbench-v1/blowfish",
		actions: [...ACTIONS],
		canonical: {
			initialIrInstructionCount: 100,
			actionIndices: [...ACTION_INDICES],
			commandline: "opt -mem2reg -gvn",
			final: { irInstructionCount: 90, objectTextSizeBytes: 500, verifierPassed: true },
			intrinsicTotalMs: 100,
		},
		treatment: {
			initialIrInstructionCount: 100,
			actionIndices: [...ACTION_INDICES],
			commandline: "opt -mem2reg -gvn",
			final: { irInstructionCount: 90, objectTextSizeBytes: 500, verifierPassed: true },
			intrinsicTotalMs: 100 * ratio,
			trace: {
				initialIrInstructionCount: 100,
				records: [
					{ index: 0, action: ACTIONS[0], actionIndex: ACTION_INDICES[0], deltaFromPrevious: 0 },
					{ index: 1, action: ACTIONS[1], actionIndex: ACTION_INDICES[1], deltaFromPrevious: -10 },
				],
			},
		},
	};
}

function input(r1: number, r2: number) {
	return { protocol: COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL, blocks: [block("r1", r1), block("r2", r2)] };
}

describe("CompilerGym one-environment IR-delta smoke protocol", () => {
	it("promotes only at the frozen paired intrinsic-total boundaries", () => {
		const assessment = assessCompilerGymIrDeltaSmoke(input(0.99, 1.25));
		assert.equal(assessment.overhead.medianRatio, 1.12);
		assert.equal(assessment.overhead.maximumRatio, 1.25);
		assert.equal(assessment.decision, "promote-to-full-ir-delta-qualification");
		assert.equal(assessment.nextGate, "eight-fresh-allocation-model-free-ir-delta-qualification");
		assert.equal(assessment.lunaAuthorized, false);
		assert.equal(assessment.measurementReuseAllowed, false);
	});

	it("kills median and per-block threshold misses without authorizing Luna", () => {
		assert.equal(
			assessCompilerGymIrDeltaSmoke(input(1.122, 1.119)).decision,
			"kill-current-one-env-ir-delta-evaluator",
		);
		const outlier = assessCompilerGymIrDeltaSmoke(input(0.9, 1.251));
		assert.equal(outlier.overhead.medianRatio < 1.12, true);
		assert.equal(outlier.decision, "kill-current-one-env-ir-delta-evaluator");
		assert.equal(outlier.nextGate, null);
		assert.equal(outlier.lunaAuthorized, false);
	});

	it("requires exact action order, action indices, and telescoping deltas", () => {
		const wrongAction = structuredClone(input(1, 1));
		wrongAction.blocks[0].treatment.trace.records[0].action = "-sroa";
		assert.throws(() => parseCompilerGymIrDeltaSmokeInput(wrongAction), /action does not match/);
		const wrongIndex = structuredClone(input(1, 1));
		wrongIndex.blocks[0].treatment.trace.records[0].actionIndex = 8;
		assert.throws(() => parseCompilerGymIrDeltaSmokeInput(wrongIndex), /actionIndex does not match/);
		const nonTelescoping = structuredClone(input(1, 1));
		nonTelescoping.blocks[0].treatment.trace.records[1].deltaFromPrevious = -9;
		assert.throws(() => parseCompilerGymIrDeltaSmokeInput(nonTelescoping), /do not telescope/);
	});

	it("treats a zero delta as an integer observation without a no-effect field", () => {
		const parsed = parseCompilerGymIrDeltaSmokeInput(input(1, 1));
		assert.equal(parsed.blocks[0].treatment.trace.records[0].deltaFromPrevious, 0);
		assert.deepEqual(Object.keys(parsed.blocks[0].treatment.trace.records[0]).sort(), [
			"action",
			"actionIndex",
			"deltaFromPrevious",
			"index",
		]);
	});

	it("kills terminal or commandline inequality as a valid treatment result", () => {
		const mismatch = input(1, 1);
		mismatch.blocks[1].treatment.commandline = "opt changed";
		mismatch.blocks[1].treatment.final.objectTextSizeBytes += 1;
		const assessment = assessCompilerGymIrDeltaSmoke(mismatch);
		assert.deepEqual(assessment.equivalence.mismatches, [
			{ blockId: "r2", fields: ["commandline", "objectTextSizeBytes"] },
		]);
		assert.equal(assessment.decision, "kill-current-one-env-ir-delta-evaluator");
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertCompilerGymProxyCascadeResourceBlockPlan,
	buildCompilerGymProxyCascadeResourceBlockPlan,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS,
	type CompilerGymProxyCascadeResourceBlockObservation,
	type CompilerGymProxyCascadeResourceBlockPlan,
	evaluateCompilerGymProxyCascadeResourceGate,
} from "../src/compiler-gym-proxy-cascade-resource-protocol.js";

function observations(): CompilerGymProxyCascadeResourceBlockObservation[] {
	return [
		{
			blockOrdinal: 1,
			apparatusValid: true,
			control: {
				allocationCount: 8,
				stepCpuSeconds: 100,
				feedbackReadyWallMicros: 100_000_000,
				acceptedExactMetricCount: 8,
				expectedExactMetricCount: 8,
				passedVerifierCount: 8,
				expectedVerifierCount: 8,
				oracleFrontierOrdinals: [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS],
				oracleChampionOrdinal: COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL,
			},
			cascade: {
				allocationCount: 6,
				stepCpuSeconds: 80,
				feedbackReadyWallMicros: 90_000_000,
				acceptedExactMetricCount: 6,
				expectedExactMetricCount: 6,
				passedVerifierCount: 6,
				expectedVerifierCount: 6,
				selectedOrdinals: [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS],
			},
		},
		{
			blockOrdinal: 2,
			apparatusValid: true,
			control: {
				allocationCount: 8,
				stepCpuSeconds: 120,
				feedbackReadyWallMicros: 120_000_000,
				acceptedExactMetricCount: 8,
				expectedExactMetricCount: 8,
				passedVerifierCount: 8,
				expectedVerifierCount: 8,
				oracleFrontierOrdinals: [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS],
				oracleChampionOrdinal: COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL,
			},
			cascade: {
				allocationCount: 6,
				stepCpuSeconds: 96,
				feedbackReadyWallMicros: 108_000_000,
				acceptedExactMetricCount: 6,
				expectedExactMetricCount: 6,
				passedVerifierCount: 6,
				expectedVerifierCount: 6,
				selectedOrdinals: [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS],
			},
		},
	];
}

describe("CompilerGym proxy-cascade resource protocol", () => {
	it("freezes the complete AB/BA 28-allocation schedule with only within-round concurrency", () => {
		const plan = buildCompilerGymProxyCascadeResourceBlockPlan();
		assert.deepEqual(
			plan.blocks.map((block) => block.armOrder),
			[
				["full-control", "proxy-cascade"],
				["proxy-cascade", "full-control"],
			],
		);
		assert.equal(plan.allocations.length, 28);
		assert.equal(plan.maximumConcurrentAllocations, 2);
		for (const block of plan.blocks) {
			assert.equal(block.allocationCount, 14);
			const control = block.arms.find((arm) => arm.arm === "full-control")!;
			assert.deepEqual(
				control.rounds.map((round) => round.maximumConcurrency),
				[2, 2, 2, 2],
			);
			for (let index = 0; index < control.rounds.length; index++) {
				const round = control.rounds[index]!;
				const allocations = control.allocations.filter(
					(allocation) => allocation.roundOrdinal === round.roundOrdinal,
				);
				assert.equal(new Set(allocations.map((allocation) => allocation.candidateOrdinal)).size, 1);
				assert.equal(new Set(allocations.map((allocation) => allocation.benchmarkId)).size, 2);
				if (index > 0) {
					assert.deepEqual(
						allocations[0]!.dependsOnGlobalAllocationOrdinals,
						control.rounds[index - 1]!.allocationOrdinals,
					);
				}
			}
			const cascade = block.arms.find((arm) => arm.arm === "proxy-cascade")!;
			assert.deepEqual(
				cascade.rounds.map((round) => round.maximumConcurrency),
				[1, 1, 1, 1, 2],
			);
			const selected = cascade.allocations.slice(4);
			assert.deepEqual(
				selected[0]!.dependsOnGlobalAllocationOrdinals,
				cascade.allocations.slice(0, 4).map((allocation) => allocation.globalAllocationOrdinal),
			);
			assert.deepEqual(
				selected.map((allocation) => ({
					candidateOrdinal: allocation.candidateOrdinal,
					selectionRank: allocation.selectionRank,
					expectedCandidateOrdinal: allocation.expectedCandidateOrdinal,
					candidateBinding: allocation.candidateBinding,
				})),
				[
					{
						candidateOrdinal: null,
						selectionRank: 1,
						expectedCandidateOrdinal: 2,
						candidateBinding: "derive-only-from-this-arms-four-fresh-accepted-blowfish-ir-values",
					},
					{
						candidateOrdinal: null,
						selectionRank: 2,
						expectedCandidateOrdinal: 3,
						candidateBinding: "derive-only-from-this-arms-four-fresh-accepted-blowfish-ir-values",
					},
				],
			);
		}
		assert.equal(
			plan.allocations.every((allocation) => allocation.measurementState === "fresh-online-never-reused"),
			true,
		);
		assert.doesNotThrow(() => assertCompilerGymProxyCascadeResourceBlockPlan(plan));
	});

	it("fails closed on any complete-plan field drift", () => {
		const mutations: Array<(plan: CompilerGymProxyCascadeResourceBlockPlan) => void> = [
			(plan) => {
				plan.maximumConcurrentAllocations = 1 as 2;
			},
			(plan) => {
				plan.blocks[0]!.arms[0]!.feedbackReadyDefinition =
					"four-proxy-measurements-plus-two-selected-bzip2-measurements-terminal-and-admitted";
			},
			(plan) => {
				plan.allocations[0]!.candidateOrdinal = 2;
			},
			(plan) => {
				plan.allocations[0]!.benchmarkId = plan.allocations[1]!.benchmarkId;
			},
			(plan) => {
				plan.allocations[0]!.stage = "cascade-proxy-blowfish";
			},
			(plan) => {
				plan.allocations[2]!.dependsOnGlobalAllocationOrdinals = [];
			},
			(plan) => {
				plan.allocations[0]!.concurrencyGroup = "tampered";
			},
			(plan) => {
				plan.allocations[0]!.measurementState = "reused" as "fresh-online-never-reused";
			},
			(plan) => {
				plan.allocations[12]!.candidateOrdinal = 2;
			},
		];
		for (const mutate of mutations) {
			const changed = structuredClone(buildCompilerGymProxyCascadeResourceBlockPlan());
			mutate(changed);
			assert.throws(() => assertCompilerGymProxyCascadeResourceBlockPlan(changed), /complete resource block plan/);
		}
	});

	it("passes exactly at the CPU, median wall ratio, absolute wall, and per-block consistency boundaries", () => {
		const gate = evaluateCompilerGymProxyCascadeResourceGate(observations());
		assert.equal(gate.passed, true);
		assert.equal(gate.stepCpuRatioMedian, 0.8);
		assert.equal(gate.feedbackReadyWallRatioMedian, 0.9);
		assert.equal(gate.feedbackReadyWallSavingMicrosMedian, 11_000_000);
		assert.equal(Object.values(gate.gates).every(Boolean), true);
	});

	it("uses exact integer cross-products and requires the 20% CPU gate in each block and at the median", () => {
		const exact = observations();
		exact[0]!.control.stepCpuSeconds = 9_000_000_000_000_000;
		exact[0]!.cascade.stepCpuSeconds = 7_200_000_000_000_000;
		assert.equal(
			evaluateCompilerGymProxyCascadeResourceGate(exact).blocks[0]!.stepCpuAtLeastTwentyPercentLower,
			true,
		);
		const above = structuredClone(exact);
		above[0]!.cascade.stepCpuSeconds += 1;
		const aboveGate = evaluateCompilerGymProxyCascadeResourceGate(above);
		assert.equal(aboveGate.blocks[0]!.stepCpuAtLeastTwentyPercentLower, false);
		assert.equal(aboveGate.gates.eachBlockStepCpuAtLeastTwentyPercentLower, false);
		assert.equal(aboveGate.passed, false);
	});

	it("separately kills wall-ratio, absolute-saving, consistency, scientific, and apparatus failures", () => {
		const mutations: Array<{
			mutate: (value: CompilerGymProxyCascadeResourceBlockObservation[]) => void;
			gate: keyof ReturnType<typeof evaluateCompilerGymProxyCascadeResourceGate>["gates"];
		}> = [
			{
				mutate: (value) => {
					value[0]!.cascade.feedbackReadyWallMicros = 100_000_000;
					value[1]!.cascade.feedbackReadyWallMicros = 120_000_000;
				},
				gate: "medianFeedbackReadyWallAtLeastTenPercentLower",
			},
			{
				mutate: (value) => {
					value[0]!.control.feedbackReadyWallMicros = 200_000_000;
					value[0]!.cascade.feedbackReadyWallMicros = 191_000_000;
					value[1]!.control.feedbackReadyWallMicros = 200_000_000;
					value[1]!.cascade.feedbackReadyWallMicros = 191_000_000;
				},
				gate: "medianFeedbackReadyWallAtLeastTenSecondsLower",
			},
			{
				mutate: (value) => {
					value[0]!.cascade.feedbackReadyWallMicros = 106_000_000;
				},
				gate: "neitherBlockCascadeMoreThanFivePercentSlower",
			},
			{
				mutate: (value) => {
					value[0]!.cascade.selectedOrdinals = [1, 4];
				},
				gate: "exactMetricsVerifiersFrontierAndChampionPreserved",
			},
			{
				mutate: (value) => {
					value[1]!.apparatusValid = false;
				},
				gate: "bothBlocksApparatusValid",
			},
		];
		for (const testCase of mutations) {
			const changed = structuredClone(observations());
			testCase.mutate(changed);
			const result = evaluateCompilerGymProxyCascadeResourceGate(changed);
			assert.equal(result.gates[testCase.gate], false, testCase.gate);
			assert.equal(result.passed, false, testCase.gate);
		}
	});

	it("rejects non-integer inferential inputs and unordered blocks", () => {
		const fractional = observations();
		fractional[0]!.control.feedbackReadyWallMicros += 0.5;
		assert.throws(() => evaluateCompilerGymProxyCascadeResourceGate(fractional), /positive safe integer/);
		const unordered = observations().reverse();
		assert.throws(() => evaluateCompilerGymProxyCascadeResourceGate(unordered), /ordered observations/);
	});
});

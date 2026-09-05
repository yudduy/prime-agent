import { canonicalJson, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "./compiler-gym-proxy-cascade-protocol.js";

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-counterbalanced-resource-screen-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_BLOCK_PLAN_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-ab-ba-resource-plan-v1" as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_CANDIDATE_ORDINALS = [1, 2, 3, 4] as const;
export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS = [2, 3] as const;
export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS = [3] as const;
export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL = 3 as const;

export type CompilerGymProxyCascadeResourceArm = "full-control" | "proxy-cascade";
export type CompilerGymProxyCascadeResourceStage =
	| "control-candidate-pair"
	| "cascade-proxy-blowfish"
	| "cascade-selected-bzip2";

export interface CompilerGymProxyCascadeResourceAllocationSpec {
	globalAllocationOrdinal: number;
	blockOrdinal: 1 | 2;
	arm: CompilerGymProxyCascadeResourceArm;
	armOrderPosition: 1 | 2;
	armAllocationOrdinal: number;
	stage: CompilerGymProxyCascadeResourceStage;
	roundOrdinal: number;
	concurrencyGroup: string;
	candidateOrdinal: number | null;
	selectionRank: 1 | 2 | null;
	expectedCandidateOrdinal: number;
	candidateBinding: "frozen-source-ordinal" | "derive-only-from-this-arms-four-fresh-accepted-blowfish-ir-values";
	benchmarkId: typeof COMPILER_GYM_PROXY_CASCADE_BLOWFISH | typeof COMPILER_GYM_PROXY_CASCADE_BZIP2;
	dependsOnGlobalAllocationOrdinals: number[];
	measurementState: "fresh-online-never-reused";
}

export interface CompilerGymProxyCascadeResourceRoundSpec {
	roundOrdinal: number;
	concurrencyGroup: string;
	allocationOrdinals: number[];
	maximumConcurrency: 1 | 2;
	barrierBeforeNextRound: true;
}

export interface CompilerGymProxyCascadeResourceArmPlan {
	arm: CompilerGymProxyCascadeResourceArm;
	armOrderPosition: 1 | 2;
	onlineAllocationCount: 6 | 8;
	rounds: CompilerGymProxyCascadeResourceRoundSpec[];
	allocations: CompilerGymProxyCascadeResourceAllocationSpec[];
	feedbackReadyDefinition:
		| "all-eight-control-measurements-terminal-and-admitted"
		| "four-proxy-measurements-plus-two-selected-bzip2-measurements-terminal-and-admitted";
}

export interface CompilerGymProxyCascadeResourceBlockSpec {
	blockOrdinal: 1 | 2;
	armOrder: readonly [CompilerGymProxyCascadeResourceArm, CompilerGymProxyCascadeResourceArm];
	arms: CompilerGymProxyCascadeResourceArmPlan[];
	allocationCount: 14;
}

export interface CompilerGymProxyCascadeResourceBlockPlan {
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_BLOCK_PLAN_PROTOCOL;
	blocks: CompilerGymProxyCascadeResourceBlockSpec[];
	allocations: CompilerGymProxyCascadeResourceAllocationSpec[];
	candidateOrdinals: number[];
	selectedOrdinals: number[];
	blockCount: 2;
	controlArmCount: 2;
	cascadeArmCount: 2;
	controlAllocationsPerArm: 8;
	cascadeAllocationsPerArm: 6;
	totalFreshOnlineAllocations: 28;
	maximumConcurrentAllocations: 2;
	blocksRunSequentially: true;
	armsRunSequentiallyWithinBlock: true;
}

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS = {
	stepCpu: {
		measurement: "sum-exact-dot-zero-cpu-time-raw-seconds-per-arm",
		cascadeToControlMaximum: { numerator: 4, denominator: 5 },
		requireEveryBlock: true,
		requireTwoBlockMedian: true,
	},
	feedbackReadyWall: {
		measurement: "safe-integer-host-monotonic-arm-schedule-ready-interval-microseconds",
		cascadeToControlMedianMaximum: { numerator: 9, denominator: 10 },
		medianAbsoluteSavingMicrosecondsMinimum: 10_000_000,
		perBlockCascadeToControlMaximum: { numerator: 21, denominator: 20 },
		twoBlockMedian: "arithmetic-mean-of-the-two-block-values",
	},
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_GATE_EVIDENCE_CONTRACT = {
	observationConstruction: "runner-reconstructs-from-admitted-allocation-and-seal-evidence-only",
	callerSuppliedScientificPassBooleansAllowed: false,
	metricEvidence: "count-exact-ir-and-object-byte-anchor-matches",
	verifierEvidence: "count-terminal-passed-canonical-one-task-verifiers",
	selectionEvidence: "derive-from-each-cascade-arms-own-four-fresh-accepted-blowfish-ir-values",
	controlOracleEvidence: "derive-frontier-and-champion-from-that-blocks-eight-fresh-control-measurements",
	resourceEvidence: "exact-dot-zero-accounting-and-host-monotonic-safe-integer-microseconds",
} as const;

export interface CompilerGymProxyCascadeResourceArmObservation {
	allocationCount: number;
	stepCpuSeconds: number;
	feedbackReadyWallMicros: number;
	acceptedExactMetricCount: number;
	expectedExactMetricCount: number;
	passedVerifierCount: number;
	expectedVerifierCount: number;
}

export interface CompilerGymProxyCascadeResourceBlockObservation {
	blockOrdinal: 1 | 2;
	apparatusValid: boolean;
	control: CompilerGymProxyCascadeResourceArmObservation & {
		oracleFrontierOrdinals: number[];
		oracleChampionOrdinal: number;
	};
	cascade: CompilerGymProxyCascadeResourceArmObservation & {
		selectedOrdinals: number[];
	};
}

export interface CompilerGymProxyCascadeResourceBlockGate {
	blockOrdinal: 1 | 2;
	apparatusValid: boolean;
	exactAllocationCounts: boolean;
	exactMetricsAndVerifiers: boolean;
	controlOracleExact: boolean;
	cascadePreservesOracle: boolean;
	stepCpuRatio: number;
	stepCpuAtLeastTwentyPercentLower: boolean;
	feedbackReadyWallRatio: number;
	feedbackReadyWallSavingMicros: number;
	cascadeNotMoreThanFivePercentSlower: boolean;
}

export interface CompilerGymProxyCascadeResourceGateResult {
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_PROTOCOL;
	blocks: CompilerGymProxyCascadeResourceBlockGate[];
	stepCpuRatioMedian: number;
	feedbackReadyWallRatioMedian: number;
	feedbackReadyWallSavingMicrosMedian: number;
	gates: {
		bothBlocksApparatusValid: boolean;
		exactMetricsVerifiersFrontierAndChampionPreserved: boolean;
		exactSixVersusEightAllocationsPerArm: boolean;
		eachBlockStepCpuAtLeastTwentyPercentLower: boolean;
		medianStepCpuAtLeastTwentyPercentLower: boolean;
		medianFeedbackReadyWallAtLeastTenPercentLower: boolean;
		medianFeedbackReadyWallAtLeastTenSecondsLower: boolean;
		neitherBlockCascadeMoreThanFivePercentSlower: boolean;
	};
	passed: boolean;
}

function exactJson(actual: unknown, expected: unknown, path: string): void {
	if (canonicalJson(toJsonValue(actual)) !== canonicalJson(toJsonValue(expected))) {
		throw new Error(`${path} differs from its frozen value`);
	}
}

function makeArm(input: {
	blockOrdinal: 1 | 2;
	arm: CompilerGymProxyCascadeResourceArm;
	armOrderPosition: 1 | 2;
	firstGlobalOrdinal: number;
	priorBarrier: number[];
}): CompilerGymProxyCascadeResourceArmPlan {
	const allocations: CompilerGymProxyCascadeResourceAllocationSpec[] = [];
	const rounds: CompilerGymProxyCascadeResourceRoundSpec[] = [];
	let priorBarrier = [...input.priorBarrier];
	const pushRound = (
		stage: CompilerGymProxyCascadeResourceStage,
		entries: ReadonlyArray<{
			candidateOrdinal: number | null;
			selectionRank?: 1 | 2;
			expectedCandidateOrdinal?: number;
			benchmarkId: typeof COMPILER_GYM_PROXY_CASCADE_BLOWFISH | typeof COMPILER_GYM_PROXY_CASCADE_BZIP2;
		}>,
	): void => {
		const roundOrdinal = rounds.length + 1;
		const concurrencyGroup = `block-${input.blockOrdinal}-${input.arm}-round-${roundOrdinal}`;
		const roundAllocationOrdinals: number[] = [];
		for (const entry of entries) {
			const globalAllocationOrdinal = input.firstGlobalOrdinal + allocations.length;
			allocations.push({
				globalAllocationOrdinal,
				blockOrdinal: input.blockOrdinal,
				arm: input.arm,
				armOrderPosition: input.armOrderPosition,
				armAllocationOrdinal: allocations.length + 1,
				stage,
				roundOrdinal,
				concurrencyGroup,
				candidateOrdinal: entry.candidateOrdinal,
				selectionRank: entry.selectionRank ?? null,
				expectedCandidateOrdinal: entry.expectedCandidateOrdinal ?? entry.candidateOrdinal!,
				candidateBinding:
					entry.candidateOrdinal === null
						? "derive-only-from-this-arms-four-fresh-accepted-blowfish-ir-values"
						: "frozen-source-ordinal",
				benchmarkId: entry.benchmarkId,
				dependsOnGlobalAllocationOrdinals: [...priorBarrier],
				measurementState: "fresh-online-never-reused",
			});
			roundAllocationOrdinals.push(globalAllocationOrdinal);
		}
		rounds.push({
			roundOrdinal,
			concurrencyGroup,
			allocationOrdinals: roundAllocationOrdinals,
			maximumConcurrency: entries.length as 1 | 2,
			barrierBeforeNextRound: true,
		});
		priorBarrier = roundAllocationOrdinals;
	};
	if (input.arm === "full-control") {
		for (const candidateOrdinal of COMPILER_GYM_PROXY_CASCADE_RESOURCE_CANDIDATE_ORDINALS) {
			pushRound("control-candidate-pair", [
				{ candidateOrdinal, benchmarkId: COMPILER_GYM_PROXY_CASCADE_BLOWFISH },
				{ candidateOrdinal, benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2 },
			]);
		}
		return {
			arm: input.arm,
			armOrderPosition: input.armOrderPosition,
			onlineAllocationCount: 8,
			rounds,
			allocations,
			feedbackReadyDefinition: "all-eight-control-measurements-terminal-and-admitted",
		};
	}
	for (const candidateOrdinal of COMPILER_GYM_PROXY_CASCADE_RESOURCE_CANDIDATE_ORDINALS) {
		pushRound("cascade-proxy-blowfish", [{ candidateOrdinal, benchmarkId: COMPILER_GYM_PROXY_CASCADE_BLOWFISH }]);
	}
	priorBarrier = allocations.map((allocation) => allocation.globalAllocationOrdinal);
	pushRound(
		"cascade-selected-bzip2",
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS.map((expectedCandidateOrdinal, index) => ({
			candidateOrdinal: null,
			selectionRank: (index + 1) as 1 | 2,
			expectedCandidateOrdinal,
			benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
		})),
	);
	return {
		arm: input.arm,
		armOrderPosition: input.armOrderPosition,
		onlineAllocationCount: 6,
		rounds,
		allocations,
		feedbackReadyDefinition: "four-proxy-measurements-plus-two-selected-bzip2-measurements-terminal-and-admitted",
	};
}

function constructCompilerGymProxyCascadeResourceBlockPlan(): CompilerGymProxyCascadeResourceBlockPlan {
	const blockOrders = [
		["full-control", "proxy-cascade"],
		["proxy-cascade", "full-control"],
	] as const;
	const blocks: CompilerGymProxyCascadeResourceBlockSpec[] = [];
	const allAllocations: CompilerGymProxyCascadeResourceAllocationSpec[] = [];
	let priorBarrier: number[] = [];
	for (let blockIndex = 0; blockIndex < blockOrders.length; blockIndex++) {
		const blockOrdinal = (blockIndex + 1) as 1 | 2;
		const armOrder = blockOrders[blockIndex]!;
		const arms: CompilerGymProxyCascadeResourceArmPlan[] = [];
		for (let armIndex = 0; armIndex < armOrder.length; armIndex++) {
			const arm = makeArm({
				blockOrdinal,
				arm: armOrder[armIndex]!,
				armOrderPosition: (armIndex + 1) as 1 | 2,
				firstGlobalOrdinal: allAllocations.length + 1,
				priorBarrier,
			});
			arms.push(arm);
			allAllocations.push(...arm.allocations);
			priorBarrier = [...arm.rounds.at(-1)!.allocationOrdinals];
		}
		blocks.push({ blockOrdinal, armOrder, arms, allocationCount: 14 });
	}
	return {
		protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_BLOCK_PLAN_PROTOCOL,
		blocks,
		allocations: allAllocations,
		candidateOrdinals: [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_CANDIDATE_ORDINALS],
		selectedOrdinals: [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS],
		blockCount: 2,
		controlArmCount: 2,
		cascadeArmCount: 2,
		controlAllocationsPerArm: 8,
		cascadeAllocationsPerArm: 6,
		totalFreshOnlineAllocations: 28,
		maximumConcurrentAllocations: 2,
		blocksRunSequentially: true,
		armsRunSequentiallyWithinBlock: true,
	};
}

export function buildCompilerGymProxyCascadeResourceBlockPlan(): CompilerGymProxyCascadeResourceBlockPlan {
	const plan = constructCompilerGymProxyCascadeResourceBlockPlan();
	assertCompilerGymProxyCascadeResourceBlockPlan(plan);
	return plan;
}

export function assertCompilerGymProxyCascadeResourceBlockPlan(plan: CompilerGymProxyCascadeResourceBlockPlan): void {
	exactJson(plan, constructCompilerGymProxyCascadeResourceBlockPlan(), "complete resource block plan");
	if (plan.allocations.length !== 28 || plan.blocks.length !== 2) {
		throw new Error("Resource screen must contain exactly two blocks and 28 allocations");
	}
	exactJson(
		plan.blocks.map((block) => block.armOrder),
		[
			["full-control", "proxy-cascade"],
			["proxy-cascade", "full-control"],
		],
		"resource block arm order",
	);
	if (
		new Set(plan.allocations.map((allocation) => allocation.globalAllocationOrdinal)).size !== 28 ||
		plan.allocations.some((allocation, index) => allocation.globalAllocationOrdinal !== index + 1)
	) {
		throw new Error("Resource screen allocation ordinals must be unique and contiguous");
	}
	for (const block of plan.blocks) {
		const control = block.arms.find((arm) => arm.arm === "full-control");
		const cascade = block.arms.find((arm) => arm.arm === "proxy-cascade");
		if (!control || !cascade || control.allocations.length !== 8 || cascade.allocations.length !== 6) {
			throw new Error("Resource screen block allocation counts drifted");
		}
		if (
			control.rounds.length !== 4 ||
			control.rounds.some((round) => round.allocationOrdinals.length !== 2) ||
			cascade.rounds.length !== 5 ||
			cascade.rounds.slice(0, 4).some((round) => round.allocationOrdinals.length !== 1) ||
			cascade.rounds[4]?.allocationOrdinals.length !== 2
		) {
			throw new Error("Resource screen round schedule drifted");
		}
	}
}

function safePositiveInteger(value: number, path: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive safe integer`);
}

function medianTwo(left: number, right: number): number {
	return (left + right) / 2;
}

function ratioAtMost(
	numerator: number,
	denominator: number,
	thresholdNumerator: number,
	thresholdDenominator: number,
): boolean {
	return BigInt(numerator) * BigInt(thresholdDenominator) <= BigInt(denominator) * BigInt(thresholdNumerator);
}

function medianOfTwoRatiosAtMost(input: {
	leftNumerator: number;
	leftDenominator: number;
	rightNumerator: number;
	rightDenominator: number;
	thresholdNumerator: number;
	thresholdDenominator: number;
}): boolean {
	const leftNumerator = BigInt(input.leftNumerator);
	const leftDenominator = BigInt(input.leftDenominator);
	const rightNumerator = BigInt(input.rightNumerator);
	const rightDenominator = BigInt(input.rightDenominator);
	return (
		BigInt(input.thresholdDenominator) * (leftNumerator * rightDenominator + rightNumerator * leftDenominator) <=
		BigInt(2 * input.thresholdNumerator) * leftDenominator * rightDenominator
	);
}

export function evaluateCompilerGymProxyCascadeResourceGate(
	observations: readonly CompilerGymProxyCascadeResourceBlockObservation[],
): CompilerGymProxyCascadeResourceGateResult {
	if (observations.length !== 2 || observations[0]?.blockOrdinal !== 1 || observations[1]?.blockOrdinal !== 2) {
		throw new Error("Resource screen gate requires ordered observations for blocks one and two");
	}
	const blocks = observations.map((observation): CompilerGymProxyCascadeResourceBlockGate => {
		for (const [armName, arm] of [
			["control", observation.control],
			["cascade", observation.cascade],
		] as const) {
			safePositiveInteger(arm.stepCpuSeconds, `block ${observation.blockOrdinal} ${armName} step CPU`);
			safePositiveInteger(arm.feedbackReadyWallMicros, `block ${observation.blockOrdinal} ${armName} wall`);
		}
		const exactAllocationCounts =
			observation.control.allocationCount === 8 && observation.cascade.allocationCount === 6;
		const exactMetricsAndVerifiers =
			observation.control.acceptedExactMetricCount === 8 &&
			observation.control.expectedExactMetricCount === 8 &&
			observation.cascade.acceptedExactMetricCount === 6 &&
			observation.cascade.expectedExactMetricCount === 6 &&
			observation.control.passedVerifierCount === 8 &&
			observation.control.expectedVerifierCount === 8 &&
			observation.cascade.passedVerifierCount === 6 &&
			observation.cascade.expectedVerifierCount === 6;
		const controlOracleExact =
			canonicalJson(toJsonValue(observation.control.oracleFrontierOrdinals)) ===
				canonicalJson(toJsonValue(COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS)) &&
			observation.control.oracleChampionOrdinal === COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL;
		const cascadePreservesOracle =
			canonicalJson(toJsonValue(observation.cascade.selectedOrdinals)) ===
				canonicalJson(toJsonValue(COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS)) &&
			observation.control.oracleFrontierOrdinals.every((ordinal) =>
				observation.cascade.selectedOrdinals.includes(ordinal),
			) &&
			observation.cascade.selectedOrdinals.includes(observation.control.oracleChampionOrdinal);
		const stepCpuRatio = observation.cascade.stepCpuSeconds / observation.control.stepCpuSeconds;
		const feedbackReadyWallRatio =
			observation.cascade.feedbackReadyWallMicros / observation.control.feedbackReadyWallMicros;
		return {
			blockOrdinal: observation.blockOrdinal,
			apparatusValid: observation.apparatusValid,
			exactAllocationCounts,
			exactMetricsAndVerifiers,
			controlOracleExact,
			cascadePreservesOracle,
			stepCpuRatio,
			stepCpuAtLeastTwentyPercentLower: ratioAtMost(
				observation.cascade.stepCpuSeconds,
				observation.control.stepCpuSeconds,
				4,
				5,
			),
			feedbackReadyWallRatio,
			feedbackReadyWallSavingMicros:
				observation.control.feedbackReadyWallMicros - observation.cascade.feedbackReadyWallMicros,
			cascadeNotMoreThanFivePercentSlower: ratioAtMost(
				observation.cascade.feedbackReadyWallMicros,
				observation.control.feedbackReadyWallMicros,
				21,
				20,
			),
		};
	});
	const stepCpuRatioMedian = medianTwo(blocks[0]!.stepCpuRatio, blocks[1]!.stepCpuRatio);
	const feedbackReadyWallRatioMedian = medianTwo(blocks[0]!.feedbackReadyWallRatio, blocks[1]!.feedbackReadyWallRatio);
	const feedbackReadyWallSavingMicrosMedian = medianTwo(
		blocks[0]!.feedbackReadyWallSavingMicros,
		blocks[1]!.feedbackReadyWallSavingMicros,
	);
	const blockOne = observations[0]!;
	const blockTwo = observations[1]!;
	const gates = {
		bothBlocksApparatusValid: blocks.every((block) => block.apparatusValid),
		exactMetricsVerifiersFrontierAndChampionPreserved: blocks.every(
			(block) => block.exactMetricsAndVerifiers && block.controlOracleExact && block.cascadePreservesOracle,
		),
		exactSixVersusEightAllocationsPerArm: blocks.every((block) => block.exactAllocationCounts),
		eachBlockStepCpuAtLeastTwentyPercentLower: blocks.every((block) => block.stepCpuAtLeastTwentyPercentLower),
		medianStepCpuAtLeastTwentyPercentLower: medianOfTwoRatiosAtMost({
			leftNumerator: blockOne.cascade.stepCpuSeconds,
			leftDenominator: blockOne.control.stepCpuSeconds,
			rightNumerator: blockTwo.cascade.stepCpuSeconds,
			rightDenominator: blockTwo.control.stepCpuSeconds,
			thresholdNumerator: 4,
			thresholdDenominator: 5,
		}),
		medianFeedbackReadyWallAtLeastTenPercentLower: medianOfTwoRatiosAtMost({
			leftNumerator: blockOne.cascade.feedbackReadyWallMicros,
			leftDenominator: blockOne.control.feedbackReadyWallMicros,
			rightNumerator: blockTwo.cascade.feedbackReadyWallMicros,
			rightDenominator: blockTwo.control.feedbackReadyWallMicros,
			thresholdNumerator: 9,
			thresholdDenominator: 10,
		}),
		medianFeedbackReadyWallAtLeastTenSecondsLower:
			BigInt(blocks[0]!.feedbackReadyWallSavingMicros) + BigInt(blocks[1]!.feedbackReadyWallSavingMicros) >=
			BigInt(20_000_000),
		neitherBlockCascadeMoreThanFivePercentSlower: blocks.every((block) => block.cascadeNotMoreThanFivePercentSlower),
	};
	return {
		protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_PROTOCOL,
		blocks,
		stepCpuRatioMedian,
		feedbackReadyWallRatioMedian,
		feedbackReadyWallSavingMicrosMedian,
		gates,
		passed: Object.values(gates).every(Boolean),
	};
}

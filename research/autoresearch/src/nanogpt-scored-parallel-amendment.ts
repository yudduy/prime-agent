import { sha256Json } from "./canonical-json.js";
import { NANOGPT_SCORED_AMENDMENT_SHA256 } from "./nanogpt-scored-amendment.js";
import {
	NANOGPT_SCORED_CONTRACT_ID,
	NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND,
	NANOGPT_SCORED_TRIAL_SEEDS,
} from "./nanogpt-scored-protocol.js";

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key));
		Object.freeze(value);
	}
	return value;
}

if (
	NANOGPT_SCORED_CONTRACT_ID !== "nanogpt-track3-scored-confirmatory-v1" ||
	NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND !== 3.27859 ||
	NANOGPT_SCORED_TRIAL_SEEDS.length !== 8 ||
	NANOGPT_SCORED_TRIAL_SEEDS.some((seed, index) => seed !== 0xc0ffee + index)
) {
	throw new Error("NanoGPT parallel amendment parent v1 scoring contract changed");
}

export const NANOGPT_SCORED_PARALLEL_AMENDMENT = deepFreeze({
	schemaVersion: 1,
	amendmentId: "prime-agent-autoresearch-nanogpt-scored-parallel-v2",
	frozenAt: "2026-08-30T08:25:00.000Z",
	parentV1: {
		contract: NANOGPT_SCORED_CONTRACT_ID,
		campaignAmendmentSha256: NANOGPT_SCORED_AMENDMENT_SHA256,
		bridgeMode: "score-1",
		bridgeRequiresAccepted: true,
		bridgeRequiresThresholdPassed: true,
		bridgeRequiredForModes: ["score-3", "replay-8"],
		bridgeForbiddenForModes: ["smoke-10"],
		numericMeasurementsReused: false,
	},
	v2Stages: {
		modes: ["smoke-10", "score-3", "replay-8"],
		v2SmokeRequiredBeforeScore3: true,
		exactSeeds: {
			"smoke-10": [NANOGPT_SCORED_TRIAL_SEEDS[0]],
			"score-3": NANOGPT_SCORED_TRIAL_SEEDS.slice(0, 3),
			"replay-8": [...NANOGPT_SCORED_TRIAL_SEEDS],
		},
		freshMeasurementRequiredPerStage: true,
		priorStageNumericMeasurementsReused: false,
		partialChildSetsAccepted: false,
	},
	launch: {
		cluster: "Stanford FarmShare",
		gpu: "NVIDIA L40S",
		gpusPerChild: 1,
		worldSizePerChild: 1,
		maxConcurrentChildren: 4,
		noRequeue: true,
	},
	schedulerEvidence: {
		rawSacctStateAndExitCodePreservedByteForByte: true,
		normalizedSuccessGate: {
			state: "COMPLETED",
			exitCode: "0:0",
		},
		receiptBindsRawSacctSha256: true,
	},
	aggregation: {
		order: "ascending-seed-index",
		lossEncoding: "decimal-9-and-integer-nanounits",
		nanounitsPerUnit: 1_000_000_000,
		thresholdDecimal: "3.278590000",
		thresholdNanounits: 3_278_590_000,
		comparison: "sum-loss-nanounits<trials*threshold-nanounits",
		measurementEncoding: {
			runtimeMsRounding: "half-even-to-nearest-integer",
			peakVramMbRounding: "ceil-to-whole-MiB",
		},
		hostAggregationSha256RequiredInVerifierEpoch: true,
	},
	basis: "Prospective v2 throughput amendment: retain a verified v1 score-1 only as a Boolean widening gate, require a new v2 smoke, rerun every 3/8-stage seed as a fresh one-GPU child, and aggregate only complete verifier-bound child sets.",
} as const);

export const NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256 = sha256Json(NANOGPT_SCORED_PARALLEL_AMENDMENT);

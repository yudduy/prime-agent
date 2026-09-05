import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	NANOGPT_BASELINE_SHA256,
	NANOGPT_BASELINE_TRAIN_STEPS,
	NANOGPT_CONTRACT_ID,
	NANOGPT_PROGRAM_SHA256,
	NANOGPT_SPEEDRUN_COMMIT,
} from "./nanogpt-contract.js";
import {
	NANOGPT_SCORED_PARALLEL_AMENDMENT,
	NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
} from "./nanogpt-scored-parallel-amendment.js";
import {
	NANOGPT_SCORED_CONTRACT_ID,
	NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND,
	NANOGPT_SCORED_TRIAL_SEEDS,
	type NanoGptScoredStaticEvidence,
} from "./nanogpt-scored-protocol.js";
import type { ArtifactRef } from "./types.js";

export const NANOGPT_SCORED_PARALLEL_CONTRACT_ID = "nanogpt-track3-scored-parallel-confirmatory-v2" as const;
export const NANOGPT_SCORED_PARALLEL_HANDLE_PREFIX = "nanogpt-scored-parallel-v2:" as const;
export const NANOGPT_SCORED_LOSS_NANOUNITS_PER_UNIT = 1_000_000_000 as const;
export const NANOGPT_SCORED_THRESHOLD_DECIMAL = "3.278590000" as const;
export const NANOGPT_SCORED_THRESHOLD_NANOUNITS = 3_278_590_000 as const;
export const NANOGPT_SCORED_MAX_PARALLEL_CHILDREN = 4 as const;

export type NanoGptScoredParallelMode = "smoke-10" | "score-3" | "replay-8";
export type NanoGptScoredParallelPriorMode = Exclude<NanoGptScoredParallelMode, "replay-8">;

export interface NanoGptScoredParallelPins {
	readonly staticEvaluatorSha256: string;
	readonly environmentSha256: string;
	readonly environmentSealSha256: string;
	readonly datasetManifestSha256: string;
	readonly parallelWorkerSha256: string;
	readonly baseWorkerSha256: string;
	readonly parallelTransportSha256: string;
	readonly hostAggregationSha256: string;
}

export interface NanoGptScoredV1ScoreOneBridge {
	readonly contract: typeof NANOGPT_SCORED_CONTRACT_ID;
	readonly mode: "score-1";
	readonly verifierEpoch: string;
	readonly stageIdentity: string;
	readonly requestDigest: string;
	readonly resultDigest: string;
	readonly receiptDigest: string;
	readonly candidateSha256: string;
	readonly trainSteps: number;
	readonly meanValidationLossExclusiveUpperBound: typeof NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND;
	readonly accepted: true;
	readonly thresholdPassed: true;
	readonly numericMeasurementsReused: false;
}

export interface NanoGptScoredParallelPriorStage {
	readonly mode: NanoGptScoredParallelPriorMode;
	readonly stageIdentity: string;
	readonly requestDigest: string;
	readonly resultDigest: string;
	readonly receiptDigest: string;
	readonly accepted: true;
	readonly thresholdPassed: true | null;
	readonly fullExactSet: true;
	readonly numericMeasurementsReused: false;
	readonly v1BridgeDigest: string | null;
}

export interface NanoGptScoredParallelChildSpecBody {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_PARALLEL_CONTRACT_ID;
	readonly verifierEpoch: string;
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly index: number;
	readonly seed: number;
	readonly effectiveTrainSteps: number;
	readonly candidateSha256: string;
}

export interface NanoGptScoredParallelChildSpec extends NanoGptScoredParallelChildSpecBody {
	readonly childSpecDigest: string;
}

export interface NanoGptScoredParallelLossEncoding {
	readonly decimalPlaces: 9;
	readonly nanounitsPerUnit: typeof NANOGPT_SCORED_LOSS_NANOUNITS_PER_UNIT;
	readonly rounding: "half-even";
	readonly thresholdDecimal: typeof NANOGPT_SCORED_THRESHOLD_DECIMAL;
	readonly thresholdNanounits: typeof NANOGPT_SCORED_THRESHOLD_NANOUNITS;
}

export interface NanoGptScoredParallelMeasurementEncoding {
	readonly runtimeMsRounding: "half-even-to-nearest-integer";
	readonly peakVramMbRounding: "ceil-to-whole-MiB";
}

export interface NanoGptScoredParallelStageRequestBody {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_PARALLEL_CONTRACT_ID;
	readonly verifierEpoch: string;
	readonly parallelAmendmentSha256: typeof NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256;
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly jobId: string;
	readonly manifestDigest: string;
	readonly branchId: string;
	readonly treatment: string;
	readonly candidatePatch: ArtifactRef;
	readonly staticEvidence: NanoGptScoredStaticEvidence;
	readonly benchmarkIds: readonly string[];
	readonly trials: 1 | 3 | 8;
	readonly seeds: readonly number[];
	readonly effectiveTrainSteps: number;
	readonly v1Bridge: NanoGptScoredV1ScoreOneBridge | null;
	readonly priorStage: NanoGptScoredParallelPriorStage | null;
	readonly children: readonly NanoGptScoredParallelChildSpec[];
	readonly launch: {
		readonly cluster: "Stanford FarmShare";
		readonly gpu: "NVIDIA L40S";
		readonly gpusPerChild: 1;
		readonly worldSizePerChild: 1;
		readonly maxConcurrentChildren: 1 | 3 | 4;
		readonly noRequeue: true;
		readonly jobDirectory: "fresh-per-child";
		readonly priorNumericMeasurementsReused: false;
	};
	readonly acceptance: {
		readonly thresholdNanounits: typeof NANOGPT_SCORED_THRESHOLD_NANOUNITS;
		readonly comparison: "sum-loss-nanounits<trials*threshold-nanounits";
		readonly partialChildrenAccepted: false;
		readonly recordTrialCount: 8;
		readonly recordRequiresStrictlyFewerStepsThan: typeof NANOGPT_BASELINE_TRAIN_STEPS;
	};
	readonly lossEncoding: NanoGptScoredParallelLossEncoding;
	readonly measurementEncoding: NanoGptScoredParallelMeasurementEncoding;
	readonly pins: NanoGptScoredParallelPins;
}

export interface NanoGptScoredParallelStageRequest extends NanoGptScoredParallelStageRequestBody {
	readonly requestDigest: string;
}

export interface NanoGptScoredParallelChildRequestBody {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_PARALLEL_CONTRACT_ID;
	readonly verifierEpoch: string;
	readonly parallelAmendmentSha256: typeof NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256;
	readonly stageIdentity: string;
	readonly stageRequestDigest: string;
	readonly childSpec: NanoGptScoredParallelChildSpecBody;
	readonly childSpecDigest: string;
	readonly candidatePatch: ArtifactRef;
	readonly staticEvidence: NanoGptScoredStaticEvidence;
	readonly launch: {
		readonly cluster: "Stanford FarmShare";
		readonly gpu: "NVIDIA L40S";
		readonly gpus: 1;
		readonly worldSize: 1;
		readonly noRequeue: true;
		readonly jobDirectory: "fresh-per-child";
	};
	readonly lossEncoding: NanoGptScoredParallelLossEncoding;
	readonly measurementEncoding: NanoGptScoredParallelMeasurementEncoding;
	readonly pins: NanoGptScoredParallelPins;
}

export interface NanoGptScoredParallelChildRequest extends NanoGptScoredParallelChildRequestBody {
	readonly childRequestDigest: string;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const V1_EPOCH_PATTERN = /^nanogpt-scored-v1-[0-9a-f]{24}$/;
const V2_EPOCH_PATTERN = /^nanogpt-scored-parallel-v2-[0-9a-f]{24}$/;
const MODES: readonly NanoGptScoredParallelMode[] = ["smoke-10", "score-3", "replay-8"];

const MODE_SPEC = {
	"smoke-10": { trials: 1, previous: null, maxConcurrentChildren: 1, scored: false },
	"score-3": { trials: 3, previous: "smoke-10", maxConcurrentChildren: 3, scored: true },
	"replay-8": { trials: 8, previous: "score-3", maxConcurrentChildren: 4, scored: true },
} as const;

const LOSS_ENCODING: NanoGptScoredParallelLossEncoding = {
	decimalPlaces: 9,
	nanounitsPerUnit: NANOGPT_SCORED_LOSS_NANOUNITS_PER_UNIT,
	rounding: "half-even",
	thresholdDecimal: NANOGPT_SCORED_THRESHOLD_DECIMAL,
	thresholdNanounits: NANOGPT_SCORED_THRESHOLD_NANOUNITS,
};

const MEASUREMENT_ENCODING: NanoGptScoredParallelMeasurementEncoding = {
	runtimeMsRounding: "half-even-to-nearest-integer",
	peakVramMbRounding: "ceil-to-whole-MiB",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const observed = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (observed.length !== wanted.length || observed.some((key, index) => key !== wanted[index])) {
		throw new Error(`${path} must contain exactly ${wanted.join(",")}`);
	}
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
	for (let index = 0; index < value.length; index++) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(++index);
			if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${path} must contain well-formed Unicode`);
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			throw new Error(`${path} must contain well-formed Unicode`);
		}
	}
	return value;
}

function integer(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
	return value;
}

function sha256(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!SHA256_PATTERN.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return parsed;
}

function isoTimestamp(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!parsed.endsWith("Z") || !Number.isFinite(Date.parse(parsed)))
		throw new Error(`${path} must be a UTC ISO timestamp`);
	return parsed;
}

function sameJson(left: unknown, right: unknown): boolean {
	return sha256Json(left) === sha256Json(right);
}

function assertPins(pins: NanoGptScoredParallelPins): void {
	const parsed = record(pins, "pins");
	exactKeys(
		parsed,
		[
			"staticEvaluatorSha256",
			"environmentSha256",
			"environmentSealSha256",
			"datasetManifestSha256",
			"parallelWorkerSha256",
			"baseWorkerSha256",
			"parallelTransportSha256",
			"hostAggregationSha256",
		],
		"pins",
	);
	for (const [key, value] of Object.entries(pins)) sha256(value, `pins.${key}`);
}

function verifyArtifact(value: ArtifactRef, path: string): void {
	const parsed = record(value, path);
	exactKeys(parsed, ["digest", "byteLength", "mediaType"], path);
	sha256(value.digest, `${path}.digest`);
	if (value.mediaType !== "text/x-diff" || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1) {
		throw new Error(`${path} must be a nonempty unified-diff artifact`);
	}
}

function verifyStaticEvidence(
	evidence: NanoGptScoredStaticEvidence,
	candidatePatch: ArtifactRef,
	pins: NanoGptScoredParallelPins,
): void {
	const parsed = record(evidence, "request.staticEvidence");
	exactKeys(
		parsed,
		[
			"contract",
			"repositoryCommit",
			"programSha256",
			"evaluatorSha256",
			"baselineSha256",
			"patchSha256",
			"candidateSha256",
			"trainSteps",
			"frozenSegmentSha256",
			"editableSegmentSha256",
		],
		"request.staticEvidence",
	);
	if (
		evidence.contract !== NANOGPT_CONTRACT_ID ||
		evidence.repositoryCommit !== NANOGPT_SPEEDRUN_COMMIT ||
		evidence.programSha256 !== NANOGPT_PROGRAM_SHA256 ||
		evidence.baselineSha256 !== NANOGPT_BASELINE_SHA256 ||
		evidence.evaluatorSha256 !== pins.staticEvaluatorSha256 ||
		evidence.patchSha256 !== candidatePatch.digest ||
		!Number.isSafeInteger(evidence.trainSteps) ||
		evidence.trainSteps < 1 ||
		evidence.trainSteps > NANOGPT_BASELINE_TRAIN_STEPS ||
		evidence.frozenSegmentSha256.length !== 4 ||
		evidence.editableSegmentSha256.length !== 3
	) {
		throw new Error("NanoGPT parallel static evidence changed");
	}
	for (const digest of [
		evidence.evaluatorSha256,
		evidence.candidateSha256,
		...evidence.frozenSegmentSha256,
		...evidence.editableSegmentSha256,
	]) {
		sha256(digest, "request.staticEvidence.digest");
	}
}

export function nanoGptScoredParallelTrials(mode: NanoGptScoredParallelMode): 1 | 3 | 8 {
	return MODE_SPEC[mode].trials;
}

export function nanoGptScoredParallelSeeds(mode: NanoGptScoredParallelMode): readonly number[] {
	return NANOGPT_SCORED_TRIAL_SEEDS.slice(0, nanoGptScoredParallelTrials(mode));
}

export function nanoGptScoredParallelBenchmarkIds(mode: NanoGptScoredParallelMode): readonly string[] {
	return nanoGptScoredParallelSeeds(mode).map(
		(seed) => `nanogpt/track3/parallel-v2/${mode}/seed-${seed.toString(16)}`,
	);
}

export function nanoGptScoredParallelVerifierEpoch(pins: NanoGptScoredParallelPins): string {
	assertPins(pins);
	return `nanogpt-scored-parallel-v2-${sha256Json({
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		parallelAmendmentSha256: NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
		staticContract: NANOGPT_CONTRACT_ID,
		programSha256: NANOGPT_PROGRAM_SHA256,
		speedrunCommit: NANOGPT_SPEEDRUN_COMMIT,
		seedSchedule: NANOGPT_SCORED_TRIAL_SEEDS,
		lossEncoding: LOSS_ENCODING,
		measurementEncoding: MEASUREMENT_ENCODING,
		pins,
	}).slice(0, 24)}`;
}

export function nanoGptScoredParallelStageIdentity(input: {
	readonly branchId: string;
	readonly treatment: string;
	readonly verifierEpoch: string;
	readonly candidatePatchSha256: string;
	readonly candidateSha256: string;
}): string {
	string(input.branchId, "stageIdentity.branchId");
	string(input.treatment, "stageIdentity.treatment");
	sha256(input.candidatePatchSha256, "stageIdentity.candidatePatchSha256");
	sha256(input.candidateSha256, "stageIdentity.candidateSha256");
	if (!V2_EPOCH_PATTERN.test(input.verifierEpoch)) throw new Error("Stage identity requires the v2 verifier epoch");
	return sha256Json({ contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID, ...input });
}

function buildChildSpec(
	request: Pick<
		NanoGptScoredParallelStageRequestBody,
		"verifierEpoch" | "stageIdentity" | "mode" | "effectiveTrainSteps" | "staticEvidence"
	>,
	index: number,
	seed: number,
): NanoGptScoredParallelChildSpec {
	const body: NanoGptScoredParallelChildSpecBody = {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		verifierEpoch: request.verifierEpoch,
		stageIdentity: request.stageIdentity,
		mode: request.mode,
		index,
		seed,
		effectiveTrainSteps: request.effectiveTrainSteps,
		candidateSha256: request.staticEvidence.candidateSha256,
	};
	return { ...body, childSpecDigest: sha256Json(body) };
}

export function buildNanoGptScoredParallelStageRequest(
	input: Omit<
		NanoGptScoredParallelStageRequestBody,
		| "schemaVersion"
		| "contract"
		| "verifierEpoch"
		| "parallelAmendmentSha256"
		| "trials"
		| "seeds"
		| "effectiveTrainSteps"
		| "children"
		| "launch"
		| "acceptance"
		| "lossEncoding"
		| "measurementEncoding"
	>,
): NanoGptScoredParallelStageRequest {
	assertPins(input.pins);
	const verifierEpoch = nanoGptScoredParallelVerifierEpoch(input.pins);
	const trials = nanoGptScoredParallelTrials(input.mode);
	const seeds = nanoGptScoredParallelSeeds(input.mode);
	const effectiveTrainSteps = input.mode === "smoke-10" ? 10 : input.staticEvidence.trainSteps;
	const derived = { verifierEpoch, stageIdentity: input.stageIdentity, mode: input.mode, effectiveTrainSteps };
	const children = seeds.map((seed, index) =>
		buildChildSpec({ ...derived, staticEvidence: input.staticEvidence }, index, seed),
	);
	const body: NanoGptScoredParallelStageRequestBody = {
		...input,
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		verifierEpoch,
		parallelAmendmentSha256: NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
		trials,
		seeds,
		effectiveTrainSteps,
		children,
		launch: {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			gpusPerChild: 1,
			worldSizePerChild: 1,
			maxConcurrentChildren: MODE_SPEC[input.mode].maxConcurrentChildren,
			noRequeue: true,
			jobDirectory: "fresh-per-child",
			priorNumericMeasurementsReused: false,
		},
		acceptance: {
			thresholdNanounits: NANOGPT_SCORED_THRESHOLD_NANOUNITS,
			comparison: "sum-loss-nanounits<trials*threshold-nanounits",
			partialChildrenAccepted: false,
			recordTrialCount: 8,
			recordRequiresStrictlyFewerStepsThan: NANOGPT_BASELINE_TRAIN_STEPS,
		},
		lossEncoding: LOSS_ENCODING,
		measurementEncoding: MEASUREMENT_ENCODING,
	};
	const request = { ...body, requestDigest: sha256Json(body) };
	verifyNanoGptScoredParallelStageRequest(request);
	return request;
}

function verifyV1Bridge(
	bridge: NanoGptScoredV1ScoreOneBridge,
	request: Pick<NanoGptScoredParallelStageRequest, "staticEvidence">,
): void {
	const parsed = record(bridge, "request.v1Bridge");
	exactKeys(
		parsed,
		[
			"contract",
			"mode",
			"verifierEpoch",
			"stageIdentity",
			"requestDigest",
			"resultDigest",
			"receiptDigest",
			"candidateSha256",
			"trainSteps",
			"meanValidationLossExclusiveUpperBound",
			"accepted",
			"thresholdPassed",
			"numericMeasurementsReused",
		],
		"request.v1Bridge",
	);
	if (
		bridge.contract !== NANOGPT_SCORED_CONTRACT_ID ||
		bridge.mode !== "score-1" ||
		!V1_EPOCH_PATTERN.test(bridge.verifierEpoch) ||
		bridge.candidateSha256 !== request.staticEvidence.candidateSha256 ||
		bridge.trainSteps !== request.staticEvidence.trainSteps ||
		bridge.meanValidationLossExclusiveUpperBound !== NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND ||
		bridge.accepted !== true ||
		bridge.thresholdPassed !== true ||
		bridge.numericMeasurementsReused !== false
	) {
		throw new Error("NanoGPT parallel v1 score-1 bridge is not an exact passing gate");
	}
	for (const [key, digest] of [
		["stageIdentity", bridge.stageIdentity],
		["requestDigest", bridge.requestDigest],
		["resultDigest", bridge.resultDigest],
		["receiptDigest", bridge.receiptDigest],
		["candidateSha256", bridge.candidateSha256],
	] as const) {
		sha256(digest, `request.v1Bridge.${key}`);
	}
}

function verifyPriorStage(prior: NanoGptScoredParallelPriorStage, request: NanoGptScoredParallelStageRequest): void {
	const parsed = record(prior, "request.priorStage");
	exactKeys(
		parsed,
		[
			"mode",
			"stageIdentity",
			"requestDigest",
			"resultDigest",
			"receiptDigest",
			"accepted",
			"thresholdPassed",
			"fullExactSet",
			"numericMeasurementsReused",
			"v1BridgeDigest",
		],
		"request.priorStage",
	);
	const expectedMode = MODE_SPEC[request.mode].previous;
	const expectedThreshold = expectedMode === "smoke-10" ? null : true;
	const expectedBridgeDigest = expectedMode === "score-3" ? sha256Json(request.v1Bridge) : null;
	if (
		prior.mode !== expectedMode ||
		prior.stageIdentity !== request.stageIdentity ||
		prior.accepted !== true ||
		prior.thresholdPassed !== expectedThreshold ||
		prior.fullExactSet !== true ||
		prior.numericMeasurementsReused !== false ||
		prior.v1BridgeDigest !== expectedBridgeDigest
	) {
		throw new Error("NanoGPT parallel prior stage is not the exact accepted v2 predecessor");
	}
	for (const [key, digest] of [
		["stageIdentity", prior.stageIdentity],
		["requestDigest", prior.requestDigest],
		["resultDigest", prior.resultDigest],
		["receiptDigest", prior.receiptDigest],
	] as const) {
		sha256(digest, `request.priorStage.${key}`);
	}
}

export function verifyNanoGptScoredParallelStageRequest(request: NanoGptScoredParallelStageRequest): void {
	const parsed = record(request, "request");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"verifierEpoch",
			"parallelAmendmentSha256",
			"stageIdentity",
			"mode",
			"jobId",
			"manifestDigest",
			"branchId",
			"treatment",
			"candidatePatch",
			"staticEvidence",
			"benchmarkIds",
			"trials",
			"seeds",
			"effectiveTrainSteps",
			"v1Bridge",
			"priorStage",
			"children",
			"launch",
			"acceptance",
			"lossEncoding",
			"measurementEncoding",
			"pins",
			"requestDigest",
		],
		"request",
	);
	const { requestDigest, ...body } = request;
	if (
		request.schemaVersion !== 1 ||
		request.contract !== NANOGPT_SCORED_PARALLEL_CONTRACT_ID ||
		request.parallelAmendmentSha256 !== NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256 ||
		!MODES.includes(request.mode)
	) {
		throw new Error("NanoGPT parallel request identity changed");
	}
	sha256(requestDigest, "request.requestDigest");
	if (sha256Json(body) !== requestDigest) throw new Error("NanoGPT parallel request digest mismatch");
	assertPins(request.pins);
	if (request.verifierEpoch !== nanoGptScoredParallelVerifierEpoch(request.pins)) {
		throw new Error("NanoGPT parallel verifier epoch mismatch");
	}
	if (
		request.stageIdentity !==
		nanoGptScoredParallelStageIdentity({
			branchId: request.branchId,
			treatment: request.treatment,
			verifierEpoch: request.verifierEpoch,
			candidatePatchSha256: request.candidatePatch.digest,
			candidateSha256: request.staticEvidence.candidateSha256,
		})
	) {
		throw new Error("NanoGPT parallel stage identity mismatch");
	}
	for (const [value, path] of [
		[request.jobId, "request.jobId"],
		[request.branchId, "request.branchId"],
		[request.treatment, "request.treatment"],
	] as const) {
		string(value, path);
	}
	sha256(request.manifestDigest, "request.manifestDigest");
	verifyArtifact(request.candidatePatch, "request.candidatePatch");
	verifyStaticEvidence(request.staticEvidence, request.candidatePatch, request.pins);
	const expectedTrials = nanoGptScoredParallelTrials(request.mode);
	const expectedSeeds = nanoGptScoredParallelSeeds(request.mode);
	const expectedEffectiveSteps = request.mode === "smoke-10" ? 10 : request.staticEvidence.trainSteps;
	const expectedChildren = expectedSeeds.map((seed, index) => buildChildSpec(request, index, seed));
	if (
		request.trials !== expectedTrials ||
		request.effectiveTrainSteps !== expectedEffectiveSteps ||
		!sameJson(request.seeds, expectedSeeds) ||
		!sameJson(request.benchmarkIds, nanoGptScoredParallelBenchmarkIds(request.mode)) ||
		!sameJson(request.children, expectedChildren)
	) {
		throw new Error("NanoGPT parallel request child/seed/mode set changed");
	}
	if (request.mode === "smoke-10") {
		if (request.v1Bridge !== null || request.priorStage !== null) {
			throw new Error("NanoGPT v2 smoke must be fresh and cannot consume v1 or v2 measurements");
		}
	} else {
		if (request.v1Bridge === null || request.priorStage === null) {
			throw new Error("NanoGPT parallel widening requires its exact v1 gate and v2 predecessor");
		}
		verifyV1Bridge(request.v1Bridge, request);
		verifyPriorStage(request.priorStage, request);
	}
	const launch = record(request.launch, "request.launch");
	exactKeys(
		launch,
		[
			"cluster",
			"gpu",
			"gpusPerChild",
			"worldSizePerChild",
			"maxConcurrentChildren",
			"noRequeue",
			"jobDirectory",
			"priorNumericMeasurementsReused",
		],
		"request.launch",
	);
	const acceptance = record(request.acceptance, "request.acceptance");
	exactKeys(
		acceptance,
		[
			"thresholdNanounits",
			"comparison",
			"partialChildrenAccepted",
			"recordTrialCount",
			"recordRequiresStrictlyFewerStepsThan",
		],
		"request.acceptance",
	);
	if (
		request.launch.cluster !== "Stanford FarmShare" ||
		request.launch.gpu !== "NVIDIA L40S" ||
		request.launch.gpusPerChild !== 1 ||
		request.launch.worldSizePerChild !== 1 ||
		request.launch.maxConcurrentChildren !== MODE_SPEC[request.mode].maxConcurrentChildren ||
		request.launch.noRequeue !== true ||
		request.launch.jobDirectory !== "fresh-per-child" ||
		request.launch.priorNumericMeasurementsReused !== false ||
		request.acceptance.thresholdNanounits !== NANOGPT_SCORED_THRESHOLD_NANOUNITS ||
		request.acceptance.comparison !== "sum-loss-nanounits<trials*threshold-nanounits" ||
		request.acceptance.partialChildrenAccepted !== false ||
		request.acceptance.recordTrialCount !== 8 ||
		request.acceptance.recordRequiresStrictlyFewerStepsThan !== NANOGPT_BASELINE_TRAIN_STEPS ||
		!sameJson(request.lossEncoding, LOSS_ENCODING) ||
		!sameJson(request.measurementEncoding, MEASUREMENT_ENCODING)
	) {
		throw new Error("NanoGPT parallel launch, threshold, or loss encoding changed");
	}
}

export function buildNanoGptScoredParallelChildRequest(
	stage: NanoGptScoredParallelStageRequest,
	index: number,
): NanoGptScoredParallelChildRequest {
	verifyNanoGptScoredParallelStageRequest(stage);
	const selected = stage.children[index];
	if (!selected) throw new Error("NanoGPT parallel child index is outside the exact stage set");
	const { childSpecDigest, ...childSpec } = selected;
	const body: NanoGptScoredParallelChildRequestBody = {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		verifierEpoch: stage.verifierEpoch,
		parallelAmendmentSha256: NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
		stageIdentity: stage.stageIdentity,
		stageRequestDigest: stage.requestDigest,
		childSpec,
		childSpecDigest,
		candidatePatch: stage.candidatePatch,
		staticEvidence: stage.staticEvidence,
		launch: {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			gpus: 1,
			worldSize: 1,
			noRequeue: true,
			jobDirectory: "fresh-per-child",
		},
		lossEncoding: LOSS_ENCODING,
		measurementEncoding: MEASUREMENT_ENCODING,
		pins: stage.pins,
	};
	const request = { ...body, childRequestDigest: sha256Json(body) };
	verifyNanoGptScoredParallelChildRequest(request, stage);
	return request;
}

export function verifyNanoGptScoredParallelChildRequest(
	request: NanoGptScoredParallelChildRequest,
	stage: NanoGptScoredParallelStageRequest,
): void {
	verifyNanoGptScoredParallelStageRequest(stage);
	const parsed = record(request, "childRequest");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"verifierEpoch",
			"parallelAmendmentSha256",
			"stageIdentity",
			"stageRequestDigest",
			"childSpec",
			"childSpecDigest",
			"candidatePatch",
			"staticEvidence",
			"launch",
			"lossEncoding",
			"measurementEncoding",
			"pins",
			"childRequestDigest",
		],
		"childRequest",
	);
	const { childRequestDigest, ...body } = request;
	sha256(childRequestDigest, "childRequest.childRequestDigest");
	if (sha256Json(body) !== childRequestDigest) throw new Error("NanoGPT parallel child request digest mismatch");
	const childSpecRecord = record(request.childSpec, "childRequest.childSpec");
	exactKeys(
		childSpecRecord,
		[
			"schemaVersion",
			"contract",
			"verifierEpoch",
			"stageIdentity",
			"mode",
			"index",
			"seed",
			"effectiveTrainSteps",
			"candidateSha256",
		],
		"childRequest.childSpec",
	);
	const expected = stage.children[request.childSpec.index];
	if (
		request.schemaVersion !== 1 ||
		request.contract !== NANOGPT_SCORED_PARALLEL_CONTRACT_ID ||
		request.verifierEpoch !== stage.verifierEpoch ||
		request.parallelAmendmentSha256 !== NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256 ||
		request.stageIdentity !== stage.stageIdentity ||
		request.stageRequestDigest !== stage.requestDigest ||
		request.childSpecDigest !== sha256Json(request.childSpec) ||
		!expected ||
		expected.childSpecDigest !== request.childSpecDigest ||
		!sameJson({ ...request.childSpec, childSpecDigest: request.childSpecDigest }, expected) ||
		!sameJson(request.candidatePatch, stage.candidatePatch) ||
		!sameJson(request.staticEvidence, stage.staticEvidence) ||
		!sameJson(request.pins, stage.pins) ||
		!sameJson(request.lossEncoding, LOSS_ENCODING) ||
		!sameJson(request.measurementEncoding, MEASUREMENT_ENCODING)
	) {
		throw new Error("NanoGPT parallel child request is not bound to the exact stage child");
	}
	const launch = record(request.launch, "childRequest.launch");
	exactKeys(launch, ["cluster", "gpu", "gpus", "worldSize", "noRequeue", "jobDirectory"], "childRequest.launch");
	if (
		request.launch.cluster !== "Stanford FarmShare" ||
		request.launch.gpu !== "NVIDIA L40S" ||
		request.launch.gpus !== 1 ||
		request.launch.worldSize !== 1 ||
		request.launch.noRequeue !== true ||
		request.launch.jobDirectory !== "fresh-per-child"
	) {
		throw new Error("NanoGPT parallel child launch contract changed");
	}
}

export interface NanoGptScoredParallelChildWorkerResult {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_PARALLEL_CONTRACT_ID;
	readonly ok: boolean;
	readonly verifierEpoch: string;
	readonly stageIdentity: string;
	readonly stageRequestDigest: string;
	readonly childRequestDigest: string;
	readonly childSpecDigest: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly index: number;
	readonly seed: number;
	readonly candidateSha256: string;
	readonly effectiveTrainSteps: number;
	readonly validationLossDecimal: string | null;
	readonly validationLossNanounits: number | null;
	readonly optimizerSteps: number | null;
	readonly peakVramMb: number | null;
	readonly runtimeMs: number;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly observed: {
		readonly slurmJobId: string;
		readonly hardware: {
			readonly cluster: "Stanford FarmShare";
			readonly gpu: "NVIDIA L40S";
			readonly gpuUuid: string;
			readonly gpus: 1;
			readonly worldSize: 1;
		};
		readonly log: {
			readonly remoteName: string;
			readonly byteLength: number;
			readonly sha256: string;
		};
	};
	readonly execution: {
		readonly cleanJobDirectory: true;
		readonly freshCandidateMaterialization: true;
		readonly priorMeasurementsReused: false;
	};
	readonly sourceIntegrity: {
		readonly preRunCandidateSha256: string;
		readonly postRunCandidateSha256: string;
	};
	readonly pins: NanoGptScoredParallelPins;
	readonly failure: { readonly kind: string; readonly message: string } | null;
}

export interface NanoGptScoredParallelSchedulerResources {
	readonly cpus: number;
	readonly gpus: number;
	readonly memoryMiB: number;
}

export interface NanoGptScoredParallelSchedulerEvidence {
	readonly raw: {
		readonly jobIdRaw: string;
		readonly jobName: string;
		readonly workDir: string;
		readonly state: string;
		readonly exitCode: string;
		readonly submit: string;
		readonly start: string;
		readonly end: string;
		readonly elapsedRaw: string;
		readonly allocTres: string;
		readonly reqTres: string;
	};
	readonly normalized: {
		readonly state: "COMPLETED";
		readonly exitCode: "0:0";
		readonly submitAt: string;
		readonly startAt: string;
		readonly endAt: string;
		readonly elapsedSeconds: number;
		readonly queueWaitMs: number;
		readonly runtimeMs: number;
		readonly requested: NanoGptScoredParallelSchedulerResources;
		readonly allocated: NanoGptScoredParallelSchedulerResources;
	};
}

export interface NanoGptScoredParallelArchiveEvidence {
	readonly canonicalManifest: string;
	readonly manifestByteLength: number;
	readonly manifestSha256: string;
	readonly log: {
		readonly remoteName: string;
		readonly byteLength: number;
		readonly sha256: string;
		readonly relativePath: string;
	};
}

export interface NanoGptScoredParallelChildCompletionBody {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_PARALLEL_CONTRACT_ID;
	readonly stageRequestDigest: string;
	readonly childRequestDigest: string;
	readonly childSpecDigest: string;
	readonly workerResult: NanoGptScoredParallelChildWorkerResult;
	readonly workerResultDigest: string;
	readonly jobScriptSha256: string;
	readonly scheduler: NanoGptScoredParallelSchedulerEvidence;
	readonly archive: NanoGptScoredParallelArchiveEvidence;
}

export interface NanoGptScoredParallelChildCompletion extends NanoGptScoredParallelChildCompletionBody {
	readonly completionDigest: string;
}

function nullableInteger(value: unknown, path: string): number | null {
	return value === null ? null : integer(value, path);
}

function parseLossDecimal(value: unknown, path: string): { readonly decimal: string; readonly nanounits: number } {
	const decimal = string(value, path);
	const match = /^([0-9]+)\.([0-9]{9})$/.exec(decimal);
	if (!match) throw new Error(`${path} must be a nonnegative fixed nine-decimal string`);
	const nanounits = Number(match[1]) * NANOGPT_SCORED_LOSS_NANOUNITS_PER_UNIT + Number(match[2]);
	if (!Number.isSafeInteger(nanounits) || nanounits < 1)
		throw new Error(`${path} is outside the exact nanounit range`);
	return { decimal, nanounits };
}

function parsePins(value: unknown, path: string): NanoGptScoredParallelPins {
	const parsed = record(value, path);
	exactKeys(
		parsed,
		[
			"staticEvaluatorSha256",
			"environmentSha256",
			"environmentSealSha256",
			"datasetManifestSha256",
			"parallelWorkerSha256",
			"baseWorkerSha256",
			"parallelTransportSha256",
			"hostAggregationSha256",
		],
		path,
	);
	const pins = {
		staticEvaluatorSha256: sha256(parsed.staticEvaluatorSha256, `${path}.staticEvaluatorSha256`),
		environmentSha256: sha256(parsed.environmentSha256, `${path}.environmentSha256`),
		environmentSealSha256: sha256(parsed.environmentSealSha256, `${path}.environmentSealSha256`),
		datasetManifestSha256: sha256(parsed.datasetManifestSha256, `${path}.datasetManifestSha256`),
		parallelWorkerSha256: sha256(parsed.parallelWorkerSha256, `${path}.parallelWorkerSha256`),
		baseWorkerSha256: sha256(parsed.baseWorkerSha256, `${path}.baseWorkerSha256`),
		parallelTransportSha256: sha256(parsed.parallelTransportSha256, `${path}.parallelTransportSha256`),
		hostAggregationSha256: sha256(parsed.hostAggregationSha256, `${path}.hostAggregationSha256`),
	};
	assertPins(pins);
	return pins;
}

export function parseNanoGptScoredParallelChildWorkerResult(
	value: unknown,
	childRequest: NanoGptScoredParallelChildRequest,
	stageRequest: NanoGptScoredParallelStageRequest,
): NanoGptScoredParallelChildWorkerResult {
	verifyNanoGptScoredParallelChildRequest(childRequest, stageRequest);
	const parsed = record(value, "childWorkerResult");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"ok",
			"verifierEpoch",
			"stageIdentity",
			"stageRequestDigest",
			"childRequestDigest",
			"childSpecDigest",
			"mode",
			"index",
			"seed",
			"candidateSha256",
			"effectiveTrainSteps",
			"validationLossDecimal",
			"validationLossNanounits",
			"optimizerSteps",
			"peakVramMb",
			"runtimeMs",
			"startedAt",
			"finishedAt",
			"observed",
			"execution",
			"sourceIntegrity",
			"pins",
			"failure",
		],
		"childWorkerResult",
	);
	if (typeof parsed.ok !== "boolean") throw new Error("childWorkerResult.ok must be Boolean");
	const startedAt = isoTimestamp(parsed.startedAt, "childWorkerResult.startedAt");
	const finishedAt = isoTimestamp(parsed.finishedAt, "childWorkerResult.finishedAt");
	const runtimeMs = integer(parsed.runtimeMs, "childWorkerResult.runtimeMs");
	if (runtimeMs < 0 || Date.parse(finishedAt) < Date.parse(startedAt)) {
		throw new Error("NanoGPT parallel child worker timing is invalid");
	}
	const observed = record(parsed.observed, "childWorkerResult.observed");
	exactKeys(observed, ["slurmJobId", "hardware", "log"], "childWorkerResult.observed");
	const hardware = record(observed.hardware, "childWorkerResult.observed.hardware");
	exactKeys(hardware, ["cluster", "gpu", "gpuUuid", "gpus", "worldSize"], "childWorkerResult.observed.hardware");
	const log = record(observed.log, "childWorkerResult.observed.log");
	exactKeys(log, ["remoteName", "byteLength", "sha256"], "childWorkerResult.observed.log");
	const remoteName = string(log.remoteName, "childWorkerResult.observed.log.remoteName");
	if (
		!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remoteName) ||
		remoteName.split("/").some((part) => ["", ".", ".."].includes(part))
	) {
		throw new Error("NanoGPT parallel child log name is unsafe");
	}
	const execution = record(parsed.execution, "childWorkerResult.execution");
	exactKeys(
		execution,
		["cleanJobDirectory", "freshCandidateMaterialization", "priorMeasurementsReused"],
		"childWorkerResult.execution",
	);
	const sourceIntegrity = record(parsed.sourceIntegrity, "childWorkerResult.sourceIntegrity");
	exactKeys(sourceIntegrity, ["preRunCandidateSha256", "postRunCandidateSha256"], "childWorkerResult.sourceIntegrity");
	const pins = parsePins(parsed.pins, "childWorkerResult.pins");
	let failure: NanoGptScoredParallelChildWorkerResult["failure"] = null;
	if (parsed.failure !== null) {
		const failureRecord = record(parsed.failure, "childWorkerResult.failure");
		exactKeys(failureRecord, ["kind", "message"], "childWorkerResult.failure");
		failure = {
			kind: string(failureRecord.kind, "childWorkerResult.failure.kind"),
			message: string(failureRecord.message, "childWorkerResult.failure.message"),
		};
	}
	const validationLossNanounits = nullableInteger(
		parsed.validationLossNanounits,
		"childWorkerResult.validationLossNanounits",
	);
	const optimizerSteps = nullableInteger(parsed.optimizerSteps, "childWorkerResult.optimizerSteps");
	const peakVramMb = nullableInteger(parsed.peakVramMb, "childWorkerResult.peakVramMb");
	let validationLossDecimal: string | null = null;
	if (parsed.validationLossDecimal !== null) {
		const loss = parseLossDecimal(parsed.validationLossDecimal, "childWorkerResult.validationLossDecimal");
		validationLossDecimal = loss.decimal;
		if (validationLossNanounits !== loss.nanounits) {
			throw new Error("NanoGPT parallel loss decimal and nanounits disagree");
		}
	}
	if (
		parsed.schemaVersion !== 1 ||
		parsed.contract !== NANOGPT_SCORED_PARALLEL_CONTRACT_ID ||
		parsed.verifierEpoch !== childRequest.verifierEpoch ||
		parsed.stageIdentity !== childRequest.stageIdentity ||
		parsed.stageRequestDigest !== stageRequest.requestDigest ||
		parsed.childRequestDigest !== childRequest.childRequestDigest ||
		parsed.childSpecDigest !== childRequest.childSpecDigest ||
		parsed.mode !== childRequest.childSpec.mode ||
		parsed.index !== childRequest.childSpec.index ||
		parsed.seed !== childRequest.childSpec.seed ||
		parsed.candidateSha256 !== childRequest.childSpec.candidateSha256 ||
		parsed.effectiveTrainSteps !== childRequest.childSpec.effectiveTrainSteps ||
		!/^\d+$/.test(string(observed.slurmJobId, "childWorkerResult.observed.slurmJobId")) ||
		hardware.cluster !== "Stanford FarmShare" ||
		hardware.gpu !== "NVIDIA L40S" ||
		string(hardware.gpuUuid, "childWorkerResult.observed.hardware.gpuUuid").length === 0 ||
		hardware.gpus !== 1 ||
		hardware.worldSize !== 1 ||
		execution.cleanJobDirectory !== true ||
		execution.freshCandidateMaterialization !== true ||
		execution.priorMeasurementsReused !== false ||
		sourceIntegrity.preRunCandidateSha256 !== childRequest.childSpec.candidateSha256 ||
		sourceIntegrity.postRunCandidateSha256 !== childRequest.childSpec.candidateSha256 ||
		!sameJson(pins, childRequest.pins)
	) {
		throw new Error("NanoGPT parallel child worker result is not bound to the exact child request");
	}
	const logByteLength = integer(log.byteLength, "childWorkerResult.observed.log.byteLength");
	const logSha256 = sha256(log.sha256, "childWorkerResult.observed.log.sha256");
	if (logByteLength < 0) throw new Error("NanoGPT parallel child log byte length is negative");
	if (parsed.ok) {
		if (
			failure !== null ||
			validationLossDecimal === null ||
			validationLossNanounits === null ||
			optimizerSteps !== childRequest.childSpec.effectiveTrainSteps ||
			peakVramMb === null ||
			peakVramMb < 0
		) {
			throw new Error("Successful NanoGPT parallel child result is incomplete");
		}
	} else if (
		failure === null ||
		(validationLossDecimal === null) !== (validationLossNanounits === null) ||
		(optimizerSteps !== null && optimizerSteps < 0) ||
		(peakVramMb !== null && peakVramMb < 0)
	) {
		throw new Error("Failed NanoGPT parallel child result has an inconsistent envelope");
	}
	return {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		ok: parsed.ok,
		verifierEpoch: childRequest.verifierEpoch,
		stageIdentity: childRequest.stageIdentity,
		stageRequestDigest: stageRequest.requestDigest,
		childRequestDigest: childRequest.childRequestDigest,
		childSpecDigest: childRequest.childSpecDigest,
		mode: childRequest.childSpec.mode,
		index: childRequest.childSpec.index,
		seed: childRequest.childSpec.seed,
		candidateSha256: childRequest.childSpec.candidateSha256,
		effectiveTrainSteps: childRequest.childSpec.effectiveTrainSteps,
		validationLossDecimal,
		validationLossNanounits,
		optimizerSteps,
		peakVramMb,
		runtimeMs,
		startedAt,
		finishedAt,
		observed: {
			slurmJobId: string(observed.slurmJobId, "childWorkerResult.observed.slurmJobId"),
			hardware: {
				cluster: "Stanford FarmShare",
				gpu: "NVIDIA L40S",
				gpuUuid: string(hardware.gpuUuid, "childWorkerResult.observed.hardware.gpuUuid"),
				gpus: 1,
				worldSize: 1,
			},
			log: { remoteName, byteLength: logByteLength, sha256: logSha256 },
		},
		execution: {
			cleanJobDirectory: true,
			freshCandidateMaterialization: true,
			priorMeasurementsReused: false,
		},
		sourceIntegrity: {
			preRunCandidateSha256: childRequest.childSpec.candidateSha256,
			postRunCandidateSha256: childRequest.childSpec.candidateSha256,
		},
		pins,
		failure,
	};
}

function parseTres(
	raw: string,
	path: string,
): { readonly cpus: number; readonly gpus: number; readonly memoryMiB: number } {
	let cpus: number | null = null;
	let gpus: number | null = null;
	let memoryMiB: number | null = null;
	for (const token of raw.split(",")) {
		const separator = token.indexOf("=");
		if (separator < 1) throw new Error(`${path} contains a malformed TRES token`);
		const key = token.slice(0, separator);
		const value = token.slice(separator + 1);
		if (key === "cpu") cpus = integer(Number(value), `${path}.cpu`);
		if (key === "gres/gpu" || key.startsWith("gres/gpu:")) gpus = integer(Number(value), `${path}.gpu`);
		if (key === "mem") {
			const match = /^([0-9]+)([KMGT])$/.exec(value);
			if (!match) throw new Error(`${path}.mem must use an exact binary K/M/G/T unit`);
			const amount = Number(match[1]);
			const multipliers = { K: 1 / 1_024, M: 1, G: 1_024, T: 1_048_576 } as const;
			memoryMiB = amount * multipliers[match[2] as keyof typeof multipliers];
			if (!Number.isSafeInteger(memoryMiB)) throw new Error(`${path}.mem does not resolve to whole MiB`);
		}
	}
	if (cpus === null || gpus === null || memoryMiB === null) throw new Error(`${path} lacks CPU, GPU, or memory`);
	return { cpus, gpus, memoryMiB };
}

export function nanoGptScoredParallelChildJobName(childRequestDigest: string): string {
	sha256(childRequestDigest, "childRequestDigest");
	return `pngp-${childRequestDigest.slice(0, 24)}`;
}

function parseScheduler(
	value: unknown,
	childRequest: NanoGptScoredParallelChildRequest,
	workerResult: NanoGptScoredParallelChildWorkerResult,
): NanoGptScoredParallelSchedulerEvidence {
	const parsed = record(value, "childCompletion.scheduler");
	exactKeys(parsed, ["raw", "normalized"], "childCompletion.scheduler");
	const raw = record(parsed.raw, "childCompletion.scheduler.raw");
	exactKeys(
		raw,
		[
			"jobIdRaw",
			"jobName",
			"workDir",
			"state",
			"exitCode",
			"submit",
			"start",
			"end",
			"elapsedRaw",
			"allocTres",
			"reqTres",
		],
		"childCompletion.scheduler.raw",
	);
	const normalized = record(parsed.normalized, "childCompletion.scheduler.normalized");
	exactKeys(
		normalized,
		[
			"state",
			"exitCode",
			"submitAt",
			"startAt",
			"endAt",
			"elapsedSeconds",
			"queueWaitMs",
			"runtimeMs",
			"requested",
			"allocated",
		],
		"childCompletion.scheduler.normalized",
	);
	const submitAt = isoTimestamp(normalized.submitAt, "childCompletion.scheduler.normalized.submitAt");
	const startAt = isoTimestamp(normalized.startAt, "childCompletion.scheduler.normalized.startAt");
	const endAt = isoTimestamp(normalized.endAt, "childCompletion.scheduler.normalized.endAt");
	const elapsedSeconds = integer(normalized.elapsedSeconds, "childCompletion.scheduler.normalized.elapsedSeconds");
	const queueWaitMs = integer(normalized.queueWaitMs, "childCompletion.scheduler.normalized.queueWaitMs");
	const runtimeMs = integer(normalized.runtimeMs, "childCompletion.scheduler.normalized.runtimeMs");
	const requested = record(normalized.requested, "childCompletion.scheduler.normalized.requested");
	const allocated = record(normalized.allocated, "childCompletion.scheduler.normalized.allocated");
	for (const [resources, path] of [
		[requested, "childCompletion.scheduler.normalized.requested"],
		[allocated, "childCompletion.scheduler.normalized.allocated"],
	] as const) {
		exactKeys(resources, ["cpus", "gpus", "memoryMiB"], path);
	}
	const requestedResources = {
		cpus: integer(requested.cpus, "childCompletion.scheduler.normalized.requested.cpus"),
		gpus: integer(requested.gpus, "childCompletion.scheduler.normalized.requested.gpus"),
		memoryMiB: integer(requested.memoryMiB, "childCompletion.scheduler.normalized.requested.memoryMiB"),
	};
	const allocatedResources = {
		cpus: integer(allocated.cpus, "childCompletion.scheduler.normalized.allocated.cpus"),
		gpus: integer(allocated.gpus, "childCompletion.scheduler.normalized.allocated.gpus"),
		memoryMiB: integer(allocated.memoryMiB, "childCompletion.scheduler.normalized.allocated.memoryMiB"),
	};
	const rawJobId = string(raw.jobIdRaw, "childCompletion.scheduler.raw.jobIdRaw");
	const rawJobName = string(raw.jobName, "childCompletion.scheduler.raw.jobName");
	const rawWorkDir = string(raw.workDir, "childCompletion.scheduler.raw.workDir");
	const rawState = string(raw.state, "childCompletion.scheduler.raw.state");
	const rawExitCode = string(raw.exitCode, "childCompletion.scheduler.raw.exitCode");
	const rawSubmit = string(raw.submit, "childCompletion.scheduler.raw.submit");
	const rawStart = string(raw.start, "childCompletion.scheduler.raw.start");
	const rawEnd = string(raw.end, "childCompletion.scheduler.raw.end");
	const rawElapsed = string(raw.elapsedRaw, "childCompletion.scheduler.raw.elapsedRaw");
	const rawAllocTres = string(raw.allocTres, "childCompletion.scheduler.raw.allocTres");
	const rawReqTres = string(raw.reqTres, "childCompletion.scheduler.raw.reqTres");
	const expectedResources = { cpus: 8, gpus: 1, memoryMiB: 32_768 };
	const normalizedRawState = rawState.trim().split(/[+ ]/, 1)[0]?.toUpperCase();
	const normalizedRawExitCode = rawExitCode.trim();
	if (
		rawJobId !== workerResult.observed.slurmJobId ||
		rawJobName !== nanoGptScoredParallelChildJobName(childRequest.childRequestDigest) ||
		!/^\/[A-Za-z0-9._/-]+$/.test(rawWorkDir) ||
		rawWorkDir.split("/").some((part, index) => index > 0 && ["", ".", ".."].includes(part)) ||
		normalizedRawState !== normalized.state ||
		normalizedRawExitCode !== normalized.exitCode ||
		normalized.state !== "COMPLETED" ||
		normalized.exitCode !== "0:0" ||
		!/^[0-9]+$/.test(rawElapsed) ||
		Number(rawElapsed) !== elapsedSeconds ||
		elapsedSeconds < 1 ||
		Date.parse(startAt) < Date.parse(submitAt) ||
		Date.parse(endAt) < Date.parse(startAt) ||
		queueWaitMs !== Date.parse(startAt) - Date.parse(submitAt) ||
		runtimeMs !== Date.parse(endAt) - Date.parse(startAt) ||
		runtimeMs !== elapsedSeconds * 1_000 ||
		!sameJson(requestedResources, expectedResources) ||
		allocatedResources.cpus < 1 ||
		allocatedResources.gpus !== 1 ||
		allocatedResources.memoryMiB < 1 ||
		!sameJson(parseTres(rawReqTres, "childCompletion.scheduler.raw.reqTres"), requestedResources) ||
		!sameJson(parseTres(rawAllocTres, "childCompletion.scheduler.raw.allocTres"), allocatedResources)
	) {
		throw new Error("NanoGPT parallel child scheduler evidence is not authoritative or exact");
	}
	return {
		raw: {
			jobIdRaw: rawJobId,
			jobName: rawJobName,
			workDir: rawWorkDir,
			state: rawState,
			exitCode: rawExitCode,
			submit: rawSubmit,
			start: rawStart,
			end: rawEnd,
			elapsedRaw: rawElapsed,
			allocTres: rawAllocTres,
			reqTres: rawReqTres,
		},
		normalized: {
			state: "COMPLETED",
			exitCode: "0:0",
			submitAt,
			startAt,
			endAt,
			elapsedSeconds,
			queueWaitMs,
			runtimeMs,
			requested: expectedResources,
			allocated: allocatedResources,
		},
	};
}

function archiveManifestSource(
	childRequest: NanoGptScoredParallelChildRequest,
	log: NanoGptScoredParallelChildWorkerResult["observed"]["log"],
): string {
	return `${canonicalJson(
		toJsonValue({
			schemaVersion: 1,
			childRequestDigest: childRequest.childRequestDigest,
			logs: [{ ...log, relativePath: `logs/${log.sha256}.log` }],
		}),
	)}\n`;
}

function parseArchive(
	value: unknown,
	childRequest: NanoGptScoredParallelChildRequest,
	workerResult: NanoGptScoredParallelChildWorkerResult,
): NanoGptScoredParallelArchiveEvidence {
	const parsed = record(value, "childCompletion.archive");
	exactKeys(parsed, ["canonicalManifest", "manifestByteLength", "manifestSha256", "log"], "childCompletion.archive");
	const log = record(parsed.log, "childCompletion.archive.log");
	exactKeys(log, ["remoteName", "byteLength", "sha256", "relativePath"], "childCompletion.archive.log");
	const archivedLog = {
		remoteName: string(log.remoteName, "childCompletion.archive.log.remoteName"),
		byteLength: integer(log.byteLength, "childCompletion.archive.log.byteLength"),
		sha256: sha256(log.sha256, "childCompletion.archive.log.sha256"),
		relativePath: string(log.relativePath, "childCompletion.archive.log.relativePath"),
	};
	const canonicalManifest = string(parsed.canonicalManifest, "childCompletion.archive.canonicalManifest");
	const expectedManifest = archiveManifestSource(childRequest, workerResult.observed.log);
	if (
		!sameJson(
			{ remoteName: archivedLog.remoteName, byteLength: archivedLog.byteLength, sha256: archivedLog.sha256 },
			workerResult.observed.log,
		) ||
		archivedLog.relativePath !== `logs/${archivedLog.sha256}.log` ||
		canonicalManifest !== expectedManifest ||
		parsed.manifestByteLength !== Buffer.byteLength(canonicalManifest) ||
		parsed.manifestSha256 !== sha256Text(canonicalManifest)
	) {
		throw new Error("NanoGPT parallel child archive evidence changed or is incomplete");
	}
	return {
		canonicalManifest,
		manifestByteLength: Buffer.byteLength(canonicalManifest),
		manifestSha256: sha256Text(canonicalManifest),
		log: archivedLog,
	};
}

export function buildNanoGptScoredParallelChildCompletion(
	input: Pick<NanoGptScoredParallelChildCompletionBody, "workerResult" | "jobScriptSha256" | "scheduler" | "archive">,
	childRequest: NanoGptScoredParallelChildRequest,
	stageRequest: NanoGptScoredParallelStageRequest,
): NanoGptScoredParallelChildCompletion {
	const workerResult = parseNanoGptScoredParallelChildWorkerResult(input.workerResult, childRequest, stageRequest);
	const body: NanoGptScoredParallelChildCompletionBody = {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		stageRequestDigest: stageRequest.requestDigest,
		childRequestDigest: childRequest.childRequestDigest,
		childSpecDigest: childRequest.childSpecDigest,
		workerResult,
		workerResultDigest: sha256Json(workerResult),
		jobScriptSha256: input.jobScriptSha256,
		scheduler: input.scheduler,
		archive: input.archive,
	};
	const completion = { ...body, completionDigest: sha256Json(body) };
	return parseNanoGptScoredParallelChildCompletion(completion, childRequest, stageRequest);
}

export function parseNanoGptScoredParallelChildCompletion(
	value: unknown,
	childRequest: NanoGptScoredParallelChildRequest,
	stageRequest: NanoGptScoredParallelStageRequest,
): NanoGptScoredParallelChildCompletion {
	const parsed = record(value, "childCompletion");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"stageRequestDigest",
			"childRequestDigest",
			"childSpecDigest",
			"workerResult",
			"workerResultDigest",
			"jobScriptSha256",
			"scheduler",
			"archive",
			"completionDigest",
		],
		"childCompletion",
	);
	const workerResult = parseNanoGptScoredParallelChildWorkerResult(parsed.workerResult, childRequest, stageRequest);
	const scheduler = parseScheduler(parsed.scheduler, childRequest, workerResult);
	const archive = parseArchive(parsed.archive, childRequest, workerResult);
	if (
		Date.parse(workerResult.startedAt) < Date.parse(scheduler.normalized.startAt) ||
		Date.parse(workerResult.finishedAt) > Date.parse(scheduler.normalized.endAt)
	) {
		throw new Error("NanoGPT parallel worker interval escaped its authoritative scheduler allocation");
	}
	const body: NanoGptScoredParallelChildCompletionBody = {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		stageRequestDigest: sha256(parsed.stageRequestDigest, "childCompletion.stageRequestDigest"),
		childRequestDigest: sha256(parsed.childRequestDigest, "childCompletion.childRequestDigest"),
		childSpecDigest: sha256(parsed.childSpecDigest, "childCompletion.childSpecDigest"),
		workerResult,
		workerResultDigest: sha256(parsed.workerResultDigest, "childCompletion.workerResultDigest"),
		jobScriptSha256: sha256(parsed.jobScriptSha256, "childCompletion.jobScriptSha256"),
		scheduler,
		archive,
	};
	if (
		parsed.schemaVersion !== 1 ||
		parsed.contract !== NANOGPT_SCORED_PARALLEL_CONTRACT_ID ||
		body.stageRequestDigest !== stageRequest.requestDigest ||
		body.childRequestDigest !== childRequest.childRequestDigest ||
		body.childSpecDigest !== childRequest.childSpecDigest ||
		body.workerResultDigest !== sha256Json(workerResult) ||
		parsed.completionDigest !== sha256Json(body)
	) {
		throw new Error("NanoGPT parallel child completion is not bound to its worker, scheduler, and archive evidence");
	}
	return { ...body, completionDigest: sha256(parsed.completionDigest, "childCompletion.completionDigest") };
}

export interface NanoGptScoredParallelAccounting {
	readonly wallClockMs: number;
	readonly queueWaitMsSum: number;
	readonly childRuntimeMsSum: number;
	readonly gpuMilliseconds: number;
	readonly gpuHours: {
		readonly numeratorGpuMilliseconds: number;
		readonly denominatorMillisecondsPerHour: 3_600_000;
	};
	readonly requested: {
		readonly children: 1 | 3 | 8;
		readonly maxConcurrentChildren: 1 | 3 | 4;
		readonly cpusPerChild: 8;
		readonly gpusPerChild: 1;
		readonly memoryMiBPerChild: 32_768;
		readonly worldSizePerChild: 1;
		readonly noRequeue: true;
	};
	readonly allocated: {
		readonly children: 1 | 3 | 8;
		readonly maxConcurrentChildrenObserved: number;
		readonly totalGpuAllocations: 1 | 3 | 8;
		readonly totalAllocatedCpus: number;
		readonly totalAllocatedMemoryMiB: number;
	};
}

export interface NanoGptScoredParallelStageResultBody {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_PARALLEL_CONTRACT_ID;
	readonly verifierEpoch: string;
	readonly parallelAmendmentSha256: typeof NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256;
	readonly stageIdentity: string;
	readonly requestDigest: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly candidateSha256: string;
	readonly trainSteps: number;
	readonly effectiveTrainSteps: number;
	readonly trials: 1 | 3 | 8;
	readonly seeds: readonly number[];
	readonly children: readonly NanoGptScoredParallelChildCompletion[];
	readonly lossSumNanounits: number;
	readonly thresholdPassed: true | false | null;
	readonly accepted: true;
	readonly fullExactSet: true;
	readonly priorNumericMeasurementsReused: false;
	readonly accounting: NanoGptScoredParallelAccounting;
	readonly pins: NanoGptScoredParallelPins;
}

export interface NanoGptScoredParallelStageResult extends NanoGptScoredParallelStageResultBody {
	readonly resultDigest: string;
}

export interface NanoGptScoredParallelReceiptChildEvidence {
	readonly index: number;
	readonly seed: number;
	readonly childSpecDigest: string;
	readonly childRequestDigest: string;
	readonly workerResultDigest: string;
	readonly completionDigest: string;
	readonly jobScriptSha256: string;
	readonly sacctRawSha256: string;
	readonly slurmJobId: string;
	readonly schedulerState: "COMPLETED";
	readonly schedulerExitCode: "0:0";
	readonly archiveManifestSha256: string;
	readonly logSha256: string;
	readonly logByteLength: number;
	readonly gpuUuid: string;
}

export interface NanoGptScoredParallelStageReceiptBody {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_PARALLEL_CONTRACT_ID;
	readonly verifierEpoch: string;
	readonly parallelAmendmentSha256: typeof NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256;
	readonly hostAggregationSha256: string;
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly requestDigest: string;
	readonly resultDigest: string;
	readonly candidateSha256: string;
	readonly accepted: true;
	readonly fullExactSet: true;
	readonly thresholdPassed: true | false | null;
	readonly v1BridgeDigest: string | null;
	readonly priorStageReceiptDigest: string | null;
	readonly accountingDigest: string;
	readonly children: readonly NanoGptScoredParallelReceiptChildEvidence[];
}

export interface NanoGptScoredParallelStageReceipt extends NanoGptScoredParallelStageReceiptBody {
	readonly receiptDigest: string;
}

function childCompletionIndex(value: unknown): number {
	const completion = record(value, "childCompletion");
	const worker = record(completion.workerResult, "childCompletion.workerResult");
	return integer(worker.index, "childCompletion.workerResult.index");
}

function maxObservedConcurrency(children: readonly NanoGptScoredParallelChildCompletion[]): number {
	const events = children.flatMap((child) => [
		{ time: Date.parse(child.scheduler.normalized.startAt), delta: 1 },
		{ time: Date.parse(child.scheduler.normalized.endAt), delta: -1 },
	]);
	events.sort((left, right) => left.time - right.time || left.delta - right.delta);
	let active = 0;
	let maximum = 0;
	for (const event of events) {
		active += event.delta;
		maximum = Math.max(maximum, active);
		if (active < 0) throw new Error("NanoGPT parallel child allocation intervals are inconsistent");
	}
	if (active !== 0) throw new Error("NanoGPT parallel child allocation intervals did not close");
	return maximum;
}

function deriveAccounting(
	request: NanoGptScoredParallelStageRequest,
	children: readonly NanoGptScoredParallelChildCompletion[],
): NanoGptScoredParallelAccounting {
	const submitted = children.map((child) => Date.parse(child.scheduler.normalized.submitAt));
	const ended = children.map((child) => Date.parse(child.scheduler.normalized.endAt));
	const queueWaitMsSum = children.reduce((sum, child) => sum + child.scheduler.normalized.queueWaitMs, 0);
	const childRuntimeMsSum = children.reduce((sum, child) => sum + child.scheduler.normalized.runtimeMs, 0);
	const gpuMilliseconds = children.reduce(
		(sum, child) => sum + child.scheduler.normalized.runtimeMs * child.scheduler.normalized.allocated.gpus,
		0,
	);
	const maxConcurrentChildrenObserved = maxObservedConcurrency(children);
	if (
		!Number.isSafeInteger(queueWaitMsSum) ||
		!Number.isSafeInteger(childRuntimeMsSum) ||
		!Number.isSafeInteger(gpuMilliseconds) ||
		maxConcurrentChildrenObserved < 1 ||
		maxConcurrentChildrenObserved > request.launch.maxConcurrentChildren
	) {
		throw new Error("NanoGPT parallel aggregate resource accounting is outside its exact bounds");
	}
	return {
		wallClockMs: Math.max(...ended) - Math.min(...submitted),
		queueWaitMsSum,
		childRuntimeMsSum,
		gpuMilliseconds,
		gpuHours: {
			numeratorGpuMilliseconds: gpuMilliseconds,
			denominatorMillisecondsPerHour: 3_600_000,
		},
		requested: {
			children: request.trials,
			maxConcurrentChildren: request.launch.maxConcurrentChildren,
			cpusPerChild: 8,
			gpusPerChild: 1,
			memoryMiBPerChild: 32_768,
			worldSizePerChild: 1,
			noRequeue: true,
		},
		allocated: {
			children: request.trials,
			maxConcurrentChildrenObserved,
			totalGpuAllocations: request.trials,
			totalAllocatedCpus: children.reduce((sum, child) => sum + child.scheduler.normalized.allocated.cpus, 0),
			totalAllocatedMemoryMiB: children.reduce(
				(sum, child) => sum + child.scheduler.normalized.allocated.memoryMiB,
				0,
			),
		},
	};
}

function parseExactCompletions(
	values: readonly unknown[],
	request: NanoGptScoredParallelStageRequest,
): readonly NanoGptScoredParallelChildCompletion[] {
	if (values.length !== request.trials)
		throw new Error("NanoGPT parallel aggregation requires the full exact child set");
	const sorted = [...values].sort((left, right) => childCompletionIndex(left) - childCompletionIndex(right));
	return sorted.map((value, index) => {
		if (childCompletionIndex(value) !== index) {
			throw new Error("NanoGPT parallel child set has a duplicate or missing stable seed index");
		}
		const childRequest = buildNanoGptScoredParallelChildRequest(request, index);
		const completion = parseNanoGptScoredParallelChildCompletion(value, childRequest, request);
		if (!completion.workerResult.ok) throw new Error("NanoGPT parallel aggregation refuses failed child results");
		return completion;
	});
}

function stageResultBody(
	request: NanoGptScoredParallelStageRequest,
	children: readonly NanoGptScoredParallelChildCompletion[],
): NanoGptScoredParallelStageResultBody {
	const lossSumNanounits = children.reduce((sum, child) => {
		const loss = child.workerResult.validationLossNanounits;
		if (loss === null) throw new Error("NanoGPT parallel successful child lacks integer loss evidence");
		return sum + loss;
	}, 0);
	if (!Number.isSafeInteger(lossSumNanounits))
		throw new Error("NanoGPT parallel loss sum exceeds exact integer range");
	const thresholdPassed =
		request.mode === "smoke-10" ? null : lossSumNanounits < request.trials * NANOGPT_SCORED_THRESHOLD_NANOUNITS;
	return {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		verifierEpoch: request.verifierEpoch,
		parallelAmendmentSha256: NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
		stageIdentity: request.stageIdentity,
		requestDigest: request.requestDigest,
		mode: request.mode,
		candidateSha256: request.staticEvidence.candidateSha256,
		trainSteps: request.staticEvidence.trainSteps,
		effectiveTrainSteps: request.effectiveTrainSteps,
		trials: request.trials,
		seeds: request.seeds,
		children,
		lossSumNanounits,
		thresholdPassed,
		accepted: true,
		fullExactSet: true,
		priorNumericMeasurementsReused: false,
		accounting: deriveAccounting(request, children),
		pins: request.pins,
	};
}

export function buildNanoGptScoredParallelStageResult(
	request: NanoGptScoredParallelStageRequest,
	completionValues: readonly unknown[],
): NanoGptScoredParallelStageResult {
	verifyNanoGptScoredParallelStageRequest(request);
	const body = stageResultBody(request, parseExactCompletions(completionValues, request));
	return { ...body, resultDigest: sha256Json(body) };
}

export function parseNanoGptScoredParallelStageResult(
	value: unknown,
	request: NanoGptScoredParallelStageRequest,
): NanoGptScoredParallelStageResult {
	verifyNanoGptScoredParallelStageRequest(request);
	const parsed = record(value, "stageResult");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"verifierEpoch",
			"parallelAmendmentSha256",
			"stageIdentity",
			"requestDigest",
			"mode",
			"candidateSha256",
			"trainSteps",
			"effectiveTrainSteps",
			"trials",
			"seeds",
			"children",
			"lossSumNanounits",
			"thresholdPassed",
			"accepted",
			"fullExactSet",
			"priorNumericMeasurementsReused",
			"accounting",
			"pins",
			"resultDigest",
		],
		"stageResult",
	);
	if (!Array.isArray(parsed.children)) throw new Error("stageResult.children must be an array");
	const expectedBody = stageResultBody(request, parseExactCompletions(parsed.children, request));
	const expected = { ...expectedBody, resultDigest: sha256Json(expectedBody) };
	if (!sameJson(value, expected))
		throw new Error("NanoGPT parallel stage result is not the exact derived aggregation");
	return expected;
}

function receiptBody(
	request: NanoGptScoredParallelStageRequest,
	result: NanoGptScoredParallelStageResult,
): NanoGptScoredParallelStageReceiptBody {
	return {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_PARALLEL_CONTRACT_ID,
		verifierEpoch: request.verifierEpoch,
		parallelAmendmentSha256: NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
		hostAggregationSha256: request.pins.hostAggregationSha256,
		stageIdentity: request.stageIdentity,
		mode: request.mode,
		requestDigest: request.requestDigest,
		resultDigest: result.resultDigest,
		candidateSha256: request.staticEvidence.candidateSha256,
		accepted: true,
		fullExactSet: true,
		thresholdPassed: result.thresholdPassed,
		v1BridgeDigest: request.v1Bridge === null ? null : sha256Json(request.v1Bridge),
		priorStageReceiptDigest: request.priorStage?.receiptDigest ?? null,
		accountingDigest: sha256Json(result.accounting),
		children: result.children.map((child) => ({
			index: child.workerResult.index,
			seed: child.workerResult.seed,
			childSpecDigest: child.childSpecDigest,
			childRequestDigest: child.childRequestDigest,
			workerResultDigest: child.workerResultDigest,
			completionDigest: child.completionDigest,
			jobScriptSha256: child.jobScriptSha256,
			sacctRawSha256: sha256Json(child.scheduler.raw),
			slurmJobId: child.scheduler.raw.jobIdRaw,
			schedulerState: "COMPLETED",
			schedulerExitCode: "0:0",
			archiveManifestSha256: child.archive.manifestSha256,
			logSha256: child.archive.log.sha256,
			logByteLength: child.archive.log.byteLength,
			gpuUuid: child.workerResult.observed.hardware.gpuUuid,
		})),
	};
}

export function buildNanoGptScoredParallelStageReceipt(
	request: NanoGptScoredParallelStageRequest,
	resultValue: unknown,
): NanoGptScoredParallelStageReceipt {
	const result = parseNanoGptScoredParallelStageResult(resultValue, request);
	const body = receiptBody(request, result);
	return { ...body, receiptDigest: sha256Json(body) };
}

export function parseNanoGptScoredParallelStageReceipt(
	value: unknown,
	request: NanoGptScoredParallelStageRequest,
	resultValue: unknown,
): NanoGptScoredParallelStageReceipt {
	const result = parseNanoGptScoredParallelStageResult(resultValue, request);
	const parsed = record(value, "stageReceipt");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"verifierEpoch",
			"parallelAmendmentSha256",
			"hostAggregationSha256",
			"stageIdentity",
			"mode",
			"requestDigest",
			"resultDigest",
			"candidateSha256",
			"accepted",
			"fullExactSet",
			"thresholdPassed",
			"v1BridgeDigest",
			"priorStageReceiptDigest",
			"accountingDigest",
			"children",
			"receiptDigest",
		],
		"stageReceipt",
	);
	const body = receiptBody(request, result);
	const expected = { ...body, receiptDigest: sha256Json(body) };
	if (!sameJson(value, expected)) throw new Error("NanoGPT parallel receipt does not bind every child completion");
	return expected;
}

export function nanoGptScoredParallelExternalHandle(requestDigest: string): string {
	sha256(requestDigest, "requestDigest");
	return `${NANOGPT_SCORED_PARALLEL_HANDLE_PREFIX}${requestDigest}`;
}

export function parseNanoGptScoredParallelExternalHandle(handle: string): string {
	if (!handle.startsWith(NANOGPT_SCORED_PARALLEL_HANDLE_PREFIX)) {
		throw new Error("Invalid NanoGPT parallel handle prefix");
	}
	return sha256(handle.slice(NANOGPT_SCORED_PARALLEL_HANDLE_PREFIX.length), "externalHandle.requestDigest");
}

export function nanoGptScoredParallelBoundaryConditions(pins: NanoGptScoredParallelPins): readonly string[] {
	return [
		`contract=${NANOGPT_SCORED_PARALLEL_CONTRACT_ID}`,
		`verifierEpoch=${nanoGptScoredParallelVerifierEpoch(pins)}`,
		`parallelAmendmentSha256=${NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256}`,
		`hostAggregationSha256=${pins.hostAggregationSha256}`,
		`seedScheduleSha256=${sha256Json(NANOGPT_SCORED_TRIAL_SEEDS)}`,
		`thresholdNanounits=${NANOGPT_SCORED_THRESHOLD_NANOUNITS}`,
		"comparison=sum-loss-nanounits<trials*threshold-nanounits",
		"children=max-four-one-L40S-world-size-one-no-requeue",
		"measurementReuse=forbidden",
	] as const;
}

if (
	NANOGPT_SCORED_PARALLEL_AMENDMENT.aggregation.thresholdNanounits !== NANOGPT_SCORED_THRESHOLD_NANOUNITS ||
	NANOGPT_SCORED_PARALLEL_AMENDMENT.launch.maxConcurrentChildren !== NANOGPT_SCORED_MAX_PARALLEL_CHILDREN ||
	!sameJson(NANOGPT_SCORED_PARALLEL_AMENDMENT.aggregation.measurementEncoding, MEASUREMENT_ENCODING)
) {
	throw new Error("NanoGPT parallel protocol and prospective amendment disagree");
}

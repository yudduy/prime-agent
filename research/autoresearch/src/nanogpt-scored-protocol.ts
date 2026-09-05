import { sha256Json } from "./canonical-json.js";
import {
	NANOGPT_BASELINE_SHA256,
	NANOGPT_BASELINE_TRAIN_STEPS,
	NANOGPT_CONTRACT_ID,
	NANOGPT_PROGRAM_SHA256,
	NANOGPT_SPEEDRUN_COMMIT,
} from "./nanogpt-contract.js";
import { NANOGPT_SCORED_AMENDMENT_SHA256 } from "./nanogpt-scored-amendment.js";
import type { ArtifactRef, EvaluationOutcome, TaskMeasurement } from "./types.js";

export const NANOGPT_SCORED_CONTRACT_ID = "nanogpt-track3-scored-confirmatory-v1" as const;
export const NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND = 3.27859 as const;
export const NANOGPT_SCORED_TRIAL_SEEDS = [
	0xc0ffee, 0xc0ffef, 0xc0fff0, 0xc0fff1, 0xc0fff2, 0xc0fff3, 0xc0fff4, 0xc0fff5,
] as const;
export const NANOGPT_SCORED_HANDLE_PREFIX = "nanogpt-scored-v1:" as const;

export type NanoGptScoredMode = "smoke-10" | "score-1" | "score-3" | "replay-8";
export type NanoGptScoredPreviousMode = Exclude<NanoGptScoredMode, "replay-8">;

export interface NanoGptScoredVerifierPins {
	readonly staticEvaluatorSha256: string;
	readonly environmentSha256: string;
	readonly environmentSealSha256: string;
	readonly datasetManifestSha256: string;
	readonly workerSha256: string;
	readonly transportSha256: string;
}

export interface NanoGptScoredStaticEvidence {
	readonly contract: typeof NANOGPT_CONTRACT_ID;
	readonly repositoryCommit: typeof NANOGPT_SPEEDRUN_COMMIT;
	readonly programSha256: typeof NANOGPT_PROGRAM_SHA256;
	readonly evaluatorSha256: string;
	readonly baselineSha256: typeof NANOGPT_BASELINE_SHA256;
	readonly patchSha256: string;
	readonly candidateSha256: string;
	readonly trainSteps: number;
	readonly frozenSegmentSha256: readonly string[];
	readonly editableSegmentSha256: readonly string[];
}

export interface NanoGptScoredPriorStage {
	readonly mode: NanoGptScoredPreviousMode;
	readonly jobId: string;
	readonly requestDigest: string;
	readonly resultDigest: string;
	readonly receiptDigest: string;
}

export interface NanoGptScoredRequestBody {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_CONTRACT_ID;
	readonly verifierEpoch: string;
	readonly campaignAmendmentSha256: typeof NANOGPT_SCORED_AMENDMENT_SHA256;
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredMode;
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
	readonly priorStage: NanoGptScoredPriorStage | null;
	readonly launch: {
		readonly cluster: "Stanford FarmShare";
		readonly gpu: "NVIDIA L40S";
		readonly gpus: 1;
		readonly worldSize: 1;
		readonly trialExecution: "sequential";
		readonly jobDirectory: "fresh-per-stage";
	};
	readonly acceptance: {
		readonly meanValidationLossExclusiveUpperBound: typeof NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND;
		readonly partialTrialsAccepted: false;
		readonly recordTrialCount: 8;
		readonly recordRequiresStrictlyFewerStepsThan: typeof NANOGPT_BASELINE_TRAIN_STEPS;
	};
	readonly pins: NanoGptScoredVerifierPins;
}

export interface NanoGptScoredRequest extends NanoGptScoredRequestBody {
	readonly requestDigest: string;
}

export interface NanoGptScoredWorkerTrial {
	readonly index: number;
	readonly seed: number;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly finalValidationLoss: number;
	readonly optimizerSteps: number;
	readonly peakVramMb: number;
	readonly runtimeMs: number;
	readonly logSha256: string;
}

export interface NanoGptScoredWorkerResult {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_CONTRACT_ID;
	readonly ok: boolean;
	readonly requestDigest: string;
	readonly externalHandle: string;
	readonly slurmJobId: string;
	readonly mode: NanoGptScoredMode;
	readonly candidateSha256: string;
	readonly trainSteps: number;
	readonly effectiveTrainSteps: number;
	readonly trials: readonly NanoGptScoredWorkerTrial[];
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly hardware: {
		readonly cluster: "Stanford FarmShare";
		readonly gpu: "NVIDIA L40S";
		readonly gpuUuid: string;
		readonly gpus: 1;
		readonly worldSize: 1;
	};
	readonly execution: {
		readonly trialExecution: "sequential";
		readonly cleanJobDirectory: true;
		readonly freshCandidateMaterialization: true;
		readonly priorMeasurementsReused: false;
	};
	readonly sourceIntegrity: {
		readonly preRunCandidateSha256: string;
		readonly postRunCandidateSha256: string;
	};
	readonly pins: NanoGptScoredVerifierPins;
	readonly failure: { readonly kind: string; readonly message: string } | null;
}

export interface NanoGptScoredAssessment {
	readonly result: NanoGptScoredWorkerResult;
	readonly resultDigest: string;
	readonly accepted: boolean;
	readonly meanValidationLoss: number | null;
	readonly thresholdPassed: boolean | null;
	readonly frontierEligible: boolean;
	readonly recordEligible: boolean;
	readonly tasks: readonly TaskMeasurement[];
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const MODE_SPEC = {
	"smoke-10": { trials: 1, scored: false, previous: null, budgetClass: "smoke" },
	"score-1": { trials: 1, scored: true, previous: "smoke-10", budgetClass: "screen" },
	"score-3": { trials: 3, scored: true, previous: "score-1", budgetClass: "screen" },
	"replay-8": { trials: 8, scored: true, previous: "score-3", budgetClass: "confirm" },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const observed = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (observed.length !== wanted.length || observed.some((key, index) => key !== wanted[index])) {
		throw new Error(`${path} must contain exactly ${wanted.join(",")}`);
	}
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				throw new Error(`${path} must contain only well-formed Unicode`);
			}
			index++;
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			throw new Error(`${path} must contain only well-formed Unicode`);
		}
	}
	return value;
}

function finiteNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
	return value;
}

function integer(value: unknown, path: string): number {
	const parsed = finiteNumber(value, path);
	if (!Number.isSafeInteger(parsed)) throw new Error(`${path} must be a safe integer`);
	return parsed;
}

function sha256(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!SHA256_PATTERN.test(parsed)) throw new Error(`${path} must be a SHA-256 digest`);
	return parsed;
}

function isoTimestamp(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!parsed.endsWith("Z") || !Number.isFinite(Date.parse(parsed))) {
		throw new Error(`${path} must be a UTC ISO timestamp`);
	}
	return parsed;
}

function sameJson(left: unknown, right: unknown): boolean {
	return sha256Json(left) === sha256Json(right);
}

function assertSha256Pins(pins: NanoGptScoredVerifierPins): void {
	const parsed = record(pins, "pins");
	exactKeys(
		parsed,
		[
			"staticEvaluatorSha256",
			"environmentSha256",
			"environmentSealSha256",
			"datasetManifestSha256",
			"workerSha256",
			"transportSha256",
		],
		"pins",
	);
	for (const [name, value] of Object.entries(pins)) sha256(value, `pins.${name}`);
}

export function nanoGptScoredTrials(mode: NanoGptScoredMode): 1 | 3 | 8 {
	return MODE_SPEC[mode].trials;
}

export function nanoGptScoredPreviousMode(mode: NanoGptScoredMode): NanoGptScoredPreviousMode | null {
	return MODE_SPEC[mode].previous;
}

export function nanoGptScoredSeeds(mode: NanoGptScoredMode): readonly number[] {
	return NANOGPT_SCORED_TRIAL_SEEDS.slice(0, nanoGptScoredTrials(mode));
}

export function nanoGptScoredBenchmarkIds(mode: NanoGptScoredMode): readonly string[] {
	const stage = mode === "smoke-10" ? "smoke-10" : mode === "replay-8" ? "replay-8" : "score";
	return nanoGptScoredSeeds(mode).map((seed) => `nanogpt/track3/${stage}/seed-${seed.toString(16)}`);
}

export function nanoGptScoredBudgetClass(mode: NanoGptScoredMode): "smoke" | "screen" | "confirm" {
	return MODE_SPEC[mode].budgetClass;
}

export function nanoGptScoredVerifierEpoch(pins: NanoGptScoredVerifierPins): string {
	assertSha256Pins(pins);
	return `nanogpt-scored-v1-${sha256Json({
		contract: NANOGPT_SCORED_CONTRACT_ID,
		campaignAmendmentSha256: NANOGPT_SCORED_AMENDMENT_SHA256,
		staticContract: NANOGPT_CONTRACT_ID,
		programSha256: NANOGPT_PROGRAM_SHA256,
		speedrunCommit: NANOGPT_SPEEDRUN_COMMIT,
		pins,
	}).slice(0, 24)}`;
}

export function nanoGptScoredBoundaryConditions(pins: NanoGptScoredVerifierPins): readonly string[] {
	return [
		`contract=${NANOGPT_SCORED_CONTRACT_ID}`,
		`verifierEpoch=${nanoGptScoredVerifierEpoch(pins)}`,
		`campaignAmendmentSha256=${NANOGPT_SCORED_AMENDMENT_SHA256}`,
		`seedScheduleSha256=${sha256Json(NANOGPT_SCORED_TRIAL_SEEDS)}`,
		`threshold=mean-loss<${NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND}`,
		"hardware=one-L40S-world-size-one-sequential-trials",
		`staticEvaluatorSha256=${pins.staticEvaluatorSha256}`,
		`environmentSha256=${pins.environmentSha256}`,
		`environmentSealSha256=${pins.environmentSealSha256}`,
		`datasetManifestSha256=${pins.datasetManifestSha256}`,
		`workerSha256=${pins.workerSha256}`,
		`transportSha256=${pins.transportSha256}`,
	] as const;
}

export function inferNanoGptScoredMode(benchmarkIds: readonly string[]): NanoGptScoredMode {
	for (const mode of ["smoke-10", "score-1", "score-3", "replay-8"] as const) {
		if (sameJson(benchmarkIds, nanoGptScoredBenchmarkIds(mode))) return mode;
	}
	throw new Error("NanoGPT benchmark IDs do not select one exact smoke/1/3/8 mode");
}

export function nanoGptScoredStageIdentity(input: {
	readonly branchId: string;
	readonly treatment: string;
	readonly verifierEpoch: string;
	readonly candidatePatchSha256: string;
	readonly candidateSha256: string;
}): string {
	sha256(input.candidatePatchSha256, "candidatePatchSha256");
	sha256(input.candidateSha256, "candidateSha256");
	if (!input.branchId.trim() || !input.treatment.trim())
		throw new Error("Stage identity requires branch and treatment");
	if (!/^nanogpt-scored-v1-[0-9a-f]{24}$/.test(input.verifierEpoch)) {
		throw new Error("Stage identity requires a NanoGPT scored verifier epoch");
	}
	return sha256Json({ contract: NANOGPT_SCORED_CONTRACT_ID, ...input });
}

export function buildNanoGptScoredRequest(
	input: Omit<
		NanoGptScoredRequestBody,
		| "schemaVersion"
		| "contract"
		| "verifierEpoch"
		| "campaignAmendmentSha256"
		| "trials"
		| "seeds"
		| "effectiveTrainSteps"
		| "launch"
		| "acceptance"
	>,
): NanoGptScoredRequest {
	assertSha256Pins(input.pins);
	const trials = nanoGptScoredTrials(input.mode);
	const body: NanoGptScoredRequestBody = {
		...input,
		schemaVersion: 1,
		contract: NANOGPT_SCORED_CONTRACT_ID,
		verifierEpoch: nanoGptScoredVerifierEpoch(input.pins),
		campaignAmendmentSha256: NANOGPT_SCORED_AMENDMENT_SHA256,
		trials,
		seeds: nanoGptScoredSeeds(input.mode),
		effectiveTrainSteps: input.mode === "smoke-10" ? 10 : input.staticEvidence.trainSteps,
		launch: {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			gpus: 1,
			worldSize: 1,
			trialExecution: "sequential",
			jobDirectory: "fresh-per-stage",
		},
		acceptance: {
			meanValidationLossExclusiveUpperBound: NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND,
			partialTrialsAccepted: false,
			recordTrialCount: 8,
			recordRequiresStrictlyFewerStepsThan: NANOGPT_BASELINE_TRAIN_STEPS,
		},
	};
	const request = { ...body, requestDigest: sha256Json(body) };
	verifyNanoGptScoredRequest(request);
	return request;
}

export function verifyNanoGptScoredRequest(request: NanoGptScoredRequest): void {
	const requestRecord = record(request, "request");
	exactKeys(
		requestRecord,
		[
			"schemaVersion",
			"contract",
			"verifierEpoch",
			"campaignAmendmentSha256",
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
			"priorStage",
			"launch",
			"acceptance",
			"pins",
			"requestDigest",
		],
		"request",
	);
	const { requestDigest, ...body } = request;
	if (request.schemaVersion !== 1 || request.contract !== NANOGPT_SCORED_CONTRACT_ID) {
		throw new Error("NanoGPT scored request identity changed");
	}
	sha256(requestDigest, "request.requestDigest");
	if (sha256Json(body) !== requestDigest) throw new Error("NanoGPT scored request digest mismatch");
	if (request.verifierEpoch !== nanoGptScoredVerifierEpoch(request.pins)) {
		throw new Error("NanoGPT scored request verifier epoch mismatch");
	}
	if (request.campaignAmendmentSha256 !== NANOGPT_SCORED_AMENDMENT_SHA256) {
		throw new Error("NanoGPT scored request campaign amendment mismatch");
	}
	if (
		request.stageIdentity !==
		nanoGptScoredStageIdentity({
			branchId: request.branchId,
			treatment: request.treatment,
			verifierEpoch: request.verifierEpoch,
			candidatePatchSha256: request.candidatePatch.digest,
			candidateSha256: request.staticEvidence.candidateSha256,
		})
	) {
		throw new Error("NanoGPT scored request stage identity mismatch");
	}
	for (const [value, path] of [
		[request.jobId, "request.jobId"],
		[request.branchId, "request.branchId"],
		[request.treatment, "request.treatment"],
	] as const) {
		string(value, path);
	}
	sha256(request.manifestDigest, "request.manifestDigest");
	const candidatePatch = record(request.candidatePatch, "request.candidatePatch");
	exactKeys(candidatePatch, ["digest", "byteLength", "mediaType"], "request.candidatePatch");
	sha256(request.candidatePatch.digest, "request.candidatePatch.digest");
	if (
		request.candidatePatch.mediaType !== "text/x-diff" ||
		!Number.isSafeInteger(request.candidatePatch.byteLength) ||
		request.candidatePatch.byteLength < 1
	) {
		throw new Error("NanoGPT scored request candidate artifact is invalid");
	}
	const evidence = request.staticEvidence;
	const evidenceRecord = record(evidence, "request.staticEvidence");
	exactKeys(
		evidenceRecord,
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
		evidence.patchSha256 !== request.candidatePatch.digest ||
		evidence.evaluatorSha256 !== request.pins.staticEvaluatorSha256 ||
		!Number.isSafeInteger(evidence.trainSteps) ||
		evidence.trainSteps < 1 ||
		evidence.trainSteps > NANOGPT_BASELINE_TRAIN_STEPS
	) {
		throw new Error("NanoGPT scored request static evidence is invalid");
	}
	for (const [path, digest] of [
		["evaluatorSha256", evidence.evaluatorSha256],
		["candidateSha256", evidence.candidateSha256],
		...evidence.frozenSegmentSha256.map((digest, index) => [`frozenSegmentSha256[${index}]`, digest] as const),
		...evidence.editableSegmentSha256.map((digest, index) => [`editableSegmentSha256[${index}]`, digest] as const),
	] as const) {
		sha256(digest, `request.staticEvidence.${path}`);
	}
	if (evidence.frozenSegmentSha256.length !== 4 || evidence.editableSegmentSha256.length !== 3) {
		throw new Error("NanoGPT scored request static segment evidence is incomplete");
	}
	if (
		request.trials !== nanoGptScoredTrials(request.mode) ||
		!sameJson(request.seeds, nanoGptScoredSeeds(request.mode)) ||
		!sameJson(request.benchmarkIds, nanoGptScoredBenchmarkIds(request.mode)) ||
		request.effectiveTrainSteps !== (request.mode === "smoke-10" ? 10 : evidence.trainSteps)
	) {
		throw new Error("NanoGPT scored request mode, seed, or task contract changed");
	}
	const previous = nanoGptScoredPreviousMode(request.mode);
	if (
		previous === null
			? request.priorStage !== null
			: request.priorStage === null || request.priorStage.mode !== previous
	) {
		throw new Error("NanoGPT scored request prior-stage contract changed");
	}
	if (request.priorStage) {
		const priorRecord = record(request.priorStage, "request.priorStage");
		exactKeys(priorRecord, ["mode", "jobId", "requestDigest", "resultDigest", "receiptDigest"], "request.priorStage");
		string(request.priorStage.jobId, "request.priorStage.jobId");
		for (const [path, digest] of [
			["requestDigest", request.priorStage.requestDigest],
			["resultDigest", request.priorStage.resultDigest],
			["receiptDigest", request.priorStage.receiptDigest],
		] as const) {
			sha256(digest, `request.priorStage.${path}`);
		}
	}
	const launch = record(request.launch, "request.launch");
	exactKeys(launch, ["cluster", "gpu", "gpus", "worldSize", "trialExecution", "jobDirectory"], "request.launch");
	const acceptance = record(request.acceptance, "request.acceptance");
	exactKeys(
		acceptance,
		[
			"meanValidationLossExclusiveUpperBound",
			"partialTrialsAccepted",
			"recordTrialCount",
			"recordRequiresStrictlyFewerStepsThan",
		],
		"request.acceptance",
	);
	if (
		request.launch.cluster !== "Stanford FarmShare" ||
		request.launch.gpu !== "NVIDIA L40S" ||
		request.launch.gpus !== 1 ||
		request.launch.worldSize !== 1 ||
		request.launch.trialExecution !== "sequential" ||
		request.launch.jobDirectory !== "fresh-per-stage" ||
		request.acceptance.meanValidationLossExclusiveUpperBound !== NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND ||
		request.acceptance.partialTrialsAccepted !== false ||
		request.acceptance.recordTrialCount !== 8 ||
		request.acceptance.recordRequiresStrictlyFewerStepsThan !== NANOGPT_BASELINE_TRAIN_STEPS
	) {
		throw new Error("NanoGPT scored launch or acceptance policy changed");
	}
}

export function nanoGptScoredExternalHandle(requestDigest: string): string {
	sha256(requestDigest, "requestDigest");
	return `${NANOGPT_SCORED_HANDLE_PREFIX}${requestDigest}`;
}

export function parseNanoGptScoredExternalHandle(handle: string): string {
	if (!handle.startsWith(NANOGPT_SCORED_HANDLE_PREFIX)) throw new Error("Invalid NanoGPT scored handle prefix");
	return sha256(handle.slice(NANOGPT_SCORED_HANDLE_PREFIX.length), "externalHandle.requestDigest");
}

function parsePins(value: unknown, path: string): NanoGptScoredVerifierPins {
	const parsed = record(value, path);
	exactKeys(
		parsed,
		[
			"staticEvaluatorSha256",
			"environmentSha256",
			"environmentSealSha256",
			"datasetManifestSha256",
			"workerSha256",
			"transportSha256",
		],
		path,
	);
	return {
		staticEvaluatorSha256: sha256(parsed.staticEvaluatorSha256, `${path}.staticEvaluatorSha256`),
		environmentSha256: sha256(parsed.environmentSha256, `${path}.environmentSha256`),
		environmentSealSha256: sha256(parsed.environmentSealSha256, `${path}.environmentSealSha256`),
		datasetManifestSha256: sha256(parsed.datasetManifestSha256, `${path}.datasetManifestSha256`),
		workerSha256: sha256(parsed.workerSha256, `${path}.workerSha256`),
		transportSha256: sha256(parsed.transportSha256, `${path}.transportSha256`),
	};
}

function parseWorkerTrial(value: unknown, request: NanoGptScoredRequest, position: number): NanoGptScoredWorkerTrial {
	const path = `workerResult.trials[${position}]`;
	const parsed = record(value, path);
	exactKeys(
		parsed,
		[
			"index",
			"seed",
			"startedAt",
			"finishedAt",
			"finalValidationLoss",
			"optimizerSteps",
			"peakVramMb",
			"runtimeMs",
			"logSha256",
		],
		path,
	);
	const trial: NanoGptScoredWorkerTrial = {
		index: integer(parsed.index, `${path}.index`),
		seed: integer(parsed.seed, `${path}.seed`),
		startedAt: isoTimestamp(parsed.startedAt, `${path}.startedAt`),
		finishedAt: isoTimestamp(parsed.finishedAt, `${path}.finishedAt`),
		finalValidationLoss: finiteNumber(parsed.finalValidationLoss, `${path}.finalValidationLoss`),
		optimizerSteps: integer(parsed.optimizerSteps, `${path}.optimizerSteps`),
		peakVramMb: finiteNumber(parsed.peakVramMb, `${path}.peakVramMb`),
		runtimeMs: finiteNumber(parsed.runtimeMs, `${path}.runtimeMs`),
		logSha256: sha256(parsed.logSha256, `${path}.logSha256`),
	};
	if (
		trial.index !== position ||
		trial.seed !== request.seeds[position] ||
		trial.finalValidationLoss <= 0 ||
		trial.optimizerSteps !== request.effectiveTrainSteps ||
		trial.peakVramMb < 0 ||
		trial.runtimeMs < 0 ||
		Date.parse(trial.finishedAt) < Date.parse(trial.startedAt)
	) {
		throw new Error(`${path} violates the fixed trial contract`);
	}
	return trial;
}

export function parseNanoGptScoredWorkerResult(
	value: unknown,
	request: NanoGptScoredRequest,
): NanoGptScoredWorkerResult {
	verifyNanoGptScoredRequest(request);
	const parsed = record(value, "workerResult");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"ok",
			"requestDigest",
			"externalHandle",
			"slurmJobId",
			"mode",
			"candidateSha256",
			"trainSteps",
			"effectiveTrainSteps",
			"trials",
			"startedAt",
			"finishedAt",
			"hardware",
			"execution",
			"sourceIntegrity",
			"pins",
			"failure",
		],
		"workerResult",
	);
	if (typeof parsed.ok !== "boolean") throw new Error("workerResult.ok must be boolean");
	const startedAt = isoTimestamp(parsed.startedAt, "workerResult.startedAt");
	const finishedAt = isoTimestamp(parsed.finishedAt, "workerResult.finishedAt");
	if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("Worker timestamps are out of order");
	const hardware = record(parsed.hardware, "workerResult.hardware");
	exactKeys(hardware, ["cluster", "gpu", "gpuUuid", "gpus", "worldSize"], "workerResult.hardware");
	const execution = record(parsed.execution, "workerResult.execution");
	exactKeys(
		execution,
		["trialExecution", "cleanJobDirectory", "freshCandidateMaterialization", "priorMeasurementsReused"],
		"workerResult.execution",
	);
	const sourceIntegrity = record(parsed.sourceIntegrity, "workerResult.sourceIntegrity");
	exactKeys(sourceIntegrity, ["preRunCandidateSha256", "postRunCandidateSha256"], "workerResult.sourceIntegrity");
	const pins = parsePins(parsed.pins, "workerResult.pins");
	if (!Array.isArray(parsed.trials)) throw new Error("workerResult.trials must be an array");
	const trials = parsed.trials.map((trial, index) => parseWorkerTrial(trial, request, index));
	for (let index = 1; index < trials.length; index++) {
		if (Date.parse(trials[index].startedAt) < Date.parse(trials[index - 1].finishedAt)) {
			throw new Error("NanoGPT trials overlap instead of executing sequentially");
		}
	}
	if (
		parsed.schemaVersion !== 1 ||
		parsed.contract !== NANOGPT_SCORED_CONTRACT_ID ||
		parsed.requestDigest !== request.requestDigest ||
		parsed.externalHandle !== nanoGptScoredExternalHandle(request.requestDigest) ||
		!/^\d+$/.test(string(parsed.slurmJobId, "workerResult.slurmJobId")) ||
		parsed.mode !== request.mode ||
		parsed.candidateSha256 !== request.staticEvidence.candidateSha256 ||
		parsed.trainSteps !== request.staticEvidence.trainSteps ||
		parsed.effectiveTrainSteps !== request.effectiveTrainSteps ||
		hardware.cluster !== "Stanford FarmShare" ||
		hardware.gpu !== "NVIDIA L40S" ||
		string(hardware.gpuUuid, "workerResult.hardware.gpuUuid").length === 0 ||
		hardware.gpus !== 1 ||
		hardware.worldSize !== 1 ||
		execution.trialExecution !== "sequential" ||
		execution.cleanJobDirectory !== true ||
		execution.freshCandidateMaterialization !== true ||
		execution.priorMeasurementsReused !== false ||
		sourceIntegrity.preRunCandidateSha256 !== request.staticEvidence.candidateSha256 ||
		sourceIntegrity.postRunCandidateSha256 !== request.staticEvidence.candidateSha256 ||
		!sameJson(pins, request.pins)
	) {
		throw new Error("NanoGPT worker result is not bound to the exact request");
	}
	if (trials.some((trial) => Date.parse(trial.startedAt) < Date.parse(startedAt))) {
		throw new Error("A NanoGPT trial starts before its worker envelope");
	}
	if (trials.some((trial) => Date.parse(trial.finishedAt) > Date.parse(finishedAt))) {
		throw new Error("A NanoGPT trial ends after its worker envelope");
	}
	let failure: NanoGptScoredWorkerResult["failure"] = null;
	if (parsed.failure !== null) {
		const failureRecord = record(parsed.failure, "workerResult.failure");
		exactKeys(failureRecord, ["kind", "message"], "workerResult.failure");
		failure = {
			kind: string(failureRecord.kind, "workerResult.failure.kind"),
			message: string(failureRecord.message, "workerResult.failure.message"),
		};
	}
	if (parsed.ok) {
		if (failure !== null || trials.length !== request.trials) {
			throw new Error("Successful NanoGPT worker result must contain every fixed trial and no failure");
		}
	} else if (failure === null || trials.length > request.trials) {
		throw new Error("Failed NanoGPT worker result must contain a failure and at most the fixed trial prefix");
	}
	return {
		schemaVersion: 1,
		contract: NANOGPT_SCORED_CONTRACT_ID,
		ok: parsed.ok,
		requestDigest: request.requestDigest,
		externalHandle: nanoGptScoredExternalHandle(request.requestDigest),
		slurmJobId: string(parsed.slurmJobId, "workerResult.slurmJobId"),
		mode: request.mode,
		candidateSha256: request.staticEvidence.candidateSha256,
		trainSteps: request.staticEvidence.trainSteps,
		effectiveTrainSteps: request.effectiveTrainSteps,
		trials,
		startedAt,
		finishedAt,
		hardware: {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			gpuUuid: string(hardware.gpuUuid, "workerResult.hardware.gpuUuid"),
			gpus: 1,
			worldSize: 1,
		},
		execution: {
			trialExecution: "sequential",
			cleanJobDirectory: true,
			freshCandidateMaterialization: true,
			priorMeasurementsReused: false,
		},
		sourceIntegrity: {
			preRunCandidateSha256: request.staticEvidence.candidateSha256,
			postRunCandidateSha256: request.staticEvidence.candidateSha256,
		},
		pins,
		failure,
	};
}

export function assessNanoGptScoredWorkerResult(
	value: unknown,
	request: NanoGptScoredRequest,
): NanoGptScoredAssessment {
	const result = parseNanoGptScoredWorkerResult(value, request);
	const accepted = result.ok && result.trials.length === request.trials;
	const meanValidationLoss = accepted
		? result.trials.reduce((sum, trial) => sum + trial.finalValidationLoss, 0) / result.trials.length
		: null;
	const scored = request.mode !== "smoke-10";
	const thresholdPassed =
		accepted && scored
			? (meanValidationLoss ?? Number.POSITIVE_INFINITY) < NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND
			: null;
	const frontierEligible = accepted && request.mode === "replay-8" && thresholdPassed === true;
	const recordEligible = frontierEligible && request.staticEvidence.trainSteps < NANOGPT_BASELINE_TRAIN_STEPS;
	const checks = [
		NANOGPT_SCORED_CONTRACT_ID,
		"candidate-specific-static-and-cuda-gate",
		"one-l40s-world-size-one",
		"fixed-seed-prefix",
		"sequential-non-overlapping-trials",
		"clean-candidate-source-pre-and-post",
	];
	const tasks: TaskMeasurement[] = request.benchmarkIds.map((benchmarkId, index) => {
		const trial = result.trials[index];
		if (!accepted || !trial) {
			return {
				benchmarkId,
				status: "failed",
				metrics: {},
				verifier: { passed: false, checks, errors: [result.failure?.message ?? "Incomplete NanoGPT trial set"] },
				runtimeMs: trial?.runtimeMs ?? 0,
			};
		}
		const metrics: Record<string, number> = {
			validation_loss: trial.finalValidationLoss,
			train_steps: request.staticEvidence.trainSteps,
			peak_vram_mb: trial.peakVramMb,
		};
		if (frontierEligible) metrics.verified_steps = request.staticEvidence.trainSteps;
		return {
			benchmarkId,
			status: "accepted",
			metrics,
			verifier: { passed: true, checks, errors: [] },
			runtimeMs: trial.runtimeMs,
		};
	});
	return {
		result,
		resultDigest: sha256Json(result),
		accepted,
		meanValidationLoss,
		thresholdPassed,
		frontierEligible,
		recordEligible,
		tasks,
	};
}

export function nanoGptScoredOutcome(
	assessment: NanoGptScoredAssessment,
	request: NanoGptScoredRequest,
	provenance: Record<string, string>,
): EvaluationOutcome {
	return {
		verifierEpoch: request.verifierEpoch,
		tasks: [...assessment.tasks],
		hardware: {
			cluster: assessment.result.hardware.cluster,
			gpu: assessment.result.hardware.gpu,
			gpuUuid: assessment.result.hardware.gpuUuid,
			gpus: "1",
			worldSize: "1",
			slurmJobId: assessment.result.slurmJobId,
		},
		provenance,
	};
}

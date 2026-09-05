import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	NANOGPT_BASELINE_SHA256,
	NANOGPT_CONTRACT_ID,
	NANOGPT_PROGRAM_SHA256,
	NANOGPT_SPEEDRUN_COMMIT,
	runNanoGptContract,
} from "./nanogpt-contract.js";
import { NANOGPT_SCORED_AMENDMENT_SHA256 } from "./nanogpt-scored-amendment.js";
import {
	assessNanoGptScoredWorkerResult,
	buildNanoGptScoredRequest,
	inferNanoGptScoredMode,
	NANOGPT_SCORED_CONTRACT_ID,
	type NanoGptScoredAssessment,
	type NanoGptScoredMode,
	type NanoGptScoredPriorStage,
	type NanoGptScoredRequest,
	type NanoGptScoredStaticEvidence,
	type NanoGptScoredVerifierPins,
	nanoGptScoredBoundaryConditions,
	nanoGptScoredBudgetClass,
	nanoGptScoredExternalHandle,
	nanoGptScoredOutcome,
	nanoGptScoredPreviousMode,
	nanoGptScoredStageIdentity,
	nanoGptScoredVerifierEpoch,
	parseNanoGptScoredExternalHandle,
	verifyNanoGptScoredRequest,
} from "./nanogpt-scored-protocol.js";
import type { ArtifactRef, EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome } from "./types.js";

export interface NanoGptScoredTransportSchedulerEvidence {
	readonly slurmJobId: string;
	readonly jobName: string;
	readonly workDir: string;
	readonly state: "COMPLETED";
	readonly exitCode: "0:0";
}

export interface NanoGptScoredTransportArchivedLog {
	readonly requestDigest: string;
	readonly remoteName: string;
	readonly logSha256: string;
	readonly byteLength: number;
	readonly path: string;
}

export interface NanoGptScoredTransportArchiveEvidence {
	readonly canonicalManifest: string;
	readonly manifestByteLength: number;
	readonly manifestSha256: string;
	readonly logs: readonly NanoGptScoredTransportArchivedLog[];
}

export interface NanoGptScoredTransportCompletion {
	readonly schemaVersion: 1;
	readonly requestDigest: string;
	readonly externalHandle: string;
	readonly jobScriptSha256: string;
	readonly scheduler: NanoGptScoredTransportSchedulerEvidence;
	readonly workerResult: unknown;
	readonly archive: NanoGptScoredTransportArchiveEvidence;
}

export interface NanoGptScoredTransport {
	execute(
		request: NanoGptScoredRequest,
		candidatePatch: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredTransportCompletion>;
	resume?(
		request: NanoGptScoredRequest,
		candidatePatch: string,
		externalHandle: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredTransportCompletion>;
	readArchiveEvidence(requestDigest: string): Promise<NanoGptScoredTransportArchiveEvidence>;
}

export type NanoGptScoredStaticGate = (candidatePatch: string) => Promise<NanoGptScoredStaticEvidence>;

export interface NanoGptScoredAdapterOptions {
	readonly stateDir: string;
	readonly pins: NanoGptScoredVerifierPins;
	readonly transport?: NanoGptScoredTransport;
	readonly staticGate?: NanoGptScoredStaticGate;
	readonly now?: () => Date;
}

export interface NanoGptScoredReceipt {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_SCORED_CONTRACT_ID;
	readonly verifierEpoch: string;
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredMode;
	readonly jobId: string;
	readonly manifestDigest: string;
	readonly requestDigest: string;
	readonly requestArtifact: ArtifactRef;
	readonly resultDigest: string;
	readonly resultArtifact: ArtifactRef;
	readonly jobScriptSha256: string;
	readonly scheduler: NanoGptScoredTransportSchedulerEvidence;
	readonly archiveManifestSha256: string;
	readonly archiveManifestArtifact: ArtifactRef;
	readonly completedAt: string;
	readonly accepted: boolean;
	readonly meanValidationLoss: number | null;
	readonly thresholdPassed: boolean | null;
	readonly frontierEligible: boolean;
	readonly recordEligible: boolean;
}

interface LoadedReceipt {
	readonly receipt: NanoGptScoredReceipt;
	readonly receiptDigest: string;
	readonly request: NanoGptScoredRequest;
	readonly assessment: NanoGptScoredAssessment;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const APPARATUS_ATTEMPT_PATTERN = /^apparatusAttempt=(0|[1-9][0-9]*)$/;

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

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function sha256(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!SHA256_PATTERN.test(parsed)) throw new Error(`${path} must be a SHA-256 digest`);
	return parsed;
}

function artifact(value: unknown, path: string): ArtifactRef {
	if (!isRecord(value)) throw new Error(`${path} must be an artifact reference`);
	exactKeys(value, ["digest", "byteLength", "mediaType"], path);
	const byteLength = value.byteLength;
	if (!Number.isSafeInteger(byteLength) || Number(byteLength) < 1) {
		throw new Error(`${path}.byteLength must be a positive safe integer`);
	}
	return {
		digest: sha256(value.digest, `${path}.digest`),
		byteLength: Number(byteLength),
		mediaType: string(value.mediaType, `${path}.mediaType`),
	};
}

function sameJson(left: unknown, right: unknown): boolean {
	return sha256Json(left) === sha256Json(right);
}

export function nanoGptScoredApparatusAttemptBoundaryCondition(attempt: number): string {
	if (!Number.isSafeInteger(attempt) || attempt < 0) {
		throw new Error("NanoGPT scored apparatus attempt must be a nonnegative safe integer");
	}
	return `apparatusAttempt=${attempt}`;
}

export function parseNanoGptScoredApparatusAttemptBoundaryCondition(encoded: string): number {
	const match = APPARATUS_ATTEMPT_PATTERN.exec(encoded);
	const attempt = match ? Number(match[1]) : Number.NaN;
	if (!Number.isSafeInteger(attempt)) {
		throw new Error("NanoGPT scored proposal apparatus attempt is invalid");
	}
	return attempt;
}

export function parseNanoGptScoredApparatusAttempt(
	boundaryConditions: readonly string[],
	pins: NanoGptScoredVerifierPins,
): number {
	const fixed = nanoGptScoredBoundaryConditions(pins);
	if (
		boundaryConditions.length !== fixed.length + 1 ||
		!boundaryConditions.slice(0, fixed.length).every((condition, index) => condition === fixed[index])
	) {
		throw new Error("NanoGPT scored proposal must use the fixed verifier boundary prefix plus one apparatus attempt");
	}
	const encoded = boundaryConditions[fixed.length] ?? "";
	return parseNanoGptScoredApparatusAttemptBoundaryCondition(encoded);
}

function nonnegativeSafeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return Number(value);
}

function parseSchedulerEvidence(value: unknown, requestDigest: string): NanoGptScoredTransportSchedulerEvidence {
	if (!isRecord(value)) throw new Error("transportResult.scheduler must be an object");
	exactKeys(value, ["slurmJobId", "jobName", "workDir", "state", "exitCode"], "transportResult.scheduler");
	const scheduler = {
		slurmJobId: string(value.slurmJobId, "transportResult.scheduler.slurmJobId"),
		jobName: string(value.jobName, "transportResult.scheduler.jobName"),
		workDir: string(value.workDir, "transportResult.scheduler.workDir"),
		state: value.state,
		exitCode: value.exitCode,
	};
	if (
		!/^[1-9][0-9]*$/.test(scheduler.slurmJobId) ||
		scheduler.jobName !== `pngs-${requestDigest.slice(0, 24)}` ||
		resolve(scheduler.workDir) !== scheduler.workDir ||
		scheduler.state !== "COMPLETED" ||
		scheduler.exitCode !== "0:0"
	) {
		throw new Error("NanoGPT transport completion lacks authoritative COMPLETED/0:0 scheduler evidence");
	}
	return {
		slurmJobId: scheduler.slurmJobId,
		jobName: scheduler.jobName,
		workDir: scheduler.workDir,
		state: "COMPLETED",
		exitCode: "0:0",
	};
}

interface ParsedArchiveManifestLog {
	readonly remoteName: string;
	readonly logSha256: string;
	readonly byteLength: number;
}

function parseArchiveManifest(source: string, requestDigest: string): readonly ParsedArchiveManifestLog[] {
	if (!source.endsWith("\n")) throw new Error("NanoGPT scored archive manifest is not newline terminated");
	const value: unknown = JSON.parse(source);
	if (!isRecord(value)) throw new Error("NanoGPT scored archive manifest must be an object");
	exactKeys(value, ["schemaVersion", "requestDigest", "logs"], "archiveManifest");
	if (value.schemaVersion !== 1 || value.requestDigest !== requestDigest || !Array.isArray(value.logs)) {
		throw new Error("NanoGPT scored archive manifest identity changed");
	}
	const logs = value.logs.map((item, index) => {
		if (!isRecord(item)) throw new Error(`archiveManifest.logs[${index}] must be an object`);
		exactKeys(item, ["remoteName", "logSha256", "byteLength", "relativePath"], `archiveManifest.logs[${index}]`);
		const remoteName = string(item.remoteName, `archiveManifest.logs[${index}].remoteName`);
		if (
			!/^[A-Za-z0-9._/-]+$/.test(remoteName) ||
			remoteName.split("/").some((part) => part === "" || part === "." || part === "..")
		) {
			throw new Error(`archiveManifest.logs[${index}].remoteName is unsafe`);
		}
		const logSha256 = sha256(item.logSha256, `archiveManifest.logs[${index}].logSha256`);
		if (item.relativePath !== `logs/${logSha256}.log`) {
			throw new Error(`archiveManifest.logs[${index}] escaped its content-addressed route`);
		}
		return {
			remoteName,
			logSha256,
			byteLength: nonnegativeSafeInteger(item.byteLength, `archiveManifest.logs[${index}].byteLength`),
		};
	});
	if (`${canonicalJson(toJsonValue(value))}\n` !== source) {
		throw new Error("NanoGPT scored archive manifest is not canonical JSON");
	}
	if (new Set(logs.map((log) => log.remoteName)).size !== logs.length) {
		throw new Error("NanoGPT scored archive manifest contains duplicate remote log names");
	}
	return logs;
}

function parseArchiveEvidence(
	value: unknown,
	request: NanoGptScoredRequest,
	assessment: NanoGptScoredAssessment,
): NanoGptScoredTransportArchiveEvidence {
	if (!isRecord(value)) throw new Error("transportResult.archive must be an object");
	exactKeys(value, ["canonicalManifest", "manifestByteLength", "manifestSha256", "logs"], "transportResult.archive");
	const canonicalManifest = string(value.canonicalManifest, "transportResult.archive.canonicalManifest");
	const manifestByteLength = nonnegativeSafeInteger(
		value.manifestByteLength,
		"transportResult.archive.manifestByteLength",
	);
	const manifestSha256 = sha256(value.manifestSha256, "transportResult.archive.manifestSha256");
	if (
		Buffer.byteLength(canonicalManifest, "utf8") !== manifestByteLength ||
		sha256Text(canonicalManifest) !== manifestSha256
	) {
		throw new Error("NanoGPT scored archive manifest bytes changed");
	}
	const manifestLogs = parseArchiveManifest(canonicalManifest, request.requestDigest);
	if (!Array.isArray(value.logs) || value.logs.length !== manifestLogs.length) {
		throw new Error("NanoGPT scored archive log inventory disagrees with its manifest");
	}
	const logs = value.logs.map((item, index) => {
		if (!isRecord(item)) throw new Error(`transportResult.archive.logs[${index}] must be an object`);
		exactKeys(
			item,
			["requestDigest", "remoteName", "logSha256", "byteLength", "path"],
			`transportResult.archive.logs[${index}]`,
		);
		const manifestLog = manifestLogs[index];
		const path = string(item.path, `transportResult.archive.logs[${index}].path`);
		if (
			item.requestDigest !== request.requestDigest ||
			item.remoteName !== manifestLog.remoteName ||
			item.logSha256 !== manifestLog.logSha256 ||
			item.byteLength !== manifestLog.byteLength ||
			resolve(path) !== path ||
			!path.endsWith(
				`/${request.requestDigest.slice(0, 2)}/${request.requestDigest}/logs/${manifestLog.logSha256}.log`,
			)
		) {
			throw new Error(`transportResult.archive.logs[${index}] is not bound to the exact request manifest`);
		}
		return {
			requestDigest: request.requestDigest,
			remoteName: manifestLog.remoteName,
			logSha256: manifestLog.logSha256,
			byteLength: manifestLog.byteLength,
			path,
		};
	});
	for (const trial of assessment.result.trials) {
		if (!logs.some((log) => log.logSha256 === trial.logSha256)) {
			throw new Error("NanoGPT scored archive is missing a worker-attested trial log");
		}
	}
	return { canonicalManifest, manifestByteLength, manifestSha256, logs };
}

function assessTransportCompletion(
	value: unknown,
	request: NanoGptScoredRequest,
): {
	readonly completion: NanoGptScoredTransportCompletion;
	readonly assessment: NanoGptScoredAssessment;
} {
	if (!isRecord(value)) throw new Error("NanoGPT scored transport completion must be an object");
	exactKeys(
		value,
		["schemaVersion", "requestDigest", "externalHandle", "jobScriptSha256", "scheduler", "workerResult", "archive"],
		"transportResult",
	);
	if (
		value.schemaVersion !== 1 ||
		value.requestDigest !== request.requestDigest ||
		value.externalHandle !== nanoGptScoredExternalHandle(request.requestDigest)
	) {
		throw new Error("NanoGPT scored transport completion is not bound to the exact request");
	}
	const assessment = assessNanoGptScoredWorkerResult(value.workerResult, request);
	const scheduler = parseSchedulerEvidence(value.scheduler, request.requestDigest);
	if (scheduler.slurmJobId !== assessment.result.slurmJobId) {
		throw new Error("NanoGPT scored scheduler evidence disagrees with the worker SLURM ID");
	}
	const archive = parseArchiveEvidence(value.archive, request, assessment);
	return {
		completion: {
			schemaVersion: 1,
			requestDigest: request.requestDigest,
			externalHandle: nanoGptScoredExternalHandle(request.requestDigest),
			jobScriptSha256: sha256(value.jobScriptSha256, "transportResult.jobScriptSha256"),
			scheduler,
			workerResult: assessment.result,
			archive,
		},
		assessment,
	};
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export async function validateNanoGptScoredCandidatePatch(
	candidatePatch: string,
): Promise<NanoGptScoredStaticEvidence> {
	const temporaryRoot = await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-static-"));
	const patchPath = join(temporaryRoot, "candidate.patch");
	try {
		await writeFile(patchPath, candidatePatch, { encoding: "utf8", mode: 0o600 });
		const result = await runNanoGptContract({ patchPath, allowBaselineSteps: true });
		if (
			!result.ok ||
			result.baselineSha256 !== NANOGPT_BASELINE_SHA256 ||
			result.patchSha256 !== sha256Text(candidatePatch) ||
			result.candidateSha256 === null ||
			result.trainSteps === null ||
			result.frozenSegmentSha256.length !== 4 ||
			result.editableSegmentSha256.length !== 3
		) {
			throw new Error(`NanoGPT candidate failed the static contract: ${JSON.stringify(result.errors)}`);
		}
		return {
			contract: NANOGPT_CONTRACT_ID,
			repositoryCommit: NANOGPT_SPEEDRUN_COMMIT,
			programSha256: NANOGPT_PROGRAM_SHA256,
			evaluatorSha256: result.evaluatorSha256,
			baselineSha256: NANOGPT_BASELINE_SHA256,
			patchSha256: result.patchSha256,
			candidateSha256: result.candidateSha256,
			trainSteps: result.trainSteps,
			frozenSegmentSha256: result.frozenSegmentSha256,
			editableSegmentSha256: result.editableSegmentSha256,
		};
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

class DisabledNanoGptScoredTransport implements NanoGptScoredTransport {
	execute(): Promise<never> {
		return Promise.reject(
			new Error("NanoGPT scored GPU dispatch is disabled until a separately verified transport is configured"),
		);
	}

	readArchiveEvidence(): Promise<never> {
		return Promise.reject(new Error("NanoGPT scored archive verification requires a configured transport"));
	}
}

class NanoGptScoredEvidenceStore {
	private readonly artifacts: ArtifactStore;

	constructor(private readonly rootDir: string) {
		this.artifacts = new ArtifactStore(join(rootDir, "artifacts"));
	}

	put(content: string, mediaType: string): Promise<ArtifactRef> {
		return this.artifacts.putString(content, mediaType);
	}

	private receiptPath(stageIdentity: string, mode: NanoGptScoredMode): string {
		sha256(stageIdentity, "stageIdentity");
		return join(this.rootDir, "slots", stageIdentity.slice(0, 2), stageIdentity, `${mode}.json`);
	}

	async load(stageIdentity: string, mode: NanoGptScoredMode): Promise<LoadedReceipt | null> {
		let source: string;
		try {
			source = await readFile(this.receiptPath(stageIdentity, mode), "utf8");
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
		if (!source.endsWith("\n")) throw new Error("NanoGPT scored receipt is not newline terminated");
		const value: unknown = JSON.parse(source);
		if (!isRecord(value)) throw new Error("NanoGPT scored receipt must be an object");
		exactKeys(
			value,
			[
				"schemaVersion",
				"contract",
				"verifierEpoch",
				"stageIdentity",
				"mode",
				"jobId",
				"manifestDigest",
				"requestDigest",
				"requestArtifact",
				"resultDigest",
				"resultArtifact",
				"jobScriptSha256",
				"scheduler",
				"archiveManifestSha256",
				"archiveManifestArtifact",
				"completedAt",
				"accepted",
				"meanValidationLoss",
				"thresholdPassed",
				"frontierEligible",
				"recordEligible",
			],
			"receipt",
		);
		if (
			value.schemaVersion !== 1 ||
			value.contract !== NANOGPT_SCORED_CONTRACT_ID ||
			value.stageIdentity !== stageIdentity ||
			value.mode !== mode ||
			value.accepted !== true ||
			!(
				value.meanValidationLoss === null ||
				(typeof value.meanValidationLoss === "number" && Number.isFinite(value.meanValidationLoss))
			) ||
			!(value.thresholdPassed === null || typeof value.thresholdPassed === "boolean") ||
			typeof value.frontierEligible !== "boolean" ||
			typeof value.recordEligible !== "boolean"
		) {
			throw new Error("NanoGPT scored receipt failed schema validation");
		}
		const completedAt = string(value.completedAt, "receipt.completedAt");
		if (!completedAt.endsWith("Z") || !Number.isFinite(Date.parse(completedAt))) {
			throw new Error("receipt.completedAt must be a UTC ISO timestamp");
		}
		const requestDigest = sha256(value.requestDigest, "receipt.requestDigest");
		const receipt: NanoGptScoredReceipt = {
			schemaVersion: 1,
			contract: NANOGPT_SCORED_CONTRACT_ID,
			verifierEpoch: string(value.verifierEpoch, "receipt.verifierEpoch"),
			stageIdentity,
			mode,
			jobId: string(value.jobId, "receipt.jobId"),
			manifestDigest: sha256(value.manifestDigest, "receipt.manifestDigest"),
			requestDigest,
			requestArtifact: artifact(value.requestArtifact, "receipt.requestArtifact"),
			resultDigest: sha256(value.resultDigest, "receipt.resultDigest"),
			resultArtifact: artifact(value.resultArtifact, "receipt.resultArtifact"),
			jobScriptSha256: sha256(value.jobScriptSha256, "receipt.jobScriptSha256"),
			scheduler: parseSchedulerEvidence(value.scheduler, requestDigest),
			archiveManifestSha256: sha256(value.archiveManifestSha256, "receipt.archiveManifestSha256"),
			archiveManifestArtifact: artifact(value.archiveManifestArtifact, "receipt.archiveManifestArtifact"),
			completedAt,
			accepted: value.accepted,
			meanValidationLoss: value.meanValidationLoss,
			thresholdPassed: value.thresholdPassed,
			frontierEligible: value.frontierEligible,
			recordEligible: value.recordEligible,
		};
		if (
			receipt.requestArtifact.mediaType !== "application/json" ||
			receipt.resultArtifact.mediaType !== "application/json" ||
			receipt.archiveManifestArtifact.mediaType !== "application/json"
		) {
			throw new Error("NanoGPT scored receipt artifact media types changed");
		}
		if (`${canonicalJson(toJsonValue(receipt))}\n` !== source) {
			throw new Error("NanoGPT scored receipt is not canonical JSON");
		}
		const requestSource = await this.artifacts.readString(receipt.requestArtifact);
		const request = JSON.parse(requestSource) as NanoGptScoredRequest;
		verifyNanoGptScoredRequest(request);
		if (
			request.requestDigest !== receipt.requestDigest ||
			request.verifierEpoch !== receipt.verifierEpoch ||
			request.stageIdentity !== receipt.stageIdentity ||
			request.mode !== receipt.mode ||
			request.jobId !== receipt.jobId ||
			request.manifestDigest !== receipt.manifestDigest
		) {
			throw new Error("NanoGPT scored receipt is not bound to its request artifact");
		}
		const resultSource = await this.artifacts.readString(receipt.resultArtifact);
		const assessment = assessNanoGptScoredWorkerResult(JSON.parse(resultSource), request);
		const archiveManifestSource = await this.artifacts.readString(receipt.archiveManifestArtifact);
		const archiveLogs = parseArchiveManifest(archiveManifestSource, request.requestDigest);
		if (
			assessment.resultDigest !== receipt.resultDigest ||
			receipt.resultArtifact.digest !== receipt.resultDigest ||
			receipt.scheduler.slurmJobId !== assessment.result.slurmJobId ||
			receipt.archiveManifestArtifact.digest !== receipt.archiveManifestSha256 ||
			Buffer.byteLength(archiveManifestSource, "utf8") !== receipt.archiveManifestArtifact.byteLength ||
			assessment.result.trials.some((trial) => !archiveLogs.some((log) => log.logSha256 === trial.logSha256)) ||
			assessment.accepted !== receipt.accepted ||
			assessment.meanValidationLoss !== receipt.meanValidationLoss ||
			assessment.thresholdPassed !== receipt.thresholdPassed ||
			assessment.frontierEligible !== receipt.frontierEligible ||
			assessment.recordEligible !== receipt.recordEligible
		) {
			throw new Error("NanoGPT scored receipt disagrees with its result artifact");
		}
		return { receipt, receiptDigest: sha256Json(receipt), request, assessment };
	}

	async create(
		request: NanoGptScoredRequest,
		assessment: NanoGptScoredAssessment,
		completion: NanoGptScoredTransportCompletion,
		completedAt: string,
	): Promise<LoadedReceipt> {
		if (!assessment.accepted) {
			throw new Error("Refusing to persist an unaccepted NanoGPT scored stage receipt");
		}
		const requestArtifact = await this.put(canonicalJson(toJsonValue(request)), "application/json");
		const resultArtifact = await this.put(canonicalJson(toJsonValue(assessment.result)), "application/json");
		const archiveManifestArtifact = await this.put(completion.archive.canonicalManifest, "application/json");
		if (resultArtifact.digest !== assessment.resultDigest) {
			throw new Error("NanoGPT result artifact digest disagrees with its canonical assessment");
		}
		if (
			archiveManifestArtifact.digest !== completion.archive.manifestSha256 ||
			archiveManifestArtifact.byteLength !== completion.archive.manifestByteLength
		) {
			throw new Error("NanoGPT archive artifact digest disagrees with its transport evidence");
		}
		const receipt: NanoGptScoredReceipt = {
			schemaVersion: 1,
			contract: NANOGPT_SCORED_CONTRACT_ID,
			verifierEpoch: request.verifierEpoch,
			stageIdentity: request.stageIdentity,
			mode: request.mode,
			jobId: request.jobId,
			manifestDigest: request.manifestDigest,
			requestDigest: request.requestDigest,
			requestArtifact,
			resultDigest: assessment.resultDigest,
			resultArtifact,
			jobScriptSha256: completion.jobScriptSha256,
			scheduler: completion.scheduler,
			archiveManifestSha256: completion.archive.manifestSha256,
			archiveManifestArtifact,
			completedAt,
			accepted: assessment.accepted,
			meanValidationLoss: assessment.meanValidationLoss,
			thresholdPassed: assessment.thresholdPassed,
			frontierEligible: assessment.frontierEligible,
			recordEligible: assessment.recordEligible,
		};
		const path = this.receiptPath(request.stageIdentity, request.mode);
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		try {
			const handle = await open(path, "wx", 0o600);
			try {
				await handle.writeFile(`${canonicalJson(toJsonValue(receipt))}\n`, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			const directory = await open(dirname(path), "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
		}
		const loaded = await this.load(request.stageIdentity, request.mode);
		if (!loaded) throw new Error("NanoGPT scored receipt disappeared after durable creation");
		if (!sameJson(loaded.receipt, receipt)) {
			throw new Error("A conflicting NanoGPT scored stage receipt already exists");
		}
		return loaded;
	}
}

export class NanoGptScoredAdapter implements EvaluationAdapter {
	readonly lane = "nanogpt" as const;
	private readonly store: NanoGptScoredEvidenceStore;
	private readonly transport: NanoGptScoredTransport;
	private readonly staticGate: NanoGptScoredStaticGate;
	private readonly staticEvidence = new Map<string, Promise<NanoGptScoredStaticEvidence>>();
	private readonly stageTails = new Map<string, Promise<void>>();

	constructor(private readonly options: NanoGptScoredAdapterOptions) {
		const stateDir = resolve(options.stateDir);
		if (stateDir !== options.stateDir) throw new Error("NanoGPT scored stateDir must be absolute and normalized");
		this.store = new NanoGptScoredEvidenceStore(stateDir);
		this.transport = options.transport ?? new DisabledNanoGptScoredTransport();
		this.staticGate = options.staticGate ?? validateNanoGptScoredCandidatePatch;
		nanoGptScoredBoundaryConditions(options.pins);
	}

	private now(): string {
		return (this.options.now?.() ?? new Date()).toISOString();
	}

	private validateJob(job: EvaluationJob): {
		readonly mode: NanoGptScoredMode;
		readonly apparatusAttempt: number;
	} {
		if (job.lane !== "nanogpt" || job.candidateFormat !== "unified-diff") {
			throw new Error("NanoGPT scored adapter requires a unified-diff NanoGPT job");
		}
		if (job.requireFreshMeasurement !== true) {
			throw new Error("Every NanoGPT scored stage requires requireFreshMeasurement=true");
		}
		if (sha256Text(job.candidateContent) !== job.candidate.digest) {
			throw new Error("NanoGPT scored candidate bytes disagree with the controller artifact");
		}
		const mode = inferNanoGptScoredMode(job.benchmarkIds);
		if (job.budgetClass !== nanoGptScoredBudgetClass(mode)) {
			throw new Error(`NanoGPT ${mode} requires budgetClass=${nanoGptScoredBudgetClass(mode)}`);
		}
		const apparatusAttempt = parseNanoGptScoredApparatusAttempt(job.proposal.boundaryConditions, this.options.pins);
		return { mode, apparatusAttempt };
	}

	private validateStaticEvidence(candidatePatch: string): Promise<NanoGptScoredStaticEvidence> {
		const digest = sha256Text(candidatePatch);
		let operation = this.staticEvidence.get(digest);
		if (!operation) {
			operation = this.staticGate(candidatePatch).then((evidence) => {
				if (
					evidence.contract !== NANOGPT_CONTRACT_ID ||
					evidence.repositoryCommit !== NANOGPT_SPEEDRUN_COMMIT ||
					evidence.programSha256 !== NANOGPT_PROGRAM_SHA256 ||
					evidence.baselineSha256 !== NANOGPT_BASELINE_SHA256 ||
					evidence.patchSha256 !== digest ||
					evidence.evaluatorSha256 !== this.options.pins.staticEvaluatorSha256
				) {
					throw new Error("NanoGPT static gate returned evidence for different candidate bytes");
				}
				return evidence;
			});
			this.staticEvidence.set(digest, operation);
		}
		return operation;
	}

	private async withStageLock<T>(stageIdentity: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.stageTails.get(stageIdentity) ?? Promise.resolve();
		let release!: () => void;
		const current = new Promise<void>((resolvePromise) => {
			release = resolvePromise;
		});
		const tail = previous.then(() => current);
		this.stageTails.set(stageIdentity, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (this.stageTails.get(stageIdentity) === tail) this.stageTails.delete(stageIdentity);
		}
	}

	private async priorStage(
		job: EvaluationJob,
		stageIdentity: string,
		mode: NanoGptScoredMode,
	): Promise<NanoGptScoredPriorStage | null> {
		const previousMode = nanoGptScoredPreviousMode(mode);
		if (previousMode === null) {
			if (job.proposal.parentJobIds.length !== 0) {
				throw new Error("Candidate-specific NanoGPT smoke must start a new staged lineage");
			}
			return null;
		}
		const previous = await this.store.load(stageIdentity, previousMode);
		if (!previous?.assessment.accepted) {
			throw new Error(`NanoGPT ${mode} requires a completed candidate-specific ${previousMode}`);
		}
		await this.verifyRecoveredArchive(previous);
		if (previousMode !== "smoke-10" && previous.assessment.thresholdPassed !== true) {
			throw new Error(`NanoGPT ${mode} cannot widen after ${previousMode} missed the fixed threshold`);
		}
		if (job.proposal.parentJobIds.length !== 1 || job.proposal.parentJobIds[0] !== previous.receipt.jobId) {
			throw new Error(`NanoGPT ${mode} must name the exact ${previousMode} controller job as its sole parent`);
		}
		return {
			mode: previousMode,
			jobId: previous.receipt.jobId,
			requestDigest: previous.receipt.requestDigest,
			resultDigest: previous.receipt.resultDigest,
			receiptDigest: previous.receiptDigest,
		};
	}

	private outcomeFromAssessment(
		request: NanoGptScoredRequest,
		assessment: NanoGptScoredAssessment,
		completion: NanoGptScoredTransportCompletion | null,
		loaded: LoadedReceipt | null,
		recovered: boolean,
		apparatusAttempt: number,
	): EvaluationOutcome {
		const jobScriptSha256 = completion?.jobScriptSha256 ?? loaded?.receipt.jobScriptSha256;
		const scheduler = completion?.scheduler ?? loaded?.receipt.scheduler;
		const archiveManifestSha256 = completion?.archive.manifestSha256 ?? loaded?.receipt.archiveManifestSha256;
		const archiveManifestByteLength =
			completion?.archive.manifestByteLength ?? loaded?.receipt.archiveManifestArtifact.byteLength;
		if (!jobScriptSha256 || !scheduler || !archiveManifestSha256 || archiveManifestByteLength === undefined) {
			throw new Error("NanoGPT scored outcome is missing its transport completion evidence");
		}
		const provenance: Record<string, string> = {
			adapter: "nanogpt-scored-confirmatory",
			contract: NANOGPT_SCORED_CONTRACT_ID,
			campaignAmendmentSha256: NANOGPT_SCORED_AMENDMENT_SHA256,
			mode: request.mode,
			requestDigest: request.requestDigest,
			resultDigest: assessment.resultDigest,
			accepted: String(assessment.accepted),
			apparatusAttempt: String(apparatusAttempt),
			candidatePatchSha256: request.candidatePatch.digest,
			candidateSha256: request.staticEvidence.candidateSha256,
			trainSteps: String(request.staticEvidence.trainSteps),
			trials: String(request.trials),
			seedsSha256: sha256Json(request.seeds),
			meanLossThresholdExclusive: String(request.acceptance.meanValidationLossExclusiveUpperBound),
			meanValidationLoss:
				assessment.meanValidationLoss === null ? "not-scored" : String(assessment.meanValidationLoss),
			thresholdPassed: assessment.thresholdPassed === null ? "not-scored" : String(assessment.thresholdPassed),
			frontierEligible: String(assessment.frontierEligible),
			recordEligible: String(assessment.recordEligible),
			recoveredContentAddressedResult: String(recovered),
			jobScriptSha256,
			schedulerSlurmJobId: scheduler.slurmJobId,
			schedulerJobName: scheduler.jobName,
			schedulerWorkDir: scheduler.workDir,
			schedulerState: scheduler.state,
			schedulerExitCode: scheduler.exitCode,
			archiveManifestSha256,
			archiveManifestByteLength: String(archiveManifestByteLength),
			environmentSha256: request.pins.environmentSha256,
			environmentSealSha256: request.pins.environmentSealSha256,
			datasetManifestSha256: request.pins.datasetManifestSha256,
			workerSha256: request.pins.workerSha256,
			transportSha256: request.pins.transportSha256,
			staticEvaluatorSha256: request.pins.staticEvaluatorSha256,
		};
		if (loaded) {
			provenance.requestArtifactSha256 = loaded.receipt.requestArtifact.digest;
			provenance.resultArtifactSha256 = loaded.receipt.resultArtifact.digest;
			provenance.receiptDigest = loaded.receiptDigest;
		}
		const base = nanoGptScoredOutcome(assessment, request, provenance);
		return {
			...base,
			stdout: canonicalJson(toJsonValue(assessment.result)),
			stderr: assessment.result.failure?.message,
		};
	}

	private outcome(loaded: LoadedReceipt, recovered: boolean, apparatusAttempt: number): EvaluationOutcome {
		return this.outcomeFromAssessment(loaded.request, loaded.assessment, null, loaded, recovered, apparatusAttempt);
	}

	private async verifyRecoveredArchive(loaded: LoadedReceipt): Promise<void> {
		const observed = parseArchiveEvidence(
			await this.transport.readArchiveEvidence(loaded.request.requestDigest),
			loaded.request,
			loaded.assessment,
		);
		if (
			observed.manifestSha256 !== loaded.receipt.archiveManifestSha256 ||
			observed.manifestByteLength !== loaded.receipt.archiveManifestArtifact.byteLength
		) {
			throw new Error("Recovered NanoGPT archive evidence disagrees with the durable stage receipt");
		}
	}

	private async run(
		job: EvaluationJob,
		context: EvaluationContext,
		externalHandle: string | null,
	): Promise<EvaluationOutcome> {
		const { mode, apparatusAttempt } = this.validateJob(job);
		const [candidatePatch, staticEvidence] = await Promise.all([
			Promise.resolve(job.candidateContent),
			this.validateStaticEvidence(job.candidateContent),
		]);
		const candidatePatchArtifact = await this.store.put(candidatePatch, "text/x-diff");
		if (candidatePatchArtifact.digest !== job.candidate.digest) {
			throw new Error("NanoGPT scored state artifact differs from the controller candidate artifact");
		}
		const stageIdentity = nanoGptScoredStageIdentity({
			branchId: job.branchId,
			treatment: job.treatment,
			verifierEpoch: nanoGptScoredVerifierEpoch(this.options.pins),
			candidatePatchSha256: candidatePatchArtifact.digest,
			candidateSha256: staticEvidence.candidateSha256,
		});
		return this.withStageLock(stageIdentity, async () => {
			const priorStage = await this.priorStage(job, stageIdentity, mode);
			const request = buildNanoGptScoredRequest({
				stageIdentity,
				mode,
				jobId: job.jobId,
				manifestDigest: job.manifestDigest,
				branchId: job.branchId,
				treatment: job.treatment,
				candidatePatch: candidatePatchArtifact,
				staticEvidence,
				benchmarkIds: job.benchmarkIds,
				priorStage,
				pins: this.options.pins,
			});
			const expectedHandle = nanoGptScoredExternalHandle(request.requestDigest);
			if (externalHandle !== null && parseNanoGptScoredExternalHandle(externalHandle) !== request.requestDigest) {
				throw new Error("NanoGPT scored external handle does not belong to this exact request");
			}
			const existing = await this.store.load(stageIdentity, mode);
			if (existing) {
				if (
					existing.receipt.jobId !== job.jobId ||
					existing.receipt.manifestDigest !== job.manifestDigest ||
					existing.receipt.requestDigest !== request.requestDigest
				) {
					throw new Error("NanoGPT candidate stage is already owned by a different controller job");
				}
				await this.verifyRecoveredArchive(existing);
				return this.outcome(existing, true, apparatusAttempt);
			}
			let rawResult: unknown;
			if (externalHandle === null) {
				await context.recordExternalJobId(expectedHandle);
				rawResult = await this.transport.execute(request, candidatePatch, context.signal);
			} else {
				if (!this.transport.resume) {
					throw new Error("Configured NanoGPT scored transport cannot resume its durable external handle");
				}
				rawResult = await this.transport.resume(request, candidatePatch, externalHandle, context.signal);
			}
			const { completion, assessment } = assessTransportCompletion(rawResult, request);
			if (!assessment.accepted) {
				return this.outcomeFromAssessment(request, assessment, completion, null, false, apparatusAttempt);
			}
			const completed = await this.store.create(request, assessment, completion, this.now());
			return this.outcome(completed, false, apparatusAttempt);
		});
	}

	evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		return this.run(job, context, null);
	}

	resume(job: EvaluationJob, externalJobId: string, context: EvaluationContext): Promise<EvaluationOutcome> {
		return this.run(job, context, externalJobId);
	}
}

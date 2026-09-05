import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { KernelBenchTransientTransportError } from "./kernelbench-qualification-adapter.js";
import { NANOGPT_BASELINE_TRAIN_STEPS } from "./nanogpt-contract.js";
import {
	type NanoGptScoredReceipt,
	type NanoGptScoredStaticGate,
	validateNanoGptScoredCandidatePatch,
} from "./nanogpt-scored-adapter.js";
import {
	buildNanoGptScoredParallelStageReceipt,
	buildNanoGptScoredParallelStageRequest,
	buildNanoGptScoredParallelStageResult,
	type NanoGptScoredParallelMode,
	type NanoGptScoredParallelPins,
	type NanoGptScoredParallelPriorStage,
	type NanoGptScoredParallelStageReceipt,
	type NanoGptScoredParallelStageRequest,
	type NanoGptScoredParallelStageResult,
	type NanoGptScoredV1ScoreOneBridge,
	nanoGptScoredParallelBenchmarkIds,
	nanoGptScoredParallelBoundaryConditions,
	nanoGptScoredParallelExternalHandle,
	nanoGptScoredParallelStageIdentity,
	nanoGptScoredParallelVerifierEpoch,
	parseNanoGptScoredParallelExternalHandle,
	parseNanoGptScoredParallelStageReceipt,
	parseNanoGptScoredParallelStageResult,
	verifyNanoGptScoredParallelStageRequest,
} from "./nanogpt-scored-parallel-protocol.js";
import type {
	NanoGptScoredParallelTransport,
	NanoGptScoredParallelTransportCompletion,
} from "./nanogpt-scored-parallel-transport.js";
import {
	NanoGptScoredParallelAmbiguousDispatchError,
	NanoGptScoredParallelReconcileTimeoutError,
} from "./nanogpt-scored-parallel-transport.js";
import {
	assessNanoGptScoredWorkerResult,
	NANOGPT_SCORED_CONTRACT_ID,
	NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND,
	type NanoGptScoredRequest,
	type NanoGptScoredStaticEvidence,
	type NanoGptScoredVerifierPins,
	nanoGptScoredStageIdentity,
	nanoGptScoredVerifierEpoch,
	verifyNanoGptScoredRequest,
} from "./nanogpt-scored-protocol.js";
import type { ArtifactRef, EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome } from "./types.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const APPARATUS_ATTEMPT_PATTERN = /^apparatusAttempt=(0|[1-9][0-9]*)$/;

export interface NanoGptScoredParallelV1GateConfig {
	readonly stateDir: string;
	readonly transportEvidenceDir: string;
	readonly branchId: string;
	readonly treatment: string;
	readonly pins: NanoGptScoredVerifierPins;
}

export type NanoGptScoredParallelV1BridgeLoader = (
	job: EvaluationJob,
	staticEvidence: NanoGptScoredStaticEvidence,
) => Promise<NanoGptScoredV1ScoreOneBridge>;

export interface NanoGptScoredParallelAdapterOptions {
	readonly stateDir: string;
	readonly pins: NanoGptScoredParallelPins;
	readonly transport: NanoGptScoredParallelTransport;
	readonly v1Gate?: NanoGptScoredParallelV1GateConfig;
	readonly v1BridgeLoader?: NanoGptScoredParallelV1BridgeLoader;
	readonly staticGate?: NanoGptScoredStaticGate;
	readonly now?: () => Date;
}

export interface StoredNanoGptScoredParallelReceipt {
	readonly schemaVersion: 1;
	readonly contract: "nanogpt-track3-scored-parallel-confirmatory-v2";
	readonly verifierEpoch: string;
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly jobId: string;
	readonly manifestDigest: string;
	readonly requestArtifact: ArtifactRef;
	readonly resultArtifact: ArtifactRef;
	readonly transportArtifact: ArtifactRef;
	readonly stageReceipt: NanoGptScoredParallelStageReceipt;
	readonly completedAt: string;
}

interface LoadedParallelReceipt {
	readonly stored: StoredNanoGptScoredParallelReceipt;
	readonly request: NanoGptScoredParallelStageRequest;
	readonly result: NanoGptScoredParallelStageResult;
	readonly transport: NanoGptScoredParallelTransportCompletion;
}

interface StageDispatchIntentBody {
	readonly schemaVersion: 1;
	readonly contract: "nanogpt-track3-scored-parallel-confirmatory-v2";
	readonly verifierEpoch: string;
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly apparatusAttempt: number;
	readonly requestDigest: string;
	readonly jobId: string;
	readonly manifestDigest: string;
}

interface StageDispatchIntent extends StageDispatchIntentBody {
	readonly intentDigest: string;
}

interface RetryableStageFailureBody {
	readonly schemaVersion: 1;
	readonly contract: "nanogpt-track3-scored-parallel-confirmatory-v2";
	readonly stageIdentity: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly apparatusAttempt: number;
	readonly requestDigest: string;
	readonly intentDigest: string;
	readonly failureKind: "drained-whole-stage";
	readonly retrySafe: true;
}

interface RetryableStageFailure extends RetryableStageFailureBody {
	readonly failureDigest: string;
}

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
	return value;
}

function sha256(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!SHA256_PATTERN.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return parsed;
}

function artifact(value: unknown, path: string): ArtifactRef {
	const parsed = record(value, path);
	exactKeys(parsed, ["digest", "byteLength", "mediaType"], path);
	const byteLength = parsed.byteLength;
	if (!Number.isSafeInteger(byteLength) || Number(byteLength) < 1) {
		throw new Error(`${path}.byteLength must be a positive safe integer`);
	}
	return {
		digest: sha256(parsed.digest, `${path}.digest`),
		byteLength: Number(byteLength),
		mediaType: string(parsed.mediaType, `${path}.mediaType`),
	};
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function currentUid(): number | null {
	return typeof process.getuid === "function" ? process.getuid() : null;
}

function assertOwnedDirectory(metadata: Awaited<ReturnType<typeof lstat>>, path: string): void {
	const uid = currentUid();
	if (
		!metadata.isDirectory() ||
		metadata.isSymbolicLink() ||
		(uid !== null && metadata.uid !== uid) ||
		(Number(metadata.mode) & 0o777) !== 0o700
	) {
		throw new Error(`NanoGPT parallel state directory is unsafe: ${path}`);
	}
}

async function ensureSafeRoot(rootDir: string): Promise<void> {
	await mkdir(rootDir, { recursive: true, mode: 0o700 });
	if ((await realpath(rootDir)) !== rootDir) {
		throw new Error(`NanoGPT parallel state root traverses a symbolic link: ${rootDir}`);
	}
	assertOwnedDirectory(await lstat(rootDir), rootDir);
}

async function ensureSafeDirectory(rootDir: string, targetDir: string): Promise<void> {
	await ensureSafeRoot(rootDir);
	const route = relative(rootDir, targetDir);
	if (route.startsWith("..") || resolve(rootDir, route) !== targetDir) {
		throw new Error(`NanoGPT parallel state path escaped its root: ${targetDir}`);
	}
	let current = rootDir;
	for (const component of route.split("/").filter(Boolean)) {
		if ([".", ".."].includes(component)) throw new Error(`NanoGPT parallel state path is unsafe: ${targetDir}`);
		current = join(current, component);
		try {
			await mkdir(current, { mode: 0o700 });
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
		}
		assertOwnedDirectory(await lstat(current), current);
	}
}

async function readSafeFile(path: string): Promise<string> {
	const before = await lstat(path);
	const uid = currentUid();
	if (
		!before.isFile() ||
		before.isSymbolicLink() ||
		before.nlink !== 1 ||
		(uid !== null && before.uid !== uid) ||
		(before.mode & 0o777) !== 0o600
	) {
		throw new Error(`NanoGPT parallel state file is unsafe: ${path}`);
	}
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const after = await handle.stat();
		if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) {
			throw new Error(`NanoGPT parallel state file changed during open: ${path}`);
		}
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

async function writeOnceSafe(rootDir: string, path: string, source: string): Promise<string> {
	await ensureSafeDirectory(rootDir, dirname(path));
	try {
		const handle = await open(
			path,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await handle.writeFile(source, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	} catch (error) {
		if (!isAlreadyExists(error)) throw error;
	}
	return readSafeFile(path);
}

function artifactPath(rootDir: string, digest: string): string {
	sha256(digest, "artifact.digest");
	return join(rootDir, "artifacts", "sha256", digest.slice(0, 2), digest.slice(2));
}

async function putSafeArtifact(rootDir: string, content: string, mediaType: string): Promise<ArtifactRef> {
	const digest = sha256Text(content);
	const path = artifactPath(rootDir, digest);
	const observed = await writeOnceSafe(rootDir, path, content);
	if (observed !== content) throw new Error(`NanoGPT parallel artifact digest collision at ${digest}`);
	return { digest, byteLength: Buffer.byteLength(content), mediaType };
}

async function readSafeArtifact(rootDir: string, ref: ArtifactRef): Promise<string> {
	await ensureSafeDirectory(rootDir, dirname(artifactPath(rootDir, ref.digest)));
	const content = await readSafeFile(artifactPath(rootDir, ref.digest));
	if (sha256Text(content) !== ref.digest || Buffer.byteLength(content) !== ref.byteLength) {
		throw new Error(`NanoGPT parallel artifact changed: ${ref.digest}`);
	}
	return content;
}

function parseUtcTimestamp(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!parsed.endsWith("Z") || !Number.isFinite(Date.parse(parsed)))
		throw new Error(`${path} must be a UTC timestamp`);
	return parsed;
}

function parseV1Scheduler(value: unknown, requestDigest: string): NanoGptScoredReceipt["scheduler"] {
	const parsed = record(value, "NanoGPT v1 gate scheduler");
	exactKeys(parsed, ["slurmJobId", "jobName", "workDir", "state", "exitCode"], "NanoGPT v1 gate scheduler");
	const scheduler = {
		slurmJobId: string(parsed.slurmJobId, "NanoGPT v1 gate scheduler.slurmJobId"),
		jobName: string(parsed.jobName, "NanoGPT v1 gate scheduler.jobName"),
		workDir: string(parsed.workDir, "NanoGPT v1 gate scheduler.workDir"),
		state: parsed.state,
		exitCode: parsed.exitCode,
	};
	if (
		!/^[1-9][0-9]*$/.test(scheduler.slurmJobId) ||
		scheduler.jobName !== `pngs-${requestDigest.slice(0, 24)}` ||
		resolve(scheduler.workDir) !== scheduler.workDir ||
		scheduler.state !== "COMPLETED" ||
		scheduler.exitCode !== "0:0"
	) {
		throw new Error("NanoGPT v1 gate lacks authoritative scheduler completion evidence");
	}
	return { ...scheduler, state: "COMPLETED", exitCode: "0:0" };
}

interface V1ArchiveInventory {
	readonly digests: ReadonlySet<string>;
	readonly logs: readonly { readonly digest: string; readonly byteLength: number; readonly relativePath: string }[];
}

function parseV1ArchiveInventory(source: string, requestDigest: string): V1ArchiveInventory {
	if (!source.endsWith("\n")) throw new Error("NanoGPT v1 gate archive manifest is not newline terminated");
	const parsed = record(JSON.parse(source), "NanoGPT v1 gate archive manifest");
	exactKeys(parsed, ["schemaVersion", "requestDigest", "logs"], "NanoGPT v1 gate archive manifest");
	if (parsed.schemaVersion !== 1 || parsed.requestDigest !== requestDigest || !Array.isArray(parsed.logs)) {
		throw new Error("NanoGPT v1 gate archive manifest identity changed");
	}
	const digests = new Set<string>();
	const logs: Array<{ readonly digest: string; readonly byteLength: number; readonly relativePath: string }> = [];
	for (const [index, value] of parsed.logs.entries()) {
		const log = record(value, `NanoGPT v1 gate archive manifest.logs[${index}]`);
		exactKeys(
			log,
			["remoteName", "logSha256", "byteLength", "relativePath"],
			`NanoGPT v1 gate archive manifest.logs[${index}]`,
		);
		const remoteName = string(log.remoteName, `NanoGPT v1 gate archive manifest.logs[${index}].remoteName`);
		if (
			!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remoteName) ||
			remoteName.split("/").some((part) => ["", ".", ".."].includes(part)) ||
			!Number.isSafeInteger(log.byteLength) ||
			Number(log.byteLength) < 0
		) {
			throw new Error(`NanoGPT v1 gate archive log ${index} is unsafe`);
		}
		const digest = sha256(log.logSha256, `NanoGPT v1 gate archive manifest.logs[${index}].logSha256`);
		const relativePath = `logs/${digest}.log`;
		if (log.relativePath !== relativePath || digests.has(digest)) {
			throw new Error(`NanoGPT v1 gate archive log ${index} is not content addressed or unique`);
		}
		digests.add(digest);
		logs.push({ digest, byteLength: Number(log.byteLength), relativePath });
	}
	if (`${canonicalJson(toJsonValue(parsed))}\n` !== source) {
		throw new Error("NanoGPT v1 gate archive manifest is not canonical JSON");
	}
	return { digests, logs };
}

async function verifyV1PhysicalArchive(
	rootDir: string,
	requestDigest: string,
	manifestSource: string,
	inventory: V1ArchiveInventory,
): Promise<void> {
	if (resolve(rootDir) !== rootDir) throw new Error("NanoGPT v1 transportEvidenceDir must be absolute and normalized");
	const requestRoot = join(rootDir, requestDigest.slice(0, 2), requestDigest);
	await ensureSafeDirectory(rootDir, join(requestRoot, "logs"));
	if ((await readSafeFile(join(requestRoot, "manifest.json"))) !== manifestSource) {
		throw new Error("NanoGPT v1 physical archive manifest changed");
	}
	for (const log of inventory.logs) {
		const content = await readSafeFile(join(requestRoot, log.relativePath));
		if (Buffer.byteLength(content) !== log.byteLength || sha256Text(content) !== log.digest) {
			throw new Error(`NanoGPT v1 physical archived log changed: ${log.relativePath}`);
		}
	}
}

export function nanoGptScoredParallelApparatusAttemptBoundaryCondition(attempt: number): string {
	if (!Number.isSafeInteger(attempt) || attempt < 0) throw new Error("NanoGPT parallel apparatus attempt is invalid");
	return `apparatusAttempt=${attempt}`;
}

export function parseNanoGptScoredParallelApparatusAttempt(
	conditions: readonly string[],
	pins: NanoGptScoredParallelPins,
): number {
	const fixed = nanoGptScoredParallelBoundaryConditions(pins);
	if (
		conditions.length !== fixed.length + 1 ||
		!conditions.slice(0, fixed.length).every((condition, index) => condition === fixed[index])
	) {
		throw new Error("NanoGPT parallel proposal boundary conditions changed");
	}
	const match = APPARATUS_ATTEMPT_PATTERN.exec(conditions.at(-1) ?? "");
	if (!match) throw new Error("NanoGPT parallel apparatus attempt boundary is invalid");
	return Number(match[1]);
}

export function nanoGptScoredParallelBudgetClass(mode: NanoGptScoredParallelMode): "smoke" | "screen" | "confirm" {
	if (mode === "smoke-10") return "smoke";
	return mode === "score-3" ? "screen" : "confirm";
}

export function inferNanoGptScoredParallelMode(benchmarkIds: readonly string[]): NanoGptScoredParallelMode {
	for (const mode of ["smoke-10", "score-3", "replay-8"] as const) {
		const expected = nanoGptScoredParallelBenchmarkIds(mode);
		if (benchmarkIds.length === expected.length && benchmarkIds.every((value, index) => value === expected[index])) {
			return mode;
		}
	}
	throw new Error("Benchmark IDs do not identify an exact NanoGPT parallel mode");
}

function parseStageDispatchIntent(value: unknown): StageDispatchIntent {
	const parsed = record(value, "NanoGPT parallel stage dispatch intent");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"verifierEpoch",
			"stageIdentity",
			"mode",
			"apparatusAttempt",
			"requestDigest",
			"jobId",
			"manifestDigest",
			"intentDigest",
		],
		"NanoGPT parallel stage dispatch intent",
	);
	if (
		parsed.schemaVersion !== 1 ||
		parsed.contract !== "nanogpt-track3-scored-parallel-confirmatory-v2" ||
		!(["smoke-10", "score-3", "replay-8"] as const).includes(parsed.mode as NanoGptScoredParallelMode) ||
		!Number.isSafeInteger(parsed.apparatusAttempt) ||
		Number(parsed.apparatusAttempt) < 0
	) {
		throw new Error("NanoGPT parallel stage dispatch intent identity changed");
	}
	const body: StageDispatchIntentBody = {
		schemaVersion: 1,
		contract: "nanogpt-track3-scored-parallel-confirmatory-v2",
		verifierEpoch: string(parsed.verifierEpoch, "stageIntent.verifierEpoch"),
		stageIdentity: sha256(parsed.stageIdentity, "stageIntent.stageIdentity"),
		mode: parsed.mode as NanoGptScoredParallelMode,
		apparatusAttempt: Number(parsed.apparatusAttempt),
		requestDigest: sha256(parsed.requestDigest, "stageIntent.requestDigest"),
		jobId: string(parsed.jobId, "stageIntent.jobId"),
		manifestDigest: sha256(parsed.manifestDigest, "stageIntent.manifestDigest"),
	};
	const intentDigest = sha256(parsed.intentDigest, "stageIntent.intentDigest");
	if (intentDigest !== sha256Json(body)) throw new Error("NanoGPT parallel stage dispatch intent digest changed");
	return { ...body, intentDigest };
}

function parseRetryableStageFailure(value: unknown): RetryableStageFailure {
	const parsed = record(value, "NanoGPT parallel retryable stage failure");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"contract",
			"stageIdentity",
			"mode",
			"apparatusAttempt",
			"requestDigest",
			"intentDigest",
			"failureKind",
			"retrySafe",
			"failureDigest",
		],
		"NanoGPT parallel retryable stage failure",
	);
	if (
		parsed.schemaVersion !== 1 ||
		parsed.contract !== "nanogpt-track3-scored-parallel-confirmatory-v2" ||
		!(["smoke-10", "score-3", "replay-8"] as const).includes(parsed.mode as NanoGptScoredParallelMode) ||
		!Number.isSafeInteger(parsed.apparatusAttempt) ||
		Number(parsed.apparatusAttempt) < 0 ||
		parsed.failureKind !== "drained-whole-stage" ||
		parsed.retrySafe !== true
	) {
		throw new Error("NanoGPT parallel retryable stage failure identity changed");
	}
	const body: RetryableStageFailureBody = {
		schemaVersion: 1,
		contract: "nanogpt-track3-scored-parallel-confirmatory-v2",
		stageIdentity: sha256(parsed.stageIdentity, "stageFailure.stageIdentity"),
		mode: parsed.mode as NanoGptScoredParallelMode,
		apparatusAttempt: Number(parsed.apparatusAttempt),
		requestDigest: sha256(parsed.requestDigest, "stageFailure.requestDigest"),
		intentDigest: sha256(parsed.intentDigest, "stageFailure.intentDigest"),
		failureKind: "drained-whole-stage",
		retrySafe: true,
	};
	const failureDigest = sha256(parsed.failureDigest, "stageFailure.failureDigest");
	if (failureDigest !== sha256Json(body)) throw new Error("NanoGPT parallel retryable stage failure digest changed");
	return { ...body, failureDigest };
}

function containsUnsafeRetryError(error: unknown): boolean {
	if (
		error instanceof NanoGptScoredParallelAmbiguousDispatchError ||
		error instanceof NanoGptScoredParallelReconcileTimeoutError ||
		error instanceof KernelBenchTransientTransportError
	) {
		return true;
	}
	return error instanceof AggregateError && error.errors.some(containsUnsafeRetryError);
}

function _isDrainedWholeStageFailure(error: unknown, signal: AbortSignal): boolean {
	return (
		error instanceof AggregateError && error.errors.length > 0 && !signal.aborted && !containsUnsafeRetryError(error)
	);
}

function v1ReceiptPath(stateDir: string, stageIdentity: string): string {
	return join(stateDir, "slots", stageIdentity.slice(0, 2), stageIdentity, "score-1.json");
}

async function readV1ReceiptSource(stateDir: string, stageIdentity: string): Promise<string> {
	const path = v1ReceiptPath(stateDir, stageIdentity);
	await ensureSafeDirectory(stateDir, dirname(path));
	const source = await readSafeFile(path);
	if (!source.endsWith("\n")) throw new Error("NanoGPT v1 score-1 gate receipt is not newline terminated");
	return source;
}

export async function loadNanoGptScoredV1ScoreOneBridge(input: {
	readonly config: NanoGptScoredParallelV1GateConfig;
	readonly candidatePatchSha256: string;
	readonly candidateSha256: string;
	readonly trainSteps: number;
}): Promise<NanoGptScoredV1ScoreOneBridge> {
	const stateDir = resolve(input.config.stateDir);
	if (stateDir !== input.config.stateDir) throw new Error("NanoGPT v1 gate stateDir must be absolute and normalized");
	const verifierEpoch = nanoGptScoredVerifierEpoch(input.config.pins);
	const stageIdentity = nanoGptScoredStageIdentity({
		branchId: input.config.branchId,
		treatment: input.config.treatment,
		verifierEpoch,
		candidatePatchSha256: input.candidatePatchSha256,
		candidateSha256: input.candidateSha256,
	});
	const source = await readV1ReceiptSource(stateDir, stageIdentity);
	const parsed = record(JSON.parse(source), "NanoGPT v1 score-1 gate receipt");
	exactKeys(
		parsed,
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
		"NanoGPT v1 score-1 gate receipt",
	);
	const receipt = parsed as unknown as NanoGptScoredReceipt;
	if (
		receipt.schemaVersion !== 1 ||
		receipt.contract !== NANOGPT_SCORED_CONTRACT_ID ||
		receipt.verifierEpoch !== verifierEpoch ||
		receipt.stageIdentity !== stageIdentity ||
		receipt.mode !== "score-1" ||
		receipt.accepted !== true ||
		receipt.thresholdPassed !== true ||
		receipt.frontierEligible !== false ||
		receipt.recordEligible !== false
	) {
		throw new Error("NanoGPT v1 score-1 gate is not an exact accepted threshold-passing receipt");
	}
	parseUtcTimestamp(receipt.completedAt, "NanoGPT v1 score-1 gate completedAt");
	const requestDigest = sha256(receipt.requestDigest, "NanoGPT v1 gate requestDigest");
	const resultDigest = sha256(receipt.resultDigest, "NanoGPT v1 gate resultDigest");
	const archiveManifestSha256 = sha256(receipt.archiveManifestSha256, "NanoGPT v1 gate archiveManifestSha256");
	sha256(receipt.jobScriptSha256, "NanoGPT v1 gate jobScriptSha256");
	const scheduler = parseV1Scheduler(receipt.scheduler, requestDigest);
	const requestArtifact = artifact(receipt.requestArtifact, "NanoGPT v1 gate requestArtifact");
	const resultArtifact = artifact(receipt.resultArtifact, "NanoGPT v1 gate resultArtifact");
	const archiveArtifact = artifact(receipt.archiveManifestArtifact, "NanoGPT v1 gate archiveManifestArtifact");
	if (
		requestArtifact.mediaType !== "application/json" ||
		resultArtifact.mediaType !== "application/json" ||
		archiveArtifact.mediaType !== "application/json"
	) {
		throw new Error("NanoGPT v1 gate artifact media types changed");
	}
	const canonicalReceipt = {
		...receipt,
		requestDigest,
		resultDigest,
		scheduler,
		archiveManifestSha256,
		requestArtifact,
		resultArtifact,
		archiveManifestArtifact: archiveArtifact,
	};
	if (`${canonicalJson(toJsonValue(canonicalReceipt))}\n` !== source) {
		throw new Error("NanoGPT v1 score-1 gate receipt is not canonical JSON");
	}
	const [requestSource, resultSource, archiveSource] = await Promise.all([
		readSafeArtifact(stateDir, requestArtifact),
		readSafeArtifact(stateDir, resultArtifact),
		readSafeArtifact(stateDir, archiveArtifact),
	]);
	const request = JSON.parse(requestSource) as NanoGptScoredRequest;
	verifyNanoGptScoredRequest(request);
	const assessment = assessNanoGptScoredWorkerResult(JSON.parse(resultSource), request);
	const archiveInventory = parseV1ArchiveInventory(archiveSource, request.requestDigest);
	await verifyV1PhysicalArchive(
		input.config.transportEvidenceDir,
		request.requestDigest,
		archiveSource,
		archiveInventory,
	);
	if (
		request.mode !== "score-1" ||
		request.requestDigest !== receipt.requestDigest ||
		request.verifierEpoch !== receipt.verifierEpoch ||
		request.stageIdentity !== receipt.stageIdentity ||
		request.jobId !== receipt.jobId ||
		request.manifestDigest !== receipt.manifestDigest ||
		request.candidatePatch.digest !== input.candidatePatchSha256 ||
		request.staticEvidence.candidateSha256 !== input.candidateSha256 ||
		request.staticEvidence.trainSteps !== input.trainSteps ||
		assessment.resultDigest !== receipt.resultDigest ||
		resultArtifact.digest !== receipt.resultDigest ||
		receipt.scheduler.slurmJobId !== assessment.result.slurmJobId ||
		assessment.result.trials.some((trial) => !archiveInventory.digests.has(trial.logSha256)) ||
		assessment.accepted !== true ||
		assessment.thresholdPassed !== true ||
		assessment.meanValidationLoss !== receipt.meanValidationLoss ||
		archiveArtifact.digest !== receipt.archiveManifestSha256 ||
		sha256Text(archiveSource) !== receipt.archiveManifestSha256 ||
		archiveArtifact.byteLength !== Buffer.byteLength(archiveSource, "utf8")
	) {
		throw new Error("NanoGPT v1 score-1 gate request, result, archive, and receipt disagree");
	}
	return {
		contract: NANOGPT_SCORED_CONTRACT_ID,
		mode: "score-1",
		verifierEpoch,
		stageIdentity,
		requestDigest: receipt.requestDigest,
		resultDigest: receipt.resultDigest,
		receiptDigest: sha256Json(canonicalReceipt),
		candidateSha256: input.candidateSha256,
		trainSteps: input.trainSteps,
		meanValidationLossExclusiveUpperBound: NANOGPT_SCORED_MEAN_LOSS_EXCLUSIVE_UPPER_BOUND,
		accepted: true,
		thresholdPassed: true,
		numericMeasurementsReused: false,
	};
}

class ParallelEvidenceStore {
	constructor(private readonly rootDir: string) {}

	private path(stageIdentity: string, mode: NanoGptScoredParallelMode): string {
		sha256(stageIdentity, "stageIdentity");
		return join(this.rootDir, "slots", stageIdentity.slice(0, 2), stageIdentity, `${mode}.json`);
	}

	private intentPath(stageIdentity: string, mode: NanoGptScoredParallelMode, apparatusAttempt: number): string {
		return join(
			this.rootDir,
			"slots",
			stageIdentity.slice(0, 2),
			stageIdentity,
			`${mode}.attempt-${apparatusAttempt}.dispatch-intent.json`,
		);
	}

	private failurePath(stageIdentity: string, mode: NanoGptScoredParallelMode, apparatusAttempt: number): string {
		return join(
			this.rootDir,
			"slots",
			stageIdentity.slice(0, 2),
			stageIdentity,
			`${mode}.attempt-${apparatusAttempt}.retryable-failure.json`,
		);
	}

	async claimDispatch(
		request: NanoGptScoredParallelStageRequest,
		apparatusAttemptValue: number,
	): Promise<StageDispatchIntent> {
		if (!Number.isSafeInteger(apparatusAttemptValue) || apparatusAttemptValue < 0) {
			throw new Error("NanoGPT parallel apparatus attempt is outside its nonnegative integer bound");
		}
		const apparatusAttempt = apparatusAttemptValue;
		if (apparatusAttempt > 0) {
			let previousSource: string;
			const previousAttempt = apparatusAttempt - 1;
			try {
				const previousPath = this.failurePath(request.stageIdentity, request.mode, previousAttempt);
				await ensureSafeDirectory(this.rootDir, dirname(previousPath));
				previousSource = await readSafeFile(previousPath);
			} catch (error) {
				if (isMissing(error)) {
					throw new Error("NanoGPT parallel apparatus retry lacks a durable retry-safe prior-stage failure");
				}
				throw error;
			}
			const previous = parseRetryableStageFailure(JSON.parse(previousSource));
			if (
				previous.stageIdentity !== request.stageIdentity ||
				previous.mode !== request.mode ||
				previous.apparatusAttempt !== previousAttempt
			) {
				throw new Error("NanoGPT parallel apparatus retry does not continue the exact failed stage");
			}
		}
		const body: StageDispatchIntentBody = {
			schemaVersion: 1,
			contract: "nanogpt-track3-scored-parallel-confirmatory-v2",
			verifierEpoch: request.verifierEpoch,
			stageIdentity: request.stageIdentity,
			mode: request.mode,
			apparatusAttempt,
			requestDigest: request.requestDigest,
			jobId: request.jobId,
			manifestDigest: request.manifestDigest,
		};
		const expected: StageDispatchIntent = { ...body, intentDigest: sha256Json(body) };
		const path = this.intentPath(request.stageIdentity, request.mode, apparatusAttempt);
		const observed = parseStageDispatchIntent(
			JSON.parse(await writeOnceSafe(this.rootDir, path, `${canonicalJson(toJsonValue(expected))}\n`)),
		);
		if (sha256Json(observed) !== sha256Json(expected)) {
			throw new Error("A conflicting NanoGPT parallel controller owns this exact stage attempt");
		}
		return observed;
	}

	async recordRetryableFailure(request: NanoGptScoredParallelStageRequest, apparatusAttempt: number): Promise<void> {
		if (!Number.isSafeInteger(apparatusAttempt) || apparatusAttempt < 0) {
			throw new Error("NanoGPT parallel apparatus failure attempt is outside its fixed bound");
		}
		const intentPath = this.intentPath(request.stageIdentity, request.mode, apparatusAttempt);
		await ensureSafeDirectory(this.rootDir, dirname(intentPath));
		const intent = parseStageDispatchIntent(JSON.parse(await readSafeFile(intentPath)));
		if (intent.requestDigest !== request.requestDigest) {
			throw new Error("NanoGPT parallel retry marker does not own the exact failed request");
		}
		const body: RetryableStageFailureBody = {
			schemaVersion: 1,
			contract: "nanogpt-track3-scored-parallel-confirmatory-v2",
			stageIdentity: request.stageIdentity,
			mode: request.mode,
			apparatusAttempt,
			requestDigest: request.requestDigest,
			intentDigest: intent.intentDigest,
			failureKind: "drained-whole-stage",
			retrySafe: true,
		};
		const failure: RetryableStageFailure = { ...body, failureDigest: sha256Json(body) };
		const observed = parseRetryableStageFailure(
			JSON.parse(
				await writeOnceSafe(
					this.rootDir,
					this.failurePath(request.stageIdentity, request.mode, apparatusAttempt),
					`${canonicalJson(toJsonValue(failure))}\n`,
				),
			),
		);
		if (sha256Json(observed) !== sha256Json(failure)) {
			throw new Error("NanoGPT parallel retryable failure marker conflicts with its exact request");
		}
	}

	private async put(value: unknown): Promise<ArtifactRef> {
		return putSafeArtifact(this.rootDir, canonicalJson(toJsonValue(value)), "application/json");
	}

	async load(stageIdentity: string, mode: NanoGptScoredParallelMode): Promise<LoadedParallelReceipt | null> {
		let source: string;
		try {
			const path = this.path(stageIdentity, mode);
			await ensureSafeDirectory(this.rootDir, dirname(path));
			source = await readSafeFile(path);
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
		if (!source.endsWith("\n")) throw new Error("NanoGPT parallel stored receipt is not newline terminated");
		const parsed = record(JSON.parse(source), "NanoGPT parallel stored receipt");
		exactKeys(
			parsed,
			[
				"schemaVersion",
				"contract",
				"verifierEpoch",
				"stageIdentity",
				"mode",
				"jobId",
				"manifestDigest",
				"requestArtifact",
				"resultArtifact",
				"transportArtifact",
				"stageReceipt",
				"completedAt",
			],
			"NanoGPT parallel stored receipt",
		);
		const requestArtifact = artifact(parsed.requestArtifact, "stored.requestArtifact");
		const resultArtifact = artifact(parsed.resultArtifact, "stored.resultArtifact");
		const transportArtifact = artifact(parsed.transportArtifact, "stored.transportArtifact");
		const request = JSON.parse(
			await readSafeArtifact(this.rootDir, requestArtifact),
		) as NanoGptScoredParallelStageRequest;
		verifyNanoGptScoredParallelStageRequest(request);
		const resultValue: unknown = JSON.parse(await readSafeArtifact(this.rootDir, resultArtifact));
		const result = parseNanoGptScoredParallelStageResult(resultValue, request);
		const transportValue: unknown = JSON.parse(await readSafeArtifact(this.rootDir, transportArtifact));
		const transportRecord = record(transportValue, "stored.transport");
		exactKeys(
			transportRecord,
			["schemaVersion", "stageRequestDigest", "externalHandle", "children"],
			"stored.transport",
		);
		if (!Array.isArray(transportRecord.children)) throw new Error("stored.transport.children must be an array");
		const transport: NanoGptScoredParallelTransportCompletion = {
			schemaVersion: 1,
			stageRequestDigest: sha256(transportRecord.stageRequestDigest, "stored.transport.stageRequestDigest"),
			externalHandle: string(transportRecord.externalHandle, "stored.transport.externalHandle"),
			children: result.children,
		};
		if (
			transportRecord.schemaVersion !== 1 ||
			transport.stageRequestDigest !== request.requestDigest ||
			transport.externalHandle !== nanoGptScoredParallelExternalHandle(request.requestDigest) ||
			sha256Json(transportRecord.children) !== sha256Json(result.children)
		) {
			throw new Error("NanoGPT parallel stored transport does not bind the exact result children");
		}
		const stageReceipt = parseNanoGptScoredParallelStageReceipt(parsed.stageReceipt, request, result);
		const stored: StoredNanoGptScoredParallelReceipt = {
			schemaVersion: 1,
			contract: "nanogpt-track3-scored-parallel-confirmatory-v2",
			verifierEpoch: string(parsed.verifierEpoch, "stored.verifierEpoch"),
			stageIdentity,
			mode,
			jobId: string(parsed.jobId, "stored.jobId"),
			manifestDigest: sha256(parsed.manifestDigest, "stored.manifestDigest"),
			requestArtifact,
			resultArtifact,
			transportArtifact,
			stageReceipt,
			completedAt: parseUtcTimestamp(parsed.completedAt, "stored.completedAt"),
		};
		if (
			parsed.schemaVersion !== 1 ||
			parsed.contract !== stored.contract ||
			stored.verifierEpoch !== request.verifierEpoch ||
			parsed.stageIdentity !== stageIdentity ||
			parsed.mode !== mode ||
			stored.jobId !== request.jobId ||
			stored.manifestDigest !== request.manifestDigest ||
			`${canonicalJson(toJsonValue(stored))}\n` !== source
		) {
			throw new Error("NanoGPT parallel stored receipt is not exact or canonical");
		}
		return { stored, request, result, transport };
	}

	async create(
		request: NanoGptScoredParallelStageRequest,
		result: NanoGptScoredParallelStageResult,
		transport: NanoGptScoredParallelTransportCompletion,
		completedAt: string,
	): Promise<LoadedParallelReceipt> {
		const stageReceipt = buildNanoGptScoredParallelStageReceipt(request, result);
		if (
			transport.schemaVersion !== 1 ||
			transport.stageRequestDigest !== request.requestDigest ||
			transport.externalHandle !== nanoGptScoredParallelExternalHandle(request.requestDigest)
		) {
			throw new Error("NanoGPT parallel transport identity changed before durable storage");
		}
		const canonicalTransport: NanoGptScoredParallelTransportCompletion = {
			schemaVersion: 1,
			stageRequestDigest: request.requestDigest,
			externalHandle: nanoGptScoredParallelExternalHandle(request.requestDigest),
			children: result.children,
		};
		const [requestArtifact, resultArtifact, transportArtifact] = await Promise.all([
			this.put(request),
			this.put(result),
			this.put(canonicalTransport),
		]);
		const stored: StoredNanoGptScoredParallelReceipt = {
			schemaVersion: 1,
			contract: "nanogpt-track3-scored-parallel-confirmatory-v2",
			verifierEpoch: request.verifierEpoch,
			stageIdentity: request.stageIdentity,
			mode: request.mode,
			jobId: request.jobId,
			manifestDigest: request.manifestDigest,
			requestArtifact,
			resultArtifact,
			transportArtifact,
			stageReceipt,
			completedAt,
		};
		const path = this.path(request.stageIdentity, request.mode);
		await writeOnceSafe(this.rootDir, path, `${canonicalJson(toJsonValue(stored))}\n`);
		const loaded = await this.load(request.stageIdentity, request.mode);
		if (!loaded || sha256Json(loaded.stored) !== sha256Json(stored)) {
			throw new Error("A conflicting NanoGPT parallel receipt already exists");
		}
		return loaded;
	}
}

export class NanoGptScoredParallelAdapter implements EvaluationAdapter {
	readonly lane = "nanogpt" as const;
	private readonly store: ParallelEvidenceStore;
	private readonly staticGate: NanoGptScoredStaticGate;
	private readonly bridgeLoader: NanoGptScoredParallelV1BridgeLoader | null;
	private readonly staticEvidence = new Map<string, Promise<NanoGptScoredStaticEvidence>>();
	private readonly stageTails = new Map<string, Promise<void>>();

	constructor(private readonly options: NanoGptScoredParallelAdapterOptions) {
		if (resolve(options.stateDir) !== options.stateDir) {
			throw new Error("NanoGPT parallel stateDir must be absolute and normalized");
		}
		if (options.v1BridgeLoader && options.v1Gate) {
			throw new Error("Configure either a NanoGPT v1 bridge loader or gate state, not both");
		}
		this.store = new ParallelEvidenceStore(options.stateDir);
		this.staticGate = options.staticGate ?? validateNanoGptScoredCandidatePatch;
		this.bridgeLoader =
			options.v1BridgeLoader ??
			(options.v1Gate
				? (job, evidence) =>
						loadNanoGptScoredV1ScoreOneBridge({
							config: options.v1Gate as NanoGptScoredParallelV1GateConfig,
							candidatePatchSha256: job.candidate.digest,
							candidateSha256: evidence.candidateSha256,
							trainSteps: evidence.trainSteps,
						})
				: null);
		nanoGptScoredParallelBoundaryConditions(options.pins);
	}

	private now(): string {
		return (this.options.now?.() ?? new Date()).toISOString();
	}

	private validateJob(job: EvaluationJob): {
		readonly mode: NanoGptScoredParallelMode;
		readonly apparatusAttempt: number;
	} {
		if (job.lane !== "nanogpt" || job.candidateFormat !== "unified-diff" || job.requireFreshMeasurement !== true) {
			throw new Error("NanoGPT parallel adapter requires a fresh unified-diff NanoGPT job");
		}
		if (sha256Text(job.candidateContent) !== job.candidate.digest) {
			throw new Error("NanoGPT parallel candidate bytes disagree with the controller artifact");
		}
		const mode = inferNanoGptScoredParallelMode(job.benchmarkIds);
		if (job.budgetClass !== nanoGptScoredParallelBudgetClass(mode)) {
			throw new Error(`NanoGPT parallel ${mode} budget class changed`);
		}
		return {
			mode,
			apparatusAttempt: parseNanoGptScoredParallelApparatusAttempt(
				job.proposal.boundaryConditions,
				this.options.pins,
			),
		};
	}

	private staticEvidenceFor(candidatePatch: string): Promise<NanoGptScoredStaticEvidence> {
		const digest = sha256Text(candidatePatch);
		const existing = this.staticEvidence.get(digest);
		if (existing) return existing;
		const validation = this.staticGate(candidatePatch).catch((error: unknown) => {
			this.staticEvidence.delete(digest);
			throw error;
		});
		this.staticEvidence.set(digest, validation);
		return validation;
	}

	private async withStageLock<T>(stageIdentity: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.stageTails.get(stageIdentity) ?? Promise.resolve();
		let release: (() => void) | undefined;
		const current = new Promise<void>((resolvePromise) => {
			release = resolvePromise;
		});
		const tail = previous.then(() => current);
		this.stageTails.set(stageIdentity, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release?.();
			if (this.stageTails.get(stageIdentity) === tail) this.stageTails.delete(stageIdentity);
		}
	}

	private async lineage(
		job: EvaluationJob,
		mode: NanoGptScoredParallelMode,
		stageIdentity: string,
		staticEvidence: NanoGptScoredStaticEvidence,
		signal: AbortSignal,
	): Promise<{
		readonly bridge: NanoGptScoredV1ScoreOneBridge | null;
		readonly prior: NanoGptScoredParallelPriorStage | null;
	}> {
		if (mode === "smoke-10") {
			if (job.proposal.parentJobIds.length !== 0) throw new Error("NanoGPT v2 smoke starts a fresh v2 lineage");
			return { bridge: null, prior: null };
		}
		const previousMode = mode === "score-3" ? "smoke-10" : "score-3";
		const previous = await this.store.load(stageIdentity, previousMode);
		if (!previous || previous.stored.stageReceipt.accepted !== true) {
			throw new Error(`NanoGPT parallel ${mode} requires the exact accepted v2 ${previousMode}`);
		}
		await this.options.transport.verifyArchiveEvidence(previous.request, previous.transport, signal);
		if (previousMode === "score-3" && previous.result.thresholdPassed !== true) {
			throw new Error("NanoGPT parallel replay-8 cannot widen after score-3 missed the fixed threshold");
		}
		if (job.proposal.parentJobIds.length !== 1 || job.proposal.parentJobIds[0] !== previous.stored.jobId) {
			throw new Error(`NanoGPT parallel ${mode} must name the exact v2 ${previousMode} controller job`);
		}
		let bridge: NanoGptScoredV1ScoreOneBridge;
		if (previousMode === "score-3") {
			if (!previous.request.v1Bridge) throw new Error("NanoGPT v2 score-3 lost its exact v1 gate bridge");
			bridge = previous.request.v1Bridge;
		} else {
			if (!this.bridgeLoader) throw new Error("NanoGPT score-3 requires a configured exact v1 score-1 gate loader");
			bridge = await this.bridgeLoader(job, staticEvidence);
		}
		return {
			bridge,
			prior: {
				mode: previousMode,
				stageIdentity,
				requestDigest: previous.request.requestDigest,
				resultDigest: previous.result.resultDigest,
				receiptDigest: previous.stored.stageReceipt.receiptDigest,
				accepted: true,
				thresholdPassed: previousMode === "smoke-10" ? null : true,
				fullExactSet: true,
				numericMeasurementsReused: false,
				v1BridgeDigest: previous.request.v1Bridge === null ? null : sha256Json(previous.request.v1Bridge),
			},
		};
	}

	private outcome(loaded: LoadedParallelReceipt, apparatusAttempt: number): EvaluationOutcome {
		const { request, result, stored } = loaded;
		const frontierEligible = request.mode === "replay-8" && result.thresholdPassed === true;
		const recordEligible = frontierEligible && result.trainSteps < NANOGPT_BASELINE_TRAIN_STEPS;
		const checks = [
			"parallel-v2-exact-seed-set",
			"one-L40S-world-size-one-per-child",
			"authoritative-sacct-completed-zero",
			"stable-seed-index-integer-aggregation",
			"prior-numeric-measurements-not-reused",
		];
		return {
			verifierEpoch: request.verifierEpoch,
			tasks: result.children.map((child, index) => {
				const metrics: Record<string, number> = {
					validation_loss: (child.workerResult.validationLossNanounits ?? 0) / 1_000_000_000,
					train_steps: request.staticEvidence.trainSteps,
					peak_vram_mb: child.workerResult.peakVramMb ?? 0,
				};
				if (frontierEligible) metrics.verified_steps = request.staticEvidence.trainSteps;
				return {
					benchmarkId: request.benchmarkIds[index],
					status: "accepted" as const,
					metrics,
					verifier: { passed: true, checks, errors: [] },
					runtimeMs: child.workerResult.runtimeMs,
				};
			}),
			hardware: {
				cluster: "Stanford FarmShare",
				gpu: "NVIDIA L40S",
				gpusPerChild: "1",
				worldSizePerChild: "1",
				maxConcurrentChildren: String(result.accounting.requested.maxConcurrentChildren),
				maxConcurrentChildrenObserved: String(result.accounting.allocated.maxConcurrentChildrenObserved),
				slurmJobIds: result.children.map((child) => child.scheduler.raw.jobIdRaw).join(","),
				gpuUuids: result.children.map((child) => child.workerResult.observed.hardware.gpuUuid).join(","),
			},
			provenance: {
				contract: request.contract,
				mode: request.mode,
				requestDigest: request.requestDigest,
				resultDigest: result.resultDigest,
				receiptDigest: stored.stageReceipt.receiptDigest,
				parallelAmendmentSha256: request.parallelAmendmentSha256,
				hostAggregationSha256: request.pins.hostAggregationSha256,
				accepted: "true",
				fullExactSet: "true",
				thresholdPassed: String(result.thresholdPassed),
				frontierEligible: String(frontierEligible),
				recordEligible: String(recordEligible),
				priorNumericMeasurementsReused: "false",
				v1BridgeDigest: request.v1Bridge === null ? "none" : sha256Json(request.v1Bridge),
				priorStageReceiptDigest: request.priorStage?.receiptDigest ?? "none",
				wallClockMs: String(result.accounting.wallClockMs),
				queueWaitMsSum: String(result.accounting.queueWaitMsSum),
				childRuntimeMsSum: String(result.accounting.childRuntimeMsSum),
				gpuMilliseconds: String(result.accounting.gpuMilliseconds),
				gpuHoursRational: `${result.accounting.gpuHours.numeratorGpuMilliseconds}/${result.accounting.gpuHours.denominatorMillisecondsPerHour}`,
				apparatusAttempt: String(apparatusAttempt),
			},
			stdout: `${canonicalJson(toJsonValue({ stageReceipt: stored.stageReceipt, accounting: result.accounting }))}\n`,
		};
	}

	private async evaluateInternal(
		job: EvaluationJob,
		externalHandle: string | null,
		context: EvaluationContext,
	): Promise<EvaluationOutcome> {
		const { mode, apparatusAttempt } = this.validateJob(job);
		const staticEvidence = await this.staticEvidenceFor(job.candidateContent);
		if (staticEvidence.patchSha256 !== job.candidate.digest) {
			throw new Error("NanoGPT parallel static gate disagrees with the controller candidate digest");
		}
		const stageIdentity = nanoGptScoredParallelStageIdentity({
			branchId: job.branchId,
			treatment: job.treatment,
			verifierEpoch: nanoGptScoredParallelVerifierEpoch(this.options.pins),
			candidatePatchSha256: job.candidate.digest,
			candidateSha256: staticEvidence.candidateSha256,
		});
		return this.withStageLock(stageIdentity, async () => {
			const existing = await this.store.load(stageIdentity, mode);
			if (existing) {
				if (existing.stored.jobId !== job.jobId || existing.stored.manifestDigest !== job.manifestDigest) {
					throw new Error("NanoGPT parallel stage is already owned by a different accepted controller job");
				}
				await this.options.transport.verifyArchiveEvidence(existing.request, existing.transport, context.signal);
				return this.outcome(existing, apparatusAttempt);
			}
			const lineage = await this.lineage(job, mode, stageIdentity, staticEvidence, context.signal);
			const request = buildNanoGptScoredParallelStageRequest({
				stageIdentity,
				mode,
				jobId: job.jobId,
				manifestDigest: job.manifestDigest,
				branchId: job.branchId,
				treatment: job.treatment,
				candidatePatch: job.candidate,
				staticEvidence,
				benchmarkIds: job.benchmarkIds,
				v1Bridge: lineage.bridge,
				priorStage: lineage.prior,
				pins: this.options.pins,
			});
			const expectedHandle = nanoGptScoredParallelExternalHandle(request.requestDigest);
			if (
				externalHandle !== null &&
				parseNanoGptScoredParallelExternalHandle(externalHandle) !== request.requestDigest
			) {
				throw new Error("NanoGPT parallel resume handle is foreign to the exact request");
			}
			let completion: NanoGptScoredParallelTransportCompletion;
			if (externalHandle === null) {
				await context.recordExternalJobId(expectedHandle);
				completion = await this.options.transport.execute(request, job.candidateContent, context.signal);
			} else {
				completion = await this.options.transport.resume(
					request,
					job.candidateContent,
					externalHandle,
					context.signal,
				);
			}
			if (
				completion.schemaVersion !== 1 ||
				completion.stageRequestDigest !== request.requestDigest ||
				completion.externalHandle !== expectedHandle
			) {
				throw new Error("NanoGPT parallel transport completion is not bound to the exact stage request");
			}
			const result = buildNanoGptScoredParallelStageResult(request, completion.children);
			const canonicalCompletion: NanoGptScoredParallelTransportCompletion = {
				...completion,
				children: result.children,
			};
			await this.options.transport.verifyArchiveEvidence(request, canonicalCompletion, context.signal);
			const loaded = await this.store.create(request, result, canonicalCompletion, this.now());
			return this.outcome(loaded, apparatusAttempt);
		});
	}

	evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		return this.evaluateInternal(job, null, context);
	}

	resume(job: EvaluationJob, externalHandle: string, context: EvaluationContext): Promise<EvaluationOutcome> {
		return this.evaluateInternal(job, externalHandle, context);
	}
}

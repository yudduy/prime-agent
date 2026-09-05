import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import {
	ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree,
	parseCompilerGymIrDeltaQualificationEvaluatorResult,
} from "./compiler-gym-ir-delta-qualification-runner.js";
import {
	COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE,
	type CompilerGymCanonicalOneTaskAggregate,
	DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	FarmShareCompilerGymIrDeltaScreenAdapter,
	type FarmShareCompilerGymIrDeltaScreenAdapterConfig,
	parseCompilerGymCanonicalOneTaskAggregate,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import { COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256 } from "./compiler-gym-ir-delta-screen-protocol.js";
import {
	type CompilerGymPaidLiveEnvironmentGateEvidence,
	runCompilerGymPaidLiveEnvironmentGate,
} from "./compiler-gym-paid-live-environment-gate.js";
import {
	COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS,
	COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS,
	type CompilerGymProxyCascadeCandidateSource,
	type CompilerGymProxyCascadePreregistration,
	canonicalCompilerGymProxyCascadePreregistration,
	collectCompilerGymProxyCascadeCandidateArtifacts,
	collectCompilerGymProxyCascadeImplementationClosure,
	collectCompilerGymProxyCascadeReplaySources,
	parseCompilerGymProxyCascadePreregistration,
} from "./compiler-gym-proxy-cascade-preregistration.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
	type CompilerGymProxyCascadeAllocationSpec,
	type CompilerGymProxyCascadePhaseId,
	type CompilerGymProxyCascadeTaskPoint,
	compilerGymProxyCascadeParetoFrontierOrdinals,
	replayCompilerGymProxyCascade,
	selectCompilerGymProxyCascadeOrdinals,
	selectCompilerGymProxyCascadeTrajectory,
} from "./compiler-gym-proxy-cascade-protocol.js";
import {
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { EvaluationAdapterOutputError } from "./evaluation-adapter-output-error.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import type { EvaluationContext, EvaluationJob, EvaluationOutcome } from "./types.js";

export const COMPILER_GYM_PROXY_CASCADE_RUN_RESULT_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-run-result-v1" as const;

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_REMOTE_LOCK_BYTES = 4 * 1024 * 1024;
const BLOWFISH_CALIBRATION_IR = 3_898;
const BZIP2_CALIBRATION_IR = 28_748;

export type CompilerGymProxyCascadeDisposition =
	| "happy-path-wiring-qualified-only"
	| "proxy-cascade-policy-killed"
	| "terminal-apparatus-invalid";

export interface CompilerGymProxyCascadeReconstructedClosure {
	preregistration: CompilerGymProxyCascadePreregistration;
	preregistrationContents: string;
	preregistrationSha256: string;
}

export interface CompilerGymProxyCascadeOneTaskEvaluator {
	evaluateCanonicalOneTask(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome>;
}

export interface CompilerGymProxyCascadeLocalSealEvidence {
	kind: "attempt" | "selection" | "cascade" | "audit";
	path: string;
	contentsSha256: string;
	readbackSha256: string;
	mode: "0600";
	value: unknown;
}

export interface CompilerGymProxyCascadeRemoteLockEvidence {
	kind: "global" | "selection" | "cascade" | "audit";
	path: string;
	contentsSha256: string;
	readbackSha256: string;
	mode: "0600";
	createOnly: true;
	claims: unknown;
}

export interface CompilerGymProxyCascadeAllocationEvidence {
	allocation: CompilerGymProxyCascadeAllocationSpec;
	job: EvaluationJob;
	aggregate: CompilerGymCanonicalOneTaskAggregate;
	outcome: EvaluationOutcome;
	measurementPayloadSha256: string;
	completedAt: string;
}

export interface CompilerGymProxyCascadeFailedAllocationEvidence {
	allocation: CompilerGymProxyCascadeAllocationSpec;
	job: EvaluationJob;
	error: {
		name: string;
		message: string;
		stack: string | null;
		code: string | null;
		hostEvidence: unknown;
		stdout: string | null;
		stderr: string | null;
	};
	failedAt: string;
}

export interface CompilerGymProxyCascadeFreshCandidatePoint {
	ordinal: number;
	candidateSha256: string;
	blowfish: CompilerGymProxyCascadeTaskPoint;
	bzip2: CompilerGymProxyCascadeTaskPoint;
}

export interface CompilerGymProxyCascadeAccountingSummary {
	actualFreshOneTaskAllocations: number;
	allocationWallSeconds: number;
	requestedTaskCpuSeconds: number;
	schedulerLogicalCpuSeconds: number;
	uniqueSlurmIds: number;
	uniqueTransientCaches: number;
	uniqueJobNames: number;
}

export interface CompilerGymProxyCascadeRunnerResult {
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_RUN_RESULT_PROTOCOL;
	runnerProtocol: typeof COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL;
	runtimeMode: "production-defaults-no-dependency-injection" | "test-only-injected-runtime";
	ok: boolean;
	liveScientificEvidenceEligible: boolean;
	classification: "model-free-happy-path-wiring-qualification-only";
	disposition: CompilerGymProxyCascadeDisposition;
	failure: string | null;
	preregistrationSha256: string;
	scientificIdentitySha256: string;
	localAttemptLock: CompilerGymProxyCascadeLocalSealEvidence;
	remoteLocks: CompilerGymProxyCascadeRemoteLockEvidence[];
	preflight: CompilerGymPaidLiveEnvironmentGateEvidence | null;
	postflight: CompilerGymPaidLiveEnvironmentGateEvidence | null;
	allocations: CompilerGymProxyCascadeAllocationEvidence[];
	failedAllocations: CompilerGymProxyCascadeFailedAllocationEvidence[];
	selectionSeal: CompilerGymProxyCascadeLocalSealEvidence | null;
	cascadeSeal: CompilerGymProxyCascadeLocalSealEvidence | null;
	auditSeal: CompilerGymProxyCascadeLocalSealEvidence | null;
	freshCandidates: CompilerGymProxyCascadeFreshCandidatePoint[];
	frontierOrdinals: number[];
	championOrdinal: number | null;
	selectedFrontierRetained: boolean | null;
	selectedChampionRetained: boolean | null;
	accounting: CompilerGymProxyCascadeAccountingSummary;
	counterfactual: {
		actualQualificationAllocations: 8;
		cascadeTerminalAllocations: 6;
		omittedAuditAllocations: 2;
		allocationReductionNumerator: 2;
		allocationReductionDenominator: 8;
		actualComputeSavingClaimAllowed: false;
	};
	isolation: {
		modelCalls: 0;
		providerDispatches: 0;
		rlmChildren: 0;
		gpuAllocations: 0;
		retries: 0;
		replacements: 0;
		measurementReuse: false;
	};
	ledgerPath: string;
	ledgerSha256: string;
	ledgerTerminalHash: string;
	startedAt: string;
	finishedAt: string;
}

export interface CompilerGymProxyCascadeRunnerInput {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	signal?: AbortSignal;
}

export interface CompilerGymProxyCascadeRunnerDependencies {
	testOnlyInjectedRuntime?: true;
	reconstructPreregistration?: (
		input: CompilerGymProxyCascadeRunnerInput,
	) => Promise<CompilerGymProxyCascadeReconstructedClosure>;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	evaluator?: CompilerGymProxyCascadeOneTaskEvaluator;
	environmentGate?: () => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	now?: () => Date;
}

interface AllocationUniqueness {
	slurmIds: Set<string>;
	transientCaches: Set<string>;
	jobNames: Set<string>;
}

interface RuntimeDependencies {
	runtimeMode: CompilerGymProxyCascadeRunnerResult["runtimeMode"];
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	evaluator: CompilerGymProxyCascadeOneTaskEvaluator;
	environmentGate: () => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	now: () => Date;
}

function errorText(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function errorEvidence(error: unknown): CompilerGymProxyCascadeFailedAllocationEvidence["error"] {
	return {
		name: error instanceof Error ? error.name : "NonErrorThrown",
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? (error.stack ?? null) : null,
		code: error instanceof EvaluationAdapterOutputError ? error.code : null,
		hostEvidence: error instanceof EvaluationAdapterOutputError ? error.hostEvidence : null,
		stdout: error instanceof EvaluationAdapterOutputError ? (error.stdout ?? null) : null,
		stderr: error instanceof EvaluationAdapterOutputError ? (error.stderr ?? null) : null,
	};
}

function canonicalEqual(actual: unknown, expected: unknown): boolean {
	return canonicalJson(toJsonValue(actual)) === canonicalJson(toJsonValue(expected));
}

function assertCanonicalEqual(actual: unknown, expected: unknown, label: string): void {
	if (!canonicalEqual(actual, expected)) throw new Error(`${label} differs from its frozen value`);
}

function assertAbsent(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function assertOutputDirectoryAbsent(path: string): Promise<void> {
	try {
		await stat(path);
		throw new Error("Proxy-cascade output directory must be absent before dispatch");
	} catch (error) {
		if (!assertAbsent(error)) throw error;
	}
}

function parseSingleCanonicalJsonLine(contents: string, label: string): unknown {
	if (!contents.endsWith("\n") || contents.slice(0, -1).includes("\n")) {
		throw new Error(`${label} must be one newline-terminated JSON line`);
	}
	const value: unknown = JSON.parse(contents.slice(0, -1));
	if (`${canonicalJson(toJsonValue(value))}\n` !== contents) throw new Error(`${label} is not canonical JSON`);
	return value;
}

function createdAtFromPreregistration(value: unknown): string {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Proxy-cascade preregistration must be an object");
	}
	const createdAt = (value as Record<string, unknown>).createdAt;
	if (typeof createdAt !== "string") throw new Error("Proxy-cascade preregistration lacks createdAt");
	return createdAt;
}

async function readPinnedPreregistration(path: string): Promise<string> {
	const pathMetadata = await lstat(path);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || (pathMetadata.mode & 0o777) !== 0o600) {
		throw new Error("Proxy-cascade preregistration must be a mode-0600 regular non-symlink file");
	}
	const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (
			!before.isFile() ||
			before.dev !== pathMetadata.dev ||
			before.ino !== pathMetadata.ino ||
			(before.mode & 0o777) !== 0o600
		) {
			throw new Error("Proxy-cascade preregistration changed before its pinned read");
		}
		const contents = await handle.readFile("utf8");
		const after = await handle.stat();
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs ||
			after.mode !== before.mode
		) {
			throw new Error("Proxy-cascade preregistration changed during its pinned read");
		}
		return contents;
	} finally {
		await handle.close();
	}
}

export async function reconstructCompilerGymProxyCascadePreregistration(
	input: CompilerGymProxyCascadeRunnerInput,
): Promise<CompilerGymProxyCascadeReconstructedClosure> {
	const repoRoot = resolve(input.repoRoot);
	const preregistrationPath = resolve(input.preregistrationPath);
	const outputDir = resolve(input.outputDir);
	const preregistrationContents = await readPinnedPreregistration(preregistrationPath);
	const rawValue = parseSingleCanonicalJsonLine(preregistrationContents, "Proxy-cascade preregistration");
	const replaySources = await collectCompilerGymProxyCascadeReplaySources(repoRoot);
	const replay = replayCompilerGymProxyCascade(replaySources);
	const selected = selectCompilerGymProxyCascadeTrajectory(replay);
	const [
		latencyConfigContents,
		latencyResultManifestContents,
		sealedReplayResultContents,
		sealedReplayDigestManifestContents,
		authoritativeEvaluatorContents,
		irDeltaEvaluatorContents,
		candidateArtifacts,
		implementationClosure,
	] = await Promise.all([
		readFile(resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyConfig.path), "utf8"),
		readFile(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyResultManifest.path),
			"utf8",
		),
		readFile(resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayResult.path), "utf8"),
		readFile(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayDigestManifest.path),
			"utf8",
		),
		readFile(resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py"), "utf8"),
		readFile(resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py"), "utf8"),
		collectCompilerGymProxyCascadeCandidateArtifacts({ repoRoot, selected }),
		collectCompilerGymProxyCascadeImplementationClosure(repoRoot),
	]);
	const preregistration = parseCompilerGymProxyCascadePreregistration({
		value: rawValue,
		expected: {
			createdAt: createdAtFromPreregistration(rawValue),
			repoRoot,
			preregistrationPath,
			outputDir,
			replaySources,
			latencyConfigContents,
			latencyResultManifestContents,
			sealedReplayResultContents,
			sealedReplayDigestManifestContents,
			authoritativeEvaluatorContents,
			irDeltaEvaluatorContents,
			candidateArtifacts,
			implementationClosure,
		},
	});
	if (canonicalCompilerGymProxyCascadePreregistration(preregistration) !== preregistrationContents) {
		throw new Error("Proxy-cascade preregistration bytes differ from their reconstructed record");
	}
	return {
		preregistration,
		preregistrationContents,
		preregistrationSha256: sha256Text(preregistrationContents),
	};
}

function validatePreregisteredRunnerContract(
	closure: CompilerGymProxyCascadeReconstructedClosure,
	input: CompilerGymProxyCascadeRunnerInput,
): void {
	const preregistration = closure.preregistration;
	if (!SHA256.test(closure.preregistrationSha256) || !SHA256.test(preregistration.scientificIdentitySha256)) {
		throw new Error("Proxy-cascade preregistration identity is invalid");
	}
	if (
		preregistration.launchPaths.repoRoot !== resolve(input.repoRoot) ||
		preregistration.launchPaths.preregistrationPath !== resolve(input.preregistrationPath) ||
		preregistration.launchPaths.outputDir !== resolve(input.outputDir)
	) {
		throw new Error("Proxy-cascade launch paths differ from the preregistered paths");
	}
	if (!preregistration.historicalReplay.result.gate.passed) {
		throw new Error("Proxy-cascade historical replay gate is not closed and passing");
	}
	assertCanonicalEqual(preregistration.selectedTrajectory.selectedOrdinals, [2, 3], "selected ordinals");
	assertCanonicalEqual(preregistration.selectedTrajectory.omittedOrdinals, [1, 4], "omitted ordinals");
	assertCanonicalEqual(
		preregistration.selectedTrajectory.selectionContracts,
		COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS,
		"selection contracts",
	);
	assertCanonicalEqual(
		preregistration.selectedTrajectory.selectionContracts.liveCandidateChoice.allowedInputs,
		["candidateOrdinal", "freshAcceptedBlowfishIr"],
		"live selection allowed inputs",
	);
	assertCanonicalEqual(
		preregistration.selectedTrajectory.selectionContracts.liveCandidateChoice.forbiddenInputs,
		COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS.liveCandidateChoice.forbiddenInputs,
		"live selection forbidden inputs",
	);
	if (
		preregistration.candidateSources.length !== 4 ||
		new Set(preregistration.candidateSources.map((candidate) => candidate.artifactSha256)).size !== 4
	) {
		throw new Error("Proxy-cascade qualification requires four unique sealed candidate artifacts");
	}
	for (const candidate of preregistration.candidateSources) {
		if (
			candidate.artifactFileType !== "regular" ||
			candidate.artifactMode !== "0600" ||
			candidate.artifactSymbolicLink !== false ||
			sha256Text(candidate.canonicalBytesUtf8) !== candidate.artifactSha256 ||
			Buffer.byteLength(candidate.canonicalBytesUtf8) !== candidate.artifactByteLength ||
			!canonicalEqual(JSON.parse(candidate.canonicalBytesUtf8), candidate.actions)
		) {
			throw new Error(`Proxy-cascade candidate ${candidate.ordinal} closure drifted`);
		}
	}
	assertCanonicalEqual(
		preregistration.isolation,
		{
			modelCalls: 0,
			providerDispatches: 0,
			rlmChildren: 0,
			compaction: false,
			webAccess: false,
			gpuAllocations: 0,
			measurementReuse: false,
			retries: 0,
			replacements: 0,
			adaptiveCandidateSubstitution: false,
			agentVisibilityOfAuditMeasurements: false,
		},
		"isolation contract",
	);
	assertCanonicalEqual(
		preregistration.accounting,
		{
			mode: "required",
			exactRowsPerAllocation: ["root", "extern", ".0"],
			rootAllocCpusAccepted: [2, 4],
			stepAllocCpus: 2,
			stepTasks: 1,
			allRowsMustBeTerminalBeforeAdmission: true,
			queueAndSchedulerWallIsDescriptiveOnly: true,
			evaluatorRuntimeIsDescriptiveOnly: true,
		},
		"accounting contract",
	);
	if (
		preregistration.budgets.actualFreshOneTaskAllocations !== 8 ||
		preregistration.budgets.counterfactualCascadeAllocations !== 6 ||
		preregistration.phasePlan.allocations.length !== 8
	) {
		throw new Error("Proxy-cascade allocation plan or budget drifted");
	}
	const localLockPath = preregistration.localAttemptLock.path;
	if (
		resolve(localLockPath) !== localLockPath ||
		localLockPath === resolve(input.repoRoot) ||
		localLockPath.startsWith(`${resolve(input.repoRoot)}${sep}`) ||
		!localLockPath.includes(preregistration.scientificIdentitySha256) ||
		!preregistration.localAttemptLock.createOnlyBeforeAnySsh ||
		preregistration.localAttemptLock.mode !== "0600" ||
		!preregistration.localAttemptLock.neverRemovedByRunner
	) {
		throw new Error("Proxy-cascade local attempt lock is not shared and identity-bound");
	}
	if (
		preregistration.frozenCommon.adapterOutputProtocol !== "compiler-gym-canonical-one-task-adapter-output-v1" ||
		preregistration.frozenCommon.canonicalEvaluator.sha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		preregistration.frozenCommon.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
		preregistration.frozenCommon.irDeltaSourceBundleSha256 !== COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256
	) {
		throw new Error("Proxy-cascade canonical evaluator contract drifted");
	}
}

async function writeLocalSeal(
	path: string,
	kind: CompilerGymProxyCascadeLocalSealEvidence["kind"],
	value: unknown,
): Promise<CompilerGymProxyCascadeLocalSealEvidence> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	const [readback, metadata] = await Promise.all([readFile(path, "utf8"), lstat(path)]);
	if (readback !== contents || !metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`Proxy-cascade ${kind} local seal readback drifted`);
	}
	return {
		kind,
		path,
		contentsSha256: sha256Text(contents),
		readbackSha256: sha256Text(readback),
		mode: "0600",
		value: structuredClone(value),
	};
}

async function createRemoteLock(input: {
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	preregistration: CompilerGymProxyCascadePreregistration;
	kind: CompilerGymProxyCascadeRemoteLockEvidence["kind"];
	path: string;
	claims: unknown;
	ensureRoot: boolean;
	signal: AbortSignal;
}): Promise<CompilerGymProxyCascadeRemoteLockEvidence> {
	const locks = input.preregistration.remoteLocks;
	if (posix.dirname(locks.root) !== locks.parentRoot || posix.dirname(input.path) !== locks.root) {
		throw new Error("Proxy-cascade remote lock path differs from its frozen identity root");
	}
	if (input.ensureRoot) {
		await ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree(input.remoteFileSystem, locks.root, input.signal);
	}
	const contents = `${canonicalJson(toJsonValue(input.claims))}\n`;
	const contentsSha256 = sha256Text(contents);
	await input.remoteFileSystem.installImmutableFile(input.path, contents, contentsSha256, 0o600, false, input.signal);
	const readback = await input.remoteFileSystem.readTrustedFile(
		input.path,
		{ maxBytes: MAX_REMOTE_LOCK_BYTES, mode: 0o600, expectedSha256: contentsSha256 },
		input.signal,
	);
	if (readback !== contents) throw new Error(`Proxy-cascade ${input.kind} remote lock readback drifted`);
	return {
		kind: input.kind,
		path: input.path,
		contentsSha256,
		readbackSha256: sha256Text(readback),
		mode: "0600",
		createOnly: true,
		claims: structuredClone(input.claims),
	};
}

function buildEvaluationJob(
	preregistration: CompilerGymProxyCascadePreregistration,
	allocation: CompilerGymProxyCascadeAllocationSpec,
): EvaluationJob {
	const candidate = preregistration.candidateSources.find((item) => item.ordinal === allocation.candidateOrdinal);
	if (!candidate) throw new Error(`Proxy-cascade candidate ${allocation.candidateOrdinal} is absent`);
	const jobId = `proxy-cascade-${preregistration.scientificIdentitySha256.slice(0, 16)}-${String(
		allocation.allocationOrdinal,
	).padStart(2, "0")}`;
	const manifest = {
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
		scientificIdentitySha256: preregistration.scientificIdentitySha256,
		allocation,
		jobId,
		candidate: {
			digest: candidate.artifactSha256,
			byteLength: candidate.artifactByteLength,
			mediaType: candidate.artifactMediaType,
		},
		requireFreshMeasurement: true,
	};
	return {
		jobId,
		manifestDigest: sha256Json(manifest),
		branchId: `proxy-cascade-${preregistration.scientificIdentitySha256}`,
		lane: "compiler-gym",
		benchmarkIds: [allocation.benchmarkId],
		budgetClass: "screen",
		treatment: `proxy-cascade-${allocation.phase}`,
		proposal: {
			hypothesis: `Re-evaluate frozen candidate ${allocation.candidateOrdinal} on ${allocation.benchmarkId}`,
			mechanism: "Source-sealed canonical one-task replay",
			predictedOutcome: "Exactly reproduce the preregistered IR and object-size anchors",
			boundaryConditions: ["fresh-one-task-allocation", "no-retry", "no-reuse"],
			parentJobIds: [],
		},
		candidate: {
			digest: candidate.artifactSha256,
			byteLength: candidate.artifactByteLength,
			mediaType: candidate.artifactMediaType,
		},
		candidateFormat: "llvm-pass-sequence",
		requireFreshMeasurement: true,
		candidateContent: candidate.canonicalBytesUtf8,
	};
}

function candidateForAllocation(
	preregistration: CompilerGymProxyCascadePreregistration,
	allocation: CompilerGymProxyCascadeAllocationSpec,
): CompilerGymProxyCascadeCandidateSource {
	const candidate = preregistration.candidateSources.find((item) => item.ordinal === allocation.candidateOrdinal);
	if (!candidate) throw new Error(`Proxy-cascade candidate ${allocation.candidateOrdinal} is absent`);
	return candidate;
}

function registerUniqueAllocation(
	aggregate: CompilerGymCanonicalOneTaskAggregate,
	uniqueness: AllocationUniqueness,
): void {
	const task = aggregate.tasks[0];
	for (const [label, value, values] of [
		["Slurm allocation", task.slurmId, uniqueness.slurmIds],
		["transient cache", task.transientCache, uniqueness.transientCaches],
		["job name", task.jobName, uniqueness.jobNames],
	] as const) {
		if (values.has(value)) throw new Error(`Proxy-cascade ${label} ${value} was reused`);
		values.add(value);
	}
}

function validateAllocationOutcome(input: {
	preregistration: CompilerGymProxyCascadePreregistration;
	allocation: CompilerGymProxyCascadeAllocationSpec;
	job: EvaluationJob;
	outcome: EvaluationOutcome;
	uniqueness: AllocationUniqueness;
	completedAt: string;
}): CompilerGymProxyCascadeAllocationEvidence {
	const { allocation, job, outcome, preregistration } = input;
	if (typeof outcome.stdout !== "string") throw new Error("Canonical one-task evaluation lacks aggregate stdout");
	const aggregate = parseCompilerGymCanonicalOneTaskAggregate(outcome.stdout);
	const candidate = candidateForAllocation(preregistration, allocation);
	const expectedSourceDirectory = posix.join(
		preregistration.frozenCommon.environment.remoteSourceRoot,
		preregistration.frozenCommon.irDeltaSourceBundleSha256,
	);
	if (
		aggregate.jobId !== job.jobId ||
		aggregate.manifestDigest !== job.manifestDigest ||
		aggregate.candidateSha256 !== candidate.artifactSha256 ||
		aggregate.actionsSha256 !== sha256Json(candidate.actions) ||
		aggregate.verifierEpoch !== preregistration.frozenCommon.verifierEpoch ||
		aggregate.evaluatorSha256 !== preregistration.frozenCommon.canonicalEvaluator.sha256 ||
		aggregate.sourceBundleSha256 !== preregistration.frozenCommon.irDeltaSourceBundleSha256 ||
		aggregate.sourceDirectory !== expectedSourceDirectory ||
		aggregate.remoteEvaluatorPath !== posix.join(expectedSourceDirectory, "compiler_gym_eval.py") ||
		aggregate.measurementReuse !== false ||
		aggregate.tasks[0].benchmarkId !== allocation.benchmarkId
	) {
		throw new Error(`Proxy-cascade allocation ${allocation.allocationOrdinal} aggregate binding drifted`);
	}
	const expectedRequest = `${canonicalJson(
		toJsonValue({ benchmark: allocation.benchmarkId, actions: candidate.actions }),
	)}\n`;
	if (aggregate.tasks[0].requestSha256 !== sha256Text(expectedRequest)) {
		throw new Error(`Proxy-cascade allocation ${allocation.allocationOrdinal} request binding drifted`);
	}
	const rawEvaluatorResult = parseCompilerGymIrDeltaQualificationEvaluatorResult({
		stdout: aggregate.tasks[0].stdout,
		exitCode: aggregate.tasks[0].exitCode,
		arm: "canonical",
		benchmarkId: allocation.benchmarkId,
		actions: candidate.actions,
	});
	if (
		rawEvaluatorResult.outcome !== "verified" ||
		!rawEvaluatorResult.final.verifierPassed ||
		rawEvaluatorResult.slurmId !== aggregate.tasks[0].slurmId
	) {
		throw new Error(`Proxy-cascade allocation ${allocation.allocationOrdinal} raw evaluator result drifted`);
	}
	if (
		outcome.verifierEpoch !== preregistration.frozenCommon.verifierEpoch ||
		(outcome.stderr ?? "") !== aggregate.tasks[0].stderr ||
		outcome.tasks.length !== 1 ||
		outcome.tasks[0]?.benchmarkId !== allocation.benchmarkId ||
		outcome.tasks[0].status !== "accepted" ||
		!outcome.tasks[0].verifier.passed ||
		outcome.tasks[0].verifier.errors.length !== 0
	) {
		throw new Error(`Proxy-cascade allocation ${allocation.allocationOrdinal} outcome is not accepted`);
	}
	assertCanonicalEqual(
		outcome.hardware,
		{
			cluster: "Stanford FarmShare",
			partition: preregistration.frozenCommon.environment.partition,
			cpuConstraint: preregistration.frozenCommon.environment.cpuConstraint,
		},
		`allocation ${allocation.allocationOrdinal} hardware`,
	);
	assertCanonicalEqual(
		outcome.provenance,
		COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE,
		`allocation ${allocation.allocationOrdinal} provenance`,
	);
	const anchor =
		allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH
			? candidate.expectedMetrics.blowfish
			: candidate.expectedMetrics.bzip2;
	const task = outcome.tasks[0];
	if (
		task.metrics.IrInstructionCount !== anchor.irInstructionCount ||
		task.metrics.ObjectTextSizeBytes !== anchor.objectTextSizeBytes ||
		rawEvaluatorResult.final.irInstructionCount !== task.metrics.IrInstructionCount ||
		rawEvaluatorResult.final.objectTextSizeBytes !== task.metrics.ObjectTextSizeBytes ||
		rawEvaluatorResult.intrinsicTotalMs !== task.metrics.evaluatorRuntimeMs ||
		task.runtimeMs !== aggregate.tasks[0].accountingRows.root.elapsedRawSeconds * 1_000
	) {
		throw new Error(`Proxy-cascade allocation ${allocation.allocationOrdinal} historical metric anchor drifted`);
	}
	registerUniqueAllocation(aggregate, input.uniqueness);
	const measurementPayload = {
		allocation,
		job,
		verifierEpoch: outcome.verifierEpoch,
		tasks: outcome.tasks,
		hardware: outcome.hardware,
		provenance: outcome.provenance,
		aggregateSha256: sha256Text(outcome.stdout),
		stderrSha256: sha256Text(outcome.stderr ?? ""),
	};
	return {
		allocation: structuredClone(allocation),
		job: structuredClone(job),
		aggregate,
		outcome: structuredClone(outcome),
		measurementPayloadSha256: sha256Json(measurementPayload),
		completedAt: input.completedAt,
	};
}

async function runPhase(input: {
	phase: CompilerGymProxyCascadePhaseId;
	allocations: readonly CompilerGymProxyCascadeAllocationSpec[];
	preregistration: CompilerGymProxyCascadePreregistration;
	evaluator: CompilerGymProxyCascadeOneTaskEvaluator;
	ledger: EvidenceLedger;
	uniqueness: AllocationUniqueness;
	completed: CompilerGymProxyCascadeAllocationEvidence[];
	failed: CompilerGymProxyCascadeFailedAllocationEvidence[];
	now: () => Date;
	signal: AbortSignal;
}): Promise<void> {
	const settled = await Promise.allSettled(
		input.allocations.map(async (allocation) => {
			const job = buildEvaluationJob(input.preregistration, allocation);
			try {
				const outcome = await input.evaluator.evaluateCanonicalOneTask(job, {
					signal: input.signal,
					recordExternalJobId: async () => {
						throw new Error("Proxy-cascade one-task evaluator may not delegate external job identity recording");
					},
				});
				const evidence = validateAllocationOutcome({
					preregistration: input.preregistration,
					allocation,
					job,
					outcome,
					uniqueness: input.uniqueness,
					completedAt: input.now().toISOString(),
				});
				await input.ledger.append(
					"measurement",
					{
						type: "proxy_cascade_allocation",
						protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
						status: "completed",
						...evidence,
					},
					evidence.completedAt,
				);
				input.completed.push(evidence);
				return evidence;
			} catch (error) {
				const failure: CompilerGymProxyCascadeFailedAllocationEvidence = {
					allocation: structuredClone(allocation),
					job: structuredClone(job),
					error: errorEvidence(error),
					failedAt: input.now().toISOString(),
				};
				await input.ledger.append(
					"measurement",
					{
						type: "proxy_cascade_allocation",
						protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
						status: "failed",
						...failure,
					},
					failure.failedAt,
				);
				input.failed.push(failure);
				throw error;
			}
		}),
	);
	const rejected = settled.filter((result) => result.status === "rejected");
	if (rejected.length > 0) {
		throw new Error(
			`Proxy-cascade phase ${input.phase} failed in ${rejected.length} of ${input.allocations.length} allocations: ${rejected
				.map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)))
				.join("; ")}`,
		);
	}
}

function allocationsForPhase(
	preregistration: CompilerGymProxyCascadePreregistration,
	phase: CompilerGymProxyCascadePhaseId,
): CompilerGymProxyCascadeAllocationSpec[] {
	return preregistration.phasePlan.allocations.filter((allocation) => allocation.phase === phase);
}

function sortedAllocations(
	allocations: readonly CompilerGymProxyCascadeAllocationEvidence[],
): CompilerGymProxyCascadeAllocationEvidence[] {
	return [...allocations].sort(
		(left, right) => left.allocation.allocationOrdinal - right.allocation.allocationOrdinal,
	);
}

function irForAllocation(allocation: CompilerGymProxyCascadeAllocationEvidence): number {
	const value = allocation.outcome.tasks[0]?.metrics.IrInstructionCount;
	if (!Number.isSafeInteger(value) || value < 1) throw new Error("Proxy-cascade IR metric is invalid");
	return value;
}

function scientificEvidence(allocation: CompilerGymProxyCascadeAllocationEvidence) {
	const task = allocation.outcome.tasks[0];
	if (!task) throw new Error("Proxy-cascade allocation lacks its task measurement");
	return {
		allocationOrdinal: allocation.allocation.allocationOrdinal,
		candidateOrdinal: allocation.allocation.candidateOrdinal,
		benchmarkId: allocation.allocation.benchmarkId,
		candidateSha256: allocation.aggregate.candidateSha256,
		irInstructionCount: task.metrics.IrInstructionCount,
		objectTextSizeBytes: task.metrics.ObjectTextSizeBytes,
		measurementPayloadSha256: allocation.measurementPayloadSha256,
		slurmId: allocation.aggregate.tasks[0].slurmId,
	};
}

function selectionSealValue(input: {
	preregistration: CompilerGymProxyCascadePreregistration;
	preregistrationSha256: string;
	allocations: readonly CompilerGymProxyCascadeAllocationEvidence[];
}) {
	const allocations = sortedAllocations(input.allocations);
	if (allocations.length !== 4 || allocations.some((item) => item.allocation.phase !== "proxy-blowfish")) {
		throw new Error("Proxy-cascade selection requires exactly four blowfish measurements");
	}
	const selectionInputs = allocations.map((allocation) => ({
		candidateOrdinal: allocation.allocation.candidateOrdinal,
		freshAcceptedBlowfishIr: irForAllocation(allocation),
	}));
	const selection = selectCompilerGymProxyCascadeOrdinals(
		selectionInputs.map((item) => ({
			ordinal: item.candidateOrdinal,
			blowfishIrInstructionCount: item.freshAcceptedBlowfishIr,
		})),
	);
	if (selection.proxyTiersAscending.length !== 4) {
		throw new Error("Proxy-cascade proxy scores are tied; selection is not the preregistered untied gate");
	}
	assertCanonicalEqual(selection.selectedOrdinals, [2, 3], "fresh selected ordinals");
	assertCanonicalEqual(selection.omittedOrdinals, [1, 4], "fresh omitted ordinals");
	assertCanonicalEqual(
		selection.selectedOrdinals,
		input.preregistration.selectedTrajectory.selectedOrdinals,
		"fresh versus preregistered selected ordinals",
	);
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
		kind: "selection",
		scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
		preregistrationSha256: input.preregistrationSha256,
		phasePlanSha256: sha256Json(input.preregistration.phasePlan),
		selectionInputs,
		evidenceBindings: allocations.map(scientificEvidence),
		proxyTiersAscending: selection.proxyTiersAscending,
		selectedOrdinals: selection.selectedOrdinals,
		omittedOrdinals: selection.omittedOrdinals,
	};
}

function cascadeSealValue(input: {
	preregistration: CompilerGymProxyCascadePreregistration;
	preregistrationSha256: string;
	selectionSeal: CompilerGymProxyCascadeLocalSealEvidence;
	allocations: readonly CompilerGymProxyCascadeAllocationEvidence[];
}) {
	const allocations = sortedAllocations(input.allocations);
	if (
		allocations.length !== 6 ||
		allocations.slice(0, 4).some((item) => item.allocation.phase !== "proxy-blowfish") ||
		allocations.slice(4).some((item) => item.allocation.phase !== "selected-bzip2")
	) {
		throw new Error("Proxy-cascade terminal result requires four proxy plus two selected bzip2 allocations");
	}
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
		kind: "cascade",
		scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
		preregistrationSha256: input.preregistrationSha256,
		selectionSealSha256: input.selectionSeal.contentsSha256,
		allocations: allocations.map(scientificEvidence),
		counterfactualTerminalAllocationCount: 6,
		omittedCandidateTaskState: "not-evaluated-never-rejected-or-imputed",
	};
}

function taskPointFromAllocation(
	allocation: CompilerGymProxyCascadeAllocationEvidence,
): CompilerGymProxyCascadeTaskPoint {
	const task = allocation.outcome.tasks[0];
	if (!task) throw new Error("Proxy-cascade allocation lacks a task");
	const runtimeMs = task.metrics.evaluatorRuntimeMs;
	if (!Number.isFinite(runtimeMs) || runtimeMs <= 0) throw new Error("Proxy-cascade evaluator runtime is invalid");
	return {
		benchmarkId: allocation.allocation.benchmarkId,
		irInstructionCount: task.metrics.IrInstructionCount!,
		objectTextSizeBytes: task.metrics.ObjectTextSizeBytes!,
		evaluatorRuntimeMicros: Math.round(runtimeMs * 1_000),
	};
}

function buildFreshCandidates(input: {
	preregistration: CompilerGymProxyCascadePreregistration;
	allocations: readonly CompilerGymProxyCascadeAllocationEvidence[];
}): CompilerGymProxyCascadeFreshCandidatePoint[] {
	return input.preregistration.candidateSources.map((candidate) => {
		const blowfish = input.allocations.filter(
			(allocation) =>
				allocation.allocation.candidateOrdinal === candidate.ordinal &&
				allocation.allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
		);
		const bzip2 = input.allocations.filter(
			(allocation) =>
				allocation.allocation.candidateOrdinal === candidate.ordinal &&
				allocation.allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BZIP2,
		);
		if (blowfish.length !== 1 || bzip2.length !== 1) {
			throw new Error(`Proxy-cascade candidate ${candidate.ordinal} lacks one fresh measurement per task`);
		}
		return {
			ordinal: candidate.ordinal,
			candidateSha256: candidate.artifactSha256,
			blowfish: taskPointFromAllocation(blowfish[0]!),
			bzip2: taskPointFromAllocation(bzip2[0]!),
		};
	});
}

function compareRatio(
	leftNumerator: number,
	leftDenominator: number,
	rightNumerator: number,
	rightDenominator: number,
) {
	const difference =
		BigInt(leftNumerator) * BigInt(rightDenominator) - BigInt(rightNumerator) * BigInt(leftDenominator);
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function compareChampion(
	left: CompilerGymProxyCascadeFreshCandidatePoint,
	right: CompilerGymProxyCascadeFreshCandidatePoint,
): number {
	const leftRatios = [
		{ numerator: left.blowfish.irInstructionCount, denominator: BLOWFISH_CALIBRATION_IR },
		{ numerator: left.bzip2.irInstructionCount, denominator: BZIP2_CALIBRATION_IR },
	].sort((a, b) => -compareRatio(a.numerator, a.denominator, b.numerator, b.denominator));
	const rightRatios = [
		{ numerator: right.blowfish.irInstructionCount, denominator: BLOWFISH_CALIBRATION_IR },
		{ numerator: right.bzip2.irInstructionCount, denominator: BZIP2_CALIBRATION_IR },
	].sort((a, b) => -compareRatio(a.numerator, a.denominator, b.numerator, b.denominator));
	for (let index = 0; index < leftRatios.length; index++) {
		const leftRatio = leftRatios[index]!;
		const rightRatio = rightRatios[index]!;
		const order = compareRatio(
			leftRatio.numerator,
			leftRatio.denominator,
			rightRatio.numerator,
			rightRatio.denominator,
		);
		if (order !== 0) return order;
	}
	for (const task of ["blowfish", "bzip2"] as const) {
		const order = left[task].irInstructionCount - right[task].irInstructionCount;
		if (order !== 0) return order;
	}
	const digestOrder =
		left.candidateSha256 < right.candidateSha256 ? -1 : left.candidateSha256 > right.candidateSha256 ? 1 : 0;
	return digestOrder === 0 ? left.ordinal - right.ordinal : digestOrder;
}

function assessFreshFrontier(input: {
	preregistration: CompilerGymProxyCascadePreregistration;
	allocations: readonly CompilerGymProxyCascadeAllocationEvidence[];
}) {
	const freshCandidates = buildFreshCandidates(input);
	const frontierOrdinals = compilerGymProxyCascadeParetoFrontierOrdinals(freshCandidates);
	const frontierCandidates = freshCandidates.filter((candidate) => frontierOrdinals.includes(candidate.ordinal));
	const champion = [...frontierCandidates].sort(compareChampion)[0];
	if (!champion) throw new Error("Proxy-cascade fresh full control has no champion");
	const historical = input.preregistration.historicalReplay.result.trajectories.find(
		(trajectory) => trajectory.path === input.preregistration.selectedTrajectory.path,
	);
	if (!historical) throw new Error("Proxy-cascade selected historical trajectory disappeared");
	assertCanonicalEqual(frontierOrdinals, historical.frontierOrdinals, "fresh versus historical frontier");
	if (champion.ordinal !== historical.championOrdinal) {
		throw new Error("Proxy-cascade fresh authoritative champion differs from the historical anchor");
	}
	const selected = new Set(input.preregistration.selectedTrajectory.selectedOrdinals);
	return {
		freshCandidates,
		frontierOrdinals,
		championOrdinal: champion.ordinal,
		selectedFrontierRetained: frontierOrdinals.every((ordinal) => selected.has(ordinal)),
		selectedChampionRetained: selected.has(champion.ordinal),
	};
}

function accountingSummary(
	allocations: readonly CompilerGymProxyCascadeAllocationEvidence[],
	preregistration: CompilerGymProxyCascadePreregistration,
): CompilerGymProxyCascadeAccountingSummary {
	const summary: CompilerGymProxyCascadeAccountingSummary = {
		actualFreshOneTaskAllocations: allocations.length,
		allocationWallSeconds: 0,
		requestedTaskCpuSeconds: 0,
		schedulerLogicalCpuSeconds: 0,
		uniqueSlurmIds: new Set(allocations.map((item) => item.aggregate.tasks[0].slurmId)).size,
		uniqueTransientCaches: new Set(allocations.map((item) => item.aggregate.tasks[0].transientCache)).size,
		uniqueJobNames: new Set(allocations.map((item) => item.aggregate.tasks[0].jobName)).size,
	};
	for (const allocation of allocations) {
		const rows = allocation.aggregate.tasks[0].accountingRows;
		summary.allocationWallSeconds += rows.root.elapsedRawSeconds;
		summary.requestedTaskCpuSeconds += rows.step.elapsedRawSeconds * rows.step.allocCpus;
		summary.schedulerLogicalCpuSeconds += rows.root.elapsedRawSeconds * rows.root.allocCpus;
	}
	if (
		summary.actualFreshOneTaskAllocations > preregistration.budgets.actualFreshOneTaskAllocations ||
		summary.allocationWallSeconds > preregistration.budgets.allocationWallMinutesMaximum * 60 ||
		summary.requestedTaskCpuSeconds > preregistration.budgets.requestedTaskCpuMinutesMaximum * 60 ||
		summary.schedulerLogicalCpuSeconds > preregistration.budgets.schedulerLogicalCpuMinutesMaximum * 60
	) {
		throw new Error("Proxy-cascade fresh allocation accounting exceeded its preregistered budget");
	}
	return summary;
}

async function verifyEnvironmentPostflight(
	preflight: CompilerGymPaidLiveEnvironmentGateEvidence,
	postflight: CompilerGymPaidLiveEnvironmentGateEvidence,
): Promise<void> {
	assertCanonicalEqual(
		{ ...preflight, wallMs: 0 },
		{ ...postflight, wallMs: 0 },
		"Proxy-cascade postflight environment gate",
	);
}

async function verifyRemoteLocks(
	remoteFileSystem: CompilerGymWarmRemoteFileSystem,
	locks: readonly CompilerGymProxyCascadeRemoteLockEvidence[],
	signal: AbortSignal,
): Promise<void> {
	for (const lock of locks) {
		const contents = `${canonicalJson(toJsonValue(lock.claims))}\n`;
		const readback = await remoteFileSystem.readTrustedFile(
			lock.path,
			{ maxBytes: MAX_REMOTE_LOCK_BYTES, mode: 0o600, expectedSha256: lock.contentsSha256 },
			signal,
		);
		if (readback !== contents) throw new Error(`Proxy-cascade ${lock.kind} remote lock postflight drifted`);
	}
}

async function verifyRemoteEvaluatorSources(input: {
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	preregistration: CompilerGymProxyCascadePreregistration;
	allocations: readonly CompilerGymProxyCascadeAllocationEvidence[];
	signal: AbortSignal;
}): Promise<void> {
	const sourceDirectories = new Set(input.allocations.map((allocation) => allocation.aggregate.sourceDirectory));
	const canonicalPaths = new Set(input.allocations.map((allocation) => allocation.aggregate.remoteEvaluatorPath));
	if (sourceDirectories.size !== 1 || canonicalPaths.size !== 1) {
		throw new Error("Proxy-cascade allocations do not share one sealed remote evaluator source directory");
	}
	const sourceDirectory = [...sourceDirectories][0];
	const canonicalPath = [...canonicalPaths][0];
	if (!sourceDirectory || !canonicalPath || canonicalPath !== posix.join(sourceDirectory, "compiler_gym_eval.py")) {
		throw new Error("Proxy-cascade canonical remote evaluator path drifted");
	}
	const irDeltaPath = posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py");
	const [canonicalReadback, irDeltaReadback] = await Promise.all([
		input.remoteFileSystem.readTrustedFile(
			canonicalPath,
			{
				maxBytes: MAX_REMOTE_LOCK_BYTES,
				mode: 0o600,
				expectedSha256: input.preregistration.frozenCommon.canonicalEvaluator.sha256,
			},
			input.signal,
		),
		input.remoteFileSystem.readTrustedFile(
			irDeltaPath,
			{
				maxBytes: MAX_REMOTE_LOCK_BYTES,
				mode: 0o600,
				expectedSha256: input.preregistration.frozenCommon.irDeltaEvaluator.sha256,
			},
			input.signal,
		),
	]);
	if (
		sha256Text(canonicalReadback) !== input.preregistration.frozenCommon.canonicalEvaluator.sha256 ||
		sha256Text(irDeltaReadback) !== input.preregistration.frozenCommon.irDeltaEvaluator.sha256
	) {
		throw new Error("Proxy-cascade remote evaluator source readback drifted");
	}
}

async function verifyLocalSeals(seals: readonly CompilerGymProxyCascadeLocalSealEvidence[]): Promise<void> {
	for (const seal of seals) {
		const expected = `${canonicalJson(toJsonValue(seal.value))}\n`;
		const [readback, metadata] = await Promise.all([readFile(seal.path, "utf8"), lstat(seal.path)]);
		if (
			readback !== expected ||
			sha256Text(readback) !== seal.contentsSha256 ||
			seal.readbackSha256 !== seal.contentsSha256 ||
			!metadata.isFile() ||
			metadata.isSymbolicLink() ||
			(metadata.mode & 0o777) !== 0o600
		) {
			throw new Error(`Proxy-cascade ${seal.kind} local seal postflight drifted`);
		}
	}
}

function resolveRuntimeDependencies(
	input: CompilerGymProxyCascadeRunnerInput,
	dependencies: CompilerGymProxyCascadeRunnerDependencies,
): RuntimeDependencies {
	if (dependencies.testOnlyInjectedRuntime === true) {
		if (
			!dependencies.remoteFileSystem ||
			!dependencies.evaluator ||
			!dependencies.environmentGate ||
			!dependencies.now
		) {
			throw new Error("Test-only proxy-cascade runtime requires complete injected dependencies");
		}
		return {
			runtimeMode: "test-only-injected-runtime",
			remoteFileSystem: dependencies.remoteFileSystem,
			evaluator: dependencies.evaluator,
			environmentGate: dependencies.environmentGate,
			now: dependencies.now,
		};
	}
	if (
		dependencies.reconstructPreregistration ||
		dependencies.remoteFileSystem ||
		dependencies.evaluator ||
		dependencies.environmentGate ||
		dependencies.now
	) {
		throw new Error("Proxy-cascade dependency injection must be explicitly test-only");
	}
	const commandRunner: CompilerGymWarmCommandRunner = new SpawnCompilerGymWarmCommandRunner();
	const environment = DEFAULT_ONE_TASK_CONFIG.environment;
	const remoteFileSystem = new SshCompilerGymWarmRemoteFileSystem(
		commandRunner,
		environment.host,
		"/usr/bin/python3",
		2 * 60_000,
	);
	return {
		runtimeMode: "production-defaults-no-dependency-injection",
		remoteFileSystem,
		evaluator: new FarmShareCompilerGymIrDeltaScreenAdapter(DEFAULT_ONE_TASK_CONFIG, {
			commandRunner,
			remoteFileSystem,
		}),
		environmentGate: () =>
			runCompilerGymPaidLiveEnvironmentGate({
				repoRoot: resolve(input.repoRoot),
				commandRunner,
				environment,
				signal: input.signal,
			}),
		now: () => new Date(),
	};
}

function snapshotRunnerDependencies(
	dependencies: CompilerGymProxyCascadeRunnerDependencies,
): CompilerGymProxyCascadeRunnerDependencies {
	const testOnlyInjectedRuntime = dependencies.testOnlyInjectedRuntime;
	const reconstructPreregistration = dependencies.reconstructPreregistration;
	const remoteFileSystem = dependencies.remoteFileSystem;
	const evaluator = dependencies.evaluator;
	const environmentGate = dependencies.environmentGate;
	const now = dependencies.now;
	return {
		testOnlyInjectedRuntime,
		reconstructPreregistration,
		remoteFileSystem,
		evaluator,
		environmentGate,
		now,
	};
}

const DEFAULT_ONE_TASK_CONFIG: FarmShareCompilerGymIrDeltaScreenAdapterConfig = {
	...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	environment: structuredClone(DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG.environment),
	accountingMode: "required",
	accountingEvidenceVersion: "exact-three-row-v1",
};

function validateDependencyBoundary(dependencies: CompilerGymProxyCascadeRunnerDependencies): void {
	if (dependencies.testOnlyInjectedRuntime === true) {
		if (
			!dependencies.reconstructPreregistration ||
			!dependencies.remoteFileSystem ||
			!dependencies.evaluator ||
			!dependencies.environmentGate ||
			!dependencies.now
		) {
			throw new Error("Test-only proxy-cascade runtime requires complete injected dependencies");
		}
		return;
	}
	if (
		dependencies.reconstructPreregistration ||
		dependencies.remoteFileSystem ||
		dependencies.evaluator ||
		dependencies.environmentGate ||
		dependencies.now
	) {
		throw new Error("Proxy-cascade dependency injection must be explicitly test-only");
	}
}

async function writePrivateResult(path: string, value: unknown): Promise<void> {
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	const [readback, metadata] = await Promise.all([readFile(path, "utf8"), lstat(path)]);
	if (readback !== contents || !metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error("Proxy-cascade result readback drifted");
	}
}

function localSealClaims(input: {
	kind: "attempt";
	preregistration: CompilerGymProxyCascadePreregistration;
	preregistrationSha256: string;
	outputDir: string;
	attemptedAt: string;
}) {
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
		kind: input.kind,
		scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
		preregistrationSha256: input.preregistrationSha256,
		phasePlanSha256: sha256Json(input.preregistration.phasePlan),
		candidateBundleSha256: input.preregistration.candidateBundleSha256,
		implementationBundleSha256: input.preregistration.implementationBundleSha256,
		outputDir: input.outputDir,
		attemptedAt: input.attemptedAt,
		allocationRetries: 0,
		replacementAllocations: 0,
	};
}

async function appendPhaseBoundary(input: {
	ledger: EvidenceLedger;
	phase: CompilerGymProxyCascadePhaseId;
	boundary: "start" | "complete";
	allocationOrdinals: number[];
	recordedAt: string;
}): Promise<void> {
	await input.ledger.append(
		"run_manifest",
		{
			type: "proxy_cascade_phase",
			protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
			phase: input.phase,
			boundary: input.boundary,
			allocationOrdinals: input.allocationOrdinals,
		},
		input.recordedAt,
	);
}

export async function runCompilerGymProxyCascade(
	rawInput: CompilerGymProxyCascadeRunnerInput,
	dependencies: CompilerGymProxyCascadeRunnerDependencies = {},
): Promise<CompilerGymProxyCascadeRunnerResult> {
	const snapshottedDependencies = snapshotRunnerDependencies(dependencies);
	validateDependencyBoundary(snapshottedDependencies);
	const input: CompilerGymProxyCascadeRunnerInput = {
		repoRoot: resolve(rawInput.repoRoot),
		preregistrationPath: resolve(rawInput.preregistrationPath),
		outputDir: resolve(rawInput.outputDir),
		signal: rawInput.signal,
	};
	const signal = input.signal ?? new AbortController().signal;
	const reconstruct =
		snapshottedDependencies.reconstructPreregistration ?? reconstructCompilerGymProxyCascadePreregistration;
	const now = snapshottedDependencies.now ?? (() => new Date());

	// Every byte that can affect selection, evaluation, or interpretation is closed before the attempt lock.
	const closure = await reconstruct(input);
	validatePreregisteredRunnerContract(closure, input);
	await assertOutputDirectoryAbsent(input.outputDir);
	const startedAt = now().toISOString();
	const localAttemptLock = await writeLocalSeal(
		closure.preregistration.localAttemptLock.path,
		"attempt",
		localSealClaims({
			kind: "attempt",
			preregistration: closure.preregistration,
			preregistrationSha256: closure.preregistrationSha256,
			outputDir: input.outputDir,
			attemptedAt: startedAt,
		}),
	);

	// No remote dependency is constructed until the shared local wx lock has been fsynced and read back.
	const runtime = resolveRuntimeDependencies(input, snapshottedDependencies);
	await mkdir(dirname(input.outputDir), { recursive: true, mode: 0o700 });
	await mkdir(input.outputDir, { recursive: false, mode: 0o700 });
	const ledgerPath = resolve(input.outputDir, "evidence.jsonl");
	const ledger = await EvidenceLedger.open(ledgerPath);
	if (ledger.getEvents().length !== 0) throw new Error("Proxy-cascade evidence ledger must start empty");
	await ledger.append(
		"run_manifest",
		{
			type: "proxy_cascade_start",
			protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
			runtimeMode: runtime.runtimeMode,
			preregistrationSha256: closure.preregistrationSha256,
			scientificIdentitySha256: closure.preregistration.scientificIdentitySha256,
			localAttemptLock,
			phasePlan: closure.preregistration.phasePlan,
			isolation: closure.preregistration.isolation,
			startedAt,
		},
		startedAt,
	);

	const preregistration = closure.preregistration;
	const completed: CompilerGymProxyCascadeAllocationEvidence[] = [];
	const failed: CompilerGymProxyCascadeFailedAllocationEvidence[] = [];
	const uniqueness: AllocationUniqueness = {
		slurmIds: new Set<string>(),
		transientCaches: new Set<string>(),
		jobNames: new Set<string>(),
	};
	const remoteLocks: CompilerGymProxyCascadeRemoteLockEvidence[] = [];
	let preflight: CompilerGymPaidLiveEnvironmentGateEvidence | null = null;
	let postflight: CompilerGymPaidLiveEnvironmentGateEvidence | null = null;
	let selectionSeal: CompilerGymProxyCascadeLocalSealEvidence | null = null;
	let cascadeSeal: CompilerGymProxyCascadeLocalSealEvidence | null = null;
	let auditSeal: CompilerGymProxyCascadeLocalSealEvidence | null = null;
	let freshCandidates: CompilerGymProxyCascadeFreshCandidatePoint[] = [];
	let frontierOrdinals: number[] = [];
	let championOrdinal: number | null = null;
	let selectedFrontierRetained: boolean | null = null;
	let selectedChampionRetained: boolean | null = null;
	let failure: string | null = null;
	let disposition: CompilerGymProxyCascadeDisposition = "terminal-apparatus-invalid";
	let terminalAccounting = accountingSummary([], preregistration);
	let currentPhase: CompilerGymProxyCascadePhaseId | "preflight" | "selection" | "cascade" | "postflight" | "audit" =
		"preflight";

	try {
		const globalLock = await createRemoteLock({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			kind: "global",
			path: preregistration.remoteLocks.globalPath,
			claims: {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
				kind: "global",
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				preregistrationSha256: closure.preregistrationSha256,
				localAttemptLockSha256: localAttemptLock.contentsSha256,
				phasePlanSha256: sha256Json(preregistration.phasePlan),
				candidateBundleSha256: preregistration.candidateBundleSha256,
				implementationBundleSha256: preregistration.implementationBundleSha256,
				modelCalls: 0,
				providerDispatches: 0,
				measurementReuse: false,
				createdAt: runtime.now().toISOString(),
			},
			ensureRoot: true,
			signal,
		});
		remoteLocks.push(globalLock);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_remote_lock", ...globalLock },
			runtime.now().toISOString(),
		);

		preflight = await runtime.environmentGate();
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_environment_gate", phase: "preflight", evidence: preflight },
			runtime.now().toISOString(),
		);

		currentPhase = "proxy-blowfish";
		const proxyAllocations = allocationsForPhase(preregistration, currentPhase);
		if (proxyAllocations.length !== 4) throw new Error("Proxy-cascade phase A must contain four allocations");
		await appendPhaseBoundary({
			ledger,
			phase: currentPhase,
			boundary: "start",
			allocationOrdinals: proxyAllocations.map((item) => item.allocationOrdinal),
			recordedAt: runtime.now().toISOString(),
		});
		await runPhase({
			phase: currentPhase,
			allocations: proxyAllocations,
			preregistration,
			evaluator: runtime.evaluator,
			ledger,
			uniqueness,
			completed,
			failed,
			now: runtime.now,
			signal,
		});
		await appendPhaseBoundary({
			ledger,
			phase: currentPhase,
			boundary: "complete",
			allocationOrdinals: proxyAllocations.map((item) => item.allocationOrdinal),
			recordedAt: runtime.now().toISOString(),
		});

		currentPhase = "selection";
		const selectionValue = selectionSealValue({
			preregistration,
			preregistrationSha256: closure.preregistrationSha256,
			allocations: completed,
		});
		selectionSeal = await writeLocalSeal(preregistration.phaseSeals.selection.localPath, "selection", selectionValue);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_local_seal", ...selectionSeal },
			runtime.now().toISOString(),
		);
		const selectionLock = await createRemoteLock({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			kind: "selection",
			path: preregistration.remoteLocks.selectionPath,
			claims: {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
				kind: "selection",
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				preregistrationSha256: closure.preregistrationSha256,
				globalLockSha256: globalLock.contentsSha256,
				selectionSealSha256: selectionSeal.contentsSha256,
				selection: selectionValue,
				createdAt: runtime.now().toISOString(),
			},
			ensureRoot: false,
			signal,
		});
		remoteLocks.push(selectionLock);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_remote_lock", ...selectionLock },
			runtime.now().toISOString(),
		);

		currentPhase = "selected-bzip2";
		const selectedAllocations = allocationsForPhase(preregistration, currentPhase);
		if (selectedAllocations.length !== 2) throw new Error("Proxy-cascade phase B must contain two allocations");
		await appendPhaseBoundary({
			ledger,
			phase: currentPhase,
			boundary: "start",
			allocationOrdinals: selectedAllocations.map((item) => item.allocationOrdinal),
			recordedAt: runtime.now().toISOString(),
		});
		await runPhase({
			phase: currentPhase,
			allocations: selectedAllocations,
			preregistration,
			evaluator: runtime.evaluator,
			ledger,
			uniqueness,
			completed,
			failed,
			now: runtime.now,
			signal,
		});
		await appendPhaseBoundary({
			ledger,
			phase: currentPhase,
			boundary: "complete",
			allocationOrdinals: selectedAllocations.map((item) => item.allocationOrdinal),
			recordedAt: runtime.now().toISOString(),
		});

		currentPhase = "cascade";
		const cascadeValue = cascadeSealValue({
			preregistration,
			preregistrationSha256: closure.preregistrationSha256,
			selectionSeal,
			allocations: completed,
		});
		cascadeSeal = await writeLocalSeal(preregistration.phaseSeals.cascade.localPath, "cascade", cascadeValue);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_local_seal", ...cascadeSeal },
			runtime.now().toISOString(),
		);
		const cascadeLock = await createRemoteLock({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			kind: "cascade",
			path: preregistration.remoteLocks.cascadePath,
			claims: {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
				kind: "cascade",
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				preregistrationSha256: closure.preregistrationSha256,
				selectionLockSha256: selectionLock.contentsSha256,
				cascadeSealSha256: cascadeSeal.contentsSha256,
				cascade: cascadeValue,
				createdAt: runtime.now().toISOString(),
			},
			ensureRoot: false,
			signal,
		});
		remoteLocks.push(cascadeLock);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_remote_lock", ...cascadeLock },
			runtime.now().toISOString(),
		);

		currentPhase = "omitted-bzip2-audit";
		const auditAllocations = allocationsForPhase(preregistration, currentPhase);
		if (auditAllocations.length !== 2) throw new Error("Proxy-cascade phase C must contain two allocations");
		await appendPhaseBoundary({
			ledger,
			phase: currentPhase,
			boundary: "start",
			allocationOrdinals: auditAllocations.map((item) => item.allocationOrdinal),
			recordedAt: runtime.now().toISOString(),
		});
		await runPhase({
			phase: currentPhase,
			allocations: auditAllocations,
			preregistration,
			evaluator: runtime.evaluator,
			ledger,
			uniqueness,
			completed,
			failed,
			now: runtime.now,
			signal,
		});
		await appendPhaseBoundary({
			ledger,
			phase: currentPhase,
			boundary: "complete",
			allocationOrdinals: auditAllocations.map((item) => item.allocationOrdinal),
			recordedAt: runtime.now().toISOString(),
		});

		currentPhase = "postflight";
		postflight = await runtime.environmentGate();
		await verifyEnvironmentPostflight(preflight, postflight);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_environment_gate", phase: "postflight", evidence: postflight },
			runtime.now().toISOString(),
		);
		const postflightClosure = await reconstruct(input);
		if (
			postflightClosure.preregistrationContents !== closure.preregistrationContents ||
			postflightClosure.preregistrationSha256 !== closure.preregistrationSha256 ||
			!canonicalEqual(postflightClosure.preregistration, preregistration)
		) {
			throw new Error("Proxy-cascade preregistration, replay, source, or artifact closure changed during execution");
		}
		await verifyRemoteLocks(runtime.remoteFileSystem, remoteLocks, signal);
		await verifyRemoteEvaluatorSources({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			allocations: completed,
			signal,
		});
		terminalAccounting = accountingSummary(sortedAllocations(completed), preregistration);
		if (
			terminalAccounting.actualFreshOneTaskAllocations !== 8 ||
			terminalAccounting.uniqueSlurmIds !== 8 ||
			terminalAccounting.uniqueTransientCaches !== 8 ||
			terminalAccounting.uniqueJobNames !== 8
		) {
			throw new Error("Proxy-cascade qualification lacks eight globally unique one-task allocations");
		}
		const frontier = assessFreshFrontier({ preregistration, allocations: completed });
		freshCandidates = frontier.freshCandidates;
		frontierOrdinals = frontier.frontierOrdinals;
		championOrdinal = frontier.championOrdinal;
		selectedFrontierRetained = frontier.selectedFrontierRetained;
		selectedChampionRetained = frontier.selectedChampionRetained;
		disposition =
			selectedFrontierRetained && selectedChampionRetained
				? "happy-path-wiring-qualified-only"
				: "proxy-cascade-policy-killed";

		currentPhase = "audit";
		const auditValue = {
			schemaVersion: 1,
			protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
			kind: "audit",
			scientificIdentitySha256: preregistration.scientificIdentitySha256,
			preregistrationSha256: closure.preregistrationSha256,
			cascadeSealSha256: cascadeSeal.contentsSha256,
			allocations: sortedAllocations(completed).map(scientificEvidence),
			freshCandidates,
			frontierOrdinals,
			championOrdinal,
			selectedFrontierRetained,
			selectedChampionRetained,
			disposition,
			accounting: terminalAccounting,
			postflightEnvironmentGateSha256: sha256Json({ ...postflight, wallMs: 0 }),
			postflightImplementationBundleSha256: postflightClosure.preregistration.implementationBundleSha256,
			actualQualificationAllocations: 8,
			counterfactualCascadeAllocations: 6,
			actualComputeSavingClaimAllowed: false,
		};
		auditSeal = await writeLocalSeal(preregistration.phaseSeals.audit.localPath, "audit", auditValue);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_local_seal", ...auditSeal },
			runtime.now().toISOString(),
		);
		await verifyLocalSeals([localAttemptLock, selectionSeal, cascadeSeal, auditSeal]);
		const auditLock = await createRemoteLock({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			kind: "audit",
			path: preregistration.remoteLocks.auditPath,
			claims: {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
				kind: "audit",
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				preregistrationSha256: closure.preregistrationSha256,
				cascadeLockSha256: cascadeLock.contentsSha256,
				auditSealSha256: auditSeal.contentsSha256,
				disposition,
				createdAt: runtime.now().toISOString(),
			},
			ensureRoot: false,
			signal,
		});
		remoteLocks.push(auditLock);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_remote_lock", ...auditLock },
			runtime.now().toISOString(),
		);
		await verifyRemoteLocks(runtime.remoteFileSystem, remoteLocks, signal);
		await verifyLocalSeals([localAttemptLock, selectionSeal, cascadeSeal, auditSeal]);
		await ledger.append(
			"claim",
			{
				type: "proxy_cascade_assessment",
				classification: "model-free-happy-path-wiring-qualification-only",
				disposition,
				frontierOrdinals,
				championOrdinal,
				selectedFrontierRetained,
				selectedChampionRetained,
				causalTimingClaimAllowed: false,
				prospectivePolicyClaimAllowed: false,
				defaultPromotionAllowed: false,
				gpuPromotionAllowed: false,
				nanogptPromotionAllowed: false,
				actualComputeSavingClaimAllowed: false,
				counterfactualAllocationCount: 6,
				actualQualificationAllocationCount: 8,
			},
			runtime.now().toISOString(),
		);
	} catch (error) {
		failure = errorText(error);
		disposition = "terminal-apparatus-invalid";
		terminalAccounting = accountingSummary(sortedAllocations(completed), preregistration);
		await ledger.append(
			"run_manifest",
			{
				type: "proxy_cascade_terminal_failure",
				protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
				disposition,
				failedBoundary: currentPhase,
				failure,
				completedAllocationOrdinals: sortedAllocations(completed).map((item) => item.allocation.allocationOrdinal),
				failedAllocationOrdinals: failed.map((item) => item.allocation.allocationOrdinal).sort((a, b) => a - b),
				noLaterPhaseDispatched: true,
				retries: 0,
				replacements: 0,
			},
			runtime.now().toISOString(),
		);
	}

	const finishedAt = runtime.now().toISOString();
	await ledger.append(
		"run_manifest",
		{
			type: "proxy_cascade_end",
			protocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
			disposition,
			failure,
			completedAllocationCount: completed.length,
			failedAllocationCount: failed.length,
			modelCalls: 0,
			providerDispatches: 0,
			rlmChildren: 0,
			gpuAllocations: 0,
			retries: 0,
			replacements: 0,
			measurementReuse: false,
			finishedAt,
		},
		finishedAt,
	);
	ledger.verify();
	const ledgerContents = await readFile(ledgerPath, "utf8");
	const ledgerEvents = verifyLedgerContentsStrict(ledgerContents);
	const ledgerTerminalHash = ledgerEvents.at(-1)?.hash;
	if (!ledgerTerminalHash) throw new Error("Proxy-cascade ledger lacks a terminal hash");
	const result: CompilerGymProxyCascadeRunnerResult = {
		protocol: COMPILER_GYM_PROXY_CASCADE_RUN_RESULT_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
		runtimeMode: runtime.runtimeMode,
		ok: disposition !== "terminal-apparatus-invalid",
		liveScientificEvidenceEligible:
			runtime.runtimeMode === "production-defaults-no-dependency-injection" &&
			disposition !== "terminal-apparatus-invalid",
		classification: "model-free-happy-path-wiring-qualification-only",
		disposition,
		failure,
		preregistrationSha256: closure.preregistrationSha256,
		scientificIdentitySha256: preregistration.scientificIdentitySha256,
		localAttemptLock,
		remoteLocks: structuredClone(remoteLocks),
		preflight: preflight ? structuredClone(preflight) : null,
		postflight: postflight ? structuredClone(postflight) : null,
		allocations: sortedAllocations(completed).map((item) => structuredClone(item)),
		failedAllocations: structuredClone(failed),
		selectionSeal: selectionSeal ? structuredClone(selectionSeal) : null,
		cascadeSeal: cascadeSeal ? structuredClone(cascadeSeal) : null,
		auditSeal: auditSeal ? structuredClone(auditSeal) : null,
		freshCandidates: structuredClone(freshCandidates),
		frontierOrdinals: [...frontierOrdinals],
		championOrdinal,
		selectedFrontierRetained,
		selectedChampionRetained,
		accounting: terminalAccounting,
		counterfactual: {
			actualQualificationAllocations: 8,
			cascadeTerminalAllocations: 6,
			omittedAuditAllocations: 2,
			allocationReductionNumerator: 2,
			allocationReductionDenominator: 8,
			actualComputeSavingClaimAllowed: false,
		},
		isolation: {
			modelCalls: 0,
			providerDispatches: 0,
			rlmChildren: 0,
			gpuAllocations: 0,
			retries: 0,
			replacements: 0,
			measurementReuse: false,
		},
		ledgerPath,
		ledgerSha256: sha256Text(ledgerContents),
		ledgerTerminalHash,
		startedAt,
		finishedAt,
	};
	await writePrivateResult(resolve(input.outputDir, "result.json"), result);
	return result;
}

export class CompilerGymProxyCascadeRunner {
	constructor(
		private readonly input: CompilerGymProxyCascadeRunnerInput,
		private readonly dependencies: CompilerGymProxyCascadeRunnerDependencies = {},
	) {}

	run(): Promise<CompilerGymProxyCascadeRunnerResult> {
		return runCompilerGymProxyCascade(this.input, this.dependencies);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 5 || args[0] !== "--dispatch" || args[1] !== "--preregistration" || args[3] !== "--output-dir") {
		throw new Error(
			"Usage: compiler-gym-proxy-cascade-runner --dispatch --preregistration <path> --output-dir <path>",
		);
	}
	const repoRoot = resolve(import.meta.dirname, "../../..");
	const result = await runCompilerGymProxyCascade({
		repoRoot,
		preregistrationPath: resolve(args[2]!),
		outputDir: resolve(args[4]!),
	});
	console.log(canonicalJson(toJsonValue(result)));
	if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main();
}

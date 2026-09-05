import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
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
	type CompilerGymCanonicalOneTaskPreparationEvidence,
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
import type {
	CompilerGymProxyCascadeCandidateArtifactInput,
	CompilerGymProxyCascadeCandidateSource,
} from "./compiler-gym-proxy-cascade-preregistration.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
	type CompilerGymProxyCascadeTaskPoint,
	compilerGymProxyCascadeParetoFrontierOrdinals,
	selectCompilerGymProxyCascadeOrdinals,
} from "./compiler-gym-proxy-cascade-protocol.js";
import {
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_ACCOUNTING,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_ISOLATION,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_LOCK_SCHEMA,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_SEAL_SCHEMA,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS,
	type CompilerGymProxyCascadeResourcePreregistration,
	canonicalCompilerGymProxyCascadeResourcePreregistration,
	collectCompilerGymProxyCascadeResourceImplementationClosure,
	parseCompilerGymProxyCascadeResourcePreregistration,
} from "./compiler-gym-proxy-cascade-resource-preregistration.js";
import {
	assertCompilerGymProxyCascadeResourceBlockPlan,
	buildCompilerGymProxyCascadeResourceBlockPlan,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_GATE_EVIDENCE_CONTRACT,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS,
	type CompilerGymProxyCascadeResourceAllocationSpec,
	type CompilerGymProxyCascadeResourceArm,
	type CompilerGymProxyCascadeResourceArmObservation,
	type CompilerGymProxyCascadeResourceBlockObservation,
	type CompilerGymProxyCascadeResourceBlockSpec,
	type CompilerGymProxyCascadeResourceGateResult,
	evaluateCompilerGymProxyCascadeResourceGate,
} from "./compiler-gym-proxy-cascade-resource-protocol.js";
import {
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { EvaluationAdapterOutputError } from "./evaluation-adapter-output-error.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import type { EvaluationContext, EvaluationJob, EvaluationOutcome } from "./types.js";

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUN_RESULT_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-resource-run-result-v1" as const;

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_TRUSTED_BYTES = 4 * 1024 * 1024;
const BLOWFISH_CALIBRATION_IR = 3_898;
const BZIP2_CALIBRATION_IR = 28_748;

export type CompilerGymProxyCascadeResourceDisposition =
	| "model-free-resource-screen-qualified-for-one-paid-pilot-consideration-only"
	| "resource-screen-valid-negative-no-paid-treatment"
	| "resource-screen-apparatus-invalid-no-scientific-inference";

export interface CompilerGymProxyCascadeResourceReconstructedClosure {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	preregistrationContents: string;
	preregistrationSha256: string;
}

export interface CompilerGymProxyCascadeResourceOneTaskEvaluator {
	prepareCanonicalOneTask(signal: AbortSignal): Promise<CompilerGymCanonicalOneTaskPreparationEvidence>;
	evaluateCanonicalOneTask(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome>;
}

export interface CompilerGymProxyCascadeResourceLocalSealEvidence {
	kind: "attempt" | "selection" | "arm" | "block";
	path: string;
	contentsSha256: string;
	readbackSha256: string;
	mode: "0600";
	value: unknown;
}

export interface CompilerGymProxyCascadeResourceRemoteLockEvidence {
	kind: "global" | "selection" | "arm" | "block" | "terminal";
	path: string;
	contentsSha256: string;
	readbackSha256: string;
	mode: "0600";
	createOnly: true;
	claims: unknown;
}

export interface CompilerGymProxyCascadeResourceIntervalEvidence {
	startedMonotonicMicros: number;
	feedbackReadyMonotonicMicros: number;
	feedbackReadyWallMicros: number;
}

export interface CompilerGymProxyCascadeResourceSourceReadbackEvidence {
	sourceBundleSha256: string;
	sourceDirectory: string;
	canonicalRemoteEvaluatorPath: string;
	canonicalEvaluatorSha256: string;
	irDeltaRemoteEvaluatorPath: string;
	irDeltaEvaluatorSha256: string;
}

export interface CompilerGymProxyCascadeResourceAllocationEvidence {
	allocation: CompilerGymProxyCascadeResourceRealizedAllocationSpec;
	job: EvaluationJob;
	aggregate: CompilerGymCanonicalOneTaskAggregate;
	outcome: EvaluationOutcome;
	measurementPayloadSha256: string;
	completedAt: string;
}

export interface CompilerGymProxyCascadeResourceFailedAllocationEvidence {
	allocation: CompilerGymProxyCascadeResourceRealizedAllocationSpec;
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

export type CompilerGymProxyCascadeResourceRealizedAllocationSpec = Omit<
	CompilerGymProxyCascadeResourceAllocationSpec,
	"candidateOrdinal"
> & { candidateOrdinal: number };

export interface CompilerGymProxyCascadeResourceArmEvidence {
	blockOrdinal: 1 | 2;
	arm: CompilerGymProxyCascadeResourceArm;
	armOrderPosition: 1 | 2;
	allocationOrdinals: number[];
	interval: CompilerGymProxyCascadeResourceIntervalEvidence;
	stepCpuSeconds: number;
	maximumObservedEvaluatorConcurrency: number;
	environmentGate: CompilerGymPaidLiveEnvironmentGateEvidence;
	sourceReadback: CompilerGymProxyCascadeResourceSourceReadbackEvidence;
	selectionInputs: Array<{ candidateOrdinal: number; freshAcceptedBlowfishIr: number }>;
	selectedOrdinals: number[];
	frontierOrdinals: number[];
	championOrdinal: number;
	localSeal: CompilerGymProxyCascadeResourceLocalSealEvidence;
	remoteLock: CompilerGymProxyCascadeResourceRemoteLockEvidence;
}

export interface CompilerGymProxyCascadeResourceBlockEvidence {
	blockOrdinal: 1 | 2;
	armOrder: readonly [CompilerGymProxyCascadeResourceArm, CompilerGymProxyCascadeResourceArm];
	arms: CompilerGymProxyCascadeResourceArmEvidence[];
	observation: CompilerGymProxyCascadeResourceBlockObservation;
	localSeal: CompilerGymProxyCascadeResourceLocalSealEvidence;
	remoteLock: CompilerGymProxyCascadeResourceRemoteLockEvidence;
}

export interface CompilerGymProxyCascadeResourceAccountingSummary {
	actualFreshOneTaskAllocations: number;
	allocationWallSeconds: number;
	stepCpuSeconds: number;
	schedulerLogicalCpuSeconds: number;
	uniqueSlurmIds: number;
	uniqueTransientCaches: number;
	uniqueJobNames: number;
	budgetExceeded: boolean;
}

export interface CompilerGymProxyCascadeResourceRunnerResult {
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUN_RESULT_PROTOCOL;
	runnerProtocol: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL;
	runtimeMode: "production-defaults-no-dependency-injection" | "test-only-injected-runtime";
	ok: boolean;
	liveScientificEvidenceEligible: boolean;
	classification: "zero-model-counterbalanced-resource-screen-only";
	disposition: CompilerGymProxyCascadeResourceDisposition;
	failure: string | null;
	preregistrationSha256: string;
	scientificIdentitySha256: string;
	localAttemptLock: CompilerGymProxyCascadeResourceLocalSealEvidence;
	localSeals: CompilerGymProxyCascadeResourceLocalSealEvidence[];
	remoteLocks: CompilerGymProxyCascadeResourceRemoteLockEvidence[];
	globalPreparation: CompilerGymCanonicalOneTaskPreparationEvidence | null;
	preflight: CompilerGymPaidLiveEnvironmentGateEvidence | null;
	postflight: CompilerGymPaidLiveEnvironmentGateEvidence | null;
	allocations: CompilerGymProxyCascadeResourceAllocationEvidence[];
	failedAllocations: CompilerGymProxyCascadeResourceFailedAllocationEvidence[];
	blocks: CompilerGymProxyCascadeResourceBlockEvidence[];
	gate: CompilerGymProxyCascadeResourceGateResult | null;
	accounting: CompilerGymProxyCascadeResourceAccountingSummary;
	maximumObservedEvaluatorConcurrency: number;
	isolation: {
		modelCalls: 0;
		providerDispatches: 0;
		toolCalls: 0;
		compactions: 0;
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

export interface CompilerGymProxyCascadeResourceRunnerInput {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	signal?: AbortSignal;
}

export interface CompilerGymProxyCascadeResourceRunnerDependencies {
	testOnlyInjectedRuntime?: true;
	reconstructPreregistration?: (
		input: CompilerGymProxyCascadeResourceRunnerInput,
	) => Promise<CompilerGymProxyCascadeResourceReconstructedClosure>;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	evaluator?: CompilerGymProxyCascadeResourceOneTaskEvaluator;
	environmentGate?: () => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	now?: () => Date;
	monotonicNowMicros?: () => number;
}

interface RuntimeDependencies {
	runtimeMode: CompilerGymProxyCascadeResourceRunnerResult["runtimeMode"];
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	evaluator: CompilerGymProxyCascadeResourceOneTaskEvaluator;
	environmentGate: () => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	now: () => Date;
	monotonicNowMicros: () => number;
}

interface AllocationUniqueness {
	slurmIds: Set<string>;
	transientCaches: Set<string>;
	jobNames: Set<string>;
}

interface ConcurrencyTracker {
	active: number;
	maximum: number;
}

function errorText(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function errorEvidence(error: unknown): CompilerGymProxyCascadeResourceFailedAllocationEvidence["error"] {
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

function isAbsent(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function assertOutputDirectoryAbsent(path: string): Promise<void> {
	try {
		await stat(path);
		throw new Error("Resource-screen output directory must be absent before dispatch");
	} catch (error) {
		if (!isAbsent(error)) throw error;
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
		throw new Error("Resource-screen preregistration must be an object");
	}
	const createdAt = (value as Record<string, unknown>).createdAt;
	if (typeof createdAt !== "string") throw new Error("Resource-screen preregistration lacks createdAt");
	return createdAt;
}

async function readPinnedPreregistration(path: string): Promise<string> {
	const pathMetadata = await lstat(path);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || (pathMetadata.mode & 0o777) !== 0o600) {
		throw new Error("Resource-screen preregistration must be a mode-0600 regular non-symlink file");
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
			throw new Error("Resource-screen preregistration changed before its pinned read");
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
			throw new Error("Resource-screen preregistration changed during its pinned read");
		}
		return contents;
	} finally {
		await handle.close();
	}
}

async function readPinnedRegularUtf8(
	path: string,
	requiredMode?: number,
): Promise<{ contents: string; mode: number; isFile: true; isSymbolicLink: false }> {
	const pathMetadata = await lstat(path);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
		throw new Error(`Resource-screen source must be a regular non-symlink file: ${path}`);
	}
	const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (
			!before.isFile() ||
			before.dev !== pathMetadata.dev ||
			before.ino !== pathMetadata.ino ||
			(requiredMode !== undefined && (before.mode & 0o777) !== requiredMode)
		) {
			throw new Error(`Resource-screen source changed before its pinned read: ${path}`);
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
			throw new Error(`Resource-screen source changed during its pinned read: ${path}`);
		}
		return {
			contents,
			mode: before.mode,
			isFile: true,
			isSymbolicLink: false,
		};
	} finally {
		await handle.close();
	}
}

function candidateDescriptorsFromRawPreregistration(
	rawValue: unknown,
): Array<{ ordinal: number; relativePath: string }> {
	if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
		throw new Error("Resource-screen preregistration must be an object");
	}
	const candidateSources = (rawValue as Record<string, unknown>).candidateSources;
	if (!Array.isArray(candidateSources) || candidateSources.length !== 4) {
		throw new Error("Resource-screen preregistration must name four candidate sources");
	}
	return candidateSources.map((candidateValue, index) => {
		if (typeof candidateValue !== "object" || candidateValue === null || Array.isArray(candidateValue)) {
			throw new Error(`Resource-screen candidate ${index + 1} descriptor is invalid`);
		}
		const candidate = candidateValue as Record<string, unknown>;
		if (
			candidate.ordinal !== index + 1 ||
			typeof candidate.artifactPath !== "string" ||
			candidate.artifactPath.startsWith("/") ||
			candidate.artifactPath.includes("..")
		) {
			throw new Error(`Resource-screen candidate ${index + 1} path is invalid`);
		}
		return { ordinal: index + 1, relativePath: candidate.artifactPath };
	});
}

async function collectCandidateArtifactsFromRaw(input: {
	repoRoot: string;
	rawValue: unknown;
}): Promise<CompilerGymProxyCascadeCandidateArtifactInput[]> {
	const descriptors = candidateDescriptorsFromRawPreregistration(input.rawValue);
	return Promise.all(
		descriptors.map(async (descriptor) => {
			const absolutePath = resolve(input.repoRoot, descriptor.relativePath);
			if (!absolutePath.startsWith(`${input.repoRoot}${sep}`)) {
				throw new Error(`Resource-screen candidate ${descriptor.ordinal} escapes the repository`);
			}
			const pinned = await readPinnedRegularUtf8(absolutePath, 0o600);
			return {
				ordinal: descriptor.ordinal,
				relativePath: descriptor.relativePath,
				...pinned,
			};
		}),
	);
}

export async function reconstructCompilerGymProxyCascadeResourcePreregistration(
	input: CompilerGymProxyCascadeResourceRunnerInput,
): Promise<CompilerGymProxyCascadeResourceReconstructedClosure> {
	const repoRoot = resolve(input.repoRoot);
	const preregistrationPath = resolve(input.preregistrationPath);
	const outputDir = resolve(input.outputDir);
	const preregistrationContents = await readPinnedPreregistration(preregistrationPath);
	const rawValue = parseSingleCanonicalJsonLine(preregistrationContents, "Resource-screen preregistration");
	const [wiringPreregistrationContents, wiringResultContents, wiringEvidenceContents, candidateArtifacts, closure] =
		await Promise.all([
			readPinnedRegularUtf8(
				resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.preregistration.path),
				0o600,
			).then((pinned) => pinned.contents),
			readPinnedRegularUtf8(
				resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.result.path),
				0o600,
			).then((pinned) => pinned.contents),
			readPinnedRegularUtf8(
				resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.evidenceLedger.path),
				0o600,
			).then((pinned) => pinned.contents),
			collectCandidateArtifactsFromRaw({ repoRoot, rawValue }),
			collectCompilerGymProxyCascadeResourceImplementationClosure(repoRoot),
		]);
	const preregistration = parseCompilerGymProxyCascadeResourcePreregistration({
		value: rawValue,
		expected: {
			createdAt: createdAtFromPreregistration(rawValue),
			repoRoot,
			preregistrationPath,
			outputDir,
			wiringPreregistrationContents,
			wiringResultContents,
			wiringEvidenceContents,
			candidateArtifacts,
			implementationClosure: closure,
		},
	});
	if (canonicalCompilerGymProxyCascadeResourcePreregistration(preregistration) !== preregistrationContents) {
		throw new Error("Resource-screen preregistration bytes differ from their reconstructed record");
	}
	return {
		preregistration,
		preregistrationContents,
		preregistrationSha256: sha256Text(preregistrationContents),
	};
}

function validatePreregisteredRunnerContract(
	closure: CompilerGymProxyCascadeResourceReconstructedClosure,
	input: CompilerGymProxyCascadeResourceRunnerInput,
): void {
	const preregistration = closure.preregistration;
	if (!SHA256.test(closure.preregistrationSha256) || !SHA256.test(preregistration.scientificIdentitySha256)) {
		throw new Error("Resource-screen preregistration identity is invalid");
	}
	if (
		preregistration.launchPaths.repoRoot !== resolve(input.repoRoot) ||
		preregistration.launchPaths.preregistrationPath !== resolve(input.preregistrationPath) ||
		preregistration.launchPaths.outputDir !== resolve(input.outputDir)
	) {
		throw new Error("Resource-screen launch paths differ from the preregistered paths");
	}
	if (
		!preregistration.upstreamWiringQualification.semanticJoinPassed ||
		!preregistration.upstreamWiringQualification.liveScientificEvidenceEligible ||
		preregistration.upstreamWiringQualification.resultDisposition !== "happy-path-wiring-qualified-only"
	) {
		throw new Error("Resource-screen upstream wiring qualification is not eligible");
	}
	assertCompilerGymProxyCascadeResourceBlockPlan(preregistration.blockPlan);
	assertCanonicalEqual(
		preregistration.blockPlan,
		buildCompilerGymProxyCascadeResourceBlockPlan(),
		"resource-screen block plan",
	);
	assertCanonicalEqual(
		preregistration.timingContract,
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT,
		"timing contract",
	);
	assertCanonicalEqual(
		preregistration.resourceThresholds,
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS,
		"thresholds",
	);
	assertCanonicalEqual(
		preregistration.gateEvidenceContract,
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_GATE_EVIDENCE_CONTRACT,
		"gate evidence contract",
	);
	assertCanonicalEqual(preregistration.isolation, COMPILER_GYM_PROXY_CASCADE_RESOURCE_ISOLATION, "isolation");
	assertCanonicalEqual(preregistration.accounting, COMPILER_GYM_PROXY_CASCADE_RESOURCE_ACCOUNTING, "accounting");
	assertCanonicalEqual(preregistration.budgets, COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS, "budgets");
	assertCanonicalEqual(preregistration.seals.schema, COMPILER_GYM_PROXY_CASCADE_RESOURCE_SEAL_SCHEMA, "seal schema");
	if (
		preregistration.candidateSources.length !== 4 ||
		new Set(preregistration.candidateSources.map((candidate) => candidate.artifactSha256)).size !== 4 ||
		preregistration.candidateBundleSha256 !== sha256Json(preregistration.candidateSources)
	) {
		throw new Error("Resource-screen candidate bundle drifted");
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
			throw new Error(`Resource-screen candidate ${candidate.ordinal} closure drifted`);
		}
	}
	const localLockPath = preregistration.localAttemptLock.path;
	if (
		resolve(localLockPath) !== localLockPath ||
		localLockPath === resolve(input.repoRoot) ||
		localLockPath.startsWith(`${resolve(input.repoRoot)}${sep}`) ||
		!localLockPath.includes(preregistration.scientificIdentitySha256) ||
		!preregistration.localAttemptLock.createOnlyBeforeAnySsh ||
		preregistration.localAttemptLock.mode !== "0600" ||
		!preregistration.localAttemptLock.crossWorktree ||
		!preregistration.localAttemptLock.neverRemovedByRunner
	) {
		throw new Error("Resource-screen local attempt lock is not shared and identity-bound");
	}
	if (
		preregistration.seals.arm.length !== 4 ||
		preregistration.seals.cascadeSelection.length !== 2 ||
		preregistration.seals.block.length !== 2 ||
		preregistration.seals.arm.some(
			(seal) =>
				resolve(seal.path) !== seal.path ||
				!seal.path.startsWith(`${resolve(input.outputDir)}${sep}`) ||
				(seal.requiredAllocationCount !== 6 && seal.requiredAllocationCount !== 8),
		) ||
		preregistration.seals.cascadeSelection.some(
			(seal) => resolve(seal.path) !== seal.path || !seal.path.startsWith(`${resolve(input.outputDir)}${sep}`),
		) ||
		preregistration.seals.block.some(
			(seal) => resolve(seal.path) !== seal.path || !seal.path.startsWith(`${resolve(input.outputDir)}${sep}`),
		)
	) {
		throw new Error("Resource-screen local seal paths or counts drifted");
	}
	const remoteLocks = preregistration.remoteLocks;
	const remotePaths = [
		remoteLocks.globalPath,
		remoteLocks.blockOneControlPath,
		remoteLocks.blockOneCascadeSelectionPath,
		remoteLocks.blockOneCascadePath,
		remoteLocks.blockOnePath,
		remoteLocks.blockTwoCascadeSelectionPath,
		remoteLocks.blockTwoCascadePath,
		remoteLocks.blockTwoControlPath,
		remoteLocks.blockTwoPath,
		remoteLocks.terminalPath,
	];
	if (
		remoteLocks.scientificIdentitySha256 !== preregistration.scientificIdentitySha256 ||
		posix.dirname(remoteLocks.root) !== remoteLocks.parentRoot ||
		new Set(remotePaths).size !== remotePaths.length ||
		remotePaths.some((path) => posix.dirname(path) !== remoteLocks.root) ||
		remoteLocks.createOnly !== true ||
		remoteLocks.mode !== "0600" ||
		remoteLocks.writeFsyncCloseReadbackExact !== true ||
		remoteLocks.neverRemovedByRunner !== true
	) {
		throw new Error("Resource-screen remote lock schema or paths drifted");
	}
	assertCanonicalEqual(
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_LOCK_SCHEMA.remote.kinds,
		[
			"global",
			"block-one-control",
			"block-one-cascade-selection",
			"block-one-cascade",
			"block-one",
			"block-two-cascade-selection",
			"block-two-cascade",
			"block-two-control",
			"block-two",
			"terminal",
		],
		"remote lock execution order",
	);
	if (
		preregistration.frozenCommon.adapterOutputProtocol !== "compiler-gym-canonical-one-task-adapter-output-v1" ||
		preregistration.frozenCommon.canonicalEvaluator.sha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		preregistration.frozenCommon.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
		preregistration.frozenCommon.irDeltaSourceBundleSha256 !== COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256
	) {
		throw new Error("Resource-screen canonical evaluator contract drifted");
	}
}

async function writeLocalSeal(
	path: string,
	kind: CompilerGymProxyCascadeResourceLocalSealEvidence["kind"],
	value: unknown,
): Promise<CompilerGymProxyCascadeResourceLocalSealEvidence> {
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
		throw new Error(`Resource-screen ${kind} local seal readback drifted`);
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

async function verifyLocalSeals(seals: readonly CompilerGymProxyCascadeResourceLocalSealEvidence[]): Promise<void> {
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
			throw new Error(`Resource-screen ${seal.kind} local seal postflight drifted`);
		}
	}
}

async function createRemoteLock(input: {
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	kind: CompilerGymProxyCascadeResourceRemoteLockEvidence["kind"];
	path: string;
	claims: unknown;
	ensureRoot: boolean;
	signal: AbortSignal;
}): Promise<CompilerGymProxyCascadeResourceRemoteLockEvidence> {
	const locks = input.preregistration.remoteLocks;
	if (posix.dirname(locks.root) !== locks.parentRoot || posix.dirname(input.path) !== locks.root) {
		throw new Error("Resource-screen remote lock path differs from its frozen identity root");
	}
	if (input.ensureRoot) {
		await ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree(input.remoteFileSystem, locks.root, input.signal);
	}
	const contents = `${canonicalJson(toJsonValue(input.claims))}\n`;
	const contentsSha256 = sha256Text(contents);
	await input.remoteFileSystem.installImmutableFile(input.path, contents, contentsSha256, 0o600, false, input.signal);
	const readback = await input.remoteFileSystem.readTrustedFile(
		input.path,
		{ maxBytes: MAX_TRUSTED_BYTES, mode: 0o600, expectedSha256: contentsSha256 },
		input.signal,
	);
	if (readback !== contents) throw new Error(`Resource-screen ${input.kind} remote lock readback drifted`);
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

async function verifyRemoteLocks(
	remoteFileSystem: CompilerGymWarmRemoteFileSystem,
	locks: readonly CompilerGymProxyCascadeResourceRemoteLockEvidence[],
	signal: AbortSignal,
): Promise<void> {
	for (const lock of locks) {
		const expected = `${canonicalJson(toJsonValue(lock.claims))}\n`;
		const readback = await remoteFileSystem.readTrustedFile(
			lock.path,
			{ maxBytes: MAX_TRUSTED_BYTES, mode: 0o600, expectedSha256: lock.contentsSha256 },
			signal,
		);
		if (readback !== expected) throw new Error(`Resource-screen ${lock.kind} remote lock postflight drifted`);
	}
}

function validateGlobalPreparation(
	preparation: CompilerGymCanonicalOneTaskPreparationEvidence,
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
): void {
	const expectedSourceDirectory = posix.join(
		preregistration.frozenCommon.environment.remoteSourceRoot,
		preregistration.frozenCommon.irDeltaSourceBundleSha256,
	);
	if (
		preparation.sourceBundleSha256 !== preregistration.frozenCommon.irDeltaSourceBundleSha256 ||
		preparation.sourceDirectory !== expectedSourceDirectory ||
		preparation.canonicalRemoteEvaluatorPath !== posix.join(expectedSourceDirectory, "compiler_gym_eval.py") ||
		preparation.irDeltaRemoteEvaluatorPath !== posix.join(expectedSourceDirectory, "compiler_gym_ir_delta_eval.py")
	) {
		throw new Error("Resource-screen global evaluator preparation drifted");
	}
}

async function verifyRemoteEvaluatorSources(input: {
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	signal: AbortSignal;
}): Promise<CompilerGymProxyCascadeResourceSourceReadbackEvidence> {
	const sourceDirectory = posix.join(
		input.preregistration.frozenCommon.environment.remoteSourceRoot,
		input.preregistration.frozenCommon.irDeltaSourceBundleSha256,
	);
	const canonicalRemoteEvaluatorPath = posix.join(sourceDirectory, "compiler_gym_eval.py");
	const irDeltaRemoteEvaluatorPath = posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py");
	const [canonicalReadback, irDeltaReadback] = await Promise.all([
		input.remoteFileSystem.readTrustedFile(
			canonicalRemoteEvaluatorPath,
			{
				maxBytes: MAX_TRUSTED_BYTES,
				mode: 0o600,
				expectedSha256: input.preregistration.frozenCommon.canonicalEvaluator.sha256,
			},
			input.signal,
		),
		input.remoteFileSystem.readTrustedFile(
			irDeltaRemoteEvaluatorPath,
			{
				maxBytes: MAX_TRUSTED_BYTES,
				mode: 0o600,
				expectedSha256: input.preregistration.frozenCommon.irDeltaEvaluator.sha256,
			},
			input.signal,
		),
	]);
	const canonicalEvaluatorSha256 = sha256Text(canonicalReadback);
	const irDeltaEvaluatorSha256 = sha256Text(irDeltaReadback);
	if (
		canonicalEvaluatorSha256 !== input.preregistration.frozenCommon.canonicalEvaluator.sha256 ||
		irDeltaEvaluatorSha256 !== input.preregistration.frozenCommon.irDeltaEvaluator.sha256
	) {
		throw new Error("Resource-screen remote evaluator source readback drifted");
	}
	return {
		sourceBundleSha256: input.preregistration.frozenCommon.irDeltaSourceBundleSha256,
		sourceDirectory,
		canonicalRemoteEvaluatorPath,
		canonicalEvaluatorSha256,
		irDeltaRemoteEvaluatorPath,
		irDeltaEvaluatorSha256,
	};
}

function verifyEnvironmentEquivalent(
	reference: CompilerGymPaidLiveEnvironmentGateEvidence,
	observed: CompilerGymPaidLiveEnvironmentGateEvidence,
): void {
	assertCanonicalEqual({ ...reference, wallMs: 0 }, { ...observed, wallMs: 0 }, "resource-screen environment gate");
}

function candidateByOrdinal(
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	ordinal: number,
): CompilerGymProxyCascadeCandidateSource {
	const candidate = preregistration.candidateSources.find((item) => item.ordinal === ordinal);
	if (!candidate) throw new Error(`Resource-screen candidate ${ordinal} is absent`);
	return candidate;
}

function buildEvaluationJob(
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	allocation: CompilerGymProxyCascadeResourceRealizedAllocationSpec,
): EvaluationJob {
	const candidate = candidateByOrdinal(preregistration, allocation.candidateOrdinal);
	const jobId = `proxy-cascade-resource-${preregistration.scientificIdentitySha256.slice(0, 12)}-${String(
		allocation.globalAllocationOrdinal,
	).padStart(2, "0")}`;
	const manifest = {
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
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
		branchId: `proxy-cascade-resource-${preregistration.scientificIdentitySha256}`,
		lane: "compiler-gym",
		benchmarkIds: [allocation.benchmarkId],
		budgetClass: "screen",
		treatment: `proxy-cascade-resource-${allocation.arm}`,
		proposal: {
			hypothesis: `Freshly evaluate frozen candidate ${allocation.candidateOrdinal} on ${allocation.benchmarkId}`,
			mechanism: "Counterbalanced source-sealed full-versus-cascade resource screen",
			predictedOutcome: "Exactly reproduce the preregistered metric anchors under fresh terminal accounting",
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

function registerUniqueAllocation(
	aggregate: CompilerGymCanonicalOneTaskAggregate,
	uniqueness: AllocationUniqueness,
): void {
	const task = aggregate.tasks[0];
	if (!task) throw new Error("Resource-screen canonical aggregate has no task");
	for (const [label, value, values] of [
		["Slurm allocation", task.slurmId, uniqueness.slurmIds],
		["transient cache", task.transientCache, uniqueness.transientCaches],
		["job name", task.jobName, uniqueness.jobNames],
	] as const) {
		if (values.has(value)) throw new Error(`Resource-screen ${label} ${value} was reused`);
		values.add(value);
	}
}

function validateAllocationOutcome(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	allocation: CompilerGymProxyCascadeResourceRealizedAllocationSpec;
	job: EvaluationJob;
	outcome: EvaluationOutcome;
	uniqueness: AllocationUniqueness;
	completedAt: string;
}): CompilerGymProxyCascadeResourceAllocationEvidence {
	const { allocation, job, outcome, preregistration } = input;
	if (typeof outcome.stdout !== "string") throw new Error("Canonical one-task evaluation lacks aggregate stdout");
	const aggregate = parseCompilerGymCanonicalOneTaskAggregate(outcome.stdout);
	const candidate = candidateByOrdinal(preregistration, allocation.candidateOrdinal);
	const sourceDirectory = posix.join(
		preregistration.frozenCommon.environment.remoteSourceRoot,
		preregistration.frozenCommon.irDeltaSourceBundleSha256,
	);
	const aggregateTask = aggregate.tasks[0];
	if (
		!aggregateTask ||
		aggregate.jobId !== job.jobId ||
		aggregate.manifestDigest !== job.manifestDigest ||
		aggregate.candidateSha256 !== candidate.artifactSha256 ||
		aggregate.actionsSha256 !== sha256Json(candidate.actions) ||
		aggregate.verifierEpoch !== preregistration.frozenCommon.verifierEpoch ||
		aggregate.evaluatorSha256 !== preregistration.frozenCommon.canonicalEvaluator.sha256 ||
		aggregate.sourceBundleSha256 !== preregistration.frozenCommon.irDeltaSourceBundleSha256 ||
		aggregate.sourceDirectory !== sourceDirectory ||
		aggregate.remoteEvaluatorPath !== posix.join(sourceDirectory, "compiler_gym_eval.py") ||
		aggregate.measurementReuse !== false ||
		aggregateTask.benchmarkId !== allocation.benchmarkId
	) {
		throw new Error(`Resource-screen allocation ${allocation.globalAllocationOrdinal} aggregate binding drifted`);
	}
	const expectedRequest = `${canonicalJson(
		toJsonValue({ benchmark: allocation.benchmarkId, actions: candidate.actions }),
	)}\n`;
	if (aggregateTask.requestSha256 !== sha256Text(expectedRequest)) {
		throw new Error(`Resource-screen allocation ${allocation.globalAllocationOrdinal} request binding drifted`);
	}
	const raw = parseCompilerGymIrDeltaQualificationEvaluatorResult({
		stdout: aggregateTask.stdout,
		exitCode: aggregateTask.exitCode,
		arm: "canonical",
		benchmarkId: allocation.benchmarkId,
		actions: candidate.actions,
	});
	const task = outcome.tasks[0];
	if (
		raw.outcome !== "verified" ||
		!raw.final.verifierPassed ||
		raw.slurmId !== aggregateTask.slurmId ||
		outcome.verifierEpoch !== preregistration.frozenCommon.verifierEpoch ||
		(outcome.stderr ?? "") !== aggregateTask.stderr ||
		outcome.tasks.length !== 1 ||
		!task ||
		task.benchmarkId !== allocation.benchmarkId ||
		task.status !== "accepted" ||
		!task.verifier.passed ||
		task.verifier.errors.length !== 0
	) {
		throw new Error(`Resource-screen allocation ${allocation.globalAllocationOrdinal} outcome is not accepted`);
	}
	assertCanonicalEqual(
		outcome.hardware,
		{
			cluster: "Stanford FarmShare",
			partition: preregistration.frozenCommon.environment.partition,
			cpuConstraint: preregistration.frozenCommon.environment.cpuConstraint,
		},
		`allocation ${allocation.globalAllocationOrdinal} hardware`,
	);
	assertCanonicalEqual(
		outcome.provenance,
		COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE,
		`allocation ${allocation.globalAllocationOrdinal} provenance`,
	);
	const anchor =
		allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH
			? candidate.expectedMetrics.blowfish
			: candidate.expectedMetrics.bzip2;
	if (
		task.metrics.IrInstructionCount !== anchor.irInstructionCount ||
		task.metrics.ObjectTextSizeBytes !== anchor.objectTextSizeBytes ||
		raw.final.irInstructionCount !== task.metrics.IrInstructionCount ||
		raw.final.objectTextSizeBytes !== task.metrics.ObjectTextSizeBytes ||
		raw.intrinsicTotalMs !== task.metrics.evaluatorRuntimeMs ||
		task.runtimeMs !== aggregateTask.accountingRows.root.elapsedRawSeconds * 1_000 ||
		aggregateTask.accountingRows.step.cpuTimeRawSeconds !==
			aggregateTask.accountingRows.step.elapsedRawSeconds * aggregateTask.accountingRows.step.allocCpus
	) {
		throw new Error(
			`Resource-screen allocation ${allocation.globalAllocationOrdinal} metric or accounting anchor drifted`,
		);
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

function sortedAllocations(
	allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[],
): CompilerGymProxyCascadeResourceAllocationEvidence[] {
	return [...allocations].sort(
		(left, right) => left.allocation.globalAllocationOrdinal - right.allocation.globalAllocationOrdinal,
	);
}

function irForAllocation(allocation: CompilerGymProxyCascadeResourceAllocationEvidence): number {
	const value = allocation.outcome.tasks[0]?.metrics.IrInstructionCount;
	if (!Number.isSafeInteger(value) || value < 1) throw new Error("Resource-screen IR metric is invalid");
	return value;
}

function taskPointFromAllocation(
	allocation: CompilerGymProxyCascadeResourceAllocationEvidence,
): CompilerGymProxyCascadeTaskPoint {
	const task = allocation.outcome.tasks[0];
	if (!task) throw new Error("Resource-screen allocation lacks its task measurement");
	const runtimeMs = task.metrics.evaluatorRuntimeMs;
	if (!Number.isFinite(runtimeMs) || runtimeMs <= 0) throw new Error("Resource-screen evaluator runtime is invalid");
	return {
		benchmarkId: allocation.allocation.benchmarkId,
		irInstructionCount: task.metrics.IrInstructionCount!,
		objectTextSizeBytes: task.metrics.ObjectTextSizeBytes!,
		evaluatorRuntimeMicros: Math.round(runtimeMs * 1_000),
	};
}

interface ResourceCandidatePoint {
	ordinal: number;
	candidateSha256: string;
	blowfish: CompilerGymProxyCascadeTaskPoint;
	bzip2: CompilerGymProxyCascadeTaskPoint;
}

function buildFullCandidatePoints(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[];
	candidateOrdinals?: readonly number[];
}): ResourceCandidatePoint[] {
	const candidateOrdinals = new Set(
		input.candidateOrdinals ?? input.preregistration.candidateSources.map((candidate) => candidate.ordinal),
	);
	return input.preregistration.candidateSources
		.filter((candidate) => candidateOrdinals.has(candidate.ordinal))
		.map((candidate) => {
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
				throw new Error(`Resource-screen candidate ${candidate.ordinal} lacks one fresh measurement per task`);
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
): number {
	const difference =
		BigInt(leftNumerator) * BigInt(rightDenominator) - BigInt(rightNumerator) * BigInt(leftDenominator);
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function compareChampion(left: ResourceCandidatePoint, right: ResourceCandidatePoint): number {
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

function assessFullArm(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[];
}): { frontierOrdinals: number[]; championOrdinal: number } {
	const candidates = buildFullCandidatePoints(input);
	const frontierOrdinals = compilerGymProxyCascadeParetoFrontierOrdinals(candidates);
	const champion = candidates
		.filter((candidate) => frontierOrdinals.includes(candidate.ordinal))
		.sort(compareChampion)[0];
	if (!champion) throw new Error("Resource-screen full control has no champion");
	assertCanonicalEqual(
		frontierOrdinals,
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS,
		"resource-screen control frontier",
	);
	if (champion.ordinal !== COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL) {
		throw new Error("Resource-screen control champion differs from the frozen oracle");
	}
	return { frontierOrdinals, championOrdinal: champion.ordinal };
}

function selectCascadeFromFreshBlowfish(allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[]): {
	selectionInputs: Array<{ candidateOrdinal: number; freshAcceptedBlowfishIr: number }>;
	selectedOrdinals: number[];
} {
	const blowfish = sortedAllocations(allocations).filter(
		(allocation) => allocation.allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	);
	if (blowfish.length !== 4) throw new Error("Resource-screen cascade selection requires four fresh blowfish values");
	const selectionInputs = blowfish.map((allocation) => ({
		candidateOrdinal: allocation.allocation.candidateOrdinal,
		freshAcceptedBlowfishIr: irForAllocation(allocation),
	}));
	const selection = selectCompilerGymProxyCascadeOrdinals(
		selectionInputs.map((item) => ({
			ordinal: item.candidateOrdinal,
			blowfishIrInstructionCount: item.freshAcceptedBlowfishIr,
		})),
	);
	if (selection.proxyTiersAscending.length !== 4) throw new Error("Resource-screen cascade proxy scores are tied");
	assertCanonicalEqual(
		selection.selectedOrdinals,
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_SELECTED_ORDINALS,
		"fresh cascade selected ordinals",
	);
	return { selectionInputs, selectedOrdinals: selection.selectedOrdinals };
}

function scientificEvidence(allocation: CompilerGymProxyCascadeResourceAllocationEvidence) {
	const task = allocation.outcome.tasks[0];
	const aggregateTask = allocation.aggregate.tasks[0];
	if (!task || !aggregateTask) throw new Error("Resource-screen allocation lacks scientific evidence");
	return {
		globalAllocationOrdinal: allocation.allocation.globalAllocationOrdinal,
		blockOrdinal: allocation.allocation.blockOrdinal,
		arm: allocation.allocation.arm,
		candidateOrdinal: allocation.allocation.candidateOrdinal,
		benchmarkId: allocation.allocation.benchmarkId,
		candidateSha256: allocation.aggregate.candidateSha256,
		irInstructionCount: task.metrics.IrInstructionCount,
		objectTextSizeBytes: task.metrics.ObjectTextSizeBytes,
		measurementPayloadSha256: allocation.measurementPayloadSha256,
		slurmId: aggregateTask.slurmId,
		stepCpuTimeRawSeconds: aggregateTask.accountingRows.step.cpuTimeRawSeconds,
		rootCpuTimeRawSeconds: aggregateTask.accountingRows.root.cpuTimeRawSeconds,
	};
}

function stepCpuSeconds(allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[]): number {
	return allocations.reduce((sum, allocation) => {
		const task = allocation.aggregate.tasks[0];
		if (!task) throw new Error("Resource-screen allocation lacks accounting evidence");
		return sum + task.accountingRows.step.cpuTimeRawSeconds;
	}, 0);
}

function validateMonotonicMicros(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`${label} must be a non-negative safe-integer microsecond value`);
}

async function runRound(input: {
	allocations: readonly CompilerGymProxyCascadeResourceRealizedAllocationSpec[];
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	evaluator: CompilerGymProxyCascadeResourceOneTaskEvaluator;
	ledger: EvidenceLedger;
	uniqueness: AllocationUniqueness;
	completed: CompilerGymProxyCascadeResourceAllocationEvidence[];
	failed: CompilerGymProxyCascadeResourceFailedAllocationEvidence[];
	concurrency: ConcurrencyTracker;
	now: () => Date;
	signal: AbortSignal;
}): Promise<void> {
	if (input.allocations.length < 1 || input.allocations.length > 2) {
		throw new Error("Resource-screen round concurrency must be one or two");
	}
	const settled = await Promise.allSettled(
		input.allocations.map(async (allocation) => {
			const job = buildEvaluationJob(input.preregistration, allocation);
			input.concurrency.active++;
			input.concurrency.maximum = Math.max(input.concurrency.maximum, input.concurrency.active);
			try {
				if (input.concurrency.active > 2) throw new Error("Resource-screen exceeded two concurrent evaluators");
				const outcome = await input.evaluator.evaluateCanonicalOneTask(job, {
					signal: input.signal,
					recordExternalJobId: async () => {
						throw new Error("Resource-screen evaluator may not delegate external job identity recording");
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
						type: "proxy_cascade_resource_allocation",
						protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
						status: "completed",
						...evidence,
					},
					evidence.completedAt,
				);
				input.completed.push(evidence);
				return evidence;
			} catch (error) {
				const failure: CompilerGymProxyCascadeResourceFailedAllocationEvidence = {
					allocation: structuredClone(allocation),
					job: structuredClone(job),
					error: errorEvidence(error),
					failedAt: input.now().toISOString(),
				};
				await input.ledger.append(
					"measurement",
					{
						type: "proxy_cascade_resource_allocation",
						protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
						status: "failed",
						...failure,
					},
					failure.failedAt,
				);
				input.failed.push(failure);
				throw error;
			} finally {
				input.concurrency.active--;
			}
		}),
	);
	const rejected = settled.filter((result) => result.status === "rejected");
	if (rejected.length > 0) {
		throw new Error(
			`Resource-screen round failed in ${rejected.length} of ${input.allocations.length} allocations: ${rejected
				.map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)))
				.join("; ")}`,
		);
	}
}

const DEFAULT_ONE_TASK_CONFIG: FarmShareCompilerGymIrDeltaScreenAdapterConfig = {
	...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	environment: structuredClone(DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG.environment),
	accountingMode: "required",
	accountingEvidenceVersion: "exact-three-row-v1",
};

function snapshotRunnerDependencies(
	dependencies: CompilerGymProxyCascadeResourceRunnerDependencies,
): CompilerGymProxyCascadeResourceRunnerDependencies {
	return {
		testOnlyInjectedRuntime: dependencies.testOnlyInjectedRuntime,
		reconstructPreregistration: dependencies.reconstructPreregistration,
		remoteFileSystem: dependencies.remoteFileSystem,
		evaluator: dependencies.evaluator,
		environmentGate: dependencies.environmentGate,
		now: dependencies.now,
		monotonicNowMicros: dependencies.monotonicNowMicros,
	};
}

function validateDependencyBoundary(dependencies: CompilerGymProxyCascadeResourceRunnerDependencies): void {
	if (dependencies.testOnlyInjectedRuntime === true) {
		if (
			!dependencies.reconstructPreregistration ||
			!dependencies.remoteFileSystem ||
			!dependencies.evaluator ||
			!dependencies.environmentGate ||
			!dependencies.now ||
			!dependencies.monotonicNowMicros
		) {
			throw new Error("Test-only resource-screen runtime requires complete injected dependencies");
		}
		return;
	}
	if (
		dependencies.reconstructPreregistration ||
		dependencies.remoteFileSystem ||
		dependencies.evaluator ||
		dependencies.environmentGate ||
		dependencies.now ||
		dependencies.monotonicNowMicros
	) {
		throw new Error("Resource-screen dependency injection must be explicitly test-only");
	}
}

function resolveRuntimeDependencies(
	input: CompilerGymProxyCascadeResourceRunnerInput,
	dependencies: CompilerGymProxyCascadeResourceRunnerDependencies,
): RuntimeDependencies {
	if (dependencies.testOnlyInjectedRuntime === true) {
		if (
			!dependencies.remoteFileSystem ||
			!dependencies.evaluator ||
			!dependencies.environmentGate ||
			!dependencies.now ||
			!dependencies.monotonicNowMicros
		) {
			throw new Error("Test-only resource-screen runtime requires complete injected dependencies");
		}
		return {
			runtimeMode: "test-only-injected-runtime",
			remoteFileSystem: dependencies.remoteFileSystem,
			evaluator: dependencies.evaluator,
			environmentGate: dependencies.environmentGate,
			now: dependencies.now,
			monotonicNowMicros: dependencies.monotonicNowMicros,
		};
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
		monotonicNowMicros: () => Math.round(performance.now() * 1_000),
	};
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
		throw new Error("Resource-screen result readback drifted");
	}
}

function accountingSummary(
	allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[],
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	enforceBudget = true,
): CompilerGymProxyCascadeResourceAccountingSummary {
	const summary: CompilerGymProxyCascadeResourceAccountingSummary = {
		actualFreshOneTaskAllocations: allocations.length,
		allocationWallSeconds: 0,
		stepCpuSeconds: 0,
		schedulerLogicalCpuSeconds: 0,
		uniqueSlurmIds: new Set(allocations.map((item) => item.aggregate.tasks[0].slurmId)).size,
		uniqueTransientCaches: new Set(allocations.map((item) => item.aggregate.tasks[0].transientCache)).size,
		uniqueJobNames: new Set(allocations.map((item) => item.aggregate.tasks[0].jobName)).size,
		budgetExceeded: false,
	};
	for (const allocation of allocations) {
		const rows = allocation.aggregate.tasks[0].accountingRows;
		summary.allocationWallSeconds += rows.root.elapsedRawSeconds;
		summary.stepCpuSeconds += rows.step.cpuTimeRawSeconds;
		summary.schedulerLogicalCpuSeconds += rows.root.cpuTimeRawSeconds;
	}
	summary.budgetExceeded =
		summary.actualFreshOneTaskAllocations > preregistration.budgets.totalFreshOnlineAllocations ||
		summary.allocationWallSeconds > preregistration.budgets.allocationWallMinutesMaximum * 60 ||
		summary.stepCpuSeconds > preregistration.budgets.requestedTaskCpuMinutesMaximum * 60 ||
		summary.schedulerLogicalCpuSeconds > preregistration.budgets.schedulerLogicalCpuMinutesMaximum * 60;
	if (enforceBudget && summary.budgetExceeded) {
		throw new Error("Resource-screen accounting exceeded its preregistered budget");
	}
	return summary;
}

function exactMetricCount(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[];
}): number {
	return input.allocations.filter((allocation) => {
		const task = allocation.outcome.tasks[0];
		const candidate = candidateByOrdinal(input.preregistration, allocation.allocation.candidateOrdinal);
		const anchor =
			allocation.allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH
				? candidate.expectedMetrics.blowfish
				: candidate.expectedMetrics.bzip2;
		return (
			task?.status === "accepted" &&
			task.verifier.passed &&
			task.verifier.errors.length === 0 &&
			task.metrics.IrInstructionCount === anchor.irInstructionCount &&
			task.metrics.ObjectTextSizeBytes === anchor.objectTextSizeBytes
		);
	}).length;
}

function armObservationBase(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[];
	interval: CompilerGymProxyCascadeResourceIntervalEvidence;
}): CompilerGymProxyCascadeResourceArmObservation {
	return {
		allocationCount: input.allocations.length,
		stepCpuSeconds: stepCpuSeconds(input.allocations),
		feedbackReadyWallMicros: input.interval.feedbackReadyWallMicros,
		acceptedExactMetricCount: exactMetricCount(input),
		expectedExactMetricCount: input.allocations.length,
		passedVerifierCount: input.allocations.filter((allocation) => {
			const task = allocation.outcome.tasks[0];
			return task?.status === "accepted" && task.verifier.passed && task.verifier.errors.length === 0;
		}).length,
		expectedVerifierCount: input.allocations.length,
	};
}

function buildBlockObservation(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	block: CompilerGymProxyCascadeResourceBlockSpec;
	arms: readonly CompilerGymProxyCascadeResourceArmEvidence[];
	allocations: readonly CompilerGymProxyCascadeResourceAllocationEvidence[];
}): CompilerGymProxyCascadeResourceBlockObservation {
	const controlArm = input.arms.find((arm) => arm.arm === "full-control");
	const cascadeArm = input.arms.find((arm) => arm.arm === "proxy-cascade");
	if (!controlArm || !cascadeArm) throw new Error(`Resource-screen block ${input.block.blockOrdinal} lacks both arms`);
	const controlAllocations = input.allocations.filter(
		(allocation) =>
			allocation.allocation.blockOrdinal === input.block.blockOrdinal &&
			allocation.allocation.arm === "full-control",
	);
	const cascadeAllocations = input.allocations.filter(
		(allocation) =>
			allocation.allocation.blockOrdinal === input.block.blockOrdinal &&
			allocation.allocation.arm === "proxy-cascade",
	);
	const controlOracle = assessFullArm({ preregistration: input.preregistration, allocations: controlAllocations });
	return {
		blockOrdinal: input.block.blockOrdinal,
		apparatusValid: true,
		control: {
			...armObservationBase({
				preregistration: input.preregistration,
				allocations: controlAllocations,
				interval: controlArm.interval,
			}),
			oracleFrontierOrdinals: controlOracle.frontierOrdinals,
			oracleChampionOrdinal: controlOracle.championOrdinal,
		},
		cascade: {
			...armObservationBase({
				preregistration: input.preregistration,
				allocations: cascadeAllocations,
				interval: cascadeArm.interval,
			}),
			selectedOrdinals: [...cascadeArm.selectedOrdinals],
		},
	};
}

function localSealClaims(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	preregistrationSha256: string;
	outputDir: string;
	attemptedAt: string;
}) {
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
		kind: "attempt",
		scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
		preregistrationSha256: input.preregistrationSha256,
		blockPlanSha256: sha256Json(input.preregistration.blockPlan),
		candidateBundleSha256: input.preregistration.candidateBundleSha256,
		implementationBundleSha256: input.preregistration.implementationBundleSha256,
		outputDir: input.outputDir,
		attemptedAt: input.attemptedAt,
		allocationRetries: 0,
		replacementAllocations: 0,
	};
}

function armSealPath(
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	blockOrdinal: 1 | 2,
	arm: CompilerGymProxyCascadeResourceArm,
): string {
	const seal = preregistration.seals.arm.find((item) => item.blockOrdinal === blockOrdinal && item.arm === arm);
	if (!seal) throw new Error(`Resource-screen block ${blockOrdinal} ${arm} arm seal path is absent`);
	return seal.path;
}

function selectionSealPath(
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	blockOrdinal: 1 | 2,
): string {
	const seal = preregistration.seals.cascadeSelection.find((item) => item.blockOrdinal === blockOrdinal);
	if (!seal) throw new Error(`Resource-screen block ${blockOrdinal} selection seal path is absent`);
	return seal.path;
}

function blockSealPath(preregistration: CompilerGymProxyCascadeResourcePreregistration, blockOrdinal: 1 | 2): string {
	const seal = preregistration.seals.block.find((item) => item.blockOrdinal === blockOrdinal);
	if (!seal) throw new Error(`Resource-screen block ${blockOrdinal} seal path is absent`);
	return seal.path;
}

function armRemoteLockPath(
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	blockOrdinal: 1 | 2,
	arm: CompilerGymProxyCascadeResourceArm,
): string {
	if (blockOrdinal === 1) {
		return arm === "full-control"
			? preregistration.remoteLocks.blockOneControlPath
			: preregistration.remoteLocks.blockOneCascadePath;
	}
	return arm === "full-control"
		? preregistration.remoteLocks.blockTwoControlPath
		: preregistration.remoteLocks.blockTwoCascadePath;
}

function selectionRemoteLockPath(
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	blockOrdinal: 1 | 2,
): string {
	return blockOrdinal === 1
		? preregistration.remoteLocks.blockOneCascadeSelectionPath
		: preregistration.remoteLocks.blockTwoCascadeSelectionPath;
}

function blockRemoteLockPath(
	preregistration: CompilerGymProxyCascadeResourcePreregistration,
	blockOrdinal: 1 | 2,
): string {
	return blockOrdinal === 1 ? preregistration.remoteLocks.blockOnePath : preregistration.remoteLocks.blockTwoPath;
}

function realizeAllocation(
	allocation: CompilerGymProxyCascadeResourceAllocationSpec,
	selectedOrdinals: readonly number[],
): CompilerGymProxyCascadeResourceRealizedAllocationSpec {
	if (allocation.candidateOrdinal !== null) {
		if (
			allocation.candidateBinding !== "frozen-source-ordinal" ||
			allocation.selectionRank !== null ||
			allocation.expectedCandidateOrdinal !== allocation.candidateOrdinal
		) {
			throw new Error(`Resource-screen allocation ${allocation.globalAllocationOrdinal} fixed binding drifted`);
		}
		return { ...structuredClone(allocation), candidateOrdinal: allocation.candidateOrdinal };
	}
	if (
		allocation.candidateBinding !== "derive-only-from-this-arms-four-fresh-accepted-blowfish-ir-values" ||
		allocation.selectionRank === null ||
		selectedOrdinals.length !== 2
	) {
		throw new Error(`Resource-screen allocation ${allocation.globalAllocationOrdinal} selection binding drifted`);
	}
	const candidateOrdinal = selectedOrdinals[allocation.selectionRank - 1];
	if (!candidateOrdinal || candidateOrdinal !== allocation.expectedCandidateOrdinal) {
		throw new Error(
			`Resource-screen allocation ${allocation.globalAllocationOrdinal} fresh selection missed its anchor`,
		);
	}
	return { ...structuredClone(allocation), candidateOrdinal };
}

interface ArmRunDraft {
	blockOrdinal: 1 | 2;
	arm: CompilerGymProxyCascadeResourceArm;
	armOrderPosition: 1 | 2;
	allocationOrdinals: number[];
	interval: CompilerGymProxyCascadeResourceIntervalEvidence;
	stepCpuSeconds: number;
	maximumObservedEvaluatorConcurrency: number;
	selectionInputs: Array<{ candidateOrdinal: number; freshAcceptedBlowfishIr: number }>;
	selectedOrdinals: number[];
	frontierOrdinals: number[];
	championOrdinal: number;
	selectionSeal: CompilerGymProxyCascadeResourceLocalSealEvidence | null;
	selectionRemoteLock: CompilerGymProxyCascadeResourceRemoteLockEvidence | null;
}

async function runArm(input: {
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	block: CompilerGymProxyCascadeResourceBlockSpec;
	arm: CompilerGymProxyCascadeResourceBlockSpec["arms"][number];
	selectionSealPath: string | null;
	selectionRemoteLockPath: string | null;
	preregistrationSha256: string;
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	remoteLocks: CompilerGymProxyCascadeResourceRemoteLockEvidence[];
	localSeals: CompilerGymProxyCascadeResourceLocalSealEvidence[];
	evaluator: CompilerGymProxyCascadeResourceOneTaskEvaluator;
	ledger: EvidenceLedger;
	uniqueness: AllocationUniqueness;
	completed: CompilerGymProxyCascadeResourceAllocationEvidence[];
	failed: CompilerGymProxyCascadeResourceFailedAllocationEvidence[];
	concurrency: ConcurrencyTracker;
	now: () => Date;
	monotonicNowMicros: () => number;
	signal: AbortSignal;
}): Promise<ArmRunDraft> {
	const armCompletedBefore = input.completed.length;
	let selectionInputs: ArmRunDraft["selectionInputs"] = [];
	let selectedOrdinals: number[] = [];
	let selectionSeal: CompilerGymProxyCascadeResourceLocalSealEvidence | null = null;
	let selectionRemoteLock: CompilerGymProxyCascadeResourceRemoteLockEvidence | null = null;
	const startedMonotonicMicros = input.monotonicNowMicros();
	validateMonotonicMicros(startedMonotonicMicros, "Resource-screen arm start");
	for (const round of input.arm.rounds) {
		const roundSpecs = round.allocationOrdinals.map((ordinal) => {
			const allocation = input.arm.allocations.find((item) => item.globalAllocationOrdinal === ordinal);
			if (!allocation) throw new Error(`Resource-screen round allocation ${ordinal} disappeared`);
			return allocation;
		});
		if (
			roundSpecs.length !== round.maximumConcurrency ||
			roundSpecs.some(
				(allocation) =>
					allocation.roundOrdinal !== round.roundOrdinal || allocation.concurrencyGroup !== round.concurrencyGroup,
			)
		) {
			throw new Error(`Resource-screen block ${input.block.blockOrdinal} arm ${input.arm.arm} round drifted`);
		}
		const completedOrdinals = new Set(input.completed.map((item) => item.allocation.globalAllocationOrdinal));
		if (
			roundSpecs.some((allocation) =>
				allocation.dependsOnGlobalAllocationOrdinals.some((id) => !completedOrdinals.has(id)),
			)
		) {
			throw new Error(`Resource-screen round ${round.roundOrdinal} dependency barrier is incomplete`);
		}
		if (roundSpecs.some((allocation) => allocation.candidateOrdinal === null)) {
			if (input.arm.arm !== "proxy-cascade" || round.roundOrdinal !== 5 || selectionSeal !== null) {
				throw new Error("Resource-screen derived candidate slots appeared outside the cascade selection boundary");
			}
			const armCompleted = input.completed.slice(armCompletedBefore);
			const selection = selectCascadeFromFreshBlowfish(armCompleted);
			selectionInputs = selection.selectionInputs;
			selectedOrdinals = selection.selectedOrdinals;
			if (!input.selectionSealPath) throw new Error("Resource-screen cascade selection seal path is absent");
			const selectionValue = {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
				kind: "selection",
				scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
				preregistrationSha256: input.preregistrationSha256,
				blockOrdinal: input.block.blockOrdinal,
				arm: input.arm.arm,
				selectionInputs,
				selectedOrdinals,
				evidenceBindings: armCompleted.map(scientificEvidence),
			};
			selectionSeal = await writeLocalSeal(input.selectionSealPath, "selection", selectionValue);
			input.localSeals.push(selectionSeal);
			await input.ledger.append(
				"run_manifest",
				{ type: "proxy_cascade_resource_selection_seal", ...selectionSeal },
				input.now().toISOString(),
			);
			if (!input.selectionRemoteLockPath)
				throw new Error("Resource-screen cascade selection remote lock path is absent");
			selectionRemoteLock = await createRemoteLock({
				remoteFileSystem: input.remoteFileSystem,
				preregistration: input.preregistration,
				kind: "selection",
				path: input.selectionRemoteLockPath,
				claims: {
					schemaVersion: 1,
					protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
					kind: "selection",
					scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
					preregistrationSha256: input.preregistrationSha256,
					blockOrdinal: input.block.blockOrdinal,
					selectionSealSha256: selectionSeal.contentsSha256,
					selectedOrdinals,
					createdAt: input.now().toISOString(),
				},
				ensureRoot: false,
				signal: input.signal,
			});
			input.remoteLocks.push(selectionRemoteLock);
			await input.ledger.append(
				"run_manifest",
				{ type: "proxy_cascade_resource_remote_lock", ...selectionRemoteLock },
				input.now().toISOString(),
			);
		}
		const realized = roundSpecs.map((allocation) => realizeAllocation(allocation, selectedOrdinals));
		await runRound({
			allocations: realized,
			preregistration: input.preregistration,
			evaluator: input.evaluator,
			ledger: input.ledger,
			uniqueness: input.uniqueness,
			completed: input.completed,
			failed: input.failed,
			concurrency: input.concurrency,
			now: input.now,
			signal: input.signal,
		});
	}
	const feedbackReadyMonotonicMicros = input.monotonicNowMicros();
	validateMonotonicMicros(feedbackReadyMonotonicMicros, "Resource-screen arm end");
	if (feedbackReadyMonotonicMicros <= startedMonotonicMicros) {
		throw new Error("Resource-screen feedback-ready monotonic interval is not positive");
	}
	const feedbackReadyWallMicros = feedbackReadyMonotonicMicros - startedMonotonicMicros;
	if (!Number.isSafeInteger(feedbackReadyWallMicros))
		throw new Error("Resource-screen wall interval is not a safe integer");
	const armAllocations = sortedAllocations(input.completed.slice(armCompletedBefore));
	if (armAllocations.length !== input.arm.onlineAllocationCount) {
		throw new Error(`Resource-screen ${input.arm.arm} arm allocation count drifted`);
	}
	const maximumMinutes =
		input.arm.arm === "full-control"
			? input.preregistration.budgets.maximumTimedControlArmMinutes
			: input.preregistration.budgets.maximumTimedCascadeArmMinutes;
	if (feedbackReadyWallMicros > maximumMinutes * 60 * 1_000_000) {
		throw new Error(`Resource-screen ${input.arm.arm} timed interval exceeded its budget`);
	}
	let frontierOrdinals: number[];
	let championOrdinal: number;
	if (input.arm.arm === "full-control") {
		const oracle = assessFullArm({ preregistration: input.preregistration, allocations: armAllocations });
		frontierOrdinals = oracle.frontierOrdinals;
		championOrdinal = oracle.championOrdinal;
	} else {
		if (!selectionSeal || !selectionRemoteLock || selectedOrdinals.length !== 2 || selectionInputs.length !== 4) {
			throw new Error("Resource-screen cascade arm lacks its fresh selection seal");
		}
		const selectedPoints = buildFullCandidatePoints({
			preregistration: input.preregistration,
			allocations: armAllocations,
			candidateOrdinals: selectedOrdinals,
		});
		frontierOrdinals = compilerGymProxyCascadeParetoFrontierOrdinals(selectedPoints);
		const champion = selectedPoints
			.filter((candidate) => frontierOrdinals.includes(candidate.ordinal))
			.sort(compareChampion)[0];
		if (!champion) throw new Error("Resource-screen cascade has no measured selected champion");
		championOrdinal = champion.ordinal;
	}
	return {
		blockOrdinal: input.block.blockOrdinal,
		arm: input.arm.arm,
		armOrderPosition: input.arm.armOrderPosition,
		allocationOrdinals: armAllocations.map((allocation) => allocation.allocation.globalAllocationOrdinal),
		interval: {
			startedMonotonicMicros,
			feedbackReadyMonotonicMicros,
			feedbackReadyWallMicros,
		},
		stepCpuSeconds: stepCpuSeconds(armAllocations),
		maximumObservedEvaluatorConcurrency: input.concurrency.maximum,
		selectionInputs,
		selectedOrdinals,
		frontierOrdinals,
		championOrdinal,
		selectionSeal,
		selectionRemoteLock,
	};
}

export async function runCompilerGymProxyCascadeResourceScreen(
	rawInput: CompilerGymProxyCascadeResourceRunnerInput,
	dependencies: CompilerGymProxyCascadeResourceRunnerDependencies = {},
): Promise<CompilerGymProxyCascadeResourceRunnerResult> {
	const snapshottedDependencies = snapshotRunnerDependencies(dependencies);
	validateDependencyBoundary(snapshottedDependencies);
	const input: CompilerGymProxyCascadeResourceRunnerInput = {
		repoRoot: resolve(rawInput.repoRoot),
		preregistrationPath: resolve(rawInput.preregistrationPath),
		outputDir: resolve(rawInput.outputDir),
		signal: rawInput.signal,
	};
	const signal = input.signal ?? new AbortController().signal;
	const reconstruct =
		snapshottedDependencies.reconstructPreregistration ?? reconstructCompilerGymProxyCascadeResourcePreregistration;
	const beforeRuntimeNow = snapshottedDependencies.now ?? (() => new Date());

	// Close every local scientific input before consuming the cross-worktree attempt identity.
	const closure = await reconstruct(input);
	validatePreregisteredRunnerContract(closure, input);
	await assertOutputDirectoryAbsent(input.outputDir);
	const startedAt = beforeRuntimeNow().toISOString();
	const localAttemptLock = await writeLocalSeal(
		closure.preregistration.localAttemptLock.path,
		"attempt",
		localSealClaims({
			preregistration: closure.preregistration,
			preregistrationSha256: closure.preregistrationSha256,
			outputDir: input.outputDir,
			attemptedAt: startedAt,
		}),
	);

	// Production network dependencies do not exist until the shared wx/fsync/readback gate has passed.
	const runtime = resolveRuntimeDependencies(input, snapshottedDependencies);
	await mkdir(dirname(input.outputDir), { recursive: true, mode: 0o700 });
	await mkdir(input.outputDir, { recursive: false, mode: 0o700 });
	const ledgerPath = resolve(input.outputDir, "evidence.jsonl");
	const ledger = await EvidenceLedger.open(ledgerPath);
	if (ledger.getEvents().length !== 0) throw new Error("Resource-screen evidence ledger must start empty");
	await ledger.append(
		"run_manifest",
		{
			type: "proxy_cascade_resource_start",
			protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
			runtimeMode: runtime.runtimeMode,
			preregistrationSha256: closure.preregistrationSha256,
			scientificIdentitySha256: closure.preregistration.scientificIdentitySha256,
			localAttemptLock,
			blockPlan: closure.preregistration.blockPlan,
			isolation: closure.preregistration.isolation,
			startedAt,
		},
		startedAt,
	);

	const preregistration = closure.preregistration;
	const completed: CompilerGymProxyCascadeResourceAllocationEvidence[] = [];
	const failed: CompilerGymProxyCascadeResourceFailedAllocationEvidence[] = [];
	const uniqueness: AllocationUniqueness = {
		slurmIds: new Set<string>(),
		transientCaches: new Set<string>(),
		jobNames: new Set<string>(),
	};
	const localSeals: CompilerGymProxyCascadeResourceLocalSealEvidence[] = [];
	const remoteLocks: CompilerGymProxyCascadeResourceRemoteLockEvidence[] = [];
	const blocks: CompilerGymProxyCascadeResourceBlockEvidence[] = [];
	let globalPreparation: CompilerGymCanonicalOneTaskPreparationEvidence | null = null;
	let preflight: CompilerGymPaidLiveEnvironmentGateEvidence | null = null;
	let postflight: CompilerGymPaidLiveEnvironmentGateEvidence | null = null;
	let gate: CompilerGymProxyCascadeResourceGateResult | null = null;
	let maximumObservedEvaluatorConcurrency = 0;
	let failure: string | null = null;
	let disposition: CompilerGymProxyCascadeResourceDisposition =
		"resource-screen-apparatus-invalid-no-scientific-inference";
	let terminalAccounting = accountingSummary([], preregistration);
	let currentBoundary = "global-lock";

	try {
		const globalLock = await createRemoteLock({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			kind: "global",
			path: preregistration.remoteLocks.globalPath,
			claims: {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
				kind: "global",
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				preregistrationSha256: closure.preregistrationSha256,
				localAttemptLockSha256: localAttemptLock.contentsSha256,
				blockPlanSha256: sha256Json(preregistration.blockPlan),
				candidateBundleSha256: preregistration.candidateBundleSha256,
				implementationBundleSha256: preregistration.implementationBundleSha256,
				modelCalls: 0,
				providerDispatches: 0,
				toolCalls: 0,
				measurementReuse: false,
				createdAt: runtime.now().toISOString(),
			},
			ensureRoot: true,
			signal,
		});
		remoteLocks.push(globalLock);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_resource_remote_lock", ...globalLock },
			runtime.now().toISOString(),
		);

		currentBoundary = "global-source-preparation";
		globalPreparation = await runtime.evaluator.prepareCanonicalOneTask(signal);
		validateGlobalPreparation(globalPreparation, preregistration);
		preflight = await runtime.environmentGate();
		if (!preflight.pass) throw new Error("Resource-screen global prewarm environment gate failed");
		await ledger.append(
			"run_manifest",
			{
				type: "proxy_cascade_resource_global_preparation",
				protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
				preparation: globalPreparation,
				environmentGate: preflight,
				candidateBenchmarkEvaluations: 0,
			},
			runtime.now().toISOString(),
		);

		for (const block of preregistration.blockPlan.blocks) {
			currentBoundary = `block-${block.blockOrdinal}-start`;
			const armEvidence: CompilerGymProxyCascadeResourceArmEvidence[] = [];
			await ledger.append(
				"run_manifest",
				{
					type: "proxy_cascade_resource_block_boundary",
					boundary: "start",
					blockOrdinal: block.blockOrdinal,
					armOrder: block.armOrder,
				},
				runtime.now().toISOString(),
			);

			for (const arm of block.arms) {
				currentBoundary = `block-${block.blockOrdinal}-${arm.arm}-preflight`;
				const sourceReadback = await verifyRemoteEvaluatorSources({
					remoteFileSystem: runtime.remoteFileSystem,
					preregistration,
					signal,
				});
				const environmentGate = await runtime.environmentGate();
				if (!environmentGate.pass) throw new Error("Resource-screen pre-arm environment gate failed");
				verifyEnvironmentEquivalent(preflight, environmentGate);
				await ledger.append(
					"run_manifest",
					{
						type: "proxy_cascade_resource_pre_arm_gate",
						blockOrdinal: block.blockOrdinal,
						arm: arm.arm,
						armOrderPosition: arm.armOrderPosition,
						sourceReadback,
						environmentGate,
						timedIntervalStarted: false,
					},
					runtime.now().toISOString(),
				);

				currentBoundary = `block-${block.blockOrdinal}-${arm.arm}-timed`;
				const concurrency: ConcurrencyTracker = { active: 0, maximum: 0 };
				const draft = await runArm({
					preregistration,
					block,
					arm,
					selectionSealPath:
						arm.arm === "proxy-cascade" ? selectionSealPath(preregistration, block.blockOrdinal) : null,
					selectionRemoteLockPath:
						arm.arm === "proxy-cascade" ? selectionRemoteLockPath(preregistration, block.blockOrdinal) : null,
					preregistrationSha256: closure.preregistrationSha256,
					remoteFileSystem: runtime.remoteFileSystem,
					remoteLocks,
					localSeals,
					evaluator: runtime.evaluator,
					ledger,
					uniqueness,
					completed,
					failed,
					concurrency,
					now: runtime.now,
					monotonicNowMicros: runtime.monotonicNowMicros,
					signal,
				});
				if (concurrency.active !== 0 || concurrency.maximum > 2) {
					throw new Error("Resource-screen evaluator concurrency tracker drifted");
				}
				maximumObservedEvaluatorConcurrency = Math.max(maximumObservedEvaluatorConcurrency, concurrency.maximum);
				currentBoundary = `block-${block.blockOrdinal}-${arm.arm}-completion-seal`;
				const armAllocations = sortedAllocations(completed).filter(
					(allocation) =>
						allocation.allocation.blockOrdinal === block.blockOrdinal && allocation.allocation.arm === arm.arm,
				);
				const armSealValue = {
					schemaVersion: 1,
					protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
					kind: "arm",
					scientificIdentitySha256: preregistration.scientificIdentitySha256,
					preregistrationSha256: closure.preregistrationSha256,
					blockOrdinal: block.blockOrdinal,
					arm: arm.arm,
					armOrderPosition: arm.armOrderPosition,
					interval: draft.interval,
					sourceReadback,
					environmentGate,
					selectionSealSha256: draft.selectionSeal?.contentsSha256 ?? null,
					selectionRemoteLockSha256: draft.selectionRemoteLock?.contentsSha256 ?? null,
					selectionInputs: draft.selectionInputs,
					selectedOrdinals: draft.selectedOrdinals,
					frontierOrdinals: draft.frontierOrdinals,
					championOrdinal: draft.championOrdinal,
					stepCpuSeconds: draft.stepCpuSeconds,
					maximumObservedEvaluatorConcurrency: concurrency.maximum,
					allocations: armAllocations.map(scientificEvidence),
				};
				const localArmSeal = await writeLocalSeal(
					armSealPath(preregistration, block.blockOrdinal, arm.arm),
					"arm",
					armSealValue,
				);
				localSeals.push(localArmSeal);
				await ledger.append(
					"run_manifest",
					{ type: "proxy_cascade_resource_local_seal", ...localArmSeal },
					runtime.now().toISOString(),
				);
				await verifyLocalSeals(draft.selectionSeal ? [draft.selectionSeal, localArmSeal] : [localArmSeal]);
				const priorRemoteLock = remoteLocks.at(-1);
				if (!priorRemoteLock) throw new Error("Resource-screen arm completion lacks a prior remote lock");
				const remoteArmLock = await createRemoteLock({
					remoteFileSystem: runtime.remoteFileSystem,
					preregistration,
					kind: "arm",
					path: armRemoteLockPath(preregistration, block.blockOrdinal, arm.arm),
					claims: {
						schemaVersion: 1,
						protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
						kind: "arm",
						scientificIdentitySha256: preregistration.scientificIdentitySha256,
						preregistrationSha256: closure.preregistrationSha256,
						blockOrdinal: block.blockOrdinal,
						arm: arm.arm,
						priorRemoteLockSha256: priorRemoteLock.contentsSha256,
						armSealSha256: localArmSeal.contentsSha256,
						createdAt: runtime.now().toISOString(),
					},
					ensureRoot: false,
					signal,
				});
				remoteLocks.push(remoteArmLock);
				await ledger.append(
					"run_manifest",
					{ type: "proxy_cascade_resource_remote_lock", ...remoteArmLock },
					runtime.now().toISOString(),
				);
				armEvidence.push({
					blockOrdinal: draft.blockOrdinal,
					arm: draft.arm,
					armOrderPosition: draft.armOrderPosition,
					allocationOrdinals: draft.allocationOrdinals,
					interval: draft.interval,
					stepCpuSeconds: draft.stepCpuSeconds,
					maximumObservedEvaluatorConcurrency: concurrency.maximum,
					environmentGate: structuredClone(environmentGate),
					sourceReadback,
					selectionInputs: draft.selectionInputs,
					selectedOrdinals: draft.selectedOrdinals,
					frontierOrdinals: draft.frontierOrdinals,
					championOrdinal: draft.championOrdinal,
					localSeal: localArmSeal,
					remoteLock: remoteArmLock,
				});
			}

			currentBoundary = `block-${block.blockOrdinal}-completion`;
			const observation = buildBlockObservation({
				preregistration,
				block,
				arms: armEvidence,
				allocations: completed,
			});
			const blockSealValue = {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
				kind: "block",
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				preregistrationSha256: closure.preregistrationSha256,
				blockOrdinal: block.blockOrdinal,
				armOrder: block.armOrder,
				armSealSha256s: armEvidence.map((arm) => arm.localSeal.contentsSha256),
				armRemoteLockSha256s: armEvidence.map((arm) => arm.remoteLock.contentsSha256),
				observation,
			};
			const localBlockSeal = await writeLocalSeal(
				blockSealPath(preregistration, block.blockOrdinal),
				"block",
				blockSealValue,
			);
			localSeals.push(localBlockSeal);
			await ledger.append(
				"run_manifest",
				{ type: "proxy_cascade_resource_local_seal", ...localBlockSeal },
				runtime.now().toISOString(),
			);
			const priorRemoteLock = remoteLocks.at(-1);
			if (!priorRemoteLock) throw new Error("Resource-screen block completion lacks a prior remote lock");
			const remoteBlockLock = await createRemoteLock({
				remoteFileSystem: runtime.remoteFileSystem,
				preregistration,
				kind: "block",
				path: blockRemoteLockPath(preregistration, block.blockOrdinal),
				claims: {
					schemaVersion: 1,
					protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
					kind: "block",
					scientificIdentitySha256: preregistration.scientificIdentitySha256,
					preregistrationSha256: closure.preregistrationSha256,
					blockOrdinal: block.blockOrdinal,
					priorRemoteLockSha256: priorRemoteLock.contentsSha256,
					blockSealSha256: localBlockSeal.contentsSha256,
					createdAt: runtime.now().toISOString(),
				},
				ensureRoot: false,
				signal,
			});
			remoteLocks.push(remoteBlockLock);
			await ledger.append(
				"run_manifest",
				{ type: "proxy_cascade_resource_remote_lock", ...remoteBlockLock },
				runtime.now().toISOString(),
			);
			blocks.push({
				blockOrdinal: block.blockOrdinal,
				armOrder: block.armOrder,
				arms: armEvidence,
				observation,
				localSeal: localBlockSeal,
				remoteLock: remoteBlockLock,
			});
			await ledger.append(
				"run_manifest",
				{
					type: "proxy_cascade_resource_block_boundary",
					boundary: "complete",
					blockOrdinal: block.blockOrdinal,
					armOrder: block.armOrder,
				},
				runtime.now().toISOString(),
			);
		}

		currentBoundary = "postflight";
		postflight = await runtime.environmentGate();
		if (!postflight.pass || preflight === null) throw new Error("Resource-screen postflight environment gate failed");
		verifyEnvironmentEquivalent(preflight, postflight);
		const postflightSource = await verifyRemoteEvaluatorSources({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			signal,
		});
		await ledger.append(
			"run_manifest",
			{
				type: "proxy_cascade_resource_postflight",
				environmentGate: postflight,
				sourceReadback: postflightSource,
			},
			runtime.now().toISOString(),
		);
		const postflightClosure = await reconstruct(input);
		if (
			postflightClosure.preregistrationContents !== closure.preregistrationContents ||
			postflightClosure.preregistrationSha256 !== closure.preregistrationSha256 ||
			!canonicalEqual(postflightClosure.preregistration, preregistration)
		) {
			throw new Error(
				"Resource-screen preregistration, source, candidate, or wiring closure changed during execution",
			);
		}
		await verifyRemoteLocks(runtime.remoteFileSystem, remoteLocks, signal);
		await verifyLocalSeals([localAttemptLock, ...localSeals]);
		terminalAccounting = accountingSummary(sortedAllocations(completed), preregistration);
		if (
			terminalAccounting.actualFreshOneTaskAllocations !== 28 ||
			terminalAccounting.uniqueSlurmIds !== 28 ||
			terminalAccounting.uniqueTransientCaches !== 28 ||
			terminalAccounting.uniqueJobNames !== 28 ||
			maximumObservedEvaluatorConcurrency !== 2 ||
			failed.length !== 0 ||
			blocks.length !== 2 ||
			localSeals.length !== 8 ||
			remoteLocks.length !== 9
		) {
			throw new Error("Resource-screen terminal exact-count, uniqueness, concurrency, or seal gate drifted");
		}
		const timedScheduleMicros = blocks.reduce(
			(sum, block) => sum + block.arms.reduce((armSum, arm) => armSum + arm.interval.feedbackReadyWallMicros, 0),
			0,
		);
		if (timedScheduleMicros > preregistration.budgets.maximumTimedArmScheduleMinutes * 60 * 1_000_000) {
			throw new Error("Resource-screen aggregate timed schedule exceeded its preregistered budget");
		}
		gate = evaluateCompilerGymProxyCascadeResourceGate(blocks.map((block) => block.observation));
		disposition = gate.passed
			? "model-free-resource-screen-qualified-for-one-paid-pilot-consideration-only"
			: "resource-screen-valid-negative-no-paid-treatment";

		currentBoundary = "terminal-lock";
		const priorRemoteLock = remoteLocks.at(-1);
		if (!priorRemoteLock) throw new Error("Resource-screen terminal lock lacks a prior block lock");
		const terminalLock = await createRemoteLock({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			kind: "terminal",
			path: preregistration.remoteLocks.terminalPath,
			claims: {
				schemaVersion: 1,
				protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
				kind: "terminal",
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				preregistrationSha256: closure.preregistrationSha256,
				priorRemoteLockSha256: priorRemoteLock.contentsSha256,
				gateSha256: sha256Json(gate),
				disposition,
				createdAt: runtime.now().toISOString(),
			},
			ensureRoot: false,
			signal,
		});
		remoteLocks.push(terminalLock);
		await ledger.append(
			"run_manifest",
			{ type: "proxy_cascade_resource_remote_lock", ...terminalLock },
			runtime.now().toISOString(),
		);
		await verifyRemoteLocks(runtime.remoteFileSystem, remoteLocks, signal);
		await verifyLocalSeals([localAttemptLock, ...localSeals]);
		await ledger.append(
			"claim",
			{
				type: "proxy_cascade_resource_assessment",
				classification: "zero-model-counterbalanced-resource-screen-only",
				disposition,
				gate,
				accounting: terminalAccounting,
				maximumObservedEvaluatorConcurrency,
				modelOrAgentPolicyEvidenceAllowed: false,
				providerOrPaidExposureAllowed: false,
				generalLatencyClaimAllowed: false,
				gpuOrNanoGptTransferAllowed: false,
				defaultPromotionAllowed: false,
				qualificationForOnePaidPilotConsiderationOnly: gate.passed,
			},
			runtime.now().toISOString(),
		);
	} catch (error) {
		failure = errorText(error);
		disposition = "resource-screen-apparatus-invalid-no-scientific-inference";
		terminalAccounting = accountingSummary(sortedAllocations(completed), preregistration, false);
		await ledger.append(
			"run_manifest",
			{
				type: "proxy_cascade_resource_terminal_failure",
				protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
				disposition,
				failedBoundary: currentBoundary,
				failure,
				completedAllocationOrdinals: sortedAllocations(completed).map(
					(allocation) => allocation.allocation.globalAllocationOrdinal,
				),
				failedAllocationOrdinals: failed
					.map((item) => item.allocation.globalAllocationOrdinal)
					.sort((left, right) => left - right),
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
			type: "proxy_cascade_resource_end",
			protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
			disposition,
			failure,
			completedAllocationCount: completed.length,
			failedAllocationCount: failed.length,
			modelCalls: 0,
			providerDispatches: 0,
			toolCalls: 0,
			compactions: 0,
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
	if (!ledgerTerminalHash) throw new Error("Resource-screen ledger lacks a terminal hash");
	const result: CompilerGymProxyCascadeResourceRunnerResult = {
		protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUN_RESULT_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
		runtimeMode: runtime.runtimeMode,
		ok: disposition !== "resource-screen-apparatus-invalid-no-scientific-inference",
		liveScientificEvidenceEligible:
			runtime.runtimeMode === "production-defaults-no-dependency-injection" &&
			disposition !== "resource-screen-apparatus-invalid-no-scientific-inference",
		classification: "zero-model-counterbalanced-resource-screen-only",
		disposition,
		failure,
		preregistrationSha256: closure.preregistrationSha256,
		scientificIdentitySha256: preregistration.scientificIdentitySha256,
		localAttemptLock,
		localSeals: structuredClone(localSeals),
		remoteLocks: structuredClone(remoteLocks),
		globalPreparation: globalPreparation ? structuredClone(globalPreparation) : null,
		preflight: preflight ? structuredClone(preflight) : null,
		postflight: postflight ? structuredClone(postflight) : null,
		allocations: sortedAllocations(completed).map((item) => structuredClone(item)),
		failedAllocations: structuredClone(failed),
		blocks: structuredClone(blocks),
		gate: gate ? structuredClone(gate) : null,
		accounting: terminalAccounting,
		maximumObservedEvaluatorConcurrency,
		isolation: {
			modelCalls: 0,
			providerDispatches: 0,
			toolCalls: 0,
			compactions: 0,
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

export class CompilerGymProxyCascadeResourceRunner {
	constructor(
		private readonly input: CompilerGymProxyCascadeResourceRunnerInput,
		private readonly dependencies: CompilerGymProxyCascadeResourceRunnerDependencies = {},
	) {}

	run(): Promise<CompilerGymProxyCascadeResourceRunnerResult> {
		return runCompilerGymProxyCascadeResourceScreen(this.input, this.dependencies);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 5 || args[0] !== "--dispatch" || args[1] !== "--preregistration" || args[3] !== "--output-dir") {
		throw new Error(
			"Usage: compiler-gym-proxy-cascade-resource-runner --dispatch --preregistration <path> --output-dir <path>",
		);
	}
	const repoRoot = resolve(import.meta.dirname, "../../..");
	const result = await runCompilerGymProxyCascadeResourceScreen({
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

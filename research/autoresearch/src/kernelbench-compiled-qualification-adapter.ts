import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256Json, sha256Text } from "./canonical-json.js";
import {
	KERNELBENCH_CANCEL_REMOTE,
	KERNELBENCH_ENSURE_SUBMITTED_REMOTE,
	KERNELBENCH_VERIFIED_COMMIT,
	KernelBenchTransientTransportError,
} from "./kernelbench-qualification-adapter.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	TaskMeasurement,
} from "./types.js";

export const KERNELBENCH_COMPILED_QUALIFICATION_EPOCH_PREFIX = "kernelbench-verified-compiled-qualification-v1:";
export const KERNELBENCH_COMPILED_QUALIFICATION_TASKS = ["level2/2"] as const;
export const KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT = "compiled-qualification";
export const KERNELBENCH_COMPILED_TASK_PATH =
	"KernelBench/level2/2_ConvTranspose2d_BiasAdd_Clamp_Scaling_Clamp_Divide.py";
export const KERNELBENCH_COMPILED_HIDDEN_PATH = "hidden_tests/level2/2_hidden.py";
export const KERNELBENCH_COMPILED_TASK_SHA256 = "31f49a84239cb24383e84ea78c778d9fc047455a12df3e2eb269ce6deedaf808";
export const KERNELBENCH_COMPILED_HIDDEN_SHA256 = "5a951a50e3d2e23f3a977005e6508ae3f37974e1bf08b2fdb0f004619f46e6f0";
export const KERNELBENCH_COMPILED_ENVIRONMENT_SHA256 =
	"3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b";
export const KERNELBENCH_COMPILED_POSITIVE_SHA256 = "6ab0b1895809346077b6b5c88ccd0e4953c00791164336de886e0533c0028af3";
export const KERNELBENCH_COMPILED_WRONG_SHA256 = "fe5cbcc2a924f2819f1df65b05945881e9d55aa1e78722e616b74d07868d6c33";

const HANDLE_PREFIX = "kernelbench-compiled-qualification-v1:";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const JOB_ID_PATTERN = /^job_[a-f0-9]{24}$/;
const MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
const EXPECTED_PYTHON = "3.12.3";
const EXPECTED_PIP = "25.2";
const EXPECTED_TORCH = "2.11.0";
const EXPECTED_TORCH_CUDA = "12.8";
const EXPECTED_NUMPY = "2.5.2";
const PRECISION_SPEC = {
	dtype: "float32",
	matmulPrecision: "high",
	matmulAllowTf32: true,
	cudnnAllowTf32: true,
	atol: 1e-3,
	rtol: 1e-3,
} as const;
const TIMING_SPEC = {
	warmups: 3,
	trials: 10,
	unit: "milliseconds",
	coldFirstInvocationSeparate: true,
} as const;
const COMPILATION_SPEC = { backend: "inductor", fullgraph: true, dynamic: false } as const;
const ACCEPTED_METRIC_KEYS = [
	"qualified",
	"hiddenConfigsPassed",
	"wrongCandidatesRejected",
	"coldCompileMs",
	"firstInvocationMeanMs",
	"referenceMeanMs",
	"positiveMeanMs",
	"speedupGeomean",
	"fastAtOne",
] as const;

export interface KernelBenchCompiledQualificationConfig {
	host: string;
	partition: string;
	constraint: string;
	remoteRoot: string;
	pollIntervalMs: number;
	requestTimeoutMs: number;
	dispatchVisibilityGraceMs: number;
}

export const DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG: KernelBenchCompiledQualificationConfig = {
	host: "farmshare",
	partition: "gpu",
	constraint: "GPU_SKU:L40S",
	remoteRoot: "/scratch/users/duynguy/prime-autoresearch/kernelbench-compiled",
	pollIntervalMs: 10_000,
	requestTimeoutMs: 172_800_000,
	dispatchVisibilityGraceMs: 120_000,
};

interface ProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface KernelBenchCompiledRemoteAssets {
	requestJson: string;
	evaluatorSource: string;
	jobScript: string;
}

export interface KernelBenchCompiledBootstrapAssets {
	bootstrapScript: string;
	environmentSpec: string;
}

export interface KernelBenchCompiledEnvironmentEvidence {
	environmentManifest: string;
	pipFreeze: string;
	environmentSeal: string;
	environmentManifestSha256: string;
	pipFreezeSha256: string;
	environmentSealSha256: string;
}

export interface KernelBenchCompiledQualificationContract {
	verifierEpoch: string;
	contractDigest: string;
	verifierManifest: Record<string, unknown>;
	environmentEvidence: KernelBenchCompiledEnvironmentEvidence;
}

export interface KernelBenchCompiledQualificationExpectation {
	contract: KernelBenchCompiledQualificationContract;
	requestSha256: string;
	jobId: string;
	slurmJobId: string;
}

export type KernelBenchCompiledRemotePoll =
	| { kind: "pending"; schedulerState: string }
	| { kind: "result"; rawResult: string; log: string }
	| { kind: "failed"; reason: string; log: string };

export interface KernelBenchCompiledQualificationTransport {
	bootstrap(remoteRoot: string, assets: KernelBenchCompiledBootstrapAssets, signal: AbortSignal): Promise<void>;
	readiness(
		remoteRoot: string,
		checkoutCommit: string,
		environmentSpecSha256: string,
		signal: AbortSignal,
	): Promise<string>;
	prepare(remoteJobDir: string, assets: KernelBenchCompiledRemoteAssets, signal: AbortSignal): Promise<void>;
	ensureSubmitted(remoteJobDir: string, jobName: string, signal: AbortSignal): Promise<{ slurmJobId: string }>;
	poll(remoteJobDir: string, signal: AbortSignal): Promise<KernelBenchCompiledRemotePoll>;
	cancelAndVerify(remoteJobDir: string, slurmJobId: string, signal: AbortSignal): Promise<string>;
}

interface PreparedQualification {
	remoteJobDir: string;
	handle: string;
	jobName: string;
	evaluatorSha256: string;
	environmentSpecSha256: string;
	positiveCandidateSource: string;
	wrongCandidateSource: string;
	requestSha256: string;
	contract: KernelBenchCompiledQualificationContract;
	assets: KernelBenchCompiledRemoteAssets;
}

export interface ParsedKernelBenchCompiledQualification {
	outcome: EvaluationOutcome;
	ok: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`Expected object at ${path}`);
	return value;
}

function expectString(value: unknown, path: string): string {
	if (typeof value !== "string") throw new Error(`Expected string at ${path}`);
	return value;
}

function expectBoolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new Error(`Expected boolean at ${path}`);
	return value;
}

function expectNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected finite number at ${path}`);
	return value;
}

function expectNullableString(value: unknown, path: string): string | null {
	if (value === null) return null;
	return expectString(value, path);
}

function expectStringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`Expected string array at ${path}`);
	}
	return [...value];
}

function expectExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = new Set(keys);
	const missing = keys.filter((key) => !(key in record));
	const extra = Object.keys(record).filter((key) => !expected.has(key));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(`Keys mismatch at ${path}: missing=${missing.join(",")} extra=${extra.join(",")}`);
	}
}

function expectSha256(value: unknown, path: string): string {
	const digest = expectString(value, path);
	if (!HASH_PATTERN.test(digest)) throw new Error(`Expected SHA-256 digest at ${path}`);
	return digest;
}

function expectIsoTimestamp(value: unknown, path: string): string {
	const timestamp = expectString(value, path);
	if (!timestamp.endsWith("Z") || !Number.isFinite(Date.parse(timestamp))) {
		throw new Error(`Expected UTC ISO timestamp at ${path}`);
	}
	return timestamp;
}

function expectPositive(value: unknown, path: string): number {
	const number = expectNumber(value, path);
	if (number <= 0) throw new Error(`Expected positive number at ${path}`);
	return number;
}

function expectPositiveSamples(value: unknown, path: string): number[] {
	if (!Array.isArray(value) || value.length !== 10) throw new Error(`Expected ten samples at ${path}`);
	return value.map((sample, index) => expectPositive(sample, `${path}[${index}]`));
}

function arithmeticMean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function geometricMean(values: readonly number[]): number {
	return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function expectClose(actual: number, expected: number, path: string): void {
	const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
	if (Math.abs(actual - expected) > tolerance) {
		throw new Error(`Inconsistent aggregate at ${path}: expected ${expected}, got ${actual}`);
	}
}

function numberRecord(value: unknown, path: string): Record<string, number> {
	const record = expectRecord(value, path);
	const result: Record<string, number> = {};
	for (const [key, item] of Object.entries(record)) result[key] = expectNumber(item, `${path}.${key}`);
	return result;
}

function parseEnvironmentEvidence(
	readiness: Record<string, unknown>,
	environmentSpecSha256: string,
): KernelBenchCompiledEnvironmentEvidence {
	const environmentManifest = expectString(readiness.environmentManifest, "readiness.environmentManifest");
	const pipFreeze = expectString(readiness.pipFreeze, "readiness.pipFreeze");
	const environmentSeal = expectString(readiness.environmentSeal, "readiness.environmentSeal");
	const environmentManifestSha256 = sha256Text(environmentManifest);
	const pipFreezeSha256 = sha256Text(pipFreeze);
	const environmentSealSha256 = sha256Text(environmentSeal);
	const manifest = expectRecord(JSON.parse(environmentManifest), "readiness.environmentManifestJson");
	expectExactKeys(
		manifest,
		[
			"schemaVersion",
			"environmentSpecSha256",
			"kernelBenchVerifiedCommit",
			"numpy",
			"pip",
			"python",
			"torch",
			"torchCuda",
		],
		"readiness.environmentManifestJson",
	);
	if (
		expectNumber(manifest.schemaVersion, "readiness.environmentManifestJson.schemaVersion") !== 1 ||
		expectString(manifest.environmentSpecSha256, "readiness.environmentManifestJson.environmentSpecSha256") !==
			environmentSpecSha256 ||
		expectString(
			manifest.kernelBenchVerifiedCommit,
			"readiness.environmentManifestJson.kernelBenchVerifiedCommit",
		) !== KERNELBENCH_VERIFIED_COMMIT ||
		expectString(manifest.python, "readiness.environmentManifestJson.python") !== EXPECTED_PYTHON ||
		expectString(manifest.pip, "readiness.environmentManifestJson.pip") !== EXPECTED_PIP ||
		!expectString(manifest.torch, "readiness.environmentManifestJson.torch").startsWith(EXPECTED_TORCH) ||
		expectString(manifest.torchCuda, "readiness.environmentManifestJson.torchCuda") !== EXPECTED_TORCH_CUDA ||
		expectString(manifest.numpy, "readiness.environmentManifestJson.numpy") !== EXPECTED_NUMPY
	) {
		throw new Error("KernelBench compiled environment manifest is not the pinned runtime");
	}
	const seal = expectRecord(JSON.parse(environmentSeal), "readiness.environmentSealJson");
	expectExactKeys(
		seal,
		["schemaVersion", "environmentSpecSha256", "environmentManifestSha256", "pipFreezeSha256"],
		"readiness.environmentSealJson",
	);
	if (
		expectNumber(seal.schemaVersion, "readiness.environmentSealJson.schemaVersion") !== 1 ||
		expectString(seal.environmentSpecSha256, "readiness.environmentSealJson.environmentSpecSha256") !==
			environmentSpecSha256 ||
		expectSha256(seal.environmentManifestSha256, "readiness.environmentSealJson.environmentManifestSha256") !==
			environmentManifestSha256 ||
		expectSha256(seal.pipFreezeSha256, "readiness.environmentSealJson.pipFreezeSha256") !== pipFreezeSha256
	) {
		throw new Error("KernelBench compiled environment seal does not bind the exact evidence");
	}
	const freezeLines = pipFreeze.split("\n");
	if (
		!freezeLines.includes(`pip==${EXPECTED_PIP}`) ||
		!freezeLines.includes(`numpy==${EXPECTED_NUMPY}`) ||
		!freezeLines.some((line) => line.startsWith(`torch==${EXPECTED_TORCH}`))
	) {
		throw new Error("KernelBench compiled pip freeze does not contain the pinned dependencies");
	}
	return {
		environmentManifest,
		pipFreeze,
		environmentSeal,
		environmentManifestSha256,
		pipFreezeSha256,
		environmentSealSha256,
	};
}

export function parseKernelBenchCompiledQualificationReadiness(
	raw: string,
	evaluatorSha256: string,
	environmentSpecSha256: string,
): KernelBenchCompiledQualificationContract {
	if (expectSha256(evaluatorSha256, "readiness.evaluatorSha256") === "") {
		throw new Error("Unreachable empty evaluator digest");
	}
	if (environmentSpecSha256 !== KERNELBENCH_COMPILED_ENVIRONMENT_SHA256) {
		throw new Error("Compiled environment lock is not the exact allowlisted lock");
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(`KernelBench compiled readiness is not JSON: ${String(error)}`);
	}
	const readiness = expectRecord(value, "readiness");
	expectExactKeys(
		readiness,
		[
			"schemaVersion",
			"checkoutCommit",
			"environmentSpecSha256",
			"environmentManifest",
			"pipFreeze",
			"environmentSeal",
			"taskInput",
			"runtime",
		],
		"readiness",
	);
	if (expectNumber(readiness.schemaVersion, "readiness.schemaVersion") !== 1) {
		throw new Error("Unsupported KernelBench compiled readiness schema");
	}
	if (expectString(readiness.checkoutCommit, "readiness.checkoutCommit") !== KERNELBENCH_VERIFIED_COMMIT) {
		throw new Error("KernelBench compiled readiness checkout mismatch");
	}
	if (expectSha256(readiness.environmentSpecSha256, "readiness.environmentSpecSha256") !== environmentSpecSha256) {
		throw new Error("KernelBench compiled readiness environment mismatch");
	}
	const environmentEvidence = parseEnvironmentEvidence(readiness, environmentSpecSha256);
	const runtime = expectRecord(readiness.runtime, "readiness.runtime");
	expectExactKeys(
		runtime,
		["python", "pip", "torch", "torchCuda", "numpy", "hasTorchCompile", "hasInductor", "hasTriton"],
		"readiness.runtime",
	);
	if (
		expectString(runtime.python, "readiness.runtime.python") !== EXPECTED_PYTHON ||
		expectString(runtime.pip, "readiness.runtime.pip") !== EXPECTED_PIP ||
		!expectString(runtime.torch, "readiness.runtime.torch").startsWith(EXPECTED_TORCH) ||
		expectString(runtime.torchCuda, "readiness.runtime.torchCuda") !== EXPECTED_TORCH_CUDA ||
		expectString(runtime.numpy, "readiness.runtime.numpy") !== EXPECTED_NUMPY ||
		!expectBoolean(runtime.hasTorchCompile, "readiness.runtime.hasTorchCompile") ||
		!expectBoolean(runtime.hasInductor, "readiness.runtime.hasInductor") ||
		!expectBoolean(runtime.hasTriton, "readiness.runtime.hasTriton")
	) {
		throw new Error("KernelBench compiled evaluator prerequisites are not ready");
	}
	const taskInput = expectRecord(readiness.taskInput, "readiness.taskInput");
	expectExactKeys(taskInput, ["taskSha256", "hiddenTestSha256"], "readiness.taskInput");
	if (
		expectSha256(taskInput.taskSha256, "readiness.taskInput.taskSha256") !== KERNELBENCH_COMPILED_TASK_SHA256 ||
		expectSha256(taskInput.hiddenTestSha256, "readiness.taskInput.hiddenTestSha256") !==
			KERNELBENCH_COMPILED_HIDDEN_SHA256
	) {
		throw new Error("KernelBench compiled task or hidden fixture mismatch");
	}
	const verifierManifest: Record<string, unknown> = {
		schemaVersion: 1,
		qualificationLane: "compiled-level2-2",
		checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
		evaluatorSha256,
		environmentSpecSha256,
		environmentManifestSha256: environmentEvidence.environmentManifestSha256,
		pipFreezeSha256: environmentEvidence.pipFreezeSha256,
		environmentSealSha256: environmentEvidence.environmentSealSha256,
		taskSha256: KERNELBENCH_COMPILED_TASK_SHA256,
		hiddenTestSha256: KERNELBENCH_COMPILED_HIDDEN_SHA256,
		positiveCandidateSha256: KERNELBENCH_COMPILED_POSITIVE_SHA256,
		wrongCandidateSha256: KERNELBENCH_COMPILED_WRONG_SHA256,
		precision: PRECISION_SPEC,
		timing: TIMING_SPEC,
		compilation: COMPILATION_SPEC,
	};
	const contractDigest = sha256Json(verifierManifest);
	return {
		verifierEpoch: `${KERNELBENCH_COMPILED_QUALIFICATION_EPOCH_PREFIX}${contractDigest}`,
		contractDigest,
		verifierManifest,
		environmentEvidence,
	};
}

export function kernelBenchCompiledQualificationBoundaryConditions(
	contract: KernelBenchCompiledQualificationContract,
): readonly string[] {
	return [
		"FarmShare L40S",
		"FP32 with TF32 enabled",
		"compiled level2/2 qualification only",
		"correctness gates acceptance; speed is observational",
		`verifier-epoch:${contract.verifierEpoch}`,
		`verifier-contract-sha256:${contract.contractDigest}`,
	];
}

function parseHardware(value: unknown): Record<string, string> {
	const hardware = expectRecord(value, "result.hardware");
	expectExactKeys(
		hardware,
		[
			"cluster",
			"hostname",
			"gpuName",
			"gpuComputeCapability",
			"gpuTotalMemoryBytes",
			"torchVersion",
			"torchCudaVersion",
			"numpyVersion",
			"slurmJobId",
			"cudaVisibleDevices",
		],
		"result.hardware",
	);
	const gpuTotalMemoryBytes = expectNumber(hardware.gpuTotalMemoryBytes, "result.hardware.gpuTotalMemoryBytes");
	const result = {
		cluster: expectString(hardware.cluster, "result.hardware.cluster"),
		hostname: expectString(hardware.hostname, "result.hardware.hostname"),
		gpuName: expectString(hardware.gpuName, "result.hardware.gpuName"),
		gpuComputeCapability: expectString(hardware.gpuComputeCapability, "result.hardware.gpuComputeCapability"),
		gpuTotalMemoryBytes: String(gpuTotalMemoryBytes),
		torchVersion: expectString(hardware.torchVersion, "result.hardware.torchVersion"),
		torchCudaVersion: expectString(hardware.torchCudaVersion, "result.hardware.torchCudaVersion"),
		numpyVersion: expectString(hardware.numpyVersion, "result.hardware.numpyVersion"),
		slurmJobId: expectString(hardware.slurmJobId, "result.hardware.slurmJobId"),
		cudaVisibleDevices: expectString(hardware.cudaVisibleDevices, "result.hardware.cudaVisibleDevices"),
	};
	if (
		result.cluster !== "Stanford FarmShare" ||
		!result.hostname ||
		!result.gpuName.toLowerCase().includes("l40s") ||
		result.gpuComputeCapability !== "8.9" ||
		gpuTotalMemoryBytes < 40_000_000_000 ||
		!result.torchVersion.startsWith(EXPECTED_TORCH) ||
		result.torchCudaVersion !== EXPECTED_TORCH_CUDA ||
		result.numpyVersion !== EXPECTED_NUMPY ||
		!result.cudaVisibleDevices
	) {
		throw new Error("Compiled qualification hardware or runtime record mismatch");
	}
	return result;
}

function parseAcceptedTask(value: unknown): TaskMeasurement {
	const path = "result.tasks[0]";
	const task = expectRecord(value, path);
	expectExactKeys(
		task,
		[
			"benchmarkId",
			"status",
			"failureKind",
			"errors",
			"startedAt",
			"finishedAt",
			"taskPath",
			"hiddenTestPath",
			"taskSha256",
			"hiddenTestSha256",
			"hiddenConfigs",
			"metrics",
		],
		path,
	);
	if (
		expectString(task.benchmarkId, `${path}.benchmarkId`) !== KERNELBENCH_COMPILED_QUALIFICATION_TASKS[0] ||
		expectString(task.status, `${path}.status`) !== "accepted" ||
		task.failureKind !== null ||
		expectStringArray(task.errors, `${path}.errors`).length !== 0
	) {
		throw new Error("Compiled qualification accepted-task envelope mismatch");
	}
	const startedAt = expectIsoTimestamp(task.startedAt, `${path}.startedAt`);
	const finishedAt = expectIsoTimestamp(task.finishedAt, `${path}.finishedAt`);
	if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("Compiled task timestamps are out of order");
	if (
		expectString(task.taskPath, `${path}.taskPath`) !== KERNELBENCH_COMPILED_TASK_PATH ||
		expectString(task.hiddenTestPath, `${path}.hiddenTestPath`) !== KERNELBENCH_COMPILED_HIDDEN_PATH ||
		expectSha256(task.taskSha256, `${path}.taskSha256`) !== KERNELBENCH_COMPILED_TASK_SHA256 ||
		expectSha256(task.hiddenTestSha256, `${path}.hiddenTestSha256`) !== KERNELBENCH_COMPILED_HIDDEN_SHA256
	) {
		throw new Error("Compiled task path or hash mismatch");
	}
	if (!Array.isArray(task.hiddenConfigs) || task.hiddenConfigs.length !== 4) {
		throw new Error("Compiled qualification requires exactly four hidden configs");
	}
	const allReferenceSamples: number[] = [];
	const allPositiveSamples: number[] = [];
	const firstInvocations: number[] = [];
	const speedups: number[] = [];
	let runtimeMs = 0;
	for (let index = 0; index < task.hiddenConfigs.length; index++) {
		const configPath = `${path}.hiddenConfigs[${index}]`;
		const config = expectRecord(task.hiddenConfigs[index], configPath);
		expectExactKeys(
			config,
			[
				"index",
				"positivePassed",
				"wrongCandidateRejected",
				"positiveFirstInvocationMs",
				"referenceSamplesMs",
				"positiveSamplesMs",
				"speedup",
			],
			configPath,
		);
		if (expectNumber(config.index, `${configPath}.index`) !== index + 1) {
			throw new Error(`Unexpected hidden config index at ${configPath}`);
		}
		if (!expectBoolean(config.positivePassed, `${configPath}.positivePassed`)) {
			throw new Error(`Compiled positive candidate failed at ${configPath}`);
		}
		if (!expectBoolean(config.wrongCandidateRejected, `${configPath}.wrongCandidateRejected`)) {
			throw new Error(`Compiled wrong candidate was not rejected at ${configPath}`);
		}
		const firstInvocation = expectPositive(
			config.positiveFirstInvocationMs,
			`${configPath}.positiveFirstInvocationMs`,
		);
		const referenceSamples = expectPositiveSamples(config.referenceSamplesMs, `${configPath}.referenceSamplesMs`);
		const positiveSamples = expectPositiveSamples(config.positiveSamplesMs, `${configPath}.positiveSamplesMs`);
		const expectedSpeedup = arithmeticMean(referenceSamples) / arithmeticMean(positiveSamples);
		const speedup = expectPositive(config.speedup, `${configPath}.speedup`);
		expectClose(speedup, expectedSpeedup, `${configPath}.speedup`);
		firstInvocations.push(firstInvocation);
		allReferenceSamples.push(...referenceSamples);
		allPositiveSamples.push(...positiveSamples);
		speedups.push(expectedSpeedup);
		runtimeMs += [...referenceSamples, ...positiveSamples].reduce((sum, sample) => sum + sample, 0);
	}
	const metricsRecord = expectRecord(task.metrics, `${path}.metrics`);
	expectExactKeys(metricsRecord, ACCEPTED_METRIC_KEYS, `${path}.metrics`);
	const metrics = numberRecord(task.metrics, `${path}.metrics`);
	for (const [metric, expected] of [
		["qualified", 1],
		["hiddenConfigsPassed", 4],
		["wrongCandidatesRejected", 4],
	] as const) {
		if (metrics[metric] !== expected) throw new Error(`Invalid ${metric} at ${path}`);
	}
	expectClose(metrics.coldCompileMs, firstInvocations[0], `${path}.metrics.coldCompileMs`);
	expectClose(
		metrics.firstInvocationMeanMs,
		arithmeticMean(firstInvocations),
		`${path}.metrics.firstInvocationMeanMs`,
	);
	expectClose(metrics.referenceMeanMs, arithmeticMean(allReferenceSamples), `${path}.metrics.referenceMeanMs`);
	expectClose(metrics.positiveMeanMs, arithmeticMean(allPositiveSamples), `${path}.metrics.positiveMeanMs`);
	expectClose(metrics.speedupGeomean, geometricMean(speedups), `${path}.metrics.speedupGeomean`);
	if (metrics.fastAtOne !== (speedups.every((speedup) => speedup > 1) ? 1 : 0)) {
		throw new Error(`Invalid fastAtOne at ${path}`);
	}
	return {
		benchmarkId: KERNELBENCH_COMPILED_QUALIFICATION_TASKS[0],
		status: "accepted",
		metrics,
		verifier: {
			passed: true,
			checks: [
				"pinned level2/2 task and hidden-test hashes",
				"exact allowlisted positive and wrong candidate hashes",
				"positive correctness on all four hidden FP32 configurations",
				"wrong-candidate rejection on all four hidden configurations",
				"cold first invocation excluded from three warmups and ten preserved trials",
			],
			errors: [],
		},
		runtimeMs,
	};
}

export function parseKernelBenchCompiledQualificationResult(
	raw: string,
	expectation: KernelBenchCompiledQualificationExpectation,
): ParsedKernelBenchCompiledQualification {
	const { contract, requestSha256, jobId, slurmJobId } = expectation;
	const expectedManifest = expectRecord(contract.verifierManifest, "expectation.contract.verifierManifest");
	if (
		contract.contractDigest !== sha256Json(expectedManifest) ||
		contract.verifierEpoch !== `${KERNELBENCH_COMPILED_QUALIFICATION_EPOCH_PREFIX}${contract.contractDigest}`
	) {
		throw new Error("Expected compiled verifier contract is internally inconsistent");
	}
	expectSha256(requestSha256, "expectation.requestSha256");
	if (!JOB_ID_PATTERN.test(jobId)) throw new Error(`Invalid expected controller job ID: ${jobId}`);
	if (!/^[0-9]+$/.test(slurmJobId)) throw new Error(`Invalid expected SLURM job ID: ${slurmJobId}`);
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(`KernelBench compiled qualification result is not JSON: ${String(error)}`);
	}
	const result = expectRecord(value, "result");
	expectExactKeys(
		result,
		[
			"schemaVersion",
			"ok",
			"verifierEpoch",
			"verifierManifest",
			"jobId",
			"requestSha256",
			"startedAt",
			"finishedAt",
			"checkoutCommit",
			"taskSha256",
			"hiddenTestSha256",
			"positiveCandidateSha256",
			"wrongCandidateSha256",
			"evaluatorSha256",
			"environmentSpecSha256",
			"environmentManifestSha256",
			"pipFreezeSha256",
			"environmentSealSha256",
			"environmentManifest",
			"pipFreeze",
			"environmentSeal",
			"precision",
			"timing",
			"compilation",
			"hardware",
			"fatalKind",
			"fatalError",
			"tasks",
		],
		"result",
	);
	if (expectNumber(result.schemaVersion, "result.schemaVersion") !== 1) throw new Error("Unsupported result schema");
	const ok = expectBoolean(result.ok, "result.ok");
	if (!ok)
		throw new Error(`Compiled qualification failed: ${expectNullableString(result.fatalError, "result.fatalError")}`);
	if (
		expectString(result.jobId, "result.jobId") !== jobId ||
		expectSha256(result.requestSha256, "result.requestSha256") !== requestSha256 ||
		expectString(result.checkoutCommit, "result.checkoutCommit") !== KERNELBENCH_VERIFIED_COMMIT
	) {
		throw new Error("Compiled qualification job, request, or checkout binding mismatch");
	}
	const startedAt = expectIsoTimestamp(result.startedAt, "result.startedAt");
	const finishedAt = expectIsoTimestamp(result.finishedAt, "result.finishedAt");
	if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("Qualification timestamps are out of order");
	for (const [field, expected] of [
		["taskSha256", KERNELBENCH_COMPILED_TASK_SHA256],
		["hiddenTestSha256", KERNELBENCH_COMPILED_HIDDEN_SHA256],
		["positiveCandidateSha256", KERNELBENCH_COMPILED_POSITIVE_SHA256],
		["wrongCandidateSha256", KERNELBENCH_COMPILED_WRONG_SHA256],
	] as const) {
		if (expectSha256(result[field], `result.${field}`) !== expected) {
			throw new Error(`Compiled qualification ${field} mismatch`);
		}
	}
	const evaluatorSha256 = expectSha256(result.evaluatorSha256, "result.evaluatorSha256");
	const environmentSpecSha256 = expectSha256(result.environmentSpecSha256, "result.environmentSpecSha256");
	if (
		evaluatorSha256 !== expectedManifest.evaluatorSha256 ||
		environmentSpecSha256 !== KERNELBENCH_COMPILED_ENVIRONMENT_SHA256 ||
		environmentSpecSha256 !== expectedManifest.environmentSpecSha256
	) {
		throw new Error("Compiled evaluator or environment binding mismatch");
	}
	const environmentManifestSha256 = expectSha256(result.environmentManifestSha256, "result.environmentManifestSha256");
	const pipFreezeSha256 = expectSha256(result.pipFreezeSha256, "result.pipFreezeSha256");
	const environmentSealSha256 = expectSha256(result.environmentSealSha256, "result.environmentSealSha256");
	const environmentManifest = expectString(result.environmentManifest, "result.environmentManifest");
	const pipFreeze = expectString(result.pipFreeze, "result.pipFreeze");
	const environmentSeal = expectString(result.environmentSeal, "result.environmentSeal");
	if (
		sha256Text(environmentManifest) !== environmentManifestSha256 ||
		sha256Text(pipFreeze) !== pipFreezeSha256 ||
		sha256Text(environmentSeal) !== environmentSealSha256 ||
		environmentManifest !== contract.environmentEvidence.environmentManifest ||
		pipFreeze !== contract.environmentEvidence.pipFreeze ||
		environmentSeal !== contract.environmentEvidence.environmentSeal
	) {
		throw new Error("Compiled result does not retain the exact ready environment evidence");
	}
	const verifierManifest = expectRecord(result.verifierManifest, "result.verifierManifest");
	if (
		sha256Json(verifierManifest) !== contract.contractDigest ||
		sha256Json(verifierManifest) !== sha256Json(expectedManifest) ||
		expectString(result.verifierEpoch, "result.verifierEpoch") !== contract.verifierEpoch
	) {
		throw new Error("Compiled result does not match the controller-bound verifier contract");
	}
	expectExactKeys(verifierManifest, Object.keys(expectedManifest), "result.verifierManifest");
	for (const [field, expected] of [
		["schemaVersion", 1],
		["qualificationLane", "compiled-level2-2"],
		["checkoutCommit", KERNELBENCH_VERIFIED_COMMIT],
		["evaluatorSha256", evaluatorSha256],
		["environmentSpecSha256", environmentSpecSha256],
		["environmentManifestSha256", environmentManifestSha256],
		["pipFreezeSha256", pipFreezeSha256],
		["environmentSealSha256", environmentSealSha256],
		["taskSha256", KERNELBENCH_COMPILED_TASK_SHA256],
		["hiddenTestSha256", KERNELBENCH_COMPILED_HIDDEN_SHA256],
		["positiveCandidateSha256", KERNELBENCH_COMPILED_POSITIVE_SHA256],
		["wrongCandidateSha256", KERNELBENCH_COMPILED_WRONG_SHA256],
	] as const) {
		if (verifierManifest[field] !== expected) throw new Error(`Verifier manifest ${field} mismatch`);
	}
	for (const [field, expected] of [
		["precision", PRECISION_SPEC],
		["timing", TIMING_SPEC],
		["compilation", COMPILATION_SPEC],
	] as const) {
		const resultSpec = expectRecord(result[field], `result.${field}`);
		const manifestSpec = expectRecord(verifierManifest[field], `result.verifierManifest.${field}`);
		if (sha256Json(resultSpec) !== sha256Json(expected) || sha256Json(manifestSpec) !== sha256Json(expected)) {
			throw new Error(`Compiled qualification ${field} contract mismatch`);
		}
	}
	if (result.fatalKind !== null || result.fatalError !== null) {
		throw new Error("Successful compiled result has a fatal envelope");
	}
	const hardware = parseHardware(result.hardware);
	if (hardware.slurmJobId !== slurmJobId) {
		throw new Error("Compiled qualification SLURM job ID does not match the durable dispatch");
	}
	if (!Array.isArray(result.tasks) || result.tasks.length !== 1) {
		throw new Error("Compiled qualification result must contain exactly level2/2");
	}
	const task = parseAcceptedTask(result.tasks[0]);
	return {
		ok,
		outcome: {
			verifierEpoch: contract.verifierEpoch,
			tasks: [task],
			hardware,
			provenance: {
				adapter: "farmshare-kernelbench-compiled-qualification",
				kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
				evaluatorSha256,
				environmentSpecSha256,
				environmentManifestSha256,
				pipFreezeSha256,
				environmentSealSha256,
				requestSha256,
				controllerJobId: jobId,
				slurmJobId,
				positiveCandidateSha256: KERNELBENCH_COMPILED_POSITIVE_SHA256,
				wrongCandidateSha256: KERNELBENCH_COMPILED_WRONG_SHA256,
				acceptanceGate: "correctness-only",
				coldCompile: "first-positive-invocation-excluded-from-warm-timing",
				rawTimingSamples: "preserved-in-stdout-artifact",
			},
			stdout: raw,
		},
	};
}

function validateToken(value: string, name: string, pattern: RegExp): void {
	if (!pattern.test(value)) throw new Error(`Unsafe ${name}: ${value}`);
}

function validateAbsolutePath(value: string, name: string): void {
	validateToken(value, name, /^\/[A-Za-z0-9._/-]+$/);
	const segments = value.slice(1).split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		throw new Error(`Unsafe ${name}: path must be absolute and normalized`);
	}
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function runProcess(
	command: string,
	args: readonly string[],
	input: string | undefined,
	signal: AbortSignal,
	timeoutMs: number,
): Promise<ProcessResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], signal });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;
		const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		const append = (target: Buffer[], chunk: Buffer): void => {
			outputBytes += chunk.byteLength;
			if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) child.kill("SIGTERM");
			else target.push(chunk);
		};
		child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (exitCode) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
				reject(new Error(`${command} exceeded the ${MAX_PROCESS_OUTPUT_BYTES}-byte output limit`));
				return;
			}
			resolve({
				exitCode,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
		if (input === undefined) child.stdin.end();
		else child.stdin.end(input, "utf8");
	});
}

function formatCommandFailure(result: Readonly<ProcessResult>): string {
	return [
		`FarmShare command failed (exit ${result.exitCode ?? "signal"})`,
		`stdout:\n${result.stdout || "<empty>"}`,
		`stderr:\n${result.stderr || "<empty>"}`,
	].join("\n");
}

function isTransientCommandFailure(result: Readonly<ProcessResult>): boolean {
	if (result.exitCode === 255 || result.exitCode === null) return true;
	return /\b(?:squeue|sacct|sbatch|scancel|slurmctld|slurmdbd)\b|connection (?:closed|refused|reset)|timed? out|temporary failure/i.test(
		`${result.stdout}\n${result.stderr}`,
	);
}

export const KERNELBENCH_COMPILED_READINESS_REMOTE = `
import hashlib, json, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
commit = sys.argv[2]
environment_digest = sys.argv[3]
checkout = root / "repos" / commit
environment = root / "envs" / environment_digest
required = [
    checkout / "READY",
    environment / "READY",
    environment / "bin" / "python",
    environment / "environment.json",
    environment / "pip-freeze.txt",
    environment / "environment-seal.json",
]
missing = [str(path) for path in required if not path.exists()]
if missing:
    raise SystemExit("KernelBench compiled bootstrap/readiness missing: " + ", ".join(missing))
if (checkout / "READY").read_text(encoding="utf-8").strip() != commit:
    raise SystemExit("KernelBench compiled checkout READY mismatch")
if (environment / "READY").read_text(encoding="utf-8").strip() != environment_digest:
    raise SystemExit("KernelBench compiled environment READY mismatch")
revision = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"], check=True, capture_output=True, text=True).stdout.strip()
if revision != commit or dirty:
    raise SystemExit("KernelBench compiled checkout is not the clean pinned revision")
task_path = checkout / "KernelBench/level2/2_ConvTranspose2d_BiasAdd_Clamp_Scaling_Clamp_Divide.py"
hidden_path = checkout / "hidden_tests/level2/2_hidden.py"
def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
runtime_source = """
import importlib.metadata
import json
import platform
import torch
import torch._inductor
import triton
print(json.dumps({
    "python": platform.python_version(),
    "pip": importlib.metadata.version("pip"),
    "torch": torch.__version__,
    "torchCuda": torch.version.cuda,
    "numpy": importlib.metadata.version("numpy"),
    "hasTorchCompile": callable(getattr(torch, "compile", None)),
    "hasInductor": torch._inductor is not None,
    "hasTriton": triton is not None,
}, sort_keys=True))
"""
runtime_environment = {
    "PATH": f"{environment / 'bin'}:/usr/bin:/bin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONNOUSERSITE": "1",
}
runtime = json.loads(subprocess.run([str(environment / "bin" / "python"), "-c", runtime_source], check=True, capture_output=True, text=True, env=runtime_environment).stdout)
print(json.dumps({
    "schemaVersion": 1,
    "checkoutCommit": revision,
    "environmentSpecSha256": environment_digest,
    "environmentManifest": (environment / "environment.json").read_text(encoding="utf-8"),
    "pipFreeze": (environment / "pip-freeze.txt").read_text(encoding="utf-8"),
    "environmentSeal": (environment / "environment-seal.json").read_text(encoding="utf-8"),
    "taskInput": {"taskSha256": sha256(task_path), "hiddenTestSha256": sha256(hidden_path)},
    "runtime": runtime,
}, sort_keys=True))
`;

export const KERNELBENCH_COMPILED_BOOTSTRAP_REMOTE = String.raw`
import base64, hashlib, json, os, pathlib, re, subprocess, sys
root = pathlib.Path(sys.argv[1])
payload = json.load(sys.stdin)
script = base64.b64decode(payload["bootstrapScript"], validate=True)
environment = base64.b64decode(payload["environmentSpec"], validate=True)
asset_digest = hashlib.sha256(script + b"\0" + environment).hexdigest()
if not re.fullmatch(r"[a-f0-9]{64}", asset_digest):
    raise SystemExit("invalid compiled bootstrap asset digest")
asset_root = root / "bootstrap" / asset_digest
asset_root.mkdir(parents=True, exist_ok=True, mode=0o700)
for name, content, mode in (
    ("bootstrap-kernelbench-compiled.sh", script, 0o500),
    ("kernelbench-compiled-environment.lock", environment, 0o400),
):
    path = asset_root / name
    if path.exists():
        if path.read_bytes() != content:
            raise SystemExit(f"immutable compiled bootstrap asset mismatch: {path}")
        continue
    temporary = asset_root / f".{name}.tmp.{os.getpid()}"
    temporary.write_bytes(content)
    os.chmod(temporary, mode)
    os.replace(temporary, path)
completed = subprocess.run(
    ["bash", str(asset_root / "bootstrap-kernelbench-compiled.sh"), str(root)],
    check=False,
    capture_output=True,
    text=True,
)
sys.stdout.write(completed.stdout)
sys.stderr.write(completed.stderr)
raise SystemExit(completed.returncode)
`;

const PREPARE_REMOTE = `
import base64, json, os, pathlib, sys
root = pathlib.Path(sys.argv[1])
payload = json.load(sys.stdin)
root.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(root, 0o700)
for name, mode in (("request.json", 0o600), ("evaluator.py", 0o500), ("job.sh", 0o500)):
    content = base64.b64decode(payload[name], validate=True)
    path = root / name
    if path.exists():
        if path.read_bytes() != content:
            raise SystemExit(f"immutable asset mismatch: {path}")
        continue
    temporary = root / f".{name}.tmp.{os.getpid()}"
    temporary.write_bytes(content)
    os.chmod(temporary, mode)
    os.replace(temporary, path)
print(json.dumps({"prepared": str(root)}))
`;

const POLL_REMOTE = `
import json, os, pathlib, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
id_path = root / "slurm-job-id"
job_id = id_path.read_text(encoding="utf-8").strip() if id_path.exists() else ""
log_path = root / f"slurm-{job_id}.out" if job_id else None
log = log_path.read_text(encoding="utf-8", errors="replace")[-262144:] if log_path and log_path.exists() else ""
result_path = root / "result.json"
if result_path.exists():
    print(json.dumps({"kind": "result", "rawResult": result_path.read_text(encoding="utf-8"), "log": log}))
    raise SystemExit(0)
if not job_id:
    print(json.dumps({"kind": "pending", "schedulerState": "DISPATCHING"}))
    raise SystemExit(0)
queued = subprocess.run(["squeue", "--noheader", "--jobs", job_id, "--format=%T"], capture_output=True, text=True, check=True)
state = queued.stdout.strip().splitlines()
if state:
    print(json.dumps({"kind": "pending", "schedulerState": state[0]}))
    raise SystemExit(0)
accounted = subprocess.run(["sacct", "--noheader", "-X", "--jobs", job_id, "--format=State,ExitCode", "--parsable2"], capture_output=True, text=True, check=True)
rows = [line.strip() for line in accounted.stdout.splitlines() if line.strip()]
if not rows:
    print(json.dumps({"kind": "pending", "schedulerState": "ACCOUNTING_LAG"}))
    raise SystemExit(0)
visibility_marker = root / "terminal-result-visibility-grace"
if not visibility_marker.exists():
    try:
        descriptor = os.open(visibility_marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(str(time.time()))
    except FileExistsError:
        pass
try:
    first_terminal_observation = float(visibility_marker.read_text(encoding="utf-8"))
except (OSError, ValueError):
    first_terminal_observation = time.time()
if time.time() - first_terminal_observation < 120:
    print(json.dumps({"kind": "pending", "schedulerState": "RESULT_VISIBILITY_GRACE:" + rows[0]}))
    raise SystemExit(0)
print(json.dumps({"kind": "failed", "reason": "SLURM completed without a durable result: " + rows[0], "log": log}))
`;

function parseSingleJsonObject(stdout: string, label: string): Record<string, unknown> {
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length !== 1) throw new Error(`${label} returned ${lines.length} JSON lines`);
	return expectRecord(JSON.parse(lines[0]), label);
}

class SshKernelBenchCompiledQualificationTransport implements KernelBenchCompiledQualificationTransport {
	constructor(private readonly config: KernelBenchCompiledQualificationConfig) {}

	private async remotePython(
		source: string,
		args: readonly string[],
		input: string | undefined,
		signal: AbortSignal,
		timeoutMs = 120_000,
	): Promise<ProcessResult> {
		const command = ["python3", "-c", source, ...args].map(shellQuote).join(" ");
		const result = await runProcess("ssh", [this.config.host, command], input, signal, timeoutMs);
		if (result.exitCode !== 0) {
			const message = formatCommandFailure(result);
			if (isTransientCommandFailure(result)) throw new KernelBenchTransientTransportError(message);
			throw new Error(message);
		}
		return result;
	}

	async bootstrap(remoteRoot: string, assets: KernelBenchCompiledBootstrapAssets, signal: AbortSignal): Promise<void> {
		const payload = JSON.stringify({
			bootstrapScript: Buffer.from(assets.bootstrapScript).toString("base64"),
			environmentSpec: Buffer.from(assets.environmentSpec).toString("base64"),
		});
		await this.remotePython(KERNELBENCH_COMPILED_BOOTSTRAP_REMOTE, [remoteRoot], payload, signal, 1_800_000);
	}

	async readiness(
		remoteRoot: string,
		checkoutCommit: string,
		environmentSpecSha256: string,
		signal: AbortSignal,
	): Promise<string> {
		const result = await this.remotePython(
			KERNELBENCH_COMPILED_READINESS_REMOTE,
			[remoteRoot, checkoutCommit, environmentSpecSha256],
			undefined,
			signal,
		);
		return result.stdout;
	}

	async prepare(remoteJobDir: string, assets: KernelBenchCompiledRemoteAssets, signal: AbortSignal): Promise<void> {
		const payload = JSON.stringify({
			"request.json": Buffer.from(assets.requestJson).toString("base64"),
			"evaluator.py": Buffer.from(assets.evaluatorSource).toString("base64"),
			"job.sh": Buffer.from(assets.jobScript).toString("base64"),
		});
		await this.remotePython(PREPARE_REMOTE, [remoteJobDir], payload, signal);
	}

	async ensureSubmitted(remoteJobDir: string, jobName: string, signal: AbortSignal): Promise<{ slurmJobId: string }> {
		for (;;) {
			const result = await this.remotePython(
				KERNELBENCH_ENSURE_SUBMITTED_REMOTE,
				[remoteJobDir, jobName, String(this.config.dispatchVisibilityGraceMs / 1000)],
				undefined,
				signal,
			);
			const parsed = parseSingleJsonObject(result.stdout, "dispatch");
			const kind = expectString(parsed.kind, "dispatch.kind");
			if (kind === "submitted") {
				const slurmJobId = expectString(parsed.slurmJobId, "dispatch.slurmJobId");
				if (!/^[0-9]+$/.test(slurmJobId)) throw new Error(`Invalid SLURM job ID: ${slurmJobId}`);
				return { slurmJobId };
			}
			if (kind === "ambiguous") throw new Error(expectString(parsed.reason, "dispatch.reason"));
			if (kind !== "reconciling") throw new Error(`Unknown dispatch result: ${kind}`);
			const retryAfterMs = expectNumber(parsed.retryAfterMs, "dispatch.retryAfterMs");
			await delay(Math.max(1, Math.min(retryAfterMs, this.config.pollIntervalMs)), signal);
		}
	}

	async poll(remoteJobDir: string, signal: AbortSignal): Promise<KernelBenchCompiledRemotePoll> {
		const result = await this.remotePython(POLL_REMOTE, [remoteJobDir], undefined, signal);
		const parsed = parseSingleJsonObject(result.stdout, "poll");
		const kind = expectString(parsed.kind, "poll.kind");
		if (kind === "pending") {
			return { kind, schedulerState: expectString(parsed.schedulerState, "poll.schedulerState") };
		}
		if (kind === "result") {
			return {
				kind,
				rawResult: expectString(parsed.rawResult, "poll.rawResult"),
				log: expectString(parsed.log, "poll.log"),
			};
		}
		if (kind === "failed") {
			return {
				kind,
				reason: expectString(parsed.reason, "poll.reason"),
				log: expectString(parsed.log, "poll.log"),
			};
		}
		throw new Error(`Unknown poll kind: ${kind}`);
	}

	async cancelAndVerify(remoteJobDir: string, slurmJobId: string, signal: AbortSignal): Promise<string> {
		const result = await this.remotePython(KERNELBENCH_CANCEL_REMOTE, [remoteJobDir, slurmJobId], undefined, signal);
		const parsed = parseSingleJsonObject(result.stdout, "cancellation");
		if (!expectBoolean(parsed.verifiedAbsent, "cancellation.verifiedAbsent")) {
			throw new Error("SLURM cancellation was not verified");
		}
		return expectString(parsed.accounting, "cancellation.accounting");
	}
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("Evaluation aborted"));
			return;
		}
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(signal.reason ?? new Error("Evaluation aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function failureOutcome(
	job: EvaluationJob,
	reason: string,
	log: string,
	provenance: Record<string, string>,
): EvaluationOutcome {
	return {
		verifierEpoch: "kernelbench-compiled-qualification-adapter-error-v1",
		tasks: job.benchmarkIds.map((benchmarkId) => ({
			benchmarkId,
			status: "failed",
			metrics: {},
			verifier: { passed: false, checks: [], errors: [reason] },
			runtimeMs: 0,
		})),
		hardware: { cluster: "Stanford FarmShare", gpu: "L40S" },
		provenance,
		stderr: log ? `${reason}\n${log}` : reason,
	};
}

export function buildKernelBenchCompiledQualificationJobScript(
	config: KernelBenchCompiledQualificationConfig,
	remoteJobDir: string,
	checkoutDir: string,
	pythonPath: string,
): string {
	for (const [value, name] of [
		[config.partition, "partition"],
		[config.constraint, "constraint"],
	] as const) {
		validateToken(value, name, /^[A-Za-z0-9._:-]+$/);
	}
	for (const [value, name] of [
		[remoteJobDir, "remote job directory"],
		[checkoutDir, "checkout directory"],
		[pythonPath, "python path"],
	] as const) {
		validateAbsolutePath(value, name);
	}
	return `#!/usr/bin/env bash
#SBATCH --job-name=prime-kbv-compiled-qualification
#SBATCH --partition=${config.partition}
#SBATCH --constraint=${config.constraint}
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=00:30:00
#SBATCH --export=NONE
#SBATCH --output=${remoteJobDir}/slurm-%j.out
set -euo pipefail
umask 077
mkdir -p ${shellQuote(`${remoteJobDir}/home`)} ${shellQuote(`${remoteJobDir}/tmp`)} ${shellQuote(`${remoteJobDir}/torchinductor-cache`)}
env -i \
	HOME=${shellQuote(`${remoteJobDir}/home`)} \
	TMPDIR=${shellQuote(`${remoteJobDir}/tmp`)} \
	TORCHINDUCTOR_CACHE_DIR=${shellQuote(`${remoteJobDir}/torchinductor-cache`)} \
	PATH=${shellQuote(`${pythonPath.slice(0, pythonPath.lastIndexOf("/"))}:/usr/bin:/bin`)} \
	CUDA_VISIBLE_DEVICES="\${CUDA_VISIBLE_DEVICES:-}" \
	SLURM_JOB_ID="\${SLURM_JOB_ID:-}" \
	PYTHONDONTWRITEBYTECODE=1 \
	PYTHONNOUSERSITE=1 \
	${shellQuote(pythonPath)} ${shellQuote(`${remoteJobDir}/evaluator.py`)} \
		--checkout ${shellQuote(checkoutDir)} \
		--request ${shellQuote(`${remoteJobDir}/request.json`)} \
		--output ${shellQuote(`${remoteJobDir}/result.json`)}
`;
}

export function parseKernelBenchCompiledQualificationHandle(handle: string, remoteRoot: string): string {
	if (!handle.startsWith(HANDLE_PREFIX)) throw new Error(`Invalid compiled qualification handle: ${handle}`);
	const remoteJobDir = handle.slice(HANDLE_PREFIX.length);
	validateAbsolutePath(remoteRoot, "remote root");
	validateAbsolutePath(remoteJobDir, "remote job directory");
	if (!remoteJobDir.startsWith(`${remoteRoot}/jobs/`)) {
		throw new Error(`Compiled qualification handle is outside the configured remote root: ${handle}`);
	}
	const jobId = remoteJobDir.slice(`${remoteRoot}/jobs/`.length);
	if (!JOB_ID_PATTERN.test(jobId) || remoteJobDir !== `${remoteRoot}/jobs/${jobId}`) {
		throw new Error(`Invalid job directory in compiled qualification handle: ${handle}`);
	}
	return remoteJobDir;
}

export class KernelBenchCompiledQualificationAdapter implements EvaluationAdapter {
	readonly lane = "kernelbench" as const;
	private readonly transport: KernelBenchCompiledQualificationTransport;

	constructor(
		private readonly config: KernelBenchCompiledQualificationConfig = DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG,
		transport?: KernelBenchCompiledQualificationTransport,
	) {
		validateToken(config.host, "host", /^[A-Za-z0-9._-]+$/);
		validateAbsolutePath(config.remoteRoot, "remote root");
		if (!Number.isInteger(config.pollIntervalMs) || config.pollIntervalMs < 1) {
			throw new Error("pollIntervalMs must be a positive integer");
		}
		if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < config.pollIntervalMs) {
			throw new Error("requestTimeoutMs must be at least pollIntervalMs");
		}
		if (!Number.isInteger(config.dispatchVisibilityGraceMs) || config.dispatchVisibilityGraceMs < 1) {
			throw new Error("dispatchVisibilityGraceMs must be a positive integer");
		}
		this.transport = transport ?? new SshKernelBenchCompiledQualificationTransport(config);
	}

	private async readVerifierSources(): Promise<{
		evaluatorSource: string;
		environmentSpec: string;
		positiveCandidateSource: string;
		wrongCandidateSource: string;
		evaluatorSha256: string;
		environmentSpecSha256: string;
	}> {
		const evaluatorPath = fileURLToPath(new URL("../evaluators/kernelbench_compiled_qualify.py", import.meta.url));
		const environmentPath = fileURLToPath(
			new URL("../farmshare/kernelbench-compiled-environment.lock", import.meta.url),
		);
		const positiveCandidatePath = fileURLToPath(
			new URL("../candidates/kernelbench/level2-2-inductor-fullgraph-v1.py", import.meta.url),
		);
		const wrongCandidatePath = fileURLToPath(
			new URL("../candidates/kernelbench/level2-2-inductor-wrong-output-v1.py", import.meta.url),
		);
		const [evaluatorSource, environmentSpec, positiveCandidateSource, wrongCandidateSource] = await Promise.all([
			readFile(evaluatorPath, "utf8"),
			readFile(environmentPath, "utf8"),
			readFile(positiveCandidatePath, "utf8"),
			readFile(wrongCandidatePath, "utf8"),
		]);
		for (const [source, expected, label] of [
			[environmentSpec, KERNELBENCH_COMPILED_ENVIRONMENT_SHA256, "compiled environment lock"],
			[positiveCandidateSource, KERNELBENCH_COMPILED_POSITIVE_SHA256, "positive candidate"],
			[wrongCandidateSource, KERNELBENCH_COMPILED_WRONG_SHA256, "wrong candidate"],
		] as const) {
			const actual = sha256Text(source);
			if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}`);
		}
		return {
			evaluatorSource,
			environmentSpec,
			positiveCandidateSource,
			wrongCandidateSource,
			evaluatorSha256: sha256Text(evaluatorSource),
			environmentSpecSha256: sha256Text(environmentSpec),
		};
	}

	async requireReady(signal: AbortSignal): Promise<KernelBenchCompiledQualificationContract> {
		const sources = await this.readVerifierSources();
		const raw = await this.transport.readiness(
			this.config.remoteRoot,
			KERNELBENCH_VERIFIED_COMMIT,
			sources.environmentSpecSha256,
			signal,
		);
		return parseKernelBenchCompiledQualificationReadiness(
			raw,
			sources.evaluatorSha256,
			sources.environmentSpecSha256,
		);
	}

	async bootstrap(signal: AbortSignal): Promise<KernelBenchCompiledQualificationContract> {
		const bootstrapPath = fileURLToPath(new URL("../farmshare/bootstrap-kernelbench-compiled.sh", import.meta.url));
		const [sources, bootstrapScript] = await Promise.all([
			this.readVerifierSources(),
			readFile(bootstrapPath, "utf8"),
		]);
		await this.transport.bootstrap(
			this.config.remoteRoot,
			{ bootstrapScript, environmentSpec: sources.environmentSpec },
			signal,
		);
		return this.requireReady(signal);
	}

	private async retryTransient<T>(operation: () => Promise<T>, signal: AbortSignal, deadline: number): Promise<T> {
		let attempt = 0;
		for (;;) {
			try {
				return await operation();
			} catch (error) {
				if (!(error instanceof KernelBenchTransientTransportError) || Date.now() >= deadline) throw error;
				const exponentialMs = 100 * 2 ** Math.min(attempt, 6);
				const backoffMs = Math.max(1, Math.min(exponentialMs, this.config.pollIntervalMs, deadline - Date.now()));
				attempt++;
				await delay(backoffMs, signal);
			}
		}
	}

	private validateJob(job: EvaluationJob, positiveCandidateSource: string): void {
		if (job.lane !== "kernelbench") throw new Error(`Unexpected lane: ${job.lane}`);
		if (!JOB_ID_PATTERN.test(job.jobId)) throw new Error(`Invalid controller job ID: ${job.jobId}`);
		if (job.treatment !== KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT) {
			throw new Error("Compiled qualification requires its isolated treatment");
		}
		if (job.benchmarkIds.length !== 1 || job.benchmarkIds[0] !== KERNELBENCH_COMPILED_QUALIFICATION_TASKS[0]) {
			throw new Error("Compiled qualification requires exactly level2/2");
		}
		if (job.candidateFormat !== "python-source" || job.candidateContent !== positiveCandidateSource) {
			throw new Error("Compiled qualification only accepts the byte-exact positive candidate");
		}
		if (sha256Text(job.candidateContent) !== KERNELBENCH_COMPILED_POSITIVE_SHA256) {
			throw new Error("Compiled qualification candidate is outside the SHA-256 allowlist");
		}
	}

	private async prepare(job: EvaluationJob, signal: AbortSignal): Promise<PreparedQualification> {
		const sources = await this.readVerifierSources();
		this.validateJob(job, sources.positiveCandidateSource);
		const readinessRaw = await this.transport.readiness(
			this.config.remoteRoot,
			KERNELBENCH_VERIFIED_COMMIT,
			sources.environmentSpecSha256,
			signal,
		);
		const contract = parseKernelBenchCompiledQualificationReadiness(
			readinessRaw,
			sources.evaluatorSha256,
			sources.environmentSpecSha256,
		);
		const expectedBoundaryConditions = kernelBenchCompiledQualificationBoundaryConditions(contract);
		if (
			job.proposal.boundaryConditions.length !== expectedBoundaryConditions.length ||
			job.proposal.boundaryConditions.some((condition, index) => condition !== expectedBoundaryConditions[index])
		) {
			throw new Error("Compiled controller proposal is not bound to the ready verifier epoch");
		}
		const remoteJobDir = `${this.config.remoteRoot}/jobs/${job.jobId}`;
		const handle = `${HANDLE_PREFIX}${remoteJobDir}`;
		const checkoutDir = `${this.config.remoteRoot}/repos/${KERNELBENCH_VERIFIED_COMMIT}`;
		const pythonPath = `${this.config.remoteRoot}/envs/${sources.environmentSpecSha256}/bin/python`;
		const requestJson = `${JSON.stringify({
			schemaVersion: 1,
			jobId: job.jobId,
			taskId: KERNELBENCH_COMPILED_QUALIFICATION_TASKS[0],
			positiveCandidateSource: sources.positiveCandidateSource,
			wrongCandidateSource: sources.wrongCandidateSource,
			positiveCandidateSha256: KERNELBENCH_COMPILED_POSITIVE_SHA256,
			wrongCandidateSha256: KERNELBENCH_COMPILED_WRONG_SHA256,
			checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
			environmentSpecSha256: sources.environmentSpecSha256,
			expectedVerifierEpoch: contract.verifierEpoch,
			verifierContractDigest: contract.contractDigest,
		})}\n`;
		const requestSha256 = sha256Text(requestJson);
		return {
			remoteJobDir,
			handle,
			jobName: `pkbvc-${sha256Text(job.jobId).slice(0, 19)}`,
			evaluatorSha256: sources.evaluatorSha256,
			environmentSpecSha256: sources.environmentSpecSha256,
			positiveCandidateSource: sources.positiveCandidateSource,
			wrongCandidateSource: sources.wrongCandidateSource,
			requestSha256,
			contract,
			assets: {
				requestJson,
				evaluatorSource: sources.evaluatorSource,
				jobScript: buildKernelBenchCompiledQualificationJobScript(
					this.config,
					remoteJobDir,
					checkoutDir,
					pythonPath,
				),
			},
		};
	}

	private async reconcile(
		job: EvaluationJob,
		prepared: PreparedQualification,
		signal: AbortSignal,
	): Promise<EvaluationOutcome> {
		const deadline = Date.now() + this.config.requestTimeoutMs;
		await this.retryTransient(
			() => this.transport.prepare(prepared.remoteJobDir, prepared.assets, signal),
			signal,
			deadline,
		);
		const dispatch = await this.retryTransient(
			() => this.transport.ensureSubmitted(prepared.remoteJobDir, prepared.jobName, signal),
			signal,
			deadline,
		);
		const provenance = {
			adapter: "farmshare-kernelbench-compiled-qualification",
			remoteHandle: prepared.handle,
			remoteJobDir: prepared.remoteJobDir,
			slurmJobId: dispatch.slurmJobId,
			kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
			evaluatorSha256: prepared.evaluatorSha256,
			environmentSpecSha256: prepared.environmentSpecSha256,
			positiveCandidateSha256: sha256Text(prepared.positiveCandidateSource),
			wrongCandidateSha256: sha256Text(prepared.wrongCandidateSource),
			requestSha256: prepared.requestSha256,
			verifierEpoch: prepared.contract.verifierEpoch,
			verifierContractDigest: prepared.contract.contractDigest,
		};
		while (Date.now() <= deadline) {
			let poll: KernelBenchCompiledRemotePoll;
			try {
				poll = await this.retryTransient(
					() => this.transport.poll(prepared.remoteJobDir, signal),
					signal,
					deadline,
				);
			} catch (error) {
				if (error instanceof KernelBenchTransientTransportError && Date.now() >= deadline) break;
				throw error;
			}
			if (poll.kind === "result") {
				try {
					const parsed = parseKernelBenchCompiledQualificationResult(poll.rawResult, {
						contract: prepared.contract,
						requestSha256: prepared.requestSha256,
						jobId: job.jobId,
						slurmJobId: dispatch.slurmJobId,
					});
					return {
						...parsed.outcome,
						provenance: { ...parsed.outcome.provenance, ...provenance },
						stderr: poll.log || parsed.outcome.stderr,
					};
				} catch (error) {
					return failureOutcome(
						job,
						`Invalid durable compiled KernelBench result: ${error instanceof Error ? error.message : String(error)}`,
						poll.log,
						provenance,
					);
				}
			}
			if (poll.kind === "failed") return failureOutcome(job, poll.reason, poll.log, provenance);
			await delay(this.config.pollIntervalMs, signal);
		}
		const cancellationAccounting = await this.transport.cancelAndVerify(
			prepared.remoteJobDir,
			dispatch.slurmJobId,
			signal,
		);
		return failureOutcome(
			job,
			`Timed out waiting for durable compiled KernelBench result after ${this.config.requestTimeoutMs}ms; SLURM cancellation verified`,
			"",
			{ ...provenance, cancellationVerified: "true", cancellationAccounting },
		);
	}

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		const prepared = await this.prepare(job, context.signal);
		await context.recordExternalJobId(prepared.handle);
		return this.reconcile(job, prepared, context.signal);
	}

	async resume(job: EvaluationJob, externalJobId: string, context: EvaluationContext): Promise<EvaluationOutcome> {
		const prepared = await this.prepare(job, context.signal);
		const remoteJobDir = parseKernelBenchCompiledQualificationHandle(externalJobId, this.config.remoteRoot);
		if (remoteJobDir !== prepared.remoteJobDir || externalJobId !== prepared.handle) {
			throw new Error(`External compiled handle does not belong to ${job.jobId}`);
		}
		return this.reconcile(job, prepared, context.signal);
	}
}

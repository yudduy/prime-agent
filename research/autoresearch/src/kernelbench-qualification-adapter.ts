import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256Json, sha256Text } from "./canonical-json.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	TaskMeasurement,
} from "./types.js";

export const KERNELBENCH_VERIFIED_COMMIT = "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e";
export const KERNELBENCH_QUALIFICATION_EPOCH_PREFIX = "kernelbench-verified-qualification-v1:";
export const KERNELBENCH_QUALIFICATION_TASKS = ["level1/1", "level2/2", "level3/1"] as const;
export const KERNELBENCH_QUALIFICATION_CANDIDATE = "ModelNew = Model";
export const KERNELBENCH_WRONG_OUTPUT_CANDIDATE = `class ModelNew(Model):
    def forward(self, *args, **kwargs):
        output = super().forward(*args, **kwargs)
        return torch.where(output >= 0, -torch.ones_like(output), torch.ones_like(output))
`;

const QUALIFICATION_PATHS: Record<
	(typeof KERNELBENCH_QUALIFICATION_TASKS)[number],
	{ task: string; hidden: string; taskSha256: string; hiddenTestSha256: string }
> = {
	"level1/1": {
		task: "KernelBench/level1/1_Square_matrix_multiplication_.py",
		hidden: "hidden_tests/level1/1_hidden.py",
		taskSha256: "2d349d77a97fd1a6f29365553275729685ab1cfff57ca4458bb6a8c09b88e91d",
		hiddenTestSha256: "9377caa50e3653ea38e6d35c3189a4cbdad1753d0c8dd17eb8ae2f70eba74f85",
	},
	"level2/2": {
		task: "KernelBench/level2/2_ConvTranspose2d_BiasAdd_Clamp_Scaling_Clamp_Divide.py",
		hidden: "hidden_tests/level2/2_hidden.py",
		taskSha256: "31f49a84239cb24383e84ea78c778d9fc047455a12df3e2eb269ce6deedaf808",
		hiddenTestSha256: "5a951a50e3d2e23f3a977005e6508ae3f37974e1bf08b2fdb0f004619f46e6f0",
	},
	"level3/1": {
		task: "KernelBench/level3/1_MLP.py",
		hidden: "hidden_tests/level3/1_hidden.py",
		taskSha256: "d78f9c39c087a74f2e924bcd8a0bb73972763094f2de096bec1337ab8836553a",
		hiddenTestSha256: "5652c2d43ca0d146fbef0e1c7d14220dc01c4077ceb413e885691f104c452f04",
	},
};

const HANDLE_PREFIX = "kernelbench-qualification-v1:";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const JOB_ID_PATTERN = /^job_[a-f0-9]{24}$/;
const MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
const EXPECTED_PYTHON = "3.12.3";
const EXPECTED_PIP = "25.2";
const EXPECTED_TORCH = "2.11.0";
const EXPECTED_TORCH_CUDA = "12.8";
const PRECISION_SPEC = {
	dtype: "float32",
	matmulPrecision: "high",
	matmulAllowTf32: true,
	cudnnAllowTf32: true,
	atol: 1e-3,
	rtol: 1e-3,
} as const;
const TIMING_SPEC = { warmups: 3, trials: 10, unit: "milliseconds" } as const;
const COMPILE_CANARY_SPEC = {
	backend: "inductor",
	fullgraph: true,
	dynamic: false,
	device: "cuda",
	dtype: "float32",
	shape: [256],
} as const;
const ACCEPTED_METRIC_KEYS = [
	"qualified",
	"hiddenConfigsPassed",
	"wrongOutputsRejected",
	"referenceMeanMs",
	"candidateMeanMs",
	"speedupGeomean",
	"fastAtOne",
	"referencePeakMemoryBytes",
	"candidatePeakMemoryBytes",
] as const;

export interface KernelBenchQualificationConfig {
	host: string;
	partition: string;
	constraint: string;
	remoteRoot: string;
	pollIntervalMs: number;
	requestTimeoutMs: number;
	dispatchVisibilityGraceMs: number;
}

export const DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG: KernelBenchQualificationConfig = {
	host: "farmshare",
	partition: "gpu",
	constraint: "GPU_SKU:L40S",
	remoteRoot: "/scratch/users/duynguy/prime-autoresearch/kernelbench",
	pollIntervalMs: 10_000,
	requestTimeoutMs: 172_800_000,
	dispatchVisibilityGraceMs: 120_000,
};

interface ProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export class KernelBenchTransientTransportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "KernelBenchTransientTransportError";
	}
}

export interface KernelBenchRemoteAssets {
	requestJson: string;
	evaluatorSource: string;
	jobScript: string;
}

export interface KernelBenchBootstrapAssets {
	bootstrapScript: string;
	environmentSpec: string;
}

export interface KernelBenchEnvironmentEvidence {
	environmentManifest: string;
	pipFreeze: string;
	environmentSeal: string;
	environmentManifestSha256: string;
	pipFreezeSha256: string;
	environmentSealSha256: string;
}

export interface KernelBenchQualificationContract {
	verifierEpoch: string;
	contractDigest: string;
	verifierManifest: Record<string, unknown>;
	environmentEvidence: KernelBenchEnvironmentEvidence;
}

export interface KernelBenchDispatch {
	slurmJobId: string;
}

export interface KernelBenchQualificationExpectation {
	contract: KernelBenchQualificationContract;
	requestSha256: string;
	jobId: string;
	slurmJobId: string;
}

export type KernelBenchRemotePoll =
	| { kind: "pending"; schedulerState: string }
	| { kind: "result"; rawResult: string; log: string }
	| { kind: "failed"; reason: string; log: string };

export interface KernelBenchQualificationTransport {
	bootstrap(remoteRoot: string, assets: KernelBenchBootstrapAssets, signal: AbortSignal): Promise<void>;
	readiness(
		remoteRoot: string,
		checkoutCommit: string,
		environmentSpecSha256: string,
		signal: AbortSignal,
	): Promise<string>;
	prepare(remoteJobDir: string, assets: KernelBenchRemoteAssets, signal: AbortSignal): Promise<void>;
	ensureSubmitted(remoteJobDir: string, jobName: string, signal: AbortSignal): Promise<KernelBenchDispatch>;
	poll(remoteJobDir: string, signal: AbortSignal): Promise<KernelBenchRemotePoll>;
	cancelAndVerify(remoteJobDir: string, slurmJobId: string, signal: AbortSignal): Promise<string>;
}

interface PreparedQualification {
	remoteJobDir: string;
	handle: string;
	jobName: string;
	evaluatorSha256: string;
	environmentSpecSha256: string;
	requestSha256: string;
	contract: KernelBenchQualificationContract;
	assets: KernelBenchRemoteAssets;
}

interface ParsedQualification {
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
	const actual = Object.keys(record);
	const missing = keys.filter((key) => !(key in record));
	const extra = actual.filter((key) => !expected.has(key));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(`Keys mismatch at ${path}: missing=${missing.join(",")} extra=${extra.join(",")}`);
	}
}

function expectIsoTimestamp(value: unknown, path: string): string {
	const timestamp = expectString(value, path);
	if (!timestamp.endsWith("Z") || !Number.isFinite(Date.parse(timestamp))) {
		throw new Error(`Expected UTC ISO timestamp at ${path}`);
	}
	return timestamp;
}

function expectSha256(value: unknown, path: string): string {
	const digest = expectString(value, path);
	if (!HASH_PATTERN.test(digest)) throw new Error(`Expected SHA-256 digest at ${path}`);
	return digest;
}

function expectPositiveSamples(value: unknown, path: string): number[] {
	if (!Array.isArray(value) || value.length !== 10) throw new Error(`Expected ten samples at ${path}`);
	return value.map((sample, index) => {
		const number = expectNumber(sample, `${path}[${index}]`);
		if (number <= 0) throw new Error(`Expected positive sample at ${path}[${index}]`);
		return number;
	});
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

function stringHardware(value: unknown): Record<string, string> {
	const record = expectRecord(value, "result.hardware");
	expectExactKeys(
		record,
		[
			"cluster",
			"hostname",
			"gpuName",
			"gpuComputeCapability",
			"gpuTotalMemoryBytes",
			"torchVersion",
			"torchCudaVersion",
			"slurmJobId",
			"cudaVisibleDevices",
		],
		"result.hardware",
	);
	const gpuTotalMemoryBytes = expectNumber(record.gpuTotalMemoryBytes, "result.hardware.gpuTotalMemoryBytes");
	return {
		cluster: expectString(record.cluster, "result.hardware.cluster"),
		hostname: expectString(record.hostname, "result.hardware.hostname"),
		gpuName: expectString(record.gpuName, "result.hardware.gpuName"),
		gpuComputeCapability: expectString(record.gpuComputeCapability, "result.hardware.gpuComputeCapability"),
		gpuTotalMemoryBytes: String(gpuTotalMemoryBytes),
		torchVersion: expectString(record.torchVersion, "result.hardware.torchVersion"),
		torchCudaVersion: expectString(record.torchCudaVersion, "result.hardware.torchCudaVersion"),
		slurmJobId: expectString(record.slurmJobId, "result.hardware.slurmJobId"),
		cudaVisibleDevices: expectString(record.cudaVisibleDevices, "result.hardware.cudaVisibleDevices"),
	};
}

export function parseKernelBenchQualificationReadiness(
	raw: string,
	evaluatorSha256: string,
	environmentSpecSha256: string,
): KernelBenchQualificationContract {
	expectSha256(evaluatorSha256, "readiness.evaluatorSha256");
	expectSha256(environmentSpecSha256, "readiness.environmentSpecSha256");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(`KernelBench readiness is not JSON: ${String(error)}`);
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
			"taskInputs",
			"runtime",
		],
		"readiness",
	);
	if (expectNumber(readiness.schemaVersion, "readiness.schemaVersion") !== 1) {
		throw new Error("Unsupported KernelBench readiness schema");
	}
	if (expectString(readiness.checkoutCommit, "readiness.checkoutCommit") !== KERNELBENCH_VERIFIED_COMMIT) {
		throw new Error("KernelBench readiness checkout mismatch");
	}
	if (expectSha256(readiness.environmentSpecSha256, "readiness.environmentSpecSha256") !== environmentSpecSha256) {
		throw new Error("KernelBench readiness environment mismatch");
	}
	const environmentManifest = expectString(readiness.environmentManifest, "readiness.environmentManifest");
	const pipFreeze = expectString(readiness.pipFreeze, "readiness.pipFreeze");
	const environmentSeal = expectString(readiness.environmentSeal, "readiness.environmentSeal");
	const environmentManifestSha256 = sha256Text(environmentManifest);
	const pipFreezeSha256 = sha256Text(pipFreeze);
	const environmentSealSha256 = sha256Text(environmentSeal);
	const manifest = expectRecord(JSON.parse(environmentManifest), "readiness.environmentManifestJson");
	expectExactKeys(
		manifest,
		["schemaVersion", "environmentSpecSha256", "kernelBenchVerifiedCommit", "pip", "python", "torch", "torchCuda"],
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
		expectString(manifest.torchCuda, "readiness.environmentManifestJson.torchCuda") !== EXPECTED_TORCH_CUDA
	) {
		throw new Error("KernelBench environment manifest is not the pinned runtime");
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
		throw new Error("KernelBench environment seal does not bind the exact evidence");
	}
	if (!pipFreeze.split("\n").includes(`pip==${EXPECTED_PIP}`) || !pipFreeze.includes(`torch==${EXPECTED_TORCH}`)) {
		throw new Error("KernelBench pip freeze does not contain the pinned direct dependencies");
	}
	const runtime = expectRecord(readiness.runtime, "readiness.runtime");
	expectExactKeys(
		runtime,
		["python", "pip", "torch", "torchCuda", "hasTorchCompile", "hasInductor", "hasTriton"],
		"readiness.runtime",
	);
	if (
		expectString(runtime.python, "readiness.runtime.python") !== EXPECTED_PYTHON ||
		expectString(runtime.pip, "readiness.runtime.pip") !== EXPECTED_PIP ||
		!expectString(runtime.torch, "readiness.runtime.torch").startsWith(EXPECTED_TORCH) ||
		expectString(runtime.torchCuda, "readiness.runtime.torchCuda") !== EXPECTED_TORCH_CUDA ||
		!expectBoolean(runtime.hasTorchCompile, "readiness.runtime.hasTorchCompile") ||
		!expectBoolean(runtime.hasInductor, "readiness.runtime.hasInductor") ||
		!expectBoolean(runtime.hasTriton, "readiness.runtime.hasTriton")
	) {
		throw new Error("KernelBench evaluator prerequisites are not ready");
	}
	const taskInputsRecord = expectRecord(readiness.taskInputs, "readiness.taskInputs");
	expectExactKeys(taskInputsRecord, KERNELBENCH_QUALIFICATION_TASKS, "readiness.taskInputs");
	const taskInputs: Record<string, { taskSha256: string; hiddenTestSha256: string }> = {};
	for (const benchmarkId of KERNELBENCH_QUALIFICATION_TASKS) {
		const hashes = expectRecord(taskInputsRecord[benchmarkId], `readiness.taskInputs.${benchmarkId}`);
		expectExactKeys(hashes, ["taskSha256", "hiddenTestSha256"], `readiness.taskInputs.${benchmarkId}`);
		const taskSha256 = expectSha256(hashes.taskSha256, `readiness.taskInputs.${benchmarkId}.taskSha256`);
		const hiddenTestSha256 = expectSha256(
			hashes.hiddenTestSha256,
			`readiness.taskInputs.${benchmarkId}.hiddenTestSha256`,
		);
		const expected = QUALIFICATION_PATHS[benchmarkId];
		if (taskSha256 !== expected.taskSha256 || hiddenTestSha256 !== expected.hiddenTestSha256) {
			throw new Error(`KernelBench readiness input mismatch for ${benchmarkId}`);
		}
		taskInputs[benchmarkId] = { taskSha256, hiddenTestSha256 };
	}
	const verifierManifest: Record<string, unknown> = {
		schemaVersion: 1,
		checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
		evaluatorSha256,
		environmentSpecSha256,
		environmentManifestSha256,
		pipFreezeSha256,
		environmentSealSha256,
		candidateSha256: sha256Text(KERNELBENCH_QUALIFICATION_CANDIDATE),
		negativeControlSha256: sha256Text(KERNELBENCH_WRONG_OUTPUT_CANDIDATE),
		precision: PRECISION_SPEC,
		timing: TIMING_SPEC,
		compileCanary: COMPILE_CANARY_SPEC,
		taskInputs,
	};
	const contractDigest = sha256Json(verifierManifest);
	return {
		verifierEpoch: `${KERNELBENCH_QUALIFICATION_EPOCH_PREFIX}${contractDigest}`,
		contractDigest,
		verifierManifest,
		environmentEvidence: {
			environmentManifest,
			pipFreeze,
			environmentSeal,
			environmentManifestSha256,
			pipFreezeSha256,
			environmentSealSha256,
		},
	};
}

export function kernelBenchQualificationBoundaryConditions(
	contract: KernelBenchQualificationContract,
): readonly string[] {
	return [
		"FarmShare L40S",
		"FP32 with TF32 enabled",
		"qualification only",
		`verifier-epoch:${contract.verifierEpoch}`,
		`verifier-contract-sha256:${contract.contractDigest}`,
	];
}

function parseTask(
	value: unknown,
	index: number,
	expectedBenchmarkId: string,
	topLevelOk: boolean,
	expectedTaskSha256: string,
	expectedHiddenTestSha256: string,
): TaskMeasurement {
	const path = `result.tasks[${index}]`;
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
	if (expectString(task.benchmarkId, `${path}.benchmarkId`) !== expectedBenchmarkId) {
		throw new Error(`Unexpected benchmark at ${path}`);
	}
	const startedAt = expectIsoTimestamp(task.startedAt, `${path}.startedAt`);
	const finishedAt = expectIsoTimestamp(task.finishedAt, `${path}.finishedAt`);
	if (Date.parse(finishedAt) < Date.parse(startedAt)) {
		throw new Error(`Task timestamps are out of order at ${path}`);
	}
	const expectedPaths = QUALIFICATION_PATHS[expectedBenchmarkId as keyof typeof QUALIFICATION_PATHS];
	if (
		expectString(task.taskPath, `${path}.taskPath`) !== expectedPaths.task ||
		expectString(task.hiddenTestPath, `${path}.hiddenTestPath`) !== expectedPaths.hidden
	) {
		throw new Error(`Pinned task path mismatch at ${path}`);
	}
	const errors = expectStringArray(task.errors, `${path}.errors`);
	const status = expectString(task.status, `${path}.status`);
	const failureKind = expectNullableString(task.failureKind, `${path}.failureKind`);
	const metricsRecord = expectRecord(task.metrics, `${path}.metrics`);
	const metrics = numberRecord(task.metrics, `${path}.metrics`);
	if (
		expectSha256(task.taskSha256, `${path}.taskSha256`) !== expectedTaskSha256 ||
		expectSha256(task.hiddenTestSha256, `${path}.hiddenTestSha256`) !== expectedHiddenTestSha256
	) {
		throw new Error(`Task input digest mismatch at ${path}`);
	}
	if (!Array.isArray(task.hiddenConfigs)) throw new Error(`Expected array at ${path}.hiddenConfigs`);

	if (status === "accepted") {
		if (failureKind !== null || errors.length !== 0) {
			throw new Error(`Accepted task has inconsistent envelope at ${path}`);
		}
		if (task.hiddenConfigs.length !== 4) throw new Error(`Expected four hidden configs at ${path}`);
		expectExactKeys(metricsRecord, ACCEPTED_METRIC_KEYS, `${path}.metrics`);
		let runtimeMs = 0;
		const allReferenceSamples: number[] = [];
		const allCandidateSamples: number[] = [];
		const speedups: number[] = [];
		const referencePeaks: number[] = [];
		const candidatePeaks: number[] = [];
		for (let configIndex = 0; configIndex < task.hiddenConfigs.length; configIndex++) {
			const configPath = `${path}.hiddenConfigs[${configIndex}]`;
			const config = expectRecord(task.hiddenConfigs[configIndex], configPath);
			expectExactKeys(
				config,
				[
					"index",
					"candidatePassed",
					"wrongOutputRejected",
					"referenceSamplesMs",
					"candidateSamplesMs",
					"referencePeakMemoryBytes",
					"candidatePeakMemoryBytes",
					"referencePeakDeltaBytes",
					"candidatePeakDeltaBytes",
					"speedup",
				],
				configPath,
			);
			if (expectNumber(config.index, `${configPath}.index`) !== configIndex + 1) {
				throw new Error(`Unexpected hidden config index at ${configPath}`);
			}
			if (!expectBoolean(config.candidatePassed, `${configPath}.candidatePassed`)) {
				throw new Error(`Identity candidate failed at ${configPath}`);
			}
			if (!expectBoolean(config.wrongOutputRejected, `${configPath}.wrongOutputRejected`)) {
				throw new Error(`Wrong-output control was not rejected at ${configPath}`);
			}
			const referenceSamples = expectPositiveSamples(config.referenceSamplesMs, `${configPath}.referenceSamplesMs`);
			const candidateSamples = expectPositiveSamples(config.candidateSamplesMs, `${configPath}.candidateSamplesMs`);
			allReferenceSamples.push(...referenceSamples);
			allCandidateSamples.push(...candidateSamples);
			runtimeMs += [...referenceSamples, ...candidateSamples].reduce((sum, sample) => sum + sample, 0);
			for (const field of [
				"referencePeakMemoryBytes",
				"candidatePeakMemoryBytes",
				"referencePeakDeltaBytes",
				"candidatePeakDeltaBytes",
			] as const) {
				const number = expectNumber(config[field], `${configPath}.${field}`);
				if (number < 0) {
					throw new Error(`Invalid ${field} at ${configPath}`);
				}
			}
			const referencePeak = expectNumber(config.referencePeakMemoryBytes, `${configPath}.referencePeakMemoryBytes`);
			const candidatePeak = expectNumber(config.candidatePeakMemoryBytes, `${configPath}.candidatePeakMemoryBytes`);
			const referenceDelta = expectNumber(config.referencePeakDeltaBytes, `${configPath}.referencePeakDeltaBytes`);
			const candidateDelta = expectNumber(config.candidatePeakDeltaBytes, `${configPath}.candidatePeakDeltaBytes`);
			if (referenceDelta > referencePeak || candidateDelta > candidatePeak) {
				throw new Error(`Peak-memory delta exceeds peak at ${configPath}`);
			}
			const expectedSpeedup = arithmeticMean(referenceSamples) / arithmeticMean(candidateSamples);
			const speedup = expectNumber(config.speedup, `${configPath}.speedup`);
			if (speedup <= 0) throw new Error(`Invalid speedup at ${configPath}`);
			expectClose(speedup, expectedSpeedup, `${configPath}.speedup`);
			speedups.push(expectedSpeedup);
			referencePeaks.push(referencePeak);
			candidatePeaks.push(candidatePeak);
		}
		for (const [metric, expected] of [
			["qualified", 1],
			["hiddenConfigsPassed", 4],
			["wrongOutputsRejected", 4],
		] as const) {
			if (metrics[metric] !== expected) throw new Error(`Invalid ${metric} at ${path}`);
		}
		expectClose(metrics.referenceMeanMs, arithmeticMean(allReferenceSamples), `${path}.metrics.referenceMeanMs`);
		expectClose(metrics.candidateMeanMs, arithmeticMean(allCandidateSamples), `${path}.metrics.candidateMeanMs`);
		expectClose(metrics.speedupGeomean, geometricMean(speedups), `${path}.metrics.speedupGeomean`);
		const expectedFastAtOne = speedups.every((speedup) => speedup > 1) ? 1 : 0;
		if (metrics.fastAtOne !== expectedFastAtOne) throw new Error(`Invalid fastAtOne at ${path}`);
		if (
			metrics.referencePeakMemoryBytes !== Math.max(...referencePeaks) ||
			metrics.candidatePeakMemoryBytes !== Math.max(...candidatePeaks)
		) {
			throw new Error(`Invalid peak-memory aggregate at ${path}`);
		}
		return {
			benchmarkId: expectedBenchmarkId,
			status: "accepted",
			metrics,
			verifier: {
				passed: true,
				checks: [
					"pinned task and hidden-test hashes",
					"four hidden FP32 configurations at atol=rtol=1e-3",
					"trusted wrong-output rejection on every configuration",
					"three warmups and ten preserved raw trials per model and configuration",
				],
				errors: [],
			},
			runtimeMs,
		};
	}

	if (status !== "failed" || topLevelOk || failureKind === null || errors.length === 0) {
		throw new Error(`Failed task has inconsistent envelope at ${path}`);
	}
	if (task.hiddenConfigs.length !== 0) throw new Error(`Failed task must not contain partial timing at ${path}`);
	expectExactKeys(metricsRecord, [], `${path}.metrics`);
	return {
		benchmarkId: expectedBenchmarkId,
		status: failureKind === "candidate" ? "rejected" : "failed",
		metrics,
		verifier: { passed: false, checks: [], errors: [`${failureKind}: ${errors.join("; ")}`] },
		runtimeMs: 0,
	};
}

export function parseKernelBenchQualificationResult(
	raw: string,
	expectation: KernelBenchQualificationExpectation,
): ParsedQualification {
	const {
		contract,
		requestSha256: expectedRequestSha256,
		jobId: expectedJobId,
		slurmJobId: expectedSlurmJobId,
	} = expectation;
	const expectedVerifierManifest = expectRecord(contract.verifierManifest, "expectation.contract.verifierManifest");
	const expectedEvaluatorSha256 = expectSha256(
		expectedVerifierManifest.evaluatorSha256,
		"expectation.contract.verifierManifest.evaluatorSha256",
	);
	const expectedEnvironmentSpecSha256 = expectSha256(
		expectedVerifierManifest.environmentSpecSha256,
		"expectation.contract.verifierManifest.environmentSpecSha256",
	);
	if (
		contract.contractDigest !== sha256Json(expectedVerifierManifest) ||
		contract.verifierEpoch !== `${KERNELBENCH_QUALIFICATION_EPOCH_PREFIX}${contract.contractDigest}`
	) {
		throw new Error("Expected KernelBench verifier contract is internally inconsistent");
	}
	expectSha256(expectedEvaluatorSha256, "expectation.evaluatorSha256");
	expectSha256(expectedEnvironmentSpecSha256, "expectation.environmentSpecSha256");
	expectSha256(expectedRequestSha256, "expectation.requestSha256");
	if (!JOB_ID_PATTERN.test(expectedJobId)) throw new Error(`Invalid expected controller job ID: ${expectedJobId}`);
	if (!/^[0-9]+$/.test(expectedSlurmJobId)) throw new Error(`Invalid expected SLURM job ID: ${expectedSlurmJobId}`);
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(`KernelBench qualification result is not JSON: ${String(error)}`);
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
			"candidateSha256",
			"negativeControlSha256",
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
			"compileCanary",
			"hardware",
			"fatalKind",
			"fatalError",
			"tasks",
		],
		"result",
	);
	if (expectNumber(result.schemaVersion, "result.schemaVersion") !== 1) throw new Error("Unsupported result schema");
	const ok = expectBoolean(result.ok, "result.ok");
	const verifierEpoch = expectString(result.verifierEpoch, "result.verifierEpoch");
	if (expectString(result.jobId, "result.jobId") !== expectedJobId) {
		throw new Error("Qualification result controller job ID mismatch");
	}
	if (expectSha256(result.requestSha256, "result.requestSha256") !== expectedRequestSha256) {
		throw new Error("Qualification request digest mismatch");
	}
	if (expectString(result.checkoutCommit, "result.checkoutCommit") !== KERNELBENCH_VERIFIED_COMMIT) {
		throw new Error("KernelBench checkout commit mismatch");
	}
	const startedAt = expectIsoTimestamp(result.startedAt, "result.startedAt");
	const finishedAt = expectIsoTimestamp(result.finishedAt, "result.finishedAt");
	if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("Qualification timestamps are out of order");
	if (
		expectSha256(result.candidateSha256, "result.candidateSha256") !== sha256Text(KERNELBENCH_QUALIFICATION_CANDIDATE)
	) {
		throw new Error("Qualification candidate digest mismatch");
	}
	if (
		expectSha256(result.negativeControlSha256, "result.negativeControlSha256") !==
		sha256Text(KERNELBENCH_WRONG_OUTPUT_CANDIDATE)
	) {
		throw new Error("Qualification negative-control digest mismatch");
	}
	if (expectSha256(result.evaluatorSha256, "result.evaluatorSha256") !== expectedEvaluatorSha256) {
		throw new Error("Qualification evaluator digest mismatch");
	}
	if (expectSha256(result.environmentSpecSha256, "result.environmentSpecSha256") !== expectedEnvironmentSpecSha256) {
		throw new Error("Qualification environment digest mismatch");
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
		throw new Error("Qualification result does not retain the exact ready environment evidence");
	}
	const verifierManifest = expectRecord(result.verifierManifest, "result.verifierManifest");
	expectExactKeys(
		verifierManifest,
		[
			"schemaVersion",
			"checkoutCommit",
			"evaluatorSha256",
			"environmentSpecSha256",
			"environmentManifestSha256",
			"pipFreezeSha256",
			"environmentSealSha256",
			"candidateSha256",
			"negativeControlSha256",
			"precision",
			"timing",
			"compileCanary",
			"taskInputs",
		],
		"result.verifierManifest",
	);
	if (expectNumber(verifierManifest.schemaVersion, "result.verifierManifest.schemaVersion") !== 1) {
		throw new Error("Unsupported verifier manifest schema");
	}
	for (const [field, expected] of [
		["checkoutCommit", KERNELBENCH_VERIFIED_COMMIT],
		["evaluatorSha256", expectedEvaluatorSha256],
		["environmentSpecSha256", expectedEnvironmentSpecSha256],
		["environmentManifestSha256", environmentManifestSha256],
		["pipFreezeSha256", pipFreezeSha256],
		["environmentSealSha256", environmentSealSha256],
		["candidateSha256", sha256Text(KERNELBENCH_QUALIFICATION_CANDIDATE)],
		["negativeControlSha256", sha256Text(KERNELBENCH_WRONG_OUTPUT_CANDIDATE)],
	] as const) {
		if (expectString(verifierManifest[field], `result.verifierManifest.${field}`) !== expected) {
			throw new Error(`Verifier manifest ${field} mismatch`);
		}
	}
	const expectedEpoch = `${KERNELBENCH_QUALIFICATION_EPOCH_PREFIX}${sha256Json(verifierManifest)}`;
	if (verifierEpoch !== expectedEpoch) throw new Error("Verifier epoch does not bind the verifier manifest");
	if (
		verifierEpoch !== contract.verifierEpoch ||
		sha256Json(verifierManifest) !== contract.contractDigest ||
		sha256Json(verifierManifest) !== sha256Json(expectedVerifierManifest)
	) {
		throw new Error("Qualification result does not match the controller-bound verifier contract");
	}

	const precision = expectRecord(result.precision, "result.precision");
	expectExactKeys(
		precision,
		["dtype", "matmulPrecision", "matmulAllowTf32", "cudnnAllowTf32", "atol", "rtol"],
		"result.precision",
	);
	if (
		expectString(precision.dtype, "result.precision.dtype") !== "float32" ||
		expectString(precision.matmulPrecision, "result.precision.matmulPrecision") !== "high" ||
		!expectBoolean(precision.matmulAllowTf32, "result.precision.matmulAllowTf32") ||
		!expectBoolean(precision.cudnnAllowTf32, "result.precision.cudnnAllowTf32") ||
		expectNumber(precision.atol, "result.precision.atol") !== 1e-3 ||
		expectNumber(precision.rtol, "result.precision.rtol") !== 1e-3
	) {
		throw new Error("Qualification precision contract mismatch");
	}
	const timing = expectRecord(result.timing, "result.timing");
	expectExactKeys(timing, ["warmups", "trials", "unit"], "result.timing");
	if (
		expectNumber(timing.warmups, "result.timing.warmups") !== 3 ||
		expectNumber(timing.trials, "result.timing.trials") !== 10 ||
		expectString(timing.unit, "result.timing.unit") !== "milliseconds"
	) {
		throw new Error("Qualification timing contract mismatch");
	}
	if (
		sha256Json(expectRecord(verifierManifest.precision, "result.verifierManifest.precision")) !==
			sha256Json(precision) ||
		sha256Json(expectRecord(verifierManifest.timing, "result.verifierManifest.timing")) !== sha256Json(timing)
	) {
		throw new Error("Verifier manifest precision or timing mismatch");
	}
	const manifestCompileCanary = expectRecord(verifierManifest.compileCanary, "result.verifierManifest.compileCanary");
	expectExactKeys(manifestCompileCanary, Object.keys(COMPILE_CANARY_SPEC), "result.verifierManifest.compileCanary");
	if (sha256Json(manifestCompileCanary) !== sha256Json(COMPILE_CANARY_SPEC)) {
		throw new Error("Verifier manifest compile-canary contract mismatch");
	}
	const compileCanary = expectRecord(result.compileCanary, "result.compileCanary");
	expectExactKeys(
		compileCanary,
		[...Object.keys(COMPILE_CANARY_SPEC), "passed", "maxAbsError", "error"],
		"result.compileCanary",
	);
	const compileCanarySpec = {
		backend: expectString(compileCanary.backend, "result.compileCanary.backend"),
		fullgraph: expectBoolean(compileCanary.fullgraph, "result.compileCanary.fullgraph"),
		dynamic: expectBoolean(compileCanary.dynamic, "result.compileCanary.dynamic"),
		device: expectString(compileCanary.device, "result.compileCanary.device"),
		dtype: expectString(compileCanary.dtype, "result.compileCanary.dtype"),
		shape: Array.isArray(compileCanary.shape)
			? compileCanary.shape.map((dimension, index) =>
					expectNumber(dimension, `result.compileCanary.shape[${index}]`),
				)
			: null,
	};
	if (compileCanarySpec.shape === null || sha256Json(compileCanarySpec) !== sha256Json(COMPILE_CANARY_SPEC)) {
		throw new Error("Runtime compile-canary contract mismatch");
	}
	const compilePassed = expectBoolean(compileCanary.passed, "result.compileCanary.passed");
	const compileError = expectNullableString(compileCanary.error, "result.compileCanary.error");
	const maxAbsError =
		compileCanary.maxAbsError === null
			? null
			: expectNumber(compileCanary.maxAbsError, "result.compileCanary.maxAbsError");
	if (
		(compilePassed && (compileError !== null || maxAbsError === null || maxAbsError < 0 || maxAbsError > 0.003)) ||
		(!compilePassed && (compileError === null || compileError.length === 0)) ||
		(ok && !compilePassed)
	) {
		throw new Error("Compile-canary result envelope mismatch");
	}

	const hardware = stringHardware(result.hardware);
	if (
		hardware.cluster !== "Stanford FarmShare" ||
		!hardware.hostname ||
		hardware.gpuComputeCapability !== "8.9" ||
		Number(hardware.gpuTotalMemoryBytes) < 40_000_000_000 ||
		!hardware.torchVersion?.startsWith("2.11.0") ||
		hardware.torchCudaVersion !== "12.8" ||
		!hardware.cudaVisibleDevices
	) {
		throw new Error("Qualification hardware or runtime record mismatch");
	}
	if (ok && !hardware.gpuName?.toLowerCase().includes("l40s")) {
		throw new Error(`Qualification did not run on an L40S: ${hardware.gpuName ?? "unknown"}`);
	}
	if (hardware.slurmJobId !== expectedSlurmJobId) {
		throw new Error("Qualification hardware SLURM job ID does not match the durable dispatch");
	}
	const fatalKind = expectNullableString(result.fatalKind, "result.fatalKind");
	const fatalError = expectNullableString(result.fatalError, "result.fatalError");
	if ((ok && (fatalKind !== null || fatalError !== null)) || (!ok && (fatalKind === null || fatalError === null))) {
		throw new Error("Qualification fatal envelope mismatch");
	}
	if (!Array.isArray(result.tasks) || result.tasks.length !== KERNELBENCH_QUALIFICATION_TASKS.length) {
		throw new Error("Qualification result must contain all three tasks");
	}
	const taskInputs = expectRecord(verifierManifest.taskInputs, "result.verifierManifest.taskInputs");
	expectExactKeys(taskInputs, KERNELBENCH_QUALIFICATION_TASKS, "result.verifierManifest.taskInputs");
	const tasks = result.tasks.map((task, index) => {
		const benchmarkId = KERNELBENCH_QUALIFICATION_TASKS[index];
		const hashes = expectRecord(taskInputs[benchmarkId], `result.verifierManifest.taskInputs.${benchmarkId}`);
		expectExactKeys(hashes, ["taskSha256", "hiddenTestSha256"], `result.verifierManifest.taskInputs.${benchmarkId}`);
		const expectedPaths = QUALIFICATION_PATHS[benchmarkId];
		const taskSha256 = expectSha256(
			hashes.taskSha256,
			`result.verifierManifest.taskInputs.${benchmarkId}.taskSha256`,
		);
		const hiddenTestSha256 = expectSha256(
			hashes.hiddenTestSha256,
			`result.verifierManifest.taskInputs.${benchmarkId}.hiddenTestSha256`,
		);
		if (taskSha256 !== expectedPaths.taskSha256 || hiddenTestSha256 !== expectedPaths.hiddenTestSha256) {
			throw new Error(`Pinned input digest mismatch for ${benchmarkId}`);
		}
		return parseTask(task, index, benchmarkId, ok, taskSha256, hiddenTestSha256);
	});
	const allTasksAccepted = tasks.every((task) => task.status === "accepted");
	if (ok !== allTasksAccepted) {
		throw new Error("Qualification ok flag does not match the complete task envelope");
	}
	return {
		ok,
		outcome: {
			verifierEpoch,
			tasks,
			hardware,
			provenance: {
				adapter: "farmshare-kernelbench-qualification",
				kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
				evaluatorSha256: expectedEvaluatorSha256,
				environmentSpecSha256: expectedEnvironmentSpecSha256,
				environmentManifestSha256,
				pipFreezeSha256,
				environmentSealSha256,
				requestSha256: expectedRequestSha256,
				controllerJobId: expectedJobId,
				slurmJobId: expectedSlurmJobId,
				candidateSha256: sha256Text(KERNELBENCH_QUALIFICATION_CANDIDATE),
				negativeControlSha256: sha256Text(KERNELBENCH_WRONG_OUTPUT_CANDIDATE),
				precision: "fp32-tf32-enabled-atol-rtol-1e-3",
				compileCanary: "torch.compile-inductor-fullgraph-cuda",
				rawTimingSamples: "preserved-in-stdout-artifact",
			},
			stdout: raw,
			stderr: fatalError ?? undefined,
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

export const KERNELBENCH_BOOTSTRAP_REMOTE = String.raw`
import base64, hashlib, json, os, pathlib, re, subprocess, sys
root = pathlib.Path(sys.argv[1])
payload = json.load(sys.stdin)
script = base64.b64decode(payload["bootstrapScript"], validate=True)
environment = base64.b64decode(payload["environmentSpec"], validate=True)
asset_digest = hashlib.sha256(script + b"\0" + environment).hexdigest()
if not re.fullmatch(r"[a-f0-9]{64}", asset_digest):
    raise SystemExit("invalid bootstrap asset digest")
asset_root = root / "bootstrap" / asset_digest
asset_root.mkdir(parents=True, exist_ok=True, mode=0o700)
for name, content, mode in (("bootstrap-kernelbench.sh", script, 0o500), ("kernelbench-environment.lock", environment, 0o400)):
    path = asset_root / name
    if path.exists():
        if path.read_bytes() != content:
            raise SystemExit(f"immutable bootstrap asset mismatch: {path}")
        continue
    temporary = asset_root / f".{name}.tmp.{os.getpid()}"
    temporary.write_bytes(content)
    os.chmod(temporary, mode)
    os.replace(temporary, path)
completed = subprocess.run(["bash", str(asset_root / "bootstrap-kernelbench.sh"), str(root)], check=False, capture_output=True, text=True)
sys.stdout.write(completed.stdout)
sys.stderr.write(completed.stderr)
raise SystemExit(completed.returncode)
`;

export const KERNELBENCH_READINESS_REMOTE = `
import hashlib, json, os, pathlib, subprocess, sys
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
    raise SystemExit("KernelBench bootstrap/readiness missing: " + ", ".join(missing))
if (checkout / "READY").read_text(encoding="utf-8").strip() != commit:
    raise SystemExit("KernelBench checkout READY mismatch")
if (environment / "READY").read_text(encoding="utf-8").strip() != environment_digest:
    raise SystemExit("KernelBench environment READY mismatch")
revision = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"], check=True, capture_output=True, text=True).stdout.strip()
if revision != commit or dirty:
    raise SystemExit("KernelBench checkout is not the clean pinned revision")
paths = {
    "level1/1": ("KernelBench/level1/1_Square_matrix_multiplication_.py", "hidden_tests/level1/1_hidden.py"),
    "level2/2": ("KernelBench/level2/2_ConvTranspose2d_BiasAdd_Clamp_Scaling_Clamp_Divide.py", "hidden_tests/level2/2_hidden.py"),
    "level3/1": ("KernelBench/level3/1_MLP.py", "hidden_tests/level3/1_hidden.py"),
}
def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
task_inputs = {
    task_id: {"taskSha256": sha256(checkout / task_path), "hiddenTestSha256": sha256(checkout / hidden_path)}
    for task_id, (task_path, hidden_path) in paths.items()
}
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
    "taskInputs": task_inputs,
    "runtime": runtime,
}, sort_keys=True))
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

export const KERNELBENCH_ENSURE_SUBMITTED_REMOTE = String.raw`
import datetime, fcntl, getpass, json, os, pathlib, re, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
job_name = sys.argv[2]
grace_seconds = float(sys.argv[3])
now = float(sys.argv[4]) if len(sys.argv) > 4 else time.time()
root.mkdir(parents=True, exist_ok=True, mode=0o700)
lock = open(root / "dispatch.lock", "a+")
fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
id_path = root / "slurm-job-id"
intent_path = root / "dispatch-intent.json"
def atomic_json(path, value):
    temporary = root / f".{path.name}.tmp.{os.getpid()}"
    temporary.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
def persist(job_id):
    if not re.fullmatch(r"[0-9]+", job_id):
        raise SystemExit(f"invalid SLURM job id: {job_id}")
    temporary = root / f".slurm-job-id.tmp.{os.getpid()}"
    temporary.write_text(job_id + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, id_path)
    dispatch = {"slurmJobId": job_id, "jobName": job_name, "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    atomic_json(root / "dispatch.json", dispatch)
    return job_id
def checked(command, cwd=None):
    completed = subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        sys.stdout.write(completed.stdout)
        sys.stderr.write(completed.stderr)
        raise SystemExit(completed.returncode)
    return completed
if id_path.exists():
    job_id = id_path.read_text(encoding="utf-8").strip()
    print(json.dumps({"kind": "submitted", "slurmJobId": job_id}, sort_keys=True))
    raise SystemExit(0)
if intent_path.exists():
    intent = json.loads(intent_path.read_text(encoding="utf-8"))
    if intent.get("jobName") != job_name:
        raise SystemExit("dispatch intent job name mismatch")
else:
    intent = None
matches = set()
user = getpass.getuser()
queued = checked(["squeue", "--noheader", "--user", user, "--name", job_name, "--format=%A|%j|%Z"])
for line in queued.stdout.splitlines():
    parts = line.strip().split("|", 2)
    if len(parts) == 3 and parts[1] == job_name and parts[2] == str(root) and re.fullmatch(r"[0-9]+", parts[0]):
        matches.add(parts[0])
accounted = checked(["sacct", "--noheader", "-X", "--user", user, "--name", job_name, "--starttime", "now-7days", "--format=JobIDRaw,JobName,WorkDir", "--parsable2"])
for line in accounted.stdout.splitlines():
    parts = line.strip().split("|", 2)
    if len(parts) == 3 and parts[1] == job_name and parts[2] == str(root) and re.fullmatch(r"[0-9]+", parts[0]):
        matches.add(parts[0])
if len(matches) > 1:
    raise SystemExit(f"duplicate scheduler jobs for {job_name}: {sorted(matches)}")
if matches:
    job_id = persist(next(iter(matches)))
    print(json.dumps({"kind": "submitted", "slurmJobId": job_id}, sort_keys=True))
    raise SystemExit(0)
if intent is not None:
    last_attempt = intent.get("lastAttemptAtEpoch")
    if isinstance(last_attempt, (int, float)) and now - last_attempt < grace_seconds:
        remaining_ms = max(1, int((grace_seconds - (now - last_attempt)) * 1000))
        print(json.dumps({"kind": "reconciling", "retryAfterMs": remaining_ms}, sort_keys=True))
        raise SystemExit(0)
    print(json.dumps({"kind": "ambiguous", "reason": "dispatch intent exists but no durable job id or scheduler record is visible; refusing automatic resubmission"}, sort_keys=True))
    raise SystemExit(0)
intent = {"schemaVersion": 1, "jobName": job_name, "createdAtEpoch": now, "lastAttemptAtEpoch": now, "submissionAttempts": 1}
atomic_json(intent_path, intent)
submitted = checked(["sbatch", "--parsable", "--job-name", job_name, str(root / "job.sh")], cwd=root)
job_id = persist(submitted.stdout.strip().split(";", 1)[0])
print(json.dumps({"kind": "submitted", "slurmJobId": job_id}, sort_keys=True))
`;

export const KERNELBENCH_CANCEL_REMOTE = `
import getpass, json, pathlib, re, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
job_id = sys.argv[2]
if not re.fullmatch(r"[0-9]+", job_id):
    raise SystemExit("invalid SLURM job id")
id_path = root / "slurm-job-id"
if not id_path.exists() or id_path.read_text(encoding="utf-8").strip() != job_id:
    raise SystemExit("durable SLURM job id mismatch during cancellation")
user = getpass.getuser()
def queued_rows():
    result = subprocess.run(["squeue", "--noheader", "--user", user, "--jobs", job_id, "--format=%A|%u|%Z"], check=True, capture_output=True, text=True)
    return [line.strip().split("|", 2) for line in result.stdout.splitlines() if line.strip()]
rows = queued_rows()
for row in rows:
    if len(row) != 3 or row[0] != job_id or row[1] != user or row[2] != str(root):
        raise SystemExit("refusing to cancel a SLURM job outside the durable user/workdir scope")
if rows:
    subprocess.run(["scancel", job_id], check=True, capture_output=True, text=True)
for _ in range(10):
    if not queued_rows():
        accounted = subprocess.run(["sacct", "--noheader", "-X", "--user", user, "--jobs", job_id, "--format=State,WorkDir", "--parsable2"], check=True, capture_output=True, text=True)
        print(json.dumps({"verifiedAbsent": True, "accounting": accounted.stdout.strip()}, sort_keys=True))
        raise SystemExit(0)
    time.sleep(1)
raise SystemExit("SLURM job remained queued after cancellation")
`;

const POLL_REMOTE = `
import json, pathlib, subprocess, sys
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

export function formatFarmShareCommandFailure(result: Readonly<ProcessResult>): string {
	return [
		`FarmShare command failed (exit ${result.exitCode ?? "signal"})`,
		`stdout:\n${result.stdout || "<empty>"}`,
		`stderr:\n${result.stderr || "<empty>"}`,
	].join("\n");
}

function isTransientFarmShareCommandFailure(result: Readonly<ProcessResult>): boolean {
	if (result.exitCode === 255 || result.exitCode === null) return true;
	return /\b(?:squeue|sacct|sbatch|scancel|slurmctld|slurmdbd)\b|connection (?:closed|refused|reset)|timed? out|temporary failure/i.test(
		`${result.stdout}\n${result.stderr}`,
	);
}

class SshKernelBenchQualificationTransport implements KernelBenchQualificationTransport {
	constructor(private readonly config: KernelBenchQualificationConfig) {}

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
			const message = formatFarmShareCommandFailure(result);
			if (isTransientFarmShareCommandFailure(result)) throw new KernelBenchTransientTransportError(message);
			throw new Error(message);
		}
		return result;
	}

	async bootstrap(remoteRoot: string, assets: KernelBenchBootstrapAssets, signal: AbortSignal): Promise<void> {
		const payload = JSON.stringify({
			bootstrapScript: Buffer.from(assets.bootstrapScript).toString("base64"),
			environmentSpec: Buffer.from(assets.environmentSpec).toString("base64"),
		});
		await this.remotePython(KERNELBENCH_BOOTSTRAP_REMOTE, [remoteRoot], payload, signal, 1_800_000);
	}

	async readiness(
		remoteRoot: string,
		checkoutCommit: string,
		environmentSpecSha256: string,
		signal: AbortSignal,
	): Promise<string> {
		const result = await this.remotePython(
			KERNELBENCH_READINESS_REMOTE,
			[remoteRoot, checkoutCommit, environmentSpecSha256],
			undefined,
			signal,
		);
		return result.stdout;
	}

	async prepare(remoteJobDir: string, assets: KernelBenchRemoteAssets, signal: AbortSignal): Promise<void> {
		const payload = JSON.stringify({
			"request.json": Buffer.from(assets.requestJson).toString("base64"),
			"evaluator.py": Buffer.from(assets.evaluatorSource).toString("base64"),
			"job.sh": Buffer.from(assets.jobScript).toString("base64"),
		});
		await this.remotePython(PREPARE_REMOTE, [remoteJobDir], payload, signal);
	}

	async ensureSubmitted(remoteJobDir: string, jobName: string, signal: AbortSignal): Promise<KernelBenchDispatch> {
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
			if (kind === "ambiguous") {
				throw new Error(expectString(parsed.reason, "dispatch.reason"));
			}
			if (kind !== "reconciling") throw new Error(`Unknown dispatch result: ${kind}`);
			const retryAfterMs = expectNumber(parsed.retryAfterMs, "dispatch.retryAfterMs");
			await delay(Math.max(1, Math.min(retryAfterMs, this.config.pollIntervalMs)), signal);
		}
	}

	async poll(remoteJobDir: string, signal: AbortSignal): Promise<KernelBenchRemotePoll> {
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
		verifierEpoch: "kernelbench-qualification-adapter-error-v1",
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

export function buildKernelBenchQualificationJobScript(
	config: KernelBenchQualificationConfig,
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
#SBATCH --job-name=prime-kbv-qualification
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

export function parseKernelBenchQualificationHandle(handle: string, remoteRoot: string): string {
	if (!handle.startsWith(HANDLE_PREFIX)) throw new Error(`Invalid KernelBench qualification handle: ${handle}`);
	const remoteJobDir = handle.slice(HANDLE_PREFIX.length);
	validateAbsolutePath(remoteRoot, "remote root");
	validateAbsolutePath(remoteJobDir, "remote job directory");
	if (!remoteJobDir.startsWith(`${remoteRoot}/jobs/`)) {
		throw new Error(`Qualification handle is outside the configured remote root: ${handle}`);
	}
	const jobId = remoteJobDir.slice(`${remoteRoot}/jobs/`.length);
	if (!JOB_ID_PATTERN.test(jobId) || remoteJobDir !== `${remoteRoot}/jobs/${jobId}`) {
		throw new Error(`Invalid job directory in qualification handle: ${handle}`);
	}
	return remoteJobDir;
}

export class KernelBenchQualificationAdapter implements EvaluationAdapter {
	readonly lane = "kernelbench" as const;
	private readonly transport: KernelBenchQualificationTransport;

	constructor(
		private readonly config: KernelBenchQualificationConfig = DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
		transport?: KernelBenchQualificationTransport,
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
		this.transport = transport ?? new SshKernelBenchQualificationTransport(config);
	}

	private async readVerifierSources(): Promise<{
		evaluatorSource: string;
		environmentSpec: string;
		evaluatorSha256: string;
		environmentSpecSha256: string;
	}> {
		const evaluatorPath = fileURLToPath(new URL("../evaluators/kernelbench_qualify.py", import.meta.url));
		const environmentPath = fileURLToPath(new URL("../farmshare/kernelbench-environment.lock", import.meta.url));
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(evaluatorPath, "utf8"),
			readFile(environmentPath, "utf8"),
		]);
		return {
			evaluatorSource,
			environmentSpec,
			evaluatorSha256: sha256Text(evaluatorSource),
			environmentSpecSha256: sha256Text(environmentSpec),
		};
	}

	async requireReady(signal: AbortSignal): Promise<KernelBenchQualificationContract> {
		const sources = await this.readVerifierSources();
		const raw = await this.transport.readiness(
			this.config.remoteRoot,
			KERNELBENCH_VERIFIED_COMMIT,
			sources.environmentSpecSha256,
			signal,
		);
		return parseKernelBenchQualificationReadiness(raw, sources.evaluatorSha256, sources.environmentSpecSha256);
	}

	async bootstrap(signal: AbortSignal): Promise<KernelBenchQualificationContract> {
		const bootstrapPath = fileURLToPath(new URL("../farmshare/bootstrap-kernelbench.sh", import.meta.url));
		const [{ environmentSpec }, bootstrapScript] = await Promise.all([
			this.readVerifierSources(),
			readFile(bootstrapPath, "utf8"),
		]);
		await this.transport.bootstrap(this.config.remoteRoot, { bootstrapScript, environmentSpec }, signal);
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

	private validateJob(job: EvaluationJob): void {
		if (job.lane !== "kernelbench") throw new Error(`Unexpected lane: ${job.lane}`);
		if (!JOB_ID_PATTERN.test(job.jobId)) throw new Error(`Invalid controller job ID: ${job.jobId}`);
		if (
			job.benchmarkIds.length !== KERNELBENCH_QUALIFICATION_TASKS.length ||
			job.benchmarkIds.some((task, index) => task !== KERNELBENCH_QUALIFICATION_TASKS[index])
		) {
			throw new Error("KernelBench qualification requires the exact frozen three-task panel");
		}
		if (
			job.candidateFormat !== "python-source" ||
			job.candidateContent.trim() !== KERNELBENCH_QUALIFICATION_CANDIDATE
		) {
			throw new Error("KernelBench qualification only accepts the trusted `ModelNew = Model` candidate");
		}
	}

	private async prepare(job: EvaluationJob, signal: AbortSignal): Promise<PreparedQualification> {
		this.validateJob(job);
		const { evaluatorSource, evaluatorSha256, environmentSpecSha256 } = await this.readVerifierSources();
		const readinessRaw = await this.transport.readiness(
			this.config.remoteRoot,
			KERNELBENCH_VERIFIED_COMMIT,
			environmentSpecSha256,
			signal,
		);
		const contract = parseKernelBenchQualificationReadiness(readinessRaw, evaluatorSha256, environmentSpecSha256);
		const expectedBoundaryConditions = kernelBenchQualificationBoundaryConditions(contract);
		if (
			job.proposal.boundaryConditions.length !== expectedBoundaryConditions.length ||
			job.proposal.boundaryConditions.some((condition, index) => condition !== expectedBoundaryConditions[index])
		) {
			throw new Error("KernelBench controller proposal is not bound to the ready verifier epoch");
		}
		const remoteJobDir = `${this.config.remoteRoot}/jobs/${job.jobId}`;
		const handle = `${HANDLE_PREFIX}${remoteJobDir}`;
		const checkoutDir = `${this.config.remoteRoot}/repos/${KERNELBENCH_VERIFIED_COMMIT}`;
		const pythonPath = `${this.config.remoteRoot}/envs/${environmentSpecSha256}/bin/python`;
		const requestJson = `${JSON.stringify({
			schemaVersion: 1,
			jobId: job.jobId,
			taskIds: KERNELBENCH_QUALIFICATION_TASKS,
			candidateSource: KERNELBENCH_QUALIFICATION_CANDIDATE,
			checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
			environmentSpecSha256,
			expectedVerifierEpoch: contract.verifierEpoch,
			verifierContractDigest: contract.contractDigest,
		})}\n`;
		const requestSha256 = sha256Text(requestJson);
		return {
			remoteJobDir,
			handle,
			jobName: `pkbv-${sha256Text(job.jobId).slice(0, 20)}`,
			evaluatorSha256,
			environmentSpecSha256,
			requestSha256,
			contract,
			assets: {
				requestJson,
				evaluatorSource,
				jobScript: buildKernelBenchQualificationJobScript(this.config, remoteJobDir, checkoutDir, pythonPath),
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
			adapter: "farmshare-kernelbench-qualification",
			remoteHandle: prepared.handle,
			remoteJobDir: prepared.remoteJobDir,
			slurmJobId: dispatch.slurmJobId,
			kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
			evaluatorSha256: prepared.evaluatorSha256,
			environmentSpecSha256: prepared.environmentSpecSha256,
			requestSha256: prepared.requestSha256,
			verifierEpoch: prepared.contract.verifierEpoch,
			verifierContractDigest: prepared.contract.contractDigest,
		};
		while (Date.now() <= deadline) {
			let poll: KernelBenchRemotePoll;
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
					const parsed = parseKernelBenchQualificationResult(poll.rawResult, {
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
						`Invalid durable KernelBench result: ${error instanceof Error ? error.message : String(error)}`,
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
			`Timed out waiting for durable KernelBench result after ${this.config.requestTimeoutMs}ms; SLURM cancellation verified`,
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
		const remoteJobDir = parseKernelBenchQualificationHandle(externalJobId, this.config.remoteRoot);
		if (remoteJobDir !== prepared.remoteJobDir || externalJobId !== prepared.handle) {
			throw new Error(`External handle does not belong to ${job.jobId}`);
		}
		return this.reconcile(job, prepared, context.signal);
	}
}

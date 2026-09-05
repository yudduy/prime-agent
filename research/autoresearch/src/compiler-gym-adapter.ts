import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import type {
	CompilerGymWarmCleanupVerification,
	CompilerGymWarmEvaluationResult,
	CompilerGymWarmTransport,
} from "./compiler-gym-warm-transport.js";
import { COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256 } from "./compiler-gym-warm-transport.js";
import type {
	DeterministicMeasurementReuseContract,
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	TaskMeasurement,
} from "./types.js";

export interface CompilerGymProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	wallMs: number;
}

interface CompilerGymResult {
	schemaVersion?: number;
	contract?: string;
	ok: boolean;
	status: string;
	benchmark?: string;
	metrics?: {
		final?: {
			IrInstructionCount?: number;
			ObjectTextSizeBytes?: number;
		};
	};
	validation?: {
		passed?: boolean;
		inputsCompleted?: number;
		semanticErrors?: unknown[];
	};
	timingsSeconds?: { total?: number };
	provenance?: {
		upstreamCbenchSourceSha256?: string;
		cbenchPatchSha256?: string;
		pinnedInstalledCbenchSourceSha256?: string;
		installedCbenchSourceSha256?: string;
		installedCbenchSourceMatchesPin?: boolean;
		farmShareEnvironmentSealPassed?: boolean;
	};
	environmentSeal?: {
		pythonVersion?: string;
		distributionManifestSha256?: string;
		compatibilityTreeManifestSha256?: string;
		libtinfoSha256?: string;
	};
	error?: { code?: string; message?: string; phase?: string };
}

interface PreparedCompilerGymEvaluator {
	remotePath: string;
	evaluatorDigest: string;
	environmentSpecDigest: string;
	patchDigest: string;
}

export interface FarmShareCompilerGymConfig {
	host: string;
	partition: string;
	cpuConstraint: string;
	pythonPath: string;
	remoteEvaluatorDir: string;
	compilerGymCache: string;
	compilerGymSiteData: string;
	compatibilityLibraryDir: string;
	maxParallelTasks: number;
	timeLimit: string;
	memory: string;
	requestTimeoutMs: number;
}

export interface FarmShareCompilerGymAdapterOptions {
	warmTransport?: CompilerGymWarmTransport;
}

export const DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG: FarmShareCompilerGymConfig = {
	host: "farmshare",
	partition: "normal",
	cpuConstraint: "CPU_SKU:9384X",
	pythonPath: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-venv/bin/python",
	remoteEvaluatorDir: "/scratch/users/duynguy/prime-autoresearch/evaluators",
	compilerGymCache: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache",
	compilerGymSiteData: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-site",
	compatibilityLibraryDir: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib",
	maxParallelTasks: 4,
	timeLimit: "00:05:00",
	memory: "8G",
	requestTimeoutMs: 360_000,
};

function hasPinnedReuseEnvironment(config: FarmShareCompilerGymConfig): boolean {
	const pinnedFields: Array<Exclude<keyof FarmShareCompilerGymConfig, "maxParallelTasks">> = [
		"host",
		"partition",
		"cpuConstraint",
		"pythonPath",
		"remoteEvaluatorDir",
		"compilerGymCache",
		"compilerGymSiteData",
		"compatibilityLibraryDir",
		"timeLimit",
		"memory",
		"requestTimeoutMs",
	];
	return pinnedFields.every((field) => config[field] === DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG[field]);
}

export const COMPILER_GYM_VERIFIER_EPOCH = "compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2" as const;
export const COMPILER_GYM_EVALUATOR_SHA256 =
	"1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266" as const;
export const COMPILER_GYM_UPSTREAM_CBENCH_SHA256 =
	"e6337c70f9a3e83abc8f54d9b4193e7ba51fe853a555fa78e472b2fc87920d88" as const;
export const COMPILER_GYM_CBENCH_PATCH_SHA256 =
	"259956ea61364336dbc3e326cd27c7b6a0342fadbeba32b6c29da7024a4ccc00" as const;
export const COMPILER_GYM_ENVIRONMENT_SPEC_SHA256 =
	"a1daa0f10fcfe93fa7cb7e063715b51bd381c46fc156725d229bbfef7c386c10" as const;
export const COMPILER_GYM_INSTALLED_CBENCH_SHA256 =
	"6e38fd10d4bfd7816dbe6f959ff8ae97a3c10ab94cadde883926d83c0db521ed" as const;
export const COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256 =
	"4b84dea7461512ef8fdadb99a992066484119fc91b7d8f0d3b33b5598fa870dd" as const;
export const COMPILER_GYM_COMPATIBILITY_TREE_SHA256 =
	"c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1" as const;
export const COMPILER_GYM_LIBTINFO_SHA256 = "d82654b2615eb347e8f15a63862c9234f452187250b75d36dce8bd964541f02e" as const;

const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;

function validateRemoteToken(value: string, name: string, allowSlash: boolean): void {
	const pattern = allowSlash ? /^\/[A-Za-z0-9._/-]+$/ : /^[A-Za-z0-9._:-]+$/;
	if (!pattern.test(value)) throw new Error(`Unsafe ${name}: ${value}`);
}

function runProcess(
	command: string,
	args: readonly string[],
	input: string | undefined,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<CompilerGymProcessResult> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], signal });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
		}, timeoutMs);

		const append = (target: Buffer[], chunk: Buffer): void => {
			outputBytes += chunk.byteLength;
			if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
				child.kill("SIGTERM");
				return;
			}
			target.push(chunk);
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
				wallMs: Date.now() - startedAt,
			});
		});
		if (input === undefined) child.stdin.end();
		else child.stdin.end(input, "utf8");
	});
}

function parseActions(content: string): string[] {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		throw new Error("CompilerGym candidate content must be a JSON array of LLVM pass flags");
	}
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error("CompilerGym candidate content must be a JSON string array");
	}
	if (value.length > 256) throw new Error("CompilerGym candidates may contain at most 256 passes");
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCompilerGymResult(stdout: string): CompilerGymResult {
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length !== 1) throw new Error(`Expected one evaluator JSON line, received ${lines.length}`);
	const value: unknown = JSON.parse(lines[0]);
	if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.status !== "string") {
		throw new Error("Evaluator returned an invalid result envelope");
	}
	const result: CompilerGymResult = {
		ok: value.ok,
		status: value.status,
		schemaVersion: typeof value.schema_version === "number" ? value.schema_version : undefined,
		contract: typeof value.contract === "string" ? value.contract : undefined,
	};
	if (typeof value.benchmark === "string") result.benchmark = value.benchmark;
	if (isRecord(value.metrics) && isRecord(value.metrics.final)) {
		result.metrics = {
			final: {
				IrInstructionCount:
					typeof value.metrics.final.IrInstructionCount === "number"
						? value.metrics.final.IrInstructionCount
						: undefined,
				ObjectTextSizeBytes:
					typeof value.metrics.final.ObjectTextSizeBytes === "number"
						? value.metrics.final.ObjectTextSizeBytes
						: undefined,
			},
		};
	}
	if (isRecord(value.validation)) {
		result.validation = {
			passed: typeof value.validation.passed === "boolean" ? value.validation.passed : undefined,
			inputsCompleted:
				typeof value.validation.inputs_completed === "number" ? value.validation.inputs_completed : undefined,
			semanticErrors: Array.isArray(value.validation.semantic_errors) ? value.validation.semantic_errors : undefined,
		};
	}
	if (isRecord(value.timings_seconds)) {
		result.timingsSeconds = {
			total: typeof value.timings_seconds.total === "number" ? value.timings_seconds.total : undefined,
		};
	}
	if (isRecord(value.provenance)) {
		result.provenance = {
			upstreamCbenchSourceSha256:
				typeof value.provenance.upstream_cbench_source_sha256 === "string"
					? value.provenance.upstream_cbench_source_sha256
					: undefined,
			cbenchPatchSha256:
				typeof value.provenance.cbench_patch_sha256 === "string" ? value.provenance.cbench_patch_sha256 : undefined,
			pinnedInstalledCbenchSourceSha256:
				typeof value.provenance.pinned_installed_cbench_source_sha256 === "string"
					? value.provenance.pinned_installed_cbench_source_sha256
					: undefined,
			installedCbenchSourceSha256:
				typeof value.provenance.installed_cbench_source_sha256 === "string"
					? value.provenance.installed_cbench_source_sha256
					: undefined,
			installedCbenchSourceMatchesPin:
				typeof value.provenance.installed_cbench_source_matches_pin === "boolean"
					? value.provenance.installed_cbench_source_matches_pin
					: undefined,
			farmShareEnvironmentSealPassed:
				typeof value.provenance.farmshare_environment_seal_passed === "boolean"
					? value.provenance.farmshare_environment_seal_passed
					: undefined,
		};
	}
	if (isRecord(value.environment) && isRecord(value.environment.seal)) {
		result.environmentSeal = {
			pythonVersion:
				typeof value.environment.seal.python_version === "string"
					? value.environment.seal.python_version
					: undefined,
			distributionManifestSha256:
				typeof value.environment.seal.distribution_manifest_sha256 === "string"
					? value.environment.seal.distribution_manifest_sha256
					: undefined,
			compatibilityTreeManifestSha256:
				typeof value.environment.seal.compatibility_tree_manifest_sha256 === "string"
					? value.environment.seal.compatibility_tree_manifest_sha256
					: undefined,
			libtinfoSha256:
				typeof value.environment.seal.libtinfo_sha256 === "string"
					? value.environment.seal.libtinfo_sha256
					: undefined,
		};
	}
	if (isRecord(value.error)) {
		result.error = {
			code: typeof value.error.code === "string" ? value.error.code : undefined,
			message: typeof value.error.message === "string" ? value.error.message : undefined,
			phase: typeof value.error.phase === "string" ? value.error.phase : undefined,
		};
	}
	return result;
}

function resultErrors(result: CompilerGymResult): string[] {
	const errors = compilerGymIntegrityErrors(result);
	if (result.error) {
		errors.push([result.error.code, result.error.phase, result.error.message].filter(Boolean).join(": "));
	}
	const semanticErrors = result.validation?.semanticErrors ?? [];
	for (const error of semanticErrors.slice(0, 20)) errors.push(JSON.stringify(error));
	return errors;
}

function compilerGymIntegrityErrors(result: CompilerGymResult): string[] {
	const errors: string[] = [];
	const requireEqual = (label: string, observed: unknown, expected: unknown): void => {
		if (observed !== expected)
			errors.push(`${label} mismatch: expected ${String(expected)}, received ${String(observed)}`);
	};
	requireEqual("schema version", result.schemaVersion, 2);
	requireEqual("verifier contract", result.contract, COMPILER_GYM_VERIFIER_EPOCH);
	requireEqual(
		"upstream cBench source hash",
		result.provenance?.upstreamCbenchSourceSha256,
		COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	);
	requireEqual("cBench patch hash", result.provenance?.cbenchPatchSha256, COMPILER_GYM_CBENCH_PATCH_SHA256);
	requireEqual(
		"pinned installed cBench source hash",
		result.provenance?.pinnedInstalledCbenchSourceSha256,
		COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	);
	requireEqual(
		"installed cBench source hash",
		result.provenance?.installedCbenchSourceSha256,
		COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	);
	requireEqual("installed cBench source gate", result.provenance?.installedCbenchSourceMatchesPin, true);
	requireEqual("FarmShare environment gate", result.provenance?.farmShareEnvironmentSealPassed, true);
	requireEqual("Python version", result.environmentSeal?.pythonVersion, "3.10.19");
	requireEqual(
		"distribution manifest hash",
		result.environmentSeal?.distributionManifestSha256,
		COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	);
	requireEqual(
		"compatibility tree hash",
		result.environmentSeal?.compatibilityTreeManifestSha256,
		COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	);
	requireEqual("libtinfo hash", result.environmentSeal?.libtinfoSha256, COMPILER_GYM_LIBTINFO_SHA256);
	return errors;
}

export function assessCompilerGymTaskProcess(
	benchmarkId: string,
	processResult: CompilerGymProcessResult,
	timingScope: "cold-allocation" | "warm-child" = "cold-allocation",
): TaskMeasurement {
	const wallMetrics: Record<string, number> =
		timingScope === "warm-child"
			? { evaluatorProcessWallMs: processResult.wallMs }
			: { schedulerAndEvaluatorWallMs: processResult.wallMs };
	let parsed: CompilerGymResult;
	try {
		parsed = parseCompilerGymResult(processResult.stdout);
	} catch (error) {
		return {
			benchmarkId,
			status: "failed",
			metrics: wallMetrics,
			verifier: {
				passed: false,
				checks: [],
				errors: [error instanceof Error ? error.message : String(error)],
			},
			runtimeMs: processResult.wallMs,
		};
	}

	const evaluatorRuntimeMs = (parsed.timingsSeconds?.total ?? 0) * 1000;
	const metrics: Record<string, number> = { ...wallMetrics, evaluatorRuntimeMs };
	if (timingScope === "warm-child") {
		metrics.evaluatorWrapperOverheadMs = Math.max(0, processResult.wallMs - evaluatorRuntimeMs);
	} else {
		metrics.queueAndTransportMs = Math.max(0, processResult.wallMs - evaluatorRuntimeMs);
	}
	const irCount = parsed.metrics?.final?.IrInstructionCount;
	const objectTextSize = parsed.metrics?.final?.ObjectTextSizeBytes;
	if (irCount !== undefined) metrics.IrInstructionCount = irCount;
	if (objectTextSize !== undefined) metrics.ObjectTextSizeBytes = objectTextSize;
	const integrityErrors = compilerGymIntegrityErrors(parsed);
	const requiredMetricsAreSane =
		Number.isSafeInteger(irCount) &&
		(irCount ?? -1) >= 0 &&
		Number.isSafeInteger(objectTextSize) &&
		(objectTextSize ?? -1) >= 0;
	const passed =
		processResult.exitCode === 0 &&
		parsed.ok &&
		integrityErrors.length === 0 &&
		parsed.benchmark === benchmarkId &&
		parsed.validation?.passed === true &&
		parsed.validation.inputsCompleted === 20 &&
		requiredMetricsAreSane;
	const rejected =
		processResult.exitCode === 5 &&
		parsed.status === "semantic_validation_failed" &&
		parsed.ok === false &&
		integrityErrors.length === 0 &&
		parsed.benchmark === benchmarkId &&
		parsed.validation?.passed === false &&
		parsed.validation.inputsCompleted === 20 &&
		(parsed.validation.semanticErrors?.length ?? 0) > 0 &&
		requiredMetricsAreSane;
	return {
		benchmarkId,
		status: passed ? "accepted" : rejected ? "rejected" : "failed",
		metrics,
		verifier: {
			passed,
			checks: [
				"farmshare-environment-seal-v2",
				"pinned-cbench-patch-and-source",
				"pinned-action-space",
				"raw-metrics",
				"20-base-semantic-callbacks",
			],
			errors: passed ? [] : resultErrors(parsed),
		},
		runtimeMs: processResult.wallMs,
	};
}

export class FarmShareCompilerGymAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	readonly deterministicMeasurementReuse?: DeterministicMeasurementReuseContract;
	private readonly measurementHardware: Record<string, string>;
	private readonly measurementProvenance: Record<string, string>;
	private readonly warmTransport: CompilerGymWarmTransport | undefined;
	private prepareOperation: Promise<PreparedCompilerGymEvaluator> | undefined;

	constructor(
		private readonly config: FarmShareCompilerGymConfig = DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
		options: FarmShareCompilerGymAdapterOptions = {},
	) {
		this.warmTransport = options.warmTransport;
		validateRemoteToken(config.host, "SSH host", false);
		validateRemoteToken(config.partition, "partition", false);
		validateRemoteToken(config.cpuConstraint, "CPU constraint", false);
		validateRemoteToken(config.pythonPath, "Python path", true);
		validateRemoteToken(config.remoteEvaluatorDir, "remote evaluator directory", true);
		validateRemoteToken(config.compilerGymCache, "CompilerGym cache path", true);
		validateRemoteToken(config.compilerGymSiteData, "CompilerGym site-data path", true);
		validateRemoteToken(config.compatibilityLibraryDir, "compatibility library path", true);
		validateRemoteToken(config.timeLimit, "time limit", false);
		validateRemoteToken(config.memory, "memory limit", false);
		if (config.compatibilityLibraryDir !== DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.compatibilityLibraryDir) {
			throw new Error("CompilerGym v2 requires the pinned FarmShare LD_LIBRARY_PATH");
		}
		if (!Number.isInteger(config.maxParallelTasks) || config.maxParallelTasks < 1 || config.maxParallelTasks > 16) {
			throw new Error("maxParallelTasks must be an integer from 1 through 16");
		}
		this.measurementHardware = {
			cluster: "Stanford FarmShare",
			partition: this.config.partition,
			cpuConstraint: this.config.cpuConstraint,
		};
		this.measurementProvenance = {
			adapter: "farmshare-compiler-gym",
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
			cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
			upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
			installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
			distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
			compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
			libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
			compilerGym: "0.2.5",
			llvm: "10.0.0",
		};
		if (!this.warmTransport && hasPinnedReuseEnvironment(config)) {
			this.deterministicMeasurementReuse = {
				policy: "deterministic-verified-measurement-v1",
				contractKey: "farmshare-compiler-gym-v2-ir-and-object-size",
				lane: this.lane,
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				hardware: this.measurementHardware,
				provenance: this.measurementProvenance,
				reusableMetricNames: ["IrInstructionCount", "ObjectTextSizeBytes"],
			};
		}
	}

	private prepare(signal: AbortSignal): Promise<PreparedCompilerGymEvaluator> {
		if (!this.prepareOperation) this.prepareOperation = this.uploadEvaluator(signal);
		return this.prepareOperation;
	}

	private async uploadEvaluator(signal: AbortSignal): Promise<PreparedCompilerGymEvaluator> {
		const localPath = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
		const environmentSpecPath = fileURLToPath(new URL("../farmshare/compiler-gym-environment.lock", import.meta.url));
		const patchPath = fileURLToPath(
			new URL("../farmshare/compiler-gym-cbench-ld-library-path.patch", import.meta.url),
		);
		const [source, environmentSpec, patch] = await Promise.all([
			readFile(localPath, "utf8"),
			readFile(environmentSpecPath, "utf8"),
			readFile(patchPath, "utf8"),
		]);
		const digest = sha256Text(source);
		const environmentSpecDigest = sha256Text(environmentSpec);
		const patchDigest = sha256Text(patch);
		if (environmentSpecDigest !== COMPILER_GYM_ENVIRONMENT_SPEC_SHA256) {
			throw new Error("CompilerGym environment lock differs from the v2 verifier epoch pin");
		}
		if (digest !== COMPILER_GYM_EVALUATOR_SHA256) {
			throw new Error("CompilerGym evaluator differs from the v2 verifier epoch pin");
		}
		if (patchDigest !== COMPILER_GYM_CBENCH_PATCH_SHA256) {
			throw new Error("CompilerGym cBench compatibility patch differs from the v2 verifier epoch pin");
		}
		const remotePath = `${this.config.remoteEvaluatorDir}/compiler_gym_eval_${digest}.py`;
		const mkdirResult = await runProcess(
			"ssh",
			[this.config.host, "mkdir", "-p", this.config.remoteEvaluatorDir],
			undefined,
			signal,
			30_000,
		);
		if (mkdirResult.exitCode !== 0)
			throw new Error(`Failed to create remote evaluator directory: ${mkdirResult.stderr}`);
		const copyResult = await runProcess(
			"scp",
			[localPath, `${this.config.host}:${remotePath}`],
			undefined,
			signal,
			60_000,
		);
		if (copyResult.exitCode !== 0) throw new Error(`Failed to upload CompilerGym evaluator: ${copyResult.stderr}`);
		const hashResult = await runProcess(
			"ssh",
			[this.config.host, "sha256sum", remotePath],
			undefined,
			signal,
			30_000,
		);
		if (hashResult.exitCode !== 0 || hashResult.stdout.trim().split(/\s+/)[0] !== digest) {
			throw new Error("Remote CompilerGym evaluator hash verification failed");
		}
		return { remotePath, evaluatorDigest: digest, environmentSpecDigest, patchDigest };
	}

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		const { signal } = context;
		const actions = parseActions(job.candidateContent);
		if (this.warmTransport) return this.evaluateWarm(job, actions, context);
		const prepared = await this.prepare(signal);
		const taskMeasurements: TaskMeasurement[] = new Array(job.benchmarkIds.length);
		const stdoutByTask: string[] = new Array(job.benchmarkIds.length);
		const stderrByTask: string[] = new Array(job.benchmarkIds.length);
		let nextIndex = 0;
		const workerCount = Math.min(this.config.maxParallelTasks, job.benchmarkIds.length);
		const workers = Array.from({ length: workerCount }, async () => {
			while (true) {
				const index = nextIndex++;
				if (index >= job.benchmarkIds.length) return;
				const benchmarkId = job.benchmarkIds[index];
				const result = await this.evaluateTask(job, benchmarkId, actions, prepared.remotePath, signal);
				taskMeasurements[index] = result.measurement;
				stdoutByTask[index] = `${benchmarkId}\t${result.process.stdout.trim()}`;
				stderrByTask[index] = `${benchmarkId}\t${result.process.stderr.trim()}`;
			}
		});
		await Promise.all(workers);
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: taskMeasurements,
			hardware: { ...this.measurementHardware },
			provenance: { ...this.measurementProvenance },
			stdout: stdoutByTask.join("\n"),
			stderr: stderrByTask.join("\n"),
		};
	}

	private async evaluateWarm(
		job: EvaluationJob,
		actions: readonly string[],
		context: EvaluationContext,
	): Promise<EvaluationOutcome> {
		if (!this.warmTransport) throw new Error("CompilerGym warm transport is not enabled");
		const input = {
			branchId: job.branchId,
			jobId: job.jobId,
			manifestDigest: job.manifestDigest,
			actions,
			benchmarkIds: job.benchmarkIds,
		};
		const prepared = await this.warmTransport.prepareEvaluation(input, context.signal);
		try {
			await context.recordExternalJobId(prepared.handle);
		} catch (error) {
			try {
				await this.warmTransport.closeAndVerify();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Failed to persist the warm allocation handle and allocation cleanup also failed",
				);
			}
			throw error;
		}
		const result = await this.warmTransport.publishAndWait(prepared, context.signal);
		return this.warmOutcome(job, result);
	}

	async resume(job: EvaluationJob, externalJobId: string, context: EvaluationContext): Promise<EvaluationOutcome> {
		if (!this.warmTransport) throw new Error("CompilerGym cold evaluations do not have a durable external handle");
		const actions = parseActions(job.candidateContent);
		const result = await this.warmTransport.resumeEvaluation(
			{
				branchId: job.branchId,
				jobId: job.jobId,
				manifestDigest: job.manifestDigest,
				actions,
				benchmarkIds: job.benchmarkIds,
			},
			externalJobId,
			context.signal,
		);
		return this.warmOutcome(job, result);
	}

	closeAndVerify(): Promise<CompilerGymWarmCleanupVerification | undefined> {
		return this.warmTransport?.closeAndVerify() ?? Promise.resolve(undefined);
	}

	private warmOutcome(job: EvaluationJob, result: CompilerGymWarmEvaluationResult): EvaluationOutcome {
		if (result.pool.evaluatorSha256 !== COMPILER_GYM_EVALUATOR_SHA256) {
			throw new Error("Warm transport evaluator hash differs from the pinned CompilerGym evaluator");
		}
		if (result.pool.launchContractSha256 !== COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256) {
			throw new Error("Warm transport launch contract differs from the pinned two-slot contract");
		}
		if (result.processes.length !== job.benchmarkIds.length) {
			throw new Error("Warm transport returned the wrong task count");
		}
		const tasks = job.benchmarkIds.map((benchmarkId, index) => {
			if (result.results[index].benchmarkId !== benchmarkId) {
				throw new Error(`Warm transport task order mismatch at index ${index}`);
			}
			return this.taskMeasurementFromProcess(benchmarkId, result.processes[index], "warm-child");
		});
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks,
			hardware: { ...this.measurementHardware },
			provenance: { ...this.measurementProvenance },
			stdout: result.stdoutArtifact,
			stderr: result.stderrArtifact,
		};
	}

	private async evaluateTask(
		job: EvaluationJob,
		benchmarkId: string,
		actions: readonly string[],
		remoteEvaluatorPath: string,
		signal: AbortSignal,
	): Promise<{ measurement: TaskMeasurement; process: CompilerGymProcessResult }> {
		const transientCache = `/tmp/prime-autoresearch-${job.jobId}-${sha256Text(benchmarkId).slice(0, 12)}`;
		const args = [
			this.config.host,
			"srun",
			"-p",
			this.config.partition,
			"-C",
			this.config.cpuConstraint,
			"--ntasks=1",
			"--cpus-per-task=2",
			`--mem=${this.config.memory}`,
			`--time=${this.config.timeLimit}`,
			"--kill-on-bad-exit=1",
			"env",
			`LD_LIBRARY_PATH=${this.config.compatibilityLibraryDir}`,
			`COMPILER_GYM_CACHE=${this.config.compilerGymCache}`,
			`COMPILER_GYM_SITE_DATA=${this.config.compilerGymSiteData}`,
			`COMPILER_GYM_TRANSIENT_CACHE=${transientCache}`,
			"PYTHONWARNINGS=ignore::FutureWarning",
			this.config.pythonPath,
			remoteEvaluatorPath,
		];
		const processResult = await runProcess(
			"ssh",
			args,
			`${JSON.stringify({ benchmark: benchmarkId, actions })}\n`,
			signal,
			this.config.requestTimeoutMs,
		);
		return { measurement: this.taskMeasurementFromProcess(benchmarkId, processResult), process: processResult };
	}

	private taskMeasurementFromProcess(
		benchmarkId: string,
		processResult: CompilerGymProcessResult,
		timingScope: "cold-allocation" | "warm-child" = "cold-allocation",
	): TaskMeasurement {
		return assessCompilerGymTaskProcess(benchmarkId, processResult, timingScope);
	}
}

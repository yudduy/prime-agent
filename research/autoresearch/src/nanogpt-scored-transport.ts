import { createHash } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	type CompilerGymWarmCommandRequest,
	type CompilerGymWarmCommandResult,
	type CompilerGymWarmCommandRunner,
	compilerGymWarmSshArgv,
	SpawnCompilerGymWarmCommandRunner,
} from "./compiler-gym-warm-farmshare-backend.js";
import {
	KERNELBENCH_VERIFIED_COMMIT,
	KernelBenchTransientTransportError,
} from "./kernelbench-qualification-adapter.js";
import { NANOGPT_BASELINE_FIXTURE, NANOGPT_BASELINE_SHA256 } from "./nanogpt-contract.js";
import type { NanoGptScoredTransport } from "./nanogpt-scored-adapter.js";
import {
	type NanoGptScoredMode,
	type NanoGptScoredRequest,
	type NanoGptScoredVerifierPins,
	type NanoGptScoredWorkerResult,
	nanoGptScoredExternalHandle,
	parseNanoGptScoredExternalHandle,
	parseNanoGptScoredWorkerResult,
	verifyNanoGptScoredRequest,
} from "./nanogpt-scored-protocol.js";

export const NANOGPT_SCORED_REMOTE_ROOT = "/scratch/users/duynguy/prime-autoresearch/nanogpt/scored-v1" as const;
export const NANOGPT_SCORED_ENVIRONMENT_SHA256 =
	"71ddfe105be64b7122d7b6d143ea1a6c26a5b9de30cc414a9cbd9df7cd314de8" as const;
export const NANOGPT_SCORED_ENVIRONMENT_SPEC_SHA256 =
	"3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b" as const;
export const NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256 =
	"c3016d0d77837dad553847c6db0ae96cd1cd4fdce5ba2144306550a8f7b9d576" as const;
export const NANOGPT_SCORED_ENVIRONMENT_DIR =
	`/scratch/users/duynguy/prime-autoresearch/kernelbench-compiled/envs/${NANOGPT_SCORED_ENVIRONMENT_SPEC_SHA256}` as const;
export const NANOGPT_SCORED_DATA_MANIFEST_SHA256 =
	"373bd25f990880b62f16e7b91d969fc7f5ca0802ff8208b4fa1d08ff0a52593a" as const;
export const NANOGPT_SCORED_DATASET_ROOT =
	`/scratch/users/duynguy/prime-autoresearch/nanogpt/data/${NANOGPT_SCORED_DATA_MANIFEST_SHA256}/fineweb10B` as const;
export const NANOGPT_SCORED_STATIC_EVALUATOR_SHA256 =
	"007dd1ef186f003906828f05369974e1096619f1e1f74617fce6d8ce6da20c4c" as const;

export const NANOGPT_SCORED_SLURM_TIMES: Readonly<Record<NanoGptScoredMode, string>> = {
	"smoke-10": "00:30:00",
	"score-1": "06:00:00",
	"score-3": "18:00:00",
	"replay-8": "48:00:00",
};

const TERMINAL_SLURM_STATES = [
	"BOOT_FAIL",
	"CANCELLED",
	"COMPLETED",
	"DEADLINE",
	"FAILED",
	"NODE_FAIL",
	"OUT_OF_MEMORY",
	"PREEMPTED",
	"REVOKED",
	"TIMEOUT",
] as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;
const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_RELATIVE_LOG_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_TRIAL_LOG_BYTES = 16 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_LOG_COMMAND_OUTPUT_BYTES = 24 * 1024 * 1024;
const MAX_PREPARE_INPUT_BYTES = 8 * 1024 * 1024;
const PREPARED_ASSET_PATHS = [
	"candidate.patch",
	"dataset-manifest.json",
	"environment-seal.json",
	"environment.json",
	"job.sh",
	"nanogpt_contract.py",
	"request.json",
	"train_gpt_simple.py",
	"worker.py",
] as const;

const EXPECTED_ENVIRONMENT_RUNTIME = {
	python: "3.12.3",
	pip: "25.2",
	torch: "2.11.0+cu128",
	torchCuda: "12.8",
	numpy: "2.5.2",
} as const;

const EXPECTED_ENVIRONMENT_EXECUTABLES = {
	python: {
		path: `${NANOGPT_SCORED_ENVIRONMENT_DIR}/bin/python`,
		linkTarget: "python3",
		python3LinkTarget: "/usr/bin/python3",
		resolvedPath: "/usr/bin/python3.12",
		sha256: "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118",
		size: 8_020_928,
	},
	torchrun: {
		path: `${NANOGPT_SCORED_ENVIRONMENT_DIR}/bin/torchrun`,
		sha256: "7ff57f7f5ee11cc74839fda7b12e2a97fd2808dd00ae1eafd05f302df5def748",
		size: 367,
		mode: 0o555,
	},
} as const;

export interface NanoGptScoredTransportConfig {
	readonly host: string;
	readonly remotePython: string;
	readonly partition: "gpu";
	readonly constraint: "GPU_SKU:L40S";
	readonly remoteRoot: typeof NANOGPT_SCORED_REMOTE_ROOT;
	readonly environmentDir: typeof NANOGPT_SCORED_ENVIRONMENT_DIR;
	readonly datasetRoot: typeof NANOGPT_SCORED_DATASET_ROOT;
	readonly localWorkerPath: string;
	readonly localTransportPath: string;
	readonly localStaticEvaluatorPath: string;
	readonly localBaselinePath: string;
	readonly localDatasetManifestPath: string;
	readonly localEvidenceDir: string;
	readonly pollIntervalMs: number;
	readonly commandTimeoutMs: number;
	readonly readinessTimeoutMs: number;
	readonly dispatchVisibilityGraceMs: number;
	readonly resultVisibilityGraceMs: number;
	readonly reconcileTimeoutMs: Readonly<Record<NanoGptScoredMode, number | null>>;
}

export const DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG: NanoGptScoredTransportConfig = {
	host: "farmshare",
	remotePython: "/usr/bin/python3",
	partition: "gpu",
	constraint: "GPU_SKU:L40S",
	remoteRoot: NANOGPT_SCORED_REMOTE_ROOT,
	environmentDir: NANOGPT_SCORED_ENVIRONMENT_DIR,
	datasetRoot: NANOGPT_SCORED_DATASET_ROOT,
	localWorkerPath: fileURLToPath(new URL("../evaluators/nanogpt_scored_worker.py", import.meta.url)),
	localTransportPath: fileURLToPath(new URL("./nanogpt-scored-transport.ts", import.meta.url)),
	localStaticEvaluatorPath: fileURLToPath(new URL("../evaluators/nanogpt_contract.py", import.meta.url)),
	localBaselinePath: NANOGPT_BASELINE_FIXTURE,
	localDatasetManifestPath: fileURLToPath(new URL("../farmshare/nanogpt-scored-data.json", import.meta.url)),
	localEvidenceDir: fileURLToPath(new URL("../runs/nanogpt-scored-transport-evidence", import.meta.url)),
	pollIntervalMs: 10_000,
	commandTimeoutMs: 120_000,
	readinessTimeoutMs: 600_000,
	dispatchVisibilityGraceMs: 120_000,
	resultVisibilityGraceMs: 120_000,
	reconcileTimeoutMs: {
		"smoke-10": null,
		"score-1": null,
		"score-3": null,
		"replay-8": null,
	},
};

export interface NanoGptScoredDataFileEvidence {
	readonly path: string;
	readonly size: number;
	readonly sha256: string;
	readonly magic: number;
	readonly version: number;
	readonly tokens: number;
}

export interface NanoGptScoredReadiness {
	readonly pins: NanoGptScoredVerifierPins;
	readonly environment: {
		readonly directory: typeof NANOGPT_SCORED_ENVIRONMENT_DIR;
		readonly manifest: string;
		readonly manifestSha256: typeof NANOGPT_SCORED_ENVIRONMENT_SHA256;
		readonly seal: string;
		readonly sealSha256: typeof NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256;
		readonly runtime: typeof EXPECTED_ENVIRONMENT_RUNTIME;
		readonly executables: typeof EXPECTED_ENVIRONMENT_EXECUTABLES;
	};
	readonly dataset: {
		readonly directory: typeof NANOGPT_SCORED_DATASET_ROOT;
		readonly manifest: string;
		readonly manifestSha256: typeof NANOGPT_SCORED_DATA_MANIFEST_SHA256;
		readonly files: readonly NanoGptScoredDataFileEvidence[];
	};
}

export interface NanoGptScoredPreparedAsset {
	readonly path: (typeof PREPARED_ASSET_PATHS)[number];
	readonly mode: 0o400 | 0o500;
	readonly content: string;
}

export interface NanoGptScoredArchivedTrialLog {
	readonly requestDigest: string;
	readonly remoteName: string;
	readonly logSha256: string;
	readonly byteLength: number;
	readonly path: string;
}

export interface NanoGptScoredAuthoritativeSchedulerEvidence {
	readonly slurmJobId: string;
	readonly jobName: string;
	readonly workDir: string;
	readonly state: "COMPLETED";
	readonly exitCode: "0:0";
}

export interface NanoGptScoredArchiveEvidence {
	readonly canonicalManifest: string;
	readonly manifestByteLength: number;
	readonly manifestSha256: string;
	readonly logs: readonly NanoGptScoredArchivedTrialLog[];
}

export interface NanoGptScoredTransportResult {
	readonly schemaVersion: 1;
	readonly requestDigest: string;
	readonly externalHandle: string;
	readonly jobScriptSha256: string;
	readonly scheduler: NanoGptScoredAuthoritativeSchedulerEvidence;
	readonly workerResult: NanoGptScoredWorkerResult;
	readonly archive: NanoGptScoredArchiveEvidence;
}

export interface NanoGptScoredCommandRunner extends CompilerGymWarmCommandRunner {}

export interface NanoGptScoredTransportDependencies {
	readonly commandRunner?: NanoGptScoredCommandRunner;
}

interface LocalAssets {
	readonly worker: string;
	readonly transport: string;
	readonly staticEvaluator: string;
	readonly baseline: string;
	readonly datasetManifest: string;
}

interface PreparedRequest {
	readonly remoteJobDir: string;
	readonly jobName: string;
	readonly jobScriptSha256: string;
	readonly assets: readonly NanoGptScoredPreparedAsset[];
}

interface TrialLogEvidence {
	readonly name: string;
	readonly byteLength: number;
	readonly sha256: string;
}

type RemotePoll =
	| { readonly kind: "pending"; readonly schedulerState: string }
	| {
			readonly kind: "result";
			readonly resultBase64: string;
			readonly resultByteLength: number;
			readonly resultSha256: string;
			readonly log: string;
			readonly trialLogs: readonly TrialLogEvidence[];
			readonly scheduler: NanoGptScoredAuthoritativeSchedulerEvidence;
	  }
	| { readonly kind: "failed"; readonly reason: string; readonly log: string };

export class NanoGptScoredReconcileTimeoutError extends Error {
	readonly externalHandle: string;
	readonly remoteJobDir: string;
	readonly schedulerState: string;

	constructor(request: NanoGptScoredRequest, remoteJobDir: string, schedulerState: string, timeoutMs: number) {
		super(
			`Timed out after ${timeoutMs}ms while NanoGPT ${request.mode} remained ${schedulerState}; ` +
				"the durable SLURM allocation was left intact for resume",
		);
		this.name = "NanoGptScoredReconcileTimeoutError";
		this.externalHandle = nanoGptScoredExternalHandle(request.requestDigest);
		this.remoteJobDir = remoteJobDir;
		this.schedulerState = schedulerState;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${path} must contain exactly ${wanted.join(",")}`);
	}
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function safeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
	return value;
}

function sha256(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!SHA256_PATTERN.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return parsed;
}

function validateToken(value: string, path: string, pattern: RegExp): void {
	if (!pattern.test(value)) throw new Error(`Unsafe ${path}: ${value}`);
}

function validateAbsolutePath(value: string, path: string): void {
	validateToken(value, path, /^\/[A-Za-z0-9._/-]+$/);
	const parts = value.slice(1).split("/");
	if (parts.some((part) => part === "" || part === "." || part === "..")) {
		throw new Error(`${path} must be absolute and normalized`);
	}
}

function shellQuote(value: string): string {
	if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
		throw new Error("Shell argument contains a forbidden control character");
	}
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sameJson(left: unknown, right: unknown): boolean {
	return sha256Json(left) === sha256Json(right);
}

function sha256Bytes(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new Error("NanoGPT scored transport aborted");
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		if (signal.aborted) {
			reject(abortReason(signal));
			return;
		}
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolvePromise();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(abortReason(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function isTransientCommandFailure(result: CompilerGymWarmCommandResult): boolean {
	if (
		/NANOGPT_SCHEDULER_IDENTITY:|SLURM identity must be numeric|durable result exists without a SLURM identity|squeue row escaped the NanoGPT scored job identity|root sacct row escaped the NanoGPT scored job identity/.test(
			`${result.stdout}\n${result.stderr}`,
		)
	) {
		return false;
	}
	if (result.exitCode === 255 || result.exitCode === null) return true;
	return /\b(?:squeue|sacct|sbatch|slurmctld|slurmdbd)\b|connection (?:closed|refused|reset)|timed? out|temporary failure/i.test(
		`${result.stdout}\n${result.stderr}`,
	);
}

function formatCommandFailure(result: CompilerGymWarmCommandResult): string {
	return [
		`FarmShare command failed (exit ${result.exitCode ?? "signal"})`,
		`stdout:\n${result.stdout || "<empty>"}`,
		`stderr:\n${result.stderr || "<empty>"}`,
	].join("\n");
}

function parseSingleJsonObject(source: string, path: string): Record<string, unknown> {
	const lines = source
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length !== 1) throw new Error(`${path} returned ${lines.length} JSON lines`);
	return record(JSON.parse(lines[0]), path);
}

function parseDataFile(value: unknown, path: string): NanoGptScoredDataFileEvidence {
	const parsed = record(value, path);
	exactKeys(parsed, ["path", "size", "sha256", "magic", "version", "tokens"], path);
	const file = {
		path: string(parsed.path, `${path}.path`),
		size: safeInteger(parsed.size, `${path}.size`),
		sha256: sha256(parsed.sha256, `${path}.sha256`),
		magic: safeInteger(parsed.magic, `${path}.magic`),
		version: safeInteger(parsed.version, `${path}.version`),
		tokens: safeInteger(parsed.tokens, `${path}.tokens`),
	};
	if (
		!SAFE_FILE_NAME_PATTERN.test(file.path) ||
		file.size < 1 ||
		file.magic !== 20_240_520 ||
		file.version !== 1 ||
		file.tokens !== 100_000_000
	) {
		throw new Error(`${path} is not a sealed FineWeb token shard`);
	}
	return file;
}

function parseEnvironmentManifest(source: string): void {
	const manifest = record(JSON.parse(source), "readiness.environmentManifestJson");
	exactKeys(
		manifest,
		[
			"environmentSpecSha256",
			"kernelBenchVerifiedCommit",
			"numpy",
			"pip",
			"python",
			"schemaVersion",
			"torch",
			"torchCuda",
		],
		"readiness.environmentManifestJson",
	);
	if (
		manifest.schemaVersion !== 1 ||
		manifest.environmentSpecSha256 !== NANOGPT_SCORED_ENVIRONMENT_SPEC_SHA256 ||
		manifest.kernelBenchVerifiedCommit !== KERNELBENCH_VERIFIED_COMMIT ||
		manifest.python !== EXPECTED_ENVIRONMENT_RUNTIME.python ||
		manifest.pip !== EXPECTED_ENVIRONMENT_RUNTIME.pip ||
		manifest.torch !== EXPECTED_ENVIRONMENT_RUNTIME.torch ||
		manifest.torchCuda !== EXPECTED_ENVIRONMENT_RUNTIME.torchCuda ||
		manifest.numpy !== EXPECTED_ENVIRONMENT_RUNTIME.numpy
	) {
		throw new Error("NanoGPT scored environment manifest is not the exact sealed runtime");
	}
}

function parseDatasetManifest(source: string): readonly NanoGptScoredDataFileEvidence[] {
	const manifest = record(JSON.parse(source), "datasetManifest");
	exactKeys(
		manifest,
		[
			"schemaVersion",
			"dataset",
			"revision",
			"purpose",
			"globalBatchTokensWorldSizeOne",
			"usableStepsPerTrainShard",
			"totalUsableTrainSteps",
			"files",
		],
		"datasetManifest",
	);
	if (
		manifest.schemaVersion !== 1 ||
		manifest.dataset !== "kjj0/fineweb10B-gpt2" ||
		manifest.revision !== "889765ea1f903759787add96995d81171b632d0c" ||
		manifest.purpose !== "nanogpt-track3-scored-v1-minimal-3290" ||
		manifest.globalBatchTokensWorldSizeOne !== 524_288 ||
		manifest.usableStepsPerTrainShard !== 190 ||
		manifest.totalUsableTrainSteps !== 3_420 ||
		!Array.isArray(manifest.files) ||
		manifest.files.length !== 19
	) {
		throw new Error("NanoGPT scored dataset manifest contract changed");
	}
	const files = manifest.files.map((item, index) => parseDataFile(item, `datasetManifest.files[${index}]`));
	const expectedPaths = [
		"fineweb_val_000000.bin",
		...Array.from({ length: 18 }, (_, index) => `fineweb_train_${String(index + 1).padStart(6, "0")}.bin`),
	];
	if (files.some((file, index) => file.path !== expectedPaths[index])) {
		throw new Error("NanoGPT scored dataset is not val plus train shards 000001 through 000018");
	}
	return files;
}

export function parseNanoGptScoredReadiness(
	raw: string,
	request: NanoGptScoredRequest,
	localDatasetManifest: string,
	config: NanoGptScoredTransportConfig = DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
): NanoGptScoredReadiness {
	verifyNanoGptScoredRequest(request);
	const parsed = record(JSON.parse(raw), "readiness");
	exactKeys(
		parsed,
		[
			"schemaVersion",
			"environmentDirectory",
			"environmentManifest",
			"environmentManifestSha256",
			"environmentSeal",
			"environmentSealSha256",
			"runtime",
			"executables",
			"datasetDirectory",
			"datasetManifest",
			"datasetManifestSha256",
			"dataFiles",
		],
		"readiness",
	);
	if (parsed.schemaVersion !== 1) throw new Error("Unsupported NanoGPT scored readiness schema");
	const environmentManifest = string(parsed.environmentManifest, "readiness.environmentManifest");
	const environmentSeal = string(parsed.environmentSeal, "readiness.environmentSeal");
	if (
		parsed.environmentDirectory !== config.environmentDir ||
		sha256Text(environmentManifest) !== NANOGPT_SCORED_ENVIRONMENT_SHA256 ||
		sha256(parsed.environmentManifestSha256, "readiness.environmentManifestSha256") !==
			NANOGPT_SCORED_ENVIRONMENT_SHA256 ||
		request.pins.environmentSha256 !== NANOGPT_SCORED_ENVIRONMENT_SHA256 ||
		sha256Text(environmentSeal) !== NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256 ||
		sha256(parsed.environmentSealSha256, "readiness.environmentSealSha256") !== NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256
	) {
		throw new Error("NanoGPT scored readiness environment bytes changed");
	}
	parseEnvironmentManifest(environmentManifest);
	const seal = record(JSON.parse(environmentSeal), "readiness.environmentSealJson");
	exactKeys(
		seal,
		["schemaVersion", "environmentSpecSha256", "environmentManifestSha256", "pipFreezeSha256"],
		"readiness.environmentSealJson",
	);
	if (
		seal.schemaVersion !== 1 ||
		seal.environmentSpecSha256 !== NANOGPT_SCORED_ENVIRONMENT_SPEC_SHA256 ||
		seal.environmentManifestSha256 !== NANOGPT_SCORED_ENVIRONMENT_SHA256 ||
		seal.pipFreezeSha256 !== "b85ceb87080994284c997e0ea3742246df1a12d4fc2551a9d8412d87160766d9"
	) {
		throw new Error("NanoGPT scored environment seal does not bind the pinned manifest");
	}
	if (!sameJson(parsed.runtime, EXPECTED_ENVIRONMENT_RUNTIME)) {
		throw new Error("NanoGPT scored live environment runtime changed");
	}
	if (!sameJson(parsed.executables, EXPECTED_ENVIRONMENT_EXECUTABLES)) {
		throw new Error("NanoGPT scored environment executables changed");
	}
	const datasetManifest = string(parsed.datasetManifest, "readiness.datasetManifest");
	if (
		parsed.datasetDirectory !== config.datasetRoot ||
		datasetManifest !== localDatasetManifest ||
		sha256Text(datasetManifest) !== NANOGPT_SCORED_DATA_MANIFEST_SHA256 ||
		sha256(parsed.datasetManifestSha256, "readiness.datasetManifestSha256") !== NANOGPT_SCORED_DATA_MANIFEST_SHA256 ||
		request.pins.datasetManifestSha256 !== NANOGPT_SCORED_DATA_MANIFEST_SHA256
	) {
		throw new Error("NanoGPT scored readiness dataset bytes changed");
	}
	const expectedFiles = parseDatasetManifest(datasetManifest);
	if (!Array.isArray(parsed.dataFiles)) throw new Error("readiness.dataFiles must be an array");
	const observedFiles = parsed.dataFiles.map((item, index) => parseDataFile(item, `readiness.dataFiles[${index}]`));
	if (!sameJson(observedFiles, expectedFiles)) {
		throw new Error("NanoGPT scored readiness did not hash the exact full dataset");
	}
	return {
		pins: { ...request.pins },
		environment: {
			directory: NANOGPT_SCORED_ENVIRONMENT_DIR,
			manifest: environmentManifest,
			manifestSha256: NANOGPT_SCORED_ENVIRONMENT_SHA256,
			seal: environmentSeal,
			sealSha256: NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
			runtime: EXPECTED_ENVIRONMENT_RUNTIME,
			executables: EXPECTED_ENVIRONMENT_EXECUTABLES,
		},
		dataset: {
			directory: NANOGPT_SCORED_DATASET_ROOT,
			manifest: datasetManifest,
			manifestSha256: NANOGPT_SCORED_DATA_MANIFEST_SHA256,
			files: expectedFiles,
		},
	};
}

export const NANOGPT_SCORED_READINESS_REMOTE = `
import hashlib, importlib.metadata, json, os, pathlib, stat, struct, subprocess, sys
environment = pathlib.Path(sys.argv[1])
dataset = pathlib.Path(sys.argv[2])
environment_digest = sys.argv[3]
dataset_digest = sys.argv[4]
def regular(path, label):
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or path.is_symlink():
        raise SystemExit(label + " must be a regular non-symlink file")
def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
if environment.is_symlink() or not environment.is_dir():
    raise SystemExit("sealed scored environment is missing or a symlink")
if dataset.is_symlink() or not dataset.is_dir():
    raise SystemExit("sealed scored dataset is missing or a symlink")
required = [
    environment / "READY",
    environment / "bin/torchrun",
    environment / "environment.json",
    environment / "pip-freeze.txt",
    environment / "environment-seal.json",
    dataset / "READY",
    dataset / "dataset-manifest.json",
]
for path in required:
    regular(path, str(path))
python_launcher = environment / "bin/python"
python3_launcher = environment / "bin/python3"
if not python_launcher.is_symlink() or os.readlink(python_launcher) != "python3":
    raise SystemExit("sealed Python launcher changed")
if not python3_launcher.is_symlink() or os.readlink(python3_launcher) != "/usr/bin/python3":
    raise SystemExit("sealed Python 3 launcher changed")
python_resolved = python_launcher.resolve(strict=True)
regular(python_resolved, "resolved Python executable")
torchrun = environment / "bin/torchrun"
executables = {
    "python": {
        "path": str(python_launcher),
        "linkTarget": os.readlink(python_launcher),
        "python3LinkTarget": os.readlink(python3_launcher),
        "resolvedPath": str(python_resolved),
        "sha256": sha256(python_resolved),
        "size": python_resolved.stat().st_size,
    },
    "torchrun": {
        "path": str(torchrun),
        "sha256": sha256(torchrun),
        "size": torchrun.stat().st_size,
        "mode": stat.S_IMODE(torchrun.lstat().st_mode),
    },
}
environment_manifest = (environment / "environment.json").read_text(encoding="utf-8")
environment_seal = (environment / "environment-seal.json").read_text(encoding="utf-8")
dataset_manifest = (dataset / "dataset-manifest.json").read_text(encoding="utf-8")
if hashlib.sha256(environment_manifest.encode()).hexdigest() != environment_digest:
    raise SystemExit("sealed environment manifest digest mismatch")
if hashlib.sha256(dataset_manifest.encode()).hexdigest() != dataset_digest:
    raise SystemExit("sealed dataset manifest digest mismatch")
if (environment / "READY").read_text(encoding="utf-8").strip() != environment.name:
    raise SystemExit("sealed environment READY mismatch")
if (dataset / "READY").read_text(encoding="utf-8").strip() != dataset_digest:
    raise SystemExit("sealed dataset READY mismatch")
runtime_source = """
import importlib.metadata, json, platform, torch
print(json.dumps({
    "python": platform.python_version(),
    "pip": importlib.metadata.version("pip"),
    "torch": torch.__version__,
    "torchCuda": torch.version.cuda,
    "numpy": importlib.metadata.version("numpy"),
}, sort_keys=True))
"""
runtime = json.loads(subprocess.run(
    [str(python_launcher), "-I", "-c", runtime_source],
    check=True,
    capture_output=True,
    text=True,
    env={"PATH": f"{environment / 'bin'}:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1"},
).stdout)
manifest = json.loads(dataset_manifest)
files = manifest.get("files")
if not isinstance(files, list) or len(files) != 19:
    raise SystemExit("sealed scored dataset must contain exactly nineteen files")
observed = []
for item in files:
    if set(item) != {"path", "size", "sha256", "magic", "version", "tokens"}:
        raise SystemExit("sealed scored dataset file schema changed")
    relative = pathlib.PurePosixPath(item["path"])
    if relative.is_absolute() or len(relative.parts) != 1 or relative.name in ("", ".", ".."):
        raise SystemExit("sealed scored dataset path is unsafe")
    path = dataset / relative.name
    regular(path, str(path))
    metadata = path.lstat()
    if stat.S_IMODE(metadata.st_mode) & 0o222 or metadata.st_nlink != 1:
        raise SystemExit("sealed scored dataset shard must be readonly and single-linked: " + relative.name)
    with path.open("rb") as stream:
        prefix = stream.read(12)
    if len(prefix) != 12:
        raise SystemExit("truncated dataset header: " + relative.name)
    magic, version, tokens = struct.unpack("<iii", prefix)
    measured = {
        "path": relative.name,
        "size": path.stat().st_size,
        "sha256": sha256(path),
        "magic": magic,
        "version": version,
        "tokens": tokens,
    }
    if measured != item:
        raise SystemExit("sealed scored dataset shard mismatch: " + relative.name)
    observed.append(measured)
observed_globs = sorted(
    path.name
    for pattern in ("fineweb_val_*.bin", "fineweb_train_*.bin")
    for path in dataset.glob(pattern)
)
if observed_globs != sorted(item["path"] for item in files):
    raise SystemExit("sealed scored dataset exposes an unmanifested NanoGPT shard")
print(json.dumps({
    "schemaVersion": 1,
    "environmentDirectory": str(environment),
    "environmentManifest": environment_manifest,
    "environmentManifestSha256": hashlib.sha256(environment_manifest.encode()).hexdigest(),
    "environmentSeal": environment_seal,
    "environmentSealSha256": hashlib.sha256(environment_seal.encode()).hexdigest(),
    "runtime": runtime,
    "executables": executables,
    "datasetDirectory": str(dataset),
    "datasetManifest": dataset_manifest,
    "datasetManifestSha256": hashlib.sha256(dataset_manifest.encode()).hexdigest(),
    "dataFiles": observed,
}, sort_keys=True))
`;

export const NANOGPT_SCORED_PREPARE_REMOTE = `
import base64, hashlib, json, os, pathlib, stat, sys, time
root = pathlib.Path(sys.argv[1])
remote_root = pathlib.Path(sys.argv[2])
request_digest = sys.argv[3]
payload = json.load(sys.stdin)
expected_paths = {
    "candidate.patch",
    "dataset-manifest.json",
    "environment.json",
    "environment-seal.json",
    "job.sh",
    "nanogpt_contract.py",
    "request.json",
    "train_gpt_simple.py",
    "worker.py",
}
files = payload.get("files")
if not isinstance(files, list) or {item.get("path") for item in files} != expected_paths:
    raise SystemExit("prepared NanoGPT scored asset set changed")
if root != remote_root / "jobs" / request_digest:
    raise SystemExit("NanoGPT scored directory escaped its request digest route")
root.mkdir(parents=True, exist_ok=True, mode=0o700)
if root.is_symlink() or not root.is_dir():
    raise SystemExit("NanoGPT scored job root must be a non-symlink directory")
os.chmod(root, 0o700)
if root.stat().st_uid != os.getuid() or stat.S_IMODE(root.lstat().st_mode) != 0o700:
    raise SystemExit("NanoGPT scored job root ownership or mode changed")
decoded = {}
def verify_file(path, content, expected_mode):
    mode = path.lstat().st_mode
    if (
        not stat.S_ISREG(mode)
        or path.is_symlink()
        or path.stat().st_uid != os.getuid()
        or stat.S_IMODE(mode) != expected_mode
        or path.read_bytes() != content
    ):
        raise SystemExit("immutable NanoGPT scored asset mismatch: " + str(path))
    for _ in range(100):
        if path.stat().st_nlink == 1:
            return
        time.sleep(0.01)
    raise SystemExit("immutable NanoGPT scored asset has unexpected hard links: " + str(path))
for item in files:
    if set(item) != {"path", "mode", "content"} or item["mode"] not in (0o400, 0o500):
        raise SystemExit("invalid NanoGPT scored asset record")
    relative = pathlib.PurePosixPath(item["path"])
    if relative.is_absolute() or len(relative.parts) != 1 or relative.name in ("", ".", ".."):
        raise SystemExit("invalid NanoGPT scored asset path")
    content = base64.b64decode(item["content"], validate=True)
    decoded[relative.name] = content
request = json.loads(decoded["request.json"].decode("utf-8"))
if request.get("requestDigest") != request_digest:
    raise SystemExit("prepared request digest mismatch")
if hashlib.sha256(decoded["candidate.patch"]).hexdigest() != request["candidatePatch"]["digest"]:
    raise SystemExit("prepared candidate patch digest mismatch")
if len(decoded["candidate.patch"]) != request["candidatePatch"]["byteLength"]:
    raise SystemExit("prepared candidate patch byte length mismatch")
for asset, pin in (
    ("worker.py", "workerSha256"),
    ("nanogpt_contract.py", "staticEvaluatorSha256"),
    ("environment.json", "environmentSha256"),
    ("environment-seal.json", "environmentSealSha256"),
    ("dataset-manifest.json", "datasetManifestSha256"),
):
    if hashlib.sha256(decoded[asset]).hexdigest() != request["pins"][pin]:
        raise SystemExit("prepared pinned asset mismatch: " + asset)
if hashlib.sha256(decoded["train_gpt_simple.py"]).hexdigest() != request["staticEvidence"]["baselineSha256"]:
    raise SystemExit("prepared baseline mismatch")
for item in files:
    path = root / item["path"]
    content = decoded[item["path"]]
    if os.path.lexists(path):
        verify_file(path, content, item["mode"])
        continue
    temporary = root / ("." + path.name + ".tmp." + str(os.getpid()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, item["mode"])
        try:
            os.link(temporary, path)
        except FileExistsError:
            pass
        directory_descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    verify_file(path, content, item["mode"])
print(json.dumps({"prepared": str(root), "requestDigest": request_digest}, sort_keys=True))
`;

export const NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE = String.raw`
import datetime, errno, fcntl, getpass, json, os, pathlib, re, stat, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
remote_root = pathlib.Path(sys.argv[2])
request_digest = sys.argv[3]
job_name = sys.argv[4]
grace_seconds = float(sys.argv[5])
now = float(sys.argv[6]) if len(sys.argv) > 6 else time.time()
def identity(message):
    raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: " + message)
if not re.fullmatch(r"[0-9a-f]{64}", request_digest):
    identity("request digest must be a lowercase SHA-256 digest")
if root != remote_root / "jobs" / request_digest:
    identity("dispatch root escaped its request digest route")
if root.is_symlink() or not root.is_dir():
    identity("dispatch root must be a non-symlink directory")
root_metadata = root.lstat()
if root_metadata.st_uid != os.getuid() or stat.S_IMODE(root_metadata.st_mode) != 0o700:
    identity("dispatch root ownership or mode changed")
def fsync_root():
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
def regular_owned(path, mode, label):
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or path.is_symlink()
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != mode
        or metadata.st_nlink != 1
    ):
        identity(label + " must be an owned, single-linked, mode " + oct(mode) + " regular file")
def publish_new(path, content, mode):
    temporary = root / ("." + path.name + ".tmp." + str(os.getpid()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            return False
        fsync_root()
        return True
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
def read_json(path, label):
    regular_owned(path, 0o600, label)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        identity(label + " is unreadable or invalid JSON: " + str(error))
    if not isinstance(value, dict):
        identity(label + " must be a JSON object")
    return value
id_path = root / "slurm-job-id"
intent_path = root / "dispatch-intent.json"
dispatch_path = root / "dispatch.json"
lock_path = root / "dispatch.lock"
try:
    lock_descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.fsync(lock_descriptor)
    fsync_root()
except OSError as error:
    if error.errno != errno.EEXIST:
        raise
    regular_owned(lock_path, 0o600, "dispatch lock")
    lock_descriptor = os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW)
lock = os.fdopen(lock_descriptor, "r+")
fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
def read_job_id():
    regular_owned(id_path, 0o600, "SLURM identity")
    job_id = id_path.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[1-9][0-9]*", job_id):
        identity("durable SLURM identity must be numeric")
    return job_id
def persist(job_id):
    if not re.fullmatch(r"[1-9][0-9]*", job_id):
        identity("scheduler returned an invalid SLURM job id: " + job_id)
    published_id = publish_new(id_path, (job_id + "\n").encode("utf-8"), 0o600)
    if not published_id and read_job_id() != job_id:
        identity("durable SLURM identity changed during publication")
    dispatch = {
        "schemaVersion": 1,
        "slurmJobId": job_id,
        "jobName": job_name,
        "workDir": str(root),
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    published_dispatch = publish_new(dispatch_path, canonical(dispatch), 0o600)
    if not published_dispatch:
        existing = read_json(dispatch_path, "dispatch journal")
        if (
            set(existing) != {"schemaVersion", "slurmJobId", "jobName", "workDir", "recordedAt"}
            or existing.get("schemaVersion") != 1
            or existing.get("slurmJobId") != job_id
            or existing.get("jobName") != job_name
            or existing.get("workDir") != str(root)
            or not isinstance(existing.get("recordedAt"), str)
        ):
            identity("dispatch journal does not bind the durable scheduler identity")
    return job_id
if id_path.exists():
    job_id = read_job_id()
    if dispatch_path.exists():
        dispatch = read_json(dispatch_path, "dispatch journal")
        if (
            set(dispatch) != {"schemaVersion", "slurmJobId", "jobName", "workDir", "recordedAt"}
            or dispatch.get("schemaVersion") != 1
            or dispatch.get("slurmJobId") != job_id
            or dispatch.get("jobName") != job_name
            or dispatch.get("workDir") != str(root)
            or not isinstance(dispatch.get("recordedAt"), str)
        ):
            identity("dispatch journal does not bind the durable scheduler identity")
    else:
        persist(job_id)
    print(json.dumps({"kind": "submitted", "slurmJobId": job_id}, sort_keys=True))
    raise SystemExit(0)
if intent_path.exists():
    intent = read_json(intent_path, "dispatch intent")
    if (
        set(intent) != {"schemaVersion", "requestDigest", "jobName", "workDir", "createdAtEpoch", "lastAttemptAtEpoch", "submissionAttempts"}
        or intent.get("schemaVersion") != 1
        or intent.get("requestDigest") != request_digest
        or intent.get("jobName") != job_name
        or intent.get("workDir") != str(root)
        or not isinstance(intent.get("createdAtEpoch"), (int, float))
        or not isinstance(intent.get("lastAttemptAtEpoch"), (int, float))
        or intent.get("submissionAttempts") != 1
    ):
        identity("dispatch intent does not bind the exact request and scheduler route")
else:
    intent = None
def checked(command, label, cwd=None):
    completed = subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        sys.stdout.write(completed.stdout)
        sys.stderr.write(completed.stderr)
        raise SystemExit(completed.returncode)
    return completed
matches = set()
user = getpass.getuser()
queued = checked(["squeue", "--noheader", "--user", user, "--name", job_name, "--format=%A|%j|%Z"], "squeue")
for line in queued.stdout.splitlines():
    parts = line.strip().rstrip("|").split("|", 2)
    if len(parts) != 3 or parts[1] != job_name or parts[2] != str(root) or not re.fullmatch(r"[1-9][0-9]*", parts[0]):
        identity("squeue row escaped the exact NanoGPT request: " + line.strip())
    matches.add(parts[0])
accounted = checked(["sacct", "--noheader", "-X", "--user", user, "--name", job_name, "--starttime", "now-7days", "--format=JobIDRaw,JobName,WorkDir", "--parsable2"], "sacct")
for line in accounted.stdout.splitlines():
    parts = line.strip().rstrip("|").split("|", 2)
    if len(parts) != 3 or parts[1] != job_name or parts[2] != str(root) or not re.fullmatch(r"[1-9][0-9]*", parts[0]):
        identity("sacct row escaped the exact NanoGPT request: " + line.strip())
    matches.add(parts[0])
if len(matches) > 1:
    identity("duplicate scheduler jobs exist for " + job_name + ": " + repr(sorted(matches)))
if matches:
    job_id = persist(next(iter(matches)))
    print(json.dumps({"kind": "submitted", "slurmJobId": job_id}, sort_keys=True))
    raise SystemExit(0)
if intent is not None:
    last_attempt = intent["lastAttemptAtEpoch"]
    if now - last_attempt < grace_seconds:
        remaining_ms = max(1, int((grace_seconds - (now - last_attempt)) * 1000))
        print(json.dumps({"kind": "reconciling", "retryAfterMs": remaining_ms}, sort_keys=True))
        raise SystemExit(0)
    print(json.dumps({"kind": "ambiguous", "reason": "dispatch intent exists but no durable job id or scheduler record is visible; refusing automatic resubmission"}, sort_keys=True))
    raise SystemExit(0)
intent = {
    "schemaVersion": 1,
    "requestDigest": request_digest,
    "jobName": job_name,
    "workDir": str(root),
    "createdAtEpoch": now,
    "lastAttemptAtEpoch": now,
    "submissionAttempts": 1,
}
if not publish_new(intent_path, canonical(intent), 0o600):
    identity("dispatch intent appeared while holding the dispatch lock")
submitted = checked(["sbatch", "--parsable", "--no-requeue", "--job-name", job_name, str(root / "job.sh")], "sbatch", cwd=root)
submitted_output = submitted.stdout.strip()
if not re.fullmatch(r"[1-9][0-9]*(?:;[^;\s]+)?", submitted_output):
    identity("sbatch returned an invalid parsable identity: " + submitted_output)
job_id = persist(submitted_output.split(";", 1)[0])
print(json.dumps({"kind": "submitted", "slurmJobId": job_id}, sort_keys=True))
`;

export const NANOGPT_SCORED_POLL_REMOTE = `
import base64, hashlib, json, os, pathlib, re, stat, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
job_name = sys.argv[2]
grace_seconds = float(sys.argv[3])
terminal_states = set(${JSON.stringify(TERMINAL_SLURM_STATES)})
marker = root / "terminal-result-visibility-grace"
def regular(path, label):
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or path.is_symlink():
        raise SystemExit(label + " must be a regular non-symlink file")
def sha256_bytes(content):
    return hashlib.sha256(content).hexdigest()
id_path = root / "slurm-job-id"
if id_path.exists():
    regular(id_path, "SLURM identity")
job_id = id_path.read_text(encoding="utf-8").strip() if id_path.exists() else ""
if job_id and not re.fullmatch(r"[1-9][0-9]*", job_id):
    raise SystemExit("SLURM identity must be numeric")
log_path = root / ("slurm-" + job_id + ".out") if job_id else None
if log_path and log_path.exists():
    regular(log_path, "SLURM log")
log = log_path.read_text(encoding="utf-8", errors="replace")[-262144:] if log_path and log_path.exists() else ""
result_path = root / "result.json"
def emit_result(scheduler):
    regular(result_path, "durable result")
    content = result_path.read_bytes()
    if len(content) < 2 or len(content) > ${MAX_RESULT_BYTES}:
        raise SystemExit("durable result byte length is outside its bound")
    result = json.loads(content.decode("utf-8"))
    trial_dir = root / "trial-logs"
    logs = []
    if trial_dir.exists():
        if trial_dir.is_symlink() or not trial_dir.is_dir():
            raise SystemExit("trial log root must be a non-symlink directory")
        for path in sorted(trial_dir.rglob("*.log")):
            regular(path, "trial log")
            raw = path.read_bytes()
            if len(raw) > ${MAX_TRIAL_LOG_BYTES}:
                raise SystemExit("trial log exceeds its byte bound")
            logs.append({"name": str(path.relative_to(trial_dir)), "byteLength": len(raw), "sha256": sha256_bytes(raw)})
    expected = [trial.get("logSha256") for trial in result.get("trials", [])]
    observed = [item["sha256"] for item in logs]
    remaining = list(observed)
    for digest in expected:
        if digest not in remaining:
            raise SystemExit("durable result names a missing or changed trial log")
        remaining.remove(digest)
    print(json.dumps({
        "kind": "result",
        "resultBase64": base64.b64encode(content).decode("ascii"),
        "resultByteLength": len(content),
        "resultSha256": sha256_bytes(content),
        "log": log,
        "trialLogs": logs,
        "scheduler": scheduler,
    }, sort_keys=True))
    raise SystemExit(0)
if result_path.exists() and not job_id:
    raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: durable result exists without a SLURM identity")
if not job_id:
    print(json.dumps({"kind": "pending", "schedulerState": "DISPATCHING"}, sort_keys=True))
    raise SystemExit(0)
queued = subprocess.run(["squeue", "--noheader", "--jobs", job_id, "--format=%A|%j|%Z|%T"], capture_output=True, text=True, check=True)
queue_rows = [line.strip().split("|", 3) for line in queued.stdout.splitlines() if line.strip()]
if queue_rows:
    if len(queue_rows) != 1 or queue_rows[0][0] != job_id or queue_rows[0][1] != job_name or queue_rows[0][2] != str(root):
        raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: squeue row escaped the NanoGPT scored job identity")
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    print(json.dumps({"kind": "pending", "schedulerState": queue_rows[0][3]}, sort_keys=True))
    raise SystemExit(0)
accounted = subprocess.run([
    "sacct", "--noheader", "-X", "--jobs", job_id,
    "--format=JobIDRaw,JobName,WorkDir,State,ExitCode", "--parsable2",
], capture_output=True, text=True, check=True)
rows = [line.strip().rstrip("|").split("|", 4) for line in accounted.stdout.splitlines() if line.strip()]
if not rows:
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    print(json.dumps({"kind": "pending", "schedulerState": "ACCOUNTING_LAG"}, sort_keys=True))
    raise SystemExit(0)
if len(rows) != 1 or rows[0][0] != job_id or rows[0][1] != job_name or rows[0][2] != str(root):
    raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: root sacct row escaped the NanoGPT scored job identity")
state = rows[0][3].split("+", 1)[0].split(" ", 1)[0].strip().upper()
exit_code = rows[0][4].strip()
accounting = "|".join(rows[0])
if state not in terminal_states:
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    print(json.dumps({"kind": "pending", "schedulerState": "ACCOUNTING_NONTERMINAL_OR_UNKNOWN:" + accounting}, sort_keys=True))
    raise SystemExit(0)
if state != "COMPLETED" or exit_code != "0:0":
    print(json.dumps({"kind": "failed", "reason": "SLURM did not complete successfully; refusing any durable result: " + accounting, "log": log}, sort_keys=True))
    raise SystemExit(0)
scheduler = {
    "slurmJobId": job_id,
    "jobName": job_name,
    "workDir": str(root),
    "state": "COMPLETED",
    "exitCode": "0:0",
}
if result_path.exists():
    emit_result(scheduler)
if not marker.exists():
    try:
        descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(str(time.time()))
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        pass
try:
    first_terminal = float(marker.read_text(encoding="utf-8"))
except (OSError, ValueError):
    first_terminal = time.time()
if time.time() - first_terminal < grace_seconds:
    print(json.dumps({"kind": "pending", "schedulerState": "RESULT_VISIBILITY_GRACE:" + accounting}, sort_keys=True))
    raise SystemExit(0)
print(json.dumps({"kind": "failed", "reason": "SLURM terminated without a durable result after visibility grace: " + accounting, "log": log}, sort_keys=True))
`;

export const NANOGPT_SCORED_FETCH_TRIAL_LOG_REMOTE = `
import base64, hashlib, json, pathlib, re, stat, sys
root = pathlib.Path(sys.argv[1])
name = sys.argv[2]
expected_digest = sys.argv[3]
expected_size = int(sys.argv[4])
if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", name):
    raise SystemExit("unsafe NanoGPT scored trial log name")
if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
    raise SystemExit("invalid NanoGPT scored trial log digest")
if expected_size < 0 or expected_size > ${MAX_TRIAL_LOG_BYTES}:
    raise SystemExit("NanoGPT scored trial log size is outside its bound")
trial_root = root / "trial-logs"
if trial_root.is_symlink() or not trial_root.is_dir():
    raise SystemExit("NanoGPT scored trial log root is missing or a symlink")
relative = pathlib.PurePosixPath(name)
if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
    raise SystemExit("unsafe NanoGPT scored trial log route")
path = trial_root.joinpath(*relative.parts)
parent = trial_root
for part in relative.parts[:-1]:
    parent = parent / part
    if parent.is_symlink() or not parent.is_dir():
        raise SystemExit("NanoGPT scored trial log parent must be a non-symlink directory")
mode = path.lstat().st_mode
if not stat.S_ISREG(mode) or path.is_symlink() or path.stat().st_uid != root.stat().st_uid:
    raise SystemExit("NanoGPT scored trial log must be an owned regular non-symlink file")
content = path.read_bytes()
digest = hashlib.sha256(content).hexdigest()
if len(content) != expected_size or digest != expected_digest:
    raise SystemExit("NanoGPT scored trial log bytes changed after result publication")
print(json.dumps({
    "name": name,
    "byteLength": len(content),
    "sha256": digest,
    "contentBase64": base64.b64encode(content).decode("ascii"),
}, sort_keys=True))
`;

function validateConfig(config: NanoGptScoredTransportConfig): void {
	validateToken(config.host, "SSH host", /^[A-Za-z0-9._-]+$/);
	validateAbsolutePath(config.remotePython, "remote Python");
	for (const [path, name] of [
		[config.remoteRoot, "remote root"],
		[config.environmentDir, "environment directory"],
		[config.datasetRoot, "dataset root"],
		[config.localWorkerPath, "local worker path"],
		[config.localTransportPath, "local transport path"],
		[config.localStaticEvaluatorPath, "local static evaluator path"],
		[config.localBaselinePath, "local baseline path"],
		[config.localDatasetManifestPath, "local dataset manifest path"],
		[config.localEvidenceDir, "local evidence directory"],
	] as const) {
		validateAbsolutePath(path, name);
	}
	if (resolve(config.localEvidenceDir) !== config.localEvidenceDir) {
		throw new Error("localEvidenceDir must be absolute and normalized");
	}
	if (
		config.partition !== "gpu" ||
		config.constraint !== "GPU_SKU:L40S" ||
		config.remoteRoot !== NANOGPT_SCORED_REMOTE_ROOT ||
		config.environmentDir !== NANOGPT_SCORED_ENVIRONMENT_DIR ||
		config.datasetRoot !== NANOGPT_SCORED_DATASET_ROOT
	) {
		throw new Error("NanoGPT scored transport requires the fixed FarmShare L40S, environment, dataset, and spool");
	}
	for (const [value, name] of [
		[config.pollIntervalMs, "pollIntervalMs"],
		[config.commandTimeoutMs, "commandTimeoutMs"],
		[config.readinessTimeoutMs, "readinessTimeoutMs"],
		[config.dispatchVisibilityGraceMs, "dispatchVisibilityGraceMs"],
		[config.resultVisibilityGraceMs, "resultVisibilityGraceMs"],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	}
	for (const mode of ["smoke-10", "score-1", "score-3", "replay-8"] as const) {
		const timeout = config.reconcileTimeoutMs[mode];
		if (timeout !== null && (!Number.isSafeInteger(timeout) || timeout < config.pollIntervalMs)) {
			throw new Error(`reconcileTimeoutMs.${mode} must be null or at least pollIntervalMs`);
		}
	}
}

export function nanoGptScoredRemoteJobDir(
	requestDigest: string,
	config: NanoGptScoredTransportConfig = DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
): string {
	sha256(requestDigest, "requestDigest");
	validateConfig(config);
	return `${config.remoteRoot}/jobs/${requestDigest}`;
}

export function nanoGptScoredJobName(requestDigest: string): string {
	sha256(requestDigest, "requestDigest");
	return `pngs-${requestDigest.slice(0, 24)}`;
}

export function buildNanoGptScoredJobScript(
	request: NanoGptScoredRequest,
	config: NanoGptScoredTransportConfig = DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
): string {
	verifyNanoGptScoredRequest(request);
	validateConfig(config);
	const remoteJobDir = nanoGptScoredRemoteJobDir(request.requestDigest, config);
	const jobName = nanoGptScoredJobName(request.requestDigest);
	const home = `${remoteJobDir}/home`;
	const temporary = `${remoteJobDir}/tmp`;
	const cache = `${remoteJobDir}/torchinductor-cache`;
	const trialLogs = `${remoteJobDir}/trial-logs`;
	const python = `${config.environmentDir}/bin/python`;
	return `#!/usr/bin/env bash
#SBATCH --job-name=${jobName}
#SBATCH --partition=gpu
#SBATCH --constraint=GPU_SKU:L40S
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=${NANOGPT_SCORED_SLURM_TIMES[request.mode]}
#SBATCH --no-requeue
#SBATCH --export=NONE
#SBATCH --chdir=${remoteJobDir}
#SBATCH --output=${remoteJobDir}/slurm-%j.out
set -euo pipefail
umask 077
mkdir -p ${shellQuote(home)} ${shellQuote(temporary)} ${shellQuote(cache)}
exec env -i \
	CUDA_DEVICE_ORDER=PCI_BUS_ID \
	CUDA_VISIBLE_DEVICES="\${CUDA_VISIBLE_DEVICES:-}" \
	HOME=${shellQuote(home)} \
	LC_ALL=C.UTF-8 \
	PATH=${shellQuote(`${config.environmentDir}/bin:/usr/bin:/bin`)} \
	PYTHONDONTWRITEBYTECODE=1 \
	PYTHONNOUSERSITE=1 \
	SLURM_JOB_ID="\${SLURM_JOB_ID:-}" \
	TMPDIR=${shellQuote(temporary)} \
	TORCHINDUCTOR_CACHE_DIR=${shellQuote(cache)} \
	${shellQuote(python)} -I ${shellQuote(`${remoteJobDir}/worker.py`)} \
		--request ${shellQuote(`${remoteJobDir}/request.json`)} \
		--candidate-patch ${shellQuote(`${remoteJobDir}/candidate.patch`)} \
		--baseline ${shellQuote(`${remoteJobDir}/train_gpt_simple.py`)} \
		--static-evaluator ${shellQuote(`${remoteJobDir}/nanogpt_contract.py`)} \
		--environment-manifest ${shellQuote(`${remoteJobDir}/environment.json`)} \
		--environment-seal ${shellQuote(`${remoteJobDir}/environment-seal.json`)} \
		--dataset-manifest ${shellQuote(`${remoteJobDir}/dataset-manifest.json`)} \
		--dataset-root ${shellQuote(config.datasetRoot)} \
		--trial-log-dir ${shellQuote(trialLogs)} \
		--output ${shellQuote(`${remoteJobDir}/result.json`)}
`;
}

async function readPinnedLocalAssets(
	request: NanoGptScoredRequest,
	config: NanoGptScoredTransportConfig,
): Promise<LocalAssets> {
	const [worker, transport, staticEvaluator, baseline, datasetManifest] = await Promise.all([
		readFile(config.localWorkerPath, "utf8"),
		readFile(config.localTransportPath, "utf8"),
		readFile(config.localStaticEvaluatorPath, "utf8"),
		readFile(config.localBaselinePath, "utf8"),
		readFile(config.localDatasetManifestPath, "utf8"),
	]);
	if (sha256Text(worker) !== request.pins.workerSha256) {
		throw new Error("Local NanoGPT scored worker differs from request.pins.workerSha256");
	}
	if (sha256Text(transport) !== request.pins.transportSha256) {
		throw new Error("Local NanoGPT scored transport differs from request.pins.transportSha256");
	}
	if (
		sha256Text(staticEvaluator) !== NANOGPT_SCORED_STATIC_EVALUATOR_SHA256 ||
		request.pins.staticEvaluatorSha256 !== NANOGPT_SCORED_STATIC_EVALUATOR_SHA256 ||
		request.staticEvidence.evaluatorSha256 !== NANOGPT_SCORED_STATIC_EVALUATOR_SHA256
	) {
		throw new Error("Local NanoGPT static evaluator differs from the exact request pin");
	}
	if (
		sha256Text(baseline) !== NANOGPT_BASELINE_SHA256 ||
		request.staticEvidence.baselineSha256 !== NANOGPT_BASELINE_SHA256
	) {
		throw new Error("Local NanoGPT baseline differs from the fixed contract");
	}
	if (
		sha256Text(datasetManifest) !== NANOGPT_SCORED_DATA_MANIFEST_SHA256 ||
		request.pins.datasetManifestSha256 !== NANOGPT_SCORED_DATA_MANIFEST_SHA256
	) {
		throw new Error("Local NanoGPT full dataset manifest differs from the exact request pin");
	}
	if (request.pins.environmentSha256 !== NANOGPT_SCORED_ENVIRONMENT_SHA256) {
		throw new Error("NanoGPT request environment pin is not the exact sealed environment manifest");
	}
	if (request.pins.environmentSealSha256 !== NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256) {
		throw new Error("NanoGPT request environment-seal pin is not the exact sealed environment");
	}
	parseDatasetManifest(datasetManifest);
	return { worker, transport, staticEvaluator, baseline, datasetManifest };
}

export async function loadNanoGptScoredVerifierPins(
	config: NanoGptScoredTransportConfig = DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
): Promise<NanoGptScoredVerifierPins> {
	validateConfig(config);
	const [worker, transport, staticEvaluator, datasetManifest] = await Promise.all([
		readFile(config.localWorkerPath, "utf8"),
		readFile(config.localTransportPath, "utf8"),
		readFile(config.localStaticEvaluatorPath, "utf8"),
		readFile(config.localDatasetManifestPath, "utf8"),
	]);
	if (sha256Text(staticEvaluator) !== NANOGPT_SCORED_STATIC_EVALUATOR_SHA256) {
		throw new Error("Local NanoGPT static evaluator pin changed");
	}
	if (sha256Text(datasetManifest) !== NANOGPT_SCORED_DATA_MANIFEST_SHA256) {
		throw new Error("Local NanoGPT scored dataset manifest pin changed");
	}
	parseDatasetManifest(datasetManifest);
	return {
		staticEvaluatorSha256: NANOGPT_SCORED_STATIC_EVALUATOR_SHA256,
		environmentSha256: NANOGPT_SCORED_ENVIRONMENT_SHA256,
		environmentSealSha256: NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
		datasetManifestSha256: NANOGPT_SCORED_DATA_MANIFEST_SHA256,
		workerSha256: sha256Text(worker),
		transportSha256: sha256Text(transport),
	};
}

function buildPreparedRequest(
	request: NanoGptScoredRequest,
	candidatePatch: string,
	local: LocalAssets,
	readiness: NanoGptScoredReadiness,
	config: NanoGptScoredTransportConfig,
): PreparedRequest {
	const requestJson = `${canonicalJson(toJsonValue(request))}\n`;
	const jobScript = buildNanoGptScoredJobScript(request, config);
	const assets: NanoGptScoredPreparedAsset[] = [
		{ path: "candidate.patch", mode: 0o400, content: candidatePatch },
		{ path: "dataset-manifest.json", mode: 0o400, content: local.datasetManifest },
		{ path: "environment.json", mode: 0o400, content: readiness.environment.manifest },
		{ path: "environment-seal.json", mode: 0o400, content: readiness.environment.seal },
		{ path: "job.sh", mode: 0o500, content: jobScript },
		{ path: "nanogpt_contract.py", mode: 0o400, content: local.staticEvaluator },
		{ path: "request.json", mode: 0o400, content: requestJson },
		{ path: "train_gpt_simple.py", mode: 0o400, content: local.baseline },
		{ path: "worker.py", mode: 0o500, content: local.worker },
	];
	if (!sameJson(assets.map((asset) => asset.path).sort(), [...PREPARED_ASSET_PATHS])) {
		throw new Error("NanoGPT scored prepared asset set changed");
	}
	return {
		remoteJobDir: nanoGptScoredRemoteJobDir(request.requestDigest, config),
		jobName: nanoGptScoredJobName(request.requestDigest),
		jobScriptSha256: sha256Text(jobScript),
		assets,
	};
}

function decodeVerifiedResult(poll: Extract<RemotePoll, { kind: "result" }>): Uint8Array {
	if (
		poll.resultByteLength < 2 ||
		poll.resultByteLength > MAX_RESULT_BYTES ||
		!SHA256_PATTERN.test(poll.resultSha256) ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(poll.resultBase64)
	) {
		throw new Error("NanoGPT scored result byte envelope is invalid");
	}
	const bytes = Buffer.from(poll.resultBase64, "base64");
	if (
		bytes.byteLength !== poll.resultByteLength ||
		bytes.toString("base64") !== poll.resultBase64 ||
		sha256Bytes(bytes) !== poll.resultSha256
	) {
		throw new Error("Fetched NanoGPT scored result bytes failed SHA-256 or length verification");
	}
	return bytes;
}

function utf8(bytes: Uint8Array, path: string): string {
	const source = Buffer.from(bytes).toString("utf8");
	if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error(`${path} is not valid UTF-8`);
	return source;
}

function validateTrialLogs(result: NanoGptScoredWorkerResult, logs: readonly TrialLogEvidence[]): void {
	if (new Set(logs.map((log) => log.name)).size !== logs.length) {
		throw new Error("Fetched NanoGPT result contains duplicate per-trial log paths");
	}
	const observed = logs.map((log, index) => {
		if (
			!SAFE_RELATIVE_LOG_PATH_PATTERN.test(log.name) ||
			log.name.split("/").some((part) => part === "" || part === "." || part === "..") ||
			!Number.isSafeInteger(log.byteLength) ||
			log.byteLength < 0 ||
			!SHA256_PATTERN.test(log.sha256)
		) {
			throw new Error(`poll.trialLogs[${index}] is invalid`);
		}
		return log.sha256;
	});
	const remaining = [...observed];
	for (const trial of result.trials) {
		const index = remaining.indexOf(trial.logSha256);
		if (index < 0) throw new Error("Fetched NanoGPT result names a missing or changed per-trial log");
		remaining.splice(index, 1);
	}
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function directoryPathChain(path: string): readonly string[] {
	const normalized = resolve(path);
	if (normalized !== path) throw new Error(`NanoGPT scored evidence path must be absolute and normalized: ${path}`);
	const chain: string[] = [];
	let current = normalized;
	for (;;) {
		chain.unshift(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return chain;
}

async function verifySafeDirectory(path: string): Promise<void> {
	for (const directory of directoryPathChain(path)) {
		const metadata = await lstat(directory);
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
			throw new Error(`NanoGPT scored evidence ancestor is not a regular directory: ${directory}`);
		}
	}
}

async function ensureSafeDirectory(path: string): Promise<void> {
	for (const directory of directoryPathChain(path)) {
		let metadata: Awaited<ReturnType<typeof lstat>>;
		try {
			metadata = await lstat(directory);
		} catch (error) {
			if (!isNotFound(error)) throw error;
			try {
				await mkdir(directory, { mode: 0o700 });
			} catch (mkdirError) {
				if (!isAlreadyExists(mkdirError)) throw mkdirError;
			}
			metadata = await lstat(directory);
		}
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
			throw new Error(`NanoGPT scored evidence ancestor is not a regular directory: ${directory}`);
		}
	}
}

async function verifyArchivedBytes(path: string, expectedSha256: string, expectedByteLength: number): Promise<void> {
	await verifySafeDirectory(dirname(path));
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error(`NanoGPT scored archived evidence is not a regular non-symlink file: ${path}`);
	}
	const bytes = await readFile(path);
	if (bytes.byteLength !== expectedByteLength || sha256Bytes(bytes) !== expectedSha256) {
		throw new Error(`NanoGPT scored archived evidence bytes changed: ${path}`);
	}
}

async function durableArchiveBytes(path: string, bytes: Uint8Array, expectedSha256: string): Promise<void> {
	if (sha256Bytes(bytes) !== expectedSha256)
		throw new Error("Refusing to archive trial-log bytes under a different hash");
	await ensureSafeDirectory(dirname(path));
	const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
	let temporaryCreated = false;
	try {
		const handle = await open(temporary, "wx", 0o600);
		temporaryCreated = true;
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		try {
			await link(temporary, path);
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
		}
	} finally {
		if (temporaryCreated) await unlink(temporary).catch(() => undefined);
	}
	await verifyArchivedBytes(path, expectedSha256, bytes.byteLength);
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

function archiveRoot(config: NanoGptScoredTransportConfig, requestDigest: string): string {
	sha256(requestDigest, "requestDigest");
	return join(config.localEvidenceDir, requestDigest.slice(0, 2), requestDigest);
}

function archiveManifestSource(requestDigest: string, logs: readonly NanoGptScoredArchivedTrialLog[]): string {
	return `${canonicalJson(
		toJsonValue({
			schemaVersion: 1,
			requestDigest,
			logs: logs.map((log) => ({
				remoteName: log.remoteName,
				logSha256: log.logSha256,
				byteLength: log.byteLength,
				relativePath: `logs/${log.logSha256}.log`,
			})),
		}),
	)}\n`;
}

async function durableArchiveManifest(
	config: NanoGptScoredTransportConfig,
	requestDigest: string,
	logs: readonly NanoGptScoredArchivedTrialLog[],
): Promise<NanoGptScoredArchiveEvidence> {
	const path = join(archiveRoot(config, requestDigest), "manifest.json");
	const source = archiveManifestSource(requestDigest, logs);
	await durableArchiveBytes(path, Buffer.from(source, "utf8"), sha256Text(source));
	return readArchiveManifest(config, requestDigest);
}

async function readArchiveManifest(
	config: NanoGptScoredTransportConfig,
	requestDigest: string,
): Promise<NanoGptScoredArchiveEvidence> {
	const root = archiveRoot(config, requestDigest);
	const path = join(root, "manifest.json");
	await verifySafeDirectory(root);
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error("NanoGPT scored archive manifest must be a regular non-symlink file");
	}
	const source = await readFile(path, "utf8");
	const parsed = record(JSON.parse(source), "NanoGPT scored archive manifest");
	exactKeys(parsed, ["schemaVersion", "requestDigest", "logs"], "NanoGPT scored archive manifest");
	if (parsed.schemaVersion !== 1 || parsed.requestDigest !== requestDigest || !Array.isArray(parsed.logs)) {
		throw new Error("NanoGPT scored archive manifest identity changed");
	}
	const logs = parsed.logs.map((value, index) => {
		const item = record(value, `archive.logs[${index}]`);
		exactKeys(item, ["remoteName", "logSha256", "byteLength", "relativePath"], `archive.logs[${index}]`);
		const remoteName = string(item.remoteName, `archive.logs[${index}].remoteName`);
		if (
			!SAFE_RELATIVE_LOG_PATH_PATTERN.test(remoteName) ||
			remoteName.split("/").some((part) => part === "" || part === "." || part === "..")
		) {
			throw new Error(`archive.logs[${index}].remoteName is unsafe`);
		}
		const logSha256 = sha256(item.logSha256, `archive.logs[${index}].logSha256`);
		const relativePath = string(item.relativePath, `archive.logs[${index}].relativePath`);
		const expectedRelativePath = `logs/${logSha256}.log`;
		const archived = {
			requestDigest,
			remoteName,
			logSha256,
			byteLength: safeInteger(item.byteLength, `archive.logs[${index}].byteLength`),
			path: join(root, expectedRelativePath),
		};
		if (
			archived.byteLength < 0 ||
			archived.byteLength > MAX_TRIAL_LOG_BYTES ||
			relativePath !== expectedRelativePath
		) {
			throw new Error(`archive.logs[${index}] escaped its content-addressed route`);
		}
		return archived;
	});
	if (archiveManifestSource(requestDigest, logs) !== source) {
		throw new Error("NanoGPT scored archive manifest is not canonical JSON");
	}
	if (new Set(logs.map((log) => log.remoteName)).size !== logs.length) {
		throw new Error("NanoGPT scored archive manifest contains duplicate remote log names");
	}
	for (const log of logs) await verifyArchivedBytes(log.path, log.logSha256, log.byteLength);
	const bytes = Buffer.from(source, "utf8");
	return {
		canonicalManifest: source,
		manifestByteLength: bytes.byteLength,
		manifestSha256: sha256Bytes(bytes),
		logs,
	};
}

function parseRemotePoll(raw: string): RemotePoll {
	const parsed = parseSingleJsonObject(raw, "NanoGPT scored poll");
	const kind = string(parsed.kind, "poll.kind");
	if (kind === "pending") {
		exactKeys(parsed, ["kind", "schedulerState"], "poll");
		return { kind, schedulerState: string(parsed.schedulerState, "poll.schedulerState") };
	}
	if (kind === "failed") {
		exactKeys(parsed, ["kind", "reason", "log"], "poll");
		return {
			kind,
			reason: string(parsed.reason, "poll.reason"),
			log: typeof parsed.log === "string" ? parsed.log : "",
		};
	}
	if (kind !== "result") throw new Error(`Unknown NanoGPT scored poll kind: ${kind}`);
	exactKeys(
		parsed,
		["kind", "resultBase64", "resultByteLength", "resultSha256", "log", "trialLogs", "scheduler"],
		"poll",
	);
	if (!Array.isArray(parsed.trialLogs)) throw new Error("poll.trialLogs must be an array");
	const trialLogs = parsed.trialLogs.map((value, index) => {
		const item = record(value, `poll.trialLogs[${index}]`);
		exactKeys(item, ["name", "byteLength", "sha256"], `poll.trialLogs[${index}]`);
		return {
			name: string(item.name, `poll.trialLogs[${index}].name`),
			byteLength: safeInteger(item.byteLength, `poll.trialLogs[${index}].byteLength`),
			sha256: sha256(item.sha256, `poll.trialLogs[${index}].sha256`),
		};
	});
	const schedulerRecord = record(parsed.scheduler, "poll.scheduler");
	exactKeys(schedulerRecord, ["slurmJobId", "jobName", "workDir", "state", "exitCode"], "poll.scheduler");
	const scheduler = {
		slurmJobId: string(schedulerRecord.slurmJobId, "poll.scheduler.slurmJobId"),
		jobName: string(schedulerRecord.jobName, "poll.scheduler.jobName"),
		workDir: string(schedulerRecord.workDir, "poll.scheduler.workDir"),
		state: schedulerRecord.state,
		exitCode: schedulerRecord.exitCode,
	};
	if (
		!SLURM_ID_PATTERN.test(scheduler.slurmJobId) ||
		!/^pngs-[0-9a-f]{24}$/.test(scheduler.jobName) ||
		scheduler.state !== "COMPLETED" ||
		scheduler.exitCode !== "0:0"
	) {
		throw new Error("NanoGPT scored poll lacks authoritative COMPLETED/0:0 scheduler evidence");
	}
	validateAbsolutePath(scheduler.workDir, "poll.scheduler.workDir");
	return {
		kind,
		resultBase64: string(parsed.resultBase64, "poll.resultBase64"),
		resultByteLength: safeInteger(parsed.resultByteLength, "poll.resultByteLength"),
		resultSha256: sha256(parsed.resultSha256, "poll.resultSha256"),
		log: typeof parsed.log === "string" ? parsed.log : "",
		trialLogs,
		scheduler: scheduler as NanoGptScoredAuthoritativeSchedulerEvidence,
	};
}

export class SshNanoGptScoredTransport implements NanoGptScoredTransport {
	private readonly config: NanoGptScoredTransportConfig;
	private readonly runner: NanoGptScoredCommandRunner;

	constructor(
		config: NanoGptScoredTransportConfig = DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
		dependencies: NanoGptScoredTransportDependencies = {},
	) {
		this.config = { ...config, reconcileTimeoutMs: { ...config.reconcileTimeoutMs } };
		validateConfig(this.config);
		this.runner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
	}

	private async remotePython(
		source: string,
		args: readonly string[],
		input: string | undefined,
		signal: AbortSignal,
		timeoutMs = this.config.commandTimeoutMs,
		maxOutputBytes = MAX_COMMAND_OUTPUT_BYTES,
	): Promise<CompilerGymWarmCommandResult> {
		if (signal.aborted) throw abortReason(signal);
		if (input !== undefined && Buffer.byteLength(input) > MAX_PREPARE_INPUT_BYTES) {
			throw new Error(`NanoGPT scored remote input exceeds ${MAX_PREPARE_INPUT_BYTES} bytes`);
		}
		const encodedSource = Buffer.from(source, "utf8").toString("base64");
		const bootstrap =
			"import base64,sys;source=base64.b64decode(sys.argv[1],validate=True);" +
			"sys.argv=[sys.argv[0],*sys.argv[2:]];exec(compile(source,'<nanogpt-scored-remote>','exec'))";
		const request: CompilerGymWarmCommandRequest = {
			argv: compilerGymWarmSshArgv(this.config.host, [
				this.config.remotePython,
				"-I",
				"-c",
				bootstrap,
				encodedSource,
				...args,
			]),
			input,
			signal,
			timeoutMs,
			maxOutputBytes,
		};
		const result = await this.runner.run(request);
		if (result.exitCode !== 0) {
			const message = formatCommandFailure(result);
			if (isTransientCommandFailure(result)) throw new KernelBenchTransientTransportError(message);
			throw new Error(message);
		}
		return result;
	}

	private async retryTransient<T>(
		operation: () => Promise<T>,
		signal: AbortSignal,
		deadline: number | null,
	): Promise<T> {
		let attempt = 0;
		for (;;) {
			try {
				return await operation();
			} catch (error) {
				if (
					!(error instanceof KernelBenchTransientTransportError) ||
					(deadline !== null && Date.now() >= deadline)
				) {
					throw error;
				}
				const exponentialMs = 100 * 2 ** Math.min(attempt, 6);
				const remainingMs = deadline === null ? this.config.pollIntervalMs : deadline - Date.now();
				const backoffMs = Math.max(1, Math.min(exponentialMs, this.config.pollIntervalMs, remainingMs));
				attempt++;
				await delay(backoffMs, signal);
			}
		}
	}

	private async remoteReadiness(
		request: NanoGptScoredRequest,
		local: LocalAssets,
		signal: AbortSignal,
	): Promise<NanoGptScoredReadiness> {
		const result = await this.remotePython(
			NANOGPT_SCORED_READINESS_REMOTE,
			[
				this.config.environmentDir,
				this.config.datasetRoot,
				request.pins.environmentSha256,
				request.pins.datasetManifestSha256,
			],
			undefined,
			signal,
			this.config.readinessTimeoutMs,
		);
		return parseNanoGptScoredReadiness(result.stdout, request, local.datasetManifest, this.config);
	}

	async readiness(request: NanoGptScoredRequest, signal: AbortSignal): Promise<NanoGptScoredReadiness> {
		verifyNanoGptScoredRequest(request);
		const local = await readPinnedLocalAssets(request, this.config);
		return this.remoteReadiness(request, local, signal);
	}

	private async prepareRemote(
		prepared: PreparedRequest,
		request: NanoGptScoredRequest,
		signal: AbortSignal,
	): Promise<void> {
		const payload = JSON.stringify({
			files: prepared.assets.map((asset) => ({
				path: asset.path,
				mode: asset.mode,
				content: Buffer.from(asset.content, "utf8").toString("base64"),
			})),
		});
		const result = await this.remotePython(
			NANOGPT_SCORED_PREPARE_REMOTE,
			[prepared.remoteJobDir, this.config.remoteRoot, request.requestDigest],
			payload,
			signal,
		);
		const parsed = parseSingleJsonObject(result.stdout, "NanoGPT scored prepare");
		exactKeys(parsed, ["prepared", "requestDigest"], "prepare");
		if (parsed.prepared !== prepared.remoteJobDir || parsed.requestDigest !== request.requestDigest) {
			throw new Error("NanoGPT scored prepare acknowledgement escaped its content-addressed request");
		}
	}

	private async ensureSubmitted(
		prepared: PreparedRequest,
		request: NanoGptScoredRequest,
		signal: AbortSignal,
	): Promise<{ readonly slurmJobId: string }> {
		for (;;) {
			const result = await this.remotePython(
				NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE,
				[
					prepared.remoteJobDir,
					this.config.remoteRoot,
					request.requestDigest,
					prepared.jobName,
					String(this.config.dispatchVisibilityGraceMs / 1_000),
				],
				undefined,
				signal,
			);
			const parsed = parseSingleJsonObject(result.stdout, "NanoGPT scored dispatch");
			const kind = string(parsed.kind, "dispatch.kind");
			if (kind === "submitted") {
				const slurmJobId = string(parsed.slurmJobId, "dispatch.slurmJobId");
				if (!SLURM_ID_PATTERN.test(slurmJobId)) throw new Error("NanoGPT scored SLURM ID is invalid");
				return { slurmJobId };
			}
			if (kind === "ambiguous") throw new Error(string(parsed.reason, "dispatch.reason"));
			if (kind !== "reconciling") throw new Error(`Unknown NanoGPT scored dispatch kind: ${kind}`);
			const retryAfterMs = safeInteger(parsed.retryAfterMs, "dispatch.retryAfterMs");
			await delay(Math.max(1, Math.min(retryAfterMs, this.config.pollIntervalMs)), signal);
		}
	}

	private async poll(prepared: PreparedRequest, signal: AbortSignal): Promise<RemotePoll> {
		const result = await this.remotePython(
			NANOGPT_SCORED_POLL_REMOTE,
			[prepared.remoteJobDir, prepared.jobName, String(this.config.resultVisibilityGraceMs / 1_000)],
			undefined,
			signal,
		);
		return parseRemotePoll(result.stdout);
	}

	private async fetchTrialLog(
		prepared: PreparedRequest,
		log: TrialLogEvidence,
		signal: AbortSignal,
	): Promise<Uint8Array> {
		const result = await this.remotePython(
			NANOGPT_SCORED_FETCH_TRIAL_LOG_REMOTE,
			[prepared.remoteJobDir, log.name, log.sha256, String(log.byteLength)],
			undefined,
			signal,
			this.config.commandTimeoutMs,
			MAX_LOG_COMMAND_OUTPUT_BYTES,
		);
		const parsed = parseSingleJsonObject(result.stdout, "NanoGPT scored trial-log fetch");
		exactKeys(parsed, ["name", "byteLength", "sha256", "contentBase64"], "trial-log fetch");
		if (
			parsed.name !== log.name ||
			parsed.byteLength !== log.byteLength ||
			parsed.sha256 !== log.sha256 ||
			typeof parsed.contentBase64 !== "string"
		) {
			throw new Error("Fetched NanoGPT scored trial-log envelope changed");
		}
		if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(parsed.contentBase64)) {
			throw new Error("Fetched NanoGPT scored trial log is not canonical base64");
		}
		const bytes = Buffer.from(parsed.contentBase64, "base64");
		if (
			bytes.toString("base64") !== parsed.contentBase64 ||
			bytes.byteLength !== log.byteLength ||
			bytes.byteLength > MAX_TRIAL_LOG_BYTES ||
			sha256Bytes(bytes) !== log.sha256
		) {
			throw new Error("Fetched NanoGPT scored trial-log bytes failed SHA-256 or length verification");
		}
		return bytes;
	}

	private async archiveTrialLogs(
		request: NanoGptScoredRequest,
		prepared: PreparedRequest,
		logs: readonly TrialLogEvidence[],
		signal: AbortSignal,
	): Promise<NanoGptScoredArchiveEvidence> {
		const archived: NanoGptScoredArchivedTrialLog[] = [];
		for (const log of logs) {
			const bytes = await this.fetchTrialLog(prepared, log, signal);
			const path = join(archiveRoot(this.config, request.requestDigest), "logs", `${log.sha256}.log`);
			await durableArchiveBytes(path, bytes, log.sha256);
			archived.push({
				requestDigest: request.requestDigest,
				remoteName: log.name,
				logSha256: log.sha256,
				byteLength: log.byteLength,
				path,
			});
		}
		return durableArchiveManifest(this.config, request.requestDigest, archived);
	}

	async readArchivedTrialLogs(requestDigest: string): Promise<readonly NanoGptScoredArchivedTrialLog[]> {
		return (await readArchiveManifest(this.config, requestDigest)).logs;
	}

	readArchiveEvidence(requestDigest: string): Promise<NanoGptScoredArchiveEvidence> {
		return readArchiveManifest(this.config, requestDigest);
	}

	private async reconcile(
		request: NanoGptScoredRequest,
		candidatePatch: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredTransportResult> {
		verifyNanoGptScoredRequest(request);
		if (
			sha256Text(candidatePatch) !== request.candidatePatch.digest ||
			Buffer.byteLength(candidatePatch, "utf8") !== request.candidatePatch.byteLength
		) {
			throw new Error("NanoGPT scored candidate patch bytes differ from the exact request artifact");
		}
		if (signal.aborted) throw abortReason(signal);
		const configuredTimeoutMs = this.config.reconcileTimeoutMs[request.mode];
		const deadline = configuredTimeoutMs === null ? null : Date.now() + configuredTimeoutMs;
		const local = await readPinnedLocalAssets(request, this.config);
		const readiness = await this.retryTransient(() => this.remoteReadiness(request, local, signal), signal, deadline);
		const prepared = buildPreparedRequest(request, candidatePatch, local, readiness, this.config);
		await this.retryTransient(() => this.prepareRemote(prepared, request, signal), signal, deadline);
		const dispatch = await this.retryTransient(
			() => this.ensureSubmitted(prepared, request, signal),
			signal,
			deadline,
		);
		let schedulerState = "SUBMITTED";
		for (;;) {
			const poll = await this.retryTransient(() => this.poll(prepared, signal), signal, deadline);
			if (poll.kind === "result") {
				const bytes = decodeVerifiedResult(poll);
				const value: unknown = JSON.parse(utf8(bytes, "NanoGPT scored result"));
				const result = parseNanoGptScoredWorkerResult(value, request);
				if (result.slurmJobId !== dispatch.slurmJobId) {
					throw new Error("NanoGPT scored result SLURM ID differs from the durable dispatch");
				}
				if (
					poll.scheduler.slurmJobId !== dispatch.slurmJobId ||
					poll.scheduler.jobName !== prepared.jobName ||
					poll.scheduler.workDir !== prepared.remoteJobDir
				) {
					throw new Error("NanoGPT scored authoritative sacct evidence differs from the durable dispatch");
				}
				validateTrialLogs(result, poll.trialLogs);
				const archive = await this.archiveTrialLogs(request, prepared, poll.trialLogs, signal);
				return {
					schemaVersion: 1,
					requestDigest: request.requestDigest,
					externalHandle: nanoGptScoredExternalHandle(request.requestDigest),
					jobScriptSha256: prepared.jobScriptSha256,
					scheduler: poll.scheduler,
					workerResult: result,
					archive,
				};
			}
			if (poll.kind === "failed") {
				throw new Error(poll.log ? `${poll.reason}\n${poll.log}` : poll.reason);
			}
			schedulerState = poll.schedulerState;
			if (deadline !== null && Date.now() >= deadline) {
				throw new NanoGptScoredReconcileTimeoutError(
					request,
					prepared.remoteJobDir,
					schedulerState,
					configuredTimeoutMs ?? 0,
				);
			}
			const remainingMs = deadline === null ? this.config.pollIntervalMs : deadline - Date.now();
			await delay(Math.max(1, Math.min(this.config.pollIntervalMs, remainingMs)), signal);
		}
	}

	execute(
		request: NanoGptScoredRequest,
		candidatePatch: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredTransportResult> {
		return this.reconcile(request, candidatePatch, signal);
	}

	async resume(
		request: NanoGptScoredRequest,
		candidatePatch: string,
		externalHandle: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredTransportResult> {
		if (
			parseNanoGptScoredExternalHandle(externalHandle) !== request.requestDigest ||
			externalHandle !== nanoGptScoredExternalHandle(request.requestDigest)
		) {
			throw new Error("NanoGPT scored external handle does not belong to this exact request digest");
		}
		return this.reconcile(request, candidatePatch, signal);
	}
}

import { spawn } from "node:child_process";
import { link, mkdir, mkdtemp, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { KERNELBENCH_COMPILED_ENVIRONMENT_SHA256 } from "./kernelbench-compiled-qualification-adapter.js";
import {
	KERNELBENCH_CANCEL_REMOTE,
	KERNELBENCH_ENSURE_SUBMITTED_REMOTE,
	KERNELBENCH_VERIFIED_COMMIT,
	KernelBenchTransientTransportError,
} from "./kernelbench-qualification-adapter.js";
import { EvidenceLedger, type LedgerEvent, type LedgerEventKind } from "./ledger.js";
import { NANOGPT_BASELINE_FIXTURE, NANOGPT_BASELINE_SHA256 } from "./nanogpt-contract.js";
import {
	materializeNanoGptRuntime,
	NANOGPT_RUNTIME_CANDIDATE_NAME,
	NANOGPT_RUNTIME_CLAIM_SCOPE,
	NANOGPT_RUNTIME_CONTRACT_ID,
	NANOGPT_RUNTIME_MANIFEST_NAME,
	NANOGPT_RUNTIME_PROGRAM_NAME,
	type NanoGptRuntimeCommandResult,
	type NanoGptRuntimeManifest,
	parseNanoGptRuntimeCommandResult,
	verifyNanoGptRuntimeBundle,
} from "./nanogpt-runtime.js";

export const NANOGPT_FARMSHARE_SMOKE_CONTRACT = "nanogpt-farmshare-stock-cuda-smoke-v1" as const;
export const NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS = "infrastructure-only-stock-smoke" as const;
export const NANOGPT_SMOKE_DATA_MANIFEST_SHA256 =
	"21e5ec359d94b274cc5dcd072b99bf5fa9132b4a34a414d062f151dc8cbdfd40" as const;
export const NANOGPT_STOCK_SMOKE_MANIFEST_SHA256 =
	"79f238c695fb18fc3d578bb72606b3876931cd60aebdac88fb10c6fe54bbb67a" as const;
export const NANOGPT_STOCK_SMOKE_RUNTIME_SHA256 =
	"318afff0bf5f1e815ce2b93ebbb90dd50d898a19bc9d7c77d03694cb05fa6be7" as const;
export const NANOGPT_STOCK_SMOKE_RUNTIME_EVALUATOR_SHA256 =
	"332ca9680087fa43fa93f75219716ea78dbb339441cdda5d64986efce766b5f5" as const;
export const NANOGPT_STOCK_SMOKE_STATIC_EVALUATOR_SHA256 =
	"007dd1ef186f003906828f05369974e1096619f1e1f74617fce6d8ce6da20c4c" as const;
export const NANOGPT_REUSED_ENVIRONMENT_DIR =
	`/scratch/users/duynguy/prime-autoresearch/kernelbench-compiled/envs/${KERNELBENCH_COMPILED_ENVIRONMENT_SHA256}` as const;
export const NANOGPT_SMOKE_DATA_FILES = [
	{
		path: "fineweb_val_000000.bin",
		size: 200_001_024,
		sha256: "5b95c8e0966f0861685b307b23dc5ae42b228ef74b28cb499784ae021f201640",
	},
	{
		path: "fineweb_train_000001.bin",
		size: 200_001_024,
		sha256: "771fa4a99b9fe0946ffb6e848b4ba5c6a9b0fe87860ebf03bc2c1c7e45f8178e",
	},
] as const;
export const NANOGPT_SMOKE_DATA_HEADERS = [
	{ path: "fineweb_val_000000.bin", magic: 20_240_520, version: 1, tokens: 100_000_000 },
	{ path: "fineweb_train_000001.bin", magic: 20_240_520, version: 1, tokens: 100_000_000 },
] as const;
export const NANOGPT_SMOKE_DATA_CONSUMPTION = {
	validationTokens: 10_485_760,
	trainingTokensForTenSteps: 5_242_880,
} as const;
export const NANOGPT_SMOKE_LAUNCH_ENVIRONMENT_KEYS = [
	"CUDA_DEVICE_ORDER",
	"CUDA_VISIBLE_DEVICES",
	"HOME",
	"LC_ALL",
	"PATH",
	"PYTHONDONTWRITEBYTECODE",
	"PYTHONNOUSERSITE",
	"PYTHON_EXEC",
	"SLURM_JOB_ID",
	"TMPDIR",
	"TORCHINDUCTOR_CACHE_DIR",
] as const;
export const NANOGPT_SMOKE_FORBIDDEN_ENVIRONMENT = ["WANDB_API_KEY", "WANDB_MODE", "WANDB_ENTITY"] as const;
export const NANOGPT_SMOKE_TORCHRUN_ARGS = [
	"--standalone",
	"--nnodes=1",
	"--nproc-per-node=1",
	NANOGPT_RUNTIME_PROGRAM_NAME,
	"1",
] as const;
export const NANOGPT_SMOKE_RUNTIME_PROCESS_ARGS = [
	"-I",
	`${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin/torchrun`,
	...NANOGPT_SMOKE_TORCHRUN_ARGS,
] as const;
export function buildNanoGptIsolatedPythonSource(): string {
	return `#!/bin/sh\nexec '${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin/python' -I "$@"\n`;
}
export const NANOGPT_TERMINAL_SLURM_STATES = [
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

export function isNanoGptTerminalSlurmState(state: string): boolean {
	const normalized = state.split("|", 1)[0].split("+", 1)[0].trim().toUpperCase();
	return (NANOGPT_TERMINAL_SLURM_STATES as readonly string[]).includes(normalized);
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
const EXPECTED_PYTHON = "3.12.3";
const EXPECTED_PIP = "25.2";
const EXPECTED_TORCH = "2.11.0+cu128";
const EXPECTED_TORCH_CUDA = "12.8";
const EXPECTED_NUMPY = "2.5.2";
const EXPECTED_ENVIRONMENT_MANIFEST_SHA256 = "71ddfe105be64b7122d7b6d143ea1a6c26a5b9de30cc414a9cbd9df7cd314de8";
const EXPECTED_PIP_FREEZE_SHA256 = "b85ceb87080994284c997e0ea3742246df1a12d4fc2551a9d8412d87160766d9";
const EXPECTED_ENVIRONMENT_SEAL_SHA256 = "c3016d0d77837dad553847c6db0ae96cd1cd4fdce5ba2144306550a8f7b9d576";
export const NANOGPT_REUSED_ENVIRONMENT_EXECUTABLES = {
	python: {
		path: `${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin/python`,
		linkTarget: "python3",
		python3LinkTarget: "/usr/bin/python3",
		resolvedPath: "/usr/bin/python3.12",
		sha256: "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118",
		size: 8_020_928,
	},
	torchrun: {
		path: `${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin/torchrun`,
		sha256: "7ff57f7f5ee11cc74839fda7b12e2a97fd2808dd00ae1eafd05f302df5def748",
		size: 367,
		mode: 0o555,
	},
} as const;
const FIXED_REMOTE_ROOT = "/scratch/users/duynguy/prime-autoresearch/nanogpt";
const RESULT_VISIBILITY_GRACE_FILE = "terminal-result-visibility-grace";
const NANOGPT_SMOKE_CLAIM_BOUNDARY = "infrastructure-only; not candidate-quality or scored evidence";
const PREPARED_ASSET_PATHS = [
	"bundle/candidate.source.py",
	"bundle/runtime-manifest.json",
	"bundle/train_gpt_runtime.py",
	"dataset-manifest.json",
	"gate/evaluators/nanogpt_contract.py",
	"gate/evaluators/nanogpt_runtime.py",
	"gate/fixtures/nanogpt/train_gpt_simple.py",
	"isolated-python",
	"job.sh",
	"request.json",
	"worker.py",
] as const;

export interface NanoGptFarmShareSmokeConfig {
	readonly host: string;
	readonly partition: string;
	readonly constraint: string;
	readonly remoteRoot: typeof FIXED_REMOTE_ROOT;
	readonly pollIntervalMs: number;
	readonly requestTimeoutMs: number;
	readonly dispatchVisibilityGraceMs: number;
	readonly resultVisibilityGraceMs: number;
}

export const DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG: NanoGptFarmShareSmokeConfig = {
	host: "farmshare",
	partition: "gpu",
	constraint: "GPU_SKU:L40S",
	remoteRoot: FIXED_REMOTE_ROOT,
	pollIntervalMs: 10_000,
	requestTimeoutMs: 1_800_000,
	dispatchVisibilityGraceMs: 120_000,
	resultVisibilityGraceMs: 120_000,
};

export interface NanoGptSmokeEnvironmentEvidence {
	readonly source: "reused-kernelbench-compiled-environment";
	readonly directory: typeof NANOGPT_REUSED_ENVIRONMENT_DIR;
	readonly environmentSpecSha256: typeof KERNELBENCH_COMPILED_ENVIRONMENT_SHA256;
	readonly environmentManifestSha256: string;
	readonly pipFreezeSha256: string;
	readonly environmentSealSha256: string;
	readonly environmentManifest: string;
	readonly pipFreeze: string;
	readonly environmentSeal: string;
	readonly executables: typeof NANOGPT_REUSED_ENVIRONMENT_EXECUTABLES;
	readonly python: typeof EXPECTED_PYTHON;
	readonly pip: typeof EXPECTED_PIP;
	readonly torch: typeof EXPECTED_TORCH;
	readonly torchCuda: typeof EXPECTED_TORCH_CUDA;
	readonly numpy: typeof EXPECTED_NUMPY;
}

export interface NanoGptSmokeDatasetEvidence {
	readonly directory: string;
	readonly manifestSha256: typeof NANOGPT_SMOKE_DATA_MANIFEST_SHA256;
	readonly manifest: string;
	readonly files: typeof NANOGPT_SMOKE_DATA_FILES;
	readonly headers: typeof NANOGPT_SMOKE_DATA_HEADERS;
	readonly consumption: typeof NANOGPT_SMOKE_DATA_CONSUMPTION;
}

export interface NanoGptSmokeReadiness {
	readonly environment: NanoGptSmokeEnvironmentEvidence;
	readonly dataset: NanoGptSmokeDatasetEvidence;
}

export interface NanoGptSmokeExecutionSeal {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_FARMSHARE_SMOKE_CONTRACT;
	readonly evidenceClass: typeof NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS;
	readonly workerSha256: string;
	readonly bundle: {
		readonly runtimeContract: typeof NANOGPT_RUNTIME_CONTRACT_ID;
		readonly claimScope: typeof NANOGPT_RUNTIME_CLAIM_SCOPE;
		readonly mode: "cuda-smoke-10";
		readonly trials: 1;
		readonly manifestSha256: typeof NANOGPT_STOCK_SMOKE_MANIFEST_SHA256;
		readonly candidateSha256: typeof NANOGPT_BASELINE_SHA256;
		readonly runtimeSha256: typeof NANOGPT_STOCK_SMOKE_RUNTIME_SHA256;
		readonly runtimeEvaluatorSha256: typeof NANOGPT_STOCK_SMOKE_RUNTIME_EVALUATOR_SHA256;
		readonly staticEvaluatorSha256: typeof NANOGPT_STOCK_SMOKE_STATIC_EVALUATOR_SHA256;
		readonly baselineSha256: typeof NANOGPT_BASELINE_SHA256;
	};
	readonly environment: Omit<NanoGptSmokeEnvironmentEvidence, "environmentManifest" | "pipFreeze" | "environmentSeal">;
	readonly dataset: Omit<NanoGptSmokeDatasetEvidence, "manifest">;
	readonly launch: {
		readonly executable: string;
		readonly args: typeof NANOGPT_SMOKE_RUNTIME_PROCESS_ARGS;
		readonly worldSize: 1;
		readonly gpus: 1;
		readonly cwdPolicy: "fresh-job-directory";
		readonly environmentKeys: typeof NANOGPT_SMOKE_LAUNCH_ENVIRONMENT_KEYS;
		readonly forbiddenEnvironment: typeof NANOGPT_SMOKE_FORBIDDEN_ENVIRONMENT;
	};
	readonly slurm: {
		readonly partition: "gpu";
		readonly constraint: "GPU_SKU:L40S";
		readonly nodes: 1;
		readonly tasks: 1;
		readonly gpus: 1;
		readonly cpus: 8;
		readonly memory: "32G";
		readonly time: "00:30:00";
		readonly export: "NONE";
	};
}

export interface NanoGptSmokePreparedAsset {
	readonly path: (typeof PREPARED_ASSET_PATHS)[number];
	readonly mode: 0o400 | 0o500;
	readonly content: string;
}

export interface NanoGptSmokePreparedAssets {
	readonly requestJson: string;
	readonly jobScript: string;
	readonly files: readonly NanoGptSmokePreparedAsset[];
}

export type NanoGptSmokeRemotePoll =
	| { readonly kind: "pending"; readonly schedulerState: string }
	| { readonly kind: "result"; readonly rawResult: string; readonly log: string }
	| { readonly kind: "failed"; readonly reason: string; readonly log: string };

export interface NanoGptSmokeExistingResult {
	readonly rawResult: string;
	readonly log: string;
	readonly slurmJobId: string;
}

export interface NanoGptFarmShareSmokeTransport {
	readiness(
		remoteRoot: string,
		environmentDir: string,
		datasetManifestSha256: string,
		signal: AbortSignal,
	): Promise<string>;
	prepare(remoteJobDir: string, assets: NanoGptSmokePreparedAssets, signal: AbortSignal): Promise<void>;
	readExistingResult(remoteJobDir: string, signal: AbortSignal): Promise<NanoGptSmokeExistingResult | null>;
	ensureSubmitted(
		remoteJobDir: string,
		jobName: string,
		signal: AbortSignal,
	): Promise<{ readonly slurmJobId: string }>;
	poll(remoteJobDir: string, signal: AbortSignal): Promise<NanoGptSmokeRemotePoll>;
	cancelAndVerify(remoteJobDir: string, slurmJobId: string, signal: AbortSignal): Promise<string>;
}

export interface NanoGptFarmShareWorkerResult {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_FARMSHARE_SMOKE_CONTRACT;
	readonly evidenceClass: typeof NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS;
	readonly ok: boolean;
	readonly jobKey: string;
	readonly requestSha256: string;
	readonly workerSha256: string;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly slurmJobId: string;
	readonly executionSeal: NanoGptSmokeExecutionSeal;
	readonly environmentEvidence: Record<string, unknown>;
	readonly datasetEvidence: Record<string, unknown>;
	readonly launchEnvironmentKeys: readonly string[];
	readonly runtimeExitCode: number | null;
	readonly gateVerification: NanoGptRuntimeCommandResult | null;
	readonly gateExtraction: NanoGptRuntimeCommandResult | null;
	readonly integrityEvidence: {
		readonly preRun: Record<string, unknown> | null;
		readonly preRunSha256: string | null;
		readonly postRun: Record<string, unknown> | null;
		readonly postRunSha256: string | null;
		readonly stable: boolean;
	};
	readonly failure: { readonly kind: string; readonly message: string } | null;
}

export interface NanoGptFarmShareSmokeLocalResult {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_FARMSHARE_SMOKE_CONTRACT;
	readonly evidenceClass: typeof NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS;
	readonly ok: boolean;
	readonly recoveredRemoteResult: boolean;
	readonly jobKey: string;
	readonly remoteJobDir: string;
	readonly slurmJobId: string | null;
	readonly requestSha256: string;
	readonly executionSeal: NanoGptSmokeExecutionSeal;
	readonly readiness: NanoGptSmokeReadiness;
	readonly workerResult: NanoGptFarmShareWorkerResult | null;
	readonly controllerFailure: string | null;
	readonly ledgerPath: string;
	readonly ledgerTerminalHash: string;
}

export interface NanoGptFarmShareSmokeSubmission {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_FARMSHARE_SMOKE_CONTRACT;
	readonly evidenceClass: typeof NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS;
	readonly status: "queued" | "result-ready";
	readonly recoveredRemoteResult: boolean;
	readonly outputDir: string;
	readonly jobKey: string;
	readonly remoteJobDir: string;
	readonly slurmJobId: string;
	readonly requestSha256: string;
	readonly executionSeal: NanoGptSmokeExecutionSeal;
	readonly readiness: NanoGptSmokeReadiness;
	readonly workerResult: NanoGptFarmShareWorkerResult | null;
	readonly ledgerPath: string;
	readonly ledgerTerminalHash: string;
}

export type NanoGptFarmShareSmokeReconcileResult =
	| {
			readonly status: "pending";
			readonly schedulerState: string;
			readonly submission: NanoGptFarmShareSmokeSubmission;
			readonly ledgerTerminalHash: string;
	  }
	| { readonly status: "completed"; readonly result: NanoGptFarmShareSmokeLocalResult };

export interface RunNanoGptFarmShareSmokeOptions {
	readonly outputDir: string;
	readonly config?: NanoGptFarmShareSmokeConfig;
	readonly transport?: NanoGptFarmShareSmokeTransport;
	readonly signal?: AbortSignal;
}

export interface ReconcileNanoGptFarmShareSmokeOptions {
	readonly submission: NanoGptFarmShareSmokeSubmission;
	readonly config?: NanoGptFarmShareSmokeConfig;
	readonly transport?: NanoGptFarmShareSmokeTransport;
	readonly signal?: AbortSignal;
	readonly wait?: boolean;
}

interface ProcessResult {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

interface LocalBundleAssets {
	readonly manifest: NanoGptRuntimeManifest;
	readonly manifestSource: string;
	readonly candidateSource: string;
	readonly runtimeSource: string;
	readonly runtimeEvaluatorSource: string;
	readonly staticEvaluatorSource: string;
	readonly baselineSource: string;
	readonly workerSource: string;
	readonly datasetManifestSource: string;
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

function expectNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected finite number at ${path}`);
	return value;
}

function expectBoolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new Error(`Expected boolean at ${path}`);
	return value;
}

function expectSha256(value: unknown, path: string): string {
	const digest = expectString(value, path);
	if (!HASH_PATTERN.test(digest)) throw new Error(`Expected SHA-256 at ${path}`);
	return digest;
}

function expectIsoTimestamp(value: unknown, path: string): string {
	const timestamp = expectString(value, path);
	if (!timestamp.endsWith("Z") || !Number.isFinite(Date.parse(timestamp))) {
		throw new Error(`Expected UTC ISO timestamp at ${path}`);
	}
	return timestamp;
}

function expectExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = new Set(keys);
	const missing = keys.filter((key) => !(key in record));
	const extra = Object.keys(record).filter((key) => !expected.has(key));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(`Keys mismatch at ${path}: missing=${missing.join(",")} extra=${extra.join(",")}`);
	}
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function sameJson(left: unknown, right: unknown): boolean {
	return sha256Json(left) === sha256Json(right);
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
	return new Promise((resolvePromise, reject) => {
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
			resolvePromise({
				exitCode,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
		if (input === undefined) child.stdin.end();
		else child.stdin.end(input, "utf8");
	});
}

function formatCommandFailure(result: ProcessResult): string {
	return [
		`FarmShare command failed (exit ${result.exitCode ?? "signal"})`,
		`stdout:\n${result.stdout || "<empty>"}`,
		`stderr:\n${result.stderr || "<empty>"}`,
	].join("\n");
}

function isTransientCommandFailure(result: ProcessResult): boolean {
	if (result.exitCode === 255 || result.exitCode === null) return true;
	return /\b(?:squeue|sacct|sbatch|scancel|slurmctld|slurmdbd)\b|connection (?:closed|refused|reset)|timed? out|temporary failure/i.test(
		`${result.stdout}\n${result.stderr}`,
	);
}

export const NANOGPT_SMOKE_READINESS_REMOTE = `
import hashlib, importlib.metadata, json, os, pathlib, stat, struct, subprocess, sys
root = pathlib.Path(sys.argv[1])
environment = pathlib.Path(sys.argv[2])
manifest_digest = sys.argv[3]
dataset = root / "data" / manifest_digest / "fineweb10B"
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
    raise SystemExit("sealed environment directory is missing or a symlink")
if dataset.is_symlink() or not dataset.is_dir():
    raise SystemExit("sealed dataset directory is missing or a symlink")
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
if str(python_resolved) != "/usr/bin/python3.12":
    raise SystemExit("sealed Python executable target changed")
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
if (environment / "READY").read_text(encoding="utf-8").strip() != environment.name:
    raise SystemExit("sealed environment READY mismatch")
if (dataset / "READY").read_text(encoding="utf-8").strip() != manifest_digest:
    raise SystemExit("sealed dataset READY mismatch")
runtime_source = """
import importlib.metadata
import json
import platform
import torch
print(json.dumps({
    "python": platform.python_version(),
    "pip": importlib.metadata.version("pip"),
    "torch": torch.__version__,
    "torchCuda": torch.version.cuda,
    "numpy": importlib.metadata.version("numpy"),
}, sort_keys=True))
"""
runtime_environment = {
    "PATH": f"{environment / 'bin'}:/usr/bin:/bin",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONNOUSERSITE": "1",
}
runtime = json.loads(subprocess.run(
    [str(environment / "bin/python"), "-c", runtime_source],
    check=True,
    capture_output=True,
    text=True,
    env=runtime_environment,
).stdout)
dataset_manifest = (dataset / "dataset-manifest.json").read_text(encoding="utf-8")
manifest = json.loads(dataset_manifest)
files = manifest.get("files")
if not isinstance(files, list) or len(files) != 2:
    raise SystemExit("sealed dataset must contain exactly two manifest files")
data_files = []
data_headers = []
for item in files:
    path = dataset / item["path"]
    regular(path, str(path))
    data_files.append({"path": item["path"], "size": path.stat().st_size, "sha256": sha256(path)})
    with path.open("rb") as stream:
        prefix = stream.read(12)
    if len(prefix) != 12:
        raise SystemExit("truncated dataset header: " + item["path"])
    magic, version, tokens = struct.unpack("<iii", prefix)
    data_headers.append({"path": item["path"], "magic": magic, "version": version, "tokens": tokens})
print(json.dumps({
    "schemaVersion": 1,
    "environmentDirectory": str(environment),
    "datasetDirectory": str(dataset),
    "environmentManifest": (environment / "environment.json").read_text(encoding="utf-8"),
    "pipFreeze": (environment / "pip-freeze.txt").read_text(encoding="utf-8"),
    "environmentSeal": (environment / "environment-seal.json").read_text(encoding="utf-8"),
    "executables": executables,
    "datasetManifest": dataset_manifest,
    "runtime": runtime,
    "dataFiles": data_files,
    "dataHeaders": data_headers,
}, sort_keys=True))
`;

export const NANOGPT_SMOKE_PREPARE_REMOTE = `
import base64, json, os, pathlib, stat, sys, time
root = pathlib.Path(sys.argv[1])
payload = json.load(sys.stdin)
expected = {
    "bundle/candidate.source.py",
    "bundle/runtime-manifest.json",
    "bundle/train_gpt_runtime.py",
    "dataset-manifest.json",
    "gate/evaluators/nanogpt_contract.py",
	"gate/evaluators/nanogpt_runtime.py",
	"gate/fixtures/nanogpt/train_gpt_simple.py",
	"isolated-python",
	"job.sh",
    "request.json",
    "worker.py",
}
files = payload.get("files")
if not isinstance(files, list) or {item.get("path") for item in files} != expected:
    raise SystemExit("prepared NanoGPT asset set changed")
root.mkdir(parents=True, exist_ok=True, mode=0o700)
if root.is_symlink() or not root.is_dir():
    raise SystemExit("remote job root must be a non-symlink directory")
os.chmod(root, 0o700)
if root.stat().st_uid != os.getuid() or stat.S_IMODE(root.lstat().st_mode) != 0o700:
    raise SystemExit("remote job root ownership or mode changed")
def verify_file(path, content, expected_mode):
    mode = path.lstat().st_mode
    if (
        not stat.S_ISREG(mode)
        or path.is_symlink()
        or path.stat().st_uid != os.getuid()
        or stat.S_IMODE(mode) != expected_mode
        or path.read_bytes() != content
    ):
        raise SystemExit(f"immutable prepared asset mismatch: {path}")
    for _ in range(100):
        if path.stat().st_nlink == 1:
            return
        time.sleep(0.01)
    raise SystemExit(f"immutable prepared asset has unexpected hard links: {path}")
for item in files:
    if set(item) != {"path", "mode", "content"} or item["mode"] not in (0o400, 0o500):
        raise SystemExit("invalid prepared asset record")
    relative = pathlib.PurePosixPath(item["path"])
    if relative.is_absolute() or ".." in relative.parts or "." in relative.parts:
        raise SystemExit("invalid prepared asset path")
    content = base64.b64decode(item["content"], validate=True)
    path = root.joinpath(*relative.parts)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    parent = root
    for part in relative.parts[:-1]:
        parent = parent / part
        if parent.is_symlink() or not parent.is_dir():
            raise SystemExit("prepared asset parent must be a non-symlink directory")
        os.chmod(parent, 0o700)
        if parent.stat().st_uid != os.getuid() or stat.S_IMODE(parent.lstat().st_mode) != 0o700:
            raise SystemExit("prepared asset parent ownership or mode changed")
    if os.path.lexists(path):
        verify_file(path, content, item["mode"])
        continue
    temporary = path.with_name(f".{path.name}.tmp.{os.getpid()}")
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
        directory_descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
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
print(json.dumps({"prepared": str(root)}, sort_keys=True))
`;

const READ_EXISTING_RESULT_REMOTE = `
import json, pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
result = root / "result.json"
if not result.exists():
    print(json.dumps({"kind": "missing"}, sort_keys=True))
    raise SystemExit(0)
if result.is_symlink() or not stat.S_ISREG(result.lstat().st_mode):
    raise SystemExit("durable result must be a regular non-symlink file")
id_path = root / "slurm-job-id"
if not id_path.exists() or id_path.is_symlink() or not stat.S_ISREG(id_path.lstat().st_mode):
    raise SystemExit("durable result requires a regular non-symlink SLURM identity")
job_id = id_path.read_text(encoding="utf-8").strip()
if not job_id.isdigit():
    raise SystemExit("durable SLURM identity must be numeric")
log_path = root / f"slurm-{job_id}.out"
if log_path.exists() and (log_path.is_symlink() or not stat.S_ISREG(log_path.lstat().st_mode)):
    raise SystemExit("SLURM log must be a regular non-symlink file")
log = log_path.read_text(encoding="utf-8", errors="replace")[-262144:] if log_path.exists() else ""
print(json.dumps({"kind": "result", "rawResult": result.read_text(encoding="utf-8"), "log": log, "slurmJobId": job_id}))
`;

export const NANOGPT_SMOKE_POLL_REMOTE = `
import json, os, pathlib, stat, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
grace_seconds = float(sys.argv[2])
terminal_states = set(${JSON.stringify(NANOGPT_TERMINAL_SLURM_STATES)})
marker = root / "${RESULT_VISIBILITY_GRACE_FILE}"
id_path = root / "slurm-job-id"
if id_path.exists() and (id_path.is_symlink() or not stat.S_ISREG(id_path.lstat().st_mode)):
    raise SystemExit("SLURM identity must be a regular non-symlink file")
job_id = id_path.read_text(encoding="utf-8").strip() if id_path.exists() else ""
if job_id and not job_id.isdigit():
    raise SystemExit("SLURM identity must be numeric")
log_path = root / f"slurm-{job_id}.out" if job_id else None
if log_path and log_path.exists() and (log_path.is_symlink() or not stat.S_ISREG(log_path.lstat().st_mode)):
    raise SystemExit("SLURM log must be a regular non-symlink file")
log = log_path.read_text(encoding="utf-8", errors="replace")[-262144:] if log_path and log_path.exists() else ""
result_path = root / "result.json"
if result_path.exists():
    if result_path.is_symlink() or not stat.S_ISREG(result_path.lstat().st_mode):
        raise SystemExit("durable result must be a regular non-symlink file")
    print(json.dumps({"kind": "result", "rawResult": result_path.read_text(encoding="utf-8"), "log": log}))
    raise SystemExit(0)
if not job_id:
    print(json.dumps({"kind": "pending", "schedulerState": "DISPATCHING"}))
    raise SystemExit(0)
queued = subprocess.run(["squeue", "--noheader", "--jobs", job_id, "--format=%T"], capture_output=True, text=True, check=True)
state = queued.stdout.strip().splitlines()
if state:
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    print(json.dumps({"kind": "pending", "schedulerState": state[0]}))
    raise SystemExit(0)
accounted = subprocess.run(["sacct", "--noheader", "-X", "--jobs", job_id, "--format=State,ExitCode", "--parsable2"], capture_output=True, text=True, check=True)
rows = [line.strip() for line in accounted.stdout.splitlines() if line.strip()]
if not rows:
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    print(json.dumps({"kind": "pending", "schedulerState": "ACCOUNTING_LAG"}))
    raise SystemExit(0)
state = rows[0].split("|", 1)[0].split("+", 1)[0].strip().upper()
if state not in terminal_states:
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    print(json.dumps({"kind": "pending", "schedulerState": "ACCOUNTING_NONTERMINAL_OR_UNKNOWN:" + rows[0]}))
    raise SystemExit(0)
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
    print(json.dumps({"kind": "pending", "schedulerState": "RESULT_VISIBILITY_GRACE:" + rows[0]}))
    raise SystemExit(0)
if result_path.exists():
    if result_path.is_symlink() or not stat.S_ISREG(result_path.lstat().st_mode):
        raise SystemExit("durable result must be a regular non-symlink file")
    print(json.dumps({"kind": "result", "rawResult": result_path.read_text(encoding="utf-8"), "log": log}))
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

class SshNanoGptFarmShareSmokeTransport implements NanoGptFarmShareSmokeTransport {
	constructor(private readonly config: NanoGptFarmShareSmokeConfig) {}

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

	async readiness(
		remoteRoot: string,
		environmentDir: string,
		datasetManifestSha256: string,
		signal: AbortSignal,
	): Promise<string> {
		const result = await this.remotePython(
			NANOGPT_SMOKE_READINESS_REMOTE,
			[remoteRoot, environmentDir, datasetManifestSha256],
			undefined,
			signal,
			600_000,
		);
		return result.stdout;
	}

	async prepare(remoteJobDir: string, assets: NanoGptSmokePreparedAssets, signal: AbortSignal): Promise<void> {
		const payload = JSON.stringify({
			files: assets.files.map((asset) => ({
				path: asset.path,
				mode: asset.mode,
				content: Buffer.from(asset.content).toString("base64"),
			})),
		});
		await this.remotePython(NANOGPT_SMOKE_PREPARE_REMOTE, [remoteJobDir], payload, signal);
	}

	async readExistingResult(remoteJobDir: string, signal: AbortSignal): Promise<NanoGptSmokeExistingResult | null> {
		const result = await this.remotePython(READ_EXISTING_RESULT_REMOTE, [remoteJobDir], undefined, signal);
		const parsed = parseSingleJsonObject(result.stdout, "existing result");
		const kind = expectString(parsed.kind, "existingResult.kind");
		if (kind === "missing") return null;
		if (kind !== "result") throw new Error(`Unknown existing-result kind: ${kind}`);
		return {
			rawResult: expectString(parsed.rawResult, "existingResult.rawResult"),
			log: expectString(parsed.log, "existingResult.log"),
			slurmJobId: expectString(parsed.slurmJobId, "existingResult.slurmJobId"),
		};
	}

	async ensureSubmitted(
		remoteJobDir: string,
		jobName: string,
		signal: AbortSignal,
	): Promise<{ readonly slurmJobId: string }> {
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

	async poll(remoteJobDir: string, signal: AbortSignal): Promise<NanoGptSmokeRemotePoll> {
		const result = await this.remotePython(
			NANOGPT_SMOKE_POLL_REMOTE,
			[remoteJobDir, String(this.config.resultVisibilityGraceMs / 1000)],
			undefined,
			signal,
		);
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
	return new Promise((resolvePromise, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("NanoGPT smoke aborted"));
			return;
		}
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolvePromise();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(signal.reason ?? new Error("NanoGPT smoke aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function parseDataFile(value: unknown, path: string): (typeof NANOGPT_SMOKE_DATA_FILES)[number] {
	const record = expectRecord(value, path);
	expectExactKeys(record, ["path", "size", "sha256"], path);
	const parsed = {
		path: expectString(record.path, `${path}.path`),
		size: expectNumber(record.size, `${path}.size`),
		sha256: expectSha256(record.sha256, `${path}.sha256`),
	};
	const expected = NANOGPT_SMOKE_DATA_FILES.find((item) => item.path === parsed.path);
	if (!expected || !sameJson(parsed, expected)) throw new Error(`Unexpected sealed dataset file at ${path}`);
	return expected;
}

function parseDataHeader(value: unknown, path: string): (typeof NANOGPT_SMOKE_DATA_HEADERS)[number] {
	const record = expectRecord(value, path);
	expectExactKeys(record, ["path", "magic", "version", "tokens"], path);
	const parsed = {
		path: expectString(record.path, `${path}.path`),
		magic: expectNumber(record.magic, `${path}.magic`),
		version: expectNumber(record.version, `${path}.version`),
		tokens: expectNumber(record.tokens, `${path}.tokens`),
	};
	const expected = NANOGPT_SMOKE_DATA_HEADERS.find((item) => item.path === parsed.path);
	if (!expected || !sameJson(parsed, expected)) throw new Error(`Unexpected dataset header at ${path}`);
	return expected;
}

export function parseNanoGptSmokeReadiness(
	raw: string,
	remoteRoot: string,
	datasetManifestSource: string,
): NanoGptSmokeReadiness {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new Error(`NanoGPT smoke readiness is not JSON: ${String(error)}`);
	}
	const readiness = expectRecord(value, "readiness");
	expectExactKeys(
		readiness,
		[
			"schemaVersion",
			"environmentDirectory",
			"datasetDirectory",
			"environmentManifest",
			"pipFreeze",
			"environmentSeal",
			"executables",
			"datasetManifest",
			"runtime",
			"dataFiles",
			"dataHeaders",
		],
		"readiness",
	);
	if (readiness.schemaVersion !== 1) throw new Error("Unsupported NanoGPT readiness schema");
	if (
		expectString(readiness.environmentDirectory, "readiness.environmentDirectory") !== NANOGPT_REUSED_ENVIRONMENT_DIR
	) {
		throw new Error("NanoGPT readiness did not use the exact reused KernelBench environment");
	}
	const expectedDatasetDir = `${remoteRoot}/data/${NANOGPT_SMOKE_DATA_MANIFEST_SHA256}/fineweb10B`;
	if (expectString(readiness.datasetDirectory, "readiness.datasetDirectory") !== expectedDatasetDir) {
		throw new Error("NanoGPT readiness dataset path mismatch");
	}

	const environmentManifest = expectString(readiness.environmentManifest, "readiness.environmentManifest");
	const pipFreeze = expectString(readiness.pipFreeze, "readiness.pipFreeze");
	const environmentSeal = expectString(readiness.environmentSeal, "readiness.environmentSeal");
	const environmentManifestSha256 = sha256Text(environmentManifest);
	const pipFreezeSha256 = sha256Text(pipFreeze);
	const environmentSealSha256 = sha256Text(environmentSeal);
	if (
		environmentManifestSha256 !== EXPECTED_ENVIRONMENT_MANIFEST_SHA256 ||
		pipFreezeSha256 !== EXPECTED_PIP_FREEZE_SHA256 ||
		environmentSealSha256 !== EXPECTED_ENVIRONMENT_SEAL_SHA256
	) {
		throw new Error("NanoGPT readiness environment evidence changed from the pinned compiled qualification");
	}
	const executables = expectRecord(readiness.executables, "readiness.executables");
	if (!sameJson(executables, NANOGPT_REUSED_ENVIRONMENT_EXECUTABLES)) {
		throw new Error("NanoGPT readiness Python or torchrun executable bytes changed");
	}
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
		manifest.schemaVersion !== 1 ||
		manifest.environmentSpecSha256 !== KERNELBENCH_COMPILED_ENVIRONMENT_SHA256 ||
		manifest.kernelBenchVerifiedCommit !== KERNELBENCH_VERIFIED_COMMIT ||
		manifest.python !== EXPECTED_PYTHON ||
		manifest.pip !== EXPECTED_PIP ||
		manifest.torch !== EXPECTED_TORCH ||
		manifest.torchCuda !== EXPECTED_TORCH_CUDA ||
		manifest.numpy !== EXPECTED_NUMPY
	) {
		throw new Error("NanoGPT readiness environment manifest is not the exact sealed runtime");
	}
	const seal = expectRecord(JSON.parse(environmentSeal), "readiness.environmentSealJson");
	expectExactKeys(
		seal,
		["schemaVersion", "environmentSpecSha256", "environmentManifestSha256", "pipFreezeSha256"],
		"readiness.environmentSealJson",
	);
	if (
		seal.schemaVersion !== 1 ||
		seal.environmentSpecSha256 !== KERNELBENCH_COMPILED_ENVIRONMENT_SHA256 ||
		seal.environmentManifestSha256 !== environmentManifestSha256 ||
		seal.pipFreezeSha256 !== pipFreezeSha256
	) {
		throw new Error("NanoGPT readiness environment seal does not bind the exact evidence");
	}
	const freezeLines = pipFreeze.split("\n");
	if (
		!freezeLines.includes(`pip==${EXPECTED_PIP}`) ||
		!freezeLines.includes(`numpy==${EXPECTED_NUMPY}`) ||
		!freezeLines.includes(`torch==${EXPECTED_TORCH}`)
	) {
		throw new Error("NanoGPT readiness pip freeze is missing an exact dependency");
	}
	const runtime = expectRecord(readiness.runtime, "readiness.runtime");
	expectExactKeys(runtime, ["python", "pip", "torch", "torchCuda", "numpy"], "readiness.runtime");
	if (
		runtime.python !== EXPECTED_PYTHON ||
		runtime.pip !== EXPECTED_PIP ||
		runtime.torch !== EXPECTED_TORCH ||
		runtime.torchCuda !== EXPECTED_TORCH_CUDA ||
		runtime.numpy !== EXPECTED_NUMPY
	) {
		throw new Error("NanoGPT readiness live runtime changed");
	}

	const datasetManifest = expectString(readiness.datasetManifest, "readiness.datasetManifest");
	if (
		datasetManifest !== datasetManifestSource ||
		sha256Text(datasetManifest) !== NANOGPT_SMOKE_DATA_MANIFEST_SHA256
	) {
		throw new Error("NanoGPT readiness dataset manifest bytes changed");
	}
	const datasetManifestValue = expectRecord(JSON.parse(datasetManifest), "readiness.datasetManifestJson");
	expectExactKeys(
		datasetManifestValue,
		["schemaVersion", "dataset", "revision", "purpose", "files"],
		"readiness.datasetManifestJson",
	);
	if (
		datasetManifestValue.schemaVersion !== 1 ||
		datasetManifestValue.dataset !== "kjj0/fineweb10B-gpt2" ||
		datasetManifestValue.revision !== "889765ea1f903759787add96995d81171b632d0c" ||
		datasetManifestValue.purpose !== "nanogpt-track3-cuda-smoke-10" ||
		!Array.isArray(datasetManifestValue.files) ||
		!sameJson(datasetManifestValue.files, NANOGPT_SMOKE_DATA_FILES)
	) {
		throw new Error("NanoGPT readiness is not the exact two-file smoke dataset");
	}
	if (!Array.isArray(readiness.dataFiles) || readiness.dataFiles.length !== NANOGPT_SMOKE_DATA_FILES.length) {
		throw new Error("NanoGPT readiness must hash exactly two data files");
	}
	const dataFiles = readiness.dataFiles.map((item, index) => parseDataFile(item, `readiness.dataFiles[${index}]`));
	if (!sameJson(dataFiles, NANOGPT_SMOKE_DATA_FILES)) throw new Error("NanoGPT readiness data file order changed");
	if (!Array.isArray(readiness.dataHeaders) || readiness.dataHeaders.length !== NANOGPT_SMOKE_DATA_HEADERS.length) {
		throw new Error("NanoGPT readiness must parse exactly two data headers");
	}
	const dataHeaders = readiness.dataHeaders.map((item, index) =>
		parseDataHeader(item, `readiness.dataHeaders[${index}]`),
	);
	if (!sameJson(dataHeaders, NANOGPT_SMOKE_DATA_HEADERS)) {
		throw new Error("NanoGPT readiness dataset header semantics changed");
	}

	return {
		environment: {
			source: "reused-kernelbench-compiled-environment",
			directory: NANOGPT_REUSED_ENVIRONMENT_DIR,
			environmentSpecSha256: KERNELBENCH_COMPILED_ENVIRONMENT_SHA256,
			environmentManifestSha256,
			pipFreezeSha256,
			environmentSealSha256,
			environmentManifest,
			pipFreeze,
			environmentSeal,
			executables: NANOGPT_REUSED_ENVIRONMENT_EXECUTABLES,
			python: EXPECTED_PYTHON,
			pip: EXPECTED_PIP,
			torch: EXPECTED_TORCH,
			torchCuda: EXPECTED_TORCH_CUDA,
			numpy: EXPECTED_NUMPY,
		},
		dataset: {
			directory: expectedDatasetDir,
			manifestSha256: NANOGPT_SMOKE_DATA_MANIFEST_SHA256,
			manifest: datasetManifest,
			files: NANOGPT_SMOKE_DATA_FILES,
			headers: NANOGPT_SMOKE_DATA_HEADERS,
			consumption: NANOGPT_SMOKE_DATA_CONSUMPTION,
		},
	};
}

async function readLocalBundleAssets(bundleDir: string): Promise<LocalBundleAssets> {
	const runtimeEvaluatorPath = fileURLToPath(new URL("../evaluators/nanogpt_runtime.py", import.meta.url));
	const staticEvaluatorPath = fileURLToPath(new URL("../evaluators/nanogpt_contract.py", import.meta.url));
	const workerPath = fileURLToPath(new URL("../evaluators/nanogpt_farmshare_smoke_worker.py", import.meta.url));
	const datasetManifestPath = fileURLToPath(new URL("../farmshare/nanogpt-smoke-data.json", import.meta.url));
	const [
		manifestSource,
		candidateSource,
		runtimeSource,
		runtimeEvaluatorSource,
		staticEvaluatorSource,
		baselineSource,
		workerSource,
		datasetManifestSource,
	] = await Promise.all([
		readFile(join(bundleDir, NANOGPT_RUNTIME_MANIFEST_NAME), "utf8"),
		readFile(join(bundleDir, NANOGPT_RUNTIME_CANDIDATE_NAME), "utf8"),
		readFile(join(bundleDir, NANOGPT_RUNTIME_PROGRAM_NAME), "utf8"),
		readFile(runtimeEvaluatorPath, "utf8"),
		readFile(staticEvaluatorPath, "utf8"),
		readFile(NANOGPT_BASELINE_FIXTURE, "utf8"),
		readFile(workerPath, "utf8"),
		readFile(datasetManifestPath, "utf8"),
	]);
	const manifest = JSON.parse(manifestSource) as NanoGptRuntimeManifest;
	if (
		manifest.contract !== NANOGPT_RUNTIME_CONTRACT_ID ||
		manifest.mode !== "cuda-smoke-10" ||
		manifest.expectedTrials !== 1 ||
		manifest.effectiveTrainSteps !== 10 ||
		!sameJson(manifest.expectedSeeds, [0xc0ffee]) ||
		manifest.claimScope !== NANOGPT_RUNTIME_CLAIM_SCOPE ||
		manifest.candidate.sha256 !== NANOGPT_BASELINE_SHA256 ||
		manifest.sourceIntegrity.baselineSha256 !== NANOGPT_BASELINE_SHA256 ||
		manifest.sourceIntegrity.patchSha256 !== null ||
		manifest.runtime.sha256 !== sha256Text(runtimeSource) ||
		manifest.candidate.sha256 !== sha256Text(candidateSource) ||
		manifest.evaluators.runtimeSha256 !== sha256Text(runtimeEvaluatorSource) ||
		manifest.evaluators.staticSha256 !== sha256Text(staticEvaluatorSource) ||
		manifest.launch.worldSize !== 1 ||
		manifest.launch.gpus !== 1 ||
		!sameJson(manifest.launch.args, NANOGPT_SMOKE_TORCHRUN_ARGS) ||
		!sameJson(manifest.launch.forbiddenEnvironment, NANOGPT_SMOKE_FORBIDDEN_ENVIRONMENT) ||
		manifest.acceptance.candidatePolicy !== "byte-exact-pinned-stock-fixture-only" ||
		manifest.acceptance.requiredMode !== "cuda-smoke-10" ||
		manifest.acceptance.requiredTrials !== 1 ||
		manifest.acceptance.requiredSeed !== 0xc0ffee ||
		manifest.acceptance.requiredDeclaredTrainSteps !== 3290 ||
		manifest.acceptance.requiredEffectiveTrainSteps !== 10 ||
		manifest.acceptance.scoredEligible !== false ||
		manifest.acceptance.recordEligible !== false ||
		manifest.acceptance.partialCurvesAccepted !== false ||
		sha256Text(baselineSource) !== NANOGPT_BASELINE_SHA256 ||
		candidateSource !== baselineSource ||
		sha256Text(manifestSource) !== NANOGPT_STOCK_SMOKE_MANIFEST_SHA256 ||
		sha256Text(runtimeSource) !== NANOGPT_STOCK_SMOKE_RUNTIME_SHA256 ||
		sha256Text(runtimeEvaluatorSource) !== NANOGPT_STOCK_SMOKE_RUNTIME_EVALUATOR_SHA256 ||
		sha256Text(staticEvaluatorSource) !== NANOGPT_STOCK_SMOKE_STATIC_EVALUATOR_SHA256 ||
		sha256Text(datasetManifestSource) !== NANOGPT_SMOKE_DATA_MANIFEST_SHA256
	) {
		throw new Error("Materialized G1 bundle is not the exact stock one-trial CUDA smoke");
	}
	return {
		manifest,
		manifestSource,
		candidateSource,
		runtimeSource,
		runtimeEvaluatorSource,
		staticEvaluatorSource,
		baselineSource,
		workerSource,
		datasetManifestSource,
	};
}

async function materializeStockBundle(temporaryRoot: string): Promise<LocalBundleAssets> {
	const bundleDir = join(temporaryRoot, "bundle");
	const materialized = await materializeNanoGptRuntime({
		candidatePath: NANOGPT_BASELINE_FIXTURE,
		outputPath: bundleDir,
		mode: "cuda-smoke-10",
		trials: 1,
		allowBaselineSteps: true,
	});
	if (!materialized.ok || materialized.operation === "extract") {
		throw new Error(`G1 stock smoke materialization failed: ${JSON.stringify(materialized.errors)}`);
	}
	const verified = await verifyNanoGptRuntimeBundle(bundleDir);
	if (!verified.ok || verified.operation === "extract") {
		throw new Error(`G1 stock smoke verification failed: ${JSON.stringify(verified.errors)}`);
	}
	if (materialized.manifestSha256 !== verified.manifestSha256 || !sameJson(materialized.manifest, verified.manifest)) {
		throw new Error("G1 materialize and verify results disagree");
	}
	const assets = await readLocalBundleAssets(bundleDir);
	if (sha256Text(assets.manifestSource) !== materialized.manifestSha256) {
		throw new Error("G1 runtime manifest hash changed after verification");
	}
	return assets;
}

export function buildNanoGptSmokeExecutionSeal(
	assets: LocalBundleAssets,
	readiness: NanoGptSmokeReadiness,
): NanoGptSmokeExecutionSeal {
	return {
		schemaVersion: 1,
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		workerSha256: sha256Text(assets.workerSource),
		bundle: {
			runtimeContract: NANOGPT_RUNTIME_CONTRACT_ID,
			claimScope: NANOGPT_RUNTIME_CLAIM_SCOPE,
			mode: "cuda-smoke-10",
			trials: 1,
			manifestSha256: NANOGPT_STOCK_SMOKE_MANIFEST_SHA256,
			candidateSha256: NANOGPT_BASELINE_SHA256,
			runtimeSha256: NANOGPT_STOCK_SMOKE_RUNTIME_SHA256,
			runtimeEvaluatorSha256: NANOGPT_STOCK_SMOKE_RUNTIME_EVALUATOR_SHA256,
			staticEvaluatorSha256: NANOGPT_STOCK_SMOKE_STATIC_EVALUATOR_SHA256,
			baselineSha256: NANOGPT_BASELINE_SHA256,
		},
		environment: {
			source: readiness.environment.source,
			directory: readiness.environment.directory,
			environmentSpecSha256: readiness.environment.environmentSpecSha256,
			environmentManifestSha256: readiness.environment.environmentManifestSha256,
			pipFreezeSha256: readiness.environment.pipFreezeSha256,
			environmentSealSha256: readiness.environment.environmentSealSha256,
			executables: readiness.environment.executables,
			python: readiness.environment.python,
			pip: readiness.environment.pip,
			torch: readiness.environment.torch,
			torchCuda: readiness.environment.torchCuda,
			numpy: readiness.environment.numpy,
		},
		dataset: {
			directory: readiness.dataset.directory,
			manifestSha256: readiness.dataset.manifestSha256,
			files: readiness.dataset.files,
			headers: readiness.dataset.headers,
			consumption: readiness.dataset.consumption,
		},
		launch: {
			executable: `${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin/python`,
			args: NANOGPT_SMOKE_RUNTIME_PROCESS_ARGS,
			worldSize: 1,
			gpus: 1,
			cwdPolicy: "fresh-job-directory",
			environmentKeys: NANOGPT_SMOKE_LAUNCH_ENVIRONMENT_KEYS,
			forbiddenEnvironment: NANOGPT_SMOKE_FORBIDDEN_ENVIRONMENT,
		},
		slurm: {
			partition: "gpu",
			constraint: "GPU_SKU:L40S",
			nodes: 1,
			tasks: 1,
			gpus: 1,
			cpus: 8,
			memory: "32G",
			time: "00:30:00",
			export: "NONE",
		},
	};
}

export function buildNanoGptFarmShareSmokeJobScript(config: NanoGptFarmShareSmokeConfig, remoteJobDir: string): string {
	if (config.partition !== "gpu" || config.constraint !== "GPU_SKU:L40S") {
		throw new Error("NanoGPT stock smoke requires the exact FarmShare L40S scheduling contract");
	}
	validateToken(config.partition, "partition", /^[A-Za-z0-9._:-]+$/);
	validateToken(config.constraint, "constraint", /^[A-Za-z0-9._:-]+$/);
	validateAbsolutePath(remoteJobDir, "remote job directory");
	if (!remoteJobDir.startsWith(`${config.remoteRoot}/jobs/`)) {
		throw new Error("NanoGPT smoke job directory is outside the fixed remote root");
	}
	const home = `${remoteJobDir}/home`;
	const temporary = `${remoteJobDir}/tmp`;
	const cache = `${remoteJobDir}/torchinductor-cache`;
	return `#!/usr/bin/env bash
#SBATCH --job-name=prime-nanogpt-stock-smoke
#SBATCH --partition=gpu
#SBATCH --constraint=GPU_SKU:L40S
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=00:30:00
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
		PATH=${shellQuote(`${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin:/usr/bin:/bin`)} \
		PYTHONDONTWRITEBYTECODE=1 \
		PYTHONNOUSERSITE=1 \
		PYTHON_EXEC=${shellQuote(`${remoteJobDir}/isolated-python`)} \
		SLURM_JOB_ID="\${SLURM_JOB_ID:-}" \
	TMPDIR=${shellQuote(temporary)} \
	TORCHINDUCTOR_CACHE_DIR=${shellQuote(cache)} \
	${shellQuote(`${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin/python`)} \
	-I \
	${shellQuote(`${remoteJobDir}/worker.py`)} \
		--job-root ${shellQuote(remoteJobDir)} \
		--request ${shellQuote(`${remoteJobDir}/request.json`)} \
		--output ${shellQuote(`${remoteJobDir}/result.json`)}
`;
}

function buildPreparedAssets(
	config: NanoGptFarmShareSmokeConfig,
	assets: LocalBundleAssets,
	readiness: NanoGptSmokeReadiness,
): {
	readonly jobKey: string;
	readonly remoteJobDir: string;
	readonly executionSeal: NanoGptSmokeExecutionSeal;
	readonly requestSha256: string;
	readonly prepared: NanoGptSmokePreparedAssets;
} {
	const executionSeal = buildNanoGptSmokeExecutionSeal(assets, readiness);
	const jobKey = sha256Json(executionSeal);
	const remoteJobDir = `${config.remoteRoot}/jobs/${jobKey}`;
	const jobScript = buildNanoGptFarmShareSmokeJobScript(config, remoteJobDir);
	const isolatedPythonSource = buildNanoGptIsolatedPythonSource();
	const requestJson = `${JSON.stringify({
		schemaVersion: 1,
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		jobKey,
		executionSeal,
		jobScriptSha256: sha256Text(jobScript),
	})}\n`;
	const files: NanoGptSmokePreparedAsset[] = [
		{ path: "bundle/candidate.source.py", mode: 0o400, content: assets.candidateSource },
		{ path: "bundle/runtime-manifest.json", mode: 0o400, content: assets.manifestSource },
		{ path: "bundle/train_gpt_runtime.py", mode: 0o400, content: assets.runtimeSource },
		{ path: "dataset-manifest.json", mode: 0o400, content: assets.datasetManifestSource },
		{ path: "gate/evaluators/nanogpt_contract.py", mode: 0o400, content: assets.staticEvaluatorSource },
		{ path: "gate/evaluators/nanogpt_runtime.py", mode: 0o400, content: assets.runtimeEvaluatorSource },
		{ path: "gate/fixtures/nanogpt/train_gpt_simple.py", mode: 0o400, content: assets.baselineSource },
		{ path: "isolated-python", mode: 0o500, content: isolatedPythonSource },
		{ path: "job.sh", mode: 0o500, content: jobScript },
		{ path: "request.json", mode: 0o400, content: requestJson },
		{ path: "worker.py", mode: 0o500, content: assets.workerSource },
	];
	if (!sameJson(files.map((file) => file.path).sort(), [...PREPARED_ASSET_PATHS])) {
		throw new Error("NanoGPT prepared asset list changed");
	}
	return {
		jobKey,
		remoteJobDir,
		executionSeal,
		requestSha256: sha256Text(requestJson),
		prepared: { requestJson, jobScript, files },
	};
}

function parseFailure(value: unknown, path: string): { readonly kind: string; readonly message: string } | null {
	if (value === null) return null;
	const record = expectRecord(value, path);
	expectExactKeys(record, ["kind", "message"], path);
	return { kind: expectString(record.kind, `${path}.kind`), message: expectString(record.message, `${path}.message`) };
}

function parseGateResult(value: unknown, path: string): NanoGptRuntimeCommandResult | null {
	if (value === null) return null;
	try {
		return parseNanoGptRuntimeCommandResult(JSON.stringify(value));
	} catch (error) {
		throw new Error(`${path} is not a valid G1 result: ${String(error)}`);
	}
}

interface ExpectedIntegrityFile {
	readonly path: string;
	readonly sha256?: string;
	readonly mode: number;
	readonly size?: number;
}

function parseIntegrityFileSet(
	value: unknown,
	path: string,
	expected: readonly ExpectedIntegrityFile[],
): Record<string, unknown> {
	const record = expectRecord(value, path);
	expectExactKeys(record, ["files", "sha256"], path);
	if (!Array.isArray(record.files) || record.files.length !== expected.length) {
		throw new Error(`${path}.files does not contain the exact sealed asset set`);
	}
	const files = record.files.map((item, index) => {
		const filePath = `${path}.files[${index}]`;
		const file = expectRecord(item, filePath);
		expectExactKeys(file, ["path", "size", "sha256", "mode"], filePath);
		const parsed = {
			path: expectString(file.path, `${filePath}.path`),
			size: expectNumber(file.size, `${filePath}.size`),
			sha256: expectSha256(file.sha256, `${filePath}.sha256`),
			mode: expectNumber(file.mode, `${filePath}.mode`),
		};
		const wanted = expected[index];
		if (
			!Number.isSafeInteger(parsed.size) ||
			parsed.size < 1 ||
			!Number.isSafeInteger(parsed.mode) ||
			parsed.path !== wanted.path ||
			parsed.mode !== wanted.mode ||
			(wanted.sha256 !== undefined && parsed.sha256 !== wanted.sha256) ||
			(wanted.size !== undefined && parsed.size !== wanted.size)
		) {
			throw new Error(`${filePath} changed from the exact sealed asset contract`);
		}
		return parsed;
	});
	const digest = expectSha256(record.sha256, `${path}.sha256`);
	if (sha256Json(files) !== digest) throw new Error(`${path} aggregate hash is inconsistent`);
	return { files, sha256: digest };
}

function parseIntegritySnapshot(
	value: unknown,
	path: string,
	expectation: {
		readonly jobKey: string;
		readonly requestSha256: string;
		readonly executionSeal: NanoGptSmokeExecutionSeal;
		readonly slurmJobId: string;
	},
	environmentEvidence: Record<string, unknown>,
	datasetEvidence: Record<string, unknown>,
): Record<string, unknown> {
	const snapshot = expectRecord(value, path);
	expectExactKeys(snapshot, ["jobAssets", "stagedInputs", "environment", "dataset", "launchEnvironment"], path);
	const bundle = expectation.executionSeal.bundle;
	const expectedJobScriptSha256 = sha256Text(
		buildNanoGptFarmShareSmokeJobScript(
			DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG,
			`${FIXED_REMOTE_ROOT}/jobs/${expectation.jobKey}`,
		),
	);
	const jobAssets = parseIntegrityFileSet(snapshot.jobAssets, `${path}.jobAssets`, [
		{ path: "bundle/candidate.source.py", sha256: bundle.candidateSha256, mode: 0o400 },
		{ path: "bundle/runtime-manifest.json", sha256: bundle.manifestSha256, mode: 0o400 },
		{ path: "bundle/train_gpt_runtime.py", sha256: bundle.runtimeSha256, mode: 0o400 },
		{ path: "dataset-manifest.json", sha256: NANOGPT_SMOKE_DATA_MANIFEST_SHA256, mode: 0o400 },
		{ path: "gate/evaluators/nanogpt_contract.py", sha256: bundle.staticEvaluatorSha256, mode: 0o400 },
		{ path: "gate/evaluators/nanogpt_runtime.py", sha256: bundle.runtimeEvaluatorSha256, mode: 0o400 },
		{ path: "gate/fixtures/nanogpt/train_gpt_simple.py", sha256: bundle.baselineSha256, mode: 0o400 },
		{ path: "isolated-python", sha256: sha256Text(buildNanoGptIsolatedPythonSource()), mode: 0o500 },
		{ path: "job.sh", sha256: expectedJobScriptSha256, mode: 0o500 },
		{ path: "request.json", sha256: expectation.requestSha256, mode: 0o400 },
		{ path: "worker.py", sha256: expectation.executionSeal.workerSha256, mode: 0o500 },
	]);
	const stagedInputs = parseIntegrityFileSet(snapshot.stagedInputs, `${path}.stagedInputs`, [
		{ path: "candidate.source.py", sha256: bundle.candidateSha256, mode: 0o444 },
		{ path: "runtime-manifest.json", sha256: bundle.manifestSha256, mode: 0o444 },
		{ path: "train_gpt_runtime.py", sha256: bundle.runtimeSha256, mode: 0o444 },
		{
			path: "data/fineweb10B/dataset-manifest.json",
			sha256: NANOGPT_SMOKE_DATA_MANIFEST_SHA256,
			mode: 0o444,
		},
		{
			path: "data/fineweb10B/READY",
			sha256: sha256Text(`${NANOGPT_SMOKE_DATA_MANIFEST_SHA256}\n`),
			mode: 0o444,
			size: 65,
		},
		...NANOGPT_SMOKE_DATA_FILES.map((file) => ({
			path: `data/fineweb10B/${file.path}`,
			sha256: file.sha256,
			mode: 0o444,
			size: file.size,
		})),
	]);
	const environment = expectRecord(snapshot.environment, `${path}.environment`);
	const dataset = expectRecord(snapshot.dataset, `${path}.dataset`);
	if (!sameJson(environment, environmentEvidence) || !sameJson(dataset, datasetEvidence)) {
		throw new Error(`${path} disagrees with the measured environment or dataset evidence`);
	}
	const launchEnvironment = expectRecord(snapshot.launchEnvironment, `${path}.launchEnvironment`);
	expectExactKeys(launchEnvironment, NANOGPT_SMOKE_LAUNCH_ENVIRONMENT_KEYS, `${path}.launchEnvironment`);
	const remoteJobDir = `${FIXED_REMOTE_ROOT}/jobs/${expectation.jobKey}`;
	const expectedLaunchValues: Record<string, string> = {
		CUDA_DEVICE_ORDER: "PCI_BUS_ID",
		HOME: `${remoteJobDir}/home`,
		LC_ALL: "C.UTF-8",
		PATH: `${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin:/usr/bin:/bin`,
		PYTHONDONTWRITEBYTECODE: "1",
		PYTHONNOUSERSITE: "1",
		PYTHON_EXEC: `${remoteJobDir}/isolated-python`,
		SLURM_JOB_ID: expectation.slurmJobId,
		TMPDIR: `${remoteJobDir}/tmp`,
		TORCHINDUCTOR_CACHE_DIR: `${remoteJobDir}/torchinductor-cache`,
	};
	for (const [key, expected] of Object.entries(expectedLaunchValues)) {
		if (launchEnvironment[key] !== expected) throw new Error(`${path}.launchEnvironment.${key} changed`);
	}
	const cudaVisibleDevices = expectString(
		launchEnvironment.CUDA_VISIBLE_DEVICES,
		`${path}.launchEnvironment.CUDA_VISIBLE_DEVICES`,
	);
	if (!cudaVisibleDevices || cudaVisibleDevices.includes(",")) {
		throw new Error(`${path}.launchEnvironment does not expose exactly one CUDA device`);
	}
	return { jobAssets, stagedInputs, environment, dataset, launchEnvironment };
}

export function parseNanoGptFarmShareWorkerResult(
	raw: string,
	expectation: {
		readonly jobKey: string;
		readonly requestSha256: string;
		readonly executionSeal: NanoGptSmokeExecutionSeal;
		readonly slurmJobId?: string;
	},
): NanoGptFarmShareWorkerResult {
	const value = expectRecord(JSON.parse(raw), "workerResult");
	expectExactKeys(
		value,
		[
			"schemaVersion",
			"contract",
			"evidenceClass",
			"ok",
			"jobKey",
			"requestSha256",
			"workerSha256",
			"startedAt",
			"finishedAt",
			"slurmJobId",
			"executionSeal",
			"environmentEvidence",
			"datasetEvidence",
			"launchEnvironmentKeys",
			"runtimeExitCode",
			"gateVerification",
			"gateExtraction",
			"integrityEvidence",
			"failure",
		],
		"workerResult",
	);
	const ok = expectBoolean(value.ok, "workerResult.ok");
	const startedAt = expectIsoTimestamp(value.startedAt, "workerResult.startedAt");
	const finishedAt = expectIsoTimestamp(value.finishedAt, "workerResult.finishedAt");
	if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error("Worker result timestamps are out of order");
	const slurmJobId = expectString(value.slurmJobId, "workerResult.slurmJobId");
	if (!/^[0-9]+$/.test(slurmJobId) || (expectation.slurmJobId && slurmJobId !== expectation.slurmJobId)) {
		throw new Error("Worker result SLURM identity mismatch");
	}
	if (
		value.schemaVersion !== 1 ||
		value.contract !== NANOGPT_FARMSHARE_SMOKE_CONTRACT ||
		value.evidenceClass !== NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS ||
		value.jobKey !== expectation.jobKey ||
		value.requestSha256 !== expectation.requestSha256 ||
		value.workerSha256 !== expectation.executionSeal.workerSha256 ||
		!sameJson(value.executionSeal, expectation.executionSeal) ||
		sha256Json(value.executionSeal) !== expectation.jobKey
	) {
		throw new Error("Worker result is not bound to the exact controller execution seal");
	}
	const runtimeExitCode =
		value.runtimeExitCode === null ? null : expectNumber(value.runtimeExitCode, "runtimeExitCode");
	if (runtimeExitCode !== null && !Number.isSafeInteger(runtimeExitCode)) {
		throw new Error("Worker runtime exit code must be an integer");
	}
	if (
		!Array.isArray(value.launchEnvironmentKeys) ||
		!value.launchEnvironmentKeys.every((item) => typeof item === "string")
	) {
		throw new Error("Worker launch environment keys must be strings");
	}
	const gateVerification = parseGateResult(value.gateVerification, "workerResult.gateVerification");
	const gateExtraction = parseGateResult(value.gateExtraction, "workerResult.gateExtraction");
	const integrityEvidenceRaw = expectRecord(value.integrityEvidence, "workerResult.integrityEvidence");
	expectExactKeys(
		integrityEvidenceRaw,
		["preRun", "preRunSha256", "postRun", "postRunSha256", "stable"],
		"workerResult.integrityEvidence",
	);
	let integrityEvidence = {
		preRun:
			integrityEvidenceRaw.preRun === null
				? null
				: expectRecord(integrityEvidenceRaw.preRun, "workerResult.integrityEvidence.preRun"),
		preRunSha256:
			integrityEvidenceRaw.preRunSha256 === null
				? null
				: expectSha256(integrityEvidenceRaw.preRunSha256, "workerResult.integrityEvidence.preRunSha256"),
		postRun:
			integrityEvidenceRaw.postRun === null
				? null
				: expectRecord(integrityEvidenceRaw.postRun, "workerResult.integrityEvidence.postRun"),
		postRunSha256:
			integrityEvidenceRaw.postRunSha256 === null
				? null
				: expectSha256(integrityEvidenceRaw.postRunSha256, "workerResult.integrityEvidence.postRunSha256"),
		stable: expectBoolean(integrityEvidenceRaw.stable, "workerResult.integrityEvidence.stable"),
	};
	const failure = parseFailure(value.failure, "workerResult.failure");
	const environmentEvidence = expectRecord(value.environmentEvidence, "workerResult.environmentEvidence");
	const datasetEvidence = expectRecord(value.datasetEvidence, "workerResult.datasetEvidence");
	if (ok) {
		if (
			runtimeExitCode !== 0 ||
			failure !== null ||
			gateVerification === null ||
			!gateVerification.ok ||
			gateVerification.operation !== "verify" ||
			gateExtraction === null ||
			!gateExtraction.ok ||
			gateExtraction.operation !== "extract"
		) {
			throw new Error("Successful worker result lacks complete G1 evidence");
		}
		const verifiedManifest = gateVerification.manifest;
		if (
			gateVerification.manifestSha256 !== expectation.executionSeal.bundle.manifestSha256 ||
			verifiedManifest.contract !== NANOGPT_RUNTIME_CONTRACT_ID ||
			verifiedManifest.mode !== "cuda-smoke-10" ||
			verifiedManifest.expectedTrials !== 1 ||
			verifiedManifest.effectiveTrainSteps !== 10 ||
			!sameJson(verifiedManifest.expectedSeeds, [0xc0ffee]) ||
			verifiedManifest.claimScope !== NANOGPT_RUNTIME_CLAIM_SCOPE ||
			verifiedManifest.candidate.sha256 !== expectation.executionSeal.bundle.candidateSha256 ||
			verifiedManifest.runtime.sha256 !== expectation.executionSeal.bundle.runtimeSha256 ||
			verifiedManifest.evaluators.runtimeSha256 !== expectation.executionSeal.bundle.runtimeEvaluatorSha256 ||
			verifiedManifest.evaluators.staticSha256 !== expectation.executionSeal.bundle.staticEvaluatorSha256 ||
			verifiedManifest.sourceIntegrity.baselineSha256 !== expectation.executionSeal.bundle.baselineSha256 ||
			verifiedManifest.sourceIntegrity.patchSha256 !== null ||
			verifiedManifest.launch.worldSize !== 1 ||
			verifiedManifest.launch.gpus !== 1 ||
			!sameJson(verifiedManifest.launch.args, NANOGPT_SMOKE_TORCHRUN_ARGS) ||
			!sameJson(verifiedManifest.launch.forbiddenEnvironment, NANOGPT_SMOKE_FORBIDDEN_ENVIRONMENT) ||
			verifiedManifest.acceptance.candidatePolicy !== "byte-exact-pinned-stock-fixture-only" ||
			verifiedManifest.acceptance.requiredMode !== "cuda-smoke-10" ||
			verifiedManifest.acceptance.requiredTrials !== 1 ||
			verifiedManifest.acceptance.requiredSeed !== 0xc0ffee ||
			verifiedManifest.acceptance.requiredDeclaredTrainSteps !== 3290 ||
			verifiedManifest.acceptance.requiredEffectiveTrainSteps !== 10 ||
			verifiedManifest.acceptance.scoredEligible !== false ||
			verifiedManifest.acceptance.recordEligible !== false ||
			verifiedManifest.acceptance.partialCurvesAccepted !== false
		) {
			throw new Error("Successful G1 verification is not cross-bound to the execution seal");
		}
		if (
			!integrityEvidence.stable ||
			integrityEvidence.preRun === null ||
			integrityEvidence.postRun === null ||
			integrityEvidence.preRunSha256 === null ||
			integrityEvidence.postRunSha256 === null ||
			sha256Json(integrityEvidence.preRun) !== integrityEvidence.preRunSha256 ||
			sha256Json(integrityEvidence.postRun) !== integrityEvidence.postRunSha256 ||
			integrityEvidence.preRunSha256 !== integrityEvidence.postRunSha256 ||
			!sameJson(integrityEvidence.preRun, integrityEvidence.postRun)
		) {
			throw new Error("Successful worker result lacks stable pre-run and post-run integrity evidence");
		}
		const preRun = parseIntegritySnapshot(
			integrityEvidence.preRun,
			"workerResult.integrityEvidence.preRun",
			{ ...expectation, slurmJobId },
			environmentEvidence,
			datasetEvidence,
		);
		const postRun = parseIntegritySnapshot(
			integrityEvidence.postRun,
			"workerResult.integrityEvidence.postRun",
			{ ...expectation, slurmJobId },
			environmentEvidence,
			datasetEvidence,
		);
		if (
			sha256Json(preRun) !== integrityEvidence.preRunSha256 ||
			sha256Json(postRun) !== integrityEvidence.postRunSha256 ||
			!sameJson(preRun, postRun)
		) {
			throw new Error("Successful worker result integrity details are not canonically sealed");
		}
		integrityEvidence = { ...integrityEvidence, preRun, postRun };
		expectExactKeys(
			environmentEvidence,
			[
				"environmentManifestSha256",
				"pipFreezeSha256",
				"environmentSealSha256",
				"executables",
				"python",
				"pip",
				"torch",
				"torchCuda",
				"numpy",
				"gpu",
				"gpuComputeCapability",
				"gpuTotalMemoryBytes",
			],
			"workerResult.environmentEvidence",
		);
		expectExactKeys(
			datasetEvidence,
			["directory", "manifestSha256", "files", "headers", "consumption"],
			"workerResult.datasetEvidence",
		);
		const metrics = gateExtraction.metrics;
		if (
			metrics.mode !== "cuda-smoke-10" ||
			metrics.candidateSha256 !== NANOGPT_BASELINE_SHA256 ||
			metrics.runtimeSha256 !== expectation.executionSeal.bundle.runtimeSha256 ||
			metrics.effectiveTrainSteps !== 10 ||
			metrics.trials !== 1 ||
			!sameJson(metrics.seeds, [0xc0ffee]) ||
			!sameJson(metrics.optimizerSteps, [10]) ||
			!sameJson(metrics.backwardCalls, [80]) ||
			metrics.environment.worldSize !== 1 ||
			!metrics.environment.gpu.toLowerCase().includes("l40s") ||
			metrics.environment.pytorch !== EXPECTED_TORCH ||
			metrics.environment.cuda !== EXPECTED_TORCH_CUDA ||
			metrics.claimScope !== NANOGPT_RUNTIME_CLAIM_SCOPE ||
			metrics.scoredEligible !== false ||
			metrics.recordEligible !== false ||
			metrics.recordPassed !== null ||
			!sameJson(value.launchEnvironmentKeys, NANOGPT_SMOKE_LAUNCH_ENVIRONMENT_KEYS) ||
			environmentEvidence.environmentManifestSha256 !==
				expectation.executionSeal.environment.environmentManifestSha256 ||
			environmentEvidence.pipFreezeSha256 !== expectation.executionSeal.environment.pipFreezeSha256 ||
			environmentEvidence.environmentSealSha256 !== expectation.executionSeal.environment.environmentSealSha256 ||
			!sameJson(environmentEvidence.executables, expectation.executionSeal.environment.executables) ||
			environmentEvidence.python !== EXPECTED_PYTHON ||
			environmentEvidence.pip !== EXPECTED_PIP ||
			environmentEvidence.torch !== EXPECTED_TORCH ||
			environmentEvidence.torchCuda !== EXPECTED_TORCH_CUDA ||
			environmentEvidence.numpy !== EXPECTED_NUMPY ||
			expectString(environmentEvidence.gpu, "workerResult.environmentEvidence.gpu")
				.toLowerCase()
				.includes("l40s") === false ||
			environmentEvidence.gpuComputeCapability !== "8.9" ||
			expectNumber(environmentEvidence.gpuTotalMemoryBytes, "workerResult.environmentEvidence.gpuTotalMemoryBytes") <
				40_000_000_000 ||
			datasetEvidence.directory !== expectation.executionSeal.dataset.directory ||
			datasetEvidence.manifestSha256 !== NANOGPT_SMOKE_DATA_MANIFEST_SHA256 ||
			!sameJson(datasetEvidence.files, NANOGPT_SMOKE_DATA_FILES) ||
			!sameJson(datasetEvidence.headers, NANOGPT_SMOKE_DATA_HEADERS) ||
			!sameJson(datasetEvidence.consumption, NANOGPT_SMOKE_DATA_CONSUMPTION)
		) {
			throw new Error("Successful worker result does not prove the exact infrastructure smoke");
		}
	} else if (failure === null) {
		throw new Error("Failed worker result must include a failure envelope");
	}
	return {
		schemaVersion: 1,
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		ok,
		jobKey: expectation.jobKey,
		requestSha256: expectation.requestSha256,
		workerSha256: expectation.executionSeal.workerSha256,
		startedAt,
		finishedAt,
		slurmJobId,
		executionSeal: expectation.executionSeal,
		environmentEvidence,
		datasetEvidence,
		launchEnvironmentKeys: [...value.launchEnvironmentKeys],
		runtimeExitCode,
		gateVerification,
		gateExtraction,
		integrityEvidence,
		failure,
	};
}

async function durableCreateJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp.${process.pid}`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(value))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(temporary, path);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

async function durableReplaceJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.replace.${process.pid}.${Date.now()}`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(value))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await rename(temporary, path);
	} finally {
		await unlink(temporary).catch((error: unknown) => {
			if (!isMissingFileError(error)) throw error;
		});
	}
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

interface LocalLock {
	release(): Promise<void>;
}

const LOCAL_LOCK_HOLDER_SOURCE =
	'process.stdin.resume();process.stdin.once("end",()=>process.exit(0));process.stdout.write("LOCKED\\n");';

async function acquireLocalLock(path: string, waitMs = 120_000): Promise<LocalLock> {
	await mkdir(dirname(path), { recursive: true });
	const seed = await open(path, "a", 0o600);
	await seed.close();
	const child = spawn(
		"/usr/bin/lockf",
		[
			"-s",
			"-k",
			"-t",
			String(Math.max(1, Math.ceil(waitMs / 1_000))),
			path,
			process.execPath,
			"-e",
			LOCAL_LOCK_HOLDER_SOURCE,
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	let stdout = "";
	let stderr = "";
	let acquired = false;
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.stdin.on("error", () => undefined);
	const exited = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((done) => {
		child.once("close", (code, signal) => done({ code, signal }));
	});
	await new Promise<void>((done, reject) => {
		const onData = (): void => {
			if (!stdout.includes("LOCKED\n")) return;
			acquired = true;
			child.stdout.off("data", onData);
			done();
		};
		child.stdout.on("data", onData);
		child.once("error", reject);
		exited.then(({ code, signal }) => {
			if (!acquired)
				reject(
					new Error(`Timed out acquiring local evidence lock: ${path}; code=${code}; signal=${signal}; ${stderr}`),
				);
		});
	});
	let released = false;
	return {
		async release(): Promise<void> {
			if (released) return;
			released = true;
			child.stdin.end();
			const { code, signal } = await exited;
			if (code !== 0) {
				throw new Error(`Local evidence lock holder failed: ${path}; code=${code}; signal=${signal}; ${stderr}`);
			}
		},
	};
}

async function withLocalLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
	const lock = await acquireLocalLock(path);
	try {
		return await operation();
	} finally {
		await lock.release();
	}
}

async function withLedgerLock<T>(outputDir: string, operation: (ledger: EvidenceLedger) => Promise<T>): Promise<T> {
	return withLocalLock(resolve(outputDir, ".evidence.lock"), async () => {
		const ledger = await EvidenceLedger.open(resolve(outputDir, "evidence.jsonl"));
		return operation(ledger);
	});
}

function validateConfig(config: NanoGptFarmShareSmokeConfig): void {
	validateToken(config.host, "host", /^[A-Za-z0-9._-]+$/);
	if (config.remoteRoot !== FIXED_REMOTE_ROOT) throw new Error("NanoGPT smoke remote root is fixed");
	validateAbsolutePath(config.remoteRoot, "remote root");
	if (config.partition !== "gpu" || config.constraint !== "GPU_SKU:L40S") {
		throw new Error("NanoGPT smoke requires the fixed FarmShare L40S scheduler contract");
	}
	for (const [value, name] of [
		[config.pollIntervalMs, "pollIntervalMs"],
		[config.requestTimeoutMs, "requestTimeoutMs"],
		[config.dispatchVisibilityGraceMs, "dispatchVisibilityGraceMs"],
		[config.resultVisibilityGraceMs, "resultVisibilityGraceMs"],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	}
	if (config.requestTimeoutMs < config.pollIntervalMs) {
		throw new Error("requestTimeoutMs must be at least pollIntervalMs");
	}
}

async function retryTransient<T>(
	operation: () => Promise<T>,
	signal: AbortSignal,
	deadline: number,
	pollIntervalMs: number,
): Promise<T> {
	let attempt = 0;
	for (;;) {
		try {
			return await operation();
		} catch (error) {
			if (!(error instanceof KernelBenchTransientTransportError) || Date.now() >= deadline) throw error;
			const exponentialMs = 100 * 2 ** Math.min(attempt, 6);
			const backoffMs = Math.max(1, Math.min(exponentialMs, pollIntervalMs, deadline - Date.now()));
			attempt++;
			await delay(backoffMs, signal);
		}
	}
}

type RunManifestFields = Pick<
	NanoGptFarmShareSmokeSubmission,
	"jobKey" | "remoteJobDir" | "requestSha256" | "executionSeal" | "readiness"
>;
type SubmissionLedgerFields = RunManifestFields &
	Pick<NanoGptFarmShareSmokeSubmission, "status" | "recoveredRemoteResult" | "slurmJobId">;

function runManifestPayload(value: RunManifestFields): Record<string, unknown> {
	return {
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		claimBoundary: NANOGPT_SMOKE_CLAIM_BOUNDARY,
		jobKey: value.jobKey,
		remoteJobDir: value.remoteJobDir,
		requestSha256: value.requestSha256,
		executionSeal: value.executionSeal,
		readiness: value.readiness,
	};
}

function submissionStatePayload(value: SubmissionLedgerFields): Record<string, unknown> {
	return value.status === "result-ready"
		? {
				jobKey: value.jobKey,
				status: value.status,
				slurmJobId: value.slurmJobId,
				recoveredRemoteResult: true,
			}
		: { jobKey: value.jobKey, status: value.status, slurmJobId: value.slurmJobId };
}

function measurementPayload(
	value: Pick<
		NanoGptFarmShareSmokeLocalResult,
		"jobKey" | "ok" | "recoveredRemoteResult" | "slurmJobId" | "workerResult" | "controllerFailure"
	>,
): Record<string, unknown> {
	return {
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		jobKey: value.jobKey,
		ok: value.ok,
		recoveredRemoteResult: value.recoveredRemoteResult,
		slurmJobId: value.slurmJobId,
		workerResult: value.workerResult,
		controllerFailure: value.controllerFailure,
	};
}

function eventPayloadRecord(event: LedgerEvent): Record<string, unknown> | null {
	return isRecord(event.payload) ? event.payload : null;
}

function findLedgerEvent(events: readonly LedgerEvent[], hash: string, label: string): LedgerEvent {
	const event = events.find((candidate) => candidate.hash === hash);
	if (!event) throw new Error(`${label} is absent from the verified evidence ledger`);
	return event;
}

function verifySubmissionLedgerEvents(
	submission: NanoGptFarmShareSmokeSubmission,
	events: readonly LedgerEvent[],
): LedgerEvent {
	const stateEvent = findLedgerEvent(events, submission.ledgerTerminalHash, "Submission ledger event");
	if (stateEvent.kind !== "job_state" || !sameJson(stateEvent.payload, submissionStatePayload(submission))) {
		throw new Error("Submission ledger event kind or payload does not match the durable submission");
	}
	const expectedManifest = runManifestPayload(submission);
	let matchingManifest: LedgerEvent | null = null;
	for (let index = stateEvent.sequence - 1; index >= 0; index--) {
		const event = events[index];
		if (event.kind === "run_manifest" && sameJson(event.payload, expectedManifest)) {
			matchingManifest = event;
			break;
		}
	}
	if (!matchingManifest) {
		throw new Error("Submission ledger event has no exact preceding run manifest");
	}
	return stateEvent;
}

async function verifySubmissionLedgerBinding(submission: NanoGptFarmShareSmokeSubmission): Promise<{
	readonly ledger: EvidenceLedger;
	readonly stateEvent: LedgerEvent;
}> {
	const ledger = await EvidenceLedger.open(submission.ledgerPath);
	ledger.verify();
	const stateEvent = verifySubmissionLedgerEvents(submission, ledger.getEvents());
	return { ledger, stateEvent };
}

async function appendOrReuseExactLedgerEvent(
	ledger: EvidenceLedger,
	kind: LedgerEventKind,
	payload: Record<string, unknown>,
	conflicts: (event: LedgerEvent) => boolean,
): Promise<LedgerEvent> {
	ledger.verify();
	const events = ledger.getEvents();
	const exact = events.find((event) => event.kind === kind && sameJson(event.payload, payload));
	if (exact) return exact;
	if (events.some(conflicts)) throw new Error(`Conflicting ${kind} evidence already exists for this NanoGPT job`);
	return ledger.append(kind, payload);
}

function conflictsWithSubmissionState(expected: SubmissionLedgerFields, event: LedgerEvent): boolean {
	if (event.kind !== "job_state") return false;
	const payload = eventPayloadRecord(event);
	if (!payload || payload.jobKey !== expected.jobKey) return false;
	const status = payload.status;
	if (status !== "queued" && status !== "result-ready") return false;
	if (payload.slurmJobId !== expected.slurmJobId) return true;
	if (status === expected.status) return true;
	return expected.status === "queued" && status === "result-ready";
}

async function finalizeLocalResult(
	outputDir: string,
	submission: NanoGptFarmShareSmokeSubmission,
	base: Omit<NanoGptFarmShareSmokeLocalResult, "ledgerPath" | "ledgerTerminalHash">,
): Promise<NanoGptFarmShareSmokeLocalResult> {
	return withLedgerLock(outputDir, async (ledger) => {
		const existing = await loadExistingLocalResult(submission);
		if (existing && existing.workerResult !== null) return existing;
		if (existing && base.workerResult === null) return existing;
		const payload = measurementPayload(base);
		const stateEvent = verifySubmissionLedgerEvents(submission, ledger.getEvents());
		let measurementEvent = ledger
			.getEvents()
			.find(
				(event) =>
					event.sequence > stateEvent.sequence && event.kind === "measurement" && sameJson(event.payload, payload),
			);
		if (!measurementEvent) measurementEvent = await ledger.append("measurement", payload);
		ledger.verify();
		const ledgerPath = resolve(outputDir, "evidence.jsonl");
		const ledgerTerminalHash = measurementEvent.hash;
		const result: NanoGptFarmShareSmokeLocalResult = { ...base, ledgerPath, ledgerTerminalHash };
		if (existing) {
			await durableReplaceJson(resolve(outputDir, "result.json"), result);
			return result;
		}
		try {
			await durableCreateJson(resolve(outputDir, "result.json"), result);
			return result;
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
			const raced = await loadExistingLocalResult(submission);
			if (!raced) throw error;
			return raced;
		}
	});
}

function validateSubmission(submission: NanoGptFarmShareSmokeSubmission, config: NanoGptFarmShareSmokeConfig): void {
	if (
		submission.schemaVersion !== 1 ||
		submission.contract !== NANOGPT_FARMSHARE_SMOKE_CONTRACT ||
		submission.evidenceClass !== NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS ||
		(submission.status !== "queued" && submission.status !== "result-ready") ||
		!HASH_PATTERN.test(submission.jobKey) ||
		sha256Json(submission.executionSeal) !== submission.jobKey ||
		!HASH_PATTERN.test(submission.requestSha256) ||
		!submission.remoteJobDir.startsWith(`${config.remoteRoot}/jobs/`) ||
		submission.remoteJobDir !== `${config.remoteRoot}/jobs/${submission.jobKey}` ||
		!/^[0-9]+$/.test(submission.slurmJobId) ||
		resolve(submission.outputDir) !== submission.outputDir ||
		resolve(submission.ledgerPath) !== submission.ledgerPath ||
		submission.ledgerPath !== resolve(submission.outputDir, "evidence.jsonl")
	) {
		throw new Error("NanoGPT smoke submission identity is invalid");
	}
	if (
		submission.executionSeal.environment.environmentManifestSha256 !==
			submission.readiness.environment.environmentManifestSha256 ||
		submission.executionSeal.environment.pipFreezeSha256 !== submission.readiness.environment.pipFreezeSha256 ||
		submission.executionSeal.environment.environmentSealSha256 !==
			submission.readiness.environment.environmentSealSha256 ||
		!sameJson(submission.executionSeal.environment.executables, submission.readiness.environment.executables) ||
		!sameJson(submission.executionSeal.dataset.files, submission.readiness.dataset.files) ||
		!sameJson(submission.executionSeal.dataset.headers, submission.readiness.dataset.headers) ||
		!sameJson(submission.executionSeal.dataset.consumption, submission.readiness.dataset.consumption)
	) {
		throw new Error("NanoGPT smoke submission no longer matches readiness evidence");
	}
	if (
		(submission.status === "queued" && submission.workerResult !== null) ||
		(submission.status === "result-ready" && submission.workerResult === null) ||
		(submission.status === "queued" && submission.recoveredRemoteResult) ||
		(submission.status === "result-ready" && !submission.recoveredRemoteResult)
	) {
		throw new Error("NanoGPT smoke submission status and worker result disagree");
	}
	if (submission.workerResult !== null) {
		const parsed = parseNanoGptFarmShareWorkerResult(JSON.stringify(submission.workerResult), {
			jobKey: submission.jobKey,
			requestSha256: submission.requestSha256,
			executionSeal: submission.executionSeal,
			slurmJobId: submission.slurmJobId,
		});
		if (!sameJson(parsed, submission.workerResult)) {
			throw new Error("NanoGPT smoke submission contains non-canonical worker evidence");
		}
	}
}

async function createSubmissionArtifact(
	outputDir: string,
	base: Omit<NanoGptFarmShareSmokeSubmission, "ledgerPath" | "ledgerTerminalHash">,
	ledgerEventHash: string,
): Promise<NanoGptFarmShareSmokeSubmission> {
	return withLedgerLock(outputDir, async (ledger) => {
		ledger.verify();
		const ledgerPath = resolve(outputDir, "evidence.jsonl");
		const submission: NanoGptFarmShareSmokeSubmission = {
			...base,
			ledgerPath,
			ledgerTerminalHash: ledgerEventHash,
		};
		verifySubmissionLedgerEvents(submission, ledger.getEvents());
		try {
			await durableCreateJson(resolve(outputDir, "submission.json"), submission);
			return submission;
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
			return loadNanoGptFarmShareSmokeSubmission(resolve(outputDir, "submission.json"));
		}
	});
}

export async function loadNanoGptFarmShareSmokeSubmission(path: string): Promise<NanoGptFarmShareSmokeSubmission> {
	const value = expectRecord(JSON.parse(await readFile(path, "utf8")), "submission");
	expectExactKeys(
		value,
		[
			"schemaVersion",
			"contract",
			"evidenceClass",
			"status",
			"recoveredRemoteResult",
			"outputDir",
			"jobKey",
			"remoteJobDir",
			"slurmJobId",
			"requestSha256",
			"executionSeal",
			"readiness",
			"workerResult",
			"ledgerPath",
			"ledgerTerminalHash",
		],
		"submission",
	);
	const submission = value as unknown as NanoGptFarmShareSmokeSubmission;
	validateSubmission(submission, DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG);
	if (submission.outputDir !== dirname(resolve(path))) {
		throw new Error("NanoGPT smoke submission output directory does not match its durable location");
	}
	if (!HASH_PATTERN.test(submission.ledgerTerminalHash)) throw new Error("Submission ledger hash is invalid");
	await verifySubmissionLedgerBinding(submission);
	return submission;
}

async function loadExistingLocalResult(
	submission: NanoGptFarmShareSmokeSubmission,
): Promise<NanoGptFarmShareSmokeLocalResult | null> {
	let raw: string;
	try {
		raw = await readFile(resolve(submission.outputDir, "result.json"), "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return null;
		throw error;
	}
	const value = expectRecord(JSON.parse(raw), "localResult");
	expectExactKeys(
		value,
		[
			"schemaVersion",
			"contract",
			"evidenceClass",
			"ok",
			"recoveredRemoteResult",
			"jobKey",
			"remoteJobDir",
			"slurmJobId",
			"requestSha256",
			"executionSeal",
			"readiness",
			"workerResult",
			"controllerFailure",
			"ledgerPath",
			"ledgerTerminalHash",
		],
		"localResult",
	);
	const ok = expectBoolean(value.ok, "localResult.ok");
	const recoveredRemoteResult = expectBoolean(value.recoveredRemoteResult, "localResult.recoveredRemoteResult");
	const ledgerPath = expectString(value.ledgerPath, "localResult.ledgerPath");
	const ledgerTerminalHash = expectSha256(value.ledgerTerminalHash, "localResult.ledgerTerminalHash");
	if (
		value.schemaVersion !== 1 ||
		value.contract !== NANOGPT_FARMSHARE_SMOKE_CONTRACT ||
		value.evidenceClass !== NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS ||
		value.jobKey !== submission.jobKey ||
		value.remoteJobDir !== submission.remoteJobDir ||
		value.slurmJobId !== submission.slurmJobId ||
		value.requestSha256 !== submission.requestSha256 ||
		!sameJson(value.executionSeal, submission.executionSeal) ||
		!sameJson(value.readiness, submission.readiness) ||
		ledgerPath !== submission.ledgerPath
	) {
		throw new Error("Existing local result is not bound to the immutable submission");
	}
	const workerResult =
		value.workerResult === null
			? null
			: parseNanoGptFarmShareWorkerResult(JSON.stringify(value.workerResult), {
					jobKey: submission.jobKey,
					requestSha256: submission.requestSha256,
					executionSeal: submission.executionSeal,
					slurmJobId: submission.slurmJobId,
				});
	const controllerFailure =
		value.controllerFailure === null ? null : expectString(value.controllerFailure, "localResult.controllerFailure");
	if (
		(workerResult !== null &&
			(ok !== workerResult.ok || controllerFailure !== (workerResult.failure?.message ?? null))) ||
		(workerResult === null && (ok || controllerFailure === null))
	) {
		throw new Error("Existing local result status disagrees with its bound evidence");
	}
	const { ledger, stateEvent } = await verifySubmissionLedgerBinding(submission);
	const measurementEvent = findLedgerEvent(ledger.getEvents(), ledgerTerminalHash, "Local result ledger event");
	if (
		measurementEvent.sequence <= stateEvent.sequence ||
		measurementEvent.kind !== "measurement" ||
		!sameJson(
			measurementEvent.payload,
			measurementPayload({
				jobKey: submission.jobKey,
				ok,
				recoveredRemoteResult,
				slurmJobId: submission.slurmJobId,
				workerResult,
				controllerFailure,
			}),
		)
	) {
		throw new Error("Existing local result does not bind an exact post-submission measurement event");
	}
	return {
		schemaVersion: 1,
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		ok,
		recoveredRemoteResult,
		jobKey: submission.jobKey,
		remoteJobDir: submission.remoteJobDir,
		slurmJobId: submission.slurmJobId,
		requestSha256: submission.requestSha256,
		executionSeal: submission.executionSeal,
		readiness: submission.readiness,
		workerResult,
		controllerFailure,
		ledgerPath,
		ledgerTerminalHash,
	};
}

export async function submitNanoGptFarmShareStockSmoke(
	options: RunNanoGptFarmShareSmokeOptions,
): Promise<NanoGptFarmShareSmokeSubmission> {
	const config = options.config ?? DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG;
	validateConfig(config);
	const signal = options.signal ?? new AbortController().signal;
	const outputDir = resolve(options.outputDir);
	return withLocalLock(resolve(outputDir, ".submission.lock"), () =>
		submitNanoGptFarmShareStockSmokeLocked(options, config, signal, outputDir),
	);
}

async function submitNanoGptFarmShareStockSmokeLocked(
	options: RunNanoGptFarmShareSmokeOptions,
	config: NanoGptFarmShareSmokeConfig,
	signal: AbortSignal,
	outputDir: string,
): Promise<NanoGptFarmShareSmokeSubmission> {
	try {
		return await loadNanoGptFarmShareSmokeSubmission(resolve(outputDir, "submission.json"));
	} catch (error) {
		if (!isMissingFileError(error)) throw error;
	}
	const transport = options.transport ?? new SshNanoGptFarmShareSmokeTransport(config);
	const temporaryRoot = await mkdtemp(join(tmpdir(), "prime-nanogpt-farmshare-smoke-"));
	try {
		const assets = await materializeStockBundle(temporaryRoot);
		const readinessRaw = await transport.readiness(
			config.remoteRoot,
			NANOGPT_REUSED_ENVIRONMENT_DIR,
			NANOGPT_SMOKE_DATA_MANIFEST_SHA256,
			signal,
		);
		const readiness = parseNanoGptSmokeReadiness(readinessRaw, config.remoteRoot, assets.datasetManifestSource);
		const prepared = buildPreparedAssets(config, assets, readiness);
		const manifestFields: RunManifestFields = {
			jobKey: prepared.jobKey,
			remoteJobDir: prepared.remoteJobDir,
			requestSha256: prepared.requestSha256,
			executionSeal: prepared.executionSeal,
			readiness,
		};
		const manifestPayload = runManifestPayload(manifestFields);
		await withLedgerLock(outputDir, async (ledger) => {
			await appendOrReuseExactLedgerEvent(
				ledger,
				"run_manifest",
				manifestPayload,
				(event) => event.kind === "run_manifest" && eventPayloadRecord(event)?.jobKey === prepared.jobKey,
			);
		});
		const deadline = Date.now() + config.requestTimeoutMs;
		const existing = await retryTransient(
			() => transport.readExistingResult(prepared.remoteJobDir, signal),
			signal,
			deadline,
			config.pollIntervalMs,
		);
		if (existing) {
			const workerResult = parseNanoGptFarmShareWorkerResult(existing.rawResult, {
				...prepared,
				slurmJobId: existing.slurmJobId,
			});
			const submissionBase = {
				schemaVersion: 1,
				contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
				evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
				status: "result-ready",
				recoveredRemoteResult: true,
				outputDir,
				jobKey: prepared.jobKey,
				remoteJobDir: prepared.remoteJobDir,
				slurmJobId: existing.slurmJobId,
				requestSha256: prepared.requestSha256,
				executionSeal: prepared.executionSeal,
				readiness,
				workerResult,
			} as const;
			const stateEvent = await withLedgerLock(outputDir, (ledger) =>
				appendOrReuseExactLedgerEvent(ledger, "job_state", submissionStatePayload(submissionBase), (event) =>
					conflictsWithSubmissionState(submissionBase, event),
				),
			);
			return createSubmissionArtifact(outputDir, submissionBase, stateEvent.hash);
		}
		await retryTransient(
			() => transport.prepare(prepared.remoteJobDir, prepared.prepared, signal),
			signal,
			deadline,
			config.pollIntervalMs,
		);
		const dispatch = await retryTransient(
			() => transport.ensureSubmitted(prepared.remoteJobDir, `pngs-${prepared.jobKey.slice(0, 19)}`, signal),
			signal,
			deadline,
			config.pollIntervalMs,
		);
		const submissionBase = {
			schemaVersion: 1,
			contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
			evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
			status: "queued",
			recoveredRemoteResult: false,
			outputDir,
			jobKey: prepared.jobKey,
			remoteJobDir: prepared.remoteJobDir,
			slurmJobId: dispatch.slurmJobId,
			requestSha256: prepared.requestSha256,
			executionSeal: prepared.executionSeal,
			readiness,
			workerResult: null,
		} as const;
		const stateEvent = await withLedgerLock(outputDir, (ledger) =>
			appendOrReuseExactLedgerEvent(ledger, "job_state", submissionStatePayload(submissionBase), (event) =>
				conflictsWithSubmissionState(submissionBase, event),
			),
		);
		return createSubmissionArtifact(outputDir, submissionBase, stateEvent.hash);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export async function reconcileNanoGptFarmShareStockSmoke(
	options: ReconcileNanoGptFarmShareSmokeOptions,
): Promise<NanoGptFarmShareSmokeReconcileResult> {
	const config = options.config ?? DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG;
	validateConfig(config);
	validateSubmission(options.submission, config);
	const durableSubmission = await loadNanoGptFarmShareSmokeSubmission(
		resolve(options.submission.outputDir, "submission.json"),
	);
	if (!sameJson(durableSubmission, options.submission)) {
		throw new Error("Requested NanoGPT submission does not match its durable ledger-bound artifact");
	}
	const submission = durableSubmission;
	const existingLocalResult = await loadExistingLocalResult(submission);
	if (existingLocalResult && existingLocalResult.workerResult !== null) {
		return { status: "completed", result: existingLocalResult };
	}
	const signal = options.signal ?? new AbortController().signal;
	const transport = options.transport ?? new SshNanoGptFarmShareSmokeTransport(config);
	const finalizeWorker = async (
		workerResult: NanoGptFarmShareWorkerResult,
		recoveredRemoteResult: boolean,
	): Promise<NanoGptFarmShareSmokeReconcileResult> => ({
		status: "completed",
		result: await finalizeLocalResult(submission.outputDir, submission, {
			schemaVersion: 1,
			contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
			evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
			ok: workerResult.ok,
			recoveredRemoteResult,
			jobKey: submission.jobKey,
			remoteJobDir: submission.remoteJobDir,
			slurmJobId: submission.slurmJobId,
			requestSha256: submission.requestSha256,
			executionSeal: submission.executionSeal,
			readiness: submission.readiness,
			workerResult,
			controllerFailure: workerResult.failure?.message ?? null,
		}),
	});
	const finalizeFailure = async (
		message: string,
		recoveredRemoteResult = false,
	): Promise<NanoGptFarmShareSmokeReconcileResult> => ({
		status: "completed",
		result: await finalizeLocalResult(submission.outputDir, submission, {
			schemaVersion: 1,
			contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
			evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
			ok: false,
			recoveredRemoteResult,
			jobKey: submission.jobKey,
			remoteJobDir: submission.remoteJobDir,
			slurmJobId: submission.slurmJobId,
			requestSha256: submission.requestSha256,
			executionSeal: submission.executionSeal,
			readiness: submission.readiness,
			workerResult: null,
			controllerFailure: message,
		}),
	});
	if (submission.workerResult) return finalizeWorker(submission.workerResult, true);
	const parseExisting = (existing: NanoGptSmokeExistingResult): NanoGptFarmShareWorkerResult => {
		if (existing.slurmJobId !== submission.slurmJobId) {
			throw new Error("Durable remote result SLURM identity does not match the submission");
		}
		return parseNanoGptFarmShareWorkerResult(existing.rawResult, {
			jobKey: submission.jobKey,
			requestSha256: submission.requestSha256,
			executionSeal: submission.executionSeal,
			slurmJobId: submission.slurmJobId,
		});
	};
	const cancelAfterTimeout = async (message: string): Promise<NanoGptFarmShareSmokeReconcileResult> => {
		const cancellationDeadline = Date.now() + config.resultVisibilityGraceMs;
		const cancellationAccounting = await retryTransient(
			() => transport.cancelAndVerify(submission.remoteJobDir, submission.slurmJobId, signal),
			signal,
			cancellationDeadline,
			config.pollIntervalMs,
		);
		let finalReadFailure: string | null = null;
		const visibilityDeadline = Date.now() + config.resultVisibilityGraceMs;
		for (;;) {
			let finalExisting: NanoGptSmokeExistingResult | null = null;
			try {
				finalExisting = await retryTransient(
					() => transport.readExistingResult(submission.remoteJobDir, signal),
					signal,
					visibilityDeadline,
					config.pollIntervalMs,
				);
			} catch (error) {
				finalReadFailure = error instanceof Error ? error.message : String(error);
				if (!(error instanceof KernelBenchTransientTransportError)) break;
			}
			if (finalExisting) {
				try {
					return finalizeWorker(parseExisting(finalExisting), true);
				} catch (error) {
					return finalizeFailure(
						`Invalid cancellation-boundary worker result: ${error instanceof Error ? error.message : String(error)}`,
						true,
					);
				}
			}
			if (Date.now() >= visibilityDeadline) break;
			await delay(Math.min(config.pollIntervalMs, Math.max(1, visibilityDeadline - Date.now())), signal);
		}
		return finalizeFailure(
			`${message}; cancellation verified: ${cancellationAccounting}${
				finalReadFailure ? `; final result read unavailable: ${finalReadFailure}` : ""
			}`,
		);
	};

	const deadline = Date.now() + config.requestTimeoutMs;
	let existing: NanoGptSmokeExistingResult | null;
	try {
		existing = await retryTransient(
			() => transport.readExistingResult(submission.remoteJobDir, signal),
			signal,
			deadline,
			config.pollIntervalMs,
		);
	} catch (error) {
		if (!(options.wait && error instanceof KernelBenchTransientTransportError && Date.now() >= deadline)) throw error;
		return cancelAfterTimeout("Timed out while reading remote state");
	}
	if (existing) {
		try {
			const workerResult = parseExisting(existing);
			return finalizeWorker(workerResult, true);
		} catch (error) {
			return finalizeFailure(
				`Invalid immutable remote result: ${error instanceof Error ? error.message : String(error)}`,
				true,
			);
		}
	}

	for (;;) {
		let poll: NanoGptSmokeRemotePoll;
		try {
			poll = await retryTransient(
				() => transport.poll(submission.remoteJobDir, signal),
				signal,
				deadline,
				config.pollIntervalMs,
			);
		} catch (error) {
			if (!(options.wait && error instanceof KernelBenchTransientTransportError && Date.now() >= deadline))
				throw error;
			return cancelAfterTimeout("Timed out while polling remote state");
		}
		if (poll.kind === "result") {
			try {
				const workerResult = parseNanoGptFarmShareWorkerResult(poll.rawResult, {
					jobKey: submission.jobKey,
					requestSha256: submission.requestSha256,
					executionSeal: submission.executionSeal,
					slurmJobId: submission.slurmJobId,
				});
				return finalizeWorker(workerResult, false);
			} catch (error) {
				return finalizeFailure(
					`Invalid durable worker result: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (poll.kind === "failed") {
			const lateResult = await transport.readExistingResult(submission.remoteJobDir, signal);
			if (lateResult) {
				try {
					return finalizeWorker(parseExisting(lateResult), true);
				} catch (error) {
					return finalizeFailure(
						`Invalid late durable worker result: ${error instanceof Error ? error.message : String(error)}`,
						true,
					);
				}
			}
			return finalizeFailure(`${poll.reason}${poll.log ? `\n${poll.log}` : ""}`);
		}
		if (!options.wait) {
			const event = await withLedgerLock(submission.outputDir, async (ledger) => {
				const appended = await ledger.append("job_state", {
					jobKey: submission.jobKey,
					status: "pending",
					slurmJobId: submission.slurmJobId,
					schedulerState: poll.schedulerState,
				});
				ledger.verify();
				return appended;
			});
			return {
				status: "pending",
				schedulerState: poll.schedulerState,
				submission,
				ledgerTerminalHash: event.hash,
			};
		}
		if (Date.now() >= deadline) {
			let lateResult: NanoGptSmokeExistingResult | null = null;
			let boundaryReadFailure: string | null = null;
			try {
				lateResult = await transport.readExistingResult(submission.remoteJobDir, signal);
			} catch (error) {
				boundaryReadFailure = error instanceof Error ? error.message : String(error);
			}
			if (lateResult) {
				try {
					return finalizeWorker(parseExisting(lateResult), true);
				} catch (error) {
					return finalizeFailure(
						`Invalid timeout-boundary worker result: ${error instanceof Error ? error.message : String(error)}`,
						true,
					);
				}
			}
			return cancelAfterTimeout(
				`Timed out after ${config.requestTimeoutMs}ms${
					boundaryReadFailure ? `; timeout-boundary result read unavailable: ${boundaryReadFailure}` : ""
				}`,
			);
		}
		await delay(config.pollIntervalMs, signal);
	}
}

export async function runNanoGptFarmShareStockSmoke(
	options: RunNanoGptFarmShareSmokeOptions,
): Promise<NanoGptFarmShareSmokeLocalResult> {
	const submission = await submitNanoGptFarmShareStockSmoke(options);
	const reconciled = await reconcileNanoGptFarmShareStockSmoke({
		submission,
		config: options.config,
		transport: options.transport,
		signal: options.signal,
		wait: true,
	});
	if (reconciled.status !== "completed") throw new Error("Blocking NanoGPT smoke reconciliation returned pending");
	return reconciled.result;
}

interface CliOptions {
	readonly outputDir: string;
	readonly operation: "dry-run" | "submit" | "reconcile" | "wait" | "submit-and-wait";
}

function parseCliOptions(argv: readonly string[]): CliOptions {
	let outputDir: string | null = null;
	let operation: CliOptions["operation"] = "dry-run";
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--output-dir") {
			const value = argv[index + 1];
			if (!value) throw new Error("--output-dir requires a path");
			outputDir = resolve(value);
			index++;
			continue;
		}
		if (["--submit", "--reconcile", "--wait", "--submit-and-wait"].includes(argument)) {
			if (operation !== "dry-run") throw new Error("Choose exactly one controller operation");
			operation = argument.slice(2) as CliOptions["operation"];
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (!outputDir) {
		throw new Error(
			"Usage: tsx src/nanogpt-farmshare-smoke.ts --output-dir <durable-path> " +
				"[--submit|--reconcile|--wait|--submit-and-wait]",
		);
	}
	return { outputDir, operation };
}

async function main(): Promise<void> {
	const options = parseCliOptions(process.argv.slice(2));
	if (options.operation === "dry-run") {
		console.log(
			JSON.stringify(
				{
					schemaVersion: 1,
					contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
					evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
					status: "dry-run; pass --submit only after the sealed environment and two-file dataset are ready",
					candidateSha256: NANOGPT_BASELINE_SHA256,
					runtimeContract: NANOGPT_RUNTIME_CONTRACT_ID,
					mode: "cuda-smoke-10",
					trials: 1,
					environmentDirectory: NANOGPT_REUSED_ENVIRONMENT_DIR,
					datasetManifestSha256: NANOGPT_SMOKE_DATA_MANIFEST_SHA256,
					remoteRoot: DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot,
					outputDir: options.outputDir,
					claimBoundary: "infrastructure-only; not candidate-quality or scored evidence",
				},
				null,
				2,
			),
		);
		return;
	}
	if (options.operation === "submit") {
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir: options.outputDir });
		console.log(JSON.stringify(submission));
		return;
	}
	if (options.operation === "submit-and-wait") {
		const result = await runNanoGptFarmShareStockSmoke({ outputDir: options.outputDir });
		console.log(JSON.stringify(result));
		if (!result.ok) process.exitCode = 1;
		return;
	}
	const submission = await loadNanoGptFarmShareSmokeSubmission(resolve(options.outputDir, "submission.json"));
	const reconciled = await reconcileNanoGptFarmShareStockSmoke({
		submission,
		wait: options.operation === "wait",
	});
	console.log(JSON.stringify(reconciled));
	if (reconciled.status === "completed" && !reconciled.result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();

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
import {
	buildNanoGptScoredParallelChildCompletion,
	buildNanoGptScoredParallelChildRequest,
	type NanoGptScoredParallelArchiveEvidence,
	type NanoGptScoredParallelChildCompletion,
	type NanoGptScoredParallelChildRequest,
	type NanoGptScoredParallelMode,
	type NanoGptScoredParallelPins,
	type NanoGptScoredParallelSchedulerEvidence,
	type NanoGptScoredParallelStageRequest,
	nanoGptScoredParallelExternalHandle,
	parseNanoGptScoredParallelChildCompletion,
	parseNanoGptScoredParallelChildWorkerResult,
	parseNanoGptScoredParallelExternalHandle,
	verifyNanoGptScoredParallelStageRequest,
} from "./nanogpt-scored-parallel-protocol.js";
import {
	NANOGPT_SCORED_DATA_MANIFEST_SHA256,
	NANOGPT_SCORED_DATASET_ROOT,
	NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE,
	NANOGPT_SCORED_ENVIRONMENT_DIR,
	NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
	NANOGPT_SCORED_ENVIRONMENT_SHA256,
	NANOGPT_SCORED_ENVIRONMENT_SPEC_SHA256,
	NANOGPT_SCORED_FETCH_TRIAL_LOG_REMOTE,
	NANOGPT_SCORED_READINESS_REMOTE,
	NANOGPT_SCORED_STATIC_EVALUATOR_SHA256,
} from "./nanogpt-scored-transport.js";

export const NANOGPT_SCORED_PARALLEL_REMOTE_ROOT =
	"/scratch/users/duynguy/prime-autoresearch/nanogpt/scored-parallel-v2" as const;

export const NANOGPT_SCORED_PARALLEL_CHILD_TIMES: Readonly<Record<NanoGptScoredParallelMode, string>> = {
	"smoke-10": "00:30:00",
	"score-3": "06:00:00",
	"replay-8": "06:00:00",
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_LOG_OUTPUT_BYTES = 24 * 1024 * 1024;
const MAX_PREPARE_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_LOG_BYTES = 16 * 1024 * 1024;
const MAX_TRANSIENT_RETRIES = 8;

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

const PREPARED_PATHS = [
	"base-worker.py",
	"candidate.patch",
	"child-request.json",
	"dataset-manifest.json",
	"environment-seal.json",
	"environment.json",
	"job.sh",
	"nanogpt_contract.py",
	"stage-request.json",
	"train_gpt_simple.py",
	"worker.py",
] as const;

export interface NanoGptScoredParallelTransportConfig {
	readonly host: string;
	readonly remotePython: string;
	readonly partition: "gpu";
	readonly constraint: "GPU_SKU:L40S";
	readonly remoteRoot: typeof NANOGPT_SCORED_PARALLEL_REMOTE_ROOT;
	readonly environmentDir: typeof NANOGPT_SCORED_ENVIRONMENT_DIR;
	readonly datasetRoot: typeof NANOGPT_SCORED_DATASET_ROOT;
	readonly localParallelWorkerPath: string;
	readonly localBaseWorkerPath: string;
	readonly localParallelTransportPath: string;
	readonly localHostAggregationPath: string;
	readonly localStaticEvaluatorPath: string;
	readonly localBaselinePath: string;
	readonly localDatasetManifestPath: string;
	readonly localEvidenceDir: string;
	readonly pollIntervalMs: number;
	readonly commandTimeoutMs: number;
	readonly readinessTimeoutMs: number;
	readonly dispatchVisibilityGraceMs: number;
	readonly resultVisibilityGraceMs: number;
	readonly reconcileTimeoutMs: number | null;
}

export const DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG: NanoGptScoredParallelTransportConfig = {
	host: "farmshare",
	remotePython: "/usr/bin/python3",
	partition: "gpu",
	constraint: "GPU_SKU:L40S",
	remoteRoot: NANOGPT_SCORED_PARALLEL_REMOTE_ROOT,
	environmentDir: NANOGPT_SCORED_ENVIRONMENT_DIR,
	datasetRoot: NANOGPT_SCORED_DATASET_ROOT,
	localParallelWorkerPath: fileURLToPath(new URL("../evaluators/nanogpt_scored_parallel_worker.py", import.meta.url)),
	localBaseWorkerPath: fileURLToPath(new URL("../evaluators/nanogpt_scored_worker.py", import.meta.url)),
	localParallelTransportPath: fileURLToPath(new URL("./nanogpt-scored-parallel-transport.ts", import.meta.url)),
	localHostAggregationPath: fileURLToPath(new URL("./nanogpt-scored-parallel-protocol.ts", import.meta.url)),
	localStaticEvaluatorPath: fileURLToPath(new URL("../evaluators/nanogpt_contract.py", import.meta.url)),
	localBaselinePath: NANOGPT_BASELINE_FIXTURE,
	localDatasetManifestPath: fileURLToPath(new URL("../farmshare/nanogpt-scored-data.json", import.meta.url)),
	localEvidenceDir: fileURLToPath(new URL("../runs/nanogpt-scored-parallel-transport-evidence", import.meta.url)),
	pollIntervalMs: 10_000,
	commandTimeoutMs: 120_000,
	readinessTimeoutMs: 600_000,
	dispatchVisibilityGraceMs: 120_000,
	resultVisibilityGraceMs: 120_000,
	reconcileTimeoutMs: null,
};

export interface NanoGptScoredParallelTransportCompletion {
	readonly schemaVersion: 1;
	readonly stageRequestDigest: string;
	readonly externalHandle: string;
	readonly children: readonly NanoGptScoredParallelChildCompletion[];
}

export interface NanoGptScoredParallelReadiness {
	readonly pins: NanoGptScoredParallelPins;
	readonly environmentDirectory: typeof NANOGPT_SCORED_ENVIRONMENT_DIR;
	readonly datasetDirectory: typeof NANOGPT_SCORED_DATASET_ROOT;
}

export interface NanoGptScoredParallelTransport {
	execute(
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelTransportCompletion>;
	resume(
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		externalHandle: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelTransportCompletion>;
	verifyArchiveEvidence(
		request: NanoGptScoredParallelStageRequest,
		completion: NanoGptScoredParallelTransportCompletion,
		signal: AbortSignal,
	): Promise<void>;
}

export interface NanoGptScoredParallelTransportDependencies {
	readonly commandRunner?: CompilerGymWarmCommandRunner;
}

export class NanoGptScoredParallelAmbiguousDispatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NanoGptScoredParallelAmbiguousDispatchError";
	}
}

export class NanoGptScoredParallelReconcileTimeoutError extends Error {
	constructor(
		readonly childIndex: number,
		readonly timeoutMs: number,
	) {
		super(`NanoGPT parallel child ${childIndex} exceeded its ${timeoutMs}ms reconcile timeout`);
		this.name = "NanoGptScoredParallelReconcileTimeoutError";
	}
}

interface LocalAssets {
	readonly parallelWorker: string;
	readonly baseWorker: string;
	readonly parallelTransport: string;
	readonly hostAggregation: string;
	readonly staticEvaluator: string;
	readonly baseline: string;
	readonly datasetManifest: string;
}

interface ReadinessAssets {
	readonly environmentManifest: string;
	readonly environmentSeal: string;
}

interface PreparedChild {
	readonly request: NanoGptScoredParallelChildRequest;
	readonly remoteJobDir: string;
	readonly jobName: string;
	readonly jobScript: string;
	readonly jobScriptSha256: string;
	readonly assets: readonly {
		readonly path: (typeof PREPARED_PATHS)[number];
		readonly mode: 0o400 | 0o500;
		readonly content: string;
	}[];
}

interface RemoteLogEvidence {
	readonly remoteName: string;
	readonly byteLength: number;
	readonly sha256: string;
}

type RemotePoll =
	| { readonly kind: "pending"; readonly schedulerState: string }
	| { readonly kind: "failed"; readonly reason: string; readonly log: string }
	| {
			readonly kind: "result";
			readonly resultBase64: string;
			readonly resultByteLength: number;
			readonly resultSha256: string;
			readonly log: RemoteLogEvidence;
			readonly scheduler: NanoGptScoredParallelSchedulerEvidence;
	  };

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

function integer(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
	return value;
}

function sha256(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!SHA256_PATTERN.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return parsed;
}

function shellQuote(value: string): string {
	if (/[\0\n\r]/.test(value)) throw new Error("Shell argument contains a forbidden control character");
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new Error("NanoGPT parallel transport aborted");
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

function isTransient(result: CompilerGymWarmCommandResult): boolean {
	const output = `${result.stdout}\n${result.stderr}`;
	if (/NANOGPT_SCHEDULER_IDENTITY:|ambiguous/i.test(output)) return false;
	if (result.exitCode === 255 || result.exitCode === null) return true;
	return /(?:unable to contact|socket timed out|slurm(?:ctld|dbd).*(?:unavailable|connect|timeout)|connection (?:closed|refused|reset)|temporary failure)/i.test(
		output,
	);
}

function commandFailure(result: CompilerGymWarmCommandResult): string {
	return [
		`FarmShare command failed (exit ${result.exitCode ?? "signal"})`,
		`stdout:\n${result.stdout || "<empty>"}`,
		`stderr:\n${result.stderr || "<empty>"}`,
	].join("\n");
}

function parseSingleJson(source: string, path: string): Record<string, unknown> {
	const lines = source
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length !== 1) throw new Error(`${path} returned ${lines.length} JSON lines`);
	return record(JSON.parse(lines[0]), path);
}

function sha256Bytes(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function validateAbsolutePath(value: string, path: string): void {
	if (
		!/^\/[A-Za-z0-9._/-]+$/.test(value) ||
		value
			.slice(1)
			.split("/")
			.some((part) => ["", ".", ".."].includes(part))
	) {
		throw new Error(`${path} must be an absolute normalized safe path`);
	}
}

function validateConfig(config: NanoGptScoredParallelTransportConfig): void {
	if (!/^[A-Za-z0-9._-]+$/.test(config.host)) throw new Error("NanoGPT parallel SSH host is unsafe");
	for (const [path, label] of [
		[config.remotePython, "remotePython"],
		[config.remoteRoot, "remoteRoot"],
		[config.environmentDir, "environmentDir"],
		[config.datasetRoot, "datasetRoot"],
		[config.localParallelWorkerPath, "localParallelWorkerPath"],
		[config.localBaseWorkerPath, "localBaseWorkerPath"],
		[config.localParallelTransportPath, "localParallelTransportPath"],
		[config.localHostAggregationPath, "localHostAggregationPath"],
		[config.localStaticEvaluatorPath, "localStaticEvaluatorPath"],
		[config.localBaselinePath, "localBaselinePath"],
		[config.localDatasetManifestPath, "localDatasetManifestPath"],
		[config.localEvidenceDir, "localEvidenceDir"],
	] as const) {
		validateAbsolutePath(path, label);
	}
	if (
		config.partition !== "gpu" ||
		config.constraint !== "GPU_SKU:L40S" ||
		config.remoteRoot !== NANOGPT_SCORED_PARALLEL_REMOTE_ROOT ||
		config.environmentDir !== NANOGPT_SCORED_ENVIRONMENT_DIR ||
		config.datasetRoot !== NANOGPT_SCORED_DATASET_ROOT ||
		resolve(config.localEvidenceDir) !== config.localEvidenceDir
	) {
		throw new Error("NanoGPT parallel transport fixed FarmShare route changed");
	}
	for (const [value, label] of [
		[config.pollIntervalMs, "pollIntervalMs"],
		[config.commandTimeoutMs, "commandTimeoutMs"],
		[config.readinessTimeoutMs, "readinessTimeoutMs"],
		[config.dispatchVisibilityGraceMs, "dispatchVisibilityGraceMs"],
		[config.resultVisibilityGraceMs, "resultVisibilityGraceMs"],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
	}
	if (
		config.reconcileTimeoutMs !== null &&
		(!Number.isSafeInteger(config.reconcileTimeoutMs) || config.reconcileTimeoutMs < config.pollIntervalMs)
	) {
		throw new Error("reconcileTimeoutMs must be null or at least pollIntervalMs");
	}
}

export function nanoGptScoredParallelChildRemoteDir(
	childRequestDigest: string,
	config: NanoGptScoredParallelTransportConfig = DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
): string {
	sha256(childRequestDigest, "childRequestDigest");
	validateConfig(config);
	return `${config.remoteRoot}/jobs/${childRequestDigest}`;
}

export function nanoGptScoredParallelChildJobName(childRequestDigest: string): string {
	sha256(childRequestDigest, "childRequestDigest");
	return `pngp-${childRequestDigest.slice(0, 24)}`;
}

export function buildNanoGptScoredParallelChildJobScript(
	stage: NanoGptScoredParallelStageRequest,
	child: NanoGptScoredParallelChildRequest,
	config: NanoGptScoredParallelTransportConfig = DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
): string {
	verifyNanoGptScoredParallelStageRequest(stage);
	validateConfig(config);
	const remoteJobDir = nanoGptScoredParallelChildRemoteDir(child.childRequestDigest, config);
	const jobName = nanoGptScoredParallelChildJobName(child.childRequestDigest);
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
#SBATCH --time=${NANOGPT_SCORED_PARALLEL_CHILD_TIMES[stage.mode]}
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
		--stage-request ${shellQuote(`${remoteJobDir}/stage-request.json`)} \
		--child-request ${shellQuote(`${remoteJobDir}/child-request.json`)} \
		--candidate-patch ${shellQuote(`${remoteJobDir}/candidate.patch`)} \
		--baseline ${shellQuote(`${remoteJobDir}/train_gpt_simple.py`)} \
		--static-evaluator ${shellQuote(`${remoteJobDir}/nanogpt_contract.py`)} \
		--base-worker ${shellQuote(`${remoteJobDir}/base-worker.py`)} \
		--environment-manifest ${shellQuote(`${remoteJobDir}/environment.json`)} \
		--environment-seal ${shellQuote(`${remoteJobDir}/environment-seal.json`)} \
		--dataset-manifest ${shellQuote(`${remoteJobDir}/dataset-manifest.json`)} \
		--dataset-root ${shellQuote(config.datasetRoot)} \
		--trial-log-dir ${shellQuote(trialLogs)} \
		--output ${shellQuote(`${remoteJobDir}/result.json`)}
`;
}

export const NANOGPT_SCORED_PARALLEL_PREPARE_REMOTE = `
import base64, hashlib, json, os, pathlib, stat, sys, time
root = pathlib.Path(sys.argv[1])
remote_root = pathlib.Path(sys.argv[2])
child_digest = sys.argv[3]
payload = json.load(sys.stdin)
expected = ${JSON.stringify(PREPARED_PATHS)}
files = payload.get("files")
if not isinstance(files, list) or sorted(item.get("path") for item in files) != sorted(expected):
    raise SystemExit("prepared NanoGPT parallel asset set changed")
if root != remote_root / "jobs" / child_digest:
    raise SystemExit("NanoGPT parallel child directory escaped its digest route")
root.mkdir(parents=True, exist_ok=True, mode=0o700)
if root.is_symlink() or not root.is_dir():
    raise SystemExit("NanoGPT parallel child root must be a non-symlink directory")
os.chmod(root, 0o700)
if root.stat().st_uid != os.getuid() or stat.S_IMODE(root.lstat().st_mode) != 0o700:
    raise SystemExit("NanoGPT parallel child root ownership or mode changed")
decoded = {}
def regular_exact(path, content, mode):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != mode or path.read_bytes() != content:
        raise SystemExit("immutable NanoGPT parallel asset mismatch: " + str(path))
    for _ in range(100):
        if path.stat().st_nlink == 1:
            return
        time.sleep(0.01)
    raise SystemExit("immutable NanoGPT parallel asset has unexpected hard links: " + str(path))
for item in files:
    if set(item) != {"path", "mode", "content"} or item["mode"] not in (0o400, 0o500):
        raise SystemExit("invalid NanoGPT parallel asset record")
    relative = pathlib.PurePosixPath(item["path"])
    if relative.is_absolute() or len(relative.parts) != 1 or relative.name in ("", ".", ".."):
        raise SystemExit("invalid NanoGPT parallel asset path")
    decoded[relative.name] = base64.b64decode(item["content"], validate=True)
stage = json.loads(decoded["stage-request.json"].decode("utf-8"))
child = json.loads(decoded["child-request.json"].decode("utf-8"))
if child.get("childRequestDigest") != child_digest or child.get("stageRequestDigest") != stage.get("requestDigest"):
    raise SystemExit("prepared parallel request digest mismatch")
if hashlib.sha256(decoded["candidate.patch"]).hexdigest() != child["candidatePatch"]["digest"] or len(decoded["candidate.patch"]) != child["candidatePatch"]["byteLength"]:
    raise SystemExit("prepared parallel candidate patch mismatch")
for asset, pin in (
    ("worker.py", "parallelWorkerSha256"),
    ("base-worker.py", "baseWorkerSha256"),
    ("nanogpt_contract.py", "staticEvaluatorSha256"),
    ("environment.json", "environmentSha256"),
    ("environment-seal.json", "environmentSealSha256"),
    ("dataset-manifest.json", "datasetManifestSha256"),
):
    if hashlib.sha256(decoded[asset]).hexdigest() != child["pins"][pin]:
        raise SystemExit("prepared parallel pinned asset mismatch: " + asset)
if hashlib.sha256(decoded["train_gpt_simple.py"]).hexdigest() != child["staticEvidence"]["baselineSha256"]:
    raise SystemExit("prepared parallel baseline mismatch")
for item in files:
    path = root / item["path"]
    content = decoded[item["path"]]
    if os.path.lexists(path):
        regular_exact(path, content, item["mode"])
        continue
    temporary = root / ("." + path.name + ".tmp." + str(os.getpid()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, item["mode"])
        try:
            os.link(temporary, path, follow_symlinks=False)
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
    regular_exact(path, content, item["mode"])
print(json.dumps({"prepared": str(root), "childRequestDigest": child_digest}, sort_keys=True))
`;

export const NANOGPT_SCORED_PARALLEL_POLL_REMOTE = `
import base64, datetime, hashlib, json, os, pathlib, re, stat, subprocess, sys, time, zoneinfo
root = pathlib.Path(sys.argv[1])
job_name = sys.argv[2]
grace_seconds = float(sys.argv[3])
terminal_states = {"BOOT_FAIL", "CANCELLED", "COMPLETED", "DEADLINE", "FAILED", "NODE_FAIL", "OUT_OF_MEMORY", "PREEMPTED", "REVOKED", "TIMEOUT"}
marker = root / "terminal-result-visibility-grace"
def regular(path, label):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_uid != root.stat().st_uid:
        raise SystemExit(label + " must be an owned regular non-symlink file")
def sha256_bytes(content):
    return hashlib.sha256(content).hexdigest()
def normalized_timestamp(value, label):
    try:
        parsed = datetime.datetime.fromisoformat(value)
    except ValueError as error:
        raise SystemExit(label + " is not an ISO timestamp: " + str(error))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=zoneinfo.ZoneInfo("America/Los_Angeles"))
    return parsed.astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
def memory_mib(value):
    match = re.fullmatch(r"([0-9]+(?:[.][0-9]+)?)([KMGTP]?)", value, re.IGNORECASE)
    if not match:
        raise SystemExit("unparseable TRES memory: " + value)
    number = float(match.group(1))
    unit = match.group(2).upper()
    multiplier = {"": 1 / (1024 * 1024), "K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024, "P": 1024 * 1024 * 1024}[unit]
    return int(number * multiplier)
def resources(source, label):
    values = {}
    gpu_count = 0
    for token in source.split(","):
        if "=" not in token:
            continue
        key, value = token.rsplit("=", 1)
        values[key] = value
        if key == "gres/gpu" or key.startswith("gres/gpu:"):
            gpu_count += int(value)
    if "cpu" not in values or "mem" not in values or gpu_count < 1:
        raise SystemExit(label + " lacks exact CPU, GPU, or memory TRES: " + source)
    return {"cpus": int(values["cpu"]), "gpus": gpu_count, "memoryMiB": memory_mib(values["mem"])}
id_path = root / "slurm-job-id"
if id_path.exists():
    regular(id_path, "SLURM identity")
job_id = id_path.read_text(encoding="utf-8").strip() if id_path.exists() else ""
if job_id and not re.fullmatch(r"[1-9][0-9]*", job_id):
    raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: SLURM identity must be numeric")
slurm_log_path = root / ("slurm-" + job_id + ".out") if job_id else None
if slurm_log_path and slurm_log_path.exists():
    regular(slurm_log_path, "SLURM log")
slurm_log = slurm_log_path.read_text(encoding="utf-8", errors="replace")[-262144:] if slurm_log_path and slurm_log_path.exists() else ""
result_path = root / "result.json"
def emit_result(scheduler):
    regular(result_path, "durable child result")
    content = result_path.read_bytes()
    if len(content) < 2 or len(content) > ${MAX_RESULT_BYTES}:
        raise SystemExit("durable child result byte length is outside its bound")
    result = json.loads(content.decode("utf-8"))
    trial_root = root / "trial-logs"
    if trial_root.is_symlink() or not trial_root.is_dir():
        raise SystemExit("parallel child trial log root is missing or a symlink")
    paths = sorted(trial_root.rglob("*.log"))
    if len(paths) != 1:
        raise SystemExit("parallel child must publish exactly one trial log")
    path = paths[0]
    regular(path, "parallel child trial log")
    raw = path.read_bytes()
    if len(raw) > ${MAX_LOG_BYTES}:
        raise SystemExit("parallel child trial log exceeds its byte bound")
    log = {"remoteName": str(path.relative_to(trial_root)), "byteLength": len(raw), "sha256": sha256_bytes(raw)}
    observed = result.get("observed")
    if not isinstance(observed, dict) or observed.get("log") != log:
        raise SystemExit("durable child result does not bind the exact published log")
    print(json.dumps({
        "kind": "result",
        "resultBase64": base64.b64encode(content).decode("ascii"),
        "resultByteLength": len(content),
        "resultSha256": sha256_bytes(content),
        "log": log,
        "scheduler": scheduler,
    }, sort_keys=True))
    raise SystemExit(0)
if result_path.exists() and not job_id:
    raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: durable child result exists without a SLURM identity")
if not job_id:
    print(json.dumps({"kind": "pending", "schedulerState": "DISPATCHING"}, sort_keys=True))
    raise SystemExit(0)
queued = subprocess.run(["squeue", "--noheader", "--jobs", job_id, "--format=%A|%j|%Z|%T"], capture_output=True, text=True, check=True)
queue_rows = [line.strip().split("|", 3) for line in queued.stdout.splitlines() if line.strip()]
if queue_rows:
    if len(queue_rows) != 1 or queue_rows[0][0] != job_id or queue_rows[0][1] != job_name or queue_rows[0][2] != str(root):
        raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: squeue row escaped the parallel child identity")
    try:
        marker.unlink()
    except FileNotFoundError:
        pass
    print(json.dumps({"kind": "pending", "schedulerState": queue_rows[0][3]}, sort_keys=True))
    raise SystemExit(0)
fields = "JobIDRaw,JobName,WorkDir,State,ExitCode,Submit,Start,End,ElapsedRaw,AllocTRES,ReqTRES"
accounted = subprocess.run(["sacct", "--noheader", "-X", "--jobs", job_id, "--format=" + fields, "--parsable2"], capture_output=True, text=True, check=True)
rows = [line.strip().rstrip("|").split("|", 10) for line in accounted.stdout.splitlines() if line.strip()]
if not rows:
    print(json.dumps({"kind": "pending", "schedulerState": "ACCOUNTING_LAG"}, sort_keys=True))
    raise SystemExit(0)
if len(rows) != 1 or rows[0][0] != job_id or rows[0][1] != job_name or rows[0][2] != str(root):
    raise SystemExit("NANOGPT_SCHEDULER_IDENTITY: root sacct row escaped the parallel child identity")
state = rows[0][3].split("+", 1)[0].split(" ", 1)[0].strip().upper()
exit_code = rows[0][4].strip()
accounting = "|".join(rows[0])
if state not in terminal_states:
    print(json.dumps({"kind": "pending", "schedulerState": "ACCOUNTING_NONTERMINAL_OR_UNKNOWN:" + accounting}, sort_keys=True))
    raise SystemExit(0)
if state != "COMPLETED" or exit_code != "0:0":
    print(json.dumps({"kind": "failed", "reason": "SLURM child did not complete successfully; refusing any result: " + accounting, "log": slurm_log}, sort_keys=True))
    raise SystemExit(0)
elapsed_seconds = int(rows[0][8])
submit_at = normalized_timestamp(rows[0][5], "Submit")
start_at = normalized_timestamp(rows[0][6], "Start")
end_at = normalized_timestamp(rows[0][7], "End")
queue_wait_ms = int((datetime.datetime.fromisoformat(start_at.replace("Z", "+00:00")) - datetime.datetime.fromisoformat(submit_at.replace("Z", "+00:00"))).total_seconds() * 1000)
raw = {
    "jobIdRaw": rows[0][0], "jobName": rows[0][1], "workDir": rows[0][2], "state": "COMPLETED", "exitCode": "0:0",
    "submit": rows[0][5], "start": rows[0][6], "end": rows[0][7], "elapsedRaw": rows[0][8], "allocTres": rows[0][9], "reqTres": rows[0][10],
}
scheduler = {
    "raw": raw,
    "normalized": {
        "state": "COMPLETED", "exitCode": "0:0", "submitAt": submit_at, "startAt": start_at, "endAt": end_at,
        "elapsedSeconds": elapsed_seconds, "queueWaitMs": queue_wait_ms, "runtimeMs": elapsed_seconds * 1000,
        "requested": resources(rows[0][10], "ReqTRES"), "allocated": resources(rows[0][9], "AllocTRES"),
    },
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
print(json.dumps({"kind": "failed", "reason": "SLURM child completed without a durable result after visibility grace: " + accounting, "log": slurm_log}, sort_keys=True))
`;

function parseIso(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!parsed.endsWith("Z") || !Number.isFinite(Date.parse(parsed)))
		throw new Error(`${path} must be a UTC timestamp`);
	return parsed;
}

function parseResources(
	value: unknown,
	path: string,
): { readonly cpus: number; readonly gpus: number; readonly memoryMiB: number } {
	const parsed = record(value, path);
	exactKeys(parsed, ["cpus", "gpus", "memoryMiB"], path);
	const cpus = integer(parsed.cpus, `${path}.cpus`);
	const gpus = integer(parsed.gpus, `${path}.gpus`);
	const memoryMiB = integer(parsed.memoryMiB, `${path}.memoryMiB`);
	if (cpus < 1 || gpus < 1 || memoryMiB < 1) throw new Error(`${path} must describe positive resources`);
	return { cpus, gpus, memoryMiB };
}

function parseScheduler(value: unknown, remoteJobDir: string, jobName: string): NanoGptScoredParallelSchedulerEvidence {
	const parsed = record(value, "poll.scheduler");
	exactKeys(parsed, ["raw", "normalized"], "poll.scheduler");
	const raw = record(parsed.raw, "poll.scheduler.raw");
	exactKeys(
		raw,
		[
			"jobIdRaw",
			"jobName",
			"workDir",
			"state",
			"exitCode",
			"submit",
			"start",
			"end",
			"elapsedRaw",
			"allocTres",
			"reqTres",
		],
		"poll.scheduler.raw",
	);
	const normalized = record(parsed.normalized, "poll.scheduler.normalized");
	exactKeys(
		normalized,
		[
			"state",
			"exitCode",
			"submitAt",
			"startAt",
			"endAt",
			"elapsedSeconds",
			"queueWaitMs",
			"runtimeMs",
			"requested",
			"allocated",
		],
		"poll.scheduler.normalized",
	);
	const jobIdRaw = string(raw.jobIdRaw, "poll.scheduler.raw.jobIdRaw");
	const submitAt = parseIso(normalized.submitAt, "poll.scheduler.normalized.submitAt");
	const startAt = parseIso(normalized.startAt, "poll.scheduler.normalized.startAt");
	const endAt = parseIso(normalized.endAt, "poll.scheduler.normalized.endAt");
	const elapsedSeconds = integer(normalized.elapsedSeconds, "poll.scheduler.normalized.elapsedSeconds");
	const queueWaitMs = integer(normalized.queueWaitMs, "poll.scheduler.normalized.queueWaitMs");
	const runtimeMs = integer(normalized.runtimeMs, "poll.scheduler.normalized.runtimeMs");
	const requested = parseResources(normalized.requested, "poll.scheduler.normalized.requested");
	const allocated = parseResources(normalized.allocated, "poll.scheduler.normalized.allocated");
	if (
		!SLURM_ID_PATTERN.test(jobIdRaw) ||
		raw.jobName !== jobName ||
		raw.workDir !== remoteJobDir ||
		raw.state !== "COMPLETED" ||
		raw.exitCode !== "0:0" ||
		normalized.state !== "COMPLETED" ||
		normalized.exitCode !== "0:0" ||
		string(raw.elapsedRaw, "poll.scheduler.raw.elapsedRaw") !== String(elapsedSeconds) ||
		elapsedSeconds < 0 ||
		queueWaitMs < 0 ||
		runtimeMs !== elapsedSeconds * 1_000 ||
		Date.parse(startAt) < Date.parse(submitAt) ||
		Date.parse(endAt) < Date.parse(startAt) ||
		requested.cpus !== 8 ||
		requested.gpus !== 1 ||
		requested.memoryMiB !== 32_768 ||
		allocated.gpus !== 1
	) {
		throw new Error("NanoGPT parallel scheduler evidence changed or escaped its exact child allocation");
	}
	if (Math.abs(Date.parse(startAt) - Date.parse(submitAt) - queueWaitMs) > 1_000) {
		throw new Error("NanoGPT parallel scheduler queue accounting disagrees with its timestamps");
	}
	return {
		raw: {
			jobIdRaw,
			jobName,
			workDir: remoteJobDir,
			state: "COMPLETED",
			exitCode: "0:0",
			submit: string(raw.submit, "poll.scheduler.raw.submit"),
			start: string(raw.start, "poll.scheduler.raw.start"),
			end: string(raw.end, "poll.scheduler.raw.end"),
			elapsedRaw: String(elapsedSeconds),
			allocTres: string(raw.allocTres, "poll.scheduler.raw.allocTres"),
			reqTres: string(raw.reqTres, "poll.scheduler.raw.reqTres"),
		},
		normalized: {
			state: "COMPLETED",
			exitCode: "0:0",
			submitAt,
			startAt,
			endAt,
			elapsedSeconds,
			queueWaitMs,
			runtimeMs,
			requested,
			allocated,
		},
	};
}

function parseRemotePoll(rawSource: string, remoteJobDir: string, jobName: string): RemotePoll {
	const parsed = parseSingleJson(rawSource, "NanoGPT parallel poll");
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
	if (kind !== "result") throw new Error(`Unknown NanoGPT parallel poll kind: ${kind}`);
	exactKeys(parsed, ["kind", "resultBase64", "resultByteLength", "resultSha256", "log", "scheduler"], "poll");
	const log = record(parsed.log, "poll.log");
	exactKeys(log, ["remoteName", "byteLength", "sha256"], "poll.log");
	const remoteName = string(log.remoteName, "poll.log.remoteName");
	if (
		!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remoteName) ||
		remoteName.split("/").some((part) => ["", ".", ".."].includes(part))
	) {
		throw new Error("NanoGPT parallel remote log name is unsafe");
	}
	const byteLength = integer(log.byteLength, "poll.log.byteLength");
	if (byteLength < 0 || byteLength > MAX_LOG_BYTES) throw new Error("NanoGPT parallel remote log length is invalid");
	return {
		kind,
		resultBase64: string(parsed.resultBase64, "poll.resultBase64"),
		resultByteLength: integer(parsed.resultByteLength, "poll.resultByteLength"),
		resultSha256: sha256(parsed.resultSha256, "poll.resultSha256"),
		log: { remoteName, byteLength, sha256: sha256(log.sha256, "poll.log.sha256") },
		scheduler: parseScheduler(parsed.scheduler, remoteJobDir, jobName),
	};
}

function decodeResult(poll: Extract<RemotePoll, { readonly kind: "result" }>): Uint8Array {
	if (
		poll.resultByteLength < 2 ||
		poll.resultByteLength > MAX_RESULT_BYTES ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(poll.resultBase64)
	) {
		throw new Error("NanoGPT parallel child result byte envelope is invalid");
	}
	const bytes = Buffer.from(poll.resultBase64, "base64");
	if (
		bytes.byteLength !== poll.resultByteLength ||
		bytes.toString("base64") !== poll.resultBase64 ||
		sha256Bytes(bytes) !== poll.resultSha256
	) {
		throw new Error("NanoGPT parallel child result bytes failed SHA-256 or length verification");
	}
	return bytes;
}

function utf8(bytes: Uint8Array, path: string): string {
	const source = Buffer.from(bytes).toString("utf8");
	if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error(`${path} is not valid UTF-8`);
	return source;
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function pathChain(path: string): readonly string[] {
	if (resolve(path) !== path) throw new Error(`NanoGPT parallel local evidence path is not normalized: ${path}`);
	const paths: string[] = [];
	let current = path;
	for (;;) {
		paths.unshift(current);
		const parent = dirname(current);
		if (parent === current) return paths;
		current = parent;
	}
}

async function ensureSafeDirectory(path: string): Promise<void> {
	for (const directory of pathChain(path)) {
		let metadata: Awaited<ReturnType<typeof lstat>>;
		try {
			metadata = await lstat(directory);
		} catch (error) {
			if (!isMissing(error)) throw error;
			try {
				await mkdir(directory, { mode: 0o700 });
			} catch (mkdirError) {
				if (!isAlreadyExists(mkdirError)) throw mkdirError;
			}
			metadata = await lstat(directory);
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error(`NanoGPT parallel evidence ancestor is unsafe: ${directory}`);
		}
	}
}

async function verifyArchived(path: string, digest: string, byteLength: number): Promise<void> {
	await ensureSafeDirectory(dirname(path));
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`NanoGPT parallel archive is unsafe: ${path}`);
	const bytes = await readFile(path);
	if (bytes.byteLength !== byteLength || sha256Bytes(bytes) !== digest) {
		throw new Error(`NanoGPT parallel archived evidence changed: ${path}`);
	}
}

async function archiveBytes(path: string, bytes: Uint8Array, digest: string): Promise<void> {
	if (sha256Bytes(bytes) !== digest)
		throw new Error("Refusing to archive NanoGPT parallel bytes under a foreign digest");
	await ensureSafeDirectory(dirname(path));
	const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
	let created = false;
	try {
		const handle = await open(temporary, "wx", 0o600);
		created = true;
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
		if (created) await unlink(temporary).catch(() => undefined);
	}
	await verifyArchived(path, digest, bytes.byteLength);
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

function archiveRoot(config: NanoGptScoredParallelTransportConfig, stageDigest: string, childDigest: string): string {
	sha256(stageDigest, "stageDigest");
	sha256(childDigest, "childDigest");
	return join(config.localEvidenceDir, stageDigest.slice(0, 2), stageDigest, "children", childDigest);
}

function archiveManifestSource(
	childDigest: string,
	log: { readonly remoteName: string; readonly byteLength: number; readonly sha256: string },
): string {
	return `${canonicalJson(
		toJsonValue({
			schemaVersion: 1,
			childRequestDigest: childDigest,
			logs: [{ ...log, relativePath: `logs/${log.sha256}.log` }],
		}),
	)}\n`;
}

async function archiveChildLog(
	config: NanoGptScoredParallelTransportConfig,
	stageDigest: string,
	childDigest: string,
	log: RemoteLogEvidence,
	bytes: Uint8Array,
): Promise<NanoGptScoredParallelArchiveEvidence> {
	const root = archiveRoot(config, stageDigest, childDigest);
	const relativePath = `logs/${log.sha256}.log`;
	await archiveBytes(join(root, relativePath), bytes, log.sha256);
	const canonicalManifest = archiveManifestSource(childDigest, log);
	const manifestBytes = Buffer.from(canonicalManifest, "utf8");
	const manifestSha256 = sha256Bytes(manifestBytes);
	await archiveBytes(join(root, "manifest.json"), manifestBytes, manifestSha256);
	return {
		canonicalManifest,
		manifestByteLength: manifestBytes.byteLength,
		manifestSha256,
		log: { ...log, relativePath },
	};
}

async function readLocalAssets(
	request: NanoGptScoredParallelStageRequest,
	config: NanoGptScoredParallelTransportConfig,
): Promise<LocalAssets> {
	const [parallelWorker, baseWorker, parallelTransport, hostAggregation, staticEvaluator, baseline, datasetManifest] =
		await Promise.all([
			readFile(config.localParallelWorkerPath, "utf8"),
			readFile(config.localBaseWorkerPath, "utf8"),
			readFile(config.localParallelTransportPath, "utf8"),
			readFile(config.localHostAggregationPath, "utf8"),
			readFile(config.localStaticEvaluatorPath, "utf8"),
			readFile(config.localBaselinePath, "utf8"),
			readFile(config.localDatasetManifestPath, "utf8"),
		]);
	const observed: NanoGptScoredParallelPins = {
		staticEvaluatorSha256: sha256Text(staticEvaluator),
		environmentSha256: NANOGPT_SCORED_ENVIRONMENT_SHA256,
		environmentSealSha256: NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
		datasetManifestSha256: sha256Text(datasetManifest),
		parallelWorkerSha256: sha256Text(parallelWorker),
		baseWorkerSha256: sha256Text(baseWorker),
		parallelTransportSha256: sha256Text(parallelTransport),
		hostAggregationSha256: sha256Text(hostAggregation),
	};
	if (
		sha256Json(observed) !== sha256Json(request.pins) ||
		observed.staticEvaluatorSha256 !== NANOGPT_SCORED_STATIC_EVALUATOR_SHA256 ||
		observed.datasetManifestSha256 !== NANOGPT_SCORED_DATA_MANIFEST_SHA256 ||
		sha256Text(baseline) !== NANOGPT_BASELINE_SHA256
	) {
		throw new Error("Local NanoGPT parallel verifier assets differ from the exact request pins");
	}
	return {
		parallelWorker,
		baseWorker,
		parallelTransport,
		hostAggregation,
		staticEvaluator,
		baseline,
		datasetManifest,
	};
}

export async function loadNanoGptScoredParallelPins(
	config: NanoGptScoredParallelTransportConfig = DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
): Promise<NanoGptScoredParallelPins> {
	validateConfig(config);
	const [parallelWorker, baseWorker, parallelTransport, hostAggregation, staticEvaluator, datasetManifest] =
		await Promise.all([
			readFile(config.localParallelWorkerPath, "utf8"),
			readFile(config.localBaseWorkerPath, "utf8"),
			readFile(config.localParallelTransportPath, "utf8"),
			readFile(config.localHostAggregationPath, "utf8"),
			readFile(config.localStaticEvaluatorPath, "utf8"),
			readFile(config.localDatasetManifestPath, "utf8"),
		]);
	if (sha256Text(staticEvaluator) !== NANOGPT_SCORED_STATIC_EVALUATOR_SHA256) {
		throw new Error("Local NanoGPT parallel static evaluator pin changed");
	}
	if (sha256Text(datasetManifest) !== NANOGPT_SCORED_DATA_MANIFEST_SHA256) {
		throw new Error("Local NanoGPT parallel dataset pin changed");
	}
	return {
		staticEvaluatorSha256: NANOGPT_SCORED_STATIC_EVALUATOR_SHA256,
		environmentSha256: NANOGPT_SCORED_ENVIRONMENT_SHA256,
		environmentSealSha256: NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
		datasetManifestSha256: NANOGPT_SCORED_DATA_MANIFEST_SHA256,
		parallelWorkerSha256: sha256Text(parallelWorker),
		baseWorkerSha256: sha256Text(baseWorker),
		parallelTransportSha256: sha256Text(parallelTransport),
		hostAggregationSha256: sha256Text(hostAggregation),
	};
}

function verifyReadinessEnvironmentManifest(source: string): void {
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
		throw new Error("NanoGPT parallel readiness environment manifest changed");
	}
}

function parseReadiness(
	source: string,
	request: NanoGptScoredParallelStageRequest,
	local: LocalAssets,
	config: NanoGptScoredParallelTransportConfig,
): ReadinessAssets {
	const parsed = record(JSON.parse(source), "NanoGPT parallel readiness");
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
		"NanoGPT parallel readiness",
	);
	const environmentManifest = string(parsed.environmentManifest, "readiness.environmentManifest");
	const environmentSeal = string(parsed.environmentSeal, "readiness.environmentSeal");
	const datasetManifest = string(parsed.datasetManifest, "readiness.datasetManifest");
	verifyReadinessEnvironmentManifest(environmentManifest);
	const pinnedDataset = record(JSON.parse(local.datasetManifest), "local.datasetManifest");
	if (!Array.isArray(pinnedDataset.files)) throw new Error("Pinned NanoGPT dataset manifest lacks its exact file set");
	if (
		parsed.schemaVersion !== 1 ||
		parsed.environmentDirectory !== config.environmentDir ||
		parsed.environmentManifestSha256 !== request.pins.environmentSha256 ||
		sha256Text(environmentManifest) !== request.pins.environmentSha256 ||
		parsed.environmentSealSha256 !== request.pins.environmentSealSha256 ||
		sha256Text(environmentSeal) !== request.pins.environmentSealSha256 ||
		parsed.datasetDirectory !== config.datasetRoot ||
		parsed.datasetManifestSha256 !== request.pins.datasetManifestSha256 ||
		sha256Text(datasetManifest) !== request.pins.datasetManifestSha256 ||
		datasetManifest !== local.datasetManifest ||
		!Array.isArray(parsed.dataFiles) ||
		sha256Json(parsed.dataFiles) !== sha256Json(pinnedDataset.files) ||
		sha256Json(parsed.runtime) !== sha256Json(EXPECTED_ENVIRONMENT_RUNTIME) ||
		sha256Json(parsed.executables) !== sha256Json(EXPECTED_ENVIRONMENT_EXECUTABLES)
	) {
		throw new Error("NanoGPT parallel live readiness differs from its sealed environment or dataset");
	}
	return { environmentManifest, environmentSeal };
}

function buildPreparedChild(
	stage: NanoGptScoredParallelStageRequest,
	child: NanoGptScoredParallelChildRequest,
	candidatePatch: string,
	local: LocalAssets,
	readiness: ReadinessAssets,
	config: NanoGptScoredParallelTransportConfig,
): PreparedChild {
	const jobScript = buildNanoGptScoredParallelChildJobScript(stage, child, config);
	const assets: PreparedChild["assets"] = [
		{ path: "base-worker.py", mode: 0o400, content: local.baseWorker },
		{ path: "candidate.patch", mode: 0o400, content: candidatePatch },
		{ path: "child-request.json", mode: 0o400, content: `${canonicalJson(toJsonValue(child))}\n` },
		{ path: "dataset-manifest.json", mode: 0o400, content: local.datasetManifest },
		{ path: "environment-seal.json", mode: 0o400, content: readiness.environmentSeal },
		{ path: "environment.json", mode: 0o400, content: readiness.environmentManifest },
		{ path: "job.sh", mode: 0o500, content: jobScript },
		{ path: "nanogpt_contract.py", mode: 0o400, content: local.staticEvaluator },
		{ path: "stage-request.json", mode: 0o400, content: `${canonicalJson(toJsonValue(stage))}\n` },
		{ path: "train_gpt_simple.py", mode: 0o400, content: local.baseline },
		{ path: "worker.py", mode: 0o500, content: local.parallelWorker },
	];
	if (sha256Json(assets.map((asset) => asset.path).sort()) !== sha256Json([...PREPARED_PATHS].sort())) {
		throw new Error("NanoGPT parallel prepared asset set changed");
	}
	return {
		request: child,
		remoteJobDir: nanoGptScoredParallelChildRemoteDir(child.childRequestDigest, config),
		jobName: nanoGptScoredParallelChildJobName(child.childRequestDigest),
		jobScript,
		jobScriptSha256: sha256Text(jobScript),
		assets,
	};
}

async function mapBounded<T, R>(
	values: readonly T[],
	limit: number,
	operation: (value: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4)
		throw new Error("NanoGPT parallel child concurrency must be 1..4");
	const results: Array<R | undefined> = new Array(values.length);
	const failures: unknown[] = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
		for (;;) {
			const index = cursor++;
			if (index >= values.length) return;
			try {
				results[index] = await operation(values[index], index);
			} catch (error) {
				failures.push(error);
			}
		}
	});
	await Promise.all(workers);
	if (failures.length > 0) {
		throw new AggregateError(
			failures,
			"NanoGPT parallel stage failed after every deterministic child operation drained",
		);
	}
	if (results.some((result) => result === undefined))
		throw new Error("NanoGPT parallel bounded mapper lost a child result");
	return results as readonly R[];
}

export class SshNanoGptScoredParallelTransport implements NanoGptScoredParallelTransport {
	private readonly config: NanoGptScoredParallelTransportConfig;
	private readonly runner: CompilerGymWarmCommandRunner;

	constructor(
		config: NanoGptScoredParallelTransportConfig = DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
		dependencies: NanoGptScoredParallelTransportDependencies = {},
	) {
		this.config = { ...config };
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
			throw new Error(`NanoGPT parallel remote input exceeds ${MAX_PREPARE_INPUT_BYTES} bytes`);
		}
		const encodedSource = Buffer.from(source, "utf8").toString("base64");
		const bootstrap =
			"import base64,sys;source=base64.b64decode(sys.argv[1],validate=True);" +
			"sys.argv=[sys.argv[0],*sys.argv[2:]];exec(compile(source,'<nanogpt-parallel-remote>','exec'))";
		const command: CompilerGymWarmCommandRequest = {
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
		const result = await this.runner.run(command);
		if (result.exitCode !== 0) {
			const message = commandFailure(result);
			if (isTransient(result)) throw new KernelBenchTransientTransportError(message);
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
					attempt >= MAX_TRANSIENT_RETRIES ||
					(deadline !== null && Date.now() >= deadline)
				) {
					throw error;
				}
				const backoff = Math.min(100 * 2 ** Math.min(attempt++, 6), this.config.pollIntervalMs);
				await delay(Math.max(1, deadline === null ? backoff : Math.min(backoff, deadline - Date.now())), signal);
			}
		}
	}

	private async remoteReadiness(
		request: NanoGptScoredParallelStageRequest,
		local: LocalAssets,
		signal: AbortSignal,
	): Promise<ReadinessAssets> {
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
		return parseReadiness(result.stdout, request, local, this.config);
	}

	async readiness(
		request: NanoGptScoredParallelStageRequest,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelReadiness> {
		verifyNanoGptScoredParallelStageRequest(request);
		const local = await readLocalAssets(request, this.config);
		await this.remoteReadiness(request, local, signal);
		return {
			pins: request.pins,
			environmentDirectory: this.config.environmentDir,
			datasetDirectory: this.config.datasetRoot,
		};
	}

	private async prepare(prepared: PreparedChild, signal: AbortSignal): Promise<void> {
		const payload = JSON.stringify({
			files: prepared.assets.map((asset) => ({
				path: asset.path,
				mode: asset.mode,
				content: Buffer.from(asset.content, "utf8").toString("base64"),
			})),
		});
		const result = await this.remotePython(
			NANOGPT_SCORED_PARALLEL_PREPARE_REMOTE,
			[prepared.remoteJobDir, this.config.remoteRoot, prepared.request.childRequestDigest],
			payload,
			signal,
		);
		const parsed = parseSingleJson(result.stdout, "NanoGPT parallel prepare");
		exactKeys(parsed, ["prepared", "childRequestDigest"], "NanoGPT parallel prepare");
		if (
			parsed.prepared !== prepared.remoteJobDir ||
			parsed.childRequestDigest !== prepared.request.childRequestDigest
		) {
			throw new Error("NanoGPT parallel prepare acknowledgement escaped its exact child");
		}
	}

	private async ensureSubmitted(prepared: PreparedChild, signal: AbortSignal): Promise<string> {
		for (;;) {
			const result = await this.remotePython(
				NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE,
				[
					prepared.remoteJobDir,
					this.config.remoteRoot,
					prepared.request.childRequestDigest,
					prepared.jobName,
					String(this.config.dispatchVisibilityGraceMs / 1_000),
				],
				undefined,
				signal,
			);
			const parsed = parseSingleJson(result.stdout, "NanoGPT parallel dispatch");
			const kind = string(parsed.kind, "dispatch.kind");
			if (kind === "submitted") {
				const slurmJobId = string(parsed.slurmJobId, "dispatch.slurmJobId");
				if (!SLURM_ID_PATTERN.test(slurmJobId)) throw new Error("NanoGPT parallel SLURM identity is invalid");
				return slurmJobId;
			}
			if (kind === "ambiguous") {
				throw new NanoGptScoredParallelAmbiguousDispatchError(string(parsed.reason, "dispatch.reason"));
			}
			if (kind !== "reconciling") throw new Error(`Unknown NanoGPT parallel dispatch state: ${kind}`);
			const retryAfterMs = integer(parsed.retryAfterMs, "dispatch.retryAfterMs");
			await delay(Math.max(1, Math.min(retryAfterMs, this.config.pollIntervalMs)), signal);
		}
	}

	private async poll(prepared: PreparedChild, signal: AbortSignal): Promise<RemotePoll> {
		const result = await this.remotePython(
			NANOGPT_SCORED_PARALLEL_POLL_REMOTE,
			[prepared.remoteJobDir, prepared.jobName, String(this.config.resultVisibilityGraceMs / 1_000)],
			undefined,
			signal,
		);
		return parseRemotePoll(result.stdout, prepared.remoteJobDir, prepared.jobName);
	}

	private async fetchLog(prepared: PreparedChild, log: RemoteLogEvidence, signal: AbortSignal): Promise<Uint8Array> {
		const result = await this.remotePython(
			NANOGPT_SCORED_FETCH_TRIAL_LOG_REMOTE,
			[prepared.remoteJobDir, log.remoteName, log.sha256, String(log.byteLength)],
			undefined,
			signal,
			this.config.commandTimeoutMs,
			MAX_LOG_OUTPUT_BYTES,
		);
		const parsed = parseSingleJson(result.stdout, "NanoGPT parallel log fetch");
		exactKeys(parsed, ["name", "byteLength", "sha256", "contentBase64"], "NanoGPT parallel log fetch");
		if (
			parsed.name !== log.remoteName ||
			parsed.byteLength !== log.byteLength ||
			parsed.sha256 !== log.sha256 ||
			typeof parsed.contentBase64 !== "string"
		) {
			throw new Error("Fetched NanoGPT parallel log envelope changed");
		}
		const bytes = Buffer.from(parsed.contentBase64, "base64");
		if (
			bytes.toString("base64") !== parsed.contentBase64 ||
			bytes.byteLength !== log.byteLength ||
			sha256Bytes(bytes) !== log.sha256
		) {
			throw new Error("Fetched NanoGPT parallel log bytes failed SHA-256 or length verification");
		}
		return bytes;
	}

	private async reconcileChild(
		stage: NanoGptScoredParallelStageRequest,
		prepared: PreparedChild,
		signal: AbortSignal,
		deadline: number | null,
	): Promise<NanoGptScoredParallelChildCompletion> {
		await this.retryTransient(() => this.prepare(prepared, signal), signal, deadline);
		const slurmJobId = await this.retryTransient(() => this.ensureSubmitted(prepared, signal), signal, deadline);
		for (;;) {
			const poll = await this.retryTransient(() => this.poll(prepared, signal), signal, deadline);
			if (poll.kind === "failed") throw new Error(poll.log ? `${poll.reason}\n${poll.log}` : poll.reason);
			if (poll.kind === "result") {
				const value: unknown = JSON.parse(utf8(decodeResult(poll), "NanoGPT parallel child result"));
				const workerResult = parseNanoGptScoredParallelChildWorkerResult(value, prepared.request, stage);
				if (
					!workerResult.ok ||
					workerResult.observed.slurmJobId !== slurmJobId ||
					poll.scheduler.raw.jobIdRaw !== slurmJobId ||
					workerResult.observed.log.remoteName !== poll.log.remoteName ||
					workerResult.observed.log.byteLength !== poll.log.byteLength ||
					workerResult.observed.log.sha256 !== poll.log.sha256
				) {
					throw new Error("NanoGPT parallel child result disagrees with its scheduler, log, or success gate");
				}
				const logBytes = await this.fetchLog(prepared, poll.log, signal);
				const archive = await archiveChildLog(
					this.config,
					stage.requestDigest,
					prepared.request.childRequestDigest,
					poll.log,
					logBytes,
				);
				return buildNanoGptScoredParallelChildCompletion(
					{ workerResult, jobScriptSha256: prepared.jobScriptSha256, scheduler: poll.scheduler, archive },
					prepared.request,
					stage,
				);
			}
			if (deadline !== null && Date.now() >= deadline) {
				throw new NanoGptScoredParallelReconcileTimeoutError(
					prepared.request.childSpec.index,
					this.config.reconcileTimeoutMs as number,
				);
			}
			const waitMs =
				deadline === null
					? this.config.pollIntervalMs
					: Math.min(this.config.pollIntervalMs, deadline - Date.now());
			await delay(Math.max(1, waitMs), signal);
		}
	}

	private async reconcile(
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelTransportCompletion> {
		verifyNanoGptScoredParallelStageRequest(request);
		if (
			sha256Text(candidatePatch) !== request.candidatePatch.digest ||
			Buffer.byteLength(candidatePatch) !== request.candidatePatch.byteLength
		) {
			throw new Error("NanoGPT parallel candidate patch bytes differ from the exact stage request");
		}
		if (signal.aborted) throw abortReason(signal);
		const deadline = this.config.reconcileTimeoutMs === null ? null : Date.now() + this.config.reconcileTimeoutMs;
		const local = await readLocalAssets(request, this.config);
		const readiness = await this.retryTransient(() => this.remoteReadiness(request, local, signal), signal, deadline);
		const prepared = request.children.map((_, index) =>
			buildPreparedChild(
				request,
				buildNanoGptScoredParallelChildRequest(request, index),
				candidatePatch,
				local,
				readiness,
				this.config,
			),
		);
		const children = await mapBounded(prepared, request.launch.maxConcurrentChildren, (child) =>
			this.reconcileChild(request, child, signal, deadline),
		);
		return {
			schemaVersion: 1,
			stageRequestDigest: request.requestDigest,
			externalHandle: nanoGptScoredParallelExternalHandle(request.requestDigest),
			children,
		};
	}

	async verifyArchiveEvidence(
		request: NanoGptScoredParallelStageRequest,
		completion: NanoGptScoredParallelTransportCompletion,
		signal: AbortSignal,
	): Promise<void> {
		verifyNanoGptScoredParallelStageRequest(request);
		if (
			completion.schemaVersion !== 1 ||
			completion.stageRequestDigest !== request.requestDigest ||
			completion.externalHandle !== nanoGptScoredParallelExternalHandle(request.requestDigest) ||
			completion.children.length !== request.trials
		) {
			throw new Error("NanoGPT parallel archive recovery does not belong to the exact stage request");
		}
		await mapBounded(completion.children, request.launch.maxConcurrentChildren, async (value, index) => {
			if (signal.aborted) throw abortReason(signal);
			const childRequest = buildNanoGptScoredParallelChildRequest(request, index);
			const child = parseNanoGptScoredParallelChildCompletion(value, childRequest, request);
			const root = archiveRoot(this.config, request.requestDigest, child.childRequestDigest);
			const manifestPath = join(root, "manifest.json");
			await verifyArchived(manifestPath, child.archive.manifestSha256, child.archive.manifestByteLength);
			const manifestSource = await readFile(manifestPath, "utf8");
			if (manifestSource !== child.archive.canonicalManifest) {
				throw new Error(`NanoGPT parallel child ${index} archive manifest bytes changed`);
			}
			await verifyArchived(
				join(root, child.archive.log.relativePath),
				child.archive.log.sha256,
				child.archive.log.byteLength,
			);
		});
	}

	execute(
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelTransportCompletion> {
		return this.reconcile(request, candidatePatch, signal);
	}

	resume(
		request: NanoGptScoredParallelStageRequest,
		candidatePatch: string,
		externalHandle: string,
		signal: AbortSignal,
	): Promise<NanoGptScoredParallelTransportCompletion> {
		if (
			parseNanoGptScoredParallelExternalHandle(externalHandle) !== request.requestDigest ||
			externalHandle !== nanoGptScoredParallelExternalHandle(request.requestDigest)
		) {
			throw new Error("NanoGPT parallel external handle does not belong to the exact stage request");
		}
		return this.reconcile(request, candidatePatch, signal);
	}
}

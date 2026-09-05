import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Text, toJsonValue } from "./canonical-json.js";
import type {
	CompilerGymWarmBackend,
	CompilerGymWarmCloseVerification,
	CompilerGymWarmPoolExpectation,
	CompilerGymWarmPoolRecord,
	CompilerGymWarmRecovery,
	CompilerGymWarmRequestRecord,
} from "./compiler-gym-warm-transport.js";
import {
	COMPILER_GYM_WARM_CHILD_TERMINATION_GRACE_SECONDS,
	COMPILER_GYM_WARM_CHILD_TIMEOUT_SECONDS,
	COMPILER_GYM_WARM_CPUS_PER_TASK,
	COMPILER_GYM_WARM_IDLE_TIMEOUT_SECONDS,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
	COMPILER_GYM_WARM_LEASE_TIMEOUT_SECONDS,
	COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES,
	COMPILER_GYM_WARM_POLL_SECONDS,
	COMPILER_GYM_WARM_PROTOCOL,
	COMPILER_GYM_WARM_SLOT_COUNT,
	compilerGymWarmJobName,
	compilerGymWarmPoolDigest,
	parseCompilerGymWarmPoolRecord,
	parseCompilerGymWarmReadyRecords,
	parseCompilerGymWarmRequestRecord,
	parseCompilerGymWarmResultRecords,
} from "./compiler-gym-warm-transport.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;
const SAFE_REMOTE_TOKEN_PATTERN = /^[A-Za-z0-9._:/=-]+$/;
const SAFE_REMOTE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]+$/;
const SAFE_USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const TERMINAL_STATES = new Set([
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
]);
const ACTIVE_STATES = new Set(["CONFIGURING", "COMPLETING", "PENDING", "REQUEUED", "RESIZING", "RUNNING", "SUSPENDED"]);
const RECORD_MODE = 0o600;
const EXECUTABLE_MODE = 0o700;
const MAX_RECORD_BYTES = COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES + 512 * 1024;
const MAX_CONTROL_OUTPUT_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const ACQUISITION_CLEANUP_PROTOCOL = "compiler-gym-warm-acquisition-cleanup-v1" as const;
const SBATCH_PATH = "/usr/bin/sbatch";
const SACCT_PATH = "/usr/bin/sacct";
const SCANCEL_PATH = "/usr/bin/scancel";
const SCONTROL_PATH = "/usr/bin/scontrol";
const SQUEUE_PATH = "/usr/bin/squeue";
const SRUN_PATH = "/usr/bin/srun";
const SLEEP_PATH = "/usr/bin/sleep";

export interface CompilerGymWarmCommandRequest {
	argv: readonly [string, ...string[]];
	input?: string;
	signal?: AbortSignal;
	timeoutMs: number;
	maxOutputBytes: number;
}

export interface CompilerGymWarmCommandResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	wallMs: number;
}

export interface CompilerGymWarmCommandRunner {
	run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult>;
}

export interface CompilerGymWarmRemoteFileSystem {
	ensurePrivateDirectory(path: string, signal: AbortSignal): Promise<void>;
	createPrivateDirectory(path: string, signal: AbortSignal): Promise<void>;
	installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
		signal: AbortSignal,
	): Promise<void>;
	linkImmutableFile(source: string, target: string, expectedSha256: string, signal: AbortSignal): Promise<void>;
	readTrustedFile(
		path: string,
		options: { maxBytes: number; mode: number; expectedSha256?: string },
		signal: AbortSignal,
	): Promise<string>;
	exists(path: string, signal: AbortSignal): Promise<boolean>;
}

export interface CompilerGymWarmLocalFileSystem {
	readUtf8(path: string): Promise<string>;
}

export interface CompilerGymWarmBackendClock {
	now(): Date;
	monotonicMs(): number;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface FarmShareCompilerGymWarmBackendConfig {
	host: string;
	user: string;
	spoolRoot: string;
	remoteControlPython: string;
	localWorkerPath: string;
	localEvaluatorPath: string;
	commandTimeoutMs: number;
	readyTimeoutMs: number;
	resultTimeoutMs: number;
	shutdownTimeoutMs: number;
	cleanupTimeoutMs: number;
	dispatchVisibilityGraceMs: number;
	pollIntervalMs: number;
}

export interface FarmShareCompilerGymWarmBackendDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	localFileSystem?: CompilerGymWarmLocalFileSystem;
	clock?: CompilerGymWarmBackendClock;
}

export interface CompilerGymWarmAcquisitionAccountingProof {
	slurmId: string;
	state: string;
	exitCode: string;
	allocCpus: number;
	elapsedRaw: number;
	cpuTimeRaw: number;
	startAt: string;
	endAt: string;
}

export interface CompilerGymWarmSchedulerEvidence {
	sequence: number;
	command: "sacct" | "squeue";
	slurmId?: string;
	argv: readonly string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	stdoutBytes: number;
	stderrBytes: number;
	stdoutSha256: string;
	stderrSha256: string;
	recordSha256: string;
	capturedAt: string;
}

export interface CompilerGymWarmAcquisitionTimingEvidence {
	poolDigest: string;
	startedAt: string;
	readyAt: string;
	startedMonotonicMs: number;
	readyMonotonicMs: number;
	elapsedMs: number;
	startedMonotonicNs: string;
	readyMonotonicNs: string;
	elapsedNs: string;
}

export interface CompilerGymWarmAcknowledgementEvidence {
	poolDigest: string;
	slurmId: string;
	rank: 0 | 1;
	path: string;
	raw: string;
	rawBytes: number;
	rawSha256: string;
	recordSha256: string;
	capturedAt: string;
}

export interface CompilerGymWarmRootAccountingEvidence {
	sequence: number;
	jobIdRaw: string;
	user: string;
	jobName: string;
	workDir: string;
	state: string;
	exitCode: string;
	allocCpus: number;
	elapsedRawSeconds: number;
	cpuTimeRawSeconds: number;
	startAt: string;
	endAt: string;
	capturedAt: string;
	recordSha256: string;
}

export interface CompilerGymWarmAcquisitionCleanupProof {
	protocol: typeof ACQUISITION_CLEANUP_PROTOCOL;
	poolDigest: string;
	action: "not-submitted" | "verified-absent" | "cancelled-and-verified" | "cleanup-unverified";
	submissionAttempted: boolean;
	discoveredSlurmIds: readonly string[];
	schedulerAbsent: boolean;
	accounting: readonly CompilerGymWarmAcquisitionAccountingProof[];
	detail: string;
}

export class CompilerGymWarmAcquisitionError extends Error {
	readonly cleanupProof: CompilerGymWarmAcquisitionCleanupProof;

	constructor(message: string, cleanupProof: CompilerGymWarmAcquisitionCleanupProof, cause: unknown) {
		super(message, { cause });
		this.name = "CompilerGymWarmAcquisitionError";
		this.cleanupProof = cleanupProof;
	}
}

export const DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG: FarmShareCompilerGymWarmBackendConfig = {
	host: COMPILER_GYM_WARM_LAUNCH_CONTRACT.clusterHost,
	user: "duynguy",
	spoolRoot: "/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-warm-v1",
	remoteControlPython: "/usr/bin/python3",
	localWorkerPath: fileURLToPath(new URL("../evaluators/compiler_gym_warm_worker.py", import.meta.url)),
	localEvaluatorPath: fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url)),
	commandTimeoutMs: 30_000,
	readyTimeoutMs: 10 * 60_000,
	resultTimeoutMs: (COMPILER_GYM_WARM_CHILD_TIMEOUT_SECONDS + 60) * 1000,
	shutdownTimeoutMs: 60_000,
	cleanupTimeoutMs: 180_000,
	dispatchVisibilityGraceMs: 120_000,
	pollIntervalMs: 1_000,
};

class NodeCompilerGymWarmLocalFileSystem implements CompilerGymWarmLocalFileSystem {
	async readUtf8(path: string): Promise<string> {
		return readFile(path, "utf8");
	}
}

class SystemCompilerGymWarmBackendClock implements CompilerGymWarmBackendClock {
	now(): Date {
		return new Date();
	}

	monotonicMs(): number {
		return performance.now();
	}

	sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			const finish = (): void => {
				signal.removeEventListener("abort", abort);
				resolve();
			};
			const timeout = setTimeout(finish, ms);
			const abort = (): void => {
				clearTimeout(timeout);
				signal.removeEventListener("abort", abort);
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}

export class SpawnCompilerGymWarmCommandRunner implements CompilerGymWarmCommandRunner {
	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) throw new Error("timeoutMs must be positive");
		if (!Number.isInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) {
			throw new Error("maxOutputBytes must be positive");
		}
		if (request.input !== undefined && Buffer.byteLength(request.input) > MAX_ASSET_BYTES) {
			throw new Error(`Command input exceeds ${MAX_ASSET_BYTES} bytes`);
		}
		return new Promise((resolve, reject) => {
			const [command, ...args] = request.argv;
			const startedAt = performance.now();
			const child = spawn(command, args, { detached: true, stdio: ["pipe", "pipe", "pipe"] });
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let bytes = 0;
			let failure: Error | undefined;
			let settled = false;
			let killTimer: ReturnType<typeof setTimeout> | undefined;

			const signalGroup = (signalName: NodeJS.Signals): void => {
				try {
					process.kill(-child.pid!, signalName);
				} catch {
					child.kill(signalName);
				}
			};
			const terminate = (error: Error): void => {
				if (failure) return;
				failure = error;
				signalGroup("SIGTERM");
				killTimer = setTimeout(() => signalGroup("SIGKILL"), 1_000);
			};
			const append = (target: Buffer[], chunk: Buffer): void => {
				bytes += chunk.byteLength;
				if (bytes > request.maxOutputBytes) {
					terminate(new Error(`${command} exceeded the ${request.maxOutputBytes}-byte output limit`));
					return;
				}
				target.push(chunk);
			};
			const timeout = setTimeout(
				() => terminate(new Error(`${command} timed out after ${request.timeoutMs} ms`)),
				request.timeoutMs,
			);
			const abort = (): void =>
				terminate(new Error(`${command} aborted: ${String(request.signal?.reason ?? "aborted")}`));
			request.signal?.addEventListener("abort", abort, { once: true });
			if (request.signal?.aborted) abort();
			child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
			child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
			child.stdin.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code !== "EPIPE" && !failure) failure = error;
			});
			child.on("error", (error) => {
				failure = error;
			});
			child.on("close", (exitCode) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (killTimer) clearTimeout(killTimer);
				request.signal?.removeEventListener("abort", abort);
				if (failure) {
					reject(failure);
					return;
				}
				resolve({
					exitCode,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					wallMs: performance.now() - startedAt,
				});
			});
			child.stdin.end(request.input ?? "", "utf8");
		});
	}
}

function shellQuote(value: string): string {
	if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
		throw new Error("Remote argv contains a forbidden control character");
	}
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function compilerGymWarmSshArgv(
	host: string,
	remoteArgv: readonly [string, ...string[]],
): [string, ...string[]] {
	validateRemoteToken(host, "SSH host");
	const remoteCommand = remoteArgv.map(shellQuote).join(" ");
	return [
		"ssh",
		"-o",
		"BatchMode=yes",
		"-o",
		"ClearAllForwardings=yes",
		"-o",
		"ForwardAgent=no",
		"-o",
		"ForwardX11=no",
		"-o",
		"SendEnv=-*",
		"-o",
		"PermitLocalCommand=no",
		"-o",
		"RequestTTY=no",
		"--",
		host,
		remoteCommand,
	];
}

const REMOTE_FILESYSTEM_HELPER = `
import hashlib, os, pathlib, stat, sys, tempfile

MAX_INPUT_BYTES = ${MAX_ASSET_BYTES}
O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)

def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)

if O_DIRECTORY == 0 or O_NOFOLLOW == 0:
    fail("descriptor no-follow support is required")

def path_value(raw):
    path = pathlib.Path(raw)
    if not path.is_absolute() or path != pathlib.Path(os.path.normpath(str(path))) or path.name in ("", ".", ".."):
        fail("path must be absolute and normalized")
    return path

def inspect_directory_descriptor(descriptor, private):
    metadata = os.fstat(descriptor)
    if not stat.S_ISDIR(metadata.st_mode):
        fail("directory descriptor is not a directory")
    if private and (metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700):
        fail("directory owner or mode mismatch")
    return metadata

def open_directory(path):
    descriptor = os.open("/", os.O_RDONLY | O_DIRECTORY)
    try:
        inspect_directory_descriptor(descriptor, False)
        for component in path.parts[1:]:
            next_descriptor = os.open(component, os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW, dir_fd=descriptor)
            try:
                inspect_directory_descriptor(next_descriptor, False)
            except BaseException:
                os.close(next_descriptor)
                raise
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise

def open_parent(path):
    return open_directory(path.parent), path.name

def inspect_file_descriptor(descriptor, mode):
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        fail("file descriptor is not regular")
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != mode:
        fail("file owner or mode mismatch")
    return metadata

def open_regular_at(parent_descriptor, name, mode):
    descriptor = os.open(name, os.O_RDONLY | O_NOFOLLOW, dir_fd=parent_descriptor)
    try:
        inspect_file_descriptor(descriptor, mode)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise

def read_bounded(descriptor, max_bytes):
    os.lseek(descriptor, 0, os.SEEK_SET)
    chunks = []
    size = 0
    while True:
        chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1 - size))
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        size += len(chunk)
        if size > max_bytes:
            fail("trusted file exceeds bound")

def write_all(descriptor, payload):
    offset = 0
    while offset < len(payload):
        offset += os.write(descriptor, payload[offset:])

operation = sys.argv[1]
path = path_value(sys.argv[2])
if operation == "ensure-dir":
    parent_descriptor, name = open_parent(path)
    child_descriptor = None
    try:
        created = False
        try:
            os.mkdir(name, 0o700, dir_fd=parent_descriptor)
            created = True
        except FileExistsError:
            pass
        child_descriptor = os.open(name, os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW, dir_fd=parent_descriptor)
        inspect_directory_descriptor(child_descriptor, True)
        if created:
            os.fsync(parent_descriptor)
    finally:
        if child_descriptor is not None:
            os.close(child_descriptor)
        os.close(parent_descriptor)
elif operation == "create-dir":
    parent_descriptor, name = open_parent(path)
    child_descriptor = None
    try:
        inspect_directory_descriptor(parent_descriptor, True)
        os.mkdir(name, 0o700, dir_fd=parent_descriptor)
        child_descriptor = os.open(name, os.O_RDONLY | O_DIRECTORY | O_NOFOLLOW, dir_fd=parent_descriptor)
        inspect_directory_descriptor(child_descriptor, True)
        os.fsync(parent_descriptor)
    finally:
        if child_descriptor is not None:
            os.close(child_descriptor)
        os.close(parent_descriptor)
elif operation == "install":
    expected, mode_text, allow_existing = sys.argv[3:6]
    mode = int(mode_text, 8)
    payload = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(payload) > MAX_INPUT_BYTES:
        fail("input exceeds bound")
    if hashlib.sha256(payload).hexdigest() != expected:
        fail("input SHA-256 mismatch")
    parent_descriptor, name = open_parent(path)
    try:
        inspect_directory_descriptor(parent_descriptor, True)
        try:
            existing_descriptor = open_regular_at(parent_descriptor, name, mode)
        except FileNotFoundError:
            temporary_name = "." + name + "." + next(tempfile._get_candidate_names()) + ".tmp"
            temporary_descriptor = os.open(
                temporary_name,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY | O_NOFOLLOW,
                mode,
                dir_fd=parent_descriptor,
            )
            try:
                write_all(temporary_descriptor, payload)
                os.fchmod(temporary_descriptor, mode)
                os.fsync(temporary_descriptor)
                os.link(
                    temporary_name,
                    name,
                    src_dir_fd=parent_descriptor,
                    dst_dir_fd=parent_descriptor,
                    follow_symlinks=False,
                )
                os.fsync(parent_descriptor)
                installed_descriptor = open_regular_at(parent_descriptor, name, mode)
                try:
                    temporary_metadata = os.fstat(temporary_descriptor)
                    installed_metadata = os.fstat(installed_descriptor)
                    if (temporary_metadata.st_dev, temporary_metadata.st_ino) != (installed_metadata.st_dev, installed_metadata.st_ino):
                        fail("installed target inode mismatch")
                    if hashlib.sha256(read_bounded(installed_descriptor, MAX_INPUT_BYTES)).hexdigest() != expected:
                        fail("installed file SHA-256 mismatch")
                finally:
                    os.close(installed_descriptor)
            finally:
                os.close(temporary_descriptor)
                try:
                    os.unlink(temporary_name, dir_fd=parent_descriptor)
                except FileNotFoundError:
                    pass
        else:
            try:
                if allow_existing != "yes":
                    fail("immutable target already exists")
                if hashlib.sha256(read_bounded(existing_descriptor, MAX_INPUT_BYTES)).hexdigest() != expected:
                    fail("existing immutable file SHA-256 mismatch")
            finally:
                os.close(existing_descriptor)
    finally:
        os.close(parent_descriptor)
elif operation == "link":
    target = path_value(sys.argv[3])
    expected = sys.argv[4]
    source_parent, source_name = open_parent(path)
    target_parent, target_name = open_parent(target)
    source_descriptor = None
    target_descriptor = None
    try:
        inspect_directory_descriptor(source_parent, True)
        inspect_directory_descriptor(target_parent, True)
        source_descriptor = open_regular_at(source_parent, source_name, 0o600)
        if hashlib.sha256(read_bounded(source_descriptor, MAX_INPUT_BYTES)).hexdigest() != expected:
            fail("source SHA-256 mismatch")
        os.link(
            source_name,
            target_name,
            src_dir_fd=source_parent,
            dst_dir_fd=target_parent,
            follow_symlinks=False,
        )
        os.fsync(target_parent)
        target_descriptor = open_regular_at(target_parent, target_name, 0o600)
        source_metadata = os.fstat(source_descriptor)
        target_metadata = os.fstat(target_descriptor)
        if (source_metadata.st_dev, source_metadata.st_ino) != (target_metadata.st_dev, target_metadata.st_ino):
            fail("published target inode mismatch")
        if hashlib.sha256(read_bounded(target_descriptor, MAX_INPUT_BYTES)).hexdigest() != expected:
            fail("published file SHA-256 mismatch")
    finally:
        if target_descriptor is not None:
            os.close(target_descriptor)
        if source_descriptor is not None:
            os.close(source_descriptor)
        os.close(target_parent)
        os.close(source_parent)
elif operation == "read":
    max_bytes, mode_text, expected = sys.argv[3:6]
    parent_descriptor, name = open_parent(path)
    descriptor = None
    try:
        inspect_directory_descriptor(parent_descriptor, True)
        descriptor = open_regular_at(parent_descriptor, name, int(mode_text, 8))
        payload = read_bounded(descriptor, int(max_bytes))
        if expected != "-" and hashlib.sha256(payload).hexdigest() != expected:
            fail("trusted file SHA-256 mismatch")
        sys.stdout.buffer.write(payload)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent_descriptor)
elif operation == "exists":
    parent_descriptor, name = open_parent(path)
    descriptor = None
    try:
        inspect_directory_descriptor(parent_descriptor, True)
        try:
            descriptor = os.open(name, os.O_RDONLY | O_NOFOLLOW, dir_fd=parent_descriptor)
        except FileNotFoundError:
            print("absent")
        else:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
                fail("existence target owner or type mismatch")
            print("present")
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent_descriptor)
else:
    fail("unknown operation")
`;
const REMOTE_FILESYSTEM_HELPER_BOOTSTRAP =
	"import base64,sys;payload=base64.b64decode(sys.argv.pop(1));exec(payload,{})";
const REMOTE_FILESYSTEM_HELPER_BASE64 = Buffer.from(REMOTE_FILESYSTEM_HELPER, "utf8").toString("base64");

export class SshCompilerGymWarmRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	constructor(
		private readonly runner: CompilerGymWarmCommandRunner,
		private readonly host: string,
		private readonly pythonPath: string,
		private readonly timeoutMs: number,
	) {
		validateRemoteToken(host, "SSH host");
		validateRemotePath(pythonPath, "remote control Python");
	}

	private async invoke(
		args: readonly string[],
		signal: AbortSignal,
		options: { input?: string; maxOutputBytes?: number } = {},
	): Promise<CompilerGymWarmCommandResult> {
		const remoteArgv = [
			this.pythonPath,
			"-c",
			REMOTE_FILESYSTEM_HELPER_BOOTSTRAP,
			REMOTE_FILESYSTEM_HELPER_BASE64,
			...args,
		] as [string, ...string[]];
		const result = await this.runner.run({
			argv: compilerGymWarmSshArgv(this.host, remoteArgv),
			input: options.input,
			signal,
			timeoutMs: this.timeoutMs,
			maxOutputBytes: options.maxOutputBytes ?? MAX_CONTROL_OUTPUT_BYTES,
		});
		if (result.exitCode !== 0) throw new Error(`Remote filesystem operation failed: ${result.stderr.trim()}`);
		return result;
	}

	async ensurePrivateDirectory(path: string, signal: AbortSignal): Promise<void> {
		validateRemotePath(path, "directory");
		await this.invoke(["ensure-dir", path], signal);
	}

	async createPrivateDirectory(path: string, signal: AbortSignal): Promise<void> {
		validateRemotePath(path, "directory");
		await this.invoke(["create-dir", path], signal);
	}

	async installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
		signal: AbortSignal,
	): Promise<void> {
		validateRemotePath(path, "immutable file");
		validateSha256(expectedSha256, "immutable file digest");
		validateFileMode(mode);
		await this.invoke(
			["install", path, expectedSha256, mode.toString(8), allowExistingExact ? "yes" : "no"],
			signal,
			{ input: content },
		);
	}

	async linkImmutableFile(source: string, target: string, expectedSha256: string, signal: AbortSignal): Promise<void> {
		validateRemotePath(source, "immutable link source");
		validateRemotePath(target, "immutable link target");
		validateSha256(expectedSha256, "immutable link digest");
		await this.invoke(["link", source, target, expectedSha256], signal);
	}

	async readTrustedFile(
		path: string,
		options: { maxBytes: number; mode: number; expectedSha256?: string },
		signal: AbortSignal,
	): Promise<string> {
		validateRemotePath(path, "trusted file");
		validateFileMode(options.mode);
		if (!Number.isInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_RECORD_BYTES) {
			throw new Error("Trusted-file maxBytes is outside the backend bound");
		}
		if (options.expectedSha256) validateSha256(options.expectedSha256, "trusted file digest");
		return (
			await this.invoke(
				["read", path, String(options.maxBytes), options.mode.toString(8), options.expectedSha256 ?? "-"],
				signal,
				{ maxOutputBytes: options.maxBytes + 1 },
			)
		).stdout;
	}

	async exists(path: string, signal: AbortSignal): Promise<boolean> {
		validateRemotePath(path, "existence path");
		const result = await this.invoke(["exists", path], signal);
		const observed = result.stdout.trim();
		if (observed !== "present" && observed !== "absent") throw new Error("Invalid remote existence response");
		return observed === "present";
	}
}

interface SchedulerJob {
	slurmId: string;
	user: string;
	jobName: string;
	workDir: string;
	state: string;
	partition: string;
	command: string;
	requeue: string;
	nodes: string;
	ntasks: string;
	cpusPerTask: string;
	memory: string;
	features: string;
}

interface QueueJob {
	slurmId: string;
	user: string;
	jobName: string;
	workDir: string;
	state: string;
}

interface AccountingJob extends QueueJob {
	exitCode: string;
	allocCpus: number;
	elapsedRaw: number;
	cpuTimeRaw: number;
	startAt: string;
	endAt: string;
}

interface PoolIndexRecord {
	protocol: typeof COMPILER_GYM_WARM_PROTOCOL;
	poolDigest: string;
	branchDigest: string;
	slurmId: string;
	jobName: string;
	workDir: string;
	poolRecordSha256: string;
}

interface SchedulerObservation {
	active: boolean;
	terminal: boolean;
	state: string;
}

function validateRemoteToken(value: string, label: string): void {
	if (!SAFE_REMOTE_TOKEN_PATTERN.test(value)) throw new Error(`Unsafe ${label}: ${value}`);
}

function validateRemotePath(value: string, label: string): void {
	if (!SAFE_REMOTE_PATH_PATTERN.test(value) || posix.normalize(value) !== value)
		throw new Error(`Unsafe ${label}: ${value}`);
}

function validateSha256(value: string, label: string): string {
	if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
	return value;
}

function validateSlurmId(value: string, label = "SLURM ID"): string {
	if (!SLURM_ID_PATTERN.test(value)) throw new Error(`${label} must be a positive numeric ID`);
	return value;
}

function validateFileMode(mode: number): void {
	if (mode !== RECORD_MODE && mode !== EXECUTABLE_MODE) throw new Error("Unsupported trusted-file mode");
}

function normalizeState(value: string): string {
	return value.trim().split(/[ +]/, 1)[0].replace(/\+$/, "");
}

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

function parseCanonicalJson(content: string, label: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		throw new Error(`${label} is not valid JSON`, { cause: error });
	}
	if (canonicalLine(parsed) !== content) throw new Error(`${label} is not canonical immutable JSON`);
	return parsed;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${label} keys mismatch`);
	}
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function validateAccountingTimestamp(value: string, label: string): string {
	if (value.length < 1 || value.length > 64 || !/^[A-Za-z0-9_.:+-]+$/.test(value)) {
		throw new Error(`${label} is not a bounded sacct timestamp`);
	}
	return value;
}

function makeTimeoutSignal(timeoutMs: number, reason: string): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error(reason)), timeoutMs);
	return { signal: controller.signal, dispose: () => clearTimeout(timeout) };
}

function joinSignal(primary: AbortSignal, timeoutMs: number, reason: string): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const abortPrimary = (): void => controller.abort(primary.reason);
	if (primary.aborted) controller.abort(primary.reason);
	else primary.addEventListener("abort", abortPrimary, { once: true });
	const timeout = setTimeout(() => controller.abort(new Error(reason)), timeoutMs);
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timeout);
			primary.removeEventListener("abort", abortPrimary);
		},
	};
}

function errorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function monotonicNanoseconds(milliseconds: number): bigint {
	if (!Number.isFinite(milliseconds) || milliseconds < 0)
		throw new Error("Monotonic clock must be nonnegative and finite");
	const wholeMilliseconds = Math.trunc(milliseconds);
	const fractionalNanoseconds = Math.round((milliseconds - wholeMilliseconds) * 1_000_000);
	return BigInt(wholeMilliseconds) * 1_000_000n + BigInt(fractionalNanoseconds);
}

export class FarmShareCompilerGymWarmBackend implements CompilerGymWarmBackend {
	private readonly commandRunner: CompilerGymWarmCommandRunner;
	private readonly remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	private readonly localFileSystem: CompilerGymWarmLocalFileSystem;
	private readonly clock: CompilerGymWarmBackendClock;
	private readonly schedulerEvidenceRecords: CompilerGymWarmSchedulerEvidence[] = [];
	private readonly acquisitionTimingRecords: CompilerGymWarmAcquisitionTimingEvidence[] = [];
	private readonly acknowledgementEvidenceRecords = new Map<string, CompilerGymWarmAcknowledgementEvidence>();
	private readonly rootAccountingEvidenceRecords: CompilerGymWarmRootAccountingEvidence[] = [];

	constructor(
		private readonly config: FarmShareCompilerGymWarmBackendConfig = DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG,
		dependencies: FarmShareCompilerGymWarmBackendDependencies = {},
	) {
		this.validateConfig();
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
		this.remoteFileSystem =
			dependencies.remoteFileSystem ??
			new SshCompilerGymWarmRemoteFileSystem(
				this.commandRunner,
				this.config.host,
				this.config.remoteControlPython,
				this.config.commandTimeoutMs,
			);
		this.localFileSystem = dependencies.localFileSystem ?? new NodeCompilerGymWarmLocalFileSystem();
		this.clock = dependencies.clock ?? new SystemCompilerGymWarmBackendClock();
	}

	private validateConfig(): void {
		validateRemoteToken(this.config.host, "SSH host");
		if (!SAFE_USER_PATTERN.test(this.config.user)) throw new Error("Unsafe FarmShare user");
		validateRemotePath(this.config.spoolRoot, "spool root");
		validateRemotePath(this.config.remoteControlPython, "remote control Python");
		const allowedRoots = [`/home/users/${this.config.user}`, `/scratch/users/${this.config.user}`];
		if (!allowedRoots.some((root) => this.config.spoolRoot.startsWith(`${root}/`))) {
			throw new Error("Warm spool root must be below the configured FarmShare user's home or scratch root");
		}
		for (const [label, value] of Object.entries({
			commandTimeoutMs: this.config.commandTimeoutMs,
			readyTimeoutMs: this.config.readyTimeoutMs,
			resultTimeoutMs: this.config.resultTimeoutMs,
			shutdownTimeoutMs: this.config.shutdownTimeoutMs,
			cleanupTimeoutMs: this.config.cleanupTimeoutMs,
			dispatchVisibilityGraceMs: this.config.dispatchVisibilityGraceMs,
			pollIntervalMs: this.config.pollIntervalMs,
		})) {
			if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
		}
		if (this.config.cleanupTimeoutMs < this.config.dispatchVisibilityGraceMs) {
			throw new Error("cleanupTimeoutMs must cover dispatchVisibilityGraceMs");
		}
	}

	schedulerEvidence(): readonly CompilerGymWarmSchedulerEvidence[] {
		return this.schedulerEvidenceRecords.map((record) => ({ ...record, argv: [...record.argv] }));
	}

	acquisitionTimingEvidence(): readonly CompilerGymWarmAcquisitionTimingEvidence[] {
		return this.acquisitionTimingRecords.map((record) => ({ ...record }));
	}

	acknowledgementEvidence(): readonly CompilerGymWarmAcknowledgementEvidence[] {
		return [...this.acknowledgementEvidenceRecords.values()]
			.sort((left, right) => left.rank - right.rank)
			.map((record) => ({ ...record }));
	}

	rootAccountingEvidence(): readonly CompilerGymWarmRootAccountingEvidence[] {
		return this.rootAccountingEvidenceRecords.map((record) => ({ ...record }));
	}

	private validateExpectation(expectation: CompilerGymWarmPoolExpectation): void {
		if (expectation.protocol !== COMPILER_GYM_WARM_PROTOCOL) throw new Error("Warm pool protocol mismatch");
		for (const [label, digest] of Object.entries({
			branchDigest: expectation.branchDigest,
			poolDigest: expectation.poolDigest,
			workerSha256: expectation.workerSha256,
			evaluatorSha256: expectation.evaluatorSha256,
			launchContractSha256: expectation.launchContractSha256,
		})) {
			validateSha256(digest, label);
		}
		if (expectation.launchContractSha256 !== COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256) {
			throw new Error("Warm launch contract hash mismatch");
		}
		if (
			expectation.poolDigest !==
			compilerGymWarmPoolDigest(
				expectation.branchDigest,
				expectation.workerSha256,
				expectation.evaluatorSha256,
				expectation.launchContractSha256,
			)
		) {
			throw new Error("Warm pool digest mismatch");
		}
		if (expectation.jobName !== compilerGymWarmJobName(expectation.poolDigest)) {
			throw new Error("Warm pool job name mismatch");
		}
	}

	private poolParent(expectation: CompilerGymWarmPoolExpectation): string {
		return posix.join(this.config.spoolRoot, "pools", expectation.poolDigest);
	}

	private workDir(expectation: CompilerGymWarmPoolExpectation): string {
		return posix.join(this.poolParent(expectation), expectation.branchDigest);
	}

	private indexPath(poolDigest: string): string {
		validateSha256(poolDigest, "pool digest");
		return posix.join(this.config.spoolRoot, "index", `${poolDigest}.json`);
	}

	private async runRemote(
		remoteArgv: readonly [string, ...string[]],
		signal: AbortSignal,
		maxOutputBytes = MAX_CONTROL_OUTPUT_BYTES,
	): Promise<CompilerGymWarmCommandResult> {
		return this.commandRunner.run({
			argv: compilerGymWarmSshArgv(this.config.host, remoteArgv),
			signal,
			timeoutMs: this.config.commandTimeoutMs,
			maxOutputBytes,
		});
	}

	private async runRemoteChecked(
		remoteArgv: readonly [string, ...string[]],
		signal: AbortSignal,
	): Promise<CompilerGymWarmCommandResult> {
		const result = await this.runRemote(remoteArgv, signal);
		if (result.exitCode !== 0) {
			throw new Error(`${remoteArgv[0]} failed with ${String(result.exitCode)}: ${result.stderr.trim()}`);
		}
		return result;
	}

	private async prepareSpool(expectation: CompilerGymWarmPoolExpectation, signal: AbortSignal): Promise<string> {
		const storageRoot = this.config.spoolRoot.startsWith(`/scratch/users/${this.config.user}/`)
			? `/scratch/users/${this.config.user}`
			: `/home/users/${this.config.user}`;
		const relativeSpool = this.config.spoolRoot.slice(storageRoot.length + 1).split("/");
		let securedPath = storageRoot;
		for (const component of relativeSpool) {
			securedPath = posix.join(securedPath, component);
			await this.remoteFileSystem.ensurePrivateDirectory(securedPath, signal);
		}
		const poolsRoot = posix.join(this.config.spoolRoot, "pools");
		const indexRoot = posix.join(this.config.spoolRoot, "index");
		const assetsRoot = posix.join(this.config.spoolRoot, "assets");
		await this.remoteFileSystem.ensurePrivateDirectory(poolsRoot, signal);
		await this.remoteFileSystem.ensurePrivateDirectory(indexRoot, signal);
		await this.remoteFileSystem.ensurePrivateDirectory(assetsRoot, signal);
		const parent = this.poolParent(expectation);
		await this.remoteFileSystem.ensurePrivateDirectory(parent, signal);
		const workDir = this.workDir(expectation);
		await this.remoteFileSystem.createPrivateDirectory(workDir, signal);
		for (const child of ["prepared"]) {
			await this.remoteFileSystem.createPrivateDirectory(posix.join(workDir, child), signal);
		}
		return workDir;
	}

	private async installAssets(
		expectation: CompilerGymWarmPoolExpectation,
		signal: AbortSignal,
	): Promise<{ workerPath: string; evaluatorPath: string }> {
		const [workerSource, evaluatorSource] = await Promise.all([
			this.localFileSystem.readUtf8(this.config.localWorkerPath),
			this.localFileSystem.readUtf8(this.config.localEvaluatorPath),
		]);
		if (sha256Text(workerSource) !== expectation.workerSha256) throw new Error("Local warm worker hash mismatch");
		if (sha256Text(evaluatorSource) !== expectation.evaluatorSha256) throw new Error("Local evaluator hash mismatch");
		const assetsRoot = posix.join(this.config.spoolRoot, "assets");
		const workerPath = posix.join(assetsRoot, `compiler-gym-warm-worker-${expectation.workerSha256}.py`);
		const evaluatorPath = posix.join(assetsRoot, `compiler-gym-evaluator-${expectation.evaluatorSha256}.py`);
		await this.remoteFileSystem.installImmutableFile(
			workerPath,
			workerSource,
			expectation.workerSha256,
			EXECUTABLE_MODE,
			true,
			signal,
		);
		await this.remoteFileSystem.installImmutableFile(
			evaluatorPath,
			evaluatorSource,
			expectation.evaluatorSha256,
			EXECUTABLE_MODE,
			true,
			signal,
		);
		return { workerPath, evaluatorPath };
	}

	private launchScript(
		expectation: CompilerGymWarmPoolExpectation,
		workDir: string,
		workerPath: string,
		evaluatorPath: string,
	): string {
		const workerArgs = [
			COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
			workerPath,
			"--spool",
			workDir,
			"--pool-digest",
			expectation.poolDigest,
			"--branch-digest",
			expectation.branchDigest,
			"--job-name",
			expectation.jobName,
			"--worker-sha256",
			expectation.workerSha256,
			"--evaluator-sha256",
			expectation.evaluatorSha256,
			"--launch-contract-sha256",
			expectation.launchContractSha256,
			"--evaluator",
			evaluatorPath,
			"--python",
			COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
			"--compiler-gym-cache",
			COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache,
			"--compiler-gym-site-data",
			COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData,
			"--ld-library-path",
			COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath,
			"--python-warnings",
			COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonWarnings,
			"--cpus-per-task",
			String(COMPILER_GYM_WARM_CPUS_PER_TASK),
			"--poll-seconds",
			String(COMPILER_GYM_WARM_POLL_SECONDS),
			"--idle-timeout-seconds",
			String(COMPILER_GYM_WARM_IDLE_TIMEOUT_SECONDS),
			"--lease-timeout-seconds",
			String(COMPILER_GYM_WARM_LEASE_TIMEOUT_SECONDS),
			"--child-timeout-seconds",
			String(COMPILER_GYM_WARM_CHILD_TIMEOUT_SECONDS),
			"--child-termination-grace-seconds",
			String(COMPILER_GYM_WARM_CHILD_TERMINATION_GRACE_SECONDS),
			"--max-output-bytes",
			String(COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES),
		];
		const rankShell = [
			"exec /usr/bin/env -i",
			"PATH=/usr/bin:/bin",
			"LANG=C.UTF-8",
			`LD_LIBRARY_PATH=${shellQuote(COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath)}`,
			`COMPILER_GYM_CACHE=${shellQuote(COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache)}`,
			`COMPILER_GYM_SITE_DATA=${shellQuote(COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData)}`,
			`PYTHONWARNINGS=${shellQuote(COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonWarnings)}`,
			'SLURM_JOB_ID="$SLURM_JOB_ID"',
			'SLURM_PROCID="$SLURM_PROCID"',
			'SLURM_CPUS_PER_TASK="$SLURM_CPUS_PER_TASK"',
			'"$@" --rank "$SLURM_PROCID" --slurm-id "$SLURM_JOB_ID"',
		].join(" ");
		return `#!/bin/sh
set -eu
umask 077
export PATH=/usr/bin:/bin
export SLURM_EXPORT_ENV=NIL
i=0
while [ "$i" -lt 60 ]; do
  if [ -f ${shellQuote(posix.join(workDir, "pool.json"))} ] && [ ! -L ${shellQuote(posix.join(workDir, "pool.json"))} ]; then
    break
  fi
  i=$((i + 1))
  ${SLEEP_PATH} 1
done
if [ ! -f ${shellQuote(posix.join(workDir, "pool.json"))} ] || [ -L ${shellQuote(posix.join(workDir, "pool.json"))} ]; then
  exit 72
fi
exec ${SRUN_PATH} --ntasks=${COMPILER_GYM_WARM_SLOT_COUNT} --cpus-per-task=${COMPILER_GYM_WARM_CPUS_PER_TASK} --kill-on-bad-exit=1 --exact /bin/sh -c ${shellQuote(rankShell)} compiler-gym-warm-rank ${workerArgs.map(shellQuote).join(" ")}
`;
	}

	private sbatchArgs(
		expectation: CompilerGymWarmPoolExpectation,
		workDir: string,
		scriptPath: string,
	): [string, ...string[]] {
		return [
			SBATCH_PATH,
			"--parsable",
			"--no-requeue",
			"--export=NIL",
			`--partition=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.partition}`,
			`--constraint=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpuConstraint}`,
			`--nodes=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.nodes}`,
			`--ntasks=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.ntasks}`,
			`--cpus-per-task=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpusPerTask}`,
			`--mem=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory}`,
			`--time=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.poolWallTime}`,
			`--job-name=${expectation.jobName}`,
			`--chdir=${workDir}`,
			`--output=${posix.join(workDir, "slurm-%j.out")}`,
			`--error=${posix.join(workDir, "slurm-%j.err")}`,
			scriptPath,
		];
	}

	async acquire(
		expectation: CompilerGymWarmPoolExpectation,
		signal: AbortSignal,
	): Promise<{ pool: unknown; ready: readonly unknown[] }> {
		const startedAt = this.clock.now().toISOString();
		const startedMonotonicMs = this.clock.monotonicMs();
		this.validateExpectation(expectation);
		let submissionAttempted = false;
		let pool: CompilerGymWarmPoolRecord | undefined;
		let workDir = this.workDir(expectation);
		try {
			const operation = joinSignal(signal, this.config.readyTimeoutMs, "Warm allocation acquisition timed out");
			try {
				workDir = await this.prepareSpool(expectation, operation.signal);
				const { workerPath, evaluatorPath } = await this.installAssets(expectation, operation.signal);
				const script = this.launchScript(expectation, workDir, workerPath, evaluatorPath);
				const scriptDigest = sha256Text(script);
				const scriptPath = posix.join(workDir, `launch-${scriptDigest}.sh`);
				await this.remoteFileSystem.installImmutableFile(
					scriptPath,
					script,
					scriptDigest,
					EXECUTABLE_MODE,
					false,
					operation.signal,
				);
				await this.assertIdentityAbsent(expectation, workDir, operation.signal);
				submissionAttempted = true;
				const submitted = await this.runRemoteChecked(
					this.sbatchArgs(expectation, workDir, scriptPath),
					operation.signal,
				);
				const submittedId = submitted.stdout.trim();
				validateSlurmId(submittedId, "sbatch response");
				pool = {
					...expectation,
					slurmId: submittedId,
					workDir,
					createdAt: this.clock.now().toISOString(),
				};
				const poolContent = canonicalLine(pool);
				const poolRecordSha256 = sha256Text(poolContent);
				await this.remoteFileSystem.installImmutableFile(
					posix.join(workDir, "pool.json"),
					poolContent,
					poolRecordSha256,
					RECORD_MODE,
					false,
					operation.signal,
				);
				const index: PoolIndexRecord = {
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest: expectation.poolDigest,
					branchDigest: expectation.branchDigest,
					slurmId: submittedId,
					jobName: expectation.jobName,
					workDir,
					poolRecordSha256,
				};
				const indexContent = canonicalLine(index);
				await this.remoteFileSystem.installImmutableFile(
					this.indexPath(expectation.poolDigest),
					indexContent,
					sha256Text(indexContent),
					RECORD_MODE,
					false,
					operation.signal,
				);
				const validatedPool = parseCompilerGymWarmPoolRecord(pool, expectation);
				await this.requireActiveJob(
					validatedPool,
					operation.signal,
					new Set(["PENDING", "CONFIGURING", "RUNNING"]),
				);
				const ready = await this.waitForReady(validatedPool, operation.signal);
				const validatedReady = parseCompilerGymWarmReadyRecords(ready, validatedPool);
				const readyMonotonicMs = this.clock.monotonicMs();
				const startedMonotonicNs = monotonicNanoseconds(startedMonotonicMs);
				const readyMonotonicNs = monotonicNanoseconds(readyMonotonicMs);
				this.acquisitionTimingRecords.push({
					poolDigest: validatedPool.poolDigest,
					startedAt,
					readyAt: this.clock.now().toISOString(),
					startedMonotonicMs,
					readyMonotonicMs,
					elapsedMs: Math.max(0, readyMonotonicMs - startedMonotonicMs),
					startedMonotonicNs: startedMonotonicNs.toString(),
					readyMonotonicNs: readyMonotonicNs.toString(),
					elapsedNs: (readyMonotonicNs - startedMonotonicNs).toString(),
				});
				pool = validatedPool;
				return { pool: validatedPool, ready: validatedReady };
			} finally {
				operation.dispose();
			}
		} catch (cause) {
			const proof = await this.cleanupAcquisitionFailure(expectation, workDir, pool, submissionAttempted);
			throw new CompilerGymWarmAcquisitionError(
				`CompilerGym warm allocation acquisition failed: ${errorText(cause)}`,
				proof,
				cause,
			);
		}
	}

	async prepareRequest(
		pool: CompilerGymWarmPoolRecord,
		request: CompilerGymWarmRequestRecord,
		signal: AbortSignal,
	): Promise<void> {
		this.validatePoolRoute(pool);
		this.validateRequestForPool(pool, request);
		await this.requireActiveJob(pool, signal, new Set(["RUNNING"]));
		const content = canonicalLine(request);
		await this.remoteFileSystem.installImmutableFile(
			this.preparedRequestPath(pool, request.requestDigest),
			content,
			sha256Text(content),
			RECORD_MODE,
			false,
			signal,
		);
	}

	async publishRequest(
		pool: CompilerGymWarmPoolRecord,
		request: CompilerGymWarmRequestRecord,
		signal: AbortSignal,
	): Promise<void> {
		this.validatePoolRoute(pool);
		this.validateRequestForPool(pool, request);
		await this.requireActiveJob(pool, signal, new Set(["RUNNING"]));
		const content = canonicalLine(request);
		const digest = sha256Text(content);
		await this.remoteFileSystem.readTrustedFile(
			this.preparedRequestPath(pool, request.requestDigest),
			{ maxBytes: 1024 * 1024, mode: RECORD_MODE, expectedSha256: digest },
			signal,
		);
		await this.remoteFileSystem.linkImmutableFile(
			this.preparedRequestPath(pool, request.requestDigest),
			this.requestPath(pool, request.sequence),
			digest,
			signal,
		);
	}

	async waitForResults(
		pool: CompilerGymWarmPoolRecord,
		request: CompilerGymWarmRequestRecord,
		signal: AbortSignal,
	): Promise<readonly unknown[]> {
		this.validatePoolRoute(pool);
		this.validateRequestForPool(pool, request);
		const operation = joinSignal(signal, this.config.resultTimeoutMs, "Warm result wait timed out");
		try {
			while (true) {
				const results = await this.readRankRecords(
					pool,
					request.sequence,
					"result",
					MAX_RECORD_BYTES,
					operation.signal,
				);
				if (results[0] !== undefined && results[1] !== undefined) {
					return parseCompilerGymWarmResultRecords([results[0], results[1]], pool, request);
				}
				const claims = await this.readRankRecords(pool, request.sequence, "claim", 64 * 1024, operation.signal);
				for (const rank of [0, 1] as const) {
					if (claims[rank] !== undefined) this.validateClaimRecord(claims[rank], pool, request, rank);
				}
				const scheduler = await this.observeScheduler(pool, operation.signal);
				if (scheduler.terminal) {
					const completedRanks = results.flatMap((value, rank) => (value === undefined ? [] : [rank]));
					const claimedRanks = claims.flatMap((value, rank) => (value === undefined ? [] : [rank]));
					throw new Error(
						`Warm allocation became ${scheduler.state} before both results; completed ranks=${completedRanks.join(",") || "none"}; claimed ranks=${claimedRanks.join(",") || "none"}`,
					);
				}
				await this.clock.sleep(this.config.pollIntervalMs, operation.signal);
			}
		} finally {
			operation.dispose();
		}
	}

	async recover(
		poolDigest: string,
		slurmId: string,
		requestDigest: string,
		signal: AbortSignal,
	): Promise<CompilerGymWarmRecovery> {
		validateSha256(poolDigest, "recovery pool digest");
		validateSlurmId(slurmId, "recovery SLURM ID");
		validateSha256(requestDigest, "recovery request digest");
		const { pool } = await this.readIndexedPool(poolDigest, slurmId, signal);
		try {
			const readyValues = parseCompilerGymWarmReadyRecords(await this.readReadyRecords(pool, signal, false), pool);
			const preparedContent = await this.remoteFileSystem.readTrustedFile(
				this.preparedRequestPath(pool, requestDigest),
				{ maxBytes: 1024 * 1024, mode: RECORD_MODE },
				signal,
			);
			const request = parseCompilerGymWarmRequestRecord(parseCanonicalJson(preparedContent, "prepared request"));
			if (request.requestDigest !== requestDigest || request.poolDigest !== poolDigest) {
				throw new Error("Recovered prepared request identity mismatch");
			}
			const publishedPath = this.requestPath(pool, request.sequence);
			const published = await this.remoteFileSystem.exists(publishedPath, signal);
			if (published) {
				const expectedContent = canonicalLine(request);
				const observedContent = await this.remoteFileSystem.readTrustedFile(
					publishedPath,
					{ maxBytes: 1024 * 1024, mode: RECORD_MODE, expectedSha256: sha256Text(expectedContent) },
					signal,
				);
				if (observedContent !== expectedContent)
					throw new Error("Published request differs from its prepared record");
			}
			const claims = await this.readRankRecords(pool, request.sequence, "claim", 64 * 1024, signal);
			for (const rank of [0, 1] as const) {
				if (claims[rank] !== undefined) this.validateClaimRecord(claims[rank], pool, request, rank);
			}
			const results = await this.readRankRecords(pool, request.sequence, "result", MAX_RECORD_BYTES, signal);
			const scheduler = await this.observeScheduler(pool, signal);
			if (results[0] !== undefined && results[1] !== undefined) {
				const validatedResults = parseCompilerGymWarmResultRecords([results[0], results[1]], pool, request);
				return {
					phase: "complete",
					pool,
					ready: readyValues,
					request,
					results: validatedResults,
					allocationTerminal: scheduler.terminal,
				};
			}
			if (
				claims[0] !== undefined ||
				claims[1] !== undefined ||
				results[0] !== undefined ||
				results[1] !== undefined
			) {
				return {
					phase: "claimed",
					pool,
					ready: readyValues,
					request,
					allocationTerminal: scheduler.terminal,
				};
			}
			return {
				phase: published ? "published" : "prepared",
				pool,
				ready: readyValues,
				request,
				allocationTerminal: scheduler.terminal,
			};
		} catch (error) {
			try {
				await this.cancelAndVerify(pool, signal);
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "Warm recovery failed and cleanup could not be verified");
			}
			throw error;
		}
	}

	async shutdownAndVerify(pool: CompilerGymWarmPoolRecord, signal: AbortSignal): Promise<unknown> {
		this.validatePoolRoute(pool);
		await this.requireActiveJob(pool, signal, new Set(["RUNNING"]));
		const shutdown = {
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			poolDigest: pool.poolDigest,
			requestedAt: this.clock.now().toISOString(),
		};
		const content = canonicalLine(shutdown);
		await this.remoteFileSystem.installImmutableFile(
			posix.join(pool.workDir, "shutdown.json"),
			content,
			sha256Text(content),
			RECORD_MODE,
			false,
			signal,
		);
		const operation = joinSignal(signal, this.config.shutdownTimeoutMs, "Warm shutdown timed out");
		try {
			while (true) {
				const acknowledgedRanks = await this.readShutdownAcks(pool, operation.signal);
				const closed = await this.tryClosedAccounting(pool, operation.signal);
				if (closed) {
					if (closed.state !== "COMPLETED" || closed.exitCode !== "0:0") {
						throw new Error(`Clean warm shutdown accounted as ${closed.state}/${closed.exitCode}`);
					}
					if (acknowledgedRanks.length === COMPILER_GYM_WARM_SLOT_COUNT) {
						return this.closeVerification("shutdown", pool, closed.state, acknowledgedRanks);
					}
				}
				await this.clock.sleep(this.config.pollIntervalMs, operation.signal);
			}
		} finally {
			operation.dispose();
		}
	}

	async cancelAndVerify(pool: CompilerGymWarmPoolRecord, _signal: AbortSignal): Promise<unknown> {
		this.validatePoolRoute(pool);
		const cleanup = makeTimeoutSignal(this.config.cleanupTimeoutMs, "Warm cancellation timed out");
		try {
			const closed = await this.cancelPoolAndVerify(pool, cleanup.signal);
			const acknowledgedRanks = await this.readShutdownAcks(pool, cleanup.signal);
			return this.closeVerification("cancel", pool, closed.state, acknowledgedRanks);
		} finally {
			cleanup.dispose();
		}
	}

	private validatePoolRoute(pool: CompilerGymWarmPoolRecord): void {
		validateSha256(pool.poolDigest, "pool digest");
		validateSha256(pool.branchDigest, "branch digest");
		validateSha256(pool.workerSha256, "worker digest");
		validateSha256(pool.evaluatorSha256, "evaluator digest");
		validateSlurmId(pool.slurmId);
		validateRemotePath(pool.workDir, "pool work directory");
		if (pool.protocol !== COMPILER_GYM_WARM_PROTOCOL) throw new Error("Pool protocol mismatch");
		if (pool.launchContractSha256 !== COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256) {
			throw new Error("Pool launch contract mismatch");
		}
		if (
			pool.poolDigest !==
			compilerGymWarmPoolDigest(
				pool.branchDigest,
				pool.workerSha256,
				pool.evaluatorSha256,
				pool.launchContractSha256,
			)
		) {
			throw new Error("Pool content digest mismatch");
		}
		const expectedWorkDir = posix.join(this.config.spoolRoot, "pools", pool.poolDigest, pool.branchDigest);
		if (pool.workDir !== expectedWorkDir)
			throw new Error("Pool work directory is outside its content-addressed route");
		if (pool.jobName !== compilerGymWarmJobName(pool.poolDigest)) throw new Error("Pool job name mismatch");
	}

	private validateRequestForPool(pool: CompilerGymWarmPoolRecord, request: CompilerGymWarmRequestRecord): void {
		const parsed = parseCompilerGymWarmRequestRecord(request);
		if (parsed.poolDigest !== pool.poolDigest) throw new Error("Warm request belongs to a different pool");
	}

	private validateClaimRecord(
		value: unknown,
		pool: CompilerGymWarmPoolRecord,
		request: CompilerGymWarmRequestRecord,
		rank: 0 | 1,
	): void {
		const root = objectRecord(value, `claim rank ${rank}`);
		exactKeys(
			root,
			[
				"protocol",
				"poolDigest",
				"sequence",
				"jobId",
				"requestDigest",
				"rank",
				"benchmarkId",
				"slurmId",
				"workerSha256",
				"evaluatorSha256",
			],
			`claim rank ${rank}`,
		);
		const expected: Record<string, unknown> = {
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			poolDigest: pool.poolDigest,
			sequence: request.sequence,
			jobId: request.jobId,
			requestDigest: request.requestDigest,
			rank,
			benchmarkId: request.tasks[rank],
			slurmId: pool.slurmId,
			workerSha256: pool.workerSha256,
			evaluatorSha256: pool.evaluatorSha256,
		};
		for (const [key, expectedValue] of Object.entries(expected)) {
			if (root[key] !== expectedValue) throw new Error(`claim rank ${rank} ${key} mismatch`);
		}
	}

	private preparedRequestPath(pool: CompilerGymWarmPoolRecord, requestDigest: string): string {
		return posix.join(pool.workDir, "prepared", `${validateSha256(requestDigest, "request digest")}.json`);
	}

	private requestPath(pool: CompilerGymWarmPoolRecord, sequence: number): string {
		if (!Number.isInteger(sequence) || sequence < 0 || sequence > 3) throw new Error("Invalid warm request sequence");
		return posix.join(pool.workDir, `request-${String(sequence).padStart(4, "0")}.json`);
	}

	private rankPath(pool: CompilerGymWarmPoolRecord, sequence: number, kind: "claim" | "result", rank: 0 | 1): string {
		return posix.join(pool.workDir, `${kind}-${String(sequence).padStart(4, "0")}-rank-${rank}.json`);
	}

	private async readRankRecords(
		pool: CompilerGymWarmPoolRecord,
		sequence: number,
		kind: "claim" | "result",
		maxBytes: number,
		signal: AbortSignal,
	): Promise<[unknown | undefined, unknown | undefined]> {
		const values: [unknown | undefined, unknown | undefined] = [undefined, undefined];
		for (const rank of [0, 1] as const) {
			const path = this.rankPath(pool, sequence, kind, rank);
			if (!(await this.remoteFileSystem.exists(path, signal))) continue;
			const content = await this.remoteFileSystem.readTrustedFile(path, { maxBytes, mode: RECORD_MODE }, signal);
			values[rank] = parseCanonicalJson(content, `${kind} rank ${rank}`);
		}
		return values;
	}

	private async readReadyRecords(
		pool: CompilerGymWarmPoolRecord,
		signal: AbortSignal,
		requireBoth: boolean,
	): Promise<unknown[]> {
		const values: unknown[] = [];
		for (const rank of [0, 1] as const) {
			const path = posix.join(pool.workDir, `ready-rank-${rank}.json`);
			if (!(await this.remoteFileSystem.exists(path, signal))) {
				if (requireBoth) return [];
				continue;
			}
			const content = await this.remoteFileSystem.readTrustedFile(
				path,
				{ maxBytes: 64 * 1024, mode: RECORD_MODE },
				signal,
			);
			values.push(parseCanonicalJson(content, `ready rank ${rank}`));
		}
		return values;
	}

	private async waitForReady(pool: CompilerGymWarmPoolRecord, signal: AbortSignal): Promise<unknown[]> {
		while (true) {
			const ready = await this.readReadyRecords(pool, signal, true);
			if (ready.length === COMPILER_GYM_WARM_SLOT_COUNT) {
				await this.requireActiveJob(pool, signal, new Set(["RUNNING"]));
				return ready;
			}
			const scheduler = await this.observeScheduler(pool, signal);
			if (scheduler.terminal)
				throw new Error(`Warm allocation became ${scheduler.state} before both ranks were ready`);
			await this.clock.sleep(this.config.pollIntervalMs, signal);
		}
	}

	private async readShutdownAcks(pool: CompilerGymWarmPoolRecord, signal: AbortSignal): Promise<Array<0 | 1>> {
		const ranks: Array<0 | 1> = [];
		for (const rank of [0, 1] as const) {
			const path = posix.join(pool.workDir, `shutdown-ack-rank-${rank}.json`);
			if (!(await this.remoteFileSystem.exists(path, signal))) continue;
			const content = await this.remoteFileSystem.readTrustedFile(
				path,
				{ maxBytes: 64 * 1024, mode: RECORD_MODE },
				signal,
			);
			const root = objectRecord(
				parseCanonicalJson(content, `shutdown acknowledgement ${rank}`),
				"shutdown acknowledgement",
			);
			exactKeys(root, ["protocol", "poolDigest", "rank", "slurmId", "acknowledgedAt"], "shutdown acknowledgement");
			if (
				root.protocol !== COMPILER_GYM_WARM_PROTOCOL ||
				root.poolDigest !== pool.poolDigest ||
				root.rank !== rank ||
				root.slurmId !== pool.slurmId ||
				typeof root.acknowledgedAt !== "string" ||
				!Number.isFinite(Date.parse(root.acknowledgedAt))
			) {
				throw new Error(`Invalid shutdown acknowledgement for rank ${rank}`);
			}
			const evidenceKey = `${pool.poolDigest}:${pool.slurmId}:${rank}`;
			if (!this.acknowledgementEvidenceRecords.has(evidenceKey)) {
				const body = {
					poolDigest: pool.poolDigest,
					slurmId: pool.slurmId,
					rank,
					path,
					raw: content,
					rawBytes: Buffer.byteLength(content),
					rawSha256: sha256Text(content),
					capturedAt: this.clock.now().toISOString(),
				};
				this.acknowledgementEvidenceRecords.set(evidenceKey, {
					...body,
					recordSha256: sha256Text(canonicalLine(body)),
				});
			}
			ranks.push(rank);
		}
		return ranks;
	}

	private closeVerification(
		mode: CompilerGymWarmCloseVerification["mode"],
		pool: CompilerGymWarmPoolRecord,
		accountingState: string,
		acknowledgedRanks: readonly (0 | 1)[],
	): CompilerGymWarmCloseVerification {
		return {
			mode,
			poolDigest: pool.poolDigest,
			slurmId: pool.slurmId,
			schedulerAbsent: true,
			accountingState,
			acknowledgedRanks,
		};
	}

	private async readIndexedPool(
		poolDigest: string,
		slurmId: string,
		signal: AbortSignal,
	): Promise<{ pool: CompilerGymWarmPoolRecord; index: PoolIndexRecord }> {
		const indexContent = await this.remoteFileSystem.readTrustedFile(
			this.indexPath(poolDigest),
			{ maxBytes: 64 * 1024, mode: RECORD_MODE },
			signal,
		);
		const root = objectRecord(parseCanonicalJson(indexContent, "pool index"), "pool index");
		exactKeys(
			root,
			["protocol", "poolDigest", "branchDigest", "slurmId", "jobName", "workDir", "poolRecordSha256"],
			"pool index",
		);
		const index: PoolIndexRecord = {
			protocol:
				root.protocol === COMPILER_GYM_WARM_PROTOCOL
					? root.protocol
					: (() => {
							throw new Error("Pool index protocol mismatch");
						})(),
			poolDigest: validateSha256(requiredString(root.poolDigest, "index.poolDigest"), "index.poolDigest"),
			branchDigest: validateSha256(requiredString(root.branchDigest, "index.branchDigest"), "index.branchDigest"),
			slurmId: validateSlurmId(requiredString(root.slurmId, "index.slurmId"), "index.slurmId"),
			jobName: requiredString(root.jobName, "index.jobName"),
			workDir: requiredString(root.workDir, "index.workDir"),
			poolRecordSha256: validateSha256(
				requiredString(root.poolRecordSha256, "index.poolRecordSha256"),
				"index.poolRecordSha256",
			),
		};
		if (index.poolDigest !== poolDigest || index.slurmId !== slurmId) throw new Error("Pool index identity mismatch");
		validateRemotePath(index.workDir, "indexed work directory");
		const expectation: CompilerGymWarmPoolExpectation = {
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			poolDigest: index.poolDigest,
			branchDigest: index.branchDigest,
			jobName: index.jobName,
			workerSha256: "0".repeat(64),
			evaluatorSha256: "0".repeat(64),
			launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
		};
		const poolContent = await this.remoteFileSystem.readTrustedFile(
			posix.join(index.workDir, "pool.json"),
			{ maxBytes: 64 * 1024, mode: RECORD_MODE, expectedSha256: index.poolRecordSha256 },
			signal,
		);
		const poolRoot = objectRecord(parseCanonicalJson(poolContent, "pool record"), "pool record");
		expectation.workerSha256 = requiredString(poolRoot.workerSha256, "pool.workerSha256");
		expectation.evaluatorSha256 = requiredString(poolRoot.evaluatorSha256, "pool.evaluatorSha256");
		const pool = parseCompilerGymWarmPoolRecord(poolRoot, expectation);
		this.validatePoolRoute(pool);
		return { pool, index };
	}

	private parseScontrol(stdout: string): SchedulerJob {
		const lines = stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length !== 1) throw new Error(`Expected one scontrol job line, received ${lines.length}`);
		const fields = new Map<string, string>();
		for (const token of lines[0].split(/\s+/)) {
			const separator = token.indexOf("=");
			if (separator <= 0) continue;
			const key = token.slice(0, separator);
			const value = token.slice(separator + 1);
			if (fields.has(key)) throw new Error(`Duplicate scontrol field ${key}`);
			fields.set(key, value);
		}
		const field = (name: string): string => {
			const value = fields.get(name);
			if (value === undefined) throw new Error(`Missing scontrol field ${name}`);
			return value;
		};
		return {
			slurmId: validateSlurmId(field("JobId"), "scontrol JobId"),
			user: field("UserId").replace(/\(.+$/, ""),
			jobName: field("JobName"),
			workDir: field("WorkDir"),
			state: normalizeState(field("JobState")),
			partition: field("Partition"),
			command: field("Command"),
			requeue: field("Requeue"),
			nodes: field("NumNodes"),
			ntasks: field("NumTasks"),
			cpusPerTask: field("CPUs/Task"),
			memory: field("MinMemoryNode"),
			features: field("Features"),
		};
	}

	private verifySchedulerOwnership(job: SchedulerJob, pool: CompilerGymWarmPoolRecord): void {
		const expected: Record<string, string> = {
			slurmId: pool.slurmId,
			user: this.config.user,
			jobName: pool.jobName,
			workDir: pool.workDir,
		};
		for (const [key, value] of Object.entries(expected)) {
			if (job[key as keyof SchedulerJob] !== value) {
				throw new Error(`scontrol ${key} mismatch: expected ${value}, received ${job[key as keyof SchedulerJob]}`);
			}
		}
		const assetsRoot = posix.join(this.config.spoolRoot, "assets");
		const workerPath = posix.join(assetsRoot, `compiler-gym-warm-worker-${pool.workerSha256}.py`);
		const evaluatorPath = posix.join(assetsRoot, `compiler-gym-evaluator-${pool.evaluatorSha256}.py`);
		const expectedScript = this.launchScript(pool, pool.workDir, workerPath, evaluatorPath);
		const expectedScriptPath = posix.join(pool.workDir, `launch-${sha256Text(expectedScript)}.sh`);
		if (job.command !== expectedScriptPath) {
			throw new Error("scontrol command is not the content-addressed launch script");
		}
	}

	private verifySchedulerIdentity(job: SchedulerJob, pool: CompilerGymWarmPoolRecord): void {
		this.verifySchedulerOwnership(job, pool);
		const expected: Record<string, string> = {
			partition: COMPILER_GYM_WARM_LAUNCH_CONTRACT.partition,
			requeue: "0",
			nodes: String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.nodes),
			ntasks: String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.ntasks),
			cpusPerTask: String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpusPerTask),
			memory: COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory,
			features: COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpuConstraint,
		};
		for (const [key, value] of Object.entries(expected)) {
			if (job[key as keyof SchedulerJob] !== value) {
				throw new Error(`scontrol ${key} mismatch: expected ${value}, received ${job[key as keyof SchedulerJob]}`);
			}
		}
	}

	private parseQueue(stdout: string): QueueJob[] {
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line): QueueJob => {
				const fields = line.split("|");
				if (fields.length !== 5) throw new Error("Invalid squeue record");
				return {
					slurmId: validateSlurmId(fields[0], "squeue JobId"),
					user: fields[1],
					jobName: fields[2],
					workDir: fields[3],
					state: normalizeState(fields[4]),
				};
			});
	}

	private parseAccounting(stdout: string, enforceAllocationContract = true): AccountingJob[] {
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line): AccountingJob => {
				const fields = line.split("|");
				if (fields.length !== 11) throw new Error("Invalid sacct record");
				const allocCpus = Number(fields[6]);
				const elapsedRaw = Number(fields[7]);
				const cpuTimeRaw = Number(fields[8]);
				if (!Number.isSafeInteger(allocCpus) || allocCpus < 0) throw new Error("Invalid sacct AllocCPUS");
				if (!Number.isSafeInteger(elapsedRaw) || elapsedRaw < 0) throw new Error("Invalid sacct ElapsedRaw");
				if (!Number.isSafeInteger(cpuTimeRaw) || cpuTimeRaw < 0) throw new Error("Invalid sacct CPUTimeRAW");
				if (cpuTimeRaw !== allocCpus * elapsedRaw) throw new Error("sacct CPUTimeRAW identity mismatch");
				if (
					enforceAllocationContract &&
					allocCpus !== COMPILER_GYM_WARM_LAUNCH_CONTRACT.ntasks * COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpusPerTask
				) {
					throw new Error("sacct AllocCPUS does not match the warm allocation contract");
				}
				return {
					slurmId: validateSlurmId(fields[0], "sacct root JobIDRaw"),
					user: fields[1],
					jobName: fields[2],
					workDir: fields[3],
					state: normalizeState(fields[4]),
					exitCode: fields[5],
					allocCpus,
					elapsedRaw,
					cpuTimeRaw,
					startAt: validateAccountingTimestamp(fields[9], "sacct Start"),
					endAt: validateAccountingTimestamp(fields[10], "sacct End"),
				};
			});
	}

	private recordRootAccountingEvidence(rows: readonly AccountingJob[]): void {
		for (const row of rows) {
			const body = {
				sequence: this.rootAccountingEvidenceRecords.length,
				jobIdRaw: row.slurmId,
				user: row.user,
				jobName: row.jobName,
				workDir: row.workDir,
				state: row.state,
				exitCode: row.exitCode,
				allocCpus: row.allocCpus,
				elapsedRawSeconds: row.elapsedRaw,
				cpuTimeRawSeconds: row.cpuTimeRaw,
				startAt: row.startAt,
				endAt: row.endAt,
				capturedAt: this.clock.now().toISOString(),
			};
			this.rootAccountingEvidenceRecords.push({
				...body,
				recordSha256: sha256Text(canonicalLine(body)),
			});
		}
	}

	private async queryQueue(slurmId: string, signal: AbortSignal): Promise<QueueJob[]> {
		const result = await this.runSchedulerEvidenceQuery(
			[SQUEUE_PATH, "--noheader", "--jobs", validateSlurmId(slurmId), "--format=%A|%u|%j|%Z|%T"],
			signal,
			slurmId,
		);
		return this.parseQueue(result.stdout);
	}

	private async queryAccounting(
		slurmId: string,
		signal: AbortSignal,
		enforceAllocationContract = true,
	): Promise<AccountingJob[]> {
		const result = await this.runSchedulerEvidenceQuery(
			[
				SACCT_PATH,
				"--noheader",
				"-X",
				"--user",
				this.config.user,
				"--jobs",
				validateSlurmId(slurmId),
				"--format=JobIDRaw,User,JobName,WorkDir,State,ExitCode,AllocCPUS,ElapsedRaw,CPUTimeRAW,Start,End",
				"--parsable2",
			],
			signal,
			slurmId,
		);
		const rows = this.parseAccounting(result.stdout, enforceAllocationContract);
		const roots = rows.filter((row) => row.slurmId === slurmId);
		if (roots.length > 1) throw new Error(`sacct returned duplicate root records for ${slurmId}`);
		this.recordRootAccountingEvidence(roots);
		return roots;
	}

	private async runSchedulerEvidenceQuery(
		argv: readonly [typeof SACCT_PATH | typeof SQUEUE_PATH, ...string[]],
		signal: AbortSignal,
		slurmId?: string,
	): Promise<CompilerGymWarmCommandResult> {
		const result = await this.runRemote(argv, signal);
		const command: CompilerGymWarmSchedulerEvidence["command"] = argv[0] === SACCT_PATH ? "sacct" : "squeue";
		const common = {
			sequence: this.schedulerEvidenceRecords.length,
			command,
			argv: [...argv],
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			stdoutBytes: Buffer.byteLength(result.stdout),
			stderrBytes: Buffer.byteLength(result.stderr),
			stdoutSha256: sha256Text(result.stdout),
			stderrSha256: sha256Text(result.stderr),
			capturedAt: this.clock.now().toISOString(),
		};
		const body = slurmId === undefined ? common : { ...common, slurmId };
		this.schedulerEvidenceRecords.push({ ...body, recordSha256: sha256Text(canonicalLine(body)) });
		if (result.exitCode !== 0)
			throw new Error(`${command} failed with ${String(result.exitCode)}: ${result.stderr.trim()}`);
		return result;
	}

	private verifyQueueIdentity(job: QueueJob, pool: CompilerGymWarmPoolRecord): void {
		if (
			job.slurmId !== pool.slurmId ||
			job.user !== this.config.user ||
			job.jobName !== pool.jobName ||
			job.workDir !== pool.workDir
		) {
			throw new Error("Scheduler queue identity mismatch");
		}
	}

	private verifyAccountingIdentity(job: AccountingJob, pool: CompilerGymWarmPoolRecord): void {
		this.verifyQueueIdentity(job, pool);
	}

	private async observeScheduler(pool: CompilerGymWarmPoolRecord, signal: AbortSignal): Promise<SchedulerObservation> {
		const scontrol = await this.runRemote(
			[SCONTROL_PATH, "--oneliner", "show", "job", validateSlurmId(pool.slurmId)],
			signal,
		);
		if (scontrol.exitCode === 0 && scontrol.stdout.trim() !== "") {
			const job = this.parseScontrol(scontrol.stdout);
			this.verifySchedulerIdentity(job, pool);
			if (!ACTIVE_STATES.has(job.state) && !TERMINAL_STATES.has(job.state)) {
				throw new Error(`Unknown scontrol state ${job.state}`);
			}
			return { active: !TERMINAL_STATES.has(job.state), terminal: TERMINAL_STATES.has(job.state), state: job.state };
		}
		const queued = await this.queryQueue(pool.slurmId, signal);
		if (queued.length > 1) throw new Error(`squeue returned duplicate records for ${pool.slurmId}`);
		if (queued.length === 1) {
			this.verifyQueueIdentity(queued[0], pool);
			throw new Error(`scontrol could not verify active allocation ${pool.slurmId}: ${scontrol.stderr.trim()}`);
		}
		const accounted = await this.queryAccounting(pool.slurmId, signal);
		if (accounted.length === 0) return { active: false, terminal: false, state: "ACCOUNTING_PENDING" };
		this.verifyAccountingIdentity(accounted[0], pool);
		if (!TERMINAL_STATES.has(accounted[0].state)) {
			throw new Error(`Allocation absent from squeue but accounting is nonterminal: ${accounted[0].state}`);
		}
		return { active: false, terminal: true, state: accounted[0].state };
	}

	private async requireActiveJob(
		pool: CompilerGymWarmPoolRecord,
		signal: AbortSignal,
		allowedStates: ReadonlySet<string>,
	): Promise<void> {
		const result = await this.runRemoteChecked(
			[SCONTROL_PATH, "--oneliner", "show", "job", validateSlurmId(pool.slurmId)],
			signal,
		);
		const job = this.parseScontrol(result.stdout);
		this.verifySchedulerIdentity(job, pool);
		if (!allowedStates.has(job.state)) {
			throw new Error(`Warm allocation state ${job.state} is not allowed for this operation`);
		}
	}

	private async assertIdentityAbsent(
		expectation: CompilerGymWarmPoolExpectation,
		workDir: string,
		signal: AbortSignal,
	): Promise<void> {
		const matches = await this.discoverByIdentity(expectation, workDir, signal);
		if (matches.length > 0) {
			throw new Error(`Refusing duplicate warm allocation identity: ${matches.map((row) => row.slurmId).join(",")}`);
		}
	}

	private async discoverByIdentity(
		expectation: CompilerGymWarmPoolExpectation,
		workDir: string,
		signal: AbortSignal,
		onQueueMatch: (slurmId: string) => void = () => {},
	): Promise<AccountingJob[]> {
		const queued = await this.runSchedulerEvidenceQuery(
			[
				SQUEUE_PATH,
				"--noheader",
				"--user",
				this.config.user,
				"--name",
				expectation.jobName,
				"--format=%A|%u|%j|%Z|%T",
			],
			signal,
		);
		const queueMatches = this.parseQueue(queued.stdout)
			.filter(
				(row) => row.user === this.config.user && row.jobName === expectation.jobName && row.workDir === workDir,
			)
			.map(
				(row): AccountingJob => ({
					...row,
					exitCode: "UNKNOWN",
					allocCpus: 4,
					elapsedRaw: 0,
					cpuTimeRaw: 0,
					startAt: "Unknown",
					endAt: "Unknown",
				}),
			);
		for (const row of queueMatches) onQueueMatch(row.slurmId);
		let accountMatches: AccountingJob[] = [];
		try {
			const accounted = await this.runSchedulerEvidenceQuery(
				[
					SACCT_PATH,
					"--noheader",
					"-X",
					"--user",
					this.config.user,
					"--name",
					expectation.jobName,
					"--starttime",
					"now-1days",
					"--format=JobIDRaw,User,JobName,WorkDir,State,ExitCode,AllocCPUS,ElapsedRaw,CPUTimeRAW,Start,End",
					"--parsable2",
				],
				signal,
			);
			accountMatches = this.parseAccounting(accounted.stdout, false).filter(
				(row) => row.user === this.config.user && row.jobName === expectation.jobName && row.workDir === workDir,
			);
		} catch (error) {
			if (queueMatches.length === 0) throw error;
		}
		const byId = new Map<string, AccountingJob>();
		for (const row of [...accountMatches, ...queueMatches]) byId.set(row.slurmId, row);
		return [...byId.values()].sort((left, right) => Number(left.slurmId) - Number(right.slurmId));
	}

	private async cleanupAcquisitionFailure(
		expectation: CompilerGymWarmPoolExpectation,
		workDir: string,
		pool: CompilerGymWarmPoolRecord | undefined,
		submissionAttempted: boolean,
	): Promise<CompilerGymWarmAcquisitionCleanupProof> {
		if (!submissionAttempted) {
			return {
				protocol: ACQUISITION_CLEANUP_PROTOCOL,
				poolDigest: expectation.poolDigest,
				action: "not-submitted",
				submissionAttempted: false,
				discoveredSlurmIds: [],
				schedulerAbsent: true,
				accounting: [],
				detail: "Failure occurred before the sole sbatch invocation",
			};
		}
		const cleanup = makeTimeoutSignal(this.config.cleanupTimeoutMs, "Acquisition cleanup timed out");
		const discoveredSlurmIds: string[] = pool ? [pool.slurmId] : [];
		const accounting: CompilerGymWarmAcquisitionAccountingProof[] = [];
		try {
			const discovered = pool
				? [
						{
							...pool,
							user: this.config.user,
							state: "UNKNOWN",
							exitCode: "UNKNOWN",
						},
					]
				: await this.discoverAfterAmbiguousSubmission(expectation, workDir, cleanup.signal, (slurmId) => {
						if (!discoveredSlurmIds.includes(slurmId)) discoveredSlurmIds.push(slurmId);
					});
			discoveredSlurmIds.splice(0, discoveredSlurmIds.length, ...discovered.map((row) => row.slurmId));
			for (const row of discovered) {
				const candidatePool: CompilerGymWarmPoolRecord = pool ?? {
					...expectation,
					slurmId: row.slurmId,
					workDir,
					createdAt: this.clock.now().toISOString(),
				};
				const closed = await this.cancelPoolAndVerify(candidatePool, cleanup.signal, false);
				accounting.push({
					slurmId: closed.slurmId,
					state: closed.state,
					exitCode: closed.exitCode,
					allocCpus: closed.allocCpus,
					elapsedRaw: closed.elapsedRaw,
					cpuTimeRaw: closed.cpuTimeRaw,
					startAt: closed.startAt,
					endAt: closed.endAt,
				});
			}
			return {
				protocol: ACQUISITION_CLEANUP_PROTOCOL,
				poolDigest: expectation.poolDigest,
				action: discovered.length === 0 ? "verified-absent" : "cancelled-and-verified",
				submissionAttempted: true,
				discoveredSlurmIds: [...discoveredSlurmIds],
				schedulerAbsent: true,
				accounting,
				detail:
					discovered.length === 0
						? "Exact job-name/work-directory discovery found no allocation in squeue or root sacct"
						: "Every exact-identity allocation was cancelled and verified absent from squeue with terminal root accounting",
			};
		} catch (cleanupError) {
			return {
				protocol: ACQUISITION_CLEANUP_PROTOCOL,
				poolDigest: expectation.poolDigest,
				action: "cleanup-unverified",
				submissionAttempted: true,
				discoveredSlurmIds: [...discoveredSlurmIds],
				schedulerAbsent: false,
				accounting: [...accounting],
				detail: errorText(cleanupError),
			};
		} finally {
			cleanup.dispose();
		}
	}

	private async discoverAfterAmbiguousSubmission(
		expectation: CompilerGymWarmPoolExpectation,
		workDir: string,
		signal: AbortSignal,
		onQueueMatch: (slurmId: string) => void,
	): Promise<AccountingJob[]> {
		const deadline = this.clock.monotonicMs() + this.config.dispatchVisibilityGraceMs;
		while (true) {
			const discovered = await this.discoverByIdentity(expectation, workDir, signal, onQueueMatch);
			if (discovered.length > 0) return discovered;
			if (this.clock.monotonicMs() >= deadline) return [];
			await this.clock.sleep(this.config.pollIntervalMs, signal);
		}
	}

	private async cancelPoolAndVerify(
		pool: CompilerGymWarmPoolRecord,
		signal: AbortSignal,
		enforceAllocationContract = true,
	): Promise<AccountingJob> {
		const queuedBefore = await this.queryQueue(pool.slurmId, signal);
		if (queuedBefore.length > 1) throw new Error(`Duplicate squeue rows for ${pool.slurmId}`);
		if (queuedBefore.length === 1) {
			this.verifyQueueIdentity(queuedBefore[0], pool);
			const controlled = await this.runRemote(
				[SCONTROL_PATH, "--oneliner", "show", "job", validateSlurmId(pool.slurmId)],
				signal,
			);
			if (controlled.exitCode === 0 && controlled.stdout.trim() !== "") {
				const schedulerJob = this.parseScontrol(controlled.stdout);
				if (enforceAllocationContract) this.verifySchedulerIdentity(schedulerJob, pool);
				else this.verifySchedulerOwnership(schedulerJob, pool);
			}
			const cancelled = await this.runRemote([SCANCEL_PATH, "--full", validateSlurmId(pool.slurmId)], signal);
			if (cancelled.exitCode !== 0) {
				const stillQueued = await this.queryQueue(pool.slurmId, signal);
				if (stillQueued.length > 0) throw new Error(`scancel failed: ${cancelled.stderr.trim()}`);
			}
		}
		return this.requireClosedAccounting(pool, signal, enforceAllocationContract);
	}

	private async tryClosedAccounting(
		pool: CompilerGymWarmPoolRecord,
		signal: AbortSignal,
		enforceAllocationContract = true,
	): Promise<AccountingJob | undefined> {
		const queued = await this.queryQueue(pool.slurmId, signal);
		if (queued.length > 1) throw new Error(`Duplicate squeue rows for ${pool.slurmId}`);
		if (queued.length === 1) {
			this.verifyQueueIdentity(queued[0], pool);
			return undefined;
		}
		const accounted = await this.queryAccounting(pool.slurmId, signal, enforceAllocationContract);
		if (accounted.length === 0) return undefined;
		this.verifyAccountingIdentity(accounted[0], pool);
		if (!TERMINAL_STATES.has(accounted[0].state)) return undefined;
		return accounted[0];
	}

	private async requireClosedAccounting(
		pool: CompilerGymWarmPoolRecord,
		signal: AbortSignal,
		enforceAllocationContract = true,
	): Promise<AccountingJob> {
		while (true) {
			const closed = await this.tryClosedAccounting(pool, signal, enforceAllocationContract);
			if (closed) return closed;
			await this.clock.sleep(this.config.pollIntervalMs, signal);
		}
	}
}

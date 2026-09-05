import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	assessCompilerGymCompleteActionSpaceResult,
	buildCompilerGymCompleteActionSpaceProtocol,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_PATH,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_PATH,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_TERMINAL_VERIFIER_CONTRACT,
	type CompilerGymCompleteActionSpaceProtocol,
	type CompilerGymCompleteActionSpaceResultAssessment,
	loadCompilerGymCompleteActionSpaceSources,
} from "./compiler-gym-complete-action-space-headroom.js";
import {
	type CompilerGymWarmCommandRequest,
	type CompilerGymWarmCommandResult,
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	compilerGymWarmSshArgv,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import type { ArtifactRef } from "./types.js";

export const COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_PREREGISTRATION_PROTOCOL =
	"compiler-gym-complete-action-space-headroom-preregistration-v1" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_PROTOCOL =
	"compiler-gym-complete-action-space-headroom-runner-v1" as const;

const ENVIRONMENT_PROBE_PATH = "research/autoresearch/evaluators/compiler_gym_env_probe.py" as const;
const ENVIRONMENT_PROBE_SHA256 = "117951542f86c3634053f2601ebb7559323baa606a497dc6d6aebdcf236e324c" as const;
const RUNNER_PATH = "research/autoresearch/src/compiler-gym-complete-action-space-headroom-runner.ts" as const;
const REMOTE_PROBE_ROOT =
	"/scratch/users/duynguy/prime-autoresearch-private/complete-action-space-headroom-v1/probes" as const;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;
const FARM_USER = "duynguy" as const;
const ACCOUNTING_PENDING_STATES = new Set([
	"CONFIGURING",
	"COMPLETING",
	"PENDING",
	"REQUEUED",
	"RESIZING",
	"RUNNING",
	"SUSPENDED",
]);
const MAX_COMMAND_OUTPUT_BYTES = 32 * 1024 * 1024;

const SOURCE_CLOSURE = [
	{ relativePath: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_PATH, role: "authoritative-evaluator" },
	{ relativePath: COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_PATH, role: "headroom-evaluator" },
	{ relativePath: ENVIRONMENT_PROBE_PATH, role: "environment-probe" },
	{
		relativePath: "research/autoresearch/src/compiler-gym-complete-action-space-headroom.ts",
		role: "headroom-protocol",
	},
	{ relativePath: RUNNER_PATH, role: "one-shot-runner" },
	{
		relativePath: "research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
		role: "ssh-backend",
	},
	{ relativePath: "research/autoresearch/src/compiler-gym-warm-transport.ts", role: "backend-dependency" },
	{ relativePath: "research/autoresearch/src/ledger.ts", role: "hash-linked-ledger" },
	{ relativePath: "research/autoresearch/src/artifact-store.ts", role: "content-addressed-artifacts" },
	{ relativePath: "research/autoresearch/src/canonical-json.ts", role: "canonical-json-dependency" },
	{ relativePath: "research/autoresearch/src/types.ts", role: "artifact-type-dependency" },
	{ relativePath: "package.json", role: "node-package-contract" },
	{ relativePath: "package-lock.json", role: "node-dependency-lock" },
] as const;

const ENVIRONMENT_PROBE_EXPECTED_RESULT = {
	bitcodeFiles: 23,
	bitcodeManifestBytes: 1901,
	bitcodeTreeManifestSha256: "3447f0794f8e981ff72305cc4efd8e891bb3f348aeb25d189fb0915a39a322cb",
	cbenchValidationInputs: 20,
	compatibilityTreeEntries: 2749,
	compatibilityTreeManifestBytes: 215462,
	compatibilityTreeManifestSha256: "c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1",
	compilerGymVersion: "0.2.5",
	distributionCount: 30,
	distributionManifestSha256: "4b84dea7461512ef8fdadb99a992066484119fc91b7d8f0d3b33b5598fa870dd",
	installedCbenchSourceSha256: "6e38fd10d4bfd7816dbe6f959ff8ae97a3c10ab94cadde883926d83c0db521ed",
	libtinfoSha256: "d82654b2615eb347e8f15a63862c9234f452187250b75d36dce8bd964541f02e",
	pass: true,
	protocol: "compiler-gym-farmshare-environment-probe-v1",
	pythonVersion: "3.10.19",
	runtimeFiles: 571,
	runtimeManifestBytes: 54171,
	runtimeTreeManifestSha256: "238784ee2032baa43e65a47aa00b13cc805430ffec70952b3dcaa4466a04c8c6",
} as const;

interface SourceClosureEntry {
	relativePath: string;
	role: string;
	sha256: string;
}

export interface CompilerGymCompleteActionSpaceHeadroomPreregistration {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_PREREGISTRATION_PROTOCOL;
	status: "pre-dispatch";
	hypothesisProtocol: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL;
	design: {
		modelCalls: 0;
		providerCalls: 0;
		gpuAllocations: 0;
		cpuAllocations: 1;
		evaluatorTasks: 1;
		cpusPerTask: 1;
		evaluatorCpuMinutesMaximum: 10;
		taskWallMinutesMaximum: 10;
		schedulerLogicalCpusPerAllocation: 2;
		schedulerLogicalCpuMinutesMaximum: 20;
		dispatchAttempts: 1;
		allocationRetries: 0;
		dispatchVisibilityGraceSeconds: 120;
		terminalAdmission: "passed-or-verified-negative-only";
	};
	headroomProtocolSha256: string;
	scientificDispatchSha256: string;
	sourceClosure: SourceClosureEntry[];
	sourceClosureSha256: string;
	environmentProbe: {
		sealScope: "frozen-operational-not-byte-complete-python-tree";
		localPath: typeof ENVIRONMENT_PROBE_PATH;
		sha256: typeof ENVIRONMENT_PROBE_SHA256;
		remoteRoot: typeof REMOTE_PROBE_ROOT;
		expectedResult: typeof ENVIRONMENT_PROBE_EXPECTED_RESULT;
	};
	execution: CompilerGymCompleteActionSpaceProtocol["execution"];
	request: CompilerGymCompleteActionSpaceProtocol["request"];
	requestSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256;
	stdinSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256;
	authorizations: CompilerGymCompleteActionSpaceProtocol["authorizations"];
}

export interface CompilerGymCompleteActionSpaceHeadroomRunnerConfig {
	repoRoot: string;
	preregistrationPath: string;
	outputPath: string;
	commandTimeoutMs: number;
	accountingTimeoutMs: number;
	accountingPollMs: number;
	dispatchVisibilityGraceMs: number;
	dispatchLockRoot?: string;
}

export const DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS = {
	commandTimeoutMs: 12 * 60_000,
	accountingTimeoutMs: 2 * 60_000,
	accountingPollMs: 1_000,
	dispatchVisibilityGraceMs: 2 * 60_000,
} as const;

export interface CompilerGymCompleteActionSpaceHeadroomRunnerClock {
	now(): Date;
	monotonicNs(): bigint;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export class SystemCompilerGymCompleteActionSpaceHeadroomRunnerClock
	implements CompilerGymCompleteActionSpaceHeadroomRunnerClock
{
	now(): Date {
		return new Date();
	}

	monotonicNs(): bigint {
		return process.hrtime.bigint();
	}

	sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolveSleep, reject) => {
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			const timer = setTimeout(() => {
				signal.removeEventListener("abort", abort);
				resolveSleep();
			}, ms);
			const abort = (): void => {
				clearTimeout(timer);
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}

export interface CompilerGymCompleteActionSpaceHeadroomRunnerDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	clock?: CompilerGymCompleteActionSpaceHeadroomRunnerClock;
}

interface CommandEvidence {
	sequence: number;
	argv: string[];
	argvSha256: string;
	input: ArtifactRef | null;
	startedAt: string;
	finishedAt: string;
	startedMonotonicNs: string;
	finishedMonotonicNs: string;
	exitCode: number | null;
	wallMs: number | null;
	stdout: ArtifactRef | null;
	stderr: ArtifactRef | null;
	error: string | null;
}

class RecordingCommandRunner implements CompilerGymWarmCommandRunner {
	private sequence = 0;
	readonly artifacts: ArtifactRef[] = [];
	private readonly records = new Map<number, CommandEvidence>();

	constructor(
		private readonly delegate: CompilerGymWarmCommandRunner,
		private readonly artifactStore: ArtifactStore,
		private readonly ledger: EvidenceLedger,
		private readonly clock: CompilerGymCompleteActionSpaceHeadroomRunnerClock,
	) {}

	nextSequence(): number {
		return this.sequence;
	}

	record(sequence: number): CommandEvidence {
		const value = this.records.get(sequence);
		if (!value) throw new Error(`Missing command evidence ${sequence}`);
		return value;
	}

	async store(content: string, mediaType: string): Promise<ArtifactRef> {
		const artifact = await this.artifactStore.putString(content, mediaType);
		this.artifacts.push(artifact);
		return artifact;
	}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		const sequence = this.sequence++;
		const startedAt = this.clock.now().toISOString();
		const startedMonotonicNs = this.clock.monotonicNs();
		const input = request.input === undefined ? null : await this.store(request.input, "application/octet-stream");
		let result: CompilerGymWarmCommandResult | null = null;
		let stdout: ArtifactRef | null = null;
		let stderr: ArtifactRef | null = null;
		let errorText: string | null = null;
		try {
			result = await this.delegate.run(request);
			stdout = await this.store(result.stdout, "text/plain");
			stderr = await this.store(result.stderr, "text/plain");
			return result;
		} catch (error) {
			errorText = error instanceof Error ? (error.stack ?? error.message) : String(error);
			throw error;
		} finally {
			const evidence: CommandEvidence = {
				sequence,
				argv: [...request.argv],
				argvSha256: sha256Json(request.argv),
				input,
				startedAt,
				finishedAt: this.clock.now().toISOString(),
				startedMonotonicNs: startedMonotonicNs.toString(),
				finishedMonotonicNs: this.clock.monotonicNs().toString(),
				exitCode: result?.exitCode ?? null,
				wallMs: result?.wallMs ?? null,
				stdout,
				stderr,
				error: errorText,
			};
			this.records.set(sequence, evidence);
			await this.ledger.append("run_manifest", {
				type: "complete_action_space_command",
				protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_PROTOCOL,
				...evidence,
			});
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function exactCanonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

class StrictJsonParser {
	private offset = 0;

	constructor(private readonly source: string) {}

	parse(): unknown {
		const value = this.value();
		if (this.offset !== this.source.length) this.fail("trailing data");
		return value;
	}

	private fail(message: string): never {
		throw new Error(`invalid strict JSON at byte ${this.offset}: ${message}`);
	}

	private value(): unknown {
		const token = this.source[this.offset];
		if (token === "{") return this.object();
		if (token === "[") return this.array();
		if (token === '"') return this.string();
		if (token === "t") return this.literal("true", true);
		if (token === "f") return this.literal("false", false);
		if (token === "n") return this.literal("null", null);
		if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) return this.number();
		this.fail("expected a JSON value");
	}

	private object(): Record<string, unknown> {
		this.offset++;
		const result: Record<string, unknown> = {};
		const keys = new Set<string>();
		if (this.source[this.offset] === "}") {
			this.offset++;
			return result;
		}
		while (true) {
			if (this.source[this.offset] !== '"') this.fail("expected an object key");
			const key = this.string();
			if (keys.has(key)) this.fail(`duplicate object key ${JSON.stringify(key)}`);
			keys.add(key);
			if (this.source[this.offset] !== ":") this.fail("expected a colon");
			this.offset++;
			result[key] = this.value();
			const separator = this.source[this.offset++];
			if (separator === "}") return result;
			if (separator !== ",") this.fail("expected a comma or closing brace");
		}
	}

	private array(): unknown[] {
		this.offset++;
		const result: unknown[] = [];
		if (this.source[this.offset] === "]") {
			this.offset++;
			return result;
		}
		while (true) {
			result.push(this.value());
			const separator = this.source[this.offset++];
			if (separator === "]") return result;
			if (separator !== ",") this.fail("expected a comma or closing bracket");
		}
	}

	private string(): string {
		const start = this.offset;
		this.offset++;
		while (this.offset < this.source.length) {
			const character = this.source[this.offset++];
			if (character === '"') {
				try {
					return JSON.parse(this.source.slice(start, this.offset)) as string;
				} catch {
					this.fail("invalid string escape");
				}
			}
			if (character === "\\") {
				const escapeCode = this.source[this.offset++];
				if (escapeCode === "u") {
					const codePoint = this.source.slice(this.offset, this.offset + 4);
					if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) this.fail("invalid unicode escape");
					this.offset += 4;
				} else if (!escapeCode || !'"\\/bfnrt'.includes(escapeCode)) {
					this.fail("invalid string escape");
				}
			} else if (character !== undefined && character.charCodeAt(0) < 0x20) {
				this.fail("unescaped control character");
			}
		}
		this.fail("unterminated string");
	}

	private number(): number {
		const remainder = this.source.slice(this.offset);
		const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
		if (!match) this.fail("invalid number");
		this.offset += match[0].length;
		const value = Number(match[0]);
		if (!Number.isFinite(value)) this.fail("non-finite number");
		return value;
	}

	private literal<T>(text: string, value: T): T {
		if (!this.source.startsWith(text, this.offset)) this.fail(`expected ${text}`);
		this.offset += text.length;
		return value;
	}
}

function parseStrictJsonLine(contents: string, path: string): unknown {
	if (!contents.endsWith("\n") || contents.slice(0, -1).includes("\n")) {
		throw new Error(`${path} must be exactly one newline-terminated JSON object`);
	}
	let parsed: unknown;
	try {
		parsed = new StrictJsonParser(contents.slice(0, -1)).parse();
	} catch (error) {
		throw new Error(`${path} is not strict JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed)) throw new Error(`${path} must contain one JSON object`);
	return parsed;
}

async function assertPrivateRegularFile(path: string, expectedContents: string, label: string): Promise<void> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`${label} must be an owner-only regular file`);
	}
	if ((await readFile(path, "utf8")) !== expectedContents) throw new Error(`${label} changed after creation`);
}

async function assertPathAbsent(path: string, label: string): Promise<void> {
	try {
		await lstat(path);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	throw new Error(`${label} already exists`);
}

async function writeExclusiveCanonical(path: string, value: unknown): Promise<string> {
	const contents = exactCanonicalLine(value);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await assertPrivateRegularFile(path, contents, "Exclusive canonical record");
	return contents;
}

async function loadSourceClosure(repoRoot: string): Promise<{
	entries: SourceClosureEntry[];
	contents: Map<string, string>;
}> {
	const contents = new Map<string, string>();
	const entries = await Promise.all(
		SOURCE_CLOSURE.map(async ({ relativePath, role }): Promise<SourceClosureEntry> => {
			const source = await readFile(resolve(repoRoot, relativePath), "utf8");
			contents.set(relativePath, source);
			return { relativePath, role, sha256: sha256Text(source) };
		}),
	);
	return { entries, contents };
}

async function buildPreregistration(repoRoot: string): Promise<{
	preregistration: CompilerGymCompleteActionSpaceHeadroomPreregistration;
	protocol: CompilerGymCompleteActionSpaceProtocol;
	sourceContents: Map<string, string>;
}> {
	const [sources, closure] = await Promise.all([
		loadCompilerGymCompleteActionSpaceSources(repoRoot),
		loadSourceClosure(repoRoot),
	]);
	const protocol = buildCompilerGymCompleteActionSpaceProtocol(sources);
	const probeSource = closure.contents.get(ENVIRONMENT_PROBE_PATH);
	if (!probeSource || sha256Text(probeSource) !== ENVIRONMENT_PROBE_SHA256) {
		throw new Error("Environment probe differs from its frozen source hash");
	}
	const sourceClosureSha256 = sha256Json(closure.entries);
	const scientificDispatchSha256 = sha256Json({
		protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
		requestSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256,
		sourceBundleSha256: protocol.execution.sourceBundleSha256,
		authoritativeEvaluatorSha256: protocol.sourceSeal.authoritativeEvaluatorSha256,
		headroomEvaluatorSha256: protocol.sourceSeal.headroomEvaluatorSha256,
		terminalVerifierContract: COMPILER_GYM_COMPLETE_ACTION_SPACE_TERMINAL_VERIFIER_CONTRACT,
	});
	const preregistration: CompilerGymCompleteActionSpaceHeadroomPreregistration = {
		schemaVersion: 1,
		protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_PREREGISTRATION_PROTOCOL,
		status: "pre-dispatch",
		hypothesisProtocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
		design: {
			modelCalls: 0,
			providerCalls: 0,
			gpuAllocations: 0,
			cpuAllocations: 1,
			evaluatorTasks: 1,
			cpusPerTask: 1,
			evaluatorCpuMinutesMaximum: 10,
			taskWallMinutesMaximum: 10,
			schedulerLogicalCpusPerAllocation: 2,
			schedulerLogicalCpuMinutesMaximum: 20,
			dispatchAttempts: 1,
			allocationRetries: 0,
			dispatchVisibilityGraceSeconds: 120,
			terminalAdmission: "passed-or-verified-negative-only",
		},
		headroomProtocolSha256: sha256Json(protocol),
		scientificDispatchSha256,
		sourceClosure: closure.entries,
		sourceClosureSha256,
		environmentProbe: {
			sealScope: "frozen-operational-not-byte-complete-python-tree",
			localPath: ENVIRONMENT_PROBE_PATH,
			sha256: ENVIRONMENT_PROBE_SHA256,
			remoteRoot: REMOTE_PROBE_ROOT,
			expectedResult: structuredClone(ENVIRONMENT_PROBE_EXPECTED_RESULT),
		},
		execution: structuredClone(protocol.execution),
		request: structuredClone(protocol.request),
		requestSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256,
		stdinSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256,
		authorizations: { ...protocol.authorizations },
	};
	return { preregistration, protocol, sourceContents: closure.contents };
}

async function verifyLocalClosure(
	repoRoot: string,
	preregistration: CompilerGymCompleteActionSpaceHeadroomPreregistration,
): Promise<void> {
	const observed = await loadSourceClosure(repoRoot);
	if (
		sha256Json(observed.entries) !== preregistration.sourceClosureSha256 ||
		canonicalJson(toJsonValue(observed.entries)) !== canonicalJson(toJsonValue(preregistration.sourceClosure))
	) {
		throw new Error("Complete-action-space source closure drifted");
	}
}

async function ensurePrivateDirectoryTree(
	remoteFileSystem: Pick<CompilerGymWarmRemoteFileSystem, "ensurePrivateDirectory">,
	directory: string,
	signal: AbortSignal,
): Promise<void> {
	if (!directory.startsWith("/") || posix.normalize(directory) !== directory || directory.endsWith("/")) {
		throw new Error("Remote directory must be absolute and normalized");
	}
	const components = directory.split("/").slice(1);
	if (
		components.length < 5 ||
		(components[0] !== "scratch" && components[0] !== "home") ||
		components[1] !== "users" ||
		!components[2]
	) {
		throw new Error("Remote directory must be below a user storage root");
	}
	let current = `/${components.slice(0, 3).join("/")}`;
	for (const component of components.slice(3)) {
		current = posix.join(current, component);
		await remoteFileSystem.ensurePrivateDirectory(current, signal);
	}
}

function environmentProbeArgv(remotePath: string): [string, ...string[]] {
	return [
		"/usr/bin/env",
		"-i",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		"LD_LIBRARY_PATH=/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib",
		"COMPILER_GYM_CACHE=/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache",
		"COMPILER_GYM_SITE_DATA=/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2",
		"PYTHONDONTWRITEBYTECODE=1",
		"PYTHONWARNINGS=ignore::FutureWarning",
		"/scratch/users/duynguy/prime-autoresearch/compiler-gym-venv-v2/bin/python",
		remotePath,
	];
}

function parseEnvironmentProbe(result: CompilerGymWarmCommandResult): string {
	if (result.exitCode !== 0 || result.stderr !== "")
		throw new Error("FarmShare environment probe failed or emitted stderr");
	const parsed = parseStrictJsonLine(result.stdout, "environment probe stdout");
	const expected = exactCanonicalLine(ENVIRONMENT_PROBE_EXPECTED_RESULT);
	if (
		result.stdout !== expected ||
		canonicalJson(toJsonValue(parsed)) !== canonicalJson(toJsonValue(ENVIRONMENT_PROBE_EXPECTED_RESULT))
	) {
		throw new Error("FarmShare environment probe differs from the frozen seal");
	}
	return sha256Text(result.stdout);
}

export interface CompilerGymCompleteActionSpaceHeadroomAccounting {
	root: {
		jobIdRaw: string;
		jobName: string;
		state: "COMPLETED";
		exitCode: "0:0";
		allocCpus: 2;
		nTasks: null;
		elapsedRawSeconds: number;
		cpuTimeRawSeconds: number;
		nodeList: string;
		startAt: string;
		endAt: string;
	};
	step: {
		jobIdRaw: string;
		jobName: string;
		state: "COMPLETED";
		exitCode: "0:0";
		allocCpus: 1;
		nTasks: 1;
		elapsedRawSeconds: number;
		cpuTimeRawSeconds: number;
		nodeList: string;
		startAt: string;
		endAt: string;
	};
	extern: {
		jobIdRaw: string;
		jobName: "extern";
		state: "COMPLETED";
		exitCode: "0:0";
	};
}

interface ParsedAccountingRow {
	jobIdRaw: string;
	jobName: string;
	state: string;
	exitCode: string;
	allocCpus: number;
	nTasks: number | null;
	elapsedRawSeconds: number;
	cpuTimeRawSeconds: number;
	nodeList: string;
	startAt: string;
	endAt: string;
}

class AccountingPendingError extends Error {}

function parseAccountingInteger(value: string, path: string): number {
	if (!/^[0-9]+$/.test(value)) throw new Error(`sacct ${path} must be an integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`sacct ${path} must be a safe integer`);
	return parsed;
}

function normalizeSlurmState(value: string): string {
	return value.trim().split(/[ +]/, 1)[0]?.replace(/\+$/, "") ?? "";
}

function parseAccountingRow(line: string): ParsedAccountingRow {
	const fields = line.split("|");
	if (fields.at(-1) === "") fields.pop();
	if (fields.length !== 11) throw new Error("sacct row has an unexpected field count");
	const [
		jobIdRaw,
		jobName,
		state,
		exitCode,
		allocCpusRaw,
		nTasksRaw,
		elapsedRaw,
		cpuTimeRaw,
		nodeList,
		startAt,
		endAt,
	] = fields;
	const normalizedState = normalizeSlurmState(state);
	if (!jobIdRaw || !jobName || !normalizedState || !exitCode) {
		throw new Error("sacct row has an empty required field");
	}
	if (
		ACCOUNTING_PENDING_STATES.has(normalizedState) ||
		!nodeList ||
		!startAt ||
		!endAt ||
		startAt === "Unknown" ||
		endAt === "Unknown"
	) {
		throw new AccountingPendingError("sacct row is not terminally populated");
	}
	if (!Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt))) {
		throw new Error("sacct row has an invalid timestamp");
	}
	const allocCpus = parseAccountingInteger(allocCpusRaw, "AllocCPUS");
	const nTasks = nTasksRaw === "" ? null : parseAccountingInteger(nTasksRaw, "NTasks");
	const elapsedRawSeconds = parseAccountingInteger(elapsedRaw, "ElapsedRaw");
	const cpuTimeRawSeconds = parseAccountingInteger(cpuTimeRaw, "CPUTimeRAW");
	if (cpuTimeRawSeconds !== allocCpus * elapsedRawSeconds) {
		throw new Error("sacct CPUTimeRAW contradicts AllocCPUS and ElapsedRaw");
	}
	return {
		jobIdRaw,
		jobName,
		state: normalizedState,
		exitCode,
		allocCpus,
		nTasks,
		elapsedRawSeconds,
		cpuTimeRawSeconds,
		nodeList,
		startAt,
		endAt,
	};
}

export function parseCompilerGymCompleteActionSpaceHeadroomAccounting(
	stdout: string,
	expectedSlurmId: string,
	expectedJobName: string,
): CompilerGymCompleteActionSpaceHeadroomAccounting {
	const lines = stdout.trim().split("\n").filter(Boolean);
	if (lines.length < 3) {
		throw new AccountingPendingError("sacct does not yet contain the root, extern, and .0 step rows");
	}
	if (lines.length > 3) throw new Error("sacct returned rows outside the exact root, extern, and .0 step inventory");
	const rows = lines.map(parseAccountingRow);
	if (new Set(rows.map((row) => row.jobIdRaw)).size !== rows.length) {
		throw new Error("sacct returned duplicate accounting row IDs");
	}
	const root = rows.find((row) => row.jobIdRaw === expectedSlurmId);
	const step = rows.find((row) => row.jobIdRaw === `${expectedSlurmId}.0`);
	const extern = rows.find((row) => row.jobIdRaw === `${expectedSlurmId}.extern`);
	if (!extern || rows.some((row) => row !== root && row !== step && row !== extern)) {
		throw new Error("sacct rows do not exactly bind the root allocation and .0 step");
	}
	if (!root || !step) throw new AccountingPendingError("sacct root or .0 step row is not yet visible");
	if (
		root.jobName !== expectedJobName ||
		root.state !== "COMPLETED" ||
		root.exitCode !== "0:0" ||
		root.allocCpus !== 2 ||
		root.nTasks !== null ||
		root.elapsedRawSeconds > 600 ||
		step.state !== "COMPLETED" ||
		step.exitCode !== "0:0" ||
		step.allocCpus !== 1 ||
		step.nTasks !== 1 ||
		step.elapsedRawSeconds > 600 ||
		step.elapsedRawSeconds > root.elapsedRawSeconds ||
		!/^barley-0[1-4]$/.test(root.nodeList) ||
		step.nodeList !== root.nodeList ||
		Date.parse(step.startAt) < Date.parse(root.startAt) ||
		Date.parse(step.endAt) > Date.parse(root.endAt)
	) {
		throw new Error("sacct rows violate the frozen one-task whole-core accounting contract");
	}
	if (
		extern.jobName !== "extern" ||
		extern.state !== "COMPLETED" ||
		extern.exitCode !== "0:0" ||
		extern.allocCpus !== 2 ||
		extern.nTasks !== 1 ||
		extern.elapsedRawSeconds > 600 ||
		extern.nodeList !== root.nodeList ||
		Date.parse(extern.startAt) < Date.parse(root.startAt) ||
		Date.parse(extern.endAt) > Date.parse(root.endAt)
	) {
		throw new Error("sacct extern row violates the frozen scheduler-metadata contract");
	}
	return {
		root: {
			...root,
			state: "COMPLETED",
			exitCode: "0:0",
			allocCpus: 2,
			nTasks: null,
		},
		step: {
			...step,
			state: "COMPLETED",
			exitCode: "0:0",
			allocCpus: 1,
			nTasks: 1,
		},
		extern: {
			jobIdRaw: extern.jobIdRaw,
			jobName: "extern",
			state: "COMPLETED",
			exitCode: "0:0",
		},
	};
}

function sacctArgv(slurmId: string): [string, ...string[]] {
	if (!SLURM_ID_PATTERN.test(slurmId)) throw new Error("Invalid Slurm ID for sacct");
	return [
		"/usr/bin/sacct",
		"--jobs",
		slurmId,
		"--noheader",
		"--parsable2",
		"--format=JobIDRaw,JobName,State,ExitCode,AllocCPUS,NTasks,ElapsedRaw,CPUTimeRAW,NodeList,Start,End",
	];
}

async function waitForAccounting(input: {
	slurmId: string;
	expectedJobName: string;
	host: string;
	recorder: RecordingCommandRunner;
	config: CompilerGymCompleteActionSpaceHeadroomRunnerConfig;
	clock: CompilerGymCompleteActionSpaceHeadroomRunnerClock;
	signal: AbortSignal;
}): Promise<{ accounting: CompilerGymCompleteActionSpaceHeadroomAccounting; sequences: number[] }> {
	const started = input.clock.monotonicNs();
	const sequences: number[] = [];
	while (true) {
		sequences.push(input.recorder.nextSequence());
		const result = await input.recorder.run({
			argv: compilerGymWarmSshArgv(input.host, sacctArgv(input.slurmId)),
			signal: input.signal,
			timeoutMs: input.config.commandTimeoutMs,
			maxOutputBytes: 1024 * 1024,
		});
		if (result.exitCode !== 0 || result.stderr !== "") throw new Error("sacct failed or emitted stderr");
		if (result.stdout.trim()) {
			try {
				return {
					accounting: parseCompilerGymCompleteActionSpaceHeadroomAccounting(
						result.stdout,
						input.slurmId,
						input.expectedJobName,
					),
					sequences,
				};
			} catch (error) {
				if (!(error instanceof AccountingPendingError)) throw error;
			}
		}
		if (Number(input.clock.monotonicNs() - started) / 1_000_000 >= input.config.accountingTimeoutMs) {
			throw new Error(`Timed out waiting for sacct ${input.slurmId}`);
		}
		await input.clock.sleep(input.config.accountingPollMs, input.signal);
	}
}

interface SchedulerNameRow {
	jobId: string;
	jobName: string;
	state: string;
}

interface AccountingNameRow {
	jobId: string;
	jobName: string;
	state: string;
	exitCode: string;
}

function schedulerNameArgv(jobName: string): [string, ...string[]] {
	if (!/^[A-Za-z0-9._-]+$/.test(jobName)) throw new Error("Invalid deterministic Slurm job name");
	return ["/usr/bin/squeue", "--noheader", "--user", FARM_USER, "--name", jobName, "--format=%A|%j|%T"];
}

function parseSchedulerNameRows(stdout: string, expectedJobName: string): SchedulerNameRow[] {
	const rows = stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line): SchedulerNameRow => {
			const fields = line.split("|");
			if (fields.at(-1) === "") fields.pop();
			if (fields.length !== 3) throw new Error("squeue job-name row has an unexpected field count");
			const [jobId, jobName, state] = fields;
			if (!SLURM_ID_PATTERN.test(jobId) || jobName !== expectedJobName || !state) {
				throw new Error("squeue job-name row escaped its exact identity seal");
			}
			return { jobId, jobName, state };
		});
	if (new Set(rows.map((row) => row.jobId)).size !== rows.length) {
		throw new Error("squeue returned duplicate root job IDs");
	}
	if (rows.length > 1) throw new Error("Deterministic Slurm job name is not unique in squeue");
	return rows;
}

function accountingNameArgv(jobName: string): [string, ...string[]] {
	if (!/^[A-Za-z0-9._-]+$/.test(jobName)) throw new Error("Invalid deterministic Slurm job name");
	return [
		"/usr/bin/sacct",
		"-X",
		"--user",
		FARM_USER,
		"--name",
		jobName,
		"--starttime=now-7days",
		"--noheader",
		"--parsable2",
		"--format=JobIDRaw,JobName,State,ExitCode",
	];
}

function parseAccountingNameRows(stdout: string, expectedJobName: string): AccountingNameRow[] {
	const rows = stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line): AccountingNameRow => {
			const fields = line.split("|");
			if (fields.at(-1) === "") fields.pop();
			if (fields.length !== 4) throw new Error("sacct job-name row has an unexpected field count");
			const [jobId, jobName, stateRaw, exitCode] = fields;
			const state = normalizeSlurmState(stateRaw);
			if (!SLURM_ID_PATTERN.test(jobId) || jobName !== expectedJobName || !state || !exitCode) {
				throw new Error("sacct job-name row escaped its exact root identity seal");
			}
			return { jobId, jobName, state, exitCode };
		});
	if (new Set(rows.map((row) => row.jobId)).size !== rows.length) {
		throw new Error("sacct returned duplicate root job IDs for the deterministic name");
	}
	return rows;
}

async function querySchedulerName(input: {
	host: string;
	jobName: string;
	recorder: RecordingCommandRunner;
	config: CompilerGymCompleteActionSpaceHeadroomRunnerConfig;
	signal: AbortSignal;
}): Promise<{ rows: SchedulerNameRow[]; sequence: number }> {
	const sequence = input.recorder.nextSequence();
	const result = await input.recorder.run({
		argv: compilerGymWarmSshArgv(input.host, schedulerNameArgv(input.jobName)),
		signal: input.signal,
		timeoutMs: input.config.commandTimeoutMs,
		maxOutputBytes: 1024 * 1024,
	});
	if (result.exitCode !== 0 || result.stderr !== "") throw new Error("squeue job-name query failed or emitted stderr");
	return { rows: parseSchedulerNameRows(result.stdout, input.jobName), sequence };
}

async function queryAccountingName(input: {
	host: string;
	jobName: string;
	recorder: RecordingCommandRunner;
	config: CompilerGymCompleteActionSpaceHeadroomRunnerConfig;
	signal: AbortSignal;
}): Promise<{ rows: AccountingNameRow[]; sequence: number }> {
	const sequence = input.recorder.nextSequence();
	const result = await input.recorder.run({
		argv: compilerGymWarmSshArgv(input.host, accountingNameArgv(input.jobName)),
		signal: input.signal,
		timeoutMs: input.config.commandTimeoutMs,
		maxOutputBytes: 1024 * 1024,
	});
	if (result.exitCode !== 0 || result.stderr !== "") throw new Error("sacct job-name query failed or emitted stderr");
	return { rows: parseAccountingNameRows(result.stdout, input.jobName), sequence };
}

interface FailureCleanupEvidence {
	preDispatchAccountingIds: string[];
	discoveredJobId: string | null;
	cancelCommandSequence: number | null;
	squeueCommandSequences: number[];
	accountingCommandSequences: number[];
	terminalAccounting: AccountingNameRow | null;
	schedulerAbsent: true;
}

const TERMINAL_ACCOUNTING_STATES = new Set([
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

async function cleanupFailedDispatch(input: {
	host: string;
	jobName: string;
	preDispatchAccountingIds: ReadonlySet<string>;
	recorder: RecordingCommandRunner;
	config: CompilerGymCompleteActionSpaceHeadroomRunnerConfig;
	clock: CompilerGymCompleteActionSpaceHeadroomRunnerClock;
	signal: AbortSignal;
}): Promise<FailureCleanupEvidence> {
	const squeueCommandSequences: number[] = [];
	const accountingCommandSequences: number[] = [];
	const visibilityStarted = input.clock.monotonicNs();
	let active: SchedulerNameRow | null = null;
	let discoveredAccounting: AccountingNameRow | null = null;
	while (true) {
		const queue = await querySchedulerName(input);
		squeueCommandSequences.push(queue.sequence);
		const accounting = await queryAccountingName(input);
		accountingCommandSequences.push(accounting.sequence);
		const newRows = accounting.rows.filter((row) => !input.preDispatchAccountingIds.has(row.jobId));
		if (newRows.length > 1) {
			throw new Error("Failure cleanup found a non-unique post-dispatch accounting identity");
		}
		active = queue.rows[0] ?? null;
		discoveredAccounting = newRows[0] ?? null;
		if (active && discoveredAccounting && active.jobId !== discoveredAccounting.jobId) {
			throw new Error("Failure cleanup squeue and sacct identities disagree");
		}
		if (active || discoveredAccounting) break;
		if (Number(input.clock.monotonicNs() - visibilityStarted) / 1_000_000 >= input.config.dispatchVisibilityGraceMs) {
			return {
				preDispatchAccountingIds: [...input.preDispatchAccountingIds].sort(),
				discoveredJobId: null,
				cancelCommandSequence: null,
				squeueCommandSequences,
				accountingCommandSequences,
				terminalAccounting: null,
				schedulerAbsent: true,
			};
		}
		await input.clock.sleep(input.config.accountingPollMs, input.signal);
	}

	const discoveredJobId = active?.jobId ?? discoveredAccounting?.jobId;
	if (!discoveredJobId) throw new Error("Failure cleanup lost the discovered Slurm identity");
	let cancelCommandSequence: number | null = null;
	if (!discoveredAccounting || !TERMINAL_ACCOUNTING_STATES.has(discoveredAccounting.state)) {
		cancelCommandSequence = input.recorder.nextSequence();
		const cancelled = await input.recorder.run({
			argv: compilerGymWarmSshArgv(input.host, ["/usr/bin/scancel", "--quiet", discoveredJobId]),
			signal: input.signal,
			timeoutMs: input.config.commandTimeoutMs,
			maxOutputBytes: 1024 * 1024,
		});
		if (cancelled.exitCode !== 0 || cancelled.stderr !== "" || cancelled.stdout !== "") {
			throw new Error("Exact Slurm cleanup cancellation failed or emitted output");
		}
	}

	const cleanupStarted = input.clock.monotonicNs();
	while (true) {
		const queue = await querySchedulerName(input);
		squeueCommandSequences.push(queue.sequence);
		if (queue.rows.length === 0) break;
		if (queue.rows[0]?.jobId !== discoveredJobId) {
			throw new Error("Failure cleanup squeue identity changed during cancellation");
		}
		if (Number(input.clock.monotonicNs() - cleanupStarted) / 1_000_000 >= input.config.accountingTimeoutMs) {
			throw new Error("Timed out waiting for failed headroom allocation to leave squeue");
		}
		await input.clock.sleep(input.config.accountingPollMs, input.signal);
	}

	let terminalAccounting =
		discoveredAccounting && TERMINAL_ACCOUNTING_STATES.has(discoveredAccounting.state) ? discoveredAccounting : null;
	while (true) {
		if (terminalAccounting) break;
		const accounting = await queryAccountingName(input);
		accountingCommandSequences.push(accounting.sequence);
		const newRows = accounting.rows.filter((row) => !input.preDispatchAccountingIds.has(row.jobId));
		if (newRows.length > 1) {
			throw new Error("Failure cleanup found a non-unique post-dispatch accounting identity");
		}
		const row = newRows[0] ?? null;
		if (row && row.jobId !== discoveredJobId) {
			throw new Error("Failure cleanup squeue and sacct identities disagree");
		}
		if (row && TERMINAL_ACCOUNTING_STATES.has(row.state)) {
			terminalAccounting = row;
			break;
		}
		if (Number(input.clock.monotonicNs() - cleanupStarted) / 1_000_000 >= input.config.accountingTimeoutMs) {
			throw new Error("Timed out waiting for terminal accounting after failed headroom dispatch");
		}
		await input.clock.sleep(input.config.accountingPollMs, input.signal);
	}
	if (!terminalAccounting) {
		throw new Error("Failure cleanup lacks terminal accounting for the discovered Slurm allocation");
	}
	return {
		preDispatchAccountingIds: [...input.preDispatchAccountingIds].sort(),
		discoveredJobId,
		cancelCommandSequence,
		squeueCommandSequences,
		accountingCommandSequences,
		terminalAccounting,
		schedulerAbsent: true,
	};
}

function slurmIdFromResult(value: unknown): string {
	const environment = record(record(value, "evaluator result").environment, "evaluator result.environment");
	const slurmId = environment.slurm_job_id;
	if (typeof slurmId !== "string" || !SLURM_ID_PATTERN.test(slurmId)) {
		throw new Error("Evaluator result lacks a valid root Slurm ID");
	}
	return slurmId;
}

export interface CompilerGymCompleteActionSpaceHeadroomRunnerResult {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_PROTOCOL;
	admission: "terminal-complete-ledger-event";
	disposition: "headroom-demonstrated" | "headroom-not-demonstrated";
	preregistrationSha256: string;
	scientificDispatchSha256: string;
	sourceClosureSha256: string;
	headroomProtocolSha256: string;
	modelCalls: 0;
	providerCalls: 0;
	gpuAllocations: 0;
	cpuAllocations: 1;
	evaluatorTasks: 1;
	cpusPerTask: 1;
	evaluatorCpuMinutesMaximum: 10;
	taskWallMinutesMaximum: 10;
	schedulerLogicalCpusPerAllocation: 2;
	schedulerLogicalCpuMinutesMaximum: 20;
	dispatchAttempts: 1;
	allocationRetries: 0;
	environmentProbe: {
		sealScope: "frozen-operational-not-byte-complete-python-tree";
		preflightCommandSequence: number;
		postflightCommandSequence: number;
		stdoutSha256: string;
	};
	allocation: {
		commandSequence: number;
		remoteArgv: string[];
		outerArgv: string[];
		requestSha256: string;
		stdout: ArtifactRef;
		stderr: ArtifactRef;
		slurmId: string;
		accountingCommandSequences: number[];
		accounting: CompilerGymCompleteActionSpaceHeadroomAccounting;
	};
	assessment: CompilerGymCompleteActionSpaceResultAssessment;
	squeueAbsenceCommandSequence: number;
	ledger: {
		path: string;
		eventCount: number;
		terminalEventHash: string;
		admissionPayloadSha256: string;
	};
}

export class CompilerGymCompleteActionSpaceHeadroomRunner {
	private readonly clock: CompilerGymCompleteActionSpaceHeadroomRunnerClock;
	private readonly commandRunner: CompilerGymWarmCommandRunner;

	constructor(
		private readonly config: CompilerGymCompleteActionSpaceHeadroomRunnerConfig,
		private readonly dependencies: CompilerGymCompleteActionSpaceHeadroomRunnerDependencies = {},
	) {
		this.clock = dependencies.clock ?? new SystemCompilerGymCompleteActionSpaceHeadroomRunnerClock();
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
	}

	async run(): Promise<CompilerGymCompleteActionSpaceHeadroomRunnerResult> {
		if (
			this.config.commandTimeoutMs !==
				DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS.commandTimeoutMs ||
			this.config.accountingTimeoutMs !==
				DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS.accountingTimeoutMs ||
			this.config.accountingPollMs !==
				DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS.accountingPollMs ||
			this.config.dispatchVisibilityGraceMs !==
				DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS.dispatchVisibilityGraceMs
		) {
			throw new Error("Headroom runner timing limits must match the frozen one-shot contract");
		}
		const repoRoot = resolve(this.config.repoRoot);
		const preregistrationPath = resolve(this.config.preregistrationPath);
		const outputPath = resolve(this.config.outputPath);
		if (preregistrationPath === outputPath || outputPath === resolve("/") || preregistrationPath === resolve("/")) {
			throw new Error("Preregistration and output paths must be distinct non-root paths");
		}
		const built = await buildPreregistration(repoRoot);
		const preregistrationContents = await writeExclusiveCanonical(preregistrationPath, built.preregistration);
		const preregistrationSha256 = sha256Text(preregistrationContents);
		await assertPathAbsent(outputPath, "Headroom terminal output");
		const outputReservationPath = `${outputPath}.reservation`;
		const outputReservationContents = await writeExclusiveCanonical(outputReservationPath, {
			schemaVersion: 1,
			protocol: "compiler-gym-complete-action-space-headroom-output-reservation-v1",
			preregistrationSha256,
			outputPath,
		});
		const evidenceRoot = `${outputPath}.evidence`;
		await mkdir(dirname(evidenceRoot), { recursive: true, mode: 0o700 });
		await mkdir(evidenceRoot, { mode: 0o700 });

		const lockRoot = resolve(this.config.dispatchLockRoot ?? join(repoRoot, ".autoresearch", "attempt-locks"));
		await mkdir(lockRoot, { recursive: true, mode: 0o700 });
		const lockPath = join(
			lockRoot,
			`complete-action-space-headroom-${built.preregistration.scientificDispatchSha256}.lock`,
		);

		const ledgerPath = join(evidenceRoot, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(ledgerPath);
		if (ledger.getEvents().length !== 0) throw new Error("Headroom ledger must start empty");
		const artifactStore = new ArtifactStore(join(evidenceRoot, "artifacts"));
		const recorder = new RecordingCommandRunner(this.commandRunner, artifactStore, ledger, this.clock);
		const remoteFileSystem =
			this.dependencies.remoteFileSystem ??
			new SshCompilerGymWarmRemoteFileSystem(
				recorder,
				"farmshare",
				"/usr/bin/python3",
				this.config.commandTimeoutMs,
			);
		const signal = new AbortController().signal;
		let terminalComplete = false;
		let srunDispatchCount = 0;
		let preDispatchAccountingIds = new Set<string>();
		try {
			await assertPrivateRegularFile(preregistrationPath, preregistrationContents, "Headroom preregistration");
			await assertPrivateRegularFile(
				outputReservationPath,
				outputReservationContents,
				"Headroom output reservation",
			);
			await assertPathAbsent(outputPath, "Headroom terminal output");
			await verifyLocalClosure(repoRoot, built.preregistration);
			await ledger.append("run_manifest", {
				type: "complete_action_space_headroom",
				phase: "start",
				protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_PROTOCOL,
				preregistrationSha256,
				scientificDispatchSha256: built.preregistration.scientificDispatchSha256,
				sourceClosureSha256: built.preregistration.sourceClosureSha256,
				modelCalls: 0,
				providerCalls: 0,
				gpuAllocations: 0,
			});

			await ensurePrivateDirectoryTree(remoteFileSystem, built.protocol.execution.sourceDirectory, signal);
			for (const source of built.protocol.execution.sources) {
				const content = built.sourceContents.get(source.localPath);
				if (content === undefined || sha256Text(content) !== source.sha256) {
					throw new Error(`Local source binding drifted for ${source.localPath}`);
				}
				const remotePath = posix.join(built.protocol.execution.sourceDirectory, source.remoteName);
				await remoteFileSystem.installImmutableFile(remotePath, content, source.sha256, 0o600, true, signal);
				const readback = await remoteFileSystem.readTrustedFile(
					remotePath,
					{ maxBytes: Buffer.byteLength(content), mode: 0o600, expectedSha256: source.sha256 },
					signal,
				);
				if (readback !== content) throw new Error(`Remote source readback drifted for ${source.remoteName}`);
				await ledger.append("run_manifest", {
					type: "complete_action_space_remote_source",
					remotePath,
					sha256: source.sha256,
					byteLength: Buffer.byteLength(content),
					readbackSha256: sha256Text(readback),
				});
			}

			const probeSource = built.sourceContents.get(ENVIRONMENT_PROBE_PATH);
			if (!probeSource) throw new Error("Environment probe source is absent from the closure");
			const probeDirectory = posix.join(REMOTE_PROBE_ROOT, ENVIRONMENT_PROBE_SHA256);
			const probeRemotePath = posix.join(probeDirectory, "compiler_gym_env_probe.py");
			await ensurePrivateDirectoryTree(remoteFileSystem, probeDirectory, signal);
			await remoteFileSystem.installImmutableFile(
				probeRemotePath,
				probeSource,
				ENVIRONMENT_PROBE_SHA256,
				0o600,
				true,
				signal,
			);
			const probeReadback = await remoteFileSystem.readTrustedFile(
				probeRemotePath,
				{ maxBytes: Buffer.byteLength(probeSource), mode: 0o600, expectedSha256: ENVIRONMENT_PROBE_SHA256 },
				signal,
			);
			if (probeReadback !== probeSource) throw new Error("Remote environment-probe readback drifted");

			const probeOuterArgv = compilerGymWarmSshArgv("farmshare", environmentProbeArgv(probeRemotePath));
			const preflightCommandSequence = recorder.nextSequence();
			const preflight = await recorder.run({
				argv: probeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			const probeStdoutSha256 = parseEnvironmentProbe(preflight);
			await ledger.append("run_manifest", {
				type: "complete_action_space_environment_probe",
				phase: "preflight",
				commandSequence: preflightCommandSequence,
				sourceSha256: ENVIRONMENT_PROBE_SHA256,
				stdoutSha256: probeStdoutSha256,
			});
			const preDispatchQueue = await querySchedulerName({
				host: "farmshare",
				jobName: built.protocol.execution.jobName,
				recorder,
				config: this.config,
				signal,
			});
			if (preDispatchQueue.rows.length !== 0) {
				throw new Error("Deterministic headroom job name is already active before dispatch");
			}
			const preDispatchAccounting = await queryAccountingName({
				host: "farmshare",
				jobName: built.protocol.execution.jobName,
				recorder,
				config: this.config,
				signal,
			});
			preDispatchAccountingIds = new Set(preDispatchAccounting.rows.map((row) => row.jobId));
			if (preDispatchAccountingIds.size !== 0) {
				throw new Error("Deterministic headroom job name already has accounting history in the frozen window");
			}
			await ledger.append("run_manifest", {
				type: "complete_action_space_pre_dispatch_scheduler_seal",
				jobName: built.protocol.execution.jobName,
				squeueCommandSequence: preDispatchQueue.sequence,
				accountingCommandSequence: preDispatchAccounting.sequence,
				preExistingAccountingIds: [...preDispatchAccountingIds].sort(),
				activeJobs: 0,
			});

			await assertPrivateRegularFile(preregistrationPath, preregistrationContents, "Headroom preregistration");
			await verifyLocalClosure(repoRoot, built.preregistration);
			const requestBytes = exactCanonicalLine(built.protocol.request);
			if (sha256Text(requestBytes) !== built.protocol.execution.stdinSha256) {
				throw new Error("Frozen evaluator stdin bytes drifted");
			}
			if (srunDispatchCount !== 0) throw new Error("Headroom srun was already dispatched");
			const lockBody = {
				schemaVersion: 1,
				protocol: "compiler-gym-complete-action-space-headroom-dispatch-attempt-v1",
				preregistrationSha256,
				scientificDispatchSha256: built.preregistration.scientificDispatchSha256,
				attemptOrdinal: 1,
				allocationRetries: 0,
				attemptedAt: this.clock.now().toISOString(),
				outputPath,
			};
			const lock = { ...lockBody, recordSha256: sha256Json(lockBody) };
			const lockContents = await writeExclusiveCanonical(lockPath, lock);
			srunDispatchCount++;
			const remoteArgv = [...built.protocol.execution.argv] as [string, ...string[]];
			const outerArgv = compilerGymWarmSshArgv("farmshare", remoteArgv);
			const allocationCommandSequence = recorder.nextSequence();
			const allocationResult = await recorder.run({
				argv: outerArgv,
				input: requestBytes,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
			});
			if (allocationResult.exitCode !== 0) {
				throw new Error(`Headroom evaluator exited ${String(allocationResult.exitCode)}`);
			}
			const evaluatorResult = parseStrictJsonLine(allocationResult.stdout, "headroom evaluator stdout");
			const assessment = assessCompilerGymCompleteActionSpaceResult(evaluatorResult, built.protocol);
			if (
				!assessment.apparatusCompleted ||
				(assessment.status !== "passed" && assessment.status !== "headroom_not_demonstrated")
			) {
				throw new Error(
					"Headroom evaluator did not reach a terminally admissible passed or verified-negative result",
				);
			}
			const slurmId = slurmIdFromResult(evaluatorResult);
			const accountingResult = await waitForAccounting({
				slurmId,
				expectedJobName: built.protocol.execution.jobName,
				host: "farmshare",
				recorder,
				config: this.config,
				clock: this.clock,
				signal,
			});
			const allocationEvidence = recorder.record(allocationCommandSequence);
			if (!allocationEvidence.stdout || !allocationEvidence.stderr) {
				throw new Error("Raw allocation streams were not stored as artifacts");
			}
			await ledger.append("measurement", {
				type: "complete_action_space_headroom_allocation",
				commandSequence: allocationCommandSequence,
				remoteArgv,
				outerArgv,
				requestSha256: sha256Text(requestBytes),
				stdout: allocationEvidence.stdout,
				stderr: allocationEvidence.stderr,
				slurmId,
				accountingCommandSequences: accountingResult.sequences,
				accounting: accountingResult.accounting,
				assessment,
			});

			const postflightCommandSequence = recorder.nextSequence();
			const postflight = await recorder.run({
				argv: probeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			if (parseEnvironmentProbe(postflight) !== probeStdoutSha256 || postflight.stdout !== preflight.stdout) {
				throw new Error("Postflight environment probe differs from preflight");
			}
			await ledger.append("run_manifest", {
				type: "complete_action_space_environment_probe",
				phase: "postflight",
				commandSequence: postflightCommandSequence,
				sourceSha256: ENVIRONMENT_PROBE_SHA256,
				stdoutSha256: probeStdoutSha256,
			});

			const squeueAbsence = await querySchedulerName({
				host: "farmshare",
				jobName: built.protocol.execution.jobName,
				recorder,
				config: this.config,
				signal,
			});
			const squeueAbsenceCommandSequence = squeueAbsence.sequence;
			if (squeueAbsence.rows.length !== 0) {
				throw new Error("Measured Slurm allocation remains visible in squeue");
			}
			await ledger.append("run_manifest", {
				type: "complete_action_space_squeue_absence",
				commandSequence: squeueAbsenceCommandSequence,
				slurmId,
				schedulerAbsent: true,
			});

			if (srunDispatchCount !== 1) throw new Error("Headroom runner did not execute exactly one srun");
			await assertPrivateRegularFile(preregistrationPath, preregistrationContents, "Headroom preregistration");
			await assertPrivateRegularFile(lockPath, lockContents, "Headroom dispatch-attempt lock");
			await assertPrivateRegularFile(
				outputReservationPath,
				outputReservationContents,
				"Headroom output reservation",
			);
			await assertPathAbsent(outputPath, "Headroom terminal output");
			await verifyLocalClosure(repoRoot, built.preregistration);
			for (const artifact of recorder.artifacts) await artifactStore.readString(artifact);
			const admissionPayload = {
				schemaVersion: 1 as const,
				protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_PROTOCOL,
				admission: "terminal-complete-ledger-event" as const,
				disposition:
					assessment.status === "passed"
						? ("headroom-demonstrated" as const)
						: ("headroom-not-demonstrated" as const),
				preregistrationSha256,
				scientificDispatchSha256: built.preregistration.scientificDispatchSha256,
				sourceClosureSha256: built.preregistration.sourceClosureSha256,
				headroomProtocolSha256: built.preregistration.headroomProtocolSha256,
				modelCalls: 0 as const,
				providerCalls: 0 as const,
				gpuAllocations: 0 as const,
				cpuAllocations: 1 as const,
				evaluatorTasks: 1 as const,
				cpusPerTask: 1 as const,
				evaluatorCpuMinutesMaximum: 10 as const,
				taskWallMinutesMaximum: 10 as const,
				schedulerLogicalCpusPerAllocation: 2 as const,
				schedulerLogicalCpuMinutesMaximum: 20 as const,
				dispatchAttempts: 1 as const,
				allocationRetries: 0 as const,
				environmentProbe: {
					sealScope: "frozen-operational-not-byte-complete-python-tree" as const,
					preflightCommandSequence,
					postflightCommandSequence,
					stdoutSha256: probeStdoutSha256,
				},
				allocation: {
					commandSequence: allocationCommandSequence,
					remoteArgv,
					outerArgv,
					requestSha256: sha256Text(requestBytes),
					stdout: allocationEvidence.stdout,
					stderr: allocationEvidence.stderr,
					slurmId,
					accountingCommandSequences: accountingResult.sequences,
					accounting: accountingResult.accounting,
				},
				assessment,
				squeueAbsenceCommandSequence,
			};
			const admissionPayloadSha256 = sha256Json(admissionPayload);
			await ledger.append("claim", {
				type: "complete_action_space_headroom_assessment",
				admissionPayloadSha256,
				disposition: admissionPayload.disposition,
				assessment,
			});
			const terminal = await ledger.append("run_manifest", {
				type: "complete_action_space_headroom",
				phase: "complete",
				protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_PROTOCOL,
				preregistrationSha256,
				admissionPayloadSha256,
				allocationCount: 1,
				dispatchAttempts: 1,
				allocationRetries: 0,
				modelCalls: 0,
				providerCalls: 0,
				gpuAllocations: 0,
			});
			ledger.verify();
			const ledgerContents = await readFile(ledgerPath, "utf8");
			const ledgerEvents = verifyLedgerContentsStrict(ledgerContents);
			if (ledgerEvents.at(-1)?.hash !== terminal.hash)
				throw new Error("Complete event is not terminal in the ledger");
			const result: CompilerGymCompleteActionSpaceHeadroomRunnerResult = {
				...admissionPayload,
				ledger: {
					path: ledgerPath,
					eventCount: ledgerEvents.length,
					terminalEventHash: terminal.hash,
					admissionPayloadSha256,
				},
			};
			await writeExclusiveCanonical(outputPath, result);
			terminalComplete = true;
			return result;
		} catch (error) {
			let cleanup: FailureCleanupEvidence | null = null;
			let cleanupError: unknown = null;
			if (srunDispatchCount === 1) {
				try {
					cleanup = await cleanupFailedDispatch({
						host: "farmshare",
						jobName: built.protocol.execution.jobName,
						preDispatchAccountingIds,
						recorder,
						config: this.config,
						clock: this.clock,
						signal,
					});
					await ledger.append("run_manifest", {
						type: "complete_action_space_failure_cleanup",
						jobName: built.protocol.execution.jobName,
						status: "cleanup-proved",
						...cleanup,
					});
				} catch (cleanupFailure) {
					cleanupError = cleanupFailure;
					await ledger.append("run_manifest", {
						type: "complete_action_space_failure_cleanup",
						jobName: built.protocol.execution.jobName,
						status: "cleanup-proof-failed",
						error:
							cleanupFailure instanceof Error
								? (cleanupFailure.stack ?? cleanupFailure.message)
								: String(cleanupFailure),
					});
				}
			}
			if (!terminalComplete) {
				await ledger.append("run_manifest", {
					type: "complete_action_space_headroom",
					phase: "failed",
					protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_PROTOCOL,
					preregistrationSha256,
					dispatchAttempts: srunDispatchCount,
					allocationRetries: 0,
					failureDisposition: "terminal-apparatus-invalid",
					cleanup,
					cleanupProofPassed: srunDispatchCount === 0 || cleanup !== null,
					error: error instanceof Error ? (error.stack ?? error.message) : String(error),
				});
			}
			if (cleanupError) {
				throw new AggregateError([error, cleanupError], "Headroom dispatch failed and cleanup could not be proved");
			}
			throw error;
		}
	}
}

function parseOptions(argv: readonly string[]): { preregistrationPath: string; outputPath: string } {
	if (argv.length !== 4) {
		throw new Error(
			"Usage: compiler-gym-complete-action-space-headroom-runner --preregistration <new-path> --output <new-path>",
		);
	}
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if ((flag !== "--preregistration" && flag !== "--output") || !value || values.has(flag)) {
			throw new Error("Headroom runner options are invalid or duplicated");
		}
		values.set(flag, value);
	}
	const preregistrationPath = values.get("--preregistration");
	const outputPath = values.get("--output");
	if (!preregistrationPath || !outputPath || !basename(preregistrationPath) || !basename(outputPath)) {
		throw new Error("Both explicit preregistration and output paths are required");
	}
	return { preregistrationPath, outputPath };
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const runner = new CompilerGymCompleteActionSpaceHeadroomRunner({
		repoRoot,
		preregistrationPath: options.preregistrationPath,
		outputPath: options.outputPath,
		...DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS,
	});
	process.stdout.write(exactCanonicalLine(await runner.run()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

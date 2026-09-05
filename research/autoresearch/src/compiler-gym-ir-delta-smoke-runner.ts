import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "./compiler-gym-adapter.js";
import {
	buildCompilerGymIrDeltaSmokePreregistration,
	COMPILER_GYM_IR_DELTA_BENCHMARK,
	COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT,
	COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS,
	COMPILER_GYM_IR_DELTA_SMOKE_ID,
	COMPILER_GYM_IR_DELTA_SMOKE_PREREGISTRATION_PROTOCOL,
	COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
	type CompilerGymIrDeltaSmokeArm,
	type CompilerGymIrDeltaSmokeEnvironment,
	type CompilerGymIrDeltaSmokeExecutionSpec,
	type CompilerGymIrDeltaSmokePreregistration,
	parseCompilerGymIrDeltaSmokePreregistration,
} from "./compiler-gym-ir-delta-smoke-preregistration.js";
import {
	assessCompilerGymIrDeltaSmoke,
	COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL,
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
	type CompilerGymIrDeltaSmokeAssessment,
	type CompilerGymIrDeltaSmokeBlock,
	type CompilerGymIrDeltaTrace,
} from "./compiler-gym-ir-delta-smoke-protocol.js";
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

const RUNNER_PROTOCOL = "compiler-gym-one-env-ir-delta-smoke-runner-v1" as const;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;
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

export interface CompilerGymIrDeltaSmokeRunnerConfig {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	commandTimeoutMs: number;
	accountingTimeoutMs: number;
	accountingPollMs: number;
	dispatchLockRoot?: string;
}

export const DEFAULT_COMPILER_GYM_IR_DELTA_SMOKE_RUNNER_LIMITS = {
	commandTimeoutMs: 6 * 60_000,
	accountingTimeoutMs: 2 * 60_000,
	accountingPollMs: 1_000,
} as const;

export interface CompilerGymIrDeltaSmokeRunnerClock {
	now(): Date;
	monotonicNs(): bigint;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export class SystemCompilerGymIrDeltaSmokeRunnerClock implements CompilerGymIrDeltaSmokeRunnerClock {
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
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", abort);
				resolveSleep();
			};
			const timer = setTimeout(finish, ms);
			const abort = (): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}

export interface CompilerGymIrDeltaHistoricalEvidenceVerifier {
	verify(preregistration: CompilerGymIrDeltaSmokePreregistration, repoRoot: string): Promise<void>;
}

class LocalHistoricalEvidenceVerifier implements CompilerGymIrDeltaHistoricalEvidenceVerifier {
	async verify(preregistration: CompilerGymIrDeltaSmokePreregistration, repoRoot: string): Promise<void> {
		const evidence = preregistration.candidate.sourceEvidence;
		const contents = await readFile(resolve(repoRoot, evidence.ledgerPath), "utf8");
		if (sha256Text(contents) !== evidence.ledgerSha256) throw new Error("L46 historical ledger hash mismatch");
		const events = verifyLedgerContentsStrict(contents);
		for (const expected of [evidence.proposalEventSha256, evidence.measurementEventSha256]) {
			if (!events.some((event) => event.hash === expected))
				throw new Error(`L46 historical event ${expected} is absent`);
		}
	}
}

export interface CompilerGymIrDeltaSmokeRunnerDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	clock?: CompilerGymIrDeltaSmokeRunnerClock;
	historicalEvidenceVerifier?: CompilerGymIrDeltaHistoricalEvidenceVerifier;
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

	constructor(
		private readonly delegate: CompilerGymWarmCommandRunner,
		private readonly artifactStore: ArtifactStore,
		private readonly ledger: EvidenceLedger,
		private readonly clock: CompilerGymIrDeltaSmokeRunnerClock,
	) {}

	nextSequence(): number {
		return this.sequence;
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
			const finishedMonotonicNs = this.clock.monotonicNs();
			const evidence: CommandEvidence = {
				sequence,
				argv: [...request.argv],
				argvSha256: sha256Json(request.argv),
				input,
				startedAt,
				finishedAt: this.clock.now().toISOString(),
				startedMonotonicNs: startedMonotonicNs.toString(),
				finishedMonotonicNs: finishedMonotonicNs.toString(),
				exitCode: result?.exitCode ?? null,
				wallMs: result?.wallMs ?? null,
				stdout,
				stderr,
				error: errorText,
			};
			await this.ledger.append("run_manifest", {
				type: "ir_delta_smoke_command",
				protocol: RUNNER_PROTOCOL,
				...evidence,
			});
		}
	}

	async store(content: string, mediaType: string): Promise<ArtifactRef> {
		const artifact = await this.artifactStore.putString(content, mediaType);
		this.artifacts.push(artifact);
		return artifact;
	}
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a nonempty string`);
	return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error(`${path} must be a nonnegative safe integer`);
	return value;
}

function safeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
	return value;
}

function positiveNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
		throw new Error(`${path} must be finite and positive`);
	return value;
}

function nonnegativeNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		throw new Error(`${path} must be finite and nonnegative`);
	return value;
}

function singleJsonLine(stdout: string, path: string): unknown {
	if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n"))
		throw new Error(`${path} must be exactly one newline-terminated JSON line`);
	return JSON.parse(stdout.slice(0, -1)) as unknown;
}

function stringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
		throw new Error(`${path} must be a string array`);
	return [...value];
}

function integerArray(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an integer array`);
	return value.map((item, index) => nonnegativeInteger(item, `${path}[${index}]`));
}

function assertNoForbiddenTraceMetadata(value: unknown, path = "result"): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenTraceMetadata(item, `${path}[${index}]`);
		}
		return;
	}
	if (typeof value !== "object" || value === null) return;
	for (const [key, item] of Object.entries(value)) {
		if (key === "action_had_no_effect" || key === "no_effect_bits" || key === "noEffectBits") {
			throw new Error(`${path}.${key} is forbidden pass-reported no-effect metadata`);
		}
		assertNoForbiddenTraceMetadata(item, `${path}.${key}`);
	}
}

interface ParsedEvaluatorResult {
	benchmarkId: typeof COMPILER_GYM_IR_DELTA_BENCHMARK;
	actions: string[];
	actionIndices: number[];
	initialIrInstructionCount: number;
	commandline: string;
	final: { irInstructionCount: number; objectTextSizeBytes: number; verifierPassed: true };
	intrinsicTotalMs: number;
	timingsSeconds: Record<string, number>;
	slurmId: string;
	trace: CompilerGymIrDeltaTrace | null;
}

function exactIntegrity(result: Record<string, unknown>): void {
	const environment = object(result.environment, "result.environment");
	const seal = object(environment.seal, "result.environment.seal");
	if (
		seal.python_version !== "3.10.19" ||
		seal.distribution_manifest_sha256 !== COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256 ||
		seal.compatibility_tree_manifest_sha256 !== COMPILER_GYM_COMPATIBILITY_TREE_SHA256 ||
		seal.libtinfo_sha256 !== COMPILER_GYM_LIBTINFO_SHA256
	)
		throw new Error("Evaluator environment seal differs from the frozen environment");
	const provenance = object(result.provenance, "result.provenance");
	if (
		provenance.upstream_cbench_source_sha256 !== COMPILER_GYM_UPSTREAM_CBENCH_SHA256 ||
		provenance.cbench_patch_sha256 !== COMPILER_GYM_CBENCH_PATCH_SHA256 ||
		provenance.pinned_installed_cbench_source_sha256 !== COMPILER_GYM_INSTALLED_CBENCH_SHA256 ||
		provenance.installed_cbench_source_sha256 !== COMPILER_GYM_INSTALLED_CBENCH_SHA256 ||
		provenance.installed_cbench_source_matches_pin !== true ||
		provenance.farmshare_environment_seal_passed !== true
	)
		throw new Error("Evaluator provenance differs from the frozen verifier");
}

function parseEvaluatorResult(
	stdout: string,
	expected: { arm: CompilerGymIrDeltaSmokeArm; slurmCpusPerTask: "2"; actions: readonly string[] },
): ParsedEvaluatorResult {
	const result = object(singleJsonLine(stdout, "evaluator stdout"), "evaluator result");
	if (result.schema_version !== 2 || result.ok !== true || result.status !== "passed")
		throw new Error("Evaluator did not return a passed schema-v2 result");
	if (expected.arm === "canonical") {
		if (
			result.contract !== COMPILER_GYM_VERIFIER_EPOCH ||
			"terminal_verifier_contract" in result ||
			"action_trace" in result
		) {
			throw new Error("Canonical evaluator contract or output shape drifted");
		}
	} else if (
		result.contract !== COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT ||
		result.terminal_verifier_contract !== COMPILER_GYM_VERIFIER_EPOCH
	) {
		throw new Error("Treatment evaluator does not bind its distinct contract to the canonical verifier epoch");
	}
	if (result.benchmark !== COMPILER_GYM_IR_DELTA_BENCHMARK)
		throw new Error("Evaluator benchmark differs from frozen blowfish");
	const request = object(result.request, "result.request");
	const actions = stringArray(request.actions, "result.request.actions");
	if (request.benchmark !== COMPILER_GYM_IR_DELTA_BENCHMARK || sha256Json(actions) !== sha256Json(expected.actions))
		throw new Error("Evaluator request differs from exact frozen L46/blowfish");
	const actionIndices = integerArray(result.action_indices, "result.action_indices");
	if (actionIndices.length !== actions.length) throw new Error("Evaluator action-index count differs from L46");
	const metrics = object(result.metrics, "result.metrics");
	const initial = object(metrics.initial, "result.metrics.initial");
	const final = object(metrics.final, "result.metrics.final");
	const initialIrInstructionCount = nonnegativeInteger(
		initial.IrInstructionCount,
		"result.metrics.initial.IrInstructionCount",
	);
	const finalIr = nonnegativeInteger(final.IrInstructionCount, "result.metrics.final.IrInstructionCount");
	const finalObject = nonnegativeInteger(final.ObjectTextSizeBytes, "result.metrics.final.ObjectTextSizeBytes");
	const validation = object(result.validation, "result.validation");
	if (
		validation.passed !== true ||
		validation.inputs_expected !== 20 ||
		validation.inputs_completed !== 20 ||
		validation.base_callbacks_selected !== 20 ||
		validation.sanitizer_callbacks_selected !== 0
	)
		throw new Error("Evaluator semantic verification is incomplete");
	const environment = object(result.environment, "result.environment");
	const slurmId = string(environment.slurm_job_id, "result.environment.slurm_job_id");
	if (!SLURM_ID_PATTERN.test(slurmId) || environment.slurm_cpus_per_task !== expected.slurmCpusPerTask)
		throw new Error("Evaluator did not run under the frozen two-CPU Slurm contract");
	exactIntegrity(result);
	const rawTimings = object(result.timings_seconds, "result.timings_seconds");
	if (expected.arm === "one-env-ir-delta" && "shadow_action_trace" in rawTimings) {
		throw new Error("Treatment timings must not contain shadow_action_trace");
	}
	const timingsSeconds: Record<string, number> = {};
	for (const [name, value] of Object.entries(rawTimings))
		timingsSeconds[name] = nonnegativeNumber(value, `result.timings_seconds.${name}`);
	const intrinsicTotalMs = positiveNumber(rawTimings.total, "result.timings_seconds.total") * 1000;
	const commandline = string(result.commandline, "result.commandline");
	let trace: CompilerGymIrDeltaTrace | null = null;
	if (expected.arm === "one-env-ir-delta") {
		assertNoForbiddenTraceMetadata(result);
		const rawTrace = object(result.action_trace, "result.action_trace");
		if (
			rawTrace.contract !== COMPILER_GYM_IR_DELTA_TRACE_CONTRACT ||
			rawTrace.prefix_conditional !== true ||
			rawTrace.intermediate_semantic_status !== "unverified" ||
			rawTrace.terminal_semantic_status !== "canonical-20-input-verifier" ||
			rawTrace.zero_delta_semantics !== COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS ||
			rawTrace.benchmark !== COMPILER_GYM_IR_DELTA_BENCHMARK ||
			sha256Json(rawTrace.actions) !== sha256Json(actions) ||
			sha256Json(rawTrace.action_indices) !== sha256Json(actionIndices)
		)
			throw new Error("Treatment trace binding or semantic disclosure is invalid");
		const traceInitial = nonnegativeInteger(
			rawTrace.initial_ir_instruction_count,
			"result.action_trace.initial_ir_instruction_count",
		);
		if (!Array.isArray(rawTrace.records) || rawTrace.records.length !== actions.length)
			throw new Error("Treatment trace record count differs from L46");
		let deltaSum = 0;
		const records = rawTrace.records.map((value, index) => {
			const item = object(value, `result.action_trace.records[${index}]`);
			const keys = Object.keys(item).sort();
			if (JSON.stringify(keys) !== JSON.stringify(["action", "action_index", "delta_from_previous", "index"]))
				throw new Error(`Treatment trace record ${index} keys drifted`);
			const recordIndex = nonnegativeInteger(item.index, `trace.records[${index}].index`);
			const action = string(item.action, `trace.records[${index}].action`);
			const actionIndex = nonnegativeInteger(item.action_index, `trace.records[${index}].action_index`);
			const deltaFromPrevious = safeInteger(item.delta_from_previous, `trace.records[${index}].delta_from_previous`);
			if (recordIndex !== index || action !== actions[index] || actionIndex !== actionIndices[index])
				throw new Error(`Treatment trace record ${index} is not bound to L46 order`);
			deltaSum += deltaFromPrevious;
			if (!Number.isSafeInteger(deltaSum)) throw new Error("Treatment trace delta sum is not safe");
			return { index: recordIndex, action, actionIndex, deltaFromPrevious };
		});
		if (traceInitial + deltaSum !== finalIr) throw new Error("Treatment trace does not telescope to terminal IR");
		trace = { initialIrInstructionCount: traceInitial, records };
	}
	return {
		benchmarkId: COMPILER_GYM_IR_DELTA_BENCHMARK,
		actions,
		actionIndices,
		initialIrInstructionCount,
		commandline,
		final: { irInstructionCount: finalIr, objectTextSizeBytes: finalObject, verifierPassed: true },
		intrinsicTotalMs,
		timingsSeconds,
		slurmId,
		trace,
	};
}

export interface CompilerGymIrDeltaAccounting {
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

export function parseCompilerGymIrDeltaAccounting(stdout: string): CompilerGymIrDeltaAccounting {
	const lines = stdout.trim().split("\n").filter(Boolean);
	if (lines.length !== 1) throw new Error("sacct must return exactly one root allocation row");
	const fields = lines[0].split("|");
	if (fields.at(-1) === "") fields.pop();
	if (fields.length !== 11) throw new Error("sacct row has an unexpected field count");
	const [jobIdRaw, jobName, state, exitCode, allocCpus, nTasks, elapsedRaw, cpuTimeRaw, nodeList, startAt, endAt] =
		fields;
	if (!SLURM_ID_PATTERN.test(jobIdRaw)) throw new Error("sacct JobIDRaw is invalid");
	const integer = (value: string, path: string): number => {
		if (!/^[0-9]+$/.test(value)) throw new Error(`sacct ${path} is not an integer`);
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed)) throw new Error(`sacct ${path} is not a safe integer`);
		return parsed;
	};
	const parsedAllocCpus = integer(allocCpus, "AllocCPUS");
	const parsedElapsed = integer(elapsedRaw, "ElapsedRaw");
	const parsedCpuTime = integer(cpuTimeRaw, "CPUTimeRAW");
	const expectedCpuTime = parsedAllocCpus * parsedElapsed;
	if (!Number.isSafeInteger(expectedCpuTime)) {
		throw new Error("sacct AllocCPUS multiplied by ElapsedRaw is not a safe integer");
	}
	if (parsedCpuTime !== expectedCpuTime)
		throw new Error("sacct CPUTimeRAW must equal AllocCPUS multiplied by ElapsedRaw");
	return {
		jobIdRaw,
		jobName: string(jobName, "sacct jobName"),
		state: string(state, "sacct state"),
		exitCode: string(exitCode, "sacct exitCode"),
		allocCpus: parsedAllocCpus,
		nTasks: nTasks === "" ? null : integer(nTasks, "NTasks"),
		elapsedRawSeconds: parsedElapsed,
		cpuTimeRawSeconds: parsedCpuTime,
		nodeList: string(nodeList, "sacct nodeList"),
		startAt: string(startAt, "sacct startAt"),
		endAt: string(endAt, "sacct endAt"),
	};
}

function sacctArgv(slurmId: string): [string, ...string[]] {
	if (!SLURM_ID_PATTERN.test(slurmId)) throw new Error("Invalid Slurm ID for sacct");
	return [
		"/usr/bin/sacct",
		"-X",
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
	recorder: RecordingCommandRunner;
	preregistration: CompilerGymIrDeltaSmokePreregistration;
	config: CompilerGymIrDeltaSmokeRunnerConfig;
	clock: CompilerGymIrDeltaSmokeRunnerClock;
	signal: AbortSignal;
}): Promise<{ accounting: CompilerGymIrDeltaAccounting; sequences: number[] }> {
	const started = input.clock.monotonicNs();
	const sequences: number[] = [];
	while (true) {
		sequences.push(input.recorder.nextSequence());
		const result = await input.recorder.run({
			argv: compilerGymWarmSshArgv(input.preregistration.environment.host, sacctArgv(input.slurmId)),
			signal: input.signal,
			timeoutMs: input.config.commandTimeoutMs,
			maxOutputBytes: 1024 * 1024,
		});
		if (result.exitCode !== 0) throw new Error(`sacct failed for ${input.slurmId}: ${result.stderr.trim()}`);
		if (result.stdout.trim()) {
			const accounting = parseCompilerGymIrDeltaAccounting(result.stdout);
			if (accounting.jobIdRaw !== input.slurmId || accounting.jobName !== input.expectedJobName)
				throw new Error("sacct row does not bind the measured allocation");
			if (TERMINAL_STATES.has(accounting.state)) {
				if (
					accounting.state !== "COMPLETED" ||
					accounting.exitCode !== "0:0" ||
					!input.preregistration.environment.acceptedRootAllocCpus.includes(accounting.allocCpus as 2 | 4) ||
					(accounting.nTasks !== null && accounting.nTasks !== 1)
				)
					throw new Error(`Allocation ${input.slurmId} did not complete with frozen resources`);
				return { accounting, sequences };
			}
		}
		if (Number(input.clock.monotonicNs() - started) / 1_000_000 >= input.config.accountingTimeoutMs)
			throw new Error(`Timed out waiting for sacct ${input.slurmId}`);
		await input.clock.sleep(input.config.accountingPollMs, input.signal);
	}
}

function environmentProbeArgv(
	environment: CompilerGymIrDeltaSmokeEnvironment,
	remotePath: string,
): [string, ...string[]] {
	return [
		"/usr/bin/env",
		"-i",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		`LD_LIBRARY_PATH=${environment.compatibilityLibraryDir}`,
		`COMPILER_GYM_CACHE=${environment.compilerGymCache}`,
		`COMPILER_GYM_SITE_DATA=${environment.compilerGymSiteData}`,
		"PYTHONDONTWRITEBYTECODE=1",
		`PYTHONWARNINGS=${environment.pythonWarnings}`,
		environment.pythonPath,
		remotePath,
	];
}

function parseEnvironmentProbe(result: CompilerGymWarmCommandResult): string {
	if (result.exitCode !== 0 || result.stderr !== "")
		throw new Error(`Environment probe failed: ${result.stderr.trim()}`);
	const parsed = singleJsonLine(result.stdout, "environment probe stdout");
	const expected = canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT));
	if (canonicalJson(toJsonValue(parsed)) !== expected || result.stdout !== `${expected}\n`)
		throw new Error("Environment probe does not exactly match the frozen seal");
	return expected;
}

export function compilerGymIrDeltaSrunArgv(input: {
	spec: CompilerGymIrDeltaSmokeExecutionSpec;
	remoteEvaluatorPath: string;
	environment: CompilerGymIrDeltaSmokeEnvironment;
	dispatchNonce: string;
}): { argv: [string, ...string[]]; transientCache: string; jobName: string } {
	if (!/^[0-9a-f]{16}$/.test(input.dispatchNonce)) throw new Error("Dispatch nonce must be 16 lowercase hex digits");
	const arm = input.spec.arm === "canonical" ? "c" : "t";
	const suffix = `${input.spec.allocationOrdinal}-${input.spec.blockId}-${arm}`;
	const transientCache = `/tmp/prime-ir-delta-${input.dispatchNonce}-${suffix}`;
	const jobName = `pid-${suffix}`;
	const argv = [
		"/usr/bin/srun",
		"-p",
		input.environment.partition,
		"-C",
		input.environment.cpuConstraint,
		"--ntasks=1",
		`--cpus-per-task=${input.environment.cpusPerTask}`,
		`--mem=${input.environment.memory}`,
		`--time=${input.environment.timeLimit}`,
		"--kill-on-bad-exit=1",
		"--export=NONE",
		`--job-name=${jobName}`,
		"/usr/bin/env",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		`LD_LIBRARY_PATH=${input.environment.compatibilityLibraryDir}`,
		`COMPILER_GYM_CACHE=${input.environment.compilerGymCache}`,
		`COMPILER_GYM_SITE_DATA=${input.environment.compilerGymSiteData}`,
		`COMPILER_GYM_TRANSIENT_CACHE=${transientCache}`,
		"PYTHONDONTWRITEBYTECODE=1",
		`PYTHONWARNINGS=${input.environment.pythonWarnings}`,
		input.environment.pythonPath,
		input.remoteEvaluatorPath,
	] as [string, ...string[]];
	if (
		argv.some(
			(item) =>
				item.includes("sbatch") ||
				item.startsWith("--jobid") ||
				item.startsWith("--dependency") ||
				item === "--overlap" ||
				item === "--exact",
		)
	)
		throw new Error("Smoke may only use independent stock-cold allocations");
	return { argv, transientCache, jobName };
}

export async function ensureCompilerGymIrDeltaPrivateDirectoryTree(
	remoteFileSystem: Pick<CompilerGymWarmRemoteFileSystem, "ensurePrivateDirectory">,
	directory: string,
	signal: AbortSignal,
): Promise<void> {
	if (!directory.startsWith("/") || posix.normalize(directory) !== directory || directory.endsWith("/"))
		throw new Error("Remote source directory must be absolute and normalized");
	const components = directory.split("/").slice(1);
	if (
		components.length < 5 ||
		(components[0] !== "scratch" && components[0] !== "home") ||
		components[1] !== "users" ||
		!components[2]
	)
		throw new Error("Remote source directory must be under a user storage root");
	let current = `/${components.slice(0, 3).join("/")}`;
	for (const component of components.slice(3)) {
		current = posix.join(current, component);
		await remoteFileSystem.ensurePrivateDirectory(current, signal);
	}
}

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(value))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function verifySources(preregistration: CompilerGymIrDeltaSmokePreregistration, repoRoot: string): Promise<void> {
	const [canonicalSource, treatmentSource, probeSource, closure] = await Promise.all([
		readFile(preregistration.sources.canonicalPath, "utf8"),
		readFile(preregistration.sources.treatmentPath, "utf8"),
		readFile(preregistration.sources.environmentProbePath, "utf8"),
		Promise.all(
			preregistration.implementationClosure.map(async (item) => ({
				relativePath: item.relativePath,
				sha256: sha256Text(await readFile(resolve(repoRoot, item.relativePath), "utf8")),
			})),
		),
	]);
	if (
		sha256Text(canonicalSource) !== preregistration.sources.canonicalSha256 ||
		sha256Text(treatmentSource) !== preregistration.sources.treatmentSha256 ||
		sha256Text(probeSource) !== preregistration.sources.environmentProbeSha256 ||
		canonicalJson(toJsonValue(closure)) !== canonicalJson(toJsonValue(preregistration.implementationClosure))
	)
		throw new Error("Evaluator, probe, or implementation source changed during smoke");
}

export interface CompilerGymIrDeltaAllocationEvidence {
	spec: CompilerGymIrDeltaSmokeExecutionSpec;
	requestSha256: string;
	evaluatorSha256: string;
	remoteArgv: string[];
	outerArgv: string[];
	transientCache: string;
	commandSequence: number;
	slurmId: string;
	accountingCommandSequences: number[];
	accounting: CompilerGymIrDeltaAccounting;
	parsed: ParsedEvaluatorResult;
	stdoutArtifact: ArtifactRef;
	stderrArtifact: ArtifactRef;
}

export interface CompilerGymIrDeltaSmokeResult {
	protocol: typeof RUNNER_PROTOCOL;
	admission: "requires-terminal-complete-ledger-event";
	smokeId: typeof COMPILER_GYM_IR_DELTA_SMOKE_ID;
	preregistrationSha256: string;
	modelCalls: 0;
	measurementReuse: false;
	causalTreatmentClaimAllowed: false;
	lunaAuthorized: false;
	sourceDirectory: string;
	dispatchAttempt: Record<string, unknown>;
	environmentProbe: { preflightCommandSequence: number; postflightCommandSequence: number; stdoutSha256: string };
	allocations: CompilerGymIrDeltaAllocationEvidence[];
	blocks: CompilerGymIrDeltaSmokeBlock[];
	assessment: CompilerGymIrDeltaSmokeAssessment;
	squeueAbsenceCommandSequence: number;
	ledgerPath: string;
	ledgerEventCount: number;
	startedAt: string;
	finishedAt: string;
}

function blocksFromAllocations(
	preregistration: CompilerGymIrDeltaSmokePreregistration,
	allocations: readonly CompilerGymIrDeltaAllocationEvidence[],
): CompilerGymIrDeltaSmokeBlock[] {
	return (["r1", "r2"] as const).map((blockId) => {
		const canonical = allocations.find(
			(item) => item.spec.blockId === blockId && item.spec.arm === "canonical",
		)?.parsed;
		const treatment = allocations.find(
			(item) => item.spec.blockId === blockId && item.spec.arm === "one-env-ir-delta",
		)?.parsed;
		if (!canonical || !treatment?.trace) throw new Error(`Incomplete paired block ${blockId}`);
		return {
			blockId,
			candidateId: preregistration.candidate.candidateId,
			candidateSha256: preregistration.candidate.actionsSha256,
			benchmarkId: preregistration.benchmark,
			actions: [...preregistration.candidate.actions],
			canonical: {
				initialIrInstructionCount: canonical.initialIrInstructionCount,
				actionIndices: [...canonical.actionIndices],
				commandline: canonical.commandline,
				final: { ...canonical.final },
				intrinsicTotalMs: canonical.intrinsicTotalMs,
			},
			treatment: {
				initialIrInstructionCount: treatment.initialIrInstructionCount,
				actionIndices: [...treatment.actionIndices],
				commandline: treatment.commandline,
				final: { ...treatment.final },
				intrinsicTotalMs: treatment.intrinsicTotalMs,
				trace: structuredClone(treatment.trace),
			},
		};
	});
}

export class CompilerGymIrDeltaSmokeRunner {
	private readonly clock: CompilerGymIrDeltaSmokeRunnerClock;
	private readonly commandRunner: CompilerGymWarmCommandRunner;
	private readonly historicalEvidenceVerifier: CompilerGymIrDeltaHistoricalEvidenceVerifier;

	constructor(
		private readonly config: CompilerGymIrDeltaSmokeRunnerConfig,
		dependencies: CompilerGymIrDeltaSmokeRunnerDependencies = {},
	) {
		this.clock = dependencies.clock ?? new SystemCompilerGymIrDeltaSmokeRunnerClock();
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
		this.historicalEvidenceVerifier =
			dependencies.historicalEvidenceVerifier ?? new LocalHistoricalEvidenceVerifier();
	}

	async run(): Promise<CompilerGymIrDeltaSmokeResult> {
		const signal = new AbortController().signal;
		const preregistrationRaw = await readFile(resolve(this.config.preregistrationPath), "utf8");
		const preregistration = parseCompilerGymIrDeltaSmokePreregistration(
			singleJsonLine(preregistrationRaw, "preregistration"),
		);
		const preregistrationSha256 = sha256Text(preregistrationRaw);
		const [canonicalSource, treatmentSource, probeSource, implementationClosure] = await Promise.all([
			readFile(preregistration.sources.canonicalPath, "utf8"),
			readFile(preregistration.sources.treatmentPath, "utf8"),
			readFile(preregistration.sources.environmentProbePath, "utf8"),
			Promise.all(
				COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
					relativePath,
					sha256: sha256Text(await readFile(resolve(this.config.repoRoot, relativePath), "utf8")),
				})),
			),
		]);
		const reconstructed = buildCompilerGymIrDeltaSmokePreregistration({
			createdAt: preregistration.createdAt,
			primeAgentCommit: preregistration.primeAgentCommit,
			canonicalPath: preregistration.sources.canonicalPath,
			canonicalSource,
			treatmentPath: preregistration.sources.treatmentPath,
			treatmentSource,
			environmentProbePath: preregistration.sources.environmentProbePath,
			environmentProbeSource: probeSource,
			implementationClosure,
		});
		parseCompilerGymIrDeltaSmokePreregistration(preregistration, reconstructed);
		await this.historicalEvidenceVerifier.verify(preregistration, resolve(this.config.repoRoot));

		await mkdir(dirname(resolve(this.config.outputDir)), { recursive: true, mode: 0o700 });
		await mkdir(resolve(this.config.outputDir), { mode: 0o700 });
		const ledgerPath = resolve(this.config.outputDir, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(ledgerPath);
		if (ledger.getEvents().length !== 0) throw new Error("Smoke ledger must start empty");
		const artifactStore = new ArtifactStore(resolve(this.config.outputDir, "artifacts"));
		const recorder = new RecordingCommandRunner(this.commandRunner, artifactStore, ledger, this.clock);
		const remoteFileSystem = new SshCompilerGymWarmRemoteFileSystem(
			recorder,
			preregistration.environment.host,
			"/usr/bin/python3",
			this.config.commandTimeoutMs,
		);
		const startedAt = this.clock.now().toISOString();
		await ledger.append("run_manifest", {
			type: "ir_delta_smoke",
			phase: "start",
			protocol: RUNNER_PROTOCOL,
			preregistrationProtocol: COMPILER_GYM_IR_DELTA_SMOKE_PREREGISTRATION_PROTOCOL,
			preregistrationSha256,
			executionPlan: preregistration.executionPlan,
			v3NonAdmission: preregistration.v3NonAdmission,
			modelCalls: 0,
			measurementReuse: false,
			startedAt,
		});

		const sourceDirectory = posix.join(
			preregistration.environment.remoteSourceRoot,
			preregistration.sources.combinedSha256,
		);
		const canonicalRemotePath = posix.join(sourceDirectory, "compiler_gym_eval.py");
		const treatmentRemotePath = posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py");
		const probeRemotePath = posix.join(sourceDirectory, "compiler_gym_env_probe.py");
		const allocations: CompilerGymIrDeltaAllocationEvidence[] = [];
		const slurmIds = new Set<string>();
		const transientCaches = new Set<string>();
		const resultPath = resolve(this.config.outputDir, "result.json");
		let resultWritten = false;
		try {
			const lockRoot =
				this.config.dispatchLockRoot ??
				resolve(this.config.repoRoot, ".autoresearch/ir-delta-smoke-dispatch-attempts");
			await mkdir(lockRoot, { recursive: true, mode: 0o700 });
			const lockPath = join(lockRoot, `${preregistrationSha256}.json`);
			const dispatchBody = {
				protocol: "compiler-gym-ir-delta-smoke-dispatch-attempt-v1",
				preregistrationSha256,
				attemptOrdinal: 1,
				allocationRetries: 0,
				replacementAllocations: 0,
				attemptedAt: this.clock.now().toISOString(),
				outputDir: resolve(this.config.outputDir),
				lockPath,
			};
			const dispatchAttempt = { ...dispatchBody, recordSha256: sha256Json(dispatchBody) };
			await writeExclusiveJson(lockPath, dispatchAttempt);
			await ledger.append("run_manifest", { type: "ir_delta_smoke_dispatch_attempt", ...dispatchAttempt });
			const dispatchNonce = sha256Json(dispatchAttempt).slice(0, 16);

			await ensureCompilerGymIrDeltaPrivateDirectoryTree(remoteFileSystem, sourceDirectory, signal);
			for (const [remotePath, source, digest] of [
				[canonicalRemotePath, canonicalSource, preregistration.sources.canonicalSha256],
				[treatmentRemotePath, treatmentSource, preregistration.sources.treatmentSha256],
				[probeRemotePath, probeSource, preregistration.sources.environmentProbeSha256],
			] as const)
				await remoteFileSystem.installImmutableFile(remotePath, source, digest, 0o600, true, signal);

			const probeOuterArgv = compilerGymWarmSshArgv(
				preregistration.environment.host,
				environmentProbeArgv(preregistration.environment, probeRemotePath),
			);
			const preflightCommandSequence = recorder.nextSequence();
			const preflight = await recorder.run({
				argv: probeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			parseEnvironmentProbe(preflight);
			await ledger.append("run_manifest", {
				type: "ir_delta_environment_probe",
				phase: "preflight",
				protocol: RUNNER_PROTOCOL,
				commandSequence: preflightCommandSequence,
				sourceSha256: preregistration.sources.environmentProbeSha256,
				stdoutSha256: sha256Text(preflight.stdout),
				result: preregistration.environmentProbe.expectedResult,
			});

			for (const spec of preregistration.executionPlan) {
				const request = `${canonicalJson(toJsonValue({ benchmark: preregistration.benchmark, actions: preregistration.candidate.actions }))}\n`;
				const evaluatorPath = spec.arm === "canonical" ? canonicalRemotePath : treatmentRemotePath;
				const built = compilerGymIrDeltaSrunArgv({
					spec,
					remoteEvaluatorPath: evaluatorPath,
					environment: preregistration.environment,
					dispatchNonce,
				});
				if (transientCaches.has(built.transientCache)) throw new Error("Transient cache was reused");
				transientCaches.add(built.transientCache);
				const outerArgv = compilerGymWarmSshArgv(preregistration.environment.host, built.argv);
				const commandSequence = recorder.nextSequence();
				const commandResult = await recorder.run({
					argv: outerArgv,
					input: request,
					signal,
					timeoutMs: this.config.commandTimeoutMs,
					maxOutputBytes: MAX_OUTPUT_BYTES,
				});
				if (commandResult.exitCode !== 0)
					throw new Error(`${spec.blockId} ${spec.arm} evaluator failed: ${commandResult.stderr.trim()}`);
				const parsed = parseEvaluatorResult(commandResult.stdout, {
					arm: spec.arm,
					slurmCpusPerTask: "2",
					actions: preregistration.candidate.actions,
				});
				if (
					spec.arm === "canonical" &&
					(parsed.final.irInstructionCount !== preregistration.candidate.expectedMetrics.irInstructionCount ||
						parsed.final.objectTextSizeBytes !== preregistration.candidate.expectedMetrics.objectTextSizeBytes)
				)
					throw new Error(`${spec.blockId} ${spec.arm} terminal metrics differ from accepted L46/blowfish`);
				if (slurmIds.has(parsed.slurmId)) throw new Error(`Slurm allocation ${parsed.slurmId} was reused`);
				slurmIds.add(parsed.slurmId);
				const accountingResult = await waitForAccounting({
					slurmId: parsed.slurmId,
					expectedJobName: built.jobName,
					recorder,
					preregistration,
					config: this.config,
					clock: this.clock,
					signal,
				});
				const stdoutArtifact = await recorder.store(commandResult.stdout, "application/json");
				const stderrArtifact = await recorder.store(commandResult.stderr, "text/plain");
				const allocation: CompilerGymIrDeltaAllocationEvidence = {
					spec: { ...spec },
					requestSha256: sha256Text(request),
					evaluatorSha256:
						spec.arm === "canonical"
							? preregistration.sources.canonicalSha256
							: preregistration.sources.treatmentSha256,
					remoteArgv: [...built.argv],
					outerArgv: [...outerArgv],
					transientCache: built.transientCache,
					commandSequence,
					slurmId: parsed.slurmId,
					accountingCommandSequences: accountingResult.sequences,
					accounting: accountingResult.accounting,
					parsed,
					stdoutArtifact,
					stderrArtifact,
				};
				allocations.push(allocation);
				await ledger.append("measurement", {
					type: "ir_delta_smoke_allocation",
					protocol: RUNNER_PROTOCOL,
					...allocation,
				});
			}

			if (allocations.length !== 4 || slurmIds.size !== 4 || transientCaches.size !== 4)
				throw new Error("Smoke did not produce four independent allocations and caches");
			const postflightCommandSequence = recorder.nextSequence();
			const postflight = await recorder.run({
				argv: probeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			parseEnvironmentProbe(postflight);
			if (postflight.stdout !== preflight.stdout)
				throw new Error("Postflight environment probe differs from preflight");
			await ledger.append("run_manifest", {
				type: "ir_delta_environment_probe",
				phase: "postflight",
				protocol: RUNNER_PROTOCOL,
				commandSequence: postflightCommandSequence,
				sourceSha256: preregistration.sources.environmentProbeSha256,
				stdoutSha256: sha256Text(postflight.stdout),
				result: preregistration.environmentProbe.expectedResult,
			});

			const squeueAbsenceCommandSequence = recorder.nextSequence();
			const squeue = await recorder.run({
				argv: compilerGymWarmSshArgv(preregistration.environment.host, [
					"/usr/bin/squeue",
					"--noheader",
					"--jobs",
					[...slurmIds].join(","),
					"--format=%A",
				]),
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			if (squeue.exitCode !== 0 || squeue.stdout.trim() !== "")
				throw new Error("One or more measured Slurm IDs remain in squeue");
			await ledger.append("run_manifest", {
				type: "ir_delta_squeue_absence",
				protocol: RUNNER_PROTOCOL,
				commandSequence: squeueAbsenceCommandSequence,
				slurmIds: [...slurmIds],
				schedulerAbsent: true,
			});

			await verifySources(preregistration, this.config.repoRoot);
			for (const artifact of recorder.artifacts) await artifactStore.readString(artifact);
			const blocks = blocksFromAllocations(preregistration, allocations);
			const assessment = assessCompilerGymIrDeltaSmoke({ protocol: COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL, blocks });
			await ledger.append("claim", {
				type: "ir_delta_smoke_assessment",
				protocol: RUNNER_PROTOCOL,
				admission: "requires-terminal-complete-ledger-event",
				scope: "cost-and-equivalence-screen-only",
				lunaAuthorized: false,
				measurementReuseAllowed: false,
				assessment,
			});
			const finishedAt = this.clock.now().toISOString();
			ledger.verify();
			const result: CompilerGymIrDeltaSmokeResult = {
				protocol: RUNNER_PROTOCOL,
				admission: "requires-terminal-complete-ledger-event",
				smokeId: COMPILER_GYM_IR_DELTA_SMOKE_ID,
				preregistrationSha256,
				modelCalls: 0,
				measurementReuse: false,
				causalTreatmentClaimAllowed: false,
				lunaAuthorized: false,
				sourceDirectory,
				dispatchAttempt,
				environmentProbe: {
					preflightCommandSequence,
					postflightCommandSequence,
					stdoutSha256: sha256Text(preflight.stdout),
				},
				allocations,
				blocks,
				assessment,
				squeueAbsenceCommandSequence,
				ledgerPath,
				ledgerEventCount: ledger.getEvents().length + 1,
				startedAt,
				finishedAt,
			};
			await writeExclusiveJson(resultPath, result);
			resultWritten = true;
			await ledger.append("run_manifest", {
				type: "ir_delta_smoke",
				phase: "complete",
				protocol: RUNNER_PROTOCOL,
				decision: assessment.decision,
				nextGate: assessment.nextGate,
				lunaAuthorized: false,
				resultSha256: sha256Text(`${canonicalJson(toJsonValue(result))}\n`),
				allocationCount: 4,
				uniqueSlurmIds: 4,
				uniqueTransientCaches: 4,
				modelCalls: 0,
				measurementReuse: false,
				finishedAt,
			});
			return result;
		} catch (error) {
			let failure: unknown = error;
			try {
				await verifySources(preregistration, this.config.repoRoot);
			} catch (integrityError) {
				failure = new AggregateError(
					[failure, integrityError],
					"Smoke failed and source integrity verification also failed",
				);
			}
			if (resultWritten) {
				try {
					await unlink(resultPath);
				} catch (unlinkError) {
					failure = new AggregateError(
						[failure, unlinkError],
						"Smoke failed and provisional result cleanup also failed",
					);
				}
			}
			try {
				await ledger.append("run_manifest", {
					type: "ir_delta_smoke",
					phase: "failed",
					protocol: RUNNER_PROTOCOL,
					failureDisposition: "terminal-apparatus-invalid",
					allocationCount: allocations.length,
					modelCalls: 0,
					measurementReuse: false,
					lunaAuthorized: false,
					error: failure instanceof Error ? (failure.stack ?? failure.message) : String(failure),
					failedAt: this.clock.now().toISOString(),
				});
			} catch (ledgerError) {
				failure = new AggregateError([failure, ledgerError], "Smoke and failure recording both failed");
			}
			throw failure;
		}
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 5 || args[0] !== "--dispatch" || args[1] !== "--preregistration" || args[3] !== "--output-dir")
		throw new Error(
			"Usage: compiler-gym-ir-delta-smoke-runner --dispatch --preregistration <path> --output-dir <path>",
		);
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const runner = new CompilerGymIrDeltaSmokeRunner({
		repoRoot,
		preregistrationPath: resolve(args[2]),
		outputDir: resolve(args[4]),
		...DEFAULT_COMPILER_GYM_IR_DELTA_SMOKE_RUNNER_LIMITS,
	});
	console.log(canonicalJson(toJsonValue(await runner.run())));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

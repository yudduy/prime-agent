import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "./compiler-gym-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256,
	type CompilerGymIrDeltaQualificationEnvironment,
	DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
} from "./compiler-gym-ir-delta-qualification-preregistration.js";
import {
	type CompilerGymIrDeltaQualificationAccounting,
	ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree,
	parseCompilerGymIrDeltaQualificationEvaluatorResult,
} from "./compiler-gym-ir-delta-qualification-runner.js";
import { COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT } from "./compiler-gym-ir-delta-smoke-preregistration.js";
import {
	type CompilerGymWarmCommandResult,
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	compilerGymWarmSshArgv,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { EvaluationAdapterOutputError } from "./evaluation-adapter-output-error.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	TaskMeasurement,
} from "./types.js";

export const COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL =
	"compiler-gym-ir-delta-screen-adapter-output-v1" as const;
export const COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL =
	"compiler-gym-canonical-one-task-adapter-output-v1" as const;
export const COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL =
	"compiler-gym-canonical-one-task-semantic-result-adapter-output-v1" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL =
	"compiler-gym-ir-delta-screen-accounting-rows-v1" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION =
	"accounting-is-root-step-is-evaluator-worker-cpu-time-raw-is-allocated-cpu-seconds" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_RAW_FAILURE_PROTOCOL = "compiler-gym-ir-delta-screen-raw-failure-v1" as const;
export const COMPILER_GYM_CANONICAL_ONE_TASK_RAW_FAILURE_PROTOCOL =
	"compiler-gym-canonical-one-task-raw-failure-v1" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS = [
	"benchmark://cbench-v1/blowfish",
	"benchmark://cbench-v1/bzip2",
] as const;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ACCOUNTING_ELAPSED_SECONDS = 5 * 60;
export const COMPILER_GYM_IR_DELTA_SCREEN_DEFAULT_MAX_ACTION_COUNT = 46;
export const COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT = 256;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const NONCE_PATTERN = /^[0-9a-f]{16}$/;
const SAFE_REMOTE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]+$/;
const SACCT_JOB_ID_PATTERN = /^[1-9][0-9]*(?:\.extern|\.0)?$/;
const SACCT_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/;
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
const NONTERMINAL_ACCOUNTING_STATES = new Set([
	"COMPLETING",
	"CONFIGURING",
	"PENDING",
	"RESIZING",
	"RUNNING",
	"SIGNALING",
	"STAGE_OUT",
	"SUSPENDED",
]);
const KNOWN_ACCOUNTING_STATES = [...TERMINAL_ACCOUNTING_STATES, ...NONTERMINAL_ACCOUNTING_STATES];

export type CompilerGymIrDeltaScreenAccountingMode = "disabled" | "best-effort" | "required";
export type CompilerGymIrDeltaScreenAccountingEvidenceVersion = "root-only-v1" | "exact-three-row-v1";

export interface FarmShareCompilerGymIrDeltaScreenAdapterConfig {
	environment: CompilerGymIrDeltaQualificationEnvironment;
	canonicalEvaluatorLocalPath: string;
	evaluatorLocalPath: string;
	commandTimeoutMs: number;
	maxActionCount: number;
	accountingMode: CompilerGymIrDeltaScreenAccountingMode;
	accountingEvidenceVersion: CompilerGymIrDeltaScreenAccountingEvidenceVersion;
	accountingTimeoutMs: number;
	accountingPollMs: number;
}

export const DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG: FarmShareCompilerGymIrDeltaScreenAdapterConfig =
	{
		environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
		canonicalEvaluatorLocalPath: fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url)),
		evaluatorLocalPath: fileURLToPath(new URL("../evaluators/compiler_gym_ir_delta_eval.py", import.meta.url)),
		commandTimeoutMs: 6 * 60_000,
		maxActionCount: COMPILER_GYM_IR_DELTA_SCREEN_DEFAULT_MAX_ACTION_COUNT,
		accountingMode: "required",
		accountingEvidenceVersion: "root-only-v1",
		accountingTimeoutMs: 2 * 60_000,
		accountingPollMs: 1_000,
	};

export const COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE = Object.freeze({
	adapter: "farmshare-compiler-gym-ir-delta-screen",
	adapterOutputProtocol: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
	canonicalEvaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
	evaluatorSha256: COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256,
	evaluatorContract: COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
	terminalVerifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
	measurementReuse: "disabled-fresh-stock-cold",
	environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
	installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
	compilerGym: "0.2.5",
	llvm: "10.0.0",
} as const);

export const COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE = Object.freeze({
	adapter: "farmshare-compiler-gym-canonical-one-task",
	adapterOutputProtocol: COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
	canonicalEvaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
	evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
	evaluatorContract: COMPILER_GYM_VERIFIER_EPOCH,
	terminalVerifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
	measurementReuse: "disabled-fresh-stock-cold",
	environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
	installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
	compilerGym: "0.2.5",
	llvm: "10.0.0",
} as const);

export const COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE = Object.freeze({
	...COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE,
	adapter: "farmshare-compiler-gym-canonical-one-task-semantic-result",
	adapterOutputProtocol: COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL,
} as const);

export interface CompilerGymIrDeltaScreenAdapterClock {
	monotonicMs(): number;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface FarmShareCompilerGymIrDeltaScreenAdapterDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	clock?: CompilerGymIrDeltaScreenAdapterClock;
	nonceFactory?: () => string;
}

export interface CompilerGymIrDeltaScreenTaskEvidence {
	benchmarkId: (typeof COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS)[number];
	requestSha256: string;
	evaluatorSha256: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256;
	exitCode: number;
	wallMs: number;
	stdout: string;
	stdoutSha256: string;
	stderr: string;
	stderrSha256: string;
	slurmId: string;
	transientCache: string;
	jobName: string;
	// Compatibility projection of accountingRows.root for existing evidence consumers.
	accounting: CompilerGymIrDeltaQualificationAccounting | null;
	// Authoritative scheduler proof; step is the two-CPU evaluator worker.
	accountingRows?: CompilerGymIrDeltaScreenAccountingRows | null;
}

export interface CompilerGymCanonicalOneTaskEvidence {
	benchmarkId: (typeof COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS)[number];
	requestSha256: string;
	evaluatorSha256: typeof COMPILER_GYM_EVALUATOR_SHA256;
	exitCode: number;
	wallMs: number;
	stdout: string;
	stdoutSha256: string;
	stderr: string;
	stderrSha256: string;
	slurmId: string;
	transientCache: string;
	jobName: string;
	accounting: CompilerGymIrDeltaQualificationAccounting;
	accountingRows: CompilerGymIrDeltaScreenAccountingRows;
}

export interface CompilerGymIrDeltaScreenAccountingRows {
	contract: typeof COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL;
	interpretation: typeof COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION;
	root: CompilerGymIrDeltaQualificationAccounting;
	extern: CompilerGymIrDeltaQualificationAccounting;
	step: CompilerGymIrDeltaQualificationAccounting;
}

export interface CompilerGymIrDeltaScreenAggregate {
	contract: typeof COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL;
	jobId: string;
	manifestDigest: string;
	candidateSha256: string;
	actionsSha256: string;
	verifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
	evaluatorSha256: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256;
	measurementReuse: false;
	sourceBundleSha256: string;
	sourceDirectory: string;
	remoteEvaluatorPath: string;
	tasks: CompilerGymIrDeltaScreenTaskEvidence[];
}

export interface CompilerGymCanonicalOneTaskAggregate {
	contract: typeof COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL;
	jobId: string;
	manifestDigest: string;
	candidateSha256: string;
	actionsSha256: string;
	verifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
	evaluatorSha256: typeof COMPILER_GYM_EVALUATOR_SHA256;
	measurementReuse: false;
	sourceBundleSha256: string;
	sourceDirectory: string;
	remoteEvaluatorPath: string;
	tasks: [CompilerGymCanonicalOneTaskEvidence];
}

export interface CompilerGymCanonicalOneTaskSemanticResultAggregate
	extends Omit<CompilerGymCanonicalOneTaskAggregate, "contract"> {
	contract: typeof COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL;
}

interface PreparedEvaluator {
	sourceBundleSha256: string;
	sourceDirectory: string;
	canonicalRemoteEvaluatorPath: string;
	remoteEvaluatorPath: string;
}

export interface CompilerGymCanonicalOneTaskPreparationEvidence {
	sourceBundleSha256: string;
	sourceDirectory: string;
	canonicalRemoteEvaluatorPath: string;
	irDeltaRemoteEvaluatorPath: string;
}

interface CollectedAccounting {
	root: CompilerGymIrDeltaQualificationAccounting;
	rows?: CompilerGymIrDeltaScreenAccountingRows;
}

interface CompilerGymIrDeltaScreenRawFailureInput {
	benchmarkId: (typeof COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS)[number];
	taskOrdinal: 1 | 2;
	request: string;
	result: CompilerGymWarmCommandResult;
	phase: "evaluator-result-validation" | "scheduler-accounting";
	cause: unknown;
	prepared: PreparedEvaluator;
	transientCache: string;
	jobName: string;
	slurmId: string | null;
}

function compilerGymIrDeltaScreenRawFailure(
	input: CompilerGymIrDeltaScreenRawFailureInput,
): EvaluationAdapterOutputError {
	const evidence = {
		contract: COMPILER_GYM_IR_DELTA_SCREEN_RAW_FAILURE_PROTOCOL,
		benchmarkId: input.benchmarkId,
		taskOrdinal: input.taskOrdinal,
		phase: input.phase,
		cause: input.cause instanceof Error ? input.cause.message : String(input.cause),
		requestSha256: sha256Text(input.request),
		exitCode: input.result.exitCode,
		wallMs: input.result.wallMs,
		stdoutSha256: sha256Text(input.result.stdout),
		stderrSha256: sha256Text(input.result.stderr),
		sourceBundleSha256: input.prepared.sourceBundleSha256,
		remoteEvaluatorPath: input.prepared.remoteEvaluatorPath,
		transientCache: input.transientCache,
		jobName: input.jobName,
		slurmId: input.slurmId,
	};
	return new EvaluationAdapterOutputError({
		code: "compiler-gym-ir-delta-screen-output-invalid",
		message:
			input.phase === "evaluator-result-validation"
				? "IR-delta evaluator output failed host validation"
				: "IR-delta evaluator scheduler accounting failed host validation",
		hostEvidence: toJsonValue(evidence),
		stdout: input.result.stdout,
		stderr: input.result.stderr,
	});
}

function compilerGymCanonicalOneTaskRawFailure(
	input: CompilerGymIrDeltaScreenRawFailureInput,
): EvaluationAdapterOutputError {
	const evidence = {
		contract: COMPILER_GYM_CANONICAL_ONE_TASK_RAW_FAILURE_PROTOCOL,
		benchmarkId: input.benchmarkId,
		taskOrdinal: input.taskOrdinal,
		phase: input.phase,
		cause: input.cause instanceof Error ? input.cause.message : String(input.cause),
		requestSha256: sha256Text(input.request),
		exitCode: input.result.exitCode,
		wallMs: input.result.wallMs,
		stdoutSha256: sha256Text(input.result.stdout),
		stderrSha256: sha256Text(input.result.stderr),
		sourceBundleSha256: input.prepared.sourceBundleSha256,
		remoteEvaluatorPath: input.prepared.remoteEvaluatorPath,
		transientCache: input.transientCache,
		jobName: input.jobName,
		slurmId: input.slurmId,
	};
	return new EvaluationAdapterOutputError({
		code: "compiler-gym-canonical-one-task-output-invalid",
		message:
			input.phase === "evaluator-result-validation"
				? "Canonical one-task evaluator output failed host validation"
				: "Canonical one-task evaluator scheduler accounting failed host validation",
		hostEvidence: toJsonValue(evidence),
		stdout: input.result.stdout,
		stderr: input.result.stderr,
	});
}

class SystemCompilerGymIrDeltaScreenAdapterClock implements CompilerGymIrDeltaScreenAdapterClock {
	monotonicMs(): number {
		return performance.now();
	}

	sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", abort);
				resolve();
			};
			const timeout = setTimeout(finish, ms);
			const abort = (): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				signal.removeEventListener("abort", abort);
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}

function validateFrozenEnvironment(environment: CompilerGymIrDeltaQualificationEnvironment): void {
	if (
		canonicalJson(toJsonValue(environment)) !==
		canonicalJson(toJsonValue(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT))
	) {
		throw new Error("IR-delta screen adapter requires the frozen qualification environment");
	}
}

function validatePositiveInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
}

function parseActions(content: string, maxActionCount: number): string[] {
	let value: unknown;
	try {
		value = JSON.parse(content) as unknown;
	} catch {
		throw new Error("CompilerGym candidate content must be a JSON array of LLVM pass flags");
	}
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error("CompilerGym candidate content must be a JSON string array");
	}
	if (value.length === 0) throw new Error("Qualified IR-delta screen candidates must contain at least one pass");
	if (value.length > maxActionCount) {
		throw new Error(`Qualified IR-delta screen candidates may contain at most ${maxActionCount} passes`);
	}
	return [...value];
}

function validateJob(job: EvaluationJob): void {
	if (job.lane !== "compiler-gym") throw new Error("IR-delta screen adapter only accepts CompilerGym jobs");
	if (job.candidateFormat !== "llvm-pass-sequence") {
		throw new Error("IR-delta screen adapter requires an LLVM pass sequence");
	}
	if (
		job.benchmarkIds.length !== COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS.length ||
		job.benchmarkIds.some((benchmarkId, index) => benchmarkId !== COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[index])
	) {
		throw new Error("IR-delta screen adapter requires the fixed blowfish/bzip2 task order");
	}
	if (!SHA256_PATTERN.test(job.candidate.digest))
		throw new Error("Candidate artifact digest must be a lowercase SHA-256");
}

function validateCanonicalOneTaskJob(job: EvaluationJob): (typeof COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS)[number] {
	if (job.lane !== "compiler-gym") throw new Error("Canonical one-task adapter only accepts CompilerGym jobs");
	if (job.candidateFormat !== "llvm-pass-sequence") {
		throw new Error("Canonical one-task adapter requires an LLVM pass sequence");
	}
	if (
		job.benchmarkIds.length !== 1 ||
		!COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS.includes(
			job.benchmarkIds[0] as (typeof COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS)[number],
		)
	) {
		throw new Error("Canonical one-task adapter requires exactly one frozen blowfish or bzip2 task");
	}
	if (!SHA256_PATTERN.test(job.candidate.digest)) {
		throw new Error("Candidate artifact digest must be a lowercase SHA-256");
	}
	return job.benchmarkIds[0] as (typeof COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS)[number];
}

function validateRemotePath(value: string, label: string): void {
	if (!SAFE_REMOTE_PATH_PATTERN.test(value) || posix.normalize(value) !== value) {
		throw new Error(`${label} must be a safe absolute normalized path`);
	}
}

export function compilerGymIrDeltaScreenSrunArgv(input: {
	benchmarkId: (typeof COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS)[number];
	taskOrdinal: 1 | 2;
	dispatchNonce: string;
	remoteEvaluatorPath: string;
	environment?: CompilerGymIrDeltaQualificationEnvironment;
}): { argv: [string, ...string[]]; transientCache: string; jobName: string } {
	const environment = input.environment ?? DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT;
	validateFrozenEnvironment(environment);
	if (!NONCE_PATTERN.test(input.dispatchNonce)) throw new Error("Dispatch nonce must be 16 lowercase hex digits");
	if (COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[input.taskOrdinal - 1] !== input.benchmarkId) {
		throw new Error("Task ordinal does not match the fixed screen task order");
	}
	validateRemotePath(input.remoteEvaluatorPath, "Remote evaluator path");
	const task = input.benchmarkId.split("/").at(-1);
	if (!task || !/^[a-z0-9-]+$/.test(task)) throw new Error("Benchmark has an unsafe task name");
	const jobName = `pids-${input.dispatchNonce}-${input.taskOrdinal}-${task}`;
	const transientCache = `/tmp/prime-ir-screen-${input.dispatchNonce}-${input.taskOrdinal}-${task}`;
	const argv = [
		"/usr/bin/srun",
		"-p",
		environment.partition,
		"-C",
		environment.cpuConstraint,
		"--ntasks=1",
		`--cpus-per-task=${environment.cpusPerTask}`,
		`--mem=${environment.memory}`,
		`--time=${environment.timeLimit}`,
		"--kill-on-bad-exit=1",
		"--export=NONE",
		`--job-name=${jobName}`,
		"/usr/bin/env",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		`LD_LIBRARY_PATH=${environment.compatibilityLibraryDir}`,
		`COMPILER_GYM_CACHE=${environment.compilerGymCache}`,
		`COMPILER_GYM_SITE_DATA=${environment.compilerGymSiteData}`,
		`COMPILER_GYM_TRANSIENT_CACHE=${transientCache}`,
		"PYTHONDONTWRITEBYTECODE=1",
		`PYTHONWARNINGS=${environment.pythonWarnings}`,
		environment.pythonPath,
		input.remoteEvaluatorPath,
	] as [string, ...string[]];
	if (
		argv.some(
			(item) =>
				item.includes("sbatch") ||
				item.startsWith("--jobid") ||
				item.startsWith("--dependency") ||
				item === "--overlap" ||
				item === "--exact" ||
				item === "--hold",
		)
	) {
		throw new Error("IR-delta screen may only use independent stock-cold allocations");
	}
	return { argv, transientCache, jobName };
}

function sacctArgv(
	slurmId: string,
	accountingEvidenceVersion: CompilerGymIrDeltaScreenAccountingEvidenceVersion,
): [string, ...string[]] {
	if (!/^[1-9][0-9]*$/.test(slurmId)) throw new Error("Invalid Slurm ID for sacct");
	return [
		"/usr/bin/sacct",
		...(accountingEvidenceVersion === "root-only-v1" ? (["-X"] as const) : []),
		"--jobs",
		slurmId,
		"--noheader",
		"--parsable2",
		"--format=JobIDRaw,JobName,State,ExitCode,AllocCPUS,NTasks,ElapsedRaw,CPUTimeRAW,NodeList,Start,End",
	];
}

function parseAccountingInteger(value: string, label: string): number {
	if (!/^[0-9]+$/.test(value)) throw new Error(`sacct ${label} is not an integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`sacct ${label} is not a safe integer`);
	return parsed;
}

function parseAccountingRow(line: string): CompilerGymIrDeltaQualificationAccounting {
	const fields = line.split("|");
	if (fields.at(-1) === "") fields.pop();
	if (fields.length !== 11) throw new Error("sacct row has an unexpected field count");
	const [jobIdRaw, jobName, state, exitCode, allocCpus, nTasks, elapsedRaw, cpuTimeRaw, nodeList, startAt, endAt] =
		fields;
	if (!SACCT_JOB_ID_PATTERN.test(jobIdRaw)) throw new Error("sacct JobIDRaw is invalid");
	for (const [label, value] of [
		["JobName", jobName],
		["State", state],
		["ExitCode", exitCode],
		["NodeList", nodeList],
		["Start", startAt],
		["End", endAt],
	] as const) {
		if (value.length === 0) throw new Error(`sacct ${label} is empty`);
	}
	const parsedAllocCpus = parseAccountingInteger(allocCpus, "AllocCPUS");
	const parsedElapsed = parseAccountingInteger(elapsedRaw, "ElapsedRaw");
	const parsedCpuTime = parseAccountingInteger(cpuTimeRaw, "CPUTimeRAW");
	const expectedCpuTime = parsedAllocCpus * parsedElapsed;
	if (!Number.isSafeInteger(expectedCpuTime)) {
		throw new Error("sacct AllocCPUS multiplied by ElapsedRaw is not a safe integer");
	}
	if (parsedCpuTime !== expectedCpuTime) {
		throw new Error("sacct CPUTimeRAW must equal AllocCPUS multiplied by ElapsedRaw");
	}
	return {
		jobIdRaw,
		jobName,
		state,
		exitCode,
		allocCpus: parsedAllocCpus,
		nTasks: nTasks === "" ? null : parseAccountingInteger(nTasks, "NTasks"),
		elapsedRawSeconds: parsedElapsed,
		cpuTimeRawSeconds: parsedCpuTime,
		nodeList,
		startAt,
		endAt,
	};
}

function parseAccountingRows(stdout: string): CompilerGymIrDeltaQualificationAccounting[] {
	if (!stdout.trim()) return [];
	return stdout.trim().split("\n").filter(Boolean).map(parseAccountingRow);
}

function normalizedAccountingState(state: string): string {
	if (!state.endsWith("+")) return state;
	const prefix = state.slice(0, -1);
	const matches = KNOWN_ACCOUNTING_STATES.filter((candidate) => candidate.startsWith(prefix));
	return matches.length === 1 ? (matches[0] ?? state) : state;
}

function hasTerminalAccountingTimestamps(row: CompilerGymIrDeltaQualificationAccounting): boolean {
	return SACCT_TIMESTAMP_PATTERN.test(row.startAt) && SACCT_TIMESTAMP_PATTERN.test(row.endAt);
}

function validateAccountingElapsed(row: CompilerGymIrDeltaQualificationAccounting): void {
	if (row.elapsedRawSeconds > MAX_ACCOUNTING_ELAPSED_SECONDS) {
		throw new Error(
			`sacct ${row.jobIdRaw} ElapsedRaw exceeds the frozen ${MAX_ACCOUNTING_ELAPSED_SECONDS}-second limit`,
		);
	}
}

function validateAccountingTimestamp(row: CompilerGymIrDeltaQualificationAccounting): void {
	if (!hasTerminalAccountingTimestamps(row)) {
		throw new Error(`sacct ${row.jobIdRaw} timestamps are not frozen terminal timestamps`);
	}
	if (Date.parse(row.endAt) < Date.parse(row.startAt)) {
		throw new Error(`sacct ${row.jobIdRaw} End precedes Start`);
	}
}

function validateContainedAccountingRow(
	row: CompilerGymIrDeltaQualificationAccounting,
	root: CompilerGymIrDeltaQualificationAccounting,
): void {
	validateAccountingElapsed(row);
	validateAccountingTimestamp(row);
	if (row.nodeList !== root.nodeList) throw new Error(`sacct ${row.jobIdRaw} NodeList differs from the root row`);
	if (row.elapsedRawSeconds > root.elapsedRawSeconds) {
		throw new Error(`sacct ${row.jobIdRaw} elapsed time exceeds the root allocation`);
	}
	if (Date.parse(row.startAt) < Date.parse(root.startAt) || Date.parse(row.endAt) > Date.parse(root.endAt)) {
		throw new Error(`sacct ${row.jobIdRaw} timestamps escape the root allocation`);
	}
}

function validateRootAccountingShape(input: {
	root: CompilerGymIrDeltaQualificationAccounting;
	slurmId: string;
	expectedJobName: string;
	environment: CompilerGymIrDeltaQualificationEnvironment;
}): void {
	const { root, slurmId, expectedJobName, environment } = input;
	if (root.jobIdRaw !== slurmId || root.jobName !== expectedJobName) {
		throw new Error("sacct root row does not bind to the measured screen allocation");
	}
	if (
		!environment.acceptedRootAllocCpus.includes(root.allocCpus as 2 | 4) ||
		(root.nTasks !== null && root.nTasks !== 1)
	) {
		throw new Error("sacct root row differs from the frozen screen allocation shape");
	}
	validateAccountingElapsed(root);
}

function validateRootAccountingOutcome(
	root: CompilerGymIrDeltaQualificationAccounting,
	outcome: "verified" | "semantic-rejection",
): void {
	const expectedState = outcome === "verified" ? "COMPLETED" : "FAILED";
	const expectedExitCode = outcome === "verified" ? "0:0" : "5:0";
	if (normalizedAccountingState(root.state) !== expectedState || root.exitCode !== expectedExitCode) {
		throw new Error("sacct root terminal row contradicts the evaluator outcome");
	}
}

function validateRootAccounting(input: {
	root: CompilerGymIrDeltaQualificationAccounting;
	slurmId: string;
	expectedJobName: string;
	outcome: "verified" | "semantic-rejection";
	environment: CompilerGymIrDeltaQualificationEnvironment;
}): CompilerGymIrDeltaQualificationAccounting {
	const { root, slurmId, expectedJobName, outcome, environment } = input;
	validateRootAccountingShape({ root, slurmId, expectedJobName, environment });
	validateRootAccountingOutcome(root, outcome);
	validateAccountingTimestamp(root);
	return structuredClone(root);
}

function validateAccountingRowsShape(input: {
	rows: CompilerGymIrDeltaScreenAccountingRows;
	slurmId: string;
	expectedJobName: string;
	environment: CompilerGymIrDeltaQualificationEnvironment;
}): void {
	const { rows, slurmId, expectedJobName, environment } = input;
	if (rows.contract !== COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL) {
		throw new Error("sacct accounting-row evidence contract is invalid");
	}
	if (
		rows.interpretation !== COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION ||
		Object.keys(rows).sort().join(",") !== "contract,extern,interpretation,root,step" ||
		rows.root.jobIdRaw !== slurmId ||
		rows.extern.jobIdRaw !== `${slurmId}.extern` ||
		rows.step.jobIdRaw !== `${slurmId}.0`
	) {
		throw new Error("sacct rows do not have the exact root/extern/.0 identity");
	}
	const { root, extern, step } = rows;
	validateRootAccountingShape({ root, slurmId, expectedJobName, environment });
	if (step.jobName !== expectedJobName || extern.jobName !== "extern") {
		throw new Error("sacct rows do not bind to the measured screen allocation");
	}
	if (extern.allocCpus !== root.allocCpus || extern.nTasks !== 1) {
		throw new Error("sacct extern row differs from the frozen allocation shape");
	}
	if (step.allocCpus !== environment.cpusPerTask || step.nTasks !== 1) {
		throw new Error("sacct evaluator step differs from the frozen two-CPU one-task shape");
	}
	validateAccountingElapsed(extern);
	validateAccountingElapsed(step);
	if (extern.nodeList !== root.nodeList || step.nodeList !== root.nodeList) {
		throw new Error("sacct subordinate NodeList differs from the root row");
	}
}

function validateAccountingRowsTerminalOutcomes(
	rows: CompilerGymIrDeltaScreenAccountingRows,
	outcome: "verified" | "semantic-rejection",
): void {
	const expectedState = outcome === "verified" ? "COMPLETED" : "FAILED";
	const expectedExitCode = outcome === "verified" ? "0:0" : "5:0";
	const stepState = normalizedAccountingState(rows.step.state);
	if (
		TERMINAL_ACCOUNTING_STATES.has(stepState) &&
		(stepState !== expectedState || rows.step.exitCode !== expectedExitCode)
	) {
		throw new Error("sacct evaluator-step terminal row contradicts the evaluator outcome");
	}
	const externState = normalizedAccountingState(rows.extern.state);
	if (TERMINAL_ACCOUNTING_STATES.has(externState) && (externState !== "COMPLETED" || rows.extern.exitCode !== "0:0")) {
		throw new Error("sacct extern terminal row contradicts the frozen allocation outcome");
	}
}

function validateAccountingRows(input: {
	rows: CompilerGymIrDeltaScreenAccountingRows;
	slurmId: string;
	expectedJobName: string;
	outcome: "verified" | "semantic-rejection";
	environment: CompilerGymIrDeltaQualificationEnvironment;
}): CompilerGymIrDeltaScreenAccountingRows {
	const { rows, slurmId, expectedJobName, outcome, environment } = input;
	validateAccountingRowsShape({ rows, slurmId, expectedJobName, environment });
	const { root, extern, step } = rows;
	validateRootAccounting({ root, slurmId, expectedJobName, outcome, environment });
	validateAccountingRowsTerminalOutcomes(rows, outcome);
	const expectedState = outcome === "verified" ? "COMPLETED" : "FAILED";
	const expectedExitCode = outcome === "verified" ? "0:0" : "5:0";
	if (
		normalizedAccountingState(step.state) !== expectedState ||
		step.exitCode !== expectedExitCode ||
		normalizedAccountingState(extern.state) !== "COMPLETED" ||
		extern.exitCode !== "0:0"
	) {
		throw new Error("sacct terminal rows contradict the evaluator outcome");
	}
	// Slurm's extern step is a separate containment/cleanup slurmstepd. It must
	// bind to this allocation, but it may finish after the root accounting row.
	validateAccountingTimestamp(extern);
	validateContainedAccountingRow(step, root);
	return structuredClone(rows);
}

function buildCompilerGymIrDeltaScreenAccountingRows(
	parsed: CompilerGymIrDeltaQualificationAccounting[],
	slurmId: string,
): CompilerGymIrDeltaScreenAccountingRows {
	if (parsed.length !== 3) throw new Error("sacct must return exactly root, extern, and evaluator-step rows");
	const byId = new Map(parsed.map((row) => [row.jobIdRaw, row]));
	if (byId.size !== 3) throw new Error("sacct returned duplicate accounting rows");
	const root = byId.get(slurmId);
	const extern = byId.get(`${slurmId}.extern`);
	const step = byId.get(`${slurmId}.0`);
	if (!root || !extern || !step) throw new Error("sacct rows do not have the exact root/extern/.0 identity");
	return {
		contract: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
		interpretation: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
		root,
		extern,
		step,
	};
}

function accountingRowIsPending(row: CompilerGymIrDeltaQualificationAccounting): boolean {
	const state = normalizedAccountingState(row.state);
	if (NONTERMINAL_ACCOUNTING_STATES.has(state)) return true;
	if (!TERMINAL_ACCOUNTING_STATES.has(state)) throw new Error(`sacct ${row.jobIdRaw} State is not recognized`);
	return !hasTerminalAccountingTimestamps(row);
}

export function parseCompilerGymIrDeltaScreenAccountingRows(input: {
	stdout: string;
	slurmId: string;
	expectedJobName: string;
	outcome: "verified" | "semantic-rejection";
	environment?: CompilerGymIrDeltaQualificationEnvironment;
}): CompilerGymIrDeltaScreenAccountingRows {
	const environment = input.environment ?? DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT;
	validateFrozenEnvironment(environment);
	const parsed = parseAccountingRows(input.stdout);
	const rows = buildCompilerGymIrDeltaScreenAccountingRows(parsed, input.slurmId);
	return validateAccountingRows({
		rows,
		slurmId: input.slurmId,
		expectedJobName: input.expectedJobName,
		outcome: input.outcome,
		environment,
	});
}

function canonicalAggregate(
	aggregate:
		| CompilerGymIrDeltaScreenAggregate
		| CompilerGymCanonicalOneTaskAggregate
		| CompilerGymCanonicalOneTaskSemanticResultAggregate,
): string {
	return `${canonicalJson(toJsonValue(aggregate))}\n`;
}

export function parseCompilerGymIrDeltaScreenAggregate(stdout: string): CompilerGymIrDeltaScreenAggregate {
	if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n")) {
		throw new Error("IR-delta screen aggregate must be one newline-terminated JSON line");
	}
	const value = JSON.parse(stdout.slice(0, -1)) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("IR-delta screen aggregate must be an object");
	}
	const aggregate = value as CompilerGymIrDeltaScreenAggregate;
	if (
		aggregate.contract !== COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL ||
		aggregate.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
		aggregate.evaluatorSha256 !== COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256 ||
		aggregate.measurementReuse !== false ||
		!Array.isArray(aggregate.tasks) ||
		aggregate.tasks.length !== 2 ||
		aggregate.tasks.some(
			(task, index) =>
				task.benchmarkId !== COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[index] ||
				task.evaluatorSha256 !== COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256 ||
				sha256Text(task.stdout) !== task.stdoutSha256 ||
				sha256Text(task.stderr) !== task.stderrSha256,
		)
	) {
		throw new Error("IR-delta screen aggregate contract is invalid");
	}
	for (const task of aggregate.tasks) {
		if (!Object.hasOwn(task, "accountingRows")) {
			continue;
		}
		const accountingRows = task.accountingRows;
		if (task.accounting === null) {
			if (accountingRows !== null) {
				throw new Error("IR-delta screen aggregate has accounting rows without root accounting");
			}
			continue;
		}
		if (!accountingRows) {
			throw new Error("IR-delta screen aggregate lacks exact root/extern/.0 accounting rows");
		}
		if (canonicalJson(toJsonValue(accountingRows.root)) !== canonicalJson(toJsonValue(task.accounting))) {
			throw new Error("IR-delta screen root accounting differs from its accounting-row evidence");
		}
		const outcome = task.exitCode === 0 ? "verified" : task.exitCode === 5 ? "semantic-rejection" : null;
		if (!outcome) throw new Error("IR-delta screen aggregate has an unsupported evaluator exit code");
		validateAccountingRows({
			rows: accountingRows,
			slurmId: task.slurmId,
			expectedJobName: task.jobName,
			outcome,
			environment: DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
		});
	}
	if (stdout !== canonicalAggregate(aggregate)) throw new Error("IR-delta screen aggregate is not canonical JSON");
	return structuredClone(aggregate);
}

export function parseCompilerGymCanonicalOneTaskAggregate(stdout: string): CompilerGymCanonicalOneTaskAggregate {
	if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n")) {
		throw new Error("Canonical one-task aggregate must be one newline-terminated JSON line");
	}
	const value = JSON.parse(stdout.slice(0, -1)) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Canonical one-task aggregate must be an object");
	}
	const aggregate = value as CompilerGymCanonicalOneTaskAggregate;
	const task = aggregate.tasks?.[0];
	if (
		aggregate.contract !== COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL ||
		aggregate.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
		aggregate.evaluatorSha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		aggregate.measurementReuse !== false ||
		!Array.isArray(aggregate.tasks) ||
		aggregate.tasks.length !== 1 ||
		!task ||
		!COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS.includes(task.benchmarkId) ||
		task.evaluatorSha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		task.exitCode !== 0 ||
		sha256Text(task.stdout) !== task.stdoutSha256 ||
		sha256Text(task.stderr) !== task.stderrSha256 ||
		canonicalJson(toJsonValue(task.accountingRows.root)) !== canonicalJson(toJsonValue(task.accounting))
	) {
		throw new Error("Canonical one-task aggregate contract is invalid");
	}
	validateAccountingRows({
		rows: task.accountingRows,
		slurmId: task.slurmId,
		expectedJobName: task.jobName,
		outcome: "verified",
		environment: DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
	});
	if (stdout !== canonicalAggregate(aggregate)) {
		throw new Error("Canonical one-task aggregate is not canonical JSON");
	}
	return structuredClone(aggregate);
}

export function parseCompilerGymCanonicalOneTaskSemanticResultAggregate(
	stdout: string,
): CompilerGymCanonicalOneTaskSemanticResultAggregate {
	if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n")) {
		throw new Error("Canonical one-task semantic-result aggregate must be one newline-terminated JSON line");
	}
	const value = JSON.parse(stdout.slice(0, -1)) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Canonical one-task semantic-result aggregate must be an object");
	}
	const aggregate = value as CompilerGymCanonicalOneTaskSemanticResultAggregate;
	const task = aggregate.tasks?.[0];
	const outcome = task?.exitCode === 0 ? "verified" : task?.exitCode === 5 ? "semantic-rejection" : null;
	if (
		aggregate.contract !== COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL ||
		aggregate.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
		aggregate.evaluatorSha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		aggregate.measurementReuse !== false ||
		!Array.isArray(aggregate.tasks) ||
		aggregate.tasks.length !== 1 ||
		!task ||
		!outcome ||
		!COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS.includes(task.benchmarkId) ||
		task.evaluatorSha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		sha256Text(task.stdout) !== task.stdoutSha256 ||
		sha256Text(task.stderr) !== task.stderrSha256 ||
		canonicalJson(toJsonValue(task.accountingRows.root)) !== canonicalJson(toJsonValue(task.accounting))
	) {
		throw new Error("Canonical one-task semantic-result aggregate contract is invalid");
	}
	validateAccountingRows({
		rows: task.accountingRows,
		slurmId: task.slurmId,
		expectedJobName: task.jobName,
		outcome,
		environment: DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
	});
	if (stdout !== canonicalAggregate(aggregate)) {
		throw new Error("Canonical one-task semantic-result aggregate is not canonical JSON");
	}
	return structuredClone(aggregate);
}

export class FarmShareCompilerGymIrDeltaScreenAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	readonly deterministicMeasurementReuse = undefined;
	private readonly commandRunner: CompilerGymWarmCommandRunner;
	private readonly remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	private readonly clock: CompilerGymIrDeltaScreenAdapterClock;
	private readonly nonceFactory: () => string;
	private readonly usedDispatchNonces = new Set<string>();
	private readonly config: FarmShareCompilerGymIrDeltaScreenAdapterConfig;
	private prepareOperation: Promise<PreparedEvaluator> | undefined;

	constructor(
		config: FarmShareCompilerGymIrDeltaScreenAdapterConfig = DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
		dependencies: FarmShareCompilerGymIrDeltaScreenAdapterDependencies = {},
	) {
		validateFrozenEnvironment(config.environment);
		validateRemotePath(config.canonicalEvaluatorLocalPath, "Local canonical evaluator path");
		validateRemotePath(config.evaluatorLocalPath, "Local evaluator path");
		validatePositiveInteger(config.commandTimeoutMs, "commandTimeoutMs");
		validatePositiveInteger(config.maxActionCount, "maxActionCount");
		if (config.maxActionCount > COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT) {
			throw new Error(
				`maxActionCount may not exceed the frozen action-space size of ${COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT}`,
			);
		}
		if (
			config.accountingEvidenceVersion !== "root-only-v1" &&
			config.accountingEvidenceVersion !== "exact-three-row-v1"
		) {
			throw new Error("accountingEvidenceVersion must select a supported evidence contract");
		}
		validatePositiveInteger(config.accountingTimeoutMs, "accountingTimeoutMs");
		validatePositiveInteger(config.accountingPollMs, "accountingPollMs");
		this.config = { ...config, environment: structuredClone(config.environment) };
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
		this.remoteFileSystem =
			dependencies.remoteFileSystem ??
			new SshCompilerGymWarmRemoteFileSystem(
				this.commandRunner,
				this.config.environment.host,
				"/usr/bin/python3",
				this.config.commandTimeoutMs,
			);
		this.clock = dependencies.clock ?? new SystemCompilerGymIrDeltaScreenAdapterClock();
		this.nonceFactory = dependencies.nonceFactory ?? (() => randomBytes(8).toString("hex"));
	}

	async prepareCanonicalOneTask(signal: AbortSignal): Promise<CompilerGymCanonicalOneTaskPreparationEvidence> {
		if (this.config.accountingMode !== "required" || this.config.accountingEvidenceVersion !== "exact-three-row-v1") {
			throw new Error("Canonical one-task preparation requires exact three-row scheduler accounting");
		}
		const prepared = await this.prepare(signal);
		return {
			sourceBundleSha256: prepared.sourceBundleSha256,
			sourceDirectory: prepared.sourceDirectory,
			canonicalRemoteEvaluatorPath: prepared.canonicalRemoteEvaluatorPath,
			irDeltaRemoteEvaluatorPath: prepared.remoteEvaluatorPath,
		};
	}

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		validateJob(job);
		const actions = parseActions(job.candidateContent, this.config.maxActionCount);
		const nonce = this.nonceFactory();
		if (!NONCE_PATTERN.test(nonce)) throw new Error("Nonce factory must return 16 lowercase hex digits");
		if (this.usedDispatchNonces.has(nonce)) throw new Error("Dispatch nonce reuse is forbidden");
		this.usedDispatchNonces.add(nonce);
		const prepared = await this.prepare(context.signal);
		const evidence: CompilerGymIrDeltaScreenTaskEvidence[] = [];
		const tasks: TaskMeasurement[] = [];
		const slurmIds = new Set<string>();
		const caches = new Set<string>();
		const jobNames = new Set<string>();
		for (const [index, benchmarkId] of COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS.entries()) {
			const taskOrdinal = (index + 1) as 1 | 2;
			const built = compilerGymIrDeltaScreenSrunArgv({
				benchmarkId,
				taskOrdinal,
				dispatchNonce: nonce,
				remoteEvaluatorPath: prepared.remoteEvaluatorPath,
				environment: this.config.environment,
			});
			if (caches.has(built.transientCache) || jobNames.has(built.jobName)) {
				throw new Error("IR-delta screen cache or job name was reused");
			}
			caches.add(built.transientCache);
			jobNames.add(built.jobName);
			const request = `${canonicalJson(toJsonValue({ benchmark: benchmarkId, actions }))}\n`;
			const result = await this.commandRunner.run({
				argv: compilerGymWarmSshArgv(this.config.environment.host, built.argv),
				input: request,
				signal: context.signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: MAX_OUTPUT_BYTES,
			});
			if (result.exitCode === null) throw new Error(`${benchmarkId} evaluator has no exit code`);
			let parsed: ReturnType<typeof parseCompilerGymIrDeltaQualificationEvaluatorResult>;
			try {
				parsed = parseCompilerGymIrDeltaQualificationEvaluatorResult({
					stdout: result.stdout,
					exitCode: result.exitCode,
					arm: "one-env-ir-delta",
					benchmarkId,
					actions,
				});
				if (parsed.outcome === "verified" && (!parsed.trace || !parsed.traceIntegrity.passed)) {
					throw new Error(`${benchmarkId} returned a passing verifier without an integral IR-delta trace`);
				}
			} catch (error) {
				throw compilerGymIrDeltaScreenRawFailure({
					benchmarkId,
					taskOrdinal,
					request,
					result,
					phase: "evaluator-result-validation",
					cause: error,
					prepared,
					transientCache: built.transientCache,
					jobName: built.jobName,
					slurmId: null,
				});
			}
			if (slurmIds.has(parsed.slurmId)) throw new Error(`Slurm allocation ${parsed.slurmId} was reused`);
			slurmIds.add(parsed.slurmId);
			let collectedAccounting: CollectedAccounting | null;
			try {
				collectedAccounting = await this.collectAccounting(
					parsed.slurmId,
					built.jobName,
					parsed.outcome,
					context.signal,
				);
			} catch (error) {
				throw compilerGymIrDeltaScreenRawFailure({
					benchmarkId,
					taskOrdinal,
					request,
					result,
					phase: "scheduler-accounting",
					cause: error,
					prepared,
					transientCache: built.transientCache,
					jobName: built.jobName,
					slurmId: parsed.slurmId,
				});
			}
			const accounting = collectedAccounting?.root ?? null;
			const accountingRows = collectedAccounting?.rows ?? null;
			const runtimeMs = accounting ? accounting.elapsedRawSeconds * 1_000 : result.wallMs;
			const verifierPassed = parsed.outcome === "verified" && parsed.traceIntegrity.passed;
			tasks.push({
				benchmarkId,
				status: verifierPassed ? "accepted" : "rejected",
				metrics: {
					InitialIrInstructionCount: parsed.initialIrInstructionCount,
					IrInstructionCount: parsed.final.irInstructionCount,
					ObjectTextSizeBytes: parsed.final.objectTextSizeBytes,
					evaluatorRuntimeMs: parsed.intrinsicTotalMs,
					schedulerAndEvaluatorWallMs: runtimeMs,
					queueAndTransportMs: Math.max(0, runtimeMs - parsed.intrinsicTotalMs),
				},
				verifier: {
					passed: verifierPassed,
					checks: [
						"farmshare-environment-seal-v2",
						"pinned-cbench-patch-and-source",
						"pinned-action-space",
						"raw-metrics",
						"20-base-semantic-callbacks",
						"one-env-ir-delta-trace-integrity",
					],
					errors: verifierPassed
						? []
						: parsed.traceIntegrity.errors.length > 0
							? [...parsed.traceIntegrity.errors]
							: ["Canonical 20-input semantic verifier rejected the candidate"],
				},
				runtimeMs,
			});
			const taskEvidence: CompilerGymIrDeltaScreenTaskEvidence = {
				benchmarkId,
				requestSha256: sha256Text(request),
				evaluatorSha256: COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256,
				exitCode: result.exitCode,
				wallMs: result.wallMs,
				stdout: result.stdout,
				stdoutSha256: sha256Text(result.stdout),
				stderr: result.stderr,
				stderrSha256: sha256Text(result.stderr),
				slurmId: parsed.slurmId,
				transientCache: built.transientCache,
				jobName: built.jobName,
				accounting,
			};
			if (this.config.accountingEvidenceVersion === "exact-three-row-v1") {
				taskEvidence.accountingRows = accountingRows;
			}
			evidence.push(taskEvidence);
		}
		if (evidence.length !== 2 || slurmIds.size !== 2 || caches.size !== 2 || jobNames.size !== 2) {
			throw new Error("IR-delta screen did not produce two independent stock-cold allocations");
		}
		const aggregate: CompilerGymIrDeltaScreenAggregate = {
			contract: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
			jobId: job.jobId,
			manifestDigest: job.manifestDigest,
			candidateSha256: job.candidate.digest,
			actionsSha256: sha256Json(actions),
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			evaluatorSha256: COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256,
			measurementReuse: false,
			sourceBundleSha256: prepared.sourceBundleSha256,
			sourceDirectory: prepared.sourceDirectory,
			remoteEvaluatorPath: prepared.remoteEvaluatorPath,
			tasks: evidence,
		};
		const stdout = canonicalAggregate(aggregate);
		parseCompilerGymIrDeltaScreenAggregate(stdout);
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks,
			hardware: {
				cluster: "Stanford FarmShare",
				partition: this.config.environment.partition,
				cpuConstraint: this.config.environment.cpuConstraint,
			},
			provenance: { ...COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE },
			stdout,
			stderr: evidence
				.map((task) => task.stderr)
				.filter(Boolean)
				.join("\n"),
		};
	}

	async evaluateCanonicalOneTask(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		const benchmarkId = validateCanonicalOneTaskJob(job);
		if (this.config.accountingMode !== "required" || this.config.accountingEvidenceVersion !== "exact-three-row-v1") {
			throw new Error("Canonical one-task evaluation requires exact three-row scheduler accounting");
		}
		const actions = parseActions(job.candidateContent, this.config.maxActionCount);
		const nonce = this.nonceFactory();
		if (!NONCE_PATTERN.test(nonce)) throw new Error("Nonce factory must return 16 lowercase hex digits");
		if (this.usedDispatchNonces.has(nonce)) throw new Error("Dispatch nonce reuse is forbidden");
		this.usedDispatchNonces.add(nonce);
		const prepared = await this.prepare(context.signal);
		const canonicalPrepared: PreparedEvaluator = {
			...prepared,
			remoteEvaluatorPath: prepared.canonicalRemoteEvaluatorPath,
		};
		const taskOrdinal = (COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS.indexOf(benchmarkId) + 1) as 1 | 2;
		const built = compilerGymIrDeltaScreenSrunArgv({
			benchmarkId,
			taskOrdinal,
			dispatchNonce: nonce,
			remoteEvaluatorPath: prepared.canonicalRemoteEvaluatorPath,
			environment: this.config.environment,
		});
		const request = `${canonicalJson(toJsonValue({ benchmark: benchmarkId, actions }))}\n`;
		const result = await this.commandRunner.run({
			argv: compilerGymWarmSshArgv(this.config.environment.host, built.argv),
			input: request,
			signal: context.signal,
			timeoutMs: this.config.commandTimeoutMs,
			maxOutputBytes: MAX_OUTPUT_BYTES,
		});
		if (result.exitCode === null) throw new Error(`${benchmarkId} evaluator has no exit code`);
		let parsed: ReturnType<typeof parseCompilerGymIrDeltaQualificationEvaluatorResult>;
		try {
			parsed = parseCompilerGymIrDeltaQualificationEvaluatorResult({
				stdout: result.stdout,
				exitCode: result.exitCode,
				arm: "canonical",
				benchmarkId,
				actions,
			});
			if (parsed.outcome !== "verified" || !parsed.final.verifierPassed) {
				throw new Error("Canonical one-task evaluator did not return an exact passing verifier result");
			}
		} catch (error) {
			throw compilerGymCanonicalOneTaskRawFailure({
				benchmarkId,
				taskOrdinal,
				request,
				result,
				phase: "evaluator-result-validation",
				cause: error,
				prepared: canonicalPrepared,
				transientCache: built.transientCache,
				jobName: built.jobName,
				slurmId: null,
			});
		}
		await context.recordExternalJobId(parsed.slurmId);
		let collectedAccounting: CollectedAccounting;
		try {
			const collected = await this.collectAccounting(parsed.slurmId, built.jobName, parsed.outcome, context.signal);
			if (!collected?.rows) {
				throw new Error("Canonical one-task evaluation lacks exact root/extern/.0 accounting rows");
			}
			collectedAccounting = collected;
		} catch (error) {
			throw compilerGymCanonicalOneTaskRawFailure({
				benchmarkId,
				taskOrdinal,
				request,
				result,
				phase: "scheduler-accounting",
				cause: error,
				prepared: canonicalPrepared,
				transientCache: built.transientCache,
				jobName: built.jobName,
				slurmId: parsed.slurmId,
			});
		}
		const accountingRows = collectedAccounting.rows;
		if (!accountingRows) throw new Error("Canonical one-task accounting rows disappeared after validation");
		const accounting = collectedAccounting.root;
		const runtimeMs = accounting.elapsedRawSeconds * 1_000;
		const task: TaskMeasurement = {
			benchmarkId,
			status: "accepted",
			metrics: {
				InitialIrInstructionCount: parsed.initialIrInstructionCount,
				IrInstructionCount: parsed.final.irInstructionCount,
				ObjectTextSizeBytes: parsed.final.objectTextSizeBytes,
				evaluatorRuntimeMs: parsed.intrinsicTotalMs,
				schedulerAndEvaluatorWallMs: runtimeMs,
				queueAndTransportMs: Math.max(0, runtimeMs - parsed.intrinsicTotalMs),
			},
			verifier: {
				passed: true,
				checks: [
					"farmshare-environment-seal-v2",
					"pinned-cbench-patch-and-source",
					"pinned-action-space",
					"raw-metrics",
					"20-base-semantic-callbacks",
				],
				errors: [],
			},
			runtimeMs,
		};
		const taskEvidence: CompilerGymCanonicalOneTaskEvidence = {
			benchmarkId,
			requestSha256: sha256Text(request),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			exitCode: result.exitCode,
			wallMs: result.wallMs,
			stdout: result.stdout,
			stdoutSha256: sha256Text(result.stdout),
			stderr: result.stderr,
			stderrSha256: sha256Text(result.stderr),
			slurmId: parsed.slurmId,
			transientCache: built.transientCache,
			jobName: built.jobName,
			accounting,
			accountingRows,
		};
		const aggregate: CompilerGymCanonicalOneTaskAggregate = {
			contract: COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
			jobId: job.jobId,
			manifestDigest: job.manifestDigest,
			candidateSha256: job.candidate.digest,
			actionsSha256: sha256Json(actions),
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			measurementReuse: false,
			sourceBundleSha256: prepared.sourceBundleSha256,
			sourceDirectory: prepared.sourceDirectory,
			remoteEvaluatorPath: prepared.canonicalRemoteEvaluatorPath,
			tasks: [taskEvidence],
		};
		const stdout = canonicalAggregate(aggregate);
		parseCompilerGymCanonicalOneTaskAggregate(stdout);
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: [task],
			hardware: {
				cluster: "Stanford FarmShare",
				partition: this.config.environment.partition,
				cpuConstraint: this.config.environment.cpuConstraint,
			},
			provenance: { ...COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE },
			stdout,
			stderr: result.stderr,
		};
	}

	async evaluateCanonicalOneTaskSemanticResult(
		job: EvaluationJob,
		context: EvaluationContext,
	): Promise<EvaluationOutcome> {
		const benchmarkId = validateCanonicalOneTaskJob(job);
		if (this.config.accountingMode !== "required" || this.config.accountingEvidenceVersion !== "exact-three-row-v1") {
			throw new Error("Canonical one-task semantic-result evaluation requires exact three-row scheduler accounting");
		}
		const actions = parseActions(job.candidateContent, this.config.maxActionCount);
		const nonce = this.nonceFactory();
		if (!NONCE_PATTERN.test(nonce)) throw new Error("Nonce factory must return 16 lowercase hex digits");
		if (this.usedDispatchNonces.has(nonce)) throw new Error("Dispatch nonce reuse is forbidden");
		this.usedDispatchNonces.add(nonce);
		const prepared = await this.prepare(context.signal);
		const canonicalPrepared: PreparedEvaluator = {
			...prepared,
			remoteEvaluatorPath: prepared.canonicalRemoteEvaluatorPath,
		};
		const taskOrdinal = (COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS.indexOf(benchmarkId) + 1) as 1 | 2;
		const built = compilerGymIrDeltaScreenSrunArgv({
			benchmarkId,
			taskOrdinal,
			dispatchNonce: nonce,
			remoteEvaluatorPath: prepared.canonicalRemoteEvaluatorPath,
			environment: this.config.environment,
		});
		const request = `${canonicalJson(toJsonValue({ benchmark: benchmarkId, actions }))}\n`;
		const result = await this.commandRunner.run({
			argv: compilerGymWarmSshArgv(this.config.environment.host, built.argv),
			input: request,
			signal: context.signal,
			timeoutMs: this.config.commandTimeoutMs,
			maxOutputBytes: MAX_OUTPUT_BYTES,
		});
		if (result.exitCode === null) throw new Error(`${benchmarkId} evaluator has no exit code`);
		let parsed: ReturnType<typeof parseCompilerGymIrDeltaQualificationEvaluatorResult>;
		try {
			parsed = parseCompilerGymIrDeltaQualificationEvaluatorResult({
				stdout: result.stdout,
				exitCode: result.exitCode,
				arm: "canonical-semantic-result",
				benchmarkId,
				actions,
			});
		} catch (error) {
			throw compilerGymCanonicalOneTaskRawFailure({
				benchmarkId,
				taskOrdinal,
				request,
				result,
				phase: "evaluator-result-validation",
				cause: error,
				prepared: canonicalPrepared,
				transientCache: built.transientCache,
				jobName: built.jobName,
				slurmId: null,
			});
		}
		await context.recordExternalJobId(parsed.slurmId);
		let collectedAccounting: CollectedAccounting;
		try {
			const collected = await this.collectAccounting(parsed.slurmId, built.jobName, parsed.outcome, context.signal);
			if (!collected?.rows) {
				throw new Error("Canonical one-task semantic-result evaluation lacks exact root/extern/.0 accounting rows");
			}
			collectedAccounting = collected;
		} catch (error) {
			throw compilerGymCanonicalOneTaskRawFailure({
				benchmarkId,
				taskOrdinal,
				request,
				result,
				phase: "scheduler-accounting",
				cause: error,
				prepared: canonicalPrepared,
				transientCache: built.transientCache,
				jobName: built.jobName,
				slurmId: parsed.slurmId,
			});
		}
		const accountingRows = collectedAccounting.rows;
		if (!accountingRows) {
			throw new Error("Canonical one-task semantic-result accounting rows disappeared after validation");
		}
		const accounting = collectedAccounting.root;
		const runtimeMs = accounting.elapsedRawSeconds * 1_000;
		const accepted = parsed.outcome === "verified" && parsed.final.verifierPassed;
		const task: TaskMeasurement = {
			benchmarkId,
			status: accepted ? "accepted" : "rejected",
			metrics: {
				InitialIrInstructionCount: parsed.initialIrInstructionCount,
				IrInstructionCount: parsed.final.irInstructionCount,
				ObjectTextSizeBytes: parsed.final.objectTextSizeBytes,
				evaluatorRuntimeMs: parsed.intrinsicTotalMs,
				schedulerAndEvaluatorWallMs: runtimeMs,
				queueAndTransportMs: Math.max(0, runtimeMs - parsed.intrinsicTotalMs),
			},
			verifier: {
				passed: accepted,
				checks: [
					"farmshare-environment-seal-v2",
					"pinned-cbench-patch-and-source",
					"pinned-action-space",
					"raw-metrics",
					"20-base-semantic-callbacks",
				],
				errors: accepted ? [] : ["Canonical 20-input semantic verifier rejected the candidate"],
			},
			runtimeMs,
		};
		const taskEvidence: CompilerGymCanonicalOneTaskEvidence = {
			benchmarkId,
			requestSha256: sha256Text(request),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			exitCode: result.exitCode,
			wallMs: result.wallMs,
			stdout: result.stdout,
			stdoutSha256: sha256Text(result.stdout),
			stderr: result.stderr,
			stderrSha256: sha256Text(result.stderr),
			slurmId: parsed.slurmId,
			transientCache: built.transientCache,
			jobName: built.jobName,
			accounting,
			accountingRows,
		};
		const aggregate: CompilerGymCanonicalOneTaskSemanticResultAggregate = {
			contract: COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL,
			jobId: job.jobId,
			manifestDigest: job.manifestDigest,
			candidateSha256: job.candidate.digest,
			actionsSha256: sha256Json(actions),
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			measurementReuse: false,
			sourceBundleSha256: prepared.sourceBundleSha256,
			sourceDirectory: prepared.sourceDirectory,
			remoteEvaluatorPath: prepared.canonicalRemoteEvaluatorPath,
			tasks: [taskEvidence],
		};
		const stdout = canonicalAggregate(aggregate);
		parseCompilerGymCanonicalOneTaskSemanticResultAggregate(stdout);
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: [task],
			hardware: {
				cluster: "Stanford FarmShare",
				partition: this.config.environment.partition,
				cpuConstraint: this.config.environment.cpuConstraint,
			},
			provenance: { ...COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE },
			stdout,
			stderr: result.stderr,
		};
	}

	private prepare(signal: AbortSignal): Promise<PreparedEvaluator> {
		if (!this.prepareOperation) {
			this.prepareOperation = this.uploadEvaluator(signal).catch((error: unknown) => {
				this.prepareOperation = undefined;
				throw error;
			});
		}
		return this.prepareOperation;
	}

	private async uploadEvaluator(signal: AbortSignal): Promise<PreparedEvaluator> {
		const [canonicalSource, source] = await Promise.all([
			readFile(this.config.canonicalEvaluatorLocalPath, "utf8"),
			readFile(this.config.evaluatorLocalPath, "utf8"),
		]);
		const canonicalDigest = sha256Text(canonicalSource);
		const digest = sha256Text(source);
		if (canonicalDigest !== COMPILER_GYM_EVALUATOR_SHA256) {
			throw new Error("Canonical evaluator differs from the frozen verifier source");
		}
		if (digest !== COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256) {
			throw new Error("IR-delta evaluator differs from the frozen qualification source");
		}
		const sourceBundleSha256 = sha256Json({
			canonicalEvaluatorSha256: canonicalDigest,
			irDeltaEvaluatorSha256: digest,
		});
		const sourceDirectory = posix.join(this.config.environment.remoteSourceRoot, sourceBundleSha256);
		const canonicalRemotePath = posix.join(sourceDirectory, "compiler_gym_eval.py");
		const remoteEvaluatorPath = posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py");
		await ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree(this.remoteFileSystem, sourceDirectory, signal);
		for (const [path, content, expectedSha256] of [
			[canonicalRemotePath, canonicalSource, canonicalDigest],
			[remoteEvaluatorPath, source, digest],
		] as const) {
			await this.remoteFileSystem.installImmutableFile(path, content, expectedSha256, 0o600, true, signal);
			const observed = await this.remoteFileSystem.readTrustedFile(
				path,
				{ maxBytes: MAX_OUTPUT_BYTES, mode: 0o600, expectedSha256 },
				signal,
			);
			if (observed !== content || sha256Text(observed) !== expectedSha256) {
				throw new Error(`Remote evaluator post-install verification failed for ${path}`);
			}
		}
		return {
			sourceBundleSha256,
			sourceDirectory,
			canonicalRemoteEvaluatorPath: canonicalRemotePath,
			remoteEvaluatorPath,
		};
	}

	private async collectAccounting(
		slurmId: string,
		expectedJobName: string,
		outcome: "verified" | "semantic-rejection",
		signal: AbortSignal,
	): Promise<CollectedAccounting | null> {
		if (this.config.accountingMode === "disabled") return null;
		const startedAt = this.clock.monotonicMs();
		while (true) {
			const result = await this.commandRunner.run({
				argv: compilerGymWarmSshArgv(
					this.config.environment.host,
					sacctArgv(slurmId, this.config.accountingEvidenceVersion),
				),
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			if (result.exitCode !== 0) {
				if (this.config.accountingMode === "best-effort") return null;
				throw new Error(`sacct failed for ${slurmId}: ${result.stderr.trim()}`);
			}
			if (result.stdout.trim()) {
				const parsedRows = parseAccountingRows(result.stdout);
				const root = parsedRows.find((row) => row.jobIdRaw === slurmId);
				if (root && TERMINAL_ACCOUNTING_STATES.has(normalizedAccountingState(root.state))) {
					if (this.config.accountingEvidenceVersion === "root-only-v1") {
						if (parsedRows.length !== 1) throw new Error("root-only sacct returned subordinate rows");
						return {
							root: validateRootAccounting({
								root,
								slurmId,
								expectedJobName,
								outcome,
								environment: this.config.environment,
							}),
						};
					}
					const expectedIds = new Set([slurmId, `${slurmId}.extern`, `${slurmId}.0`]);
					const observedIds = new Set(parsedRows.map((row) => row.jobIdRaw));
					const partialExactSet =
						parsedRows.length < 3 &&
						observedIds.size === parsedRows.length &&
						parsedRows.every((row) => expectedIds.has(row.jobIdRaw));
					validateRootAccountingShape({
						root,
						slurmId,
						expectedJobName,
						environment: this.config.environment,
					});
					validateRootAccountingOutcome(root, outcome);
					if (!partialExactSet) {
						const rows = buildCompilerGymIrDeltaScreenAccountingRows(parsedRows, slurmId);
						validateAccountingRowsShape({
							rows,
							slurmId,
							expectedJobName,
							environment: this.config.environment,
						});
						validateAccountingRowsTerminalOutcomes(rows, outcome);
						const pendingRows = [rows.root, rows.extern, rows.step].map(accountingRowIsPending);
						if (!pendingRows.some(Boolean)) {
							return {
								root: rows.root,
								rows: validateAccountingRows({
									rows,
									slurmId,
									expectedJobName,
									outcome,
									environment: this.config.environment,
								}),
							};
						}
					}
				} else if (root && !NONTERMINAL_ACCOUNTING_STATES.has(normalizedAccountingState(root.state))) {
					throw new Error(`sacct ${root.jobIdRaw} State is not recognized`);
				}
			}
			if (this.config.accountingMode === "best-effort") return null;
			if (this.clock.monotonicMs() - startedAt >= this.config.accountingTimeoutMs) {
				throw new Error(`Timed out waiting for sacct ${slurmId}`);
			}
			await this.clock.sleep(this.config.accountingPollMs, signal);
		}
	}
}

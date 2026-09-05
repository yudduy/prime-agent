import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	assessCompilerGymTaskProcess,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "./compiler-gym-adapter.js";
import {
	COMPILER_GYM_JOB_STEP_C1_FIXTURE,
	COMPILER_GYM_JOB_STEP_C1_TASKS,
} from "./compiler-gym-job-step-c1-fixture.js";
import {
	buildCompilerGymJobStepSourceBootstrap,
	COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL,
	type CompilerGymJobStepSourceBootstrap,
} from "./compiler-gym-job-step-source-bootstrap.js";
import {
	type CompilerGymWarmCommandResult,
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	compilerGymWarmSshArgv,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { COMPILER_GYM_WARM_LAUNCH_CONTRACT } from "./compiler-gym-warm-transport.js";
import type { TaskMeasurement } from "./types.js";

export const COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL = "compiler-gym-job-step-c1-qualification-v1" as const;
export const COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL = "compiler-gym-job-step-request-v1" as const;
export const COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL = "compiler-gym-job-step-result-v1" as const;
export const COMPILER_GYM_JOB_STEP_FAILURE_EVIDENCE_PROTOCOL = "compiler-gym-job-step-c1-failure-evidence-v1" as const;
export const COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS = 124_792_743_916n;
export const COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS = 59_339_472_757n;
export const COMPILER_GYM_JOB_STEP_ACQUISITION_REFERENCE_NS = 17_540_192_708n;
export const COMPILER_GYM_JOB_STEP_REFERENCE_OVERHEAD_CEILING_NS = 8_858_451_014n;

const ROOT_CPUS = 4;
const ROOT_TASKS = 2;
const CPUS_PER_TASK = 2;
const RECORD_MODE = 0o600;
const MAX_CONTROL_OUTPUT_BYTES = 1024 * 1024;
const MAX_STEP_OUTPUT_BYTES = 8 * 1024 * 1024;
const TERMINAL_INVENTORY_STABILIZATION_MS = 5_000;
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
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROOT_ID_PATTERN = /^[1-9][0-9]*$/;
const STEP_ID_PATTERN = /^[0-9]+$/;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SAFE_USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const SAFE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]+$/;

export interface CompilerGymJobStepQualificationConfig {
	host: string;
	user: string;
	remoteRoot: string;
	remoteControlPython: string;
	localWorkerPath: string;
	localEvaluatorPath: string;
	partition: string;
	cpuConstraint: string;
	pythonPath: string;
	compilerGymCache: string;
	compilerGymSiteData: string;
	compatibilityLibraryDir: string;
	memory: string;
	rootTimeLimit: string;
	rootPendingDeadline: string;
	commandTimeoutMs: number;
	acquisitionTimeoutMs: number;
	stepTimeoutMs: number;
	stepAccountingTimeoutMs: number;
	cleanupTimeoutMs: number;
	dispatchVisibilityGraceMs: number;
	pollIntervalMs: number;
}

export const DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG: CompilerGymJobStepQualificationConfig = {
	host: "farmshare",
	user: "duynguy",
	remoteRoot: "/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-job-step-v1",
	remoteControlPython: "/usr/bin/python3",
	localWorkerPath: fileURLToPath(new URL("../evaluators/compiler_gym_job_step_worker.py", import.meta.url)),
	localEvaluatorPath: fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url)),
	partition: COMPILER_GYM_WARM_LAUNCH_CONTRACT.partition,
	cpuConstraint: COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpuConstraint,
	pythonPath: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
	compilerGymCache: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache,
	compilerGymSiteData: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData,
	compatibilityLibraryDir: COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath,
	memory: COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory,
	rootTimeLimit: "00:05:00",
	rootPendingDeadline: "now+15minutes",
	commandTimeoutMs: 30_000,
	acquisitionTimeoutMs: 10 * 60_000,
	stepTimeoutMs: 6 * 60_000,
	stepAccountingTimeoutMs: 60_000,
	cleanupTimeoutMs: 3 * 60_000,
	dispatchVisibilityGraceMs: 2 * 60_000,
	pollIntervalMs: 1_000,
};

export interface CompilerGymJobStepClock {
	now(): Date;
	nowNs(): bigint;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface CompilerGymJobStepDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	clock?: CompilerGymJobStepClock;
	expectedWorkerSha256: string;
}

export interface CompilerGymJobStepRunHooks {
	recordDispatchIntent(record: {
		protocol: typeof COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL;
		qualificationId: string;
		jobName: string;
		candidateJobName: string;
		workDir: string;
		identityComment: string;
		rootScriptSha256: string;
		sbatchArgv: string[];
		sbatchArgvSha256: string;
		workerSha256: string;
		evaluatorSha256: string;
		recordedAt: string;
	}): Promise<void>;
	recordRootSubmitted(record: {
		protocol: typeof COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL;
		qualificationId: string;
		rootJobId: string;
		jobName: string;
		workDir: string;
		submittedAt: string;
	}): Promise<void>;
	recordRootHeldVerified(record: {
		protocol: typeof COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL;
		qualificationId: string;
		rootJobId: string;
		jobName: string;
		workDir: string;
		identityComment: string;
		rootScriptSha256: string;
		spooledScriptSha256: string;
		heldState: "PENDING";
		heldReason: "JobHeldUser";
		batchFlag: 1;
		priority: 0;
		validatedAt: string;
	}): Promise<void>;
	recordRootReleaseIntent(record: {
		protocol: typeof COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL;
		qualificationId: string;
		rootJobId: string;
		jobName: string;
		workDir: string;
		identityComment: string;
		recordedAt: string;
	}): Promise<void>;
	recordRootReady(record: {
		protocol: typeof COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL;
		qualificationId: string;
		rootJobId: string;
		jobName: string;
		workDir: string;
		validatedAt: string;
	}): Promise<void>;
}

export interface CompilerGymJobStepCommandEvidence {
	sequence: number;
	label: string;
	remoteArgv: string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	wallMs: number;
	stdoutSha256: string;
	stderrSha256: string;
	inputBytes: number;
	inputSha256: string;
	capturedAt: string;
	transportError?: string;
}

export interface CompilerGymJobStepRootIdentity {
	qualificationId: string;
	user: string;
	jobName: string;
	candidateJobName: string;
	workDir: string;
	identityComment: string;
}

export interface CompilerGymJobStepRequestRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL;
	candidateId: "C1";
	requestSha256: string;
	actionsSha256: string;
	actions: string[];
	tasks: [string, string];
	workerSha256: string;
	evaluatorSha256: string;
	verifierEpoch: string;
	createdAt: string;
}

export interface CompilerGymJobStepResultRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL;
	rootJobId: string;
	stepId: string;
	rank: 0 | 1;
	benchmarkId: string;
	requestFileSha256: string;
	requestSha256: string;
	workerSha256: string;
	evaluatorSha256: string;
	childExitCode: number | null;
	stdout: string;
	stderr: string;
	childStartedNs: string;
	childFinishedNs: string;
	childWallNs: string;
	hostname: string;
	startedAt: string;
	completedAt: string;
	wrapperStartedNs: string;
	wrapperFinishedNs: string;
	wrapperWallNs: string;
}

export interface CompilerGymJobStepAccountingRecord {
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

export interface CompilerGymJobStepQualificationObservation {
	protocol: typeof COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL;
	qualificationId: string;
	jobName: string;
	workDir: string;
	identityComment: string;
	rootScriptSha256: string;
	rootJobId: string;
	request: CompilerGymJobStepRequestRecord;
	requestFileSha256: string;
	workerSha256: string;
	evaluatorSha256: string;
	acquisitionStartedNs: string;
	acquisitionReadyNs: string;
	acquisitionDurationNs: string;
	candidateStartedNs: string;
	requestPublishedNs: string;
	srunStartedNs: string;
	srunFinishedNs: string;
	candidateFinishedNs: string;
	candidateDurationNs: string;
	results: [CompilerGymJobStepResultRecord, CompilerGymJobStepResultRecord];
	tasks: [TaskMeasurement, TaskMeasurement];
	stepAccounting: CompilerGymJobStepAccountingRecord;
	stepInventory: CompilerGymJobStepAccountingRecord[];
	rootAccounting: CompilerGymJobStepAccountingRecord;
	terminalStepInventory: CompilerGymJobStepAccountingRecord[];
	cleanup: { schedulerAbsent: true; terminalState: string; matchingRootIds: [string] };
	commands: CompilerGymJobStepCommandEvidence[];
}

export type CompilerGymJobStepCandidateEvidence = Omit<
	CompilerGymJobStepQualificationObservation,
	"rootAccounting" | "terminalStepInventory" | "cleanup" | "commands"
>;

export interface CompilerGymJobStepFailureCleanupAttempt {
	rootJobId: string;
	accounting: CompilerGymJobStepAccountingRecord | null;
	terminalStepInventory: CompilerGymJobStepAccountingRecord[];
	schedulerAbsent: true | null;
	matchingRootIds: [string] | [];
	error: string | null;
}

export interface CompilerGymJobStepQualificationFailureEvidence {
	protocol: typeof COMPILER_GYM_JOB_STEP_FAILURE_EVIDENCE_PROTOCOL;
	qualificationId: string;
	jobName: string;
	workDir: string;
	identityComment: string;
	submissionAttempted: true;
	rootJobId: string | null;
	discoveredRootIds: string[];
	candidate: CompilerGymJobStepCandidateEvidence | null;
	cleanupAttempts: CompilerGymJobStepFailureCleanupAttempt[];
	commands: CompilerGymJobStepCommandEvidence[];
	primaryError: string | null;
	cleanupError: string | null;
	capturedAt: string;
}

export class CompilerGymJobStepQualificationFailure extends Error {
	readonly evidence: CompilerGymJobStepQualificationFailureEvidence;

	constructor(evidence: CompilerGymJobStepQualificationFailureEvidence) {
		const detail = evidence.primaryError ?? evidence.cleanupError ?? "unknown post-submit failure";
		super(`CompilerGym job-step qualification failed after submission: ${detail}`);
		this.name = "CompilerGymJobStepQualificationFailure";
		this.evidence = evidence;
	}
}

export interface CompilerGymJobStepQualificationAnalysis {
	protocol: typeof COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL;
	integrityPassed: true;
	acquisitionDurationNs: string;
	candidateDurationNs: string;
	criticalChildDurationNs: string;
	dispatchOverheadNs: string;
	dynamicOverheadCeilingNs: string;
	referenceOverheadCeilingNs: string;
	projectedFourCallTotalNs: string;
	stockColdReferenceNs: string;
	strongLatencyGatePassed: boolean;
	decision: "qualify-c1-c4-screen" | "kill-job-step-transport";
	claimClass: "historical-control-operational-projection";
	causalClaimAllowed: false;
}

class SystemCompilerGymJobStepClock implements CompilerGymJobStepClock {
	now(): Date {
		return new Date();
	}

	nowNs(): bigint {
		return process.hrtime.bigint();
	}

	sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			const timeout = setTimeout(finish, ms);
			function finish(): void {
				signal.removeEventListener("abort", abort);
				resolve();
			}
			function abort(): void {
				clearTimeout(timeout);
				signal.removeEventListener("abort", abort);
				reject(signal.reason);
			}
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}

function validateToken(value: string, label: string): void {
	if (!SAFE_TOKEN_PATTERN.test(value)) throw new Error(`${label} is unsafe`);
}

function validatePath(value: string, label: string): void {
	if (!SAFE_PATH_PATTERN.test(value) || posix.normalize(value) !== value) throw new Error(`${label} is unsafe`);
}

function requireSha256(value: unknown, label: string): string {
	if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${label} must be SHA-256`);
	return value;
}

function requireTimestamp(value: unknown, label: string): string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
		throw new Error(`${label} is not an ISO timestamp`);
	return value;
}

function requireNonnegativeNs(value: unknown, label: string): bigint {
	if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
		throw new Error(`${label} must be a nonnegative integer string`);
	}
	return BigInt(value);
}

function requireRootId(value: unknown, label: string): string {
	if (typeof value !== "string" || !ROOT_ID_PATTERN.test(value)) throw new Error(`${label} is not a root job ID`);
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys mismatch`);
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function qualificationErrorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function makeSignal(parent: AbortSignal, timeoutMs: number, label: string): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const abort = (): void => controller.abort(parent.reason);
	parent.addEventListener("abort", abort, { once: true });
	const timeout = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs);
	if (parent.aborted) abort();
	return {
		signal: controller.signal,
		dispose() {
			clearTimeout(timeout);
			parent.removeEventListener("abort", abort);
		},
	};
}

function shellQuote(value: string): string {
	if (/[\0\n\r]/.test(value)) throw new Error("Shell argument contains a forbidden control character");
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseScontrol(stdout: string): Map<string, string> {
	const lines = stdout.trim().split("\n").filter(Boolean);
	if (lines.length !== 1) throw new Error(`Expected one scontrol line, received ${lines.length}`);
	const fields = new Map<string, string>();
	for (const token of lines[0].trim().split(/\s+/)) {
		const separator = token.indexOf("=");
		if (separator < 1) continue;
		const key = token.slice(0, separator);
		if (fields.has(key)) throw new Error(`Duplicate scontrol field ${key}`);
		fields.set(key, token.slice(separator + 1));
	}
	return fields;
}

function normalizeState(value: string): string {
	return value.trim().split(/[ +]/)[0];
}

function parseCompilerGymJobStepAccountingLine(line: string): CompilerGymJobStepAccountingRecord {
	const fields = line.split("|");
	if (fields.at(-1) === "") fields.pop();
	if (fields.length !== 11) throw new Error(`Expected 11 accounting fields, received ${fields.length}`);
	const allocCpus = Number(fields[4]);
	const nTasks = fields[5] === "Unknown" || fields[5] === "" ? null : Number(fields[5]);
	const elapsedRawSeconds = Number(fields[6]);
	const cpuTimeRawSeconds = Number(fields[7]);
	for (const [label, value] of [
		["AllocCPUS", allocCpus],
		["ElapsedRaw", elapsedRawSeconds],
		["CPUTimeRAW", cpuTimeRawSeconds],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid accounting ${label}`);
	}
	if (nTasks !== null && (!Number.isSafeInteger(nTasks) || nTasks < 0)) throw new Error("Invalid accounting NTasks");
	const result: CompilerGymJobStepAccountingRecord = {
		jobIdRaw: fields[0],
		jobName: fields[1],
		state: normalizeState(fields[2]),
		exitCode: fields[3],
		allocCpus,
		nTasks,
		elapsedRawSeconds,
		cpuTimeRawSeconds,
		nodeList: fields[8],
		startAt: fields[9],
		endAt: fields[10],
	};
	if (!/^[0-9]+:[0-9]+$/.test(result.exitCode)) throw new Error("Invalid accounting ExitCode");
	assert.equal(result.cpuTimeRawSeconds, result.allocCpus * result.elapsedRawSeconds);
	return result;
}

export function parseCompilerGymJobStepAccountingRows(stdout: string): CompilerGymJobStepAccountingRecord[] {
	return stdout.trim().split("\n").filter(Boolean).map(parseCompilerGymJobStepAccountingLine);
}

export function parseCompilerGymJobStepAccounting(
	stdout: string,
	expected: { jobIdRaw: string; jobName: string; allocCpus: number; nTasks: number | null },
): CompilerGymJobStepAccountingRecord {
	const rows = parseCompilerGymJobStepAccountingRows(stdout);
	if (rows.length !== 1) throw new Error(`Expected one accounting row, received ${rows.length}`);
	const result = rows[0];
	assert.equal(result.jobIdRaw, expected.jobIdRaw);
	assert.equal(result.jobName, expected.jobName);
	assert.equal(result.allocCpus, expected.allocCpus);
	assert.equal(result.nTasks, expected.nTasks);
	return result;
}

export function validateCompilerGymJobStepInventory(
	rows: readonly CompilerGymJobStepAccountingRecord[],
	expected: {
		rootJobId: string;
		rootJobName: string;
		rootState: "RUNNING" | "CANCELLED";
		stepId: string;
		stepJobName: string;
		hostname: string;
	},
): void {
	requireRootId(expected.rootJobId, "inventory root job ID");
	if (!STEP_ID_PATTERN.test(expected.stepId)) throw new Error("Inventory step ID is invalid");
	const expectedStepJobId = `${expected.rootJobId}.${expected.stepId}`;
	const allowedIds = new Set([
		expected.rootJobId,
		`${expected.rootJobId}.batch`,
		`${expected.rootJobId}.extern`,
		expectedStepJobId,
	]);
	const ids = rows.map((row) => row.jobIdRaw);
	assert.equal(new Set(ids).size, ids.length, "Step inventory contains duplicate accounting rows");
	for (const id of ids) assert.ok(allowedIds.has(id), `Unexpected accounting step ${id}`);
	const rootRows = rows.filter((row) => row.jobIdRaw === expected.rootJobId);
	assert.equal(rootRows.length, 1, "Step inventory must contain exactly one root row");
	const root = rootRows[0];
	assert.equal(root.jobName, expected.rootJobName);
	assert.equal(root.state, expected.rootState);
	assert.equal(root.allocCpus, ROOT_CPUS);
	assert.equal(root.nodeList, expected.hostname);
	const numberedSteps = rows.filter((row) => {
		const match = new RegExp(`^${expected.rootJobId}\\.([0-9]+)$`).exec(row.jobIdRaw);
		return match !== null;
	});
	assert.equal(numberedSteps.length, 1, "Step inventory must contain exactly one numbered step");
	const step = numberedSteps[0];
	assert.equal(step.jobIdRaw, expectedStepJobId);
	assert.equal(step.jobName, expected.stepJobName);
	assert.equal(step.state, "COMPLETED");
	assert.equal(step.exitCode, "0:0");
	assert.equal(step.allocCpus, ROOT_CPUS);
	assert.equal(step.nTasks, ROOT_TASKS);
	assert.equal(step.nodeList, expected.hostname);
	for (const support of rows.filter((row) => row.jobIdRaw.endsWith(".batch") || row.jobIdRaw.endsWith(".extern"))) {
		assert.equal(support.jobName, support.jobIdRaw.endsWith(".batch") ? "batch" : "extern");
		assert.equal(support.nodeList, expected.hostname);
	}
}

export function parseCompilerGymJobStepResults(
	stdout: string,
	expected: {
		rootJobId: string;
		requestFileSha256: string;
		requestSha256: string;
		workerSha256: string;
		evaluatorSha256: string;
	},
): [CompilerGymJobStepResultRecord, CompilerGymJobStepResultRecord] {
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length !== 2) throw new Error(`Expected two labelled result lines, received ${lines.length}`);
	const parsed = lines.map((line, index): CompilerGymJobStepResultRecord => {
		const match = /^(\d+):\s+(\{.*\})$/.exec(line);
		if (!match) throw new Error(`Result line ${index} lacks a Slurm rank label`);
		const labelRank = Number(match[1]);
		const record = objectRecord(JSON.parse(match[2]) as unknown, `result[${index}]`);
		exactKeys(
			record,
			[
				"benchmarkId",
				"childExitCode",
				"childFinishedNs",
				"childStartedNs",
				"childWallNs",
				"completedAt",
				"evaluatorSha256",
				"hostname",
				"protocol",
				"rank",
				"requestFileSha256",
				"requestSha256",
				"rootJobId",
				"startedAt",
				"stderr",
				"stdout",
				"stepId",
				"workerSha256",
				"wrapperFinishedNs",
				"wrapperStartedNs",
				"wrapperWallNs",
			],
			`result[${index}]`,
		);
		if (record.protocol !== COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL) throw new Error("Result protocol mismatch");
		if (record.rank !== 0 && record.rank !== 1) throw new Error("Result rank mismatch");
		const rank = record.rank;
		assert.equal(labelRank, rank, "Slurm label and result rank differ");
		assert.equal(record.rootJobId, expected.rootJobId);
		assert.equal(record.benchmarkId, COMPILER_GYM_JOB_STEP_C1_TASKS[rank]);
		assert.equal(record.requestFileSha256, expected.requestFileSha256);
		assert.equal(record.requestSha256, expected.requestSha256);
		assert.equal(record.workerSha256, expected.workerSha256);
		assert.equal(record.evaluatorSha256, expected.evaluatorSha256);
		if (typeof record.stepId !== "string" || !STEP_ID_PATTERN.test(record.stepId)) throw new Error("Invalid step ID");
		if (record.childExitCode !== null && !Number.isSafeInteger(record.childExitCode)) {
			throw new Error("Invalid child exit code");
		}
		if (typeof record.stdout !== "string" || typeof record.stderr !== "string")
			throw new Error("Invalid child output");
		const childStartedNs = requireNonnegativeNs(record.childStartedNs, "childStartedNs");
		const childFinishedNs = requireNonnegativeNs(record.childFinishedNs, "childFinishedNs");
		const childWallNs = requireNonnegativeNs(record.childWallNs, "childWallNs");
		assert.equal(childFinishedNs - childStartedNs, childWallNs);
		const wrapperStartedNs = requireNonnegativeNs(record.wrapperStartedNs, "wrapperStartedNs");
		const wrapperFinishedNs = requireNonnegativeNs(record.wrapperFinishedNs, "wrapperFinishedNs");
		const wrapperWallNs = requireNonnegativeNs(record.wrapperWallNs, "wrapperWallNs");
		assert.equal(wrapperFinishedNs - wrapperStartedNs, wrapperWallNs);
		assert.ok(childStartedNs >= wrapperStartedNs && childFinishedNs <= wrapperFinishedNs);
		if (typeof record.hostname !== "string" || !/^[A-Za-z0-9._-]{1,255}$/.test(record.hostname)) {
			throw new Error("Invalid result hostname");
		}
		return {
			protocol: COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL,
			rootJobId: expected.rootJobId,
			stepId: record.stepId,
			rank,
			benchmarkId: record.benchmarkId as string,
			requestFileSha256: expected.requestFileSha256,
			requestSha256: expected.requestSha256,
			workerSha256: expected.workerSha256,
			evaluatorSha256: expected.evaluatorSha256,
			childExitCode: record.childExitCode as number | null,
			stdout: record.stdout,
			stderr: record.stderr,
			childStartedNs: record.childStartedNs as string,
			childFinishedNs: record.childFinishedNs as string,
			childWallNs: record.childWallNs as string,
			hostname: record.hostname,
			startedAt: requireTimestamp(record.startedAt, "result.startedAt"),
			completedAt: requireTimestamp(record.completedAt, "result.completedAt"),
			wrapperStartedNs: record.wrapperStartedNs as string,
			wrapperFinishedNs: record.wrapperFinishedNs as string,
			wrapperWallNs: record.wrapperWallNs as string,
		};
	});
	parsed.sort((left, right) => left.rank - right.rank);
	assert.deepEqual(
		parsed.map((record) => record.rank),
		[0, 1],
	);
	assert.equal(parsed[0].stepId, parsed[1].stepId, "Ranks ran in different Slurm steps");
	assert.equal(parsed[0].hostname, parsed[1].hostname, "Ranks ran on different nodes");
	return [parsed[0], parsed[1]];
}

function requestRecord(workerSha256: string, createdAt: string): CompilerGymJobStepRequestRecord {
	assert.equal(sha256Json(COMPILER_GYM_JOB_STEP_C1_FIXTURE.request), COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256);
	assert.equal(
		sha256Text(JSON.stringify(COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions)),
		COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256,
	);
	return {
		protocol: COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL,
		candidateId: "C1",
		requestSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256,
		actionsSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256,
		actions: [...COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions],
		tasks: [...COMPILER_GYM_JOB_STEP_C1_TASKS],
		workerSha256,
		evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		createdAt,
	};
}

export function compilerGymJobStepRootIdentity(
	qualificationId: string,
	config: CompilerGymJobStepQualificationConfig = DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
): CompilerGymJobStepRootIdentity {
	if (!/^[A-Za-z0-9._:-]{1,128}$/.test(qualificationId)) throw new Error("Qualification ID is unsafe");
	if (!SAFE_USER_PATTERN.test(config.user)) throw new Error("Identity user is unsafe");
	validatePath(config.remoteRoot, "identity remote root");
	const identityDigest = sha256Json({
		protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
		qualificationId,
		remoteRoot: config.remoteRoot,
		user: config.user,
	});
	const identity: CompilerGymJobStepRootIdentity = {
		qualificationId,
		user: config.user,
		jobName: `cg-js-${sha256Text(qualificationId).slice(0, 20)}`,
		candidateJobName: `cg-js-${sha256Text(qualificationId).slice(0, 20)}-c1`,
		workDir: posix.join(config.remoteRoot, "runs", qualificationId),
		identityComment: `cg-js:${identityDigest}`,
	};
	validateToken(identity.jobName, "root job name");
	validateToken(identity.candidateJobName, "candidate job name");
	validateToken(identity.identityComment, "root identity comment");
	validatePath(identity.workDir, "root work directory");
	return identity;
}

export function compilerGymJobStepRootScript(): string {
	return `#!/bin/sh
set -eu
umask 077
export PATH=/usr/bin:/bin
export SLURM_EXPORT_ENV=NIL
trap 'exit 0' HUP INT TERM
while :; do
  /usr/bin/sleep 30 &
  wait "$!" || true
done
`;
}

export function compilerGymJobStepSbatchArgv(input: {
	identity: CompilerGymJobStepRootIdentity;
	config: CompilerGymJobStepQualificationConfig;
}): [string, ...string[]] {
	const expectedIdentity = compilerGymJobStepRootIdentity(input.identity.qualificationId, input.config);
	assert.deepEqual(input.identity, expectedIdentity, "Root identity is not canonical");
	return [
		"/usr/bin/sbatch",
		"--parsable",
		"--hold",
		"--no-requeue",
		"--export=NIL",
		`--partition=${input.config.partition}`,
		`--constraint=${input.config.cpuConstraint}`,
		"--nodes=1",
		`--ntasks=${ROOT_TASKS}`,
		`--cpus-per-task=${CPUS_PER_TASK}`,
		`--mem=${input.config.memory}`,
		`--time=${input.config.rootTimeLimit}`,
		`--deadline=${input.config.rootPendingDeadline}`,
		`--job-name=${input.identity.jobName}`,
		`--comment=${input.identity.identityComment}`,
		`--chdir=${input.identity.workDir}`,
		`--output=${posix.join(input.identity.workDir, "root-%j.out")}`,
		`--error=${posix.join(input.identity.workDir, "root-%j.err")}`,
	];
}

export function compilerGymJobStepSrunArgv(input: {
	rootJobId: string;
	candidateJobName: string;
	requestPath: string;
	requestFileSha256: string;
	workerSha256: string;
	evaluatorSha256: string;
	sourceBootstrap: CompilerGymJobStepSourceBootstrap;
	config: CompilerGymJobStepQualificationConfig;
}): [string, ...string[]] {
	requireRootId(input.rootJobId, "root job ID");
	validateToken(input.candidateJobName, "candidate job name");
	validatePath(input.requestPath, "request path");
	requireSha256(input.requestFileSha256, "request file hash");
	requireSha256(input.workerSha256, "worker hash");
	requireSha256(input.evaluatorSha256, "evaluator hash");
	assert.equal(input.sourceBootstrap.protocol, COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL);
	assert.equal(sha256Text(input.sourceBootstrap.pythonSource), input.sourceBootstrap.pythonSourceSha256);
	const workerArgs = [
		input.config.pythonPath,
		"-c",
		input.sourceBootstrap.pythonSource,
		"--request",
		input.requestPath,
		"--request-file-sha256",
		input.requestFileSha256,
		"--worker-sha256",
		input.workerSha256,
		"--evaluator-sha256",
		input.evaluatorSha256,
		"--python",
		input.config.pythonPath,
		"--expected-root-job-id",
		input.rootJobId,
	];
	const rankShell = [
		"exec /usr/bin/env -i",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		`LD_LIBRARY_PATH=${shellQuote(input.config.compatibilityLibraryDir)}`,
		`COMPILER_GYM_CACHE=${shellQuote(input.config.compilerGymCache)}`,
		`COMPILER_GYM_SITE_DATA=${shellQuote(input.config.compilerGymSiteData)}`,
		"PYTHONWARNINGS=ignore::FutureWarning",
		'SLURM_JOB_ID="$SLURM_JOB_ID"',
		'SLURM_STEP_ID="$SLURM_STEP_ID"',
		'SLURM_PROCID="$SLURM_PROCID"',
		'SLURM_CPUS_PER_TASK="$SLURM_CPUS_PER_TASK"',
		'"$@"',
	].join(" ");
	return [
		"/usr/bin/srun",
		`--jobid=${input.rootJobId}`,
		"--nodes=1",
		`--ntasks=${ROOT_TASKS}`,
		`--cpus-per-task=${CPUS_PER_TASK}`,
		"--exact",
		"--kill-on-bad-exit=1",
		"--label",
		"--export=NONE",
		`--job-name=${input.candidateJobName}`,
		"/bin/sh",
		"-c",
		rankShell,
		"compiler-gym-job-step-rank",
		...workerArgs,
	];
}

export function analyzeCompilerGymJobStepQualification(
	observation: CompilerGymJobStepQualificationObservation,
): CompilerGymJobStepQualificationAnalysis {
	assert.equal(observation.protocol, COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL);
	assert.match(observation.qualificationId, /^[A-Za-z0-9._:-]{1,128}$/);
	const identity = compilerGymJobStepRootIdentity(observation.qualificationId);
	assert.equal(observation.jobName, identity.jobName);
	assert.equal(observation.workDir, identity.workDir);
	assert.equal(observation.identityComment, identity.identityComment);
	assert.equal(observation.rootScriptSha256, sha256Text(compilerGymJobStepRootScript()));
	requireRootId(observation.rootJobId, "observation root job ID");
	assert.equal(observation.request.requestSha256, COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256);
	assert.equal(observation.request.actionsSha256, COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256);
	assert.deepEqual(observation.request.actions, COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions);
	assert.deepEqual(observation.request.tasks, [...COMPILER_GYM_JOB_STEP_C1_TASKS]);
	assert.equal(observation.workerSha256, observation.request.workerSha256);
	assert.equal(observation.evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
	assert.equal(observation.requestFileSha256, sha256Text(`${canonicalJson(toJsonValue(observation.request))}\n`));
	const acquisitionStarted = requireNonnegativeNs(observation.acquisitionStartedNs, "acquisitionStartedNs");
	const acquisitionReady = requireNonnegativeNs(observation.acquisitionReadyNs, "acquisitionReadyNs");
	const acquisitionDuration = requireNonnegativeNs(observation.acquisitionDurationNs, "acquisitionDurationNs");
	assert.equal(acquisitionReady - acquisitionStarted, acquisitionDuration);
	const candidateStarted = requireNonnegativeNs(observation.candidateStartedNs, "candidateStartedNs");
	const requestPublished = requireNonnegativeNs(observation.requestPublishedNs, "requestPublishedNs");
	const srunStarted = requireNonnegativeNs(observation.srunStartedNs, "srunStartedNs");
	const srunFinished = requireNonnegativeNs(observation.srunFinishedNs, "srunFinishedNs");
	const candidateFinished = requireNonnegativeNs(observation.candidateFinishedNs, "candidateFinishedNs");
	const candidateDuration = requireNonnegativeNs(observation.candidateDurationNs, "candidateDurationNs");
	assert.equal(candidateFinished - candidateStarted, candidateDuration);
	assert.ok(candidateStarted >= acquisitionReady);
	assert.ok(requestPublished >= candidateStarted);
	assert.ok(srunStarted >= requestPublished);
	assert.ok(srunFinished > srunStarted);
	assert.ok(candidateFinished >= srunFinished);
	assert.equal(observation.results[0].rootJobId, observation.rootJobId);
	assert.equal(observation.results[1].rootJobId, observation.rootJobId);
	assert.equal(observation.results[0].stepId, observation.results[1].stepId);
	for (const [rank, task] of observation.tasks.entries()) {
		const expected = COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks[rank];
		assert.equal(task.benchmarkId, expected.benchmarkId);
		assert.equal(task.status, "accepted");
		assert.equal(task.metrics.IrInstructionCount, expected.irInstructionCount);
		assert.equal(task.metrics.ObjectTextSizeBytes, expected.objectTextSizeBytes);
		assert.equal(task.verifier.passed, true);
		assert.deepEqual(task.verifier.errors, []);
		assert.deepEqual(task.verifier.checks, [
			"farmshare-environment-seal-v2",
			"pinned-cbench-patch-and-source",
			"pinned-action-space",
			"raw-metrics",
			"20-base-semantic-callbacks",
		]);
	}
	assert.equal(observation.stepAccounting.jobIdRaw, `${observation.rootJobId}.${observation.results[0].stepId}`);
	assert.equal(observation.stepAccounting.state, "COMPLETED");
	assert.equal(observation.stepAccounting.exitCode, "0:0");
	assert.equal(observation.stepAccounting.allocCpus, ROOT_CPUS);
	assert.equal(observation.stepAccounting.nTasks, ROOT_TASKS);
	assert.equal(observation.stepAccounting.nodeList, observation.results[0].hostname);
	const inventoryExpectation = {
		rootJobId: observation.rootJobId,
		rootJobName: observation.jobName,
		stepId: observation.results[0].stepId,
		stepJobName: `${observation.jobName}-c1`,
		hostname: observation.results[0].hostname,
	} as const;
	validateCompilerGymJobStepInventory(observation.stepInventory, {
		...inventoryExpectation,
		rootState: "RUNNING",
	});
	validateCompilerGymJobStepInventory(observation.terminalStepInventory, {
		...inventoryExpectation,
		rootState: "CANCELLED",
	});
	const terminalStepAccounting = observation.terminalStepInventory.find(
		(row) => row.jobIdRaw === observation.stepAccounting.jobIdRaw,
	);
	assert.deepEqual(terminalStepAccounting, observation.stepAccounting);
	assert.equal(observation.rootAccounting.jobIdRaw, observation.rootJobId);
	assert.equal(observation.rootAccounting.state, "CANCELLED");
	assert.match(observation.rootAccounting.exitCode, /^[0-9]+:[0-9]+$/);
	assert.equal(observation.rootAccounting.allocCpus, ROOT_CPUS);
	assert.equal(observation.rootAccounting.nodeList, observation.stepAccounting.nodeList);
	assert.equal(observation.cleanup.schedulerAbsent, true);
	assert.equal(observation.cleanup.terminalState, observation.rootAccounting.state);
	assert.deepEqual(observation.cleanup.matchingRootIds, [observation.rootJobId]);
	assert.deepEqual(
		observation.commands.map((command) => command.sequence),
		observation.commands.map((_command, index) => index),
		"Command evidence sequence is not contiguous",
	);
	for (const command of observation.commands) {
		assert.ok(Number.isSafeInteger(command.inputBytes) && command.inputBytes >= 0);
		assert.ok(Number.isFinite(command.wallMs) && command.wallMs >= 0, "Command wall time is invalid");
		requireSha256(command.inputSha256, "command input hash");
		assert.equal(command.stdoutSha256, sha256Text(command.stdout), "Command stdout hash mismatch");
		assert.equal(command.stderrSha256, sha256Text(command.stderr), "Command stderr hash mismatch");
		requireTimestamp(command.capturedAt, "command capturedAt");
		assert.equal(command.transportError, undefined, "Successful qualification contains a transport error");
	}
	const srunCommands = observation.commands.filter((command) => command.label === "srun-c1");
	const sbatchCommands = observation.commands.filter((command) => command.label === "sbatch-root");
	const spoolCommands = observation.commands.filter((command) => command.label === "scontrol-write-batch-script");
	const releaseCommands = observation.commands.filter((command) => command.label === "scontrol-release-root");
	const scancelCommands = observation.commands.filter((command) => command.label === "scancel-root");
	assert.equal(srunCommands.length, 1, "Qualification must dispatch exactly one candidate step");
	assert.equal(sbatchCommands.length, 1, "Qualification must submit exactly one root allocation");
	assert.equal(spoolCommands.length, 1, "Qualification must read back exactly one spooled batch script");
	assert.equal(releaseCommands.length, 1, "Qualification must release exactly one root allocation");
	assert.equal(scancelCommands.length, 1, "Qualification must clean exactly one root allocation");
	const sbatchArgv = sbatchCommands[0].remoteArgv;
	assert.deepEqual(
		sbatchArgv,
		compilerGymJobStepSbatchArgv({
			identity,
			config: DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
		}),
	);
	const rootScript = compilerGymJobStepRootScript();
	assert.equal(sbatchCommands[0].inputBytes, Buffer.byteLength(rootScript, "utf8"));
	assert.equal(sbatchCommands[0].inputSha256, sha256Text(rootScript));
	assert.deepEqual(spoolCommands[0].remoteArgv, [
		"/usr/bin/scontrol",
		"write",
		"batch_script",
		observation.rootJobId,
		"-",
	]);
	assert.equal(spoolCommands[0].stdout, rootScript);
	assert.deepEqual(releaseCommands[0].remoteArgv, ["/usr/bin/scontrol", "release", observation.rootJobId]);
	assert.ok(sbatchCommands[0].sequence < spoolCommands[0].sequence);
	assert.ok(spoolCommands[0].sequence < releaseCommands[0].sequence);
	assert.ok(releaseCommands[0].sequence < srunCommands[0].sequence);
	const srunArgv = srunCommands[0].remoteArgv;
	assert.equal(srunArgv[0], "/usr/bin/srun");
	for (const required of [
		`--jobid=${observation.rootJobId}`,
		"--nodes=1",
		"--ntasks=2",
		"--cpus-per-task=2",
		"--exact",
		"--kill-on-bad-exit=1",
		"--label",
		"--export=NONE",
	])
		assert.ok(srunArgv.includes(required), `Candidate step is missing ${required}`);
	assert.ok(!srunArgv.some((argument) => argument === "--overlap" || argument.startsWith("--overlap=")));
	assert.ok(!srunArgv.some((argument) => argument === "--exclusive" || argument.startsWith("--exclusive=")));
	assert.ok(!srunArgv.some((argument) => argument.startsWith("--cpu-bind")));
	assert.ok(!srunArgv.includes("--evaluator"), "Candidate step must not execute a remote evaluator path");
	const inlinePythonIndex = srunArgv.indexOf(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG.pythonPath);
	assert.ok(
		inlinePythonIndex >= 0 && srunArgv[inlinePythonIndex + 1] === "-c",
		"Candidate step lacks inline source bootstrap",
	);
	const childDurations = observation.results.map((result) => requireNonnegativeNs(result.childWallNs, "childWallNs"));
	const criticalChildDuration = childDurations[0] > childDurations[1] ? childDurations[0] : childDurations[1];
	assert.ok(candidateDuration >= criticalChildDuration, "Candidate duration is below its child critical path");
	const dispatchOverhead = candidateDuration - criticalChildDuration;
	const projectedFourCallTotal =
		acquisitionDuration + 4n * dispatchOverhead + COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS;
	const allowanceNumerator =
		9n * COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS -
		10n * acquisitionDuration -
		10n * COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS;
	const dynamicOverheadCeiling = allowanceNumerator < 0n ? -1n : allowanceNumerator / 40n;
	const strongLatencyGatePassed = 10n * projectedFourCallTotal <= 9n * COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS;
	return {
		protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
		integrityPassed: true,
		acquisitionDurationNs: acquisitionDuration.toString(),
		candidateDurationNs: candidateDuration.toString(),
		criticalChildDurationNs: criticalChildDuration.toString(),
		dispatchOverheadNs: dispatchOverhead.toString(),
		dynamicOverheadCeilingNs: dynamicOverheadCeiling.toString(),
		referenceOverheadCeilingNs: COMPILER_GYM_JOB_STEP_REFERENCE_OVERHEAD_CEILING_NS.toString(),
		projectedFourCallTotalNs: projectedFourCallTotal.toString(),
		stockColdReferenceNs: COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS.toString(),
		strongLatencyGatePassed,
		decision: strongLatencyGatePassed ? "qualify-c1-c4-screen" : "kill-job-step-transport",
		claimClass: "historical-control-operational-projection",
		causalClaimAllowed: false,
	};
}

export class CompilerGymJobStepQualificationRunner {
	private readonly commandRunner: CompilerGymWarmCommandRunner;
	private readonly remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	private readonly clock: CompilerGymJobStepClock;
	private readonly expectedWorkerSha256: string;
	private readonly commands: CompilerGymJobStepCommandEvidence[] = [];

	constructor(
		private readonly config: CompilerGymJobStepQualificationConfig,
		dependencies: CompilerGymJobStepDependencies,
	) {
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
		this.remoteFileSystem =
			dependencies.remoteFileSystem ??
			new SshCompilerGymWarmRemoteFileSystem(
				this.commandRunner,
				this.config.host,
				this.config.remoteControlPython,
				this.config.commandTimeoutMs,
			);
		this.clock = dependencies.clock ?? new SystemCompilerGymJobStepClock();
		this.expectedWorkerSha256 = requireSha256(dependencies.expectedWorkerSha256, "expected worker hash");
		validateToken(this.config.host, "host");
		validateToken(this.config.user, "user");
		validatePath(this.config.remoteRoot, "remote root");
		for (const [label, path] of [
			["remote control Python", this.config.remoteControlPython],
			["Python", this.config.pythonPath],
			["CompilerGym cache", this.config.compilerGymCache],
			["CompilerGym site data", this.config.compilerGymSiteData],
			["compatibility library", this.config.compatibilityLibraryDir],
		] as const)
			validatePath(path, label);
		if (!/^now\+[1-9][0-9]*minutes$/.test(this.config.rootPendingDeadline)) {
			throw new Error("Root pending deadline is unsafe");
		}
	}

	private async remote(
		label: string,
		remoteArgv: readonly [string, ...string[]],
		signal: AbortSignal,
		options: { timeoutMs?: number; maxOutputBytes?: number; input?: string } = {},
	): Promise<CompilerGymWarmCommandResult> {
		const commandInput = options.input ?? "";
		const startedAtMs = performance.now();
		try {
			const result = await this.commandRunner.run({
				argv: compilerGymWarmSshArgv(this.config.host, remoteArgv),
				input: options.input,
				signal,
				timeoutMs: options.timeoutMs ?? this.config.commandTimeoutMs,
				maxOutputBytes: options.maxOutputBytes ?? MAX_CONTROL_OUTPUT_BYTES,
			});
			this.commands.push({
				sequence: this.commands.length,
				label,
				remoteArgv: [...remoteArgv],
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				wallMs: result.wallMs,
				stdoutSha256: sha256Text(result.stdout),
				stderrSha256: sha256Text(result.stderr),
				inputBytes: Buffer.byteLength(commandInput, "utf8"),
				inputSha256: sha256Text(commandInput),
				capturedAt: this.clock.now().toISOString(),
			});
			return result;
		} catch (error) {
			const transportError = qualificationErrorText(error);
			this.commands.push({
				sequence: this.commands.length,
				label,
				remoteArgv: [...remoteArgv],
				exitCode: null,
				stdout: "",
				stderr: "",
				wallMs: performance.now() - startedAtMs,
				stdoutSha256: sha256Text(""),
				stderrSha256: sha256Text(""),
				inputBytes: Buffer.byteLength(commandInput, "utf8"),
				inputSha256: sha256Text(commandInput),
				capturedAt: this.clock.now().toISOString(),
				transportError,
			});
			throw error;
		}
	}

	private async remoteChecked(
		label: string,
		remoteArgv: readonly [string, ...string[]],
		signal: AbortSignal,
		options: { timeoutMs?: number; maxOutputBytes?: number; input?: string } = {},
	): Promise<CompilerGymWarmCommandResult> {
		const result = await this.remote(label, remoteArgv, signal, options);
		if (result.exitCode !== 0) throw new Error(`${label} exited ${String(result.exitCode)}: ${result.stderr.trim()}`);
		return result;
	}

	private async prepareDirectories(qualificationId: string, signal: AbortSignal): Promise<string> {
		const storageRoot = `/scratch/users/${this.config.user}`;
		if (!this.config.remoteRoot.startsWith(`${storageRoot}/`))
			throw new Error("Remote root is outside the user scratch root");
		let current = storageRoot;
		for (const component of this.config.remoteRoot.slice(storageRoot.length + 1).split("/")) {
			current = posix.join(current, component);
			await this.remoteFileSystem.ensurePrivateDirectory(current, signal);
		}
		const runsRoot = posix.join(this.config.remoteRoot, "runs");
		await this.remoteFileSystem.ensurePrivateDirectory(runsRoot, signal);
		const workDir = posix.join(runsRoot, qualificationId);
		await this.remoteFileSystem.createPrivateDirectory(workDir, signal);
		return workDir;
	}

	private async verifyRootIdentity(
		rootJobId: string,
		identity: CompilerGymJobStepRootIdentity,
		label: string,
		signal: AbortSignal,
	): Promise<{ state: string; reason: string; batchFlag: 1; priority: number }> {
		const result = await this.remoteChecked(
			label,
			["/usr/bin/scontrol", "--oneliner", "show", "job", requireRootId(rootJobId, "root job ID")],
			signal,
		);
		const fields = parseScontrol(result.stdout);
		const field = (name: string): string => {
			const value = fields.get(name);
			if (value === undefined) throw new Error(`Missing scontrol field ${name}`);
			return value;
		};
		assert.equal(field("JobId"), rootJobId);
		assert.equal(field("JobName"), identity.jobName);
		const userIdMatch = /^([a-z_][a-z0-9_-]{0,31})\([0-9]+\)$/.exec(field("UserId"));
		assert.ok(userIdMatch, "Root UserId is malformed");
		assert.equal(userIdMatch[1], identity.user);
		assert.equal(field("Partition"), this.config.partition);
		assert.equal(field("NumNodes"), "1");
		assert.equal(field("NumCPUs"), String(ROOT_CPUS));
		assert.equal(field("NumTasks"), String(ROOT_TASKS));
		assert.equal(field("CPUs/Task"), String(CPUS_PER_TASK));
		assert.equal(field("MinMemoryNode"), this.config.memory);
		assert.equal(field("WorkDir"), identity.workDir);
		assert.equal(field("Comment"), identity.identityComment);
		assert.equal(field("Requeue"), "0");
		assert.equal(field("BatchFlag"), "1");
		assert.equal(field("Features"), this.config.cpuConstraint);
		const priority = Number(field("Priority"));
		assert.ok(Number.isSafeInteger(priority) && priority >= 0, "Root Priority is invalid");
		return { state: normalizeState(field("JobState")), reason: field("Reason"), batchFlag: 1, priority };
	}

	private schedulerIdentityMatches(fields: readonly string[], identity: CompilerGymJobStepRootIdentity): boolean {
		return (
			fields[1] === identity.user &&
			fields[2] === identity.jobName &&
			fields[3] === identity.workDir &&
			fields[4] === identity.identityComment
		);
	}

	private parseSchedulerIdentityLine(line: string, label: string): string[] {
		const fields = line.split("|");
		if (fields.at(-1) === "") fields.pop();
		assert.equal(fields.length, 6, `${label} identity field count mismatch`);
		requireRootId(fields[0], `${label} root job ID`);
		return fields;
	}

	private async assertIdentityAbsent(identity: CompilerGymJobStepRootIdentity, signal: AbortSignal): Promise<void> {
		const queue = await this.remoteChecked(
			"identity-squeue",
			[
				"/usr/bin/squeue",
				"--noheader",
				"--user",
				identity.user,
				"--name",
				identity.jobName,
				"--format=%A|%u|%j|%Z|%k|%T",
			],
			signal,
		);
		for (const line of queue.stdout.trim().split("\n").filter(Boolean)) {
			const fields = this.parseSchedulerIdentityLine(line, "identity squeue");
			if (this.schedulerIdentityMatches(fields, identity)) {
				throw new Error(`Duplicate active job-step qualification root ${fields[0]}`);
			}
		}
		const accounting = await this.remoteChecked(
			"identity-sacct",
			[
				"/usr/bin/sacct",
				"--noheader",
				"-X",
				"--user",
				identity.user,
				"--name",
				identity.jobName,
				"--starttime",
				"now-1days",
				"--format=JobIDRaw,User,JobName,WorkDir,Comment,State",
				"--parsable2",
			],
			signal,
		);
		for (const line of accounting.stdout.trim().split("\n").filter(Boolean)) {
			const fields = this.parseSchedulerIdentityLine(line, "identity sacct");
			if (this.schedulerIdentityMatches(fields, identity)) {
				throw new Error(`Duplicate accounted job-step qualification root ${fields[0]}`);
			}
		}
	}

	private async waitForRootRunning(
		rootJobId: string,
		identity: CompilerGymJobStepRootIdentity,
		signal: AbortSignal,
	): Promise<void> {
		while (true) {
			const { state } = await this.verifyRootIdentity(rootJobId, identity, "scontrol-root-running", signal);
			if (state === "RUNNING") return;
			if (TERMINAL_STATES.has(state)) throw new Error(`Root allocation became ${state} before candidate dispatch`);
			await this.clock.sleep(this.config.pollIntervalMs, signal);
		}
	}

	private async discoverExactRootIds(
		identity: CompilerGymJobStepRootIdentity,
		signal: AbortSignal,
	): Promise<string[]> {
		const queue = await this.remoteChecked(
			"recovery-squeue",
			[
				"/usr/bin/squeue",
				"--noheader",
				"--user",
				identity.user,
				"--name",
				identity.jobName,
				"--format=%A|%u|%j|%Z|%k|%T",
			],
			signal,
		);
		const ids = new Set<string>();
		for (const line of queue.stdout.trim().split("\n").filter(Boolean)) {
			const fields = this.parseSchedulerIdentityLine(line, "recovery squeue");
			if (this.schedulerIdentityMatches(fields, identity)) {
				ids.add(requireRootId(fields[0], "discovered queue root ID"));
			}
		}
		const accounting = await this.remoteChecked(
			"recovery-sacct",
			[
				"/usr/bin/sacct",
				"--noheader",
				"-X",
				"--user",
				identity.user,
				"--name",
				identity.jobName,
				"--starttime",
				"now-1days",
				"--format=JobIDRaw,User,JobName,WorkDir,Comment,State",
				"--parsable2",
			],
			signal,
		);
		for (const line of accounting.stdout.trim().split("\n").filter(Boolean)) {
			const fields = this.parseSchedulerIdentityLine(line, "recovery sacct");
			if (this.schedulerIdentityMatches(fields, identity)) {
				ids.add(requireRootId(fields[0], "discovered accounting root ID"));
			}
		}
		return [...ids].sort((left, right) => {
			const leftId = BigInt(left);
			const rightId = BigInt(right);
			return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
		});
	}

	private async discoverAfterAmbiguousSubmission(identity: CompilerGymJobStepRootIdentity): Promise<string[]> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(new Error("Ambiguous submission discovery timed out")),
			this.config.cleanupTimeoutMs,
		);
		const deadlineNs = this.clock.nowNs() + BigInt(this.config.dispatchVisibilityGraceMs) * 1_000_000n;
		try {
			while (true) {
				const ids = await this.discoverExactRootIds(identity, controller.signal);
				if (ids.length > 0 || this.clock.nowNs() >= deadlineNs) return ids;
				await this.clock.sleep(this.config.pollIntervalMs, controller.signal);
			}
		} finally {
			clearTimeout(timeout);
		}
	}

	private async waitForAccounting(
		jobIdRaw: string,
		expected: { jobName: string; allocCpus: number; nTasks: number | null },
		rootOnly: boolean,
		signal: AbortSignal,
	): Promise<CompilerGymJobStepAccountingRecord> {
		while (true) {
			const result = await this.remoteChecked(
				rootOnly ? "sacct-root" : "sacct-step",
				[
					"/usr/bin/sacct",
					"--noheader",
					...(rootOnly ? ["-X"] : []),
					"--jobs",
					jobIdRaw,
					"--format=JobIDRaw,JobName,State,ExitCode,AllocCPUS,NTasks,ElapsedRaw,CPUTimeRAW,NodeList,Start,End",
					"--parsable2",
				],
				signal,
			);
			if (result.stdout.trim()) {
				const accounting = parseCompilerGymJobStepAccounting(result.stdout, { jobIdRaw, ...expected });
				if (TERMINAL_STATES.has(accounting.state)) return accounting;
			}
			await this.clock.sleep(this.config.pollIntervalMs, signal);
		}
	}

	private async waitForStepInventory(
		rootJobId: string,
		expected: {
			rootJobName: string;
			rootState: "RUNNING" | "CANCELLED";
			stepId: string;
			stepJobName: string;
			hostname: string;
		},
		label: string,
		signal: AbortSignal,
	): Promise<CompilerGymJobStepAccountingRecord[]> {
		const expectedStepJobId = `${rootJobId}.${expected.stepId}`;
		const stabilizationMs =
			expected.rootState === "CANCELLED"
				? Math.min(TERMINAL_INVENTORY_STABILIZATION_MS, this.config.stepAccountingTimeoutMs)
				: 0;
		const stabilizationNs = BigInt(stabilizationMs) * 1_000_000n;
		let stableInventoryKey: string | undefined;
		let stableSinceNs: bigint | undefined;
		while (true) {
			const result = await this.remoteChecked(
				label,
				[
					"/usr/bin/sacct",
					"--noheader",
					"--jobs",
					rootJobId,
					"--format=JobIDRaw,JobName,State,ExitCode,AllocCPUS,NTasks,ElapsedRaw,CPUTimeRAW,NodeList,Start,End",
					"--parsable2",
				],
				signal,
			);
			const rows = parseCompilerGymJobStepAccountingRows(result.stdout);
			if (rows.some((row) => row.jobIdRaw === rootJobId) && rows.some((row) => row.jobIdRaw === expectedStepJobId)) {
				validateCompilerGymJobStepInventory(rows, { rootJobId, ...expected });
				if (stabilizationNs === 0n) return rows;
				const inventoryKey = canonicalJson(
					toJsonValue([...rows].sort((left, right) => left.jobIdRaw.localeCompare(right.jobIdRaw))),
				);
				const observedAtNs = this.clock.nowNs();
				if (inventoryKey !== stableInventoryKey) {
					stableInventoryKey = inventoryKey;
					stableSinceNs = observedAtNs;
				} else if (stableSinceNs !== undefined && observedAtNs - stableSinceNs >= stabilizationNs) {
					return rows;
				}
			} else {
				stableInventoryKey = undefined;
				stableSinceNs = undefined;
			}
			let sleepMs = this.config.pollIntervalMs;
			if (stableSinceNs !== undefined) {
				const remainingNs = stabilizationNs - (this.clock.nowNs() - stableSinceNs);
				if (remainingNs > 0n) {
					const remainingMs = Number((remainingNs + 999_999n) / 1_000_000n);
					sleepMs = Math.min(sleepMs, remainingMs);
				}
			}
			await this.clock.sleep(sleepMs, signal);
		}
	}

	private async cleanupRoot(
		rootJobId: string,
		identity: CompilerGymJobStepRootIdentity,
		stepExpectation?: { stepId: string; stepJobName: string; hostname: string },
	): Promise<{
		accounting: CompilerGymJobStepAccountingRecord;
		terminalStepInventory: CompilerGymJobStepAccountingRecord[];
		schedulerAbsent: true;
		matchingRootIds: [string];
	}> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(new Error("Root cleanup timed out")),
			this.config.cleanupTimeoutMs,
		);
		try {
			await this.verifyRootIdentity(rootJobId, identity, "scontrol-root-cleanup", controller.signal);
			await this.remoteChecked(
				"scancel-root",
				["/usr/bin/scancel", "--full", requireRootId(rootJobId, "cleanup root job ID")],
				controller.signal,
			);
			while (true) {
				const queue = await this.remoteChecked(
					"cleanup-squeue",
					["/usr/bin/squeue", "--noheader", "--jobs", rootJobId, "--format=%A|%u|%j|%Z|%k|%T"],
					controller.signal,
				);
				const lines = queue.stdout.trim().split("\n").filter(Boolean);
				if (lines.length === 0) break;
				for (const line of lines) {
					const fields = this.parseSchedulerIdentityLine(line, "cleanup squeue");
					assert.equal(fields[0], rootJobId, "Cleanup observed a different root ID");
					assert.ok(this.schedulerIdentityMatches(fields, identity), "Cleanup root identity drifted");
				}
				await this.clock.sleep(this.config.pollIntervalMs, controller.signal);
			}
			const accounting = await this.waitForAccounting(
				rootJobId,
				{ jobName: identity.jobName, allocCpus: ROOT_CPUS, nTasks: null },
				true,
				controller.signal,
			);
			const terminalStepInventory = stepExpectation
				? await this.waitForStepInventory(
						rootJobId,
						{
							rootJobName: identity.jobName,
							rootState: "CANCELLED",
							...stepExpectation,
						},
						"sacct-terminal-step-inventory",
						controller.signal,
					)
				: [];
			const matchingRootIds = await this.discoverExactRootIds(identity, controller.signal);
			assert.deepEqual(matchingRootIds, [rootJobId], "Cleanup found a second matching root allocation");
			return { accounting, terminalStepInventory, schedulerAbsent: true, matchingRootIds: [rootJobId] };
		} finally {
			clearTimeout(timeout);
		}
	}

	async run(
		qualificationId: string,
		signal: AbortSignal,
		hooks: CompilerGymJobStepRunHooks,
	): Promise<CompilerGymJobStepQualificationObservation> {
		const identity = compilerGymJobStepRootIdentity(qualificationId, this.config);
		const acquisitionStartedNs = this.clock.nowNs();
		const operation = makeSignal(signal, this.config.acquisitionTimeoutMs, "Root acquisition");
		let rootJobId: string | undefined;
		let submissionAttempted = false;
		let workDir: string | undefined;
		let cleanupStepExpectation: { stepId: string; stepJobName: string; hostname: string } | undefined;
		let observationWithoutCleanup: CompilerGymJobStepCandidateEvidence | undefined;
		let primaryError: unknown;
		try {
			workDir = await this.prepareDirectories(qualificationId, operation.signal);
			assert.equal(workDir, identity.workDir);
			const [workerSource, evaluatorSource] = await Promise.all([
				readFile(this.config.localWorkerPath, "utf8"),
				readFile(this.config.localEvaluatorPath, "utf8"),
			]);
			const workerSha256 = sha256Text(workerSource);
			assert.equal(
				workerSha256,
				this.expectedWorkerSha256,
				"Worker source drifted after preregistered verification",
			);
			const evaluatorSha256 = sha256Text(evaluatorSource);
			assert.equal(evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256, "Evaluator source drifted");
			const sourceBootstrap = buildCompilerGymJobStepSourceBootstrap({
				workerSource,
				workerSha256,
				evaluatorSource,
				evaluatorSha256,
			});
			const launchSource = compilerGymJobStepRootScript();
			const launchSha256 = sha256Text(launchSource);
			const sbatchArgv = compilerGymJobStepSbatchArgv({ identity, config: this.config });
			await this.assertIdentityAbsent(identity, operation.signal);
			await hooks.recordDispatchIntent({
				protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
				qualificationId,
				jobName: identity.jobName,
				candidateJobName: identity.candidateJobName,
				workDir: identity.workDir,
				identityComment: identity.identityComment,
				rootScriptSha256: launchSha256,
				sbatchArgv: [...sbatchArgv],
				sbatchArgvSha256: sha256Json(sbatchArgv),
				workerSha256,
				evaluatorSha256,
				recordedAt: this.clock.now().toISOString(),
			});
			submissionAttempted = true;
			const submitted = await this.remoteChecked("sbatch-root", sbatchArgv, operation.signal, {
				input: launchSource,
			});
			rootJobId = requireRootId(submitted.stdout.trim(), "sbatch root job ID");
			await hooks.recordRootSubmitted({
				protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
				qualificationId,
				rootJobId,
				jobName: identity.jobName,
				workDir: identity.workDir,
				submittedAt: this.clock.now().toISOString(),
			});
			const held = await this.verifyRootIdentity(rootJobId, identity, "scontrol-root-held", operation.signal);
			assert.equal(held.state, "PENDING", "Held root is not pending");
			assert.equal(held.reason, "JobHeldUser", "Root is not held by the submitting user");
			assert.equal(held.priority, 0, "Held root does not have zero priority");
			const spooledScript = await this.remoteChecked(
				"scontrol-write-batch-script",
				["/usr/bin/scontrol", "write", "batch_script", rootJobId, "-"],
				operation.signal,
			);
			if (spooledScript.stderr !== "") throw new Error("Batch-script verification emitted stderr");
			assert.equal(spooledScript.stdout, launchSource, "Spooled root script bytes differ from submitted stdin");
			const spooledScriptSha256 = sha256Text(spooledScript.stdout);
			assert.equal(spooledScriptSha256, launchSha256);
			await hooks.recordRootHeldVerified({
				protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
				qualificationId,
				rootJobId,
				jobName: identity.jobName,
				workDir: identity.workDir,
				identityComment: identity.identityComment,
				rootScriptSha256: launchSha256,
				spooledScriptSha256,
				heldState: "PENDING",
				heldReason: "JobHeldUser",
				batchFlag: held.batchFlag,
				priority: 0,
				validatedAt: this.clock.now().toISOString(),
			});
			await hooks.recordRootReleaseIntent({
				protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
				qualificationId,
				rootJobId,
				jobName: identity.jobName,
				workDir: identity.workDir,
				identityComment: identity.identityComment,
				recordedAt: this.clock.now().toISOString(),
			});
			await this.remoteChecked(
				"scontrol-release-root",
				["/usr/bin/scontrol", "release", rootJobId],
				operation.signal,
			);
			await this.waitForRootRunning(rootJobId, identity, operation.signal);
			await hooks.recordRootReady({
				protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
				qualificationId,
				rootJobId,
				jobName: identity.jobName,
				workDir: identity.workDir,
				validatedAt: this.clock.now().toISOString(),
			});
			const acquisitionReadyNs = this.clock.nowNs();
			operation.dispose();

			const candidateStartedNs = this.clock.nowNs();
			const request = requestRecord(workerSha256, this.clock.now().toISOString());
			const requestContent = `${canonicalJson(toJsonValue(request))}\n`;
			const requestFileSha256 = sha256Text(requestContent);
			const requestPath = posix.join(workDir, `request-c1-${requestFileSha256}.json`);
			await this.remoteFileSystem.installImmutableFile(
				requestPath,
				requestContent,
				requestFileSha256,
				RECORD_MODE,
				false,
				signal,
			);
			const requestPublishedNs = this.clock.nowNs();
			const srunStartedNs = this.clock.nowNs();
			const step = await this.remoteChecked(
				"srun-c1",
				compilerGymJobStepSrunArgv({
					rootJobId,
					candidateJobName: identity.candidateJobName,
					requestPath,
					requestFileSha256,
					workerSha256,
					evaluatorSha256,
					sourceBootstrap,
					config: this.config,
				}),
				signal,
				{ timeoutMs: this.config.stepTimeoutMs, maxOutputBytes: MAX_STEP_OUTPUT_BYTES },
			);
			const srunFinishedNs = this.clock.nowNs();
			if (step.stderr.trim()) throw new Error(`Candidate step emitted stderr: ${step.stderr.trim()}`);
			const results = parseCompilerGymJobStepResults(step.stdout, {
				rootJobId,
				requestFileSha256,
				requestSha256: request.requestSha256,
				workerSha256,
				evaluatorSha256,
			});
			const stepId = results[0].stepId;
			cleanupStepExpectation = {
				stepId,
				stepJobName: identity.candidateJobName,
				hostname: results[0].hostname,
			};
			const tasks = results.map((result) =>
				assessCompilerGymTaskProcess(
					result.benchmarkId,
					{
						exitCode: result.childExitCode,
						stdout: result.stdout,
						stderr: result.stderr,
						wallMs: Number(BigInt(result.childWallNs)) / 1_000_000,
					},
					"warm-child",
				),
			) as [TaskMeasurement, TaskMeasurement];
			const accountingOperation = makeSignal(
				signal,
				this.config.stepAccountingTimeoutMs,
				"Candidate step accounting",
			);
			let stepAccounting: CompilerGymJobStepAccountingRecord;
			let stepInventory: CompilerGymJobStepAccountingRecord[];
			try {
				stepAccounting = await this.waitForAccounting(
					`${rootJobId}.${stepId}`,
					{ jobName: identity.candidateJobName, allocCpus: ROOT_CPUS, nTasks: ROOT_TASKS },
					false,
					accountingOperation.signal,
				);
				stepInventory = await this.waitForStepInventory(
					rootJobId,
					{
						rootJobName: identity.jobName,
						rootState: "RUNNING",
						...cleanupStepExpectation,
					},
					"sacct-step-inventory",
					accountingOperation.signal,
				);
			} finally {
				accountingOperation.dispose();
			}
			const candidateFinishedNs = this.clock.nowNs();
			observationWithoutCleanup = {
				protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
				qualificationId,
				jobName: identity.jobName,
				workDir: identity.workDir,
				identityComment: identity.identityComment,
				rootScriptSha256: launchSha256,
				rootJobId,
				request,
				requestFileSha256,
				workerSha256,
				evaluatorSha256,
				acquisitionStartedNs: acquisitionStartedNs.toString(),
				acquisitionReadyNs: acquisitionReadyNs.toString(),
				acquisitionDurationNs: (acquisitionReadyNs - acquisitionStartedNs).toString(),
				candidateStartedNs: candidateStartedNs.toString(),
				requestPublishedNs: requestPublishedNs.toString(),
				srunStartedNs: srunStartedNs.toString(),
				srunFinishedNs: srunFinishedNs.toString(),
				candidateFinishedNs: candidateFinishedNs.toString(),
				candidateDurationNs: (candidateFinishedNs - candidateStartedNs).toString(),
				results,
				tasks,
				stepAccounting,
				stepInventory,
			};
		} catch (error) {
			primaryError = error;
			operation.dispose();
		}
		let ambiguousRootIds: string[] = [];
		if (primaryError !== undefined && submissionAttempted && !rootJobId && workDir) {
			try {
				ambiguousRootIds = await this.discoverAfterAmbiguousSubmission(identity);
				if (ambiguousRootIds.length === 1) rootJobId = ambiguousRootIds[0];
			} catch (error) {
				primaryError = new AggregateError(
					[primaryError, error],
					"Qualification failed and submission discovery failed",
				);
			}
		}

		let cleanupError: unknown;
		const cleanupAttempts: CompilerGymJobStepFailureCleanupAttempt[] = [];
		let cleanupResult:
			| {
					accounting: CompilerGymJobStepAccountingRecord;
					terminalStepInventory: CompilerGymJobStepAccountingRecord[];
					schedulerAbsent: true;
					matchingRootIds: [string];
			  }
			| undefined;
		if (rootJobId && workDir) {
			try {
				cleanupResult = await this.cleanupRoot(rootJobId, identity, cleanupStepExpectation);
				cleanupAttempts.push({
					rootJobId,
					accounting: cleanupResult.accounting,
					terminalStepInventory: cleanupResult.terminalStepInventory,
					schedulerAbsent: cleanupResult.schedulerAbsent,
					matchingRootIds: cleanupResult.matchingRootIds,
					error: null,
				});
			} catch (error) {
				cleanupError = error;
				cleanupAttempts.push({
					rootJobId,
					accounting: null,
					terminalStepInventory: [],
					schedulerAbsent: null,
					matchingRootIds: [],
					error: qualificationErrorText(error),
				});
			}
		}
		if (ambiguousRootIds.length > 1 && workDir) {
			for (const discoveredRootId of ambiguousRootIds) {
				try {
					const recoveredCleanup = await this.cleanupRoot(discoveredRootId, identity);
					cleanupAttempts.push({
						rootJobId: discoveredRootId,
						accounting: recoveredCleanup.accounting,
						terminalStepInventory: recoveredCleanup.terminalStepInventory,
						schedulerAbsent: recoveredCleanup.schedulerAbsent,
						matchingRootIds: recoveredCleanup.matchingRootIds,
						error: null,
					});
				} catch (error) {
					cleanupAttempts.push({
						rootJobId: discoveredRootId,
						accounting: null,
						terminalStepInventory: [],
						schedulerAbsent: null,
						matchingRootIds: [],
						error: qualificationErrorText(error),
					});
					cleanupError = cleanupError
						? new AggregateError([cleanupError, error], "Multiple ambiguous roots could not be cleaned")
						: error;
				}
			}
		}
		if (primaryError !== undefined || cleanupError !== undefined) {
			if (submissionAttempted) {
				throw new CompilerGymJobStepQualificationFailure({
					protocol: COMPILER_GYM_JOB_STEP_FAILURE_EVIDENCE_PROTOCOL,
					qualificationId,
					jobName: identity.jobName,
					workDir: workDir ?? identity.workDir,
					identityComment: identity.identityComment,
					submissionAttempted: true,
					rootJobId: rootJobId ?? null,
					discoveredRootIds: [...ambiguousRootIds],
					candidate: observationWithoutCleanup ?? null,
					cleanupAttempts,
					commands: structuredClone(this.commands),
					primaryError: primaryError === undefined ? null : qualificationErrorText(primaryError),
					cleanupError: cleanupError === undefined ? null : qualificationErrorText(cleanupError),
					capturedAt: this.clock.now().toISOString(),
				});
			}
			if (primaryError !== undefined && cleanupError !== undefined) {
				throw new AggregateError([primaryError, cleanupError], "Qualification and root cleanup both failed");
			}
			throw primaryError ?? cleanupError;
		}
		if (!observationWithoutCleanup || !cleanupResult) throw new Error("Qualification did not complete its evidence");
		const observation: CompilerGymJobStepQualificationObservation = {
			...observationWithoutCleanup,
			rootAccounting: cleanupResult.accounting,
			terminalStepInventory: cleanupResult.terminalStepInventory,
			cleanup: {
				schedulerAbsent: true,
				terminalState: cleanupResult.accounting.state,
				matchingRootIds: cleanupResult.matchingRootIds,
			},
			commands: structuredClone(this.commands),
		};
		analyzeCompilerGymJobStepQualification(observation);
		return observation;
	}
}

export function compilerGymJobStepQualificationConfigSha256(
	config: CompilerGymJobStepQualificationConfig = DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
): string {
	return sha256Json(config);
}

import { posix } from "node:path";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";

export const COMPILER_GYM_WARM_PROTOCOL = "compiler-gym-warm-allocation-v1" as const;
export const COMPILER_GYM_WARM_HANDLE_PREFIX = "cg-warm-v1" as const;
export const COMPILER_GYM_WARM_TASKS = ["benchmark://cbench-v1/blowfish", "benchmark://cbench-v1/bzip2"] as const;
export const COMPILER_GYM_WARM_SLOT_COUNT = 2 as const;
export const COMPILER_GYM_WARM_CPUS_PER_TASK = 2 as const;
export const COMPILER_GYM_WARM_MAX_REQUESTS = 4 as const;
export const COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES = 4 * 1024 * 1024;
export const COMPILER_GYM_WARM_CHILD_TIMEOUT_SECONDS = 300 as const;
export const COMPILER_GYM_WARM_IDLE_TIMEOUT_SECONDS = 300 as const;
export const COMPILER_GYM_WARM_LEASE_TIMEOUT_SECONDS = 0 as const;
export const COMPILER_GYM_WARM_POLL_SECONDS = 0.05 as const;
export const COMPILER_GYM_WARM_CHILD_TERMINATION_GRACE_SECONDS = 1 as const;
export const COMPILER_GYM_WARM_TRANSIENT_CACHE_TEMPLATE =
	"/tmp/prime-autoresearch-{jobId}-{benchmarkSha256_12}" as const;

export const COMPILER_GYM_WARM_LAUNCH_CONTRACT = {
	protocol: COMPILER_GYM_WARM_PROTOCOL,
	scheduler: "slurm",
	clusterHost: "farmshare",
	partition: "normal",
	cpuConstraint: "CPU_SKU:9384X",
	noRequeue: true,
	nodes: 1,
	ntasks: COMPILER_GYM_WARM_SLOT_COUNT,
	cpusPerTask: COMPILER_GYM_WARM_CPUS_PER_TASK,
	memory: "8G",
	poolWallTime: "00:30:00",
	pythonPath: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-venv-v2/bin/python",
	pythonVersion: "3.10.19",
	remoteEvaluatorDir: "/scratch/users/duynguy/prime-autoresearch/evaluators",
	compilerGymCache: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache",
	compilerGymSiteData: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2",
	ldLibraryPath: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib",
	pythonWarnings: "ignore::FutureWarning",
	transientCacheTemplate: COMPILER_GYM_WARM_TRANSIENT_CACHE_TEMPLATE,
	childWorkingDirectory: "per-request-transient-cache",
	workerModel: "fresh-evaluator-process-per-rank-request",
	requestLimit: COMPILER_GYM_WARM_MAX_REQUESTS,
	childTimeoutSeconds: COMPILER_GYM_WARM_CHILD_TIMEOUT_SECONDS,
	idleTimeoutSeconds: COMPILER_GYM_WARM_IDLE_TIMEOUT_SECONDS,
	leaseTimeoutSeconds: COMPILER_GYM_WARM_LEASE_TIMEOUT_SECONDS,
	pollSeconds: COMPILER_GYM_WARM_POLL_SECONDS,
	childTerminationGraceSeconds: COMPILER_GYM_WARM_CHILD_TERMINATION_GRACE_SECONDS,
	maxChildOutputBytes: COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES,
	tasks: COMPILER_GYM_WARM_TASKS,
} as const;

export const COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256 = sha256Json(COMPILER_GYM_WARM_LAUNCH_CONTRACT);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;
const JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

export interface CompilerGymWarmPoolExpectation {
	protocol: typeof COMPILER_GYM_WARM_PROTOCOL;
	branchDigest: string;
	poolDigest: string;
	jobName: string;
	workerSha256: string;
	evaluatorSha256: string;
	launchContractSha256: string;
}

export interface CompilerGymWarmPoolRecord extends CompilerGymWarmPoolExpectation {
	slurmId: string;
	workDir: string;
	createdAt: string;
}

export interface CompilerGymWarmReadyRecord {
	protocol: typeof COMPILER_GYM_WARM_PROTOCOL;
	poolDigest: string;
	rank: 0 | 1;
	slurmId: string;
	cpusPerTask: typeof COMPILER_GYM_WARM_CPUS_PER_TASK;
	workerSha256: string;
	evaluatorSha256: string;
	readyAt: string;
}

export interface CompilerGymWarmRequestRecord {
	protocol: typeof COMPILER_GYM_WARM_PROTOCOL;
	poolDigest: string;
	sequence: number;
	jobId: string;
	manifestDigest: string;
	requestDigest: string;
	actionsDigest: string;
	actions: string[];
	tasks: [string, string];
	publishedAt: string;
}

export interface CompilerGymWarmClaimRecord {
	protocol: typeof COMPILER_GYM_WARM_PROTOCOL;
	poolDigest: string;
	sequence: number;
	jobId: string;
	requestDigest: string;
	rank: 0 | 1;
	benchmarkId: string;
	slurmId: string;
	workerSha256: string;
	evaluatorSha256: string;
}

export interface CompilerGymWarmResultRecord extends CompilerGymWarmClaimRecord {
	childExitCode: number | null;
	stdout: string;
	stderr: string;
	wallMs: number;
	completedAt: string;
}

export interface CompilerGymWarmProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	wallMs: number;
}

export interface CompilerGymWarmPreparedEvaluation {
	handle: string;
	pool: CompilerGymWarmPoolRecord;
	ready: readonly [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord];
	request: CompilerGymWarmRequestRecord;
}

export interface CompilerGymWarmEvaluationResult {
	handle: string;
	pool: CompilerGymWarmPoolRecord;
	request: CompilerGymWarmRequestRecord;
	results: readonly [CompilerGymWarmResultRecord, CompilerGymWarmResultRecord];
	processes: readonly [CompilerGymWarmProcessResult, CompilerGymWarmProcessResult];
	stdoutArtifact: string;
	stderrArtifact: string;
}

export interface CompilerGymWarmEvaluationInput {
	branchId: string;
	jobId: string;
	manifestDigest: string;
	actions: readonly string[];
	benchmarkIds: readonly string[];
}

export interface CompilerGymWarmCloseVerification {
	mode: "shutdown" | "cancel";
	poolDigest: string;
	slurmId: string;
	schedulerAbsent: true;
	accountingState: string;
	acknowledgedRanks: readonly (0 | 1)[];
}

export interface CompilerGymWarmAcquisitionCleanupVerification {
	mode: "acquisition";
	protocol: "compiler-gym-warm-acquisition-cleanup-v1";
	poolDigest: string;
	action: "not-submitted" | "verified-absent" | "cancelled-and-verified";
	submissionAttempted: boolean;
	discoveredSlurmIds: readonly string[];
	schedulerAbsent: true;
	accounting: readonly unknown[];
	detail: string;
}

export type CompilerGymWarmCleanupVerification =
	| CompilerGymWarmCloseVerification
	| CompilerGymWarmAcquisitionCleanupVerification;

export type CompilerGymWarmRecovery =
	| {
			phase: "prepared" | "published" | "claimed";
			pool: unknown;
			ready: readonly unknown[];
			request: unknown;
			allocationTerminal: boolean;
	  }
	| {
			phase: "complete";
			pool: unknown;
			ready: readonly unknown[];
			request: unknown;
			results: readonly unknown[];
			allocationTerminal: boolean;
	  };

/**
 * Security-sensitive filesystem and scheduler operations live behind this
 * interface. A production implementation must enforce owner/mode/symlink,
 * atomic-write, scheduler-identity, and verified-absence rules before it
 * returns records to the protocol layer.
 */
export interface CompilerGymWarmBackend {
	/**
	 * A rejecting acquire call must cancel and verify absence of any allocation
	 * it created because no trusted pool handle has crossed this boundary yet.
	 */
	acquire(
		expectation: CompilerGymWarmPoolExpectation,
		signal: AbortSignal,
	): Promise<{ pool: unknown; ready: readonly unknown[] }>;
	prepareRequest(
		pool: CompilerGymWarmPoolRecord,
		request: CompilerGymWarmRequestRecord,
		signal: AbortSignal,
	): Promise<void>;
	publishRequest(
		pool: CompilerGymWarmPoolRecord,
		request: CompilerGymWarmRequestRecord,
		signal: AbortSignal,
	): Promise<void>;
	waitForResults(
		pool: CompilerGymWarmPoolRecord,
		request: CompilerGymWarmRequestRecord,
		signal: AbortSignal,
	): Promise<readonly unknown[]>;
	/**
	 * A rejecting recovery, or one that cannot return a fully validated pool,
	 * must cancel and verify absence using its opaque scheduler identity.
	 */
	recover(
		poolDigest: string,
		slurmId: string,
		requestDigest: string,
		signal: AbortSignal,
	): Promise<CompilerGymWarmRecovery>;
	shutdownAndVerify(pool: CompilerGymWarmPoolRecord, signal: AbortSignal): Promise<unknown>;
	cancelAndVerify(pool: CompilerGymWarmPoolRecord, signal: AbortSignal): Promise<unknown>;
}

export interface CompilerGymWarmTransport {
	prepareEvaluation(
		input: CompilerGymWarmEvaluationInput,
		signal: AbortSignal,
	): Promise<CompilerGymWarmPreparedEvaluation>;
	publishAndWait(
		prepared: CompilerGymWarmPreparedEvaluation,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult>;
	resumeEvaluation(
		input: CompilerGymWarmEvaluationInput,
		handle: string,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult>;
	closeAndVerify(): Promise<CompilerGymWarmCleanupVerification | undefined>;
}

function acquisitionCleanupFromError(
	error: unknown,
	expectedPoolDigest: string,
): CompilerGymWarmAcquisitionCleanupVerification | undefined {
	if (typeof error !== "object" || error === null || !("cleanupProof" in error)) return undefined;
	const root = record(error.cleanupProof, "acquisition cleanup proof");
	exactKeys(
		root,
		[
			"protocol",
			"poolDigest",
			"action",
			"submissionAttempted",
			"discoveredSlurmIds",
			"schedulerAbsent",
			"accounting",
			"detail",
		],
		"acquisition cleanup proof",
	);
	if (root.protocol !== "compiler-gym-warm-acquisition-cleanup-v1") {
		throw new Error("Acquisition cleanup proof protocol mismatch");
	}
	const poolDigest = sha256(root.poolDigest, "acquisition cleanup pool digest");
	if (poolDigest !== expectedPoolDigest) throw new Error("Acquisition cleanup proof pool mismatch");
	if (
		root.action !== "not-submitted" &&
		root.action !== "verified-absent" &&
		root.action !== "cancelled-and-verified" &&
		root.action !== "cleanup-unverified"
	) {
		throw new Error("Acquisition cleanup proof action is invalid");
	}
	if (typeof root.submissionAttempted !== "boolean") {
		throw new Error("Acquisition cleanup proof submissionAttempted is invalid");
	}
	if (!Array.isArray(root.discoveredSlurmIds)) {
		throw new Error("Acquisition cleanup proof discovered IDs are invalid");
	}
	const discoveredSlurmIds = root.discoveredSlurmIds.map((value, index) =>
		slurmId(value, `acquisition cleanup discoveredSlurmIds[${index}]`),
	);
	if (new Set(discoveredSlurmIds).size !== discoveredSlurmIds.length) {
		throw new Error("Acquisition cleanup proof repeats a discovered ID");
	}
	if (!Array.isArray(root.accounting)) throw new Error("Acquisition cleanup proof accounting is invalid");
	const detail = string(root.detail, "acquisition cleanup detail");
	if (root.schedulerAbsent !== true || root.action === "cleanup-unverified") {
		throw new Error(`Acquisition cleanup was not verified: ${detail}`);
	}
	return {
		mode: "acquisition",
		protocol: root.protocol,
		poolDigest,
		action: root.action,
		submissionAttempted: root.submissionAttempted,
		discoveredSlurmIds,
		schedulerAbsent: true,
		accounting: [...root.accounting],
		detail,
	};
}

export interface ProtocolCompilerGymWarmTransportOptions {
	workerSha256: string;
	evaluatorSha256: string;
	launchContractSha256?: string;
	now?: () => Date;
	cleanupTimeoutMs?: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${label} keys mismatch: expected ${wanted.join(",")}, received ${actual.join(",")}`);
	}
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function sha256(value: unknown, label: string): string {
	const digest = string(value, label);
	if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256`);
	return digest;
}

function timestamp(value: unknown, label: string): string {
	const observed = string(value, label);
	if (!Number.isFinite(Date.parse(observed))) throw new Error(`${label} must be an ISO timestamp`);
	return observed;
}

function slurmId(value: unknown, label: string): string {
	const observed = string(value, label);
	if (!SLURM_ID_PATTERN.test(observed)) throw new Error(`${label} must be a positive numeric SLURM ID`);
	return observed;
}

function rank(value: unknown, label: string): 0 | 1 {
	if (value !== 0 && value !== 1) throw new Error(`${label} must be 0 or 1`);
	return value;
}

function sequence(value: unknown, label: string): number {
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= COMPILER_GYM_WARM_MAX_REQUESTS) {
		throw new Error(`${label} must be an integer from 0 through ${COMPILER_GYM_WARM_MAX_REQUESTS - 1}`);
	}
	return value as number;
}

function protocol(value: unknown, label: string): typeof COMPILER_GYM_WARM_PROTOCOL {
	if (value !== COMPILER_GYM_WARM_PROTOCOL) throw new Error(`${label} must be ${COMPILER_GYM_WARM_PROTOCOL}`);
	return value;
}

function safeJobId(value: unknown, label: string): string {
	const observed = string(value, label);
	if (!JOB_ID_PATTERN.test(observed)) throw new Error(`${label} is not a bounded safe identifier`);
	return observed;
}

function taskTuple(value: unknown, label: string): [string, string] {
	if (
		!Array.isArray(value) ||
		value.length !== COMPILER_GYM_WARM_TASKS.length ||
		value.some((item, index) => item !== COMPILER_GYM_WARM_TASKS[index])
	) {
		throw new Error(`${label} must be the ordered fixed CompilerGym task pair`);
	}
	return [...COMPILER_GYM_WARM_TASKS];
}

function actions(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string") || value.length > 256) {
		throw new Error(`${label} must be a JSON string array with at most 256 entries`);
	}
	return [...value];
}

export function compilerGymWarmBranchDigest(branchId: string): string {
	if (branchId.length === 0) throw new Error("branchId must not be empty");
	return sha256Text(branchId);
}

export function compilerGymWarmPoolDigest(
	branchDigest: string,
	workerSha256: string,
	evaluatorSha256: string,
	launchContractSha256 = COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
): string {
	return sha256Json({
		protocol: COMPILER_GYM_WARM_PROTOCOL,
		branchDigest: sha256(branchDigest, "branchDigest"),
		workerSha256: sha256(workerSha256, "workerSha256"),
		evaluatorSha256: sha256(evaluatorSha256, "evaluatorSha256"),
		launchContractSha256: sha256(launchContractSha256, "launchContractSha256"),
	});
}

export function compilerGymWarmJobName(poolDigest: string): string {
	return `cg-warm-${sha256(poolDigest, "poolDigest").slice(0, 20)}`;
}

export function compilerGymWarmRequestDigest(
	value: Pick<
		CompilerGymWarmRequestRecord,
		"protocol" | "poolDigest" | "sequence" | "jobId" | "manifestDigest" | "actionsDigest" | "actions" | "tasks"
	>,
): string {
	return sha256Json({
		protocol: value.protocol,
		poolDigest: value.poolDigest,
		sequence: value.sequence,
		jobId: value.jobId,
		manifestDigest: value.manifestDigest,
		actionsDigest: value.actionsDigest,
		actions: value.actions,
		tasks: value.tasks,
	});
}

export function compilerGymWarmHandle(poolDigest: string, requestDigest: string, numericSlurmId: string): string {
	return `${COMPILER_GYM_WARM_HANDLE_PREFIX}:${sha256(poolDigest, "poolDigest")}:${sha256(
		requestDigest,
		"requestDigest",
	)}:${slurmId(numericSlurmId, "slurmId")}`;
}

export function parseCompilerGymWarmHandle(value: string): {
	poolDigest: string;
	requestDigest: string;
	slurmId: string;
} {
	const parts = value.split(":");
	if (parts.length !== 4 || parts[0] !== COMPILER_GYM_WARM_HANDLE_PREFIX) {
		throw new Error("Invalid CompilerGym warm-allocation handle");
	}
	return {
		poolDigest: sha256(parts[1], "handle pool digest"),
		requestDigest: sha256(parts[2], "handle request digest"),
		slurmId: slurmId(parts[3], "handle SLURM ID"),
	};
}

export function parseCompilerGymWarmPoolRecord(
	value: unknown,
	expectation: CompilerGymWarmPoolExpectation,
): CompilerGymWarmPoolRecord {
	const root = record(value, "pool record");
	exactKeys(
		root,
		[
			"protocol",
			"poolDigest",
			"branchDigest",
			"slurmId",
			"jobName",
			"workDir",
			"workerSha256",
			"evaluatorSha256",
			"launchContractSha256",
			"createdAt",
		],
		"pool record",
	);
	const result: CompilerGymWarmPoolRecord = {
		protocol: protocol(root.protocol, "pool.protocol"),
		poolDigest: sha256(root.poolDigest, "pool.poolDigest"),
		branchDigest: sha256(root.branchDigest, "pool.branchDigest"),
		slurmId: slurmId(root.slurmId, "pool.slurmId"),
		jobName: string(root.jobName, "pool.jobName"),
		workDir: string(root.workDir, "pool.workDir"),
		workerSha256: sha256(root.workerSha256, "pool.workerSha256"),
		evaluatorSha256: sha256(root.evaluatorSha256, "pool.evaluatorSha256"),
		launchContractSha256: sha256(root.launchContractSha256, "pool.launchContractSha256"),
		createdAt: timestamp(root.createdAt, "pool.createdAt"),
	};
	for (const key of [
		"protocol",
		"poolDigest",
		"branchDigest",
		"jobName",
		"workerSha256",
		"evaluatorSha256",
		"launchContractSha256",
	] as const) {
		if (result[key] !== expectation[key]) throw new Error(`pool.${key} does not match the launch expectation`);
	}
	if (!result.workDir.startsWith("/") || posix.basename(result.workDir) !== expectation.branchDigest) {
		throw new Error("pool.workDir must end in the branch digest");
	}
	return result;
}

export function parseCompilerGymWarmReadyRecords(
	values: readonly unknown[],
	pool: CompilerGymWarmPoolRecord,
): [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord] {
	if (values.length !== COMPILER_GYM_WARM_SLOT_COUNT)
		throw new Error("Exactly two warm-worker ready records are required");
	const parsed = values.map((value, index): CompilerGymWarmReadyRecord => {
		const root = record(value, `ready[${index}]`);
		exactKeys(
			root,
			["protocol", "poolDigest", "rank", "slurmId", "cpusPerTask", "workerSha256", "evaluatorSha256", "readyAt"],
			`ready[${index}]`,
		);
		const cpusPerTask = root.cpusPerTask;
		if (cpusPerTask !== COMPILER_GYM_WARM_CPUS_PER_TASK) {
			throw new Error(`ready[${index}].cpusPerTask must be ${COMPILER_GYM_WARM_CPUS_PER_TASK}`);
		}
		const result: CompilerGymWarmReadyRecord = {
			protocol: protocol(root.protocol, `ready[${index}].protocol`),
			poolDigest: sha256(root.poolDigest, `ready[${index}].poolDigest`),
			rank: rank(root.rank, `ready[${index}].rank`),
			slurmId: slurmId(root.slurmId, `ready[${index}].slurmId`),
			cpusPerTask,
			workerSha256: sha256(root.workerSha256, `ready[${index}].workerSha256`),
			evaluatorSha256: sha256(root.evaluatorSha256, `ready[${index}].evaluatorSha256`),
			readyAt: timestamp(root.readyAt, `ready[${index}].readyAt`),
		};
		for (const key of ["protocol", "poolDigest", "slurmId", "workerSha256", "evaluatorSha256"] as const) {
			if (result[key] !== pool[key]) throw new Error(`ready[${index}].${key} does not match the pool record`);
		}
		return result;
	});
	parsed.sort((left, right) => left.rank - right.rank);
	if (parsed[0].rank !== 0 || parsed[1].rank !== 1) throw new Error("Warm-worker ready ranks must be exactly 0 and 1");
	return [parsed[0], parsed[1]];
}

export function parseCompilerGymWarmRequestRecord(value: unknown): CompilerGymWarmRequestRecord {
	const root = record(value, "request record");
	exactKeys(
		root,
		[
			"protocol",
			"poolDigest",
			"sequence",
			"jobId",
			"manifestDigest",
			"requestDigest",
			"actionsDigest",
			"actions",
			"tasks",
			"publishedAt",
		],
		"request record",
	);
	const result: CompilerGymWarmRequestRecord = {
		protocol: protocol(root.protocol, "request.protocol"),
		poolDigest: sha256(root.poolDigest, "request.poolDigest"),
		sequence: sequence(root.sequence, "request.sequence"),
		jobId: safeJobId(root.jobId, "request.jobId"),
		manifestDigest: sha256(root.manifestDigest, "request.manifestDigest"),
		requestDigest: sha256(root.requestDigest, "request.requestDigest"),
		actionsDigest: sha256(root.actionsDigest, "request.actionsDigest"),
		actions: actions(root.actions, "request.actions"),
		tasks: taskTuple(root.tasks, "request.tasks"),
		publishedAt: timestamp(root.publishedAt, "request.publishedAt"),
	};
	if (result.actionsDigest !== sha256Json(result.actions)) throw new Error("request.actionsDigest mismatch");
	if (result.requestDigest !== compilerGymWarmRequestDigest(result)) throw new Error("request.requestDigest mismatch");
	return result;
}

export function parseCompilerGymWarmResultRecords(
	values: readonly unknown[],
	pool: CompilerGymWarmPoolRecord,
	request: CompilerGymWarmRequestRecord,
): [CompilerGymWarmResultRecord, CompilerGymWarmResultRecord] {
	if (values.length !== COMPILER_GYM_WARM_SLOT_COUNT)
		throw new Error("Exactly two warm-worker result records are required");
	const parsed = values.map((value, index): CompilerGymWarmResultRecord => {
		const root = record(value, `result[${index}]`);
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
				"childExitCode",
				"stdout",
				"stderr",
				"wallMs",
				"completedAt",
			],
			`result[${index}]`,
		);
		const observedRank = rank(root.rank, `result[${index}].rank`);
		const childExitCode = root.childExitCode;
		if (childExitCode !== null && (typeof childExitCode !== "number" || !Number.isSafeInteger(childExitCode))) {
			throw new Error(`result[${index}].childExitCode must be a safe integer or null`);
		}
		if (typeof root.wallMs !== "number" || !Number.isFinite(root.wallMs) || root.wallMs < 0) {
			throw new Error(`result[${index}].wallMs must be a nonnegative finite number`);
		}
		const stdout = string(root.stdout, `result[${index}].stdout`);
		const stderr = string(root.stderr, `result[${index}].stderr`);
		if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES) {
			throw new Error(
				`result[${index}] exceeds the ${COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES}-byte child output limit`,
			);
		}
		const result: CompilerGymWarmResultRecord = {
			protocol: protocol(root.protocol, `result[${index}].protocol`),
			poolDigest: sha256(root.poolDigest, `result[${index}].poolDigest`),
			sequence: sequence(root.sequence, `result[${index}].sequence`),
			jobId: safeJobId(root.jobId, `result[${index}].jobId`),
			requestDigest: sha256(root.requestDigest, `result[${index}].requestDigest`),
			rank: observedRank,
			benchmarkId: string(root.benchmarkId, `result[${index}].benchmarkId`),
			slurmId: slurmId(root.slurmId, `result[${index}].slurmId`),
			workerSha256: sha256(root.workerSha256, `result[${index}].workerSha256`),
			evaluatorSha256: sha256(root.evaluatorSha256, `result[${index}].evaluatorSha256`),
			childExitCode,
			stdout,
			stderr,
			wallMs: root.wallMs,
			completedAt: timestamp(root.completedAt, `result[${index}].completedAt`),
		};
		const expected = {
			protocol: pool.protocol,
			poolDigest: pool.poolDigest,
			sequence: request.sequence,
			jobId: request.jobId,
			requestDigest: request.requestDigest,
			benchmarkId: request.tasks[observedRank],
			slurmId: pool.slurmId,
			workerSha256: pool.workerSha256,
			evaluatorSha256: pool.evaluatorSha256,
		};
		for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
			if (result[key] !== expected[key])
				throw new Error(`result[${index}].${key} does not match its request and pool`);
		}
		return result;
	});
	parsed.sort((left, right) => left.rank - right.rank);
	if (parsed[0].rank !== 0 || parsed[1].rank !== 1)
		throw new Error("Warm-worker result ranks must be exactly 0 and 1");
	return [parsed[0], parsed[1]];
}

function parseCloseVerification(
	value: unknown,
	pool: CompilerGymWarmPoolRecord,
	expectedMode: CompilerGymWarmCloseVerification["mode"],
): CompilerGymWarmCloseVerification {
	const root = record(value, "close verification");
	exactKeys(
		root,
		["mode", "poolDigest", "slurmId", "schedulerAbsent", "accountingState", "acknowledgedRanks"],
		"close verification",
	);
	if (root.mode !== "shutdown" && root.mode !== "cancel") throw new Error("close verification mode is invalid");
	if (root.mode !== expectedMode) throw new Error(`close verification mode must be ${expectedMode}`);
	if (root.schedulerAbsent !== true) throw new Error("Warm allocation scheduler absence was not verified");
	if (!Array.isArray(root.acknowledgedRanks) || !root.acknowledgedRanks.every((item) => item === 0 || item === 1)) {
		throw new Error("close verification acknowledgedRanks is invalid");
	}
	const acknowledgedRanks = [...new Set(root.acknowledgedRanks)].sort();
	if (acknowledgedRanks.length !== root.acknowledgedRanks.length) {
		throw new Error("close verification acknowledgedRanks contains duplicates");
	}
	if (
		root.mode === "shutdown" &&
		(acknowledgedRanks.length !== 2 || acknowledgedRanks[0] !== 0 || acknowledgedRanks[1] !== 1)
	) {
		throw new Error("Clean warm-allocation shutdown requires acknowledgements from ranks 0 and 1");
	}
	const result: CompilerGymWarmCloseVerification = {
		mode: root.mode,
		poolDigest: sha256(root.poolDigest, "close.poolDigest"),
		slurmId: slurmId(root.slurmId, "close.slurmId"),
		schedulerAbsent: true,
		accountingState: string(root.accountingState, "close.accountingState"),
		acknowledgedRanks,
	};
	if (result.poolDigest !== pool.poolDigest || result.slurmId !== pool.slurmId) {
		throw new Error("close verification does not identify the active pool");
	}
	return result;
}

function requestMatchesInput(request: CompilerGymWarmRequestRecord, input: CompilerGymWarmEvaluationInput): void {
	if (request.jobId !== input.jobId) throw new Error("Recovered warm request job ID mismatch");
	if (request.manifestDigest !== input.manifestDigest) throw new Error("Recovered warm request manifest mismatch");
	if (request.actionsDigest !== sha256Json(input.actions)) throw new Error("Recovered warm request actions mismatch");
	if (canonicalJson(toJsonValue(request.actions)) !== canonicalJson(toJsonValue(input.actions))) {
		throw new Error("Recovered warm request action sequence mismatch");
	}
	taskTuple(input.benchmarkIds, "evaluation benchmarkIds");
}

export class ProtocolCompilerGymWarmTransport implements CompilerGymWarmTransport {
	private readonly workerSha256: string;
	private readonly evaluatorSha256: string;
	private readonly launchContractSha256: string;
	private readonly now: () => Date;
	private readonly cleanupTimeoutMs: number;
	private activePool: CompilerGymWarmPoolRecord | undefined;
	private activeReady: [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord] | undefined;
	private branchDigest: string | undefined;
	private nextSequence = 0;
	private preparedRequestDigest: string | undefined;
	private requestReserved = false;
	private serializedOperationActive = false;
	private readonly serializedOperationQueue: Array<() => void> = [];
	private closeRequested = false;
	private closeOperation: Promise<CompilerGymWarmCleanupVerification | undefined> | undefined;
	private cancellationOperation: Promise<CompilerGymWarmCloseVerification> | undefined;
	private acquisitionCleanupVerification: CompilerGymWarmAcquisitionCleanupVerification | undefined;
	private acquisitionCleanupFailure: unknown;
	private poisoned = false;

	constructor(
		private readonly backend: CompilerGymWarmBackend,
		options: ProtocolCompilerGymWarmTransportOptions,
	) {
		this.workerSha256 = sha256(options.workerSha256, "workerSha256");
		this.evaluatorSha256 = sha256(options.evaluatorSha256, "evaluatorSha256");
		this.launchContractSha256 = sha256(
			options.launchContractSha256 ?? COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
			"launchContractSha256",
		);
		this.now = options.now ?? (() => new Date());
		this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 30_000;
		if (!Number.isInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs < 1) {
			throw new Error("cleanupTimeoutMs must be a positive integer");
		}
	}

	private expectation(input: CompilerGymWarmEvaluationInput): CompilerGymWarmPoolExpectation {
		const branchDigest = compilerGymWarmBranchDigest(input.branchId);
		const poolDigest = compilerGymWarmPoolDigest(
			branchDigest,
			this.workerSha256,
			this.evaluatorSha256,
			this.launchContractSha256,
		);
		return {
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			branchDigest,
			poolDigest,
			jobName: compilerGymWarmJobName(poolDigest),
			workerSha256: this.workerSha256,
			evaluatorSha256: this.evaluatorSha256,
			launchContractSha256: this.launchContractSha256,
		};
	}

	private validateInput(input: CompilerGymWarmEvaluationInput): void {
		safeJobId(input.jobId, "jobId");
		sha256(input.manifestDigest, "manifestDigest");
		actions(input.actions, "actions");
		taskTuple(input.benchmarkIds, "benchmarkIds");
	}

	private async ensurePool(
		input: CompilerGymWarmEvaluationInput,
		signal: AbortSignal,
	): Promise<{ pool: CompilerGymWarmPoolRecord; ready: [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord] }> {
		const expectation = this.expectation(input);
		if (this.branchDigest !== undefined && this.branchDigest !== expectation.branchDigest) {
			throw new Error("A CompilerGym warm transport cannot serve a second branch");
		}
		if (this.activePool && this.activeReady) return { pool: this.activePool, ready: this.activeReady };
		let acquired: { pool: unknown; ready: readonly unknown[] };
		try {
			acquired = await this.backend.acquire(expectation, signal);
		} catch (error) {
			this.poisoned = true;
			try {
				this.acquisitionCleanupVerification = acquisitionCleanupFromError(error, expectation.poolDigest);
				if (!this.acquisitionCleanupVerification) this.acquisitionCleanupFailure = error;
			} catch (cleanupProofError) {
				this.acquisitionCleanupFailure = cleanupProofError;
			}
			throw error;
		}
		const pool = parseCompilerGymWarmPoolRecord(acquired.pool, expectation);
		let ready: [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord];
		try {
			ready = parseCompilerGymWarmReadyRecords(acquired.ready, pool);
		} catch (error) {
			return this.cancelAfterFailure(pool, error);
		}
		this.branchDigest = expectation.branchDigest;
		this.activePool = pool;
		this.activeReady = ready;
		return { pool, ready };
	}

	prepareEvaluation(
		input: CompilerGymWarmEvaluationInput,
		signal: AbortSignal,
	): Promise<CompilerGymWarmPreparedEvaluation> {
		if (this.poisoned) return Promise.reject(new Error("CompilerGym warm allocation is poisoned"));
		if (this.closeRequested) return Promise.reject(new Error("CompilerGym warm allocation is closing or closed"));
		return this.runSerialized(() => this.prepareEvaluationSerialized(input, signal));
	}

	private async prepareEvaluationSerialized(
		input: CompilerGymWarmEvaluationInput,
		signal: AbortSignal,
	): Promise<CompilerGymWarmPreparedEvaluation> {
		if (this.poisoned) throw new Error("CompilerGym warm allocation is poisoned");
		if (this.requestReserved) throw new Error("A CompilerGym warm request is already prepared");
		if (this.nextSequence >= COMPILER_GYM_WARM_MAX_REQUESTS) {
			throw new Error(`CompilerGym warm allocation accepts exactly ${COMPILER_GYM_WARM_MAX_REQUESTS} requests`);
		}
		this.validateInput(input);
		this.requestReserved = true;
		const reservedSequence = this.nextSequence;
		const { pool, ready } = await this.ensurePool(input, signal);
		const actionsCopy = [...input.actions];
		const requestBody = {
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			poolDigest: pool.poolDigest,
			sequence: reservedSequence,
			jobId: input.jobId,
			manifestDigest: input.manifestDigest,
			actionsDigest: sha256Json(actionsCopy),
			actions: actionsCopy,
			tasks: [...COMPILER_GYM_WARM_TASKS] as [string, string],
		};
		const request: CompilerGymWarmRequestRecord = {
			...requestBody,
			requestDigest: compilerGymWarmRequestDigest(requestBody),
			publishedAt: this.now().toISOString(),
		};
		try {
			await this.backend.prepareRequest(pool, request, signal);
		} catch (error) {
			return this.cancelAfterFailure(pool, error);
		}
		this.preparedRequestDigest = request.requestDigest;
		this.nextSequence = reservedSequence + 1;
		return {
			handle: compilerGymWarmHandle(pool.poolDigest, request.requestDigest, pool.slurmId),
			pool,
			ready,
			request,
		};
	}

	publishAndWait(
		prepared: CompilerGymWarmPreparedEvaluation,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult> {
		if (this.poisoned) return Promise.reject(new Error("CompilerGym warm allocation is poisoned"));
		if (this.closeRequested) return Promise.reject(new Error("CompilerGym warm allocation is closing or closed"));
		return this.runSerialized(() => this.publishAndWaitSerialized(prepared, signal));
	}

	private async publishAndWaitSerialized(
		prepared: CompilerGymWarmPreparedEvaluation,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult> {
		if (this.poisoned) throw new Error("CompilerGym warm allocation is poisoned");
		if (!this.activePool || prepared.pool.poolDigest !== this.activePool.poolDigest) {
			throw new Error("Prepared warm request does not belong to the active pool");
		}
		if (prepared.request.requestDigest !== this.preparedRequestDigest) {
			throw new Error("Prepared warm request is not the active unpublished request");
		}
		try {
			await this.backend.publishRequest(prepared.pool, prepared.request, signal);
			const values = await this.backend.waitForResults(prepared.pool, prepared.request, signal);
			const result = this.complete(prepared.pool, prepared.ready, prepared.request, values);
			this.preparedRequestDigest = undefined;
			this.requestReserved = false;
			return result;
		} catch (error) {
			return this.cancelAfterFailure(prepared.pool, error);
		}
	}

	resumeEvaluation(
		input: CompilerGymWarmEvaluationInput,
		handleValue: string,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult> {
		if (this.poisoned) return Promise.reject(new Error("CompilerGym warm allocation is poisoned"));
		if (this.closeRequested) return Promise.reject(new Error("CompilerGym warm allocation is closing or closed"));
		return this.runSerialized(() => this.resumeEvaluationSerialized(input, handleValue, signal));
	}

	private async resumeEvaluationSerialized(
		input: CompilerGymWarmEvaluationInput,
		handleValue: string,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult> {
		if (this.poisoned) throw new Error("CompilerGym warm allocation is poisoned");
		if (this.requestReserved) throw new Error("A CompilerGym warm request is already prepared");
		this.validateInput(input);
		const handle = parseCompilerGymWarmHandle(handleValue);
		const expectation = this.expectation(input);
		if (handle.poolDigest !== expectation.poolDigest)
			throw new Error("Warm handle belongs to a different branch or contract");
		this.requestReserved = true;
		let recovered: CompilerGymWarmRecovery;
		try {
			recovered = await this.backend.recover(handle.poolDigest, handle.slurmId, handle.requestDigest, signal);
		} catch (error) {
			this.poisoned = true;
			throw error;
		}
		let pool: CompilerGymWarmPoolRecord;
		try {
			pool = parseCompilerGymWarmPoolRecord(recovered.pool, expectation);
		} catch (error) {
			this.poisoned = true;
			throw error;
		}
		if (pool.slurmId !== handle.slurmId) throw new Error("Recovered warm pool SLURM ID mismatch");
		try {
			const ready = parseCompilerGymWarmReadyRecords(recovered.ready, pool);
			const request = parseCompilerGymWarmRequestRecord(recovered.request);
			if (request.poolDigest !== pool.poolDigest || request.requestDigest !== handle.requestDigest) {
				throw new Error("Recovered warm request does not match its durable handle");
			}
			requestMatchesInput(request, input);
			this.activePool = pool;
			this.activeReady = ready;
			this.branchDigest = expectation.branchDigest;
			this.nextSequence = Math.max(this.nextSequence, request.sequence + 1);
			this.preparedRequestDigest = request.requestDigest;
			if (recovered.phase === "prepared") {
				if (recovered.allocationTerminal)
					throw new Error("Prepared warm request lost its allocation before publication");
				await this.backend.publishRequest(pool, request, signal);
			}
			if (recovered.phase === "published" && recovered.allocationTerminal) {
				throw new Error("Published warm request lost its allocation before either slot claimed it");
			}
			if (recovered.phase === "claimed" && recovered.allocationTerminal) {
				throw new Error("Warm request is ambiguous: claim exists, allocation is terminal, and result is absent");
			}
			if (recovered.phase === "complete" && recovered.allocationTerminal) {
				throw new Error("Completed warm request lost its reusable allocation before verified shutdown");
			}
			const values =
				recovered.phase === "complete"
					? recovered.results
					: await this.backend.waitForResults(pool, request, signal);
			const result = this.complete(pool, ready, request, values);
			this.preparedRequestDigest = undefined;
			this.requestReserved = false;
			return result;
		} catch (error) {
			return this.cancelAfterFailure(pool, error);
		}
	}

	private complete(
		pool: CompilerGymWarmPoolRecord,
		ready: readonly [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord],
		request: CompilerGymWarmRequestRecord,
		values: readonly unknown[],
	): CompilerGymWarmEvaluationResult {
		const results = parseCompilerGymWarmResultRecords(values, pool, request);
		const handle = compilerGymWarmHandle(pool.poolDigest, request.requestDigest, pool.slurmId);
		const stdoutArtifact = `${canonicalJson(
			toJsonValue({
				protocol: COMPILER_GYM_WARM_PROTOCOL,
				handle,
				pool,
				ready,
				request,
				results,
			}),
		)}\n`;
		return {
			handle,
			pool,
			request,
			results,
			processes: results.map((result) => ({
				exitCode: result.childExitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				wallMs: result.wallMs,
			})) as [CompilerGymWarmProcessResult, CompilerGymWarmProcessResult],
			stdoutArtifact,
			stderrArtifact: results.map((result) => `${result.benchmarkId}\t${result.stderr.trim()}`).join("\n"),
		};
	}

	private cleanupSignal(): { signal: AbortSignal; dispose(): void } {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(new Error("Warm-allocation cleanup timed out")),
			this.cleanupTimeoutMs,
		);
		return { signal: controller.signal, dispose: () => clearTimeout(timeout) };
	}

	private poisonAndCancel(pool: CompilerGymWarmPoolRecord): Promise<CompilerGymWarmCloseVerification> {
		this.poisoned = true;
		if (!this.cancellationOperation) {
			this.cancellationOperation = (async () => {
				const cleanup = this.cleanupSignal();
				try {
					return parseCloseVerification(await this.backend.cancelAndVerify(pool, cleanup.signal), pool, "cancel");
				} finally {
					cleanup.dispose();
				}
			})();
		}
		return this.cancellationOperation;
	}

	private async cancelAfterFailure(pool: CompilerGymWarmPoolRecord, primaryError: unknown): Promise<never> {
		try {
			await this.poisonAndCancel(pool);
		} catch (cleanupError) {
			throw new AggregateError(
				[primaryError, cleanupError],
				"CompilerGym warm request failed and allocation cleanup also failed",
			);
		}
		throw primaryError;
	}

	private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const run = (): void => {
				let result: Promise<T>;
				try {
					result = operation();
				} catch (error) {
					reject(error);
					this.releaseSerializedOperation();
					return;
				}
				result.then(resolve, reject).finally(() => this.releaseSerializedOperation());
			};
			if (this.serializedOperationActive) {
				this.serializedOperationQueue.push(run);
				return;
			}
			this.serializedOperationActive = true;
			run();
		});
	}

	private releaseSerializedOperation(): void {
		const next = this.serializedOperationQueue.shift();
		if (next) {
			next();
			return;
		}
		this.serializedOperationActive = false;
	}

	closeAndVerify(): Promise<CompilerGymWarmCleanupVerification | undefined> {
		if (this.closeOperation) return this.closeOperation;
		this.closeRequested = true;
		this.closeOperation = this.runSerialized(async () => {
			if (this.cancellationOperation) return this.cancellationOperation;
			if (this.acquisitionCleanupFailure) {
				throw new Error("Warm acquisition failed without verified scheduler cleanup", {
					cause: this.acquisitionCleanupFailure,
				});
			}
			if (this.acquisitionCleanupVerification) return this.acquisitionCleanupVerification;
			if (!this.activePool) return undefined;
			const pool = this.activePool;
			const cleanup = this.cleanupSignal();
			try {
				try {
					return parseCloseVerification(
						await this.backend.shutdownAndVerify(pool, cleanup.signal),
						pool,
						"shutdown",
					);
				} catch (shutdownError) {
					try {
						return await this.poisonAndCancel(pool);
					} catch (cancelError) {
						throw new AggregateError(
							[shutdownError, cancelError],
							"CompilerGym warm shutdown and cancellation both failed",
						);
					}
				}
			} finally {
				cleanup.dispose();
			}
		});
		return this.closeOperation;
	}
}

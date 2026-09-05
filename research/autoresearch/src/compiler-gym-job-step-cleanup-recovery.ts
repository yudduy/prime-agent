import assert from "node:assert/strict";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	type CompilerGymJobStepQualificationConfig,
	DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
} from "./compiler-gym-job-step-qualification.js";
import {
	type CompilerGymWarmCommandResult,
	type CompilerGymWarmCommandRunner,
	compilerGymWarmSshArgv,
	SpawnCompilerGymWarmCommandRunner,
} from "./compiler-gym-warm-farmshare-backend.js";

export const COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL = "compiler-gym-job-step-run-owner-v1" as const;
export const COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL = "compiler-gym-job-step-dispatch-intent-v1" as const;
export const COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL = "compiler-gym-job-step-root-handle-v1" as const;
export const COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL = "compiler-gym-job-step-held-verification-v1" as const;
export const COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL =
	"compiler-gym-job-step-root-release-intent-v1" as const;
export const COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL = "compiler-gym-job-step-root-ready-v1" as const;
export const COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_PROTOCOL = "compiler-gym-job-step-cleanup-recovery-v1" as const;
export const COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL =
	"compiler-gym-job-step-cleanup-recovery-lease-v1" as const;

const ROOT_CPUS = 4;
const ROOT_TASKS = 2;
const CPUS_PER_TASK = 2;
const MAX_CONTROL_OUTPUT_BYTES = 1024 * 1024;
const INVENTORY_STABILIZATION_MS = 5_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROOT_ID_PATTERN = /^[1-9][0-9]*$/;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SAFE_PATH_PATTERN = /^\/[A-Za-z0-9._/-]+$/;
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

export interface CompilerGymJobStepClaimOwnerRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL;
	qualificationId: string;
	outputDir: string;
	hostname: string;
	pid: number;
	startedAt: string;
}

export interface CompilerGymJobStepDispatchIntentRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL;
	qualificationProtocol: string;
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
	claimOwnerSha256: string;
}

export interface CompilerGymJobStepRootHandleRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL;
	qualificationProtocol: string;
	qualificationId: string;
	rootJobId: string;
	jobName: string;
	workDir: string;
	submittedAt: string;
	dispatchIntentSha256: string;
}

export interface CompilerGymJobStepHeldIdentity {
	batchFlag: 1;
	priority: 0;
	reason: "JobHeldUser";
	state: "PENDING";
}

export interface CompilerGymJobStepHeldVerificationRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL;
	qualificationProtocol: string;
	qualificationId: string;
	rootJobId: string;
	jobName: string;
	workDir: string;
	identityComment: string;
	rootScriptSha256: string;
	spooledScriptSha256: string;
	heldIdentity: CompilerGymJobStepHeldIdentity;
	verifiedAt: string;
	dispatchIntentSha256: string;
	rootHandleSha256: string;
}

export interface CompilerGymJobStepRootReleaseIntentRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL;
	qualificationProtocol: string;
	qualificationId: string;
	rootJobId: string;
	jobName: string;
	workDir: string;
	identityComment: string;
	recordedAt: string;
	dispatchIntentSha256: string;
	rootHandleSha256: string;
	heldVerificationSha256: string;
}

export interface CompilerGymJobStepRootReadyRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL;
	qualificationProtocol: string;
	qualificationId: string;
	rootJobId: string;
	jobName: string;
	workDir: string;
	identityComment: string;
	validatedAt: string;
	dispatchIntentSha256: string;
	rootHandleSha256: string;
	heldVerificationSha256: string;
	rootReleaseIntentSha256: string;
}

export interface CompilerGymJobStepLedgerSnapshot {
	present: boolean;
	bytes: number;
	sha256: string | null;
}

export interface CompilerGymJobStepCleanupRecoveryLeaseRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL;
	qualificationId: string;
	outputDir: string;
	generation: string;
	hostname: string;
	pid: number;
	acquiredAt: string;
	originalOwnerSha256: string;
}

export interface CompilerGymJobStepRecoveryCommandEvidence {
	sequence: number;
	label: string;
	remoteArgv: string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	stdoutSha256: string;
	stderrSha256: string;
	wallMs: number;
	capturedAt: string;
}

export interface CompilerGymJobStepRecoveryAccountingRecord {
	rootJobId: string;
	user: string;
	jobName: string;
	workDir: string;
	identityComment: string;
	state: string;
	exitCode: string;
	startAt: string;
	endAt: string;
}

export interface CompilerGymJobStepCleanupRecoveryRecord {
	protocol: typeof COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_PROTOCOL;
	status: "no-dispatch-intent" | "cleanup-complete";
	qualificationId: string;
	recoveredAt: string;
	cleanupOnly: true;
	dispatchIntentSha256: string | null;
	rootHandleSha256: string | null;
	heldVerificationSha256: string | null;
	rootReleaseIntentSha256: string | null;
	rootReadySha256: string | null;
	recoveryLeaseSha256: string;
	ledgerSnapshot: CompilerGymJobStepLedgerSnapshot;
	discoveredRootIds: string[];
	cancelledRootIds: string[];
	terminalAccounting: CompilerGymJobStepRecoveryAccountingRecord[];
	budgetInvalid: boolean;
	schedulerAbsent: true;
	commands: CompilerGymJobStepRecoveryCommandEvidence[];
}

export interface CompilerGymJobStepRecoveryClock {
	now(): Date;
	nowNs(): bigint;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface CompilerGymJobStepCleanupRecoveryDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	clock?: CompilerGymJobStepRecoveryClock;
}

export interface CompilerGymJobStepCleanupRecoveryInput {
	qualificationId: string;
	dispatchIntent: CompilerGymJobStepDispatchIntentRecord | null;
	dispatchIntentSha256: string | null;
	rootHandle: CompilerGymJobStepRootHandleRecord | null;
	rootHandleSha256: string | null;
	heldVerification: CompilerGymJobStepHeldVerificationRecord | null;
	heldVerificationSha256: string | null;
	rootReleaseIntentSha256: string | null;
	rootReadySha256: string | null;
	recoveryLeaseSha256: string;
	ledgerSnapshot: CompilerGymJobStepLedgerSnapshot;
}

interface InventoryRow {
	rootJobId: string;
	user: string;
	jobName: string;
	workDir: string;
	identityComment: string;
	state: string;
	source: "squeue" | "sacct";
}

interface Inventory {
	exact: Map<string, InventoryRow>;
	mismatches: InventoryRow[];
}

class SystemCompilerGymJobStepRecoveryClock implements CompilerGymJobStepRecoveryClock {
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

function objectRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys mismatch`);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function requiredStringOrEmpty(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function requiredSafeToken(value: unknown, label: string): string {
	const token = requiredString(value, label);
	if (!SAFE_TOKEN_PATTERN.test(token)) throw new Error(`${label} is unsafe`);
	return token;
}

function requiredPath(value: unknown, label: string): string {
	const path = requiredString(value, label);
	if (!SAFE_PATH_PATTERN.test(path) || path.includes("/../") || path.endsWith("/..")) {
		throw new Error(`${label} is unsafe`);
	}
	return path;
}

function requiredSha256(value: unknown, label: string): string {
	const digest = requiredString(value, label);
	if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256`);
	return digest;
}

function requiredRootId(value: unknown, label: string): string {
	const rootId = requiredString(value, label);
	if (!ROOT_ID_PATTERN.test(rootId)) throw new Error(`${label} must be a root Slurm ID`);
	return rootId;
}

function compareIntegerStrings(left: string, right: string): number {
	const leftValue = BigInt(left);
	const rightValue = BigInt(right);
	return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function requiredPositiveIntegerString(value: unknown, label: string): string {
	const integer = requiredString(value, label);
	if (!/^[1-9][0-9]*$/.test(integer)) throw new Error(`${label} must be a positive integer string`);
	return integer;
}

function requiredTimestamp(value: unknown, label: string): string {
	const timestamp = requiredString(value, label);
	if (!timestamp.endsWith("Z") || Number.isNaN(Date.parse(timestamp))) throw new Error(`${label} must be UTC`);
	return timestamp;
}

function requiredStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${label} must be a string array`);
	}
	return [...value];
}

function parseCanonicalRecord(contents: string, label: string): Record<string, unknown> {
	const value = objectRecord(JSON.parse(contents) as unknown, label);
	assert.equal(contents, `${canonicalJson(toJsonValue(value))}\n`, `${label} is not one canonical JSON line`);
	return value;
}

function commonQualificationFields(
	record: Record<string, unknown>,
	label: string,
): {
	qualificationProtocol: string;
	qualificationId: string;
	jobName: string;
	workDir: string;
} {
	return {
		qualificationProtocol: requiredSafeToken(record.qualificationProtocol, `${label}.qualificationProtocol`),
		qualificationId: requiredSafeToken(record.qualificationId, `${label}.qualificationId`),
		jobName: requiredSafeToken(record.jobName, `${label}.jobName`),
		workDir: requiredPath(record.workDir, `${label}.workDir`),
	};
}

export function parseCompilerGymJobStepClaimOwnerRecord(contents: string): CompilerGymJobStepClaimOwnerRecord {
	const record = parseCanonicalRecord(contents, "claim owner");
	exactKeys(record, ["hostname", "outputDir", "pid", "protocol", "qualificationId", "startedAt"], "claim owner");
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL);
	if (!Number.isSafeInteger(record.pid) || (record.pid as number) < 1) throw new Error("claim owner.pid is invalid");
	return {
		protocol: COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL,
		qualificationId: requiredSafeToken(record.qualificationId, "claim owner.qualificationId"),
		outputDir: requiredPath(record.outputDir, "claim owner.outputDir"),
		hostname: requiredSafeToken(record.hostname, "claim owner.hostname"),
		pid: record.pid as number,
		startedAt: requiredTimestamp(record.startedAt, "claim owner.startedAt"),
	};
}

export function parseCompilerGymJobStepCleanupRecoveryLeaseRecord(
	contents: string,
): CompilerGymJobStepCleanupRecoveryLeaseRecord {
	const record = parseCanonicalRecord(contents, "cleanup recovery lease");
	exactKeys(
		record,
		[
			"acquiredAt",
			"generation",
			"hostname",
			"originalOwnerSha256",
			"outputDir",
			"pid",
			"protocol",
			"qualificationId",
		],
		"cleanup recovery lease",
	);
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL);
	if (!Number.isSafeInteger(record.pid) || (record.pid as number) < 1) {
		throw new Error("cleanup recovery lease.pid is invalid");
	}
	return {
		protocol: COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL,
		qualificationId: requiredSafeToken(record.qualificationId, "cleanup recovery lease.qualificationId"),
		outputDir: requiredPath(record.outputDir, "cleanup recovery lease.outputDir"),
		generation: requiredPositiveIntegerString(record.generation, "cleanup recovery lease.generation"),
		hostname: requiredSafeToken(record.hostname, "cleanup recovery lease.hostname"),
		pid: record.pid as number,
		acquiredAt: requiredTimestamp(record.acquiredAt, "cleanup recovery lease.acquiredAt"),
		originalOwnerSha256: requiredSha256(record.originalOwnerSha256, "cleanup recovery lease.originalOwnerSha256"),
	};
}

export function parseCompilerGymJobStepDispatchIntentRecord(contents: string): CompilerGymJobStepDispatchIntentRecord {
	const record = parseCanonicalRecord(contents, "dispatch intent");
	exactKeys(
		record,
		[
			"candidateJobName",
			"claimOwnerSha256",
			"evaluatorSha256",
			"identityComment",
			"jobName",
			"protocol",
			"qualificationId",
			"qualificationProtocol",
			"recordedAt",
			"rootScriptSha256",
			"sbatchArgv",
			"sbatchArgvSha256",
			"workerSha256",
			"workDir",
		],
		"dispatch intent",
	);
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL);
	const common = commonQualificationFields(record, "dispatch intent");
	const sbatchArgv = requiredStringArray(record.sbatchArgv, "dispatch intent.sbatchArgv");
	const sbatchArgvSha256 = requiredSha256(record.sbatchArgvSha256, "dispatch intent.sbatchArgvSha256");
	assert.equal(sha256Json(sbatchArgv), sbatchArgvSha256, "dispatch intent sbatch argv hash mismatch");
	assert.equal(sbatchArgv[0], "/usr/bin/sbatch", "dispatch intent is not an sbatch command");
	assert.equal(sbatchArgv.filter((value) => value === "/usr/bin/sbatch").length, 1);
	assert.ok(sbatchArgv.includes("--hold"), "dispatch intent sbatch is not held");
	assert.ok(!sbatchArgv.some((value) => value === "--wrap" || value.startsWith("--wrap=")));
	assert.ok(
		sbatchArgv.slice(1).every((value) => value.startsWith("--")),
		"dispatch intent names a script path",
	);
	const identityComment = requiredSafeToken(record.identityComment, "dispatch intent.identityComment");
	assert.ok(sbatchArgv.includes(`--comment=${identityComment}`), "dispatch intent comment is not in sbatch argv");
	assert.ok(sbatchArgv.includes(`--job-name=${common.jobName}`), "dispatch intent job name is not in sbatch argv");
	assert.ok(sbatchArgv.includes(`--chdir=${common.workDir}`), "dispatch intent work directory is not in sbatch argv");
	return {
		protocol: COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL,
		...common,
		candidateJobName: requiredSafeToken(record.candidateJobName, "dispatch intent.candidateJobName"),
		identityComment,
		rootScriptSha256: requiredSha256(record.rootScriptSha256, "dispatch intent.rootScriptSha256"),
		sbatchArgv,
		sbatchArgvSha256,
		workerSha256: requiredSha256(record.workerSha256, "dispatch intent.workerSha256"),
		evaluatorSha256: requiredSha256(record.evaluatorSha256, "dispatch intent.evaluatorSha256"),
		recordedAt: requiredTimestamp(record.recordedAt, "dispatch intent.recordedAt"),
		claimOwnerSha256: requiredSha256(record.claimOwnerSha256, "dispatch intent.claimOwnerSha256"),
	};
}

export function parseCompilerGymJobStepRootHandleRecord(contents: string): CompilerGymJobStepRootHandleRecord {
	const record = parseCanonicalRecord(contents, "root handle");
	exactKeys(
		record,
		[
			"dispatchIntentSha256",
			"jobName",
			"protocol",
			"qualificationId",
			"qualificationProtocol",
			"rootJobId",
			"submittedAt",
			"workDir",
		],
		"root handle",
	);
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL);
	return {
		protocol: COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL,
		...commonQualificationFields(record, "root handle"),
		rootJobId: requiredRootId(record.rootJobId, "root handle.rootJobId"),
		submittedAt: requiredTimestamp(record.submittedAt, "root handle.submittedAt"),
		dispatchIntentSha256: requiredSha256(record.dispatchIntentSha256, "root handle.dispatchIntentSha256"),
	};
}

export function parseCompilerGymJobStepHeldVerificationRecord(
	contents: string,
): CompilerGymJobStepHeldVerificationRecord {
	const record = parseCanonicalRecord(contents, "held verification");
	exactKeys(
		record,
		[
			"dispatchIntentSha256",
			"heldIdentity",
			"identityComment",
			"jobName",
			"protocol",
			"qualificationId",
			"qualificationProtocol",
			"rootHandleSha256",
			"rootJobId",
			"rootScriptSha256",
			"spooledScriptSha256",
			"verifiedAt",
			"workDir",
		],
		"held verification",
	);
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL);
	const heldIdentity = objectRecord(record.heldIdentity, "held verification.heldIdentity");
	exactKeys(heldIdentity, ["batchFlag", "priority", "reason", "state"], "held verification.heldIdentity");
	assert.equal(heldIdentity.batchFlag, 1, "held verification BatchFlag drifted");
	assert.equal(heldIdentity.priority, 0, "held verification Priority drifted");
	assert.equal(heldIdentity.reason, "JobHeldUser", "held verification reason drifted");
	assert.equal(heldIdentity.state, "PENDING", "held verification state drifted");
	return {
		protocol: COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL,
		...commonQualificationFields(record, "held verification"),
		rootJobId: requiredRootId(record.rootJobId, "held verification.rootJobId"),
		identityComment: requiredSafeToken(record.identityComment, "held verification.identityComment"),
		rootScriptSha256: requiredSha256(record.rootScriptSha256, "held verification.rootScriptSha256"),
		spooledScriptSha256: requiredSha256(record.spooledScriptSha256, "held verification.spooledScriptSha256"),
		heldIdentity: {
			batchFlag: 1,
			priority: 0,
			reason: "JobHeldUser",
			state: "PENDING",
		},
		verifiedAt: requiredTimestamp(record.verifiedAt, "held verification.verifiedAt"),
		dispatchIntentSha256: requiredSha256(record.dispatchIntentSha256, "held verification.dispatchIntentSha256"),
		rootHandleSha256: requiredSha256(record.rootHandleSha256, "held verification.rootHandleSha256"),
	};
}

export function parseCompilerGymJobStepRootReleaseIntentRecord(
	contents: string,
): CompilerGymJobStepRootReleaseIntentRecord {
	const record = parseCanonicalRecord(contents, "root release intent");
	exactKeys(
		record,
		[
			"dispatchIntentSha256",
			"heldVerificationSha256",
			"identityComment",
			"jobName",
			"protocol",
			"qualificationId",
			"qualificationProtocol",
			"recordedAt",
			"rootHandleSha256",
			"rootJobId",
			"workDir",
		],
		"root release intent",
	);
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL);
	return {
		protocol: COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL,
		...commonQualificationFields(record, "root release intent"),
		rootJobId: requiredRootId(record.rootJobId, "root release intent.rootJobId"),
		identityComment: requiredSafeToken(record.identityComment, "root release intent.identityComment"),
		recordedAt: requiredTimestamp(record.recordedAt, "root release intent.recordedAt"),
		dispatchIntentSha256: requiredSha256(record.dispatchIntentSha256, "root release intent.dispatchIntentSha256"),
		rootHandleSha256: requiredSha256(record.rootHandleSha256, "root release intent.rootHandleSha256"),
		heldVerificationSha256: requiredSha256(
			record.heldVerificationSha256,
			"root release intent.heldVerificationSha256",
		),
	};
}

export function parseCompilerGymJobStepRootReadyRecord(contents: string): CompilerGymJobStepRootReadyRecord {
	const record = parseCanonicalRecord(contents, "root ready");
	exactKeys(
		record,
		[
			"dispatchIntentSha256",
			"heldVerificationSha256",
			"identityComment",
			"jobName",
			"protocol",
			"qualificationId",
			"qualificationProtocol",
			"rootHandleSha256",
			"rootJobId",
			"rootReleaseIntentSha256",
			"validatedAt",
			"workDir",
		],
		"root ready",
	);
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL);
	return {
		protocol: COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL,
		...commonQualificationFields(record, "root ready"),
		rootJobId: requiredRootId(record.rootJobId, "root ready.rootJobId"),
		identityComment: requiredSafeToken(record.identityComment, "root ready.identityComment"),
		validatedAt: requiredTimestamp(record.validatedAt, "root ready.validatedAt"),
		dispatchIntentSha256: requiredSha256(record.dispatchIntentSha256, "root ready.dispatchIntentSha256"),
		rootHandleSha256: requiredSha256(record.rootHandleSha256, "root ready.rootHandleSha256"),
		heldVerificationSha256: requiredSha256(record.heldVerificationSha256, "root ready.heldVerificationSha256"),
		rootReleaseIntentSha256: requiredSha256(record.rootReleaseIntentSha256, "root ready.rootReleaseIntentSha256"),
	};
}

export function compilerGymJobStepNoIntentRecovery(input: {
	qualificationId: string;
	ledgerSnapshot: CompilerGymJobStepLedgerSnapshot;
	recoveredAt: string;
	recoveryLeaseSha256: string;
}): CompilerGymJobStepCleanupRecoveryRecord {
	requiredSafeToken(input.qualificationId, "qualification ID");
	requiredTimestamp(input.recoveredAt, "recoveredAt");
	return {
		protocol: COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_PROTOCOL,
		status: "no-dispatch-intent",
		qualificationId: input.qualificationId,
		recoveredAt: input.recoveredAt,
		cleanupOnly: true,
		dispatchIntentSha256: null,
		rootHandleSha256: null,
		heldVerificationSha256: null,
		rootReleaseIntentSha256: null,
		rootReadySha256: null,
		recoveryLeaseSha256: requiredSha256(input.recoveryLeaseSha256, "recovery lease hash"),
		ledgerSnapshot: input.ledgerSnapshot,
		discoveredRootIds: [],
		cancelledRootIds: [],
		terminalAccounting: [],
		budgetInvalid: false,
		schedulerAbsent: true,
		commands: [],
	};
}

function requiredNullableSha256(value: unknown, label: string): string | null {
	return value === null ? null : requiredSha256(value, label);
}

function requiredNonnegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`${label} must be a nonnegative safe integer`);
	}
	return value as number;
}

function requiredRootIdArray(value: unknown, label: string): string[] {
	const ids = requiredStringArray(value, label).map((item, index) => requiredRootId(item, `${label}[${index}]`));
	assert.equal(new Set(ids).size, ids.length, `${label} contains duplicate root IDs`);
	assert.deepEqual(ids, [...ids].sort(compareIntegerStrings), `${label} is not sorted`);
	return ids;
}

function recoveryCommandLabel(remoteArgv: readonly [string, ...string[]]): string {
	const [command, ...args] = remoteArgv;
	if (command === "/usr/bin/squeue") {
		const identity =
			args.length === 6 &&
			args[0] === "--noheader" &&
			args[1] === "--user" &&
			args[3] === "--name" &&
			args[5] === "--format=%A|%u|%j|%Z|%k|%T";
		const root =
			args.length === 4 && args[0] === "--noheader" && args[1] === "--jobs" && args[3] === "--format=%A|%T";
		assert.ok(identity || root, "Cleanup recovery attempted a forbidden squeue operation");
		if (identity) {
			requiredSafeToken(args[2], "squeue user");
			requiredSafeToken(args[4], "squeue job name");
		} else {
			requiredRootId(args[2], "squeue root ID");
		}
		return identity ? "recovery-squeue-identity" : "recovery-squeue-root";
	}
	if (command === "/usr/bin/sacct") {
		const identity =
			args.length === 10 &&
			args[0] === "--noheader" &&
			args[1] === "-X" &&
			args[2] === "--user" &&
			args[4] === "--name" &&
			args[6] === "--starttime" &&
			args[7] === "now-1days" &&
			args[8] === "--format=JobIDRaw,User,JobName,WorkDir,Comment,State" &&
			args[9] === "--parsable2";
		const root =
			args.length === 6 &&
			args[0] === "--noheader" &&
			args[1] === "-X" &&
			args[2] === "--jobs" &&
			args[4] === "--format=JobIDRaw,User,JobName,WorkDir,Comment,State,ExitCode,Start,End" &&
			args[5] === "--parsable2";
		assert.ok(identity || root, "Cleanup recovery attempted a forbidden sacct operation");
		if (identity) {
			requiredSafeToken(args[3], "sacct user");
			requiredSafeToken(args[5], "sacct job name");
		} else {
			requiredRootId(args[3], "sacct root ID");
		}
		return identity ? "recovery-sacct-identity" : "recovery-sacct-root";
	}
	if (command === "/usr/bin/scontrol") {
		const show = args.length === 4 && args[0] === "--oneliner" && args[1] === "show" && args[2] === "job";
		const spool = args.length === 4 && args[0] === "write" && args[1] === "batch_script" && args[3] === "-";
		assert.ok(show || spool, "Cleanup recovery attempted a forbidden scontrol operation");
		requiredRootId(args[show ? 3 : 2], "scontrol root ID");
		return show ? "recovery-scontrol-root" : "recovery-scontrol-batch-script";
	}
	if (command === "/usr/bin/scancel") {
		assert.deepEqual(args.slice(0, 1), ["--full"]);
		assert.equal(args.length, 2);
		requiredRootId(args[1], "scancel root ID");
		return "recovery-scancel-root";
	}
	throw new Error(`Cleanup recovery attempted forbidden command ${command}`);
}

export function parseCompilerGymJobStepCleanupRecoveryRecord(
	contents: string,
): CompilerGymJobStepCleanupRecoveryRecord {
	const record = parseCanonicalRecord(contents, "cleanup recovery");
	exactKeys(
		record,
		[
			"budgetInvalid",
			"cancelledRootIds",
			"cleanupOnly",
			"commands",
			"discoveredRootIds",
			"dispatchIntentSha256",
			"heldVerificationSha256",
			"ledgerSnapshot",
			"protocol",
			"qualificationId",
			"recoveredAt",
			"recoveryLeaseSha256",
			"rootHandleSha256",
			"rootReadySha256",
			"rootReleaseIntentSha256",
			"schedulerAbsent",
			"status",
			"terminalAccounting",
		],
		"cleanup recovery",
	);
	assert.equal(record.protocol, COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_PROTOCOL);
	assert.ok(record.status === "no-dispatch-intent" || record.status === "cleanup-complete");
	assert.equal(record.cleanupOnly, true);
	assert.equal(record.schedulerAbsent, true);
	const qualificationId = requiredSafeToken(record.qualificationId, "cleanup recovery.qualificationId");
	const recoveredAt = requiredTimestamp(record.recoveredAt, "cleanup recovery.recoveredAt");
	const dispatchIntentSha256 = requiredNullableSha256(
		record.dispatchIntentSha256,
		"cleanup recovery.dispatchIntentSha256",
	);
	const rootHandleSha256 = requiredNullableSha256(record.rootHandleSha256, "cleanup recovery.rootHandleSha256");
	const heldVerificationSha256 = requiredNullableSha256(
		record.heldVerificationSha256,
		"cleanup recovery.heldVerificationSha256",
	);
	const rootReleaseIntentSha256 = requiredNullableSha256(
		record.rootReleaseIntentSha256,
		"cleanup recovery.rootReleaseIntentSha256",
	);
	const rootReadySha256 = requiredNullableSha256(record.rootReadySha256, "cleanup recovery.rootReadySha256");
	const recoveryLeaseSha256 = requiredSha256(record.recoveryLeaseSha256, "cleanup recovery.recoveryLeaseSha256");
	const ledger = objectRecord(record.ledgerSnapshot, "cleanup recovery.ledgerSnapshot");
	exactKeys(ledger, ["bytes", "present", "sha256"], "cleanup recovery.ledgerSnapshot");
	assert.equal(typeof ledger.present, "boolean");
	const ledgerSnapshot: CompilerGymJobStepLedgerSnapshot = {
		present: ledger.present as boolean,
		bytes: requiredNonnegativeInteger(ledger.bytes, "cleanup recovery.ledgerSnapshot.bytes"),
		sha256: requiredNullableSha256(ledger.sha256, "cleanup recovery.ledgerSnapshot.sha256"),
	};
	if (ledgerSnapshot.present) {
		assert.notEqual(ledgerSnapshot.sha256, null);
	} else {
		assert.equal(ledgerSnapshot.bytes, 0);
		assert.equal(ledgerSnapshot.sha256, null);
	}
	const discoveredRootIds = requiredRootIdArray(record.discoveredRootIds, "cleanup recovery.discoveredRootIds");
	const cancelledRootIds = requiredRootIdArray(record.cancelledRootIds, "cleanup recovery.cancelledRootIds");
	for (const rootJobId of cancelledRootIds) {
		assert.ok(discoveredRootIds.includes(rootJobId), "Cleanup recovery cancelled an undiscovered root");
	}
	assert.equal(typeof record.budgetInvalid, "boolean");
	const budgetInvalid = record.budgetInvalid as boolean;
	assert.equal(budgetInvalid, discoveredRootIds.length > 1, "Cleanup recovery budget-invalid flag drifted");
	if (!Array.isArray(record.terminalAccounting)) {
		throw new Error("cleanup recovery.terminalAccounting must be an array");
	}
	const terminalAccounting = record.terminalAccounting.map((value, index) => {
		const accounting = objectRecord(value, `cleanup recovery.terminalAccounting[${index}]`);
		exactKeys(
			accounting,
			["endAt", "exitCode", "identityComment", "jobName", "rootJobId", "startAt", "state", "user", "workDir"],
			`cleanup recovery.terminalAccounting[${index}]`,
		);
		const state = normalizeState(requiredString(accounting.state, `terminal accounting[${index}].state`));
		assert.ok(TERMINAL_STATES.has(state), `Terminal accounting state ${state} is not terminal`);
		const exitCode = requiredString(accounting.exitCode, `terminal accounting[${index}].exitCode`);
		if (!/^[0-9]+:[0-9]+$/.test(exitCode)) {
			throw new Error(`terminal accounting[${index}].exitCode is invalid`);
		}
		return {
			rootJobId: requiredRootId(accounting.rootJobId, `terminal accounting[${index}].rootJobId`),
			user: requiredSafeToken(accounting.user, `terminal accounting[${index}].user`),
			jobName: requiredSafeToken(accounting.jobName, `terminal accounting[${index}].jobName`),
			workDir: requiredPath(accounting.workDir, `terminal accounting[${index}].workDir`),
			identityComment: requiredSafeToken(
				accounting.identityComment,
				`terminal accounting[${index}].identityComment`,
			),
			state,
			exitCode,
			startAt: requiredString(accounting.startAt, `terminal accounting[${index}].startAt`),
			endAt: requiredString(accounting.endAt, `terminal accounting[${index}].endAt`),
		};
	});
	assert.deepEqual(
		terminalAccounting.map((accounting) => accounting.rootJobId),
		discoveredRootIds,
		"Cleanup recovery terminal accounting IDs drifted",
	);
	if (terminalAccounting.length > 1) {
		const identity = terminalAccounting[0];
		for (const accounting of terminalAccounting.slice(1)) {
			assert.equal(accounting.user, identity?.user, "Cleanup recovery accounting user drifted");
			assert.equal(accounting.jobName, identity?.jobName, "Cleanup recovery accounting job name drifted");
			assert.equal(accounting.workDir, identity?.workDir, "Cleanup recovery accounting work directory drifted");
			assert.equal(
				accounting.identityComment,
				identity?.identityComment,
				"Cleanup recovery accounting comment drifted",
			);
		}
	}
	if (!Array.isArray(record.commands)) throw new Error("cleanup recovery.commands must be an array");
	const commands = record.commands.map((value, index) => {
		const command = objectRecord(value, `cleanup recovery.commands[${index}]`);
		exactKeys(
			command,
			[
				"capturedAt",
				"exitCode",
				"label",
				"remoteArgv",
				"sequence",
				"stderr",
				"stderrSha256",
				"stdout",
				"stdoutSha256",
				"wallMs",
			],
			`cleanup recovery.commands[${index}]`,
		);
		assert.equal(command.sequence, index, "Cleanup recovery command sequence drifted");
		const remoteArgv = requiredStringArray(command.remoteArgv, `cleanup recovery.commands[${index}].remoteArgv`);
		if (remoteArgv.length === 0) throw new Error("Cleanup recovery command argv is empty");
		const expectedLabel = recoveryCommandLabel(remoteArgv as [string, ...string[]]);
		const stdout = requiredStringOrEmpty(command.stdout, `cleanup recovery.commands[${index}].stdout`);
		const stderr = requiredStringOrEmpty(command.stderr, `cleanup recovery.commands[${index}].stderr`);
		if (remoteArgv[0] === "/usr/bin/scontrol" && remoteArgv[1] === "write") {
			assert.equal(stderr, "", "Cleanup recovery batch-script evidence contains stderr");
		}
		assert.equal(requiredSha256(command.stdoutSha256, `cleanup command[${index}].stdoutSha256`), sha256Text(stdout));
		assert.equal(requiredSha256(command.stderrSha256, `cleanup command[${index}].stderrSha256`), sha256Text(stderr));
		assert.equal(command.exitCode, 0, `Cleanup recovery command ${index} did not succeed`);
		if (typeof command.wallMs !== "number" || !Number.isFinite(command.wallMs) || command.wallMs < 0) {
			throw new Error(`cleanup command[${index}].wallMs is invalid`);
		}
		const label = requiredSafeToken(command.label, `cleanup recovery.commands[${index}].label`);
		assert.equal(label, expectedLabel, `Cleanup recovery command ${index} label drifted`);
		return {
			sequence: index,
			label,
			remoteArgv,
			exitCode: 0,
			stdout,
			stderr,
			stdoutSha256: sha256Text(stdout),
			stderrSha256: sha256Text(stderr),
			wallMs: command.wallMs,
			capturedAt: requiredTimestamp(command.capturedAt, `cleanup recovery.commands[${index}].capturedAt`),
		};
	});
	for (const command of commands) {
		const [executable, operation, subcommand] = command.remoteArgv;
		let targetedRootId: string | undefined;
		if (executable === "/usr/bin/squeue" && operation === "--noheader" && subcommand === "--jobs") {
			targetedRootId = command.remoteArgv[3];
		} else if (executable === "/usr/bin/sacct" && command.remoteArgv[3] === "--jobs") {
			targetedRootId = command.remoteArgv[4];
		} else if (executable === "/usr/bin/scontrol" && operation === "--oneliner") {
			targetedRootId = command.remoteArgv[4];
		} else if (executable === "/usr/bin/scontrol" && operation === "write") {
			targetedRootId = command.remoteArgv[3];
		} else if (executable === "/usr/bin/scancel") {
			targetedRootId = command.remoteArgv[2];
		}
		if (targetedRootId !== undefined) {
			assert.ok(
				discoveredRootIds.includes(requiredRootId(targetedRootId, "cleanup command root ID")),
				"Cleanup recovery command targeted an undiscovered root",
			);
		}
	}
	if (record.status === "no-dispatch-intent") {
		assert.equal(dispatchIntentSha256, null);
		assert.equal(rootHandleSha256, null);
		assert.equal(heldVerificationSha256, null);
		assert.equal(rootReleaseIntentSha256, null);
		assert.equal(rootReadySha256, null);
		assert.deepEqual(discoveredRootIds, []);
		assert.deepEqual(cancelledRootIds, []);
		assert.deepEqual(terminalAccounting, []);
		assert.deepEqual(commands, []);
	} else {
		assert.notEqual(dispatchIntentSha256, null);
		if (rootHandleSha256 !== null) {
			assert.ok(discoveredRootIds.length > 0, "Completed cleanup recovery omitted its durable root handle");
		}
		if (heldVerificationSha256 !== null) assert.notEqual(rootHandleSha256, null);
		if (rootReleaseIntentSha256 !== null) assert.notEqual(heldVerificationSha256, null);
		if (rootReadySha256 !== null) assert.notEqual(rootReleaseIntentSha256, null);
		assert.ok(commands.length > 0, "Completed cleanup recovery has no command evidence");
		assert.deepEqual(
			commands.slice(-2).map((command) => command.label),
			["recovery-squeue-identity", "recovery-sacct-identity"],
			"Completed cleanup recovery lacks final scheduler-identity evidence",
		);
		assert.equal(commands.at(-2)?.stdout.trim(), "", "Completed cleanup recovery left a root scheduler-active");
		const terminalEvidenceSequences = new Set<number>();
		for (const accounting of terminalAccounting) {
			const expectedArgv = [
				"/usr/bin/sacct",
				"--noheader",
				"-X",
				"--jobs",
				accounting.rootJobId,
				"--format=JobIDRaw,User,JobName,WorkDir,Comment,State,ExitCode,Start,End",
				"--parsable2",
			];
			const evidence = commands
				.slice(0, -2)
				.filter((command) => command.label === "recovery-sacct-root")
				.filter(
					(command) =>
						command.remoteArgv.length === expectedArgv.length &&
						command.remoteArgv.every((value, index) => value === expectedArgv[index]),
				)
				.at(-1);
			assert.ok(evidence, `Completed cleanup recovery lacks terminal sacct evidence for ${accounting.rootJobId}`);
			assert.ok(
				!terminalEvidenceSequences.has(evidence.sequence),
				`Completed cleanup recovery reused terminal sacct evidence for ${accounting.rootJobId}`,
			);
			terminalEvidenceSequences.add(evidence.sequence);
			assert.deepEqual(
				parseRecoveryAccountingEvidence(evidence.stdout, accounting.rootJobId),
				accounting,
				`Completed cleanup recovery terminal accounting evidence drifted for ${accounting.rootJobId}`,
			);
		}
		const cancelCommands = commands
			.filter((command) => command.remoteArgv[0] === "/usr/bin/scancel")
			.map((command) => requiredRootId(command.remoteArgv[2], "cleanup scancel root ID"))
			.sort(compareIntegerStrings);
		assert.deepEqual(cancelCommands, cancelledRootIds, "Cleanup recovery scancel evidence drifted");
	}
	return {
		protocol: COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_PROTOCOL,
		status: record.status,
		qualificationId,
		recoveredAt,
		cleanupOnly: true,
		dispatchIntentSha256,
		rootHandleSha256,
		heldVerificationSha256,
		rootReleaseIntentSha256,
		rootReadySha256,
		recoveryLeaseSha256,
		ledgerSnapshot,
		discoveredRootIds,
		cancelledRootIds,
		terminalAccounting,
		budgetInvalid,
		schedulerAbsent: true,
		commands,
	};
}

function normalizeState(value: string): string {
	return value.trim().toUpperCase().split(/[ +]/, 1)[0] ?? "";
}

function splitParsableLine(line: string): string[] {
	const fields = line.split("|");
	if (fields.at(-1) === "") fields.pop();
	return fields;
}

function parseRecoveryAccountingEvidence(
	stdout: string,
	rootJobId: string,
): CompilerGymJobStepRecoveryAccountingRecord | undefined {
	const rows = stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const fields = splitParsableLine(line);
			assert.equal(fields.length, 9, "Recovery accounting field count drifted");
			return fields;
		});
	if (rows.length === 0) return undefined;
	const exactRows = rows.filter((fields) => fields[0] === rootJobId);
	assert.equal(exactRows.length, 1, `Expected one accounting root row for ${rootJobId}`);
	const fields = exactRows[0];
	assert.ok(fields, `Missing accounting root row for ${rootJobId}`);
	const exitCode = requiredString(fields[6], "accounting exit code");
	if (!/^[0-9]+:[0-9]+$/.test(exitCode)) throw new Error("accounting exit code is invalid");
	return {
		rootJobId: requiredRootId(fields[0], "accounting root ID"),
		user: requiredSafeToken(fields[1], "accounting user"),
		jobName: requiredSafeToken(fields[2], "accounting job name"),
		workDir: requiredPath(fields[3], "accounting work directory"),
		identityComment: requiredSafeToken(fields[4], "accounting identity comment"),
		state: normalizeState(requiredString(fields[5], "accounting state")),
		exitCode,
		startAt: requiredString(fields[7], "accounting start"),
		endAt: requiredString(fields[8], "accounting end"),
	};
}

function parseScontrol(stdout: string): Map<string, string> {
	const fields = new Map<string, string>();
	for (const token of stdout.trim().split(/\s+/)) {
		const delimiter = token.indexOf("=");
		if (delimiter > 0) fields.set(token.slice(0, delimiter), token.slice(delimiter + 1));
	}
	return fields;
}

function inventoryKey(inventory: Inventory): string {
	return canonicalJson(
		toJsonValue(
			[...inventory.exact.values()]
				.sort((left, right) => compareIntegerStrings(left.rootJobId, right.rootJobId))
				.map((row) => ({ rootJobId: row.rootJobId, source: row.source, state: row.state })),
		),
	);
}

function assertControlRecordLinks(input: CompilerGymJobStepCleanupRecoveryInput): void {
	const intent = input.dispatchIntent;
	if (!intent) {
		assert.equal(input.dispatchIntentSha256, null);
		assert.equal(input.rootHandle, null);
		assert.equal(input.rootHandleSha256, null);
		assert.equal(input.heldVerification, null);
		assert.equal(input.heldVerificationSha256, null);
		assert.equal(input.rootReleaseIntentSha256, null);
		assert.equal(input.rootReadySha256, null);
		return;
	}
	const intentSha256 = requiredSha256(input.dispatchIntentSha256, "dispatch intent file hash");
	assert.equal(intent.qualificationId, input.qualificationId);
	const handle = input.rootHandle;
	if (!handle) {
		assert.equal(input.rootHandleSha256, null);
		assert.equal(input.heldVerification, null);
		assert.equal(input.heldVerificationSha256, null);
		assert.equal(input.rootReleaseIntentSha256, null);
		assert.equal(input.rootReadySha256, null);
		return;
	}
	const handleSha256 = requiredSha256(input.rootHandleSha256, "root handle file hash");
	assert.equal(handle.qualificationId, intent.qualificationId);
	assert.equal(handle.qualificationProtocol, intent.qualificationProtocol);
	assert.equal(handle.jobName, intent.jobName);
	assert.equal(handle.workDir, intent.workDir);
	assert.equal(handle.dispatchIntentSha256, intentSha256);
	const held = input.heldVerification;
	if (!held) {
		assert.equal(input.heldVerificationSha256, null);
		assert.equal(input.rootReleaseIntentSha256, null);
		assert.equal(input.rootReadySha256, null);
		return;
	}
	requiredSha256(input.heldVerificationSha256, "held verification file hash");
	assert.equal(held.qualificationId, intent.qualificationId);
	assert.equal(held.qualificationProtocol, intent.qualificationProtocol);
	assert.equal(held.rootJobId, handle.rootJobId);
	assert.equal(held.jobName, intent.jobName);
	assert.equal(held.workDir, intent.workDir);
	assert.equal(held.identityComment, intent.identityComment);
	assert.equal(held.rootScriptSha256, intent.rootScriptSha256);
	assert.equal(held.spooledScriptSha256, intent.rootScriptSha256);
	assert.equal(held.dispatchIntentSha256, intentSha256);
	assert.equal(held.rootHandleSha256, handleSha256);
	if (input.rootReleaseIntentSha256 !== null) {
		requiredSha256(input.rootReleaseIntentSha256, "root release intent file hash");
	}
	if (input.rootReadySha256 !== null) {
		requiredSha256(input.rootReadySha256, "root ready file hash");
		assert.notEqual(input.rootReleaseIntentSha256, null);
	}
}

export class CompilerGymJobStepCleanupRecovery {
	private readonly commandRunner: CompilerGymWarmCommandRunner;
	private readonly clock: CompilerGymJobStepRecoveryClock;
	private readonly commands: CompilerGymJobStepRecoveryCommandEvidence[] = [];

	constructor(
		private readonly config: CompilerGymJobStepQualificationConfig = DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
		dependencies: CompilerGymJobStepCleanupRecoveryDependencies = {},
	) {
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
		this.clock = dependencies.clock ?? new SystemCompilerGymJobStepRecoveryClock();
		requiredSafeToken(this.config.host, "FarmShare host");
		requiredSafeToken(this.config.user, "FarmShare user");
		if (this.config.dispatchVisibilityGraceMs < INVENTORY_STABILIZATION_MS) {
			throw new Error("Recovery visibility grace must cover five seconds of inventory stabilization");
		}
	}

	commandEvidence(): CompilerGymJobStepRecoveryCommandEvidence[] {
		return structuredClone(this.commands);
	}

	private assertAllowedCommand(remoteArgv: readonly [string, ...string[]]): void {
		recoveryCommandLabel(remoteArgv);
	}

	private async remote(
		label: string,
		remoteArgv: readonly [string, ...string[]],
		signal: AbortSignal,
	): Promise<CompilerGymWarmCommandResult> {
		this.assertAllowedCommand(remoteArgv);
		const result = await this.commandRunner.run({
			argv: compilerGymWarmSshArgv(this.config.host, remoteArgv),
			signal,
			timeoutMs: this.config.commandTimeoutMs,
			maxOutputBytes: MAX_CONTROL_OUTPUT_BYTES,
		});
		this.commands.push({
			sequence: this.commands.length,
			label,
			remoteArgv: [...remoteArgv],
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			stdoutSha256: sha256Text(result.stdout),
			stderrSha256: sha256Text(result.stderr),
			wallMs: result.wallMs,
			capturedAt: this.clock.now().toISOString(),
		});
		return result;
	}

	private async remoteChecked(
		label: string,
		remoteArgv: readonly [string, ...string[]],
		signal: AbortSignal,
	): Promise<CompilerGymWarmCommandResult> {
		const result = await this.remote(label, remoteArgv, signal);
		if (result.exitCode !== 0) throw new Error(`${label} exited ${String(result.exitCode)}: ${result.stderr.trim()}`);
		return result;
	}

	private parseInventoryRows(stdout: string, source: "squeue" | "sacct"): InventoryRow[] {
		const rows: InventoryRow[] = [];
		for (const line of stdout.trim().split("\n").filter(Boolean)) {
			const fields = splitParsableLine(line);
			assert.equal(fields.length, 6, `${source} recovery inventory field count drifted`);
			const row: InventoryRow = {
				rootJobId: requiredRootId(fields[0], `${source} root ID`),
				user: requiredSafeToken(fields[1], `${source} user`),
				jobName: requiredSafeToken(fields[2], `${source} job name`),
				workDir: requiredPath(fields[3], `${source} work directory`),
				identityComment: requiredSafeToken(fields[4], `${source} identity comment`),
				state: normalizeState(requiredString(fields[5], `${source} state`)),
				source,
			};
			rows.push(row);
		}
		return rows;
	}

	private async inventory(intent: CompilerGymJobStepDispatchIntentRecord, signal: AbortSignal): Promise<Inventory> {
		const queue = await this.remoteChecked(
			"recovery-squeue-identity",
			[
				"/usr/bin/squeue",
				"--noheader",
				"--user",
				this.config.user,
				"--name",
				intent.jobName,
				"--format=%A|%u|%j|%Z|%k|%T",
			],
			signal,
		);
		const accounting = await this.remoteChecked(
			"recovery-sacct-identity",
			[
				"/usr/bin/sacct",
				"--noheader",
				"-X",
				"--user",
				this.config.user,
				"--name",
				intent.jobName,
				"--starttime",
				"now-1days",
				"--format=JobIDRaw,User,JobName,WorkDir,Comment,State",
				"--parsable2",
			],
			signal,
		);
		const rows = [
			...this.parseInventoryRows(queue.stdout, "squeue"),
			...this.parseInventoryRows(accounting.stdout, "sacct"),
		];
		const exact = new Map<string, InventoryRow>();
		const mismatches: InventoryRow[] = [];
		for (const row of rows) {
			if (
				row.user === this.config.user &&
				row.jobName === intent.jobName &&
				row.workDir === intent.workDir &&
				row.identityComment === intent.identityComment
			) {
				const previous = exact.get(row.rootJobId);
				if (!previous || row.source === "squeue") exact.set(row.rootJobId, row);
			} else {
				mismatches.push(row);
			}
		}
		return { exact, mismatches };
	}

	private async discoverStableInventory(
		intent: CompilerGymJobStepDispatchIntentRecord,
		signal: AbortSignal,
		absoluteDeadlineNs?: bigint,
	): Promise<Inventory> {
		const visibilityDeadlineNs = this.clock.nowNs() + BigInt(this.config.dispatchVisibilityGraceMs) * 1_000_000n;
		const deadlineNs =
			absoluteDeadlineNs === undefined || visibilityDeadlineNs < absoluteDeadlineNs
				? visibilityDeadlineNs
				: absoluteDeadlineNs;
		const stabilizationNs = BigInt(INVENTORY_STABILIZATION_MS) * 1_000_000n;
		let stableKey: string | undefined;
		let stableSinceNs: bigint | undefined;
		while (true) {
			const inventory = await this.inventory(intent, signal);
			if (inventory.mismatches.length > 0) {
				throw new Error(
					`Cleanup recovery found mismatched root identity: ${canonicalJson(toJsonValue(inventory.mismatches))}`,
				);
			}
			const key = inventoryKey(inventory);
			const observedAtNs = this.clock.nowNs();
			if (inventory.exact.size > 0) {
				if (key !== stableKey) {
					stableKey = key;
					stableSinceNs = observedAtNs;
				} else if (stableSinceNs !== undefined && observedAtNs - stableSinceNs >= stabilizationNs) {
					return inventory;
				}
			} else {
				stableKey = undefined;
				stableSinceNs = undefined;
			}
			if (observedAtNs >= deadlineNs) {
				if (inventory.exact.size > 0) {
					throw new Error("Cleanup recovery inventory did not remain stable for five seconds");
				}
				return inventory;
			}
			let sleepMs = Math.min(
				this.config.pollIntervalMs,
				Number((deadlineNs - observedAtNs + 999_999n) / 1_000_000n),
			);
			if (stableSinceNs !== undefined) {
				const stableRemainingNs = stabilizationNs - (observedAtNs - stableSinceNs);
				if (stableRemainingNs > 0n) {
					sleepMs = Math.min(sleepMs, Number((stableRemainingNs + 999_999n) / 1_000_000n));
				}
			}
			await this.clock.sleep(Math.max(1, sleepMs), signal);
		}
	}

	private async verifyActiveRoot(
		rootJobId: string,
		intent: CompilerGymJobStepDispatchIntentRecord,
		signal: AbortSignal,
	): Promise<string> {
		const shown = await this.remoteChecked(
			"recovery-scontrol-root",
			["/usr/bin/scontrol", "--oneliner", "show", "job", requiredRootId(rootJobId, "root job ID")],
			signal,
		);
		const fields = parseScontrol(shown.stdout);
		const field = (name: string): string => {
			const value = fields.get(name);
			if (value === undefined) throw new Error(`Missing scontrol recovery field ${name}`);
			return value;
		};
		assert.equal(field("JobId"), rootJobId);
		assert.ok(field("UserId").startsWith(`${this.config.user}(`));
		assert.equal(field("JobName"), intent.jobName);
		assert.equal(field("WorkDir"), intent.workDir);
		assert.equal(field("Comment"), intent.identityComment);
		assert.equal(field("Partition"), this.config.partition);
		assert.equal(field("NumNodes"), "1");
		assert.equal(field("NumCPUs"), String(ROOT_CPUS));
		assert.equal(field("NumTasks"), String(ROOT_TASKS));
		assert.equal(field("CPUs/Task"), String(CPUS_PER_TASK));
		assert.equal(field("MinMemoryNode"), this.config.memory);
		assert.equal(field("Requeue"), "0");
		assert.equal(field("BatchFlag"), "1");
		assert.equal(field("Features"), this.config.cpuConstraint);
		const state = normalizeState(field("JobState"));
		if (!ACTIVE_STATES.has(state) && !TERMINAL_STATES.has(state)) {
			throw new Error(`Cleanup recovery found unsupported root state ${state}`);
		}
		if (ACTIVE_STATES.has(state)) {
			const spooled = await this.remoteChecked(
				"recovery-scontrol-batch-script",
				["/usr/bin/scontrol", "write", "batch_script", rootJobId, "-"],
				signal,
			);
			assert.equal(spooled.stderr, "", "Cleanup recovery batch-script retrieval emitted stderr");
			assert.equal(
				sha256Text(spooled.stdout),
				intent.rootScriptSha256,
				"Cleanup recovery refused a root with mismatched spooled script",
			);
		}
		return state;
	}

	private parseAccounting(
		stdout: string,
		rootJobId: string,
		intent: CompilerGymJobStepDispatchIntentRecord,
	): CompilerGymJobStepRecoveryAccountingRecord | undefined {
		const accounting = parseRecoveryAccountingEvidence(stdout, rootJobId);
		if (!accounting) return undefined;
		assert.equal(accounting.user, this.config.user);
		assert.equal(accounting.jobName, intent.jobName);
		assert.equal(accounting.workDir, intent.workDir);
		assert.equal(accounting.identityComment, intent.identityComment);
		return accounting;
	}

	private async accounting(
		rootJobId: string,
		intent: CompilerGymJobStepDispatchIntentRecord,
		signal: AbortSignal,
	): Promise<CompilerGymJobStepRecoveryAccountingRecord | undefined> {
		const result = await this.remoteChecked(
			"recovery-sacct-root",
			[
				"/usr/bin/sacct",
				"--noheader",
				"-X",
				"--jobs",
				rootJobId,
				"--format=JobIDRaw,User,JobName,WorkDir,Comment,State,ExitCode,Start,End",
				"--parsable2",
			],
			signal,
		);
		return this.parseAccounting(result.stdout, rootJobId, intent);
	}

	private async rootInQueue(rootJobId: string, signal: AbortSignal): Promise<boolean> {
		const result = await this.remoteChecked(
			"recovery-squeue-root",
			["/usr/bin/squeue", "--noheader", "--jobs", rootJobId, "--format=%A|%T"],
			signal,
		);
		if (!result.stdout.trim()) return false;
		for (const line of result.stdout.trim().split("\n")) {
			const fields = splitParsableLine(line);
			assert.equal(fields.length, 2);
			assert.equal(requiredRootId(fields[0], "queued root ID"), rootJobId);
		}
		return true;
	}

	private async waitForTerminalAccounting(
		rootJobId: string,
		intent: CompilerGymJobStepDispatchIntentRecord,
		deadlineNs: bigint,
		signal: AbortSignal,
	): Promise<CompilerGymJobStepRecoveryAccountingRecord> {
		let previous: string | undefined;
		while (true) {
			const queued = await this.rootInQueue(rootJobId, signal);
			const accounting = await this.accounting(rootJobId, intent, signal);
			if (!queued && accounting && TERMINAL_STATES.has(accounting.state)) {
				const key = canonicalJson(toJsonValue(accounting));
				if (key === previous) return accounting;
				previous = key;
			} else {
				previous = undefined;
			}
			if (this.clock.nowNs() >= deadlineNs) {
				throw new Error(`Cleanup recovery timed out accounting for root ${rootJobId}`);
			}
			await this.clock.sleep(this.config.pollIntervalMs, signal);
		}
	}

	private async verifyAndCancelRoots(
		rootJobIds: readonly string[],
		inventory: Inventory,
		intent: CompilerGymJobStepDispatchIntentRecord,
		cancelledRootIds: string[],
		signal: AbortSignal,
	): Promise<void> {
		const activeRootIds: string[] = [];
		for (const rootJobId of rootJobIds) {
			const row = inventory.exact.get(rootJobId);
			if (row?.source === "sacct" && TERMINAL_STATES.has(row.state)) {
				const accounting = await this.accounting(rootJobId, intent, signal);
				if (!accounting || !TERMINAL_STATES.has(accounting.state)) {
					throw new Error(`Terminal recovery inventory for ${rootJobId} lacked terminal accounting`);
				}
				continue;
			}
			const state = await this.verifyActiveRoot(rootJobId, intent, signal);
			if (TERMINAL_STATES.has(state)) {
				const accounting = await this.accounting(rootJobId, intent, signal);
				if (!accounting || !TERMINAL_STATES.has(accounting.state)) {
					throw new Error(`Terminal root ${rootJobId} lacked terminal accounting`);
				}
				continue;
			}
			activeRootIds.push(rootJobId);
		}
		for (const rootJobId of activeRootIds) {
			await this.remoteChecked("recovery-scancel-root", ["/usr/bin/scancel", "--full", rootJobId], signal);
			cancelledRootIds.push(rootJobId);
		}
	}

	async recover(
		input: CompilerGymJobStepCleanupRecoveryInput,
		signal: AbortSignal,
	): Promise<CompilerGymJobStepCleanupRecoveryRecord> {
		assertControlRecordLinks(input);
		if (!input.dispatchIntent) {
			return compilerGymJobStepNoIntentRecovery({
				qualificationId: input.qualificationId,
				ledgerSnapshot: input.ledgerSnapshot,
				recoveredAt: this.clock.now().toISOString(),
				recoveryLeaseSha256: input.recoveryLeaseSha256,
			});
		}
		const intent = input.dispatchIntent;
		const inventory = await this.discoverStableInventory(intent, signal);
		const discoveredRootIds = new Set(inventory.exact.keys());
		if (input.rootHandle) discoveredRootIds.add(input.rootHandle.rootJobId);
		let budgetInvalid = discoveredRootIds.size > 1;
		const cancelledRootIds: string[] = [];
		await this.verifyAndCancelRoots(
			[...discoveredRootIds].sort(compareIntegerStrings),
			inventory,
			intent,
			cancelledRootIds,
			signal,
		);

		const deadlineNs = this.clock.nowNs() + BigInt(this.config.cleanupTimeoutMs) * 1_000_000n;
		const terminalAccounting = new Map<string, CompilerGymJobStepRecoveryAccountingRecord>();
		for (const rootJobId of [...discoveredRootIds].sort(compareIntegerStrings)) {
			terminalAccounting.set(rootJobId, await this.waitForTerminalAccounting(rootJobId, intent, deadlineNs, signal));
		}
		if (discoveredRootIds.size > 0) {
			while (true) {
				const finalInventory = await this.discoverStableInventory(intent, signal, deadlineNs);
				const newRootIds = [...finalInventory.exact.keys()]
					.filter((rootJobId) => !discoveredRootIds.has(rootJobId))
					.sort(compareIntegerStrings);
				if (newRootIds.length > 0) {
					await this.verifyAndCancelRoots(newRootIds, finalInventory, intent, cancelledRootIds, signal);
					for (const rootJobId of newRootIds) discoveredRootIds.add(rootJobId);
					budgetInvalid = discoveredRootIds.size > 1;
					for (const rootJobId of newRootIds) {
						terminalAccounting.set(
							rootJobId,
							await this.waitForTerminalAccounting(rootJobId, intent, deadlineNs, signal),
						);
					}
					continue;
				}
				const finalRootIds = [...finalInventory.exact.keys()].sort(compareIntegerStrings);
				const expectedRootIds = [...discoveredRootIds].sort(compareIntegerStrings);
				assert.deepEqual(finalRootIds, expectedRootIds, "Cleanup recovery final root identity inventory drifted");
				for (const rootJobId of finalRootIds) {
					const row = finalInventory.exact.get(rootJobId);
					assert.ok(row, `Cleanup recovery lost final root ${rootJobId}`);
					assert.equal(row.source, "sacct", `Cleanup recovery root ${rootJobId} remains scheduler-active`);
					assert.ok(TERMINAL_STATES.has(row.state), `Cleanup recovery root ${rootJobId} is not terminal`);
				}
				break;
			}
		}
		const sortedDiscoveredRootIds = [...discoveredRootIds].sort(compareIntegerStrings);
		const sortedCancelledRootIds = [...cancelledRootIds].sort(compareIntegerStrings);
		const sortedTerminalAccounting = sortedDiscoveredRootIds.map((rootJobId) => {
			const accounting = terminalAccounting.get(rootJobId);
			assert.ok(accounting, `Cleanup recovery lacks terminal accounting for ${rootJobId}`);
			return accounting;
		});
		return {
			protocol: COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_PROTOCOL,
			status: "cleanup-complete",
			qualificationId: input.qualificationId,
			recoveredAt: this.clock.now().toISOString(),
			cleanupOnly: true,
			dispatchIntentSha256: input.dispatchIntentSha256,
			rootHandleSha256: input.rootHandleSha256,
			heldVerificationSha256: input.heldVerificationSha256,
			rootReleaseIntentSha256: input.rootReleaseIntentSha256,
			rootReadySha256: input.rootReadySha256,
			recoveryLeaseSha256: input.recoveryLeaseSha256,
			ledgerSnapshot: input.ledgerSnapshot,
			discoveredRootIds: sortedDiscoveredRootIds,
			cancelledRootIds: sortedCancelledRootIds,
			terminalAccounting: sortedTerminalAccounting,
			budgetInvalid,
			schedulerAbsent: true,
			commands: this.commandEvidence(),
		};
	}
}

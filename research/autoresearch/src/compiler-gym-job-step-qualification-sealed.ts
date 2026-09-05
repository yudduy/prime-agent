import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, readFile, readlink, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "./compiler-gym-adapter.js";
import {
	COMPILER_GYM_JOB_STEP_C1_FIXTURE,
	COMPILER_GYM_JOB_STEP_C1_TASKS,
} from "./compiler-gym-job-step-c1-fixture.js";
import {
	COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL,
	COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL,
	COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL,
	COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL,
	COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL,
	COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL,
	COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL,
	type CompilerGymJobStepClaimOwnerRecord,
	CompilerGymJobStepCleanupRecovery,
	type CompilerGymJobStepCleanupRecoveryDependencies,
	type CompilerGymJobStepCleanupRecoveryInput,
	type CompilerGymJobStepCleanupRecoveryLeaseRecord,
	type CompilerGymJobStepDispatchIntentRecord,
	type CompilerGymJobStepHeldVerificationRecord,
	type CompilerGymJobStepLedgerSnapshot,
	type CompilerGymJobStepRootHandleRecord,
	type CompilerGymJobStepRootReadyRecord,
	type CompilerGymJobStepRootReleaseIntentRecord,
	parseCompilerGymJobStepClaimOwnerRecord,
	parseCompilerGymJobStepCleanupRecoveryLeaseRecord,
	parseCompilerGymJobStepCleanupRecoveryRecord,
	parseCompilerGymJobStepDispatchIntentRecord,
	parseCompilerGymJobStepHeldVerificationRecord,
	parseCompilerGymJobStepRootHandleRecord,
	parseCompilerGymJobStepRootReadyRecord,
	parseCompilerGymJobStepRootReleaseIntentRecord,
} from "./compiler-gym-job-step-cleanup-recovery.js";
import {
	analyzeCompilerGymJobStepQualification,
	COMPILER_GYM_JOB_STEP_ACQUISITION_REFERENCE_NS,
	COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS,
	COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS,
	COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
	COMPILER_GYM_JOB_STEP_REFERENCE_OVERHEAD_CEILING_NS,
	type CompilerGymJobStepQualificationConfig,
	CompilerGymJobStepQualificationFailure,
	type CompilerGymJobStepQualificationFailureEvidence,
	CompilerGymJobStepQualificationRunner,
	compilerGymJobStepQualificationConfigSha256,
	compilerGymJobStepRootScript,
	DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
} from "./compiler-gym-job-step-qualification.js";
import { buildCompilerGymJobStepSourceBootstrap } from "./compiler-gym-job-step-source-bootstrap.js";
import { compilerGymWarmSshArgv, SpawnCompilerGymWarmCommandRunner } from "./compiler-gym-warm-farmshare-backend.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_PREREGISTRATION_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/compiler-gym-job-step-qualification/preregistration-v2.json",
);
const DEFAULT_RUNTIME_MANIFEST_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v2.json",
);
const V1_PREREGISTRATION_PATH = ".autoresearch/compiler-gym-job-step-qualification/preregistration-v1.json" as const;
const V1_RUNTIME_MANIFEST_PATH = ".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v1.json" as const;
const V1_SUPERSESSION_PATH =
	".autoresearch/compiler-gym-job-step-qualification/execution-v1-supersession.json" as const;
const V2_PREREGISTRATION_PATH = ".autoresearch/compiler-gym-job-step-qualification/preregistration-v2.json" as const;
const V2_RUNTIME_MANIFEST_PATH = ".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v2.json" as const;
const V1_PREREGISTRATION_SHA256 = "32a396f1396d49bbd99b0448940356f13499fdd3ce5416ebbf862b56ea4cf0ff" as const;
const V1_RUNTIME_MANIFEST_SHA256 = "ef299b05f24dd612854f1d8813e9173ab907c66b09c2998fd5be96b911e4b071" as const;
const V1_SEALED_RUNNER_SHA256 = "66218c01bd9aa9748b580926ec310ccb51f0c44c554bad5d13928cc6a6b1325c" as const;
const V1_OUTPUT_PATH = ".autoresearch/compiler-gym-job-step-qualification/execution-v1" as const;
const V1_QUALIFICATION_ID = "compiler-gym-job-step-c1-execution-v1" as const;
const HISTORICAL_RESULT_PATH = ".autoresearch/stock-interface-transport-pair/execution-v1/result.json" as const;
const HISTORICAL_EXECUTION_MANIFEST_PATH =
	".autoresearch/stock-interface-transport-pair/execution-v1/execution-manifest.json" as const;
const EXPECTED_OUTPUT_PATH = ".autoresearch/compiler-gym-job-step-qualification/execution-v2" as const;
const EXPECTED_QUALIFICATION_ID = "compiler-gym-job-step-c1-execution-v2" as const;
const EXPECTED_PRIME_COMMIT = "bc0fa7606abb3b7af0f765319518d255e6ae553d" as const;
const PREREGISTRATION_PROTOCOL = "compiler-gym-job-step-c1-preregistration-v2" as const;
const RUNTIME_MANIFEST_PROTOCOL = "compiler-gym-job-step-c1-runtime-manifest-v2" as const;
const EXECUTION_PROTOCOL = "compiler-gym-job-step-c1-execution-v2" as const;
const SUPERSESSION_PROTOCOL = "compiler-gym-job-step-c1-execution-supersession-v1" as const;
const SEAL_VERIFICATION_PROTOCOL = "compiler-gym-job-step-c1-seal-verification-v2" as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUN_OWNER_FILE = "run-owner.json" as const;
const DISPATCH_INTENT_FILE = "dispatch-intent.json" as const;
const ROOT_HANDLE_FILE = "root-handle.json" as const;
const HELD_VERIFICATION_FILE = "held-verification.json" as const;
const ROOT_RELEASE_INTENT_FILE = "root-release-intent.json" as const;
const ROOT_READY_FILE = "root-ready.json" as const;
const CLEANUP_RECOVERY_FAILURE_FILE = "cleanup-recovery-failure.json" as const;
const CLEANUP_RECOVERY_LEASE_PREFIX = "cleanup-recovery-lease-" as const;
const CLEANUP_RECOVERY_LEASE_PATTERN = /^cleanup-recovery-lease-([1-9][0-9]*)\.json$/;
const CLEANUP_RECOVERY_RESULT_PREFIX = "cleanup-recovery-result-" as const;
const CLEANUP_RECOVERY_RESULT_PATTERN = /^cleanup-recovery-result-([1-9][0-9]*)\.json$/;
const CLEANUP_RECOVERY_TRANSITION_PREFIX = "cleanup-recovery-transition-" as const;
const CLEANUP_RECOVERY_TRANSITION_PATTERN = /^cleanup-recovery-transition-([1-9][0-9]*)\.json$/;
const CLEANUP_RECOVERY_TRANSITION_PROTOCOL = "compiler-gym-job-step-cleanup-recovery-transition-v1" as const;
const FAILURE_EVIDENCE_FILE = "failure-evidence.json" as const;
const FAILURE_FILE = "failure.json" as const;

export const COMPILER_GYM_JOB_STEP_RUNTIME_PATHS = [
	V1_SUPERSESSION_PATH,
	V1_PREREGISTRATION_PATH,
	V1_RUNTIME_MANIFEST_PATH,
	HISTORICAL_EXECUTION_MANIFEST_PATH,
	HISTORICAL_RESULT_PATH,
	"package-lock.json",
	"package.json",
	"research/autoresearch/environments/compiler-gym-farmshare-v2.requirements.txt",
	"research/autoresearch/environments/compiler-gym-site-data-v2.lock",
	"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_job_step_worker.py",
	"research/autoresearch/farmshare/compiler-gym-cbench-ld-library-path.patch",
	"research/autoresearch/farmshare/compiler-gym-environment.lock",
	"research/autoresearch/package.json",
	"research/autoresearch/src/canonical-json.ts",
	"research/autoresearch/src/compiler-gym-adapter.ts",
	"research/autoresearch/src/compiler-gym-job-step-c1-fixture.ts",
	"research/autoresearch/src/compiler-gym-job-step-cleanup-recovery.ts",
	"research/autoresearch/src/compiler-gym-job-step-qualification-sealed.ts",
	"research/autoresearch/src/compiler-gym-job-step-qualification.ts",
	"research/autoresearch/src/compiler-gym-job-step-source-bootstrap.ts",
	"research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
	"research/autoresearch/src/compiler-gym-warm-transport.ts",
	"research/autoresearch/src/ledger.ts",
	"research/autoresearch/src/types.ts",
	"research/autoresearch/tsconfig.json",
] as const;

export interface SealedCompilerGymJobStepQualification {
	preregistrationPath: string;
	preregistrationSha256: string;
	runtimeManifestPath: string;
	runtimeManifestSha256: string;
	outputDir: string;
	qualificationId: string;
	workerSha256: string;
	envProbeSha256: string;
}

export type CompilerGymJobStepSealedCommand = "dispatch" | "recover" | "verify-seal";

export function parseCompilerGymJobStepSealedCommand(args: readonly string[]): CompilerGymJobStepSealedCommand {
	if (args.length !== 1) {
		throw new Error("Usage: compiler-gym-job-step-qualification-sealed.ts (--verify-seal | --dispatch | --recover)");
	}
	switch (args[0]) {
		case "--verify-seal":
			return "verify-seal";
		case "--dispatch":
			return "dispatch";
		case "--recover":
			return "recover";
		default:
			throw new Error(
				"Usage: compiler-gym-job-step-qualification-sealed.ts (--verify-seal | --dispatch | --recover)",
			);
	}
}

interface PreflightObservation {
	label: string;
	remoteArgv: string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	wallMs: number;
	stdoutSha256: string;
	stderrSha256: string;
}

export interface DispatchPreflight {
	protocol: "compiler-gym-job-step-c1-dispatch-preflight-v1";
	capturedAt: string;
	pass: true;
	observations: PreflightObservation[];
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys mismatch`);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function requiredSha256(value: unknown, label: string): string {
	const digest = requiredString(value, label);
	if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256`);
	return digest;
}

function requiredTimestamp(value: unknown, label: string): string {
	const timestamp = requiredString(value, label);
	assert.equal(new Date(timestamp).toISOString(), timestamp, `${label} must be an ISO timestamp`);
	return timestamp;
}

function requireCanonicalJsonLine(contents: string, value: unknown, label: string): void {
	assert.equal(contents, `${canonicalJson(toJsonValue(value))}\n`, `${label} is not one canonical JSON line`);
}

interface CompilerGymJobStepV1SupersessionRecord {
	protocol: typeof SUPERSESSION_PROTOCOL;
	schemaVersion: 1;
	status: "superseded-before-dispatch";
	recordedAt: string;
	reason: "runtime-integrity-semantics-expanded-before-first-dispatch";
	decisionRuleChanged: false;
	evidence: {
		dispatchEvidencePresent: false;
		executionOutputPath: typeof V1_OUTPUT_PATH;
		executionOutputPresent: false;
		runtimeManifestMissingPaths: [
			"research/autoresearch/src/compiler-gym-job-step-cleanup-recovery.ts",
			"research/autoresearch/src/compiler-gym-job-step-source-bootstrap.ts",
		];
		v1RunnerExpectedSha256: typeof V1_SEALED_RUNNER_SHA256;
		v1RunnerObservedSha256: string;
	};
	successor: {
		executionOutputPath: typeof EXPECTED_OUTPUT_PATH;
		preregistrationPath: typeof V2_PREREGISTRATION_PATH;
		protocol: typeof EXECUTION_PROTOCOL;
		qualificationId: typeof EXPECTED_QUALIFICATION_ID;
		runtimeManifestPath: typeof V2_RUNTIME_MANIFEST_PATH;
	};
	superseded: {
		executionOutputPath: typeof V1_OUTPUT_PATH;
		preregistrationPath: typeof V1_PREREGISTRATION_PATH;
		preregistrationSha256: typeof V1_PREREGISTRATION_SHA256;
		protocol: "compiler-gym-job-step-c1-execution-v1";
		qualificationId: typeof V1_QUALIFICATION_ID;
		runtimeManifestPath: typeof V1_RUNTIME_MANIFEST_PATH;
		runtimeManifestSha256: typeof V1_RUNTIME_MANIFEST_SHA256;
	};
}

function parseCompilerGymJobStepV1Supersession(contents: string): CompilerGymJobStepV1SupersessionRecord {
	const record = objectRecord(JSON.parse(contents) as unknown, "v1 supersession");
	requireCanonicalJsonLine(contents, record, "V1 supersession");
	exactKeys(
		record,
		[
			"decisionRuleChanged",
			"evidence",
			"protocol",
			"reason",
			"recordedAt",
			"schemaVersion",
			"status",
			"successor",
			"superseded",
		],
		"v1 supersession",
	);
	assert.equal(record.protocol, SUPERSESSION_PROTOCOL);
	assert.equal(record.schemaVersion, 1);
	assert.equal(record.status, "superseded-before-dispatch");
	assert.equal(record.reason, "runtime-integrity-semantics-expanded-before-first-dispatch");
	assert.equal(record.decisionRuleChanged, false);
	const evidence = objectRecord(record.evidence, "v1 supersession.evidence");
	exactKeys(
		evidence,
		[
			"dispatchEvidencePresent",
			"executionOutputPath",
			"executionOutputPresent",
			"runtimeManifestMissingPaths",
			"v1RunnerExpectedSha256",
			"v1RunnerObservedSha256",
		],
		"v1 supersession.evidence",
	);
	assert.equal(evidence.dispatchEvidencePresent, false);
	assert.equal(evidence.executionOutputPath, V1_OUTPUT_PATH);
	assert.equal(evidence.executionOutputPresent, false);
	assert.deepEqual(evidence.runtimeManifestMissingPaths, [
		"research/autoresearch/src/compiler-gym-job-step-cleanup-recovery.ts",
		"research/autoresearch/src/compiler-gym-job-step-source-bootstrap.ts",
	]);
	assert.equal(evidence.v1RunnerExpectedSha256, V1_SEALED_RUNNER_SHA256);
	const successor = objectRecord(record.successor, "v1 supersession.successor");
	exactKeys(
		successor,
		["executionOutputPath", "preregistrationPath", "protocol", "qualificationId", "runtimeManifestPath"],
		"v1 supersession.successor",
	);
	assert.deepEqual(successor, {
		executionOutputPath: EXPECTED_OUTPUT_PATH,
		preregistrationPath: V2_PREREGISTRATION_PATH,
		protocol: EXECUTION_PROTOCOL,
		qualificationId: EXPECTED_QUALIFICATION_ID,
		runtimeManifestPath: V2_RUNTIME_MANIFEST_PATH,
	});
	const superseded = objectRecord(record.superseded, "v1 supersession.superseded");
	exactKeys(
		superseded,
		[
			"executionOutputPath",
			"preregistrationPath",
			"preregistrationSha256",
			"protocol",
			"qualificationId",
			"runtimeManifestPath",
			"runtimeManifestSha256",
		],
		"v1 supersession.superseded",
	);
	assert.deepEqual(superseded, {
		executionOutputPath: V1_OUTPUT_PATH,
		preregistrationPath: V1_PREREGISTRATION_PATH,
		preregistrationSha256: V1_PREREGISTRATION_SHA256,
		protocol: "compiler-gym-job-step-c1-execution-v1",
		qualificationId: V1_QUALIFICATION_ID,
		runtimeManifestPath: V1_RUNTIME_MANIFEST_PATH,
		runtimeManifestSha256: V1_RUNTIME_MANIFEST_SHA256,
	});
	return {
		protocol: SUPERSESSION_PROTOCOL,
		schemaVersion: 1,
		status: "superseded-before-dispatch",
		recordedAt: requiredTimestamp(record.recordedAt, "v1 supersession.recordedAt"),
		reason: "runtime-integrity-semantics-expanded-before-first-dispatch",
		decisionRuleChanged: false,
		evidence: {
			dispatchEvidencePresent: false,
			executionOutputPath: V1_OUTPUT_PATH,
			executionOutputPresent: false,
			runtimeManifestMissingPaths: [
				"research/autoresearch/src/compiler-gym-job-step-cleanup-recovery.ts",
				"research/autoresearch/src/compiler-gym-job-step-source-bootstrap.ts",
			],
			v1RunnerExpectedSha256: V1_SEALED_RUNNER_SHA256,
			v1RunnerObservedSha256: requiredSha256(
				evidence.v1RunnerObservedSha256,
				"v1 supersession observed runner hash",
			),
		},
		successor: successor as CompilerGymJobStepV1SupersessionRecord["successor"],
		superseded: superseded as CompilerGymJobStepV1SupersessionRecord["superseded"],
	};
}

function resolveInsideRepository(path: string, label: string): string {
	if (isAbsolute(path)) throw new Error(`${label} must be repository-relative`);
	const resolved = resolve(REPOSITORY_ROOT, path);
	const relativePath = relative(REPOSITORY_ROOT, resolved);
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
		throw new Error(`${label} escapes the repository`);
	}
	return resolved;
}

interface StableRegularFileRead {
	payload: Buffer;
	sha256: string;
}

async function readStableRegularFile(path: string, label: string): Promise<StableRegularFileRead> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = await handle.stat();
		if (!before.isFile()) throw new Error(`${label} is not a regular file`);
		const payload = await handle.readFile();
		const after = await handle.stat();
		assert.equal(after.dev, before.dev, `${label} device changed while reading`);
		assert.equal(after.ino, before.ino, `${label} inode changed while reading`);
		assert.equal(after.size, before.size, `${label} size changed while reading`);
		assert.equal(payload.byteLength, before.size, `${label} bytes changed while reading`);
		assert.equal(after.mtimeMs, before.mtimeMs, `${label} modification time changed while reading`);
		return { payload, sha256: createHash("sha256").update(payload).digest("hex") };
	} finally {
		await handle.close();
	}
}

async function readStableTextFile(path: string, label: string): Promise<StableRegularFileRead & { contents: string }> {
	const stable = await readStableRegularFile(path, label);
	return { ...stable, contents: stable.payload.toString("utf8") };
}

export async function compilerGymJobStepInstalledToolchainTree(): Promise<{ sha256: string; entries: number }> {
	const roots = [
		["tsx", resolve(REPOSITORY_ROOT, "node_modules/tsx")],
		["esbuild", resolve(REPOSITORY_ROOT, "node_modules/esbuild")],
		["esbuild-darwin-arm64", resolve(REPOSITORY_ROOT, "node_modules/@esbuild/darwin-arm64")],
	] as const;
	const rows: string[] = [];
	const walk = async (label: string, root: string, path: string): Promise<void> => {
		const metadata = await lstat(path);
		const relativePath = relative(root, path).split(sep).join("/") || ".";
		const mode = (metadata.mode & 0o7777).toString(8);
		if (metadata.isSymbolicLink()) {
			rows.push(`L\t${label}/${relativePath}\t${mode}\t${await readlink(path)}\n`);
			return;
		}
		if (metadata.isDirectory()) {
			const children = (await readdir(path)).sort();
			for (const child of children) await walk(label, root, join(path, child));
			return;
		}
		if (!metadata.isFile()) throw new Error(`Unsupported installed toolchain entry: ${path}`);
		const payload = await readFile(path);
		const digest = createHash("sha256").update(payload).digest("hex");
		rows.push(`F\t${label}/${relativePath}\t${mode}\t${metadata.size}\t${digest}\n`);
	};
	for (const [label, root] of roots) await walk(label, root, root);
	rows.sort();
	return { sha256: sha256Text(rows.join("")), entries: rows.length };
}

export interface CompilerGymJobStepRuntimeFileEntry {
	bytes: number;
	path: string;
	sha256: string;
}

export interface CompilerGymJobStepRuntimeFileVerificationDependencies {
	readBytes?: (absolutePath: string, repositoryRelativePath: string) => Promise<Buffer>;
}

export async function verifyCompilerGymJobStepRuntimeFiles(
	value: unknown,
	dependencies: CompilerGymJobStepRuntimeFileVerificationDependencies = {},
): Promise<Map<string, StableRegularFileRead>> {
	if (!Array.isArray(value)) throw new Error("Runtime manifest files must be an array");
	const files: CompilerGymJobStepRuntimeFileEntry[] = value.map((entry, index) => {
		const record = objectRecord(entry, `runtime files[${index}]`);
		exactKeys(record, ["bytes", "path", "sha256"], `runtime files[${index}]`);
		if (!Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0) {
			throw new Error(`runtime files[${index}].bytes must be a nonnegative safe integer`);
		}
		return {
			bytes: record.bytes as number,
			path: requiredString(record.path, `runtime files[${index}].path`),
			sha256: requiredSha256(record.sha256, `runtime files[${index}].sha256`),
		};
	});
	assert.deepEqual(
		files.map((file) => file.path),
		[...COMPILER_GYM_JOB_STEP_RUNTIME_PATHS],
		"Runtime manifest file order or membership changed",
	);
	assert.deepEqual(
		files.map((file) => file.path),
		files.map((file) => file.path).sort(),
		"Runtime manifest files are not sorted lexicographically",
	);
	const verified = new Map<string, StableRegularFileRead>();
	for (const file of files) {
		const absolutePath = resolveInsideRepository(file.path, `runtime file ${file.path}`);
		let read: StableRegularFileRead;
		if (dependencies.readBytes) {
			const payload = await dependencies.readBytes(absolutePath, file.path);
			read = { payload, sha256: createHash("sha256").update(payload).digest("hex") };
		} else {
			read = await readStableRegularFile(absolutePath, `runtime file ${file.path}`);
		}
		assert.equal(read.payload.byteLength, file.bytes, `Sealed runtime file byte length drifted: ${file.path}`);
		assert.equal(read.sha256, file.sha256, `Sealed runtime file drifted: ${file.path}`);
		verified.set(file.path, read);
	}
	return verified;
}

function requiredVerifiedRuntimeFile(
	verified: ReadonlyMap<string, StableRegularFileRead>,
	path: string,
): StableRegularFileRead {
	const file = verified.get(path);
	if (!file) throw new Error(`Required verified runtime file is missing: ${path}`);
	return file;
}

function requiredArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function requiredIntegerString(value: unknown, label: string): bigint {
	if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
		throw new Error(`${label} must be a nonnegative integer string`);
	}
	return BigInt(value);
}

function requiredFiniteNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${label} must be a nonnegative finite number`);
	}
	return value;
}

async function verifyHistoricalGateSources(
	verifiedFiles: ReadonlyMap<string, StableRegularFileRead>,
	expectedResultSha256: string,
	expectedExecutionManifestSha256: string,
): Promise<void> {
	const resultContents = requiredVerifiedRuntimeFile(verifiedFiles, HISTORICAL_RESULT_PATH).payload.toString("utf8");
	const executionManifestContents = requiredVerifiedRuntimeFile(
		verifiedFiles,
		HISTORICAL_EXECUTION_MANIFEST_PATH,
	).payload.toString("utf8");
	assert.equal(sha256Text(resultContents), expectedResultSha256, "Historical result hash drifted");
	assert.equal(
		sha256Text(executionManifestContents),
		expectedExecutionManifestSha256,
		"Historical execution-manifest hash drifted",
	);
	const result = objectRecord(JSON.parse(resultContents) as unknown, "historical result");
	const executionManifest = objectRecord(
		JSON.parse(executionManifestContents) as unknown,
		"historical execution manifest",
	);
	assert.equal(executionManifest.resultSha256, expectedResultSha256);
	assert.equal(result.protocol, "compiler-gym-stock-interface-transport-pair-v1");
	assert.equal(sha256Json(COMPILER_GYM_JOB_STEP_C1_FIXTURE.request), COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256);
	assert.equal(
		sha256Text(JSON.stringify(COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions)),
		COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256,
	);
	const arms = requiredArray(result.arms, "historical result.arms").map((value, index) =>
		objectRecord(value, `historical result.arms[${index}]`),
	);
	assert.deepEqual(
		arms.map((arm) => arm.arm),
		["stock-cold-control", "stock-warm-treatment"],
	);
	const callsFor = (arm: Record<string, unknown>): Record<string, unknown>[] =>
		requiredArray(arm.calls, `historical ${String(arm.arm)} calls`).map((value, index) =>
			objectRecord(value, `historical ${String(arm.arm)} calls[${index}]`),
		);
	const coldCalls = callsFor(arms[0]);
	const warmCalls = callsFor(arms[1]);
	assert.equal(coldCalls.length, 4);
	assert.equal(warmCalls.length, 4);
	const coldCallSum = coldCalls.reduce(
		(sum, call, index) => sum + requiredIntegerString(call.durationNs, `cold calls[${index}].durationNs`),
		0n,
	);
	assert.equal(coldCallSum, COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS);
	const historicalAnalysis = objectRecord(result.analysis, "historical result.analysis");
	assert.equal(
		requiredIntegerString(historicalAnalysis.coldCallSumNs, "historical analysis.coldCallSumNs"),
		COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS,
	);
	const warmCleanup = objectRecord(arms[1].cleanup, "historical warm cleanup");
	const warmRecordEvidence = objectRecord(warmCleanup.recordEvidence, "historical warm record evidence");
	const warmAcquisition = objectRecord(warmRecordEvidence.acquisition, "historical warm acquisition");
	assert.equal(
		requiredIntegerString(warmAcquisition.durationNs, "historical warm acquisition.durationNs"),
		COMPILER_GYM_JOB_STEP_ACQUISITION_REFERENCE_NS,
	);
	let criticalChildMilliseconds = 0;
	for (const [callIndex, call] of warmCalls.entries()) {
		const envelope = objectRecord(call.envelope, `warm calls[${callIndex}].envelope`);
		const job = objectRecord(envelope.job, `warm calls[${callIndex}].job`);
		const measurement = objectRecord(job.measurement, `warm calls[${callIndex}].measurement`);
		const tasks = requiredArray(measurement.tasks, `warm calls[${callIndex}].tasks`).map((value, taskIndex) =>
			objectRecord(value, `warm calls[${callIndex}].tasks[${taskIndex}]`),
		);
		assert.equal(tasks.length, 2);
		const taskWalls = tasks.map((task, taskIndex) => {
			const metrics = objectRecord(task.metrics, `warm calls[${callIndex}].tasks[${taskIndex}].metrics`);
			return requiredFiniteNumber(
				metrics.evaluatorProcessWallMs,
				`warm calls[${callIndex}].tasks[${taskIndex}].metrics.evaluatorProcessWallMs`,
			);
		});
		criticalChildMilliseconds += Math.max(...taskWalls);
	}
	const conservativeCriticalNs = BigInt(Math.ceil(criticalChildMilliseconds * 1_000_000));
	assert.equal(conservativeCriticalNs, COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS);
	for (const [armIndex, arm] of arms.entries()) {
		const call = callsFor(arm)[0];
		assert.equal(call.candidateId, "C1");
		assert.equal(call.requestSha256, COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256);
		const envelope = objectRecord(call.envelope, `historical C1 envelope arm ${armIndex}`);
		assert.deepEqual(envelope.request, COMPILER_GYM_JOB_STEP_C1_FIXTURE.request);
		const job = objectRecord(envelope.job, `historical C1 job arm ${armIndex}`);
		assert.equal(job.candidateDigest, COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256);
		const measurement = objectRecord(job.measurement, `historical C1 measurement arm ${armIndex}`);
		const tasks = requiredArray(measurement.tasks, `historical C1 tasks arm ${armIndex}`).map((value, index) =>
			objectRecord(value, `historical C1 tasks arm ${armIndex}[${index}]`),
		);
		assert.equal(tasks.length, COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks.length);
		for (const [taskIndex, task] of tasks.entries()) {
			const expected = COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks[taskIndex];
			const metrics = objectRecord(task.metrics, `historical C1 metrics arm ${armIndex}[${taskIndex}]`);
			assert.equal(task.benchmarkId, expected.benchmarkId);
			assert.equal(task.status, "accepted");
			assert.equal(metrics.IrInstructionCount, expected.irInstructionCount);
			assert.equal(metrics.ObjectTextSizeBytes, expected.objectTextSizeBytes);
		}
	}
}

export async function loadSealedCompilerGymJobStepQualification(
	preregistrationPath = DEFAULT_PREREGISTRATION_PATH,
	runtimeManifestPath = DEFAULT_RUNTIME_MANIFEST_PATH,
): Promise<SealedCompilerGymJobStepQualification> {
	const [preregistrationRead, runtimeManifestRead] = await Promise.all([
		readStableTextFile(preregistrationPath, "Preregistration"),
		readStableTextFile(runtimeManifestPath, "Runtime manifest"),
	]);
	const preregistrationContents = preregistrationRead.contents;
	const runtimeManifestContents = runtimeManifestRead.contents;
	const preregistration = objectRecord(JSON.parse(preregistrationContents) as unknown, "preregistration");
	const runtimeManifest = objectRecord(JSON.parse(runtimeManifestContents) as unknown, "runtime manifest");
	requireCanonicalJsonLine(preregistrationContents, preregistration, "Preregistration");
	requireCanonicalJsonLine(runtimeManifestContents, runtimeManifest, "Runtime manifest");
	exactKeys(
		preregistration,
		[
			"budgets",
			"candidate",
			"claim",
			"cleanup",
			"controls",
			"createdAt",
			"execution",
			"gate",
			"pins",
			"protocol",
			"schemaVersion",
			"sources",
			"supersession",
		],
		"preregistration",
	);
	assert.equal(preregistration.schemaVersion, 2);
	assert.equal(preregistration.protocol, PREREGISTRATION_PROTOCOL);
	requiredTimestamp(preregistration.createdAt, "preregistration.createdAt");
	const claim = objectRecord(preregistration.claim, "preregistration.claim");
	exactKeys(claim, ["causalClaimAllowed", "class", "gpuTransferAllowed", "question"], "preregistration.claim");
	assert.equal(claim.class, "noncausal-mechanism-qualification-projection");
	assert.equal(claim.causalClaimAllowed, false);
	assert.equal(claim.gpuTransferAllowed, false);
	assert.equal(
		claim.question,
		"Can one candidate-scoped two-rank Slurm step remove enough control latency to justify a sealed four-candidate CPU screen?",
	);
	const execution = objectRecord(preregistration.execution, "preregistration.execution");
	exactKeys(
		execution,
		[
			"candidateSteps",
			"freshTaskEvaluations",
			"modelCalls",
			"outputDir",
			"qualificationId",
			"replacementRuns",
			"rootAllocations",
		],
		"preregistration.execution",
	);
	assert.equal(execution.outputDir, EXPECTED_OUTPUT_PATH);
	assert.equal(execution.qualificationId, EXPECTED_QUALIFICATION_ID);
	assert.equal(execution.rootAllocations, 1);
	assert.equal(execution.candidateSteps, 1);
	assert.equal(execution.freshTaskEvaluations, 2);
	assert.equal(execution.modelCalls, 0);
	assert.equal(execution.replacementRuns, 0);
	const sources = objectRecord(preregistration.sources, "preregistration.sources");
	exactKeys(sources, ["historicalControl"], "preregistration.sources");
	const historicalControl = objectRecord(sources.historicalControl, "preregistration.sources.historicalControl");
	exactKeys(
		historicalControl,
		["executionManifestPath", "executionManifestSha256", "resultPath", "resultSha256"],
		"preregistration.sources.historicalControl",
	);
	assert.equal(historicalControl.resultPath, HISTORICAL_RESULT_PATH);
	assert.equal(historicalControl.executionManifestPath, HISTORICAL_EXECUTION_MANIFEST_PATH);
	const historicalResultSha256 = requiredSha256(
		historicalControl.resultSha256,
		"preregistration.sources.historicalControl.resultSha256",
	);
	const historicalExecutionManifestSha256 = requiredSha256(
		historicalControl.executionManifestSha256,
		"preregistration.sources.historicalControl.executionManifestSha256",
	);
	const supersession = objectRecord(preregistration.supersession, "preregistration.supersession");
	exactKeys(
		supersession,
		["path", "sha256", "status", "supersededQualificationId", "v1PreregistrationSha256", "v1RuntimeManifestSha256"],
		"preregistration.supersession",
	);
	assert.equal(supersession.path, V1_SUPERSESSION_PATH);
	assert.equal(supersession.status, "superseded-before-dispatch");
	assert.equal(supersession.supersededQualificationId, V1_QUALIFICATION_ID);
	assert.equal(supersession.v1PreregistrationSha256, V1_PREREGISTRATION_SHA256);
	assert.equal(supersession.v1RuntimeManifestSha256, V1_RUNTIME_MANIFEST_SHA256);
	const supersessionSha256 = requiredSha256(supersession.sha256, "preregistration.supersession.sha256");
	const candidate = objectRecord(preregistration.candidate, "preregistration.candidate");
	exactKeys(
		candidate,
		["actions", "actionsSha256", "candidateId", "requestSha256", "tasks"],
		"preregistration.candidate",
	);
	assert.equal(candidate.candidateId, "C1");
	assert.equal(candidate.requestSha256, COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256);
	assert.equal(candidate.actionsSha256, COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256);
	assert.deepEqual(candidate.actions, COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions);
	assert.deepEqual(candidate.tasks, [...COMPILER_GYM_JOB_STEP_C1_TASKS]);
	const budgets = objectRecord(preregistration.budgets, "preregistration.budgets");
	exactKeys(budgets, ["cpuAllocationMinutes", "gpuHours", "providerCalls"], "preregistration.budgets");
	assert.equal(budgets.cpuAllocationMinutes, 5);
	assert.equal(budgets.gpuHours, 0);
	assert.equal(budgets.providerCalls, 0);
	const cleanup = objectRecord(preregistration.cleanup, "preregistration.cleanup");
	exactKeys(
		cleanup,
		["command", "expectedRootState", "inventoryStabilizationMs", "requireSchedulerAbsence", "targetValidation"],
		"preregistration.cleanup",
	);
	assert.equal(cleanup.command, "scancel --full ROOT");
	assert.equal(cleanup.expectedRootState, "CANCELLED");
	assert.equal(cleanup.inventoryStabilizationMs, 5_000);
	assert.equal(cleanup.requireSchedulerAbsence, true);
	assert.equal(cleanup.targetValidation, "exact-user-job-name-work-directory-comment-and-root-id");
	const controls = objectRecord(preregistration.controls, "preregistration.controls");
	exactKeys(controls, ["dispatch", "failure", "recovery", "sourceDelivery", "trust"], "preregistration.controls");
	const dispatchControls = objectRecord(controls.dispatch, "preregistration.controls.dispatch");
	exactKeys(
		dispatchControls,
		["durableOrder", "heldIdentity", "identity", "rootSubmissionAttempts", "rootSubmissionMode"],
		"preregistration.controls.dispatch",
	);
	assert.deepEqual(dispatchControls.durableOrder, [
		"run-owner.json",
		"dispatch-intent.json",
		"sbatch-held-stdin-once",
		"root-handle.json",
		"scontrol-write-batch-script-exact",
		"held-verification.json",
		"root-release-intent.json",
		"scontrol-release-once",
		"root-ready.json",
		"srun-c1-once",
	]);
	const heldIdentity = objectRecord(dispatchControls.heldIdentity, "preregistration.controls.dispatch.heldIdentity");
	exactKeys(heldIdentity, ["batchFlag", "priority", "reason", "state"], "dispatch held identity");
	assert.deepEqual(heldIdentity, { batchFlag: 1, priority: 0, reason: "JobHeldUser", state: "PENDING" });
	assert.equal(dispatchControls.identity, "exact-user-job-name-work-directory-comment-and-root-id");
	assert.equal(dispatchControls.rootSubmissionAttempts, 1);
	assert.equal(dispatchControls.rootSubmissionMode, "held-stdin-spooled");
	const failureControls = objectRecord(controls.failure, "preregistration.controls.failure");
	exactKeys(
		failureControls,
		["postSubmitArtifactRequired", "preflightFailureDisposition", "replacementRuns", "terminalFailureLedgerRequired"],
		"preregistration.controls.failure",
	);
	assert.equal(failureControls.postSubmitArtifactRequired, true);
	assert.equal(failureControls.preflightFailureDisposition, "retryable-pre-dispatch-non-attempt");
	assert.equal(failureControls.replacementRuns, 0);
	assert.equal(failureControls.terminalFailureLedgerRequired, true);
	const recoveryControls = objectRecord(controls.recovery, "preregistration.controls.recovery");
	exactKeys(
		recoveryControls,
		["cleanupOnly", "dispatchForbidden", "lateRootPolicy", "leaseProtocol", "stableInventoryMs"],
		"preregistration.controls.recovery",
	);
	assert.equal(recoveryControls.cleanupOnly, true);
	assert.deepEqual(recoveryControls.dispatchForbidden, ["sbatch", "srun", "scontrol release"]);
	assert.equal(recoveryControls.lateRootPolicy, "verify-cancel-account-and-restabilize");
	assert.equal(recoveryControls.leaseProtocol, COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL);
	assert.equal(recoveryControls.stableInventoryMs, 5_000);
	const sourceDelivery = objectRecord(controls.sourceDelivery, "preregistration.controls.sourceDelivery");
	exactKeys(
		sourceDelivery,
		["evaluator", "remoteExecutablePathsAllowed", "requestFile", "worker"],
		"preregistration.controls.sourceDelivery",
	);
	assert.deepEqual(sourceDelivery, {
		evaluator: "inline-bootstrap",
		remoteExecutablePathsAllowed: false,
		requestFile: "nofollow-immutable-sha256",
		worker: "inline-bootstrap",
	});
	const trust = objectRecord(controls.trust, "preregistration.controls.trust");
	exactKeys(
		trust,
		["localFilesystem", "runtimeClosurePolicy", "staticImportsExecuteBeforeSealVerification"],
		"preregistration.controls.trust",
	);
	assert.deepEqual(trust, {
		localFilesystem: "trusted-local",
		runtimeClosurePolicy: "freeze-until-execution-and-recovery-terminal",
		staticImportsExecuteBeforeSealVerification: true,
	});
	const gate = objectRecord(preregistration.gate, "preregistration.gate");
	exactKeys(
		gate,
		[
			"acquisitionReferenceNs",
			"candidateTimingBoundary",
			"childCriticalConversion",
			"childCriticalReferenceNs",
			"coldReferenceNs",
			"decisionOnFail",
			"decisionOnPass",
			"dynamicIntegerInequality",
			"referenceOverheadCeilingNs",
			"semanticMetrics",
		],
		"preregistration.gate",
	);
	assert.equal(gate.coldReferenceNs, COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS.toString());
	assert.equal(gate.childCriticalReferenceNs, COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS.toString());
	assert.equal(gate.acquisitionReferenceNs, COMPILER_GYM_JOB_STEP_ACQUISITION_REFERENCE_NS.toString());
	assert.equal(gate.referenceOverheadCeilingNs, COMPILER_GYM_JOB_STEP_REFERENCE_OVERHEAD_CEILING_NS.toString());
	assert.equal(gate.dynamicIntegerInequality, "10*A_new + 40*O_C1 + 10*K0 <= 9*C0");
	assert.equal(
		gate.candidateTimingBoundary,
		"candidate publish start through terminal dotted-step accounting and complete active-root step inventory",
	);
	assert.equal(gate.childCriticalConversion, "ceil(1000000 * sum(four warm-call max evaluatorProcessWallMs))");
	assert.equal(gate.decisionOnPass, "qualify-c1-c4-screen");
	assert.equal(gate.decisionOnFail, "kill-job-step-transport");
	assert.deepEqual(gate.semanticMetrics, COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks);
	const pins = objectRecord(preregistration.pins, "preregistration.pins");
	exactKeys(
		pins,
		[
			"cbenchPatchSha256",
			"cleanupRecoverySha256",
			"configSha256",
			"environmentProbeSha256",
			"evaluatorSha256",
			"primeAgentCommit",
			"qualificationRunnerSha256",
			"rootScriptSha256",
			"runtimeManifestSha256",
			"sealedRunnerSha256",
			"sourceBootstrapPythonSha256",
			"sourceBootstrapSha256",
			"verifierEpoch",
			"workerSha256",
		],
		"preregistration.pins",
	);
	assert.equal(pins.primeAgentCommit, EXPECTED_PRIME_COMMIT);
	assert.equal(pins.cbenchPatchSha256, COMPILER_GYM_CBENCH_PATCH_SHA256);
	assert.equal(pins.evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
	assert.equal(pins.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
	assert.equal(pins.configSha256, compilerGymJobStepQualificationConfigSha256());
	assert.equal(pins.rootScriptSha256, sha256Text(compilerGymJobStepRootScript()));
	const workerSha256 = requiredSha256(pins.workerSha256, "pins.workerSha256");
	const sealedRunnerSha256 = requiredSha256(pins.sealedRunnerSha256, "pins.sealedRunnerSha256");
	const cleanupRecoverySha256 = requiredSha256(pins.cleanupRecoverySha256, "pins.cleanupRecoverySha256");
	const environmentProbeSha256 = requiredSha256(pins.environmentProbeSha256, "pins.environmentProbeSha256");
	const qualificationRunnerSha256 = requiredSha256(pins.qualificationRunnerSha256, "pins.qualificationRunnerSha256");
	const sourceBootstrapSha256 = requiredSha256(pins.sourceBootstrapSha256, "pins.sourceBootstrapSha256");
	const sourceBootstrapPythonSha256 = requiredSha256(
		pins.sourceBootstrapPythonSha256,
		"pins.sourceBootstrapPythonSha256",
	);
	const runtimeManifestSha256 = runtimeManifestRead.sha256;
	assert.equal(
		runtimeManifestSha256,
		pins.runtimeManifestSha256,
		"Runtime manifest hash drifted from preregistration",
	);

	exactKeys(runtimeManifest, ["files", "protocol", "schemaVersion", "toolchain"], "runtime manifest");
	assert.equal(runtimeManifest.schemaVersion, 2);
	assert.equal(runtimeManifest.protocol, RUNTIME_MANIFEST_PROTOCOL);
	const toolchain = objectRecord(runtimeManifest.toolchain, "runtime manifest.toolchain");
	exactKeys(
		toolchain,
		[
			"architecture",
			"esbuild",
			"installedToolchainTreeEntries",
			"installedToolchainTreeSha256",
			"node",
			"npm",
			"platform",
			"python",
			"slurm",
			"tsx",
			"tsxIntegrity",
		],
		"runtime manifest.toolchain",
	);
	assert.equal(toolchain.node, process.version);
	assert.equal(toolchain.platform, process.platform);
	assert.equal(toolchain.architecture, process.arch);
	assert.equal(toolchain.python, "3.10.19");
	assert.equal(toolchain.slurm, "26.05.1");
	assert.equal(toolchain.tsx, "4.23.1");
	assert.equal(toolchain.esbuild, "0.28.1");
	assert.equal(
		toolchain.tsxIntegrity,
		"sha512-GQHnkIfxyx1wYCOS/wonik5MVRZU9hi1TEZmzGZSCJB1y9YgoZ8H6itNE/u4suE+yLmOzuE4E5S4TZ/ZX2wcWQ==",
	);
	const verifiedFiles = await verifyCompilerGymJobStepRuntimeFiles(runtimeManifest.files);
	const workerFile = requiredVerifiedRuntimeFile(
		verifiedFiles,
		"research/autoresearch/evaluators/compiler_gym_job_step_worker.py",
	);
	const evaluatorFile = requiredVerifiedRuntimeFile(
		verifiedFiles,
		"research/autoresearch/evaluators/compiler_gym_eval.py",
	);
	const envProbeFile = requiredVerifiedRuntimeFile(
		verifiedFiles,
		"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	);
	assert.equal(workerFile.sha256, workerSha256, "Worker pin and runtime file hash differ");
	assert.equal(evaluatorFile.sha256, COMPILER_GYM_EVALUATOR_SHA256, "Evaluator pin and runtime file hash differ");
	assert.equal(envProbeFile.sha256, environmentProbeSha256, "Environment-probe pin and runtime file hash differ");
	assert.equal(requiredVerifiedRuntimeFile(verifiedFiles, HISTORICAL_RESULT_PATH).sha256, historicalResultSha256);
	assert.equal(
		requiredVerifiedRuntimeFile(verifiedFiles, HISTORICAL_EXECUTION_MANIFEST_PATH).sha256,
		historicalExecutionManifestSha256,
	);
	assert.equal(requiredVerifiedRuntimeFile(verifiedFiles, V1_PREREGISTRATION_PATH).sha256, V1_PREREGISTRATION_SHA256);
	assert.equal(
		requiredVerifiedRuntimeFile(verifiedFiles, V1_RUNTIME_MANIFEST_PATH).sha256,
		V1_RUNTIME_MANIFEST_SHA256,
	);
	assert.equal(requiredVerifiedRuntimeFile(verifiedFiles, V1_SUPERSESSION_PATH).sha256, supersessionSha256);
	assert.equal(
		requiredVerifiedRuntimeFile(
			verifiedFiles,
			"research/autoresearch/farmshare/compiler-gym-cbench-ld-library-path.patch",
		).sha256,
		COMPILER_GYM_CBENCH_PATCH_SHA256,
	);
	assert.equal(
		requiredVerifiedRuntimeFile(verifiedFiles, "research/autoresearch/src/compiler-gym-job-step-cleanup-recovery.ts")
			.sha256,
		cleanupRecoverySha256,
	);
	const sealedRunnerFile = requiredVerifiedRuntimeFile(
		verifiedFiles,
		"research/autoresearch/src/compiler-gym-job-step-qualification-sealed.ts",
	);
	assert.equal(sealedRunnerFile.sha256, sealedRunnerSha256, "Sealed runner source drifted");
	assert.equal(
		requiredVerifiedRuntimeFile(verifiedFiles, "research/autoresearch/src/compiler-gym-job-step-qualification.ts")
			.sha256,
		qualificationRunnerSha256,
	);
	assert.equal(
		requiredVerifiedRuntimeFile(verifiedFiles, "research/autoresearch/src/compiler-gym-job-step-source-bootstrap.ts")
			.sha256,
		sourceBootstrapSha256,
	);
	const sourceBootstrap = buildCompilerGymJobStepSourceBootstrap({
		workerSource: workerFile.payload.toString("utf8"),
		workerSha256,
		evaluatorSource: evaluatorFile.payload.toString("utf8"),
		evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
	});
	assert.equal(sourceBootstrap.pythonSourceSha256, sourceBootstrapPythonSha256);
	const supersessionRecord = parseCompilerGymJobStepV1Supersession(
		requiredVerifiedRuntimeFile(verifiedFiles, V1_SUPERSESSION_PATH).payload.toString("utf8"),
	);
	assert.equal(supersessionRecord.evidence.v1RunnerObservedSha256, sealedRunnerFile.sha256);
	await verifyHistoricalGateSources(verifiedFiles, historicalResultSha256, historicalExecutionManifestSha256);
	const packageLock = objectRecord(
		JSON.parse(requiredVerifiedRuntimeFile(verifiedFiles, "package-lock.json").payload.toString("utf8")) as unknown,
		"package-lock.json",
	);
	const lockPackages = objectRecord(packageLock.packages, "package-lock.json packages");
	const lockedTsx = objectRecord(lockPackages["node_modules/tsx"], "locked tsx package");
	const lockedEsbuild = objectRecord(lockPackages["node_modules/esbuild"], "locked esbuild package");
	assert.equal(lockedTsx.version, toolchain.tsx);
	assert.equal(lockedTsx.integrity, toolchain.tsxIntegrity);
	assert.equal(lockedEsbuild.version, toolchain.esbuild);
	const toolchainTree = await compilerGymJobStepInstalledToolchainTree();
	assert.equal(toolchainTree.sha256, toolchain.installedToolchainTreeSha256);
	assert.equal(toolchainTree.entries, toolchain.installedToolchainTreeEntries);
	const [{ stdout: npmVersion }, { stdout: tsxVersion }] = await Promise.all([
		execFileAsync("npm", ["--version"], { cwd: REPOSITORY_ROOT }),
		execFileAsync(resolve(REPOSITORY_ROOT, "node_modules/.bin/tsx"), ["--version"], { cwd: REPOSITORY_ROOT }),
	]);
	assert.equal(npmVersion.trim(), toolchain.npm);
	assert.deepEqual(tsxVersion.trim().split("\n"), [`tsx v${String(toolchain.tsx)}`, `node ${process.version}`]);

	const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT });
	assert.equal(stdout.trim(), EXPECTED_PRIME_COMMIT, "Prime Agent commit drifted from preregistration");
	return {
		preregistrationPath,
		preregistrationSha256: preregistrationRead.sha256,
		runtimeManifestPath,
		runtimeManifestSha256,
		outputDir: resolveInsideRepository(requiredString(execution.outputDir, "execution.outputDir"), "outputDir"),
		qualificationId: requiredString(execution.qualificationId, "execution.qualificationId"),
		workerSha256,
		envProbeSha256: environmentProbeSha256,
	};
}

export interface DurableExclusiveJsonWrite {
	contents: string;
	sha256: string;
}

async function fsyncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function writeDurableExclusiveJson(path: string, value: unknown): Promise<DurableExclusiveJsonWrite> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const expectedBytes = Buffer.from(contents, "utf8");
	const expectedSha256 = createHash("sha256").update(expectedBytes).digest("hex");
	const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	const handle = await open(temporaryPath, "wx", 0o600);
	let finalHandle: Awaited<ReturnType<typeof open>> | undefined;
	let finalLinked = false;
	try {
		await handle.writeFile(expectedBytes);
		await handle.chmod(0o400);
		await handle.sync();
		await link(temporaryPath, path);
		finalLinked = true;
		finalHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const [sourceMetadata, finalMetadata] = await Promise.all([handle.stat(), finalHandle.stat()]);
		assert.ok(sourceMetadata.isFile() && finalMetadata.isFile(), "Durable control is not a regular file");
		assert.equal(finalMetadata.dev, sourceMetadata.dev, "Durable control device changed during publication");
		assert.equal(finalMetadata.ino, sourceMetadata.ino, "Durable control inode changed during publication");
		assert.equal(finalMetadata.mode & 0o777, 0o400, "Durable control mode is not read-only");
		assert.equal(finalMetadata.size, expectedBytes.byteLength, "Durable control size changed during publication");
		const publishedBytes = await finalHandle.readFile();
		assert.ok(publishedBytes.equals(expectedBytes), "Durable control bytes changed during publication");
		assert.equal(
			createHash("sha256").update(publishedBytes).digest("hex"),
			expectedSha256,
			"Durable control hash changed during publication",
		);
		await fsyncDirectory(directory);
		await unlink(temporaryPath);
		await fsyncDirectory(directory);
	} catch (error) {
		try {
			await unlink(temporaryPath);
		} catch (cleanupError) {
			if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
				throw new AggregateError([error, cleanupError], `Failed to publish durable control record ${path}`);
			}
		}
		if (finalLinked) await fsyncDirectory(directory);
		throw error;
	} finally {
		await finalHandle?.close();
		await handle.close();
	}
	return { contents, sha256: expectedSha256 };
}

export interface ClaimedCompilerGymJobStepOutput {
	owner: CompilerGymJobStepClaimOwnerRecord;
	ownerSha256: string;
}

export async function claimSealedCompilerGymJobStepOutput(input: {
	path: string;
	qualificationId: string;
	hostname: string;
	pid: number;
	startedAt: string;
}): Promise<ClaimedCompilerGymJobStepOutput> {
	const parent = dirname(input.path);
	await mkdir(parent, { recursive: true, mode: 0o700 });
	await fsyncDirectory(parent);
	try {
		await mkdir(input.path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(`Sealed qualification output is already claimed: ${input.path}`, { cause: error });
		}
		throw error;
	}
	await fsyncDirectory(parent);
	const owner: CompilerGymJobStepClaimOwnerRecord = {
		protocol: COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL,
		qualificationId: input.qualificationId,
		outputDir: input.path,
		hostname: input.hostname,
		pid: input.pid,
		startedAt: input.startedAt,
	};
	const ownerWrite = await writeDurableExclusiveJson(join(input.path, RUN_OWNER_FILE), owner);
	return { owner, ownerSha256: ownerWrite.sha256 };
}

export function assertCompilerGymJobStepClaimOwnerInactive(
	owner: CompilerGymJobStepClaimOwnerRecord,
	options: {
		currentHostname?: string;
		isProcessAlive?: (pid: number) => boolean;
	} = {},
): void {
	const currentHostname = options.currentHostname ?? hostname();
	if (owner.hostname !== currentHostname) {
		throw new Error(
			`Cleanup recovery cannot establish owner liveness across hosts: ${owner.hostname} != ${currentHostname}`,
		);
	}
	const isProcessAlive =
		options.isProcessAlive ??
		((pid: number): boolean => {
			try {
				process.kill(pid, 0);
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
				if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
				throw error;
			}
		});
	if (isProcessAlive(owner.pid)) {
		throw new Error(`Cleanup recovery refused while owner PID ${owner.pid} is alive on ${owner.hostname}`);
	}
}

export async function captureCompilerGymJobStepLedgerSnapshot(path: string): Promise<CompilerGymJobStepLedgerSnapshot> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false, bytes: 0, sha256: null };
		throw error;
	}
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error("Evidence ledger is not a regular file");
		if ((metadata.mode & 0o077) !== 0) throw new Error("Evidence ledger permissions are not private");
		const contents = await handle.readFile();
		const afterRead = await handle.stat();
		assert.equal(afterRead.dev, metadata.dev, "Evidence ledger device changed while reading");
		assert.equal(afterRead.ino, metadata.ino, "Evidence ledger inode changed while reading");
		assert.equal(afterRead.size, contents.byteLength, "Evidence ledger changed while reading");
		return {
			present: true,
			bytes: contents.byteLength,
			sha256: createHash("sha256").update(contents).digest("hex"),
		};
	} finally {
		await handle.close();
	}
}

export function createCompilerGymJobStepTerminationController(): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const interrupt = (): void => controller.abort(new Error("Sealed qualification interrupted by SIGINT"));
	const terminate = (): void => controller.abort(new Error("Sealed qualification interrupted by SIGTERM"));
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", terminate);
	return {
		signal: controller.signal,
		dispose() {
			process.removeListener("SIGINT", interrupt);
			process.removeListener("SIGTERM", terminate);
		},
	};
}

export async function readVerifiedCompilerGymJobStepEnvProbeSource(
	path: string,
	expectedSha256: string,
): Promise<string> {
	const source = await readStableTextFile(path, "Environment probe source");
	assert.equal(
		source.sha256,
		requiredSha256(expectedSha256, "sealed environment-probe hash"),
		"Environment probe drifted after runtime-manifest verification",
	);
	return source.contents;
}

export function assertCompilerGymJobStepDispatchCapabilities(input: {
	srun: string;
	sbatch: string;
	scontrol: string;
}): void {
	for (const capability of ["--jobid", "--exact", "--kill-on-bad-exit", "--label", "--export"]) {
		assert.ok(input.srun.includes(capability), `FarmShare srun lacks ${capability}`);
	}
	for (const capability of ["--deadline", "--no-requeue", "--hold", "--comment"]) {
		assert.ok(input.sbatch.includes(capability), `FarmShare sbatch lacks ${capability}`);
	}
	assert.ok(input.scontrol.includes("write batch_script"), "FarmShare scontrol lacks write batch_script");
}

async function captureDispatchPreflight(
	signal: AbortSignal,
	expectedEnvProbeSha256: string,
): Promise<DispatchPreflight> {
	const runner = new SpawnCompilerGymWarmCommandRunner();
	const config = DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG;
	const probePath = fileURLToPath(new URL("../evaluators/compiler_gym_env_probe.py", import.meta.url));
	const probeSource = await readVerifiedCompilerGymJobStepEnvProbeSource(probePath, expectedEnvProbeSha256);
	const probeEncoded = Buffer.from(probeSource, "utf8").toString("base64");
	const probeCommand =
		`import base64;source=base64.b64decode("${probeEncoded}");` +
		'exec(compile(source,"compiler_gym_env_probe.py","exec"))';
	const commands: Array<{ label: string; remoteArgv: [string, ...string[]] }> = [
		{ label: "identity", remoteArgv: ["/usr/bin/id", "-un"] },
		{
			label: "user-queue",
			remoteArgv: ["/usr/bin/squeue", "--noheader", "--user", config.user, "--format=%A|%T|%P|%j|%R"],
		},
		{ label: "srun-version", remoteArgv: ["/usr/bin/srun", "--version"] },
		{ label: "sacct-version", remoteArgv: ["/usr/bin/sacct", "--version"] },
		{ label: "scontrol-version", remoteArgv: ["/usr/bin/scontrol", "--version"] },
		{
			label: "srun-capabilities",
			remoteArgv: [
				"/bin/sh",
				"-c",
				"/usr/bin/srun --help | /usr/bin/grep -E -- '--jobid|--exact|--kill-on-bad-exit|--label|--export'",
			],
		},
		{
			label: "sbatch-capabilities",
			remoteArgv: [
				"/bin/sh",
				"-c",
				"/usr/bin/sbatch --help | /usr/bin/grep -E -- '--deadline|--no-requeue|--hold|--comment'",
			],
		},
		{
			label: "scontrol-capabilities",
			remoteArgv: ["/bin/sh", "-c", "/usr/bin/scontrol --help | /usr/bin/grep -F -- 'write batch_script'"],
		},
		{
			label: "environment-seal",
			remoteArgv: [
				"/usr/bin/env",
				"-i",
				"PATH=/usr/bin:/bin",
				"LANG=C.UTF-8",
				`LD_LIBRARY_PATH=${config.compatibilityLibraryDir}`,
				`COMPILER_GYM_CACHE=${config.compilerGymCache}`,
				`COMPILER_GYM_SITE_DATA=${config.compilerGymSiteData}`,
				"PYTHONWARNINGS=ignore::FutureWarning",
				config.pythonPath,
				"-c",
				probeCommand,
			],
		},
	];
	const observations: PreflightObservation[] = [];
	for (const command of commands) {
		const result = await runner.run({
			argv: compilerGymWarmSshArgv(config.host, command.remoteArgv),
			signal,
			timeoutMs: 30_000,
			maxOutputBytes: 1024 * 1024,
		});
		const observation = {
			label: command.label,
			remoteArgv: [...command.remoteArgv],
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			wallMs: result.wallMs,
			stdoutSha256: sha256Text(result.stdout),
			stderrSha256: sha256Text(result.stderr),
		};
		observations.push(observation);
		if (result.exitCode !== 0)
			throw new Error(`Dispatch preflight ${command.label} exited ${String(result.exitCode)}`);
		if (result.stderr.trim()) throw new Error(`Dispatch preflight ${command.label} emitted stderr`);
	}
	assert.equal(observations[0]?.stdout.trim(), config.user, "FarmShare identity drifted");
	assert.equal(observations[1]?.stdout.trim(), "", "FarmShare user queue was not empty before dispatch");
	for (const index of [2, 3, 4]) assert.equal(observations[index]?.stdout.trim(), "slurm 26.05.1");
	assertCompilerGymJobStepDispatchCapabilities({
		srun: observations[5]?.stdout ?? "",
		sbatch: observations[6]?.stdout ?? "",
		scontrol: observations[7]?.stdout ?? "",
	});
	const environmentSeal = objectRecord(
		JSON.parse(observations[8]?.stdout.trim() ?? "") as unknown,
		"remote environment seal",
	);
	assert.equal(environmentSeal.protocol, "compiler-gym-farmshare-environment-probe-v1");
	assert.equal(environmentSeal.pass, true);
	return {
		protocol: "compiler-gym-job-step-c1-dispatch-preflight-v1",
		capturedAt: new Date().toISOString(),
		pass: true,
		observations,
	};
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writeDurableExclusiveJson(path, value);
}

function errorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

interface DurableControlRead<T> {
	record: T;
	contents: string;
	sha256: string;
}

async function readOptionalDurableControl<T>(
	path: string,
	parse: (contents: string) => T,
): Promise<DurableControlRead<T> | null> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error(`Durable control is not a file: ${path}`);
		if ((metadata.mode & 0o777) !== 0o400) throw new Error(`Durable control mode is not 0400: ${path}`);
		if (metadata.size > 1024 * 1024) throw new Error(`Durable control is too large: ${path}`);
		const bytes = await handle.readFile();
		const afterRead = await handle.stat();
		assert.equal(afterRead.dev, metadata.dev, `Durable control device changed while reading: ${path}`);
		assert.equal(afterRead.ino, metadata.ino, `Durable control inode changed while reading: ${path}`);
		assert.equal(afterRead.size, bytes.byteLength, `Durable control changed while reading: ${path}`);
		const contents = bytes.toString("utf8");
		return {
			record: parse(contents),
			contents,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	} finally {
		await handle.close();
	}
}

async function readRequiredDurableControl<T>(
	path: string,
	parse: (contents: string) => T,
): Promise<DurableControlRead<T>> {
	const value = await readOptionalDurableControl(path, parse);
	if (!value) throw new Error(`Required durable control is missing: ${path}`);
	return value;
}

export interface CompilerGymJobStepRecoveryLeaseDependencies {
	currentHostname?: string;
	isProcessAlive?: (pid: number) => boolean;
	afterActiveLeaseObserved?: (lease: CompilerGymJobStepCleanupRecoveryLeaseRecord) => Promise<void>;
}

interface CompilerGymJobStepCompletedRecovery {
	lease: DurableControlRead<CompilerGymJobStepCleanupRecoveryLeaseRecord>;
	result: DurableControlRead<ReturnType<typeof parseCompilerGymJobStepCleanupRecoveryRecord>>;
}

interface CompilerGymJobStepRecoveryTransitionRecord {
	protocol: typeof CLEANUP_RECOVERY_TRANSITION_PROTOCOL;
	qualificationId: string;
	outputDir: string;
	generation: string;
	leaseSha256: string;
	disposition: "complete" | "stale";
	resultSha256: string | null;
	recordedAt: string;
}

interface CompilerGymJobStepRecoveryGeneration {
	generation: bigint;
	lease: DurableControlRead<CompilerGymJobStepCleanupRecoveryLeaseRecord>;
	transition: DurableControlRead<CompilerGymJobStepRecoveryTransitionRecord> | null;
	result: DurableControlRead<ReturnType<typeof parseCompilerGymJobStepCleanupRecoveryRecord>> | null;
}

function parseCompilerGymJobStepRecoveryTransitionRecord(contents: string): CompilerGymJobStepRecoveryTransitionRecord {
	const parsed = objectRecord(JSON.parse(contents) as unknown, "cleanup recovery transition");
	requireCanonicalJsonLine(contents, parsed, "cleanup recovery transition");
	exactKeys(
		parsed,
		[
			"disposition",
			"generation",
			"leaseSha256",
			"outputDir",
			"protocol",
			"qualificationId",
			"recordedAt",
			"resultSha256",
		],
		"cleanup recovery transition",
	);
	assert.equal(parsed.protocol, CLEANUP_RECOVERY_TRANSITION_PROTOCOL);
	const generation = requiredString(parsed.generation, "cleanup recovery transition generation");
	assert.ok(/^[1-9][0-9]*$/.test(generation), "Cleanup recovery transition generation is invalid");
	const disposition = requiredString(parsed.disposition, "cleanup recovery transition disposition");
	assert.ok(
		disposition === "complete" || disposition === "stale",
		"Cleanup recovery transition disposition is invalid",
	);
	const resultSha256 =
		parsed.resultSha256 === null ? null : requiredSha256(parsed.resultSha256, "transition result hash");
	assert.equal(
		resultSha256 !== null,
		disposition === "complete",
		"Only a completed recovery transition may bind a result",
	);
	const recordedAt = requiredString(parsed.recordedAt, "cleanup recovery transition timestamp");
	assert.equal(new Date(recordedAt).toISOString(), recordedAt, "Cleanup recovery transition timestamp is invalid");
	return {
		protocol: CLEANUP_RECOVERY_TRANSITION_PROTOCOL,
		qualificationId: requiredString(parsed.qualificationId, "cleanup recovery transition qualification ID"),
		outputDir: requiredString(parsed.outputDir, "cleanup recovery transition output directory"),
		generation,
		leaseSha256: requiredSha256(parsed.leaseSha256, "cleanup recovery transition lease hash"),
		disposition,
		resultSha256,
		recordedAt,
	};
}

function assertCleanupRecoveryLeaseBinding(
	control: DurableControlRead<CompilerGymJobStepCleanupRecoveryLeaseRecord>,
	input: { outputDir: string; qualificationId: string; originalOwnerSha256: string },
): void {
	assert.equal(control.record.qualificationId, input.qualificationId);
	assert.equal(control.record.outputDir, input.outputDir);
	assert.equal(control.record.originalOwnerSha256, input.originalOwnerSha256);
}

async function readCompilerGymJobStepRecoveryGenerations(input: {
	outputDir: string;
	qualificationId: string;
	originalOwnerSha256: string;
}): Promise<CompilerGymJobStepRecoveryGeneration[]> {
	const names = await readdir(input.outputDir);
	const leaseEntries = names
		.filter((name) => name.startsWith(CLEANUP_RECOVERY_LEASE_PREFIX))
		.map((name) => {
			const match = CLEANUP_RECOVERY_LEASE_PATTERN.exec(name);
			if (!match?.[1]) throw new Error(`Malformed cleanup recovery lease filename: ${name}`);
			return { generation: BigInt(match[1]), generationText: match[1], name };
		});
	leaseEntries.sort((left, right) =>
		left.generation < right.generation ? -1 : left.generation > right.generation ? 1 : 0,
	);
	const transitionGenerations = new Set(
		names
			.filter((name) => name.startsWith(CLEANUP_RECOVERY_TRANSITION_PREFIX))
			.map((name) => {
				const match = CLEANUP_RECOVERY_TRANSITION_PATTERN.exec(name);
				if (!match?.[1]) throw new Error(`Malformed cleanup recovery transition filename: ${name}`);
				return match[1];
			}),
	);
	const resultGenerations = new Set(
		names
			.filter((name) => name.startsWith(CLEANUP_RECOVERY_RESULT_PREFIX))
			.map((name) => {
				const match = CLEANUP_RECOVERY_RESULT_PATTERN.exec(name);
				if (!match?.[1]) throw new Error(`Malformed cleanup recovery result filename: ${name}`);
				return match[1];
			}),
	);
	const leaseGenerationTexts = new Set(leaseEntries.map((entry) => entry.generationText));
	for (const generation of transitionGenerations) {
		assert.ok(leaseGenerationTexts.has(generation), `Cleanup recovery transition ${generation} lacks its lease`);
	}
	for (const generation of resultGenerations) {
		assert.ok(leaseGenerationTexts.has(generation), `Cleanup recovery result ${generation} lacks its lease`);
	}
	const generations: CompilerGymJobStepRecoveryGeneration[] = [];
	for (const [index, entry] of leaseEntries.entries()) {
		const expectedGeneration = BigInt(index + 1).toString();
		assert.equal(entry.generationText, expectedGeneration, "Cleanup recovery lease chain is not contiguous");
		const lease = await readRequiredDurableControl(
			join(input.outputDir, entry.name),
			parseCompilerGymJobStepCleanupRecoveryLeaseRecord,
		);
		assert.equal(lease.record.generation, entry.generationText);
		assertCleanupRecoveryLeaseBinding(lease, input);
		const transition = transitionGenerations.has(entry.generationText)
			? await readRequiredDurableControl(
					join(input.outputDir, `${CLEANUP_RECOVERY_TRANSITION_PREFIX}${entry.generationText}.json`),
					parseCompilerGymJobStepRecoveryTransitionRecord,
				)
			: null;
		if (transition) {
			assert.equal(transition.record.qualificationId, input.qualificationId);
			assert.equal(transition.record.outputDir, input.outputDir);
			assert.equal(transition.record.generation, entry.generationText);
			assert.equal(transition.record.leaseSha256, lease.sha256);
		}
		const result = resultGenerations.has(entry.generationText)
			? await readRequiredDurableControl(
					join(input.outputDir, `${CLEANUP_RECOVERY_RESULT_PREFIX}${entry.generationText}.json`),
					parseCompilerGymJobStepCleanupRecoveryRecord,
				)
			: null;
		if (transition?.record.disposition === "complete") {
			assert.ok(result, `Completed cleanup recovery generation ${entry.generationText} lacks its result`);
			assert.equal(transition.record.resultSha256, result.sha256);
			assert.equal(result.record.recoveryLeaseSha256, lease.sha256);
		}
		generations.push({ generation: entry.generation, lease, transition, result });
	}
	for (const [index, generation] of generations.entries()) {
		if (index === generations.length - 1) continue;
		assert.ok(
			generation.transition,
			`Cleanup recovery lease ${generation.lease.record.generation} has a successor without a transition`,
		);
		assert.notEqual(
			generation.transition.record.disposition,
			"complete",
			"A completed cleanup recovery transition has a successor lease",
		);
	}
	return generations;
}

async function readCompletedCompilerGymJobStepCleanupRecovery(input: {
	outputDir: string;
	qualificationId: string;
	originalOwnerSha256: string;
}): Promise<CompilerGymJobStepCompletedRecovery | null> {
	const generations = await readCompilerGymJobStepRecoveryGenerations(input);
	const completed = generations.find((generation) => generation.transition?.record.disposition === "complete");
	if (!completed) return null;
	assert.equal(completed, generations.at(-1), "Completed cleanup recovery is not terminal in its lease chain");
	assert.ok(completed.result, "Completed cleanup recovery lacks its result");
	return { lease: completed.lease, result: completed.result };
}

async function writeCompilerGymJobStepRecoveryTransition(
	outputDir: string,
	record: CompilerGymJobStepRecoveryTransitionRecord,
): Promise<DurableControlRead<CompilerGymJobStepRecoveryTransitionRecord>> {
	const write = await writeDurableExclusiveJson(
		join(outputDir, `${CLEANUP_RECOVERY_TRANSITION_PREFIX}${record.generation}.json`),
		record,
	);
	return { record, contents: write.contents, sha256: write.sha256 };
}

async function acquireCompilerGymJobStepCleanupRecoveryLease(input: {
	outputDir: string;
	qualificationId: string;
	originalOwnerSha256: string;
	dependencies?: CompilerGymJobStepRecoveryLeaseDependencies;
}): Promise<DurableControlRead<CompilerGymJobStepCleanupRecoveryLeaseRecord> | null> {
	while (true) {
		const generations = await readCompilerGymJobStepRecoveryGenerations(input);
		if (generations.some((generation) => generation.transition?.record.disposition === "complete")) return null;
		const active = generations.at(-1);
		if (active && !active.transition) {
			await input.dependencies?.afterActiveLeaseObserved?.(active.lease.record);
			assertCompilerGymJobStepClaimOwnerInactive(
				{
					protocol: COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL,
					qualificationId: active.lease.record.qualificationId,
					outputDir: active.lease.record.outputDir,
					hostname: active.lease.record.hostname,
					pid: active.lease.record.pid,
					startedAt: active.lease.record.acquiredAt,
				},
				input.dependencies,
			);
			try {
				await writeCompilerGymJobStepRecoveryTransition(input.outputDir, {
					protocol: CLEANUP_RECOVERY_TRANSITION_PROTOCOL,
					qualificationId: input.qualificationId,
					outputDir: input.outputDir,
					generation: active.lease.record.generation,
					leaseSha256: active.lease.sha256,
					disposition: "stale",
					resultSha256: null,
					recordedAt: new Date().toISOString(),
				});
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			continue;
		}
		const generation = BigInt(generations.length + 1).toString();
		const record: CompilerGymJobStepCleanupRecoveryLeaseRecord = {
			protocol: COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL,
			qualificationId: input.qualificationId,
			outputDir: input.outputDir,
			generation,
			hostname: hostname(),
			pid: process.pid,
			acquiredAt: new Date().toISOString(),
			originalOwnerSha256: input.originalOwnerSha256,
		};
		try {
			const write = await writeDurableExclusiveJson(
				join(input.outputDir, `${CLEANUP_RECOVERY_LEASE_PREFIX}${generation}.json`),
				record,
			);
			const verified = await readCompilerGymJobStepRecoveryGenerations(input);
			const acquired = verified.at(-1);
			assert.ok(acquired, "Published cleanup recovery lease is missing");
			assert.equal(acquired.lease.record.generation, generation);
			assert.equal(acquired.lease.sha256, write.sha256);
			assert.equal(acquired.transition, null, "New cleanup recovery lease was transitioned before use");
			return { record, contents: write.contents, sha256: write.sha256 };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}

async function publishCompletedCompilerGymJobStepCleanupRecovery(input: {
	outputDir: string;
	lease: DurableControlRead<CompilerGymJobStepCleanupRecoveryLeaseRecord>;
	result: ReturnType<typeof parseCompilerGymJobStepCleanupRecoveryRecord>;
}): Promise<void> {
	assert.equal(input.result.recoveryLeaseSha256, input.lease.sha256);
	const resultPath = join(input.outputDir, `${CLEANUP_RECOVERY_RESULT_PREFIX}${input.lease.record.generation}.json`);
	const resultWrite = await writeDurableExclusiveJson(resultPath, input.result);
	try {
		await writeCompilerGymJobStepRecoveryTransition(input.outputDir, {
			protocol: CLEANUP_RECOVERY_TRANSITION_PROTOCOL,
			qualificationId: input.lease.record.qualificationId,
			outputDir: input.outputDir,
			generation: input.lease.record.generation,
			leaseSha256: input.lease.sha256,
			disposition: "complete",
			resultSha256: resultWrite.sha256,
			recordedAt: new Date().toISOString(),
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const generations = await readCompilerGymJobStepRecoveryGenerations({
			outputDir: input.outputDir,
			qualificationId: input.lease.record.qualificationId,
			originalOwnerSha256: input.lease.record.originalOwnerSha256,
		});
		const generation = generations.find((value) => value.lease.sha256 === input.lease.sha256);
		assert.equal(
			generation?.transition?.record.disposition,
			"complete",
			"Cleanup recovery completion lost its transition arbitration",
		);
		assert.equal(generation.transition.record.resultSha256, resultWrite.sha256);
	}
}

async function validateClaimedOutputDirectory(path: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const metadata = await handle.stat();
		if (!metadata.isDirectory()) {
			throw new Error(`Sealed qualification output is not a claimed directory: ${path}`);
		}
		if ((metadata.mode & 0o077) !== 0) throw new Error(`Sealed qualification output is not private: ${path}`);
	} finally {
		await handle.close();
	}
}

export async function runCleanupRecovery(
	sealed: SealedCompilerGymJobStepQualification,
	options: {
		writeOutput?: (contents: string) => void;
		recoveryDependencies?: CompilerGymJobStepCleanupRecoveryDependencies;
		recoveryConfig?: CompilerGymJobStepQualificationConfig;
		recoveryLeaseDependencies?: CompilerGymJobStepRecoveryLeaseDependencies;
	} = {},
): Promise<void> {
	await validateClaimedOutputDirectory(sealed.outputDir);
	const recoveryConfig = options.recoveryConfig ?? DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG;
	const ownerPath = join(sealed.outputDir, RUN_OWNER_FILE);
	let ownerControl = await readOptionalDurableControl(ownerPath, parseCompilerGymJobStepClaimOwnerRecord);
	let recoveryClaimedMissingOwner = false;
	if (!ownerControl) {
		const recoveryOwner: CompilerGymJobStepClaimOwnerRecord = {
			protocol: COMPILER_GYM_JOB_STEP_CLAIM_OWNER_PROTOCOL,
			qualificationId: sealed.qualificationId,
			outputDir: sealed.outputDir,
			hostname: hostname(),
			pid: process.pid,
			startedAt: new Date().toISOString(),
		};
		try {
			const write = await writeDurableExclusiveJson(ownerPath, recoveryOwner);
			ownerControl = { record: recoveryOwner, contents: write.contents, sha256: write.sha256 };
			recoveryClaimedMissingOwner = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			ownerControl = await readRequiredDurableControl(ownerPath, parseCompilerGymJobStepClaimOwnerRecord);
		}
	}
	assert.equal(ownerControl.record.qualificationId, sealed.qualificationId);
	assert.equal(ownerControl.record.outputDir, sealed.outputDir);

	const ledgerSnapshot = await captureCompilerGymJobStepLedgerSnapshot(join(sealed.outputDir, "evidence.jsonl"));
	const intentControl = await readOptionalDurableControl(
		join(sealed.outputDir, DISPATCH_INTENT_FILE),
		parseCompilerGymJobStepDispatchIntentRecord,
	);
	const handleControl = await readOptionalDurableControl(
		join(sealed.outputDir, ROOT_HANDLE_FILE),
		parseCompilerGymJobStepRootHandleRecord,
	);
	const heldControl = await readOptionalDurableControl(
		join(sealed.outputDir, HELD_VERIFICATION_FILE),
		parseCompilerGymJobStepHeldVerificationRecord,
	);
	const releaseControl = await readOptionalDurableControl(
		join(sealed.outputDir, ROOT_RELEASE_INTENT_FILE),
		parseCompilerGymJobStepRootReleaseIntentRecord,
	);
	const readyControl = await readOptionalDurableControl(
		join(sealed.outputDir, ROOT_READY_FILE),
		parseCompilerGymJobStepRootReadyRecord,
	);
	if (
		recoveryClaimedMissingOwner &&
		(intentControl || handleControl || heldControl || releaseControl || readyControl)
	) {
		throw new Error("A pre-owner crash claim contains a durable remote-dispatch control");
	}
	if (!intentControl && (handleControl || heldControl || releaseControl || readyControl)) {
		throw new Error("A later durable control exists without dispatch-intent.json");
	}
	if (!handleControl && (heldControl || releaseControl || readyControl)) {
		throw new Error("A later durable control exists without root-handle.json");
	}
	if (!heldControl && (releaseControl || readyControl)) {
		throw new Error("A post-verification control exists without held-verification.json");
	}
	if (!releaseControl && readyControl) {
		throw new Error("root-ready.json exists without root-release-intent.json");
	}
	if (intentControl) {
		assert.equal(intentControl.record.claimOwnerSha256, ownerControl.sha256);
		assert.equal(intentControl.record.qualificationId, sealed.qualificationId);
	}
	if (intentControl && handleControl) {
		assert.equal(handleControl.record.qualificationProtocol, intentControl.record.qualificationProtocol);
		assert.equal(handleControl.record.qualificationId, intentControl.record.qualificationId);
		assert.equal(handleControl.record.jobName, intentControl.record.jobName);
		assert.equal(handleControl.record.workDir, intentControl.record.workDir);
		assert.equal(handleControl.record.dispatchIntentSha256, intentControl.sha256);
	}
	if (intentControl && handleControl && heldControl) {
		assert.equal(heldControl.record.qualificationProtocol, intentControl.record.qualificationProtocol);
		assert.equal(heldControl.record.qualificationId, intentControl.record.qualificationId);
		assert.equal(heldControl.record.rootJobId, handleControl.record.rootJobId);
		assert.equal(heldControl.record.jobName, intentControl.record.jobName);
		assert.equal(heldControl.record.workDir, intentControl.record.workDir);
		assert.equal(heldControl.record.identityComment, intentControl.record.identityComment);
		assert.equal(heldControl.record.rootScriptSha256, intentControl.record.rootScriptSha256);
		assert.equal(heldControl.record.spooledScriptSha256, intentControl.record.rootScriptSha256);
		assert.equal(heldControl.record.dispatchIntentSha256, intentControl.sha256);
		assert.equal(heldControl.record.rootHandleSha256, handleControl.sha256);
	}
	if (intentControl && handleControl && heldControl && releaseControl) {
		assert.equal(releaseControl.record.qualificationProtocol, intentControl.record.qualificationProtocol);
		assert.equal(releaseControl.record.qualificationId, intentControl.record.qualificationId);
		assert.equal(releaseControl.record.rootJobId, handleControl.record.rootJobId);
		assert.equal(releaseControl.record.jobName, intentControl.record.jobName);
		assert.equal(releaseControl.record.workDir, intentControl.record.workDir);
		assert.equal(releaseControl.record.identityComment, intentControl.record.identityComment);
		assert.equal(releaseControl.record.dispatchIntentSha256, intentControl.sha256);
		assert.equal(releaseControl.record.rootHandleSha256, handleControl.sha256);
		assert.equal(
			releaseControl.record.heldVerificationSha256,
			heldControl.sha256,
			"Root release-intent predecessor hash drifted",
		);
	}
	if (intentControl && handleControl && heldControl && releaseControl && readyControl) {
		assert.equal(readyControl.record.qualificationProtocol, intentControl.record.qualificationProtocol);
		assert.equal(readyControl.record.qualificationId, intentControl.record.qualificationId);
		assert.equal(readyControl.record.rootJobId, handleControl.record.rootJobId);
		assert.equal(readyControl.record.jobName, intentControl.record.jobName);
		assert.equal(readyControl.record.workDir, intentControl.record.workDir);
		assert.equal(readyControl.record.identityComment, intentControl.record.identityComment);
		assert.equal(readyControl.record.dispatchIntentSha256, intentControl.sha256);
		assert.equal(readyControl.record.rootHandleSha256, handleControl.sha256);
		assert.equal(readyControl.record.heldVerificationSha256, heldControl.sha256);
		assert.equal(
			readyControl.record.rootReleaseIntentSha256,
			releaseControl.sha256,
			"Root ready predecessor hash drifted",
		);
	}
	const completedState = await readCompletedCompilerGymJobStepCleanupRecovery({
		outputDir: sealed.outputDir,
		qualificationId: sealed.qualificationId,
		originalOwnerSha256: ownerControl.sha256,
	});
	const completedRecovery = completedState?.result ?? null;
	if (completedRecovery) {
		assert.ok(completedState, "Completed recovery result lacks its completion state");
		assert.equal(completedRecovery.record.qualificationId, sealed.qualificationId);
		assert.equal(completedRecovery.record.dispatchIntentSha256, intentControl?.sha256 ?? null);
		assert.equal(completedRecovery.record.rootHandleSha256, handleControl?.sha256 ?? null);
		assert.equal(completedRecovery.record.heldVerificationSha256, heldControl?.sha256 ?? null);
		assert.equal(completedRecovery.record.rootReleaseIntentSha256, releaseControl?.sha256 ?? null);
		assert.equal(completedRecovery.record.rootReadySha256, readyControl?.sha256 ?? null);
		assert.deepEqual(completedRecovery.record.ledgerSnapshot, ledgerSnapshot);
		assert.equal(completedRecovery.record.recoveryLeaseSha256, completedState.lease.sha256);
		if (handleControl) {
			assert.ok(
				completedRecovery.record.discoveredRootIds.includes(handleControl.record.rootJobId),
				"Completed recovery omitted the durable root handle",
			);
		}
		if (intentControl) {
			for (const accounting of completedRecovery.record.terminalAccounting) {
				assert.equal(
					accounting.user,
					recoveryConfig.user,
					"Completed recovery accounting user drifted from dispatch intent",
				);
				assert.equal(
					accounting.jobName,
					intentControl.record.jobName,
					"Completed recovery accounting job name drifted from dispatch intent",
				);
				assert.equal(
					accounting.workDir,
					intentControl.record.workDir,
					"Completed recovery accounting work directory drifted from dispatch intent",
				);
				assert.equal(
					accounting.identityComment,
					intentControl.record.identityComment,
					"Completed recovery accounting comment drifted from dispatch intent",
				);
			}
		}
		if (completedRecovery.record.status === "cleanup-complete") {
			assert.ok(intentControl, "Completed cleanup recovery lacks a dispatch intent");
			const finalIdentityCommands = completedRecovery.record.commands.slice(-2);
			assert.deepEqual(
				finalIdentityCommands.map((command) => command.label),
				["recovery-squeue-identity", "recovery-sacct-identity"],
				"Completed recovery lacks final scheduler-identity evidence",
			);
			assert.deepEqual(
				finalIdentityCommands[0]?.remoteArgv,
				[
					"/usr/bin/squeue",
					"--noheader",
					"--user",
					recoveryConfig.user,
					"--name",
					intentControl.record.jobName,
					"--format=%A|%u|%j|%Z|%k|%T",
				],
				"Completed recovery final squeue argv drifted",
			);
			assert.deepEqual(
				finalIdentityCommands[1]?.remoteArgv,
				[
					"/usr/bin/sacct",
					"--noheader",
					"-X",
					"--user",
					recoveryConfig.user,
					"--name",
					intentControl.record.jobName,
					"--starttime",
					"now-1days",
					"--format=JobIDRaw,User,JobName,WorkDir,Comment,State",
					"--parsable2",
				],
				"Completed recovery final sacct argv drifted",
			);
			assert.equal(finalIdentityCommands[0]?.stdout.trim(), "", "Completed recovery left a root scheduler-active");
			const finalAccountingRows = (finalIdentityCommands[1]?.stdout.trim() ?? "")
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					const fields = line.split("|");
					if (fields.at(-1) === "") fields.pop();
					assert.equal(fields.length, 6, "Final recovery accounting identity field count drifted");
					return {
						rootJobId: fields[0],
						user: fields[1],
						jobName: fields[2],
						workDir: fields[3],
						identityComment: fields[4],
						state: fields[5]?.split(/[ +]/, 1)[0]?.toUpperCase(),
					};
				})
				.sort((left, right) => {
					const leftId = BigInt(left.rootJobId ?? "0");
					const rightId = BigInt(right.rootJobId ?? "0");
					return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
				});
			assert.deepEqual(
				finalAccountingRows,
				completedRecovery.record.terminalAccounting
					.map((accounting) => ({
						rootJobId: accounting.rootJobId,
						user: accounting.user,
						jobName: accounting.jobName,
						workDir: accounting.workDir,
						identityComment: accounting.identityComment,
						state: accounting.state,
					}))
					.sort((left, right) => {
						const leftId = BigInt(left.rootJobId);
						const rightId = BigInt(right.rootJobId);
						return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
					}),
				"Completed recovery final accounting identity drifted",
			);
		}
		for (const command of completedRecovery.record.commands) {
			if (command.remoteArgv[0] === "/usr/bin/scontrol" && command.remoteArgv[1] === "write") {
				assert.ok(intentControl, "Batch-script recovery evidence exists without a dispatch intent");
				assert.equal(
					command.stdoutSha256,
					intentControl.record.rootScriptSha256,
					"Cached recovery batch-script evidence drifted from the dispatch intent",
				);
			}
		}
		(options.writeOutput ?? process.stdout.write.bind(process.stdout))(completedRecovery.contents);
		return;
	}
	if (!recoveryClaimedMissingOwner) assertCompilerGymJobStepClaimOwnerInactive(ownerControl.record);
	const recoveryLease = await acquireCompilerGymJobStepCleanupRecoveryLease({
		outputDir: sealed.outputDir,
		qualificationId: sealed.qualificationId,
		originalOwnerSha256: ownerControl.sha256,
		dependencies: options.recoveryLeaseDependencies,
	});
	if (!recoveryLease) {
		await runCleanupRecovery(sealed, options);
		return;
	}
	const input: CompilerGymJobStepCleanupRecoveryInput = {
		qualificationId: sealed.qualificationId,
		dispatchIntent: intentControl?.record ?? null,
		dispatchIntentSha256: intentControl?.sha256 ?? null,
		rootHandle: handleControl?.record ?? null,
		rootHandleSha256: handleControl?.sha256 ?? null,
		heldVerification: heldControl?.record ?? null,
		heldVerificationSha256: heldControl?.sha256 ?? null,
		rootReleaseIntentSha256: releaseControl?.sha256 ?? null,
		rootReadySha256: readyControl?.sha256 ?? null,
		recoveryLeaseSha256: recoveryLease.sha256,
		ledgerSnapshot,
	};
	const termination = createCompilerGymJobStepTerminationController();
	const recovery = new CompilerGymJobStepCleanupRecovery(recoveryConfig, options.recoveryDependencies);
	try {
		const result = await recovery.recover(input, termination.signal);
		await publishCompletedCompilerGymJobStepCleanupRecovery({
			outputDir: sealed.outputDir,
			lease: recoveryLease,
			result,
		});
		(options.writeOutput ?? process.stdout.write.bind(process.stdout))(`${canonicalJson(toJsonValue(result))}\n`);
	} catch (error) {
		const failure = {
			protocol: "compiler-gym-job-step-cleanup-recovery-failure-v1",
			status: "cleanup-unverified",
			qualificationId: sealed.qualificationId,
			failedAt: new Date().toISOString(),
			cleanupOnly: true,
			ownerSha256: ownerControl.sha256,
			dispatchIntentSha256: intentControl?.sha256 ?? null,
			rootHandleSha256: handleControl?.sha256 ?? null,
			heldVerificationSha256: heldControl?.sha256 ?? null,
			rootReleaseIntentSha256: releaseControl?.sha256 ?? null,
			rootReadySha256: readyControl?.sha256 ?? null,
			recoveryLeaseSha256: recoveryLease.sha256,
			ledgerSnapshot,
			commands: recovery.commandEvidence(),
			error: errorText(error),
		};
		try {
			await writePrivateJson(join(sealed.outputDir, CLEANUP_RECOVERY_FAILURE_FILE), failure);
		} catch (writeError) {
			if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") {
				throw new AggregateError([error, writeError], "Cleanup recovery and durable failure recording both failed");
			}
			await writePrivateJson(join(sealed.outputDir, `cleanup-recovery-failure-${randomUUID()}.json`), failure);
		}
		throw error;
	} finally {
		termination.dispose();
	}
}

export interface PersistedCompilerGymJobStepFailureEvidence {
	protocol: "compiler-gym-job-step-c1-failure-artifact-v1";
	status: "failed";
	qualificationId: string;
	capturedAt: string;
	error: string;
	qualificationFailure: CompilerGymJobStepQualificationFailureEvidence | null;
}

export interface PersistedCompilerGymJobStepFailureManifest {
	protocol: typeof EXECUTION_PROTOCOL;
	status: "failed";
	qualificationId: string;
	startedAt: string;
	finishedAt: string;
	preregistrationPath: string;
	preregistrationSha256: string;
	runtimeManifestPath: string;
	runtimeManifestSha256: string;
	dispatchPreflight: DispatchPreflight | null;
	error: string;
	failureEvidencePath: typeof FAILURE_EVIDENCE_FILE;
	failureEvidenceSha256: string;
	rootCleanupVerified: boolean | null;
	ledgerSha256: string;
	ledgerTerminalEventSha256: string;
	ledgerEventCount: number;
}

export interface PersistedCompilerGymJobStepFailureResult {
	failureEvidenceSha256: string;
	failureManifestSha256: string;
	ledgerSha256: string;
	ledgerTerminalEventSha256: string;
	ledgerEventCount: number;
}

export async function persistSealedCompilerGymJobStepFailure(input: {
	outputDir: string;
	qualificationId: string;
	startedAt: string;
	preregistrationPath: string;
	preregistrationSha256: string;
	runtimeManifestPath: string;
	runtimeManifestSha256: string;
	dispatchPreflight: DispatchPreflight | null;
	ledger: EvidenceLedger;
	error: unknown;
}): Promise<PersistedCompilerGymJobStepFailureResult> {
	const finishedAt = new Date().toISOString();
	const error = errorText(input.error);
	const qualificationFailure =
		input.error instanceof CompilerGymJobStepQualificationFailure ? input.error.evidence : null;
	if (qualificationFailure) assert.equal(qualificationFailure.qualificationId, input.qualificationId);
	const expectedRootIds = new Set([
		...(qualificationFailure?.rootJobId ? [qualificationFailure.rootJobId] : []),
		...(qualificationFailure?.discoveredRootIds ?? []),
	]);
	const verifiedCleanupRootIds = new Set(
		qualificationFailure?.cleanupAttempts
			.filter((attempt) => attempt.schedulerAbsent === true && attempt.error === null)
			.map((attempt) => attempt.rootJobId) ?? [],
	);
	const rootCleanupVerified = qualificationFailure
		? expectedRootIds.size > 0 &&
			qualificationFailure.cleanupAttempts.length === expectedRootIds.size &&
			verifiedCleanupRootIds.size === expectedRootIds.size &&
			[...expectedRootIds].every((rootJobId) => verifiedCleanupRootIds.has(rootJobId))
		: null;
	const failureEvidence: PersistedCompilerGymJobStepFailureEvidence = {
		protocol: "compiler-gym-job-step-c1-failure-artifact-v1",
		status: "failed",
		qualificationId: input.qualificationId,
		capturedAt: finishedAt,
		error,
		qualificationFailure,
	};
	const failureEvidenceWrite = await writeDurableExclusiveJson(
		join(input.outputDir, FAILURE_EVIDENCE_FILE),
		failureEvidence,
	);
	const terminalEvent = await input.ledger.append("run_manifest", {
		protocol: EXECUTION_PROTOCOL,
		phase: "failed",
		qualificationId: input.qualificationId,
		preregistrationPath: input.preregistrationPath,
		runtimeManifestPath: input.runtimeManifestPath,
		failureEvidencePath: FAILURE_EVIDENCE_FILE,
		failureEvidenceSha256: failureEvidenceWrite.sha256,
		rootJobId: qualificationFailure?.rootJobId ?? null,
		rootCleanupVerified,
		error,
		modelCalls: 0,
		gpuHours: 0,
	});
	input.ledger.verify();
	const ledgerContents = await readFile(input.ledger.path, "utf8");
	const strictEvents = verifyLedgerContentsStrict(ledgerContents);
	assert.equal(strictEvents.at(-1)?.hash, terminalEvent.hash, "Failure ledger terminal event drifted");
	const ledgerSha256 = sha256Text(ledgerContents);
	const failureManifest: PersistedCompilerGymJobStepFailureManifest = {
		protocol: EXECUTION_PROTOCOL,
		status: "failed",
		qualificationId: input.qualificationId,
		startedAt: input.startedAt,
		finishedAt,
		preregistrationPath: input.preregistrationPath,
		preregistrationSha256: input.preregistrationSha256,
		runtimeManifestPath: input.runtimeManifestPath,
		runtimeManifestSha256: input.runtimeManifestSha256,
		dispatchPreflight: input.dispatchPreflight,
		error,
		failureEvidencePath: FAILURE_EVIDENCE_FILE,
		failureEvidenceSha256: failureEvidenceWrite.sha256,
		rootCleanupVerified,
		ledgerSha256,
		ledgerTerminalEventSha256: terminalEvent.hash,
		ledgerEventCount: strictEvents.length,
	};
	const failureManifestWrite = await writeDurableExclusiveJson(join(input.outputDir, FAILURE_FILE), failureManifest);
	return {
		failureEvidenceSha256: failureEvidenceWrite.sha256,
		failureManifestSha256: failureManifestWrite.sha256,
		ledgerSha256,
		ledgerTerminalEventSha256: terminalEvent.hash,
		ledgerEventCount: strictEvents.length,
	};
}

async function runQualification(sealed: SealedCompilerGymJobStepQualification): Promise<void> {
	const termination = createCompilerGymJobStepTerminationController();
	const startedAt = new Date().toISOString();
	const preregistrationPath = relative(REPOSITORY_ROOT, sealed.preregistrationPath);
	const runtimeManifestPath = relative(REPOSITORY_ROOT, sealed.runtimeManifestPath);
	let dispatchPreflight: DispatchPreflight | null = null;
	let outputClaimed = false;
	let failureLedger: EvidenceLedger | undefined;
	try {
		dispatchPreflight = await captureDispatchPreflight(termination.signal, sealed.envProbeSha256);
		const claimed = await claimSealedCompilerGymJobStepOutput({
			path: sealed.outputDir,
			qualificationId: sealed.qualificationId,
			hostname: hostname(),
			pid: process.pid,
			startedAt,
		});
		outputClaimed = true;
		const ledgerPath = join(sealed.outputDir, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(ledgerPath);
		failureLedger = ledger;
		let jobStateEvents = 0;
		let durableDispatchIntent: CompilerGymJobStepDispatchIntentRecord | undefined;
		let durableRootHandle: CompilerGymJobStepRootHandleRecord | undefined;
		let dispatchIntentWrite: DurableExclusiveJsonWrite | undefined;
		let rootHandleWrite: DurableExclusiveJsonWrite | undefined;
		let heldVerificationWrite: DurableExclusiveJsonWrite | undefined;
		let rootReleaseIntentWrite: DurableExclusiveJsonWrite | undefined;
		await ledger.append("run_manifest", {
			protocol: EXECUTION_PROTOCOL,
			phase: "started",
			qualificationId: sealed.qualificationId,
			preregistrationPath,
			preregistrationSha256: sealed.preregistrationSha256,
			runtimeManifestPath,
			runtimeManifestSha256: sealed.runtimeManifestSha256,
			dispatchPreflight,
			modelCalls: 0,
			gpuHours: 0,
		});
		await ledger.append("proposal", {
			protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
			candidateId: "C1",
			request: COMPILER_GYM_JOB_STEP_C1_FIXTURE.request,
			expected: {
				candidateId: COMPILER_GYM_JOB_STEP_C1_FIXTURE.candidateId,
				requestSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256,
				candidateSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256,
				tasks: COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks,
			},
		});
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			expectedWorkerSha256: sealed.workerSha256,
		});
		const observation = await runner.run(sealed.qualificationId, termination.signal, {
			async recordDispatchIntent(record) {
				assert.equal(record.qualificationId, sealed.qualificationId);
				const durable: CompilerGymJobStepDispatchIntentRecord = {
					protocol: COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL,
					qualificationProtocol: record.protocol,
					qualificationId: record.qualificationId,
					jobName: record.jobName,
					candidateJobName: record.candidateJobName,
					workDir: record.workDir,
					identityComment: record.identityComment,
					rootScriptSha256: record.rootScriptSha256,
					sbatchArgv: [...record.sbatchArgv],
					sbatchArgvSha256: record.sbatchArgvSha256,
					workerSha256: record.workerSha256,
					evaluatorSha256: record.evaluatorSha256,
					recordedAt: record.recordedAt,
					claimOwnerSha256: claimed.ownerSha256,
				};
				parseCompilerGymJobStepDispatchIntentRecord(`${canonicalJson(toJsonValue(durable))}\n`);
				dispatchIntentWrite = await writeDurableExclusiveJson(
					join(sealed.outputDir, DISPATCH_INTENT_FILE),
					durable,
				);
				durableDispatchIntent = durable;
				await ledger.append("job_state", {
					...record,
					status: "dispatch-intent-persisted",
					controlSha256: dispatchIntentWrite.sha256,
					candidatePublished: false,
				});
				jobStateEvents += 1;
			},
			async recordRootSubmitted(record) {
				if (!dispatchIntentWrite || !durableDispatchIntent) {
					throw new Error("Root handle preceded durable dispatch intent");
				}
				assert.equal(record.qualificationId, durableDispatchIntent.qualificationId);
				assert.equal(record.jobName, durableDispatchIntent.jobName);
				assert.equal(record.workDir, durableDispatchIntent.workDir);
				const durable: CompilerGymJobStepRootHandleRecord = {
					protocol: COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL,
					qualificationProtocol: record.protocol,
					qualificationId: record.qualificationId,
					rootJobId: record.rootJobId,
					jobName: record.jobName,
					workDir: record.workDir,
					submittedAt: record.submittedAt,
					dispatchIntentSha256: dispatchIntentWrite.sha256,
				};
				parseCompilerGymJobStepRootHandleRecord(`${canonicalJson(toJsonValue(durable))}\n`);
				rootHandleWrite = await writeDurableExclusiveJson(join(sealed.outputDir, ROOT_HANDLE_FILE), durable);
				durableRootHandle = durable;
				await ledger.append("job_state", {
					...record,
					status: "root-submitted-handle-persisted",
					controlSha256: rootHandleWrite.sha256,
					candidatePublished: false,
				});
				jobStateEvents += 1;
			},
			async recordRootHeldVerified(record) {
				if (!dispatchIntentWrite || !rootHandleWrite || !durableDispatchIntent || !durableRootHandle) {
					throw new Error("Held verification preceded durable intent or root handle");
				}
				assert.equal(record.qualificationId, durableDispatchIntent.qualificationId);
				assert.equal(record.rootJobId, durableRootHandle.rootJobId);
				assert.equal(record.jobName, durableDispatchIntent.jobName);
				assert.equal(record.workDir, durableDispatchIntent.workDir);
				assert.equal(record.identityComment, durableDispatchIntent.identityComment);
				assert.equal(record.rootScriptSha256, durableDispatchIntent.rootScriptSha256);
				assert.equal(record.spooledScriptSha256, durableDispatchIntent.rootScriptSha256);
				assert.equal(record.batchFlag, 1);
				assert.equal(record.priority, 0);
				const durable: CompilerGymJobStepHeldVerificationRecord = {
					protocol: COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL,
					qualificationProtocol: record.protocol,
					qualificationId: record.qualificationId,
					rootJobId: record.rootJobId,
					jobName: record.jobName,
					workDir: record.workDir,
					identityComment: record.identityComment,
					rootScriptSha256: record.rootScriptSha256,
					spooledScriptSha256: record.spooledScriptSha256,
					heldIdentity: {
						batchFlag: record.batchFlag,
						priority: record.priority,
						reason: record.heldReason,
						state: record.heldState,
					},
					verifiedAt: record.validatedAt,
					dispatchIntentSha256: dispatchIntentWrite.sha256,
					rootHandleSha256: rootHandleWrite.sha256,
				};
				parseCompilerGymJobStepHeldVerificationRecord(`${canonicalJson(toJsonValue(durable))}\n`);
				heldVerificationWrite = await writeDurableExclusiveJson(
					join(sealed.outputDir, HELD_VERIFICATION_FILE),
					durable,
				);
				await ledger.append("job_state", {
					...record,
					status: "root-held-verification-persisted",
					controlSha256: heldVerificationWrite.sha256,
					candidatePublished: false,
				});
				jobStateEvents += 1;
			},
			async recordRootReleaseIntent(record) {
				if (
					!dispatchIntentWrite ||
					!rootHandleWrite ||
					!heldVerificationWrite ||
					!durableDispatchIntent ||
					!durableRootHandle
				) {
					throw new Error("Release intent preceded a durable held verification");
				}
				assert.equal(record.qualificationId, durableDispatchIntent.qualificationId);
				assert.equal(record.rootJobId, durableRootHandle.rootJobId);
				assert.equal(record.jobName, durableDispatchIntent.jobName);
				assert.equal(record.workDir, durableDispatchIntent.workDir);
				assert.equal(record.identityComment, durableDispatchIntent.identityComment);
				const durable: CompilerGymJobStepRootReleaseIntentRecord = {
					protocol: COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL,
					qualificationProtocol: record.protocol,
					qualificationId: record.qualificationId,
					rootJobId: record.rootJobId,
					jobName: record.jobName,
					workDir: record.workDir,
					identityComment: record.identityComment,
					recordedAt: record.recordedAt,
					dispatchIntentSha256: dispatchIntentWrite.sha256,
					rootHandleSha256: rootHandleWrite.sha256,
					heldVerificationSha256: heldVerificationWrite.sha256,
				};
				parseCompilerGymJobStepRootReleaseIntentRecord(`${canonicalJson(toJsonValue(durable))}\n`);
				rootReleaseIntentWrite = await writeDurableExclusiveJson(
					join(sealed.outputDir, ROOT_RELEASE_INTENT_FILE),
					durable,
				);
				await ledger.append("job_state", {
					...record,
					status: "root-release-intent-persisted",
					controlSha256: rootReleaseIntentWrite.sha256,
					candidatePublished: false,
				});
				jobStateEvents += 1;
			},
			async recordRootReady(record) {
				if (
					!dispatchIntentWrite ||
					!rootHandleWrite ||
					!heldVerificationWrite ||
					!rootReleaseIntentWrite ||
					!durableDispatchIntent ||
					!durableRootHandle
				) {
					throw new Error("Root readiness preceded durable dispatch controls");
				}
				assert.equal(record.qualificationId, durableDispatchIntent.qualificationId);
				assert.equal(record.rootJobId, durableRootHandle.rootJobId);
				assert.equal(record.jobName, durableDispatchIntent.jobName);
				assert.equal(record.workDir, durableDispatchIntent.workDir);
				const durable: CompilerGymJobStepRootReadyRecord = {
					protocol: COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL,
					qualificationProtocol: record.protocol,
					qualificationId: record.qualificationId,
					rootJobId: record.rootJobId,
					jobName: record.jobName,
					workDir: record.workDir,
					identityComment: durableDispatchIntent.identityComment,
					validatedAt: record.validatedAt,
					dispatchIntentSha256: dispatchIntentWrite.sha256,
					rootHandleSha256: rootHandleWrite.sha256,
					heldVerificationSha256: heldVerificationWrite.sha256,
					rootReleaseIntentSha256: rootReleaseIntentWrite.sha256,
				};
				parseCompilerGymJobStepRootReadyRecord(`${canonicalJson(toJsonValue(durable))}\n`);
				const readyWrite = await writeDurableExclusiveJson(join(sealed.outputDir, ROOT_READY_FILE), durable);
				await ledger.append("job_state", {
					...record,
					status: "root-ready-persisted",
					controlSha256: readyWrite.sha256,
					candidatePublished: false,
				});
				jobStateEvents += 1;
			},
		});
		const analysis = analyzeCompilerGymJobStepQualification(observation);
		const result = {
			protocol: EXECUTION_PROTOCOL,
			status: "completed",
			preregistrationSha256: sealed.preregistrationSha256,
			runtimeManifestSha256: sealed.runtimeManifestSha256,
			observation,
			analysis,
		};
		const resultPath = join(sealed.outputDir, "result.json");
		await writePrivateJson(resultPath, result);
		const resultContents = await readFile(resultPath, "utf8");
		const resultSha256 = sha256Text(resultContents);
		await ledger.append("measurement", {
			protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
			observation,
		});
		await ledger.append("claim", analysis);
		await ledger.append("run_manifest", {
			protocol: EXECUTION_PROTOCOL,
			phase: "completed",
			decision: analysis.decision,
			resultSha256,
			artifactCount: 0,
			modelCalls: 0,
			gpuHours: 0,
		});
		ledger.verify();
		const ledgerContents = await readFile(ledgerPath, "utf8");
		const strictEvents = verifyLedgerContentsStrict(ledgerContents);
		assert.equal(strictEvents.length, 5 + jobStateEvents, "Qualification ledger event count drifted");
		const ledgerSha256 = sha256Text(ledgerContents);
		const executionManifest = {
			protocol: EXECUTION_PROTOCOL,
			status: "completed",
			qualificationId: sealed.qualificationId,
			startedAt,
			finishedAt: new Date().toISOString(),
			preregistrationPath,
			preregistrationSha256: sealed.preregistrationSha256,
			runtimeManifestPath,
			runtimeManifestSha256: sealed.runtimeManifestSha256,
			resultSha256,
			ledgerSha256,
			ledgerTerminalEventSha256: strictEvents.at(-1)?.hash ?? null,
			ledgerEventCount: strictEvents.length,
			artifactCount: 0,
			decision: analysis.decision,
			dispatchPreflight,
		};
		await writePrivateJson(join(sealed.outputDir, "execution-manifest.json"), executionManifest);
		process.stdout.write(`${canonicalJson(toJsonValue(executionManifest))}\n`);
	} catch (error) {
		if (outputClaimed) {
			try {
				if (failureLedger) {
					await persistSealedCompilerGymJobStepFailure({
						outputDir: sealed.outputDir,
						qualificationId: sealed.qualificationId,
						startedAt,
						preregistrationPath,
						preregistrationSha256: sealed.preregistrationSha256,
						runtimeManifestPath,
						runtimeManifestSha256: sealed.runtimeManifestSha256,
						dispatchPreflight,
						ledger: failureLedger,
						error,
					});
				} else {
					await writePrivateJson(join(sealed.outputDir, FAILURE_FILE), {
						protocol: EXECUTION_PROTOCOL,
						status: "failed",
						qualificationId: sealed.qualificationId,
						startedAt,
						finishedAt: new Date().toISOString(),
						preregistrationPath,
						preregistrationSha256: sealed.preregistrationSha256,
						runtimeManifestPath,
						runtimeManifestSha256: sealed.runtimeManifestSha256,
						dispatchPreflight,
						error: errorText(error),
					});
				}
			} catch (persistenceError) {
				throw new AggregateError(
					[error, persistenceError],
					"Qualification and durable failure-evidence persistence both failed",
				);
			}
		}
		throw error;
	} finally {
		termination.dispose();
	}
}

async function assertSupersededV1OutputAbsent(): Promise<void> {
	try {
		await lstat(resolveInsideRepository(V1_OUTPUT_PATH, "superseded v1 output"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	throw new Error(`Superseded v1 output unexpectedly exists: ${V1_OUTPUT_PATH}`);
}

async function main(): Promise<void> {
	const command = parseCompilerGymJobStepSealedCommand(process.argv.slice(2));
	const sealed = await loadSealedCompilerGymJobStepQualification();
	if (command === "verify-seal") {
		process.stdout.write(
			`${canonicalJson({
				protocol: SEAL_VERIFICATION_PROTOCOL,
				status: "verified",
				qualificationId: sealed.qualificationId,
				preregistrationPath: relative(REPOSITORY_ROOT, sealed.preregistrationPath),
				preregistrationSha256: sealed.preregistrationSha256,
				runtimeManifestPath: relative(REPOSITORY_ROOT, sealed.runtimeManifestPath),
				runtimeManifestSha256: sealed.runtimeManifestSha256,
			})}\n`,
		);
		return;
	}
	if (command === "recover") {
		await runCleanupRecovery(sealed);
		return;
	}
	await assertSupersededV1OutputAbsent();
	await runQualification(sealed);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
	main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

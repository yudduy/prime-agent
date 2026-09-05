import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL,
	COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL,
	COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL,
	COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL,
	COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL,
	COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL,
	CompilerGymJobStepCleanupRecovery,
	type CompilerGymJobStepCleanupRecoveryInput,
	type CompilerGymJobStepDispatchIntentRecord,
	type CompilerGymJobStepRecoveryClock,
	parseCompilerGymJobStepCleanupRecoveryLeaseRecord,
	parseCompilerGymJobStepCleanupRecoveryRecord,
	parseCompilerGymJobStepDispatchIntentRecord,
	parseCompilerGymJobStepHeldVerificationRecord,
	parseCompilerGymJobStepRootReadyRecord,
	parseCompilerGymJobStepRootReleaseIntentRecord,
} from "../src/compiler-gym-job-step-cleanup-recovery.js";
import { DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG } from "../src/compiler-gym-job-step-qualification.js";
import {
	assertCompilerGymJobStepClaimOwnerInactive,
	assertCompilerGymJobStepDispatchCapabilities,
	captureCompilerGymJobStepLedgerSnapshot,
	claimSealedCompilerGymJobStepOutput,
	createCompilerGymJobStepTerminationController,
	readVerifiedCompilerGymJobStepEnvProbeSource,
	runCleanupRecovery,
	type SealedCompilerGymJobStepQualification,
	writeDurableExclusiveJson,
} from "../src/compiler-gym-job-step-qualification-sealed.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
} from "../src/compiler-gym-warm-farmshare-backend.js";

const ROOT_SCRIPT = "#!/bin/sh\nexit 0\n";
const ROOT_SCRIPT_SHA256 = sha256Text(ROOT_SCRIPT);
const ROOT_ID = "424242";
const SECOND_ROOT_ID = "424243";
const QUALIFICATION_ID = "recovery-fixture-v1";
const JOB_NAME = "cg-js-recovery-fixture";
const WORK_DIR = "/scratch/users/duynguy/recovery-fixture-v1";
const IDENTITY_COMMENT = `pa-c1-${"a".repeat(40)}`;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

class FauxRecoveryClock implements CompilerGymJobStepRecoveryClock {
	private nanoseconds = 0n;

	elapsedMs(): number {
		return Number(this.nanoseconds / 1_000_000n);
	}

	now(): Date {
		return new Date(Number(this.nanoseconds / 1_000_000n));
	}

	nowNs(): bigint {
		return this.nanoseconds;
	}

	async sleep(ms: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) throw signal.reason;
		this.nanoseconds += BigInt(ms) * 1_000_000n;
	}
}

class FauxRecoveryScheduler implements CompilerGymWarmCommandRunner {
	readonly requests: CompilerGymWarmCommandRequest[] = [];
	readonly cancelled = new Set<string>();
	readonly cancelAtMs: number[] = [];
	readonly postPrimaryCancellationIdentitySnapshots: string[][] = [];
	lateRootFirstVisibleAtMs: number | null = null;
	private postPrimaryCancellationIdentityPolls = 0;

	constructor(
		private readonly rootIds: string[],
		private readonly options: {
			identityComment?: string;
			lateRootId?: string;
			spool?: string;
			spoolStderr?: string;
			terminal?: boolean;
			nowMs?: () => number;
		} = {},
	) {}

	private rootId(command: string): string {
		const rootId = [...this.rootIds, ...(this.options.lateRootId ? [this.options.lateRootId] : [])].find(
			(candidate) => command.includes(`'${candidate}'`),
		);
		if (!rootId) throw new Error(`Faux scheduler could not find a root ID in ${command}`);
		return rootId;
	}

	private result(stdout = "", stderr = "", exitCode = 0): CompilerGymWarmCommandResult {
		return { stdout, stderr, exitCode, wallMs: 1 };
	}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		this.requests.push(request);
		assert.equal(request.input, undefined, "Cleanup recovery must never send command input");
		const command = request.argv.at(-1) ?? "";
		assert.ok(!command.includes("'/usr/bin/sbatch'"));
		assert.ok(!command.includes("'/usr/bin/srun'"));
		assert.ok(!command.includes("'release'"));
		const comment = this.options.identityComment ?? IDENTITY_COMMENT;
		const primaryRootsCancelled = this.rootIds.every((rootId) => this.cancelled.has(rootId));
		if (command.includes("'/usr/bin/squeue'") && command.includes("'--name'")) {
			if (this.options.lateRootId && primaryRootsCancelled) {
				this.postPrimaryCancellationIdentityPolls += 1;
			}
			const lateVisible = Boolean(
				this.options.lateRootId && primaryRootsCancelled && this.postPrimaryCancellationIdentityPolls >= 2,
			);
			const visibleRootIds = [
				...this.rootIds,
				...(lateVisible && this.options.lateRootId ? [this.options.lateRootId] : []),
			];
			if (primaryRootsCancelled) {
				this.postPrimaryCancellationIdentitySnapshots.push([...visibleRootIds]);
			}
			if (lateVisible && this.lateRootFirstVisibleAtMs === null) {
				this.lateRootFirstVisibleAtMs = this.options.nowMs?.() ?? -1;
			}
			const activeRootIds = visibleRootIds.filter((rootId) => !this.options.terminal && !this.cancelled.has(rootId));
			const rows = activeRootIds.map((rootId) => `${rootId}|duynguy|${JOB_NAME}|${WORK_DIR}|${comment}|PENDING`);
			return this.result(rows.length > 0 ? `${rows.join("\n")}\n` : "");
		}
		if (command.includes("'/usr/bin/sacct'") && command.includes("'--name'")) {
			const lateVisible = Boolean(
				this.options.lateRootId && primaryRootsCancelled && this.postPrimaryCancellationIdentityPolls >= 2,
			);
			const visibleRootIds = [
				...this.rootIds,
				...(lateVisible && this.options.lateRootId ? [this.options.lateRootId] : []),
			];
			const rows = visibleRootIds
				.filter((rootId) => this.options.terminal || this.cancelled.has(rootId))
				.map((rootId) => `${rootId}|duynguy|${JOB_NAME}|${WORK_DIR}|${comment}|CANCELLED|`);
			return this.result(rows.length > 0 ? `${rows.join("\n")}\n` : "");
		}
		if (command.includes("'/usr/bin/scontrol'") && command.includes("'show'") && command.includes("'job'")) {
			const rootId = this.rootId(command);
			return this.result(
				`JobId=${rootId} JobName=${JOB_NAME} UserId=duynguy(1234) Partition=${DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG.partition} NumNodes=1 NumCPUs=4 NumTasks=2 CPUs/Task=2 MinMemoryNode=${DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG.memory} WorkDir=${WORK_DIR} Comment=${comment} Requeue=0 BatchFlag=1 Features=${DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG.cpuConstraint} JobState=PENDING Reason=JobHeldUser\n`,
			);
		}
		if (
			command.includes("'/usr/bin/scontrol'") &&
			command.includes("'write'") &&
			command.includes("'batch_script'")
		) {
			return this.result(this.options.spool ?? ROOT_SCRIPT, this.options.spoolStderr ?? "");
		}
		if (command.includes("'/usr/bin/scancel'")) {
			this.cancelAtMs.push(this.options.nowMs?.() ?? -1);
			this.cancelled.add(this.rootId(command));
			return this.result();
		}
		if (command.includes("'/usr/bin/squeue'") && command.includes("'--jobs'")) {
			const rootId = this.rootId(command);
			return this.options.terminal || this.cancelled.has(rootId)
				? this.result()
				: this.result(`${rootId}|PENDING\n`);
		}
		if (command.includes("'/usr/bin/sacct'") && command.includes("'--jobs'")) {
			const rootId = this.rootId(command);
			if (!this.options.terminal && !this.cancelled.has(rootId)) return this.result();
			return this.result(
				`${rootId}|duynguy|${JOB_NAME}|${WORK_DIR}|${comment}|CANCELLED|0:15|2026-08-28T00:00:00|2026-08-28T00:00:01|\n`,
			);
		}
		throw new Error(`Faux scheduler received unexpected command ${command}`);
	}
}

class BarrierRecoveryScheduler extends FauxRecoveryScheduler {
	waitingRemoteCalls = 0;
	private released = false;
	private resolveFirstRemote: () => void = () => undefined;
	private resolveReleaseBarrier: () => void = () => undefined;
	private readonly firstRemote = new Promise<void>((resolve) => {
		this.resolveFirstRemote = resolve;
	});
	private readonly releaseBarrier = new Promise<void>((resolve) => {
		this.resolveReleaseBarrier = resolve;
	});

	waitForFirstRemote(): Promise<void> {
		return this.firstRemote;
	}

	release(): void {
		this.released = true;
		this.resolveReleaseBarrier();
	}

	override async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		if (!this.released) {
			this.waitingRemoteCalls += 1;
			this.resolveFirstRemote();
			await this.releaseBarrier;
		}
		return super.run(request);
	}
}

function dispatchIntent(): CompilerGymJobStepDispatchIntentRecord {
	const sbatchArgv = [
		"/usr/bin/sbatch",
		"--parsable",
		"--hold",
		"--no-requeue",
		`--job-name=${JOB_NAME}`,
		`--comment=${IDENTITY_COMMENT}`,
		`--chdir=${WORK_DIR}`,
	];
	return {
		protocol: COMPILER_GYM_JOB_STEP_DISPATCH_INTENT_PROTOCOL,
		qualificationProtocol: "compiler-gym-job-step-c1-qualification-v1",
		qualificationId: QUALIFICATION_ID,
		jobName: JOB_NAME,
		candidateJobName: `${JOB_NAME}-c1`,
		workDir: WORK_DIR,
		identityComment: IDENTITY_COMMENT,
		rootScriptSha256: ROOT_SCRIPT_SHA256,
		sbatchArgv,
		sbatchArgvSha256: sha256Json(sbatchArgv),
		workerSha256: HASH_A,
		evaluatorSha256: HASH_B,
		recordedAt: "2026-08-28T00:00:00.000Z",
		claimOwnerSha256: HASH_A,
	};
}

function recoveryInput(rootJobId?: string): CompilerGymJobStepCleanupRecoveryInput {
	const intent = dispatchIntent();
	const intentContents = `${canonicalJson(toJsonValue(intent))}\n`;
	const intentSha256 = sha256Text(intentContents);
	const handle = rootJobId
		? {
				protocol: COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL,
				qualificationProtocol: intent.qualificationProtocol,
				qualificationId: intent.qualificationId,
				rootJobId,
				jobName: intent.jobName,
				workDir: intent.workDir,
				submittedAt: "2026-08-28T00:00:01.000Z",
				dispatchIntentSha256: intentSha256,
			}
		: null;
	return {
		qualificationId: QUALIFICATION_ID,
		dispatchIntent: intent,
		dispatchIntentSha256: intentSha256,
		rootHandle: handle,
		rootHandleSha256: handle ? sha256Text(`${canonicalJson(toJsonValue(handle))}\n`) : null,
		heldVerification: null,
		heldVerificationSha256: null,
		rootReleaseIntentSha256: null,
		rootReadySha256: null,
		recoveryLeaseSha256: HASH_A,
		ledgerSnapshot: { present: true, bytes: 7, sha256: HASH_B },
	};
}

function recovery(
	scheduler: CompilerGymWarmCommandRunner,
	clock: FauxRecoveryClock = new FauxRecoveryClock(),
): CompilerGymJobStepCleanupRecovery {
	return new CompilerGymJobStepCleanupRecovery(recoveryConfig(), { commandRunner: scheduler, clock });
}

function recoveryConfig(): typeof DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG {
	return {
		...DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
		dispatchVisibilityGraceMs: 6_000,
		cleanupTimeoutMs: 30_000,
		pollIntervalMs: 1_000,
	};
}

function sealed(outputDir: string): SealedCompilerGymJobStepQualification {
	return {
		preregistrationPath: "/tmp/preregistration.json",
		preregistrationSha256: HASH_A,
		runtimeManifestPath: "/tmp/runtime-manifest.json",
		runtimeManifestSha256: HASH_B,
		outputDir,
		qualificationId: QUALIFICATION_ID,
		workerSha256: HASH_A,
		envProbeSha256: HASH_B,
	};
}

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

function commandEvidence(sequence: number, label: string, remoteArgv: string[], stdout = "") {
	return {
		sequence,
		label,
		remoteArgv,
		exitCode: 0,
		stdout,
		stderr: "",
		stdoutSha256: sha256Text(stdout),
		stderrSha256: sha256Text(""),
		wallMs: 1,
		capturedAt: `2026-08-28T00:00:0${sequence}.000Z`,
	};
}

async function writeIntentAndOptionalHandle(
	outputDir: string,
	withHandle: boolean,
): Promise<{
	ownerSha256: string;
	intent: CompilerGymJobStepDispatchIntentRecord;
	intentSha256: string;
	handle: CompilerGymJobStepCleanupRecoveryInput["rootHandle"];
	handleSha256: string | null;
}> {
	const claim = await claimSealedCompilerGymJobStepOutput({
		path: outputDir,
		qualificationId: QUALIFICATION_ID,
		hostname: hostname(),
		pid: 2_147_483_647,
		startedAt: "2026-08-28T00:00:00.000Z",
	});
	const intent = { ...dispatchIntent(), claimOwnerSha256: claim.ownerSha256 };
	const intentWrite = await writeDurableExclusiveJson(join(outputDir, "dispatch-intent.json"), intent);
	if (!withHandle) {
		return {
			ownerSha256: claim.ownerSha256,
			intent,
			intentSha256: intentWrite.sha256,
			handle: null,
			handleSha256: null,
		};
	}
	const handle = {
		protocol: COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL,
		qualificationProtocol: intent.qualificationProtocol,
		qualificationId: QUALIFICATION_ID,
		rootJobId: ROOT_ID,
		jobName: JOB_NAME,
		workDir: WORK_DIR,
		submittedAt: "2026-08-28T00:00:01.000Z",
		dispatchIntentSha256: intentWrite.sha256,
	};
	const handleWrite = await writeDurableExclusiveJson(join(outputDir, "root-handle.json"), handle);
	return {
		ownerSha256: claim.ownerSha256,
		intent,
		intentSha256: intentWrite.sha256,
		handle,
		handleSha256: handleWrite.sha256,
	};
}

async function writeRecoveryLease(
	outputDir: string,
	ownerSha256: string,
	pid = process.pid,
	generation = "1",
): Promise<string> {
	const lease = {
		protocol: COMPILER_GYM_JOB_STEP_CLEANUP_RECOVERY_LEASE_PROTOCOL,
		qualificationId: QUALIFICATION_ID,
		outputDir,
		generation,
		hostname: hostname(),
		pid,
		acquiredAt: "2026-08-28T00:00:02.000Z",
		originalOwnerSha256: ownerSha256,
	};
	return (await writeDurableExclusiveJson(join(outputDir, `cleanup-recovery-lease-${generation}.json`), lease)).sha256;
}

async function writeRecoveryTransition(
	outputDir: string,
	generation: string,
	disposition: "complete" | "stale",
	resultSha256: string | null = null,
): Promise<string> {
	const leaseContents = await readFile(join(outputDir, `cleanup-recovery-lease-${generation}.json`), "utf8");
	const lease = parseCompilerGymJobStepCleanupRecoveryLeaseRecord(leaseContents);
	const transition = {
		protocol: "compiler-gym-job-step-cleanup-recovery-transition-v1",
		qualificationId: lease.qualificationId,
		outputDir,
		generation,
		leaseSha256: sha256Text(leaseContents),
		disposition,
		resultSha256,
		recordedAt: "2026-08-28T00:00:03.000Z",
	};
	return (
		await writeDurableExclusiveJson(join(outputDir, `cleanup-recovery-transition-${generation}.json`), transition)
	).sha256;
}

async function publishRecoveryFixture(outputDir: string, record: unknown, generation = "1"): Promise<void> {
	const result = await writeDurableExclusiveJson(
		join(outputDir, `cleanup-recovery-result-${generation}.json`),
		record,
	);
	await writeRecoveryTransition(outputDir, generation, "complete", result.sha256);
}

async function writeInvalidControlChain(outputDir: string, wrongLink: "release" | "ready"): Promise<void> {
	const claim = await claimSealedCompilerGymJobStepOutput({
		path: outputDir,
		qualificationId: QUALIFICATION_ID,
		hostname: hostname(),
		pid: process.pid,
		startedAt: "2026-08-28T00:00:00.000Z",
	});
	const intent = { ...dispatchIntent(), claimOwnerSha256: claim.ownerSha256 };
	const intentWrite = await writeDurableExclusiveJson(join(outputDir, "dispatch-intent.json"), intent);
	const handle = {
		protocol: COMPILER_GYM_JOB_STEP_ROOT_HANDLE_PROTOCOL,
		qualificationProtocol: intent.qualificationProtocol,
		qualificationId: QUALIFICATION_ID,
		rootJobId: ROOT_ID,
		jobName: JOB_NAME,
		workDir: WORK_DIR,
		submittedAt: "2026-08-28T00:00:01.000Z",
		dispatchIntentSha256: intentWrite.sha256,
	};
	const handleWrite = await writeDurableExclusiveJson(join(outputDir, "root-handle.json"), handle);
	const held = {
		protocol: COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL,
		qualificationProtocol: intent.qualificationProtocol,
		qualificationId: QUALIFICATION_ID,
		rootJobId: ROOT_ID,
		jobName: JOB_NAME,
		workDir: WORK_DIR,
		identityComment: IDENTITY_COMMENT,
		rootScriptSha256: ROOT_SCRIPT_SHA256,
		spooledScriptSha256: ROOT_SCRIPT_SHA256,
		heldIdentity: { batchFlag: 1, priority: 0, reason: "JobHeldUser", state: "PENDING" },
		verifiedAt: "2026-08-28T00:00:02.000Z",
		dispatchIntentSha256: intentWrite.sha256,
		rootHandleSha256: handleWrite.sha256,
	};
	const heldWrite = await writeDurableExclusiveJson(join(outputDir, "held-verification.json"), held);
	const release = {
		protocol: COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL,
		qualificationProtocol: intent.qualificationProtocol,
		qualificationId: QUALIFICATION_ID,
		rootJobId: ROOT_ID,
		jobName: JOB_NAME,
		workDir: WORK_DIR,
		identityComment: IDENTITY_COMMENT,
		recordedAt: "2026-08-28T00:00:03.000Z",
		dispatchIntentSha256: intentWrite.sha256,
		rootHandleSha256: handleWrite.sha256,
		heldVerificationSha256: wrongLink === "release" ? HASH_A : heldWrite.sha256,
	};
	const releaseWrite = await writeDurableExclusiveJson(join(outputDir, "root-release-intent.json"), release);
	const ready = {
		protocol: COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL,
		qualificationProtocol: intent.qualificationProtocol,
		qualificationId: QUALIFICATION_ID,
		rootJobId: ROOT_ID,
		jobName: JOB_NAME,
		workDir: WORK_DIR,
		identityComment: IDENTITY_COMMENT,
		validatedAt: "2026-08-28T00:00:04.000Z",
		dispatchIntentSha256: intentWrite.sha256,
		rootHandleSha256: handleWrite.sha256,
		heldVerificationSha256: heldWrite.sha256,
		rootReleaseIntentSha256: wrongLink === "ready" ? HASH_B : releaseWrite.sha256,
	};
	await writeDurableExclusiveJson(join(outputDir, "root-ready.json"), ready);
}

describe("CompilerGym job-step durable cleanup recovery", () => {
	it("atomically publishes a private owner claim and refuses a second claim", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-claim-"));
		const output = join(root, "execution-v1");
		try {
			const claim = await claimSealedCompilerGymJobStepOutput({
				path: output,
				qualificationId: QUALIFICATION_ID,
				hostname: "test-host",
				pid: 12345,
				startedAt: "2026-08-28T00:00:00.000Z",
			});
			assert.equal(claim.owner.outputDir, output);
			assert.equal(sha256Text(await readFile(join(output, "run-owner.json"), "utf8")), claim.ownerSha256);
			assert.equal((await stat(join(output, "run-owner.json"))).mode & 0o777, 0o400);
			assert.deepEqual(await readdir(root), ["execution-v1"]);
			assert.deepEqual(await readdir(output), ["run-owner.json"]);
			await assert.rejects(
				claimSealedCompilerGymJobStepOutput({
					path: output,
					qualificationId: QUALIFICATION_ID,
					hostname: "test-host",
					pid: 12346,
					startedAt: "2026-08-28T00:00:01.000Z",
				}),
				/already claimed/,
			);
			const controlPath = join(output, "dispatch-intent.json");
			await writeDurableExclusiveJson(controlPath, dispatchIntent());
			assert.equal((await stat(controlPath)).mode & 0o777, 0o400);
			await assert.rejects(writeDurableExclusiveJson(controlPath, dispatchIntent()), /EEXIST/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("allows exactly one concurrent atomic directory claim", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-concurrent-claim-"));
		const output = join(root, "execution-v1");
		try {
			const claims = await Promise.allSettled(
				[12345, 12346].map((pid) =>
					claimSealedCompilerGymJobStepOutput({
						path: output,
						qualificationId: QUALIFICATION_ID,
						hostname: "test-host",
						pid,
						startedAt: "2026-08-28T00:00:00.000Z",
					}),
				),
			);
			assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
			assert.equal(claims.filter((claim) => claim.status === "rejected").length, 1);
			assert.deepEqual(await readdir(output), ["run-owner.json"]);
			assert.equal((await stat(join(output, "run-owner.json"))).mode & 0o777, 0o400);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("terminalizes an ownerless atomic claim as a no-dispatch crash", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-ownerless-claim-"));
		const output = join(root, "execution-v1");
		try {
			await mkdir(output, { mode: 0o700 });
			await assert.rejects(
				claimSealedCompilerGymJobStepOutput({
					path: output,
					qualificationId: QUALIFICATION_ID,
					hostname: "test-host",
					pid: 12345,
					startedAt: "2026-08-28T00:00:00.000Z",
				}),
				/already claimed/,
			);
			const rendered: string[] = [];
			await runCleanupRecovery(sealed(output), { writeOutput: (contents) => rendered.push(contents) });
			const recoveryContents = await readFile(join(output, "cleanup-recovery-result-1.json"), "utf8");
			const record = parseCompilerGymJobStepCleanupRecoveryRecord(recoveryContents);
			assert.equal(record.status, "no-dispatch-intent");
			assert.deepEqual(record.commands, []);
			assert.deepEqual(rendered, [recoveryContents]);
			assert.equal((await stat(join(output, "run-owner.json"))).mode & 0o777, 0o400);
			assert.equal((await stat(join(output, "cleanup-recovery-lease-1.json"))).mode & 0o777, 0o400);
			assert.equal((await stat(join(output, "cleanup-recovery-transition-1.json"))).mode & 0o777, 0o400);
			assert.equal((await stat(join(output, "cleanup-recovery-result-1.json"))).mode & 0o777, 0o400);
			assert.ok(!(await readdir(output)).includes("dispatch-intent.json"));
			await runCleanupRecovery(sealed(output), { writeOutput: () => undefined });
			await assert.rejects(
				claimSealedCompilerGymJobStepOutput({
					path: output,
					qualificationId: QUALIFICATION_ID,
					hostname: "test-host",
					pid: 12345,
					startedAt: "2026-08-28T00:00:00.000Z",
				}),
				/already claimed/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("leases dead-owner recovery so only one concurrent process reaches the scheduler", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-recovery-lease-"));
		const output = join(root, "execution-v1");
		const scheduler = new BarrierRecoveryScheduler([ROOT_ID]);
		try {
			await writeIntentAndOptionalHandle(output, false);
			const clock = new FauxRecoveryClock();
			const options = {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: { commandRunner: scheduler, clock },
			};
			const attempts = [runCleanupRecovery(sealed(output), options), runCleanupRecovery(sealed(output), options)];
			const settledAttempts = Promise.allSettled(attempts);
			await scheduler.waitForFirstRemote();
			for (let index = 0; index < 10; index += 1) await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(scheduler.waitingRemoteCalls, 1, "Concurrent recovery bypassed the durable lease");
			scheduler.release();
			const settled = await settledAttempts;
			assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
			assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
			const entries = await readdir(output);
			assert.ok(entries.includes("cleanup-recovery-lease-1.json"));
			assert.ok(entries.includes("cleanup-recovery-transition-1.json"));
			assert.ok(entries.includes("cleanup-recovery-result-1.json"));
			assert.ok(!entries.includes("cleanup-recovery-lease-2.json"));
			assert.equal(
				parseCompilerGymJobStepCleanupRecoveryRecord(
					await readFile(join(output, "cleanup-recovery-result-1.json"), "utf8"),
				).status,
				"cleanup-complete",
			);
		} finally {
			scheduler.release();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("arbitrates completion against stale takeover on one generation transition slot", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-recovery-completion-race-"));
		const output = join(root, "execution-v1");
		try {
			const controls = await writeIntentAndOptionalHandle(output, false);
			const leasePid = 12345;
			const leaseSha256 = await writeRecoveryLease(output, controls.ownerSha256, leasePid);
			const producerClock = new FauxRecoveryClock();
			const producerResult = await recovery(
				new FauxRecoveryScheduler([ROOT_ID], { nowMs: () => producerClock.elapsedMs() }),
				producerClock,
			).recover(
				{
					qualificationId: QUALIFICATION_ID,
					dispatchIntent: controls.intent,
					dispatchIntentSha256: controls.intentSha256,
					rootHandle: null,
					rootHandleSha256: null,
					heldVerification: null,
					heldVerificationSha256: null,
					rootReleaseIntentSha256: null,
					rootReadySha256: null,
					recoveryLeaseSha256: leaseSha256,
					ledgerSnapshot: { present: false, bytes: 0, sha256: null },
				},
				new AbortController().signal,
			);
			let releaseObservation: () => void = () => undefined;
			const observationReleased = new Promise<void>((resolve) => {
				releaseObservation = resolve;
			});
			let observedActive: () => void = () => undefined;
			const activeObserved = new Promise<void>((resolve) => {
				observedActive = resolve;
			});
			let leaseOwnerAlive = true;
			let contenderRemoteCalls = 0;
			const contenderScheduler: CompilerGymWarmCommandRunner = {
				async run(): Promise<CompilerGymWarmCommandResult> {
					contenderRemoteCalls += 1;
					throw new Error("Completion-race loser must not reach the scheduler");
				},
			};
			const contender = runCleanupRecovery(sealed(output), {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: { commandRunner: contenderScheduler, clock: new FauxRecoveryClock() },
				recoveryLeaseDependencies: {
					currentHostname: hostname(),
					isProcessAlive: (pid) => pid === leasePid && leaseOwnerAlive,
					async afterActiveLeaseObserved(): Promise<void> {
						observedActive();
						await observationReleased;
					},
				},
			});
			await activeObserved;
			await publishRecoveryFixture(output, producerResult);
			leaseOwnerAlive = false;
			releaseObservation();
			await contender;

			assert.equal(contenderRemoteCalls, 0);
			const entries = await readdir(output);
			assert.ok(entries.includes("cleanup-recovery-lease-1.json"));
			assert.ok(entries.includes("cleanup-recovery-transition-1.json"));
			assert.ok(entries.includes("cleanup-recovery-result-1.json"));
			assert.ok(!entries.includes("cleanup-recovery-lease-2.json"));
			await runCleanupRecovery(sealed(output), {
				writeOutput: () => undefined,
				recoveryDependencies: { commandRunner: contenderScheduler, clock: new FauxRecoveryClock() },
			});
			assert.equal(contenderRemoteCalls, 0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps a delayed stale contender from touching its successor generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-recovery-generation-aba-"));
		const output = join(root, "execution-v1");
		const successorScheduler = new BarrierRecoveryScheduler([ROOT_ID]);
		try {
			const controls = await writeIntentAndOptionalHandle(output, false);
			await writeRecoveryLease(output, controls.ownerSha256, 2_147_483_647);
			let releaseContender: () => void = () => undefined;
			const contenderReleased = new Promise<void>((resolve) => {
				releaseContender = resolve;
			});
			let contenderObserved: () => void = () => undefined;
			const activeObserved = new Promise<void>((resolve) => {
				contenderObserved = resolve;
			});
			let contenderRemoteCalls = 0;
			const contenderScheduler: CompilerGymWarmCommandRunner = {
				async run(): Promise<CompilerGymWarmCommandResult> {
					contenderRemoteCalls += 1;
					throw new Error("Delayed contender must not reach the scheduler");
				},
			};
			const contender = runCleanupRecovery(sealed(output), {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: { commandRunner: contenderScheduler, clock: new FauxRecoveryClock() },
				recoveryLeaseDependencies: {
					currentHostname: hostname(),
					isProcessAlive: (pid) => pid === process.pid,
					async afterActiveLeaseObserved(lease): Promise<void> {
						if (lease.generation !== "1") return;
						contenderObserved();
						await contenderReleased;
					},
				},
			});
			const contenderSettled = Promise.allSettled([contender]);
			await activeObserved;

			const successorClock = new FauxRecoveryClock();
			const successor = runCleanupRecovery(sealed(output), {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: { commandRunner: successorScheduler, clock: successorClock },
			});
			await successorScheduler.waitForFirstRemote();
			const successorLeaseBefore = await readFile(join(output, "cleanup-recovery-lease-2.json"), "utf8");
			releaseContender();
			const [contenderResult] = await contenderSettled;
			assert.equal(contenderResult?.status, "rejected");
			assert.match(String(contenderResult?.reason), /owner PID .* is alive/);
			assert.equal(contenderRemoteCalls, 0);
			assert.equal(await readFile(join(output, "cleanup-recovery-lease-2.json"), "utf8"), successorLeaseBefore);

			successorScheduler.release();
			await successor;
			const entries = await readdir(output);
			assert.ok(entries.includes("cleanup-recovery-transition-1.json"));
			assert.ok(entries.includes("cleanup-recovery-transition-2.json"));
			assert.ok(entries.includes("cleanup-recovery-result-2.json"));
		} finally {
			successorScheduler.release();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("takes over a stale cleanup lease with a new append-only generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-stale-recovery-lease-"));
		const output = join(root, "execution-v1");
		try {
			const controls = await writeIntentAndOptionalHandle(output, false);
			const staleLeaseSha256 = await writeRecoveryLease(output, controls.ownerSha256, 2_147_483_647);
			const orphanClock = new FauxRecoveryClock();
			const orphanResult = await recovery(
				new FauxRecoveryScheduler([ROOT_ID], { nowMs: () => orphanClock.elapsedMs() }),
				orphanClock,
			).recover(
				{
					qualificationId: QUALIFICATION_ID,
					dispatchIntent: controls.intent,
					dispatchIntentSha256: controls.intentSha256,
					rootHandle: null,
					rootHandleSha256: null,
					heldVerification: null,
					heldVerificationSha256: null,
					rootReleaseIntentSha256: null,
					rootReadySha256: null,
					recoveryLeaseSha256: staleLeaseSha256,
					ledgerSnapshot: { present: false, bytes: 0, sha256: null },
				},
				new AbortController().signal,
			);
			await writeDurableExclusiveJson(join(output, "cleanup-recovery-result-1.json"), orphanResult);
			const clock = new FauxRecoveryClock();
			const scheduler = new FauxRecoveryScheduler([ROOT_ID], { nowMs: () => clock.elapsedMs() });
			await runCleanupRecovery(sealed(output), {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: { commandRunner: scheduler, clock },
			});

			const leaseNames = (await readdir(output)).filter(
				(name) => name.startsWith("cleanup-recovery-lease-") || name.startsWith("cleanup-recovery-transition-"),
			);
			assert.deepEqual(leaseNames.sort(), [
				"cleanup-recovery-lease-1.json",
				"cleanup-recovery-lease-2.json",
				"cleanup-recovery-transition-1.json",
				"cleanup-recovery-transition-2.json",
			]);
			const activeLeaseContents = await readFile(join(output, "cleanup-recovery-lease-2.json"), "utf8");
			const completed = parseCompilerGymJobStepCleanupRecoveryRecord(
				await readFile(join(output, "cleanup-recovery-result-2.json"), "utf8"),
			);
			assert.equal(completed.status, "cleanup-complete");
			assert.equal(completed.recoveryLeaseSha256, sha256Text(activeLeaseContents));
			assert.notEqual(completed.recoveryLeaseSha256, staleLeaseSha256);
			assert.equal(
				parseCompilerGymJobStepCleanupRecoveryRecord(
					await readFile(join(output, "cleanup-recovery-result-1.json"), "utf8"),
				).recoveryLeaseSha256,
				staleLeaseSha256,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resumes after a crash between stale transition and successor acquisition", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-stale-archive-gap-"));
		const output = join(root, "execution-v1");
		try {
			const controls = await writeIntentAndOptionalHandle(output, false);
			await writeRecoveryLease(output, controls.ownerSha256, 2_147_483_647);
			await writeRecoveryTransition(output, "1", "stale");
			const clock = new FauxRecoveryClock();
			await runCleanupRecovery(sealed(output), {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: {
					commandRunner: new FauxRecoveryScheduler([ROOT_ID], { nowMs: () => clock.elapsedMs() }),
					clock,
				},
			});
			const entries = await readdir(output);
			assert.ok(entries.includes("cleanup-recovery-lease-1.json"));
			assert.ok(entries.includes("cleanup-recovery-transition-1.json"));
			assert.ok(entries.includes("cleanup-recovery-lease-2.json"));
			assert.ok(entries.includes("cleanup-recovery-transition-2.json"));
			assert.ok(entries.includes("cleanup-recovery-result-2.json"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects successor-after-complete and noncontiguous cleanup lease states", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-invalid-recovery-cas-"));
		try {
			const completedOutput = join(root, "completed-with-successor");
			const completedControls = await writeIntentAndOptionalHandle(completedOutput, false);
			const completedClock = new FauxRecoveryClock();
			await runCleanupRecovery(sealed(completedOutput), {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: {
					commandRunner: new FauxRecoveryScheduler([ROOT_ID], { nowMs: () => completedClock.elapsedMs() }),
					clock: completedClock,
				},
			});
			await writeRecoveryLease(completedOutput, completedControls.ownerSha256, 2_147_483_647, "2");
			await assert.rejects(
				runCleanupRecovery(sealed(completedOutput), { writeOutput: () => undefined }),
				/completed cleanup recovery transition has a successor lease/i,
			);

			const gapOutput = join(root, "generation-gap");
			const gapControls = await writeIntentAndOptionalHandle(gapOutput, false);
			await writeRecoveryLease(gapOutput, gapControls.ownerSha256, 2_147_483_647, "2");
			await assert.rejects(
				runCleanupRecovery(sealed(gapOutput), { writeOutput: () => undefined }),
				/Cleanup recovery lease chain is not contiguous/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("guards live and cross-host owners before recovery", () => {
		const owner = {
			protocol: "compiler-gym-job-step-run-owner-v1" as const,
			qualificationId: QUALIFICATION_ID,
			outputDir: "/tmp/output",
			hostname: "test-host",
			pid: 12345,
			startedAt: "2026-08-28T00:00:00.000Z",
		};
		assert.throws(
			() => assertCompilerGymJobStepClaimOwnerInactive(owner, { currentHostname: "other-host" }),
			/across hosts/,
		);
		assert.throws(
			() =>
				assertCompilerGymJobStepClaimOwnerInactive(owner, {
					currentHostname: "test-host",
					isProcessAlive: () => true,
				}),
			/owner PID 12345 is alive/,
		);
		assert.doesNotThrow(() =>
			assertCompilerGymJobStepClaimOwnerInactive(owner, {
				currentHostname: "test-host",
				isProcessAlive: () => false,
			}),
		);
	});

	it("keeps signal guards installed across repeated signals and permits independent cleanup", async () => {
		const baseline = process.listenerCount("SIGINT");
		const termination = createCompilerGymJobStepTerminationController();
		try {
			assert.equal(process.listenerCount("SIGINT"), baseline + 1);
			process.emit("SIGINT", "SIGINT");
			assert.equal(termination.signal.aborted, true);
			assert.match(String(termination.signal.reason), /SIGINT/);
			process.emit("SIGINT", "SIGINT");
			assert.equal(process.listenerCount("SIGINT"), baseline + 1);
			const scheduler: CompilerGymWarmCommandRunner = {
				async run(): Promise<CompilerGymWarmCommandResult> {
					throw new Error("Independent no-intent cleanup must remain local");
				},
			};
			const result = await recovery(scheduler).recover(
				{
					qualificationId: QUALIFICATION_ID,
					dispatchIntent: null,
					dispatchIntentSha256: null,
					rootHandle: null,
					rootHandleSha256: null,
					heldVerification: null,
					heldVerificationSha256: null,
					rootReleaseIntentSha256: null,
					rootReadySha256: null,
					recoveryLeaseSha256: HASH_A,
					ledgerSnapshot: { present: false, bytes: 0, sha256: null },
				},
				new AbortController().signal,
			);
			assert.equal(result.status, "no-dispatch-intent");
		} finally {
			termination.dispose();
		}
		assert.equal(process.listenerCount("SIGINT"), baseline);
	});

	it("pins the just-in-time environment probe and required Slurm capabilities", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-preflight-pin-"));
		try {
			const probePath = join(root, "probe.py");
			const source = "print('sealed')\n";
			await writeFile(probePath, source, { mode: 0o600 });
			assert.equal(await readVerifiedCompilerGymJobStepEnvProbeSource(probePath, sha256Text(source)), source);
			await writeFile(probePath, "print('drifted')\n", { mode: 0o600 });
			await assert.rejects(
				readVerifiedCompilerGymJobStepEnvProbeSource(probePath, sha256Text(source)),
				/Environment probe drifted/,
			);
			const capabilities = {
				srun: "--jobid --exact --kill-on-bad-exit --label --export",
				sbatch: "--deadline --no-requeue --hold --comment",
				scontrol: "write batch_script",
			};
			assert.doesNotThrow(() => assertCompilerGymJobStepDispatchCapabilities(capabilities));
			assert.throws(
				() => assertCompilerGymJobStepDispatchCapabilities({ ...capabilities, sbatch: "--deadline --no-requeue" }),
				/FarmShare sbatch lacks --hold/,
			);
			assert.throws(
				() => assertCompilerGymJobStepDispatchCapabilities({ ...capabilities, scontrol: "" }),
				/FarmShare scontrol lacks write batch_script/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("hashes a partial ledger without parsing it", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-ledger-"));
		try {
			const path = join(root, "evidence.jsonl");
			await writeFile(path, '{"partial":', { mode: 0o600 });
			assert.deepEqual(await captureCompilerGymJobStepLedgerSnapshot(path), {
				present: true,
				bytes: 11,
				sha256: sha256Text('{"partial":'),
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses to follow a ledger symlink", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-ledger-symlink-"));
		try {
			const target = join(root, "target.jsonl");
			const path = join(root, "evidence.jsonl");
			await writeFile(target, "{}\n", { mode: 0o600 });
			await symlink(target, path);
			await assert.rejects(captureCompilerGymJobStepLedgerSnapshot(path), /ELOOP|symbolic link/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("refuses symlinked owner and dispatch controls", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-control-symlink-"));
		try {
			const ownerOutput = join(root, "owner-output");
			await mkdir(ownerOutput, { mode: 0o700 });
			const ownerTarget = join(root, "owner-target.json");
			await writeFile(
				ownerTarget,
				canonicalLine({
					protocol: "compiler-gym-job-step-run-owner-v1",
					qualificationId: QUALIFICATION_ID,
					outputDir: ownerOutput,
					hostname: hostname(),
					pid: process.pid,
					startedAt: "2026-08-28T00:00:00.000Z",
				}),
				{ mode: 0o400 },
			);
			await symlink(ownerTarget, join(ownerOutput, "run-owner.json"));
			await assert.rejects(
				runCleanupRecovery(sealed(ownerOutput), { writeOutput: () => undefined }),
				/ELOOP|symbolic link/,
			);

			const dispatchOutput = join(root, "dispatch-output");
			const claim = await claimSealedCompilerGymJobStepOutput({
				path: dispatchOutput,
				qualificationId: QUALIFICATION_ID,
				hostname: hostname(),
				pid: process.pid,
				startedAt: "2026-08-28T00:00:00.000Z",
			});
			const dispatchTarget = join(root, "dispatch-target.json");
			await writeFile(dispatchTarget, canonicalLine({ ...dispatchIntent(), claimOwnerSha256: claim.ownerSha256 }), {
				mode: 0o400,
			});
			await symlink(dispatchTarget, join(dispatchOutput, "dispatch-intent.json"));
			await assert.rejects(
				runCleanupRecovery(sealed(dispatchOutput), { writeOutput: () => undefined }),
				/ELOOP|symbolic link/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects release and ready predecessor-hash drift before recovery", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-control-chain-"));
		try {
			for (const wrongLink of ["release", "ready"] as const) {
				const output = join(root, wrongLink);
				await writeInvalidControlChain(output, wrongLink);
				await assert.rejects(
					runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
					wrongLink === "release" ? /release-intent predecessor hash drifted/ : /ready predecessor hash drifted/,
				);
				assert.ok(!(await readdir(output)).includes("cleanup-recovery-lease-1.json"));
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a cached cleanup that omits its durable handled root", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-forged-cache-"));
		const output = join(root, "execution-v1");
		try {
			const controls = await writeIntentAndOptionalHandle(output, true);
			const leaseSha256 = await writeRecoveryLease(output, controls.ownerSha256);
			const forged = {
				protocol: "compiler-gym-job-step-cleanup-recovery-v1",
				status: "cleanup-complete",
				qualificationId: QUALIFICATION_ID,
				recoveredAt: "2026-08-28T00:00:05.000Z",
				cleanupOnly: true,
				dispatchIntentSha256: controls.intentSha256,
				rootHandleSha256: controls.handleSha256,
				heldVerificationSha256: null,
				rootReleaseIntentSha256: null,
				rootReadySha256: null,
				recoveryLeaseSha256: leaseSha256,
				ledgerSnapshot: { present: false, bytes: 0, sha256: null },
				discoveredRootIds: [],
				cancelledRootIds: [],
				terminalAccounting: [],
				budgetInvalid: false,
				schedulerAbsent: true,
				commands: [
					commandEvidence(0, "recovery-squeue-identity", [
						"/usr/bin/squeue",
						"--noheader",
						"--user",
						"duynguy",
						"--name",
						JOB_NAME,
						"--format=%A|%u|%j|%Z|%k|%T",
					]),
					commandEvidence(1, "recovery-sacct-identity", [
						"/usr/bin/sacct",
						"--noheader",
						"-X",
						"--user",
						"duynguy",
						"--name",
						JOB_NAME,
						"--starttime",
						"now-1days",
						"--format=JobIDRaw,User,JobName,WorkDir,Comment,State",
						"--parsable2",
					]),
				],
			};
			await publishRecoveryFixture(output, forged);
			await assert.rejects(
				runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
				/omitted its durable root handle/,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("binds cached single-root accounting identity to the durable dispatch intent", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-cached-identity-"));
		const output = join(root, "execution-v1");
		const recoveryPath = join(output, "cleanup-recovery-result-1.json");
		try {
			await writeIntentAndOptionalHandle(output, true);
			await runCleanupRecovery(sealed(output), {
				writeOutput: () => undefined,
				recoveryConfig: recoveryConfig(),
				recoveryDependencies: {
					commandRunner: new FauxRecoveryScheduler([ROOT_ID]),
					clock: new FauxRecoveryClock(),
				},
			});
			const genuine = parseCompilerGymJobStepCleanupRecoveryRecord(await readFile(recoveryPath, "utf8"));
			const replaceCachedRecovery = async (record: typeof genuine): Promise<void> => {
				await rm(recoveryPath);
				const write = await writeDurableExclusiveJson(recoveryPath, record);
				await rm(join(output, "cleanup-recovery-transition-1.json"));
				await writeRecoveryTransition(output, "1", "complete", write.sha256);
			};
			const finalAccounting = (record: typeof genuine) => {
				const command = record.commands.at(-1);
				if (!command || command.label !== "recovery-sacct-identity") {
					throw new Error("Fixture lacks final accounting identity evidence");
				}
				return command;
			};
			const finalQueue = (record: typeof genuine) => {
				const command = record.commands.at(-2);
				if (!command || command.label !== "recovery-squeue-identity") {
					throw new Error("Fixture lacks final queue identity evidence");
				}
				return command;
			};
			const wrongHandledRoot = structuredClone(genuine);
			wrongHandledRoot.discoveredRootIds = [SECOND_ROOT_ID];
			wrongHandledRoot.cancelledRootIds = [SECOND_ROOT_ID];
			if (!wrongHandledRoot.terminalAccounting[0]) throw new Error("Fixture lacks terminal accounting");
			wrongHandledRoot.terminalAccounting[0].rootJobId = SECOND_ROOT_ID;
			for (const command of wrongHandledRoot.commands) {
				command.remoteArgv = command.remoteArgv.map((value) => (value === ROOT_ID ? SECOND_ROOT_ID : value));
				command.stdout = command.stdout.replaceAll(ROOT_ID, SECOND_ROOT_ID);
				command.stdoutSha256 = sha256Text(command.stdout);
			}
			await replaceCachedRecovery(wrongHandledRoot);
			await assert.rejects(
				runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
				/omitted the durable root handle/,
			);

			const jobDrift = structuredClone(genuine);
			if (!jobDrift.terminalAccounting[0]) throw new Error("Fixture lacks terminal accounting");
			jobDrift.terminalAccounting[0].jobName = `${JOB_NAME}-drift`;
			for (const command of jobDrift.commands.filter((value) => value.label === "recovery-sacct-root")) {
				command.stdout = command.stdout.replace(JOB_NAME, `${JOB_NAME}-drift`);
				command.stdoutSha256 = sha256Text(command.stdout);
			}
			const jobEvidence = finalAccounting(jobDrift);
			jobEvidence.stdout = jobEvidence.stdout.replace(JOB_NAME, `${JOB_NAME}-drift`);
			jobEvidence.stdoutSha256 = sha256Text(jobEvidence.stdout);
			await replaceCachedRecovery(jobDrift);
			await assert.rejects(
				runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
				/accounting job name drifted from dispatch intent/,
			);

			const commentDrift = structuredClone(genuine);
			if (!commentDrift.terminalAccounting[0]) throw new Error("Fixture lacks terminal accounting");
			const changedComment = `pa-c1-${"f".repeat(40)}`;
			commentDrift.terminalAccounting[0].identityComment = changedComment;
			for (const command of commentDrift.commands.filter((value) => value.label === "recovery-sacct-root")) {
				command.stdout = command.stdout.replace(IDENTITY_COMMENT, changedComment);
				command.stdoutSha256 = sha256Text(command.stdout);
			}
			const commentEvidence = finalAccounting(commentDrift);
			commentEvidence.stdout = commentEvidence.stdout.replace(IDENTITY_COMMENT, changedComment);
			commentEvidence.stdoutSha256 = sha256Text(commentEvidence.stdout);
			await replaceCachedRecovery(commentDrift);
			await assert.rejects(
				runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
				/accounting comment drifted from dispatch intent/,
			);

			const userArgvDrift = structuredClone(genuine);
			finalQueue(userArgvDrift).remoteArgv[3] = "otheruser";
			await replaceCachedRecovery(userArgvDrift);
			await assert.rejects(
				runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
				/final squeue argv drifted/,
			);

			const jobArgvDrift = structuredClone(genuine);
			finalAccounting(jobArgvDrift).remoteArgv[6] = "other-job";
			await replaceCachedRecovery(jobArgvDrift);
			await assert.rejects(
				runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
				/final sacct argv drifted/,
			);

			for (const [field, value] of [
				["exitCode", "0:16"],
				["startAt", "2026-08-28T00:00:02"],
				["endAt", "2026-08-28T00:00:03"],
			] as const) {
				const accountingDrift = structuredClone(genuine);
				const accounting = accountingDrift.terminalAccounting[0];
				if (!accounting) throw new Error("Fixture lacks terminal accounting");
				accounting[field] = value;
				await replaceCachedRecovery(accountingDrift);
				await assert.rejects(
					runCleanupRecovery(sealed(output), { writeOutput: () => undefined }),
					/terminal accounting evidence drifted/,
				);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("round-trips and rejects executable-path dispatch intents", () => {
		const intent = dispatchIntent();
		const contents = `${canonicalJson(toJsonValue(intent))}\n`;
		assert.deepEqual(parseCompilerGymJobStepDispatchIntentRecord(contents), intent);
		const pathIntent = { ...intent, sbatchArgv: [...intent.sbatchArgv, "/tmp/root.sh"] };
		pathIntent.sbatchArgvSha256 = sha256Json(pathIntent.sbatchArgv);
		assert.throws(
			() => parseCompilerGymJobStepDispatchIntentRecord(`${canonicalJson(toJsonValue(pathIntent))}\n`),
			/names a script path/,
		);
	});

	it("deep-validates held, release-intent, and ready control records", () => {
		const input = recoveryInput(ROOT_ID);
		assert.ok(input.rootHandle);
		assert.ok(input.rootHandleSha256);
		const held = {
			protocol: COMPILER_GYM_JOB_STEP_HELD_VERIFICATION_PROTOCOL,
			qualificationProtocol: input.dispatchIntent?.qualificationProtocol ?? "",
			qualificationId: QUALIFICATION_ID,
			rootJobId: ROOT_ID,
			jobName: JOB_NAME,
			workDir: WORK_DIR,
			identityComment: IDENTITY_COMMENT,
			rootScriptSha256: ROOT_SCRIPT_SHA256,
			spooledScriptSha256: ROOT_SCRIPT_SHA256,
			heldIdentity: {
				batchFlag: 1 as const,
				priority: 0 as const,
				reason: "JobHeldUser" as const,
				state: "PENDING" as const,
			},
			verifiedAt: "2026-08-28T00:00:02.000Z",
			dispatchIntentSha256: input.dispatchIntentSha256 ?? "",
			rootHandleSha256: input.rootHandleSha256,
		};
		const heldContents = `${canonicalJson(toJsonValue(held))}\n`;
		assert.deepEqual(parseCompilerGymJobStepHeldVerificationRecord(heldContents), held);
		assert.throws(
			() =>
				parseCompilerGymJobStepHeldVerificationRecord(
					`${canonicalJson(toJsonValue({ ...held, heldIdentity: { ...held.heldIdentity, priority: 1 } }))}\n`,
				),
			/Priority drifted/,
		);
		const heldSha256 = sha256Text(heldContents);
		const release = {
			protocol: COMPILER_GYM_JOB_STEP_ROOT_RELEASE_INTENT_PROTOCOL,
			qualificationProtocol: held.qualificationProtocol,
			qualificationId: QUALIFICATION_ID,
			rootJobId: ROOT_ID,
			jobName: JOB_NAME,
			workDir: WORK_DIR,
			identityComment: IDENTITY_COMMENT,
			recordedAt: "2026-08-28T00:00:03.000Z",
			dispatchIntentSha256: held.dispatchIntentSha256,
			rootHandleSha256: held.rootHandleSha256,
			heldVerificationSha256: heldSha256,
		};
		const releaseContents = `${canonicalJson(toJsonValue(release))}\n`;
		assert.deepEqual(parseCompilerGymJobStepRootReleaseIntentRecord(releaseContents), release);
		const ready = {
			protocol: COMPILER_GYM_JOB_STEP_ROOT_READY_PROTOCOL,
			qualificationProtocol: held.qualificationProtocol,
			qualificationId: QUALIFICATION_ID,
			rootJobId: ROOT_ID,
			jobName: JOB_NAME,
			workDir: WORK_DIR,
			identityComment: IDENTITY_COMMENT,
			validatedAt: "2026-08-28T00:00:04.000Z",
			dispatchIntentSha256: held.dispatchIntentSha256,
			rootHandleSha256: held.rootHandleSha256,
			heldVerificationSha256: heldSha256,
			rootReleaseIntentSha256: sha256Text(releaseContents),
		};
		const readyContents = `${canonicalJson(toJsonValue(ready))}\n`;
		assert.deepEqual(parseCompilerGymJobStepRootReadyRecord(readyContents), ready);
		const { rootReleaseIntentSha256: _omitted, ...missingReadyLink } = ready;
		assert.throws(
			() => parseCompilerGymJobStepRootReadyRecord(`${canonicalJson(toJsonValue(missingReadyLink))}\n`),
			/keys mismatch|rootReleaseIntentSha256/,
		);
	});

	it("handles a durable intent with no handle by discovering and cancelling the accepted root", async () => {
		const clock = new FauxRecoveryClock();
		const scheduler = new FauxRecoveryScheduler([ROOT_ID], { nowMs: () => clock.elapsedMs() });
		const result = await recovery(scheduler, clock).recover(recoveryInput(), new AbortController().signal);
		assert.deepEqual(result.discoveredRootIds, [ROOT_ID]);
		assert.deepEqual(result.cancelledRootIds, [ROOT_ID]);
		assert.equal(result.budgetInvalid, false);
		assert.equal(result.terminalAccounting[0]?.state, "CANCELLED");
		assert.ok((scheduler.cancelAtMs[0] ?? -1) >= 5_000, "Recovery cancelled before stable inventory grace");
		assert.ok(clock.elapsedMs() >= 11_000, "Recovery skipped initial or terminal inventory stabilization");
		assert.ok(result.commands.length > 0);
		assert.ok(
			result.commands.every((command) =>
				["/usr/bin/squeue", "/usr/bin/sacct", "/usr/bin/scontrol", "/usr/bin/scancel"].includes(
					command.remoteArgv[0] ?? "",
				),
			),
		);
	});

	it("marks multiple exact roots budget-invalid and cancels every verified match", async () => {
		const scheduler = new FauxRecoveryScheduler([ROOT_ID, SECOND_ROOT_ID]);
		const result = await recovery(scheduler).recover(recoveryInput(ROOT_ID), new AbortController().signal);
		assert.deepEqual(result.discoveredRootIds, [ROOT_ID, SECOND_ROOT_ID]);
		assert.deepEqual(result.cancelledRootIds, [ROOT_ID, SECOND_ROOT_ID]);
		assert.equal(result.budgetInvalid, true);
		assert.equal(result.terminalAccounting.length, 2);
	});

	it("orders root IDs exactly above the JavaScript safe-integer range", async () => {
		const lower = "9007199254740992";
		const higher = "9007199254740993";
		const scheduler = new FauxRecoveryScheduler([higher, lower]);
		const result = await recovery(scheduler).recover(recoveryInput(higher), new AbortController().signal);
		assert.deepEqual(result.discoveredRootIds, [lower, higher]);
		assert.deepEqual(result.cancelledRootIds, [lower, higher]);
		assert.deepEqual(
			result.terminalAccounting.map((accounting) => accounting.rootJobId),
			[lower, higher],
		);
	});

	it("is idempotent after a prior recovery already terminalized the root", async () => {
		const scheduler = new FauxRecoveryScheduler([ROOT_ID], { terminal: true });
		const runner = recovery(scheduler);
		const result = await runner.recover(recoveryInput(ROOT_ID), new AbortController().signal);
		assert.deepEqual(result.discoveredRootIds, [ROOT_ID]);
		assert.deepEqual(result.cancelledRootIds, []);
		assert.equal(result.terminalAccounting[0]?.state, "CANCELLED");
		assert.ok(runner.commandEvidence().every((command) => command.remoteArgv[0] !== "/usr/bin/scancel"));
		assert.ok(
			runner
				.commandEvidence()
				.every((command) => command.remoteArgv[0] !== "/usr/bin/scontrol" || command.remoteArgv[1] !== "write"),
		);
	});

	it("fails closed on mismatched identity without cancelling", async () => {
		const scheduler = new FauxRecoveryScheduler([ROOT_ID], { identityComment: `pa-c1-${"f".repeat(40)}` });
		const runner = recovery(scheduler);
		await assert.rejects(runner.recover(recoveryInput(), new AbortController().signal), /mismatched root identity/);
		assert.ok(runner.commandEvidence().every((command) => command.remoteArgv[0] !== "/usr/bin/scancel"));
	});

	it("fails closed on mismatched scheduler-spooled script without cancelling", async () => {
		const scheduler = new FauxRecoveryScheduler([ROOT_ID], { spool: "#!/bin/sh\necho tampered\n" });
		const runner = recovery(scheduler);
		await assert.rejects(
			runner.recover(recoveryInput(ROOT_ID), new AbortController().signal),
			/mismatched spooled script/,
		);
		assert.ok(runner.commandEvidence().every((command) => command.remoteArgv[0] !== "/usr/bin/scancel"));
	});

	it("fails closed when batch-script retrieval emits stderr", async () => {
		const scheduler = new FauxRecoveryScheduler([ROOT_ID], { spoolStderr: "warning\n" });
		const runner = recovery(scheduler);
		await assert.rejects(
			runner.recover(recoveryInput(ROOT_ID), new AbortController().signal),
			/batch-script retrieval emitted stderr/,
		);
		assert.ok(runner.commandEvidence().every((command) => command.remoteArgv[0] !== "/usr/bin/scancel"));
	});

	it("verifies and cancels a new exact root that appears during final stabilization", async () => {
		const clock = new FauxRecoveryClock();
		const scheduler = new FauxRecoveryScheduler([ROOT_ID], {
			lateRootId: SECOND_ROOT_ID,
			nowMs: () => clock.elapsedMs(),
		});
		const result = await recovery(scheduler, clock).recover(recoveryInput(ROOT_ID), new AbortController().signal);
		assert.deepEqual(result.discoveredRootIds, [ROOT_ID, SECOND_ROOT_ID]);
		assert.deepEqual(result.cancelledRootIds, [ROOT_ID, SECOND_ROOT_ID]);
		assert.equal(result.budgetInvalid, true);
		assert.equal(result.terminalAccounting.length, 2);
		assert.ok(result.terminalAccounting.every((accounting) => accounting.state === "CANCELLED"));
		assert.deepEqual([...scheduler.cancelled], [ROOT_ID, SECOND_ROOT_ID]);
		assert.deepEqual(scheduler.postPrimaryCancellationIdentitySnapshots.slice(0, 2), [
			[ROOT_ID],
			[ROOT_ID, SECOND_ROOT_ID],
		]);
		assert.notEqual(scheduler.lateRootFirstVisibleAtMs, null);
		assert.ok(
			(scheduler.cancelAtMs.at(-1) ?? -1) - (scheduler.lateRootFirstVisibleAtMs ?? 0) >= 5_000,
			"Late-root inventory change did not reset the five-second stabilization interval",
		);
	});

	it("deep-validates completed recovery evidence and rejects nested tampering", async () => {
		const scheduler = new FauxRecoveryScheduler([ROOT_ID]);
		const result = await recovery(scheduler).recover(recoveryInput(ROOT_ID), new AbortController().signal);
		assert.deepEqual(parseCompilerGymJobStepCleanupRecoveryRecord(canonicalLine(result)), result);

		const runningState = structuredClone(result);
		if (!runningState.terminalAccounting[0]) throw new Error("Fixture lacks terminal accounting");
		runningState.terminalAccounting[0].state = "RUNNING";
		assert.throws(() => parseCompilerGymJobStepCleanupRecoveryRecord(canonicalLine(runningState)), /not terminal/);

		const badHash = structuredClone(result);
		if (!badHash.commands[0]) throw new Error("Fixture lacks command evidence");
		badHash.commands[0].stdoutSha256 = HASH_A;
		assert.throws(() => parseCompilerGymJobStepCleanupRecoveryRecord(canonicalLine(badHash)), /strictly equal/);

		const badExit = structuredClone(result);
		if (!badExit.commands[0]) throw new Error("Fixture lacks command evidence");
		badExit.commands[0].exitCode = 1;
		assert.throws(() => parseCompilerGymJobStepCleanupRecoveryRecord(canonicalLine(badExit)), /did not succeed/);

		const forbidden = structuredClone(result);
		if (!forbidden.commands[0]) throw new Error("Fixture lacks command evidence");
		forbidden.commands[0].remoteArgv = ["/usr/bin/sbatch", "--parsable"];
		assert.throws(() => parseCompilerGymJobStepCleanupRecoveryRecord(canonicalLine(forbidden)), /forbidden command/);

		const wrongCancel = structuredClone(result);
		const cancel = wrongCancel.commands.find((command) => command.remoteArgv[0] === "/usr/bin/scancel");
		if (!cancel) throw new Error("Fixture lacks cancellation evidence");
		cancel.remoteArgv[2] = SECOND_ROOT_ID;
		assert.throws(
			() => parseCompilerGymJobStepCleanupRecoveryRecord(canonicalLine(wrongCancel)),
			/targeted an undiscovered root|scancel evidence drifted/,
		);

		const spoolWarning = structuredClone(result);
		const spool = spoolWarning.commands.find(
			(command) => command.remoteArgv[0] === "/usr/bin/scontrol" && command.remoteArgv[1] === "write",
		);
		if (!spool) throw new Error("Fixture lacks spool evidence");
		spool.stderr = "warning\n";
		spool.stderrSha256 = sha256Text(spool.stderr);
		assert.throws(
			() => parseCompilerGymJobStepCleanupRecoveryRecord(canonicalLine(spoolWarning)),
			/batch-script evidence contains stderr/,
		);
	});

	it("performs no remote command when no durable dispatch intent exists", async () => {
		const scheduler: CompilerGymWarmCommandRunner = {
			async run(): Promise<CompilerGymWarmCommandResult> {
				throw new Error("No remote command is allowed before a durable dispatch intent");
			},
		};
		const runner = recovery(scheduler as FauxRecoveryScheduler);
		const result = await runner.recover(
			{
				qualificationId: QUALIFICATION_ID,
				dispatchIntent: null,
				dispatchIntentSha256: null,
				rootHandle: null,
				rootHandleSha256: null,
				heldVerification: null,
				heldVerificationSha256: null,
				rootReleaseIntentSha256: null,
				rootReadySha256: null,
				recoveryLeaseSha256: HASH_A,
				ledgerSnapshot: { present: false, bytes: 0, sha256: null },
			},
			new AbortController().signal,
		);
		assert.equal(result.status, "no-dispatch-intent");
		assert.deepEqual(result.commands, []);
	});
});

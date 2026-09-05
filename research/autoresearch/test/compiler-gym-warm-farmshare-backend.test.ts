import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	CompilerGymWarmAcquisitionError,
	type CompilerGymWarmBackendClock,
	type CompilerGymWarmCommandRequest,
	type CompilerGymWarmCommandResult,
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmLocalFileSystem,
	type CompilerGymWarmRemoteFileSystem,
	compilerGymWarmSshArgv,
	DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG,
	FarmShareCompilerGymWarmBackend,
	type FarmShareCompilerGymWarmBackendConfig,
	SshCompilerGymWarmRemoteFileSystem,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import type {
	CompilerGymWarmPoolExpectation,
	CompilerGymWarmPoolRecord,
	CompilerGymWarmRequestRecord,
	CompilerGymWarmResultRecord,
} from "../src/compiler-gym-warm-transport.js";
import {
	COMPILER_GYM_WARM_CPUS_PER_TASK,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
	COMPILER_GYM_WARM_PROTOCOL,
	COMPILER_GYM_WARM_TASKS,
	compilerGymWarmBranchDigest,
	compilerGymWarmJobName,
	compilerGymWarmPoolDigest,
	compilerGymWarmRequestDigest,
} from "../src/compiler-gym-warm-transport.js";

const SLURM_ID = "4242";
const NOW = "2026-08-28T08:00:00.000Z";
const START_AT = "2026-08-28T07:59:57";
const END_AT = "2026-08-28T08:00:00";
const WORKER_SOURCE = "#!/usr/bin/env python3\nprint('worker fixture')\n";
const EVALUATOR_SOURCE = "#!/usr/bin/env python3\nprint('evaluator fixture')\n";
const WORKER_SHA256 = sha256Text(WORKER_SOURCE);
const EVALUATOR_SHA256 = sha256Text(EVALUATOR_SOURCE);
const ACTIONS = ["-mem2reg", "-gvn"];

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

function expectation(branchId = "farmshare-backend-test"): CompilerGymWarmPoolExpectation {
	const branchDigest = compilerGymWarmBranchDigest(branchId);
	const poolDigest = compilerGymWarmPoolDigest(branchDigest, WORKER_SHA256, EVALUATOR_SHA256);
	return {
		protocol: COMPILER_GYM_WARM_PROTOCOL,
		branchDigest,
		poolDigest,
		jobName: compilerGymWarmJobName(poolDigest),
		workerSha256: WORKER_SHA256,
		evaluatorSha256: EVALUATOR_SHA256,
		launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
	};
}

function request(pool: CompilerGymWarmPoolRecord, sequence = 0): CompilerGymWarmRequestRecord {
	const body = {
		protocol: COMPILER_GYM_WARM_PROTOCOL,
		poolDigest: pool.poolDigest,
		sequence,
		jobId: `job_backend_${sequence}`,
		manifestDigest: sha256Text(`manifest-${sequence}`),
		actionsDigest: sha256Json(ACTIONS),
		actions: ACTIONS,
		tasks: [...COMPILER_GYM_WARM_TASKS] as [string, string],
	};
	return {
		...body,
		requestDigest: compilerGymWarmRequestDigest(body),
		publishedAt: NOW,
	};
}

function result(
	pool: CompilerGymWarmPoolRecord,
	value: CompilerGymWarmRequestRecord,
	rank: 0 | 1,
): CompilerGymWarmResultRecord {
	return {
		protocol: COMPILER_GYM_WARM_PROTOCOL,
		poolDigest: pool.poolDigest,
		sequence: value.sequence,
		jobId: value.jobId,
		requestDigest: value.requestDigest,
		rank,
		benchmarkId: value.tasks[rank],
		slurmId: pool.slurmId,
		workerSha256: pool.workerSha256,
		evaluatorSha256: pool.evaluatorSha256,
		childExitCode: 0,
		stdout: `${JSON.stringify({ ok: true, benchmark: value.tasks[rank] })}\n`,
		stderr: "",
		wallMs: 100 + rank,
		completedAt: NOW,
	};
}

function claim(pool: CompilerGymWarmPoolRecord, value: CompilerGymWarmRequestRecord, rank: 0 | 1): object {
	return {
		protocol: COMPILER_GYM_WARM_PROTOCOL,
		poolDigest: pool.poolDigest,
		sequence: value.sequence,
		jobId: value.jobId,
		requestDigest: value.requestDigest,
		rank,
		benchmarkId: value.tasks[rank],
		slurmId: pool.slurmId,
		workerSha256: pool.workerSha256,
		evaluatorSha256: pool.evaluatorSha256,
	};
}

class FakeClock implements CompilerGymWarmBackendClock {
	sleeps = 0;

	now(): Date {
		return new Date(NOW);
	}

	monotonicMs(): number {
		return this.sleeps;
	}

	async sleep(_ms: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) throw signal.reason;
		this.sleeps++;
		if (this.sleeps > 20) throw new Error("Fake clock exceeded its bounded poll budget");
	}
}

interface FakeFile {
	content: string;
	digest: string;
	mode: number;
}

class FakeRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	readonly directories = new Set<string>();
	readonly files = new Map<string, FakeFile>();
	readonly calls: string[] = [];
	readonly hiddenExistsChecks = new Map<string, number>();
	malformedReady = false;
	shutdownAckVisibilityDelay = 0;
	onPool: ((pool: CompilerGymWarmPoolRecord) => void) | undefined;
	onShutdown: (() => void) | undefined;

	async ensurePrivateDirectory(path: string): Promise<void> {
		this.calls.push(`ensure:${path}:0700`);
		this.directories.add(path);
	}

	async createPrivateDirectory(path: string): Promise<void> {
		this.calls.push(`create:${path}:0700`);
		if (this.directories.has(path)) throw new Error(`exclusive directory exists: ${path}`);
		this.directories.add(path);
	}

	async installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
	): Promise<void> {
		this.calls.push(`install:${path}:${mode.toString(8)}:${allowExistingExact}`);
		assert.equal(sha256Text(content), expectedSha256);
		const existing = this.files.get(path);
		if (existing) {
			if (!allowExistingExact) throw new Error(`immutable file exists: ${path}`);
			assert.deepEqual(existing, { content, digest: expectedSha256, mode });
			return;
		}
		this.files.set(path, { content, digest: expectedSha256, mode });
		if (path.endsWith("/pool.json")) {
			const pool = JSON.parse(content) as CompilerGymWarmPoolRecord;
			for (const rank of [0, 1] as const) {
				const ready = {
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest: this.malformedReady && rank === 1 ? "f".repeat(64) : pool.poolDigest,
					rank,
					slurmId: pool.slurmId,
					cpusPerTask: COMPILER_GYM_WARM_CPUS_PER_TASK,
					workerSha256: pool.workerSha256,
					evaluatorSha256: pool.evaluatorSha256,
					readyAt: NOW,
				};
				this.putRecord(`${pool.workDir}/ready-rank-${rank}.json`, ready);
			}
			this.onPool?.(pool);
		}
		if (path.endsWith("/shutdown.json")) {
			const shutdown = JSON.parse(content) as { poolDigest: string };
			const poolPath = [...this.files.keys()].find((candidate) => candidate.endsWith("/pool.json"));
			assert.ok(poolPath);
			const pool = JSON.parse(this.files.get(poolPath)!.content) as CompilerGymWarmPoolRecord;
			for (const rank of [0, 1] as const) {
				const acknowledgementPath = `${pool.workDir}/shutdown-ack-rank-${rank}.json`;
				this.putRecord(acknowledgementPath, {
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest: shutdown.poolDigest,
					rank,
					slurmId: pool.slurmId,
					acknowledgedAt: NOW,
				});
				if (rank === 0 && this.shutdownAckVisibilityDelay > 0) {
					this.hiddenExistsChecks.set(acknowledgementPath, this.shutdownAckVisibilityDelay);
				}
			}
			this.onShutdown?.();
		}
	}

	async linkImmutableFile(source: string, target: string, expectedSha256: string): Promise<void> {
		this.calls.push(`link:${source}:${target}`);
		const file = this.files.get(source);
		assert.ok(file);
		assert.equal(file.digest, expectedSha256);
		if (this.files.has(target)) throw new Error(`immutable link exists: ${target}`);
		this.files.set(target, { ...file });
	}

	async readTrustedFile(
		path: string,
		options: { maxBytes: number; mode: number; expectedSha256?: string },
	): Promise<string> {
		this.calls.push(`read:${path}:${options.maxBytes}:${options.mode.toString(8)}`);
		const file = this.files.get(path);
		if (!file) throw new Error(`missing trusted file: ${path}`);
		assert.equal(file.mode, options.mode);
		assert.ok(Buffer.byteLength(file.content) <= options.maxBytes);
		if (options.expectedSha256) assert.equal(file.digest, options.expectedSha256);
		return file.content;
	}

	async exists(path: string): Promise<boolean> {
		this.calls.push(`exists:${path}`);
		const hiddenChecks = this.hiddenExistsChecks.get(path) ?? 0;
		if (hiddenChecks > 0) {
			this.hiddenExistsChecks.set(path, hiddenChecks - 1);
			return false;
		}
		return this.files.has(path);
	}

	putRecord(path: string, value: unknown): void {
		const content = canonicalLine(value);
		this.files.set(path, { content, digest: sha256Text(content), mode: 0o600 });
	}
}

class FakeLocalFileSystem implements CompilerGymWarmLocalFileSystem {
	async readUtf8(path: string): Promise<string> {
		if (path.endsWith("worker.py")) return WORKER_SOURCE;
		if (path.endsWith("evaluator.py")) return EVALUATOR_SOURCE;
		throw new Error(`Unexpected local asset ${path}`);
	}
}

interface FakeSchedulerOptions {
	throwAfterSubmit?: boolean;
	cpuTimeRaw?: number;
	allocatedCpus?: number;
	cpusPerTask?: number;
	scancelFails?: boolean;
	sacctDiscoveryFails?: boolean;
}

class FakeSchedulerRunner implements CompilerGymWarmCommandRunner {
	readonly requests: CompilerGymWarmCommandRequest[] = [];
	running = false;
	state = "PENDING";
	jobName = "";
	workDir = "";
	scriptPath = "";
	readonly options: FakeSchedulerOptions;

	constructor(options: FakeSchedulerOptions = {}) {
		this.options = options;
	}

	remoteArgs(request: CompilerGymWarmCommandRequest): string[] {
		assert.equal(request.argv[0], "ssh");
		assert.ok(request.argv.includes("ForwardAgent=no"));
		assert.ok(request.argv.includes("ClearAllForwardings=yes"));
		const command = request.argv.at(-1)!;
		const matches = [...command.matchAll(/'([^']*)'/g)].map((match) => match[1]);
		assert.ok(matches.length > 0, command);
		return matches;
	}

	remoteCommandName(request: CompilerGymWarmCommandRequest): string {
		return this.remoteArgs(request)[0].split("/").at(-1)!;
	}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		this.requests.push(request);
		const args = this.remoteArgs(request);
		const command = args[0].split("/").at(-1)!;
		const ok = (stdout = ""): CompilerGymWarmCommandResult => ({
			exitCode: 0,
			stdout,
			stderr: "",
			wallMs: 1,
		});
		if (command === "sbatch") {
			assert.equal(this.requests.filter((candidate) => this.remoteCommandName(candidate) === "sbatch").length, 1);
			this.jobName = args.find((value) => value.startsWith("--job-name="))!.slice("--job-name=".length);
			this.workDir = args.find((value) => value.startsWith("--chdir="))!.slice("--chdir=".length);
			this.scriptPath = args.at(-1)!;
			this.running = true;
			this.state = "RUNNING";
			if (this.options.throwAfterSubmit) throw new Error("simulated ambiguous ssh disconnect after sbatch");
			return ok(`${SLURM_ID}\n`);
		}
		if (command === "scontrol") {
			if (!this.running && this.state === "PENDING") return { ...ok(), exitCode: 1, stderr: "invalid job id" };
			return ok(
				`JobId=${SLURM_ID} JobName=${this.jobName} UserId=duynguy(1000) JobState=${this.state} Partition=normal Requeue=0 NumNodes=1 NumTasks=2 CPUs/Task=${this.options.cpusPerTask ?? 2} MinMemoryNode=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory} Features=CPU_SKU:9384X Command=${this.scriptPath} WorkDir=${this.workDir}\n`,
			);
		}
		if (command === "squeue") {
			if (args.includes("--name")) {
				if (!this.running) return ok();
				return ok(`${SLURM_ID}|duynguy|${this.jobName}|${this.workDir}|${this.state}\n`);
			}
			return this.running ? ok(`${SLURM_ID}|duynguy|${this.jobName}|${this.workDir}|${this.state}\n`) : ok();
		}
		if (command === "sacct") {
			if (args.includes("--name")) {
				if (this.options.sacctDiscoveryFails && this.running) {
					return { ...ok(), exitCode: 1, stderr: "simulated sacct discovery failure" };
				}
				if (this.state === "PENDING") return ok();
				if (this.running) return ok();
			}
			if (this.running) return ok();
			const allocatedCpus = this.options.allocatedCpus ?? 4;
			return ok(
				`${SLURM_ID}|duynguy|${this.jobName}|${this.workDir}|${this.state}|${this.state === "COMPLETED" ? "0:0" : "0:15"}|${allocatedCpus}|3|${this.options.cpuTimeRaw ?? allocatedCpus * 3}|${START_AT}|${END_AT}\n`,
			);
		}
		if (command === "scancel") {
			assert.deepEqual(args, ["/usr/bin/scancel", "--full", SLURM_ID]);
			if (this.options.scancelFails) return { ...ok(), exitCode: 1, stderr: "simulated scancel failure" };
			this.running = false;
			this.state = "CANCELLED";
			return ok();
		}
		throw new Error(`Unexpected fake scheduler command: ${args.join(" ")}`);
	}
}

function config(): FarmShareCompilerGymWarmBackendConfig {
	return {
		...DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG,
		spoolRoot: "/home/users/duynguy/farmshare-work/backend-test",
		localWorkerPath: "/fixtures/worker.py",
		localEvaluatorPath: "/fixtures/evaluator.py",
		commandTimeoutMs: 1_000,
		readyTimeoutMs: 1_000,
		resultTimeoutMs: 1_000,
		shutdownTimeoutMs: 1_000,
		cleanupTimeoutMs: 1_000,
		dispatchVisibilityGraceMs: 3,
		pollIntervalMs: 1,
	};
}

function harness(options: FakeSchedulerOptions = {}): {
	backend: FarmShareCompilerGymWarmBackend;
	remote: FakeRemoteFileSystem;
	scheduler: FakeSchedulerRunner;
	clock: FakeClock;
} {
	const remote = new FakeRemoteFileSystem();
	const scheduler = new FakeSchedulerRunner(options);
	const clock = new FakeClock();
	remote.onPool = () => {
		scheduler.state = "RUNNING";
	};
	remote.onShutdown = () => {
		scheduler.running = false;
		scheduler.state = "COMPLETED";
	};
	return {
		backend: new FarmShareCompilerGymWarmBackend(config(), {
			commandRunner: scheduler,
			remoteFileSystem: remote,
			localFileSystem: new FakeLocalFileSystem(),
			clock,
		}),
		remote,
		scheduler,
		clock,
	};
}

describe("FarmShare CompilerGym warm backend", () => {
	it("uses a backend-owned private scratch spool instead of the quota-limited shared home tree", () => {
		assert.equal(
			DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG.spoolRoot,
			"/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-warm-v1",
		);
	});

	it("uses one exact sbatch, a content-addressed NFS spool, and clean verified shutdown", async () => {
		const { backend, remote, scheduler } = harness();
		const expected = expectation();
		const acquired = await backend.acquire(expected, new AbortController().signal);
		const pool = acquired.pool as CompilerGymWarmPoolRecord;
		assert.equal(acquired.ready.length, 2);
		assert.equal(pool.workDir, `${config().spoolRoot}/pools/${expected.poolDigest}/${expected.branchDigest}`);
		assert.equal(scheduler.requests.filter((request) => scheduler.remoteCommandName(request) === "sbatch").length, 1);
		const sbatchRequest = scheduler.requests.find((request) => scheduler.remoteCommandName(request) === "sbatch")!;
		const sbatch = scheduler.remoteArgs(sbatchRequest);
		assert.equal(sbatch[0], "/usr/bin/sbatch");
		for (const argument of [
			"--no-requeue",
			"--export=NIL",
			"--partition=normal",
			"--constraint=CPU_SKU:9384X",
			"--nodes=1",
			"--ntasks=2",
			"--cpus-per-task=2",
			`--mem=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory}`,
		]) {
			assert.ok(sbatch.includes(argument), argument);
		}
		const script = remote.files.get(scheduler.scriptPath)?.content;
		assert.ok(script);
		assert.match(script, /exec \/usr\/bin\/srun --ntasks=2 --cpus-per-task=2 --kill-on-bad-exit=1 --exact/);
		assert.match(script, /export PATH=\/usr\/bin:\/bin/);
		assert.match(script, /export SLURM_EXPORT_ENV=NIL/);
		assert.match(script, /\/usr\/bin\/sleep 1/);
		assert.doesNotMatch(script, /SLURM_EXPORT_ENV=NONE|(?<!\/usr\/bin\/)srun|(?<!\/usr\/bin\/)sleep/);
		assert.doesNotMatch(script, /--child-working-directory/);
		assert.match(script, /--compiler-gym-cache/);
		assert.match(script, /--compiler-gym-site-data/);
		assert.match(script, /--ld-library-path/);
		assert.match(script, /--python-warnings/);
		for (const [flag, value] of [
			["--compiler-gym-cache", COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache],
			["--compiler-gym-site-data", COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData],
			["--ld-library-path", COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath],
			["--python-warnings", COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonWarnings],
			["--cpus-per-task", String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpusPerTask)],
			["--poll-seconds", String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.pollSeconds)],
			["--idle-timeout-seconds", String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.idleTimeoutSeconds)],
			["--lease-timeout-seconds", String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.leaseTimeoutSeconds)],
			["--child-timeout-seconds", String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.childTimeoutSeconds)],
			["--child-termination-grace-seconds", String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.childTerminationGraceSeconds)],
			["--max-output-bytes", String(COMPILER_GYM_WARM_LAUNCH_CONTRACT.maxChildOutputBytes)],
		] as const) {
			assert.ok(script.includes(`'${flag}' '${value}'`), `${flag}=${value}`);
		}
		assert.match(script, /exec \/usr\/bin\/env -i/);
		assert.doesNotMatch(script, /spool\/transient|--transient/);
		assert.match(COMPILER_GYM_WARM_LAUNCH_CONTRACT.transientCacheTemplate, /^\/tmp\/prime-autoresearch-/);
		assert.ok(remote.calls.some((call) => call === `create:${pool.workDir}:0700`));
		assert.ok(remote.calls.some((call) => call.endsWith(":700:true") && call.includes("/assets/")));
		assert.ok(remote.calls.some((call) => call.endsWith(":600:false") && call.includes("/pool.json")));

		const evaluationRequest = request(pool);
		await backend.prepareRequest(pool, evaluationRequest, new AbortController().signal);
		await backend.publishRequest(pool, evaluationRequest, new AbortController().signal);
		for (const rank of [0, 1] as const) {
			remote.putRecord(`${pool.workDir}/claim-0000-rank-${rank}.json`, claim(pool, evaluationRequest, rank));
			remote.putRecord(`${pool.workDir}/result-0000-rank-${rank}.json`, result(pool, evaluationRequest, rank));
		}
		const results = await backend.waitForResults(pool, evaluationRequest, new AbortController().signal);
		assert.equal(results.length, 2);
		const closed = (await backend.shutdownAndVerify(pool, new AbortController().signal)) as {
			mode: string;
			schedulerAbsent: boolean;
			accountingState: string;
			acknowledgedRanks: number[];
		};
		assert.deepEqual(closed, {
			mode: "shutdown",
			poolDigest: pool.poolDigest,
			slurmId: SLURM_ID,
			schedulerAbsent: true,
			accountingState: "COMPLETED",
			acknowledgedRanks: [0, 1],
		});
		assert.ok(
			scheduler.requests.some((candidate) => {
				const args = scheduler.remoteArgs(candidate);
				return (
					args[0] === "/usr/bin/sacct" && args.includes("-X") && args.includes("--jobs") && args.includes(SLURM_ID)
				);
			}),
		);
		const timings = backend.acquisitionTimingEvidence();
		assert.equal(timings.length, 1);
		assert.equal(timings[0].poolDigest, pool.poolDigest);
		assert.ok(timings[0].readyMonotonicMs >= timings[0].startedMonotonicMs);
		assert.equal(timings[0].elapsedNs, BigInt(Math.round(timings[0].elapsedMs * 1_000_000)).toString());
		const schedulerEvidence = backend.schedulerEvidence();
		const finalAccounting = [...schedulerEvidence].reverse().find((record) => record.command === "sacct");
		assert.ok(finalAccounting);
		assert.equal(finalAccounting.slurmId, SLURM_ID);
		assert.equal(finalAccounting.stdoutSha256, sha256Text(finalAccounting.stdout));
		assert.equal(finalAccounting.recordSha256.length, 64);
		assert.match(finalAccounting.stdout, new RegExp(`\\|4\\|3\\|12\\|${START_AT}\\|${END_AT}\\n$`));
		assert.ok(finalAccounting.argv.some((argument) => argument.endsWith(",CPUTimeRAW,Start,End")));
		const rootAccounting = backend.rootAccountingEvidence();
		const closedAccounting = rootAccounting.at(-1);
		assert.ok(closedAccounting);
		assert.deepEqual(
			{
				jobIdRaw: closedAccounting.jobIdRaw,
				allocCpus: closedAccounting.allocCpus,
				elapsedRawSeconds: closedAccounting.elapsedRawSeconds,
				cpuTimeRawSeconds: closedAccounting.cpuTimeRawSeconds,
				state: closedAccounting.state,
				exitCode: closedAccounting.exitCode,
				startAt: closedAccounting.startAt,
				endAt: closedAccounting.endAt,
			},
			{
				jobIdRaw: SLURM_ID,
				allocCpus: 4,
				elapsedRawSeconds: 3,
				cpuTimeRawSeconds: 12,
				state: "COMPLETED",
				exitCode: "0:0",
				startAt: START_AT,
				endAt: END_AT,
			},
		);
		assert.equal(closedAccounting.recordSha256.length, 64);
		const acknowledgements = backend.acknowledgementEvidence();
		assert.deepEqual(
			acknowledgements.map((record) => record.rank),
			[0, 1],
		);
		for (const acknowledgement of acknowledgements) {
			assert.equal(acknowledgement.poolDigest, pool.poolDigest);
			assert.equal(acknowledgement.slurmId, SLURM_ID);
			assert.equal(acknowledgement.rawBytes, Buffer.byteLength(acknowledgement.raw));
			assert.equal(acknowledgement.rawSha256, sha256Text(acknowledgement.raw));
			assert.equal(acknowledgement.recordSha256.length, 64);
			assert.match(acknowledgement.path, /shutdown-ack-rank-[01]\.json$/);
		}
	});

	it("refuses a preexisting immutable pool route before scheduler submission", async () => {
		const { backend, remote, scheduler } = harness();
		const expected = expectation("preexisting-route");
		const workDir = `${config().spoolRoot}/pools/${expected.poolDigest}/${expected.branchDigest}`;
		remote.directories.add(workDir);
		const sentinelPath = `${workDir}/pool.json`;
		remote.putRecord(sentinelPath, { immutable: "prior-execution" });
		const sentinel = remote.files.get(sentinelPath);
		await assert.rejects(backend.acquire(expected, new AbortController().signal), (error: unknown) => {
			assert.ok(error instanceof CompilerGymWarmAcquisitionError);
			assert.match(String(error.cause), /exclusive directory exists/);
			assert.equal(error.cleanupProof.submissionAttempted, false);
			assert.equal(error.cleanupProof.action, "not-submitted");
			assert.equal(error.cleanupProof.schedulerAbsent, true);
			return true;
		});
		assert.equal(
			scheduler.requests.filter((candidate) => scheduler.remoteCommandName(candidate) === "sbatch").length,
			0,
		);
		assert.equal(
			scheduler.requests.filter((candidate) => scheduler.remoteCommandName(candidate) === "scancel").length,
			0,
		);
		assert.equal(remote.directories.has(workDir), true);
		assert.deepEqual(remote.files.get(sentinelPath), sentinel);
	});

	it("cancels and attaches typed cleanup proof when ready records are malformed", async () => {
		const { backend, remote, scheduler } = harness();
		remote.malformedReady = true;
		await assert.rejects(
			backend.acquire(expectation("malformed-ready"), new AbortController().signal),
			(error: unknown) => {
				assert.ok(error instanceof CompilerGymWarmAcquisitionError);
				assert.equal(error.cleanupProof.action, "cancelled-and-verified");
				assert.equal(error.cleanupProof.schedulerAbsent, true);
				assert.deepEqual(error.cleanupProof.discoveredSlurmIds, [SLURM_ID]);
				assert.deepEqual(error.cleanupProof.accounting, [
					{
						slurmId: SLURM_ID,
						state: "CANCELLED",
						exitCode: "0:15",
						allocCpus: 4,
						elapsedRaw: 3,
						cpuTimeRaw: 12,
						startAt: START_AT,
						endAt: END_AT,
					},
				]);
				return true;
			},
		);
		assert.equal(scheduler.running, false);
		assert.equal(
			scheduler.requests.filter((candidate) => scheduler.remoteCommandName(candidate) === "scancel").length,
			1,
		);
	});

	it("waits for delayed NFS shutdown acknowledgements after root accounting closes", async () => {
		const { backend, remote, scheduler } = harness();
		remote.shutdownAckVisibilityDelay = 2;
		const acquired = await backend.acquire(expectation("delayed-shutdown-ack"), new AbortController().signal);
		const pool = acquired.pool as CompilerGymWarmPoolRecord;
		const closed = (await backend.shutdownAndVerify(pool, new AbortController().signal)) as { mode: string };
		assert.equal(closed.mode, "shutdown");
		assert.equal(scheduler.running, false);
		assert.equal(
			scheduler.requests.filter((candidate) => scheduler.remoteCommandName(candidate) === "scancel").length,
			0,
		);
	});

	it("cancels an exact owned allocation even when Slurm inflated its resource shape", async () => {
		const { backend, scheduler } = harness({ allocatedCpus: 6, cpusPerTask: 3 });
		await assert.rejects(
			backend.acquire(expectation("inflated-resource-shape"), new AbortController().signal),
			(error: unknown) => {
				assert.ok(error instanceof CompilerGymWarmAcquisitionError);
				assert.match(String(error.cause), /cpusPerTask mismatch/);
				assert.equal(error.cleanupProof.action, "cancelled-and-verified");
				assert.equal(error.cleanupProof.schedulerAbsent, true);
				assert.deepEqual(error.cleanupProof.discoveredSlurmIds, [SLURM_ID]);
				assert.equal(error.cleanupProof.accounting[0]?.allocCpus, 6);
				return true;
			},
		);
		assert.equal(scheduler.running, false);
		assert.equal(
			scheduler.requests.filter((candidate) => scheduler.remoteCommandName(candidate) === "scancel").length,
			1,
		);
	});

	it("discovers and cancels an allocation after an ambiguous sbatch transport failure", async () => {
		const { backend, scheduler } = harness({ throwAfterSubmit: true });
		await assert.rejects(
			backend.acquire(expectation("ambiguous-sbatch"), new AbortController().signal),
			(error: unknown) => {
				assert.ok(error instanceof CompilerGymWarmAcquisitionError);
				assert.equal(error.cleanupProof.submissionAttempted, true);
				assert.equal(error.cleanupProof.action, "cancelled-and-verified");
				assert.equal(error.cleanupProof.schedulerAbsent, true);
				assert.deepEqual(error.cleanupProof.discoveredSlurmIds, [SLURM_ID]);
				return true;
			},
		);
		assert.equal(
			scheduler.requests.filter((candidate) => scheduler.remoteCommandName(candidate) === "sbatch").length,
			1,
		);
		assert.equal(scheduler.running, false);
		assert.equal(
			scheduler.requests.filter((candidate) => {
				const args = scheduler.remoteArgs(candidate);
				return scheduler.remoteCommandName(candidate) === "sacct" && args.includes("--jobs");
			}).length,
			1,
		);
	});

	it("preserves discovered allocation IDs when acquisition cleanup cannot be verified", async () => {
		const { backend, remote, scheduler } = harness({ throwAfterSubmit: true, scancelFails: true });
		await assert.rejects(
			backend.acquire(expectation("ambiguous-cleanup-failure"), new AbortController().signal),
			(error: unknown) => {
				assert.ok(error instanceof CompilerGymWarmAcquisitionError);
				assert.equal(error.cleanupProof.action, "cleanup-unverified");
				assert.equal(error.cleanupProof.schedulerAbsent, false);
				assert.deepEqual(error.cleanupProof.discoveredSlurmIds, [SLURM_ID]);
				assert.deepEqual(error.cleanupProof.accounting, []);
				return true;
			},
		);
		assert.equal(scheduler.running, true);
		assert.equal(
			remote.files.has(`${config().spoolRoot}/index/${expectation("ambiguous-cleanup-failure").poolDigest}.json`),
			false,
		);
	});

	it("cancels an exact queue match even when accounting discovery fails", async () => {
		const { backend, scheduler } = harness({ throwAfterSubmit: true, sacctDiscoveryFails: true });
		await assert.rejects(
			backend.acquire(expectation("queue-only-discovery"), new AbortController().signal),
			(error: unknown) => {
				assert.ok(error instanceof CompilerGymWarmAcquisitionError);
				assert.equal(error.cleanupProof.action, "cancelled-and-verified");
				assert.equal(error.cleanupProof.schedulerAbsent, true);
				assert.deepEqual(error.cleanupProof.discoveredSlurmIds, [SLURM_ID]);
				assert.equal(error.cleanupProof.accounting.length, 1);
				return true;
			},
		);
		assert.equal(scheduler.running, false);
	});

	it("detects a partial-rank result when the exact allocation becomes terminal", async () => {
		const { backend, remote, scheduler } = harness();
		const acquired = await backend.acquire(expectation("rank-loss"), new AbortController().signal);
		const pool = acquired.pool as CompilerGymWarmPoolRecord;
		const evaluationRequest = request(pool);
		await backend.prepareRequest(pool, evaluationRequest, new AbortController().signal);
		await backend.publishRequest(pool, evaluationRequest, new AbortController().signal);
		remote.putRecord(`${pool.workDir}/claim-0000-rank-0.json`, claim(pool, evaluationRequest, 0));
		remote.putRecord(`${pool.workDir}/result-0000-rank-0.json`, result(pool, evaluationRequest, 0));
		scheduler.running = false;
		scheduler.state = "FAILED";
		await assert.rejects(
			backend.waitForResults(pool, evaluationRequest, new AbortController().signal),
			/became FAILED before both results; completed ranks=0; claimed ranks=0/,
		);
	});

	it("recovers a complete request from bounded immutable records without redispatch", async () => {
		const { backend, remote, scheduler, clock } = harness();
		const expected = expectation("recovery");
		const acquired = await backend.acquire(expected, new AbortController().signal);
		const pool = acquired.pool as CompilerGymWarmPoolRecord;
		const evaluationRequest = request(pool);
		await backend.prepareRequest(pool, evaluationRequest, new AbortController().signal);
		await backend.publishRequest(pool, evaluationRequest, new AbortController().signal);
		for (const rank of [0, 1] as const) {
			remote.putRecord(`${pool.workDir}/claim-0000-rank-${rank}.json`, claim(pool, evaluationRequest, rank));
			remote.putRecord(`${pool.workDir}/result-0000-rank-${rank}.json`, result(pool, evaluationRequest, rank));
		}
		const resumed = new FarmShareCompilerGymWarmBackend(config(), {
			commandRunner: scheduler,
			remoteFileSystem: remote,
			localFileSystem: new FakeLocalFileSystem(),
			clock,
		});
		const recovered = await resumed.recover(
			pool.poolDigest,
			pool.slurmId,
			evaluationRequest.requestDigest,
			new AbortController().signal,
		);
		assert.equal(recovered.phase, "complete");
		if (recovered.phase !== "complete") assert.fail("Expected complete recovery");
		assert.equal(recovered.results.length, 2);
		assert.equal(recovered.allocationTerminal, false);
		assert.equal(
			scheduler.requests.filter((candidate) => scheduler.remoteCommandName(candidate) === "sbatch").length,
			1,
		);
	});

	it("rejects root accounting that violates CPUTimeRAW = AllocCPUS * ElapsedRaw", async () => {
		const { backend, scheduler } = harness({ cpuTimeRaw: 13 });
		const acquired = await backend.acquire(expectation("bad-accounting"), new AbortController().signal);
		const pool = acquired.pool as CompilerGymWarmPoolRecord;
		scheduler.running = false;
		scheduler.state = "FAILED";
		await assert.rejects(backend.cancelAndVerify(pool, new AbortController().signal), /CPUTimeRAW identity mismatch/);
	});

	it("quotes every remote argv element and disables credential forwarding", () => {
		const argv = compilerGymWarmSshArgv("farmshare", ["fixture", "x; touch /tmp/not-allowed", "a'b"]);
		assert.equal(argv[0], "ssh");
		assert.ok(argv.includes("ForwardAgent=no"));
		assert.ok(argv.includes("ClearAllForwardings=yes"));
		assert.ok(argv.includes("SendEnv=-*"));
		assert.equal(argv.at(-1), `'fixture' 'x; touch /tmp/not-allowed' 'a'"'"'b'`);
	});

	it("routes secure remote filesystem operations through a bounded fake command runner", async () => {
		const requests: CompilerGymWarmCommandRequest[] = [];
		const runner: CompilerGymWarmCommandRunner = {
			async run(request): Promise<CompilerGymWarmCommandResult> {
				requests.push(request);
				return { exitCode: 0, stdout: "", stderr: "", wallMs: 1 };
			},
		};
		const remote = new SshCompilerGymWarmRemoteFileSystem(runner, "farmshare", "/usr/bin/python3", 1_000);
		const content = "immutable fixture\n";
		await remote.installImmutableFile(
			"/home/users/duynguy/farmshare-work/fixture.json",
			content,
			sha256Text(content),
			0o600,
			false,
			new AbortController().signal,
		);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].input, content);
		assert.equal(requests[0].timeoutMs, 1_000);
		assert.ok(requests[0].maxOutputBytes > 0);
		const command = requests[0].argv.at(-1)!;
		const args = [...command.matchAll(/'([^']*)'/g)].map((match) => match[1]);
		assert.equal(args[0], "/usr/bin/python3");
		assert.equal(args[1], "-c");
		const helper = Buffer.from(args[3], "base64").toString("utf8");
		assert.match(helper, /O_NOFOLLOW/);
		assert.match(helper, /os\.fstat\(descriptor\)/);
		assert.match(helper, /dir_fd=parent_descriptor/);
		assert.match(helper, /metadata\.st_uid != os\.getuid\(\)/);
		assert.match(helper, /stat\.S_IMODE\(metadata\.st_mode\)/);
		assert.match(helper, /follow_symlinks=False/);
		assert.match(helper, /os\.fsync/);
		assert.match(helper, /read_bounded\(descriptor, int\(max_bytes\)\)/);
		assert.doesNotMatch(helper, /path\.open|path\.lstat|os\.link\(path/);
	});
});

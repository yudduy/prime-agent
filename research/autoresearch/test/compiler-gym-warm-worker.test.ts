import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
	DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
	FarmShareCompilerGymAdapter,
} from "../src/compiler-gym-adapter.js";
import {
	COMPILER_GYM_WARM_CPUS_PER_TASK,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
	COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES,
	COMPILER_GYM_WARM_PROTOCOL,
	COMPILER_GYM_WARM_TASKS,
	type CompilerGymWarmBackend,
	type CompilerGymWarmCloseVerification,
	type CompilerGymWarmPoolExpectation,
	type CompilerGymWarmPoolRecord,
	type CompilerGymWarmReadyRecord,
	type CompilerGymWarmRecovery,
	type CompilerGymWarmRequestRecord,
	compilerGymWarmBranchDigest,
	compilerGymWarmHandle,
	compilerGymWarmJobName,
	compilerGymWarmPoolDigest,
	compilerGymWarmRequestDigest,
	ProtocolCompilerGymWarmTransport,
	parseCompilerGymWarmHandle,
	parseCompilerGymWarmRequestRecord,
	parseCompilerGymWarmResultRecords,
} from "../src/compiler-gym-warm-transport.js";
import type { EvaluationContext, EvaluationJob } from "../src/types.js";

const WORKER_PATH = fileURLToPath(new URL("../evaluators/compiler_gym_warm_worker.py", import.meta.url));
const EVALUATOR_PATH = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
const PYTHON_PATH = "/usr/bin/python3";
const SLURM_ID = "424242";
const ACTIONS = ["-mem2reg", "-sroa", "-instcombine", "-simplifycfg", "-adce", "-dce", "-dse"];
const FIXED_CANDIDATE_DIGEST = "4c4245e3ebb41e26cc3b4e24c711f2ab0c56a7bf7ecd96ce116c80779210228f";

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	let rejectPromise: ((error: unknown) => void) | undefined;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve(value) {
			if (!resolvePromise) throw new Error("Deferred resolve is unavailable");
			resolvePromise(value);
		},
		reject(error) {
			if (!rejectPromise) throw new Error("Deferred reject is unavailable");
			rejectPromise(error);
		},
	};
}

async function sha256File(path: string): Promise<string> {
	return sha256Text(await readFile(path, "utf8"));
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.tmp`;
	await writeFile(temporary, `${canonicalJson(toJsonValue(value))}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		try {
			await readFile(path);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			throw error;
		}
		if (Date.now() >= deadline) throw new Error(`Process ${pid} survived warm-worker cleanup`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

function transientCachePath(jobId: string, benchmarkId: string): string {
	return `/tmp/prime-autoresearch-${jobId}-${sha256Text(benchmarkId).slice(0, 12)}`;
}

async function assertPathMissing(path: string): Promise<void> {
	await assert.rejects(access(path), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
}

function collectChild(child: ChildProcess): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (exitCode) =>
			resolve({
				exitCode,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			}),
		);
	});
}

function evaluatorResult(benchmark: string, ir: number, objectSize: number): string {
	return JSON.stringify({
		schema_version: 2,
		contract: COMPILER_GYM_VERIFIER_EPOCH,
		ok: true,
		status: "success",
		benchmark,
		metrics: { final: { IrInstructionCount: ir, ObjectTextSizeBytes: objectSize } },
		validation: { passed: true, inputs_completed: 20, semantic_errors: [] },
		timings_seconds: { total: 0.05 },
		provenance: {
			upstream_cbench_source_sha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
			cbench_patch_sha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
			pinned_installed_cbench_source_sha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
			installed_cbench_source_sha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
			installed_cbench_source_matches_pin: true,
			farmshare_environment_seal_passed: true,
		},
		environment: {
			seal: {
				python_version: "3.10.19",
				distribution_manifest_sha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
				compatibility_tree_manifest_sha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
				libtinfo_sha256: COMPILER_GYM_LIBTINFO_SHA256,
			},
		},
	});
}

function makeResult(
	pool: CompilerGymWarmPoolRecord,
	request: CompilerGymWarmRequestRecord,
	rank: 0 | 1,
): Record<string, unknown> {
	return {
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
		childExitCode: 0,
		stdout: `${evaluatorResult(request.tasks[rank], rank === 0 ? 2075 : 16406, rank === 0 ? 11639 : 159685)}\n`,
		stderr: "",
		wallMs: rank === 0 ? 100 : 120,
		completedAt: "2026-08-28T06:00:01.000Z",
	};
}

class FakeWarmBackend implements CompilerGymWarmBackend {
	readonly calls: string[] = [];
	pool: CompilerGymWarmPoolRecord | undefined;
	ready: [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord] | undefined;
	request: CompilerGymWarmRequestRecord | undefined;
	results: readonly unknown[] | undefined;
	phase: CompilerGymWarmRecovery["phase"] = "prepared";
	allocationTerminal = false;
	waitError: Error | undefined;
	recoverError: Error | undefined;
	shutdownError: Error | undefined;
	cancelError: Error | undefined;
	readyOverride: readonly unknown[] | undefined;
	acquireError: Error | undefined;
	acquireGate: Promise<void> | undefined;
	shutdownCalls = 0;
	cancelCalls = 0;

	async acquire(expectation: CompilerGymWarmPoolExpectation): Promise<{ pool: unknown; ready: readonly unknown[] }> {
		this.calls.push("acquire");
		if (this.acquireError) throw this.acquireError;
		this.pool = {
			...expectation,
			slurmId: SLURM_ID,
			workDir: `/fake/compiler-gym-warm/${expectation.branchDigest}`,
			createdAt: "2026-08-28T06:00:00.000Z",
		};
		this.ready = [0, 1].map((rank) => ({
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			poolDigest: expectation.poolDigest,
			rank: rank as 0 | 1,
			slurmId: SLURM_ID,
			cpusPerTask: COMPILER_GYM_WARM_CPUS_PER_TASK,
			workerSha256: expectation.workerSha256,
			evaluatorSha256: expectation.evaluatorSha256,
			readyAt: "2026-08-28T06:00:00.100Z",
		})) as [CompilerGymWarmReadyRecord, CompilerGymWarmReadyRecord];
		if (this.acquireGate) await this.acquireGate;
		return { pool: this.pool, ready: this.readyOverride ?? this.ready };
	}

	async prepareRequest(_pool: CompilerGymWarmPoolRecord, request: CompilerGymWarmRequestRecord): Promise<void> {
		this.calls.push("prepare");
		this.request = request;
		this.phase = "prepared";
	}

	async publishRequest(): Promise<void> {
		this.calls.push("publish");
		this.phase = "published";
	}

	async waitForResults(): Promise<readonly unknown[]> {
		this.calls.push("wait");
		if (this.waitError) throw this.waitError;
		assert.ok(this.pool && this.request);
		this.results = [makeResult(this.pool, this.request, 0), makeResult(this.pool, this.request, 1)];
		this.phase = "complete";
		return this.results;
	}

	async recover(): Promise<CompilerGymWarmRecovery> {
		this.calls.push("recover");
		if (this.recoverError) throw this.recoverError;
		assert.ok(this.pool && this.ready && this.request);
		if (this.phase === "complete") {
			assert.ok(this.results);
			return {
				phase: "complete",
				pool: this.pool,
				ready: this.ready,
				request: this.request,
				results: this.results,
				allocationTerminal: this.allocationTerminal,
			};
		}
		return {
			phase: this.phase,
			pool: this.pool,
			ready: this.ready,
			request: this.request,
			allocationTerminal: this.allocationTerminal,
		};
	}

	async shutdownAndVerify(pool: CompilerGymWarmPoolRecord): Promise<CompilerGymWarmCloseVerification> {
		this.calls.push("shutdown");
		this.shutdownCalls++;
		if (this.shutdownError) throw this.shutdownError;
		return {
			mode: "shutdown",
			poolDigest: pool.poolDigest,
			slurmId: pool.slurmId,
			schedulerAbsent: true,
			accountingState: "COMPLETED",
			acknowledgedRanks: [0, 1],
		};
	}

	async cancelAndVerify(pool: CompilerGymWarmPoolRecord): Promise<CompilerGymWarmCloseVerification> {
		this.calls.push("cancel");
		this.cancelCalls++;
		if (this.cancelError) throw this.cancelError;
		return {
			mode: "cancel",
			poolDigest: pool.poolDigest,
			slurmId: pool.slurmId,
			schedulerAbsent: true,
			accountingState: "CANCELLED",
			acknowledgedRanks: [],
		};
	}
}

function evaluationJob(sequence = 0): EvaluationJob {
	return {
		jobId: `job_warm_${sequence}`,
		manifestDigest: sha256Text(`manifest-${sequence}`),
		branchId: "warm-pilot-branch",
		lane: "compiler-gym",
		benchmarkIds: [...COMPILER_GYM_WARM_TASKS],
		budgetClass: "smoke",
		treatment: "compiler-gym-warm-allocation-v1",
		proposal: {
			hypothesis: "Warm allocation removes repeated admission latency",
			mechanism: "Reuse only the allocation",
			predictedOutcome: "Byte-identical verifier outcome",
			boundaryConditions: ["Evaluator remains one-shot"],
			parentJobIds: [],
		},
		candidate: { digest: FIXED_CANDIDATE_DIGEST, byteLength: 72, mediaType: "application/json" },
		candidateFormat: "llvm-pass-sequence",
		candidateContent: JSON.stringify(ACTIONS),
	};
}

describe("CompilerGym warm-allocation protocol", () => {
	it("content-addresses every material scheduler and worker launch setting", () => {
		assert.deepEqual(
			{
				scheduler: COMPILER_GYM_WARM_LAUNCH_CONTRACT.scheduler,
				clusterHost: COMPILER_GYM_WARM_LAUNCH_CONTRACT.clusterHost,
				partition: COMPILER_GYM_WARM_LAUNCH_CONTRACT.partition,
				cpuConstraint: COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpuConstraint,
				pythonPath: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
				pythonVersion: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonVersion,
				compilerGymCache: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache,
				compilerGymSiteData: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData,
				ldLibraryPath: COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath,
				transientCacheTemplate: COMPILER_GYM_WARM_LAUNCH_CONTRACT.transientCacheTemplate,
				childWorkingDirectory: COMPILER_GYM_WARM_LAUNCH_CONTRACT.childWorkingDirectory,
				poolWallTime: COMPILER_GYM_WARM_LAUNCH_CONTRACT.poolWallTime,
				childTimeoutSeconds: COMPILER_GYM_WARM_LAUNCH_CONTRACT.childTimeoutSeconds,
				idleTimeoutSeconds: COMPILER_GYM_WARM_LAUNCH_CONTRACT.idleTimeoutSeconds,
				leaseTimeoutSeconds: COMPILER_GYM_WARM_LAUNCH_CONTRACT.leaseTimeoutSeconds,
				pollSeconds: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pollSeconds,
				maxChildOutputBytes: COMPILER_GYM_WARM_LAUNCH_CONTRACT.maxChildOutputBytes,
			},
			{
				scheduler: "slurm",
				clusterHost: "farmshare",
				partition: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.partition,
				cpuConstraint: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.cpuConstraint,
				pythonPath: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-venv-v2/bin/python",
				pythonVersion: "3.10.19",
				compilerGymCache: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.compilerGymCache,
				compilerGymSiteData: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.compilerGymSiteData,
				ldLibraryPath: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.compatibilityLibraryDir,
				transientCacheTemplate: "/tmp/prime-autoresearch-{jobId}-{benchmarkSha256_12}",
				childWorkingDirectory: "per-request-transient-cache",
				poolWallTime: "00:30:00",
				childTimeoutSeconds: 300,
				idleTimeoutSeconds: 300,
				leaseTimeoutSeconds: 0,
				pollSeconds: 0.05,
				maxChildOutputBytes: COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES,
			},
		);
		assert.equal(COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256, sha256Json(COMPILER_GYM_WARM_LAUNCH_CONTRACT));
	});

	it("leaves the cold default and pinned evaluator unchanged", async () => {
		assert.equal(await sha256File(EVALUATOR_PATH), COMPILER_GYM_EVALUATOR_SHA256);
		const adapter = new FarmShareCompilerGymAdapter();
		assert.equal(await adapter.closeAndVerify(), undefined);
		await assert.rejects(
			adapter.resume(evaluationJob(), "cg-warm-v1:invalid", {
				signal: new AbortController().signal,
				recordExternalJobId: async () => {},
			}),
			/cold evaluations do not have a durable external handle/,
		);
	});

	it("returns a typed scheduler-absence proof after a failed acquisition", async () => {
		const backend = new FakeWarmBackend();
		backend.acquireError = Object.assign(new Error("synthetic acquire failure"), {
			cleanupProof: {
				protocol: "compiler-gym-warm-acquisition-cleanup-v1",
				poolDigest: compilerGymWarmPoolDigest(
					compilerGymWarmBranchDigest("verified-acquire-failure"),
					"1".repeat(64),
					COMPILER_GYM_EVALUATOR_SHA256,
				),
				action: "not-submitted",
				submissionAttempted: false,
				discoveredSlurmIds: [],
				schedulerAbsent: true,
				accounting: [],
				detail: "Failure occurred before the sole sbatch invocation",
			},
		});
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "1".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		await assert.rejects(
			transport.prepareEvaluation(
				{
					branchId: "verified-acquire-failure",
					jobId: "job_verified_acquire_failure",
					manifestDigest: sha256Text("verified-acquire-failure"),
					actions: ACTIONS,
					benchmarkIds: COMPILER_GYM_WARM_TASKS,
				},
				new AbortController().signal,
			),
			/synthetic acquire failure/,
		);
		const cleanup = await transport.closeAndVerify();
		assert.equal(cleanup?.mode, "acquisition");
		if (cleanup?.mode !== "acquisition") throw new Error("Expected acquisition cleanup proof");
		assert.equal(cleanup.action, "not-submitted");
		assert.equal(cleanup.schedulerAbsent, true);
	});

	it("rejects close when failed acquisition cleanup was not verified", async () => {
		const backend = new FakeWarmBackend();
		backend.acquireError = Object.assign(new Error("synthetic ambiguous acquire failure"), {
			cleanupProof: {
				protocol: "compiler-gym-warm-acquisition-cleanup-v1",
				poolDigest: compilerGymWarmPoolDigest(
					compilerGymWarmBranchDigest("unverified-acquire-failure"),
					"2".repeat(64),
					COMPILER_GYM_EVALUATOR_SHA256,
				),
				action: "cleanup-unverified",
				submissionAttempted: true,
				discoveredSlurmIds: ["424242"],
				schedulerAbsent: false,
				accounting: [],
				detail: "scheduler identity remained visible",
			},
		});
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "2".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		await assert.rejects(
			transport.prepareEvaluation(
				{
					branchId: "unverified-acquire-failure",
					jobId: "job_unverified_acquire_failure",
					manifestDigest: sha256Text("unverified-acquire-failure"),
					actions: ACTIONS,
					benchmarkIds: COMPILER_GYM_WARM_TASKS,
				},
				new AbortController().signal,
			),
			/synthetic ambiguous acquire failure/,
		);
		await assert.rejects(transport.closeAndVerify(), /without verified scheduler cleanup/);
	});

	it("serializes concurrent prepare calls before pool acquisition can complete", async () => {
		const backend = new FakeWarmBackend();
		const acquireGate = deferred<void>();
		backend.acquireGate = acquireGate.promise;
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "1".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		const input = {
			branchId: "serialized-prepare-branch",
			jobId: "job_serialized_prepare",
			manifestDigest: sha256Text("serialized-prepare-manifest"),
			actions: ACTIONS,
			benchmarkIds: COMPILER_GYM_WARM_TASKS,
		};
		const first = transport.prepareEvaluation(input, new AbortController().signal);
		const second = transport.prepareEvaluation(
			{ ...input, jobId: "job_serialized_prepare_second" },
			new AbortController().signal,
		);
		const secondRejected = assert.rejects(second, /already prepared/);
		assert.deepEqual(backend.calls, ["acquire"]);
		acquireGate.resolve(undefined);
		await first;
		await secondRejected;
		assert.deepEqual(backend.calls, ["acquire", "prepare"]);
		assert.equal((await transport.closeAndVerify())?.mode, "shutdown");
		assert.equal(backend.shutdownCalls, 1);
	});

	it("serializes close behind an in-flight prepare and shuts down the acquired pool", async () => {
		const backend = new FakeWarmBackend();
		const acquireGate = deferred<void>();
		backend.acquireGate = acquireGate.promise;
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "2".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		const preparing = transport.prepareEvaluation(
			{
				branchId: "serialized-close-branch",
				jobId: "job_serialized_close",
				manifestDigest: sha256Text("serialized-close-manifest"),
				actions: ACTIONS,
				benchmarkIds: COMPILER_GYM_WARM_TASKS,
			},
			new AbortController().signal,
		);
		const closing = transport.closeAndVerify();
		assert.deepEqual(backend.calls, ["acquire"]);
		assert.equal(backend.shutdownCalls, 0);
		acquireGate.resolve(undefined);
		await preparing;
		assert.equal((await closing)?.mode, "shutdown");
		assert.deepEqual(backend.calls, ["acquire", "prepare", "shutdown"]);
		assert.equal(backend.shutdownCalls, 1);
		await assert.rejects(
			transport.prepareEvaluation(
				{
					branchId: "serialized-close-branch",
					jobId: "job_after_close",
					manifestDigest: sha256Text("after-close-manifest"),
					actions: ACTIONS,
					benchmarkIds: COMPILER_GYM_WARM_TASKS,
				},
				new AbortController().signal,
			),
			/closing or closed/,
		);
	});

	it("records the durable handle before publication and preserves evaluator authority", async () => {
		const backend = new FakeWarmBackend();
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "a".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			now: () => new Date("2026-08-28T06:00:00.500Z"),
		});
		const adapter = new FarmShareCompilerGymAdapter(DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG, {
			warmTransport: transport,
		});
		assert.equal(adapter.deterministicMeasurementReuse, undefined);
		const recorded: string[] = [];
		const context: EvaluationContext = {
			signal: new AbortController().signal,
			async recordExternalJobId(handle) {
				assert.deepEqual(backend.calls, ["acquire", "prepare"]);
				recorded.push(handle);
			},
		};
		const outcome = await adapter.evaluate(evaluationJob(), context);
		assert.equal(recorded.length, 1);
		assert.deepEqual(backend.calls, ["acquire", "prepare", "publish", "wait"]);
		assert.equal(outcome.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
		assert.deepEqual(
			outcome.tasks.map((task) => [
				task.benchmarkId,
				task.status,
				task.verifier.passed,
				task.metrics.IrInstructionCount,
			]),
			[
				[COMPILER_GYM_WARM_TASKS[0], "accepted", true, 2075],
				[COMPILER_GYM_WARM_TASKS[1], "accepted", true, 16406],
			],
		);
		assert.equal(outcome.provenance.evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
		assert.equal(outcome.provenance.adapter, "farmshare-compiler-gym");
		assert.deepEqual(
			outcome.tasks.map((task) => [
				task.metrics.evaluatorProcessWallMs,
				task.metrics.schedulerAndEvaluatorWallMs,
				task.metrics.queueAndTransportMs,
			]),
			[
				[100, undefined, undefined],
				[120, undefined, undefined],
			],
		);
		assert.match(outcome.stdout ?? "", /compiler-gym-warm-allocation-v1/);
		const firstClose = await adapter.closeAndVerify();
		const secondClose = await adapter.closeAndVerify();
		assert.deepEqual(firstClose, secondClose);
		assert.equal(backend.shutdownCalls, 1);
	});

	it("resumes a prepared request by publishing once and never re-prepares it", async () => {
		const backend = new FakeWarmBackend();
		const first = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "b".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		const input = {
			branchId: "resume-branch",
			jobId: "job_resume",
			manifestDigest: sha256Text("resume-manifest"),
			actions: ACTIONS,
			benchmarkIds: COMPILER_GYM_WARM_TASKS,
		};
		const prepared = await first.prepareEvaluation(input, new AbortController().signal);
		assert.equal(backend.phase, "prepared");
		const resumed = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "b".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		const result = await resumed.resumeEvaluation(input, prepared.handle, new AbortController().signal);
		assert.equal(result.handle, prepared.handle);
		assert.equal(backend.calls.filter((call) => call === "prepare").length, 1);
		assert.equal(backend.calls.filter((call) => call === "publish").length, 1);
	});

	it("fails closed instead of reusing a terminal allocation with completed results", async () => {
		const backend = new FakeWarmBackend();
		const options = {
			workerSha256: "b".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		};
		const input = {
			branchId: "terminal-complete-branch",
			jobId: "job_terminal_complete",
			manifestDigest: sha256Text("terminal-complete-manifest"),
			actions: ACTIONS,
			benchmarkIds: COMPILER_GYM_WARM_TASKS,
		};
		const first = new ProtocolCompilerGymWarmTransport(backend, options);
		const prepared = await first.prepareEvaluation(input, new AbortController().signal);
		await first.publishAndWait(prepared, new AbortController().signal);
		backend.allocationTerminal = true;
		const resumed = new ProtocolCompilerGymWarmTransport(backend, options);
		await assert.rejects(
			resumed.resumeEvaluation(input, prepared.handle, new AbortController().signal),
			/lost its reusable allocation/,
		);
		assert.equal(backend.cancelCalls, 1);
	});

	it("preserves both a request failure and its cleanup failure", async () => {
		const backend = new FakeWarmBackend();
		backend.waitError = new Error("rank lost");
		backend.cancelError = new Error("scheduler unavailable");
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "f".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		const prepared = await transport.prepareEvaluation(
			{
				branchId: "aggregate-failure-branch",
				jobId: "job_aggregate_failure",
				manifestDigest: sha256Text("aggregate-failure-manifest"),
				actions: ACTIONS,
				benchmarkIds: COMPILER_GYM_WARM_TASKS,
			},
			new AbortController().signal,
		);
		await assert.rejects(
			transport.publishAndWait(prepared, new AbortController().signal),
			(error: unknown) =>
				error instanceof AggregateError &&
				error.errors.some((item) => item instanceof Error && item.message === "rank lost") &&
				error.errors.some((item) => item instanceof Error && item.message === "scheduler unavailable"),
		);
	});

	it("fails closed when a published request loses its allocation before either claim", async () => {
		const backend = new FakeWarmBackend();
		const options = {
			workerSha256: "8".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		};
		const first = new ProtocolCompilerGymWarmTransport(backend, options);
		const input = {
			branchId: "published-terminal-branch",
			jobId: "job_published_terminal",
			manifestDigest: sha256Text("published-terminal-manifest"),
			actions: ACTIONS,
			benchmarkIds: COMPILER_GYM_WARM_TASKS,
		};
		const prepared = await first.prepareEvaluation(input, new AbortController().signal);
		await backend.publishRequest();
		backend.allocationTerminal = true;
		const resumed = new ProtocolCompilerGymWarmTransport(backend, options);
		await assert.rejects(
			resumed.resumeEvaluation(input, prepared.handle, new AbortController().signal),
			/lost its allocation before either slot claimed it/,
		);
		assert.equal(backend.calls.filter((call) => call === "wait").length, 0);
		assert.equal(backend.cancelCalls, 1);
	});

	it("cancels a trusted acquired pool when ready-record validation fails", async () => {
		const backend = new FakeWarmBackend();
		backend.readyOverride = [];
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "7".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		await assert.rejects(
			transport.prepareEvaluation(
				{
					branchId: "invalid-ready-branch",
					jobId: "job_invalid_ready",
					manifestDigest: sha256Text("invalid-ready-manifest"),
					actions: ACTIONS,
					benchmarkIds: COMPILER_GYM_WARM_TASKS,
				},
				new AbortController().signal,
			),
			/Exactly two warm-worker ready records are required/,
		);
		assert.equal(backend.cancelCalls, 1);
		assert.equal((await transport.closeAndVerify())?.mode, "cancel");
	});

	it("cancels a trusted recovered pool when its durable request conflicts", async () => {
		const backend = new FakeWarmBackend();
		const options = {
			workerSha256: "9".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		};
		const first = new ProtocolCompilerGymWarmTransport(backend, options);
		const input = {
			branchId: "conflict-branch",
			jobId: "job_conflict",
			manifestDigest: sha256Text("conflict-manifest"),
			actions: ACTIONS,
			benchmarkIds: COMPILER_GYM_WARM_TASKS,
		};
		const prepared = await first.prepareEvaluation(input, new AbortController().signal);
		assert.ok(backend.request);
		backend.request = { ...backend.request, publishedAt: "not-a-timestamp" };
		const resumed = new ProtocolCompilerGymWarmTransport(backend, options);
		await assert.rejects(
			resumed.resumeEvaluation(input, prepared.handle, new AbortController().signal),
			/must be an ISO timestamp/,
		);
		assert.equal(backend.cancelCalls, 1);
	});

	it("poisons a failed request, cancels exactly once, and rejects drift", async () => {
		const backend = new FakeWarmBackend();
		backend.waitError = new Error("worker died");
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: "c".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		});
		const input = {
			branchId: "poison-branch",
			jobId: "job_poison",
			manifestDigest: sha256Text("poison-manifest"),
			actions: ACTIONS,
			benchmarkIds: COMPILER_GYM_WARM_TASKS,
		};
		const prepared = await transport.prepareEvaluation(input, new AbortController().signal);
		await assert.rejects(transport.publishAndWait(prepared, new AbortController().signal), /worker died/);
		assert.equal(backend.cancelCalls, 1);
		assert.equal((await transport.closeAndVerify())?.mode, "cancel");
		assert.equal((await transport.closeAndVerify())?.mode, "cancel");
		assert.equal(backend.cancelCalls, 1);
		await assert.rejects(transport.prepareEvaluation(input, new AbortController().signal), /poisoned/);

		const malformed = { ...backend.request, unexpected: true };
		assert.throws(() => parseCompilerGymWarmRequestRecord(malformed), /keys mismatch/);
		assert.throws(
			() => parseCompilerGymWarmHandle(compilerGymWarmHandle("d".repeat(64), "e".repeat(64), "0")),
			/positive numeric/,
		);
		assert.ok(backend.pool && backend.request);
		const oversized = {
			...makeResult(backend.pool, backend.request, 0),
			stdout: "x".repeat(COMPILER_GYM_WARM_MAX_CHILD_OUTPUT_BYTES + 1),
		};
		assert.throws(
			() =>
				parseCompilerGymWarmResultRecords(
					[oversized, makeResult(backend.pool!, backend.request!, 1)],
					backend.pool!,
					backend.request!,
				),
			/child output limit/,
		);
	});
});

describe("CompilerGym warm slot worker", () => {
	it("serves four two-task requests with eight fresh evaluator processes and clean shutdown", async () => {
		const root = await mkdtemp(join(tmpdir(), "compiler-gym-warm-worker-"));
		await chmod(root, 0o700);
		try {
			const evaluatorPath = join(root, "fake_evaluator.py");
			const pidLog = join(root, "evaluator-pids.log");
			await writeFile(
				evaluatorPath,
				`#!/usr/bin/env python3
import json, os, sys
request = json.load(sys.stdin)
with open(os.path.join(os.environ["COMPILER_GYM_TRANSIENT_CACHE"], "fixture.txt"), "w", encoding="utf-8") as stream:
    stream.write("transient")
with open(${JSON.stringify(pidLog)}, "a", encoding="utf-8") as stream:
    stream.write(f"{os.getpid()}\\n")
print(json.dumps({"ok": True, "status": "fixture", "benchmark": request["benchmark"], "actions": request["actions"]}, sort_keys=True, separators=(",", ":")))
`,
				{ mode: 0o700 },
			);
			await chmod(evaluatorPath, 0o700);
			const [workerSha256, evaluatorSha256] = await Promise.all([
				sha256File(WORKER_PATH),
				sha256File(evaluatorPath),
			]);
			const branchDigest = compilerGymWarmBranchDigest("local-spool-gate");
			const poolDigest = compilerGymWarmPoolDigest(branchDigest, workerSha256, evaluatorSha256);
			const jobName = compilerGymWarmJobName(poolDigest);
			const pool: CompilerGymWarmPoolRecord = {
				protocol: COMPILER_GYM_WARM_PROTOCOL,
				poolDigest,
				branchDigest,
				slurmId: SLURM_ID,
				jobName,
				workDir: root,
				workerSha256,
				evaluatorSha256,
				launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
				createdAt: "2026-08-28T06:00:00.000Z",
			};
			await writePrivateJson(join(root, "pool.json"), pool);
			const workerArgs = (rank: 0 | 1) => [
				WORKER_PATH,
				"--spool",
				root,
				"--rank",
				String(rank),
				"--slurm-id",
				SLURM_ID,
				"--pool-digest",
				poolDigest,
				"--branch-digest",
				branchDigest,
				"--job-name",
				jobName,
				"--worker-sha256",
				workerSha256,
				"--evaluator-sha256",
				evaluatorSha256,
				"--launch-contract-sha256",
				COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
				"--evaluator",
				evaluatorPath,
				"--python",
				PYTHON_PATH,
				"--compiler-gym-cache",
				root,
				"--compiler-gym-site-data",
				root,
				"--ld-library-path",
				root,
				"--python-warnings",
				"ignore::FutureWarning",
				"--poll-seconds",
				"0.01",
				"--idle-timeout-seconds",
				"10",
			];
			const environment = { ...process.env, SLURM_CPUS_PER_TASK: "2" };
			const children = ([0, 1] as const).map((rank) => spawn(PYTHON_PATH, workerArgs(rank), { env: environment }));
			const completions = children.map(collectChild);
			await Promise.all(([0, 1] as const).map((rank) => waitForFile(join(root, `ready-rank-${rank}.json`))));
			const transientPaths: string[] = [];
			for (let sequence = 0; sequence < 4; sequence++) {
				const jobId = `job_local_${poolDigest.slice(0, 12)}_${sequence}`;
				const body = {
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest,
					sequence,
					jobId,
					manifestDigest: sha256Text(`local-manifest-${sequence}`),
					actionsDigest: sha256Json(ACTIONS),
					actions: ACTIONS,
					tasks: [...COMPILER_GYM_WARM_TASKS] as [string, string],
				};
				transientPaths.push(
					...COMPILER_GYM_WARM_TASKS.map((benchmarkId) => transientCachePath(jobId, benchmarkId)),
				);
				const request: CompilerGymWarmRequestRecord = {
					...body,
					requestDigest: compilerGymWarmRequestDigest(body),
					publishedAt: `2026-08-28T06:00:0${sequence}.500Z`,
				};
				await writePrivateJson(join(root, `request-${sequence.toString().padStart(4, "0")}.json`), request);
				const paths = ([0, 1] as const).map((rank) =>
					join(root, `result-${sequence.toString().padStart(4, "0")}-rank-${rank}.json`),
				);
				await Promise.all(paths.map((path) => waitForFile(path)));
				const values = await Promise.all(
					paths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as unknown),
				);
				const parsed = parseCompilerGymWarmResultRecords(values, pool, request);
				assert.deepEqual(
					parsed.map((result) => result.benchmarkId),
					[...COMPILER_GYM_WARM_TASKS],
				);
				assert.deepEqual(
					parsed.map((result) => JSON.parse(result.stdout).actions),
					[ACTIONS, ACTIONS],
				);
			}
			await writePrivateJson(join(root, "shutdown.json"), {
				protocol: COMPILER_GYM_WARM_PROTOCOL,
				poolDigest,
				requestedAt: "2026-08-28T06:00:10.000Z",
			});
			const completed = await Promise.all(completions);
			for (const result of completed) assert.equal(result.exitCode, 0, result.stderr);
			await Promise.all(([0, 1] as const).map((rank) => waitForFile(join(root, `shutdown-ack-rank-${rank}.json`))));
			const pids = (await readFile(pidLog, "utf8")).trim().split("\n").filter(Boolean);
			assert.equal(pids.length, 8);
			assert.equal(new Set(pids).size, 8);
			await Promise.all(transientPaths.map(assertPathMissing));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("kills evaluator process groups on timeout, output overflow, and worker signals", async () => {
		for (const mode of ["timeout", "output", "signal"] as const) {
			const root = await mkdtemp(join(tmpdir(), `compiler-gym-warm-${mode}-`));
			await chmod(root, 0o700);
			let worker: ChildProcess | undefined;
			try {
				const evaluatorPath = join(root, "grandchild_evaluator.py");
				const grandchildPidPath = join(root, "grandchild.pid");
				const escapedSentinelPath = join(root, "grandchild-escaped");
				await writeFile(
					evaluatorPath,
					`#!/usr/bin/env python3
import os, subprocess, sys, time
grandchild_source = 'import os, sys, time; open(sys.argv[1], "w", encoding="utf-8").write(str(os.getpid())); time.sleep(1); open(sys.argv[2], "w", encoding="utf-8").write("escaped")'
subprocess.Popen([sys.executable, "-c", grandchild_source, ${JSON.stringify(grandchildPidPath)}, ${JSON.stringify(escapedSentinelPath)}], env=os.environ.copy())
deadline = time.monotonic() + 5
while not os.path.exists(${JSON.stringify(grandchildPidPath)}):
    if time.monotonic() >= deadline:
        raise RuntimeError("grandchild did not start")
    time.sleep(0.01)
if ${JSON.stringify(mode)} == "output":
    os.write(1, b"x" * 8192)
time.sleep(60)
`,
					{ mode: 0o700 },
				);
				await chmod(evaluatorPath, 0o700);
				const [workerSha256, evaluatorSha256] = await Promise.all([
					sha256File(WORKER_PATH),
					sha256File(evaluatorPath),
				]);
				const branchDigest = compilerGymWarmBranchDigest(`process-group-${mode}`);
				const poolDigest = compilerGymWarmPoolDigest(branchDigest, workerSha256, evaluatorSha256);
				const jobName = compilerGymWarmJobName(poolDigest);
				const pool: CompilerGymWarmPoolRecord = {
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest,
					branchDigest,
					slurmId: SLURM_ID,
					jobName,
					workDir: root,
					workerSha256,
					evaluatorSha256,
					launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
					createdAt: "2026-08-28T06:00:00.000Z",
				};
				await writePrivateJson(join(root, "pool.json"), pool);
				const workerArgs = [
					WORKER_PATH,
					"--spool",
					root,
					"--rank",
					"0",
					"--slurm-id",
					SLURM_ID,
					"--pool-digest",
					poolDigest,
					"--branch-digest",
					branchDigest,
					"--job-name",
					jobName,
					"--worker-sha256",
					workerSha256,
					"--evaluator-sha256",
					evaluatorSha256,
					"--launch-contract-sha256",
					COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
					"--evaluator",
					evaluatorPath,
					"--python",
					PYTHON_PATH,
					"--compiler-gym-cache",
					root,
					"--compiler-gym-site-data",
					root,
					"--ld-library-path",
					root,
					"--python-warnings",
					"ignore::FutureWarning",
					"--poll-seconds",
					"0.01",
					"--idle-timeout-seconds",
					"10",
					"--child-timeout-seconds",
					mode === "timeout" ? "0.5" : "10",
					"--child-termination-grace-seconds",
					"0.1",
					"--max-output-bytes",
					mode === "output" ? "1024" : "4096",
				];
				worker = spawn(PYTHON_PATH, workerArgs, {
					env: {
						...process.env,
						SLURM_CPUS_PER_TASK: "2",
					},
				});
				const completion = collectChild(worker);
				await waitForFile(join(root, "ready-rank-0.json"));
				const body = {
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest,
					sequence: 0,
					jobId: `job_process_group_${mode}`,
					manifestDigest: sha256Text(`process-group-manifest-${mode}`),
					actionsDigest: sha256Json(ACTIONS),
					actions: ACTIONS,
					tasks: [...COMPILER_GYM_WARM_TASKS] as [string, string],
				};
				const request: CompilerGymWarmRequestRecord = {
					...body,
					requestDigest: compilerGymWarmRequestDigest(body),
					publishedAt: "2026-08-28T06:00:00.500Z",
				};
				await writePrivateJson(join(root, "request-0000.json"), request);
				await waitForFile(grandchildPidPath);
				const grandchildPid = Number.parseInt((await readFile(grandchildPidPath, "utf8")).trim(), 10);
				assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0);

				if (mode === "signal") {
					worker.kill("SIGTERM");
					const completed = await completion;
					assert.equal(completed.exitCode, 143, completed.stderr);
					assert.match(completed.stderr, /worker received SIGTERM/);
				} else {
					const resultPath = join(root, "result-0000-rank-0.json");
					await Promise.race([
						waitForFile(resultPath),
						completion.then((completed) => {
							throw new Error(
								`worker exited before publishing a result: ${completed.exitCode}: ${completed.stderr}`,
							);
						}),
					]);
					const result = JSON.parse(await readFile(resultPath, "utf8")) as { stdout: string; stderr: string };
					assert.match(result.stderr, mode === "timeout" ? /timeout/ : /output bytes/);
					const expectedLimit = mode === "output" ? 1024 : 4096;
					assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= expectedLimit);
					await writePrivateJson(join(root, "shutdown.json"), {
						protocol: COMPILER_GYM_WARM_PROTOCOL,
						poolDigest,
						requestedAt: "2026-08-28T06:00:10.000Z",
					});
					const completed = await completion;
					assert.equal(completed.exitCode, 0, completed.stderr);
				}
				await waitForProcessExit(grandchildPid);
				await new Promise((resolve) => setTimeout(resolve, 1_100));
				await assert.rejects(
					readFile(escapedSentinelPath),
					(error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
				);
				await assertPathMissing(transientCachePath(body.jobId, COMPILER_GYM_WARM_TASKS[0]));
			} finally {
				if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
				await rm(root, { recursive: true, force: true });
			}
		}
	});
});

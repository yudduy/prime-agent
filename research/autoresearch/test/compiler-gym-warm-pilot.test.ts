import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "../src/compiler-gym-adapter.js";
import {
	CompilerGymWarmPilotAbortError,
	type CompilerGymWarmPilotClock,
	type CompilerGymWarmPilotOptions,
	createCompilerGymWarmPilotProcessSignalScope,
	runCompilerGymWarmPilotBlock,
} from "../src/compiler-gym-warm-pilot.js";
import {
	validateCompilerGymWarmPilotTiming,
	verifyCompilerGymWarmPilotEvidence,
} from "../src/compiler-gym-warm-pilot-evidence.js";
import type {
	CompilerGymWarmPilotAcknowledgementEvidence,
	CompilerGymWarmPilotRecordEvidenceInput,
	CompilerGymWarmPilotSchedulerSnapshot,
} from "../src/compiler-gym-warm-pilot-record-evidence.js";
import { materializeCompilerGymWarmPilotRecordEvidence } from "../src/compiler-gym-warm-pilot-record-evidence.js";
import {
	COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
	COMPILER_GYM_WARM_PROTOCOL,
	COMPILER_GYM_WARM_TASKS,
	type CompilerGymWarmCleanupVerification,
	type CompilerGymWarmEvaluationInput,
	type CompilerGymWarmEvaluationResult,
	type CompilerGymWarmPoolRecord,
	type CompilerGymWarmPreparedEvaluation,
	type CompilerGymWarmRequestRecord,
	type CompilerGymWarmResultRecord,
	type CompilerGymWarmTransport,
} from "../src/compiler-gym-warm-transport.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";

const ACTIONS = ["-mem2reg", "-sroa", "-instcombine"];
const FIXED_NOW = new Date("2026-08-28T12:00:00.000Z");

function objectRecord(value: unknown): Record<string, unknown> {
	assert.equal(typeof value, "object");
	assert.notEqual(value, null);
	assert.equal(Array.isArray(value), false);
	return value as Record<string, unknown>;
}

class DeterministicClock implements CompilerGymWarmPilotClock {
	private value = 0n;

	nowNs(): bigint {
		this.value += 1_000_000n;
		return this.value;
	}
}

type FakeMode = "success" | "run-failure" | "signal" | "cleanup-failure" | "acquisition-failure";

function evaluatorStdout(benchmark: string, ir: number, size: number): string {
	return `${JSON.stringify({
		schema_version: 2,
		contract: COMPILER_GYM_VERIFIER_EPOCH,
		ok: true,
		status: "success",
		benchmark,
		metrics: { final: { IrInstructionCount: ir, ObjectTextSizeBytes: size } },
		validation: { passed: true, inputs_completed: 20, semantic_errors: [] },
		timings_seconds: { total: 0.01 },
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
	})}\n`;
}

class FakeWarmPilotTransport implements CompilerGymWarmTransport {
	closeCalls = 0;
	publishCalls = 0;
	private prepared: CompilerGymWarmPreparedEvaluation | undefined;

	constructor(
		private readonly mode: FakeMode,
		private readonly onPublish?: () => void,
	) {}

	prepareEvaluation(input: CompilerGymWarmEvaluationInput): Promise<CompilerGymWarmPreparedEvaluation> {
		if (this.mode === "acquisition-failure") {
			return Promise.reject(new Error("synthetic failure before scheduler submission"));
		}
		const pool: CompilerGymWarmPoolRecord = {
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			branchDigest: "a".repeat(64),
			poolDigest: "b".repeat(64),
			jobName: "cg-warm-pilot",
			workerSha256: "c".repeat(64),
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
			slurmId: "424242",
			workDir: "/fake/warm-pilot",
			createdAt: FIXED_NOW.toISOString(),
		};
		const request: CompilerGymWarmRequestRecord = {
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			poolDigest: pool.poolDigest,
			sequence: 0,
			jobId: input.jobId,
			manifestDigest: input.manifestDigest,
			requestDigest: "d".repeat(64),
			actionsDigest: "e".repeat(64),
			actions: [...input.actions],
			tasks: [...COMPILER_GYM_WARM_TASKS],
			publishedAt: FIXED_NOW.toISOString(),
		};
		this.prepared = {
			handle: "cg-warm-v1:fake-pool:fake-request:424242",
			pool,
			ready: [
				{
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest: pool.poolDigest,
					rank: 0,
					slurmId: pool.slurmId,
					cpusPerTask: 2,
					workerSha256: pool.workerSha256,
					evaluatorSha256: pool.evaluatorSha256,
					readyAt: FIXED_NOW.toISOString(),
				},
				{
					protocol: COMPILER_GYM_WARM_PROTOCOL,
					poolDigest: pool.poolDigest,
					rank: 1,
					slurmId: pool.slurmId,
					cpusPerTask: 2,
					workerSha256: pool.workerSha256,
					evaluatorSha256: pool.evaluatorSha256,
					readyAt: FIXED_NOW.toISOString(),
				},
			],
			request,
		};
		return Promise.resolve(this.prepared);
	}

	async publishAndWait(
		prepared: CompilerGymWarmPreparedEvaluation,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult> {
		this.publishCalls++;
		this.onPublish?.();
		if (this.mode === "run-failure") throw new Error("synthetic evaluator failure");
		if (this.mode === "signal") {
			if (!signal.aborted) {
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			}
			throw signal.reason;
		}
		const results = prepared.request.tasks.map((benchmarkId, rank) => {
			const result: CompilerGymWarmResultRecord = {
				protocol: COMPILER_GYM_WARM_PROTOCOL,
				poolDigest: prepared.pool.poolDigest,
				sequence: prepared.request.sequence,
				jobId: prepared.request.jobId,
				requestDigest: prepared.request.requestDigest,
				rank: rank as 0 | 1,
				benchmarkId,
				slurmId: prepared.pool.slurmId,
				workerSha256: prepared.pool.workerSha256,
				evaluatorSha256: prepared.pool.evaluatorSha256,
				childExitCode: 0,
				stdout: evaluatorStdout(benchmarkId, rank === 0 ? 1937 : 13706, rank === 0 ? 11000 : 150000),
				stderr: "",
				wallMs: rank === 0 ? 20 : 30,
				completedAt: FIXED_NOW.toISOString(),
			};
			return result;
		}) as [CompilerGymWarmResultRecord, CompilerGymWarmResultRecord];
		const processes: CompilerGymWarmEvaluationResult["processes"] = [
			{
				exitCode: results[0].childExitCode,
				stdout: results[0].stdout,
				stderr: results[0].stderr,
				wallMs: results[0].wallMs,
			},
			{
				exitCode: results[1].childExitCode,
				stdout: results[1].stdout,
				stderr: results[1].stderr,
				wallMs: results[1].wallMs,
			},
		];
		return {
			handle: prepared.handle,
			pool: prepared.pool,
			request: prepared.request,
			results,
			processes,
			stdoutArtifact: "fake warm stdout",
			stderrArtifact: "",
		};
	}

	resumeEvaluation(): Promise<CompilerGymWarmEvaluationResult> {
		return Promise.reject(new Error("resume is forbidden in a fresh pilot block"));
	}

	closeAndVerify(): Promise<CompilerGymWarmCleanupVerification | undefined> {
		this.closeCalls++;
		if (this.mode === "cleanup-failure") return Promise.reject(new Error("synthetic cleanup failure"));
		if (this.mode === "acquisition-failure") {
			return Promise.resolve({
				mode: "acquisition",
				protocol: "compiler-gym-warm-acquisition-cleanup-v1",
				poolDigest: "b".repeat(64),
				action: "not-submitted",
				submissionAttempted: false,
				discoveredSlurmIds: [],
				schedulerAbsent: true,
				accounting: [],
				detail: "Failure occurred before the sole sbatch invocation",
			});
		}
		if (!this.prepared) return Promise.resolve(undefined);
		return Promise.resolve({
			mode: "shutdown",
			poolDigest: this.prepared.pool.poolDigest,
			slurmId: this.prepared.pool.slurmId,
			schedulerAbsent: true,
			accountingState: "COMPLETED",
			acknowledgedRanks: [0, 1],
		});
	}
}

function candidateSha256(actions: readonly string[] = ACTIONS): string {
	return sha256Text(JSON.stringify(actions));
}

function schedulerSnapshot(
	sequence: number,
	command: "squeue" | "sacct",
	stdout: string,
): CompilerGymWarmPilotSchedulerSnapshot {
	const body = {
		sequence,
		command,
		slurmId: "424242",
		argv:
			command === "sacct"
				? ["sacct", "--noheader", "-X", "--jobs", "424242"]
				: ["squeue", "--noheader", "--jobs", "424242"],
		exitCode: 0,
		stdout,
		stderr: "",
		stdoutBytes: Buffer.byteLength(stdout),
		stderrBytes: 0,
		stdoutSha256: sha256Text(stdout),
		stderrSha256: sha256Text(""),
		capturedAt: FIXED_NOW.toISOString(),
	};
	return { ...body, recordSha256: sha256Text(`${canonicalJson(toJsonValue(body))}\n`) };
}

function acknowledgement(rank: 0 | 1): CompilerGymWarmPilotAcknowledgementEvidence {
	const raw = `${canonicalJson(
		toJsonValue({
			protocol: COMPILER_GYM_WARM_PROTOCOL,
			poolDigest: "b".repeat(64),
			rank,
			slurmId: "424242",
			acknowledgedAt: FIXED_NOW.toISOString(),
		}),
	)}\n`;
	const body = {
		poolDigest: "b".repeat(64),
		slurmId: "424242",
		rank,
		path: `/fake/warm-pilot/shutdown-ack-rank-${rank}.json`,
		raw,
		rawBytes: Buffer.byteLength(raw),
		rawSha256: sha256Text(raw),
		capturedAt: FIXED_NOW.toISOString(),
	};
	return { ...body, recordSha256: sha256Text(`${canonicalJson(toJsonValue(body))}\n`) };
}

function recordEvidenceInput(): CompilerGymWarmPilotRecordEvidenceInput {
	const accountingBody = {
		sequence: 0,
		jobIdRaw: "424242",
		user: "duynguy",
		jobName: "cg-warm-pilot",
		workDir: "/fake/warm-pilot",
		state: "COMPLETED",
		exitCode: "0:0",
		allocCpus: 4,
		elapsedRawSeconds: 3,
		cpuTimeRawSeconds: 12,
		startAt: FIXED_NOW.toISOString(),
		endAt: FIXED_NOW.toISOString(),
		capturedAt: FIXED_NOW.toISOString(),
	};
	const sacctRaw = [
		accountingBody.jobIdRaw,
		accountingBody.user,
		accountingBody.jobName,
		accountingBody.workDir,
		accountingBody.state,
		accountingBody.exitCode,
		accountingBody.allocCpus,
		accountingBody.elapsedRawSeconds,
		accountingBody.cpuTimeRawSeconds,
		accountingBody.startAt,
		accountingBody.endAt,
	].join("|");
	return {
		acquisition: {
			poolDigest: "b".repeat(64),
			clockId: "fake-backend-clock",
			source: "deterministic-test-clock",
			startedAt: FIXED_NOW.toISOString(),
			readyAt: FIXED_NOW.toISOString(),
			startedMonotonicMs: 1,
			readyMonotonicMs: 3,
			elapsedMs: 2,
			startedMonotonicNs: "1000000",
			readyMonotonicNs: "3000000",
			elapsedNs: "2000000",
		},
		schedulerAbsent: true,
		schedulerSnapshots: [schedulerSnapshot(0, "squeue", ""), schedulerSnapshot(1, "sacct", `${sacctRaw}\n`)],
		acknowledgements: [acknowledgement(0), acknowledgement(1)],
		accounting: {
			...accountingBody,
			recordSha256: sha256Text(`${canonicalJson(toJsonValue(accountingBody))}\n`),
		},
	};
}

async function makeOptions(
	mode: FakeMode,
	onPublish?: () => void,
): Promise<{ root: string; transport: FakeWarmPilotTransport; options: CompilerGymWarmPilotOptions }> {
	const root = await mkdtemp(join(tmpdir(), "prime-warm-pilot-"));
	const transport = new FakeWarmPilotTransport(mode, onPublish);
	return {
		root,
		transport,
		options: {
			blockId: `block-${mode}`,
			arm: `arm-${mode}`,
			branchId: `branch-${mode}`,
			ledgerPath: join(root, "evidence.jsonl"),
			artifactDir: join(root, "artifacts"),
			candidates: [{ candidateId: "candidate-0", actions: ACTIONS, candidateSha256: candidateSha256() }],
			createTransport: () => transport,
			recordEvidenceProvider: { collect: async () => recordEvidenceInput() },
			clock: new DeterministicClock(),
			now: () => FIXED_NOW,
		},
	};
}

async function pilotEvidence(path: string): Promise<unknown[]> {
	const events = verifyLedgerContentsStrict(await readFile(path, "utf8"));
	return events
		.filter((event) => event.kind === "run_manifest")
		.map((event) => event.payload)
		.filter(
			(payload) =>
				typeof payload === "object" &&
				payload !== null &&
				!Array.isArray(payload) &&
				payload.protocol === "compiler-gym-warm-pilot-block-v1",
		);
}

describe("CompilerGym no-model warm-pilot block", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("accepts production-style fractional monotonic milliseconds while closing exact nanoseconds", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-warm-pilot-fractional-clock-"));
		roots.push(root);
		const input = recordEvidenceInput();
		input.acquisition.startedMonotonicMs = 1.125;
		input.acquisition.readyMonotonicMs = 3.375;
		input.acquisition.elapsedMs = 2.25;
		input.acquisition.startedMonotonicNs = "1125000";
		input.acquisition.readyMonotonicNs = "3375000";
		input.acquisition.elapsedNs = "2250000";
		const evidence = await materializeCompilerGymWarmPilotRecordEvidence(
			input,
			{
				mode: "shutdown",
				poolDigest: "b".repeat(64),
				slurmId: "424242",
				schedulerAbsent: true,
				accountingState: "COMPLETED",
				acknowledgedRanks: [0, 1],
			},
			4_000_000n,
			join(root, "artifacts"),
		);
		assert.equal(evidence.acquisition.durationNs, "2250000");
	});

	it("persists verified no-allocation cleanup after a pre-submission acquisition failure", async () => {
		const fixture = await makeOptions("acquisition-failure");
		roots.push(fixture.root);
		let evidenceCollections = 0;
		fixture.options.recordEvidenceProvider = {
			collect: async () => {
				evidenceCollections++;
				return recordEvidenceInput();
			},
		};
		await assert.rejects(
			runCompilerGymWarmPilotBlock(fixture.options),
			/synthetic failure before scheduler submission/,
		);
		assert.equal(evidenceCollections, 0);
		const records = await pilotEvidence(fixture.options.ledgerPath);
		assert.deepEqual(
			records.map((record) => objectRecord(record).kind),
			["block-started", "evaluation-terminal", "cleanup-started", "cleanup-verified"],
		);
		const cleanup = objectRecord(records.at(-1));
		const data = objectRecord(cleanup.data);
		const verification = objectRecord(data.verification);
		assert.equal(verification.mode, "acquisition");
		assert.equal(verification.schedulerAbsent, true);
		assert.equal(data.recordEvidence, null);
	});

	it("persists an exact host-monotonic success manifest only after verified cleanup", async () => {
		const fixture = await makeOptions("success");
		roots.push(fixture.root);
		const result = await runCompilerGymWarmPilotBlock(fixture.options);

		assert.equal(result.outcome, "succeeded");
		assert.equal(result.jobs[0].proposal.requireFreshMeasurement, true);
		assert.equal(result.jobs[0].measurement?.reuse, undefined);
		assert.equal(fixture.transport.publishCalls, 1);
		assert.equal(fixture.transport.closeCalls, 1);
		assert.equal(result.timing.intervalsNs.candidateWall, result.timing.intervalsNs.candidateAccounted);
		assert.equal(result.timing.intervalsNs.blockTotal, result.timing.intervalsNs.accountedTotal);
		assert.equal(result.timing.transport.observedTotal, result.timing.transport.accountedTotal);
		assert.equal(result.timing.transport.allocationAndPrepare, "1000000");
		assert.equal(result.timing.transport.publishedResultWait, "1000000");
		assert.equal(result.timing.candidates[0].poolAcquireDurationNs, "2000000");
		assert.equal(
			BigInt(result.blockRecord.blockOperational.durationNs),
			BigInt(result.blockRecord.schedulerAbsentAtHostNs) - BigInt(result.blockRecord.blockOperational.startedNs),
		);
		assert.equal(result.blockRecord.closeCall.durationNs, result.timing.intervalsNs.cleanup);
		assert.equal(
			BigInt(result.timing.candidates[0].evaluationExcludingAcquireNs) + 2_000_000n,
			BigInt(result.timing.candidates[0].candidateWall.durationNs),
		);
		verifyCompilerGymWarmPilotEvidence(result.evidence, { requireEnd: true });

		const persisted = await pilotEvidence(fixture.options.ledgerPath);
		const verified = verifyCompilerGymWarmPilotEvidence(persisted, { requireEnd: true });
		assert.deepEqual(
			verified.map((event) => event.kind),
			["block-started", "evaluation-terminal", "cleanup-started", "cleanup-verified", "block-ended"],
		);
		const tampered: unknown = structuredClone(result.timing);
		assert.ok(typeof tampered === "object" && tampered !== null && "intervalsNs" in tampered);
		const intervals = tampered.intervalsNs;
		assert.ok(typeof intervals === "object" && intervals !== null);
		Object.assign(intervals, { candidateWall: "999" });
		assert.throws(() => validateCompilerGymWarmPilotTiming(tampered), /inconsistent/);
	});

	it("executes four distinct frozen candidates sequentially in one owned allocation", async () => {
		const fixture = await makeOptions("success");
		roots.push(fixture.root);
		const actionSets = [["-mem2reg"], ["-sroa"], ["-instcombine"], ["-simplifycfg"]];
		fixture.options.candidates = actionSets.map((actions, position) => ({
			candidateId: `candidate-${position}`,
			actions,
			candidateSha256: candidateSha256(actions),
		}));
		const result = await runCompilerGymWarmPilotBlock(fixture.options);
		assert.equal(result.jobs.length, 4);
		assert.equal(fixture.transport.publishCalls, 4);
		assert.equal(fixture.transport.closeCalls, 1);
		assert.equal(new Set(result.jobs.map((job) => job.proposal.manifestDigest)).size, 4);
		assert.deepEqual(
			result.timing.candidates.map((candidate) => candidate.poolAcquireDurationNs),
			["2000000", null, null, null],
		);
		const terminals = result.evidence.filter((event) => event.kind === "evaluation-terminal");
		assert.deepEqual(
			terminals.map((event) => ({
				position: (event.data as { candidatePosition: number }).candidatePosition,
				first: (event.data as { firstWarmRequest: boolean }).firstWarmRequest,
			})),
			[
				{ position: 0, first: true },
				{ position: 1, first: false },
				{ position: 2, first: false },
				{ position: 3, first: false },
			],
		);
		verifyCompilerGymWarmPilotEvidence(result.evidence, { requireEnd: true });
	});

	it("records a failed evaluation, verifies cleanup, emits the failed end manifest, then throws", async () => {
		const fixture = await makeOptions("run-failure");
		roots.push(fixture.root);
		await assert.rejects(runCompilerGymWarmPilotBlock(fixture.options), /synthetic evaluator failure/);
		assert.equal(fixture.transport.closeCalls, 1);
		const persisted = verifyCompilerGymWarmPilotEvidence(await pilotEvidence(fixture.options.ledgerPath), {
			requireEnd: true,
		});
		assert.equal(persisted.at(-1)?.kind, "block-ended");
		assert.equal((persisted.at(-1)?.data as { outcome: string }).outcome, "failed");
	});

	it("still closes the allocation when evidence persistence fails and never emits an end manifest", async () => {
		const fixture = await makeOptions("success");
		roots.push(fixture.root);
		fixture.options.persistEvidence = async (controller, record) => {
			if (record.kind === "evaluation-terminal") throw new Error("synthetic persistence failure");
			await controller.appendRunManifest(record);
		};
		await assert.rejects(runCompilerGymWarmPilotBlock(fixture.options), /synthetic persistence failure/);
		assert.equal(fixture.transport.closeCalls, 1);
		const persisted = await pilotEvidence(fixture.options.ledgerPath);
		assert.deepEqual(
			persisted.map((event) => (event as { kind: string }).kind),
			["block-started", "cleanup-started", "cleanup-verified"],
		);
	});

	it("propagates an external abort into the active request and cleans up before reporting it", async () => {
		const abort = new AbortController();
		const fixture = await makeOptions("signal", () => abort.abort(new CompilerGymWarmPilotAbortError("external")));
		roots.push(fixture.root);
		fixture.options.signal = abort.signal;
		await assert.rejects(runCompilerGymWarmPilotBlock(fixture.options), /aborted by external/);
		assert.equal(fixture.transport.closeCalls, 1);
		const persisted = verifyCompilerGymWarmPilotEvidence(await pilotEvidence(fixture.options.ledgerPath), {
			requireEnd: true,
		});
		assert.equal((persisted.at(-1)?.data as { outcome: string }).outcome, "aborted");
	});

	it("does not emit an end manifest when scheduler cleanup cannot be verified", async () => {
		const fixture = await makeOptions("cleanup-failure");
		roots.push(fixture.root);
		await assert.rejects(runCompilerGymWarmPilotBlock(fixture.options), /synthetic cleanup failure/);
		assert.equal(fixture.transport.closeCalls, 1);
		const persisted = verifyCompilerGymWarmPilotEvidence(await pilotEvidence(fixture.options.ledgerPath));
		assert.equal(persisted.at(-1)?.kind, "cleanup-failed");
		assert.equal(
			persisted.some((event) => event.kind === "block-ended"),
			false,
		);
	});

	it("kills record eligibility when root accounting does not close exactly", async () => {
		const fixture = await makeOptions("success");
		roots.push(fixture.root);
		fixture.options.recordEvidenceProvider = {
			collect: async () => {
				const invalid = recordEvidenceInput();
				invalid.accounting.cpuTimeRawSeconds = 11;
				return invalid;
			},
		};
		await assert.rejects(runCompilerGymWarmPilotBlock(fixture.options), /CPUTimeRAW/);
		assert.equal(fixture.transport.closeCalls, 1);
		const persisted = verifyCompilerGymWarmPilotEvidence(await pilotEvidence(fixture.options.ledgerPath));
		assert.equal(persisted.at(-1)?.kind, "cleanup-failed");
		assert.equal(
			persisted.some((event) => event.kind === "block-ended"),
			false,
		);
	});

	it("preserves both the run and cleanup errors", async () => {
		const fixture = await makeOptions("run-failure");
		roots.push(fixture.root);
		const transport = fixture.transport;
		transport.closeAndVerify = async () => {
			transport.closeCalls++;
			throw new Error("second cleanup failure");
		};
		await assert.rejects(runCompilerGymWarmPilotBlock(fixture.options), (error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors.length, 2);
			assert.match(String(error.errors[0]), /synthetic evaluator failure/);
			assert.match(String(error.errors[1]), /second cleanup failure/);
			return true;
		});
	});

	it("uses synchronous process handlers that only abort and are removable", () => {
		const emitter = new EventEmitter();
		const target = {
			on(signal: "SIGINT" | "SIGTERM", listener: () => void) {
				emitter.on(signal, listener);
			},
			off(signal: "SIGINT" | "SIGTERM", listener: () => void) {
				emitter.off(signal, listener);
			},
		};
		const scope = createCompilerGymWarmPilotProcessSignalScope(target);
		emitter.emit("SIGTERM");
		assert.equal(scope.signal.aborted, true);
		assert.equal(scope.receivedSignal(), "SIGTERM");
		assert.ok(scope.signal.reason instanceof CompilerGymWarmPilotAbortError);
		scope.dispose();
		assert.equal(emitter.listenerCount("SIGINT"), 0);
		assert.equal(emitter.listenerCount("SIGTERM"), 0);
	});
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import type { CompilerGymWarmPilotRecordEvidence } from "../src/compiler-gym-warm-pilot-record-evidence.js";
import type { CompilerGymWarmCloseVerification } from "../src/compiler-gym-warm-transport.js";
import { expectedStockCpuProvenance, STOCK_CPU_TASKS } from "../src/stock-cpu-protocol.js";
import {
	analyzeStockInterfaceTransportPair,
	runStockInterfaceTransportArm,
	STOCK_INTERFACE_TRANSPORT_EXPECTED,
	STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256,
	STOCK_INTERFACE_TRANSPORT_REQUESTS,
	type StockInterfaceTransportArm,
	type StockInterfaceTransportArmObservation,
	type StockInterfaceTransportArmRuntime,
	type StockInterfaceTransportClock,
} from "../src/stock-interface-transport-pair.js";
import type { EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome } from "../src/types.js";

const BRANCH_ID = "stock-interface-transport-pair-test";
const HARDWARE = {
	cluster: "Stanford FarmShare",
	partition: "normal",
	cpuConstraint: "CPU_SKU:9384X",
} as const;
const PROVENANCE = expectedStockCpuProvenance(COMPILER_GYM_EVALUATOR_SHA256);
const VERIFIER_CHECKS = [
	"farmshare-environment-seal-v2",
	"pinned-cbench-patch-and-source",
	"pinned-action-space",
	"raw-metrics",
	"20-base-semantic-callbacks",
] as const;

class FixedCandidateAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	constructor(private readonly arm: StockInterfaceTransportArm) {}

	async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		const candidateDigest = sha256Text(job.candidateContent);
		const expected = STOCK_INTERFACE_TRANSPORT_EXPECTED.find(
			(candidate) => candidate.candidateSha256 === candidateDigest,
		);
		if (!expected) throw new Error(`Unexpected fixed candidate ${candidateDigest}`);
		this.calls++;
		if (this.arm === "stock-warm-treatment") {
			await context.recordExternalJobId(`cg-warm-v1:${"a".repeat(64)}:${candidateDigest}:4242`);
		}
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: expected.tasks.map((task, index) => ({
				benchmarkId: task.benchmarkId,
				status: "accepted",
				metrics: {
					IrInstructionCount: task.irInstructionCount,
					ObjectTextSizeBytes: task.objectTextSizeBytes,
					...(this.arm === "stock-cold-control"
						? { schedulerAndEvaluatorWallMs: 100 + index }
						: { evaluatorProcessWallMs: 80 + index }),
				},
				verifier: { passed: true, checks: [...VERIFIER_CHECKS], errors: [] },
				runtimeMs: this.arm === "stock-cold-control" ? 100 + index : 80 + index,
			})),
			hardware: { ...HARDWARE },
			provenance: { ...PROVENANCE },
			stdout: `${this.arm}:${candidateDigest}`,
		};
	}
}

function warmVerification(mode: "shutdown" | "cancel" = "shutdown"): CompilerGymWarmCloseVerification {
	return {
		mode,
		poolDigest: "a".repeat(64),
		slurmId: "4242",
		schedulerAbsent: true,
		accountingState: mode === "shutdown" ? "COMPLETED" : "CANCELLED",
		acknowledgedRanks: mode === "shutdown" ? [0, 1] : [],
	};
}

function warmRecordEvidence(): CompilerGymWarmPilotRecordEvidence {
	return {
		acquisition: {
			poolDigest: "a".repeat(64),
			clockId: "host-monotonic-v1",
			source: "faux",
			startedAt: "2026-08-28T00:00:00.000Z",
			readyAt: "2026-08-28T00:00:01.000Z",
			startedNs: "1",
			finishedNs: "1000000001",
			durationNs: "1000000000",
		},
		schedulerAbsent: true,
		schedulerAbsentAtHostNs: "9000000000",
		schedulerSnapshots: [
			{
				command: "squeue",
				slurmId: "4242",
				argv: ["squeue", "--jobs", "4242"],
				capturedAt: "2026-08-28T00:00:10.000Z",
				stdout: { digest: "1".repeat(64), byteLength: 0, mediaType: "text/plain" },
				stderr: { digest: "2".repeat(64), byteLength: 0, mediaType: "text/plain" },
				recordSha256: "3".repeat(64),
			},
			{
				command: "sacct",
				slurmId: "4242",
				argv: ["sacct", "-X", "--jobs", "4242"],
				capturedAt: "2026-08-28T00:00:10.000Z",
				stdout: { digest: "4".repeat(64), byteLength: 1, mediaType: "text/plain" },
				stderr: { digest: "5".repeat(64), byteLength: 0, mediaType: "text/plain" },
				recordSha256: "6".repeat(64),
			},
		],
		acknowledgements: [
			{
				rank: 0,
				path: "/scratch/users/duynguy/faux/shutdown-0.json",
				capturedAt: "2026-08-28T00:00:10.000Z",
				raw: { digest: "c".repeat(64), byteLength: 1, mediaType: "application/json" },
				recordSha256: "d".repeat(64),
			},
			{
				rank: 1,
				path: "/scratch/users/duynguy/faux/shutdown-1.json",
				capturedAt: "2026-08-28T00:00:10.000Z",
				raw: { digest: "e".repeat(64), byteLength: 1, mediaType: "application/json" },
				recordSha256: "f".repeat(64),
			},
		],
		cleanup: {
			mode: "shutdown",
			acknowledgedRanks: [0, 1],
			poolDigest: "a".repeat(64),
			slurmId: "4242",
		},
		accounting: {
			sequence: 0,
			jobIdRaw: "4242",
			user: "duynguy",
			jobName: "stock-interface-pair-faux",
			workDir: "/scratch/users/duynguy/faux",
			allocCpus: 4,
			elapsedRawSeconds: 10,
			cpuTimeRawSeconds: 40,
			state: "COMPLETED",
			exitCode: "0:0",
			startAt: "2026-08-28T00:00:00.000Z",
			endAt: "2026-08-28T00:00:10.000Z",
			capturedAt: "2026-08-28T00:00:10.000Z",
			recordSha256: "b".repeat(64),
		},
	};
}

function runtime(
	arm: StockInterfaceTransportArm,
	closeMode: "shutdown" | "cancel" = "shutdown",
): StockInterfaceTransportArmRuntime & { adapter: FixedCandidateAdapter; closeCalls: number } {
	const adapter = new FixedCandidateAdapter(arm);
	const value = {
		adapter,
		closeCalls: 0,
		async closeAndVerify() {
			value.closeCalls++;
			return arm === "stock-cold-control"
				? { verification: null, recordEvidence: null }
				: {
						verification: warmVerification(closeMode),
						recordEvidence: closeMode === "shutdown" ? warmRecordEvidence() : null,
					};
		},
	};
	return value;
}

class FixedDurationClock implements StockInterfaceTransportClock {
	private readonly values: bigint[];

	constructor(durations: readonly bigint[]) {
		let cursor = 1_000_000n;
		this.values = [];
		for (const duration of durations) {
			this.values.push(cursor, cursor + duration);
			cursor += duration + 1_000n;
		}
		this.values.push(cursor);
	}

	nowNs(): bigint {
		const value = this.values.shift();
		if (value === undefined) throw new Error("Faux monotonic clock exhausted");
		return value;
	}
}

async function runArm(
	root: string,
	arm: StockInterfaceTransportArm,
	durations: readonly bigint[],
): Promise<{ observation: StockInterfaceTransportArmObservation; armRuntime: ReturnType<typeof runtime> }> {
	const armRuntime = runtime(arm);
	const observation = await runStockInterfaceTransportArm({
		arm,
		branchId: BRANCH_ID,
		outputDir: join(root, arm),
		runtime: armRuntime,
		clock: new FixedDurationClock(durations),
	});
	return { observation, armRuntime };
}

describe("stock-interface transport pair", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("uses one controller and ledger for four identical typed calls in each arm", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-transport-pair-"));
		tempDirs.push(root);
		const cold = await runArm(root, "stock-cold-control", [100n, 100n, 100n, 100n]);
		const warm = await runArm(root, "stock-warm-treatment", [80n, 80n, 80n, 80n]);

		assert.equal(cold.armRuntime.adapter.calls, 4);
		assert.equal(warm.armRuntime.adapter.calls, 4);
		assert.equal(cold.armRuntime.closeCalls, 1);
		assert.equal(warm.armRuntime.closeCalls, 1);
		assert.equal(cold.observation.controllerLifetime, "one-controller-one-ledger-four-sequential-calls-v1");
		assert.equal(warm.observation.controllerLifetime, "one-controller-one-ledger-four-sequential-calls-v1");
		assert.deepEqual(
			cold.observation.calls.map((call) => call.envelope.job.jobId),
			warm.observation.calls.map((call) => call.envelope.job.jobId),
		);
		assert.deepEqual(
			cold.observation.calls.map((call) => call.envelope.job.parentJobIds),
			[
				[],
				[cold.observation.calls[0].envelope.job.jobId],
				[cold.observation.calls[1].envelope.job.jobId],
				[cold.observation.calls[2].envelope.job.jobId],
			],
		);
		const analysis = analyzeStockInterfaceTransportPair(cold.observation, warm.observation);
		assert.equal(analysis.integrityPassed, true);
		assert.equal(analysis.coldCallSumNs, "400");
		assert.equal(analysis.warmCallSumNs, "320");
		assert.equal(analysis.latencyGatePassed, true);
		assert.equal(analysis.decision, "promote-to-agent-facing-cpu-screen");
	});

	it("keeps stock cold when the exact pair does not clear the ten-percent latency gate", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-transport-pair-slow-"));
		tempDirs.push(root);
		const cold = await runArm(root, "stock-cold-control", [100n, 100n, 100n, 100n]);
		const warm = await runArm(root, "stock-warm-treatment", [95n, 95n, 95n, 95n]);
		const analysis = analyzeStockInterfaceTransportPair(cold.observation, warm.observation);
		assert.equal(analysis.latencyGatePassed, false);
		assert.equal(analysis.decision, "keep-stock-cold");
	});

	it("fails closed on objective drift, forged timing, or non-graceful cleanup", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-transport-pair-invalid-"));
		tempDirs.push(root);
		const cold = await runArm(root, "stock-cold-control", [100n, 100n, 100n, 100n]);
		const warm = await runArm(root, "stock-warm-treatment", [80n, 80n, 80n, 80n]);

		const metricDrift = structuredClone(warm.observation);
		const firstMetric = metricDrift.calls[0].envelope.job.measurement?.tasks[0].metrics;
		assert.ok(firstMetric);
		firstMetric.IrInstructionCount = 1;
		assert.throws(() => analyzeStockInterfaceTransportPair(cold.observation, metricDrift));

		const forgedTiming = structuredClone(warm.observation);
		forgedTiming.calls[0].durationNs = "1";
		assert.throws(
			() => analyzeStockInterfaceTransportPair(cold.observation, forgedTiming),
			/Invalid typed-call interval/,
		);

		const overlappingTiming = structuredClone(warm.observation);
		overlappingTiming.calls[1].startedNs = overlappingTiming.calls[0].startedNs;
		overlappingTiming.calls[1].finishedNs = (
			BigInt(overlappingTiming.calls[1].startedNs) + BigInt(overlappingTiming.calls[1].durationNs)
		).toString(10);
		assert.throws(
			() => analyzeStockInterfaceTransportPair(cold.observation, overlappingTiming),
			/Typed-call interval overlaps its predecessor/,
		);

		const cancelled = structuredClone(warm.observation);
		cancelled.cleanup = { verification: warmVerification("cancel"), recordEvidence: null };
		assert.throws(() => analyzeStockInterfaceTransportPair(cold.observation, cancelled));

		const prematureCleanup = structuredClone(warm.observation);
		assert.ok(prematureCleanup.cleanup.recordEvidence);
		prematureCleanup.cleanup.recordEvidence.schedulerAbsentAtHostNs =
			prematureCleanup.calls.at(-1)?.finishedNs ?? "0";
		assert.throws(
			() => analyzeStockInterfaceTransportPair(cold.observation, prematureCleanup),
			/Scheduler absence must be observed after the final typed call/,
		);

		const splitWarmRoot = structuredClone(warm.observation);
		splitWarmRoot.calls[0].envelope.job.state.externalJobId = `cg-warm-v1:${"a".repeat(64)}:${"b".repeat(64)}:4243`;
		const splitWarmDurableJob = splitWarmRoot.jobs.find(
			(job) => job.proposal.jobId === splitWarmRoot.calls[0].envelope.job.jobId,
		);
		assert.ok(splitWarmDurableJob);
		splitWarmDurableJob.state.externalJobId = splitWarmRoot.calls[0].envelope.job.state.externalJobId;
		assert.throws(() => analyzeStockInterfaceTransportPair(cold.observation, splitWarmRoot));

		const missingSchedulerProof = structuredClone(warm.observation);
		assert.ok(missingSchedulerProof.cleanup.recordEvidence);
		missingSchedulerProof.cleanup.recordEvidence.schedulerSnapshots = [];
		assert.throws(
			() => analyzeStockInterfaceTransportPair(cold.observation, missingSchedulerProof),
			/Persisted scheduler snapshots are incomplete/,
		);
	});

	it("pins the four candidate sequence and its content digest", () => {
		assert.equal(STOCK_INTERFACE_TRANSPORT_REQUESTS.length, 4);
		assert.equal(STOCK_INTERFACE_TRANSPORT_EXPECTED.length, 4);
		assert.equal(
			STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256,
			"58a2bb6c5a91794e7bd7c7c50b0520b11d202e8e77c2f16a0c23add2c3eae7c2",
		);
		assert.deepEqual(
			STOCK_INTERFACE_TRANSPORT_EXPECTED.map((candidate) => candidate.candidateId),
			["C1", "C2", "C3", "C4"],
		);
		assert.deepEqual(
			STOCK_INTERFACE_TRANSPORT_EXPECTED.flatMap((candidate) => candidate.tasks.map((task) => task.benchmarkId)),
			Array.from({ length: 4 }, () => [...STOCK_CPU_TASKS]).flat(),
		);
	});
});

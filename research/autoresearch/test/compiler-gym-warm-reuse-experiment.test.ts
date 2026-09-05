import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import type { CompilerGymWarmCommandRunner } from "../src/compiler-gym-warm-farmshare-backend.js";
import type { CompilerGymWarmPilotResult } from "../src/compiler-gym-warm-pilot.js";
import {
	type CompilerGymWarmPilotRecordEvidenceInput,
	materializeCompilerGymWarmPilotRecordEvidence,
} from "../src/compiler-gym-warm-pilot-record-evidence.js";
import {
	analyzeCompilerGymAllocationReuseMatchedBlock,
	type CompilerGymAllocationObservation,
	type CompilerGymAllocationRunSpec,
	captureCompilerGymAllocationReuseRemotePreflight,
	compilerGymAllocationReuseExecutionNamespace,
	executeCompilerGymAllocationReuseArm,
	finalCompilerGymAllocationReuseDecision,
	loadCompilerGymAllocationReuseLocalPreflight,
} from "../src/compiler-gym-warm-reuse-experiment.js";
import {
	COMPILER_GYM_WARM_PROTOCOL,
	type CompilerGymWarmCloseVerification,
} from "../src/compiler-gym-warm-transport.js";

const temporaryEvidenceRoots: string[] = [];

after(async () => {
	await Promise.all(temporaryEvidenceRoots.map((path) => rm(path, { recursive: true, force: true })));
});

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

function schedulerSnapshot(
	sequence: number,
	command: "squeue" | "sacct",
	slurmId: string,
	argv: string[],
	stdout: string,
) {
	const body = {
		sequence,
		command,
		slurmId,
		argv,
		exitCode: 0,
		stdout,
		stderr: "",
		stdoutBytes: Buffer.byteLength(stdout),
		stderrBytes: 0,
		stdoutSha256: sha256Text(stdout),
		stderrSha256: sha256Text(""),
		capturedAt: "2026-08-28T00:00:10.000Z",
	};
	return { ...body, recordSha256: sha256Text(canonicalLine(body)) };
}

function acknowledgementEvidence(poolDigest: string, slurmId: string, rank: 0 | 1) {
	const acknowledgedAt = `2026-08-28T00:00:0${rank + 8}.000Z`;
	const raw = canonicalLine({
		protocol: COMPILER_GYM_WARM_PROTOCOL,
		poolDigest,
		rank,
		slurmId,
		acknowledgedAt,
	});
	const body = {
		poolDigest,
		slurmId,
		rank,
		path: `/fake/shutdown-ack-rank-${rank}.json`,
		raw,
		rawBytes: Buffer.byteLength(raw),
		rawSha256: sha256Text(raw),
		capturedAt: acknowledgedAt,
	};
	return { ...body, recordSha256: sha256Text(canonicalLine(body)) };
}

async function exactRecordEvidence(
	artifactRoot: string,
	poolDigest: string,
	slurmId: string,
	allocationStarted: bigint,
	allocationFinished: bigint,
) {
	const accountingBody = {
		sequence: 0,
		jobIdRaw: slurmId,
		user: "duynguy",
		jobName: "fake",
		workDir: "/fake",
		allocCpus: 4,
		elapsedRawSeconds: 10,
		cpuTimeRawSeconds: 40,
		state: "COMPLETED",
		exitCode: "0:0",
		startAt: "2026-08-28T00:00:00.000Z",
		endAt: "2026-08-28T00:00:10.000Z",
		capturedAt: "2026-08-28T00:00:10.000Z",
	};
	const accounting = { ...accountingBody, recordSha256: sha256Text(canonicalLine(accountingBody)) };
	const sacct = `${[
		accounting.jobIdRaw,
		accounting.user,
		accounting.jobName,
		accounting.workDir,
		accounting.state,
		accounting.exitCode,
		accounting.allocCpus,
		accounting.elapsedRawSeconds,
		accounting.cpuTimeRawSeconds,
		accounting.startAt,
		accounting.endAt,
	].join("|")}\n`;
	const input: CompilerGymWarmPilotRecordEvidenceInput = {
		acquisition: {
			poolDigest,
			clockId: "fake-host-monotonic-v1",
			source: "fake-process.hrtime.bigint",
			startedAt: "2026-08-28T00:00:00.000Z",
			readyAt: "2026-08-28T00:00:02.000Z",
			startedMonotonicMs: Number(allocationStarted) / 1_000_000,
			readyMonotonicMs: Number(allocationStarted + 2_000_000_000n) / 1_000_000,
			elapsedMs: 2_000,
			startedMonotonicNs: allocationStarted.toString(10),
			readyMonotonicNs: (allocationStarted + 2_000_000_000n).toString(10),
			elapsedNs: "2000000000",
		},
		schedulerAbsent: true,
		schedulerSnapshots: [
			schedulerSnapshot(0, "squeue", slurmId, ["/usr/bin/squeue", "--jobs", slurmId], ""),
			schedulerSnapshot(1, "sacct", slurmId, ["/usr/bin/sacct", "-X", "--jobs", slurmId], sacct),
		],
		acknowledgements: [
			acknowledgementEvidence(poolDigest, slurmId, 0),
			acknowledgementEvidence(poolDigest, slurmId, 1),
		],
		accounting,
	};
	const verification: CompilerGymWarmCloseVerification = {
		mode: "shutdown",
		poolDigest,
		slurmId,
		schedulerAbsent: true,
		accountingState: "COMPLETED",
		acknowledgedRanks: [0, 1],
	};
	return materializeCompilerGymWarmPilotRecordEvidence(input, verification, allocationFinished, artifactRoot);
}

function interval(started: bigint, finished: bigint) {
	return {
		clockId: "host-monotonic-v1" as const,
		source: "process.hrtime.bigint" as const,
		startedNs: started.toString(10),
		finishedNs: finished.toString(10),
		durationNs: (finished - started).toString(10),
	};
}

function fakeAllocationRunner(
	controlDurationNs: bigint | readonly bigint[],
	treatmentDurationNs: bigint | readonly bigint[],
): (spec: CompilerGymAllocationRunSpec) => Promise<CompilerGymAllocationObservation> {
	let cursor = 1_000_000_000n;
	let slurmId = 1000;
	let artifactRootPromise: Promise<string> | undefined;
	const artifactRoot = (): Promise<string> => {
		artifactRootPromise ??= mkdtemp(join(tmpdir(), "prime-warm-reuse-evidence-")).then((path) => {
			temporaryEvidenceRoots.push(path);
			return path;
		});
		return artifactRootPromise;
	};
	return async (spec) => {
		const allocationStarted = cursor;
		const numericSlurmId = String(slurmId);
		slurmId += 1;
		const poolDigest = sha256Text(spec.branchId);
		const trials = spec.candidates.map((candidate, position) => {
			const started = cursor;
			const configured = spec.arm === "fresh-allocation-control" ? controlDurationNs : treatmentDurationNs;
			const candidateIndex = Number.parseInt(candidate.id.slice(1), 10) - 1;
			const duration = typeof configured === "bigint" ? configured : configured[candidateIndex];
			if (duration === undefined) throw new Error(`Missing fake duration for ${candidate.id}`);
			const finished = started + duration;
			cursor = finished + 100_000_000n;
			return {
				block: spec.allocationId,
				arm: spec.arm,
				position,
				candidateDigest: candidate.sha256,
				jobId: `job-${numericSlurmId}-${position}`,
				manifestDigest: candidate.sha256,
				firstWarmRequest: position === 0,
				candidateWall: interval(started, finished),
				poolAcquire: position === 0 ? { durationNs: "2000000000" } : null,
				evaluationExcludingAcquireNs: (duration - (position === 0 ? 2_000_000_000n : 0n)).toString(10),
				tasks: Object.entries(candidate.expected).map(([benchmarkId, expected]) => ({
					benchmarkId,
					status: "accepted",
					verifierPassed: true,
					irInstructionCount: expected.irInstructions,
					objectTextSizeBytes: expected.objectTextBytes,
					evaluatorReportedTotalNs: "1000000000",
					stdoutRef: null,
					stderrRef: null,
					slurmJobId: numericSlurmId,
				})),
			};
		});
		const allocationFinished = cursor + 900_000_000n;
		cursor = allocationFinished + 100_000_000n;
		const recordEvidence = await exactRecordEvidence(
			await artifactRoot(),
			poolDigest,
			numericSlurmId,
			allocationStarted,
			allocationFinished,
		);
		const result = {
			blockId: spec.allocationId,
			arm: spec.arm,
			jobs: [],
			outcome: "succeeded",
			cleanup: {
				mode: "shutdown",
				poolDigest,
				slurmId: numericSlurmId,
				schedulerAbsent: true,
				accountingState: "COMPLETED",
				acknowledgedRanks: [0, 1],
			},
			recordEvidence,
			timing: {},
			evidence: [],
			trials,
			blockRecord: {
				block: spec.allocationId,
				arm: spec.arm,
				poolDigest,
				slurmId: numericSlurmId,
				serviceSpan: interval(allocationStarted, cursor - 1_000_000_000n),
				closeCall: interval(allocationFinished - 900_000_000n, allocationFinished),
				blockOperational: interval(allocationStarted, allocationFinished),
				schedulerAbsentAtHostNs: allocationFinished.toString(10),
				cleanup: {
					mode: "shutdown",
					acknowledgedRanks: [0, 1],
					poolDigest,
					slurmId: numericSlurmId,
				},
				accounting: recordEvidence.accounting,
			},
		} as unknown as CompilerGymWarmPilotResult;
		return { allocationId: spec.allocationId, arm: spec.arm, result };
	};
}

function fakeRemotePreflightRunner(queueOutput = "", environmentPass = true): CompilerGymWarmCommandRunner {
	return {
		run: async (request) => {
			const command = request.argv.at(-1) ?? "";
			let stdout = "";
			if (command.includes("/usr/bin/id")) stdout = "duynguy\n";
			else if (command.includes("--version")) stdout = "slurm 26.05.1\n";
			else if (command.includes("/usr/bin/squeue")) stdout = queueOutput;
			else if (command.includes("compiler_gym_env_probe.py")) {
				stdout = `${JSON.stringify({
					protocol: "compiler-gym-farmshare-environment-probe-v1",
					pass: environmentPass,
				})}\n`;
			}
			return { exitCode: 0, stdout, stderr: "", wallMs: 1 };
		},
	};
}

describe("CompilerGym allocation-reuse experiment", () => {
	const executionNamespace = "e".repeat(64);

	it("rejects a nonempty queue or a failed pinned environment seal before dispatch", async () => {
		const passing = await captureCompilerGymAllocationReuseRemotePreflight(fakeRemotePreflightRunner());
		assert.equal(passing.pass, true);

		const queued = await captureCompilerGymAllocationReuseRemotePreflight(
			fakeRemotePreflightRunner("12345|PENDING|normal|other|Resources\n"),
		);
		assert.equal(queued.pass, false);
		assert.match(queued.failure ?? "", /queue was not empty/);

		const drifted = await captureCompilerGymAllocationReuseRemotePreflight(fakeRemotePreflightRunner("", false));
		assert.equal(drifted.pass, false);
		assert.match(drifted.failure ?? "", /environment seal/);
	});

	it("rehashes the frozen source ledger, candidates, verifier, and local runtime", async () => {
		const preflight = await loadCompilerGymAllocationReuseLocalPreflight();
		assert.equal(preflight.sourceLedgerEventCount, 26);
		assert.equal(preflight.candidates.length, 4);
		assert.deepEqual(
			preflight.candidates.map((candidate) => candidate.actions.length),
			[7, 18, 22, 28],
		);
	});

	it("uses four fresh roots for control and one persistent root for treatment", async () => {
		const preflight = await loadCompilerGymAllocationReuseLocalPreflight();
		const runner = fakeAllocationRunner(10_000_000_000n, 6_000_000_000n);
		const control = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1",
			"fresh-allocation-control",
			preflight.candidates,
			runner,
		);
		const treatment = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1",
			"persistent-allocation-treatment",
			preflight.candidates,
			runner,
		);
		assert.equal(control.allocations.length, 4);
		assert.equal(treatment.allocations.length, 1);
		assert.equal(control.trials.length + treatment.trials.length, 8);
		const analysis = analyzeCompilerGymAllocationReuseMatchedBlock("B1", preflight.candidates, control, treatment);
		assert.equal(analysis.treatmentWins, 4);
		assert.equal(analysis.b1Kill, false);
	});

	it("binds every remote branch route to the sealed execution namespace", async () => {
		const preflight = await loadCompilerGymAllocationReuseLocalPreflight();
		const branchIds: string[] = [];
		const base = fakeAllocationRunner(10_000_000_000n, 6_000_000_000n);
		const capture = async (spec: CompilerGymAllocationRunSpec) => {
			branchIds.push(spec.branchId);
			return base(spec);
		};
		await executeCompilerGymAllocationReuseArm(
			"a".repeat(64),
			"smoke",
			"namespace",
			"fresh-allocation-control",
			preflight.candidates.slice(0, 1),
			capture,
		);
		await executeCompilerGymAllocationReuseArm(
			"b".repeat(64),
			"smoke",
			"namespace",
			"fresh-allocation-control",
			preflight.candidates.slice(0, 1),
			capture,
		);
		assert.equal(branchIds.length, 2);
		assert.notEqual(branchIds[0], branchIds[1]);
		assert.match(branchIds[0] ?? "", new RegExp(`:${"a".repeat(64)}:`));
		await assert.rejects(
			executeCompilerGymAllocationReuseArm(
				"not-a-digest",
				"smoke",
				"namespace",
				"fresh-allocation-control",
				preflight.candidates.slice(0, 1),
				capture,
			),
			/execution namespace must be a SHA-256 digest/,
		);
	});

	it("derives distinct execution namespaces for distinct immutable output epochs", () => {
		const runtimeDigest = "c".repeat(64);
		const first = compilerGymAllocationReuseExecutionNamespace(runtimeDigest, "execution-v6", "/tmp/run-a");
		const second = compilerGymAllocationReuseExecutionNamespace(runtimeDigest, "execution-v6", "/tmp/run-b");
		assert.match(first, /^[0-9a-f]{64}$/);
		assert.notEqual(first, second);
		assert.notEqual(first, compilerGymAllocationReuseExecutionNamespace(runtimeDigest, "execution-v7", "/tmp/run-a"));
	});

	it("requires graceful shutdown evidence for every record-eligible allocation", async () => {
		const preflight = await loadCompilerGymAllocationReuseLocalPreflight();
		const base = fakeAllocationRunner(10_000_000_000n, 6_000_000_000n);
		await assert.rejects(
			executeCompilerGymAllocationReuseArm(
				executionNamespace,
				"smoke",
				"cancel-fallback",
				"fresh-allocation-control",
				preflight.candidates.slice(0, 1),
				async (spec) => {
					const observation = await base(spec);
					const evidence = observation.result.recordEvidence;
					const squeue = evidence.schedulerSnapshots.find(
						(snapshot) => snapshot.command === "squeue" && snapshot.slurmId === evidence.cleanup.slurmId,
					);
					const sacct = evidence.schedulerSnapshots.find(
						(snapshot) =>
							snapshot.command === "sacct" &&
							snapshot.slurmId === evidence.cleanup.slurmId &&
							snapshot.argv.includes("-X"),
					);
					assert.equal(squeue?.stdout.byteLength, 0);
					assert.ok((sacct?.stdout.byteLength ?? 0) > 0);
					assert.deepEqual(
						evidence.acknowledgements.map((acknowledgement) => acknowledgement.rank),
						[0, 1],
					);
					return {
						...observation,
						result: {
							...observation.result,
							cleanup: { ...observation.result.cleanup, mode: "cancel" },
						},
					};
				},
			),
			/graceful shutdown path/,
		);
	});

	it("applies the exact sequential kill and final promotion thresholds", async () => {
		const preflight = await loadCompilerGymAllocationReuseLocalPreflight();
		const positiveRunner = fakeAllocationRunner(10_000_000_000n, 6_000_000_000n);
		const control = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1",
			"fresh-allocation-control",
			preflight.candidates,
			positiveRunner,
		);
		const treatment = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1",
			"persistent-allocation-treatment",
			preflight.candidates,
			positiveRunner,
		);
		const positive = analyzeCompilerGymAllocationReuseMatchedBlock("B1", preflight.candidates, control, treatment);
		assert.equal(
			finalCompilerGymAllocationReuseDecision([positive, { ...positive, blockId: "B2" }]).decision,
			"promote-to-stock-cold-transport",
		);

		const negativeRunner = fakeAllocationRunner(10_000_000_000n, 12_000_000_000n);
		const negativeControl = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1-negative",
			"fresh-allocation-control",
			preflight.candidates,
			negativeRunner,
		);
		const negativeTreatment = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1-negative",
			"persistent-allocation-treatment",
			preflight.candidates,
			negativeRunner,
		);
		const negative = analyzeCompilerGymAllocationReuseMatchedBlock(
			"B1-negative",
			preflight.candidates,
			negativeControl,
			negativeTreatment,
		);
		assert.equal(negative.b1Kill, true);
	});

	it("uses strict summed candidate-wall gates and inclusive final effect thresholds", async () => {
		const preflight = await loadCompilerGymAllocationReuseLocalPreflight();
		const exactSumRunner = fakeAllocationRunner(10_000_000_000n, [
			9_700_000_000n,
			9_700_000_000n,
			9_700_000_000n,
			10_900_000_000n,
		]);
		const equalControl = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"equal-sum",
			"fresh-allocation-control",
			preflight.candidates,
			exactSumRunner,
		);
		const equalTreatment = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"equal-sum",
			"persistent-allocation-treatment",
			preflight.candidates,
			exactSumRunner,
		);
		const equal = analyzeCompilerGymAllocationReuseMatchedBlock(
			"equal-sum",
			preflight.candidates,
			equalControl,
			equalTreatment,
		);
		assert.equal(equal.treatmentWins, 3);
		assert.equal(equal.treatmentCandidateWallSumLower, false);
		assert.equal(equal.b1Kill, true);

		const exactSlowRunner = fakeAllocationRunner(10_000_000_000n, [
			9_000_000_000n,
			9_000_000_000n,
			9_000_000_000n,
			11_000_000_000n,
		]);
		const slowControl = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"exact-ten-percent-slower",
			"fresh-allocation-control",
			preflight.candidates,
			exactSlowRunner,
		);
		const slowTreatment = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"exact-ten-percent-slower",
			"persistent-allocation-treatment",
			preflight.candidates,
			exactSlowRunner,
		);
		const exactSlow = analyzeCompilerGymAllocationReuseMatchedBlock(
			"exact-ten-percent-slower",
			preflight.candidates,
			slowControl,
			slowTreatment,
		);
		assert.equal(exactSlow.anyTreatmentMoreThanTenPercentSlower, false);
		assert.equal(exactSlow.b1Kill, false);

		const thresholdRunnerB1 = fakeAllocationRunner(20_000_000_000n, 18_000_000_000n);
		const thresholdControlB1 = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1-threshold",
			"fresh-allocation-control",
			preflight.candidates,
			thresholdRunnerB1,
		);
		const thresholdTreatmentB1 = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B1-threshold",
			"persistent-allocation-treatment",
			preflight.candidates,
			thresholdRunnerB1,
		);
		const thresholdB1 = analyzeCompilerGymAllocationReuseMatchedBlock(
			"B1",
			preflight.candidates,
			thresholdControlB1,
			thresholdTreatmentB1,
		);
		const thresholdRunnerB2 = fakeAllocationRunner(20_000_000_000n, [
			20_000_000_000n,
			18_000_000_000n,
			18_000_000_000n,
			18_000_000_000n,
		]);
		const thresholdControlB2 = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B2-threshold",
			"fresh-allocation-control",
			preflight.candidates,
			thresholdRunnerB2,
		);
		const thresholdTreatmentB2 = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"B2-threshold",
			"persistent-allocation-treatment",
			preflight.candidates,
			thresholdRunnerB2,
		);
		const thresholdB2 = analyzeCompilerGymAllocationReuseMatchedBlock(
			"B2",
			preflight.candidates,
			thresholdControlB2,
			thresholdTreatmentB2,
		);
		const decision = finalCompilerGymAllocationReuseDecision([thresholdB1, thresholdB2]);
		assert.equal(decision.treatmentWins, 7);
		assert.equal(decision.medianAbsoluteSavingNs, 2_000_000_000);
		assert.equal(decision.medianFractionalSaving, 0.1);
		assert.equal(decision.decision, "promote-to-stock-cold-transport");
	});

	it("rejects a claimed candidate-wall aggregate that does not close against trial evidence", async () => {
		const preflight = await loadCompilerGymAllocationReuseLocalPreflight();
		const runner = fakeAllocationRunner(10_000_000_000n, 6_000_000_000n);
		const control = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"aggregate-integrity",
			"fresh-allocation-control",
			preflight.candidates,
			runner,
		);
		const treatment = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			"main",
			"aggregate-integrity",
			"persistent-allocation-treatment",
			preflight.candidates,
			runner,
		);
		assert.throws(
			() =>
				analyzeCompilerGymAllocationReuseMatchedBlock("aggregate-integrity", preflight.candidates, control, {
					...treatment,
					candidateWallSumNs: "1",
				}),
			/aggregate does not close/,
		);
	});
});

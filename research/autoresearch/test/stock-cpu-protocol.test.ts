import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	assessStockCpuCompletion,
	expectedStockCpuProvenance,
	parseStockChampion,
	parseStockChampionReport,
	parseStockCpuCalibration,
	parseStockCpuEvaluationRequest,
	STOCK_CPU_BRANCH_ID,
	STOCK_CPU_CHAMPION_POLICY,
	STOCK_CPU_MAX_SUBMISSIONS,
	STOCK_CPU_TASKS,
	STOCK_CPU_TREATMENT,
	type StockCpuSelectionScope,
	selectStockCpuChampion,
} from "../src/stock-cpu-protocol.js";
import type { JobView, ProposalRecord } from "../src/types.js";

const CAMPAIGN_SHA256 = "c".repeat(64);
const EVALUATOR_SHA256 = "e".repeat(64);
const NOW = "2026-08-27T12:00:00.000Z";

function proposalWithIdentity(
	branchId: string,
	treatment: string,
	content: string,
	proposalDetails: ProposalRecord["proposal"],
): ProposalRecord {
	const manifestBody: Omit<ProposalRecord, "jobId" | "manifestDigest"> = {
		branchId,
		lane: "compiler-gym",
		benchmarkIds: [...STOCK_CPU_TASKS],
		budgetClass: "smoke",
		treatment,
		proposal: proposalDetails,
		candidate: {
			digest: sha256Text(content),
			byteLength: Buffer.byteLength(content),
			mediaType: "application/vnd.prime.llvm-pass-sequence",
		},
		candidateFormat: "llvm-pass-sequence",
	};
	const manifestDigest = sha256Json(manifestBody);
	return {
		jobId: `job_${manifestDigest.slice(0, 24)}`,
		manifestDigest,
		...manifestBody,
	};
}

function calibrationFixture() {
	const request = {
		branchId: "stock-calibration-v2",
		treatment: "calibration",
		benchmarks: [...STOCK_CPU_TASKS],
		actions: [] as string[],
		hypothesis: "Measure the empty pass sequence",
		mechanism: "Establish task-local denominators",
		predictedOutcome: "Both tasks pass semantic validation",
		boundaryConditions: ["CompilerGym v2 sealed environment"],
		parentJobIds: [] as string[],
	};
	const proposal = proposalWithIdentity(request.branchId, request.treatment, "[]", {
		hypothesis: request.hypothesis,
		mechanism: request.mechanism,
		predictedOutcome: request.predictedOutcome,
		boundaryConditions: request.boundaryConditions,
		parentJobIds: request.parentJobIds,
	});
	return {
		type: "compiler_gym_evaluation",
		campaignConfigSha256: CAMPAIGN_SHA256,
		request,
		submitted: {
			jobId: proposal.jobId,
			acceptedAt: NOW,
			manifestDigest: proposal.manifestDigest,
			duplicate: false,
		},
		job: {
			proposal,
			state: {
				jobId: proposal.jobId,
				status: "succeeded",
				statusAt: NOW,
				externalJobId: null,
				reason: null,
			},
			measurement: {
				jobId: proposal.jobId,
				manifestDigest: proposal.manifestDigest,
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				measuredAt: NOW,
				tasks: [
					{
						benchmarkId: STOCK_CPU_TASKS[0],
						status: "accepted",
						metrics: {
							IrInstructionCount: 100,
							ObjectTextSizeBytes: 1_000,
							schedulerAndEvaluatorWallMs: 10,
						},
						verifier: { passed: true, checks: ["v2"], errors: [] as string[] },
						runtimeMs: 10,
					},
					{
						benchmarkId: STOCK_CPU_TASKS[1],
						status: "accepted",
						metrics: {
							IrInstructionCount: 200,
							ObjectTextSizeBytes: 2_000,
							schedulerAndEvaluatorWallMs: 20,
						},
						verifier: { passed: true, checks: ["v2"], errors: [] as string[] },
						runtimeMs: 20,
					},
				],
				hardware: {
					cluster: "Stanford FarmShare",
					partition: "normal",
					cpuConstraint: "CPU_SKU:9384X",
				},
				provenance: expectedStockCpuProvenance(EVALUATOR_SHA256),
				stdout: null,
				stderr: null,
			},
		},
	};
}

function parsedCalibration() {
	return parseStockCpuCalibration(calibrationFixture(), CAMPAIGN_SHA256, EVALUATOR_SHA256);
}

function candidateJob(
	actions: readonly string[],
	irCounts: readonly [number, number],
	scope: Pick<StockCpuSelectionScope, "branchId" | "treatment"> = {
		branchId: STOCK_CPU_BRANCH_ID,
		treatment: STOCK_CPU_TREATMENT,
	},
): JobView {
	const content = JSON.stringify(actions);
	const proposal = proposalWithIdentity(scope.branchId, scope.treatment, content, {
		hypothesis: `Evaluate ${content}`,
		mechanism: "Fixture mechanism",
		predictedOutcome: "Fixture outcome",
		boundaryConditions: ["Fixture boundary"],
		parentJobIds: [],
	});
	return {
		proposal,
		state: {
			jobId: proposal.jobId,
			status: "succeeded",
			statusAt: NOW,
			externalJobId: null,
			reason: null,
		},
		measurement: {
			jobId: proposal.jobId,
			manifestDigest: proposal.manifestDigest,
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			measuredAt: NOW,
			tasks: STOCK_CPU_TASKS.map((benchmarkId, index) => ({
				benchmarkId,
				status: "accepted" as const,
				metrics: {
					IrInstructionCount: irCounts[index],
					ObjectTextSizeBytes: 1_000 + index,
				},
				verifier: { passed: true, checks: ["v2"], errors: [] },
				runtimeMs: 10,
			})),
			hardware: {
				cluster: "Stanford FarmShare",
				partition: "normal",
				cpuConstraint: "CPU_SKU:9384X",
			},
			provenance: expectedStockCpuProvenance(EVALUATOR_SHA256),
			stdout: null,
			stderr: null,
		},
	};
}

test("stock CPU request accepts only the candidate proposal envelope", () => {
	assert.deepEqual(
		parseStockCpuEvaluationRequest({
			actions: ["-mem2reg", "-instcombine"],
			hypothesis: "Promote allocas before folding instructions",
			mechanism: "SSA promotion exposes constants",
			predictedOutcome: "Both task counts decrease",
			boundaryConditions: ["LLVM 10 legacy pass manager"],
		}),
		{
			actions: ["-mem2reg", "-instcombine"],
			hypothesis: "Promote allocas before folding instructions",
			mechanism: "SSA promotion exposes constants",
			predictedOutcome: "Both task counts decrease",
			boundaryConditions: ["LLVM 10 legacy pass manager"],
		},
	);
	assert.throws(
		() =>
			parseStockCpuEvaluationRequest({
				actions: ["-mem2reg"],
				hypothesis: "h",
				mechanism: "m",
				predictedOutcome: "p",
				boundaryConditions: [],
				benchmarks: ["benchmark://cbench-v1/crc32"],
			}),
		/unknown=benchmarks/,
	);
});

test("stock CPU protocol freezes the matched smoke budget, tasks, and champion policy", () => {
	assert.equal(STOCK_CPU_MAX_SUBMISSIONS, 4);
	assert.deepEqual(STOCK_CPU_TASKS, ["benchmark://cbench-v1/blowfish", "benchmark://cbench-v1/bzip2"]);
	assert.equal(STOCK_CPU_CHAMPION_POLICY.id, "accepted-v2-pareto-minimax-ir-v1");
});

test("stock champion parser accepts only an exact submitted report", () => {
	const jobId = `job_${"a".repeat(24)}`;
	assert.equal(parseStockChampion(`done\nCHAMPION ${jobId}`, [jobId]), jobId);
	assert.equal(parseStockChampion("CHAMPION NONE", [jobId]), null);
	assert.deepEqual(parseStockChampionReport(`analysis\nCHAMPION ${jobId}`, [jobId]), {
		line: `CHAMPION ${jobId}`,
		jobId,
	});
	assert.throws(() => parseStockChampionReport("no report", [jobId]), /exact CHAMPION line/);
	assert.throws(() => parseStockChampion(`CHAMPION job_${"b".repeat(24)}`, [jobId]), /not a submitted job/);
});

test("calibration loader accepts a succeeded, fully verified CompilerGym v2 result", () => {
	const calibration = parsedCalibration();
	assert.equal(calibration.jobId, calibrationFixture().job.proposal.jobId);
	assert.deepEqual(
		calibration.tasks.map((task) => [task.benchmarkId, task.irInstructionCount, task.objectTextSizeBytes]),
		[
			[STOCK_CPU_TASKS[0], 100, 1_000],
			[STOCK_CPU_TASKS[1], 200, 2_000],
		],
	);
	assert.deepEqual(calibration.provenance, expectedStockCpuProvenance(EVALUATOR_SHA256));
});

test("calibration loader fails closed on status, verifier, epoch, provenance, metrics, and coverage", async (t) => {
	await t.test("job status", () => {
		const value = calibrationFixture();
		value.job.state.status = "failed";
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/job\.state\.status mismatch/,
		);
	});
	await t.test("task status", () => {
		const value = calibrationFixture();
		value.job.measurement.tasks[0].status = "rejected";
		assert.throws(() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256), /status mismatch/);
	});
	await t.test("verifier pass flag", () => {
		const value = calibrationFixture();
		value.job.measurement.tasks[0].verifier.passed = false;
		assert.throws(() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256), /passed mismatch/);
	});
	await t.test("historical verifier epoch", () => {
		const value = calibrationFixture();
		value.job.measurement.verifierEpoch = "compiler-gym-v0.2.5-cbench-base20-raw-v1" as never;
		assert.throws(() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256), /verifierEpoch mismatch/);
	});
	await t.test("evaluator provenance", () => {
		const value = calibrationFixture();
		value.job.measurement.provenance.evaluatorSha256 = "f".repeat(64);
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/evaluatorSha256 mismatch/,
		);
	});
	await t.test("environment provenance", () => {
		const value = calibrationFixture();
		value.job.measurement.provenance.environmentSpecSha256 = "f".repeat(64) as never;
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/environmentSpecSha256 mismatch/,
		);
	});
	await t.test("unexpected provenance field", () => {
		const value = calibrationFixture();
		const provenance: Record<string, unknown> = value.job.measurement.provenance;
		provenance.unbound = "value";
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/provenance keys mismatch/,
		);
	});
	await t.test("negative metric", () => {
		const value = calibrationFixture();
		value.job.measurement.tasks[0].metrics.IrInstructionCount = -1;
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/nonnegative safe integer/,
		);
	});
	await t.test("fractional metric", () => {
		const value = calibrationFixture();
		value.job.measurement.tasks[0].metrics.ObjectTextSizeBytes = 1.5;
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/nonnegative safe integer/,
		);
	});
	await t.test("task coverage", () => {
		const value = calibrationFixture();
		value.job.measurement.tasks.reverse();
		assert.throws(() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256), /benchmarkId mismatch/);
	});
});

test("calibration loader binds request, submission, job, manifest, and measurement identities", async (t) => {
	await t.test("request and proposal", () => {
		const value = calibrationFixture();
		value.request.hypothesis = "different";
		assert.throws(() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256), /hypothesis mismatch/);
	});
	await t.test("candidate digest", () => {
		const value = calibrationFixture();
		value.job.proposal.candidate.digest = "f".repeat(64);
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/manifestDigest mismatch/,
		);
	});
	await t.test("job ID", () => {
		const value = calibrationFixture();
		value.job.proposal.jobId = `job_${"f".repeat(24)}`;
		assert.throws(() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256), /jobId mismatch/);
	});
	await t.test("submission ID", () => {
		const value = calibrationFixture();
		value.submitted.jobId = `job_${"f".repeat(24)}`;
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/submitted\.jobId mismatch/,
		);
	});
	await t.test("measurement manifest", () => {
		const value = calibrationFixture();
		value.job.measurement.manifestDigest = "f".repeat(64);
		assert.throws(
			() => parseStockCpuCalibration(value, CAMPAIGN_SHA256, EVALUATOR_SHA256),
			/measurement\.manifestDigest mismatch/,
		);
	});
});

test("host champion selection applies full-candidate Pareto and normalized minimax rules deterministically", () => {
	const calibration = parsedCalibration();
	const candidateA = candidateJob(["-a"], [60, 80]);
	const candidateB = candidateJob(["-b"], [50, 110]);
	const dominated = candidateJob(["-c"], [70, 120]);
	const first = selectStockCpuChampion([candidateA, candidateB, dominated], calibration);
	const second = selectStockCpuChampion([dominated, candidateB, candidateA], calibration);
	assert.equal(first.selectedJobId, candidateB.proposal.jobId);
	assert.equal(second.selectedJobId, candidateB.proposal.jobId);
	assert.deepEqual(first.rankedParetoJobIds, [candidateB.proposal.jobId, candidateA.proposal.jobId]);
	assert.deepEqual(first.paretoFrontierJobIds.sort(), [candidateA.proposal.jobId, candidateB.proposal.jobId].sort());
	assert.equal(first.eligibleCandidates.length, 3);
	assert.deepEqual(first.rankedParetoJobIds, second.rankedParetoJobIds);
});

test("host champion selection excludes historical and partially accepted ledger jobs with evidence", () => {
	const calibration = parsedCalibration();
	const accepted = candidateJob(["-accepted"], [80, 160]);
	const historical = candidateJob(["-historical"], [1, 1]);
	assert.ok(historical.measurement);
	historical.measurement.verifierEpoch = "compiler-gym-v0.2.5-cbench-base20-raw-v1";
	const rejected = candidateJob(["-rejected"], [1, 1]);
	assert.ok(rejected.measurement);
	rejected.measurement.tasks[0].status = "rejected";
	rejected.measurement.tasks[0].verifier.passed = false;
	const selection = selectStockCpuChampion([historical, rejected, accepted], calibration);
	assert.equal(selection.selectedJobId, accepted.proposal.jobId);
	assert.deepEqual(
		selection.eligibleCandidates.map((candidate) => candidate.jobId),
		[accepted.proposal.jobId],
	);
	assert.match(
		selection.excludedCandidates
			.find((candidate) => candidate.jobId === historical.proposal.jobId)
			?.reasons.join("\n") ?? "",
		/not CompilerGym v2/,
	);
	assert.match(
		selection.excludedCandidates
			.find((candidate) => candidate.jobId === rejected.proposal.jobId)
			?.reasons.join("\n") ?? "",
		/not accepted/,
	);
});

test("host champion evidence represents zero calibration denominators without non-finite JSON", () => {
	const calibration = parsedCalibration();
	calibration.tasks[0].irInstructionCount = 0;
	const noRegression = candidateJob(["-zero"], [0, 180]);
	const regression = candidateJob(["-nonzero"], [1, 180]);
	const selection = selectStockCpuChampion([regression, noRegression], calibration);
	assert.equal(selection.selectedJobId, noRegression.proposal.jobId);
	const evidence = selection.eligibleCandidates.find((candidate) => candidate.jobId === noRegression.proposal.jobId);
	assert.equal(evidence?.normalizedIrRatios[0].exact, "0/0");
	assert.doesNotThrow(() => JSON.stringify(selection));
});

test("selection scope supports a custom branch and treatment without changing the exact completion count", () => {
	const calibration = parsedCalibration();
	const scope: StockCpuSelectionScope = {
		branchId: "interface-parity-typed",
		treatment: "interface-parity-neutral",
		requireFreshMeasurements: true,
	};
	const jobs = [
		candidateJob(["-custom-a"], [90, 180], scope),
		candidateJob(["-custom-b"], [80, 170], scope),
		candidateJob(["-custom-c"], [70, 160], scope),
		candidateJob(["-custom-d"], [60, 150], scope),
	];

	assert.equal(selectStockCpuChampion(jobs, calibration).selectedJobId, null);
	assert.equal(assessStockCpuCompletion(jobs, calibration).passed, false);
	assert.equal(selectStockCpuChampion(jobs, calibration, scope).selectedJobId, jobs[3].proposal.jobId);
	assert.equal(assessStockCpuCompletion(jobs, calibration, scope).passed, true);
	assert.equal(
		assessStockCpuCompletion([...jobs, candidateJob(["-custom-e"], [50, 140], scope)], calibration, scope).passed,
		false,
	);
});

test("stock completion requires exactly four terminal durable jobs and eight accepted v2 task records", async (t) => {
	const calibration = parsedCalibration();
	const completeJobs = [
		candidateJob(["-complete-a"], [90, 180]),
		candidateJob(["-complete-b"], [80, 170]),
		candidateJob(["-complete-c"], [70, 160]),
		candidateJob(["-complete-d"], [60, 150]),
	];
	const complete = assessStockCpuCompletion(completeJobs, calibration);
	assert.equal(complete.passed, true);
	assert.equal(complete.observedJobs, 4);
	assert.equal(complete.terminalJobs, 4);
	assert.equal(complete.durableMeasurementJobs, 4);
	assert.equal(complete.observedTaskRecords, 8);
	assert.equal(complete.acceptedV2TaskRecords, 8);
	assert.equal(complete.fullyAcceptedJobIds.length, 4);

	await t.test("four submissions with a nonterminal job do not pass", () => {
		const jobs = structuredClone(completeJobs);
		jobs[0].state.status = "running";
		const gate = assessStockCpuCompletion(jobs, calibration);
		assert.equal(gate.passed, false);
		assert.equal(gate.terminalJobs, 3);
		assert.match(gate.rejectedJobs[0]?.reasons.join("\n") ?? "", /not succeeded/);
	});

	await t.test("four submissions with a missing durable measurement do not pass", () => {
		const jobs = structuredClone(completeJobs);
		jobs[0].measurement = null;
		const gate = assessStockCpuCompletion(jobs, calibration);
		assert.equal(gate.passed, false);
		assert.equal(gate.durableMeasurementJobs, 3);
		assert.equal(gate.observedTaskRecords, 6);
		assert.match(gate.rejectedJobs[0]?.reasons.join("\n") ?? "", /measurement is missing/);
	});

	await t.test("seven task records do not pass", () => {
		const jobs = structuredClone(completeJobs);
		assert.ok(jobs[0].measurement);
		jobs[0].measurement.tasks.pop();
		const gate = assessStockCpuCompletion(jobs, calibration);
		assert.equal(gate.passed, false);
		assert.equal(gate.observedTaskRecords, 7);
		assert.equal(gate.acceptedV2TaskRecords, 7);
	});

	await t.test("a rejected task record does not pass", () => {
		const jobs = structuredClone(completeJobs);
		assert.ok(jobs[0].measurement);
		jobs[0].measurement.tasks[0].status = "rejected";
		jobs[0].measurement.tasks[0].verifier.passed = false;
		const gate = assessStockCpuCompletion(jobs, calibration);
		assert.equal(gate.passed, false);
		assert.equal(gate.acceptedV2TaskRecords, 7);
	});

	await t.test("historical v1 records do not pass", () => {
		const jobs = structuredClone(completeJobs);
		assert.ok(jobs[0].measurement);
		jobs[0].measurement.verifierEpoch = "compiler-gym-v0.2.5-cbench-base20-raw-v1";
		const gate = assessStockCpuCompletion(jobs, calibration);
		assert.equal(gate.passed, false);
		assert.equal(gate.acceptedV2TaskRecords, 6);
	});

	await t.test("five otherwise accepted jobs do not pass", () => {
		const jobs = [...completeJobs, candidateJob(["-complete-e"], [50, 140])];
		const gate = assessStockCpuCompletion(jobs, calibration);
		assert.equal(gate.passed, false);
		assert.equal(gate.observedJobs, 5);
		assert.equal(gate.acceptedV2TaskRecords, 10);
	});

	await t.test("reused measurements pass by default but fail a fresh-measurement scope", () => {
		const jobs = structuredClone(completeJobs);
		assert.ok(jobs[0].measurement);
		jobs[0].measurement.reuse = {
			policy: "deterministic-verified-measurement-v1",
			contractKey: "stock-protocol-test",
			compatibilityDigest: "a".repeat(64),
			sourceJobId: jobs[1].proposal.jobId,
			sourceManifestDigest: jobs[1].proposal.manifestDigest,
			sourceMeasurementDigest: "b".repeat(64),
			sourceMeasurementEventHash: "c".repeat(64),
			reusedMetricNames: ["IrInstructionCount", "ObjectTextSizeBytes"],
		};

		assert.equal(assessStockCpuCompletion(jobs, calibration).passed, true);
		assert.equal(selectStockCpuChampion(jobs, calibration).eligibleCandidates.length, 4);

		const freshScope = { requireFreshMeasurements: true };
		const gate = assessStockCpuCompletion(jobs, calibration, freshScope);
		assert.equal(gate.passed, false);
		assert.equal(gate.observedTaskRecords, 8);
		assert.equal(gate.acceptedV2TaskRecords, 6);
		assert.equal(gate.fullyAcceptedJobIds.length, 3);
		assert.match(gate.rejectedJobs[0]?.reasons.join("\n") ?? "", /fresh measurements are required/);
		assert.equal(selectStockCpuChampion(jobs, calibration, freshScope).eligibleCandidates.length, 3);
	});
});

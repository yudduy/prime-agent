import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Json } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	assertRResurrectionQualificationPins,
	buildRResurrectionSubmitRequest,
	decideRResurrectionQualification,
	R_RESURRECTION_CANDIDATES,
	R_RESURRECTION_EXPECTED_HARDWARE,
	R_RESURRECTION_EXPECTED_PROVENANCE,
	R_RESURRECTION_QUALIFICATION_CONFIG_SHA256,
	R_RESURRECTION_TASKS,
	type RResurrectionCellId,
} from "../src/r-resurrection-protocol.js";
import type { ArtifactRef, JobView, ProposalRecord } from "../src/types.js";

type CellMetrics = Record<RResurrectionCellId, readonly [number, number]>;

const PASSING_METRICS: CellMetrics = {
	A: [100, 200],
	"A+X": [100, 201],
	"A+E": [90, 190],
	"A+E+X": [89, 190],
};

function buildJobs(metrics: CellMetrics = PASSING_METRICS): JobView[] {
	const jobs: JobView[] = [];
	const jobIds = new Map<RResurrectionCellId, string>();
	for (const definition of R_RESURRECTION_CANDIDATES) {
		const parentJobIds = definition.parentCellIds.map((cellId) => {
			const jobId = jobIds.get(cellId);
			if (!jobId) throw new Error(`Missing test parent ${cellId}`);
			return jobId;
		});
		const request = buildRResurrectionSubmitRequest(definition.cellId, parentJobIds);
		const candidate: ArtifactRef = {
			digest: definition.candidateSha256,
			byteLength: Buffer.byteLength(definition.candidateContent),
			mediaType: "application/vnd.prime.llvm-pass-sequence",
		};
		const manifestBody = {
			branchId: request.branchId,
			lane: request.lane,
			benchmarkIds: [...request.benchmarkIds].sort(),
			budgetClass: request.budgetClass,
			treatment: request.treatment,
			proposal: request.proposal,
			candidate,
			candidateFormat: request.candidate.format,
		};
		const manifestDigest = sha256Json(manifestBody);
		const jobId = `job_${manifestDigest.slice(0, 24)}`;
		jobIds.set(definition.cellId, jobId);
		const proposal: ProposalRecord = { jobId, manifestDigest, ...manifestBody };
		jobs.push({
			proposal,
			state: {
				jobId,
				status: "succeeded",
				statusAt: "2026-08-28T00:00:00.000Z",
				externalJobId: null,
				reason: null,
			},
			measurement: {
				jobId,
				manifestDigest,
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				measuredAt: "2026-08-28T00:00:00.000Z",
				tasks: R_RESURRECTION_TASKS.map((benchmarkId, taskIndex) => ({
					benchmarkId,
					status: "accepted",
					metrics: {
						IrInstructionCount: metrics[definition.cellId][taskIndex],
						ObjectTextSizeBytes: 1_000 + taskIndex,
					},
					verifier: { passed: true, checks: ["v2"], errors: [] },
					runtimeMs: 10,
				})),
				hardware: { ...R_RESURRECTION_EXPECTED_HARDWARE },
				provenance: { ...R_RESURRECTION_EXPECTED_PROVENANCE },
				stdout: null,
				stderr: null,
			},
		});
	}
	return jobs;
}

describe("R resurrection 2x2 qualification", () => {
	it("keeps the frozen candidate and qualification hashes pinned", () => {
		assert.doesNotThrow(() => assertRResurrectionQualificationPins());
		assert.match(R_RESURRECTION_QUALIFICATION_CONFIG_SHA256, /^[a-f0-9]{64}$/);
	});

	it("passes only when X is dormant on A and conditionally useful after E", () => {
		const decision = decideRResurrectionQualification(buildJobs());
		assert.equal(decision.outcome, "passed");
		assert.equal(decision.gatePassed, true);
		assert.equal(decision.allVerifierValid, true);
		assert.equal(decision.compatibilityPassed, true);
		assert.deepEqual(decision.integrityErrors, []);
		assert.deepEqual(decision.mechanismFailures, []);
		assert.deepEqual(
			decision.effects.map((effect) => [effect.xDeltaOnA, effect.xDeltaAfterE]),
			[
				[0, -1],
				[1, 0],
			],
		);
	});

	it("returns a valid negative when X already improves A", () => {
		const decision = decideRResurrectionQualification(buildJobs({ ...PASSING_METRICS, "A+X": [99, 201] }));
		assert.equal(decision.outcome, "mechanism-not-demonstrated");
		assert.equal(decision.gatePassed, false);
		assert.deepEqual(decision.integrityErrors, []);
		assert.deepEqual(decision.mechanismFailures, ["X improves A on at least one task"]);
	});

	it("returns a valid negative when X never strictly improves after E", () => {
		const decision = decideRResurrectionQualification(buildJobs({ ...PASSING_METRICS, "A+E+X": [90, 190] }));
		assert.equal(decision.outcome, "mechanism-not-demonstrated");
		assert.equal(decision.gatePassed, false);
		assert.deepEqual(decision.mechanismFailures, ["X does not strictly improve A+E on either task"]);
	});

	it("invalidates verifier failures instead of treating their metrics as evidence", () => {
		const jobs = buildJobs();
		const failed = jobs[1];
		if (!failed?.measurement) throw new Error("Missing test measurement");
		failed.state.status = "invalid";
		failed.measurement.tasks[0]!.status = "rejected";
		failed.measurement.tasks[0]!.verifier = { passed: false, checks: [], errors: ["semantic failure"] };
		const decision = decideRResurrectionQualification(jobs);
		assert.equal(decision.outcome, "invalid");
		assert.equal(decision.gatePassed, false);
		assert.equal(decision.allVerifierValid, false);
		assert.ok(decision.integrityErrors.some((error) => error.includes("job status is invalid")));
		assert.ok(decision.integrityErrors.some((error) => error.includes("verifier failed")));
	});

	it("invalidates cross-cell hardware or provenance mismatches", () => {
		const hardwareJobs = buildJobs();
		if (!hardwareJobs[3]?.measurement) throw new Error("Missing test measurement");
		hardwareJobs[3].measurement.hardware.cpuConstraint = "CPU_SKU:DIFFERENT";
		const hardwareDecision = decideRResurrectionQualification(hardwareJobs);
		assert.equal(hardwareDecision.outcome, "invalid");
		assert.equal(hardwareDecision.compatibilityPassed, false);
		assert.ok(hardwareDecision.integrityErrors.includes("cells do not share identical hardware provenance"));

		const provenanceJobs = buildJobs();
		if (!provenanceJobs[2]?.measurement) throw new Error("Missing test measurement");
		provenanceJobs[2].measurement.provenance.evaluatorSha256 = "0".repeat(64);
		const provenanceDecision = decideRResurrectionQualification(provenanceJobs);
		assert.equal(provenanceDecision.outcome, "invalid");
		assert.equal(provenanceDecision.compatibilityPassed, false);
		assert.ok(provenanceDecision.integrityErrors.includes("cells do not share identical evaluator provenance"));
	});

	it("invalidates task-set, epoch, and candidate-definition drift", () => {
		const taskJobs = buildJobs();
		if (!taskJobs[0]?.measurement) throw new Error("Missing test measurement");
		taskJobs[0].measurement.tasks[1]!.benchmarkId = "benchmark://cbench-v1/dijkstra";
		assert.equal(decideRResurrectionQualification(taskJobs).outcome, "invalid");

		const epochJobs = buildJobs();
		if (!epochJobs[1]?.measurement) throw new Error("Missing test measurement");
		epochJobs[1].measurement.verifierEpoch = "compiler-gym-v1";
		assert.equal(decideRResurrectionQualification(epochJobs).outcome, "invalid");

		const candidateJobs = buildJobs();
		candidateJobs[2]!.proposal.candidate.digest = "f".repeat(64);
		assert.equal(decideRResurrectionQualification(candidateJobs).outcome, "invalid");
	});
});

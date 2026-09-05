import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	assessHostOwnedTerminalization,
	createHostOwnedTerminalizationRuntimeTracker,
	HOST_OWNED_TERMINALIZATION_POLICY_VERSION,
	type HostOwnedTerminalizationEvidence,
	recordHostOwnedProviderDispatch,
	recordHostOwnedToolExecution,
	recordIntentionalHostTerminalizationStop,
	shouldHostOwnTerminalization,
} from "../src/host-owned-terminalization.js";
import {
	expectedStockCpuProvenance,
	STOCK_CPU_BRANCH_ID,
	STOCK_CPU_TASKS,
	STOCK_CPU_TREATMENT,
	type StockCpuCalibration,
} from "../src/stock-cpu-protocol.js";
import type { JobView, ProposalRecord } from "../src/types.js";

const EVALUATOR_SHA256 = "e".repeat(64);
const NOW = "2026-08-28T00:00:00.000Z";
const PROVENANCE = expectedStockCpuProvenance(EVALUATOR_SHA256);
const CALIBRATION: StockCpuCalibration = {
	jobId: `job_${"c".repeat(24)}`,
	manifestDigest: "c".repeat(64),
	tasks: [
		{
			benchmarkId: STOCK_CPU_TASKS[0],
			irInstructionCount: 4_000,
			objectTextSizeBytes: 16_000,
			verifierPassed: true,
		},
		{
			benchmarkId: STOCK_CPU_TASKS[1],
			irInstructionCount: 30_000,
			objectTextSizeBytes: 120_000,
			verifierPassed: true,
		},
	],
	provenance: PROVENANCE,
};

function proposal(index: number): ProposalRecord {
	const content = JSON.stringify(["-mem2reg", ...Array.from({ length: index }, () => "-instcombine")]);
	const body: Omit<ProposalRecord, "jobId" | "manifestDigest"> = {
		branchId: STOCK_CPU_BRANCH_ID,
		lane: "compiler-gym",
		benchmarkIds: [...STOCK_CPU_TASKS],
		budgetClass: "smoke",
		treatment: STOCK_CPU_TREATMENT,
		proposal: {
			hypothesis: `Hypothesis ${index}`,
			mechanism: `Mechanism ${index}`,
			predictedOutcome: `Outcome ${index}`,
			boundaryConditions: [`Boundary ${index}`],
			parentJobIds: [],
		},
		candidate: {
			digest: sha256Text(content),
			byteLength: Buffer.byteLength(content),
			mediaType: "application/vnd.prime.llvm-pass-sequence",
		},
		candidateFormat: "llvm-pass-sequence",
	};
	const manifestDigest = sha256Json(body);
	return { jobId: `job_${manifestDigest.slice(0, 24)}`, manifestDigest, ...body };
}

function job(index: number): JobView {
	const record = proposal(index);
	return {
		proposal: record,
		state: {
			jobId: record.jobId,
			status: "succeeded",
			statusAt: NOW,
			externalJobId: null,
			reason: null,
		},
		measurement: {
			jobId: record.jobId,
			manifestDigest: record.manifestDigest,
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			measuredAt: NOW,
			tasks: STOCK_CPU_TASKS.map((benchmarkId, taskIndex) => ({
				benchmarkId,
				status: "accepted" as const,
				metrics: {
					IrInstructionCount: taskIndex === 0 ? 2_100 - index * 10 : 14_000 - index * 20,
					ObjectTextSizeBytes: 10_000 + taskIndex,
				},
				verifier: { passed: true, checks: ["fixture"], errors: [] },
				runtimeMs: 1,
			})),
			hardware: { host: "fixture" },
			provenance: PROVENANCE,
			stdout: null,
			stderr: null,
		},
	};
}

function evidence(overrides: Partial<HostOwnedTerminalizationEvidence> = {}): HostOwnedTerminalizationEvidence {
	return {
		evaluatorDispatches: 4,
		postTerminalEvaluatorDispatches: 0,
		duplicateDispatches: 0,
		providerDispatchesAfterTerminalMeasurement: 0,
		blockedProviderRequestsAfterTerminalMeasurement: 0,
		intentionalHostTerminalizationStops: 1,
		ledgerIntegrityPassed: true,
		artifactIntegrityPassed: true,
		sourceIntegrityPassed: true,
		evaluatorIntegrityPassed: true,
		coreIntegrityPassed: true,
		forbiddenBoundaryEvents: [],
		readOnlyDeviationEvents: [],
		assistantReportText: null,
		...overrides,
	};
}

function cloneJobs(jobs: readonly JobView[]): JobView[] {
	return JSON.parse(JSON.stringify(jobs)) as JobView[];
}

describe("host-owned terminalization", () => {
	const fourJobs = [job(1), job(2), job(3), job(4)];

	it("qualifies complete measurements and makes the assistant report advisory", () => {
		const missing = assessHostOwnedTerminalization(fourJobs, CALIBRATION, evidence(), {
			requireFreshMeasurements: true,
		});
		assert.equal(missing.policy.version, HOST_OWNED_TERMINALIZATION_POLICY_VERSION);
		assert.equal(missing.measurementQualified, true);
		assert.equal(missing.terminalizationRuntimeConformant, true);
		assert.equal(missing.assistantReport.status, "missing");
		assert.equal(missing.hostSelectedJobId, fourJobs[3].proposal.jobId);
		assert.deepEqual(missing.hardFailures, []);

		const mismatched = assessHostOwnedTerminalization(
			fourJobs,
			CALIBRATION,
			evidence({ assistantReportText: `CHAMPION ${fourJobs[0].proposal.jobId}` }),
			{ requireFreshMeasurements: true },
		);
		assert.equal(mismatched.measurementQualified, true);
		assert.equal(mismatched.assistantReport.status, "mismatched");
		assert.equal(mismatched.hostSelectedJobId, fourJobs[3].proposal.jobId);

		const matched = assessHostOwnedTerminalization(
			fourJobs,
			CALIBRATION,
			evidence({ assistantReportText: `CHAMPION ${fourJobs[3].proposal.jobId}` }),
			{ requireFreshMeasurements: true },
		);
		assert.equal(matched.assistantReport.status, "matched");
		assert.deepEqual(matched.deviations, []);
	});

	it("separates measurement qualification from zero-post-terminal-dispatch conformance", () => {
		const historicalFinalResponse = assessHostOwnedTerminalization(
			fourJobs,
			CALIBRATION,
			evidence({
				providerDispatchesAfterTerminalMeasurement: 1,
				assistantReportText: `CHAMPION ${fourJobs[3].proposal.jobId}`,
			}),
		);
		assert.equal(historicalFinalResponse.measurementQualified, true);
		assert.equal(historicalFinalResponse.terminalizationRuntimeConformant, false);
		assert.match(historicalFinalResponse.deviations.join("\n"), /provider dispatches occurred/);

		const historicalBlockedBeforeDispatch = assessHostOwnedTerminalization(
			fourJobs,
			CALIBRATION,
			evidence({
				blockedProviderRequestsAfterTerminalMeasurement: 1,
				intentionalHostTerminalizationStops: 0,
			}),
		);
		assert.equal(historicalBlockedBeforeDispatch.measurementQualified, true);
		assert.equal(historicalBlockedBeforeDispatch.terminalizationRuntimeConformant, false);
		assert.match(historicalBlockedBeforeDispatch.deviations.join("\n"), /requests were blocked/);
	});

	it("preserves every hard verifier, budget, integrity, and boundary failure", () => {
		const malformed = cloneJobs(fourJobs);
		assert.ok(malformed[0].measurement);
		malformed[0].measurement.tasks[0].metrics.IrInstructionCount = -1;
		const verifierFailed = cloneJobs(fourJobs);
		assert.ok(verifierFailed[0].measurement);
		verifierFailed[0].measurement.tasks[0].verifier.passed = false;

		const cases: Array<{
			name: string;
			jobs: readonly JobView[];
			evidence: HostOwnedTerminalizationEvidence;
			reason: RegExp;
		}> = [
			{
				name: "three evaluations",
				jobs: fourJobs.slice(0, 3),
				evidence: evidence({ evaluatorDispatches: 3 }),
				reason: /expected 4 evaluator dispatches/,
			},
			{
				name: "five evaluations",
				jobs: [...fourJobs, job(5)],
				evidence: evidence({ evaluatorDispatches: 5, postTerminalEvaluatorDispatches: 1 }),
				reason: /expected 4 evaluator dispatches/,
			},
			{
				name: "duplicate",
				jobs: fourJobs,
				evidence: evidence({ duplicateDispatches: 1 }),
				reason: /duplicate evaluator dispatches/,
			},
			{
				name: "forbidden inspection",
				jobs: fourJobs,
				evidence: evidence({ forbiddenBoundaryEvents: ["read evaluator source"] }),
				reason: /forbidden boundary events/,
			},
			{ name: "malformed measurement", jobs: malformed, evidence: evidence(), reason: /completion gate failed/ },
			{ name: "verifier failure", jobs: verifierFailed, evidence: evidence(), reason: /completion gate failed/ },
			{
				name: "ledger mismatch",
				jobs: fourJobs,
				evidence: evidence({ ledgerIntegrityPassed: false }),
				reason: /ledger integrity failed/,
			},
			{
				name: "artifact mismatch",
				jobs: fourJobs,
				evidence: evidence({ artifactIntegrityPassed: false }),
				reason: /artifact integrity failed/,
			},
			{
				name: "source mismatch",
				jobs: fourJobs,
				evidence: evidence({ sourceIntegrityPassed: false }),
				reason: /source integrity failed/,
			},
			{
				name: "evaluator mismatch",
				jobs: fourJobs,
				evidence: evidence({ evaluatorIntegrityPassed: false }),
				reason: /evaluator integrity failed/,
			},
			{
				name: "core mismatch",
				jobs: fourJobs,
				evidence: evidence({ coreIntegrityPassed: false }),
				reason: /Prime core integrity failed/,
			},
		];

		for (const testCase of cases) {
			const result = assessHostOwnedTerminalization(testCase.jobs, CALIBRATION, testCase.evidence, {
				requireFreshMeasurements: true,
			});
			assert.equal(result.measurementQualified, false, testCase.name);
			assert.match(result.hardFailures.join("\n"), testCase.reason, testCase.name);
		}
	});

	it("closes before a fifth provider dispatch with or without one harmless inspection", () => {
		for (const inspectFirst of [false, true]) {
			const tracker = createHostOwnedTerminalizationRuntimeTracker();
			if (inspectFirst) {
				recordHostOwnedProviderDispatch(tracker);
				assert.equal(
					recordHostOwnedToolExecution(tracker, {
						toolCallId: "inspection",
						toolName: "ipython",
						args: { code: "import os, json, subprocess\nos.getcwd(), os.listdir('.')" },
						result: { content: [{ type: "text", text: "('/tmp/arm', [])" }] },
						isError: false,
					}),
					"read-only-deviation",
				);
			}
			for (let index = 0; index < 4; index++) {
				assert.equal(shouldHostOwnTerminalization(tracker), false);
				recordHostOwnedProviderDispatch(tracker);
				assert.equal(
					recordHostOwnedToolExecution(tracker, {
						toolCallId: `evaluation-${index}`,
						toolName: "ipython",
						args: { code: `run_candidate(${index})` },
						result: { content: [{ type: "text", text: "{'type': 'stock_prime_compiler_gym_evaluation'}" }] },
						isError: false,
					}),
					"evaluator",
				);
			}
			assert.equal(shouldHostOwnTerminalization(tracker), true);
			recordIntentionalHostTerminalizationStop(tracker);
			assert.equal(tracker.providerDispatches, inspectFirst ? 5 : 4);
			assert.equal(tracker.providerDispatchesAtTerminal, tracker.providerDispatches);
			assert.equal(tracker.postTerminalProviderDispatches, 0);
			assert.equal(tracker.evaluatorToolCalls, 4);
			assert.equal(tracker.postTerminalEvaluatorToolCalls, 0);
			assert.equal(tracker.terminalizationStops, 1);
			assert.equal(tracker.readOnlyDeviationEvents.length, inspectFirst ? 1 : 0);
			assert.deepEqual(tracker.forbiddenBoundaryEvents, []);
		}
	});

	it("records unknown, failed, and duplicate tools as hard boundary evidence", () => {
		const tracker = createHostOwnedTerminalizationRuntimeTracker();
		const execution = {
			toolCallId: "bad",
			toolName: "ipython",
			args: { code: "open('/tmp/evaluator.py').read()" },
			result: { content: [{ type: "text", text: "source" }] },
			isError: false,
		};
		assert.equal(recordHostOwnedToolExecution(tracker, execution), "forbidden");
		assert.equal(recordHostOwnedToolExecution(tracker, execution), "forbidden");
		assert.equal(tracker.forbiddenBoundaryEvents.length, 2);
	});
});

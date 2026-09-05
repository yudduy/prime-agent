import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_ACTION_TRACE_CANDIDATES } from "../src/compiler-gym-action-trace-preregistration.js";
import {
	assessCompilerGymIrDeltaQualification,
	buildCompilerGymIrDeltaTreatmentEnvelopes,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL,
	type CompilerGymIrDeltaQualificationCase,
	type CompilerGymIrDeltaQualificationCaseId,
	type CompilerGymIrDeltaQualificationInput,
	parseCompilerGymIrDeltaQualificationInput,
} from "../src/compiler-gym-ir-delta-qualification-protocol.js";

const BLOWFISH = "benchmark://cbench-v1/blowfish" as const;
const BZIP2 = "benchmark://cbench-v1/bzip2" as const;

const CASES = [
	{ caseId: "S12-blowfish", candidateId: "S12", benchmarkId: BLOWFISH },
	{ caseId: "S12-bzip2", candidateId: "S12", benchmarkId: BZIP2 },
	{ caseId: "L46-bzip2", candidateId: "L46", benchmarkId: BZIP2 },
	{ caseId: "L46-blowfish", candidateId: "L46", benchmarkId: BLOWFISH },
] as const;

function candidate(candidateId: "S12" | "L46") {
	const found = COMPILER_GYM_ACTION_TRACE_CANDIDATES.find((item) => item.candidateId === candidateId);
	if (!found) throw new Error(`Missing ${candidateId}`);
	return found;
}

function qualificationCase(
	caseId: CompilerGymIrDeltaQualificationCaseId,
	ratio: number,
): CompilerGymIrDeltaQualificationCase {
	const mapping = CASES.find((item) => item.caseId === caseId);
	if (!mapping) throw new Error(`Missing ${caseId}`);
	const frozen = candidate(mapping.candidateId);
	const actions = [...frozen.actions];
	const actionIndices = actions.map((_, index) => index + 1);
	const deltas = actions.map((_, index) => (index === actions.length - 1 ? -100 : 0));
	return {
		caseId,
		candidateId: mapping.candidateId,
		candidateSha256: frozen.expectedDigest,
		benchmarkId: mapping.benchmarkId,
		actions,
		canonical: {
			initialIrInstructionCount: 1_000,
			actionIndices: [...actionIndices],
			commandline: `opt ${actions.join(" ")}`,
			final: {
				irInstructionCount: 900,
				objectTextSizeBytes: 4_096,
				verifierPassed: true,
				verifierInputsExpected: 20,
				verifierInputsCompleted: 20,
			},
			intrinsicTotalMs: 100,
		},
		treatment: {
			initialIrInstructionCount: 1_000,
			actionIndices: [...actionIndices],
			commandline: `opt ${actions.join(" ")}`,
			final: {
				irInstructionCount: 900,
				objectTextSizeBytes: 4_096,
				verifierPassed: true,
				verifierInputsExpected: 20,
				verifierInputsCompleted: 20,
			},
			intrinsicTotalMs: 100 * ratio,
			trace: {
				initialIrInstructionCount: 1_000,
				records: actions.map((action, index) => ({
					index,
					action,
					actionIndex: actionIndices[index] as number,
					deltaFromPrevious: deltas[index] as number,
				})),
			},
			traceIntegrity: { passed: true, errors: [] },
		},
	};
}

function inputFromCases(
	cases: CompilerGymIrDeltaQualificationCase[],
	options: { controlBytes?: number; incrementalBytes?: number } = {},
): CompilerGymIrDeltaQualificationInput {
	const envelopes = buildCompilerGymIrDeltaTreatmentEnvelopes(cases);
	const controlBytes = options.controlBytes ?? 5_000;
	const incrementalBytes = options.incrementalBytes ?? 1_250;
	return {
		protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
		cases,
		visibility: {
			protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL,
			rendererProtocol: "prime-native-ipython-json-value-v1",
			candidates: envelopes.map((envelope) => {
				const controlEnvelope = {
					type: "stock_prime_compiler_gym_evaluation",
					candidateId: envelope.candidateId,
				};
				const combinedTreatmentEnvelope = { ...controlEnvelope, irDeltaTrace: envelope };
				const controlEnvelopeJson = JSON.stringify(controlEnvelope);
				const typedTraceEnvelopeJson = JSON.stringify(envelope);
				const combinedTreatmentEnvelopeJson = JSON.stringify(combinedTreatmentEnvelope);
				const controlRenderedText = "c".repeat(controlBytes);
				const combinedTreatmentRenderedText = "t".repeat(controlBytes + incrementalBytes);
				return {
					candidateId: envelope.candidateId,
					candidateSha256: envelope.candidateSha256,
					benchmarkIds: envelope.tasks.map((task) => task.benchmarkId),
					controlEnvelopeJson,
					controlEnvelopeSha256: sha256Text(controlEnvelopeJson),
					controlRenderedText,
					controlRenderedTextSha256: sha256Text(controlRenderedText),
					controlProjectedAgentFacingBytes: controlBytes,
					typedTraceEnvelopeJson,
					typedTraceEnvelopeSha256: sha256Text(typedTraceEnvelopeJson),
					combinedTreatmentEnvelopeJson,
					combinedTreatmentEnvelopeSha256: sha256Text(combinedTreatmentEnvelopeJson),
					combinedTreatmentRenderedText,
					combinedTreatmentRenderedTextSha256: sha256Text(combinedTreatmentRenderedText),
					combinedTreatmentProjectedAgentFacingBytes: controlBytes + incrementalBytes,
				};
			}),
		},
	};
}

function qualificationInput(ratios: readonly number[] = [1.05, 1.15, 1.15, 1.25]) {
	return inputFromCases(CASES.map((item, index) => qualificationCase(item.caseId, ratios[index] as number)));
}

describe("CompilerGym one-environment IR-delta qualification protocol", () => {
	it("qualifies at the four-case overhead and native-rendered projection boundaries", () => {
		const assessment = assessCompilerGymIrDeltaQualification(qualificationInput());
		assert.equal(assessment.equivalence.passed, true);
		assert.equal(assessment.traceIntegrity.passed, true);
		assert.equal(assessment.overhead.medianRatio, 1.15);
		assert.equal(assessment.overhead.maximumRatio, 1.25);
		assert.equal(assessment.overhead.passed, true);
		assert.equal(assessment.projection.serializedBytes, 2_500);
		assert.equal(assessment.projection.ratio, 0.25);
		assert.equal(assessment.projection.passed, true);
		assert.equal(assessment.decision, "qualify-agent-facing-ir-delta-screen");
		assert.equal(assessment.paidScreenEligible, true);
		assert.equal(assessment.nextGate, "separately-preregistered-paid-agent-screen");
		assert.equal(assessment.lunaAuthorized, false);
		assert.equal(assessment.measurementReuseAllowed, false);
	});

	it("binds exact case, candidate, benchmark, action bytes, and cross-task identity", () => {
		const swappedCandidate = qualificationInput();
		swappedCandidate.cases[0].candidateId = "L46";
		assert.throws(
			() => parseCompilerGymIrDeltaQualificationInput(swappedCandidate),
			/exact frozen case, candidate, benchmark, and actions/,
		);
		const swappedBenchmark = qualificationInput();
		swappedBenchmark.cases[0].benchmarkId = BZIP2;
		assert.throws(
			() => parseCompilerGymIrDeltaQualificationInput(swappedBenchmark),
			/exact frozen case, candidate, benchmark, and actions/,
		);
		const digestDrift = qualificationInput();
		digestDrift.cases[0].candidateSha256 = "a".repeat(64);
		assert.throws(
			() => parseCompilerGymIrDeltaQualificationInput(digestDrift),
			/exact frozen case, candidate, benchmark, and actions/,
		);
		const actionDrift = qualificationInput();
		actionDrift.cases[1].actions[0] = "-sroa";
		actionDrift.cases[1].canonical.commandline = `opt ${actionDrift.cases[1].actions.join(" ")}`;
		actionDrift.cases[1].treatment.commandline = actionDrift.cases[1].canonical.commandline;
		if (!actionDrift.cases[1].treatment.trace) throw new Error("Expected trace");
		actionDrift.cases[1].treatment.trace.records[0].action = "-sroa";
		actionDrift.cases[1].candidateSha256 = sha256Text(JSON.stringify(actionDrift.cases[1].actions));
		assert.throws(
			() => parseCompilerGymIrDeltaQualificationInput(actionDrift),
			/exact frozen case, candidate, benchmark, and actions|identical actions across/,
		);
	});

	it("requires exact typed-envelope serialization and positive control bytes", () => {
		const reserialized = qualificationInput();
		const candidateEvidence = reserialized.visibility?.candidates[0];
		if (!candidateEvidence) throw new Error("Expected visibility evidence");
		candidateEvidence.typedTraceEnvelopeJson = ` ${candidateEvidence.typedTraceEnvelopeJson}`;
		candidateEvidence.typedTraceEnvelopeSha256 = sha256Text(candidateEvidence.typedTraceEnvelopeJson);
		assert.throws(() => parseCompilerGymIrDeltaQualificationInput(reserialized), /typedTraceEnvelopeJson drifted/);
		for (const field of ["controlEnvelopeJson", "combinedTreatmentEnvelopeJson"] as const) {
			const envelopeReserialization = qualificationInput();
			const evidence = envelopeReserialization.visibility?.candidates[0];
			if (!evidence) throw new Error("Expected visibility evidence");
			evidence[field] = ` ${evidence[field]}`;
			const hashField =
				field === "controlEnvelopeJson" ? "controlEnvelopeSha256" : "combinedTreatmentEnvelopeSha256";
			evidence[hashField] = sha256Text(evidence[field]);
			assert.throws(
				() => parseCompilerGymIrDeltaQualificationInput(envelopeReserialization),
				/exact generated serialization/,
			);
		}
		const zeroControl = qualificationInput();
		const zeroEvidence = zeroControl.visibility?.candidates[0];
		if (!zeroEvidence) throw new Error("Expected visibility evidence");
		zeroEvidence.controlRenderedText = "";
		zeroEvidence.controlRenderedTextSha256 = sha256Text("");
		zeroEvidence.controlProjectedAgentFacingBytes = 0;
		assert.throws(
			() => parseCompilerGymIrDeltaQualificationInput(zeroControl),
			/nonempty string|rendered byte counts are invalid/,
		);
	});

	it("rejects verifier-false trace-integrity success and admits a structured 20-of-20 semantic kill", () => {
		const contradictory = qualificationInput();
		contradictory.cases[0].treatment.final.verifierPassed = false;
		assert.throws(
			() => parseCompilerGymIrDeltaQualificationInput(contradictory),
			/trace integrity cannot pass without the complete terminal verifier/,
		);

		const semanticRejection = qualificationInput();
		semanticRejection.cases[0].treatment.final.verifierPassed = false;
		semanticRejection.cases[0].treatment.trace = null;
		semanticRejection.cases[0].treatment.traceIntegrity = {
			passed: false,
			errors: ["complete-20-of-20-semantic-rejection"],
		};
		semanticRejection.visibility = null;
		const assessment = assessCompilerGymIrDeltaQualification(semanticRejection);
		assert.equal(assessment.traceIntegrity.passed, false);
		assert.deepEqual(assessment.equivalence.mismatches, [{ caseId: "S12-blowfish", fields: ["verifierPassed"] }]);
		assert.equal(assessment.decision, "kill-ir-delta-trace");
		assert.equal(assessment.paidScreenEligible, false);
		assert.equal(assessment.lunaAuthorized, false);
	});

	it("kills either overhead gate and each projection gate without authorizing Luna", () => {
		assert.equal(
			assessCompilerGymIrDeltaQualification(qualificationInput([1.151, 1.151, 1.151, 1])).decision,
			"kill-ir-delta-trace",
		);
		assert.equal(
			assessCompilerGymIrDeltaQualification(qualificationInput([1, 1, 1, 1.251])).decision,
			"kill-ir-delta-trace",
		);
		const ratioMiss = inputFromCases(
			CASES.map((item) => qualificationCase(item.caseId, 1)),
			{ controlBytes: 4_999, incrementalBytes: 1_250 },
		);
		assert.equal(assessCompilerGymIrDeltaQualification(ratioMiss).decision, "kill-ir-delta-trace");
		const byteMiss = inputFromCases(
			CASES.map((item) => qualificationCase(item.caseId, 1)),
			{ controlBytes: 100_000, incrementalBytes: 1_251 },
		);
		const byteAssessment = assessCompilerGymIrDeltaQualification(byteMiss);
		assert.equal(byteAssessment.projection.ratio !== null && byteAssessment.projection.ratio < 0.25, true);
		assert.equal(byteAssessment.projection.serializedBytes, 2_502);
		assert.equal(byteAssessment.decision, "kill-ir-delta-trace");
		assert.equal(byteAssessment.lunaAuthorized, false);
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Text } from "../src/canonical-json.js";
import {
	assessCompilerGymActionTraceQualification,
	buildCompilerGymActionTraceProjection,
	buildCompilerGymActionTraceTreatmentEnvelopes,
	COMPILER_GYM_ACTION_TRACE_PROTOCOL,
	COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL,
	type CompilerGymActionTraceQualificationCase,
	type CompilerGymActionTraceQualificationInput,
	parseCompilerGymActionTraceQualificationInput,
} from "../src/compiler-gym-action-trace-protocol.js";

const ACTIONS = ["-mem2reg", "-gvn", "-dce"] as const;
const ACTION_INDICES = [7, 42, 11] as const;
const BLOWFISH = "benchmark://cbench-v1/blowfish";
const BZIP2 = "benchmark://cbench-v1/bzip2";

function qualificationCase(
	caseId: string,
	overheadRatio = 1.1,
	benchmarkId = BLOWFISH,
	candidateId = caseId,
): CompilerGymActionTraceQualificationCase {
	return {
		caseId,
		candidateId,
		candidateSha256: sha256Text(candidateId),
		benchmarkId,
		actions: [...ACTIONS],
		actionIndices: [...ACTION_INDICES],
		authoritative: {
			final: { irInstructionCount: 850, objectTextSizeBytes: 4_096, verifierPassed: true },
			intrinsicRuntimeMs: 100,
		},
		shadow: {
			final: { irInstructionCount: 850, objectTextSizeBytes: 4_096, verifierPassed: true },
			intrinsicRuntimeMs: 100 * overheadRatio,
			trace: {
				initialIrInstructionCount: 1_000,
				records: [
					{
						index: 0,
						action: ACTIONS[0],
						actionIndex: ACTION_INDICES[0],
						irInstructionCount: 900,
						deltaFromPrevious: -100,
						actionHadNoEffect: false,
					},
					{
						index: 1,
						action: ACTIONS[1],
						actionIndex: ACTION_INDICES[1],
						irInstructionCount: 900,
						deltaFromPrevious: 0,
						actionHadNoEffect: true,
					},
					{
						index: 2,
						action: ACTIONS[2],
						actionIndex: ACTION_INDICES[2],
						irInstructionCount: 850,
						deltaFromPrevious: -50,
						actionHadNoEffect: false,
					},
				],
			},
		},
	};
}

function inputFromCases(
	cases: CompilerGymActionTraceQualificationCase[],
	options: { controlBytes?: number; incrementalBytes?: number } = {},
): CompilerGymActionTraceQualificationInput {
	const envelopes = buildCompilerGymActionTraceTreatmentEnvelopes(cases);
	const controlBytes = options.controlBytes ?? 10_000;
	const incrementalBytes = options.incrementalBytes ?? 500;
	return {
		protocol: COMPILER_GYM_ACTION_TRACE_PROTOCOL,
		cases,
		visibility: {
			protocol: COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL,
			rendererProtocol: "prime-native-ipython-json-value-v1",
			candidates: envelopes.map((envelope) => {
				const controlEnvelope = { type: "stock_prime_compiler_gym_evaluation", candidateId: envelope.candidateId };
				const combinedTreatmentEnvelope = { ...controlEnvelope, actionTrace: envelope };
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

function qualificationInput(ratios: readonly number[] = [1.05, 1.15, 1.25]): CompilerGymActionTraceQualificationInput {
	return inputFromCases(
		ratios.map((ratio, index) => qualificationCase(`case-${index}`, ratio, index % 2 === 0 ? BLOWFISH : BZIP2)),
	);
}

describe("CompilerGym action-trace qualification protocol", () => {
	it("qualifies exact final metrics at the overhead and native-rendered visibility boundaries", () => {
		const result = assessCompilerGymActionTraceQualification(qualificationInput());
		assert.equal(result.equivalence.passed, true);
		assert.equal(result.overhead.medianRatio, 1.15);
		assert.equal(result.overhead.maximumRatio, 1.25);
		assert.equal(result.overhead.passed, true);
		assert.equal(result.projection.ratioPassed, true);
		assert.equal(result.projection.byteLimitPassed, true);
		assert.equal(result.decision, "qualify-agent-facing-trace-screen");
	});

	it("projects only ordered deltas and a no-effect bitstring", () => {
		const parsed = parseCompilerGymActionTraceQualificationInput(qualificationInput([1]));
		const projection = buildCompilerGymActionTraceProjection(parsed.cases[0].shadow.trace);
		assert.deepEqual(projection, { initialIrInstructionCount: 1_000, irDeltas: [-100, 0, -50], noEffectBits: "010" });
		for (const action of ACTIONS) assert.equal(JSON.stringify(projection).includes(action), false);
	});

	it("canonicalizes treatment task order and binds conditional semantic status", () => {
		const [envelope] = buildCompilerGymActionTraceTreatmentEnvelopes([
			qualificationCase("L46:bzip2", 1, BZIP2, "L46"),
			qualificationCase("L46:blowfish", 1, BLOWFISH, "L46"),
		]);
		assert.deepEqual(
			envelope.tasks.map((task) => task.benchmarkId),
			[BLOWFISH, BZIP2],
		);
		assert.ok(envelope.tasks.every((task) => task.prefixConditional));
		assert.ok(envelope.tasks.every((task) => task.intermediateSemanticStatus === "unverified"));
		assert.ok(envelope.tasks.every((task) => task.terminalSemanticStatus === "authoritative-final-verifier-only"));
		assert.ok(
			envelope.tasks.every((task) => task.noEffectMeaning === "llvm-pass-manager-reported-no-module-modification"),
		);
	});

	it("fails closed on per-action alignment and telescoping drift", () => {
		const wrongAction = structuredClone(qualificationInput([1]));
		wrongAction.cases[0].shadow.trace.records[1].action = "-sroa";
		assert.throws(() => parseCompilerGymActionTraceQualificationInput(wrongAction), /action does not match/);
		const wrongActionIndex = structuredClone(qualificationInput([1]));
		wrongActionIndex.cases[0].shadow.trace.records[1].actionIndex = 43;
		assert.throws(
			() => parseCompilerGymActionTraceQualificationInput(wrongActionIndex),
			/actionIndex does not match/,
		);
		const nonTelescoping = structuredClone(qualificationInput([1]));
		nonTelescoping.cases[0].shadow.trace.records[2].deltaFromPrevious = -49;
		assert.throws(() => parseCompilerGymActionTraceQualificationInput(nonTelescoping), /does not equal/);
	});

	it("kills final-metric inequality without treating it as malformed trace evidence", () => {
		const input = qualificationInput([1]);
		input.cases[0].authoritative.final.objectTextSizeBytes += 1;
		input.cases[0].authoritative.final.verifierPassed = false;
		const result = assessCompilerGymActionTraceQualification(input);
		assert.deepEqual(result.equivalence.mismatches, [
			{ caseId: "case-0", fields: ["objectTextSizeBytes", "verifierPassed"] },
		]);
		assert.equal(result.decision, "kill-action-trace");
		const bothUnverified = qualificationInput([1]);
		bothUnverified.cases[0].authoritative.final.verifierPassed = false;
		bothUnverified.cases[0].shadow.final.verifierPassed = false;
		assert.equal(assessCompilerGymActionTraceQualification(bothUnverified).decision, "kill-action-trace");
	});

	it("requires median and every-case total-runtime limits", () => {
		assert.equal(
			assessCompilerGymActionTraceQualification(qualificationInput([1.16, 1.16, 1])).decision,
			"kill-action-trace",
		);
		const outlier = assessCompilerGymActionTraceQualification(qualificationInput([1, 1, 1.251]));
		assert.equal(outlier.overhead.medianPassed, true);
		assert.equal(outlier.overhead.everyCasePassed, false);
	});

	it("uses native-rendered combined-minus-control bytes for both visibility gates", () => {
		const boundary = inputFromCases([qualificationCase("case", 1)], {
			controlBytes: 10_000,
			incrementalBytes: 2_500,
		});
		const boundaryResult = assessCompilerGymActionTraceQualification(boundary);
		assert.equal(boundaryResult.projection.ratio, 0.25);
		assert.equal(boundaryResult.projection.byteLimitPassed, true);
		const ratioFailure = inputFromCases([qualificationCase("case", 1)], {
			controlBytes: 9_999,
			incrementalBytes: 2_500,
		});
		assert.equal(assessCompilerGymActionTraceQualification(ratioFailure).decision, "kill-action-trace");
		const byteFailure = inputFromCases([qualificationCase("case", 1)], {
			controlBytes: 100_000,
			incrementalBytes: 2_501,
		});
		const result = assessCompilerGymActionTraceQualification(byteFailure);
		assert.equal(result.projection.ratioPassed, true);
		assert.equal(result.projection.byteLimitPassed, false);
	});

	it("rejects visibility evidence that does not hash-bind the typed envelope", () => {
		const input = qualificationInput([1]);
		input.visibility.candidates[0].typedTraceEnvelopeSha256 = "a".repeat(64);
		assert.throws(
			() => parseCompilerGymActionTraceQualificationInput(input),
			/typedTraceEnvelopeSha256 does not bind/,
		);
		const renderedTextTamper = qualificationInput([1]);
		renderedTextTamper.visibility.candidates[0].controlRenderedText += "x";
		assert.throws(
			() => parseCompilerGymActionTraceQualificationInput(renderedTextTamper),
			/rendered-text hashes do not bind/,
		);
	});

	it("rejects a no-effect flag paired with a nonzero IR change", () => {
		const input = qualificationInput([1]);
		input.cases[0].shadow.trace.records[0].actionHadNoEffect = true;
		assert.throws(
			() => parseCompilerGymActionTraceQualificationInput(input),
			/actionHadNoEffect cannot accompany a nonzero IR delta/,
		);
	});
});

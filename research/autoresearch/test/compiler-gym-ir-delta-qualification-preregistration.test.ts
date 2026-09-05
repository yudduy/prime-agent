import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS } from "../src/compiler-gym-action-trace-preregistration.js";
import {
	buildCompilerGymIrDeltaQualificationPreregistration,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_TERMINAL_TAXONOMY,
	parseCompilerGymIrDeltaQualificationPreregistration,
	verifyCompilerGymIrDeltaQualificationPrerequisiteEvidence,
} from "../src/compiler-gym-ir-delta-qualification-preregistration.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

async function preregistration() {
	const canonicalPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const treatmentPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const environmentProbePath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_env_probe.py");
	return buildCompilerGymIrDeltaQualificationPreregistration({
		createdAt: "2026-08-29T01:00:00.000Z",
		primeAgentCommit: "bc0fa7606abb3b7af0f765319518d255e6ae553d",
		canonicalPath,
		canonicalSource: await readFile(canonicalPath, "utf8"),
		treatmentPath,
		treatmentSource: await readFile(treatmentPath, "utf8"),
		environmentProbePath,
		environmentProbeSource: await readFile(environmentProbePath, "utf8"),
		implementationClosure: await Promise.all(
			COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(REPO_ROOT, relativePath), "utf8")),
			})),
		),
	});
}

describe("CompilerGym one-environment IR-delta qualification preregistration", () => {
	it("freezes the fresh eight-allocation design, prior-evidence boundary, and full native-renderer closure", async () => {
		const value = await preregistration();
		assert.deepEqual(
			COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN.map(
				({ allocationOrdinal, caseId, candidateId, benchmarkId, arm }) => [
					allocationOrdinal,
					caseId,
					candidateId,
					benchmarkId.split("/").at(-1),
					arm,
				],
			),
			[
				[1, "S12-blowfish", "S12", "blowfish", "canonical"],
				[2, "S12-blowfish", "S12", "blowfish", "one-env-ir-delta"],
				[3, "S12-bzip2", "S12", "bzip2", "one-env-ir-delta"],
				[4, "S12-bzip2", "S12", "bzip2", "canonical"],
				[5, "L46-bzip2", "L46", "bzip2", "canonical"],
				[6, "L46-bzip2", "L46", "bzip2", "one-env-ir-delta"],
				[7, "L46-blowfish", "L46", "blowfish", "one-env-ir-delta"],
				[8, "L46-blowfish", "L46", "blowfish", "canonical"],
			],
		);
		assert.equal(value.design.modelCalls, 0);
		assert.equal(value.design.measurementReuse, false);
		assert.equal(value.design.smokeMeasurementsUsed, false);
		assert.equal(value.design.formalMeasurementsReused, false);
		assert.equal(value.design.dispatchAttempts, 1);
		assert.equal(value.design.allocationRetries, 0);
		assert.equal(value.design.replacementAllocations, 0);
		assert.equal(value.design.lunaAuthorized, false);
		assert.equal(value.assessment.medianOverheadLimit, 1.15);
		assert.equal(value.assessment.perCaseOverheadLimit, 1.25);
		assert.equal(value.assessment.projectionRatioLimit, 0.25);
		assert.equal(value.assessment.projectionByteLimit, 2_500);
		assert.deepEqual(value.prerequisiteEvidence, COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE);
		assert.equal(
			COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE.smoke.terminalEventSha256,
			"bdb92415ae188e2864161982d0d6c68fce911abe30d0c42c17d9874cabb7abff",
		);
		assert.equal(
			COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE.v3NonAdmission.terminalEventSha256,
			"dc234491b5419675154d337d420ebf859292b830db3a277385b3eb4725d09ed2",
		);
		for (const relativePath of COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS) {
			assert.equal(
				COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.includes(
					relativePath as (typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS)[number],
				),
				true,
				`formal closure omitted v3 renderer dependency ${relativePath}`,
			);
		}
		for (const relativePath of [
			"research/autoresearch/evaluators/compiler_gym_eval.py",
			"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
			"research/autoresearch/evaluators/compiler_gym_env_probe.py",
			"research/autoresearch/src/compiler-gym-action-trace-protocol.ts",
		]) {
			assert.equal(
				COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.includes(
					relativePath as (typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS)[number],
				),
				true,
			);
		}
	});

	it("freezes a treatment-only-field native-renderer preflight before all remote commands", async () => {
		const value = await preregistration();
		const preflight = value.renderer.syntheticPreflight;
		const reconstructedControl = structuredClone(
			COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT,
		) as Record<string, unknown>;
		delete reconstructedControl.irDeltaTrace;
		assert.deepEqual(reconstructedControl, COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL);
		assert.equal(preflight.executionPhase, "before-any-ssh-or-srun");
		assert.equal(preflight.apparatusOnly, true);
		assert.equal(preflight.controlJsonValueSha256, sha256Text(preflight.controlJsonValue));
		assert.equal(preflight.treatmentJsonValueSha256, sha256Text(preflight.treatmentJsonValue));
		assert.equal(preflight.controlJsonValue.endsWith("\n"), true);
		assert.equal(preflight.treatmentJsonValue.endsWith("\n"), true);
		assert.equal(preflight.requiredChecks.nonemptyControl, true);
		assert.equal(preflight.requiredChecks.positiveIncrement, true);
		assert.match(value.renderer.denominator, /treatment outputs/);
		assert.match(value.renderer.denominator, /host trace hidden/);
		assert.match(value.renderer.denominator, /no trace or renderer timing is measured or subtracted separately/);
	});

	it("strictly verifies the admitted smoke and non-admitted v3 ledgers", async () => {
		await verifyCompilerGymIrDeltaQualificationPrerequisiteEvidence(REPO_ROOT);
	});

	it("freezes terminal execution pairings and scientific-versus-apparatus dispositions", async () => {
		const value = await preregistration();
		assert.deepEqual(value.assessment.terminalTaxonomy, COMPILER_GYM_IR_DELTA_QUALIFICATION_TERMINAL_TAXONOMY);
		assert.deepEqual(value.assessment.terminalTaxonomy.executionExitClassification, {
			canonicalOrVerifierPassingTreatment: {
				evaluatorExitCode: 0,
				srunExitCode: 0,
				accountingState: "COMPLETED",
				accountingExitCode: "0:0",
			},
			completeTreatmentSemanticRejection: {
				evaluatorStatus: "semantic_validation_failed",
				evaluatorExitCode: 5,
				srunExitCode: 5,
				accountingState: "FAILED",
				accountingExitCode: "5:0",
				verifierInputsExpected: 20,
				verifierInputsCompleted: 20,
				disposition: "terminal-complete-scientific-kill",
			},
			incompleteTreatmentValidation: {
				evaluatorStatus: "validation_incomplete",
				evaluatorExitCode: 4,
				disposition: "terminal-apparatus-invalid-not-treatment-result",
			},
			allOtherNonzeroOrPairingDrift: "terminal-apparatus-invalid-not-treatment-result",
		});
		assert.equal(value.assessment.terminalTaxonomy.scientificPass.lunaAuthorizedByThisGate, false);
	});

	it("rejects evidence, mapping, renderer, taxonomy, and reuse tampering", async () => {
		const expected = await preregistration();
		const mutations: Array<(value: typeof expected) => void> = [
			(value) => {
				value.design.smokeMeasurementsUsed = true as false;
			},
			(value) => {
				value.executionPlan[0].candidateId = "L46";
			},
			(value) => {
				(
					value.prerequisiteEvidence.smoke as unknown as {
						terminalEventSha256: string;
					}
				).terminalEventSha256 = "a".repeat(64);
			},
			(value) => {
				value.renderer.syntheticPreflight.controlCellSha256 = "b".repeat(64);
			},
			(value) => {
				(value.assessment.terminalTaxonomy.scientificKill.conditions as unknown as string[]).pop();
			},
			(value) => {
				value.implementationClosure.pop();
			},
		];
		for (const mutate of mutations) {
			const changed = structuredClone(expected);
			mutate(changed);
			assert.throws(
				() => parseCompilerGymIrDeltaQualificationPreregistration(changed, expected),
				/drifted|invalid|fresh-measurement|fully reconstructed|evidence|closure/,
			);
		}
	});
});

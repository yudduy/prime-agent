import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Json } from "../src/canonical-json.js";
import {
	assertCompilerGymActionSpaceVisibilityProviderCallOrdinal,
	assertCompilerGymActionSpaceVisibilityRequestPolicy,
	assessCompilerGymActionSpaceVisibilityPair,
	buildCompilerGymActionSpaceVisibilityPrompts,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_ALLOWED_FLAGS_SHA256,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_FLAGS_SHA256,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_GUIDE_BYTES,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_DELTA_BYTES,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_SENTINEL,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_FLAGS_SHA256,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_GUIDE_BYTES,
	type CompilerGymActionSpaceVisibilityCandidate,
	CompilerGymActionSpaceVisibilityEvaluationSchema,
	type CompilerGymActionSpaceVisibilityGuides,
	normalizeCompilerGymActionSpaceVisibilityPrompt,
	reconstructCompilerGymActionSpaceVisibilityGuides,
} from "../src/compiler-gym-action-space-visibility-protocol.js";

const EVALUATOR_PATH = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));

async function guides(): Promise<CompilerGymActionSpaceVisibilityGuides> {
	return reconstructCompilerGymActionSpaceVisibilityGuides(await readFile(EVALUATOR_PATH, "utf8"));
}

function verifiedCandidate(
	actions: string[],
	blowfishIr: number,
	bzip2Ir: number,
): CompilerGymActionSpaceVisibilityCandidate {
	return {
		actions,
		outcome: "verified",
		blowfishIr,
		bzip2Ir,
		verifierInputsCompleted: { blowfish: 20, bzip2: 20 },
	};
}

function rejectedCandidate(actions: string[]): CompilerGymActionSpaceVisibilityCandidate {
	return {
		actions,
		outcome: "complete-semantic-rejection",
		blowfishIr: null,
		bzip2Ir: null,
		verifierInputsCompleted: { blowfish: 20, bzip2: 20 },
	};
}

describe("CompilerGym action-space visibility protocol", () => {
	it("reconstructs the exact outcome-independent stock-26 plus PassesAll-complement treatment", async () => {
		const reconstructed = await guides();
		assert.equal(reconstructed.controlFlags.length, 26);
		assert.equal(reconstructed.omittedFlags.length, 98);
		assert.equal(reconstructed.allowedFlags.length, 124);
		assert.equal(reconstructed.treatmentFlags.length, 124);
		assert.equal(sha256Json(reconstructed.controlFlags), COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_FLAGS_SHA256);
		assert.equal(sha256Json(reconstructed.omittedFlags), COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256);
		assert.equal(sha256Json(reconstructed.allowedFlags), COMPILER_GYM_ACTION_SPACE_VISIBILITY_ALLOWED_FLAGS_SHA256);
		assert.equal(
			sha256Json(reconstructed.treatmentFlags),
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_FLAGS_SHA256,
		);
		assert.deepEqual(reconstructed.treatmentFlags.slice(0, 26), reconstructed.controlFlags);
		assert.deepEqual(
			reconstructed.treatmentFlags.slice(26),
			reconstructed.allowedFlags.filter((flag) => !new Set(reconstructed.controlFlags).has(flag)),
		);
		assert.deepEqual(new Set(reconstructed.treatmentFlags), new Set(reconstructed.allowedFlags));
	});

	it("seals one guide-only prompt delta without prior-result leakage", async () => {
		const reconstructed = await guides();
		const prompts = buildCompilerGymActionSpaceVisibilityPrompts(reconstructed);
		assert.equal(
			prompts.guideBytesByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_GUIDE_BYTES,
		);
		assert.equal(
			prompts.guideBytesByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_GUIDE_BYTES,
		);
		assert.equal(prompts.guideDeltaBytes, COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_DELTA_BYTES);
		assert.equal(
			normalizeCompilerGymActionSpaceVisibilityPrompt(
				prompts.byArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
				prompts.guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
			),
			prompts.normalized,
		);
		assert.equal(
			normalizeCompilerGymActionSpaceVisibilityPrompt(
				prompts.byArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
				prompts.guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
			),
			prompts.normalized,
		);
		assert.equal(prompts.normalized.includes(COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_SENTINEL), true);
		for (const forbidden of [
			"dijkstra",
			"headroom",
			"scaffold",
			"winning",
			"terminal-apparatus-invalid",
			"73dc6ffb921da7a6e85b117f53be75252c3ece290bb0111b9efafaddf2213cd8",
		]) {
			assert.equal(prompts.normalized.toLowerCase().includes(forbidden), false, forbidden);
		}
		assert.throws(
			() =>
				normalizeCompilerGymActionSpaceVisibilityPrompt(
					`${prompts.byArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]}\nPrior dijkstra result: 292.`,
					prompts.guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
				),
			/leaks held-out benchmark name/,
		);
	});

	it("uses the sealed unenumerated min-1/max-256 schema while the host rejects empty or illegal actions", async () => {
		const reconstructed = await guides();
		const schema = CompilerGymActionSpaceVisibilityEvaluationSchema as unknown as Record<string, unknown>;
		const properties = schema.properties as Record<string, Record<string, unknown>>;
		assert.equal(schema.additionalProperties, false);
		assert.equal(properties.actions?.type, "array");
		assert.equal(properties.actions?.maxItems, COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS);
		assert.equal(properties.actions?.minItems, 1);
		assert.equal(JSON.stringify(schema).includes('"enum"'), false);
		const omitted = reconstructed.omittedFlags[0];
		assert.ok(omitted);
		assert.deepEqual(
			assertCompilerGymActionSpaceVisibilityRequestPolicy(
				{
					actions: [omitted],
					hypothesis: "control may know an unshown legal flag",
					mechanism: "legal action prior",
					predictedOutcome: "lower IR",
					boundaryConditions: [],
				},
				reconstructed.allowedFlags,
			).actions,
			[omitted],
		);
		assert.throws(
			() =>
				assertCompilerGymActionSpaceVisibilityRequestPolicy(
					{
						actions: [],
						hypothesis: "empty",
						mechanism: "empty",
						predictedOutcome: "empty",
						boundaryConditions: [],
					},
					reconstructed.allowedFlags,
				),
			/between one and 256/,
		);
		assert.throws(
			() =>
				assertCompilerGymActionSpaceVisibilityRequestPolicy(
					{
						actions: ["-not-a-legal-pass"],
						hypothesis: "illegal",
						mechanism: "illegal",
						predictedOutcome: "illegal",
						boundaryConditions: [],
					},
					reconstructed.allowedFlags,
				),
			/illegal LLVM pass/,
		);
		assert.throws(
			() =>
				assertCompilerGymActionSpaceVisibilityRequestPolicy(
					{
						actions: Array.from({ length: 257 }, () => reconstructed.controlFlags[0]),
						hypothesis: "too wide",
						mechanism: "too wide",
						predictedOutcome: "too wide",
						boundaryConditions: [],
					},
					reconstructed.allowedFlags,
				),
			/at most 256/,
		);
	});

	it("permits exactly one provider call per arm", () => {
		assert.equal(assertCompilerGymActionSpaceVisibilityProviderCallOrdinal(1), 1);
		for (const ordinal of [0, 2, 3]) {
			assert.throws(() => assertCompilerGymActionSpaceVisibilityProviderCallOrdinal(ordinal), /exactly one/);
		}
	});

	it("promotes only a fully verified unique-omitted strict Pareto witness", async () => {
		const reconstructed = await guides();
		const stock = reconstructed.controlFlags[0];
		const omitted = reconstructed.omittedFlags[0];
		assert.ok(stock && omitted);
		const assessment = assessCompilerGymActionSpaceVisibilityPair({
			control: verifiedCandidate([stock], 2_200, 14_000),
			treatment: verifiedCandidate([stock, omitted], 2_199, 14_000),
			guides: reconstructed,
		});
		assert.equal(assessment.controlVerified, true);
		assert.equal(assessment.treatmentVerified, true);
		assert.deepEqual(assessment.treatmentUniqueOmittedFlags, [omitted]);
		assert.equal(assessment.mechanismEngaged, true);
		assert.equal(assessment.treatmentStrictlyParetoDominates, true);
		assert.equal(assessment.normalizedMinimax.diagnosticOnly, true);
		assert.equal(assessment.decision, "directionally-promising-requires-fresh-replication");
		assert.equal(assessment.nextGate, "one-fresh-independent-four-call-cpu-replication");
		assert.equal(assessment.causalClaimAllowed, false);
		assert.equal(assessment.randomizedInferenceAllowed, false);
		assert.equal(assessment.tamperEvidentRandomAssignment, false);
		assert.equal(assessment.defaultPromotionAllowed, false);
		assert.equal(assessment.gpuPromotionAllowed, false);
		assert.equal(assessment.nanogptPromotionAllowed, false);
	});

	it("keeps minimax-winning tradeoffs and dominance without unique omitted uptake inconclusive", async () => {
		const reconstructed = await guides();
		const stock = reconstructed.controlFlags[0];
		const omitted = reconstructed.omittedFlags[0];
		assert.ok(stock && omitted);
		const tradeoff = assessCompilerGymActionSpaceVisibilityPair({
			control: verifiedCandidate([stock], 2_200, 13_000),
			treatment: verifiedCandidate([stock, omitted], 2_100, 14_000),
			guides: reconstructed,
		});
		assert.equal(tradeoff.normalizedMinimax.comparison, "treatment-lower");
		assert.equal(tradeoff.treatmentStrictlyParetoDominates, false);
		assert.equal(tradeoff.decision, "inconclusive");
		const noMechanismDominance = assessCompilerGymActionSpaceVisibilityPair({
			control: verifiedCandidate([stock], 2_200, 14_000),
			treatment: verifiedCandidate([stock], 2_199, 14_000),
			guides: reconstructed,
		});
		assert.equal(noMechanismDominance.mechanismEngaged, false);
		assert.equal(noMechanismDominance.treatmentStrictlyParetoDominates, true);
		assert.equal(noMechanismDominance.decision, "inconclusive");
	});

	it("kills rejection, control dominance, or non-engaged non-dominance and rejects incomplete verification", async () => {
		const reconstructed = await guides();
		const stock = reconstructed.controlFlags[0];
		const omitted = reconstructed.omittedFlags[0];
		assert.ok(stock && omitted);
		for (const treatment of [
			rejectedCandidate([stock, omitted]),
			verifiedCandidate([stock, omitted], 2_201, 14_001),
			verifiedCandidate([stock, omitted], 2_200, 14_000),
			verifiedCandidate([stock], 2_200, 14_000),
		]) {
			const assessment = assessCompilerGymActionSpaceVisibilityPair({
				control: verifiedCandidate([stock], 2_200, 14_000),
				treatment,
				guides: reconstructed,
			});
			assert.equal(assessment.decision, "directional-loss");
			assert.equal(assessment.nextGate, "stop-visibility-v1");
		}
		const engagedTie = assessCompilerGymActionSpaceVisibilityPair({
			control: verifiedCandidate([stock], 2_200, 14_000),
			treatment: verifiedCandidate([stock, omitted], 2_200, 14_000),
			guides: reconstructed,
		});
		assert.equal(engagedTie.mechanismEngaged, true);
		assert.equal(engagedTie.exactTaskVectorTie, true);
		assert.equal(engagedTie.decision, "directional-loss");
		const incomplete = verifiedCandidate([stock, omitted], 2_199, 14_000);
		incomplete.verifierInputsCompleted.bzip2 = 19;
		assert.throws(
			() =>
				assessCompilerGymActionSpaceVisibilityPair({
					control: verifiedCandidate([stock], 2_200, 14_000),
					treatment: incomplete,
					guides: reconstructed,
				}),
			/two complete twenty-callback verifier outcomes/,
		);
	});
});

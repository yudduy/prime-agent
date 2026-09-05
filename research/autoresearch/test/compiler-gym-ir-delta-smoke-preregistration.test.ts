import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../src/canonical-json.js";
import {
	buildCompilerGymIrDeltaSmokePreregistration,
	COMPILER_GYM_IR_DELTA_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_EXECUTION_PLAN,
	COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS,
	COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
	COMPILER_GYM_IR_DELTA_V3_LEDGER_SHA256,
	COMPILER_GYM_IR_DELTA_V3_PREREGISTRATION_SHA256,
	parseCompilerGymIrDeltaSmokePreregistration,
} from "../src/compiler-gym-ir-delta-smoke-preregistration.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

async function preregistration() {
	const canonicalPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const treatmentPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const environmentProbePath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_env_probe.py");
	return buildCompilerGymIrDeltaSmokePreregistration({
		createdAt: "2026-08-28T23:00:00.000Z",
		primeAgentCommit: "bc0fa7606abb3b7af0f765319518d255e6ae553d",
		canonicalPath,
		canonicalSource: await readFile(canonicalPath, "utf8"),
		treatmentPath,
		treatmentSource: await readFile(treatmentPath, "utf8"),
		environmentProbePath,
		environmentProbeSource: await readFile(environmentProbePath, "utf8"),
		implementationClosure: await Promise.all(
			COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(REPO_ROOT, relativePath), "utf8")),
			})),
		),
	});
}

describe("CompilerGym one-environment IR-delta smoke preregistration", () => {
	it("freezes exact L46/blowfish ABBA, cost gates, source contracts, and v3 non-admission", async () => {
		const value = await preregistration();
		assert.deepEqual(
			COMPILER_GYM_IR_DELTA_EXECUTION_PLAN.map(({ allocationOrdinal, blockId, arm }) => [
				allocationOrdinal,
				blockId,
				arm,
			]),
			[
				[1, "r1", "canonical"],
				[2, "r1", "one-env-ir-delta"],
				[3, "r2", "one-env-ir-delta"],
				[4, "r2", "canonical"],
			],
		);
		assert.equal(value.candidate.actions.length, 46);
		assert.equal(value.candidate.actionsSha256, "9c79e07358780e187d0a63ea9fa0c049307dc399308cc2080841095d2f8ff751");
		assert.equal(value.benchmark, "benchmark://cbench-v1/blowfish");
		assert.deepEqual(value.candidate.expectedMetrics, { irInstructionCount: 1981, objectTextSizeBytes: 23028 });
		assert.equal(value.assessment.medianRatioLimit, 1.12);
		assert.equal(value.assessment.perBlockRatioLimit, 1.25);
		assert.equal(value.assessment.nextGate, "eight-fresh-allocation-model-free-ir-delta-qualification");
		assert.equal(value.design.lunaAuthorized, false);
		assert.equal(value.design.measurementReuse, false);
		assert.equal(value.sources.treatmentSha256, COMPILER_GYM_IR_DELTA_EVALUATOR_SHA256);
		assert.equal(COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT, "compiler-gym-v0.2.5-single-environment-ir-delta-v1");
		assert.deepEqual(value.v3NonAdmission, {
			preregistrationSha256: COMPILER_GYM_IR_DELTA_V3_PREREGISTRATION_SHA256,
			ledgerSha256: COMPILER_GYM_IR_DELTA_V3_LEDGER_SHA256,
			terminalDisposition: "terminal-infrastructure-invalid-not-treatment-result",
			v3MeasurementsAdmitted: false,
			v3MeasurementsUsedInAssessment: false,
		});
		assert.equal(value.environment.pythonPath.endsWith("compiler-gym-venv-v2/bin/python"), true);
		assert.equal(value.environment.compilerGymSiteData.endsWith("compiler-gym-site-v2"), true);
	});

	it("rejects threshold, plan, v3 disclosure, and source tampering against reconstruction", async () => {
		const expected = await preregistration();
		const mutations: Array<(value: typeof expected) => void> = [
			(value) => {
				value.assessment.medianRatioLimit = 1.15 as typeof value.assessment.medianRatioLimit;
			},
			(value) => {
				value.executionPlan.reverse();
			},
			(value) => {
				value.v3NonAdmission.v3MeasurementsUsedInAssessment = true as false;
			},
			(value) => {
				value.sources.treatmentSha256 = "a".repeat(64) as typeof value.sources.treatmentSha256;
			},
		];
		for (const mutate of mutations) {
			const changed = structuredClone(expected);
			mutate(changed);
			assert.throws(
				() => parseCompilerGymIrDeltaSmokePreregistration(changed, expected),
				/pinned|drifted|disclosure|fully reconstructed/,
			);
		}
	});
});

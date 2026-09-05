import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assessCompilerGymTaskProcess,
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
	type CompilerGymProcessResult,
} from "../src/compiler-gym-adapter.js";

const BENCHMARK = "benchmark://cbench-v1/qsort";

function semanticRejectionResult(): Record<string, unknown> {
	return {
		schema_version: 2,
		contract: COMPILER_GYM_VERIFIER_EPOCH,
		ok: false,
		status: "semantic_validation_failed",
		benchmark: BENCHMARK,
		metrics: { final: { IrInstructionCount: 100, ObjectTextSizeBytes: 200 } },
		validation: {
			passed: false,
			inputs_completed: 20,
			semantic_errors: [{ input: 7, message: "wrong output" }],
		},
		timings_seconds: { total: 0.01 },
		provenance: {
			upstream_cbench_source_sha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
			cbench_patch_sha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
			pinned_installed_cbench_source_sha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
			installed_cbench_source_sha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
			installed_cbench_source_matches_pin: true,
			farmshare_environment_seal_passed: true,
		},
		environment: {
			seal: {
				python_version: "3.10.19",
				distribution_manifest_sha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
				compatibility_tree_manifest_sha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
				libtinfo_sha256: COMPILER_GYM_LIBTINFO_SHA256,
			},
		},
	};
}

function assess(value: Record<string, unknown>, exitCode = 5) {
	const process: CompilerGymProcessResult = {
		exitCode,
		stdout: `${JSON.stringify(value)}\n`,
		stderr: "",
		wallMs: 20,
	};
	return assessCompilerGymTaskProcess(BENCHMARK, process);
}

describe("CompilerGym semantic rejection classification", () => {
	it("admits only the exact semantic-failure contract as rejected", () => {
		const measurement = assess(semanticRejectionResult());
		assert.equal(measurement.status, "rejected");
		assert.equal(measurement.verifier.passed, false);
		assert.equal(measurement.metrics.IrInstructionCount, 100);
	});

	for (const testCase of [
		{
			name: "integrity drift",
			mutate: (value: Record<string, unknown>) => {
				const provenance = value.provenance as Record<string, unknown>;
				provenance.installed_cbench_source_matches_pin = false;
			},
			exitCode: 5,
		},
		{ name: "wrong exit", mutate: (_value: Record<string, unknown>) => {}, exitCode: 0 },
		{
			name: "benchmark drift",
			mutate: (value: Record<string, unknown>) => {
				value.benchmark = "benchmark://cbench-v1/blowfish";
			},
			exitCode: 5,
		},
		{
			name: "incomplete callbacks",
			mutate: (value: Record<string, unknown>) => {
				const validation = value.validation as Record<string, unknown>;
				validation.inputs_completed = 19;
			},
			exitCode: 5,
		},
		{
			name: "missing metric",
			mutate: (value: Record<string, unknown>) => {
				const metrics = value.metrics as { final: Record<string, unknown> };
				delete metrics.final.IrInstructionCount;
			},
			exitCode: 5,
		},
	] as const) {
		it(`classifies semantic status plus ${testCase.name} as apparatus failed`, () => {
			const value = semanticRejectionResult();
			testCase.mutate(value);
			assert.equal(assess(value, testCase.exitCode).status, "failed");
		});
	}
});

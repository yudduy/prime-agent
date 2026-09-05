import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import {
	buildCompilerGymActionTracePreregistration,
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT,
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH,
	COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN,
	COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS,
	COMPILER_GYM_ACTION_TRACE_LONG_ACTIONS,
	COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL,
	COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID,
	COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS,
	parseCompilerGymActionTracePreregistration,
} from "../src/compiler-gym-action-trace-preregistration.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

async function frozenPreregistration() {
	const canonicalPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const tracePath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_action_trace_eval.py");
	const environmentProbePath = resolve(REPO_ROOT, COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH);
	return buildCompilerGymActionTracePreregistration({
		createdAt: "2026-08-28T20:00:00.000Z",
		primeAgentCommit: "bc0fa7606abb3b7af0f765319518d255e6ae553d",
		canonicalPath,
		canonicalSource: await readFile(canonicalPath, "utf8"),
		tracePath,
		traceSource: await readFile(tracePath, "utf8"),
		environmentProbePath,
		environmentProbeSource: await readFile(environmentProbePath, "utf8"),
		implementationClosure: await Promise.all(
			COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(REPO_ROOT, relativePath), "utf8")),
			})),
		),
	});
}

describe("CompilerGym action-trace preregistration", () => {
	it("freezes exact S12/L46 bytes, accepted metrics, and crossover order", async () => {
		const preregistration = await frozenPreregistration();
		assert.equal(COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL, "compiler-gym-action-trace-preregistration-v3");
		assert.equal(COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID, "stock-cold-action-trace-v3");
		assert.equal(preregistration.assessment.protocol, "compiler-gym-action-trace-qualification-v3");
		assert.equal(
			preregistration.environment.remoteSourceRoot,
			"/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-action-trace-v3/sources",
		);
		assert.deepEqual(preregistration.environment, {
			host: "farmshare",
			partition: "normal",
			cpuConstraint: "CPU_SKU:9384X",
			pythonPath: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-venv-v2/bin/python",
			remoteSourceRoot: "/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-action-trace-v3/sources",
			compilerGymCache: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache",
			compilerGymSiteData: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2",
			compatibilityLibraryDir: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib",
			pythonWarnings: "ignore::FutureWarning",
			timeLimit: "00:05:00",
			memory: "8G",
			cpusPerTask: 2,
			acceptedRootAllocCpus: [2, 4],
		});
		assert.deepEqual(preregistration.environmentProbe.expectedResult, {
			...COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT,
		});
		assert.equal(
			preregistration.sources.environmentProbePath,
			resolve(REPO_ROOT, COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH),
		);
		assert.equal(
			preregistration.sources.environmentProbeSha256,
			sha256Text(await readFile(preregistration.sources.environmentProbePath, "utf8")),
		);
		assert.equal(
			preregistration.sources.combinedSha256,
			sha256Json({
				canonicalSha256: preregistration.sources.canonicalSha256,
				environmentProbeSha256: preregistration.sources.environmentProbeSha256,
				traceSha256: preregistration.sources.traceSha256,
			}),
		);
		assert.equal(
			new Set<string>(COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS).has(
				COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH,
			),
			false,
		);
		assert.equal(COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS.length, 12);
		assert.equal(COMPILER_GYM_ACTION_TRACE_LONG_ACTIONS.length, 46);
		assert.deepEqual(COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS, [
			"research/autoresearch/src/compiler-gym-action-trace-preregistration.ts",
			"research/autoresearch/src/compiler-gym-action-trace-protocol.ts",
			"research/autoresearch/src/compiler-gym-action-trace-qualification-runner.ts",
			"research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
			"research/autoresearch/src/compiler-gym-warm-transport.ts",
			"research/autoresearch/src/compiler-gym-adapter.ts",
			"research/autoresearch/src/artifact-store.ts",
			"research/autoresearch/src/canonical-json.ts",
			"research/autoresearch/src/ledger.ts",
			"research/autoresearch/src/campaign.ts",
			"research/autoresearch/src/stock-cpu-evaluation-envelope.ts",
			"research/autoresearch/src/stock-cpu-eval.ts",
			"research/autoresearch/src/stock-cpu-protocol.ts",
			"research/autoresearch/src/types.ts",
			"packages/coding-agent/src/core/tools/ipython.ts",
			"packages/coding-agent/src/core/kernel/boot-gate.ts",
			"packages/coding-agent/src/core/kernel/bootstrap.ts",
			"packages/coding-agent/src/core/kernel/index.ts",
			"packages/coding-agent/src/core/kernel/repl-manager.ts",
			"packages/coding-agent/src/core/kernel/shared.ts",
			"packages/coding-agent/src/core/kernel/state-snapshot.ts",
			"packages/coding-agent/src/core/orphan-process-journal.ts",
			"packages/coding-agent/src/core/session-lease.ts",
			"packages/coding-agent/src/core/tools/tool-definition-wrapper.ts",
			"packages/coding-agent/src/config.ts",
			"packages/coding-agent/src/utils/child-process.ts",
			"packages/coding-agent/src/utils/daemon-socket-path.ts",
			"packages/coding-agent/src/utils/mime.ts",
			"packages/coding-agent/src/utils/semaphore.ts",
			"packages/coding-agent/src/utils/shell.ts",
			"packages/coding-agent/package.json",
			"prime-agent-runtime/src/rlm/__init__.py",
			"prime-agent-runtime/src/rlm/_winjob.py",
			"prime-agent-runtime/src/rlm/bash.py",
			"prime-agent-runtime/src/rlm/harness.py",
			"prime-agent-runtime/src/rlm/mcp.py",
			"prime-agent-runtime/src/rlm/mcp_base.py",
			"prime-agent-runtime/src/rlm/repl.py",
			"prime-agent-runtime/src/rlm/skill.py",
			"prime-agent-runtime/pyproject.toml",
			"prime-agent-runtime/uv.lock",
			"package.json",
			"package-lock.json",
		]);
		assert.equal(
			preregistration.candidates[0].actionsSha256,
			"60df17de77999363e6547b8447140c70e253859ec0eb42caa6e60ab41f62e042",
		);
		assert.equal(
			preregistration.candidates[1].actionsSha256,
			"9c79e07358780e187d0a63ea9fa0c049307dc399308cc2080841095d2f8ff751",
		);
		assert.deepEqual(
			COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN.map(({ candidateId, benchmarkId, arm }) => [
				candidateId,
				benchmarkId.split("/").at(-1),
				arm,
			]),
			[
				["S12", "blowfish", "authoritative"],
				["S12", "blowfish", "shadow-trace"],
				["S12", "bzip2", "shadow-trace"],
				["S12", "bzip2", "authoritative"],
				["L46", "bzip2", "authoritative"],
				["L46", "bzip2", "shadow-trace"],
				["L46", "blowfish", "shadow-trace"],
				["L46", "blowfish", "authoritative"],
			],
		);
		assert.deepEqual(preregistration.candidates[0].expectedMetrics["benchmark://cbench-v1/blowfish"], {
			irInstructionCount: 1970,
			objectTextSizeBytes: 21501,
		});
		assert.deepEqual(
			{
				dispatchAttempts: preregistration.design.dispatchAttempts,
				allocationRetries: preregistration.design.allocationRetries,
				replacementAllocations: preregistration.design.replacementAllocations,
				failureDisposition: preregistration.design.failureDisposition,
			},
			{
				dispatchAttempts: 1,
				allocationRetries: 0,
				replacementAllocations: 0,
				failureDisposition: "terminal-infrastructure-invalid-not-treatment-result",
			},
		);
	});

	it("rejects claim, environment, mechanism, case-count, and threshold tampering against reconstruction", async () => {
		const expected = await frozenPreregistration();
		const mutations: Array<(value: typeof expected) => void> = [
			(value) => {
				value.claim = "tampered";
			},
			(value) => {
				value.environment.partition = "other";
			},
			(value) => {
				value.design.forbiddenMechanisms.pop();
			},
			(value) => {
				value.design.caseCount = 3 as typeof value.design.caseCount;
			},
			(value) => {
				value.assessment.medianOverheadLimit = 9;
			},
		];
		for (const mutate of mutations) {
			const tampered = structuredClone(expected);
			mutate(tampered);
			assert.throws(
				() => parseCompilerGymActionTracePreregistration(tampered, expected),
				/fully reconstructed sealed design|zero-model stock-cold design|FarmShare environment is not frozen/,
			);
		}
	});
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL } from "../src/compiler-gym-ir-delta-screen-adapter.js";
import {
	assertCompilerGymProxyCascadeBudgetAlgebra,
	buildCompilerGymProxyCascadePreregistration,
	COMPILER_GYM_PROXY_CASCADE_BUDGETS,
	COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS,
	COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS,
	type CompilerGymProxyCascadeBudgets,
	type CompilerGymProxyCascadePreregistrationBuildInput,
	canonicalCompilerGymProxyCascadePreregistration,
	collectCompilerGymProxyCascadeCandidateArtifacts,
	collectCompilerGymProxyCascadeImplementationClosure,
	collectCompilerGymProxyCascadeReplaySources,
	expectedCompilerGymProxyCascadeSelectedMetricAnchors,
	parseCompilerGymProxyCascadePreregistration,
	writeCompilerGymProxyCascadePreregistration,
} from "../src/compiler-gym-proxy-cascade-preregistration.js";
import {
	replayCompilerGymProxyCascade,
	selectCompilerGymProxyCascadeTrajectory,
} from "../src/compiler-gym-proxy-cascade-protocol.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SIDECAR_ROOT = resolve(REPO_ROOT, "research/autoresearch");
const TSX = resolve(REPO_ROOT, "node_modules/.bin/tsx");
const PREREGISTRATION_CLI = resolve(SIDECAR_ROOT, "src/compiler-gym-proxy-cascade-preregistration-cli.ts");
const CREATED_AT = "2026-08-29T12:00:00.000Z";

async function runPreregistrationCli(args: readonly string[]): Promise<{
	code: number;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(TSX, [PREREGISTRATION_CLI, ...args], { cwd: SIDECAR_ROOT });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
	});
}

async function buildInput(input?: {
	createdAt?: string;
	preregistrationPath?: string;
	outputDir?: string;
}): Promise<CompilerGymProxyCascadePreregistrationBuildInput> {
	const replaySources = await collectCompilerGymProxyCascadeReplaySources(REPO_ROOT);
	const selected = selectCompilerGymProxyCascadeTrajectory(replayCompilerGymProxyCascade(replaySources));
	const [
		candidateArtifacts,
		implementationClosure,
		latencyConfigContents,
		latencyResultManifestContents,
		sealedReplayResultContents,
		sealedReplayDigestManifestContents,
		authoritativeEvaluatorContents,
		irDeltaEvaluatorContents,
	] = await Promise.all([
		collectCompilerGymProxyCascadeCandidateArtifacts({ repoRoot: REPO_ROOT, selected }),
		collectCompilerGymProxyCascadeImplementationClosure(REPO_ROOT),
		readFile(resolve(REPO_ROOT, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyConfig.path), "utf8"),
		readFile(
			resolve(REPO_ROOT, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyResultManifest.path),
			"utf8",
		),
		readFile(
			resolve(REPO_ROOT, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayResult.path),
			"utf8",
		),
		readFile(
			resolve(REPO_ROOT, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayDigestManifest.path),
			"utf8",
		),
		readFile(resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py"), "utf8"),
		readFile(resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py"), "utf8"),
	]);
	return {
		createdAt: input?.createdAt ?? CREATED_AT,
		repoRoot: REPO_ROOT,
		preregistrationPath:
			input?.preregistrationPath ?? resolve(REPO_ROOT, ".autoresearch/proxy-cascade-test/preregistration.json"),
		outputDir: input?.outputDir ?? resolve(REPO_ROOT, ".autoresearch/proxy-cascade-test/execution"),
		replaySources,
		latencyConfigContents,
		latencyResultManifestContents,
		sealedReplayResultContents,
		sealedReplayDigestManifestContents,
		authoritativeEvaluatorContents,
		irDeltaEvaluatorContents,
		candidateArtifacts,
		implementationClosure,
	};
}

describe("CompilerGym proxy-cascade preregistration", () => {
	it("freezes the replay, sealed candidates, one-task evaluator, eight allocations, and zero-model boundaries", async () => {
		const input = await buildInput();
		const record = buildCompilerGymProxyCascadePreregistration(input);
		assert.equal(record.classification, "model-free-happy-path-wiring-qualification-only");
		assert.equal(record.historicalReplay.result.gate.passed, true);
		assert.deepEqual(record.historicalReplay.analysisArtifacts, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS);
		assert.equal(
			record.selectedTrajectory.path,
			"stock-interface-pair-screen/2026-08-28-block-v1/stock/evaluation/evidence.jsonl",
		);
		assert.deepEqual(record.selectedTrajectory.selectedOrdinals, [2, 3]);
		assert.deepEqual(record.selectedTrajectory.omittedOrdinals, [1, 4]);
		assert.deepEqual(record.selectedTrajectory.selectionContracts, COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS);
		assert.equal(record.candidateSources.length, 4);
		assert.deepEqual(
			record.candidateSources.map((candidate) => [
				candidate.ordinal,
				candidate.artifactFileType,
				candidate.artifactMode,
				candidate.artifactSymbolicLink,
				candidate.expectedMetrics.blowfish.irInstructionCount,
				candidate.expectedMetrics.blowfish.objectTextSizeBytes,
				candidate.expectedMetrics.bzip2.irInstructionCount,
				candidate.expectedMetrics.bzip2.objectTextSizeBytes,
			]),
			[
				[1, "regular", "0600", false, 2_091, 11_711, 16_422, 159_733],
				[2, "regular", "0600", false, 1_970, 13_176, 13_804, 166_266],
				[3, "regular", "0600", false, 1_958, 21_408, 13_802, 166_330],
				[4, "regular", "0600", false, 1_980, 22_869, 14_192, 172_351],
			],
		);
		assert.deepEqual(expectedCompilerGymProxyCascadeSelectedMetricAnchors(), [
			{
				ordinal: 1,
				blowfishIr: 2_091,
				blowfishObjectTextSizeBytes: 11_711,
				bzip2Ir: 16_422,
				bzip2ObjectTextSizeBytes: 159_733,
			},
			{
				ordinal: 2,
				blowfishIr: 1_970,
				blowfishObjectTextSizeBytes: 13_176,
				bzip2Ir: 13_804,
				bzip2ObjectTextSizeBytes: 166_266,
			},
			{
				ordinal: 3,
				blowfishIr: 1_958,
				blowfishObjectTextSizeBytes: 21_408,
				bzip2Ir: 13_802,
				bzip2ObjectTextSizeBytes: 166_330,
			},
			{
				ordinal: 4,
				blowfishIr: 1_980,
				blowfishObjectTextSizeBytes: 22_869,
				bzip2Ir: 14_192,
				bzip2ObjectTextSizeBytes: 172_351,
			},
		]);
		assert.equal(record.frozenCommon.adapterOutputProtocol, COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL);
		assert.equal(record.phasePlan.allocations.length, 8);
		assert.deepEqual(record.phasePlan.phaseCounts, {
			proxyBlowfish: 4,
			selectedBzip2: 2,
			omittedBzip2Audit: 2,
			total: 8,
		});
		assert.deepEqual(record.isolation, {
			modelCalls: 0,
			providerDispatches: 0,
			rlmChildren: 0,
			compaction: false,
			webAccess: false,
			gpuAllocations: 0,
			measurementReuse: false,
			retries: 0,
			replacements: 0,
			adaptiveCandidateSubstitution: false,
			agentVisibilityOfAuditMeasurements: false,
		});
		assert.deepEqual(record.phaseSeals.selection.requiresAllocationOrdinals, [1, 2, 3, 4]);
		assert.deepEqual(record.phaseSeals.cascade.requiresAllocationOrdinals, [1, 2, 3, 4, 5, 6]);
		assert.deepEqual(record.phaseSeals.audit.requiresAllocationOrdinals, [1, 2, 3, 4, 5, 6, 7, 8]);
		assert.equal(record.remoteLocks.writeFsyncCloseReadbackExact, true);
		assert.equal(record.budgets.actualFreshOneTaskAllocations, 8);
		assert.equal(record.budgets.counterfactualCascadeAllocations, 6);
		assert.equal(record.budgets.allocationSavingBasis, "allocation-count-only-not-time-or-cpu");
		assert.equal(record.decisionPolicy.computeSavingClaim, "counterfactual-six-versus-eight-allocation-count-only");
		assert.doesNotThrow(() => assertCompilerGymProxyCascadeBudgetAlgebra(record.budgets, record.phasePlan));
		assert.deepEqual(parseCompilerGymProxyCascadePreregistration({ value: record, expected: input }), record);
	});

	it("rejects every inconsistent allocation, CPU, and wall budget projection", () => {
		assert.doesNotThrow(() => assertCompilerGymProxyCascadeBudgetAlgebra(COMPILER_GYM_PROXY_CASCADE_BUDGETS));
		for (const mutate of [
			(value: CompilerGymProxyCascadeBudgets) => {
				value.actualFreshOneTaskAllocations = 9;
			},
			(value: CompilerGymProxyCascadeBudgets) => {
				value.counterfactualCascadeAllocations = 7;
			},
			(value: CompilerGymProxyCascadeBudgets) => {
				value.counterfactualAllocationReductionNumerator = 3;
			},
			(value: CompilerGymProxyCascadeBudgets) => {
				value.allocationWallMinutesMaximum = 41;
			},
			(value: CompilerGymProxyCascadeBudgets) => {
				value.requestedTaskCpuMinutesMaximum = 81;
			},
			(value: CompilerGymProxyCascadeBudgets) => {
				value.schedulerLogicalCpuMinutesMaximum = 161;
			},
		]) {
			const changed = structuredClone(COMPILER_GYM_PROXY_CASCADE_BUDGETS);
			mutate(changed);
			assert.throws(() => assertCompilerGymProxyCascadeBudgetAlgebra(changed), /budget algebra drifted/);
		}
	});

	it("uses one cross-worktree attempt lock and excludes timestamps and output paths from scientific identity", async () => {
		const firstInput = await buildInput();
		const first = buildCompilerGymProxyCascadePreregistration(firstInput);
		const second = buildCompilerGymProxyCascadePreregistration({
			...firstInput,
			createdAt: "2026-08-30T12:00:00.000Z",
			preregistrationPath: resolve(REPO_ROOT, ".autoresearch/proxy-cascade-other/preregistration.json"),
			outputDir: resolve(REPO_ROOT, ".autoresearch/proxy-cascade-other/execution"),
		});
		assert.equal(first.scientificIdentitySha256, second.scientificIdentitySha256);
		assert.equal(first.localAttemptLock.path, second.localAttemptLock.path);
		assert.equal(
			first.localAttemptLock.path,
			resolve(
				homedir(),
				".local/state/prime-agent-autoresearch/attempt-locks",
				`proxy-cascade-${first.scientificIdentitySha256}.lock`,
			),
		);
		assert.notEqual(first.phaseSeals.selection.localPath, second.phaseSeals.selection.localPath);
	});

	it("fails closed on sealed replay, artifact metadata, artifact bytes, and reconstructed record drift", async () => {
		const input = await buildInput();
		for (const mutate of [
			(value: CompilerGymProxyCascadePreregistrationBuildInput) => {
				value.sealedReplayResultContents += " ";
			},
			(value: CompilerGymProxyCascadePreregistrationBuildInput) => {
				value.sealedReplayDigestManifestContents += " ";
			},
			(value: CompilerGymProxyCascadePreregistrationBuildInput) => {
				value.candidateArtifacts[0]!.mode = 0o100644;
			},
			(value: CompilerGymProxyCascadePreregistrationBuildInput) => {
				value.candidateArtifacts[0]!.isSymbolicLink = true;
			},
			(value: CompilerGymProxyCascadePreregistrationBuildInput) => {
				value.candidateArtifacts[0]!.contents += " ";
			},
			(value: CompilerGymProxyCascadePreregistrationBuildInput) => {
				const evaluator = value.implementationClosure.find(
					(record) => record.relativePath === "research/autoresearch/evaluators/compiler_gym_eval.py",
				);
				if (!evaluator) throw new Error("Test fixture lacks canonical evaluator closure");
				evaluator.sha256 = "f".repeat(64);
			},
		]) {
			const changed = structuredClone(input);
			mutate(changed);
			assert.throws(() => buildCompilerGymProxyCascadePreregistration(changed));
		}
		const original = buildCompilerGymProxyCascadePreregistration(input);
		const changedRecord = structuredClone(original);
		changedRecord.budgets.actualFreshOneTaskAllocations = 7 as 8;
		assert.throws(() => parseCompilerGymProxyCascadePreregistration({ value: changedRecord, expected: input }));
		const changedClosureInput = structuredClone(input);
		changedClosureInput.implementationClosure[0]!.sha256 = "f".repeat(64);
		const changedClosure = buildCompilerGymProxyCascadePreregistration(changedClosureInput);
		assert.notEqual(changedClosure.scientificIdentitySha256, original.scientificIdentitySha256);
	});

	it("writes one canonical create-exclusive mode-0600 preregistration", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-prereg-"));
		const path = join(root, "records", "preregistration.json");
		const outputDir = join(root, "execution");
		const written = await writeCompilerGymProxyCascadePreregistration({
			repoRoot: REPO_ROOT,
			path,
			outputDir,
			createdAt: CREATED_AT,
		});
		const contents = await readFile(path, "utf8");
		assert.equal(contents, canonicalCompilerGymProxyCascadePreregistration(written.record));
		assert.equal(contents, `${canonicalJson(toJsonValue(written.record))}\n`);
		assert.equal(written.sha256, sha256Text(contents));
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		await assert.rejects(
			writeCompilerGymProxyCascadePreregistration({
				repoRoot: REPO_ROOT,
				path,
				outputDir,
				createdAt: CREATED_AT,
			}),
			/EEXIST/,
		);
	});

	it("CLI emits one canonical success record and emits no success stdout on argument or existing-output failures", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-prereg-cli-"));
		const path = join(root, "success", "preregistration.json");
		const outputDir = join(root, "success-execution");
		const args = ["--output", path, "--output-dir", outputDir, "--repo-root", REPO_ROOT];
		const success = await runPreregistrationCli(args);
		assert.equal(success.code, 0, success.stderr);
		assert.equal(success.stderr, "");
		assert.equal(success.stdout.endsWith("\n"), true);
		assert.equal(success.stdout.slice(0, -1).includes("\n"), false);
		const parsed: unknown = JSON.parse(success.stdout);
		assert.equal(success.stdout, `${canonicalJson(toJsonValue(parsed))}\n`);
		assert.deepEqual(parsed, {
			allocationCount: 8,
			classification: "model-free-happy-path-wiring-qualification-only",
			path: resolve(path),
			scientificIdentitySha256: buildCompilerGymProxyCascadePreregistration(await buildInput())
				.scientificIdentitySha256,
			sha256: sha256Text(await readFile(path, "utf8")),
		});
		assert.equal((await stat(path)).mode & 0o777, 0o600);

		const duplicate = await runPreregistrationCli(args);
		assert.notEqual(duplicate.code, 0);
		assert.equal(duplicate.stdout, "");
		assert.match(duplicate.stderr, /EEXIST/);

		const invalidArguments = await runPreregistrationCli(["--output"]);
		assert.notEqual(invalidArguments.code, 0);
		assert.equal(invalidArguments.stdout, "");
		assert.match(invalidArguments.stderr, /Missing value/);

		const existingOutputDir = join(root, "preexisting-execution");
		await mkdir(existingOutputDir, { mode: 0o700 });
		const preexistingOutput = await runPreregistrationCli([
			"--output",
			join(root, "preexisting", "preregistration.json"),
			"--output-dir",
			existingOutputDir,
			"--repo-root",
			REPO_ROOT,
		]);
		assert.notEqual(preexistingOutput.code, 0);
		assert.equal(preexistingOutput.stdout, "");
		assert.match(preexistingOutput.stderr, /output directory must be absent/);
	});
});

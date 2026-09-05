import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	assertCompilerGymProxyCascadeResourceBudgetAlgebra,
	buildCompilerGymProxyCascadeResourcePreregistration,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_IMPLEMENTATION_ENTRYPOINTS,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS,
	type CompilerGymProxyCascadeResourceBudgets,
	type CompilerGymProxyCascadeResourcePreregistrationBuildInput,
	canonicalCompilerGymProxyCascadeResourcePreregistration,
	collectCompilerGymProxyCascadeResourceCandidateArtifacts,
	collectCompilerGymProxyCascadeResourceImplementationClosure,
	parseCompilerGymProxyCascadeResourcePreregistration,
	writeCompilerGymProxyCascadeResourcePreregistration,
} from "../src/compiler-gym-proxy-cascade-resource-preregistration.js";
import { COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS } from "../src/compiler-gym-proxy-cascade-resource-protocol.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SIDECAR_ROOT = resolve(REPO_ROOT, "research/autoresearch");
const TSX = resolve(REPO_ROOT, "node_modules/.bin/tsx");
const CLI = resolve(SIDECAR_ROOT, "src/compiler-gym-proxy-cascade-resource-preregistration-cli.ts");
const CREATED_AT = "2026-08-30T05:00:00.000Z";

async function runCli(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(TSX, [CLI, ...args], { cwd: SIDECAR_ROOT });
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
}): Promise<CompilerGymProxyCascadeResourcePreregistrationBuildInput> {
	const wiringPreregistrationContents = await readFile(
		resolve(REPO_ROOT, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.preregistration.path),
		"utf8",
	);
	const [wiringResultContents, wiringEvidenceContents, candidateArtifacts, implementationClosure] = await Promise.all([
		readFile(resolve(REPO_ROOT, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.result.path), "utf8"),
		readFile(resolve(REPO_ROOT, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.evidenceLedger.path), "utf8"),
		collectCompilerGymProxyCascadeResourceCandidateArtifacts({ repoRoot: REPO_ROOT, wiringPreregistrationContents }),
		collectCompilerGymProxyCascadeResourceImplementationClosure(REPO_ROOT),
	]);
	return {
		createdAt: input?.createdAt ?? CREATED_AT,
		repoRoot: REPO_ROOT,
		preregistrationPath:
			input?.preregistrationPath ??
			resolve(REPO_ROOT, ".autoresearch/proxy-cascade-resource-test/preregistration.json"),
		outputDir: input?.outputDir ?? resolve(REPO_ROOT, ".autoresearch/proxy-cascade-resource-test/execution"),
		wiringPreregistrationContents,
		wiringResultContents,
		wiringEvidenceContents,
		candidateArtifacts,
		implementationClosure,
	};
}

describe("CompilerGym proxy-cascade resource preregistration", () => {
	it("semantically joins the live wiring qualification and freezes the counterbalanced resource screen", async () => {
		const input = await buildInput();
		const record = buildCompilerGymProxyCascadeResourcePreregistration(input);
		assert.equal(record.classification, "zero-model-counterbalanced-resource-screen-only");
		assert.equal(record.upstreamWiringQualification.semanticJoinPassed, true);
		assert.equal(
			record.upstreamWiringQualification.scientificIdentitySha256,
			COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.scientificIdentitySha256,
		);
		assert.equal(record.upstreamWiringQualification.liveScientificEvidenceEligible, true);
		assert.deepEqual(record.upstreamWiringQualification.frontierOrdinals, [3]);
		assert.equal(record.upstreamWiringQualification.championOrdinal, 3);
		assert.deepEqual(
			record.candidateSources.map((candidate) => candidate.artifactSha256),
			[
				"180ca4718a4c340e49dd256452dab7e207a02cb8ad7f4a946b1df9413ff44f4e",
				"6570ce91ccf5df0909c214a6974f525679477b9bab2dac9e44badacb315d8ce2",
				"c8ab07b7558179701fe9b9355097dffc20505db046d1218a1637ddcfc226b263",
				"790d22f57b0acb28de69e6eff92209b3954b0e2287b4e739825dfcaadda5c87f",
			],
		);
		assert.equal(
			record.candidateBundleSha256,
			COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.candidateBundleSha256,
		);
		assert.deepEqual(
			record.blockPlan.blocks.map((block) => block.armOrder),
			[
				["full-control", "proxy-cascade"],
				["proxy-cascade", "full-control"],
			],
		);
		assert.equal(record.blockPlan.totalFreshOnlineAllocations, 28);
		assert.deepEqual(record.resourceThresholds, COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS);
		assert.equal(record.gateEvidenceContract.callerSuppliedScientificPassBooleansAllowed, false);
		assert.deepEqual(record.timingContract, COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT);
		assert.match(record.timingContract.prewarm, /non-measurement/);
		assert.match(record.timingContract.perArmImmediateGate, /immediately-before-every-arm/);
		assert.equal(record.accounting.inferentialCpuSource, ".0.cpuTimeRawSeconds-reserved-logical-evaluator-step-cpu");
		assert.equal(record.isolation.modelCalls, 0);
		assert.equal(record.isolation.toolCalls, 0);
		assert.equal(record.isolation.measurementReuse, false);
		assert.equal(record.isolation.maximumConcurrentAllocations, 2);
		assert.equal(record.seals.cascadeSelection.length, 2);
		assert.equal(record.seals.arm.length, 4);
		assert.equal(record.seals.block.length, 2);
		assert.match(record.remoteLocks.blockOneCascadeSelectionPath, /block-one-cascade-selection\.lock$/);
		assert.match(record.remoteLocks.blockTwoCascadeSelectionPath, /block-two-cascade-selection\.lock$/);
		assert.deepEqual(record.remoteLocks.kinds, [
			"global",
			"block-one-control",
			"block-one-cascade-selection",
			"block-one-cascade",
			"block-one",
			"block-two-cascade-selection",
			"block-two-cascade",
			"block-two-control",
			"block-two",
			"terminal",
		]);
		assert.equal(record.budgets.totalFreshOnlineAllocations, 28);
		assert.equal(record.budgets.controlFreshAllocationsTotal, 16);
		assert.equal(record.budgets.cascadeFreshAllocationsTotal, 12);
		assert.doesNotThrow(() => assertCompilerGymProxyCascadeResourceBudgetAlgebra(record.budgets, record.blockPlan));
		for (const entrypoint of COMPILER_GYM_PROXY_CASCADE_RESOURCE_IMPLEMENTATION_ENTRYPOINTS) {
			assert.equal(
				record.implementationClosure.some((entry) => entry.relativePath === entrypoint),
				true,
				entrypoint,
			);
		}
		assert.deepEqual(parseCompilerGymProxyCascadeResourcePreregistration({ value: record, expected: input }), record);
	});

	it("rejects every inconsistent allocation, CPU, concurrency, and timed-round budget projection", () => {
		assert.doesNotThrow(() =>
			assertCompilerGymProxyCascadeResourceBudgetAlgebra(COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS),
		);
		const mutations: Array<(value: CompilerGymProxyCascadeResourceBudgets) => void> = [
			(value) => {
				value.blockCount = 3;
			},
			(value) => {
				value.controlFreshAllocationsTotal = 15;
			},
			(value) => {
				value.cascadeFreshAllocationsTotal = 13;
			},
			(value) => {
				value.totalFreshOnlineAllocations = 27;
			},
			(value) => {
				value.maximumConcurrentAllocations = 3;
			},
			(value) => {
				value.allocationWallMinutesMaximum = 139;
			},
			(value) => {
				value.requestedTaskCpuMinutesMaximum = 279;
			},
			(value) => {
				value.schedulerLogicalCpuMinutesMaximum = 559;
			},
			(value) => {
				value.maximumTimedControlArmMinutes = 21;
			},
			(value) => {
				value.maximumTimedCascadeArmMinutes = 24;
			},
		];
		for (const mutate of mutations) {
			const changed = structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS);
			mutate(changed);
			assert.throws(() => assertCompilerGymProxyCascadeResourceBudgetAlgebra(changed), /budget algebra drifted/);
		}
	});

	it("uses a cross-worktree identity lock and excludes timestamps and launch paths from scientific identity", async () => {
		const input = await buildInput();
		const first = buildCompilerGymProxyCascadeResourcePreregistration(input);
		const second = buildCompilerGymProxyCascadeResourcePreregistration({
			...input,
			createdAt: "2026-08-31T05:00:00.000Z",
			preregistrationPath: resolve(REPO_ROOT, ".autoresearch/resource-other/preregistration.json"),
			outputDir: resolve(REPO_ROOT, ".autoresearch/resource-other/execution"),
		});
		assert.equal(first.scientificIdentitySha256, second.scientificIdentitySha256);
		assert.equal(first.localAttemptLock.path, second.localAttemptLock.path);
		assert.equal(
			first.localAttemptLock.path,
			resolve(
				homedir(),
				".local/state/prime-agent-autoresearch/attempt-locks",
				`proxy-cascade-resource-${first.scientificIdentitySha256}.lock`,
			),
		);
		assert.notEqual(first.seals.arm[0]!.path, second.seals.arm[0]!.path);
		const closureDrift = structuredClone(input);
		closureDrift.implementationClosure[0]!.sha256 = "f".repeat(64);
		const drifted = buildCompilerGymProxyCascadeResourcePreregistration(closureDrift);
		assert.notEqual(drifted.scientificIdentitySha256, first.scientificIdentitySha256);
	});

	it("fails closed on wiring artifacts, candidate descriptors, closure, and reconstructed record drift", async () => {
		const input = await buildInput();
		const mutations: Array<(value: CompilerGymProxyCascadeResourcePreregistrationBuildInput) => void> = [
			(value) => {
				value.wiringPreregistrationContents += " ";
			},
			(value) => {
				value.wiringResultContents += " ";
			},
			(value) => {
				value.wiringEvidenceContents += " ";
			},
			(value) => {
				value.candidateArtifacts[0]!.mode = 0o100644;
			},
			(value) => {
				value.candidateArtifacts[0]!.isSymbolicLink = true;
			},
			(value) => {
				value.candidateArtifacts[0]!.contents += " ";
			},
			(value) => {
				value.implementationClosure = value.implementationClosure.filter(
					(entry) =>
						entry.relativePath !== "research/autoresearch/src/compiler-gym-proxy-cascade-resource-runner.ts",
				);
			},
		];
		for (const mutate of mutations) {
			const changed = structuredClone(input);
			mutate(changed);
			assert.throws(() => buildCompilerGymProxyCascadeResourcePreregistration(changed));
		}
		const record = buildCompilerGymProxyCascadeResourcePreregistration(input);
		const changedRecord = structuredClone(record);
		(
			changedRecord.resourceThresholds.feedbackReadyWall as {
				medianAbsoluteSavingMicrosecondsMinimum: number;
			}
		).medianAbsoluteSavingMicrosecondsMinimum = 1;
		assert.throws(() =>
			parseCompilerGymProxyCascadeResourcePreregistration({ value: changedRecord, expected: input }),
		);
	});

	it("writes one canonical create-exclusive mode-0600 preregistration", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-proxy-resource-prereg-"));
		const path = join(root, "records", "preregistration.json");
		const outputDir = join(root, "execution");
		const written = await writeCompilerGymProxyCascadeResourcePreregistration({
			repoRoot: REPO_ROOT,
			path,
			outputDir,
			createdAt: CREATED_AT,
		});
		const contents = await readFile(path, "utf8");
		assert.equal(contents, canonicalCompilerGymProxyCascadeResourcePreregistration(written.record));
		assert.equal(contents, `${canonicalJson(toJsonValue(written.record))}\n`);
		assert.equal(written.sha256, sha256Text(contents));
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		await assert.rejects(
			writeCompilerGymProxyCascadeResourcePreregistration({
				repoRoot: REPO_ROOT,
				path,
				outputDir,
				createdAt: CREATED_AT,
			}),
			/EEXIST/,
		);
	});

	it("CLI emits one canonical success record and no success stdout on argument or output-state failures", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-proxy-resource-cli-"));
		const path = join(root, "success", "preregistration.json");
		const outputDir = join(root, "execution");
		const args = ["--output", path, "--output-dir", outputDir, "--repo-root", REPO_ROOT];
		const success = await runCli(args);
		assert.equal(success.code, 0, success.stderr);
		assert.equal(success.stderr, "");
		assert.equal(success.stdout.endsWith("\n"), true);
		assert.equal(success.stdout.slice(0, -1).includes("\n"), false);
		const parsed: unknown = JSON.parse(success.stdout);
		assert.equal(success.stdout, `${canonicalJson(toJsonValue(parsed))}\n`);
		assert.deepEqual(parsed, {
			allocationCount: 28,
			classification: "zero-model-counterbalanced-resource-screen-only",
			path: resolve(path),
			scientificIdentitySha256: buildCompilerGymProxyCascadeResourcePreregistration(await buildInput())
				.scientificIdentitySha256,
			sha256: sha256Text(await readFile(path, "utf8")),
		});
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		const duplicate = await runCli(args);
		assert.notEqual(duplicate.code, 0);
		assert.equal(duplicate.stdout, "");
		assert.match(duplicate.stderr, /EEXIST/);
		const invalid = await runCli(["--output"]);
		assert.notEqual(invalid.code, 0);
		assert.equal(invalid.stdout, "");
		assert.match(invalid.stderr, /Missing value/);
		const existingOutput = join(root, "existing-output");
		await mkdir(existingOutput, { mode: 0o700 });
		const blocked = await runCli([
			"--output",
			join(root, "blocked", "preregistration.json"),
			"--output-dir",
			existingOutput,
			"--repo-root",
			REPO_ROOT,
		]);
		assert.notEqual(blocked.code, 0);
		assert.equal(blocked.stdout, "");
		assert.match(blocked.stderr, /output directory must be absent/);
	});
});

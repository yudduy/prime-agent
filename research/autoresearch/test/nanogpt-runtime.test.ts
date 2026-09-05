import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { NANOGPT_BASELINE_FIXTURE, NANOGPT_BASELINE_SHA256 } from "../src/nanogpt-contract.js";
import {
	extractNanoGptRuntimeMetrics,
	materializeNanoGptRuntime,
	NANOGPT_RUNTIME_CANDIDATE_NAME,
	NANOGPT_RUNTIME_CLAIM_SCOPE,
	NANOGPT_RUNTIME_CONTRACT_ID,
	NANOGPT_RUNTIME_MANIFEST_NAME,
	NANOGPT_RUNTIME_PROGRAM_NAME,
	type NanoGptRuntimeManifest,
	parseNanoGptRuntimeManifest,
	parseNanoGptRuntimeMetrics,
	verifyNanoGptRuntimeBundle,
} from "../src/nanogpt-runtime.js";

describe("NanoGPT stock-only deterministic runtime contract", () => {
	let directory = "";
	let baseline = "";

	before(async () => {
		directory = await mkdtemp(join(tmpdir(), "prime-nanogpt-runtime-"));
		baseline = await readFile(NANOGPT_BASELINE_FIXTURE, "utf8");
	});

	after(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	async function reducedPatch(name: string): Promise<string> {
		const target = join(directory, name);
		await writeFile(
			target,
			[
				"--- a/train_gpt_simple.py",
				"+++ b/train_gpt_simple.py",
				"@@ -281 +281 @@",
				"-    train_steps = 3290",
				"+    train_steps = 3289",
				"",
			].join("\n"),
			"utf8",
		);
		return target;
	}

	async function materializedManifest(bundlePath: string): Promise<NanoGptRuntimeManifest> {
		const raw: unknown = JSON.parse(await readFile(join(bundlePath, NANOGPT_RUNTIME_MANIFEST_NAME), "utf8"));
		return parseNanoGptRuntimeManifest(raw);
	}

	async function expectMissing(path: string): Promise<void> {
		await assert.rejects(access(path));
	}

	async function syntheticLog(
		bundlePath: string,
		loss: number,
		overrides: {
			readonly backwardCalls?: number;
			readonly optimizerSteps?: number;
			readonly omitComplete?: boolean;
		} = {},
	): Promise<string> {
		const manifest = await materializedManifest(bundlePath);
		const runtime = await readFile(join(bundlePath, NANOGPT_RUNTIME_PROGRAM_NAME), "utf8");
		const seed = manifest.expectedSeeds[0];
		const lines = [
			"Running PyTorch 2.8.0 compiled for CUDA 12.8 on NVIDIA L40S with world_size 1",
			`seed:${seed}`,
			[
				"PRIME_NANOGPT_RUNTIME_CONTRACT",
				`contract=${NANOGPT_RUNTIME_CONTRACT_ID}`,
				`candidate_sha256=${manifest.candidate.sha256}`,
				`mode=${manifest.mode}`,
				"trial=0",
				`seed=${seed}`,
				`declared_train_steps=${manifest.declaredTrainSteps}`,
				`effective_train_steps=${manifest.effectiveTrainSteps}`,
			].join("|"),
			`step:0/${manifest.effectiveTrainSteps} val_loss:11.00000 train_time:0.001s step_avg:nanms`,
			`step:${manifest.effectiveTrainSteps}/${manifest.effectiveTrainSteps} val_loss:${loss.toFixed(5)} train_time:1.234s step_avg:1.00ms`,
			[
				"PRIME_NANOGPT_RUNTIME_RESULT",
				"trial=0",
				`seed=${seed}`,
				`declared_train_steps=${manifest.declaredTrainSteps}`,
				`effective_train_steps=${manifest.effectiveTrainSteps}`,
				`final_val_loss=${loss.toFixed(9)}`,
				`optimizer_steps=${overrides.optimizerSteps ?? manifest.effectiveTrainSteps}`,
				`backward_calls=${overrides.backwardCalls ?? manifest.effectiveTrainSteps * 8}`,
				"peak_vram_mb=1234.500",
			].join("|"),
		];
		if (!overrides.omitComplete) lines.push("PRIME_NANOGPT_RUNTIME_COMPLETE|trials=1");
		const target = join(directory, `runtime-${randomUUID()}.log`);
		await writeFile(target, `${runtime}\n${"=".repeat(100)}\n${lines.join("\n")}\n`, "utf8");
		return target;
	}

	it("materializes only the byte-exact stock fixture into a deterministic one-trial smoke bundle", async () => {
		const firstBundle = join(directory, "smoke-stock-a");
		const secondBundle = join(directory, "smoke-stock-b");
		const first = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: firstBundle,
			mode: "cuda-smoke-10",
		});
		const second = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: secondBundle,
			mode: "cuda-smoke-10",
		});
		assert.equal(first.ok, true);
		assert.equal(second.ok, true);
		if (!first.ok || first.operation === "extract" || !second.ok || second.operation === "extract") {
			assert.fail("expected two materialized stock bundles");
		}
		assert.equal(first.contract, NANOGPT_RUNTIME_CONTRACT_ID);
		assert.equal(first.manifest.candidate.sha256, NANOGPT_BASELINE_SHA256);
		assert.equal(first.manifest.sourceIntegrity.patchSha256, null);
		assert.equal(first.manifest.mode, "cuda-smoke-10");
		assert.equal(first.manifest.declaredTrainSteps, 3290);
		assert.equal(first.manifest.effectiveTrainSteps, 10);
		assert.equal(first.manifest.expectedTrials, 1);
		assert.deepEqual(first.manifest.expectedSeeds, [0xc0ffee]);
		assert.equal(first.manifest.claimScope, NANOGPT_RUNTIME_CLAIM_SCOPE);
		assert.equal(first.manifest.acceptance.scoredEligible, false);
		assert.equal(first.manifest.acceptance.recordEligible, false);
		assert.deepEqual(first.manifest.launch.args, [
			"--standalone",
			"--nnodes=1",
			"--nproc-per-node=1",
			NANOGPT_RUNTIME_PROGRAM_NAME,
			"1",
		]);
		assert.throws(() => parseNanoGptRuntimeManifest({ ...first.manifest, unexpected: true }));
		assert.throws(() =>
			parseNanoGptRuntimeManifest({
				...first.manifest,
				candidate: { ...first.manifest.candidate, unexpected: true },
			}),
		);
		assert.equal(
			await readFile(join(firstBundle, NANOGPT_RUNTIME_MANIFEST_NAME), "utf8"),
			await readFile(join(secondBundle, NANOGPT_RUNTIME_MANIFEST_NAME), "utf8"),
		);
		assert.equal(
			await readFile(join(firstBundle, NANOGPT_RUNTIME_PROGRAM_NAME), "utf8"),
			await readFile(join(secondBundle, NANOGPT_RUNTIME_PROGRAM_NAME), "utf8"),
		);
	});

	it("returns structured failures for literal patches, scored mode, and non-fixed trial counts", async () => {
		const patchOutput = join(directory, "patch-rejected");
		const patched = await materializeNanoGptRuntime({
			patchPath: await reducedPatch("literal-step.patch"),
			outputPath: patchOutput,
			mode: "cuda-smoke-10",
		});
		assert.equal(patched.ok, false);
		assert.equal(patched.operation, "materialize");
		assert.match(patched.errors[0]?.message ?? "", /does not accept patch inputs/);
		await expectMissing(patchOutput);

		const scoredOutput = join(directory, "scored-rejected");
		const scored = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: scoredOutput,
			mode: "scored",
			trials: 8,
		});
		assert.equal(scored.ok, false);
		assert.equal(scored.operation, "materialize");
		assert.match(scored.errors[0]?.message ?? "", /supports only cuda-smoke-10/);
		await expectMissing(scoredOutput);

		const multiTrialOutput = join(directory, "multi-trial-rejected");
		const multiTrial = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: multiTrialOutput,
			mode: "cuda-smoke-10",
			trials: 2,
		});
		assert.equal(multiTrial.ok, false);
		assert.match(multiTrial.errors[0]?.message ?? "", /exactly one trial/);
		await expectMissing(multiTrialOutput);
	});

	it("rejects every representative non-stock namespace mutation before creating a bundle", async () => {
		const optimizerAnchor = "def zeropower_via_newtonschulz5";
		const cases = [
			{
				name: "dynamic-reflection",
				source: baseline.replace(
					optimizerAnchor,
					`runtime_reflector = object.__getattribute__\n\n${optimizerAnchor}`,
				),
			},
			{
				name: "dynamic-model-class",
				source: baseline.replace(optimizerAnchor, `GPT.runtime_policy = object()\n\n${optimizerAnchor}`),
			},
			{
				name: "indirect-backward-alias",
				source: baseline.replace(optimizerAnchor, `backward_alias = Tensor.backward\n\n${optimizerAnchor}`),
			},
			{
				name: "extra-optimizer-step",
				source: baseline.replace(
					'                group["lr"] = group["initial_lr"] * eta',
					'                group["lr"] = group["initial_lr"] * eta\n                opt.step()',
				),
			},
			{
				name: "alternate-cuda-rng-alias",
				source: baseline.replace(
					"    train_steps = 3290",
					"    train_steps = 3290\n    cuda_rng_alias = torch.cuda.manual_seed_all",
				),
			},
			{
				name: "logger-global-mutation",
				source: baseline.replace(optimizerAnchor, `print = lambda *_args, **_kwargs: None\n\n${optimizerAnchor}`),
			},
		];

		for (const testCase of cases) {
			assert.notEqual(testCase.source, baseline);
			const candidatePath = join(directory, `${testCase.name}.py`);
			const outputPath = join(directory, `${testCase.name}-bundle`);
			await writeFile(candidatePath, testCase.source, "utf8");
			const result = await materializeNanoGptRuntime({
				candidatePath,
				outputPath,
				mode: "cuda-smoke-10",
			});
			assert.equal(result.ok, false, testCase.name);
			assert.equal(result.operation, "materialize", testCase.name);
			assert.match(result.errors[0]?.message ?? "", /byte-exact pinned stock fixture/, testCase.name);
			await expectMissing(outputPath);
		}

		const crlfPath = join(directory, "crlf-stock.py");
		const crlfOutput = join(directory, "crlf-stock-bundle");
		await writeFile(crlfPath, baseline.replaceAll("\n", "\r\n"), "utf8");
		const crlf = await materializeNanoGptRuntime({
			candidatePath: crlfPath,
			outputPath: crlfOutput,
			mode: "cuda-smoke-10",
		});
		assert.equal(crlf.ok, false);
		await expectMissing(crlfOutput);
	});

	it("recomputes the stock validation and deterministic instrumentation before accepting a bundle", async () => {
		const bundlePath = join(directory, "tamper-check");
		const materialized = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: bundlePath,
			mode: "cuda-smoke-10",
		});
		assert.equal(materialized.ok, true);
		const clean = await verifyNanoGptRuntimeBundle(bundlePath);
		assert.equal(clean.ok, true);

		const manifestPath = join(bundlePath, NANOGPT_RUNTIME_MANIFEST_NAME);
		const manifestSource = await readFile(manifestPath, "utf8");
		await chmod(manifestPath, 0o600);
		await writeFile(manifestPath, manifestSource.replace('"recordEligible":false', '"recordEligible":true'), "utf8");
		const manifestTamper = await verifyNanoGptRuntimeBundle(bundlePath);
		assert.equal(manifestTamper.ok, false);
		assert.match(manifestTamper.errors[0]?.message ?? "", /deterministic manifest/);
		await writeFile(manifestPath, manifestSource, "utf8");

		const runtimePath = join(bundlePath, NANOGPT_RUNTIME_PROGRAM_NAME);
		await chmod(runtimePath, 0o600);
		await writeFile(runtimePath, `${await readFile(runtimePath, "utf8")}# tampered\n`, "utf8");
		const runtimeTamper = await verifyNanoGptRuntimeBundle(bundlePath);
		assert.equal(runtimeTamper.ok, false);
		assert.match(runtimeTamper.errors[0]?.message ?? "", /runtime source hash/);
	});

	it("extracts only the complete fixed stock smoke and emits no score or record eligibility", async () => {
		const bundlePath = join(directory, "metric-stock");
		const materialized = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: bundlePath,
			mode: "cuda-smoke-10",
		});
		assert.equal(materialized.ok, true);
		const logPath = await syntheticLog(bundlePath, 3.5);
		const extracted = await extractNanoGptRuntimeMetrics({ bundlePath, logPath, exitCode: 0 });
		assert.equal(extracted.ok, true);
		if (!extracted.ok || extracted.operation !== "extract") assert.fail("expected extracted runtime metrics");
		assert.equal(extracted.metrics.candidateSha256, NANOGPT_BASELINE_SHA256);
		assert.equal(extracted.metrics.declaredTrainSteps, 3290);
		assert.equal(extracted.metrics.effectiveTrainSteps, 10);
		assert.equal(extracted.metrics.trials, 1);
		assert.deepEqual(extracted.metrics.seeds, [0xc0ffee]);
		assert.deepEqual(extracted.metrics.optimizerSteps, [10]);
		assert.deepEqual(extracted.metrics.backwardCalls, [80]);
		assert.equal(extracted.metrics.meanValidationLoss, 3.5);
		assert.equal(extracted.metrics.claimScope, NANOGPT_RUNTIME_CLAIM_SCOPE);
		assert.equal(extracted.metrics.scoredEligible, false);
		assert.equal(extracted.metrics.recordEligible, false);
		assert.equal(extracted.metrics.recordPassed, null);
		assert.equal(extracted.metrics.environment.gpu, "NVIDIA L40S");
	});

	it("rejects forged metrics and inconsistent fixed relationships in the TypeScript boundary", async () => {
		const bundlePath = join(directory, "metric-parser");
		const materialized = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: bundlePath,
			mode: "cuda-smoke-10",
		});
		assert.equal(materialized.ok, true);
		const logPath = await syntheticLog(bundlePath, 3.5);
		const extracted = await extractNanoGptRuntimeMetrics({ bundlePath, logPath, exitCode: 0 });
		assert.equal(extracted.ok, true);
		if (!extracted.ok || extracted.operation !== "extract") assert.fail("expected extracted runtime metrics");
		const metrics = extracted.metrics;
		const forgeries: readonly unknown[] = [
			{ ...metrics, unexpected: true },
			{ ...metrics, recordEligible: true },
			{ ...metrics, scoredEligible: true },
			{ ...metrics, seeds: [0xc0ffef] },
			{ ...metrics, meanValidationLoss: 3.4 },
			{ ...metrics, runtimeValidationLosses: [3.6] },
			{ ...metrics, optimizerSteps: [9] },
			{ ...metrics, backwardCalls: [79] },
			{ ...metrics, peakVramMb: [-1] },
			{ ...metrics, environment: { ...metrics.environment, unexpected: true } },
		];
		for (const forgery of forgeries) assert.throws(() => parseNanoGptRuntimeMetrics(forgery));
	});

	it("fails closed on non-zero exit, incomplete completion, or execution-count drift", async () => {
		const bundlePath = join(directory, "metric-failures");
		const materialized = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: bundlePath,
			mode: "cuda-smoke-10",
		});
		assert.equal(materialized.ok, true);

		const validLog = await syntheticLog(bundlePath, 3.5);
		const nonZero = await extractNanoGptRuntimeMetrics({ bundlePath, logPath: validLog, exitCode: 1 });
		assert.equal(nonZero.ok, false);

		const incompleteLog = await syntheticLog(bundlePath, 3.5, { omitComplete: true });
		const incomplete = await extractNanoGptRuntimeMetrics({ bundlePath, logPath: incompleteLog, exitCode: 0 });
		assert.equal(incomplete.ok, false);

		const backwardDrift = await syntheticLog(bundlePath, 3.5, { backwardCalls: 79 });
		const driftedBackward = await extractNanoGptRuntimeMetrics({
			bundlePath,
			logPath: backwardDrift,
			exitCode: 0,
		});
		assert.equal(driftedBackward.ok, false);

		const optimizerDrift = await syntheticLog(bundlePath, 3.5, { optimizerSteps: 9 });
		const driftedOptimizer = await extractNanoGptRuntimeMetrics({
			bundlePath,
			logPath: optimizerDrift,
			exitCode: 0,
		});
		assert.equal(driftedOptimizer.ok, false);
	});

	it("does not overwrite an existing stock bundle", async () => {
		const bundlePath = join(directory, "no-overwrite");
		const first = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: bundlePath,
			mode: "cuda-smoke-10",
		});
		assert.equal(first.ok, true);
		const candidateBefore = await readFile(join(bundlePath, NANOGPT_RUNTIME_CANDIDATE_NAME), "utf8");
		const second = await materializeNanoGptRuntime({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			outputPath: bundlePath,
			mode: "cuda-smoke-10",
		});
		assert.equal(second.ok, false);
		assert.equal(await readFile(join(bundlePath, NANOGPT_RUNTIME_CANDIDATE_NAME), "utf8"), candidateBefore);
	});
});

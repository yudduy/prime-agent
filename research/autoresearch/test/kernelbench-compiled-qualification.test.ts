import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../src/canonical-json.js";
import {
	buildKernelBenchCompiledQualificationJobScript,
	DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG,
	KERNELBENCH_COMPILED_ENVIRONMENT_SHA256,
	KERNELBENCH_COMPILED_HIDDEN_PATH,
	KERNELBENCH_COMPILED_HIDDEN_SHA256,
	KERNELBENCH_COMPILED_POSITIVE_SHA256,
	KERNELBENCH_COMPILED_QUALIFICATION_EPOCH_PREFIX,
	KERNELBENCH_COMPILED_QUALIFICATION_TASKS,
	KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT,
	KERNELBENCH_COMPILED_READINESS_REMOTE,
	KERNELBENCH_COMPILED_TASK_PATH,
	KERNELBENCH_COMPILED_TASK_SHA256,
	KERNELBENCH_COMPILED_WRONG_SHA256,
	type KernelBenchCompiledBootstrapAssets,
	KernelBenchCompiledQualificationAdapter,
	type KernelBenchCompiledQualificationContract,
	type KernelBenchCompiledQualificationTransport,
	type KernelBenchCompiledRemoteAssets,
	type KernelBenchCompiledRemotePoll,
	kernelBenchCompiledQualificationBoundaryConditions,
	parseKernelBenchCompiledQualificationHandle,
	parseKernelBenchCompiledQualificationReadiness,
	parseKernelBenchCompiledQualificationResult,
} from "../src/kernelbench-compiled-qualification-adapter.js";
import { KERNELBENCH_VERIFIED_COMMIT } from "../src/kernelbench-qualification-adapter.js";
import type { EvaluationContext, EvaluationJob } from "../src/types.js";

const EVALUATOR_PATH = fileURLToPath(new URL("../evaluators/kernelbench_compiled_qualify.py", import.meta.url));
const ENVIRONMENT_PATH = fileURLToPath(new URL("../farmshare/kernelbench-compiled-environment.lock", import.meta.url));
const BOOTSTRAP_PATH = fileURLToPath(new URL("../farmshare/bootstrap-kernelbench-compiled.sh", import.meta.url));
const POSITIVE_PATH = fileURLToPath(
	new URL("../candidates/kernelbench/level2-2-inductor-fullgraph-v1.py", import.meta.url),
);
const WRONG_PATH = fileURLToPath(
	new URL("../candidates/kernelbench/level2-2-inductor-wrong-output-v1.py", import.meta.url),
);
const CONTROLLER_JOB_ID = `job_${"c".repeat(24)}`;
const SLURM_JOB_ID = "12345";

interface CommandResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
	return new Promise((done) => {
		execFile(command, args, { encoding: "utf8", env: process.env }, (error, stdout, stderr) => {
			done({
				exitCode: error && typeof error.code === "number" ? error.code : error ? null : 0,
				stdout,
				stderr,
			});
		});
	});
}

function readinessResult(environmentSpecSha256: string, revision = "base"): string {
	const environmentManifest = `${JSON.stringify({
		schemaVersion: 1,
		environmentSpecSha256,
		kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
		numpy: "2.5.2",
		pip: "25.2",
		python: "3.12.3",
		torch: "2.11.0+cu128",
		torchCuda: "12.8",
	})}\n`;
	const pipFreeze = `numpy==2.5.2\npip==25.2\ntorch==2.11.0+cu128\ntriton==3.7.0\nfixture==${revision}\n`;
	const environmentSeal = `${JSON.stringify({
		schemaVersion: 1,
		environmentSpecSha256,
		environmentManifestSha256: sha256Text(environmentManifest),
		pipFreezeSha256: sha256Text(pipFreeze),
	})}\n`;
	return JSON.stringify({
		schemaVersion: 1,
		checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
		environmentSpecSha256,
		environmentManifest,
		pipFreeze,
		environmentSeal,
		taskInput: {
			taskSha256: KERNELBENCH_COMPILED_TASK_SHA256,
			hiddenTestSha256: KERNELBENCH_COMPILED_HIDDEN_SHA256,
		},
		runtime: {
			python: "3.12.3",
			pip: "25.2",
			torch: "2.11.0+cu128",
			torchCuda: "12.8",
			numpy: "2.5.2",
			hasTorchCompile: true,
			hasInductor: true,
			hasTriton: true,
		},
	});
}

function fixtureContract(evaluatorSha256: string, revision = "base"): KernelBenchCompiledQualificationContract {
	return parseKernelBenchCompiledQualificationReadiness(
		readinessResult(KERNELBENCH_COMPILED_ENVIRONMENT_SHA256, revision),
		evaluatorSha256,
		KERNELBENCH_COMPILED_ENVIRONMENT_SHA256,
	);
}

function hiddenConfig(index: number) {
	const referenceSamplesMs = Array.from({ length: 10 }, (_, sample) => 2 + index / 10 + sample / 100);
	const positiveSamplesMs = Array.from({ length: 10 }, (_, sample) => 1 + index / 10 + sample / 100);
	return {
		index,
		positivePassed: true,
		wrongCandidateRejected: true,
		positiveFirstInvocationMs: 1000 + index,
		referenceSamplesMs,
		positiveSamplesMs,
		speedup:
			referenceSamplesMs.reduce((sum, value) => sum + value, 0) /
			positiveSamplesMs.reduce((sum, value) => sum + value, 0),
	};
}

function successfulResult(
	evaluatorSha256: string,
	requestSha256: string,
	jobId = CONTROLLER_JOB_ID,
	slurmJobId = SLURM_JOB_ID,
) {
	const contract = fixtureContract(evaluatorSha256);
	const hiddenConfigs = [1, 2, 3, 4].map(hiddenConfig);
	const referenceSamples = hiddenConfigs.flatMap((config) => config.referenceSamplesMs);
	const positiveSamples = hiddenConfigs.flatMap((config) => config.positiveSamplesMs);
	const firstInvocations = hiddenConfigs.map((config) => config.positiveFirstInvocationMs);
	const speedups = hiddenConfigs.map((config) => config.speedup);
	const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
	const evidence = contract.environmentEvidence;
	return {
		schemaVersion: 1,
		ok: true,
		verifierEpoch: contract.verifierEpoch,
		verifierManifest: contract.verifierManifest,
		jobId,
		requestSha256,
		startedAt: "2026-08-27T00:00:00.000Z",
		finishedAt: "2026-08-27T00:01:00.000Z",
		checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
		taskSha256: KERNELBENCH_COMPILED_TASK_SHA256,
		hiddenTestSha256: KERNELBENCH_COMPILED_HIDDEN_SHA256,
		positiveCandidateSha256: KERNELBENCH_COMPILED_POSITIVE_SHA256,
		wrongCandidateSha256: KERNELBENCH_COMPILED_WRONG_SHA256,
		evaluatorSha256,
		environmentSpecSha256: KERNELBENCH_COMPILED_ENVIRONMENT_SHA256,
		environmentManifestSha256: evidence.environmentManifestSha256,
		pipFreezeSha256: evidence.pipFreezeSha256,
		environmentSealSha256: evidence.environmentSealSha256,
		environmentManifest: evidence.environmentManifest,
		pipFreeze: evidence.pipFreeze,
		environmentSeal: evidence.environmentSeal,
		precision: {
			dtype: "float32",
			matmulPrecision: "high",
			matmulAllowTf32: true,
			cudnnAllowTf32: true,
			atol: 1e-3,
			rtol: 1e-3,
		},
		timing: { warmups: 3, trials: 10, unit: "milliseconds", coldFirstInvocationSeparate: true },
		compilation: { backend: "inductor", fullgraph: true, dynamic: false },
		hardware: {
			cluster: "Stanford FarmShare",
			hostname: "oat-01",
			gpuName: "NVIDIA L40S",
			gpuComputeCapability: "8.9",
			gpuTotalMemoryBytes: 48_000_000_000,
			torchVersion: "2.11.0+cu128",
			torchCudaVersion: "12.8",
			numpyVersion: "2.5.2",
			slurmJobId,
			cudaVisibleDevices: "0",
		},
		fatalKind: null,
		fatalError: null,
		tasks: [
			{
				benchmarkId: "level2/2",
				status: "accepted",
				failureKind: null,
				errors: [],
				startedAt: "2026-08-27T00:00:00.000Z",
				finishedAt: "2026-08-27T00:01:00.000Z",
				taskPath: KERNELBENCH_COMPILED_TASK_PATH,
				hiddenTestPath: KERNELBENCH_COMPILED_HIDDEN_PATH,
				taskSha256: KERNELBENCH_COMPILED_TASK_SHA256,
				hiddenTestSha256: KERNELBENCH_COMPILED_HIDDEN_SHA256,
				hiddenConfigs,
				metrics: {
					qualified: 1,
					hiddenConfigsPassed: 4,
					wrongCandidatesRejected: 4,
					coldCompileMs: firstInvocations[0],
					firstInvocationMeanMs: mean(firstInvocations),
					referenceMeanMs: mean(referenceSamples),
					positiveMeanMs: mean(positiveSamples),
					speedupGeomean: Math.exp(speedups.reduce((sum, value) => sum + Math.log(value), 0) / speedups.length),
					fastAtOne: speedups.every((speedup) => speedup > 1) ? 1 : 0,
				},
			},
		],
	};
}

function evaluationJob(contract: KernelBenchCompiledQualificationContract, candidateSource: string): EvaluationJob {
	return {
		jobId: CONTROLLER_JOB_ID,
		manifestDigest: "d".repeat(64),
		branchId: "compiled-qualification",
		lane: "kernelbench",
		benchmarkIds: [...KERNELBENCH_COMPILED_QUALIFICATION_TASKS],
		budgetClass: "smoke",
		treatment: KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT,
		proposal: {
			hypothesis: "compiled candidate preserves correctness",
			mechanism: "allowlisted qualification",
			predictedOutcome: "positive passes and wrong fails",
			boundaryConditions: [...kernelBenchCompiledQualificationBoundaryConditions(contract)],
			parentJobIds: [],
		},
		candidate: {
			digest: sha256Text(candidateSource),
			byteLength: Buffer.byteLength(candidateSource),
			mediaType: "text/x-python",
		},
		candidateFormat: "python-source",
		candidateContent: candidateSource,
	};
}

class FauxTransport implements KernelBenchCompiledQualificationTransport {
	assets: KernelBenchCompiledRemoteAssets | null = null;
	bootstrapAssets: KernelBenchCompiledBootstrapAssets | null = null;
	events: string[] = [];
	actualDispatches = 0;
	private dispatched = false;

	constructor(
		private readonly evaluatorSha256: string,
		private readonly readinessRaw: string,
	) {}

	async bootstrap(_root: string, assets: KernelBenchCompiledBootstrapAssets): Promise<void> {
		this.events.push("bootstrap");
		this.bootstrapAssets = assets;
	}

	async readiness(): Promise<string> {
		this.events.push("readiness");
		return this.readinessRaw;
	}

	async prepare(_directory: string, assets: KernelBenchCompiledRemoteAssets): Promise<void> {
		this.events.push("prepare");
		this.assets = assets;
	}

	async ensureSubmitted(): Promise<{ slurmJobId: string }> {
		this.events.push("ensure");
		if (!this.dispatched) {
			this.dispatched = true;
			this.actualDispatches++;
		}
		return { slurmJobId: SLURM_JOB_ID };
	}

	async poll(): Promise<KernelBenchCompiledRemotePoll> {
		this.events.push("poll");
		assert.ok(this.assets);
		const request = JSON.parse(this.assets.requestJson) as { jobId: string };
		return {
			kind: "result",
			rawResult: JSON.stringify(
				successfulResult(this.evaluatorSha256, sha256Text(this.assets.requestJson), request.jobId),
			),
			log: "compiled qualification complete",
		};
	}

	async cancelAndVerify(): Promise<string> {
		this.events.push("cancel");
		return "CANCELLED|fixture";
	}
}

describe("compiled KernelBench qualification lane", () => {
	it("pins the exact environment and candidate bytes without touching the identity epoch", async () => {
		const [environment, positive, wrong, evaluator] = await Promise.all([
			readFile(ENVIRONMENT_PATH, "utf8"),
			readFile(POSITIVE_PATH, "utf8"),
			readFile(WRONG_PATH, "utf8"),
			readFile(EVALUATOR_PATH, "utf8"),
		]);
		assert.equal(sha256Text(environment), KERNELBENCH_COMPILED_ENVIRONMENT_SHA256);
		assert.equal(sha256Text(positive), KERNELBENCH_COMPILED_POSITIVE_SHA256);
		assert.equal(sha256Text(wrong), KERNELBENCH_COMPILED_WRONG_SHA256);
		assert.ok(evaluator.includes(`VERIFIER_EPOCH_PREFIX = "${KERNELBENCH_COMPILED_QUALIFICATION_EPOCH_PREFIX}"`));
		assert.ok(evaluator.includes(`POSITIVE_CANDIDATE_SHA256 = "${KERNELBENCH_COMPILED_POSITIVE_SHA256}"`));
		assert.ok(evaluator.includes(`WRONG_CANDIDATE_SHA256 = "${KERNELBENCH_COMPILED_WRONG_SHA256}"`));
		assert.match(environment, /numpy=2\.5\.2/);
		assert.match(environment, /numpy-wheel-sha256=3cdec01f/);
	});

	it("binds the new epoch to evaluator, environment, task, hidden fixture, and both candidates", async () => {
		const evaluatorDigest = sha256Text(await readFile(EVALUATOR_PATH, "utf8"));
		const contract = fixtureContract(evaluatorDigest);
		const changedEvaluator = fixtureContract("9".repeat(64));
		const changedRuntimeEvidence = fixtureContract(evaluatorDigest, "changed-freeze");
		assert.notEqual(contract.verifierEpoch, changedEvaluator.verifierEpoch);
		assert.notEqual(contract.verifierEpoch, changedRuntimeEvidence.verifierEpoch);
		assert.equal(contract.verifierManifest.taskSha256, KERNELBENCH_COMPILED_TASK_SHA256);
		assert.equal(contract.verifierManifest.hiddenTestSha256, KERNELBENCH_COMPILED_HIDDEN_SHA256);
		assert.equal(contract.verifierManifest.positiveCandidateSha256, KERNELBENCH_COMPILED_POSITIVE_SHA256);
		assert.equal(contract.verifierManifest.wrongCandidateSha256, KERNELBENCH_COMPILED_WRONG_SHA256);
		assert.throws(
			() =>
				parseKernelBenchCompiledQualificationReadiness(
					readinessResult("8".repeat(64)),
					evaluatorDigest,
					"8".repeat(64),
				),
			/exact allowlisted lock/,
		);
	});

	it("accepts only four complete correctness outcomes and keeps cold compile outside warm timing", async () => {
		const evaluatorDigest = sha256Text(await readFile(EVALUATOR_PATH, "utf8"));
		const requestSha256 = "8".repeat(64);
		const raw = JSON.stringify(successfulResult(evaluatorDigest, requestSha256));
		const parsed = parseKernelBenchCompiledQualificationResult(raw, {
			contract: fixtureContract(evaluatorDigest),
			requestSha256,
			jobId: CONTROLLER_JOB_ID,
			slurmJobId: SLURM_JOB_ID,
		});
		assert.equal(parsed.ok, true);
		assert.equal(parsed.outcome.tasks.length, 1);
		assert.equal(parsed.outcome.tasks[0].status, "accepted");
		const rawResult = JSON.parse(parsed.outcome.stdout ?? "{}") as ReturnType<typeof successfulResult>;
		const warmSampleTotal = rawResult.tasks[0].hiddenConfigs.reduce(
			(sum, config) =>
				sum +
				config.referenceSamplesMs.reduce((subtotal, value) => subtotal + value, 0) +
				config.positiveSamplesMs.reduce((subtotal, value) => subtotal + value, 0),
			0,
		);
		assert.ok(Math.abs(parsed.outcome.tasks[0].runtimeMs - warmSampleTotal) < 1e-9);
		assert.ok(rawResult.tasks[0].metrics.coldCompileMs > parsed.outcome.tasks[0].runtimeMs);
	});

	it("fails closed on missing trials, positive failure, wrong-candidate acceptance, or manifest drift", async () => {
		const evaluatorDigest = sha256Text(await readFile(EVALUATOR_PATH, "utf8"));
		const requestSha256 = "8".repeat(64);
		const expectation = {
			contract: fixtureContract(evaluatorDigest),
			requestSha256,
			jobId: CONTROLLER_JOB_ID,
			slurmJobId: SLURM_JOB_ID,
		};
		const missingTrial = successfulResult(evaluatorDigest, requestSha256);
		missingTrial.tasks[0].hiddenConfigs[0].positiveSamplesMs.pop();
		assert.throws(
			() => parseKernelBenchCompiledQualificationResult(JSON.stringify(missingTrial), expectation),
			/Expected ten samples/,
		);
		const positiveFailure = successfulResult(evaluatorDigest, requestSha256);
		positiveFailure.tasks[0].hiddenConfigs[2].positivePassed = false;
		assert.throws(
			() => parseKernelBenchCompiledQualificationResult(JSON.stringify(positiveFailure), expectation),
			/positive candidate failed/,
		);
		const wrongAccepted = successfulResult(evaluatorDigest, requestSha256);
		wrongAccepted.tasks[0].hiddenConfigs[3].wrongCandidateRejected = false;
		assert.throws(
			() => parseKernelBenchCompiledQualificationResult(JSON.stringify(wrongAccepted), expectation),
			/wrong candidate was not rejected/,
		);
		const drifted = successfulResult(evaluatorDigest, requestSha256);
		drifted.verifierManifest.positiveCandidateSha256 = "9".repeat(64);
		assert.throws(
			() => parseKernelBenchCompiledQualificationResult(JSON.stringify(drifted), expectation),
			/controller-bound verifier contract/,
		);
	});

	it("records an isolated handle before one idempotent dispatch with both exact candidates", async () => {
		const [evaluator, positive, wrong] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(POSITIVE_PATH, "utf8"),
			readFile(WRONG_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluator);
		const contract = fixtureContract(evaluatorDigest);
		const transport = new FauxTransport(evaluatorDigest, readinessResult(KERNELBENCH_COMPILED_ENVIRONMENT_SHA256));
		const adapter = new KernelBenchCompiledQualificationAdapter(
			{ ...DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG, pollIntervalMs: 1, requestTimeoutMs: 100 },
			transport,
		);
		let handle = "";
		const context: EvaluationContext = {
			signal: new AbortController().signal,
			recordExternalJobId: async (value) => {
				transport.events.push("record");
				handle = value;
			},
		};
		const job = evaluationJob(contract, positive);
		const outcome = await adapter.evaluate(job, context);
		assert.deepEqual(transport.events, ["readiness", "record", "prepare", "ensure", "poll"]);
		assert.equal(transport.actualDispatches, 1);
		assert.equal(outcome.tasks[0].status, "accepted");
		assert.ok(transport.assets);
		const request = JSON.parse(transport.assets.requestJson) as {
			taskId: string;
			positiveCandidateSource: string;
			wrongCandidateSource: string;
			expectedVerifierEpoch: string;
		};
		assert.equal(request.taskId, "level2/2");
		assert.equal(request.positiveCandidateSource, positive);
		assert.equal(request.wrongCandidateSource, wrong);
		assert.equal(request.expectedVerifierEpoch, contract.verifierEpoch);
		assert.equal(
			parseKernelBenchCompiledQualificationHandle(
				handle,
				DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG.remoteRoot,
			),
			`${DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG.remoteRoot}/jobs/${CONTROLLER_JOB_ID}`,
		);
		const resumed = await adapter.resume(job, handle, context);
		assert.equal(resumed.tasks[0].status, "accepted");
		assert.equal(transport.actualDispatches, 1);
		const weakenedJob = evaluationJob(contract, positive.trim());
		await assert.rejects(adapter.evaluate(weakenedJob, context), /byte-exact positive candidate/);
	});

	it("renders one isolated L40S job and parses all new scripts without launching work", async () => {
		const script = buildKernelBenchCompiledQualificationJobScript(
			DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG,
			`${DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG.remoteRoot}/jobs/${CONTROLLER_JOB_ID}`,
			`${DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG.remoteRoot}/repos/${KERNELBENCH_VERIFIED_COMMIT}`,
			`${DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG.remoteRoot}/envs/${KERNELBENCH_COMPILED_ENVIRONMENT_SHA256}/bin/python`,
		);
		for (const expected of [
			"#SBATCH --constraint=GPU_SKU:L40S",
			"#SBATCH --gres=gpu:1",
			"#SBATCH --export=NONE",
			"TORCHINDUCTOR_CACHE_DIR=",
			"env -i",
		]) {
			assert.ok(script.includes(expected), `missing job contract: ${expected}`);
		}
		assert.doesNotMatch(script, /API_KEY|TOKEN|credential/i);
		const [evaluatorParse, readinessParse, bootstrapSyntax] = await Promise.all([
			runCommand("python3", [
				"-c",
				"import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))",
				EVALUATOR_PATH,
			]),
			runCommand("python3", [
				"-c",
				"import ast, sys; ast.parse(sys.argv[1])",
				KERNELBENCH_COMPILED_READINESS_REMOTE,
			]),
			runCommand("bash", ["-n", BOOTSTRAP_PATH]),
		]);
		assert.equal(evaluatorParse.exitCode, 0, evaluatorParse.stderr);
		assert.equal(readinessParse.exitCode, 0, readinessParse.stderr);
		assert.equal(bootstrapSyntax.exitCode, 0, bootstrapSyntax.stderr);
	});

	it("bootstraps only the exact compiled NumPy environment before readiness", async () => {
		const [evaluator, environment] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const transport = new FauxTransport(
			sha256Text(evaluator),
			readinessResult(KERNELBENCH_COMPILED_ENVIRONMENT_SHA256),
		);
		const adapter = new KernelBenchCompiledQualificationAdapter(
			DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG,
			transport,
		);
		const contract = await adapter.bootstrap(new AbortController().signal);
		assert.deepEqual(transport.events, ["bootstrap", "readiness"]);
		assert.ok(transport.bootstrapAssets);
		assert.equal(transport.bootstrapAssets.environmentSpec, environment);
		assert.match(transport.bootstrapAssets.bootstrapScript, /numpy-wheel-sha256/);
		assert.doesNotMatch(transport.bootstrapAssets.bootstrapScript, /\bsbatch\b/);
		assert.equal(contract.verifierManifest.environmentSpecSha256, KERNELBENCH_COMPILED_ENVIRONMENT_SHA256);
	});

	it("exposes a dry-run package lane without contacting FarmShare", async () => {
		const result = await runCommand(process.execPath, [
			fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url)),
			fileURLToPath(new URL("../src/kernelbench-compiled-qualification.ts", import.meta.url)),
			"--output-dir",
			resolve(process.cwd(), "runs/compiled-dry-run"),
		]);
		assert.equal(result.exitCode, 0, result.stderr);
		const contract = JSON.parse(result.stdout) as Record<string, unknown>;
		assert.equal(contract.status, "dry-run; pass --bootstrap to prepare or --submit to require existing readiness");
		assert.equal(contract.environmentSpecSha256, KERNELBENCH_COMPILED_ENVIRONMENT_SHA256);
		assert.equal(
			contract.acceptanceGate,
			"positive passes all four configs and wrong candidate fails all four configs",
		);
	});
});

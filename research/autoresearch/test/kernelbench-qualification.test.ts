import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../src/canonical-json.js";
import { ResearchController } from "../src/controller.js";
import {
	buildKernelBenchQualificationJobScript,
	DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
	formatFarmShareCommandFailure,
	KERNELBENCH_BOOTSTRAP_REMOTE,
	KERNELBENCH_CANCEL_REMOTE,
	KERNELBENCH_ENSURE_SUBMITTED_REMOTE,
	KERNELBENCH_QUALIFICATION_CANDIDATE,
	KERNELBENCH_QUALIFICATION_TASKS,
	KERNELBENCH_READINESS_REMOTE,
	KERNELBENCH_VERIFIED_COMMIT,
	KERNELBENCH_WRONG_OUTPUT_CANDIDATE,
	type KernelBenchBootstrapAssets,
	KernelBenchQualificationAdapter,
	type KernelBenchQualificationContract,
	type KernelBenchQualificationTransport,
	type KernelBenchRemoteAssets,
	type KernelBenchRemotePoll,
	KernelBenchTransientTransportError,
	kernelBenchQualificationBoundaryConditions,
	parseKernelBenchQualificationHandle,
	parseKernelBenchQualificationReadiness,
	parseKernelBenchQualificationResult,
} from "../src/kernelbench-qualification-adapter.js";
import type { EvaluationAdapter, EvaluationContext, EvaluationJob } from "../src/types.js";

const EVALUATOR_PATH = fileURLToPath(new URL("../evaluators/kernelbench_qualify.py", import.meta.url));
const ENVIRONMENT_PATH = fileURLToPath(new URL("../farmshare/kernelbench-environment.lock", import.meta.url));
const BOOTSTRAP_PATH = fileURLToPath(new URL("../farmshare/bootstrap-kernelbench.sh", import.meta.url));
const CONTROLLER_JOB_ID = `job_${"c".repeat(24)}`;
const REQUEST_SHA256 = "8".repeat(64);
const SLURM_JOB_ID = "12345";

interface CommandResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

function runCommand(
	command: string,
	args: readonly string[],
	environment = process.env,
	input?: string,
): Promise<CommandResult> {
	return new Promise((resolve) => {
		const child = execFile(command, args, { encoding: "utf8", env: environment }, (error, stdout, stderr) => {
			resolve({
				exitCode: error && typeof error.code === "number" ? error.code : error ? null : 0,
				stdout,
				stderr,
			});
		});
		child.stdin?.end(input);
	});
}

function hiddenConfig(index: number) {
	const referenceSamplesMs = Array.from({ length: 10 }, (_, sample) => 1 + index / 10 + sample / 100);
	const candidateSamplesMs = Array.from({ length: 10 }, (_, sample) => 1.1 + index / 10 + sample / 100);
	const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
	return {
		index,
		candidatePassed: true,
		wrongOutputRejected: true,
		referenceSamplesMs,
		candidateSamplesMs,
		referencePeakMemoryBytes: 1_000_000,
		candidatePeakMemoryBytes: 1_000_000,
		referencePeakDeltaBytes: 10_000,
		candidatePeakDeltaBytes: 10_000,
		speedup: mean(referenceSamplesMs) / mean(candidateSamplesMs),
	};
}

function readinessResult(environmentSpecSha256: string, revision = "base"): string {
	const environmentManifest = `${JSON.stringify({
		schemaVersion: 1,
		environmentSpecSha256,
		kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
		pip: "25.2",
		python: "3.12.3",
		torch: "2.11.0+cu128",
		torchCuda: "12.8",
	})}\n`;
	const pipFreeze = `pip==25.2\ntorch==2.11.0+cu128\ntriton==3.7.0\nfixture-revision==${revision}\n`;
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
		taskInputs: {
			"level1/1": {
				taskSha256: "2d349d77a97fd1a6f29365553275729685ab1cfff57ca4458bb6a8c09b88e91d",
				hiddenTestSha256: "9377caa50e3653ea38e6d35c3189a4cbdad1753d0c8dd17eb8ae2f70eba74f85",
			},
			"level2/2": {
				taskSha256: "31f49a84239cb24383e84ea78c778d9fc047455a12df3e2eb269ce6deedaf808",
				hiddenTestSha256: "5a951a50e3d2e23f3a977005e6508ae3f37974e1bf08b2fdb0f004619f46e6f0",
			},
			"level3/1": {
				taskSha256: "d78f9c39c087a74f2e924bcd8a0bb73972763094f2de096bec1337ab8836553a",
				hiddenTestSha256: "5652c2d43ca0d146fbef0e1c7d14220dc01c4077ceb413e885691f104c452f04",
			},
		},
		runtime: {
			python: "3.12.3",
			pip: "25.2",
			torch: "2.11.0+cu128",
			torchCuda: "12.8",
			hasTorchCompile: true,
			hasInductor: true,
			hasTriton: true,
		},
	});
}

function fixtureContract(
	evaluatorSha256: string,
	environmentSpecSha256: string,
	revision = "base",
): KernelBenchQualificationContract {
	return parseKernelBenchQualificationReadiness(
		readinessResult(environmentSpecSha256, revision),
		evaluatorSha256,
		environmentSpecSha256,
	);
}

function qualificationExpectation(evaluatorSha256: string, environmentSpecSha256: string) {
	return {
		contract: fixtureContract(evaluatorSha256, environmentSpecSha256),
		requestSha256: REQUEST_SHA256,
		jobId: CONTROLLER_JOB_ID,
		slurmJobId: SLURM_JOB_ID,
	};
}

function successfulResult(
	evaluatorSha256: string,
	environmentSpecSha256: string,
	binding: { jobId: string; requestSha256: string; slurmJobId: string } = {
		jobId: CONTROLLER_JOB_ID,
		requestSha256: REQUEST_SHA256,
		slurmJobId: SLURM_JOB_ID,
	},
	revision = "base",
) {
	const contract = fixtureContract(evaluatorSha256, environmentSpecSha256, revision);
	const paths: Record<(typeof KERNELBENCH_QUALIFICATION_TASKS)[number], { task: string; hidden: string }> = {
		"level1/1": {
			task: "KernelBench/level1/1_Square_matrix_multiplication_.py",
			hidden: "hidden_tests/level1/1_hidden.py",
		},
		"level2/2": {
			task: "KernelBench/level2/2_ConvTranspose2d_BiasAdd_Clamp_Scaling_Clamp_Divide.py",
			hidden: "hidden_tests/level2/2_hidden.py",
		},
		"level3/1": { task: "KernelBench/level3/1_MLP.py", hidden: "hidden_tests/level3/1_hidden.py" },
	};
	const precision = {
		dtype: "float32",
		matmulPrecision: "high",
		matmulAllowTf32: true,
		cudnnAllowTf32: true,
		atol: 1e-3,
		rtol: 1e-3,
	};
	const timing = { warmups: 3, trials: 10, unit: "milliseconds" };
	const {
		environmentManifest,
		pipFreeze,
		environmentSeal,
		environmentManifestSha256,
		pipFreezeSha256,
		environmentSealSha256,
	} = contract.environmentEvidence;
	const compileCanarySpec = {
		backend: "inductor",
		fullgraph: true,
		dynamic: false,
		device: "cuda",
		dtype: "float32",
		shape: [256],
	};
	const taskInputs: Record<
		(typeof KERNELBENCH_QUALIFICATION_TASKS)[number],
		{ taskSha256: string; hiddenTestSha256: string }
	> = {
		"level1/1": {
			taskSha256: "2d349d77a97fd1a6f29365553275729685ab1cfff57ca4458bb6a8c09b88e91d",
			hiddenTestSha256: "9377caa50e3653ea38e6d35c3189a4cbdad1753d0c8dd17eb8ae2f70eba74f85",
		},
		"level2/2": {
			taskSha256: "31f49a84239cb24383e84ea78c778d9fc047455a12df3e2eb269ce6deedaf808",
			hiddenTestSha256: "5a951a50e3d2e23f3a977005e6508ae3f37974e1bf08b2fdb0f004619f46e6f0",
		},
		"level3/1": {
			taskSha256: "d78f9c39c087a74f2e924bcd8a0bb73972763094f2de096bec1337ab8836553a",
			hiddenTestSha256: "5652c2d43ca0d146fbef0e1c7d14220dc01c4077ceb413e885691f104c452f04",
		},
	};
	const verifierManifest = contract.verifierManifest;
	return {
		schemaVersion: 1,
		ok: true,
		verifierEpoch: contract.verifierEpoch,
		verifierManifest,
		jobId: binding.jobId,
		requestSha256: binding.requestSha256,
		startedAt: "2026-08-27T00:00:00.000Z",
		finishedAt: "2026-08-27T00:01:00.000Z",
		checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
		candidateSha256: sha256Text(KERNELBENCH_QUALIFICATION_CANDIDATE),
		negativeControlSha256: sha256Text(KERNELBENCH_WRONG_OUTPUT_CANDIDATE),
		evaluatorSha256,
		environmentSpecSha256,
		environmentManifestSha256,
		pipFreezeSha256,
		environmentSealSha256,
		environmentManifest,
		pipFreeze,
		environmentSeal,
		precision,
		timing,
		compileCanary: {
			...compileCanarySpec,
			passed: true,
			maxAbsError: 0.000_01,
			error: null as string | null,
		},
		hardware: {
			cluster: "Stanford FarmShare",
			hostname: "oat-01",
			gpuName: "NVIDIA L40S",
			gpuComputeCapability: "8.9",
			gpuTotalMemoryBytes: 48_000_000_000,
			torchVersion: "2.11.0+cu128",
			torchCudaVersion: "12.8",
			slurmJobId: binding.slurmJobId,
			cudaVisibleDevices: "0",
		},
		fatalKind: null as string | null,
		fatalError: null as string | null,
		tasks: KERNELBENCH_QUALIFICATION_TASKS.map((benchmarkId) => {
			const hiddenConfigs = [1, 2, 3, 4].map(hiddenConfig);
			const referenceSamples = hiddenConfigs.flatMap((config) => config.referenceSamplesMs);
			const candidateSamples = hiddenConfigs.flatMap((config) => config.candidateSamplesMs);
			const mean = (values: readonly number[]): number =>
				values.reduce((sum, value) => sum + value, 0) / values.length;
			const speedups = hiddenConfigs.map((config) => config.speedup);
			return {
				benchmarkId,
				status: "accepted",
				failureKind: null,
				errors: [],
				startedAt: "2026-08-27T00:00:00.000Z",
				finishedAt: "2026-08-27T00:01:00.000Z",
				taskPath: paths[benchmarkId].task,
				hiddenTestPath: paths[benchmarkId].hidden,
				taskSha256: taskInputs[benchmarkId].taskSha256,
				hiddenTestSha256: taskInputs[benchmarkId].hiddenTestSha256,
				hiddenConfigs,
				metrics: {
					qualified: 1,
					hiddenConfigsPassed: 4,
					wrongOutputsRejected: 4,
					referenceMeanMs: mean(referenceSamples),
					candidateMeanMs: mean(candidateSamples),
					speedupGeomean: Math.exp(speedups.reduce((sum, value) => sum + Math.log(value), 0) / speedups.length),
					fastAtOne: speedups.every((speedup) => speedup > 1) ? 1 : 0,
					referencePeakMemoryBytes: 1_000_000,
					candidatePeakMemoryBytes: 1_000_000,
				},
			};
		}),
	};
}

function evaluationJob(contract: KernelBenchQualificationContract): EvaluationJob {
	return {
		jobId: CONTROLLER_JOB_ID,
		manifestDigest: "d".repeat(64),
		branchId: "qualification",
		lane: "kernelbench",
		benchmarkIds: [...KERNELBENCH_QUALIFICATION_TASKS],
		budgetClass: "smoke",
		treatment: "qualification",
		proposal: {
			hypothesis: "identity passes",
			mechanism: "trusted verifier qualification",
			predictedOutcome: "all checks pass",
			boundaryConditions: [...kernelBenchQualificationBoundaryConditions(contract)],
			parentJobIds: [],
		},
		candidate: {
			digest: sha256Text(KERNELBENCH_QUALIFICATION_CANDIDATE),
			byteLength: Buffer.byteLength(KERNELBENCH_QUALIFICATION_CANDIDATE),
			mediaType: "text/x-python",
		},
		candidateFormat: "python-source",
		candidateContent: KERNELBENCH_QUALIFICATION_CANDIDATE,
	};
}

class FauxTransport implements KernelBenchQualificationTransport {
	events: string[] = [];
	preparedDirectories: string[] = [];
	ensureCalls = 0;
	actualDispatches = 0;
	assets: KernelBenchRemoteAssets | null = null;
	bootstrapAssets: KernelBenchBootstrapAssets | null = null;
	bootstrapCalls = 0;
	cancelCalls = 0;
	private readonly dispatched = new Set<string>();

	constructor(
		private readonly rawResult: string,
		private readinessRaw: string,
	) {}

	setReadiness(raw: string): void {
		this.readinessRaw = raw;
	}

	async bootstrap(_remoteRoot: string, assets: KernelBenchBootstrapAssets): Promise<void> {
		this.events.push("bootstrap");
		this.bootstrapCalls++;
		this.bootstrapAssets = assets;
	}

	async readiness(): Promise<string> {
		this.events.push("readiness");
		return this.readinessRaw;
	}

	async prepare(remoteJobDir: string, assets: KernelBenchRemoteAssets): Promise<void> {
		this.events.push("prepare");
		this.preparedDirectories.push(remoteJobDir);
		this.assets = assets;
	}

	async ensureSubmitted(remoteJobDir: string): Promise<{ slurmJobId: string }> {
		this.events.push("ensure");
		this.ensureCalls++;
		if (!this.dispatched.has(remoteJobDir)) {
			this.dispatched.add(remoteJobDir);
			this.actualDispatches++;
		}
		return { slurmJobId: "12345" };
	}

	async poll(): Promise<KernelBenchRemotePoll> {
		this.events.push("poll");
		return { kind: "result", rawResult: this.rawResult, log: "qualification complete" };
	}

	async cancelAndVerify(): Promise<string> {
		this.events.push("cancel");
		this.cancelCalls++;
		return "CANCELLED|fixture";
	}
}

class PendingFauxTransport extends FauxTransport {
	override async poll(): Promise<KernelBenchRemotePoll> {
		this.events.push("poll");
		return { kind: "pending", schedulerState: "PENDING" };
	}
}

class TransientEnsureAndPollFauxTransport extends FauxTransport {
	ensureAttempts = 0;
	pollAttempts = 0;

	override async ensureSubmitted(remoteJobDir: string): Promise<{ slurmJobId: string }> {
		this.ensureAttempts++;
		if (this.ensureAttempts === 1) {
			throw new KernelBenchTransientTransportError("temporary scheduler discovery failure");
		}
		return super.ensureSubmitted(remoteJobDir);
	}

	override async poll(): Promise<KernelBenchRemotePoll> {
		this.pollAttempts++;
		if (this.pollAttempts === 1) {
			throw new KernelBenchTransientTransportError("temporary scheduler poll failure");
		}
		return super.poll();
	}
}

class BlockingPollFauxTransport extends FauxTransport {
	private pollStartedResolver: (() => void) | null = null;
	readonly pollStarted = new Promise<void>((resolve) => {
		this.pollStartedResolver = resolve;
	});

	override async poll(): Promise<KernelBenchRemotePoll> {
		this.events.push("poll");
		this.pollStartedResolver?.();
		this.pollStartedResolver = null;
		return new Promise<KernelBenchRemotePoll>(() => undefined);
	}
}

class DynamicResultFauxTransport extends FauxTransport {
	constructor(
		private readonly evaluatorSha256: string,
		private readonly environmentSpecSha256: string,
		readinessRaw: string,
		private readonly revision: string,
		private readonly existingDispatch: boolean,
	) {
		super("", readinessRaw);
	}

	override async ensureSubmitted(): Promise<{ slurmJobId: string }> {
		this.events.push("ensure");
		this.ensureCalls++;
		if (!this.existingDispatch) this.actualDispatches++;
		return { slurmJobId: SLURM_JOB_ID };
	}

	override async poll(): Promise<KernelBenchRemotePoll> {
		this.events.push("poll");
		assert.ok(this.assets);
		const request = JSON.parse(this.assets.requestJson) as { jobId: string };
		return {
			kind: "result",
			rawResult: JSON.stringify(
				successfulResult(
					this.evaluatorSha256,
					this.environmentSpecSha256,
					{
						jobId: request.jobId,
						requestSha256: sha256Text(this.assets.requestJson),
						slurmJobId: SLURM_JOB_ID,
					},
					this.revision,
				),
			),
			log: "qualification complete",
		};
	}
}

class TrackingKernelBenchQualificationAdapter extends KernelBenchQualificationAdapter {
	evaluateCalls = 0;
	resumeCalls = 0;

	override async evaluate(job: EvaluationJob, context: EvaluationContext) {
		this.evaluateCalls++;
		return super.evaluate(job, context);
	}

	override async resume(job: EvaluationJob, externalJobId: string, context: EvaluationContext) {
		this.resumeCalls++;
		return super.resume(job, externalJobId, context);
	}
}

class ImmediateKernelBenchAdapter implements EvaluationAdapter {
	readonly lane = "kernelbench" as const;

	async evaluate(job: EvaluationJob) {
		return {
			verifierEpoch: job.proposal.boundaryConditions[3] ?? "missing-epoch",
			tasks: job.benchmarkIds.map((benchmarkId) => ({
				benchmarkId,
				status: "accepted" as const,
				metrics: { qualified: 1 },
				verifier: { passed: true, checks: [], errors: [] },
				runtimeMs: 0,
			})),
			hardware: {},
			provenance: { adapter: "immediate-test" },
		};
	}
}

describe("KernelBench-Verified qualification lane", () => {
	it("strictly parses all hidden checks and preserves raw timing samples", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const raw = JSON.stringify(successfulResult(evaluatorDigest, environmentDigest));
		const parsed = parseKernelBenchQualificationResult(
			raw,
			qualificationExpectation(evaluatorDigest, environmentDigest),
		);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.outcome.tasks.length, 3);
		assert.ok(parsed.outcome.tasks.every((task) => task.status === "accepted"));
		assert.equal(parsed.outcome.stdout, raw);
		assert.equal(parsed.outcome.provenance.rawTimingSamples, "preserved-in-stdout-artifact");
		assert.equal(
			(JSON.parse(parsed.outcome.stdout ?? "{}") as { pipFreeze?: string }).pipFreeze,
			fixtureContract(evaluatorDigest, environmentDigest).environmentEvidence.pipFreeze,
		);
	});

	it("rejects missing raw samples, a weak negative control, and silent task omission", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const missingSamples = successfulResult(evaluatorDigest, environmentDigest);
		missingSamples.tasks[0].hiddenConfigs[0].referenceSamplesMs.pop();
		assert.throws(
			() =>
				parseKernelBenchQualificationResult(
					JSON.stringify(missingSamples),
					qualificationExpectation(evaluatorDigest, environmentDigest),
				),
			/Expected ten samples/,
		);

		const weakNegative = successfulResult(evaluatorDigest, environmentDigest);
		weakNegative.tasks[1].hiddenConfigs[2].wrongOutputRejected = false;
		assert.throws(
			() =>
				parseKernelBenchQualificationResult(
					JSON.stringify(weakNegative),
					qualificationExpectation(evaluatorDigest, environmentDigest),
				),
			/Wrong-output control was not rejected/,
		);

		const omitted = successfulResult(evaluatorDigest, environmentDigest);
		omitted.ok = false;
		omitted.fatalKind = "reference";
		omitted.fatalError = "reference failed";
		omitted.tasks.splice(1);
		assert.throws(
			() =>
				parseKernelBenchQualificationResult(
					JSON.stringify(omitted),
					qualificationExpectation(evaluatorDigest, environmentDigest),
				),
			/must contain all three tasks/,
		);
	});

	it("treats a reference failure as fatal and requires explicit outcomes for remaining tasks", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const failed = JSON.parse(JSON.stringify(successfulResult(evaluatorDigest, environmentDigest))) as {
			ok: boolean;
			fatalKind: string | null;
			fatalError: string | null;
			tasks: Array<Record<string, unknown>>;
		};
		failed.ok = false;
		failed.fatalKind = "reference";
		failed.fatalError = "reference failed on level1/1";
		failed.tasks = failed.tasks.map((task, index) => ({
			...task,
			status: "failed",
			failureKind: index === 0 ? "reference" : "not-run-after-fatal",
			errors: [index === 0 ? "reference failed on level1/1" : "not run after fatal reference failure"],
			hiddenConfigs: [],
			metrics: {},
		}));
		const parsed = parseKernelBenchQualificationResult(
			JSON.stringify(failed),
			qualificationExpectation(evaluatorDigest, environmentDigest),
		);
		assert.equal(parsed.ok, false);
		assert.deepEqual(
			parsed.outcome.tasks.map((task) => task.status),
			["failed", "failed", "failed"],
		);
		assert.match(parsed.outcome.tasks[0].verifier.errors[0], /reference failed/);
	});

	it("binds the epoch to evaluator, environment, and exact task inputs", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const drifted = successfulResult(evaluatorDigest, environmentDigest);
		const driftedManifest = drifted.verifierManifest as {
			taskInputs: Record<string, { taskSha256: string; hiddenTestSha256: string }>;
		};
		driftedManifest.taskInputs["level1/1"].taskSha256 = "9".repeat(64);
		drifted.tasks[0].taskSha256 = "9".repeat(64);
		assert.throws(
			() =>
				parseKernelBenchQualificationResult(
					JSON.stringify(drifted),
					qualificationExpectation(evaluatorDigest, environmentDigest),
				),
			/epoch does not bind the verifier manifest/,
		);
	});

	it("rejects inconsistent aggregates, result bindings, and ok envelopes", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const expectation = qualificationExpectation(evaluatorDigest, environmentDigest);

		const inconsistent = successfulResult(evaluatorDigest, environmentDigest);
		inconsistent.tasks[0].metrics.referenceMeanMs += 1;
		assert.throws(
			() => parseKernelBenchQualificationResult(JSON.stringify(inconsistent), expectation),
			/Inconsistent aggregate/,
		);

		const wrongDispatch = successfulResult(evaluatorDigest, environmentDigest);
		wrongDispatch.hardware.slurmJobId = "99999";
		assert.throws(
			() => parseKernelBenchQualificationResult(JSON.stringify(wrongDispatch), expectation),
			/SLURM job ID does not match/,
		);

		const wrongRequest = successfulResult(evaluatorDigest, environmentDigest);
		wrongRequest.requestSha256 = "9".repeat(64);
		assert.throws(
			() => parseKernelBenchQualificationResult(JSON.stringify(wrongRequest), expectation),
			/request digest mismatch/,
		);

		const falseSuccess = successfulResult(evaluatorDigest, environmentDigest);
		falseSuccess.ok = false;
		falseSuccess.fatalKind = "reference";
		falseSuccess.fatalError = "claimed reference failure";
		assert.throws(
			() => parseKernelBenchQualificationResult(JSON.stringify(falseSuccess), expectation),
			/ok flag does not match/,
		);
	});

	it("runs the trusted wrong-output ModelNew through the candidate call and comparison path", async () => {
		const evaluatorSource = await readFile(EVALUATOR_PATH, "utf8");
		assert.ok(evaluatorSource.includes(`WRONG_OUTPUT_CANDIDATE = """${KERNELBENCH_WRONG_OUTPUT_CANDIDATE}"""`));
		assert.match(evaluatorSource, /wrong_candidate = wrong_candidate_class/);
		assert.match(evaluatorSource, /wrong_output = call_candidate\(wrong_candidate,/);
		assert.match(evaluatorSource, /torch\.allclose\(expected, wrong_output,/);
		assert.doesNotMatch(evaluatorSource, /torch\.full_like\(expected/);
	});

	it("records a stable handle before idempotent dispatch and reconciles resume", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const contract = fixtureContract(evaluatorDigest, environmentDigest);
		const requestJson = `${JSON.stringify({
			schemaVersion: 1,
			jobId: CONTROLLER_JOB_ID,
			taskIds: KERNELBENCH_QUALIFICATION_TASKS,
			candidateSource: KERNELBENCH_QUALIFICATION_CANDIDATE,
			checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
			environmentSpecSha256: environmentDigest,
			expectedVerifierEpoch: contract.verifierEpoch,
			verifierContractDigest: contract.contractDigest,
		})}\n`;
		const transport = new FauxTransport(
			JSON.stringify(
				successfulResult(evaluatorDigest, environmentDigest, {
					jobId: CONTROLLER_JOB_ID,
					requestSha256: sha256Text(requestJson),
					slurmJobId: SLURM_JOB_ID,
				}),
			),
			readinessResult(environmentDigest),
		);
		const config = { ...DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG, pollIntervalMs: 1, requestTimeoutMs: 100 };
		const adapter = new KernelBenchQualificationAdapter(config, transport);
		const abortController = new AbortController();
		let handle = "";
		const context: EvaluationContext = {
			signal: abortController.signal,
			recordExternalJobId: async (externalJobId) => {
				transport.events.push("record");
				handle = externalJobId;
			},
		};

		const job = evaluationJob(contract);
		const first = await adapter.evaluate(job, context);
		assert.deepEqual(transport.events.slice(0, 5), ["readiness", "record", "prepare", "ensure", "poll"]);
		assert.equal(
			first.tasks.every((task) => task.status === "accepted"),
			true,
		);
		const expectedDirectory = `${config.remoteRoot}/jobs/${job.jobId}`;
		assert.equal(parseKernelBenchQualificationHandle(handle, config.remoteRoot), expectedDirectory);
		assert.equal(transport.actualDispatches, 1);

		const resumed = await adapter.resume(job, handle, context);
		assert.equal(
			resumed.tasks.every((task) => task.status === "accepted"),
			true,
		);
		assert.equal(transport.ensureCalls, 2);
		assert.equal(transport.actualDispatches, 1);
		assert.deepEqual(transport.preparedDirectories, [expectedDirectory, expectedDirectory]);
		assert.ok(transport.assets);
		const request = JSON.parse(transport.assets.requestJson) as {
			taskIds: unknown;
			candidateSource: unknown;
			expectedVerifierEpoch: unknown;
		};
		assert.deepEqual(request.taskIds, KERNELBENCH_QUALIFICATION_TASKS);
		assert.equal(request.candidateSource, "ModelNew = Model");
		assert.equal(request.expectedVerifierEpoch, contract.verifierEpoch);
	});

	it("bootstraps separately and fails readiness before recording a handle", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const contract = fixtureContract(evaluatorDigest, environmentDigest);
		const validTransport = new FauxTransport(
			JSON.stringify(successfulResult(evaluatorDigest, environmentDigest)),
			readinessResult(environmentDigest),
		);
		const adapter = new KernelBenchQualificationAdapter(DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG, validTransport);
		const bootstrapped = await adapter.bootstrap(new AbortController().signal);
		assert.equal(bootstrapped.verifierEpoch, contract.verifierEpoch);
		assert.equal(validTransport.bootstrapCalls, 1);
		assert.ok(validTransport.bootstrapAssets);
		assert.equal(validTransport.bootstrapAssets.environmentSpec, environmentSpec);
		assert.doesNotMatch(validTransport.bootstrapAssets.bootstrapScript, /\bsbatch\b/);

		const notReadyTransport = new FauxTransport(
			JSON.stringify(successfulResult(evaluatorDigest, environmentDigest)),
			JSON.stringify({ schemaVersion: 1 }),
		);
		const notReadyAdapter = new KernelBenchQualificationAdapter(
			DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
			notReadyTransport,
		);
		let recorded = false;
		await assert.rejects(
			notReadyAdapter.evaluate(evaluationJob(contract), {
				signal: new AbortController().signal,
				recordExternalJobId: async () => {
					recorded = true;
				},
			}),
			/Keys mismatch at readiness/,
		);
		assert.equal(recorded, false);
		assert.equal(notReadyTransport.ensureCalls, 0);
		assert.equal(notReadyTransport.preparedDirectories.length, 0);
	});

	it("changes controller job and immutable remote handles across verifier revisions", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const firstContract = fixtureContract(evaluatorDigest, environmentDigest, "revision-a");
		const secondContract = fixtureContract(evaluatorDigest, environmentDigest, "revision-b");
		assert.notEqual(firstContract.verifierEpoch, secondContract.verifierEpoch);
		const temporaryRoot = await mkdtemp(join(tmpdir(), "prime-kbv-epoch-replay-"));
		try {
			const controller = await ResearchController.open({
				ledgerPath: join(temporaryRoot, "evidence.jsonl"),
				artifactDir: join(temporaryRoot, "artifacts"),
				adapters: [new ImmediateKernelBenchAdapter()],
				metrics: {
					"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
					kernelbench: { name: "qualified", direction: "maximize" },
					nanogpt: { name: "trainSteps", direction: "minimize" },
				},
				allowedBenchmarks: {
					"compiler-gym": [],
					kernelbench: KERNELBENCH_QUALIFICATION_TASKS,
					nanogpt: [],
				},
				allowedTreatments: ["qualification"],
				maxInflight: { kernelbench: 1 },
				maxSubmissionsPerBranch: 2,
				maxTaskEvaluationsPerBranch: 6,
			});
			const submit = (contract: KernelBenchQualificationContract) =>
				controller.submit({
					branchId: "epoch-replay",
					lane: "kernelbench",
					benchmarkIds: [...KERNELBENCH_QUALIFICATION_TASKS],
					budgetClass: "smoke",
					treatment: "qualification",
					proposal: {
						hypothesis: "identity passes",
						mechanism: "trusted verifier qualification",
						predictedOutcome: "all checks pass",
						boundaryConditions: [...kernelBenchQualificationBoundaryConditions(contract)],
						parentJobIds: [],
					},
					candidate: { format: "python-source", content: KERNELBENCH_QUALIFICATION_CANDIDATE },
				});
			const first = await submit(firstContract);
			await controller.waitForIdle();
			const second = await submit(secondContract);
			await controller.waitForIdle();
			assert.notEqual(first.manifestDigest, second.manifestDigest);
			assert.notEqual(first.jobId, second.jobId);
			const firstHandle = `kernelbench-qualification-v1:${DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG.remoteRoot}/jobs/${first.jobId}`;
			const secondHandle = `kernelbench-qualification-v1:${DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG.remoteRoot}/jobs/${second.jobId}`;
			assert.notEqual(firstHandle, secondHandle);
			assert.notEqual(
				parseKernelBenchQualificationHandle(firstHandle, DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG.remoteRoot),
				parseKernelBenchQualificationHandle(secondHandle, DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG.remoteRoot),
			);
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	it("reopens a pending controller job without duplicate dispatch and fails closed across epochs", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const temporaryRoot = await mkdtemp(join(tmpdir(), "prime-kbv-controller-reopen-"));
		const openController = (root: string, adapter: EvaluationAdapter) =>
			ResearchController.open({
				ledgerPath: join(root, "evidence.jsonl"),
				artifactDir: join(root, "artifacts"),
				adapters: [adapter],
				metrics: {
					"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
					kernelbench: { name: "qualified", direction: "maximize" },
					nanogpt: { name: "trainSteps", direction: "minimize" },
				},
				allowedBenchmarks: {
					"compiler-gym": [],
					kernelbench: KERNELBENCH_QUALIFICATION_TASKS,
					nanogpt: [],
				},
				allowedTreatments: ["qualification"],
				maxInflight: { kernelbench: 1 },
				maxSubmissionsPerBranch: 2,
				maxTaskEvaluationsPerBranch: 6,
			});
		const submit = (controller: ResearchController, contract: KernelBenchQualificationContract, branchId: string) =>
			controller.submit({
				branchId,
				lane: "kernelbench",
				benchmarkIds: [...KERNELBENCH_QUALIFICATION_TASKS],
				budgetClass: "smoke",
				treatment: "qualification",
				proposal: {
					hypothesis: "identity passes",
					mechanism: "trusted verifier qualification",
					predictedOutcome: "all checks pass",
					boundaryConditions: [...kernelBenchQualificationBoundaryConditions(contract)],
					parentJobIds: [],
				},
				candidate: { format: "python-source", content: KERNELBENCH_QUALIFICATION_CANDIDATE },
			});
		try {
			const sameRoot = join(temporaryRoot, "same-epoch");
			const sameContract = fixtureContract(evaluatorDigest, environmentDigest, "same-epoch");
			const firstSameTransport = new BlockingPollFauxTransport("", readinessResult(environmentDigest, "same-epoch"));
			const firstSameAdapter = new TrackingKernelBenchQualificationAdapter(
				DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
				firstSameTransport,
			);
			const firstSameController = await openController(sameRoot, firstSameAdapter);
			const sameSubmission = await submit(firstSameController, sameContract, "same-epoch");
			await firstSameTransport.pollStarted;
			const samePending = firstSameController.status([sameSubmission.jobId])[0];
			const sameHandle = `kernelbench-qualification-v1:${DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG.remoteRoot}/jobs/${sameSubmission.jobId}`;
			assert.equal(samePending.state.status, "running");
			assert.equal(samePending.state.externalJobId, sameHandle);
			assert.equal(firstSameAdapter.evaluateCalls, 1);
			assert.equal(firstSameTransport.actualDispatches, 1);

			const resumedSameTransport = new DynamicResultFauxTransport(
				evaluatorDigest,
				environmentDigest,
				readinessResult(environmentDigest, "same-epoch"),
				"same-epoch",
				true,
			);
			const resumedSameAdapter = new TrackingKernelBenchQualificationAdapter(
				DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
				resumedSameTransport,
			);
			const resumedSameController = await openController(sameRoot, resumedSameAdapter);
			await resumedSameController.waitForIdle();
			assert.equal(resumedSameAdapter.evaluateCalls, 0);
			assert.equal(resumedSameAdapter.resumeCalls, 1);
			assert.equal(resumedSameTransport.ensureCalls, 1);
			assert.equal(resumedSameTransport.actualDispatches, 0);
			assert.equal(resumedSameController.status([sameSubmission.jobId])[0].state.status, "succeeded");

			const changedRoot = join(temporaryRoot, "changed-epoch");
			const oldContract = fixtureContract(evaluatorDigest, environmentDigest, "old-epoch");
			const newContract = fixtureContract(evaluatorDigest, environmentDigest, "new-epoch");
			const oldTransport = new BlockingPollFauxTransport("", readinessResult(environmentDigest, "old-epoch"));
			const oldAdapter = new TrackingKernelBenchQualificationAdapter(
				DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
				oldTransport,
			);
			const oldController = await openController(changedRoot, oldAdapter);
			const oldSubmission = await submit(oldController, oldContract, "changed-epoch");
			await oldTransport.pollStarted;

			const changedTransport = new DynamicResultFauxTransport(
				evaluatorDigest,
				environmentDigest,
				readinessResult(environmentDigest, "new-epoch"),
				"new-epoch",
				false,
			);
			const changedAdapter = new TrackingKernelBenchQualificationAdapter(
				DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
				changedTransport,
			);
			const changedController = await openController(changedRoot, changedAdapter);
			await changedController.waitForIdle();
			assert.equal(changedAdapter.evaluateCalls, 0);
			assert.equal(changedAdapter.resumeCalls, 1);
			assert.equal(changedTransport.preparedDirectories.length, 0);
			assert.equal(changedTransport.ensureCalls, 0);
			assert.equal(changedController.status([oldSubmission.jobId])[0].state.status, "failed");

			const newSubmission = await submit(changedController, newContract, "changed-epoch");
			await changedController.waitForIdle();
			assert.notEqual(newSubmission.jobId, oldSubmission.jobId);
			assert.equal(changedAdapter.evaluateCalls, 1);
			assert.equal(changedTransport.actualDispatches, 1);
			assert.equal(changedController.status([newSubmission.jobId])[0].state.status, "succeeded");
			assert.notEqual(
				changedController.status([oldSubmission.jobId])[0].state.externalJobId,
				changedController.status([newSubmission.jobId])[0].state.externalJobId,
			);
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	it("cancels and verifies the durable SLURM job before a local timeout failure", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const contract = fixtureContract(evaluatorDigest, environmentDigest);
		const transport = new PendingFauxTransport(
			JSON.stringify(successfulResult(evaluatorDigest, environmentDigest)),
			readinessResult(environmentDigest),
		);
		const adapter = new KernelBenchQualificationAdapter(
			{
				...DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
				pollIntervalMs: 1,
				requestTimeoutMs: 2,
			},
			transport,
		);
		const outcome = await adapter.evaluate(evaluationJob(contract), {
			signal: new AbortController().signal,
			recordExternalJobId: async () => undefined,
		});
		assert.equal(transport.cancelCalls, 1);
		assert.equal(outcome.provenance.cancellationVerified, "true");
		assert.ok(outcome.tasks.every((task) => task.status === "failed"));
	});

	it("recovers transient scheduler discovery and poll failures with one dispatch", async () => {
		const [evaluatorSource, environmentSpec] = await Promise.all([
			readFile(EVALUATOR_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		const evaluatorDigest = sha256Text(evaluatorSource);
		const environmentDigest = sha256Text(environmentSpec);
		const contract = fixtureContract(evaluatorDigest, environmentDigest);
		const requestJson = `${JSON.stringify({
			schemaVersion: 1,
			jobId: CONTROLLER_JOB_ID,
			taskIds: KERNELBENCH_QUALIFICATION_TASKS,
			candidateSource: KERNELBENCH_QUALIFICATION_CANDIDATE,
			checkoutCommit: KERNELBENCH_VERIFIED_COMMIT,
			environmentSpecSha256: environmentDigest,
			expectedVerifierEpoch: contract.verifierEpoch,
			verifierContractDigest: contract.contractDigest,
		})}\n`;
		const transport = new TransientEnsureAndPollFauxTransport(
			JSON.stringify(
				successfulResult(evaluatorDigest, environmentDigest, {
					jobId: CONTROLLER_JOB_ID,
					requestSha256: sha256Text(requestJson),
					slurmJobId: SLURM_JOB_ID,
				}),
			),
			readinessResult(environmentDigest),
		);
		const adapter = new KernelBenchQualificationAdapter(
			{
				...DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
				pollIntervalMs: 1,
				requestTimeoutMs: 1_000,
			},
			transport,
		);
		const outcome = await adapter.evaluate(evaluationJob(contract), {
			signal: new AbortController().signal,
			recordExternalJobId: async () => undefined,
		});
		assert.equal(transport.ensureAttempts, 2);
		assert.equal(transport.ensureCalls, 1);
		assert.equal(transport.actualDispatches, 1);
		assert.equal(transport.pollAttempts, 2);
		assert.equal(transport.cancelCalls, 0);
		assert.ok(
			outcome.tasks.every((task) => task.status === "accepted"),
			outcome.stderr,
		);
	});

	it("renders the exact one-L40S qualification resource envelope without credentials", () => {
		const script = buildKernelBenchQualificationJobScript(
			DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
			"/scratch/users/duynguy/prime-autoresearch/kernelbench/jobs/job_cccccccccccccccccccccccc",
			`/scratch/users/duynguy/prime-autoresearch/kernelbench/repos/${KERNELBENCH_VERIFIED_COMMIT}`,
			"/scratch/users/duynguy/prime-autoresearch/kernelbench/envs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bin/python",
		);
		for (const directive of [
			"#SBATCH --partition=gpu",
			"#SBATCH --constraint=GPU_SKU:L40S",
			"#SBATCH --gres=gpu:1",
			"#SBATCH --cpus-per-task=8",
			"#SBATCH --mem=32G",
			"#SBATCH --time=00:30:00",
			"#SBATCH --export=NONE",
			"env -i",
		]) {
			assert.ok(script.includes(directive), `missing directive: ${directive}`);
		}
		assert.doesNotMatch(script, /API_KEY|TOKEN|credential/i);
	});

	it("parses every bootstrap, readiness, dispatch, and cancellation remote program", async () => {
		for (const source of [
			KERNELBENCH_BOOTSTRAP_REMOTE,
			KERNELBENCH_READINESS_REMOTE,
			KERNELBENCH_ENSURE_SUBMITTED_REMOTE,
			KERNELBENCH_CANCEL_REMOTE,
		]) {
			const parsed = await runCommand("python3", ["-c", "import ast, sys; ast.parse(sys.argv[1])", source]);
			assert.equal(parsed.exitCode, 0, parsed.stderr);
		}
	});

	it("surfaces bootstrap child stdout, stderr, and exit code", async () => {
		const temporaryRoot = await mkdtemp(join(tmpdir(), "prime-kbv-bootstrap-failure-"));
		try {
			const bootstrapScript = "#!/bin/sh\nprintf 'bootstrap stdout\\n'\nprintf 'bootstrap stderr\\n' >&2\nexit 37\n";
			const environmentSpec = "fixture=true\n";
			const payload = JSON.stringify({
				bootstrapScript: Buffer.from(bootstrapScript).toString("base64"),
				environmentSpec: Buffer.from(environmentSpec).toString("base64"),
			});
			const result = await runCommand(
				"python3",
				["-c", KERNELBENCH_BOOTSTRAP_REMOTE, temporaryRoot],
				process.env,
				payload,
			);
			assert.equal(result.exitCode, 37);
			assert.equal(result.stdout, "bootstrap stdout\n");
			assert.equal(result.stderr, "bootstrap stderr\n");
			assert.doesNotMatch(result.stderr, /CalledProcessError|Traceback/);
			assert.match(formatFarmShareCommandFailure(result), /exit 37/);
			assert.match(formatFarmShareCommandFailure(result), /stdout:\nbootstrap stdout/);
			assert.match(formatFarmShareCommandFailure(result), /stderr:\nbootstrap stderr/);
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	it("records dispatch intent before the only sbatch call and never resubmits an ambiguous intent", async () => {
		assert.match(KERNELBENCH_ENSURE_SUBMITTED_REMOTE, /"--user", user/);
		assert.match(KERNELBENCH_ENSURE_SUBMITTED_REMOTE, /JobIDRaw,JobName,WorkDir/);
		assert.match(KERNELBENCH_CANCEL_REMOTE, /"scancel", job_id/);
		assert.match(KERNELBENCH_CANCEL_REMOTE, /durable user\/workdir scope/);
		const temporaryRoot = await mkdtemp(join(tmpdir(), "prime-kbv-dispatch-"));
		try {
			const fakeBin = join(temporaryRoot, "bin");
			const firstJobRoot = join(temporaryRoot, "first-job");
			const firstLog = join(temporaryRoot, "first-sbatch.log");
			await Promise.all([mkdir(fakeBin), mkdir(firstJobRoot)]);
			await writeFile(join(firstJobRoot, "job.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o500 });
			const fakeCommands: Record<string, string> = {
				squeue: `#!/bin/sh
set -eu
if [ -n "\${FAIL_SQUEUE_MARKER:-}" ] && [ ! -f "$FAIL_SQUEUE_MARKER" ]; then
	: > "$FAIL_SQUEUE_MARKER"
	printf 'temporary squeue failure\\n' >&2
	exit 9
fi
exit 0
`,
				sacct: "#!/bin/sh\nexit 0\n",
				sbatch: `#!/bin/sh
set -eu
test -f "$KBV_JOB_ROOT/dispatch-intent.json"
grep -q '"submissionAttempts": 1' "$KBV_JOB_ROOT/dispatch-intent.json"
printf 'called\\n' >> "$FAKE_SBATCH_LOG"
printf '12345\\n'
`,
			};
			await Promise.all(
				Object.entries(fakeCommands).map(async ([name, source]) => {
					const path = join(fakeBin, name);
					await writeFile(path, source);
					await chmod(path, 0o500);
				}),
			);
			const baseEnvironment = {
				...process.env,
				PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
			};
			const firstEnvironment = {
				...baseEnvironment,
				KBV_JOB_ROOT: firstJobRoot,
				FAKE_SBATCH_LOG: firstLog,
				FAIL_SQUEUE_MARKER: join(temporaryRoot, "squeue-failed-once"),
			};
			const discoveryFailure = await runCommand(
				"python3",
				["-c", KERNELBENCH_ENSURE_SUBMITTED_REMOTE, firstJobRoot, "pkbv-test", "120", "999"],
				firstEnvironment,
			);
			assert.equal(discoveryFailure.exitCode, 9);
			assert.match(discoveryFailure.stderr, /temporary squeue failure/);
			await assert.rejects(readFile(join(firstJobRoot, "dispatch-intent.json"), "utf8"), /ENOENT/);
			await assert.rejects(readFile(firstLog, "utf8"), /ENOENT/);
			const first = await runCommand(
				"python3",
				["-c", KERNELBENCH_ENSURE_SUBMITTED_REMOTE, firstJobRoot, "pkbv-test", "120", "1000"],
				firstEnvironment,
			);
			assert.equal(first.exitCode, 0, first.stderr);
			assert.deepEqual(JSON.parse(first.stdout), { kind: "submitted", slurmJobId: "12345" });
			const firstIntent = JSON.parse(await readFile(join(firstJobRoot, "dispatch-intent.json"), "utf8")) as {
				submissionAttempts: number;
				lastAttemptAtEpoch: number;
			};
			assert.equal(firstIntent.submissionAttempts, 1);
			assert.equal(firstIntent.lastAttemptAtEpoch, 1000);
			assert.equal(await readFile(firstLog, "utf8"), "called\n");

			const resumed = await runCommand(
				"python3",
				["-c", KERNELBENCH_ENSURE_SUBMITTED_REMOTE, firstJobRoot, "pkbv-test", "120", "1001"],
				firstEnvironment,
			);
			assert.equal(resumed.exitCode, 0, resumed.stderr);
			assert.deepEqual(JSON.parse(resumed.stdout), { kind: "submitted", slurmJobId: "12345" });
			assert.equal(await readFile(firstLog, "utf8"), "called\n");

			const ambiguousRoot = join(temporaryRoot, "ambiguous-job");
			const ambiguousLog = join(temporaryRoot, "ambiguous-sbatch.log");
			await mkdir(ambiguousRoot);
			await writeFile(
				join(ambiguousRoot, "dispatch-intent.json"),
				`${JSON.stringify({
					schemaVersion: 1,
					jobName: "pkbv-test",
					createdAtEpoch: 1000,
					lastAttemptAtEpoch: 1000,
					submissionAttempts: 1,
				})}\n`,
			);
			const ambiguousEnvironment = {
				...baseEnvironment,
				KBV_JOB_ROOT: ambiguousRoot,
				FAKE_SBATCH_LOG: ambiguousLog,
			};
			const reconciling = await runCommand(
				"python3",
				["-c", KERNELBENCH_ENSURE_SUBMITTED_REMOTE, ambiguousRoot, "pkbv-test", "120", "1050"],
				ambiguousEnvironment,
			);
			assert.equal(reconciling.exitCode, 0, reconciling.stderr);
			assert.equal((JSON.parse(reconciling.stdout) as { kind: string }).kind, "reconciling");
			await assert.rejects(readFile(ambiguousLog, "utf8"), /ENOENT/);

			const ambiguous = await runCommand(
				"python3",
				["-c", KERNELBENCH_ENSURE_SUBMITTED_REMOTE, ambiguousRoot, "pkbv-test", "120", "1121"],
				ambiguousEnvironment,
			);
			assert.equal(ambiguous.exitCode, 0, ambiguous.stderr);
			assert.match((JSON.parse(ambiguous.stdout) as { reason: string }).reason, /refusing automatic resubmission/);
			await assert.rejects(readFile(ambiguousLog, "utf8"), /ENOENT/);
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	it("rejects parent traversal in local and bootstrap path contracts", async () => {
		const unsafeRoot = "/scratch/users/duynguy/prime-autoresearch/../escape";
		assert.throws(
			() =>
				new KernelBenchQualificationAdapter({
					...DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
					remoteRoot: unsafeRoot,
				}),
			/path must be absolute and normalized/,
		);
		assert.throws(
			() =>
				buildKernelBenchQualificationJobScript(
					DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
					`${unsafeRoot}/jobs/job_${"c".repeat(24)}`,
					`/scratch/users/duynguy/repos/${KERNELBENCH_VERIFIED_COMMIT}`,
					`/scratch/users/duynguy/envs/${"a".repeat(64)}/bin/python`,
				),
			/path must be absolute and normalized/,
		);
		const bootstrap = await runCommand("bash", [BOOTSTRAP_PATH, unsafeRoot]);
		assert.equal(bootstrap.exitCode, 2);
		assert.match(bootstrap.stderr, /absolute normalized path/);
	});
});

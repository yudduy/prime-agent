import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import { KernelBenchTransientTransportError } from "../src/kernelbench-qualification-adapter.js";
import { EvidenceLedger } from "../src/ledger.js";
import { NANOGPT_BASELINE_SHA256 } from "../src/nanogpt-contract.js";
import {
	buildNanoGptFarmShareSmokeJobScript,
	buildNanoGptIsolatedPythonSource,
	DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG,
	isNanoGptTerminalSlurmState,
	loadNanoGptFarmShareSmokeSubmission,
	NANOGPT_FARMSHARE_SMOKE_CONTRACT,
	NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
	NANOGPT_REUSED_ENVIRONMENT_DIR,
	NANOGPT_REUSED_ENVIRONMENT_EXECUTABLES,
	NANOGPT_SMOKE_DATA_CONSUMPTION,
	NANOGPT_SMOKE_DATA_FILES,
	NANOGPT_SMOKE_DATA_HEADERS,
	NANOGPT_SMOKE_DATA_MANIFEST_SHA256,
	NANOGPT_SMOKE_FORBIDDEN_ENVIRONMENT,
	NANOGPT_SMOKE_LAUNCH_ENVIRONMENT_KEYS,
	NANOGPT_SMOKE_POLL_REMOTE,
	NANOGPT_SMOKE_PREPARE_REMOTE,
	NANOGPT_SMOKE_READINESS_REMOTE,
	NANOGPT_STOCK_SMOKE_MANIFEST_SHA256,
	NANOGPT_STOCK_SMOKE_RUNTIME_EVALUATOR_SHA256,
	NANOGPT_STOCK_SMOKE_RUNTIME_SHA256,
	NANOGPT_STOCK_SMOKE_STATIC_EVALUATOR_SHA256,
	NANOGPT_TERMINAL_SLURM_STATES,
	type NanoGptFarmShareSmokeConfig,
	type NanoGptFarmShareSmokeTransport,
	type NanoGptSmokeExistingResult,
	type NanoGptSmokePreparedAssets,
	type NanoGptSmokeRemotePoll,
	parseNanoGptFarmShareWorkerResult,
	reconcileNanoGptFarmShareStockSmoke,
	submitNanoGptFarmShareStockSmoke,
} from "../src/nanogpt-farmshare-smoke.js";
import { NANOGPT_RUNTIME_CLAIM_SCOPE, NANOGPT_RUNTIME_CONTRACT_ID } from "../src/nanogpt-runtime.js";

const WORKER_PATH = fileURLToPath(new URL("../evaluators/nanogpt_farmshare_smoke_worker.py", import.meta.url));
const DATASET_MANIFEST_PATH = fileURLToPath(new URL("../farmshare/nanogpt-smoke-data.json", import.meta.url));
const SLURM_JOB_ID = "1701234";
const PINNED_ENVIRONMENT_MANIFEST =
	'{"environmentSpecSha256": "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b", "kernelBenchVerifiedCommit": "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e", "numpy": "2.5.2", "pip": "25.2", "python": "3.12.3", "schemaVersion": 1, "torch": "2.11.0+cu128", "torchCuda": "12.8"}\n';
const PINNED_PIP_FREEZE = `Jinja2==3.1.6
MarkupSafe==3.0.3
cuda-bindings==12.9.7
cuda-pathfinder==1.6.0
cuda-toolkit==12.8.1
filelock==3.32.3
fsspec==2026.7.0
mpmath==1.3.0
networkx==3.6.1
numpy==2.5.2
nvidia-cublas-cu12==12.8.4.1
nvidia-cuda-cupti-cu12==12.8.90
nvidia-cuda-nvrtc-cu12==12.8.93
nvidia-cuda-runtime-cu12==12.8.90
nvidia-cudnn-cu12==9.19.0.56
nvidia-cufft-cu12==11.3.3.83
nvidia-cufile-cu12==1.13.1.3
nvidia-curand-cu12==10.3.9.90
nvidia-cusolver-cu12==11.7.3.90
nvidia-cusparse-cu12==12.5.8.93
nvidia-cusparselt-cu12==0.7.1
nvidia-nccl-cu12==2.28.9
nvidia-nvjitlink-cu12==12.8.93
nvidia-nvshmem-cu12==3.4.5
nvidia-nvtx-cu12==12.8.90
pip==25.2
setuptools==78.1.0
sympy==1.14.0
torch==2.11.0+cu128
triton==3.6.0
typing_extensions==4.16.0
`;
const PINNED_ENVIRONMENT_SEAL =
	'{"environmentManifestSha256": "71ddfe105be64b7122d7b6d143ea1a6c26a5b9de30cc414a9cbd9df7cd314de8", "environmentSpecSha256": "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b", "pipFreezeSha256": "b85ceb87080994284c997e0ea3742246df1a12d4fc2551a9d8412d87160766d9", "schemaVersion": 1}\n';

interface CommandResult {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
	return new Promise((done) => {
		execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
			done({
				exitCode: error && typeof error.code === "number" ? error.code : error ? null : 0,
				stdout,
				stderr,
			});
		});
	});
}

function readinessResult(datasetManifest: string, revision = "base"): string {
	const environmentManifest = PINNED_ENVIRONMENT_MANIFEST;
	const pipFreeze = revision === "base" ? PINNED_PIP_FREEZE : `${PINNED_PIP_FREEZE}fixture==${revision}\n`;
	const environmentSeal = PINNED_ENVIRONMENT_SEAL;
	return JSON.stringify({
		schemaVersion: 1,
		environmentDirectory: NANOGPT_REUSED_ENVIRONMENT_DIR,
		datasetDirectory: `${DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot}/data/${NANOGPT_SMOKE_DATA_MANIFEST_SHA256}/fineweb10B`,
		environmentManifest,
		pipFreeze,
		environmentSeal,
		executables: NANOGPT_REUSED_ENVIRONMENT_EXECUTABLES,
		datasetManifest,
		runtime: {
			python: "3.12.3",
			pip: "25.2",
			torch: "2.11.0+cu128",
			torchCuda: "12.8",
			numpy: "2.5.2",
		},
		dataFiles: NANOGPT_SMOKE_DATA_FILES,
		dataHeaders: NANOGPT_SMOKE_DATA_HEADERS,
	});
}

function asset(assets: NanoGptSmokePreparedAssets, path: string): string {
	const found = assets.files.find((item) => item.path === path);
	if (!found) throw new Error(`Missing faux asset ${path}`);
	return found.content;
}

function requestFromAssets(assets: NanoGptSmokePreparedAssets) {
	return JSON.parse(assets.requestJson) as {
		readonly jobKey: string;
		readonly executionSeal: {
			readonly workerSha256: string;
			readonly bundle: {
				readonly manifestSha256: string;
				readonly runtimeSha256: string;
			};
			readonly environment: {
				readonly environmentManifestSha256: string;
				readonly pipFreezeSha256: string;
				readonly environmentSealSha256: string;
			};
		};
	};
}

function failedWorkerResult(assets: NanoGptSmokePreparedAssets): string {
	const request = requestFromAssets(assets);
	return JSON.stringify({
		schemaVersion: 1,
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		ok: false,
		jobKey: request.jobKey,
		requestSha256: sha256Text(assets.requestJson),
		workerSha256: request.executionSeal.workerSha256,
		startedAt: "2026-08-27T00:00:00.000Z",
		finishedAt: "2026-08-27T00:00:01.000Z",
		slurmJobId: SLURM_JOB_ID,
		executionSeal: request.executionSeal,
		environmentEvidence: {},
		datasetEvidence: {},
		launchEnvironmentKeys: [],
		runtimeExitCode: null,
		gateVerification: null,
		gateExtraction: null,
		integrityEvidence: {
			preRun: null,
			preRunSha256: null,
			postRun: null,
			postRunSha256: null,
			stable: false,
		},
		failure: { kind: "fixture", message: "durable fixture failure" },
	});
}

function successfulWorkerResult(assets: NanoGptSmokePreparedAssets): string {
	const request = requestFromAssets(assets);
	const manifest = JSON.parse(asset(assets, "bundle/runtime-manifest.json")) as Record<string, unknown>;
	const environmentEvidence = {
		environmentManifestSha256: request.executionSeal.environment.environmentManifestSha256,
		pipFreezeSha256: request.executionSeal.environment.pipFreezeSha256,
		environmentSealSha256: request.executionSeal.environment.environmentSealSha256,
		python: "3.12.3",
		pip: "25.2",
		torch: "2.11.0+cu128",
		torchCuda: "12.8",
		numpy: "2.5.2",
		executables: NANOGPT_REUSED_ENVIRONMENT_EXECUTABLES,
		gpu: "NVIDIA L40S",
		gpuComputeCapability: "8.9",
		gpuTotalMemoryBytes: 48_000_000_000,
	};
	const datasetEvidence = {
		directory: `${DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot}/data/${NANOGPT_SMOKE_DATA_MANIFEST_SHA256}/fineweb10B`,
		manifestSha256: NANOGPT_SMOKE_DATA_MANIFEST_SHA256,
		files: NANOGPT_SMOKE_DATA_FILES,
		headers: NANOGPT_SMOKE_DATA_HEADERS,
		consumption: NANOGPT_SMOKE_DATA_CONSUMPTION,
	};
	const textFile = (path: string, content: string, mode: number) => ({
		path,
		size: Buffer.byteLength(content),
		sha256: sha256Text(content),
		mode,
	});
	const jobFiles = [
		textFile("bundle/candidate.source.py", asset(assets, "bundle/candidate.source.py"), 0o400),
		textFile("bundle/runtime-manifest.json", asset(assets, "bundle/runtime-manifest.json"), 0o400),
		textFile("bundle/train_gpt_runtime.py", asset(assets, "bundle/train_gpt_runtime.py"), 0o400),
		textFile("dataset-manifest.json", asset(assets, "dataset-manifest.json"), 0o400),
		textFile("gate/evaluators/nanogpt_contract.py", asset(assets, "gate/evaluators/nanogpt_contract.py"), 0o400),
		textFile("gate/evaluators/nanogpt_runtime.py", asset(assets, "gate/evaluators/nanogpt_runtime.py"), 0o400),
		textFile(
			"gate/fixtures/nanogpt/train_gpt_simple.py",
			asset(assets, "gate/fixtures/nanogpt/train_gpt_simple.py"),
			0o400,
		),
		textFile("isolated-python", asset(assets, "isolated-python"), 0o500),
		textFile("job.sh", asset(assets, "job.sh"), 0o500),
		textFile("request.json", asset(assets, "request.json"), 0o400),
		textFile("worker.py", asset(assets, "worker.py"), 0o500),
	];
	const stagedFiles = [
		textFile("candidate.source.py", asset(assets, "bundle/candidate.source.py"), 0o444),
		textFile("runtime-manifest.json", asset(assets, "bundle/runtime-manifest.json"), 0o444),
		textFile("train_gpt_runtime.py", asset(assets, "bundle/train_gpt_runtime.py"), 0o444),
		textFile("data/fineweb10B/dataset-manifest.json", asset(assets, "dataset-manifest.json"), 0o444),
		textFile("data/fineweb10B/READY", `${NANOGPT_SMOKE_DATA_MANIFEST_SHA256}\n`, 0o444),
		...NANOGPT_SMOKE_DATA_FILES.map((file) => ({
			path: `data/fineweb10B/${file.path}`,
			size: file.size,
			sha256: file.sha256,
			mode: 0o444,
		})),
	];
	const integritySnapshot = {
		jobAssets: { files: jobFiles, sha256: sha256Json(jobFiles) },
		stagedInputs: { files: stagedFiles, sha256: sha256Json(stagedFiles) },
		environment: environmentEvidence,
		dataset: datasetEvidence,
		launchEnvironment: {
			CUDA_DEVICE_ORDER: "PCI_BUS_ID",
			CUDA_VISIBLE_DEVICES: "0",
			HOME: `${DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot}/jobs/${request.jobKey}/home`,
			LC_ALL: "C.UTF-8",
			PATH: `${NANOGPT_REUSED_ENVIRONMENT_DIR}/bin:/usr/bin:/bin`,
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONNOUSERSITE: "1",
			PYTHON_EXEC: `${DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot}/jobs/${request.jobKey}/isolated-python`,
			SLURM_JOB_ID,
			TMPDIR: `${DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot}/jobs/${request.jobKey}/tmp`,
			TORCHINDUCTOR_CACHE_DIR: `${DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot}/jobs/${request.jobKey}/torchinductor-cache`,
		},
	};
	const integritySha256 = sha256Json(integritySnapshot);
	return JSON.stringify({
		schemaVersion: 1,
		contract: NANOGPT_FARMSHARE_SMOKE_CONTRACT,
		evidenceClass: NANOGPT_FARMSHARE_SMOKE_EVIDENCE_CLASS,
		ok: true,
		jobKey: request.jobKey,
		requestSha256: sha256Text(assets.requestJson),
		workerSha256: request.executionSeal.workerSha256,
		startedAt: "2026-08-27T00:00:00.000Z",
		finishedAt: "2026-08-27T00:01:00.000Z",
		slurmJobId: SLURM_JOB_ID,
		executionSeal: request.executionSeal,
		environmentEvidence,
		datasetEvidence,
		launchEnvironmentKeys: NANOGPT_SMOKE_LAUNCH_ENVIRONMENT_KEYS,
		runtimeExitCode: 0,
		gateVerification: {
			schemaVersion: 1,
			contract: NANOGPT_RUNTIME_CONTRACT_ID,
			operation: "verify",
			ok: true,
			errors: [],
			bundlePath: "/sealed/run",
			manifestSha256: request.executionSeal.bundle.manifestSha256,
			manifest,
		},
		gateExtraction: {
			schemaVersion: 1,
			contract: NANOGPT_RUNTIME_CONTRACT_ID,
			operation: "extract",
			ok: true,
			errors: [],
			metrics: {
				schemaVersion: 1,
				contract: NANOGPT_RUNTIME_CONTRACT_ID,
				ok: true,
				mode: "cuda-smoke-10",
				candidateSha256: NANOGPT_BASELINE_SHA256,
				runtimeSha256: request.executionSeal.bundle.runtimeSha256,
				declaredTrainSteps: 3290,
				effectiveTrainSteps: 10,
				trials: 1,
				seeds: [0xc0ffee],
				finalValidationLosses: [3.5],
				runtimeValidationLosses: [3.5],
				meanValidationLoss: 3.5,
				optimizerSteps: [10],
				backwardCalls: [80],
				peakVramMb: [12_345.5],
				environment: { pytorch: "2.11.0+cu128", cuda: "12.8", gpu: "NVIDIA L40S", worldSize: 1 },
				claimScope: NANOGPT_RUNTIME_CLAIM_SCOPE,
				scoredEligible: false,
				recordEligible: false,
				recordPassed: null,
			},
		},
		integrityEvidence: {
			preRun: integritySnapshot,
			preRunSha256: integritySha256,
			postRun: integritySnapshot,
			postRunSha256: integritySha256,
			stable: true,
		},
		failure: null,
	});
}

class FauxTransport implements NanoGptFarmShareSmokeTransport {
	assets: NanoGptSmokePreparedAssets | null = null;
	events: string[] = [];
	dispatches = 0;
	ensureCalls = 0;
	polls = 0;
	private dispatched = false;

	constructor(
		private readonly readinessRaw: string,
		private readonly existing: boolean,
		private readonly pollPlan: readonly ("pending" | "result")[] = [],
	) {}

	async readiness(): Promise<string> {
		this.events.push("readiness");
		return this.readinessRaw;
	}

	async prepare(_remoteJobDir: string, assets: NanoGptSmokePreparedAssets): Promise<void> {
		this.events.push("prepare");
		this.assets = assets;
	}

	async readExistingResult(): Promise<NanoGptSmokeExistingResult | null> {
		this.events.push("existing");
		if (!this.existing) return null;
		assert.ok(this.assets);
		return { rawResult: failedWorkerResult(this.assets), log: "existing fixture", slurmJobId: SLURM_JOB_ID };
	}

	async ensureSubmitted(): Promise<{ readonly slurmJobId: string }> {
		this.events.push("ensure");
		this.ensureCalls++;
		if (!this.dispatched) {
			this.dispatched = true;
			this.dispatches++;
		}
		return { slurmJobId: SLURM_JOB_ID };
	}

	async poll(): Promise<NanoGptSmokeRemotePoll> {
		this.events.push("poll");
		const planned = this.pollPlan[this.polls] ?? "pending";
		this.polls++;
		if (planned === "pending") {
			return { kind: "pending", schedulerState: "RESULT_VISIBILITY_GRACE:COMPLETED|0:0" };
		}
		assert.ok(this.assets);
		return { kind: "result", rawResult: successfulWorkerResult(this.assets), log: "complete" };
	}

	async cancelAndVerify(): Promise<string> {
		this.events.push("cancel");
		return "CANCELLED|fixture";
	}
}

describe("sealed asynchronous NanoGPT FarmShare stock smoke", () => {
	let directory = "";
	let datasetManifest = "";
	let config: NanoGptFarmShareSmokeConfig;

	before(async () => {
		directory = await mkdtemp(join(tmpdir(), "prime-nanogpt-farmshare-test-"));
		datasetManifest = await readFile(DATASET_MANIFEST_PATH, "utf8");
		config = {
			...DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG,
			pollIntervalMs: 1,
			requestTimeoutMs: 1_000,
			dispatchVisibilityGraceMs: 10,
			resultVisibilityGraceMs: 10,
		};
	});

	after(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("returns a durable queued identity immediately after one idempotent dispatch", async () => {
		const outputDir = join(directory, "queued");
		const transport = new FauxTransport(readinessResult(datasetManifest), false);
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport });
		assert.equal(submission.status, "queued");
		assert.equal(submission.slurmJobId, SLURM_JOB_ID);
		assert.equal(submission.executionSeal.bundle.manifestSha256, NANOGPT_STOCK_SMOKE_MANIFEST_SHA256);
		assert.equal(submission.executionSeal.bundle.runtimeSha256, NANOGPT_STOCK_SMOKE_RUNTIME_SHA256);
		assert.equal(
			submission.executionSeal.bundle.runtimeEvaluatorSha256,
			NANOGPT_STOCK_SMOKE_RUNTIME_EVALUATOR_SHA256,
		);
		assert.equal(submission.executionSeal.bundle.staticEvaluatorSha256, NANOGPT_STOCK_SMOKE_STATIC_EVALUATOR_SHA256);
		assert.deepEqual(transport.events, ["readiness", "existing", "prepare", "ensure"]);
		assert.equal(transport.polls, 0);
		assert.equal(transport.dispatches, 1);
		assert.match(await readFile(join(outputDir, "submission.json"), "utf8"), new RegExp(submission.jobKey));
		const repeatedSubmission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport });
		assert.deepEqual(repeatedSubmission, submission);
		assert.equal(transport.dispatches, 1);
		assert.deepEqual(transport.events, ["readiness", "existing", "prepare", "ensure"]);
		const ledger = await EvidenceLedger.open(join(outputDir, "evidence.jsonl"));
		ledger.verify();

		const pending = await reconcileNanoGptFarmShareStockSmoke({ submission, config, transport });
		assert.equal(pending.status, "pending");
		if (pending.status !== "pending") assert.fail("expected one-shot pending status");
		assert.match(pending.schedulerState, /^RESULT_VISIBILITY_GRACE:/);
		assert.equal(transport.polls, 1);
		assert.ok(!transport.events.includes("cancel"));
		assert.deepEqual(await loadNanoGptFarmShareSmokeSubmission(join(outputDir, "submission.json")), submission);
	});

	it("waits through terminal-result visibility lag and accepts only complete G1 v2 evidence", async () => {
		const outputDir = join(directory, "visibility-lag");
		const transport = new FauxTransport(readinessResult(datasetManifest), false, ["pending", "result"]);
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport });
		const reconciled = await reconcileNanoGptFarmShareStockSmoke({
			submission,
			config,
			transport,
			wait: true,
		});
		assert.equal(reconciled.status, "completed");
		if (reconciled.status !== "completed") assert.fail("expected completed reconciliation");
		assert.equal(reconciled.result.ok, true);
		assert.equal(reconciled.result.workerResult?.gateExtraction?.operation, "extract");
		assert.equal(transport.polls, 2);
		assert.match(await readFile(join(outputDir, "result.json"), "utf8"), /infrastructure-only-stock-smoke/);
		const eventsBeforeRepeatedReconcile = (await EvidenceLedger.open(join(outputDir, "evidence.jsonl"))).getEvents()
			.length;
		const repeated = await reconcileNanoGptFarmShareStockSmoke({ submission, config, transport });
		assert.deepEqual(repeated, reconciled);
		assert.equal(transport.polls, 2);
		assert.equal(
			(await EvidenceLedger.open(join(outputDir, "evidence.jsonl"))).getEvents().length,
			eventsBeforeRepeatedReconcile,
		);
	});

	it("reuses an immutable remote result without another scheduler submission", async () => {
		const outputDir = join(directory, "existing-result");
		const seedTransport = new FauxTransport(readinessResult(datasetManifest), false);
		await submitNanoGptFarmShareStockSmoke({
			outputDir: join(directory, "existing-seed"),
			config,
			transport: seedTransport,
		});
		assert.ok(seedTransport.assets);
		const transport = new FauxTransport(readinessResult(datasetManifest), true);
		transport.assets = seedTransport.assets;
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport });
		assert.equal(submission.status, "result-ready");
		assert.equal(submission.recoveredRemoteResult, true);
		assert.equal(transport.dispatches, 0);
		const reconciled = await reconcileNanoGptFarmShareStockSmoke({ submission, config, transport });
		assert.equal(reconciled.status, "completed");
		if (reconciled.status !== "completed") assert.fail("expected recovered completion");
		assert.equal(reconciled.result.recoveredRemoteResult, true);
		assert.equal(reconciled.result.workerResult?.failure?.message, "durable fixture failure");
	});

	it("rejects a persisted result-ready forgery and a mismatched durable SLURM identity", async () => {
		const forgedOutput = join(directory, "forged-submission");
		const forgedTransport = new FauxTransport(readinessResult(datasetManifest), false);
		await submitNanoGptFarmShareStockSmoke({ outputDir: forgedOutput, config, transport: forgedTransport });
		const submissionPath = join(forgedOutput, "submission.json");
		const forged = JSON.parse(await readFile(submissionPath, "utf8")) as Record<string, unknown>;
		forged.status = "result-ready";
		forged.recoveredRemoteResult = true;
		forged.workerResult = { ok: true };
		await writeFile(submissionPath, JSON.stringify(forged), "utf8");
		await assert.rejects(loadNanoGptFarmShareSmokeSubmission(submissionPath), /Keys mismatch|worker evidence/);

		assert.ok(forgedTransport.assets);
		const mismatchTransport = new FauxTransport(readinessResult(datasetManifest), true);
		mismatchTransport.assets = forgedTransport.assets;
		mismatchTransport.readExistingResult = async () => ({
			rawResult: failedWorkerResult(mismatchTransport.assets as NanoGptSmokePreparedAssets),
			log: "mismatch",
			slurmJobId: "9999999",
		});
		await assert.rejects(
			submitNanoGptFarmShareStockSmoke({
				outputDir: join(directory, "mismatched-slurm-result"),
				config,
				transport: mismatchTransport,
			}),
			/SLURM identity mismatch/,
		);
	});

	it("binds submission and result artifacts to exact referenced ledger payloads", async () => {
		const submissionOutput = join(directory, "ledger-bound-submission");
		const submissionTransport = new FauxTransport(readinessResult(datasetManifest), false);
		const submission = await submitNanoGptFarmShareStockSmoke({
			outputDir: submissionOutput,
			config,
			transport: submissionTransport,
		});
		const submissionPath = join(submissionOutput, "submission.json");
		const ledger = await EvidenceLedger.open(submission.ledgerPath);
		const manifest = ledger.getEvents().find((event) => event.kind === "run_manifest");
		const state = ledger.getEvents().find((event) => event.kind === "job_state");
		assert.ok(manifest);
		assert.ok(state);
		await writeFile(submissionPath, JSON.stringify({ ...submission, ledgerTerminalHash: manifest.hash }), "utf8");
		await assert.rejects(loadNanoGptFarmShareSmokeSubmission(submissionPath), /kind or payload/);

		await rm(submission.ledgerPath);
		const stateOnlyLedger = await EvidenceLedger.open(submission.ledgerPath);
		const stateOnly = await stateOnlyLedger.append("job_state", state.payload);
		await writeFile(submissionPath, JSON.stringify({ ...submission, ledgerTerminalHash: stateOnly.hash }), "utf8");
		await assert.rejects(loadNanoGptFarmShareSmokeSubmission(submissionPath), /no exact preceding run manifest/);

		const resultOutput = join(directory, "ledger-bound-result");
		const resultTransport = new FauxTransport(readinessResult(datasetManifest), false, ["result"]);
		const resultSubmission = await submitNanoGptFarmShareStockSmoke({
			outputDir: resultOutput,
			config,
			transport: resultTransport,
		});
		const completed = await reconcileNanoGptFarmShareStockSmoke({
			submission: resultSubmission,
			config,
			transport: resultTransport,
		});
		assert.equal(completed.status, "completed");
		const resultLedger = await EvidenceLedger.open(resultSubmission.ledgerPath);
		await resultLedger.append("claim", { jobKey: resultSubmission.jobKey, status: "test-later-event" });
		const repeated = await reconcileNanoGptFarmShareStockSmoke({
			submission: resultSubmission,
			config,
			transport: resultTransport,
		});
		assert.deepEqual(repeated, completed);
		const resultPath = join(resultOutput, "result.json");
		const forgedResult = JSON.parse(await readFile(resultPath, "utf8")) as Record<string, unknown>;
		forgedResult.recoveredRemoteResult = true;
		await writeFile(resultPath, JSON.stringify(forgedResult), "utf8");
		await assert.rejects(
			reconcileNanoGptFarmShareStockSmoke({ submission: resultSubmission, config, transport: resultTransport }),
			/exact post-submission measurement event/,
		);
	});

	it("serializes concurrent submit and completion without branching the evidence ledger", async () => {
		const submitOutput = join(directory, "concurrent-submit");
		await mkdir(submitOutput, { recursive: true });
		const submissionLockPath = join(submitOutput, ".submission.lock");
		const evidenceLockPath = join(submitOutput, ".evidence.lock");
		await writeFile(submissionLockPath, "persistent submission lock inode\n", "utf8");
		await writeFile(evidenceLockPath, "persistent evidence lock inode\n", "utf8");
		const submissionLockBefore = await stat(submissionLockPath);
		const evidenceLockBefore = await stat(evidenceLockPath);
		const submitTransport = new FauxTransport(readinessResult(datasetManifest), false);
		const [firstSubmission, secondSubmission] = await Promise.all([
			submitNanoGptFarmShareStockSmoke({ outputDir: submitOutput, config, transport: submitTransport }),
			submitNanoGptFarmShareStockSmoke({ outputDir: submitOutput, config, transport: submitTransport }),
		]);
		assert.deepEqual(secondSubmission, firstSubmission);
		assert.equal(submitTransport.dispatches, 1);
		assert.equal(submitTransport.ensureCalls, 1);
		assert.equal(submitTransport.events.filter((event) => event === "readiness").length, 1);
		const submitLedger = await EvidenceLedger.open(join(submitOutput, "evidence.jsonl"));
		submitLedger.verify();
		assert.equal(submitLedger.getEvents().filter((event) => event.kind === "run_manifest").length, 1);
		assert.equal(submitLedger.getEvents().filter((event) => event.kind === "job_state").length, 1);
		const boundState = submitLedger.getEvents().find((event) => event.hash === firstSubmission.ledgerTerminalHash);
		assert.equal(boundState?.kind, "job_state");
		assert.deepEqual(boundState?.payload, {
			jobKey: firstSubmission.jobKey,
			status: "queued",
			slurmJobId: SLURM_JOB_ID,
		});
		assert.equal((await stat(submissionLockPath)).ino, submissionLockBefore.ino);
		assert.equal((await stat(evidenceLockPath)).ino, evidenceLockBefore.ino);

		const reconcileOutput = join(directory, "concurrent-reconcile");
		const reconcileTransport = new FauxTransport(readinessResult(datasetManifest), false, ["result", "result"]);
		const submission = await submitNanoGptFarmShareStockSmoke({
			outputDir: reconcileOutput,
			config,
			transport: reconcileTransport,
		});
		const [firstResult, secondResult] = await Promise.all([
			reconcileNanoGptFarmShareStockSmoke({ submission, config, transport: reconcileTransport }),
			reconcileNanoGptFarmShareStockSmoke({ submission, config, transport: reconcileTransport }),
		]);
		assert.deepEqual(secondResult, firstResult);
		const reconcileLedger = await EvidenceLedger.open(join(reconcileOutput, "evidence.jsonl"));
		reconcileLedger.verify();
		assert.equal(reconcileLedger.getEvents().filter((event) => event.kind === "measurement").length, 1);
	});

	it("promotes later durable worker evidence over a concurrent controller-only failure", async () => {
		const outputDir = join(directory, "controller-failure-upgrade");
		const seedTransport = new FauxTransport(readinessResult(datasetManifest), false);
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport: seedTransport });
		assert.ok(seedTransport.assets);

		const failureTransport = new FauxTransport(readinessResult(datasetManifest), false);
		failureTransport.assets = seedTransport.assets;
		failureTransport.poll = async () => ({ kind: "failed", reason: "terminal observation", log: "" });

		const successTransport = new FauxTransport(readinessResult(datasetManifest), false);
		successTransport.assets = seedTransport.assets;
		let releaseSuccessRead!: () => void;
		const successReadGate = new Promise<void>((done) => {
			releaseSuccessRead = done;
		});
		let signalSuccessRead!: () => void;
		const successReadEntered = new Promise<void>((done) => {
			signalSuccessRead = done;
		});
		successTransport.readExistingResult = async () => {
			signalSuccessRead();
			await successReadGate;
			return {
				rawResult: successfulWorkerResult(successTransport.assets as NanoGptSmokePreparedAssets),
				log: "durable success",
				slurmJobId: SLURM_JOB_ID,
			};
		};
		const successPromise = reconcileNanoGptFarmShareStockSmoke({
			submission,
			config,
			transport: successTransport,
		});
		await successReadEntered;
		const controllerFailure = await reconcileNanoGptFarmShareStockSmoke({
			submission,
			config,
			transport: failureTransport,
		});
		assert.equal(controllerFailure.status, "completed");
		if (controllerFailure.status !== "completed") assert.fail("expected controller failure");
		assert.equal(controllerFailure.result.workerResult, null);
		releaseSuccessRead();
		const upgraded = await successPromise;
		assert.equal(upgraded.status, "completed");
		if (upgraded.status !== "completed") assert.fail("expected durable worker upgrade");
		assert.equal(upgraded.result.ok, true);
		assert.equal(upgraded.result.workerResult?.ok, true);
		const ledger = await EvidenceLedger.open(submission.ledgerPath);
		ledger.verify();
		assert.equal(ledger.getEvents().filter((event) => event.kind === "measurement").length, 2);
		const callsBeforeRepeat = successTransport.events.length;
		const repeated = await reconcileNanoGptFarmShareStockSmoke({ submission, config, transport: successTransport });
		assert.deepEqual(repeated, upgraded);
		assert.equal(successTransport.events.length, callsBeforeRepeat);
	});

	it("never replaces an immutable worker failure with a later claimed success", async () => {
		const outputDir = join(directory, "worker-failure-is-final");
		const seedTransport = new FauxTransport(readinessResult(datasetManifest), false);
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport: seedTransport });
		assert.ok(seedTransport.assets);
		const workerFailureTransport = new FauxTransport(readinessResult(datasetManifest), true);
		workerFailureTransport.assets = seedTransport.assets;
		const failed = await reconcileNanoGptFarmShareStockSmoke({
			submission,
			config,
			transport: workerFailureTransport,
		});
		assert.equal(failed.status, "completed");
		if (failed.status !== "completed") assert.fail("expected worker failure");
		assert.equal(failed.result.workerResult?.ok, false);

		const claimedSuccess = new FauxTransport(readinessResult(datasetManifest), false, ["result"]);
		claimedSuccess.assets = seedTransport.assets;
		const repeated = await reconcileNanoGptFarmShareStockSmoke({ submission, config, transport: claimedSuccess });
		assert.deepEqual(repeated, failed);
		assert.deepEqual(claimedSuccess.events, []);
	});

	it("renders one L40S env-i job and keeps every executable boundary local and parseable", async () => {
		const jobKey = "a".repeat(64);
		const script = buildNanoGptFarmShareSmokeJobScript(
			DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG,
			`${DEFAULT_NANOGPT_FARMSHARE_SMOKE_CONFIG.remoteRoot}/jobs/${jobKey}`,
		);
		for (const expected of [
			"#SBATCH --constraint=GPU_SKU:L40S",
			"#SBATCH --gres=gpu:1",
			"#SBATCH --nodes=1",
			"#SBATCH --ntasks=1",
			"#SBATCH --export=NONE",
			"env -i",
			"CUDA_VISIBLE_DEVICES=",
			"PYTHON_EXEC=",
		]) {
			assert.ok(script.includes(expected), `missing sealed job clause: ${expected}`);
		}
		for (const forbidden of NANOGPT_SMOKE_FORBIDDEN_ENVIRONMENT) assert.ok(!script.includes(forbidden));
		assert.doesNotMatch(script, /API_KEY|TOKEN|credential/i);
		assert.match(NANOGPT_SMOKE_POLL_REMOTE, /RESULT_VISIBILITY_GRACE/);
		assert.match(NANOGPT_SMOKE_POLL_REMOTE, /ACCOUNTING_NONTERMINAL/);
		assert.match(NANOGPT_SMOKE_POLL_REMOTE, /marker\.unlink\(\)/);
		assert.match(NANOGPT_SMOKE_PREPARE_REMOTE, /"isolated-python"/);
		assert.ok((NANOGPT_SMOKE_POLL_REMOTE.match(/if result_path\.exists\(\):/g) ?? []).length >= 2);
		const isolatedPython = buildNanoGptIsolatedPythonSource();
		assert.equal(sha256Text(isolatedPython), "bc258dfc14cba20e8bfc23d4428e93f7a307df83c3b7887b1065a67d53c2586f");

		const worker = await readFile(WORKER_PATH, "utf8");
		assert.match(worker, /cp", "--reflink=auto"/);
		assert.doesNotMatch(worker, /symlink_to\(dataset_dir/);
		assert.match(worker, /struct\.unpack\("<iii"/);
		const jobPath = join(directory, "job-syntax.sh");
		const isolatedPythonPath = join(directory, "isolated-python-syntax.sh");
		await writeFile(jobPath, script, "utf8");
		await writeFile(isolatedPythonPath, isolatedPython, "utf8");
		const parses = await Promise.all([
			runCommand("bash", ["-n", jobPath]),
			runCommand("sh", ["-n", isolatedPythonPath]),
			runCommand("python3", [
				"-c",
				"import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))",
				WORKER_PATH,
			]),
			...([NANOGPT_SMOKE_READINESS_REMOTE, NANOGPT_SMOKE_PREPARE_REMOTE, NANOGPT_SMOKE_POLL_REMOTE] as const).map(
				(source) => runCommand("python3", ["-c", "import ast, sys; ast.parse(sys.argv[1])", source]),
			),
		]);
		for (const parsed of parses) assert.equal(parsed.exitCode, 0, parsed.stderr);
	});

	it("classifies only explicit SLURM terminal states as terminal", () => {
		for (const state of NANOGPT_TERMINAL_SLURM_STATES) {
			assert.equal(isNanoGptTerminalSlurmState(state), true);
			assert.equal(isNanoGptTerminalSlurmState(`${state.toLowerCase()}+|0:0`), true);
		}
		for (const state of [
			"PENDING",
			"RUNNING",
			"STOPPED",
			"REQUEUE_HOLD",
			"RESV_DEL_HOLD",
			"SPECIAL_EXIT",
			"FUTURE_STATE",
		]) {
			assert.equal(isNanoGptTerminalSlurmState(state), false);
		}
		assert.ok(
			NANOGPT_SMOKE_POLL_REMOTE.includes(`terminal_states = set(${JSON.stringify(NANOGPT_TERMINAL_SLURM_STATES)})`),
		);
		assert.match(NANOGPT_SMOKE_POLL_REMOTE, /if state not in terminal_states:/);
		assert.match(NANOGPT_SMOKE_POLL_REMOTE, /ACCOUNTING_NONTERMINAL_OR_UNKNOWN/);
	});

	it("resets terminal-result grace when SLURM is active or accounting is unknown", async () => {
		const fixtureRoot = join(directory, "slurm-state-transition");
		const commandRoot = join(fixtureRoot, "bin");
		const jobRoot = join(fixtureRoot, "job");
		await mkdir(commandRoot, { recursive: true });
		await mkdir(jobRoot, { recursive: true });
		await writeFile(join(jobRoot, "slurm-job-id"), `${SLURM_JOB_ID}\n`, "utf8");
		const marker = join(jobRoot, "terminal-result-visibility-grace");
		const squeue = join(commandRoot, "squeue");
		const sacct = join(commandRoot, "sacct");
		await writeFile(squeue, "#!/bin/sh\nprintf 'RUNNING\\n'\n", "utf8");
		await writeFile(sacct, "#!/bin/sh\nexit 0\n", "utf8");
		await chmod(squeue, 0o700);
		await chmod(sacct, 0o700);
		await writeFile(marker, "0\n", "utf8");
		const active = await new Promise<CommandResult>((done) => {
			execFile(
				"python3",
				["-c", NANOGPT_SMOKE_POLL_REMOTE, jobRoot, "0.001"],
				{ encoding: "utf8", env: { PATH: `${commandRoot}:/usr/bin:/bin` } },
				(error, stdout, stderr) =>
					done({
						exitCode: error && typeof error.code === "number" ? error.code : error ? null : 0,
						stdout,
						stderr,
					}),
			);
		});
		assert.equal(active.exitCode, 0, active.stderr);
		assert.match(active.stdout, /"schedulerState": "RUNNING"/);
		await assert.rejects(readFile(marker, "utf8"), /ENOENT/);

		await writeFile(squeue, "#!/bin/sh\nexit 0\n", "utf8");
		await writeFile(sacct, "#!/bin/sh\nprintf 'FUTURE_STATE|0:0\\n'\n", "utf8");
		await writeFile(marker, "0\n", "utf8");
		const unknown = await new Promise<CommandResult>((done) => {
			execFile(
				"python3",
				["-c", NANOGPT_SMOKE_POLL_REMOTE, jobRoot, "0.001"],
				{ encoding: "utf8", env: { PATH: `${commandRoot}:/usr/bin:/bin` } },
				(error, stdout, stderr) =>
					done({
						exitCode: error && typeof error.code === "number" ? error.code : error ? null : 0,
						stdout,
						stderr,
					}),
			);
		});
		assert.equal(unknown.exitCode, 0, unknown.stderr);
		assert.match(unknown.stdout, /ACCOUNTING_NONTERMINAL_OR_UNKNOWN:FUTURE_STATE\|0:0/);
		await assert.rejects(readFile(marker, "utf8"), /ENOENT/);
	});

	it("rejects environment drift and recovers a result at the terminal and timeout boundaries", async () => {
		const driftTransport = new FauxTransport(readinessResult(datasetManifest, "changed"), false);
		await assert.rejects(
			submitNanoGptFarmShareStockSmoke({
				outputDir: join(directory, "environment-drift"),
				config,
				transport: driftTransport,
			}),
			/environment evidence changed/,
		);
		assert.deepEqual(driftTransport.events, ["readiness"]);

		const lateOutput = join(directory, "late-terminal-result");
		const lateTransport = new FauxTransport(readinessResult(datasetManifest), false);
		const lateSubmission = await submitNanoGptFarmShareStockSmoke({
			outputDir: lateOutput,
			config,
			transport: lateTransport,
		});
		let existingReads = 0;
		lateTransport.readExistingResult = async () => {
			existingReads++;
			if (existingReads === 1) return null;
			assert.ok(lateTransport.assets);
			return {
				rawResult: successfulWorkerResult(lateTransport.assets),
				log: "late complete",
				slurmJobId: SLURM_JOB_ID,
			};
		};
		lateTransport.poll = async () => ({ kind: "failed", reason: "terminal race", log: "" });
		const late = await reconcileNanoGptFarmShareStockSmoke({
			submission: lateSubmission,
			config,
			transport: lateTransport,
		});
		assert.equal(late.status, "completed");
		if (late.status !== "completed") assert.fail("expected late completed result");
		assert.equal(late.result.ok, true);

		const timeoutOutput = join(directory, "transient-timeout");
		const timeoutTransport = new FauxTransport(readinessResult(datasetManifest), false);
		const timeoutSubmission = await submitNanoGptFarmShareStockSmoke({
			outputDir: timeoutOutput,
			config,
			transport: timeoutTransport,
		});
		timeoutTransport.readExistingResult = async () => {
			throw new KernelBenchTransientTransportError("fixture transport outage");
		};
		const timeoutConfig = { ...config, pollIntervalMs: 1, requestTimeoutMs: 1 };
		const timedOut = await reconcileNanoGptFarmShareStockSmoke({
			submission: timeoutSubmission,
			config: timeoutConfig,
			transport: timeoutTransport,
			wait: true,
		});
		assert.equal(timedOut.status, "completed");
		if (timedOut.status !== "completed") assert.fail("expected timeout completion");
		assert.equal(timedOut.result.ok, false);
		assert.match(timedOut.result.controllerFailure ?? "", /cancellation verified/);
		assert.ok(timeoutTransport.events.includes("cancel"));
	});

	it("always cancels after a timeout-boundary read error", async () => {
		const outputDir = join(directory, "timeout-boundary-read-error");
		const transport = new FauxTransport(readinessResult(datasetManifest), false);
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport });
		let reads = 0;
		transport.readExistingResult = async () => {
			reads++;
			if (reads === 2) throw new Error("plain boundary read failure");
			return null;
		};
		transport.poll = async () => {
			await new Promise((done) => setTimeout(done, 5));
			return { kind: "pending", schedulerState: "RUNNING" };
		};
		const timeoutConfig = {
			...config,
			pollIntervalMs: 1,
			requestTimeoutMs: 1,
			resultVisibilityGraceMs: 2,
		};
		const reconciled = await reconcileNanoGptFarmShareStockSmoke({
			submission,
			config: timeoutConfig,
			transport,
			wait: true,
		});
		assert.equal(reconciled.status, "completed");
		if (reconciled.status !== "completed") assert.fail("expected timeout completion");
		assert.equal(reconciled.result.ok, false);
		assert.match(reconciled.result.controllerFailure ?? "", /timeout-boundary result read unavailable/);
		assert.match(reconciled.result.controllerFailure ?? "", /plain boundary read failure/);
		assert.ok(transport.events.includes("cancel"));
	});

	it("accepts delayed immutable evidence during the bounded post-cancellation grace", async () => {
		const outputDir = join(directory, "post-cancel-result-grace");
		const transport = new FauxTransport(readinessResult(datasetManifest), false);
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport });
		assert.ok(transport.assets);
		let cancelled = false;
		let cancellationAttempts = 0;
		let postCancelReads = 0;
		transport.readExistingResult = async () => {
			if (!cancelled) throw new KernelBenchTransientTransportError("pre-cancel transport lag");
			postCancelReads++;
			if (postCancelReads < 3) return null;
			return {
				rawResult: successfulWorkerResult(transport.assets as NanoGptSmokePreparedAssets),
				log: "visible after cancellation",
				slurmJobId: SLURM_JOB_ID,
			};
		};
		transport.cancelAndVerify = async () => {
			transport.events.push("cancel");
			cancellationAttempts++;
			if (cancellationAttempts === 1) {
				throw new KernelBenchTransientTransportError("transient cancellation transport lag");
			}
			cancelled = true;
			return "CANCELLED|fixture";
		};
		const timeoutConfig = {
			...config,
			pollIntervalMs: 1,
			requestTimeoutMs: 1,
			resultVisibilityGraceMs: 20,
		};
		const reconciled = await reconcileNanoGptFarmShareStockSmoke({
			submission,
			config: timeoutConfig,
			transport,
			wait: true,
		});
		assert.equal(reconciled.status, "completed");
		if (reconciled.status !== "completed") assert.fail("expected delayed result completion");
		assert.equal(reconciled.result.ok, true);
		assert.equal(reconciled.result.recoveredRemoteResult, true);
		assert.equal(cancellationAttempts, 2);
		assert.equal(postCancelReads, 3);
		assert.ok(transport.events.includes("cancel"));
	});

	it("rejects G1 evidence with any score eligibility or a changed fixed stock relationship", async () => {
		const outputDir = join(directory, "parser-boundary");
		const transport = new FauxTransport(readinessResult(datasetManifest), false);
		const submission = await submitNanoGptFarmShareStockSmoke({ outputDir, config, transport });
		assert.ok(transport.assets);
		const valid = JSON.parse(successfulWorkerResult(transport.assets)) as Record<string, unknown>;
		const extraction = valid.gateExtraction as { metrics: Record<string, unknown> };
		extraction.metrics = { ...extraction.metrics, scoredEligible: true };
		assert.throws(
			() =>
				parseNanoGptFarmShareWorkerResult(JSON.stringify(valid), {
					jobKey: submission.jobKey,
					requestSha256: submission.requestSha256,
					executionSeal: submission.executionSeal,
					slurmJobId: submission.slurmJobId,
				}),
			/scoredEligible|schema validation|G1 result/,
		);

		const changedAfterRun = JSON.parse(successfulWorkerResult(transport.assets)) as Record<string, unknown>;
		const integrity = changedAfterRun.integrityEvidence as {
			postRun: Record<string, unknown>;
		};
		integrity.postRun = { ...integrity.postRun, stagedInputs: { changed: true } };
		assert.throws(
			() =>
				parseNanoGptFarmShareWorkerResult(JSON.stringify(changedAfterRun), {
					jobKey: submission.jobKey,
					requestSha256: submission.requestSha256,
					executionSeal: submission.executionSeal,
					slurmJobId: submission.slurmJobId,
				}),
			/pre-run and post-run integrity evidence/,
		);

		const coherentlyChangedAssets = JSON.parse(successfulWorkerResult(transport.assets)) as Record<string, unknown>;
		const coherentIntegrity = coherentlyChangedAssets.integrityEvidence as Record<string, unknown>;
		for (const phase of ["preRun", "postRun"] as const) {
			const snapshot = coherentIntegrity[phase] as Record<string, unknown>;
			const fileSet = snapshot.jobAssets as { files: Record<string, unknown>[]; sha256: string };
			const wrapperIndex = fileSet.files.findIndex((file) => file.path === "isolated-python");
			assert.notEqual(wrapperIndex, -1);
			fileSet.files[wrapperIndex] = { ...fileSet.files[wrapperIndex], sha256: "a".repeat(64) };
			fileSet.sha256 = sha256Json(fileSet.files);
			coherentIntegrity[`${phase}Sha256`] = sha256Json(snapshot);
		}
		assert.throws(
			() =>
				parseNanoGptFarmShareWorkerResult(JSON.stringify(coherentlyChangedAssets), {
					jobKey: submission.jobKey,
					requestSha256: submission.requestSha256,
					executionSeal: submission.executionSeal,
					slurmJobId: submission.slurmJobId,
				}),
			/exact sealed asset contract/,
		);

		const coherentlyChangedLaunch = JSON.parse(successfulWorkerResult(transport.assets)) as Record<string, unknown>;
		const launchIntegrity = coherentlyChangedLaunch.integrityEvidence as Record<string, unknown>;
		for (const phase of ["preRun", "postRun"] as const) {
			const snapshot = launchIntegrity[phase] as Record<string, unknown>;
			const launch = snapshot.launchEnvironment as Record<string, unknown>;
			launch.HOME = "/tmp/forged-home";
			launchIntegrity[`${phase}Sha256`] = sha256Json(snapshot);
		}
		assert.throws(
			() =>
				parseNanoGptFarmShareWorkerResult(JSON.stringify(coherentlyChangedLaunch), {
					jobKey: submission.jobKey,
					requestSha256: submission.requestSha256,
					executionSeal: submission.executionSeal,
					slurmJobId: submission.slurmJobId,
				}),
			/launchEnvironment.HOME changed/,
		);

		const changedVerification = JSON.parse(successfulWorkerResult(transport.assets)) as Record<string, unknown>;
		const verification = changedVerification.gateVerification as Record<string, unknown>;
		verification.manifestSha256 = "b".repeat(64);
		assert.throws(
			() =>
				parseNanoGptFarmShareWorkerResult(JSON.stringify(changedVerification), {
					jobKey: submission.jobKey,
					requestSha256: submission.requestSha256,
					executionSeal: submission.executionSeal,
					slurmJobId: submission.slurmJobId,
				}),
			/cross-bound to the execution seal/,
		);
	});
});

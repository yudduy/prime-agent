import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "../src/compiler-gym-adapter.js";
import {
	COMPILER_GYM_JOB_STEP_C1_FIXTURE,
	COMPILER_GYM_JOB_STEP_C1_TASKS,
} from "../src/compiler-gym-job-step-c1-fixture.js";
import {
	analyzeCompilerGymJobStepQualification,
	COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS,
	COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS,
	COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
	COMPILER_GYM_JOB_STEP_REFERENCE_OVERHEAD_CEILING_NS,
	COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL,
	COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL,
	type CompilerGymJobStepClock,
	CompilerGymJobStepQualificationFailure,
	type CompilerGymJobStepQualificationObservation,
	CompilerGymJobStepQualificationRunner,
	type CompilerGymJobStepResultRecord,
	type CompilerGymJobStepRunHooks,
	compilerGymJobStepRootIdentity,
	compilerGymJobStepRootScript,
	compilerGymJobStepSbatchArgv,
	compilerGymJobStepSrunArgv,
	DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
	parseCompilerGymJobStepAccounting,
	parseCompilerGymJobStepAccountingRows,
	parseCompilerGymJobStepResults,
	validateCompilerGymJobStepInventory,
} from "../src/compiler-gym-job-step-qualification.js";
import {
	COMPILER_GYM_JOB_STEP_RUNTIME_PATHS,
	loadSealedCompilerGymJobStepQualification,
	type PersistedCompilerGymJobStepFailureEvidence,
	type PersistedCompilerGymJobStepFailureManifest,
	parseCompilerGymJobStepSealedCommand,
	persistSealedCompilerGymJobStepFailure,
	verifyCompilerGymJobStepRuntimeFiles,
} from "../src/compiler-gym-job-step-qualification-sealed.js";
import {
	buildCompilerGymJobStepSourceBootstrap,
	COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL,
	type CompilerGymJobStepSourceBootstrap,
} from "../src/compiler-gym-job-step-source-bootstrap.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
	CompilerGymWarmRemoteFileSystem,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "../src/ledger.js";
import type { TaskMeasurement } from "../src/types.js";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const V2_PREREGISTRATION_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/compiler-gym-job-step-qualification/preregistration-v2.json",
);
const V2_RUNTIME_MANIFEST_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v2.json",
);
const HASH_A = "a".repeat(64);
const ROOT_ID = "424242";
const STEP_ID = "0";
const HOSTNAME = "barley-01";
const FIXTURE_QUALIFICATION_ID = "fixture-v1";
const FIXTURE_IDENTITY = compilerGymJobStepRootIdentity(FIXTURE_QUALIFICATION_ID);
const JOB_NAME = FIXTURE_IDENTITY.jobName;
const CANDIDATE_JOB_NAME = FIXTURE_IDENTITY.candidateJobName;
const EXPECTED_WORKER_SHA256 = sha256Text(
	await readFile(fileURLToPath(new URL("../evaluators/compiler_gym_job_step_worker.py", import.meta.url)), "utf8"),
);
const FIXTURE_SOURCE_BOOTSTRAP: CompilerGymJobStepSourceBootstrap = {
	protocol: COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL,
	pythonSource: "pass\n",
	pythonSourceSha256: sha256Text("pass\n"),
	workerSourceBytes: 1,
	evaluatorSourceBytes: 1,
};

function result(rank: 0 | 1, childWallNs: bigint): CompilerGymJobStepResultRecord {
	const childStartedNs = 1_000_000_000n + BigInt(rank) * 100n;
	const childFinishedNs = childStartedNs + childWallNs;
	const wrapperStartedNs = childStartedNs - 10n;
	const wrapperFinishedNs = childFinishedNs + 10n;
	return {
		protocol: COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL,
		rootJobId: ROOT_ID,
		stepId: STEP_ID,
		rank,
		benchmarkId: COMPILER_GYM_JOB_STEP_C1_TASKS[rank],
		requestFileSha256: HASH_A,
		requestSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256,
		workerSha256: HASH_A,
		evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		childExitCode: 0,
		stdout: "{}\n",
		stderr: "",
		childStartedNs: childStartedNs.toString(),
		childFinishedNs: childFinishedNs.toString(),
		childWallNs: childWallNs.toString(),
		hostname: HOSTNAME,
		startedAt: "2026-08-28T00:00:00.000Z",
		completedAt: "2026-08-28T00:00:01.000Z",
		wrapperStartedNs: wrapperStartedNs.toString(),
		wrapperFinishedNs: wrapperFinishedNs.toString(),
		wrapperWallNs: (wrapperFinishedNs - wrapperStartedNs).toString(),
	};
}

function task(rank: 0 | 1): TaskMeasurement {
	const expected = COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks[rank];
	return {
		benchmarkId: expected.benchmarkId,
		status: "accepted",
		metrics: {
			IrInstructionCount: expected.irInstructionCount,
			ObjectTextSizeBytes: expected.objectTextSizeBytes,
		},
		verifier: {
			passed: true,
			checks: [
				"farmshare-environment-seal-v2",
				"pinned-cbench-patch-and-source",
				"pinned-action-space",
				"raw-metrics",
				"20-base-semantic-callbacks",
			],
			errors: [],
		},
		runtimeMs: 1,
	};
}

function observation(overheadNs = 8_000_000_000n): CompilerGymJobStepQualificationObservation {
	const acquisitionStartedNs = 100n;
	const acquisitionDurationNs = 17_000_000_000n;
	const acquisitionReadyNs = acquisitionStartedNs + acquisitionDurationNs;
	const criticalChildNs = 15_000_000_000n;
	const candidateStartedNs = acquisitionReadyNs + 100n;
	const candidateDurationNs = criticalChildNs + overheadNs;
	const candidateFinishedNs = candidateStartedNs + candidateDurationNs;
	const request = {
		protocol: COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL,
		candidateId: "C1" as const,
		requestSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256,
		actionsSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256,
		actions: [...COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions],
		tasks: [...COMPILER_GYM_JOB_STEP_C1_TASKS] as [string, string],
		workerSha256: HASH_A,
		evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		createdAt: "2026-08-28T00:00:00.000Z",
	};
	const requestFileSha256 = sha256Text(`${canonicalJson(toJsonValue(request))}\n`);
	const rank0 = { ...result(0, 3_000_000_000n), requestFileSha256 };
	const rank1 = { ...result(1, criticalChildNs), requestFileSha256 };
	const srunArgv = compilerGymJobStepSrunArgv({
		rootJobId: ROOT_ID,
		candidateJobName: CANDIDATE_JOB_NAME,
		requestPath: `${FIXTURE_IDENTITY.workDir}/request.json`,
		requestFileSha256,
		workerSha256: HASH_A,
		evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		sourceBootstrap: FIXTURE_SOURCE_BOOTSTRAP,
		config: DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
	});
	const rootScript = compilerGymJobStepRootScript();
	const sbatchArgv = compilerGymJobStepSbatchArgv({
		identity: FIXTURE_IDENTITY,
		config: DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
	});
	const stepAccounting = {
		jobIdRaw: `${ROOT_ID}.${STEP_ID}`,
		jobName: CANDIDATE_JOB_NAME,
		state: "COMPLETED",
		exitCode: "0:0",
		allocCpus: 4,
		nTasks: 2,
		elapsedRawSeconds: 15,
		cpuTimeRawSeconds: 60,
		nodeList: HOSTNAME,
		startAt: "2026-08-28T00:00:00",
		endAt: "2026-08-28T00:00:15",
	};
	const rootAccounting = {
		jobIdRaw: ROOT_ID,
		jobName: JOB_NAME,
		state: "CANCELLED",
		exitCode: "0:15",
		allocCpus: 4,
		nTasks: null,
		elapsedRawSeconds: 40,
		cpuTimeRawSeconds: 160,
		nodeList: HOSTNAME,
		startAt: "2026-08-28T00:00:00",
		endAt: "2026-08-28T00:00:40",
	};
	return {
		protocol: COMPILER_GYM_JOB_STEP_QUALIFICATION_PROTOCOL,
		qualificationId: FIXTURE_QUALIFICATION_ID,
		jobName: JOB_NAME,
		workDir: FIXTURE_IDENTITY.workDir,
		identityComment: FIXTURE_IDENTITY.identityComment,
		rootScriptSha256: sha256Text(rootScript),
		rootJobId: ROOT_ID,
		request,
		requestFileSha256,
		workerSha256: HASH_A,
		evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		acquisitionStartedNs: acquisitionStartedNs.toString(),
		acquisitionReadyNs: acquisitionReadyNs.toString(),
		acquisitionDurationNs: acquisitionDurationNs.toString(),
		candidateStartedNs: candidateStartedNs.toString(),
		requestPublishedNs: (candidateStartedNs + 1n).toString(),
		srunStartedNs: (candidateStartedNs + 2n).toString(),
		srunFinishedNs: (candidateFinishedNs - 1n).toString(),
		candidateFinishedNs: candidateFinishedNs.toString(),
		candidateDurationNs: candidateDurationNs.toString(),
		results: [rank0, rank1],
		tasks: [task(0), task(1)],
		stepAccounting,
		stepInventory: [{ ...rootAccounting, state: "RUNNING", exitCode: "0:0", endAt: "Unknown" }, stepAccounting],
		rootAccounting,
		terminalStepInventory: [rootAccounting, stepAccounting],
		cleanup: { schedulerAbsent: true, terminalState: "CANCELLED", matchingRootIds: [ROOT_ID] },
		commands: [
			{
				sequence: 0,
				label: "sbatch-root",
				remoteArgv: sbatchArgv,
				exitCode: 0,
				stdout: `${ROOT_ID}\n`,
				stderr: "",
				wallMs: 1,
				stdoutSha256: sha256Text(`${ROOT_ID}\n`),
				stderrSha256: sha256Text(""),
				inputBytes: Buffer.byteLength(rootScript, "utf8"),
				inputSha256: sha256Text(rootScript),
				capturedAt: "2026-08-28T00:00:00.000Z",
			},
			{
				sequence: 1,
				label: "scontrol-write-batch-script",
				remoteArgv: ["/usr/bin/scontrol", "write", "batch_script", ROOT_ID, "-"],
				exitCode: 0,
				stdout: rootScript,
				stderr: "",
				wallMs: 1,
				stdoutSha256: sha256Text(rootScript),
				stderrSha256: sha256Text(""),
				inputBytes: 0,
				inputSha256: sha256Text(""),
				capturedAt: "2026-08-28T00:00:01.000Z",
			},
			{
				sequence: 2,
				label: "scontrol-release-root",
				remoteArgv: ["/usr/bin/scontrol", "release", ROOT_ID],
				exitCode: 0,
				stdout: "",
				stderr: "",
				wallMs: 1,
				stdoutSha256: sha256Text(""),
				stderrSha256: sha256Text(""),
				inputBytes: 0,
				inputSha256: sha256Text(""),
				capturedAt: "2026-08-28T00:00:02.000Z",
			},
			{
				sequence: 3,
				label: "srun-c1",
				remoteArgv: srunArgv,
				exitCode: 0,
				stdout: "",
				stderr: "",
				wallMs: 1,
				stdoutSha256: sha256Text(""),
				stderrSha256: sha256Text(""),
				inputBytes: 0,
				inputSha256: sha256Text(""),
				capturedAt: "2026-08-28T00:00:03.000Z",
			},
			{
				sequence: 4,
				label: "scancel-root",
				remoteArgv: ["/usr/bin/scancel", "--full", ROOT_ID],
				exitCode: 0,
				stdout: "",
				stderr: "",
				wallMs: 1,
				stdoutSha256: sha256Text(""),
				stderrSha256: sha256Text(""),
				inputBytes: 0,
				inputSha256: sha256Text(""),
				capturedAt: "2026-08-28T00:00:04.000Z",
			},
		],
	};
}

class FauxJobStepRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	readonly files = new Map<string, { content: string; mode: number }>();

	async ensurePrivateDirectory(_path: string, signal: AbortSignal): Promise<void> {
		if (signal.aborted) throw signal.reason;
	}

	async createPrivateDirectory(_path: string, signal: AbortSignal): Promise<void> {
		if (signal.aborted) throw signal.reason;
	}

	async installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		_allowExistingExact: boolean,
		signal: AbortSignal,
	): Promise<void> {
		if (signal.aborted) throw signal.reason;
		assert.equal(sha256Text(content), expectedSha256);
		this.files.set(path, { content, mode });
	}

	async linkImmutableFile(source: string, target: string, expectedSha256: string, signal: AbortSignal): Promise<void> {
		if (signal.aborted) throw signal.reason;
		const file = this.files.get(source);
		assert.ok(file);
		assert.equal(sha256Text(file.content), expectedSha256);
		this.files.set(target, file);
	}

	async readTrustedFile(
		path: string,
		_options: { maxBytes: number; mode: number; expectedSha256?: string },
		signal: AbortSignal,
	): Promise<string> {
		if (signal.aborted) throw signal.reason;
		const file = this.files.get(path);
		assert.ok(file);
		return file.content;
	}

	async exists(path: string, signal: AbortSignal): Promise<boolean> {
		if (signal.aborted) throw signal.reason;
		return this.files.has(path);
	}
}

class FauxJobStepClock implements CompilerGymJobStepClock {
	private elapsedNs = 0n;
	private readonly epochMs = Date.parse("2026-08-28T00:00:00.000Z");

	now(): Date {
		return new Date(this.epochMs + Number(this.elapsedNs / 1_000_000n));
	}

	nowNs(): bigint {
		this.elapsedNs += 1_000_000n;
		return this.elapsedNs;
	}

	async sleep(ms: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) throw signal.reason;
		this.elapsedNs += BigInt(ms) * 1_000_000n;
	}
}

function acceptedEvaluatorOutput(rank: 0 | 1): string {
	const expected = COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks[rank];
	return `${JSON.stringify({
		schema_version: 2,
		contract: COMPILER_GYM_VERIFIER_EPOCH,
		ok: true,
		status: "succeeded",
		benchmark: expected.benchmarkId,
		metrics: {
			final: {
				IrInstructionCount: expected.irInstructionCount,
				ObjectTextSizeBytes: expected.objectTextSizeBytes,
			},
		},
		validation: { passed: true, inputs_completed: 20, semantic_errors: [] },
		timings_seconds: { total: 0.001 },
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
	})}\n`;
}

interface FauxJobStepCommandOptions {
	failSrun?: boolean;
	omitStepAccounting?: boolean;
	lateExtraTerminalStep?: boolean;
	corruptSpooledScript?: boolean;
	spooledScriptStderr?: string;
}

class FauxJobStepCommandRunner implements CompilerGymWarmCommandRunner {
	readonly remoteCommands: string[] = [];
	readonly lifecycle: string[] = [];
	sbatchCalls = 0;
	srunCalls = 0;
	scancelCalls = 0;
	spoolCalls = 0;
	releaseCalls = 0;
	terminalInventoryCalls = 0;
	sbatchInput: string | undefined;
	private cancelled = false;
	private released = false;
	private readonly identity;

	get activeRoot(): boolean {
		return this.sbatchCalls > 0 && !this.cancelled;
	}

	constructor(
		private readonly fileSystem: FauxJobStepRemoteFileSystem,
		qualificationId: string,
		private readonly options: FauxJobStepCommandOptions = {},
	) {
		this.identity = compilerGymJobStepRootIdentity(qualificationId);
	}

	private result(stdout = "", stderr = "", exitCode: number | null = 0): CompilerGymWarmCommandResult {
		return { stdout, stderr, exitCode, wallMs: 1 };
	}

	private get jobName(): string {
		return this.identity.jobName;
	}

	private get workDir(): string {
		return this.identity.workDir;
	}

	private accountingRow(input: {
		jobId: string;
		jobName: string;
		state: string;
		exitCode: string;
		nTasks: number | null;
		elapsed: number;
	}): string {
		return [
			input.jobId,
			input.jobName,
			input.state,
			input.exitCode,
			"4",
			input.nTasks === null ? "" : String(input.nTasks),
			String(input.elapsed),
			String(4 * input.elapsed),
			HOSTNAME,
			"2026-08-28T00:00:00",
			input.state === "RUNNING" ? "Unknown" : "2026-08-28T00:00:15",
		].join("|");
	}

	private stepRow(): string {
		return this.accountingRow({
			jobId: `${ROOT_ID}.${STEP_ID}`,
			jobName: `${this.jobName}-c1`,
			state: "COMPLETED",
			exitCode: "0:0",
			nTasks: 2,
			elapsed: 1,
		});
	}

	private inventory(): string {
		const rootState = this.cancelled ? "CANCELLED" : "RUNNING";
		if (this.cancelled) this.terminalInventoryCalls += 1;
		const rows = [
			this.accountingRow({
				jobId: ROOT_ID,
				jobName: this.jobName,
				state: rootState,
				exitCode: this.cancelled ? "0:15" : "0:0",
				nTasks: null,
				elapsed: 2,
			}),
			this.accountingRow({
				jobId: `${ROOT_ID}.batch`,
				jobName: "batch",
				state: rootState,
				exitCode: this.cancelled ? "0:15" : "0:0",
				nTasks: 1,
				elapsed: 2,
			}),
			this.accountingRow({
				jobId: `${ROOT_ID}.extern`,
				jobName: "extern",
				state: "COMPLETED",
				exitCode: "0:0",
				nTasks: 1,
				elapsed: 2,
			}),
			this.stepRow(),
		];
		if (this.cancelled && this.options.lateExtraTerminalStep && this.terminalInventoryCalls >= 2) {
			rows.push(
				this.accountingRow({
					jobId: `${ROOT_ID}.1`,
					jobName: `${this.jobName}-late`,
					state: "COMPLETED",
					exitCode: "0:0",
					nTasks: 2,
					elapsed: 1,
				}),
			);
		}
		return `${rows.join("\n")}\n`;
	}

	private stepOutput(): string {
		const requestFile = [...this.fileSystem.files.entries()].find(([path]) => path.includes("request-c1-"));
		assert.ok(requestFile);
		const [requestPath, stored] = requestFile;
		const request = JSON.parse(stored.content) as Record<string, unknown>;
		const requestFileSha256 = sha256Text(stored.content);
		const records = ([0, 1] as const).map((rank) => {
			const childStartedNs = 100n + BigInt(rank) * 10n;
			const childFinishedNs = childStartedNs + 1n;
			return {
				protocol: COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL,
				rootJobId: ROOT_ID,
				stepId: STEP_ID,
				rank,
				benchmarkId: COMPILER_GYM_JOB_STEP_C1_TASKS[rank],
				requestFileSha256,
				requestSha256: request.requestSha256,
				workerSha256: request.workerSha256,
				evaluatorSha256: request.evaluatorSha256,
				childExitCode: 0,
				stdout: acceptedEvaluatorOutput(rank),
				stderr: "",
				childStartedNs: childStartedNs.toString(),
				childFinishedNs: childFinishedNs.toString(),
				childWallNs: "1",
				hostname: HOSTNAME,
				startedAt: "2026-08-28T00:00:00.000Z",
				completedAt: "2026-08-28T00:00:01.000Z",
				wrapperStartedNs: (childStartedNs - 1n).toString(),
				wrapperFinishedNs: (childFinishedNs + 1n).toString(),
				wrapperWallNs: "3",
			};
		});
		assert.ok(requestPath.startsWith(this.workDir));
		return `${records.map((record) => `${record.rank}: ${JSON.stringify(record)}`).join("\n")}\n`;
	}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		if (request.signal?.aborted) throw request.signal.reason;
		const remote = request.argv.at(-1) ?? "";
		this.remoteCommands.push(remote);
		if (remote.startsWith("'/usr/bin/sbatch'")) {
			this.sbatchCalls += 1;
			this.sbatchInput = request.input;
			this.lifecycle.push("sbatch");
			return this.result(`${ROOT_ID}\n`);
		}
		if (remote.startsWith("'/usr/bin/srun'")) {
			this.srunCalls += 1;
			this.lifecycle.push("srun");
			assert.equal(this.released, true, "Candidate ran before root release");
			if (this.options.failSrun) throw new Error("faux srun transport failure");
			return this.result(this.stepOutput());
		}
		if (remote.startsWith("'/usr/bin/scancel'")) {
			this.scancelCalls += 1;
			this.lifecycle.push("scancel");
			this.cancelled = true;
			return this.result();
		}
		if (remote.startsWith("'/usr/bin/scontrol'")) {
			if (remote.includes("'write' 'batch_script'")) {
				this.spoolCalls += 1;
				this.lifecycle.push("spool");
				const script = compilerGymJobStepRootScript();
				return this.result(
					this.options.corruptSpooledScript ? `${script}corrupt\n` : script,
					this.options.spooledScriptStderr ?? "",
				);
			}
			if (remote.includes(`'release' '${ROOT_ID}'`)) {
				this.releaseCalls += 1;
				this.lifecycle.push("release");
				this.released = true;
				return this.result();
			}
			this.lifecycle.push(this.released ? "show-running" : "show-held");
			return this.result(
				`${[
					`JobId=${ROOT_ID}`,
					`JobName=${this.jobName}`,
					"UserId=duynguy(1)",
					"Partition=normal",
					"NumNodes=1",
					"NumCPUs=4",
					"NumTasks=2",
					"CPUs/Task=2",
					"MinMemoryNode=8G",
					`WorkDir=${this.workDir}`,
					`Comment=${this.identity.identityComment}`,
					"Requeue=0",
					"BatchFlag=1",
					"Features=CPU_SKU:9384X",
					`Priority=${this.released ? "100" : "0"}`,
					`JobState=${this.released ? "RUNNING" : "PENDING"}`,
					`Reason=${this.released ? "None" : "JobHeldUser"}`,
				].join(" ")}\n`,
			);
		}
		if (remote.startsWith("'/usr/bin/squeue'")) return this.result();
		if (remote.startsWith("'/usr/bin/sacct'")) {
			if (remote.includes(`'${ROOT_ID}.${STEP_ID}'`)) {
				return this.result(this.options.omitStepAccounting ? "" : `${this.stepRow()}\n`);
			}
			if (remote.includes("'-X'") && remote.includes("'--name'")) {
				return this.result(
					this.sbatchCalls === 0
						? ""
						: `${ROOT_ID}|duynguy|${this.jobName}|${this.workDir}|${this.identity.identityComment}|${this.cancelled ? "CANCELLED" : this.released ? "RUNNING" : "PENDING"}|\n`,
				);
			}
			if (remote.includes("'-X'")) {
				return this.result(
					`${this.accountingRow({
						jobId: ROOT_ID,
						jobName: this.jobName,
						state: "CANCELLED",
						exitCode: "0:15",
						nTasks: null,
						elapsed: 2,
					})}\n`,
				);
			}
			return this.result(this.inventory());
		}
		throw new Error(`Unexpected faux remote command: ${remote}`);
	}
}

function lifecycleHooks(
	commandRunner: FauxJobStepCommandRunner,
	qualificationId: string,
	failAt?: "dispatch-intent" | "root-submitted" | "held-verified" | "release-intent" | "root-ready",
): CompilerGymJobStepRunHooks {
	const identity = compilerGymJobStepRootIdentity(qualificationId);
	const rootScriptSha256 = sha256Text(compilerGymJobStepRootScript());
	const fail = (label: typeof failAt): void => {
		if (failAt === label) throw new Error(`faux ${label} hook failure`);
	};
	return {
		async recordDispatchIntent(record) {
			commandRunner.lifecycle.push("dispatch-intent");
			assert.equal(record.qualificationId, qualificationId);
			assert.equal(record.identityComment, identity.identityComment);
			assert.equal(record.rootScriptSha256, rootScriptSha256);
			assert.deepEqual(
				record.sbatchArgv,
				compilerGymJobStepSbatchArgv({ identity, config: DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG }),
			);
			assert.equal(record.sbatchArgvSha256, sha256Json(record.sbatchArgv));
			fail("dispatch-intent");
		},
		async recordRootSubmitted(record) {
			commandRunner.lifecycle.push("root-submitted");
			assert.equal(record.rootJobId, ROOT_ID);
			fail("root-submitted");
		},
		async recordRootHeldVerified(record) {
			commandRunner.lifecycle.push("held-verified");
			assert.equal(record.identityComment, identity.identityComment);
			assert.equal(record.rootScriptSha256, rootScriptSha256);
			assert.equal(record.spooledScriptSha256, rootScriptSha256);
			assert.equal(record.heldState, "PENDING");
			assert.equal(record.heldReason, "JobHeldUser");
			assert.equal(record.batchFlag, 1);
			assert.equal(record.priority, 0);
			fail("held-verified");
		},
		async recordRootReleaseIntent(record) {
			commandRunner.lifecycle.push("release-intent");
			assert.equal(record.identityComment, identity.identityComment);
			fail("release-intent");
		},
		async recordRootReady(record) {
			commandRunner.lifecycle.push("root-ready");
			assert.equal(record.rootJobId, ROOT_ID);
			fail("root-ready");
		},
	};
}

describe("CompilerGym candidate-scoped Slurm-step qualification", () => {
	it("loads the canonical preregistration and byte-pinned runtime without dispatch", async () => {
		const sealed = await loadSealedCompilerGymJobStepQualification();
		assert.equal(sealed.qualificationId, "compiler-gym-job-step-c1-execution-v2");
		assert.equal(sealed.workerSha256, EXPECTED_WORKER_SHA256);
		assert.equal(sealed.preregistrationPath, V2_PREREGISTRATION_PATH);
		assert.equal(sealed.runtimeManifestPath, V2_RUNTIME_MANIFEST_PATH);
		const preregistration = JSON.parse(await readFile(V2_PREREGISTRATION_PATH, "utf8")) as Record<string, unknown>;
		assert.equal(preregistration.protocol, "compiler-gym-job-step-c1-preregistration-v2");
		assert.equal(preregistration.schemaVersion, 2);
		const controls = preregistration.controls as Record<string, Record<string, unknown>>;
		assert.equal(controls.failure?.preflightFailureDisposition, "retryable-pre-dispatch-non-attempt");
		assert.deepEqual(controls.trust, {
			localFilesystem: "trusted-local",
			runtimeClosurePolicy: "freeze-until-execution-and-recovery-terminal",
			staticImportsExecuteBeforeSealVerification: true,
		});
		const runtimeManifest = JSON.parse(await readFile(V2_RUNTIME_MANIFEST_PATH, "utf8")) as {
			files: Array<{ bytes: number; path: string; sha256: string }>;
			protocol: string;
			schemaVersion: number;
		};
		assert.equal(runtimeManifest.protocol, "compiler-gym-job-step-c1-runtime-manifest-v2");
		assert.equal(runtimeManifest.schemaVersion, 2);
		assert.deepEqual(
			runtimeManifest.files.map((file) => file.path),
			[...COMPILER_GYM_JOB_STEP_RUNTIME_PATHS],
		);
		assert.deepEqual(
			runtimeManifest.files.map((file) => file.path),
			runtimeManifest.files.map((file) => file.path).sort(),
		);
		assert.ok(runtimeManifest.files.every((file) => Number.isSafeInteger(file.bytes) && file.bytes >= 0));
		assert.ok(!runtimeManifest.files.some((file) => file.path.endsWith("preregistration-v2.json")));
		assert.ok(!runtimeManifest.files.some((file) => file.path.endsWith("runtime-manifest-v2.json")));
		const supersession = JSON.parse(
			await readFile(
				join(REPOSITORY_ROOT, ".autoresearch/compiler-gym-job-step-qualification/execution-v1-supersession.json"),
				"utf8",
			),
		) as Record<string, unknown>;
		assert.equal(supersession.status, "superseded-before-dispatch");
		assert.equal(supersession.decisionRuleChanged, false);
		assert.deepEqual(Object.keys(supersession.successor as Record<string, unknown>).sort(), [
			"executionOutputPath",
			"preregistrationPath",
			"protocol",
			"qualificationId",
			"runtimeManifestPath",
		]);
		assert.equal(
			sha256Text(
				await readFile(
					join(REPOSITORY_ROOT, ".autoresearch/compiler-gym-job-step-qualification/preregistration-v1.json"),
					"utf8",
				),
			),
			"32a396f1396d49bbd99b0448940356f13499fdd3ce5416ebbf862b56ea4cf0ff",
		);
		assert.equal(
			sha256Text(
				await readFile(
					join(REPOSITORY_ROOT, ".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v1.json"),
					"utf8",
				),
			),
			"ef299b05f24dd612854f1d8813e9173ab907c66b09c2998fd5be96b911e4b071",
		);
	});

	it("fails closed on runtime-closure tampering without touching the worktree", async () => {
		const runtimeManifest = JSON.parse(await readFile(V2_RUNTIME_MANIFEST_PATH, "utf8")) as {
			files: unknown;
		};
		for (const target of [
			"research/autoresearch/src/compiler-gym-job-step-cleanup-recovery.ts",
			"research/autoresearch/src/compiler-gym-job-step-source-bootstrap.ts",
			".autoresearch/compiler-gym-job-step-qualification/execution-v1-supersession.json",
		]) {
			await assert.rejects(
				() =>
					verifyCompilerGymJobStepRuntimeFiles(runtimeManifest.files, {
						async readBytes(absolutePath, repositoryRelativePath) {
							const payload = await readFile(absolutePath);
							return repositoryRelativePath === target
								? Buffer.concat([payload, Buffer.from("tamper")])
								: payload;
						},
					}),
				/Sealed runtime file (?:byte length )?drifted/,
			);
		}
	});

	it("requires an explicit sealed CLI mode and exposes non-live package routes", async () => {
		assert.equal(parseCompilerGymJobStepSealedCommand(["--verify-seal"]), "verify-seal");
		assert.equal(parseCompilerGymJobStepSealedCommand(["--dispatch"]), "dispatch");
		assert.equal(parseCompilerGymJobStepSealedCommand(["--recover"]), "recover");
		assert.throws(() => parseCompilerGymJobStepSealedCommand([]), /Usage:/);
		assert.throws(() => parseCompilerGymJobStepSealedCommand(["--dispatch", "--recover"]), /Usage:/);
		const sidecarPackage = JSON.parse(
			await readFile(join(REPOSITORY_ROOT, "research/autoresearch/package.json"), "utf8"),
		) as { scripts: Record<string, string> };
		assert.match(sidecarPackage.scripts["job-step:verify-seal"], /--verify-seal$/);
		assert.match(sidecarPackage.scripts["job-step:qualify-sealed"], /--dispatch$/);
		assert.match(sidecarPackage.scripts["job-step:recover-sealed"], /--recover$/);
	});

	it("refuses a symlinked preregistration leaf before parsing", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-seal-symlink-"));
		try {
			const linkPath = join(root, "preregistration-v2.json");
			await symlink(V2_PREREGISTRATION_PATH, linkPath);
			await assert.rejects(
				() => loadSealedCompilerGymJobStepQualification(linkPath, V2_RUNTIME_MANIFEST_PATH),
				(error: unknown) => (error as NodeJS.ErrnoException).code === "ELOOP",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("builds deterministic exact identity, root source, and pathless held sbatch argv", () => {
		const identity = compilerGymJobStepRootIdentity(FIXTURE_QUALIFICATION_ID);
		assert.deepEqual(identity, compilerGymJobStepRootIdentity(FIXTURE_QUALIFICATION_ID));
		assert.equal(compilerGymJobStepRootScript(), compilerGymJobStepRootScript());
		const argv = compilerGymJobStepSbatchArgv({
			identity,
			config: DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
		});
		assert.ok(argv.includes("--hold"));
		assert.ok(argv.includes(`--comment=${identity.identityComment}`));
		assert.ok(
			argv.slice(1).every((argument) => argument.startsWith("--")),
			"sbatch argv contains a script path",
		);
	});

	it("uses the exact dynamic projection and keeps the historical cap descriptive", () => {
		const analysis = analyzeCompilerGymJobStepQualification(observation());
		const expectedProjection =
			17_000_000_000n + 4n * 8_000_000_000n + COMPILER_GYM_JOB_STEP_CHILD_CRITICAL_REFERENCE_NS;
		assert.equal(analysis.projectedFourCallTotalNs, expectedProjection.toString());
		assert.equal(analysis.referenceOverheadCeilingNs, COMPILER_GYM_JOB_STEP_REFERENCE_OVERHEAD_CEILING_NS.toString());
		assert.equal(
			analysis.strongLatencyGatePassed,
			10n * expectedProjection <= 9n * COMPILER_GYM_JOB_STEP_COLD_REFERENCE_NS,
		);
		assert.equal(analysis.decision, "qualify-c1-c4-screen");
		assert.equal(
			analyzeCompilerGymJobStepQualification(observation(12_000_000_000n)).decision,
			"kill-job-step-transport",
		);
	});

	it("renders one exact two-rank step without overlap, exclusivity, or an explicit CPU-binding treatment", () => {
		const argv = observation().commands.find((command) => command.label === "srun-c1")?.remoteArgv ?? [];
		assert.deepEqual(argv.slice(0, 10), [
			"/usr/bin/srun",
			`--jobid=${ROOT_ID}`,
			"--nodes=1",
			"--ntasks=2",
			"--cpus-per-task=2",
			"--exact",
			"--kill-on-bad-exit=1",
			"--label",
			"--export=NONE",
			`--job-name=${CANDIDATE_JOB_NAME}`,
		]);
		assert.equal(
			argv.filter((argument) => argument === "/usr/bin/srun").length,
			1,
			"srun argv must contain exactly one executable",
		);
		assert.ok(argv.includes(`--jobid=${ROOT_ID}`));
		assert.ok(argv.includes("--ntasks=2"));
		assert.ok(argv.includes("--cpus-per-task=2"));
		assert.ok(argv.includes("--exact"));
		assert.ok(!argv.some((argument) => argument.startsWith("--overlap")));
		assert.ok(!argv.some((argument) => argument.startsWith("--exclusive")));
		assert.ok(!argv.some((argument) => argument.startsWith("--cpu-bind")));
		assert.equal(
			argv.join(" ").match(/SLURM_PROCID="\$SLURM_PROCID"/g)?.length,
			1,
			"Rank environment must forward SLURM_PROCID exactly once",
		);
	});

	it("binds nondeterministic labelled output by rank and rejects cross-step results", () => {
		const fixture = observation();
		const lines = [fixture.results[1], fixture.results[0]].map(
			(record) => `${record.rank}: ${JSON.stringify(record)}`,
		);
		const parsed = parseCompilerGymJobStepResults(`${lines.join("\n")}\n`, {
			rootJobId: ROOT_ID,
			requestFileSha256: fixture.requestFileSha256,
			requestSha256: fixture.request.requestSha256,
			workerSha256: fixture.workerSha256,
			evaluatorSha256: fixture.evaluatorSha256,
		});
		assert.deepEqual(
			parsed.map((record) => record.rank),
			[0, 1],
		);
		const drifted = { ...fixture.results[1], stepId: "1" };
		assert.throws(
			() =>
				parseCompilerGymJobStepResults(
					`0: ${JSON.stringify(fixture.results[0])}\n1: ${JSON.stringify(drifted)}\n`,
					{
						rootJobId: ROOT_ID,
						requestFileSha256: fixture.requestFileSha256,
						requestSha256: fixture.request.requestSha256,
						workerSha256: fixture.workerSha256,
						evaluatorSha256: fixture.evaluatorSha256,
					},
				),
			/Ranks ran in different Slurm steps/,
		);
	});

	it("parses exact root and dotted-step accounting identities", () => {
		const step = parseCompilerGymJobStepAccounting(
			`${ROOT_ID}.${STEP_ID}|${CANDIDATE_JOB_NAME}|COMPLETED|0:0|4|2|15|60|${HOSTNAME}|2026-08-28T00:00:00|2026-08-28T00:00:15\n`,
			{ jobIdRaw: `${ROOT_ID}.${STEP_ID}`, jobName: CANDIDATE_JOB_NAME, allocCpus: 4, nTasks: 2 },
		);
		assert.equal(step.state, "COMPLETED");
		const root = parseCompilerGymJobStepAccounting(
			`${ROOT_ID}|${JOB_NAME}|CANCELLED by 1|0:15|4||40|160|${HOSTNAME}|2026-08-28T00:00:00|2026-08-28T00:00:40\n`,
			{ jobIdRaw: ROOT_ID, jobName: JOB_NAME, allocCpus: 4, nTasks: null },
		);
		assert.equal(root.state, "CANCELLED");
		const inventory = parseCompilerGymJobStepAccountingRows(
			[
				`${ROOT_ID}|${JOB_NAME}|RUNNING|0:0|4||20|80|${HOSTNAME}|2026-08-28T00:00:00|Unknown`,
				`${ROOT_ID}.batch|batch|RUNNING|0:0|4|1|20|80|${HOSTNAME}|2026-08-28T00:00:00|Unknown`,
				`${ROOT_ID}.extern|extern|RUNNING|0:0|4|1|20|80|${HOSTNAME}|2026-08-28T00:00:00|Unknown`,
				`${ROOT_ID}.${STEP_ID}|${CANDIDATE_JOB_NAME}|COMPLETED|0:0|4|2|15|60|${HOSTNAME}|2026-08-28T00:00:00|2026-08-28T00:00:15`,
			].join("\n"),
		);
		validateCompilerGymJobStepInventory(inventory, {
			rootJobId: ROOT_ID,
			rootJobName: JOB_NAME,
			rootState: "RUNNING",
			stepId: STEP_ID,
			stepJobName: CANDIDATE_JOB_NAME,
			hostname: HOSTNAME,
		});
		const unexpectedStep = {
			...inventory.at(-1)!,
			jobIdRaw: `${ROOT_ID}.1`,
		};
		assert.throws(
			() =>
				validateCompilerGymJobStepInventory([...inventory, unexpectedStep], {
					rootJobId: ROOT_ID,
					rootJobName: JOB_NAME,
					rootState: "RUNNING",
					stepId: STEP_ID,
					stepJobName: CANDIDATE_JOB_NAME,
					hostname: HOSTNAME,
				}),
			/Unexpected accounting step/,
		);
	});

	it("holds, proves, releases, and cleans one stdin-spooled root in durable lifecycle order", async () => {
		const qualificationId = "faux-job-step-success-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId);
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			commandRunner,
			remoteFileSystem: fileSystem,
			clock: new FauxJobStepClock(),
			expectedWorkerSha256: EXPECTED_WORKER_SHA256,
		});
		const result = await runner.run(
			qualificationId,
			new AbortController().signal,
			lifecycleHooks(commandRunner, qualificationId),
		);
		assert.equal(analyzeCompilerGymJobStepQualification(result).integrityPassed, true);
		assert.equal(commandRunner.sbatchCalls, 1);
		assert.equal(commandRunner.spoolCalls, 1);
		assert.equal(commandRunner.releaseCalls, 1);
		assert.equal(commandRunner.srunCalls, 1);
		assert.equal(commandRunner.scancelCalls, 1);
		assert.equal(commandRunner.sbatchInput, compilerGymJobStepRootScript());
		assert.deepEqual(commandRunner.lifecycle.slice(0, 11), [
			"dispatch-intent",
			"sbatch",
			"root-submitted",
			"show-held",
			"spool",
			"held-verified",
			"release-intent",
			"release",
			"show-running",
			"root-ready",
			"srun",
		]);
		assert.deepEqual(
			[...fileSystem.files.values()].map((file) => file.mode),
			[0o600],
			"Only the immutable request record may be installed remotely",
		);
		assert.ok(!commandRunner.remoteCommands.some((command) => command.includes("job-step-worker-")));
		assert.ok(!commandRunner.remoteCommands.some((command) => command.includes("compiler-gym-evaluator-")));
		assert.ok(commandRunner.remoteCommands.some((command) => command.includes("%k")));
		assert.ok(commandRunner.remoteCommands.some((command) => command.includes("Comment")));
		assert.ok(!commandRunner.remoteCommands.some((command) => command.includes("Command=")));
		const sbatchEvidence = result.commands.find((command) => command.label === "sbatch-root");
		assert.ok(sbatchEvidence);
		assert.ok(sbatchEvidence.remoteArgv.includes("--hold"));
		assert.ok(sbatchEvidence.remoteArgv.includes(`--comment=${result.identityComment}`));
		assert.equal(sbatchEvidence.inputBytes, Buffer.byteLength(compilerGymJobStepRootScript(), "utf8"));
		assert.equal(sbatchEvidence.inputSha256, sha256Text(compilerGymJobStepRootScript()));
		assert.equal(commandRunner.terminalInventoryCalls, 6);
		assert.deepEqual(result.cleanup.matchingRootIds, [ROOT_ID]);
		assert.equal(result.terminalStepInventory.filter((row) => /^424242\.[0-9]+$/.test(row.jobIdRaw)).length, 1);
	});

	it("blocks release when held batch-script readback differs and still cleans exactly once", async () => {
		const qualificationId = "faux-job-step-corrupt-spool-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId, {
			corruptSpooledScript: true,
		});
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			commandRunner,
			remoteFileSystem: fileSystem,
			expectedWorkerSha256: EXPECTED_WORKER_SHA256,
		});
		await assert.rejects(
			() =>
				runner.run(qualificationId, new AbortController().signal, lifecycleHooks(commandRunner, qualificationId)),
			/Spooled root script bytes differ from submitted stdin/,
		);
		assert.equal(commandRunner.sbatchCalls, 1);
		assert.equal(commandRunner.spoolCalls, 1);
		assert.equal(commandRunner.releaseCalls, 0);
		assert.equal(commandRunner.srunCalls, 0);
		assert.equal(commandRunner.scancelCalls, 1);
	});

	it("blocks release when exact held batch-script readback emits stderr and still cleans exactly once", async () => {
		const qualificationId = "faux-job-step-spool-stderr-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId, {
			spooledScriptStderr: "warning\n",
		});
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			commandRunner,
			remoteFileSystem: fileSystem,
			expectedWorkerSha256: EXPECTED_WORKER_SHA256,
		});
		await assert.rejects(
			() =>
				runner.run(qualificationId, new AbortController().signal, lifecycleHooks(commandRunner, qualificationId)),
			/Batch-script verification emitted stderr/,
		);
		assert.equal(commandRunner.sbatchCalls, 1);
		assert.equal(commandRunner.spoolCalls, 1);
		assert.equal(commandRunner.releaseCalls, 0);
		assert.equal(commandRunner.srunCalls, 0);
		assert.equal(commandRunner.scancelCalls, 1);
		assert.equal(commandRunner.activeRoot, false);
	});

	it("cleans a held root without retry when a durable lifecycle hook fails", async () => {
		const qualificationId = "faux-job-step-hook-failure-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId);
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			commandRunner,
			remoteFileSystem: fileSystem,
			expectedWorkerSha256: EXPECTED_WORKER_SHA256,
		});
		await assert.rejects(
			() =>
				runner.run(
					qualificationId,
					new AbortController().signal,
					lifecycleHooks(commandRunner, qualificationId, "release-intent"),
				),
			/faux release-intent hook failure/,
		);
		assert.equal(commandRunner.sbatchCalls, 1);
		assert.equal(commandRunner.spoolCalls, 1);
		assert.equal(commandRunner.releaseCalls, 0);
		assert.equal(commandRunner.srunCalls, 0);
		assert.equal(commandRunner.scancelCalls, 1);
	});

	it("blocks dispatch when the locally read worker differs from the preregistered hash", async () => {
		const qualificationId = "faux-job-step-worker-drift-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId);
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			commandRunner,
			remoteFileSystem: fileSystem,
			expectedWorkerSha256: HASH_A,
		});
		await assert.rejects(
			() =>
				runner.run(qualificationId, new AbortController().signal, lifecycleHooks(commandRunner, qualificationId)),
			/Worker source drifted after preregistered verification/,
		);
		assert.equal(commandRunner.sbatchCalls, 0);
		assert.equal(commandRunner.scancelCalls, 0);
	});

	it("rejects an extra numbered step that appears during terminal inventory stabilization", async () => {
		const qualificationId = "faux-job-step-late-extra-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId, {
			lateExtraTerminalStep: true,
		});
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			commandRunner,
			remoteFileSystem: fileSystem,
			clock: new FauxJobStepClock(),
			expectedWorkerSha256: EXPECTED_WORKER_SHA256,
		});
		await assert.rejects(
			() =>
				runner.run(qualificationId, new AbortController().signal, lifecycleHooks(commandRunner, qualificationId)),
			/Unexpected accounting step 424242\.1/,
		);
		assert.equal(commandRunner.sbatchCalls, 1);
		assert.equal(commandRunner.srunCalls, 1);
		assert.equal(commandRunner.scancelCalls, 1);
		assert.equal(commandRunner.terminalInventoryCalls, 2);
	});

	it("does not retry a failed candidate dispatch and still cancels the exact root", async () => {
		const qualificationId = "faux-job-step-failure-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId, { failSrun: true });
		const runner = new CompilerGymJobStepQualificationRunner(DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG, {
			commandRunner,
			remoteFileSystem: fileSystem,
			expectedWorkerSha256: EXPECTED_WORKER_SHA256,
		});
		let failure: CompilerGymJobStepQualificationFailure | undefined;
		try {
			await runner.run(
				qualificationId,
				new AbortController().signal,
				lifecycleHooks(commandRunner, qualificationId),
			);
		} catch (error) {
			assert.ok(error instanceof CompilerGymJobStepQualificationFailure);
			failure = error;
		}
		assert.ok(failure);
		assert.match(failure.message, /faux srun transport failure/);
		assert.equal(commandRunner.sbatchCalls, 1);
		assert.equal(commandRunner.srunCalls, 1);
		assert.equal(commandRunner.scancelCalls, 1);
		assert.equal(commandRunner.activeRoot, false);
		assert.equal(failure.evidence.rootJobId, ROOT_ID);
		assert.equal(failure.evidence.cleanupAttempts.length, 1);
		assert.equal(failure.evidence.cleanupAttempts[0].accounting?.state, "CANCELLED");
		assert.equal(failure.evidence.cleanupAttempts[0].schedulerAbsent, true);
		assert.deepEqual(failure.evidence.cleanupAttempts[0].matchingRootIds, [ROOT_ID]);
		const failedDispatch = failure.evidence.commands.find((command) => command.label === "srun-c1");
		assert.ok(failedDispatch);
		assert.equal(failedDispatch.exitCode, null);
		assert.match(failedDispatch.transportError ?? "", /faux srun transport failure/);
		assert.equal(failure.evidence.commands.filter((command) => command.label === "scancel-root").length, 1);

		const outputDir = await mkdtemp(join(tmpdir(), "prime-job-step-failure-"));
		try {
			const ledger = await EvidenceLedger.open(join(outputDir, "evidence.jsonl"));
			await ledger.append("run_manifest", {
				protocol: "compiler-gym-job-step-c1-execution-v2",
				phase: "started",
			});
			const persisted = await persistSealedCompilerGymJobStepFailure({
				outputDir,
				qualificationId,
				startedAt: "2026-08-28T00:00:00.000Z",
				preregistrationPath: ".autoresearch/compiler-gym-job-step-qualification/preregistration-v2.json",
				preregistrationSha256: HASH_A,
				runtimeManifestPath: ".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v2.json",
				runtimeManifestSha256: HASH_A,
				dispatchPreflight: null,
				ledger,
				error: failure,
			});
			const failureEvidenceContents = await readFile(join(outputDir, "failure-evidence.json"), "utf8");
			assert.equal(sha256Text(failureEvidenceContents), persisted.failureEvidenceSha256);
			const failureEvidence = JSON.parse(failureEvidenceContents) as PersistedCompilerGymJobStepFailureEvidence;
			assert.deepEqual(failureEvidence.qualificationFailure, failure.evidence);
			assert.equal(failureEvidence.qualificationFailure?.cleanupAttempts[0].accounting?.state, "CANCELLED");
			const failureManifestContents = await readFile(join(outputDir, "failure.json"), "utf8");
			assert.equal(sha256Text(failureManifestContents), persisted.failureManifestSha256);
			const failureManifest = JSON.parse(failureManifestContents) as PersistedCompilerGymJobStepFailureManifest;
			assert.equal(failureManifest.failureEvidenceSha256, persisted.failureEvidenceSha256);
			assert.equal(failureManifest.rootCleanupVerified, true);
			assert.equal(failureManifest.qualificationId, qualificationId);
			assert.equal(
				failureManifest.preregistrationPath,
				".autoresearch/compiler-gym-job-step-qualification/preregistration-v2.json",
			);
			assert.equal(
				failureManifest.runtimeManifestPath,
				".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v2.json",
			);
			const ledgerContents = await readFile(join(outputDir, "evidence.jsonl"), "utf8");
			assert.equal(sha256Text(ledgerContents), persisted.ledgerSha256);
			const ledgerEvents = verifyLedgerContentsStrict(ledgerContents);
			const terminalEvent = ledgerEvents.at(-1);
			assert.equal(terminalEvent?.kind, "run_manifest");
			assert.equal(terminalEvent?.hash, persisted.ledgerTerminalEventSha256);
			assert.deepEqual(terminalEvent?.payload, {
				error: failureEvidence.error,
				failureEvidencePath: "failure-evidence.json",
				failureEvidenceSha256: persisted.failureEvidenceSha256,
				gpuHours: 0,
				modelCalls: 0,
				phase: "failed",
				preregistrationPath: ".autoresearch/compiler-gym-job-step-qualification/preregistration-v2.json",
				protocol: "compiler-gym-job-step-c1-execution-v2",
				qualificationId,
				rootCleanupVerified: true,
				rootJobId: ROOT_ID,
				runtimeManifestPath: ".autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v2.json",
			});
			assert.equal(failureManifest.ledgerTerminalEventSha256, terminalEvent?.hash);
			assert.equal(failureManifest.ledgerEventCount, ledgerEvents.length);
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	it("bounds missing step accounting and still cancels the exact root", async () => {
		const qualificationId = "faux-job-step-accounting-timeout-v1";
		const fileSystem = new FauxJobStepRemoteFileSystem();
		const commandRunner = new FauxJobStepCommandRunner(fileSystem, qualificationId, {
			omitStepAccounting: true,
		});
		const runner = new CompilerGymJobStepQualificationRunner(
			{
				...DEFAULT_COMPILER_GYM_JOB_STEP_QUALIFICATION_CONFIG,
				stepAccountingTimeoutMs: 5,
				pollIntervalMs: 1,
			},
			{ commandRunner, remoteFileSystem: fileSystem, expectedWorkerSha256: EXPECTED_WORKER_SHA256 },
		);
		await assert.rejects(
			() =>
				runner.run(qualificationId, new AbortController().signal, lifecycleHooks(commandRunner, qualificationId)),
			/Candidate step accounting timed out/,
		);
		assert.equal(commandRunner.sbatchCalls, 1);
		assert.equal(commandRunner.srunCalls, 1);
		assert.equal(commandRunner.scancelCalls, 1);
	});

	it("runs the pinned rank wrapper from inline worker and evaluator sources", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-worker-"));
		try {
			const workerSourcePath = fileURLToPath(
				new URL("../evaluators/compiler_gym_job_step_worker.py", import.meta.url),
			);
			const requestPath = join(root, "request.json");
			const workerSource = await readFile(workerSourcePath, "utf8");
			const evaluatorSource = [
				"#!/usr/bin/env python3",
				"import json, sys",
				"request = json.loads(sys.stdin.read())",
				"print(json.dumps({'ok': True, 'request': request}, separators=(',', ':')))",
				"",
			].join("\n");
			const workerSha256 = sha256Text(workerSource);
			const evaluatorSha256 = sha256Text(evaluatorSource);
			const sourceBootstrap = buildCompilerGymJobStepSourceBootstrap({
				workerSource,
				workerSha256,
				evaluatorSource,
				evaluatorSha256,
			});
			const request = {
				protocol: COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL,
				candidateId: "C1",
				requestSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256,
				actionsSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256,
				actions: [...COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions],
				tasks: [...COMPILER_GYM_JOB_STEP_C1_TASKS],
				workerSha256,
				evaluatorSha256,
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				createdAt: "2026-08-28T00:00:00.000Z",
			};
			const requestContent = `${canonicalJson(toJsonValue(request))}\n`;
			await writeFile(requestPath, requestContent, { encoding: "utf8", mode: 0o600 });
			const { stdout, stderr } = await execFileAsync(
				"/usr/bin/python3",
				[
					"-c",
					sourceBootstrap.pythonSource,
					"--request",
					requestPath,
					"--request-file-sha256",
					sha256Text(requestContent),
					"--worker-sha256",
					workerSha256,
					"--evaluator-sha256",
					evaluatorSha256,
					"--python",
					"/usr/bin/python3",
					"--expected-root-job-id",
					"987654321",
				],
				{
					env: {
						PATH: "/usr/bin:/bin",
						SLURM_JOB_ID: "987654321",
						SLURM_STEP_ID: "7",
						SLURM_PROCID: "0",
						SLURM_CPUS_PER_TASK: "2",
					},
				},
			);
			assert.equal(stderr, "");
			const output = JSON.parse(stdout) as Record<string, unknown>;
			assert.equal(output.protocol, COMPILER_GYM_JOB_STEP_RESULT_PROTOCOL);
			assert.equal(output.rootJobId, "987654321");
			assert.equal(output.stepId, "7");
			assert.equal(output.rank, 0);
			assert.equal(output.benchmarkId, COMPILER_GYM_JOB_STEP_C1_TASKS[0]);
			assert.equal(output.childExitCode, 0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
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
	COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
	type CompilerGymCanonicalOneTaskAggregate,
	type CompilerGymCanonicalOneTaskPreparationEvidence,
	DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	FarmShareCompilerGymIrDeltaScreenAdapter,
} from "../src/compiler-gym-ir-delta-screen-adapter.js";
import { COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256 } from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
	type CompilerGymPaidLiveEnvironmentGateEvidence,
} from "../src/compiler-gym-paid-live-environment-gate.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "../src/compiler-gym-proxy-cascade-protocol.js";
import {
	type CompilerGymProxyCascadeResourcePreregistration,
	canonicalCompilerGymProxyCascadeResourcePreregistration,
	writeCompilerGymProxyCascadeResourcePreregistration,
} from "../src/compiler-gym-proxy-cascade-resource-preregistration.js";
import {
	type CompilerGymProxyCascadeResourceOneTaskEvaluator,
	type CompilerGymProxyCascadeResourceReconstructedClosure,
	type CompilerGymProxyCascadeResourceRunnerDependencies,
	type CompilerGymProxyCascadeResourceRunnerInput,
	reconstructCompilerGymProxyCascadeResourcePreregistration,
	runCompilerGymProxyCascadeResourceScreen,
} from "../src/compiler-gym-proxy-cascade-resource-runner.js";
import type {
	CompilerGymWarmCommandRunner,
	CompilerGymWarmRemoteFileSystem,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";
import type { EvaluationJob, EvaluationOutcome } from "../src/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FIXED_NOW = new Date("2026-08-30T08:00:00.000Z");

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

interface RemoteFile {
	content: string;
	sha256: string;
	mode: number;
}

class FauxRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	readonly operations: string[] = [];
	readonly files = new Map<string, RemoteFile>();

	constructor(private readonly timeline: string[] = []) {}

	private record(operation: string): void {
		this.operations.push(operation);
		this.timeline.push(operation);
	}

	seed(path: string, content: string, mode = 0o600): void {
		this.files.set(path, { content, sha256: sha256Text(content), mode });
	}

	async ensurePrivateDirectory(path: string): Promise<void> {
		this.record(`ensure:${path}`);
	}

	async createPrivateDirectory(): Promise<void> {
		throw new Error("unexpected createPrivateDirectory");
	}

	async installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
	): Promise<void> {
		this.record(`install:${path}:${allowExistingExact}`);
		const existing = this.files.get(path);
		if (existing) {
			if (
				allowExistingExact &&
				existing.content === content &&
				existing.sha256 === expectedSha256 &&
				existing.mode === mode
			) {
				return;
			}
			const error = new Error(`remote create-only lock exists: ${path}`) as Error & { code: string };
			error.code = "EEXIST";
			throw error;
		}
		assert.equal(sha256Text(content), expectedSha256);
		this.files.set(path, { content, sha256: expectedSha256, mode });
	}

	async linkImmutableFile(): Promise<void> {
		throw new Error("unexpected linkImmutableFile");
	}

	async readTrustedFile(
		path: string,
		options: { maxBytes: number; mode: number; expectedSha256?: string },
	): Promise<string> {
		this.record(`read:${path}`);
		const file = this.files.get(path);
		if (!file) throw new Error(`unknown remote file: ${path}`);
		assert.equal(file.mode, options.mode);
		assert.ok(Buffer.byteLength(file.content) <= options.maxBytes);
		if (options.expectedSha256 && file.sha256 !== options.expectedSha256) {
			throw new Error(`remote sha256 drift: ${path}`);
		}
		return file.content;
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}
}

function accountingRow(input: {
	jobIdRaw: string;
	jobName: string;
	allocCpus: number;
	nTasks: number | null;
	elapsedRawSeconds: number;
	endAt: string;
}) {
	return {
		jobIdRaw: input.jobIdRaw,
		jobName: input.jobName,
		state: "COMPLETED",
		exitCode: "0:0",
		allocCpus: input.allocCpus,
		nTasks: input.nTasks,
		elapsedRawSeconds: input.elapsedRawSeconds,
		cpuTimeRawSeconds: input.allocCpus * input.elapsedRawSeconds,
		nodeList: "barley-01",
		startAt: "2026-08-30T08:00:00",
		endAt: input.endAt,
	};
}

function canonicalEvaluatorStdout(input: {
	benchmarkId: string;
	actions: string[];
	slurmId: string;
	irInstructionCount: number;
	objectTextSizeBytes: number;
}): string {
	return canonicalLine({
		schema_version: 2,
		contract: COMPILER_GYM_VERIFIER_EPOCH,
		ok: true,
		status: "passed",
		benchmark: input.benchmarkId,
		request: { benchmark: input.benchmarkId, actions: input.actions },
		action_indices: input.actions.map((_, index) => index + 20),
		commandline: `opt ${input.actions.join(" ")}`,
		metrics: {
			initial: {
				IrInstructionCount: input.irInstructionCount + 100,
				ObjectTextSizeBytes: input.objectTextSizeBytes + 100,
			},
			final: {
				IrInstructionCount: input.irInstructionCount,
				ObjectTextSizeBytes: input.objectTextSizeBytes,
			},
		},
		validation: {
			passed: true,
			inputs_expected: 20,
			inputs_completed: 20,
			base_callbacks_selected: 20,
			sanitizer_callbacks_selected: 0,
			semantic_errors: [],
			inputs: Array.from({ length: 20 }, (_, index) => ({
				input_index: index + 1,
				completed: true,
				passed: true,
				errors: [],
			})),
		},
		environment: {
			slurm_job_id: input.slurmId,
			slurm_cpus_per_task: "2",
			seal: {
				python_version: "3.10.19",
				distribution_manifest_sha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
				compatibility_tree_manifest_sha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
				libtinfo_sha256: COMPILER_GYM_LIBTINFO_SHA256,
			},
		},
		provenance: {
			upstream_cbench_source_sha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
			cbench_patch_sha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
			pinned_installed_cbench_source_sha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
			installed_cbench_source_sha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
			installed_cbench_source_matches_pin: true,
			farmshare_environment_seal_passed: true,
		},
		timings_seconds: { total: 1, semantic_validation: 0.5 },
	});
}

interface FauxEvaluatorOptions {
	failAllocationOrdinal?: number;
	driftAllocationOrdinal?: number;
	lowerBudgetAfterAllocationOrdinal?: number;
}

class FauxOneTaskEvaluator implements CompilerGymProxyCascadeResourceOneTaskEvaluator {
	readonly calls: Array<{
		allocationOrdinal: number;
		candidateOrdinal: number;
		benchmarkId: string;
	}> = [];
	prepareCalls = 0;
	active = 0;
	maximumActive = 0;

	constructor(
		private readonly preregistration: CompilerGymProxyCascadeResourcePreregistration,
		private readonly options: FauxEvaluatorOptions = {},
		private readonly timeline: string[] = [],
	) {}

	async prepareCanonicalOneTask(): Promise<CompilerGymCanonicalOneTaskPreparationEvidence> {
		this.prepareCalls++;
		this.timeline.push("prepare");
		const sourceDirectory = posix.join(
			this.preregistration.frozenCommon.environment.remoteSourceRoot,
			this.preregistration.frozenCommon.irDeltaSourceBundleSha256,
		);
		return {
			sourceBundleSha256: this.preregistration.frozenCommon.irDeltaSourceBundleSha256,
			sourceDirectory,
			canonicalRemoteEvaluatorPath: posix.join(sourceDirectory, "compiler_gym_eval.py"),
			irDeltaRemoteEvaluatorPath: posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py"),
		};
	}

	async evaluateCanonicalOneTask(job: EvaluationJob): Promise<EvaluationOutcome> {
		const allocationOrdinal = Number.parseInt(job.jobId.slice(-2), 10);
		const planned = this.preregistration.blockPlan.allocations.find(
			(allocation) => allocation.globalAllocationOrdinal === allocationOrdinal,
		);
		assert.ok(planned);
		const candidate = this.preregistration.candidateSources.find(
			(item) => item.artifactSha256 === job.candidate.digest,
		);
		assert.ok(candidate);
		const benchmarkId = job.benchmarkIds[0];
		assert.ok(
			benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH || benchmarkId === COMPILER_GYM_PROXY_CASCADE_BZIP2,
		);
		this.calls.push({ allocationOrdinal, candidateOrdinal: candidate.ordinal, benchmarkId });
		this.timeline.push(`evaluate:${allocationOrdinal}`);
		this.active++;
		this.maximumActive = Math.max(this.maximumActive, this.active);
		try {
			await Promise.resolve();
			if (this.options.failAllocationOrdinal === allocationOrdinal) {
				throw new Error(`faux allocation ${allocationOrdinal} transport failure`);
			}
			const anchor =
				benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH
					? candidate.expectedMetrics.blowfish
					: candidate.expectedMetrics.bzip2;
			const irInstructionCount =
				anchor.irInstructionCount + (this.options.driftAllocationOrdinal === allocationOrdinal ? 1 : 0);
			const actions = JSON.parse(job.candidateContent) as string[];
			const slurmId = String(1_807_000 + allocationOrdinal);
			const jobName = `proxy-cascade-resource-test-${allocationOrdinal}`;
			const transientCache = `/tmp/proxy-cascade-resource-test-${allocationOrdinal}`;
			const control = planned.arm === "full-control";
			const rootElapsed = control ? 6 : 4;
			const stepElapsed = control ? 5 : 3;
			const rootEnd = control ? "2026-08-30T08:00:06" : "2026-08-30T08:00:04";
			const stepEnd = control ? "2026-08-30T08:00:05" : "2026-08-30T08:00:03";
			const root = accountingRow({
				jobIdRaw: slurmId,
				jobName,
				allocCpus: 4,
				nTasks: null,
				elapsedRawSeconds: rootElapsed,
				endAt: rootEnd,
			});
			const accountingRows = {
				contract: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
				interpretation: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
				root,
				extern: accountingRow({
					jobIdRaw: `${slurmId}.extern`,
					jobName: "extern",
					allocCpus: 4,
					nTasks: 1,
					elapsedRawSeconds: rootElapsed,
					endAt: rootEnd,
				}),
				step: accountingRow({
					jobIdRaw: `${slurmId}.0`,
					jobName,
					allocCpus: 2,
					nTasks: 1,
					elapsedRawSeconds: stepElapsed,
					endAt: stepEnd,
				}),
			};
			const evaluatorStdout = canonicalEvaluatorStdout({
				benchmarkId,
				actions,
				slurmId,
				irInstructionCount,
				objectTextSizeBytes: anchor.objectTextSizeBytes,
			});
			const sourceDirectory = posix.join(
				this.preregistration.frozenCommon.environment.remoteSourceRoot,
				this.preregistration.frozenCommon.irDeltaSourceBundleSha256,
			);
			const aggregate: CompilerGymCanonicalOneTaskAggregate = {
				contract: COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
				jobId: job.jobId,
				manifestDigest: job.manifestDigest,
				candidateSha256: job.candidate.digest,
				actionsSha256: sha256Json(actions),
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
				measurementReuse: false,
				sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
				sourceDirectory,
				remoteEvaluatorPath: posix.join(sourceDirectory, "compiler_gym_eval.py"),
				tasks: [
					{
						benchmarkId,
						requestSha256: sha256Text(canonicalLine({ benchmark: benchmarkId, actions })),
						evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
						exitCode: 0,
						wallMs: rootElapsed * 1_000,
						stdout: evaluatorStdout,
						stdoutSha256: sha256Text(evaluatorStdout),
						stderr: "",
						stderrSha256: sha256Text(""),
						slurmId,
						transientCache,
						jobName,
						accounting: root,
						accountingRows,
					},
				],
			};
			if (this.options.lowerBudgetAfterAllocationOrdinal === allocationOrdinal) {
				this.preregistration.budgets.allocationWallMinutesMaximum = 1;
			}
			return {
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				tasks: [
					{
						benchmarkId,
						status: "accepted",
						metrics: {
							InitialIrInstructionCount: irInstructionCount + 100,
							IrInstructionCount: irInstructionCount,
							ObjectTextSizeBytes: anchor.objectTextSizeBytes,
							evaluatorRuntimeMs: 1_000,
							schedulerAndEvaluatorWallMs: rootElapsed * 1_000,
							queueAndTransportMs: rootElapsed * 1_000 - 1_000,
						},
						verifier: { passed: true, checks: ["canonical-test"], errors: [] },
						runtimeMs: rootElapsed * 1_000,
					},
				],
				hardware: {
					cluster: "Stanford FarmShare",
					partition: this.preregistration.frozenCommon.environment.partition,
					cpuConstraint: this.preregistration.frozenCommon.environment.cpuConstraint,
				},
				provenance: { ...COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE },
				stdout: canonicalLine(aggregate),
				stderr: "",
			};
		} finally {
			this.active--;
		}
	}
}

class FauxEnvironmentGate {
	calls = 0;

	async run(): Promise<CompilerGymPaidLiveEnvironmentGateEvidence> {
		this.calls++;
		return {
			protocol: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
			probeSourceSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
			expectedResultSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
			commandSha256: sha256Text("frozen-environment-command"),
			stdoutSha256: sha256Text("frozen-environment-stdout"),
			wallMs: this.calls,
			pass: true,
		};
	}
}

interface PreparedRun {
	root: string;
	input: CompilerGymProxyCascadeResourceRunnerInput;
	closure: CompilerGymProxyCascadeResourceReconstructedClosure;
	preregistration: CompilerGymProxyCascadeResourcePreregistration;
	remote: FauxRemoteFileSystem;
	evaluator: FauxOneTaskEvaluator;
	gate: FauxEnvironmentGate;
	timeline: string[];
	dependencies: CompilerGymProxyCascadeResourceRunnerDependencies;
}

const PASSING_MONOTONIC_MICROS = [
	0, 40_000_000, 50_000_000, 75_000_000, 80_000_000, 106_000_000, 110_000_000, 151_000_000,
];

async function prepareRun(
	options: FauxEvaluatorOptions = {},
	monotonicValues: readonly number[] = PASSING_MONOTONIC_MICROS,
): Promise<PreparedRun> {
	const root = await mkdtemp(join(tmpdir(), "proxy-cascade-resource-runner-"));
	const preregistrationPath = join(root, "preregistration.json");
	const outputDir = join(root, "execution");
	const written = await writeCompilerGymProxyCascadeResourcePreregistration({
		repoRoot: REPO_ROOT,
		path: preregistrationPath,
		outputDir,
		createdAt: FIXED_NOW.toISOString(),
	});
	const preregistration = structuredClone(written.record);
	preregistration.localAttemptLock.path = join(
		root,
		"shared-attempt-locks",
		`proxy-cascade-resource-${preregistration.scientificIdentitySha256}.lock`,
	);
	const preregistrationContents = canonicalCompilerGymProxyCascadeResourcePreregistration(preregistration);
	const closure: CompilerGymProxyCascadeResourceReconstructedClosure = {
		preregistration,
		preregistrationContents,
		preregistrationSha256: sha256Text(preregistrationContents),
	};
	const timeline: string[] = [];
	const remote = new FauxRemoteFileSystem(timeline);
	const sourceDirectory = posix.join(
		preregistration.frozenCommon.environment.remoteSourceRoot,
		preregistration.frozenCommon.irDeltaSourceBundleSha256,
	);
	remote.seed(
		posix.join(sourceDirectory, "compiler_gym_eval.py"),
		await readFile(resolve(REPO_ROOT, preregistration.frozenCommon.canonicalEvaluator.path), "utf8"),
	);
	remote.seed(
		posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py"),
		await readFile(resolve(REPO_ROOT, preregistration.frozenCommon.irDeltaEvaluator.path), "utf8"),
	);
	const evaluator = new FauxOneTaskEvaluator(preregistration, options, timeline);
	const gate = new FauxEnvironmentGate();
	const monotonic = [...monotonicValues];
	const input = { repoRoot: REPO_ROOT, preregistrationPath, outputDir };
	const dependencies: CompilerGymProxyCascadeResourceRunnerDependencies = {
		testOnlyInjectedRuntime: true,
		reconstructPreregistration: async () => structuredClone(closure),
		remoteFileSystem: remote,
		evaluator,
		environmentGate: () => gate.run(),
		now: () => new Date(FIXED_NOW),
		monotonicNowMicros: () => {
			const value = monotonic.shift();
			if (value === undefined) throw new Error("faux monotonic clock exhausted");
			return value;
		},
	};
	return { root, input, closure, preregistration, remote, evaluator, gate, timeline, dependencies };
}

async function cleanup(run: PreparedRun): Promise<void> {
	await rm(run.root, { recursive: true, force: true });
}

describe("canonical one-task source preparation", () => {
	it("uploads and reads back the exact evaluator bundle before a timed caller dispatches", async () => {
		const remote = new FauxRemoteFileSystem();
		const commandRunner: CompilerGymWarmCommandRunner = {
			run: async () => {
				throw new Error("source preparation must not dispatch a command");
			},
		};
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG.environment),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{ commandRunner, remoteFileSystem: remote },
		);
		const signal = new AbortController().signal;
		const first = await adapter.prepareCanonicalOneTask(signal);
		const operationCount = remote.operations.length;
		const second = await adapter.prepareCanonicalOneTask(signal);
		assert.deepEqual(second, first);
		assert.equal(first.sourceBundleSha256, COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256);
		assert.equal(first.canonicalRemoteEvaluatorPath, posix.join(first.sourceDirectory, "compiler_gym_eval.py"));
		assert.equal(
			first.irDeltaRemoteEvaluatorPath,
			posix.join(first.sourceDirectory, "compiler_gym_ir_delta_eval.py"),
		);
		assert.equal(remote.operations.length, operationCount, "the verified preparation promise must be memoized");
		assert.equal(remote.operations.filter((operation) => operation.startsWith("install:")).length, 2);
		assert.equal(remote.operations.filter((operation) => operation.startsWith("read:")).length, 2);
	});
});

describe("CompilerGym proxy-cascade resource runner", () => {
	it("reconstructs the production preregistration and complete source closure without dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "proxy-cascade-resource-reconstruct-"));
		try {
			const preregistrationPath = join(root, "preregistration.json");
			const outputDir = join(root, "execution");
			const written = await writeCompilerGymProxyCascadeResourcePreregistration({
				repoRoot: REPO_ROOT,
				path: preregistrationPath,
				outputDir,
				createdAt: FIXED_NOW.toISOString(),
			});
			const reconstructed = await reconstructCompilerGymProxyCascadeResourcePreregistration({
				repoRoot: REPO_ROOT,
				preregistrationPath,
				outputDir,
			});
			assert.equal(reconstructed.preregistrationSha256, written.sha256);
			assert.deepEqual(reconstructed.preregistration, written.record);
			assert.ok(
				reconstructed.preregistration.implementationClosure.some(
					(entry) => entry.relativePath === "research/autoresearch/src/compiler-gym-ir-delta-screen-adapter.ts",
				),
			);
			await assert.rejects(() => access(outputDir), /ENOENT/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs the sealed AB/BA full-versus-cascade resource gate with exact online scheduling", async () => {
		const run = await prepareRun();
		try {
			const result = await runCompilerGymProxyCascadeResourceScreen(run.input, run.dependencies);
			assert.equal(result.ok, true, result.failure ?? "");
			assert.equal(result.liveScientificEvidenceEligible, false);
			assert.equal(result.disposition, "model-free-resource-screen-qualified-for-one-paid-pilot-consideration-only");
			assert.equal(result.allocations.length, 28);
			assert.equal(result.failedAllocations.length, 0);
			assert.equal(run.evaluator.prepareCalls, 1);
			assert.equal(run.gate.calls, 6);
			assert.equal(result.maximumObservedEvaluatorConcurrency, 2);
			assert.equal(run.evaluator.maximumActive, 2);
			assert.deepEqual(
				result.blocks.map((block) => block.armOrder),
				[
					["full-control", "proxy-cascade"],
					["proxy-cascade", "full-control"],
				],
			);
			assert.deepEqual(
				run.evaluator.calls.map((call) => [call.allocationOrdinal, call.candidateOrdinal, call.benchmarkId]),
				[
					[1, 1, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[2, 1, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[3, 2, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[4, 2, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[5, 3, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[6, 3, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[7, 4, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[8, 4, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[9, 1, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[10, 2, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[11, 3, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[12, 4, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[13, 2, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[14, 3, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[15, 1, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[16, 2, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[17, 3, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[18, 4, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[19, 2, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[20, 3, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[21, 1, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[22, 1, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[23, 2, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[24, 2, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[25, 3, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[26, 3, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[27, 4, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[28, 4, COMPILER_GYM_PROXY_CASCADE_BZIP2],
				],
			);
			assert.deepEqual(
				result.blocks.flatMap((block) => block.arms.map((arm) => arm.interval.feedbackReadyWallMicros)),
				[40_000_000, 25_000_000, 26_000_000, 41_000_000],
			);
			assert.deepEqual(
				result.blocks.map((block) => ({
					control: block.observation.control.stepCpuSeconds,
					cascade: block.observation.cascade.stepCpuSeconds,
				})),
				[
					{ control: 80, cascade: 36 },
					{ control: 80, cascade: 36 },
				],
			);
			assert.equal(result.gate?.passed, true);
			assert.deepEqual(
				result.blocks.map((block) => block.observation.control.oracleFrontierOrdinals),
				[[3], [3]],
			);
			assert.deepEqual(
				result.blocks.map((block) => block.observation.cascade.selectedOrdinals),
				[
					[2, 3],
					[2, 3],
				],
			);
			assert.deepEqual(result.accounting, {
				actualFreshOneTaskAllocations: 28,
				allocationWallSeconds: 144,
				stepCpuSeconds: 232,
				schedulerLogicalCpuSeconds: 576,
				uniqueSlurmIds: 28,
				uniqueTransientCaches: 28,
				uniqueJobNames: 28,
				budgetExceeded: false,
			});
			assert.equal(result.localSeals.length, 8);
			assert.equal(result.remoteLocks.length, 10);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.kind),
				["global", "arm", "selection", "arm", "block", "selection", "arm", "arm", "block", "terminal"],
			);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.path),
				[
					run.preregistration.remoteLocks.globalPath,
					run.preregistration.remoteLocks.blockOneControlPath,
					run.preregistration.remoteLocks.blockOneCascadeSelectionPath,
					run.preregistration.remoteLocks.blockOneCascadePath,
					run.preregistration.remoteLocks.blockOnePath,
					run.preregistration.remoteLocks.blockTwoCascadeSelectionPath,
					run.preregistration.remoteLocks.blockTwoCascadePath,
					run.preregistration.remoteLocks.blockTwoControlPath,
					run.preregistration.remoteLocks.blockTwoPath,
					run.preregistration.remoteLocks.terminalPath,
				],
			);
			for (const seal of [result.localAttemptLock, ...result.localSeals]) {
				const metadata = await lstat(seal.path);
				assert.equal(metadata.isSymbolicLink(), false);
				assert.equal(metadata.mode & 0o777, 0o600);
			}
			const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(events.filter((event) => event.kind === "measurement").length, 28);
			assert.equal(events.filter((event) => event.kind === "claim").length, 1);
			const firstGlobalRead = run.timeline.indexOf(`read:${run.preregistration.remoteLocks.globalPath}`);
			assert.ok(firstGlobalRead >= 0 && firstGlobalRead < run.timeline.indexOf("prepare"));
			assert.ok(run.timeline.indexOf("prepare") < run.timeline.indexOf("evaluate:1"));
		} finally {
			await cleanup(run);
		}
	});

	it("settles a concurrent control pair and dispatches no later round after one failure", async () => {
		const run = await prepareRun({ failAllocationOrdinal: 2 });
		try {
			const result = await runCompilerGymProxyCascadeResourceScreen(run.input, run.dependencies);
			assert.equal(result.disposition, "resource-screen-apparatus-invalid-no-scientific-inference");
			assert.equal(result.allocations.length, 1);
			assert.deepEqual(
				result.failedAllocations.map((failure) => failure.allocation.globalAllocationOrdinal),
				[2],
			);
			assert.deepEqual(
				run.evaluator.calls.map((call) => call.allocationOrdinal),
				[1, 2],
			);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.kind),
				["global"],
			);
			const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(events.filter((event) => event.kind === "measurement").length, 2);
			assert.equal(events.filter((event) => event.kind === "claim").length, 0);
		} finally {
			await cleanup(run);
		}
	});

	it("seals fresh cascade selection and stops before bzip2 when its create-only remote boundary is occupied", async () => {
		const run = await prepareRun();
		try {
			run.remote.seed(run.preregistration.remoteLocks.blockOneCascadeSelectionPath, "occupied\n");
			const result = await runCompilerGymProxyCascadeResourceScreen(run.input, run.dependencies);
			assert.equal(result.disposition, "resource-screen-apparatus-invalid-no-scientific-inference");
			assert.deepEqual(
				run.evaluator.calls.map((call) => call.allocationOrdinal),
				[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
			);
			assert.ok(result.localSeals.some((seal) => seal.kind === "selection"));
			assert.match(result.failure ?? "", /remote create-only lock exists/);
		} finally {
			await cleanup(run);
		}
	});

	it("returns a valid negative when exact evidence passes but the wall gate fails", async () => {
		const run = await prepareRun(
			{},
			[0, 40_000_000, 50_000_000, 95_000_000, 100_000_000, 145_000_000, 150_000_000, 190_000_000],
		);
		try {
			const result = await runCompilerGymProxyCascadeResourceScreen(run.input, run.dependencies);
			assert.equal(result.ok, true);
			assert.equal(result.disposition, "resource-screen-valid-negative-no-paid-treatment");
			assert.equal(result.gate?.passed, false);
			assert.equal(result.gate?.gates.medianFeedbackReadyWallAtLeastTenPercentLower, false);
			assert.equal(result.gate?.gates.neitherBlockCascadeMoreThanFivePercentSlower, false);
		} finally {
			await cleanup(run);
		}
	});

	it("durably terminalizes an over-budget completed screen instead of throwing from the failure path", async () => {
		const run = await prepareRun({ lowerBudgetAfterAllocationOrdinal: 28 });
		try {
			const result = await runCompilerGymProxyCascadeResourceScreen(run.input, {
				...run.dependencies,
				reconstructPreregistration: async () => run.closure,
			});
			assert.equal(result.ok, false);
			assert.equal(result.disposition, "resource-screen-apparatus-invalid-no-scientific-inference");
			assert.match(result.failure ?? "", /accounting exceeded its preregistered budget/);
			assert.equal(result.allocations.length, 28);
			assert.equal(result.accounting.budgetExceeded, true);
			const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal((events.at(-1)?.payload as { type?: string }).type, "proxy_cascade_resource_end");
			assert.ok(
				events.some(
					(event) =>
						event.kind === "run_manifest" &&
						(event.payload as { type?: string }).type === "proxy_cascade_resource_terminal_failure",
				),
			);
			await access(join(run.input.outputDir, "result.json"));
		} finally {
			await cleanup(run);
		}
	});

	it("rejects a duplicate shared local attempt lock before constructing remote state", async () => {
		const run = await prepareRun();
		try {
			await mkdir(dirname(run.preregistration.localAttemptLock.path), { recursive: true, mode: 0o700 });
			await writeFile(run.preregistration.localAttemptLock.path, "occupied\n", { mode: 0o600, flag: "wx" });
			await assert.rejects(
				() => runCompilerGymProxyCascadeResourceScreen(run.input, run.dependencies),
				/EEXIST|exist/i,
			);
			assert.equal(run.remote.operations.length, 0);
			assert.equal(run.evaluator.calls.length, 0);
			assert.equal(run.evaluator.prepareCalls, 0);
			await assert.rejects(() => access(run.input.outputDir), /ENOENT/);
		} finally {
			await cleanup(run);
		}
	});
});

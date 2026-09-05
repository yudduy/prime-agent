import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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
} from "../src/compiler-gym-ir-delta-screen-adapter.js";
import { COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256 } from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
	type CompilerGymPaidLiveEnvironmentGateEvidence,
} from "../src/compiler-gym-paid-live-environment-gate.js";
import {
	type CompilerGymProxyCascadePreregistration,
	canonicalCompilerGymProxyCascadePreregistration,
	writeCompilerGymProxyCascadePreregistration,
} from "../src/compiler-gym-proxy-cascade-preregistration.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "../src/compiler-gym-proxy-cascade-protocol.js";
import {
	type CompilerGymProxyCascadeOneTaskEvaluator,
	type CompilerGymProxyCascadeReconstructedClosure,
	type CompilerGymProxyCascadeRunnerDependencies,
	type CompilerGymProxyCascadeRunnerInput,
	reconstructCompilerGymProxyCascadePreregistration,
	runCompilerGymProxyCascade,
} from "../src/compiler-gym-proxy-cascade-runner.js";
import type { CompilerGymWarmRemoteFileSystem } from "../src/compiler-gym-warm-farmshare-backend.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";
import type { EvaluationJob, EvaluationOutcome } from "../src/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FIXED_NOW = new Date("2026-08-29T23:00:00.000Z");
const SOURCE_DIRECTORY = posix.join(
	"/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-ir-delta-qualification-v1/sources",
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
);

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

interface RemoteFile {
	content: string;
	sha256: string;
	mode: number;
}

interface RemoteTamperAfterRead {
	triggerPath: string;
	targetPath: string;
	replacementContent: string;
}

class FauxRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	readonly operations: string[] = [];
	readonly files = new Map<string, RemoteFile>();
	tamperAfterRead: RemoteTamperAfterRead | null = null;

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
		const readback = file.content;
		const tamper = this.tamperAfterRead;
		if (tamper && tamper.triggerPath === path) {
			const target = this.files.get(tamper.targetPath);
			if (!target) throw new Error(`unknown remote tamper target: ${tamper.targetPath}`);
			this.files.set(tamper.targetPath, {
				...target,
				content: tamper.replacementContent,
				sha256: sha256Text(tamper.replacementContent),
			});
			this.tamperAfterRead = null;
		}
		return readback;
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}
}

interface FauxEvaluatorOptions {
	failAllocationOrdinal?: number;
	driftAnchorAllocationOrdinal?: number;
}

function accountingRow(input: {
	jobIdRaw: string;
	jobName: string;
	allocCpus: number;
	nTasks: number | null;
	endAt?: string;
}) {
	return {
		jobIdRaw: input.jobIdRaw,
		jobName: input.jobName,
		state: "COMPLETED",
		exitCode: "0:0",
		allocCpus: input.allocCpus,
		nTasks: input.nTasks,
		elapsedRawSeconds: 2,
		cpuTimeRawSeconds: input.allocCpus * 2,
		nodeList: "barley-01",
		startAt: "2026-08-29T23:00:00",
		endAt: input.endAt ?? "2026-08-29T23:00:02",
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

class FauxOneTaskEvaluator implements CompilerGymProxyCascadeOneTaskEvaluator {
	readonly calls: Array<{ allocationOrdinal: number; candidateOrdinal: number; benchmarkId: string }> = [];

	constructor(
		private readonly preregistration: CompilerGymProxyCascadePreregistration,
		private readonly options: FauxEvaluatorOptions = {},
		private readonly timeline: string[] = [],
	) {}

	async evaluateCanonicalOneTask(job: EvaluationJob): Promise<EvaluationOutcome> {
		const allocationOrdinal = Number.parseInt(job.jobId.slice(-2), 10);
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
		if (this.options.failAllocationOrdinal === allocationOrdinal) {
			throw new Error(`faux allocation ${allocationOrdinal} transport failure`);
		}
		const expected =
			benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH
				? candidate.expectedMetrics.blowfish
				: candidate.expectedMetrics.bzip2;
		const drift = this.options.driftAnchorAllocationOrdinal === allocationOrdinal ? 1 : 0;
		const irInstructionCount = expected.irInstructionCount + drift;
		const objectTextSizeBytes = expected.objectTextSizeBytes;
		const actions = JSON.parse(job.candidateContent) as string[];
		const slurmId = String(1_806_000 + allocationOrdinal);
		const jobName = `proxy-cascade-test-${allocationOrdinal}`;
		const transientCache = `/tmp/proxy-cascade-test-${allocationOrdinal}`;
		const root = accountingRow({ jobIdRaw: slurmId, jobName, allocCpus: 4, nTasks: null });
		const accountingRows = {
			contract: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
			interpretation: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
			root,
			extern: accountingRow({ jobIdRaw: `${slurmId}.extern`, jobName: "extern", allocCpus: 4, nTasks: 1 }),
			step: accountingRow({ jobIdRaw: `${slurmId}.0`, jobName, allocCpus: 2, nTasks: 1 }),
		};
		const evaluatorStdout = canonicalEvaluatorStdout({
			benchmarkId,
			actions,
			slurmId,
			irInstructionCount,
			objectTextSizeBytes,
		});
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
			sourceDirectory: SOURCE_DIRECTORY,
			remoteEvaluatorPath: posix.join(SOURCE_DIRECTORY, "compiler_gym_eval.py"),
			tasks: [
				{
					benchmarkId,
					requestSha256: sha256Text(canonicalLine({ benchmark: benchmarkId, actions })),
					evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
					exitCode: 0,
					wallMs: 2_000,
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
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: [
				{
					benchmarkId,
					status: "accepted",
					metrics: {
						InitialIrInstructionCount: irInstructionCount + 100,
						IrInstructionCount: irInstructionCount,
						ObjectTextSizeBytes: objectTextSizeBytes,
						evaluatorRuntimeMs: 1_000,
						schedulerAndEvaluatorWallMs: 2_000,
						queueAndTransportMs: 1_000,
					},
					verifier: {
						passed: true,
						checks: ["canonical-test"],
						errors: [],
					},
					runtimeMs: 2_000,
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
	input: CompilerGymProxyCascadeRunnerInput;
	closure: CompilerGymProxyCascadeReconstructedClosure;
	preregistration: CompilerGymProxyCascadePreregistration;
	remote: FauxRemoteFileSystem;
	evaluator: FauxOneTaskEvaluator;
	gate: FauxEnvironmentGate;
	timeline: string[];
	dependencies: CompilerGymProxyCascadeRunnerDependencies;
}

async function prepareRun(options: FauxEvaluatorOptions = {}): Promise<PreparedRun> {
	const root = await mkdtemp(join(tmpdir(), "proxy-cascade-runner-"));
	const preregistrationPath = join(root, "preregistration.json");
	const outputDir = join(root, "execution");
	const written = await writeCompilerGymProxyCascadePreregistration({
		repoRoot: REPO_ROOT,
		path: preregistrationPath,
		outputDir,
		createdAt: FIXED_NOW.toISOString(),
	});
	const preregistration = structuredClone(written.record);
	preregistration.localAttemptLock.path = join(
		root,
		"shared-attempt-locks",
		`proxy-cascade-${preregistration.scientificIdentitySha256}.lock`,
	);
	const preregistrationContents = canonicalCompilerGymProxyCascadePreregistration(preregistration);
	const closure: CompilerGymProxyCascadeReconstructedClosure = {
		preregistration,
		preregistrationContents,
		preregistrationSha256: sha256Text(preregistrationContents),
	};
	const timeline: string[] = [];
	const remote = new FauxRemoteFileSystem(timeline);
	remote.seed(
		posix.join(SOURCE_DIRECTORY, "compiler_gym_eval.py"),
		await readFile(resolve(REPO_ROOT, preregistration.frozenCommon.canonicalEvaluator.path), "utf8"),
	);
	remote.seed(
		posix.join(SOURCE_DIRECTORY, "compiler_gym_ir_delta_eval.py"),
		await readFile(resolve(REPO_ROOT, preregistration.frozenCommon.irDeltaEvaluator.path), "utf8"),
	);
	const evaluator = new FauxOneTaskEvaluator(preregistration, options, timeline);
	const gate = new FauxEnvironmentGate();
	const input = { repoRoot: REPO_ROOT, preregistrationPath, outputDir };
	const dependencies: CompilerGymProxyCascadeRunnerDependencies = {
		testOnlyInjectedRuntime: true,
		reconstructPreregistration: async () => structuredClone(closure),
		remoteFileSystem: remote,
		evaluator,
		environmentGate: () => gate.run(),
		now: () => new Date(FIXED_NOW),
	};
	return { root, input, closure, preregistration, remote, evaluator, gate, timeline, dependencies };
}

async function cleanup(run: PreparedRun): Promise<void> {
	await rm(run.root, { recursive: true, force: true });
}

describe("CompilerGym proxy-cascade runner", () => {
	it("reconstructs the production preregistration, replay, source, and artifact closure without dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "proxy-cascade-reconstruct-"));
		try {
			const preregistrationPath = join(root, "preregistration.json");
			const outputDir = join(root, "execution");
			const written = await writeCompilerGymProxyCascadePreregistration({
				repoRoot: REPO_ROOT,
				path: preregistrationPath,
				outputDir,
				createdAt: FIXED_NOW.toISOString(),
			});
			const reconstructed = await reconstructCompilerGymProxyCascadePreregistration({
				repoRoot: REPO_ROOT,
				preregistrationPath,
				outputDir,
			});
			assert.equal(reconstructed.preregistrationSha256, written.sha256);
			assert.deepEqual(reconstructed.preregistration, written.record);
			await assert.rejects(() => access(outputDir), /ENOENT/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a symlinked preregistration before reconstructing its closure", async () => {
		const root = await mkdtemp(join(tmpdir(), "proxy-cascade-reconstruct-symlink-"));
		try {
			const preregistrationPath = join(root, "preregistration.json");
			const pinnedPath = join(root, "pinned-preregistration.json");
			const outputDir = join(root, "execution");
			await writeCompilerGymProxyCascadePreregistration({
				repoRoot: REPO_ROOT,
				path: preregistrationPath,
				outputDir,
				createdAt: FIXED_NOW.toISOString(),
			});
			await rename(preregistrationPath, pinnedPath);
			await symlink(pinnedPath, preregistrationPath);
			await assert.rejects(
				() =>
					reconstructCompilerGymProxyCascadePreregistration({
						repoRoot: REPO_ROOT,
						preregistrationPath,
						outputDir,
					}),
				/regular non-symlink/,
			);
			await assert.rejects(() => access(outputDir), /ENOENT/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs the sealed four-plus-two-plus-two gate and reconstructs the fresh full frontier", async () => {
		const run = await prepareRun();
		try {
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.ok, true, result.failedAllocations.map((failure) => failure.error.message).join("; "));
			assert.equal(result.liveScientificEvidenceEligible, false);
			assert.equal(result.disposition, "happy-path-wiring-qualified-only");
			assert.equal(result.allocations.length, 8);
			assert.equal(result.failedAllocations.length, 0);
			assert.deepEqual(
				run.evaluator.calls.map((call) => [call.allocationOrdinal, call.candidateOrdinal, call.benchmarkId]),
				[
					[1, 1, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[2, 2, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[3, 3, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[4, 4, COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
					[5, 2, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[6, 3, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[7, 1, COMPILER_GYM_PROXY_CASCADE_BZIP2],
					[8, 4, COMPILER_GYM_PROXY_CASCADE_BZIP2],
				],
			);
			const selectionLockRead = run.timeline.indexOf(`read:${run.preregistration.remoteLocks.selectionPath}`);
			const selectedBzip2Start = run.timeline.indexOf("evaluate:5");
			const cascadeLockRead = run.timeline.indexOf(`read:${run.preregistration.remoteLocks.cascadePath}`);
			const auditBzip2Start = run.timeline.indexOf("evaluate:7");
			assert.ok(selectionLockRead >= 0 && selectionLockRead < selectedBzip2Start);
			assert.ok(cascadeLockRead >= 0 && cascadeLockRead < auditBzip2Start);
			assert.equal(run.gate.calls, 2);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.kind),
				["global", "selection", "cascade", "audit"],
			);
			assert.deepEqual(result.frontierOrdinals, [3]);
			assert.equal(result.championOrdinal, 3);
			assert.equal(result.selectedFrontierRetained, true);
			assert.equal(result.selectedChampionRetained, true);
			assert.deepEqual(result.accounting, {
				actualFreshOneTaskAllocations: 8,
				allocationWallSeconds: 16,
				requestedTaskCpuSeconds: 32,
				schedulerLogicalCpuSeconds: 64,
				uniqueSlurmIds: 8,
				uniqueTransientCaches: 8,
				uniqueJobNames: 8,
			});
			const selectionValue = result.selectionSeal?.value as {
				selectionInputs: Array<Record<string, unknown>>;
				selectedOrdinals: number[];
			};
			assert.deepEqual(selectionValue.selectedOrdinals, [2, 3]);
			for (const selectionInput of selectionValue.selectionInputs) {
				assert.deepEqual(Object.keys(selectionInput).sort(), ["candidateOrdinal", "freshAcceptedBlowfishIr"]);
			}
			for (const seal of [result.localAttemptLock, result.selectionSeal, result.cascadeSeal, result.auditSeal]) {
				assert.ok(seal);
				const metadata = await lstat(seal.path);
				assert.equal(metadata.isSymbolicLink(), false);
				assert.equal(metadata.mode & 0o777, 0o600);
			}
			const ledger = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 8);
		} finally {
			await cleanup(run);
		}
	});

	it("uses one synchronous dependency snapshot despite mutation during reconstruction", async () => {
		const run = await prepareRun();
		try {
			const originalReconstruct = run.dependencies.reconstructPreregistration;
			assert.ok(originalReconstruct);
			const mutatedRemote = new FauxRemoteFileSystem();
			const mutatedEvaluator = new FauxOneTaskEvaluator(run.preregistration);
			const mutatedGate = new FauxEnvironmentGate();
			run.dependencies.reconstructPreregistration = async (input) => {
				const closure = originalReconstruct(input);
				await Promise.resolve();
				run.dependencies.remoteFileSystem = mutatedRemote;
				run.dependencies.evaluator = mutatedEvaluator;
				run.dependencies.environmentGate = () => mutatedGate.run();
				run.dependencies.now = () => new Date("2030-01-01T00:00:00.000Z");
				return closure;
			};
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.ok, true, result.failure ?? "");
			assert.equal(run.evaluator.calls.length, 8);
			assert.equal(run.gate.calls, 2);
			assert.equal(mutatedRemote.operations.length, 0);
			assert.equal(mutatedEvaluator.calls.length, 0);
			assert.equal(mutatedGate.calls, 0);
		} finally {
			await cleanup(run);
		}
	});

	it("rejects live selection-contract drift before any remote operation", async () => {
		const run = await prepareRun();
		try {
			const tampered = structuredClone(run.closure);
			const contracts = tampered.preregistration.selectedTrajectory.selectionContracts as unknown as {
				liveCandidateChoice: { allowedInputs: string[] };
			};
			contracts.liveCandidateChoice.allowedInputs = ["candidateOrdinal", "wrongMetric"];
			const dependencies: CompilerGymProxyCascadeRunnerDependencies = {
				...run.dependencies,
				reconstructPreregistration: async () => structuredClone(tampered),
			};
			await assert.rejects(
				() => runCompilerGymProxyCascade(run.input, dependencies),
				/selection contracts|live selection allowed inputs/,
			);
			assert.equal(run.remote.operations.length, 0);
			assert.equal(run.evaluator.calls.length, 0);
			assert.equal(run.gate.calls, 0);
			await assert.rejects(() => access(run.input.outputDir), /ENOENT/);
		} finally {
			await cleanup(run);
		}
	});

	it("settles and records all phase-A work, then dispatches no bzip2 after one allocation failure", async () => {
		const run = await prepareRun({ failAllocationOrdinal: 2 });
		try {
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.disposition, "terminal-apparatus-invalid");
			assert.equal(result.allocations.length, 3);
			assert.deepEqual(
				result.failedAllocations.map((failure) => failure.allocation.allocationOrdinal),
				[2],
			);
			assert.equal(run.evaluator.calls.length, 4);
			assert.ok(run.evaluator.calls.every((call) => call.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH));
			assert.equal(result.selectionSeal, null);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.kind),
				["global"],
			);
			const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(events.filter((event) => event.kind === "measurement").length, 4);
		} finally {
			await cleanup(run);
		}
	});

	it("settles and records all selected-bzip2 work, then dispatches no audit after one allocation failure", async () => {
		const run = await prepareRun({ failAllocationOrdinal: 5 });
		try {
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.disposition, "terminal-apparatus-invalid");
			assert.equal(result.allocations.length, 5);
			assert.deepEqual(
				result.failedAllocations.map((failure) => failure.allocation.allocationOrdinal),
				[5],
			);
			assert.deepEqual(
				run.evaluator.calls.map((call) => call.allocationOrdinal),
				[1, 2, 3, 4, 5, 6],
			);
			assert.equal(result.cascadeSeal, null);
			assert.equal(result.auditSeal, null);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.kind),
				["global", "selection"],
			);
			const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(events.filter((event) => event.kind === "measurement").length, 6);
		} finally {
			await cleanup(run);
		}
	});

	it("classifies a fresh historical metric-anchor mismatch as apparatus-invalid before selection", async () => {
		const run = await prepareRun({ driftAnchorAllocationOrdinal: 1 });
		try {
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.disposition, "terminal-apparatus-invalid");
			assert.match(result.failure ?? "", /historical metric anchor drifted/);
			assert.equal(run.evaluator.calls.length, 4);
			assert.equal(result.selectionSeal, null);
			assert.ok(run.evaluator.calls.every((call) => call.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH));
		} finally {
			await cleanup(run);
		}
	});

	it("consumes a failed selection-lock boundary and dispatches no selected or audit bzip2 work", async () => {
		const run = await prepareRun();
		try {
			run.remote.seed(run.preregistration.remoteLocks.selectionPath, "occupied\n");
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.disposition, "terminal-apparatus-invalid");
			assert.match(result.failure ?? "", /remote create-only lock exists/);
			assert.equal(run.evaluator.calls.length, 4);
			assert.ok(result.selectionSeal);
			assert.equal(result.cascadeSeal, null);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.kind),
				["global"],
			);
		} finally {
			await cleanup(run);
		}
	});

	it("consumes a failed cascade-lock boundary and dispatches no audit bzip2 work", async () => {
		const run = await prepareRun();
		try {
			run.remote.seed(run.preregistration.remoteLocks.cascadePath, "occupied\n");
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.disposition, "terminal-apparatus-invalid");
			assert.match(result.failure ?? "", /remote create-only lock exists/);
			assert.deepEqual(
				run.evaluator.calls.map((call) => call.allocationOrdinal),
				[1, 2, 3, 4, 5, 6],
			);
			assert.ok(result.cascadeSeal);
			assert.equal(result.auditSeal, null);
			assert.deepEqual(
				result.remoteLocks.map((lock) => lock.kind),
				["global", "selection"],
			);
		} finally {
			await cleanup(run);
		}
	});

	it("invalidates the apparatus when an earlier remote lock mutates after the audit lock readback", async () => {
		const run = await prepareRun();
		try {
			run.remote.tamperAfterRead = {
				triggerPath: run.preregistration.remoteLocks.auditPath,
				targetPath: run.preregistration.remoteLocks.globalPath,
				replacementContent: "tampered\n",
			};
			const result = await runCompilerGymProxyCascade(run.input, run.dependencies);
			assert.equal(result.disposition, "terminal-apparatus-invalid");
			assert.match(result.failure ?? "", /remote sha256 drift/);
			assert.equal(result.remoteLocks.length, 4);
			const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(events.filter((event) => event.kind === "claim").length, 0);
		} finally {
			await cleanup(run);
		}
	});

	it("rejects a duplicate shared local attempt lock before any remote operation", async () => {
		const run = await prepareRun();
		try {
			await mkdir(dirname(run.preregistration.localAttemptLock.path), { recursive: true, mode: 0o700 });
			await writeFile(run.preregistration.localAttemptLock.path, "occupied\n", { mode: 0o600, flag: "wx" });
			await assert.rejects(() => runCompilerGymProxyCascade(run.input, run.dependencies), /EEXIST|exist/i);
			assert.equal(run.remote.operations.length, 0);
			assert.equal(run.evaluator.calls.length, 0);
			assert.equal(run.gate.calls, 0);
			await assert.rejects(() => access(run.input.outputDir), /ENOENT/);
		} finally {
			await cleanup(run);
		}
	});
});

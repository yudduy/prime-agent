import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
	COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256,
	DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
} from "../src/compiler-gym-ir-delta-qualification-preregistration.js";
import {
	COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE,
	COMPILER_GYM_CANONICAL_ONE_TASK_RAW_FAILURE_PROTOCOL,
	COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS,
	COMPILER_GYM_IR_DELTA_SCREEN_DEFAULT_MAX_ACTION_COUNT,
	COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE,
	COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT,
	COMPILER_GYM_IR_DELTA_SCREEN_RAW_FAILURE_PROTOCOL,
	DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	FarmShareCompilerGymIrDeltaScreenAdapter,
	parseCompilerGymCanonicalOneTaskAggregate,
	parseCompilerGymCanonicalOneTaskSemanticResultAggregate,
	parseCompilerGymIrDeltaScreenAccountingRows,
	parseCompilerGymIrDeltaScreenAggregate,
} from "../src/compiler-gym-ir-delta-screen-adapter.js";
import { COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT } from "../src/compiler-gym-ir-delta-smoke-preregistration.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "../src/compiler-gym-ir-delta-smoke-protocol.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
	CompilerGymWarmRemoteFileSystem,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { EvaluationAdapterOutputError } from "../src/evaluation-adapter-output-error.js";
import type { EvaluationContext, EvaluationJob } from "../src/types.js";

const ACTIONS = ["-mem2reg", "-instcombine", "-simplifycfg"];

function job(
	benchmarkIds: string[] = [...COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS],
	actions: string[] = ACTIONS,
): EvaluationJob {
	const candidateContent = JSON.stringify(actions);
	return {
		jobId: "job_ir_delta_paid_screen_1",
		manifestDigest: "1".repeat(64),
		branchId: "paid-screen-control",
		lane: "compiler-gym",
		benchmarkIds,
		budgetClass: "screen",
		treatment: "stock-prime-control",
		proposal: {
			hypothesis: "A fixed pass sequence improves both tasks.",
			mechanism: "Apply the sequence under the frozen evaluator.",
			predictedOutcome: "Lower terminal IR.",
			boundaryConditions: ["The canonical 20-input verifier must pass."],
			parentJobIds: [],
		},
		candidate: {
			digest: sha256Text(candidateContent),
			byteLength: Buffer.byteLength(candidateContent),
			mediaType: "application/vnd.prime.llvm-pass-sequence",
		},
		candidateFormat: "llvm-pass-sequence",
		requireFreshMeasurement: true,
		candidateContent,
	};
}

interface AccountingFixtureOptions {
	rootAllocCpus?: number;
	stepAllocCpus?: number;
	stepNTasks?: number;
	rootElapsedRaw?: number;
	externElapsedRaw?: number;
	stepElapsedRaw?: number;
	outcome?: "verified" | "semantic-rejection";
}

function accountingStdout(slurmId: string, jobName: string, options: AccountingFixtureOptions = {}): string {
	const rootAllocCpus = options.rootAllocCpus ?? 4;
	const stepAllocCpus = options.stepAllocCpus ?? 2;
	const stepNTasks = options.stepNTasks ?? 1;
	const rootElapsedRaw = options.rootElapsedRaw ?? 3;
	const externElapsedRaw = options.externElapsedRaw ?? 3;
	const stepElapsedRaw = options.stepElapsedRaw ?? 2;
	const outcome = options.outcome ?? "verified";
	const state = outcome === "verified" ? "COMPLETED" : "FAILED";
	const exitCode = outcome === "verified" ? "0:0" : "5:0";
	return [
		`${slurmId}|${jobName}|${state}|${exitCode}|${rootAllocCpus}||${rootElapsedRaw}|${rootAllocCpus * rootElapsedRaw}|barley-01|2026-08-29T00:00:00|2026-08-29T00:00:03`,
		`${slurmId}.extern|extern|COMPLETED|0:0|${rootAllocCpus}|1|${externElapsedRaw}|${rootAllocCpus * externElapsedRaw}|barley-01|2026-08-29T00:00:00|2026-08-29T00:00:03`,
		`${slurmId}.0|${jobName}|${state}|${exitCode}|${stepAllocCpus}|${stepNTasks}|${stepElapsedRaw}|${stepAllocCpus * stepElapsedRaw}|barley-01|2026-08-29T00:00:00|2026-08-29T00:00:02`,
	]
		.join("\n")
		.concat("\n");
}

const CONTEXT: EvaluationContext = {
	signal: new AbortController().signal,
	recordExternalJobId: () => Promise.resolve(),
};

class FauxRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	readonly directories: string[] = [];
	readonly files = new Map<string, string>();
	readonly installs: Array<{
		path: string;
		content: string;
		expectedSha256: string;
		mode: number;
		allowExistingExact: boolean;
	}> = [];

	ensurePrivateDirectory(path: string): Promise<void> {
		this.directories.push(path);
		return Promise.resolve();
	}

	createPrivateDirectory(): Promise<void> {
		throw new Error("unexpected createPrivateDirectory");
	}

	installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
	): Promise<void> {
		this.installs.push({ path, content, expectedSha256, mode, allowExistingExact });
		this.files.set(path, content);
		return Promise.resolve();
	}

	linkImmutableFile(): Promise<void> {
		throw new Error("unexpected linkImmutableFile");
	}

	readTrustedFile(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`unknown trusted file ${path}`);
		return Promise.resolve(content);
	}

	exists(): Promise<boolean> {
		throw new Error("unexpected exists");
	}
}

interface FauxFarmShareOptions extends AccountingFixtureOptions {
	omitTrace?: boolean;
	canonicalSemanticRejection?: boolean;
	canonicalSemanticRejectionIncomplete?: boolean;
	accountingTransform?: (stdout: string, poll: number) => string;
}

class FauxFarmShare implements CompilerGymWarmCommandRunner {
	readonly requests: CompilerGymWarmCommandRequest[] = [];
	private readonly jobs = new Map<string, string>();
	private readonly accountingPolls = new Map<string, number>();
	private srunCount = 0;

	constructor(private readonly options: FauxFarmShareOptions = {}) {}

	run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		this.requests.push(request);
		const remoteCommand = request.argv.at(-1) ?? "";
		if (remoteCommand.includes("'/usr/bin/srun'")) return Promise.resolve(this.srun(request, remoteCommand));
		if (remoteCommand.includes("'/usr/bin/sacct'")) return Promise.resolve(this.sacct(remoteCommand));
		throw new Error(`Unexpected command: ${remoteCommand}`);
	}

	private srun(request: CompilerGymWarmCommandRequest, remoteCommand: string): CompilerGymWarmCommandResult {
		this.srunCount += 1;
		assert.ok(request.input);
		const parsedRequest = JSON.parse(request.input) as { benchmark: string; actions: string[] };
		const canonical = remoteCommand.includes("/compiler_gym_eval.py'");
		const slurmId = String(1_704_000 + this.srunCount);
		const jobName = /'--job-name=([^']+)'/.exec(remoteCommand)?.[1];
		assert.ok(jobName);
		this.jobs.set(slurmId, jobName);
		const initialIr = parsedRequest.benchmark.endsWith("blowfish") ? 2_027 : 4_100;
		const finalIr = initialIr - 57;
		const actionIndices = parsedRequest.actions.map((_, index) => index + 20);
		const result: Record<string, unknown> = {
			schema_version: 2,
			contract: canonical ? COMPILER_GYM_VERIFIER_EPOCH : COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
			ok: true,
			status: "passed",
			benchmark: parsedRequest.benchmark,
			request: parsedRequest,
			action_indices: actionIndices,
			commandline: `opt ${parsedRequest.actions.join(" ")}`,
			metrics: {
				initial: { IrInstructionCount: initialIr, ObjectTextSizeBytes: 24_000 },
				final: { IrInstructionCount: finalIr, ObjectTextSizeBytes: 22_000 },
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
				slurm_job_id: slurmId,
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
		};
		if (!canonical) result.terminal_verifier_contract = COMPILER_GYM_VERIFIER_EPOCH;
		if (!canonical && !this.options.omitTrace) {
			result.action_trace = {
				contract: COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
				prefix_conditional: true,
				intermediate_semantic_status: "unverified",
				terminal_semantic_status: "canonical-20-input-verifier",
				zero_delta_semantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
				benchmark: parsedRequest.benchmark,
				actions: parsedRequest.actions,
				action_indices: actionIndices,
				initial_ir_instruction_count: initialIr,
				records: parsedRequest.actions.map((action, index) => ({
					index,
					action,
					action_index: actionIndices[index],
					delta_from_previous: index === 0 ? -57 : 0,
				})),
			};
		}
		if (canonical && this.options.canonicalSemanticRejection) {
			result.ok = false;
			result.status = "semantic_validation_failed";
			const validation = result.validation as {
				passed: boolean;
				inputs_completed: number;
				semantic_errors: unknown[];
				inputs: Array<{ passed: boolean; errors: unknown[] }>;
			};
			validation.passed = false;
			validation.semantic_errors = ["frozen semantic mismatch"];
			validation.inputs[0] = { ...validation.inputs[0]!, passed: false, errors: ["frozen semantic mismatch"] };
			if (this.options.canonicalSemanticRejectionIncomplete) validation.inputs_completed = 19;
		}
		return {
			exitCode: canonical && this.options.canonicalSemanticRejection ? 5 : 0,
			stdout: `${JSON.stringify(result)}\n`,
			stderr: "",
			wallMs: 2_500,
		};
	}

	private sacct(remoteCommand: string): CompilerGymWarmCommandResult {
		const slurmId = /'--jobs' '([0-9]+)'/.exec(remoteCommand)?.[1];
		assert.ok(slurmId);
		const jobName = this.jobs.get(slurmId);
		assert.ok(jobName);
		const poll = (this.accountingPolls.get(slurmId) ?? 0) + 1;
		this.accountingPolls.set(slurmId, poll);
		const completeStdout = accountingStdout(slurmId, jobName, this.options);
		const stdout = remoteCommand.includes("'-X'") ? `${completeStdout.split("\n")[0]}\n` : completeStdout;
		return {
			exitCode: 0,
			stdout: this.options.accountingTransform?.(stdout, poll) ?? stdout,
			stderr: "",
			wallMs: 2,
		};
	}
}

class FailingFarmShare implements CompilerGymWarmCommandRunner {
	readonly requests: CompilerGymWarmCommandRequest[] = [];
	readonly rawStdout: string;
	readonly rawStderr = "srun: evaluator exited with environment error\n";

	constructor() {
		this.rawStdout = `${JSON.stringify({
			schema_version: 2,
			contract: COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
			terminal_verifier_contract: COMPILER_GYM_VERIFIER_EPOCH,
			ok: false,
			status: "environment_error",
			benchmark: COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0],
			request: {
				benchmark: COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0],
				actions: ACTIONS,
			},
			error: { code: "distribution_manifest_mismatch" },
		})}\n`;
	}

	run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		this.requests.push(request);
		const remoteCommand = request.argv.at(-1) ?? "";
		if (!remoteCommand.includes("'/usr/bin/srun'")) throw new Error(`Unexpected command: ${remoteCommand}`);
		return Promise.resolve({ exitCode: 3, stdout: this.rawStdout, stderr: this.rawStderr, wallMs: 4_000 });
	}
}

describe("FarmShare CompilerGym IR-delta paid-screen adapter", () => {
	it("keeps the legacy 46-action default while allowing an explicit frozen 256-action cap", async () => {
		assert.equal(
			DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG.maxActionCount,
			COMPILER_GYM_IR_DELTA_SCREEN_DEFAULT_MAX_ACTION_COUNT,
		);
		const legacyRunner = new FauxFarmShare();
		const legacyAdapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
			{
				commandRunner: legacyRunner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "1020304050607080",
			},
		);
		await assert.rejects(
			legacyAdapter.evaluate(
				job(
					[...COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS],
					Array.from({ length: COMPILER_GYM_IR_DELTA_SCREEN_DEFAULT_MAX_ACTION_COUNT + 1 }, () => "-mem2reg"),
				),
				CONTEXT,
			),
			/at most 46 passes/,
		);
		assert.equal(legacyRunner.requests.length, 0);

		const fullRunner = new FauxFarmShare({ rootAllocCpus: 2 });
		const fullAdapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				maxActionCount: COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT,
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: fullRunner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "1122334455667788",
			},
		);
		const fullActions = Array.from({ length: COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT }, () => "-mem2reg");
		const outcome = await fullAdapter.evaluate(
			job([...COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS], fullActions),
			CONTEXT,
		);
		const aggregate = parseCompilerGymIrDeltaScreenAggregate(outcome.stdout ?? "");
		assert.equal(aggregate.actionsSha256, sha256Json(fullActions));
		assert.ok(aggregate.tasks.every((task) => task.accounting?.allocCpus === 2));
		assert.equal(fullRunner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/srun'")).length, 2);
		await assert.rejects(
			fullAdapter.evaluate(
				job(
					[...COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS],
					Array.from({ length: COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT + 1 }, () => "-mem2reg"),
				),
				CONTEXT,
			),
			/at most 256 passes/,
		);
		assert.throws(
			() =>
				new FarmShareCompilerGymIrDeltaScreenAdapter({
					...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
					environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
					maxActionCount: COMPILER_GYM_IR_DELTA_SCREEN_MAX_ACTION_COUNT + 1,
				}),
			/frozen action-space size of 256/,
		);
	});

	it("accepts only exact root, extern, and two-CPU evaluator-step accounting", () => {
		for (const rootAllocCpus of [2, 4]) {
			const rows = parseCompilerGymIrDeltaScreenAccountingRows({
				stdout: accountingStdout("1704001", "pids-accounting-1-blowfish", { rootAllocCpus }),
				slurmId: "1704001",
				expectedJobName: "pids-accounting-1-blowfish",
				outcome: "verified",
			});
			assert.equal(rows.root.allocCpus, rootAllocCpus);
			assert.equal(rows.extern.allocCpus, rootAllocCpus);
			assert.equal(rows.step.allocCpus, 2);
			assert.equal(rows.step.nTasks, 1);
		}
		const rejected = parseCompilerGymIrDeltaScreenAccountingRows({
			stdout: accountingStdout("1704002", "pids-accounting-2-bzip2", { outcome: "semantic-rejection" }),
			slurmId: "1704002",
			expectedJobName: "pids-accounting-2-bzip2",
			outcome: "semantic-rejection",
		});
		assert.equal(rejected.root.state, "FAILED");
		assert.equal(rejected.extern.state, "COMPLETED");
		assert.equal(rejected.step.exitCode, "5:0");

		for (const [slurmId, jobName, nonce] of [
			["1703771", "pids-4e1dd744ecff0164-2-bzip2", "4e1dd744ecff0164"],
			["1703772", "pids-79d832ebc221e0c2-2-bzip2", "79d832ebc221e0c2"],
		] as const) {
			const captured = [
				`${slurmId}|${jobName}|COMPLETED|0:0|4||17|68|barley-01|2026-08-29T23:27:28|2026-08-29T23:27:45`,
				`${slurmId}.extern|extern|COMPLETED|0:0|4|1|18|72|barley-01|2026-08-29T23:27:28|2026-08-29T23:27:46`,
				`${slurmId}.0|${jobName}|COMPLETED|0:0|2|1|17|34|barley-01|2026-08-29T23:27:28|2026-08-29T23:27:45`,
			]
				.join("\n")
				.concat("\n");
			const rows = parseCompilerGymIrDeltaScreenAccountingRows({
				stdout: captured,
				slurmId,
				expectedJobName: jobName,
				outcome: "verified",
			});
			assert.equal(rows.extern.elapsedRawSeconds, 18, nonce);
			assert.equal(rows.root.elapsedRawSeconds, 17, nonce);
			assert.equal(rows.step.elapsedRawSeconds, 17, nonce);

			const mutateRow = (rowIndex: number, transform: (row: string) => string): string => {
				const lines = captured.trimEnd().split("\n");
				lines[rowIndex] = transform(lines[rowIndex]!);
				return `${lines.join("\n")}\n`;
			};
			assert.throws(
				() =>
					parseCompilerGymIrDeltaScreenAccountingRows({
						stdout: mutateRow(1, (row) => row.replace("|barley-01|", "|barley-02|")),
						slurmId,
						expectedJobName: jobName,
						outcome: "verified",
					}),
				/NodeList differs from the root row/,
			);
			assert.throws(
				() =>
					parseCompilerGymIrDeltaScreenAccountingRows({
						stdout: mutateRow(1, (row) => row.replace("|COMPLETED|0:0|", "|RUNNING|0:0|")),
						slurmId,
						expectedJobName: jobName,
						outcome: "verified",
					}),
				/terminal rows contradict/,
			);
			assert.throws(
				() =>
					parseCompilerGymIrDeltaScreenAccountingRows({
						stdout: mutateRow(1, (row) => row.replace("|COMPLETED|0:0|", "|FAILED|1:0|")),
						slurmId,
						expectedJobName: jobName,
						outcome: "verified",
					}),
				/extern terminal row contradicts/,
			);
			assert.throws(
				() =>
					parseCompilerGymIrDeltaScreenAccountingRows({
						stdout: mutateRow(2, (row) => row.replace("23:27:45", "23:27:47")),
						slurmId,
						expectedJobName: jobName,
						outcome: "verified",
					}),
				/timestamps escape the root allocation/,
			);
		}

		const base = {
			slurmId: "1704003",
			expectedJobName: "pids-accounting-3-blowfish",
			outcome: "verified" as const,
		};
		assert.throws(
			() =>
				parseCompilerGymIrDeltaScreenAccountingRows({
					...base,
					stdout: accountingStdout(base.slurmId, base.expectedJobName, { rootAllocCpus: 3 }),
				}),
			/frozen screen allocation shape/,
		);
		assert.throws(
			() =>
				parseCompilerGymIrDeltaScreenAccountingRows({
					...base,
					stdout: accountingStdout(base.slurmId, base.expectedJobName, { stepAllocCpus: 1 }),
				}),
			/two-CPU one-task shape/,
		);
		assert.throws(
			() =>
				parseCompilerGymIrDeltaScreenAccountingRows({
					...base,
					stdout: accountingStdout(base.slurmId, base.expectedJobName, { stepNTasks: 2 }),
				}),
			/two-CPU one-task shape/,
		);
		const withoutExtern = accountingStdout(base.slurmId, base.expectedJobName)
			.split("\n")
			.filter((line) => !line.includes(".extern|"))
			.join("\n");
		assert.throws(
			() => parseCompilerGymIrDeltaScreenAccountingRows({ ...base, stdout: withoutExtern }),
			/exactly root, extern, and evaluator-step rows/,
		);
		const badCpuTime = accountingStdout(base.slurmId, base.expectedJobName).replace(
			"|2|1|2|4|barley-01|",
			"|2|1|2|5|barley-01|",
		);
		assert.throws(
			() => parseCompilerGymIrDeltaScreenAccountingRows({ ...base, stdout: badCpuTime }),
			/CPUTimeRAW must equal/,
		);
		for (const elapsedOverrun of [{ rootElapsedRaw: 301 }, { externElapsedRaw: 301 }, { stepElapsedRaw: 301 }]) {
			assert.throws(
				() =>
					parseCompilerGymIrDeltaScreenAccountingRows({
						...base,
						stdout: accountingStdout(base.slurmId, base.expectedJobName, elapsedOverrun),
					}),
				/ElapsedRaw exceeds the frozen 300-second limit/,
			);
		}
		const suffixedStates = parseCompilerGymIrDeltaScreenAccountingRows({
			...base,
			stdout: accountingStdout(base.slurmId, base.expectedJobName).replaceAll("|COMPLETED|", "|COMPLETED+|"),
		});
		assert.equal(suffixedStates.root.state, "COMPLETED+");
		assert.equal(suffixedStates.extern.state, "COMPLETED+");
		assert.equal(suffixedStates.step.state, "COMPLETED+");
	});

	it("polls a terminal root until extern and evaluator-step rows settle", async () => {
		const runner = new FauxFarmShare({
			accountingTransform: (stdout, poll) => (poll === 1 ? `${stdout.split("\n")[0]}\n` : stdout),
		});
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "2233445566778899",
				clock: {
					monotonicMs: () => 0,
					sleep: () => Promise.resolve(),
				},
			},
		);
		const aggregate = parseCompilerGymIrDeltaScreenAggregate((await adapter.evaluate(job(), CONTEXT)).stdout ?? "");
		assert.ok(aggregate.tasks.every((task) => task.accountingRows?.step.allocCpus === 2));
		assert.equal(runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'")).length, 4);
	});

	it("polls an exact three-row set while subordinate rows remain nonterminal", async () => {
		const runner = new FauxFarmShare({
			accountingTransform: (stdout, poll) => {
				if (poll !== 1) return stdout;
				const lines = stdout.trimEnd().split("\n");
				lines[1] = lines[1]?.replace("|COMPLETED|", "|RUNNING|").replace(/\|[^|]+$/, "|Unknown");
				lines[2] = lines[2]?.replace("|COMPLETED|", "|COMPLETING|").replace(/\|[^|]+$/, "|Unknown");
				return `${lines.join("\n")}\n`;
			},
		});
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "2334455667788990",
				clock: {
					monotonicMs: () => 0,
					sleep: () => Promise.resolve(),
				},
			},
		);
		const aggregate = parseCompilerGymIrDeltaScreenAggregate((await adapter.evaluate(job(), CONTEXT)).stdout ?? "");
		assert.ok(aggregate.tasks.every((task) => task.accountingRows?.step.state === "COMPLETED"));
		assert.equal(runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'")).length, 4);
	});

	it("preserves the legacy root-only accounting bytes by default", async () => {
		const runner = new FauxFarmShare();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "3344556677889900",
			},
		);
		const aggregate = parseCompilerGymIrDeltaScreenAggregate((await adapter.evaluate(job(), CONTEXT)).stdout ?? "");
		assert.ok(aggregate.tasks.every((task) => task.accounting?.allocCpus === 4));
		assert.ok(aggregate.tasks.every((task) => !Object.hasOwn(task, "accountingRows")));
		const sacctRequests = runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'"));
		assert.equal(sacctRequests.length, 2);
		assert.ok(sacctRequests.every((request) => request.argv.at(-1)?.includes("'-X'")));
	});

	it("runs two fresh stock-cold allocations and returns canonical raw evidence with honest provenance", async () => {
		const runner = new FauxFarmShare();
		const remoteFileSystem = new FauxRemoteFileSystem();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{ commandRunner: runner, remoteFileSystem, nonceFactory: () => "1234567890abcdef" },
		);
		assert.equal(adapter.deterministicMeasurementReuse, undefined);
		const inputJob = job();
		const outcome = await adapter.evaluate(inputJob, CONTEXT);
		assert.equal(outcome.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
		assert.equal(Object.isFrozen(COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE), true);
		assert.deepEqual(outcome.provenance, COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE);
		assert.deepEqual(
			outcome.tasks.map((task) => [task.benchmarkId, task.status, task.verifier.passed]),
			[
				["benchmark://cbench-v1/blowfish", "accepted", true],
				["benchmark://cbench-v1/bzip2", "accepted", true],
			],
		);

		assert.equal(remoteFileSystem.installs.length, 2);
		assert.deepEqual(
			remoteFileSystem.installs.map((install) => install.expectedSha256),
			[
				"1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266",
				COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256,
			],
		);
		assert.ok(remoteFileSystem.installs.every((install) => sha256Text(install.content) === install.expectedSha256));
		assert.ok(remoteFileSystem.installs.every((install) => install.mode === 0o600));
		assert.ok(remoteFileSystem.installs.every((install) => install.allowExistingExact));
		assert.equal(new Set(remoteFileSystem.installs.map((install) => install.path.split("/").at(-2))).size, 1);

		const srunRequests = runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/srun'"));
		const sacctRequests = runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'"));
		assert.equal(srunRequests.length, 2);
		assert.equal(sacctRequests.length, 2);
		assert.ok(sacctRequests.every((request) => !request.argv.at(-1)?.includes("'-X'")));
		for (const request of runner.requests) {
			assert.deepEqual(request.argv.slice(0, 13), [
				"ssh",
				"-o",
				"BatchMode=yes",
				"-o",
				"ClearAllForwardings=yes",
				"-o",
				"ForwardAgent=no",
				"-o",
				"ForwardX11=no",
				"-o",
				"SendEnv=-*",
				"-o",
				"PermitLocalCommand=no",
			]);
		}
		const remoteCommands = srunRequests.map((request) => request.argv.at(-1) ?? "");
		assert.equal(
			new Set(remoteCommands.map((command) => /COMPILER_GYM_TRANSIENT_CACHE=([^']+)/.exec(command)?.[1])).size,
			2,
		);
		assert.equal(new Set(remoteCommands.map((command) => /--job-name=([^']+)/.exec(command)?.[1])).size, 2);
		assert.ok(remoteCommands.every((command) => command.includes("'--export=NONE'")));
		assert.ok(remoteCommands.every((command) => !command.includes("'--dependency")));

		assert.ok(outcome.stdout);
		const aggregate = parseCompilerGymIrDeltaScreenAggregate(outcome.stdout);
		assert.equal(aggregate.contract, COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL);
		assert.equal(aggregate.jobId, inputJob.jobId);
		assert.equal(aggregate.manifestDigest, inputJob.manifestDigest);
		assert.equal(aggregate.candidateSha256, inputJob.candidate.digest);
		assert.equal(aggregate.actionsSha256, sha256Json(ACTIONS));
		assert.equal(aggregate.measurementReuse, false);
		assert.match(aggregate.sourceBundleSha256, /^[0-9a-f]{64}$/);
		assert.ok(aggregate.sourceDirectory.endsWith(`/${aggregate.sourceBundleSha256}`));
		assert.equal(new Set(aggregate.tasks.map((task) => task.slurmId)).size, 2);
		assert.ok(aggregate.tasks.every((task) => task.accounting?.state === "COMPLETED"));
		assert.ok(
			aggregate.tasks.every(
				(task) =>
					task.accountingRows?.contract === COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL &&
					task.accountingRows.interpretation === COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION &&
					task.accountingRows.root.jobIdRaw === task.slurmId &&
					task.accountingRows.extern.jobIdRaw === `${task.slurmId}.extern` &&
					task.accountingRows.step.jobIdRaw === `${task.slurmId}.0` &&
					task.accountingRows.step.allocCpus === 2 &&
					task.accountingRows.step.nTasks === 1 &&
					canonicalJson(toJsonValue(task.accountingRows.root)) === canonicalJson(toJsonValue(task.accounting)),
			),
		);
		assert.ok(aggregate.tasks.every((task) => sha256Text(task.stdout) === task.stdoutSha256));
		assert.equal(outcome.stdout, `${canonicalJson(toJsonValue(aggregate))}\n`);
	});

	it("runs either frozen task through one fresh canonical allocation with exact accounting", async () => {
		const runner = new FauxFarmShare({ rootAllocCpus: 2 });
		const remoteFileSystem = new FauxRemoteFileSystem();
		const nonces = ["13579bdf02468ace", "2468ace013579bdf"];
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem,
				nonceFactory: () => {
					const nonce = nonces.shift();
					if (!nonce) throw new Error("test nonce sequence exhausted");
					return nonce;
				},
			},
		);

		const recordedExternalJobIds: string[] = [];
		const context: EvaluationContext = {
			signal: new AbortController().signal,
			recordExternalJobId: async (externalJobId) => {
				recordedExternalJobIds.push(externalJobId);
			},
		};
		for (const benchmarkId of COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS) {
			const inputJob = job([benchmarkId]);
			const outcome = await adapter.evaluateCanonicalOneTask(inputJob, context);
			assert.deepEqual(outcome.provenance, COMPILER_GYM_CANONICAL_ONE_TASK_EXPECTED_PROVENANCE);
			assert.deepEqual(
				outcome.tasks.map((task) => [task.benchmarkId, task.status, task.verifier.passed]),
				[[benchmarkId, "accepted", true]],
			);
			assert.deepEqual(outcome.tasks[0]?.verifier.checks, [
				"farmshare-environment-seal-v2",
				"pinned-cbench-patch-and-source",
				"pinned-action-space",
				"raw-metrics",
				"20-base-semantic-callbacks",
			]);
			const aggregate = parseCompilerGymCanonicalOneTaskAggregate(outcome.stdout ?? "");
			assert.equal(aggregate.contract, COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL);
			assert.equal(aggregate.jobId, inputJob.jobId);
			assert.equal(aggregate.manifestDigest, inputJob.manifestDigest);
			assert.equal(aggregate.candidateSha256, inputJob.candidate.digest);
			assert.equal(aggregate.actionsSha256, sha256Json(ACTIONS));
			assert.equal(aggregate.evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
			assert.equal(aggregate.tasks.length, 1);
			assert.equal(aggregate.tasks[0].benchmarkId, benchmarkId);
			assert.equal(aggregate.tasks[0].evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
			assert.equal(aggregate.tasks[0].accountingRows.step.allocCpus, 2);
			assert.equal(aggregate.tasks[0].accountingRows.step.nTasks, 1);
			assert.equal(aggregate.tasks[0].accountingRows.root.jobIdRaw, aggregate.tasks[0].slurmId);
			assert.equal(aggregate.remoteEvaluatorPath.endsWith("/compiler_gym_eval.py"), true);
			const raw = JSON.parse(aggregate.tasks[0].stdout) as Record<string, unknown>;
			assert.equal(raw.contract, COMPILER_GYM_VERIFIER_EPOCH);
			assert.equal(Object.hasOwn(raw, "terminal_verifier_contract"), false);
			assert.equal(Object.hasOwn(raw, "action_trace"), false);
			assert.equal(outcome.stdout, `${canonicalJson(toJsonValue(aggregate))}\n`);
		}

		assert.equal(remoteFileSystem.installs.length, 2);
		const srunRequests = runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/srun'"));
		const sacctRequests = runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'"));
		assert.equal(srunRequests.length, 2);
		assert.equal(sacctRequests.length, 2);
		assert.deepEqual(recordedExternalJobIds, ["1704001", "1704002"]);
		assert.ok(srunRequests.every((request) => request.argv.at(-1)?.includes("/compiler_gym_eval.py'")));
		assert.ok(srunRequests.every((request) => !request.argv.at(-1)?.includes("compiler_gym_ir_delta_eval.py")));
		assert.ok(sacctRequests.every((request) => !request.argv.at(-1)?.includes("'-X'")));
	});

	it("rejects non-singleton or non-frozen canonical jobs and weaker accounting before dispatch", async () => {
		const runner = new FauxFarmShare();
		const exactAdapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "3579bdf12468ace0",
			},
		);
		await assert.rejects(exactAdapter.evaluateCanonicalOneTask(job(), CONTEXT), /exactly one frozen/);
		await assert.rejects(exactAdapter.evaluateCanonicalOneTask(job([]), CONTEXT), /exactly one frozen/);
		await assert.rejects(
			exactAdapter.evaluateCanonicalOneTask(job(["benchmark://cbench-v1/qsort"]), CONTEXT),
			/exactly one frozen/,
		);
		assert.equal(runner.requests.length, 0);

		const weakAdapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "468ace023579bdf1",
			},
		);
		await assert.rejects(
			weakAdapter.evaluateCanonicalOneTask(job([COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0]]), CONTEXT),
			/exact three-row scheduler accounting/,
		);
		assert.equal(runner.requests.length, 0);
	});

	it("preserves canonical raw failure bytes when one-task validation rejects", async () => {
		const runner = new FailingFarmShare();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "579bdf13468ace02",
			},
		);
		await assert.rejects(
			adapter.evaluateCanonicalOneTask(job([COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0]]), CONTEXT),
			(error: unknown) => {
				assert.ok(error instanceof EvaluationAdapterOutputError);
				assert.equal(error.message, "Canonical one-task evaluator output failed host validation");
				assert.equal(error.stdout, runner.rawStdout);
				assert.equal(error.stderr, runner.rawStderr);
				const evidence = error.hostEvidence as Record<string, unknown>;
				assert.equal(evidence.contract, COMPILER_GYM_CANONICAL_ONE_TASK_RAW_FAILURE_PROTOCOL);
				assert.equal(evidence.phase, "evaluator-result-validation");
				assert.equal(evidence.taskOrdinal, 1);
				assert.equal(evidence.remoteEvaluatorPath, String(evidence.remoteEvaluatorPath));
				assert.match(String(evidence.remoteEvaluatorPath), /\/compiler_gym_eval\.py$/);
				assert.equal(evidence.stdoutSha256, sha256Text(runner.rawStdout));
				assert.equal(evidence.stderrSha256, sha256Text(runner.rawStderr));
				return true;
			},
		);
		assert.equal(runner.requests.length, 1);
	});

	it("rejects a canonical semantic exit as raw one-task failure evidence", async () => {
		const runner = new FauxFarmShare({ canonicalSemanticRejection: true });
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "68ace024579bdf13",
			},
		);
		await assert.rejects(
			adapter.evaluateCanonicalOneTask(job([COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0]]), CONTEXT),
			(error: unknown) => {
				assert.ok(error instanceof EvaluationAdapterOutputError);
				assert.equal(error.message, "Canonical one-task evaluator output failed host validation");
				const evidence = error.hostEvidence as Record<string, unknown>;
				assert.equal(evidence.contract, COMPILER_GYM_CANONICAL_ONE_TASK_RAW_FAILURE_PROTOCOL);
				assert.equal(evidence.exitCode, 5);
				assert.match(String(evidence.cause), /exact passing contract/);
				assert.ok(error.stdout);
				assert.match(error.stdout, /semantic_validation_failed/);
				assert.equal(evidence.stdoutSha256, sha256Text(error.stdout));
				return true;
			},
		);
		assert.equal(runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/srun'")).length, 1);
		assert.equal(
			runner.requests.some((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'")),
			false,
		);
	});

	it("admits a complete canonical semantic rejection only through the semantic-result path", async () => {
		const runner = new FauxFarmShare({
			canonicalSemanticRejection: true,
			outcome: "semantic-rejection",
		});
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "8ace024579bdf136",
			},
		);
		const outcome = await adapter.evaluateCanonicalOneTaskSemanticResult(
			job([COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0]]),
			CONTEXT,
		);
		assert.deepEqual(outcome.provenance, COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE);
		assert.deepEqual(
			outcome.tasks.map((task) => [task.benchmarkId, task.status, task.verifier.passed]),
			[[COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0], "rejected", false]],
		);
		const aggregate = parseCompilerGymCanonicalOneTaskSemanticResultAggregate(outcome.stdout ?? "");
		assert.equal(aggregate.contract, COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL);
		assert.equal(aggregate.tasks[0].exitCode, 5);
		assert.equal(aggregate.tasks[0].accountingRows.root.state, "FAILED");
		assert.equal(aggregate.tasks[0].accountingRows.root.exitCode, "5:0");
		assert.equal(aggregate.tasks[0].accountingRows.step.state, "FAILED");
		assert.equal(aggregate.tasks[0].accountingRows.step.exitCode, "5:0");
		assert.equal(aggregate.tasks[0].accountingRows.extern.exitCode, "0:0");
		assert.throws(() => parseCompilerGymCanonicalOneTaskAggregate(outcome.stdout ?? ""), /contract is invalid/);
	});

	it("keeps incomplete canonical semantic rejection output apparatus-invalid", async () => {
		const runner = new FauxFarmShare({
			canonicalSemanticRejection: true,
			canonicalSemanticRejectionIncomplete: true,
			outcome: "semantic-rejection",
		});
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "9bdf13568ace0247",
			},
		);
		await assert.rejects(
			adapter.evaluateCanonicalOneTaskSemanticResult(job([COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0]]), CONTEXT),
			(error: unknown) => {
				assert.ok(error instanceof EvaluationAdapterOutputError);
				const evidence = error.hostEvidence as Record<string, unknown>;
				assert.equal(evidence.contract, COMPILER_GYM_CANONICAL_ONE_TASK_RAW_FAILURE_PROTOCOL);
				assert.equal(evidence.exitCode, 5);
				assert.match(String(evidence.cause), /terminal verification is incomplete/);
				return true;
			},
		);
		assert.equal(
			runner.requests.some((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'")),
			false,
		);
	});

	it("rejects canonical dispatch-nonce reuse before a second allocation", async () => {
		const runner = new FauxFarmShare();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "required",
				accountingEvidenceVersion: "exact-three-row-v1",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "79bdf13568ace024",
			},
		);
		await adapter.evaluateCanonicalOneTask(job([COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0]]), CONTEXT);
		await assert.rejects(
			adapter.evaluateCanonicalOneTask(job([COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[1]]), CONTEXT),
			/Dispatch nonce reuse is forbidden/,
		);
		assert.equal(runner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/srun'")).length, 1);
	});

	it("supports an explicit no-accounting mode without weakening raw evaluator checks", async () => {
		const runner = new FauxFarmShare();
		const remoteFileSystem = new FauxRemoteFileSystem();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "disabled",
			},
			{ commandRunner: runner, remoteFileSystem, nonceFactory: () => "fedcba0987654321" },
		);
		const outcome = await adapter.evaluate(job(), CONTEXT);
		const aggregate = parseCompilerGymIrDeltaScreenAggregate(outcome.stdout ?? "");
		assert.ok(aggregate.tasks.every((task) => task.accounting === null));
		assert.ok(aggregate.tasks.every((task) => !Object.hasOwn(task, "accountingRows")));
		assert.equal(
			runner.requests.some((request) => request.argv.at(-1)?.includes("'/usr/bin/sacct'")),
			false,
		);
	});

	it("fails closed on task drift and on a passing result that omits the qualified trace", async () => {
		const runner = new FauxFarmShare();
		const remoteFileSystem = new FauxRemoteFileSystem();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
			{ commandRunner: runner, remoteFileSystem, nonceFactory: () => "0011223344556677" },
		);
		await assert.rejects(
			adapter.evaluate(job([...COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS].reverse()), CONTEXT),
			/fixed blowfish\/bzip2 task order/,
		);
		const emptyCandidate = job();
		emptyCandidate.candidateContent = "[]";
		emptyCandidate.candidate = {
			digest: sha256Text(emptyCandidate.candidateContent),
			byteLength: Buffer.byteLength(emptyCandidate.candidateContent),
			mediaType: "application/vnd.prime.llvm-pass-sequence",
		};
		await assert.rejects(adapter.evaluate(emptyCandidate, CONTEXT), /must contain at least one pass/);
		assert.equal(runner.requests.length, 0);

		const malformedRunner = new FauxFarmShare({ omitTrace: true });
		const malformed = new FarmShareCompilerGymIrDeltaScreenAdapter(
			DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
			{
				commandRunner: malformedRunner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "8899aabbccddeeff",
			},
		);
		await assert.rejects(malformed.evaluate(job(), CONTEXT), (error: unknown) => {
			assert.ok(error instanceof EvaluationAdapterOutputError);
			const evidence = error.hostEvidence as Record<string, unknown>;
			assert.match(String(evidence.cause), /without an integral IR-delta trace/);
			return true;
		});
		assert.equal(
			malformedRunner.requests.filter((request) => request.argv.at(-1)?.includes("'/usr/bin/srun'")).length,
			1,
		);
	});

	it("preserves raw evaluator output and dispatch metadata when result validation rejects", async () => {
		const runner = new FailingFarmShare();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "aabbccddeeff0011",
			},
		);
		await assert.rejects(adapter.evaluate(job(), CONTEXT), (error: unknown) => {
			assert.ok(error instanceof EvaluationAdapterOutputError);
			assert.equal(error.message, "IR-delta evaluator output failed host validation");
			assert.equal(error.message.includes(runner.rawStdout), false);
			assert.equal(error.stdout, runner.rawStdout);
			assert.equal(error.stderr, runner.rawStderr);
			const evidence = error.hostEvidence as Record<string, unknown>;
			assert.equal(evidence.contract, COMPILER_GYM_IR_DELTA_SCREEN_RAW_FAILURE_PROTOCOL);
			assert.equal(evidence.benchmarkId, COMPILER_GYM_IR_DELTA_SCREEN_BENCHMARKS[0]);
			assert.equal(evidence.taskOrdinal, 1);
			assert.equal(evidence.phase, "evaluator-result-validation");
			assert.equal(evidence.cause, "Treatment failure is not a structured complete semantic rejection");
			assert.equal(evidence.exitCode, 3);
			assert.equal(evidence.wallMs, 4_000);
			assert.equal(evidence.stdoutSha256, sha256Text(runner.rawStdout));
			assert.equal(evidence.stderrSha256, sha256Text(runner.rawStderr));
			assert.equal(evidence.jobName, "pids-aabbccddeeff0011-1-blowfish");
			assert.equal(evidence.transientCache, "/tmp/prime-ir-screen-aabbccddeeff0011-1-blowfish");
			assert.equal(evidence.slurmId, null);
			return true;
		});
		assert.equal(runner.requests.length, 1);
	});

	it("rejects noncanonical or hash-tampered aggregate artifacts", async () => {
		const runner = new FauxFarmShare();
		const adapter = new FarmShareCompilerGymIrDeltaScreenAdapter(
			{
				...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
				environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
				accountingMode: "disabled",
			},
			{
				commandRunner: runner,
				remoteFileSystem: new FauxRemoteFileSystem(),
				nonceFactory: () => "0123456789abcdef",
			},
		);
		const aggregate = parseCompilerGymIrDeltaScreenAggregate((await adapter.evaluate(job(), CONTEXT)).stdout ?? "");
		await assert.rejects(
			Promise.resolve().then(() =>
				parseCompilerGymIrDeltaScreenAggregate(`${JSON.stringify(aggregate, null, 2)}\n`),
			),
			/one newline-terminated JSON line/,
		);
		aggregate.tasks[0].stdoutSha256 = "0".repeat(64);
		assert.throws(
			() => parseCompilerGymIrDeltaScreenAggregate(`${canonicalJson(toJsonValue(aggregate))}\n`),
			/aggregate contract is invalid/,
		);
	});
});

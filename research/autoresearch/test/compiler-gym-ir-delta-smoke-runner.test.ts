import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "../src/compiler-gym-adapter.js";
import {
	buildCompilerGymIrDeltaSmokePreregistration,
	COMPILER_GYM_IR_DELTA_CANDIDATE,
	COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT,
	COMPILER_GYM_IR_DELTA_EXECUTION_PLAN,
	COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS,
	COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
	writeCompilerGymIrDeltaSmokePreregistration,
} from "../src/compiler-gym-ir-delta-smoke-preregistration.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "../src/compiler-gym-ir-delta-smoke-protocol.js";
import {
	type CompilerGymIrDeltaHistoricalEvidenceVerifier,
	CompilerGymIrDeltaSmokeRunner,
	parseCompilerGymIrDeltaAccounting,
} from "../src/compiler-gym-ir-delta-smoke-runner.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function commandResult(stdout = "", stderr = "", exitCode = 0): CompilerGymWarmCommandResult {
	return { exitCode, stdout, stderr, wallMs: 5 };
}

class FauxCommandRunner implements CompilerGymWarmCommandRunner {
	readonly allocations: Array<{ arm: "canonical" | "one-env-ir-delta"; remoteCommand: string }> = [];
	readonly operations: Array<"probe" | "srun" | "sacct" | "squeue"> = [];
	readonly ensuredDirectories: string[] = [];
	private readonly remoteDirectories = new Set(["/scratch/users/duynguy"]);
	private readonly jobs = new Map<string, string>();
	private probeCount = 0;
	private srunCount = 0;

	constructor(
		private readonly failProbe: number | null = null,
		private readonly mismatchProbe: number | null = null,
		private readonly failAllocation: number | null = null,
		private readonly rootAllocCpus = 4,
		private readonly treatmentObjectSizeDelta = 0,
		private readonly treatmentShadowTiming = false,
	) {}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		const remoteCommand = request.argv.at(-1) ?? "";
		if (remoteCommand.includes("compiler_gym_env_probe.py") && remoteCommand.includes("'/usr/bin/env' '-i'")) {
			return this.probe();
		}
		if (remoteCommand.includes("'/usr/bin/srun'")) return this.evaluate(request, remoteCommand);
		if (remoteCommand.includes("'/usr/bin/sacct'")) return this.account(remoteCommand);
		if (remoteCommand.includes("'/usr/bin/squeue'")) {
			this.operations.push("squeue");
			return commandResult();
		}
		const ensured = /'ensure-dir' '([^']+)'$/.exec(remoteCommand)?.[1];
		if (ensured) {
			const parent = posix.dirname(ensured);
			if (!this.remoteDirectories.has(parent)) return commandResult("", `missing remote parent: ${parent}`, 2);
			this.remoteDirectories.add(ensured);
			this.ensuredDirectories.push(ensured);
		}
		return commandResult();
	}

	private probe(): CompilerGymWarmCommandResult {
		this.probeCount += 1;
		this.operations.push("probe");
		if (this.probeCount === this.failProbe) return commandResult("", "probe failed", 1);
		const value =
			this.probeCount === this.mismatchProbe
				? { ...COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT, runtimeFiles: 570 }
				: COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT;
		return commandResult(`${canonicalJson(toJsonValue(value))}\n`);
	}

	private evaluate(request: CompilerGymWarmCommandRequest, remoteCommand: string): CompilerGymWarmCommandResult {
		this.srunCount += 1;
		this.operations.push("srun");
		if (this.srunCount === this.failAllocation) return commandResult("", "allocation failed", 1);
		if (!request.input) throw new Error("Faux evaluator requires request stdin");
		const parsedRequest = JSON.parse(request.input) as { benchmark: string; actions: string[] };
		assert.equal(parsedRequest.benchmark, "benchmark://cbench-v1/blowfish");
		assert.deepEqual(parsedRequest.actions, COMPILER_GYM_IR_DELTA_CANDIDATE.actions);
		const treatment = remoteCommand.includes("compiler_gym_ir_delta_eval.py");
		const arm = treatment ? "one-env-ir-delta" : "canonical";
		const jobName = /'--job-name=([^']+)'/.exec(remoteCommand)?.[1];
		if (!jobName) throw new Error("Faux srun lacks a job name");
		const slurmId = String(1_702_000 + this.srunCount);
		this.jobs.set(slurmId, jobName);
		this.allocations.push({ arm, remoteCommand });
		const actionIndices = parsedRequest.actions.map((_, index) => index + 10);
		const initialIr = 2027;
		const total = [1, 1.1, 1.12, 1][this.srunCount - 1];
		const timingsSeconds: Record<string, number> = {
			total,
			environment_create: 0.1,
			semantic_validation: 0.5,
		};
		if (treatment && this.treatmentShadowTiming) timingsSeconds.shadow_action_trace = 0.01;
		const result: Record<string, unknown> = {
			schema_version: 2,
			contract: treatment ? COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT : COMPILER_GYM_VERIFIER_EPOCH,
			ok: true,
			status: "passed",
			benchmark: parsedRequest.benchmark,
			request: parsedRequest,
			action_indices: actionIndices,
			commandline: `opt ${parsedRequest.actions.join(" ")}`,
			metrics: {
				initial: { IrInstructionCount: initialIr, ObjectTextSizeBytes: 24_000 },
				final: {
					IrInstructionCount: 1981,
					ObjectTextSizeBytes: 23028 + (treatment ? this.treatmentObjectSizeDelta : 0),
				},
			},
			validation: {
				passed: true,
				inputs_expected: 20,
				inputs_completed: 20,
				base_callbacks_selected: 20,
				sanitizer_callbacks_selected: 0,
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
			timings_seconds: timingsSeconds,
		};
		if (treatment) {
			result.terminal_verifier_contract = COMPILER_GYM_VERIFIER_EPOCH;
			result.step_info = { retained: false };
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
					delta_from_previous: -1,
				})),
			};
		} else {
			result.step_info = { action_had_no_effect: [] };
		}
		return commandResult(`${JSON.stringify(result)}\n`);
	}

	private account(remoteCommand: string): CompilerGymWarmCommandResult {
		this.operations.push("sacct");
		const slurmId = /'--jobs' '([0-9]+)'/.exec(remoteCommand)?.[1];
		if (!slurmId) throw new Error("Faux sacct lacks a Slurm ID");
		const jobName = this.jobs.get(slurmId);
		if (!jobName) throw new Error("Faux sacct queried an unknown allocation");
		return commandResult(
			`${slurmId}|${jobName}|COMPLETED|0:0|${this.rootAllocCpus}||6|${this.rootAllocCpus * 6}|barley-01|2026-08-28T23:00:00|2026-08-28T23:00:06\n`,
		);
	}
}

const SKIP_HISTORY: CompilerGymIrDeltaHistoricalEvidenceVerifier = { verify: async () => undefined };

async function prepare(root: string) {
	const canonicalPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const treatmentPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const environmentProbePath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_env_probe.py");
	const value = buildCompilerGymIrDeltaSmokePreregistration({
		createdAt: "2026-08-28T23:00:00.000Z",
		primeAgentCommit: "bc0fa7606abb3b7af0f765319518d255e6ae553d",
		canonicalPath,
		canonicalSource: await readFile(canonicalPath, "utf8"),
		treatmentPath,
		treatmentSource: await readFile(treatmentPath, "utf8"),
		environmentProbePath,
		environmentProbeSource: await readFile(environmentProbePath, "utf8"),
		implementationClosure: await Promise.all(
			COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(REPO_ROOT, relativePath), "utf8")),
			})),
		),
	});
	const preregistrationPath = join(root, "preregistration.json");
	await writeCompilerGymIrDeltaSmokePreregistration(preregistrationPath, value);
	return {
		preregistrationPath,
		outputDir: join(root, "execution"),
		dispatchLockRoot: join(root, "dispatch-locks"),
	};
}

function runner(paths: Awaited<ReturnType<typeof prepare>>, commandRunner: CompilerGymWarmCommandRunner) {
	return new CompilerGymIrDeltaSmokeRunner(
		{
			repoRoot: REPO_ROOT,
			preregistrationPath: paths.preregistrationPath,
			outputDir: paths.outputDir,
			commandTimeoutMs: 1_000,
			accountingTimeoutMs: 1_000,
			accountingPollMs: 1,
			dispatchLockRoot: paths.dispatchLockRoot,
		},
		{ commandRunner, historicalEvidenceVerifier: SKIP_HISTORY },
	);
}

describe("CompilerGym one-environment IR-delta smoke runner", () => {
	it("runs exact L46/blowfish ABBA with four fresh allocations, accounting, seals, and terminal admission", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-smoke-"));
		try {
			const paths = await prepare(root);
			const commandRunner = new FauxCommandRunner();
			const result = await runner(paths, commandRunner).run();
			assert.deepEqual(
				commandRunner.allocations.map((item) => item.arm),
				["canonical", "one-env-ir-delta", "one-env-ir-delta", "canonical"],
			);
			assert.deepEqual(
				result.allocations.map((item) => item.spec),
				COMPILER_GYM_IR_DELTA_EXECUTION_PLAN,
			);
			assert.equal(new Set(result.allocations.map((item) => item.slurmId)).size, 4);
			assert.equal(new Set(result.allocations.map((item) => item.transientCache)).size, 4);
			assert.equal(result.assessment.overhead.medianRatio, 1.11);
			assert.equal(result.assessment.decision, "promote-to-full-ir-delta-qualification");
			assert.equal(result.assessment.lunaAuthorized, false);
			assert.deepEqual(commandRunner.operations, [
				"probe",
				"srun",
				"sacct",
				"srun",
				"sacct",
				"srun",
				"sacct",
				"srun",
				"sacct",
				"probe",
				"squeue",
			]);
			for (const allocation of commandRunner.allocations) {
				assert.match(allocation.remoteCommand, /'--cpus-per-task=2'/);
				assert.match(allocation.remoteCommand, /COMPILER_GYM_TRANSIENT_CACHE=\/tmp\/prime-ir-delta-/);
				for (const forbidden of ["sbatch", "--jobid", "--dependency", "--overlap", "--exact"]) {
					assert.equal(allocation.remoteCommand.includes(forbidden), false);
				}
			}
			const ledger = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 4);
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).phase, "complete");
			assert.equal(result.ledgerEventCount, ledger.length);

			const duplicatePaths = { ...paths, outputDir: join(root, "duplicate") };
			const duplicateRunner = runner(duplicatePaths, new FauxCommandRunner());
			await assert.rejects(duplicateRunner.run(), /EEXIST|already exists/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails preflight before any allocation and records no admitted result", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-preflight-"));
		try {
			const paths = await prepare(root);
			const commandRunner = new FauxCommandRunner(1);
			await assert.rejects(runner(paths, commandRunner).run(), /Environment probe failed/);
			assert.equal(commandRunner.allocations.length, 0);
			await assert.rejects(readFile(join(paths.outputDir, "result.json")), /ENOENT/);
			const ledger = verifyLedgerContentsStrict(await readFile(join(paths.outputDir, "evidence.jsonl"), "utf8"));
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).phase, "failed");
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).allocationCount, 0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("withholds result when the postflight seal differs after four measurements", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-postflight-"));
		try {
			const paths = await prepare(root);
			const commandRunner = new FauxCommandRunner(null, 2);
			await assert.rejects(runner(paths, commandRunner).run(), /does not exactly match/);
			assert.equal(commandRunner.allocations.length, 4);
			await assert.rejects(readFile(join(paths.outputDir, "result.json")), /ENOENT/);
			const ledger = verifyLedgerContentsStrict(await readFile(join(paths.outputDir, "evidence.jsonl"), "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 4);
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).phase, "failed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("admits a terminal complete kill decision for verifier-passing treatment metric drift", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-treatment-drift-"));
		try {
			const paths = await prepare(root);
			const commandRunner = new FauxCommandRunner(null, null, null, 4, 1);
			const result = await runner(paths, commandRunner).run();
			assert.equal(result.assessment.equivalence.passed, false);
			assert.deepEqual(result.assessment.equivalence.mismatches, [
				{ blockId: "r1", fields: ["objectTextSizeBytes"] },
				{ blockId: "r2", fields: ["objectTextSizeBytes"] },
			]);
			assert.equal(result.assessment.decision, "kill-current-one-env-ir-delta-evaluator");
			assert.equal(result.assessment.nextGate, null);
			assert.equal(result.assessment.lunaAuthorized, false);
			const ledger = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).phase, "complete");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a treatment shadow timing because the whole total is indivisible", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-shadow-timing-"));
		try {
			const paths = await prepare(root);
			const commandRunner = new FauxCommandRunner(null, null, null, 4, 0, true);
			await assert.rejects(runner(paths, commandRunner).run(), /must not contain shadow_action_trace/);
			assert.equal(commandRunner.allocations.length, 2);
			await assert.rejects(readFile(join(paths.outputDir, "result.json")), /ENOENT/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails a partial run without retry or replacement", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-partial-"));
		try {
			const paths = await prepare(root);
			const commandRunner = new FauxCommandRunner(null, null, 3);
			await assert.rejects(runner(paths, commandRunner).run(), /allocation failed/);
			assert.equal(commandRunner.allocations.length, 2);
			const ledger = verifyLedgerContentsStrict(await readFile(join(paths.outputDir, "evidence.jsonl"), "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 2);
			assert.equal(
				(ledger.at(-1)?.payload as Record<string, unknown>).failureDisposition,
				"terminal-apparatus-invalid",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("requires strict root accounting identities", () => {
		assert.deepEqual(
			parseCompilerGymIrDeltaAccounting(
				"1702001|pid-1-r1-c|COMPLETED|0:0|4||6|24|barley-01|2026-08-28T23:00:00|2026-08-28T23:00:06\n",
			),
			{
				jobIdRaw: "1702001",
				jobName: "pid-1-r1-c",
				state: "COMPLETED",
				exitCode: "0:0",
				allocCpus: 4,
				nTasks: null,
				elapsedRawSeconds: 6,
				cpuTimeRawSeconds: 24,
				nodeList: "barley-01",
				startAt: "2026-08-28T23:00:00",
				endAt: "2026-08-28T23:00:06",
			},
		);
		assert.throws(
			() =>
				parseCompilerGymIrDeltaAccounting(
					"1702001|pid-1-r1-c|COMPLETED|0:0|4||6|23|barley-01|2026-08-28T23:00:00|2026-08-28T23:00:06\n",
				),
			/CPUTimeRAW must equal/,
		);
		assert.throws(
			() =>
				parseCompilerGymIrDeltaAccounting(
					"1702001|pid-1-r1-c|COMPLETED|0:0|9007199254740991||2|9007199254740991|barley-01|2026-08-28T23:00:00|2026-08-28T23:00:06\n",
				),
			/multiplied by ElapsedRaw is not a safe integer/,
		);
	});
});

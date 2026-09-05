import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../src/artifact-store.js";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	buildCompilerGymActionTracePreregistration,
	COMPILER_GYM_ACTION_TRACE_CANDIDATES,
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT,
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH,
	COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN,
	COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS,
	COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
	writeCompilerGymActionTracePreregistration,
} from "../src/compiler-gym-action-trace-preregistration.js";
import {
	type CompilerGymActionTraceHistoricalEvidenceVerifier,
	type CompilerGymActionTraceModelValueRenderer,
	CompilerGymActionTraceQualificationRunner,
	NativeCompilerGymActionTraceModelValueRenderer,
	parseCompilerGymActionTraceAccounting,
	SystemCompilerGymActionTraceRunnerClock,
} from "../src/compiler-gym-action-trace-qualification-runner.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

interface CapturedAllocation {
	candidateId: string;
	benchmarkId: string;
	arm: "authoritative" | "shadow-trace";
	remoteCommand: string;
}

function commandResult(stdout = "", stderr = "", exitCode = 0): CompilerGymWarmCommandResult {
	return { exitCode, stdout, stderr, wallMs: 5 };
}

class FauxQualificationCommandRunner implements CompilerGymWarmCommandRunner {
	readonly allocations: CapturedAllocation[] = [];
	readonly environmentProbeCommands: string[] = [];
	readonly ensuredPrivateDirectories: string[] = [];
	readonly operations: Array<"environment-probe" | "srun"> = [];
	private readonly jobs = new Map<string, string>();
	private readonly remoteDirectories = new Set(["/scratch/users/duynguy"]);
	private environmentProbeCount = 0;
	private srunCount = 0;

	constructor(
		private readonly failAtAllocation: number | null = null,
		private readonly rootAllocCpus = 4,
		private readonly failAtEnvironmentProbe: number | null = null,
		private readonly mismatchAtEnvironmentProbe: number | null = null,
	) {}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		const remoteCommand = request.argv.at(-1) ?? "";
		if (remoteCommand.includes("'/usr/bin/env' '-i'") && remoteCommand.includes("compiler_gym_env_probe.py")) {
			return this.runEnvironmentProbe(remoteCommand);
		}
		if (remoteCommand.includes("'/usr/bin/srun'")) return this.runEvaluator(request, remoteCommand);
		if (remoteCommand.includes("'/usr/bin/sacct'")) return this.runAccounting(remoteCommand);
		const ensuredDirectory = /'ensure-dir' '([^']+)'$/.exec(remoteCommand)?.[1];
		if (ensuredDirectory) {
			const parent = posix.dirname(ensuredDirectory);
			if (!this.remoteDirectories.has(parent)) {
				return commandResult("", `missing remote parent: ${parent}`, 2);
			}
			this.remoteDirectories.add(ensuredDirectory);
			this.ensuredPrivateDirectories.push(ensuredDirectory);
		}
		return commandResult();
	}

	private runEnvironmentProbe(remoteCommand: string): CompilerGymWarmCommandResult {
		this.environmentProbeCount += 1;
		this.operations.push("environment-probe");
		this.environmentProbeCommands.push(remoteCommand);
		if (this.failAtEnvironmentProbe === this.environmentProbeCount) {
			return commandResult("", "faux environment probe failure", 1);
		}
		if (this.mismatchAtEnvironmentProbe === this.environmentProbeCount) {
			return commandResult(
				`${canonicalJson(
					toJsonValue({ ...COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT, runtimeFiles: 570 }),
				)}\n`,
			);
		}
		return commandResult(
			`${canonicalJson(toJsonValue(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT))}\n`,
		);
	}

	private runEvaluator(request: CompilerGymWarmCommandRequest, remoteCommand: string): CompilerGymWarmCommandResult {
		this.srunCount += 1;
		this.operations.push("srun");
		if (this.failAtAllocation === this.srunCount) return commandResult("", "faux transport failure", 1);
		if (request.input === undefined) throw new Error("Faux evaluator requires stdin");
		const parsed = JSON.parse(request.input) as { benchmark: string; actions: string[] };
		const candidate = COMPILER_GYM_ACTION_TRACE_CANDIDATES.find(
			(item) => item.actions.length === parsed.actions.length,
		);
		if (!candidate) throw new Error("Unknown faux candidate");
		const arm = remoteCommand.includes("compiler_gym_action_trace_eval.py") ? "shadow-trace" : "authoritative";
		const jobName = /'--job-name=([^']+)'/.exec(remoteCommand)?.[1];
		if (!jobName) throw new Error("Faux srun command lacks a job name");
		const slurmId = String(1_701_000 + this.srunCount);
		this.jobs.set(slurmId, jobName);
		this.allocations.push({
			candidateId: candidate.candidateId,
			benchmarkId: parsed.benchmark,
			arm,
			remoteCommand,
		});
		const expected = candidate.expectedMetrics[parsed.benchmark as keyof typeof candidate.expectedMetrics];
		if (!expected) throw new Error("Unknown faux benchmark");
		const actionIndices = parsed.actions.map((_, index) => index + 10);
		const initialIrInstructionCount = expected.irInstructionCount + parsed.actions.length;
		const commandline = `opt ${parsed.actions.join(" ")}`;
		const result: Record<string, unknown> = {
			schema_version: 2,
			contract: COMPILER_GYM_VERIFIER_EPOCH,
			ok: true,
			status: "passed",
			benchmark: parsed.benchmark,
			request: { benchmark: parsed.benchmark, actions: parsed.actions },
			action_indices: actionIndices,
			commandline,
			metrics: {
				initial: {
					IrInstructionCount: initialIrInstructionCount,
					ObjectTextSizeBytes: expected.objectTextSizeBytes,
				},
				final: {
					IrInstructionCount: expected.irInstructionCount,
					ObjectTextSizeBytes: expected.objectTextSizeBytes,
				},
			},
			validation: {
				passed: true,
				inputs_expected: 20,
				inputs_completed: 20,
				base_callbacks_selected: 20,
				sanitizer_callbacks_selected: 0,
			},
			environment: { slurm_job_id: slurmId, slurm_cpus_per_task: "2" },
			timings_seconds: { total: arm === "shadow-trace" ? 1.1 : 1 },
		};
		if (arm === "shadow-trace") {
			(result.timings_seconds as Record<string, unknown>).shadow_action_trace = 0.1;
			result.action_trace = {
				contract: "compiler-gym-shadow-action-trace-v1",
				prefix_conditional: true,
				intermediate_semantic_status: "unverified",
				terminal_semantic_status: "authoritative-final-verifier-only",
				benchmark: parsed.benchmark,
				actions: parsed.actions,
				action_indices: actionIndices,
				initial_ir_instruction_count: initialIrInstructionCount,
				records: parsed.actions.map((action, index) => ({
					index,
					action,
					action_index: actionIndices[index],
					ir_instruction_count: initialIrInstructionCount - index - 1,
					delta_from_previous: -1,
					action_had_no_effect: false,
				})),
				final: {
					IrInstructionCount: expected.irInstructionCount,
					ObjectTextSizeBytes: expected.objectTextSizeBytes,
				},
				commandline,
			};
		}
		return commandResult(`${JSON.stringify(result)}\n`);
	}

	private runAccounting(remoteCommand: string): CompilerGymWarmCommandResult {
		const slurmId = /'--jobs' '([0-9]+)'/.exec(remoteCommand)?.[1];
		if (!slurmId) throw new Error("Faux sacct command lacks a job ID");
		const jobName = this.jobs.get(slurmId);
		if (!jobName) throw new Error("Faux sacct queried an unknown job");
		return commandResult(
			`${slurmId}|${jobName}|COMPLETED|0:0|${this.rootAllocCpus}||6|${this.rootAllocCpus * 6}|barley-01|2026-08-28T20:00:00|2026-08-28T20:00:06\n`,
		);
	}
}

class FauxRenderer implements CompilerGymActionTraceModelValueRenderer {
	closed = false;

	async render(jsonValue: string) {
		const parsed = JSON.parse(jsonValue) as Record<string, unknown>;
		const text = "x".repeat(Object.hasOwn(parsed, "actionTrace") ? 10_500 : 10_000);
		return {
			text,
			renderedTextSha256: sha256Text(text),
			agentFacingBytes: Buffer.byteLength(text, "utf8"),
			cellSha256: sha256Text(jsonValue),
			rendererProtocol: COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
		};
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

const SKIP_HISTORICAL_EVIDENCE: CompilerGymActionTraceHistoricalEvidenceVerifier = {
	verify: async () => undefined,
};

async function prepareRun(root: string) {
	const canonicalPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const tracePath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_action_trace_eval.py");
	const environmentProbePath = resolve(REPO_ROOT, COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH);
	const preregistration = buildCompilerGymActionTracePreregistration({
		createdAt: "2026-08-28T20:00:00.000Z",
		primeAgentCommit: "bc0fa7606abb3b7af0f765319518d255e6ae553d",
		canonicalPath,
		canonicalSource: await readFile(canonicalPath, "utf8"),
		tracePath,
		traceSource: await readFile(tracePath, "utf8"),
		environmentProbePath,
		environmentProbeSource: await readFile(environmentProbePath, "utf8"),
		implementationClosure: await Promise.all(
			COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(REPO_ROOT, relativePath), "utf8")),
			})),
		),
	});
	const preregistrationPath = join(root, "preregistration.json");
	await writeCompilerGymActionTracePreregistration(preregistrationPath, preregistration);
	return {
		preregistrationPath,
		outputDir: join(root, "qualification"),
		dispatchLockRoot: join(root, "dispatch-attempts"),
	};
}

describe("CompilerGym action-trace qualification runner", () => {
	it("removes the clock abort listener after a normal poll delay", async () => {
		const controller = new AbortController();
		const signal = controller.signal;
		const originalAdd = signal.addEventListener.bind(signal);
		const originalRemove = signal.removeEventListener.bind(signal);
		let additions = 0;
		let removals = 0;
		signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => {
			additions += 1;
			return originalAdd(...args);
		}) as AbortSignal["addEventListener"];
		signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
			removals += 1;
			return originalRemove(...args);
		}) as AbortSignal["removeEventListener"];
		await new SystemCompilerGymActionTraceRunnerClock().sleep(0, signal);
		assert.equal(additions, 1);
		assert.equal(removals, 1);
	});

	it("parses the observed root sacct row without a trailing delimiter", () => {
		assert.deepEqual(
			parseCompilerGymActionTraceAccounting(
				"1701011|env|COMPLETED|0:0|4||6|24|barley-01|2026-08-28T20:00:00|2026-08-28T20:00:06\n",
			),
			{
				jobIdRaw: "1701011",
				jobName: "env",
				state: "COMPLETED",
				exitCode: "0:0",
				allocCpus: 4,
				nTasks: null,
				elapsedRawSeconds: 6,
				cpuTimeRawSeconds: 24,
				nodeList: "barley-01",
				startAt: "2026-08-28T20:00:00",
				endAt: "2026-08-28T20:00:06",
			},
		);
		assert.throws(
			() =>
				parseCompilerGymActionTraceAccounting(
					"1701011|env|COMPLETED|0:0|4||6|23|barley-01|2026-08-28T20:00:00|2026-08-28T20:00:06\n",
				),
			/CPUTimeRAW must equal/,
		);
		assert.throws(
			() =>
				parseCompilerGymActionTraceAccounting(
					"1701011|env|COMPLETED|0:0|9007199254740992||6|54043195528445952|barley-01|2026-08-28T20:00:00|2026-08-28T20:00:06\n",
				),
			/not a safe integer/,
		);
	});

	it("creates every remote source parent before running the exact eight fresh allocations", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-action-trace-runner-"));
		try {
			const paths = await prepareRun(root);
			const commandRunner = new FauxQualificationCommandRunner();
			const renderer = new FauxRenderer();
			const result = await new CompilerGymActionTraceQualificationRunner(
				{
					repoRoot: REPO_ROOT,
					preregistrationPath: paths.preregistrationPath,
					outputDir: paths.outputDir,
					commandTimeoutMs: 1_000,
					accountingTimeoutMs: 1_000,
					accountingPollMs: 1,
					dispatchLockRoot: paths.dispatchLockRoot,
				},
				{ commandRunner, renderer, historicalEvidenceVerifier: SKIP_HISTORICAL_EVIDENCE },
			).run();

			assert.equal(renderer.closed, true);
			assert.equal(result.modelCalls, 0);
			assert.equal(result.measurementReuse, false);
			assert.equal(result.allocations.length, 8);
			assert.equal(new Set(result.allocations.map((allocation) => allocation.slurmId)).size, 8);
			assert.deepEqual(commandRunner.ensuredPrivateDirectories, [
				"/scratch/users/duynguy/prime-autoresearch-private",
				"/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-action-trace-v3",
				"/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-action-trace-v3/sources",
				result.sourceDirectory,
			]);
			assert.equal(result.protocol, "compiler-gym-action-trace-runner-v3");
			assert.deepEqual(commandRunner.operations, [
				"environment-probe",
				...Array.from({ length: 8 }, () => "srun" as const),
				"environment-probe",
			]);
			assert.equal(commandRunner.environmentProbeCommands.length, 2);
			assert.equal(commandRunner.environmentProbeCommands[0], commandRunner.environmentProbeCommands[1]);
			for (const command of commandRunner.environmentProbeCommands) {
				for (const exactArgument of [
					"'/usr/bin/env' '-i'",
					"'LD_LIBRARY_PATH=/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib'",
					"'COMPILER_GYM_CACHE=/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache'",
					"'COMPILER_GYM_SITE_DATA=/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2'",
					"'PYTHONDONTWRITEBYTECODE=1'",
					"'PYTHONWARNINGS=ignore::FutureWarning'",
					"'/scratch/users/duynguy/prime-autoresearch/compiler-gym-venv-v2/bin/python'",
				]) {
					assert.equal(command.includes(exactArgument), true);
				}
			}
			assert.equal(result.environmentProbe.preflightCommandSequence < result.allocations[0].commandSequence, true);
			assert.equal(
				result.environmentProbe.postflightCommandSequence >
					result.allocations[7].accountingCommandSequences.at(-1)!,
				true,
			);
			assert.deepEqual(
				commandRunner.allocations.map(({ candidateId, benchmarkId, arm }) => ({ candidateId, benchmarkId, arm })),
				COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN.map(({ candidateId, benchmarkId, arm }) => ({
					candidateId,
					benchmarkId,
					arm,
				})),
			);
			for (const allocation of commandRunner.allocations) {
				assert.match(
					allocation.remoteCommand,
					/COMPILER_GYM_TRANSIENT_CACHE=\/tmp\/prime-action-trace-[0-9a-f]{16}-/,
				);
				for (const forbidden of ["--jobid", "--dependency", "--hold", "--overlap", "--exact", "sbatch"]) {
					assert.equal(allocation.remoteCommand.includes(forbidden), false);
				}
			}
			assert.ok(result.assessment.overhead.perCase.every((record) => record.ratio === 1.1));
			assert.equal(result.assessment.projection.ratio, 0.05);
			assert.equal(result.assessment.decision, "qualify-agent-facing-trace-screen");

			const artifacts = new ArtifactStore(join(paths.outputDir, "artifacts"));
			for (const visibility of result.visibilityArtifacts) {
				const control = JSON.parse(await artifacts.readString(visibility.controlEnvelope)) as Record<
					string,
					unknown
				>;
				const combined = JSON.parse(await artifacts.readString(visibility.combinedTreatmentEnvelope)) as Record<
					string,
					unknown
				>;
				assert.deepEqual(Object.keys(control).sort(), [
					"budget",
					"campaignId",
					"job",
					"request",
					"submitted",
					"type",
				]);
				const job = control.job as Record<string, unknown>;
				const proposalRecord = (job.proposal as Record<string, unknown>).proposal as Record<string, unknown>;
				assert.deepEqual(Object.keys(proposalRecord).sort(), [
					"boundaryConditions",
					"hypothesis",
					"mechanism",
					"parentJobIds",
					"predictedOutcome",
				]);
				assert.equal(Object.hasOwn(proposalRecord, "actions"), false);
				assert.equal(Object.hasOwn(control, "actionTrace"), false);
				assert.equal(Object.hasOwn(combined, "actionTrace"), true);
				const serializedControl = JSON.stringify(control);
				const renderedControl = await artifacts.readString(visibility.controlRenderedText);
				for (const forbidden of [
					"trace",
					"actionTrace",
					"hostTrace",
					"compiler-gym-agent-facing-action-trace-v1",
				]) {
					assert.equal(serializedControl.includes(forbidden), false);
					assert.equal(renderedControl.includes(forbidden), false);
				}
				const candidateAllocations = result.allocations.filter(
					(allocation) => allocation.spec.candidateId === visibility.candidateId,
				);
				for (const allocation of candidateAllocations) {
					if (allocation.hostTraceArtifact) {
						assert.equal(serializedControl.includes(allocation.hostTraceArtifact.digest), false);
					}
					if (allocation.spec.arm === "shadow-trace") {
						assert.equal(serializedControl.includes(allocation.stdoutArtifact.digest), false);
						assert.equal(serializedControl.includes(allocation.evaluatorSha256), false);
					}
				}
			}
			const ledger = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 8);
			assert.equal(result.causalTreatmentClaimAllowed, false);
			assert.equal(result.qualificationScope, "instrumentation-cost-and-equivalence-only");
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown> | undefined)?.phase, "complete");
			const claim = ledger.find((event) => event.kind === "claim")?.payload as Record<string, unknown> | undefined;
			assert.equal(claim?.admission, "requires-terminal-complete-ledger-event");

			const duplicateCommandRunner = new FauxQualificationCommandRunner();
			const duplicateRenderer = new FauxRenderer();
			await assert.rejects(
				new CompilerGymActionTraceQualificationRunner(
					{
						repoRoot: REPO_ROOT,
						preregistrationPath: paths.preregistrationPath,
						outputDir: join(root, "duplicate-qualification"),
						commandTimeoutMs: 1_000,
						accountingTimeoutMs: 1_000,
						accountingPollMs: 1,
						dispatchLockRoot: paths.dispatchLockRoot,
					},
					{
						commandRunner: duplicateCommandRunner,
						renderer: duplicateRenderer,
						historicalEvidenceVerifier: SKIP_HISTORICAL_EVIDENCE,
					},
				).run(),
				/EEXIST|already exists/,
			);
			assert.equal(duplicateCommandRunner.allocations.length, 0);
			assert.equal(duplicateRenderer.closed, true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails preflight terminally before any srun allocation", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-action-trace-preflight-"));
		try {
			const paths = await prepareRun(root);
			const commandRunner = new FauxQualificationCommandRunner(null, 4, 1);
			const renderer = new FauxRenderer();
			await assert.rejects(
				new CompilerGymActionTraceQualificationRunner(
					{
						repoRoot: REPO_ROOT,
						preregistrationPath: paths.preregistrationPath,
						outputDir: paths.outputDir,
						commandTimeoutMs: 1_000,
						accountingTimeoutMs: 1_000,
						accountingPollMs: 1,
						dispatchLockRoot: paths.dispatchLockRoot,
					},
					{ commandRunner, renderer, historicalEvidenceVerifier: SKIP_HISTORICAL_EVIDENCE },
				).run(),
				/faux environment probe failure/,
			);
			assert.deepEqual(commandRunner.operations, ["environment-probe"]);
			assert.equal(commandRunner.allocations.length, 0);
			assert.equal(renderer.closed, true);
			await assert.rejects(readFile(join(paths.outputDir, "result.json")), /ENOENT/);
			const ledger = verifyLedgerContentsStrict(await readFile(join(paths.outputDir, "evidence.jsonl"), "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 0);
			assert.equal(
				ledger.some(
					(event) =>
						event.kind === "run_manifest" && (event.payload as Record<string, unknown>).phase === "complete",
				),
				false,
			);
			const finalPayload = ledger.at(-1)?.payload as Record<string, unknown>;
			assert.equal(finalPayload.phase, "failed");
			assert.equal(finalPayload.allocationCount, 0);
			assert.equal(finalPayload.failureDisposition, "terminal-infrastructure-invalid-not-treatment-result");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("withholds result and complete admission when the postflight seal differs", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-action-trace-postflight-"));
		try {
			const paths = await prepareRun(root);
			const commandRunner = new FauxQualificationCommandRunner(null, 4, null, 2);
			const renderer = new FauxRenderer();
			await assert.rejects(
				new CompilerGymActionTraceQualificationRunner(
					{
						repoRoot: REPO_ROOT,
						preregistrationPath: paths.preregistrationPath,
						outputDir: paths.outputDir,
						commandTimeoutMs: 1_000,
						accountingTimeoutMs: 1_000,
						accountingPollMs: 1,
						dispatchLockRoot: paths.dispatchLockRoot,
					},
					{ commandRunner, renderer, historicalEvidenceVerifier: SKIP_HISTORICAL_EVIDENCE },
				).run(),
				/does not exactly match the frozen seal/,
			);
			assert.deepEqual(commandRunner.operations, [
				"environment-probe",
				...Array.from({ length: 8 }, () => "srun" as const),
				"environment-probe",
			]);
			assert.equal(commandRunner.allocations.length, 8);
			assert.equal(renderer.closed, true);
			await assert.rejects(readFile(join(paths.outputDir, "result.json")), /ENOENT/);
			const ledger = verifyLedgerContentsStrict(await readFile(join(paths.outputDir, "evidence.jsonl"), "utf8"));
			assert.equal(
				ledger.some(
					(event) =>
						event.kind === "run_manifest" && (event.payload as Record<string, unknown>).phase === "complete",
				),
				false,
			);
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).phase, "failed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails a partial run terminally without retry or replacement", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-action-trace-partial-"));
		try {
			const paths = await prepareRun(root);
			const commandRunner = new FauxQualificationCommandRunner(3);
			const renderer = new FauxRenderer();
			await assert.rejects(
				new CompilerGymActionTraceQualificationRunner(
					{
						repoRoot: REPO_ROOT,
						preregistrationPath: paths.preregistrationPath,
						outputDir: paths.outputDir,
						commandTimeoutMs: 1_000,
						accountingTimeoutMs: 1_000,
						accountingPollMs: 1,
						dispatchLockRoot: paths.dispatchLockRoot,
					},
					{ commandRunner, renderer, historicalEvidenceVerifier: SKIP_HISTORICAL_EVIDENCE },
				).run(),
				/faux transport failure/,
			);
			assert.equal(commandRunner.allocations.length, 2);
			assert.equal(renderer.closed, true);
			await assert.rejects(readFile(join(paths.outputDir, "result.json")), /ENOENT/);
			const ledger = verifyLedgerContentsStrict(await readFile(join(paths.outputDir, "evidence.jsonl"), "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 2);
			const finalPayload = ledger.at(-1)?.payload as Record<string, unknown>;
			assert.equal(finalPayload.phase, "failed");
			assert.equal(finalPayload.failureDisposition, "terminal-infrastructure-invalid-not-treatment-result");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects root accounting CPU counts outside the frozen observed set", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-action-trace-accounting-"));
		try {
			const paths = await prepareRun(root);
			const renderer = new FauxRenderer();
			await assert.rejects(
				new CompilerGymActionTraceQualificationRunner(
					{
						repoRoot: REPO_ROOT,
						preregistrationPath: paths.preregistrationPath,
						outputDir: paths.outputDir,
						commandTimeoutMs: 1_000,
						accountingTimeoutMs: 1_000,
						accountingPollMs: 1,
						dispatchLockRoot: paths.dispatchLockRoot,
					},
					{
						commandRunner: new FauxQualificationCommandRunner(null, 1),
						renderer,
						historicalEvidenceVerifier: SKIP_HISTORICAL_EVIDENCE,
					},
				).run(),
				/frozen resources/,
			);
			assert.equal(renderer.closed, true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses the built-in IPython result renderer for the frozen native cell", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-action-trace-renderer-"));
		const renderer = new NativeCompilerGymActionTraceModelValueRenderer(root);
		try {
			const rendered = await renderer.render('{"value":"native"}\n', new AbortController().signal);
			assert.equal(rendered.rendererProtocol, COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL);
			assert.equal(rendered.agentFacingBytes, Buffer.byteLength(rendered.text, "utf8"));
			assert.equal(rendered.renderedTextSha256, sha256Text(rendered.text));
			assert.match(rendered.text, /native/);
		} finally {
			await renderer.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});

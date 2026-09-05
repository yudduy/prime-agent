import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_ACTION_TRACE_CANDIDATES,
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT,
	COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE,
	COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
	COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS,
} from "../src/compiler-gym-action-trace-preregistration.js";
import type {
	CompilerGymActionTraceModelValueRenderer,
	CompilerGymActionTraceRenderedValue,
} from "../src/compiler-gym-action-trace-qualification-runner.js";
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
	buildCompilerGymIrDeltaQualificationPreregistration,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS,
	DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
	writeCompilerGymIrDeltaQualificationPreregistration,
} from "../src/compiler-gym-ir-delta-qualification-preregistration.js";
import {
	type CompilerGymIrDeltaQualificationEvidenceVerifier,
	CompilerGymIrDeltaQualificationRunner,
	compilerGymIrDeltaQualificationSrunArgv,
	parseCompilerGymIrDeltaQualificationAccounting,
	parseCompilerGymIrDeltaQualificationEvaluatorResult,
} from "../src/compiler-gym-ir-delta-qualification-runner.js";
import { COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT } from "../src/compiler-gym-ir-delta-smoke-preregistration.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "../src/compiler-gym-ir-delta-smoke-protocol.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ACTIONS = [...COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS];
const ACTION_INDICES = ACTIONS.map((_, index) => index + 10);

function evaluatorOutput(input: {
	arm: "canonical" | "one-env-ir-delta";
	status?: "passed" | "semantic_validation_failed" | "validation_incomplete";
	forbiddenTraceMetadata?: boolean;
	malformedValidationPassed?: boolean;
}): string {
	const status = input.status ?? "passed";
	const passed = status === "passed";
	const completed = status === "validation_incomplete" ? 19 : 20;
	const result: Record<string, unknown> = {
		schema_version: 2,
		contract: input.arm === "canonical" ? COMPILER_GYM_VERIFIER_EPOCH : COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
		ok: passed,
		status,
		benchmark: "benchmark://cbench-v1/blowfish",
		request: { benchmark: "benchmark://cbench-v1/blowfish", actions: ACTIONS },
		action_indices: ACTION_INDICES,
		commandline: `opt ${ACTIONS.join(" ")}`,
		metrics: {
			initial: { IrInstructionCount: 2027, ObjectTextSizeBytes: 24_000 },
			final: { IrInstructionCount: 1970, ObjectTextSizeBytes: 21501 },
		},
		validation: {
			passed: input.malformedValidationPassed ? "false" : passed,
			inputs_expected: 20,
			inputs_completed: completed,
			base_callbacks_selected: 20,
			sanitizer_callbacks_selected: 0,
			semantic_errors: passed ? [] : ["synthetic semantic rejection"],
			inputs: Array.from({ length: 20 }, (_, index) => {
				const rejected = !passed && status !== "validation_incomplete" && index === 0;
				return {
					input_index: index + 1,
					completed: status !== "validation_incomplete" || index < 19,
					passed: !rejected,
					errors: rejected ? ["synthetic semantic rejection"] : [],
				};
			}),
		},
		environment: {
			slurm_job_id: "1703001",
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
		step_info: { retained: false },
	};
	if (input.arm === "one-env-ir-delta") {
		result.terminal_verifier_contract = COMPILER_GYM_VERIFIER_EPOCH;
		if (passed) {
			const records = ACTIONS.map((action, index) => ({
				index,
				action,
				action_index: ACTION_INDICES[index],
				delta_from_previous: index === 0 ? -57 : 0,
			})) as Array<Record<string, unknown>>;
			if (input.forbiddenTraceMetadata) records[0].action_had_no_effect = false;
			result.action_trace = {
				contract: COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
				prefix_conditional: true,
				intermediate_semantic_status: "unverified",
				terminal_semantic_status: "canonical-20-input-verifier",
				zero_delta_semantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
				benchmark: "benchmark://cbench-v1/blowfish",
				actions: ACTIONS,
				action_indices: ACTION_INDICES,
				initial_ir_instruction_count: 2027,
				records,
			};
		}
	}
	return `${JSON.stringify(result)}\n`;
}

function commandResult(stdout = "", stderr = "", exitCode = 0): CompilerGymWarmCommandResult {
	return { stdout, stderr, exitCode, wallMs: 5 };
}

class FauxRenderer implements CompilerGymActionTraceModelValueRenderer {
	readonly events: string[];

	constructor(
		events: string[],
		private readonly zeroIncrement = false,
	) {
		this.events = events;
	}

	render(jsonValue: string, _signal: AbortSignal): Promise<CompilerGymActionTraceRenderedValue> {
		this.events.push("render");
		const text = this.zeroIncrement ? "x" : jsonValue.trimEnd();
		const cell = COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE.replace(
			"__CANONICAL_STDOUT_JSON__",
			JSON.stringify(jsonValue.trimEnd()),
		);
		return Promise.resolve({
			text,
			renderedTextSha256: sha256Text(text),
			agentFacingBytes: Buffer.byteLength(text, "utf8"),
			cellSha256: sha256Text(cell),
			rendererProtocol: COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
		});
	}

	close(): Promise<void> {
		this.events.push("renderer-close");
		return Promise.resolve();
	}
}

class FauxFarmShare implements CompilerGymWarmCommandRunner {
	private srunCount = 0;
	private readonly jobs = new Map<string, { jobName: string; semanticRejection: boolean }>();
	readonly events: string[];

	constructor(
		events: string[],
		private readonly semanticRejectionAllocation: number | null = null,
	) {
		this.events = events;
	}

	run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		const remoteCommand = request.argv.at(-1) ?? "";
		if (remoteCommand.includes("compiler_gym_env_probe.py") && remoteCommand.includes("'/usr/bin/env' '-i'")) {
			this.events.push("probe");
			return Promise.resolve(
				commandResult(
					`${canonicalJson(toJsonValue(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT))}\n`,
				),
			);
		}
		if (remoteCommand.includes("'/usr/bin/srun'")) return Promise.resolve(this.evaluate(request, remoteCommand));
		if (remoteCommand.includes("'/usr/bin/sacct'")) return Promise.resolve(this.account(remoteCommand));
		if (remoteCommand.includes("'/usr/bin/squeue'")) {
			this.events.push("squeue");
			return Promise.resolve(commandResult());
		}
		this.events.push("ssh-setup");
		return Promise.resolve(commandResult());
	}

	private evaluate(request: CompilerGymWarmCommandRequest, remoteCommand: string): CompilerGymWarmCommandResult {
		this.events.push("srun");
		this.srunCount += 1;
		if (!request.input) throw new Error("Faux evaluator requires request input");
		const parsedRequest = JSON.parse(request.input) as { benchmark: string; actions: string[] };
		const candidate = COMPILER_GYM_ACTION_TRACE_CANDIDATES.find(
			(item) => JSON.stringify(item.actions) === JSON.stringify(parsedRequest.actions),
		);
		if (!candidate) throw new Error("Faux evaluator received an unknown candidate");
		const expected = candidate.expectedMetrics[parsedRequest.benchmark as keyof typeof candidate.expectedMetrics];
		if (!expected) throw new Error("Faux evaluator received an unknown benchmark");
		const treatment = remoteCommand.includes("compiler_gym_ir_delta_eval.py");
		const semanticRejection = treatment && this.srunCount === this.semanticRejectionAllocation;
		const jobName = /'--job-name=([^']+)'/.exec(remoteCommand)?.[1];
		if (!jobName) throw new Error("Faux srun lacks a job name");
		const slurmId = String(1_703_000 + this.srunCount);
		this.jobs.set(slurmId, { jobName, semanticRejection });
		const actionIndices = parsedRequest.actions.map((_, index) => index + 10);
		const initialIr = expected.irInstructionCount + 100;
		const validationInputs = Array.from({ length: 20 }, (_, index) => {
			const rejected = semanticRejection && index === 0;
			return {
				input_index: index + 1,
				completed: true,
				passed: !rejected,
				errors: rejected ? ["synthetic semantic rejection"] : [],
			};
		});
		const result: Record<string, unknown> = {
			schema_version: 2,
			contract: treatment ? COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT : COMPILER_GYM_VERIFIER_EPOCH,
			ok: !semanticRejection,
			status: semanticRejection ? "semantic_validation_failed" : "passed",
			benchmark: parsedRequest.benchmark,
			request: parsedRequest,
			action_indices: actionIndices,
			commandline: `opt ${parsedRequest.actions.join(" ")}`,
			metrics: {
				initial: { IrInstructionCount: initialIr, ObjectTextSizeBytes: expected.objectTextSizeBytes + 1_000 },
				final: {
					IrInstructionCount: expected.irInstructionCount,
					ObjectTextSizeBytes: expected.objectTextSizeBytes,
				},
			},
			validation: {
				passed: !semanticRejection,
				inputs_expected: 20,
				inputs_completed: 20,
				base_callbacks_selected: 20,
				sanitizer_callbacks_selected: 0,
				semantic_errors: semanticRejection ? ["synthetic semantic rejection"] : [],
				inputs: validationInputs,
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
			step_info: { retained: false },
		};
		if (treatment) {
			result.terminal_verifier_contract = COMPILER_GYM_VERIFIER_EPOCH;
		}
		if (treatment && !semanticRejection) {
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
					delta_from_previous: index === 0 ? -100 : 0,
				})),
			};
		}
		return commandResult(`${JSON.stringify(result)}\n`, "", semanticRejection ? 5 : 0);
	}

	private account(remoteCommand: string): CompilerGymWarmCommandResult {
		this.events.push("sacct");
		const slurmId = /'--jobs' '([0-9]+)'/.exec(remoteCommand)?.[1];
		if (!slurmId) throw new Error("Faux sacct lacks a Slurm ID");
		const job = this.jobs.get(slurmId);
		if (!job) throw new Error("Faux sacct queried an unknown job");
		const state = job.semanticRejection ? "FAILED" : "COMPLETED";
		const exitCode = job.semanticRejection ? "5:0" : "0:0";
		return commandResult(
			`${slurmId}|${job.jobName}|${state}|${exitCode}|4||6|24|barley-01|2026-08-28T23:00:00|2026-08-28T23:00:06\n`,
		);
	}
}

class CountingEvidenceVerifier implements CompilerGymIrDeltaQualificationEvidenceVerifier {
	calls = 0;

	verify(): Promise<void> {
		this.calls += 1;
		return Promise.resolve();
	}
}

async function prepareQualification(root: string, createdAt = "2026-08-29T00:30:00.000Z") {
	const canonicalPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const treatmentPath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const environmentProbePath = resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_env_probe.py");
	const preregistration = buildCompilerGymIrDeltaQualificationPreregistration({
		createdAt,
		primeAgentCommit: "bc0fa7606abb3b7af0f765319518d255e6ae553d",
		canonicalPath,
		canonicalSource: await readFile(canonicalPath, "utf8"),
		treatmentPath,
		treatmentSource: await readFile(treatmentPath, "utf8"),
		environmentProbePath,
		environmentProbeSource: await readFile(environmentProbePath, "utf8"),
		implementationClosure: await Promise.all(
			COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(REPO_ROOT, relativePath), "utf8")),
			})),
		),
	});
	const preregistrationPath = join(root, "preregistration.json");
	await writeCompilerGymIrDeltaQualificationPreregistration(preregistrationPath, preregistration);
	return { preregistrationPath, outputDir: join(root, "execution"), dispatchLockRoot: join(root, "locks") };
}

describe("CompilerGym formal one-environment IR-delta runner contracts", () => {
	it("runs the frozen eight-allocation apparatus with renderer-before-SSH and terminal admission", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-qualification-"));
		try {
			const paths = await prepareQualification(root);
			const events: string[] = [];
			const commandRunner = new FauxFarmShare(events);
			const renderer = new FauxRenderer(events);
			const evidenceVerifier = new CountingEvidenceVerifier();
			const runner = new CompilerGymIrDeltaQualificationRunner(
				{
					repoRoot: REPO_ROOT,
					preregistrationPath: paths.preregistrationPath,
					outputDir: paths.outputDir,
					commandTimeoutMs: 1_000,
					accountingTimeoutMs: 1_000,
					accountingPollMs: 1,
					dispatchLockRoot: paths.dispatchLockRoot,
				},
				{ commandRunner, renderer, evidenceVerifier },
			);
			const result = await runner.run();
			assert.deepEqual(events.slice(0, 2), ["render", "render"]);
			assert.equal(events.filter((item) => item === "srun").length, 8);
			assert.equal(events.filter((item) => item === "sacct").length, 8);
			assert.equal(result.allocations.length, 8);
			assert.equal(new Set(result.allocations.map((item) => item.slurmId)).size, 8);
			assert.equal(new Set(result.allocations.map((item) => item.transientCache)).size, 8);
			assert.equal(result.assessment.decision, "qualify-agent-facing-ir-delta-screen");
			assert.equal(result.lunaAuthorized, false);
			assert.equal(result.measurementReuse, false);
			assert.equal(result.formalMeasurementsReused, false);
			assert.equal(result.smokeMeasurementsUsed, false);
			assert.equal(result.causalTreatmentClaimAllowed, false);
			assert.equal(result.terminalDisposition, "terminal-complete-scientific-pass");
			assert.ok(result.rendererPreflight.incrementalBytes > 0);
			assert.equal(evidenceVerifier.calls, 2);
			assert.equal(result.visibility?.candidates.length, 2);
			const ledger = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			assert.equal(ledger.filter((event) => event.kind === "measurement").length, 8);
			const start = ledger.find(
				(event) =>
					(event.payload as Record<string, unknown>).type === "ir_delta_qualification" &&
					(event.payload as Record<string, unknown>).phase === "start",
			);
			const terminal = ledger.at(-1);
			for (const event of [start, terminal]) {
				const payload = event?.payload as Record<string, unknown>;
				assert.equal(payload.smokeMeasurementsUsed, false);
				assert.equal(payload.causalTreatmentClaimAllowed, false);
				assert.equal(payload.measurementReuse, false);
				assert.equal(payload.formalMeasurementsReused, false);
			}
			assert.equal((terminal?.payload as Record<string, unknown>).phase, "complete");
			assert.equal(result.ledgerEventCount, ledger.length);

			const secondPaths = await prepareQualification(join(root, "second"), "2026-08-29T00:31:00.000Z");
			const secondEvents: string[] = [];
			const secondRunner = new CompilerGymIrDeltaQualificationRunner(
				{
					repoRoot: REPO_ROOT,
					preregistrationPath: secondPaths.preregistrationPath,
					outputDir: secondPaths.outputDir,
					commandTimeoutMs: 1_000,
					accountingTimeoutMs: 1_000,
					accountingPollMs: 1,
					dispatchLockRoot: paths.dispatchLockRoot,
				},
				{
					commandRunner: new FauxFarmShare(secondEvents),
					renderer: new FauxRenderer(secondEvents),
					evidenceVerifier: new CountingEvidenceVerifier(),
				},
			);
			await assert.rejects(secondRunner.run(), /EEXIST|already exists/);
			assert.equal(secondEvents.includes("srun"), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("terminally admits exact exit-5 and FAILED/5:0 treatment rejection as a scientific kill", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-semantic-kill-"));
		try {
			const paths = await prepareQualification(root);
			const events: string[] = [];
			const commandRunner = new FauxFarmShare(events, 2);
			const renderer = new FauxRenderer(events);
			const evidenceVerifier = new CountingEvidenceVerifier();
			const result = await new CompilerGymIrDeltaQualificationRunner(
				{
					repoRoot: REPO_ROOT,
					preregistrationPath: paths.preregistrationPath,
					outputDir: paths.outputDir,
					commandTimeoutMs: 1_000,
					accountingTimeoutMs: 1_000,
					accountingPollMs: 1,
					dispatchLockRoot: paths.dispatchLockRoot,
				},
				{ commandRunner, renderer, evidenceVerifier },
			).run();
			assert.equal(result.allocations.length, 8);
			const rejected = result.allocations[1];
			assert.equal(rejected.parsed.outcome, "semantic-rejection");
			assert.equal(rejected.accounting.state, "FAILED");
			assert.equal(rejected.accounting.exitCode, "5:0");
			assert.equal(result.assessment.decision, "kill-ir-delta-trace");
			assert.equal(result.terminalDisposition, "terminal-complete-scientific-kill");
			assert.equal(result.visibility, null);
			assert.equal(result.lunaAuthorized, false);
			assert.equal(evidenceVerifier.calls, 2);
			const ledger = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			const terminal = ledger.at(-1)?.payload as Record<string, unknown>;
			assert.equal(terminal.phase, "complete");
			assert.equal(terminal.terminalDisposition, "terminal-complete-scientific-kill");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects zero-increment native rendering before any SSH or Slurm allocation", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-renderer-invalid-"));
		try {
			const paths = await prepareQualification(root);
			const events: string[] = [];
			const commandRunner = new FauxFarmShare(events);
			const renderer = new FauxRenderer(events, true);
			const evidenceVerifier = new CountingEvidenceVerifier();
			const runner = new CompilerGymIrDeltaQualificationRunner(
				{
					repoRoot: REPO_ROOT,
					preregistrationPath: paths.preregistrationPath,
					outputDir: paths.outputDir,
					commandTimeoutMs: 1_000,
					accountingTimeoutMs: 1_000,
					accountingPollMs: 1,
					dispatchLockRoot: paths.dispatchLockRoot,
				},
				{ commandRunner, renderer, evidenceVerifier },
			);
			await assert.rejects(runner.run(), /positive projection-only increment/);
			assert.deepEqual(events, ["render", "render", "renderer-close"]);
			assert.equal(evidenceVerifier.calls, 2);
			await assert.rejects(readFile(join(paths.outputDir, "result.json")), /ENOENT/);
			const ledger = verifyLedgerContentsStrict(await readFile(join(paths.outputDir, "evidence.jsonl"), "utf8"));
			const terminal = ledger.at(-1)?.payload as Record<string, unknown>;
			assert.equal(terminal.phase, "failed");
			assert.equal(terminal.failureDisposition, "terminal-apparatus-invalid-not-treatment-result");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("parses exact passing canonical and treatment results", () => {
		const canonical = parseCompilerGymIrDeltaQualificationEvaluatorResult({
			stdout: evaluatorOutput({ arm: "canonical" }),
			exitCode: 0,
			arm: "canonical",
			benchmarkId: "benchmark://cbench-v1/blowfish",
			actions: ACTIONS,
		});
		const treatment = parseCompilerGymIrDeltaQualificationEvaluatorResult({
			stdout: evaluatorOutput({ arm: "one-env-ir-delta" }),
			exitCode: 0,
			arm: "one-env-ir-delta",
			benchmarkId: "benchmark://cbench-v1/blowfish",
			actions: ACTIONS,
		});
		assert.equal(canonical.outcome, "verified");
		assert.equal(canonical.trace, null);
		assert.equal(treatment.outcome, "verified");
		assert.equal(treatment.traceIntegrity.passed, true);
		assert.equal(treatment.trace?.records.length, 12);
		assert.equal(
			treatment.trace?.records.reduce((sum, item) => sum + item.deltaFromPrevious, 0),
			-57,
		);
	});

	it("admits only exit-5 complete treatment semantic rejection as a scientific outcome", () => {
		const rejected = parseCompilerGymIrDeltaQualificationEvaluatorResult({
			stdout: evaluatorOutput({ arm: "one-env-ir-delta", status: "semantic_validation_failed" }),
			exitCode: 5,
			arm: "one-env-ir-delta",
			benchmarkId: "benchmark://cbench-v1/blowfish",
			actions: ACTIONS,
		});
		assert.equal(rejected.outcome, "semantic-rejection");
		assert.equal(rejected.final.verifierPassed, false);
		assert.equal(rejected.final.verifierInputsCompleted, 20);
		assert.equal(rejected.trace, null);
		assert.equal(rejected.traceIntegrity.passed, false);

		assert.throws(
			() =>
				parseCompilerGymIrDeltaQualificationEvaluatorResult({
					stdout: evaluatorOutput({ arm: "one-env-ir-delta", status: "validation_incomplete" }),
					exitCode: 4,
					arm: "one-env-ir-delta",
					benchmarkId: "benchmark://cbench-v1/blowfish",
					actions: ACTIONS,
				}),
			/not a structured complete semantic rejection/,
		);
		assert.throws(
			() =>
				parseCompilerGymIrDeltaQualificationEvaluatorResult({
					stdout: evaluatorOutput({
						arm: "one-env-ir-delta",
						status: "semantic_validation_failed",
						malformedValidationPassed: true,
					}),
					exitCode: 5,
					arm: "one-env-ir-delta",
					benchmarkId: "benchmark://cbench-v1/blowfish",
					actions: ACTIONS,
				}),
			/result.validation.passed must be a boolean/,
		);
	});

	it("classifies forbidden pass-reported metadata as treatment trace-integrity failure", () => {
		const parsed = parseCompilerGymIrDeltaQualificationEvaluatorResult({
			stdout: evaluatorOutput({ arm: "one-env-ir-delta", forbiddenTraceMetadata: true }),
			exitCode: 0,
			arm: "one-env-ir-delta",
			benchmarkId: "benchmark://cbench-v1/blowfish",
			actions: ACTIONS,
		});
		assert.equal(parsed.outcome, "verified");
		assert.equal(parsed.trace, null);
		assert.equal(parsed.traceIntegrity.passed, false);
		assert.match(parsed.traceIntegrity.errors.join("\n"), /action_had_no_effect is forbidden/);
	});

	it("binds root accounting and rejects unsafe CPUTimeRAW multiplication", () => {
		assert.deepEqual(
			parseCompilerGymIrDeltaQualificationAccounting(
				"1703001|pidq-1-s12-blowfish-c|FAILED|5:0|4||6|24|barley-01|2026-08-28T23:00:00|2026-08-28T23:00:06\n",
			),
			{
				jobIdRaw: "1703001",
				jobName: "pidq-1-s12-blowfish-c",
				state: "FAILED",
				exitCode: "5:0",
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
				parseCompilerGymIrDeltaQualificationAccounting(
					"1703001|pidq-1-s12-blowfish-c|COMPLETED|0:0|9007199254740991||2|9007199254740991|barley-01|2026-08-28T23:00:00|2026-08-28T23:00:06\n",
				),
			/multiplied by ElapsedRaw is not a safe integer/,
		);
	});

	it("constructs only independent stock-cold srun allocations with fresh cache identities", () => {
		const first = compilerGymIrDeltaQualificationSrunArgv({
			spec: COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN[0],
			remoteEvaluatorPath: "/scratch/users/duynguy/source/compiler_gym_eval.py",
			environment: DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
			dispatchNonce: "0123456789abcdef",
		});
		const second = compilerGymIrDeltaQualificationSrunArgv({
			spec: COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN[1],
			remoteEvaluatorPath: "/scratch/users/duynguy/source/compiler_gym_ir_delta_eval.py",
			environment: DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
			dispatchNonce: "0123456789abcdef",
		});
		assert.notEqual(first.transientCache, second.transientCache);
		assert.notEqual(first.jobName, second.jobName);
		assert.ok(first.argv.includes("--cpus-per-task=2"));
		assert.ok(first.argv.includes(`COMPILER_GYM_TRANSIENT_CACHE=${first.transientCache}`));
		for (const forbidden of ["sbatch", "--jobid", "--dependency", "--overlap", "--exact", "--hold"]) {
			assert.equal(
				first.argv.some((item) => item.includes(forbidden)),
				false,
			);
		}
	});
});

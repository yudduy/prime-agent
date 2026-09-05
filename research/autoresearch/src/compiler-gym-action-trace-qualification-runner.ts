import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createIpythonTool, IpythonKernelProvisioner } from "../../../packages/coding-agent/src/core/tools/ipython.js";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	buildCompilerGymActionTracePreregistration,
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT,
	COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN,
	COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS,
	COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE,
	COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
	COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL,
	COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID,
	type CompilerGymActionTraceArm,
	type CompilerGymActionTraceEnvironmentProbeResult,
	type CompilerGymActionTraceExecutionSpec,
	type CompilerGymActionTracePreregistration,
	parseCompilerGymActionTracePreregistration,
} from "./compiler-gym-action-trace-preregistration.js";
import {
	assessCompilerGymActionTraceQualification,
	buildCompilerGymActionTraceTreatmentEnvelopes,
	COMPILER_GYM_ACTION_TRACE_PROTOCOL,
	COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL,
	type CompilerGymActionTraceAssessment,
	type CompilerGymActionTraceQualificationCase,
	type CompilerGymActionTraceVisibilityEvidence,
} from "./compiler-gym-action-trace-protocol.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
} from "./compiler-gym-adapter.js";
import {
	type CompilerGymWarmCommandRequest,
	type CompilerGymWarmCommandResult,
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	compilerGymWarmSshArgv,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import { buildStockCpuEvaluationEnvelope } from "./stock-cpu-evaluation-envelope.js";
import type { ArtifactRef, BranchBudgetStatus, JobView, SubmitResult } from "./types.js";

const RUNNER_PROTOCOL = "compiler-gym-action-trace-runner-v3" as const;
const EVALUATOR_TRACE_CONTRACT = "compiler-gym-shadow-action-trace-v1" as const;
const TERMINAL_STATES = new Set([
	"BOOT_FAIL",
	"CANCELLED",
	"COMPLETED",
	"DEADLINE",
	"FAILED",
	"NODE_FAIL",
	"OUT_OF_MEMORY",
	"PREEMPTED",
	"REVOKED",
	"TIMEOUT",
]);
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;

export interface CompilerGymActionTraceQualificationRunnerConfig {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	commandTimeoutMs: number;
	accountingTimeoutMs: number;
	accountingPollMs: number;
	dispatchLockRoot?: string;
}

export const DEFAULT_COMPILER_GYM_ACTION_TRACE_RUNNER_LIMITS = {
	commandTimeoutMs: 6 * 60_000,
	accountingTimeoutMs: 2 * 60_000,
	accountingPollMs: 1_000,
} as const;

export interface CompilerGymActionTraceRunnerClock {
	now(): Date;
	monotonicNs(): bigint;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export class SystemCompilerGymActionTraceRunnerClock implements CompilerGymActionTraceRunnerClock {
	now(): Date {
		return new Date();
	}

	monotonicNs(): bigint {
		return process.hrtime.bigint();
	}

	sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolveSleep, reject) => {
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", abort);
				resolveSleep();
			};
			const timer = setTimeout(finish, ms);
			const abort = (): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}

export interface CompilerGymActionTraceRenderedValue {
	text: string;
	renderedTextSha256: string;
	agentFacingBytes: number;
	cellSha256: string;
	rendererProtocol: typeof COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL;
}

export interface CompilerGymActionTraceModelValueRenderer {
	render(jsonValue: string, signal: AbortSignal): Promise<CompilerGymActionTraceRenderedValue>;
	close(): Promise<void>;
}

export class NativeCompilerGymActionTraceModelValueRenderer implements CompilerGymActionTraceModelValueRenderer {
	private readonly provisioner: IpythonKernelProvisioner;
	private readonly tool: ReturnType<typeof createIpythonTool>;

	constructor(cwd: string) {
		this.provisioner = new IpythonKernelProvisioner(cwd);
		this.tool = createIpythonTool(cwd, { provisioner: this.provisioner });
	}

	async render(jsonValue: string, signal: AbortSignal): Promise<CompilerGymActionTraceRenderedValue> {
		parseSingleJsonLine(jsonValue, "native renderer JSON value");
		const cell = COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE.replace(
			"__CANONICAL_STDOUT_JSON__",
			JSON.stringify(jsonValue.trimEnd()),
		);
		if (cell.includes("__CANONICAL_STDOUT_JSON__")) throw new Error("Native renderer placeholder was not replaced");
		const result = await this.tool.execute(
			`action-trace-render-${sha256Text(jsonValue).slice(0, 16)}`,
			{ code: cell },
			signal,
			undefined,
		);
		if (result.details?.status !== "ok" || result.content.length !== 1 || result.content[0]?.type !== "text") {
			throw new Error("Native IPython renderer did not return exactly one successful text content block");
		}
		const text = result.content[0].text;
		if (text.length === 0) throw new Error("Native IPython renderer returned empty model-visible text");
		return {
			text,
			renderedTextSha256: sha256Text(text),
			agentFacingBytes: Buffer.byteLength(text, "utf8"),
			cellSha256: sha256Text(cell),
			rendererProtocol: COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
		};
	}

	close(): Promise<void> {
		return this.provisioner.dispose();
	}
}

export interface CompilerGymActionTraceHistoricalEvidenceVerifier {
	verify(preregistration: CompilerGymActionTracePreregistration, repoRoot: string): Promise<void>;
}

class LocalCompilerGymActionTraceHistoricalEvidenceVerifier
	implements CompilerGymActionTraceHistoricalEvidenceVerifier
{
	async verify(preregistration: CompilerGymActionTracePreregistration, repoRoot: string): Promise<void> {
		for (const candidate of preregistration.candidates) {
			const contents = await readFile(resolve(repoRoot, candidate.sourceEvidence.ledgerPath), "utf8");
			if (sha256Text(contents) !== candidate.sourceEvidence.ledgerSha256) {
				throw new Error(`${candidate.candidateId} source evidence ledger hash mismatch`);
			}
			const events = verifyLedgerContentsStrict(contents);
			for (const expected of [
				candidate.sourceEvidence.proposalEventSha256,
				candidate.sourceEvidence.measurementEventSha256,
			]) {
				if (!events.some((event) => event.hash === expected)) {
					throw new Error(`${candidate.candidateId} source evidence event ${expected} is absent`);
				}
			}
		}
	}
}

export interface CompilerGymActionTraceQualificationRunnerDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	clock?: CompilerGymActionTraceRunnerClock;
	renderer?: CompilerGymActionTraceModelValueRenderer;
	historicalEvidenceVerifier?: CompilerGymActionTraceHistoricalEvidenceVerifier;
}

interface CommandEvidence {
	sequence: number;
	argv: string[];
	argvSha256: string;
	input: ArtifactRef | null;
	startedAt: string;
	finishedAt: string;
	startedMonotonicNs: string;
	finishedMonotonicNs: string;
	exitCode: number | null;
	wallMs: number | null;
	stdout: ArtifactRef | null;
	stderr: ArtifactRef | null;
	error: string | null;
}

class RecordingCompilerGymActionTraceCommandRunner implements CompilerGymWarmCommandRunner {
	private sequence = 0;

	constructor(
		private readonly delegate: CompilerGymWarmCommandRunner,
		private readonly artifacts: ArtifactStore,
		private readonly ledger: EvidenceLedger,
		private readonly clock: CompilerGymActionTraceRunnerClock,
	) {}

	nextSequence(): number {
		return this.sequence;
	}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		const sequence = this.sequence++;
		const startedAt = this.clock.now().toISOString();
		const startedMonotonicNs = this.clock.monotonicNs();
		const input =
			request.input === undefined ? null : await this.artifacts.putString(request.input, "application/octet-stream");
		let result: CompilerGymWarmCommandResult | null = null;
		let stdout: ArtifactRef | null = null;
		let stderr: ArtifactRef | null = null;
		let errorText: string | null = null;
		try {
			result = await this.delegate.run(request);
			stdout = await this.artifacts.putString(result.stdout, "text/plain");
			stderr = await this.artifacts.putString(result.stderr, "text/plain");
			return result;
		} catch (error) {
			errorText = error instanceof Error ? (error.stack ?? error.message) : String(error);
			throw error;
		} finally {
			const finishedMonotonicNs = this.clock.monotonicNs();
			const evidence: CommandEvidence = {
				sequence,
				argv: [...request.argv],
				argvSha256: sha256Json(request.argv),
				input,
				startedAt,
				finishedAt: this.clock.now().toISOString(),
				startedMonotonicNs: startedMonotonicNs.toString(),
				finishedMonotonicNs: finishedMonotonicNs.toString(),
				exitCode: result?.exitCode ?? null,
				wallMs: result?.wallMs ?? null,
				stdout,
				stderr,
				error: errorText,
			};
			await this.ledger.append("run_manifest", {
				type: "action_trace_command",
				protocol: RUNNER_PROTOCOL,
				...evidence,
			});
		}
	}
}

interface ParsedEvaluatorResult {
	benchmarkId: string;
	actions: string[];
	actionIndices: number[];
	final: { irInstructionCount: number; objectTextSizeBytes: number; verifierPassed: true };
	intrinsicRuntimeMs: number;
	shadowActionTraceMs: number | null;
	slurmId: string;
	trace: CompilerGymActionTraceQualificationCase["shadow"]["trace"] | null;
}

export interface CompilerGymActionTraceAccounting {
	jobIdRaw: string;
	jobName: string;
	state: string;
	exitCode: string;
	allocCpus: number;
	nTasks: number | null;
	elapsedRawSeconds: number;
	cpuTimeRawSeconds: number;
	nodeList: string;
	startAt: string;
	endAt: string;
}

export interface CompilerGymActionTraceAllocationEvidence {
	spec: CompilerGymActionTraceExecutionSpec;
	requestSha256: string;
	evaluatorSha256: string;
	remoteArgv: string[];
	outerArgv: string[];
	commandSequence: number;
	slurmId: string;
	accountingCommandSequences: number[];
	accounting: CompilerGymActionTraceAccounting;
	parsed: ParsedEvaluatorResult;
	stdoutArtifact: ArtifactRef;
	stderrArtifact: ArtifactRef;
	controlStdoutArtifact: ArtifactRef;
	hostTraceArtifact: ArtifactRef | null;
}

export interface CompilerGymActionTraceVisibilityArtifact {
	candidateId: string;
	controlEnvelope: ArtifactRef;
	controlRenderedText: ArtifactRef;
	typedTraceEnvelope: ArtifactRef;
	combinedTreatmentEnvelope: ArtifactRef;
	combinedTreatmentRenderedText: ArtifactRef;
}

export interface CompilerGymActionTraceQualificationResult {
	protocol: typeof RUNNER_PROTOCOL;
	admission: "requires-terminal-complete-ledger-event";
	causalTreatmentClaimAllowed: false;
	qualificationScope: "instrumentation-cost-and-equivalence-only";
	qualificationId: typeof COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID;
	preregistrationSha256: string;
	sourceDirectory: string;
	modelCalls: 0;
	measurementReuse: false;
	dispatchAttempt: CompilerGymActionTraceDispatchAttempt;
	accountingContract: CompilerGymActionTraceAccountingContract;
	environmentProbe: {
		sourceSha256: string;
		preflightCommandSequence: number;
		postflightCommandSequence: number;
		stdoutSha256: string;
		result: CompilerGymActionTraceEnvironmentProbeResult;
	};
	allocations: CompilerGymActionTraceAllocationEvidence[];
	cases: CompilerGymActionTraceQualificationCase[];
	visibility: CompilerGymActionTraceVisibilityEvidence;
	visibilityArtifacts: CompilerGymActionTraceVisibilityArtifact[];
	assessment: CompilerGymActionTraceAssessment;
	ledgerPath: string;
	ledgerEventCount: number;
	startedAt: string;
	finishedAt: string;
}

export interface CompilerGymActionTraceAccountingContract {
	evaluatorCpusPerTask: 2;
	acceptedRootAllocCpus: [2, 4];
	interpretation: "evaluator-env-binds-two-cpus-per-task-root-sacct-may-report-two-or-four-allocated-cpus";
}

function accountingContract(
	preregistration: CompilerGymActionTracePreregistration,
): CompilerGymActionTraceAccountingContract {
	return {
		evaluatorCpusPerTask: preregistration.environment.cpusPerTask,
		acceptedRootAllocCpus: [...preregistration.environment.acceptedRootAllocCpus],
		interpretation: "evaluator-env-binds-two-cpus-per-task-root-sacct-may-report-two-or-four-allocated-cpus",
	};
}

export interface CompilerGymActionTraceDispatchAttempt {
	protocol: "compiler-gym-action-trace-dispatch-attempt-v1";
	preregistrationSha256: string;
	attemptOrdinal: 1;
	allocationRetries: 0;
	replacementAllocations: 0;
	attemptedAt: string;
	outputDir: string;
	lockPath: string;
	recordSha256: string;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a nonempty string`);
	return value;
}

function expectSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function expectPositiveNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${path} must be finite and positive`);
	}
	return value;
}

function expectStringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${path} must be a string array`);
	}
	return [...value];
}

function expectIntegerArray(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an integer array`);
	return value.map((item, index) => expectSafeInteger(item, `${path}[${index}]`));
}

function parseSingleJsonLine(stdout: string, path: string): unknown {
	if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n")) {
		throw new Error(`${path} must contain exactly one newline-terminated JSON line`);
	}
	return JSON.parse(stdout.slice(0, -1)) as unknown;
}

interface ParsedCompilerGymActionTraceEnvironmentProbe {
	result: CompilerGymActionTraceEnvironmentProbeResult;
	canonicalOutput: string;
}

function parseCompilerGymActionTraceEnvironmentProbe(
	commandResult: CompilerGymWarmCommandResult,
): ParsedCompilerGymActionTraceEnvironmentProbe {
	if (commandResult.exitCode !== 0) {
		throw new Error(`FarmShare environment probe failed: ${commandResult.stderr.trim()}`);
	}
	if (commandResult.stderr !== "") {
		throw new Error("FarmShare environment probe emitted stderr");
	}
	const parsed = parseSingleJsonLine(commandResult.stdout, "FarmShare environment probe stdout");
	const canonicalOutput = canonicalJson(toJsonValue(parsed));
	const expectedOutput = canonicalJson(toJsonValue(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT));
	if (canonicalOutput !== expectedOutput || commandResult.stdout !== `${expectedOutput}\n`) {
		throw new Error("FarmShare environment probe does not exactly match the frozen seal");
	}
	return {
		result: structuredClone(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT),
		canonicalOutput,
	};
}

export function compilerGymActionTraceEnvironmentProbeArgv(
	environment: CompilerGymActionTracePreregistration["environment"],
	remoteProbePath: string,
): [string, ...string[]] {
	return [
		"/usr/bin/env",
		"-i",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		`LD_LIBRARY_PATH=${environment.compatibilityLibraryDir}`,
		`COMPILER_GYM_CACHE=${environment.compilerGymCache}`,
		`COMPILER_GYM_SITE_DATA=${environment.compilerGymSiteData}`,
		"PYTHONDONTWRITEBYTECODE=1",
		`PYTHONWARNINGS=${environment.pythonWarnings}`,
		environment.pythonPath,
		remoteProbePath,
	];
}

function parseEvaluatorResult(
	stdout: string,
	expected: { benchmarkId: string; actions: readonly string[]; arm: CompilerGymActionTraceArm },
): ParsedEvaluatorResult {
	const result = expectRecord(parseSingleJsonLine(stdout, "evaluator stdout"), "evaluator result");
	if (result.schema_version !== 2 || result.contract !== COMPILER_GYM_VERIFIER_EPOCH) {
		throw new Error("Evaluator result does not use the pinned canonical contract");
	}
	if (result.ok !== true || result.status !== "passed") throw new Error("Evaluator did not pass");
	if (result.benchmark !== expected.benchmarkId) throw new Error("Evaluator benchmark differs from request");
	const request = expectRecord(result.request, "evaluator result.request");
	const actions = expectStringArray(request.actions, "evaluator result.request.actions");
	if (request.benchmark !== expected.benchmarkId || sha256Json(actions) !== sha256Json(expected.actions)) {
		throw new Error("Evaluator request binding differs from the frozen request");
	}
	const actionIndices = expectIntegerArray(result.action_indices, "evaluator result.action_indices");
	if (actionIndices.length !== actions.length) throw new Error("Evaluator action index count differs from actions");
	const metrics = expectRecord(result.metrics, "evaluator result.metrics");
	const initial = expectRecord(metrics.initial, "evaluator result.metrics.initial");
	const final = expectRecord(metrics.final, "evaluator result.metrics.final");
	const commandline = expectString(result.commandline, "evaluator result.commandline");
	const initialIrInstructionCount = expectSafeInteger(
		initial.IrInstructionCount,
		"metrics.initial.IrInstructionCount",
	);
	const finalIrInstructionCount = expectSafeInteger(final.IrInstructionCount, "metrics.final.IrInstructionCount");
	const finalObjectTextSizeBytes = expectSafeInteger(final.ObjectTextSizeBytes, "metrics.final.ObjectTextSizeBytes");
	const validation = expectRecord(result.validation, "evaluator result.validation");
	if (
		validation.passed !== true ||
		validation.inputs_expected !== 20 ||
		validation.inputs_completed !== 20 ||
		validation.base_callbacks_selected !== 20 ||
		validation.sanitizer_callbacks_selected !== 0
	) {
		throw new Error("Evaluator semantic verification is incomplete");
	}
	const environment = expectRecord(result.environment, "evaluator result.environment");
	const slurmId = expectString(environment.slurm_job_id, "evaluator result.environment.slurm_job_id");
	if (!SLURM_ID_PATTERN.test(slurmId) || environment.slurm_cpus_per_task !== "2") {
		throw new Error("Evaluator did not run in the expected two-CPU Slurm allocation");
	}
	const timings = expectRecord(result.timings_seconds, "evaluator result.timings_seconds");
	const intrinsicRuntimeMs = expectPositiveNumber(timings.total, "evaluator result.timings_seconds.total") * 1000;
	let trace: ParsedEvaluatorResult["trace"] = null;
	let shadowActionTraceMs: number | null = null;
	if (expected.arm === "authoritative") {
		if ("action_trace" in result || "shadow_action_trace" in timings) {
			throw new Error("Authoritative arm unexpectedly contains action-trace output");
		}
	} else {
		shadowActionTraceMs =
			expectPositiveNumber(timings.shadow_action_trace, "evaluator result.timings_seconds.shadow_action_trace") *
			1000;
		const rawTrace = expectRecord(result.action_trace, "evaluator result.action_trace");
		if (
			rawTrace.contract !== EVALUATOR_TRACE_CONTRACT ||
			rawTrace.prefix_conditional !== true ||
			rawTrace.intermediate_semantic_status !== "unverified" ||
			rawTrace.terminal_semantic_status !== "authoritative-final-verifier-only" ||
			rawTrace.benchmark !== expected.benchmarkId ||
			sha256Json(rawTrace.actions) !== sha256Json(actions) ||
			sha256Json(rawTrace.action_indices) !== sha256Json(actionIndices) ||
			rawTrace.commandline !== commandline
		) {
			throw new Error("Action trace binding or semantic label is invalid");
		}
		const rawTraceFinal = expectRecord(rawTrace.final, "evaluator result.action_trace.final");
		if (
			rawTraceFinal.IrInstructionCount !== finalIrInstructionCount ||
			rawTraceFinal.ObjectTextSizeBytes !== finalObjectTextSizeBytes ||
			rawTrace.initial_ir_instruction_count !== initialIrInstructionCount
		) {
			throw new Error("Action trace initial or terminal metrics differ from the authoritative result");
		}
		if (!Array.isArray(rawTrace.records) || rawTrace.records.length !== actions.length) {
			throw new Error("Action trace record count differs from actions");
		}
		trace = {
			initialIrInstructionCount: expectSafeInteger(
				rawTrace.initial_ir_instruction_count,
				"evaluator result.action_trace.initial_ir_instruction_count",
			),
			records: rawTrace.records.map((raw, index) => {
				const record = expectRecord(raw, `evaluator result.action_trace.records[${index}]`);
				return {
					index: expectSafeInteger(record.index, `trace.records[${index}].index`),
					action: expectString(record.action, `trace.records[${index}].action`),
					actionIndex: expectSafeInteger(record.action_index, `trace.records[${index}].action_index`),
					irInstructionCount: expectSafeInteger(
						record.ir_instruction_count,
						`trace.records[${index}].ir_instruction_count`,
					),
					deltaFromPrevious:
						typeof record.delta_from_previous === "number" && Number.isSafeInteger(record.delta_from_previous)
							? record.delta_from_previous
							: (() => {
									throw new Error(`trace.records[${index}].delta_from_previous must be a safe integer`);
								})(),
					actionHadNoEffect:
						typeof record.action_had_no_effect === "boolean"
							? record.action_had_no_effect
							: (() => {
									throw new Error(`trace.records[${index}].action_had_no_effect must be a boolean`);
								})(),
				};
			}),
		};
	}
	return {
		benchmarkId: expected.benchmarkId,
		actions,
		actionIndices,
		final: {
			irInstructionCount: finalIrInstructionCount,
			objectTextSizeBytes: finalObjectTextSizeBytes,
			verifierPassed: true,
		},
		intrinsicRuntimeMs,
		shadowActionTraceMs,
		slurmId,
		trace,
	};
}

function splitShadowEvaluatorStdout(stdout: string): { controlStdout: string; traceJson: string } {
	const raw = expectRecord(parseSingleJsonLine(stdout, "shadow evaluator stdout"), "shadow evaluator result");
	const actionTrace = raw.action_trace;
	if (actionTrace === undefined) throw new Error("Shadow evaluator stdout lacks its host-only action trace");
	const control = structuredClone(raw);
	delete control.action_trace;
	const timings = expectRecord(control.timings_seconds, "shadow evaluator timings");
	const shadowSeconds = expectPositiveNumber(
		timings.shadow_action_trace,
		"shadow evaluator timings.shadow_action_trace",
	);
	const totalSeconds = expectPositiveNumber(timings.total, "shadow evaluator timings.total");
	if (totalSeconds <= shadowSeconds) {
		throw new Error("Shadow evaluator total runtime must exceed its trace-only runtime");
	}
	delete timings.shadow_action_trace;
	timings.total = totalSeconds - shadowSeconds;
	return {
		controlStdout: `${canonicalJson(toJsonValue(control))}\n`,
		traceJson: `${canonicalJson(toJsonValue(actionTrace))}\n`,
	};
}

export function compilerGymActionTraceSrunArgv(input: {
	spec: CompilerGymActionTraceExecutionSpec;
	actions: readonly string[];
	remoteEvaluatorPath: string;
	environment: CompilerGymActionTracePreregistration["environment"];
	dispatchNonce: string;
}): [string, ...string[]] {
	if (!/^[0-9a-f]{16}$/.test(input.dispatchNonce)) throw new Error("Dispatch nonce must be 16 lowercase hex digits");
	const suffix = `${input.spec.allocationOrdinal}-${input.spec.candidateId.toLowerCase()}-${input.spec.benchmarkId.split("/").at(-1)}-${input.spec.arm === "authoritative" ? "a" : "b"}`;
	const transientCache = `/tmp/prime-action-trace-${input.dispatchNonce}-${suffix}`;
	const argv = [
		"/usr/bin/srun",
		"-p",
		input.environment.partition,
		"-C",
		input.environment.cpuConstraint,
		"--ntasks=1",
		`--cpus-per-task=${input.environment.cpusPerTask}`,
		`--mem=${input.environment.memory}`,
		`--time=${input.environment.timeLimit}`,
		"--kill-on-bad-exit=1",
		"--export=NONE",
		`--job-name=pat-${suffix}`,
		"/usr/bin/env",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		`LD_LIBRARY_PATH=${input.environment.compatibilityLibraryDir}`,
		`COMPILER_GYM_CACHE=${input.environment.compilerGymCache}`,
		`COMPILER_GYM_SITE_DATA=${input.environment.compilerGymSiteData}`,
		`COMPILER_GYM_TRANSIENT_CACHE=${transientCache}`,
		"PYTHONDONTWRITEBYTECODE=1",
		`PYTHONWARNINGS=${input.environment.pythonWarnings}`,
		input.environment.pythonPath,
		input.remoteEvaluatorPath,
	] as [string, ...string[]];
	const forbidden = argv.some(
		(argument) =>
			argument === "/usr/bin/sbatch" ||
			argument === "sbatch" ||
			argument.startsWith("--jobid") ||
			argument.startsWith("--dependency") ||
			argument === "--hold" ||
			argument === "--overlap" ||
			argument === "--exact",
	);
	if (forbidden) throw new Error("Action-trace runner may only use independent stock-cold allocations");
	return argv;
}

export function compilerGymActionTraceSacctArgv(slurmId: string): [string, ...string[]] {
	if (!SLURM_ID_PATTERN.test(slurmId)) throw new Error("Invalid Slurm ID for accounting query");
	return [
		"/usr/bin/sacct",
		"-X",
		"--jobs",
		slurmId,
		"--noheader",
		"--parsable2",
		"--format=JobIDRaw,JobName,State,ExitCode,AllocCPUS,NTasks,ElapsedRaw,CPUTimeRAW,NodeList,Start,End",
	];
}

export function parseCompilerGymActionTraceAccounting(stdout: string): CompilerGymActionTraceAccounting {
	const lines = stdout.trim().split("\n").filter(Boolean);
	if (lines.length !== 1) throw new Error("sacct must return exactly one root allocation row");
	const fields = lines[0].split("|");
	if (fields.at(-1) === "") fields.pop();
	if (fields.length !== 11) throw new Error("sacct row has an unexpected field count");
	const [jobIdRaw, jobName, state, exitCode, allocCpus, nTasks, elapsedRaw, cpuTimeRaw, nodeList, startAt, endAt] =
		fields;
	if (!SLURM_ID_PATTERN.test(jobIdRaw)) throw new Error("sacct JobIDRaw is invalid");
	for (const [name, value] of [
		["jobName", jobName],
		["state", state],
		["exitCode", exitCode],
		["nodeList", nodeList],
		["startAt", startAt],
		["endAt", endAt],
	] as const) {
		if (value.length === 0) throw new Error(`sacct ${name} is empty`);
	}
	const integer = (value: string, name: string): number => {
		if (!/^[0-9]+$/.test(value)) throw new Error(`sacct ${name} is not an integer`);
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed)) throw new Error(`sacct ${name} is not a safe integer`);
		return parsed;
	};
	const parsedAllocCpus = integer(allocCpus, "AllocCPUS");
	const parsedElapsedRaw = integer(elapsedRaw, "ElapsedRaw");
	const parsedCpuTimeRaw = integer(cpuTimeRaw, "CPUTimeRAW");
	const expectedCpuTimeRaw = parsedAllocCpus * parsedElapsedRaw;
	if (!Number.isSafeInteger(expectedCpuTimeRaw) || parsedCpuTimeRaw !== expectedCpuTimeRaw) {
		throw new Error("sacct CPUTimeRAW must equal AllocCPUS multiplied by ElapsedRaw");
	}
	return {
		jobIdRaw,
		jobName,
		state,
		exitCode,
		allocCpus: parsedAllocCpus,
		nTasks: nTasks === "" ? null : integer(nTasks, "NTasks"),
		elapsedRawSeconds: parsedElapsedRaw,
		cpuTimeRawSeconds: parsedCpuTimeRaw,
		nodeList,
		startAt,
		endAt,
	};
}

async function waitForAccounting(input: {
	slurmId: string;
	expectedJobName: string;
	recorder: RecordingCompilerGymActionTraceCommandRunner;
	preregistration: CompilerGymActionTracePreregistration;
	config: CompilerGymActionTraceQualificationRunnerConfig;
	clock: CompilerGymActionTraceRunnerClock;
	signal: AbortSignal;
}): Promise<{ accounting: CompilerGymActionTraceAccounting; commandSequences: number[] }> {
	const started = input.clock.monotonicNs();
	const sequences: number[] = [];
	while (true) {
		const sequence = input.recorder.nextSequence();
		sequences.push(sequence);
		const result = await input.recorder.run({
			argv: compilerGymWarmSshArgv(
				input.preregistration.environment.host,
				compilerGymActionTraceSacctArgv(input.slurmId),
			),
			signal: input.signal,
			timeoutMs: input.config.commandTimeoutMs,
			maxOutputBytes: 1024 * 1024,
		});
		if (result.exitCode !== 0) throw new Error(`sacct failed for ${input.slurmId}: ${result.stderr.trim()}`);
		if (result.stdout.trim().length > 0) {
			const accounting = parseCompilerGymActionTraceAccounting(result.stdout);
			if (accounting.jobIdRaw !== input.slurmId || accounting.jobName !== input.expectedJobName) {
				throw new Error("sacct row does not bind to the measured allocation");
			}
			if (TERMINAL_STATES.has(accounting.state)) {
				if (
					accounting.state !== "COMPLETED" ||
					accounting.exitCode !== "0:0" ||
					!input.preregistration.environment.acceptedRootAllocCpus.includes(accounting.allocCpus as 2 | 4) ||
					(accounting.nTasks !== null && accounting.nTasks !== 1)
				) {
					throw new Error(`Allocation ${input.slurmId} did not complete with the frozen resources`);
				}
				return { accounting, commandSequences: sequences };
			}
		}
		const elapsedMs = Number(input.clock.monotonicNs() - started) / 1_000_000;
		if (elapsedMs >= input.config.accountingTimeoutMs)
			throw new Error(`Timed out waiting for sacct ${input.slurmId}`);
		await input.clock.sleep(input.config.accountingPollMs, input.signal);
	}
}

function expectedCandidate(
	preregistration: CompilerGymActionTracePreregistration,
	candidateId: string,
): CompilerGymActionTracePreregistration["candidates"][number] {
	const candidate = preregistration.candidates.find((item) => item.candidateId === candidateId);
	if (!candidate) throw new Error(`Unknown frozen candidate ${candidateId}`);
	return candidate;
}

function assertExpectedMetrics(
	preregistration: CompilerGymActionTracePreregistration,
	spec: CompilerGymActionTraceExecutionSpec,
	parsed: ParsedEvaluatorResult,
): void {
	const expected = expectedCandidate(preregistration, spec.candidateId).expectedMetrics[spec.benchmarkId];
	if (!expected) throw new Error(`Missing frozen expected metrics for ${spec.caseId}`);
	if (
		parsed.final.irInstructionCount !== expected.irInstructionCount ||
		parsed.final.objectTextSizeBytes !== expected.objectTextSizeBytes
	) {
		throw new Error(
			`${spec.caseId} ${spec.arm} canonical metrics drifted: expected ${expected.irInstructionCount}/${expected.objectTextSizeBytes}, observed ${parsed.final.irInstructionCount}/${parsed.final.objectTextSizeBytes}`,
		);
	}
}

function buildCases(
	preregistration: CompilerGymActionTracePreregistration,
	allocations: readonly CompilerGymActionTraceAllocationEvidence[],
): CompilerGymActionTraceQualificationCase[] {
	const caseIds = [...new Set(COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN.map((spec) => spec.caseId))];
	return caseIds.map((caseId) => {
		const authoritative = allocations.find(
			(allocation) => allocation.spec.caseId === caseId && allocation.spec.arm === "authoritative",
		);
		const shadow = allocations.find(
			(allocation) => allocation.spec.caseId === caseId && allocation.spec.arm === "shadow-trace",
		);
		if (!authoritative || !shadow?.parsed.trace) throw new Error(`Incomplete paired case ${caseId}`);
		if (sha256Json(authoritative.parsed.actionIndices) !== sha256Json(shadow.parsed.actionIndices)) {
			throw new Error(`Action index binding differs across ${caseId}`);
		}
		const candidate = expectedCandidate(preregistration, authoritative.spec.candidateId);
		return {
			caseId,
			candidateId: candidate.candidateId,
			candidateSha256: candidate.actionsSha256,
			benchmarkId: authoritative.spec.benchmarkId,
			actions: [...candidate.actions],
			actionIndices: [...authoritative.parsed.actionIndices],
			authoritative: {
				final: { ...authoritative.parsed.final },
				intrinsicRuntimeMs: authoritative.parsed.intrinsicRuntimeMs,
			},
			shadow: {
				final: { ...shadow.parsed.final },
				intrinsicRuntimeMs: shadow.parsed.intrinsicRuntimeMs,
				trace: structuredClone(shadow.parsed.trace),
			},
		};
	});
}

function stockControlRequest(actions: readonly string[]) {
	return {
		actions: [...actions],
		hypothesis: "The frozen candidate reproduces its accepted terminal metrics under the stock evaluator.",
		mechanism: "Replay the preregistered candidate on the fixed stock task pair with fresh measurements.",
		predictedOutcome: "Terminal metrics remain equal to the immutable accepted source measurement.",
		boundaryConditions: [
			"The candidate and fixed task pair are unchanged.",
			"Only the authoritative final verifier establishes semantic acceptance.",
		],
	};
}

async function buildVisibilityEvidence(input: {
	preregistration: CompilerGymActionTracePreregistration;
	cases: readonly CompilerGymActionTraceQualificationCase[];
	allocations: readonly CompilerGymActionTraceAllocationEvidence[];
	artifacts: ArtifactStore;
	renderer: CompilerGymActionTraceModelValueRenderer;
	signal: AbortSignal;
}): Promise<{
	visibility: CompilerGymActionTraceVisibilityEvidence;
	artifacts: CompilerGymActionTraceVisibilityArtifact[];
}> {
	const treatmentEnvelopes = buildCompilerGymActionTraceTreatmentEnvelopes(input.cases);
	const visibilityCandidates: CompilerGymActionTraceVisibilityEvidence["candidates"] = [];
	const visibilityArtifacts: CompilerGymActionTraceVisibilityArtifact[] = [];
	for (const candidate of input.preregistration.candidates) {
		const shadowAllocations = input.preregistration.benchmarks.map((benchmarkId) => {
			const allocation = input.allocations.find(
				(item) =>
					item.spec.candidateId === candidate.candidateId &&
					item.spec.benchmarkId === benchmarkId &&
					item.spec.arm === "shadow-trace",
			);
			if (!allocation) throw new Error(`Missing shadow control source for ${candidate.candidateId}:${benchmarkId}`);
			return allocation;
		});
		const jobId = `job_${sha256Json({
			qualificationId: input.preregistration.qualificationId,
			candidateSha256: candidate.actionsSha256,
		}).slice(0, 24)}`;
		const manifestDigest = sha256Json({
			jobId,
			candidateSha256: candidate.actionsSha256,
			benchmarkIds: input.preregistration.benchmarks,
			verifierEpoch: input.preregistration.expectedVerifierEpoch,
		});
		const request = stockControlRequest(candidate.actions);
		const candidateArtifact = await input.artifacts.putString(
			JSON.stringify(candidate.actions),
			"application/vnd.prime.llvm-pass-sequence",
		);
		const stdoutArtifact = await input.artifacts.putString(
			`${canonicalJson(toJsonValue(shadowAllocations.map((allocation) => allocation.controlStdoutArtifact)))}\n`,
			"application/json",
		);
		const stderrArtifact = await input.artifacts.putString("", "text/plain");
		const measuredAt = input.preregistration.createdAt;
		const proposalDetails = {
			hypothesis: request.hypothesis,
			mechanism: request.mechanism,
			predictedOutcome: request.predictedOutcome,
			boundaryConditions: [...request.boundaryConditions],
			parentJobIds: [],
		};
		const proposal: JobView["proposal"] = {
			jobId,
			manifestDigest,
			branchId: "stock-prime-core-projected-control",
			lane: "compiler-gym",
			benchmarkIds: [...input.preregistration.benchmarks],
			budgetClass: "smoke",
			treatment: "stock-prime-core-isolated",
			proposal: proposalDetails,
			candidate: candidateArtifact,
			candidateFormat: "llvm-pass-sequence",
			requireFreshMeasurement: true,
		};
		const submitted: SubmitResult = {
			jobId,
			acceptedAt: measuredAt,
			manifestDigest,
			duplicate: false,
		};
		const job: JobView = {
			proposal,
			state: {
				jobId,
				status: "succeeded",
				statusAt: measuredAt,
				externalJobId: null,
				reason: null,
			},
			measurement: {
				jobId,
				manifestDigest,
				verifierEpoch: input.preregistration.expectedVerifierEpoch,
				measuredAt,
				tasks: shadowAllocations.map((allocation) => ({
					benchmarkId: allocation.spec.benchmarkId,
					status: "accepted",
					metrics: {
						IrInstructionCount: allocation.parsed.final.irInstructionCount,
						ObjectTextSizeBytes: allocation.parsed.final.objectTextSizeBytes,
						evaluatorRuntimeMs: allocation.parsed.intrinsicRuntimeMs,
						schedulerAndEvaluatorWallMs: allocation.accounting.elapsedRawSeconds * 1000,
						queueAndTransportMs: Math.max(
							0,
							allocation.accounting.elapsedRawSeconds * 1000 - allocation.parsed.intrinsicRuntimeMs,
						),
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
					runtimeMs: allocation.accounting.elapsedRawSeconds * 1000,
				})),
				hardware: {
					cluster: "Stanford FarmShare",
					partition: input.preregistration.environment.partition,
					cpuConstraint: input.preregistration.environment.cpuConstraint,
				},
				provenance: {
					adapter: "farmshare-compiler-gym",
					evaluatorSha256: input.preregistration.sources.canonicalSha256,
					environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
					upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
					cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
					installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
					distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
					compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
					libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
					compilerGym: "0.2.5",
					llvm: "10.0.0",
				},
				stdout: stdoutArtifact,
				stderr: stderrArtifact,
			},
		};
		const budget: BranchBudgetStatus = {
			branchId: "stock-prime-core-projected-control",
			submissions: 1,
			taskEvaluations: 2,
			actualTaskEvaluations: 2,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: 1,
			maxTaskEvaluations: 2,
			remainingSubmissions: 0,
			remainingTaskEvaluations: 0,
		};
		const controlEnvelope = buildStockCpuEvaluationEnvelope({
			request,
			submitted,
			job,
			budget,
		});
		const treatmentEnvelope = treatmentEnvelopes.find((envelope) => envelope.candidateId === candidate.candidateId);
		if (!treatmentEnvelope) throw new Error(`Missing treatment envelope for ${candidate.candidateId}`);
		const combinedTreatmentEnvelope = { ...controlEnvelope, actionTrace: treatmentEnvelope };
		const controlEnvelopeJson = JSON.stringify(controlEnvelope);
		const typedTraceEnvelopeJson = JSON.stringify(treatmentEnvelope);
		const combinedTreatmentEnvelopeJson = JSON.stringify(combinedTreatmentEnvelope);
		const controlJson = `${controlEnvelopeJson}\n`;
		const typedTraceJson = `${typedTraceEnvelopeJson}\n`;
		const combinedTreatmentJson = `${combinedTreatmentEnvelopeJson}\n`;
		const controlRendered = await input.renderer.render(controlJson, input.signal);
		const combinedTreatmentRendered = await input.renderer.render(combinedTreatmentJson, input.signal);
		for (const rendered of [controlRendered, combinedTreatmentRendered]) {
			if (
				rendered.rendererProtocol !== COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL ||
				rendered.agentFacingBytes !== Buffer.byteLength(rendered.text, "utf8") ||
				rendered.renderedTextSha256 !== sha256Text(rendered.text)
			) {
				throw new Error("Native IPython renderer evidence is internally inconsistent");
			}
		}
		const [
			controlEnvelopeArtifact,
			controlRenderedArtifact,
			typedTraceEnvelopeArtifact,
			combinedTreatmentEnvelopeArtifact,
			combinedTreatmentRenderedArtifact,
		] = await Promise.all([
			input.artifacts.putString(controlJson, "application/json"),
			input.artifacts.putString(controlRendered.text, "text/plain"),
			input.artifacts.putString(typedTraceJson, "application/json"),
			input.artifacts.putString(combinedTreatmentJson, "application/json"),
			input.artifacts.putString(combinedTreatmentRendered.text, "text/plain"),
		]);
		visibilityCandidates.push({
			candidateId: candidate.candidateId,
			candidateSha256: candidate.actionsSha256,
			benchmarkIds: treatmentEnvelope.tasks.map((task) => task.benchmarkId),
			controlEnvelopeJson,
			controlEnvelopeSha256: sha256Text(controlEnvelopeJson),
			controlRenderedText: controlRendered.text,
			controlRenderedTextSha256: controlRendered.renderedTextSha256,
			controlProjectedAgentFacingBytes: controlRendered.agentFacingBytes,
			typedTraceEnvelopeJson,
			typedTraceEnvelopeSha256: sha256Text(typedTraceEnvelopeJson),
			combinedTreatmentEnvelopeJson,
			combinedTreatmentEnvelopeSha256: sha256Text(combinedTreatmentEnvelopeJson),
			combinedTreatmentRenderedText: combinedTreatmentRendered.text,
			combinedTreatmentRenderedTextSha256: combinedTreatmentRendered.renderedTextSha256,
			combinedTreatmentProjectedAgentFacingBytes: combinedTreatmentRendered.agentFacingBytes,
		});
		visibilityArtifacts.push({
			candidateId: candidate.candidateId,
			controlEnvelope: controlEnvelopeArtifact,
			controlRenderedText: controlRenderedArtifact,
			typedTraceEnvelope: typedTraceEnvelopeArtifact,
			combinedTreatmentEnvelope: combinedTreatmentEnvelopeArtifact,
			combinedTreatmentRenderedText: combinedTreatmentRenderedArtifact,
		});
	}
	return {
		visibility: {
			protocol: COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL,
			rendererProtocol: COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
			candidates: visibilityCandidates,
		},
		artifacts: visibilityArtifacts,
	};
}

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(value))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function acquireDispatchAttempt(input: {
	lockRoot: string;
	preregistrationSha256: string;
	attemptedAt: string;
	outputDir: string;
}): Promise<CompilerGymActionTraceDispatchAttempt> {
	await mkdir(input.lockRoot, { recursive: true, mode: 0o700 });
	const lockPath = join(input.lockRoot, `${input.preregistrationSha256}.json`);
	const body = {
		protocol: "compiler-gym-action-trace-dispatch-attempt-v1" as const,
		preregistrationSha256: input.preregistrationSha256,
		attemptOrdinal: 1 as const,
		allocationRetries: 0 as const,
		replacementAllocations: 0 as const,
		attemptedAt: input.attemptedAt,
		outputDir: resolve(input.outputDir),
		lockPath,
	};
	const recordSha256 = sha256Json(body);
	const attempt: CompilerGymActionTraceDispatchAttempt = { ...body, recordSha256 };
	await writeExclusiveJson(lockPath, attempt);
	return attempt;
}

async function verifyQualificationSources(
	preregistration: CompilerGymActionTracePreregistration,
	repoRoot: string,
): Promise<void> {
	const [canonicalAfter, traceAfter, environmentProbeAfter, implementationAfter] = await Promise.all([
		readFile(preregistration.sources.canonicalPath, "utf8"),
		readFile(preregistration.sources.tracePath, "utf8"),
		readFile(preregistration.sources.environmentProbePath, "utf8"),
		Promise.all(
			preregistration.implementationClosure.map(async (source) => ({
				relativePath: source.relativePath,
				sha256: sha256Text(await readFile(resolve(repoRoot, source.relativePath), "utf8")),
			})),
		),
	]);
	if (
		sha256Text(canonicalAfter) !== preregistration.sources.canonicalSha256 ||
		sha256Text(traceAfter) !== preregistration.sources.traceSha256 ||
		sha256Text(environmentProbeAfter) !== preregistration.sources.environmentProbeSha256 ||
		canonicalJson(toJsonValue(implementationAfter)) !==
			canonicalJson(toJsonValue(preregistration.implementationClosure))
	) {
		throw new Error("Evaluator or qualification implementation source changed during qualification");
	}
}

function combineQualificationErrors(primary: unknown, secondary: unknown, context: string): unknown {
	return new AggregateError([primary, secondary], context);
}

export async function ensureCompilerGymActionTracePrivateDirectoryTree(
	remoteFileSystem: Pick<CompilerGymWarmRemoteFileSystem, "ensurePrivateDirectory">,
	directory: string,
	signal: AbortSignal,
): Promise<void> {
	if (!directory.startsWith("/") || posix.normalize(directory) !== directory || directory.endsWith("/")) {
		throw new Error("Remote source directory must be an absolute normalized path");
	}
	const components = directory.split("/").slice(1);
	if (
		components.length < 5 ||
		(components[0] !== "scratch" && components[0] !== "home") ||
		components[1] !== "users" ||
		!components[2]
	) {
		throw new Error("Remote source directory must be below a user storage root");
	}
	let current = `/${components.slice(0, 3).join("/")}`;
	for (const component of components.slice(3)) {
		current = posix.join(current, component);
		await remoteFileSystem.ensurePrivateDirectory(current, signal);
	}
}

export class CompilerGymActionTraceQualificationRunner {
	private readonly clock: CompilerGymActionTraceRunnerClock;
	private readonly renderer: CompilerGymActionTraceModelValueRenderer;
	private readonly historicalEvidenceVerifier: CompilerGymActionTraceHistoricalEvidenceVerifier;
	private readonly commandRunner: CompilerGymWarmCommandRunner;

	constructor(
		private readonly config: CompilerGymActionTraceQualificationRunnerConfig,
		dependencies: CompilerGymActionTraceQualificationRunnerDependencies = {},
	) {
		this.clock = dependencies.clock ?? new SystemCompilerGymActionTraceRunnerClock();
		this.renderer = dependencies.renderer ?? new NativeCompilerGymActionTraceModelValueRenderer(config.outputDir);
		this.historicalEvidenceVerifier =
			dependencies.historicalEvidenceVerifier ?? new LocalCompilerGymActionTraceHistoricalEvidenceVerifier();
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
	}

	async run(): Promise<CompilerGymActionTraceQualificationResult> {
		const signal = new AbortController().signal;
		const preregistrationRaw = await readFile(resolve(this.config.preregistrationPath), "utf8");
		const preregistration = parseCompilerGymActionTracePreregistration(
			parseSingleJsonLine(preregistrationRaw, "preregistration"),
		);
		const preregistrationSha256 = sha256Text(preregistrationRaw);
		const canonicalSource = await readFile(preregistration.sources.canonicalPath, "utf8");
		const traceSource = await readFile(preregistration.sources.tracePath, "utf8");
		const environmentProbeSource = await readFile(preregistration.sources.environmentProbePath, "utf8");
		if (
			sha256Text(canonicalSource) !== preregistration.sources.canonicalSha256 ||
			sha256Text(traceSource) !== preregistration.sources.traceSha256 ||
			sha256Text(environmentProbeSource) !== preregistration.sources.environmentProbeSha256
		) {
			throw new Error("Local evaluator or environment-probe sources differ from preregistered hashes");
		}
		const implementationClosure = await Promise.all(
			COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(this.config.repoRoot, relativePath), "utf8")),
			})),
		);
		const reconstructedPreregistration = buildCompilerGymActionTracePreregistration({
			createdAt: preregistration.createdAt,
			primeAgentCommit: preregistration.primeAgentCommit,
			canonicalPath: preregistration.sources.canonicalPath,
			canonicalSource,
			tracePath: preregistration.sources.tracePath,
			traceSource,
			environmentProbePath: preregistration.sources.environmentProbePath,
			environmentProbeSource,
			implementationClosure,
		});
		if (canonicalJson(toJsonValue(reconstructedPreregistration)) !== canonicalJson(toJsonValue(preregistration))) {
			throw new Error("Preregistration differs from the fully reconstructed sealed design");
		}
		await this.historicalEvidenceVerifier.verify(preregistration, resolve(this.config.repoRoot));

		await mkdir(dirname(resolve(this.config.outputDir)), { recursive: true, mode: 0o700 });
		await mkdir(resolve(this.config.outputDir), { mode: 0o700 });
		const ledgerPath = resolve(this.config.outputDir, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(ledgerPath);
		if (ledger.getEvents().length !== 0) throw new Error("Qualification ledger must start empty");
		const artifacts = new ArtifactStore(resolve(this.config.outputDir, "artifacts"));
		const recorder = new RecordingCompilerGymActionTraceCommandRunner(
			this.commandRunner,
			artifacts,
			ledger,
			this.clock,
		);
		const remoteFileSystem = new SshCompilerGymWarmRemoteFileSystem(
			recorder,
			preregistration.environment.host,
			"/usr/bin/python3",
			this.config.commandTimeoutMs,
		);
		const startedAt = this.clock.now().toISOString();
		await ledger.append("run_manifest", {
			type: "action_trace_qualification",
			phase: "start",
			protocol: RUNNER_PROTOCOL,
			preregistrationProtocol: COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL,
			preregistrationSha256,
			primeAgentCommit: preregistration.primeAgentCommit,
			modelCalls: 0,
			measurementReuse: false,
			executionPlan: preregistration.executionPlan,
			startedAt,
		});

		const sourceDirectory = posix.join(
			preregistration.environment.remoteSourceRoot,
			preregistration.sources.combinedSha256,
		);
		const canonicalRemotePath = posix.join(sourceDirectory, "compiler_gym_eval.py");
		const traceRemotePath = posix.join(sourceDirectory, "compiler_gym_action_trace_eval.py");
		const environmentProbeRemotePath = posix.join(sourceDirectory, "compiler_gym_env_probe.py");
		const allocations: CompilerGymActionTraceAllocationEvidence[] = [];
		const slurmIds = new Set<string>();
		let rendererClosed = false;
		let dispatchAttempt: CompilerGymActionTraceDispatchAttempt | null = null;
		const resultPath = resolve(this.config.outputDir, "result.json");
		let resultWritten = false;
		try {
			dispatchAttempt = await acquireDispatchAttempt({
				lockRoot:
					this.config.dispatchLockRoot ??
					resolve(this.config.repoRoot, ".autoresearch/action-trace-dispatch-attempts"),
				preregistrationSha256,
				attemptedAt: this.clock.now().toISOString(),
				outputDir: this.config.outputDir,
			});
			await ledger.append("run_manifest", {
				type: "action_trace_dispatch_attempt",
				...dispatchAttempt,
			});
			const dispatchNonce = sha256Json(dispatchAttempt).slice(0, 16);
			await ensureCompilerGymActionTracePrivateDirectoryTree(remoteFileSystem, sourceDirectory, signal);
			await remoteFileSystem.installImmutableFile(
				canonicalRemotePath,
				canonicalSource,
				preregistration.sources.canonicalSha256,
				0o600,
				true,
				signal,
			);
			await remoteFileSystem.installImmutableFile(
				traceRemotePath,
				traceSource,
				preregistration.sources.traceSha256,
				0o600,
				true,
				signal,
			);
			await remoteFileSystem.installImmutableFile(
				environmentProbeRemotePath,
				environmentProbeSource,
				preregistration.sources.environmentProbeSha256,
				0o600,
				true,
				signal,
			);

			const environmentProbeOuterArgv = compilerGymWarmSshArgv(
				preregistration.environment.host,
				compilerGymActionTraceEnvironmentProbeArgv(preregistration.environment, environmentProbeRemotePath),
			);
			const preflightCommandSequence = recorder.nextSequence();
			const preflightCommandResult = await recorder.run({
				argv: environmentProbeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			const preflightEnvironmentProbe = parseCompilerGymActionTraceEnvironmentProbe(preflightCommandResult);
			await ledger.append("run_manifest", {
				type: "action_trace_environment_probe",
				phase: "preflight",
				protocol: RUNNER_PROTOCOL,
				commandSequence: preflightCommandSequence,
				sourceSha256: preregistration.sources.environmentProbeSha256,
				stdoutSha256: sha256Text(preflightCommandResult.stdout),
				result: preflightEnvironmentProbe.result,
			});

			for (const spec of preregistration.executionPlan) {
				const candidate = expectedCandidate(preregistration, spec.candidateId);
				const request = `${canonicalJson(toJsonValue({ benchmark: spec.benchmarkId, actions: candidate.actions }))}\n`;
				const remoteEvaluatorPath = spec.arm === "authoritative" ? canonicalRemotePath : traceRemotePath;
				const remoteArgv = compilerGymActionTraceSrunArgv({
					spec,
					actions: candidate.actions,
					remoteEvaluatorPath,
					environment: preregistration.environment,
					dispatchNonce,
				});
				const outerArgv = compilerGymWarmSshArgv(preregistration.environment.host, remoteArgv);
				const commandSequence = recorder.nextSequence();
				const commandResult = await recorder.run({
					argv: outerArgv,
					input: request,
					signal,
					timeoutMs: this.config.commandTimeoutMs,
					maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
				});
				if (commandResult.exitCode !== 0) {
					throw new Error(`${spec.caseId} ${spec.arm} evaluator failed: ${commandResult.stderr.trim()}`);
				}
				const parsed = parseEvaluatorResult(commandResult.stdout, {
					benchmarkId: spec.benchmarkId,
					actions: candidate.actions,
					arm: spec.arm,
				});
				assertExpectedMetrics(preregistration, spec, parsed);
				if (slurmIds.has(parsed.slurmId)) throw new Error(`Slurm allocation ${parsed.slurmId} was reused`);
				slurmIds.add(parsed.slurmId);
				const expectedJobName = remoteArgv.find((argument) => argument.startsWith("--job-name="))?.slice(11);
				if (!expectedJobName) throw new Error("srun command lacks its frozen job name");
				const accountingResult = await waitForAccounting({
					slurmId: parsed.slurmId,
					expectedJobName,
					recorder,
					preregistration,
					config: this.config,
					clock: this.clock,
					signal,
				});
				const stdoutArtifact = await artifacts.putString(commandResult.stdout, "text/plain");
				const stderrArtifact = await artifacts.putString(commandResult.stderr, "text/plain");
				const shadowSplit = spec.arm === "shadow-trace" ? splitShadowEvaluatorStdout(commandResult.stdout) : null;
				const controlStdoutArtifact = await artifacts.putString(
					shadowSplit?.controlStdout ?? commandResult.stdout,
					"application/json",
				);
				const hostTraceArtifact = shadowSplit
					? await artifacts.putString(shadowSplit.traceJson, "application/json")
					: null;
				const allocation: CompilerGymActionTraceAllocationEvidence = {
					spec: { ...spec },
					requestSha256: sha256Text(request),
					evaluatorSha256:
						spec.arm === "authoritative"
							? preregistration.sources.canonicalSha256
							: preregistration.sources.traceSha256,
					remoteArgv: [...remoteArgv],
					outerArgv: [...outerArgv],
					commandSequence,
					slurmId: parsed.slurmId,
					accountingCommandSequences: accountingResult.commandSequences,
					accounting: accountingResult.accounting,
					parsed,
					stdoutArtifact,
					stderrArtifact,
					controlStdoutArtifact,
					hostTraceArtifact,
				};
				allocations.push(allocation);
				await ledger.append("measurement", {
					type: "action_trace_allocation",
					protocol: RUNNER_PROTOCOL,
					...allocation,
				});
			}

			if (allocations.length !== 8 || slurmIds.size !== 8) {
				throw new Error("Qualification did not produce eight independent allocations");
			}
			const postflightCommandSequence = recorder.nextSequence();
			const postflightCommandResult = await recorder.run({
				argv: environmentProbeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			const postflightEnvironmentProbe = parseCompilerGymActionTraceEnvironmentProbe(postflightCommandResult);
			if (
				postflightCommandResult.stdout !== preflightCommandResult.stdout ||
				postflightEnvironmentProbe.canonicalOutput !== preflightEnvironmentProbe.canonicalOutput
			) {
				throw new Error("FarmShare postflight environment probe differs from preflight");
			}
			await ledger.append("run_manifest", {
				type: "action_trace_environment_probe",
				phase: "postflight",
				protocol: RUNNER_PROTOCOL,
				commandSequence: postflightCommandSequence,
				sourceSha256: preregistration.sources.environmentProbeSha256,
				stdoutSha256: sha256Text(postflightCommandResult.stdout),
				result: postflightEnvironmentProbe.result,
			});
			const cases = buildCases(preregistration, allocations);
			const visibilityEvidence = await buildVisibilityEvidence({
				preregistration,
				cases,
				allocations,
				artifacts,
				renderer: this.renderer,
				signal,
			});
			const assessment = assessCompilerGymActionTraceQualification({
				protocol: COMPILER_GYM_ACTION_TRACE_PROTOCOL,
				cases,
				visibility: visibilityEvidence.visibility,
			});
			await this.renderer.close();
			rendererClosed = true;
			await verifyQualificationSources(preregistration, this.config.repoRoot);
			await ledger.append("claim", {
				type: "action_trace_assessment",
				protocol: RUNNER_PROTOCOL,
				admission: "requires-terminal-complete-ledger-event",
				causalTreatmentClaimAllowed: false,
				qualificationScope: preregistration.design.qualificationScope,
				assessment,
			});
			const finishedAt = this.clock.now().toISOString();
			ledger.verify();
			if (!dispatchAttempt) throw new Error("Dispatch attempt evidence is absent");
			const result: CompilerGymActionTraceQualificationResult = {
				protocol: RUNNER_PROTOCOL,
				admission: "requires-terminal-complete-ledger-event",
				causalTreatmentClaimAllowed: false,
				qualificationScope: preregistration.design.qualificationScope,
				qualificationId: COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID,
				preregistrationSha256,
				sourceDirectory,
				modelCalls: 0,
				measurementReuse: false,
				dispatchAttempt,
				accountingContract: accountingContract(preregistration),
				environmentProbe: {
					sourceSha256: preregistration.sources.environmentProbeSha256,
					preflightCommandSequence,
					postflightCommandSequence,
					stdoutSha256: sha256Text(preflightCommandResult.stdout),
					result: preflightEnvironmentProbe.result,
				},
				allocations,
				cases,
				visibility: visibilityEvidence.visibility,
				visibilityArtifacts: visibilityEvidence.artifacts,
				assessment,
				ledgerPath,
				ledgerEventCount: ledger.getEvents().length + 1,
				startedAt,
				finishedAt,
			};
			await writeExclusiveJson(resultPath, result);
			resultWritten = true;
			await ledger.append("run_manifest", {
				type: "action_trace_qualification",
				phase: "complete",
				protocol: RUNNER_PROTOCOL,
				decision: assessment.decision,
				causalTreatmentClaimAllowed: false,
				qualificationScope: preregistration.design.qualificationScope,
				resultSha256: sha256Text(`${canonicalJson(toJsonValue(result))}\n`),
				allocationCount: allocations.length,
				uniqueSlurmIds: slurmIds.size,
				modelCalls: 0,
				measurementReuse: false,
				accountingContract: accountingContract(preregistration),
				finishedAt,
			});
			return result;
		} catch (error) {
			let failure: unknown = error;
			if (!rendererClosed) {
				try {
					await this.renderer.close();
					rendererClosed = true;
				} catch (closeError) {
					failure = combineQualificationErrors(
						failure,
						closeError,
						"Qualification and renderer cleanup both failed",
					);
				}
			}
			try {
				await verifyQualificationSources(preregistration, this.config.repoRoot);
			} catch (integrityError) {
				failure = combineQualificationErrors(
					failure,
					integrityError,
					"Qualification failed and source integrity verification also failed",
				);
			}
			if (resultWritten) {
				try {
					await unlink(resultPath);
					resultWritten = false;
				} catch (unlinkError) {
					failure = combineQualificationErrors(
						failure,
						unlinkError,
						"Qualification failed and provisional result cleanup also failed",
					);
				}
			}
			try {
				await ledger.append("run_manifest", {
					type: "action_trace_qualification",
					phase: "failed",
					failureDisposition: preregistration.design.failureDisposition,
					protocol: RUNNER_PROTOCOL,
					modelCalls: 0,
					measurementReuse: false,
					allocationCount: allocations.length,
					error: failure instanceof Error ? (failure.stack ?? failure.message) : String(failure),
					failedAt: this.clock.now().toISOString(),
				});
			} catch (ledgerError) {
				failure = combineQualificationErrors(
					failure,
					ledgerError,
					"Qualification and failure recording both failed",
				);
			}
			throw failure;
		}
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 5 || args[0] !== "--dispatch" || args[1] !== "--preregistration" || args[3] !== "--output-dir") {
		throw new Error(
			"Usage: compiler-gym-action-trace-qualification-runner --dispatch --preregistration <path> --output-dir <path>",
		);
	}
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const runner = new CompilerGymActionTraceQualificationRunner({
		repoRoot,
		preregistrationPath: resolve(args[2]),
		outputDir: resolve(args[4]),
		...DEFAULT_COMPILER_GYM_ACTION_TRACE_RUNNER_LIMITS,
	});
	const result = await runner.run();
	console.log(canonicalJson(toJsonValue(result)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main();
}

import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	type CompilerGymActionTraceModelValueRenderer,
	NativeCompilerGymActionTraceModelValueRenderer,
} from "./compiler-gym-action-trace-qualification-runner.js";
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
	buildCompilerGymIrDeltaQualificationPreregistration,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_ID,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREGISTRATION_PROTOCOL,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT,
	type CompilerGymIrDeltaQualificationArm,
	type CompilerGymIrDeltaQualificationEnvironment,
	type CompilerGymIrDeltaQualificationExecutionSpec,
	type CompilerGymIrDeltaQualificationPreregistration,
	parseCompilerGymIrDeltaQualificationPreregistration,
	verifyCompilerGymIrDeltaQualificationPrerequisiteEvidence,
} from "./compiler-gym-ir-delta-qualification-preregistration.js";
import {
	assertNoForbiddenIrDeltaProjectionMetadata,
	assessCompilerGymIrDeltaQualification,
	buildCompilerGymIrDeltaTreatmentEnvelopes,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL,
	type CompilerGymIrDeltaQualificationAssessment,
	type CompilerGymIrDeltaQualificationCase,
	type CompilerGymIrDeltaQualificationVisibilityEvidence,
} from "./compiler-gym-ir-delta-qualification-protocol.js";
import { COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT } from "./compiler-gym-ir-delta-smoke-preregistration.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
	type CompilerGymIrDeltaTrace,
} from "./compiler-gym-ir-delta-smoke-protocol.js";
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

const RUNNER_PROTOCOL = "compiler-gym-one-env-ir-delta-qualification-runner-v1" as const;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SLURM_ID_PATTERN = /^[1-9][0-9]*$/;
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

export interface CompilerGymIrDeltaQualificationRunnerConfig {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	commandTimeoutMs: number;
	accountingTimeoutMs: number;
	accountingPollMs: number;
	dispatchLockRoot?: string;
}

export const DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_RUNNER_LIMITS = {
	commandTimeoutMs: 6 * 60_000,
	accountingTimeoutMs: 2 * 60_000,
	accountingPollMs: 1_000,
} as const;

export interface CompilerGymIrDeltaQualificationRunnerClock {
	now(): Date;
	monotonicNs(): bigint;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export class SystemCompilerGymIrDeltaQualificationRunnerClock implements CompilerGymIrDeltaQualificationRunnerClock {
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

export interface CompilerGymIrDeltaQualificationEvidenceVerifier {
	verify(preregistration: CompilerGymIrDeltaQualificationPreregistration, repoRoot: string): Promise<void>;
}

class LocalCompilerGymIrDeltaQualificationEvidenceVerifier implements CompilerGymIrDeltaQualificationEvidenceVerifier {
	async verify(preregistration: CompilerGymIrDeltaQualificationPreregistration, repoRoot: string): Promise<void> {
		for (const candidate of preregistration.candidates) {
			const contents = await readFile(resolve(repoRoot, candidate.sourceEvidence.ledgerPath), "utf8");
			if (sha256Text(contents) !== candidate.sourceEvidence.ledgerSha256) {
				throw new Error(`${candidate.candidateId} historical ledger hash mismatch`);
			}
			const events = verifyLedgerContentsStrict(contents);
			for (const expected of [
				candidate.sourceEvidence.proposalEventSha256,
				candidate.sourceEvidence.measurementEventSha256,
			]) {
				if (!events.some((event) => event.hash === expected)) {
					throw new Error(`${candidate.candidateId} historical event ${expected} is absent`);
				}
			}
		}

		await verifyCompilerGymIrDeltaQualificationPrerequisiteEvidence(repoRoot);
	}
}

export interface CompilerGymIrDeltaQualificationRunnerDependencies {
	commandRunner?: CompilerGymWarmCommandRunner;
	clock?: CompilerGymIrDeltaQualificationRunnerClock;
	renderer?: CompilerGymActionTraceModelValueRenderer;
	evidenceVerifier?: CompilerGymIrDeltaQualificationEvidenceVerifier;
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

class RecordingCommandRunner implements CompilerGymWarmCommandRunner {
	private sequence = 0;
	readonly artifacts: ArtifactRef[] = [];

	constructor(
		private readonly delegate: CompilerGymWarmCommandRunner,
		private readonly artifactStore: ArtifactStore,
		private readonly ledger: EvidenceLedger,
		private readonly clock: CompilerGymIrDeltaQualificationRunnerClock,
	) {}

	nextSequence(): number {
		return this.sequence;
	}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		const sequence = this.sequence++;
		const startedAt = this.clock.now().toISOString();
		const startedMonotonicNs = this.clock.monotonicNs();
		const input = request.input === undefined ? null : await this.store(request.input, "application/octet-stream");
		let result: CompilerGymWarmCommandResult | null = null;
		let stdout: ArtifactRef | null = null;
		let stderr: ArtifactRef | null = null;
		let errorText: string | null = null;
		try {
			result = await this.delegate.run(request);
			stdout = await this.store(result.stdout, "text/plain");
			stderr = await this.store(result.stderr, "text/plain");
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
				type: "ir_delta_qualification_command",
				protocol: RUNNER_PROTOCOL,
				...evidence,
			});
		}
	}

	async store(content: string, mediaType: string): Promise<ArtifactRef> {
		const artifact = await this.artifactStore.putString(content, mediaType);
		this.artifacts.push(artifact);
		return artifact;
	}
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a nonempty string`);
	return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function safeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
	return value;
}

function positiveNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${path} must be finite and positive`);
	}
	return value;
}

function nonnegativeNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${path} must be finite and nonnegative`);
	}
	return value;
}

function strings(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${path} must be a string array`);
	}
	return [...value];
}

function integers(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an integer array`);
	return value.map((item, index) => nonnegativeInteger(item, `${path}[${index}]`));
}

function singleJsonLine(stdout: string, path: string): unknown {
	if (!stdout.endsWith("\n") || stdout.slice(0, -1).includes("\n")) {
		throw new Error(`${path} must be exactly one newline-terminated JSON line`);
	}
	return JSON.parse(stdout.slice(0, -1)) as unknown;
}

function forbiddenMetadataErrors(value: unknown, path = "result"): string[] {
	try {
		assertNoForbiddenIrDeltaProjectionMetadata(value, path);
		return [];
	} catch (error) {
		return [error instanceof Error ? error.message : String(error)];
	}
}

function exactEnvironmentIntegrity(result: Record<string, unknown>): void {
	const environment = object(result.environment, "result.environment");
	const seal = object(environment.seal, "result.environment.seal");
	if (
		seal.python_version !== "3.10.19" ||
		seal.distribution_manifest_sha256 !== COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256 ||
		seal.compatibility_tree_manifest_sha256 !== COMPILER_GYM_COMPATIBILITY_TREE_SHA256 ||
		seal.libtinfo_sha256 !== COMPILER_GYM_LIBTINFO_SHA256
	) {
		throw new Error("Evaluator environment seal differs from the frozen environment");
	}
	const provenance = object(result.provenance, "result.provenance");
	if (
		provenance.upstream_cbench_source_sha256 !== COMPILER_GYM_UPSTREAM_CBENCH_SHA256 ||
		provenance.cbench_patch_sha256 !== COMPILER_GYM_CBENCH_PATCH_SHA256 ||
		provenance.pinned_installed_cbench_source_sha256 !== COMPILER_GYM_INSTALLED_CBENCH_SHA256 ||
		provenance.installed_cbench_source_sha256 !== COMPILER_GYM_INSTALLED_CBENCH_SHA256 ||
		provenance.installed_cbench_source_matches_pin !== true ||
		provenance.farmshare_environment_seal_passed !== true
	) {
		throw new Error("Evaluator provenance differs from the frozen verifier");
	}
}

export type CompilerGymIrDeltaEvaluatorOutcome = "verified" | "semantic-rejection";

interface ParsedEvaluatorResult {
	benchmarkId: CompilerGymIrDeltaQualificationExecutionSpec["benchmarkId"];
	actions: string[];
	actionIndices: number[];
	initialIrInstructionCount: number;
	commandline: string;
	final: {
		irInstructionCount: number;
		objectTextSizeBytes: number;
		verifierPassed: boolean;
		verifierInputsExpected: 20;
		verifierInputsCompleted: number;
	};
	intrinsicTotalMs: number;
	timingsSeconds: Record<string, number>;
	slurmId: string;
	outcome: CompilerGymIrDeltaEvaluatorOutcome;
	trace: CompilerGymIrDeltaTrace | null;
	traceIntegrity: { passed: boolean; errors: string[] };
	controlStdout: string;
}

function parseTreatmentTrace(input: {
	result: Record<string, unknown>;
	actions: readonly string[];
	actionIndices: readonly number[];
	benchmarkId: string;
	initialIr: number;
	finalIr: number;
	verifierPassed: boolean;
	verifierInputsCompleted: number;
}): { trace: CompilerGymIrDeltaTrace | null; errors: string[] } {
	const errors = forbiddenMetadataErrors(input.result);
	if (!input.verifierPassed || input.verifierInputsCompleted !== 20) {
		if ("action_trace" in input.result) errors.push("Trace was emitted without a complete passing terminal verifier");
		return { trace: null, errors: [...errors, "Terminal semantic verifier rejected the treatment"] };
	}
	if (!("action_trace" in input.result))
		return { trace: null, errors: [...errors, "Passed treatment omitted action_trace"] };
	try {
		const rawTrace = object(input.result.action_trace, "result.action_trace");
		if (
			rawTrace.contract !== COMPILER_GYM_IR_DELTA_TRACE_CONTRACT ||
			rawTrace.prefix_conditional !== true ||
			rawTrace.intermediate_semantic_status !== "unverified" ||
			rawTrace.terminal_semantic_status !== "canonical-20-input-verifier" ||
			rawTrace.zero_delta_semantics !== COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS ||
			rawTrace.benchmark !== input.benchmarkId ||
			sha256Json(rawTrace.actions) !== sha256Json(input.actions) ||
			sha256Json(rawTrace.action_indices) !== sha256Json(input.actionIndices)
		) {
			throw new Error("Treatment trace contract or request binding is invalid");
		}
		const initialIrInstructionCount = nonnegativeInteger(
			rawTrace.initial_ir_instruction_count,
			"result.action_trace.initial_ir_instruction_count",
		);
		if (initialIrInstructionCount !== input.initialIr)
			throw new Error("Treatment trace initial IR differs from result");
		if (!Array.isArray(rawTrace.records) || rawTrace.records.length !== input.actions.length) {
			throw new Error("Treatment trace record count differs from actions");
		}
		let deltaSum = 0;
		const records = rawTrace.records.map((raw, index) => {
			const item = object(raw, `result.action_trace.records[${index}]`);
			const keys = Object.keys(item).sort();
			if (JSON.stringify(keys) !== JSON.stringify(["action", "action_index", "delta_from_previous", "index"])) {
				throw new Error(`Treatment trace record ${index} keys drifted`);
			}
			const recordIndex = nonnegativeInteger(item.index, `trace.records[${index}].index`);
			const action = string(item.action, `trace.records[${index}].action`);
			const actionIndex = nonnegativeInteger(item.action_index, `trace.records[${index}].action_index`);
			const deltaFromPrevious = safeInteger(item.delta_from_previous, `trace.records[${index}].delta_from_previous`);
			if (recordIndex !== index || action !== input.actions[index] || actionIndex !== input.actionIndices[index]) {
				throw new Error(`Treatment trace record ${index} is not bound to the frozen action order`);
			}
			deltaSum += deltaFromPrevious;
			if (!Number.isSafeInteger(deltaSum)) throw new Error("Treatment trace delta sum is not safe");
			return { index: recordIndex, action, actionIndex, deltaFromPrevious };
		});
		if (initialIrInstructionCount + deltaSum !== input.finalIr) {
			throw new Error("Treatment trace does not telescope to terminal IR");
		}
		if (errors.length > 0) return { trace: null, errors };
		return { trace: { initialIrInstructionCount, records }, errors: [] };
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
		return { trace: null, errors };
	}
}

export function parseCompilerGymIrDeltaQualificationEvaluatorResult(input: {
	stdout: string;
	exitCode: number;
	arm: CompilerGymIrDeltaQualificationArm | "canonical-semantic-result";
	benchmarkId: CompilerGymIrDeltaQualificationExecutionSpec["benchmarkId"];
	actions: readonly string[];
}): ParsedEvaluatorResult {
	const result = object(singleJsonLine(input.stdout, "evaluator stdout"), "evaluator result");
	if (result.schema_version !== 2) throw new Error("Evaluator result is not schema v2");
	if (input.arm === "canonical") {
		if (
			input.exitCode !== 0 ||
			result.contract !== COMPILER_GYM_VERIFIER_EPOCH ||
			result.ok !== true ||
			result.status !== "passed" ||
			"terminal_verifier_contract" in result ||
			"action_trace" in result
		) {
			throw new Error("Canonical anchor did not return the exact passing contract");
		}
	} else if (input.arm === "canonical-semantic-result") {
		const accepted = input.exitCode === 0 && result.ok === true && result.status === "passed";
		const rejected = input.exitCode === 5 && result.ok === false && result.status === "semantic_validation_failed";
		if (
			(!accepted && !rejected) ||
			result.contract !== COMPILER_GYM_VERIFIER_EPOCH ||
			"terminal_verifier_contract" in result ||
			"action_trace" in result
		) {
			throw new Error("Canonical semantic-result evaluator did not return an exact terminal contract");
		}
	} else if (
		result.contract !== COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT ||
		result.terminal_verifier_contract !== COMPILER_GYM_VERIFIER_EPOCH
	) {
		throw new Error("Treatment evaluator contract is not bound to the canonical verifier epoch");
	}
	const outcome: CompilerGymIrDeltaEvaluatorOutcome =
		(input.arm === "one-env-ir-delta" || input.arm === "canonical-semantic-result") &&
		input.exitCode === 5 &&
		result.ok === false &&
		result.status === "semantic_validation_failed"
			? "semantic-rejection"
			: "verified";
	if ((input.arm === "one-env-ir-delta" || input.arm === "canonical-semantic-result") && outcome === "verified") {
		if (input.exitCode !== 0 || result.ok !== true || result.status !== "passed") {
			throw new Error(
				input.arm === "one-env-ir-delta"
					? "Treatment failure is not a structured complete semantic rejection"
					: "Canonical failure is not a structured complete semantic rejection",
			);
		}
	}
	if (result.benchmark !== input.benchmarkId) throw new Error("Evaluator benchmark differs from frozen request");
	const request = object(result.request, "result.request");
	const actions = strings(request.actions, "result.request.actions");
	if (request.benchmark !== input.benchmarkId || sha256Json(actions) !== sha256Json(input.actions)) {
		throw new Error("Evaluator request differs from the frozen case");
	}
	const actionIndices = integers(result.action_indices, "result.action_indices");
	if (actionIndices.length !== actions.length) throw new Error("Evaluator action-index count differs from actions");
	const metrics = object(result.metrics, "result.metrics");
	const initial = object(metrics.initial, "result.metrics.initial");
	const final = object(metrics.final, "result.metrics.final");
	const initialIrInstructionCount = nonnegativeInteger(
		initial.IrInstructionCount,
		"result.metrics.initial.IrInstructionCount",
	);
	const finalIr = nonnegativeInteger(final.IrInstructionCount, "result.metrics.final.IrInstructionCount");
	const finalObject = nonnegativeInteger(final.ObjectTextSizeBytes, "result.metrics.final.ObjectTextSizeBytes");
	const validation = object(result.validation, "result.validation");
	if (typeof validation.passed !== "boolean") throw new Error("result.validation.passed must be a boolean");
	const verifierInputsCompleted = nonnegativeInteger(
		validation.inputs_completed,
		"result.validation.inputs_completed",
	);
	if (
		validation.inputs_expected !== 20 ||
		validation.base_callbacks_selected !== 20 ||
		validation.sanitizer_callbacks_selected !== 0 ||
		verifierInputsCompleted !== 20
	) {
		throw new Error("Evaluator terminal verification is incomplete");
	}
	if (!Array.isArray(validation.semantic_errors)) {
		throw new Error("result.validation.semantic_errors must be an array");
	}
	if (!Array.isArray(validation.inputs) || validation.inputs.length !== 20) {
		throw new Error("Evaluator must include exactly 20 ordered terminal verification outcomes");
	}
	const flattenedSemanticErrors: unknown[] = [];
	const inputPasses = validation.inputs.map((raw, index) => {
		const item = object(raw, `result.validation.inputs[${index}]`);
		if (
			item.input_index !== index + 1 ||
			item.completed !== true ||
			typeof item.passed !== "boolean" ||
			!Array.isArray(item.errors)
		) {
			throw new Error(`Terminal verification outcome ${index + 1} is malformed or incomplete`);
		}
		const expectedPassed = item.errors.length === 0;
		if (item.passed !== expectedPassed) {
			throw new Error(`Terminal verification outcome ${index + 1} is contradictory`);
		}
		flattenedSemanticErrors.push(...item.errors);
		return item.passed;
	});
	if (canonicalJson(toJsonValue(validation.semantic_errors)) !== canonicalJson(toJsonValue(flattenedSemanticErrors))) {
		throw new Error("Terminal semantic error summary does not bind the 20 ordered outcomes");
	}
	const verifierPassed = validation.passed;
	if ((outcome === "verified") !== verifierPassed) throw new Error("Evaluator status contradicts terminal verifier");
	if (outcome === "verified") {
		if (!inputPasses.every(Boolean) || validation.semantic_errors.length !== 0) {
			throw new Error("Passing terminal verifier contains a rejected input or semantic error");
		}
	} else {
		if (inputPasses.every(Boolean) || validation.semantic_errors.length === 0) {
			throw new Error("Structured semantic rejection must contain terminal semantic errors");
		}
	}
	exactEnvironmentIntegrity(result);
	const environment = object(result.environment, "result.environment");
	const slurmId = string(environment.slurm_job_id, "result.environment.slurm_job_id");
	if (!SLURM_ID_PATTERN.test(slurmId) || environment.slurm_cpus_per_task !== "2") {
		throw new Error("Evaluator did not run under the frozen two-CPU Slurm contract");
	}
	const rawTimings = object(result.timings_seconds, "result.timings_seconds");
	if ("shadow_action_trace" in rawTimings) {
		throw new Error("Treatment timings must not contain shadow_action_trace");
	}
	const timingsSeconds: Record<string, number> = {};
	for (const [name, value] of Object.entries(rawTimings)) {
		timingsSeconds[name] = nonnegativeNumber(value, `result.timings_seconds.${name}`);
	}
	const intrinsicTotalMs = positiveNumber(rawTimings.total, "result.timings_seconds.total") * 1000;
	const commandline = string(result.commandline, "result.commandline");
	let trace: CompilerGymIrDeltaTrace | null = null;
	let traceIntegrity = { passed: true, errors: [] as string[] };
	if (input.arm === "one-env-ir-delta") {
		const parsedTrace = parseTreatmentTrace({
			result,
			actions,
			actionIndices,
			benchmarkId: input.benchmarkId,
			initialIr: initialIrInstructionCount,
			finalIr,
			verifierPassed,
			verifierInputsCompleted,
		});
		trace = parsedTrace.trace;
		traceIntegrity = { passed: parsedTrace.errors.length === 0, errors: parsedTrace.errors };
	}
	const control = structuredClone(result);
	delete control.action_trace;
	const controlStdout = `${canonicalJson(toJsonValue(control))}\n`;
	return {
		benchmarkId: input.benchmarkId,
		actions,
		actionIndices,
		initialIrInstructionCount,
		commandline,
		final: {
			irInstructionCount: finalIr,
			objectTextSizeBytes: finalObject,
			verifierPassed,
			verifierInputsExpected: 20,
			verifierInputsCompleted,
		},
		intrinsicTotalMs,
		timingsSeconds,
		slurmId,
		outcome,
		trace,
		traceIntegrity,
		controlStdout,
	};
}

export interface CompilerGymIrDeltaQualificationAccounting {
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

export function parseCompilerGymIrDeltaQualificationAccounting(
	stdout: string,
): CompilerGymIrDeltaQualificationAccounting {
	const lines = stdout.trim().split("\n").filter(Boolean);
	if (lines.length !== 1) throw new Error("sacct must return exactly one root allocation row");
	const fields = lines[0].split("|");
	if (fields.at(-1) === "") fields.pop();
	if (fields.length !== 11) throw new Error("sacct row has an unexpected field count");
	const [jobIdRaw, jobName, state, exitCode, allocCpus, nTasks, elapsedRaw, cpuTimeRaw, nodeList, startAt, endAt] =
		fields;
	if (!SLURM_ID_PATTERN.test(jobIdRaw)) throw new Error("sacct JobIDRaw is invalid");
	const parseInteger = (value: string, path: string): number => {
		if (!/^[0-9]+$/.test(value)) throw new Error(`sacct ${path} is not an integer`);
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed)) throw new Error(`sacct ${path} is not a safe integer`);
		return parsed;
	};
	const parsedAllocCpus = parseInteger(allocCpus, "AllocCPUS");
	const parsedElapsed = parseInteger(elapsedRaw, "ElapsedRaw");
	const parsedCpuTime = parseInteger(cpuTimeRaw, "CPUTimeRAW");
	const expectedCpuTime = parsedAllocCpus * parsedElapsed;
	if (!Number.isSafeInteger(expectedCpuTime)) {
		throw new Error("sacct AllocCPUS multiplied by ElapsedRaw is not a safe integer");
	}
	if (parsedCpuTime !== expectedCpuTime) {
		throw new Error("sacct CPUTimeRAW must equal AllocCPUS multiplied by ElapsedRaw");
	}
	return {
		jobIdRaw,
		jobName: string(jobName, "sacct jobName"),
		state: string(state, "sacct state"),
		exitCode: string(exitCode, "sacct exitCode"),
		allocCpus: parsedAllocCpus,
		nTasks: nTasks === "" ? null : parseInteger(nTasks, "NTasks"),
		elapsedRawSeconds: parsedElapsed,
		cpuTimeRawSeconds: parsedCpuTime,
		nodeList: string(nodeList, "sacct nodeList"),
		startAt: string(startAt, "sacct startAt"),
		endAt: string(endAt, "sacct endAt"),
	};
}

function sacctArgv(slurmId: string): [string, ...string[]] {
	if (!SLURM_ID_PATTERN.test(slurmId)) throw new Error("Invalid Slurm ID for sacct");
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

function environmentProbeArgv(
	environment: CompilerGymIrDeltaQualificationEnvironment,
	remotePath: string,
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
		remotePath,
	];
}

function parseEnvironmentProbe(
	result: CompilerGymWarmCommandResult,
	preregistration: CompilerGymIrDeltaQualificationPreregistration,
): string {
	if (result.exitCode !== 0 || result.stderr !== "")
		throw new Error(`Environment probe failed: ${result.stderr.trim()}`);
	const parsed = singleJsonLine(result.stdout, "environment probe stdout");
	const expected = canonicalJson(toJsonValue(preregistration.environmentProbe.expectedResult));
	if (canonicalJson(toJsonValue(parsed)) !== expected || result.stdout !== `${expected}\n`) {
		throw new Error("Environment probe does not exactly match the frozen seal");
	}
	return expected;
}

export function compilerGymIrDeltaQualificationSrunArgv(input: {
	spec: CompilerGymIrDeltaQualificationExecutionSpec;
	remoteEvaluatorPath: string;
	environment: CompilerGymIrDeltaQualificationEnvironment;
	dispatchNonce: string;
}): { argv: [string, ...string[]]; transientCache: string; jobName: string } {
	if (!/^[0-9a-f]{16}$/.test(input.dispatchNonce)) throw new Error("Dispatch nonce must be 16 lowercase hex digits");
	const task = input.spec.benchmarkId.split("/").at(-1);
	const arm = input.spec.arm === "canonical" ? "c" : "t";
	const suffix = `${input.spec.allocationOrdinal}-${input.spec.candidateId.toLowerCase()}-${task}-${arm}`;
	const transientCache = `/tmp/prime-ir-delta-q-${input.dispatchNonce}-${suffix}`;
	const jobName = `pidq-${suffix}`;
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
		`--job-name=${jobName}`,
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
	if (
		argv.some(
			(item) =>
				item.includes("sbatch") ||
				item.startsWith("--jobid") ||
				item.startsWith("--dependency") ||
				item === "--overlap" ||
				item === "--exact" ||
				item === "--hold",
		)
	) {
		throw new Error("Qualification may only use independent stock-cold allocations");
	}
	return { argv, transientCache, jobName };
}

export async function ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree(
	remoteFileSystem: Pick<CompilerGymWarmRemoteFileSystem, "ensurePrivateDirectory">,
	directory: string,
	signal: AbortSignal,
): Promise<void> {
	if (!directory.startsWith("/") || posix.normalize(directory) !== directory || directory.endsWith("/")) {
		throw new Error("Remote source directory must be absolute and normalized");
	}
	const components = directory.split("/").slice(1);
	if (
		components.length < 5 ||
		(components[0] !== "scratch" && components[0] !== "home") ||
		components[1] !== "users" ||
		!components[2]
	) {
		throw new Error("Remote source directory must be under a user storage root");
	}
	let current = `/${components.slice(0, 3).join("/")}`;
	for (const component of components.slice(3)) {
		current = posix.join(current, component);
		await remoteFileSystem.ensurePrivateDirectory(current, signal);
	}
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

async function verifySources(
	preregistration: CompilerGymIrDeltaQualificationPreregistration,
	repoRoot: string,
): Promise<void> {
	const [canonicalSource, treatmentSource, probeSource, closure] = await Promise.all([
		readFile(preregistration.sources.canonicalPath, "utf8"),
		readFile(preregistration.sources.treatmentPath, "utf8"),
		readFile(preregistration.sources.environmentProbePath, "utf8"),
		Promise.all(
			preregistration.implementationClosure.map(async (item) => ({
				relativePath: item.relativePath,
				sha256: sha256Text(await readFile(resolve(repoRoot, item.relativePath), "utf8")),
			})),
		),
	]);
	if (
		sha256Text(canonicalSource) !== preregistration.sources.canonicalSha256 ||
		sha256Text(treatmentSource) !== preregistration.sources.treatmentSha256 ||
		sha256Text(probeSource) !== preregistration.sources.environmentProbeSha256 ||
		canonicalJson(toJsonValue(closure)) !== canonicalJson(toJsonValue(preregistration.implementationClosure))
	) {
		throw new Error("Evaluator, probe, or implementation source changed during qualification");
	}
}

export interface CompilerGymIrDeltaQualificationAllocationEvidence {
	spec: CompilerGymIrDeltaQualificationExecutionSpec;
	requestSha256: string;
	evaluatorSha256: string;
	remoteArgv: string[];
	outerArgv: string[];
	transientCache: string;
	commandSequence: number;
	slurmId: string;
	accountingCommandSequences: number[];
	accounting: CompilerGymIrDeltaQualificationAccounting;
	parsed: ParsedEvaluatorResult;
	stdoutArtifact: ArtifactRef;
	stderrArtifact: ArtifactRef;
	controlStdoutArtifact: ArtifactRef;
}

export interface CompilerGymIrDeltaQualificationVisibilityArtifact {
	candidateId: string;
	controlEnvelope: ArtifactRef;
	controlRenderedText: ArtifactRef;
	typedTraceEnvelope: ArtifactRef;
	combinedTreatmentEnvelope: ArtifactRef;
	combinedTreatmentRenderedText: ArtifactRef;
}

export interface CompilerGymIrDeltaQualificationResult {
	protocol: typeof RUNNER_PROTOCOL;
	admission: "requires-terminal-complete-ledger-event";
	qualificationId: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_ID;
	preregistrationSha256: string;
	modelCalls: 0;
	measurementReuse: false;
	formalMeasurementsReused: false;
	smokeMeasurementsUsed: false;
	causalTreatmentClaimAllowed: false;
	lunaAuthorized: false;
	sourceDirectory: string;
	dispatchAttempt: Record<string, unknown>;
	rendererPreflight: {
		protocol: string;
		control: { inputSha256: string; cellSha256: string; renderedTextSha256: string; agentFacingBytes: number };
		treatment: { inputSha256: string; cellSha256: string; renderedTextSha256: string; agentFacingBytes: number };
		incrementalBytes: number;
	};
	environmentProbe: { preflightCommandSequence: number; postflightCommandSequence: number; stdoutSha256: string };
	allocations: CompilerGymIrDeltaQualificationAllocationEvidence[];
	cases: CompilerGymIrDeltaQualificationCase[];
	visibility: CompilerGymIrDeltaQualificationVisibilityEvidence | null;
	visibilityArtifacts: CompilerGymIrDeltaQualificationVisibilityArtifact[];
	assessment: CompilerGymIrDeltaQualificationAssessment;
	terminalDisposition: "terminal-complete-scientific-pass" | "terminal-complete-scientific-kill";
	squeueAbsenceCommandSequence: number;
	ledgerPath: string;
	ledgerEventCount: number;
	startedAt: string;
	finishedAt: string;
}

function candidateFor(
	preregistration: CompilerGymIrDeltaQualificationPreregistration,
	candidateId: string,
): CompilerGymIrDeltaQualificationPreregistration["candidates"][number] {
	const candidate = preregistration.candidates.find((item) => item.candidateId === candidateId);
	if (!candidate) throw new Error(`Unknown candidate ${candidateId}`);
	return candidate;
}

function casesFromAllocations(
	preregistration: CompilerGymIrDeltaQualificationPreregistration,
	allocations: readonly CompilerGymIrDeltaQualificationAllocationEvidence[],
): CompilerGymIrDeltaQualificationCase[] {
	const caseIds = ["S12-blowfish", "S12-bzip2", "L46-bzip2", "L46-blowfish"] as const;
	return caseIds.map((caseId) => {
		const canonical = allocations.find((item) => item.spec.caseId === caseId && item.spec.arm === "canonical");
		const treatment = allocations.find((item) => item.spec.caseId === caseId && item.spec.arm === "one-env-ir-delta");
		if (!canonical || !treatment) throw new Error(`Incomplete paired case ${caseId}`);
		const candidate = candidateFor(preregistration, canonical.spec.candidateId);
		return {
			caseId,
			candidateId: candidate.candidateId,
			candidateSha256: candidate.actionsSha256,
			benchmarkId: canonical.spec.benchmarkId,
			actions: [...candidate.actions],
			canonical: {
				initialIrInstructionCount: canonical.parsed.initialIrInstructionCount,
				actionIndices: [...canonical.parsed.actionIndices],
				commandline: canonical.parsed.commandline,
				final: { ...canonical.parsed.final },
				intrinsicTotalMs: canonical.parsed.intrinsicTotalMs,
			},
			treatment: {
				initialIrInstructionCount: treatment.parsed.initialIrInstructionCount,
				actionIndices: [...treatment.parsed.actionIndices],
				commandline: treatment.parsed.commandline,
				final: { ...treatment.parsed.final },
				intrinsicTotalMs: treatment.parsed.intrinsicTotalMs,
				trace: treatment.parsed.trace ? structuredClone(treatment.parsed.trace) : null,
				traceIntegrity: structuredClone(treatment.parsed.traceIntegrity),
			},
		};
	});
}

function stockControlRequest(actions: readonly string[]) {
	return {
		actions: [...actions],
		hypothesis: "The frozen candidate reproduces its terminal metrics under the fresh one-environment evaluator.",
		mechanism: "Replay the preregistered candidate on the fixed stock task pair with fresh measurements.",
		predictedOutcome: "Terminal metrics remain equal to the immutable accepted source measurement.",
		boundaryConditions: [
			"The candidate and fixed task pair are unchanged.",
			"Only the complete canonical terminal verifier establishes semantic acceptance.",
		],
	};
}

async function buildVisibilityEvidence(input: {
	preregistration: CompilerGymIrDeltaQualificationPreregistration;
	cases: readonly CompilerGymIrDeltaQualificationCase[];
	allocations: readonly CompilerGymIrDeltaQualificationAllocationEvidence[];
	artifacts: ArtifactStore;
	renderer: CompilerGymActionTraceModelValueRenderer;
	signal: AbortSignal;
}): Promise<{
	visibility: CompilerGymIrDeltaQualificationVisibilityEvidence;
	artifacts: CompilerGymIrDeltaQualificationVisibilityArtifact[];
	allArtifacts: ArtifactRef[];
}> {
	const treatmentEnvelopes = buildCompilerGymIrDeltaTreatmentEnvelopes(input.cases);
	const candidates: CompilerGymIrDeltaQualificationVisibilityEvidence["candidates"] = [];
	const artifacts: CompilerGymIrDeltaQualificationVisibilityArtifact[] = [];
	const allArtifacts: ArtifactRef[] = [];
	for (const candidate of input.preregistration.candidates) {
		const treatmentAllocations = input.preregistration.benchmarks.map((benchmarkId) => {
			const allocation = input.allocations.find(
				(item) =>
					item.spec.candidateId === candidate.candidateId &&
					item.spec.benchmarkId === benchmarkId &&
					item.spec.arm === "one-env-ir-delta",
			);
			if (!allocation) throw new Error(`Missing treatment source for ${candidate.candidateId}:${benchmarkId}`);
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
			`${canonicalJson(toJsonValue(treatmentAllocations.map((allocation) => allocation.controlStdoutArtifact)))}\n`,
			"application/json",
		);
		const stderrArtifact = await input.artifacts.putString("", "text/plain");
		allArtifacts.push(candidateArtifact, stdoutArtifact, stderrArtifact);
		const measuredAt = input.preregistration.createdAt;
		const proposal: JobView["proposal"] = {
			jobId,
			manifestDigest,
			branchId: "stock-prime-core-ir-delta-projected-control",
			lane: "compiler-gym",
			benchmarkIds: [...input.preregistration.benchmarks],
			budgetClass: "smoke",
			treatment: "stock-prime-core-isolated",
			proposal: {
				hypothesis: request.hypothesis,
				mechanism: request.mechanism,
				predictedOutcome: request.predictedOutcome,
				boundaryConditions: [...request.boundaryConditions],
				parentJobIds: [],
			},
			candidate: candidateArtifact,
			candidateFormat: "llvm-pass-sequence",
			requireFreshMeasurement: true,
		};
		const submitted: SubmitResult = { jobId, acceptedAt: measuredAt, manifestDigest, duplicate: false };
		const job: JobView = {
			proposal,
			state: { jobId, status: "succeeded", statusAt: measuredAt, externalJobId: null, reason: null },
			measurement: {
				jobId,
				manifestDigest,
				verifierEpoch: input.preregistration.expectedVerifierEpoch,
				measuredAt,
				tasks: treatmentAllocations.map((allocation) => ({
					benchmarkId: allocation.spec.benchmarkId,
					status: "accepted",
					metrics: {
						IrInstructionCount: allocation.parsed.final.irInstructionCount,
						ObjectTextSizeBytes: allocation.parsed.final.objectTextSizeBytes,
						evaluatorRuntimeMs: allocation.parsed.intrinsicTotalMs,
						schedulerAndEvaluatorWallMs: allocation.accounting.elapsedRawSeconds * 1000,
						queueAndTransportMs: Math.max(
							0,
							allocation.accounting.elapsedRawSeconds * 1000 - allocation.parsed.intrinsicTotalMs,
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
					evaluatorSha256: input.preregistration.sources.treatmentSha256,
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
			branchId: "stock-prime-core-ir-delta-projected-control",
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
		const controlEnvelope = buildStockCpuEvaluationEnvelope({ request, submitted, job, budget });
		const treatmentEnvelope = treatmentEnvelopes.find((item) => item.candidateId === candidate.candidateId);
		if (!treatmentEnvelope) throw new Error(`Missing treatment envelope for ${candidate.candidateId}`);
		const combinedTreatmentEnvelope = { ...controlEnvelope, irDeltaTrace: treatmentEnvelope };
		const controlEnvelopeJson = JSON.stringify(controlEnvelope);
		const typedTraceEnvelopeJson = JSON.stringify(treatmentEnvelope);
		const combinedTreatmentEnvelopeJson = JSON.stringify(combinedTreatmentEnvelope);
		const controlRendered = await input.renderer.render(`${controlEnvelopeJson}\n`, input.signal);
		const combinedRendered = await input.renderer.render(`${combinedTreatmentEnvelopeJson}\n`, input.signal);
		for (const rendered of [controlRendered, combinedRendered]) {
			if (
				rendered.rendererProtocol !== input.preregistration.renderer.protocol ||
				rendered.agentFacingBytes !== Buffer.byteLength(rendered.text, "utf8") ||
				rendered.renderedTextSha256 !== sha256Text(rendered.text)
			) {
				throw new Error("Native renderer evidence is internally inconsistent");
			}
		}
		const [
			controlEnvelopeArtifact,
			controlRenderedArtifact,
			typedTraceArtifact,
			combinedArtifact,
			combinedRenderedArtifact,
		] = await Promise.all([
			input.artifacts.putString(`${controlEnvelopeJson}\n`, "application/json"),
			input.artifacts.putString(controlRendered.text, "text/plain"),
			input.artifacts.putString(`${typedTraceEnvelopeJson}\n`, "application/json"),
			input.artifacts.putString(`${combinedTreatmentEnvelopeJson}\n`, "application/json"),
			input.artifacts.putString(combinedRendered.text, "text/plain"),
		]);
		candidates.push({
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
			combinedTreatmentRenderedText: combinedRendered.text,
			combinedTreatmentRenderedTextSha256: combinedRendered.renderedTextSha256,
			combinedTreatmentProjectedAgentFacingBytes: combinedRendered.agentFacingBytes,
		});
		artifacts.push({
			candidateId: candidate.candidateId,
			controlEnvelope: controlEnvelopeArtifact,
			controlRenderedText: controlRenderedArtifact,
			typedTraceEnvelope: typedTraceArtifact,
			combinedTreatmentEnvelope: combinedArtifact,
			combinedTreatmentRenderedText: combinedRenderedArtifact,
		});
		allArtifacts.push(
			controlEnvelopeArtifact,
			controlRenderedArtifact,
			typedTraceArtifact,
			combinedArtifact,
			combinedRenderedArtifact,
		);
	}
	return {
		visibility: {
			protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL,
			rendererProtocol: "prime-native-ipython-json-value-v1",
			candidates,
		},
		artifacts,
		allArtifacts,
	};
}

async function waitForAccounting(input: {
	slurmId: string;
	expectedJobName: string;
	expectedOutcome: CompilerGymIrDeltaEvaluatorOutcome;
	recorder: RecordingCommandRunner;
	preregistration: CompilerGymIrDeltaQualificationPreregistration;
	config: CompilerGymIrDeltaQualificationRunnerConfig;
	clock: CompilerGymIrDeltaQualificationRunnerClock;
	signal: AbortSignal;
}): Promise<{ accounting: CompilerGymIrDeltaQualificationAccounting; sequences: number[] }> {
	const started = input.clock.monotonicNs();
	const sequences: number[] = [];
	while (true) {
		sequences.push(input.recorder.nextSequence());
		const result = await input.recorder.run({
			argv: compilerGymWarmSshArgv(input.preregistration.environment.host, sacctArgv(input.slurmId)),
			signal: input.signal,
			timeoutMs: input.config.commandTimeoutMs,
			maxOutputBytes: 1024 * 1024,
		});
		if (result.exitCode !== 0) throw new Error(`sacct failed for ${input.slurmId}: ${result.stderr.trim()}`);
		if (result.stdout.trim()) {
			const accounting = parseCompilerGymIrDeltaQualificationAccounting(result.stdout);
			if (accounting.jobIdRaw !== input.slurmId || accounting.jobName !== input.expectedJobName) {
				throw new Error("sacct row does not bind the measured allocation");
			}
			if (TERMINAL_STATES.has(accounting.state)) {
				const statusPassed =
					input.expectedOutcome === "verified"
						? accounting.state === "COMPLETED" && accounting.exitCode === "0:0"
						: accounting.state === "FAILED" && accounting.exitCode === "5:0";
				if (
					!statusPassed ||
					!input.preregistration.environment.acceptedRootAllocCpus.includes(accounting.allocCpus as 2 | 4) ||
					(accounting.nTasks !== null && accounting.nTasks !== 1)
				) {
					throw new Error(`Allocation ${input.slurmId} did not complete with its frozen scientific outcome`);
				}
				return { accounting, sequences };
			}
		}
		if (Number(input.clock.monotonicNs() - started) / 1_000_000 >= input.config.accountingTimeoutMs) {
			throw new Error(`Timed out waiting for sacct ${input.slurmId}`);
		}
		await input.clock.sleep(input.config.accountingPollMs, input.signal);
	}
}

export class CompilerGymIrDeltaQualificationRunner {
	private readonly clock: CompilerGymIrDeltaQualificationRunnerClock;
	private readonly commandRunner: CompilerGymWarmCommandRunner;
	private readonly renderer: CompilerGymActionTraceModelValueRenderer;
	private readonly evidenceVerifier: CompilerGymIrDeltaQualificationEvidenceVerifier;

	constructor(
		private readonly config: CompilerGymIrDeltaQualificationRunnerConfig,
		dependencies: CompilerGymIrDeltaQualificationRunnerDependencies = {},
	) {
		this.clock = dependencies.clock ?? new SystemCompilerGymIrDeltaQualificationRunnerClock();
		this.commandRunner = dependencies.commandRunner ?? new SpawnCompilerGymWarmCommandRunner();
		this.renderer = dependencies.renderer ?? new NativeCompilerGymActionTraceModelValueRenderer(config.outputDir);
		this.evidenceVerifier =
			dependencies.evidenceVerifier ?? new LocalCompilerGymIrDeltaQualificationEvidenceVerifier();
	}

	async run(): Promise<CompilerGymIrDeltaQualificationResult> {
		const signal = new AbortController().signal;
		const preregistrationRaw = await readFile(resolve(this.config.preregistrationPath), "utf8");
		const preregistration = parseCompilerGymIrDeltaQualificationPreregistration(
			singleJsonLine(preregistrationRaw, "preregistration"),
		);
		const preregistrationSha256 = sha256Text(preregistrationRaw);
		const [canonicalSource, treatmentSource, probeSource, implementationClosure] = await Promise.all([
			readFile(preregistration.sources.canonicalPath, "utf8"),
			readFile(preregistration.sources.treatmentPath, "utf8"),
			readFile(preregistration.sources.environmentProbePath, "utf8"),
			Promise.all(
				COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
					relativePath,
					sha256: sha256Text(await readFile(resolve(this.config.repoRoot, relativePath), "utf8")),
				})),
			),
		]);
		const reconstructed = buildCompilerGymIrDeltaQualificationPreregistration({
			createdAt: preregistration.createdAt,
			primeAgentCommit: preregistration.primeAgentCommit,
			canonicalPath: preregistration.sources.canonicalPath,
			canonicalSource,
			treatmentPath: preregistration.sources.treatmentPath,
			treatmentSource,
			environmentProbePath: preregistration.sources.environmentProbePath,
			environmentProbeSource: probeSource,
			implementationClosure,
		});
		parseCompilerGymIrDeltaQualificationPreregistration(preregistration, reconstructed);
		await this.evidenceVerifier.verify(preregistration, resolve(this.config.repoRoot));

		await mkdir(dirname(resolve(this.config.outputDir)), { recursive: true, mode: 0o700 });
		await mkdir(resolve(this.config.outputDir), { mode: 0o700 });
		const ledgerPath = resolve(this.config.outputDir, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(ledgerPath);
		if (ledger.getEvents().length !== 0) throw new Error("Qualification ledger must start empty");
		const artifactStore = new ArtifactStore(resolve(this.config.outputDir, "artifacts"));
		const recorder = new RecordingCommandRunner(this.commandRunner, artifactStore, ledger, this.clock);
		const remoteFileSystem = new SshCompilerGymWarmRemoteFileSystem(
			recorder,
			preregistration.environment.host,
			"/usr/bin/python3",
			this.config.commandTimeoutMs,
		);
		const startedAt = this.clock.now().toISOString();
		await ledger.append("run_manifest", {
			type: "ir_delta_qualification",
			phase: "start",
			protocol: RUNNER_PROTOCOL,
			preregistrationProtocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREGISTRATION_PROTOCOL,
			preregistrationSha256,
			executionPlan: preregistration.executionPlan,
			prerequisiteEvidence: preregistration.prerequisiteEvidence,
			modelCalls: 0,
			measurementReuse: false,
			formalMeasurementsReused: false,
			smokeMeasurementsUsed: false,
			causalTreatmentClaimAllowed: false,
			lunaAuthorized: false,
			startedAt,
		});

		const sourceDirectory = posix.join(
			preregistration.environment.remoteSourceRoot,
			preregistration.sources.combinedSha256,
		);
		const canonicalRemotePath = posix.join(sourceDirectory, "compiler_gym_eval.py");
		const treatmentRemotePath = posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py");
		const probeRemotePath = posix.join(sourceDirectory, "compiler_gym_env_probe.py");
		const allocations: CompilerGymIrDeltaQualificationAllocationEvidence[] = [];
		const slurmIds = new Set<string>();
		const transientCaches = new Set<string>();
		const resultPath = resolve(this.config.outputDir, "result.json");
		let resultWritten = false;
		let rendererClosed = false;
		try {
			const rendererFixture = preregistration.renderer.syntheticPreflight;
			const fixtureTreatment = structuredClone(
				COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT,
			) as Record<string, unknown>;
			delete fixtureTreatment.irDeltaTrace;
			if (
				canonicalJson(toJsonValue(fixtureTreatment)) !==
				canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL))
			) {
				throw new Error("Renderer preflight treatment differs from control outside irDeltaTrace");
			}
			assertNoForbiddenIrDeltaProjectionMetadata(
				COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT,
				"rendererPreflight",
			);
			const controlRendered = await this.renderer.render(rendererFixture.controlJsonValue, signal);
			const treatmentRendered = await this.renderer.render(rendererFixture.treatmentJsonValue, signal);
			for (const [name, rendered, jsonValue, expectedInputSha256, expectedCellSha256] of [
				[
					"control",
					controlRendered,
					rendererFixture.controlJsonValue,
					rendererFixture.controlJsonValueSha256,
					rendererFixture.controlCellSha256,
				],
				[
					"treatment",
					treatmentRendered,
					rendererFixture.treatmentJsonValue,
					rendererFixture.treatmentJsonValueSha256,
					rendererFixture.treatmentCellSha256,
				],
			] as const) {
				if (
					sha256Text(jsonValue) !== expectedInputSha256 ||
					rendered.rendererProtocol !== preregistration.renderer.protocol ||
					rendered.cellSha256 !== expectedCellSha256 ||
					rendered.renderedTextSha256 !== sha256Text(rendered.text) ||
					rendered.agentFacingBytes !== Buffer.byteLength(rendered.text, "utf8") ||
					rendered.agentFacingBytes === 0
				) {
					throw new Error(`Native renderer ${name} synthetic preflight is invalid`);
				}
			}
			const incrementalBytes = treatmentRendered.agentFacingBytes - controlRendered.agentFacingBytes;
			if (
				incrementalBytes <= 0 ||
				rendererFixture.controlJsonValue !==
					`${JSON.stringify(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL)}\n` ||
				rendererFixture.treatmentJsonValue !==
					`${JSON.stringify(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT)}\n`
			) {
				throw new Error("Native renderer synthetic preflight lacks a positive projection-only increment");
			}
			const rendererPreflight = {
				protocol: rendererFixture.protocol,
				control: {
					inputSha256: rendererFixture.controlJsonValueSha256,
					cellSha256: controlRendered.cellSha256,
					renderedTextSha256: controlRendered.renderedTextSha256,
					agentFacingBytes: controlRendered.agentFacingBytes,
				},
				treatment: {
					inputSha256: rendererFixture.treatmentJsonValueSha256,
					cellSha256: treatmentRendered.cellSha256,
					renderedTextSha256: treatmentRendered.renderedTextSha256,
					agentFacingBytes: treatmentRendered.agentFacingBytes,
				},
				incrementalBytes,
			};
			await ledger.append("run_manifest", {
				type: "ir_delta_renderer_preflight",
				protocol: RUNNER_PROTOCOL,
				rendererPreflight,
			});

			const lockRoot =
				this.config.dispatchLockRoot ??
				resolve(this.config.repoRoot, ".autoresearch/ir-delta-qualification-dispatch-attempts");
			await mkdir(lockRoot, { recursive: true, mode: 0o700 });
			const lockPath = join(lockRoot, `${COMPILER_GYM_IR_DELTA_QUALIFICATION_ID}.json`);
			const dispatchBody = {
				protocol: "compiler-gym-ir-delta-qualification-dispatch-attempt-v1",
				qualificationId: COMPILER_GYM_IR_DELTA_QUALIFICATION_ID,
				preregistrationSha256,
				attemptOrdinal: 1,
				allocationRetries: 0,
				replacementAllocations: 0,
				attemptedAt: this.clock.now().toISOString(),
				outputDir: resolve(this.config.outputDir),
				lockPath,
			};
			const dispatchAttempt = { ...dispatchBody, recordSha256: sha256Json(dispatchBody) };
			await writeExclusiveJson(lockPath, dispatchAttempt);
			await ledger.append("run_manifest", { type: "ir_delta_qualification_dispatch_attempt", ...dispatchAttempt });
			const dispatchNonce = sha256Json(dispatchAttempt).slice(0, 16);

			await ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree(remoteFileSystem, sourceDirectory, signal);
			for (const [remotePath, source, digest] of [
				[canonicalRemotePath, canonicalSource, preregistration.sources.canonicalSha256],
				[treatmentRemotePath, treatmentSource, preregistration.sources.treatmentSha256],
				[probeRemotePath, probeSource, preregistration.sources.environmentProbeSha256],
			] as const) {
				await remoteFileSystem.installImmutableFile(remotePath, source, digest, 0o600, true, signal);
			}

			const probeOuterArgv = compilerGymWarmSshArgv(
				preregistration.environment.host,
				environmentProbeArgv(preregistration.environment, probeRemotePath),
			);
			const preflightCommandSequence = recorder.nextSequence();
			const preflight = await recorder.run({
				argv: probeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			parseEnvironmentProbe(preflight, preregistration);
			await ledger.append("run_manifest", {
				type: "ir_delta_environment_probe",
				phase: "preflight",
				protocol: RUNNER_PROTOCOL,
				commandSequence: preflightCommandSequence,
				stdoutSha256: sha256Text(preflight.stdout),
			});

			for (const spec of preregistration.executionPlan) {
				const candidate = candidateFor(preregistration, spec.candidateId);
				const request = `${canonicalJson(toJsonValue({ benchmark: spec.benchmarkId, actions: candidate.actions }))}\n`;
				const evaluatorPath = spec.arm === "canonical" ? canonicalRemotePath : treatmentRemotePath;
				const built = compilerGymIrDeltaQualificationSrunArgv({
					spec,
					remoteEvaluatorPath: evaluatorPath,
					environment: preregistration.environment,
					dispatchNonce,
				});
				if (transientCaches.has(built.transientCache)) throw new Error("Transient cache was reused");
				transientCaches.add(built.transientCache);
				const outerArgv = compilerGymWarmSshArgv(preregistration.environment.host, built.argv);
				const commandSequence = recorder.nextSequence();
				const commandResult = await recorder.run({
					argv: outerArgv,
					input: request,
					signal,
					timeoutMs: this.config.commandTimeoutMs,
					maxOutputBytes: MAX_OUTPUT_BYTES,
				});
				if (commandResult.exitCode === null) throw new Error(`${spec.caseId} evaluator has no process exit code`);
				const parsed = parseCompilerGymIrDeltaQualificationEvaluatorResult({
					stdout: commandResult.stdout,
					exitCode: commandResult.exitCode,
					arm: spec.arm,
					benchmarkId: spec.benchmarkId,
					actions: candidate.actions,
				});
				if (spec.arm === "canonical") {
					const expected = candidate.expectedMetrics[spec.benchmarkId];
					if (
						!expected ||
						parsed.final.irInstructionCount !== expected.irInstructionCount ||
						parsed.final.objectTextSizeBytes !== expected.objectTextSizeBytes
					) {
						throw new Error(`${spec.caseId} canonical terminal metrics differ from the accepted anchor`);
					}
				}
				if (slurmIds.has(parsed.slurmId)) throw new Error(`Slurm allocation ${parsed.slurmId} was reused`);
				slurmIds.add(parsed.slurmId);
				const accountingResult = await waitForAccounting({
					slurmId: parsed.slurmId,
					expectedJobName: built.jobName,
					expectedOutcome: parsed.outcome,
					recorder,
					preregistration,
					config: this.config,
					clock: this.clock,
					signal,
				});
				const stdoutArtifact = await recorder.store(commandResult.stdout, "application/json");
				const stderrArtifact = await recorder.store(commandResult.stderr, "text/plain");
				const controlStdoutArtifact = await recorder.store(parsed.controlStdout, "application/json");
				const allocation: CompilerGymIrDeltaQualificationAllocationEvidence = {
					spec: { ...spec },
					requestSha256: sha256Text(request),
					evaluatorSha256:
						spec.arm === "canonical"
							? preregistration.sources.canonicalSha256
							: preregistration.sources.treatmentSha256,
					remoteArgv: [...built.argv],
					outerArgv: [...outerArgv],
					transientCache: built.transientCache,
					commandSequence,
					slurmId: parsed.slurmId,
					accountingCommandSequences: accountingResult.sequences,
					accounting: accountingResult.accounting,
					parsed,
					stdoutArtifact,
					stderrArtifact,
					controlStdoutArtifact,
				};
				allocations.push(allocation);
				await ledger.append("measurement", {
					type: "ir_delta_qualification_allocation",
					protocol: RUNNER_PROTOCOL,
					...allocation,
				});
			}

			if (allocations.length !== 8 || slurmIds.size !== 8 || transientCaches.size !== 8) {
				throw new Error("Qualification did not produce eight independent allocations and caches");
			}
			const postflightCommandSequence = recorder.nextSequence();
			const postflight = await recorder.run({
				argv: probeOuterArgv,
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			parseEnvironmentProbe(postflight, preregistration);
			if (postflight.stdout !== preflight.stdout) throw new Error("Postflight probe differs from preflight");
			await ledger.append("run_manifest", {
				type: "ir_delta_environment_probe",
				phase: "postflight",
				protocol: RUNNER_PROTOCOL,
				commandSequence: postflightCommandSequence,
				stdoutSha256: sha256Text(postflight.stdout),
			});

			const squeueAbsenceCommandSequence = recorder.nextSequence();
			const squeue = await recorder.run({
				argv: compilerGymWarmSshArgv(preregistration.environment.host, [
					"/usr/bin/squeue",
					"--noheader",
					"--jobs",
					[...slurmIds].join(","),
					"--format=%A",
				]),
				signal,
				timeoutMs: this.config.commandTimeoutMs,
				maxOutputBytes: 1024 * 1024,
			});
			if (squeue.exitCode !== 0 || squeue.stdout.trim() !== "") {
				throw new Error("One or more measured Slurm IDs remain in squeue");
			}
			await ledger.append("run_manifest", {
				type: "ir_delta_squeue_absence",
				protocol: RUNNER_PROTOCOL,
				commandSequence: squeueAbsenceCommandSequence,
				slurmIds: [...slurmIds],
				schedulerAbsent: true,
			});

			const cases = casesFromAllocations(preregistration, allocations);
			const tracesValid = cases.every((item) => item.treatment.traceIntegrity.passed);
			const visibilityEvidence = tracesValid
				? await buildVisibilityEvidence({
						preregistration,
						cases,
						allocations,
						artifacts: artifactStore,
						renderer: this.renderer,
						signal,
					})
				: { visibility: null, artifacts: [], allArtifacts: [] };
			await this.renderer.close();
			rendererClosed = true;
			for (const artifact of [...recorder.artifacts, ...visibilityEvidence.allArtifacts]) {
				await artifactStore.readString(artifact);
			}
			await verifySources(preregistration, this.config.repoRoot);
			await this.evidenceVerifier.verify(preregistration, resolve(this.config.repoRoot));
			const assessment = assessCompilerGymIrDeltaQualification({
				protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
				cases,
				visibility: visibilityEvidence.visibility,
			});
			const terminalDisposition =
				assessment.decision === "qualify-agent-facing-ir-delta-screen"
					? "terminal-complete-scientific-pass"
					: "terminal-complete-scientific-kill";
			await ledger.append("claim", {
				type: "ir_delta_qualification_assessment",
				protocol: RUNNER_PROTOCOL,
				admission: "requires-terminal-complete-ledger-event",
				modelCalls: 0,
				lunaAuthorized: false,
				measurementReuse: false,
				measurementReuseAllowed: false,
				formalMeasurementsReused: false,
				smokeMeasurementsUsed: false,
				causalTreatmentClaimAllowed: false,
				terminalDisposition,
				assessment,
			});
			const finishedAt = this.clock.now().toISOString();
			ledger.verify();
			const result: CompilerGymIrDeltaQualificationResult = {
				protocol: RUNNER_PROTOCOL,
				admission: "requires-terminal-complete-ledger-event",
				qualificationId: COMPILER_GYM_IR_DELTA_QUALIFICATION_ID,
				preregistrationSha256,
				modelCalls: 0,
				measurementReuse: false,
				formalMeasurementsReused: false,
				smokeMeasurementsUsed: false,
				causalTreatmentClaimAllowed: false,
				lunaAuthorized: false,
				sourceDirectory,
				dispatchAttempt,
				rendererPreflight,
				environmentProbe: {
					preflightCommandSequence,
					postflightCommandSequence,
					stdoutSha256: sha256Text(preflight.stdout),
				},
				allocations,
				cases,
				visibility: visibilityEvidence.visibility,
				visibilityArtifacts: visibilityEvidence.artifacts,
				assessment,
				terminalDisposition,
				squeueAbsenceCommandSequence,
				ledgerPath,
				ledgerEventCount: ledger.getEvents().length + 1,
				startedAt,
				finishedAt,
			};
			await writeExclusiveJson(resultPath, result);
			resultWritten = true;
			await ledger.append("run_manifest", {
				type: "ir_delta_qualification",
				phase: "complete",
				protocol: RUNNER_PROTOCOL,
				decision: assessment.decision,
				nextGate: assessment.nextGate,
				paidScreenEligible: assessment.paidScreenEligible,
				terminalDisposition,
				lunaAuthorized: false,
				resultSha256: sha256Text(`${canonicalJson(toJsonValue(result))}\n`),
				allocationCount: 8,
				uniqueSlurmIds: 8,
				uniqueTransientCaches: 8,
				modelCalls: 0,
				measurementReuse: false,
				formalMeasurementsReused: false,
				smokeMeasurementsUsed: false,
				causalTreatmentClaimAllowed: false,
				finishedAt,
			});
			return result;
		} catch (error) {
			let failure: unknown = error;
			if (!rendererClosed) {
				try {
					await this.renderer.close();
					rendererClosed = true;
				} catch (rendererError) {
					failure = new AggregateError([failure, rendererError], "Qualification and renderer cleanup both failed");
				}
			}
			try {
				await verifySources(preregistration, this.config.repoRoot);
			} catch (integrityError) {
				failure = new AggregateError(
					[failure, integrityError],
					"Qualification and source verification both failed",
				);
			}
			try {
				await this.evidenceVerifier.verify(preregistration, resolve(this.config.repoRoot));
			} catch (evidenceError) {
				failure = new AggregateError(
					[failure, evidenceError],
					"Qualification and prerequisite evidence verification both failed",
				);
			}
			if (resultWritten) {
				try {
					await unlink(resultPath);
				} catch (unlinkError) {
					failure = new AggregateError([failure, unlinkError], "Qualification and result cleanup both failed");
				}
			}
			try {
				await ledger.append("run_manifest", {
					type: "ir_delta_qualification",
					phase: "failed",
					protocol: RUNNER_PROTOCOL,
					failureDisposition: "terminal-apparatus-invalid-not-treatment-result",
					allocationCount: allocations.length,
					modelCalls: 0,
					measurementReuse: false,
					formalMeasurementsReused: false,
					smokeMeasurementsUsed: false,
					causalTreatmentClaimAllowed: false,
					lunaAuthorized: false,
					error: failure instanceof Error ? (failure.stack ?? failure.message) : String(failure),
					failedAt: this.clock.now().toISOString(),
				});
			} catch (ledgerError) {
				failure = new AggregateError([failure, ledgerError], "Qualification and failure recording both failed");
			}
			throw failure;
		}
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 5 || args[0] !== "--dispatch" || args[1] !== "--preregistration" || args[3] !== "--output-dir") {
		throw new Error(
			"Usage: compiler-gym-ir-delta-qualification-runner --dispatch --preregistration <path> --output-dir <path>",
		);
	}
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const runner = new CompilerGymIrDeltaQualificationRunner({
		repoRoot,
		preregistrationPath: resolve(args[2]),
		outputDir: resolve(args[4]),
		...DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_RUNNER_LIMITS,
	});
	console.log(canonicalJson(toJsonValue(await runner.run())));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

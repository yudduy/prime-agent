import assert from "node:assert/strict";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	assertNoForbiddenIrDeltaProjectionMetadata,
	COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL,
	type CompilerGymIrDeltaTreatmentEnvelope,
} from "./compiler-gym-ir-delta-qualification-protocol.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "./compiler-gym-ir-delta-smoke-protocol.js";
import { STOCK_CPU_TASKS, type StockCpuEvaluationRequest } from "./stock-cpu-protocol.js";
import {
	createStockInterfaceParityEvaluationSchema,
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_ACTION_GUIDE,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	type StockInterfaceParityEvaluationEnvelope,
} from "./stock-interface-parity-protocol.js";
import type { ArtifactRef } from "./types.js";

export const COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL = "compiler-gym-ir-delta-paid-screen-v1" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID = "compiler-gym-ir-delta-paid-screen-pair-v2" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE =
	"/prime-agent-autoresearch/isolated-workspace" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG =
	"/prime-agent-autoresearch/session.jsonl" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL =
	"compiler-gym-ir-delta-screen-adapter-output-v1" as const;
export const COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT = "compiler-gym-v0.2.5-single-environment-ir-delta-v1" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256 =
	"8faef0a05667ad84e0695fb91e782659217bcc9703153b9eec546c2617903a97" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256 =
	"1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256 = sha256Json({
	canonicalEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
	irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
});
export const COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH =
	"compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2" as const;

export const COMPILER_GYM_IR_DELTA_SCREEN_ARMS = ["hidden-control", "visible-ir-delta-treatment"] as const;
export type CompilerGymIrDeltaScreenArm = (typeof COMPILER_GYM_IR_DELTA_SCREEN_ARMS)[number];

export const CompilerGymIrDeltaScreenEvaluationSchema = createStockInterfaceParityEvaluationSchema({
	minItems: 1,
	maxItems: 46,
});

export const COMPILER_GYM_IR_DELTA_SCREEN_S12_ACTIONS = [
	"-globalopt",
	"-globaldce",
	"-deadargelim",
	"-mem2reg",
	"-sroa",
	"-instcombine",
	"-simplifycfg",
	"-gvn",
	"-sccp",
	"-instcombine",
	"-simplifycfg",
	"-adce",
] as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256 =
	"60df17de77999363e6547b8447140c70e253859ec0eb42caa6e60ab41f62e042" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST: StockCpuEvaluationRequest = {
	actions: [...COMPILER_GYM_IR_DELTA_SCREEN_S12_ACTIONS],
	hypothesis:
		"The formally qualified S12 anchor should reproduce its exact two-task terminal metrics before either arm receives adaptive search freedom.",
	mechanism:
		"Global and dead-argument cleanup expose scalar simplifications, then value numbering, sparse propagation, and dead-code elimination remove the resulting redundant IR.",
	predictedOutcome:
		"Both fixed tasks pass all twenty semantic callbacks and exactly reproduce the preregistered S12 instruction-count and object-size anchors.",
	boundaryConditions: [
		"This identical first request is an apparatus control shared by both arms.",
		"Any S12 metric or verifier drift invalidates the apparatus rather than counting as a treatment outcome.",
	],
};
export const COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS = {
	"benchmark://cbench-v1/blowfish": { irInstructionCount: 1970, objectTextSizeBytes: 21_501 },
	"benchmark://cbench-v1/bzip2": { irInstructionCount: 13_838, objectTextSizeBytes: 166_545 },
} as const;

export function buildCompilerGymIrDeltaScreenPrompt(): string {
	return [
		"Optimize two fixed CompilerGym/cBench programs by reducing raw LLVM IR instruction count while preserving all twenty semantic callbacks.",
		"This is one bounded directional screen arm. Make exactly four sequential tool calls and wait for each complete terminal measurement before proposing the next candidate.",
		`Call ${STOCK_INTERFACE_PARITY_TOOL_NAME} with exactly: {"actions": string[], "hypothesis": string, "mechanism": string, "predictedOutcome": string, "boundaryConditions": string[]}.`,
		`Your first tool call must be byte-for-byte equivalent to this fixed request: ${JSON.stringify(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST)}.`,
		"The first S12 result is a shared apparatus anchor. After it, choose calls two through four adaptively from measured evidence; each action sequence may contain at most 46 LLVM passes.",
		`Tasks: ${JSON.stringify(STOCK_CPU_TASKS)}. Empty-pass calibration: ${JSON.stringify([
			{ benchmarkId: STOCK_CPU_TASKS[0], irInstructionCount: 3898, objectTextSizeBytes: 16_573 },
			{ benchmarkId: STOCK_CPU_TASKS[1], irInstructionCount: 28_748, objectTextSizeBytes: 122_613 },
		])}.`,
		`Useful LLVM 10 flags include: ${STOCK_INTERFACE_PARITY_ACTION_GUIDE.join(", ")}. Repetition and order are allowed.`,
		"A complete semantic rejection is durable negative evidence and is excluded from the frontier; it still consumes one call and the arm continues within the four-call limit.",
		"Do not use web access, public winning traces, RLM children, compaction, retries, measurement reuse, credentials, or files outside the empty workspace.",
		"The host fixes tasks, verifier, evaluator, fresh-measurement policy, lineage, budgets, and terminalization. A queued, predicted, or intermediate result is never verified evidence.",
		"The host closes the branch after the fourth terminal result. Do not attempt a fifth evaluation and do not emit a final champion report.",
	].join("\n");
}

export interface CompilerGymIrDeltaScreenTraceTask {
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	outcome: "verified" | "complete-semantic-rejection";
	initialIrInstructionCount: number;
	irDeltas: number[] | null;
	finalIrInstructionCount: number;
	objectTextSizeBytes: number;
	verifierInputsCompleted: 20;
}

export interface CompilerGymIrDeltaScreenParsedAggregate {
	contract: typeof COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL;
	jobId: string;
	manifestDigest: string;
	candidateSha256: string;
	actionsSha256: string;
	verifierEpoch: typeof COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH;
	evaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256;
	measurementReuse: false;
	tasks: CompilerGymIrDeltaScreenTraceTask[];
}

export type CompilerGymIrDeltaScreenControlFeedback = StockInterfaceParityEvaluationEnvelope;
export type CompilerGymIrDeltaScreenTreatmentFeedback = StockInterfaceParityEvaluationEnvelope & {
	irDeltaTrace: CompilerGymIrDeltaTreatmentEnvelope | null;
};
export type CompilerGymIrDeltaScreenFeedback =
	| CompilerGymIrDeltaScreenControlFeedback
	| CompilerGymIrDeltaScreenTreatmentFeedback;

export type CompilerGymIrDeltaScreenArtifactReader = (reference: ArtifactRef) => Promise<string>;

export interface CompilerGymIrDeltaScreenProjectionInput {
	details: StockInterfaceParityEvaluationEnvelope;
	arm: CompilerGymIrDeltaScreenArm;
	callIndex: number;
	readArtifact: CompilerGymIrDeltaScreenArtifactReader;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${path} keys mismatch: expected ${wanted.join(",")}, received ${actual.join(",")}`);
	}
}

function nonemptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a nonempty string`);
	return value;
}

function digest(value: unknown, path: string): string {
	const parsed = nonemptyString(value, path);
	if (!/^[0-9a-f]{64}$/.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return parsed;
}

function safeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
	return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
	const parsed = safeInteger(value, path);
	if (parsed < 0) throw new Error(`${path} must be nonnegative`);
	return parsed;
}

function finiteNonnegative(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${path} must be finite and nonnegative`);
	}
	return value;
}

function integers(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value.map((item, index) => nonnegativeInteger(item, `${path}[${index}]`));
}

const JSON_NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_NUMBER_PARTS = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const MAX_NORMALIZED_JSON_NUMBER_LENGTH = 128;

interface ExactDecimalLexeme {
	negative: boolean;
	coefficient: string;
	exponent: bigint;
}

function exactDecimalLexeme(value: string, path: string): ExactDecimalLexeme {
	if (value.length > MAX_NORMALIZED_JSON_NUMBER_LENGTH) {
		throw new Error(`${path} JSON number lexeme is too long to normalize safely`);
	}
	const match = JSON_NUMBER_PARTS.exec(value);
	if (!match) throw new Error(`${path} contains a malformed JSON number lexeme`);
	const fraction = match[3] ?? "";
	let coefficient = `${match[2]}${fraction}`.replace(/^0+/, "");
	if (coefficient.length === 0) {
		return { negative: match[1] === "-", coefficient: "0", exponent: 0n };
	}
	let exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length);
	while (coefficient.endsWith("0")) {
		coefficient = coefficient.slice(0, -1);
		exponent += 1n;
	}
	return { negative: match[1] === "-", coefficient, exponent };
}

function exactDecimalLexemesEqual(left: string, right: string, path: string): boolean {
	const normalizedLeft = exactDecimalLexeme(left, path);
	const normalizedRight = exactDecimalLexeme(right, path);
	return (
		normalizedLeft.negative === normalizedRight.negative &&
		normalizedLeft.coefficient === normalizedRight.coefficient &&
		normalizedLeft.exponent === normalizedRight.exponent
	);
}

function normalizeJsonNumberLexemes(value: string, path: string): string {
	let normalized = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < value.length; ) {
		const character = value[index];
		if (character === undefined) throw new Error(`${path} ended unexpectedly`);
		if (inString) {
			normalized += character;
			index++;
			if (escaped) {
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}
		if (character === '"') {
			inString = true;
			normalized += character;
			index++;
			continue;
		}
		if (character === "-" || (character >= "0" && character <= "9")) {
			JSON_NUMBER_TOKEN.lastIndex = index;
			const match = JSON_NUMBER_TOKEN.exec(value);
			if (!match) throw new Error(`${path} contains a malformed JSON number lexeme`);
			const sourceLexeme = match[0];
			const number = Number(sourceLexeme);
			const canonicalLexeme = JSON.stringify(number);
			if (canonicalLexeme === undefined || !Number.isFinite(number)) {
				throw new Error(`${path} contains a non-finite JSON number`);
			}
			if (sourceLexeme !== canonicalLexeme) {
				if (Number.isInteger(number) && !Number.isSafeInteger(number)) {
					throw new Error(`${path} contains an unsafe rewritten JSON integer`);
				}
				if (!exactDecimalLexemesEqual(sourceLexeme, canonicalLexeme, path)) {
					throw new Error(`${path} contains a lossy JSON number rewrite`);
				}
			}
			normalized += canonicalLexeme;
			index += sourceLexeme.length;
			continue;
		}
		normalized += character;
		index++;
	}
	if (inString || escaped) throw new Error(`${path} contains an unterminated JSON string`);
	return normalized;
}

function parseCanonicalLine(value: string, path: string): Record<string, unknown> {
	if (!value.endsWith("\n") || value.slice(0, -1).includes("\n")) {
		throw new Error(`${path} must be exactly one newline-terminated JSON line`);
	}
	const body = value.slice(0, -1);
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	const parsedRecord = record(parsed, path);
	const canonical = canonicalJson(toJsonValue(parsedRecord));
	if (normalizeJsonNumberLexemes(body, path) !== canonical) {
		throw new Error(`${path} is not canonical JSON`);
	}
	return parsedRecord;
}

function assertEqual(actual: unknown, expected: unknown, path: string): void {
	if (actual !== expected)
		throw new Error(`${path} mismatch: expected ${String(expected)}, received ${String(actual)}`);
}

function assertExactArray(actual: unknown, expected: readonly unknown[], path: string): void {
	if (!Array.isArray(actual) || canonicalJson(toJsonValue(actual)) !== canonicalJson(toJsonValue(expected))) {
		throw new Error(`${path} does not match the bound value`);
	}
}

export function assertCompilerGymIrDeltaScreenRequestPolicy(
	callIndex: number,
	request: StockCpuEvaluationRequest,
): void {
	if (!Number.isSafeInteger(callIndex) || callIndex < 1 || callIndex > 4) {
		throw new Error("scientific-policy-nonconformance: callIndex must be an integer from 1 through 4");
	}
	if (!Array.isArray(request.actions) || request.actions.length < 1 || request.actions.length > 46) {
		throw new Error("scientific-policy-nonconformance: actions must contain from 1 through 46 flags");
	}
	if (request.actions.some((action) => typeof action !== "string" || action.length === 0)) {
		throw new Error("scientific-policy-nonconformance: actions must be nonempty strings");
	}
	if (callIndex === 1) {
		if (
			canonicalJson(toJsonValue(request)) !== canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST)) ||
			sha256Json(request.actions) !== COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256
		) {
			throw new Error("scientific-policy-nonconformance: first tool call must equal the frozen S12 request");
		}
	}
}

export function assertCompilerGymIrDeltaScreenRequestSequence(requests: readonly StockCpuEvaluationRequest[]): void {
	if (requests.length !== 4) {
		throw new Error("scientific-policy-nonconformance: each arm requires exactly four tool requests");
	}
	const actionDigests = new Set<string>();
	for (const [index, request] of requests.entries()) {
		assertCompilerGymIrDeltaScreenRequestPolicy(index + 1, request);
		const actionsSha256 = sha256Json(request.actions);
		if (actionDigests.has(actionsSha256)) {
			throw new Error(
				"scientific-policy-nonconformance: an arm repeated a candidate action vector despite changed proposal prose",
			);
		}
		actionDigests.add(actionsSha256);
	}
}

function parseValidation(
	value: unknown,
	status: "passed" | "semantic_validation_failed",
	path: string,
): "verified" | "complete-semantic-rejection" {
	const validation = record(value, path);
	exactKeys(
		validation,
		[
			"base_callbacks_selected",
			"inputs",
			"inputs_completed",
			"inputs_expected",
			"passed",
			"registered_callback_group_size",
			"sanitizer_callbacks_excluded",
			"sanitizer_callbacks_selected",
			"semantic_errors",
			"worker_count_source",
			"workers",
		],
		path,
	);
	assertEqual(validation.inputs_expected, 20, `${path}.inputs_expected`);
	assertEqual(validation.inputs_completed, 20, `${path}.inputs_completed`);
	assertEqual(validation.base_callbacks_selected, 20, `${path}.base_callbacks_selected`);
	assertEqual(validation.sanitizer_callbacks_selected, 0, `${path}.sanitizer_callbacks_selected`);
	if (!Array.isArray(validation.semantic_errors)) {
		throw new Error(`${path}.semantic_errors must be an array`);
	}
	if (!Array.isArray(validation.inputs) || validation.inputs.length !== 20) {
		throw new Error(`${path}.inputs must contain exactly 20 outcomes`);
	}
	let rejectedInputs = 0;
	const flattenedSemanticErrors: unknown[] = [];
	for (const [index, rawInput] of validation.inputs.entries()) {
		const inputPath = `${path}.inputs[${index}]`;
		const item = record(rawInput, inputPath);
		exactKeys(item, ["completed", "errors", "input_index", "passed", "walltime_seconds"], inputPath);
		assertEqual(item.input_index, index + 1, `${inputPath}.input_index`);
		assertEqual(item.completed, true, `${inputPath}.completed`);
		if (typeof item.passed !== "boolean") throw new Error(`${inputPath}.passed must be boolean`);
		if (!Array.isArray(item.errors)) throw new Error(`${inputPath}.errors must be an array`);
		assertEqual(item.passed, item.errors.length === 0, `${inputPath}.passed/errors consistency`);
		flattenedSemanticErrors.push(...item.errors);
		if (!item.passed) rejectedInputs++;
		finiteNonnegative(item.walltime_seconds, `${inputPath}.walltime_seconds`);
	}
	if (status === "passed") {
		assertEqual(validation.passed, true, `${path}.passed`);
		if (validation.semantic_errors.length !== 0 || rejectedInputs !== 0) {
			throw new Error(`${path} passed result contains semantic errors`);
		}
		return "verified";
	}
	assertEqual(validation.passed, false, `${path}.passed`);
	if (canonicalJson(toJsonValue(validation.semantic_errors)) !== canonicalJson(toJsonValue(flattenedSemanticErrors))) {
		throw new Error(`${path}.semantic_errors does not bind the ordered input outcomes`);
	}
	if (validation.semantic_errors.length === 0 || rejectedInputs === 0) {
		throw new Error(`${path} semantic rejection must preserve at least one explicit error`);
	}
	return "complete-semantic-rejection";
}

function parseMetrics(
	value: unknown,
	path: string,
): { initialIr: number; finalIr: number; objectTextSizeBytes: number } {
	const metrics = record(value, path);
	exactKeys(metrics, ["delta_final_minus_initial", "final", "improvement_fraction", "initial"], path);
	const initial = record(metrics.initial, `${path}.initial`);
	const final = record(metrics.final, `${path}.final`);
	const delta = record(metrics.delta_final_minus_initial, `${path}.delta_final_minus_initial`);
	const improvement = record(metrics.improvement_fraction, `${path}.improvement_fraction`);
	for (const [name, item, itemPath] of [
		["initial", initial, `${path}.initial`],
		["final", final, `${path}.final`],
		["delta", delta, `${path}.delta_final_minus_initial`],
		["improvement", improvement, `${path}.improvement_fraction`],
	] as const) {
		void name;
		exactKeys(item, ["IrInstructionCount", "ObjectTextSizeBytes"], itemPath);
	}
	const initialIr = nonnegativeInteger(initial.IrInstructionCount, `${path}.initial.IrInstructionCount`);
	const finalIr = nonnegativeInteger(final.IrInstructionCount, `${path}.final.IrInstructionCount`);
	const initialObject = nonnegativeInteger(initial.ObjectTextSizeBytes, `${path}.initial.ObjectTextSizeBytes`);
	const finalObject = nonnegativeInteger(final.ObjectTextSizeBytes, `${path}.final.ObjectTextSizeBytes`);
	assertEqual(delta.IrInstructionCount, finalIr - initialIr, `${path}.delta_final_minus_initial.IrInstructionCount`);
	assertEqual(
		delta.ObjectTextSizeBytes,
		finalObject - initialObject,
		`${path}.delta_final_minus_initial.ObjectTextSizeBytes`,
	);
	finiteNonnegative(
		Math.abs(Number(improvement.IrInstructionCount)),
		`${path}.improvement_fraction.IrInstructionCount`,
	);
	finiteNonnegative(
		Math.abs(Number(improvement.ObjectTextSizeBytes)),
		`${path}.improvement_fraction.ObjectTextSizeBytes`,
	);
	return { initialIr, finalIr, objectTextSizeBytes: finalObject };
}

function parseTrace(input: {
	value: unknown;
	benchmarkId: string;
	actions: readonly string[];
	actionIndices: readonly number[];
	initialIr: number;
	finalIr: number;
	path: string;
}): number[] {
	const trace = record(input.value, input.path);
	exactKeys(
		trace,
		[
			"action_indices",
			"actions",
			"benchmark",
			"contract",
			"initial_ir_instruction_count",
			"intermediate_semantic_status",
			"prefix_conditional",
			"records",
			"terminal_semantic_status",
			"zero_delta_semantics",
		],
		input.path,
	);
	assertEqual(trace.contract, COMPILER_GYM_IR_DELTA_TRACE_CONTRACT, `${input.path}.contract`);
	assertEqual(trace.prefix_conditional, true, `${input.path}.prefix_conditional`);
	assertEqual(trace.intermediate_semantic_status, "unverified", `${input.path}.intermediate_semantic_status`);
	assertEqual(trace.terminal_semantic_status, "canonical-20-input-verifier", `${input.path}.terminal_semantic_status`);
	assertEqual(trace.zero_delta_semantics, COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS, `${input.path}.zero_delta_semantics`);
	assertEqual(trace.benchmark, input.benchmarkId, `${input.path}.benchmark`);
	assertExactArray(trace.actions, input.actions, `${input.path}.actions`);
	assertExactArray(trace.action_indices, input.actionIndices, `${input.path}.action_indices`);
	assertEqual(trace.initial_ir_instruction_count, input.initialIr, `${input.path}.initial_ir_instruction_count`);
	const records = trace.records;
	if (!Array.isArray(records) || records.length !== input.actions.length) {
		throw new Error(`${input.path}.records length must equal the action count`);
	}
	let observedIr = input.initialIr;
	return records.map((rawRecord, index) => {
		const recordPath = `${input.path}.records[${index}]`;
		const item = record(rawRecord, recordPath);
		exactKeys(item, ["action", "action_index", "delta_from_previous", "index"], recordPath);
		assertEqual(item.index, index, `${recordPath}.index`);
		assertEqual(item.action, input.actions[index], `${recordPath}.action`);
		assertEqual(item.action_index, input.actionIndices[index], `${recordPath}.action_index`);
		const delta = safeInteger(item.delta_from_previous, `${recordPath}.delta_from_previous`);
		observedIr += delta;
		if (!Number.isSafeInteger(observedIr) || observedIr < 0)
			throw new Error(`${recordPath} produces an invalid IR count`);
		if (index === records.length - 1) assertEqual(observedIr, input.finalIr, `${input.path} telescoped final IR`);
		return delta;
	});
}

function parseRawEvaluatorStdout(input: {
	stdout: string;
	exitCode: number;
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	actions: readonly string[];
	measurementTask: NonNullable<StockInterfaceParityEvaluationEnvelope["job"]["measurement"]>["tasks"][number];
	path: string;
}): CompilerGymIrDeltaScreenTraceTask {
	const parsed = parseCanonicalLine(input.stdout, input.path);
	assertNoForbiddenIrDeltaProjectionMetadata(parsed, input.path);
	const status = parsed.status;
	if (status !== "passed" && status !== "semantic_validation_failed") {
		throw new Error(`${input.path}.status is neither passed nor a complete semantic rejection`);
	}
	const expectedTopLevelKeys = [
		"action_indices",
		...(status === "passed" ? ["action_trace"] : []),
		"benchmark",
		"commandline",
		"contract",
		"environment",
		"metrics",
		"ok",
		"provenance",
		"request",
		"schema_version",
		"status",
		"step_info",
		"terminal_verifier_contract",
		"timings_seconds",
		"validation",
	];
	exactKeys(parsed, expectedTopLevelKeys, input.path);
	assertEqual(parsed.schema_version, 2, `${input.path}.schema_version`);
	assertEqual(parsed.contract, COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT, `${input.path}.contract`);
	assertEqual(
		parsed.terminal_verifier_contract,
		COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
		`${input.path}.terminal_verifier_contract`,
	);
	assertEqual(parsed.ok, status === "passed", `${input.path}.ok`);
	assertEqual(input.exitCode, status === "passed" ? 0 : 5, `${input.path} evaluator exit code`);
	assertEqual(parsed.benchmark, input.benchmarkId, `${input.path}.benchmark`);
	nonemptyString(parsed.commandline, `${input.path}.commandline`);
	const request = record(parsed.request, `${input.path}.request`);
	exactKeys(request, ["actions", "benchmark"], `${input.path}.request`);
	assertEqual(request.benchmark, input.benchmarkId, `${input.path}.request.benchmark`);
	assertExactArray(request.actions, input.actions, `${input.path}.request.actions`);
	const actionIndices = integers(parsed.action_indices, `${input.path}.action_indices`);
	if (actionIndices.length !== input.actions.length) throw new Error(`${input.path}.action_indices length drifted`);
	const metrics = parseMetrics(parsed.metrics, `${input.path}.metrics`);
	const outcome = parseValidation(parsed.validation, status, `${input.path}.validation`);
	const stepInfo = record(parsed.step_info, `${input.path}.step_info`);
	exactKeys(stepInfo, ["reason", "retained"], `${input.path}.step_info`);
	assertEqual(stepInfo.retained, false, `${input.path}.step_info.retained`);
	nonemptyString(stepInfo.reason, `${input.path}.step_info.reason`);
	const irDeltas =
		outcome === "verified"
			? parseTrace({
					value: parsed.action_trace,
					benchmarkId: input.benchmarkId,
					actions: input.actions,
					actionIndices,
					initialIr: metrics.initialIr,
					finalIr: metrics.finalIr,
					path: `${input.path}.action_trace`,
				})
			: null;
	assertEqual(input.measurementTask.benchmarkId, input.benchmarkId, `${input.path} measurement benchmark`);
	assertEqual(
		input.measurementTask.status,
		outcome === "verified" ? "accepted" : "rejected",
		`${input.path} measurement status`,
	);
	assertEqual(input.measurementTask.verifier.passed, outcome === "verified", `${input.path} measurement verifier`);
	if (
		(outcome === "verified" && input.measurementTask.verifier.errors.length !== 0) ||
		(outcome === "complete-semantic-rejection" && input.measurementTask.verifier.errors.length === 0)
	) {
		throw new Error(`${input.path} measurement verifier errors contradict the evaluator outcome`);
	}
	assertEqual(
		input.measurementTask.metrics.IrInstructionCount,
		metrics.finalIr,
		`${input.path} measurement IrInstructionCount`,
	);
	assertEqual(
		input.measurementTask.metrics.ObjectTextSizeBytes,
		metrics.objectTextSizeBytes,
		`${input.path} measurement ObjectTextSizeBytes`,
	);
	return {
		benchmarkId: input.benchmarkId,
		outcome,
		initialIrInstructionCount: metrics.initialIr,
		irDeltas,
		finalIrInstructionCount: metrics.finalIr,
		objectTextSizeBytes: metrics.objectTextSizeBytes,
		verifierInputsCompleted: 20,
	};
}

export function parseCompilerGymIrDeltaAggregateStdout(
	stdout: string,
	details: StockInterfaceParityEvaluationEnvelope,
	callIndex: number,
): CompilerGymIrDeltaScreenParsedAggregate {
	assertCompilerGymIrDeltaScreenRequestPolicy(callIndex, details.request);
	const parsed = parseCanonicalLine(stdout, "aggregate stdout");
	assertNoForbiddenIrDeltaProjectionMetadata(parsed, "aggregate stdout");
	exactKeys(
		parsed,
		[
			"actionsSha256",
			"candidateSha256",
			"contract",
			"evaluatorSha256",
			"jobId",
			"manifestDigest",
			"measurementReuse",
			"remoteEvaluatorPath",
			"sourceBundleSha256",
			"sourceDirectory",
			"tasks",
			"verifierEpoch",
		],
		"aggregate stdout",
	);
	assertEqual(parsed.contract, COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL, "aggregate stdout.contract");
	assertEqual(parsed.jobId, details.job.jobId, "aggregate stdout.jobId");
	assertEqual(parsed.jobId, details.submitted.jobId, "aggregate stdout submitted jobId");
	assertEqual(parsed.manifestDigest, details.job.manifestDigest, "aggregate stdout.manifestDigest");
	assertEqual(parsed.manifestDigest, details.submitted.manifestDigest, "aggregate stdout submitted manifestDigest");
	const actionsSha256 = sha256Json(details.request.actions);
	assertEqual(parsed.actionsSha256, actionsSha256, "aggregate stdout.actionsSha256");
	assertEqual(parsed.candidateSha256, details.job.candidateDigest, "aggregate stdout.candidateSha256");
	assertEqual(details.job.candidateDigest, actionsSha256, "details candidate/actions binding");
	assertEqual(parsed.verifierEpoch, COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH, "aggregate stdout.verifierEpoch");
	assertEqual(
		parsed.evaluatorSha256,
		COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		"aggregate stdout.evaluatorSha256",
	);
	assertEqual(parsed.measurementReuse, false, "aggregate stdout.measurementReuse");
	assertEqual(
		parsed.sourceBundleSha256,
		COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
		"aggregate stdout.sourceBundleSha256",
	);
	const sourceDirectory = nonemptyString(parsed.sourceDirectory, "aggregate stdout.sourceDirectory");
	const remoteEvaluatorPath = nonemptyString(parsed.remoteEvaluatorPath, "aggregate stdout.remoteEvaluatorPath");
	if (
		!/^\/[A-Za-z0-9._/-]+$/.test(sourceDirectory) ||
		!/^\/[A-Za-z0-9._/-]+$/.test(remoteEvaluatorPath) ||
		sourceDirectory.includes("//") ||
		remoteEvaluatorPath.includes("//") ||
		sourceDirectory.split("/").some((component) => component === "." || component === "..") ||
		remoteEvaluatorPath.split("/").some((component) => component === "." || component === "..") ||
		!sourceDirectory.endsWith(`/${COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256}`) ||
		remoteEvaluatorPath !== `${sourceDirectory}/compiler_gym_ir_delta_eval.py`
	) {
		throw new Error("aggregate stdout source paths do not bind the installed IR-delta evaluator bundle");
	}
	const measurement = details.job.measurement;
	if (!measurement) throw new Error("IR-delta screen details are missing a terminal measurement");
	assertEqual(measurement.jobId, details.job.jobId, "measurement.jobId");
	assertEqual(measurement.manifestDigest, details.job.manifestDigest, "measurement.manifestDigest");
	assertEqual(measurement.verifierEpoch, COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH, "measurement.verifierEpoch");
	assertEqual(
		measurement.provenance.evaluatorSha256,
		COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		"measurement.provenance.evaluatorSha256",
	);
	if (measurement.reuse !== undefined) throw new Error("IR-delta paid screen forbids measurement reuse");
	if (!Array.isArray(parsed.tasks) || parsed.tasks.length !== STOCK_CPU_TASKS.length) {
		throw new Error("aggregate stdout.tasks must contain the exact two stock tasks");
	}
	if (measurement.tasks.length !== STOCK_CPU_TASKS.length) {
		throw new Error("measurement.tasks must contain the exact two stock tasks");
	}
	const rawTasks = parsed.tasks.map((task, index) => record(task, `aggregate stdout.tasks[${index}]`));
	for (const field of ["slurmId", "transientCache", "jobName"] as const) {
		if (new Set(rawTasks.map((task) => task[field])).size !== STOCK_CPU_TASKS.length) {
			throw new Error(`aggregate stdout tasks must use unique ${field} values`);
		}
	}
	const tasks = parsed.tasks.map((rawTask, index): CompilerGymIrDeltaScreenTraceTask => {
		const path = `aggregate stdout.tasks[${index}]`;
		const task = record(rawTask, path);
		exactKeys(
			task,
			[
				"accounting",
				"benchmarkId",
				"evaluatorSha256",
				"exitCode",
				"jobName",
				"requestSha256",
				"slurmId",
				"stderr",
				"stderrSha256",
				"stdout",
				"stdoutSha256",
				"transientCache",
				"wallMs",
			],
			path,
		);
		const benchmarkId = STOCK_CPU_TASKS[index];
		if (!benchmarkId) throw new Error(`${path} has no expected benchmark`);
		assertEqual(task.benchmarkId, benchmarkId, `${path}.benchmarkId`);
		assertEqual(task.evaluatorSha256, COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256, `${path}.evaluatorSha256`);
		if (task.exitCode !== 0 && task.exitCode !== 5) throw new Error(`${path}.exitCode must be 0 or 5`);
		finiteNonnegative(task.wallMs, `${path}.wallMs`);
		const rawStdout = nonemptyString(task.stdout, `${path}.stdout`);
		const rawStderr =
			typeof task.stderr === "string"
				? task.stderr
				: (() => {
						throw new Error(`${path}.stderr must be a string`);
					})();
		assertEqual(task.stdoutSha256, sha256Text(rawStdout), `${path}.stdoutSha256`);
		assertEqual(task.stderrSha256, sha256Text(rawStderr), `${path}.stderrSha256`);
		assertEqual(
			task.requestSha256,
			sha256Text(`${canonicalJson(toJsonValue({ benchmark: benchmarkId, actions: details.request.actions }))}\n`),
			`${path}.requestSha256`,
		);
		if (!/^\d+$/.test(nonemptyString(task.slurmId, `${path}.slurmId`))) throw new Error(`${path}.slurmId is invalid`);
		nonemptyString(task.transientCache, `${path}.transientCache`);
		nonemptyString(task.jobName, `${path}.jobName`);
		const accounting = record(task.accounting, `${path}.accounting`);
		exactKeys(
			accounting,
			[
				"allocCpus",
				"cpuTimeRawSeconds",
				"elapsedRawSeconds",
				"endAt",
				"exitCode",
				"jobIdRaw",
				"jobName",
				"nTasks",
				"nodeList",
				"startAt",
				"state",
			],
			`${path}.accounting`,
		);
		assertEqual(accounting.jobIdRaw, task.slurmId, `${path}.accounting.jobIdRaw`);
		assertEqual(accounting.jobName, task.jobName, `${path}.accounting.jobName`);
		assertEqual(accounting.state, task.exitCode === 0 ? "COMPLETED" : "FAILED", `${path}.accounting.state`);
		assertEqual(accounting.exitCode, task.exitCode === 0 ? "0:0" : "5:0", `${path}.accounting.exitCode`);
		const measurementTask = measurement.tasks[index];
		if (!measurementTask) throw new Error(`${path} has no matching measurement task`);
		const parsedTask = parseRawEvaluatorStdout({
			stdout: rawStdout,
			exitCode: task.exitCode,
			benchmarkId,
			actions: details.request.actions,
			measurementTask,
			path: `${path}.stdout`,
		});
		if (callIndex === 1) {
			if (parsedTask.outcome !== "verified") {
				throw new Error(`${path} frozen S12 anchor must pass the complete verifier`);
			}
			const expected = COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[benchmarkId];
			assertEqual(
				parsedTask.finalIrInstructionCount,
				expected.irInstructionCount,
				`${path} frozen S12 IrInstructionCount`,
			);
			assertEqual(
				parsedTask.objectTextSizeBytes,
				expected.objectTextSizeBytes,
				`${path} frozen S12 ObjectTextSizeBytes`,
			);
		}
		return parsedTask;
	});
	return {
		contract: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
		jobId: nonemptyString(parsed.jobId, "aggregate stdout.jobId"),
		manifestDigest: digest(parsed.manifestDigest, "aggregate stdout.manifestDigest"),
		candidateSha256: digest(parsed.candidateSha256, "aggregate stdout.candidateSha256"),
		actionsSha256: digest(parsed.actionsSha256, "aggregate stdout.actionsSha256"),
		verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
		evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		measurementReuse: false,
		tasks,
	};
}

export function buildCompilerGymIrDeltaScreenTraceEnvelope(
	parsed: CompilerGymIrDeltaScreenParsedAggregate,
): CompilerGymIrDeltaTreatmentEnvelope | null {
	if (parsed.tasks.some((task) => task.outcome === "complete-semantic-rejection")) return null;
	const envelope: CompilerGymIrDeltaTreatmentEnvelope = {
		type: "compiler_gym_ir_delta_feedback",
		protocol: COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL,
		candidateId: parsed.jobId,
		candidateSha256: parsed.candidateSha256,
		prefixConditional: true,
		intermediateSemanticStatus: "unverified",
		terminalSemanticStatus: "canonical-20-input-verifier",
		zeroDeltaSemantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
		tasks: parsed.tasks.map((task) => {
			if (task.irDeltas === null) throw new Error("Verified IR-delta task is missing its trace");
			return {
				benchmarkId: task.benchmarkId,
				trace: {
					initialIrInstructionCount: task.initialIrInstructionCount,
					irDeltas: [...task.irDeltas],
				},
			};
		}),
	};
	assertNoForbiddenIrDeltaProjectionMetadata(envelope, "irDeltaTrace");
	return envelope;
}

export function assertCompilerGymIrDeltaScreenProjectionPair(
	control: CompilerGymIrDeltaScreenControlFeedback,
	treatment: CompilerGymIrDeltaScreenTreatmentFeedback,
	expectedTrace?: CompilerGymIrDeltaTreatmentEnvelope | null,
): void {
	const treatmentRecord = record(structuredClone(treatment), "treatment feedback");
	const trace = treatmentRecord.irDeltaTrace;
	delete treatmentRecord.irDeltaTrace;
	assert.deepEqual(treatmentRecord, control, "IR-delta treatment differs from control outside irDeltaTrace");
	if (expectedTrace !== undefined) assert.deepEqual(trace, expectedTrace, "IR-delta trace projection drifted");
	assertNoForbiddenIrDeltaProjectionMetadata(trace, "treatment feedback.irDeltaTrace");
	const controlKeys = Object.keys(record(control, "control feedback")).sort();
	const treatmentKeys = Object.keys(record(treatment, "treatment feedback")).sort();
	assert.deepEqual(
		treatmentKeys,
		[...controlKeys, "irDeltaTrace"].sort(),
		"Treatment must add exactly one top-level irDeltaTrace field",
	);
}

export const COMPILER_GYM_IR_DELTA_SCREEN_TERMINAL_TAXONOMY = {
	apparatusInvalid: {
		disposition: "terminal-apparatus-invalid-not-treatment-result",
		conditions: [
			"source-calibration-formal-anchor-or-preregistration-drift",
			"provider-model-effort-tier-or-prompt-drift",
			"first-s12-request-metric-or-verifier-drift",
			"aggregate-artifact-schema-hash-or-trace-binding-failure",
			"incomplete-semantic-validation",
			"host-duplicate-delivery-replay-or-dispatch-order-failure",
			"host-retry-reuse-compaction-web-or-rlm-boundary-failure",
			"missing-terminal-accounting-or-fresh-task-evidence",
		],
		admittedToPairAssessment: false,
	},
	scientificPolicyNonconformance: {
		disposition: "terminal-scientific-policy-nonconformance",
		conditions: [
			"wrong-missing-or-multiple-tool-call",
			"wrong-first-s12-request",
			"empty-or-more-than-46-action-sequence",
			"repeated-candidate-action-vector-within-arm",
			"model-attempted-fifth-evaluation",
		],
		admittedAsDirectionalPairResult: false,
		durableNegativePolicyEvidence: true,
		causalTreatmentClaimAllowed: false,
	},
	completeSemanticRejection: {
		disposition: "terminal-complete-candidate-semantic-rejection",
		conditions: {
			evaluatorExitCode: 5,
			evaluatorStatus: "semantic_validation_failed",
			verifierInputsExpected: 20,
			verifierInputsCompleted: 20,
			accountingState: "FAILED",
			accountingExitCode: "5:0",
		},
		appliesOnlyToCalls: [2, 3, 4],
		durableNegativeEvidence: true,
		excludedFromFrontier: true,
		armContinuesWithinFrozenBudget: true,
	},
	completePair: {
		disposition: "terminal-complete-directional-single-pair",
		exactProviderDispatches: 8,
		exactEvaluatorJobs: 8,
		exactFreshTaskEvaluations: 16,
		causalClaimAllowed: false,
		replicationClaimAllowed: false,
		gpuPromotionAllowed: false,
	},
} as const;

export interface CompilerGymIrDeltaScreenCandidateVector {
	callIndex: 1 | 2 | 3 | 4;
	outcome: "verified" | "complete-semantic-rejection";
	blowfishIr: number | null;
	bzip2Ir: number | null;
}

export interface CompilerGymIrDeltaScreenArmResult {
	arm: CompilerGymIrDeltaScreenArm;
	candidates: CompilerGymIrDeltaScreenCandidateVector[];
}

export interface CompilerGymIrDeltaScreenPairAssessment {
	protocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL;
	primary: {
		metric: "strict-whole-pareto-coverage-v1";
		passed: boolean;
		controlStrictCoveragePassed: boolean;
		controlFrontier: Array<{ callIndex: 1 | 2 | 3 | 4; blowfishIr: number; bzip2Ir: number }>;
		treatmentFrontier: Array<{ callIndex: 1 | 2 | 3 | 4; blowfishIr: number; bzip2Ir: number }>;
		strictWitnesses: Array<{ controlCallIndex: number; treatmentCallIndex: number }>;
		controlStrictWitnesses: Array<{ treatmentCallIndex: number; controlCallIndex: number }>;
	};
	secondary: {
		metric: "normalized-minimax-prefix-auc-v1";
		formula: "mean_k=1..4 min_i<=k max(blowfish_i/3898,bzip2_i/28748); rejected candidates carry forward";
		controlPrefixBest: [number, number, number, number];
		treatmentPrefixBest: [number, number, number, number];
		controlAuc: number;
		treatmentAuc: number;
		passed: boolean;
		controlNonworse: boolean;
	};
	decision: "directionally-promising-requires-fresh-replication" | "not-promising" | "inconclusive";
	causalClaimAllowed: false;
	replicationClaimAllowed: false;
	gpuPromotionAllowed: false;
}

type VerifiedVector = { callIndex: 1 | 2 | 3 | 4; blowfishIr: number; bzip2Ir: number };

function parseArmCandidates(input: CompilerGymIrDeltaScreenArmResult): CompilerGymIrDeltaScreenCandidateVector[] {
	if (input.candidates.length !== 4) throw new Error(`${input.arm} must contain exactly four ordered candidates`);
	return input.candidates.map((candidate, index) => {
		if (candidate.callIndex !== index + 1) throw new Error(`${input.arm} call order drifted`);
		if (candidate.outcome === "verified") {
			nonnegativeInteger(candidate.blowfishIr, `${input.arm}.candidates[${index}].blowfishIr`);
			nonnegativeInteger(candidate.bzip2Ir, `${input.arm}.candidates[${index}].bzip2Ir`);
		} else if (candidate.blowfishIr !== null || candidate.bzip2Ir !== null) {
			throw new Error(`${input.arm} rejected candidates cannot enter the frontier`);
		}
		return structuredClone(candidate);
	});
}

function verifiedVectors(candidates: readonly CompilerGymIrDeltaScreenCandidateVector[]): VerifiedVector[] {
	return candidates.flatMap((candidate) =>
		candidate.outcome === "verified" && candidate.blowfishIr !== null && candidate.bzip2Ir !== null
			? [
					{
						callIndex: candidate.callIndex,
						blowfishIr: candidate.blowfishIr,
						bzip2Ir: candidate.bzip2Ir,
					},
				]
			: [],
	);
}

function dominates(left: VerifiedVector, right: VerifiedVector, strict: boolean): boolean {
	return (
		left.blowfishIr <= right.blowfishIr &&
		left.bzip2Ir <= right.bzip2Ir &&
		(!strict || left.blowfishIr < right.blowfishIr || left.bzip2Ir < right.bzip2Ir)
	);
}

function paretoFrontier(vectors: readonly VerifiedVector[]): VerifiedVector[] {
	return vectors.filter(
		(candidate, index) =>
			!vectors.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate, true)),
	);
}

interface ExactRatio {
	numerator: bigint;
	denominator: bigint;
}

function compareRatios(left: ExactRatio, right: ExactRatio): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function addRatios(left: ExactRatio, right: ExactRatio): ExactRatio {
	return {
		numerator: left.numerator * right.denominator + right.numerator * left.denominator,
		denominator: left.denominator * right.denominator,
	};
}

function minimaxRatio(blowfishIr: number, bzip2Ir: number): ExactRatio {
	const blowfish = { numerator: BigInt(blowfishIr), denominator: 3898n };
	const bzip2 = { numerator: BigInt(bzip2Ir), denominator: 28_748n };
	return compareRatios(blowfish, bzip2) >= 0 ? blowfish : bzip2;
}

function prefixBest(candidates: readonly CompilerGymIrDeltaScreenCandidateVector[]): {
	exact: [ExactRatio, ExactRatio, ExactRatio, ExactRatio];
	numeric: [number, number, number, number];
	sum: ExactRatio;
} {
	let best: ExactRatio | null = null;
	const exactValues = candidates.map((candidate) => {
		if (candidate.outcome === "verified" && candidate.blowfishIr !== null && candidate.bzip2Ir !== null) {
			const score = minimaxRatio(candidate.blowfishIr, candidate.bzip2Ir);
			if (best === null || compareRatios(score, best) < 0) best = score;
		}
		if (best === null) throw new Error("The frozen passing S12 request must define prefix one");
		return best;
	});
	const exact = [
		exactValues[0] as ExactRatio,
		exactValues[1] as ExactRatio,
		exactValues[2] as ExactRatio,
		exactValues[3] as ExactRatio,
	] as const;
	const numeric = exact.map((ratio) => Number(ratio.numerator) / Number(ratio.denominator)) as [
		number,
		number,
		number,
		number,
	];
	return {
		exact: [...exact],
		numeric,
		sum: exact.reduce(addRatios, { numerator: 0n, denominator: 1n }),
	};
}

export function assessCompilerGymIrDeltaScreenPair(input: {
	control: CompilerGymIrDeltaScreenArmResult;
	treatment: CompilerGymIrDeltaScreenArmResult;
}): CompilerGymIrDeltaScreenPairAssessment {
	if (input.control.arm !== "hidden-control" || input.treatment.arm !== "visible-ir-delta-treatment") {
		throw new Error("IR-delta pair assessment arms are reversed or missing");
	}
	const controlCandidates = parseArmCandidates(input.control);
	const treatmentCandidates = parseArmCandidates(input.treatment);
	for (const [arm, candidates] of [
		["control", controlCandidates],
		["treatment", treatmentCandidates],
	] as const) {
		const s12 = candidates[0];
		if (
			!s12 ||
			s12.outcome !== "verified" ||
			s12.blowfishIr !== COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[STOCK_CPU_TASKS[0]].irInstructionCount ||
			s12.bzip2Ir !== COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[STOCK_CPU_TASKS[1]].irInstructionCount
		) {
			throw new Error(`${arm} S12 apparatus anchor drifted`);
		}
	}
	const controlFrontier = paretoFrontier(verifiedVectors(controlCandidates));
	const treatmentFrontier = paretoFrontier(verifiedVectors(treatmentCandidates));
	const strictWitnesses = controlFrontier.flatMap((control) => {
		const witness = treatmentFrontier.find((treatment) => dominates(treatment, control, true));
		return witness ? [{ controlCallIndex: control.callIndex, treatmentCallIndex: witness.callIndex }] : [];
	});
	const primaryPassed = strictWitnesses.length === controlFrontier.length;
	const controlStrictWitnesses = treatmentFrontier.flatMap((treatment) => {
		const witness = controlFrontier.find((control) => dominates(control, treatment, true));
		return witness ? [{ treatmentCallIndex: treatment.callIndex, controlCallIndex: witness.callIndex }] : [];
	});
	const controlStrictCoveragePassed = controlStrictWitnesses.length === treatmentFrontier.length;
	const controlPrefix = prefixBest(controlCandidates);
	const treatmentPrefix = prefixBest(treatmentCandidates);
	const controlAuc = controlPrefix.numeric.reduce((sum, value) => sum + value, 0) / 4;
	const treatmentAuc = treatmentPrefix.numeric.reduce((sum, value) => sum + value, 0) / 4;
	const exactAucComparison = compareRatios(treatmentPrefix.sum, controlPrefix.sum);
	const secondaryPassed = exactAucComparison <= 0;
	const controlNonworse = exactAucComparison >= 0;
	const treatmentPromising = primaryPassed && secondaryPassed;
	const controlPromising = controlStrictCoveragePassed && controlNonworse;
	return {
		protocol: COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL,
		primary: {
			metric: "strict-whole-pareto-coverage-v1",
			passed: primaryPassed,
			controlStrictCoveragePassed,
			controlFrontier,
			treatmentFrontier,
			strictWitnesses,
			controlStrictWitnesses,
		},
		secondary: {
			metric: "normalized-minimax-prefix-auc-v1",
			formula: "mean_k=1..4 min_i<=k max(blowfish_i/3898,bzip2_i/28748); rejected candidates carry forward",
			controlPrefixBest: controlPrefix.numeric,
			treatmentPrefixBest: treatmentPrefix.numeric,
			controlAuc,
			treatmentAuc,
			passed: secondaryPassed,
			controlNonworse,
		},
		decision: treatmentPromising
			? "directionally-promising-requires-fresh-replication"
			: controlPromising
				? "not-promising"
				: "inconclusive",
		causalClaimAllowed: false,
		replicationClaimAllowed: false,
		gpuPromotionAllowed: false,
	};
}

export async function projectCompilerGymIrDeltaScreenFeedback(
	input: CompilerGymIrDeltaScreenProjectionInput,
): Promise<CompilerGymIrDeltaScreenFeedback> {
	assertCompilerGymIrDeltaScreenRequestPolicy(input.callIndex, input.details.request);
	if (input.details.protocolVersion !== STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION) {
		throw new Error("IR-delta paid screen requires the existing host-owned feedback protocol version");
	}
	const stdoutReference = input.details.job.measurement?.stdout;
	if (!stdoutReference) throw new Error("IR-delta screen measurement is missing its aggregate stdout artifact");
	const aggregateStdout = await input.readArtifact(stdoutReference);
	if (Buffer.byteLength(aggregateStdout, "utf8") !== stdoutReference.byteLength) {
		throw new Error("IR-delta aggregate stdout byte length does not match its artifact reference");
	}
	if (sha256Text(aggregateStdout) !== stdoutReference.digest) {
		throw new Error("IR-delta aggregate stdout digest does not match its artifact reference");
	}
	const parsed = parseCompilerGymIrDeltaAggregateStdout(aggregateStdout, input.details, input.callIndex);
	const control = structuredClone(input.details);
	if (input.arm === "hidden-control") return control;
	if (input.arm !== "visible-ir-delta-treatment") throw new Error(`Unknown IR-delta paid screen arm: ${input.arm}`);
	const trace = buildCompilerGymIrDeltaScreenTraceEnvelope(parsed);
	const treatment = { ...structuredClone(control), irDeltaTrace: trace };
	assertCompilerGymIrDeltaScreenProjectionPair(control, treatment, trace);
	return treatment;
}

import { sha256Text } from "./canonical-json.js";
import {
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
	type CompilerGymIrDeltaTrace,
} from "./compiler-gym-ir-delta-smoke-protocol.js";
import { STOCK_CPU_TASKS } from "./stock-cpu-protocol.js";

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL = "compiler-gym-one-env-ir-delta-qualification-v1" as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT = 1.15 as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT = 1.25 as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_RATIO_LIMIT = 0.25 as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT = 2_500 as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL =
	"prime-native-ipython-ir-delta-visibility-v1" as const;
export const COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL = "compiler-gym-agent-facing-ir-delta-v1" as const;

export type CompilerGymIrDeltaQualificationCaseId = "S12-blowfish" | "S12-bzip2" | "L46-bzip2" | "L46-blowfish";

export interface CompilerGymIrDeltaQualificationFinalMetrics {
	irInstructionCount: number;
	objectTextSizeBytes: number;
	verifierPassed: boolean;
	verifierInputsExpected: 20;
	verifierInputsCompleted: number;
}

export interface CompilerGymIrDeltaQualificationArmObservation {
	initialIrInstructionCount: number;
	actionIndices: number[];
	commandline: string;
	final: CompilerGymIrDeltaQualificationFinalMetrics;
	intrinsicTotalMs: number;
}

export interface CompilerGymIrDeltaQualificationTreatmentObservation
	extends CompilerGymIrDeltaQualificationArmObservation {
	trace: CompilerGymIrDeltaTrace | null;
	traceIntegrity: {
		passed: boolean;
		errors: string[];
	};
}

export interface CompilerGymIrDeltaQualificationCase {
	caseId: CompilerGymIrDeltaQualificationCaseId;
	candidateId: "S12" | "L46";
	candidateSha256: string;
	benchmarkId: "benchmark://cbench-v1/blowfish" | "benchmark://cbench-v1/bzip2";
	actions: string[];
	canonical: CompilerGymIrDeltaQualificationArmObservation;
	treatment: CompilerGymIrDeltaQualificationTreatmentObservation;
}

export interface CompilerGymIrDeltaProjection {
	initialIrInstructionCount: number;
	irDeltas: number[];
}

export interface CompilerGymIrDeltaTreatmentEnvelope {
	type: "compiler_gym_ir_delta_feedback";
	protocol: typeof COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL;
	candidateId: string;
	candidateSha256: string;
	prefixConditional: true;
	intermediateSemanticStatus: "unverified";
	terminalSemanticStatus: "canonical-20-input-verifier";
	zeroDeltaSemantics: typeof COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS;
	tasks: Array<{
		benchmarkId: string;
		trace: CompilerGymIrDeltaProjection;
	}>;
}

export interface CompilerGymIrDeltaQualificationVisibilityEvidence {
	protocol: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL;
	rendererProtocol: "prime-native-ipython-json-value-v1";
	candidates: Array<{
		candidateId: string;
		candidateSha256: string;
		benchmarkIds: string[];
		controlEnvelopeJson: string;
		controlEnvelopeSha256: string;
		controlRenderedText: string;
		controlRenderedTextSha256: string;
		controlProjectedAgentFacingBytes: number;
		typedTraceEnvelopeJson: string;
		typedTraceEnvelopeSha256: string;
		combinedTreatmentEnvelopeJson: string;
		combinedTreatmentEnvelopeSha256: string;
		combinedTreatmentRenderedText: string;
		combinedTreatmentRenderedTextSha256: string;
		combinedTreatmentProjectedAgentFacingBytes: number;
	}>;
}

export interface CompilerGymIrDeltaQualificationInput {
	protocol: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL;
	cases: CompilerGymIrDeltaQualificationCase[];
	visibility: CompilerGymIrDeltaQualificationVisibilityEvidence | null;
}

export interface CompilerGymIrDeltaQualificationAssessment {
	protocol: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL;
	caseCount: 4;
	equivalence: {
		passed: boolean;
		mismatches: Array<{ caseId: CompilerGymIrDeltaQualificationCaseId; fields: string[] }>;
	};
	traceIntegrity: {
		passed: boolean;
		perCase: Array<{ caseId: CompilerGymIrDeltaQualificationCaseId; passed: boolean; errors: string[] }>;
	};
	overhead: {
		perCase: Array<{
			caseId: CompilerGymIrDeltaQualificationCaseId;
			canonicalIntrinsicTotalMs: number;
			treatmentIntrinsicTotalMs: number;
			ratio: number;
			passed: boolean;
		}>;
		medianRatio: number;
		maximumRatio: number;
		medianLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT;
		perCaseLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT;
		passed: boolean;
	};
	projection: {
		status: "evaluated" | "not-evaluated-invalid-trace";
		treatmentEnvelopes: CompilerGymIrDeltaTreatmentEnvelope[];
		perCandidateBytes: Array<{
			candidateId: string;
			controlBytes: number;
			combinedTreatmentBytes: number;
			incrementalBytes: number;
			ratio: number;
			passed: boolean;
		}>;
		serializedBytes: number;
		controlAgentFacingBytes: number;
		ratio: number | null;
		ratioLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_RATIO_LIMIT;
		byteLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT;
		passed: boolean;
	};
	decision: "qualify-agent-facing-ir-delta-screen" | "kill-ir-delta-trace";
	nextGate: "separately-preregistered-paid-agent-screen" | null;
	paidScreenEligible: boolean;
	lunaAuthorized: false;
	measurementReuseAllowed: false;
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${path} keys mismatch`);
	}
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a nonempty string`);
	return value;
}

function digest(value: unknown, path: string): string {
	const parsed = string(value, path);
	if (!/^[0-9a-f]{64}$/.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return parsed;
}

function integer(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
	return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
	const parsed = integer(value, path);
	if (parsed < 0) throw new Error(`${path} must be nonnegative`);
	return parsed;
}

function positiveNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${path} must be finite and positive`);
	}
	return value;
}

function strings(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value.map((item, index) => string(item, `${path}[${index}]`));
}

function integers(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value.map((item, index) => nonnegativeInteger(item, `${path}[${index}]`));
}

function parseFinal(value: unknown, path: string): CompilerGymIrDeltaQualificationFinalMetrics {
	const parsed = object(value, path);
	exactKeys(
		parsed,
		[
			"irInstructionCount",
			"objectTextSizeBytes",
			"verifierPassed",
			"verifierInputsExpected",
			"verifierInputsCompleted",
		],
		path,
	);
	if (typeof parsed.verifierPassed !== "boolean") throw new Error(`${path}.verifierPassed must be boolean`);
	if (parsed.verifierInputsExpected !== 20) throw new Error(`${path}.verifierInputsExpected must equal 20`);
	const verifierInputsCompleted = nonnegativeInteger(
		parsed.verifierInputsCompleted,
		`${path}.verifierInputsCompleted`,
	);
	if (verifierInputsCompleted > 20) throw new Error(`${path}.verifierInputsCompleted must be at most 20`);
	return {
		irInstructionCount: nonnegativeInteger(parsed.irInstructionCount, `${path}.irInstructionCount`),
		objectTextSizeBytes: nonnegativeInteger(parsed.objectTextSizeBytes, `${path}.objectTextSizeBytes`),
		verifierPassed: parsed.verifierPassed,
		verifierInputsExpected: 20,
		verifierInputsCompleted,
	};
}

function parseArm(value: unknown, path: string): CompilerGymIrDeltaQualificationArmObservation {
	const parsed = object(value, path);
	exactKeys(parsed, ["initialIrInstructionCount", "actionIndices", "commandline", "final", "intrinsicTotalMs"], path);
	return {
		initialIrInstructionCount: nonnegativeInteger(
			parsed.initialIrInstructionCount,
			`${path}.initialIrInstructionCount`,
		),
		actionIndices: integers(parsed.actionIndices, `${path}.actionIndices`),
		commandline: string(parsed.commandline, `${path}.commandline`),
		final: parseFinal(parsed.final, `${path}.final`),
		intrinsicTotalMs: positiveNumber(parsed.intrinsicTotalMs, `${path}.intrinsicTotalMs`),
	};
}

function parseTrace(
	value: unknown,
	actions: readonly string[],
	actionIndices: readonly number[],
	terminalIr: number,
	path: string,
): CompilerGymIrDeltaTrace {
	const parsed = object(value, path);
	exactKeys(parsed, ["initialIrInstructionCount", "records"], path);
	const initialIrInstructionCount = nonnegativeInteger(
		parsed.initialIrInstructionCount,
		`${path}.initialIrInstructionCount`,
	);
	if (!Array.isArray(parsed.records) || parsed.records.length !== actions.length) {
		throw new Error(`${path}.records length must equal the action count`);
	}
	let deltaSum = 0;
	const records = parsed.records.map((raw, index) => {
		const recordPath = `${path}.records[${index}]`;
		const item = object(raw, recordPath);
		exactKeys(item, ["index", "action", "actionIndex", "deltaFromPrevious"], recordPath);
		const observedIndex = nonnegativeInteger(item.index, `${recordPath}.index`);
		const action = string(item.action, `${recordPath}.action`);
		const actionIndex = nonnegativeInteger(item.actionIndex, `${recordPath}.actionIndex`);
		const deltaFromPrevious = integer(item.deltaFromPrevious, `${recordPath}.deltaFromPrevious`);
		if (observedIndex !== index || action !== actions[index] || actionIndex !== actionIndices[index]) {
			throw new Error(`${recordPath} is not bound to the frozen action order`);
		}
		deltaSum += deltaFromPrevious;
		if (!Number.isSafeInteger(deltaSum)) throw new Error(`${path} delta sum is not safe`);
		return { index: observedIndex, action, actionIndex, deltaFromPrevious };
	});
	if (initialIrInstructionCount + deltaSum !== terminalIr) {
		throw new Error(`${path} deltas do not telescope to terminal IR`);
	}
	return { initialIrInstructionCount, records };
}

function parseCase(value: unknown, index: number): CompilerGymIrDeltaQualificationCase {
	const path = `input.cases[${index}]`;
	const parsed = object(value, path);
	exactKeys(
		parsed,
		["caseId", "candidateId", "candidateSha256", "benchmarkId", "actions", "canonical", "treatment"],
		path,
	);
	const caseId = string(parsed.caseId, `${path}.caseId`) as CompilerGymIrDeltaQualificationCaseId;
	if (!["S12-blowfish", "S12-bzip2", "L46-bzip2", "L46-blowfish"].includes(caseId)) {
		throw new Error(`${path}.caseId is not frozen`);
	}
	const candidateId = string(parsed.candidateId, `${path}.candidateId`);
	if (candidateId !== "S12" && candidateId !== "L46") throw new Error(`${path}.candidateId is not frozen`);
	const benchmarkId = string(parsed.benchmarkId, `${path}.benchmarkId`);
	if (benchmarkId !== "benchmark://cbench-v1/blowfish" && benchmarkId !== "benchmark://cbench-v1/bzip2") {
		throw new Error(`${path}.benchmarkId is not frozen`);
	}
	const actions = strings(parsed.actions, `${path}.actions`);
	const frozenCase = {
		"S12-blowfish": {
			candidateId: "S12",
			benchmarkId: "benchmark://cbench-v1/blowfish",
			actionCount: 12,
			actionsSha256: "60df17de77999363e6547b8447140c70e253859ec0eb42caa6e60ab41f62e042",
		},
		"S12-bzip2": {
			candidateId: "S12",
			benchmarkId: "benchmark://cbench-v1/bzip2",
			actionCount: 12,
			actionsSha256: "60df17de77999363e6547b8447140c70e253859ec0eb42caa6e60ab41f62e042",
		},
		"L46-bzip2": {
			candidateId: "L46",
			benchmarkId: "benchmark://cbench-v1/bzip2",
			actionCount: 46,
			actionsSha256: "9c79e07358780e187d0a63ea9fa0c049307dc399308cc2080841095d2f8ff751",
		},
		"L46-blowfish": {
			candidateId: "L46",
			benchmarkId: "benchmark://cbench-v1/blowfish",
			actionCount: 46,
			actionsSha256: "9c79e07358780e187d0a63ea9fa0c049307dc399308cc2080841095d2f8ff751",
		},
	}[caseId];
	if (
		candidateId !== frozenCase.candidateId ||
		benchmarkId !== frozenCase.benchmarkId ||
		actions.length !== frozenCase.actionCount ||
		sha256Text(JSON.stringify(actions)) !== frozenCase.actionsSha256 ||
		parsed.candidateSha256 !== frozenCase.actionsSha256
	) {
		throw new Error(`${path} does not bind the exact frozen case, candidate, benchmark, and actions`);
	}
	const canonical = parseArm(parsed.canonical, `${path}.canonical`);
	const treatmentRaw = object(parsed.treatment, `${path}.treatment`);
	exactKeys(
		treatmentRaw,
		[
			"initialIrInstructionCount",
			"actionIndices",
			"commandline",
			"final",
			"intrinsicTotalMs",
			"trace",
			"traceIntegrity",
		],
		`${path}.treatment`,
	);
	const { trace: rawTrace, traceIntegrity: rawIntegrity, ...rawArm } = treatmentRaw;
	const treatmentArm = parseArm(rawArm, `${path}.treatment`);
	const integrity = object(rawIntegrity, `${path}.treatment.traceIntegrity`);
	exactKeys(integrity, ["passed", "errors"], `${path}.treatment.traceIntegrity`);
	if (typeof integrity.passed !== "boolean")
		throw new Error(`${path}.treatment.traceIntegrity.passed must be boolean`);
	const errors = strings(integrity.errors, `${path}.treatment.traceIntegrity.errors`);
	if (integrity.passed !== (errors.length === 0)) throw new Error(`${path}.treatment.traceIntegrity is contradictory`);
	if (canonical.actionIndices.length !== actions.length || treatmentArm.actionIndices.length !== actions.length) {
		throw new Error(`${path} action-index counts must equal the action count`);
	}
	let trace: CompilerGymIrDeltaTrace | null = null;
	if (integrity.passed) {
		if (!treatmentArm.final.verifierPassed || treatmentArm.final.verifierInputsCompleted !== 20) {
			throw new Error(`${path}.treatment trace integrity cannot pass without the complete terminal verifier`);
		}
		if (rawTrace === null) throw new Error(`${path}.treatment.trace is required when integrity passes`);
		trace = parseTrace(
			rawTrace,
			actions,
			treatmentArm.actionIndices,
			treatmentArm.final.irInstructionCount,
			`${path}.treatment.trace`,
		);
		if (trace.initialIrInstructionCount !== treatmentArm.initialIrInstructionCount) {
			throw new Error(`${path}.treatment.trace initial IR differs from the treatment result`);
		}
	} else if (rawTrace !== null) {
		throw new Error(`${path}.treatment.trace must be null when integrity fails`);
	}
	return {
		caseId,
		candidateId,
		candidateSha256: digest(parsed.candidateSha256, `${path}.candidateSha256`),
		benchmarkId,
		actions,
		canonical,
		treatment: { ...treatmentArm, trace, traceIntegrity: { passed: integrity.passed, errors } },
	};
}

export function buildCompilerGymIrDeltaTreatmentEnvelopes(
	cases: readonly CompilerGymIrDeltaQualificationCase[],
): CompilerGymIrDeltaTreatmentEnvelope[] {
	const grouped = new Map<string, CompilerGymIrDeltaQualificationCase[]>();
	for (const item of cases) {
		if (!item.treatment.trace || !item.treatment.traceIntegrity.passed) {
			throw new Error("Cannot project an invalid IR-delta trace");
		}
		const key = `${item.candidateId}:${item.candidateSha256}`;
		grouped.set(key, [...(grouped.get(key) ?? []), item]);
	}
	const taskOrder = new Map(STOCK_CPU_TASKS.map((benchmarkId, index) => [benchmarkId, index]));
	return [...grouped.values()].map((candidateCases) => {
		const first = candidateCases[0];
		if (!first) throw new Error("Empty candidate group");
		const ordered = [...candidateCases].sort(
			(left, right) =>
				(taskOrder.get(left.benchmarkId) ?? Number.MAX_SAFE_INTEGER) -
				(taskOrder.get(right.benchmarkId) ?? Number.MAX_SAFE_INTEGER),
		);
		if (ordered.some((item) => !taskOrder.has(item.benchmarkId))) throw new Error("Projection task is not stock");
		return {
			type: "compiler_gym_ir_delta_feedback",
			protocol: COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL,
			candidateId: first.candidateId,
			candidateSha256: first.candidateSha256,
			prefixConditional: true,
			intermediateSemanticStatus: "unverified",
			terminalSemanticStatus: "canonical-20-input-verifier",
			zeroDeltaSemantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
			tasks: ordered.map((item) => {
				const trace = item.treatment.trace;
				if (!trace) throw new Error("Trace disappeared during projection");
				return {
					benchmarkId: item.benchmarkId,
					trace: {
						initialIrInstructionCount: trace.initialIrInstructionCount,
						irDeltas: trace.records.map((record) => record.deltaFromPrevious),
					},
				};
			}),
		};
	});
}

export function assertNoForbiddenIrDeltaProjectionMetadata(value: unknown, path = "value"): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries())
			assertNoForbiddenIrDeltaProjectionMetadata(item, `${path}[${index}]`);
		return;
	}
	if (typeof value !== "object" || value === null) return;
	for (const [key, item] of Object.entries(value)) {
		if (key === "action_had_no_effect" || key === "no_effect_bits" || key === "noEffectBits") {
			throw new Error(`${path}.${key} is forbidden pass-reported no-effect metadata`);
		}
		if (key === "shadow_action_trace") throw new Error(`${path}.${key} is a forbidden shadow timing`);
		assertNoForbiddenIrDeltaProjectionMetadata(item, `${path}.${key}`);
	}
}

function parseVisibility(
	value: unknown,
	cases: readonly CompilerGymIrDeltaQualificationCase[],
): CompilerGymIrDeltaQualificationVisibilityEvidence {
	const path = "input.visibility";
	const parsed = object(value, path);
	exactKeys(parsed, ["protocol", "rendererProtocol", "candidates"], path);
	if (parsed.protocol !== COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL) {
		throw new Error(`${path}.protocol drifted`);
	}
	if (parsed.rendererProtocol !== "prime-native-ipython-json-value-v1") {
		throw new Error(`${path}.rendererProtocol drifted`);
	}
	if (!Array.isArray(parsed.candidates)) throw new Error(`${path}.candidates must be an array`);
	const expectedEnvelopes = buildCompilerGymIrDeltaTreatmentEnvelopes(cases);
	if (parsed.candidates.length !== expectedEnvelopes.length) {
		throw new Error(`${path}.candidates must contain one record per candidate`);
	}
	const candidates = parsed.candidates.map((raw, index) => {
		const candidatePath = `${path}.candidates[${index}]`;
		const item = object(raw, candidatePath);
		exactKeys(
			item,
			[
				"candidateId",
				"candidateSha256",
				"benchmarkIds",
				"controlEnvelopeJson",
				"controlEnvelopeSha256",
				"controlRenderedText",
				"controlRenderedTextSha256",
				"controlProjectedAgentFacingBytes",
				"typedTraceEnvelopeJson",
				"typedTraceEnvelopeSha256",
				"combinedTreatmentEnvelopeJson",
				"combinedTreatmentEnvelopeSha256",
				"combinedTreatmentRenderedText",
				"combinedTreatmentRenderedTextSha256",
				"combinedTreatmentProjectedAgentFacingBytes",
			],
			candidatePath,
		);
		const expected = expectedEnvelopes[index];
		if (!expected) throw new Error(`${candidatePath} has no expected envelope`);
		const candidateId = string(item.candidateId, `${candidatePath}.candidateId`);
		const candidateSha256 = digest(item.candidateSha256, `${candidatePath}.candidateSha256`);
		if (candidateId !== expected.candidateId || candidateSha256 !== expected.candidateSha256) {
			throw new Error(`${candidatePath} is not bound to the expected candidate`);
		}
		const benchmarkIds = strings(item.benchmarkIds, `${candidatePath}.benchmarkIds`);
		if (JSON.stringify(benchmarkIds) !== JSON.stringify(expected.tasks.map((task) => task.benchmarkId))) {
			throw new Error(`${candidatePath}.benchmarkIds drifted`);
		}
		const controlEnvelopeJson = string(item.controlEnvelopeJson, `${candidatePath}.controlEnvelopeJson`);
		const typedTraceEnvelopeJson = string(item.typedTraceEnvelopeJson, `${candidatePath}.typedTraceEnvelopeJson`);
		const combinedTreatmentEnvelopeJson = string(
			item.combinedTreatmentEnvelopeJson,
			`${candidatePath}.combinedTreatmentEnvelopeJson`,
		);
		const controlEnvelope = object(
			JSON.parse(controlEnvelopeJson) as unknown,
			`${candidatePath}.controlEnvelopeJson`,
		);
		const typedTraceEnvelope = object(
			JSON.parse(typedTraceEnvelopeJson) as unknown,
			`${candidatePath}.typedTraceEnvelopeJson`,
		);
		const combinedTreatmentEnvelope = object(
			JSON.parse(combinedTreatmentEnvelopeJson) as unknown,
			`${candidatePath}.combinedTreatmentEnvelopeJson`,
		);
		if (controlEnvelopeJson !== JSON.stringify(controlEnvelope)) {
			throw new Error(`${candidatePath}.controlEnvelopeJson is not the exact generated serialization`);
		}
		if (combinedTreatmentEnvelopeJson !== JSON.stringify(combinedTreatmentEnvelope)) {
			throw new Error(`${candidatePath}.combinedTreatmentEnvelopeJson is not the exact generated serialization`);
		}
		assertNoForbiddenIrDeltaProjectionMetadata(typedTraceEnvelope, `${candidatePath}.typedTraceEnvelope`);
		assertNoForbiddenIrDeltaProjectionMetadata(
			combinedTreatmentEnvelope,
			`${candidatePath}.combinedTreatmentEnvelope`,
		);
		if (
			JSON.stringify(typedTraceEnvelope) !== JSON.stringify(expected) ||
			typedTraceEnvelopeJson !== JSON.stringify(expected)
		) {
			throw new Error(`${candidatePath}.typedTraceEnvelopeJson drifted`);
		}
		if (JSON.stringify(combinedTreatmentEnvelope.irDeltaTrace) !== JSON.stringify(expected)) {
			throw new Error(`${candidatePath}.combinedTreatmentEnvelopeJson does not bind irDeltaTrace`);
		}
		const reconstructedControl = structuredClone(combinedTreatmentEnvelope);
		delete reconstructedControl.irDeltaTrace;
		if (JSON.stringify(reconstructedControl) !== JSON.stringify(controlEnvelope)) {
			throw new Error(`${candidatePath} treatment differs from control outside irDeltaTrace`);
		}
		for (const [field, contents] of [
			["controlEnvelopeSha256", controlEnvelopeJson],
			["typedTraceEnvelopeSha256", typedTraceEnvelopeJson],
			["combinedTreatmentEnvelopeSha256", combinedTreatmentEnvelopeJson],
		] as const) {
			if (digest(item[field], `${candidatePath}.${field}`) !== sha256Text(contents)) {
				throw new Error(`${candidatePath}.${field} does not bind its JSON`);
			}
		}
		const controlRenderedText = string(item.controlRenderedText, `${candidatePath}.controlRenderedText`);
		const combinedTreatmentRenderedText = string(
			item.combinedTreatmentRenderedText,
			`${candidatePath}.combinedTreatmentRenderedText`,
		);
		if (
			digest(item.controlRenderedTextSha256, `${candidatePath}.controlRenderedTextSha256`) !==
				sha256Text(controlRenderedText) ||
			digest(item.combinedTreatmentRenderedTextSha256, `${candidatePath}.combinedTreatmentRenderedTextSha256`) !==
				sha256Text(combinedTreatmentRenderedText)
		) {
			throw new Error(`${candidatePath} rendered text hash mismatch`);
		}
		const controlProjectedAgentFacingBytes = nonnegativeInteger(
			item.controlProjectedAgentFacingBytes,
			`${candidatePath}.controlProjectedAgentFacingBytes`,
		);
		const combinedTreatmentProjectedAgentFacingBytes = nonnegativeInteger(
			item.combinedTreatmentProjectedAgentFacingBytes,
			`${candidatePath}.combinedTreatmentProjectedAgentFacingBytes`,
		);
		if (
			controlProjectedAgentFacingBytes !== Buffer.byteLength(controlRenderedText, "utf8") ||
			combinedTreatmentProjectedAgentFacingBytes !== Buffer.byteLength(combinedTreatmentRenderedText, "utf8") ||
			controlProjectedAgentFacingBytes === 0 ||
			combinedTreatmentProjectedAgentFacingBytes <= controlProjectedAgentFacingBytes
		) {
			throw new Error(`${candidatePath} rendered byte counts are invalid`);
		}
		return {
			candidateId,
			candidateSha256,
			benchmarkIds,
			controlEnvelopeJson,
			controlEnvelopeSha256: digest(item.controlEnvelopeSha256, `${candidatePath}.controlEnvelopeSha256`),
			controlRenderedText,
			controlRenderedTextSha256: digest(
				item.controlRenderedTextSha256,
				`${candidatePath}.controlRenderedTextSha256`,
			),
			controlProjectedAgentFacingBytes,
			typedTraceEnvelopeJson,
			typedTraceEnvelopeSha256: digest(item.typedTraceEnvelopeSha256, `${candidatePath}.typedTraceEnvelopeSha256`),
			combinedTreatmentEnvelopeJson,
			combinedTreatmentEnvelopeSha256: digest(
				item.combinedTreatmentEnvelopeSha256,
				`${candidatePath}.combinedTreatmentEnvelopeSha256`,
			),
			combinedTreatmentRenderedText,
			combinedTreatmentRenderedTextSha256: digest(
				item.combinedTreatmentRenderedTextSha256,
				`${candidatePath}.combinedTreatmentRenderedTextSha256`,
			),
			combinedTreatmentProjectedAgentFacingBytes,
		};
	});
	return {
		protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_VISIBILITY_PROTOCOL,
		rendererProtocol: "prime-native-ipython-json-value-v1",
		candidates,
	};
}

export function parseCompilerGymIrDeltaQualificationInput(value: unknown): CompilerGymIrDeltaQualificationInput {
	const parsed = object(value, "input");
	exactKeys(parsed, ["protocol", "cases", "visibility"], "input");
	if (parsed.protocol !== COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL)
		throw new Error("Qualification protocol drifted");
	if (!Array.isArray(parsed.cases) || parsed.cases.length !== 4) {
		throw new Error("Qualification requires exactly four paired cases");
	}
	const cases = parsed.cases.map(parseCase);
	const expectedOrder: CompilerGymIrDeltaQualificationCaseId[] = [
		"S12-blowfish",
		"S12-bzip2",
		"L46-bzip2",
		"L46-blowfish",
	];
	if (cases.some((item, index) => item.caseId !== expectedOrder[index]))
		throw new Error("Qualification case order drifted");
	for (const candidateId of ["S12", "L46"] as const) {
		const candidateCases = cases.filter((item) => item.candidateId === candidateId);
		if (
			candidateCases.length !== 2 ||
			new Set(candidateCases.map((item) => item.benchmarkId)).size !== 2 ||
			new Set(candidateCases.map((item) => item.candidateSha256)).size !== 1 ||
			new Set(candidateCases.map((item) => JSON.stringify(item.actions))).size !== 1
		) {
			throw new Error(`${candidateId} must bind identical actions across exactly two distinct stock tasks`);
		}
	}
	const tracesValid = cases.every((item) => item.treatment.traceIntegrity.passed);
	if (tracesValid && parsed.visibility === null) throw new Error("Visibility evidence is required for valid traces");
	if (!tracesValid && parsed.visibility !== null)
		throw new Error("Visibility evidence must be null for invalid traces");
	return {
		protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
		cases,
		visibility: parsed.visibility === null ? null : parseVisibility(parsed.visibility, cases),
	};
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return ((sorted[1] as number) + (sorted[2] as number)) / 2;
}

export function assessCompilerGymIrDeltaQualification(value: unknown): CompilerGymIrDeltaQualificationAssessment {
	const input = parseCompilerGymIrDeltaQualificationInput(value);
	const mismatches = input.cases.flatMap((item) => {
		const fields: string[] = [];
		if (item.canonical.initialIrInstructionCount !== item.treatment.initialIrInstructionCount) {
			fields.push("initialIrInstructionCount");
		}
		if (JSON.stringify(item.canonical.actionIndices) !== JSON.stringify(item.treatment.actionIndices)) {
			fields.push("actionIndices");
		}
		if (item.canonical.commandline !== item.treatment.commandline) fields.push("commandline");
		if (item.canonical.final.irInstructionCount !== item.treatment.final.irInstructionCount) {
			fields.push("irInstructionCount");
		}
		if (item.canonical.final.objectTextSizeBytes !== item.treatment.final.objectTextSizeBytes) {
			fields.push("objectTextSizeBytes");
		}
		if (!item.canonical.final.verifierPassed || !item.treatment.final.verifierPassed) fields.push("verifierPassed");
		if (item.canonical.final.verifierInputsCompleted !== 20 || item.treatment.final.verifierInputsCompleted !== 20) {
			fields.push("verifierInputsCompleted");
		}
		return fields.length === 0 ? [] : [{ caseId: item.caseId, fields }];
	});
	const tracePerCase = input.cases.map((item) => ({
		caseId: item.caseId,
		passed: item.treatment.traceIntegrity.passed,
		errors: [...item.treatment.traceIntegrity.errors],
	}));
	const tracePassed = tracePerCase.every((item) => item.passed);
	const overheadPerCase = input.cases.map((item) => {
		const ratio = item.treatment.intrinsicTotalMs / item.canonical.intrinsicTotalMs;
		return {
			caseId: item.caseId,
			canonicalIntrinsicTotalMs: item.canonical.intrinsicTotalMs,
			treatmentIntrinsicTotalMs: item.treatment.intrinsicTotalMs,
			ratio,
			passed: ratio <= COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT,
		};
	});
	const medianRatio = median(overheadPerCase.map((item) => item.ratio));
	const maximumRatio = Math.max(...overheadPerCase.map((item) => item.ratio));
	const overheadPassed =
		medianRatio <= COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT &&
		overheadPerCase.every((item) => item.passed);
	const treatmentEnvelopes = input.visibility ? buildCompilerGymIrDeltaTreatmentEnvelopes(input.cases) : [];
	const perCandidateBytes =
		input.visibility?.candidates.map((item) => {
			const incrementalBytes =
				item.combinedTreatmentProjectedAgentFacingBytes - item.controlProjectedAgentFacingBytes;
			const ratio = incrementalBytes / item.controlProjectedAgentFacingBytes;
			return {
				candidateId: item.candidateId,
				controlBytes: item.controlProjectedAgentFacingBytes,
				combinedTreatmentBytes: item.combinedTreatmentProjectedAgentFacingBytes,
				incrementalBytes,
				ratio,
				passed: incrementalBytes * 4 <= item.controlProjectedAgentFacingBytes,
			};
		}) ?? [];
	const serializedBytes = perCandidateBytes.reduce((sum, item) => sum + item.incrementalBytes, 0);
	const controlAgentFacingBytes = perCandidateBytes.reduce((sum, item) => sum + item.controlBytes, 0);
	if (!Number.isSafeInteger(serializedBytes) || !Number.isSafeInteger(controlAgentFacingBytes)) {
		throw new Error("Projection byte totals are not safe integers");
	}
	const projectionRatio = input.visibility ? serializedBytes / controlAgentFacingBytes : null;
	const projectionPassed =
		input.visibility !== null &&
		serializedBytes > 0 &&
		serializedBytes <= COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT &&
		serializedBytes * 4 <= controlAgentFacingBytes &&
		perCandidateBytes.every((item) => item.passed);
	const passed = mismatches.length === 0 && tracePassed && overheadPassed && projectionPassed;
	return {
		protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
		caseCount: 4,
		equivalence: { passed: mismatches.length === 0, mismatches },
		traceIntegrity: { passed: tracePassed, perCase: tracePerCase },
		overhead: {
			perCase: overheadPerCase,
			medianRatio,
			maximumRatio,
			medianLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT,
			perCaseLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT,
			passed: overheadPassed,
		},
		projection: {
			status: input.visibility ? "evaluated" : "not-evaluated-invalid-trace",
			treatmentEnvelopes,
			perCandidateBytes,
			serializedBytes,
			controlAgentFacingBytes,
			ratio: projectionRatio,
			ratioLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_RATIO_LIMIT,
			byteLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT,
			passed: projectionPassed,
		},
		decision: passed ? "qualify-agent-facing-ir-delta-screen" : "kill-ir-delta-trace",
		nextGate: passed ? "separately-preregistered-paid-agent-screen" : null,
		paidScreenEligible: passed,
		lunaAuthorized: false,
		measurementReuseAllowed: false,
	};
}

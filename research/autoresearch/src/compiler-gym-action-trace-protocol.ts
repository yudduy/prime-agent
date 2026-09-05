import { sha256Text } from "./canonical-json.js";
import { STOCK_CPU_TASKS } from "./stock-cpu-protocol.js";

export const COMPILER_GYM_ACTION_TRACE_PROTOCOL = "compiler-gym-action-trace-qualification-v3" as const;
export const COMPILER_GYM_ACTION_TRACE_MEDIAN_OVERHEAD_LIMIT = 1.15 as const;
export const COMPILER_GYM_ACTION_TRACE_PER_CASE_OVERHEAD_LIMIT = 1.25 as const;
export const COMPILER_GYM_ACTION_TRACE_PROJECTION_RATIO_LIMIT = 0.25 as const;
export const COMPILER_GYM_ACTION_TRACE_PROJECTION_BYTE_LIMIT = 2_500 as const;

export interface CompilerGymActionTraceFinalMetrics {
	irInstructionCount: number;
	objectTextSizeBytes: number;
	verifierPassed: boolean;
}

export interface CompilerGymActionTraceActionRecord {
	index: number;
	action: string;
	actionIndex: number;
	irInstructionCount: number;
	deltaFromPrevious: number;
	actionHadNoEffect: boolean;
}

export interface CompilerGymActionTrace {
	initialIrInstructionCount: number;
	records: CompilerGymActionTraceActionRecord[];
}

export interface CompilerGymActionTraceQualificationCase {
	caseId: string;
	candidateId: string;
	candidateSha256: string;
	benchmarkId: string;
	actions: string[];
	actionIndices: number[];
	authoritative: {
		final: CompilerGymActionTraceFinalMetrics;
		intrinsicRuntimeMs: number;
	};
	shadow: {
		final: CompilerGymActionTraceFinalMetrics;
		intrinsicRuntimeMs: number;
		trace: CompilerGymActionTrace;
	};
}

export const COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL = "prime-native-ipython-action-trace-visibility-v1" as const;
export const COMPILER_GYM_ACTION_TRACE_TREATMENT_ENVELOPE_PROTOCOL =
	"compiler-gym-agent-facing-action-trace-v1" as const;

export interface CompilerGymActionTraceTreatmentEnvelope {
	type: "compiler_gym_action_trace_feedback";
	protocol: typeof COMPILER_GYM_ACTION_TRACE_TREATMENT_ENVELOPE_PROTOCOL;
	candidateId: string;
	candidateSha256: string;
	tasks: Array<{
		benchmarkId: string;
		prefixConditional: true;
		intermediateSemanticStatus: "unverified";
		terminalSemanticStatus: "authoritative-final-verifier-only";
		noEffectMeaning: "llvm-pass-manager-reported-no-module-modification";
		trace: CompilerGymActionTraceProjection;
	}>;
}

export interface CompilerGymActionTraceVisibilityEvidence {
	protocol: typeof COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL;
	rendererProtocol: string;
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

export interface CompilerGymActionTraceQualificationInput {
	protocol: typeof COMPILER_GYM_ACTION_TRACE_PROTOCOL;
	cases: CompilerGymActionTraceQualificationCase[];
	visibility: CompilerGymActionTraceVisibilityEvidence;
}

export interface CompilerGymActionTraceProjection {
	initialIrInstructionCount: number;
	irDeltas: number[];
	noEffectBits: string;
}

export type CompilerGymActionTraceFinalMetricField = keyof CompilerGymActionTraceFinalMetrics;

export interface CompilerGymActionTraceEquivalenceMismatch {
	caseId: string;
	fields: CompilerGymActionTraceFinalMetricField[];
}

export type CompilerGymActionTraceDecision = "qualify-agent-facing-trace-screen" | "kill-action-trace";

export interface CompilerGymActionTraceAssessment {
	protocol: typeof COMPILER_GYM_ACTION_TRACE_PROTOCOL;
	caseCount: number;
	equivalence: {
		passed: boolean;
		mismatches: CompilerGymActionTraceEquivalenceMismatch[];
	};
	overhead: {
		perCase: Array<{
			caseId: string;
			authoritativeIntrinsicRuntimeMs: number;
			shadowIntrinsicRuntimeMs: number;
			ratio: number;
			passed: boolean;
		}>;
		medianRatio: number;
		maximumRatio: number;
		medianLimit: typeof COMPILER_GYM_ACTION_TRACE_MEDIAN_OVERHEAD_LIMIT;
		perCaseLimit: typeof COMPILER_GYM_ACTION_TRACE_PER_CASE_OVERHEAD_LIMIT;
		medianPassed: boolean;
		everyCasePassed: boolean;
		passed: boolean;
	};
	projection: {
		values: CompilerGymActionTraceProjection[];
		treatmentEnvelopes: CompilerGymActionTraceTreatmentEnvelope[];
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
		ratio: number;
		ratioLimit: typeof COMPILER_GYM_ACTION_TRACE_PROJECTION_RATIO_LIMIT;
		byteLimit: typeof COMPILER_GYM_ACTION_TRACE_PROJECTION_BYTE_LIMIT;
		ratioPassed: boolean;
		aggregateRatioPassed: boolean;
		everyCandidateRatioPassed: boolean;
		byteLimitPassed: boolean;
		passed: boolean;
	};
	decision: CompilerGymActionTraceDecision;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function expectExactKeys(record: Record<string, unknown>, expected: readonly string[], path: string): void {
	const expectedSet = new Set(expected);
	const missing = expected.filter((key) => !Object.hasOwn(record, key));
	const extra = Object.keys(record).filter((key) => !expectedSet.has(key));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(`${path} keys mismatch; missing=[${missing.join(",")}], extra=[${extra.join(",")}]`);
	}
}

function expectNonemptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${path} must be a nonempty string`);
	}
	return value;
}

function expectBoolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
	return value;
}

function expectNonnegativeSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function expectSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new Error(`${path} must be a safe integer`);
	}
	return value;
}

function expectPositiveFinite(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${path} must be finite and positive`);
	}
	return value;
}

function parseFinalMetrics(value: unknown, path: string): CompilerGymActionTraceFinalMetrics {
	const record = expectRecord(value, path);
	expectExactKeys(record, ["irInstructionCount", "objectTextSizeBytes", "verifierPassed"], path);
	return {
		irInstructionCount: expectNonnegativeSafeInteger(record.irInstructionCount, `${path}.irInstructionCount`),
		objectTextSizeBytes: expectNonnegativeSafeInteger(record.objectTextSizeBytes, `${path}.objectTextSizeBytes`),
		verifierPassed: expectBoolean(record.verifierPassed, `${path}.verifierPassed`),
	};
}

function parseActions(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	if (value.length > 256) throw new Error(`${path} may contain at most 256 actions`);
	return value.map((action, index) => expectNonemptyString(action, `${path}[${index}]`));
}

function parseActionIndices(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value.map((actionIndex, index) => expectNonnegativeSafeInteger(actionIndex, `${path}[${index}]`));
}

function parseTrace(
	value: unknown,
	actions: readonly string[],
	actionIndices: readonly number[],
	shadowFinal: CompilerGymActionTraceFinalMetrics,
	path: string,
): CompilerGymActionTrace {
	const trace = expectRecord(value, path);
	expectExactKeys(trace, ["initialIrInstructionCount", "records"], path);
	const initialIrInstructionCount = expectNonnegativeSafeInteger(
		trace.initialIrInstructionCount,
		`${path}.initialIrInstructionCount`,
	);
	if (!Array.isArray(trace.records)) throw new Error(`${path}.records must be an array`);
	if (trace.records.length !== actions.length) {
		throw new Error(`${path}.records length must equal actions length`);
	}
	if (actionIndices.length !== actions.length) {
		throw new Error(`${path} actionIndices length must equal actions length`);
	}

	let previousIr = initialIrInstructionCount;
	let telescopedDelta = 0;
	const records = trace.records.map((value, position): CompilerGymActionTraceActionRecord => {
		const recordPath = `${path}.records[${position}]`;
		const record = expectRecord(value, recordPath);
		expectExactKeys(
			record,
			["index", "action", "actionIndex", "irInstructionCount", "deltaFromPrevious", "actionHadNoEffect"],
			recordPath,
		);
		const index = expectNonnegativeSafeInteger(record.index, `${recordPath}.index`);
		if (index !== position) throw new Error(`${recordPath}.index is out of order`);
		const action = expectNonemptyString(record.action, `${recordPath}.action`);
		if (action !== actions[position]) throw new Error(`${recordPath}.action does not match actions order`);
		const actionIndex = expectNonnegativeSafeInteger(record.actionIndex, `${recordPath}.actionIndex`);
		if (actionIndex !== actionIndices[position]) {
			throw new Error(`${recordPath}.actionIndex does not match actionIndices order`);
		}
		const irInstructionCount = expectNonnegativeSafeInteger(
			record.irInstructionCount,
			`${recordPath}.irInstructionCount`,
		);
		const deltaFromPrevious = expectSafeInteger(record.deltaFromPrevious, `${recordPath}.deltaFromPrevious`);
		const expectedDelta = irInstructionCount - previousIr;
		if (!Number.isSafeInteger(expectedDelta) || deltaFromPrevious !== expectedDelta) {
			throw new Error(`${recordPath}.deltaFromPrevious does not equal the prefix IR change`);
		}
		const actionHadNoEffect = expectBoolean(record.actionHadNoEffect, `${recordPath}.actionHadNoEffect`);
		if (actionHadNoEffect && deltaFromPrevious !== 0) {
			throw new Error(`${recordPath}.actionHadNoEffect cannot accompany a nonzero IR delta`);
		}
		previousIr = irInstructionCount;
		telescopedDelta += deltaFromPrevious;
		if (!Number.isSafeInteger(telescopedDelta)) {
			throw new Error(`${path} delta sum is not a safe integer`);
		}
		return { index, action, actionIndex, irInstructionCount, deltaFromPrevious, actionHadNoEffect };
	});

	const telescopedFinalIr = initialIrInstructionCount + telescopedDelta;
	if (!Number.isSafeInteger(telescopedFinalIr) || telescopedFinalIr !== previousIr) {
		throw new Error(`${path} deltas do not telescope to the final prefix IR`);
	}
	if (telescopedFinalIr !== shadowFinal.irInstructionCount) {
		throw new Error(`${path} final prefix IR does not equal shadow.final.irInstructionCount`);
	}
	return { initialIrInstructionCount, records };
}

function parseQualificationCase(value: unknown, position: number): CompilerGymActionTraceQualificationCase {
	const path = `input.cases[${position}]`;
	const record = expectRecord(value, path);
	expectExactKeys(
		record,
		[
			"caseId",
			"candidateId",
			"candidateSha256",
			"benchmarkId",
			"actions",
			"actionIndices",
			"authoritative",
			"shadow",
		],
		path,
	);
	const caseId = expectNonemptyString(record.caseId, `${path}.caseId`);
	const candidateId = expectNonemptyString(record.candidateId, `${path}.candidateId`);
	const candidateSha256 = expectNonemptyString(record.candidateSha256, `${path}.candidateSha256`);
	if (!/^[0-9a-f]{64}$/.test(candidateSha256)) {
		throw new Error(`${path}.candidateSha256 must be a lowercase SHA-256 digest`);
	}
	const benchmarkId = expectNonemptyString(record.benchmarkId, `${path}.benchmarkId`);
	const actions = parseActions(record.actions, `${path}.actions`);
	const actionIndices = parseActionIndices(record.actionIndices, `${path}.actionIndices`);
	if (actionIndices.length !== actions.length) {
		throw new Error(`${path}.actionIndices length must equal actions length`);
	}

	const authoritative = expectRecord(record.authoritative, `${path}.authoritative`);
	expectExactKeys(authoritative, ["final", "intrinsicRuntimeMs"], `${path}.authoritative`);
	const authoritativeFinal = parseFinalMetrics(authoritative.final, `${path}.authoritative.final`);
	const authoritativeIntrinsicRuntimeMs = expectPositiveFinite(
		authoritative.intrinsicRuntimeMs,
		`${path}.authoritative.intrinsicRuntimeMs`,
	);
	const shadow = expectRecord(record.shadow, `${path}.shadow`);
	expectExactKeys(shadow, ["final", "intrinsicRuntimeMs", "trace"], `${path}.shadow`);
	const shadowFinal = parseFinalMetrics(shadow.final, `${path}.shadow.final`);
	const shadowIntrinsicRuntimeMs = expectPositiveFinite(
		shadow.intrinsicRuntimeMs,
		`${path}.shadow.intrinsicRuntimeMs`,
	);
	const trace = parseTrace(shadow.trace, actions, actionIndices, shadowFinal, `${path}.shadow.trace`);

	return {
		caseId,
		candidateId,
		candidateSha256,
		benchmarkId,
		actions,
		actionIndices,
		authoritative: {
			final: authoritativeFinal,
			intrinsicRuntimeMs: authoritativeIntrinsicRuntimeMs,
		},
		shadow: { final: shadowFinal, intrinsicRuntimeMs: shadowIntrinsicRuntimeMs, trace },
	};
}

export function parseCompilerGymActionTraceQualificationInput(
	value: unknown,
): CompilerGymActionTraceQualificationInput {
	const input = expectRecord(value, "input");
	expectExactKeys(input, ["protocol", "cases", "visibility"], "input");
	if (input.protocol !== COMPILER_GYM_ACTION_TRACE_PROTOCOL) {
		throw new Error(`input.protocol must equal ${COMPILER_GYM_ACTION_TRACE_PROTOCOL}`);
	}
	if (!Array.isArray(input.cases) || input.cases.length === 0) {
		throw new Error("input.cases must be a nonempty array");
	}
	const cases = input.cases.map(parseQualificationCase);
	const caseIds = new Set<string>();
	for (const record of cases) {
		if (caseIds.has(record.caseId)) throw new Error(`input.cases has duplicate caseId ${record.caseId}`);
		caseIds.add(record.caseId);
	}
	const visibility = parseVisibilityEvidence(input.visibility, cases);
	return { protocol: COMPILER_GYM_ACTION_TRACE_PROTOCOL, cases, visibility };
}

export function buildCompilerGymActionTraceProjection(trace: CompilerGymActionTrace): CompilerGymActionTraceProjection {
	return {
		initialIrInstructionCount: trace.initialIrInstructionCount,
		irDeltas: trace.records.map((record) => record.deltaFromPrevious),
		noEffectBits: trace.records.map((record) => (record.actionHadNoEffect ? "1" : "0")).join(""),
	};
}

export function buildCompilerGymActionTraceTreatmentEnvelopes(
	cases: readonly CompilerGymActionTraceQualificationCase[],
): CompilerGymActionTraceTreatmentEnvelope[] {
	const grouped = new Map<string, CompilerGymActionTraceQualificationCase[]>();
	for (const record of cases) {
		const key = `${record.candidateId}:${record.candidateSha256}`;
		const existing = grouped.get(key) ?? [];
		existing.push(record);
		grouped.set(key, existing);
	}
	return [...grouped.values()].map((records) => {
		const first = records[0];
		if (!first) throw new Error("Treatment envelope candidate group is empty");
		const stockTaskOrder = new Map<string, number>(STOCK_CPU_TASKS.map((benchmarkId, index) => [benchmarkId, index]));
		const orderedRecords = [...records].sort(
			(left, right) =>
				(stockTaskOrder.get(left.benchmarkId) ?? Number.MAX_SAFE_INTEGER) -
				(stockTaskOrder.get(right.benchmarkId) ?? Number.MAX_SAFE_INTEGER),
		);
		if (orderedRecords.some((record) => !stockTaskOrder.has(record.benchmarkId))) {
			throw new Error("Treatment envelope contains a benchmark outside the frozen stock task order");
		}
		return {
			type: "compiler_gym_action_trace_feedback",
			protocol: COMPILER_GYM_ACTION_TRACE_TREATMENT_ENVELOPE_PROTOCOL,
			candidateId: first.candidateId,
			candidateSha256: first.candidateSha256,
			tasks: orderedRecords.map((record) => ({
				benchmarkId: record.benchmarkId,
				prefixConditional: true,
				intermediateSemanticStatus: "unverified",
				terminalSemanticStatus: "authoritative-final-verifier-only",
				noEffectMeaning: "llvm-pass-manager-reported-no-module-modification",
				trace: buildCompilerGymActionTraceProjection(record.shadow.trace),
			})),
		};
	});
}

function parseVisibilityEvidence(
	value: unknown,
	cases: readonly CompilerGymActionTraceQualificationCase[],
): CompilerGymActionTraceVisibilityEvidence {
	const path = "input.visibility";
	const record = expectRecord(value, path);
	expectExactKeys(record, ["protocol", "rendererProtocol", "candidates"], path);
	if (record.protocol !== COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL) {
		throw new Error(`${path}.protocol must equal ${COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL}`);
	}
	const rendererProtocol = expectNonemptyString(record.rendererProtocol, `${path}.rendererProtocol`);
	if (rendererProtocol !== "prime-native-ipython-json-value-v1") {
		throw new Error(`${path}.rendererProtocol is not the frozen native renderer`);
	}
	if (!Array.isArray(record.candidates) || record.candidates.length === 0) {
		throw new Error(`${path}.candidates must be a nonempty array`);
	}
	const expectedEnvelopes = buildCompilerGymActionTraceTreatmentEnvelopes(cases);
	if (record.candidates.length !== expectedEnvelopes.length) {
		throw new Error(`${path}.candidates must contain one record per candidate envelope`);
	}
	const candidates = record.candidates.map((value, index) => {
		const candidatePath = `${path}.candidates[${index}]`;
		const candidate = expectRecord(value, candidatePath);
		expectExactKeys(
			candidate,
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
		const expectedEnvelope = expectedEnvelopes[index];
		if (!expectedEnvelope) throw new Error(`${candidatePath} has no expected treatment envelope`);
		const candidateId = expectNonemptyString(candidate.candidateId, `${candidatePath}.candidateId`);
		const candidateSha256 = expectNonemptyString(candidate.candidateSha256, `${candidatePath}.candidateSha256`);
		if (candidateId !== expectedEnvelope.candidateId || candidateSha256 !== expectedEnvelope.candidateSha256) {
			throw new Error(`${candidatePath} does not bind the expected candidate`);
		}
		const benchmarkIds = parseActions(candidate.benchmarkIds, `${candidatePath}.benchmarkIds`);
		if (JSON.stringify(benchmarkIds) !== JSON.stringify(expectedEnvelope.tasks.map((task) => task.benchmarkId))) {
			throw new Error(`${candidatePath}.benchmarkIds do not bind the treatment tasks`);
		}
		const digest = (field: string): string => {
			const observed = expectNonemptyString(candidate[field], `${candidatePath}.${field}`);
			if (!/^[0-9a-f]{64}$/.test(observed)) throw new Error(`${candidatePath}.${field} must be SHA-256`);
			return observed;
		};
		const controlEnvelopeJson = expectNonemptyString(
			candidate.controlEnvelopeJson,
			`${candidatePath}.controlEnvelopeJson`,
		);
		const controlEnvelope = expectRecord(
			JSON.parse(controlEnvelopeJson) as unknown,
			`${candidatePath}.controlEnvelopeJson`,
		);
		const typedTraceEnvelopeJson = expectNonemptyString(
			candidate.typedTraceEnvelopeJson,
			`${candidatePath}.typedTraceEnvelopeJson`,
		);
		const typedTraceEnvelope = expectRecord(
			JSON.parse(typedTraceEnvelopeJson) as unknown,
			`${candidatePath}.typedTraceEnvelopeJson`,
		);
		if (JSON.stringify(typedTraceEnvelope) !== JSON.stringify(expectedEnvelope)) {
			throw new Error(`${candidatePath}.typedTraceEnvelopeJson does not bind the typed envelope`);
		}
		const combinedTreatmentEnvelopeJson = expectNonemptyString(
			candidate.combinedTreatmentEnvelopeJson,
			`${candidatePath}.combinedTreatmentEnvelopeJson`,
		);
		const combinedTreatmentEnvelope = expectRecord(
			JSON.parse(combinedTreatmentEnvelopeJson) as unknown,
			`${candidatePath}.combinedTreatmentEnvelopeJson`,
		);
		if (JSON.stringify(combinedTreatmentEnvelope.actionTrace) !== JSON.stringify(expectedEnvelope)) {
			throw new Error(`${candidatePath}.combinedTreatmentEnvelopeJson does not bind its actionTrace field`);
		}
		const combinedControl = structuredClone(combinedTreatmentEnvelope);
		delete combinedControl.actionTrace;
		if (JSON.stringify(combinedControl) !== JSON.stringify(controlEnvelope)) {
			throw new Error(`${candidatePath} control and combined treatment envelopes differ outside actionTrace`);
		}
		const typedTraceEnvelopeSha256 = digest("typedTraceEnvelopeSha256");
		if (
			typedTraceEnvelopeSha256 !== sha256Text(typedTraceEnvelopeJson) ||
			typedTraceEnvelopeSha256 !== sha256Text(JSON.stringify(expectedEnvelope))
		) {
			throw new Error(`${candidatePath}.typedTraceEnvelopeSha256 does not bind the typed envelope`);
		}
		const controlEnvelopeSha256 = digest("controlEnvelopeSha256");
		if (controlEnvelopeSha256 !== sha256Text(controlEnvelopeJson)) {
			throw new Error(`${candidatePath}.controlEnvelopeSha256 does not bind its JSON`);
		}
		const combinedTreatmentEnvelopeSha256 = digest("combinedTreatmentEnvelopeSha256");
		if (combinedTreatmentEnvelopeSha256 !== sha256Text(combinedTreatmentEnvelopeJson)) {
			throw new Error(`${candidatePath}.combinedTreatmentEnvelopeSha256 does not bind its JSON`);
		}
		const controlRenderedText = expectNonemptyString(
			candidate.controlRenderedText,
			`${candidatePath}.controlRenderedText`,
		);
		const combinedTreatmentRenderedText = expectNonemptyString(
			candidate.combinedTreatmentRenderedText,
			`${candidatePath}.combinedTreatmentRenderedText`,
		);
		const controlRenderedTextSha256 = digest("controlRenderedTextSha256");
		const combinedTreatmentRenderedTextSha256 = digest("combinedTreatmentRenderedTextSha256");
		if (
			controlRenderedTextSha256 !== sha256Text(controlRenderedText) ||
			combinedTreatmentRenderedTextSha256 !== sha256Text(combinedTreatmentRenderedText)
		) {
			throw new Error(`${candidatePath} rendered-text hashes do not bind their exact text`);
		}
		const controlProjectedAgentFacingBytes = expectNonnegativeSafeInteger(
			candidate.controlProjectedAgentFacingBytes,
			`${candidatePath}.controlProjectedAgentFacingBytes`,
		);
		const combinedTreatmentProjectedAgentFacingBytes = expectNonnegativeSafeInteger(
			candidate.combinedTreatmentProjectedAgentFacingBytes,
			`${candidatePath}.combinedTreatmentProjectedAgentFacingBytes`,
		);
		if (
			controlProjectedAgentFacingBytes === 0 ||
			combinedTreatmentProjectedAgentFacingBytes <= controlProjectedAgentFacingBytes
		) {
			throw new Error(`${candidatePath} rendered byte counts must be positive`);
		}
		if (
			controlProjectedAgentFacingBytes !== Buffer.byteLength(controlRenderedText, "utf8") ||
			combinedTreatmentProjectedAgentFacingBytes !== Buffer.byteLength(combinedTreatmentRenderedText, "utf8")
		) {
			throw new Error(`${candidatePath} rendered byte counts do not match their exact text`);
		}
		return {
			candidateId,
			candidateSha256,
			benchmarkIds,
			controlEnvelopeJson,
			controlEnvelopeSha256,
			controlRenderedText,
			controlRenderedTextSha256,
			controlProjectedAgentFacingBytes,
			typedTraceEnvelopeJson,
			typedTraceEnvelopeSha256,
			combinedTreatmentEnvelopeJson,
			combinedTreatmentEnvelopeSha256,
			combinedTreatmentRenderedText,
			combinedTreatmentRenderedTextSha256,
			combinedTreatmentProjectedAgentFacingBytes,
		};
	});
	return {
		protocol: COMPILER_GYM_ACTION_TRACE_VISIBILITY_PROTOCOL,
		rendererProtocol,
		candidates,
	};
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function finalMetricMismatches(
	authoritative: CompilerGymActionTraceFinalMetrics,
	shadow: CompilerGymActionTraceFinalMetrics,
): CompilerGymActionTraceFinalMetricField[] {
	const fields: CompilerGymActionTraceFinalMetricField[] = [];
	if (authoritative.irInstructionCount !== shadow.irInstructionCount) fields.push("irInstructionCount");
	if (authoritative.objectTextSizeBytes !== shadow.objectTextSizeBytes) fields.push("objectTextSizeBytes");
	if (authoritative.verifierPassed !== true || shadow.verifierPassed !== true) fields.push("verifierPassed");
	return fields;
}

export function assessCompilerGymActionTraceQualification(value: unknown): CompilerGymActionTraceAssessment {
	const input = parseCompilerGymActionTraceQualificationInput(value);
	const mismatches = input.cases.flatMap((record): CompilerGymActionTraceEquivalenceMismatch[] => {
		const fields = finalMetricMismatches(record.authoritative.final, record.shadow.final);
		return fields.length === 0 ? [] : [{ caseId: record.caseId, fields }];
	});

	const overheadPerCase = input.cases.map((record) => {
		const ratio = record.shadow.intrinsicRuntimeMs / record.authoritative.intrinsicRuntimeMs;
		return {
			caseId: record.caseId,
			authoritativeIntrinsicRuntimeMs: record.authoritative.intrinsicRuntimeMs,
			shadowIntrinsicRuntimeMs: record.shadow.intrinsicRuntimeMs,
			ratio,
			passed: ratio <= COMPILER_GYM_ACTION_TRACE_PER_CASE_OVERHEAD_LIMIT,
		};
	});
	const overheadRatios = overheadPerCase.map((record) => record.ratio);
	const medianRatio = median(overheadRatios);
	const maximumRatio = Math.max(...overheadRatios);
	const medianPassed = medianRatio <= COMPILER_GYM_ACTION_TRACE_MEDIAN_OVERHEAD_LIMIT;
	const everyCasePassed = overheadPerCase.every((record) => record.passed);

	const projectionValues = input.cases.map((record) => buildCompilerGymActionTraceProjection(record.shadow.trace));
	const treatmentEnvelopes = buildCompilerGymActionTraceTreatmentEnvelopes(input.cases);
	const perCandidateBytes = input.visibility.candidates.map((candidate) => {
		const incrementalBytes =
			candidate.combinedTreatmentProjectedAgentFacingBytes - candidate.controlProjectedAgentFacingBytes;
		const ratio = incrementalBytes / candidate.controlProjectedAgentFacingBytes;
		return {
			candidateId: candidate.candidateId,
			controlBytes: candidate.controlProjectedAgentFacingBytes,
			combinedTreatmentBytes: candidate.combinedTreatmentProjectedAgentFacingBytes,
			incrementalBytes,
			ratio,
			passed: incrementalBytes * 4 <= candidate.controlProjectedAgentFacingBytes,
		};
	});
	const serializedBytes = perCandidateBytes.reduce((total, record) => total + record.incrementalBytes, 0);
	const controlAgentFacingBytes = perCandidateBytes.reduce((total, record) => total + record.controlBytes, 0);
	if (!Number.isSafeInteger(controlAgentFacingBytes)) {
		throw new Error("input.visibility control agent-facing byte sum is not a safe integer");
	}
	if (!Number.isSafeInteger(serializedBytes)) {
		throw new Error("input.visibility treatment model-visible byte sum is not a safe integer");
	}
	const projectionRatio = serializedBytes / controlAgentFacingBytes;
	const aggregateRatioPassed = serializedBytes * 4 <= controlAgentFacingBytes;
	const everyCandidateRatioPassed = perCandidateBytes.every((record) => record.passed);
	const ratioPassed = aggregateRatioPassed && everyCandidateRatioPassed;
	const byteLimitPassed = serializedBytes <= COMPILER_GYM_ACTION_TRACE_PROJECTION_BYTE_LIMIT;
	const equivalencePassed = mismatches.length === 0;
	const overheadPassed = medianPassed && everyCasePassed;
	const projectionPassed = ratioPassed && byteLimitPassed;
	const passed = equivalencePassed && overheadPassed && projectionPassed;

	return {
		protocol: COMPILER_GYM_ACTION_TRACE_PROTOCOL,
		caseCount: input.cases.length,
		equivalence: { passed: equivalencePassed, mismatches },
		overhead: {
			perCase: overheadPerCase,
			medianRatio,
			maximumRatio,
			medianLimit: COMPILER_GYM_ACTION_TRACE_MEDIAN_OVERHEAD_LIMIT,
			perCaseLimit: COMPILER_GYM_ACTION_TRACE_PER_CASE_OVERHEAD_LIMIT,
			medianPassed,
			everyCasePassed,
			passed: overheadPassed,
		},
		projection: {
			values: projectionValues,
			treatmentEnvelopes,
			perCandidateBytes,
			serializedBytes,
			controlAgentFacingBytes,
			ratio: projectionRatio,
			ratioLimit: COMPILER_GYM_ACTION_TRACE_PROJECTION_RATIO_LIMIT,
			byteLimit: COMPILER_GYM_ACTION_TRACE_PROJECTION_BYTE_LIMIT,
			ratioPassed,
			aggregateRatioPassed,
			everyCandidateRatioPassed,
			byteLimitPassed,
			passed: projectionPassed,
		},
		decision: passed ? "qualify-agent-facing-trace-screen" : "kill-action-trace",
	};
}

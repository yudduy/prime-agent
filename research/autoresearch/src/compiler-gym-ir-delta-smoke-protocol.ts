export const COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL = "compiler-gym-one-env-ir-delta-cost-smoke-v1" as const;
export const COMPILER_GYM_IR_DELTA_SMOKE_MEDIAN_RATIO_LIMIT = 1.12 as const;
export const COMPILER_GYM_IR_DELTA_SMOKE_PER_BLOCK_RATIO_LIMIT = 1.25 as const;
export const COMPILER_GYM_IR_DELTA_TRACE_CONTRACT = "compiler-gym-single-environment-ir-delta-trace-v1" as const;
export const COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS =
	"A zero delta means only that the observed IrInstructionCount was unchanged across this action; it does not imply that LLVM IR, module state, or program semantics were unchanged." as const;

export interface CompilerGymIrDeltaFinalMetrics {
	irInstructionCount: number;
	objectTextSizeBytes: number;
	verifierPassed: true;
}

export interface CompilerGymIrDeltaTraceRecord {
	index: number;
	action: string;
	actionIndex: number;
	deltaFromPrevious: number;
}

export interface CompilerGymIrDeltaTrace {
	initialIrInstructionCount: number;
	records: CompilerGymIrDeltaTraceRecord[];
}

export interface CompilerGymIrDeltaArmObservation {
	initialIrInstructionCount: number;
	actionIndices: number[];
	commandline: string;
	final: CompilerGymIrDeltaFinalMetrics;
	intrinsicTotalMs: number;
}

export interface CompilerGymIrDeltaSmokeBlock {
	blockId: "r1" | "r2";
	candidateId: string;
	candidateSha256: string;
	benchmarkId: string;
	actions: string[];
	canonical: CompilerGymIrDeltaArmObservation;
	treatment: CompilerGymIrDeltaArmObservation & { trace: CompilerGymIrDeltaTrace };
}

export interface CompilerGymIrDeltaSmokeInput {
	protocol: typeof COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL;
	blocks: CompilerGymIrDeltaSmokeBlock[];
}

export interface CompilerGymIrDeltaSmokeAssessment {
	protocol: typeof COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL;
	scope: "cost-and-equivalence-screen-only";
	blockCount: 2;
	equivalence: {
		passed: boolean;
		mismatches: Array<{ blockId: "r1" | "r2"; fields: string[] }>;
	};
	overhead: {
		perBlock: Array<{
			blockId: "r1" | "r2";
			canonicalIntrinsicTotalMs: number;
			treatmentIntrinsicTotalMs: number;
			ratio: number;
			passed: boolean;
		}>;
		medianRatio: number;
		maximumRatio: number;
		medianLimit: typeof COMPILER_GYM_IR_DELTA_SMOKE_MEDIAN_RATIO_LIMIT;
		perBlockLimit: typeof COMPILER_GYM_IR_DELTA_SMOKE_PER_BLOCK_RATIO_LIMIT;
		passed: boolean;
	};
	decision: "promote-to-full-ir-delta-qualification" | "kill-current-one-env-ir-delta-evaluator";
	nextGate: "eight-fresh-allocation-model-free-ir-delta-qualification" | null;
	lunaAuthorized: false;
	measurementReuseAllowed: false;
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
		throw new Error(`${path} keys mismatch`);
	}
}

function nonemptyString(value: unknown, path: string): string {
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
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new Error(`${path} must be a safe integer`);
	}
	return value;
}

function positiveNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${path} must be finite and positive`);
	}
	return value;
}

function stringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
		throw new Error(`${path} must be a nonempty-string array`);
	}
	return [...value];
}

function integerArray(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value.map((item, index) => nonnegativeInteger(item, `${path}[${index}]`));
}

function finalMetrics(value: unknown, path: string): CompilerGymIrDeltaFinalMetrics {
	const parsed = record(value, path);
	exactKeys(parsed, ["irInstructionCount", "objectTextSizeBytes", "verifierPassed"], path);
	if (parsed.verifierPassed !== true) throw new Error(`${path}.verifierPassed must be true`);
	return {
		irInstructionCount: nonnegativeInteger(parsed.irInstructionCount, `${path}.irInstructionCount`),
		objectTextSizeBytes: nonnegativeInteger(parsed.objectTextSizeBytes, `${path}.objectTextSizeBytes`),
		verifierPassed: true,
	};
}

function arm(value: unknown, path: string): CompilerGymIrDeltaArmObservation {
	const parsed = record(value, path);
	exactKeys(parsed, ["initialIrInstructionCount", "actionIndices", "commandline", "final", "intrinsicTotalMs"], path);
	return {
		initialIrInstructionCount: nonnegativeInteger(
			parsed.initialIrInstructionCount,
			`${path}.initialIrInstructionCount`,
		),
		actionIndices: integerArray(parsed.actionIndices, `${path}.actionIndices`),
		commandline: nonemptyString(parsed.commandline, `${path}.commandline`),
		final: finalMetrics(parsed.final, `${path}.final`),
		intrinsicTotalMs: positiveNumber(parsed.intrinsicTotalMs, `${path}.intrinsicTotalMs`),
	};
}

function trace(
	value: unknown,
	actions: readonly string[],
	actionIndices: readonly number[],
	terminalIr: number,
	path: string,
): CompilerGymIrDeltaTrace {
	const parsed = record(value, path);
	exactKeys(parsed, ["initialIrInstructionCount", "records"], path);
	const initialIrInstructionCount = nonnegativeInteger(
		parsed.initialIrInstructionCount,
		`${path}.initialIrInstructionCount`,
	);
	if (!Array.isArray(parsed.records) || parsed.records.length !== actions.length) {
		throw new Error(`${path}.records length must equal the action count`);
	}
	let deltaSum = 0;
	const records = parsed.records.map((value, index): CompilerGymIrDeltaTraceRecord => {
		const recordPath = `${path}.records[${index}]`;
		const item = record(value, recordPath);
		exactKeys(item, ["index", "action", "actionIndex", "deltaFromPrevious"], recordPath);
		const observedIndex = nonnegativeInteger(item.index, `${recordPath}.index`);
		if (observedIndex !== index) throw new Error(`${recordPath}.index is out of order`);
		const action = nonemptyString(item.action, `${recordPath}.action`);
		if (action !== actions[index]) throw new Error(`${recordPath}.action does not match the request`);
		const actionIndex = nonnegativeInteger(item.actionIndex, `${recordPath}.actionIndex`);
		if (actionIndex !== actionIndices[index]) throw new Error(`${recordPath}.actionIndex does not match the request`);
		const deltaFromPrevious = safeInteger(item.deltaFromPrevious, `${recordPath}.deltaFromPrevious`);
		deltaSum += deltaFromPrevious;
		if (!Number.isSafeInteger(deltaSum)) throw new Error(`${path} delta sum is not a safe integer`);
		return { index: observedIndex, action, actionIndex, deltaFromPrevious };
	});
	if (initialIrInstructionCount + deltaSum !== terminalIr) {
		throw new Error(`${path} deltas do not telescope to terminal IR`);
	}
	return { initialIrInstructionCount, records };
}

function parseBlock(value: unknown, index: number): CompilerGymIrDeltaSmokeBlock {
	const path = `input.blocks[${index}]`;
	const parsed = record(value, path);
	exactKeys(
		parsed,
		["blockId", "candidateId", "candidateSha256", "benchmarkId", "actions", "canonical", "treatment"],
		path,
	);
	if (parsed.blockId !== "r1" && parsed.blockId !== "r2") throw new Error(`${path}.blockId must be r1 or r2`);
	const candidateSha256 = nonemptyString(parsed.candidateSha256, `${path}.candidateSha256`);
	if (!/^[0-9a-f]{64}$/.test(candidateSha256)) throw new Error(`${path}.candidateSha256 must be SHA-256`);
	const actions = stringArray(parsed.actions, `${path}.actions`);
	const canonical = arm(parsed.canonical, `${path}.canonical`);
	const treatmentRaw = record(parsed.treatment, `${path}.treatment`);
	exactKeys(
		treatmentRaw,
		["initialIrInstructionCount", "actionIndices", "commandline", "final", "intrinsicTotalMs", "trace"],
		`${path}.treatment`,
	);
	const { trace: rawTrace, ...treatmentArm } = treatmentRaw;
	const treatment = arm(treatmentArm, `${path}.treatment`);
	if (canonical.actionIndices.length !== actions.length || treatment.actionIndices.length !== actions.length) {
		throw new Error(`${path} action-index counts must equal the action count`);
	}
	const parsedTrace = trace(
		rawTrace,
		actions,
		treatment.actionIndices,
		treatment.final.irInstructionCount,
		`${path}.treatment.trace`,
	);
	if (parsedTrace.initialIrInstructionCount !== treatment.initialIrInstructionCount) {
		throw new Error(`${path}.treatment trace initial IR differs from the treatment result`);
	}
	return {
		blockId: parsed.blockId,
		candidateId: nonemptyString(parsed.candidateId, `${path}.candidateId`),
		candidateSha256,
		benchmarkId: nonemptyString(parsed.benchmarkId, `${path}.benchmarkId`),
		actions,
		canonical,
		treatment: { ...treatment, trace: parsedTrace },
	};
}

export function parseCompilerGymIrDeltaSmokeInput(value: unknown): CompilerGymIrDeltaSmokeInput {
	const parsed = record(value, "input");
	exactKeys(parsed, ["protocol", "blocks"], "input");
	if (parsed.protocol !== COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL) throw new Error("Unexpected smoke protocol");
	if (!Array.isArray(parsed.blocks) || parsed.blocks.length !== 2)
		throw new Error("Smoke requires exactly two blocks");
	const blocks = parsed.blocks.map(parseBlock);
	if (blocks[0]?.blockId !== "r1" || blocks[1]?.blockId !== "r2") {
		throw new Error("Smoke blocks must be ordered r1 then r2");
	}
	return { protocol: COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL, blocks };
}

function equalArray(left: readonly unknown[], right: readonly unknown[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function assessCompilerGymIrDeltaSmoke(value: unknown): CompilerGymIrDeltaSmokeAssessment {
	const input = parseCompilerGymIrDeltaSmokeInput(value);
	const mismatches = input.blocks.flatMap((block) => {
		const fields: string[] = [];
		if (block.canonical.initialIrInstructionCount !== block.treatment.initialIrInstructionCount)
			fields.push("initialIrInstructionCount");
		if (!equalArray(block.canonical.actionIndices, block.treatment.actionIndices)) fields.push("actionIndices");
		if (block.canonical.commandline !== block.treatment.commandline) fields.push("commandline");
		if (block.canonical.final.irInstructionCount !== block.treatment.final.irInstructionCount)
			fields.push("irInstructionCount");
		if (block.canonical.final.objectTextSizeBytes !== block.treatment.final.objectTextSizeBytes)
			fields.push("objectTextSizeBytes");
		return fields.length === 0 ? [] : [{ blockId: block.blockId, fields }];
	});
	const perBlock = input.blocks.map((block) => {
		const ratio = block.treatment.intrinsicTotalMs / block.canonical.intrinsicTotalMs;
		return {
			blockId: block.blockId,
			canonicalIntrinsicTotalMs: block.canonical.intrinsicTotalMs,
			treatmentIntrinsicTotalMs: block.treatment.intrinsicTotalMs,
			ratio,
			passed: ratio <= COMPILER_GYM_IR_DELTA_SMOKE_PER_BLOCK_RATIO_LIMIT,
		};
	});
	const medianRatio = (perBlock[0].ratio + perBlock[1].ratio) / 2;
	const maximumRatio = Math.max(...perBlock.map((item) => item.ratio));
	const overheadPassed =
		medianRatio <= COMPILER_GYM_IR_DELTA_SMOKE_MEDIAN_RATIO_LIMIT && perBlock.every((item) => item.passed);
	const passed = mismatches.length === 0 && overheadPassed;
	return {
		protocol: COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL,
		scope: "cost-and-equivalence-screen-only",
		blockCount: 2,
		equivalence: { passed: mismatches.length === 0, mismatches },
		overhead: {
			perBlock,
			medianRatio,
			maximumRatio,
			medianLimit: COMPILER_GYM_IR_DELTA_SMOKE_MEDIAN_RATIO_LIMIT,
			perBlockLimit: COMPILER_GYM_IR_DELTA_SMOKE_PER_BLOCK_RATIO_LIMIT,
			passed: overheadPassed,
		},
		decision: passed ? "promote-to-full-ir-delta-qualification" : "kill-current-one-env-ir-delta-evaluator",
		nextGate: passed ? "eight-fresh-allocation-model-free-ir-delta-qualification" : null,
		lunaAuthorized: false,
		measurementReuseAllowed: false,
	};
}

import { sha256Json, sha256Text } from "./canonical-json.js";
import {
	COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256,
	parseAuthoritativeLlvmFlags,
} from "./compiler-gym-complete-action-space-headroom.js";
import {
	parseStockCpuEvaluationRequest,
	STOCK_CPU_TASKS,
	type StockCpuEvaluationRequest,
} from "./stock-cpu-protocol.js";
import {
	createStockInterfaceParityEvaluationSchema,
	STOCK_INTERFACE_PARITY_ACTION_GUIDE,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
} from "./stock-interface-parity-protocol.js";

export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL =
	"compiler-gym-action-guide-visibility-first-proposal-paid-pair-v1" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID =
	"compiler-gym-action-guide-visibility-first-proposal-paid-pair-v1" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS = [
	"stock-26-guide-control",
	"stock-124-guide-treatment",
] as const;
export type CompilerGymActionSpaceVisibilityArm = (typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS)[number];

export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM = COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[0];
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM = COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[1];
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS = 256 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM = 1 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_PROVIDER_CALLS = 2 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_TASKS_PER_CANDIDATE = 2 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_TASK_EVALUATIONS = 4 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_SENTINEL = "<<LLVM_ACTION_GUIDE>>" as const;

export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_ALLOWED_FLAGS_SHA256 =
	COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_FLAGS_SHA256 =
	COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256 =
	COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_FLAGS_SHA256 =
	"58965755dc055027a963c9e0071b47c818ca25a8344ed0c977a9894db2467740" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_GUIDE_BYTES = 357 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_GUIDE_BYTES = 2_048 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_DELTA_BYTES = 1_691 as const;

const CONTROL_FLAG_COUNT = 26;
const OMITTED_FLAG_COUNT = 98;
const ALLOWED_FLAG_COUNT = 124;
const BLOWFISH_EMPTY_IR = 3_898;
const BZIP2_EMPTY_IR = 28_748;

export const CompilerGymActionSpaceVisibilityEvaluationSchema = createStockInterfaceParityEvaluationSchema({
	minItems: 1,
	maxItems: COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS,
});

export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL = {
	name: STOCK_INTERFACE_PARITY_TOOL_NAME,
	description:
		"Submit one LLVM pass sequence, wait for immutable verification, and return its complete terminal two-task measurement.",
	parameters: CompilerGymActionSpaceVisibilityEvaluationSchema,
} as const;

export interface CompilerGymActionSpaceVisibilityGuides {
	allowedFlags: string[];
	controlFlags: string[];
	omittedFlags: string[];
	treatmentFlags: string[];
	controlGuide: string;
	treatmentGuide: string;
}

export interface CompilerGymActionSpaceVisibilityPrompts {
	byArm: Record<CompilerGymActionSpaceVisibilityArm, string>;
	guideByArm: Record<CompilerGymActionSpaceVisibilityArm, string>;
	normalized: string;
	normalizedSha256: string;
	promptSha256ByArm: Record<CompilerGymActionSpaceVisibilityArm, string>;
	guideBytesByArm: Record<CompilerGymActionSpaceVisibilityArm, number>;
	guideDeltaBytes: number;
}

function exactUniqueFlags(
	value: readonly string[],
	expectedCount: number,
	expectedSha256: string,
	label: string,
): void {
	if (
		value.length !== expectedCount ||
		new Set(value).size !== expectedCount ||
		value.some((flag) => !/^-[a-z0-9][a-z0-9-]*$/.test(flag)) ||
		sha256Json(value) !== expectedSha256
	) {
		throw new Error(`${label} differs from its exact sealed LLVM flag inventory`);
	}
}

function exactSetEquality(left: readonly string[], right: readonly string[], label: string): void {
	const rightSet = new Set(right);
	if (left.length !== right.length || left.some((item) => !rightSet.has(item))) {
		throw new Error(`${label} does not preserve the authoritative LLVM action set`);
	}
}

export function reconstructCompilerGymActionSpaceVisibilityGuides(
	authoritativeEvaluatorContents: string,
): CompilerGymActionSpaceVisibilityGuides {
	const allowedFlags = parseAuthoritativeLlvmFlags(authoritativeEvaluatorContents);
	const controlFlags = [...STOCK_INTERFACE_PARITY_ACTION_GUIDE];
	exactUniqueFlags(
		allowedFlags,
		ALLOWED_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_ALLOWED_FLAGS_SHA256,
		"Authoritative action space",
	);
	exactUniqueFlags(
		controlFlags,
		CONTROL_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_FLAGS_SHA256,
		"Stock action guide",
	);
	const allowed = new Set(allowedFlags);
	if (controlFlags.some((flag) => !allowed.has(flag))) {
		throw new Error("Stock action guide contains a flag outside the authoritative action space");
	}
	const control = new Set<string>(controlFlags);
	const omittedFlags = allowedFlags.filter((flag) => !control.has(flag));
	const treatmentFlags = [...controlFlags, ...omittedFlags];
	exactUniqueFlags(
		omittedFlags,
		OMITTED_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256,
		"Omitted action complement",
	);
	exactUniqueFlags(
		treatmentFlags,
		ALLOWED_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_FLAGS_SHA256,
		"Treatment action guide",
	);
	if (controlFlags.some((flag, index) => treatmentFlags[index] !== flag)) {
		throw new Error("Treatment action guide does not retain the exact stock guide as its prefix");
	}
	exactSetEquality(treatmentFlags, allowedFlags, "Treatment action guide");
	const controlGuide = controlFlags.join(", ");
	const treatmentGuide = treatmentFlags.join(", ");
	const controlGuideBytes = Buffer.byteLength(buildGuideLine(controlGuide));
	const treatmentGuideBytes = Buffer.byteLength(buildGuideLine(treatmentGuide));
	if (
		controlGuideBytes !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_GUIDE_BYTES ||
		treatmentGuideBytes !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_GUIDE_BYTES ||
		treatmentGuideBytes - controlGuideBytes !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_DELTA_BYTES
	) {
		throw new Error("Action-guide byte contract drifted");
	}
	return { allowedFlags, controlFlags, omittedFlags, treatmentFlags, controlGuide, treatmentGuide };
}

function buildGuideLine(guide: string): string {
	return `Useful LLVM 10 flags include: ${guide}. Repetition and order are allowed.`;
}

const FORBIDDEN_NON_GUIDE_PATTERNS: readonly [RegExp, string][] = [
	[/benchmark:\/\/cbench-v1\/dijkstra/i, "held-out benchmark"],
	[/\bdijkstra\b/i, "held-out benchmark name"],
	[/complete[- ]action[- ]space/i, "prior headroom protocol"],
	[/\bheadroom\b/i, "prior headroom hypothesis"],
	[/\bscaffold\b/i, "prior evaluator scaffold"],
	[/\bwinning\b/i, "outcome label"],
	[/\bfull\b/i, "treatment cue"],
	[/\b292\b|\b260\b|\b269\b/, "prior outcome value"],
	[/73dc6ffb921da7a6e85b117f53be75252c3ece290bb0111b9efafaddf2213cd8/i, "prior artifact digest"],
	[/terminal-apparatus-invalid/i, "prior disposition"],
	[/compiler-gym-complete-action-space-headroom/i, "prior protocol ID"],
	[/2026-08-29-v2/i, "prior run ID"],
] as const;

function replaceExactlyOnce(value: string, search: string, replacement: string, label: string): string {
	if (!search || search === replacement) throw new Error(`${label} replacement is invalid`);
	const pieces = value.split(search);
	if (pieces.length !== 2) throw new Error(`${label} must occur exactly once`);
	if (value.includes(replacement)) throw new Error(`${label} input already contains its reserved sentinel`);
	return `${pieces[0]}${replacement}${pieces[1]}`;
}

export function assertNoCompilerGymActionSpaceVisibilityLeakage(normalizedPrompt: string): void {
	for (const [pattern, label] of FORBIDDEN_NON_GUIDE_PATTERNS) {
		if (pattern.test(normalizedPrompt)) throw new Error(`Visibility prompt leaks ${label}`);
	}
}

export function normalizeCompilerGymActionSpaceVisibilityPrompt(prompt: string, guide: string): string {
	const normalized = replaceExactlyOnce(
		prompt,
		buildGuideLine(guide),
		buildGuideLine(COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_SENTINEL),
		"Visibility action-guide line",
	);
	assertNoCompilerGymActionSpaceVisibilityLeakage(normalized);
	return normalized;
}

function commonPromptLines(guide: string): string[] {
	return [
		"Optimize two fixed CompilerGym/cBench programs by reducing raw LLVM IR instruction count while preserving all twenty semantic callbacks.",
		"This is one bounded first-proposal screen. Make exactly one tool call and wait for its terminal measurement.",
		`Call ${STOCK_INTERFACE_PARITY_TOOL_NAME} with exactly: {"actions": string[], "hypothesis": string, "mechanism": string, "predictedOutcome": string, "boundaryConditions": string[]}.`,
		`Tasks: ${JSON.stringify(STOCK_CPU_TASKS)}. Empty-pass calibration: ${JSON.stringify([
			{ benchmarkId: STOCK_CPU_TASKS[0], irInstructionCount: BLOWFISH_EMPTY_IR, objectTextSizeBytes: 16_573 },
			{ benchmarkId: STOCK_CPU_TASKS[1], irInstructionCount: BZIP2_EMPTY_IR, objectTextSizeBytes: 122_613 },
		])}.`,
		buildGuideLine(guide),
		`The actions array must contain between one and ${COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS} legal LLVM 10 passes.`,
		"A semantic rejection is durable negative evidence and consumes the sole candidate.",
		"Do not use web access, public optimization traces, RLM children, compaction, retries, measurement reuse, credentials, or files outside the empty workspace.",
		"The host fixes tasks, verifier, evaluator, fresh-measurement policy, budgets, and terminalization. A queued, predicted, or intermediate value is never verified evidence.",
		"The host closes the branch after the first terminal result. Do not attempt a second evaluation or emit a champion report.",
	];
}

export function buildCompilerGymActionSpaceVisibilityPrompt(guide: string): string {
	if (!guide.trim()) throw new Error("Visibility action guide must be nonempty");
	const prompt = commonPromptLines(guide).join("\n");
	normalizeCompilerGymActionSpaceVisibilityPrompt(prompt, guide);
	return prompt;
}

export function buildCompilerGymActionSpaceVisibilityPrompts(
	guides: CompilerGymActionSpaceVisibilityGuides,
): CompilerGymActionSpaceVisibilityPrompts {
	exactUniqueFlags(
		guides.controlFlags,
		CONTROL_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_FLAGS_SHA256,
		"Stock action guide",
	);
	exactUniqueFlags(
		guides.omittedFlags,
		OMITTED_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256,
		"Omitted action complement",
	);
	exactUniqueFlags(
		guides.treatmentFlags,
		ALLOWED_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_FLAGS_SHA256,
		"Treatment action guide",
	);
	if (
		guides.controlGuide !== guides.controlFlags.join(", ") ||
		guides.treatmentGuide !== guides.treatmentFlags.join(", ")
	) {
		throw new Error("Visibility guide serialization drifted");
	}
	const byArm = {
		[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]: buildCompilerGymActionSpaceVisibilityPrompt(
			guides.controlGuide,
		),
		[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM]: buildCompilerGymActionSpaceVisibilityPrompt(
			guides.treatmentGuide,
		),
	};
	const guideByArm = {
		[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]: guides.controlGuide,
		[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM]: guides.treatmentGuide,
	};
	const normalizedControl = normalizeCompilerGymActionSpaceVisibilityPrompt(
		byArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
		guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
	);
	const normalizedTreatment = normalizeCompilerGymActionSpaceVisibilityPrompt(
		byArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
		guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
	);
	if (normalizedControl !== normalizedTreatment) {
		throw new Error("Visibility prompts differ outside the exact action-guide line");
	}
	const controlBytes = Buffer.byteLength(buildGuideLine(guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]));
	const treatmentBytes = Buffer.byteLength(
		buildGuideLine(guideByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM]),
	);
	return {
		byArm,
		guideByArm,
		normalized: normalizedControl,
		normalizedSha256: sha256Text(normalizedControl),
		promptSha256ByArm: {
			[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]: sha256Text(
				byArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
			),
			[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM]: sha256Text(
				byArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
			),
		},
		guideBytesByArm: {
			[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]: controlBytes,
			[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM]: treatmentBytes,
		},
		guideDeltaBytes: treatmentBytes - controlBytes,
	};
}

function assertExactAllowedFlags(allowedFlags: readonly string[]): void {
	exactUniqueFlags(
		allowedFlags,
		ALLOWED_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_ALLOWED_FLAGS_SHA256,
		"Visibility request policy action space",
	);
}

export function assertCompilerGymActionSpaceVisibilityRequestPolicy(
	value: unknown,
	allowedFlags: readonly string[],
): StockCpuEvaluationRequest {
	assertExactAllowedFlags(allowedFlags);
	const request = parseStockCpuEvaluationRequest(value);
	if (request.actions.length < 1 || request.actions.length > COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS) {
		throw new Error("Visibility request must contain between one and 256 LLVM passes");
	}
	const allowed = new Set(allowedFlags);
	for (const action of request.actions) {
		if (!allowed.has(action)) throw new Error(`Visibility request contains an illegal LLVM pass: ${action}`);
	}
	return request;
}

export function assertCompilerGymActionSpaceVisibilityProviderCallOrdinal(providerDispatchOrdinal: number): 1 {
	if (providerDispatchOrdinal !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM) {
		throw new Error("Visibility arm permits exactly one provider dispatch");
	}
	return 1;
}

export interface CompilerGymActionSpaceVisibilityCandidate {
	actions: string[];
	outcome: "verified" | "complete-semantic-rejection";
	blowfishIr: number | null;
	bzip2Ir: number | null;
	verifierInputsCompleted: {
		blowfish: number;
		bzip2: number;
	};
}

export interface CompilerGymActionSpaceVisibilityExactRatio {
	numerator: string;
	denominator: string;
	bindingTask: "blowfish" | "bzip2";
}

export interface CompilerGymActionSpaceVisibilityPairAssessment {
	protocol: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL;
	controlVerified: boolean;
	treatmentVerified: boolean;
	controlOmittedFlags: string[];
	treatmentOmittedFlags: string[];
	treatmentUniqueOmittedFlags: string[];
	mechanismEngaged: boolean;
	treatmentStrictlyParetoDominates: boolean;
	controlStrictlyParetoDominates: boolean;
	exactTaskVectorTie: boolean;
	normalizedMinimax: {
		control: CompilerGymActionSpaceVisibilityExactRatio | null;
		treatment: CompilerGymActionSpaceVisibilityExactRatio | null;
		comparison: "treatment-lower" | "equal" | "control-lower" | "unavailable";
		diagnosticOnly: true;
	};
	decision: "directionally-promising-requires-fresh-replication" | "directional-loss" | "inconclusive";
	nextGate: "one-fresh-independent-four-call-cpu-replication" | "stop-visibility-v1";
	causalClaimAllowed: false;
	randomizedInferenceAllowed: false;
	tamperEvidentRandomAssignment: false;
	defaultPromotionAllowed: false;
	gpuPromotionAllowed: false;
	nanogptPromotionAllowed: false;
}

function positiveSafeInteger(value: number | null, label: string): number {
	if (value === null || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive safe integer`);
	}
	return value;
}

function validateCandidate(
	candidate: CompilerGymActionSpaceVisibilityCandidate,
	allowedFlags: readonly string[],
	label: string,
): { verified: boolean; blowfishIr: number | null; bzip2Ir: number | null } {
	assertCompilerGymActionSpaceVisibilityRequestPolicy(
		{
			actions: candidate.actions,
			hypothesis: "sealed assessment",
			mechanism: "sealed assessment",
			predictedOutcome: "sealed assessment",
			boundaryConditions: [],
		},
		allowedFlags,
	);
	if (candidate.verifierInputsCompleted.blowfish !== 20 || candidate.verifierInputsCompleted.bzip2 !== 20) {
		throw new Error(`${label} does not contain two complete twenty-callback verifier outcomes`);
	}
	if (candidate.outcome === "verified") {
		return {
			verified: true,
			blowfishIr: positiveSafeInteger(candidate.blowfishIr, `${label}.blowfishIr`),
			bzip2Ir: positiveSafeInteger(candidate.bzip2Ir, `${label}.bzip2Ir`),
		};
	}
	if (candidate.outcome !== "complete-semantic-rejection") throw new Error(`${label} outcome is invalid`);
	if (candidate.blowfishIr !== null || candidate.bzip2Ir !== null) {
		throw new Error(`${label} semantic rejection must not carry frontier metrics`);
	}
	return { verified: false, blowfishIr: null, bzip2Ir: null };
}

function exactMinimax(blowfishIr: number, bzip2Ir: number): CompilerGymActionSpaceVisibilityExactRatio {
	const blowfish = { numerator: BigInt(blowfishIr), denominator: BigInt(BLOWFISH_EMPTY_IR) };
	const bzip2 = { numerator: BigInt(bzip2Ir), denominator: BigInt(BZIP2_EMPTY_IR) };
	const blowfishIsMaximum = blowfish.numerator * bzip2.denominator >= bzip2.numerator * blowfish.denominator;
	const selected = blowfishIsMaximum ? blowfish : bzip2;
	return {
		numerator: selected.numerator.toString(10),
		denominator: selected.denominator.toString(10),
		bindingTask: blowfishIsMaximum ? "blowfish" : "bzip2",
	};
}

function compareExactRatios(
	left: CompilerGymActionSpaceVisibilityExactRatio,
	right: CompilerGymActionSpaceVisibilityExactRatio,
): -1 | 0 | 1 {
	const difference =
		BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function strictParetoDominates(
	left: { blowfishIr: number; bzip2Ir: number },
	right: { blowfishIr: number; bzip2Ir: number },
): boolean {
	return (
		left.blowfishIr <= right.blowfishIr &&
		left.bzip2Ir <= right.bzip2Ir &&
		(left.blowfishIr < right.blowfishIr || left.bzip2Ir < right.bzip2Ir)
	);
}

function orderedUniqueFlags(actions: readonly string[], membership: ReadonlySet<string>): string[] {
	return [...new Set(actions.filter((action) => membership.has(action)))];
}

export function assessCompilerGymActionSpaceVisibilityPair(input: {
	control: CompilerGymActionSpaceVisibilityCandidate;
	treatment: CompilerGymActionSpaceVisibilityCandidate;
	guides: CompilerGymActionSpaceVisibilityGuides;
}): CompilerGymActionSpaceVisibilityPairAssessment {
	assertExactAllowedFlags(input.guides.allowedFlags);
	exactUniqueFlags(
		input.guides.omittedFlags,
		OMITTED_FLAG_COUNT,
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_OMITTED_FLAGS_SHA256,
		"Assessment omitted action complement",
	);
	const control = validateCandidate(input.control, input.guides.allowedFlags, "control candidate");
	const treatment = validateCandidate(input.treatment, input.guides.allowedFlags, "treatment candidate");
	const omitted = new Set(input.guides.omittedFlags);
	const controlOmittedFlags = orderedUniqueFlags(input.control.actions, omitted);
	const treatmentOmittedFlags = orderedUniqueFlags(input.treatment.actions, omitted);
	const controlActions = new Set(input.control.actions);
	const treatmentUniqueOmittedFlags = treatmentOmittedFlags.filter((flag) => !controlActions.has(flag));
	const mechanismEngaged = treatmentUniqueOmittedFlags.length > 0;
	let treatmentStrictlyParetoDominates = false;
	let controlStrictlyParetoDominates = false;
	let exactTaskVectorTie = false;
	let controlRatio: CompilerGymActionSpaceVisibilityExactRatio | null = null;
	let treatmentRatio: CompilerGymActionSpaceVisibilityExactRatio | null = null;
	let comparison: CompilerGymActionSpaceVisibilityPairAssessment["normalizedMinimax"]["comparison"] = "unavailable";
	if (
		control.verified &&
		treatment.verified &&
		control.blowfishIr !== null &&
		control.bzip2Ir !== null &&
		treatment.blowfishIr !== null &&
		treatment.bzip2Ir !== null
	) {
		const controlVector = { blowfishIr: control.blowfishIr, bzip2Ir: control.bzip2Ir };
		const treatmentVector = { blowfishIr: treatment.blowfishIr, bzip2Ir: treatment.bzip2Ir };
		treatmentStrictlyParetoDominates = strictParetoDominates(treatmentVector, controlVector);
		controlStrictlyParetoDominates = strictParetoDominates(controlVector, treatmentVector);
		exactTaskVectorTie =
			treatmentVector.blowfishIr === controlVector.blowfishIr && treatmentVector.bzip2Ir === controlVector.bzip2Ir;
		controlRatio = exactMinimax(control.blowfishIr, control.bzip2Ir);
		treatmentRatio = exactMinimax(treatment.blowfishIr, treatment.bzip2Ir);
		const order = compareExactRatios(treatmentRatio, controlRatio);
		comparison = order < 0 ? "treatment-lower" : order > 0 ? "control-lower" : "equal";
	}
	const promising = control.verified && treatment.verified && mechanismEngaged && treatmentStrictlyParetoDominates;
	const directionalLoss =
		control.verified &&
		(!treatment.verified ||
			controlStrictlyParetoDominates ||
			exactTaskVectorTie ||
			(!mechanismEngaged && !treatmentStrictlyParetoDominates));
	return {
		protocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL,
		controlVerified: control.verified,
		treatmentVerified: treatment.verified,
		controlOmittedFlags,
		treatmentOmittedFlags,
		treatmentUniqueOmittedFlags,
		mechanismEngaged,
		treatmentStrictlyParetoDominates,
		controlStrictlyParetoDominates,
		exactTaskVectorTie,
		normalizedMinimax: {
			control: controlRatio,
			treatment: treatmentRatio,
			comparison,
			diagnosticOnly: true,
		},
		decision: promising
			? "directionally-promising-requires-fresh-replication"
			: directionalLoss
				? "directional-loss"
				: "inconclusive",
		nextGate: promising ? "one-fresh-independent-four-call-cpu-replication" : "stop-visibility-v1",
		causalClaimAllowed: false,
		randomizedInferenceAllowed: false,
		tamperEvidentRandomAssignment: false,
		defaultPromotionAllowed: false,
		gpuPromotionAllowed: false,
		nanogptPromotionAllowed: false,
	};
}

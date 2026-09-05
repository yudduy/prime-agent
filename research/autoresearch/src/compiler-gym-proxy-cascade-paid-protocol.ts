import assert from "node:assert/strict";
import { canonicalJson, sha256Json, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256 } from "./compiler-gym-complete-action-space-headroom.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
} from "./compiler-gym-ir-delta-screen-protocol.js";
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

export const COMPILER_GYM_PROXY_CASCADE_PAID_PROTOCOL = "compiler-gym-proxy-cascade-paid-directional-pilot-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL =
	"compiler-gym-proxy-cascade-paid-directional-pilot-runner-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_PAIR_ID = "compiler-gym-proxy-cascade-paid-pair-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_ARMS = ["full-control", "proxy-cascade"] as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_CONTROL_ARM = "full-control" as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_TREATMENT_ARM = "proxy-cascade" as const;
export type CompilerGymProxyCascadePaidArm = (typeof COMPILER_GYM_PROXY_CASCADE_PAID_ARMS)[number];

export function compilerGymProxyCascadePaidArmOrder(
	drawHex: string,
): readonly [CompilerGymProxyCascadePaidArm, CompilerGymProxyCascadePaidArm] {
	if (!/^[a-f0-9]{32}$/.test(drawHex)) {
		throw new Error("Paid-pilot arm-order draw must be exactly 16 lowercase hexadecimal bytes");
	}
	return Number.parseInt(drawHex.slice(0, 2), 16) % 2 === 0
		? [COMPILER_GYM_PROXY_CASCADE_PAID_ARMS[0], COMPILER_GYM_PROXY_CASCADE_PAID_ARMS[1]]
		: [COMPILER_GYM_PROXY_CASCADE_PAID_ARMS[1], COMPILER_GYM_PROXY_CASCADE_PAID_ARMS[0]];
}

export const COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS = [1, 2, 3, 4] as const;
export type CompilerGymProxyCascadePaidCallOrdinal = (typeof COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS)[number];
export const COMPILER_GYM_PROXY_CASCADE_PAID_MAX_ACTIONS = 256 as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_ALLOWED_ACTIONS_SHA256 =
	COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256;
export const COMPILER_GYM_PROXY_CASCADE_PAID_OUTPUT_TOKEN_LIMIT = 32_000 as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_CALIBRATION = {
	"benchmark://cbench-v1/blowfish": { irInstructionCount: 3898, objectTextSizeBytes: 16_573 },
	"benchmark://cbench-v1/bzip2": { irInstructionCount: 28_748, objectTextSizeBytes: 122_613 },
} as const;

export const CompilerGymProxyCascadePaidEvaluationSchema = createStockInterfaceParityEvaluationSchema({
	minItems: 1,
	maxItems: COMPILER_GYM_PROXY_CASCADE_PAID_MAX_ACTIONS,
});

export const COMPILER_GYM_PROXY_CASCADE_PAID_TOOL = {
	name: STOCK_INTERFACE_PARITY_TOOL_NAME,
	description:
		"Submit one LLVM pass sequence, wait for the arm's immutable host-owned online stage, and return exactly the evidence allocated to this tool result.",
	parameters: CompilerGymProxyCascadePaidEvaluationSchema,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS = {
	pairCount: 1,
	perArmActualProviderDispatches: 4,
	perArmToolCalls: 4,
	controlFreshOnlineTaskEvaluations: 8,
	treatmentFreshOnlineTaskEvaluationsNormal: 6,
	treatmentFreshOnlineTaskEvaluationsMinimumAfterSemanticRejection: 4,
	treatmentPostTerminalHiddenAuditEvaluationsMaximum: 2,
	pairFreshOnlineTaskEvaluationsNormal: 14,
	pairFreshTaskEvaluationsIncludingHiddenAuditsMaximum: 16,
	maximumConcurrentEvaluatorTasks: 2,
	providerRetries: 0,
	providerReplacements: 0,
	measurementReuse: 0,
	noncachedOutputTokensPerArmCheckpoint: COMPILER_GYM_PROXY_CASCADE_PAID_OUTPUT_TOKEN_LIMIT,
	providerRequestTimeoutMilliseconds: 120_000,
	evaluatorTaskTimeoutMilliseconds: 420_000,
	activeAgentSecondsCheckpoint: 600,
	activeAgentTimeFormula: "arm-total-host-monotonic-wall-minus-summed-online-evaluator-wait",
	activeAgentCheckpointBoundary: "strictly-greater-than-600-seconds-is-apparatus-invalid",
	calendarSecondsHard: 900,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_THRESHOLDS = {
	onlineEvaluatorStepCpu: {
		cascadeToControlRatioNumeratorMaximum: 4,
		cascadeToControlRatioDenominator: 5,
		source: ".0.cpuTimeRawSeconds-reserved-logical-evaluator-step-cpu",
	},
	onlineEvaluatorWait: {
		cascadeToControlRatioNumeratorMaximum: 9,
		cascadeToControlRatioDenominator: 10,
		absoluteSavingMicrosecondsMinimum: 10_000_000,
		source: "host-monotonic-dispatch-to-terminal-feedback-ready",
	},
	providerWall: "descriptive-only-never-inferential",
	totalWall: "descriptive-only-never-inferential",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_OPERATIONAL_GATES = {
	exactArmOrderDraw: true,
	exactFourProviderCallsPerArm: true,
	exactFourToolCallsPerArm: true,
	exactSharedS12FirstRequest: true,
	distinctActionSequencePerArm: true,
	controlEightFreshOnlineOneTaskEvaluations: true,
	treatmentSixFreshOnlineOneTaskEvaluationsUnderNormalAcceptance: true,
	noRetryReplacementReuseCompactionRlmWebOrPublicTrace: true,
	fourImmediateLiveEnvironmentGatesPerArm: true,
	terminalPersistedEvidenceBeforeNextRequest: true,
	hiddenAuditsAfterBothOnlineArmsAndAgentInaccessible: true,
	createOnlyIdentityLockAndSeals: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS = {
	replicationUnit: "one-complete-unseedable-luna-trajectory-per-arm",
	maximumClaim: "one-observed-randomized-order-directional-pair",
	causalClaimAllowed: false,
	replicationClaimAllowed: false,
	defaultBehaviorPromotionAllowed: false,
	gpuTransferClaimAllowed: false,
	kernelBenchTransferClaimAllowed: false,
	nanoGptTransferClaimAllowed: false,
	winNextGate: "authorize-one-fresh-randomized-order-replication-only",
	nonWinNextGate: "kill-proxy-cascade-v1",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY = {
	apparatusInvalid: "terminal-apparatus-invalid-attempt-identity-consumed",
	policyNonconformance: "terminal-scientific-policy-nonconformance-attempt-identity-consumed",
	semanticRejection: "complete-semantic-rejection-valid-negative-call-consumed",
	directionalNonWin: "terminal-complete-directional-nonwin-kill-proxy-cascade-v1",
	directionalWin: "terminal-complete-directionally-promising-authorize-one-fresh-replication-only",
} as const;

export function buildCompilerGymProxyCascadePaidPrompt(): string {
	return [
		"Optimize two fixed CompilerGym/cBench programs by reducing raw LLVM IR instruction count while preserving all twenty semantic callbacks.",
		"This is one bounded research arm. Make exactly four sequential autoresearch_evaluate tool calls and wait for each complete terminal tool result before proposing the next candidate.",
		"Tool results one through three enter the next provider request as measured history. Tool result four is durably persisted and then the host terminalizes locally before any fifth provider transport.",
		`Call ${STOCK_INTERFACE_PARITY_TOOL_NAME} with exactly: {"actions": string[], "hypothesis": string, "mechanism": string, "predictedOutcome": string, "boundaryConditions": string[]}.`,
		`Your first tool call must be byte-for-byte equivalent to this fixed request: ${JSON.stringify(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST)}.`,
		`After S12, choose calls two through four adaptively from only this session's measured evidence. Each action sequence must be distinct within the arm and contain 1 to ${COMPILER_GYM_PROXY_CASCADE_PAID_MAX_ACTIONS} LLVM passes.`,
		`Tasks: ${JSON.stringify(STOCK_CPU_TASKS)}. Empty-pass calibration: ${JSON.stringify(
			STOCK_CPU_TASKS.map((benchmarkId) => ({
				benchmarkId,
				...COMPILER_GYM_PROXY_CASCADE_PAID_CALIBRATION[benchmarkId],
			})),
		)}.`,
		`Useful LLVM 10 flags include: ${STOCK_INTERFACE_PARITY_ACTION_GUIDE.join(", ")}. Repetition and order are allowed.`,
		"The host owns task allocation, immutable verification, delayed confirmation, selection, budgets, and terminalization. Only evidence returned by this tool is model-visible.",
		"A complete semantic rejection is durable negative evidence. It consumes one call; continue within the exact four-call limit.",
		"Do not use web access, public winning traces, RLM children, compaction, retries, measurement reuse, credentials, arbitrary shell, or files outside the empty isolated workspace.",
		"The host closes the session after the fourth terminal tool result. Do not attempt a fifth provider or tool call and do not emit a final champion report.",
	].join("\n");
}

export const COMPILER_GYM_PROXY_CASCADE_PAID_PROMPT = buildCompilerGymProxyCascadePaidPrompt();

export function parseCompilerGymProxyCascadePaidRequest(value: unknown): StockCpuEvaluationRequest {
	const request = parseStockCpuEvaluationRequest(value);
	if (request.actions.length < 1 || request.actions.length > COMPILER_GYM_PROXY_CASCADE_PAID_MAX_ACTIONS) {
		throw new Error(`Paid-pilot action count must be between 1 and ${COMPILER_GYM_PROXY_CASCADE_PAID_MAX_ACTIONS}`);
	}
	return request;
}

export function assertCompilerGymProxyCascadePaidAuthoritativeActions(actions: readonly string[]): readonly string[] {
	if (
		actions.length !== 124 ||
		new Set(actions).size !== actions.length ||
		actions.some((action) => !/^-[a-z0-9][a-z0-9-]*$/.test(action)) ||
		sha256Json(actions) !== COMPILER_GYM_PROXY_CASCADE_PAID_ALLOWED_ACTIONS_SHA256
	) {
		throw new Error("Paid-pilot authoritative LLVM-10 action inventory drifted");
	}
	return [...actions];
}

export function assertCompilerGymProxyCascadePaidRequestPolicy(input: {
	request: unknown;
	callOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
	priorRequests: readonly StockCpuEvaluationRequest[];
	authoritativeActions: readonly string[];
}): StockCpuEvaluationRequest {
	if (input.priorRequests.length !== input.callOrdinal - 1) {
		throw new Error("Paid-pilot request history length does not match the call ordinal");
	}
	const request = parseCompilerGymProxyCascadePaidRequest(input.request);
	const allowed = new Set(assertCompilerGymProxyCascadePaidAuthoritativeActions(input.authoritativeActions));
	if (request.actions.some((action) => !allowed.has(action))) {
		throw new Error("Paid-pilot request contains an action outside the authoritative LLVM-10 inventory");
	}
	if (input.callOrdinal === 1) {
		if (
			canonicalJson(toJsonValue(request)) !== canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST)) ||
			sha256Json(request.actions) !== COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256
		) {
			throw new Error("Paid-pilot first request must be the exact shared S12 request");
		}
	}
	const digest = sha256Json(request.actions);
	const priorDigests = input.priorRequests.map((prior, index) => {
		const parsed = parseCompilerGymProxyCascadePaidRequest(prior);
		if (parsed.actions.some((action) => !allowed.has(action))) {
			throw new Error("Paid-pilot request history contains an action outside the authoritative LLVM-10 inventory");
		}
		if (index === 0) {
			assertCompilerGymProxyCascadePaidRequestPolicy({
				request: parsed,
				callOrdinal: 1,
				priorRequests: [],
				authoritativeActions: input.authoritativeActions,
			});
		}
		return sha256Json(parsed.actions);
	});
	if (priorDigests.includes(digest)) {
		throw new Error("Paid-pilot action sequences must be distinct within each arm");
	}
	return request;
}

export function assertCompilerGymProxyCascadePaidRequestSequence(
	requests: readonly unknown[],
	authoritativeActions: readonly string[],
): readonly [
	StockCpuEvaluationRequest,
	StockCpuEvaluationRequest,
	StockCpuEvaluationRequest,
	StockCpuEvaluationRequest,
] {
	if (requests.length !== COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS.length) {
		throw new Error("Paid-pilot arm must contain exactly four requests");
	}
	const parsed: StockCpuEvaluationRequest[] = [];
	for (const callOrdinal of COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS) {
		parsed.push(
			assertCompilerGymProxyCascadePaidRequestPolicy({
				request: requests[callOrdinal - 1],
				callOrdinal,
				priorRequests: parsed,
				authoritativeActions,
			}),
		);
	}
	return [parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!];
}

export type CompilerGymProxyCascadePaidTaskOutcome = "verified" | "complete-semantic-rejection";
export type CompilerGymProxyCascadePaidMeasurementPhase =
	| "online-tool-result"
	| "online-agent-inaccessible-selected-confirmation"
	| "post-terminal-agent-inaccessible-hidden-audit";

export interface CompilerGymProxyCascadePaidTaskMeasurement {
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	outcome: CompilerGymProxyCascadePaidTaskOutcome;
	irInstructionCount: number;
	objectTextSizeBytes: number;
	verifierInputsCompleted: 20;
	measurementState: "fresh-never-reused";
	phase: CompilerGymProxyCascadePaidMeasurementPhase;
	providerVisibleAtDispatchOrdinal: 2 | 3 | 4 | null;
	stepCpuSeconds: number;
}

export interface CompilerGymProxyCascadePaidCandidate {
	ordinal: CompilerGymProxyCascadePaidCallOrdinal;
	candidateSha256: string;
	request: StockCpuEvaluationRequest;
	blowfish: CompilerGymProxyCascadePaidTaskMeasurement;
	bzip2: CompilerGymProxyCascadePaidTaskMeasurement | null;
	selectedForOnlineBzip2: boolean;
}

export interface CompilerGymProxyCascadePaidSelectorCandidate {
	ordinal: CompilerGymProxyCascadePaidCallOrdinal;
	blowfish: Pick<CompilerGymProxyCascadePaidTaskMeasurement, "outcome" | "irInstructionCount">;
}

function safeNonnegativeInteger(value: number, path: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${path} must be a nonnegative safe integer`);
	return value;
}

function positiveSafeInteger(value: number, path: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive safe integer`);
	return value;
}

function assertDigest(value: string, path: string): string {
	if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${path} must be a lowercase SHA-256 digest`);
	return value;
}

export function selectCompilerGymProxyCascadePaidBzip2Ordinals(
	candidates: readonly CompilerGymProxyCascadePaidSelectorCandidate[],
): CompilerGymProxyCascadePaidCallOrdinal[] {
	if (candidates.length !== 4) throw new Error("Paid-pilot selector requires exactly four ordered candidates");
	for (const [index, candidate] of candidates.entries()) {
		if (candidate.ordinal !== index + 1)
			throw new Error("Paid-pilot selector candidates must be ordered 1 through 4");
		if (candidate.blowfish.outcome === "verified") {
			positiveSafeInteger(candidate.blowfish.irInstructionCount, `candidate ${candidate.ordinal} blowfish IR`);
		}
	}
	return candidates
		.filter((candidate) => candidate.blowfish.outcome === "verified")
		.sort(
			(left, right) =>
				left.blowfish.irInstructionCount - right.blowfish.irInstructionCount || left.ordinal - right.ordinal,
		)
		.slice(0, 2)
		.map((candidate) => candidate.ordinal);
}

export interface CompilerGymProxyCascadePaidPoint {
	ordinal: CompilerGymProxyCascadePaidCallOrdinal;
	candidateSha256: string;
	blowfishIr: number;
	bzip2Ir: number;
}

export interface CompilerGymProxyCascadePaidFrontierVector {
	blowfishIr: number;
	bzip2Ir: number;
}

function validatePoint(point: CompilerGymProxyCascadePaidPoint, path: string): CompilerGymProxyCascadePaidPoint {
	if (!COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS.includes(point.ordinal)) {
		throw new Error(`${path}.ordinal must be 1 through 4`);
	}
	assertDigest(point.candidateSha256, `${path}.candidateSha256`);
	positiveSafeInteger(point.blowfishIr, `${path}.blowfishIr`);
	positiveSafeInteger(point.bzip2Ir, `${path}.bzip2Ir`);
	return { ...point };
}

function weaklyDominates(
	left: CompilerGymProxyCascadePaidFrontierVector,
	right: CompilerGymProxyCascadePaidFrontierVector,
): boolean {
	return left.blowfishIr <= right.blowfishIr && left.bzip2Ir <= right.bzip2Ir;
}

function strictlyDominates(
	left: CompilerGymProxyCascadePaidFrontierVector,
	right: CompilerGymProxyCascadePaidFrontierVector,
): boolean {
	return weaklyDominates(left, right) && (left.blowfishIr < right.blowfishIr || left.bzip2Ir < right.bzip2Ir);
}

export function compilerGymProxyCascadePaidParetoFrontier(
	points: readonly CompilerGymProxyCascadePaidPoint[],
): CompilerGymProxyCascadePaidFrontierVector[] {
	const validated = points.map((point, index) => validatePoint(point, `points[${index}]`));
	const unique = new Map<string, CompilerGymProxyCascadePaidFrontierVector>();
	for (const point of validated) {
		unique.set(`${point.blowfishIr}:${point.bzip2Ir}`, {
			blowfishIr: point.blowfishIr,
			bzip2Ir: point.bzip2Ir,
		});
	}
	const vectors = [...unique.values()];
	return vectors
		.filter((candidate, index) =>
			vectors.every((other, otherIndex) => otherIndex === index || !strictlyDominates(other, candidate)),
		)
		.sort((left, right) => left.blowfishIr - right.blowfishIr || left.bzip2Ir - right.bzip2Ir);
}

export function compilerGymProxyCascadePaidWeaklyCovers(
	witnesses: readonly CompilerGymProxyCascadePaidFrontierVector[],
	targets: readonly CompilerGymProxyCascadePaidFrontierVector[],
): boolean {
	return targets.every((target) => witnesses.some((witness) => weaklyDominates(witness, target)));
}

interface ExactRatio {
	numerator: bigint;
	denominator: bigint;
}

function compareRatios(left: ExactRatio, right: ExactRatio): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function minimaxRatio(point: CompilerGymProxyCascadePaidPoint): ExactRatio {
	const blowfish = { numerator: BigInt(point.blowfishIr), denominator: 3898n };
	const bzip2 = { numerator: BigInt(point.bzip2Ir), denominator: 28_748n };
	return compareRatios(blowfish, bzip2) >= 0 ? blowfish : bzip2;
}

export function selectCompilerGymProxyCascadePaidChampion(
	points: readonly CompilerGymProxyCascadePaidPoint[],
): CompilerGymProxyCascadePaidPoint | null {
	const validated = points.map((point, index) => validatePoint(point, `points[${index}]`));
	return (
		validated.sort((left, right) => {
			const scoreOrder = compareRatios(minimaxRatio(left), minimaxRatio(right));
			return (
				scoreOrder ||
				left.blowfishIr - right.blowfishIr ||
				left.bzip2Ir - right.bzip2Ir ||
				left.candidateSha256.localeCompare(right.candidateSha256) ||
				left.ordinal - right.ordinal
			);
		})[0] ?? null
	);
}

export interface CompilerGymProxyCascadePaidArmObservation {
	arm: CompilerGymProxyCascadePaidArm;
	requests: readonly StockCpuEvaluationRequest[];
	candidates: readonly CompilerGymProxyCascadePaidCandidate[];
	actualProviderDispatches: number;
	actualToolCalls: number;
	successfulToolCallAssistantMessages: number;
	blockedProviderDispatchesAfterTerminal: number;
	abortedContinuationPersisted: boolean;
	abortedContinuationUsageTokens: number;
	abortedContinuationTransportDispatches: number;
	liveEnvironmentGatePasses: number;
	providerRetries: number;
	providerReplacements: number;
	measurementReuseCount: number;
	duplicateDispatchCount: number;
	compactionCount: number;
	rlmChildCount: number;
	forbiddenToolCallCount: number;
	terminalToolOutputsPersistedBeforeNextRequest: boolean;
	sessionContinuityPassed: boolean;
	providerTranscriptHistoryGuardPassed: boolean;
	modelAuthSystemToolParityPassed: boolean;
	sessionLedgerArtifactSourceWorktreeIntegrityPassed: boolean;
	outputTokens: number;
	outputTokenCheckpointExceeded: boolean;
	onlineEvaluatorWaitMicros: number;
	providerWallMicros: number;
	totalWallMicros: number;
}

export interface CompilerGymProxyCascadePaidPairObservation {
	control: CompilerGymProxyCascadePaidArmObservation;
	treatment: CompilerGymProxyCascadePaidArmObservation;
	armExecutionOrder: readonly [CompilerGymProxyCascadePaidArm, CompilerGymProxyCascadePaidArm];
	armOrderDrawHex: string;
	hiddenAuditsStartedAfterBothOnlineArmsTerminal: boolean;
	hiddenAuditEvidenceWasAgentInaccessible: boolean;
	authoritativeActions: readonly string[];
}

function validateTask(
	task: CompilerGymProxyCascadePaidTaskMeasurement,
	benchmarkId: (typeof STOCK_CPU_TASKS)[number],
	path: string,
): CompilerGymProxyCascadePaidTaskMeasurement {
	if (task.benchmarkId !== benchmarkId) throw new Error(`${path}.benchmarkId drifted`);
	if (task.outcome !== "verified" && task.outcome !== "complete-semantic-rejection") {
		throw new Error(`${path}.outcome is invalid`);
	}
	positiveSafeInteger(task.irInstructionCount, `${path}.irInstructionCount`);
	safeNonnegativeInteger(task.objectTextSizeBytes, `${path}.objectTextSizeBytes`);
	if (task.verifierInputsCompleted !== 20) throw new Error(`${path}.verifierInputsCompleted must equal 20`);
	if (task.measurementState !== "fresh-never-reused") throw new Error(`${path}.measurementState drifted`);
	if (
		task.providerVisibleAtDispatchOrdinal !== null &&
		task.providerVisibleAtDispatchOrdinal !== 2 &&
		task.providerVisibleAtDispatchOrdinal !== 3 &&
		task.providerVisibleAtDispatchOrdinal !== 4
	) {
		throw new Error(`${path}.providerVisibleAtDispatchOrdinal is invalid`);
	}
	positiveSafeInteger(task.stepCpuSeconds, `${path}.stepCpuSeconds`);
	return task;
}

function validateCandidates(
	arm: CompilerGymProxyCascadePaidArm,
	candidates: readonly CompilerGymProxyCascadePaidCandidate[],
): CompilerGymProxyCascadePaidCandidate[] {
	if (candidates.length !== 4) throw new Error(`${arm} must contain exactly four candidates`);
	return candidates.map((candidate, index) => {
		const ordinal = COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS[index]!;
		if (candidate.ordinal !== ordinal) throw new Error(`${arm} candidates must be ordered 1 through 4`);
		const request = parseCompilerGymProxyCascadePaidRequest(candidate.request);
		if (candidate.candidateSha256 !== sha256Json(request.actions)) {
			throw new Error(`${arm} candidate ${ordinal} digest does not bind its actions`);
		}
		validateTask(candidate.blowfish, STOCK_CPU_TASKS[0], `${arm}.candidates[${index}].blowfish`);
		if (candidate.blowfish.phase !== "online-tool-result") {
			throw new Error(`${arm} blowfish measurements must be online tool results`);
		}
		if (candidate.bzip2) validateTask(candidate.bzip2, STOCK_CPU_TASKS[1], `${arm}.candidates[${index}].bzip2`);
		return structuredClone(candidate);
	});
}

function completePoints(
	candidates: readonly CompilerGymProxyCascadePaidCandidate[],
): CompilerGymProxyCascadePaidPoint[] {
	return candidates.flatMap((candidate) =>
		candidate.blowfish.outcome === "verified" && candidate.bzip2?.outcome === "verified"
			? [
					{
						ordinal: candidate.ordinal,
						candidateSha256: candidate.candidateSha256,
						blowfishIr: candidate.blowfish.irInstructionCount,
						bzip2Ir: candidate.bzip2.irInstructionCount,
					},
				]
			: [],
	);
}

function onlineTaskMeasurements(candidates: readonly CompilerGymProxyCascadePaidCandidate[]) {
	return candidates.flatMap((candidate) =>
		[candidate.blowfish, candidate.bzip2].filter(
			(measurement): measurement is CompilerGymProxyCascadePaidTaskMeasurement =>
				measurement !== null &&
				(measurement.phase === "online-tool-result" ||
					measurement.phase === "online-agent-inaccessible-selected-confirmation"),
		),
	);
}

function hiddenTaskMeasurements(candidates: readonly CompilerGymProxyCascadePaidCandidate[]) {
	return candidates.flatMap((candidate) =>
		candidate.bzip2?.phase === "post-terminal-agent-inaccessible-hidden-audit" ? [candidate.bzip2] : [],
	);
}

function operationalArmGates(arm: CompilerGymProxyCascadePaidArmObservation, authoritativeActions: readonly string[]) {
	for (const [value, path] of [
		[arm.actualProviderDispatches, "actualProviderDispatches"],
		[arm.actualToolCalls, "actualToolCalls"],
		[arm.successfulToolCallAssistantMessages, "successfulToolCallAssistantMessages"],
		[arm.blockedProviderDispatchesAfterTerminal, "blockedProviderDispatchesAfterTerminal"],
		[arm.abortedContinuationUsageTokens, "abortedContinuationUsageTokens"],
		[arm.abortedContinuationTransportDispatches, "abortedContinuationTransportDispatches"],
		[arm.liveEnvironmentGatePasses, "liveEnvironmentGatePasses"],
		[arm.providerRetries, "providerRetries"],
		[arm.providerReplacements, "providerReplacements"],
		[arm.measurementReuseCount, "measurementReuseCount"],
		[arm.duplicateDispatchCount, "duplicateDispatchCount"],
		[arm.compactionCount, "compactionCount"],
		[arm.rlmChildCount, "rlmChildCount"],
		[arm.forbiddenToolCallCount, "forbiddenToolCallCount"],
		[arm.outputTokens, "outputTokens"],
	] as const) {
		safeNonnegativeInteger(value, `${arm.arm}.${path}`);
	}
	const requests = assertCompilerGymProxyCascadePaidRequestSequence(arm.requests, authoritativeActions);
	const candidates = validateCandidates(arm.arm, arm.candidates);
	assert.deepEqual(
		candidates.map((candidate) => candidate.request),
		requests,
		`${arm.arm} requests and candidates drifted`,
	);
	return {
		requests,
		candidates,
		gates: {
			exactFourProviderCalls: arm.actualProviderDispatches === 4,
			exactFourToolCalls: arm.actualToolCalls === 4,
			exactFourSuccessfulToolCallAssistantMessages: arm.successfulToolCallAssistantMessages === 4,
			exactlyOneLocallyBlockedPostTerminalContinuation: arm.blockedProviderDispatchesAfterTerminal === 1,
			abortedContinuationPersisted: arm.abortedContinuationPersisted,
			abortedContinuationHadZeroUsage: arm.abortedContinuationUsageTokens === 0,
			abortedContinuationHadZeroTransport: arm.abortedContinuationTransportDispatches === 0,
			exactFourImmediateLiveEnvironmentGates: arm.liveEnvironmentGatePasses === 4,
			zeroProviderRetries: arm.providerRetries === 0,
			zeroProviderReplacements: arm.providerReplacements === 0,
			zeroMeasurementReuse: arm.measurementReuseCount === 0,
			zeroDuplicateDispatches: arm.duplicateDispatchCount === 0,
			zeroCompactions: arm.compactionCount === 0,
			zeroRlmChildren: arm.rlmChildCount === 0,
			zeroForbiddenToolCalls: arm.forbiddenToolCallCount === 0,
			terminalEvidencePersisted: arm.terminalToolOutputsPersistedBeforeNextRequest,
			sessionContinuityPassed: arm.sessionContinuityPassed,
			providerTranscriptHistoryGuardPassed: arm.providerTranscriptHistoryGuardPassed,
			modelAuthSystemToolParityPassed: arm.modelAuthSystemToolParityPassed,
			sessionLedgerArtifactSourceWorktreeIntegrityPassed: arm.sessionLedgerArtifactSourceWorktreeIntegrityPassed,
			outputTokenCheckpointNotExceeded:
				!arm.outputTokenCheckpointExceeded &&
				arm.outputTokens >= 0 &&
				arm.outputTokens <= COMPILER_GYM_PROXY_CASCADE_PAID_OUTPUT_TOKEN_LIMIT,
		},
	};
}

export interface CompilerGymProxyCascadePaidPairAssessment {
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_PAID_PROTOCOL;
	disposition: (typeof COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY)[keyof typeof COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY];
	operationalGates: Record<string, boolean>;
	resourceGates: Record<string, boolean>;
	qualityGates: Record<string, boolean>;
	accounting: {
		controlOnlineTaskEvaluations: number;
		treatmentOnlineTaskEvaluations: number;
		treatmentHiddenAuditEvaluations: number;
		pairTotalTaskEvaluations: number;
		controlOnlineStepCpuSeconds: number;
		treatmentOnlineStepCpuSeconds: number;
		controlOnlineEvaluatorWaitMicros: number;
		treatmentOnlineEvaluatorWaitMicros: number;
		providerWallMicrosDescriptive: { control: number; treatment: number };
		totalWallMicrosDescriptive: { control: number; treatment: number };
	};
	selection: {
		expectedSelectedOrdinals: CompilerGymProxyCascadePaidCallOrdinal[];
		observedSelectedOrdinals: CompilerGymProxyCascadePaidCallOrdinal[];
		omittedAcceptedOrdinals: CompilerGymProxyCascadePaidCallOrdinal[];
	};
	frontiers: {
		control: CompilerGymProxyCascadePaidFrontierVector[];
		treatmentDeployed: CompilerGymProxyCascadePaidFrontierVector[];
		treatmentOracle: CompilerGymProxyCascadePaidFrontierVector[];
	};
	champions: {
		control: CompilerGymProxyCascadePaidPoint | null;
		treatmentDeployed: CompilerGymProxyCascadePaidPoint | null;
		treatmentOracle: CompilerGymProxyCascadePaidPoint | null;
	};
	claimCeiling: typeof COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS;
}

function allTrue(record: Readonly<Record<string, boolean>>): boolean {
	return Object.values(record).every(Boolean);
}

export function evaluateCompilerGymProxyCascadePaidPair(
	input: CompilerGymProxyCascadePaidPairObservation,
): CompilerGymProxyCascadePaidPairAssessment {
	if (input.control.arm !== COMPILER_GYM_PROXY_CASCADE_PAID_CONTROL_ARM) {
		throw new Error("Paid-pilot control arm is missing or reversed");
	}
	if (input.treatment.arm !== COMPILER_GYM_PROXY_CASCADE_PAID_TREATMENT_ARM) {
		throw new Error("Paid-pilot treatment arm is missing or reversed");
	}
	assertCompilerGymProxyCascadePaidAuthoritativeActions(input.authoritativeActions);
	const control = operationalArmGates(input.control, input.authoritativeActions);
	const treatment = operationalArmGates(input.treatment, input.authoritativeActions);
	const selected = selectCompilerGymProxyCascadePaidBzip2Ordinals(treatment.candidates);
	const observedSelected = treatment.candidates
		.filter((candidate) => candidate.selectedForOnlineBzip2)
		.map((candidate) => candidate.ordinal);
	const observedSelectedInPolicyOrder = selected.filter((ordinal) => observedSelected.includes(ordinal));
	const accepted = treatment.candidates
		.filter((candidate) => candidate.blowfish.outcome === "verified")
		.map((candidate) => candidate.ordinal);
	const omitted = accepted.filter((ordinal) => !selected.includes(ordinal));

	const controlPhasePolicy = control.candidates.every(
		(candidate) =>
			candidate.selectedForOnlineBzip2 === true &&
			candidate.bzip2 !== null &&
			candidate.bzip2.phase === "online-tool-result" &&
			candidate.blowfish.providerVisibleAtDispatchOrdinal ===
				(candidate.ordinal < 4 ? candidate.ordinal + 1 : null) &&
			candidate.bzip2.providerVisibleAtDispatchOrdinal === (candidate.ordinal < 4 ? candidate.ordinal + 1 : null),
	);
	const treatmentPhasePolicy = treatment.candidates.every((candidate) => {
		if (
			candidate.blowfish.providerVisibleAtDispatchOrdinal !== (candidate.ordinal < 4 ? candidate.ordinal + 1 : null)
		) {
			return false;
		}
		if (selected.includes(candidate.ordinal)) {
			return (
				candidate.selectedForOnlineBzip2 &&
				candidate.bzip2 !== null &&
				candidate.bzip2.phase === "online-agent-inaccessible-selected-confirmation" &&
				candidate.bzip2.providerVisibleAtDispatchOrdinal === null
			);
		}
		if (candidate.blowfish.outcome === "verified") {
			return (
				!candidate.selectedForOnlineBzip2 &&
				candidate.bzip2 !== null &&
				candidate.bzip2.phase === "post-terminal-agent-inaccessible-hidden-audit" &&
				candidate.bzip2.providerVisibleAtDispatchOrdinal === null
			);
		}
		return !candidate.selectedForOnlineBzip2 && candidate.bzip2 === null;
	});

	const controlOnline = onlineTaskMeasurements(control.candidates);
	const treatmentOnline = onlineTaskMeasurements(treatment.candidates);
	const treatmentHidden = hiddenTaskMeasurements(treatment.candidates);
	const controlCpu = controlOnline.reduce((sum, task) => sum + task.stepCpuSeconds, 0);
	const treatmentCpu = treatmentOnline.reduce((sum, task) => sum + task.stepCpuSeconds, 0);
	positiveSafeInteger(input.control.onlineEvaluatorWaitMicros, "control online evaluator wait");
	positiveSafeInteger(input.treatment.onlineEvaluatorWaitMicros, "treatment online evaluator wait");
	positiveSafeInteger(input.control.providerWallMicros, "control provider wall");
	positiveSafeInteger(input.treatment.providerWallMicros, "treatment provider wall");
	positiveSafeInteger(input.control.totalWallMicros, "control total wall");
	positiveSafeInteger(input.treatment.totalWallMicros, "treatment total wall");

	const controlPoints = completePoints(control.candidates);
	const treatmentOraclePoints = completePoints(treatment.candidates);
	const treatmentDeployedPoints = treatmentOraclePoints.filter((point) => selected.includes(point.ordinal));
	const controlFrontier = compilerGymProxyCascadePaidParetoFrontier(controlPoints);
	const treatmentOracleFrontier = compilerGymProxyCascadePaidParetoFrontier(treatmentOraclePoints);
	const treatmentDeployedFrontier = compilerGymProxyCascadePaidParetoFrontier(treatmentDeployedPoints);
	const oracleChampion = selectCompilerGymProxyCascadePaidChampion(treatmentOraclePoints);
	const s12ExpectedBlowfish = COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[STOCK_CPU_TASKS[0]];
	const s12ExpectedBzip2 = COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[STOCK_CPU_TASKS[1]];
	const controlS12 = control.candidates[0]!;
	const treatmentS12 = treatment.candidates[0]!;
	const exactS12 = [controlS12, treatmentS12].every(
		(candidate) =>
			candidate.blowfish.outcome === "verified" &&
			candidate.bzip2?.outcome === "verified" &&
			candidate.blowfish.irInstructionCount === s12ExpectedBlowfish.irInstructionCount &&
			candidate.blowfish.objectTextSizeBytes === s12ExpectedBlowfish.objectTextSizeBytes &&
			candidate.bzip2.irInstructionCount === s12ExpectedBzip2.irInstructionCount &&
			candidate.bzip2.objectTextSizeBytes === s12ExpectedBzip2.objectTextSizeBytes,
	);
	const adaptiveS12Improvement = treatmentDeployedPoints.some(
		(point) =>
			point.ordinal > 1 &&
			point.blowfishIr <= s12ExpectedBlowfish.irInstructionCount &&
			point.bzip2Ir <= s12ExpectedBzip2.irInstructionCount &&
			(point.blowfishIr < s12ExpectedBlowfish.irInstructionCount ||
				point.bzip2Ir < s12ExpectedBzip2.irInstructionCount),
	);

	const operationalGates = {
		armOrderMatchesRecordedCryptographicDraw:
			canonicalJson(toJsonValue(input.armExecutionOrder)) ===
			canonicalJson(toJsonValue(compilerGymProxyCascadePaidArmOrder(input.armOrderDrawHex))),
		armOrderContainsEachArmExactlyOnce:
			input.armExecutionOrder.length === 2 &&
			new Set(input.armExecutionOrder).size === 2 &&
			COMPILER_GYM_PROXY_CASCADE_PAID_ARMS.every((arm) => input.armExecutionOrder.includes(arm)),
		...Object.fromEntries(Object.entries(control.gates).map(([key, value]) => [`control.${key}`, value])),
		...Object.fromEntries(Object.entries(treatment.gates).map(([key, value]) => [`treatment.${key}`, value])),
		controlPhasePolicy,
		treatmentSelectorMatchesExactAcceptedBlowfishOrder:
			observedSelected.length === selected.length &&
			canonicalJson(toJsonValue(observedSelectedInPolicyOrder)) === canonicalJson(toJsonValue(selected)),
		treatmentPhasePolicy,
		hiddenAuditsStartedAfterBothOnlineArmsTerminal: input.hiddenAuditsStartedAfterBothOnlineArmsTerminal,
		hiddenAuditEvidenceWasAgentInaccessible: input.hiddenAuditEvidenceWasAgentInaccessible,
		exactS12AnchorReproducedInBothArms: exactS12,
	};
	const resourceGates = {
		controlExactlyEightFreshOnlineTaskEvaluations: controlOnline.length === 8,
		treatmentExactlySixFreshOnlineTaskEvaluations: treatmentOnline.length === 6,
		treatmentHiddenAuditsEqualOmittedAcceptedCandidates: treatmentHidden.length === omitted.length,
		treatmentHiddenAuditsAtMostTwo: treatmentHidden.length <= 2,
		totalTaskEvaluationsWithinSixteen: controlOnline.length + treatmentOnline.length + treatmentHidden.length <= 16,
		treatmentOnlineStepCpuAtMostEightyPercentOfControl: treatmentCpu * 5 <= controlCpu * 4,
		treatmentOnlineEvaluatorWaitAtMostNinetyPercentOfControl:
			input.treatment.onlineEvaluatorWaitMicros * 10 <= input.control.onlineEvaluatorWaitMicros * 9,
		treatmentOnlineEvaluatorWaitSavesAtLeastTenSeconds:
			input.control.onlineEvaluatorWaitMicros - input.treatment.onlineEvaluatorWaitMicros >= 10_000_000,
	};
	const oracleChampionVector = oracleChampion
		? [{ blowfishIr: oracleChampion.blowfishIr, bzip2Ir: oracleChampion.bzip2Ir }]
		: [];
	const qualityGates = {
		exactS12AnchorReproducedInBothArms: exactS12,
		controlHasAtLeastOneCompleteVerifiedPoint: controlPoints.length > 0,
		treatmentOracleHasAtLeastOneCompleteVerifiedPoint: treatmentOraclePoints.length > 0,
		treatmentDeployedHasAtLeastOneCompleteVerifiedPoint: treatmentDeployedPoints.length > 0,
		deployedTreatmentWeaklyCoversEveryControlFrontierVector: compilerGymProxyCascadePaidWeaklyCovers(
			treatmentDeployedFrontier,
			controlFrontier,
		),
		deployedTreatmentWeaklyCoversEveryTreatmentOracleFrontierVector: compilerGymProxyCascadePaidWeaklyCovers(
			treatmentDeployedFrontier,
			treatmentOracleFrontier,
		),
		deployedTreatmentRetainsOracleChampionVector: compilerGymProxyCascadePaidWeaklyCovers(
			treatmentDeployedFrontier,
			oracleChampionVector,
		),
		selectedAdaptiveCandidateStrictlyImprovesS12: adaptiveS12Improvement,
	};

	const apparatusValid = allTrue(operationalGates);
	const resourcePassed = allTrue(resourceGates);
	const qualityPassed = allTrue(qualityGates);
	return {
		protocol: COMPILER_GYM_PROXY_CASCADE_PAID_PROTOCOL,
		disposition: !apparatusValid
			? COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid
			: resourcePassed && qualityPassed
				? COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.directionalWin
				: COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.directionalNonWin,
		operationalGates,
		resourceGates,
		qualityGates,
		accounting: {
			controlOnlineTaskEvaluations: controlOnline.length,
			treatmentOnlineTaskEvaluations: treatmentOnline.length,
			treatmentHiddenAuditEvaluations: treatmentHidden.length,
			pairTotalTaskEvaluations: controlOnline.length + treatmentOnline.length + treatmentHidden.length,
			controlOnlineStepCpuSeconds: controlCpu,
			treatmentOnlineStepCpuSeconds: treatmentCpu,
			controlOnlineEvaluatorWaitMicros: input.control.onlineEvaluatorWaitMicros,
			treatmentOnlineEvaluatorWaitMicros: input.treatment.onlineEvaluatorWaitMicros,
			providerWallMicrosDescriptive: {
				control: input.control.providerWallMicros,
				treatment: input.treatment.providerWallMicros,
			},
			totalWallMicrosDescriptive: {
				control: input.control.totalWallMicros,
				treatment: input.treatment.totalWallMicros,
			},
		},
		selection: {
			expectedSelectedOrdinals: selected,
			observedSelectedOrdinals: observedSelected,
			omittedAcceptedOrdinals: omitted,
		},
		frontiers: {
			control: controlFrontier,
			treatmentDeployed: treatmentDeployedFrontier,
			treatmentOracle: treatmentOracleFrontier,
		},
		champions: {
			control: selectCompilerGymProxyCascadePaidChampion(controlPoints),
			treatmentDeployed: selectCompilerGymProxyCascadePaidChampion(treatmentDeployedPoints),
			treatmentOracle: oracleChampion,
		},
		claimCeiling: COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS,
	};
}

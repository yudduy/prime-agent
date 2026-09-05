import {
	assessStockCpuCompletion,
	parseStockChampionReport,
	STOCK_CPU_MAX_SUBMISSIONS,
	type StockCpuCalibration,
	type StockCpuChampionSelection,
	type StockCpuCompletionGate,
	type StockCpuSelectionScopeOptions,
	selectStockCpuChampion,
} from "./stock-cpu-protocol.js";
import type { JobView } from "./types.js";

export const HOST_OWNED_TERMINALIZATION_POLICY_VERSION = "host-owned-terminalization-v1" as const;
export const HOST_OWNED_STOCK_CPU_PROTOCOL_VERSION = "stock-prime-core-compiler-gym-host-terminalized-v1" as const;

export const HOST_OWNED_TERMINALIZATION_POLICY = {
	version: HOST_OWNED_TERMINALIZATION_POLICY_VERSION,
	authority: "host-verified-ledger",
	trigger: "four durable terminal measurements under the fixed fresh-measurement contract",
	selection: "the host recomputes the declared stock CPU champion policy from verified jobs",
	assistantReport: "advisory-only",
	measurementQualification:
		"requires exactly four evaluator dispatches, no post-terminal evaluator dispatch, no duplicate, complete verifier acceptance, intact evidence, and no forbidden boundary event",
	runtimeConformance: "measurement qualification plus zero provider dispatches after the fourth terminal measurement",
} as const;

export type AssistantChampionReportStatus = "invalid" | "matched" | "mismatched" | "missing";
export type HostOwnedToolClassification = "evaluator" | "forbidden" | "read-only-deviation";

export interface HostOwnedTerminalizationRuntimeTracker {
	providerDispatches: number;
	providerDispatchesAtTerminal: number | null;
	postTerminalProviderDispatches: number;
	terminalizationStops: number;
	evaluatorToolCalls: number;
	postTerminalEvaluatorToolCalls: number;
	readOnlyDeviationEvents: string[];
	forbiddenBoundaryEvents: string[];
	seenToolCallIds: string[];
}

export interface HostOwnedToolExecution {
	toolCallId: string;
	toolName: string;
	args: unknown;
	result: unknown;
	isError: boolean;
}

export interface AssistantChampionReportAssessment {
	status: AssistantChampionReportStatus;
	line: string | null;
	reportedJobId: string | null;
	hostSelectedJobId: string | null;
}

export interface HostOwnedTerminalizationEvidence {
	evaluatorDispatches: number;
	postTerminalEvaluatorDispatches: number;
	duplicateDispatches: number;
	providerDispatchesAfterTerminalMeasurement: number;
	blockedProviderRequestsAfterTerminalMeasurement: number;
	intentionalHostTerminalizationStops: number;
	ledgerIntegrityPassed: boolean;
	artifactIntegrityPassed: boolean;
	sourceIntegrityPassed: boolean;
	evaluatorIntegrityPassed: boolean;
	coreIntegrityPassed: boolean;
	forbiddenBoundaryEvents: readonly string[];
	readOnlyDeviationEvents: readonly string[];
	assistantReportText: string | null;
}

export interface HostOwnedTerminalizationAssessment {
	policy: typeof HOST_OWNED_TERMINALIZATION_POLICY;
	completionGate: StockCpuCompletionGate;
	championSelection: StockCpuChampionSelection;
	hostSelectedJobId: string | null;
	assistantReport: AssistantChampionReportAssessment;
	measurementQualified: boolean;
	terminalizationRuntimeConformant: boolean;
	hardFailures: string[];
	deviations: string[];
}

export function createHostOwnedTerminalizationRuntimeTracker(): HostOwnedTerminalizationRuntimeTracker {
	return {
		providerDispatches: 0,
		providerDispatchesAtTerminal: null,
		postTerminalProviderDispatches: 0,
		terminalizationStops: 0,
		evaluatorToolCalls: 0,
		postTerminalEvaluatorToolCalls: 0,
		readOnlyDeviationEvents: [],
		forbiddenBoundaryEvents: [],
		seenToolCallIds: [],
	};
}

function containsText(value: unknown, needle: string, seen = new Set<object>()): boolean {
	if (typeof value === "string") return value.includes(needle);
	if (value === null || typeof value !== "object" || seen.has(value)) return false;
	seen.add(value);
	if (Array.isArray(value)) return value.some((item) => containsText(item, needle, seen));
	return Object.values(value).some((item) => containsText(item, needle, seen));
}

function normalizedCode(args: unknown): string | null {
	if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
	const code = (args as Record<string, unknown>).code;
	if (typeof code !== "string") return null;
	return code
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n");
}

export function classifyHostOwnedToolExecution(execution: HostOwnedToolExecution): HostOwnedToolClassification {
	if (execution.isError) return "forbidden";
	if (execution.toolName === "autoresearch_evaluate") return "evaluator";
	if (execution.toolName === "ipython" && containsText(execution.result, "stock_prime_compiler_gym_evaluation")) {
		return "evaluator";
	}
	if (
		execution.toolName === "ipython" &&
		normalizedCode(execution.args) === "import os, json, subprocess\nos.getcwd(), os.listdir('.')"
	) {
		return "read-only-deviation";
	}
	return "forbidden";
}

export function recordHostOwnedToolExecution(
	tracker: HostOwnedTerminalizationRuntimeTracker,
	execution: HostOwnedToolExecution,
): HostOwnedToolClassification {
	if (tracker.seenToolCallIds.includes(execution.toolCallId)) {
		tracker.forbiddenBoundaryEvents.push(`duplicate tool completion ${execution.toolCallId}`);
		return "forbidden";
	}
	tracker.seenToolCallIds.push(execution.toolCallId);
	const classification = classifyHostOwnedToolExecution(execution);
	if (classification === "evaluator") {
		tracker.evaluatorToolCalls += 1;
		if (tracker.providerDispatchesAtTerminal !== null) tracker.postTerminalEvaluatorToolCalls += 1;
		if (tracker.evaluatorToolCalls === STOCK_CPU_MAX_SUBMISSIONS) {
			tracker.providerDispatchesAtTerminal = tracker.providerDispatches;
		}
	} else if (classification === "read-only-deviation") {
		tracker.readOnlyDeviationEvents.push("read-only inspection of the empty arm workspace");
	} else {
		tracker.forbiddenBoundaryEvents.push(`${execution.toolName} call ${execution.toolCallId}`);
	}
	return classification;
}

export function shouldHostOwnTerminalization(tracker: HostOwnedTerminalizationRuntimeTracker): boolean {
	return tracker.evaluatorToolCalls >= STOCK_CPU_MAX_SUBMISSIONS;
}

export function recordHostOwnedProviderDispatch(tracker: HostOwnedTerminalizationRuntimeTracker): void {
	if (shouldHostOwnTerminalization(tracker)) tracker.postTerminalProviderDispatches += 1;
	tracker.providerDispatches += 1;
}

export function recordIntentionalHostTerminalizationStop(tracker: HostOwnedTerminalizationRuntimeTracker): void {
	tracker.terminalizationStops += 1;
}

function nonnegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${name} must be a nonnegative safe integer`);
	}
}

function assessAssistantReport(
	text: string | null,
	allowedJobIds: readonly string[],
	hostSelectedJobId: string | null,
): AssistantChampionReportAssessment {
	if (text === null || text.trim().length === 0) {
		return { status: "missing", line: null, reportedJobId: null, hostSelectedJobId };
	}
	try {
		const parsed = parseStockChampionReport(text, allowedJobIds);
		return {
			status: parsed.jobId === hostSelectedJobId ? "matched" : "mismatched",
			line: parsed.line,
			reportedJobId: parsed.jobId,
			hostSelectedJobId,
		};
	} catch {
		return { status: "invalid", line: null, reportedJobId: null, hostSelectedJobId };
	}
}

export function assessHostOwnedTerminalization(
	jobs: readonly JobView[],
	calibration: StockCpuCalibration,
	evidence: HostOwnedTerminalizationEvidence,
	scope: StockCpuSelectionScopeOptions = {},
): HostOwnedTerminalizationAssessment {
	nonnegativeInteger(evidence.evaluatorDispatches, "evaluatorDispatches");
	nonnegativeInteger(evidence.postTerminalEvaluatorDispatches, "postTerminalEvaluatorDispatches");
	nonnegativeInteger(evidence.duplicateDispatches, "duplicateDispatches");
	nonnegativeInteger(
		evidence.providerDispatchesAfterTerminalMeasurement,
		"providerDispatchesAfterTerminalMeasurement",
	);
	nonnegativeInteger(
		evidence.blockedProviderRequestsAfterTerminalMeasurement,
		"blockedProviderRequestsAfterTerminalMeasurement",
	);
	nonnegativeInteger(evidence.intentionalHostTerminalizationStops, "intentionalHostTerminalizationStops");

	const completionGate = assessStockCpuCompletion(jobs, calibration, scope);
	const championSelection = selectStockCpuChampion(jobs, calibration, scope);
	const hostSelectedJobId = championSelection.selectedJobId;
	const assistantReport = assessAssistantReport(
		evidence.assistantReportText,
		jobs.map((job) => job.proposal.jobId),
		hostSelectedJobId,
	);
	const hardFailures: string[] = [];
	if (!completionGate.passed) hardFailures.push("stock CPU completion gate failed");
	if (evidence.evaluatorDispatches !== STOCK_CPU_MAX_SUBMISSIONS) {
		hardFailures.push(
			`expected ${STOCK_CPU_MAX_SUBMISSIONS} evaluator dispatches, observed ${evidence.evaluatorDispatches}`,
		);
	}
	if (evidence.postTerminalEvaluatorDispatches !== 0) {
		hardFailures.push(
			`observed ${evidence.postTerminalEvaluatorDispatches} evaluator dispatches after terminal measurement`,
		);
	}
	if (evidence.duplicateDispatches !== 0) {
		hardFailures.push(`observed ${evidence.duplicateDispatches} duplicate evaluator dispatches`);
	}
	if (!evidence.ledgerIntegrityPassed) hardFailures.push("ledger integrity failed");
	if (!evidence.artifactIntegrityPassed) hardFailures.push("artifact integrity failed");
	if (!evidence.sourceIntegrityPassed) hardFailures.push("source integrity failed");
	if (!evidence.evaluatorIntegrityPassed) hardFailures.push("evaluator integrity failed");
	if (!evidence.coreIntegrityPassed) hardFailures.push("Prime core integrity failed");
	if (evidence.forbiddenBoundaryEvents.length > 0) {
		hardFailures.push(`forbidden boundary events: ${evidence.forbiddenBoundaryEvents.join("; ")}`);
	}
	if (hostSelectedJobId === null) hardFailures.push("host champion selection is empty");

	const deviations = [...evidence.readOnlyDeviationEvents];
	if (evidence.providerDispatchesAfterTerminalMeasurement > 0) {
		deviations.push(
			`${evidence.providerDispatchesAfterTerminalMeasurement} provider dispatches occurred after terminal measurement`,
		);
	}
	if (evidence.blockedProviderRequestsAfterTerminalMeasurement > 0) {
		deviations.push(
			`${evidence.blockedProviderRequestsAfterTerminalMeasurement} provider requests were blocked after terminal measurement`,
		);
	}
	if (evidence.intentionalHostTerminalizationStops !== 1) {
		deviations.push(
			`intentional host terminalization stop count was ${evidence.intentionalHostTerminalizationStops}, expected 1`,
		);
	}
	if (assistantReport.status !== "matched") {
		deviations.push(`assistant champion report was ${assistantReport.status}`);
	}

	const measurementQualified = hardFailures.length === 0;
	return {
		policy: HOST_OWNED_TERMINALIZATION_POLICY,
		completionGate,
		championSelection,
		hostSelectedJobId,
		assistantReport,
		measurementQualified,
		terminalizationRuntimeConformant:
			measurementQualified &&
			evidence.providerDispatchesAfterTerminalMeasurement === 0 &&
			evidence.intentionalHostTerminalizationStops === 1,
		hardFailures,
		deviations,
	};
}

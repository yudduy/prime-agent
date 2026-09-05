import assert from "node:assert/strict";
import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	type CompilerGymHardenedPaidProviderEvidence,
	createCompilerGymHardenedPaidProviderGuard,
	validateCompilerGymHardenedPaidProviderPayload,
	validateCompilerGymHardenedPaidResolvedModelSnapshot,
} from "./compiler-gym-hardened-paid-provider.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE,
	FarmShareCompilerGymIrDeltaScreenAdapter,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import {
	assertCompilerGymIrDeltaScreenRequestPolicy,
	assertCompilerGymIrDeltaScreenRequestSequence,
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	type CompilerGymIrDeltaScreenCandidateVector,
	CompilerGymIrDeltaScreenEvaluationSchema,
	parseCompilerGymIrDeltaAggregateStdout,
	projectCompilerGymIrDeltaScreenFeedback,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
} from "./compiler-gym-late-novelty-guidance.js";
import {
	COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
	type CompilerGymLateNoveltyProviderRegistryClosure,
	type CompilerGymLateNoveltyScreenPreregistration,
	type CompilerGymLateNoveltySourceRecord,
	captureCompilerGymLateNoveltyProviderRegistryClosure,
	collectCompilerGymLateNoveltyScreenImplementationClosure,
	compilerGymLateNoveltyStockAdditionalSourcePaths,
	computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle,
	parseCompilerGymLateNoveltyScreenPreregistration,
	verifyCompilerGymLateNoveltyScreenPrerequisites,
} from "./compiler-gym-late-novelty-screen-preregistration.js";
import {
	assessCompilerGymLateNoveltyScreenPair,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL,
	type CompilerGymLateNoveltyPairAssessment,
	type CompilerGymLateNoveltyScreenArm,
	type CompilerGymLateNoveltyScreenArmResult,
	projectCompilerGymLateNoveltyScreenFeedback,
	requestForLateNoveltyCall,
} from "./compiler-gym-late-novelty-screen-protocol.js";
import {
	type CompilerGymPaidLiveEnvironmentGateEvidence,
	runCompilerGymPaidLiveEnvironmentGate,
} from "./compiler-gym-paid-live-environment-gate.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import {
	parseStockCpuEvaluationRequest,
	STOCK_CPU_TASKS,
	type StockCpuEvaluationRequest,
} from "./stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	type PairPreregistrationAnchor,
	type PairPreregistrationLoader,
	type RepositorySnapshot,
	runStockInterfaceParityTrajectory,
	STOCK_INTERFACE_PARITY_SAME_RESPONSE_LATCH_ERROR,
	type StockInterfaceParityProviderRequestGate,
} from "./stock-interface-parity.js";
import {
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	type StockInterfaceParityEvaluationEnvelope,
} from "./stock-interface-parity-protocol.js";
import type { JobView } from "./types.js";

export const COMPILER_GYM_LATE_NOVELTY_SCREEN_SYSTEM_PROMPT_POLICY =
	"default-prime-template-with-preregistered-late-novelty-arm-neutral-path-normalization-v1" as const;

type StockTrajectoryResult = Awaited<ReturnType<typeof runStockInterfaceParityTrajectory>>;

export type CompilerGymLateNoveltyArmDisposition =
	| "admitted-directional-arm"
	| "terminal-apparatus-invalid-not-treatment-result"
	| "terminal-scientific-policy-nonconformance";

export interface CompilerGymLateNoveltyProjectionEvidence {
	submissionOrdinal: number;
	producerAccepted: boolean;
	guidancePresent: boolean;
	projectedFeedbackSha256: string;
}

export interface CompilerGymLateNoveltyTreatmentDeliveryEvidence {
	producerResultThreeAccepted: boolean;
	durableFeedbackGuidancePresent: boolean;
	projectorGuidancePresent: boolean;
	providerCallFourExpectedGuidance: boolean;
	providerCallFourExposedGuidance: boolean;
	delivered: boolean;
}

export interface CompilerGymLateNoveltyServiceTierAudit {
	requestedAndLocallyEffective: "priority" | null;
	allProviderPayloadsRequestedPriority: boolean;
	upstreamResponseTierObservable: false;
	upstreamAcknowledgement: "not exposed by current provider response API" | null;
}

export interface CompilerGymLateNoveltyArmAudit {
	arm: CompilerGymLateNoveltyScreenArm;
	disposition: CompilerGymLateNoveltyArmDisposition;
	admitted: boolean;
	apparatusFailures: string[];
	policyFailures: string[];
	providerEvidence: CompilerGymHardenedPaidProviderEvidence<CompilerGymLateNoveltyScreenArm>;
	projectionEvidence: CompilerGymLateNoveltyProjectionEvidence[];
	treatmentDelivery: CompilerGymLateNoveltyTreatmentDeliveryEvidence;
	serviceTier: CompilerGymLateNoveltyServiceTierAudit;
	accountingComplete: boolean;
	providerDispatches: number | null;
	evaluatorJobs: number | null;
	freshTaskEvaluations: number | null;
	providerRetries: number | null;
	replacements: 0;
	candidates: CompilerGymIrDeltaScreenCandidateVector[];
	calls: CompilerGymLateNoveltyScreenArmResult["calls"];
	trajectoryResultPath: string;
	trajectoryResultSha256: string;
	sessionSha256: string;
	ledgerSha256: string;
	terminalLedgerEventHash: string | null;
}

export interface CompilerGymLateNoveltyRunnerPreflight {
	repoRoot: string;
	preregistrationPath: string;
	preregistrationSha256: string;
	preregistration: CompilerGymLateNoveltyScreenPreregistration;
	implementationClosure: CompilerGymLateNoveltySourceRecord[];
	implementationBundleSha256: string;
	stockTrajectoryImplementationBundleSha256: string;
	runtimeWorktreeSnapshot: RepositorySnapshot;
	runtimeWorktreeSnapshotSha256: string;
	providerRegistryClosure: CompilerGymLateNoveltyProviderRegistryClosure;
	additionalSourcePaths: string[];
	globalAttemptLockPath: string;
	providerRequestAnchorPath: string;
	calibrationResultPath: string;
	evaluatorScriptPath: string;
}

export interface CompilerGymLateNoveltyRunResult {
	protocol: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL;
	screenProtocol: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL;
	pairId: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID;
	disposition:
		| "terminal-complete-directional-single-pair"
		| "terminal-apparatus-invalid-not-treatment-result"
		| "terminal-scientific-policy-nonconformance";
	preregistrationPath: string;
	preregistrationSha256: string;
	implementationBundleSha256: string;
	stockTrajectoryImplementationBundleSha256: string;
	runtimeWorktreeSnapshotSha256: string;
	providerRegistryClosure: CompilerGymLateNoveltyProviderRegistryClosure;
	globalAttemptLockPath: string;
	globalAttemptLockSha256: string;
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	randomizedArmOrder: readonly [CompilerGymLateNoveltyScreenArm, CompilerGymLateNoveltyScreenArm];
	arms: CompilerGymLateNoveltyArmAudit[];
	pairApparatusFailures: string[];
	assessment: CompilerGymLateNoveltyPairAssessment | null;
	actualProviderDispatches: number | null;
	actualEvaluatorJobs: number | null;
	actualFreshTaskEvaluations: number | null;
	liveEnvironmentGateAttempts: number;
	liveEnvironmentGatePasses: number;
	liveEnvironmentGateFailures: number;
	authorizedMaximumProviderDispatches: 8;
	authorizedMaximumEvaluatorJobs: 8;
	authorizedMaximumFreshTaskEvaluations: 16;
	retries: 0;
	replacements: 0;
	causalClaimAllowed: false;
	replicationClaimAllowed: false;
	gpuPromotionAllowed: false;
	pairLedgerPath: string;
	pairLedgerSha256: string;
	terminalPairLedgerEventHash: string;
	resultBindingSha256: string;
	startedAt: string;
	finishedAt: string;
}

interface SessionEvidence {
	assistantToolCalls: Array<{
		contentBlocks: Array<
			| { type: "thinking"; thinking: string; thinkingSignature: string | null }
			| { type: "text"; text: string; textSignature: string | null }
			| { type: "toolCall"; id: string; name: string; arguments: unknown }
		>;
		toolCalls: Array<{ id: string; name: string; arguments: unknown }>;
		name: string;
		arguments: unknown;
		stopReason: string;
		errorMessage: string | null;
		emptyAbortContent: boolean;
		zeroUsage: boolean;
	}>;
	toolResults: Array<{ toolCallId: string; toolName: string; text: string; isError: boolean }>;
}

const SCHEMA_REJECTED_POLICY_FAILURE = "scientific-policy-nonconformance: actions must contain from 1 through 46 flags";
const MULTIPLE_TOOL_POLICY_FAILURE =
	"scientific-policy-nonconformance: one provider response contained multiple evaluator tool calls";
const MULTIPLE_TOOL_GUARD_ERROR = "Evaluator dispatch requires a distinct accepted provider response";
const REPEATED_VECTOR_POLICY_FAILURE = "scientific-policy-nonconformance: repeated candidate action vector within arm";

export type CompilerGymLateNoveltyPolicyPrefixKind =
	| "none"
	| "direct-stop"
	| "schema-rejected-local-abort"
	| "runner-policy-local-abort"
	| "wrong-tool-local-abort"
	| "multiple-tool-local-abort";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") return false;
		throw error;
	}
}

async function assertPrivateRegularFile(path: string, label: string): Promise<void> {
	const metadata = await stat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`${label} must be a regular mode-0600 file: ${path}`);
	}
}

async function writeExclusivePrivateJson(path: string, value: unknown): Promise<string> {
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await assertPrivateRegularFile(path, "Late-novelty sealed artifact");
	return sha256Text(contents);
}

export function compilerGymLateNoveltyGlobalAttemptLockPath(repoRoot: string): string {
	const identity = sha256Json({
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID,
	});
	return join(resolve(repoRoot), ".autoresearch", "attempt-locks", `late-novelty-${identity}.lock`);
}

function runtimeDispatchAnchorPath(input: {
	providerRequestAnchorPath: string;
	arm: CompilerGymLateNoveltyScreenArm;
	providerDispatchOrdinal: number;
}): string {
	return `${resolve(input.providerRequestAnchorPath)}.runtime-worktree.${input.arm}.${input.providerDispatchOrdinal}.json`;
}

function stockEnvelope(
	request: StockCpuEvaluationRequest,
	job: JobView,
	budget: StockTrajectoryResult["budget"],
): StockInterfaceParityEvaluationEnvelope {
	return {
		type: "typed_sync_compiler_gym_evaluation",
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		request: structuredClone(request),
		submitted: {
			jobId: job.proposal.jobId,
			acceptedAt: job.state.statusAt,
			manifestDigest: job.proposal.manifestDigest,
			duplicate: false,
		},
		job: {
			jobId: job.proposal.jobId,
			manifestDigest: job.proposal.manifestDigest,
			parentJobIds: [...job.proposal.proposal.parentJobIds],
			candidateDigest: job.proposal.candidate.digest,
			state: structuredClone(job.state),
			measurement: structuredClone(job.measurement),
		},
		budget: structuredClone(budget),
	};
}

function classifyCandidate(
	callIndex: 1 | 2 | 3 | 4,
	parsed: ReturnType<typeof parseCompilerGymIrDeltaAggregateStdout>,
): CompilerGymIrDeltaScreenCandidateVector {
	if (parsed.tasks.some((task) => task.outcome !== "verified")) {
		return { callIndex, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null };
	}
	const blowfish = parsed.tasks.find((task) => task.benchmarkId === STOCK_CPU_TASKS[0]);
	const bzip2 = parsed.tasks.find((task) => task.benchmarkId === STOCK_CPU_TASKS[1]);
	assert.ok(blowfish && bzip2, "Late-novelty aggregate omitted a fixed task");
	return {
		callIndex,
		outcome: "verified",
		blowfishIr: blowfish.finalIrInstructionCount,
		bzip2Ir: bzip2.finalIrInstructionCount,
	};
}

function parseSessionEvidence(contents: string): SessionEvidence {
	if (!contents.endsWith("\n")) throw new Error("Session JSONL is not newline terminated");
	const evidence: SessionEvidence = { assistantToolCalls: [], toolResults: [] };
	for (const [index, line] of contents.slice(0, -1).split("\n").entries()) {
		if (!line) throw new Error(`Session JSONL contains an empty line at ${index + 1}`);
		const entry: unknown = JSON.parse(line);
		if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
		const message = entry.message;
		if (!Array.isArray(message.content)) throw new Error(`Session message ${index + 1} lacks content`);
		if (message.role === "assistant") {
			const contentBlocks = message.content.map((block) => {
				if (!isRecord(block) || typeof block.type !== "string") {
					throw new Error(`Session assistant message ${index + 1} has a malformed content block`);
				}
				if (block.type === "thinking" && typeof block.thinking === "string") {
					return {
						type: "thinking" as const,
						thinking: block.thinking,
						thinkingSignature: typeof block.thinkingSignature === "string" ? block.thinkingSignature : null,
					};
				}
				if (block.type === "text" && typeof block.text === "string") {
					return {
						type: "text" as const,
						text: block.text,
						textSignature: typeof block.textSignature === "string" ? block.textSignature : null,
					};
				}
				if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
					return { type: "toolCall" as const, id: block.id, name: block.name, arguments: block.arguments };
				}
				throw new Error(`Session assistant message ${index + 1} has an unsupported content block`);
			});
			const calls = contentBlocks.filter(
				(block): block is Extract<(typeof contentBlocks)[number], { type: "toolCall" }> =>
					block.type === "toolCall",
			);
			if (calls.length !== 1) {
				evidence.assistantToolCalls.push({
					contentBlocks,
					toolCalls: calls,
					name: calls.length === 0 ? "" : "multiple",
					arguments: calls.map((call) => call.arguments),
					stopReason: typeof message.stopReason === "string" ? message.stopReason : "missing",
					errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : null,
					emptyAbortContent:
						canonicalJson(toJsonValue(message.content)) ===
						canonicalJson(toJsonValue([{ type: "text", text: "" }])),
					zeroUsage:
						isRecord(message.usage) &&
						message.usage.input === 0 &&
						message.usage.output === 0 &&
						message.usage.totalTokens === 0,
				});
			} else {
				evidence.assistantToolCalls.push({
					contentBlocks,
					toolCalls: calls,
					...calls[0]!,
					stopReason: typeof message.stopReason === "string" ? message.stopReason : "missing",
					errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : null,
					emptyAbortContent: false,
					zeroUsage: false,
				});
			}
		}
		if (message.role === "toolResult") {
			const text = message.content
				.filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
				.map((block) => (block as { text: string }).text)
				.join("\n");
			evidence.toolResults.push({
				toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : "",
				toolName: typeof message.toolName === "string" ? message.toolName : "",
				text,
				isError: message.isError === true,
			});
		}
	}
	return evidence;
}

function isExactSyntheticPolicyAbort(call: SessionEvidence["assistantToolCalls"][number]): boolean {
	return (
		call.toolCalls.length === 0 &&
		call.name === "" &&
		call.stopReason === "aborted" &&
		call.errorMessage === "Request was aborted" &&
		call.emptyAbortContent &&
		call.zeroUsage
	);
}

function exactToolResultLink(
	result: SessionEvidence["toolResults"][number] | undefined,
	call: SessionEvidence["assistantToolCalls"][number]["toolCalls"][number] | undefined,
): boolean {
	return Boolean(
		result &&
			call &&
			result.toolCallId === call.id &&
			result.toolName === call.name &&
			call.name === STOCK_INTERFACE_PARITY_TOOL_NAME,
	);
}

interface ExactSingleToolLocalAbortEvidence {
	providerCalls: number;
	boundaryCall: SessionEvidence["assistantToolCalls"][number]["toolCalls"][number];
	boundaryResult: SessionEvidence["toolResults"][number];
}

function exactSingleToolLocalAbortEvidence(input: {
	result: StockTrajectoryResult;
	session: SessionEvidence;
}): ExactSingleToolLocalAbortEvidence | null {
	const { result, session } = input;
	const providerCalls = result.providerTracker.providerCalls;
	if (
		providerCalls < 1 ||
		providerCalls > 4 ||
		result.providerTracker.blockedProviderCalls !== 1 ||
		!exactStringArray(result.providerTracker.blockedReasons, ["forbidden-tool-execution"]) ||
		result.trace.callCount !== providerCalls - 1 ||
		result.trace.requests.length !== providerCalls - 1 ||
		session.assistantToolCalls.length !== providerCalls + 1 ||
		session.toolResults.length !== providerCalls ||
		!isExactSyntheticPolicyAbort(session.assistantToolCalls[providerCalls]!)
	) {
		return null;
	}
	const calls = session.assistantToolCalls.slice(0, providerCalls);
	if (
		calls.some((call) => call.toolCalls.length !== 1 || call.stopReason !== "toolUse" || call.errorMessage !== null)
	) {
		return null;
	}
	for (let index = 0; index < providerCalls - 1; index++) {
		const call = calls[index]?.toolCalls[0];
		const toolResult = session.toolResults[index];
		if (
			!exactToolResultLink(toolResult, call) ||
			toolResult?.isError ||
			canonicalJson(toJsonValue(call?.arguments)) !== canonicalJson(toJsonValue(result.trace.requests[index]))
		) {
			return null;
		}
	}
	const boundaryCall = calls[providerCalls - 1]?.toolCalls[0];
	const boundaryResult = session.toolResults[providerCalls - 1];
	if (
		!boundaryCall ||
		!boundaryResult ||
		boundaryResult.toolCallId !== boundaryCall.id ||
		boundaryResult.toolName !== boundaryCall.name ||
		!boundaryResult.isError
	) {
		return null;
	}
	const host = result.hostTerminalizationTracker;
	if (
		!host ||
		host.providerDispatches !== providerCalls ||
		host.evaluatorToolCalls !== providerCalls - 1 ||
		!exactStringArray(host.forbiddenBoundaryEvents, [`${boundaryCall.name} call ${boundaryCall.id}`]) ||
		!exactStringArray(
			host.seenToolCallIds,
			calls.map((call) => call.toolCalls[0]!.id),
		)
	) {
		return null;
	}
	return { providerCalls, boundaryCall, boundaryResult };
}

function detectSchemaRejectedLocalAbort(input: {
	result: StockTrajectoryResult;
	session: SessionEvidence;
}): string | null {
	const evidence = exactSingleToolLocalAbortEvidence(input);
	if (
		!evidence ||
		evidence.providerCalls === 1 ||
		evidence.boundaryCall.name !== STOCK_INTERFACE_PARITY_TOOL_NAME ||
		evidence.boundaryResult.text !== SCHEMA_REJECTED_POLICY_FAILURE
	) {
		return null;
	}
	let rejectedRequest: StockCpuEvaluationRequest;
	try {
		rejectedRequest = parseStockCpuEvaluationRequest(evidence.boundaryCall.arguments);
	} catch {
		return null;
	}
	if (rejectedRequest.actions.length <= 46) return null;
	try {
		assertCompilerGymIrDeltaScreenRequestPolicy(evidence.providerCalls, rejectedRequest);
		return null;
	} catch (error) {
		if (!(error instanceof Error) || error.message !== SCHEMA_REJECTED_POLICY_FAILURE) return null;
	}
	return SCHEMA_REJECTED_POLICY_FAILURE;
}

function detectRunnerPolicyLocalAbort(input: {
	result: StockTrajectoryResult;
	session: SessionEvidence;
}): string | null {
	const evidence = exactSingleToolLocalAbortEvidence(input);
	if (
		!evidence ||
		evidence.providerCalls === 1 ||
		evidence.boundaryCall.name !== STOCK_INTERFACE_PARITY_TOOL_NAME ||
		evidence.boundaryResult.text !== REPEATED_VECTOR_POLICY_FAILURE
	) {
		return null;
	}
	let rejectedRequest: StockCpuEvaluationRequest;
	try {
		rejectedRequest = parseStockCpuEvaluationRequest(evidence.boundaryCall.arguments);
		assertCompilerGymIrDeltaScreenRequestPolicy(evidence.providerCalls, rejectedRequest);
	} catch {
		return null;
	}
	const rejectedDigest = sha256Json(rejectedRequest.actions);
	if (!input.result.trace.requests.some((request) => sha256Json(request.actions) === rejectedDigest)) return null;
	return REPEATED_VECTOR_POLICY_FAILURE;
}

function detectWrongToolLocalAbort(input: { result: StockTrajectoryResult; session: SessionEvidence }): string | null {
	const evidence = exactSingleToolLocalAbortEvidence(input);
	if (
		!evidence ||
		!evidence.boundaryCall.name ||
		evidence.boundaryCall.name === STOCK_INTERFACE_PARITY_TOOL_NAME ||
		evidence.boundaryResult.text !== `Tool ${evidence.boundaryCall.name} not found`
	) {
		return null;
	}
	return `scientific-policy-nonconformance: assistant called unavailable tool ${evidence.boundaryCall.name}`;
}

function detectMultipleToolLocalAbort(input: {
	result: StockTrajectoryResult;
	session: SessionEvidence;
}): string | null {
	const { result, session } = input;
	const providerCalls = result.providerTracker.providerCalls;
	if (
		providerCalls < 1 ||
		providerCalls > 4 ||
		result.providerTracker.blockedProviderCalls !== 1 ||
		!exactStringArray(result.providerTracker.blockedReasons, ["forbidden-tool-execution"]) ||
		(result.trace.callCount !== providerCalls && result.trace.callCount !== providerCalls - 1) ||
		result.trace.requests.length !== result.trace.callCount ||
		session.assistantToolCalls.length !== providerCalls + 1 ||
		session.toolResults.length !== providerCalls + 1 ||
		!isExactSyntheticPolicyAbort(session.assistantToolCalls.at(-1)!)
	) {
		return null;
	}
	const responses = session.assistantToolCalls.slice(0, -1);
	const multipleResponses = responses.filter((response) => response.toolCalls.length === 2);
	if (
		multipleResponses.length !== 1 ||
		responses.at(-1) !== multipleResponses[0] ||
		responses.some(
			(response) =>
				(response.toolCalls.length !== 1 && response.toolCalls.length !== 2) ||
				response.stopReason !== "toolUse" ||
				response.errorMessage !== null ||
				response.toolCalls.some((call) => call.name !== STOCK_INTERFACE_PARITY_TOOL_NAME),
		)
	) {
		return null;
	}
	const flattenedCalls = responses.flatMap((response) => response.toolCalls);
	if (
		flattenedCalls.length !== providerCalls + 1 ||
		new Set(flattenedCalls.map((call) => call.id)).size !== flattenedCalls.length ||
		!exactStringArray(
			result.hostTerminalizationTracker?.seenToolCallIds ?? [],
			flattenedCalls.map((call) => call.id),
		)
	) {
		return null;
	}
	const linkedResults = flattenedCalls.map((call, index) => ({ call, result: session.toolResults[index] }));
	if (linkedResults.some(({ call, result: toolResult }) => !exactToolResultLink(toolResult, call))) return null;
	const successful = linkedResults.filter(({ result: toolResult }) => !toolResult?.isError);
	if (successful.length !== result.trace.requests.length) return null;
	for (const [index, entry] of successful.entries()) {
		let request: StockCpuEvaluationRequest;
		try {
			request = parseStockCpuEvaluationRequest(entry.call.arguments);
			assertCompilerGymIrDeltaScreenRequestPolicy(index + 1, request);
		} catch {
			return null;
		}
		if (canonicalJson(toJsonValue(request)) !== canonicalJson(toJsonValue(result.trace.requests[index]))) {
			return null;
		}
	}
	const errors = linkedResults.filter(({ result: toolResult }) => toolResult?.isError);
	const multipleCallIds = new Set(multipleResponses[0]?.toolCalls.map((call) => call.id) ?? []);
	if (errors.some((entry) => !multipleCallIds.has(entry.call.id))) return null;
	if (result.trace.callCount === providerCalls) {
		if (errors.length !== 1 || errors[0]?.call.id !== multipleResponses[0]?.toolCalls[1]?.id) {
			return null;
		}
		const error = errors[0]!;
		try {
			const rejectedRequest = parseStockCpuEvaluationRequest(error.call.arguments);
			if (error.result?.text === MULTIPLE_TOOL_GUARD_ERROR) {
				assertCompilerGymIrDeltaScreenRequestPolicy(providerCalls, rejectedRequest);
			} else if (error.result?.text === SCHEMA_REJECTED_POLICY_FAILURE) {
				if (rejectedRequest.actions.length <= 46) return null;
				try {
					assertCompilerGymIrDeltaScreenRequestPolicy(providerCalls, rejectedRequest);
					return null;
				} catch (policyError) {
					if (!(policyError instanceof Error) || policyError.message !== SCHEMA_REJECTED_POLICY_FAILURE) {
						return null;
					}
				}
			} else {
				return null;
			}
		} catch {
			return null;
		}
	} else {
		if (errors.length !== 2) return null;
		const [firstError, secondError] = errors;
		if (
			firstError?.call.id !== multipleResponses[0]?.toolCalls[0]?.id ||
			secondError?.call.id !== multipleResponses[0]?.toolCalls[1]?.id ||
			firstError.result?.text !== SCHEMA_REJECTED_POLICY_FAILURE
		) {
			return null;
		}
		for (const entry of secondError.result?.text === SCHEMA_REJECTED_POLICY_FAILURE ? errors : [firstError]) {
			try {
				const rejectedRequest = parseStockCpuEvaluationRequest(entry.call.arguments);
				if (rejectedRequest.actions.length <= 46) return null;
				assertCompilerGymIrDeltaScreenRequestPolicy(providerCalls, rejectedRequest);
				return null;
			} catch (error) {
				if (!(error instanceof Error) || error.message !== SCHEMA_REJECTED_POLICY_FAILURE) return null;
			}
		}
		if (secondError.result?.text === STOCK_INTERFACE_PARITY_SAME_RESPONSE_LATCH_ERROR) {
			try {
				const suppressedRequest = parseStockCpuEvaluationRequest(secondError.call.arguments);
				assertCompilerGymIrDeltaScreenRequestPolicy(providerCalls, suppressedRequest);
			} catch {
				return null;
			}
		} else if (secondError.result?.text !== SCHEMA_REJECTED_POLICY_FAILURE) {
			return null;
		}
	}
	const host = result.hostTerminalizationTracker;
	if (
		!host ||
		host.providerDispatches !== providerCalls ||
		host.evaluatorToolCalls !== result.trace.callCount ||
		!exactStringArray(
			host.forbiddenBoundaryEvents,
			errors.map((entry) => `${STOCK_INTERFACE_PARITY_TOOL_NAME} call ${entry.call.id}`),
		)
	) {
		return null;
	}
	return MULTIPLE_TOOL_POLICY_FAILURE;
}

export async function prepareCompilerGymLateNoveltyScreenRun(input: {
	preregistrationPath: string;
	repoRoot?: string;
}): Promise<CompilerGymLateNoveltyRunnerPreflight> {
	const repoRoot = resolve(input.repoRoot ?? fileURLToPath(new URL("../../..", import.meta.url)));
	const preregistrationPath = resolve(input.preregistrationPath);
	await assertPrivateRegularFile(preregistrationPath, "Late-novelty paid-screen preregistration");
	const preregistrationContents = await readFile(preregistrationPath, "utf8");
	const implementationClosure = await collectCompilerGymLateNoveltyScreenImplementationClosure(repoRoot);
	const stockBundle = await computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle(repoRoot);
	const runtimeWorktreeSnapshot = capturePrimeRuntimeWorktreeSnapshot(repoRoot);
	const providerRegistryClosure = await captureCompilerGymLateNoveltyProviderRegistryClosure(getAgentDir());
	const preregistration = parseCompilerGymLateNoveltyScreenPreregistration(
		JSON.parse(preregistrationContents) as unknown,
		implementationClosure,
		stockBundle.sha256,
		runtimeWorktreeSnapshot,
		providerRegistryClosure,
	);
	if (`${canonicalJson(toJsonValue(preregistration))}\n` !== preregistrationContents) {
		throw new Error("Late-novelty preregistration is not canonical newline-terminated JSON");
	}
	const preregistrationSha256 = sha256Text(preregistrationContents);
	await verifyCompilerGymLateNoveltyScreenPrerequisites(repoRoot);
	const implementationBundleSha256 = sha256Json(implementationClosure);
	if (implementationBundleSha256 !== preregistration.implementationBundleSha256) {
		throw new Error("Late-novelty implementation closure drifted at preflight");
	}
	if (stockBundle.sha256 !== preregistration.stockTrajectoryImplementationBundleSha256) {
		throw new Error("Late-novelty stock trajectory implementation bundle drifted at preflight");
	}
	const globalAttemptLockPath = compilerGymLateNoveltyGlobalAttemptLockPath(repoRoot);
	const providerRequestAnchorPath = `${preregistrationPath}.provider-request-anchor.json`;
	for (const path of [globalAttemptLockPath, providerRequestAnchorPath]) {
		if (await pathExists(path)) throw new Error(`Late-novelty preregistration was already attempted: ${path}`);
	}
	for (const arm of preregistration.randomization.armOrder) {
		for (let providerDispatchOrdinal = 1; providerDispatchOrdinal <= 4; providerDispatchOrdinal++) {
			const anchor = runtimeDispatchAnchorPath({ providerRequestAnchorPath, arm, providerDispatchOrdinal });
			if (await pathExists(anchor)) {
				throw new Error(`Late-novelty preregistration already has a provider-dispatch anchor: ${anchor}`);
			}
		}
	}
	const evaluatorScriptPath = resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const additionalSourcePaths = compilerGymLateNoveltyStockAdditionalSourcePaths(repoRoot);
	return {
		repoRoot,
		preregistrationPath,
		preregistrationSha256,
		preregistration,
		implementationClosure,
		implementationBundleSha256,
		stockTrajectoryImplementationBundleSha256: stockBundle.sha256,
		runtimeWorktreeSnapshot,
		runtimeWorktreeSnapshotSha256: sha256Json(runtimeWorktreeSnapshot),
		providerRegistryClosure,
		additionalSourcePaths,
		globalAttemptLockPath,
		providerRequestAnchorPath,
		calibrationResultPath: resolve(repoRoot, preregistration.frozenCommon.calibration.path),
		evaluatorScriptPath,
	};
}

export function createCompilerGymLateNoveltyPairAnchorLoader(
	preflight: CompilerGymLateNoveltyRunnerPreflight,
): PairPreregistrationLoader {
	return async (input): Promise<PairPreregistrationAnchor> => {
		if (resolve(input.path) !== preflight.preregistrationPath) {
			throw new Error("Late-novelty pair loader path drifted");
		}
		if (input.promptSha256 !== preflight.preregistration.frozenCommon.promptSha256) {
			throw new Error("Late-novelty pair loader prompt drifted");
		}
		if (input.implementationBundleSha256 !== preflight.stockTrajectoryImplementationBundleSha256) {
			throw new Error("Late-novelty stock trajectory bundle drifted");
		}
		if (!preflight.preregistration.randomization.armOrder.includes(input.armId as CompilerGymLateNoveltyScreenArm)) {
			throw new Error("Late-novelty pair loader received an unknown arm");
		}
		const contents = await readFile(preflight.preregistrationPath, "utf8");
		if (sha256Text(contents) !== preflight.preregistrationSha256) {
			throw new Error("Late-novelty preregistration drifted after preflight");
		}
		return {
			path: preflight.preregistrationPath,
			sha256: preflight.preregistrationSha256,
			id: preflight.preregistration.pairId,
			armId: input.armId,
			record: preflight.preregistration,
		};
	};
}

export async function claimCompilerGymLateNoveltyGlobalAttempt(input: {
	preflight: CompilerGymLateNoveltyRunnerPreflight;
	outputDir: string;
	firstArm: CompilerGymLateNoveltyScreenArm;
	createdAt: string;
}): Promise<string> {
	await mkdir(dirname(input.preflight.globalAttemptLockPath), { recursive: true, mode: 0o700 });
	return writeExclusivePrivateJson(input.preflight.globalAttemptLockPath, {
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		pairId: input.preflight.preregistration.pairId,
		preregistrationPath: input.preflight.preregistrationPath,
		preregistrationSha256: input.preflight.preregistrationSha256,
		implementationBundleSha256: input.preflight.implementationBundleSha256,
		stockTrajectoryImplementationBundleSha256: input.preflight.stockTrajectoryImplementationBundleSha256,
		runtimeWorktreeSnapshotSha256: input.preflight.runtimeWorktreeSnapshotSha256,
		providerRegistryClosure: input.preflight.providerRegistryClosure,
		providerSpec: input.preflight.preregistration.providerSpec,
		providerSpecSha256: input.preflight.preregistration.providerSpecSha256,
		randomizedArmOrder: input.preflight.preregistration.randomization.armOrder,
		firstArm: input.firstArm,
		outputDir: resolve(input.outputDir),
		providerRequestAnchorPath: input.preflight.providerRequestAnchorPath,
		budgets: input.preflight.preregistration.budgets,
		createdAt: input.createdAt,
	});
}

export async function claimCompilerGymLateNoveltyArmAttempt(input: {
	preflight: CompilerGymLateNoveltyRunnerPreflight;
	arm: CompilerGymLateNoveltyScreenArm;
	armOrdinal: number;
	armOutputDir: string;
	globalAttemptLockSha256: string;
	armPreregistrationSha256: string;
	promptSha256: string;
	createdAt: string;
}): Promise<{ path: string; sha256: string }> {
	const path = join(resolve(input.armOutputDir), "attempt.lock");
	const sha256 = await writeExclusivePrivateJson(path, {
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		pairId: input.preflight.preregistration.pairId,
		arm: input.arm,
		armOrdinal: input.armOrdinal,
		globalAttemptLockSha256: input.globalAttemptLockSha256,
		armPreregistrationSha256: input.armPreregistrationSha256,
		promptSha256: input.promptSha256,
		providerSpecSha256: input.preflight.preregistration.providerSpecSha256,
		createdAt: input.createdAt,
	});
	return { path, sha256 };
}

async function verifyLivePreDispatchState(preflight: CompilerGymLateNoveltyRunnerPreflight): Promise<void> {
	const [closure, stockBundle, registry, preregistrationContents] = await Promise.all([
		collectCompilerGymLateNoveltyScreenImplementationClosure(preflight.repoRoot),
		computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle(preflight.repoRoot),
		captureCompilerGymLateNoveltyProviderRegistryClosure(getAgentDir()),
		readFile(preflight.preregistrationPath, "utf8"),
	]);
	const runtimeSnapshot = capturePrimeRuntimeWorktreeSnapshot(preflight.repoRoot);
	parseCompilerGymLateNoveltyScreenPreregistration(
		JSON.parse(preregistrationContents) as unknown,
		closure,
		stockBundle.sha256,
		runtimeSnapshot,
		registry,
	);
	if (sha256Text(preregistrationContents) !== preflight.preregistrationSha256) {
		throw new Error("Late-novelty preregistration drifted immediately before dispatch");
	}
	if (sha256Json(closure) !== preflight.implementationBundleSha256) {
		throw new Error("Late-novelty implementation closure drifted immediately before dispatch");
	}
	if (stockBundle.sha256 !== preflight.stockTrajectoryImplementationBundleSha256) {
		throw new Error("Late-novelty stock trajectory bundle drifted immediately before dispatch");
	}
	if (sha256Json(runtimeSnapshot) !== preflight.runtimeWorktreeSnapshotSha256) {
		throw new Error("Late-novelty runtime worktree drifted immediately before dispatch");
	}
	if (canonicalJson(toJsonValue(registry)) !== canonicalJson(toJsonValue(preflight.providerRegistryClosure))) {
		throw new Error("Late-novelty provider registry closure drifted immediately before dispatch");
	}
	await verifyCompilerGymLateNoveltyScreenPrerequisites(preflight.repoRoot);
}

export type CompilerGymLateNoveltyLiveEnvironmentGateRecord =
	| {
			outcome: "passed";
			evidence: CompilerGymPaidLiveEnvironmentGateEvidence;
			failure: null;
	  }
	| {
			outcome: "failed";
			evidence: null;
			failure: string;
	  };

export function createCompilerGymLateNoveltyPreDispatchProviderGate(input: {
	maximumProviderDispatches: number;
	currentProviderDispatches: () => number;
	liveEnvironmentGate: () => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	recordLiveEnvironmentGate: (
		record: CompilerGymLateNoveltyLiveEnvironmentGateRecord,
		providerDispatchOrdinal: number,
	) => Promise<void>;
	guardedProviderRequestGate: StockInterfaceParityProviderRequestGate;
	recordProviderDispatch: () => void;
}): StockInterfaceParityProviderRequestGate {
	if (!Number.isSafeInteger(input.maximumProviderDispatches) || input.maximumProviderDispatches < 1) {
		throw new Error("Late-novelty provider cap must be a positive safe integer");
	}
	return async (request) => {
		const currentProviderDispatches = input.currentProviderDispatches();
		if (!Number.isSafeInteger(currentProviderDispatches) || currentProviderDispatches < 0) {
			throw new Error("Late-novelty aggregate provider accounting is invalid");
		}
		if (currentProviderDispatches >= input.maximumProviderDispatches) {
			return { allowed: false, reason: "late-novelty aggregate provider cap reached" };
		}
		let liveEnvironmentEvidence: CompilerGymPaidLiveEnvironmentGateEvidence;
		try {
			liveEnvironmentEvidence = await input.liveEnvironmentGate();
		} catch (error) {
			await input.recordLiveEnvironmentGate(
				{ outcome: "failed", evidence: null, failure: errorText(error) },
				request.providerDispatchOrdinal,
			);
			throw error;
		}
		await input.recordLiveEnvironmentGate(
			{ outcome: "passed", evidence: liveEnvironmentEvidence, failure: null },
			request.providerDispatchOrdinal,
		);
		const gate = await input.guardedProviderRequestGate(request);
		if (gate.allowed) input.recordProviderDispatch();
		return gate;
	};
}

async function verifyProviderPairAnchorBeforeSecondArm(
	preflight: CompilerGymLateNoveltyRunnerPreflight,
	expectedSha256: string,
): Promise<void> {
	await assertPrivateRegularFile(preflight.providerRequestAnchorPath, "Late-novelty provider pair anchor");
	const contents = await readFile(preflight.providerRequestAnchorPath, "utf8");
	if (sha256Text(contents) !== expectedSha256) throw new Error("Late-novelty provider pair anchor hash drifted");
	const anchor: unknown = JSON.parse(contents);
	if (
		!isRecord(anchor) ||
		anchor.runnerProtocol !== COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL ||
		anchor.pairId !== preflight.preregistration.pairId ||
		anchor.preregistrationSha256 !== preflight.preregistrationSha256 ||
		anchor.specSha256 !== preflight.preregistration.providerSpecSha256 ||
		canonicalJson(toJsonValue(anchor.spec)) !== canonicalJson(toJsonValue(preflight.preregistration.providerSpec)) ||
		anchor.expectedSnapshotSha256 !== preflight.runtimeWorktreeSnapshotSha256 ||
		typeof anchor.firstProviderRequestBody !== "string" ||
		sha256Text(anchor.firstProviderRequestBody) !== anchor.firstProviderRequestBodySha256 ||
		!isRecord(anchor.resolvedModel) ||
		validateCompilerGymHardenedPaidResolvedModelSnapshot(
			anchor.resolvedModel as unknown as Parameters<typeof validateCompilerGymHardenedPaidResolvedModelSnapshot>[0],
		).length !== 0 ||
		sha256Json(anchor.resolvedModel) !== anchor.resolvedModelSha256
	) {
		throw new Error("Late-novelty provider pair anchor claims drifted before the second arm");
	}
}

const POLICY_ALLOWED_OPERATIONAL_FAILURES = new Set([
	"exactJobCount",
	"exactToolCalls",
	"exactProviderCalls",
	"providerTrackerConsistent",
	"providerBudgetUnblocked",
	"exactHostTerminalizationStop",
	"noDuplicateDispatch",
	"exactLineage",
	"exactLogicalTaskBudget",
	"exactActualTaskBudget",
	"exactFeedbackResults",
	"noForbiddenBoundaryEvents",
	"measurementQualified",
	"terminalizationRuntimeConformant",
]);

const SEMANTIC_REJECTION_ALLOWED_OPERATIONAL_FAILURES = new Set([
	"measurementQualified",
	"terminalizationRuntimeConformant",
]);

export interface CompilerGymLateNoveltyAccountingInput {
	policyPrefixKind: CompilerGymLateNoveltyPolicyPrefixKind;
	providerCalls: number;
	blockedProviderCalls: number;
	blockedReasons: readonly string[];
	evaluatorCalls: number;
	requestCount: number;
	jobIdCount: number;
	feedbackCount: number;
	jobCount: number;
	submissions: number;
	taskEvaluations: number;
	actualTaskEvaluations: number;
	reusedTaskEvaluations: number;
	unevaluatedTaskEvaluations: number;
	duplicateCount: number;
	assistantResponseCount: number;
	syntheticPolicyAbortCount: number;
}

export function assessCompilerGymLateNoveltyAccounting(input: CompilerGymLateNoveltyAccountingInput): {
	complete: boolean;
	mode: "admitted-exact" | "scientific-policy-prefix";
} {
	const common =
		input.requestCount === input.evaluatorCalls &&
		input.jobIdCount === input.evaluatorCalls &&
		input.feedbackCount === input.evaluatorCalls &&
		input.jobCount === input.evaluatorCalls &&
		input.submissions === input.evaluatorCalls &&
		input.taskEvaluations === input.evaluatorCalls * STOCK_CPU_TASKS.length &&
		input.actualTaskEvaluations === input.evaluatorCalls * STOCK_CPU_TASKS.length &&
		input.reusedTaskEvaluations === 0 &&
		input.unevaluatedTaskEvaluations === 0 &&
		input.duplicateCount === 0;
	if (input.policyPrefixKind !== "none") {
		const singleToolLocalAbort =
			input.policyPrefixKind === "schema-rejected-local-abort" ||
			input.policyPrefixKind === "runner-policy-local-abort" ||
			input.policyPrefixKind === "wrong-tool-local-abort";
		const localAbortTaxonomy =
			input.blockedProviderCalls === 1 &&
			exactStringArray(input.blockedReasons, ["forbidden-tool-execution"]) &&
			input.syntheticPolicyAbortCount === 1 &&
			input.assistantResponseCount === input.providerCalls + 1;
		const directStopTaxonomy =
			input.blockedProviderCalls === 0 &&
			input.blockedReasons.length === 0 &&
			input.syntheticPolicyAbortCount === 0 &&
			input.assistantResponseCount === input.providerCalls;
		return {
			mode: "scientific-policy-prefix",
			complete:
				common &&
				input.providerCalls >= 1 &&
				input.providerCalls <= 4 &&
				(singleToolLocalAbort
					? input.evaluatorCalls >= 0 &&
						input.evaluatorCalls <= 3 &&
						input.providerCalls === input.evaluatorCalls + 1 &&
						localAbortTaxonomy
					: input.policyPrefixKind === "multiple-tool-local-abort"
						? input.evaluatorCalls >= 0 &&
							input.evaluatorCalls <= 4 &&
							(input.providerCalls === input.evaluatorCalls ||
								input.providerCalls === input.evaluatorCalls + 1) &&
							localAbortTaxonomy
						: input.policyPrefixKind === "direct-stop" &&
							input.evaluatorCalls >= 0 &&
							input.evaluatorCalls <= 3 &&
							input.providerCalls === input.evaluatorCalls + 1 &&
							directStopTaxonomy),
		};
	}
	return {
		mode: "admitted-exact",
		complete:
			common &&
			input.providerCalls === 4 &&
			input.blockedProviderCalls === 0 &&
			input.blockedReasons.length === 0 &&
			input.evaluatorCalls === 4 &&
			input.assistantResponseCount === 4 &&
			input.syntheticPolicyAbortCount === 0,
	};
}

function exactStringArray(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function exactRecordKeys(actual: Record<string, unknown>, expected: readonly string[]): boolean {
	return exactStringArray(Object.keys(actual).sort(), [...expected].sort());
}

function acceptedFeedback(value: unknown): boolean {
	if (
		!isRecord(value) ||
		!isRecord(value.job) ||
		!isRecord(value.job.state) ||
		value.job.state.status !== "succeeded"
	) {
		return false;
	}
	const measurement = value.job.measurement;
	if (!isRecord(measurement) || !Array.isArray(measurement.tasks)) return false;
	const tasks: unknown[] = measurement.tasks;
	return STOCK_CPU_TASKS.every((benchmarkId) => {
		const matches = tasks.filter(
			(task): task is Record<string, unknown> => isRecord(task) && task.benchmarkId === benchmarkId,
		);
		return (
			matches.length === 1 &&
			matches[0]?.status === "accepted" &&
			isRecord(matches[0].verifier) &&
			matches[0].verifier.passed === true
		);
	});
}

async function auditAttemptLocks(input: {
	result: StockTrajectoryResult;
	arm: CompilerGymLateNoveltyScreenArm;
	armOutputDir: string;
	preflight: CompilerGymLateNoveltyRunnerPreflight;
}): Promise<string[]> {
	const failures: string[] = [];
	const anchor = input.result.promptDispatchAttemptAnchor;
	if (!isRecord(anchor)) return ["prompt-dispatch attempt anchor is absent"];
	for (const field of [
		"globalAttemptLockPath",
		"globalAttemptLockSha256",
		"armAttemptLockPath",
		"armAttemptLockSha256",
	] as const) {
		if (typeof anchor[field] !== "string") failures.push(`prompt-dispatch attempt anchor lacks ${field}`);
	}
	if (failures.length) return failures;
	const globalPath = anchor.globalAttemptLockPath as string;
	const armPath = anchor.armAttemptLockPath as string;
	if (resolve(globalPath) !== input.preflight.globalAttemptLockPath) failures.push("global attempt-lock path drifted");
	if (resolve(armPath) !== join(resolve(input.armOutputDir), "attempt.lock"))
		failures.push("arm attempt-lock path drifted");
	for (const [path, expectedSha256, label] of [
		[globalPath, anchor.globalAttemptLockSha256 as string, "global attempt lock"],
		[armPath, anchor.armAttemptLockSha256 as string, "arm attempt lock"],
	] as const) {
		try {
			await assertPrivateRegularFile(path, label);
			const contents = await readFile(path, "utf8");
			if (sha256Text(contents) !== expectedSha256) failures.push(`${label} hash drifted`);
			const record: unknown = JSON.parse(contents);
			if (!isRecord(record) || record.protocol !== COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL) {
				failures.push(`${label} protocol drifted`);
			}
			if (
				label === "global attempt lock" &&
				(!isRecord(record) ||
					record.pairId !== input.preflight.preregistration.pairId ||
					record.preregistrationPath !== input.preflight.preregistrationPath ||
					record.preregistrationSha256 !== input.preflight.preregistrationSha256 ||
					record.providerSpecSha256 !== input.preflight.preregistration.providerSpecSha256 ||
					record.stockTrajectoryImplementationBundleSha256 !==
						input.preflight.stockTrajectoryImplementationBundleSha256)
			) {
				failures.push("global attempt-lock claims drifted");
			}
			if (
				label === "arm attempt lock" &&
				(!isRecord(record) ||
					record.arm !== input.arm ||
					record.globalAttemptLockSha256 !== anchor.globalAttemptLockSha256 ||
					record.providerSpecSha256 !== input.preflight.preregistration.providerSpecSha256 ||
					record.promptSha256 !== input.preflight.preregistration.frozenCommon.promptSha256)
			) {
				failures.push("arm attempt-lock claims drifted");
			}
		} catch (error) {
			failures.push(`${label} verification failed: ${errorText(error)}`);
		}
	}
	return failures;
}

async function auditProviderEvidence(input: {
	evidence: CompilerGymHardenedPaidProviderEvidence<CompilerGymLateNoveltyScreenArm>;
	arm: CompilerGymLateNoveltyScreenArm;
	preflight: CompilerGymLateNoveltyRunnerPreflight;
	expectedDispatches: number;
}): Promise<string[]> {
	const failures: string[] = [];
	const { evidence, preflight } = input;
	for (const [passed, message] of [
		[evidence.arm === input.arm, "provider evidence arm drifted"],
		[evidence.specSha256 === preflight.preregistration.providerSpecSha256, "provider spec hash drifted"],
		[evidence.systemPromptEvents === 1, "provider system-prompt event count drifted"],
		[evidence.workingDirectoryReplacements === 1, "provider workspace normalization count drifted"],
		[evidence.conversationLogReplacements === 1, "provider session-path normalization count drifted"],
		[evidence.normalizedSystemPromptMatchedPairAnchor === true, "normalized system prompt missed pair anchor"],
		[evidence.firstProviderRequestBodyMatchedPairAnchor === true, "first request missed pair anchor"],
		[evidence.firstResolvedModelMatchedPairAnchor === true, "resolved model missed pair anchor"],
		[
			evidence.providerRequestBodySha256s.length === input.expectedDispatches,
			"provider request evidence count drifted",
		],
		[
			evidence.resolvedModelSnapshotSha256s.length === input.expectedDispatches,
			"resolved model evidence count drifted",
		],
		[
			evidence.runtimeWorktreeSnapshotSha256s.length === input.expectedDispatches,
			"runtime snapshot evidence count drifted",
		],
		[
			evidence.runtimeWorktreeSnapshotMatchesPreregistration.length === input.expectedDispatches &&
				evidence.runtimeWorktreeSnapshotMatchesPreregistration.every(Boolean),
			"runtime snapshot preregistration match drifted",
		],
		[
			evidence.runtimeWorktreeDispatchAnchors.length === input.expectedDispatches,
			"runtime dispatch-anchor count drifted",
		],
		[
			evidence.guidanceExposureByDispatch.length === input.expectedDispatches,
			"provider guidance-exposure count drifted",
		],
		[
			evidence.providerRequestTranscriptAnchors.length === input.expectedDispatches,
			"provider transcript-anchor count drifted",
		],
		[evidence.failures.length === 0, `provider guard failures: ${evidence.failures.join("; ")}`],
	] as const) {
		if (!passed) failures.push(message);
	}
	if (evidence.runtimeWorktreeSnapshotSha256s.some((sha256) => sha256 !== preflight.runtimeWorktreeSnapshotSha256)) {
		failures.push("provider runtime snapshot hash drifted");
	}
	try {
		await assertPrivateRegularFile(evidence.providerRequestAnchorPath, "Provider pair anchor");
		const contents = await readFile(evidence.providerRequestAnchorPath, "utf8");
		if (sha256Text(contents) !== evidence.providerRequestAnchorSha256)
			failures.push("provider pair anchor hash drifted");
		const anchor: unknown = JSON.parse(contents);
		if (
			!isRecord(anchor) ||
			anchor.specSha256 !== preflight.preregistration.providerSpecSha256 ||
			anchor.preregistrationSha256 !== preflight.preregistrationSha256 ||
			anchor.expectedSnapshotSha256 !== preflight.runtimeWorktreeSnapshotSha256 ||
			!isRecord(anchor.resolvedModel) ||
			validateCompilerGymHardenedPaidResolvedModelSnapshot(
				anchor.resolvedModel as unknown as Parameters<
					typeof validateCompilerGymHardenedPaidResolvedModelSnapshot
				>[0],
			).length !== 0 ||
			sha256Json(anchor.resolvedModel) !== anchor.resolvedModelSha256 ||
			evidence.resolvedModelSnapshotSha256s.some((sha256) => sha256 !== anchor.resolvedModelSha256)
		) {
			failures.push("provider pair anchor model/spec/worktree claims drifted");
		}
	} catch (error) {
		failures.push(`provider pair anchor audit failed: ${errorText(error)}`);
	}
	for (const [index, dispatch] of evidence.runtimeWorktreeDispatchAnchors.entries()) {
		try {
			await assertPrivateRegularFile(dispatch.path, `Provider runtime anchor ${index + 1}`);
			const contents = await readFile(dispatch.path, "utf8");
			if (sha256Text(contents) !== dispatch.sha256)
				failures.push(`provider runtime anchor ${index + 1} hash drifted`);
			const anchor: unknown = JSON.parse(contents);
			if (
				!isRecord(anchor) ||
				anchor.runnerProtocol !== COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL ||
				anchor.pairId !== preflight.preregistration.pairId ||
				anchor.specSha256 !== preflight.preregistration.providerSpecSha256 ||
				anchor.arm !== input.arm ||
				anchor.providerDispatchOrdinal !== index + 1 ||
				anchor.runtimeSha256 !== preflight.runtimeWorktreeSnapshotSha256 ||
				anchor.expectedSnapshotSha256 !== preflight.runtimeWorktreeSnapshotSha256 ||
				anchor.matched !== true ||
				sha256Json(anchor.runtimeSnapshot) !== anchor.runtimeSha256
			) {
				failures.push(`provider runtime anchor ${index + 1} claims drifted`);
			}
		} catch (error) {
			failures.push(`provider runtime anchor ${index + 1} audit failed: ${errorText(error)}`);
		}
	}
	return failures;
}

interface ProviderTranscriptHistoryItem {
	assistantItems: unknown[];
	rawCallId: string;
	responseItemId: string;
	durableToolCallId: string;
	name: string;
	argumentsJson: string;
	output: string;
}

function shortProviderHistoryHash(value: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function sanitizeProviderHistoryText(value: string): string {
	return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function parseProviderTextSignature(signature: string | null): { id: string; phase?: string } | null {
	if (!signature) return null;
	if (signature.startsWith("{")) {
		try {
			const parsed: unknown = JSON.parse(signature);
			if (isRecord(parsed) && parsed.v === 1 && typeof parsed.id === "string") {
				return parsed.phase === "commentary" || parsed.phase === "final_answer"
					? { id: parsed.id, phase: parsed.phase }
					: { id: parsed.id };
			}
		} catch {
			// The provider treats malformed structured signatures as legacy IDs.
		}
	}
	return { id: signature };
}

function expectedProviderAssistantItems(
	response: SessionEvidence["assistantToolCalls"][number],
	turnIndex: number,
): unknown[] {
	const items: unknown[] = [];
	for (const block of response.contentBlocks) {
		if (block.type === "thinking") {
			if (block.thinkingSignature === null) continue;
			const reasoning: unknown = JSON.parse(block.thinkingSignature);
			if (!isRecord(reasoning) || reasoning.type !== "reasoning") {
				throw new Error(`durable response ${turnIndex + 1} reasoning signature is not a reasoning item`);
			}
			items.push(reasoning);
			continue;
		}
		if (block.type === "text") {
			const parsedSignature = parseProviderTextSignature(block.textSignature);
			let id = parsedSignature?.id ?? `msg_${1 + turnIndex * 2}`;
			if (id.length > 64) id = `msg_${shortProviderHistoryHash(id)}`;
			items.push({
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: sanitizeProviderHistoryText(block.text), annotations: [] }],
				status: "completed",
				id,
				...(parsedSignature?.phase ? { phase: parsedSignature.phase } : {}),
			});
			continue;
		}
		const idParts = block.id.split("|");
		if (idParts.length !== 2 || !idParts[0] || !idParts[1]) {
			throw new Error(`durable response ${turnIndex + 1} tool ID is not an exact composite`);
		}
		items.push({
			type: "function_call",
			id: idParts[1],
			call_id: idParts[0],
			name: block.name,
			arguments: JSON.stringify(block.arguments),
		});
	}
	return items;
}

interface AuditedProviderTranscript {
	providerDispatchOrdinal: number;
	payload: Record<string, unknown>;
	history: ProviderTranscriptHistoryItem[];
}

function extractProviderTranscriptHistory(
	payload: Record<string, unknown>,
	providerDispatchOrdinal: number,
): ProviderTranscriptHistoryItem[] {
	if (!Array.isArray(payload.input)) throw new Error("provider transcript input is not an array");
	const history: ProviderTranscriptHistoryItem[] = [];
	let cursor = 1;
	for (let turn = 0; turn < providerDispatchOrdinal - 1; turn++) {
		const assistantItems: unknown[] = [];
		while (cursor < payload.input.length) {
			const item = payload.input[cursor];
			if (isRecord(item) && (item.type === "reasoning" || item.type === "message")) {
				assistantItems.push(structuredClone(item));
				cursor++;
				continue;
			}
			break;
		}
		const call = payload.input[cursor];
		const output = payload.input[cursor + 1];
		if (
			!isRecord(call) ||
			call.type !== "function_call" ||
			typeof call.id !== "string" ||
			typeof call.call_id !== "string" ||
			typeof call.name !== "string" ||
			typeof call.arguments !== "string" ||
			!isRecord(output) ||
			output.type !== "function_call_output" ||
			output.call_id !== call.call_id ||
			typeof output.output !== "string"
		) {
			throw new Error(`provider transcript turn ${turn + 1} shape drifted`);
		}
		assistantItems.push(structuredClone(call));
		history.push({
			assistantItems,
			rawCallId: call.call_id,
			responseItemId: call.id as string,
			durableToolCallId: `${call.call_id}|${call.id as string}`,
			name: call.name,
			argumentsJson: call.arguments,
			output: output.output,
		});
		cursor += 2;
	}
	if (cursor !== payload.input.length) throw new Error("provider transcript has trailing history items");
	return history;
}

async function auditProviderTranscriptAnchors(input: {
	evidence: CompilerGymHardenedPaidProviderEvidence<CompilerGymLateNoveltyScreenArm>;
	arm: CompilerGymLateNoveltyScreenArm;
	preflight: CompilerGymLateNoveltyRunnerPreflight;
}): Promise<{ failures: string[]; transcripts: AuditedProviderTranscript[] }> {
	const failures: string[] = [];
	const transcripts: AuditedProviderTranscript[] = [];
	const expectedKeys = [
		"arm",
		"guidanceExposure",
		"normalizedSystemPrompt",
		"normalizedSystemPromptSha256",
		"pairId",
		"pairRequestAnchorSha256",
		"preregistrationSha256",
		"previousDispatchAnchorSha256",
		"providerDispatchOrdinal",
		"providerSessionId",
		"requestBody",
		"requestBodySha256",
		"resolvedModel",
		"resolvedModelSha256",
		"runnerProtocol",
		"runtimeWorktreeDispatchAnchorPath",
		"runtimeWorktreeDispatchAnchorSha256",
		"schemaVersion",
		"specSha256",
	] as const;
	let previousSha256: string | null = null;
	for (const [index, evidenceAnchor] of input.evidence.providerRequestTranscriptAnchors.entries()) {
		const ordinal = index + 1;
		try {
			const expectedPath = `${resolve(input.preflight.providerRequestAnchorPath)}.provider-request.${input.arm}.${ordinal}.json`;
			if (
				evidenceAnchor.providerDispatchOrdinal !== ordinal ||
				resolve(evidenceAnchor.path) !== expectedPath ||
				evidenceAnchor.previousDispatchAnchorSha256 !== previousSha256
			) {
				throw new Error(`provider transcript anchor ${ordinal} evidence identity drifted`);
			}
			await assertPrivateRegularFile(evidenceAnchor.path, `Provider transcript anchor ${ordinal}`);
			const contents = await readFile(evidenceAnchor.path, "utf8");
			if (sha256Text(contents) !== evidenceAnchor.sha256) {
				throw new Error(`provider transcript anchor ${ordinal} hash drifted`);
			}
			const anchor: unknown = JSON.parse(contents);
			if (!isRecord(anchor) || !exactRecordKeys(anchor, expectedKeys)) {
				throw new Error(`provider transcript anchor ${ordinal} keys drifted`);
			}
			const runtimeAnchor = input.evidence.runtimeWorktreeDispatchAnchors[index];
			const guidanceExposure = input.evidence.guidanceExposureByDispatch[index];
			if (
				anchor.schemaVersion !== 1 ||
				anchor.runnerProtocol !== COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL ||
				anchor.pairId !== input.preflight.preregistration.pairId ||
				anchor.preregistrationSha256 !== input.preflight.preregistrationSha256 ||
				anchor.specSha256 !== input.preflight.preregistration.providerSpecSha256 ||
				anchor.arm !== input.arm ||
				anchor.providerDispatchOrdinal !== ordinal ||
				anchor.providerSessionId !== input.preflight.preregistration.providerSpec.providerSessionId ||
				typeof anchor.normalizedSystemPrompt !== "string" ||
				sha256Text(anchor.normalizedSystemPrompt) !== anchor.normalizedSystemPromptSha256 ||
				anchor.normalizedSystemPromptSha256 !== input.evidence.normalizedSystemPromptSha256 ||
				!isRecord(anchor.resolvedModel) ||
				validateCompilerGymHardenedPaidResolvedModelSnapshot(
					anchor.resolvedModel as unknown as Parameters<
						typeof validateCompilerGymHardenedPaidResolvedModelSnapshot
					>[0],
				).length !== 0 ||
				sha256Json(anchor.resolvedModel) !== anchor.resolvedModelSha256 ||
				anchor.resolvedModelSha256 !== input.evidence.resolvedModelSnapshotSha256s[index] ||
				anchor.runtimeWorktreeDispatchAnchorPath !== runtimeAnchor?.path ||
				anchor.runtimeWorktreeDispatchAnchorSha256 !== runtimeAnchor?.sha256 ||
				anchor.pairRequestAnchorSha256 !== input.evidence.providerRequestAnchorSha256 ||
				anchor.previousDispatchAnchorSha256 !== previousSha256 ||
				typeof anchor.requestBody !== "string" ||
				sha256Text(anchor.requestBody) !== anchor.requestBodySha256 ||
				anchor.requestBodySha256 !== evidenceAnchor.requestBodySha256 ||
				anchor.requestBodySha256 !== input.evidence.providerRequestBodySha256s[index] ||
				canonicalJson(toJsonValue(anchor.guidanceExposure)) !== canonicalJson(toJsonValue(guidanceExposure))
			) {
				throw new Error(`provider transcript anchor ${ordinal} claims drifted`);
			}
			const payload: unknown = JSON.parse(anchor.requestBody);
			const payloadFailures = validateCompilerGymHardenedPaidProviderPayload({
				payload,
				arm: input.arm,
				dispatchOrdinal: ordinal,
				normalizedSystemPrompt: anchor.normalizedSystemPrompt,
				spec: input.preflight.preregistration.providerSpec,
			});
			if (payloadFailures.length > 0 || !isRecord(payload)) {
				throw new Error(`provider transcript anchor ${ordinal} payload drifted: ${payloadFailures.join("; ")}`);
			}
			transcripts.push({
				providerDispatchOrdinal: ordinal,
				payload,
				history: extractProviderTranscriptHistory(payload, ordinal),
			});
			previousSha256 = evidenceAnchor.sha256;
		} catch (error) {
			failures.push(errorText(error));
			previousSha256 = evidenceAnchor.sha256;
		}
	}
	return { failures, transcripts };
}

export async function auditCompilerGymLateNoveltyArm(input: {
	arm: CompilerGymLateNoveltyScreenArm;
	armOutputDir: string;
	result: StockTrajectoryResult;
	providerEvidence: CompilerGymHardenedPaidProviderEvidence<CompilerGymLateNoveltyScreenArm>;
	projectionEvidence: readonly CompilerGymLateNoveltyProjectionEvidence[];
	preflight: CompilerGymLateNoveltyRunnerPreflight;
	policyErrors?: readonly string[];
}): Promise<CompilerGymLateNoveltyArmAudit> {
	const apparatusFailures: string[] = [];
	const policyFailures = [...(input.policyErrors ?? [])];
	const candidates: CompilerGymIrDeltaScreenCandidateVector[] = [];
	const armOutputDir = resolve(input.armOutputDir);
	const resultPath = join(armOutputDir, "result.json");
	const ledgerPath = join(armOutputDir, "evaluation", "evidence.jsonl");
	const readEvidence = async (path: string, label: string): Promise<string> => {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			apparatusFailures.push(`${label} could not be read: ${errorText(error)}`);
			return "";
		}
	};
	const [resultContents, sessionContents, ledgerContents] = await Promise.all([
		readEvidence(resultPath, "trajectory result"),
		readEvidence(input.result.sessionFile, "session evidence"),
		readEvidence(ledgerPath, "arm ledger"),
	]);
	for (const [path, label] of [
		[resultPath, "trajectory result"],
		[input.result.sessionFile, "session evidence"],
	] as const) {
		try {
			await assertPrivateRegularFile(path, label);
		} catch (error) {
			apparatusFailures.push(errorText(error));
		}
	}
	try {
		const diskResult: unknown = JSON.parse(resultContents);
		if (canonicalJson(toJsonValue(diskResult)) !== canonicalJson(toJsonValue(input.result))) {
			apparatusFailures.push("trajectory result differs from its durable file");
		}
	} catch (error) {
		apparatusFailures.push(`trajectory result JSON failed: ${errorText(error)}`);
	}
	try {
		verifyLedgerContentsStrict(ledgerContents);
		const terminal: unknown = JSON.parse(ledgerContents.trimEnd().split("\n").at(-1) ?? "");
		if (!isRecord(terminal) || terminal.hash !== input.result.terminalLedgerEventHash) {
			apparatusFailures.push("terminal arm-ledger hash drifted");
		}
	} catch (error) {
		apparatusFailures.push(`arm ledger integrity failed: ${errorText(error)}`);
	}
	const providerTranscriptAudit = await auditProviderTranscriptAnchors({
		evidence: input.providerEvidence,
		arm: input.arm,
		preflight: input.preflight,
	});
	apparatusFailures.push(
		...(await auditAttemptLocks({
			result: input.result,
			arm: input.arm,
			armOutputDir,
			preflight: input.preflight,
		})),
		...(await auditProviderEvidence({
			evidence: input.providerEvidence,
			arm: input.arm,
			preflight: input.preflight,
			expectedDispatches: input.result.providerTracker.providerCalls,
		})),
		...providerTranscriptAudit.failures,
	);

	for (const [passed, message] of [
		[input.result.outputDir === armOutputDir, "trajectory output directory drifted"],
		[input.result.evaluationDir === join(armOutputDir, "evaluation"), "trajectory evaluation directory drifted"],
		[input.result.claimClass === "directional-single-pair-arm", "trajectory claim class drifted"],
		[input.result.causalClaimAllowed === false, "trajectory enabled a causal claim"],
		[input.result.protocolVersion === STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION, "feedback protocol drifted"],
		[input.result.terminalization === "host-owned", "terminalization drifted"],
		[input.result.feedbackView === "full", "feedback view drifted"],
		[input.result.pairPreregistrationPath === input.preflight.preregistrationPath, "preregistration path drifted"],
		[
			input.result.pairPreregistrationSha256 === input.preflight.preregistrationSha256,
			"preregistration hash drifted",
		],
		[input.result.pairPreregistrationId === input.preflight.preregistration.pairId, "pair ID drifted"],
		[input.result.pairArmId === input.arm, "pair arm drifted"],
		[
			input.result.implementationBundleSha256 === input.preflight.stockTrajectoryImplementationBundleSha256,
			"stock trajectory bundle drifted",
		],
		[
			input.result.expectedMeasurementEvaluatorSha256 === COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			"expected evaluator drifted",
		],
		[input.result.model === "openai-codex/gpt-5.6-luna", "model drifted"],
		[input.result.thinkingLevel === "xhigh", "thinking level drifted"],
		[input.result.requestedAndLocallyEffectiveServiceTier === "priority", "requested/local service tier drifted"],
		[
			input.result.upstreamServiceTierAcknowledgement === "not exposed by current provider response API",
			"upstream service-tier observability claim drifted",
		],
		[input.result.transport === "sse", "provider transport drifted"],
		[input.result.providerMaxRetries === 0, "provider retries were enabled"],
		[input.result.stopProviderAfterForbiddenToolExecution === true, "forbidden-tool provider stop is disabled"],
		[
			input.result.latchForbiddenToolExecutionWithinResponse === true,
			"same-response forbidden-tool latch is disabled",
		],
		[
			input.result.providerSessionId === input.preflight.preregistration.providerSpec.providerSessionId,
			"provider session ID drifted",
		],
		[
			input.result.sessionId === input.preflight.preregistration.providerSpec.providerSessionId,
			"durable session and provider affinity IDs differ",
		],
		[
			input.result.providerVisibleSystemPromptPolicy === COMPILER_GYM_LATE_NOVELTY_SCREEN_SYSTEM_PROMPT_POLICY,
			"provider system-prompt policy drifted",
		],
		[input.result.sourceIntegrityPassed, "source integrity failed"],
		[input.result.repositoryIntegrityPassed, "repository integrity failed"],
		[input.result.artifactIntegrity.passed, "artifact integrity failed"],
		[input.result.evaluatorIntegrityPassed, "evaluator integrity failed"],
		[input.result.measurementProvenanceIntegrityPassed, "measurement provenance integrity failed"],
		[input.result.pairPreregistrationIntegrityPassed, "pair preregistration integrity failed"],
		[
			input.result.repositoryBefore.coreWorktreeDigest ===
				input.preflight.runtimeWorktreeSnapshot.coreWorktreeDigest,
			"initial runtime snapshot drifted",
		],
		[
			sha256Json(input.result.sourceHashesBefore) === sha256Json(input.result.sourceHashesAfter),
			"trajectory source hashes drifted",
		],
		[input.result.sessionSha256 === sha256Text(sessionContents), "session hash drifted"],
		[input.result.ledgerSha256 === sha256Text(ledgerContents), "ledger hash drifted"],
		[
			(input.result.eventCounts.compaction_start ?? 0) === 0 && (input.result.eventCounts.compaction_end ?? 0) === 0,
			"compaction was observed",
		],
	] as const) {
		if (!passed) apparatusFailures.push(message);
	}

	const requests = input.result.trace.requests;
	try {
		assertCompilerGymIrDeltaScreenRequestSequence(requests);
	} catch (error) {
		policyFailures.push(errorText(error));
	}
	if (new Set(input.result.trace.jobIds).size !== input.result.trace.jobIds.length) {
		apparatusFailures.push("evaluator job IDs are not unique");
	}
	const jobsById = new Map(input.result.jobs.map((job) => [job.proposal.jobId, job]));
	const artifactStore = new ArtifactStore(join(armOutputDir, "evaluation", "artifacts"));
	for (let index = 0; index < input.result.trace.jobIds.length; index++) {
		const callIndex = (index + 1) as 1 | 2 | 3 | 4;
		const request = requests[index];
		const jobId = input.result.trace.jobIds[index];
		const job = jobId ? jobsById.get(jobId) : undefined;
		if (!request || !jobId || !job) {
			apparatusFailures.push(`call ${callIndex} lacks a request or durable job`);
			continue;
		}
		const expectedParents = index === 0 ? [] : [input.result.trace.jobIds[index - 1]!];
		if (!exactStringArray(job.proposal.proposal.parentJobIds, expectedParents)) {
			apparatusFailures.push(`call ${callIndex} lineage drifted`);
		}
		if (!job.measurement?.stdout) {
			apparatusFailures.push(`call ${callIndex} lacks aggregate stdout`);
			continue;
		}
		if (
			canonicalJson(toJsonValue(job.measurement.provenance)) !==
			canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE))
		) {
			apparatusFailures.push(`call ${callIndex} provenance drifted`);
		}
		try {
			const aggregate = await artifactStore.readString(job.measurement.stdout);
			const parsed = parseCompilerGymIrDeltaAggregateStdout(
				aggregate,
				stockEnvelope(request, job, input.result.budget),
				callIndex,
			);
			const candidate = classifyCandidate(callIndex, parsed);
			if (callIndex === 1 && candidate.outcome !== "verified") {
				apparatusFailures.push("frozen S12 apparatus anchor was rejected");
			}
			const expectedState = candidate.outcome === "verified" ? "succeeded" : "invalid";
			if (job.state.status !== expectedState) apparatusFailures.push(`call ${callIndex} state contradicts outcome`);
			candidates.push(candidate);
		} catch (error) {
			apparatusFailures.push(`call ${callIndex} aggregate verification failed: ${errorText(error)}`);
		}
	}

	let sessionEvidence: SessionEvidence = { assistantToolCalls: [], toolResults: [] };
	try {
		sessionEvidence = parseSessionEvidence(sessionContents);
	} catch (error) {
		apparatusFailures.push(`session evidence failed: ${errorText(error)}`);
	}
	const schemaRejectedPolicyFailure = detectSchemaRejectedLocalAbort({
		result: input.result,
		session: sessionEvidence,
	});
	const multipleToolPolicyFailure = detectMultipleToolLocalAbort({
		result: input.result,
		session: sessionEvidence,
	});
	const runnerPolicyFailure = detectRunnerPolicyLocalAbort({
		result: input.result,
		session: sessionEvidence,
	});
	const wrongToolPolicyFailure = detectWrongToolLocalAbort({
		result: input.result,
		session: sessionEvidence,
	});
	if (schemaRejectedPolicyFailure) policyFailures.push(schemaRejectedPolicyFailure);
	if (multipleToolPolicyFailure) policyFailures.push(multipleToolPolicyFailure);
	if (runnerPolicyFailure) policyFailures.push(runnerPolicyFailure);
	if (wrongToolPolicyFailure) policyFailures.push(wrongToolPolicyFailure);
	if (sessionEvidence.assistantToolCalls.length !== 4) {
		policyFailures.push(`expected four assistant responses, observed ${sessionEvidence.assistantToolCalls.length}`);
	}
	let syntheticPolicyAbortCount = 0;
	for (const [index, call] of sessionEvidence.assistantToolCalls.entries()) {
		const syntheticPolicyAbort =
			isExactSyntheticPolicyAbort(call) && index === sessionEvidence.assistantToolCalls.length - 1;
		if (syntheticPolicyAbort) {
			syntheticPolicyAbortCount++;
			continue;
		}
		if (multipleToolPolicyFailure && call.toolCalls.length === 2) continue;
		if (call.name !== STOCK_INTERFACE_PARITY_TOOL_NAME || call.stopReason !== "toolUse") {
			policyFailures.push(`assistant response ${index + 1} violated the one-tool-call policy`);
		}
		if (call.errorMessage !== null)
			apparatusFailures.push(`assistant response ${index + 1} failed: ${call.errorMessage}`);
		const request = requests[index];
		if (request && canonicalJson(toJsonValue(call.arguments)) !== canonicalJson(toJsonValue(request))) {
			apparatusFailures.push(`assistant response ${index + 1} arguments differ from evaluator request`);
		}
	}
	const policyPrefixKind: CompilerGymLateNoveltyPolicyPrefixKind = schemaRejectedPolicyFailure
		? "schema-rejected-local-abort"
		: multipleToolPolicyFailure
			? "multiple-tool-local-abort"
			: runnerPolicyFailure
				? "runner-policy-local-abort"
				: wrongToolPolicyFailure
					? "wrong-tool-local-abort"
					: policyFailures.length > 0 && input.result.providerTracker.blockedProviderCalls === 0
						? "direct-stop"
						: "none";
	const policyDetected = policyPrefixKind !== "none";
	const localPolicyAbort =
		policyPrefixKind === "schema-rejected-local-abort" ||
		policyPrefixKind === "runner-policy-local-abort" ||
		policyPrefixKind === "wrong-tool-local-abort" ||
		policyPrefixKind === "multiple-tool-local-abort";
	const expectedToolResults = policyDetected
		? localPolicyAbort
			? policyPrefixKind === "multiple-tool-local-abort"
				? input.result.providerTracker.providerCalls + 1
				: input.result.providerTracker.providerCalls
			: input.result.trace.callCount
		: 4;
	if (sessionEvidence.toolResults.length !== expectedToolResults) {
		apparatusFailures.push(
			`expected ${expectedToolResults} durable tool results, observed ${sessionEvidence.toolResults.length}`,
		);
	}
	for (const [index, toolResult] of sessionEvidence.toolResults.entries()) {
		const expectedPolicyError =
			localPolicyAbort &&
			(policyPrefixKind === "multiple-tool-local-abort"
				? index >= input.result.trace.callCount
				: index === input.result.trace.callCount);
		if (toolResult.isError !== expectedPolicyError) {
			apparatusFailures.push(`durable tool result ${index + 1} error taxonomy drifted`);
		}
		if (index >= input.result.trace.callCount) continue;
		if (input.result.trace.modelFeedbackBytes[index] !== Buffer.byteLength(toolResult.text, "utf8")) {
			apparatusFailures.push(`durable tool result ${index + 1} byte accounting drifted`);
		}
	}
	if (input.projectionEvidence.length !== input.result.trace.callCount) {
		apparatusFailures.push("projection evidence count drifted");
	}
	for (const [index, projection] of input.projectionEvidence.entries()) {
		let durable: unknown = null;
		try {
			durable = JSON.parse(sessionEvidence.toolResults[index]?.text ?? "");
		} catch (error) {
			apparatusFailures.push(`durable tool result ${index + 1} JSON failed: ${errorText(error)}`);
		}
		if (projection.submissionOrdinal !== index + 1 || sha256Json(durable) !== projection.projectedFeedbackSha256) {
			apparatusFailures.push(`projection evidence ${index + 1} drifted from durable feedback`);
		}
	}
	for (const transcript of providerTranscriptAudit.transcripts) {
		if (transcript.history.length !== transcript.providerDispatchOrdinal - 1) {
			apparatusFailures.push(
				`provider dispatch ${transcript.providerDispatchOrdinal} durable history length drifted`,
			);
			continue;
		}
		for (const [index, history] of transcript.history.entries()) {
			const response = sessionEvidence.assistantToolCalls[index];
			const durableCall = response?.toolCalls[0];
			const durableResult = sessionEvidence.toolResults[index];
			let expectedAssistantItems: unknown[] = [];
			let providerArguments: unknown = null;
			let providerOutput: unknown = null;
			try {
				if (!response) throw new Error("durable assistant response is absent");
				expectedAssistantItems = expectedProviderAssistantItems(response, index);
				providerArguments = JSON.parse(history.argumentsJson);
				providerOutput = JSON.parse(history.output);
			} catch (error) {
				apparatusFailures.push(
					`provider dispatch ${transcript.providerDispatchOrdinal} prior JSON failed: ${errorText(error)}`,
				);
			}
			if (
				response?.toolCalls.length !== 1 ||
				!durableCall ||
				!durableResult ||
				canonicalJson(toJsonValue(history.assistantItems)) !== canonicalJson(toJsonValue(expectedAssistantItems)) ||
				history.durableToolCallId !== durableCall.id ||
				history.durableToolCallId !== durableResult.toolCallId ||
				history.name !== durableCall.name ||
				history.name !== durableResult.toolName ||
				history.name !== STOCK_INTERFACE_PARITY_TOOL_NAME ||
				canonicalJson(toJsonValue(providerArguments)) !== canonicalJson(toJsonValue(durableCall.arguments)) ||
				history.output !== durableResult.text ||
				input.result.trace.modelFeedbackBytes[index] !== Buffer.byteLength(history.output, "utf8") ||
				input.projectionEvidence[index]?.projectedFeedbackSha256 !== sha256Json(providerOutput)
			) {
				apparatusFailures.push(
					`provider dispatch ${transcript.providerDispatchOrdinal} prior turn ${index + 1} differs from durable session/projection evidence`,
				);
			}
		}
	}

	let resultThree: unknown = null;
	try {
		resultThree = JSON.parse(sessionEvidence.toolResults[2]?.text ?? "");
	} catch {
		// The durable feedback JSON failure is already recorded above.
	}
	const producerResultThreeAccepted = acceptedFeedback(resultThree) && candidates[2]?.outcome === "verified";
	const durableFeedbackGuidancePresent =
		isRecord(resultThree) &&
		Object.hasOwn(resultThree, COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD) &&
		resultThree[COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD] === COMPILER_GYM_LATE_NOVELTY_GUIDANCE;
	if (
		isRecord(resultThree) &&
		Object.hasOwn(resultThree, COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD) &&
		resultThree[COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD] !== COMPILER_GYM_LATE_NOVELTY_GUIDANCE
	) {
		apparatusFailures.push("durable result-three guidance value drifted");
	}
	const projectionThree = input.projectionEvidence.find((item) => item.submissionOrdinal === 3);
	const callFourExposure = input.providerEvidence.guidanceExposureByDispatch.find(
		(item) => item.providerDispatchOrdinal === 4,
	);
	const projectorGuidancePresent = projectionThree?.guidancePresent === true;
	const providerCallFourExpectedGuidance = callFourExposure?.treatmentExpected === true;
	const providerCallFourExposedGuidance = callFourExposure?.exposed === true;
	if (callFourExposure && callFourExposure.producerAccepted !== producerResultThreeAccepted) {
		apparatusFailures.push("provider call-four producer acceptance differs from durable result three");
	}
	if (input.arm === "unchanged-control") {
		if (
			durableFeedbackGuidancePresent ||
			projectorGuidancePresent ||
			providerCallFourExpectedGuidance ||
			providerCallFourExposedGuidance
		) {
			apparatusFailures.push("late-novelty guidance leaked into control");
		}
	} else if (producerResultThreeAccepted) {
		if (
			!durableFeedbackGuidancePresent ||
			!projectorGuidancePresent ||
			!providerCallFourExpectedGuidance ||
			!providerCallFourExposedGuidance
		) {
			apparatusFailures.push("accepted result three was not jointly exposed to treatment call four");
		}
	} else if (
		durableFeedbackGuidancePresent ||
		projectorGuidancePresent ||
		providerCallFourExpectedGuidance ||
		providerCallFourExposedGuidance
	) {
		apparatusFailures.push("guidance was exposed without an accepted treatment result three");
	}
	const treatmentDelivery: CompilerGymLateNoveltyTreatmentDeliveryEvidence = {
		producerResultThreeAccepted,
		durableFeedbackGuidancePresent,
		projectorGuidancePresent,
		providerCallFourExpectedGuidance,
		providerCallFourExposedGuidance,
		delivered:
			input.arm === "late-novelty-treatment" &&
			producerResultThreeAccepted &&
			durableFeedbackGuidancePresent &&
			projectorGuidancePresent &&
			providerCallFourExpectedGuidance &&
			providerCallFourExposedGuidance,
	};

	const accounting = assessCompilerGymLateNoveltyAccounting({
		policyPrefixKind,
		providerCalls: input.result.providerTracker.providerCalls,
		blockedProviderCalls: input.result.providerTracker.blockedProviderCalls,
		blockedReasons: input.result.providerTracker.blockedReasons,
		evaluatorCalls: input.result.trace.callCount,
		requestCount: input.result.trace.requests.length,
		jobIdCount: input.result.trace.jobIds.length,
		feedbackCount: input.result.trace.modelFeedbackBytes.length,
		jobCount: input.result.jobs.length,
		submissions: input.result.budget.submissions,
		taskEvaluations: input.result.budget.taskEvaluations,
		actualTaskEvaluations: input.result.budget.actualTaskEvaluations,
		reusedTaskEvaluations: input.result.budget.reusedTaskEvaluations,
		unevaluatedTaskEvaluations: input.result.budget.unevaluatedTaskEvaluations,
		duplicateCount: input.result.trace.duplicateCount,
		assistantResponseCount: sessionEvidence.assistantToolCalls.length,
		syntheticPolicyAbortCount,
	});
	const accountingComplete = accounting.complete;
	if (!accountingComplete) {
		apparatusFailures.push(
			policyDetected
				? "scientific-policy stop lacks an exact bounded prefix with a recognized direct-stop or local-abort taxonomy"
				: "arm provider/evaluator/fresh-task accounting is not exactly 4/4/8",
		);
	}
	const host = input.result.hostTerminalizationTracker;
	const hostAccountingConformant = policyDetected
		? Boolean(
				host &&
					host.providerDispatches === input.result.providerTracker.providerCalls &&
					host.evaluatorToolCalls === input.result.trace.callCount &&
					host.postTerminalProviderDispatches === 0 &&
					host.postTerminalEvaluatorToolCalls === 0 &&
					host.terminalizationStops === 0 &&
					(localPolicyAbort
						? host.forbiddenBoundaryEvents.length ===
							(policyPrefixKind === "multiple-tool-local-abort"
								? input.result.providerTracker.providerCalls + 1 - input.result.trace.callCount
								: 1)
						: host.forbiddenBoundaryEvents.length === 0),
			)
		: Boolean(
				host &&
					host.providerDispatches === 4 &&
					host.evaluatorToolCalls === 4 &&
					host.postTerminalProviderDispatches === 0 &&
					host.postTerminalEvaluatorToolCalls === 0 &&
					host.terminalizationStops === 1 &&
					host.forbiddenBoundaryEvents.length === 0,
			);
	if (!hostAccountingConformant) {
		apparatusFailures.push("host-owned terminal accounting drifted");
	}
	const derivedOperationalFailures = Object.entries(input.result.operationalGate.checks)
		.filter(([, passed]) => !passed)
		.map(([name]) => name);
	if (!exactStringArray(derivedOperationalFailures, input.result.operationalGate.failures)) {
		apparatusFailures.push("operational failure list contradicts its check map");
	}
	const semanticRejection = candidates.some((candidate) => candidate.outcome === "complete-semantic-rejection");
	const allowedOperational = policyDetected
		? POLICY_ALLOWED_OPERATIONAL_FAILURES
		: semanticRejection
			? SEMANTIC_REJECTION_ALLOWED_OPERATIONAL_FAILURES
			: new Set<string>();
	for (const failure of input.result.operationalGate.failures) {
		if (!allowedOperational.has(failure)) apparatusFailures.push(`unexpected stock operational failure: ${failure}`);
	}
	if (input.result.failure && /authentication|network|ECONN|HTTP |timed? out|timeout/i.test(input.result.failure)) {
		apparatusFailures.push(`provider trajectory failure: ${input.result.failure}`);
	}
	const disposition: CompilerGymLateNoveltyArmDisposition =
		apparatusFailures.length > 0
			? "terminal-apparatus-invalid-not-treatment-result"
			: policyFailures.length > 0
				? "terminal-scientific-policy-nonconformance"
				: "admitted-directional-arm";
	return {
		arm: input.arm,
		disposition,
		admitted: disposition === "admitted-directional-arm",
		apparatusFailures: unique(apparatusFailures),
		policyFailures: unique(policyFailures),
		providerEvidence: structuredClone(input.providerEvidence),
		projectionEvidence: structuredClone([...input.projectionEvidence]),
		treatmentDelivery,
		serviceTier: {
			requestedAndLocallyEffective:
				input.result.requestedAndLocallyEffectiveServiceTier === "priority" ? "priority" : null,
			allProviderPayloadsRequestedPriority:
				input.providerEvidence.providerRequestBodySha256s.length === input.result.providerTracker.providerCalls &&
				input.providerEvidence.failures.length === 0,
			upstreamResponseTierObservable: false,
			upstreamAcknowledgement:
				input.result.upstreamServiceTierAcknowledgement === "not exposed by current provider response API"
					? "not exposed by current provider response API"
					: null,
		},
		accountingComplete,
		providerDispatches: accountingComplete ? input.result.providerTracker.providerCalls : null,
		evaluatorJobs: accountingComplete ? input.result.trace.callCount : null,
		freshTaskEvaluations: accountingComplete ? input.result.budget.actualTaskEvaluations : null,
		providerRetries: input.result.providerMaxRetries ?? null,
		replacements: 0,
		candidates,
		calls: candidates.flatMap((candidate, index) => {
			const request = requests[index];
			return request ? [requestForLateNoveltyCall(request, candidate.callIndex, candidate)] : [];
		}),
		trajectoryResultPath: resultPath,
		trajectoryResultSha256: sha256Text(resultContents),
		sessionSha256: sha256Text(sessionContents),
		ledgerSha256: sha256Text(ledgerContents),
		terminalLedgerEventHash: input.result.terminalLedgerEventHash,
	};
}

function pairDisposition(
	audits: readonly CompilerGymLateNoveltyArmAudit[],
	pairApparatusFailures: readonly string[],
): CompilerGymLateNoveltyRunResult["disposition"] {
	if (
		pairApparatusFailures.length > 0 ||
		audits.some((audit) => audit.disposition === "terminal-apparatus-invalid-not-treatment-result")
	) {
		return "terminal-apparatus-invalid-not-treatment-result";
	}
	if (audits.some((audit) => audit.disposition === "terminal-scientific-policy-nonconformance")) {
		return "terminal-scientific-policy-nonconformance";
	}
	return audits.length === 2
		? "terminal-complete-directional-single-pair"
		: "terminal-apparatus-invalid-not-treatment-result";
}

export function computeCompilerGymLateNoveltyResultBinding(result: unknown): string {
	const clone: unknown = structuredClone(result);
	if (!isRecord(clone)) throw new Error("Late-novelty result binding requires an object");
	delete clone.resultBindingSha256;
	return sha256Json(clone);
}

function failedArmAudit(input: {
	arm: CompilerGymLateNoveltyScreenArm;
	armOutputDir: string;
	providerEvidence: CompilerGymHardenedPaidProviderEvidence<CompilerGymLateNoveltyScreenArm>;
	projectionEvidence: readonly CompilerGymLateNoveltyProjectionEvidence[];
	policyErrors: readonly string[];
	failure: string;
}): CompilerGymLateNoveltyArmAudit {
	return {
		arm: input.arm,
		disposition: "terminal-apparatus-invalid-not-treatment-result",
		admitted: false,
		apparatusFailures: [
			`trajectory threw before a complete auditable result; paid accounting is untrusted: ${input.failure}`,
		],
		policyFailures: unique(input.policyErrors),
		providerEvidence: structuredClone(input.providerEvidence),
		projectionEvidence: structuredClone([...input.projectionEvidence]),
		treatmentDelivery: {
			producerResultThreeAccepted: false,
			durableFeedbackGuidancePresent: false,
			projectorGuidancePresent: false,
			providerCallFourExpectedGuidance: false,
			providerCallFourExposedGuidance: false,
			delivered: false,
		},
		serviceTier: {
			requestedAndLocallyEffective: null,
			allProviderPayloadsRequestedPriority: false,
			upstreamResponseTierObservable: false,
			upstreamAcknowledgement: null,
		},
		accountingComplete: false,
		providerDispatches: null,
		evaluatorJobs: null,
		freshTaskEvaluations: null,
		providerRetries: null,
		replacements: 0,
		candidates: [],
		calls: [],
		trajectoryResultPath: join(resolve(input.armOutputDir), "result.json"),
		trajectoryResultSha256: "",
		sessionSha256: "",
		ledgerSha256: "",
		terminalLedgerEventHash: null,
	};
}

export async function runCompilerGymLateNoveltyScreenPair(input: {
	preregistrationPath: string;
	outputDir: string;
	repoRoot?: string;
}): Promise<CompilerGymLateNoveltyRunResult> {
	const startedAt = new Date().toISOString();
	const preflight = await prepareCompilerGymLateNoveltyScreenRun({
		preregistrationPath: input.preregistrationPath,
		repoRoot: input.repoRoot,
	});
	const outputDir = resolve(input.outputDir);
	const outputParent = dirname(outputDir);
	if (!(await stat(outputParent)).isDirectory())
		throw new Error(`Late-novelty output parent is not a directory: ${outputParent}`);
	try {
		await mkdir(outputDir, { mode: 0o700 });
	} catch (error) {
		if (isRecord(error) && error.code === "EEXIST")
			throw new Error(`Late-novelty output already exists: ${outputDir}`);
		throw error;
	}
	await chmod(outputDir, 0o700);
	const pairLedgerPath = join(outputDir, "evidence.jsonl");
	const pairLedger = await EvidenceLedger.open(pairLedgerPath);
	await pairLedger.append("run_manifest", {
		type: "compiler_gym_late_novelty_paid_screen_pair",
		phase: "preflight",
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		preregistrationPath: preflight.preregistrationPath,
		preregistrationSha256: preflight.preregistrationSha256,
		implementationBundleSha256: preflight.implementationBundleSha256,
		stockTrajectoryImplementationBundleSha256: preflight.stockTrajectoryImplementationBundleSha256,
		runtimeWorktreeSnapshotSha256: preflight.runtimeWorktreeSnapshotSha256,
		providerRegistryClosure: preflight.providerRegistryClosure,
		providerSpecSha256: preflight.preregistration.providerSpecSha256,
		randomizedArmOrder: preflight.preregistration.randomization.armOrder,
		budgets: preflight.preregistration.budgets,
		startedAt,
	});

	const pairAnchorLoader = createCompilerGymLateNoveltyPairAnchorLoader(preflight);
	const providerGuard = createCompilerGymHardenedPaidProviderGuard({
		spec: preflight.preregistration.providerSpec,
		preregistrationSha256: preflight.preregistrationSha256,
		providerRequestAnchorPath: preflight.providerRequestAnchorPath,
		activeAgentDir: getAgentDir(),
		expectedRuntimeWorktreeSnapshot: preflight.runtimeWorktreeSnapshot,
		runtimeWorktreeSnapshotProvider: () => capturePrimeRuntimeWorktreeSnapshot(preflight.repoRoot),
	});
	let globalAttemptLockSha256: string | null = null;
	let providerPairAnchorSha256: string | null = null;
	let aggregateProviderDispatches = 0;
	let liveEnvironmentGateAttempts = 0;
	let liveEnvironmentGatePasses = 0;
	let liveEnvironmentGateFailures = 0;
	let aggregateEvaluatorJobs = 0;
	let aggregateFreshTaskEvaluations = 0;
	const audits: CompilerGymLateNoveltyArmAudit[] = [];

	for (const [orderIndex, arm] of preflight.preregistration.randomization.armOrder.entries()) {
		const armOrdinal = orderIndex + 1;
		const armOutputDir = join(outputDir, "arms", `${String(armOrdinal).padStart(2, "0")}-${arm}`);
		const providerRuntime = providerGuard.runtimeForArm(arm);
		const projectionEvidence: CompilerGymLateNoveltyProjectionEvidence[] = [];
		const policyErrors: string[] = [];
		const actionDigests = new Set<string>();
		const artifactStore = new ArtifactStore(join(armOutputDir, "evaluation", "artifacts"));
		let trajectoryResult: StockTrajectoryResult;
		try {
			trajectoryResult = await runStockInterfaceParityTrajectory(
				{
					outputDir: armOutputDir,
					calibrationResultPath: preflight.calibrationResultPath,
					feedbackView: "full",
					pairPreregistrationPath: preflight.preregistrationPath,
					terminalization: "host-owned",
				},
				{
					adapter: new FarmShareCompilerGymIrDeltaScreenAdapter(),
					evaluatorScriptPath: preflight.evaluatorScriptPath,
					expectedMeasurementEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
					expectedMeasurementProvenance: COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE,
					evaluationSchema: CompilerGymIrDeltaScreenEvaluationSchema,
					promptBuilder: buildCompilerGymIrDeltaScreenPrompt,
					pairAnchorLoader,
					pairArmId: arm,
					additionalSourcePaths: preflight.additionalSourcePaths,
					stopProviderAfterForbiddenToolExecution: true,
					latchForbiddenToolExecutionWithinResponse: true,
					prepareArguments: (args, providerDispatchOrdinal) => {
						const request = parseStockCpuEvaluationRequest(args);
						assertCompilerGymIrDeltaScreenRequestPolicy(providerDispatchOrdinal, request);
						return request;
					},
					providerSessionId: preflight.preregistration.providerSpec.providerSessionId,
					providerVisibleSystemPromptPolicy: COMPILER_GYM_LATE_NOVELTY_SCREEN_SYSTEM_PROMPT_POLICY,
					additionalExtensionFactories: [providerRuntime.extensionFactory],
					providerRequestGate: createCompilerGymLateNoveltyPreDispatchProviderGate({
						maximumProviderDispatches: preflight.preregistration.authorization.maximumActualProviderDispatches,
						currentProviderDispatches: () => aggregateProviderDispatches,
						liveEnvironmentGate: () => runCompilerGymPaidLiveEnvironmentGate({ repoRoot: preflight.repoRoot }),
						recordLiveEnvironmentGate: async (record, providerDispatchOrdinal) => {
							await pairLedger.append("run_manifest", {
								type: "compiler_gym_late_novelty_live_environment_gate",
								arm,
								armOrdinal,
								providerDispatchOrdinal,
								...record,
							});
							liveEnvironmentGateAttempts++;
							if (record.outcome === "passed") liveEnvironmentGatePasses++;
							else liveEnvironmentGateFailures++;
						},
						guardedProviderRequestGate: providerRuntime.providerRequestGate,
						recordProviderDispatch: () => {
							aggregateProviderDispatches++;
						},
					}),
					armMetadata: {
						id: arm,
						feedbackTopology:
							arm === "unchanged-control"
								? "complete authoritative terminal envelope without late-novelty guidance"
								: "control envelope plus one bounded guidance field only after accepted result three",
					},
					beforeSubmit: async ({ submissionOrdinal, request, existingJobs }) => {
						try {
							if (existingJobs.length + 1 !== submissionOrdinal) {
								throw new Error("scientific-policy-nonconformance: tool-call ordinal drifted");
							}
							assertCompilerGymIrDeltaScreenRequestPolicy(submissionOrdinal, request);
							const digest = sha256Json(request.actions);
							if (actionDigests.has(digest)) {
								throw new Error(
									"scientific-policy-nonconformance: repeated candidate action vector within arm",
								);
							}
							if (aggregateEvaluatorJobs >= 8 || aggregateFreshTaskEvaluations + STOCK_CPU_TASKS.length > 16) {
								throw new Error("apparatus-budget-nonconformance: aggregate evaluator/fresh-task cap reached");
							}
							actionDigests.add(digest);
							aggregateEvaluatorJobs++;
							aggregateFreshTaskEvaluations += STOCK_CPU_TASKS.length;
						} catch (error) {
							policyErrors.push(errorText(error));
							throw error;
						}
					},
					feedbackProjector: async (details, context) => {
						const control = await projectCompilerGymIrDeltaScreenFeedback({
							details,
							arm: "hidden-control",
							callIndex: context.submissionOrdinal,
							readArtifact: (reference) => artifactStore.readString(reference),
						});
						const projected = projectCompilerGymLateNoveltyScreenFeedback({
							details: control,
							arm,
							submissionOrdinal: context.submissionOrdinal,
						});
						projectionEvidence.push({
							submissionOrdinal: context.submissionOrdinal,
							producerAccepted: acceptedFeedback(control),
							guidancePresent:
								isRecord(projected) &&
								Object.hasOwn(projected, COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD) &&
								projected[COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD] === COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
							projectedFeedbackSha256: sha256Json(projected),
						});
						return projected;
					},
					beforePromptDispatch: async (context) => {
						await verifyLivePreDispatchState(preflight);
						if (armOrdinal === 2) {
							if (!providerPairAnchorSha256) throw new Error("first arm lacks a durable provider pair anchor");
							await verifyProviderPairAnchorBeforeSecondArm(preflight, providerPairAnchorSha256);
						}
						if (globalAttemptLockSha256 === null) {
							globalAttemptLockSha256 = await claimCompilerGymLateNoveltyGlobalAttempt({
								preflight,
								outputDir,
								firstArm: arm,
								createdAt: new Date().toISOString(),
							});
						} else {
							await assertPrivateRegularFile(
								preflight.globalAttemptLockPath,
								"Global late-novelty attempt lock",
							);
							if (
								sha256Text(await readFile(preflight.globalAttemptLockPath, "utf8")) !== globalAttemptLockSha256
							) {
								throw new Error("global late-novelty attempt lock drifted between arms");
							}
						}
						const armLock = await claimCompilerGymLateNoveltyArmAttempt({
							preflight,
							arm,
							armOrdinal,
							armOutputDir,
							globalAttemptLockSha256,
							armPreregistrationSha256: context.preregistrationSha256,
							promptSha256: context.promptSha256,
							createdAt: new Date().toISOString(),
						});
						await pairLedger.append("run_manifest", {
							type: "compiler_gym_late_novelty_attempt",
							arm,
							armOrdinal,
							globalAttemptLockSha256,
							armAttemptLockPath: armLock.path,
							armAttemptLockSha256: armLock.sha256,
						});
						return {
							globalAttemptLockPath: preflight.globalAttemptLockPath,
							globalAttemptLockSha256,
							armAttemptLockPath: armLock.path,
							armAttemptLockSha256: armLock.sha256,
						};
					},
				},
			);
		} catch (error) {
			if (globalAttemptLockSha256 === null) throw error;
			const audit = failedArmAudit({
				arm,
				armOutputDir,
				providerEvidence: providerRuntime.evidence,
				projectionEvidence,
				policyErrors,
				failure: errorText(error),
			});
			audits.push(audit);
			await pairLedger.append("run_manifest", {
				type: "compiler_gym_late_novelty_arm",
				phase: "terminal",
				arm,
				armOrdinal,
				audit,
			});
			break;
		}
		let audit: CompilerGymLateNoveltyArmAudit;
		try {
			audit = await auditCompilerGymLateNoveltyArm({
				arm,
				armOutputDir,
				result: trajectoryResult,
				providerEvidence: providerRuntime.evidence,
				projectionEvidence,
				preflight,
				policyErrors,
			});
		} catch (error) {
			audit = failedArmAudit({
				arm,
				armOutputDir,
				providerEvidence: providerRuntime.evidence,
				projectionEvidence,
				policyErrors,
				failure: `arm audit threw: ${errorText(error)}`,
			});
		}
		audits.push(audit);
		providerPairAnchorSha256 = providerRuntime.evidence.providerRequestAnchorSha256;
		await pairLedger.append("run_manifest", {
			type: "compiler_gym_late_novelty_arm",
			phase: "terminal",
			arm,
			armOrdinal,
			audit,
		});
		if (!audit.admitted) break;
	}

	const pairApparatusFailures: string[] = [];
	if (globalAttemptLockSha256 === null)
		throw new Error("Late-novelty runner reached terminalization without an attempt lock");
	try {
		await assertPrivateRegularFile(preflight.globalAttemptLockPath, "Global late-novelty attempt lock");
		if (sha256Text(await readFile(preflight.globalAttemptLockPath, "utf8")) !== globalAttemptLockSha256) {
			pairApparatusFailures.push("global attempt lock drifted after execution");
		}
	} catch (error) {
		pairApparatusFailures.push(`global attempt-lock audit failed: ${errorText(error)}`);
	}
	if (providerPairAnchorSha256 === null) {
		pairApparatusFailures.push("durable provider pair anchor was never created");
	} else {
		try {
			await verifyProviderPairAnchorBeforeSecondArm(preflight, providerPairAnchorSha256);
		} catch (error) {
			pairApparatusFailures.push(`terminal provider pair-anchor audit failed: ${errorText(error)}`);
		}
	}
	if (aggregateProviderDispatches > 8 || aggregateEvaluatorJobs > 8 || aggregateFreshTaskEvaluations > 16) {
		pairApparatusFailures.push("aggregate hard budget cap was exceeded");
	}
	if (liveEnvironmentGatePasses !== aggregateProviderDispatches) {
		pairApparatusFailures.push("live environment-gate pass count differs from paid provider dispatch count");
	}
	if (liveEnvironmentGateAttempts !== liveEnvironmentGatePasses + liveEnvironmentGateFailures) {
		pairApparatusFailures.push("live environment-gate attempt accounting is inconsistent");
	}
	let assessment: CompilerGymLateNoveltyPairAssessment | null = null;
	if (audits.length === 2 && audits.every((audit) => audit.admitted)) {
		const control = audits.find((audit) => audit.arm === "unchanged-control");
		const treatment = audits.find((audit) => audit.arm === "late-novelty-treatment");
		assert.ok(control && treatment, "Admitted pair lacks a frozen arm");
		const controlResult: CompilerGymLateNoveltyScreenArmResult = {
			arm: "unchanged-control",
			treatmentDelivered: false,
			calls: control.calls,
		};
		const treatmentResult: CompilerGymLateNoveltyScreenArmResult = {
			arm: "late-novelty-treatment",
			treatmentDelivered: treatment.treatmentDelivery.delivered,
			calls: treatment.calls,
		};
		assessment = assessCompilerGymLateNoveltyScreenPair({ control: controlResult, treatment: treatmentResult });
	}
	const sumAccounting = (selector: (audit: CompilerGymLateNoveltyArmAudit) => number | null): number | null => {
		let total = 0;
		for (const audit of audits) {
			const value = selector(audit);
			if (!audit.accountingComplete || value === null) return null;
			total += value;
		}
		return total;
	};
	const actualProviderDispatches = sumAccounting((audit) => audit.providerDispatches);
	const actualEvaluatorJobs = sumAccounting((audit) => audit.evaluatorJobs);
	const actualFreshTaskEvaluations = sumAccounting((audit) => audit.freshTaskEvaluations);
	if (audits.length === 2 && audits.every((audit) => audit.admitted)) {
		if (actualProviderDispatches !== 8 || actualEvaluatorJobs !== 8 || actualFreshTaskEvaluations !== 16) {
			pairApparatusFailures.push("complete admitted pair accounting is not exactly 8/8/16");
		}
	}
	const disposition = pairDisposition(audits, pairApparatusFailures);
	const finishedAt = new Date().toISOString();
	const terminalEvent = await pairLedger.append("run_manifest", {
		type: "compiler_gym_late_novelty_paid_screen_pair",
		phase: "terminal",
		disposition,
		assessment,
		pairApparatusFailures,
		actualProviderDispatches,
		actualEvaluatorJobs,
		actualFreshTaskEvaluations,
		liveEnvironmentGateAttempts,
		liveEnvironmentGatePasses,
		liveEnvironmentGateFailures,
		aggregateBoundaryCounters: {
			providerDispatches: aggregateProviderDispatches,
			evaluatorJobs: aggregateEvaluatorJobs,
			freshTaskEvaluations: aggregateFreshTaskEvaluations,
		},
		finishedAt,
	});
	pairLedger.verify();
	const pairLedgerContents = await readFile(pairLedgerPath, "utf8");
	verifyLedgerContentsStrict(pairLedgerContents);
	const resultWithoutBinding: Omit<CompilerGymLateNoveltyRunResult, "resultBindingSha256"> = {
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		screenProtocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL,
		pairId: COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID,
		disposition,
		preregistrationPath: preflight.preregistrationPath,
		preregistrationSha256: preflight.preregistrationSha256,
		implementationBundleSha256: preflight.implementationBundleSha256,
		stockTrajectoryImplementationBundleSha256: preflight.stockTrajectoryImplementationBundleSha256,
		runtimeWorktreeSnapshotSha256: preflight.runtimeWorktreeSnapshotSha256,
		providerRegistryClosure: preflight.providerRegistryClosure,
		globalAttemptLockPath: preflight.globalAttemptLockPath,
		globalAttemptLockSha256,
		providerRequestAnchorPath: preflight.providerRequestAnchorPath,
		providerRequestAnchorSha256: providerPairAnchorSha256,
		randomizedArmOrder: preflight.preregistration.randomization.armOrder,
		arms: audits,
		pairApparatusFailures,
		assessment,
		actualProviderDispatches,
		actualEvaluatorJobs,
		actualFreshTaskEvaluations,
		liveEnvironmentGateAttempts,
		liveEnvironmentGatePasses,
		liveEnvironmentGateFailures,
		authorizedMaximumProviderDispatches: 8,
		authorizedMaximumEvaluatorJobs: 8,
		authorizedMaximumFreshTaskEvaluations: 16,
		retries: 0,
		replacements: 0,
		causalClaimAllowed: false,
		replicationClaimAllowed: false,
		gpuPromotionAllowed: false,
		pairLedgerPath,
		pairLedgerSha256: sha256Text(pairLedgerContents),
		terminalPairLedgerEventHash: terminalEvent.hash,
		startedAt,
		finishedAt,
	};
	const result: CompilerGymLateNoveltyRunResult = {
		...resultWithoutBinding,
		resultBindingSha256: computeCompilerGymLateNoveltyResultBinding(resultWithoutBinding),
	};
	await writeExclusivePrivateJson(join(outputDir, "result.json"), result);
	return result;
}

function parseOptions(argv: readonly string[]): { preregistrationPath: string; outputDir: string } {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || !value) {
			throw new Error(
				"Usage: compiler-gym-late-novelty-screen-runner --preregistration <path> --output-dir <new-path>",
			);
		}
		if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
		values.set(flag, value);
	}
	for (const flag of values.keys()) {
		if (flag !== "--preregistration" && flag !== "--output-dir") throw new Error(`Unknown option: ${flag}`);
	}
	const preregistrationPath = values.get("--preregistration");
	const outputDir = values.get("--output-dir");
	if (!preregistrationPath || !outputDir) throw new Error("Both --preregistration and --output-dir are required");
	return { preregistrationPath, outputDir };
}

async function main(): Promise<void> {
	const result = await runCompilerGymLateNoveltyScreenPair(parseOptions(process.argv.slice(2)));
	process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`);
	if (result.disposition !== "terminal-complete-directional-single-pair") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	void main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
	validateCompilerGymHardenedPaidResolvedModelSnapshot,
} from "./compiler-gym-hardened-paid-provider.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
	type CompilerGymPaidLiveEnvironmentGateEvidence,
} from "./compiler-gym-paid-live-environment-gate.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "./compiler-gym-proxy-cascade-protocol.js";
import type {
	RepositorySnapshot,
	StockInterfaceParityProviderRequestGate,
	StockInterfaceParityResolvedModelSnapshot,
} from "./stock-interface-parity.js";

export const COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS = ["full-control", "proxy-cascade"] as const;
export type CompilerGymProxyCascadePaidProviderArm = (typeof COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS)[number];

export const COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_HISTORY_POLICY = {
	providerDispatchesPerArm: 4,
	priorResultCountByDispatch: [0, 1, 2, 3],
	controlVisibleBenchmarkIds: [COMPILER_GYM_PROXY_CASCADE_BLOWFISH, COMPILER_GYM_PROXY_CASCADE_BZIP2],
	cascadeVisibleBenchmarkIds: [COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
	requestFourMaximumVisibleResultOrdinal: 3,
	resultFourMayNeverReachAnotherProviderRequest: true,
	semanticOutcomes: ["verified", "complete-semantic-rejection"],
	armLabelsProviderVisible: false,
	lateNoveltyGuidanceAllowed: false,
} as const;

const EXACT_SPEC_KEYS = [
	"agentRegistry",
	"arms",
	"historyPolicy",
	"maxDispatchesPerArm",
	"modelPolicy",
	"pairId",
	"prompt",
	"promptSha256",
	"providerSessionId",
	"providerVisibleConversationLog",
	"providerVisibleWorkspace",
	"runnerProtocol",
	"schemaVersion",
	"tool",
] as const;
const EXACT_PAYLOAD_KEYS = [
	"include",
	"input",
	"instructions",
	"model",
	"parallel_tool_calls",
	"prompt_cache_key",
	"reasoning",
	"service_tier",
	"store",
	"stream",
	"text",
	"tool_choice",
	"tools",
] as const;
const EXACT_TOOL_KEYS = ["description", "name", "parameters", "strict", "type"] as const;
const EXACT_ENVELOPE_KEYS = ["budget", "cascadeSelection", "evaluations", "request", "submissionOrdinal"] as const;
const EXACT_EVALUATION_KEYS = ["benchmarkId", "candidateOrdinal", "job", "submitted"] as const;
const EXACT_SUBMITTED_KEYS = ["duplicate", "jobId", "manifestDigest"] as const;
const EXACT_JOB_KEYS = ["candidateSha256", "jobId", "manifestDigest", "measurement", "state"] as const;
const EXACT_STATE_KEYS = ["externalJobId", "jobId", "reason", "status", "statusAt"] as const;
const EXACT_MEASUREMENT_KEYS = [
	"hardware",
	"jobId",
	"manifestDigest",
	"measuredAt",
	"provenance",
	"stderr",
	"stdout",
	"tasks",
	"verifierEpoch",
] as const;
const EXACT_TASK_KEYS = ["benchmarkId", "metrics", "runtimeMs", "status", "verifier"] as const;
const EXACT_VERIFIER_KEYS = ["checks", "errors", "passed"] as const;
const EXACT_ENVIRONMENT_KEYS = [
	"commandSha256",
	"expectedResultSha256",
	"pass",
	"probeSourceSha256",
	"protocol",
	"stdoutSha256",
	"wallMs",
] as const;
const SHA256 = /^[a-f0-9]{64}$/;

export interface CompilerGymProxyCascadePaidProviderRegistryClosure {
	agentDir: string;
	modelsJsonPath: string;
	modelsJsonPresent: false;
}

export interface CompilerGymProxyCascadePaidProviderSpec {
	schemaVersion: 1;
	runnerProtocol: string;
	pairId: string;
	arms: typeof COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS;
	prompt: string;
	promptSha256: string;
	tool: {
		name: string;
		description: string;
		parameters: unknown;
	};
	providerSessionId: string;
	providerVisibleWorkspace: string;
	providerVisibleConversationLog: string;
	agentRegistry: CompilerGymProxyCascadePaidProviderRegistryClosure;
	maxDispatchesPerArm: 4;
	modelPolicy: typeof COMPILER_GYM_HARDENED_PAID_MODEL_POLICY;
	historyPolicy: typeof COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_HISTORY_POLICY;
}

export interface CompilerGymProxyCascadePaidHistoryResultEvidence {
	submissionOrdinal: number;
	candidateSha256: string;
	benchmarkIds: string[];
	jobIds: string[];
	manifestDigests: string[];
	semanticOutcomes: Array<"verified" | "complete-semantic-rejection">;
}

export interface CompilerGymProxyCascadePaidHistoryEvidence {
	providerDispatchOrdinal: number;
	expectedPriorResultCount: number;
	observedPriorResultCount: number;
	results: CompilerGymProxyCascadePaidHistoryResultEvidence[];
}

export interface CompilerGymProxyCascadePaidRuntimeWorktreeAnchorEvidence {
	providerDispatchOrdinal: number;
	path: string;
	sha256: string;
	snapshotSha256: string;
	matchedPreregistration: boolean;
}

export interface CompilerGymProxyCascadePaidLiveEnvironmentAnchorEvidence {
	providerDispatchOrdinal: number;
	path: string;
	sha256: string;
	evidenceSha256: string;
	normalizedEvidenceSha256: string;
	matchedPairAnchor: boolean;
}

export interface CompilerGymProxyCascadePaidProviderTranscriptAnchorEvidence {
	providerDispatchOrdinal: number;
	path: string;
	sha256: string;
	requestBodySha256: string;
	previousTranscriptAnchorSha256: string | null;
}

export interface CompilerGymProxyCascadePaidProviderArmEvidence {
	arm: CompilerGymProxyCascadePaidProviderArm;
	specSha256: string;
	systemPromptEvents: number;
	workingDirectoryReplacements: number;
	conversationLogReplacements: number;
	normalizedSystemPromptSha256: string | null;
	normalizedSystemPromptMatchedPairAnchor: boolean | null;
	actualWorkspace: string | null;
	actualConversationLog: string | null;
	providerRequestAttempts: number;
	providerRequestBodySha256s: string[];
	firstProviderRequestBodyMatchedPairAnchor: boolean | null;
	resolvedModelSnapshotSha256s: string[];
	resolvedModelMatchedPairAnchor: boolean[];
	historyByDispatch: CompilerGymProxyCascadePaidHistoryEvidence[];
	runtimeWorktreeDispatchAnchors: CompilerGymProxyCascadePaidRuntimeWorktreeAnchorEvidence[];
	liveEnvironmentDispatchAnchors: CompilerGymProxyCascadePaidLiveEnvironmentAnchorEvidence[];
	providerRequestTranscriptAnchors: CompilerGymProxyCascadePaidProviderTranscriptAnchorEvidence[];
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	failures: string[];
}

export interface CompilerGymProxyCascadePaidProviderPairEvidence {
	specSha256: string;
	preregistrationSha256: string;
	normalizedSystemPromptSha256: string | null;
	firstProviderRequestBodySha256: string | null;
	resolvedModelSnapshotSha256: string | null;
	liveEnvironmentNormalizedEvidenceSha256: string | null;
	anchorArm: CompilerGymProxyCascadePaidProviderArm | null;
	completedArms: CompilerGymProxyCascadePaidProviderArm[];
	providerRequestAnchorPath: string;
	providerRequestAnchorSha256: string | null;
	previousTranscriptAnchorPath: string | null;
	previousTranscriptAnchorSha256: string | null;
	actualWorkspaces: string[];
	actualConversationLogs: string[];
	failures: string[];
}

export interface CompilerGymProxyCascadePaidProviderRuntime {
	evidence: CompilerGymProxyCascadePaidProviderArmEvidence;
	extensionFactory: ExtensionFactory;
	providerRequestGate: StockInterfaceParityProviderRequestGate;
}

export interface CompilerGymProxyCascadePaidProviderGuard {
	spec: CompilerGymProxyCascadePaidProviderSpec;
	specSha256: string;
	pairEvidence: CompilerGymProxyCascadePaidProviderPairEvidence;
	runtimeForArm(arm: CompilerGymProxyCascadePaidProviderArm): CompilerGymProxyCascadePaidProviderRuntime;
}

export interface CompilerGymProxyCascadePaidValidatedPayload {
	failures: string[];
	requestBody: string;
	requestBodySha256: string;
	history: CompilerGymProxyCascadePaidHistoryEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactJson(left: unknown, right: unknown): boolean {
	try {
		return canonicalJson(toJsonValue(left)) === canonicalJson(toJsonValue(right));
	} catch {
		return false;
	}
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): string[] {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
		? []
		: [`${label} keys drifted`];
}

function appendFailure(target: string[], failure: string): void {
	if (!target.includes(failure)) target.push(failure);
}

function containsArmLabel(value: string): boolean {
	const normalized = value.toLowerCase();
	return COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS.some((arm) => normalized.includes(arm.toLowerCase()));
}

function containsLateNoveltyGuidance(value: string): boolean {
	return /call4Guidance|late[- ]novelty guidance/i.test(value);
}

function replaceExactText(input: string, search: string, replacement: string): { value: string; count: number } {
	if (!search || search === replacement) return { value: input, count: 0 };
	const pieces = input.split(search);
	return { value: pieces.join(replacement), count: pieces.length - 1 };
}

function validateRegistryClosure(
	value: CompilerGymProxyCascadePaidProviderRegistryClosure,
): CompilerGymProxyCascadePaidProviderRegistryClosure {
	if (
		exactKeys(
			value as unknown as Record<string, unknown>,
			["agentDir", "modelsJsonPath", "modelsJsonPresent"],
			"provider registry closure",
		).length > 0 ||
		!value.agentDir.startsWith("/") ||
		value.modelsJsonPath !== resolve(value.agentDir, "models.json") ||
		value.modelsJsonPresent !== false
	) {
		throw new Error("Proxy-cascade paid provider registry closure is invalid");
	}
	return structuredClone(value);
}

export function buildCompilerGymProxyCascadePaidProviderSpec(input: {
	runnerProtocol: string;
	pairId: string;
	arms: typeof COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS;
	prompt: string;
	tool: { name: string; description: string; parameters: unknown };
	providerSessionId: string;
	providerVisibleWorkspace: string;
	providerVisibleConversationLog: string;
	agentRegistry: CompilerGymProxyCascadePaidProviderRegistryClosure;
}): CompilerGymProxyCascadePaidProviderSpec {
	return validateCompilerGymProxyCascadePaidProviderSpec({
		schemaVersion: 1,
		runnerProtocol: input.runnerProtocol,
		pairId: input.pairId,
		arms: [...input.arms],
		prompt: input.prompt,
		promptSha256: sha256Text(input.prompt),
		tool: structuredClone(input.tool),
		providerSessionId: input.providerSessionId,
		providerVisibleWorkspace: input.providerVisibleWorkspace,
		providerVisibleConversationLog: input.providerVisibleConversationLog,
		agentRegistry: validateRegistryClosure(input.agentRegistry),
		maxDispatchesPerArm: 4,
		modelPolicy: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
		historyPolicy: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_HISTORY_POLICY,
	});
}

export function validateCompilerGymProxyCascadePaidProviderSpec(
	value: CompilerGymProxyCascadePaidProviderSpec,
): CompilerGymProxyCascadePaidProviderSpec {
	const failures = exactKeys(value as unknown as Record<string, unknown>, EXACT_SPEC_KEYS, "provider spec");
	if (failures.length > 0) throw new Error(failures.join("; "));
	const tool = isRecord(value.tool) ? value.tool : null;
	if (
		value.schemaVersion !== 1 ||
		!value.runnerProtocol.trim() ||
		!value.pairId.trim() ||
		!exactJson(value.arms, COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS) ||
		!value.prompt.trim() ||
		value.promptSha256 !== sha256Text(value.prompt) ||
		!tool ||
		exactKeys(tool, ["description", "name", "parameters"], "provider tool spec").length > 0 ||
		typeof tool.name !== "string" ||
		!tool.name.trim() ||
		typeof tool.description !== "string" ||
		!tool.description.trim() ||
		!/^[A-Za-z0-9_-]{1,128}$/.test(value.providerSessionId) ||
		!value.providerVisibleWorkspace.startsWith("/") ||
		!value.providerVisibleConversationLog.startsWith("/") ||
		value.maxDispatchesPerArm !== 4 ||
		!exactJson(value.modelPolicy, COMPILER_GYM_HARDENED_PAID_MODEL_POLICY) ||
		!exactJson(value.historyPolicy, COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_HISTORY_POLICY)
	) {
		throw new Error("Proxy-cascade paid provider spec identity or frozen policy drifted");
	}
	validateRegistryClosure(value.agentRegistry);
	const providerVisible = canonicalJson(
		toJsonValue({
			prompt: value.prompt,
			tool: value.tool,
			providerSessionId: value.providerSessionId,
			providerVisibleWorkspace: value.providerVisibleWorkspace,
			providerVisibleConversationLog: value.providerVisibleConversationLog,
		}),
	);
	if (containsArmLabel(providerVisible)) {
		throw new Error("Proxy-cascade paid provider spec leaks an arm label into provider-visible state");
	}
	if (containsLateNoveltyGuidance(providerVisible)) {
		throw new Error("Proxy-cascade paid provider spec contains late-novelty guidance");
	}
	return structuredClone(value);
}

function semanticOutcomeForTask(task: Record<string, unknown>): "verified" | "complete-semantic-rejection" | null {
	if (!isRecord(task.verifier)) return null;
	if (task.status === "accepted" && task.verifier.passed === true) return "verified";
	if (task.status === "rejected" && task.verifier.passed === false) return "complete-semantic-rejection";
	return null;
}

function validateArtifact(value: unknown, label: string, failures: string[]): void {
	if (value === null) return;
	if (
		!isRecord(value) ||
		!SHA256.test(String(value.digest)) ||
		!Number.isSafeInteger(value.byteLength) ||
		Number(value.byteLength) < 0 ||
		typeof value.mediaType !== "string" ||
		!value.mediaType
	) {
		failures.push(`${label} artifact is invalid`);
	}
}

function validateHistoryEvaluation(input: {
	value: unknown;
	arm: CompilerGymProxyCascadePaidProviderArm;
	submissionOrdinal: number;
	request: Record<string, unknown>;
	expectedBenchmarkId: string;
	path: string;
}): {
	candidateSha256: string | null;
	jobId: string | null;
	manifestDigest: string | null;
	semanticOutcome: "verified" | "complete-semantic-rejection" | null;
	failures: string[];
} {
	const failures: string[] = [];
	if (!isRecord(input.value)) {
		return {
			candidateSha256: null,
			jobId: null,
			manifestDigest: null,
			semanticOutcome: null,
			failures: [`${input.path} is not an object`],
		};
	}
	failures.push(...exactKeys(input.value, EXACT_EVALUATION_KEYS, input.path));
	if (
		input.value.candidateOrdinal !== input.submissionOrdinal ||
		input.value.benchmarkId !== input.expectedBenchmarkId
	) {
		failures.push(`${input.path} candidate ordinal or benchmark drifted`);
	}
	const submitted = isRecord(input.value.submitted) ? input.value.submitted : null;
	const job = isRecord(input.value.job) ? input.value.job : null;
	if (!submitted) failures.push(`${input.path} submitted evidence is absent`);
	else {
		failures.push(...exactKeys(submitted, EXACT_SUBMITTED_KEYS, `${input.path}.submitted`));
		if (
			typeof submitted.jobId !== "string" ||
			!submitted.jobId ||
			!SHA256.test(String(submitted.manifestDigest)) ||
			submitted.duplicate !== false
		) {
			failures.push(`${input.path} submitted identity or duplicate flag drifted`);
		}
	}
	if (!job) {
		failures.push(`${input.path} job evidence is absent`);
		return { candidateSha256: null, jobId: null, manifestDigest: null, semanticOutcome: null, failures };
	}
	failures.push(...exactKeys(job, EXACT_JOB_KEYS, `${input.path}.job`));
	const actions = Array.isArray(input.request.actions) ? input.request.actions : [];
	if (actions.length === 0 || actions.some((action) => typeof action !== "string" || !action)) {
		failures.push(`${input.path} request actions are invalid`);
	}
	const candidateSha256 = actions.length > 0 ? sha256Json(actions) : null;
	if (
		!candidateSha256 ||
		job.candidateSha256 !== candidateSha256 ||
		job.jobId !== submitted?.jobId ||
		job.manifestDigest !== submitted?.manifestDigest
	) {
		failures.push(`${input.path} job, submission, candidate, or manifest binding drifted`);
	}
	const state = isRecord(job.state) ? job.state : null;
	if (!state) failures.push(`${input.path} terminal state is absent`);
	else {
		failures.push(...exactKeys(state, EXACT_STATE_KEYS, `${input.path}.job.state`));
		if (
			state.jobId !== job.jobId ||
			(state.status !== "succeeded" && state.status !== "invalid") ||
			typeof state.statusAt !== "string" ||
			!Number.isFinite(Date.parse(state.statusAt))
		) {
			failures.push(`${input.path} job state is not an exact terminal scientific outcome`);
		}
	}
	const measurement = isRecord(job.measurement) ? job.measurement : null;
	if (!measurement) {
		failures.push(`${input.path} terminal measurement is absent`);
		return {
			candidateSha256,
			jobId: typeof job.jobId === "string" ? job.jobId : null,
			manifestDigest: typeof job.manifestDigest === "string" ? job.manifestDigest : null,
			semanticOutcome: null,
			failures,
		};
	}
	failures.push(...exactKeys(measurement, EXACT_MEASUREMENT_KEYS, `${input.path}.job.measurement`));
	if (
		measurement.jobId !== job.jobId ||
		measurement.manifestDigest !== job.manifestDigest ||
		typeof measurement.verifierEpoch !== "string" ||
		!measurement.verifierEpoch ||
		typeof measurement.measuredAt !== "string" ||
		!Number.isFinite(Date.parse(measurement.measuredAt)) ||
		!isRecord(measurement.hardware) ||
		!isRecord(measurement.provenance)
	) {
		failures.push(`${input.path} measurement identity or provenance is incomplete`);
	}
	validateArtifact(measurement.stdout, `${input.path}.job.measurement.stdout`, failures);
	validateArtifact(measurement.stderr, `${input.path}.job.measurement.stderr`, failures);
	const tasks = Array.isArray(measurement.tasks) ? measurement.tasks : [];
	if (tasks.length !== 1 || !isRecord(tasks[0])) {
		failures.push(`${input.path} must expose exactly one authoritative task result`);
		return {
			candidateSha256,
			jobId: typeof job.jobId === "string" ? job.jobId : null,
			manifestDigest: typeof job.manifestDigest === "string" ? job.manifestDigest : null,
			semanticOutcome: null,
			failures,
		};
	}
	const task = tasks[0];
	failures.push(...exactKeys(task, EXACT_TASK_KEYS, `${input.path}.job.measurement.tasks[0]`));
	if (task.benchmarkId !== input.expectedBenchmarkId) {
		failures.push(`${input.path} measurement benchmark differs from its evaluation slot`);
	}
	if (!isRecord(task.metrics) || !Number.isFinite(task.runtimeMs) || Number(task.runtimeMs) < 0) {
		failures.push(`${input.path} task metrics or runtime are invalid`);
	}
	if (!isRecord(task.verifier)) failures.push(`${input.path} task verifier evidence is absent`);
	else {
		failures.push(
			...exactKeys(task.verifier, EXACT_VERIFIER_KEYS, `${input.path}.job.measurement.tasks[0].verifier`),
		);
		if (!Array.isArray(task.verifier.checks) || !Array.isArray(task.verifier.errors)) {
			failures.push(`${input.path} task verifier lists are invalid`);
		}
	}
	const semanticOutcome = semanticOutcomeForTask(task);
	if (!semanticOutcome) failures.push(`${input.path} task is failed, pending, or semantically incomplete`);
	if (
		semanticOutcome &&
		((semanticOutcome === "verified" && state?.status !== "succeeded") ||
			(semanticOutcome === "complete-semantic-rejection" && state?.status !== "invalid"))
	) {
		failures.push(`${input.path} terminal job state contradicts its task outcome`);
	}
	return {
		candidateSha256,
		jobId: typeof job.jobId === "string" ? job.jobId : null,
		manifestDigest: typeof job.manifestDigest === "string" ? job.manifestDigest : null,
		semanticOutcome,
		failures,
	};
}

function validateHistoryEnvelope(input: {
	value: unknown;
	callArguments: unknown;
	arm: CompilerGymProxyCascadePaidProviderArm;
	submissionOrdinal: number;
}): { evidence: CompilerGymProxyCascadePaidHistoryResultEvidence | null; failures: string[] } {
	const failures: string[] = [];
	if (!isRecord(input.value))
		return { evidence: null, failures: [`history result ${input.submissionOrdinal} is not an object`] };
	failures.push(...exactKeys(input.value, EXACT_ENVELOPE_KEYS, `history result ${input.submissionOrdinal}`));
	if (input.value.submissionOrdinal !== input.submissionOrdinal) {
		failures.push(`history result ${input.submissionOrdinal} ordinal drifted`);
	}
	if (!isRecord(input.value.request) || !exactJson(input.value.request, input.callArguments)) {
		failures.push(`history result ${input.submissionOrdinal} request differs from its function-call arguments`);
	}
	if (!isRecord(input.value.budget)) failures.push(`history result ${input.submissionOrdinal} budget is absent`);
	if (input.value.cascadeSelection !== null) {
		failures.push(`history result ${input.submissionOrdinal} exposes a cascade selection before request four`);
	}
	const evaluations = Array.isArray(input.value.evaluations) ? input.value.evaluations : [];
	const expectedBenchmarkIds =
		input.arm === "full-control"
			? [COMPILER_GYM_PROXY_CASCADE_BLOWFISH, COMPILER_GYM_PROXY_CASCADE_BZIP2]
			: [COMPILER_GYM_PROXY_CASCADE_BLOWFISH];
	if (evaluations.length !== expectedBenchmarkIds.length) {
		failures.push(`history result ${input.submissionOrdinal} visible evaluation count drifted`);
	}
	const semanticOutcomes: Array<"verified" | "complete-semantic-rejection"> = [];
	let candidateSha256: string | null = null;
	const jobIds: string[] = [];
	const manifestDigests: string[] = [];
	for (const [index, benchmarkId] of expectedBenchmarkIds.entries()) {
		const validated = validateHistoryEvaluation({
			value: evaluations[index],
			arm: input.arm,
			submissionOrdinal: input.submissionOrdinal,
			request: isRecord(input.value.request) ? input.value.request : {},
			expectedBenchmarkId: benchmarkId,
			path: `history result ${input.submissionOrdinal}.evaluations[${index}]`,
		});
		failures.push(...validated.failures);
		if (validated.semanticOutcome) semanticOutcomes.push(validated.semanticOutcome);
		if (validated.jobId) jobIds.push(validated.jobId);
		if (validated.manifestDigest) manifestDigests.push(validated.manifestDigest);
		if (candidateSha256 === null) candidateSha256 = validated.candidateSha256;
		else if (candidateSha256 !== validated.candidateSha256) {
			failures.push(`history result ${input.submissionOrdinal} evaluations bind different candidates`);
		}
	}
	if (new Set(jobIds).size !== jobIds.length || new Set(manifestDigests).size !== manifestDigests.length) {
		failures.push(`history result ${input.submissionOrdinal} reuses an evaluator job or manifest identity`);
	}
	if (containsArmLabel(JSON.stringify(input.value))) {
		failures.push(`history result ${input.submissionOrdinal} contains an arm label`);
	}
	if (containsLateNoveltyGuidance(JSON.stringify(input.value))) {
		failures.push(`history result ${input.submissionOrdinal} contains late-novelty guidance`);
	}
	return {
		evidence:
			candidateSha256 && semanticOutcomes.length === expectedBenchmarkIds.length
				? {
						submissionOrdinal: input.submissionOrdinal,
						candidateSha256,
						benchmarkIds: [...expectedBenchmarkIds],
						jobIds,
						manifestDigests,
						semanticOutcomes,
					}
				: null,
		failures,
	};
}

function inspectHistory(input: {
	payloadInput: unknown[];
	arm: CompilerGymProxyCascadePaidProviderArm;
	providerDispatchOrdinal: number;
	toolName: string;
}): { evidence: CompilerGymProxyCascadePaidHistoryEvidence; failures: string[] } {
	const failures: string[] = [];
	const results: CompilerGymProxyCascadePaidHistoryResultEvidence[] = [];
	const seenJobIds = new Set<string>();
	const seenManifestDigests = new Set<string>();
	let cursor = 1;
	for (let resultIndex = 0; resultIndex < input.providerDispatchOrdinal - 1; resultIndex++) {
		let messageItems = 0;
		while (cursor < input.payloadInput.length) {
			const item = input.payloadInput[cursor];
			if (!isRecord(item)) break;
			if (item.type === "reasoning") {
				if (
					exactKeys(item, ["content", "encrypted_content", "id", "summary", "type"], "provider reasoning item")
						.length > 0
				) {
					failures.push(`history turn ${resultIndex + 1} reasoning item shape drifted`);
				}
				cursor++;
				continue;
			}
			if (item.type === "message") {
				messageItems++;
				const keys = Object.hasOwn(item, "phase")
					? ["content", "id", "phase", "role", "status", "type"]
					: ["content", "id", "role", "status", "type"];
				if (
					messageItems > 1 ||
					exactKeys(item, keys, "provider assistant message").length > 0 ||
					item.role !== "assistant" ||
					item.status !== "completed" ||
					(Object.hasOwn(item, "phase") && item.phase !== "commentary" && item.phase !== "final_answer")
				) {
					failures.push(`history turn ${resultIndex + 1} assistant message shape drifted`);
				}
				cursor++;
				continue;
			}
			break;
		}
		const call = input.payloadInput[cursor];
		if (
			!isRecord(call) ||
			call.type !== "function_call" ||
			exactKeys(call, ["arguments", "call_id", "id", "name", "type"], "provider function call").length > 0 ||
			call.name !== input.toolName ||
			typeof call.call_id !== "string" ||
			!call.call_id ||
			typeof call.id !== "string" ||
			!call.id ||
			typeof call.arguments !== "string"
		) {
			failures.push(`history turn ${resultIndex + 1} function-call shape drifted`);
			break;
		}
		cursor++;
		let callArguments: unknown;
		try {
			callArguments = JSON.parse(call.arguments);
		} catch {
			failures.push(`history turn ${resultIndex + 1} function-call arguments are not JSON`);
			break;
		}
		const output = input.payloadInput[cursor];
		if (
			!isRecord(output) ||
			output.type !== "function_call_output" ||
			exactKeys(output, ["call_id", "output", "type"], "provider function-call output").length > 0 ||
			output.call_id !== call.call_id ||
			typeof output.output !== "string"
		) {
			failures.push(`history turn ${resultIndex + 1} function-call output shape drifted`);
			break;
		}
		cursor++;
		let envelope: unknown;
		try {
			envelope = JSON.parse(output.output);
		} catch {
			failures.push(`history result ${resultIndex + 1} is not JSON`);
			continue;
		}
		const validated = validateHistoryEnvelope({
			value: envelope,
			callArguments,
			arm: input.arm,
			submissionOrdinal: resultIndex + 1,
		});
		failures.push(...validated.failures);
		if (validated.evidence) {
			for (const jobId of validated.evidence.jobIds) {
				if (seenJobIds.has(jobId)) failures.push("provider request history reuses an evaluator job identity");
				seenJobIds.add(jobId);
			}
			for (const manifestDigest of validated.evidence.manifestDigests) {
				if (seenManifestDigests.has(manifestDigest)) {
					failures.push("provider request history reuses an evaluator manifest identity");
				}
				seenManifestDigests.add(manifestDigest);
			}
			results.push(validated.evidence);
		}
	}
	const expectedPriorResultCount = input.providerDispatchOrdinal - 1;
	if (cursor !== input.payloadInput.length)
		failures.push("provider request contains trailing or future result history");
	if (results.length !== expectedPriorResultCount)
		failures.push("provider request prior-result evidence count drifted");
	return {
		evidence: {
			providerDispatchOrdinal: input.providerDispatchOrdinal,
			expectedPriorResultCount,
			observedPriorResultCount: results.length,
			results,
		},
		failures,
	};
}

export function validateCompilerGymProxyCascadePaidProviderPayload(input: {
	payload: unknown;
	arm: CompilerGymProxyCascadePaidProviderArm;
	providerDispatchOrdinal: number;
	normalizedSystemPrompt: string | null;
	spec: CompilerGymProxyCascadePaidProviderSpec;
}): CompilerGymProxyCascadePaidValidatedPayload {
	const requestBody = JSON.stringify(input.payload);
	const requestBodySha256 = sha256Text(requestBody);
	const emptyHistory: CompilerGymProxyCascadePaidHistoryEvidence = {
		providerDispatchOrdinal: input.providerDispatchOrdinal,
		expectedPriorResultCount: Math.max(0, input.providerDispatchOrdinal - 1),
		observedPriorResultCount: 0,
		results: [],
	};
	const failures: string[] = [];
	if (
		!Number.isSafeInteger(input.providerDispatchOrdinal) ||
		input.providerDispatchOrdinal < 1 ||
		input.providerDispatchOrdinal > input.spec.maxDispatchesPerArm
	) {
		failures.push("provider dispatch ordinal must be one through four");
	}
	if (!COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS.includes(input.arm)) {
		failures.push("provider request arm is not part of the proxy-cascade pair");
	}
	if (!isRecord(input.payload)) {
		return {
			failures: [...failures, "provider request payload is not an object"],
			requestBody,
			requestBodySha256,
			history: emptyHistory,
		};
	}
	failures.push(...exactKeys(input.payload, EXACT_PAYLOAD_KEYS, "provider request payload"));
	const tools = Array.isArray(input.payload.tools) ? input.payload.tools : [];
	const tool = tools.length === 1 && isRecord(tools[0]) ? tools[0] : null;
	if (!tool) failures.push("provider request must contain exactly one object tool");
	else {
		failures.push(...exactKeys(tool, EXACT_TOOL_KEYS, "provider request tool"));
		if (
			tool.type !== "function" ||
			tool.name !== input.spec.tool.name ||
			tool.description !== input.spec.tool.description ||
			tool.strict !== null ||
			!exactJson(tool.parameters, input.spec.tool.parameters)
		) {
			failures.push("provider request tool identity or schema drifted");
		}
	}
	for (const [passed, message] of [
		[input.payload.model === COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.id, "provider request model drifted"],
		[input.payload.store === false, "provider request store flag drifted"],
		[input.payload.stream === true, "provider request stream flag drifted"],
		[input.payload.instructions === input.normalizedSystemPrompt, "provider request instructions drifted"],
		[input.payload.prompt_cache_key === input.spec.providerSessionId, "provider prompt-cache key drifted"],
		[input.payload.service_tier === "priority", "provider service tier drifted"],
		[input.payload.tool_choice === "auto", "provider tool choice drifted"],
		[input.payload.parallel_tool_calls === true, "provider parallel-tool flag drifted"],
		[exactJson(input.payload.include, ["reasoning.encrypted_content"]), "provider include list drifted"],
		[exactJson(input.payload.text, { verbosity: "low" }), "provider text configuration drifted"],
		[exactJson(input.payload.reasoning, { effort: "xhigh", summary: "auto" }), "provider reasoning drifted"],
	] as const) {
		if (!passed) failures.push(message);
	}
	if (containsArmLabel(requestBody)) failures.push("provider request contains an arm label");
	if (containsLateNoveltyGuidance(requestBody)) failures.push("provider request contains late-novelty guidance");
	if (!Array.isArray(input.payload.input)) {
		return {
			failures: [...failures, "provider request input is not an array"],
			requestBody,
			requestBodySha256,
			history: emptyHistory,
		};
	}
	const expectedFirstInput = [{ role: "user", content: [{ type: "input_text", text: input.spec.prompt }] }];
	if (!exactJson(input.payload.input.slice(0, 1), expectedFirstInput)) {
		failures.push("provider first input prompt shape drifted");
	}
	const inspected = inspectHistory({
		payloadInput: input.payload.input,
		arm: input.arm,
		providerDispatchOrdinal: input.providerDispatchOrdinal,
		toolName: input.spec.tool.name,
	});
	failures.push(...inspected.failures);
	return { failures, requestBody, requestBodySha256, history: inspected.evidence };
}

function validateLiveEnvironmentEvidence(value: CompilerGymPaidLiveEnvironmentGateEvidence): {
	failures: string[];
	evidenceSha256: string;
	normalizedEvidenceSha256: string;
} {
	const failures = exactKeys(
		value as unknown as Record<string, unknown>,
		EXACT_ENVIRONMENT_KEYS,
		"live environment evidence",
	);
	if (
		value.protocol !== COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL ||
		value.probeSourceSha256 !== COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256 ||
		value.expectedResultSha256 !== COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256 ||
		!SHA256.test(value.commandSha256) ||
		!SHA256.test(value.stdoutSha256) ||
		!Number.isFinite(value.wallMs) ||
		value.wallMs < 0 ||
		value.pass !== true
	) {
		failures.push("live environment evidence differs from the frozen passing contract");
	}
	return {
		failures,
		evidenceSha256: sha256Json(value),
		normalizedEvidenceSha256: sha256Json({ ...value, wallMs: 0 }),
	};
}

async function readPinnedPrivateText(path: string, expectedSha256: string): Promise<string> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`Proxy-cascade provider anchor is not a private regular file: ${path}`);
	}
	const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino) {
			throw new Error(`Proxy-cascade provider anchor changed before pinned read: ${path}`);
		}
		const contents = await handle.readFile("utf8");
		const after = await handle.stat();
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs ||
			after.mode !== before.mode ||
			sha256Text(contents) !== expectedSha256
		) {
			throw new Error(`Proxy-cascade provider anchor hash or metadata drifted: ${path}`);
		}
		return contents;
	} finally {
		await handle.close();
	}
}

async function readPinnedPrivateJson(path: string, expectedSha256: string): Promise<unknown> {
	return JSON.parse(await readPinnedPrivateText(path, expectedSha256)) as unknown;
}

async function writeExclusivePrivateJson(path: string, value: unknown): Promise<string> {
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const contentsSha256 = sha256Text(contents);
	const handle = await open(
		path,
		fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	if ((await readPinnedPrivateText(path, contentsSha256)) !== contents) {
		throw new Error(`Proxy-cascade provider anchor readback drifted: ${path}`);
	}
	return contentsSha256;
}

function resolvedModelSnapshotSha256(snapshot: StockInterfaceParityResolvedModelSnapshot | undefined): string | null {
	return snapshot ? sha256Json(snapshot) : null;
}

export function createCompilerGymProxyCascadePaidProviderGuard(input: {
	spec: CompilerGymProxyCascadePaidProviderSpec;
	preregistrationSha256: string;
	providerRequestAnchorPath: string;
	activeAgentDir: string;
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot;
	runtimeWorktreeSnapshotProvider: () => RepositorySnapshot | Promise<RepositorySnapshot>;
	liveEnvironmentEvidenceProvider: () =>
		| CompilerGymPaidLiveEnvironmentGateEvidence
		| Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
}): CompilerGymProxyCascadePaidProviderGuard {
	if (!SHA256.test(input.preregistrationSha256)) {
		throw new Error("Proxy-cascade paid provider preregistration hash is invalid");
	}
	const spec = validateCompilerGymProxyCascadePaidProviderSpec(input.spec);
	if (resolve(input.activeAgentDir) !== spec.agentRegistry.agentDir) {
		throw new Error("Active Prime agent directory differs from the provider registry closure");
	}
	const providerRequestAnchorPath = resolve(input.providerRequestAnchorPath);
	const expectedRuntimeWorktreeSnapshot = structuredClone(input.expectedRuntimeWorktreeSnapshot);
	const expectedRuntimeWorktreeSnapshotSha256 = sha256Json(expectedRuntimeWorktreeSnapshot);
	const specSha256 = sha256Json(spec);
	const pairEvidence: CompilerGymProxyCascadePaidProviderPairEvidence = {
		specSha256,
		preregistrationSha256: input.preregistrationSha256,
		normalizedSystemPromptSha256: null,
		firstProviderRequestBodySha256: null,
		resolvedModelSnapshotSha256: null,
		liveEnvironmentNormalizedEvidenceSha256: null,
		anchorArm: null,
		completedArms: [],
		providerRequestAnchorPath,
		providerRequestAnchorSha256: null,
		previousTranscriptAnchorPath: null,
		previousTranscriptAnchorSha256: null,
		actualWorkspaces: [],
		actualConversationLogs: [],
		failures: [],
	};
	const initializedArms = new Set<CompilerGymProxyCascadePaidProviderArm>();

	const runtimeForArm = (arm: CompilerGymProxyCascadePaidProviderArm): CompilerGymProxyCascadePaidProviderRuntime => {
		if (!COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS.includes(arm)) {
			throw new Error(`Unknown proxy-cascade paid provider arm: ${String(arm)}`);
		}
		if (initializedArms.has(arm)) throw new Error(`Proxy-cascade paid provider arm runtime already exists: ${arm}`);
		initializedArms.add(arm);
		let normalizedSystemPrompt: string | null = null;
		const evidence: CompilerGymProxyCascadePaidProviderArmEvidence = {
			arm,
			specSha256,
			systemPromptEvents: 0,
			workingDirectoryReplacements: 0,
			conversationLogReplacements: 0,
			normalizedSystemPromptSha256: null,
			normalizedSystemPromptMatchedPairAnchor: null,
			actualWorkspace: null,
			actualConversationLog: null,
			providerRequestAttempts: 0,
			providerRequestBodySha256s: [],
			firstProviderRequestBodyMatchedPairAnchor: null,
			resolvedModelSnapshotSha256s: [],
			resolvedModelMatchedPairAnchor: [],
			historyByDispatch: [],
			runtimeWorktreeDispatchAnchors: [],
			liveEnvironmentDispatchAnchors: [],
			providerRequestTranscriptAnchors: [],
			providerRequestAnchorPath,
			providerRequestAnchorSha256: null,
			failures: [],
		};
		const extensionFactory: ExtensionFactory = (pi: ExtensionAPI): void => {
			pi.on("before_agent_start", (event) => {
				evidence.systemPromptEvents++;
				if (evidence.systemPromptEvents !== 1)
					appendFailure(evidence.failures, "expected exactly one system-prompt event");
				if (event.systemPromptOptions.customPrompt !== undefined) {
					appendFailure(evidence.failures, "default system prompt was replaced");
				}
				if (!exactJson(event.systemPromptOptions.selectedTools ?? [], [spec.tool.name])) {
					appendFailure(evidence.failures, "active tools drifted");
				}
				if ((event.systemPromptOptions.contextFiles?.length ?? 0) !== 0) {
					appendFailure(evidence.failures, "context files were loaded");
				}
				if ((event.systemPromptOptions.skills?.length ?? 0) !== 0) {
					appendFailure(evidence.failures, "skills were loaded");
				}
				const workspace = event.systemPromptOptions.cwd.replace(/\\/g, "/");
				const conversationLog = event.systemPromptOptions.messagesPath?.replace(/\\/g, "/") ?? null;
				evidence.actualWorkspace = workspace;
				evidence.actualConversationLog = conversationLog;
				if (pairEvidence.actualWorkspaces.includes(workspace)) {
					appendFailure(evidence.failures, "paid arms reused a local workspace");
				} else pairEvidence.actualWorkspaces.push(workspace);
				if (!conversationLog) appendFailure(evidence.failures, "persistent conversation-log path is absent");
				else if (pairEvidence.actualConversationLogs.includes(conversationLog)) {
					appendFailure(evidence.failures, "paid arms reused a local conversation log");
				} else pairEvidence.actualConversationLogs.push(conversationLog);
				let normalized = event.systemPrompt;
				if (conversationLog) {
					const replacement = replaceExactText(normalized, conversationLog, spec.providerVisibleConversationLog);
					normalized = replacement.value;
					evidence.conversationLogReplacements = replacement.count;
				}
				const workspaceReplacement = replaceExactText(normalized, workspace, spec.providerVisibleWorkspace);
				normalized = workspaceReplacement.value;
				evidence.workingDirectoryReplacements = workspaceReplacement.count;
				if (evidence.workingDirectoryReplacements !== 1) {
					appendFailure(evidence.failures, "workspace normalization count drifted");
				}
				if (evidence.conversationLogReplacements !== 1) {
					appendFailure(evidence.failures, "conversation-log normalization count drifted");
				}
				if (containsArmLabel(normalized))
					appendFailure(evidence.failures, "normalized system prompt contains an arm label");
				if (containsLateNoveltyGuidance(normalized)) {
					appendFailure(evidence.failures, "normalized system prompt contains late-novelty guidance");
				}
				normalizedSystemPrompt = normalized;
				evidence.normalizedSystemPromptSha256 = sha256Text(normalized);
				if (pairEvidence.normalizedSystemPromptSha256 === null) {
					pairEvidence.normalizedSystemPromptSha256 = evidence.normalizedSystemPromptSha256;
					evidence.normalizedSystemPromptMatchedPairAnchor = true;
				} else {
					evidence.normalizedSystemPromptMatchedPairAnchor =
						pairEvidence.normalizedSystemPromptSha256 === evidence.normalizedSystemPromptSha256;
					if (!evidence.normalizedSystemPromptMatchedPairAnchor) {
						appendFailure(evidence.failures, "normalized system prompts differ by arm");
					}
				}
				return { systemPrompt: normalized };
			});
		};

		const providerRequestGate: StockInterfaceParityProviderRequestGate = async ({
			payload,
			providerDispatchOrdinal,
			resolvedModel,
		}) => {
			evidence.providerRequestAttempts++;
			if (
				providerDispatchOrdinal !== evidence.providerRequestAttempts ||
				providerDispatchOrdinal < 1 ||
				providerDispatchOrdinal > spec.maxDispatchesPerArm
			) {
				appendFailure(evidence.failures, "provider dispatch ordinal drifted or exceeded four");
				return { allowed: false, reason: evidence.failures.join("; ") };
			}
			if (evidence.systemPromptEvents !== 1 || normalizedSystemPrompt === null) {
				appendFailure(evidence.failures, "normalized system prompt is unavailable before provider dispatch");
			}
			try {
				await lstat(spec.agentRegistry.modelsJsonPath);
				appendFailure(evidence.failures, "models.json appeared after preregistration");
			} catch (error) {
				if (!isRecord(error) || error.code !== "ENOENT") throw error;
			}
			for (const failure of validateCompilerGymHardenedPaidResolvedModelSnapshot(resolvedModel)) {
				appendFailure(evidence.failures, failure);
			}
			const modelSha256 = resolvedModelSnapshotSha256(resolvedModel);
			if (modelSha256) evidence.resolvedModelSnapshotSha256s.push(modelSha256);
			const modelMatched =
				modelSha256 !== null &&
				(pairEvidence.resolvedModelSnapshotSha256 === null ||
					modelSha256 === pairEvidence.resolvedModelSnapshotSha256);
			evidence.resolvedModelMatchedPairAnchor.push(modelMatched);
			if (pairEvidence.resolvedModelSnapshotSha256 === null && modelSha256) {
				pairEvidence.resolvedModelSnapshotSha256 = modelSha256;
			} else if (!modelMatched) appendFailure(evidence.failures, "resolved model differs from pair anchor");

			let runtimeSnapshot: RepositorySnapshot | null = null;
			try {
				runtimeSnapshot = await input.runtimeWorktreeSnapshotProvider();
			} catch (error) {
				appendFailure(
					evidence.failures,
					`runtime worktree snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			const runtimeSnapshotSha256 = runtimeSnapshot ? sha256Json(runtimeSnapshot) : null;
			const runtimeMatched =
				runtimeSnapshot !== null &&
				runtimeSnapshotSha256 === expectedRuntimeWorktreeSnapshotSha256 &&
				exactJson(runtimeSnapshot, expectedRuntimeWorktreeSnapshot);
			const runtimeAnchorPath = `${providerRequestAnchorPath}.runtime-worktree.${arm}.${providerDispatchOrdinal}.json`;
			let runtimeAnchorSha256: string | null = null;
			if (runtimeSnapshot && runtimeSnapshotSha256) {
				runtimeAnchorSha256 = await writeExclusivePrivateJson(runtimeAnchorPath, {
					schemaVersion: 1,
					runnerProtocol: spec.runnerProtocol,
					pairId: spec.pairId,
					preregistrationSha256: input.preregistrationSha256,
					specSha256,
					arm,
					providerDispatchOrdinal,
					actualWorkspace: evidence.actualWorkspace,
					actualConversationLog: evidence.actualConversationLog,
					runtimeSnapshot,
					runtimeSnapshotSha256,
					expectedRuntimeWorktreeSnapshotSha256,
					matchedPreregistration: runtimeMatched,
				});
				evidence.runtimeWorktreeDispatchAnchors.push({
					providerDispatchOrdinal,
					path: runtimeAnchorPath,
					sha256: runtimeAnchorSha256,
					snapshotSha256: runtimeSnapshotSha256,
					matchedPreregistration: runtimeMatched,
				});
			}
			if (!runtimeMatched) appendFailure(evidence.failures, "runtime worktree differs from preregistration");

			let liveEnvironment: CompilerGymPaidLiveEnvironmentGateEvidence | null = null;
			try {
				liveEnvironment = await input.liveEnvironmentEvidenceProvider();
			} catch (error) {
				appendFailure(
					evidence.failures,
					`live environment evidence failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			const environmentAnchorPath = `${providerRequestAnchorPath}.live-environment.${arm}.${providerDispatchOrdinal}.json`;
			let environmentAnchorSha256: string | null = null;
			let normalizedEnvironmentSha256: string | null = null;
			if (liveEnvironment) {
				const validatedEnvironment = validateLiveEnvironmentEvidence(liveEnvironment);
				for (const failure of validatedEnvironment.failures) appendFailure(evidence.failures, failure);
				normalizedEnvironmentSha256 = validatedEnvironment.normalizedEvidenceSha256;
				const matchedPairAnchor =
					pairEvidence.liveEnvironmentNormalizedEvidenceSha256 === null ||
					pairEvidence.liveEnvironmentNormalizedEvidenceSha256 === normalizedEnvironmentSha256;
				if (pairEvidence.liveEnvironmentNormalizedEvidenceSha256 === null) {
					pairEvidence.liveEnvironmentNormalizedEvidenceSha256 = normalizedEnvironmentSha256;
				} else if (!matchedPairAnchor) {
					appendFailure(evidence.failures, "live environment evidence differs from pair anchor");
				}
				environmentAnchorSha256 = await writeExclusivePrivateJson(environmentAnchorPath, {
					schemaVersion: 1,
					runnerProtocol: spec.runnerProtocol,
					pairId: spec.pairId,
					preregistrationSha256: input.preregistrationSha256,
					specSha256,
					arm,
					providerDispatchOrdinal,
					evidence: liveEnvironment,
					evidenceSha256: validatedEnvironment.evidenceSha256,
					normalizedEvidenceSha256: normalizedEnvironmentSha256,
					matchedPairAnchor,
				});
				evidence.liveEnvironmentDispatchAnchors.push({
					providerDispatchOrdinal,
					path: environmentAnchorPath,
					sha256: environmentAnchorSha256,
					evidenceSha256: validatedEnvironment.evidenceSha256,
					normalizedEvidenceSha256: normalizedEnvironmentSha256,
					matchedPairAnchor,
				});
			}

			const validatedPayload = validateCompilerGymProxyCascadePaidProviderPayload({
				payload,
				arm,
				providerDispatchOrdinal,
				normalizedSystemPrompt,
				spec,
			});
			for (const failure of validatedPayload.failures) appendFailure(evidence.failures, failure);
			evidence.providerRequestBodySha256s.push(validatedPayload.requestBodySha256);
			evidence.historyByDispatch.push(validatedPayload.history);

			if (providerDispatchOrdinal === 1 && evidence.failures.length === 0) {
				if (pairEvidence.providerRequestAnchorSha256 === null) {
					pairEvidence.firstProviderRequestBodySha256 = validatedPayload.requestBodySha256;
					pairEvidence.anchorArm = arm;
					pairEvidence.providerRequestAnchorSha256 = await writeExclusivePrivateJson(providerRequestAnchorPath, {
						schemaVersion: 1,
						runnerProtocol: spec.runnerProtocol,
						pairId: spec.pairId,
						preregistrationSha256: input.preregistrationSha256,
						spec,
						specSha256,
						anchorArm: arm,
						normalizedSystemPromptSha256: evidence.normalizedSystemPromptSha256,
						resolvedModel,
						resolvedModelSnapshotSha256: modelSha256,
						expectedRuntimeWorktreeSnapshotSha256,
						liveEnvironmentNormalizedEvidenceSha256: normalizedEnvironmentSha256,
						firstProviderRequestBody: validatedPayload.requestBody,
						firstProviderRequestBodySha256: validatedPayload.requestBodySha256,
					});
					evidence.firstProviderRequestBodyMatchedPairAnchor = true;
				} else {
					try {
						const durable = await readPinnedPrivateJson(
							providerRequestAnchorPath,
							pairEvidence.providerRequestAnchorSha256,
						);
						if (
							!isRecord(durable) ||
							durable.runnerProtocol !== spec.runnerProtocol ||
							durable.pairId !== spec.pairId ||
							durable.preregistrationSha256 !== input.preregistrationSha256 ||
							durable.specSha256 !== specSha256 ||
							!exactJson(durable.spec, spec) ||
							durable.normalizedSystemPromptSha256 !== evidence.normalizedSystemPromptSha256 ||
							durable.resolvedModelSnapshotSha256 !== modelSha256 ||
							durable.expectedRuntimeWorktreeSnapshotSha256 !== expectedRuntimeWorktreeSnapshotSha256 ||
							durable.liveEnvironmentNormalizedEvidenceSha256 !== normalizedEnvironmentSha256 ||
							durable.firstProviderRequestBodySha256 !== validatedPayload.requestBodySha256 ||
							durable.firstProviderRequestBody !== validatedPayload.requestBody ||
							!COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS.includes(
								durable.anchorArm as CompilerGymProxyCascadePaidProviderArm,
							)
						) {
							appendFailure(evidence.failures, "provider first-request pair anchor claims drifted");
						}
					} catch (error) {
						appendFailure(
							evidence.failures,
							`provider first-request pair anchor revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					evidence.firstProviderRequestBodyMatchedPairAnchor =
						pairEvidence.firstProviderRequestBodySha256 === validatedPayload.requestBodySha256;
					if (!evidence.firstProviderRequestBodyMatchedPairAnchor) {
						appendFailure(evidence.failures, "first provider request body differs by arm");
					}
				}
			}
			evidence.providerRequestAnchorSha256 = pairEvidence.providerRequestAnchorSha256;

			if (pairEvidence.providerRequestAnchorSha256 !== null) {
				try {
					await readPinnedPrivateText(providerRequestAnchorPath, pairEvidence.providerRequestAnchorSha256);
				} catch (error) {
					appendFailure(
						evidence.failures,
						`provider pair anchor revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			if (pairEvidence.previousTranscriptAnchorPath && pairEvidence.previousTranscriptAnchorSha256) {
				try {
					await readPinnedPrivateText(
						pairEvidence.previousTranscriptAnchorPath,
						pairEvidence.previousTranscriptAnchorSha256,
					);
				} catch (error) {
					appendFailure(
						evidence.failures,
						`previous provider transcript anchor revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			if (
				evidence.failures.length === 0 &&
				pairEvidence.providerRequestAnchorSha256 !== null &&
				runtimeAnchorSha256 !== null &&
				environmentAnchorSha256 !== null &&
				modelSha256 !== null
			) {
				const previousTranscriptAnchorSha256 = pairEvidence.previousTranscriptAnchorSha256;
				const transcriptAnchorPath = `${providerRequestAnchorPath}.provider-request.${arm}.${providerDispatchOrdinal}.json`;
				const transcriptAnchorSha256 = await writeExclusivePrivateJson(transcriptAnchorPath, {
					schemaVersion: 1,
					runnerProtocol: spec.runnerProtocol,
					pairId: spec.pairId,
					preregistrationSha256: input.preregistrationSha256,
					specSha256,
					arm,
					providerDispatchOrdinal,
					providerSessionId: spec.providerSessionId,
					normalizedSystemPrompt,
					normalizedSystemPromptSha256: evidence.normalizedSystemPromptSha256,
					resolvedModel,
					resolvedModelSnapshotSha256: modelSha256,
					runtimeWorktreeAnchorPath: runtimeAnchorPath,
					runtimeWorktreeAnchorSha256: runtimeAnchorSha256,
					liveEnvironmentAnchorPath: environmentAnchorPath,
					liveEnvironmentAnchorSha256: environmentAnchorSha256,
					pairRequestAnchorSha256: pairEvidence.providerRequestAnchorSha256,
					previousTranscriptAnchorSha256,
					requestBody: validatedPayload.requestBody,
					requestBodySha256: validatedPayload.requestBodySha256,
					history: validatedPayload.history,
				});
				evidence.providerRequestTranscriptAnchors.push({
					providerDispatchOrdinal,
					path: transcriptAnchorPath,
					sha256: transcriptAnchorSha256,
					requestBodySha256: validatedPayload.requestBodySha256,
					previousTranscriptAnchorSha256,
				});
				pairEvidence.previousTranscriptAnchorPath = transcriptAnchorPath;
				pairEvidence.previousTranscriptAnchorSha256 = transcriptAnchorSha256;
				if (providerDispatchOrdinal === spec.maxDispatchesPerArm) {
					pairEvidence.completedArms.push(arm);
				}
			}
			if (evidence.failures.length > 0) {
				for (const failure of evidence.failures) appendFailure(pairEvidence.failures, failure);
			}
			return {
				allowed: evidence.failures.length === 0,
				reason: evidence.failures.length === 0 ? null : evidence.failures.join("; "),
			};
		};
		return { evidence, extensionFactory, providerRequestGate };
	};

	return { spec, specSha256, pairEvidence, runtimeForArm };
}

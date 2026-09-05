import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, type JsonValue, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import { parseAuthoritativeLlvmFlags } from "./compiler-gym-complete-action-space-headroom.js";
import { ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree } from "./compiler-gym-ir-delta-qualification-runner.js";
import {
	COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE,
	type CompilerGymCanonicalOneTaskPreparationEvidence,
	type CompilerGymCanonicalOneTaskSemanticResultAggregate,
	DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	FarmShareCompilerGymIrDeltaScreenAdapter,
	parseCompilerGymCanonicalOneTaskSemanticResultAggregate,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import {
	type CompilerGymPaidLiveEnvironmentGateEvidence,
	runCompilerGymPaidLiveEnvironmentGate,
} from "./compiler-gym-paid-live-environment-gate.js";
import {
	assertCompilerGymProxyCascadePaidLaunchPaths,
	COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE,
	COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE,
	COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE,
	type CompilerGymProxyCascadePaidPreregistration,
	type CompilerGymProxyCascadePaidPreregistrationBuildInput,
	canonicalCompilerGymProxyCascadePaidPreregistration,
	captureCompilerGymProxyCascadePaidProviderRegistryClosure,
	collectCompilerGymProxyCascadePaidImplementationClosure,
	parseCompilerGymProxyCascadePaidPreregistration,
} from "./compiler-gym-proxy-cascade-paid-preregistration.js";
import {
	assertCompilerGymProxyCascadePaidRequestPolicy,
	assertCompilerGymProxyCascadePaidRequestSequence,
	COMPILER_GYM_PROXY_CASCADE_PAID_ARMS,
	COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS,
	COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS,
	COMPILER_GYM_PROXY_CASCADE_PAID_CONTROL_ARM,
	COMPILER_GYM_PROXY_CASCADE_PAID_MAX_ACTIONS,
	COMPILER_GYM_PROXY_CASCADE_PAID_OUTPUT_TOKEN_LIMIT,
	COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY,
	COMPILER_GYM_PROXY_CASCADE_PAID_TOOL,
	type CompilerGymProxyCascadePaidArm,
	type CompilerGymProxyCascadePaidArmObservation,
	type CompilerGymProxyCascadePaidCallOrdinal,
	type CompilerGymProxyCascadePaidCandidate,
	CompilerGymProxyCascadePaidEvaluationSchema,
	type CompilerGymProxyCascadePaidPairAssessment,
	type CompilerGymProxyCascadePaidTaskMeasurement,
	evaluateCompilerGymProxyCascadePaidPair,
	selectCompilerGymProxyCascadePaidBzip2Ordinals,
} from "./compiler-gym-proxy-cascade-paid-protocol.js";
import {
	type CompilerGymProxyCascadePaidProviderArmEvidence,
	type CompilerGymProxyCascadePaidProviderGuard,
	type CompilerGymProxyCascadePaidProviderPairEvidence,
	createCompilerGymProxyCascadePaidProviderGuard,
} from "./compiler-gym-proxy-cascade-paid-provider.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "./compiler-gym-proxy-cascade-protocol.js";
import {
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { EvaluationAdapterOutputError } from "./evaluation-adapter-output-error.js";
import { createHostOwnedTerminalizationRuntimeTracker } from "./host-owned-terminalization.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import type { STOCK_CPU_TASKS, StockCpuEvaluationRequest } from "./stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	captureStockInterfaceParityResolvedModelSnapshot,
	createStockInterfaceParityProviderBoundBeforeSubmit,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
	type RepositorySnapshot,
	type StockInterfaceParityProviderRequestGate,
} from "./stock-interface-parity.js";
import type { StockInterfaceParityToolTrace } from "./stock-interface-parity-protocol.js";
import type {
	ArtifactRef,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	JobStateRecord,
	JobView,
	MeasurementRecord,
	ProposalRecord,
	SubmitResult,
} from "./types.js";

export const COMPILER_GYM_PROXY_CASCADE_PAID_RUN_RESULT_PROTOCOL =
	"compiler-gym-proxy-cascade-paid-directional-pilot-run-result-v1" as const;

const PROVIDER_TIMEOUT_MS = COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS.providerRequestTimeoutMilliseconds;
const MAX_TRUSTED_BYTES = 4 * 1024 * 1024;
const EMPTY_ABORTED_ASSISTANT_CONTENT = [{ type: "text", text: "" }] as const;
const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type LocalSealKind = "attempt" | CompilerGymProxyCascadePaidRemoteBoundaryKind;
type CompilerGymProxyCascadePaidRemoteBoundaryKind =
	| "global"
	| CompilerGymProxyCascadePaidArm
	| "selection"
	| "online-terminal"
	| "hidden-audit"
	| "terminal";

export interface CompilerGymProxyCascadePaidLocalSealEvidence {
	kind: LocalSealKind;
	path: string;
	contentsSha256: string;
	readbackSha256: string;
	mode: "0600";
	createOnly: true;
	value: unknown;
}

export interface CompilerGymProxyCascadePaidRemoteLockEvidence {
	kind: CompilerGymProxyCascadePaidRemoteBoundaryKind;
	path: string;
	contentsSha256: string;
	readbackSha256: string;
	mode: "0600";
	createOnly: true;
	claims: unknown;
}

export interface CompilerGymProxyCascadePaidReconstructedClosure {
	preregistration: CompilerGymProxyCascadePaidPreregistration;
	preregistrationContents: string;
	preregistrationSha256: string;
}

export interface CompilerGymProxyCascadePaidOneTaskEvaluator {
	prepareCanonicalOneTask(signal: AbortSignal): Promise<CompilerGymCanonicalOneTaskPreparationEvidence>;
	evaluateCanonicalOneTaskSemanticResult(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome>;
}

export interface CompilerGymProxyCascadePaidAgentRuntime {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: Model<Api>;
	agentDir: string;
	dispose?: () => void | Promise<void>;
}

export interface CompilerGymProxyCascadePaidProviderGuardFactoryInput {
	preregistration: CompilerGymProxyCascadePaidPreregistration;
	preregistrationSha256: string;
	activeAgentDir: string;
	runtimeWorktreeSnapshotProvider: () => RepositorySnapshot | Promise<RepositorySnapshot>;
	liveEnvironmentEvidenceProvider: () =>
		| CompilerGymPaidLiveEnvironmentGateEvidence
		| Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
}

export interface CompilerGymProxyCascadePaidAllocationEvidence {
	arm: CompilerGymProxyCascadePaidArm;
	candidateOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	phase: CompilerGymProxyCascadePaidTaskMeasurement["phase"];
	submitted: SubmitResult;
	job: JobView;
	aggregate: CompilerGymCanonicalOneTaskSemanticResultAggregate;
	task: CompilerGymProxyCascadePaidTaskMeasurement;
	startedMonotonicMicros: number;
	feedbackReadyMonotonicMicros: number;
}

export interface CompilerGymProxyCascadePaidErrorEvidence {
	name: string;
	message: string;
	code: string | null;
	hostEvidence: JsonValue | null;
	stdout: ArtifactRef | null;
	stderr: ArtifactRef | null;
	causes: CompilerGymProxyCascadePaidErrorEvidence[];
}

export interface CompilerGymProxyCascadePaidEvaluationFailureEvidence {
	jobId: string;
	manifestDigest: string;
	arm: CompilerGymProxyCascadePaidArm;
	candidateOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	phase: CompilerGymProxyCascadePaidTaskMeasurement["phase"];
	externalJobId: string | null;
	terminalStateAlreadyPersisted: boolean;
	error: CompilerGymProxyCascadePaidErrorEvidence;
}

export interface CompilerGymProxyCascadePaidArmEvidence {
	arm: CompilerGymProxyCascadePaidArm;
	observation: CompilerGymProxyCascadePaidArmObservation;
	candidates: CompilerGymProxyCascadePaidCandidate[];
	toolOutputs: unknown[];
	providerTracker: ProviderBudgetTracker;
	providerGuard: CompilerGymProxyCascadePaidProviderArmEvidence;
	liveEnvironmentGates: CompilerGymPaidLiveEnvironmentGateEvidence[];
	assistantMessageUsages: Usage[];
	sessionId: string;
	sessionFile: string;
	sessionSha256AtOnlineTerminal: string;
	sessionSha256AfterHiddenAudits: string | null;
	eventCounts: Record<string, number>;
	policyFailures: string[];
	apparatusFailures: string[];
	activeAgentMicros: number;
	activeAgentCheckpointExceeded: boolean;
}

export interface CompilerGymProxyCascadePaidRunnerResult {
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_PAID_RUN_RESULT_PROTOCOL;
	runnerProtocol: typeof COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL;
	runtimeMode: "production-defaults-no-dependency-injection" | "test-only-injected-runtime";
	ok: boolean;
	liveScientificEvidenceEligible: boolean;
	classification: "one-observed-randomized-order-directional-paid-pair-only";
	terminalClassification:
		| (typeof COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY)[keyof typeof COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY]
		| "pre-dispatch-refusal-attempt-identity-not-consumed";
	failure: string | null;
	preregistrationSha256: string;
	scientificIdentitySha256: string;
	armExecutionOrder: readonly [CompilerGymProxyCascadePaidArm, CompilerGymProxyCascadePaidArm];
	localAttemptLock: CompilerGymProxyCascadePaidLocalSealEvidence;
	localSeals: CompilerGymProxyCascadePaidLocalSealEvidence[];
	remoteLocks: CompilerGymProxyCascadePaidRemoteLockEvidence[];
	globalPreparation: CompilerGymCanonicalOneTaskPreparationEvidence | null;
	arms: Partial<Record<CompilerGymProxyCascadePaidArm, CompilerGymProxyCascadePaidArmEvidence>>;
	allocations: CompilerGymProxyCascadePaidAllocationEvidence[];
	evaluationAttemptCount: number;
	externalAllocationCount: number;
	terminalMeasurementCount: number;
	failedEvaluations: CompilerGymProxyCascadePaidEvaluationFailureEvidence[];
	assessment: CompilerGymProxyCascadePaidPairAssessment | null;
	providerPair: CompilerGymProxyCascadePaidProviderPairEvidence | null;
	maximumObservedEvaluatorConcurrency: number;
	hiddenAuditsStartedAfterBothOnlineArmsTerminal: boolean;
	hiddenAuditEvidenceWasAgentInaccessible: boolean;
	ledgerPath: string;
	ledgerSha256: string;
	ledgerTerminalHash: string;
	startedAt: string;
	finishedAt: string;
}

export interface CompilerGymProxyCascadePaidRunnerInput {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	signal?: AbortSignal;
}

export interface CompilerGymProxyCascadePaidRunnerDependencies {
	testOnlyInjectedRuntime?: true;
	reconstructPreregistration?: (
		input: CompilerGymProxyCascadePaidRunnerInput,
	) => Promise<CompilerGymProxyCascadePaidReconstructedClosure>;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	evaluator?: CompilerGymProxyCascadePaidOneTaskEvaluator;
	environmentGate?: (signal: AbortSignal) => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	providerGuardFactory?: (
		input: CompilerGymProxyCascadePaidProviderGuardFactoryInput,
	) => CompilerGymProxyCascadePaidProviderGuard;
	agentRuntimeFactory?: (
		arm: CompilerGymProxyCascadePaidArm,
		preregistration: CompilerGymProxyCascadePaidPreregistration,
	) => Promise<CompilerGymProxyCascadePaidAgentRuntime>;
	now?: () => Date;
	monotonicNowMicros?: () => number;
}

interface RuntimeDependencies {
	runtimeMode: CompilerGymProxyCascadePaidRunnerResult["runtimeMode"];
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	evaluator: CompilerGymProxyCascadePaidOneTaskEvaluator;
	environmentGate: (signal: AbortSignal) => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	providerGuardFactory: NonNullable<CompilerGymProxyCascadePaidRunnerDependencies["providerGuardFactory"]>;
	agentRuntimeFactory: NonNullable<CompilerGymProxyCascadePaidRunnerDependencies["agentRuntimeFactory"]>;
	now: () => Date;
	monotonicNowMicros: () => number;
}

interface ConcurrencyTracker {
	active: number;
	maximum: number;
}

interface LedgerAppendCoordinator {
	appendAdmission(proposal: ProposalRecord): Promise<string>;
	appendState(state: JobStateRecord): Promise<string>;
	appendTerminal(measurement: MeasurementRecord, state: JobStateRecord): Promise<string>;
	appendFailure(
		failure: CompilerGymProxyCascadePaidEvaluationFailureEvidence,
		state: JobStateRecord | null,
	): Promise<string>;
}

function createLedgerAppendCoordinator(ledger: EvidenceLedger, now: () => Date): LedgerAppendCoordinator {
	let tail = Promise.resolve();
	const enqueue = async (operation: () => Promise<string>): Promise<string> => {
		const result = tail.then(operation);
		tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	return {
		appendAdmission: (proposal) =>
			enqueue(async () => {
				const acceptedAt = now().toISOString();
				await ledger.append("proposal", proposal, acceptedAt);
				await ledger.append(
					"job_state",
					{ jobId: proposal.jobId, status: "accepted", statusAt: acceptedAt, externalJobId: null, reason: null },
					acceptedAt,
				);
				return acceptedAt;
			}),
		appendState: (state) =>
			enqueue(async () => {
				const statusAt = now().toISOString();
				state.statusAt = statusAt;
				await ledger.append("job_state", state, statusAt);
				return statusAt;
			}),
		appendTerminal: (measurement, state) =>
			enqueue(async () => {
				const measuredAt = now().toISOString();
				measurement.measuredAt = measuredAt;
				state.statusAt = measuredAt;
				await ledger.append("measurement", measurement, measuredAt);
				await ledger.append("job_state", state, measuredAt);
				return measuredAt;
			}),
		appendFailure: (failure, state) =>
			enqueue(async () => {
				const failedAt = now().toISOString();
				await ledger.append("run_manifest", { type: "proxy_cascade_paid_evaluation_failed", ...failure }, failedAt);
				if (state) {
					state.statusAt = failedAt;
					await ledger.append("job_state", state, failedAt);
				}
				return failedAt;
			}),
	};
}

interface AllocationUniqueness {
	jobIds: Set<string>;
	manifestDigests: Set<string>;
	slurmIds: Set<string>;
	transientCaches: Set<string>;
	jobNames: Set<string>;
}

interface ArmToolTrace extends Pick<StockInterfaceParityToolTrace, "callCount"> {
	toolCallAttempts: number;
	toolExecutions: number;
	requests: StockCpuEvaluationRequest[];
	toolOutputs: unknown[];
	policyFailures: string[];
	apparatusFailures: string[];
	onlineEvaluatorWaitMicros: number;
}

class PaidPolicyNonconformanceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PaidPolicyNonconformanceError";
	}
}

function boundedFailureText(value: string, maximumLength = 16_384): string {
	return value.length <= maximumLength ? value : `${value.slice(0, maximumLength)}\n[truncated]`;
}

function nestedErrors(error: unknown): unknown[] {
	if (error instanceof AggregateError) return Array.from(error.errors as Iterable<unknown>);
	if (error instanceof Error && error.cause !== undefined) return [error.cause];
	return [];
}

function errorText(error: unknown, seen: Set<object> = new Set()): string {
	if (typeof error === "object" && error !== null) {
		if (seen.has(error)) return "[cyclic error cause]";
		seen.add(error);
	}
	const base = error instanceof Error ? (error.stack ?? error.message) : String(error);
	const adapterDetails =
		error instanceof EvaluationAdapterOutputError
			? [
					`code=${error.code}`,
					`hostEvidence=${canonicalJson(error.hostEvidence)}`,
					error.stdout === undefined ? null : `stdoutSha256=${sha256Text(error.stdout)}`,
					error.stderr === undefined ? null : `stderrSha256=${sha256Text(error.stderr)}`,
				].filter((value): value is string => value !== null)
			: [];
	const children = nestedErrors(error).map((cause, index) => `Cause ${index + 1}: ${errorText(cause, seen)}`);
	return boundedFailureText([base, ...adapterDetails, ...children].join("\n"));
}

async function persistErrorEvidence(
	error: unknown,
	artifactStore: ArtifactStore,
	seen: Set<object> = new Set(),
): Promise<CompilerGymProxyCascadePaidErrorEvidence> {
	if (typeof error === "object" && error !== null) {
		if (seen.has(error)) {
			return {
				name: "CyclicErrorCause",
				message: "Error cause graph contains a cycle",
				code: null,
				hostEvidence: null,
				stdout: null,
				stderr: null,
				causes: [],
			};
		}
		seen.add(error);
	}
	const adapterError = error instanceof EvaluationAdapterOutputError ? error : null;
	const [stdout, stderr, causes] = await Promise.all([
		adapterError?.stdout === undefined
			? Promise.resolve(null)
			: artifactStore.putString(adapterError.stdout, "application/vnd.prime.evaluator-stdout+text"),
		adapterError?.stderr === undefined
			? Promise.resolve(null)
			: artifactStore.putString(adapterError.stderr, "application/vnd.prime.evaluator-stderr+text"),
		Promise.all(nestedErrors(error).map((cause) => persistErrorEvidence(cause, artifactStore, seen))),
	]);
	const code = adapterError?.code ?? (isRecord(error) && typeof error.code === "string" ? error.code : null);
	return {
		name: boundedFailureText(error instanceof Error ? error.name : "NonError", 128),
		message: boundedFailureText(error instanceof Error ? error.message : String(error), 4_096),
		code,
		hostEvidence: adapterError ? structuredClone(adapterError.hostEvidence) : null,
		stdout,
		stderr,
		causes,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsent(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

function sumUsage(usages: readonly Usage[]): Usage {
	return usages.reduce<Usage>(
		(total, usage) => ({
			input: total.input + usage.input,
			output: total.output + usage.output,
			cacheRead: total.cacheRead + usage.cacheRead,
			cacheWrite: total.cacheWrite + usage.cacheWrite,
			totalTokens: total.totalTokens + usage.totalTokens,
			cost: {
				input: total.cost.input + usage.cost.input,
				output: total.cost.output + usage.cost.output,
				cacheRead: total.cost.cacheRead + usage.cost.cacheRead,
				cacheWrite: total.cost.cacheWrite + usage.cost.cacheWrite,
				total: total.cost.total + usage.cost.total,
			},
		}),
		structuredClone(ZERO_USAGE),
	);
}

function eventCounts(events: readonly AgentSessionEvent[]): Record<string, number> {
	return Object.fromEntries(
		[...new Set(events.map((event) => event.type))]
			.sort()
			.map((type) => [type, events.filter((event) => event.type === type).length]),
	);
}

function orderedEvaluationFailures(
	failures: readonly CompilerGymProxyCascadePaidEvaluationFailureEvidence[],
): CompilerGymProxyCascadePaidEvaluationFailureEvidence[] {
	return [...failures].sort(
		(left, right) =>
			left.arm.localeCompare(right.arm) ||
			left.candidateOrdinal - right.candidateOrdinal ||
			left.benchmarkId.localeCompare(right.benchmarkId) ||
			left.jobId.localeCompare(right.jobId),
	);
}

async function settleAllOrThrow<T>(operations: readonly Promise<T>[], label: string): Promise<T[]> {
	const settled = await Promise.allSettled(operations);
	const failures = settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
	if (failures.length > 0) {
		throw new AggregateError(failures, `${label} failed after every concurrent evaluator operation drained`);
	}
	return settled.map((result) => {
		if (result.status !== "fulfilled") throw new Error(`${label} settlement reconciliation drifted`);
		return result.value;
	});
}

function persistedAssistantMessages(sessionContents: string): AssistantMessage[] {
	if (!sessionContents.endsWith("\n")) throw new Error("Paid-pilot session JSONL is not newline terminated");
	return sessionContents
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown)
		.flatMap((entry) => {
			if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return [];
			return entry.message.role === "assistant" && isRecord(entry.message.usage)
				? [structuredClone(entry.message) as unknown as AssistantMessage]
				: [];
		});
}

function persistedPaidToolOutputs(sessionContents: string): unknown[] {
	return sessionContents
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown)
		.flatMap((entry) => {
			if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return [];
			const message = entry.message;
			if (message.role !== "toolResult" || !Array.isArray(message.content)) return [];
			const textBlocks = message.content.filter(
				(block): block is Record<string, unknown> =>
					isRecord(block) && block.type === "text" && typeof block.text === "string",
			);
			if (textBlocks.length !== 1) throw new Error("Paid-pilot durable tool result lacks exactly one text block");
			return [JSON.parse(String(textBlocks[0]!.text)) as unknown];
		});
}

function isExactBlockedContinuation(message: AssistantMessage): boolean {
	return (
		message.stopReason === "aborted" &&
		message.errorMessage === "Request was aborted" &&
		canonicalJson(toJsonValue(message.content)) === canonicalJson(toJsonValue(EMPTY_ABORTED_ASSISTANT_CONTENT)) &&
		canonicalJson(toJsonValue(message.usage)) === canonicalJson(toJsonValue(ZERO_USAGE))
	);
}

async function readPinnedPrivateText(path: string, expectedSha256?: string): Promise<string> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`Paid-pilot input is not a private regular file: ${path}`);
	}
	const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		const contents = await handle.readFile("utf8");
		const after = await handle.stat();
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs ||
			after.mode !== before.mode ||
			(expectedSha256 !== undefined && sha256Text(contents) !== expectedSha256)
		) {
			throw new Error(`Paid-pilot pinned input changed or drifted: ${path}`);
		}
		return contents;
	} finally {
		await handle.close();
	}
}

async function writeLocalSeal(
	path: string,
	kind: LocalSealKind,
	value: unknown,
): Promise<CompilerGymProxyCascadePaidLocalSealEvidence> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
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
	const readback = await readPinnedPrivateText(path, sha256Text(contents));
	if (readback !== contents) throw new Error(`Paid-pilot ${kind} local seal readback drifted`);
	return {
		kind,
		path,
		contentsSha256: sha256Text(contents),
		readbackSha256: sha256Text(readback),
		mode: "0600",
		createOnly: true,
		value: structuredClone(value),
	};
}

async function verifyLocalSeals(seals: readonly CompilerGymProxyCascadePaidLocalSealEvidence[]): Promise<void> {
	for (const seal of seals) {
		const expected = `${canonicalJson(toJsonValue(seal.value))}\n`;
		if ((await readPinnedPrivateText(seal.path, seal.contentsSha256)) !== expected) {
			throw new Error(`Paid-pilot ${seal.kind} local seal postflight drifted`);
		}
	}
}

async function createRemoteLock(input: {
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	preregistration: CompilerGymProxyCascadePaidPreregistration;
	kind: CompilerGymProxyCascadePaidRemoteBoundaryKind;
	path: string;
	claims: unknown;
	ensureRoot: boolean;
	signal: AbortSignal;
}): Promise<CompilerGymProxyCascadePaidRemoteLockEvidence> {
	if (posix.dirname(input.path) !== input.preregistration.remoteLocks.root) {
		throw new Error("Paid-pilot remote lock path differs from its preregistered identity root");
	}
	if (input.ensureRoot) {
		await ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree(
			input.remoteFileSystem,
			input.preregistration.remoteLocks.root,
			input.signal,
		);
	}
	const contents = `${canonicalJson(toJsonValue(input.claims))}\n`;
	const contentsSha256 = sha256Text(contents);
	await input.remoteFileSystem.installImmutableFile(input.path, contents, contentsSha256, 0o600, false, input.signal);
	const readback = await input.remoteFileSystem.readTrustedFile(
		input.path,
		{ maxBytes: MAX_TRUSTED_BYTES, mode: 0o600, expectedSha256: contentsSha256 },
		input.signal,
	);
	if (readback !== contents) throw new Error(`Paid-pilot ${input.kind} remote lock readback drifted`);
	return {
		kind: input.kind,
		path: input.path,
		contentsSha256,
		readbackSha256: sha256Text(readback),
		mode: "0600",
		createOnly: true,
		claims: structuredClone(input.claims),
	};
}

async function verifyRemoteLocks(
	remoteFileSystem: CompilerGymWarmRemoteFileSystem,
	locks: readonly CompilerGymProxyCascadePaidRemoteLockEvidence[],
	signal: AbortSignal,
): Promise<void> {
	for (const lock of locks) {
		const expected = `${canonicalJson(toJsonValue(lock.claims))}\n`;
		const readback = await remoteFileSystem.readTrustedFile(
			lock.path,
			{ maxBytes: MAX_TRUSTED_BYTES, mode: 0o600, expectedSha256: lock.contentsSha256 },
			signal,
		);
		if (readback !== expected) throw new Error(`Paid-pilot ${lock.kind} remote lock postflight drifted`);
	}
}

async function assertOutputDirectoryAbsent(path: string): Promise<void> {
	try {
		await stat(path);
		throw new Error("Paid-pilot output directory must be absent before the attempt lock is consumed");
	} catch (error) {
		if (!isAbsent(error)) throw error;
	}
}

async function probeOutputPersistenceBeforeAttempt(outputDir: string): Promise<void> {
	const parent = dirname(outputDir);
	await mkdir(parent, { recursive: true, mode: 0o700 });
	const probeRoot = await mkdtemp(resolve(parent, ".proxy-cascade-paid-readiness-"));
	try {
		await chmod(probeRoot, 0o700);
		const probePath = resolve(probeRoot, "private-create-only-readback.txt");
		const contents = "proxy-cascade-paid-output-readiness-v1\n";
		const handle = await open(
			probePath,
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
		if ((await readPinnedPrivateText(probePath, sha256Text(contents))) !== contents) {
			throw new Error("Paid-pilot output readiness readback drifted");
		}
	} finally {
		await rm(probeRoot, { recursive: true, force: true });
	}
}

async function reconstructProductionPreregistration(
	input: CompilerGymProxyCascadePaidRunnerInput,
): Promise<CompilerGymProxyCascadePaidReconstructedClosure> {
	const repoRoot = await realpath(resolve(input.repoRoot));
	const preregistrationPath = resolve(input.preregistrationPath);
	const outputDir = resolve(input.outputDir);
	const preregistrationContents = await readPinnedPrivateText(preregistrationPath);
	if (!preregistrationContents.endsWith("\n") || preregistrationContents.slice(0, -1).includes("\n")) {
		throw new Error("Paid-pilot preregistration must be one canonical JSON line");
	}
	const value: unknown = JSON.parse(preregistrationContents);
	if (!isRecord(value) || !isRecord(value.randomization) || typeof value.createdAt !== "string") {
		throw new Error("Paid-pilot preregistration envelope is incomplete");
	}
	const readEvidence = (source: { path: string; sha256: string }) =>
		readPinnedPrivateText(resolve(repoRoot, source.path), source.sha256);
	const [
		resourcePreregistrationContents,
		resourceResultContents,
		resourceLedgerContents,
		rlmResultContents,
		rlmLedgerContents,
		rlmManifestStartContents,
		rlmManifestEndContents,
		previousAttemptPreregistrationContents,
		previousAttemptResultContents,
		previousAttemptLedgerContents,
		previousAttemptTerminalSealContents,
		previousAttemptSessionContents,
		authoritativeEvaluatorContents,
		implementationClosure,
		providerRegistryClosure,
	] = await Promise.all([
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.preregistration),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.result),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.ledger),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.result),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.ledger),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.manifestStart),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.manifestEnd),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.preregistration),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.result),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.ledger),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.terminalSeal),
		readEvidence(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.session),
		readFile(resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py"), "utf8"),
		collectCompilerGymProxyCascadePaidImplementationClosure(repoRoot),
		captureCompilerGymProxyCascadePaidProviderRegistryClosure(getAgentDir()),
	]);
	if (sha256Text(authoritativeEvaluatorContents) !== COMPILER_GYM_EVALUATOR_SHA256) {
		throw new Error("Paid-pilot authoritative evaluator source drifted");
	}
	const expected: CompilerGymProxyCascadePaidPreregistrationBuildInput = {
		createdAt: value.createdAt,
		drawHex: String(value.randomization.drawHex),
		repoRoot,
		preregistrationPath,
		outputDir,
		resourcePreregistrationContents,
		resourceResultContents,
		resourceLedgerContents,
		rlmResultContents,
		rlmLedgerContents,
		rlmManifestStartContents,
		rlmManifestEndContents,
		previousAttemptPreregistrationContents,
		previousAttemptResultContents,
		previousAttemptLedgerContents,
		previousAttemptTerminalSealContents,
		previousAttemptSessionContents,
		authoritativeActions: parseAuthoritativeLlvmFlags(authoritativeEvaluatorContents),
		implementationClosure,
		runtimeWorktreeSnapshot: capturePrimeRuntimeWorktreeSnapshot(repoRoot),
		providerRegistryClosure,
	};
	const preregistration = parseCompilerGymProxyCascadePaidPreregistration({ value, expected });
	if (canonicalCompilerGymProxyCascadePaidPreregistration(preregistration) !== preregistrationContents) {
		throw new Error("Paid-pilot preregistration bytes are not canonical");
	}
	assertCompilerGymProxyCascadePaidLaunchPaths(preregistration.launchPaths);
	return { preregistration, preregistrationContents, preregistrationSha256: sha256Text(preregistrationContents) };
}

function validateDependencyBoundary(dependencies: CompilerGymProxyCascadePaidRunnerDependencies): void {
	const injected = [
		dependencies.reconstructPreregistration,
		dependencies.remoteFileSystem,
		dependencies.evaluator,
		dependencies.environmentGate,
		dependencies.providerGuardFactory,
		dependencies.agentRuntimeFactory,
		dependencies.now,
		dependencies.monotonicNowMicros,
	];
	if (dependencies.testOnlyInjectedRuntime === true) {
		if (injected.some((value) => value === undefined)) {
			throw new Error("Test-only paid-pilot runtime requires a complete dependency set");
		}
		return;
	}
	if (injected.some((value) => value !== undefined)) {
		throw new Error("Paid-pilot dependency injection must be explicitly test-only");
	}
}

function resolveRuntimeDependencies(
	input: CompilerGymProxyCascadePaidRunnerInput,
	dependencies: CompilerGymProxyCascadePaidRunnerDependencies,
): RuntimeDependencies {
	if (dependencies.testOnlyInjectedRuntime === true) {
		return {
			runtimeMode: "test-only-injected-runtime",
			remoteFileSystem: dependencies.remoteFileSystem!,
			evaluator: dependencies.evaluator!,
			environmentGate: dependencies.environmentGate!,
			providerGuardFactory: dependencies.providerGuardFactory!,
			agentRuntimeFactory: dependencies.agentRuntimeFactory!,
			now: dependencies.now!,
			monotonicNowMicros: dependencies.monotonicNowMicros!,
		};
	}
	const commandRunner: CompilerGymWarmCommandRunner = new SpawnCompilerGymWarmCommandRunner();
	const config = {
		...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
		maxActionCount: COMPILER_GYM_PROXY_CASCADE_PAID_MAX_ACTIONS,
		accountingMode: "required" as const,
		accountingEvidenceVersion: "exact-three-row-v1" as const,
	};
	const remoteFileSystem = new SshCompilerGymWarmRemoteFileSystem(
		commandRunner,
		config.environment.host,
		"/usr/bin/python3",
		2 * 60_000,
	);
	return {
		runtimeMode: "production-defaults-no-dependency-injection",
		remoteFileSystem,
		evaluator: new FarmShareCompilerGymIrDeltaScreenAdapter(config, { commandRunner, remoteFileSystem }),
		environmentGate: (signal) =>
			runCompilerGymPaidLiveEnvironmentGate({
				repoRoot: resolve(input.repoRoot),
				commandRunner,
				environment: config.environment,
				signal,
			}),
		providerGuardFactory: (guardInput) =>
			createCompilerGymProxyCascadePaidProviderGuard({
				spec: guardInput.preregistration.providerSpec,
				preregistrationSha256: guardInput.preregistrationSha256,
				providerRequestAnchorPath: guardInput.preregistration.launchPaths.providerRequestAnchorPath,
				activeAgentDir: guardInput.activeAgentDir,
				expectedRuntimeWorktreeSnapshot: guardInput.preregistration.runtimeWorktreeClosure.snapshot,
				runtimeWorktreeSnapshotProvider: guardInput.runtimeWorktreeSnapshotProvider,
				liveEnvironmentEvidenceProvider: guardInput.liveEnvironmentEvidenceProvider,
			}),
		agentRuntimeFactory: async (_arm, preregistration) => {
			const authStorage = AuthStorage.create();
			const modelRegistry = ModelRegistry.create(authStorage);
			const model = modelRegistry.find(preregistration.frozenCommon.provider, preregistration.frozenCommon.model);
			if (!model) throw new Error("openai-codex/gpt-5.6-luna is not registered");
			if (!modelRegistry.hasConfiguredAuth(model)) {
				throw new Error("OpenAI Codex subscription authentication is not configured for the paid pilot");
			}
			return { authStorage, modelRegistry, model, agentDir: getAgentDir() };
		},
		now: () => new Date(),
		monotonicNowMicros: () => Math.round(performance.now() * 1_000),
	};
}

function rawVerifierInputCount(stdout: string): number {
	const value: unknown = JSON.parse(stdout);
	return isRecord(value) && isRecord(value.validation) && Number.isSafeInteger(value.validation.inputs_completed)
		? Number(value.validation.inputs_completed)
		: 0;
}

function numericMetric(value: number | undefined, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive safe integer`);
	return Number(value);
}

function providerProjection(
	allocation: CompilerGymProxyCascadePaidAllocationEvidence,
	request: StockCpuEvaluationRequest,
) {
	return {
		candidateOrdinal: allocation.candidateOrdinal,
		benchmarkId: allocation.benchmarkId,
		submitted: {
			jobId: allocation.submitted.jobId,
			manifestDigest: allocation.submitted.manifestDigest,
			duplicate: false,
		},
		job: {
			jobId: allocation.job.proposal.jobId,
			manifestDigest: allocation.job.proposal.manifestDigest,
			candidateSha256: sha256Json(request.actions),
			state: allocation.job.state,
			measurement: allocation.job.measurement,
		},
	};
}

async function evaluateOneTask(input: {
	arm: CompilerGymProxyCascadePaidArm;
	candidateOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
	request: StockCpuEvaluationRequest;
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	phase: CompilerGymProxyCascadePaidTaskMeasurement["phase"];
	providerVisibleAtDispatchOrdinal: CompilerGymProxyCascadePaidTaskMeasurement["providerVisibleAtDispatchOrdinal"];
	parentJobIds: readonly string[];
	preregistration: CompilerGymProxyCascadePaidPreregistration;
	evaluator: CompilerGymProxyCascadePaidOneTaskEvaluator;
	artifactStore: ArtifactStore;
	ledger: EvidenceLedger;
	ledgerCoordinator: LedgerAppendCoordinator;
	allocations: CompilerGymProxyCascadePaidAllocationEvidence[];
	failedEvaluations: CompilerGymProxyCascadePaidEvaluationFailureEvidence[];
	uniqueness: AllocationUniqueness;
	concurrency: ConcurrencyTracker;
	monotonicNowMicros: () => number;
	signal: AbortSignal;
}): Promise<CompilerGymProxyCascadePaidAllocationEvidence> {
	input.signal.throwIfAborted();
	if (input.concurrency.active >= COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS.maximumConcurrentEvaluatorTasks) {
		throw new Error("Paid-pilot evaluator concurrency exceeded two");
	}
	input.concurrency.active++;
	input.concurrency.maximum = Math.max(input.concurrency.maximum, input.concurrency.active);
	const startedMonotonicMicros = input.monotonicNowMicros();
	let admitted = false;
	let jobId: string | null = null;
	let manifestDigest: string | null = null;
	let acceptedAt: string | null = null;
	let externalJobId: string | null = null;
	let terminalStatePersisted = false;
	try {
		const candidateContent = JSON.stringify(input.request.actions);
		const candidateArtifact = await input.artifactStore.putString(
			candidateContent,
			"application/vnd.prime.llvm-pass-sequence+json",
		);
		const identity = {
			scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
			arm: input.arm,
			candidateOrdinal: input.candidateOrdinal,
			benchmarkId: input.benchmarkId,
			phase: input.phase,
			candidateArtifact,
		};
		jobId = `pcp-${sha256Json({ ...identity, kind: "job" }).slice(0, 40)}`;
		if (new Set(input.parentJobIds).size !== input.parentJobIds.length || input.parentJobIds.some((id) => !id)) {
			throw new Error("Paid-pilot allocation lineage contains an invalid or duplicate parent job ID");
		}
		manifestDigest = sha256Json({
			...identity,
			jobId,
			parentJobIds: input.parentJobIds,
			requireFreshMeasurement: true,
		});
		if (input.uniqueness.jobIds.has(jobId) || input.uniqueness.manifestDigests.has(manifestDigest)) {
			throw new Error("Paid-pilot duplicate job or manifest identity");
		}
		input.uniqueness.jobIds.add(jobId);
		input.uniqueness.manifestDigests.add(manifestDigest);
		const proposal: ProposalRecord = {
			jobId,
			manifestDigest,
			branchId: sha256Json({ pair: input.preregistration.scientificIdentitySha256, arm: input.arm }),
			lane: "compiler-gym",
			benchmarkIds: [input.benchmarkId],
			budgetClass: "screen",
			treatment: `proxy-cascade-paid:${input.arm}:candidate-${input.candidateOrdinal}`,
			proposal: {
				hypothesis: input.request.hypothesis,
				mechanism: input.request.mechanism,
				predictedOutcome: input.request.predictedOutcome,
				boundaryConditions: [...input.request.boundaryConditions],
				parentJobIds: [...input.parentJobIds],
			},
			candidate: candidateArtifact,
			candidateFormat: "llvm-pass-sequence",
			requireFreshMeasurement: true,
		};
		const job: EvaluationJob = { ...proposal, candidateContent };
		acceptedAt = await input.ledgerCoordinator.appendAdmission(proposal);
		admitted = true;
		const admittedJobId = jobId;
		const admittedAt = acceptedAt;
		const timeoutController = new AbortController();
		let evaluatorTimeoutFired = false;
		const timeout = setTimeout(() => {
			evaluatorTimeoutFired = true;
			timeoutController.abort(new Error("Paid-pilot one-task evaluator exceeded its 420-second hard timeout"));
		}, COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS.evaluatorTaskTimeoutMilliseconds);
		let outcome: EvaluationOutcome;
		try {
			outcome = await input.evaluator.evaluateCanonicalOneTaskSemanticResult(job, {
				signal: AbortSignal.any([input.signal, timeoutController.signal]),
				recordExternalJobId: async (recordedExternalJobId) => {
					if (!/^[1-9][0-9]*$/.test(recordedExternalJobId)) {
						throw new Error("Paid-pilot evaluator reported an invalid external allocation ID");
					}
					if (externalJobId !== null) {
						throw new Error("Paid-pilot evaluator reported more than one external allocation ID");
					}
					if (input.uniqueness.slurmIds.has(recordedExternalJobId)) {
						throw new Error("Paid-pilot reused a Slurm allocation");
					}
					externalJobId = recordedExternalJobId;
					input.uniqueness.slurmIds.add(recordedExternalJobId);
					await input.ledgerCoordinator.appendState({
						jobId: admittedJobId,
						status: "running",
						statusAt: admittedAt,
						externalJobId: recordedExternalJobId,
						reason: null,
					});
				},
			});
		} finally {
			clearTimeout(timeout);
		}
		if (evaluatorTimeoutFired) throw new Error("Paid-pilot one-task evaluator exceeded its 420-second hard timeout");
		if (!outcome.stdout) throw new Error("Paid-pilot evaluator omitted its canonical aggregate");
		const aggregate = parseCompilerGymCanonicalOneTaskSemanticResultAggregate(outcome.stdout);
		const rawTask = aggregate.tasks[0];
		const task = outcome.tasks[0];
		if (
			externalJobId === null ||
			aggregate.jobId !== jobId ||
			aggregate.manifestDigest !== manifestDigest ||
			aggregate.candidateSha256 !== candidateArtifact.digest ||
			aggregate.actionsSha256 !== sha256Json(input.request.actions) ||
			aggregate.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
			aggregate.measurementReuse !== false ||
			aggregate.sourceBundleSha256 !== input.preregistration.frozenCommon.evaluatorSourceBundleSha256 ||
			!rawTask ||
			rawTask.benchmarkId !== input.benchmarkId ||
			rawTask.slurmId !== externalJobId ||
			!task ||
			task.benchmarkId !== input.benchmarkId ||
			rawVerifierInputCount(rawTask.stdout) !== 20 ||
			canonicalJson(toJsonValue(outcome.provenance)) !==
				canonicalJson(toJsonValue(COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE))
		) {
			throw new Error("Paid-pilot one-task evidence failed identity, source, or verifier reconciliation");
		}
		const accepted = rawTask.exitCode === 0;
		if (
			(rawTask.exitCode !== 0 && rawTask.exitCode !== 5) ||
			task.status !== (accepted ? "accepted" : "rejected") ||
			task.verifier.passed !== accepted ||
			(accepted ? task.verifier.errors.length !== 0 : task.verifier.errors.length === 0)
		) {
			throw new Error("Paid-pilot semantic outcome contradicts raw canonical evaluator evidence");
		}
		const slurmId = rawTask.slurmId;
		for (const [set, value, label] of [
			[input.uniqueness.transientCaches, rawTask.transientCache, "transient cache"],
			[input.uniqueness.jobNames, rawTask.jobName, "scheduler job name"],
		] as const) {
			if (set.has(value)) throw new Error(`Paid-pilot reused a ${label}`);
			set.add(value);
		}
		const stdout = await input.artifactStore.putString(outcome.stdout, "application/json");
		const stderrContents = outcome.stderr ?? "";
		const stderr = await input.artifactStore.putString(stderrContents, "text/plain");
		const [candidateReadback, stdoutReadback, stderrReadback] = await Promise.all([
			input.artifactStore.readString(candidateArtifact),
			input.artifactStore.readString(stdout),
			input.artifactStore.readString(stderr),
		]);
		if (
			candidateReadback !== candidateContent ||
			stdoutReadback !== outcome.stdout ||
			stderrReadback !== stderrContents
		) {
			throw new Error("Paid-pilot candidate or measurement artifact readback drifted");
		}
		const measurement: MeasurementRecord = {
			jobId,
			manifestDigest,
			verifierEpoch: outcome.verifierEpoch,
			measuredAt: acceptedAt,
			tasks: structuredClone(outcome.tasks),
			hardware: structuredClone(outcome.hardware),
			provenance: structuredClone(outcome.provenance),
			stdout,
			stderr,
		};
		const state: JobStateRecord = {
			jobId,
			status: accepted ? "succeeded" : "invalid",
			statusAt: acceptedAt,
			externalJobId: slurmId,
			reason: accepted ? null : "complete-semantic-rejection",
		};
		await input.ledgerCoordinator.appendTerminal(measurement, state);
		terminalStatePersisted = true;
		const submitted: SubmitResult = { jobId, manifestDigest, acceptedAt, duplicate: false };
		const taskEvidence: CompilerGymProxyCascadePaidTaskMeasurement = {
			benchmarkId: input.benchmarkId,
			outcome: accepted ? "verified" : "complete-semantic-rejection",
			irInstructionCount: numericMetric(task.metrics.IrInstructionCount, `${input.benchmarkId} IR`),
			objectTextSizeBytes: numericMetric(task.metrics.ObjectTextSizeBytes, `${input.benchmarkId} object text`),
			verifierInputsCompleted: 20,
			measurementState: "fresh-never-reused",
			phase: input.phase,
			providerVisibleAtDispatchOrdinal: input.providerVisibleAtDispatchOrdinal,
			stepCpuSeconds: numericMetric(rawTask.accountingRows.step.cpuTimeRawSeconds, `${input.benchmarkId} step CPU`),
		};
		const feedbackReadyMonotonicMicros = input.monotonicNowMicros();
		if (
			feedbackReadyMonotonicMicros - startedMonotonicMicros >
			COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS.evaluatorTaskTimeoutMilliseconds * 1_000
		) {
			throw new Error("Paid-pilot one-task evaluator exceeded its 420-second hard timeout");
		}
		const allocation: CompilerGymProxyCascadePaidAllocationEvidence = {
			arm: input.arm,
			candidateOrdinal: input.candidateOrdinal,
			benchmarkId: input.benchmarkId,
			phase: input.phase,
			submitted,
			job: { proposal, state, measurement },
			aggregate,
			task: taskEvidence,
			startedMonotonicMicros,
			feedbackReadyMonotonicMicros,
		};
		input.allocations.push(allocation);
		return allocation;
	} catch (error) {
		if (!admitted || jobId === null || manifestDigest === null || acceptedAt === null) throw error;
		try {
			const failure: CompilerGymProxyCascadePaidEvaluationFailureEvidence = {
				jobId,
				manifestDigest,
				arm: input.arm,
				candidateOrdinal: input.candidateOrdinal,
				benchmarkId: input.benchmarkId,
				phase: input.phase,
				externalJobId,
				terminalStateAlreadyPersisted: terminalStatePersisted,
				error: await persistErrorEvidence(error, input.artifactStore),
			};
			input.failedEvaluations.push(failure);
			await input.ledgerCoordinator.appendFailure(
				failure,
				terminalStatePersisted
					? null
					: {
							jobId,
							status: "failed",
							statusAt: acceptedAt,
							externalJobId,
							reason: boundedFailureText(
								`${failure.error.code ?? failure.error.name}: ${failure.error.message}`,
								512,
							),
						},
			);
		} catch (persistenceError) {
			throw new AggregateError(
				[error, persistenceError],
				"Paid-pilot evaluator failed and durable failure recording also failed",
			);
		}
		throw error;
	} finally {
		input.concurrency.active--;
	}
}

function sourcePaths(preregistration: CompilerGymProxyCascadePaidPreregistration) {
	const root = posix.join(
		preregistration.frozenCommon.environment.remoteSourceRoot,
		preregistration.frozenCommon.evaluatorSourceBundleSha256,
	);
	return {
		root,
		canonical: posix.join(root, "compiler_gym_eval.py"),
		irDelta: posix.join(root, "compiler_gym_ir_delta_eval.py"),
	};
}

async function verifyRemoteEvaluatorSources(input: {
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	preregistration: CompilerGymProxyCascadePaidPreregistration;
	signal: AbortSignal;
}): Promise<{ canonicalSha256: string; irDeltaSha256: string }> {
	const paths = sourcePaths(input.preregistration);
	const [canonical, irDelta] = await Promise.all([
		input.remoteFileSystem.readTrustedFile(
			paths.canonical,
			{
				maxBytes: MAX_TRUSTED_BYTES,
				mode: 0o600,
				expectedSha256: input.preregistration.frozenCommon.canonicalEvaluatorSha256,
			},
			input.signal,
		),
		input.remoteFileSystem.readTrustedFile(
			paths.irDelta,
			{
				maxBytes: MAX_TRUSTED_BYTES,
				mode: 0o600,
				expectedSha256: input.preregistration.frozenCommon.irDeltaEvaluatorSha256,
			},
			input.signal,
		),
	]);
	return { canonicalSha256: sha256Text(canonical), irDeltaSha256: sha256Text(irDelta) };
}

function localSealPath(
	preregistration: CompilerGymProxyCascadePaidPreregistration,
	kind: Exclude<LocalSealKind, "attempt" | "global">,
): string {
	if (kind === COMPILER_GYM_PROXY_CASCADE_PAID_CONTROL_ARM || kind === "proxy-cascade") {
		return preregistration.localSeals.armPaths[kind];
	}
	if (kind === "selection") return preregistration.localSeals.selectionPath;
	if (kind === "online-terminal") return preregistration.localSeals.onlineTerminalPath;
	if (kind === "hidden-audit") return preregistration.localSeals.auditPath;
	return preregistration.localSeals.terminalPath;
}

function remoteLockPath(
	preregistration: CompilerGymProxyCascadePaidPreregistration,
	kind: CompilerGymProxyCascadePaidRemoteBoundaryKind,
): string {
	if (kind === "global") return preregistration.remoteLocks.globalPath;
	if (kind === COMPILER_GYM_PROXY_CASCADE_PAID_CONTROL_ARM || kind === "proxy-cascade") {
		return preregistration.remoteLocks.armPaths[kind];
	}
	if (kind === "selection") return preregistration.remoteLocks.selectionPath;
	if (kind === "online-terminal") return preregistration.remoteLocks.onlineTerminalPath;
	if (kind === "hidden-audit") return preregistration.remoteLocks.auditPath;
	return preregistration.remoteLocks.terminalPath;
}

async function runArm(input: {
	arm: CompilerGymProxyCascadePaidArm;
	armOutputDir: string;
	preregistration: CompilerGymProxyCascadePaidPreregistration;
	providerGuard: CompilerGymProxyCascadePaidProviderGuard;
	agentRuntime: CompilerGymProxyCascadePaidAgentRuntime;
	evaluator: CompilerGymProxyCascadePaidOneTaskEvaluator;
	environmentGate: (signal: AbortSignal) => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	setCurrentLiveEnvironmentEvidence: (evidence: CompilerGymPaidLiveEnvironmentGateEvidence | null) => void;
	artifactStore: ArtifactStore;
	ledger: EvidenceLedger;
	ledgerCoordinator: LedgerAppendCoordinator;
	allocations: CompilerGymProxyCascadePaidAllocationEvidence[];
	failedEvaluations: CompilerGymProxyCascadePaidEvaluationFailureEvidence[];
	uniqueness: AllocationUniqueness;
	concurrency: ConcurrencyTracker;
	localSeals: CompilerGymProxyCascadePaidLocalSealEvidence[];
	remoteLocks: CompilerGymProxyCascadePaidRemoteLockEvidence[];
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	monotonicNowMicros: () => number;
	signal: AbortSignal;
}): Promise<CompilerGymProxyCascadePaidArmEvidence> {
	const workspace = resolve(input.armOutputDir, "workspace");
	const sessionDir = resolve(input.armOutputDir, "sessions");
	for (const path of [input.armOutputDir, workspace, sessionDir]) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
	}
	const providerRuntime = input.providerGuard.runtimeForArm(input.arm);
	const providerTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
	};
	const hostTerminalizationTracker = createHostOwnedTerminalizationRuntimeTracker();
	const trace: ArmToolTrace = {
		callCount: 0,
		toolCallAttempts: 0,
		toolExecutions: 0,
		requests: [],
		toolOutputs: [],
		policyFailures: [],
		apparatusFailures: [],
		onlineEvaluatorWaitMicros: 0,
	};
	const candidates: CompilerGymProxyCascadePaidCandidate[] = [];
	const liveEnvironmentGates: CompilerGymPaidLiveEnvironmentGateEvidence[] = [];
	const armDeadlineController = new AbortController();
	const armSignal = AbortSignal.any([input.signal, armDeadlineController.signal]);
	let fatalToolFailure: string | null = null;
	let activeSession: AgentSession | null = null;
	const providerStartMicros: number[] = [];
	const providerEndMicros: number[] = [];
	const guardedProviderGate: StockInterfaceParityProviderRequestGate = async (request) => {
		if (fatalToolFailure) return { allowed: false, reason: fatalToolFailure };
		if (providerTracker.outputTokens >= COMPILER_GYM_PROXY_CASCADE_PAID_OUTPUT_TOKEN_LIMIT) {
			return { allowed: false, reason: "paid-pilot noncached output-token checkpoint reached" };
		}
		providerStartMicros.push(input.monotonicNowMicros());
		const evidence = await input.environmentGate(armSignal);
		liveEnvironmentGates.push(structuredClone(evidence));
		input.setCurrentLiveEnvironmentEvidence(evidence);
		try {
			return await providerRuntime.providerRequestGate(request);
		} finally {
			input.setCurrentLiveEnvironmentEvidence(null);
		}
	};
	const beforeSubmit = createStockInterfaceParityProviderBoundBeforeSubmit(trace, providerTracker);
	const runAllocation = (
		ordinal: CompilerGymProxyCascadePaidCallOrdinal,
		request: StockCpuEvaluationRequest,
		benchmarkId: (typeof STOCK_CPU_TASKS)[number],
		phase: CompilerGymProxyCascadePaidTaskMeasurement["phase"],
		providerVisibleAtDispatchOrdinal: CompilerGymProxyCascadePaidTaskMeasurement["providerVisibleAtDispatchOrdinal"],
		parentJobIds: readonly string[],
	) =>
		evaluateOneTask({
			arm: input.arm,
			candidateOrdinal: ordinal,
			request,
			benchmarkId,
			phase,
			providerVisibleAtDispatchOrdinal,
			parentJobIds,
			preregistration: input.preregistration,
			evaluator: input.evaluator,
			artifactStore: input.artifactStore,
			ledger: input.ledger,
			ledgerCoordinator: input.ledgerCoordinator,
			allocations: input.allocations,
			failedEvaluations: input.failedEvaluations,
			uniqueness: input.uniqueness,
			concurrency: input.concurrency,
			monotonicNowMicros: input.monotonicNowMicros,
			signal: armSignal,
		});
	const tool = defineTool({
		name: COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.name,
		label: "Evaluate CompilerGym Candidate",
		description: COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.description,
		promptSnippet:
			"autoresearch_evaluate: submit one bounded LLVM pass sequence to immutable host-owned verification.",
		promptGuidelines: ["Make exactly four sequential calls and wait for each terminal result."],
		executionMode: "sequential",
		parameters: CompilerGymProxyCascadePaidEvaluationSchema,
		execute: async (_toolCallId, params, signal, _onUpdate, context) => {
			trace.toolCallAttempts++;
			const ordinal = trace.toolCallAttempts as CompilerGymProxyCascadePaidCallOrdinal;
			if (!COMPILER_GYM_PROXY_CASCADE_PAID_CALL_ORDINALS.includes(ordinal)) {
				const failure = "model attempted more than four paid-pilot tool calls";
				trace.policyFailures.push(failure);
				throw new PaidPolicyNonconformanceError(failure);
			}
			signal?.throwIfAborted();
			let request: StockCpuEvaluationRequest;
			try {
				request = assertCompilerGymProxyCascadePaidRequestPolicy({
					request: params,
					callOrdinal: ordinal,
					priorRequests: trace.requests,
					authoritativeActions: input.preregistration.frozenCommon.authoritativeActions,
				});
				await beforeSubmit({
					branchId: context.sessionManager.getSessionId(),
					submissionOrdinal: ordinal,
					request,
					existingJobs: input.allocations
						.filter((allocation) => allocation.arm === input.arm)
						.map((allocation) => allocation.job),
				});
			} catch (error) {
				const failure = errorText(error);
				trace.policyFailures.push(failure);
				fatalToolFailure = failure;
				throw new PaidPolicyNonconformanceError(failure);
			}
			trace.callCount++;
			trace.requests.push(structuredClone(request));
			const started = input.monotonicNowMicros();
			try {
				const priorVisibleParentJobIds = input.allocations
					.filter(
						(allocation) =>
							allocation.arm === input.arm && allocation.task.providerVisibleAtDispatchOrdinal === ordinal,
					)
					.map((allocation) => allocation.job.proposal.jobId);
				const expectedPriorParentCount = ordinal === 1 ? 0 : input.arm === "full-control" ? 2 : 1;
				if (priorVisibleParentJobIds.length !== expectedPriorParentCount) {
					throw new Error("Paid-pilot adaptive call lineage differs from the prior model-visible tool result");
				}
				let visible: CompilerGymProxyCascadePaidAllocationEvidence[];
				let cascadeSelection: unknown = null;
				if (input.arm === COMPILER_GYM_PROXY_CASCADE_PAID_CONTROL_ARM) {
					visible = await settleAllOrThrow(
						[
							runAllocation(
								ordinal,
								request,
								COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
								"online-tool-result",
								ordinal < 4 ? ((ordinal + 1) as 2 | 3 | 4) : null,
								priorVisibleParentJobIds,
							),
							runAllocation(
								ordinal,
								request,
								COMPILER_GYM_PROXY_CASCADE_BZIP2,
								"online-tool-result",
								ordinal < 4 ? ((ordinal + 1) as 2 | 3 | 4) : null,
								priorVisibleParentJobIds,
							),
						],
						"control online one-task evaluator group",
					);
					candidates.push({
						ordinal,
						candidateSha256: sha256Json(request.actions),
						request: structuredClone(request),
						blowfish: visible[0]!.task,
						bzip2: visible[1]!.task,
						selectedForOnlineBzip2: true,
					});
				} else {
					const blowfish = await runAllocation(
						ordinal,
						request,
						COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
						"online-tool-result",
						ordinal < 4 ? ((ordinal + 1) as 2 | 3 | 4) : null,
						priorVisibleParentJobIds,
					);
					visible = [blowfish];
					candidates.push({
						ordinal,
						candidateSha256: sha256Json(request.actions),
						request: structuredClone(request),
						blowfish: blowfish.task,
						bzip2: null,
						selectedForOnlineBzip2: false,
					});
					if (ordinal === 4) {
						const selectedOrdinals = selectCompilerGymProxyCascadePaidBzip2Ordinals(candidates);
						const selectionInputs = candidates.map((candidate) => ({
							candidateOrdinal: candidate.ordinal,
							outcome: candidate.blowfish.outcome,
							irInstructionCount: candidate.blowfish.irInstructionCount,
						}));
						const localSelection = await writeLocalSeal(
							input.preregistration.localSeals.selectionPath,
							"selection",
							{
								protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
								scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
								selectionInputs,
								selectedOrdinals,
							},
						);
						input.localSeals.push(localSelection);
						const remoteSelection = await createRemoteLock({
							remoteFileSystem: input.remoteFileSystem,
							preregistration: input.preregistration,
							kind: "selection",
							path: input.preregistration.remoteLocks.selectionPath,
							claims: {
								protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
								scientificIdentitySha256: input.preregistration.scientificIdentitySha256,
								localSelectionSha256: localSelection.contentsSha256,
								selectionInputs,
								selectedOrdinals,
							},
							ensureRoot: false,
							signal: armSignal,
						});
						input.remoteLocks.push(remoteSelection);
						const selected = candidates.filter((candidate) => selectedOrdinals.includes(candidate.ordinal));
						const selectionParentJobIds = input.allocations
							.filter(
								(allocation) =>
									allocation.arm === "proxy-cascade" &&
									allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH &&
									allocation.phase === "online-tool-result",
							)
							.sort((left, right) => left.candidateOrdinal - right.candidateOrdinal)
							.map((allocation) => allocation.job.proposal.jobId);
						if (selectionParentJobIds.length !== 4) {
							throw new Error(
								"Paid-pilot selected confirmations lack all four blowfish selection-input parents",
							);
						}
						const bzip2 = await settleAllOrThrow(
							selected.map((candidate) =>
								runAllocation(
									candidate.ordinal,
									candidate.request,
									COMPILER_GYM_PROXY_CASCADE_BZIP2,
									"online-agent-inaccessible-selected-confirmation",
									null,
									selectionParentJobIds,
								),
							),
							"selected bzip2 confirmation evaluator group",
						);
						for (const [index, candidate] of selected.entries()) {
							candidate.selectedForOnlineBzip2 = true;
							candidate.bzip2 = bzip2[index]!.task;
						}
						cascadeSelection = {
							inputs: selectionInputs,
							selectedOrdinals,
							localSealSha256: localSelection.contentsSha256,
							remoteLockSha256: remoteSelection.contentsSha256,
						};
					}
				}
				const onlineAllocations = input.allocations.filter(
					(allocation) =>
						allocation.arm === input.arm && allocation.phase !== "post-terminal-agent-inaccessible-hidden-audit",
				).length;
				const envelope = {
					submissionOrdinal: ordinal,
					request,
					evaluations: visible.map((allocation) => providerProjection(allocation, request)),
					cascadeSelection,
					budget: {
						providerCallsUsed: providerTracker.providerCalls,
						providerCallsLimit: 4,
						toolCallsUsed: trace.callCount,
						toolCallsLimit: 4,
						freshOnlineTaskEvaluationsUsed: onlineAllocations,
						freshOnlineTaskEvaluationsPairMaximum: 14,
					},
				};
				trace.toolOutputs.push(structuredClone(envelope));
				trace.toolExecutions++;
				trace.onlineEvaluatorWaitMicros += input.monotonicNowMicros() - started;
				return {
					content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
					details: envelope,
				};
			} catch (error) {
				fatalToolFailure = errorText(error);
				trace.apparatusFailures.push(fatalToolFailure);
				throw error;
			}
		},
	});
	const settingsManager = SettingsManager.inMemory({
		transport: "sse",
		compaction: { enabled: false, agentCallable: false, reserveTokens: 4096, keepRecentTokens: 1 },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: PROVIDER_TIMEOUT_MS } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: input.agentRuntime.agentDir,
		settingsManager,
		extensionFactories: [
			providerRuntime.extensionFactory,
			createStockInterfaceParityProviderBudgetExtension(
				providerTracker,
				hostTerminalizationTracker,
				4,
				true,
				guardedProviderGate,
				() =>
					captureStockInterfaceParityResolvedModelSnapshot({
						authStorage: input.agentRuntime.authStorage,
						modelRegistry: input.agentRuntime.modelRegistry,
						session: activeSession,
						provider: input.preregistration.frozenCommon.provider,
						modelId: input.preregistration.frozenCommon.model,
					}),
				true,
			),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
	});
	await resourceLoader.reload();
	const sessionManager = SessionManager.create(workspace, sessionDir);
	sessionManager.newSession({ id: input.preregistration.providerSpec.providerSessionId });
	sessionManager.flushNow();
	const { session } = await createAgentSession({
		cwd: workspace,
		authStorage: input.agentRuntime.authStorage,
		modelRegistry: input.agentRuntime.modelRegistry,
		model: input.agentRuntime.model,
		thinkingLevel: input.preregistration.frozenCommon.thinkingLevel,
		serviceTier: input.preregistration.frozenCommon.requestedAndLocallyEffectiveServiceTier,
		settingsManager,
		sessionManager,
		resourceLoader,
		tools: [tool.name],
		customTools: [tool],
		includeGoals: false,
		includeCompactSkill: false,
	});
	activeSession = session;
	assert.deepEqual(session.getActiveToolNames(), [COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.name]);
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("Paid-pilot session is not persistent");
	await chmod(sessionFile, 0o600);
	const events: AgentSessionEvent[] = [];
	const messages: AssistantMessage[] = [];
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			messages.push(structuredClone(message));
			providerTracker.outputTokens += message.usage.output;
			if (message.stopReason !== "aborted" && message.stopReason !== "error") {
				providerEndMicros.push(input.monotonicNowMicros());
			}
		}
	});
	const started = input.monotonicNowMicros();
	let promptFailure: string | null = null;
	let watchdog: ReturnType<typeof setTimeout> | null = null;
	let watchdogFired = false;
	try {
		watchdog = setTimeout(() => {
			watchdogFired = true;
			armDeadlineController.abort(new Error("Paid-pilot arm exhausted its 900-second calendar hard limit"));
			session.requestAbort();
		}, COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS.calendarSecondsHard * 1_000);
		await session.promptAndWait(input.preregistration.frozenCommon.prompt);
		await session.waitForRlmQuiescence();
	} catch (error) {
		promptFailure = errorText(error);
	} finally {
		if (watchdog) clearTimeout(watchdog);
		unsubscribe();
		sessionManager.flushNow();
		await session.disposeAsync();
		await input.agentRuntime.dispose?.();
	}
	const totalWallMicros = input.monotonicNowMicros() - started;
	const sessionContents = await readFile(sessionFile, "utf8");
	const persistedMessages = persistedAssistantMessages(sessionContents);
	const paidMessages = messages.filter(
		(message) => message.stopReason !== "aborted" && message.stopReason !== "error",
	);
	const blockedRuntime = messages.filter(isExactBlockedContinuation);
	const blockedPersisted = persistedMessages.filter(isExactBlockedContinuation);
	const apparatusFailures = [...trace.apparatusFailures];
	const policyFailures = [...trace.policyFailures];
	if (watchdogFired || totalWallMicros > COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS.calendarSecondsHard * 1_000_000) {
		apparatusFailures.push("arm exhausted the 900-second calendar hard limit");
	}
	if (
		promptFailure &&
		!(
			blockedRuntime.length === 1 &&
			(hostTerminalizationTracker.terminalizationStops === 1 ||
				trace.policyFailures.length > 0 ||
				trace.apparatusFailures.length > 0)
		)
	) {
		apparatusFailures.push(promptFailure);
	}
	for (const message of messages.filter((candidate) => candidate.stopReason === "error")) {
		apparatusFailures.push(message.errorMessage ?? "paid provider returned an assistant error");
	}
	if (events.some((event) => event.type === "compaction_start" || event.type === "compaction_end")) {
		apparatusFailures.push("compaction occurred in an isolated paid-pilot arm");
	}
	if (providerRuntime.evidence.failures.length > 0) apparatusFailures.push(...providerRuntime.evidence.failures);
	if (providerTracker.apparatusGateFailures?.length) apparatusFailures.push(...providerTracker.apparatusGateFailures);
	if (
		providerTracker.blockedReasons.some(
			(reason) =>
				reason === "output-token-checkpoint" || reason === "provider-call-limit" || reason === "apparatus-gate",
		)
	) {
		apparatusFailures.push("provider dispatch was blocked by an apparatus or budget checkpoint");
	}
	if (
		canonicalJson(toJsonValue(messages.map((message) => message.usage))) !==
		canonicalJson(toJsonValue(persistedMessages.map((message) => message.usage)))
	) {
		apparatusFailures.push("runtime and durable assistant usage diverged");
	}
	const providerWallMicros = providerStartMicros.reduce(
		(total, startMicros, index) => total + Math.max(1, (providerEndMicros[index] ?? startMicros + 1) - startMicros),
		0,
	);
	const activeAgentMicros = Math.max(1, totalWallMicros - trace.onlineEvaluatorWaitMicros);
	const activeAgentCheckpointExceeded =
		activeAgentMicros > COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS.activeAgentSecondsCheckpoint * 1_000_000;
	if (activeAgentCheckpointExceeded) apparatusFailures.push("arm exceeded the 600-second active-agent checkpoint");
	const usage = sumUsage(paidMessages.map((message) => message.usage));
	if (usage.output > COMPILER_GYM_PROXY_CASCADE_PAID_OUTPUT_TOKEN_LIMIT) {
		apparatusFailures.push("arm exceeded the non-cached output-token checkpoint");
	}
	const historyGuardPassed =
		providerRuntime.evidence.failures.length === 0 &&
		(providerRuntime.evidence.historyByDispatch.length === 0 ||
			providerRuntime.evidence.historyByDispatch.every(
				(history, index) =>
					history.providerDispatchOrdinal === index + 1 && history.observedPriorResultCount === index,
			));
	let durableToolOutputsMatch = false;
	if (apparatusFailures.length === 0 && policyFailures.length === 0) {
		if (trace.toolCallAttempts !== 4 || trace.toolExecutions !== 4 || trace.callCount !== 4) {
			policyFailures.push("arm did not complete exactly four one-tool-call responses");
		}
		if (
			paidMessages.length !== 4 ||
			paidMessages.some((message) => message.content.filter((part) => part.type === "toolCall").length !== 1)
		) {
			policyFailures.push("arm assistant-message tool shape drifted");
		}
		try {
			assertCompilerGymProxyCascadePaidRequestSequence(
				trace.requests,
				input.preregistration.frozenCommon.authoritativeActions,
			);
		} catch (error) {
			policyFailures.push(errorText(error));
		}
	}
	if (apparatusFailures.length === 0 && policyFailures.length === 0) {
		try {
			const durableToolOutputs = persistedPaidToolOutputs(sessionContents);
			durableToolOutputsMatch =
				durableToolOutputs.length === 4 &&
				canonicalJson(toJsonValue(durableToolOutputs)) === canonicalJson(toJsonValue(trace.toolOutputs));
			if (!durableToolOutputsMatch) {
				apparatusFailures.push("runtime tool outputs diverged from all four durable session function-call outputs");
			}
		} catch (error) {
			apparatusFailures.push(`durable tool-output reconciliation failed: ${errorText(error)}`);
		}
	}
	if (apparatusFailures.length === 0 && policyFailures.length === 0) {
		if (
			providerTracker.providerCalls !== 4 ||
			providerTracker.blockedProviderCalls !== 0 ||
			providerTracker.blockedReasons.length !== 0 ||
			hostTerminalizationTracker.evaluatorToolCalls !== 4 ||
			hostTerminalizationTracker.terminalizationStops !== 1 ||
			hostTerminalizationTracker.postTerminalEvaluatorToolCalls !== 0 ||
			hostTerminalizationTracker.postTerminalProviderDispatches !== 0 ||
			hostTerminalizationTracker.forbiddenBoundaryEvents.length !== 0 ||
			hostTerminalizationTracker.readOnlyDeviationEvents.length !== 0 ||
			blockedRuntime.length !== 1 ||
			blockedPersisted.length !== 1
		) {
			apparatusFailures.push(
				"arm lacks exact host-owned four-tool terminalization and one zero-use local continuation stop",
			);
		}
		if (liveEnvironmentGates.length !== 4) {
			apparatusFailures.push("arm lacks four immediate pre-provider live environment gates");
		}
		if (!historyGuardPassed) apparatusFailures.push("provider transcript history guard did not pass");
	}
	const observation: CompilerGymProxyCascadePaidArmObservation = {
		arm: input.arm,
		requests: structuredClone(trace.requests),
		candidates: structuredClone(candidates),
		actualProviderDispatches: providerTracker.providerCalls,
		actualToolCalls: trace.toolExecutions,
		successfulToolCallAssistantMessages: paidMessages.length,
		blockedProviderDispatchesAfterTerminal: hostTerminalizationTracker.terminalizationStops,
		abortedContinuationPersisted: blockedPersisted.length === 1,
		abortedContinuationUsageTokens: blockedPersisted.reduce((total, message) => total + message.usage.totalTokens, 0),
		abortedContinuationTransportDispatches: 0,
		liveEnvironmentGatePasses: liveEnvironmentGates.length,
		providerRetries: 0,
		providerReplacements: 0,
		measurementReuseCount: 0,
		duplicateDispatchCount: 0,
		compactionCount: events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end")
			.length,
		rlmChildCount: 0,
		forbiddenToolCallCount: events.filter(
			(event) =>
				event.type === "tool_execution_start" && event.toolName !== COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.name,
		).length,
		terminalToolOutputsPersistedBeforeNextRequest: historyGuardPassed && durableToolOutputsMatch,
		sessionContinuityPassed: session.sessionId === input.preregistration.providerSpec.providerSessionId,
		providerTranscriptHistoryGuardPassed: historyGuardPassed,
		modelAuthSystemToolParityPassed: providerRuntime.evidence.failures.length === 0,
		sessionLedgerArtifactSourceWorktreeIntegrityPassed: apparatusFailures.length === 0,
		outputTokens: usage.output,
		outputTokenCheckpointExceeded: usage.output > COMPILER_GYM_PROXY_CASCADE_PAID_OUTPUT_TOKEN_LIMIT,
		onlineEvaluatorWaitMicros: Math.max(1, trace.onlineEvaluatorWaitMicros),
		providerWallMicros: Math.max(1, providerWallMicros),
		totalWallMicros: Math.max(1, totalWallMicros),
	};
	return {
		arm: input.arm,
		observation,
		candidates,
		toolOutputs: trace.toolOutputs,
		providerTracker,
		providerGuard: structuredClone(providerRuntime.evidence),
		liveEnvironmentGates,
		assistantMessageUsages: messages.map((message) => structuredClone(message.usage)),
		sessionId: session.sessionId,
		sessionFile,
		sessionSha256AtOnlineTerminal: sha256Text(sessionContents),
		sessionSha256AfterHiddenAudits: null,
		eventCounts: eventCounts(events),
		policyFailures: [...new Set(policyFailures)],
		apparatusFailures: [...new Set(apparatusFailures)],
		activeAgentMicros,
		activeAgentCheckpointExceeded,
	};
}

async function writePrivateResult(path: string, result: CompilerGymProxyCascadePaidRunnerResult): Promise<void> {
	const contents = `${canonicalJson(toJsonValue(result))}\n`;
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
	if ((await readPinnedPrivateText(path, sha256Text(contents))) !== contents) {
		throw new Error("Paid-pilot private result readback drifted");
	}
}

export async function runCompilerGymProxyCascadePaidPair(
	input: CompilerGymProxyCascadePaidRunnerInput,
	dependencies: CompilerGymProxyCascadePaidRunnerDependencies = {},
): Promise<CompilerGymProxyCascadePaidRunnerResult> {
	validateDependencyBoundary(dependencies);
	const normalizedInput: CompilerGymProxyCascadePaidRunnerInput = {
		repoRoot: resolve(input.repoRoot),
		preregistrationPath: resolve(input.preregistrationPath),
		outputDir: resolve(input.outputDir),
		signal: input.signal,
	};
	const reconstruct = dependencies.reconstructPreregistration ?? reconstructProductionPreregistration;
	const closure = await reconstruct(normalizedInput);
	const preregistration = closure.preregistration;
	if (
		preregistration.launchPaths.repoRoot !== normalizedInput.repoRoot ||
		preregistration.launchPaths.preregistrationPath !== normalizedInput.preregistrationPath ||
		preregistration.launchPaths.outputDir !== normalizedInput.outputDir
	) {
		throw new Error("Paid-pilot invocation paths differ from preregistration");
	}
	await assertOutputDirectoryAbsent(normalizedInput.outputDir);
	await probeOutputPersistenceBeforeAttempt(normalizedInput.outputDir);
	const runtime = resolveRuntimeDependencies(normalizedInput, dependencies);
	const signal = normalizedInput.signal ?? new AbortController().signal;
	const startedAt = runtime.now().toISOString();
	const localAttemptLock = await writeLocalSeal(preregistration.localAttemptLock.path, "attempt", {
		protocol: preregistration.localAttemptLock.protocol,
		scientificIdentitySha256: preregistration.scientificIdentitySha256,
		preregistrationSha256: closure.preregistrationSha256,
		startedAt,
		consumption: preregistration.localAttemptLock.consumption,
		outputReadinessProbePassed: true,
		postLockPersistenceAtomicityLimit: preregistration.stopPolicy.postLockPersistenceAtomicityLimit,
	});
	await mkdir(normalizedInput.outputDir, { recursive: false, mode: 0o700 });
	await chmod(normalizedInput.outputDir, 0o700);
	const ledgerPath = resolve(normalizedInput.outputDir, "evidence.jsonl");
	const resultPath = resolve(normalizedInput.outputDir, "result.json");
	const ledger = await EvidenceLedger.open(ledgerPath);
	const ledgerCoordinator = createLedgerAppendCoordinator(ledger, runtime.now);
	const artifactStore = new ArtifactStore(resolve(normalizedInput.outputDir, "artifacts"));
	const localSeals: CompilerGymProxyCascadePaidLocalSealEvidence[] = [];
	const remoteLocks: CompilerGymProxyCascadePaidRemoteLockEvidence[] = [];
	const allocations: CompilerGymProxyCascadePaidAllocationEvidence[] = [];
	const failedEvaluations: CompilerGymProxyCascadePaidEvaluationFailureEvidence[] = [];
	const arms: Partial<Record<CompilerGymProxyCascadePaidArm, CompilerGymProxyCascadePaidArmEvidence>> = {};
	const concurrency: ConcurrencyTracker = { active: 0, maximum: 0 };
	const uniqueness: AllocationUniqueness = {
		jobIds: new Set(),
		manifestDigests: new Set(),
		slurmIds: new Set(),
		transientCaches: new Set(),
		jobNames: new Set(),
	};
	let currentLiveEnvironmentEvidence: CompilerGymPaidLiveEnvironmentGateEvidence | null = null;
	let providerGuard: CompilerGymProxyCascadePaidProviderGuard | null = null;
	let globalPreparation: CompilerGymCanonicalOneTaskPreparationEvidence | null = null;
	let assessment: CompilerGymProxyCascadePaidPairAssessment | null = null;
	let failure: string | null = null;
	let terminalClassification: CompilerGymProxyCascadePaidRunnerResult["terminalClassification"] =
		COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid;
	let hiddenAuditsStartedAfterBothOnlineArmsTerminal = false;
	let hiddenAuditEvidenceWasAgentInaccessible = false;
	let globalRemoteLockSucceeded = false;
	try {
		providerGuard = runtime.providerGuardFactory({
			preregistration,
			preregistrationSha256: closure.preregistrationSha256,
			activeAgentDir: preregistration.providerRegistryClosure.agentDir,
			runtimeWorktreeSnapshotProvider: () => capturePrimeRuntimeWorktreeSnapshot(normalizedInput.repoRoot),
			liveEnvironmentEvidenceProvider: () => {
				if (!currentLiveEnvironmentEvidence) {
					throw new Error("Provider guard requested absent pre-provider live evidence");
				}
				return currentLiveEnvironmentEvidence;
			},
		});
		if (providerGuard.specSha256 !== preregistration.providerSpecSha256) {
			throw new Error("Paid-pilot provider guard spec differs from preregistration");
		}
		await ledger.append(
			"run_manifest",
			{
				type: "proxy_cascade_paid_attempt_started",
				preregistrationSha256: closure.preregistrationSha256,
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				armExecutionOrder: preregistration.randomization.armOrder,
			},
			runtime.now().toISOString(),
		);
		const globalLock = await createRemoteLock({
			remoteFileSystem: runtime.remoteFileSystem,
			preregistration,
			kind: "global",
			path: preregistration.remoteLocks.globalPath,
			claims: {
				protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
				preregistrationSha256: closure.preregistrationSha256,
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				armExecutionOrder: preregistration.randomization.armOrder,
			},
			ensureRoot: true,
			signal,
		});
		remoteLocks.push(globalLock);
		globalRemoteLockSucceeded = true;
		globalPreparation = await runtime.evaluator.prepareCanonicalOneTask(signal);
		const paths = sourcePaths(preregistration);
		if (
			globalPreparation.sourceBundleSha256 !== preregistration.frozenCommon.evaluatorSourceBundleSha256 ||
			globalPreparation.sourceDirectory !== paths.root ||
			globalPreparation.canonicalRemoteEvaluatorPath !== paths.canonical ||
			globalPreparation.irDeltaRemoteEvaluatorPath !== paths.irDelta
		) {
			throw new Error("Paid-pilot global evaluator preparation drifted");
		}
		await verifyRemoteEvaluatorSources({ remoteFileSystem: runtime.remoteFileSystem, preregistration, signal });
		for (const arm of preregistration.randomization.armOrder) {
			const agentRuntime = await runtime.agentRuntimeFactory(arm, preregistration);
			if (
				resolve(agentRuntime.agentDir) !== preregistration.providerRegistryClosure.agentDir &&
				runtime.runtimeMode === "production-defaults-no-dependency-injection"
			) {
				throw new Error("Paid-pilot active agent directory differs from preregistration");
			}
			const evidence = await runArm({
				arm,
				armOutputDir:
					arm === COMPILER_GYM_PROXY_CASCADE_PAID_CONTROL_ARM
						? preregistration.launchPaths.controlOutputDir
						: preregistration.launchPaths.treatmentOutputDir,
				preregistration,
				providerGuard,
				agentRuntime,
				evaluator: runtime.evaluator,
				environmentGate: runtime.environmentGate,
				setCurrentLiveEnvironmentEvidence: (evidence) => {
					currentLiveEnvironmentEvidence = evidence;
				},
				artifactStore,
				ledger,
				ledgerCoordinator,
				allocations,
				failedEvaluations,
				uniqueness,
				concurrency,
				localSeals,
				remoteLocks,
				remoteFileSystem: runtime.remoteFileSystem,
				monotonicNowMicros: runtime.monotonicNowMicros,
				signal,
			});
			arms[arm] = evidence;
			if (evidence.apparatusFailures.length > 0) {
				throw new Error(evidence.apparatusFailures.join("; "));
			}
			if (evidence.policyFailures.length > 0) {
				throw new PaidPolicyNonconformanceError(evidence.policyFailures.join("; "));
			}
			const armSeal = await writeLocalSeal(localSealPath(preregistration, arm), arm, {
				protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				arm,
				sessionSha256: evidence.sessionSha256AtOnlineTerminal,
				providerCalls: evidence.observation.actualProviderDispatches,
				toolCalls: evidence.observation.actualToolCalls,
				candidateSha256s: evidence.candidates.map((candidate) => candidate.candidateSha256),
			});
			localSeals.push(armSeal);
			const armLock = await createRemoteLock({
				remoteFileSystem: runtime.remoteFileSystem,
				preregistration,
				kind: arm,
				path: remoteLockPath(preregistration, arm),
				claims: {
					protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
					scientificIdentitySha256: preregistration.scientificIdentitySha256,
					arm,
					localSealSha256: armSeal.contentsSha256,
				},
				ensureRoot: false,
				signal,
			});
			remoteLocks.push(armLock);
		}
		if (
			providerGuard.pairEvidence.failures.length > 0 ||
			new Set(providerGuard.pairEvidence.completedArms).size !== 2 ||
			!COMPILER_GYM_PROXY_CASCADE_PAID_ARMS.every((arm) => providerGuard!.pairEvidence.completedArms.includes(arm))
		) {
			throw new Error("Paid-pilot provider pair reconciliation did not complete both arms cleanly");
		}
		const onlineTerminalSeal = await writeLocalSeal(
			preregistration.localSeals.onlineTerminalPath,
			"online-terminal",
			{
				protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				armSessionSha256s: Object.fromEntries(
					COMPILER_GYM_PROXY_CASCADE_PAID_ARMS.map((arm) => [arm, arms[arm]!.sessionSha256AtOnlineTerminal]),
				),
				onlineAllocationCount: allocations.length,
			},
		);
		localSeals.push(onlineTerminalSeal);
		remoteLocks.push(
			await createRemoteLock({
				remoteFileSystem: runtime.remoteFileSystem,
				preregistration,
				kind: "online-terminal",
				path: preregistration.remoteLocks.onlineTerminalPath,
				claims: {
					protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
					scientificIdentitySha256: preregistration.scientificIdentitySha256,
					localSealSha256: onlineTerminalSeal.contentsSha256,
				},
				ensureRoot: false,
				signal,
			}),
		);
		hiddenAuditsStartedAfterBothOnlineArmsTerminal = true;
		const treatment = arms["proxy-cascade"]!;
		const selected = selectCompilerGymProxyCascadePaidBzip2Ordinals(treatment.candidates);
		const omitted = treatment.candidates.filter(
			(candidate) => candidate.blowfish.outcome === "verified" && !selected.includes(candidate.ordinal),
		);
		const hiddenAuditParentJobIds = allocations
			.filter(
				(allocation) =>
					allocation.arm === "proxy-cascade" &&
					(allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH ||
						(allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BZIP2 &&
							allocation.phase === "online-agent-inaccessible-selected-confirmation")),
			)
			.sort(
				(left, right) =>
					left.candidateOrdinal - right.candidateOrdinal || left.benchmarkId.localeCompare(right.benchmarkId),
			)
			.map((allocation) => allocation.job.proposal.jobId);
		if (hiddenAuditParentJobIds.length !== 4 + selected.length) {
			throw new Error("Paid-pilot hidden-audit lineage lacks four selection inputs and every selected confirmation");
		}
		await mkdir(preregistration.launchPaths.hiddenAuditOutputDir, { recursive: true, mode: 0o700 });
		let hidden: CompilerGymProxyCascadePaidAllocationEvidence[] = [];
		let hiddenFailure: unknown = null;
		try {
			hidden = await settleAllOrThrow(
				omitted.map((candidate) =>
					evaluateOneTask({
						arm: "proxy-cascade",
						candidateOrdinal: candidate.ordinal,
						request: candidate.request,
						benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
						phase: "post-terminal-agent-inaccessible-hidden-audit",
						providerVisibleAtDispatchOrdinal: null,
						parentJobIds: hiddenAuditParentJobIds,
						preregistration,
						evaluator: runtime.evaluator,
						artifactStore,
						ledger,
						ledgerCoordinator,
						allocations,
						failedEvaluations,
						uniqueness,
						concurrency,
						monotonicNowMicros: runtime.monotonicNowMicros,
						signal,
					}),
				),
				"hidden bzip2 audit evaluator group",
			);
		} catch (error) {
			hiddenFailure = error;
		}
		let sessionFailure: unknown = null;
		try {
			for (const arm of COMPILER_GYM_PROXY_CASCADE_PAID_ARMS) {
				const evidence = arms[arm]!;
				const contents = await readFile(evidence.sessionFile, "utf8");
				evidence.sessionSha256AfterHiddenAudits = sha256Text(contents);
				if (evidence.sessionSha256AfterHiddenAudits !== evidence.sessionSha256AtOnlineTerminal) {
					throw new Error("Hidden audit mutated an agent-accessible session");
				}
			}
			hiddenAuditEvidenceWasAgentInaccessible = true;
		} catch (error) {
			sessionFailure = error;
		}
		const hiddenFailures = failedEvaluations
			.filter((failureRecord) => failureRecord.phase === "post-terminal-agent-inaccessible-hidden-audit")
			.sort((left, right) => left.candidateOrdinal - right.candidateOrdinal);
		const hiddenAllocations = allocations.filter(
			(allocation) => allocation.phase === "post-terminal-agent-inaccessible-hidden-audit",
		);
		let auditSealFailure: unknown = null;
		try {
			const auditSeal = await writeLocalSeal(preregistration.localSeals.auditPath, "hidden-audit", {
				protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
				scientificIdentitySha256: preregistration.scientificIdentitySha256,
				outcome: hiddenFailure === null && sessionFailure === null ? "completed" : "apparatus-failure",
				omittedAcceptedOrdinals: omitted.map((candidate) => candidate.ordinal),
				hiddenAuditAttemptCount: omitted.length,
				hiddenAuditAllocationCount: hiddenAllocations.length,
				failedJobIds: hiddenFailures.map((failureRecord) => failureRecord.jobId),
				externalJobIds: [
					...hiddenAllocations.map((allocation) => allocation.aggregate.tasks[0].slurmId),
					...hiddenFailures.flatMap((failureRecord) =>
						failureRecord.externalJobId === null ? [] : [failureRecord.externalJobId],
					),
				].sort(),
				sessionHashesUnchanged: sessionFailure === null,
			});
			localSeals.push(auditSeal);
			remoteLocks.push(
				await createRemoteLock({
					remoteFileSystem: runtime.remoteFileSystem,
					preregistration,
					kind: "hidden-audit",
					path: preregistration.remoteLocks.auditPath,
					claims: {
						protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
						scientificIdentitySha256: preregistration.scientificIdentitySha256,
						localSealSha256: auditSeal.contentsSha256,
					},
					ensureRoot: false,
					signal,
				}),
			);
		} catch (error) {
			auditSealFailure = error;
		}
		const hiddenTerminalFailures: unknown[] = [];
		for (const error of [hiddenFailure, sessionFailure, auditSealFailure]) {
			if (error !== null) hiddenTerminalFailures.push(error);
		}
		if (hiddenTerminalFailures.length === 1) throw hiddenTerminalFailures[0];
		if (hiddenTerminalFailures.length > 1) {
			throw new AggregateError(hiddenTerminalFailures, "Hidden audit and failure-boundary reconciliation failed");
		}
		for (const [index, candidate] of omitted.entries()) candidate.bzip2 = hidden[index]!.task;
		await verifyRemoteEvaluatorSources({ remoteFileSystem: runtime.remoteFileSystem, preregistration, signal });
		for (const allocation of allocations) {
			const measurement = allocation.job.measurement;
			if (!measurement?.stdout || !measurement.stderr) {
				throw new Error("Paid-pilot allocation omitted terminal measurement artifacts");
			}
			const [candidateContents, stdoutContents, stderrContents] = await Promise.all([
				artifactStore.readString(allocation.job.proposal.candidate),
				artifactStore.readString(measurement.stdout),
				artifactStore.readString(measurement.stderr),
			]);
			if (
				sha256Json(JSON.parse(candidateContents) as unknown) !== allocation.aggregate.actionsSha256 ||
				stdoutContents !== `${canonicalJson(toJsonValue(allocation.aggregate))}\n` ||
				stderrContents !== allocation.aggregate.tasks[0].stderr
			) {
				throw new Error("Paid-pilot terminal artifact postflight reconciliation drifted");
			}
		}
		if (
			failedEvaluations.length !== 0 ||
			uniqueness.jobIds.size !== allocations.length ||
			uniqueness.slurmIds.size !== allocations.length
		) {
			throw new Error("Paid-pilot successful postflight has incomplete evaluator-attempt terminalization");
		}
		const postflight = await reconstruct(normalizedInput);
		if (
			postflight.preregistrationSha256 !== closure.preregistrationSha256 ||
			postflight.preregistration.implementationBundleSha256 !== preregistration.implementationBundleSha256 ||
			postflight.preregistration.runtimeWorktreeClosure.snapshotSha256 !==
				preregistration.runtimeWorktreeClosure.snapshotSha256 ||
			postflight.preregistration.providerSpecSha256 !== preregistration.providerSpecSha256
		) {
			throw new Error("Paid-pilot source, worktree, provider, or preregistration closure drifted");
		}
		assessment = evaluateCompilerGymProxyCascadePaidPair({
			control: { ...arms["full-control"]!.observation, candidates: arms["full-control"]!.candidates },
			treatment: { ...arms["proxy-cascade"]!.observation, candidates: arms["proxy-cascade"]!.candidates },
			armExecutionOrder: preregistration.randomization.armOrder,
			armOrderDrawHex: preregistration.randomization.drawHex,
			hiddenAuditsStartedAfterBothOnlineArmsTerminal,
			hiddenAuditEvidenceWasAgentInaccessible,
			authoritativeActions: preregistration.frozenCommon.authoritativeActions,
		});
		terminalClassification = assessment.disposition;
		if (Object.values(arms).some((arm) => arm.policyFailures.length > 0)) {
			terminalClassification = COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.policyNonconformance;
		}
		if (Object.values(arms).some((arm) => arm.apparatusFailures.length > 0)) {
			terminalClassification = COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid;
		}
		await verifyLocalSeals([localAttemptLock, ...localSeals]);
		await verifyRemoteLocks(runtime.remoteFileSystem, remoteLocks, signal);
		const terminalSeal = await writeLocalSeal(preregistration.localSeals.terminalPath, "terminal", {
			protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
			scientificIdentitySha256: preregistration.scientificIdentitySha256,
			preTerminalDisposition: terminalClassification,
			terminalizationIntent: "final-classification-requires-terminal-lock-and-postflight-verification",
			assessmentSha256: sha256Json(assessment),
			allocationCount: allocations.length,
			evaluationAttemptCount: uniqueness.jobIds.size,
			externalAllocationCount: uniqueness.slurmIds.size,
			failedEvaluationCount: failedEvaluations.length,
			maximumObservedEvaluatorConcurrency: concurrency.maximum,
		});
		localSeals.push(terminalSeal);
		remoteLocks.push(
			await createRemoteLock({
				remoteFileSystem: runtime.remoteFileSystem,
				preregistration,
				kind: "terminal",
				path: preregistration.remoteLocks.terminalPath,
				claims: {
					protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
					scientificIdentitySha256: preregistration.scientificIdentitySha256,
					localSealSha256: terminalSeal.contentsSha256,
					preTerminalDisposition: terminalClassification,
					terminalizationIntent: "final-classification-requires-terminal-lock-and-postflight-verification",
				},
				ensureRoot: false,
				signal,
			}),
		);
		await verifyLocalSeals([localAttemptLock, ...localSeals]);
		await verifyRemoteLocks(runtime.remoteFileSystem, remoteLocks, signal);
	} catch (error) {
		failure = errorText(error);
		terminalClassification =
			error instanceof PaidPolicyNonconformanceError
				? COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.policyNonconformance
				: COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid;
		const terminalizationFailures: string[] = [];
		let terminalSeal = localSeals.find((seal) => seal.kind === "terminal") ?? null;
		if (!terminalSeal) {
			try {
				terminalSeal = await writeLocalSeal(preregistration.localSeals.terminalPath, "terminal", {
					protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
					scientificIdentitySha256: preregistration.scientificIdentitySha256,
					preTerminalFailureClassification: terminalClassification,
					terminalizationIntent: "final-classification-requires-terminal-lock-and-postflight-verification",
					failureSha256: sha256Text(failure),
					allocationCount: allocations.length,
					evaluationAttemptCount: uniqueness.jobIds.size,
					externalAllocationCount: uniqueness.slurmIds.size,
					failedEvaluationJobIds: orderedEvaluationFailures(failedEvaluations).map(
						(failureRecord) => failureRecord.jobId,
					),
					maximumObservedEvaluatorConcurrency: concurrency.maximum,
				});
				localSeals.push(terminalSeal);
			} catch (terminalError) {
				terminalizationFailures.push(`local terminal seal failed: ${errorText(terminalError)}`);
			}
		}
		if (globalRemoteLockSucceeded && terminalSeal && !remoteLocks.some((lock) => lock.kind === "terminal")) {
			try {
				remoteLocks.push(
					await createRemoteLock({
						remoteFileSystem: runtime.remoteFileSystem,
						preregistration,
						kind: "terminal",
						path: preregistration.remoteLocks.terminalPath,
						claims: {
							protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
							scientificIdentitySha256: preregistration.scientificIdentitySha256,
							localSealSha256: terminalSeal.contentsSha256,
							preTerminalFailureClassification: terminalClassification,
							terminalizationIntent: "final-classification-requires-terminal-lock-and-postflight-verification",
							failureSha256: sha256Text(failure),
						},
						ensureRoot: false,
						signal: new AbortController().signal,
					}),
				);
			} catch (terminalError) {
				terminalizationFailures.push(`remote terminal lock failed: ${errorText(terminalError)}`);
			}
		}
		if (!globalRemoteLockSucceeded) {
			terminalizationFailures.push(
				"remote terminal lock was not attempted because the create-only global remote lock did not succeed",
			);
		}
		try {
			await verifyLocalSeals([localAttemptLock, ...localSeals]);
			await verifyRemoteLocks(runtime.remoteFileSystem, remoteLocks, new AbortController().signal);
		} catch (terminalError) {
			terminalizationFailures.push(`terminal evidence verification failed: ${errorText(terminalError)}`);
		}
		if (terminalizationFailures.length > 0) {
			terminalClassification = COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid;
			failure = `${failure}\n${terminalizationFailures.join("\n")}`;
		}
	}
	await ledger.append(
		"run_manifest",
		{
			type: "proxy_cascade_paid_terminal",
			terminalClassification,
			failure,
			assessment,
			allocationCount: allocations.length,
			evaluationAttemptCount: uniqueness.jobIds.size,
			externalAllocationCount: uniqueness.slurmIds.size,
			failedEvaluationJobIds: orderedEvaluationFailures(failedEvaluations).map(
				(failureRecord) => failureRecord.jobId,
			),
			maximumObservedEvaluatorConcurrency: concurrency.maximum,
		},
		runtime.now().toISOString(),
	);
	ledger.verify();
	const ledgerContents = await readFile(ledgerPath, "utf8");
	const ledgerEvents = verifyLedgerContentsStrict(ledgerContents);
	const ledgerTerminalHash = ledgerEvents.at(-1)?.hash;
	if (!ledgerTerminalHash) throw new Error("Paid-pilot ledger has no terminal hash");
	const finishedAt = runtime.now().toISOString();
	const apparatusOrPolicyFailures = Object.values(arms).flatMap((arm) => [
		...arm.apparatusFailures,
		...arm.policyFailures,
	]);
	const ok =
		failure === null &&
		apparatusOrPolicyFailures.length === 0 &&
		assessment !== null &&
		terminalClassification !== COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid &&
		terminalClassification !== COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.policyNonconformance;
	const result: CompilerGymProxyCascadePaidRunnerResult = {
		protocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUN_RESULT_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
		runtimeMode: runtime.runtimeMode,
		ok,
		liveScientificEvidenceEligible: ok && runtime.runtimeMode === "production-defaults-no-dependency-injection",
		classification: "one-observed-randomized-order-directional-paid-pair-only",
		terminalClassification,
		failure,
		preregistrationSha256: closure.preregistrationSha256,
		scientificIdentitySha256: preregistration.scientificIdentitySha256,
		armExecutionOrder: preregistration.randomization.armOrder,
		localAttemptLock,
		localSeals,
		remoteLocks,
		globalPreparation,
		arms,
		allocations,
		evaluationAttemptCount: uniqueness.jobIds.size,
		externalAllocationCount: uniqueness.slurmIds.size,
		terminalMeasurementCount: allocations.length,
		failedEvaluations: orderedEvaluationFailures(failedEvaluations),
		assessment,
		providerPair: providerGuard ? structuredClone(providerGuard.pairEvidence) : null,
		maximumObservedEvaluatorConcurrency: concurrency.maximum,
		hiddenAuditsStartedAfterBothOnlineArmsTerminal,
		hiddenAuditEvidenceWasAgentInaccessible,
		ledgerPath,
		ledgerSha256: sha256Text(ledgerContents),
		ledgerTerminalHash,
		startedAt,
		finishedAt,
	};
	await writePrivateResult(resultPath, result);
	return result;
}

function parseCli(argv: readonly string[]): CompilerGymProxyCascadePaidRunnerInput {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || value === undefined || values.has(flag)) {
			throw new Error(
				"Usage: compiler-gym-proxy-cascade-paid-runner --repo-root <path> --preregistration <path> --output-dir <path>",
			);
		}
		values.set(flag, value);
	}
	for (const flag of values.keys()) {
		if (flag !== "--repo-root" && flag !== "--preregistration" && flag !== "--output-dir") {
			throw new Error(`Unknown option: ${flag}`);
		}
	}
	const repoRoot = values.get("--repo-root");
	const preregistrationPath = values.get("--preregistration");
	const outputDir = values.get("--output-dir");
	if (!repoRoot || !preregistrationPath || !outputDir) throw new Error("Paid-pilot runner requires all three paths");
	return { repoRoot, preregistrationPath, outputDir };
}

async function main(): Promise<void> {
	const result = await runCompilerGymProxyCascadePaidPair(parseCli(process.argv.slice(2)));
	process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`);
	if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

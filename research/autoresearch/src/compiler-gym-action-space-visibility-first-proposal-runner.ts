import assert from "node:assert/strict";
import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import { posix, resolve } from "node:path";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
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
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	assertCompilerGymActionSpaceVisibilityLaunchPaths,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_CONVERSATION_LOG,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_WORKSPACE,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL,
	type CompilerGymActionSpaceVisibilityPreregistration,
	canonicalCompilerGymActionSpaceVisibilityPreregistration,
	collectCompilerGymActionSpaceVisibilityImplementationClosure,
	parseCompilerGymActionSpaceVisibilityPreregistration,
} from "./compiler-gym-action-space-visibility-preregistration.js";
import {
	assertCompilerGymActionSpaceVisibilityRequestPolicy,
	assessCompilerGymActionSpaceVisibilityPair,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
	type CompilerGymActionSpaceVisibilityArm,
	type CompilerGymActionSpaceVisibilityCandidate,
	CompilerGymActionSpaceVisibilityEvaluationSchema,
	type CompilerGymActionSpaceVisibilityPairAssessment,
	reconstructCompilerGymActionSpaceVisibilityGuides,
} from "./compiler-gym-action-space-visibility-protocol.js";
import {
	buildCompilerGymActionSpaceVisibilityProviderSpec,
	type CompilerGymActionSpaceVisibilityProviderArmEvidence,
	type CompilerGymActionSpaceVisibilityProviderGuard,
	type CompilerGymActionSpaceVisibilityProviderPairEvidence,
	createCompilerGymActionSpaceVisibilityProviderGuard,
} from "./compiler-gym-action-space-visibility-provider-guard.js";
import { ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree } from "./compiler-gym-ir-delta-qualification-runner.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE,
	DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	FarmShareCompilerGymIrDeltaScreenAdapter,
	parseCompilerGymIrDeltaScreenAggregate,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import {
	type CompilerGymPaidLiveEnvironmentGateEvidence,
	runCompilerGymPaidLiveEnvironmentGate,
} from "./compiler-gym-paid-live-environment-gate.js";
import {
	type CompilerGymWarmCommandRunner,
	type CompilerGymWarmRemoteFileSystem,
	SpawnCompilerGymWarmCommandRunner,
	SshCompilerGymWarmRemoteFileSystem,
} from "./compiler-gym-warm-farmshare-backend.js";
import { ResearchController } from "./controller.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";
import { STOCK_CPU_TASKS, STOCK_CPU_TREATMENT, type StockCpuEvaluationRequest } from "./stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	captureStockInterfaceParityResolvedModelSnapshot,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
	type RepositorySnapshot,
	type StockInterfaceParityProviderRequestGate,
} from "./stock-interface-parity.js";
import type { ArtifactRef, EvaluationAdapter, JobView } from "./types.js";

export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH =
	"compiler-gym-action-space-visibility-shared-s12-v1" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT = "action-guide-visibility-first-proposal-v1" as const;

const PROVIDER_TIMEOUT_MS = 120_000;
const EVALUATOR_TIMEOUT_MS = 8 * 60_000;
const MAX_REMOTE_LOCK_BYTES = 256 * 1024;
const EMPTY_ABORTED_ASSISTANT_CONTENT = [{ type: "text", text: "" }] as const;
const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type ArmDisposition = "admitted" | "policy-nonconformant" | "apparatus-invalid";
type PairDisposition =
	| "directionally-promising-requires-fresh-replication"
	| "directional-loss"
	| "inconclusive"
	| "terminal-apparatus-invalid";

export interface CompilerGymActionSpaceVisibilityRemoteLockEvidence {
	kind: "shared-s12-gate" | "paid-pair-global" | "paid-arm";
	arm: CompilerGymActionSpaceVisibilityArm | null;
	path: string;
	contentsSha256: string;
	contentsArtifact: ArtifactRef;
	readbackSha256: string;
	mode: "0600";
	createOnly: true;
}

export interface CompilerGymActionSpaceVisibilitySharedS12Evidence {
	epoch: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH;
	epochSha256: string;
	passed: boolean;
	providerDispatches: 0;
	duplicate: boolean;
	job: JobView | null;
	rawAggregate: ArtifactRef | null;
	rawStderr: ArtifactRef | null;
	measurementEvidence: CompilerGymActionSpaceVisibilityMeasurementEvidence | null;
	assessment: {
		exactTaskSet: boolean;
		exactMetrics: boolean;
		completeVerifier: boolean;
		freshMeasurement: boolean;
		failures: string[];
	};
}

export interface CompilerGymActionSpaceVisibilityAllocationEvidence {
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	slurmId: string;
	transientCache: string;
	jobName: string;
	requestSha256: string;
}

export interface CompilerGymActionSpaceVisibilityMeasurementEvidence {
	rawAggregate: ArtifactRef;
	rawAggregateStore: "pair-artifact-store";
	rawAggregateSha256: string;
	jobId: string;
	manifestDigest: string;
	candidateSha256: string;
	actionsSha256: string;
	verifierEpoch: string;
	evaluatorSha256: string;
	sourceBundleSha256: string;
	allocations: CompilerGymActionSpaceVisibilityAllocationEvidence[];
}

export interface CompilerGymActionSpaceVisibilityLiveGateRecord {
	phase: "pre-provider" | "postflight";
	arm: CompilerGymActionSpaceVisibilityArm | null;
	providerDispatchOrdinal: number | null;
	outcome: "passed" | "failed";
	evidence: CompilerGymPaidLiveEnvironmentGateEvidence | null;
	failure: string | null;
}

export interface CompilerGymActionSpaceVisibilityArmEvidence {
	arm: CompilerGymActionSpaceVisibilityArm;
	disposition: ArmDisposition;
	policyFailures: string[];
	apparatusFailures: string[];
	providerDispatches: number;
	blockedProviderRequests: number;
	blockedProviderReasons: string[];
	transmittedAssistantResponses: number;
	abortedAssistantResponses: number;
	toolCallAttempts: number;
	toolExecutions: number;
	candidateEvaluations: number;
	freshTaskEvaluations: number;
	duplicateCandidates: number;
	outputTokens: number;
	usage: Usage;
	assistantMessageUsages: Usage[];
	paidAssistantMessageUsages: Usage[];
	blockedContinuation: {
		stopReason: "aborted";
		errorMessage: "Request was aborted";
		content: typeof EMPTY_ABORTED_ASSISTANT_CONTENT;
		usage: Usage;
		providerTransportAuthorized: false;
		runtimeEventMatched: true;
		durableSessionMatched: true;
	} | null;
	outputTokenLimit: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT;
	request: StockCpuEvaluationRequest | null;
	candidate: CompilerGymActionSpaceVisibilityCandidate | null;
	job: JobView | null;
	measurementEvidence: CompilerGymActionSpaceVisibilityMeasurementEvidence | null;
	sessionId: string | null;
	sessionFile: string | null;
	sessionSha256: string | null;
	workspace: string;
	providerGuard: CompilerGymActionSpaceVisibilityProviderArmEvidence | null;
	evaluationLedgerPath: string | null;
	evaluationLedgerSha256: string | null;
	evaluationLedgerTerminalHash: string | null;
	liveEnvironmentGates: CompilerGymActionSpaceVisibilityLiveGateRecord[];
	eventCounts: Record<string, number>;
}

export interface CompilerGymActionSpaceVisibilityPairResult {
	ok: boolean;
	runtimeMode: "production-defaults-no-dependency-injection" | "test-only-injected-runtime";
	liveScientificEvidenceEligible: boolean;
	causalClaimAllowed: false;
	randomizedInferenceAllowed: false;
	tamperEvidentRandomAssignment: false;
	launchArgv: string[];
	runnerProtocol: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL;
	preregistrationPath: string;
	preregistrationSha256: string;
	sampledArmOrder: readonly [CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArm];
	disposition: PairDisposition;
	failure: string | null;
	sharedS12: CompilerGymActionSpaceVisibilitySharedS12Evidence | null;
	remoteLocks: CompilerGymActionSpaceVisibilityRemoteLockEvidence[];
	arms: Partial<Record<CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArmEvidence>>;
	postflight: CompilerGymActionSpaceVisibilityLiveGateRecord | null;
	providerGuard: CompilerGymActionSpaceVisibilityProviderPairEvidence;
	postflightImplementationBundleSha256: string | null;
	postflightRuntimeWorktreeSnapshotSha256: string | null;
	assessment: CompilerGymActionSpaceVisibilityPairAssessment | null;
	providerDispatchesTotal: number;
	candidateEvaluationsTotal: number;
	freshTaskEvaluationsTotal: number;
	ledgerPath: string;
	ledgerSha256: string;
	ledgerTerminalHash: string;
	finishedAt: string;
}

export interface CompilerGymActionSpaceVisibilityRunnerInput {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	signal?: AbortSignal;
}

export interface CompilerGymActionSpaceVisibilityRunnerDependencies {
	testOnlyInjectedRuntime?: true;
	commandRunner?: CompilerGymWarmCommandRunner;
	remoteFileSystem?: CompilerGymWarmRemoteFileSystem;
	adapterFactory?: () => EvaluationAdapter;
	liveEnvironmentGate?: () => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	runArm?: CompilerGymActionSpaceVisibilityArmRunner;
	now?: () => Date;
}

type CompilerGymActionSpaceVisibilityRuntimeMode = CompilerGymActionSpaceVisibilityPairResult["runtimeMode"];

interface CompilerGymActionSpaceVisibilityDependencySnapshot {
	runtimeMode: CompilerGymActionSpaceVisibilityRuntimeMode;
	commandRunner: CompilerGymWarmCommandRunner | undefined;
	remoteFileSystem: CompilerGymWarmRemoteFileSystem | undefined;
	adapterFactory: (() => EvaluationAdapter) | undefined;
	liveEnvironmentGate: (() => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>) | undefined;
	runArm: CompilerGymActionSpaceVisibilityArmRunner | undefined;
	now: (() => Date) | undefined;
}

const VISIBILITY_DEPENDENCY_KEYS = [
	"testOnlyInjectedRuntime",
	"commandRunner",
	"remoteFileSystem",
	"adapterFactory",
	"liveEnvironmentGate",
	"runArm",
	"now",
] as const satisfies readonly (keyof CompilerGymActionSpaceVisibilityRunnerDependencies)[];

const VISIBILITY_REQUIRED_TEST_BOUNDARY_KEYS = [
	"remoteFileSystem",
	"adapterFactory",
	"liveEnvironmentGate",
	"runArm",
] as const satisfies readonly (keyof CompilerGymActionSpaceVisibilityRunnerDependencies)[];

function snapshotVisibilityRunnerDependencies(
	dependencies: CompilerGymActionSpaceVisibilityRunnerDependencies,
): CompilerGymActionSpaceVisibilityDependencySnapshot {
	if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
		throw new Error("Visibility runner dependencies must be a plain own-data object");
	}
	const prototype = Object.getPrototypeOf(dependencies);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error("Visibility runner dependencies must not inherit injected values");
	}
	const allowedKeys = new Set<string>(VISIBILITY_DEPENDENCY_KEYS);
	const ownKeys = Reflect.ownKeys(dependencies);
	const ownStringKeys: string[] = [];
	const snapshottedValues = new Map<string, unknown>();
	for (const key of ownKeys) {
		if (typeof key !== "string") throw new Error("Visibility runner dependencies may not contain symbol keys");
		if (!allowedKeys.has(key)) throw new Error(`Visibility runner dependency key is not allowed: ${key}`);
		const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
		if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
			throw new Error(`Visibility runner dependency must be an enumerable own data property: ${key}`);
		}
		ownStringKeys.push(key);
		snapshottedValues.set(key, descriptor.value);
	}
	const readValue = <K extends keyof CompilerGymActionSpaceVisibilityRunnerDependencies>(
		key: K,
	): CompilerGymActionSpaceVisibilityRunnerDependencies[K] | undefined => {
		return snapshottedValues.get(key) as CompilerGymActionSpaceVisibilityRunnerDependencies[K] | undefined;
	};
	const testOnlyInjectedRuntime = readValue("testOnlyInjectedRuntime");
	const hasTestMarker = ownStringKeys.includes("testOnlyInjectedRuntime");
	const injectedDependencyKeys = ownStringKeys.filter((key) => key !== "testOnlyInjectedRuntime");
	if (hasTestMarker && testOnlyInjectedRuntime !== true) {
		throw new Error("Visibility test-only dependency marker must equal true");
	}
	if (injectedDependencyKeys.length > 0 && testOnlyInjectedRuntime !== true) {
		throw new Error("Visibility dependency injection is restricted to an explicitly marked test-only runtime");
	}
	const commandRunner = readValue("commandRunner");
	const remoteFileSystem = readValue("remoteFileSystem");
	const adapterFactory = readValue("adapterFactory");
	const liveEnvironmentGate = readValue("liveEnvironmentGate");
	const runArm = readValue("runArm");
	const now = readValue("now");
	if (testOnlyInjectedRuntime === true) {
		const missing = VISIBILITY_REQUIRED_TEST_BOUNDARY_KEYS.filter(
			(key) => !ownStringKeys.includes(key) || readValue(key) === undefined,
		);
		if (missing.length > 0) {
			throw new Error(`Visibility test-only runtime lacks complete fake external boundaries: ${missing.join(", ")}`);
		}
	}
	if (commandRunner !== undefined && (typeof commandRunner !== "object" || commandRunner === null)) {
		throw new Error("Visibility injected commandRunner must be an object");
	}
	if (remoteFileSystem !== undefined && (typeof remoteFileSystem !== "object" || remoteFileSystem === null)) {
		throw new Error("Visibility injected remoteFileSystem must be an object");
	}
	for (const [label, value] of [
		["adapterFactory", adapterFactory],
		["liveEnvironmentGate", liveEnvironmentGate],
		["runArm", runArm],
		["now", now],
	] as const) {
		if (value !== undefined && typeof value !== "function") {
			throw new Error(`Visibility injected ${label} must be a function`);
		}
	}
	return Object.freeze({
		runtimeMode:
			testOnlyInjectedRuntime === true
				? "test-only-injected-runtime"
				: "production-defaults-no-dependency-injection",
		commandRunner,
		remoteFileSystem,
		adapterFactory,
		liveEnvironmentGate,
		runArm,
		now,
	});
}

export interface CompilerGymActionSpaceVisibilityArmRunnerInput {
	arm: CompilerGymActionSpaceVisibilityArm;
	armOutputDir: string;
	preregistration: CompilerGymActionSpaceVisibilityPreregistration;
	preregistrationSha256: string;
	providerGuard: CompilerGymActionSpaceVisibilityProviderGuard;
	pairArtifactStore: ArtifactStore;
	allowedFlags: string[];
	adapter: EvaluationAdapter;
	ledger: EvidenceLedger;
	liveEnvironmentGate: () => Promise<CompilerGymPaidLiveEnvironmentGateEvidence>;
	aggregateProviderDispatches: () => number;
	recordProviderDispatch: () => void;
	signal: AbortSignal;
}

export type CompilerGymActionSpaceVisibilityArmRunner = (
	input: CompilerGymActionSpaceVisibilityArmRunnerInput,
) => Promise<CompilerGymActionSpaceVisibilityArmEvidence>;

class VisibilityPolicyNonconformanceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VisibilityPolicyNonconformanceError";
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	);
}

function eventCounts(events: readonly AgentSessionEvent[]): Record<string, number> {
	return Object.fromEntries(
		[...new Set(events.map((event) => event.type))]
			.sort()
			.map((type) => [type, events.filter((event) => event.type === type).length]),
	);
}

async function waitForController(controller: ResearchController, timeoutMs = EVALUATOR_TIMEOUT_MS): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			controller.waitForIdle(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Visibility evaluator wait exceeded ${timeoutMs}ms`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function openVisibilityController(outputDir: string, adapter: EvaluationAdapter): Promise<ResearchController> {
	if (adapter.lane !== "compiler-gym") throw new Error("Visibility runner requires a CompilerGym adapter");
	return ResearchController.open({
		ledgerPath: resolve(outputDir, "evidence.jsonl"),
		artifactDir: resolve(outputDir, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: { "compiler-gym": STOCK_CPU_TASKS, kernelbench: [], nanogpt: [] },
		allowedTreatments: [COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT, STOCK_CPU_TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: 1,
		maxTaskEvaluationsPerBranch: 2,
	});
}

function defaultAdapterFactory(): EvaluationAdapter {
	return new FarmShareCompilerGymIrDeltaScreenAdapter({
		...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
		maxActionCount: COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS,
		accountingMode: "required",
		accountingEvidenceVersion: "exact-three-row-v1",
	});
}

async function storeOptional(
	store: ArtifactStore,
	contents: string | null,
	mediaType: string,
): Promise<ArtifactRef | null> {
	return contents === null ? null : store.putString(contents, mediaType);
}

function assessS12Job(job: JobView | null): CompilerGymActionSpaceVisibilitySharedS12Evidence["assessment"] {
	const failures: string[] = [];
	const tasks = job?.measurement?.tasks ?? [];
	const exactTaskSet =
		tasks.length === STOCK_CPU_TASKS.length &&
		STOCK_CPU_TASKS.every((benchmarkId, index) => tasks[index]?.benchmarkId === benchmarkId);
	if (!exactTaskSet) failures.push("shared S12 task set drifted");
	const exactMetrics =
		exactTaskSet &&
		tasks.every((task) => {
			const expected =
				COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[task.benchmarkId as (typeof STOCK_CPU_TASKS)[number]];
			return (
				expected !== undefined &&
				task.metrics.IrInstructionCount === expected.irInstructionCount &&
				task.metrics.ObjectTextSizeBytes === expected.objectTextSizeBytes
			);
		});
	if (!exactMetrics) failures.push("shared S12 terminal metrics drifted");
	const completeVerifier =
		exactTaskSet && tasks.every((task) => task.status === "accepted" && task.verifier.passed === true);
	if (!completeVerifier) failures.push("shared S12 verifier did not accept both tasks");
	const freshMeasurement =
		job?.proposal.requireFreshMeasurement === true && job.measurement !== null && job.measurement.reuse === undefined;
	if (!freshMeasurement) failures.push("shared S12 measurement was absent or reused");
	return { exactTaskSet, exactMetrics, completeVerifier, freshMeasurement, failures };
}

function assertExactVisibilityAccounting(aggregate: ReturnType<typeof parseCompilerGymIrDeltaScreenAggregate>): void {
	if (
		aggregate.tasks.some(
			(task) =>
				task.accountingRows?.contract !== COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL ||
				task.accountingRows.interpretation !== COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION ||
				task.accountingRows.step.allocCpus !== 2 ||
				task.accountingRows.step.nTasks !== 1,
		)
	) {
		throw new Error("visibility measurement lacks exact root/extern/.0 accounting evidence");
	}
}

function validateAggregateAgainstJob(input: {
	job: JobView;
	request: StockCpuEvaluationRequest;
	aggregateContents: string;
	rawAggregate: ArtifactRef;
}): CompilerGymActionSpaceVisibilityMeasurementEvidence {
	const { job, request, aggregateContents, rawAggregate } = input;
	const measurement = job.measurement;
	if (!measurement) throw new Error("visibility job lacks a measurement");
	if (job.state.status !== "succeeded") throw new Error("visibility job did not reach succeeded state");
	if (!measurement.stdout) throw new Error("visibility measurement lacks raw aggregate evidence");
	if (
		measurement.stdout.digest !== sha256Text(aggregateContents) ||
		rawAggregate.digest !== measurement.stdout.digest
	) {
		throw new Error("visibility raw aggregate artifact digest does not bind to the measurement");
	}
	const aggregate = parseCompilerGymIrDeltaScreenAggregate(aggregateContents);
	assertExactVisibilityAccounting(aggregate);
	if (
		aggregate.jobId !== job.proposal.jobId ||
		aggregate.manifestDigest !== job.proposal.manifestDigest ||
		aggregate.candidateSha256 !== job.proposal.candidate.digest ||
		aggregate.actionsSha256 !== sha256Json(request.actions)
	) {
		throw new Error("visibility aggregate does not bind to the controller job, candidate, and actions");
	}
	if (
		job.proposal.requireFreshMeasurement !== true ||
		measurement.reuse !== undefined ||
		aggregate.measurementReuse !== false
	) {
		throw new Error("visibility measurement is not fresh and non-reused");
	}
	if (measurement.verifierEpoch !== aggregate.verifierEpoch) {
		throw new Error("visibility aggregate verifier epoch differs from the controller measurement");
	}
	if (
		canonicalJson(toJsonValue(measurement.provenance)) !==
		canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE))
	) {
		throw new Error("visibility measurement provenance differs from the frozen adapter provenance");
	}
	if (
		job.proposal.benchmarkIds.length !== STOCK_CPU_TASKS.length ||
		measurement.tasks.length !== STOCK_CPU_TASKS.length ||
		aggregate.tasks.length !== STOCK_CPU_TASKS.length ||
		STOCK_CPU_TASKS.some(
			(benchmarkId, index) =>
				job.proposal.benchmarkIds[index] !== benchmarkId ||
				measurement.tasks[index]?.benchmarkId !== benchmarkId ||
				aggregate.tasks[index]?.benchmarkId !== benchmarkId,
		)
	) {
		throw new Error("visibility aggregate and measurement differ from the exact ordered task set");
	}
	const allocations = aggregate.tasks.map((task, index) => {
		const expectedRequest = `${canonicalJson(toJsonValue({ benchmark: task.benchmarkId, actions: request.actions }))}\n`;
		if (task.requestSha256 !== sha256Text(expectedRequest)) {
			throw new Error(`visibility task request hash drifted for ${task.benchmarkId}`);
		}
		const measuredTask = measurement.tasks[index];
		const expectedAccepted = task.exitCode === 0;
		if (
			(task.exitCode !== 0 && task.exitCode !== 5) ||
			!measuredTask ||
			measuredTask.status !== (expectedAccepted ? "accepted" : "rejected") ||
			measuredTask.verifier.passed !== expectedAccepted ||
			rawVerifierInputCount(task.stdout) !== 20
		) {
			throw new Error(`visibility task outcome is incomplete or contradicts raw evidence for ${task.benchmarkId}`);
		}
		return {
			benchmarkId: task.benchmarkId,
			slurmId: task.slurmId,
			transientCache: task.transientCache,
			jobName: task.jobName,
			requestSha256: task.requestSha256,
		};
	});
	for (const [label, values] of [
		["Slurm allocation", allocations.map((allocation) => allocation.slurmId)],
		["transient cache", allocations.map((allocation) => allocation.transientCache)],
		["scheduler job name", allocations.map((allocation) => allocation.jobName)],
	] as const) {
		if (new Set(values).size !== allocations.length)
			throw new Error(`visibility ${label} was reused within a candidate`);
	}
	return {
		rawAggregate: structuredClone(rawAggregate),
		rawAggregateStore: "pair-artifact-store",
		rawAggregateSha256: sha256Text(aggregateContents),
		jobId: aggregate.jobId,
		manifestDigest: aggregate.manifestDigest,
		candidateSha256: aggregate.candidateSha256,
		actionsSha256: aggregate.actionsSha256,
		verifierEpoch: aggregate.verifierEpoch,
		evaluatorSha256: aggregate.evaluatorSha256,
		sourceBundleSha256: aggregate.sourceBundleSha256,
		allocations,
	};
}

export async function runCompilerGymActionSpaceVisibilitySharedS12Gate(input: {
	outputDir: string;
	adapter: EvaluationAdapter;
	pairArtifactStore: ArtifactStore;
}): Promise<CompilerGymActionSpaceVisibilitySharedS12Evidence> {
	const controller = await openVisibilityController(input.outputDir, input.adapter);
	const branchId = `${COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH}-branch`;
	const submitted = await controller.submit({
		branchId,
		lane: "compiler-gym",
		benchmarkIds: [...STOCK_CPU_TASKS],
		budgetClass: "smoke",
		treatment: STOCK_CPU_TREATMENT,
		proposal: {
			hypothesis: COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.hypothesis,
			mechanism: COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.mechanism,
			predictedOutcome: COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.predictedOutcome,
			boundaryConditions: [...COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.boundaryConditions],
			parentJobIds: [],
		},
		candidate: {
			format: "llvm-pass-sequence",
			content: JSON.stringify(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.actions),
		},
		requireFreshMeasurement: true,
	});
	await waitForController(controller);
	controller.verifyLedger();
	const jobs = controller.statusForBranch(branchId, [submitted.jobId]);
	const job = jobs.length === 1 ? jobs[0] : null;
	const controllerArtifacts = new ArtifactStore(resolve(input.outputDir, "artifacts"));
	const rawAggregateContents = job?.measurement?.stdout
		? await controllerArtifacts.readString(job.measurement.stdout)
		: null;
	const rawStderrContents = job?.measurement?.stderr
		? await controllerArtifacts.readString(job.measurement.stderr)
		: null;
	const assessment = assessS12Job(job);
	const rawAggregate = await storeOptional(input.pairArtifactStore, rawAggregateContents, "application/json");
	const rawStderr = await storeOptional(input.pairArtifactStore, rawStderrContents, "text/plain");
	let measurementEvidence: CompilerGymActionSpaceVisibilityMeasurementEvidence | null = null;
	if (!job || rawAggregateContents === null || rawAggregate === null) {
		assessment.failures.push("shared S12 lacks a raw aggregate artifact");
	} else {
		try {
			measurementEvidence = validateAggregateAgainstJob({
				job,
				request: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
				aggregateContents: rawAggregateContents,
				rawAggregate,
			});
		} catch (error) {
			assessment.failures.push(`shared S12 raw evidence is invalid: ${errorText(error)}`);
		}
	}
	const epochSha256 = sha256Json({
		epoch: COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH,
		request: COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
		expectedMetrics: COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
		measurementEvidence,
		rawAggregate,
		rawStderr,
		jobVerifierEpoch: job?.measurement?.verifierEpoch ?? null,
		jobProvenance: job?.measurement?.provenance ?? null,
	});
	return {
		epoch: COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH,
		epochSha256,
		passed: !submitted.duplicate && job?.state.status === "succeeded" && assessment.failures.length === 0,
		providerDispatches: 0,
		duplicate: submitted.duplicate,
		job: job ? structuredClone(job) : null,
		rawAggregate,
		rawStderr,
		measurementEvidence,
		assessment,
	};
}

async function createRemoteLock(input: {
	remoteFileSystem: CompilerGymWarmRemoteFileSystem;
	artifactStore: ArtifactStore;
	parentRoot: string;
	root: string;
	path: string;
	kind: CompilerGymActionSpaceVisibilityRemoteLockEvidence["kind"];
	arm: CompilerGymActionSpaceVisibilityArm | null;
	claims: unknown;
	signal: AbortSignal;
}): Promise<CompilerGymActionSpaceVisibilityRemoteLockEvidence> {
	if (posix.dirname(input.root) !== input.parentRoot || posix.dirname(input.path) !== input.root) {
		throw new Error("Remote visibility lock path differs from its frozen parent and identity roots");
	}
	await ensureCompilerGymIrDeltaQualificationPrivateDirectoryTree(input.remoteFileSystem, input.root, input.signal);
	const contents = `${canonicalJson(toJsonValue(input.claims))}\n`;
	const contentsSha256 = sha256Text(contents);
	await input.remoteFileSystem.installImmutableFile(input.path, contents, contentsSha256, 0o600, false, input.signal);
	const readback = await input.remoteFileSystem.readTrustedFile(
		input.path,
		{ maxBytes: MAX_REMOTE_LOCK_BYTES, mode: 0o600, expectedSha256: contentsSha256 },
		input.signal,
	);
	if (readback !== contents) throw new Error(`Remote visibility lock readback drifted: ${input.path}`);
	return {
		kind: input.kind,
		arm: input.arm,
		path: input.path,
		contentsSha256,
		contentsArtifact: await input.artifactStore.putString(contents, "application/json"),
		readbackSha256: sha256Text(readback),
		mode: "0600",
		createOnly: true,
	};
}

export interface CompilerGymActionSpaceVisibilityOneCallToolTrace {
	toolCallAttempts: number;
	toolExecutions: number;
	duplicateCandidates: number;
	request: StockCpuEvaluationRequest | null;
	job: JobView | null;
	toolFailureKind: "policy" | "apparatus" | null;
	toolFailure: string | null;
}

export function createCompilerGymActionSpaceVisibilityOneCallTool(input: {
	controller: ResearchController;
	allowedFlags: string[];
	trace: CompilerGymActionSpaceVisibilityOneCallToolTrace;
}) {
	return defineTool({
		name: COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL.name,
		label: "Evaluate CompilerGym Candidate",
		description: COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL.description,
		promptSnippet:
			"autoresearch_evaluate: synchronously evaluate one mechanistic LLVM pass-sequence candidate on both fixed tasks.",
		promptGuidelines: ["Make exactly one call; the host closes the arm after its terminal result."],
		executionMode: "sequential",
		parameters: CompilerGymActionSpaceVisibilityEvaluationSchema,
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			input.trace.toolCallAttempts++;
			if (input.trace.toolCallAttempts !== 1) {
				input.trace.toolFailureKind = "policy";
				input.trace.toolFailure = "model attempted more than one tool call in its sole response";
				throw new VisibilityPolicyNonconformanceError(input.trace.toolFailure);
			}
			signal?.throwIfAborted();
			let request: StockCpuEvaluationRequest;
			try {
				request = assertCompilerGymActionSpaceVisibilityRequestPolicy(params, input.allowedFlags);
			} catch (error) {
				input.trace.toolFailureKind = "policy";
				input.trace.toolFailure = errorText(error);
				throw new VisibilityPolicyNonconformanceError(input.trace.toolFailure);
			}
			input.trace.request = structuredClone(request);
			try {
				const submitted = await input.controller.submit({
					branchId: ctx.sessionManager.getSessionId(),
					lane: "compiler-gym",
					benchmarkIds: [...STOCK_CPU_TASKS],
					budgetClass: "screen",
					treatment: COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT,
					proposal: {
						hypothesis: request.hypothesis,
						mechanism: request.mechanism,
						predictedOutcome: request.predictedOutcome,
						boundaryConditions: [...request.boundaryConditions],
						parentJobIds: [],
					},
					candidate: { format: "llvm-pass-sequence", content: JSON.stringify(request.actions) },
					requireFreshMeasurement: true,
				});
				if (submitted.duplicate) {
					input.trace.duplicateCandidates++;
					throw new Error(`duplicate visibility candidate dispatch: ${submitted.jobId}`);
				}
				await waitForController(input.controller);
				input.controller.verifyLedger();
				const jobs = input.controller.statusForBranch(ctx.sessionManager.getSessionId(), [submitted.jobId]);
				if (jobs.length !== 1) throw new Error("visibility candidate job is missing");
				input.trace.job = structuredClone(jobs[0]);
				input.trace.toolExecutions++;
				return {
					content: [{ type: "text" as const, text: JSON.stringify({ request, submitted, job: jobs[0] }) }],
					details: { request, submitted, job: jobs[0] },
				};
			} catch (error) {
				if (error instanceof VisibilityPolicyNonconformanceError) throw error;
				input.trace.toolFailureKind = "apparatus";
				input.trace.toolFailure = errorText(error);
				throw error;
			}
		},
	});
}

function rawVerifierInputCount(taskStdout: string): number {
	const value: unknown = JSON.parse(taskStdout);
	if (!isRecord(value) || !isRecord(value.validation)) return 0;
	const count = value.validation.inputs_completed;
	return Number.isSafeInteger(count) && Number(count) >= 0 ? Number(count) : 0;
}

async function candidateFromJob(
	job: JobView,
	request: StockCpuEvaluationRequest,
	evaluationRoot: string,
	pairArtifactStore: ArtifactStore,
): Promise<{
	candidate: CompilerGymActionSpaceVisibilityCandidate;
	measurementEvidence: CompilerGymActionSpaceVisibilityMeasurementEvidence;
}> {
	const measurement = job.measurement;
	if (!measurement?.stdout) throw new Error("visibility measurement lacks raw aggregate evidence");
	const aggregateContents = await new ArtifactStore(resolve(evaluationRoot, "artifacts")).readString(
		measurement.stdout,
	);
	const pairRawAggregate = await pairArtifactStore.putString(aggregateContents, "application/json");
	const aggregate = parseCompilerGymIrDeltaScreenAggregate(aggregateContents);
	const measurementEvidence = validateAggregateAgainstJob({
		job,
		request,
		aggregateContents,
		rawAggregate: pairRawAggregate,
	});
	const rawCounts = Object.fromEntries(
		aggregate.tasks.map((task) => [task.benchmarkId, rawVerifierInputCount(task.stdout)]),
	);
	if (job.state.status !== "succeeded") throw new Error("visibility candidate job did not succeed");
	for (const [index, rawTask] of aggregate.tasks.entries()) {
		const measuredTask = measurement.tasks[index];
		if (!measuredTask || (rawTask.exitCode !== 0 && rawTask.exitCode !== 5)) {
			throw new Error("visibility candidate has an unsupported task outcome");
		}
		const expectedAccepted = rawTask.exitCode === 0;
		if (
			measuredTask.status !== (expectedAccepted ? "accepted" : "rejected") ||
			measuredTask.verifier.passed !== expectedAccepted
		) {
			throw new Error(`visibility task outcome contradicts raw evaluator exit code for ${rawTask.benchmarkId}`);
		}
		if (rawCounts[rawTask.benchmarkId] !== 20) {
			throw new Error(`visibility task did not complete exactly 20 verifier inputs for ${rawTask.benchmarkId}`);
		}
	}
	const blowfish = measurement.tasks.find((task) => task.benchmarkId === STOCK_CPU_TASKS[0]);
	const bzip2 = measurement.tasks.find((task) => task.benchmarkId === STOCK_CPU_TASKS[1]);
	if (!blowfish || !bzip2) throw new Error("visibility measurement omitted a fixed task");
	const verified =
		blowfish.status === "accepted" &&
		blowfish.verifier.passed &&
		bzip2.status === "accepted" &&
		bzip2.verifier.passed;
	if (!verified && (blowfish.status === "failed" || bzip2.status === "failed")) {
		throw new Error("visibility evaluator failed instead of returning a complete semantic outcome");
	}
	const numeric = (value: number | undefined, label: string): number => {
		if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is not a positive integer`);
		return Number(value);
	};
	return {
		candidate: {
			actions: [...request.actions],
			outcome: verified ? "verified" : "complete-semantic-rejection",
			blowfishIr: verified ? numeric(blowfish.metrics.IrInstructionCount, "blowfish IR") : null,
			bzip2Ir: verified ? numeric(bzip2.metrics.IrInstructionCount, "bzip2 IR") : null,
			verifierInputsCompleted: {
				blowfish: rawCounts[STOCK_CPU_TASKS[0]] ?? 0,
				bzip2: rawCounts[STOCK_CPU_TASKS[1]] ?? 0,
			},
		},
		measurementEvidence,
	};
}

function policyFailuresFromEvents(input: {
	events: readonly AgentSessionEvent[];
	assistantMessages: readonly AssistantMessage[];
	trace: CompilerGymActionSpaceVisibilityOneCallToolTrace;
}): string[] {
	const failures: string[] = [];
	const successfulMessages = input.assistantMessages.filter(
		(message) => message.stopReason !== "aborted" && message.stopReason !== "error",
	);
	const toolStarts = input.events.filter((event) => event.type === "tool_execution_start");
	if (successfulMessages.length === 1) {
		const [message] = successfulMessages;
		const toolCalls = message?.content.filter((block) => block.type === "toolCall") ?? [];
		if (message?.stopReason !== "toolUse") {
			failures.push(`model response stop reason was ${message?.stopReason ?? "absent"}, not toolUse`);
		}
		if (toolCalls.length !== 1 || toolCalls[0]?.name !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL.name) {
			failures.push("model response did not contain exactly one evaluator tool-call block");
		}
		if (toolStarts.length === 0) failures.push("model response contained no tool call");
		if (toolStarts.length > 1 || input.trace.toolCallAttempts > 1) {
			failures.push("model response contained multiple tool calls");
		}
		if (toolStarts.some((event) => event.toolName !== COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL.name)) {
			failures.push("model response requested a non-evaluator tool");
		}
		if (toolStarts.length === 1 && input.trace.toolCallAttempts === 0) {
			failures.push("model tool arguments failed schema admission before host execution");
		}
	}
	if (input.trace.toolFailureKind === "policy" && input.trace.toolFailure) failures.push(input.trace.toolFailure);
	return [...new Set(failures)];
}

function persistedAssistantMessages(sessionContents: string): AssistantMessage[] {
	if (!sessionContents.endsWith("\n")) throw new Error("visibility session JSONL is not newline terminated");
	return sessionContents
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown)
		.flatMap((entry) => {
			if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return [];
			const message = entry.message;
			return message.role === "assistant" && isRecord(message.usage)
				? [structuredClone(message) as unknown as AssistantMessage]
				: [];
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

export const runCompilerGymActionSpaceVisibilityPrimeArm: CompilerGymActionSpaceVisibilityArmRunner = async (input) => {
	const workspace = resolve(input.armOutputDir, "workspace");
	const sessionDir = resolve(input.armOutputDir, "sessions");
	const evaluationRoot = resolve(input.armOutputDir, "evaluation");
	for (const path of [input.armOutputDir, workspace, sessionDir, evaluationRoot]) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
	}
	const controller = await openVisibilityController(evaluationRoot, input.adapter);
	const providerRuntime = input.providerGuard.runtimeForArm(input.arm);
	const providerTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
		apparatusGateFailures: [],
	};
	const liveEnvironmentGates: CompilerGymActionSpaceVisibilityLiveGateRecord[] = [];
	const guardedProviderGate: StockInterfaceParityProviderRequestGate = async (request) => {
		if (input.aggregateProviderDispatches() >= 2) {
			return { allowed: false, reason: "visibility pair provider-dispatch cap reached" };
		}
		let environmentEvidence: CompilerGymPaidLiveEnvironmentGateEvidence;
		try {
			environmentEvidence = await input.liveEnvironmentGate();
			const record: CompilerGymActionSpaceVisibilityLiveGateRecord = {
				phase: "pre-provider",
				arm: input.arm,
				providerDispatchOrdinal: request.providerDispatchOrdinal,
				outcome: "passed",
				evidence: environmentEvidence,
				failure: null,
			};
			liveEnvironmentGates.push(record);
			await input.ledger.append("run_manifest", { type: "visibility_live_environment_gate", ...record });
		} catch (error) {
			const record: CompilerGymActionSpaceVisibilityLiveGateRecord = {
				phase: "pre-provider",
				arm: input.arm,
				providerDispatchOrdinal: request.providerDispatchOrdinal,
				outcome: "failed",
				evidence: null,
				failure: errorText(error),
			};
			liveEnvironmentGates.push(record);
			await input.ledger.append("run_manifest", { type: "visibility_live_environment_gate", ...record });
			throw error;
		}
		const guarded = await providerRuntime.providerRequestGate(request);
		if (guarded.allowed) input.recordProviderDispatch();
		return guarded;
	};

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find(FROZEN_CAMPAIGN.model.provider, FROZEN_CAMPAIGN.model.id);
	if (!model) throw new Error("openai-codex/gpt-5.6-luna is not registered");
	if (!modelRegistry.hasConfiguredAuth(model)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for visibility screen");
	}
	let activeSession: AgentSession | null = null;
	const settingsManager = SettingsManager.inMemory({
		transport: "sse",
		compaction: { enabled: false, agentCallable: false, reserveTokens: 4096, keepRecentTokens: 1 },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: PROVIDER_TIMEOUT_MS } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [
			providerRuntime.extensionFactory,
			createStockInterfaceParityProviderBudgetExtension(providerTracker, null, 1, false, guardedProviderGate, () =>
				captureStockInterfaceParityResolvedModelSnapshot({
					authStorage,
					modelRegistry,
					session: activeSession,
					provider: FROZEN_CAMPAIGN.model.provider,
					modelId: FROZEN_CAMPAIGN.model.id,
				}),
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
	sessionManager.newSession({ id: input.providerGuard.spec.providerSessionId });
	sessionManager.flushNow();
	const trace: CompilerGymActionSpaceVisibilityOneCallToolTrace = {
		toolCallAttempts: 0,
		toolExecutions: 0,
		duplicateCandidates: 0,
		request: null,
		job: null,
		toolFailureKind: null,
		toolFailure: null,
	};
	const tool = createCompilerGymActionSpaceVisibilityOneCallTool({
		controller,
		allowedFlags: input.allowedFlags,
		trace,
	});
	const { session } = await createAgentSession({
		cwd: workspace,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		serviceTier: FROZEN_CAMPAIGN.model.serviceTier,
		settingsManager,
		sessionManager,
		resourceLoader,
		tools: [tool.name],
		customTools: [tool],
		includeGoals: false,
		includeCompactSkill: false,
	});
	activeSession = session;
	assert.equal(session.model?.provider, FROZEN_CAMPAIGN.model.provider);
	assert.equal(session.model?.id, FROZEN_CAMPAIGN.model.id);
	assert.equal(session.thinkingLevel, "xhigh");
	assert.equal(session.serviceTier, "priority");
	assert.deepEqual(session.getActiveToolNames(), [COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL.name]);
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("visibility session is not persistent");
	await chmod(sessionFile, 0o600);
	const events: AgentSessionEvent[] = [];
	const messages: AssistantMessage[] = [];
	const usages: Usage[] = [];
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			messages.push(structuredClone(message));
			usages.push(structuredClone(message.usage));
			providerTracker.outputTokens += message.usage.output;
		}
	});
	let promptFailure: string | null = null;
	try {
		await session.promptAndWait(input.preregistration.prompts.byArm[input.arm]);
	} catch (error) {
		promptFailure = errorText(error);
	} finally {
		unsubscribe();
		sessionManager.flushNow();
		await session.disposeAsync();
	}
	const paidAssistantMessages = messages.filter(
		(message) => message.stopReason !== "aborted" && message.stopReason !== "error",
	);
	const paidUsages = paidAssistantMessages.map((message) => structuredClone(message.usage));
	const usage = sumUsage(paidUsages);
	const outputTokens = usage.output;
	const policyFailures = policyFailuresFromEvents({ events, assistantMessages: messages, trace });
	const apparatusFailures: string[] = [];
	if (outputTokens > COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT) {
		apparatusFailures.push(
			`post-response output usage ${outputTokens} exceeded the output-token limit ${COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT}`,
		);
	}
	if (trace.toolFailureKind === "apparatus" && trace.toolFailure) apparatusFailures.push(trace.toolFailure);
	if (promptFailure && trace.toolFailureKind !== "policy" && policyFailures.length === 0) {
		apparatusFailures.push(promptFailure);
	}
	if (messages.every((message) => message.stopReason === "aborted")) {
		apparatusFailures.push("provider dispatch produced no transmitted assistant response");
	}
	if (messages.some((message) => message.stopReason === "error")) {
		apparatusFailures.push("provider dispatch returned an assistant transport/runtime error");
	}
	if (messages.filter((message) => message.stopReason !== "aborted" && message.stopReason !== "error").length > 1) {
		apparatusFailures.push("one provider dispatch produced multiple assistant messages");
	}
	if (providerRuntime.evidence.failures.length > 0) apparatusFailures.push(...providerRuntime.evidence.failures);
	if (providerTracker.apparatusGateFailures?.length) apparatusFailures.push(...providerTracker.apparatusGateFailures);
	if (providerTracker.providerCalls !== 1 && policyFailures.length === 0) {
		apparatusFailures.push(`expected one provider dispatch, observed ${providerTracker.providerCalls}`);
	}
	if (providerTracker.outputTokens !== usage.output) {
		apparatusFailures.push("provider-budget output usage differs from paid assistant-message usage");
	}
	if (input.aggregateProviderDispatches() > 2) apparatusFailures.push("pair provider-dispatch cap was exceeded");
	if (liveEnvironmentGates.length !== 1 || liveEnvironmentGates[0]?.outcome !== "passed") {
		apparatusFailures.push("exactly one passing live environment gate did not precede provider transport");
	}
	if (events.some((event) => event.type === "compaction_start" || event.type === "compaction_end")) {
		apparatusFailures.push("compaction occurred in the isolated visibility arm");
	}
	let candidate: CompilerGymActionSpaceVisibilityCandidate | null = null;
	let measurementEvidence: CompilerGymActionSpaceVisibilityMeasurementEvidence | null = null;
	if (trace.job && trace.request) {
		try {
			const validated = await candidateFromJob(trace.job, trace.request, evaluationRoot, input.pairArtifactStore);
			candidate = validated.candidate;
			measurementEvidence = validated.measurementEvidence;
		} catch (error) {
			apparatusFailures.push(errorText(error));
		}
	}
	const jobs = controller.statusForBranch(session.sessionId);
	if (jobs.length > 1) apparatusFailures.push("more than one candidate exists in the arm ledger");
	if (trace.duplicateCandidates !== 0) apparatusFailures.push("candidate dispatch was duplicated");
	controller.verifyLedger();
	const evaluationLedgerPath = resolve(evaluationRoot, "evidence.jsonl");
	const evaluationLedgerContents = await readFile(evaluationLedgerPath, "utf8");
	const evaluationLedgerEvents = verifyLedgerContentsStrict(evaluationLedgerContents);
	const evaluationLedgerTerminalHash = evaluationLedgerEvents.at(-1)?.hash ?? null;
	if (trace.job && evaluationLedgerTerminalHash === null) {
		apparatusFailures.push("candidate evaluation ledger has no terminal event hash");
	}
	const sessionContents = await readFile(sessionFile, "utf8");
	const persistedMessages = persistedAssistantMessages(sessionContents);
	const persistedUsages = persistedMessages.map((message) => structuredClone(message.usage));
	if (canonicalJson(toJsonValue(persistedUsages)) !== canonicalJson(toJsonValue(usages))) {
		apparatusFailures.push("assistant usage in the durable session differs from runtime usage evidence");
	}
	const runtimeBlockedContinuations = messages.filter(isExactBlockedContinuation);
	const persistedBlockedContinuations = persistedMessages.filter(isExactBlockedContinuation);
	const blockedContinuation =
		runtimeBlockedContinuations.length === 1 && persistedBlockedContinuations.length === 1
			? {
					stopReason: "aborted" as const,
					errorMessage: "Request was aborted" as const,
					content: EMPTY_ABORTED_ASSISTANT_CONTENT,
					usage: structuredClone(ZERO_USAGE),
					providerTransportAuthorized: false as const,
					runtimeEventMatched: true as const,
					durableSessionMatched: true as const,
				}
			: null;
	const disposition: ArmDisposition =
		apparatusFailures.length > 0
			? "apparatus-invalid"
			: policyFailures.length > 0
				? "policy-nonconformant"
				: "admitted";
	if (disposition === "admitted" && (!candidate || jobs.length !== 1 || trace.toolExecutions !== 1)) {
		apparatusFailures.push("admitted arm lacks exactly one complete candidate");
	}
	if (
		disposition === "admitted" &&
		(providerTracker.blockedProviderCalls !== 1 ||
			providerTracker.blockedReasons.length !== 1 ||
			providerTracker.blockedReasons[0] !== "provider-call-limit" ||
			blockedContinuation === null)
	) {
		apparatusFailures.push("admitted arm lacks exactly one locally blocked provider-call-limit continuation");
	}
	return {
		arm: input.arm,
		disposition: apparatusFailures.length > 0 ? "apparatus-invalid" : disposition,
		policyFailures,
		apparatusFailures: [...new Set(apparatusFailures)],
		providerDispatches: providerTracker.providerCalls,
		blockedProviderRequests: providerTracker.blockedProviderCalls,
		blockedProviderReasons: [...providerTracker.blockedReasons],
		transmittedAssistantResponses: messages.filter(
			(message) => message.stopReason !== "aborted" && message.stopReason !== "error",
		).length,
		abortedAssistantResponses: messages.filter((message) => message.stopReason === "aborted").length,
		toolCallAttempts: trace.toolCallAttempts,
		toolExecutions: trace.toolExecutions,
		candidateEvaluations: jobs.length,
		freshTaskEvaluations: jobs.reduce((total, job) => total + (job.measurement?.tasks.length ?? 0), 0),
		duplicateCandidates: trace.duplicateCandidates,
		outputTokens,
		usage,
		assistantMessageUsages: structuredClone(usages),
		paidAssistantMessageUsages: paidUsages,
		blockedContinuation,
		outputTokenLimit: COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
		request: trace.request,
		candidate,
		job: trace.job,
		measurementEvidence,
		sessionId: session.sessionId,
		sessionFile,
		sessionSha256: sha256Text(sessionContents),
		workspace,
		providerGuard: structuredClone(providerRuntime.evidence),
		evaluationLedgerPath,
		evaluationLedgerSha256: sha256Text(evaluationLedgerContents),
		evaluationLedgerTerminalHash,
		liveEnvironmentGates,
		eventCounts: eventCounts(events),
	};
};

function validateArmEvidence(evidence: CompilerGymActionSpaceVisibilityArmEvidence): void {
	if (!COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS.includes(evidence.arm)) throw new Error("visibility arm ID drifted");
	if (evidence.providerDispatches !== 1) throw new Error(`${evidence.arm} did not use exactly one provider dispatch`);
	if (evidence.disposition !== "apparatus-invalid" && evidence.transmittedAssistantResponses !== 1) {
		throw new Error(`${evidence.arm} lacks exactly one transmitted assistant response`);
	}
	if (
		evidence.disposition !== "apparatus-invalid" &&
		(!evidence.providerGuard ||
			evidence.providerGuard.providerRequestAttempts !== 1 ||
			evidence.providerGuard.systemPromptEvents !== 1 ||
			evidence.providerGuard.guideReplacementCount !== 1 ||
			evidence.providerGuard.providerRequestMatchedPairAnchor !== true ||
			evidence.providerGuard.runtimeWorktreeMatchedPreregistration !== true ||
			evidence.providerGuard.failures.length !== 0)
	) {
		throw new Error(`${evidence.arm} lacks complete provider-guard evidence`);
	}
	if (evidence.usage.output !== evidence.outputTokens)
		throw new Error(`${evidence.arm} usage totals are inconsistent`);
	if (
		canonicalJson(toJsonValue(sumUsage(evidence.paidAssistantMessageUsages))) !==
		canonicalJson(toJsonValue(evidence.usage))
	) {
		throw new Error(`${evidence.arm} paid assistant-message usage does not bind to its usage total`);
	}
	if (
		evidence.outputTokens > COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT &&
		evidence.disposition === "admitted"
	) {
		throw new Error(`${evidence.arm} exceeded the output-token limit but was admitted`);
	}
	if (evidence.disposition === "admitted") {
		if (
			evidence.policyFailures.length !== 0 ||
			evidence.apparatusFailures.length !== 0 ||
			evidence.toolCallAttempts !== 1 ||
			evidence.toolExecutions !== 1 ||
			evidence.blockedProviderRequests !== 1 ||
			evidence.blockedProviderReasons.length !== 1 ||
			evidence.blockedProviderReasons[0] !== "provider-call-limit" ||
			evidence.abortedAssistantResponses !== 1 ||
			evidence.paidAssistantMessageUsages.length !== 1 ||
			evidence.assistantMessageUsages.length !== 2 ||
			evidence.blockedContinuation === null ||
			evidence.blockedContinuation.stopReason !== "aborted" ||
			evidence.blockedContinuation.errorMessage !== "Request was aborted" ||
			evidence.blockedContinuation.providerTransportAuthorized !== false ||
			evidence.blockedContinuation.runtimeEventMatched !== true ||
			evidence.blockedContinuation.durableSessionMatched !== true ||
			canonicalJson(toJsonValue(evidence.blockedContinuation.content)) !==
				canonicalJson(toJsonValue(EMPTY_ABORTED_ASSISTANT_CONTENT)) ||
			canonicalJson(toJsonValue(evidence.blockedContinuation.usage)) !== canonicalJson(toJsonValue(ZERO_USAGE)) ||
			evidence.candidateEvaluations !== 1 ||
			evidence.freshTaskEvaluations !== 2 ||
			evidence.duplicateCandidates !== 0 ||
			!evidence.request ||
			!evidence.candidate ||
			!evidence.measurementEvidence ||
			!evidence.evaluationLedgerPath ||
			!evidence.evaluationLedgerSha256 ||
			!evidence.evaluationLedgerTerminalHash
		) {
			throw new Error(`${evidence.arm} admitted evidence is incomplete`);
		}
	}
}

function classifyPair(input: {
	arms: Partial<Record<CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArmEvidence>>;
	assessment: CompilerGymActionSpaceVisibilityPairAssessment | null;
}): PairDisposition {
	const control = input.arms[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM];
	const treatment = input.arms[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM];
	if (!control || !treatment) return "terminal-apparatus-invalid";
	if (control.disposition === "apparatus-invalid" || treatment.disposition === "apparatus-invalid") {
		return "terminal-apparatus-invalid";
	}
	if (control.disposition === "policy-nonconformant" || control.candidate?.outcome !== "verified") {
		return "inconclusive";
	}
	if (treatment.disposition === "policy-nonconformant" || treatment.candidate?.outcome !== "verified") {
		return "directional-loss";
	}
	return input.assessment?.decision ?? "inconclusive";
}

function validateProviderGuardPairEvidence(
	evidence: CompilerGymActionSpaceVisibilityProviderPairEvidence,
	expectedOrder: readonly [CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArm],
): void {
	assert.deepEqual(evidence.completedArms, [...expectedOrder], "provider guard completed-arm order drifted");
	if (evidence.failures.length !== 0) throw new Error(`provider guard failed: ${evidence.failures.join("; ")}`);
	if (evidence.anchorArm !== expectedOrder[0]) throw new Error("provider guard anchor arm differs from sampled order");
	for (const [label, value] of [
		["normalized system prompt", evidence.normalizedSystemPromptSha256],
		["normalized request body", evidence.normalizedRequestBodySha256],
		["resolved model snapshot", evidence.resolvedModelSnapshotSha256],
		["pair request anchor", evidence.providerRequestAnchorSha256],
		["final transcript anchor", evidence.previousTranscriptAnchorSha256],
	] as const) {
		if (!value || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`provider guard lacks ${label} evidence`);
	}
	if (evidence.actualWorkspaces.length !== 2 || new Set(evidence.actualWorkspaces).size !== 2) {
		throw new Error("provider guard does not prove two isolated arm workspaces");
	}
	if (evidence.actualConversationLogs.length !== 2 || new Set(evidence.actualConversationLogs).size !== 2) {
		throw new Error("provider guard does not prove two isolated conversation logs");
	}
}

async function validateDurableProviderGuardEvidence(input: {
	pair: CompilerGymActionSpaceVisibilityProviderPairEvidence;
	arms: Partial<Record<CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArmEvidence>>;
	expectedOrder: readonly [CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArm];
}): Promise<void> {
	const assertPrivateHash = async (
		path: string | null,
		expectedSha256: string | null,
		label: string,
	): Promise<void> => {
		if (!path || !expectedSha256) throw new Error(`provider guard lacks durable ${label} anchor identity`);
		const metadata = await stat(path);
		if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
			throw new Error(`provider guard ${label} anchor is not a private regular file`);
		}
		if (sha256Text(await readFile(path, "utf8")) !== expectedSha256) {
			throw new Error(`provider guard durable ${label} anchor hash drifted`);
		}
	};
	await assertPrivateHash(
		input.pair.providerRequestAnchorPath,
		input.pair.providerRequestAnchorSha256,
		"pair request",
	);
	for (const arm of input.expectedOrder) {
		const armEvidence = input.arms[arm]?.providerGuard;
		if (!armEvidence) throw new Error(`provider guard lacks durable arm evidence for ${arm}`);
		await assertPrivateHash(
			armEvidence.runtimeWorktreeAnchorPath,
			armEvidence.runtimeWorktreeAnchorSha256,
			`${arm} runtime-worktree`,
		);
		await assertPrivateHash(
			armEvidence.providerRequestTranscriptAnchorPath,
			armEvidence.providerRequestTranscriptAnchorSha256,
			`${arm} request-transcript`,
		);
	}
	const finalArmEvidence = input.arms[input.expectedOrder[1]]?.providerGuard;
	if (finalArmEvidence?.providerRequestTranscriptAnchorSha256 !== input.pair.previousTranscriptAnchorSha256) {
		throw new Error("provider guard final durable transcript does not bind to pair evidence");
	}
}

function assertGlobalAllocationUniqueness(input: {
	sharedS12: CompilerGymActionSpaceVisibilitySharedS12Evidence;
	arms: Partial<Record<CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArmEvidence>>;
}): void {
	if (!input.sharedS12.measurementEvidence) throw new Error("visibility pair lacks shared S12 allocation evidence");
	const measuredCandidates = COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS.flatMap((arm) => {
		const evidence = input.arms[arm]?.measurementEvidence;
		return evidence ? [evidence] : [];
	});
	const measurementEvidence = [input.sharedS12.measurementEvidence, ...measuredCandidates];
	if (measurementEvidence.some((evidence) => evidence.allocations.length !== 2)) {
		throw new Error("visibility measurement does not contain exactly two allocation identities");
	}
	const allocations = measurementEvidence.flatMap((evidence) => evidence.allocations);
	const expectedAllocationCount = 2 + 2 * measuredCandidates.length;
	if (allocations.length !== expectedAllocationCount) {
		throw new Error(
			`visibility pair expected ${expectedAllocationCount} observed CPU allocations, got ${allocations.length}`,
		);
	}
	for (const [label, values] of [
		["Slurm allocation", allocations.map((allocation) => allocation.slurmId)],
		["transient cache", allocations.map((allocation) => allocation.transientCache)],
		["scheduler job name", allocations.map((allocation) => allocation.jobName)],
	] as const) {
		if (new Set(values).size !== expectedAllocationCount) throw new Error(`visibility pair reused a ${label}`);
	}
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function runCompilerGymActionSpaceVisibilityFirstProposalPair(
	runnerInput: CompilerGymActionSpaceVisibilityRunnerInput,
	dependencies: CompilerGymActionSpaceVisibilityRunnerDependencies = {},
): Promise<CompilerGymActionSpaceVisibilityPairResult> {
	const dependencySnapshot = snapshotVisibilityRunnerDependencies(dependencies);
	const runtimeMode = dependencySnapshot.runtimeMode;
	const repoRoot = resolve(runnerInput.repoRoot);
	const preregistrationPath = resolve(runnerInput.preregistrationPath);
	const outputDir = resolve(runnerInput.outputDir);
	assertCompilerGymActionSpaceVisibilityLaunchPaths(repoRoot, preregistrationPath, outputDir);
	const signal = runnerInput.signal ?? new AbortController().signal;
	const now = dependencySnapshot.now ?? (() => new Date());
	await mkdir(outputDir, { recursive: false, mode: 0o700 });
	await chmod(outputDir, 0o700);
	const pairArtifactStore = new ArtifactStore(resolve(outputDir, "artifacts"));
	const ledgerPath = resolve(outputDir, "evidence.jsonl");
	const ledger = await EvidenceLedger.open(ledgerPath);
	const preregistrationContents = await readFile(preregistrationPath, "utf8");
	const authoritativeEvaluatorContents = await readFile(
		resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py"),
		"utf8",
	);
	const implementationClosure = await collectCompilerGymActionSpaceVisibilityImplementationClosure(repoRoot);
	const runtimeSnapshot: RepositorySnapshot = capturePrimeRuntimeWorktreeSnapshot(repoRoot);
	const preregistration = parseCompilerGymActionSpaceVisibilityPreregistration({
		value: JSON.parse(preregistrationContents) as unknown,
		repoRoot,
		preregistrationPath,
		outputDir,
		authoritativeEvaluatorContents,
		expectedImplementationClosure: implementationClosure,
		expectedRuntimeWorktreeSnapshot: runtimeSnapshot,
	});
	if (canonicalCompilerGymActionSpaceVisibilityPreregistration(preregistration) !== preregistrationContents) {
		throw new Error("visibility preregistration is not canonical newline-terminated JSON");
	}
	const preregistrationSha256 = sha256Text(preregistrationContents);
	const providerSessionId = `pav-${sha256Json({
		pairId: preregistration.pairId,
		preregistrationSha256,
	}).slice(0, 32)}`;
	const activeAgentDir = getAgentDir();
	const providerGuard = createCompilerGymActionSpaceVisibilityProviderGuard({
		spec: buildCompilerGymActionSpaceVisibilityProviderSpec({
			prompts: preregistration.prompts,
			providerSessionId,
			providerVisibleWorkspace: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_WORKSPACE,
			providerVisibleConversationLog: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_CONVERSATION_LOG,
			agentDir: activeAgentDir,
		}),
		preregistrationSha256,
		providerRequestAnchorPath: resolve(outputDir, "provider-request-anchor.json"),
		activeAgentDir,
		expectedRuntimeWorktreeSnapshot: preregistration.runtimeWorktreeClosure.snapshot,
		runtimeWorktreeSnapshotProvider: () => capturePrimeRuntimeWorktreeSnapshot(repoRoot),
	});
	const commandRunner =
		dependencySnapshot.commandRunner ??
		(runtimeMode === "production-defaults-no-dependency-injection"
			? new SpawnCompilerGymWarmCommandRunner()
			: undefined);
	const environment = DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG.environment;
	const remoteFileSystem =
		dependencySnapshot.remoteFileSystem ??
		(runtimeMode === "production-defaults-no-dependency-injection" && commandRunner
			? new SshCompilerGymWarmRemoteFileSystem(commandRunner, environment.host, "/usr/bin/python3", 2 * 60_000)
			: undefined);
	if (!remoteFileSystem) throw new Error("Visibility runtime lacks a remote filesystem boundary");
	const adapterFactory =
		dependencySnapshot.adapterFactory ??
		(runtimeMode === "production-defaults-no-dependency-injection" ? defaultAdapterFactory : undefined);
	if (!adapterFactory) throw new Error("Visibility runtime lacks an evaluation-adapter boundary");
	const liveEnvironmentGate =
		dependencySnapshot.liveEnvironmentGate ??
		(runtimeMode === "production-defaults-no-dependency-injection" && commandRunner
			? () => runCompilerGymPaidLiveEnvironmentGate({ repoRoot, commandRunner, environment, signal })
			: undefined);
	if (!liveEnvironmentGate) throw new Error("Visibility runtime lacks a live-environment gate boundary");
	const armRunner =
		dependencySnapshot.runArm ??
		(runtimeMode === "production-defaults-no-dependency-injection"
			? runCompilerGymActionSpaceVisibilityPrimeArm
			: undefined);
	if (!armRunner) throw new Error("Visibility runtime lacks an arm-runner boundary");
	const remoteLocks: CompilerGymActionSpaceVisibilityRemoteLockEvidence[] = [];
	const arms: Partial<Record<CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArmEvidence>> = {};
	let sharedS12: CompilerGymActionSpaceVisibilitySharedS12Evidence | null = null;
	let postflight: CompilerGymActionSpaceVisibilityLiveGateRecord | null = null;
	let assessment: CompilerGymActionSpaceVisibilityPairAssessment | null = null;
	let postflightImplementationBundleSha256: string | null = null;
	let postflightRuntimeWorktreeSnapshotSha256: string | null = null;
	let aggregateProviderDispatches = 0;
	let failure: string | null = null;
	let disposition: PairDisposition = "terminal-apparatus-invalid";
	await ledger.append("run_manifest", {
		type: "visibility_pair_start",
		runtimeMode,
		runnerProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL,
		preregistrationPath,
		preregistrationSha256,
		sampledArmOrder: preregistration.executionOrder.armOrder,
		implementationBundleSha256: preregistration.implementationBundleSha256,
		runtimeWorktreeSnapshotSha256: preregistration.runtimeWorktreeClosure.snapshotSha256,
		providerSpecSha256: providerGuard.specSha256,
		startedAt: now().toISOString(),
	});
	try {
		const s12Lock = await createRemoteLock({
			remoteFileSystem,
			artifactStore: pairArtifactStore,
			parentRoot: preregistration.remoteLocks.parentRoot,
			root: preregistration.remoteLocks.root,
			path: preregistration.remoteLocks.sharedS12GatePath,
			kind: "shared-s12-gate",
			arm: null,
			claims: {
				runnerProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL,
				preregistrationSha256,
				epoch: COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH,
				sampledArmOrder: preregistration.executionOrder.armOrder,
				providerDispatchesBeforeLock: aggregateProviderDispatches,
				createdAt: now().toISOString(),
			},
			signal,
		});
		remoteLocks.push(s12Lock);
		await ledger.append("run_manifest", { type: "visibility_remote_lock", ...s12Lock });
		sharedS12 = await runCompilerGymActionSpaceVisibilitySharedS12Gate({
			outputDir: resolve(outputDir, "shared-s12"),
			adapter: adapterFactory(),
			pairArtifactStore,
		});
		await ledger.append("measurement", {
			type: "visibility_shared_s12_gate",
			preregistrationSha256,
			...sharedS12,
		});
		if (!sharedS12.passed || sharedS12.providerDispatches !== 0) {
			throw new Error(`shared S12 gate failed: ${sharedS12.assessment.failures.join("; ")}`);
		}
		const globalLock = await createRemoteLock({
			remoteFileSystem,
			artifactStore: pairArtifactStore,
			parentRoot: preregistration.remoteLocks.parentRoot,
			root: preregistration.remoteLocks.root,
			path: preregistration.remoteLocks.globalPath,
			kind: "paid-pair-global",
			arm: null,
			claims: {
				runnerProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL,
				preregistrationSha256,
				sharedS12EpochSha256: sharedS12.epochSha256,
				sharedS12RawAggregate: sharedS12.rawAggregate,
				providerSpecSha256: providerGuard.specSha256,
				sampledArmOrder: preregistration.executionOrder.armOrder,
				createdAt: now().toISOString(),
			},
			signal,
		});
		remoteLocks.push(globalLock);
		await ledger.append("run_manifest", { type: "visibility_remote_lock", ...globalLock });
		const guides = reconstructCompilerGymActionSpaceVisibilityGuides(authoritativeEvaluatorContents);
		for (const [index, arm] of preregistration.executionOrder.armOrder.entries()) {
			const armOutputDir = resolve(outputDir, `arm-${index + 1}-${arm}`);
			await mkdir(armOutputDir, { recursive: false, mode: 0o700 });
			const armLock = await createRemoteLock({
				remoteFileSystem,
				artifactStore: pairArtifactStore,
				parentRoot: preregistration.remoteLocks.parentRoot,
				root: preregistration.remoteLocks.root,
				path: preregistration.remoteLocks.armPaths[arm],
				kind: "paid-arm",
				arm,
				claims: {
					runnerProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL,
					preregistrationSha256,
					globalLockSha256: globalLock.contentsSha256,
					arm,
					armOrdinal: index + 1,
					promptSha256: preregistration.prompts.promptSha256ByArm[arm],
					providerSpecSha256: providerGuard.specSha256,
					providerDispatchesBeforeLock: aggregateProviderDispatches,
					createdAt: now().toISOString(),
				},
				signal,
			});
			remoteLocks.push(armLock);
			await ledger.append("run_manifest", { type: "visibility_remote_lock", ...armLock });
			const armEvidence = await armRunner({
				arm,
				armOutputDir,
				preregistration,
				preregistrationSha256,
				providerGuard,
				pairArtifactStore,
				allowedFlags: guides.allowedFlags,
				adapter: adapterFactory(),
				ledger,
				liveEnvironmentGate,
				aggregateProviderDispatches: () => aggregateProviderDispatches,
				recordProviderDispatch: () => {
					aggregateProviderDispatches++;
				},
				signal,
			});
			validateArmEvidence(armEvidence);
			arms[arm] = structuredClone(armEvidence);
			await ledger.append("measurement", { type: "visibility_arm_terminal", ...armEvidence });
			if (armEvidence.disposition === "apparatus-invalid") {
				throw new Error(`${arm} apparatus invalid: ${armEvidence.apparatusFailures.join("; ")}`);
			}
		}
		if (aggregateProviderDispatches !== 2) {
			throw new Error(`visibility pair expected two provider dispatches, observed ${aggregateProviderDispatches}`);
		}
		try {
			const evidence = await liveEnvironmentGate();
			postflight = {
				phase: "postflight",
				arm: null,
				providerDispatchOrdinal: null,
				outcome: "passed",
				evidence,
				failure: null,
			};
		} catch (error) {
			postflight = {
				phase: "postflight",
				arm: null,
				providerDispatchOrdinal: null,
				outcome: "failed",
				evidence: null,
				failure: errorText(error),
			};
		}
		await ledger.append("run_manifest", { type: "visibility_postflight_environment_gate", ...postflight });
		if (postflight.outcome !== "passed") throw new Error(`visibility postflight failed: ${postflight.failure}`);
		validateProviderGuardPairEvidence(providerGuard.pairEvidence, preregistration.executionOrder.armOrder);
		await validateDurableProviderGuardEvidence({
			pair: providerGuard.pairEvidence,
			arms,
			expectedOrder: preregistration.executionOrder.armOrder,
		});
		await ledger.append("run_manifest", {
			type: "visibility_provider_guard_pair_evidence",
			...providerGuard.pairEvidence,
		});
		const postflightImplementationClosure =
			await collectCompilerGymActionSpaceVisibilityImplementationClosure(repoRoot);
		postflightImplementationBundleSha256 = sha256Json(postflightImplementationClosure);
		if (postflightImplementationBundleSha256 !== preregistration.implementationBundleSha256) {
			throw new Error("visibility implementation closure changed during the paid pair");
		}
		const postflightRuntimeSnapshot = capturePrimeRuntimeWorktreeSnapshot(repoRoot);
		postflightRuntimeWorktreeSnapshotSha256 = sha256Json(postflightRuntimeSnapshot);
		if (postflightRuntimeWorktreeSnapshotSha256 !== preregistration.runtimeWorktreeClosure.snapshotSha256) {
			throw new Error("visibility Prime runtime worktree closure changed during the paid pair");
		}
		await ledger.append("run_manifest", {
			type: "visibility_postflight_source_closure",
			implementationBundleSha256: postflightImplementationBundleSha256,
			runtimeWorktreeSnapshotSha256: postflightRuntimeWorktreeSnapshotSha256,
		});
		const control = arms[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM];
		const treatment = arms[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM];
		if (!control || !treatment) throw new Error("both visibility arms are required before comparison");
		assertGlobalAllocationUniqueness({ sharedS12, arms });
		if (control.disposition === "admitted" && treatment.disposition === "admitted") {
			assert.ok(control.candidate && treatment.candidate, "admitted visibility arms require candidates");
			assessment = assessCompilerGymActionSpaceVisibilityPair({
				control: control.candidate,
				treatment: treatment.candidate,
				guides,
			});
		}
		disposition = classifyPair({ arms, assessment });
		await ledger.append("claim", {
			type: "visibility_pair_assessment",
			disposition,
			assessment,
			runtimeMode,
			liveScientificEvidenceEligible: runtimeMode === "production-defaults-no-dependency-injection",
			causalClaimAllowed: false,
			randomizedInferenceAllowed: false,
			tamperEvidentRandomAssignment: false,
			defaultPromotionAllowed: false,
			gpuPromotionAllowed: false,
			nanogptPromotionAllowed: false,
		});
	} catch (error) {
		failure = errorText(error);
		disposition = "terminal-apparatus-invalid";
		await ledger.append("run_manifest", {
			type: "visibility_pair_terminal_failure",
			disposition,
			failure,
			providerDispatchesTotal: aggregateProviderDispatches,
		});
	}
	await ledger.append("run_manifest", {
		type: "visibility_pair_end",
		disposition,
		failure,
		runtimeMode,
		liveScientificEvidenceEligible:
			runtimeMode === "production-defaults-no-dependency-injection" && disposition !== "terminal-apparatus-invalid",
		causalClaimAllowed: false,
		randomizedInferenceAllowed: false,
		tamperEvidentRandomAssignment: false,
		providerDispatchesTotal: aggregateProviderDispatches,
		candidateEvaluationsTotal: Object.values(arms).reduce((sum, arm) => sum + arm.candidateEvaluations, 0),
		freshTaskEvaluationsTotal: Object.values(arms).reduce((sum, arm) => sum + arm.freshTaskEvaluations, 0),
		finishedAt: now().toISOString(),
	});
	ledger.verify();
	const ledgerContents = await readFile(ledgerPath, "utf8");
	const ledgerEvents = verifyLedgerContentsStrict(ledgerContents);
	const ledgerTerminalHash = ledgerEvents.at(-1)?.hash;
	if (!ledgerTerminalHash) throw new Error("visibility pair ledger lacks a terminal hash");
	const result: CompilerGymActionSpaceVisibilityPairResult = {
		ok: disposition !== "terminal-apparatus-invalid",
		runtimeMode,
		liveScientificEvidenceEligible:
			runtimeMode === "production-defaults-no-dependency-injection" && disposition !== "terminal-apparatus-invalid",
		causalClaimAllowed: false,
		randomizedInferenceAllowed: false,
		tamperEvidentRandomAssignment: false,
		launchArgv: [...preregistration.launch.runArgv],
		runnerProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL,
		preregistrationPath,
		preregistrationSha256,
		sampledArmOrder: preregistration.executionOrder.armOrder,
		disposition,
		failure,
		sharedS12,
		remoteLocks,
		arms,
		postflight,
		providerGuard: structuredClone(providerGuard.pairEvidence),
		postflightImplementationBundleSha256,
		postflightRuntimeWorktreeSnapshotSha256,
		assessment,
		providerDispatchesTotal: aggregateProviderDispatches,
		candidateEvaluationsTotal: Object.values(arms).reduce((sum, arm) => sum + arm.candidateEvaluations, 0),
		freshTaskEvaluationsTotal: Object.values(arms).reduce((sum, arm) => sum + arm.freshTaskEvaluations, 0),
		ledgerPath,
		ledgerSha256: sha256Text(ledgerContents),
		ledgerTerminalHash,
		finishedAt: now().toISOString(),
	};
	await writePrivateJson(resolve(outputDir, "result.json"), result);
	return result;
}

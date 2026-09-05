import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxToolCall,
	registerFauxProvider,
	type Usage,
} from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT,
	type CompilerGymActionSpaceVisibilityAllocationEvidence,
	type CompilerGymActionSpaceVisibilityArmEvidence,
	type CompilerGymActionSpaceVisibilityArmRunner,
	type CompilerGymActionSpaceVisibilityArmRunnerInput,
	type CompilerGymActionSpaceVisibilityOneCallToolTrace,
	type CompilerGymActionSpaceVisibilityRunnerDependencies,
	createCompilerGymActionSpaceVisibilityOneCallTool,
	runCompilerGymActionSpaceVisibilityFirstProposalPair,
} from "../src/compiler-gym-action-space-visibility-first-proposal-runner.js";
import {
	buildCompilerGymActionSpaceVisibilityPreregistration,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
	type CompilerGymActionSpaceVisibilityPreregistration,
	canonicalCompilerGymActionSpaceVisibilityPreregistration,
	collectCompilerGymActionSpaceVisibilityImplementationClosure,
} from "../src/compiler-gym-action-space-visibility-preregistration.js";
import {
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
	type CompilerGymActionSpaceVisibilityArm,
	reconstructCompilerGymActionSpaceVisibilityGuides,
} from "../src/compiler-gym-action-space-visibility-protocol.js";
import type { CompilerGymActionSpaceVisibilityProviderArmEvidence } from "../src/compiler-gym-action-space-visibility-provider-guard.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE,
} from "../src/compiler-gym-ir-delta-screen-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import type { CompilerGymPaidLiveEnvironmentGateEvidence } from "../src/compiler-gym-paid-live-environment-gate.js";
import type { CompilerGymWarmRemoteFileSystem } from "../src/compiler-gym-warm-farmshare-backend.js";
import { ResearchController } from "../src/controller.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";
import { STOCK_CPU_TASKS, type StockCpuEvaluationRequest } from "../src/stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
} from "../src/stock-interface-parity.js";
import { STOCK_INTERFACE_PARITY_ACTION_GUIDE } from "../src/stock-interface-parity-protocol.js";
import type { EvaluationAdapter, EvaluationJob, EvaluationOutcome } from "../src/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const EVALUATOR_PATH = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
const FIXED_NOW = new Date("2026-08-29T22:00:00.000Z");

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

function usage(output: number): Usage {
	return {
		input: 100,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 100 + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function accountingRow(input: { jobIdRaw: string; jobName: string; allocCpus: number; nTasks: number | null }) {
	return {
		jobIdRaw: input.jobIdRaw,
		jobName: input.jobName,
		state: "COMPLETED",
		exitCode: "0:0",
		allocCpus: input.allocCpus,
		nTasks: input.nTasks,
		elapsedRawSeconds: 2,
		cpuTimeRawSeconds: input.allocCpus * 2,
		nodeList: "barley-01",
		startAt: "2026-08-29T22:00:00",
		endAt: "2026-08-29T22:00:02",
	};
}

class FauxS12Adapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	readonly deterministicMeasurementReuse = undefined;
	calls = 0;
	private allocationOrdinal = 0;

	constructor(private readonly exactMetrics: boolean) {}

	async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
		this.calls++;
		const parsed: unknown = JSON.parse(job.candidateContent);
		assert.ok(Array.isArray(parsed) && parsed.every((value) => typeof value === "string"));
		const actions = parsed as string[];
		const tasks = STOCK_CPU_TASKS.map((benchmarkId) => {
			this.allocationOrdinal++;
			const slurmId = `s12-${this.allocationOrdinal}`;
			const jobName = `visibility-s12-${this.allocationOrdinal}`;
			const stdout = canonicalLine({ validation: { inputs_completed: 20, passed: true } });
			const stderr = "";
			const root = accountingRow({ jobIdRaw: slurmId, jobName, allocCpus: 4, nTasks: null });
			return {
				accounting: root,
				accountingRows: {
					contract: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
					interpretation: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
					root,
					extern: accountingRow({
						jobIdRaw: `${slurmId}.extern`,
						jobName: "extern",
						allocCpus: 4,
						nTasks: 1,
					}),
					step: accountingRow({
						jobIdRaw: `${slurmId}.0`,
						jobName,
						allocCpus: 2,
						nTasks: 1,
					}),
				},
				benchmarkId,
				evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
				exitCode: 0,
				jobName,
				requestSha256: sha256Text(canonicalLine({ benchmark: benchmarkId, actions })),
				slurmId,
				stderr,
				stderrSha256: sha256Text(stderr),
				stdout,
				stdoutSha256: sha256Text(stdout),
				transientCache: `/tmp/${jobName}`,
				wallMs: 2_000,
			};
		});
		const aggregate = canonicalLine({
			actionsSha256: sha256Json(actions),
			candidateSha256: job.candidate.digest,
			contract: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
			evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			jobId: job.jobId,
			manifestDigest: job.manifestDigest,
			measurementReuse: false,
			remoteEvaluatorPath: `/sealed/${COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256}/evaluator.py`,
			sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			sourceDirectory: `/sealed/${COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256}`,
			tasks,
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
		});
		return {
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
			tasks: STOCK_CPU_TASKS.map((benchmarkId, index) => {
				const expected = COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[benchmarkId];
				return {
					benchmarkId,
					status: "accepted" as const,
					metrics: {
						IrInstructionCount: expected.irInstructionCount + (!this.exactMetrics && index === 0 ? 1 : 0),
						ObjectTextSizeBytes: expected.objectTextSizeBytes,
					},
					verifier: { passed: true, checks: ["20 callbacks"], errors: [] },
					runtimeMs: 2_000,
				};
			}),
			hardware: { cluster: "faux-local" },
			provenance: { ...COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE },
			stdout: aggregate,
			stderr: "",
		};
	}
}

class FauxRemoteLocks implements CompilerGymWarmRemoteFileSystem {
	readonly files = new Map<string, string>();
	readonly installed: Array<{ path: string; allowExistingExact: boolean; mode: number }> = [];
	readonly attemptedPaths: string[] = [];
	readonly directories: string[] = [];
	readonly createdDirectories = new Set<string>();
	readonly operations: Array<{ kind: "ensure" | "install"; path: string }> = [];
	failEnsurePath: string | null = null;

	async ensurePrivateDirectory(path: string): Promise<void> {
		this.directories.push(path);
		this.operations.push({ kind: "ensure", path });
		if (path === this.failEnsurePath) throw new Error(`faux ensure directory failed: ${path}`);
		const parent = posix.dirname(path);
		const parentIsUserStorageRoot = /^\/(?:scratch|home)\/users\/[^/]+$/.test(parent);
		if (!parentIsUserStorageRoot && !this.createdDirectories.has(parent)) {
			throw new Error(`faux one-level directory parent is absent: ${parent}`);
		}
		this.createdDirectories.add(path);
	}

	async createPrivateDirectory(path: string): Promise<void> {
		await this.ensurePrivateDirectory(path);
	}

	async installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
	): Promise<void> {
		this.attemptedPaths.push(path);
		this.operations.push({ kind: "install", path });
		assert.equal(allowExistingExact, false);
		assert.equal(mode, 0o600);
		assert.equal(sha256Text(content), expectedSha256);
		if (this.files.has(path)) throw new Error(`faux create-only lock already exists: ${path}`);
		this.files.set(path, content);
		this.installed.push({ path, allowExistingExact, mode });
	}

	async linkImmutableFile(): Promise<void> {
		throw new Error("visibility runner must not link remote lock files");
	}

	async readTrustedFile(
		path: string,
		options: { maxBytes: number; mode: number; expectedSha256?: string },
	): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`missing faux remote lock: ${path}`);
		assert.equal(options.mode, 0o600);
		assert.ok(Buffer.byteLength(content) <= options.maxBytes);
		if (options.expectedSha256) assert.equal(sha256Text(content), options.expectedSha256);
		return content;
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}
}

type ArmPolicyKind = "schema" | "no-tool" | "multi-tool" | "wrong-tool" | "empty" | "illegal" | "overcap";

const POLICY_FAILURES: Record<ArmPolicyKind, string> = {
	schema: "model tool arguments failed schema admission before host execution",
	"no-tool": "model response contained no tool call",
	"multi-tool": "model response contained multiple tool calls",
	"wrong-tool": "model response requested a non-evaluator tool",
	empty: "actions must contain between one and 256 LLVM passes",
	illegal: "actions contains illegal LLVM pass: -not-legal",
	overcap: "actions may contain at most 256 pass flags",
};

interface ArmScenario {
	policy?: Partial<Record<CompilerGymActionSpaceVisibilityArm, ArmPolicyKind>>;
	controlSemanticRejection?: boolean;
	overshootArm?: CompilerGymActionSpaceVisibilityArm;
	duplicateAllocation?: boolean;
	badBlockedContinuation?: "nonzero-usage" | "wrong-error";
}

async function writePrivateAnchor(path: string, label: string): Promise<string> {
	const contents = canonicalLine({ label });
	await writeFile(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
	await chmod(path, 0o600);
	return sha256Text(contents);
}

async function registerProviderEvidence(input: CompilerGymActionSpaceVisibilityArmRunnerInput) {
	const pair = input.providerGuard.pairEvidence;
	const digest = (value: string) => sha256Text(value);
	pair.normalizedSystemPromptSha256 ??= digest("normalized-system");
	pair.normalizedRequestBodySha256 ??= digest("normalized-request");
	pair.resolvedModelSnapshotSha256 ??= digest("resolved-model");
	if (pair.providerRequestAnchorSha256 === null) {
		pair.providerRequestAnchorSha256 = await writePrivateAnchor(pair.providerRequestAnchorPath, "pair-anchor");
	}
	pair.anchorArm ??= input.arm;
	pair.completedArms.push(input.arm);
	const workspace = join(input.armOutputDir, "workspace");
	const conversationLog = join(input.armOutputDir, "sessions", "session.jsonl");
	const runtimeWorktreeAnchorPath = join(input.armOutputDir, "runtime-anchor.json");
	const providerRequestTranscriptAnchorPath = join(input.armOutputDir, "request-anchor.json");
	const runtimeWorktreeAnchorSha256 = await writePrivateAnchor(runtimeWorktreeAnchorPath, `runtime-${input.arm}`);
	const providerRequestTranscriptAnchorSha256 = await writePrivateAnchor(
		providerRequestTranscriptAnchorPath,
		`transcript-${input.arm}`,
	);
	pair.previousTranscriptAnchorSha256 = providerRequestTranscriptAnchorSha256;
	pair.actualWorkspaces.push(workspace);
	pair.actualConversationLogs.push(conversationLog);
	const runtime = input.providerGuard.runtimeForArm(input.arm);
	Object.assign(runtime.evidence, {
		systemPromptEvents: 1,
		workingDirectoryReplacements: 1,
		conversationLogReplacements: 1,
		normalizedSystemPromptSha256: pair.normalizedSystemPromptSha256,
		normalizedSystemPromptMatchedPairAnchor: true,
		providerRequestAttempts: 1,
		providerRequestBodySha256: digest(`request-${input.arm}`),
		normalizedProviderRequestBodySha256: pair.normalizedRequestBodySha256,
		guideReplacementCount: 1,
		providerRequestMatchedPairAnchor: true,
		resolvedModelSnapshotSha256: pair.resolvedModelSnapshotSha256,
		resolvedModelMatchedPairAnchor: true,
		actualWorkspace: workspace,
		actualConversationLog: conversationLog,
		runtimeWorktreeSnapshotSha256: input.preregistration.runtimeWorktreeClosure.snapshotSha256,
		runtimeWorktreeMatchedPreregistration: true,
		runtimeWorktreeAnchorPath,
		runtimeWorktreeAnchorSha256,
		providerRequestTranscriptAnchorPath,
		providerRequestTranscriptAnchorSha256,
		failures: [],
	} satisfies Partial<CompilerGymActionSpaceVisibilityProviderArmEvidence>);
	return { providerGuard: structuredClone(runtime.evidence), workspace, conversationLog };
}

function allocation(
	arm: CompilerGymActionSpaceVisibilityArm,
	index: number,
	duplicateAllocation: boolean,
): CompilerGymActionSpaceVisibilityAllocationEvidence {
	const suffix = duplicateAllocation && index === 0 ? "s12-1" : `paid-${arm}-${index}`;
	return {
		benchmarkId: STOCK_CPU_TASKS[index]!,
		slurmId: suffix,
		transientCache: `/tmp/cache-${suffix}`,
		jobName: `job-${suffix}`,
		requestSha256: sha256Text(`request-${suffix}`),
	};
}

function createFauxArmRunner(scenario: ArmScenario = {}): CompilerGymActionSpaceVisibilityArmRunner {
	return async (input) => {
		const policyKind = scenario.policy?.[input.arm];
		const registered = await registerProviderEvidence(input);
		const environmentEvidence = (await input.liveEnvironmentGate()) as CompilerGymPaidLiveEnvironmentGateEvidence;
		input.recordProviderDispatch();
		const outputTokens =
			scenario.overshootArm === input.arm ? COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT + 1 : 10;
		const stockFlags = new Set<string>(STOCK_INTERFACE_PARITY_ACTION_GUIDE);
		const requestActions =
			input.arm === COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM
				? [STOCK_INTERFACE_PARITY_ACTION_GUIDE[0]!]
				: [STOCK_INTERFACE_PARITY_ACTION_GUIDE[0]!, input.allowedFlags.find((flag) => !stockFlags.has(flag))!];
		const request: StockCpuEvaluationRequest = {
			actions: requestActions,
			hypothesis: `${input.arm} faux proposal`,
			mechanism: "guide visibility",
			predictedOutcome: "lower IR",
			boundaryConditions: [],
		};
		const semanticRejection =
			input.arm === COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM && scenario.controlSemanticRejection === true;
		const digest = sha256Text(`aggregate-${input.arm}`);
		const isPolicy = policyKind !== undefined;
		const armUsage = usage(outputTokens);
		const blockedContinuation = {
			stopReason: "aborted" as const,
			errorMessage: "Request was aborted" as const,
			content: [{ type: "text" as const, text: "" }] as const,
			usage: zeroUsage(),
			providerTransportAuthorized: false as const,
			runtimeEventMatched: true as const,
			durableSessionMatched: true as const,
		};
		if (scenario.badBlockedContinuation === "nonzero-usage") blockedContinuation.usage.input = 1;
		if (scenario.badBlockedContinuation === "wrong-error") {
			(blockedContinuation as { errorMessage: string }).errorMessage = "Wrong abort reason";
		}
		return {
			arm: input.arm,
			disposition: isPolicy ? "policy-nonconformant" : "admitted",
			policyFailures: policyKind ? [POLICY_FAILURES[policyKind]] : [],
			apparatusFailures: [],
			providerDispatches: 1,
			blockedProviderRequests: 1,
			blockedProviderReasons: ["provider-call-limit"],
			transmittedAssistantResponses: 1,
			abortedAssistantResponses: 1,
			toolCallAttempts:
				policyKind === "no-tool" || policyKind === "schema" || policyKind === "wrong-tool"
					? 0
					: policyKind === "multi-tool"
						? 2
						: 1,
			toolExecutions: isPolicy ? 0 : 1,
			candidateEvaluations: isPolicy ? 0 : 1,
			freshTaskEvaluations: isPolicy ? 0 : 2,
			duplicateCandidates: 0,
			outputTokens,
			usage: armUsage,
			assistantMessageUsages: [armUsage, zeroUsage()],
			paidAssistantMessageUsages: [armUsage],
			blockedContinuation,
			outputTokenLimit: COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
			request: isPolicy ? null : request,
			candidate: isPolicy
				? null
				: {
						actions: requestActions,
						outcome: semanticRejection ? "complete-semantic-rejection" : "verified",
						blowfishIr: semanticRejection
							? null
							: input.arm === COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM
								? 2_200
								: 2_199,
						bzip2Ir: semanticRejection ? null : 14_000,
						verifierInputsCompleted: { blowfish: 20, bzip2: 20 },
					},
			job: null,
			measurementEvidence: isPolicy
				? null
				: {
						rawAggregate: { digest, byteLength: 1, mediaType: "application/json" },
						rawAggregateStore: "pair-artifact-store",
						rawAggregateSha256: digest,
						jobId: `job-${input.arm}`,
						manifestDigest: sha256Text(`manifest-${input.arm}`),
						candidateSha256: sha256Json(requestActions),
						actionsSha256: sha256Json(requestActions),
						verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
						evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
						sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
						allocations: [0, 1].map((index) =>
							allocation(input.arm, index, scenario.duplicateAllocation ?? false),
						),
					},
			sessionId: `session-${input.arm}`,
			sessionFile: join(input.armOutputDir, "sessions", "session.jsonl"),
			sessionSha256: sha256Text(`session-${input.arm}`),
			workspace: registered.workspace,
			providerGuard: registered.providerGuard,
			evaluationLedgerPath: isPolicy ? null : join(input.armOutputDir, "evaluation", "evidence.jsonl"),
			evaluationLedgerSha256: isPolicy ? null : sha256Text(`ledger-${input.arm}`),
			evaluationLedgerTerminalHash: isPolicy ? null : sha256Text(`terminal-${input.arm}`),
			liveEnvironmentGates: [
				{
					phase: "pre-provider",
					arm: input.arm,
					providerDispatchOrdinal: 1,
					outcome: "passed",
					evidence: environmentEvidence,
					failure: null,
				},
			],
			eventCounts: {},
		} satisfies CompilerGymActionSpaceVisibilityArmEvidence;
	};
}

interface Harness {
	root: string;
	preregistration: CompilerGymActionSpaceVisibilityPreregistration;
	preregistrationPath: string;
	outputDir: string;
	remote: FauxRemoteLocks;
	adapterFactoryCalls: { value: number };
	armRunnerCalls: { value: number };
	dependencies: CompilerGymActionSpaceVisibilityRunnerDependencies;
	run(): ReturnType<typeof runCompilerGymActionSpaceVisibilityFirstProposalPair>;
	runWithDependencies(
		dependencies: CompilerGymActionSpaceVisibilityRunnerDependencies,
	): ReturnType<typeof runCompilerGymActionSpaceVisibilityFirstProposalPair>;
}

async function harness(input: {
	drawHex: string;
	s12Pass?: boolean;
	armScenario?: ArmScenario;
	remote?: FauxRemoteLocks;
}): Promise<Harness> {
	const root = await mkdtemp(join(tmpdir(), "prime-visibility-runner-"));
	const preregistrationPath = join(root, "preregistration.json");
	const outputDir = join(root, "output");
	const authoritativeEvaluatorContents = await readFile(EVALUATOR_PATH, "utf8");
	const record = buildCompilerGymActionSpaceVisibilityPreregistration({
		createdAt: FIXED_NOW.toISOString(),
		drawHex: input.drawHex,
		repoRoot: REPO_ROOT,
		preregistrationPath,
		outputDir,
		authoritativeEvaluatorContents,
		implementationClosure: await collectCompilerGymActionSpaceVisibilityImplementationClosure(REPO_ROOT),
		runtimeWorktreeSnapshot: capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT),
	});
	await writeFile(preregistrationPath, canonicalCompilerGymActionSpaceVisibilityPreregistration(record), {
		encoding: "utf8",
		flag: "wx",
		mode: 0o600,
	});
	await chmod(preregistrationPath, 0o600);
	const remote = input.remote ?? new FauxRemoteLocks();
	const adapterFactoryCalls = { value: 0 };
	const armRunnerCalls = { value: 0 };
	const fauxArmRunner = createFauxArmRunner(input.armScenario);
	const dependencies: CompilerGymActionSpaceVisibilityRunnerDependencies = {
		testOnlyInjectedRuntime: true,
		remoteFileSystem: remote,
		adapterFactory: () => {
			adapterFactoryCalls.value++;
			return new FauxS12Adapter(input.s12Pass ?? true);
		},
		liveEnvironmentGate: async () => ({}) as CompilerGymPaidLiveEnvironmentGateEvidence,
		runArm: async (armInput) => {
			armRunnerCalls.value++;
			return fauxArmRunner(armInput);
		},
		now: () => FIXED_NOW,
	};
	const runnerInput = { repoRoot: REPO_ROOT, preregistrationPath, outputDir };
	return {
		root,
		preregistration: record,
		preregistrationPath,
		outputDir,
		remote,
		adapterFactoryCalls,
		armRunnerCalls,
		dependencies,
		run: () => runCompilerGymActionSpaceVisibilityFirstProposalPair(runnerInput, dependencies),
		runWithDependencies: (injected) => runCompilerGymActionSpaceVisibilityFirstProposalPair(runnerInput, injected),
	};
}

function persistedAssistantMessages(sessionContents: string): AssistantMessage[] {
	return sessionContents
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown)
		.flatMap((entry) => {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
			const record = entry as Record<string, unknown>;
			if (record.type !== "message" || typeof record.message !== "object" || record.message === null) return [];
			const message = record.message as Record<string, unknown>;
			return message.role === "assistant" ? [structuredClone(message) as unknown as AssistantMessage] : [];
		});
}

function assertExactBlockedContinuation(message: AssistantMessage): void {
	assert.equal(message.stopReason, "aborted");
	assert.equal(message.errorMessage, "Request was aborted");
	assert.deepEqual(message.content, [{ type: "text", text: "" }]);
	assert.deepEqual(message.usage, zeroUsage());
}

async function actualFauxBlockedContinuation(root: string) {
	const workspace = join(root, "faux-continuation-workspace");
	const sessionDir = join(root, "faux-continuation-sessions");
	await mkdir(workspace, { recursive: true, mode: 0o700 });
	const adapter = new FauxS12Adapter(true);
	const controller = await ResearchController.open({
		ledgerPath: join(root, "faux-continuation-evaluation", "evidence.jsonl"),
		artifactDir: join(root, "faux-continuation-evaluation", "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: { "compiler-gym": STOCK_CPU_TASKS, kernelbench: [], nanogpt: [] },
		allowedTreatments: [COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: 1,
		maxTaskEvaluationsPerBranch: 2,
	});
	const guides = reconstructCompilerGymActionSpaceVisibilityGuides(await readFile(EVALUATOR_PATH, "utf8"));
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
		allowedFlags: guides.allowedFlags,
		trace,
	});
	const providerTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
		apparatusGateFailures: [],
	};
	const faux = registerFauxProvider({
		provider: `faux-visibility-continuation-${process.pid}-${root.split("/").at(-1)}`,
		models: [{ id: "faux-1", reasoning: false }],
	});
	const model = faux.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((registeredModel) => ({
			id: registeredModel.id,
			name: registeredModel.name,
			api: registeredModel.api,
			reasoning: registeredModel.reasoning,
			input: registeredModel.input,
			cost: registeredModel.cost,
			contextWindow: registeredModel.contextWindow,
			maxTokens: registeredModel.maxTokens,
			baseUrl: registeredModel.baseUrl,
		})),
	});
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false, agentCallable: false },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 5_000 } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: join(root, "faux-agent"),
		settingsManager,
		extensionFactories: [createStockInterfaceParityProviderBudgetExtension(providerTracker, null, 1)],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
		systemPrompt: "One-call CompilerGym visibility continuation fixture.",
	});
	await resourceLoader.reload();
	const sessionManager = SessionManager.create(workspace, sessionDir);
	sessionManager.newSession({ id: "visibility-faux-continuation" });
	sessionManager.flushNow();
	const request: StockCpuEvaluationRequest = {
		actions: [guides.controlFlags[0]!],
		hypothesis: "one faux candidate",
		mechanism: "exercise the one-call continuation boundary",
		predictedOutcome: "one verified tool result then a local abort",
		boundaryConditions: [],
	};
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall(tool.name, request, { id: "visibility-tool-call-1" }), {
			stopReason: "toolUse",
		}),
	]);
	const events: AgentSessionEvent[] = [];
	const { session } = await createAgentSession({
		cwd: workspace,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: "off",
		serviceTier: "default",
		settingsManager,
		sessionManager,
		resourceLoader,
		tools: [tool.name],
		customTools: [tool],
		includeGoals: false,
		includeCompactSkill: false,
	});
	const sessionFile = session.sessionFile;
	assert.ok(sessionFile);
	const unsubscribe = session.subscribe((event) => events.push(structuredClone(event)));
	try {
		await session.promptAndWait("Submit exactly one candidate.");
	} finally {
		unsubscribe();
		sessionManager.flushNow();
		await session.disposeAsync();
		faux.unregister();
	}
	controller.verifyLedger();
	const runtimeMessages = events.flatMap((event) =>
		event.type === "message_end" && event.message.role === "assistant"
			? [structuredClone(event.message) as AssistantMessage]
			: [],
	);
	const durableMessages = persistedAssistantMessages(await readFile(sessionFile, "utf8"));
	return {
		adapter,
		durableMessages,
		events,
		fauxCallCount: faux.state.callCount,
		providerTracker,
		runtimeMessages,
		trace,
	};
}

describe("CompilerGym action-space visibility first-proposal runner", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	for (const drawHex of ["00".repeat(16), "01".repeat(16)]) {
		it(`runs the sealed six-allocation pair in the locally sampled ${drawHex.startsWith("00") ? "control-first" : "treatment-first"} order`, async () => {
			const test = await harness({ drawHex });
			roots.push(test.root);
			const result = await test.run();
			assert.equal(result.runtimeMode, "test-only-injected-runtime");
			assert.equal(result.liveScientificEvidenceEligible, false);
			assert.equal(result.causalClaimAllowed, false);
			assert.equal(result.randomizedInferenceAllowed, false);
			assert.equal(result.tamperEvidentRandomAssignment, false);
			assert.equal(test.preregistration.randomizedInferenceAllowed, false);
			assert.equal(test.preregistration.tamperEvidentRandomAssignment, false);
			assert.equal(test.preregistration.executionOrder.randomizedInferenceAllowed, false);
			assert.equal(test.preregistration.executionOrder.tamperEvidentRandomAssignment, false);
			assert.equal(test.preregistration.executionOrder.externalCommitmentBeforeRun, false);
			assert.equal(test.preregistration.executionOrder.selectionBiasCannotBeExcluded, true);
			assert.equal(result.ok, true, result.failure ?? "visibility pair unexpectedly failed");
			assert.equal(result.disposition, "directionally-promising-requires-fresh-replication");
			assert.deepEqual(result.sampledArmOrder, test.preregistration.executionOrder.armOrder);
			assert.equal(result.providerDispatchesTotal, 2);
			assert.equal(result.candidateEvaluationsTotal, 2);
			assert.equal(result.freshTaskEvaluationsTotal, 4);
			assert.equal(result.sharedS12?.providerDispatches, 0);
			assert.equal(result.sharedS12?.job?.measurement?.tasks.length, 2);
			assert.equal(result.sharedS12?.measurementEvidence?.allocations.length, 2);
			const allocations = [
				...(result.sharedS12?.measurementEvidence?.allocations ?? []),
				...Object.values(result.arms).flatMap((arm) => arm.measurementEvidence?.allocations ?? []),
			];
			assert.equal(allocations.length, 6);
			assert.equal(new Set(allocations.map((value) => value.slurmId)).size, 6);
			assert.equal(new Set(allocations.map((value) => value.transientCache)).size, 6);
			assert.equal(new Set(allocations.map((value) => value.jobName)).size, 6);
			for (const arm of Object.values(result.arms)) {
				assert.equal(arm.providerDispatches, 1);
				assert.equal(arm.blockedProviderRequests, 1);
				assert.deepEqual(arm.blockedProviderReasons, ["provider-call-limit"]);
				assert.equal(arm.candidateEvaluations, 1);
				assert.equal(arm.freshTaskEvaluations, 2);
			}
			assert.deepEqual(
				test.remote.installed.map((value) => value.path),
				[
					test.preregistration.remoteLocks.sharedS12GatePath,
					test.preregistration.remoteLocks.globalPath,
					...test.preregistration.executionOrder.armOrder.map(
						(arm) => test.preregistration.remoteLocks.armPaths[arm],
					),
				],
			);
			assert.ok(test.remote.installed.every((value) => !value.allowExistingExact && value.mode === 0o600));
			const firstInstallIndex = test.remote.operations.findIndex(
				(operation) =>
					operation.kind === "install" && operation.path === test.preregistration.remoteLocks.sharedS12GatePath,
			);
			assert.ok(firstInstallIndex >= 2);
			assert.deepEqual(test.remote.operations.slice(firstInstallIndex - 2, firstInstallIndex), [
				{ kind: "ensure", path: test.preregistration.remoteLocks.parentRoot },
				{ kind: "ensure", path: test.preregistration.remoteLocks.root },
			]);
			assert.equal(result.postflightImplementationBundleSha256, test.preregistration.implementationBundleSha256);
			assert.equal(
				result.postflightRuntimeWorktreeSnapshotSha256,
				test.preregistration.runtimeWorktreeClosure.snapshotSha256,
			);
			const ledger = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
			const claim = ledger.find(
				(event) => (event.payload as Record<string, unknown>).type === "visibility_pair_assessment",
			)?.payload as Record<string, unknown> | undefined;
			assert.equal(claim?.runtimeMode, "test-only-injected-runtime");
			assert.equal(claim?.liveScientificEvidenceEligible, false);
			assert.equal(claim?.randomizedInferenceAllowed, false);
			assert.equal(claim?.tamperEvidentRandomAssignment, false);
			const terminal = ledger.at(-1)?.payload as Record<string, unknown>;
			assert.equal(terminal.type, "visibility_pair_end");
			assert.equal(terminal.runtimeMode, "test-only-injected-runtime");
			assert.equal(terminal.liveScientificEvidenceEligible, false);
			assert.equal(terminal.randomizedInferenceAllowed, false);
			assert.equal(terminal.tamperEvidentRandomAssignment, false);
			assert.equal((await stat(join(test.outputDir, "result.json"))).mode & 0o777, 0o600);
			const persisted = JSON.parse(await readFile(join(test.outputDir, "result.json"), "utf8")) as Record<
				string,
				unknown
			>;
			assert.equal(persisted.liveScientificEvidenceEligible, false);
			assert.equal(persisted.randomizedInferenceAllowed, false);
			assert.equal(persisted.tamperEvidentRandomAssignment, false);
		});
	}

	it("rejects incomplete, inherited, hidden, accessor, or undefined test dependencies before local or remote effects", async () => {
		const test = await harness({ drawHex: "00".repeat(16) });
		roots.push(test.root);
		const cases: Array<{
			name: string;
			dependencies: CompilerGymActionSpaceVisibilityRunnerDependencies;
			pattern: RegExp;
		}> = [];
		cases.push({
			name: "marker-only",
			dependencies: { testOnlyInjectedRuntime: true },
			pattern: /lacks complete fake external boundaries/,
		});
		cases.push({
			name: "partial",
			dependencies: { testOnlyInjectedRuntime: true, remoteFileSystem: test.remote },
			pattern: /lacks complete fake external boundaries/,
		});
		cases.push({
			name: "explicit-undefined",
			dependencies: { ...test.dependencies, runArm: undefined },
			pattern: /lacks complete fake external boundaries: runArm/,
		});
		cases.push({
			name: "inherited",
			dependencies: Object.create(test.dependencies) as CompilerGymActionSpaceVisibilityRunnerDependencies,
			pattern: /must not inherit injected values/,
		});
		const nonEnumerable = { ...test.dependencies };
		Object.defineProperty(nonEnumerable, "now", {
			value: test.dependencies.now,
			enumerable: false,
			configurable: true,
		});
		cases.push({
			name: "non-enumerable",
			dependencies: nonEnumerable,
			pattern: /must be an enumerable own data property: now/,
		});
		let accessorReads = 0;
		const accessor = { ...test.dependencies };
		Object.defineProperty(accessor, "now", {
			get: () => {
				accessorReads++;
				return test.dependencies.now;
			},
			enumerable: true,
			configurable: true,
		});
		cases.push({
			name: "accessor",
			dependencies: accessor,
			pattern: /must be an enumerable own data property: now/,
		});
		const symbolKey = { ...test.dependencies };
		Object.defineProperty(symbolKey, Symbol("hidden-boundary"), { value: test.remote, enumerable: true });
		cases.push({
			name: "symbol",
			dependencies: symbolKey,
			pattern: /may not contain symbol keys/,
		});
		for (const testCase of cases) {
			await assert.rejects(test.runWithDependencies(testCase.dependencies), testCase.pattern, testCase.name);
			await assert.rejects(access(test.outputDir), `${testCase.name} created the output directory`);
			assert.deepEqual(test.remote.attemptedPaths, [], testCase.name);
			assert.equal(test.adapterFactoryCalls.value, 0, testCase.name);
			assert.equal(test.armRunnerCalls.value, 0, testCase.name);
		}
		assert.equal(accessorReads, 0);
	});

	it("snapshots complete test boundaries synchronously against post-call mutation", async () => {
		const test = await harness({ drawHex: "00".repeat(16) });
		roots.push(test.root);
		const dependencies = { ...test.dependencies };
		const unusedRemote = new FauxRemoteLocks();
		const pending = test.runWithDependencies(dependencies);
		dependencies.remoteFileSystem = unusedRemote;
		dependencies.adapterFactory = () => {
			throw new Error("mutated adapter factory executed");
		};
		dependencies.liveEnvironmentGate = async () => {
			throw new Error("mutated live gate executed");
		};
		dependencies.runArm = async () => {
			throw new Error("mutated arm runner executed");
		};
		const result = await pending;
		assert.equal(result.disposition, "directionally-promising-requires-fresh-replication");
		assert.equal(result.providerDispatchesTotal, 2);
		assert.equal(test.armRunnerCalls.value, 2);
		assert.equal(test.adapterFactoryCalls.value, 3);
		assert.equal(test.remote.installed.length, 4);
		assert.equal(unusedRemote.attemptedPaths.length, 0);
	});

	it("stops before S12 evaluation or provider work when the paid-lock parent cannot be ensured", async () => {
		const test = await harness({ drawHex: "00".repeat(16) });
		roots.push(test.root);
		test.remote.failEnsurePath = test.preregistration.remoteLocks.parentRoot;
		const result = await test.run();
		assert.equal(result.disposition, "terminal-apparatus-invalid");
		assert.match(result.failure ?? "", /faux ensure directory failed/);
		assert.equal(result.providerDispatchesTotal, 0);
		assert.equal(test.adapterFactoryCalls.value, 0);
		assert.equal(test.armRunnerCalls.value, 0);
		assert.deepEqual(test.remote.attemptedPaths, []);
		assert.deepEqual(test.remote.installed, []);
		assert.equal(result.sharedS12, null);
		assert.equal(result.remoteLocks.length, 0);
		assert.deepEqual(test.remote.operations.at(-1), {
			kind: "ensure",
			path: test.preregistration.remoteLocks.parentRoot,
		});
		assert.equal(
			test.remote.operations.some(
				(operation) => operation.kind === "ensure" && operation.path === test.preregistration.remoteLocks.root,
			),
			false,
		);
	});

	it("enforces the shared scientific S12 lock across distinct local preregistrations without retry", async () => {
		const remote = new FauxRemoteLocks();
		const first = await harness({ drawHex: "00".repeat(16), remote });
		roots.push(first.root);
		const firstResult = await first.run();
		assert.equal(firstResult.disposition, "directionally-promising-requires-fresh-replication");
		const sharedLockPath = first.preregistration.remoteLocks.sharedS12GatePath;
		const firstLockContents = remote.files.get(sharedLockPath);
		assert.ok(firstLockContents);

		const second = await harness({ drawHex: "00".repeat(16), remote });
		roots.push(second.root);
		assert.notEqual(second.preregistrationPath, first.preregistrationPath);
		assert.notEqual(second.outputDir, first.outputDir);
		assert.equal(
			second.preregistration.remoteLocks.scientificIdentitySha256,
			first.preregistration.remoteLocks.scientificIdentitySha256,
		);
		const secondResult = await second.run();
		assert.equal(secondResult.disposition, "terminal-apparatus-invalid");
		assert.match(secondResult.failure ?? "", /create-only lock already exists/);
		assert.equal(secondResult.providerDispatchesTotal, 0);
		assert.equal(second.preregistration.budgets.retries, 0);
		assert.equal(second.preregistration.budgets.replacements, 0);
		assert.equal(second.adapterFactoryCalls.value, 0);
		assert.equal(second.armRunnerCalls.value, 0);
		assert.equal(remote.files.get(sharedLockPath), firstLockContents);
		assert.equal(remote.attemptedPaths.filter((path) => path === sharedLockPath).length, 2);
	});

	it("blocks a preseeded paid-arm lock before that arm runner or provider without retry", async () => {
		const test = await harness({ drawHex: "00".repeat(16) });
		roots.push(test.root);
		const firstArm = test.preregistration.executionOrder.armOrder[0];
		const paidArmPath = test.preregistration.remoteLocks.armPaths[firstArm];
		const preseeded = "preseeded-scientific-attempt\n";
		test.remote.files.set(paidArmPath, preseeded);
		const result = await test.run();
		assert.equal(result.disposition, "terminal-apparatus-invalid");
		assert.match(result.failure ?? "", /create-only lock already exists/);
		assert.equal(result.providerDispatchesTotal, 0);
		assert.equal(test.preregistration.budgets.retries, 0);
		assert.equal(test.preregistration.budgets.replacements, 0);
		assert.equal(test.armRunnerCalls.value, 0);
		assert.equal(test.adapterFactoryCalls.value, 1);
		assert.equal(test.remote.files.get(paidArmPath), preseeded);
		assert.equal(test.remote.attemptedPaths.filter((path) => path === paidArmPath).length, 1);
		assert.equal(
			test.remote.attemptedPaths.includes(
				test.preregistration.remoteLocks.armPaths[test.preregistration.executionOrder.armOrder[1]],
			),
			false,
		);
	});

	it("stops after a failed zero-model S12 gate before pair or arm locks and provider calls", async () => {
		const test = await harness({ drawHex: "00".repeat(16), s12Pass: false });
		roots.push(test.root);
		const result = await test.run();
		assert.equal(result.disposition, "terminal-apparatus-invalid");
		assert.equal(result.providerDispatchesTotal, 0);
		assert.equal(result.candidateEvaluationsTotal, 0);
		assert.deepEqual(
			result.remoteLocks.map((lock) => lock.kind),
			["shared-s12-gate"],
		);
		assert.deepEqual(
			test.remote.installed.map((lock) => lock.path),
			[test.preregistration.remoteLocks.sharedS12GatePath],
		);
		assert.equal(test.remote.files.has(test.preregistration.remoteLocks.globalPath), false);
		assert.equal(Object.keys(result.arms).length, 0);
	});

	it("classifies schema, no-tool, multi-tool, wrong-tool, empty, illegal, and over-cap responses as terminal policy outcomes", async () => {
		for (const policy of ["schema", "no-tool", "multi-tool", "wrong-tool", "empty", "illegal", "overcap"] as const) {
			const test = await harness({
				drawHex: "00".repeat(16),
				armScenario: { policy: { [COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM]: policy } },
			});
			roots.push(test.root);
			const result = await test.run();
			const treatment = result.arms[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM];
			assert.equal(treatment?.disposition, "policy-nonconformant", policy);
			assert.deepEqual(treatment?.policyFailures, [POLICY_FAILURES[policy]], policy);
			assert.equal(result.disposition, "directional-loss", policy);
			assert.equal(result.providerDispatchesTotal, 2, policy);
			assert.equal(treatment?.candidateEvaluations, 0, policy);
			assert.equal(treatment?.freshTaskEvaluations, 0, policy);
			assert.equal(
				result.remoteLocks.filter((lock) => lock.arm === COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM).length,
				1,
			);
		}
	});

	it("host-classifies malformed, illegal, over-cap, and repeated tool calls without evaluation", async () => {
		const evaluator = await readFile(EVALUATOR_PATH, "utf8");
		const guides = reconstructCompilerGymActionSpaceVisibilityGuides(evaluator);
		const malformedCases: Array<{ name: string; params: unknown; pattern: RegExp }> = [
			{
				name: "schema",
				params: { actions: [guides.controlFlags[0]] },
				pattern: /Request keys mismatch/,
			},
			{
				name: "illegal",
				params: {
					actions: ["-not-legal"],
					hypothesis: "illegal",
					mechanism: "illegal",
					predictedOutcome: "illegal",
					boundaryConditions: [],
				},
				pattern: /illegal LLVM pass/,
			},
			{
				name: "empty",
				params: {
					actions: [],
					hypothesis: "empty",
					mechanism: "empty",
					predictedOutcome: "empty",
					boundaryConditions: [],
				},
				pattern: /between one and 256/,
			},
			{
				name: "overcap",
				params: {
					actions: Array.from({ length: 257 }, () => guides.controlFlags[0]),
					hypothesis: "overcap",
					mechanism: "overcap",
					predictedOutcome: "overcap",
					boundaryConditions: [],
				},
				pattern: /at most 256/,
			},
		];
		for (const testCase of malformedCases) {
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
				controller: {} as ResearchController,
				allowedFlags: guides.allowedFlags,
				trace,
			});
			await assert.rejects(
				tool.execute(
					`call-${testCase.name}`,
					testCase.params as Parameters<typeof tool.execute>[1],
					undefined,
					undefined,
					{} as Parameters<typeof tool.execute>[4],
				),
				testCase.pattern,
			);
			assert.equal(trace.toolFailureKind, "policy");
			assert.equal(trace.toolExecutions, 0);
		}

		const repeatedTrace: CompilerGymActionSpaceVisibilityOneCallToolTrace = {
			toolCallAttempts: 0,
			toolExecutions: 0,
			duplicateCandidates: 0,
			request: null,
			job: null,
			toolFailureKind: null,
			toolFailure: null,
		};
		const repeatedTool = createCompilerGymActionSpaceVisibilityOneCallTool({
			controller: {} as ResearchController,
			allowedFlags: guides.allowedFlags,
			trace: repeatedTrace,
		});
		const malformed = { actions: [guides.controlFlags[0]] } as Parameters<typeof repeatedTool.execute>[1];
		await assert.rejects(
			repeatedTool.execute(
				"first",
				malformed,
				undefined,
				undefined,
				{} as Parameters<typeof repeatedTool.execute>[4],
			),
			/Request keys mismatch/,
		);
		await assert.rejects(
			repeatedTool.execute(
				"second",
				malformed,
				undefined,
				undefined,
				{} as Parameters<typeof repeatedTool.execute>[4],
			),
			/more than one tool call/,
		);
		assert.equal(repeatedTrace.toolCallAttempts, 2);
		assert.equal(repeatedTrace.toolExecutions, 0);
	});

	it("creates the exact zero-usage blocked continuation at the real faux provider boundary", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-visibility-real-continuation-"));
		roots.push(root);
		const result = await actualFauxBlockedContinuation(root);
		assert.equal(result.fauxCallCount, 1);
		assert.equal(result.adapter.calls, 1);
		assert.equal(result.trace.toolCallAttempts, 1);
		assert.equal(result.trace.toolExecutions, 1);
		assert.equal(result.providerTracker.providerCalls, 1);
		assert.equal(result.providerTracker.blockedProviderCalls, 1);
		assert.deepEqual(result.providerTracker.blockedReasons, ["provider-call-limit"]);
		assert.equal(result.runtimeMessages.length, 2);
		assert.equal(result.durableMessages.length, 2);
		assertExactBlockedContinuation(result.runtimeMessages[1]!);
		assertExactBlockedContinuation(result.durableMessages[1]!);
		assert.equal(result.events.filter((event) => event.type === "tool_execution_start").length, 1);
		assert.equal(result.events.filter((event) => event.type === "tool_execution_end").length, 1);
		assert.equal(
			result.events.some((event) => event.type === "compaction_start" || event.type === "compaction_end"),
			false,
		);
	});

	it("maps a control-arm policy nonconformance to inconclusive without retry", async () => {
		const test = await harness({
			drawHex: "00".repeat(16),
			armScenario: { policy: { [COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]: "wrong-tool" } },
		});
		roots.push(test.root);
		const result = await test.run();
		const control = result.arms[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM];
		assert.equal(control?.disposition, "policy-nonconformant");
		assert.equal(control?.candidateEvaluations, 0);
		assert.equal(control?.freshTaskEvaluations, 0);
		assert.equal(result.providerDispatchesTotal, 2);
		assert.equal(result.disposition, "inconclusive");
	});

	it("requires a verified control before interpreting treatment direction", async () => {
		const test = await harness({
			drawHex: "00".repeat(16),
			armScenario: { controlSemanticRejection: true },
		});
		roots.push(test.root);
		const result = await test.run();
		assert.equal(
			result.arms[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM]?.candidate?.outcome,
			"complete-semantic-rejection",
		);
		assert.equal(result.assessment?.controlVerified, false);
		assert.equal(result.disposition, "inconclusive");
	});

	it("fails closed on allocation reuse and output-token overshoot", async () => {
		const reused = await harness({
			drawHex: "00".repeat(16),
			armScenario: { duplicateAllocation: true },
		});
		roots.push(reused.root);
		const reusedResult = await reused.run();
		assert.equal(reusedResult.disposition, "terminal-apparatus-invalid");
		assert.match(reusedResult.failure ?? "", /reused a Slurm allocation/);

		const overshoot = await harness({
			drawHex: "00".repeat(16),
			armScenario: { overshootArm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM },
		});
		roots.push(overshoot.root);
		const overshootResult = await overshoot.run();
		assert.equal(overshootResult.disposition, "terminal-apparatus-invalid");
		assert.match(overshootResult.failure ?? "", /exceeded the output-token limit/);
		assert.equal(overshootResult.providerDispatchesTotal, 1);
		assert.equal(overshootResult.remoteLocks.filter((lock) => lock.kind === "paid-arm").length, 1);
		await access(join(overshoot.outputDir, "result.json"));
	});

	it("rejects nonzero or wrongly labelled blocked-continuation sentinels", async () => {
		for (const badBlockedContinuation of ["nonzero-usage", "wrong-error"] as const) {
			const test = await harness({
				drawHex: "00".repeat(16),
				armScenario: { badBlockedContinuation },
			});
			roots.push(test.root);
			const result = await test.run();
			assert.equal(result.disposition, "terminal-apparatus-invalid", badBlockedContinuation);
			assert.match(result.failure ?? "", /admitted evidence is incomplete/, badBlockedContinuation);
			assert.equal(result.providerDispatchesTotal, 1, badBlockedContinuation);
		}
	});

	it("binds the shared S12 epoch into the persisted result", async () => {
		const test = await harness({ drawHex: "00".repeat(16) });
		roots.push(test.root);
		const result = await test.run();
		assert.equal(result.sharedS12?.epoch, COMPILER_GYM_ACTION_SPACE_VISIBILITY_SHARED_S12_EPOCH);
		const persisted = JSON.parse(await readFile(join(test.outputDir, "result.json"), "utf8")) as Record<
			string,
			unknown
		>;
		assert.equal(persisted.ledgerSha256, result.ledgerSha256);
		assert.equal(persisted.postflightImplementationBundleSha256, result.postflightImplementationBundleSha256);
		assert.equal(persisted.postflightRuntimeWorktreeSnapshotSha256, result.postflightRuntimeWorktreeSnapshotSha256);
	});
});

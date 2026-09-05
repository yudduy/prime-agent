import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	assertCompilerGymIrDeltaScreenRequestPolicy,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	CompilerGymIrDeltaScreenEvaluationSchema,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	assessCompilerGymLateNoveltyAccounting,
	createCompilerGymLateNoveltyPreDispatchProviderGate,
} from "../src/compiler-gym-late-novelty-screen-runner.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_STDOUT,
	runCompilerGymPaidLiveEnvironmentGate,
} from "../src/compiler-gym-paid-live-environment-gate.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { type ControllerOptions, ResearchController } from "../src/controller.js";
import { createHostOwnedTerminalizationRuntimeTracker } from "../src/host-owned-terminalization.js";
import {
	expectedStockCpuProvenance,
	parseStockCpuEvaluationRequest,
	STOCK_CPU_MAX_SUBMISSIONS,
	STOCK_CPU_TASKS,
	type StockCpuEvaluationRequest,
} from "../src/stock-cpu-protocol.js";
import {
	createStockInterfaceParityProviderBoundBeforeSubmit,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
	STOCK_INTERFACE_PARITY_SAME_RESPONSE_LATCH_ERROR,
	type StockInterfaceParityProviderRequestGate,
} from "../src/stock-interface-parity.js";
import {
	createStockInterfaceParityTool,
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	STOCK_INTERFACE_PARITY_TREATMENT,
	type StockInterfaceParityToolTrace,
} from "../src/stock-interface-parity-protocol.js";
import type { EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome } from "../src/types.js";

const BRANCH_ID = "late-novelty-same-response-runtime";
const SCHEMA_POLICY_ERROR = "scientific-policy-nonconformance: actions must contain from 1 through 46 flags";
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const tempDirectories: string[] = [];

class CountingAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls++;
		return Promise.resolve({
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: job.benchmarkIds.map((benchmarkId, index) => ({
				benchmarkId,
				status: "accepted",
				metrics: { IrInstructionCount: 2_000 + index, ObjectTextSizeBytes: 10_000 + index },
				verifier: { passed: true, checks: ["faux-runtime"], errors: [] },
				runtimeMs: 1,
			})),
			hardware: { host: "faux-runtime" },
			provenance: expectedStockCpuProvenance("1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266"),
		});
	}
}

class FauxLiveEnvironmentCommandRunner implements CompilerGymWarmCommandRunner {
	readonly requests: CompilerGymWarmCommandRequest[] = [];

	run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		this.requests.push(request);
		return Promise.resolve({
			exitCode: 0,
			stdout: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_STDOUT,
			stderr: "",
			wallMs: 17,
		});
	}
}

function controllerOptions(root: string, adapter: EvaluationAdapter): ControllerOptions {
	return {
		ledgerPath: join(root, "evidence.jsonl"),
		artifactDir: join(root, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: { "compiler-gym": STOCK_CPU_TASKS, kernelbench: [], nanogpt: [] },
		allowedTreatments: [STOCK_INTERFACE_PARITY_TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: STOCK_CPU_MAX_SUBMISSIONS,
		maxTaskEvaluationsPerBranch: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
	};
}

function overlongRequest(): StockCpuEvaluationRequest {
	return {
		...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
		actions: Array.from({ length: 47 }, (_, index) => (index % 2 === 0 ? "-adce" : "-dce")),
		hypothesis: "Reject this over-limit proposal before evaluation.",
	};
}

function toolResultText(event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>): string {
	if (typeof event.result !== "object" || event.result === null) return "";
	const content = (event.result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((item): item is { type: "text"; text: string } =>
			Boolean(item && typeof item === "object" && (item as { type?: unknown }).type === "text"),
		)
		.map((item) => item.text)
		.join("\n");
}

async function runMultipleResponse(
	order: "invalid-valid" | "valid-invalid",
	providerRequestGate?: StockInterfaceParityProviderRequestGate,
) {
	const root = await mkdtemp(join(tmpdir(), "prime-late-novelty-runtime-"));
	tempDirectories.push(root);
	const adapter = new CountingAdapter();
	const controller = await ResearchController.open(controllerOptions(join(root, "evaluation"), adapter));
	const providerTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
	};
	const hostTracker = createHostOwnedTerminalizationRuntimeTracker();
	const trace: StockInterfaceParityToolTrace = {
		callCount: 0,
		duplicateCount: 0,
		evaluatorWaitMs: 0,
		jobIds: [],
		requests: [],
		modelFeedbackBytes: [],
	};
	const tool = createStockInterfaceParityTool(controller, trace, {
		hostOwnsTerminalization: true,
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		evaluationSchema: CompilerGymIrDeltaScreenEvaluationSchema,
		prepareArguments: (args) => {
			const request = parseStockCpuEvaluationRequest(args);
			assertCompilerGymIrDeltaScreenRequestPolicy(providerTracker.providerCalls, request);
			return request;
		},
		beforeSubmit: createStockInterfaceParityProviderBoundBeforeSubmit(trace, providerTracker),
	});
	const faux = registerFauxProvider({
		provider: `faux-late-novelty-latch-${order}-${process.pid}-${root.split("/").at(-1)}`,
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
		models: faux.models,
	});
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false, agentCallable: false },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 5_000 } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir: join(root, "agent"),
		settingsManager,
		extensionFactories: [
			createStockInterfaceParityProviderBudgetExtension(
				providerTracker,
				hostTracker,
				STOCK_CPU_MAX_SUBMISSIONS,
				true,
				providerRequestGate,
				undefined,
				true,
			),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
		systemPrompt: "Bounded late-novelty same-response policy test.",
	});
	await resourceLoader.reload();
	const sessionManager = SessionManager.inMemory(root);
	Object.defineProperty(sessionManager, "getSessionId", { value: () => BRANCH_ID });
	const { session } = await createAgentSession({
		cwd: root,
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
	const events: AgentSessionEvent[] = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	const valid = structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST);
	const invalid = overlongRequest();
	const calls = order === "invalid-valid" ? [invalid, valid] : [valid, invalid];
	faux.setResponses([
		fauxAssistantMessage(
			calls.map((request, index) =>
				fauxToolCall(STOCK_INTERFACE_PARITY_TOOL_NAME, request, { id: `call_1_${index}|fc_1_${index}` }),
			),
			{ stopReason: "toolUse" },
		),
	]);
	try {
		await session.promptAndWait("Execute the bounded fixture.");
	} finally {
		unsubscribe();
		await session.disposeAsync();
		faux.unregister();
	}
	const toolEnds = events.filter(
		(event): event is Extract<AgentSessionEvent, { type: "tool_execution_end" }> =>
			event.type === "tool_execution_end",
	);
	const assistantResponses = events.filter(
		(event) => event.type === "message_end" && event.message.role === "assistant",
	).length;
	return {
		adapter,
		controller,
		providerTracker,
		hostTracker,
		trace,
		toolEnds,
		assistantResponses,
		providerTransportCalls: faux.state.callCount,
	};
}

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CompilerGym prospective late-novelty same-response runtime latch", () => {
	it("runs the exact read-only login-node environment seal without Slurm", async () => {
		const commandRunner = new FauxLiveEnvironmentCommandRunner();
		const evidence = await runCompilerGymPaidLiveEnvironmentGate({ repoRoot: REPO_ROOT, commandRunner });
		assert.equal(evidence.pass, true);
		assert.equal(evidence.wallMs, 17);
		assert.match(evidence.stdoutSha256, /^[a-f0-9]{64}$/);
		assert.equal(commandRunner.requests.length, 1);
		const request = commandRunner.requests[0]!;
		assert.equal(request.argv[0], "ssh");
		assert.equal(request.input, undefined);
		const remoteCommand = request.argv.at(-1) ?? "";
		assert.match(remoteCommand, /^'\/usr\/bin\/env' '-i' /);
		assert.doesNotMatch(remoteCommand, /'\/usr\/bin\/(?:srun|sbatch)'/);
		assert.match(remoteCommand, /COMPILER_GYM_SITE_DATA=/);
		assert.match(remoteCommand, /compiler_gym_env_probe\.py/);
	});

	it("records each successful live seal before allowing its provider dispatch", async () => {
		const evidence = await runCompilerGymPaidLiveEnvironmentGate({
			repoRoot: REPO_ROOT,
			commandRunner: new FauxLiveEnvironmentCommandRunner(),
		});
		const sequence: string[] = [];
		let aggregateProviderDispatches = 0;
		const providerRequestGate = createCompilerGymLateNoveltyPreDispatchProviderGate({
			maximumProviderDispatches: 8,
			currentProviderDispatches: () => aggregateProviderDispatches,
			liveEnvironmentGate: async () => {
				sequence.push("live");
				return evidence;
			},
			recordLiveEnvironmentGate: async (record, providerDispatchOrdinal) => {
				assert.equal(record.outcome, "passed");
				assert.deepEqual(record.evidence, evidence);
				sequence.push(`record-${providerDispatchOrdinal}`);
			},
			guardedProviderRequestGate: async (request) => {
				sequence.push(`guard-${request.providerDispatchOrdinal}`);
				return { allowed: true, reason: null };
			},
			recordProviderDispatch: () => {
				sequence.push("dispatch");
				aggregateProviderDispatches++;
			},
		});
		for (const providerDispatchOrdinal of [1, 2]) {
			assert.deepEqual(await providerRequestGate({ payload: {}, providerDispatchOrdinal }), {
				allowed: true,
				reason: null,
			});
		}
		assert.equal(aggregateProviderDispatches, 2);
		assert.deepEqual(sequence, [
			"live",
			"record-1",
			"guard-1",
			"dispatch",
			"live",
			"record-2",
			"guard-2",
			"dispatch",
		]);
	});

	it("keeps faux paid-provider and evaluator dispatches at zero when the live seal fails", async () => {
		let aggregateProviderDispatches = 0;
		let liveEnvironmentGateCalls = 0;
		const liveEnvironmentGateRecords: Array<{ outcome: string; failure: string | null; ordinal: number }> = [];
		let guardedProviderGateCalls = 0;
		const providerRequestGate = createCompilerGymLateNoveltyPreDispatchProviderGate({
			maximumProviderDispatches: 8,
			currentProviderDispatches: () => aggregateProviderDispatches,
			liveEnvironmentGate: async () => {
				liveEnvironmentGateCalls++;
				throw new Error("frozen FarmShare environment seal failed");
			},
			recordLiveEnvironmentGate: async (record, providerDispatchOrdinal) => {
				liveEnvironmentGateRecords.push({
					outcome: record.outcome,
					failure: record.failure,
					ordinal: providerDispatchOrdinal,
				});
			},
			guardedProviderRequestGate: async () => {
				guardedProviderGateCalls++;
				return { allowed: true, reason: null };
			},
			recordProviderDispatch: () => {
				aggregateProviderDispatches++;
			},
		});
		const run = await runMultipleResponse("valid-invalid", providerRequestGate);
		assert.equal(liveEnvironmentGateCalls, 1);
		assert.equal(liveEnvironmentGateRecords.length, 1);
		assert.equal(liveEnvironmentGateRecords[0]?.outcome, "failed");
		assert.equal(liveEnvironmentGateRecords[0]?.ordinal, 1);
		assert.match(liveEnvironmentGateRecords[0]?.failure ?? "", /frozen FarmShare environment seal failed/);
		assert.equal(guardedProviderGateCalls, 0);
		assert.equal(aggregateProviderDispatches, 0);
		assert.equal(run.providerTracker.providerCalls, 0);
		assert.equal(run.providerTransportCalls, 0);
		assert.equal(run.providerTracker.blockedProviderCalls, 1);
		assert.deepEqual(run.providerTracker.blockedReasons, ["apparatus-gate"]);
		assert.equal(run.adapter.calls, 0);
		assert.equal(run.trace.callCount, 0);
	});

	it("suppresses a valid second call after an invalid first call before evaluator dispatch", async () => {
		const run = await runMultipleResponse("invalid-valid");
		assert.equal(run.adapter.calls, 0);
		assert.equal(run.trace.callCount, 0);
		assert.equal(run.toolEnds.length, 2);
		assert.deepEqual(
			run.toolEnds.map((event) => event.isError),
			[true, true],
		);
		assert.deepEqual(run.toolEnds.map(toolResultText), [
			SCHEMA_POLICY_ERROR,
			STOCK_INTERFACE_PARITY_SAME_RESPONSE_LATCH_ERROR,
		]);
		assert.equal(run.hostTracker.forbiddenBoundaryEvents.length, 2);
		assert.deepEqual(
			assessCompilerGymLateNoveltyAccounting({
				policyPrefixKind: "multiple-tool-local-abort",
				providerCalls: run.providerTracker.providerCalls,
				blockedProviderCalls: run.providerTracker.blockedProviderCalls,
				blockedReasons: run.providerTracker.blockedReasons,
				evaluatorCalls: 0,
				requestCount: 0,
				jobIdCount: 0,
				feedbackCount: 0,
				jobCount: 0,
				submissions: 0,
				taskEvaluations: 0,
				actualTaskEvaluations: 0,
				reusedTaskEvaluations: 0,
				unevaluatedTaskEvaluations: 0,
				duplicateCount: 0,
				assistantResponseCount: run.assistantResponses,
				syntheticPolicyAbortCount: 1,
			}),
			{ complete: true, mode: "scientific-policy-prefix" },
		);
	});

	it("allows the valid first call and rejects an invalid second call without a second evaluator", async () => {
		const run = await runMultipleResponse("valid-invalid");
		assert.equal(run.adapter.calls, 1);
		assert.equal(run.trace.callCount, 1);
		assert.equal(run.toolEnds.length, 2);
		assert.deepEqual(
			run.toolEnds.map((event) => event.isError),
			[false, true],
		);
		assert.equal(toolResultText(run.toolEnds[1]!), SCHEMA_POLICY_ERROR);
		assert.equal(run.hostTracker.forbiddenBoundaryEvents.length, 1);
		const budget = run.controller.budgetStatus(BRANCH_ID);
		assert.equal(budget.submissions, 1);
		assert.equal(budget.actualTaskEvaluations, 2);
	});
});

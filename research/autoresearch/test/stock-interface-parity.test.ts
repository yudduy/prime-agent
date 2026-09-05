import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Compile } from "typebox/compile";
import { validateToolArguments } from "../../../packages/ai/src/utils/validation.js";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import { type ControllerOptions, ResearchController } from "../src/controller.js";
import { createHostOwnedTerminalizationRuntimeTracker } from "../src/host-owned-terminalization.js";
import {
	expectedStockCpuProvenance,
	parseStockCpuEvaluationRequest,
	STOCK_CPU_CHAMPION_POLICY,
	STOCK_CPU_MAX_SUBMISSIONS,
	STOCK_CPU_TASKS,
	type StockCpuCalibration,
	type StockCpuChampionSelection,
	type StockCpuEvaluationRequest,
} from "../src/stock-cpu-protocol.js";
import {
	computeStockInterfaceParityImplementationBundle,
	createStockInterfaceParityProviderBoundBeforeSubmit,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
	stockInterfaceParityProviderCallLimit,
} from "../src/stock-interface-parity.js";
import {
	assessStockInterfaceParityQuality,
	buildStockFeedbackProjectionPairPreregistration,
	buildStockInterfaceParityPrompt,
	createStockInterfaceParityEvaluationSchema,
	createStockInterfaceParityTool,
	openStockInterfaceParityController,
	parseStockFeedbackProjectionPairPreregistration,
	projectStockInterfaceFeedback,
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_ACTION_GUIDE,
	STOCK_INTERFACE_PARITY_PREREGISTRATION,
	STOCK_INTERFACE_PARITY_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT,
	STOCK_INTERFACE_PARITY_REFERENCE,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	STOCK_INTERFACE_PARITY_TREATMENT,
	type StockInterfaceParityEvaluationEnvelope,
	StockInterfaceParityEvaluationSchema,
	type StockInterfaceParityToolTrace,
} from "../src/stock-interface-parity-protocol.js";
import type {
	DeterministicMeasurementReuseContract,
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
} from "../src/types.js";

const BRANCH_ID = "stock-interface-parity-test";
const FAUX_HARDWARE = { host: "sealed-faux-cpu" } as const;
const FAUX_PROVENANCE = expectedStockCpuProvenance(STOCK_INTERFACE_PARITY_REFERENCE.evaluatorSha256);
const FAUX_REUSE_CONTRACT: DeterministicMeasurementReuseContract = {
	policy: "deterministic-verified-measurement-v1",
	contractKey: "stock-interface-parity-faux-v1",
	lane: "compiler-gym",
	verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
	hardware: FAUX_HARDWARE,
	provenance: FAUX_PROVENANCE,
	reusableMetricNames: ["IrInstructionCount", "ObjectTextSizeBytes"],
};

const CALIBRATION: StockCpuCalibration = {
	jobId: "job_d2c97c8e12747ed1463d1698",
	manifestDigest: "d2c97c8e12747ed1463d16985f9997aef3ec5958ed6418e9286d5cfe2ab4be6a",
	tasks: [
		{
			benchmarkId: STOCK_CPU_TASKS[0],
			irInstructionCount: 3_898,
			objectTextSizeBytes: 16_573,
			verifierPassed: true,
		},
		{
			benchmarkId: STOCK_CPU_TASKS[1],
			irInstructionCount: 28_748,
			objectTextSizeBytes: 122_613,
			verifierPassed: true,
		},
	],
	provenance: FAUX_PROVENANCE,
};

class DeterministicFauxCompilerGymAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	readonly deterministicMeasurementReuse = FAUX_REUSE_CONTRACT;
	calls = 0;
	taskEvaluations = 0;

	async evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls++;
		this.taskEvaluations += job.benchmarkIds.length;
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: job.benchmarkIds.map((benchmarkId, index) => ({
				benchmarkId,
				status: "accepted",
				metrics: {
					IrInstructionCount: index === 0 ? 2_100 : 16_000,
					ObjectTextSizeBytes: index === 0 ? 10_000 : 80_000,
				},
				verifier: { passed: true, checks: ["deterministic-faux"], errors: [] },
				runtimeMs: 1,
			})),
			hardware: { ...FAUX_HARDWARE },
			provenance: { ...FAUX_PROVENANCE },
		};
	}
}

function controllerOptions(root: string, adapter: EvaluationAdapter, now: () => Date): ControllerOptions {
	return {
		ledgerPath: join(root, "evidence.jsonl"),
		artifactDir: join(root, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": STOCK_CPU_TASKS,
			kernelbench: [],
			nanogpt: [],
		},
		allowedTreatments: [STOCK_INTERFACE_PARITY_TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: STOCK_CPU_MAX_SUBMISSIONS,
		maxTaskEvaluationsPerBranch: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
		now,
	};
}

function traceFixture(): StockInterfaceParityToolTrace {
	return {
		callCount: 0,
		duplicateCount: 0,
		evaluatorWaitMs: 0,
		jobIds: [],
		requests: [],
		modelFeedbackBytes: [],
	};
}

function providerTrackerFixture(): ProviderBudgetTracker {
	return {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
	};
}

function captureExtensionHandlers(extension: ReturnType<typeof createStockInterfaceParityProviderBudgetExtension>) {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const api = {
		on(eventName: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(eventName, handler);
		},
	};
	extension(api as unknown as Parameters<typeof extension>[0]);
	return handlers;
}

function requestFixture(index: number): StockCpuEvaluationRequest {
	return {
		actions: ["-mem2reg", "-instcombine"],
		hypothesis: `Fresh parity proposal ${index}`,
		mechanism: `Deterministic mechanism ${index}`,
		predictedOutcome: `Measured outcome ${index}`,
		boundaryConditions: [`Boundary ${index}`],
	};
}

async function invokeParityTool(
	tool: ReturnType<typeof createStockInterfaceParityTool>,
	request: StockCpuEvaluationRequest,
	callId: string,
): Promise<StockInterfaceParityEvaluationEnvelope> {
	const context = {
		sessionManager: { getSessionId: () => BRANCH_ID },
	} as unknown as Parameters<typeof tool.execute>[4];
	const result = await tool.execute(callId, request, undefined, undefined, context);
	assert.equal(result.content.length, 1);
	const content = result.content[0];
	assert.equal(content.type, "text");
	if (content.type !== "text") throw new Error("Parity tool must return one text envelope");
	const details = result.details as StockInterfaceParityEvaluationEnvelope;
	assert.deepEqual(JSON.parse(content.text), details);
	return details;
}

function selectionFixture(blowfishIr: number, bzip2Ir: number): StockCpuChampionSelection {
	const jobId = `job_${"a".repeat(24)}`;
	return {
		policy: STOCK_CPU_CHAMPION_POLICY,
		expectedVerifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		expectedProvenance: FAUX_PROVENANCE,
		calibrationJobId: CALIBRATION.jobId,
		eligibleCandidates: [
			{
				jobId,
				candidateDigest: "b".repeat(64),
				irInstructionCounts: {
					[STOCK_CPU_TASKS[0]]: blowfishIr,
					[STOCK_CPU_TASKS[1]]: bzip2Ir,
				},
				objectTextSizeBytes: {
					[STOCK_CPU_TASKS[0]]: 1,
					[STOCK_CPU_TASKS[1]]: 1,
				},
				normalizedIrRatios: [],
			},
		],
		excludedCandidates: [],
		paretoFrontierJobIds: [jobId],
		rankedParetoJobIds: [jobId],
		selectedJobId: jobId,
	};
}

describe("stock interface parity protocol", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("binds typed adapter output failures into the stock implementation bundle", async () => {
		const evaluatorScriptPath = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
		const errorSourcePath = fileURLToPath(new URL("../src/evaluation-adapter-output-error.ts", import.meta.url));
		const bundle = await computeStockInterfaceParityImplementationBundle({ evaluatorScriptPath });

		assert.equal(bundle.sourcePaths.includes(errorSourcePath), true);
		assert.equal(bundle.sourceHashes[errorSourcePath], sha256Text(await readFile(errorSourcePath, "utf8")));
	});

	it("keeps the default factory seam injectable without changing the stock controller contract", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-injected-adapter-"));
		tempDirs.push(root);
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await openStockInterfaceParityController(root, adapter);
		const trace = traceFixture();
		await invokeParityTool(createStockInterfaceParityTool(controller, trace), requestFixture(1), "injected-call");
		assert.equal(adapter.calls, 1);
		assert.equal(adapter.taskEvaluations, STOCK_CPU_TASKS.length);
		assert.equal(controller.statusForBranch(BRANCH_ID).length, 1);
		controller.verifyLedger();
	});

	it("rejects every request outside the one exact tool schema before dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-schema-"));
		tempDirs.push(root);
		let tick = 0;
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await ResearchController.open(
			controllerOptions(root, adapter, () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++))),
		);
		const trace = traceFixture();
		const tool = createStockInterfaceParityTool(controller, trace);
		const validator = Compile(StockInterfaceParityEvaluationSchema);
		const valid = requestFixture(1);
		const extra = { ...valid, benchmarks: [...STOCK_CPU_TASKS] };
		const missing = {
			actions: valid.actions,
			hypothesis: valid.hypothesis,
			predictedOutcome: valid.predictedOutcome,
			boundaryConditions: valid.boundaryConditions,
		};

		assert.equal(tool.name, STOCK_INTERFACE_PARITY_TOOL_NAME);
		assert.equal(tool.executionMode, "sequential");
		assert.equal(tool.parameters, StockInterfaceParityEvaluationSchema);
		assert.equal(validator.Check(valid), true);
		assert.equal(validator.Check(extra), false);
		assert.equal(validator.Check(missing), false);
		assert.throws(() => parseStockCpuEvaluationRequest(extra), /unknown=benchmarks/);
		assert.throws(() => parseStockCpuEvaluationRequest(missing), /missing=mechanism/);
		assert.throws(() => parseStockCpuEvaluationRequest({ ...valid, actions: ["mem2reg"] }), /Invalid LLVM pass flag/);

		const context = {
			sessionManager: { getSessionId: () => BRANCH_ID },
		} as unknown as Parameters<typeof tool.execute>[4];
		await assert.rejects(tool.execute("extra", extra, undefined, undefined, context), /unknown=benchmarks/);
		await assert.rejects(
			tool.execute("missing", missing as unknown as StockCpuEvaluationRequest, undefined, undefined, context),
			/missing=mechanism/,
		);
		await assert.rejects(
			tool.execute("bad-action", { ...valid, actions: ["mem2reg"] }, undefined, undefined, context),
			/Invalid LLVM pass flag/,
		);
		assert.equal(trace.callCount, 0);
		assert.equal(adapter.calls, 0);
		assert.deepEqual(controller.budgetStatus(BRANCH_ID).submissions, 0);
	});

	it("preserves the stock action cap while allowing a tighter injected schema", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-bounded-schema-"));
		tempDirs.push(root);
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await openStockInterfaceParityController(root, adapter);
		const trace = traceFixture();
		const boundedSchema = createStockInterfaceParityEvaluationSchema({ minItems: 1, maxItems: 46 });
		const tool = createStockInterfaceParityTool(controller, trace, { evaluationSchema: boundedSchema });
		const stockActions = StockInterfaceParityEvaluationSchema.properties.actions as unknown as Record<
			string,
			unknown
		>;
		const boundedActions = boundedSchema.properties.actions as unknown as Record<string, unknown>;

		assert.deepEqual(stockActions, { type: "array", items: { type: "string" }, maxItems: 256 });
		assert.deepEqual(boundedActions, {
			type: "array",
			items: { type: "string" },
			minItems: 1,
			maxItems: 46,
		});
		assert.equal(tool.parameters, boundedSchema);
		assert.doesNotThrow(() =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "bounded-valid",
				name: STOCK_INTERFACE_PARITY_TOOL_NAME,
				arguments: { ...requestFixture(1), actions: Array.from({ length: 46 }, () => "-adce") },
			}),
		);
		for (const actions of [[], Array.from({ length: 47 }, () => "-adce")]) {
			assert.throws(
				() =>
					validateToolArguments(tool, {
						type: "toolCall",
						id: `bounded-invalid-${actions.length}`,
						name: STOCK_INTERFACE_PARITY_TOOL_NAME,
						arguments: { ...requestFixture(1), actions },
					}),
				/Validation failed for tool "autoresearch_evaluate"/,
			);
		}
		assert.equal(trace.callCount, 0);
		assert.equal(adapter.calls, 0);
	});

	it("runs the async pre-submit guard before trace mutation or evaluator dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-guard-"));
		tempDirs.push(root);
		let tick = 0;
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await ResearchController.open(
			controllerOptions(root, adapter, () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++))),
		);
		const trace = traceFixture();
		let observedOrdinal: number | null = null;
		const tool = createStockInterfaceParityTool(controller, trace, {
			beforeSubmit: async (input) => {
				await Promise.resolve();
				observedOrdinal = input.submissionOrdinal;
				assert.equal(input.branchId, BRANCH_ID);
				assert.deepEqual(input.existingJobs, []);
				throw new Error("fixed first candidate mismatch");
			},
		});
		const context = {
			sessionManager: { getSessionId: () => BRANCH_ID },
		} as unknown as Parameters<typeof tool.execute>[4];

		await assert.rejects(
			tool.execute("guarded", requestFixture(1), undefined, undefined, context),
			/fixed first candidate mismatch/,
		);
		assert.equal(observedOrdinal, 1);
		assert.equal(trace.callCount, 0);
		assert.deepEqual(trace.requests, []);
		assert.deepEqual(trace.jobIds, []);
		assert.equal(adapter.calls, 0);
		assert.equal(controller.budgetStatus(BRANCH_ID).submissions, 0);
	});

	it("caps host-owned provider requests at four before network dispatch even after a tool error", async () => {
		assert.equal(stockInterfaceParityProviderCallLimit("assistant-reported"), 5);
		assert.equal(stockInterfaceParityProviderCallLimit("host-owned"), STOCK_CPU_MAX_SUBMISSIONS);
		const tracker = providerTrackerFixture();
		const hostTracker = createHostOwnedTerminalizationRuntimeTracker();
		const handlers = captureExtensionHandlers(
			createStockInterfaceParityProviderBudgetExtension(
				tracker,
				hostTracker,
				stockInterfaceParityProviderCallLimit("host-owned"),
			),
		);
		const beforeProviderRequest = handlers.get("before_provider_request") as (
			event: { payload: Record<string, unknown> },
			context: { abort: () => void },
		) => Promise<unknown>;
		const toolStart = handlers.get("tool_execution_start") as (event: {
			toolCallId: string;
			args: unknown;
		}) => unknown;
		const toolEnd = handlers.get("tool_execution_end") as (event: {
			toolCallId: string;
			toolName: string;
			result: unknown;
			isError: boolean;
		}) => unknown;
		const requestProvider = async (): Promise<boolean> => {
			let aborted = false;
			await beforeProviderRequest({ payload: {} }, { abort: () => (aborted = true) });
			return aborted;
		};

		assert.equal(await requestProvider(), false);
		toolStart({ toolCallId: "failed-tool", args: requestFixture(1) });
		toolEnd({
			toolCallId: "failed-tool",
			toolName: STOCK_INTERFACE_PARITY_TOOL_NAME,
			result: { error: "synthetic" },
			isError: true,
		});
		assert.equal(hostTracker.forbiddenBoundaryEvents.length, 1);
		assert.equal(await requestProvider(), false);
		assert.equal(await requestProvider(), false);
		assert.equal(await requestProvider(), false);
		assert.equal(await requestProvider(), true);
		assert.equal(tracker.providerCalls, STOCK_CPU_MAX_SUBMISSIONS);
		assert.equal(hostTracker.providerDispatches, STOCK_CPU_MAX_SUBMISSIONS);
		assert.equal(tracker.blockedProviderCalls, 1);
		assert.deepEqual(tracker.blockedReasons, ["provider-call-limit"]);
	});

	it("optionally stops the next provider request after a forbidden tool execution", async () => {
		const tracker = providerTrackerFixture();
		const hostTracker = createHostOwnedTerminalizationRuntimeTracker();
		const handlers = captureExtensionHandlers(
			createStockInterfaceParityProviderBudgetExtension(tracker, hostTracker, STOCK_CPU_MAX_SUBMISSIONS, true),
		);
		const beforeProviderRequest = handlers.get("before_provider_request") as (
			event: { payload: Record<string, unknown> },
			context: { abort: () => void },
		) => Promise<unknown>;
		const toolStart = handlers.get("tool_execution_start") as (event: {
			toolCallId: string;
			args: unknown;
		}) => unknown;
		const toolEnd = handlers.get("tool_execution_end") as (event: {
			toolCallId: string;
			toolName: string;
			result: unknown;
			isError: boolean;
		}) => unknown;
		let aborted = false;
		await beforeProviderRequest({ payload: {} }, { abort: () => (aborted = true) });
		assert.equal(aborted, false);
		toolStart({ toolCallId: "policy-error", args: requestFixture(1) });
		toolEnd({
			toolCallId: "policy-error",
			toolName: STOCK_INTERFACE_PARITY_TOOL_NAME,
			result: { error: "synthetic" },
			isError: true,
		});
		await beforeProviderRequest({ payload: {} }, { abort: () => (aborted = true) });
		assert.equal(aborted, true);
		assert.equal(tracker.providerCalls, 1);
		assert.deepEqual(tracker.blockedReasons, ["forbidden-tool-execution"]);
	});

	it("allows at most one evaluator dispatch per accepted provider response", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-provider-bound-"));
		tempDirs.push(root);
		let tick = 0;
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await ResearchController.open(
			controllerOptions(root, adapter, () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++))),
		);
		const trace = traceFixture();
		const providerTracker = { providerCalls: 2 };
		let delegateCalls = 0;
		const tool = createStockInterfaceParityTool(controller, trace, {
			beforeSubmit: createStockInterfaceParityProviderBoundBeforeSubmit(trace, providerTracker, async () => {
				delegateCalls++;
			}),
		});

		await invokeParityTool(tool, requestFixture(1), "provider-two-first-tool");
		await assert.rejects(
			invokeParityTool(tool, requestFixture(2), "provider-two-second-tool"),
			/distinct accepted provider response/,
		);
		assert.equal(trace.callCount, 1);
		assert.equal(adapter.calls, 1);
		assert.equal(delegateCalls, 1);

		providerTracker.providerCalls = 3;
		await invokeParityTool(tool, requestFixture(3), "provider-three-first-tool");
		assert.equal(trace.callCount, 2);
		assert.equal(adapter.calls, 2);
		assert.equal(delegateCalls, 2);
	});

	it("atomically consumes the provider response before an injected policy guard runs", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-provider-atomic-"));
		tempDirs.push(root);
		let tick = 0;
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await ResearchController.open(
			controllerOptions(root, adapter, () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++))),
		);
		const trace = traceFixture();
		const providerTracker = { providerCalls: 1 };
		let delegateCalls = 0;
		const tool = createStockInterfaceParityTool(controller, trace, {
			beforeSubmit: createStockInterfaceParityProviderBoundBeforeSubmit(trace, providerTracker, async () => {
				delegateCalls++;
				throw new Error("synthetic policy rejection");
			}),
		});

		await assert.rejects(
			invokeParityTool(tool, requestFixture(1), "provider-one-policy-error"),
			/synthetic policy rejection/,
		);
		await assert.rejects(
			invokeParityTool(tool, requestFixture(2), "provider-one-retry"),
			/distinct accepted provider response/,
		);
		assert.equal(delegateCalls, 1);
		assert.equal(trace.callCount, 0);
		assert.equal(adapter.calls, 0);
	});

	it("awaits an injected feedback projector without exposing authoritative details to mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-async-projector-"));
		tempDirs.push(root);
		let tick = 0;
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await ResearchController.open(
			controllerOptions(root, adapter, () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++))),
		);
		const trace = traceFixture();
		const request = requestFixture(1);
		const tool = createStockInterfaceParityTool(controller, trace, {
			feedbackProjector: async (details, context) => {
				await Promise.resolve();
				details.request.hypothesis = "projection-local mutation";
				return {
					type: "async_test_projection",
					branchId: context.branchId,
					submissionOrdinal: context.submissionOrdinal,
					hypothesis: details.request.hypothesis,
					jobId: details.job.jobId,
				};
			},
		});
		const context = {
			sessionManager: { getSessionId: () => BRANCH_ID },
		} as unknown as Parameters<typeof tool.execute>[4];
		const result = await tool.execute("projected", request, undefined, undefined, context);
		const content = result.content[0];
		assert.equal(content?.type, "text");
		if (content?.type !== "text") throw new Error("Projected result must be text");
		assert.deepEqual(JSON.parse(content.text), {
			type: "async_test_projection",
			branchId: BRANCH_ID,
			submissionOrdinal: 1,
			hypothesis: "projection-local mutation",
			jobId: (result.details as StockInterfaceParityEvaluationEnvelope).job.jobId,
		});
		const authoritative = result.details as StockInterfaceParityEvaluationEnvelope;
		assert.equal(authoritative.request.hypothesis, request.hypothesis);
		assert.equal(controller.statusForBranch(BRANCH_ID)[0].proposal.proposal.hypothesis, request.hypothesis);
		assert.equal(trace.modelFeedbackBytes[0], Buffer.byteLength(content.text));
	});

	it("makes four synchronous fresh calls across restart with eight task evaluations and linear lineage", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-fresh-"));
		tempDirs.push(root);
		let tick = 0;
		const now = () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++));
		const firstAdapter = new DeterministicFauxCompilerGymAdapter();
		const firstController = await ResearchController.open(controllerOptions(root, firstAdapter, now));
		const trace = traceFixture();
		const envelopes: StockInterfaceParityEvaluationEnvelope[] = [];
		let tool = createStockInterfaceParityTool(firstController, trace);

		envelopes.push(await invokeParityTool(tool, requestFixture(1), "call-1"));
		envelopes.push(await invokeParityTool(tool, requestFixture(2), "call-2"));
		assert.equal(firstAdapter.calls, 2);
		assert.equal(firstAdapter.taskEvaluations, 4);
		assert.equal(firstController.budgetStatus(BRANCH_ID).reusedTaskEvaluations, 0);

		const reopenedAdapter = new DeterministicFauxCompilerGymAdapter();
		const reopened = await ResearchController.open(controllerOptions(root, reopenedAdapter, now));
		assert.equal(reopenedAdapter.calls, 0);
		assert.equal(reopened.statusForBranch(BRANCH_ID).length, 2);
		assert.equal(
			reopened.statusForBranch(BRANCH_ID).every((job) => job.measurement?.reuse === undefined),
			true,
		);
		tool = createStockInterfaceParityTool(reopened, trace);
		envelopes.push(await invokeParityTool(tool, requestFixture(3), "call-3"));
		envelopes.push(await invokeParityTool(tool, requestFixture(4), "call-4"));

		assert.equal(firstAdapter.calls + reopenedAdapter.calls, 4);
		assert.equal(firstAdapter.taskEvaluations + reopenedAdapter.taskEvaluations, 8);
		assert.equal(trace.callCount, 4);
		assert.equal(trace.duplicateCount, 0);
		assert.deepEqual(trace.requests, [1, 2, 3, 4].map(requestFixture));
		assert.equal(new Set(trace.jobIds).size, 4);
		assert.equal(new Set(envelopes.map((envelope) => envelope.job.candidateDigest)).size, 1);

		for (const [index, envelope] of envelopes.entries()) {
			assert.equal(envelope.type, "typed_sync_compiler_gym_evaluation");
			assert.equal(envelope.protocolVersion, STOCK_INTERFACE_PARITY_PROTOCOL_VERSION);
			assert.equal(envelope.submitted.duplicate, false);
			assert.equal(envelope.job.jobId, envelope.submitted.jobId);
			assert.equal(envelope.job.manifestDigest, envelope.submitted.manifestDigest);
			assert.equal(envelope.job.state.status, "succeeded");
			assert.equal(envelope.job.measurement?.reuse, undefined);
			assert.deepEqual(
				envelope.job.measurement?.tasks.map((task) => [task.benchmarkId, task.status, task.verifier.passed]),
				STOCK_CPU_TASKS.map((benchmarkId) => [benchmarkId, "accepted", true]),
			);
			assert.deepEqual(envelope.job.parentJobIds, index === 0 ? [] : [envelopes[index - 1].job.jobId]);
			assert.equal(envelope.budget.submissions, index + 1);
			assert.equal(envelope.budget.actualTaskEvaluations, (index + 1) * STOCK_CPU_TASKS.length);
			assert.equal(envelope.budget.reusedTaskEvaluations, 0);
			assert.equal(envelope.budget.unevaluatedTaskEvaluations, 0);
		}

		assert.deepEqual(reopened.budgetStatus(BRANCH_ID), {
			branchId: BRANCH_ID,
			submissions: 4,
			taskEvaluations: 8,
			actualTaskEvaluations: 8,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: 4,
			maxTaskEvaluations: 8,
			remainingSubmissions: 0,
			remainingTaskEvaluations: 0,
		});
		reopened.verifyLedger();
	});

	it("projects concise model feedback without changing authoritative evidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-stock-interface-projection-"));
		tempDirs.push(root);
		let tick = 0;
		const adapter = new DeterministicFauxCompilerGymAdapter();
		const controller = await ResearchController.open(
			controllerOptions(root, adapter, () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++))),
		);
		const trace = traceFixture();
		const tool = createStockInterfaceParityTool(controller, trace, {
			feedbackView: "concise",
			hostOwnsTerminalization: true,
			protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		});
		assert.match(tool.promptGuidelines?.join("\n") ?? "", /host then closes the branch/);
		const context = {
			sessionManager: { getSessionId: () => BRANCH_ID },
		} as unknown as Parameters<typeof tool.execute>[4];
		const result = await tool.execute("projection-call", requestFixture(1), undefined, undefined, context);
		const details = result.details as StockInterfaceParityEvaluationEnvelope;
		const content = result.content[0];
		assert.equal(content?.type, "text");
		if (content?.type !== "text") throw new Error("Projection tool must return one text result");

		const projected = projectStockInterfaceFeedback(details, "concise");
		assert.deepEqual(JSON.parse(content.text), projected);
		assert.equal(projected.type, "concise_verified_compiler_gym_result");
		assert.equal(projected.protocolVersion, STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION);
		assert.deepEqual(
			projected.tasks.map((task) => ({
				benchmarkId: task.benchmarkId,
				irInstructionCount: task.irInstructionCount,
				objectTextSizeBytes: task.objectTextSizeBytes,
				verifierPassed: task.verifierPassed,
				verifierErrors: task.verifierErrors,
			})),
			[
				{
					benchmarkId: STOCK_CPU_TASKS[0],
					irInstructionCount: 2_100,
					objectTextSizeBytes: 10_000,
					verifierPassed: true,
					verifierErrors: [],
				},
				{
					benchmarkId: STOCK_CPU_TASKS[1],
					irInstructionCount: 16_000,
					objectTextSizeBytes: 80_000,
					verifierPassed: true,
					verifierErrors: [],
				},
			],
		);
		assert.deepEqual(projected.budget, {
			submissions: 1,
			taskEvaluations: 2,
			maxSubmissions: 4,
			maxTaskEvaluations: 8,
			remainingSubmissions: 3,
			remainingTaskEvaluations: 6,
		});
		assert.equal(projectStockInterfaceFeedback(details, "full"), details);
		assert.equal(trace.modelFeedbackBytes[0], Buffer.byteLength(content.text));
		assert.ok(Buffer.byteLength(content.text) <= Buffer.byteLength(JSON.stringify(details)) * 0.25);
		assert.ok(details.request.hypothesis.length > 0);
		assert.ok(details.job.manifestDigest.length > 0);
		assert.ok(details.job.measurement?.provenance.evaluatorSha256.length);
		controller.verifyLedger();
	});

	it("requires both frozen task thresholds for attainment", () => {
		const attained = assessStockInterfaceParityQuality(
			selectionFixture(STOCK_INTERFACE_PARITY_REFERENCE.blowfishIr, STOCK_INTERFACE_PARITY_REFERENCE.bzip2Ir),
		);
		assert.equal(attained.passed, true);
		assert.equal(attained.decision, "attainment-demonstrated");

		const blowfishMiss = assessStockInterfaceParityQuality(
			selectionFixture(
				STOCK_INTERFACE_PARITY_REFERENCE.blowfishIr + 1,
				STOCK_INTERFACE_PARITY_REFERENCE.bzip2Ir - 1,
			),
		);
		assert.equal(blowfishMiss.passed, false);
		assert.equal(blowfishMiss.decision, "not-promising");

		const bzip2Miss = assessStockInterfaceParityQuality(
			selectionFixture(
				STOCK_INTERFACE_PARITY_REFERENCE.blowfishIr - 1,
				STOCK_INTERFACE_PARITY_REFERENCE.bzip2Ir + 1,
			),
		);
		assert.equal(bzip2Miss.passed, false);
		assert.equal(bzip2Miss.decision, "not-promising");
	});

	it("pins the one-tool prompt and preregistration budgets to the sealed stock artifacts", () => {
		const prompt = buildStockInterfaceParityPrompt(CALIBRATION);
		const hostPrompt = buildStockInterfaceParityPrompt(CALIBRATION, { hostOwnsTerminalization: true });
		assert.equal((prompt.match(new RegExp(STOCK_INTERFACE_PARITY_TOOL_NAME, "g")) ?? []).length, 1);
		assert.match(prompt, /make exactly four measured candidate evaluations/);
		assert.match(prompt, /call autoresearch_evaluate exactly once/);
		assert.match(prompt, /four-submission\/eight-task budget/);
		assert.equal(sha256Text(prompt), "0ab5a375371a5a5fe9fba48ae1bc036e5ddddc6a825dcb88bdd8e5ece39b048c");
		assert.match(hostPrompt, /host closes the branch immediately after the fourth verified result/);
		assert.doesNotMatch(hostPrompt, /End your response with exactly one line/);

		assert.deepEqual(STOCK_INTERFACE_PARITY_PREREGISTRATION.arm.activeTools, [STOCK_INTERFACE_PARITY_TOOL_NAME]);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.arm.hostPrompts, 1);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.arm.expectedToolCalls, STOCK_CPU_MAX_SUBMISSIONS);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.arm.expectedProviderCalls, 5);
		assert.equal(STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT, 5);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.budgets.submissions, 4);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.budgets.logicalTaskEvaluations, 8);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.budgets.actualFreshTaskEvaluations, 8);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.budgets.reusedTaskEvaluations, 0);
		assert.equal(STOCK_INTERFACE_PARITY_PREREGISTRATION.budgets.providerCallsHard, 5);

		assert.deepEqual(STOCK_INTERFACE_PARITY_REFERENCE, {
			kind: "frozen-attainment-target",
			run: "stock-cpu-baseline/2026-08-28-v3-v2-sealed",
			blowfishIr: 1_937,
			bzip2Ir: 13_706,
			resultSha256: "fc7c0680a76678b31791175cf30eaae0d4d877dd0072c5ae1d2c6e238ea8310c",
			ledgerSha256: "49bafd401fb9e023fd3ddb2bc2f1a12f63cc501ff3933bb4f334b193fdcdd600",
			sessionSha256: "78193e23e38658f478569b4a803624aabbca19a4869a59fb3783b4714ed5012d",
			calibrationSha256: "cbcac6534932cd1bb28ddd7591d10f641537a2dff3a0b6d95e777adde22ebd47",
			evaluatorSha256: "1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266",
			verifierEpoch: "compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2",
		});
		assert.equal(
			sha256Json(STOCK_INTERFACE_PARITY_ACTION_GUIDE),
			"d0df5c3f5780ad4deb9c13ef868c22805242efa3a916bbb8908335ff591d7cc4",
		);
		assert.equal(
			sha256Json(STOCK_INTERFACE_PARITY_PREREGISTRATION),
			"3e6b0eb19795ea283638f4a07874e07e7faa34264f7e798f5922a24a22be19d9",
		);
		assert.equal(
			STOCK_INTERFACE_PARITY_PREREGISTRATION.frozenCommon.primeCommit,
			"bc0fa7606abb3b7af0f765319518d255e6ae553d",
		);
	});

	it("freezes randomized pair order and rejects post-registration drift", () => {
		const expected = {
			promptSha256: "a".repeat(64),
			implementationBundleSha256: "b".repeat(64),
		};
		const even = buildStockFeedbackProjectionPairPreregistration({
			createdAt: "2026-08-27T22:00:00.000Z",
			drawHex: `00${"1".repeat(30)}`,
			...expected,
		});
		const odd = buildStockFeedbackProjectionPairPreregistration({
			createdAt: "2026-08-27T22:00:00.000Z",
			drawHex: `01${"1".repeat(30)}`,
			...expected,
		});
		assert.deepEqual(even.runOrder, ["full", "concise"]);
		assert.deepEqual(odd.runOrder, ["concise", "full"]);
		assert.deepEqual(parseStockFeedbackProjectionPairPreregistration(even, expected), even);
		assert.throws(
			() =>
				parseStockFeedbackProjectionPairPreregistration(
					{
						...even,
						gates: {
							...even.gates,
							compression: { ...even.gates.compression, maximum: 0.5 },
						},
					},
					expected,
				),
			/does not match the frozen protocol/,
		);
		assert.throws(
			() =>
				buildStockFeedbackProjectionPairPreregistration({
					createdAt: "2026-08-27T22:00:00.000Z",
					drawHex: "not-a-draw",
					...expected,
				}),
			/randomization draw/,
		);
	});
});

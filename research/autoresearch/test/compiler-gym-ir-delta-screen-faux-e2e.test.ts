import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { type Context, fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "../src/artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	assertNoForbiddenIrDeltaProjectionMetadata,
	COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL,
} from "../src/compiler-gym-ir-delta-qualification-protocol.js";
import {
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT,
	COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	type CompilerGymIrDeltaScreenArm,
	projectCompilerGymIrDeltaScreenFeedback,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "../src/compiler-gym-ir-delta-smoke-protocol.js";
import {
	COMPILER_GYM_LATE_NOVELTY_FAUX_PILOT_POLICY,
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
	type CompilerGymLateNoveltyPilotArm,
	projectCompilerGymLateNoveltyPilotFeedback,
} from "../src/compiler-gym-late-novelty-pilot.js";
import { type ControllerOptions, ResearchController } from "../src/controller.js";
import { createHostOwnedTerminalizationRuntimeTracker } from "../src/host-owned-terminalization.js";
import { expectedStockCpuProvenance, STOCK_CPU_MAX_SUBMISSIONS, STOCK_CPU_TASKS } from "../src/stock-cpu-protocol.js";
import {
	createStockInterfaceParityProviderBoundBeforeSubmit,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
} from "../src/stock-interface-parity.js";
import {
	createStockInterfaceParityTool,
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	STOCK_INTERFACE_PARITY_TREATMENT,
	type StockInterfaceParityEvaluationEnvelope,
	type StockInterfaceParityToolTrace,
} from "../src/stock-interface-parity-protocol.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	TaskMeasurement,
} from "../src/types.js";

const BRANCH_ID = "compiler-gym-ir-delta-faux-e2e";
const RAW_ANCHORS = [
	{ initialIr: 3_898, initialObject: 16_573, finalIr: 1_970, finalObject: 21_501 },
	{ initialIr: 28_748, initialObject: 122_613, finalIr: 13_838, finalObject: 166_545 },
] as const;
const REQUESTS = [
	structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
	{
		actions: ["-mem2reg", "-instcombine", "-simplifycfg"],
		hypothesis: "Scalar cleanup should expose a compact control-flow graph.",
		mechanism: "Promote allocas, combine instructions, then simplify branches.",
		predictedOutcome: "Both terminal instruction counts decrease.",
		boundaryConditions: ["All twenty semantic callbacks must pass."],
	},
	{
		actions: ["-sroa", "-gvn", "-sccp", "-adce"],
		hypothesis: "Sparse propagation should expose dead instructions.",
		mechanism: "Scalarize aggregates, number values, propagate constants, and delete dead code.",
		predictedOutcome: "The paired terminal vector improves over call two.",
		boundaryConditions: ["Intermediate deltas are conditional and unverified."],
	},
	{
		actions: ["-globalopt", "-globaldce", "-instcombine", "-adce"],
		hypothesis: "Global cleanup should remove residual unreachable definitions.",
		mechanism: "Optimize globals before local combination and aggressive dead-code elimination.",
		predictedOutcome: "The final verified vector remains competitive on both tasks.",
		boundaryConditions: ["Only the terminal verifier establishes correctness."],
	},
] as const;

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

function validation(): Record<string, unknown> {
	return {
		base_callbacks_selected: 20,
		inputs: Array.from({ length: 20 }, (_, index) => ({
			completed: true,
			errors: [],
			input_index: index + 1,
			passed: true,
			walltime_seconds: 0.01,
		})),
		inputs_completed: 20,
		inputs_expected: 20,
		passed: true,
		registered_callback_group_size: 5,
		sanitizer_callbacks_excluded: 80,
		sanitizer_callbacks_selected: 0,
		semantic_errors: [],
		worker_count_source: "SLURM_CPUS_PER_TASK",
		workers: 2,
	};
}

function rawEvaluatorStdout(input: {
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	actions: readonly string[];
	anchor: (typeof RAW_ANCHORS)[number];
	callIndex: number;
}): string {
	const finalIr = input.anchor.finalIr - (input.callIndex - 1) * 7;
	const actionIndices = input.actions.map((_, index) => index);
	const deltas = input.actions.map((_, index) =>
		index === input.actions.length - 1 ? finalIr - input.anchor.initialIr : 0,
	);
	return canonicalLine({
		action_indices: actionIndices,
		action_trace: {
			action_indices: actionIndices,
			actions: [...input.actions],
			benchmark: input.benchmarkId,
			contract: COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
			initial_ir_instruction_count: input.anchor.initialIr,
			intermediate_semantic_status: "unverified",
			prefix_conditional: true,
			records: input.actions.map((action, index) => ({
				action,
				action_index: actionIndices[index],
				delta_from_previous: deltas[index],
				index,
			})),
			terminal_semantic_status: "canonical-20-input-verifier",
			zero_delta_semantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
		},
		benchmark: input.benchmarkId,
		commandline: `opt ${input.actions.join(" ")} input.bc -o output.bc`,
		contract: COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT,
		environment: {},
		metrics: {
			delta_final_minus_initial: {
				IrInstructionCount: finalIr - input.anchor.initialIr,
				ObjectTextSizeBytes: input.anchor.finalObject - input.anchor.initialObject,
			},
			final: { IrInstructionCount: finalIr, ObjectTextSizeBytes: input.anchor.finalObject },
			improvement_fraction: { IrInstructionCount: 0.1, ObjectTextSizeBytes: -0.1 },
			initial: {
				IrInstructionCount: input.anchor.initialIr,
				ObjectTextSizeBytes: input.anchor.initialObject,
			},
		},
		ok: true,
		provenance: {},
		request: { actions: [...input.actions], benchmark: input.benchmarkId },
		schema_version: 2,
		status: "passed",
		step_info: { reason: "pass metadata excluded", retained: false },
		terminal_verifier_contract: COMPILER_GYM_VERIFIER_EPOCH,
		timings_seconds: { total: 0.25 },
		validation: validation(),
	});
}

function taskMeasurement(
	benchmarkId: string,
	anchor: (typeof RAW_ANCHORS)[number],
	callIndex: number,
): TaskMeasurement {
	return {
		benchmarkId,
		status: "accepted",
		metrics: {
			IrInstructionCount: anchor.finalIr - (callIndex - 1) * 7,
			ObjectTextSizeBytes: anchor.finalObject,
		},
		verifier: { passed: true, checks: ["20-base-semantic-callbacks"], errors: [] },
		runtimeMs: 1_000,
	};
}

class DeterministicIrDeltaAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	evaluate(job: EvaluationJob, _context: EvaluationContext): Promise<EvaluationOutcome> {
		this.calls += 1;
		const callIndex = this.calls;
		const actions = JSON.parse(job.candidateContent) as string[];
		const rawTasks = STOCK_CPU_TASKS.map((benchmarkId, index) => {
			const stdout = rawEvaluatorStdout({ benchmarkId, actions, anchor: RAW_ANCHORS[index], callIndex });
			const stderr = "";
			const slurmId = String(1_705_000 + callIndex * 10 + index);
			const jobName = `pids-faux-${callIndex}-${index + 1}`;
			return {
				accounting: {
					allocCpus: 2,
					cpuTimeRawSeconds: 2,
					elapsedRawSeconds: 1,
					endAt: "2026-08-29T01:00:01",
					exitCode: "0:0",
					jobIdRaw: slurmId,
					jobName,
					nTasks: null,
					nodeList: "faux-cpu-01",
					startAt: "2026-08-29T01:00:00",
					state: "COMPLETED",
				},
				benchmarkId,
				evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
				exitCode: 0,
				jobName,
				requestSha256: sha256Text(canonicalLine({ actions, benchmark: benchmarkId })),
				slurmId,
				stderr,
				stderrSha256: sha256Text(stderr),
				stdout,
				stdoutSha256: sha256Text(stdout),
				transientCache: `/tmp/prime-ir-screen-faux-${callIndex}-${index + 1}`,
				wallMs: 1_000,
			};
		});
		const sourceDirectory = `/scratch/private/sources/${COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256}`;
		const aggregate = canonicalLine({
			actionsSha256: sha256Json(actions),
			candidateSha256: job.candidate.digest,
			contract: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
			evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			jobId: job.jobId,
			manifestDigest: job.manifestDigest,
			measurementReuse: false,
			remoteEvaluatorPath: `${sourceDirectory}/compiler_gym_ir_delta_eval.py`,
			sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			sourceDirectory,
			tasks: rawTasks,
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		});
		return Promise.resolve({
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: STOCK_CPU_TASKS.map((benchmarkId, index) =>
				taskMeasurement(benchmarkId, RAW_ANCHORS[index], callIndex),
			),
			hardware: { host: "deterministic-faux-cpu" },
			provenance: expectedStockCpuProvenance(COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256),
			stdout: aggregate,
			stderr: "",
		});
	}
}

function controllerOptions(root: string, adapter: EvaluationAdapter): ControllerOptions {
	let tick = 0;
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
		now: () => new Date(Date.UTC(2026, 7, 29, 1, 0, tick++)),
	};
}

function toolResultJson(event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>): unknown {
	if (event.isError || typeof event.result !== "object" || event.result === null) {
		throw new Error("Parity tool result was missing or erroneous");
	}
	const content = (event.result as { content?: unknown }).content;
	if (!Array.isArray(content) || content.length !== 1) throw new Error("Parity tool must return one content item");
	const item = content[0];
	if (typeof item !== "object" || item === null || (item as { type?: unknown }).type !== "text") {
		throw new Error("Parity tool result must be text");
	}
	const text = (item as { text?: unknown }).text;
	if (typeof text !== "string") throw new Error("Parity tool text is absent");
	return JSON.parse(text) as unknown;
}

interface ArmRun {
	modelFeedback: unknown[];
	rawArtifacts: string[];
	providerContexts: Context[];
	providerCalls: number;
	evaluatorCalls: number;
	toolCalls: number;
	duplicateCalls: number;
	jobIds: string[];
	intentionalStops: number;
	compactionEvents: number;
}

async function runArm(
	root: string,
	arm: CompilerGymIrDeltaScreenArm,
	lateNoveltyArm?: CompilerGymLateNoveltyPilotArm,
): Promise<ArmRun> {
	const workspace = join(root, "workspace");
	const evaluationRoot = join(root, "evaluation");
	const adapter = new DeterministicIrDeltaAdapter();
	const controller = await ResearchController.open(controllerOptions(evaluationRoot, adapter));
	const artifactStore = new ArtifactStore(join(evaluationRoot, "artifacts"));
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
	const parityTool = createStockInterfaceParityTool(controller, trace, {
		hostOwnsTerminalization: true,
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		beforeSubmit: createStockInterfaceParityProviderBoundBeforeSubmit(trace, providerTracker),
		feedbackProjector: async (details, context) => {
			const baseFeedback = await projectCompilerGymIrDeltaScreenFeedback({
				details,
				arm,
				callIndex: context.submissionOrdinal,
				readArtifact: (reference) => artifactStore.readString(reference),
			});
			return lateNoveltyArm
				? projectCompilerGymLateNoveltyPilotFeedback({
						details: baseFeedback,
						arm: lateNoveltyArm,
						submissionOrdinal: context.submissionOrdinal,
					})
				: baseFeedback;
		},
	});

	const faux = registerFauxProvider({
		provider: `faux-ir-delta-${arm}-${process.pid}-${root.split("/").at(-1)}`,
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
		agentDir: join(root, "agent"),
		settingsManager,
		extensionFactories: [
			createStockInterfaceParityProviderBudgetExtension(providerTracker, hostTracker, STOCK_CPU_MAX_SUBMISSIONS),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
		systemPrompt: buildCompilerGymIrDeltaScreenPrompt(),
	});
	await resourceLoader.reload();
	const sessionManager = SessionManager.inMemory(workspace);
	Object.defineProperty(sessionManager, "getSessionId", { value: () => BRANCH_ID });
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
		tools: [parityTool.name],
		customTools: [parityTool],
		includeGoals: false,
		includeCompactSkill: false,
	});
	const events: AgentSessionEvent[] = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	const providerContexts: Context[] = [];
	faux.setResponses(
		REQUESTS.map((request, index) => (context) => {
			providerContexts.push(JSON.parse(JSON.stringify(context)) as Context);
			return fauxAssistantMessage(
				fauxToolCall(STOCK_INTERFACE_PARITY_TOOL_NAME, structuredClone(request), {
					id: `${arm}-tool-${index + 1}`,
				}),
				{ stopReason: "toolUse" },
			);
		}),
	);
	try {
		await session.promptAndWait("Run the four-call bounded screen. The host owns terminalization.");
	} finally {
		unsubscribe();
		await session.disposeAsync();
		faux.unregister();
	}
	controller.verifyLedger();
	const toolEnds = events.filter(
		(event): event is Extract<AgentSessionEvent, { type: "tool_execution_end" }> =>
			event.type === "tool_execution_end" && event.toolName === STOCK_INTERFACE_PARITY_TOOL_NAME,
	);
	const jobs = controller.statusForBranch(BRANCH_ID);
	const rawArtifacts = await Promise.all(
		jobs.map(async (job) => {
			const reference = job.measurement?.stdout;
			if (!reference) throw new Error("Faux IR-delta measurement omitted aggregate stdout");
			return artifactStore.readString(reference);
		}),
	);
	return {
		modelFeedback: toolEnds.map(toolResultJson),
		rawArtifacts,
		providerContexts,
		providerCalls: faux.state.callCount,
		evaluatorCalls: adapter.calls,
		toolCalls: trace.callCount,
		duplicateCalls: trace.duplicateCount,
		jobIds: [...trace.jobIds],
		intentionalStops: hostTracker.terminalizationStops,
		compactionEvents: events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end")
			.length,
	};
}

function toolFeedbackInContext(context: Context): unknown[] {
	return context.messages.flatMap((message) => {
		if (message.role !== "toolResult") return [];
		const text = message.content.find((content) => content.type === "text")?.text;
		if (text === undefined) throw new Error("Model-facing tool result lacks text");
		return [JSON.parse(text) as unknown];
	});
}

describe("CompilerGym IR-delta paid-screen faux E2E", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("changes exactly one model-facing field while retaining raw traces host-side and aborting a fifth call", async () => {
		const controlRoot = await mkdtemp(join(tmpdir(), "prime-ir-delta-faux-control-"));
		const treatmentRoot = await mkdtemp(join(tmpdir(), "prime-ir-delta-faux-treatment-"));
		tempDirs.push(controlRoot, treatmentRoot);
		const [control, treatment] = await Promise.all([
			runArm(controlRoot, "hidden-control"),
			runArm(treatmentRoot, "visible-ir-delta-treatment"),
		]);

		for (const arm of [control, treatment]) {
			assert.equal(arm.providerCalls, 4, "A fifth faux provider call escaped host terminalization");
			assert.equal(arm.evaluatorCalls, 4);
			assert.equal(arm.toolCalls, 4);
			assert.equal(arm.intentionalStops, 1);
			assert.equal(arm.modelFeedback.length, 4);
			assert.equal(arm.rawArtifacts.length, 4);
		}
		assert.deepEqual(control.rawArtifacts, treatment.rawArtifacts, "Host-side measured evidence drifted by arm");

		for (const [index, controlFeedback] of control.modelFeedback.entries()) {
			const treatmentFeedback = treatment.modelFeedback[index];
			if (
				typeof controlFeedback !== "object" ||
				controlFeedback === null ||
				Array.isArray(controlFeedback) ||
				typeof treatmentFeedback !== "object" ||
				treatmentFeedback === null ||
				Array.isArray(treatmentFeedback)
			) {
				throw new Error("Model-facing parity feedback must be an object");
			}
			const controlRecord = controlFeedback as Record<string, unknown>;
			const treatmentRecord = structuredClone(treatmentFeedback) as Record<string, unknown>;
			assert.equal("irDeltaTrace" in controlRecord, false);
			assert.equal("irDeltaTrace" in treatmentRecord, true);
			const differingKeys = Object.keys(treatmentRecord).filter(
				(key) =>
					!(key in controlRecord) ||
					canonicalJson(toJsonValue(treatmentRecord[key])) !== canonicalJson(toJsonValue(controlRecord[key])),
			);
			assert.deepEqual(differingKeys, ["irDeltaTrace"]);
			delete treatmentRecord.irDeltaTrace;
			assert.deepEqual(treatmentRecord, controlRecord);
			assertNoForbiddenIrDeltaProjectionMetadata(controlRecord, `control[${index}]`);
			const controlJson = JSON.stringify(controlRecord);
			assert.equal(controlJson.includes("action_trace"), false);
			assert.equal(controlJson.includes("delta_from_previous"), false);
			assert.equal(controlJson.includes(COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL), false);
		}

		for (const rawArtifact of control.rawArtifacts) {
			const aggregate = JSON.parse(rawArtifact) as { tasks: Array<{ stdout: string }> };
			assert.equal(aggregate.tasks.length, 2);
			assert.ok(aggregate.tasks.every((task) => task.stdout.includes('"action_trace"')));
			assert.ok(aggregate.tasks.every((task) => task.stdout.includes('"delta_from_previous"')));
		}
	});

	it("exposes one bounded late-novelty field only in the third accepted result seen by provider call four", async () => {
		const controlRoot = await mkdtemp(join(tmpdir(), "prime-late-novelty-faux-control-"));
		const treatmentRoot = await mkdtemp(join(tmpdir(), "prime-late-novelty-faux-treatment-"));
		tempDirs.push(controlRoot, treatmentRoot);
		const [control, treatment] = await Promise.all([
			runArm(controlRoot, "hidden-control", "unchanged-control"),
			runArm(treatmentRoot, "hidden-control", "late-novelty-treatment"),
		]);

		for (const arm of [control, treatment]) {
			assert.equal(arm.providerCalls, 4);
			assert.equal(arm.evaluatorCalls, 4);
			assert.equal(arm.toolCalls, 4);
			assert.equal(arm.duplicateCalls, 0);
			assert.equal(new Set(arm.jobIds).size, 4);
			assert.equal(arm.intentionalStops, 1);
			assert.equal(arm.compactionEvents, 0);
			assert.equal(arm.providerContexts.length, 4);
		}
		assert.deepEqual(control.rawArtifacts, treatment.rawArtifacts, "Authoritative evaluator artifacts drifted");

		for (const [index, controlFeedback] of control.modelFeedback.entries()) {
			const treatmentFeedback = treatment.modelFeedback[index];
			if (
				typeof controlFeedback !== "object" ||
				controlFeedback === null ||
				Array.isArray(controlFeedback) ||
				typeof treatmentFeedback !== "object" ||
				treatmentFeedback === null ||
				Array.isArray(treatmentFeedback)
			) {
				throw new Error("Late-novelty feedback must be an object");
			}
			const controlRecord = controlFeedback as Record<string, unknown>;
			const treatmentRecord = structuredClone(treatmentFeedback) as Record<string, unknown>;
			if (index === 2) {
				assert.equal(treatmentRecord.call4Guidance, COMPILER_GYM_LATE_NOVELTY_GUIDANCE);
				assert.equal(
					Buffer.byteLength(
						JSON.stringify({
							[COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD]: treatmentRecord.call4Guidance,
						}),
					),
					128,
				);
				assert.equal(
					Buffer.byteLength(JSON.stringify(treatmentRecord)) - Buffer.byteLength(JSON.stringify(controlRecord)),
					127,
				);
				delete treatmentRecord.call4Guidance;
			} else {
				assert.equal(COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD in treatmentRecord, false);
			}
			assert.deepEqual(treatmentRecord, controlRecord, `Feedback ${index + 1} drifted outside the treatment`);
		}

		for (let providerIndex = 0; providerIndex < 3; providerIndex++) {
			assert.equal(
				JSON.stringify(treatment.providerContexts[providerIndex]).includes(COMPILER_GYM_LATE_NOVELTY_GUIDANCE),
				false,
				`Provider call ${providerIndex + 1} saw the late treatment early`,
			);
		}
		assert.equal(JSON.stringify(control.providerContexts).includes(COMPILER_GYM_LATE_NOVELTY_GUIDANCE), false);
		const treatmentCallFourFeedback = toolFeedbackInContext(treatment.providerContexts[3]!);
		assert.equal(treatmentCallFourFeedback.length, 3);
		assert.equal(
			(treatmentCallFourFeedback[2] as Record<string, unknown>).call4Guidance,
			COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
		);
		assert.equal(
			JSON.stringify(treatment.providerContexts[3]).split(COMPILER_GYM_LATE_NOVELTY_GUIDANCE).length - 1,
			1,
		);
		assert.deepEqual(COMPILER_GYM_LATE_NOVELTY_FAUX_PILOT_POLICY.authorizations, {
			liveProvider: false,
			paid: false,
			remoteEvaluator: false,
			gpu: false,
			treatmentClaim: false,
			promotion: false,
		});

		const acceptedThirdFeedback = structuredClone(control.modelFeedback[2]) as StockInterfaceParityEvaluationEnvelope;
		const rejectedThirdFeedback = structuredClone(acceptedThirdFeedback);
		rejectedThirdFeedback.job.state.status = "invalid";
		const rejectedProjection = projectCompilerGymLateNoveltyPilotFeedback({
			details: rejectedThirdFeedback,
			arm: "late-novelty-treatment",
			submissionOrdinal: 3,
		});
		assert.deepEqual(rejectedProjection, rejectedThirdFeedback);
		assert.equal(COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD in rejectedProjection, false);
		assert.throws(
			() =>
				projectCompilerGymLateNoveltyPilotFeedback({
					details: acceptedThirdFeedback,
					arm: "late-novelty-treatment",
					submissionOrdinal: 5,
				}),
			/ordinal must be an integer from 1 through 4/,
		);
	});
});

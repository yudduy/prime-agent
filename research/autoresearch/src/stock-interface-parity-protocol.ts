import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json } from "./canonical-json.js";
import { FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";
import {
	latestStockParent,
	parseStockCpuEvaluationRequest,
	STOCK_CPU_CHAMPION_POLICY,
	STOCK_CPU_MAX_SUBMISSIONS,
	STOCK_CPU_TASKS,
	type StockCpuCalibration,
	type StockCpuChampionSelection,
	type StockCpuEvaluationRequest,
} from "./stock-cpu-protocol.js";
import type { BranchBudgetStatus, EvaluationAdapter, JobView, SubmitResult } from "./types.js";

export const STOCK_INTERFACE_PARITY_PROTOCOL_VERSION = "compiler-gym-stock-interface-parity-v1" as const;
export const STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION = "compiler-gym-feedback-projection-v1" as const;
export const STOCK_FEEDBACK_PROJECTION_PAIR_ID = "compiler-gym-feedback-projection-screen-v1" as const;
export const STOCK_INTERFACE_PARITY_TREATMENT = "typed-sync-parity-v1" as const;
export const STOCK_INTERFACE_PARITY_TOOL_NAME = "autoresearch_evaluate" as const;
export const STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT = 5;
export const STOCK_INTERFACE_PARITY_OUTPUT_TOKEN_LIMIT = 32_000;
export const STOCK_INTERFACE_PARITY_ACTIVE_SECONDS_LIMIT = 600;
export const STOCK_INTERFACE_PARITY_CALENDAR_SECONDS_LIMIT = 900;
export const STOCK_INTERFACE_PARITY_EVALUATOR_TIMEOUT_MS = 420_000;

export const STOCK_INTERFACE_PARITY_ACTION_GUIDE = [
	"-mem2reg",
	"-sroa",
	"-instcombine",
	"-simplifycfg",
	"-reassociate",
	"-gvn",
	"-newgvn",
	"-sccp",
	"-ipsccp",
	"-adce",
	"-dce",
	"-bdce",
	"-dse",
	"-deadargelim",
	"-globalopt",
	"-globaldce",
	"-constmerge",
	"-constprop",
	"-jump-threading",
	"-licm",
	"-loop-rotate",
	"-loop-unroll",
	"-loop-vectorize",
	"-slp-vectorizer",
	"-tailcallelim",
	"-mergereturn",
] as const;

export const STOCK_INTERFACE_PARITY_REFERENCE = {
	kind: "frozen-attainment-target",
	run: "stock-cpu-baseline/2026-08-28-v3-v2-sealed",
	blowfishIr: 1937,
	bzip2Ir: 13_706,
	resultSha256: "fc7c0680a76678b31791175cf30eaae0d4d877dd0072c5ae1d2c6e238ea8310c",
	ledgerSha256: "49bafd401fb9e023fd3ddb2bc2f1a12f63cc501ff3933bb4f334b193fdcdd600",
	sessionSha256: "78193e23e38658f478569b4a803624aabbca19a4869a59fb3783b4714ed5012d",
	calibrationSha256: "cbcac6534932cd1bb28ddd7591d10f641537a2dff3a0b6d95e777adde22ebd47",
	evaluatorSha256: "1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266",
	verifierEpoch: "compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2",
} as const;

export const STOCK_INTERFACE_PARITY_PREREGISTRATION = {
	schemaVersion: 1,
	id: STOCK_INTERFACE_PARITY_PROTOCOL_VERSION,
	question:
		"Can a verifier-separated typed controller attain the frozen stock Prime CPU frontier under the same research information and search budget?",
	claimClass: "single-trajectory-feasibility",
	replicationUnit: "complete-unseedable-luna-trajectory",
	causalClaimAllowed: false,
	reference: STOCK_INTERFACE_PARITY_REFERENCE,
	arm: {
		id: STOCK_INTERFACE_PARITY_TREATMENT,
		measuredRecall: false,
		width: false,
		retest: false,
		sharing: false,
		forcedCompaction: false,
		measurementReuse: false,
		activeTools: [STOCK_INTERFACE_PARITY_TOOL_NAME],
		feedbackTopology: "one synchronous typed evaluation call returns one complete terminal measurement",
		hostPrompts: 1,
		expectedToolCalls: STOCK_CPU_MAX_SUBMISSIONS,
		expectedProviderCalls: STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT,
	},
	frozenCommon: {
		primeCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
		model: `${FROZEN_CAMPAIGN.model.provider}/${FROZEN_CAMPAIGN.model.id}`,
		thinking: FROZEN_CAMPAIGN.model.thinkingLevel,
		requestedTier: FROZEN_CAMPAIGN.model.serviceTier,
		tasks: STOCK_CPU_TASKS,
		calibrationSha256: STOCK_INTERFACE_PARITY_REFERENCE.calibrationSha256,
		evaluatorSha256: STOCK_INTERFACE_PARITY_REFERENCE.evaluatorSha256,
		verifierEpoch: STOCK_INTERFACE_PARITY_REFERENCE.verifierEpoch,
		actionGuideSha256: sha256Json(STOCK_INTERFACE_PARITY_ACTION_GUIDE),
		championPolicy: STOCK_CPU_CHAMPION_POLICY,
		systemPrompt: "default-prime-system-prompt",
		transport: "sse",
		providerRetries: 0,
		historicalCandidatesExposedToModel: false,
	},
	budgets: {
		submissions: STOCK_CPU_MAX_SUBMISSIONS,
		logicalTaskEvaluations: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
		actualFreshTaskEvaluations: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
		reusedTaskEvaluations: 0,
		providerCallsHard: STOCK_INTERFACE_PARITY_PROVIDER_CALL_LIMIT,
		noncachedOutputTokensCheckpoint: STOCK_INTERFACE_PARITY_OUTPUT_TOKEN_LIMIT,
		activeAgentSecondsCheckpoint: STOCK_INTERFACE_PARITY_ACTIVE_SECONDS_LIMIT,
		calendarSecondsHard: STOCK_INTERFACE_PARITY_CALENDAR_SECONDS_LIMIT,
		calibrationAccounting: "shared-and-excluded",
	},
	primaryOutcome: {
		type: "task-local-vector",
		fields: ["blowfishIr", "bzip2Ir"],
		aggregationAcrossTasks: "forbidden",
		lowerIsBetter: true,
	},
	qualityGate: {
		blowfishIrMaximum: STOCK_INTERFACE_PARITY_REFERENCE.blowfishIr,
		bzip2IrMaximum: STOCK_INTERFACE_PARITY_REFERENCE.bzip2Ir,
		conjunctive: true,
	},
} as const;

export interface StockInterfaceParityActionBounds {
	minItems?: number;
	maxItems: number;
}

export function createStockInterfaceParityEvaluationSchema(bounds: StockInterfaceParityActionBounds) {
	if (!Number.isSafeInteger(bounds.maxItems) || bounds.maxItems < 0) {
		throw new Error("Stock interface action maxItems must be a nonnegative safe integer");
	}
	if (
		bounds.minItems !== undefined &&
		(!Number.isSafeInteger(bounds.minItems) || bounds.minItems < 0 || bounds.minItems > bounds.maxItems)
	) {
		throw new Error("Stock interface action minItems must be a nonnegative safe integer no greater than maxItems");
	}
	return Type.Object(
		{
			actions: Type.Array(Type.String(), {
				...(bounds.minItems === undefined ? {} : { minItems: bounds.minItems }),
				maxItems: bounds.maxItems,
			}),
			hypothesis: Type.String({ minLength: 1 }),
			mechanism: Type.String({ minLength: 1 }),
			predictedOutcome: Type.String({ minLength: 1 }),
			boundaryConditions: Type.Array(Type.String()),
		},
		{ additionalProperties: false },
	);
}

export const StockInterfaceParityEvaluationSchema = createStockInterfaceParityEvaluationSchema({ maxItems: 256 });

export interface StockInterfaceParityToolTrace {
	callCount: number;
	duplicateCount: number;
	evaluatorWaitMs: number;
	jobIds: string[];
	requests: StockCpuEvaluationRequest[];
	modelFeedbackBytes: number[];
}

export type StockInterfaceFeedbackView = "concise" | "full";

export interface StockInterfaceParityBeforeSubmitInput {
	branchId: string;
	submissionOrdinal: number;
	request: StockCpuEvaluationRequest;
	existingJobs: readonly JobView[];
}

export type StockInterfaceParityBeforeSubmit = (input: StockInterfaceParityBeforeSubmitInput) => void | Promise<void>;

export type StockInterfaceParityPrepareArguments = (args: unknown) => StockCpuEvaluationRequest;

export interface StockInterfaceParityFeedbackProjectorContext {
	branchId: string;
	submissionOrdinal: number;
}

export type StockInterfaceParityFeedbackProjector = (
	details: StockInterfaceParityEvaluationEnvelope,
	context: StockInterfaceParityFeedbackProjectorContext,
) => unknown | Promise<unknown>;

export interface StockInterfaceParityEvaluationHooks {
	beforeSubmit?: StockInterfaceParityBeforeSubmit;
}

export interface StockFeedbackProjectionPairPreregistration {
	schemaVersion: 1;
	id: typeof STOCK_FEEDBACK_PROJECTION_PAIR_ID;
	createdAt: string;
	hypothesis: string;
	claimClass: "directional-single-pair-screen";
	causalClaimAllowed: false;
	protocolVersion: typeof STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION;
	arms: readonly [{ id: "full-control"; feedbackView: "full" }, { id: "concise-treatment"; feedbackView: "concise" }];
	runOrder: readonly [StockInterfaceFeedbackView, StockInterfaceFeedbackView];
	randomization: {
		method: "cryptographic-byte-parity-v1";
		drawHex: string;
	};
	frozenCommon: {
		primeCommit: string;
		model: string;
		thinking: string;
		requestedTier: string;
		promptSha256: string;
		calibrationSha256: string;
		evaluatorSha256: string;
		verifierEpoch: string;
		toolName: typeof STOCK_INTERFACE_PARITY_TOOL_NAME;
		providerDispatches: number;
		evaluatorDispatches: number;
		freshTaskEvaluations: number;
		providerRetries: 0;
		compaction: false;
		measurementReuse: false;
		hostOwnedTerminalization: true;
		fullAuthoritativeEvidencePreserved: true;
	};
	implementationBundleSha256: string;
	gates: {
		compression: {
			metric: "concise-model-feedback-bytes/full-model-feedback-bytes";
			maximum: 0.25;
		};
		quality: {
			metric: "whole-pareto-coverage-v1";
			requirement: "concise-covers-every-full-frontier-vector";
		};
		promotion: {
			onePairIsDirectionalOnly: true;
			freshReplicationRequired: true;
			gpuTransferAllowedFromThisPair: false;
		};
	};
	killRules: readonly [
		"evidence-source-or-core-integrity-failure",
		"projection-does-not-match-authoritative-measurement",
		"measurement-reuse-duplicate-or-fifth-evaluation",
		"post-terminal-provider-dispatch",
		"compression-or-quality-gate-failure",
	];
}

export interface StockFeedbackProjectionPairExpectedHashes {
	promptSha256: string;
	implementationBundleSha256: string;
}

function feedbackProjectionRunOrder(
	drawHex: string,
): readonly [StockInterfaceFeedbackView, StockInterfaceFeedbackView] {
	if (!/^[a-f0-9]{32}$/.test(drawHex)) {
		throw new Error("Feedback projection randomization draw must be 16 lowercase hexadecimal bytes");
	}
	return Number.parseInt(drawHex.slice(0, 2), 16) % 2 === 0 ? ["full", "concise"] : ["concise", "full"];
}

export function buildStockFeedbackProjectionPairPreregistration(input: {
	createdAt: string;
	drawHex: string;
	promptSha256: string;
	implementationBundleSha256: string;
}): StockFeedbackProjectionPairPreregistration {
	if (!Number.isFinite(Date.parse(input.createdAt))) {
		throw new Error("Feedback projection preregistration createdAt must be an ISO timestamp");
	}
	if (!/^[a-f0-9]{64}$/.test(input.promptSha256)) {
		throw new Error("Feedback projection prompt hash must be SHA-256");
	}
	if (!/^[a-f0-9]{64}$/.test(input.implementationBundleSha256)) {
		throw new Error("Feedback projection implementation bundle hash must be SHA-256");
	}
	return {
		schemaVersion: 1,
		id: STOCK_FEEDBACK_PROJECTION_PAIR_ID,
		createdAt: input.createdAt,
		hypothesis:
			"Removing decision-irrelevant evaluator payload reduces context and attention cost without reducing verified search quality.",
		claimClass: "directional-single-pair-screen",
		causalClaimAllowed: false,
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		arms: [
			{ id: "full-control", feedbackView: "full" },
			{ id: "concise-treatment", feedbackView: "concise" },
		],
		runOrder: feedbackProjectionRunOrder(input.drawHex),
		randomization: { method: "cryptographic-byte-parity-v1", drawHex: input.drawHex },
		frozenCommon: {
			primeCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
			model: `${FROZEN_CAMPAIGN.model.provider}/${FROZEN_CAMPAIGN.model.id}`,
			thinking: FROZEN_CAMPAIGN.model.thinkingLevel,
			requestedTier: FROZEN_CAMPAIGN.model.serviceTier,
			promptSha256: input.promptSha256,
			calibrationSha256: STOCK_INTERFACE_PARITY_REFERENCE.calibrationSha256,
			evaluatorSha256: STOCK_INTERFACE_PARITY_REFERENCE.evaluatorSha256,
			verifierEpoch: STOCK_INTERFACE_PARITY_REFERENCE.verifierEpoch,
			toolName: STOCK_INTERFACE_PARITY_TOOL_NAME,
			providerDispatches: STOCK_CPU_MAX_SUBMISSIONS,
			evaluatorDispatches: STOCK_CPU_MAX_SUBMISSIONS,
			freshTaskEvaluations: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
			providerRetries: 0,
			compaction: false,
			measurementReuse: false,
			hostOwnedTerminalization: true,
			fullAuthoritativeEvidencePreserved: true,
		},
		implementationBundleSha256: input.implementationBundleSha256,
		gates: {
			compression: {
				metric: "concise-model-feedback-bytes/full-model-feedback-bytes",
				maximum: 0.25,
			},
			quality: {
				metric: "whole-pareto-coverage-v1",
				requirement: "concise-covers-every-full-frontier-vector",
			},
			promotion: {
				onePairIsDirectionalOnly: true,
				freshReplicationRequired: true,
				gpuTransferAllowedFromThisPair: false,
			},
		},
		killRules: [
			"evidence-source-or-core-integrity-failure",
			"projection-does-not-match-authoritative-measurement",
			"measurement-reuse-duplicate-or-fifth-evaluation",
			"post-terminal-provider-dispatch",
			"compression-or-quality-gate-failure",
		],
	};
}

export function parseStockFeedbackProjectionPairPreregistration(
	value: unknown,
	expected: StockFeedbackProjectionPairExpectedHashes,
): StockFeedbackProjectionPairPreregistration {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Feedback projection preregistration must be an object");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.createdAt !== "string" || typeof record.randomization !== "object") {
		throw new Error("Feedback projection preregistration is missing its timestamp or randomization draw");
	}
	const randomization = record.randomization;
	if (randomization === null || Array.isArray(randomization)) {
		throw new Error("Feedback projection preregistration randomization must be an object");
	}
	const drawHex = (randomization as Record<string, unknown>).drawHex;
	if (typeof drawHex !== "string") {
		throw new Error("Feedback projection preregistration is missing its randomization draw");
	}
	const canonical = buildStockFeedbackProjectionPairPreregistration({
		createdAt: record.createdAt,
		drawHex,
		promptSha256: expected.promptSha256,
		implementationBundleSha256: expected.implementationBundleSha256,
	});
	assert.deepEqual(value, canonical, "Feedback projection preregistration does not match the frozen protocol");
	return canonical;
}

export interface StockInterfaceParityEvaluationEnvelope {
	type: "typed_sync_compiler_gym_evaluation";
	protocolVersion: typeof STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION | typeof STOCK_INTERFACE_PARITY_PROTOCOL_VERSION;
	request: StockCpuEvaluationRequest;
	submitted: SubmitResult;
	job: {
		jobId: string;
		manifestDigest: string;
		parentJobIds: string[];
		candidateDigest: string;
		state: JobView["state"];
		measurement: JobView["measurement"];
	};
	budget: BranchBudgetStatus;
}

export interface StockInterfaceConciseFeedback {
	type: "concise_verified_compiler_gym_result";
	protocolVersion: typeof STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION;
	jobId: string;
	status: JobView["state"]["status"];
	tasks: Array<{
		benchmarkId: string;
		irInstructionCount: number | null;
		objectTextSizeBytes: number | null;
		verifierPassed: boolean;
		verifierErrors: string[];
	}>;
	budget: Pick<
		BranchBudgetStatus,
		| "maxSubmissions"
		| "maxTaskEvaluations"
		| "remainingSubmissions"
		| "remainingTaskEvaluations"
		| "submissions"
		| "taskEvaluations"
	>;
}

export interface StockInterfaceParityQualityGate {
	passed: boolean;
	selectedJobId: string | null;
	observed: {
		blowfishIr: number | null;
		bzip2Ir: number | null;
	};
	reference: {
		blowfishIr: number;
		bzip2Ir: number;
	};
	decision: "attainment-demonstrated" | "not-promising";
}

export function buildStockInterfaceParityPrompt(
	calibration: StockCpuCalibration,
	options: { hostOwnsTerminalization?: boolean } = {},
): string {
	return [
		"Optimize the two fixed CompilerGym/cBench programs below with the stock Prime Agent runtime.",
		"Your objective is to reduce raw LLVM IR instruction count on both tasks while all 20 semantic callbacks pass.",
		"This is a bounded research trajectory: make exactly four measured candidate evaluations, one mechanistic proposal at a time.",
		"Do not use web search, public winning traces, credentials, or any measurement other than the calibration and evaluator output.",
		"Do not inspect or modify the evaluator, evidence ledger, artifacts, or files outside this empty workspace.",
		`Tasks: ${JSON.stringify(STOCK_CPU_TASKS)}.`,
		`Authoritative empty-pass calibration: ${JSON.stringify(calibration.tasks)}.`,
		`Useful LLVM 10 flags include: ${STOCK_INTERFACE_PARITY_ACTION_GUIDE.join(", ")}. Repetition and order are allowed.`,
		`For each experiment, call ${STOCK_INTERFACE_PARITY_TOOL_NAME} exactly once with the exact request shape below. Wait for its complete terminal measurement and reason from that evidence before proposing the next candidate.`,
		'Every request must contain exactly: {"actions": string[], "hypothesis": string, "mechanism": string, "predictedOutcome": string, "boundaryConditions": string[]}.',
		"The host fixes tasks, treatment, lineage, verifier, fresh-measurement policy, and the four-submission/eight-task budget. A queued or predicted result is never evidence.",
		`After the fourth result, apply the host's declared champion policy: ${JSON.stringify(STOCK_CPU_CHAMPION_POLICY)}.`,
		options.hostOwnsTerminalization
			? "The host closes the branch immediately after the fourth verified result and selects from the ledger. Do not attempt a fifth evaluation. No final CHAMPION response is required."
			: "Only fully accepted CompilerGym v2 candidates are eligible. The host recomputes this selection from the ledger and rejects a mismatched report.",
		...(options.hostOwnsTerminalization
			? []
			: [
					"End your response with exactly one line: CHAMPION <job-id>, or CHAMPION NONE if no submitted candidate succeeded.",
				]),
	].join("\n");
}

export async function openStockInterfaceParityController(
	outputDir: string,
	adapter: EvaluationAdapter = new FarmShareCompilerGymAdapter(),
): Promise<ResearchController> {
	if (adapter.lane !== "compiler-gym") throw new Error("Stock interface parity requires a CompilerGym adapter");
	return ResearchController.open({
		ledgerPath: resolve(outputDir, "evidence.jsonl"),
		artifactDir: resolve(outputDir, "artifacts"),
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
	});
}

async function waitForController(controller: ResearchController, timeoutMs: number): Promise<number> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const startedAt = Date.now();
	try {
		await Promise.race([
			controller.waitForIdle(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`Evaluator wait exceeded ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
	return Date.now() - startedAt;
}

export async function evaluateStockInterfaceParityCandidate(
	controller: ResearchController,
	branchId: string,
	value: unknown,
	trace: StockInterfaceParityToolTrace,
	timeoutMs = STOCK_INTERFACE_PARITY_EVALUATOR_TIMEOUT_MS,
	protocolVersion:
		| typeof STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION
		| typeof STOCK_INTERFACE_PARITY_PROTOCOL_VERSION = STOCK_INTERFACE_PARITY_PROTOCOL_VERSION,
	hooks: StockInterfaceParityEvaluationHooks = {},
): Promise<StockInterfaceParityEvaluationEnvelope> {
	const request = parseStockCpuEvaluationRequest(value);
	const existing = controller.statusForBranch(branchId);
	await hooks.beforeSubmit?.({
		branchId,
		submissionOrdinal: existing.length + 1,
		request: structuredClone(request),
		existingJobs: structuredClone(existing),
	});
	trace.callCount++;
	trace.requests.push(structuredClone(request));
	const submitted = await controller.submit({
		branchId,
		lane: "compiler-gym",
		benchmarkIds: [...STOCK_CPU_TASKS],
		budgetClass: "smoke",
		treatment: STOCK_INTERFACE_PARITY_TREATMENT,
		proposal: {
			hypothesis: request.hypothesis,
			mechanism: request.mechanism,
			predictedOutcome: request.predictedOutcome,
			boundaryConditions: request.boundaryConditions,
			parentJobIds: latestStockParent(existing),
		},
		candidate: { format: "llvm-pass-sequence", content: JSON.stringify(request.actions) },
		requireFreshMeasurement: true,
	});
	if (submitted.duplicate) {
		trace.duplicateCount++;
		throw new Error(`Duplicate parity dispatch: ${submitted.jobId}`);
	}
	trace.jobIds.push(submitted.jobId);
	trace.evaluatorWaitMs += await waitForController(controller, timeoutMs);
	controller.verifyLedger();
	const jobs = controller.statusForBranch(branchId, [submitted.jobId]);
	assert.equal(jobs.length, 1, "Submitted parity job is missing from its branch");
	const job = jobs[0];
	assert.equal(job.proposal.requireFreshMeasurement, true);
	assert.equal(job.measurement?.reuse, undefined, "Parity evaluation reused a prior measurement");
	return {
		type: "typed_sync_compiler_gym_evaluation",
		protocolVersion,
		request,
		submitted,
		job: {
			jobId: job.proposal.jobId,
			manifestDigest: job.proposal.manifestDigest,
			parentJobIds: [...job.proposal.proposal.parentJobIds],
			candidateDigest: job.proposal.candidate.digest,
			state: structuredClone(job.state),
			measurement: structuredClone(job.measurement),
		},
		budget: controller.budgetStatus(branchId),
	};
}

export function projectStockInterfaceFeedback(
	details: StockInterfaceParityEvaluationEnvelope,
	view: StockInterfaceFeedbackView,
): StockInterfaceConciseFeedback | StockInterfaceParityEvaluationEnvelope {
	if (view === "full") return details;
	assert.equal(details.protocolVersion, STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION);
	return {
		type: "concise_verified_compiler_gym_result",
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		jobId: details.job.jobId,
		status: details.job.state.status,
		tasks:
			details.job.measurement?.tasks.map((task) => ({
				benchmarkId: task.benchmarkId,
				irInstructionCount: task.metrics.IrInstructionCount ?? null,
				objectTextSizeBytes: task.metrics.ObjectTextSizeBytes ?? null,
				verifierPassed: task.verifier.passed,
				verifierErrors: [...task.verifier.errors],
			})) ?? [],
		budget: {
			submissions: details.budget.submissions,
			taskEvaluations: details.budget.taskEvaluations,
			maxSubmissions: details.budget.maxSubmissions,
			maxTaskEvaluations: details.budget.maxTaskEvaluations,
			remainingSubmissions: details.budget.remainingSubmissions,
			remainingTaskEvaluations: details.budget.remainingTaskEvaluations,
		},
	};
}

export function createStockInterfaceParityTool(
	controller: ResearchController,
	trace: StockInterfaceParityToolTrace,
	options: {
		feedbackView?: StockInterfaceFeedbackView;
		hostOwnsTerminalization?: boolean;
		prepareArguments?: StockInterfaceParityPrepareArguments;
		beforeSubmit?: StockInterfaceParityBeforeSubmit;
		feedbackProjector?: StockInterfaceParityFeedbackProjector;
		evaluationSchema?: typeof StockInterfaceParityEvaluationSchema;
		protocolVersion?:
			| typeof STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION
			| typeof STOCK_INTERFACE_PARITY_PROTOCOL_VERSION;
	} = {},
): ToolDefinition {
	const feedbackView = options.feedbackView ?? "full";
	const protocolVersion = options.protocolVersion ?? STOCK_INTERFACE_PARITY_PROTOCOL_VERSION;
	return defineTool({
		name: STOCK_INTERFACE_PARITY_TOOL_NAME,
		label: "Evaluate CompilerGym Candidate",
		description:
			"Submit one LLVM pass sequence, wait for immutable verification, and return its complete terminal two-task measurement.",
		promptSnippet:
			"autoresearch_evaluate: synchronously evaluate one mechanistic LLVM pass-sequence candidate on both fixed tasks.",
		promptGuidelines: [
			"Call once per candidate and use the returned measured evidence before choosing the next candidate.",
			options.hostOwnsTerminalization
				? "Make exactly four calls in total; the host then closes the branch and selects from the ledger."
				: "Make exactly four calls in total, then report the deterministic champion.",
		],
		executionMode: "sequential",
		parameters: options.evaluationSchema ?? StockInterfaceParityEvaluationSchema,
		prepareArguments: options.prepareArguments,
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			signal?.throwIfAborted();
			const branchId = ctx.sessionManager.getSessionId();
			const details = await evaluateStockInterfaceParityCandidate(
				controller,
				branchId,
				params,
				trace,
				STOCK_INTERFACE_PARITY_EVALUATOR_TIMEOUT_MS,
				protocolVersion,
				{ beforeSubmit: options.beforeSubmit },
			);
			const feedback = options.feedbackProjector
				? await options.feedbackProjector(structuredClone(details), {
						branchId,
						submissionOrdinal: details.budget.submissions,
					})
				: projectStockInterfaceFeedback(details, feedbackView);
			const text = JSON.stringify(feedback);
			trace.modelFeedbackBytes.push(Buffer.byteLength(text));
			return { content: [{ type: "text" as const, text }], details };
		},
	});
}

export function assessStockInterfaceParityQuality(
	selection: StockCpuChampionSelection,
): StockInterfaceParityQualityGate {
	const selected = selection.eligibleCandidates.find((candidate) => candidate.jobId === selection.selectedJobId);
	const blowfishIr = selected?.irInstructionCounts[STOCK_CPU_TASKS[0]] ?? null;
	const bzip2Ir = selected?.irInstructionCounts[STOCK_CPU_TASKS[1]] ?? null;
	const passed =
		blowfishIr !== null &&
		bzip2Ir !== null &&
		blowfishIr <= STOCK_INTERFACE_PARITY_REFERENCE.blowfishIr &&
		bzip2Ir <= STOCK_INTERFACE_PARITY_REFERENCE.bzip2Ir;
	return {
		passed,
		selectedJobId: selection.selectedJobId,
		observed: { blowfishIr, bzip2Ir },
		reference: {
			blowfishIr: STOCK_INTERFACE_PARITY_REFERENCE.blowfishIr,
			bzip2Ir: STOCK_INTERFACE_PARITY_REFERENCE.bzip2Ir,
		},
		decision: passed ? "attainment-demonstrated" : "not-promising",
	};
}

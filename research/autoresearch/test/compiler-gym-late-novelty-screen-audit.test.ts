import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../src/artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
	type CompilerGymHardenedPaidGuidanceExposure,
	type CompilerGymHardenedPaidProviderEvidence,
} from "../src/compiler-gym-hardened-paid-provider.js";
import { COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE } from "../src/compiler-gym-ir-delta-screen-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT,
	COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "../src/compiler-gym-ir-delta-smoke-protocol.js";
import { COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD } from "../src/compiler-gym-late-novelty-guidance.js";
import {
	buildCompilerGymLateNoveltyScreenPreregistration,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
	captureCompilerGymLateNoveltyProviderRegistryClosure,
} from "../src/compiler-gym-late-novelty-screen-preregistration.js";
import {
	auditCompilerGymLateNoveltyArm,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_SYSTEM_PROMPT_POLICY,
	type CompilerGymLateNoveltyProjectionEvidence,
	type CompilerGymLateNoveltyRunnerPreflight,
} from "../src/compiler-gym-late-novelty-screen-runner.js";
import { EvidenceLedger } from "../src/ledger.js";
import { STOCK_CPU_TASKS, type StockCpuEvaluationRequest } from "../src/stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	type runStockInterfaceParityTrajectory,
	type StockInterfaceParityResolvedModelSnapshot,
} from "../src/stock-interface-parity.js";
import {
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
} from "../src/stock-interface-parity-protocol.js";
import type { JobView } from "../src/types.js";

type StockTrajectoryResult = Awaited<ReturnType<typeof runStockInterfaceParityTrajectory>>;
type PolicyFixtureKind =
	| "schema-one"
	| "schema-two"
	| "schema"
	| "schema-four"
	| "runner-repeat"
	| "wrong-tool"
	| "multiple-zero"
	| "multiple-invalid-valid"
	| "multiple-valid-invalid"
	| "multiple-one"
	| "multiple-after-four";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUNTIME_SNAPSHOT = capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT);
const RUNTIME_SNAPSHOT_SHA256 = sha256Json(RUNTIME_SNAPSHOT);
const SCHEMA_POLICY_ERROR = "scientific-policy-nonconformance: actions must contain from 1 through 46 flags";
const MULTIPLE_GUARD_ERROR = "Evaluator dispatch requires a distinct accepted provider response";
const TASK_ANCHORS = [
	{ initialIr: 3898, initialObject: 16_573, finalIr: 1970, finalObject: 21_501 },
	{ initialIr: 28_748, initialObject: 122_613, finalIr: 13_838, finalObject: 166_545 },
] as const;
const tempDirectories: string[] = [];

const RESOLVED_MODEL: StockInterfaceParityResolvedModelSnapshot = {
	registryModel: {
		provider: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.provider,
		id: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.id,
		api: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.api,
		baseUrl: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.baseUrl,
		headerNames: [],
	},
	sessionModel: {
		provider: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.provider,
		id: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.id,
		api: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.api,
		baseUrl: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.baseUrl,
		headerNames: [],
	},
	registryLoadErrorPresent: false,
	storedCredentialType: "oauth",
	oauthProviderRegistered: true,
	requestAuthResolved: true,
	apiKeyPresent: true,
	selectedAuthSource: "stored",
	resolvedRequestHeaderNames: [],
};

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

async function writePrivateCanonicalJson(path: string, value: unknown, exclusive = true): Promise<string> {
	const contents = canonicalLine(value);
	await writeFile(path, contents, { encoding: "utf8", flag: exclusive ? "wx" : "w", mode: 0o600 });
	await chmod(path, 0o600);
	return sha256Text(contents);
}

function requestForCall(callIndex: 1 | 2 | 3 | 4): StockCpuEvaluationRequest {
	if (callIndex === 1) return structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST);
	return {
		actions: Array.from({ length: callIndex }, (_, index) => (index % 2 === 0 ? "-adce" : "-dce")),
		hypothesis: `adaptive request ${callIndex}`,
		mechanism: `distinct action vector ${callIndex}`,
		predictedOutcome: "reduce both task-local IR counts",
		boundaryConditions: ["terminal verifier remains authoritative"],
	};
}

function overlongRequest(label: string): StockCpuEvaluationRequest {
	return {
		...requestForCall(3),
		actions: Array.from({ length: 47 }, (_, index) => (index % 2 === 0 ? "-adce" : "-dce")),
		hypothesis: label,
	};
}

function singleToolId(index: number): string {
	return `call_${index}|fc_${index}`;
}

function multipleToolId(index: number, suffix: "a" | "b"): string {
	return `call_${index}_${suffix}|fc_${index}_${suffix}`;
}

function semanticValidation(): Record<string, unknown> {
	return {
		base_callbacks_selected: 20,
		inputs: Array.from({ length: 20 }, (_, index) => ({
			completed: true,
			errors: [],
			input_index: index + 1,
			passed: true,
			walltime_seconds: 0.1,
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
	anchor: (typeof TASK_ANCHORS)[number];
}): string {
	const actionIndices = input.actions.map((_, index) => index);
	const deltas = input.actions.map((_, index) =>
		index === input.actions.length - 1 ? input.anchor.finalIr - input.anchor.initialIr : 0,
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
				IrInstructionCount: input.anchor.finalIr - input.anchor.initialIr,
				ObjectTextSizeBytes: input.anchor.finalObject - input.anchor.initialObject,
			},
			final: { IrInstructionCount: input.anchor.finalIr, ObjectTextSizeBytes: input.anchor.finalObject },
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
		terminal_verifier_contract: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
		timings_seconds: { total: 1 },
		validation: semanticValidation(),
	});
}

async function jobFixture(input: {
	outputDir: string;
	callIndex: 1 | 2 | 3 | 4;
	request: StockCpuEvaluationRequest;
	parentJobIds: string[];
}): Promise<JobView> {
	const jobId = `job_${input.callIndex.toString(16).padStart(24, "0")}`;
	const manifestDigest = input.callIndex.toString(16).repeat(64);
	const candidateSha256 = sha256Json(input.request.actions);
	const rawTasks = STOCK_CPU_TASKS.map((benchmarkId, taskIndex) => {
		const stdout = rawEvaluatorStdout({
			benchmarkId,
			actions: input.request.actions,
			anchor: TASK_ANCHORS[taskIndex],
		});
		const stderr = "";
		const slurmId = `${1_706_000 + input.callIndex * 10 + taskIndex}`;
		const jobName = `late-novelty-fixture-${input.callIndex}-${taskIndex}`;
		return {
			accounting: {
				allocCpus: 2,
				cpuTimeRawSeconds: 2,
				elapsedRawSeconds: 1,
				endAt: "2026-08-29T05:00:01",
				exitCode: "0:0",
				jobIdRaw: slurmId,
				jobName,
				nTasks: null,
				nodeList: "barley-01",
				startAt: "2026-08-29T05:00:00",
				state: "COMPLETED",
			},
			benchmarkId,
			evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			exitCode: 0,
			jobName,
			requestSha256: sha256Text(canonicalLine({ actions: input.request.actions, benchmark: benchmarkId })),
			slurmId,
			stderr,
			stderrSha256: sha256Text(stderr),
			stdout,
			stdoutSha256: sha256Text(stdout),
			transientCache: `/tmp/late-novelty-fixture-${input.callIndex}-${taskIndex}`,
			wallMs: 1000,
		};
	});
	const sourceDirectory = `/scratch/private/sources/${COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256}`;
	const aggregate = canonicalLine({
		actionsSha256: candidateSha256,
		candidateSha256,
		contract: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
		evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		jobId,
		manifestDigest,
		measurementReuse: false,
		remoteEvaluatorPath: `${sourceDirectory}/compiler_gym_ir_delta_eval.py`,
		sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
		sourceDirectory,
		tasks: rawTasks,
		verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
	});
	const stdout = await new ArtifactStore(join(input.outputDir, "evaluation", "artifacts")).putString(
		aggregate,
		"application/json",
	);
	const candidateContents = canonicalLine(input.request.actions);
	return {
		proposal: {
			jobId,
			manifestDigest,
			branchId: "late-novelty-audit-fixture",
			lane: "compiler-gym",
			benchmarkIds: [...STOCK_CPU_TASKS],
			budgetClass: "screen",
			treatment: "stock-prime-interface-parity",
			proposal: {
				hypothesis: input.request.hypothesis,
				mechanism: input.request.mechanism,
				predictedOutcome: input.request.predictedOutcome,
				boundaryConditions: [...input.request.boundaryConditions],
				parentJobIds: input.parentJobIds,
			},
			candidate: {
				digest: candidateSha256,
				byteLength: Buffer.byteLength(candidateContents),
				mediaType: "application/json",
			},
			candidateFormat: "llvm-pass-sequence",
			requireFreshMeasurement: true,
		},
		state: {
			jobId,
			status: "succeeded",
			statusAt: `2026-08-29T05:00:0${input.callIndex}.000Z`,
			externalJobId: `${1_706_000 + input.callIndex}`,
			reason: null,
		},
		measurement: {
			jobId,
			manifestDigest,
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
			measuredAt: `2026-08-29T05:00:0${input.callIndex}.000Z`,
			tasks: STOCK_CPU_TASKS.map((benchmarkId, taskIndex) => ({
				benchmarkId,
				status: "accepted" as const,
				metrics: {
					IrInstructionCount: TASK_ANCHORS[taskIndex].finalIr,
					ObjectTextSizeBytes: TASK_ANCHORS[taskIndex].finalObject,
				},
				verifier: { passed: true, checks: ["20-base-semantic-callbacks"], errors: [] },
				runtimeMs: 1000,
			})),
			hardware: { cluster: "Stanford FarmShare" },
			provenance: { ...COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE },
			stdout,
			stderr: null,
		},
	};
}

function responseOrdinalFromToolId(id: string): number {
	const match = /^call_(\d+)/.exec(id);
	if (!match) throw new Error("fixture tool ID lacks response ordinal");
	return Number.parseInt(match[1]!, 10);
}

function assistantLine(toolCalls: Array<{ id: string; arguments: StockCpuEvaluationRequest; name?: string }>): string {
	const ordinal = responseOrdinalFromToolId(toolCalls[0]!.id);
	return JSON.stringify({
		type: "message",
		message: {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: `summary ${ordinal}`,
					thinkingSignature: JSON.stringify({
						type: "reasoning",
						id: `rs_${ordinal}`,
						content: [],
						encrypted_content: `encrypted-${ordinal}`,
						summary: [{ type: "summary_text", text: `summary ${ordinal}` }],
					}),
				},
				{
					type: "text",
					text: `assistant note ${ordinal}`,
					textSignature: JSON.stringify({ v: 1, id: `msg_${ordinal}` }),
				},
				...toolCalls.map((call) => ({
					type: "toolCall",
					id: call.id,
					name: call.name ?? STOCK_INTERFACE_PARITY_TOOL_NAME,
					arguments: call.arguments,
				})),
			],
			stopReason: "toolUse",
			errorMessage: null,
		},
	});
}

function toolResultLine(input: { id: string; isError: boolean; text: string; name?: string }): string {
	return JSON.stringify({
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: input.id,
			toolName: input.name ?? STOCK_INTERFACE_PARITY_TOOL_NAME,
			content: [{ type: "text", text: input.text }],
			isError: input.isError,
		},
	});
}

function abortedAssistantLine(inputTokens = 0): string {
	return JSON.stringify({
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "" }],
			usage: {
				input: inputTokens,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: inputTokens,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "aborted",
			errorMessage: "Request was aborted",
		},
	});
}

function providerPayload(input: {
	prompt: string;
	tool: { name: string; description: string; parameters: unknown };
	sessionId: string;
	normalizedSystemPrompt: string;
	history: Array<{ id: string; request: StockCpuEvaluationRequest; output: string }>;
}): Record<string, unknown> {
	return {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		instructions: input.normalizedSystemPrompt,
		input: [
			{ role: "user", content: [{ type: "input_text", text: input.prompt }] },
			...input.history.flatMap((turn, index) => {
				const [callId, responseItemId] = turn.id.split("|");
				if (!callId || !responseItemId) throw new Error("fixture durable tool ID is not composite");
				return [
					{
						type: "reasoning",
						id: `rs_${index + 1}`,
						content: [],
						encrypted_content: `encrypted-${index + 1}`,
						summary: [{ type: "summary_text", text: `summary ${index + 1}` }],
					},
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: `assistant note ${index + 1}`, annotations: [] }],
						status: "completed",
						id: `msg_${index + 1}`,
					},
					{
						type: "function_call",
						id: responseItemId,
						call_id: callId,
						name: input.tool.name,
						arguments: JSON.stringify(turn.request),
					},
					{ type: "function_call_output", call_id: callId, output: turn.output },
				];
			}),
		],
		text: { verbosity: "low" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: input.sessionId,
		tool_choice: "auto",
		parallel_tool_calls: true,
		service_tier: "priority",
		tools: [{ type: "function", ...input.tool, strict: null }],
		reasoning: { effort: "xhigh", summary: "auto" },
	};
}

function guidanceExposure(providerDispatchOrdinal: number): CompilerGymHardenedPaidGuidanceExposure {
	return {
		providerDispatchOrdinal,
		producerAccepted: false,
		treatmentExpected: false,
		occurrences: 0,
		exactLocation: false,
		exposed: false,
	};
}

interface AuditFixture {
	outputDir: string;
	result: StockTrajectoryResult;
	providerEvidence: CompilerGymHardenedPaidProviderEvidence<"unchanged-control" | "late-novelty-treatment">;
	projectionEvidence: CompilerGymLateNoveltyProjectionEvidence[];
	preflight: CompilerGymLateNoveltyRunnerPreflight;
	lastTranscriptAnchorPath: string;
}

async function writeAuditFixture(kind: PolicyFixtureKind): Promise<AuditFixture> {
	const root = await mkdtemp(join(tmpdir(), "prime-late-novelty-audit-"));
	tempDirectories.push(root);
	const outputDir = join(root, "arm");
	await mkdir(outputDir, { recursive: true, mode: 0o700 });
	const agentDir = join(root, "agent");
	const providerRegistryClosure = await captureCompilerGymLateNoveltyProviderRegistryClosure(agentDir);
	const implementationClosure = COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS.map(
		(relativePath, index) => ({ relativePath, sha256: (index + 1).toString(16).padStart(64, "0") }),
	);
	const stockTrajectoryImplementationBundleSha256 = "2".repeat(64);
	const preregistration = buildCompilerGymLateNoveltyScreenPreregistration({
		createdAt: "2026-08-29T05:00:00.000Z",
		drawHex: "00".repeat(16),
		implementationClosure,
		stockTrajectoryImplementationBundleSha256,
		runtimeWorktreeSnapshot: RUNTIME_SNAPSHOT,
		providerRegistryClosure,
	});
	const preregistrationPath = join(root, "preregistration.json");
	const preregistrationSha256 = await writePrivateCanonicalJson(preregistrationPath, preregistration);
	const globalAttemptLockPath = join(root, "global-attempt.lock");
	const providerRequestAnchorPath = `${preregistrationPath}.provider-request-anchor.json`;
	const preflight: CompilerGymLateNoveltyRunnerPreflight = {
		repoRoot: REPO_ROOT,
		preregistrationPath,
		preregistrationSha256,
		preregistration,
		implementationClosure,
		implementationBundleSha256: preregistration.implementationBundleSha256,
		stockTrajectoryImplementationBundleSha256,
		runtimeWorktreeSnapshot: RUNTIME_SNAPSHOT,
		runtimeWorktreeSnapshotSha256: RUNTIME_SNAPSHOT_SHA256,
		providerRegistryClosure,
		additionalSourcePaths: [],
		globalAttemptLockPath,
		providerRequestAnchorPath,
		calibrationResultPath: join(root, "calibration.json"),
		evaluatorScriptPath: join(root, "evaluator.py"),
	};
	const globalAttemptLockSha256 = await writePrivateCanonicalJson(globalAttemptLockPath, {
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		pairId: preregistration.pairId,
		preregistrationPath,
		preregistrationSha256,
		providerSpecSha256: preregistration.providerSpecSha256,
		stockTrajectoryImplementationBundleSha256,
	});
	const armAttemptLockPath = join(outputDir, "attempt.lock");
	const armAttemptLockSha256 = await writePrivateCanonicalJson(armAttemptLockPath, {
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		arm: "unchanged-control",
		globalAttemptLockSha256,
		providerSpecSha256: preregistration.providerSpecSha256,
		promptSha256: preregistration.frozenCommon.promptSha256,
	});

	const evaluatorCalls =
		kind === "schema-two" || kind === "runner-repeat"
			? 1
			: kind === "schema"
				? 2
				: kind === "schema-four"
					? 3
					: kind === "schema-one" ||
							kind === "wrong-tool" ||
							kind === "multiple-zero" ||
							kind === "multiple-invalid-valid"
						? 0
						: kind === "multiple-one" || kind === "multiple-valid-invalid"
							? 1
							: 4;
	const providerCalls =
		kind === "schema-one"
			? 1
			: kind === "schema-two" || kind === "runner-repeat"
				? 2
				: kind === "schema"
					? 3
					: kind === "schema-four" || kind === "multiple-after-four"
						? 4
						: 1;
	const requests = Array.from({ length: evaluatorCalls }, (_, index) => requestForCall((index + 1) as 1 | 2 | 3 | 4));
	const feedback = requests.map((_, index) =>
		JSON.stringify({
			job: {
				state: { status: "succeeded" },
				measurement: {
					tasks: [
						{
							benchmarkId: STOCK_CPU_TASKS[0],
							status: "accepted",
							verifier: { passed: true },
							metrics: { IrInstructionCount: TASK_ANCHORS[0].finalIr - index },
						},
					],
				},
			},
		}),
	);
	const jobs: JobView[] = [];
	for (let index = 0; index < requests.length; index++) {
		jobs.push(
			await jobFixture({
				outputDir,
				callIndex: (index + 1) as 1 | 2 | 3 | 4,
				request: requests[index]!,
				parentJobIds: index === 0 ? [] : [jobs[index - 1]!.proposal.jobId],
			}),
		);
	}
	const projectionEvidence = feedback.map((text, index) => ({
		submissionOrdinal: index + 1,
		producerAccepted: false,
		guidancePresent: false,
		projectedFeedbackSha256: sha256Json(JSON.parse(text)),
	}));

	const sessionLines: string[] = [];
	for (let index = 0; index < providerCalls - 1; index++) {
		const id = singleToolId(index + 1);
		sessionLines.push(
			assistantLine([{ id, arguments: requests[index]! }]),
			toolResultLine({ id, isError: false, text: feedback[index]! }),
		);
	}
	if (kind === "schema-one" || kind === "schema-two" || kind === "schema" || kind === "schema-four") {
		const boundaryId = singleToolId(providerCalls);
		sessionLines.push(
			assistantLine([{ id: boundaryId, arguments: overlongRequest("schema boundary") }]),
			toolResultLine({ id: boundaryId, isError: true, text: SCHEMA_POLICY_ERROR }),
		);
	} else if (kind === "runner-repeat") {
		const boundaryId = singleToolId(providerCalls);
		sessionLines.push(
			assistantLine([{ id: boundaryId, arguments: requests[0]! }]),
			toolResultLine({
				id: boundaryId,
				isError: true,
				text: "scientific-policy-nonconformance: repeated candidate action vector within arm",
			}),
		);
	} else if (kind === "wrong-tool") {
		const boundaryId = singleToolId(1);
		sessionLines.push(
			assistantLine([{ id: boundaryId, arguments: requestForCall(1), name: "unavailable_tool" }]),
			toolResultLine({
				id: boundaryId,
				isError: true,
				text: "Tool unavailable_tool not found",
				name: "unavailable_tool",
			}),
		);
	} else {
		const providerIndex = providerCalls;
		const calls =
			kind === "multiple-zero" || kind === "multiple-invalid-valid"
				? [
						{ id: multipleToolId(providerIndex, "a"), arguments: overlongRequest("multiple zero a") },
						{
							id: multipleToolId(providerIndex, "b"),
							arguments:
								kind === "multiple-invalid-valid"
									? requestForCall(providerIndex as 1 | 2 | 3 | 4)
									: overlongRequest("multiple zero b"),
						},
					]
				: [
						{ id: multipleToolId(providerIndex, "a"), arguments: requests.at(-1)! },
						{
							id: multipleToolId(providerIndex, "b"),
							arguments:
								kind === "multiple-valid-invalid"
									? overlongRequest("multiple valid invalid")
									: providerIndex === 1
										? requests.at(-1)!
										: requestForCall(providerIndex as 1 | 2 | 3 | 4),
						},
					];
		sessionLines.push(assistantLine(calls));
		if (kind === "multiple-zero" || kind === "multiple-invalid-valid") {
			sessionLines.push(
				toolResultLine({ id: calls[0]!.id, isError: true, text: SCHEMA_POLICY_ERROR }),
				toolResultLine({
					id: calls[1]!.id,
					isError: true,
					text:
						kind === "multiple-invalid-valid"
							? "Evaluator dispatch blocked after a forbidden tool execution in the same provider response"
							: SCHEMA_POLICY_ERROR,
				}),
			);
		} else if (kind === "multiple-valid-invalid") {
			sessionLines.push(
				toolResultLine({ id: calls[0]!.id, isError: false, text: feedback.at(-1)! }),
				toolResultLine({ id: calls[1]!.id, isError: true, text: SCHEMA_POLICY_ERROR }),
			);
		} else {
			sessionLines.push(
				toolResultLine({ id: calls[0]!.id, isError: false, text: feedback.at(-1)! }),
				toolResultLine({ id: calls[1]!.id, isError: true, text: MULTIPLE_GUARD_ERROR }),
			);
		}
	}
	sessionLines.push(abortedAssistantLine());
	const sessionContents = `${sessionLines.join("\n")}\n`;
	const sessionFile = join(root, "session.jsonl");
	await writeFile(sessionFile, sessionContents, { encoding: "utf8", mode: 0o600 });
	await chmod(sessionFile, 0o600);

	const normalizedSystemPrompt = "normalized late-novelty paid screen system prompt";
	const normalizedSystemPromptSha256 = sha256Text(normalizedSystemPrompt);
	const resolvedModelSha256 = sha256Json(RESOLVED_MODEL);
	const runtimeWorktreeDispatchAnchors = [];
	const providerRequestBodySha256s: string[] = [];
	const transcriptAnchors = [];
	const guidanceExposureByDispatch = [];
	const pairRequestBody = JSON.stringify(
		providerPayload({
			prompt: preregistration.providerSpec.prompt,
			tool: preregistration.providerSpec.tool,
			sessionId: preregistration.providerSpec.providerSessionId,
			normalizedSystemPrompt,
			history: [],
		}),
	);
	const pairRequestBodySha256 = sha256Text(pairRequestBody);
	const providerRequestAnchorSha256 = await writePrivateCanonicalJson(providerRequestAnchorPath, {
		runnerProtocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		pairId: preregistration.pairId,
		spec: preregistration.providerSpec,
		specSha256: preregistration.providerSpecSha256,
		preregistrationSha256,
		anchorArm: "unchanged-control",
		normalizedSystemPromptSha256,
		resolvedModel: RESOLVED_MODEL,
		resolvedModelSha256,
		expectedSnapshotSha256: RUNTIME_SNAPSHOT_SHA256,
		firstRuntimeSnapshotSha256: RUNTIME_SNAPSHOT_SHA256,
		firstProviderRequestBody: pairRequestBody,
		firstProviderRequestBodySha256: pairRequestBodySha256,
	});
	let previousDispatchAnchorSha256: string | null = null;
	for (let index = 0; index < providerCalls; index++) {
		const ordinal = index + 1;
		const runtimePath = `${providerRequestAnchorPath}.runtime-worktree.unchanged-control.${ordinal}.json`;
		const runtimeSha256 = await writePrivateCanonicalJson(runtimePath, {
			runnerProtocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
			pairId: preregistration.pairId,
			specSha256: preregistration.providerSpecSha256,
			preregistrationSha256,
			arm: "unchanged-control",
			providerDispatchOrdinal: ordinal,
			runtimeSnapshot: RUNTIME_SNAPSHOT,
			runtimeSha256: RUNTIME_SNAPSHOT_SHA256,
			expectedSnapshotSha256: RUNTIME_SNAPSHOT_SHA256,
			matched: true,
		});
		runtimeWorktreeDispatchAnchors.push({
			providerDispatchOrdinal: ordinal,
			path: runtimePath,
			sha256: runtimeSha256,
			snapshotSha256: RUNTIME_SNAPSHOT_SHA256,
		});
		const payload = providerPayload({
			prompt: preregistration.providerSpec.prompt,
			tool: preregistration.providerSpec.tool,
			sessionId: preregistration.providerSpec.providerSessionId,
			normalizedSystemPrompt,
			history: requests.slice(0, index).map((request, historyIndex) => ({
				id: singleToolId(historyIndex + 1),
				request,
				output: feedback[historyIndex]!,
			})),
		});
		const requestBody = JSON.stringify(payload);
		const requestBodySha256 = sha256Text(requestBody);
		const exposure = guidanceExposure(ordinal);
		guidanceExposureByDispatch.push(exposure);
		providerRequestBodySha256s.push(requestBodySha256);
		const transcriptPath = `${providerRequestAnchorPath}.provider-request.unchanged-control.${ordinal}.json`;
		const transcriptSha256 = await writePrivateCanonicalJson(transcriptPath, {
			schemaVersion: 1,
			runnerProtocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
			pairId: preregistration.pairId,
			preregistrationSha256,
			specSha256: preregistration.providerSpecSha256,
			arm: "unchanged-control",
			providerDispatchOrdinal: ordinal,
			providerSessionId: preregistration.providerSpec.providerSessionId,
			normalizedSystemPrompt,
			normalizedSystemPromptSha256,
			resolvedModel: RESOLVED_MODEL,
			resolvedModelSha256,
			runtimeWorktreeDispatchAnchorPath: runtimePath,
			runtimeWorktreeDispatchAnchorSha256: runtimeSha256,
			pairRequestAnchorSha256: providerRequestAnchorSha256,
			previousDispatchAnchorSha256,
			requestBody,
			requestBodySha256,
			guidanceExposure: exposure,
		});
		transcriptAnchors.push({
			providerDispatchOrdinal: ordinal,
			path: transcriptPath,
			sha256: transcriptSha256,
			requestBodySha256,
			previousDispatchAnchorSha256,
		});
		previousDispatchAnchorSha256 = transcriptSha256;
	}
	const providerEvidence: CompilerGymHardenedPaidProviderEvidence<"unchanged-control" | "late-novelty-treatment"> = {
		arm: "unchanged-control",
		specSha256: preregistration.providerSpecSha256,
		systemPromptEvents: 1,
		workingDirectoryReplacements: 1,
		conversationLogReplacements: 1,
		normalizedSystemPromptSha256,
		normalizedSystemPromptMatchedPairAnchor: true,
		providerRequestBodySha256s,
		guidanceExposureByDispatch,
		firstProviderRequestBodyMatchedPairAnchor: true,
		resolvedModelSnapshotSha256s: Array.from({ length: providerCalls }, () => resolvedModelSha256),
		firstResolvedModelMatchedPairAnchor: true,
		runtimeWorktreeSnapshotSha256s: Array.from({ length: providerCalls }, () => RUNTIME_SNAPSHOT_SHA256),
		runtimeWorktreeSnapshotMatchesPreregistration: Array.from({ length: providerCalls }, () => true),
		providerRequestAnchorPath,
		providerRequestAnchorSha256,
		runtimeWorktreeDispatchAnchors,
		providerRequestTranscriptAnchors: transcriptAnchors,
		failures: [],
	};

	const ledgerPath = join(outputDir, "evaluation", "evidence.jsonl");
	const ledger = await EvidenceLedger.open(ledgerPath);
	const terminalEvent = await ledger.append("run_manifest", { phase: "terminal", fixture: kind });
	const ledgerContents = await readFile(ledgerPath, "utf8");
	const singleBoundary =
		kind === "schema-one" ||
		kind === "schema-two" ||
		kind === "schema" ||
		kind === "schema-four" ||
		kind === "runner-repeat" ||
		kind === "wrong-tool";
	const forbiddenBoundaryEvents = singleBoundary
		? [
				`${kind === "wrong-tool" ? "unavailable_tool" : STOCK_INTERFACE_PARITY_TOOL_NAME} call ${singleToolId(providerCalls)}`,
			]
		: kind === "multiple-zero" || kind === "multiple-invalid-valid"
			? [
					`${STOCK_INTERFACE_PARITY_TOOL_NAME} call ${multipleToolId(providerCalls, "a")}`,
					`${STOCK_INTERFACE_PARITY_TOOL_NAME} call ${multipleToolId(providerCalls, "b")}`,
				]
			: [`${STOCK_INTERFACE_PARITY_TOOL_NAME} call ${multipleToolId(providerCalls, "b")}`];
	const seenToolCallIds = singleBoundary
		? Array.from({ length: providerCalls }, (_, index) => singleToolId(index + 1))
		: [
				...Array.from({ length: providerCalls - 1 }, (_, index) => singleToolId(index + 1)),
				multipleToolId(providerCalls, "a"),
				multipleToolId(providerCalls, "b"),
			];
	const policyOperationalFailures = [
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
	];
	const operationalCheckNames = [
		...policyOperationalFailures,
		"zeroPostTerminalProviderDispatch",
		"singleUserPrompt",
		"noCompaction",
		"freshMeasurements",
		"pairPreregistrationBound",
		"pairPreregistrationIntegrityPassed",
		"ledgerIntegrityPassed",
		"artifactIntegrityPassed",
		"sourceIntegrityPassed",
		"repositoryIntegrityPassed",
		"evaluatorIntegrityPassed",
		"zeroReusedTasks",
	];
	const operationalChecks = Object.fromEntries(
		operationalCheckNames.map((name) => [name, !policyOperationalFailures.includes(name)]),
	);
	const result = {
		ok: false,
		decision: "integrity-invalid",
		claimClass: "directional-single-pair-arm",
		causalClaimAllowed: false,
		failure: `Operational gate failed: ${policyOperationalFailures.join(", ")}`,
		outputDir,
		evaluationDir: join(outputDir, "evaluation"),
		preregistrationPath: join(outputDir, "preregistration.json"),
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		terminalization: "host-owned",
		feedbackView: "full",
		pairPreregistrationPath: preregistrationPath,
		pairPreregistrationSha256: preregistrationSha256,
		pairPreregistrationId: preregistration.pairId,
		pairArmId: "unchanged-control",
		promptDispatchAttemptAnchor: {
			globalAttemptLockPath,
			globalAttemptLockSha256,
			armAttemptLockPath,
			armAttemptLockSha256,
		},
		implementationBundleSha256: stockTrajectoryImplementationBundleSha256,
		expectedMeasurementEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		calibrationDenominatorProvenance: {},
		candidateExpectedProvenance: { ...COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE },
		stockSelectionProjectedProvenance: {},
		model: "openai-codex/gpt-5.6-luna",
		thinkingLevel: "xhigh",
		requestedAndLocallyEffectiveServiceTier: "priority",
		upstreamServiceTierAcknowledgement: "not exposed by current provider response API",
		transport: "sse",
		providerMaxRetries: 0,
		sessionId: preregistration.providerSpec.providerSessionId,
		providerSessionId: preregistration.providerSpec.providerSessionId,
		providerVisibleSystemPromptPolicy: COMPILER_GYM_LATE_NOVELTY_SCREEN_SYSTEM_PROMPT_POLICY,
		sessionFile,
		sessionSha256: sha256Text(sessionContents),
		knownRootMessageUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
		attributedSessionTokens: 0,
		providerTracker: {
			outputTokens: 0,
			providerCalls,
			blockedProviderCalls: 1,
			blockedReasons: ["forbidden-tool-execution"],
		},
		stopProviderAfterForbiddenToolExecution: true,
		latchForbiddenToolExecutionWithinResponse: true,
		hostTerminalizationTracker: {
			providerDispatches: providerCalls,
			providerDispatchesAtTerminal: evaluatorCalls === 4 ? 4 : null,
			postTerminalProviderDispatches: 0,
			terminalizationStops: 0,
			evaluatorToolCalls: evaluatorCalls,
			postTerminalEvaluatorToolCalls: 0,
			readOnlyDeviationEvents: [],
			forbiddenBoundaryEvents,
			seenToolCallIds,
		},
		hostTerminalizationAssessment: {
			policy: {},
			completionGate: {},
			championSelection: {},
			hostSelectedJobId: jobs[0]?.proposal.jobId ?? null,
			assistantReport: {},
			measurementQualified: false,
			terminalizationRuntimeConformant: false,
			hardFailures: [],
			deviations: [],
		},
		trace: {
			callCount: evaluatorCalls,
			duplicateCount: 0,
			evaluatorWaitMs: 0,
			jobIds: jobs.map((job) => job.proposal.jobId),
			requests,
			modelFeedbackBytes: feedback.map((text) => Buffer.byteLength(text, "utf8")),
		},
		jobs,
		budget: {
			branchId: "late-novelty-audit-fixture",
			submissions: evaluatorCalls,
			taskEvaluations: evaluatorCalls * STOCK_CPU_TASKS.length,
			actualTaskEvaluations: evaluatorCalls * STOCK_CPU_TASKS.length,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: 4,
			maxTaskEvaluations: 8,
			remainingSubmissions: 4 - evaluatorCalls,
			remainingTaskEvaluations: 8 - evaluatorCalls * 2,
		},
		operationalGate: { passed: false, checks: operationalChecks, failures: policyOperationalFailures },
		qualityGate: {},
		championSelection: {},
		completionGate: {},
		artifactIntegrity: { passed: true, failures: [] },
		sourceIntegrityPassed: true,
		repositoryIntegrityPassed: true,
		evaluatorIntegrityPassed: true,
		measurementProvenanceIntegrityPassed: true,
		pairPreregistrationIntegrityPassed: true,
		repositoryBefore: RUNTIME_SNAPSHOT,
		repositoryAfter: RUNTIME_SNAPSHOT,
		sourceHashesBefore: [],
		sourceHashesAfter: [],
		eventCounts: {},
		terminalLedgerEventHash: terminalEvent.hash,
		ledgerSha256: sha256Text(ledgerContents),
	} as unknown as StockTrajectoryResult;
	await writePrivateCanonicalJson(join(outputDir, "result.json"), result);
	return {
		outputDir,
		result,
		providerEvidence,
		projectionEvidence,
		preflight,
		lastTranscriptAnchorPath: transcriptAnchors.at(-1)!.path,
	};
}

async function auditFixture(fixture: AuditFixture) {
	return auditCompilerGymLateNoveltyArm({
		arm: "unchanged-control",
		armOutputDir: fixture.outputDir,
		result: fixture.result,
		providerEvidence: fixture.providerEvidence,
		projectionEvidence: fixture.projectionEvidence,
		preflight: fixture.preflight,
	});
}

async function rewriteLastTranscriptBody(
	fixture: AuditFixture,
	mutate: (payload: Record<string, unknown>) => void,
): Promise<void> {
	const anchor = JSON.parse(await readFile(fixture.lastTranscriptAnchorPath, "utf8")) as Record<string, unknown>;
	if (typeof anchor.requestBody !== "string") throw new Error("fixture transcript anchor lacks requestBody");
	const payload = JSON.parse(anchor.requestBody) as Record<string, unknown>;
	mutate(payload);
	const requestBody = JSON.stringify(payload);
	const requestBodySha256 = sha256Text(requestBody);
	anchor.requestBody = requestBody;
	anchor.requestBodySha256 = requestBodySha256;
	const transcript = fixture.providerEvidence.providerRequestTranscriptAnchors.at(-1)!;
	transcript.requestBodySha256 = requestBodySha256;
	transcript.sha256 = await writePrivateCanonicalJson(fixture.lastTranscriptAnchorPath, anchor, false);
	fixture.providerEvidence.providerRequestBodySha256s[fixture.providerEvidence.providerRequestBodySha256s.length - 1] =
		requestBodySha256;
}

describe("CompilerGym prospective late-novelty arm audit", () => {
	it("classifies the exact 47-action third-call boundary as scientific with complete 3/2/4 accounting", async () => {
		const audit = await auditFixture(await writeAuditFixture("schema"));
		assert.deepEqual(audit.apparatusFailures, []);
		assert.equal(audit.disposition, "terminal-scientific-policy-nonconformance");
		assert.equal(audit.accountingComplete, true);
		assert.equal(audit.providerDispatches, 3);
		assert.equal(audit.evaluatorJobs, 2);
		assert.equal(audit.freshTaskEvaluations, 4);
		assert.equal(audit.candidates.length, 2);
		assert.equal(
			audit.policyFailures.some((failure) => failure.includes(SCHEMA_POLICY_ERROR)),
			true,
		);
	});

	for (const [kind, expectedProvider, expectedEvaluator] of [
		["schema-two", 2, 1],
		["schema-four", 4, 3],
	] as const) {
		it(`classifies an exact adaptive ${kind} over-46 boundary as scientific`, async () => {
			const audit = await auditFixture(await writeAuditFixture(kind));
			assert.equal(audit.disposition, "terminal-scientific-policy-nonconformance");
			assert.deepEqual(audit.apparatusFailures, []);
			assert.equal(audit.accountingComplete, true);
			assert.equal(audit.providerDispatches, expectedProvider);
			assert.equal(audit.evaluatorJobs, expectedEvaluator);
		});
	}

	it("keeps a first-call over-46 request apparatus-invalid because it replaces the frozen S12 anchor", async () => {
		const audit = await auditFixture(await writeAuditFixture("schema-one"));
		assert.equal(audit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(audit.accountingComplete, false);
		assert.equal(audit.providerDispatches, null);
	});

	for (const kind of ["runner-repeat", "wrong-tool"] as const) {
		it(`classifies the exact ${kind} model-policy local abort as scientific`, async () => {
			const audit = await auditFixture(await writeAuditFixture(kind));
			assert.equal(audit.disposition, "terminal-scientific-policy-nonconformance");
			assert.deepEqual(audit.apparatusFailures, []);
			assert.equal(audit.accountingComplete, true);
			assert.equal(audit.providerDispatches, kind === "runner-repeat" ? 2 : 1);
			assert.equal(audit.evaluatorJobs, kind === "runner-repeat" ? 1 : 0);
		});
	}

	for (const [kind, expected] of [
		["multiple-zero", { provider: 1, evaluator: 0, tasks: 0 }],
		["multiple-invalid-valid", { provider: 1, evaluator: 0, tasks: 0 }],
		["multiple-valid-invalid", { provider: 1, evaluator: 1, tasks: 2 }],
		["multiple-one", { provider: 1, evaluator: 1, tasks: 2 }],
		["multiple-after-four", { provider: 4, evaluator: 4, tasks: 8 }],
	] as const) {
		it(`classifies the exact ${kind} multiple-call prefix as scientific`, async () => {
			const audit = await auditFixture(await writeAuditFixture(kind));
			assert.equal(audit.disposition, "terminal-scientific-policy-nonconformance");
			assert.deepEqual(audit.apparatusFailures, []);
			assert.equal(audit.accountingComplete, true);
			assert.equal(audit.providerDispatches, expected.provider);
			assert.equal(audit.evaluatorJobs, expected.evaluator);
			assert.equal(audit.freshTaskEvaluations, expected.tasks);
			assert.equal(
				audit.policyFailures.some((failure) => failure.includes("multiple evaluator tool calls")),
				true,
			);
		});
	}

	it("keeps a valid single-tool evaluator failure apparatus-invalid", async () => {
		const fixture = await writeAuditFixture("schema");
		const sessionPath = fixture.result.sessionFile;
		const contents = await readFile(sessionPath, "utf8");
		const mutated = contents.replace(SCHEMA_POLICY_ERROR, "ECONNRESET from evaluator transport");
		await writeFile(sessionPath, mutated, { encoding: "utf8", mode: 0o600 });
		fixture.result.sessionSha256 = sha256Text(mutated);
		await writePrivateCanonicalJson(join(fixture.outputDir, "result.json"), fixture.result, false);
		const audit = await auditFixture(fixture);
		assert.equal(audit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(audit.accountingComplete, false);
		assert.equal(audit.providerDispatches, null);
		assert.notEqual(audit.apparatusFailures.length, 0);
	});

	it("requires the prospective same-response forbidden-tool latch in the durable trajectory result", async () => {
		const fixture = await writeAuditFixture("schema");
		fixture.result.latchForbiddenToolExecutionWithinResponse = false;
		await writePrivateCanonicalJson(join(fixture.outputDir, "result.json"), fixture.result, false);
		const audit = await auditFixture(fixture);
		assert.equal(audit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(
			audit.apparatusFailures.some((failure) => failure.includes("same-response forbidden-tool latch")),
			true,
		);
	});

	it("rejects rehashed provider transcript mutations to prior arguments and measured results", async () => {
		const argumentsFixture = await writeAuditFixture("schema");
		await rewriteLastTranscriptBody(argumentsFixture, (payload) => {
			assert.ok(Array.isArray(payload.input));
			const call = payload.input.find(
				(item) =>
					typeof item === "object" && item !== null && (item as { type?: unknown }).type === "function_call",
			) as Record<string, unknown>;
			const parsed = JSON.parse(String(call.arguments)) as Record<string, unknown>;
			parsed.hypothesis = "provider-only mutated hypothesis";
			call.arguments = JSON.stringify(parsed);
		});
		const argumentsAudit = await auditFixture(argumentsFixture);
		assert.equal(argumentsAudit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(
			argumentsAudit.apparatusFailures.some((failure) => failure.includes("durable session/projection evidence")),
			true,
		);

		const resultFixture = await writeAuditFixture("schema");
		await rewriteLastTranscriptBody(resultFixture, (payload) => {
			assert.ok(Array.isArray(payload.input));
			const output = payload.input.find(
				(item) =>
					typeof item === "object" &&
					item !== null &&
					(item as { type?: unknown }).type === "function_call_output",
			) as Record<string, unknown>;
			const parsed = JSON.parse(String(output.output)) as {
				job: { measurement: { tasks: Array<{ metrics: { IrInstructionCount: number } }> } };
			};
			parsed.job.measurement.tasks[0]!.metrics.IrInstructionCount = 999;
			output.output = JSON.stringify(parsed);
		});
		const resultAudit = await auditFixture(resultFixture);
		assert.equal(resultAudit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(
			resultAudit.apparatusFailures.some((failure) => failure.includes("durable session/projection evidence")),
			true,
		);
	});

	it("rejects nested guidance leakage and transcript ordinal drift", async () => {
		const guidanceFixture = await writeAuditFixture("schema");
		await rewriteLastTranscriptBody(guidanceFixture, (payload) => {
			assert.ok(Array.isArray(payload.input));
			const output = payload.input.find(
				(item) =>
					typeof item === "object" &&
					item !== null &&
					(item as { type?: unknown }).type === "function_call_output",
			) as Record<string, unknown>;
			output.output = JSON.stringify({ nested: { [COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD]: "leak" } });
		});
		const guidanceAudit = await auditFixture(guidanceFixture);
		assert.equal(guidanceAudit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(
			guidanceAudit.apparatusFailures.some((failure) => failure.includes("guidance")),
			true,
		);

		const ordinalFixture = await writeAuditFixture("schema");
		ordinalFixture.providerEvidence.providerRequestTranscriptAnchors.at(-1)!.providerDispatchOrdinal = 2;
		const ordinalAudit = await auditFixture(ordinalFixture);
		assert.equal(ordinalAudit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(
			ordinalAudit.apparatusFailures.some((failure) => failure.includes("identity drifted")),
			true,
		);
	});

	it("binds rehashed reasoning, summary, assistant text, and text-signature history to durable blocks", async () => {
		for (const mutation of ["encrypted", "summary", "text", "signature"] as const) {
			const fixture = await writeAuditFixture("schema");
			await rewriteLastTranscriptBody(fixture, (payload) => {
				assert.ok(Array.isArray(payload.input));
				if (mutation === "encrypted" || mutation === "summary") {
					const reasoning = payload.input.find(
						(item) =>
							typeof item === "object" && item !== null && (item as { type?: unknown }).type === "reasoning",
					) as Record<string, unknown>;
					if (mutation === "encrypted") reasoning.encrypted_content = "mutated-encrypted-content";
					else reasoning.summary = [{ type: "summary_text", text: "mutated summary" }];
				} else {
					const message = payload.input.find(
						(item) =>
							typeof item === "object" && item !== null && (item as { type?: unknown }).type === "message",
					) as Record<string, unknown>;
					if (mutation === "signature") message.id = "msg_mutated";
					else {
						const content = message.content as Array<Record<string, unknown>>;
						content[0]!.text = "mutated assistant text";
					}
				}
			});
			const audit = await auditFixture(fixture);
			assert.equal(audit.disposition, "terminal-apparatus-invalid-not-treatment-result");
			assert.equal(
				audit.apparatusFailures.some((failure) => failure.includes("durable session/projection evidence")),
				true,
			);
		}
	});
});

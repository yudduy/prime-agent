import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../src/artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE } from "../src/compiler-gym-ir-delta-screen-adapter.js";
import {
	buildCompilerGymIrDeltaScreenPreregistration,
	COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
	collectCompilerGymIrDeltaScreenImplementationClosure,
	writeCompilerGymIrDeltaScreenPreregistration,
} from "../src/compiler-gym-ir-delta-screen-preregistration.js";
import {
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT,
	COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
	type CompilerGymIrDeltaScreenArm,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	auditCompilerGymIrDeltaScreenArm,
	COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_SYSTEM_PROMPT_POLICY,
	type CompilerGymIrDeltaScreenProviderVisibilityEvidence,
	createCompilerGymIrDeltaScreenPairAnchorLoader,
	prepareCompilerGymIrDeltaScreenRun,
} from "../src/compiler-gym-ir-delta-screen-runner.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "../src/compiler-gym-ir-delta-smoke-protocol.js";
import { EvidenceLedger } from "../src/ledger.js";
import { STOCK_CPU_TASKS, type StockCpuEvaluationRequest } from "../src/stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	type runStockInterfaceParityTrajectory,
} from "../src/stock-interface-parity.js";
import {
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
} from "../src/stock-interface-parity-protocol.js";
import type { JobView } from "../src/types.js";

type StockTrajectoryResult = Awaited<ReturnType<typeof runStockInterfaceParityTrajectory>>;

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUNTIME_WORKTREE_SNAPSHOT = capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT);
const RUNTIME_WORKTREE_SNAPSHOT_SHA256 = sha256Json(RUNTIME_WORKTREE_SNAPSHOT);
const TASK_ANCHORS = [
	{ initialIr: 3898, initialObject: 16_573, finalIr: 1970, finalObject: 21_501 },
	{ initialIr: 28_748, initialObject: 122_613, finalIr: 13_838, finalObject: 166_545 },
] as const;

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

async function writePrivateCanonicalJson(path: string, value: unknown): Promise<string> {
	const contents = canonicalLine(value);
	await writeFile(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
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

function semanticValidation(rejected: boolean): Record<string, unknown> {
	const semanticError = { code: "semantic-mismatch", input_index: 1 };
	return {
		base_callbacks_selected: 20,
		inputs: Array.from({ length: 20 }, (_, index) => ({
			completed: true,
			errors: rejected && index === 0 ? [semanticError] : [],
			input_index: index + 1,
			passed: !(rejected && index === 0),
			walltime_seconds: 0.1,
		})),
		inputs_completed: 20,
		inputs_expected: 20,
		passed: !rejected,
		registered_callback_group_size: 5,
		sanitizer_callbacks_excluded: 80,
		sanitizer_callbacks_selected: 0,
		semantic_errors: rejected ? [semanticError] : [],
		worker_count_source: "SLURM_CPUS_PER_TASK",
		workers: 2,
	};
}

function rawEvaluatorStdout(input: {
	benchmarkId: (typeof STOCK_CPU_TASKS)[number];
	actions: readonly string[];
	anchor: (typeof TASK_ANCHORS)[number];
	rejected: boolean;
}): string {
	const actionIndices = input.actions.map((_, index) => index);
	const deltas = input.actions.map((_, index) =>
		index === input.actions.length - 1 ? input.anchor.finalIr - input.anchor.initialIr : 0,
	);
	const result: Record<string, unknown> = {
		action_indices: actionIndices,
		benchmark: input.benchmarkId,
		commandline: `opt ${input.actions.join(" ")} input.bc -o output.bc`,
		contract: COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT,
		environment: {},
		metrics: {
			delta_final_minus_initial: {
				IrInstructionCount: input.anchor.finalIr - input.anchor.initialIr,
				ObjectTextSizeBytes: input.anchor.finalObject - input.anchor.initialObject,
			},
			final: {
				IrInstructionCount: input.anchor.finalIr,
				ObjectTextSizeBytes: input.anchor.finalObject,
			},
			improvement_fraction: { IrInstructionCount: 0.1, ObjectTextSizeBytes: -0.1 },
			initial: {
				IrInstructionCount: input.anchor.initialIr,
				ObjectTextSizeBytes: input.anchor.initialObject,
			},
		},
		ok: !input.rejected,
		provenance: {},
		request: { actions: [...input.actions], benchmark: input.benchmarkId },
		schema_version: 2,
		status: input.rejected ? "semantic_validation_failed" : "passed",
		step_info: { reason: "pass metadata excluded", retained: false },
		terminal_verifier_contract: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
		timings_seconds: { total: 1 },
		validation: semanticValidation(input.rejected),
	};
	if (!input.rejected) {
		result.action_trace = {
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
		};
	}
	return canonicalLine(result);
}

function accounting(input: { slurmId: string; jobName: string; rejected: boolean }): Record<string, unknown> {
	return {
		allocCpus: 2,
		cpuTimeRawSeconds: 2,
		elapsedRawSeconds: 1,
		endAt: "2026-08-29T01:00:01",
		exitCode: input.rejected ? "5:0" : "0:0",
		jobIdRaw: input.slurmId,
		jobName: input.jobName,
		nTasks: null,
		nodeList: "barley-01",
		startAt: "2026-08-29T01:00:00",
		state: input.rejected ? "FAILED" : "COMPLETED",
	};
}

async function jobFixture(input: {
	outputDir: string;
	callIndex: 1 | 2 | 3 | 4;
	request: StockCpuEvaluationRequest;
	parentJobIds: string[];
	rejectedTask?: number;
}): Promise<{ job: JobView; aggregate: string }> {
	const jobId = `job_${input.callIndex.toString(16).padStart(24, "0")}`;
	const manifestDigest = input.callIndex.toString(16).repeat(64);
	const candidateSha256 = sha256Json(input.request.actions);
	const rawTasks = STOCK_CPU_TASKS.map((benchmarkId, taskIndex) => {
		const rejected = input.rejectedTask === taskIndex;
		const stdout = rawEvaluatorStdout({
			benchmarkId,
			actions: input.request.actions,
			anchor: TASK_ANCHORS[taskIndex],
			rejected,
		});
		const stderr = "";
		const slurmId = `${1_704_000 + input.callIndex * 10 + taskIndex}`;
		const jobName = `paid-screen-${input.callIndex}-${taskIndex}`;
		return {
			accounting: accounting({ slurmId, jobName, rejected }),
			benchmarkId,
			evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			exitCode: rejected ? 5 : 0,
			jobName,
			requestSha256: sha256Text(canonicalLine({ actions: input.request.actions, benchmark: benchmarkId })),
			slurmId,
			stderr,
			stderrSha256: sha256Text(stderr),
			stdout,
			stdoutSha256: sha256Text(stdout),
			transientCache: `/tmp/paid-screen-${input.callIndex}-${taskIndex}`,
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
	const stateStatus = input.rejectedTask === undefined ? "succeeded" : "invalid";
	const job: JobView = {
		proposal: {
			jobId,
			manifestDigest,
			branchId: "paid-screen-fixture",
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
			status: stateStatus,
			statusAt: `2026-08-29T01:00:0${input.callIndex}.000Z`,
			externalJobId: `${1_704_000 + input.callIndex}`,
			reason: null,
		},
		measurement: {
			jobId,
			manifestDigest,
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
			measuredAt: `2026-08-29T01:00:0${input.callIndex}.000Z`,
			tasks: STOCK_CPU_TASKS.map((benchmarkId, taskIndex) => {
				const rejected = input.rejectedTask === taskIndex;
				const anchor = TASK_ANCHORS[taskIndex];
				return {
					benchmarkId,
					status: rejected ? "rejected" : "accepted",
					metrics: {
						IrInstructionCount: anchor.finalIr,
						ObjectTextSizeBytes: anchor.finalObject,
					},
					verifier: {
						passed: !rejected,
						checks: ["20-base-semantic-callbacks"],
						errors: rejected ? ["semantic"] : [],
					},
					runtimeMs: 1000,
				};
			}),
			hardware: { cluster: "Stanford FarmShare" },
			provenance: { ...COMPILER_GYM_IR_DELTA_SCREEN_EXPECTED_PROVENANCE },
			stdout,
			stderr: null,
		},
	};
	return { job, aggregate };
}

function assistantLine(input: { index: number; toolName: string; arguments: unknown }): string {
	return JSON.stringify({
		type: "message",
		message: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: `tool-call-${input.index}`,
					name: input.toolName,
					arguments: input.arguments,
				},
			],
			stopReason: "toolUse",
			errorMessage: null,
		},
	});
}

function toolResultLine(input: { index: number; isError: boolean; text: string }): string {
	return JSON.stringify({
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: `tool-call-${input.index}`,
			toolName: STOCK_INTERFACE_PARITY_TOOL_NAME,
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

async function writeArmFixture(
	input: {
		arm?: CompilerGymIrDeltaScreenArm;
		semanticRejectionCall?: 2 | 3 | 4;
		policyStop?: boolean;
		v2PolicyAbort?: boolean;
		syntheticAbortInputTokens?: number;
		sessionToolArguments?: (request: StockCpuEvaluationRequest, index: number) => unknown;
		mutateResult?: (result: StockTrajectoryResult) => void;
	} = {},
): Promise<{
	outputDir: string;
	result: StockTrajectoryResult;
	providerVisibility: CompilerGymIrDeltaScreenProviderVisibilityEvidence;
}> {
	const outputDir = await mkdtemp(join(tmpdir(), "prime-ir-delta-runner-arm-"));
	const sessionFile = join(outputDir, "session.jsonl");
	const ledgerPath = join(outputDir, "evaluation", "evidence.jsonl");
	const ledger = await EvidenceLedger.open(ledgerPath);
	const terminalEvent = await ledger.append("run_manifest", { phase: "terminal", fixture: true });
	const requests = [1, 2, 3, 4].map((callIndex) => requestForCall(callIndex as 1 | 2 | 3 | 4));
	const jobs: JobView[] = [];
	for (let index = 0; index < requests.length; index++) {
		const callIndex = (index + 1) as 1 | 2 | 3 | 4;
		const fixture = await jobFixture({
			outputDir,
			callIndex,
			request: requests[index]!,
			parentJobIds: index === 0 ? [] : [jobs[index - 1]!.proposal.jobId],
			rejectedTask: input.semanticRejectionCall === callIndex ? 0 : undefined,
		});
		jobs.push(fixture.job);
	}

	const policyStop = input.policyStop ?? false;
	const v2PolicyAbort = input.v2PolicyAbort ?? false;
	const policyTermination = policyStop || v2PolicyAbort;
	const invalidV2Request: StockCpuEvaluationRequest = {
		...requestForCall(3),
		actions: Array.from({ length: 47 }, (_, index) => (index % 2 === 0 ? "-adce" : "-dce")),
	};
	const sessionContents = v2PolicyAbort
		? `${[
				assistantLine({ index: 1, toolName: STOCK_INTERFACE_PARITY_TOOL_NAME, arguments: requests[0] }),
				toolResultLine({ index: 1, isError: false, text: "verified call one" }),
				assistantLine({ index: 2, toolName: STOCK_INTERFACE_PARITY_TOOL_NAME, arguments: requests[1] }),
				toolResultLine({ index: 2, isError: false, text: "verified call two" }),
				assistantLine({ index: 3, toolName: STOCK_INTERFACE_PARITY_TOOL_NAME, arguments: invalidV2Request }),
				toolResultLine({
					index: 3,
					isError: true,
					text: "scientific-policy-nonconformance: actions must contain from 1 through 46 flags",
				}),
				abortedAssistantLine(input.syntheticAbortInputTokens ?? 0),
			].join("\n")}\n`
		: policyStop
			? `${assistantLine({ index: 1, toolName: "forbidden_wrong_tool", arguments: {} })}\n`
			: `${requests
					.map((request, index) =>
						assistantLine({
							index: index + 1,
							toolName: STOCK_INTERFACE_PARITY_TOOL_NAME,
							arguments: input.sessionToolArguments?.(structuredClone(request), index) ?? request,
						}),
					)
					.join("\n")}\n`;
	await writeFile(sessionFile, sessionContents, { encoding: "utf8", mode: 0o600 });
	await chmod(sessionFile, 0o600);
	const ledgerContents = await readFile(ledgerPath, "utf8");
	const semanticRejection = input.semanticRejectionCall !== undefined;
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
	const semanticFailures = ["measurementQualified", "terminalizationRuntimeConformant"];
	const operationalFailures = policyTermination
		? policyOperationalFailures
		: semanticRejection
			? semanticFailures
			: [];
	const operationalCheckNames = [
		"exactJobCount",
		"exactToolCalls",
		"exactProviderCalls",
		"providerTrackerConsistent",
		"providerBudgetUnblocked",
		"exactHostTerminalizationStop",
		"zeroPostTerminalProviderDispatch",
		"singleUserPrompt",
		"noCompaction",
		"noDuplicateDispatch",
		"exactLineage",
		"freshMeasurements",
		"exactLogicalTaskBudget",
		"exactActualTaskBudget",
		"zeroReusedTasks",
		"exactFeedbackResults",
		"pairPreregistrationBound",
		"pairPreregistrationIntegrityPassed",
		"ledgerIntegrityPassed",
		"artifactIntegrityPassed",
		"sourceIntegrityPassed",
		"repositoryIntegrityPassed",
		"evaluatorIntegrityPassed",
		"noForbiddenBoundaryEvents",
		"measurementQualified",
		"terminalizationRuntimeConformant",
	] as const;
	const operationalChecks = Object.fromEntries(
		operationalCheckNames.map((name) => [name, !operationalFailures.includes(name)]),
	);
	const arm = input.arm ?? "hidden-control";
	const providerSessionId = "paid-screen-fixture-session";
	const pairPreregistrationPath = join(outputDir, "pair-preregistration.json");
	const globalAttemptLockPath = `${pairPreregistrationPath}.attempt.lock`;
	const globalAttemptLockSha256 = await writePrivateCanonicalJson(globalAttemptLockPath, {
		protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
		preregistrationSha256: "a".repeat(64),
		providerSessionId,
		resolvedModelPolicy: COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
		firstArm: arm,
		createdAt: "2026-08-29T01:00:00.000Z",
	});
	const armAttemptLockPath = join(outputDir, "attempt.lock");
	const armAttemptLockSha256 = await writePrivateCanonicalJson(armAttemptLockPath, {
		protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
		arm,
		armOrdinal: 1,
		globalAttemptLockSha256,
		armPreregistrationSha256: "a".repeat(64),
		promptSha256: sha256Text(buildCompilerGymIrDeltaScreenPrompt()),
		createdAt: "2026-08-29T01:00:01.000Z",
	});
	const providerDispatches = v2PolicyAbort ? 3 : policyStop ? 1 : 4;
	const normalizedSystemPromptSha256 = sha256Text("normalized paid-screen system prompt");
	const providerRequestBodies = Array.from({ length: providerDispatches }, (_, index) =>
		JSON.stringify({
			model: "gpt-5.6-luna",
			ordinal: index + 1,
			prompt_cache_key: providerSessionId,
		}),
	);
	const providerRequestBodySha256s = providerRequestBodies.map((body) => sha256Text(body));
	const resolvedModelSnapshot = {
		registryModel: {
			provider: "openai-codex",
			id: "gpt-5.6-luna",
			api: "openai-codex-responses",
			baseUrl: "https://chatgpt.com/backend-api",
			headerNames: [],
		},
		sessionModel: {
			provider: "openai-codex",
			id: "gpt-5.6-luna",
			api: "openai-codex-responses",
			baseUrl: "https://chatgpt.com/backend-api",
			headerNames: [],
		},
		registryLoadErrorPresent: false,
		storedCredentialType: "oauth" as const,
		oauthProviderRegistered: true,
		requestAuthResolved: true,
		apiKeyPresent: true,
		selectedAuthSource: "stored",
		resolvedRequestHeaderNames: [],
	};
	const resolvedModelSnapshots = Array.from({ length: providerDispatches }, () =>
		structuredClone(resolvedModelSnapshot),
	);
	const resolvedModelSnapshotSha256s = resolvedModelSnapshots.map((snapshot) => sha256Json(snapshot));
	const providerRequestAnchorPath = `${pairPreregistrationPath}.provider-request-anchor.json`;
	const runtimeWorktreeDispatchAnchors = await Promise.all(
		Array.from({ length: providerDispatches }, async (_, index) => {
			const providerDispatchOrdinal = index + 1;
			const path = `${providerRequestAnchorPath}.runtime-worktree.${arm}.${providerDispatchOrdinal}.json`;
			const sha256 = await writePrivateCanonicalJson(path, {
				protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
				pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
				preregistrationSha256: "a".repeat(64),
				arm,
				providerDispatchOrdinal,
				expectedRuntimeWorktreeSnapshotSha256: RUNTIME_WORKTREE_SNAPSHOT_SHA256,
				runtimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
				runtimeWorktreeSnapshotSha256: RUNTIME_WORKTREE_SNAPSHOT_SHA256,
				matchedPreregistration: true,
				capturedAt: "2026-08-29T01:00:02.000Z",
			});
			return {
				providerDispatchOrdinal,
				path,
				sha256,
				snapshotSha256: RUNTIME_WORKTREE_SNAPSHOT_SHA256,
				matchedPreregistration: true,
			};
		}),
	);
	const providerRequestAnchorSha256 = await writePrivateCanonicalJson(providerRequestAnchorPath, {
		protocol: COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
		preregistrationSha256: "a".repeat(64),
		providerSessionId,
		normalizedSystemPromptSha256,
		resolvedModelPolicy: COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
		resolvedModelSnapshot,
		resolvedModelSnapshotSha256: resolvedModelSnapshotSha256s[0],
		expectedRuntimeWorktreeSnapshotSha256: RUNTIME_WORKTREE_SNAPSHOT_SHA256,
		firstRuntimeWorktreeSnapshotSha256: RUNTIME_WORKTREE_SNAPSHOT_SHA256,
		firstRuntimeWorktreeDispatchAnchorPath: runtimeWorktreeDispatchAnchors[0]!.path,
		firstRuntimeWorktreeDispatchAnchorSha256: runtimeWorktreeDispatchAnchors[0]!.sha256,
		firstProviderRequestBodySha256: providerRequestBodySha256s[0],
		firstProviderRequestBody: providerRequestBodies[0],
		anchorArm: arm,
		createdAt: "2026-08-29T01:00:02.000Z",
	});
	const providerVisibility: CompilerGymIrDeltaScreenProviderVisibilityEvidence = {
		arm,
		providerSessionId,
		systemPromptEvents: 1,
		workingDirectoryReplacements: 1,
		conversationLogReplacements: 1,
		normalizedSystemPromptSha256,
		normalizedSystemPromptMatchedPairAnchor: true,
		providerRequestBodySha256s,
		firstProviderRequestBodyMatchedPairAnchor: true,
		providerRequestAnchorPath,
		providerRequestAnchorSha256,
		resolvedModelPolicy: COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
		resolvedModelSnapshots,
		resolvedModelSnapshotSha256s,
		firstResolvedModelMatchedPairAnchor: true,
		expectedRuntimeWorktreeSnapshotSha256: RUNTIME_WORKTREE_SNAPSHOT_SHA256,
		runtimeWorktreeSnapshotSha256s: Array.from(
			{ length: providerDispatches },
			() => RUNTIME_WORKTREE_SNAPSHOT_SHA256,
		),
		runtimeWorktreeSnapshotMatchesPreregistration: Array.from({ length: providerDispatches }, () => true),
		runtimeWorktreeDispatchAnchors,
		failures: [],
	};
	const operationalFailureText = `Operational gate failed: ${operationalFailures.join(", ")}`;
	const result = {
		ok: operationalFailures.length === 0,
		decision: operationalFailures.length === 0 ? "not-promising" : "integrity-invalid",
		claimClass: "directional-single-pair-arm",
		causalClaimAllowed: false,
		failure: operationalFailures.length === 0 ? null : operationalFailureText,
		outputDir,
		evaluationDir: join(outputDir, "evaluation"),
		preregistrationPath: join(outputDir, "preregistration.json"),
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		terminalization: "host-owned",
		feedbackView: "full",
		pairPreregistrationPath,
		pairPreregistrationSha256: "a".repeat(64),
		pairPreregistrationId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
		pairArmId: arm,
		promptDispatchAttemptAnchor: {
			globalAttemptLockPath,
			globalAttemptLockSha256,
			armAttemptLockPath,
			armAttemptLockSha256,
		},
		implementationBundleSha256: "b".repeat(64),
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
		sessionId: providerSessionId,
		providerSessionId,
		providerVisibleSystemPromptPolicy: COMPILER_GYM_IR_DELTA_SCREEN_SYSTEM_PROMPT_POLICY,
		sessionFile,
		sessionSha256: sha256Text(sessionContents),
		knownRootMessageUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
		attributedSessionTokens: 0,
		providerTracker: {
			outputTokens: 0,
			providerCalls: providerDispatches,
			blockedProviderCalls: policyTermination ? 1 : 0,
			blockedReasons: policyTermination ? ["forbidden-tool-execution"] : [],
		},
		stopProviderAfterForbiddenToolExecution: true,
		hostTerminalizationTracker: {
			providerDispatches,
			providerDispatchesAtTerminal: policyTermination ? null : 4,
			postTerminalProviderDispatches: 0,
			terminalizationStops: policyTermination ? 0 : 1,
			evaluatorToolCalls: v2PolicyAbort ? 2 : policyStop ? 0 : 4,
			postTerminalEvaluatorToolCalls: 0,
			readOnlyDeviationEvents: [],
			forbiddenBoundaryEvents: v2PolicyAbort
				? [`${STOCK_INTERFACE_PARITY_TOOL_NAME} call tool-call-3`]
				: policyStop
					? ["forbidden_wrong_tool call tool-call-1"]
					: [],
			seenToolCallIds: policyStop
				? ["tool-call-1"]
				: v2PolicyAbort
					? ["tool-call-1", "tool-call-2", "tool-call-3"]
					: ["tool-call-1", "tool-call-2", "tool-call-3", "tool-call-4"],
		},
		hostTerminalizationAssessment: {
			policy: {},
			completionGate: {},
			championSelection: {},
			hostSelectedJobId: policyStop ? null : jobs[0]!.proposal.jobId,
			assistantReport: {},
			measurementQualified: !semanticRejection && !policyTermination,
			terminalizationRuntimeConformant: !semanticRejection && !policyTermination,
			hardFailures: v2PolicyAbort
				? [
						"stock CPU completion gate failed",
						"expected 4 evaluator dispatches, observed 2",
						`forbidden boundary events: ${STOCK_INTERFACE_PARITY_TOOL_NAME} call tool-call-3`,
					]
				: policyStop
					? [
							"stock CPU completion gate failed",
							"expected 4 evaluator dispatches, observed 0",
							"forbidden boundary events: forbidden_wrong_tool call tool-call-1",
							"host champion selection is empty",
						]
					: semanticRejection
						? ["stock CPU completion gate failed"]
						: [],
			deviations: [],
		},
		trace: {
			callCount: v2PolicyAbort ? 2 : policyStop ? 0 : 4,
			duplicateCount: 0,
			evaluatorWaitMs: 0,
			jobIds: policyStop ? [] : jobs.slice(0, v2PolicyAbort ? 2 : 4).map((job) => job.proposal.jobId),
			requests: policyStop ? [] : requests.slice(0, v2PolicyAbort ? 2 : 4),
			modelFeedbackBytes: policyStop ? [] : v2PolicyAbort ? [100, 100] : [100, 100, 100, 100],
		},
		jobs: policyStop ? [] : jobs.slice(0, v2PolicyAbort ? 2 : 4),
		budget: {
			branchId: "paid-screen-fixture",
			submissions: v2PolicyAbort ? 2 : policyStop ? 0 : 4,
			taskEvaluations: v2PolicyAbort ? 4 : policyStop ? 0 : 8,
			actualTaskEvaluations: v2PolicyAbort ? 4 : policyStop ? 0 : 8,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: 4,
			maxTaskEvaluations: 8,
			remainingSubmissions: v2PolicyAbort ? 2 : policyStop ? 4 : 0,
			remainingTaskEvaluations: v2PolicyAbort ? 4 : policyStop ? 8 : 0,
		},
		completionGate: {},
		championSelection: {},
		reportedChampionJobId: null,
		championReportLine: null,
		championReportMatched: false,
		operationalGate: {
			passed: operationalFailures.length === 0,
			checks: operationalChecks,
			failures: operationalFailures,
		},
		artifactIntegrity: { passed: true, verifiedRefs: [], error: null },
		evaluatorIntegrityPassed: true,
		measurementProvenanceIntegrityPassed: true,
		pairPreregistrationIntegrityPassed: true,
		qualityGate: {},
		promptWallMs: 0,
		evaluatorWaitMs: 0,
		activeAgentMs: 0,
		activeAgentCheckpointExceeded: false,
		calendarMs: 0,
		sourceHashesBefore: {},
		sourceHashesAfter: {},
		sourceIntegrityPassed: true,
		repositoryBefore: RUNTIME_WORKTREE_SNAPSHOT,
		repositoryAfter: RUNTIME_WORKTREE_SNAPSHOT,
		repositoryIntegrityPassed: true,
		ledgerSha256: sha256Text(ledgerContents),
		terminalLedgerEventHash: terminalEvent.hash,
		eventCounts: {},
		sessionStats: {},
		finishedAt: "2026-08-29T01:01:00.000Z",
	} as unknown as StockTrajectoryResult;
	input.mutateResult?.(result);
	await writeFile(join(outputDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	return { outputDir, result, providerVisibility };
}

describe("CompilerGym paid IR-delta screen runner", () => {
	it("preflights a canonical private preregistration and binds both anchor hash representations", async () => {
		assert.equal(COMPILER_GYM_IR_DELTA_SCREEN_RUNNER_PROTOCOL, "compiler-gym-ir-delta-paid-screen-runner-v2");
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-runner-preflight-"));
		const preregistrationPath = join(root, "preregistration.json");
		const implementationClosure = await collectCompilerGymIrDeltaScreenImplementationClosure(REPO_ROOT);
		const preregistration = buildCompilerGymIrDeltaScreenPreregistration({
			createdAt: "2026-08-29T01:00:00.000Z",
			drawHex: "00".repeat(16),
			implementationClosure,
			runtimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
		});
		await writeCompilerGymIrDeltaScreenPreregistration(preregistrationPath, preregistration);
		const preflight = await prepareCompilerGymIrDeltaScreenRun({ preregistrationPath, repoRoot: REPO_ROOT });
		assert.equal(preflight.preregistrationSha256, sha256Text(await readFile(preregistrationPath, "utf8")));
		assert.equal(preflight.preregistration.implementationBundleSha256, sha256Json(implementationClosure));
		assert.notEqual(preflight.implementationBundleSha256, preflight.preregistration.implementationBundleSha256);

		const loader = createCompilerGymIrDeltaScreenPairAnchorLoader(preflight);
		const anchor = await loader({
			path: preregistrationPath,
			promptSha256: preregistration.frozenCommon.promptSha256,
			implementationBundleSha256: preflight.implementationBundleSha256,
			feedbackView: "full",
			armId: "hidden-control",
		});
		assert.equal(anchor.sha256, preflight.preregistrationSha256);
		assert.equal(anchor.record, preflight.preregistration);
		await assert.rejects(
			loader({
				path: preregistrationPath,
				promptSha256: preregistration.frozenCommon.promptSha256,
				implementationBundleSha256: "f".repeat(64),
				feedbackView: "full",
				armId: "hidden-control",
			}),
			/generic implementation bundle drifted/,
		);

		await writeFile(preregistrationPath, `${await readFile(preregistrationPath, "utf8")} `, "utf8");
		await assert.rejects(
			loader({
				path: preregistrationPath,
				promptSha256: preregistration.frozenCommon.promptSha256,
				implementationBundleSha256: preflight.implementationBundleSha256,
				feedbackView: "full",
				armId: "visible-ir-delta-treatment",
			}),
			/drifted after preflight/,
		);

		const tamperedPath = join(root, "tampered-preregistration.json");
		const tampered = structuredClone(preregistration);
		(tampered.apparatusLineage.predecessor.ledger as { sha256: string }).sha256 = "f".repeat(64);
		await writePrivateCanonicalJson(tamperedPath, tampered);
		await assert.rejects(
			prepareCompilerGymIrDeltaScreenRun({ preregistrationPath: tamperedPath, repoRoot: REPO_ROOT }),
			/does not match the frozen protocol/,
		);
	});

	it("admits a fully verified arm with exact provider, evaluator, artifact, session, and ledger evidence", async () => {
		const fixture = await writeArmFixture();
		const audit = await auditCompilerGymIrDeltaScreenArm({
			arm: "hidden-control",
			outputDir: fixture.outputDir,
			result: fixture.result,
			providerVisibility: fixture.providerVisibility,
		});
		assert.equal(audit.disposition, "admitted-directional-arm");
		assert.equal(audit.admitted, true);
		assert.deepEqual(audit.apparatusFailures, []);
		assert.deepEqual(audit.policyFailures, []);
		assert.equal(audit.candidates.length, 4);
		assert.equal(
			audit.candidates.every((candidate) => candidate.outcome === "verified"),
			true,
		);
		assert.equal(audit.providerDispatches, 4);
		assert.equal(audit.evaluatorJobs, 4);
		assert.equal(audit.freshTaskEvaluations, 8);
	});

	it("admits only the exact stock-runtime mismatch caused by a complete post-S12 semantic rejection", async () => {
		const fixture = await writeArmFixture({
			arm: "visible-ir-delta-treatment",
			semanticRejectionCall: 2,
		});
		const audit = await auditCompilerGymIrDeltaScreenArm({
			arm: "visible-ir-delta-treatment",
			outputDir: fixture.outputDir,
			result: fixture.result,
			providerVisibility: fixture.providerVisibility,
		});
		assert.equal(audit.disposition, "admitted-directional-arm");
		assert.equal(audit.admitted, true);
		assert.deepEqual(audit.apparatusFailures, []);
		assert.deepEqual(audit.allowedStockRejectionFailures, [
			"measurementQualified",
			"terminalizationRuntimeConformant",
		]);
		assert.equal(audit.candidates[1]?.outcome, "complete-semantic-rejection");
	});

	it("rejects arbitrary failures and extra host hard failures hidden behind a semantic rejection", async () => {
		for (const testCase of [
			{
				name: "arbitrary result failure",
				mutateResult(result: StockTrajectoryResult): void {
					result.failure = "arbitrary filesystem corruption";
				},
			},
			{
				name: "extra host hard failure",
				mutateResult(result: StockTrajectoryResult): void {
					result.hostTerminalizationAssessment?.hardFailures.push("artifact integrity failed");
				},
			},
		] as const) {
			const fixture = await writeArmFixture({
				semanticRejectionCall: 2,
				mutateResult: testCase.mutateResult,
			});
			const audit = await auditCompilerGymIrDeltaScreenArm({
				arm: "hidden-control",
				outputDir: fixture.outputDir,
				result: fixture.result,
				providerVisibility: fixture.providerVisibility,
			});
			assert.equal(audit.disposition, "terminal-apparatus-invalid-not-treatment-result", testCase.name);
			assert.equal(audit.admitted, false, testCase.name);
			assert.notEqual(audit.apparatusFailures.length, 0, testCase.name);
		}
	});

	it("classifies a wrong-tool policy stop as scientific without laundering its induced budget shortfall into apparatus failure", async () => {
		const fixture = await writeArmFixture({ policyStop: true });
		const audit = await auditCompilerGymIrDeltaScreenArm({
			arm: "hidden-control",
			outputDir: fixture.outputDir,
			result: fixture.result,
			providerVisibility: fixture.providerVisibility,
		});
		assert.equal(audit.disposition, "terminal-scientific-policy-nonconformance");
		assert.equal(audit.admitted, false);
		assert.deepEqual(audit.apparatusFailures, []);
		assert.notEqual(audit.policyFailures.length, 0);
		assert.equal(audit.providerDispatches, 1);
		assert.equal(audit.evaluatorJobs, 0);
		assert.equal(audit.freshTaskEvaluations, 0);
	});

	it("classifies the exact v2 local policy-abort sentinel as scientific and rejects a nonzero-usage abort", async () => {
		const policyError = "scientific-policy-nonconformance: actions must contain from 1 through 46 flags";
		const fixture = await writeArmFixture({ v2PolicyAbort: true });
		const audit = await auditCompilerGymIrDeltaScreenArm({
			arm: "hidden-control",
			outputDir: fixture.outputDir,
			result: fixture.result,
			providerVisibility: fixture.providerVisibility,
			policyErrors: [policyError],
		});
		assert.equal(audit.disposition, "terminal-scientific-policy-nonconformance");
		assert.equal(audit.admitted, false);
		assert.deepEqual(audit.apparatusFailures, []);
		assert.equal(
			audit.policyFailures.some((failure) => failure.includes(policyError)),
			true,
		);
		assert.equal(audit.providerDispatches, 3);
		assert.equal(audit.evaluatorJobs, 2);
		assert.equal(audit.freshTaskEvaluations, 4);
		assert.equal(audit.candidates.length, 2);

		const nonzeroUsageFixture = await writeArmFixture({
			v2PolicyAbort: true,
			syntheticAbortInputTokens: 1,
		});
		const nonzeroUsageAudit = await auditCompilerGymIrDeltaScreenArm({
			arm: "hidden-control",
			outputDir: nonzeroUsageFixture.outputDir,
			result: nonzeroUsageFixture.result,
			providerVisibility: nonzeroUsageFixture.providerVisibility,
			policyErrors: [policyError],
		});
		assert.equal(nonzeroUsageAudit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(
			nonzeroUsageAudit.apparatusFailures.some((failure) =>
				failure.includes("provider dispatch count differs from durable assistant response count"),
			),
			true,
		);
	});

	it("fails apparatus audit when stored session or ledger bindings do not match the on-disk evidence", async () => {
		const fixture = await writeArmFixture({
			mutateResult(result) {
				result.sessionSha256 = "0".repeat(64);
				result.ledgerSha256 = "1".repeat(64);
				result.terminalLedgerEventHash = "2".repeat(64);
			},
		});
		const audit = await auditCompilerGymIrDeltaScreenArm({
			arm: "hidden-control",
			outputDir: fixture.outputDir,
			result: fixture.result,
			providerVisibility: fixture.providerVisibility,
		});
		assert.equal(audit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.notEqual(audit.apparatusFailures.length, 0);
	});

	it("fails apparatus audit when durable assistant tool arguments drift from the evaluator request", async () => {
		const fixture = await writeArmFixture({
			sessionToolArguments(request, index) {
				return index === 1 ? { ...request, hypothesis: "session-only mutated hypothesis" } : request;
			},
		});
		const audit = await auditCompilerGymIrDeltaScreenArm({
			arm: "hidden-control",
			outputDir: fixture.outputDir,
			result: fixture.result,
			providerVisibility: fixture.providerVisibility,
		});
		assert.equal(audit.disposition, "terminal-apparatus-invalid-not-treatment-result");
		assert.equal(
			audit.apparatusFailures.some((failure) =>
				failure.includes("tool arguments differ from its evaluator request"),
			),
			true,
		);
	});
});

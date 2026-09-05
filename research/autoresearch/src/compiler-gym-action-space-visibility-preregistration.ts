import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	buildCompilerGymActionSpaceVisibilityPrompts,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL,
	type CompilerGymActionSpaceVisibilityArm,
	reconstructCompilerGymActionSpaceVisibilityGuides,
} from "./compiler-gym-action-space-visibility-protocol.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import { COMPILER_GYM_HARDENED_PAID_MODEL_POLICY } from "./compiler-gym-hardened-paid-provider.js";
import { DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT } from "./compiler-gym-ir-delta-qualification-preregistration.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import { STOCK_CPU_TASKS } from "./stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	PRIME_RUNTIME_WORKTREE_PATHS,
	type RepositorySnapshot,
} from "./stock-interface-parity.js";

export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_EXPERIMENT_ID =
	"compiler-gym-action-guide-visibility-first-proposal-paid-pair-v1" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PREREGISTRATION_PROTOCOL =
	"compiler-gym-action-guide-visibility-first-proposal-preregistration-v1" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_RUNNER_PROTOCOL =
	"compiler-gym-action-guide-visibility-first-proposal-runner-v1" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT = 32_000 as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL_NAME = "autoresearch_evaluate" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_WORKSPACE = "/workspace" as const;
export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_CONVERSATION_LOG =
	"/conversation/session.jsonl" as const;

export const COMPILER_GYM_ACTION_SPACE_VISIBILITY_IMPLEMENTATION_ENTRYPOINTS = [
	"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
	"research/autoresearch/src/compiler-gym-action-space-visibility-first-proposal-runner.ts",
	"research/autoresearch/src/compiler-gym-action-space-visibility-preregistration.ts",
	"research/autoresearch/src/compiler-gym-action-space-visibility-protocol.ts",
	"research/autoresearch/src/compiler-gym-action-space-visibility-provider-guard.ts",
	"research/autoresearch/src/compiler-gym-action-space-visibility-first-proposal-cli.ts",
	"research/autoresearch/package.json",
	"research/autoresearch/tsconfig.json",
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"tsconfig.base.json",
] as const;

export interface CompilerGymActionSpaceVisibilitySourceRecord {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymActionSpaceVisibilityPreregistration {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PREREGISTRATION_PROTOCOL;
	experimentId: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_EXPERIMENT_ID;
	screenProtocol: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL;
	pairId: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID;
	createdAt: string;
	status: "preregistered-before-any-ssh-provider-or-evaluator-dispatch";
	question: string;
	hypothesis: string;
	claimClass: "directional-single-order-sampled-first-proposal-pair";
	causalClaimAllowed: false;
	randomizedInferenceAllowed: false;
	tamperEvidentRandomAssignment: false;
	defaultPromotionAllowed: false;
	gpuPromotionAllowed: false;
	nanogptPromotionAllowed: false;
	executionOrder: {
		method: "local-os-entropy-16-byte-parity-v1";
		drawHex: string;
		armOrder: readonly [CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArm];
		frozenBeforeSsh: true;
		externalCommitmentBeforeRun: false;
		tamperEvidence: "none-before-remote-attempt-lock";
		selectionBiasCannotBeExcluded: true;
		tamperEvidentRandomAssignment: false;
		randomizedInferenceAllowed: false;
	};
	arms: readonly [
		{ id: (typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS)[0]; exposure: "stock-26-guide" },
		{
			id: (typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS)[1];
			exposure: "stock-26-plus-canonical-omitted-98-guide";
		},
	];
	frozenCommon: {
		primeAgentCommit: string;
		model: "openai-codex/gpt-5.6-luna";
		thinkingLevel: "xhigh";
		requestedServiceTier: "priority";
		modelPolicy: typeof COMPILER_GYM_HARDENED_PAID_MODEL_POLICY;
		tasks: typeof STOCK_CPU_TASKS;
		toolName: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL_NAME;
		maximumActions: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS;
		providerVisibleWorkspace: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_WORKSPACE;
		providerVisibleConversationLog: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_CONVERSATION_LOG;
		providerRetries: 0;
		compaction: false;
		rlmChildren: false;
		webAccess: false;
		measurementReuse: false;
		farmShareEnvironment: typeof DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT;
		farmShareEnvironmentSha256: string;
		verifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
		canonicalEvaluatorSha256: typeof COMPILER_GYM_EVALUATOR_SHA256;
		irDeltaEvaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256;
		sourceBundleSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256;
		adapterOutputProtocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL;
		accountingRowsProtocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL;
		accountingMode: "required";
		accountingEvidenceVersion: "exact-three-row-v1";
	};
	launch: {
		contract: "compiler-gym-action-space-visibility-sealed-cli-v1";
		runtimeMode: "production-defaults-no-dependency-injection";
		preregisterArgv: string[];
		runArgv: string[];
		repoRoot: string;
		preregistrationPath: string;
		outputDir: string;
	};
	prompts: ReturnType<typeof buildCompilerGymActionSpaceVisibilityPrompts>;
	sharedS12Gate: {
		classification: "shared-zero-model-apparatus-gate-excluded-from-arms";
		request: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST;
		requestSha256: string;
		actionsSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256;
		expectedMetrics: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS;
		providerDispatches: 0;
		candidateEvaluations: 1;
		freshTaskEvaluations: 2;
		attemptLock: "separate-create-only-remote-lock-before-s12-evaluator-dispatch";
		retries: 0;
		mustPassBeforePaidLock: true;
	};
	remoteLocks: {
		scientificIdentitySha256: string;
		parentRoot: string;
		root: string;
		sharedS12GatePath: string;
		globalPath: string;
		armPaths: Record<CompilerGymActionSpaceVisibilityArm, string>;
		createOnly: true;
		mode: "0600";
		neverRemovedByRunner: true;
	};
	budgets: {
		pairCount: 1;
		providerDispatchesPerArm: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM;
		providerDispatchesTotal: 2;
		candidateEvaluationsPerArm: 1;
		candidateEvaluationsTotal: 2;
		freshTaskEvaluationsPerArm: 2;
		freshTaskEvaluationsTotal: 4;
		outputTokensPerArmPostResponseMaximum: typeof COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT;
		gpus: 0;
		gpuHours: 0;
		totalCpuAllocationsIncludingSmoke: 6;
		totalAllocationWallMinutesMaximum: 30;
		totalRequestedTaskCpuMinutes: 60;
		totalSchedulerLogicalCpuMinutesMaximum: 120;
		paidPairCpuAllocations: 4;
		paidPairAllocationWallMinutesMaximum: 20;
		paidPairRequestedTaskCpuMinutes: 40;
		paidPairSchedulerLogicalCpuMinutesMaximum: 80;
		retries: 0;
		replacements: 0;
	};
	decisionPolicy: {
		bothArmsRequiredBeforeComparison: true;
		treatmentMustUseOmittedFlagAbsentFromControl: true;
		treatmentMustBeNoWorseOnBothTasks: true;
		treatmentMustBeStrictlyBetterOnAtLeastOneTask: true;
		controlPolicyFailure: "inconclusive";
		treatmentPolicyOrScientificFailureAfterVerifiedControl: "kill-broad-list-visibility";
		noUniqueOmittedFlagWithoutDominance: "kill-broad-list-visibility";
		dominanceWithoutUniqueOmittedFlag: "inconclusive";
		infrastructureFailure: "terminal-apparatus-invalid";
		outputTokenAdmissionBreach: "terminal-apparatus-invalid";
		positiveResult: "directional-only-fresh-replication-required";
	};
	implementationClosure: CompilerGymActionSpaceVisibilitySourceRecord[];
	implementationBundleSha256: string;
	runtimeWorktreeClosure: {
		roots: typeof PRIME_RUNTIME_WORKTREE_PATHS;
		snapshot: RepositorySnapshot;
		snapshotSha256: string;
	};
}

const HEX_32 = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;

function validateCreatedAt(value: string): void {
	if (!Number.isFinite(Date.parse(value))) throw new Error("Visibility preregistration createdAt is invalid");
}

function validateDrawHex(value: string): void {
	if (!HEX_32.test(value)) throw new Error("Visibility execution-order draw must be 16 lowercase-hex bytes");
}

export function assertCompilerGymActionSpaceVisibilityLaunchPaths(
	repoRoot: string,
	preregistrationPath: string,
	outputDir: string,
): void {
	for (const [label, path] of [
		["repository", repoRoot],
		["preregistration", preregistrationPath],
		["output", outputDir],
	] as const) {
		if (dirname(path) === path) throw new Error(`Visibility ${label} path may not be a filesystem root`);
	}
	if (
		preregistrationPath === outputDir ||
		preregistrationPath.startsWith(`${outputDir}${sep}`) ||
		outputDir.startsWith(`${preregistrationPath}${sep}`)
	) {
		throw new Error("Visibility preregistration path and output directory must be disjoint and non-nested");
	}
}

function validateSourceClosure(
	value: readonly CompilerGymActionSpaceVisibilitySourceRecord[],
): CompilerGymActionSpaceVisibilitySourceRecord[] {
	const records = value.map((record) => {
		if (
			!record.relativePath ||
			record.relativePath.startsWith("/") ||
			record.relativePath.includes("..") ||
			!SHA256.test(record.sha256)
		) {
			throw new Error(`Visibility implementation closure has an invalid record: ${record.relativePath}`);
		}
		return { relativePath: record.relativePath, sha256: record.sha256 };
	});
	if (new Set(records.map((record) => record.relativePath)).size !== records.length) {
		throw new Error("Visibility implementation closure contains duplicate paths");
	}
	if (records.some((record, index) => index > 0 && record.relativePath <= records[index - 1]!.relativePath)) {
		throw new Error("Visibility implementation closure is not strictly sorted");
	}
	for (const entrypoint of COMPILER_GYM_ACTION_SPACE_VISIBILITY_IMPLEMENTATION_ENTRYPOINTS) {
		if (!records.some((record) => record.relativePath === entrypoint)) {
			throw new Error(`Visibility implementation closure omits entrypoint ${entrypoint}`);
		}
	}
	return records;
}

function validateRuntimeSnapshot(value: RepositorySnapshot): RepositorySnapshot {
	if (value.head !== FROZEN_CAMPAIGN.repositories.primeAgent.commit) {
		throw new Error("Visibility runtime snapshot is not pinned to the Prime Agent baseline commit");
	}
	if (!SHA256.test(value.trackedDiffSha256) || !SHA256.test(value.coreWorktreeDigest)) {
		throw new Error("Visibility runtime snapshot hashes are invalid");
	}
	for (const root of PRIME_RUNTIME_WORKTREE_PATHS) {
		if (!GIT_OBJECT_ID.test(value.coreTreeHashes[root] ?? "")) {
			throw new Error(`Visibility runtime snapshot omits ${root}`);
		}
	}
	return structuredClone(value);
}

export function compilerGymActionSpaceVisibilityArmOrder(
	drawHex: string,
): readonly [CompilerGymActionSpaceVisibilityArm, CompilerGymActionSpaceVisibilityArm] {
	validateDrawHex(drawHex);
	return Number.parseInt(drawHex.slice(0, 2), 16) % 2 === 0
		? [COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[0], COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[1]]
		: [COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[1], COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[0]];
}

export function compilerGymActionSpaceVisibilityScientificLockIdentitySha256(
	prompts: ReturnType<typeof buildCompilerGymActionSpaceVisibilityPrompts>,
): string {
	return sha256Json({
		pairId: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID,
		screenProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL,
		model: "openai-codex/gpt-5.6-luna",
		thinkingLevel: "xhigh",
		requestedServiceTier: "priority",
		modelPolicy: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
		tasks: STOCK_CPU_TASKS,
		tool: COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL,
		maximumActions: COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS,
		promptSha256ByArm: prompts.promptSha256ByArm,
		normalizedPromptSha256: prompts.normalizedSha256,
		farmShareEnvironmentSha256: sha256Json(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		canonicalEvaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
		adapterOutputProtocol: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
		accountingRowsProtocol: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
		accountingMode: "required",
		accountingEvidenceVersion: "exact-three-row-v1",
		sharedS12: {
			request: COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
			actionsSha256: COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
			expectedMetrics: COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
			providerDispatches: 0,
			candidateEvaluations: 1,
			freshTaskEvaluations: 2,
			retries: 0,
		},
		budgets: {
			pairCount: 1,
			providerDispatchesPerArm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM,
			providerDispatchesTotal: 2,
			candidateEvaluationsPerArm: 1,
			candidateEvaluationsTotal: 2,
			freshTaskEvaluationsPerArm: 2,
			freshTaskEvaluationsTotal: 4,
			outputTokensPerArmPostResponseMaximum: COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
			gpus: 0,
			gpuHours: 0,
			totalCpuAllocationsIncludingSmoke: 6,
			totalAllocationWallMinutesMaximum: 30,
			totalRequestedTaskCpuMinutes: 60,
			totalSchedulerLogicalCpuMinutesMaximum: 120,
			paidPairCpuAllocations: 4,
			paidPairAllocationWallMinutesMaximum: 20,
			paidPairRequestedTaskCpuMinutes: 40,
			paidPairSchedulerLogicalCpuMinutesMaximum: 80,
			retries: 0,
			replacements: 0,
		},
		measurementReuse: false,
		decisionPolicy: {
			bothArmsRequiredBeforeComparison: true,
			treatmentMustUseOmittedFlagAbsentFromControl: true,
			treatmentMustBeNoWorseOnBothTasks: true,
			treatmentMustBeStrictlyBetterOnAtLeastOneTask: true,
			controlPolicyFailure: "inconclusive",
			treatmentPolicyOrScientificFailureAfterVerifiedControl: "kill-broad-list-visibility",
			noUniqueOmittedFlagWithoutDominance: "kill-broad-list-visibility",
			dominanceWithoutUniqueOmittedFlag: "inconclusive",
			infrastructureFailure: "terminal-apparatus-invalid",
			outputTokenAdmissionBreach: "terminal-apparatus-invalid",
			positiveResult: "directional-only-fresh-replication-required",
		},
	});
}

function lockPaths(
	prompts: ReturnType<typeof buildCompilerGymActionSpaceVisibilityPrompts>,
): CompilerGymActionSpaceVisibilityPreregistration["remoteLocks"] {
	const identity = compilerGymActionSpaceVisibilityScientificLockIdentitySha256(prompts);
	const parentRoot = `${DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT.remoteSourceRoot}/paid-pair-locks`;
	const root = `${parentRoot}/${identity.slice(0, 32)}`;
	return {
		scientificIdentitySha256: identity,
		parentRoot,
		root,
		sharedS12GatePath: `${root}/shared-s12-gate.lock`,
		globalPath: `${root}/global.lock`,
		armPaths: {
			[COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[0]]: `${root}/${COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[0]}.lock`,
			[COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[1]]: `${root}/${COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[1]}.lock`,
		},
		createOnly: true,
		mode: "0600",
		neverRemovedByRunner: true,
	};
}

export function buildCompilerGymActionSpaceVisibilityPreregistration(input: {
	createdAt: string;
	drawHex: string;
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	authoritativeEvaluatorContents: string;
	implementationClosure: readonly CompilerGymActionSpaceVisibilitySourceRecord[];
	runtimeWorktreeSnapshot: RepositorySnapshot;
}): CompilerGymActionSpaceVisibilityPreregistration {
	validateCreatedAt(input.createdAt);
	validateDrawHex(input.drawHex);
	const implementationClosure = validateSourceClosure(input.implementationClosure);
	const runtimeSnapshot = validateRuntimeSnapshot(input.runtimeWorktreeSnapshot);
	const repoRoot = resolve(input.repoRoot);
	const preregistrationPath = resolve(input.preregistrationPath);
	const outputDir = resolve(input.outputDir);
	assertCompilerGymActionSpaceVisibilityLaunchPaths(repoRoot, preregistrationPath, outputDir);
	const cliPath = resolve(
		repoRoot,
		"research/autoresearch/src/compiler-gym-action-space-visibility-first-proposal-cli.ts",
	);
	const tsxPath = resolve(repoRoot, "node_modules/.bin/tsx");
	const prompts = buildCompilerGymActionSpaceVisibilityPrompts(
		reconstructCompilerGymActionSpaceVisibilityGuides(input.authoritativeEvaluatorContents),
	);
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PREREGISTRATION_PROTOCOL,
		experimentId: COMPILER_GYM_ACTION_SPACE_VISIBILITY_EXPERIMENT_ID,
		screenProtocol: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROTOCOL,
		pairId: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PAIR_ID,
		createdAt: input.createdAt,
		status: "preregistered-before-any-ssh-provider-or-evaluator-dispatch",
		question:
			"In this sampled-order directional pair, is the complete-guide arm associated with a better first verified two-task proposal than the exact stock 26-flag-guide arm?",
		hypothesis:
			"Under this sampled-order directional pair, Luna in the complete-guide arm is expected to select at least one previously omitted legal flag and produce a two-task Pareto improvement on its first proposal.",
		claimClass: "directional-single-order-sampled-first-proposal-pair",
		causalClaimAllowed: false,
		randomizedInferenceAllowed: false,
		tamperEvidentRandomAssignment: false,
		defaultPromotionAllowed: false,
		gpuPromotionAllowed: false,
		nanogptPromotionAllowed: false,
		executionOrder: {
			method: "local-os-entropy-16-byte-parity-v1",
			drawHex: input.drawHex,
			armOrder: compilerGymActionSpaceVisibilityArmOrder(input.drawHex),
			frozenBeforeSsh: true,
			externalCommitmentBeforeRun: false,
			tamperEvidence: "none-before-remote-attempt-lock",
			selectionBiasCannotBeExcluded: true,
			tamperEvidentRandomAssignment: false,
			randomizedInferenceAllowed: false,
		},
		arms: [
			{ id: COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[0], exposure: "stock-26-guide" },
			{
				id: COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS[1],
				exposure: "stock-26-plus-canonical-omitted-98-guide",
			},
		],
		frozenCommon: {
			primeAgentCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
			model: "openai-codex/gpt-5.6-luna",
			thinkingLevel: "xhigh",
			requestedServiceTier: "priority",
			modelPolicy: structuredClone(COMPILER_GYM_HARDENED_PAID_MODEL_POLICY),
			tasks: STOCK_CPU_TASKS,
			toolName: COMPILER_GYM_ACTION_SPACE_VISIBILITY_TOOL_NAME,
			maximumActions: COMPILER_GYM_ACTION_SPACE_VISIBILITY_MAX_ACTIONS,
			providerVisibleWorkspace: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_WORKSPACE,
			providerVisibleConversationLog: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_VISIBLE_CONVERSATION_LOG,
			providerRetries: 0,
			compaction: false,
			rlmChildren: false,
			webAccess: false,
			measurementReuse: false,
			farmShareEnvironment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
			farmShareEnvironmentSha256: sha256Json(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			canonicalEvaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			adapterOutputProtocol: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
			accountingRowsProtocol: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
			accountingMode: "required",
			accountingEvidenceVersion: "exact-three-row-v1",
		},
		launch: {
			contract: "compiler-gym-action-space-visibility-sealed-cli-v1",
			runtimeMode: "production-defaults-no-dependency-injection",
			preregisterArgv: [
				tsxPath,
				cliPath,
				"preregister",
				"--repo-root",
				repoRoot,
				"--preregistration",
				preregistrationPath,
				"--output-dir",
				outputDir,
			],
			runArgv: [
				tsxPath,
				cliPath,
				"run",
				"--repo-root",
				repoRoot,
				"--preregistration",
				preregistrationPath,
				"--output-dir",
				outputDir,
			],
			repoRoot,
			preregistrationPath,
			outputDir,
		},
		prompts,
		sharedS12Gate: {
			classification: "shared-zero-model-apparatus-gate-excluded-from-arms",
			request: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			requestSha256: sha256Json(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actionsSha256: COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
			expectedMetrics: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS),
			providerDispatches: 0,
			candidateEvaluations: 1,
			freshTaskEvaluations: 2,
			attemptLock: "separate-create-only-remote-lock-before-s12-evaluator-dispatch",
			retries: 0,
			mustPassBeforePaidLock: true,
		},
		remoteLocks: lockPaths(prompts),
		budgets: {
			pairCount: 1,
			providerDispatchesPerArm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_PROVIDER_CALLS_PER_ARM,
			providerDispatchesTotal: 2,
			candidateEvaluationsPerArm: 1,
			candidateEvaluationsTotal: 2,
			freshTaskEvaluationsPerArm: 2,
			freshTaskEvaluationsTotal: 4,
			outputTokensPerArmPostResponseMaximum: COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
			gpus: 0,
			gpuHours: 0,
			totalCpuAllocationsIncludingSmoke: 6,
			totalAllocationWallMinutesMaximum: 30,
			totalRequestedTaskCpuMinutes: 60,
			totalSchedulerLogicalCpuMinutesMaximum: 120,
			paidPairCpuAllocations: 4,
			paidPairAllocationWallMinutesMaximum: 20,
			paidPairRequestedTaskCpuMinutes: 40,
			paidPairSchedulerLogicalCpuMinutesMaximum: 80,
			retries: 0,
			replacements: 0,
		},
		decisionPolicy: {
			bothArmsRequiredBeforeComparison: true,
			treatmentMustUseOmittedFlagAbsentFromControl: true,
			treatmentMustBeNoWorseOnBothTasks: true,
			treatmentMustBeStrictlyBetterOnAtLeastOneTask: true,
			controlPolicyFailure: "inconclusive",
			treatmentPolicyOrScientificFailureAfterVerifiedControl: "kill-broad-list-visibility",
			noUniqueOmittedFlagWithoutDominance: "kill-broad-list-visibility",
			dominanceWithoutUniqueOmittedFlag: "inconclusive",
			infrastructureFailure: "terminal-apparatus-invalid",
			outputTokenAdmissionBreach: "terminal-apparatus-invalid",
			positiveResult: "directional-only-fresh-replication-required",
		},
		implementationClosure,
		implementationBundleSha256: sha256Json(implementationClosure),
		runtimeWorktreeClosure: {
			roots: PRIME_RUNTIME_WORKTREE_PATHS,
			snapshot: runtimeSnapshot,
			snapshotSha256: sha256Json(runtimeSnapshot),
		},
	};
}

export function parseCompilerGymActionSpaceVisibilityPreregistration(input: {
	value: unknown;
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	authoritativeEvaluatorContents: string;
	expectedImplementationClosure: readonly CompilerGymActionSpaceVisibilitySourceRecord[];
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot;
}): CompilerGymActionSpaceVisibilityPreregistration {
	if (typeof input.value !== "object" || input.value === null || Array.isArray(input.value)) {
		throw new Error("Visibility preregistration must be an object");
	}
	const value = input.value as Record<string, unknown>;
	if (typeof value.createdAt !== "string") throw new Error("Visibility preregistration lacks createdAt");
	const executionOrder = value.executionOrder;
	if (typeof executionOrder !== "object" || executionOrder === null || Array.isArray(executionOrder)) {
		throw new Error("Visibility preregistration lacks a sampled execution order");
	}
	const drawHex = (executionOrder as Record<string, unknown>).drawHex;
	if (typeof drawHex !== "string") throw new Error("Visibility preregistration lacks its local order draw");
	const expected = buildCompilerGymActionSpaceVisibilityPreregistration({
		createdAt: value.createdAt,
		drawHex,
		repoRoot: input.repoRoot,
		preregistrationPath: input.preregistrationPath,
		outputDir: input.outputDir,
		authoritativeEvaluatorContents: input.authoritativeEvaluatorContents,
		implementationClosure: input.expectedImplementationClosure,
		runtimeWorktreeSnapshot: input.expectedRuntimeWorktreeSnapshot,
	});
	assert.deepEqual(input.value, expected, "Visibility preregistration differs from its reconstructed protocol");
	return expected;
}

export async function collectCompilerGymActionSpaceVisibilityImplementationClosure(
	repoRoot: string,
): Promise<CompilerGymActionSpaceVisibilitySourceRecord[]> {
	const root = resolve(repoRoot);
	const queued: string[] = [...COMPILER_GYM_ACTION_SPACE_VISIBILITY_IMPLEMENTATION_ENTRYPOINTS];
	const discovered = new Set<string>();
	const staticImportPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g;
	const resolveLocalImport = async (fromPath: string, specifier: string): Promise<string> => {
		const fromDirectory = dirname(resolve(root, fromPath));
		const raw = resolve(fromDirectory, specifier);
		const candidates =
			extname(raw) === ".js"
				? [`${raw.slice(0, -3)}.ts`]
				: extname(raw)
					? [raw]
					: [`${raw}.ts`, resolve(raw, "index.ts")];
		for (const candidate of candidates) {
			try {
				if (!(await stat(candidate)).isFile()) continue;
				const path = relative(root, candidate).split(sep).join("/");
				if (!path || path.startsWith("../") || path === "..") {
					throw new Error(`Visibility local import escapes the repository: ${specifier}`);
				}
				return path;
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
				throw error;
			}
		}
		throw new Error(`Visibility static import could not be resolved: ${fromPath} -> ${specifier}`);
	};
	while (queued.length > 0) {
		const relativePath = queued.pop();
		if (!relativePath || discovered.has(relativePath)) continue;
		const contents = await readFile(resolve(root, relativePath), "utf8");
		discovered.add(relativePath);
		if (relativePath.endsWith(".ts")) {
			for (const match of contents.matchAll(staticImportPattern)) {
				const specifier = match[1];
				if (!specifier) continue;
				const imported = await resolveLocalImport(relativePath, specifier);
				if (!discovered.has(imported)) queued.push(imported);
			}
		}
	}
	return Promise.all(
		[...discovered].sort().map(async (relativePath) => ({
			relativePath,
			sha256: sha256Text(await readFile(resolve(root, relativePath), "utf8")),
		})),
	);
}

export function canonicalCompilerGymActionSpaceVisibilityPreregistration(
	value: CompilerGymActionSpaceVisibilityPreregistration,
): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

export async function writeCompilerGymActionSpaceVisibilityPreregistration(input: {
	repoRoot: string;
	path: string;
	outputDir?: string;
	createdAt?: string;
}): Promise<{
	path: string;
	sha256: string;
	record: CompilerGymActionSpaceVisibilityPreregistration;
}> {
	const repoRoot = resolve(input.repoRoot);
	const path = resolve(input.path);
	const outputDir = resolve(input.outputDir ?? resolve(dirname(path), "paid-pair-output"));
	assertCompilerGymActionSpaceVisibilityLaunchPaths(repoRoot, path, outputDir);
	try {
		await stat(outputDir);
		throw new Error("Visibility output directory must be absent when preregistering");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const authoritativeEvaluatorContents = await readFile(
		resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py"),
		"utf8",
	);
	const [implementationClosure, runtimeWorktreeSnapshot] = await Promise.all([
		collectCompilerGymActionSpaceVisibilityImplementationClosure(repoRoot),
		Promise.resolve(capturePrimeRuntimeWorktreeSnapshot(repoRoot)),
	]);
	const record = buildCompilerGymActionSpaceVisibilityPreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		drawHex: randomBytes(16).toString("hex"),
		repoRoot,
		preregistrationPath: path,
		outputDir,
		authoritativeEvaluatorContents,
		implementationClosure,
		runtimeWorktreeSnapshot,
	});
	const contents = canonicalCompilerGymActionSpaceVisibilityPreregistration(record);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	const metadata = await stat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error("Visibility preregistration is not a private regular file");
	}
	return { path, sha256: sha256Text(contents), record };
}

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256 } from "./compiler-gym-adapter.js";
import {
	COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
	parseAuthoritativeLlvmFlags,
} from "./compiler-gym-complete-action-space-headroom.js";
import { COMPILER_GYM_HARDENED_PAID_MODEL_POLICY } from "./compiler-gym-hardened-paid-provider.js";
import { DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT } from "./compiler-gym-ir-delta-qualification-preregistration.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
} from "./compiler-gym-paid-live-environment-gate.js";
import {
	assertCompilerGymProxyCascadePaidAuthoritativeActions,
	COMPILER_GYM_PROXY_CASCADE_PAID_ALLOWED_ACTIONS_SHA256,
	COMPILER_GYM_PROXY_CASCADE_PAID_ARMS,
	COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS,
	COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS,
	COMPILER_GYM_PROXY_CASCADE_PAID_OPERATIONAL_GATES,
	COMPILER_GYM_PROXY_CASCADE_PAID_PAIR_ID,
	COMPILER_GYM_PROXY_CASCADE_PAID_PROMPT,
	COMPILER_GYM_PROXY_CASCADE_PAID_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_THRESHOLDS,
	COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY,
	COMPILER_GYM_PROXY_CASCADE_PAID_TOOL,
	type CompilerGymProxyCascadePaidArm,
	compilerGymProxyCascadePaidArmOrder,
} from "./compiler-gym-proxy-cascade-paid-protocol.js";
import {
	buildCompilerGymProxyCascadePaidProviderSpec,
	type CompilerGymProxyCascadePaidProviderRegistryClosure,
	type CompilerGymProxyCascadePaidProviderSpec,
} from "./compiler-gym-proxy-cascade-paid-provider.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import { STOCK_CPU_TASKS } from "./stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	PRIME_RUNTIME_WORKTREE_PATHS,
	type RepositorySnapshot,
} from "./stock-interface-parity.js";

export const COMPILER_GYM_PROXY_CASCADE_PAID_PREREGISTRATION_PROTOCOL =
	"compiler-gym-proxy-cascade-paid-preregistration-v2" as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_VISIBLE_WORKSPACE =
	"/prime-agent-autoresearch/isolated-workspace" as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_VISIBLE_CONVERSATION_LOG =
	"/prime-agent-autoresearch/session.jsonl" as const;
export const COMPILER_GYM_PROXY_CASCADE_PAID_REMOTE_LOCK_PARENT =
	"/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-ir-delta-qualification-v1/sources/proxy-cascade-paid-locks" as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE = {
	preregistration: {
		path: ".autoresearch/compiler-gym-proxy-cascade-resource-screen/2026-08-29-v1/preregistration.json",
		sha256: "554e3530a3adc5bbe800cce69eb06bdf501823d394e835734e90e2371029513e",
	},
	result: {
		path: ".autoresearch/compiler-gym-proxy-cascade-resource-screen/2026-08-29-v1/execution/result.json",
		sha256: "894d444f7059ac8c301eee8b4167d88fa0314d2f9f4c345873f56cb6ad7e862f",
	},
	ledger: {
		path: ".autoresearch/compiler-gym-proxy-cascade-resource-screen/2026-08-29-v1/execution/evidence.jsonl",
		sha256: "21d0e379151b1c4618f96adea41974490cdc064ebfd3a850e0cb07d4c4b2af6f",
		eventCount: 59,
		terminalEventSha256: "0d2aac8cb65ec72996299099a4807a9ac67c9e2c6c8396c8ce9d947172fe0715",
	},
	scientificIdentitySha256: "22d838d4c144732c1cfcf064a55f65f61b1eea619b826a31ee42dbc0c67cb45c",
	disposition: "model-free-resource-screen-qualified-for-one-paid-pilot-consideration-only",
	resourceGatePassed: true,
	liveScientificEvidenceEligible: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE = {
	result: {
		path: ".autoresearch/rlm-live-canary/2026-08-28-v4/result.json",
		sha256: "3611d6a4e8e84f0ca134ad274cc4582b9bc4a1c0c3a6e9c276cc5f21eca2c700",
	},
	ledger: {
		path: ".autoresearch/rlm-live-canary/2026-08-28-v4/evidence.jsonl",
		sha256: "6df779b986c5f8e787ca4cf8cd07a25262936fef0f428d2012fde2e0c4aee313",
		eventCount: 8,
		terminalEventSha256: "87b025bbd1ecc29464bf144dcd66883c6c11116112e3815834815f94a8f41fb5",
	},
	manifestStart: {
		path: ".autoresearch/rlm-live-canary/2026-08-28-v4/manifest-start.json",
		sha256: "fcd30267ac0f67d161230ffe41c83ca45705525f3fac03f94371dbaf77306247",
	},
	manifestEnd: {
		path: ".autoresearch/rlm-live-canary/2026-08-28-v4/manifest-end.json",
		sha256: "e0fea0ef8bc728a534f6fbf85cf606046355b9baf8646eb4e146d95c72d7efea",
	},
	role: "prerequisite-live-model-tool-rlm-compaction-and-evidence-continuity-canary-only",
	measurementsReusableInPaidPair: false,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE = {
	preregistration: {
		path: ".autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/preregistration.json",
		sha256: "1c016ddff62f6556464febb8ae8a4fb0026600542e195a950cc9e4ee21d09e95",
	},
	result: {
		path: ".autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/execution/result.json",
		sha256: "0b59060a1df32587eaaab336a91466b0bbb740aadf5d8e860d2bda2857b910e5",
	},
	ledger: {
		path: ".autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/execution/evidence.jsonl",
		sha256: "538b9c906eb1c7e357faa1caacee8a87dc009fe3f7e012f20fd7f14368ec456c",
		eventCount: 18,
		terminalEventSha256: "62b6f7a9c23237b940b40f7eb7cbf3e66964442fe744caba4387e1c9d8926892",
	},
	terminalSeal: {
		path: ".autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/execution/seals/terminal.json",
		sha256: "4fa35de4cc99314cf410dbf40166463e5e852f9362fbabf5fe1577108d8430d9",
	},
	session: {
		path: ".autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/execution/arms/full-control/sessions/pcp-2398b92b67ca8832387c4a85fd7e0dfc.jsonl",
		sha256: "99f6bc1645f677dacc918186f8aacbb767013a012ffdf831fb0f0876260201d6",
	},
	scientificIdentitySha256: "16ba4339af4c119cd91cfde2d88bf123086bffb291c2b2b8f9ae7c0a0f3f61f2",
	terminalClassification: "terminal-apparatus-invalid-attempt-identity-consumed",
	failure: "history turn 2 reasoning item shape drifted",
	failureSha256: "9da224b7e1273633c9875455a057130edcbb0e0c974f1c0a3f4feb57a5fbf5b8",
	rejectedProviderRequestBodySha256: "0787ea6032c07a90f3b0ad84474b92fcea7a8f9ecbfc1f84fbfa92b3dd7acdf2",
	remoteTerminalLockSha256: "5c84a3fafaebdea3fe02a29fcd6346ce10dd21e3b2e4432d6d05c0349c2e9fd2",
	providerRequestAttempts: 3,
	actualProviderDispatches: 2,
	actualToolCalls: 2,
	allocationCount: 4,
	role: "apparatus-attrition-and-transcript-repair-source-only",
	countsAsPaidPair: false,
	measurementsReusableInReplacement: false,
	providerVisibleInReplacement: false,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_ISOLATION = {
	onePersistentSessionPerArm: true,
	separateEmptyWorkspacePerArm: true,
	separatePersistentConversationLogPerArm: true,
	activeTools: ["autoresearch_evaluate"],
	webAccess: false,
	publicWinningTraces: false,
	rlmChildren: false,
	compaction: false,
	skills: false,
	arbitraryShell: false,
	measurementReuse: false,
	providerRetries: 0,
	providerReplacements: 0,
	unexpectedCompactionDisposition: "terminal-apparatus-invalid-attempt-identity-consumed",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_TURN_CONTRACT = {
	actualProviderCallsPerArm: 4,
	toolCallsPerArm: 4,
	firstRequestExactS12: true,
	requestsTwoThroughFourAdaptive: true,
	distinctActionsWithinArm: true,
	unsupportedActionDisposition: "terminal-scientific-policy-nonconformance-attempt-identity-consumed",
	postCallFourContinuation: "persist-one-local-aborted-zero-usage-zero-transport-continuation",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_ALLOCATION_POLICY = {
	control:
		"four-sequential-candidates-each-blowfish-plus-bzip2-online-tool-result-calls-one-through-three-enter-next-provider-history-call-four-does-not",
	treatment:
		"four-sequential-blowfish-online-tool-result-calls-one-through-three-enter-next-provider-history-inside-call-four-the-host-runs-two-selected-bzip2-confirmations-before-returning-and-persists-them-outside-the-tool-four-envelope-call-four-blowfish-only-envelope-is-then-persisted-and-host-terminalized-all-selected-confirmations-are-agent-inaccessible",
	selector: "accepted-blowfish-ir-ascending-then-call-ordinal-ascending-exact-top-two-no-tie-expansion",
	fewerThanTwoAccepted: "evaluate-every-accepted-candidate-on-bzip2-valid-directional-nonwin",
	hiddenAudit:
		"after-both-online-arms-terminal-evaluate-every-omitted-accepted-treatment-candidate-on-bzip2-agent-inaccessible",
	hiddenAuditAccounting: "included-total-experiment-compute-excluded-online-resource-metrics",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_QUALITY_GATES = {
	treatmentDeployedWeaklyCoversEveryControlFrontierVector: true,
	treatmentDeployedWeaklyCoversEveryTreatmentOracleFrontierVector: true,
	treatmentDeployedRetainsOracleChampionVector: true,
	selectedAdaptiveCandidateStrictlyImprovesS12: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_CHAMPION_POLICY = {
	eligibility: "complete-fresh-verified-two-task-vector-only",
	objective: "calibration-normalized-minimax",
	calibrationDenominators: { blowfish: 3898, bzip2: 28_748 },
	tieBreakers: ["blowfish-ir", "bzip2-ir", "candidate-sha256", "call-ordinal"],
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_STOP_POLICY = {
	completeSemanticRejectionConsumesCallAndContinues: true,
	apparatusFailureStopsImmediately: true,
	scientificPolicyNonconformanceStopsImmediately: true,
	missingCallsAreNeverRetriedOrReplaced: true,
	allFailuresAfterAttemptLockConsumeScientificIdentity: true,
	outputReadinessProbeBeforeAttemptLock: true,
	postLockPersistenceAtomicityLimit:
		"catastrophic-local-filesystem-failure-between-create-only-attempt-lock-and-output-ledger-initialization-may-leave-the-attempt-lock-as-sole-durable-evidence-identity-remains-consumed-no-rerun",
	directionalWinAction: "authorize-one-fresh-randomized-order-replication-only",
	directionalNonWinAction: "kill-proxy-cascade-v1",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PAID_IMPLEMENTATION_ENTRYPOINTS = [
	"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
	"research/autoresearch/src/compiler-gym-proxy-cascade-paid-preregistration-cli.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-paid-preregistration.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-paid-protocol.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-paid-provider.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-paid-runner.ts",
	"research/autoresearch/package.json",
	"research/autoresearch/tsconfig.json",
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"tsconfig.base.json",
] as const;

export interface CompilerGymProxyCascadePaidSourceRecord {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymProxyCascadePaidPreregistrationBuildInput {
	createdAt: string;
	drawHex: string;
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	resourcePreregistrationContents: string;
	resourceResultContents: string;
	resourceLedgerContents: string;
	rlmResultContents: string;
	rlmLedgerContents: string;
	rlmManifestStartContents: string;
	rlmManifestEndContents: string;
	previousAttemptPreregistrationContents: string;
	previousAttemptResultContents: string;
	previousAttemptLedgerContents: string;
	previousAttemptTerminalSealContents: string;
	previousAttemptSessionContents: string;
	authoritativeActions: readonly string[];
	implementationClosure: readonly CompilerGymProxyCascadePaidSourceRecord[];
	runtimeWorktreeSnapshot: RepositorySnapshot;
	providerRegistryClosure: CompilerGymProxyCascadePaidProviderRegistryClosure;
}

export interface CompilerGymProxyCascadePaidPreregistration {
	schemaVersion: 2;
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_PAID_PREREGISTRATION_PROTOCOL;
	screenProtocol: typeof COMPILER_GYM_PROXY_CASCADE_PAID_PROTOCOL;
	runnerProtocol: typeof COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL;
	pairId: typeof COMPILER_GYM_PROXY_CASCADE_PAID_PAIR_ID;
	createdAt: string;
	status: "preregistered-before-arm-order-dispatch-provider-tool-or-evaluator-use";
	classification: "prospective-single-randomized-order-paid-directional-pilot";
	question: string;
	hypothesis: string;
	claimClass: "observed-directional-single-pair-only";
	randomization: {
		method: "cryptographic-16-byte-parity-v1";
		entropyBytes: 16;
		drawHex: string;
		drawSha256: string;
		armOrder: readonly [CompilerGymProxyCascadePaidArm, CompilerGymProxyCascadePaidArm];
		recordedCreateOnlyBeforeDispatch: true;
	};
	sourceEvidence: {
		resourceScreen: typeof COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE & {
			semanticJoinPassed: true;
		};
		rlmCanary: typeof COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE & {
			semanticJoinPassed: true;
		};
		apparatusRepair: typeof COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE & {
			semanticJoinPassed: true;
		};
	};
	frozenCommon: {
		primeAgentCommit: string;
		provider: "openai-codex";
		model: "gpt-5.6-luna";
		thinkingLevel: "xhigh";
		requestedAndLocallyEffectiveServiceTier: "priority";
		transport: "sse";
		auth: typeof COMPILER_GYM_HARDENED_PAID_MODEL_POLICY;
		prompt: string;
		promptSha256: string;
		tool: typeof COMPILER_GYM_PROXY_CASCADE_PAID_TOOL;
		toolSha256: string;
		tasks: typeof STOCK_CPU_TASKS;
		firstRequest: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST;
		firstRequestActionsSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256;
		firstRequestExpectedMetrics: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS;
		authoritativeActions: string[];
		authoritativeActionsSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256;
		verifierEpoch: typeof COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH;
		canonicalEvaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256;
		irDeltaEvaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256;
		evaluatorSourceBundleSha256: string;
		environment: typeof DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT;
		liveEnvironmentGate: {
			protocol: typeof COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL;
			probeSourceSha256: typeof COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256;
			expectedResultSha256: string;
			timing: "immediately-before-each-of-eight-actual-provider-requests";
		};
	};
	isolation: typeof COMPILER_GYM_PROXY_CASCADE_PAID_ISOLATION;
	turnContract: typeof COMPILER_GYM_PROXY_CASCADE_PAID_TURN_CONTRACT;
	allocation: typeof COMPILER_GYM_PROXY_CASCADE_PAID_ALLOCATION_POLICY;
	budgets: typeof COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS;
	resourceThresholds: typeof COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_THRESHOLDS;
	operationalGates: typeof COMPILER_GYM_PROXY_CASCADE_PAID_OPERATIONAL_GATES;
	qualityGates: typeof COMPILER_GYM_PROXY_CASCADE_PAID_QUALITY_GATES;
	championPolicy: typeof COMPILER_GYM_PROXY_CASCADE_PAID_CHAMPION_POLICY;
	stopPolicy: typeof COMPILER_GYM_PROXY_CASCADE_PAID_STOP_POLICY;
	terminalTaxonomy: typeof COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY;
	claimLimits: typeof COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS;
	providerSpec: CompilerGymProxyCascadePaidProviderSpec;
	providerSpecSha256: string;
	providerRegistryClosure: CompilerGymProxyCascadePaidProviderRegistryClosure;
	implementationClosure: CompilerGymProxyCascadePaidSourceRecord[];
	implementationBundleSha256: string;
	runtimeWorktreeClosure: {
		roots: typeof PRIME_RUNTIME_WORKTREE_PATHS;
		snapshot: RepositorySnapshot;
		snapshotSha256: string;
	};
	launchPaths: {
		repoRoot: string;
		preregistrationPath: string;
		outputDir: string;
		controlOutputDir: string;
		treatmentOutputDir: string;
		hiddenAuditOutputDir: string;
		providerRequestAnchorPath: string;
	};
	localAttemptLock: {
		protocol: "proxy-cascade-paid-local-attempt-lock-v1";
		path: string;
		scientificIdentitySha256: string;
		createMode: 384;
		consumption: "before-first-dispatch-no-retry-never-removed-by-runner";
		crossWorktree: true;
	};
	remoteLocks: {
		parentRoot: typeof COMPILER_GYM_PROXY_CASCADE_PAID_REMOTE_LOCK_PARENT;
		root: string;
		globalPath: string;
		armPaths: Record<CompilerGymProxyCascadePaidArm, string>;
		selectionPath: string;
		onlineTerminalPath: string;
		auditPath: string;
		terminalPath: string;
		kinds: readonly [
			"global",
			"full-control",
			"proxy-cascade",
			"selection",
			"online-terminal",
			"hidden-audit",
			"terminal",
		];
		createOnlyMode0600FsyncReadbackNeverRemoved: true;
	};
	localSeals: {
		root: string;
		armPaths: Record<CompilerGymProxyCascadePaidArm, string>;
		selectionPath: string;
		onlineTerminalPath: string;
		auditPath: string;
		terminalPath: string;
		writeContract: "exclusive-create-mode-0600-write-fsync-close-readback-exact";
	};
	scientificIdentitySha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function parseJson(contents: string, path: string): Record<string, unknown> {
	try {
		return record(JSON.parse(contents) as unknown, path);
	} catch (error) {
		throw new Error(`${path} is not valid JSON`, { cause: error });
	}
}

function terminalLedgerHash(contents: string, expectedCount: number, path: string): string {
	verifyLedgerContentsStrict(contents);
	const lines = contents.trimEnd().split("\n");
	if (lines.length !== expectedCount) throw new Error(`${path} event count drifted`);
	const terminal = parseJson(lines.at(-1)!, `${path} terminal event`);
	if (typeof terminal.hash !== "string" || !SHA256.test(terminal.hash))
		throw new Error(`${path} terminal hash is invalid`);
	return terminal.hash;
}

function assertFrozenContents(contents: string, source: { path: string; sha256: string }): void {
	if (sha256Text(contents) !== source.sha256) throw new Error(`${source.path} SHA-256 drifted`);
}

function validateResourceScreen(input: CompilerGymProxyCascadePaidPreregistrationBuildInput): void {
	assertFrozenContents(
		input.resourcePreregistrationContents,
		COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.preregistration,
	);
	assertFrozenContents(input.resourceResultContents, COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.result);
	assertFrozenContents(input.resourceLedgerContents, COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.ledger);
	if (
		terminalLedgerHash(
			input.resourceLedgerContents,
			COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.ledger.eventCount,
			"resource screen ledger",
		) !== COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.ledger.terminalEventSha256
	) {
		throw new Error("Resource screen terminal ledger hash drifted");
	}
	const preregistration = parseJson(input.resourcePreregistrationContents, "resource screen preregistration");
	const result = parseJson(input.resourceResultContents, "resource screen result");
	const gate = record(result.gate, "resource screen result.gate");
	const isolation = record(result.isolation, "resource screen result.isolation");
	if (
		preregistration.scientificIdentitySha256 !==
			COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.scientificIdentitySha256 ||
		result.scientificIdentitySha256 !==
			COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.scientificIdentitySha256 ||
		result.preregistrationSha256 !==
			COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.preregistration.sha256 ||
		result.ledgerSha256 !== COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.ledger.sha256 ||
		result.ledgerTerminalHash !==
			COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.ledger.terminalEventSha256 ||
		result.ok !== true ||
		gate.passed !== true ||
		result.disposition !== COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.disposition ||
		result.liveScientificEvidenceEligible !== true ||
		isolation.modelCalls !== 0 ||
		isolation.providerDispatches !== 0 ||
		isolation.toolCalls !== 0 ||
		isolation.compactions !== 0 ||
		isolation.rlmChildren !== 0 ||
		isolation.measurementReuse !== false
	) {
		throw new Error("Resource screen did not semantically join the passing model-free qualification");
	}
}

function validateRlmCanary(input: CompilerGymProxyCascadePaidPreregistrationBuildInput): void {
	for (const [contents, source] of [
		[input.rlmResultContents, COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.result],
		[input.rlmLedgerContents, COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.ledger],
		[input.rlmManifestStartContents, COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.manifestStart],
		[input.rlmManifestEndContents, COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.manifestEnd],
	] as const) {
		assertFrozenContents(contents, source);
	}
	if (
		terminalLedgerHash(
			input.rlmLedgerContents,
			COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.ledger.eventCount,
			"RLM canary ledger",
		) !== COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.ledger.terminalEventSha256
	) {
		throw new Error("RLM canary terminal ledger hash drifted");
	}
	const result = parseJson(input.rlmResultContents, "RLM canary result");
	const start = parseJson(input.rlmManifestStartContents, "RLM canary start manifest");
	const end = parseJson(input.rlmManifestEndContents, "RLM canary end manifest");
	const compaction = record(result.compaction, "RLM canary result.compaction");
	const receipt = record(result.parentReceipt, "RLM canary result.parentReceipt");
	const adapterDispatches = record(result.adapterDispatches, "RLM canary result.adapterDispatches");
	const dedupe = record(result.dedupeProbe, "RLM canary result.dedupeProbe");
	if (
		result.ok !== true ||
		result.outcome !== "succeeded" ||
		result.model !== "openai-codex/gpt-5.6-luna" ||
		result.thinkingLevel !== "xhigh" ||
		result.requestedAndLocallyEffectiveServiceTier !== "priority" ||
		result.persistedCompactions !== 1 ||
		!Array.isArray(compaction.requiredMarkers) ||
		compaction.requiredMarkers.length !== 3 ||
		receipt.deliveryStatus !== "delivered" ||
		adapterDispatches.total !== 1 ||
		dedupe.duplicate !== true ||
		start.model !== result.model ||
		start.thinkingLevel !== result.thinkingLevel ||
		start.requestedServiceTier !== "priority" ||
		end.outcome !== "succeeded" ||
		end.persistedCompactions !== 1
	) {
		throw new Error("RLM canary did not semantically join live tool, child, compaction, and continuity evidence");
	}
}

function validateApparatusRepairEvidence(input: CompilerGymProxyCascadePaidPreregistrationBuildInput): void {
	const evidence = COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE;
	for (const [contents, source] of [
		[input.previousAttemptPreregistrationContents, evidence.preregistration],
		[input.previousAttemptResultContents, evidence.result],
		[input.previousAttemptLedgerContents, evidence.ledger],
		[input.previousAttemptTerminalSealContents, evidence.terminalSeal],
		[input.previousAttemptSessionContents, evidence.session],
	] as const) {
		assertFrozenContents(contents, source);
	}
	if (
		terminalLedgerHash(
			input.previousAttemptLedgerContents,
			evidence.ledger.eventCount,
			"previous paid attempt ledger",
		) !== evidence.ledger.terminalEventSha256
	) {
		throw new Error("Previous paid attempt terminal ledger hash drifted");
	}

	const preregistration = parseJson(
		input.previousAttemptPreregistrationContents,
		"previous paid attempt preregistration",
	);
	const result = parseJson(input.previousAttemptResultContents, "previous paid attempt result");
	const terminalSeal = parseJson(input.previousAttemptTerminalSealContents, "previous paid attempt terminal seal");
	const arms = record(result.arms, "previous paid attempt result.arms");
	const control = record(arms["full-control"], "previous paid attempt result.arms.full-control");
	const observation = record(control.observation, "previous paid attempt control observation");
	const providerGuard = record(control.providerGuard, "previous paid attempt control provider guard");
	const providerPair = record(result.providerPair, "previous paid attempt provider pair");
	const providerRequestBodySha256s = Array.isArray(providerGuard.providerRequestBodySha256s)
		? providerGuard.providerRequestBodySha256s
		: [];
	const providerFailures = Array.isArray(providerGuard.failures) ? providerGuard.failures : [];
	const completedArms = Array.isArray(providerPair.completedArms) ? providerPair.completedArms : [];
	const pairFailures = Array.isArray(providerPair.failures) ? providerPair.failures : [];
	const localSeals = Array.isArray(result.localSeals) ? result.localSeals : [];
	const remoteLocks = Array.isArray(result.remoteLocks) ? result.remoteLocks : [];
	const terminalLocalSeal = localSeals.find(
		(value) => typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "terminal",
	);
	const terminalRemoteLock = remoteLocks.find(
		(value) => typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "terminal",
	);
	const allocations = Array.isArray(result.allocations) ? result.allocations : [];
	if (
		preregistration.scientificIdentitySha256 !== evidence.scientificIdentitySha256 ||
		result.scientificIdentitySha256 !== evidence.scientificIdentitySha256 ||
		result.preregistrationSha256 !== evidence.preregistration.sha256 ||
		result.ok !== false ||
		result.assessment !== null ||
		result.liveScientificEvidenceEligible !== false ||
		result.terminalClassification !== evidence.terminalClassification ||
		typeof result.failure !== "string" ||
		!result.failure.includes(evidence.failure) ||
		result.ledgerSha256 !== evidence.ledger.sha256 ||
		result.ledgerTerminalHash !== evidence.ledger.terminalEventSha256 ||
		Object.keys(arms).length !== 1 ||
		observation.actualProviderDispatches !== evidence.actualProviderDispatches ||
		observation.actualToolCalls !== evidence.actualToolCalls ||
		observation.measurementReuseCount !== 0 ||
		observation.compactionCount !== 0 ||
		observation.rlmChildCount !== 0 ||
		providerGuard.providerRequestAttempts !== evidence.providerRequestAttempts ||
		providerRequestBodySha256s.length !== evidence.providerRequestAttempts ||
		providerRequestBodySha256s.at(-1) !== evidence.rejectedProviderRequestBodySha256 ||
		providerFailures.length !== 1 ||
		providerFailures[0] !== evidence.failure ||
		completedArms.length !== 0 ||
		pairFailures.length !== 1 ||
		pairFailures[0] !== evidence.failure ||
		control.sessionSha256AtOnlineTerminal !== evidence.session.sha256 ||
		allocations.length !== evidence.allocationCount ||
		!terminalLocalSeal ||
		terminalLocalSeal.contentsSha256 !== evidence.terminalSeal.sha256 ||
		!terminalRemoteLock ||
		terminalRemoteLock.contentsSha256 !== evidence.remoteTerminalLockSha256 ||
		terminalSeal.scientificIdentitySha256 !== evidence.scientificIdentitySha256 ||
		terminalSeal.failureSha256 !== evidence.failureSha256 ||
		terminalSeal.allocationCount !== evidence.allocationCount ||
		terminalSeal.preTerminalFailureClassification !== evidence.terminalClassification
	) {
		throw new Error("Previous paid attempt did not semantically join the sealed apparatus attrition");
	}

	const sessionRows = input.previousAttemptSessionContents
		.trimEnd()
		.split("\n")
		.map((line, index) => parseJson(line, `previous paid attempt session line ${index + 1}`));
	const sessionMessages = sessionRows
		.filter((row) => row.type === "message")
		.map((row, index) => record(row.message, `previous paid attempt session message ${index + 1}`));
	const assistants = sessionMessages.filter((message) => message.role === "assistant");
	const toolResults = sessionMessages.filter((message) => message.role === "toolResult");
	const aborted = assistants.filter((message) => message.stopReason === "aborted");
	const abortedUsage = aborted.length === 1 ? record(aborted[0]!.usage, "previous paid attempt aborted usage") : {};
	if (
		assistants.filter((message) => message.stopReason === "toolUse").length !== evidence.actualProviderDispatches ||
		toolResults.length !== evidence.actualToolCalls ||
		aborted.length !== 1 ||
		abortedUsage.totalTokens !== 0
	) {
		throw new Error("Previous paid attempt session does not match the sealed two-call apparatus prefix");
	}
}

export { compilerGymProxyCascadePaidArmOrder } from "./compiler-gym-proxy-cascade-paid-protocol.js";

function validateImplementationClosure(
	value: readonly CompilerGymProxyCascadePaidSourceRecord[],
): CompilerGymProxyCascadePaidSourceRecord[] {
	const closure = value.map((source, index) => {
		if (
			!source.relativePath ||
			source.relativePath.startsWith("/") ||
			source.relativePath.includes("\\") ||
			source.relativePath.split("/").some((part) => part === "" || part === "." || part === "..") ||
			!SHA256.test(source.sha256)
		) {
			throw new Error(`Paid-pilot implementation source ${index} is invalid`);
		}
		if (index > 0 && value[index - 1]!.relativePath >= source.relativePath) {
			throw new Error("Paid-pilot implementation closure must be uniquely sorted");
		}
		return { ...source };
	});
	const paths = new Set(closure.map((source) => source.relativePath));
	for (const entrypoint of COMPILER_GYM_PROXY_CASCADE_PAID_IMPLEMENTATION_ENTRYPOINTS) {
		if (!paths.has(entrypoint)) throw new Error(`Paid-pilot implementation closure omitted ${entrypoint}`);
	}
	return closure;
}

function validateSnapshot(snapshot: RepositorySnapshot): RepositorySnapshot {
	if (snapshot.head !== FROZEN_CAMPAIGN.repositories.primeAgent.commit)
		throw new Error("Paid-pilot runtime HEAD drifted");
	assert.deepEqual(Object.keys(snapshot.coreTreeHashes), [...PRIME_RUNTIME_WORKTREE_PATHS]);
	if (!SHA256.test(snapshot.trackedDiffSha256) || !SHA256.test(snapshot.coreWorktreeDigest)) {
		throw new Error("Paid-pilot runtime snapshot digest is invalid");
	}
	if (
		snapshot.coreWorktreeDigest !==
		sha256Json({
			coreWorktreeStatus: snapshot.coreWorktreeStatus,
			trackedDiffSha256: snapshot.trackedDiffSha256,
			untrackedFileHashes: snapshot.untrackedFileHashes,
		})
	) {
		throw new Error("Paid-pilot runtime snapshot is not self-binding");
	}
	return structuredClone(snapshot);
}

function validateProviderRegistry(
	value: CompilerGymProxyCascadePaidProviderRegistryClosure,
): CompilerGymProxyCascadePaidProviderRegistryClosure {
	const agentDir = resolve(value.agentDir);
	if (
		value.agentDir !== agentDir ||
		value.modelsJsonPath !== resolve(agentDir, "models.json") ||
		value.modelsJsonPresent !== false
	) {
		throw new Error("Paid-pilot provider registry closure drifted");
	}
	return structuredClone(value);
}

function launchPaths(
	input: Pick<CompilerGymProxyCascadePaidPreregistrationBuildInput, "repoRoot" | "preregistrationPath" | "outputDir">,
) {
	const repoRoot = resolve(input.repoRoot);
	const preregistrationPath = resolve(input.preregistrationPath);
	const outputDir = resolve(input.outputDir);
	return {
		repoRoot,
		preregistrationPath,
		outputDir,
		controlOutputDir: resolve(outputDir, "arms/full-control"),
		treatmentOutputDir: resolve(outputDir, "arms/proxy-cascade"),
		hiddenAuditOutputDir: resolve(outputDir, "hidden-audit"),
		providerRequestAnchorPath: resolve(outputDir, "provider-request-anchor.json"),
	};
}

export function assertCompilerGymProxyCascadePaidLaunchPaths(
	value: CompilerGymProxyCascadePaidPreregistration["launchPaths"],
): void {
	if (Object.values(value).some((path) => path !== resolve(path)))
		throw new Error("Paid-pilot launch paths must be absolute");
	if (
		value.preregistrationPath === value.outputDir ||
		value.outputDir.startsWith(`${value.preregistrationPath}${sep}`) ||
		value.preregistrationPath.startsWith(`${value.outputDir}${sep}`)
	) {
		throw new Error("Paid-pilot output directory overlaps the preregistration file");
	}
	for (const [path, label] of [
		[value.preregistrationPath, "preregistration"],
		[value.outputDir, "output"],
	] as const) {
		const withinRepository = relative(value.repoRoot, path);
		if (!withinRepository || withinRepository === ".." || withinRepository.startsWith(`..${sep}`)) {
			throw new Error(`Paid-pilot ${label} path must be inside the repository`);
		}
	}
	if (
		value.controlOutputDir !== resolve(value.outputDir, "arms/full-control") ||
		value.treatmentOutputDir !== resolve(value.outputDir, "arms/proxy-cascade") ||
		value.hiddenAuditOutputDir !== resolve(value.outputDir, "hidden-audit") ||
		value.providerRequestAnchorPath !== resolve(value.outputDir, "provider-request-anchor.json")
	) {
		throw new Error("Paid-pilot derived launch paths drifted");
	}
	if (new Set([value.controlOutputDir, value.treatmentOutputDir, value.hiddenAuditOutputDir]).size !== 3) {
		throw new Error("Paid-pilot arm and audit output directories must be disjoint");
	}
}

function lockAndSealPaths(scientificIdentitySha256: string, outputDir: string) {
	const remoteRoot = `${COMPILER_GYM_PROXY_CASCADE_PAID_REMOTE_LOCK_PARENT}/${scientificIdentitySha256}`;
	const localSealRoot = resolve(outputDir, "seals");
	return {
		localAttemptLock: {
			protocol: "proxy-cascade-paid-local-attempt-lock-v1" as const,
			path: resolve(
				homedir(),
				".local/state/prime-agent-autoresearch/attempt-locks",
				`proxy-cascade-paid-${scientificIdentitySha256}.lock`,
			),
			scientificIdentitySha256,
			createMode: 0o600 as 384,
			consumption: "before-first-dispatch-no-retry-never-removed-by-runner" as const,
			crossWorktree: true as const,
		},
		remoteLocks: {
			parentRoot: COMPILER_GYM_PROXY_CASCADE_PAID_REMOTE_LOCK_PARENT,
			root: remoteRoot,
			globalPath: `${remoteRoot}/global.lock`,
			armPaths: {
				"full-control": `${remoteRoot}/full-control.lock`,
				"proxy-cascade": `${remoteRoot}/proxy-cascade.lock`,
			},
			selectionPath: `${remoteRoot}/selection.lock`,
			onlineTerminalPath: `${remoteRoot}/online-terminal.lock`,
			auditPath: `${remoteRoot}/hidden-audit.lock`,
			terminalPath: `${remoteRoot}/terminal.lock`,
			kinds: [
				"global",
				"full-control",
				"proxy-cascade",
				"selection",
				"online-terminal",
				"hidden-audit",
				"terminal",
			] as const,
			createOnlyMode0600FsyncReadbackNeverRemoved: true as const,
		},
		localSeals: {
			root: localSealRoot,
			armPaths: {
				"full-control": resolve(localSealRoot, "full-control.json"),
				"proxy-cascade": resolve(localSealRoot, "proxy-cascade.json"),
			},
			selectionPath: resolve(localSealRoot, "selection.json"),
			onlineTerminalPath: resolve(localSealRoot, "online-terminal.json"),
			auditPath: resolve(localSealRoot, "hidden-audit.json"),
			terminalPath: resolve(localSealRoot, "terminal.json"),
			writeContract: "exclusive-create-mode-0600-write-fsync-close-readback-exact" as const,
		},
	};
}

export function buildCompilerGymProxyCascadePaidPreregistration(
	input: CompilerGymProxyCascadePaidPreregistrationBuildInput,
): CompilerGymProxyCascadePaidPreregistration {
	if (!Number.isFinite(Date.parse(input.createdAt)))
		throw new Error("Paid-pilot preregistration timestamp is invalid");
	validateResourceScreen(input);
	validateRlmCanary(input);
	validateApparatusRepairEvidence(input);
	const armOrder = compilerGymProxyCascadePaidArmOrder(input.drawHex);
	const authoritativeActions = [...assertCompilerGymProxyCascadePaidAuthoritativeActions(input.authoritativeActions)];
	if (sha256Json(authoritativeActions) !== COMPILER_GYM_PROXY_CASCADE_PAID_ALLOWED_ACTIONS_SHA256) {
		throw new Error("Paid-pilot action inventory hash drifted");
	}
	const closure = validateImplementationClosure(input.implementationClosure);
	const implementationBundleSha256 = sha256Json(closure);
	const snapshot = validateSnapshot(input.runtimeWorktreeSnapshot);
	const snapshotSha256 = sha256Json(snapshot);
	const providerRegistryClosure = validateProviderRegistry(input.providerRegistryClosure);
	const paths = launchPaths(input);
	assertCompilerGymProxyCascadePaidLaunchPaths(paths);
	const providerSessionId = `pcp-${sha256Json({
		pairId: COMPILER_GYM_PROXY_CASCADE_PAID_PAIR_ID,
		drawHex: input.drawHex,
		implementationBundleSha256,
		snapshotSha256,
		providerRegistryClosure,
		resourceScreenSha256: COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.result.sha256,
		rlmCanarySha256: COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.result.sha256,
		apparatusRepairSha256: COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.result.sha256,
	}).slice(0, 32)}`;
	const providerSpec = buildCompilerGymProxyCascadePaidProviderSpec({
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_PROXY_CASCADE_PAID_PAIR_ID,
		arms: COMPILER_GYM_PROXY_CASCADE_PAID_ARMS,
		prompt: COMPILER_GYM_PROXY_CASCADE_PAID_PROMPT,
		tool: COMPILER_GYM_PROXY_CASCADE_PAID_TOOL,
		providerSessionId,
		providerVisibleWorkspace: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_VISIBLE_WORKSPACE,
		providerVisibleConversationLog: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_VISIBLE_CONVERSATION_LOG,
		agentRegistry: providerRegistryClosure,
	});
	const providerSpecSha256 = sha256Json(providerSpec);
	const scientificIdentitySha256 = sha256Json({
		protocol: COMPILER_GYM_PROXY_CASCADE_PAID_PREREGISTRATION_PROTOCOL,
		screenProtocol: COMPILER_GYM_PROXY_CASCADE_PAID_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_PROXY_CASCADE_PAID_PAIR_ID,
		randomization: { drawHex: input.drawHex, armOrder },
		resourceScreen: COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE,
		rlmCanary: COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE,
		apparatusRepair: COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE,
		promptSha256: sha256Text(COMPILER_GYM_PROXY_CASCADE_PAID_PROMPT),
		toolSha256: sha256Json(COMPILER_GYM_PROXY_CASCADE_PAID_TOOL),
		authoritativeActions,
		frozenEvaluator: {
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
			canonicalEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
			irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			evaluatorSourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			environment: DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
		},
		modelPolicy: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
		isolation: COMPILER_GYM_PROXY_CASCADE_PAID_ISOLATION,
		turnContract: COMPILER_GYM_PROXY_CASCADE_PAID_TURN_CONTRACT,
		allocation: COMPILER_GYM_PROXY_CASCADE_PAID_ALLOCATION_POLICY,
		budgets: COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS,
		resourceThresholds: COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_THRESHOLDS,
		operationalGates: COMPILER_GYM_PROXY_CASCADE_PAID_OPERATIONAL_GATES,
		qualityGates: COMPILER_GYM_PROXY_CASCADE_PAID_QUALITY_GATES,
		championPolicy: COMPILER_GYM_PROXY_CASCADE_PAID_CHAMPION_POLICY,
		stopPolicy: COMPILER_GYM_PROXY_CASCADE_PAID_STOP_POLICY,
		terminalTaxonomy: COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY,
		claimLimits: COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS,
		providerSpecSha256,
		implementationBundleSha256,
		snapshotSha256,
	});
	const derived = lockAndSealPaths(scientificIdentitySha256, paths.outputDir);
	return {
		schemaVersion: 2,
		protocol: COMPILER_GYM_PROXY_CASCADE_PAID_PREREGISTRATION_PROTOCOL,
		screenProtocol: COMPILER_GYM_PROXY_CASCADE_PAID_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_PAID_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_PROXY_CASCADE_PAID_PAIR_ID,
		createdAt: input.createdAt,
		status: "preregistered-before-arm-order-dispatch-provider-tool-or-evaluator-use",
		classification: "prospective-single-randomized-order-paid-directional-pilot",
		question:
			"Does the proxy-cascade policy preserve verified adaptive CompilerGym quality while reducing online evaluator compute and wait versus full two-task feedback?",
		hypothesis:
			"Four fresh blowfish measurements followed by exact top-two bzip2 confirmation will retain the useful two-task frontier while reducing online CPU and evaluator wait.",
		claimClass: "observed-directional-single-pair-only",
		randomization: {
			method: "cryptographic-16-byte-parity-v1",
			entropyBytes: 16,
			drawHex: input.drawHex,
			drawSha256: createHash("sha256").update(Buffer.from(input.drawHex, "hex")).digest("hex"),
			armOrder,
			recordedCreateOnlyBeforeDispatch: true,
		},
		sourceEvidence: {
			resourceScreen: {
				...structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE),
				semanticJoinPassed: true,
			},
			rlmCanary: {
				...structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE),
				semanticJoinPassed: true,
			},
			apparatusRepair: {
				...structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE),
				semanticJoinPassed: true,
			},
		},
		frozenCommon: {
			primeAgentCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			thinkingLevel: "xhigh",
			requestedAndLocallyEffectiveServiceTier: "priority",
			transport: "sse",
			auth: structuredClone(COMPILER_GYM_HARDENED_PAID_MODEL_POLICY),
			prompt: COMPILER_GYM_PROXY_CASCADE_PAID_PROMPT,
			promptSha256: sha256Text(COMPILER_GYM_PROXY_CASCADE_PAID_PROMPT),
			tool: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_TOOL),
			toolSha256: sha256Json(COMPILER_GYM_PROXY_CASCADE_PAID_TOOL),
			tasks: STOCK_CPU_TASKS,
			firstRequest: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			firstRequestActionsSha256: COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
			firstRequestExpectedMetrics: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS),
			authoritativeActions,
			authoritativeActionsSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
			canonicalEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
			irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			evaluatorSourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
			liveEnvironmentGate: {
				protocol: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
				probeSourceSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
				expectedResultSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
				timing: "immediately-before-each-of-eight-actual-provider-requests",
			},
		},
		isolation: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_ISOLATION),
		turnContract: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_TURN_CONTRACT),
		allocation: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_ALLOCATION_POLICY),
		budgets: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_BUDGETS),
		resourceThresholds: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_THRESHOLDS),
		operationalGates: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_OPERATIONAL_GATES),
		qualityGates: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_QUALITY_GATES),
		championPolicy: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_CHAMPION_POLICY),
		stopPolicy: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_STOP_POLICY),
		terminalTaxonomy: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY),
		claimLimits: structuredClone(COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS),
		providerSpec,
		providerSpecSha256,
		providerRegistryClosure,
		implementationClosure: closure,
		implementationBundleSha256,
		runtimeWorktreeClosure: { roots: PRIME_RUNTIME_WORKTREE_PATHS, snapshot, snapshotSha256 },
		launchPaths: paths,
		...derived,
		scientificIdentitySha256,
	};
}

export const reconstructCompilerGymProxyCascadePaidPreregistration = buildCompilerGymProxyCascadePaidPreregistration;

export function parseCompilerGymProxyCascadePaidPreregistration(input: {
	value: unknown;
	expected: CompilerGymProxyCascadePaidPreregistrationBuildInput;
}): CompilerGymProxyCascadePaidPreregistration {
	const expected = buildCompilerGymProxyCascadePaidPreregistration(input.expected);
	assert.deepEqual(input.value, expected, "Paid-pilot preregistration differs from the frozen reconstruction");
	return expected;
}

async function readPinnedRegularUtf8(
	absolutePath: string,
	requiredMode?: number,
): Promise<{ contents: string; mode: number }> {
	const metadata = await lstat(absolutePath);
	if (!metadata.isFile() || metadata.isSymbolicLink())
		throw new Error(`Paid-pilot source is not a regular non-symlink: ${absolutePath}`);
	const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino) {
			throw new Error(`Paid-pilot source changed before pinned read: ${absolutePath}`);
		}
		if (requiredMode !== undefined && (before.mode & 0o777) !== requiredMode) {
			throw new Error(`Paid-pilot source mode drifted: ${absolutePath}`);
		}
		const contents = await handle.readFile("utf8");
		const after = await handle.stat();
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs ||
			after.mode !== before.mode
		) {
			throw new Error(`Paid-pilot source changed during pinned read: ${absolutePath}`);
		}
		return { contents, mode: before.mode };
	} finally {
		await handle.close();
	}
}

export async function collectCompilerGymProxyCascadePaidImplementationClosure(
	repoRoot: string,
): Promise<CompilerGymProxyCascadePaidSourceRecord[]> {
	const root = await realpath(resolve(repoRoot));
	const queued: string[] = [...COMPILER_GYM_PROXY_CASCADE_PAID_IMPLEMENTATION_ENTRYPOINTS];
	const discovered = new Map<string, string>();
	const staticImportPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g;
	const resolveLocalImport = async (fromPath: string, specifier: string): Promise<string> => {
		const raw = resolve(dirname(resolve(root, fromPath)), specifier);
		const candidates =
			extname(raw) === ".js"
				? [`${raw.slice(0, -3)}.ts`, `${raw.slice(0, -3)}.tsx`]
				: extname(raw)
					? [raw]
					: [`${raw}.ts`, `${raw}.tsx`, resolve(raw, "index.ts")];
		for (const candidate of candidates) {
			try {
				const canonical = await realpath(candidate);
				if (!(await stat(canonical)).isFile()) continue;
				const path = relative(root, canonical).split(sep).join("/");
				if (!path || path === ".." || path.startsWith("../"))
					throw new Error(`Paid-pilot import escapes repository: ${specifier}`);
				return path;
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
				throw error;
			}
		}
		throw new Error(`Paid-pilot static import is unresolved: ${fromPath} -> ${specifier}`);
	};
	while (queued.length > 0) {
		const relativePath = queued.pop();
		if (!relativePath || discovered.has(relativePath)) continue;
		const absolutePath = await realpath(resolve(root, relativePath));
		const canonicalRelative = relative(root, absolutePath).split(sep).join("/");
		if (canonicalRelative !== relativePath)
			throw new Error(`Paid-pilot implementation path is noncanonical: ${relativePath}`);
		const { contents } = await readPinnedRegularUtf8(absolutePath);
		discovered.set(relativePath, sha256Text(contents));
		if (!relativePath.endsWith(".ts")) continue;
		for (const match of contents.matchAll(staticImportPattern)) {
			const specifier = match[1];
			if (!specifier) continue;
			const imported = await resolveLocalImport(relativePath, specifier);
			if (!discovered.has(imported)) queued.push(imported);
		}
	}
	return [...discovered.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([relativePath, sha256]) => ({ relativePath, sha256 }));
}

export async function captureCompilerGymProxyCascadePaidProviderRegistryClosure(
	agentDirInput: string,
): Promise<CompilerGymProxyCascadePaidProviderRegistryClosure> {
	const agentDir = resolve(agentDirInput);
	const modelsJsonPath = resolve(agentDir, "models.json");
	try {
		await stat(modelsJsonPath);
		throw new Error(`Paid-pilot forbids an active models.json: ${modelsJsonPath}`);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { agentDir, modelsJsonPath, modelsJsonPresent: false };
		}
		throw error;
	}
}

export function canonicalCompilerGymProxyCascadePaidPreregistration(
	value: CompilerGymProxyCascadePaidPreregistration,
): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

export async function writeCompilerGymProxyCascadePaidPreregistration(input: {
	repoRoot: string;
	path: string;
	outputDir?: string;
	createdAt?: string;
	drawHex?: string;
}): Promise<{ path: string; sha256: string; record: CompilerGymProxyCascadePaidPreregistration }> {
	const repoRoot = await realpath(resolve(input.repoRoot));
	const path = resolve(input.path);
	const outputDir = resolve(input.outputDir ?? resolve(dirname(path), "execution"));
	const paths = launchPaths({ repoRoot, preregistrationPath: path, outputDir });
	assertCompilerGymProxyCascadePaidLaunchPaths(paths);
	try {
		await stat(outputDir);
		throw new Error("Paid-pilot output directory must be absent when preregistering");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const readEvidence = async (source: { path: string; sha256: string }) => {
		const contents = (await readPinnedRegularUtf8(resolve(repoRoot, source.path), 0o600)).contents;
		assertFrozenContents(contents, source);
		return contents;
	};
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
		readPinnedRegularUtf8(resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py")).then(
			({ contents }) => contents,
		),
		collectCompilerGymProxyCascadePaidImplementationClosure(repoRoot),
		captureCompilerGymProxyCascadePaidProviderRegistryClosure(getAgentDir()),
	]);
	if (sha256Text(authoritativeEvaluatorContents) !== COMPILER_GYM_EVALUATOR_SHA256) {
		throw new Error("Paid-pilot authoritative evaluator differs from the frozen hash");
	}
	const record = buildCompilerGymProxyCascadePaidPreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		drawHex: input.drawHex ?? randomBytes(16).toString("hex"),
		repoRoot,
		preregistrationPath: path,
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
	});
	const contents = canonicalCompilerGymProxyCascadePaidPreregistration(record);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
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
	const readback = await readPinnedRegularUtf8(path, 0o600);
	if (readback.contents !== contents) throw new Error("Paid-pilot preregistration readback drifted");
	return { path, sha256: sha256Text(contents), record };
}

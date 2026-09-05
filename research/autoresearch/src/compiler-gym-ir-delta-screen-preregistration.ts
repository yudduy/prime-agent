import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_SCREEN_ARMS,
	COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
	COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_TERMINAL_TAXONOMY,
	COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
	type CompilerGymIrDeltaScreenArm,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	PRIME_RUNTIME_WORKTREE_PATHS,
	type RepositorySnapshot,
} from "./stock-interface-parity.js";

export const COMPILER_GYM_IR_DELTA_SCREEN_PREREGISTRATION_PROTOCOL =
	"compiler-gym-ir-delta-paid-screen-preregistration-v2" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_SHA256 =
	"cbcac6534932cd1bb28ddd7591d10f641537a2dff3a0b6d95e777adde22ebd47" as const;
export const COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_ARTIFACT_SHA256 =
	"cbcac6534932cd1bb28ddd7591d10f641537a2dff3a0b6d95e777adde22ebd47" as const;

export const COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY = {
	provider: "openai-codex",
	id: "gpt-5.6-luna",
	api: "openai-codex-responses",
	baseUrl: "https://chatgpt.com/backend-api",
	baseUrlPolicy: "exact-canonical-url-without-trailing-slash-v1",
	allowedModelHeaderNames: [] as readonly string[],
	allowedResolvedRequestHeaderNames: [] as readonly string[],
	requiredStoredCredentialType: "oauth",
	requiredAuthSource: "stored",
	oauthProviderRegistrationRequired: true,
	registryLoadErrorAllowed: false,
	modelsJsonApiKeyFallbackAllowed: false,
} as const;

export const COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE = {
	preregistration: {
		path: ".autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/preregistration.json",
		sha256: "c9be9a6c4cace30a903c9f698f32e1e234a62de344f4a62a88c9163ee2580a33",
	},
	result: {
		path: ".autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/execution/result.json",
		sha256: "060631a72ed582749fc823cb8a3da0fc0975938442343a1c6639576d50613208",
	},
	ledger: {
		path: ".autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/execution/evidence.jsonl",
		sha256: "e7dec53e1673af776901601ea94343d42b1c939131c7cb7c68ffeb87ba2fe3b3",
	},
	assessmentEventSha256: "7b5e6b2a4c304b266f34da3fd9ba1c56f880d564e60a91ee6362a75b94b7cb84",
	terminalEventSha256: "50e5bcc9cbde5b7ecf5bf444a825443b0aa269d4aaaaa7b806a111c40a20cdbe",
	terminalDisposition: "terminal-complete-scientific-pass",
	decision: "qualify-agent-facing-ir-delta-screen",
	nextGate: "separately-preregistered-paid-agent-screen",
	paidScreenEligible: true,
	lunaAuthorizedByFormalGate: false,
} as const;

export const COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE = {
	apparatusEpoch: 2,
	relationship: "fresh-apparatus-epoch-not-retry-or-replacement",
	repairScope: "cross-language-equivalent-finite-json-number-lexemes-only",
	predecessor: {
		pairId: "compiler-gym-ir-delta-paid-screen-pair-v1",
		preregistration: {
			path: ".autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/preregistration.json",
			sha256: "c423cf047ac0495b0812b413a39e622cbdc8ebcb9bd0664aee20cde55a1e2422",
		},
		result: {
			path: ".autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/execution-v1/result.json",
			sha256: "c4bdea863e0954b6d0f091ebbf09ccd30588ec810b7a8da3e2c6f804bd45a27d",
		},
		ledger: {
			path: ".autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/execution-v1/evidence.jsonl",
			sha256: "8089c67e45916ddf9948ef4c3c9635d7f4ddac2b303419e5b956a603d52cca0e",
		},
		terminalEventSha256: "257712bb496eeebb18e789b8e1663c3448d65982872233f2d7cd7d90fa9a5ff7",
		terminalDisposition: "terminal-apparatus-invalid-not-treatment-result",
		assessment: null,
		actualProviderDispatches: 1,
		actualEvaluatorJobs: 1,
		actualFreshTaskEvaluations: 2,
		scientificResultAdmitted: false,
	},
} as const;

export const COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS = [
	"research/autoresearch/src/compiler-gym-ir-delta-screen-preregistration.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-screen-protocol.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-screen-adapter.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-screen-runner.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-qualification-preregistration.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-qualification-protocol.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-qualification-runner.ts",
	"research/autoresearch/src/compiler-gym-action-trace-preregistration.ts",
	"research/autoresearch/src/compiler-gym-action-trace-protocol.ts",
	"research/autoresearch/src/compiler-gym-action-trace-qualification-runner.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-preregistration.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-protocol.ts",
	"research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
	"research/autoresearch/src/compiler-gym-warm-transport.ts",
	"research/autoresearch/src/stock-interface-parity.ts",
	"research/autoresearch/src/stock-interface-parity-protocol.ts",
	"research/autoresearch/src/stock-cpu-evaluation-envelope.ts",
	"research/autoresearch/src/stock-cpu-eval.ts",
	"research/autoresearch/src/stock-cpu-protocol.ts",
	"research/autoresearch/src/host-owned-terminalization.ts",
	"research/autoresearch/src/compiler-gym-adapter.ts",
	"research/autoresearch/src/controller.ts",
	"research/autoresearch/src/evaluation-adapter-output-error.ts",
	"research/autoresearch/src/artifact-store.ts",
	"research/autoresearch/src/ledger.ts",
	"research/autoresearch/src/campaign.ts",
	"research/autoresearch/src/canonical-json.ts",
	"research/autoresearch/src/types.ts",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
	"research/autoresearch/farmshare/compiler-gym-environment.lock",
	"research/autoresearch/farmshare/compiler-gym-cbench-ld-library-path.patch",
	"packages/ai/src/api-registry.ts",
	"packages/ai/src/env-api-keys.ts",
	"packages/ai/src/index.ts",
	"packages/ai/src/models.generated.ts",
	"packages/ai/src/models.ts",
	"packages/ai/src/oauth.ts",
	"packages/ai/src/providers/openai-codex-responses.ts",
	"packages/ai/src/providers/openai-responses-shared.ts",
	"packages/ai/src/providers/register-builtins.ts",
	"packages/ai/src/providers/simple-options.ts",
	"packages/ai/src/stream.ts",
	"packages/ai/src/types.ts",
	"packages/ai/src/utils/oauth/index.ts",
	"packages/ai/src/utils/oauth/openai-codex.ts",
	"packages/ai/src/utils/oauth/types.ts",
	"packages/agent/src/agent-loop.ts",
	"packages/agent/src/agent.ts",
	"packages/coding-agent/src/config.ts",
	"packages/coding-agent/src/index.ts",
	"packages/coding-agent/src/core/agent-session.ts",
	"packages/coding-agent/src/core/auth-storage.ts",
	"packages/coding-agent/src/core/extensions/runner.ts",
	"packages/coding-agent/src/core/extensions/types.ts",
	"packages/coding-agent/src/core/model-registry.ts",
	"packages/coding-agent/src/core/prompts/rlm.ts",
	"packages/coding-agent/src/core/resource-loader.ts",
	"packages/coding-agent/src/core/resolve-config-value.ts",
	"packages/coding-agent/src/core/sdk.ts",
	"packages/coding-agent/src/core/session-manager.ts",
	"packages/coding-agent/src/core/settings-manager.ts",
	"packages/coding-agent/src/core/system-prompt.ts",
] as const;

export interface CompilerGymIrDeltaScreenSourceRecord {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymIrDeltaScreenPreregistration {
	schemaVersion: 2;
	protocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_PREREGISTRATION_PROTOCOL;
	screenProtocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL;
	pairId: typeof COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID;
	createdAt: string;
	status: "preregistered-before-provider-or-evaluator-dispatch";
	question: string;
	hypothesis: string;
	claimClass: "directional-single-randomized-order-pair";
	causalClaimAllowed: false;
	replicationClaimAllowed: false;
	gpuPromotionAllowed: false;
	randomization: {
		method: "cryptographic-byte-parity-v1";
		drawHex: string;
		armOrder: readonly [CompilerGymIrDeltaScreenArm, CompilerGymIrDeltaScreenArm];
	};
	arms: readonly [
		{
			id: "hidden-control";
			runId: "compiler-gym-ir-delta-paid-screen-pair-v2:hidden-control";
			modelFeedback: "authoritative-terminal-evaluation-envelope-with-host-trace-hidden";
		},
		{
			id: "visible-ir-delta-treatment";
			runId: "compiler-gym-ir-delta-paid-screen-pair-v2:visible-ir-delta-treatment";
			modelFeedback: "byte-identical-control-envelope-plus-one-top-level-irDeltaTrace-field";
		},
	];
	apparatusLineage: typeof COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE;
	frozenCommon: {
		primeAgentCommit: string;
		model: "openai-codex/gpt-5.6-luna";
		thinkingLevel: "xhigh";
		requestedServiceTier: "priority";
		providerSessionId: string;
		providerVisibleWorkspace: typeof COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE;
		providerVisibleConversationLog: typeof COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG;
		providerVisibleSystemPromptPolicy: "default-prime-template-with-preregistered-arm-neutral-path-normalization-v1";
		firstProviderRequestBodyParityRequired: true;
		resolvedModelPolicy: typeof COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY;
		promptSha256: string;
		calibrationSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_SHA256;
		calibrationArtifact: {
			path: ".autoresearch/cpu-calibration/2026-08-28-v2-stock/result.json";
			sha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_ARTIFACT_SHA256;
		};
		verifierEpoch: typeof COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH;
		canonicalEvaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256;
		irDeltaEvaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256;
		evaluatorSourceBundleSha256: string;
		providerRetries: 0;
		compaction: false;
		webAccess: false;
		rlmChildren: false;
		measurementReuse: false;
	};
	authorization: {
		provider: "openai-codex";
		model: "gpt-5.6-luna";
		thinkingLevel: "xhigh";
		serviceTier: "priority";
		exactActualProviderDispatches: 8;
		maximumActualProviderDispatches: 8;
		perArmActualProviderDispatches: 4;
		authorizedOnlyAfterAllPreDispatchIntegrityGatesPass: true;
		compactionOrAuxiliaryModelCallsAuthorized: false;
	};
	budgets: {
		pairCount: 1;
		perArm: {
			providerCalls: 4;
			evaluatorJobs: 4;
			freshTaskEvaluations: 8;
			reusedTaskEvaluations: 0;
		};
		pairTotals: {
			providerCalls: 8;
			evaluatorJobs: 8;
			freshTaskEvaluations: 16;
			reusedTaskEvaluations: 0;
		};
		retries: 0;
		replacements: 0;
	};
	firstToolCall: {
		ordinal: 1;
		request: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST;
		requestSha256: string;
		actionsSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256;
		expectedMetrics: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS;
		verifierRequirement: "exact-20-of-20-pass";
		driftDisposition: "terminal-apparatus-invalid-not-treatment-result";
	};
	projection: {
		controlRawTraceAccessibleToModel: false;
		treatmentDifference: "exactly-one-top-level-irDeltaTrace-field";
		traceEnvelopeProtocol: "compiler-gym-agent-facing-ir-delta-v1";
		acceptedCandidateTraceRequired: true;
		completeSemanticRejectionTrace: null;
		forbiddenMetadata: readonly ["action_had_no_effect", "no_effect_bits", "noEffectBits", "shadow_action_trace"];
	};
	formalEvidence: typeof COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE;
	assessment: {
		primary: {
			metric: "strict-whole-pareto-coverage-v1";
			requirement: "treatment-frontier-strictly-dominates-every-control-frontier-vector";
		};
		secondary: {
			metric: "normalized-minimax-prefix-auc-v1";
			formula: "mean_k=1..4 min_i<=k max(blowfish_i/3898,bzip2_i/28748); rejected candidates carry forward";
			requirement: "treatment-auc-no-higher-than-control-auc-by-exact-rational-comparison";
		};
		promotion: {
			onePairIsDirectionalOnly: true;
			freshReplicationRequired: true;
			causalClaimAllowed: false;
			gpuPromotionAllowed: false;
		};
		terminalTaxonomy: typeof COMPILER_GYM_IR_DELTA_SCREEN_TERMINAL_TAXONOMY;
	};
	implementationClosure: CompilerGymIrDeltaScreenSourceRecord[];
	implementationBundleSha256: string;
	runtimeWorktreeClosure: {
		policy: "complete-prime-runtime-worktree-snapshot-v1";
		roots: typeof PRIME_RUNTIME_WORKTREE_PATHS;
		snapshot: RepositorySnapshot;
		snapshotSha256: string;
	};
}

function armOrder(drawHex: string): readonly [CompilerGymIrDeltaScreenArm, CompilerGymIrDeltaScreenArm] {
	if (!/^[0-9a-f]{32}$/.test(drawHex))
		throw new Error("Screen randomization draw must be 16 lowercase hexadecimal bytes");
	return Number.parseInt(drawHex.slice(0, 2), 16) % 2 === 0
		? ["hidden-control", "visible-ir-delta-treatment"]
		: ["visible-ir-delta-treatment", "hidden-control"];
}

function validateImplementationClosure(
	closure: readonly CompilerGymIrDeltaScreenSourceRecord[],
): CompilerGymIrDeltaScreenSourceRecord[] {
	if (closure.length !== COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS.length) {
		throw new Error("IR-delta screen implementation closure path count drifted");
	}
	const seen = new Set<string>();
	return closure.map((record, index) => {
		const expectedPath = COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS[index];
		if (record.relativePath !== expectedPath) throw new Error(`Implementation closure path ${index} drifted`);
		if (seen.has(record.relativePath)) throw new Error(`Duplicate implementation path: ${record.relativePath}`);
		seen.add(record.relativePath);
		if (!/^[0-9a-f]{64}$/.test(record.sha256)) {
			throw new Error(`Invalid implementation SHA-256: ${record.relativePath}`);
		}
		return { relativePath: record.relativePath, sha256: record.sha256 };
	});
}

function validateRuntimeWorktreeSnapshot(snapshot: RepositorySnapshot): RepositorySnapshot {
	if (snapshot.head !== FROZEN_CAMPAIGN.repositories.primeAgent.commit) {
		throw new Error("IR-delta screen runtime snapshot HEAD differs from the frozen Prime Agent commit");
	}
	if (typeof snapshot.coreWorktreeStatus !== "string") {
		throw new Error("IR-delta screen runtime snapshot status must be a string");
	}
	if (!/^[a-f0-9]{64}$/.test(snapshot.trackedDiffSha256)) {
		throw new Error("IR-delta screen runtime tracked-diff digest is invalid");
	}
	if (!/^[a-f0-9]{64}$/.test(snapshot.coreWorktreeDigest)) {
		throw new Error("IR-delta screen runtime worktree digest is invalid");
	}
	const treePaths = Object.keys(snapshot.coreTreeHashes);
	assert.deepEqual(treePaths, [...PRIME_RUNTIME_WORKTREE_PATHS], "IR-delta screen runtime tree roots drifted");
	for (const [path, hash] of Object.entries(snapshot.coreTreeHashes)) {
		if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error(`Invalid runtime tree hash: ${path}`);
	}
	const untrackedPaths = Object.keys(snapshot.untrackedFileHashes);
	assert.deepEqual(untrackedPaths, [...untrackedPaths].sort(), "Runtime untracked paths must be sorted");
	for (const [path, hash] of Object.entries(snapshot.untrackedFileHashes)) {
		if (!PRIME_RUNTIME_WORKTREE_PATHS.some((root) => path === root || path.startsWith(`${root}/`))) {
			throw new Error(`Runtime untracked path escaped the frozen roots: ${path}`);
		}
		if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid runtime untracked-file hash: ${path}`);
	}
	const expectedDigest = sha256Json({
		coreWorktreeStatus: snapshot.coreWorktreeStatus,
		trackedDiffSha256: snapshot.trackedDiffSha256,
		untrackedFileHashes: snapshot.untrackedFileHashes,
	});
	if (snapshot.coreWorktreeDigest !== expectedDigest) {
		throw new Error("IR-delta screen runtime worktree digest does not bind its sanitized evidence");
	}
	return structuredClone(snapshot);
}

export function buildCompilerGymIrDeltaScreenPreregistration(input: {
	createdAt: string;
	drawHex: string;
	implementationClosure: readonly CompilerGymIrDeltaScreenSourceRecord[];
	runtimeWorktreeSnapshot: RepositorySnapshot;
}): CompilerGymIrDeltaScreenPreregistration {
	if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("Screen preregistration createdAt is invalid");
	const implementationClosure = validateImplementationClosure(input.implementationClosure);
	const runtimeWorktreeSnapshot = validateRuntimeWorktreeSnapshot(input.runtimeWorktreeSnapshot);
	const runtimeWorktreeSnapshotSha256 = sha256Json(runtimeWorktreeSnapshot);
	const promptSha256 = sha256Text(buildCompilerGymIrDeltaScreenPrompt());
	const providerSessionId = `pids-${sha256Json({
		pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
		createdAt: input.createdAt,
		randomizationNonce: input.drawHex,
		implementationBundleSha256: sha256Json(implementationClosure),
		runtimeWorktreeSnapshotSha256,
	}).slice(0, 32)}`;
	return {
		schemaVersion: 2,
		protocol: COMPILER_GYM_IR_DELTA_SCREEN_PREREGISTRATION_PROTOCOL,
		screenProtocol: COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL,
		pairId: COMPILER_GYM_IR_DELTA_SCREEN_PAIR_ID,
		createdAt: input.createdAt,
		status: "preregistered-before-provider-or-evaluator-dispatch",
		question:
			"Does exposing a qualified per-action IR-delta trace improve a four-call Luna CompilerGym search relative to an otherwise byte-identical hidden-trace control?",
		hypothesis:
			"Conditional per-action IR deltas help Luna choose a strictly better two-task Pareto frontier and improve normalized minimax prefix AUC within the same four-call search budget.",
		claimClass: "directional-single-randomized-order-pair",
		causalClaimAllowed: false,
		replicationClaimAllowed: false,
		gpuPromotionAllowed: false,
		randomization: {
			method: "cryptographic-byte-parity-v1",
			drawHex: input.drawHex,
			armOrder: armOrder(input.drawHex),
		},
		arms: [
			{
				id: COMPILER_GYM_IR_DELTA_SCREEN_ARMS[0],
				runId: "compiler-gym-ir-delta-paid-screen-pair-v2:hidden-control",
				modelFeedback: "authoritative-terminal-evaluation-envelope-with-host-trace-hidden",
			},
			{
				id: COMPILER_GYM_IR_DELTA_SCREEN_ARMS[1],
				runId: "compiler-gym-ir-delta-paid-screen-pair-v2:visible-ir-delta-treatment",
				modelFeedback: "byte-identical-control-envelope-plus-one-top-level-irDeltaTrace-field",
			},
		],
		apparatusLineage: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE),
		frozenCommon: {
			primeAgentCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
			model: "openai-codex/gpt-5.6-luna",
			thinkingLevel: "xhigh",
			requestedServiceTier: "priority",
			providerSessionId,
			providerVisibleWorkspace: COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
			providerVisibleConversationLog: COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
			providerVisibleSystemPromptPolicy:
				"default-prime-template-with-preregistered-arm-neutral-path-normalization-v1",
			firstProviderRequestBodyParityRequired: true,
			resolvedModelPolicy: COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
			promptSha256,
			calibrationSha256: COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_SHA256,
			calibrationArtifact: {
				path: ".autoresearch/cpu-calibration/2026-08-28-v2-stock/result.json",
				sha256: COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_ARTIFACT_SHA256,
			},
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
			canonicalEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
			irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			evaluatorSourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			providerRetries: 0,
			compaction: false,
			webAccess: false,
			rlmChildren: false,
			measurementReuse: false,
		},
		authorization: {
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			thinkingLevel: "xhigh",
			serviceTier: "priority",
			exactActualProviderDispatches: 8,
			maximumActualProviderDispatches: 8,
			perArmActualProviderDispatches: 4,
			authorizedOnlyAfterAllPreDispatchIntegrityGatesPass: true,
			compactionOrAuxiliaryModelCallsAuthorized: false,
		},
		budgets: {
			pairCount: 1,
			perArm: { providerCalls: 4, evaluatorJobs: 4, freshTaskEvaluations: 8, reusedTaskEvaluations: 0 },
			pairTotals: { providerCalls: 8, evaluatorJobs: 8, freshTaskEvaluations: 16, reusedTaskEvaluations: 0 },
			retries: 0,
			replacements: 0,
		},
		firstToolCall: {
			ordinal: 1,
			request: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			requestSha256: sha256Json(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actionsSha256: COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
			expectedMetrics: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS),
			verifierRequirement: "exact-20-of-20-pass",
			driftDisposition: "terminal-apparatus-invalid-not-treatment-result",
		},
		projection: {
			controlRawTraceAccessibleToModel: false,
			treatmentDifference: "exactly-one-top-level-irDeltaTrace-field",
			traceEnvelopeProtocol: "compiler-gym-agent-facing-ir-delta-v1",
			acceptedCandidateTraceRequired: true,
			completeSemanticRejectionTrace: null,
			forbiddenMetadata: ["action_had_no_effect", "no_effect_bits", "noEffectBits", "shadow_action_trace"],
		},
		formalEvidence: COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE,
		assessment: {
			primary: {
				metric: "strict-whole-pareto-coverage-v1",
				requirement: "treatment-frontier-strictly-dominates-every-control-frontier-vector",
			},
			secondary: {
				metric: "normalized-minimax-prefix-auc-v1",
				formula: "mean_k=1..4 min_i<=k max(blowfish_i/3898,bzip2_i/28748); rejected candidates carry forward",
				requirement: "treatment-auc-no-higher-than-control-auc-by-exact-rational-comparison",
			},
			promotion: {
				onePairIsDirectionalOnly: true,
				freshReplicationRequired: true,
				causalClaimAllowed: false,
				gpuPromotionAllowed: false,
			},
			terminalTaxonomy: COMPILER_GYM_IR_DELTA_SCREEN_TERMINAL_TAXONOMY,
		},
		implementationClosure,
		implementationBundleSha256: sha256Json(implementationClosure),
		runtimeWorktreeClosure: {
			policy: "complete-prime-runtime-worktree-snapshot-v1",
			roots: [...PRIME_RUNTIME_WORKTREE_PATHS],
			snapshot: runtimeWorktreeSnapshot,
			snapshotSha256: runtimeWorktreeSnapshotSha256,
		},
	};
}

export function parseCompilerGymIrDeltaScreenPreregistration(
	value: unknown,
	expectedImplementationClosure: readonly CompilerGymIrDeltaScreenSourceRecord[],
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot,
): CompilerGymIrDeltaScreenPreregistration {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("IR-delta screen preregistration must be an object");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.createdAt !== "string") throw new Error("IR-delta screen preregistration lacks createdAt");
	if (
		typeof record.randomization !== "object" ||
		record.randomization === null ||
		Array.isArray(record.randomization)
	) {
		throw new Error("IR-delta screen preregistration lacks randomization");
	}
	const drawHex = (record.randomization as Record<string, unknown>).drawHex;
	if (typeof drawHex !== "string") throw new Error("IR-delta screen preregistration lacks randomization draw");
	const expected = buildCompilerGymIrDeltaScreenPreregistration({
		createdAt: record.createdAt,
		drawHex,
		implementationClosure: expectedImplementationClosure,
		runtimeWorktreeSnapshot: expectedRuntimeWorktreeSnapshot,
	});
	assert.deepEqual(value, expected, "IR-delta screen preregistration does not match the frozen protocol");
	return expected;
}

export async function collectCompilerGymIrDeltaScreenImplementationClosure(
	repoRoot: string,
): Promise<CompilerGymIrDeltaScreenSourceRecord[]> {
	return Promise.all(
		COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
			relativePath,
			sha256: sha256Text(await readFile(resolve(repoRoot, relativePath), "utf8")),
		})),
	);
}

export interface CompilerGymIrDeltaScreenPrerequisiteIntegrity {
	formalPreregistrationSha256: string;
	formalResultSha256: string;
	formalLedgerSha256: string;
	formalAssessmentEventSha256: string;
	formalTerminalEventSha256: string;
	calibrationSha256: string;
	allFilesMode0600: true;
	paidScreenEligible: true;
	lunaAuthorizationStillRequiresThisPaidPreregistration: true;
	apparatusLineage: CompilerGymIrDeltaScreenApparatusLineageIntegrity;
}

export interface CompilerGymIrDeltaScreenApparatusLineageIntegrity {
	apparatusEpoch: 2;
	predecessorPreregistrationSha256: string;
	predecessorResultSha256: string;
	predecessorLedgerSha256: string;
	predecessorTerminalEventSha256: string;
	predecessorTerminalDisposition: "terminal-apparatus-invalid-not-treatment-result";
	predecessorScientificResultAdmitted: false;
	freshApparatusEpochNotRetryOrReplacement: true;
}

async function readPrivateAnchoredFile(
	repoRoot: string,
	relativePath: string,
	expectedSha256: string,
): Promise<string> {
	const absolutePath = resolve(repoRoot, relativePath);
	const metadata = await stat(absolutePath);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error(`Prerequisite evidence must be a regular mode-0600 file: ${relativePath}`);
	}
	const contents = await readFile(absolutePath, "utf8");
	if (sha256Text(contents) !== expectedSha256) {
		throw new Error(`Prerequisite evidence SHA-256 drifted: ${relativePath}`);
	}
	return contents;
}

function evidenceRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

export async function verifyCompilerGymIrDeltaScreenApparatusLineage(
	repoRoot: string,
): Promise<CompilerGymIrDeltaScreenApparatusLineageIntegrity> {
	const lineage = COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE;
	const [preregistrationContents, resultContents, ledgerContents] = await Promise.all([
		readPrivateAnchoredFile(
			repoRoot,
			lineage.predecessor.preregistration.path,
			lineage.predecessor.preregistration.sha256,
		),
		readPrivateAnchoredFile(repoRoot, lineage.predecessor.result.path, lineage.predecessor.result.sha256),
		readPrivateAnchoredFile(repoRoot, lineage.predecessor.ledger.path, lineage.predecessor.ledger.sha256),
	]);
	const preregistration = evidenceRecord(
		JSON.parse(preregistrationContents) as unknown,
		"Predecessor paid-screen preregistration",
	);
	if (
		preregistration.schemaVersion !== 1 ||
		preregistration.protocol !== "compiler-gym-ir-delta-paid-screen-preregistration-v1" ||
		preregistration.screenProtocol !== COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL ||
		preregistration.pairId !== lineage.predecessor.pairId ||
		preregistration.status !== "preregistered-before-provider-or-evaluator-dispatch"
	) {
		throw new Error("Predecessor paid-screen preregistration identity drifted");
	}

	verifyLedgerContentsStrict(ledgerContents);
	const ledgerEvents = ledgerContents
		.trim()
		.split("\n")
		.map((line) => evidenceRecord(JSON.parse(line) as unknown, "Predecessor paid-screen ledger event"));
	const terminalEvent = ledgerEvents.at(-1);
	if (
		!terminalEvent ||
		terminalEvent.hash !== lineage.predecessor.terminalEventSha256 ||
		terminalEvent.kind !== "run_manifest"
	) {
		throw new Error("Predecessor paid-screen terminal event is not the strict-ledger terminus");
	}
	const terminalPayload = evidenceRecord(terminalEvent.payload, "Predecessor paid-screen terminal event payload");
	if (
		terminalPayload.type !== "compiler_gym_ir_delta_paid_screen_pair" ||
		terminalPayload.phase !== "terminal" ||
		terminalPayload.disposition !== lineage.predecessor.terminalDisposition ||
		terminalPayload.assessment !== lineage.predecessor.assessment ||
		terminalPayload.actualProviderDispatches !== lineage.predecessor.actualProviderDispatches ||
		terminalPayload.actualEvaluatorJobs !== lineage.predecessor.actualEvaluatorJobs ||
		terminalPayload.actualFreshTaskEvaluations !== lineage.predecessor.actualFreshTaskEvaluations
	) {
		throw new Error("Predecessor paid-screen terminal ledger semantics drifted");
	}

	const result = evidenceRecord(JSON.parse(resultContents) as unknown, "Predecessor paid-screen result");
	const arms = result.arms;
	if (!Array.isArray(arms) || arms.length !== 1) {
		throw new Error("Predecessor paid-screen result does not contain its single incomplete arm");
	}
	const arm = evidenceRecord(arms[0], "Predecessor paid-screen arm");
	const apparatusFailures = arm.apparatusFailures;
	if (
		result.screenProtocol !== COMPILER_GYM_IR_DELTA_SCREEN_PROTOCOL ||
		result.pairId !== lineage.predecessor.pairId ||
		result.preregistrationSha256 !== lineage.predecessor.preregistration.sha256 ||
		result.pairLedgerSha256 !== lineage.predecessor.ledger.sha256 ||
		result.terminalPairLedgerEventHash !== lineage.predecessor.terminalEventSha256 ||
		result.disposition !== lineage.predecessor.terminalDisposition ||
		result.assessment !== lineage.predecessor.assessment ||
		result.actualProviderDispatches !== lineage.predecessor.actualProviderDispatches ||
		result.actualEvaluatorJobs !== lineage.predecessor.actualEvaluatorJobs ||
		result.actualFreshTaskEvaluations !== lineage.predecessor.actualFreshTaskEvaluations ||
		result.causalClaimAllowed !== false ||
		result.replicationClaimAllowed !== false ||
		result.gpuPromotionAllowed !== false ||
		arm.arm !== "visible-ir-delta-treatment" ||
		arm.admitted !== false ||
		arm.disposition !== lineage.predecessor.terminalDisposition ||
		!Array.isArray(arm.candidates) ||
		arm.candidates.length !== 0 ||
		!Array.isArray(apparatusFailures) ||
		!apparatusFailures.some(
			(failure) =>
				typeof failure === "string" && failure.includes("aggregate stdout.tasks[0].stdout is not canonical JSON"),
		)
	) {
		throw new Error("Predecessor paid-screen result does not prove terminal apparatus non-admission");
	}

	return {
		apparatusEpoch: lineage.apparatusEpoch,
		predecessorPreregistrationSha256: lineage.predecessor.preregistration.sha256,
		predecessorResultSha256: lineage.predecessor.result.sha256,
		predecessorLedgerSha256: lineage.predecessor.ledger.sha256,
		predecessorTerminalEventSha256: lineage.predecessor.terminalEventSha256,
		predecessorTerminalDisposition: lineage.predecessor.terminalDisposition,
		predecessorScientificResultAdmitted: lineage.predecessor.scientificResultAdmitted,
		freshApparatusEpochNotRetryOrReplacement: true,
	};
}

export async function verifyCompilerGymIrDeltaScreenPrerequisites(
	repoRoot: string,
): Promise<CompilerGymIrDeltaScreenPrerequisiteIntegrity> {
	const [formalPreregistration, formalResult, formalLedger, calibration, apparatusLineage] = await Promise.all([
		readPrivateAnchoredFile(
			repoRoot,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.preregistration.path,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.preregistration.sha256,
		),
		readPrivateAnchoredFile(
			repoRoot,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.result.path,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.result.sha256,
		),
		readPrivateAnchoredFile(
			repoRoot,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.ledger.path,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.ledger.sha256,
		),
		readPrivateAnchoredFile(
			repoRoot,
			".autoresearch/cpu-calibration/2026-08-28-v2-stock/result.json",
			COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_ARTIFACT_SHA256,
		),
		verifyCompilerGymIrDeltaScreenApparatusLineage(repoRoot),
	]);
	verifyLedgerContentsStrict(formalLedger);
	const ledgerEvents = formalLedger
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as { hash?: unknown; payload?: unknown });
	const assessmentEvent = ledgerEvents.at(-2);
	const terminalEvent = ledgerEvents.at(-1);
	if (
		assessmentEvent?.hash !== COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.assessmentEventSha256 ||
		terminalEvent?.hash !== COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.terminalEventSha256
	) {
		throw new Error("Formal qualification assessment/terminal ledger tail drifted");
	}
	const resultValue = JSON.parse(formalResult) as unknown;
	if (typeof resultValue !== "object" || resultValue === null || Array.isArray(resultValue)) {
		throw new Error("Formal qualification result is not an object");
	}
	const result = resultValue as Record<string, unknown>;
	if (
		result.preregistrationSha256 !== COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.preregistration.sha256 ||
		result.terminalDisposition !== COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.terminalDisposition ||
		result.lunaAuthorized !== false ||
		result.measurementReuse !== false ||
		result.modelCalls !== 0
	) {
		throw new Error("Formal qualification result no longer authorizes only a separate paid screen");
	}
	const assessmentValue = result.assessment;
	if (typeof assessmentValue !== "object" || assessmentValue === null || Array.isArray(assessmentValue)) {
		throw new Error("Formal qualification result lacks its assessment");
	}
	const assessment = assessmentValue as Record<string, unknown>;
	if (
		assessment.decision !== COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.decision ||
		assessment.nextGate !== COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.nextGate ||
		assessment.paidScreenEligible !== true ||
		assessment.lunaAuthorized !== false
	) {
		throw new Error("Formal qualification assessment no longer passes the paid-screen gate");
	}
	void JSON.parse(formalPreregistration);
	void JSON.parse(calibration);
	return {
		formalPreregistrationSha256: COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.preregistration.sha256,
		formalResultSha256: COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.result.sha256,
		formalLedgerSha256: COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.ledger.sha256,
		formalAssessmentEventSha256: COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.assessmentEventSha256,
		formalTerminalEventSha256: COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.terminalEventSha256,
		calibrationSha256: COMPILER_GYM_IR_DELTA_SCREEN_CALIBRATION_ARTIFACT_SHA256,
		allFilesMode0600: true,
		paidScreenEligible: true,
		lunaAuthorizationStillRequiresThisPaidPreregistration: true,
		apparatusLineage,
	};
}

export async function writeCompilerGymIrDeltaScreenPreregistration(
	outputPath: string,
	preregistration: CompilerGymIrDeltaScreenPreregistration,
): Promise<void> {
	const output = resolve(outputPath);
	await mkdir(dirname(output), { recursive: true, mode: 0o700 });
	const handle = await open(output, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(`${canonicalJson(toJsonValue(preregistration))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function parseOptions(argv: readonly string[]): { outputPath: string } {
	if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]) {
		throw new Error("Usage: compiler-gym-ir-delta-screen-preregistration --output <path>");
	}
	return { outputPath: argv[1] };
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	await verifyCompilerGymIrDeltaScreenPrerequisites(repoRoot);
	const implementationClosure = await collectCompilerGymIrDeltaScreenImplementationClosure(repoRoot);
	const runtimeWorktreeSnapshot = capturePrimeRuntimeWorktreeSnapshot(repoRoot);
	const preregistration = buildCompilerGymIrDeltaScreenPreregistration({
		createdAt: new Date().toISOString(),
		drawHex: randomBytes(16).toString("hex"),
		implementationClosure,
		runtimeWorktreeSnapshot,
	});
	await writeCompilerGymIrDeltaScreenPreregistration(options.outputPath, preregistration);
	process.stdout.write(`${canonicalJson(toJsonValue(preregistration))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	void main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

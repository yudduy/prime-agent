import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	type CompilerGymProxyCascadeCandidateArtifactInput,
	type CompilerGymProxyCascadeCandidateSource,
	type CompilerGymProxyCascadePreregistration,
	expectedCompilerGymProxyCascadeSelectedMetricAnchors,
} from "./compiler-gym-proxy-cascade-preregistration.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "./compiler-gym-proxy-cascade-protocol.js";
import {
	buildCompilerGymProxyCascadeResourceBlockPlan,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_GATE_EVIDENCE_CONTRACT,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS,
	type CompilerGymProxyCascadeResourceBlockPlan,
} from "./compiler-gym-proxy-cascade-resource-protocol.js";
import { verifyLedgerContentsStrict } from "./ledger.js";

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPERIMENT_ID =
	"compiler-gym-blowfish-proxy-cascade-resource-screen-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_PREREGISTRATION_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-resource-preregistration-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-resource-runner-v1" as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS = {
	preregistration: {
		path: ".autoresearch/compiler-gym-proxy-cascade-qualification/2026-08-29-v1/preregistration.json",
		sha256: "9a76b71cb66724182c8d393469a3dd403e211449460a3f31cb163cb03dd41da3",
	},
	result: {
		path: ".autoresearch/compiler-gym-proxy-cascade-qualification/2026-08-29-v1/execution/result.json",
		sha256: "11ead1ff072cad2dd01ade41ef9ad2b362e14da9aab04573e4a0a543d7fc9edb",
	},
	evidenceLedger: {
		path: ".autoresearch/compiler-gym-proxy-cascade-qualification/2026-08-29-v1/execution/evidence.jsonl",
		sha256: "d27b5e85bf7d221eab88b856e2f310c9575810b531c79e70933b71d91f5e8446",
		eventCount: 26,
		terminalEventHash: "3bf8544b224303980990ee3a58f36aeae860b7b9945c0064c8aa39e512fb11ac",
	},
	scientificIdentitySha256: "55e461a30e2a3f874fffc09fd0cc0b4a7c663c08033953eca633cd4b8041044b",
	candidateBundleSha256: "c3daee36c5a805be436a936cc6fd660161637eb4d4f1c427008a022d59d3576a",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_IMPLEMENTATION_ENTRYPOINTS = [
	"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
	"research/autoresearch/src/compiler-gym-proxy-cascade-resource-preregistration-cli.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-resource-preregistration.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-resource-protocol.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-resource-runner.ts",
	"research/autoresearch/package.json",
	"research/autoresearch/tsconfig.json",
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"tsconfig.base.json",
] as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_QUESTION =
	"Does the prospectively scheduled six-allocation proxy cascade preserve the control oracle while reducing exact evaluator step CPU and feedback-ready wall time under counterbalanced live FarmShare CPU execution?" as const;
export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_HYPOTHESIS =
	"Across an AB/BA pair over the exact wiring-qualified candidates, proxy cascade preserves exact metrics, verifier outcomes, the full control frontier, and champion while using at least 20% less .0 step CPU and at least 10% and 10 seconds less median feedback-ready wall time." as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_CLAIM_LIMITS = {
	modelOrAgentPolicyEvidenceAllowed: false,
	providerOrPaidExposureAllowed: false,
	generalLatencyClaimAllowed: false,
	independentReplicateClaimAllowed: false,
	gpuOrNanoGptTransferAllowed: false,
	defaultPromotionAllowed: false,
	qualificationForOnePaidPilotConsiderationOnly: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT = {
	clock: "host-process-monotonic-clock",
	storedUnit: "safe-integer-microseconds",
	preflightEnvironmentSourceAndLockChecksOutsideTimedInterval: true,
	perArmImmediateGate:
		"same-environment-gate-and-trusted-evaluator-source-readback-immediately-before-every-arm-outside-that-arm-timer",
	prewarm:
		"source-bootstrap-and-non-measurement-environment-preparation-complete-outside-arm-intervals-with-no-candidate-benchmark-evaluation",
	prewarmEvidenceRequired: true,
	armStart: "immediately-before-first-online-allocation-dispatch",
	armEnd: "immediately-after-final-online-allocation-is-terminal-verified-and-admitted",
	included: "queue-scheduler-transport-evaluator-round-barriers-and-host-orchestration-between-arm-start-and-arm-end",
	controlFeedbackReady: "all-eight-control-measurements-terminal-and-admitted",
	cascadeFeedbackReady: "four-proxy-plus-two-selected-bzip2-measurements-terminal-and-admitted",
	controlIsCompleteOracle: true,
	cascadeHasNoOmittedCandidateAudit: true,
	interArmAndInterBlockSealWorkOutsideFollowingArmInterval: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_ISOLATION = {
	modelCalls: 0,
	providerDispatches: 0,
	toolCalls: 0,
	rlmChildren: 0,
	compaction: false,
	webAccess: false,
	gpuAllocations: 0,
	measurementReuse: false,
	retries: 0,
	replacements: 0,
	adaptiveCandidateSubstitution: false,
	allJobsFresh: true,
	allTransientCachesFreshAndUnique: true,
	maximumConcurrentAllocations: 2,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_ACCOUNTING = {
	mode: "required-exact-terminal-sacct",
	exactRowsPerAllocation: ["root", "extern", ".0"],
	rootAllocCpusAccepted: [2, 4],
	stepAllocCpus: 2,
	stepTasks: 1,
	exactRowConsistency:
		"row-identities-bind-slurm-job-and-name; terminal-state-exit-timestamps-node-containment; cpu-time-raw-equals-alloc-cpus-times-elapsed-raw; root-projection-exact",
	inferentialCpuSource: ".0.cpuTimeRawSeconds-reserved-logical-evaluator-step-cpu",
	armStepCpuDefinition: "sum-exact-dot-zero-cpu-time-raw-seconds",
	rootAndExternCpuDescriptiveOnly: true,
	allRowsTerminalBeforeAdmission: true,
} as const;

export interface CompilerGymProxyCascadeResourceBudgets {
	blockCount: number;
	armCount: number;
	controlAllocationsPerArm: number;
	cascadeAllocationsPerArm: number;
	controlFreshAllocationsTotal: number;
	cascadeFreshAllocationsTotal: number;
	totalFreshOnlineAllocations: number;
	maximumConcurrentAllocations: number;
	wallMinutesPerAllocationMaximum: number;
	requestedCpusPerAllocation: number;
	schedulerLogicalCpusPerAllocationMaximum: number;
	allocationWallMinutesMaximum: number;
	requestedTaskCpuMinutesMaximum: number;
	schedulerLogicalCpuMinutesMaximum: number;
	maximumTimedControlArmMinutes: number;
	maximumTimedCascadeArmMinutes: number;
	maximumTimedArmScheduleMinutes: number;
}

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS = {
	blockCount: 2,
	armCount: 4,
	controlAllocationsPerArm: 8,
	cascadeAllocationsPerArm: 6,
	controlFreshAllocationsTotal: 16,
	cascadeFreshAllocationsTotal: 12,
	totalFreshOnlineAllocations: 28,
	maximumConcurrentAllocations: 2,
	wallMinutesPerAllocationMaximum: 5,
	requestedCpusPerAllocation: 2,
	schedulerLogicalCpusPerAllocationMaximum: 4,
	allocationWallMinutesMaximum: 140,
	requestedTaskCpuMinutesMaximum: 280,
	schedulerLogicalCpuMinutesMaximum: 560,
	maximumTimedControlArmMinutes: 20,
	maximumTimedCascadeArmMinutes: 25,
	maximumTimedArmScheduleMinutes: 90,
} as const satisfies CompilerGymProxyCascadeResourceBudgets;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_SEAL_SCHEMA = {
	write: "exclusive-create-mode-0600-write-fsync-close-readback-exact",
	cascadeSelectionSealCount: 2,
	armSealCount: 4,
	blockSealCount: 2,
	cascadeSelectionSealAfterFourFreshBlowfishBeforeBzip2: true,
	armSealRequiredBeforeNextArmOrBlock: true,
	blockSealRequiredBeforeNextBlockOrTerminalDecision: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_LOCK_SCHEMA = {
	localAttempt: {
		createOnlyBeforeAnySsh: true,
		mode: "0600",
		crossWorktree: true,
		neverRemovedByRunner: true,
	},
	remote: {
		kinds: [
			"global",
			"block-one-control",
			"block-one-cascade-selection",
			"block-one-cascade",
			"block-one",
			"block-two-cascade-selection",
			"block-two-cascade",
			"block-two-control",
			"block-two",
			"terminal",
		],
		createOnly: true,
		mode: "0600",
		writeFsyncCloseReadbackExact: true,
		neverRemovedByRunner: true,
	},
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_STOP_POLICY = {
	beforeSsh: "any-local-preregistration-source-wiring-or-attempt-lock-drift-stops-before-ssh",
	afterSshBeforeArm:
		"any-remote-environment-trusted-source-or-required-lock-drift-stops-before-that-arms-allocation-dispatch",
	duringArm: "any-allocation-verifier-metric-accounting-or-source-drift-is-terminal-apparatus-invalid",
	betweenArmsOrBlocks: "any-order-seal-lock-environment-or-source-drift-is-terminal-apparatus-invalid",
	gateFailure: "valid-negative-kills-resource-treatment-before-paid-exposure",
	apparatusDriftConsumesScientificIdentity: true,
	allFailuresConsumeAttempt: true,
	noRetryReuseReplacementOrCandidateSubstitution: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_RESOURCE_DECISION_POLICY = {
	controlOracle: "fresh-eight-allocation-complete-four-candidate-two-task-frontier",
	cascadeEvidence: "fresh-four-sequential-blowfish-plus-two-concurrent-selected-bzip2-no-audit",
	frontierDefinition: "raw-two-task-ir-weakly-no-worse-and-strictly-better-on-at-least-one",
	metricAndVerifierGate: "every-online-measurement-must-exactly-match-its-frozen-anchor-and-pass-verifier",
	stepCpuGate: "each-block-and-two-block-median-cascade-control-ratio-at-most-0.80",
	feedbackWallGate:
		"two-block-median-ratio-at-most-0.90-and-median-saving-at-least-10000ms-with-each-block-ratio-at-most-1.05",
	positiveDisposition: "model-free-resource-screen-qualified-for-one-paid-pilot-consideration-only",
	negativeDisposition: "resource-screen-valid-negative-no-paid-treatment",
	apparatusDisposition: "resource-screen-apparatus-invalid-no-scientific-inference",
} as const;

export interface CompilerGymProxyCascadeResourceSourceRecord {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymProxyCascadeResourceArmSeal {
	blockOrdinal: 1 | 2;
	arm: "full-control" | "proxy-cascade";
	path: string;
	requiredAllocationCount: 6 | 8;
}

export interface CompilerGymProxyCascadeResourcePreregistration {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_PREREGISTRATION_PROTOCOL;
	experimentId: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPERIMENT_ID;
	screenProtocol: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_PROTOCOL;
	runnerProtocol: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL;
	createdAt: string;
	status: "preregistered-before-any-resource-screen-ssh-or-evaluator-dispatch";
	question: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_QUESTION;
	hypothesis: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_HYPOTHESIS;
	classification: "zero-model-counterbalanced-resource-screen-only";
	claimLimits: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_CLAIM_LIMITS;
	upstreamWiringQualification: {
		artifacts: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS;
		scientificIdentitySha256: string;
		preregistrationSha256: string;
		candidateBundleSha256: string;
		frontierOrdinals: number[];
		championOrdinal: number;
		resultDisposition: "happy-path-wiring-qualified-only";
		liveScientificEvidenceEligible: true;
		semanticJoinPassed: true;
	};
	candidateSources: CompilerGymProxyCascadeCandidateSource[];
	candidateBundleSha256: string;
	frozenCommon: CompilerGymProxyCascadePreregistration["frozenCommon"];
	blockPlan: CompilerGymProxyCascadeResourceBlockPlan;
	timingContract: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT;
	resourceThresholds: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS;
	gateEvidenceContract: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_GATE_EVIDENCE_CONTRACT;
	isolation: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_ISOLATION;
	accounting: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_ACCOUNTING;
	budgets: CompilerGymProxyCascadeResourceBudgets;
	seals: {
		schema: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_SEAL_SCHEMA;
		cascadeSelection: Array<{ blockOrdinal: 1 | 2; path: string }>;
		arm: CompilerGymProxyCascadeResourceArmSeal[];
		block: Array<{ blockOrdinal: 1 | 2; path: string }>;
	};
	localAttemptLock: {
		path: string;
		createOnlyBeforeAnySsh: true;
		mode: "0600";
		crossWorktree: true;
		neverRemovedByRunner: true;
	};
	remoteLocks: {
		scientificIdentitySha256: string;
		parentRoot: string;
		root: string;
		globalPath: string;
		blockOneControlPath: string;
		blockOneCascadeSelectionPath: string;
		blockOneCascadePath: string;
		blockOnePath: string;
		blockTwoCascadePath: string;
		blockTwoCascadeSelectionPath: string;
		blockTwoControlPath: string;
		blockTwoPath: string;
		terminalPath: string;
		kinds: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_LOCK_SCHEMA.remote.kinds;
		createOnly: true;
		mode: "0600";
		writeFsyncCloseReadbackExact: true;
		neverRemovedByRunner: true;
	};
	stopPolicy: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_STOP_POLICY;
	decisionPolicy: typeof COMPILER_GYM_PROXY_CASCADE_RESOURCE_DECISION_POLICY;
	launchPaths: { repoRoot: string; preregistrationPath: string; outputDir: string };
	implementationClosure: CompilerGymProxyCascadeResourceSourceRecord[];
	implementationBundleSha256: string;
	scientificIdentitySha256: string;
}

export interface CompilerGymProxyCascadeResourcePreregistrationBuildInput {
	createdAt: string;
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	wiringPreregistrationContents: string;
	wiringResultContents: string;
	wiringEvidenceContents: string;
	candidateArtifacts: readonly CompilerGymProxyCascadeCandidateArtifactInput[];
	implementationClosure: readonly CompilerGymProxyCascadeResourceSourceRecord[];
}

const SHA256 = /^[0-9a-f]{64}$/;

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || !value) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function exactJson(actual: unknown, expected: unknown, path: string): void {
	if (canonicalJson(toJsonValue(actual)) !== canonicalJson(toJsonValue(expected))) {
		throw new Error(`${path} differs from its frozen value`);
	}
}

function parseJson(contents: string, path: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch (error) {
		throw new Error(`${path} is not JSON`, { cause: error });
	}
	return record(value, path);
}

function validateFrozenContents(contents: string, artifact: { path: string; sha256: string }): void {
	if (sha256Text(contents) !== artifact.sha256) throw new Error(`${artifact.path} SHA-256 drifted`);
}

function validateCandidateSources(value: unknown): CompilerGymProxyCascadeCandidateSource[] {
	const candidates = structuredClone(
		array(value, "wiring candidateSources"),
	) as CompilerGymProxyCascadeCandidateSource[];
	if (candidates.length !== 4) throw new Error("Wiring qualification must bind exactly four candidates");
	const anchors = expectedCompilerGymProxyCascadeSelectedMetricAnchors();
	for (let index = 0; index < candidates.length; index++) {
		const candidate = candidates[index]!;
		const anchor = anchors[index]!;
		if (
			candidate.ordinal !== index + 1 ||
			candidate.artifactSha256 !== sha256Text(candidate.canonicalBytesUtf8) ||
			candidate.artifactByteLength !== Buffer.byteLength(candidate.canonicalBytesUtf8) ||
			candidate.artifactFileType !== "regular" ||
			candidate.artifactMode !== "0600" ||
			candidate.artifactSymbolicLink !== false
		) {
			throw new Error(`Wiring candidate ${index + 1} source identity drifted`);
		}
		exactJson(
			{
				ordinal: candidate.ordinal,
				blowfishIr: candidate.expectedMetrics.blowfish.irInstructionCount,
				blowfishObjectTextSizeBytes: candidate.expectedMetrics.blowfish.objectTextSizeBytes,
				bzip2Ir: candidate.expectedMetrics.bzip2.irInstructionCount,
				bzip2ObjectTextSizeBytes: candidate.expectedMetrics.bzip2.objectTextSizeBytes,
			},
			anchor,
			`wiring candidate ${index + 1} metric anchors`,
		);
		const parsed: unknown = JSON.parse(candidate.canonicalBytesUtf8);
		exactJson(parsed, candidate.actions, `wiring candidate ${index + 1} action bytes`);
	}
	if (new Set(candidates.map((candidate) => candidate.artifactSha256)).size !== 4) {
		throw new Error("Wiring candidates must have four unique source digests");
	}
	if (sha256Json(candidates) !== COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.candidateBundleSha256) {
		throw new Error("Wiring candidate bundle SHA-256 drifted");
	}
	return candidates;
}

function validateCandidateArtifacts(
	candidates: readonly CompilerGymProxyCascadeCandidateSource[],
	artifacts: readonly CompilerGymProxyCascadeCandidateArtifactInput[],
): void {
	if (artifacts.length !== 4) throw new Error("Resource screen requires four current candidate artifacts");
	const byOrdinal = new Map(artifacts.map((artifact) => [artifact.ordinal, artifact]));
	if (byOrdinal.size !== 4) throw new Error("Resource screen candidate artifact ordinals repeat");
	for (const candidate of candidates) {
		const artifact = byOrdinal.get(candidate.ordinal);
		if (
			!artifact ||
			artifact.relativePath !== candidate.artifactPath ||
			artifact.contents !== candidate.canonicalBytesUtf8 ||
			!artifact.isFile ||
			artifact.isSymbolicLink ||
			(artifact.mode & 0o777) !== 0o600
		) {
			throw new Error(`Resource screen current candidate artifact ${candidate.ordinal} drifted`);
		}
	}
}

function validateWiringSemanticJoin(input: {
	preregistrationContents: string;
	resultContents: string;
	evidenceContents: string;
	candidateArtifacts: readonly CompilerGymProxyCascadeCandidateArtifactInput[];
}): {
	candidates: CompilerGymProxyCascadeCandidateSource[];
	frozenCommon: CompilerGymProxyCascadePreregistration["frozenCommon"];
} {
	const artifacts = COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS;
	validateFrozenContents(input.preregistrationContents, artifacts.preregistration);
	validateFrozenContents(input.resultContents, artifacts.result);
	validateFrozenContents(input.evidenceContents, artifacts.evidenceLedger);
	const preregistration = parseJson(input.preregistrationContents, artifacts.preregistration.path);
	const result = parseJson(input.resultContents, artifacts.result.path);
	for (const [path, actual, expected] of [
		[
			"wiring preregistration protocol",
			preregistration.protocol,
			"compiler-gym-blowfish-proxy-cascade-preregistration-v1",
		],
		[
			"wiring preregistration classification",
			preregistration.classification,
			"model-free-happy-path-wiring-qualification-only",
		],
		["wiring scientific identity", preregistration.scientificIdentitySha256, artifacts.scientificIdentitySha256],
		["wiring result protocol", result.protocol, "compiler-gym-blowfish-proxy-cascade-run-result-v1"],
		["wiring result runner protocol", result.runnerProtocol, "compiler-gym-blowfish-proxy-cascade-runner-v1"],
		["wiring result runtime mode", result.runtimeMode, "production-defaults-no-dependency-injection"],
		["wiring result scientific identity", result.scientificIdentitySha256, artifacts.scientificIdentitySha256],
		["wiring result preregistration", result.preregistrationSha256, artifacts.preregistration.sha256],
		["wiring result disposition", result.disposition, "happy-path-wiring-qualified-only"],
	] as const) {
		if (actual !== expected) throw new Error(`${path} drifted`);
	}
	if (
		result.ok !== true ||
		result.liveScientificEvidenceEligible !== true ||
		result.selectedFrontierRetained !== true ||
		result.selectedChampionRetained !== true ||
		array(result.failedAllocations, "wiring result failedAllocations").length !== 0
	) {
		throw new Error("Wiring qualification is not an eligible successful result");
	}
	exactJson(
		result.frontierOrdinals,
		COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS,
		"wiring result frontier",
	);
	if (result.championOrdinal !== COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL) {
		throw new Error("Wiring result champion drifted");
	}
	const events = verifyLedgerContentsStrict(input.evidenceContents);
	if (
		events.length !== artifacts.evidenceLedger.eventCount ||
		events.at(-1)?.hash !== artifacts.evidenceLedger.terminalEventHash ||
		result.ledgerSha256 !== artifacts.evidenceLedger.sha256 ||
		result.ledgerTerminalHash !== artifacts.evidenceLedger.terminalEventHash
	) {
		throw new Error("Wiring result and strict evidence ledger are not joined");
	}
	const candidates = validateCandidateSources(preregistration.candidateSources);
	if (preregistration.candidateBundleSha256 !== artifacts.candidateBundleSha256) {
		throw new Error("Wiring preregistration candidate bundle reference drifted");
	}
	validateCandidateArtifacts(candidates, input.candidateArtifacts);
	const freshCandidates = array(result.freshCandidates, "wiring result freshCandidates");
	if (freshCandidates.length !== 4) throw new Error("Wiring result must contain four fresh candidates");
	for (const candidate of candidates) {
		const fresh = record(freshCandidates[candidate.ordinal - 1], `wiring fresh candidate ${candidate.ordinal}`);
		exactJson(
			{
				ordinal: fresh.ordinal,
				candidateSha256: fresh.candidateSha256,
				blowfish: {
					irInstructionCount: record(fresh.blowfish, "wiring fresh blowfish").irInstructionCount,
					objectTextSizeBytes: record(fresh.blowfish, "wiring fresh blowfish").objectTextSizeBytes,
				},
				bzip2: {
					irInstructionCount: record(fresh.bzip2, "wiring fresh bzip2").irInstructionCount,
					objectTextSizeBytes: record(fresh.bzip2, "wiring fresh bzip2").objectTextSizeBytes,
				},
			},
			{
				ordinal: candidate.ordinal,
				candidateSha256: candidate.artifactSha256,
				blowfish: candidate.expectedMetrics.blowfish,
				bzip2: candidate.expectedMetrics.bzip2,
			},
			`wiring fresh candidate ${candidate.ordinal}`,
		);
	}
	const allocations = array(result.allocations, "wiring result allocations");
	if (allocations.length !== 8) throw new Error("Wiring result must contain eight fresh allocations");
	const allocationKeys = new Set<string>();
	const slurmIds = new Set<string>();
	const transientCaches = new Set<string>();
	const jobNames = new Set<string>();
	for (const value of allocations) {
		const row = record(value, "wiring allocation");
		const allocation = record(row.allocation, "wiring allocation spec");
		const outcome = record(row.outcome, "wiring allocation outcome");
		const tasks = array(outcome.tasks, "wiring allocation tasks");
		if (tasks.length !== 1) throw new Error("Wiring allocation must contain exactly one task");
		const task = record(tasks[0], "wiring allocation task");
		const verifier = record(task.verifier, "wiring allocation verifier");
		if (task.status !== "accepted" || verifier.passed !== true) {
			throw new Error("Wiring allocation did not pass its one-task verifier");
		}
		const candidateOrdinal = allocation.candidateOrdinal;
		if (typeof candidateOrdinal !== "number" || !Number.isSafeInteger(candidateOrdinal)) {
			throw new Error("Wiring allocation candidate ordinal is invalid");
		}
		const benchmarkId = string(allocation.benchmarkId, "wiring allocation benchmarkId");
		const candidate = candidates[candidateOrdinal - 1];
		if (!candidate) throw new Error("Wiring allocation candidate ordinal is outside the source set");
		const expectedMetrics =
			benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH
				? candidate.expectedMetrics.blowfish
				: benchmarkId === COMPILER_GYM_PROXY_CASCADE_BZIP2
					? candidate.expectedMetrics.bzip2
					: null;
		if (!expectedMetrics) throw new Error("Wiring allocation benchmark is outside the frozen task pair");
		const metrics = record(task.metrics, "wiring allocation metrics");
		exactJson(
			{
				irInstructionCount: metrics.IrInstructionCount,
				objectTextSizeBytes: metrics.ObjectTextSizeBytes,
			},
			expectedMetrics,
			`wiring allocation ${candidateOrdinal}:${benchmarkId} metrics`,
		);
		const aggregate = record(row.aggregate, "wiring allocation aggregate");
		if (aggregate.measurementReuse !== false || aggregate.candidateSha256 !== candidate.artifactSha256) {
			throw new Error("Wiring allocation aggregate is not a fresh source-bound measurement");
		}
		const aggregateTasks = array(aggregate.tasks, "wiring allocation aggregate tasks");
		if (aggregateTasks.length !== 1) throw new Error("Wiring aggregate must contain exactly one task");
		const aggregateTask = record(aggregateTasks[0], "wiring allocation aggregate task");
		const accountingRows = record(aggregateTask.accountingRows, "wiring allocation accounting rows");
		for (const accountingRowName of ["root", "extern", "step"] as const) {
			const accountingRow = record(accountingRows[accountingRowName], `wiring accounting ${accountingRowName}`);
			if (accountingRow.state !== "COMPLETED" || accountingRow.exitCode !== "0:0") {
				throw new Error(`Wiring accounting ${accountingRowName} is not terminal-success`);
			}
		}
		const stepAccounting = record(accountingRows.step, "wiring accounting step");
		if (stepAccounting.allocCpus !== 2 || stepAccounting.nTasks !== 1) {
			throw new Error("Wiring evaluator-step accounting shape drifted");
		}
		slurmIds.add(string(aggregateTask.slurmId, "wiring allocation Slurm ID"));
		transientCaches.add(string(aggregateTask.transientCache, "wiring allocation transient cache"));
		jobNames.add(string(aggregateTask.jobName, "wiring allocation job name"));
		allocationKeys.add(`${candidateOrdinal}:${benchmarkId}`);
	}
	const expectedAllocationKeys = candidates.flatMap((candidate) => [
		`${candidate.ordinal}:${COMPILER_GYM_PROXY_CASCADE_BLOWFISH}`,
		`${candidate.ordinal}:${COMPILER_GYM_PROXY_CASCADE_BZIP2}`,
	]);
	if (allocationKeys.size !== 8 || expectedAllocationKeys.some((key) => !allocationKeys.has(key))) {
		throw new Error("Wiring result does not cover the exact four-candidate task cross product");
	}
	if (slurmIds.size !== 8 || transientCaches.size !== 8 || jobNames.size !== 8) {
		throw new Error("Wiring result does not use eight unique jobs and transient caches");
	}
	const wiringIsolation = record(result.isolation, "wiring result isolation");
	for (const field of [
		"modelCalls",
		"providerDispatches",
		"rlmChildren",
		"gpuAllocations",
		"retries",
		"replacements",
	] as const) {
		if (wiringIsolation[field] !== 0) throw new Error(`Wiring result isolation ${field} drifted`);
	}
	if (wiringIsolation.measurementReuse !== false) throw new Error("Wiring result reused measurements");
	const frozenCommon = structuredClone(
		preregistration.frozenCommon,
	) as CompilerGymProxyCascadePreregistration["frozenCommon"];
	if (!frozenCommon || typeof frozenCommon !== "object") throw new Error("Wiring frozenCommon is absent");
	return { candidates, frozenCommon };
}

export function assertCompilerGymProxyCascadeResourceBudgetAlgebra(
	budgets: CompilerGymProxyCascadeResourceBudgets,
	plan?: CompilerGymProxyCascadeResourceBlockPlan,
): void {
	if (
		budgets.blockCount !== 2 ||
		budgets.armCount !== budgets.blockCount * 2 ||
		budgets.controlFreshAllocationsTotal !== budgets.blockCount * budgets.controlAllocationsPerArm ||
		budgets.cascadeFreshAllocationsTotal !== budgets.blockCount * budgets.cascadeAllocationsPerArm ||
		budgets.totalFreshOnlineAllocations !==
			budgets.controlFreshAllocationsTotal + budgets.cascadeFreshAllocationsTotal ||
		budgets.maximumConcurrentAllocations !== 2 ||
		budgets.allocationWallMinutesMaximum !==
			budgets.totalFreshOnlineAllocations * budgets.wallMinutesPerAllocationMaximum ||
		budgets.requestedTaskCpuMinutesMaximum !==
			budgets.allocationWallMinutesMaximum * budgets.requestedCpusPerAllocation ||
		budgets.schedulerLogicalCpuMinutesMaximum !==
			budgets.allocationWallMinutesMaximum * budgets.schedulerLogicalCpusPerAllocationMaximum ||
		budgets.maximumTimedControlArmMinutes !== 4 * budgets.wallMinutesPerAllocationMaximum ||
		budgets.maximumTimedCascadeArmMinutes !== 5 * budgets.wallMinutesPerAllocationMaximum ||
		budgets.maximumTimedArmScheduleMinutes !==
			budgets.blockCount * (budgets.maximumTimedControlArmMinutes + budgets.maximumTimedCascadeArmMinutes)
	) {
		throw new Error("Resource screen budget algebra drifted");
	}
	if (
		plan &&
		(plan.totalFreshOnlineAllocations !== budgets.totalFreshOnlineAllocations ||
			plan.controlAllocationsPerArm !== budgets.controlAllocationsPerArm ||
			plan.cascadeAllocationsPerArm !== budgets.cascadeAllocationsPerArm ||
			plan.maximumConcurrentAllocations !== budgets.maximumConcurrentAllocations)
	) {
		throw new Error("Resource screen block plan and budget algebra differ");
	}
}

function validateClosure(
	value: readonly CompilerGymProxyCascadeResourceSourceRecord[],
): CompilerGymProxyCascadeResourceSourceRecord[] {
	const closure = value.map((entry) => {
		if (
			!entry.relativePath ||
			entry.relativePath.startsWith("/") ||
			entry.relativePath.includes("..") ||
			!SHA256.test(entry.sha256)
		) {
			throw new Error(`Resource screen implementation closure record is invalid: ${entry.relativePath}`);
		}
		return { ...entry };
	});
	if (
		new Set(closure.map((entry) => entry.relativePath)).size !== closure.length ||
		closure.some((entry, index) => index > 0 && entry.relativePath <= closure[index - 1]!.relativePath)
	) {
		throw new Error("Resource screen implementation closure must be unique and strictly sorted");
	}
	for (const entrypoint of COMPILER_GYM_PROXY_CASCADE_RESOURCE_IMPLEMENTATION_ENTRYPOINTS) {
		if (!closure.some((entry) => entry.relativePath === entrypoint)) {
			throw new Error(`Resource screen implementation closure omits ${entrypoint}`);
		}
	}
	return closure;
}

function scientificIdentity(input: {
	candidates: readonly CompilerGymProxyCascadeCandidateSource[];
	frozenCommon: CompilerGymProxyCascadePreregistration["frozenCommon"];
	blockPlan: CompilerGymProxyCascadeResourceBlockPlan;
	implementationBundleSha256: string;
}): string {
	return sha256Json({
		experimentId: COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPERIMENT_ID,
		screenProtocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
		upstreamWiringQualification: COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS,
		candidateSources: input.candidates,
		candidateBundleSha256: sha256Json(input.candidates),
		frozenCommon: input.frozenCommon,
		blockPlan: input.blockPlan,
		governance: {
			question: COMPILER_GYM_PROXY_CASCADE_RESOURCE_QUESTION,
			hypothesis: COMPILER_GYM_PROXY_CASCADE_RESOURCE_HYPOTHESIS,
			classification: "zero-model-counterbalanced-resource-screen-only",
			claimLimits: COMPILER_GYM_PROXY_CASCADE_RESOURCE_CLAIM_LIMITS,
			timingContract: COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT,
			resourceThresholds: COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS,
			gateEvidenceContract: COMPILER_GYM_PROXY_CASCADE_RESOURCE_GATE_EVIDENCE_CONTRACT,
			isolation: COMPILER_GYM_PROXY_CASCADE_RESOURCE_ISOLATION,
			accounting: COMPILER_GYM_PROXY_CASCADE_RESOURCE_ACCOUNTING,
			budgets: COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS,
			sealSchema: COMPILER_GYM_PROXY_CASCADE_RESOURCE_SEAL_SCHEMA,
			lockSchema: COMPILER_GYM_PROXY_CASCADE_RESOURCE_LOCK_SCHEMA,
			stopPolicy: COMPILER_GYM_PROXY_CASCADE_RESOURCE_STOP_POLICY,
			decisionPolicy: COMPILER_GYM_PROXY_CASCADE_RESOURCE_DECISION_POLICY,
		},
		implementationBundleSha256: input.implementationBundleSha256,
	});
}

function validateLaunchPaths(repoRoot: string, preregistrationPath: string, outputDir: string): void {
	for (const [label, path] of [
		["repository", repoRoot],
		["preregistration", preregistrationPath],
		["output", outputDir],
	] as const) {
		if (dirname(path) === path) throw new Error(`Resource screen ${label} path may not be a filesystem root`);
	}
	if (
		preregistrationPath === outputDir ||
		preregistrationPath.startsWith(`${outputDir}${sep}`) ||
		outputDir.startsWith(`${preregistrationPath}${sep}`)
	) {
		throw new Error("Resource screen preregistration and output paths must be disjoint and non-nested");
	}
}

function remoteLocks(
	identity: string,
	sourceRoot: string,
): CompilerGymProxyCascadeResourcePreregistration["remoteLocks"] {
	const parentRoot = `${sourceRoot}/proxy-cascade-resource-locks`;
	const root = `${parentRoot}/${identity.slice(0, 32)}`;
	return {
		scientificIdentitySha256: identity,
		parentRoot,
		root,
		globalPath: `${root}/global.lock`,
		blockOneControlPath: `${root}/block-one-control.lock`,
		blockOneCascadeSelectionPath: `${root}/block-one-cascade-selection.lock`,
		blockOneCascadePath: `${root}/block-one-cascade.lock`,
		blockOnePath: `${root}/block-one.lock`,
		blockTwoCascadePath: `${root}/block-two-cascade.lock`,
		blockTwoCascadeSelectionPath: `${root}/block-two-cascade-selection.lock`,
		blockTwoControlPath: `${root}/block-two-control.lock`,
		blockTwoPath: `${root}/block-two.lock`,
		terminalPath: `${root}/terminal.lock`,
		...structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_LOCK_SCHEMA.remote),
	};
}

export function buildCompilerGymProxyCascadeResourcePreregistration(
	input: CompilerGymProxyCascadeResourcePreregistrationBuildInput,
): CompilerGymProxyCascadeResourcePreregistration {
	if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("Resource screen createdAt is invalid");
	const repoRoot = resolve(input.repoRoot);
	const preregistrationPath = resolve(input.preregistrationPath);
	const outputDir = resolve(input.outputDir);
	validateLaunchPaths(repoRoot, preregistrationPath, outputDir);
	const joined = validateWiringSemanticJoin({
		preregistrationContents: input.wiringPreregistrationContents,
		resultContents: input.wiringResultContents,
		evidenceContents: input.wiringEvidenceContents,
		candidateArtifacts: input.candidateArtifacts,
	});
	const blockPlan = buildCompilerGymProxyCascadeResourceBlockPlan();
	assertCompilerGymProxyCascadeResourceBudgetAlgebra(COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS, blockPlan);
	const implementationClosure = validateClosure(input.implementationClosure);
	const implementationBundleSha256 = sha256Json(implementationClosure);
	const identity = scientificIdentity({
		candidates: joined.candidates,
		frozenCommon: joined.frozenCommon,
		blockPlan,
		implementationBundleSha256,
	});
	const sourceRoot = joined.frozenCommon.environment.remoteSourceRoot;
	const armSeals = blockPlan.blocks.flatMap((block) =>
		block.arms.map(
			(arm): CompilerGymProxyCascadeResourceArmSeal => ({
				blockOrdinal: block.blockOrdinal,
				arm: arm.arm,
				path: resolve(outputDir, `seals/block-${block.blockOrdinal}-${arm.arm}.json`),
				requiredAllocationCount: arm.onlineAllocationCount,
			}),
		),
	);
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_PREREGISTRATION_PROTOCOL,
		experimentId: COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPERIMENT_ID,
		screenProtocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RESOURCE_RUNNER_PROTOCOL,
		createdAt: input.createdAt,
		status: "preregistered-before-any-resource-screen-ssh-or-evaluator-dispatch",
		question: COMPILER_GYM_PROXY_CASCADE_RESOURCE_QUESTION,
		hypothesis: COMPILER_GYM_PROXY_CASCADE_RESOURCE_HYPOTHESIS,
		classification: "zero-model-counterbalanced-resource-screen-only",
		claimLimits: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_CLAIM_LIMITS),
		upstreamWiringQualification: {
			artifacts: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS),
			scientificIdentitySha256: COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.scientificIdentitySha256,
			preregistrationSha256: COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.preregistration.sha256,
			candidateBundleSha256: COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.candidateBundleSha256,
			frontierOrdinals: [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_FRONTIER_ORDINALS],
			championOrdinal: COMPILER_GYM_PROXY_CASCADE_RESOURCE_EXPECTED_CHAMPION_ORDINAL,
			resultDisposition: "happy-path-wiring-qualified-only",
			liveScientificEvidenceEligible: true,
			semanticJoinPassed: true,
		},
		candidateSources: joined.candidates,
		candidateBundleSha256: sha256Json(joined.candidates),
		frozenCommon: joined.frozenCommon,
		blockPlan,
		timingContract: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_TIMING_CONTRACT),
		resourceThresholds: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_THRESHOLDS),
		gateEvidenceContract: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_GATE_EVIDENCE_CONTRACT),
		isolation: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_ISOLATION),
		accounting: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_ACCOUNTING),
		budgets: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_BUDGETS),
		seals: {
			schema: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_SEAL_SCHEMA),
			cascadeSelection: [1, 2].map((blockOrdinal) => ({
				blockOrdinal: blockOrdinal as 1 | 2,
				path: resolve(outputDir, `seals/block-${blockOrdinal}-cascade-selection.json`),
			})),
			arm: armSeals,
			block: [1, 2].map((blockOrdinal) => ({
				blockOrdinal: blockOrdinal as 1 | 2,
				path: resolve(outputDir, `seals/block-${blockOrdinal}.json`),
			})),
		},
		localAttemptLock: {
			path: resolve(
				homedir(),
				".local/state/prime-agent-autoresearch/attempt-locks",
				`proxy-cascade-resource-${identity}.lock`,
			),
			...structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_LOCK_SCHEMA.localAttempt),
		},
		remoteLocks: remoteLocks(identity, sourceRoot),
		stopPolicy: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_STOP_POLICY),
		decisionPolicy: structuredClone(COMPILER_GYM_PROXY_CASCADE_RESOURCE_DECISION_POLICY),
		launchPaths: { repoRoot, preregistrationPath, outputDir },
		implementationClosure,
		implementationBundleSha256,
		scientificIdentitySha256: identity,
	};
}

export function parseCompilerGymProxyCascadeResourcePreregistration(input: {
	value: unknown;
	expected: CompilerGymProxyCascadeResourcePreregistrationBuildInput;
}): CompilerGymProxyCascadeResourcePreregistration {
	const expected = buildCompilerGymProxyCascadeResourcePreregistration(input.expected);
	assert.deepEqual(input.value, expected, "Resource screen preregistration differs from reconstructed protocol");
	return expected;
}

async function readPinnedRegularUtf8(
	absolutePath: string,
	requiredMode?: number,
): Promise<{ contents: string; mode: number; isFile: true; isSymbolicLink: false }> {
	const pathMetadata = await lstat(absolutePath);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
		throw new Error(`Resource screen source is not a regular non-symlink file: ${absolutePath}`);
	}
	const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (
			!before.isFile() ||
			before.dev !== pathMetadata.dev ||
			before.ino !== pathMetadata.ino ||
			(requiredMode !== undefined && (before.mode & 0o777) !== requiredMode)
		) {
			throw new Error(`Resource screen source metadata changed before pinned read: ${absolutePath}`);
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
			throw new Error(`Resource screen source changed during pinned read: ${absolutePath}`);
		}
		return { contents, mode: before.mode, isFile: true, isSymbolicLink: false };
	} finally {
		await handle.close();
	}
}

export async function collectCompilerGymProxyCascadeResourceImplementationClosure(
	repoRoot: string,
): Promise<CompilerGymProxyCascadeResourceSourceRecord[]> {
	const root = resolve(repoRoot);
	const queued: string[] = [...COMPILER_GYM_PROXY_CASCADE_RESOURCE_IMPLEMENTATION_ENTRYPOINTS];
	const discovered = new Map<string, string>();
	const staticImportPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g;
	const resolveLocalImport = async (fromPath: string, specifier: string): Promise<string> => {
		const raw = resolve(dirname(resolve(root, fromPath)), specifier);
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
					throw new Error(`Resource screen local import escapes repository: ${specifier}`);
				}
				return path;
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
				throw error;
			}
		}
		throw new Error(`Resource screen static import could not be resolved: ${fromPath} -> ${specifier}`);
	};
	while (queued.length > 0) {
		const relativePath = queued.pop();
		if (!relativePath || discovered.has(relativePath)) continue;
		const { contents } = await readPinnedRegularUtf8(resolve(root, relativePath));
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
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([relativePath, sha256]) => ({ relativePath, sha256 }));
}

function candidatePathsFromWiringPreregistration(contents: string): Array<{ ordinal: number; path: string }> {
	validateFrozenContents(contents, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.preregistration);
	const value = parseJson(contents, "wiring preregistration");
	return array(value.candidateSources, "wiring candidateSources").map((candidateValue, index) => {
		const candidate = record(candidateValue, `wiring candidateSources[${index}]`);
		return { ordinal: index + 1, path: string(candidate.artifactPath, "wiring candidate artifactPath") };
	});
}

export async function collectCompilerGymProxyCascadeResourceCandidateArtifacts(input: {
	repoRoot: string;
	wiringPreregistrationContents?: string;
}): Promise<CompilerGymProxyCascadeCandidateArtifactInput[]> {
	const repoRoot = resolve(input.repoRoot);
	const wiringPreregistrationContents =
		input.wiringPreregistrationContents ??
		(
			await readPinnedRegularUtf8(
				resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.preregistration.path),
				0o600,
			)
		).contents;
	return Promise.all(
		candidatePathsFromWiringPreregistration(wiringPreregistrationContents).map(async (candidate) => ({
			ordinal: candidate.ordinal,
			relativePath: candidate.path,
			...(await readPinnedRegularUtf8(resolve(repoRoot, candidate.path), 0o600)),
		})),
	);
}

export function canonicalCompilerGymProxyCascadeResourcePreregistration(
	value: CompilerGymProxyCascadeResourcePreregistration,
): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

export async function writeCompilerGymProxyCascadeResourcePreregistration(input: {
	repoRoot: string;
	path: string;
	outputDir?: string;
	createdAt?: string;
}): Promise<{
	path: string;
	sha256: string;
	record: CompilerGymProxyCascadeResourcePreregistration;
}> {
	const repoRoot = resolve(input.repoRoot);
	const path = resolve(input.path);
	const outputDir = resolve(input.outputDir ?? resolve(dirname(path), "execution"));
	validateLaunchPaths(repoRoot, path, outputDir);
	try {
		await stat(outputDir);
		throw new Error("Resource screen output directory must be absent when preregistering");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const wiringPreregistrationContents = (
		await readPinnedRegularUtf8(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.preregistration.path),
			0o600,
		)
	).contents;
	const [wiringResultContents, wiringEvidenceContents, candidateArtifacts, implementationClosure] = await Promise.all([
		readPinnedRegularUtf8(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.result.path),
			0o600,
		).then(({ contents }) => contents),
		readPinnedRegularUtf8(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_RESOURCE_WIRING_ARTIFACTS.evidenceLedger.path),
			0o600,
		).then(({ contents }) => contents),
		collectCompilerGymProxyCascadeResourceCandidateArtifacts({ repoRoot, wiringPreregistrationContents }),
		collectCompilerGymProxyCascadeResourceImplementationClosure(repoRoot),
	]);
	const record = buildCompilerGymProxyCascadeResourcePreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		repoRoot,
		preregistrationPath: path,
		outputDir,
		wiringPreregistrationContents,
		wiringResultContents,
		wiringEvidenceContents,
		candidateArtifacts,
		implementationClosure,
	});
	const contents = canonicalCompilerGymProxyCascadeResourcePreregistration(record);
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
		throw new Error("Resource screen preregistration is not a private regular file");
	}
	return { path, sha256: sha256Text(contents), record };
}

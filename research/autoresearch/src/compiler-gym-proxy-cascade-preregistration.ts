import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import { parseAuthoritativeLlvmFlags } from "./compiler-gym-complete-action-space-headroom.js";
import { DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT } from "./compiler-gym-ir-delta-qualification-preregistration.js";
import {
	COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import {
	buildCompilerGymProxyCascadePhasePlan,
	COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES,
	COMPILER_GYM_PROXY_CASCADE_PROTOCOL,
	COMPILER_GYM_PROXY_CASCADE_TASKS,
	type CompilerGymProxyCascadeCandidate,
	type CompilerGymProxyCascadePhasePlan,
	type CompilerGymProxyCascadeReplayLedgerSource,
	type CompilerGymProxyCascadeReplayResult,
	type CompilerGymProxyCascadeSelectedTrajectory,
	projectCompilerGymProxyCascadeReplay,
	replayCompilerGymProxyCascade,
	selectCompilerGymProxyCascadeTrajectory,
} from "./compiler-gym-proxy-cascade-protocol.js";

export const COMPILER_GYM_PROXY_CASCADE_EXPERIMENT_ID = "compiler-gym-blowfish-proxy-cascade-qualification-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_PREREGISTRATION_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-preregistration-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL = "compiler-gym-blowfish-proxy-cascade-runner-v1" as const;

export const COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS = {
	latencyConfig: {
		path: "research/autoresearch/compiler-gym-latency-v1.analysis.json",
		sha256: "12e92cce02ef98b6e9f69fda9f5fb4ee0f3c3e519d75c785bebbe60b48790364",
	},
	latencyResultManifest: {
		path: ".autoresearch/compiler-gym-latency-audit/analysis-v1.json",
		sha256: "08d50b4fdd32c8e435f9549c79030419d814a7ebaf3cb72e214e2fde0d583d73",
	},
	sealedReplayResult: {
		path: ".autoresearch/compiler-gym-proxy-cascade-headroom/2026-08-29-v1/replay-result.json",
		sha256: "824065b538e0eb38436f32eb981970497ecf3d64a815a4b8dafcc1f559bd79d2",
	},
	sealedReplayDigestManifest: {
		path: ".autoresearch/compiler-gym-proxy-cascade-headroom/2026-08-29-v1/replay-result.sha256",
		sha256: "1d3904b367e455f271276bb7fbe13762de3de062b1d0dfa2f7b98960d020607c",
	},
} as const;

export const COMPILER_GYM_PROXY_CASCADE_IMPLEMENTATION_ENTRYPOINTS = [
	"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
	"research/autoresearch/src/compiler-gym-proxy-cascade-preregistration-cli.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-preregistration.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-protocol.ts",
	"research/autoresearch/src/compiler-gym-proxy-cascade-runner.ts",
	"research/autoresearch/compiler-gym-latency-v1.analysis.json",
	"research/autoresearch/package.json",
	"research/autoresearch/tsconfig.json",
	"package.json",
	"package-lock.json",
	"tsconfig.json",
	"tsconfig.base.json",
] as const;

const SHA256 = /^[0-9a-f]{64}$/;
const CANDIDATE_MEDIA_TYPE = "application/vnd.prime.llvm-pass-sequence";

export const COMPILER_GYM_PROXY_CASCADE_QUESTION =
	"Can a blowfish-only first stage preserve the complete frozen two-task frontier while avoiding two of four bzip2 evaluations in one source-sealed happy-path batch?" as const;
export const COMPILER_GYM_PROXY_CASCADE_HYPOTHESIS =
	"For the deterministically selected untied four-candidate batch, the two candidates in the best two distinct blowfish IR tiers retain the full blowfish/bzip2 IR frontier and authoritative champion." as const;

export const COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS = {
	historicalBatchChoice: {
		allowedInputs: ["ledgerPath", "candidateDigest", "blowfishIr"],
		forbiddenInputs: [
			"jobId",
			"manifestDigest",
			"candidateByteLength",
			"candidateActionCount",
			"bzip2Ir",
			"blowfishEvaluatorMs",
			"bzip2EvaluatorMs",
			"blowfishWallMs",
			"bzip2WallMs",
			"paretoFrontier",
		],
	},
	liveCandidateChoice: {
		allowedInputs: ["candidateOrdinal", "freshAcceptedBlowfishIr"],
		forbiddenInputs: [
			"candidateDigest",
			"candidateByteLength",
			"candidateActionCount",
			"candidateBytes",
			"historicalJobId",
			"freshJobId",
			"manifestDigest",
			"slurmJobId",
			"historicalBlowfishIr",
			"historicalBlowfishObjectTextSizeBytes",
			"freshBlowfishObjectTextSizeBytes",
			"historicalBzip2Ir",
			"historicalBzip2ObjectTextSizeBytes",
			"freshBzip2Ir",
			"freshBzip2ObjectTextSizeBytes",
			"evaluatorRuntime",
			"schedulerOrQueueWall",
			"accounting",
			"frontier",
			"champion",
			"modelOrProviderOutput",
			"auditEvidence",
		],
	},
} as const;

export const COMPILER_GYM_PROXY_CASCADE_SEALED_REPLAY_AUTHORIZATIONS = {
	modelFreeSystemsQualification: true,
	feedbackLatencyImprovement: false,
	provider: false,
	paid: false,
	harnessTreatment: false,
	gpu: false,
	nanogpt: false,
	defaultPromotion: false,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_CLAIM_LIMITS = {
	causalTimingClaimAllowed: false,
	prospectivePolicyClaimAllowed: false,
	independentReplayAssumptionAllowed: false,
	defaultPromotionAllowed: false,
	gpuPromotionAllowed: false,
	nanogptPromotionAllowed: false,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_FRESH_MEASUREMENT_RULES = {
	freshScientificMetricsMustExactlyReproduceHistoricalIrAndObjectBytes: true,
	freshTimingMustReproduceHistoricalTiming: false,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_ISOLATION = {
	modelCalls: 0,
	providerDispatches: 0,
	rlmChildren: 0,
	compaction: false,
	webAccess: false,
	gpuAllocations: 0,
	measurementReuse: false,
	retries: 0,
	replacements: 0,
	adaptiveCandidateSubstitution: false,
	agentVisibilityOfAuditMeasurements: false,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_PHASE_SEAL_SCHEMA = {
	localSealWrite: "exclusive-create-mode-0600-write-fsync-close",
	selection: {
		requiresAllocationOrdinals: [1, 2, 3, 4],
		contents: [
			"scientific-identity",
			"phase-plan-sha256",
			"four-blowfish-measurement-payload-sha256s",
			"four-slurm-job-ids",
			"ranked-distinct-proxy-tiers",
			"selected-and-omitted-source-ordinals",
		],
		remoteReadbackRequiredBeforeSelectedBzip2: true,
	},
	cascade: {
		requiresAllocationOrdinals: [1, 2, 3, 4, 5, 6],
		contents: [
			"scientific-identity",
			"selection-seal-sha256",
			"first-six-measurement-payload-sha256s",
			"first-six-slurm-job-ids",
			"four-blowfish-plus-two-selected-bzip2-scientific-evidence",
		],
		remoteReadbackRequiredBeforeAudit: true,
	},
	audit: {
		requiresAllocationOrdinals: [1, 2, 3, 4, 5, 6, 7, 8],
		containsAgentInaccessibleOmittedBzip2EvidenceOnlyAfterCascadeSeal: true,
	},
} as const;

export const COMPILER_GYM_PROXY_CASCADE_LOCK_SCHEMA = {
	localAttempt: {
		createOnlyBeforeAnySsh: true,
		mode: "0600",
		neverRemovedByRunner: true,
	},
	remote: {
		kinds: ["global", "selection", "cascade", "audit"],
		createOnly: true,
		mode: "0600",
		writeFsyncCloseReadbackExact: true,
		neverRemovedByRunner: true,
	},
} as const;

export const COMPILER_GYM_PROXY_CASCADE_ACCOUNTING = {
	mode: "required",
	exactRowsPerAllocation: ["root", "extern", ".0"],
	rootAllocCpusAccepted: [2, 4],
	stepAllocCpus: 2,
	stepTasks: 1,
	allRowsMustBeTerminalBeforeAdmission: true,
	queueAndSchedulerWallIsDescriptiveOnly: true,
	evaluatorRuntimeIsDescriptiveOnly: true,
} as const;

export interface CompilerGymProxyCascadeBudgets {
	actualFreshOneTaskAllocations: number;
	proxyBlowfishAllocations: number;
	selectedBzip2Allocations: number;
	omittedBzip2AuditAllocations: number;
	counterfactualCascadeAllocations: number;
	counterfactualAllocationReductionNumerator: number;
	counterfactualAllocationReductionDenominator: number;
	allocationSavingBasis: "allocation-count-only-not-time-or-cpu";
	wallMinutesPerAllocationMaximum: number;
	requestedCpusPerAllocation: number;
	schedulerLogicalCpusPerAllocationMaximum: number;
	allocationWallMinutesMaximum: number;
	requestedTaskCpuMinutesMaximum: number;
	schedulerLogicalCpuMinutesMaximum: number;
}

export const COMPILER_GYM_PROXY_CASCADE_BUDGETS = {
	actualFreshOneTaskAllocations: 8,
	proxyBlowfishAllocations: 4,
	selectedBzip2Allocations: 2,
	omittedBzip2AuditAllocations: 2,
	counterfactualCascadeAllocations: 6,
	counterfactualAllocationReductionNumerator: 2,
	counterfactualAllocationReductionDenominator: 8,
	allocationSavingBasis: "allocation-count-only-not-time-or-cpu",
	wallMinutesPerAllocationMaximum: 5,
	requestedCpusPerAllocation: 2,
	schedulerLogicalCpusPerAllocationMaximum: 4,
	allocationWallMinutesMaximum: 40,
	requestedTaskCpuMinutesMaximum: 80,
	schedulerLogicalCpuMinutesMaximum: 160,
} as const satisfies CompilerGymProxyCascadeBudgets;

export const COMPILER_GYM_PROXY_CASCADE_STOP_POLICY = {
	beforePhaseA: "any-preregistration-source-replay-environment-or-lock-drift-stops-before-ssh",
	phaseA: "any-proxy-failure-or-anchor-drift-stops-with-no-bzip2-dispatch",
	selectionBoundary: "any-tie-selection-or-seal-readback-drift-stops-before-selected-bzip2",
	phaseB: "any-selected-bzip2-failure-or-anchor-drift-stops-with-no-audit-dispatch",
	cascadeBoundary: "any-cascade-seal-readback-drift-stops-before-audit",
	phaseC: "any-audit-failure-or-anchor-drift-is-terminal-apparatus-invalid",
	frontierOrChampionMiss: "kill-proxy-cascade-policy",
	allFailuresConsumeAttempt: true,
	noRetryReplacementOrCandidateSubstitution: true,
} as const;

export const COMPILER_GYM_PROXY_CASCADE_DECISION_POLICY = {
	frontierDefinition: "raw-two-task-ir-weakly-no-worse-and-strictly-better-on-at-least-one",
	candidateMatching: "sealed-source-digest-and-source-ordinal-never-new-job-id",
	requireAllFourFullControlFrontierCandidatesRetained: true,
	requireAuthoritativeChampionRetained: true,
	droppedTaskState: "not-evaluated-never-rejected-or-imputed",
	positiveDisposition: "happy-path-wiring-qualified-only",
	actualTimingClaim: "descriptive-no-causal-comparison",
	computeSavingClaim: "counterfactual-six-versus-eight-allocation-count-only",
} as const;

export interface CompilerGymProxyCascadeSourceRecord {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymProxyCascadeCandidateArtifactInput {
	ordinal: number;
	relativePath: string;
	contents: string;
	mode: number;
	isFile: boolean;
	isSymbolicLink: boolean;
}

export interface CompilerGymProxyCascadeCandidateSource {
	ordinal: number;
	historicalJobId: string;
	artifactPath: string;
	artifactSha256: string;
	artifactByteLength: number;
	artifactMediaType: typeof CANDIDATE_MEDIA_TYPE;
	artifactFileType: "regular";
	artifactMode: "0600";
	artifactSymbolicLink: false;
	canonicalBytesUtf8: string;
	actions: string[];
	historicalMeasurementPayloadSha256: string;
	expectedMetrics: {
		blowfish: { irInstructionCount: number; objectTextSizeBytes: number };
		bzip2: { irInstructionCount: number; objectTextSizeBytes: number };
	};
}

export interface CompilerGymProxyCascadePreregistration {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_PREREGISTRATION_PROTOCOL;
	experimentId: typeof COMPILER_GYM_PROXY_CASCADE_EXPERIMENT_ID;
	screenProtocol: typeof COMPILER_GYM_PROXY_CASCADE_PROTOCOL;
	runnerProtocol: typeof COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL;
	createdAt: string;
	status: "preregistered-before-any-ssh-or-evaluator-dispatch";
	question: string;
	hypothesis: string;
	classification: "model-free-happy-path-wiring-qualification-only";
	claimLimits: typeof COMPILER_GYM_PROXY_CASCADE_CLAIM_LIMITS;
	historicalReplay: {
		analysisArtifacts: typeof COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS;
		inputManifestSha256: string;
		result: CompilerGymProxyCascadeReplayResult;
		resultSha256: string;
		gateRecomputedDuringPreregistration: true;
		measurementsReusedForQualification: false;
	};
	selectedTrajectory: {
		selectionMethod: CompilerGymProxyCascadeSelectedTrajectory["selectionMethod"];
		path: string;
		ledgerSha256: string;
		terminalEventHash: string;
		restrictedProjectionSha256: string;
		selectedOrdinals: number[];
		omittedOrdinals: number[];
		selectionContracts: typeof COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS;
	};
	candidateSources: CompilerGymProxyCascadeCandidateSource[];
	candidateBundleSha256: string;
	frozenCommon: {
		tasks: typeof COMPILER_GYM_PROXY_CASCADE_TASKS;
		verifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
		canonicalEvaluator: {
			path: "research/autoresearch/evaluators/compiler_gym_eval.py";
			sha256: typeof COMPILER_GYM_EVALUATOR_SHA256;
		};
		irDeltaEvaluator: {
			path: "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py";
			sha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256;
		};
		irDeltaSourceBundleSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256;
		environment: typeof DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT;
		environmentSha256: string;
		adapterOutputProtocol: typeof COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL;
		accountingRowsProtocol: typeof COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL;
		freshScientificMetricsMustExactlyReproduceHistoricalIrAndObjectBytes: true;
		freshTimingMustReproduceHistoricalTiming: false;
	};
	isolation: typeof COMPILER_GYM_PROXY_CASCADE_ISOLATION;
	phasePlan: CompilerGymProxyCascadePhasePlan;
	phaseSeals: {
		localSealWrite: "exclusive-create-mode-0600-write-fsync-close";
		selection: {
			localPath: string;
			requiresAllocationOrdinals: readonly [1, 2, 3, 4];
			contents: readonly [
				"scientific-identity",
				"phase-plan-sha256",
				"four-blowfish-measurement-payload-sha256s",
				"four-slurm-job-ids",
				"ranked-distinct-proxy-tiers",
				"selected-and-omitted-source-ordinals",
			];
			remoteReadbackRequiredBeforeSelectedBzip2: true;
		};
		cascade: {
			localPath: string;
			requiresAllocationOrdinals: readonly [1, 2, 3, 4, 5, 6];
			contents: readonly [
				"scientific-identity",
				"selection-seal-sha256",
				"first-six-measurement-payload-sha256s",
				"first-six-slurm-job-ids",
				"four-blowfish-plus-two-selected-bzip2-scientific-evidence",
			];
			remoteReadbackRequiredBeforeAudit: true;
		};
		audit: {
			localPath: string;
			requiresAllocationOrdinals: readonly [1, 2, 3, 4, 5, 6, 7, 8];
			containsAgentInaccessibleOmittedBzip2EvidenceOnlyAfterCascadeSeal: true;
		};
	};
	localAttemptLock: {
		path: string;
		createOnlyBeforeAnySsh: true;
		mode: "0600";
		neverRemovedByRunner: true;
	};
	remoteLocks: {
		scientificIdentitySha256: string;
		parentRoot: string;
		root: string;
		globalPath: string;
		selectionPath: string;
		cascadePath: string;
		auditPath: string;
		createOnly: true;
		mode: "0600";
		writeFsyncCloseReadbackExact: true;
		neverRemovedByRunner: true;
	};
	accounting: typeof COMPILER_GYM_PROXY_CASCADE_ACCOUNTING;
	budgets: CompilerGymProxyCascadeBudgets;
	stopPolicy: typeof COMPILER_GYM_PROXY_CASCADE_STOP_POLICY;
	decisionPolicy: typeof COMPILER_GYM_PROXY_CASCADE_DECISION_POLICY;
	launchPaths: {
		repoRoot: string;
		preregistrationPath: string;
		outputDir: string;
	};
	implementationClosure: CompilerGymProxyCascadeSourceRecord[];
	implementationBundleSha256: string;
	scientificIdentitySha256: string;
}

export interface CompilerGymProxyCascadePreregistrationBuildInput {
	createdAt: string;
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
	replaySources: readonly CompilerGymProxyCascadeReplayLedgerSource[];
	latencyConfigContents: string;
	latencyResultManifestContents: string;
	sealedReplayResultContents: string;
	sealedReplayDigestManifestContents: string;
	authoritativeEvaluatorContents: string;
	irDeltaEvaluatorContents: string;
	candidateArtifacts: readonly CompilerGymProxyCascadeCandidateArtifactInput[];
	implementationClosure: readonly CompilerGymProxyCascadeSourceRecord[];
}

function validateCreatedAt(value: string): void {
	if (!Number.isFinite(Date.parse(value))) throw new Error("Proxy-cascade preregistration createdAt is invalid");
}

export function assertCompilerGymProxyCascadeLaunchPaths(
	repoRoot: string,
	preregistrationPath: string,
	outputDir: string,
): void {
	for (const [label, path] of [
		["repository", repoRoot],
		["preregistration", preregistrationPath],
		["output", outputDir],
	] as const) {
		if (dirname(path) === path) throw new Error(`Proxy-cascade ${label} path may not be a filesystem root`);
	}
	if (
		preregistrationPath === outputDir ||
		preregistrationPath.startsWith(`${outputDir}${sep}`) ||
		outputDir.startsWith(`${preregistrationPath}${sep}`)
	) {
		throw new Error("Proxy-cascade preregistration and output paths must be disjoint and non-nested");
	}
}

function validateImplementationClosure(
	value: readonly CompilerGymProxyCascadeSourceRecord[],
): CompilerGymProxyCascadeSourceRecord[] {
	const closure = value.map((record) => {
		if (
			!record.relativePath ||
			record.relativePath.startsWith("/") ||
			record.relativePath.includes("..") ||
			!SHA256.test(record.sha256)
		) {
			throw new Error(`Proxy-cascade implementation closure record is invalid: ${record.relativePath}`);
		}
		return { ...record };
	});
	if (new Set(closure.map((record) => record.relativePath)).size !== closure.length) {
		throw new Error("Proxy-cascade implementation closure contains duplicate paths");
	}
	if (closure.some((record, index) => index > 0 && record.relativePath <= closure[index - 1]!.relativePath)) {
		throw new Error("Proxy-cascade implementation closure must be strictly sorted");
	}
	for (const entrypoint of COMPILER_GYM_PROXY_CASCADE_IMPLEMENTATION_ENTRYPOINTS) {
		if (!closure.some((record) => record.relativePath === entrypoint)) {
			throw new Error(`Proxy-cascade implementation closure omits ${entrypoint}`);
		}
	}
	for (const [relativePath, sha256] of [
		["research/autoresearch/evaluators/compiler_gym_eval.py", COMPILER_GYM_EVALUATOR_SHA256],
		["research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py", COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256],
		[
			COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyConfig.path,
			COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyConfig.sha256,
		],
	] as const) {
		if (closure.find((record) => record.relativePath === relativePath)?.sha256 !== sha256) {
			throw new Error(`Proxy-cascade implementation closure hash drifted for ${relativePath}`);
		}
	}
	return closure;
}

function expectedCandidateArtifactPath(
	selected: CompilerGymProxyCascadeSelectedTrajectory,
	candidateSha256: string,
): string {
	return `.autoresearch/${dirname(selected.path)}/artifacts/sha256/${candidateSha256.slice(0, 2)}/${candidateSha256.slice(2)}`;
}

function validateCandidateSources(input: {
	selected: CompilerGymProxyCascadeSelectedTrajectory;
	candidateArtifacts: readonly CompilerGymProxyCascadeCandidateArtifactInput[];
	authoritativeEvaluatorContents: string;
}): CompilerGymProxyCascadeCandidateSource[] {
	const byOrdinal = new Map<number, CompilerGymProxyCascadeCandidateArtifactInput>();
	for (const artifact of input.candidateArtifacts) {
		if (byOrdinal.has(artifact.ordinal)) throw new Error(`Duplicate candidate artifact ordinal ${artifact.ordinal}`);
		byOrdinal.set(artifact.ordinal, artifact);
	}
	if (byOrdinal.size !== 4) throw new Error("Proxy-cascade candidate closure must contain exactly four artifacts");
	const allowedFlags = new Set(parseAuthoritativeLlvmFlags(input.authoritativeEvaluatorContents));
	return [...input.selected.candidates]
		.sort((left, right) => left.ordinal - right.ordinal)
		.map((candidate) => {
			const artifact = byOrdinal.get(candidate.ordinal);
			if (!artifact) throw new Error(`Missing candidate artifact ordinal ${candidate.ordinal}`);
			const expectedPath = expectedCandidateArtifactPath(input.selected, candidate.candidateSha256);
			if (artifact.relativePath !== expectedPath)
				throw new Error(`Candidate ${candidate.ordinal} artifact path drifted`);
			if (!artifact.isFile || artifact.isSymbolicLink || (artifact.mode & 0o777) !== 0o600) {
				throw new Error(`Candidate ${candidate.ordinal} artifact must be a mode-0600 regular non-symlink file`);
			}
			if (sha256Text(artifact.contents) !== candidate.candidateSha256) {
				throw new Error(`Candidate ${candidate.ordinal} artifact SHA-256 drifted`);
			}
			if (Buffer.byteLength(artifact.contents) !== candidate.candidateByteLength) {
				throw new Error(`Candidate ${candidate.ordinal} artifact byte length drifted`);
			}
			const parsed: unknown = JSON.parse(artifact.contents);
			if (
				!Array.isArray(parsed) ||
				parsed.length === 0 ||
				parsed.length > 256 ||
				!parsed.every((action) => typeof action === "string" && allowedFlags.has(action))
			) {
				throw new Error(`Candidate ${candidate.ordinal} artifact is not a legal nonempty LLVM action sequence`);
			}
			if (canonicalJson(toJsonValue(parsed)) !== artifact.contents) {
				throw new Error(`Candidate ${candidate.ordinal} artifact bytes are not canonical JSON`);
			}
			return candidateSource(candidate, artifact, parsed);
		});
}

function candidateSource(
	candidate: CompilerGymProxyCascadeCandidate,
	artifact: CompilerGymProxyCascadeCandidateArtifactInput,
	actions: unknown[],
): CompilerGymProxyCascadeCandidateSource {
	return {
		ordinal: candidate.ordinal,
		historicalJobId: candidate.jobId,
		artifactPath: artifact.relativePath,
		artifactSha256: candidate.candidateSha256,
		artifactByteLength: candidate.candidateByteLength,
		artifactMediaType: CANDIDATE_MEDIA_TYPE,
		artifactFileType: "regular",
		artifactMode: "0600",
		artifactSymbolicLink: false,
		canonicalBytesUtf8: artifact.contents,
		actions: actions.map((action) => String(action)),
		historicalMeasurementPayloadSha256: candidate.measurementPayloadSha256,
		expectedMetrics: {
			blowfish: {
				irInstructionCount: candidate.blowfish.irInstructionCount,
				objectTextSizeBytes: candidate.blowfish.objectTextSizeBytes,
			},
			bzip2: {
				irInstructionCount: candidate.bzip2.irInstructionCount,
				objectTextSizeBytes: candidate.bzip2.objectTextSizeBytes,
			},
		},
	};
}

function validateFrozenFile(contents: string, expected: { path: string; sha256: string }): void {
	if (sha256Text(contents) !== expected.sha256) throw new Error(`${expected.path} SHA-256 drifted`);
}

function sealedRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function sealedArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value;
}

function sealedString(value: unknown, path: string): string {
	if (typeof value !== "string" || !value) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function assertCanonicalEqual(actual: unknown, expected: unknown, path: string): void {
	if (canonicalJson(toJsonValue(actual)) !== canonicalJson(toJsonValue(expected))) {
		throw new Error(`${path} differs from the recomputed frozen replay`);
	}
}

function validateSealedReplayArtifacts(
	resultContents: string,
	digestManifestContents: string,
): Record<string, unknown> {
	const result = COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayResult;
	const digestManifest = COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayDigestManifest;
	validateFrozenFile(resultContents, result);
	validateFrozenFile(digestManifestContents, digestManifest);
	const expectedDigestLine = `${result.sha256}  ${result.path}`;
	if (!digestManifestContents.split("\n").includes(expectedDigestLine)) {
		throw new Error(`${digestManifest.path} does not bind the sealed replay result`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(resultContents);
	} catch (error) {
		throw new Error(`${result.path} is not JSON`, { cause: error });
	}
	return sealedRecord(parsed, result.path);
}

function validateSealedReplaySemanticJoin(input: {
	sealed: Record<string, unknown>;
	replay: CompilerGymProxyCascadeReplayResult;
	selected: CompilerGymProxyCascadeSelectedTrajectory;
	candidates: readonly CompilerGymProxyCascadeCandidateSource[];
}): void {
	const { sealed, replay, selected } = input;
	if (sealed.analysisId !== "compiler-gym-proxy-cascade-headroom-v1") {
		throw new Error("Sealed replay analysis ID drifted");
	}
	if (sealed.classification !== "development-informed-retrospective-headroom-not-treatment-evidence") {
		throw new Error("Sealed replay classification drifted");
	}
	assertCanonicalEqual(
		sealed.authorizations,
		COMPILER_GYM_PROXY_CASCADE_SEALED_REPLAY_AUTHORIZATIONS,
		"sealed replay authorizations",
	);
	assertCanonicalEqual(
		sealed.inclusion,
		{
			inputLedgerCount: 21,
			requireExactlyFourProposalsAndMeasurements: true,
			requirePopulatedRunManifestModel: true,
			requireCanonicalMode0600CandidateArtifacts: true,
			excludeScriptedQualificationLedger: "r-resurrection-qualification/2026-08-28-v1/evidence.jsonl",
			rationale: "four-candidate-agent-or-model-trajectories-only",
		},
		"sealed replay inclusion",
	);
	assertCanonicalEqual(
		sealed.gates,
		{
			exactThirteenAgentTrajectories: true,
			allThirteenParetoFrontiersRetained: true,
			evaluatorTimeSavingAtLeast25Percent: true,
		},
		"sealed replay gates",
	);
	if (sealed.eligibleForModelFreeSystemsQualification !== true) {
		throw new Error("Sealed replay does not authorize model-free systems qualification");
	}

	const sealedInputLedgers = sealedArray(sealed.inputLedgers, "sealed replay inputLedgers");
	const sealedInputByPath = new Map<string, Record<string, unknown>>();
	for (const value of sealedInputLedgers) {
		const row = sealedRecord(value, "sealed replay input ledger");
		const path = sealedString(row.path, "sealed replay input ledger path");
		if (sealedInputByPath.has(path)) throw new Error(`Sealed replay repeats input ledger ${path}`);
		sealedInputByPath.set(path, row);
	}
	for (const expected of replay.inputManifest) {
		const row = sealedInputByPath.get(expected.path);
		if (!row) throw new Error(`Sealed replay omits cohort ledger ${expected.path}`);
		assertCanonicalEqual(
			{
				path: row.path,
				sha256: row.sha256,
				eventCount: row.eventCount,
				measurementCount: row.measurementCount,
				terminalEventHash: row.terminalEventHash,
			},
			expected,
			`sealed replay input ledger ${expected.path}`,
		);
	}

	const sealedTrajectories = sealedArray(sealed.trajectories, "sealed replay trajectories");
	const sealedTrajectoryProjection = sealedTrajectories.map((value, index) => {
		const row = sealedRecord(value, `sealed replay trajectories[${index}]`);
		const candidateValues = sealedArray(row.candidates, `sealed replay trajectories[${index}].candidates`);
		return {
			path: row.ledgerPath,
			selectedOrdinals: row.selectedOrdinals,
			frontierOrdinals: row.paretoFrontierOrdinals,
			frontierRetained: row.paretoFrontierRetained,
			candidates: candidateValues.map((candidateValue, candidateIndex) => {
				const candidate = sealedRecord(
					candidateValue,
					`sealed replay trajectories[${index}].candidates[${candidateIndex}]`,
				);
				return {
					ordinal: candidate.ordinal,
					candidateSha256: candidate.candidateDigest,
					blowfishIrInstructionCount: candidate.blowfishIr,
					bzip2IrInstructionCount: candidate.bzip2Ir,
				};
			}),
		};
	});
	const recomputedTrajectoryProjection = replay.trajectories.map((trajectory) => ({
		path: trajectory.path,
		selectedOrdinals: trajectory.selectedOrdinals,
		frontierOrdinals: trajectory.frontierOrdinals,
		frontierRetained: trajectory.frontierRetained,
		candidates: trajectory.candidates.map((candidate) => ({
			ordinal: candidate.ordinal,
			candidateSha256: candidate.candidateSha256,
			blowfishIrInstructionCount: candidate.blowfish.irInstructionCount,
			bzip2IrInstructionCount: candidate.bzip2.irInstructionCount,
		})),
	}));
	assertCanonicalEqual(
		sealedTrajectoryProjection,
		recomputedTrajectoryProjection,
		"sealed replay 13-trajectory cohort",
	);

	const aggregate = sealedRecord(sealed.aggregate, "sealed replay aggregate");
	assertCanonicalEqual(
		{
			trajectoryCount: aggregate.trajectoryCount,
			allParetoFrontiersRetained: aggregate.allParetoFrontiersRetained,
			skippedBzip2Evaluations: aggregate.skippedBzip2Evaluations,
			fullTaskAllocations: aggregate.fullTaskAllocations,
			cascadeTaskAllocations: aggregate.cascadeTaskAllocations,
		},
		{
			trajectoryCount: replay.summary.trajectoryCount,
			allParetoFrontiersRetained: replay.gate.allTrajectoryFrontiersRetained,
			skippedBzip2Evaluations: replay.summary.omittedCandidateCount,
			fullTaskAllocations: replay.summary.candidateCount * 2,
			cascadeTaskAllocations: replay.summary.candidateCount + replay.summary.selectedCandidateCount,
		},
		"sealed replay aggregate allocation projection",
	);
	for (const [field, expectedMicros] of [
		["fullEvaluatorMs", replay.summary.totalEvaluatorRuntimeMicros],
		["cascadeEvaluatorMs", replay.summary.retainedEvaluatorRuntimeMicros],
		["evaluatorTimeSavedMs", replay.summary.omittedBzip2EvaluatorRuntimeMicros],
	] as const) {
		const milliseconds = aggregate[field];
		if (typeof milliseconds !== "number" || Math.round(milliseconds * 1_000).toString(10) !== expectedMicros) {
			throw new Error(`Sealed replay aggregate ${field} differs from the recomputed replay`);
		}
	}

	const candidateSet = sealedRecord(
		sealed.modelFreeQualificationCandidateSet,
		"sealed replay modelFreeQualificationCandidateSet",
	);
	if (candidateSet.classification !== "known-happy-path-apparatus-only") {
		throw new Error("Sealed replay qualification classification drifted");
	}
	if (
		candidateSet.selection !==
		"ascii-lexicographically-first-agent-trajectory-with-four-unique-candidate-digests-and-four-distinct-blowfish-ir-values"
	) {
		throw new Error("Sealed replay qualification selector drifted");
	}
	assertCanonicalEqual(
		candidateSet.selectionInputs,
		COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS.historicalBatchChoice.allowedInputs,
		"sealed replay historical selection inputs",
	);
	assertCanonicalEqual(
		candidateSet.forbiddenSelectionInputs,
		COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS.historicalBatchChoice.forbiddenInputs,
		"sealed replay historical forbidden selection inputs",
	);
	const eligiblePaths = projectCompilerGymProxyCascadeReplay(replay)
		.filter((trajectory) => trajectory.eligibleForUntiedQualification)
		.map((trajectory) => trajectory.path)
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
	assertCanonicalEqual(candidateSet.eligibleLedgerPaths, eligiblePaths, "sealed replay eligible trajectory paths");
	if (candidateSet.selectedLedgerPath !== selected.path) {
		throw new Error("Sealed replay selected trajectory differs from the restricted replay selector");
	}
	const sealedCandidateValues = sealedArray(candidateSet.candidates, "sealed replay qualification candidates");
	const sealedCandidateProjection = sealedCandidateValues.map((value, index) => {
		const candidate = sealedRecord(value, `sealed replay qualification candidates[${index}]`);
		return {
			ordinal: candidate.ordinal,
			candidateSha256: candidate.candidateDigest,
			candidateByteLength: candidate.candidateByteLength,
			candidateActionCount: candidate.candidateActionCount,
			blowfishIrInstructionCount: candidate.historicalBlowfishIr,
		};
	});
	const recomputedCandidateProjection = input.candidates.map((candidate) => ({
		ordinal: candidate.ordinal,
		candidateSha256: candidate.artifactSha256,
		candidateByteLength: candidate.artifactByteLength,
		candidateActionCount: candidate.actions.length,
		blowfishIrInstructionCount: candidate.expectedMetrics.blowfish.irInstructionCount,
	}));
	assertCanonicalEqual(
		sealedCandidateProjection,
		recomputedCandidateProjection,
		"sealed replay qualification candidate projection",
	);
	assertCanonicalEqual(
		candidateSet.historicalSelectedOrdinals,
		selected.selectedOrdinals,
		"sealed replay qualification selected ordinals",
	);
}

export function assertCompilerGymProxyCascadeBudgetAlgebra(
	budgets: CompilerGymProxyCascadeBudgets,
	phasePlan?: CompilerGymProxyCascadePhasePlan,
): void {
	const actualFromPhases =
		budgets.proxyBlowfishAllocations + budgets.selectedBzip2Allocations + budgets.omittedBzip2AuditAllocations;
	const counterfactualFromPhases = budgets.proxyBlowfishAllocations + budgets.selectedBzip2Allocations;
	const reduction = budgets.actualFreshOneTaskAllocations - budgets.counterfactualCascadeAllocations;
	if (
		budgets.actualFreshOneTaskAllocations !== actualFromPhases ||
		budgets.counterfactualCascadeAllocations !== counterfactualFromPhases ||
		budgets.counterfactualAllocationReductionNumerator !== reduction ||
		budgets.counterfactualAllocationReductionDenominator !== budgets.actualFreshOneTaskAllocations ||
		budgets.counterfactualAllocationReductionNumerator * 4 !== budgets.counterfactualAllocationReductionDenominator ||
		budgets.allocationSavingBasis !== "allocation-count-only-not-time-or-cpu" ||
		budgets.allocationWallMinutesMaximum !==
			budgets.actualFreshOneTaskAllocations * budgets.wallMinutesPerAllocationMaximum ||
		budgets.requestedTaskCpuMinutesMaximum !==
			budgets.allocationWallMinutesMaximum * budgets.requestedCpusPerAllocation ||
		budgets.schedulerLogicalCpuMinutesMaximum !==
			budgets.allocationWallMinutesMaximum * budgets.schedulerLogicalCpusPerAllocationMaximum
	) {
		throw new Error("Proxy-cascade budget algebra drifted");
	}
	if (
		phasePlan &&
		(phasePlan.phaseCounts.proxyBlowfish !== budgets.proxyBlowfishAllocations ||
			phasePlan.phaseCounts.selectedBzip2 !== budgets.selectedBzip2Allocations ||
			phasePlan.phaseCounts.omittedBzip2Audit !== budgets.omittedBzip2AuditAllocations ||
			phasePlan.phaseCounts.total !== budgets.actualFreshOneTaskAllocations ||
			phasePlan.counterfactualCascadeAllocationCount !== budgets.counterfactualCascadeAllocations ||
			phasePlan.actualQualificationAllocationCount !== budgets.actualFreshOneTaskAllocations)
	) {
		throw new Error("Proxy-cascade phase plan and budget algebra differ");
	}
}

function scientificIdentity(input: {
	replay: CompilerGymProxyCascadeReplayResult;
	selected: CompilerGymProxyCascadeSelectedTrajectory;
	candidates: readonly CompilerGymProxyCascadeCandidateSource[];
	phasePlan: CompilerGymProxyCascadePhasePlan;
	implementationBundleSha256: string;
}): string {
	return sha256Json({
		experimentId: COMPILER_GYM_PROXY_CASCADE_EXPERIMENT_ID,
		screenProtocol: COMPILER_GYM_PROXY_CASCADE_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
		analysisArtifacts: COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS,
		replayInputManifestSha256: sha256Json(input.replay.inputManifest),
		replayResultSha256: sha256Json(input.replay),
		selectedTrajectory: {
			selectionMethod: input.selected.selectionMethod,
			path: input.selected.path,
			ledgerSha256: input.selected.ledgerSha256,
			terminalEventHash: input.selected.terminalEventHash,
			restrictedProjectionSha256: input.selected.restrictedProjectionSha256,
			selectedOrdinals: input.selected.selectedOrdinals,
			omittedOrdinals: input.selected.omittedOrdinals,
		},
		candidateSources: input.candidates,
		phasePlan: input.phasePlan,
		tasks: COMPILER_GYM_PROXY_CASCADE_TASKS,
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		canonicalEvaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
		irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		irDeltaSourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
		environmentSha256: sha256Json(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
		adapterOutputProtocol: COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
		accountingRowsProtocol: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
		governance: {
			question: COMPILER_GYM_PROXY_CASCADE_QUESTION,
			hypothesis: COMPILER_GYM_PROXY_CASCADE_HYPOTHESIS,
			classification: "model-free-happy-path-wiring-qualification-only",
			claimLimits: COMPILER_GYM_PROXY_CASCADE_CLAIM_LIMITS,
			selectionContracts: COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS,
			freshMeasurementRules: COMPILER_GYM_PROXY_CASCADE_FRESH_MEASUREMENT_RULES,
			isolation: COMPILER_GYM_PROXY_CASCADE_ISOLATION,
			phaseSealSchema: COMPILER_GYM_PROXY_CASCADE_PHASE_SEAL_SCHEMA,
			lockSchema: COMPILER_GYM_PROXY_CASCADE_LOCK_SCHEMA,
			accounting: COMPILER_GYM_PROXY_CASCADE_ACCOUNTING,
			budgets: COMPILER_GYM_PROXY_CASCADE_BUDGETS,
			stopPolicy: COMPILER_GYM_PROXY_CASCADE_STOP_POLICY,
			decisionPolicy: COMPILER_GYM_PROXY_CASCADE_DECISION_POLICY,
		},
		implementationBundleSha256: input.implementationBundleSha256,
	});
}

function remoteLocks(identity: string): CompilerGymProxyCascadePreregistration["remoteLocks"] {
	const parentRoot = `${DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT.remoteSourceRoot}/proxy-cascade-locks`;
	const root = `${parentRoot}/${identity.slice(0, 32)}`;
	return {
		scientificIdentitySha256: identity,
		parentRoot,
		root,
		globalPath: `${root}/global.lock`,
		selectionPath: `${root}/selection.lock`,
		cascadePath: `${root}/cascade.lock`,
		auditPath: `${root}/audit.lock`,
		createOnly: COMPILER_GYM_PROXY_CASCADE_LOCK_SCHEMA.remote.createOnly,
		mode: COMPILER_GYM_PROXY_CASCADE_LOCK_SCHEMA.remote.mode,
		writeFsyncCloseReadbackExact: COMPILER_GYM_PROXY_CASCADE_LOCK_SCHEMA.remote.writeFsyncCloseReadbackExact,
		neverRemovedByRunner: COMPILER_GYM_PROXY_CASCADE_LOCK_SCHEMA.remote.neverRemovedByRunner,
	};
}

export function buildCompilerGymProxyCascadePreregistration(
	input: CompilerGymProxyCascadePreregistrationBuildInput,
): CompilerGymProxyCascadePreregistration {
	validateCreatedAt(input.createdAt);
	const repoRoot = resolve(input.repoRoot);
	const preregistrationPath = resolve(input.preregistrationPath);
	const outputDir = resolve(input.outputDir);
	assertCompilerGymProxyCascadeLaunchPaths(repoRoot, preregistrationPath, outputDir);
	validateFrozenFile(input.latencyConfigContents, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyConfig);
	validateFrozenFile(
		input.latencyResultManifestContents,
		COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyResultManifest,
	);
	const sealedReplay = validateSealedReplayArtifacts(
		input.sealedReplayResultContents,
		input.sealedReplayDigestManifestContents,
	);
	validateFrozenFile(input.authoritativeEvaluatorContents, {
		path: "research/autoresearch/evaluators/compiler_gym_eval.py",
		sha256: COMPILER_GYM_EVALUATOR_SHA256,
	});
	validateFrozenFile(input.irDeltaEvaluatorContents, {
		path: "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
		sha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	});
	const replay = replayCompilerGymProxyCascade(input.replaySources);
	const selected = selectCompilerGymProxyCascadeTrajectory(replay);
	const candidateSources = validateCandidateSources({
		selected,
		candidateArtifacts: input.candidateArtifacts,
		authoritativeEvaluatorContents: input.authoritativeEvaluatorContents,
	});
	const phasePlan = buildCompilerGymProxyCascadePhasePlan(selected);
	assertCompilerGymProxyCascadeBudgetAlgebra(COMPILER_GYM_PROXY_CASCADE_BUDGETS, phasePlan);
	validateSealedReplaySemanticJoin({ sealed: sealedReplay, replay, selected, candidates: candidateSources });
	const implementationClosure = validateImplementationClosure(input.implementationClosure);
	const implementationBundleSha256 = sha256Json(implementationClosure);
	const identity = scientificIdentity({
		replay,
		selected,
		candidates: candidateSources,
		phasePlan,
		implementationBundleSha256,
	});
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_PROXY_CASCADE_PREREGISTRATION_PROTOCOL,
		experimentId: COMPILER_GYM_PROXY_CASCADE_EXPERIMENT_ID,
		screenProtocol: COMPILER_GYM_PROXY_CASCADE_PROTOCOL,
		runnerProtocol: COMPILER_GYM_PROXY_CASCADE_RUNNER_PROTOCOL,
		createdAt: input.createdAt,
		status: "preregistered-before-any-ssh-or-evaluator-dispatch",
		question: COMPILER_GYM_PROXY_CASCADE_QUESTION,
		hypothesis: COMPILER_GYM_PROXY_CASCADE_HYPOTHESIS,
		classification: "model-free-happy-path-wiring-qualification-only",
		claimLimits: structuredClone(COMPILER_GYM_PROXY_CASCADE_CLAIM_LIMITS),
		historicalReplay: {
			analysisArtifacts: structuredClone(COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS),
			inputManifestSha256: sha256Json(replay.inputManifest),
			result: replay,
			resultSha256: sha256Json(replay),
			gateRecomputedDuringPreregistration: true,
			measurementsReusedForQualification: false,
		},
		selectedTrajectory: {
			selectionMethod: selected.selectionMethod,
			path: selected.path,
			ledgerSha256: selected.ledgerSha256,
			terminalEventHash: selected.terminalEventHash,
			restrictedProjectionSha256: selected.restrictedProjectionSha256,
			selectedOrdinals: [...selected.selectedOrdinals],
			omittedOrdinals: [...selected.omittedOrdinals],
			selectionContracts: structuredClone(COMPILER_GYM_PROXY_CASCADE_SELECTION_CONTRACTS),
		},
		candidateSources,
		candidateBundleSha256: sha256Json(candidateSources),
		frozenCommon: {
			tasks: COMPILER_GYM_PROXY_CASCADE_TASKS,
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			canonicalEvaluator: {
				path: "research/autoresearch/evaluators/compiler_gym_eval.py",
				sha256: COMPILER_GYM_EVALUATOR_SHA256,
			},
			irDeltaEvaluator: {
				path: "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
				sha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			},
			irDeltaSourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
			environmentSha256: sha256Json(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
			adapterOutputProtocol: COMPILER_GYM_CANONICAL_ONE_TASK_ADAPTER_OUTPUT_PROTOCOL,
			accountingRowsProtocol: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
			...structuredClone(COMPILER_GYM_PROXY_CASCADE_FRESH_MEASUREMENT_RULES),
		},
		isolation: structuredClone(COMPILER_GYM_PROXY_CASCADE_ISOLATION),
		phasePlan,
		phaseSeals: {
			localSealWrite: COMPILER_GYM_PROXY_CASCADE_PHASE_SEAL_SCHEMA.localSealWrite,
			selection: {
				localPath: resolve(outputDir, "seals/selection.json"),
				...structuredClone(COMPILER_GYM_PROXY_CASCADE_PHASE_SEAL_SCHEMA.selection),
			},
			cascade: {
				localPath: resolve(outputDir, "seals/cascade.json"),
				...structuredClone(COMPILER_GYM_PROXY_CASCADE_PHASE_SEAL_SCHEMA.cascade),
			},
			audit: {
				localPath: resolve(outputDir, "seals/audit.json"),
				...structuredClone(COMPILER_GYM_PROXY_CASCADE_PHASE_SEAL_SCHEMA.audit),
			},
		},
		localAttemptLock: {
			path: resolve(
				homedir(),
				".local/state/prime-agent-autoresearch/attempt-locks",
				`proxy-cascade-${identity}.lock`,
			),
			...structuredClone(COMPILER_GYM_PROXY_CASCADE_LOCK_SCHEMA.localAttempt),
		},
		remoteLocks: remoteLocks(identity),
		accounting: structuredClone(COMPILER_GYM_PROXY_CASCADE_ACCOUNTING),
		budgets: structuredClone(COMPILER_GYM_PROXY_CASCADE_BUDGETS),
		stopPolicy: structuredClone(COMPILER_GYM_PROXY_CASCADE_STOP_POLICY),
		decisionPolicy: structuredClone(COMPILER_GYM_PROXY_CASCADE_DECISION_POLICY),
		launchPaths: { repoRoot, preregistrationPath, outputDir },
		implementationClosure,
		implementationBundleSha256,
		scientificIdentitySha256: identity,
	};
}

export function parseCompilerGymProxyCascadePreregistration(input: {
	value: unknown;
	expected: CompilerGymProxyCascadePreregistrationBuildInput;
}): CompilerGymProxyCascadePreregistration {
	if (typeof input.value !== "object" || input.value === null || Array.isArray(input.value)) {
		throw new Error("Proxy-cascade preregistration must be an object");
	}
	const expected = buildCompilerGymProxyCascadePreregistration(input.expected);
	assert.deepEqual(input.value, expected, "Proxy-cascade preregistration differs from its reconstructed protocol");
	return expected;
}

async function readPinnedRegularUtf8(
	absolutePath: string,
	requiredMode?: number,
): Promise<{ contents: string; mode: number; isFile: true; isSymbolicLink: false }> {
	const pathMetadata = await lstat(absolutePath);
	if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
		throw new Error(`Proxy-cascade source is not a regular non-symlink file: ${absolutePath}`);
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
			throw new Error(`Proxy-cascade source metadata changed before its pinned read: ${absolutePath}`);
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
			throw new Error(`Proxy-cascade source changed during its pinned read: ${absolutePath}`);
		}
		return {
			contents,
			mode: before.mode,
			isFile: true,
			isSymbolicLink: false,
		};
	} finally {
		await handle.close();
	}
}

export async function collectCompilerGymProxyCascadeImplementationClosure(
	repoRoot: string,
): Promise<CompilerGymProxyCascadeSourceRecord[]> {
	const root = resolve(repoRoot);
	const queued: string[] = [...COMPILER_GYM_PROXY_CASCADE_IMPLEMENTATION_ENTRYPOINTS];
	const discovered = new Map<string, string>();
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
					throw new Error(`Proxy-cascade local import escapes the repository: ${specifier}`);
				}
				return path;
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
				throw error;
			}
		}
		throw new Error(`Proxy-cascade static import could not be resolved: ${fromPath} -> ${specifier}`);
	};
	while (queued.length > 0) {
		const relativePath = queued.pop();
		if (!relativePath || discovered.has(relativePath)) continue;
		const { contents } = await readPinnedRegularUtf8(resolve(root, relativePath));
		discovered.set(relativePath, sha256Text(contents));
		if (relativePath.endsWith(".ts")) {
			for (const match of contents.matchAll(staticImportPattern)) {
				const specifier = match[1];
				if (!specifier) continue;
				const imported = await resolveLocalImport(relativePath, specifier);
				if (!discovered.has(imported)) queued.push(imported);
			}
		}
	}
	return [...discovered.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([relativePath, sha256]) => ({ relativePath, sha256 }));
}

export async function collectCompilerGymProxyCascadeReplaySources(
	repoRoot: string,
): Promise<CompilerGymProxyCascadeReplayLedgerSource[]> {
	const root = resolve(repoRoot, ".autoresearch");
	return Promise.all(
		COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES.map(async (source) => {
			const { contents } = await readPinnedRegularUtf8(resolve(root, source.path));
			return { path: source.path, contents };
		}),
	);
}

export async function collectCompilerGymProxyCascadeCandidateArtifacts(input: {
	repoRoot: string;
	selected: CompilerGymProxyCascadeSelectedTrajectory;
}): Promise<CompilerGymProxyCascadeCandidateArtifactInput[]> {
	return Promise.all(
		input.selected.candidates.map(async (candidate) => {
			const relativePath = expectedCandidateArtifactPath(input.selected, candidate.candidateSha256);
			const absolutePath = resolve(input.repoRoot, relativePath);
			const artifact = await readPinnedRegularUtf8(absolutePath, 0o600);
			return {
				ordinal: candidate.ordinal,
				relativePath,
				...artifact,
			};
		}),
	);
}

export function canonicalCompilerGymProxyCascadePreregistration(value: CompilerGymProxyCascadePreregistration): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

export async function writeCompilerGymProxyCascadePreregistration(input: {
	repoRoot: string;
	path: string;
	outputDir?: string;
	createdAt?: string;
}): Promise<{ path: string; sha256: string; record: CompilerGymProxyCascadePreregistration }> {
	const repoRoot = resolve(input.repoRoot);
	const path = resolve(input.path);
	const outputDir = resolve(input.outputDir ?? resolve(dirname(path), "execution"));
	assertCompilerGymProxyCascadeLaunchPaths(repoRoot, path, outputDir);
	try {
		await stat(outputDir);
		throw new Error("Proxy-cascade output directory must be absent when preregistering");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const [
		replaySources,
		latencyConfigContents,
		latencyResultManifestContents,
		sealedReplayResultContents,
		sealedReplayDigestManifestContents,
		authoritativeEvaluatorContents,
		irDeltaEvaluatorContents,
		implementationClosure,
	] = await Promise.all([
		collectCompilerGymProxyCascadeReplaySources(repoRoot),
		readPinnedRegularUtf8(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyConfig.path),
		).then(({ contents }) => contents),
		readPinnedRegularUtf8(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.latencyResultManifest.path),
		).then(({ contents }) => contents),
		readPinnedRegularUtf8(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayResult.path),
		).then(({ contents }) => contents),
		readPinnedRegularUtf8(
			resolve(repoRoot, COMPILER_GYM_PROXY_CASCADE_FROZEN_ANALYSIS_ARTIFACTS.sealedReplayDigestManifest.path),
		).then(({ contents }) => contents),
		readPinnedRegularUtf8(resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py")).then(
			({ contents }) => contents,
		),
		readPinnedRegularUtf8(resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py")).then(
			({ contents }) => contents,
		),
		collectCompilerGymProxyCascadeImplementationClosure(repoRoot),
	]);
	const replay = replayCompilerGymProxyCascade(replaySources);
	const selected = selectCompilerGymProxyCascadeTrajectory(replay);
	const candidateArtifacts = await collectCompilerGymProxyCascadeCandidateArtifacts({ repoRoot, selected });
	const record = buildCompilerGymProxyCascadePreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		repoRoot,
		preregistrationPath: path,
		outputDir,
		replaySources,
		latencyConfigContents,
		latencyResultManifestContents,
		sealedReplayResultContents,
		sealedReplayDigestManifestContents,
		authoritativeEvaluatorContents,
		irDeltaEvaluatorContents,
		candidateArtifacts,
		implementationClosure,
	});
	const contents = canonicalCompilerGymProxyCascadePreregistration(record);
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
		throw new Error("Proxy-cascade preregistration is not a private regular file");
	}
	return { path, sha256: sha256Text(contents), record };
}

export function expectedCompilerGymProxyCascadeSelectedMetricAnchors(): Array<{
	ordinal: number;
	blowfishIr: number;
	blowfishObjectTextSizeBytes: number;
	bzip2Ir: number;
	bzip2ObjectTextSizeBytes: number;
}> {
	return [
		{
			ordinal: 1,
			blowfishIr: 2_091,
			blowfishObjectTextSizeBytes: 11_711,
			bzip2Ir: 16_422,
			bzip2ObjectTextSizeBytes: 159_733,
		},
		{
			ordinal: 2,
			blowfishIr: 1_970,
			blowfishObjectTextSizeBytes: 13_176,
			bzip2Ir: 13_804,
			bzip2ObjectTextSizeBytes: 166_266,
		},
		{
			ordinal: 3,
			blowfishIr: 1_958,
			blowfishObjectTextSizeBytes: 21_408,
			bzip2Ir: 13_802,
			bzip2ObjectTextSizeBytes: 166_330,
		},
		{
			ordinal: 4,
			blowfishIr: 1_980,
			blowfishObjectTextSizeBytes: 22_869,
			bzip2Ir: 14_192,
			bzip2ObjectTextSizeBytes: 172_351,
		},
	];
}

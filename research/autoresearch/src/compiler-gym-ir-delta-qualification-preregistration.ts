import { execFile } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_ACTION_TRACE_BENCHMARKS,
	COMPILER_GYM_ACTION_TRACE_CANDIDATES,
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT,
	COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE,
	COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
} from "./compiler-gym-action-trace-preregistration.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_RATIO_LIMIT,
	COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
	COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL,
	type CompilerGymIrDeltaQualificationCaseId,
} from "./compiler-gym-ir-delta-qualification-protocol.js";
import {
	COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256,
	COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
} from "./compiler-gym-ir-delta-smoke-preregistration.js";
import {
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "./compiler-gym-ir-delta-smoke-protocol.js";
import { COMPILER_GYM_WARM_LAUNCH_CONTRACT } from "./compiler-gym-warm-transport.js";
import { verifyLedgerContentsStrict } from "./ledger.js";

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREGISTRATION_PROTOCOL =
	"compiler-gym-one-env-ir-delta-qualification-preregistration-v1" as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_ID = "stock-cold-one-env-ir-delta-qualification-v1" as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256 =
	"8faef0a05667ad84e0695fb91e782659217bcc9703153b9eec546c2617903a97" as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_CLAIM =
	"Across S12/L46 and blowfish/bzip2, a fresh one-environment IR-delta evaluator preserves the canonical terminal verifier and exact metrics while keeping median paired intrinsic-total overhead at or below 1.15, every paired ratio at or below 1.25, and its native-rendered model-visible projection within 25% and 2500 incremental bytes." as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_FORBIDDEN_MECHANISMS = [
	"provider-request",
	"model-call",
	"held-root-allocation",
	"job-step",
	"allocation-reuse",
	"warm-worker",
	"retry",
	"replacement",
	"smoke-measurement-reuse",
] as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_DENOMINATOR =
	"For each candidate, reconstruct the full stock evaluation control envelope only from the one-env-ir-delta treatment outputs while keeping the host trace hidden. Render that treatment-derived control through the native IPython path, then render the byte-identical envelope plus exactly one irDeltaTrace field. Incremental bytes are combined-treatment rendered UTF-8 bytes minus control rendered UTF-8 bytes. The one-env-ir-delta timings_seconds.total remains indivisible; no trace or renderer timing is measured or subtracted separately." as const;

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_PROTOCOL =
	"prime-native-ipython-ir-delta-synthetic-preflight-v1" as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL = {
	type: "compiler_gym_ir_delta_renderer_preflight",
	protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_PROTOCOL,
	candidateId: "synthetic-renderer-fixture",
	status: "apparatus-only",
} as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TRACE = {
	type: "compiler_gym_ir_delta_feedback",
	protocol: COMPILER_GYM_IR_DELTA_TREATMENT_ENVELOPE_PROTOCOL,
	candidateId: "synthetic-renderer-fixture",
	candidateSha256: "0000000000000000000000000000000000000000000000000000000000000000",
	prefixConditional: true,
	intermediateSemanticStatus: "unverified",
	terminalSemanticStatus: "canonical-20-input-verifier",
	zeroDeltaSemantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
	tasks: [
		{
			benchmarkId: "benchmark://synthetic/renderer-preflight",
			trace: { initialIrInstructionCount: 2, irDeltas: [0, -1] },
		},
	],
} as const;
export const COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT = {
	...COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL,
	irDeltaTrace: COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TRACE,
} as const;

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_TERMINAL_TAXONOMY = {
	executionExitClassification: {
		canonicalOrVerifierPassingTreatment: {
			evaluatorExitCode: 0,
			srunExitCode: 0,
			accountingState: "COMPLETED",
			accountingExitCode: "0:0",
		},
		completeTreatmentSemanticRejection: {
			evaluatorStatus: "semantic_validation_failed",
			evaluatorExitCode: 5,
			srunExitCode: 5,
			accountingState: "FAILED",
			accountingExitCode: "5:0",
			verifierInputsExpected: 20,
			verifierInputsCompleted: 20,
			disposition: "terminal-complete-scientific-kill",
		},
		incompleteTreatmentValidation: {
			evaluatorStatus: "validation_incomplete",
			evaluatorExitCode: 4,
			disposition: "terminal-apparatus-invalid-not-treatment-result",
		},
		allOtherNonzeroOrPairingDrift: "terminal-apparatus-invalid-not-treatment-result",
	} as const,
	apparatusInvalid: {
		disposition: "terminal-apparatus-invalid-not-treatment-result",
		conditions: [
			"canonical-accepted-metric-drift",
			"canonical-verifier-nonpass",
			"canonical-incomplete-verification",
			"treatment-malformed-output",
			"treatment-transport-failure",
			"treatment-incomplete-verification",
			"environment-or-probe-drift",
			"accounting-invalid",
			"source-or-prerequisite-evidence-drift",
			"renderer-preflight-failure",
			"renderer-runtime-failure",
			"incomplete-allocation-set",
		],
		assessmentAllowed: false,
	} as const,
	scientificKill: {
		disposition: "terminal-complete-scientific-kill",
		decision: "kill-ir-delta-trace",
		conditions: [
			"treatment-verifier-passed-terminal-equivalence-drift",
			"treatment-complete-20-of-20-semantic-rejection",
			"treatment-trace-integrity-defect",
			"overhead-gate-failure",
			"projection-gate-failure",
		],
		assessmentAllowed: true,
	} as const,
	scientificPass: {
		disposition: "terminal-complete-scientific-pass",
		decision: "qualify-agent-facing-ir-delta-screen",
		nextGate: "separately-preregistered-paid-agent-screen",
		assessmentAllowed: true,
		lunaAuthorizedByThisGate: false,
	} as const,
} as const;

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE = {
	smoke: {
		preregistration: {
			path: ".autoresearch/compiler-gym-ir-delta-smoke/2026-08-28-v1/preregistration.json",
			sha256: "a2b6ff3136e4d88217871d57bb65f7b1c6b526ea0fe89a54e73e4600ea9da3be",
		},
		result: {
			path: ".autoresearch/compiler-gym-ir-delta-smoke/2026-08-28-v1/execution/result.json",
			sha256: "4d750e7fcafa7b3f8a03f8779c7649d539773fbfa1a830f06d5fac7bc4286237",
		},
		ledger: {
			path: ".autoresearch/compiler-gym-ir-delta-smoke/2026-08-28-v1/execution/evidence.jsonl",
			sha256: "a180f587d458529557e5d8900e875a5b1ab07e18bf307ff0c8cb5c60966cdf98",
		},
		assessmentEventSha256: "5413307231bfe52693acb8d41fd07518e49de1afc5347d43ad2f85fb7e6646d6",
		terminalEventSha256: "bdb92415ae188e2864161982d0d6c68fce911abe30d0c42c17d9874cabb7abff",
		terminalPhase: "complete",
		resultAdmission: "requires-terminal-complete-ledger-event",
		decision: "promote-to-full-ir-delta-qualification",
		nextGate: "eight-fresh-allocation-model-free-ir-delta-qualification",
		smokeMeasurementsUsed: false,
		formalMeasurementsReused: false,
	},
	v3NonAdmission: {
		preregistration: {
			path: ".autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v3/preregistration.json",
			sha256: "a4956d205b7b0ec548e289958bf15a7c290de1c3ba7723b14d31ca42a56609ca",
		},
		ledger: {
			path: ".autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v3/execution/evidence.jsonl",
			sha256: "5b97f945005709276459eb9f344a3f63ce315d599fad3bb4642a6710d2d9f688",
		},
		terminalEventSha256: "dc234491b5419675154d337d420ebf859292b830db3a277385b3eb4725d09ed2",
		terminalPhase: "failed",
		resultPath: ".autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v3/execution/result.json",
		resultAbsent: true,
		terminalDisposition: "terminal-infrastructure-invalid-not-treatment-result",
		measurementsAdmitted: false,
	},
} as const;

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_ARMS = ["canonical", "one-env-ir-delta"] as const;
export type CompilerGymIrDeltaQualificationArm = (typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_ARMS)[number];

export interface CompilerGymIrDeltaQualificationExecutionSpec {
	allocationOrdinal: number;
	caseId: CompilerGymIrDeltaQualificationCaseId;
	candidateId: "S12" | "L46";
	benchmarkId: "benchmark://cbench-v1/blowfish" | "benchmark://cbench-v1/bzip2";
	arm: CompilerGymIrDeltaQualificationArm;
}

function pair(
	caseId: CompilerGymIrDeltaQualificationCaseId,
	candidateId: "S12" | "L46",
	benchmarkId: CompilerGymIrDeltaQualificationExecutionSpec["benchmarkId"],
	arms: readonly [CompilerGymIrDeltaQualificationArm, CompilerGymIrDeltaQualificationArm],
): Omit<CompilerGymIrDeltaQualificationExecutionSpec, "allocationOrdinal">[] {
	return arms.map((arm) => ({ caseId, candidateId, benchmarkId, arm }));
}

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN: readonly CompilerGymIrDeltaQualificationExecutionSpec[] =
	[
		...pair("S12-blowfish", "S12", "benchmark://cbench-v1/blowfish", ["canonical", "one-env-ir-delta"]),
		...pair("S12-bzip2", "S12", "benchmark://cbench-v1/bzip2", ["one-env-ir-delta", "canonical"]),
		...pair("L46-bzip2", "L46", "benchmark://cbench-v1/bzip2", ["canonical", "one-env-ir-delta"]),
		...pair("L46-blowfish", "L46", "benchmark://cbench-v1/blowfish", ["one-env-ir-delta", "canonical"]),
	].map((item, index) => ({ ...item, allocationOrdinal: index + 1 }));

export interface CompilerGymIrDeltaQualificationEnvironment {
	host: string;
	partition: string;
	cpuConstraint: string;
	pythonPath: string;
	remoteSourceRoot: string;
	compilerGymCache: string;
	compilerGymSiteData: string;
	compatibilityLibraryDir: string;
	pythonWarnings: string;
	timeLimit: "00:05:00";
	memory: string;
	cpusPerTask: 2;
	acceptedRootAllocCpus: [2, 4];
}

export const DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT: CompilerGymIrDeltaQualificationEnvironment = {
	host: COMPILER_GYM_WARM_LAUNCH_CONTRACT.clusterHost,
	partition: COMPILER_GYM_WARM_LAUNCH_CONTRACT.partition,
	cpuConstraint: COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpuConstraint,
	pythonPath: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
	remoteSourceRoot: "/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-ir-delta-qualification-v1/sources",
	compilerGymCache: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache,
	compilerGymSiteData: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData,
	compatibilityLibraryDir: COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath,
	pythonWarnings: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonWarnings,
	timeLimit: "00:05:00",
	memory: COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory,
	cpusPerTask: 2,
	acceptedRootAllocCpus: [2, 4],
};

export const COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS = [
	"research/autoresearch/src/compiler-gym-ir-delta-qualification-preregistration.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-qualification-protocol.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-qualification-runner.ts",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
	"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-preregistration.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-protocol.ts",
	"research/autoresearch/src/compiler-gym-action-trace-preregistration.ts",
	"research/autoresearch/src/compiler-gym-action-trace-protocol.ts",
	"research/autoresearch/src/compiler-gym-action-trace-qualification-runner.ts",
	"research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
	"research/autoresearch/src/compiler-gym-warm-transport.ts",
	"research/autoresearch/src/compiler-gym-adapter.ts",
	"research/autoresearch/src/artifact-store.ts",
	"research/autoresearch/src/canonical-json.ts",
	"research/autoresearch/src/ledger.ts",
	"research/autoresearch/src/campaign.ts",
	"research/autoresearch/src/stock-cpu-evaluation-envelope.ts",
	"research/autoresearch/src/stock-cpu-eval.ts",
	"research/autoresearch/src/stock-cpu-protocol.ts",
	"research/autoresearch/src/types.ts",
	"packages/coding-agent/src/core/tools/ipython.ts",
	"packages/coding-agent/src/core/kernel/boot-gate.ts",
	"packages/coding-agent/src/core/kernel/bootstrap.ts",
	"packages/coding-agent/src/core/kernel/index.ts",
	"packages/coding-agent/src/core/kernel/repl-manager.ts",
	"packages/coding-agent/src/core/kernel/shared.ts",
	"packages/coding-agent/src/core/kernel/state-snapshot.ts",
	"packages/coding-agent/src/core/orphan-process-journal.ts",
	"packages/coding-agent/src/core/session-lease.ts",
	"packages/coding-agent/src/core/tools/tool-definition-wrapper.ts",
	"packages/coding-agent/src/config.ts",
	"packages/coding-agent/src/utils/child-process.ts",
	"packages/coding-agent/src/utils/daemon-socket-path.ts",
	"packages/coding-agent/src/utils/mime.ts",
	"packages/coding-agent/src/utils/semaphore.ts",
	"packages/coding-agent/src/utils/shell.ts",
	"packages/coding-agent/package.json",
	"prime-agent-runtime/src/rlm/__init__.py",
	"prime-agent-runtime/src/rlm/_winjob.py",
	"prime-agent-runtime/src/rlm/bash.py",
	"prime-agent-runtime/src/rlm/harness.py",
	"prime-agent-runtime/src/rlm/mcp.py",
	"prime-agent-runtime/src/rlm/mcp_base.py",
	"prime-agent-runtime/src/rlm/repl.py",
	"prime-agent-runtime/src/rlm/skill.py",
	"prime-agent-runtime/pyproject.toml",
	"prime-agent-runtime/uv.lock",
	"package.json",
	"package-lock.json",
] as const;

export interface CompilerGymIrDeltaQualificationImplementationSource {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymIrDeltaQualificationPreregistration {
	protocol: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREGISTRATION_PROTOCOL;
	qualificationId: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_ID;
	status: "pre-dispatch";
	createdAt: string;
	primeAgentCommit: string;
	claim: string;
	design: {
		modelCalls: 0;
		measurementReuse: false;
		smokeMeasurementsUsed: false;
		formalMeasurementsReused: false;
		causalTreatmentClaimAllowed: false;
		lunaAuthorized: false;
		allocationCount: 8;
		caseCount: 4;
		dispatchAttempts: 1;
		allocationRetries: 0;
		replacementAllocations: 0;
		transport: "independent-stock-cold-ssh-srun";
		apparatusFailureDisposition: "terminal-apparatus-invalid-not-treatment-result";
		forbiddenMechanisms: string[];
	};
	prerequisiteEvidence: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE;
	environment: CompilerGymIrDeltaQualificationEnvironment;
	environmentProbe: {
		protocol: "compiler-gym-farmshare-environment-probe-v1";
		expectedResult: typeof COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT;
	};
	sources: {
		canonicalPath: string;
		canonicalSha256: typeof COMPILER_GYM_EVALUATOR_SHA256;
		treatmentPath: string;
		treatmentSha256: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256;
		environmentProbePath: string;
		environmentProbeSha256: typeof COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256;
		combinedSha256: string;
	};
	implementationClosure: CompilerGymIrDeltaQualificationImplementationSource[];
	renderer: {
		protocol: typeof COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL;
		cellTemplateSha256: string;
		projectionField: "irDeltaTrace";
		denominator: string;
		syntheticPreflight: {
			protocol: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_PROTOCOL;
			executionPhase: "before-any-ssh-or-srun";
			apparatusOnly: true;
			failureDisposition: "terminal-apparatus-invalid-not-treatment-result";
			controlJsonValue: string;
			controlJsonValueSha256: string;
			controlCellSha256: string;
			treatmentJsonValue: string;
			treatmentJsonValueSha256: string;
			treatmentCellSha256: string;
			requiredChecks: {
				singleJsonLineInputs: true;
				treatmentDiffersOnlyByProjectionField: true;
				forbiddenProjectionMetadataAbsent: true;
				exactNativeRendererProtocol: true;
				exactCellHashes: true;
				exactlyOneSuccessfulTextBlock: true;
				selfConsistentOutputHashesAndUtf8Bytes: true;
				nonemptyControl: true;
				positiveIncrement: true;
			};
		};
	};
	expectedVerifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
	trace: {
		evaluatorContract: typeof COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT;
		contract: typeof COMPILER_GYM_IR_DELTA_TRACE_CONTRACT;
		prefixConditional: true;
		intermediateSemanticStatus: "unverified";
		terminalSemanticStatus: "canonical-20-input-verifier";
		zeroDeltaSemantics: typeof COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS;
		forbiddenFields: ["action_had_no_effect", "no_effect_bits", "noEffectBits", "shadow_action_trace"];
	};
	candidates: Array<{
		candidateId: "S12" | "L46";
		actions: string[];
		actionCount: number;
		actionsSha256: string;
		expectedMetrics: Record<string, { irInstructionCount: number; objectTextSizeBytes: number }>;
		sourceEvidence: {
			ledgerPath: string;
			ledgerSha256: string;
			proposalEventSha256: string;
			measurementEventSha256: string;
			jobId: string;
			manifestDigest: string;
		};
	}>;
	benchmarks: string[];
	executionPlan: CompilerGymIrDeltaQualificationExecutionSpec[];
	assessment: {
		protocol: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL;
		medianOverheadLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT;
		perCaseOverheadLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT;
		projectionRatioLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_RATIO_LIMIT;
		projectionByteLimit: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT;
		qualifyDecision: "qualify-agent-facing-ir-delta-screen";
		killDecision: "kill-ir-delta-trace";
		nextGate: "separately-preregistered-paid-agent-screen";
		terminalTaxonomy: typeof COMPILER_GYM_IR_DELTA_QUALIFICATION_TERMINAL_TAXONOMY;
	};
}

export interface BuildCompilerGymIrDeltaQualificationPreregistrationInput {
	createdAt: string;
	primeAgentCommit: string;
	canonicalPath: string;
	canonicalSource: string;
	treatmentPath: string;
	treatmentSource: string;
	environmentProbePath: string;
	environmentProbeSource: string;
	implementationClosure: CompilerGymIrDeltaQualificationImplementationSource[];
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function nativeRendererCell(jsonValue: string): string {
	const cell = COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE.replace(
		"__CANONICAL_STDOUT_JSON__",
		JSON.stringify(jsonValue.trimEnd()),
	);
	if (cell.includes("__CANONICAL_STDOUT_JSON__")) {
		throw new Error("Native renderer preflight placeholder was not replaced exactly once");
	}
	return cell;
}

function rendererSyntheticPreflight(): CompilerGymIrDeltaQualificationPreregistration["renderer"]["syntheticPreflight"] {
	const controlJsonValue = `${JSON.stringify(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL)}\n`;
	const treatmentJsonValue = `${JSON.stringify(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT)}\n`;
	return {
		protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_PROTOCOL,
		executionPhase: "before-any-ssh-or-srun",
		apparatusOnly: true,
		failureDisposition: "terminal-apparatus-invalid-not-treatment-result",
		controlJsonValue,
		controlJsonValueSha256: sha256Text(controlJsonValue),
		controlCellSha256: sha256Text(nativeRendererCell(controlJsonValue)),
		treatmentJsonValue,
		treatmentJsonValueSha256: sha256Text(treatmentJsonValue),
		treatmentCellSha256: sha256Text(nativeRendererCell(treatmentJsonValue)),
		requiredChecks: {
			singleJsonLineInputs: true,
			treatmentDiffersOnlyByProjectionField: true,
			forbiddenProjectionMetadataAbsent: true,
			exactNativeRendererProtocol: true,
			exactCellHashes: true,
			exactlyOneSuccessfulTextBlock: true,
			selfConsistentOutputHashesAndUtf8Bytes: true,
			nonemptyControl: true,
			positiveIncrement: true,
		},
	};
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readPinnedEvidence(repoRoot: string, path: string, sha256: string): Promise<string> {
	const contents = await readFile(resolve(repoRoot, path), "utf8");
	if (sha256Text(contents) !== sha256) throw new Error(`Pinned evidence hash mismatch: ${path}`);
	return contents;
}

export async function verifyCompilerGymIrDeltaQualificationPrerequisiteEvidence(repoRoot: string): Promise<void> {
	const evidence = COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE;
	const [smokePreregistrationContents, smokeResultContents, smokeLedgerContents] = await Promise.all([
		readPinnedEvidence(repoRoot, evidence.smoke.preregistration.path, evidence.smoke.preregistration.sha256),
		readPinnedEvidence(repoRoot, evidence.smoke.result.path, evidence.smoke.result.sha256),
		readPinnedEvidence(repoRoot, evidence.smoke.ledger.path, evidence.smoke.ledger.sha256),
	]);
	const smokePreregistration = record(JSON.parse(smokePreregistrationContents) as unknown, "Smoke preregistration");
	if (smokePreregistration.status !== "pre-dispatch") throw new Error("Smoke preregistration is not pre-dispatch");
	const smokeResult = record(JSON.parse(smokeResultContents) as unknown, "Smoke result");
	const smokeAssessment = record(smokeResult.assessment, "Smoke result assessment");
	if (
		smokeResult.preregistrationSha256 !== evidence.smoke.preregistration.sha256 ||
		smokeResult.admission !== evidence.smoke.resultAdmission ||
		smokeResult.modelCalls !== 0 ||
		smokeResult.measurementReuse !== false ||
		smokeAssessment.decision !== evidence.smoke.decision ||
		smokeAssessment.nextGate !== evidence.smoke.nextGate ||
		smokeAssessment.lunaAuthorized !== false ||
		smokeAssessment.measurementReuseAllowed !== false
	) {
		throw new Error("Smoke result does not prove the frozen model-free promotion");
	}
	const smokeEvents = verifyLedgerContentsStrict(smokeLedgerContents);
	const assessmentEvent = smokeEvents.find((event) => event.hash === evidence.smoke.assessmentEventSha256);
	const terminalEvent = smokeEvents.at(-1);
	if (!assessmentEvent || assessmentEvent.kind !== "claim") {
		throw new Error("Smoke assessment event is absent from the strict ledger");
	}
	if (
		!terminalEvent ||
		terminalEvent.hash !== evidence.smoke.terminalEventSha256 ||
		terminalEvent.kind !== "run_manifest"
	) {
		throw new Error("Smoke terminal-complete event is not the strict-ledger terminus");
	}
	const assessmentPayload = record(assessmentEvent.payload, "Smoke assessment event payload");
	const terminalPayload = record(terminalEvent.payload, "Smoke terminal event payload");
	if (
		canonicalJson(toJsonValue(assessmentPayload.assessment)) !== canonicalJson(toJsonValue(smokeAssessment)) ||
		terminalEvent.previousHash !== assessmentEvent.hash ||
		terminalPayload.phase !== evidence.smoke.terminalPhase ||
		terminalPayload.decision !== evidence.smoke.decision ||
		terminalPayload.nextGate !== evidence.smoke.nextGate ||
		terminalPayload.resultSha256 !== evidence.smoke.result.sha256 ||
		terminalPayload.modelCalls !== 0 ||
		terminalPayload.measurementReuse !== false ||
		terminalPayload.lunaAuthorized !== false ||
		smokeResult.ledgerEventCount !== smokeEvents.length
	) {
		throw new Error("Smoke strict ledger does not bind the frozen terminal-complete result");
	}

	const [v3PreregistrationContents, v3LedgerContents] = await Promise.all([
		readPinnedEvidence(
			repoRoot,
			evidence.v3NonAdmission.preregistration.path,
			evidence.v3NonAdmission.preregistration.sha256,
		),
		readPinnedEvidence(repoRoot, evidence.v3NonAdmission.ledger.path, evidence.v3NonAdmission.ledger.sha256),
	]);
	const v3Preregistration = record(JSON.parse(v3PreregistrationContents) as unknown, "V3 preregistration");
	if (v3Preregistration.status !== "pre-dispatch") throw new Error("V3 preregistration is not pre-dispatch");
	const v3Events = verifyLedgerContentsStrict(v3LedgerContents);
	const v3Terminal = v3Events.at(-1);
	if (!v3Terminal || v3Terminal.hash !== evidence.v3NonAdmission.terminalEventSha256) {
		throw new Error("V3 failed event is not the strict-ledger terminus");
	}
	const v3TerminalPayload = record(v3Terminal.payload, "V3 terminal event payload");
	if (
		v3TerminalPayload.phase !== evidence.v3NonAdmission.terminalPhase ||
		v3TerminalPayload.failureDisposition !== evidence.v3NonAdmission.terminalDisposition ||
		v3Events.some((event) => {
			const payload =
				typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
					? (event.payload as Record<string, unknown>)
					: null;
			return payload?.phase === "complete";
		})
	) {
		throw new Error("V3 ledger does not preserve the frozen terminal non-admission");
	}
	try {
		await readFile(resolve(repoRoot, evidence.v3NonAdmission.resultPath), "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return;
		throw error;
	}
	throw new Error("V3 result must remain absent");
}

function assertFrozenDesign(): void {
	const candidates = COMPILER_GYM_ACTION_TRACE_CANDIDATES;
	if (candidates[0].candidateId !== "S12" || candidates[0].actions.length !== 12) throw new Error("S12 drifted");
	if (candidates[1].candidateId !== "L46" || candidates[1].actions.length !== 46) throw new Error("L46 drifted");
	for (const candidate of candidates) {
		if (sha256Text(JSON.stringify(candidate.actions)) !== candidate.expectedDigest) {
			throw new Error(`${candidate.candidateId} action bytes drifted`);
		}
	}
	if (
		COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN.map((item) => item.arm).join(",") !==
		"canonical,one-env-ir-delta,one-env-ir-delta,canonical,canonical,one-env-ir-delta,one-env-ir-delta,canonical"
	) {
		throw new Error("Qualification Latin-square plan drifted");
	}
	const expectedMappings = [
		["S12-blowfish", "S12", "benchmark://cbench-v1/blowfish"],
		["S12-bzip2", "S12", "benchmark://cbench-v1/bzip2"],
		["L46-bzip2", "L46", "benchmark://cbench-v1/bzip2"],
		["L46-blowfish", "L46", "benchmark://cbench-v1/blowfish"],
	];
	for (const [index, expected] of expectedMappings.entries()) {
		const pairSpecs = COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN.slice(index * 2, index * 2 + 2);
		if (
			pairSpecs.length !== 2 ||
			pairSpecs.some(
				(item) =>
					item.caseId !== expected[0] || item.candidateId !== expected[1] || item.benchmarkId !== expected[2],
			)
		) {
			throw new Error("Qualification case mapping drifted");
		}
	}
	const treatment = structuredClone(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT) as Record<
		string,
		unknown
	>;
	delete treatment.irDeltaTrace;
	if (
		canonicalJson(toJsonValue(treatment)) !==
		canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_CONTROL))
	) {
		throw new Error("Renderer preflight treatment differs from control outside irDeltaTrace");
	}
	const serializedFixture = JSON.stringify(COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_PREFLIGHT_TREATMENT);
	for (const forbidden of ["action_had_no_effect", "no_effect_bits", "noEffectBits", "shadow_action_trace"]) {
		if (serializedFixture.includes(forbidden)) throw new Error("Renderer preflight contains forbidden metadata");
	}
}

export function buildCompilerGymIrDeltaQualificationPreregistration(
	input: BuildCompilerGymIrDeltaQualificationPreregistrationInput,
): CompilerGymIrDeltaQualificationPreregistration {
	assertFrozenDesign();
	if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO timestamp");
	if (input.primeAgentCommit !== FROZEN_CAMPAIGN.repositories.primeAgent.commit) {
		throw new Error("Prime Agent commit differs from the frozen campaign commit");
	}
	const canonicalSha256 = sha256Text(input.canonicalSource);
	const treatmentSha256 = sha256Text(input.treatmentSource);
	const environmentProbeSha256 = sha256Text(input.environmentProbeSource);
	if (canonicalSha256 !== COMPILER_GYM_EVALUATOR_SHA256) throw new Error("Canonical evaluator bytes drifted");
	if (treatmentSha256 !== COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256) {
		throw new Error("Treatment evaluator bytes drifted");
	}
	if (environmentProbeSha256 !== COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256) {
		throw new Error("Environment probe bytes drifted");
	}
	if (
		input.implementationClosure.length !== COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.length ||
		input.implementationClosure.some(
			(item, index) =>
				item.relativePath !== COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS[index] ||
				!SHA256_PATTERN.test(item.sha256),
		)
	) {
		throw new Error("Implementation closure differs from the exact ordered source list");
	}
	return {
		protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREGISTRATION_PROTOCOL,
		qualificationId: COMPILER_GYM_IR_DELTA_QUALIFICATION_ID,
		status: "pre-dispatch",
		createdAt: input.createdAt,
		primeAgentCommit: input.primeAgentCommit,
		claim: COMPILER_GYM_IR_DELTA_QUALIFICATION_CLAIM,
		design: {
			modelCalls: 0,
			measurementReuse: false,
			smokeMeasurementsUsed: false,
			formalMeasurementsReused: false,
			causalTreatmentClaimAllowed: false,
			lunaAuthorized: false,
			allocationCount: 8,
			caseCount: 4,
			dispatchAttempts: 1,
			allocationRetries: 0,
			replacementAllocations: 0,
			transport: "independent-stock-cold-ssh-srun",
			apparatusFailureDisposition: "terminal-apparatus-invalid-not-treatment-result",
			forbiddenMechanisms: [...COMPILER_GYM_IR_DELTA_QUALIFICATION_FORBIDDEN_MECHANISMS],
		},
		prerequisiteEvidence: structuredClone(COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE),
		environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT),
		environmentProbe: {
			protocol: "compiler-gym-farmshare-environment-probe-v1",
			expectedResult: structuredClone(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT),
		},
		sources: {
			canonicalPath: resolve(input.canonicalPath),
			canonicalSha256: COMPILER_GYM_EVALUATOR_SHA256,
			treatmentPath: resolve(input.treatmentPath),
			treatmentSha256: COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256,
			environmentProbePath: resolve(input.environmentProbePath),
			environmentProbeSha256: COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256,
			combinedSha256: sha256Json({ canonicalSha256, treatmentSha256, environmentProbeSha256 }),
		},
		implementationClosure: structuredClone(input.implementationClosure),
		renderer: {
			protocol: COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
			cellTemplateSha256: sha256Text(COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE),
			projectionField: "irDeltaTrace",
			denominator: COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_DENOMINATOR,
			syntheticPreflight: rendererSyntheticPreflight(),
		},
		expectedVerifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		trace: {
			evaluatorContract: COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT,
			contract: COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
			prefixConditional: true,
			intermediateSemanticStatus: "unverified",
			terminalSemanticStatus: "canonical-20-input-verifier",
			zeroDeltaSemantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
			forbiddenFields: ["action_had_no_effect", "no_effect_bits", "noEffectBits", "shadow_action_trace"],
		},
		candidates: COMPILER_GYM_ACTION_TRACE_CANDIDATES.map((candidate) => ({
			candidateId: candidate.candidateId,
			actions: [...candidate.actions],
			actionCount: candidate.actions.length,
			actionsSha256: candidate.expectedDigest,
			expectedMetrics: structuredClone(candidate.expectedMetrics),
			sourceEvidence: structuredClone(candidate.sourceEvidence),
		})),
		benchmarks: [...COMPILER_GYM_ACTION_TRACE_BENCHMARKS],
		executionPlan: COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN.map((item) => ({ ...item })),
		assessment: {
			protocol: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL,
			medianOverheadLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT,
			perCaseOverheadLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT,
			projectionRatioLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_RATIO_LIMIT,
			projectionByteLimit: COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT,
			qualifyDecision: "qualify-agent-facing-ir-delta-screen",
			killDecision: "kill-ir-delta-trace",
			nextGate: "separately-preregistered-paid-agent-screen",
			terminalTaxonomy: structuredClone(COMPILER_GYM_IR_DELTA_QUALIFICATION_TERMINAL_TAXONOMY),
		},
	};
}

export function parseCompilerGymIrDeltaQualificationPreregistration(
	value: unknown,
	expected?: CompilerGymIrDeltaQualificationPreregistration,
): CompilerGymIrDeltaQualificationPreregistration {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Preregistration must be an object");
	}
	const parsed = structuredClone(value) as CompilerGymIrDeltaQualificationPreregistration;
	if (
		parsed.protocol !== COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREGISTRATION_PROTOCOL ||
		parsed.qualificationId !== COMPILER_GYM_IR_DELTA_QUALIFICATION_ID ||
		parsed.status !== "pre-dispatch"
	) {
		throw new Error("Unexpected IR-delta qualification preregistration identity");
	}
	if (
		!Number.isFinite(Date.parse(parsed.createdAt)) ||
		parsed.primeAgentCommit !== FROZEN_CAMPAIGN.repositories.primeAgent.commit ||
		parsed.claim !== COMPILER_GYM_IR_DELTA_QUALIFICATION_CLAIM
	) {
		throw new Error("Preregistration campaign identity or claim drifted");
	}
	if (
		parsed.sources.canonicalSha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		parsed.sources.treatmentSha256 !== COMPILER_GYM_IR_DELTA_QUALIFICATION_EVALUATOR_SHA256 ||
		parsed.sources.environmentProbeSha256 !== COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256
	) {
		throw new Error("Preregistration source hashes are not pinned");
	}
	if (
		parsed.sources.combinedSha256 !==
		sha256Json({
			canonicalSha256: parsed.sources.canonicalSha256,
			treatmentSha256: parsed.sources.treatmentSha256,
			environmentProbeSha256: parsed.sources.environmentProbeSha256,
		})
	) {
		throw new Error("Preregistration combined source hash is invalid");
	}
	if (
		sha256Json(parsed.candidates) !==
		sha256Json(
			COMPILER_GYM_ACTION_TRACE_CANDIDATES.map((candidate) => ({
				candidateId: candidate.candidateId,
				actions: [...candidate.actions],
				actionCount: candidate.actions.length,
				actionsSha256: candidate.expectedDigest,
				expectedMetrics: candidate.expectedMetrics,
				sourceEvidence: candidate.sourceEvidence,
			})),
		)
	) {
		throw new Error("Preregistration candidates drifted");
	}
	if (sha256Json(parsed.executionPlan) !== sha256Json(COMPILER_GYM_IR_DELTA_QUALIFICATION_EXECUTION_PLAN)) {
		throw new Error("Preregistration Latin-square plan drifted");
	}
	if (sha256Json(parsed.benchmarks) !== sha256Json(COMPILER_GYM_ACTION_TRACE_BENCHMARKS)) {
		throw new Error("Preregistration benchmark order drifted");
	}
	if (
		canonicalJson(toJsonValue(parsed.prerequisiteEvidence)) !==
		canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_QUALIFICATION_PREREQUISITE_EVIDENCE))
	) {
		throw new Error("Prerequisite evidence bindings drifted");
	}
	if (
		canonicalJson(toJsonValue(parsed.environment)) !==
		canonicalJson(toJsonValue(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT))
	) {
		throw new Error("Preregistration environment drifted");
	}
	if (
		parsed.environmentProbe.protocol !== "compiler-gym-farmshare-environment-probe-v1" ||
		canonicalJson(toJsonValue(parsed.environmentProbe.expectedResult)) !==
			canonicalJson(toJsonValue(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT))
	) {
		throw new Error("Preregistration environment probe drifted");
	}
	if (
		!Array.isArray(parsed.implementationClosure) ||
		parsed.implementationClosure.length !== COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.length ||
		parsed.implementationClosure.some(
			(item, index) =>
				item.relativePath !== COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS[index] ||
				!SHA256_PATTERN.test(item.sha256),
		)
	) {
		throw new Error("Preregistration implementation closure is invalid");
	}
	if (
		parsed.design.modelCalls !== 0 ||
		parsed.design.measurementReuse !== false ||
		parsed.design.smokeMeasurementsUsed !== false ||
		parsed.design.formalMeasurementsReused !== false ||
		parsed.design.causalTreatmentClaimAllowed !== false ||
		parsed.design.lunaAuthorized !== false ||
		parsed.design.allocationCount !== 8 ||
		parsed.design.caseCount !== 4 ||
		parsed.design.dispatchAttempts !== 1 ||
		parsed.design.allocationRetries !== 0 ||
		parsed.design.replacementAllocations !== 0 ||
		parsed.design.transport !== "independent-stock-cold-ssh-srun" ||
		parsed.design.apparatusFailureDisposition !== "terminal-apparatus-invalid-not-treatment-result" ||
		JSON.stringify(parsed.design.forbiddenMechanisms) !==
			JSON.stringify(COMPILER_GYM_IR_DELTA_QUALIFICATION_FORBIDDEN_MECHANISMS)
	) {
		throw new Error("Preregistration is not the frozen zero-model fresh-measurement design");
	}
	const expectedPreflight = rendererSyntheticPreflight();
	if (
		parsed.renderer.protocol !== COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL ||
		parsed.renderer.cellTemplateSha256 !== sha256Text(COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE) ||
		parsed.renderer.projectionField !== "irDeltaTrace" ||
		parsed.renderer.denominator !== COMPILER_GYM_IR_DELTA_QUALIFICATION_RENDERER_DENOMINATOR ||
		canonicalJson(toJsonValue(parsed.renderer.syntheticPreflight)) !== canonicalJson(toJsonValue(expectedPreflight))
	) {
		throw new Error("Preregistration renderer drifted");
	}
	if (
		parsed.trace.evaluatorContract !== COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT ||
		parsed.trace.contract !== COMPILER_GYM_IR_DELTA_TRACE_CONTRACT ||
		parsed.trace.prefixConditional !== true ||
		parsed.trace.intermediateSemanticStatus !== "unverified" ||
		parsed.trace.terminalSemanticStatus !== "canonical-20-input-verifier" ||
		parsed.trace.zeroDeltaSemantics !== COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS ||
		JSON.stringify(parsed.trace.forbiddenFields) !==
			JSON.stringify(["action_had_no_effect", "no_effect_bits", "noEffectBits", "shadow_action_trace"])
	) {
		throw new Error("Preregistration trace contract drifted");
	}
	if (
		parsed.assessment.protocol !== COMPILER_GYM_IR_DELTA_QUALIFICATION_PROTOCOL ||
		parsed.assessment.medianOverheadLimit !== COMPILER_GYM_IR_DELTA_QUALIFICATION_MEDIAN_RATIO_LIMIT ||
		parsed.assessment.perCaseOverheadLimit !== COMPILER_GYM_IR_DELTA_QUALIFICATION_PER_CASE_RATIO_LIMIT ||
		parsed.assessment.projectionRatioLimit !== COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_RATIO_LIMIT ||
		parsed.assessment.projectionByteLimit !== COMPILER_GYM_IR_DELTA_QUALIFICATION_PROJECTION_BYTE_LIMIT ||
		parsed.assessment.qualifyDecision !== "qualify-agent-facing-ir-delta-screen" ||
		parsed.assessment.killDecision !== "kill-ir-delta-trace" ||
		parsed.assessment.nextGate !== "separately-preregistered-paid-agent-screen" ||
		canonicalJson(toJsonValue(parsed.assessment.terminalTaxonomy)) !==
			canonicalJson(toJsonValue(COMPILER_GYM_IR_DELTA_QUALIFICATION_TERMINAL_TAXONOMY))
	) {
		throw new Error("Preregistration assessment protocol drifted");
	}
	if (expected && canonicalJson(toJsonValue(parsed)) !== canonicalJson(toJsonValue(expected))) {
		throw new Error("Preregistration differs from its fully reconstructed sealed design");
	}
	return parsed;
}

export async function writeCompilerGymIrDeltaQualificationPreregistration(
	path: string,
	preregistration: CompilerGymIrDeltaQualificationPreregistration,
): Promise<void> {
	parseCompilerGymIrDeltaQualificationPreregistration(preregistration);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(preregistration))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function generateCompilerGymIrDeltaQualificationPreregistration(input: {
	outputPath: string;
	repoRoot: string;
	createdAt?: string;
}): Promise<CompilerGymIrDeltaQualificationPreregistration> {
	await verifyCompilerGymIrDeltaQualificationPrerequisiteEvidence(input.repoRoot);
	const canonicalPath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const treatmentPath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const environmentProbePath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_env_probe.py");
	const [{ stdout }, canonicalSource, treatmentSource, environmentProbeSource, implementationClosure] =
		await Promise.all([
			execFileAsync("git", ["rev-parse", "HEAD"], { cwd: input.repoRoot, encoding: "utf8" }),
			readFile(canonicalPath, "utf8"),
			readFile(treatmentPath, "utf8"),
			readFile(environmentProbePath, "utf8"),
			Promise.all(
				COMPILER_GYM_IR_DELTA_QUALIFICATION_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
					relativePath,
					sha256: sha256Text(await readFile(resolve(input.repoRoot, relativePath), "utf8")),
				})),
			),
		]);
	const preregistration = buildCompilerGymIrDeltaQualificationPreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		primeAgentCommit: stdout.trim(),
		canonicalPath,
		canonicalSource,
		treatmentPath,
		treatmentSource,
		environmentProbePath,
		environmentProbeSource,
		implementationClosure,
	});
	await writeCompilerGymIrDeltaQualificationPreregistration(resolve(input.outputPath), preregistration);
	return preregistration;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 2 || args[0] !== "--output") {
		throw new Error("Usage: compiler-gym-ir-delta-qualification-preregistration --output <path>");
	}
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	console.log(
		canonicalJson(
			toJsonValue(
				await generateCompilerGymIrDeltaQualificationPreregistration({
					outputPath: args[1],
					repoRoot,
				}),
			),
		),
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

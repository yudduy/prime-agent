import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import { REDUCED_CPU_CALIBRATION_DEADLINE_MS } from "./reduced-cpu-study-calibration.js";
import {
	parseReducedCpuCalibration,
	REDUCED_CPU_ALL_TASKS,
	REDUCED_CPU_CALIBRATION_BRANCH_ID,
	REDUCED_CPU_EXPECTED_HARDWARE,
	REDUCED_CPU_EXPECTED_PROVENANCE,
	REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM,
	REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM,
	REDUCED_CPU_REQUIRED_VERIFIER_CHECKS,
	REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM,
	REDUCED_CPU_SEARCH_TASKS,
	REDUCED_CPU_STUDY_ARMS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	REDUCED_CPU_VALIDATION_TASK,
	type ReducedCpuCalibration,
	type ReducedCpuCalibrationEnvelope,
	type ReducedCpuStudyArm,
} from "./reduced-cpu-study-protocol.js";

const execFileAsync = promisify(execFile);

export const REDUCED_CPU_STUDY_PREREGISTRATION_PROTOCOL =
	"reduced-prime-compiler-gym-study-preregistration-v1" as const;
export const REDUCED_CPU_STUDY_ATTEMPT_LOCK_PROTOCOL = "reduced-cpu-study-attempt-lock-v1" as const;
export const REDUCED_CPU_STUDY_MODEL = {
	provider: "openai-codex",
	modelId: "gpt-5.6-luna",
	fullyQualifiedModel: "openai-codex/gpt-5.6-luna",
	thinkingLevel: "xhigh",
	serviceTier: "priority",
	transport: "sse",
	providerRetries: 0,
} as const;
export const REDUCED_CPU_STUDY_LIMITS = {
	paidModelCalls: {
		stock: 5,
		M: 6,
		"M+R": 6,
		campaignWhenRetestInstantiated: 16,
		campaignMaximum: 17,
	},
	perArm: {
		nonCachedOutputTokens: 32_000,
		activeAgentSeconds: 600,
		calendarSeconds: 900,
		evaluatorSubmissions: REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM,
		freshTaskEvaluations: REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM,
	},
	campaign: {
		nonCachedOutputTokens: 96_000,
		activeAgentSeconds: 1_800,
		calendarSeconds: 2_700,
		evaluatorSubmissions: REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM * REDUCED_CPU_STUDY_ARMS.length,
		freshTaskEvaluations: REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM * REDUCED_CPU_STUDY_ARMS.length,
	},
} as const;

export const REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS =
	"Preserve the bounded optimization objective and evaluator contract. Summarize prior measured evidence normally under Prime's stock compaction policy." as const;

export const REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT = [
	"Continue the bounded branch with candidates 3 and 4. Candidate 3 must genuinely change candidate 1's action sequence.",
	"First call autoresearch_recall exactly once with an empty object and wait for its typed result.",
	"Only a later provider response may call autoresearch_evaluate for candidate 3.",
	"Call autoresearch_evaluate exactly once per provider response and inspect candidate 3 before candidate 4.",
	"Evaluate candidate 4 normally.",
	"Do not select or report a champion.",
].join("\n");

export const REDUCED_CPU_STUDY_SOURCE_PATHS = [
	"packages/ai/src/providers/openai-codex-responses.ts",
	"packages/coding-agent/src/core/agent-session.ts",
	"packages/coding-agent/src/core/compaction/compaction.ts",
	"packages/coding-agent/src/core/extensions/runner.ts",
	"packages/coding-agent/src/core/index.ts",
	"packages/coding-agent/src/core/sdk.ts",
	"packages/coding-agent/src/index.ts",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/src/analyze-reduced-cpu-study.ts",
	"research/autoresearch/src/artifact-store.ts",
	"research/autoresearch/src/campaign.ts",
	"research/autoresearch/src/canonical-json.ts",
	"research/autoresearch/src/compiler-gym-adapter.ts",
	"research/autoresearch/src/compiler-gym-hardened-paid-provider.ts",
	"research/autoresearch/src/compiler-gym-warm-transport.ts",
	"research/autoresearch/src/controller.ts",
	"research/autoresearch/src/evaluation-adapter-output-error.ts",
	"research/autoresearch/src/host-owned-terminalization.ts",
	"research/autoresearch/src/ledger.ts",
	"research/autoresearch/src/pareto-coverage.ts",
	"research/autoresearch/src/reduced-cpu-study-analysis-cli.ts",
	"research/autoresearch/src/reduced-cpu-study-calibration.ts",
	"research/autoresearch/src/reduced-cpu-study-controller.ts",
	"research/autoresearch/src/reduced-cpu-study-eval.ts",
	"research/autoresearch/src/reduced-cpu-study-preregistration.ts",
	"research/autoresearch/src/reduced-cpu-study-protocol.ts",
	"research/autoresearch/src/reduced-cpu-study.ts",
	"research/autoresearch/src/stock-cpu-protocol.ts",
	"research/autoresearch/src/stock-interface-parity-protocol.ts",
	"research/autoresearch/src/stock-interface-parity.ts",
	"research/autoresearch/src/types.ts",
] as const;

export interface ReducedCpuStudySourceBinding {
	relativePath: (typeof REDUCED_CPU_STUDY_SOURCE_PATHS)[number];
	byteSha256: string;
}

export interface ReducedCpuStudyCalibrationBinding {
	absolutePath: string;
	byteSha256: string;
	parsedSha256: string;
	attempt: {
		attemptId: string;
		identitySha256: string;
		lock: { absolutePath: string; byteSha256: string };
		startIntent: { absolutePath: string; byteSha256: string };
	};
	terminal: {
		absolutePath: string;
		byteSha256: string;
		outcome: "success";
		verifiedArtifactRefs: number;
	};
	ledger: {
		absolutePath: string;
		byteSha256: string;
		byteLength: number;
		eventCount: number;
		terminalEventSequence: number;
		terminalEventSha256: string;
	};
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	jobId: string;
	manifestDigest: string;
	verifier: {
		epoch: ReducedCpuCalibration["verifierEpoch"];
		requiredChecks: typeof REDUCED_CPU_REQUIRED_VERIFIER_CHECKS;
	};
	hardware: Record<string, string>;
	provenance: Record<string, string>;
	tasks: ReducedCpuCalibration["tasks"];
}

export interface ReducedCpuStudyArmPreregistration {
	id: ReducedCpuStudyArm;
	executionOrdinal: 1 | 2 | 3;
	branchLabel: string;
	absoluteOutputDir: string;
	registeredCustomTools:
		| readonly ["autoresearch_evaluate"]
		| readonly ["autoresearch_evaluate", "autoresearch_recall"];
	activeToolSetByPhase: {
		preCompaction: readonly ["autoresearch_evaluate"];
		postCompactionBeforeRecall:
			| readonly ["autoresearch_evaluate"]
			| readonly ["autoresearch_evaluate", "autoresearch_recall"];
		postCompactionAfterRecall: readonly ["autoresearch_evaluate"];
		transition:
			| "stock-has-no-recall-transition"
			| "exact-empty-object-recall-once-then-disable-recall-before-candidate-3";
	};
	operationClaims: {
		protocol: "reduced-cpu-operation-claim-v1";
		absoluteDirectory: string;
		writeFlag: "wx";
		fileMode: "0600";
		durability: "file-handle-sync-before-close";
		intentTiming: "immediately-before-controller-submit";
		resultTiming: "after-durable-terminal-result-and-strict-ledger-verification";
		intentBinds: readonly ["preregistration-sha256", "arm", "branch-id", "operation", "request-sha256"];
		resultBinds: readonly ["intent-sha256", "job-id", "manifest-digest"];
		existingClaimDisposition: "terminal-no-retry-no-replacement";
		loneIntentDisposition: "terminal-ambiguity-no-retry";
		candidates: readonly [
			{ ordinal: 1; intentPath: string; resultPath: string },
			{ ordinal: 2; intentPath: string; resultPath: string },
			{ ordinal: 3; intentPath: string; resultPath: string },
			{ ordinal: 4; intentPath: string; resultPath: string },
		];
		retest: {
			usesCandidateOrdinal: 4;
			intentPath: string;
			resultPath: string;
			eligibleHostRetestOnly: true;
		};
		validation: { intentPath: string; resultPath: string };
	};
	features: {
		measuredEvidence: "none" | "typed-branch-local";
		measuredEvidenceAcrossCompaction: "none" | "append-only-ledger-plus-exact-post-compaction-typed-recall";
		recallAfterCompaction: "forbidden" | "exactly-once-before-candidate-3";
		recallReceiptRequired: boolean;
		candidateTwoPolicy: "exact-single-pass-insertion-into-candidate-1";
		retestPolicy: "none" | "eligible-candidate-2-insertion-reapplied-exactly-to-changed-candidate-3-base";
		ineligibleRetestDisposition: "not-applicable" | "treatment-uninstantiated-no-r-credit";
	};
}

export interface ReducedCpuStudyPreregistration {
	schemaVersion: 1;
	protocol: typeof REDUCED_CPU_STUDY_PREREGISTRATION_PROTOCOL;
	studyProtocol: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	createdAt: string;
	status: "preregistered-after-calibration-but-before-any-study-arm-provider-or-evaluator-dispatch";
	classification: "prospective-single-block-directional-cpu-screen";
	repository: {
		repoRoot: string;
		pinnedPrimeCommit: string;
		currentHead: string;
	};
	model: typeof REDUCED_CPU_STUDY_MODEL;
	calibration: ReducedCpuStudyCalibrationBinding;
	tasks: {
		search: typeof REDUCED_CPU_SEARCH_TASKS;
		validation: readonly [typeof REDUCED_CPU_VALIDATION_TASK];
	};
	executionOrder: readonly [ReducedCpuStudyArm, ReducedCpuStudyArm, ReducedCpuStudyArm];
	launch: {
		campaignRoot: string;
		preregistrationPath: string;
		outputRoot: string;
		resultPath: string;
	};
	arms: readonly [
		ReducedCpuStudyArmPreregistration,
		ReducedCpuStudyArmPreregistration,
		ReducedCpuStudyArmPreregistration,
	];
	commonRuntime: {
		defaultPrimeSystemPrompt: { enabled: true; customSystemPromptAppend: false };
		noTools: "builtin";
		typedEvaluatorTool: {
			name: "autoresearch_evaluate";
			request: "ReducedCpuCandidateRequest";
			response: {
				content: {
					blocks: "exactly-one-text-block";
					encoding: "JSON.stringify";
					schema: "ReducedCpuProviderCandidateMeasurement";
					exactKeys: readonly [
						"schemaVersion",
						"type",
						"candidateDigest",
						"actions",
						"verifierValid",
						"tasks",
						"invalidReasons",
					];
					type: "reduced_cpu_candidate_measurement";
					excludedHostFields: readonly [
						"arm",
						"branchId",
						"ordinal",
						"jobId",
						"manifestDigest",
						"parentJobIds",
						"treatment",
						"path",
						"executionOrder",
						"branchLabel",
					];
				};
				details: {
					schema: "ReducedCpuStudyEvaluationEnvelope";
					visibility: "host-only";
				};
			};
			directControllerSubmission: true;
		};
		typedRecallTool: {
			name: "autoresearch_recall";
			request: "exact-empty-object";
			response: "sanitized-ordered-candidate-1-and-2-evidence-plus-receipt-hash-and-text";
		};
		forbiddenTools: readonly ["ipython", "bash", "edit", "write", "read"];
		workspaceMustStartEmpty: true;
		forcedCompaction: {
			timing: "after-candidate-2-before-continuation";
			method: "native-agent-session-compact";
			keepRecentTokens: 1;
			reserveTokens: 2048;
			agentCallable: false;
			instructions: typeof REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS;
			paidModelCallsPerArm: 1;
			sameSettingsAndInstructionsAllArms: true;
			customCompactionHook: false;
			requireOneStartAndOneEndEvent: true;
			requirePersistedCompactionEntry: true;
		};
		providerVisibleEqualityThroughCandidate3: {
			arms: readonly ["M", "M+R"];
			boundary: "through-candidate-3-evaluator-result-before-host-retest-decision";
			initialPrompt: "byte-identical";
			continuationPrompt: { text: string; byteSha256: string; byteIdentical: true };
			registeredToolDefinitions: "byte-identical";
			activeToolSetsByPhase: "byte-identical";
			evaluatorRequestAndProviderContentProjection: "byte-identical-schema-arm-local-measured-values-only";
			recallRequestAndProviderContentProjection: "byte-identical-schema-arm-local-measured-values-only";
			hostDetailsVisibility: "full-evaluation-envelope-host-only";
			forbiddenProviderSignals: readonly [
				"arm-id",
				"branch-id",
				"treatment",
				"path",
				"execution-order",
				"branch-label",
				"m-plus-r",
				"retest",
			];
		};
	};
	allocation: {
		searchCandidatesPerArm: typeof REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM;
		championValidationPerArm: 1;
		validationTask: typeof REDUCED_CPU_VALIDATION_TASK;
	};
	integrity: {
		providerRetries: 0;
		replacements: 0;
		measurementReuse: false;
		duplicateSubmissions: false;
		crossArmEvidence: false;
		freshMeasurementsOnly: true;
	};
	limits: typeof REDUCED_CPU_STUDY_LIMITS;
	decision: {
		practicalDelta: "max-3-ir-or-half-percent-calibration-v1";
		standardTransferGate: string;
		earlyDominanceTransferGate: string;
		simplicityTieBreak: readonly ["stock", "M", "M+R"];
		nanoGptTransfer: "only-one-cpu-transfer-eligible-treatment-m-or-m-plus-r-m-plus-r-must-beat-stock-and-m";
		noEligibleTreatment: "stop-with-no-nanogpt-treatment-run";
	};
	claimLimits: {
		causalClaimAllowed: false;
		replicationClaimAllowed: false;
		stockLabel: "prime-default-prompt-and-native-compaction-with-common-typed-evaluator";
	};
	implementationSources: ReducedCpuStudySourceBinding[];
	scientificIdentitySha256: string;
	attemptLocks: {
		protocol: typeof REDUCED_CPU_STUDY_ATTEMPT_LOCK_PROTOCOL;
		root: string;
		campaign: { path: string; expectedContentsSha256: string };
		arms: Record<ReducedCpuStudyArm, { path: string; expectedContentsSha256: string }>;
		claimTiming: "runner-exclusive-wx-before-first-provider-or-evaluator-dispatch";
	};
	hashPolicy: "sha256-of-canonical-json-without-preregistrationSha256-v1";
	preregistrationSha256: string;
}

type PreregistrationBody = Omit<ReducedCpuStudyPreregistration, "preregistrationSha256">;

export interface BuildReducedCpuStudyPreregistrationInput {
	createdAt: string;
	repoRoot: string;
	currentHead: string;
	campaignRoot: string;
	calibration: ReducedCpuStudyCalibrationBinding;
	executionOrder: readonly [ReducedCpuStudyArm, ReducedCpuStudyArm, ReducedCpuStudyArm];
	implementationSources: readonly ReducedCpuStudySourceBinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys drifted`);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function digest(value: unknown, label: string): string {
	const parsed = requiredString(value, label);
	if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
	return parsed;
}

function safeInteger(value: unknown, label: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`);
	}
	return Number(value);
}

function timestamp(value: unknown, label: string): string {
	const parsed = requiredString(value, label);
	if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} must be a timestamp`);
	return parsed;
}

function absolutePath(value: unknown, label: string): string {
	const parsed = requiredString(value, label);
	if (!isAbsolute(parsed) || resolve(parsed) !== parsed)
		throw new Error(`${label} must be a normalized absolute path`);
	return parsed;
}

function cloneExactStringRecord(
	value: unknown,
	expected: Readonly<Record<string, string>>,
	label: string,
): Record<string, string> {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	exactKeys(value, Object.keys(expected), label);
	const result: Record<string, string> = {};
	for (const [key, expectedValue] of Object.entries(expected)) {
		const parsed = requiredString(value[key], `${label}.${key}`);
		if (parsed !== expectedValue) throw new Error(`${label}.${key} drifted`);
		result[key] = parsed;
	}
	return result;
}

function validateArmOrder(
	value: readonly ReducedCpuStudyArm[],
): asserts value is readonly [ReducedCpuStudyArm, ReducedCpuStudyArm, ReducedCpuStudyArm] {
	if (
		value.length !== REDUCED_CPU_STUDY_ARMS.length ||
		new Set(value).size !== REDUCED_CPU_STUDY_ARMS.length ||
		!REDUCED_CPU_STUDY_ARMS.every((arm) => value.includes(arm))
	) {
		throw new Error("executionOrder must be one permutation of stock, M, M+R");
	}
}

function validateSourceBindings(value: readonly ReducedCpuStudySourceBinding[]): ReducedCpuStudySourceBinding[] {
	const expectedPaths = [...REDUCED_CPU_STUDY_SOURCE_PATHS].sort();
	const parsed = value.map((source) => ({
		relativePath: source.relativePath,
		byteSha256: digest(source.byteSha256, `source ${source.relativePath}`),
	}));
	assert.deepEqual(
		parsed.map((source) => source.relativePath),
		expectedPaths,
		"implementation source paths must be exact, unique, and sorted",
	);
	return parsed;
}

function validateCalibrationBinding(value: ReducedCpuStudyCalibrationBinding): ReducedCpuStudyCalibrationBinding {
	const calibrationPath = absolutePath(value.absolutePath, "calibration.absolutePath");
	digest(value.byteSha256, "calibration.byteSha256");
	digest(value.parsedSha256, "calibration.parsedSha256");
	const calibrationDirectory = dirname(calibrationPath);
	const attemptId = requiredString(value.attempt.attemptId, "calibration.attempt.attemptId");
	const identitySha256 = digest(value.attempt.identitySha256, "calibration.attempt.identitySha256");
	const attemptLockPath = absolutePath(value.attempt.lock.absolutePath, "calibration.attempt.lock.absolutePath");
	const startIntentPath = absolutePath(
		value.attempt.startIntent.absolutePath,
		"calibration.attempt.startIntent.absolutePath",
	);
	const terminalPath = absolutePath(value.terminal.absolutePath, "calibration.terminal.absolutePath");
	const ledgerPath = absolutePath(value.ledger.absolutePath, "calibration.ledger.absolutePath");
	if (attemptLockPath !== join(calibrationDirectory, "attempt.lock")) {
		throw new Error("calibration attempt lock must be the exact sibling attempt.lock");
	}
	if (startIntentPath !== join(calibrationDirectory, "start-intent.json")) {
		throw new Error("calibration start intent must be the exact sibling start-intent.json");
	}
	if (terminalPath !== join(calibrationDirectory, "result.json")) {
		throw new Error("calibration terminal must be the exact sibling result.json");
	}
	if (ledgerPath !== join(calibrationDirectory, "evidence.jsonl")) {
		throw new Error("calibration ledger must be the exact sibling evidence.jsonl");
	}
	digest(value.attempt.lock.byteSha256, "calibration.attempt.lock.byteSha256");
	digest(value.attempt.startIntent.byteSha256, "calibration.attempt.startIntent.byteSha256");
	digest(value.terminal.byteSha256, "calibration.terminal.byteSha256");
	if (value.terminal.outcome !== "success") throw new Error("calibration terminal outcome must be success");
	const verifiedArtifactRefs = safeInteger(
		value.terminal.verifiedArtifactRefs,
		"calibration.terminal.verifiedArtifactRefs",
		1,
	);
	digest(value.ledger.byteSha256, "calibration.ledger.byteSha256");
	const ledgerByteLength = safeInteger(value.ledger.byteLength, "calibration.ledger.byteLength", 1);
	const ledgerEventCount = safeInteger(value.ledger.eventCount, "calibration.ledger.eventCount", 1);
	const terminalEventSequence = safeInteger(
		value.ledger.terminalEventSequence,
		"calibration.ledger.terminalEventSequence",
		0,
	);
	if (terminalEventSequence !== ledgerEventCount - 1) {
		throw new Error("calibration ledger terminal event must be the final event");
	}
	const terminalEventSha256 = digest(value.ledger.terminalEventSha256, "calibration.ledger.terminalEventSha256");
	if (value.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION) throw new Error("calibration protocol drifted");
	if (!value.jobId) throw new Error("calibration job ID is empty");
	digest(value.manifestDigest, "calibration.manifestDigest");
	if (value.verifier.epoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		throw new Error("calibration verifier epoch drifted");
	}
	assert.deepEqual(value.verifier.requiredChecks, REDUCED_CPU_REQUIRED_VERIFIER_CHECKS);
	const hardware = cloneExactStringRecord(value.hardware, REDUCED_CPU_EXPECTED_HARDWARE, "calibration.hardware");
	const provenance = cloneExactStringRecord(
		value.provenance,
		REDUCED_CPU_EXPECTED_PROVENANCE,
		"calibration.provenance",
	);
	assert.equal(value.tasks.length, REDUCED_CPU_ALL_TASKS.length, "calibration task count drifted");
	const tasks = REDUCED_CPU_ALL_TASKS.map((benchmarkId, index) => {
		const task = value.tasks[index];
		if (!task || task.benchmarkId !== benchmarkId || task.verifierPassed !== true) {
			throw new Error(`calibration task ${benchmarkId} drifted`);
		}
		if (!Number.isSafeInteger(task.irInstructionCount) || task.irInstructionCount < 0) {
			throw new Error(`calibration task ${benchmarkId} IR is invalid`);
		}
		if (!Number.isSafeInteger(task.objectTextSizeBytes) || task.objectTextSizeBytes < 0) {
			throw new Error(`calibration task ${benchmarkId} object size is invalid`);
		}
		return { ...task };
	});
	const parsed = {
		absolutePath: calibrationPath,
		byteSha256: value.byteSha256,
		parsedSha256: value.parsedSha256,
		attempt: {
			attemptId,
			identitySha256,
			lock: { absolutePath: attemptLockPath, byteSha256: value.attempt.lock.byteSha256 },
			startIntent: { absolutePath: startIntentPath, byteSha256: value.attempt.startIntent.byteSha256 },
		},
		terminal: {
			absolutePath: terminalPath,
			byteSha256: value.terminal.byteSha256,
			outcome: "success",
			verifiedArtifactRefs,
		},
		ledger: {
			absolutePath: ledgerPath,
			byteSha256: value.ledger.byteSha256,
			byteLength: ledgerByteLength,
			eventCount: ledgerEventCount,
			terminalEventSequence,
			terminalEventSha256,
		},
		protocolVersion: value.protocolVersion,
		jobId: value.jobId,
		manifestDigest: value.manifestDigest,
		verifier: {
			epoch: value.verifier.epoch,
			requiredChecks: [...REDUCED_CPU_REQUIRED_VERIFIER_CHECKS],
		},
		hardware,
		provenance,
		tasks,
	} satisfies ReducedCpuStudyCalibrationBinding;
	if (parsed.parsedSha256 !== sha256Json(calibrationFromBinding(parsed))) {
		throw new Error("calibration parsed SHA-256 is not self-binding");
	}
	return parsed;
}

function calibrationFromBinding(binding: ReducedCpuStudyCalibrationBinding): ReducedCpuCalibration {
	return {
		protocolVersion: binding.protocolVersion,
		verifierEpoch: binding.verifier.epoch,
		jobId: binding.jobId,
		manifestDigest: binding.manifestDigest,
		tasks: binding.tasks.map((task) => ({ ...task })),
		hardware: { ...binding.hardware },
		provenance: { ...binding.provenance },
	};
}

function armSlug(arm: ReducedCpuStudyArm): string {
	return arm === "M+R" ? "m-plus-r" : arm.toLowerCase();
}

function lockContents(input: { scientificIdentitySha256: string; scope: "campaign" | ReducedCpuStudyArm }): string {
	return `${canonicalJson(
		toJsonValue({
			schemaVersion: 1,
			protocol: REDUCED_CPU_STUDY_ATTEMPT_LOCK_PROTOCOL,
			scientificIdentitySha256: input.scientificIdentitySha256,
			scope: input.scope,
		}),
	)}\n`;
}

function armFeatures(arm: ReducedCpuStudyArm): ReducedCpuStudyArmPreregistration["features"] {
	if (arm === "stock") {
		return {
			measuredEvidence: "none",
			measuredEvidenceAcrossCompaction: "none",
			recallAfterCompaction: "forbidden",
			recallReceiptRequired: false,
			candidateTwoPolicy: "exact-single-pass-insertion-into-candidate-1",
			retestPolicy: "none",
			ineligibleRetestDisposition: "not-applicable",
		};
	}
	if (arm === "M") {
		return {
			measuredEvidence: "typed-branch-local",
			measuredEvidenceAcrossCompaction: "append-only-ledger-plus-exact-post-compaction-typed-recall",
			recallAfterCompaction: "exactly-once-before-candidate-3",
			recallReceiptRequired: true,
			candidateTwoPolicy: "exact-single-pass-insertion-into-candidate-1",
			retestPolicy: "none",
			ineligibleRetestDisposition: "not-applicable",
		};
	}
	return {
		measuredEvidence: "typed-branch-local",
		measuredEvidenceAcrossCompaction: "append-only-ledger-plus-exact-post-compaction-typed-recall",
		recallAfterCompaction: "exactly-once-before-candidate-3",
		recallReceiptRequired: true,
		candidateTwoPolicy: "exact-single-pass-insertion-into-candidate-1",
		retestPolicy: "eligible-candidate-2-insertion-reapplied-exactly-to-changed-candidate-3-base",
		ineligibleRetestDisposition: "treatment-uninstantiated-no-r-credit",
	};
}

function armOperationClaims(absoluteOutputDir: string): ReducedCpuStudyArmPreregistration["operationClaims"] {
	const absoluteDirectory = join(absoluteOutputDir, ".dispatch-locks");
	const claimPaths = (operation: string) => ({
		intentPath: join(absoluteDirectory, `${operation}.intent.json`),
		resultPath: join(absoluteDirectory, `${operation}.result.json`),
	});
	const candidates = [1, 2, 3, 4].map((ordinal) => ({
		ordinal,
		...claimPaths(`candidate-${ordinal}`),
	})) as unknown as ReducedCpuStudyArmPreregistration["operationClaims"]["candidates"];
	return {
		protocol: "reduced-cpu-operation-claim-v1",
		absoluteDirectory,
		writeFlag: "wx",
		fileMode: "0600",
		durability: "file-handle-sync-before-close",
		intentTiming: "immediately-before-controller-submit",
		resultTiming: "after-durable-terminal-result-and-strict-ledger-verification",
		intentBinds: ["preregistration-sha256", "arm", "branch-id", "operation", "request-sha256"],
		resultBinds: ["intent-sha256", "job-id", "manifest-digest"],
		existingClaimDisposition: "terminal-no-retry-no-replacement",
		loneIntentDisposition: "terminal-ambiguity-no-retry",
		candidates,
		retest: {
			usesCandidateOrdinal: 4,
			intentPath: candidates[3].intentPath,
			resultPath: candidates[3].resultPath,
			eligibleHostRetestOnly: true,
		},
		validation: claimPaths("champion-validation"),
	};
}

function scientificIdentity(input: {
	currentHead: string;
	calibration: ReducedCpuStudyCalibrationBinding;
	executionOrder: readonly ReducedCpuStudyArm[];
	implementationSources: readonly ReducedCpuStudySourceBinding[];
}): string {
	return sha256Json({
		protocol: REDUCED_CPU_STUDY_PREREGISTRATION_PROTOCOL,
		studyProtocol: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		pinnedPrimeCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
		currentHead: input.currentHead,
		model: REDUCED_CPU_STUDY_MODEL,
		calibration: input.calibration,
		tasks: { search: REDUCED_CPU_SEARCH_TASKS, validation: [REDUCED_CPU_VALIDATION_TASK] },
		executionOrder: input.executionOrder,
		allocation: {
			searchCandidatesPerArm: REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM,
			championValidationPerArm: 1,
		},
		limits: REDUCED_CPU_STUDY_LIMITS,
		implementationSources: input.implementationSources,
	});
}

export function buildReducedCpuStudyPreregistration(
	input: BuildReducedCpuStudyPreregistrationInput,
): ReducedCpuStudyPreregistration {
	if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO-compatible timestamp");
	const repoRoot = absolutePath(input.repoRoot, "repoRoot");
	const campaignRoot = absolutePath(input.campaignRoot, "campaignRoot");
	if (!/^[a-f0-9]{40}$/.test(input.currentHead)) throw new Error("currentHead must be a lowercase Git SHA-1");
	if (input.currentHead !== FROZEN_CAMPAIGN.repositories.primeAgent.commit) {
		throw new Error("current HEAD does not match the pinned Prime Agent commit");
	}
	validateArmOrder(input.executionOrder);
	const executionOrder = [...input.executionOrder] as [ReducedCpuStudyArm, ReducedCpuStudyArm, ReducedCpuStudyArm];
	const calibration = validateCalibrationBinding(input.calibration);
	const implementationSources = validateSourceBindings(input.implementationSources);
	const outputRoot = join(campaignRoot, "arms");
	const preregistrationPath = join(campaignRoot, "preregistration.json");
	const resultPath = join(campaignRoot, "result.json");
	const arms = executionOrder.map((arm, index) => {
		const slot = `slot-${index + 1}`;
		const absoluteOutputDir = join(outputRoot, slot);
		return {
			id: arm,
			executionOrdinal: (index + 1) as 1 | 2 | 3,
			branchLabel: `reduced-cpu-study-v1-${slot}`,
			absoluteOutputDir,
			registeredCustomTools:
				arm === "stock"
					? (["autoresearch_evaluate"] as const)
					: (["autoresearch_evaluate", "autoresearch_recall"] as const),
			activeToolSetByPhase: {
				preCompaction: ["autoresearch_evaluate"],
				postCompactionBeforeRecall:
					arm === "stock"
						? (["autoresearch_evaluate"] as const)
						: (["autoresearch_evaluate", "autoresearch_recall"] as const),
				postCompactionAfterRecall: ["autoresearch_evaluate"],
				transition:
					arm === "stock"
						? "stock-has-no-recall-transition"
						: "exact-empty-object-recall-once-then-disable-recall-before-candidate-3",
			},
			operationClaims: armOperationClaims(absoluteOutputDir),
			features: armFeatures(arm),
		};
	}) as unknown as ReducedCpuStudyPreregistration["arms"];
	assert.equal(new Set(arms.map((arm) => arm.absoluteOutputDir)).size, arms.length);
	const scientificIdentitySha256 = scientificIdentity({
		currentHead: input.currentHead,
		calibration,
		executionOrder,
		implementationSources,
	});
	const attemptLockRoot = join(homedir(), ".local/state/prime-agent-autoresearch/attempt-locks");
	const bodyWithoutHashAndLocks = {
		schemaVersion: 1,
		protocol: REDUCED_CPU_STUDY_PREREGISTRATION_PROTOCOL,
		studyProtocol: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		createdAt: input.createdAt,
		status: "preregistered-after-calibration-but-before-any-study-arm-provider-or-evaluator-dispatch",
		classification: "prospective-single-block-directional-cpu-screen",
		repository: {
			repoRoot,
			pinnedPrimeCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
			currentHead: input.currentHead,
		},
		model: REDUCED_CPU_STUDY_MODEL,
		calibration,
		tasks: { search: REDUCED_CPU_SEARCH_TASKS, validation: [REDUCED_CPU_VALIDATION_TASK] },
		executionOrder,
		launch: { campaignRoot, preregistrationPath, outputRoot, resultPath },
		arms,
		commonRuntime: {
			defaultPrimeSystemPrompt: { enabled: true, customSystemPromptAppend: false },
			noTools: "builtin",
			typedEvaluatorTool: {
				name: "autoresearch_evaluate",
				request: "ReducedCpuCandidateRequest",
				response: {
					content: {
						blocks: "exactly-one-text-block",
						encoding: "JSON.stringify",
						schema: "ReducedCpuProviderCandidateMeasurement",
						exactKeys: [
							"schemaVersion",
							"type",
							"candidateDigest",
							"actions",
							"verifierValid",
							"tasks",
							"invalidReasons",
						],
						type: "reduced_cpu_candidate_measurement",
						excludedHostFields: [
							"arm",
							"branchId",
							"ordinal",
							"jobId",
							"manifestDigest",
							"parentJobIds",
							"treatment",
							"path",
							"executionOrder",
							"branchLabel",
						],
					},
					details: {
						schema: "ReducedCpuStudyEvaluationEnvelope",
						visibility: "host-only",
					},
				},
				directControllerSubmission: true,
			},
			typedRecallTool: {
				name: "autoresearch_recall",
				request: "exact-empty-object",
				response: "sanitized-ordered-candidate-1-and-2-evidence-plus-receipt-hash-and-text",
			},
			forbiddenTools: ["ipython", "bash", "edit", "write", "read"],
			workspaceMustStartEmpty: true,
			forcedCompaction: {
				timing: "after-candidate-2-before-continuation",
				method: "native-agent-session-compact",
				keepRecentTokens: 1,
				reserveTokens: 2048,
				agentCallable: false,
				instructions: REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS,
				paidModelCallsPerArm: 1,
				sameSettingsAndInstructionsAllArms: true,
				customCompactionHook: false,
				requireOneStartAndOneEndEvent: true,
				requirePersistedCompactionEntry: true,
			},
			providerVisibleEqualityThroughCandidate3: {
				arms: ["M", "M+R"],
				boundary: "through-candidate-3-evaluator-result-before-host-retest-decision",
				initialPrompt: "byte-identical",
				continuationPrompt: {
					text: REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT,
					byteSha256: sha256Text(REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT),
					byteIdentical: true,
				},
				registeredToolDefinitions: "byte-identical",
				activeToolSetsByPhase: "byte-identical",
				evaluatorRequestAndProviderContentProjection: "byte-identical-schema-arm-local-measured-values-only",
				recallRequestAndProviderContentProjection: "byte-identical-schema-arm-local-measured-values-only",
				hostDetailsVisibility: "full-evaluation-envelope-host-only",
				forbiddenProviderSignals: [
					"arm-id",
					"branch-id",
					"treatment",
					"path",
					"execution-order",
					"branch-label",
					"m-plus-r",
					"retest",
				],
			},
		},
		allocation: {
			searchCandidatesPerArm: REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM,
			championValidationPerArm: 1,
			validationTask: REDUCED_CPU_VALIDATION_TASK,
		},
		integrity: {
			providerRetries: 0,
			replacements: 0,
			measurementReuse: false,
			duplicateSubmissions: false,
			crossArmEvidence: false,
			freshMeasurementsOnly: true,
		},
		limits: REDUCED_CPU_STUDY_LIMITS,
		decision: {
			practicalDelta: "max-3-ir-or-half-percent-calibration-v1",
			standardTransferGate:
				"post-compaction-cpu-champion-non-worse-on-all-three-search-tasks-practically-better-on-at-least-one-and-dijkstra-non-worse",
			earlyDominanceTransferGate:
				"candidate-3-first-dominates-reference-candidate-4-and-final-cpu-champion-is-non-worse-on-all-four-tasks",
			simplicityTieBreak: ["stock", "M", "M+R"],
			nanoGptTransfer: "only-one-cpu-transfer-eligible-treatment-m-or-m-plus-r-m-plus-r-must-beat-stock-and-m",
			noEligibleTreatment: "stop-with-no-nanogpt-treatment-run",
		},
		claimLimits: {
			causalClaimAllowed: false,
			replicationClaimAllowed: false,
			stockLabel: "prime-default-prompt-and-native-compaction-with-common-typed-evaluator",
		},
		implementationSources,
		scientificIdentitySha256,
		hashPolicy: "sha256-of-canonical-json-without-preregistrationSha256-v1",
	} as const;
	const lockPath = (scope: "campaign" | ReducedCpuStudyArm) =>
		join(
			attemptLockRoot,
			`reduced-cpu-study-${scientificIdentitySha256}-${scope === "campaign" ? scope : armSlug(scope)}.lock`,
		);
	const lockRecord = (scope: "campaign" | ReducedCpuStudyArm) => ({
		path: lockPath(scope),
		expectedContentsSha256: sha256Text(lockContents({ scientificIdentitySha256, scope })),
	});
	const body: PreregistrationBody = {
		...bodyWithoutHashAndLocks,
		attemptLocks: {
			protocol: REDUCED_CPU_STUDY_ATTEMPT_LOCK_PROTOCOL,
			root: attemptLockRoot,
			campaign: lockRecord("campaign"),
			arms: { stock: lockRecord("stock"), M: lockRecord("M"), "M+R": lockRecord("M+R") },
			claimTiming: "runner-exclusive-wx-before-first-provider-or-evaluator-dispatch",
		},
	};
	return { ...body, preregistrationSha256: sha256Json(body) };
}

function parseCalibrationBinding(value: unknown): ReducedCpuStudyCalibrationBinding {
	if (!isRecord(value)) throw new Error("calibration must be an object");
	exactKeys(
		value,
		[
			"absolutePath",
			"byteSha256",
			"parsedSha256",
			"attempt",
			"terminal",
			"ledger",
			"protocolVersion",
			"jobId",
			"manifestDigest",
			"verifier",
			"hardware",
			"provenance",
			"tasks",
		],
		"calibration",
	);
	if (!isRecord(value.attempt)) throw new Error("calibration.attempt must be an object");
	exactKeys(value.attempt, ["attemptId", "identitySha256", "lock", "startIntent"], "calibration.attempt");
	if (!isRecord(value.attempt.lock) || !isRecord(value.attempt.startIntent)) {
		throw new Error("calibration attempt file bindings must be objects");
	}
	exactKeys(value.attempt.lock, ["absolutePath", "byteSha256"], "calibration.attempt.lock");
	exactKeys(value.attempt.startIntent, ["absolutePath", "byteSha256"], "calibration.attempt.startIntent");
	if (!isRecord(value.terminal)) throw new Error("calibration.terminal must be an object");
	exactKeys(value.terminal, ["absolutePath", "byteSha256", "outcome", "verifiedArtifactRefs"], "calibration.terminal");
	if (!isRecord(value.ledger)) throw new Error("calibration.ledger must be an object");
	exactKeys(
		value.ledger,
		["absolutePath", "byteSha256", "byteLength", "eventCount", "terminalEventSequence", "terminalEventSha256"],
		"calibration.ledger",
	);
	if (!isRecord(value.verifier)) throw new Error("calibration.verifier must be an object");
	exactKeys(value.verifier, ["epoch", "requiredChecks"], "calibration.verifier");
	if (!Array.isArray(value.tasks)) throw new Error("calibration.tasks must be an array");
	const tasks = value.tasks.map((item, index) => {
		if (!isRecord(item)) throw new Error(`calibration.tasks[${index}] must be an object`);
		exactKeys(item, ["benchmarkId", "irInstructionCount", "objectTextSizeBytes", "verifierPassed"], `task ${index}`);
		return {
			benchmarkId: item.benchmarkId,
			irInstructionCount: item.irInstructionCount,
			objectTextSizeBytes: item.objectTextSizeBytes,
			verifierPassed: item.verifierPassed,
		};
	});
	return validateCalibrationBinding({
		absolutePath: absolutePath(value.absolutePath, "calibration.absolutePath"),
		byteSha256: digest(value.byteSha256, "calibration.byteSha256"),
		parsedSha256: digest(value.parsedSha256, "calibration.parsedSha256"),
		attempt: {
			attemptId: requiredString(value.attempt.attemptId, "calibration.attempt.attemptId"),
			identitySha256: digest(value.attempt.identitySha256, "calibration.attempt.identitySha256"),
			lock: {
				absolutePath: absolutePath(value.attempt.lock.absolutePath, "calibration.attempt.lock.absolutePath"),
				byteSha256: digest(value.attempt.lock.byteSha256, "calibration.attempt.lock.byteSha256"),
			},
			startIntent: {
				absolutePath: absolutePath(
					value.attempt.startIntent.absolutePath,
					"calibration.attempt.startIntent.absolutePath",
				),
				byteSha256: digest(value.attempt.startIntent.byteSha256, "calibration.attempt.startIntent.byteSha256"),
			},
		},
		terminal: {
			absolutePath: absolutePath(value.terminal.absolutePath, "calibration.terminal.absolutePath"),
			byteSha256: digest(value.terminal.byteSha256, "calibration.terminal.byteSha256"),
			outcome: value.terminal.outcome as ReducedCpuStudyCalibrationBinding["terminal"]["outcome"],
			verifiedArtifactRefs: safeInteger(
				value.terminal.verifiedArtifactRefs,
				"calibration.terminal.verifiedArtifactRefs",
				1,
			),
		},
		ledger: {
			absolutePath: absolutePath(value.ledger.absolutePath, "calibration.ledger.absolutePath"),
			byteSha256: digest(value.ledger.byteSha256, "calibration.ledger.byteSha256"),
			byteLength: safeInteger(value.ledger.byteLength, "calibration.ledger.byteLength", 1),
			eventCount: safeInteger(value.ledger.eventCount, "calibration.ledger.eventCount", 1),
			terminalEventSequence: safeInteger(
				value.ledger.terminalEventSequence,
				"calibration.ledger.terminalEventSequence",
				0,
			),
			terminalEventSha256: digest(value.ledger.terminalEventSha256, "calibration.ledger.terminalEventSha256"),
		},
		protocolVersion: value.protocolVersion as ReducedCpuStudyCalibrationBinding["protocolVersion"],
		jobId: requiredString(value.jobId, "calibration.jobId"),
		manifestDigest: digest(value.manifestDigest, "calibration.manifestDigest"),
		verifier: {
			epoch: value.verifier.epoch as ReducedCpuStudyCalibrationBinding["verifier"]["epoch"],
			requiredChecks: value.verifier
				.requiredChecks as ReducedCpuStudyCalibrationBinding["verifier"]["requiredChecks"],
		},
		hardware: value.hardware as Record<string, string>,
		provenance: value.provenance as Record<string, string>,
		tasks: tasks as ReducedCpuCalibration["tasks"],
	});
}

function parseSourceBindings(value: unknown): ReducedCpuStudySourceBinding[] {
	if (!Array.isArray(value)) throw new Error("implementationSources must be an array");
	return validateSourceBindings(
		value.map((source, index) => {
			if (!isRecord(source)) throw new Error(`implementationSources[${index}] must be an object`);
			exactKeys(source, ["relativePath", "byteSha256"], `implementationSources[${index}]`);
			return {
				relativePath: requiredString(
					source.relativePath,
					`implementationSources[${index}].relativePath`,
				) as ReducedCpuStudySourceBinding["relativePath"],
				byteSha256: digest(source.byteSha256, `implementationSources[${index}].byteSha256`),
			};
		}),
	);
}

export function parseReducedCpuStudyPreregistration(value: unknown): ReducedCpuStudyPreregistration {
	if (!isRecord(value)) throw new Error("reduced CPU preregistration must be an object");
	const repository = value.repository;
	const launch = value.launch;
	if (!isRecord(repository) || !isRecord(launch)) throw new Error("preregistration repository or launch is missing");
	if (!Array.isArray(value.executionOrder)) throw new Error("executionOrder must be an array");
	const executionOrder = value.executionOrder.map((arm) => {
		if (!REDUCED_CPU_STUDY_ARMS.includes(arm as ReducedCpuStudyArm)) throw new Error(`unknown arm: ${String(arm)}`);
		return arm as ReducedCpuStudyArm;
	});
	validateArmOrder(executionOrder);
	const expected = buildReducedCpuStudyPreregistration({
		createdAt: requiredString(value.createdAt, "createdAt"),
		repoRoot: absolutePath(repository.repoRoot, "repository.repoRoot"),
		currentHead: requiredString(repository.currentHead, "repository.currentHead"),
		campaignRoot: absolutePath(launch.campaignRoot, "launch.campaignRoot"),
		calibration: parseCalibrationBinding(value.calibration),
		executionOrder,
		implementationSources: parseSourceBindings(value.implementationSources),
	});
	assert.deepEqual(value, expected, "reduced CPU preregistration does not match the immutable v1 contract");
	return expected;
}

function byteSha256(contents: Uint8Array): string {
	return createHash("sha256").update(contents).digest("hex");
}

async function readPrivateRegularFile(
	path: string,
	label: string,
): Promise<{ absolutePath: string; contents: Buffer; byteSha256: string }> {
	const canonical = await realpath(path);
	if (canonical !== path) throw new Error(`${label} path must be canonical and symlink-free`);
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
	if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${label} must be mode 0600`);
	const contents = await readFile(path);
	return { absolutePath: path, contents, byteSha256: byteSha256(contents) };
}

function parseJsonRecord(contents: Uint8Array, label: string): Record<string, unknown> {
	const value: unknown = JSON.parse(Buffer.from(contents).toString("utf8"));
	if (!isRecord(value)) throw new Error(`${label} must contain one JSON object`);
	return value;
}

export async function captureReducedCpuStudyCalibrationBinding(
	calibrationPath: string,
): Promise<ReducedCpuStudyCalibrationBinding> {
	const absolute = absolutePath(calibrationPath, "calibration path");
	const calibrationFile = await readPrivateRegularFile(absolute, "calibration file");
	const calibrationValue: unknown = JSON.parse(calibrationFile.contents.toString("utf8"));
	const parsed = parseReducedCpuCalibration(calibrationValue);
	const envelope = calibrationValue as ReducedCpuCalibrationEnvelope;
	const calibrationDirectory = dirname(calibrationFile.absolutePath);

	const terminalFile = await readPrivateRegularFile(join(calibrationDirectory, "result.json"), "calibration result");
	const terminal = parseJsonRecord(terminalFile.contents, "calibration result");
	exactKeys(
		terminal,
		[
			"schemaVersion",
			"type",
			"protocolVersion",
			"outcome",
			"attemptId",
			"attemptIdentitySha256",
			"startedAt",
			"finishedAt",
			"deadlineMs",
			"submitted",
			"externalJobIdentities",
			"knownJobs",
			"knownLedgerState",
			"ledgerTerminalManifestError",
			"calibrationPath",
			"verifiedArtifactRefs",
			"error",
		],
		"calibration result",
	);
	if (terminal.schemaVersion !== 1 || terminal.type !== "reduced_cpu_study_calibration_terminal") {
		throw new Error("calibration result schema or type drifted");
	}
	if (terminal.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION) {
		throw new Error("calibration result protocol drifted");
	}
	if (terminal.outcome !== "success") throw new Error("calibration result did not succeed");
	if (terminal.error !== null) throw new Error("successful calibration result must not contain an error");
	if (terminal.ledgerTerminalManifestError !== null) {
		throw new Error("calibration terminal ledger manifest reported an error");
	}
	if (terminal.calibrationPath !== calibrationFile.absolutePath) {
		throw new Error("calibration result path does not match calibration.json");
	}
	const attemptId = requiredString(terminal.attemptId, "calibration result attemptId");
	const attemptIdentitySha256 = digest(terminal.attemptIdentitySha256, "calibration result attemptIdentitySha256");
	const startedAt = timestamp(terminal.startedAt, "calibration result startedAt");
	const finishedAt = timestamp(terminal.finishedAt, "calibration result finishedAt");
	if (Date.parse(finishedAt) < Date.parse(startedAt)) {
		throw new Error("calibration result finished before it started");
	}
	if (terminal.deadlineMs !== REDUCED_CPU_CALIBRATION_DEADLINE_MS) {
		throw new Error("calibration result deadline drifted");
	}
	const verifiedArtifactRefs = safeInteger(
		terminal.verifiedArtifactRefs,
		"calibration result verifiedArtifactRefs",
		1,
	);
	assert.deepEqual(terminal.submitted, envelope.submitted, "calibration terminal submitted job drifted");
	assert.deepEqual(terminal.knownJobs, [envelope.job], "calibration terminal known job drifted");
	const expectedExternalJobIdentities = [
		{
			jobId: parsed.jobId,
			externalJobId: envelope.job.state.externalJobId,
			status: "succeeded",
		},
	];
	assert.deepEqual(
		terminal.externalJobIdentities,
		expectedExternalJobIdentities,
		"calibration terminal external job identity drifted",
	);

	const attemptLockFile = await readPrivateRegularFile(
		join(calibrationDirectory, "attempt.lock"),
		"calibration attempt lock",
	);
	const attemptLock = parseJsonRecord(attemptLockFile.contents, "calibration attempt lock");
	exactKeys(
		attemptLock,
		["schemaVersion", "type", "attemptId", "attemptIdentitySha256", "attemptIdentity", "startedAt"],
		"calibration attempt lock",
	);
	if (attemptLock.schemaVersion !== 1 || attemptLock.type !== "reduced_cpu_calibration_attempt_lock") {
		throw new Error("calibration attempt lock schema or type drifted");
	}
	if (attemptLock.attemptId !== attemptId || attemptLock.attemptIdentitySha256 !== attemptIdentitySha256) {
		throw new Error("calibration attempt lock identity does not match result.json");
	}
	if (attemptLock.startedAt !== startedAt) throw new Error("calibration attempt start timestamp drifted");
	if (!isRecord(attemptLock.attemptIdentity)) {
		throw new Error("calibration attempt identity must be an object");
	}
	const attemptIdentity = attemptLock.attemptIdentity;
	exactKeys(
		attemptIdentity,
		[
			"type",
			"protocolVersion",
			"outputDir",
			"branchId",
			"tasks",
			"maxSubmissions",
			"maxTaskEvaluations",
			"retryPolicy",
		],
		"calibration attempt identity",
	);
	if (
		attemptIdentity.type !== "reduced_cpu_calibration_attempt_identity" ||
		attemptIdentity.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
		attemptIdentity.outputDir !== calibrationDirectory ||
		attemptIdentity.branchId !== REDUCED_CPU_CALIBRATION_BRANCH_ID ||
		attemptIdentity.maxSubmissions !== 1 ||
		attemptIdentity.maxTaskEvaluations !== REDUCED_CPU_ALL_TASKS.length ||
		attemptIdentity.retryPolicy !== "never-retry-or-replace"
	) {
		throw new Error("calibration attempt identity contract drifted");
	}
	assert.deepEqual(attemptIdentity.tasks, REDUCED_CPU_ALL_TASKS, "calibration attempt task panel drifted");
	if (sha256Json(attemptIdentity) !== attemptIdentitySha256) {
		throw new Error("calibration attempt identity SHA-256 drifted");
	}

	const startIntentFile = await readPrivateRegularFile(
		join(calibrationDirectory, "start-intent.json"),
		"calibration start intent",
	);
	const startIntent = parseJsonRecord(startIntentFile.contents, "calibration start intent");
	exactKeys(
		startIntent,
		[
			"schemaVersion",
			"type",
			"protocolVersion",
			"attemptId",
			"attemptIdentitySha256",
			"startedAt",
			"deadlineMs",
			"retryPolicy",
		],
		"calibration start intent",
	);
	if (
		startIntent.schemaVersion !== 1 ||
		startIntent.type !== "reduced_cpu_calibration_start_intent" ||
		startIntent.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
		startIntent.attemptId !== attemptId ||
		startIntent.attemptIdentitySha256 !== attemptIdentitySha256 ||
		startIntent.startedAt !== startedAt ||
		startIntent.deadlineMs !== REDUCED_CPU_CALIBRATION_DEADLINE_MS ||
		startIntent.retryPolicy !== "never-retry-or-replace"
	) {
		throw new Error("calibration start intent does not match the successful attempt");
	}

	const ledgerFile = await readPrivateRegularFile(join(calibrationDirectory, "evidence.jsonl"), "calibration ledger");
	const ledgerText = ledgerFile.contents.toString("utf8");
	const events = verifyLedgerContentsStrict(ledgerText);
	if (events.length === 0) throw new Error("calibration ledger is empty");
	const terminalEvents = events.filter(
		(event) => isRecord(event.payload) && event.payload.type === "reduced_cpu_calibration_terminal_intent",
	);
	if (terminalEvents.length !== 1) throw new Error("calibration ledger must contain exactly one terminal intent");
	const terminalEvent = terminalEvents[0];
	if (terminalEvent !== events.at(-1) || terminalEvent.kind !== "run_manifest") {
		throw new Error("calibration terminal intent must be the final ledger run manifest");
	}
	if (!isRecord(terminalEvent.payload)) throw new Error("calibration terminal ledger payload must be an object");
	const terminalPayload = terminalEvent.payload;
	exactKeys(
		terminalPayload,
		[
			"schemaVersion",
			"type",
			"protocolVersion",
			"attemptId",
			"attemptIdentitySha256",
			"outcome",
			"externalJobIdentities",
			"finishedAt",
		],
		"calibration terminal ledger payload",
	);
	if (
		terminalPayload.schemaVersion !== 1 ||
		terminalPayload.type !== "reduced_cpu_calibration_terminal_intent" ||
		terminalPayload.protocolVersion !== REDUCED_CPU_STUDY_PROTOCOL_VERSION ||
		terminalPayload.attemptId !== attemptId ||
		terminalPayload.attemptIdentitySha256 !== attemptIdentitySha256 ||
		terminalPayload.outcome !== "success"
	) {
		throw new Error("calibration terminal ledger payload does not match the successful attempt");
	}
	assert.deepEqual(
		terminalPayload.externalJobIdentities,
		expectedExternalJobIdentities,
		"calibration terminal ledger job identity drifted",
	);
	const terminalIntentFinishedAt = timestamp(terminalPayload.finishedAt, "calibration terminal ledger finishedAt");
	if (
		Date.parse(terminalIntentFinishedAt) < Date.parse(startedAt) ||
		Date.parse(terminalIntentFinishedAt) > Date.parse(finishedAt)
	) {
		throw new Error("calibration terminal ledger timestamp is outside the attempt interval");
	}
	if (!isRecord(terminal.knownLedgerState)) {
		throw new Error("calibration result knownLedgerState must be an object");
	}
	const knownLedgerState = terminal.knownLedgerState;
	exactKeys(
		knownLedgerState,
		["path", "exists", "byteLength", "sha256", "eventCount", "strictVerificationPassed", "error"],
		"calibration result knownLedgerState",
	);
	if (
		knownLedgerState.path !== ledgerFile.absolutePath ||
		knownLedgerState.exists !== true ||
		knownLedgerState.byteLength !== ledgerFile.contents.byteLength ||
		knownLedgerState.sha256 !== ledgerFile.byteSha256 ||
		knownLedgerState.eventCount !== events.length ||
		knownLedgerState.strictVerificationPassed !== true ||
		knownLedgerState.error !== null
	) {
		throw new Error("calibration result does not bind the strictly verified ledger bytes");
	}
	return validateCalibrationBinding({
		absolutePath: calibrationFile.absolutePath,
		byteSha256: calibrationFile.byteSha256,
		parsedSha256: sha256Json(parsed),
		attempt: {
			attemptId,
			identitySha256: attemptIdentitySha256,
			lock: { absolutePath: attemptLockFile.absolutePath, byteSha256: attemptLockFile.byteSha256 },
			startIntent: { absolutePath: startIntentFile.absolutePath, byteSha256: startIntentFile.byteSha256 },
		},
		terminal: {
			absolutePath: terminalFile.absolutePath,
			byteSha256: terminalFile.byteSha256,
			outcome: "success",
			verifiedArtifactRefs,
		},
		ledger: {
			absolutePath: ledgerFile.absolutePath,
			byteSha256: ledgerFile.byteSha256,
			byteLength: ledgerFile.contents.byteLength,
			eventCount: events.length,
			terminalEventSequence: terminalEvent.sequence,
			terminalEventSha256: terminalEvent.hash,
		},
		protocolVersion: parsed.protocolVersion,
		jobId: parsed.jobId,
		manifestDigest: parsed.manifestDigest,
		verifier: { epoch: parsed.verifierEpoch, requiredChecks: [...REDUCED_CPU_REQUIRED_VERIFIER_CHECKS] },
		hardware: { ...parsed.hardware },
		provenance: { ...parsed.provenance },
		tasks: parsed.tasks.map((task) => ({ ...task })),
	});
}

export async function captureReducedCpuStudySourceBindings(
	repoRootInput: string,
): Promise<ReducedCpuStudySourceBinding[]> {
	const repoRoot = await realpath(absolutePath(repoRootInput, "repoRoot"));
	return Promise.all(
		[...REDUCED_CPU_STUDY_SOURCE_PATHS].sort().map(async (relativePath) => {
			const absolute = resolve(repoRoot, relativePath);
			const canonical = await realpath(absolute);
			const relativeCanonical = relative(repoRoot, canonical);
			if (
				relativeCanonical === ".." ||
				relativeCanonical.startsWith(`..${sep}`) ||
				isAbsolute(relativeCanonical) ||
				canonical !== absolute
			) {
				throw new Error(`implementation source escaped the repository: ${relativePath}`);
			}
			const metadata = await stat(canonical);
			if (!metadata.isFile()) throw new Error(`implementation source is not a file: ${relativePath}`);
			return { relativePath, byteSha256: byteSha256(await readFile(canonical)) };
		}),
	);
}

async function gitHead(repoRoot: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
	const head = stdout.trim();
	if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("git rev-parse returned an invalid HEAD");
	return head;
}

async function assertPathMissing(path: string, label: string): Promise<void> {
	try {
		await lstat(path);
		throw new Error(`${label} already exists: ${path}`);
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") return;
		throw error;
	}
}

export async function assertReducedCpuStudyExecutionFresh(
	preregistration: ReducedCpuStudyPreregistration,
): Promise<void> {
	await Promise.all([
		assertPathMissing(preregistration.launch.outputRoot, "campaign output directory"),
		...preregistration.arms.map((arm) => assertPathMissing(arm.absoluteOutputDir, `${arm.id} output directory`)),
		assertPathMissing(preregistration.attemptLocks.campaign.path, "campaign attempt lock"),
		...REDUCED_CPU_STUDY_ARMS.map((arm) =>
			assertPathMissing(preregistration.attemptLocks.arms[arm].path, `${arm} attempt lock`),
		),
	]);
}

export async function writeReducedCpuStudyPreregistration(
	pathInput: string,
	preregistration: ReducedCpuStudyPreregistration,
): Promise<{ path: string; fileSha256: string }> {
	const path = absolutePath(pathInput, "preregistration path");
	const serialized = `${canonicalJson(toJsonValue(preregistration))}\n`;
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(serialized, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(path, 0o600);
	return { path, fileSha256: sha256Text(serialized) };
}

export async function readAndVerifyReducedCpuStudyPreregistration(
	pathInput: string,
	options: { requireFreshExecution?: boolean } = {},
): Promise<{ preregistration: ReducedCpuStudyPreregistration; fileSha256: string }> {
	const path = absolutePath(pathInput, "preregistration path");
	const metadata = await stat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
		throw new Error("preregistration must be a mode-0600 regular file");
	}
	const contents = await readFile(path);
	const text = contents.toString("utf8");
	const preregistration = parseReducedCpuStudyPreregistration(JSON.parse(text));
	if (path !== preregistration.launch.preregistrationPath) throw new Error("preregistration launch path drifted");
	if (`${canonicalJson(toJsonValue(preregistration))}\n` !== text) {
		throw new Error("preregistration bytes are not the one canonical newline-terminated serialization");
	}
	if ((await gitHead(preregistration.repository.repoRoot)) !== preregistration.repository.currentHead) {
		throw new Error("Prime Agent HEAD drifted after preregistration");
	}
	assert.deepEqual(
		await captureReducedCpuStudySourceBindings(preregistration.repository.repoRoot),
		preregistration.implementationSources,
		"reduced CPU implementation source bytes drifted",
	);
	assert.deepEqual(
		await captureReducedCpuStudyCalibrationBinding(preregistration.calibration.absolutePath),
		preregistration.calibration,
		"reduced CPU calibration bytes or semantics drifted",
	);
	if (options.requireFreshExecution ?? true) await assertReducedCpuStudyExecutionFresh(preregistration);
	return { preregistration, fileSha256: byteSha256(contents) };
}

export async function claimReducedCpuStudyAttemptLocks(preregistration: ReducedCpuStudyPreregistration): Promise<void> {
	await mkdir(preregistration.attemptLocks.root, { recursive: true, mode: 0o700 });
	const scopes: Array<"campaign" | ReducedCpuStudyArm> = ["campaign", ...REDUCED_CPU_STUDY_ARMS];
	for (const scope of scopes) {
		const lock =
			scope === "campaign" ? preregistration.attemptLocks.campaign : preregistration.attemptLocks.arms[scope];
		const contents = lockContents({
			scientificIdentitySha256: preregistration.scientificIdentitySha256,
			scope,
		});
		if (sha256Text(contents) !== lock.expectedContentsSha256) {
			throw new Error(`attempt lock content hash drifted for ${scope}`);
		}
		const handle = await open(lock.path, "wx", 0o600);
		try {
			await handle.chmod(0o600);
			await handle.writeFile(contents, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
	}
}

export async function generateReducedCpuStudyPreregistration(input: {
	repoRoot: string;
	campaignRoot: string;
	calibrationPath: string;
	executionOrder?: readonly [ReducedCpuStudyArm, ReducedCpuStudyArm, ReducedCpuStudyArm];
	createdAt?: string;
}): Promise<{ preregistration: ReducedCpuStudyPreregistration; path: string; fileSha256: string }> {
	const repoRoot = await realpath(absolutePath(input.repoRoot, "repoRoot"));
	const campaignRoot = absolutePath(input.campaignRoot, "campaignRoot");
	await mkdir(dirname(campaignRoot), { recursive: true, mode: 0o700 });
	await assertPathMissing(campaignRoot, "campaign root");
	const calibration = await captureReducedCpuStudyCalibrationBinding(input.calibrationPath);
	const preregistration = buildReducedCpuStudyPreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		repoRoot,
		currentHead: await gitHead(repoRoot),
		campaignRoot,
		calibration,
		executionOrder: input.executionOrder ?? REDUCED_CPU_STUDY_ARMS,
		implementationSources: await captureReducedCpuStudySourceBindings(repoRoot),
	});
	await assertReducedCpuStudyExecutionFresh(preregistration);
	await mkdir(campaignRoot, { mode: 0o700 });
	const written = await writeReducedCpuStudyPreregistration(
		preregistration.launch.preregistrationPath,
		preregistration,
	);
	return { preregistration, ...written };
}

function parseCli(argv: readonly string[]): {
	campaignRoot: string;
	calibrationPath: string;
	executionOrder: [ReducedCpuStudyArm, ReducedCpuStudyArm, ReducedCpuStudyArm];
} {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key || !value || !key.startsWith("--") || values.has(key)) throw new Error("invalid or duplicate option");
		values.set(key, value);
	}
	for (const key of values.keys()) {
		if (key !== "--campaign-root" && key !== "--calibration" && key !== "--arm-order") {
			throw new Error(`unknown option: ${key}`);
		}
	}
	const campaignRoot = values.get("--campaign-root");
	const calibrationPath = values.get("--calibration");
	if (!campaignRoot || !calibrationPath) {
		throw new Error(
			"Usage: reduced-cpu-study-preregister --campaign-root <fresh-absolute-path> --calibration <absolute-path> [--arm-order stock,M,M+R]",
		);
	}
	const executionOrder = (values.get("--arm-order") ?? REDUCED_CPU_STUDY_ARMS.join(",")).split(",");
	validateArmOrder(executionOrder as ReducedCpuStudyArm[]);
	return {
		campaignRoot: absolutePath(campaignRoot, "--campaign-root"),
		calibrationPath: absolutePath(calibrationPath, "--calibration"),
		executionOrder: executionOrder as [ReducedCpuStudyArm, ReducedCpuStudyArm, ReducedCpuStudyArm],
	};
}

async function main(): Promise<void> {
	const options = parseCli(process.argv.slice(2));
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const result = await generateReducedCpuStudyPreregistration({ repoRoot, ...options });
	process.stdout.write(
		`${canonicalJson(
			toJsonValue({
				type: "reduced_cpu_study_preregistered",
				protocol: REDUCED_CPU_STUDY_PREREGISTRATION_PROTOCOL,
				path: result.path,
				preregistrationSha256: result.preregistration.preregistrationSha256,
				fileSha256: result.fileSha256,
				executionOrder: result.preregistration.executionOrder,
			}),
		)}\n`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	void main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

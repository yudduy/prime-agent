import type { ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	NANOGPT_BASELINE_FIXTURE,
	NANOGPT_BASELINE_SHA256,
	NANOGPT_CONTRACT_ID,
	NANOGPT_PROGRAM_SHA256,
	NANOGPT_SPEEDRUN_COMMIT,
	NANOGPT_SPEEDRUN_REPOSITORY,
} from "./nanogpt-contract.js";

export const NANOGPT_RUNTIME_CONTRACT_ID = "nanogpt-track3-runtime-contract-v2" as const;
export const NANOGPT_RUNTIME_EVALUATOR = fileURLToPath(new URL("../evaluators/nanogpt_runtime.py", import.meta.url));
export const NANOGPT_RUNTIME_CANDIDATE_NAME = "candidate.source.py" as const;
export const NANOGPT_RUNTIME_PROGRAM_NAME = "train_gpt_runtime.py" as const;
export const NANOGPT_RUNTIME_MANIFEST_NAME = "runtime-manifest.json" as const;
export const NANOGPT_RUNTIME_CLAIM_SCOPE =
	"Only the byte-exact pinned stock fixture may be claimed to have compiled and completed 10 training steps in cuda-smoke-10 mode with seed 0xC0FFEE; no candidate-quality, score, or record claim is permitted." as const;
export type NanoGptRuntimeMode = "cuda-smoke-10";
export type NanoGptRuntimeRequestedMode = NanoGptRuntimeMode | "scored";
export type NanoGptRuntimeOperation = "materialize" | "verify" | "extract";

export interface NanoGptRuntimeError {
	readonly code: string;
	readonly message: string;
}

export interface NanoGptRuntimeManifest {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_RUNTIME_CONTRACT_ID;
	readonly repository: typeof NANOGPT_SPEEDRUN_REPOSITORY;
	readonly commit: typeof NANOGPT_SPEEDRUN_COMMIT;
	readonly programSha256: typeof NANOGPT_PROGRAM_SHA256;
	readonly staticContract: typeof NANOGPT_CONTRACT_ID;
	readonly mode: "cuda-smoke-10";
	readonly declaredTrainSteps: 3290;
	readonly effectiveTrainSteps: 10;
	readonly expectedTrials: 1;
	readonly expectedSeeds: readonly [0xc0ffee];
	readonly claimScope: typeof NANOGPT_RUNTIME_CLAIM_SCOPE;
	readonly candidate: {
		readonly path: typeof NANOGPT_RUNTIME_CANDIDATE_NAME;
		readonly sha256: typeof NANOGPT_BASELINE_SHA256;
	};
	readonly runtime: {
		readonly path: typeof NANOGPT_RUNTIME_PROGRAM_NAME;
		readonly sha256: string;
	};
	readonly evaluators: {
		readonly staticSha256: string;
		readonly runtimeSha256: string;
	};
	readonly sourceIntegrity: {
		readonly baselineSha256: typeof NANOGPT_BASELINE_SHA256;
		readonly patchSha256: null;
		readonly frozenSegmentSha256: readonly string[];
		readonly editableSegmentSha256: readonly string[];
	};
	readonly launch: {
		readonly executable: "torchrun";
		readonly args: readonly string[];
		readonly worldSize: 1;
		readonly gpus: 1;
		readonly cwdPolicy: "fresh-job-directory";
		readonly runtimeLog: "logs/nanogpt-runtime.log";
		readonly requiredDataGlobs: readonly string[];
		readonly forbiddenEnvironment: readonly string[];
	};
	readonly acceptance: {
		readonly candidatePolicy: "byte-exact-pinned-stock-fixture-only";
		readonly requiredMode: "cuda-smoke-10";
		readonly requiredTrials: 1;
		readonly requiredSeed: 0xc0ffee;
		readonly requiredDeclaredTrainSteps: 3290;
		readonly requiredEffectiveTrainSteps: 10;
		readonly scoredEligible: false;
		readonly recordEligible: false;
		readonly partialCurvesAccepted: false;
	};
	readonly externalPrerequisites: readonly string[];
}

export interface NanoGptRuntimeMetrics {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_RUNTIME_CONTRACT_ID;
	readonly ok: true;
	readonly mode: "cuda-smoke-10";
	readonly candidateSha256: typeof NANOGPT_BASELINE_SHA256;
	readonly runtimeSha256: string;
	readonly declaredTrainSteps: 3290;
	readonly effectiveTrainSteps: 10;
	readonly trials: 1;
	readonly seeds: readonly [0xc0ffee];
	readonly finalValidationLosses: readonly [number];
	readonly runtimeValidationLosses: readonly [number];
	readonly meanValidationLoss: number;
	readonly optimizerSteps: readonly [10];
	readonly backwardCalls: readonly [80];
	readonly peakVramMb: readonly [number];
	readonly environment: {
		readonly pytorch: string;
		readonly cuda: string;
		readonly gpu: string;
		readonly worldSize: 1;
	};
	readonly claimScope: typeof NANOGPT_RUNTIME_CLAIM_SCOPE;
	readonly scoredEligible: false;
	readonly recordEligible: false;
	readonly recordPassed: null;
}

export type NanoGptRuntimeCommandResult =
	| {
			readonly schemaVersion: 1;
			readonly contract: typeof NANOGPT_RUNTIME_CONTRACT_ID;
			readonly operation: "materialize" | "verify";
			readonly ok: true;
			readonly errors: readonly [];
			readonly bundlePath: string;
			readonly manifestSha256: string;
			readonly manifest: NanoGptRuntimeManifest;
	  }
	| {
			readonly schemaVersion: 1;
			readonly contract: typeof NANOGPT_RUNTIME_CONTRACT_ID;
			readonly operation: "extract";
			readonly ok: true;
			readonly errors: readonly [];
			readonly metrics: NanoGptRuntimeMetrics;
	  }
	| {
			readonly schemaVersion: 1;
			readonly contract: typeof NANOGPT_RUNTIME_CONTRACT_ID;
			readonly operation: NanoGptRuntimeOperation;
			readonly ok: false;
			readonly errors: readonly NanoGptRuntimeError[];
	  };

export type NanoGptRuntimeCandidateInput =
	| { readonly candidatePath: string; readonly patchPath?: never }
	| { readonly patchPath: string; readonly candidatePath?: never };

export type MaterializeNanoGptRuntimeOptions = NanoGptRuntimeCandidateInput & {
	readonly outputPath: string;
	readonly mode: NanoGptRuntimeRequestedMode;
	readonly trials?: 1 | 2 | 4 | 8;
	readonly baselinePath?: string;
	readonly allowBaselineSteps?: boolean;
	readonly pythonExecutable?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const observed = Object.keys(value);
	return observed.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isExactArray(value: unknown, expected: readonly unknown[]): boolean {
	return (
		Array.isArray(value) &&
		value.length === expected.length &&
		value.every((item, index) => Object.is(item, expected[index]))
	);
}

function isSha256Array(value: unknown, expectedLength: number): value is readonly string[] {
	return Array.isArray(value) && value.length === expectedLength && value.every(isSha256);
}

function isRuntimeError(value: unknown): value is NanoGptRuntimeError {
	return (
		isRecord(value) &&
		hasExactKeys(value, ["code", "message"]) &&
		typeof value.code === "string" &&
		value.code.length > 0 &&
		typeof value.message === "string"
	);
}

function parseDescriptor(value: unknown, expectedPath: string, label: string): { path: string; sha256: string } {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["path", "sha256"]) ||
		value.path !== expectedPath ||
		!isSha256(value.sha256)
	) {
		throw new Error(`${label} descriptor failed schema validation`);
	}
	return { path: value.path, sha256: value.sha256 };
}

export function parseNanoGptRuntimeManifest(value: unknown): NanoGptRuntimeManifest {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"schemaVersion",
			"contract",
			"repository",
			"commit",
			"programSha256",
			"staticContract",
			"mode",
			"declaredTrainSteps",
			"effectiveTrainSteps",
			"expectedTrials",
			"expectedSeeds",
			"claimScope",
			"candidate",
			"runtime",
			"evaluators",
			"sourceIntegrity",
			"launch",
			"acceptance",
			"externalPrerequisites",
		])
	) {
		throw new Error("NanoGPT runtime manifest must have the exact contract keys");
	}
	const candidate = parseDescriptor(value.candidate, NANOGPT_RUNTIME_CANDIDATE_NAME, "candidate");
	const runtime = parseDescriptor(value.runtime, NANOGPT_RUNTIME_PROGRAM_NAME, "runtime");
	if (candidate.sha256 !== NANOGPT_BASELINE_SHA256) {
		throw new Error("NanoGPT runtime candidate descriptor is not the pinned stock fixture");
	}
	if (
		!isRecord(value.evaluators) ||
		!hasExactKeys(value.evaluators, ["staticSha256", "runtimeSha256"]) ||
		!isSha256(value.evaluators.staticSha256) ||
		!isSha256(value.evaluators.runtimeSha256)
	) {
		throw new Error("NanoGPT runtime evaluator descriptors failed schema validation");
	}
	if (
		!isRecord(value.sourceIntegrity) ||
		!hasExactKeys(value.sourceIntegrity, [
			"baselineSha256",
			"patchSha256",
			"frozenSegmentSha256",
			"editableSegmentSha256",
		]) ||
		value.sourceIntegrity.baselineSha256 !== NANOGPT_BASELINE_SHA256 ||
		value.sourceIntegrity.patchSha256 !== null ||
		!isSha256Array(value.sourceIntegrity.frozenSegmentSha256, 4) ||
		!isSha256Array(value.sourceIntegrity.editableSegmentSha256, 3)
	) {
		throw new Error("NanoGPT runtime source-integrity evidence failed schema validation");
	}
	if (
		!isRecord(value.launch) ||
		!hasExactKeys(value.launch, [
			"executable",
			"args",
			"worldSize",
			"gpus",
			"cwdPolicy",
			"runtimeLog",
			"requiredDataGlobs",
			"forbiddenEnvironment",
		]) ||
		value.launch.executable !== "torchrun" ||
		!isExactArray(value.launch.args, [
			"--standalone",
			"--nnodes=1",
			"--nproc-per-node=1",
			NANOGPT_RUNTIME_PROGRAM_NAME,
			"1",
		]) ||
		value.launch.worldSize !== 1 ||
		value.launch.gpus !== 1 ||
		value.launch.cwdPolicy !== "fresh-job-directory" ||
		value.launch.runtimeLog !== "logs/nanogpt-runtime.log" ||
		!isExactArray(value.launch.requiredDataGlobs, [
			"data/fineweb10B/fineweb_val_*.bin",
			"data/fineweb10B/fineweb_train_*.bin",
		]) ||
		!isExactArray(value.launch.forbiddenEnvironment, ["WANDB_API_KEY", "WANDB_MODE", "WANDB_ENTITY"])
	) {
		throw new Error("NanoGPT runtime launch descriptor failed schema validation");
	}
	if (
		!isRecord(value.acceptance) ||
		!hasExactKeys(value.acceptance, [
			"candidatePolicy",
			"requiredMode",
			"requiredTrials",
			"requiredSeed",
			"requiredDeclaredTrainSteps",
			"requiredEffectiveTrainSteps",
			"scoredEligible",
			"recordEligible",
			"partialCurvesAccepted",
		]) ||
		value.acceptance.candidatePolicy !== "byte-exact-pinned-stock-fixture-only" ||
		value.acceptance.requiredMode !== "cuda-smoke-10" ||
		value.acceptance.requiredTrials !== 1 ||
		value.acceptance.requiredSeed !== 0xc0ffee ||
		value.acceptance.requiredDeclaredTrainSteps !== 3290 ||
		value.acceptance.requiredEffectiveTrainSteps !== 10 ||
		value.acceptance.scoredEligible !== false ||
		value.acceptance.recordEligible !== false ||
		value.acceptance.partialCurvesAccepted !== false
	) {
		throw new Error("NanoGPT runtime acceptance descriptor failed schema validation");
	}
	if (
		value.schemaVersion !== 1 ||
		value.contract !== NANOGPT_RUNTIME_CONTRACT_ID ||
		value.repository !== NANOGPT_SPEEDRUN_REPOSITORY ||
		value.commit !== NANOGPT_SPEEDRUN_COMMIT ||
		value.programSha256 !== NANOGPT_PROGRAM_SHA256 ||
		value.staticContract !== NANOGPT_CONTRACT_ID ||
		value.mode !== "cuda-smoke-10" ||
		value.declaredTrainSteps !== 3290 ||
		value.effectiveTrainSteps !== 10 ||
		value.expectedTrials !== 1 ||
		!isExactArray(value.expectedSeeds, [0xc0ffee]) ||
		value.claimScope !== NANOGPT_RUNTIME_CLAIM_SCOPE ||
		!isExactArray(value.externalPrerequisites, [
			"A frozen CUDA/PyTorch environment manifest must be verified before launch.",
			"Every FineWeb shard must match an evaluator-owned content manifest before launch.",
			"The worker must stage this bundle in a fresh directory and reject forbidden W&B environment variables.",
		])
	) {
		throw new Error("NanoGPT runtime manifest failed schema validation");
	}
	return {
		...value,
		candidate,
		runtime,
	} as NanoGptRuntimeManifest;
}

export function parseNanoGptRuntimeMetrics(value: unknown): NanoGptRuntimeMetrics {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"schemaVersion",
			"contract",
			"ok",
			"mode",
			"candidateSha256",
			"runtimeSha256",
			"declaredTrainSteps",
			"effectiveTrainSteps",
			"trials",
			"seeds",
			"finalValidationLosses",
			"runtimeValidationLosses",
			"meanValidationLoss",
			"optimizerSteps",
			"backwardCalls",
			"peakVramMb",
			"environment",
			"claimScope",
			"scoredEligible",
			"recordEligible",
			"recordPassed",
		]) ||
		!isRecord(value.environment) ||
		!hasExactKeys(value.environment, ["pytorch", "cuda", "gpu", "worldSize"])
	) {
		throw new Error("NanoGPT runtime metrics must have the exact contract keys");
	}
	const finalLosses = value.finalValidationLosses;
	const runtimeLosses = value.runtimeValidationLosses;
	const peakVram = value.peakVramMb;
	if (
		value.schemaVersion !== 1 ||
		value.contract !== NANOGPT_RUNTIME_CONTRACT_ID ||
		value.ok !== true ||
		value.mode !== "cuda-smoke-10" ||
		value.candidateSha256 !== NANOGPT_BASELINE_SHA256 ||
		!isSha256(value.runtimeSha256) ||
		value.declaredTrainSteps !== 3290 ||
		value.effectiveTrainSteps !== 10 ||
		value.trials !== 1 ||
		!isExactArray(value.seeds, [0xc0ffee]) ||
		!Array.isArray(finalLosses) ||
		finalLosses.length !== 1 ||
		!isFiniteNumber(finalLosses[0]) ||
		finalLosses[0] <= 0 ||
		!Array.isArray(runtimeLosses) ||
		runtimeLosses.length !== 1 ||
		!isFiniteNumber(runtimeLosses[0]) ||
		runtimeLosses[0] <= 0 ||
		Math.abs(finalLosses[0] - runtimeLosses[0]) > 0.0000051 ||
		!isFiniteNumber(value.meanValidationLoss) ||
		value.meanValidationLoss !== finalLosses[0] ||
		!isExactArray(value.optimizerSteps, [10]) ||
		!isExactArray(value.backwardCalls, [80]) ||
		!Array.isArray(peakVram) ||
		peakVram.length !== 1 ||
		!isFiniteNumber(peakVram[0]) ||
		peakVram[0] < 0 ||
		typeof value.environment.pytorch !== "string" ||
		value.environment.pytorch.length === 0 ||
		typeof value.environment.cuda !== "string" ||
		value.environment.cuda.length === 0 ||
		typeof value.environment.gpu !== "string" ||
		value.environment.gpu.length === 0 ||
		value.environment.worldSize !== 1 ||
		value.claimScope !== NANOGPT_RUNTIME_CLAIM_SCOPE ||
		value.scoredEligible !== false ||
		value.recordEligible !== false ||
		value.recordPassed !== null
	) {
		throw new Error("NanoGPT runtime metrics failed schema validation");
	}
	return value as unknown as NanoGptRuntimeMetrics;
}

export function parseNanoGptRuntimeCommandResult(stdout: string): NanoGptRuntimeCommandResult {
	const value: unknown = JSON.parse(stdout);
	if (!isRecord(value)) throw new Error("NanoGPT runtime command result must be an object");
	if (
		value.schemaVersion !== 1 ||
		value.contract !== NANOGPT_RUNTIME_CONTRACT_ID ||
		(value.operation !== "materialize" && value.operation !== "verify" && value.operation !== "extract") ||
		typeof value.ok !== "boolean" ||
		!Array.isArray(value.errors) ||
		!value.errors.every(isRuntimeError)
	) {
		throw new Error("NanoGPT runtime command result failed base schema validation");
	}
	if (!value.ok) {
		if (
			!hasExactKeys(value, ["schemaVersion", "contract", "operation", "ok", "errors"]) ||
			value.errors.length === 0
		) {
			throw new Error("failed NanoGPT runtime result must contain only its structured error payload");
		}
		return value as NanoGptRuntimeCommandResult;
	}
	if (value.errors.length !== 0) throw new Error("successful NanoGPT runtime result cannot include errors");
	if (value.operation === "extract") {
		if (!hasExactKeys(value, ["schemaVersion", "contract", "operation", "ok", "errors", "metrics"])) {
			throw new Error("NanoGPT runtime extract result has unexpected keys");
		}
		parseNanoGptRuntimeMetrics(value.metrics);
	} else {
		if (
			!hasExactKeys(value, [
				"schemaVersion",
				"contract",
				"operation",
				"ok",
				"errors",
				"bundlePath",
				"manifestSha256",
				"manifest",
			]) ||
			typeof value.bundlePath !== "string" ||
			value.bundlePath.length === 0 ||
			!isSha256(value.manifestSha256)
		) {
			throw new Error("NanoGPT runtime bundle result failed schema validation");
		}
		parseNanoGptRuntimeManifest(value.manifest);
	}
	return value as NanoGptRuntimeCommandResult;
}

function runRuntimeEvaluator(
	args: readonly string[],
	pythonExecutable = "python3",
): Promise<NanoGptRuntimeCommandResult> {
	return new Promise((resolve, reject) => {
		execFile(
			pythonExecutable,
			[NANOGPT_RUNTIME_EVALUATOR, ...args],
			{ encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
			(error: ExecFileException | null, stdout, stderr) => {
				let result: NanoGptRuntimeCommandResult;
				try {
					result = parseNanoGptRuntimeCommandResult(stdout);
				} catch (parseError) {
					reject(
						new Error(
							`NanoGPT runtime evaluator returned invalid output: ${parseError instanceof Error ? parseError.message : String(parseError)}; stderr=${stderr.trim()}`,
						),
					);
					return;
				}
				if (error && error.code !== 2) {
					reject(new Error(`NanoGPT runtime evaluator failed: ${error.message}; stderr=${stderr.trim()}`));
					return;
				}
				if (Boolean(error) === result.ok) {
					reject(new Error("NanoGPT runtime evaluator exit status disagrees with its result"));
					return;
				}
				resolve(result);
			},
		);
	});
}

export function materializeNanoGptRuntime(
	options: MaterializeNanoGptRuntimeOptions,
): Promise<NanoGptRuntimeCommandResult> {
	const args = [
		"materialize",
		"--baseline",
		options.baselinePath ?? NANOGPT_BASELINE_FIXTURE,
		"--output",
		options.outputPath,
		"--mode",
		options.mode,
		"--trials",
		String(options.trials ?? 1),
	];
	if (typeof options.candidatePath === "string") args.push("--candidate", options.candidatePath);
	else if (typeof options.patchPath === "string") args.push("--patch", options.patchPath);
	else throw new Error("NanoGPT runtime materialization requires exactly one candidatePath or patchPath");
	if (options.allowBaselineSteps) args.push("--allow-baseline-steps");
	return runRuntimeEvaluator(args, options.pythonExecutable);
}

export function verifyNanoGptRuntimeBundle(
	bundlePath: string,
	pythonExecutable?: string,
): Promise<NanoGptRuntimeCommandResult> {
	return runRuntimeEvaluator(["verify", "--bundle", bundlePath], pythonExecutable);
}

export function extractNanoGptRuntimeMetrics(options: {
	readonly bundlePath: string;
	readonly logPath: string;
	readonly exitCode: number;
	readonly pythonExecutable?: string;
}): Promise<NanoGptRuntimeCommandResult> {
	if (!Number.isSafeInteger(options.exitCode)) throw new Error("NanoGPT runtime exit code must be a safe integer");
	return runRuntimeEvaluator(
		["extract", "--bundle", options.bundlePath, "--log", options.logPath, "--exit-code", String(options.exitCode)],
		options.pythonExecutable,
	);
}

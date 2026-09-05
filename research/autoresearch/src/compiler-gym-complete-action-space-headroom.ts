import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { type LedgerEvent, verifyLedgerContentsStrict } from "./ledger.js";

export const COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL = "compiler-gym-complete-action-space-headroom-v1" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_CONTRACT =
	"compiler-gym-complete-action-space-headroom-eval-v1" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_TERMINAL_VERIFIER_CONTRACT =
	"compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK = "benchmark://cbench-v1/dijkstra" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_PATH =
	".autoresearch/compiler-gym-latency-audit/analysis-v1.json" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_SHA256 =
	"08d50b4fdd32c8e435f9549c79030419d814a7ebaf3cb72e214e2fde0d583d73" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_PATH =
	"research/autoresearch/evaluators/compiler_gym_eval.py" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256 =
	"1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_PATH =
	"research/autoresearch/src/stock-interface-parity-protocol.ts" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_SOURCE_SHA256 =
	"6f5a290fc9f34c308c3c0616ffb233308c739b1f84590d8f9b151f0bf6fc626f" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_PATH =
	"research/autoresearch/evaluators/compiler_gym_complete_action_space_headroom_eval.py" as const;

export const COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256 =
	"9af00634caf10684e371d135cc89d49d03549d47d5577930dab0b21bb8f0c8bf" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256 =
	"d0df5c3f5780ad4deb9c13ef868c22805242efa3a916bbb8908335ff591d7cc4" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256 =
	"38e3302fe1a338887cc467aef313e8d053b939ab9f12bd9d3fe74c9ec1e54b85" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_OBSERVED_FLAGS_SHA256 =
	"4579d8f63e066ada6ab48ff26e746725431d0ac02c73de240d516878298fce20" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256 =
	"3d6fc3c2a39f065f1e5eaabac95573e9f1b51abd8e58167a836a9b72687beb6b" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256 =
	"1d9d4c9ea0b4cc76aa4b184df01d17a35cf15c9c4cfed2356421b8b463f345b7" as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256 =
	"17dc0d0508b17e2e8abe74f045e48d65b4a4f4ea1b766dc8286b925d01f97747" as const;

export const COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD = [
	"-mem2reg",
	"-sroa",
	"-instcombine",
	"-simplifycfg",
	"-adce",
	"-dce",
] as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_INSERTION_INDEX = 2 as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_IR_IMPROVEMENT = 3 as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_NUMERATOR = 1 as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_DENOMINATOR = 200 as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS = 2 as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_CPU_SECONDS_SOFT_LIMIT = 540 as const;
export const COMPILER_GYM_COMPLETE_ACTION_SPACE_WALL_SECONDS_SOFT_LIMIT = 540 as const;

const EXPECTED_LEDGER_COUNT = 21;
const EXPECTED_PROPOSAL_COUNT = 69;
const EXPECTED_UNIQUE_ARTIFACT_COUNT = 54;
const EXPECTED_ALLOWED_FLAG_COUNT = 124;
const EXPECTED_SHOWN_FLAG_COUNT = 26;
const EXPECTED_OBSERVED_FLAG_COUNT = 25;
const EXPECTED_OMITTED_FLAG_COUNT = 98;
const DEVELOPMENT_BENCHMARKS = ["benchmark://cbench-v1/blowfish", "benchmark://cbench-v1/bzip2"] as const;
const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HEADROOM_REMOTE_SOURCE_ROOT =
	"/scratch/users/duynguy/prime-autoresearch-private/complete-action-space-headroom-v1/bundles" as const;

function headroomExecutionIdentity(headroomEvaluatorSha256: string): {
	sourceBundleSha256: string;
	sourceDirectory: string;
	jobName: string;
	transientCache: string;
	argv: string[];
} {
	if (!SHA256_PATTERN.test(headroomEvaluatorSha256)) throw new Error("Headroom evaluator source hash is invalid");
	const sourceBundleSha256 = sha256Json([
		{
			remoteName: "compiler_gym_eval.py",
			sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256,
		},
		{
			remoteName: "compiler_gym_complete_action_space_headroom_eval.py",
			sha256: headroomEvaluatorSha256,
		},
	]);
	const sourceDirectory = `${HEADROOM_REMOTE_SOURCE_ROOT}/${sourceBundleSha256}`;
	const dispatchIdentity = sha256Json({
		protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
		requestSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256,
		sourceBundleSha256,
	});
	const jobName = `cg-head-${dispatchIdentity.slice(0, 20)}`;
	const transientCache = `/tmp/prime-cg-head-${dispatchIdentity.slice(0, 20)}`;
	return {
		sourceBundleSha256,
		sourceDirectory,
		jobName,
		transientCache,
		argv: [
			"/usr/bin/srun",
			"--partition=normal",
			"--constraint=CPU_SKU:9384X",
			"--nodes=1",
			"--ntasks=1",
			"--cpus-per-task=1",
			"--mem=8G",
			"--time=00:10:00",
			"--kill-on-bad-exit=1",
			"--export=NONE",
			`--job-name=${jobName}`,
			`--chdir=${sourceDirectory}`,
			"/usr/bin/env",
			"PATH=/usr/bin:/bin",
			"LANG=C.UTF-8",
			"LD_LIBRARY_PATH=/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib",
			"COMPILER_GYM_CACHE=/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache",
			"COMPILER_GYM_SITE_DATA=/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2",
			`COMPILER_GYM_TRANSIENT_CACHE=${transientCache}`,
			"PYTHONDONTWRITEBYTECODE=1",
			"PYTHONWARNINGS=ignore::FutureWarning",
			"/scratch/users/duynguy/prime-autoresearch/compiler-gym-venv-v2/bin/python",
			`${sourceDirectory}/compiler_gym_complete_action_space_headroom_eval.py`,
		],
	};
}

interface PinnedLedger {
	path: string;
	sha256: string;
	eventCount: number;
	terminalEventHash: string;
}

interface CandidateBinding {
	digest: string;
	byteLength: number;
	mediaType: string;
}

export interface CompilerGymCompleteActionSpaceLedgerSource {
	path: string;
	contents: string;
	artifacts: Readonly<Record<string, string>>;
}

export interface CompilerGymCompleteActionSpaceSources {
	analysisContents: string;
	authoritativeEvaluatorContents: string;
	actionGuideSourceContents: string;
	headroomEvaluatorContents: string;
	ledgers: readonly CompilerGymCompleteActionSpaceLedgerSource[];
}

export interface CompilerGymCompleteActionSpaceAudit {
	schemaVersion: 1;
	auditId: "compiler-gym-complete-action-space-cohort-v1";
	classification: "sealed-retrospective-interface-coverage-audit-not-treatment-evidence";
	sources: {
		analysisSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_SHA256;
		authoritativeEvaluatorSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256;
		actionGuideSourceSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_SOURCE_SHA256;
		ledgerCount: 21;
		proposalCount: 69;
		uniqueCandidateArtifactCount: 54;
		candidateArtifactSetSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256;
		ledgers: PinnedLedger[];
	};
	allowedFlags: string[];
	shownFlags: string[];
	observedFlags: string[];
	omittedFlags: string[];
	shownButUnobservedFlags: string[];
	digests: {
		allowedFlagsSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256;
		shownFlagsSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256;
		observedFlagsSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_OBSERVED_FLAGS_SHA256;
		omittedFlagsSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256;
	};
	gates: {
		exactAllowed124: boolean;
		exactShown26: boolean;
		exactObserved25: boolean;
		exactOmitted98: boolean;
		allObservedFlagsWereShown: boolean;
		exactCohort69Proposals54Artifacts: boolean;
		dijkstraAbsentFromDevelopmentCohort: boolean;
	};
	eligibleForOneAllocationHeadroomGate: boolean;
	authorizations: {
		model: false;
		provider: false;
		dispatch: false;
		paid: false;
		promotion: false;
		gpu: false;
	};
}

export interface CompilerGymCompleteActionSpaceRequest {
	schema_version: 1;
	protocol: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL;
	benchmark: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK;
	allowed_flags_sha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256;
	shown_flags_sha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256;
	omitted_flags: string[];
	omitted_flags_sha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256;
	scaffold_without_x: string[];
	insertion_index: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_INSERTION_INDEX;
	prefilter: {
		metric: "IrInstructionCount";
		minimum_absolute_improvement: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_IR_IMPROVEMENT;
		minimum_fraction_numerator: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_NUMERATOR;
		minimum_fraction_denominator: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_DENOMINATOR;
	};
	pass_gate: {
		minimum_distinct_verified_omitted_flags: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS;
	};
}

export interface CompilerGymCompleteActionSpaceProtocol {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL;
	classification: "sealed-zero-model-one-allocation-apparatus-gate-not-treatment-evidence";
	hypothesis: string;
	audit: CompilerGymCompleteActionSpaceAudit;
	design: {
		modelCalls: 0;
		allocationCount: 1;
		allocationRetries: 0;
		evaluatorTaskCount: 1;
		cpusPerTask: 1;
		evaluatorCpuMinutesMaximum: 10;
		taskWallMinutesMaximum: 10;
		schedulerLogicalCpusPerAllocation: 2;
		schedulerLogicalCpuMinutesMaximum: 20;
		allocationTimeLimit: "00:10:00";
		cpuSecondsSoftLimit: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_CPU_SECONDS_SOFT_LIMIT;
		wallSecondsSoftLimit: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_WALL_SECONDS_SOFT_LIMIT;
		benchmarkKnowledge: "dijkstra-held-out-from-sealed-development-cohort-zero-model";
		search: "exhaustive-ordered-98-flag-complement";
		prefilter: "raw-ir-only";
		terminalVerification: "existing-authoritative-20-base-callback-verifier-only-after-prefilter";
		failureDisposition: "inconclusive-apparatus-result-never-treatment-evidence";
	};
	sourceSeal: {
		authoritativeEvaluatorSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256;
		headroomEvaluatorSha256: string;
		actionGuideSourceSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_SOURCE_SHA256;
		analysisSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_SHA256;
		candidateArtifactSetSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256;
	};
	execution: {
		transport: "sealed-two-source-bundle-exact-stdin-no-shell-v1";
		host: "farmshare";
		remoteSourceRoot: typeof HEADROOM_REMOTE_SOURCE_ROOT;
		sourceBundleSha256: string;
		sourceDirectory: string;
		sources: readonly [
			{
				localPath: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_PATH;
				remoteName: "compiler_gym_eval.py";
				sha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256;
			},
			{
				localPath: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_PATH;
				remoteName: "compiler_gym_complete_action_space_headroom_eval.py";
				sha256: string;
			},
		];
		sourceInstall: {
			atomicCreateOrExistingExact: true;
			ownerOnlyMode: "0600";
			requireRegularFiles: true;
			requirePostInstallSha256: true;
		};
		workingDirectory: string;
		jobName: string;
		transientCache: string;
		argv: string[];
		stdinSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256;
		stdoutContract: "one-json-object-one-line";
		stderrContract: "diagnostic-only";
	};
	request: CompilerGymCompleteActionSpaceRequest;
	requestSha256: typeof COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256;
	passGate: {
		minimumDistinctVerifiedOmittedFlags: 2;
		requireComplete98FlagSweep: true;
		requireExisting20CallbackVerifier: true;
		requireWithinCpuCap: true;
		requireWithinWallCap: true;
	};
	authorizations: CompilerGymCompleteActionSpaceAudit["authorizations"];
}

export interface CompilerGymCompleteActionSpaceResultAssessment {
	gatePassed: boolean;
	apparatusCompleted: boolean;
	status: "passed" | "headroom_not_demonstrated" | "budget_exhausted";
	baselineIrInstructionCount: number;
	requiredImprovementInstructions: number;
	qualifiedFlags: string[];
	verifiedFlags: string[];
	observedCpuSeconds: number;
	observedWallSeconds: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
		throw new Error(`${path} keys mismatch: expected=${sortedExpected.join(",")} received=${actual.join(",")}`);
	}
}

function nonemptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function digest(value: unknown, path: string): string {
	const parsed = nonemptyString(value, path);
	if (!SHA256_PATTERN.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256`);
	return parsed;
}

function nonnegativeSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function finiteNonnegative(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${path} must be a finite nonnegative number`);
	}
	return value;
}

function stringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${path} must be a string array`);
	}
	return [...value];
}

function exactStringArray(value: unknown, expected: readonly string[], path: string): string[] {
	const parsed = stringArray(value, path);
	if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
		throw new Error(`${path} differs from the frozen array`);
	}
	return parsed;
}

function exactNonnegativeIntegerArray(value: unknown, expected: readonly number[], path: string): number[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an integer array`);
	const parsed = value.map((item, index) => nonnegativeSafeInteger(item, `${path}[${index}]`));
	if (JSON.stringify(parsed) !== JSON.stringify(expected)) throw new Error(`${path} differs from the frozen binding`);
	return parsed;
}

function parsePinnedAnalysis(contents: string): { ledgerRoot: string; inputLedgers: PinnedLedger[] } {
	if (sha256Text(contents) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_SHA256) {
		throw new Error("Pinned CompilerGym cohort analysis hash drifted");
	}
	const root = record(JSON.parse(contents) as unknown, "cohort analysis");
	if (root.schemaVersion !== 1 || root.analysisId !== "compiler-gym-allocation-latency-v1") {
		throw new Error("Pinned CompilerGym cohort analysis identity drifted");
	}
	const ledgerRoot = nonemptyString(root.ledgerRoot, "cohort analysis.ledgerRoot");
	if (ledgerRoot !== ".autoresearch") throw new Error("Pinned CompilerGym cohort ledger root drifted");
	if (!Array.isArray(root.inputLedgers) || root.inputLedgers.length !== EXPECTED_LEDGER_COUNT) {
		throw new Error(`Pinned CompilerGym cohort must contain ${EXPECTED_LEDGER_COUNT} ledgers`);
	}
	const seen = new Set<string>();
	const inputLedgers = root.inputLedgers.map((value, index): PinnedLedger => {
		const item = record(value, `cohort analysis.inputLedgers[${index}]`);
		const path = nonemptyString(item.path, `cohort analysis.inputLedgers[${index}].path`);
		if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === "" || part === "..")) {
			throw new Error(`cohort analysis.inputLedgers[${index}].path is not portable`);
		}
		if (seen.has(path)) throw new Error(`Duplicate pinned cohort ledger: ${path}`);
		seen.add(path);
		return {
			path,
			sha256: digest(item.sha256, `cohort analysis.inputLedgers[${index}].sha256`),
			eventCount: nonnegativeSafeInteger(item.eventCount, `cohort analysis.inputLedgers[${index}].eventCount`),
			terminalEventHash: digest(item.terminalEventHash, `cohort analysis.inputLedgers[${index}].terminalEventHash`),
		};
	});
	return { ledgerRoot, inputLedgers };
}

function quotedFlags(fragment: string, path: string): string[] {
	const flags = [...fragment.matchAll(/"(-[a-z0-9][a-z0-9-]*)"/g)].map((match) => match[1] as string);
	if (flags.length === 0 || new Set(flags).size !== flags.length) {
		throw new Error(`${path} must contain unique quoted LLVM flags`);
	}
	return flags;
}

export function parseAuthoritativeLlvmFlags(contents: string): string[] {
	if (sha256Text(contents) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256) {
		throw new Error("Authoritative CompilerGym evaluator hash drifted");
	}
	const match = contents.match(
		/PINNED_LLVM_PASS_FLAGS: Tuple\[str, \.\.\.\] = tuple\(\n {4}"""([\s\S]*?)"""\.splitlines\(\)\n\)/,
	);
	if (!match?.[1]) throw new Error("Could not reconstruct the authoritative LLVM action space");
	const flags = match[1].split("\n");
	if (flags.length !== EXPECTED_ALLOWED_FLAG_COUNT || new Set(flags).size !== flags.length) {
		throw new Error("Authoritative LLVM action space is not exactly 124 unique flags");
	}
	if (sha256Json(flags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256) {
		throw new Error("Authoritative LLVM action-space digest drifted");
	}
	return flags;
}

export function parseStockPromptShownFlags(contents: string): string[] {
	if (sha256Text(contents) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_SOURCE_SHA256) {
		throw new Error("Stock prompt action-guide source hash drifted");
	}
	const match = contents.match(/export const STOCK_INTERFACE_PARITY_ACTION_GUIDE = \[([\s\S]*?)\] as const;/);
	if (!match?.[1]) throw new Error("Could not reconstruct the stock prompt action guide");
	const flags = quotedFlags(match[1], "stock prompt action guide");
	if (
		flags.length !== EXPECTED_SHOWN_FLAG_COUNT ||
		sha256Json(flags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256
	) {
		throw new Error("Stock prompt action guide is not the exact pinned 26-flag list");
	}
	return flags;
}

function candidateBinding(event: LedgerEvent, ledgerPath: string): CandidateBinding {
	const payload = record(event.payload, `${ledgerPath}:proposal`);
	exactStringArray(payload.benchmarkIds, DEVELOPMENT_BENCHMARKS, `${ledgerPath}:proposal.benchmarkIds`);
	if (payload.candidateFormat !== "llvm-pass-sequence") {
		throw new Error(`${ledgerPath}:proposal candidate format drifted`);
	}
	const candidate = record(payload.candidate, `${ledgerPath}:proposal.candidate`);
	return {
		digest: digest(candidate.digest, `${ledgerPath}:proposal.candidate.digest`),
		byteLength: nonnegativeSafeInteger(candidate.byteLength, `${ledgerPath}:proposal.candidate.byteLength`),
		mediaType: nonemptyString(candidate.mediaType, `${ledgerPath}:proposal.candidate.mediaType`),
	};
}

function artifactActions(contents: string, binding: CandidateBinding, ledgerPath: string): string[] {
	if (sha256Text(contents) !== binding.digest) throw new Error(`${ledgerPath}:candidate artifact hash drifted`);
	if (Buffer.byteLength(contents) !== binding.byteLength)
		throw new Error(`${ledgerPath}:candidate artifact length drifted`);
	if (binding.mediaType !== "application/vnd.prime.llvm-pass-sequence") {
		throw new Error(`${ledgerPath}:candidate artifact media type drifted`);
	}
	return stringArray(JSON.parse(contents) as unknown, `${ledgerPath}:candidate artifact`);
}

export function analyzeCompilerGymCompleteActionSpace(
	sources: CompilerGymCompleteActionSpaceSources,
): CompilerGymCompleteActionSpaceAudit {
	const pinned = parsePinnedAnalysis(sources.analysisContents);
	const allowedFlags = parseAuthoritativeLlvmFlags(sources.authoritativeEvaluatorContents);
	const shownFlags = parseStockPromptShownFlags(sources.actionGuideSourceContents);
	const allowed = new Set(allowedFlags);
	const shown = new Set(shownFlags);
	if ([...shown].some((flag) => !allowed.has(flag)))
		throw new Error("Stock prompt guide contains a non-authoritative flag");

	const sourceByPath = new Map(sources.ledgers.map((source) => [source.path, source]));
	if (sourceByPath.size !== sources.ledgers.length || sourceByPath.size !== pinned.inputLedgers.length) {
		throw new Error("Cohort ledger source set differs from the pinned analysis");
	}
	const observed = new Set<string>();
	const artifactDigests = new Set<string>();
	let proposalCount = 0;
	for (const input of pinned.inputLedgers) {
		const source = sourceByPath.get(input.path);
		if (!source) throw new Error(`Missing pinned cohort ledger ${input.path}`);
		if (sha256Text(source.contents) !== input.sha256) throw new Error(`${input.path}:pinned ledger hash drifted`);
		const events = verifyLedgerContentsStrict(source.contents);
		if (events.length !== input.eventCount || events.at(-1)?.hash !== input.terminalEventHash) {
			throw new Error(`${input.path}:pinned ledger chain summary drifted`);
		}
		const expectedArtifacts = new Set<string>();
		for (const event of events) {
			if (event.kind !== "proposal") continue;
			proposalCount++;
			const binding = candidateBinding(event, input.path);
			expectedArtifacts.add(binding.digest);
			artifactDigests.add(binding.digest);
			const contents = source.artifacts[binding.digest];
			if (contents === undefined) throw new Error(`${input.path}:candidate artifact is missing`);
			for (const flag of artifactActions(contents, binding, input.path)) {
				if (!allowed.has(flag)) throw new Error(`${input.path}:observed a non-authoritative flag ${flag}`);
				if (!shown.has(flag))
					throw new Error(`${input.path}:observed an action hidden from the stock prompt ${flag}`);
				observed.add(flag);
			}
		}
		if (
			Object.keys(source.artifacts).length !== expectedArtifacts.size ||
			Object.keys(source.artifacts).some((value) => !expectedArtifacts.has(value))
		) {
			throw new Error(`${input.path}:candidate artifact source set drifted`);
		}
	}
	if (sources.ledgers.some((source) => !pinned.inputLedgers.some((input) => input.path === source.path))) {
		throw new Error("Cohort ledger source set contains an unpinned ledger");
	}

	const observedFlags = allowedFlags.filter((flag) => observed.has(flag));
	const omittedFlags = allowedFlags.filter((flag) => !shown.has(flag));
	const shownButUnobservedFlags = shownFlags.filter((flag) => !observed.has(flag));
	const sortedArtifactDigests = [...artifactDigests].sort();
	if (sha256Json(sortedArtifactDigests) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256) {
		throw new Error("Pinned cohort candidate artifact set drifted");
	}
	if (sha256Json(observedFlags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_OBSERVED_FLAGS_SHA256) {
		throw new Error("Pinned cohort observed-flag digest drifted");
	}
	if (sha256Json(omittedFlags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256) {
		throw new Error("Deterministic omitted-flag complement drifted");
	}

	const gates = {
		exactAllowed124: allowedFlags.length === EXPECTED_ALLOWED_FLAG_COUNT,
		exactShown26: shownFlags.length === EXPECTED_SHOWN_FLAG_COUNT,
		exactObserved25: observedFlags.length === EXPECTED_OBSERVED_FLAG_COUNT,
		exactOmitted98: omittedFlags.length === EXPECTED_OMITTED_FLAG_COUNT,
		allObservedFlagsWereShown: observedFlags.every((flag) => shown.has(flag)),
		exactCohort69Proposals54Artifacts:
			proposalCount === EXPECTED_PROPOSAL_COUNT && artifactDigests.size === EXPECTED_UNIQUE_ARTIFACT_COUNT,
		dijkstraAbsentFromDevelopmentCohort: true,
	};
	return {
		schemaVersion: 1,
		auditId: "compiler-gym-complete-action-space-cohort-v1",
		classification: "sealed-retrospective-interface-coverage-audit-not-treatment-evidence",
		sources: {
			analysisSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_SHA256,
			authoritativeEvaluatorSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256,
			actionGuideSourceSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_SOURCE_SHA256,
			ledgerCount: EXPECTED_LEDGER_COUNT,
			proposalCount: EXPECTED_PROPOSAL_COUNT,
			uniqueCandidateArtifactCount: EXPECTED_UNIQUE_ARTIFACT_COUNT,
			candidateArtifactSetSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256,
			ledgers: pinned.inputLedgers.map((input) => ({ ...input })),
		},
		allowedFlags,
		shownFlags,
		observedFlags,
		omittedFlags,
		shownButUnobservedFlags,
		digests: {
			allowedFlagsSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
			shownFlagsSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256,
			observedFlagsSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_OBSERVED_FLAGS_SHA256,
			omittedFlagsSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256,
		},
		gates,
		eligibleForOneAllocationHeadroomGate: Object.values(gates).every((value) => value),
		authorizations: { model: false, provider: false, dispatch: false, paid: false, promotion: false, gpu: false },
	};
}

export function buildCompilerGymCompleteActionSpaceRequest(
	audit: CompilerGymCompleteActionSpaceAudit,
): CompilerGymCompleteActionSpaceRequest {
	if (!audit.eligibleForOneAllocationHeadroomGate) throw new Error("Coverage audit did not qualify the headroom gate");
	if (sha256Json(audit.omittedFlags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256) {
		throw new Error("Coverage audit omitted flags drifted before request construction");
	}
	return {
		schema_version: 1,
		protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
		benchmark: COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK,
		allowed_flags_sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
		shown_flags_sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256,
		omitted_flags: [...audit.omittedFlags],
		omitted_flags_sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256,
		scaffold_without_x: [...COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD],
		insertion_index: COMPILER_GYM_COMPLETE_ACTION_SPACE_INSERTION_INDEX,
		prefilter: {
			metric: "IrInstructionCount",
			minimum_absolute_improvement: COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_IR_IMPROVEMENT,
			minimum_fraction_numerator: COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_NUMERATOR,
			minimum_fraction_denominator: COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_DENOMINATOR,
		},
		pass_gate: {
			minimum_distinct_verified_omitted_flags: COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS,
		},
	};
}

export function buildCompilerGymCompleteActionSpaceProtocol(
	sources: CompilerGymCompleteActionSpaceSources,
): CompilerGymCompleteActionSpaceProtocol {
	const audit = analyzeCompilerGymCompleteActionSpace(sources);
	const request = buildCompilerGymCompleteActionSpaceRequest(audit);
	if (sha256Json(request) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256) {
		throw new Error("Frozen complete-action-space request digest drifted");
	}
	if (sha256Text(`${canonicalJson(toJsonValue(request))}\n`) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256) {
		throw new Error("Frozen complete-action-space stdin bytes drifted");
	}
	const headroomEvaluatorSha256 = sha256Text(sources.headroomEvaluatorContents);
	if (!SHA256_PATTERN.test(headroomEvaluatorSha256)) throw new Error("Headroom evaluator source hash is invalid");
	const executionIdentity = headroomExecutionIdentity(headroomEvaluatorSha256);
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
		classification: "sealed-zero-model-one-allocation-apparatus-gate-not-treatment-evidence",
		hypothesis:
			"At least two distinct legal LLVM 10 flags omitted from the stock 26-flag prompt guide improve dijkstra, held out from the sealed blowfish/bzip2 development cohort, when inserted into the fixed scaffold by max(3 raw IR instructions, 0.5%) and then pass all 20 authoritative semantic callbacks.",
		audit,
		design: {
			modelCalls: 0,
			allocationCount: 1,
			allocationRetries: 0,
			evaluatorTaskCount: 1,
			cpusPerTask: 1,
			evaluatorCpuMinutesMaximum: 10,
			taskWallMinutesMaximum: 10,
			schedulerLogicalCpusPerAllocation: 2,
			schedulerLogicalCpuMinutesMaximum: 20,
			allocationTimeLimit: "00:10:00",
			cpuSecondsSoftLimit: COMPILER_GYM_COMPLETE_ACTION_SPACE_CPU_SECONDS_SOFT_LIMIT,
			wallSecondsSoftLimit: COMPILER_GYM_COMPLETE_ACTION_SPACE_WALL_SECONDS_SOFT_LIMIT,
			benchmarkKnowledge: "dijkstra-held-out-from-sealed-development-cohort-zero-model",
			search: "exhaustive-ordered-98-flag-complement",
			prefilter: "raw-ir-only",
			terminalVerification: "existing-authoritative-20-base-callback-verifier-only-after-prefilter",
			failureDisposition: "inconclusive-apparatus-result-never-treatment-evidence",
		},
		sourceSeal: {
			authoritativeEvaluatorSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256,
			headroomEvaluatorSha256,
			actionGuideSourceSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_SOURCE_SHA256,
			analysisSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_SHA256,
			candidateArtifactSetSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256,
		},
		execution: {
			transport: "sealed-two-source-bundle-exact-stdin-no-shell-v1",
			host: "farmshare",
			remoteSourceRoot: HEADROOM_REMOTE_SOURCE_ROOT,
			sourceBundleSha256: executionIdentity.sourceBundleSha256,
			sourceDirectory: executionIdentity.sourceDirectory,
			sources: [
				{
					localPath: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_PATH,
					remoteName: "compiler_gym_eval.py",
					sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256,
				},
				{
					localPath: COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_PATH,
					remoteName: "compiler_gym_complete_action_space_headroom_eval.py",
					sha256: headroomEvaluatorSha256,
				},
			],
			sourceInstall: {
				atomicCreateOrExistingExact: true,
				ownerOnlyMode: "0600",
				requireRegularFiles: true,
				requirePostInstallSha256: true,
			},
			workingDirectory: executionIdentity.sourceDirectory,
			jobName: executionIdentity.jobName,
			transientCache: executionIdentity.transientCache,
			argv: executionIdentity.argv,
			stdinSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256,
			stdoutContract: "one-json-object-one-line",
			stderrContract: "diagnostic-only",
		},
		request,
		requestSha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256,
		passGate: {
			minimumDistinctVerifiedOmittedFlags: COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS,
			requireComplete98FlagSweep: true,
			requireExisting20CallbackVerifier: true,
			requireWithinCpuCap: true,
			requireWithinWallCap: true,
		},
		authorizations: { ...audit.authorizations },
	};
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
	return value;
}

function parseVerification(value: unknown, path: string): boolean {
	const verification = record(value, path);
	exactKeys(
		verification,
		[
			"base_callbacks_selected",
			"inputs",
			"inputs_completed",
			"inputs_expected",
			"passed",
			"registered_callback_group_size",
			"sanitizer_callbacks_excluded",
			"sanitizer_callbacks_selected",
			"semantic_errors",
			"worker_count_source",
			"workers",
		],
		path,
	);
	const inputsCompleted = nonnegativeSafeInteger(verification.inputs_completed, `${path}.inputs_completed`);
	if (
		nonnegativeSafeInteger(verification.inputs_expected, `${path}.inputs_expected`) !== 20 ||
		nonnegativeSafeInteger(verification.base_callbacks_selected, `${path}.base_callbacks_selected`) !== 20 ||
		nonnegativeSafeInteger(verification.sanitizer_callbacks_selected, `${path}.sanitizer_callbacks_selected`) !== 0
	) {
		throw new Error(`${path} is not the existing 20-base-callback verifier`);
	}
	if (!Array.isArray(verification.inputs) || verification.inputs.length !== 20) {
		throw new Error(`${path}.inputs must contain exactly 20 outcomes`);
	}
	let completedCount = 0;
	const flattenedErrors: unknown[] = [];
	for (const [index, value] of verification.inputs.entries()) {
		const item = record(value, `${path}.inputs[${index}]`);
		const completed = item.completed;
		const itemPassed = item.passed;
		const errors = item.errors;
		if (
			item.input_index !== index + 1 ||
			typeof completed !== "boolean" ||
			typeof itemPassed !== "boolean" ||
			!Array.isArray(errors)
		) {
			throw new Error(`${path}.inputs[${index}] violates the ordered callback schema`);
		}
		exactKeys(
			item,
			completed
				? ["completed", "errors", "input_index", "passed", "walltime_seconds"]
				: ["completed", "errors", "exception", "input_index", "passed", "walltime_seconds"],
			`${path}.inputs[${index}]`,
		);
		finiteNonnegative(item.walltime_seconds, `${path}.inputs[${index}].walltime_seconds`);
		for (const [errorIndex, errorValue] of errors.entries()) {
			const error = record(errorValue, `${path}.inputs[${index}].errors[${errorIndex}]`);
			exactKeys(error, ["data", "input_index", "type"], `${path}.inputs[${index}].errors[${errorIndex}]`);
			if (error.input_index !== index + 1) {
				throw new Error(`${path}.inputs[${index}].errors[${errorIndex}].input_index is inconsistent`);
			}
			nonemptyString(error.type, `${path}.inputs[${index}].errors[${errorIndex}].type`);
		}
		if (itemPassed !== (completed && errors.length === 0)) {
			throw new Error(`${path}.inputs[${index}].passed contradicts completed/errors`);
		}
		if (completed) {
			completedCount++;
		} else {
			const exception = record(item.exception, `${path}.inputs[${index}].exception`);
			exactKeys(exception, ["message", "type"], `${path}.inputs[${index}].exception`);
			nonemptyString(exception.type, `${path}.inputs[${index}].exception.type`);
			if (typeof exception.message !== "string") {
				throw new Error(`${path}.inputs[${index}].exception.message must be a string`);
			}
		}
		flattenedErrors.push(...errors);
	}
	if (inputsCompleted !== completedCount)
		throw new Error(`${path}.inputs_completed contradicts the callback outcomes`);
	if (completedCount !== 20) throw new Error(`${path} contains an incomplete authoritative callback`);
	if (!Array.isArray(verification.semantic_errors)) throw new Error(`${path}.semantic_errors must be an array`);
	if (sha256Json(verification.semantic_errors) !== sha256Json(flattenedErrors)) {
		throw new Error(`${path}.semantic_errors contradicts the per-input errors`);
	}
	if (
		verification.registered_callback_group_size !== 5 ||
		verification.sanitizer_callbacks_excluded !== 80 ||
		verification.workers !== 1 ||
		verification.worker_count_source !== "SLURM_CPUS_PER_TASK"
	) {
		throw new Error(`${path} verifier metadata escaped the pinned single-CPU dijkstra contract`);
	}
	const passed = boolean(verification.passed, `${path}.passed`);
	if (passed !== (completedCount === 20 && flattenedErrors.length === 0)) {
		throw new Error(`${path}.passed contradicts the callback outcomes`);
	}
	return passed;
}

function assertSealedExecution(protocol: CompilerGymCompleteActionSpaceProtocol): void {
	const expectedExecution = headroomExecutionIdentity(protocol.sourceSeal.headroomEvaluatorSha256);
	const expectedSources = [
		{
			localPath: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_PATH,
			remoteName: "compiler_gym_eval.py",
			sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256,
		},
		{
			localPath: COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_PATH,
			remoteName: "compiler_gym_complete_action_space_headroom_eval.py",
			sha256: protocol.sourceSeal.headroomEvaluatorSha256,
		},
	];
	if (
		protocol.schemaVersion !== 1 ||
		protocol.protocol !== COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL ||
		protocol.classification !== "sealed-zero-model-one-allocation-apparatus-gate-not-treatment-evidence" ||
		protocol.sourceSeal.authoritativeEvaluatorSha256 !==
			COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_SHA256 ||
		!SHA256_PATTERN.test(protocol.sourceSeal.headroomEvaluatorSha256) ||
		protocol.sourceSeal.actionGuideSourceSha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_SOURCE_SHA256 ||
		protocol.sourceSeal.analysisSha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_SHA256 ||
		protocol.sourceSeal.candidateArtifactSetSha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256 ||
		sha256Json(protocol.audit.allowedFlags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256 ||
		sha256Json(protocol.audit.shownFlags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256 ||
		sha256Json(protocol.audit.observedFlags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_OBSERVED_FLAGS_SHA256 ||
		sha256Json(protocol.audit.omittedFlags) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256 ||
		sha256Json(protocol.request) !== COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256 ||
		sha256Text(`${canonicalJson(toJsonValue(protocol.request))}\n`) !==
			COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256 ||
		protocol.execution.transport !== "sealed-two-source-bundle-exact-stdin-no-shell-v1" ||
		protocol.execution.host !== "farmshare" ||
		protocol.execution.remoteSourceRoot !== HEADROOM_REMOTE_SOURCE_ROOT ||
		protocol.execution.sourceBundleSha256 !== expectedExecution.sourceBundleSha256 ||
		protocol.execution.sourceDirectory !== expectedExecution.sourceDirectory ||
		protocol.execution.workingDirectory !== expectedExecution.sourceDirectory ||
		protocol.execution.jobName !== expectedExecution.jobName ||
		protocol.execution.transientCache !== expectedExecution.transientCache ||
		sha256Json(protocol.execution.sources) !== sha256Json(expectedSources) ||
		sha256Json(protocol.execution.sourceInstall) !==
			sha256Json({
				atomicCreateOrExistingExact: true,
				ownerOnlyMode: "0600",
				requireRegularFiles: true,
				requirePostInstallSha256: true,
			}) ||
		protocol.execution.stdinSha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_STDIN_SHA256 ||
		protocol.execution.stdoutContract !== "one-json-object-one-line" ||
		protocol.execution.stderrContract !== "diagnostic-only" ||
		protocol.requestSha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_REQUEST_SHA256 ||
		JSON.stringify(protocol.execution.argv) !== JSON.stringify(expectedExecution.argv) ||
		protocol.passGate.minimumDistinctVerifiedOmittedFlags !==
			COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS ||
		!protocol.passGate.requireComplete98FlagSweep ||
		!protocol.passGate.requireExisting20CallbackVerifier ||
		!protocol.passGate.requireWithinCpuCap ||
		!protocol.passGate.requireWithinWallCap ||
		Object.values(protocol.authorizations).some((value) => value !== false)
	) {
		throw new Error("Complete-action-space execution/source seal drifted");
	}
}

function parseEnvironment(value: unknown): void {
	const environment = record(value, "headroom result.environment");
	exactKeys(
		environment,
		[
			"action_space",
			"compiler_gym_service_version",
			"compiler_gym_version",
			"environment_id",
			"llvm_compiler_version",
			"python_version",
			"seal",
			"slurm_cpus_per_task",
			"slurm_job_id",
			"slurm_ntasks",
		],
		"headroom result.environment",
	);
	if (
		environment.python_version !== "3.10.19" ||
		environment.compiler_gym_version !== "0.2.5" ||
		environment.compiler_gym_service_version !== "0.2.5" ||
		typeof environment.llvm_compiler_version !== "string" ||
		(environment.llvm_compiler_version !== "10.0.0" && !environment.llvm_compiler_version.startsWith("10.0.0 ")) ||
		environment.environment_id !== "llvm-v0" ||
		environment.action_space !== "PassesAll" ||
		typeof environment.slurm_job_id !== "string" ||
		!/^[1-9][0-9]*$/.test(environment.slurm_job_id) ||
		environment.slurm_cpus_per_task !== "1" ||
		environment.slurm_ntasks !== "1"
	) {
		throw new Error("Headroom result environment identity or allocation binding drifted");
	}
	const seal = record(environment.seal, "headroom result.environment.seal");
	exactKeys(
		seal,
		[
			"cbench_patch_sha256",
			"compatibility_tree_entries",
			"compatibility_tree_manifest_bytes",
			"compatibility_tree_manifest_sha256",
			"distribution_count",
			"distribution_manifest_sha256",
			"installed_cbench_source_sha256",
			"ld_library_path",
			"libtinfo_sha256",
			"python_version",
			"upstream_cbench_source_sha256",
		],
		"headroom result.environment.seal",
	);
	if (
		seal.python_version !== "3.10.19" ||
		seal.distribution_manifest_sha256 !== "4b84dea7461512ef8fdadb99a992066484119fc91b7d8f0d3b33b5598fa870dd" ||
		seal.distribution_count !== 30 ||
		seal.upstream_cbench_source_sha256 !== "e6337c70f9a3e83abc8f54d9b4193e7ba51fe853a555fa78e472b2fc87920d88" ||
		seal.cbench_patch_sha256 !== "259956ea61364336dbc3e326cd27c7b6a0342fadbeba32b6c29da7024a4ccc00"
	) {
		throw new Error("Headroom result environment package/source seal drifted");
	}
	if (
		seal.installed_cbench_source_sha256 !== "6e38fd10d4bfd7816dbe6f959ff8ae97a3c10ab94cadde883926d83c0db521ed" ||
		seal.ld_library_path !== "/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib" ||
		seal.libtinfo_sha256 !== "d82654b2615eb347e8f15a63862c9234f452187250b75d36dce8bd964541f02e" ||
		seal.compatibility_tree_manifest_sha256 !== "c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1" ||
		seal.compatibility_tree_entries !== 2749 ||
		seal.compatibility_tree_manifest_bytes !== 215462
	) {
		throw new Error("Headroom result compatibility-tree seal drifted");
	}
}

function parseProvenance(value: unknown): void {
	const provenance = record(value, "headroom result.provenance");
	exactKeys(
		provenance,
		[
			"cbench_patch_sha256",
			"ci_two_input_shortcut_neutralized",
			"compiler_gym_release",
			"contract_upstream_commit",
			"terminal_validation_contract",
			"upstream_cbench_source_sha256",
		],
		"headroom result.provenance",
	);
	if (
		provenance.compiler_gym_release !== "v0.2.5" ||
		provenance.contract_upstream_commit !== "64bdd6cd39967d3d2fe5e6c72deb15e830b838bb" ||
		provenance.upstream_cbench_source_sha256 !== "e6337c70f9a3e83abc8f54d9b4193e7ba51fe853a555fa78e472b2fc87920d88" ||
		provenance.cbench_patch_sha256 !== "259956ea61364336dbc3e326cd27c7b6a0342fadbeba32b6c29da7024a4ccc00" ||
		provenance.ci_two_input_shortcut_neutralized !== false ||
		provenance.terminal_validation_contract !== "first non-sanitized callback from each known 20-input group"
	) {
		throw new Error("Headroom result provenance drifted");
	}
}

export function assessCompilerGymCompleteActionSpaceResult(
	value: unknown,
	protocol: CompilerGymCompleteActionSpaceProtocol,
): CompilerGymCompleteActionSpaceResultAssessment {
	assertSealedExecution(protocol);
	const result = record(value, "headroom result");
	exactKeys(
		result,
		[
			"apparatus_completed",
			"baseline",
			"benchmark",
			"budget",
			"candidates",
			"cohort",
			"contract",
			"environment",
			"ok",
			"pass_gate",
			"prefilter",
			"protocol",
			"provenance",
			"request_sha256",
			"schema_version",
			"status",
			"sweep_complete",
			"terminal_verifier_contract",
			"timings_seconds",
			"verified_omitted_flags",
			"verifier_schedule",
		],
		"headroom result",
	);
	if (
		result.schema_version !== 1 ||
		result.protocol !== COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL ||
		result.contract !== COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_CONTRACT ||
		result.terminal_verifier_contract !== COMPILER_GYM_COMPLETE_ACTION_SPACE_TERMINAL_VERIFIER_CONTRACT ||
		result.benchmark !== COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK ||
		result.request_sha256 !== protocol.requestSha256
	) {
		throw new Error("Headroom result identity or request binding drifted");
	}
	parseEnvironment(result.environment);
	parseProvenance(result.provenance);
	const cohort = record(result.cohort, "headroom result.cohort");
	exactKeys(
		cohort,
		[
			"allowed_flag_count",
			"allowed_flags_sha256",
			"omitted_flag_count",
			"omitted_flags_sha256",
			"shown_flag_count",
			"shown_flags_sha256",
		],
		"headroom result.cohort",
	);
	if (
		cohort.allowed_flag_count !== EXPECTED_ALLOWED_FLAG_COUNT ||
		cohort.shown_flag_count !== EXPECTED_SHOWN_FLAG_COUNT ||
		cohort.omitted_flag_count !== EXPECTED_OMITTED_FLAG_COUNT ||
		cohort.allowed_flags_sha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256 ||
		cohort.shown_flags_sha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256 ||
		cohort.omitted_flags_sha256 !== COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256
	) {
		throw new Error("Headroom result cohort binding drifted");
	}
	const baseline = record(result.baseline, "headroom result.baseline");
	exactKeys(
		baseline,
		["action_indices", "actions", "commandline", "ir_instruction_count", "semantic_status"],
		"headroom result.baseline",
	);
	exactStringArray(baseline.actions, COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD, "headroom result.baseline.actions");
	exactNonnegativeIntegerArray(
		baseline.action_indices,
		COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD.map((action) => protocol.audit.allowedFlags.indexOf(action)),
		"headroom result.baseline.action_indices",
	);
	nonemptyString(baseline.commandline, "headroom result.baseline.commandline");
	if (baseline.semantic_status !== "raw-prefilter-only") throw new Error("Headroom baseline semantic status drifted");
	const baselineIr = nonnegativeSafeInteger(
		baseline.ir_instruction_count,
		"headroom result.baseline.ir_instruction_count",
	);
	const prefilter = record(result.prefilter, "headroom result.prefilter");
	exactKeys(
		prefilter,
		[
			"metric",
			"minimum_absolute_improvement",
			"minimum_fraction_denominator",
			"minimum_fraction_numerator",
			"required_improvement_instructions",
			"semantic_status",
		],
		"headroom result.prefilter",
	);
	if (
		prefilter.metric !== "IrInstructionCount" ||
		prefilter.minimum_absolute_improvement !== COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_IR_IMPROVEMENT ||
		prefilter.minimum_fraction_numerator !== COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_NUMERATOR ||
		prefilter.minimum_fraction_denominator !== COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_DENOMINATOR ||
		prefilter.semantic_status !== "unverified-unless-qualified"
	) {
		throw new Error("Headroom prefilter contract drifted");
	}
	const requiredImprovement = nonnegativeSafeInteger(
		prefilter.required_improvement_instructions,
		"headroom result.prefilter.required_improvement_instructions",
	);
	const expectedRequired = Math.max(
		COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_IR_IMPROVEMENT,
		Math.ceil(
			(baselineIr * COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_NUMERATOR) /
				COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_FRACTION_DENOMINATOR,
		),
	);
	if (requiredImprovement !== expectedRequired) throw new Error("Headroom prefilter threshold arithmetic drifted");

	if (!Array.isArray(result.candidates)) throw new Error("headroom result.candidates must be an array");
	const qualifiedFlags: string[] = [];
	const verifiedFlags: string[] = [];
	let verifiedQualifierCount = 0;
	let notNeededAfterPositiveCount = 0;
	let notRunBudgetExhaustedCount = 0;
	let positiveStopStarted = false;
	let budgetStopStarted = false;
	for (const [index, value] of result.candidates.entries()) {
		const path = `headroom result.candidates[${index}]`;
		const candidate = record(value, path);
		exactKeys(
			candidate,
			[
				"action_indices",
				"actions",
				"commandline",
				"flag",
				"prefilter",
				"terminal_object_text_size_bytes",
				"verification",
				"verification_status",
				"verified",
			],
			path,
		);
		const flag = protocol.audit.omittedFlags[index];
		if (!flag || candidate.flag !== flag) throw new Error(`${path}.flag differs from the ordered omitted cohort`);
		const expectedActions: string[] = [...COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD];
		expectedActions.splice(COMPILER_GYM_COMPLETE_ACTION_SPACE_INSERTION_INDEX, 0, flag);
		exactStringArray(candidate.actions, expectedActions, `${path}.actions`);
		exactNonnegativeIntegerArray(
			candidate.action_indices,
			expectedActions.map((action) => protocol.audit.allowedFlags.indexOf(action)),
			`${path}.action_indices`,
		);
		nonemptyString(candidate.commandline, `${path}.commandline`);
		const candidatePrefilter = record(candidate.prefilter, `${path}.prefilter`);
		exactKeys(
			candidatePrefilter,
			[
				"final_ir_instruction_count",
				"improvement_instructions",
				"info",
				"qualified",
				"required_improvement_instructions",
				"status",
			],
			`${path}.prefilter`,
		);
		const finalIr = nonnegativeSafeInteger(
			candidatePrefilter.final_ir_instruction_count,
			`${path}.prefilter.final_ir_instruction_count`,
		);
		const improvement = baselineIr - finalIr;
		if (candidatePrefilter.improvement_instructions !== improvement) {
			throw new Error(`${path}.prefilter improvement arithmetic drifted`);
		}
		if (candidatePrefilter.required_improvement_instructions !== requiredImprovement) {
			throw new Error(`${path}.prefilter required threshold drifted`);
		}
		if (candidatePrefilter.status !== "measured" && candidatePrefilter.status !== "episode_terminated") {
			throw new Error(`${path}.prefilter.status is invalid`);
		}
		const qualified = boolean(candidatePrefilter.qualified, `${path}.prefilter.qualified`);
		const expectedQualified = candidatePrefilter.status === "measured" && improvement >= requiredImprovement;
		if (qualified !== expectedQualified) throw new Error(`${path}.prefilter qualification drifted`);
		if (qualified) qualifiedFlags.push(flag);
		const verificationStatus = candidate.verification_status;
		if (
			verificationStatus !== "not-qualified" &&
			verificationStatus !== "verified" &&
			verificationStatus !== "not-needed-after-positive-gate" &&
			verificationStatus !== "not-run-budget-exhausted"
		) {
			throw new Error(`${path}.verification_status is invalid`);
		}
		let verificationPassed = false;
		if (!qualified) {
			if (
				verificationStatus !== "not-qualified" ||
				candidate.verification !== null ||
				candidate.terminal_object_text_size_bytes !== null
			) {
				throw new Error(`${path} attached verifier evidence to an unqualified candidate`);
			}
		} else if (verificationStatus === "verified") {
			if (
				positiveStopStarted ||
				budgetStopStarted ||
				verifiedFlags.length >= COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS
			) {
				throw new Error(`${path} resumed verification after a terminal verifier stop`);
			}
			nonnegativeSafeInteger(candidate.terminal_object_text_size_bytes, `${path}.terminal_object_text_size_bytes`);
			verificationPassed = parseVerification(candidate.verification, `${path}.verification`);
			verifiedQualifierCount++;
		} else {
			if (candidate.verification !== null || candidate.terminal_object_text_size_bytes !== null) {
				throw new Error(`${path} has verifier artifacts without a verifier execution`);
			}
			if (verificationStatus === "not-needed-after-positive-gate") {
				if (budgetStopStarted || verifiedFlags.length < COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS) {
					throw new Error(`${path} stopped verification before the positive gate was reached`);
				}
				positiveStopStarted = true;
				notNeededAfterPositiveCount++;
			} else if (verificationStatus === "not-run-budget-exhausted") {
				if (positiveStopStarted) throw new Error(`${path} changed a positive stop into a budget stop`);
				budgetStopStarted = true;
				notRunBudgetExhaustedCount++;
			} else {
				throw new Error(`${path} marked a qualified candidate as not-qualified`);
			}
		}
		const verified = boolean(candidate.verified, `${path}.verified`);
		if (verified !== verificationPassed) throw new Error(`${path}.verified contradicts the authoritative verifier`);
		if (verified) verifiedFlags.push(flag);
	}
	const sweepComplete = boolean(result.sweep_complete, "headroom result.sweep_complete");
	if (sweepComplete !== (result.candidates.length === EXPECTED_OMITTED_FLAG_COUNT)) {
		throw new Error("Headroom sweep completion flag contradicts candidate coverage");
	}
	exactStringArray(result.verified_omitted_flags, verifiedFlags, "headroom result.verified_omitted_flags");
	const verifierSchedule = record(result.verifier_schedule, "headroom result.verifier_schedule");
	exactKeys(
		verifierSchedule,
		[
			"early_positive_stop",
			"negative_verification_complete",
			"not_needed_after_positive_count",
			"not_run_budget_exhausted_count",
			"order",
			"policy",
			"qualified_flag_count",
			"verified_qualifier_count",
		],
		"headroom result.verifier_schedule",
	);
	const negativeVerificationComplete = sweepComplete && qualifiedFlags.length === verifiedQualifierCount;
	if (
		verifierSchedule.order !== "qualified-candidates-in-omitted-flag-order" ||
		verifierSchedule.policy !== "stop-after-two-verified-passes-else-verify-all-qualifiers" ||
		verifierSchedule.qualified_flag_count !== qualifiedFlags.length ||
		verifierSchedule.verified_qualifier_count !== verifiedQualifierCount ||
		verifierSchedule.not_needed_after_positive_count !== notNeededAfterPositiveCount ||
		verifierSchedule.not_run_budget_exhausted_count !== notRunBudgetExhaustedCount ||
		verifierSchedule.early_positive_stop !== notNeededAfterPositiveCount > 0 ||
		verifierSchedule.negative_verification_complete !== negativeVerificationComplete
	) {
		throw new Error("Headroom verifier schedule contradicts candidate evidence");
	}
	const budget = record(result.budget, "headroom result.budget");
	exactKeys(
		budget,
		[
			"allocation_count",
			"allocation_time_limit",
			"cpu_seconds_observed",
			"cpu_seconds_soft_limit",
			"cpus_per_task",
			"evaluator_cpu_minutes_limit",
			"model_calls",
			"scheduler_logical_cpu_minutes_maximum",
			"scheduler_logical_cpus_per_allocation",
			"soft_limit_exhausted",
			"task_wall_minutes_limit",
			"wall_seconds_observed",
			"wall_seconds_soft_limit",
			"within_cpu_cap",
			"within_wall_cap",
		],
		"headroom result.budget",
	);
	if (
		budget.model_calls !== 0 ||
		budget.allocation_count !== 1 ||
		budget.cpus_per_task !== 1 ||
		budget.evaluator_cpu_minutes_limit !== 10 ||
		budget.task_wall_minutes_limit !== 10 ||
		budget.scheduler_logical_cpus_per_allocation !== 2 ||
		budget.scheduler_logical_cpu_minutes_maximum !== 20 ||
		budget.cpu_seconds_soft_limit !== COMPILER_GYM_COMPLETE_ACTION_SPACE_CPU_SECONDS_SOFT_LIMIT ||
		budget.wall_seconds_soft_limit !== COMPILER_GYM_COMPLETE_ACTION_SPACE_WALL_SECONDS_SOFT_LIMIT ||
		budget.allocation_time_limit !== "00:10:00"
	) {
		throw new Error("Headroom result exceeded or changed the frozen zero-model allocation budget");
	}
	const cpuSeconds = finiteNonnegative(budget.cpu_seconds_observed, "headroom result.budget.cpu_seconds_observed");
	const wallSeconds = finiteNonnegative(budget.wall_seconds_observed, "headroom result.budget.wall_seconds_observed");
	const withinCpuCap = boolean(budget.within_cpu_cap, "headroom result.budget.within_cpu_cap");
	if (withinCpuCap !== cpuSeconds <= 600) throw new Error("Headroom CPU-cap status is inconsistent");
	const withinWallCap = boolean(budget.within_wall_cap, "headroom result.budget.within_wall_cap");
	if (withinWallCap !== wallSeconds <= 600) throw new Error("Headroom wall-cap status is inconsistent");
	const softLimitExhausted = boolean(budget.soft_limit_exhausted, "headroom result.budget.soft_limit_exhausted");
	if (
		softLimitExhausted !==
		(cpuSeconds >= COMPILER_GYM_COMPLETE_ACTION_SPACE_CPU_SECONDS_SOFT_LIMIT ||
			wallSeconds >= COMPILER_GYM_COMPLETE_ACTION_SPACE_WALL_SECONDS_SOFT_LIMIT)
	) {
		throw new Error("Headroom soft-budget status is inconsistent");
	}
	const gatePassed =
		sweepComplete &&
		withinCpuCap &&
		withinWallCap &&
		!softLimitExhausted &&
		verifiedFlags.length >= COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS;
	if (notRunBudgetExhaustedCount > 0 && !softLimitExhausted) {
		throw new Error("Headroom verifier budget stop lacks an exhausted soft budget");
	}
	const passGate = record(result.pass_gate, "headroom result.pass_gate");
	exactKeys(
		passGate,
		["minimum_distinct_verified_omitted_flags", "observed_distinct_verified_omitted_flags", "passed"],
		"headroom result.pass_gate",
	);
	if (
		passGate.minimum_distinct_verified_omitted_flags !== COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS ||
		passGate.observed_distinct_verified_omitted_flags !== verifiedFlags.length ||
		passGate.passed !== gatePassed ||
		result.ok !== gatePassed
	) {
		throw new Error("Headroom pass gate is inconsistent");
	}
	const apparatusCompleted = boolean(result.apparatus_completed, "headroom result.apparatus_completed");
	const expectedApparatusCompleted =
		sweepComplete &&
		!softLimitExhausted &&
		withinCpuCap &&
		withinWallCap &&
		(gatePassed || negativeVerificationComplete);
	if (apparatusCompleted !== expectedApparatusCompleted) {
		throw new Error("Headroom apparatus completion status is inconsistent");
	}
	const status = result.status;
	if (status !== "passed" && status !== "headroom_not_demonstrated" && status !== "budget_exhausted") {
		throw new Error("Headroom result status is invalid");
	}
	const expectedStatus = gatePassed
		? "passed"
		: expectedApparatusCompleted
			? "headroom_not_demonstrated"
			: "budget_exhausted";
	if (status !== expectedStatus) throw new Error("Headroom result status contradicts the pass gate");
	const timings = record(result.timings_seconds, "headroom result.timings_seconds");
	exactKeys(timings, ["cpu", "wall"], "headroom result.timings_seconds");
	if (
		finiteNonnegative(timings.cpu, "headroom result.timings_seconds.cpu") !== cpuSeconds ||
		finiteNonnegative(timings.wall, "headroom result.timings_seconds.wall") !== wallSeconds
	) {
		throw new Error("Headroom result timing and budget observations disagree");
	}
	return {
		gatePassed,
		apparatusCompleted,
		status,
		baselineIrInstructionCount: baselineIr,
		requiredImprovementInstructions: requiredImprovement,
		qualifiedFlags,
		verifiedFlags,
		observedCpuSeconds: cpuSeconds,
		observedWallSeconds: wallSeconds,
	};
}

export async function loadCompilerGymCompleteActionSpaceSources(
	repoRoot = DEFAULT_REPO_ROOT,
): Promise<CompilerGymCompleteActionSpaceSources> {
	const [analysisContents, authoritativeEvaluatorContents, actionGuideSourceContents, headroomEvaluatorContents] =
		await Promise.all([
			readFile(resolve(repoRoot, COMPILER_GYM_COMPLETE_ACTION_SPACE_ANALYSIS_PATH), "utf8"),
			readFile(resolve(repoRoot, COMPILER_GYM_COMPLETE_ACTION_SPACE_AUTHORITATIVE_EVALUATOR_PATH), "utf8"),
			readFile(resolve(repoRoot, COMPILER_GYM_COMPLETE_ACTION_SPACE_ACTION_GUIDE_PATH), "utf8"),
			readFile(resolve(repoRoot, COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_PATH), "utf8"),
		]);
	const pinned = parsePinnedAnalysis(analysisContents);
	const ledgers = await Promise.all(
		pinned.inputLedgers.map(async (input): Promise<CompilerGymCompleteActionSpaceLedgerSource> => {
			const ledgerPath = resolve(repoRoot, pinned.ledgerRoot, input.path);
			const contents = await readFile(ledgerPath, "utf8");
			const events = verifyLedgerContentsStrict(contents);
			const digests = new Set(
				events
					.filter((event) => event.kind === "proposal")
					.map((event) => candidateBinding(event, input.path).digest),
			);
			const artifacts: Record<string, string> = {};
			await Promise.all(
				[...digests].map(async (value) => {
					artifacts[value] = await readFile(
						join(dirname(ledgerPath), "artifacts", "sha256", value.slice(0, 2), value.slice(2)),
						"utf8",
					);
				}),
			);
			return { path: input.path, contents, artifacts };
		}),
	);
	return {
		analysisContents,
		authoritativeEvaluatorContents,
		actionGuideSourceContents,
		headroomEvaluatorContents,
		ledgers,
	};
}

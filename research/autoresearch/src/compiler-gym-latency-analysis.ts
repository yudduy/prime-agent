import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	COMPILER_GYM_EVALUATOR_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
	DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
} from "./compiler-gym-adapter.js";
import { verifyLedgerContentsStrict } from "./ledger.js";

export const COMPILER_GYM_LATENCY_ANALYSIS_ID = "compiler-gym-allocation-latency-v1" as const;
export const COMPILER_GYM_LATENCY_BENCHMARKS = [
	"benchmark://cbench-v1/blowfish",
	"benchmark://cbench-v1/bzip2",
] as const;

const BLOWFISH = COMPILER_GYM_LATENCY_BENCHMARKS[0];
const BZIP2 = COMPILER_GYM_LATENCY_BENCHMARKS[1];
const EXPECTED_LEDGER_COUNT = 21;

export const COMPILER_GYM_LATENCY_EXPECTED_HARDWARE = {
	cluster: "Stanford FarmShare",
	partition: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.partition,
	cpuConstraint: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.cpuConstraint,
} as const;

export const COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE = {
	adapter: "farmshare-compiler-gym",
	evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
	environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
	upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
	compilerGym: "0.2.5",
	llvm: "10.0.0",
} as const;

export const COMPILER_GYM_LATENCY_FORMULAS = {
	wallMs: "task.metrics.schedulerAndEvaluatorWallMs",
	evaluatorMs: "task.metrics.evaluatorRuntimeMs",
	recordedResidualMs: "task.metrics.queueAndTransportMs",
	residualMs: "max(0, wallMs - evaluatorMs)",
	criticalMs: "max(blowfish.wallMs, bzip2.wallMs)",
	residualDeltaMs: "bzip2.residualMs - blowfish.residualMs",
	optimisticFusionSavingMs: "max(0, residualDeltaMs)",
	median: "middle value for odd cardinality; arithmetic mean of the two middle values for even cardinality",
	summaryPrecisionDecimals: 3,
	summaryRounding: "half-away-from-zero",
} as const;

export const COMPILER_GYM_WARM_ALLOCATION_HEADROOM = {
	groupBy: "ledgerPath",
	multiCandidateMinimumMeasurements: 2,
	excludeFirstMeasurementPerLedger: true,
	postFirstSavingMs: "bzip2.residualMs",
	trajectoryOptimisticTotalSavingMs: "sum(post-first bzip2.residualMs)",
	trajectoryObservedCriticalTotalMs: "sum(all candidate criticalMs, including first)",
	trajectoryOptimisticFraction: "trajectoryOptimisticTotalSavingMs / trajectoryObservedCriticalTotalMs",
	postFirstMedianPrecisionDecimals: 4,
	trajectoryTotalPrecisionDecimals: 3,
	trajectoryFractionPrecisionDecimals: 6,
	interpretation: "optimistic upper-bound proxy; not a causal estimate",
} as const;

export interface CompilerGymLatencyInclusion {
	verifierEpoch: string;
	benchmarkIds: readonly string[];
	requireNoReuse: boolean;
	requireAcceptedStatus: boolean;
	requireVerifierPassed: boolean;
	requireFiniteTimings: boolean;
	requireRecordedResidualMatchesFormula: boolean;
}

export interface CompilerGymLatencyDeduplication {
	key: "jobId";
	identicalDuplicate: "deduplicate";
	conflictingDuplicate: "error";
}

export interface CompilerGymLatencyFormulas {
	wallMs: string;
	evaluatorMs: string;
	recordedResidualMs: string;
	residualMs: string;
	criticalMs: string;
	residualDeltaMs: string;
	optimisticFusionSavingMs: string;
	median: string;
	summaryPrecisionDecimals: number;
	summaryRounding: string;
}

export interface ExpectedCompilerGymLatencySummary {
	rowCount: number;
	bzip2CriticalCount: number;
	medianCriticalMs: number;
	medianBzip2EvaluatorMs: number;
	medianBzip2ResidualMs: number;
	medianResidualDeltaMs?: number;
	medianOptimisticFusionSavingMs: number;
}

export interface CompilerGymWarmAllocationHeadroomConfig {
	groupBy: string;
	multiCandidateMinimumMeasurements: number;
	excludeFirstMeasurementPerLedger: boolean;
	postFirstSavingMs: string;
	trajectoryOptimisticTotalSavingMs: string;
	trajectoryObservedCriticalTotalMs: string;
	trajectoryOptimisticFraction: string;
	postFirstMedianPrecisionDecimals: number;
	trajectoryTotalPrecisionDecimals: number;
	trajectoryFractionPrecisionDecimals: number;
	interpretation: string;
}

export interface ExpectedCompilerGymWarmAllocationHeadroom {
	multiCandidateLedgerCount: number;
	postFirstCandidateCount: number;
	medianPostFirstBzip2ResidualMs: number;
	medianTrajectoryOptimisticTotalSavingMs: number;
	medianTrajectoryOptimisticFraction: number;
}

export interface CompilerGymLatencyConfig {
	schemaVersion: 1;
	analysisId: typeof COMPILER_GYM_LATENCY_ANALYSIS_ID;
	ledgerRoot: string;
	outputDirectory: string;
	ledgerPaths: readonly string[];
	sensitivityLedgerPaths: readonly string[];
	inclusion: CompilerGymLatencyInclusion;
	deduplication: CompilerGymLatencyDeduplication;
	hardware: Readonly<Record<string, string>>;
	provenance: Readonly<Record<string, string>>;
	formulas: CompilerGymLatencyFormulas;
	warmAllocationHeadroom: CompilerGymWarmAllocationHeadroomConfig;
	expectations: {
		cohort: ExpectedCompilerGymLatencySummary;
		sensitivity: ExpectedCompilerGymLatencySummary;
		warmAllocationHeadroom: ExpectedCompilerGymWarmAllocationHeadroom;
	};
}

export interface CompilerGymLatencyLedgerSource {
	path: string;
	contents: string;
}

export interface CompilerGymLatencyTaskTiming {
	benchmarkId: (typeof COMPILER_GYM_LATENCY_BENCHMARKS)[number];
	wallMs: number;
	evaluatorMs: number;
	residualMs: number;
}

export interface CompilerGymLatencyRow {
	jobId: string;
	manifestDigest: string;
	measurementPayloadSha256: string;
	sourceLedgerPaths: string[];
	tasks: {
		blowfish: CompilerGymLatencyTaskTiming;
		bzip2: CompilerGymLatencyTaskTiming;
	};
	criticalMs: number;
	bzip2IsCritical: boolean;
	residualDeltaMs: number;
	optimisticFusionSavingMs: number;
}

export interface CompilerGymLatencySummary {
	rowCount: number;
	bzip2CriticalCount: number;
	bzip2CriticalFraction: number;
	medianCriticalMs: number;
	medianBzip2EvaluatorMs: number;
	medianBzip2ResidualMs: number;
	medianBlowfishResidualMs: number;
	medianResidualDeltaMs: number;
	medianOptimisticFusionSavingMs: number;
}

export interface CompilerGymWarmAllocationTrajectory {
	ledgerPath: string;
	candidateCount: number;
	postFirstCandidateCount: number;
	observedCriticalTotalMs: number;
	optimisticTotalSavingMs: number;
	optimisticFractionOfObservedCriticalTotal: number;
}

export interface CompilerGymWarmAllocationHeadroom {
	classification: "optimistic upper-bound proxy; not a causal estimate";
	ledgerCount: number;
	multiCandidateLedgerCount: number;
	postFirstCandidateCount: number;
	medianPostFirstBzip2ResidualMs: number;
	medianTrajectoryOptimisticTotalSavingMs: number;
	medianTrajectoryOptimisticFraction: number;
	trajectories: CompilerGymWarmAllocationTrajectory[];
}

export interface CompilerGymLatencyAnalysis {
	schemaVersion: 1;
	analysisId: typeof COMPILER_GYM_LATENCY_ANALYSIS_ID;
	configCanonicalSha256: string;
	ledgerRoot: string;
	inputLedgers: Array<{
		path: string;
		sha256: string;
		eventCount: number;
		measurementCount: number;
		terminalEventHash: string;
	}>;
	rules: {
		inclusion: CompilerGymLatencyInclusion;
		deduplication: CompilerGymLatencyDeduplication;
		hardware: Readonly<Record<string, string>>;
		provenance: Readonly<Record<string, string>>;
		formulas: CompilerGymLatencyFormulas;
		warmAllocationHeadroom: CompilerGymWarmAllocationHeadroomConfig;
	};
	rawMeasurementCount: number;
	deduplicatedMeasurementCount: number;
	cohort: {
		summary: CompilerGymLatencySummary;
		rows: CompilerGymLatencyRow[];
	};
	sensitivity: {
		ledgerPaths: readonly string[];
		summary: CompilerGymLatencySummary;
		rows: CompilerGymLatencyRow[];
	};
	warmAllocationHeadroom: CompilerGymWarmAllocationHeadroom;
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

function string(value: unknown, path: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
	return value;
}

function finiteNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
	return value;
}

function nonnegativeSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function stringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
		throw new Error(`${path} must be a non-empty-string array`);
	}
	return [...value];
}

function stringRecord(value: unknown, path: string): Record<string, string> {
	const parsed = record(value, path);
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(parsed)) result[key] = string(item, `${path}.${key}`);
	return result;
}

function exactJson(actual: unknown, expected: unknown, path: string): void {
	const actualJson = canonicalJson(toJsonValue(actual));
	const expectedJson = canonicalJson(toJsonValue(expected));
	if (actualJson !== expectedJson) throw new Error(`${path} drift: expected=${expectedJson} received=${actualJson}`);
}

function portableRelativePath(value: unknown, path: string): string {
	const parsed = string(value, path);
	const segments = parsed.split("/");
	if (
		parsed.startsWith("/") ||
		parsed.includes("\\") ||
		segments.some((segment) => segment === "" || segment === "." || segment === "..")
	) {
		throw new Error(`${path} must be a normalized portable relative path`);
	}
	return parsed;
}

function uniquePaths(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	const paths = value.map((item, index) => portableRelativePath(item, `${path}[${index}]`));
	if (new Set(paths).size !== paths.length) throw new Error(`${path} contains a duplicate path`);
	return paths;
}

function expectedSummary(value: unknown, path: string): ExpectedCompilerGymLatencySummary {
	const parsed = record(value, path);
	const requiredKeys = [
		"rowCount",
		"bzip2CriticalCount",
		"medianCriticalMs",
		"medianBzip2EvaluatorMs",
		"medianBzip2ResidualMs",
		"medianOptimisticFusionSavingMs",
	];
	const allowedKeys = new Set([...requiredKeys, "medianResidualDeltaMs"]);
	for (const key of Object.keys(parsed)) {
		if (!allowedKeys.has(key)) throw new Error(`${path}.${key} is not supported`);
	}
	for (const key of requiredKeys) {
		if (!(key in parsed)) throw new Error(`${path}.${key} is required`);
	}
	const result: ExpectedCompilerGymLatencySummary = {
		rowCount: nonnegativeSafeInteger(parsed.rowCount, `${path}.rowCount`),
		bzip2CriticalCount: nonnegativeSafeInteger(parsed.bzip2CriticalCount, `${path}.bzip2CriticalCount`),
		medianCriticalMs: finiteNumber(parsed.medianCriticalMs, `${path}.medianCriticalMs`),
		medianBzip2EvaluatorMs: finiteNumber(parsed.medianBzip2EvaluatorMs, `${path}.medianBzip2EvaluatorMs`),
		medianBzip2ResidualMs: finiteNumber(parsed.medianBzip2ResidualMs, `${path}.medianBzip2ResidualMs`),
		medianOptimisticFusionSavingMs: finiteNumber(
			parsed.medianOptimisticFusionSavingMs,
			`${path}.medianOptimisticFusionSavingMs`,
		),
	};
	if (parsed.medianResidualDeltaMs !== undefined) {
		result.medianResidualDeltaMs = finiteNumber(parsed.medianResidualDeltaMs, `${path}.medianResidualDeltaMs`);
	}
	return result;
}

function expectedWarmAllocationHeadroom(value: unknown, path: string): ExpectedCompilerGymWarmAllocationHeadroom {
	const parsed = record(value, path);
	exactKeys(
		parsed,
		[
			"multiCandidateLedgerCount",
			"postFirstCandidateCount",
			"medianPostFirstBzip2ResidualMs",
			"medianTrajectoryOptimisticTotalSavingMs",
			"medianTrajectoryOptimisticFraction",
		],
		path,
	);
	return {
		multiCandidateLedgerCount: nonnegativeSafeInteger(
			parsed.multiCandidateLedgerCount,
			`${path}.multiCandidateLedgerCount`,
		),
		postFirstCandidateCount: nonnegativeSafeInteger(
			parsed.postFirstCandidateCount,
			`${path}.postFirstCandidateCount`,
		),
		medianPostFirstBzip2ResidualMs: finiteNumber(
			parsed.medianPostFirstBzip2ResidualMs,
			`${path}.medianPostFirstBzip2ResidualMs`,
		),
		medianTrajectoryOptimisticTotalSavingMs: finiteNumber(
			parsed.medianTrajectoryOptimisticTotalSavingMs,
			`${path}.medianTrajectoryOptimisticTotalSavingMs`,
		),
		medianTrajectoryOptimisticFraction: finiteNumber(
			parsed.medianTrajectoryOptimisticFraction,
			`${path}.medianTrajectoryOptimisticFraction`,
		),
	};
}

export function parseCompilerGymLatencyConfig(value: unknown): CompilerGymLatencyConfig {
	const root = record(value, "config");
	exactKeys(
		root,
		[
			"schemaVersion",
			"analysisId",
			"ledgerRoot",
			"outputDirectory",
			"ledgerPaths",
			"sensitivityLedgerPaths",
			"inclusion",
			"deduplication",
			"hardware",
			"provenance",
			"formulas",
			"warmAllocationHeadroom",
			"expectations",
		],
		"config",
	);
	if (root.schemaVersion !== 1) throw new Error("config.schemaVersion must be 1");
	if (root.analysisId !== COMPILER_GYM_LATENCY_ANALYSIS_ID) {
		throw new Error(`config.analysisId must be ${COMPILER_GYM_LATENCY_ANALYSIS_ID}`);
	}
	const ledgerPaths = uniquePaths(root.ledgerPaths, "config.ledgerPaths");
	if (ledgerPaths.length !== EXPECTED_LEDGER_COUNT) {
		throw new Error(`config.ledgerPaths must contain exactly ${EXPECTED_LEDGER_COUNT} paths`);
	}
	const sensitivityLedgerPaths = uniquePaths(root.sensitivityLedgerPaths, "config.sensitivityLedgerPaths");
	if (sensitivityLedgerPaths.length !== 2) {
		throw new Error("config.sensitivityLedgerPaths must contain exactly two paths");
	}
	for (const path of sensitivityLedgerPaths) {
		if (!ledgerPaths.includes(path)) throw new Error(`Sensitivity ledger is outside the cohort: ${path}`);
	}

	const inclusionRecord = record(root.inclusion, "config.inclusion");
	exactKeys(
		inclusionRecord,
		[
			"verifierEpoch",
			"benchmarkIds",
			"requireNoReuse",
			"requireAcceptedStatus",
			"requireVerifierPassed",
			"requireFiniteTimings",
			"requireRecordedResidualMatchesFormula",
		],
		"config.inclusion",
	);
	const inclusion: CompilerGymLatencyInclusion = {
		verifierEpoch: string(inclusionRecord.verifierEpoch, "config.inclusion.verifierEpoch"),
		benchmarkIds: stringArray(inclusionRecord.benchmarkIds, "config.inclusion.benchmarkIds"),
		requireNoReuse: boolean(inclusionRecord.requireNoReuse, "config.inclusion.requireNoReuse"),
		requireAcceptedStatus: boolean(inclusionRecord.requireAcceptedStatus, "config.inclusion.requireAcceptedStatus"),
		requireVerifierPassed: boolean(inclusionRecord.requireVerifierPassed, "config.inclusion.requireVerifierPassed"),
		requireFiniteTimings: boolean(inclusionRecord.requireFiniteTimings, "config.inclusion.requireFiniteTimings"),
		requireRecordedResidualMatchesFormula: boolean(
			inclusionRecord.requireRecordedResidualMatchesFormula,
			"config.inclusion.requireRecordedResidualMatchesFormula",
		),
	};

	const deduplicationRecord = record(root.deduplication, "config.deduplication");
	exactKeys(deduplicationRecord, ["key", "identicalDuplicate", "conflictingDuplicate"], "config.deduplication");
	if (
		deduplicationRecord.key !== "jobId" ||
		deduplicationRecord.identicalDuplicate !== "deduplicate" ||
		deduplicationRecord.conflictingDuplicate !== "error"
	) {
		throw new Error("config.deduplication must use the frozen jobId/identical-dedup/conflict-error policy");
	}
	const deduplication: CompilerGymLatencyDeduplication = {
		key: "jobId",
		identicalDuplicate: "deduplicate",
		conflictingDuplicate: "error",
	};

	const formulasRecord = record(root.formulas, "config.formulas");
	exactKeys(formulasRecord, Object.keys(COMPILER_GYM_LATENCY_FORMULAS), "config.formulas");
	const formulas: CompilerGymLatencyFormulas = {
		wallMs: string(formulasRecord.wallMs, "config.formulas.wallMs"),
		evaluatorMs: string(formulasRecord.evaluatorMs, "config.formulas.evaluatorMs"),
		recordedResidualMs: string(formulasRecord.recordedResidualMs, "config.formulas.recordedResidualMs"),
		residualMs: string(formulasRecord.residualMs, "config.formulas.residualMs"),
		criticalMs: string(formulasRecord.criticalMs, "config.formulas.criticalMs"),
		residualDeltaMs: string(formulasRecord.residualDeltaMs, "config.formulas.residualDeltaMs"),
		optimisticFusionSavingMs: string(
			formulasRecord.optimisticFusionSavingMs,
			"config.formulas.optimisticFusionSavingMs",
		),
		median: string(formulasRecord.median, "config.formulas.median"),
		summaryPrecisionDecimals: nonnegativeSafeInteger(
			formulasRecord.summaryPrecisionDecimals,
			"config.formulas.summaryPrecisionDecimals",
		),
		summaryRounding: string(formulasRecord.summaryRounding, "config.formulas.summaryRounding"),
	};
	const warmRecord = record(root.warmAllocationHeadroom, "config.warmAllocationHeadroom");
	exactKeys(warmRecord, Object.keys(COMPILER_GYM_WARM_ALLOCATION_HEADROOM), "config.warmAllocationHeadroom");
	const warmAllocationHeadroom: CompilerGymWarmAllocationHeadroomConfig = {
		groupBy: string(warmRecord.groupBy, "config.warmAllocationHeadroom.groupBy"),
		multiCandidateMinimumMeasurements: nonnegativeSafeInteger(
			warmRecord.multiCandidateMinimumMeasurements,
			"config.warmAllocationHeadroom.multiCandidateMinimumMeasurements",
		),
		excludeFirstMeasurementPerLedger: boolean(
			warmRecord.excludeFirstMeasurementPerLedger,
			"config.warmAllocationHeadroom.excludeFirstMeasurementPerLedger",
		),
		postFirstSavingMs: string(warmRecord.postFirstSavingMs, "config.warmAllocationHeadroom.postFirstSavingMs"),
		trajectoryOptimisticTotalSavingMs: string(
			warmRecord.trajectoryOptimisticTotalSavingMs,
			"config.warmAllocationHeadroom.trajectoryOptimisticTotalSavingMs",
		),
		trajectoryObservedCriticalTotalMs: string(
			warmRecord.trajectoryObservedCriticalTotalMs,
			"config.warmAllocationHeadroom.trajectoryObservedCriticalTotalMs",
		),
		trajectoryOptimisticFraction: string(
			warmRecord.trajectoryOptimisticFraction,
			"config.warmAllocationHeadroom.trajectoryOptimisticFraction",
		),
		postFirstMedianPrecisionDecimals: nonnegativeSafeInteger(
			warmRecord.postFirstMedianPrecisionDecimals,
			"config.warmAllocationHeadroom.postFirstMedianPrecisionDecimals",
		),
		trajectoryTotalPrecisionDecimals: nonnegativeSafeInteger(
			warmRecord.trajectoryTotalPrecisionDecimals,
			"config.warmAllocationHeadroom.trajectoryTotalPrecisionDecimals",
		),
		trajectoryFractionPrecisionDecimals: nonnegativeSafeInteger(
			warmRecord.trajectoryFractionPrecisionDecimals,
			"config.warmAllocationHeadroom.trajectoryFractionPrecisionDecimals",
		),
		interpretation: string(warmRecord.interpretation, "config.warmAllocationHeadroom.interpretation"),
	};

	const expectationsRecord = record(root.expectations, "config.expectations");
	exactKeys(expectationsRecord, ["cohort", "sensitivity", "warmAllocationHeadroom"], "config.expectations");
	const config: CompilerGymLatencyConfig = {
		schemaVersion: 1,
		analysisId: COMPILER_GYM_LATENCY_ANALYSIS_ID,
		ledgerRoot: portableRelativePath(root.ledgerRoot, "config.ledgerRoot"),
		outputDirectory: portableRelativePath(root.outputDirectory, "config.outputDirectory"),
		ledgerPaths,
		sensitivityLedgerPaths,
		inclusion,
		deduplication,
		hardware: stringRecord(root.hardware, "config.hardware"),
		provenance: stringRecord(root.provenance, "config.provenance"),
		formulas,
		warmAllocationHeadroom,
		expectations: {
			cohort: expectedSummary(expectationsRecord.cohort, "config.expectations.cohort"),
			sensitivity: expectedSummary(expectationsRecord.sensitivity, "config.expectations.sensitivity"),
			warmAllocationHeadroom: expectedWarmAllocationHeadroom(
				expectationsRecord.warmAllocationHeadroom,
				"config.expectations.warmAllocationHeadroom",
			),
		},
	};
	assertPinnedConfig(config);
	return config;
}

function assertPinnedConfig(config: CompilerGymLatencyConfig): void {
	if (config.schemaVersion !== 1 || config.analysisId !== COMPILER_GYM_LATENCY_ANALYSIS_ID) {
		throw new Error("Latency analysis protocol drift");
	}
	exactJson(
		config.inclusion,
		{
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			benchmarkIds: COMPILER_GYM_LATENCY_BENCHMARKS,
			requireNoReuse: true,
			requireAcceptedStatus: true,
			requireVerifierPassed: true,
			requireFiniteTimings: true,
			requireRecordedResidualMatchesFormula: true,
		},
		"config.inclusion",
	);
	exactJson(
		config.deduplication,
		{ key: "jobId", identicalDuplicate: "deduplicate", conflictingDuplicate: "error" },
		"config.deduplication",
	);
	exactJson(config.hardware, COMPILER_GYM_LATENCY_EXPECTED_HARDWARE, "config.hardware");
	exactJson(config.provenance, COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE, "config.provenance");
	exactJson(config.formulas, COMPILER_GYM_LATENCY_FORMULAS, "config.formulas");
	exactJson(config.warmAllocationHeadroom, COMPILER_GYM_WARM_ALLOCATION_HEADROOM, "config.warmAllocationHeadroom");
}

function rounded(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	const adjusted = Math.abs(value) + Number.EPSILON * Math.max(1, Math.abs(value));
	return (Math.sign(value) * Math.round(adjusted * factor)) / factor;
}

function timing(value: unknown, path: string, decimals: number): number {
	const result = rounded(finiteNumber(value, path), decimals);
	if (!Number.isFinite(result)) throw new Error(`${path} must remain finite at the frozen precision`);
	return result;
}

function parseTask(value: unknown, path: string, decimals: number): CompilerGymLatencyTaskTiming {
	const task = record(value, path);
	const benchmarkId = string(task.benchmarkId, `${path}.benchmarkId`);
	if (benchmarkId !== BLOWFISH && benchmarkId !== BZIP2) {
		throw new Error(`${path}.benchmarkId is outside the frozen task set: ${benchmarkId}`);
	}
	if (task.status !== "accepted") throw new Error(`${path}.status must be accepted`);
	const verifier = record(task.verifier, `${path}.verifier`);
	if (verifier.passed !== true) throw new Error(`${path}.verifier.passed must be true`);
	const metrics = record(task.metrics, `${path}.metrics`);
	const wallMs = timing(metrics.schedulerAndEvaluatorWallMs, `${path}.metrics.schedulerAndEvaluatorWallMs`, decimals);
	const evaluatorMs = timing(metrics.evaluatorRuntimeMs, `${path}.metrics.evaluatorRuntimeMs`, decimals);
	const expectedResidualMs = rounded(Math.max(0, wallMs - evaluatorMs), decimals);
	if (!Number.isFinite(expectedResidualMs)) throw new Error(`${path} produced a non-finite residual`);
	const residualMs = timing(metrics.queueAndTransportMs, `${path}.metrics.queueAndTransportMs`, decimals);
	if (residualMs !== expectedResidualMs) {
		throw new Error(
			`${path}.metrics.queueAndTransportMs mismatch: expected=${expectedResidualMs} received=${residualMs}`,
		);
	}
	return {
		benchmarkId,
		wallMs,
		evaluatorMs,
		residualMs,
	};
}

function parseMeasurement(
	payloadValue: unknown,
	sourceLedgerPath: string,
	config: CompilerGymLatencyConfig,
): CompilerGymLatencyRow {
	const payload = record(payloadValue, `${sourceLedgerPath}:measurement`);
	const jobId = string(payload.jobId, `${sourceLedgerPath}:measurement.jobId`);
	const manifestDigest = string(payload.manifestDigest, `${jobId}.manifestDigest`);
	if (!/^[a-f0-9]{64}$/.test(manifestDigest)) throw new Error(`${jobId}.manifestDigest must be a lowercase SHA-256`);
	if (Object.hasOwn(payload, "reuse"))
		throw new Error(`${jobId} is reused evidence; the latency cohort requires fresh timing`);
	if (payload.verifierEpoch !== config.inclusion.verifierEpoch) {
		throw new Error(
			`${jobId}.verifierEpoch drift: expected=${config.inclusion.verifierEpoch} received=${String(payload.verifierEpoch)}`,
		);
	}
	exactJson(payload.hardware, config.hardware, `${jobId}.hardware`);
	exactJson(payload.provenance, config.provenance, `${jobId}.provenance`);
	if (!Array.isArray(payload.tasks) || payload.tasks.length !== COMPILER_GYM_LATENCY_BENCHMARKS.length) {
		throw new Error(`${jobId}.tasks must contain exactly two task records`);
	}
	const parsedTasks = payload.tasks.map((task, index) =>
		parseTask(task, `${jobId}.tasks[${index}]`, config.formulas.summaryPrecisionDecimals),
	);
	const taskById = new Map(parsedTasks.map((task) => [task.benchmarkId, task]));
	if (taskById.size !== COMPILER_GYM_LATENCY_BENCHMARKS.length) {
		throw new Error(`${jobId}.tasks contains a duplicate benchmark ID`);
	}
	const blowfish = taskById.get(BLOWFISH);
	const bzip2 = taskById.get(BZIP2);
	if (!blowfish || !bzip2) throw new Error(`${jobId}.tasks does not exactly cover blowfish and bzip2`);
	const criticalMs = Math.max(blowfish.wallMs, bzip2.wallMs);
	const residualDeltaMs = rounded(bzip2.residualMs - blowfish.residualMs, config.formulas.summaryPrecisionDecimals);
	const optimisticFusionSavingMs = rounded(Math.max(0, residualDeltaMs), config.formulas.summaryPrecisionDecimals);
	return {
		jobId,
		manifestDigest,
		measurementPayloadSha256: sha256Json(payload),
		sourceLedgerPaths: [sourceLedgerPath],
		tasks: { blowfish, bzip2 },
		criticalMs,
		bzip2IsCritical: bzip2.wallMs === criticalMs,
		residualDeltaMs,
		optimisticFusionSavingMs,
	};
}

function median(values: readonly number[], decimals: number): number {
	if (values.length === 0) throw new Error("Cannot compute a median over an empty cohort");
	const sorted = [...values].sort((left, right) => left - right);
	const midpoint = Math.floor(sorted.length / 2);
	const value = sorted.length % 2 === 1 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
	return rounded(value, decimals);
}

function summarize(rows: readonly CompilerGymLatencyRow[], decimals: number): CompilerGymLatencySummary {
	return {
		rowCount: rows.length,
		bzip2CriticalCount: rows.filter((row) => row.bzip2IsCritical).length,
		bzip2CriticalFraction: rounded(rows.filter((row) => row.bzip2IsCritical).length / rows.length, 9),
		medianCriticalMs: median(
			rows.map((row) => row.criticalMs),
			decimals,
		),
		medianBzip2EvaluatorMs: median(
			rows.map((row) => row.tasks.bzip2.evaluatorMs),
			decimals,
		),
		medianBzip2ResidualMs: median(
			rows.map((row) => row.tasks.bzip2.residualMs),
			decimals,
		),
		medianBlowfishResidualMs: median(
			rows.map((row) => row.tasks.blowfish.residualMs),
			decimals,
		),
		medianResidualDeltaMs: median(
			rows.map((row) => row.residualDeltaMs),
			decimals,
		),
		medianOptimisticFusionSavingMs: median(
			rows.map((row) => row.optimisticFusionSavingMs),
			decimals,
		),
	};
}

function assertExpectedSummary(
	actual: CompilerGymLatencySummary,
	expected: ExpectedCompilerGymLatencySummary,
	path: string,
): void {
	for (const [key, expectedValue] of Object.entries(expected)) {
		const actualValue = actual[key as keyof CompilerGymLatencySummary];
		if (actualValue !== expectedValue) {
			throw new Error(`${path}.${key} mismatch: expected=${expectedValue} received=${String(actualValue)}`);
		}
	}
}

function analyzeWarmAllocationHeadroom(
	config: CompilerGymLatencyConfig,
	jobIdsByLedger: ReadonlyMap<string, readonly string[]>,
	rowsByJobId: ReadonlyMap<string, CompilerGymLatencyRow>,
): CompilerGymWarmAllocationHeadroom {
	const trajectories: CompilerGymWarmAllocationTrajectory[] = [];
	const postFirstRows: CompilerGymLatencyRow[] = [];
	for (const ledgerPath of config.ledgerPaths) {
		const jobIds = jobIdsByLedger.get(ledgerPath) ?? [];
		if (jobIds.length < config.warmAllocationHeadroom.multiCandidateMinimumMeasurements) continue;
		const ledgerRows = jobIds.map((jobId) => {
			const row = rowsByJobId.get(jobId);
			if (!row) throw new Error(`Warm-allocation grouping lost ${jobId} from ${ledgerPath}`);
			return row;
		});
		const reusableRows = ledgerRows.slice(1);
		postFirstRows.push(...reusableRows);
		const observedCriticalTotalMs = rounded(
			ledgerRows.reduce((total, row) => total + row.criticalMs, 0),
			config.warmAllocationHeadroom.trajectoryTotalPrecisionDecimals,
		);
		if (!(observedCriticalTotalMs > 0)) {
			throw new Error(`${ledgerPath} has a non-positive critical-wall denominator`);
		}
		const optimisticTotalSavingMs = rounded(
			reusableRows.reduce((total, row) => total + row.tasks.bzip2.residualMs, 0),
			config.warmAllocationHeadroom.trajectoryTotalPrecisionDecimals,
		);
		trajectories.push({
			ledgerPath,
			candidateCount: ledgerRows.length,
			postFirstCandidateCount: reusableRows.length,
			observedCriticalTotalMs,
			optimisticTotalSavingMs,
			optimisticFractionOfObservedCriticalTotal: rounded(
				optimisticTotalSavingMs / observedCriticalTotalMs,
				config.warmAllocationHeadroom.trajectoryFractionPrecisionDecimals,
			),
		});
	}
	const result: CompilerGymWarmAllocationHeadroom = {
		classification: "optimistic upper-bound proxy; not a causal estimate",
		ledgerCount: config.ledgerPaths.length,
		multiCandidateLedgerCount: trajectories.length,
		postFirstCandidateCount: postFirstRows.length,
		medianPostFirstBzip2ResidualMs: median(
			postFirstRows.map((row) => row.tasks.bzip2.residualMs),
			config.warmAllocationHeadroom.postFirstMedianPrecisionDecimals,
		),
		medianTrajectoryOptimisticTotalSavingMs: median(
			trajectories.map((trajectory) => trajectory.optimisticTotalSavingMs),
			config.warmAllocationHeadroom.trajectoryTotalPrecisionDecimals,
		),
		medianTrajectoryOptimisticFraction: median(
			trajectories.map((trajectory) => trajectory.optimisticFractionOfObservedCriticalTotal),
			config.warmAllocationHeadroom.trajectoryFractionPrecisionDecimals,
		),
		trajectories,
	};
	for (const [key, expectedValue] of Object.entries(config.expectations.warmAllocationHeadroom)) {
		const actualValue = result[key as keyof CompilerGymWarmAllocationHeadroom];
		if (actualValue !== expectedValue) {
			throw new Error(
				`warmAllocationHeadroom.${key} mismatch: expected=${expectedValue} received=${String(actualValue)}`,
			);
		}
	}
	return result;
}

export function analyzeCompilerGymLatency(
	config: CompilerGymLatencyConfig,
	sources: readonly CompilerGymLatencyLedgerSource[],
): CompilerGymLatencyAnalysis {
	assertPinnedConfig(config);
	const sourceByPath = new Map<string, CompilerGymLatencyLedgerSource>();
	for (const source of sources) {
		if (sourceByPath.has(source.path)) throw new Error(`Duplicate ledger source: ${source.path}`);
		sourceByPath.set(source.path, source);
	}
	const missingPaths = config.ledgerPaths.filter((path) => !sourceByPath.has(path));
	const extraPaths = [...sourceByPath.keys()].filter((path) => !config.ledgerPaths.includes(path));
	if (missingPaths.length > 0 || extraPaths.length > 0) {
		throw new Error(`Ledger source mismatch: missing=${missingPaths.join(",")} extra=${extraPaths.join(",")}`);
	}

	const rowsByJobId = new Map<string, CompilerGymLatencyRow>();
	const jobIdsByLedger = new Map<string, string[]>();
	const inputLedgers: CompilerGymLatencyAnalysis["inputLedgers"] = [];
	let rawMeasurementCount = 0;
	for (const path of config.ledgerPaths) {
		const source = sourceByPath.get(path);
		if (!source) throw new Error(`Missing ledger source after validation: ${path}`);
		const events = verifyLedgerContentsStrict(source.contents);
		const measurements = events.filter((event) => event.kind === "measurement");
		const ledgerJobIds: string[] = [];
		jobIdsByLedger.set(path, ledgerJobIds);
		inputLedgers.push({
			path,
			sha256: sha256Text(source.contents),
			eventCount: events.length,
			measurementCount: measurements.length,
			terminalEventHash: events.at(-1)?.hash ?? sha256Text(""),
		});
		for (const event of measurements) {
			rawMeasurementCount++;
			const candidate = parseMeasurement(event.payload, path, config);
			const existing = rowsByJobId.get(candidate.jobId);
			if (!existing) {
				rowsByJobId.set(candidate.jobId, candidate);
				ledgerJobIds.push(candidate.jobId);
				continue;
			}
			if (existing.measurementPayloadSha256 !== candidate.measurementPayloadSha256) {
				throw new Error(
					`Conflicting duplicate jobId ${candidate.jobId}: ${existing.measurementPayloadSha256} != ${candidate.measurementPayloadSha256}`,
				);
			}
			existing.sourceLedgerPaths = config.ledgerPaths.filter(
				(ledgerPath) => existing.sourceLedgerPaths.includes(ledgerPath) || ledgerPath === path,
			);
		}
	}

	const rows = [...rowsByJobId.values()].sort((left, right) =>
		left.jobId < right.jobId ? -1 : left.jobId > right.jobId ? 1 : 0,
	);
	const sensitivityPaths = new Set(config.sensitivityLedgerPaths);
	const sensitivityRows = rows.filter((row) => row.sourceLedgerPaths.some((path) => sensitivityPaths.has(path)));
	const cohortSummary = summarize(rows, config.formulas.summaryPrecisionDecimals);
	const sensitivitySummary = summarize(sensitivityRows, config.formulas.summaryPrecisionDecimals);
	assertExpectedSummary(cohortSummary, config.expectations.cohort, "cohort");
	assertExpectedSummary(sensitivitySummary, config.expectations.sensitivity, "sensitivity");
	const warmAllocationHeadroom = analyzeWarmAllocationHeadroom(config, jobIdsByLedger, rowsByJobId);

	return {
		schemaVersion: 1,
		analysisId: COMPILER_GYM_LATENCY_ANALYSIS_ID,
		configCanonicalSha256: sha256Json(config),
		ledgerRoot: config.ledgerRoot,
		inputLedgers,
		rules: {
			inclusion: config.inclusion,
			deduplication: config.deduplication,
			hardware: config.hardware,
			provenance: config.provenance,
			formulas: config.formulas,
			warmAllocationHeadroom: config.warmAllocationHeadroom,
		},
		rawMeasurementCount,
		deduplicatedMeasurementCount: rawMeasurementCount - rows.length,
		cohort: { summary: cohortSummary, rows },
		sensitivity: {
			ledgerPaths: config.sensitivityLedgerPaths,
			summary: sensitivitySummary,
			rows: sensitivityRows,
		},
		warmAllocationHeadroom,
	};
}

function formatMs(value: number): string {
	return value.toFixed(COMPILER_GYM_LATENCY_FORMULAS.summaryPrecisionDecimals);
}

function summaryLines(label: string, summary: CompilerGymLatencySummary): string[] {
	return [
		`## ${label}`,
		"",
		`- Rows: ${summary.rowCount}.`,
		`- bzip2 critical: ${summary.bzip2CriticalCount}/${summary.rowCount}.`,
		`- Median critical wall: ${formatMs(summary.medianCriticalMs)} ms.`,
		`- Median bzip2 evaluator time: ${formatMs(summary.medianBzip2EvaluatorMs)} ms.`,
		`- Median bzip2 queue/transport residual: ${formatMs(summary.medianBzip2ResidualMs)} ms.`,
		`- Median bzip2-minus-blowfish residual: ${formatMs(summary.medianResidualDeltaMs)} ms.`,
		`- Median optimistic fused-allocation saving: ${formatMs(summary.medianOptimisticFusionSavingMs)} ms.`,
		"",
	];
}

export function renderCompilerGymLatencyMarkdown(analysis: CompilerGymLatencyAnalysis): string {
	const warm = analysis.warmAllocationHeadroom;
	const warmRules = analysis.rules.warmAllocationHeadroom;
	const lines = [
		"# CompilerGym allocation-latency audit",
		"",
		"This read-only reconstruction verifies the frozen 21-ledger campaign cohort and models the most optimistic per-candidate two-task allocation fusion.",
		"",
		...summaryLines("Frozen campaign cohort", analysis.cohort.summary),
		...summaryLines("Latest full + concise sensitivity", analysis.sensitivity.summary),
		"## Modeled warm-allocation headroom",
		"",
		`Classification: **${warm.classification}**. This is a local retrospective model, not an observed treatment effect. It assumes every post-first bzip2 residual disappears and does not establish that a persistent worker can safely realize the saving.`,
		"",
		`- Multi-candidate ledgers: ${warm.multiCandidateLedgerCount}/${warm.ledgerCount}.`,
		`- Post-first candidates: ${warm.postFirstCandidateCount}.`,
		`- Median post-first bzip2 residual: ${warm.medianPostFirstBzip2ResidualMs.toFixed(warmRules.postFirstMedianPrecisionDecimals)} ms.`,
		`- Median per-multi-ledger optimistic total saving: ${warm.medianTrajectoryOptimisticTotalSavingMs.toFixed(warmRules.trajectoryTotalPrecisionDecimals)} ms.`,
		`- Median per-multi-ledger optimistic fraction: ${warm.medianTrajectoryOptimisticFraction.toFixed(warmRules.trajectoryFractionPrecisionDecimals)} of observed critical wall.`,
		`- Startup accounting: the first measurement contributes no modeled saving but remains in the denominator \`${warmRules.trajectoryObservedCriticalTotalMs}\`.`,
		"",
		"| Ledger | Candidates | Post-first | Observed critical total ms | Optimistic total saving ms | Optimistic fraction |",
		"|---|---:|---:|---:|---:|---:|",
		...warm.trajectories.map(
			(trajectory) =>
				`| ${trajectory.ledgerPath} | ${trajectory.candidateCount} | ${trajectory.postFirstCandidateCount} | ${trajectory.observedCriticalTotalMs.toFixed(warmRules.trajectoryTotalPrecisionDecimals)} | ${trajectory.optimisticTotalSavingMs.toFixed(warmRules.trajectoryTotalPrecisionDecimals)} | ${trajectory.optimisticFractionOfObservedCriticalTotal.toFixed(warmRules.trajectoryFractionPrecisionDecimals)} |`,
		),
		"",
		"## Method",
		"",
		`- Recorded residual: \`${analysis.rules.formulas.recordedResidualMs}\`; it must equal \`${analysis.rules.formulas.residualMs}\` at the frozen precision.`,
		`- Candidate critical path: \`${analysis.rules.formulas.criticalMs}\`.`,
		`- Residual delta: \`${analysis.rules.formulas.residualDeltaMs}\`.`,
		`- Optimistic saving: \`${analysis.rules.formulas.optimisticFusionSavingMs}\`.`,
		`- Median: ${analysis.rules.formulas.median}; summaries use ${analysis.rules.formulas.summaryPrecisionDecimals} decimals with ${analysis.rules.formulas.summaryRounding} rounding.`,
		"- Every source ledger passed strict canonical hash-chain verification. Reused measurements, provenance or hardware drift, task-set drift, rejected tasks, failed verifiers, and non-finite timing fields are fatal.",
		"",
		"## Input ledgers",
		"",
		"| Ledger | Events | Measurements | SHA-256 |",
		"|---|---:|---:|---|",
		...analysis.inputLedgers.map(
			(ledger) => `| ${ledger.path} | ${ledger.eventCount} | ${ledger.measurementCount} | \`${ledger.sha256}\` |`,
		),
		"",
		"## Candidate rows",
		"",
		"| Job | Source | Critical ms | bzip2 critical | bzip2 evaluator ms | bzip2 residual ms | Residual delta ms | Optimistic saving ms |",
		"|---|---|---:|---|---:|---:|---:|---:|",
		...analysis.cohort.rows.map(
			(row) =>
				`| ${row.jobId} | ${row.sourceLedgerPaths.join("<br>")} | ${formatMs(row.criticalMs)} | ${row.bzip2IsCritical ? "yes" : "no"} | ${formatMs(row.tasks.bzip2.evaluatorMs)} | ${formatMs(row.tasks.bzip2.residualMs)} | ${formatMs(row.residualDeltaMs)} | ${formatMs(row.optimisticFusionSavingMs)} |`,
		),
		"",
		`Canonical config digest: \`${analysis.configCanonicalSha256}\`. Raw measurements: ${analysis.rawMeasurementCount}; deduplicated repeats: ${analysis.deduplicatedMeasurementCount}.`,
		"",
	];
	return lines.join("\n");
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, toJsonValue } from "../src/canonical-json.js";
import {
	analyzeCompilerGymLatency,
	COMPILER_GYM_LATENCY_ANALYSIS_ID,
	COMPILER_GYM_LATENCY_BENCHMARKS,
	COMPILER_GYM_LATENCY_EXPECTED_HARDWARE,
	COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE,
	COMPILER_GYM_LATENCY_FORMULAS,
	COMPILER_GYM_WARM_ALLOCATION_HEADROOM,
	type CompilerGymLatencyConfig,
	type ExpectedCompilerGymLatencySummary,
	type ExpectedCompilerGymWarmAllocationHeadroom,
	parseCompilerGymLatencyConfig,
} from "../src/compiler-gym-latency-analysis.js";

const BLOWFISH = COMPILER_GYM_LATENCY_BENCHMARKS[0];
const BZIP2 = COMPILER_GYM_LATENCY_BENCHMARKS[1];
const FROZEN_LEDGER_PATHS = [
	"cpu-canaries/control-v7-live-endpoint-2026-08-28-v1/evidence.jsonl",
	"cpu-pilots/M-2026-08-28-v2-pair2/evidence.jsonl",
	"cpu-pilots/M-sealed-2026-08-28-v7-pair1/evidence.jsonl",
	"cpu-pilots/R-2026-08-28-v2-smoke/evidence.jsonl",
	"cpu-pilots/W-2026-08-28-v2-width-a/evidence.jsonl",
	"cpu-pilots/W-2026-08-28-v2-width-b/evidence.jsonl",
	"cpu-pilots/control-2026-08-28-v2-pair2/evidence.jsonl",
	"cpu-pilots/control-M-sealed-2026-08-28-v7-pair1/evidence.jsonl",
	"feedback-projection-screen/concise/evaluation/evidence.jsonl",
	"feedback-projection-screen/full/evaluation/evidence.jsonl",
	"r-resurrection-qualification/2026-08-28-v1/evidence.jsonl",
	"stock-cpu-baseline/2026-08-28-v3-v2-sealed/evaluation/evidence.jsonl",
	"stock-interface-pair-screen/2026-08-28-block-v1/stock/evaluation/evidence.jsonl",
	"stock-interface-pair-screen/2026-08-28-block-v1/typed/evaluation/evidence.jsonl",
	"stock-interface-pair-screen/2026-08-28-block-v2/stock/evaluation/evidence.jsonl",
	"stock-interface-pair-screen/2026-08-28-block-v3/stock/evaluation/evidence.jsonl",
	"stock-interface-pair-screen/2026-08-28-block-v3/typed/evaluation/evidence.jsonl",
	"stock-interface-pair-screen/2026-08-28-block-v4/stock/evaluation/evidence.jsonl",
	"stock-interface-pair-screen/2026-08-28-block-v4/typed/evaluation/evidence.jsonl",
	"stock-interface-parity/2026-08-28-v1/evaluation/evidence.jsonl",
	"stock-interface-parity/2026-08-28-v2/evaluation/evidence.jsonl",
] as const;

function task(
	benchmarkId: string,
	wallMs: number,
	evaluatorMs: number,
	recordedResidualMs: number | null = Math.max(0, wallMs - evaluatorMs),
): Record<string, unknown> {
	const metrics: Record<string, unknown> = {
		schedulerAndEvaluatorWallMs: wallMs,
		evaluatorRuntimeMs: evaluatorMs,
	};
	if (recordedResidualMs !== null) metrics.queueAndTransportMs = recordedResidualMs;
	return {
		benchmarkId,
		status: "accepted",
		metrics,
		verifier: { passed: true },
	};
}

function measurement(input: {
	jobId: string;
	manifestCharacter: string;
	blowfishWallMs: number;
	blowfishEvaluatorMs: number;
	bzip2WallMs: number;
	bzip2EvaluatorMs: number;
	bzip2RecordedResidualMs?: number | null;
}): Record<string, unknown> {
	return {
		jobId: input.jobId,
		manifestDigest: input.manifestCharacter.repeat(64),
		measuredAt: "2026-08-28T00:00:00.000Z",
		verifierEpoch: "compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2",
		hardware: { ...COMPILER_GYM_LATENCY_EXPECTED_HARDWARE },
		provenance: { ...COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE },
		tasks: [
			task(BLOWFISH, input.blowfishWallMs, input.blowfishEvaluatorMs),
			task(
				BZIP2,
				input.bzip2WallMs,
				input.bzip2EvaluatorMs,
				input.bzip2RecordedResidualMs === undefined
					? Math.max(0, input.bzip2WallMs - input.bzip2EvaluatorMs)
					: input.bzip2RecordedResidualMs,
			),
		],
	};
}

function ledgerContents(payloads: readonly Record<string, unknown>[]): string {
	let previousHash: string | null = null;
	const lines = payloads.map((payload, sequence) => {
		const body = {
			schemaVersion: 1 as const,
			sequence,
			recordedAt: `2026-08-28T00:00:${sequence.toString().padStart(2, "0")}.000Z`,
			kind: "measurement" as const,
			previousHash,
			payload: toJsonValue(payload),
		};
		const event = { ...body, hash: sha256Json(body) };
		previousHash = event.hash;
		return canonicalJson(toJsonValue(event));
	});
	return `${lines.join("\n")}\n`;
}

function config(
	ledgerPaths: readonly string[],
	expected: ExpectedCompilerGymLatencySummary,
	sensitivityLedgerPaths = ledgerPaths,
	warmExpected: ExpectedCompilerGymWarmAllocationHeadroom = SYNTHETIC_WARM_EXPECTED,
): CompilerGymLatencyConfig {
	return {
		schemaVersion: 1,
		analysisId: COMPILER_GYM_LATENCY_ANALYSIS_ID,
		ledgerRoot: ".autoresearch",
		outputDirectory: ".autoresearch/compiler-gym-latency-audit",
		ledgerPaths,
		sensitivityLedgerPaths,
		inclusion: {
			verifierEpoch: "compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2",
			benchmarkIds: COMPILER_GYM_LATENCY_BENCHMARKS,
			requireNoReuse: true,
			requireAcceptedStatus: true,
			requireVerifierPassed: true,
			requireFiniteTimings: true,
			requireRecordedResidualMatchesFormula: true,
		},
		deduplication: {
			key: "jobId",
			identicalDuplicate: "deduplicate",
			conflictingDuplicate: "error",
		},
		hardware: { ...COMPILER_GYM_LATENCY_EXPECTED_HARDWARE },
		provenance: { ...COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE },
		formulas: { ...COMPILER_GYM_LATENCY_FORMULAS },
		warmAllocationHeadroom: { ...COMPILER_GYM_WARM_ALLOCATION_HEADROOM },
		expectations: { cohort: expected, sensitivity: expected, warmAllocationHeadroom: warmExpected },
	};
}

const FIRST = measurement({
	jobId: "job_first",
	manifestCharacter: "a",
	blowfishWallMs: 100,
	blowfishEvaluatorMs: 90,
	bzip2WallMs: 150,
	bzip2EvaluatorMs: 130,
});

const SECOND = measurement({
	jobId: "job_second",
	manifestCharacter: "b",
	blowfishWallMs: 120,
	blowfishEvaluatorMs: 100,
	bzip2WallMs: 160,
	bzip2EvaluatorMs: 135.999,
});

const SYNTHETIC_WARM_EXPECTED: ExpectedCompilerGymWarmAllocationHeadroom = {
	multiCandidateLedgerCount: 1,
	postFirstCandidateCount: 1,
	medianPostFirstBzip2ResidualMs: 24.001,
	medianTrajectoryOptimisticTotalSavingMs: 24.001,
	medianTrajectoryOptimisticFraction: 0.077423,
};

const ONE_ROW_EXPECTED: ExpectedCompilerGymLatencySummary = {
	rowCount: 1,
	bzip2CriticalCount: 1,
	medianCriticalMs: 150,
	medianBzip2EvaluatorMs: 130,
	medianBzip2ResidualMs: 20,
	medianResidualDeltaMs: 10,
	medianOptimisticFusionSavingMs: 10,
};

describe("CompilerGym allocation-latency analysis", () => {
	it("freezes the exact 21-ledger manifest and supplied campaign expectations", async () => {
		const path = fileURLToPath(new URL("../compiler-gym-latency-v1.analysis.json", import.meta.url));
		const parsed = parseCompilerGymLatencyConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
		assert.deepEqual(parsed.ledgerPaths, FROZEN_LEDGER_PATHS);
		assert.deepEqual(parsed.sensitivityLedgerPaths, [
			"feedback-projection-screen/full/evaluation/evidence.jsonl",
			"feedback-projection-screen/concise/evaluation/evidence.jsonl",
		]);
		assert.deepEqual(parsed.expectations.cohort, {
			rowCount: 69,
			bzip2CriticalCount: 69,
			medianCriticalMs: 21690,
			medianBzip2EvaluatorMs: 14765.021,
			medianBzip2ResidualMs: 6501.816,
			medianResidualDeltaMs: 0.731,
			medianOptimisticFusionSavingMs: 0.731,
		});
		assert.equal(parsed.expectations.sensitivity.rowCount, 8);
		assert.equal(parsed.expectations.sensitivity.medianOptimisticFusionSavingMs, 2138.231);
		assert.deepEqual(parsed.expectations.warmAllocationHeadroom, {
			multiCandidateLedgerCount: 18,
			postFirstCandidateCount: 48,
			medianPostFirstBzip2ResidualMs: 8707.9255,
			medianTrajectoryOptimisticTotalSavingMs: 20297.718,
			medianTrajectoryOptimisticFraction: 0.248568,
		});
	});

	it("reconstructs Q, critical latency, optimistic saving, and half-away even medians", () => {
		const expected: ExpectedCompilerGymLatencySummary = {
			rowCount: 2,
			bzip2CriticalCount: 2,
			medianCriticalMs: 155,
			medianBzip2EvaluatorMs: 133,
			medianBzip2ResidualMs: 22.001,
			medianResidualDeltaMs: 7.001,
			medianOptimisticFusionSavingMs: 7.001,
		};
		const analysis = analyzeCompilerGymLatency(config(["cohort/evidence.jsonl"], expected), [
			{ path: "cohort/evidence.jsonl", contents: ledgerContents([FIRST, SECOND]) },
		]);
		assert.deepEqual(analysis.cohort.summary, {
			...expected,
			bzip2CriticalFraction: 1,
			medianBlowfishResidualMs: 15,
		});
		assert.deepEqual(
			analysis.cohort.rows.map((row) => [row.tasks.bzip2.residualMs, row.residualDeltaMs]),
			[
				[20, 10],
				[24.001, 4.001],
			],
		);
		assert.deepEqual(
			{
				multiCandidateLedgerCount: analysis.warmAllocationHeadroom.multiCandidateLedgerCount,
				postFirstCandidateCount: analysis.warmAllocationHeadroom.postFirstCandidateCount,
				medianPostFirstBzip2ResidualMs: analysis.warmAllocationHeadroom.medianPostFirstBzip2ResidualMs,
				medianTrajectoryOptimisticTotalSavingMs:
					analysis.warmAllocationHeadroom.medianTrajectoryOptimisticTotalSavingMs,
				medianTrajectoryOptimisticFraction: analysis.warmAllocationHeadroom.medianTrajectoryOptimisticFraction,
			},
			SYNTHETIC_WARM_EXPECTED,
		);
	});

	it("deduplicates byte-identical job payloads and rejects conflicting duplicates", () => {
		const paths = ["a/evidence.jsonl", "b/evidence.jsonl"];
		const expected: ExpectedCompilerGymLatencySummary = {
			rowCount: 2,
			bzip2CriticalCount: 2,
			medianCriticalMs: 155,
			medianBzip2EvaluatorMs: 133,
			medianBzip2ResidualMs: 22.001,
			medianResidualDeltaMs: 7.001,
			medianOptimisticFusionSavingMs: 7.001,
		};
		const analysis = analyzeCompilerGymLatency(config(paths, expected), [
			{ path: paths[0], contents: ledgerContents([FIRST, SECOND]) },
			{ path: paths[1], contents: ledgerContents([FIRST]) },
		]);
		assert.equal(analysis.rawMeasurementCount, 3);
		assert.equal(analysis.deduplicatedMeasurementCount, 1);
		assert.deepEqual(analysis.cohort.rows[0].sourceLedgerPaths, paths);

		const conflict = measurement({
			jobId: "job_first",
			manifestCharacter: "a",
			blowfishWallMs: 100,
			blowfishEvaluatorMs: 90,
			bzip2WallMs: 151,
			bzip2EvaluatorMs: 130,
		});
		assert.throws(
			() =>
				analyzeCompilerGymLatency(config(paths, expected), [
					{ path: paths[0], contents: ledgerContents([FIRST, SECOND]) },
					{ path: paths[1], contents: ledgerContents([conflict]) },
				]),
			/Conflicting duplicate jobId job_first/,
		);
	});

	it("requires authoritative finite Q and rejects formula mismatches", () => {
		const analysisConfig = config(["cohort/evidence.jsonl"], ONE_ROW_EXPECTED);
		const base = {
			jobId: "job_q",
			manifestCharacter: "c",
			blowfishWallMs: 100,
			blowfishEvaluatorMs: 90,
			bzip2WallMs: 150,
			bzip2EvaluatorMs: 130,
		};
		assert.throws(
			() =>
				analyzeCompilerGymLatency(analysisConfig, [
					{
						path: "cohort/evidence.jsonl",
						contents: ledgerContents([measurement({ ...base, bzip2RecordedResidualMs: null })]),
					},
				]),
			/queueAndTransportMs must be a finite number/,
		);
		assert.throws(
			() =>
				analyzeCompilerGymLatency(analysisConfig, [
					{
						path: "cohort/evidence.jsonl",
						contents: ledgerContents([measurement({ ...base, bzip2RecordedResidualMs: 20.001 })]),
					},
				]),
			/queueAndTransportMs mismatch: expected=20 received=20.001/,
		);
	});

	it("fails closed on non-strict ledgers, reused timing, and hardware or provenance drift", () => {
		const analysisConfig = config(["cohort/evidence.jsonl"], ONE_ROW_EXPECTED);
		const validContents = ledgerContents([FIRST]);
		assert.throws(
			() =>
				analyzeCompilerGymLatency(analysisConfig, [
					{ path: "cohort/evidence.jsonl", contents: validContents.trimEnd() },
				]),
			/Strict ledger must end with one newline/,
		);
		assert.throws(
			() =>
				analyzeCompilerGymLatency(analysisConfig, [
					{
						path: "cohort/evidence.jsonl",
						contents: ledgerContents([{ ...FIRST, reuse: { sourceJobId: "job_source" } }]),
					},
				]),
			/requires fresh timing/,
		);
		assert.throws(
			() =>
				analyzeCompilerGymLatency(analysisConfig, [
					{
						path: "cohort/evidence.jsonl",
						contents: ledgerContents([
							{ ...FIRST, hardware: { ...COMPILER_GYM_LATENCY_EXPECTED_HARDWARE, cpuConstraint: "other" } },
						]),
					},
				]),
			/hardware drift/,
		);
		assert.throws(
			() =>
				analyzeCompilerGymLatency(analysisConfig, [
					{
						path: "cohort/evidence.jsonl",
						contents: ledgerContents([
							{
								...FIRST,
								provenance: { ...COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE, llvm: "drift" },
							},
						]),
					},
				]),
			/provenance drift/,
		);
	});
});

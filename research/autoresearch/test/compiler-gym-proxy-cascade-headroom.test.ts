import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	analyzeCompilerGymProxyCascadeHeadroom,
	type CompilerGymProxyCascadeCandidate,
	loadCompilerGymProxyCascadeSources,
	proxyCascadeParetoFrontier,
	selectProxyCascadeCandidates,
	selectProxyCascadeQualificationTrajectory,
} from "../src/compiler-gym-proxy-cascade-headroom.js";

function candidate(ordinal: number, blowfishIr: number, bzip2Ir: number): CompilerGymProxyCascadeCandidate {
	return {
		ordinal,
		jobId: `job_${ordinal}`,
		manifestDigest: `${ordinal}`.padStart(64, "0"),
		candidateDigest: `${ordinal + 10}`.padStart(64, "0"),
		candidateByteLength: 10 + ordinal,
		candidateActionCount: 1 + ordinal,
		blowfishIr,
		bzip2Ir,
		blowfishEvaluatorMs: 3_000,
		bzip2EvaluatorMs: 15_000,
		blowfishWallMs: 5_000,
		bzip2WallMs: 18_000,
	};
}

const sourcesPromise = loadCompilerGymProxyCascadeSources();

describe("CompilerGym proxy-cascade retrospective headroom", () => {
	it("retains every Pareto point across the exact 13 agent trajectories and passes only the model-free gate", async () => {
		const result = analyzeCompilerGymProxyCascadeHeadroom(await sourcesPromise);
		assert.equal(result.trajectories.length, 13);
		assert.deepEqual(result.aggregate, {
			trajectoryCount: 13,
			allParetoFrontiersRetained: true,
			skippedBzip2Evaluations: 18,
			fullTaskAllocations: 104,
			cascadeTaskAllocations: 86,
			taskAllocationReductionFraction: 0.173077,
			fullEvaluatorMs: 947_686.128,
			cascadeEvaluatorMs: 677_427.105,
			evaluatorTimeSavedMs: 270_259.023,
			evaluatorTimeSavingFraction: 0.285178,
			observedCoRunCriticalWallMs: 1_408_225,
			sequentialStagedWallProxyMs: 1_728_882,
			optimisticFanoutWallProxyMs: 1_195_927,
			sequentialStagedVsObservedFraction: 0.227703,
			optimisticFanoutSavingFraction: 0.150756,
		});
		assert.deepEqual(result.gates, {
			exactThirteenAgentTrajectories: true,
			allThirteenParetoFrontiersRetained: true,
			evaluatorTimeSavingAtLeast25Percent: true,
		});
		assert.equal(result.eligibleForModelFreeSystemsQualification, true);
		assert.equal(
			result.modelFreeQualificationCandidateSet.selectedLedgerPath,
			"stock-interface-pair-screen/2026-08-28-block-v1/stock/evaluation/evidence.jsonl",
		);
		assert.deepEqual(result.modelFreeQualificationCandidateSet.historicalSelectedOrdinals, [2, 3]);
		assert.deepEqual(
			result.modelFreeQualificationCandidateSet.candidates.map((item) => item.historicalBlowfishIr),
			[2091, 1970, 1958, 1980],
		);
		assert.deepEqual(result.authorizations, {
			modelFreeSystemsQualification: true,
			feedbackLatencyImprovement: false,
			provider: false,
			paid: false,
			harnessTreatment: false,
			gpu: false,
			nanogpt: false,
			defaultPromotion: false,
		});
	});

	it("reports the scripted four-candidate qualification as an explicit all-cohort sensitivity", async () => {
		const result = analyzeCompilerGymProxyCascadeHeadroom(await sourcesPromise);
		assert.equal(
			result.trajectories.some(
				(trajectory) => trajectory.ledgerPath === "r-resurrection-qualification/2026-08-28-v1/evidence.jsonl",
			),
			false,
		);
		assert.equal(
			result.sensitivityIncludingScriptedQualification.trajectories.filter(
				(trajectory) => trajectory.ledgerPath === "r-resurrection-qualification/2026-08-28-v1/evidence.jsonl",
			).length,
			1,
		);
		assert.equal(result.sensitivityIncludingScriptedQualification.trajectories.length, 14);
		assert.deepEqual(result.sensitivityIncludingScriptedQualification.aggregate, {
			trajectoryCount: 14,
			allParetoFrontiersRetained: true,
			skippedBzip2Evaluations: 18,
			fullTaskAllocations: 112,
			cascadeTaskAllocations: 94,
			taskAllocationReductionFraction: 0.160714,
			fullEvaluatorMs: 1_021_155.451,
			cascadeEvaluatorMs: 750_896.428,
			evaluatorTimeSavedMs: 270_259.023,
			evaluatorTimeSavingFraction: 0.26466,
			observedCoRunCriticalWallMs: 1_473_330,
			sequentialStagedWallProxyMs: 1_832_443,
			optimisticFanoutWallProxyMs: 1_251_170,
			sequentialStagedVsObservedFraction: 0.243742,
			optimisticFanoutSavingFraction: 0.150788,
		});
	});

	it("selects the two lowest distinct proxy tiers and retains every tie without reading bzip2", () => {
		const candidates = [
			candidate(1, 20, 1),
			candidate(2, 10, 1_000),
			candidate(3, 15, 2_000),
			candidate(4, 10, 9_000),
		];
		assert.deepEqual(
			selectProxyCascadeCandidates(candidates).map((item) => item.ordinal),
			[2, 3, 4],
		);
		const changedDeferredTask = candidates.map((item) => ({ ...item, bzip2Ir: 999_999 - item.bzip2Ir }));
		assert.deepEqual(
			selectProxyCascadeCandidates(changedDeferredTask).map((item) => item.ordinal),
			[2, 3, 4],
		);
		const changedEveryForbiddenInput = candidates.map((item, index) => ({
			...item,
			jobId: `changed_job_${index}`,
			manifestDigest: `${index + 20}`.padStart(64, "0"),
			candidateDigest: `${index + 30}`.padStart(64, "0"),
			candidateByteLength: 1_000 + index,
			candidateActionCount: 2_000 + index,
			bzip2Ir: 100_000 - index,
			blowfishEvaluatorMs: 200_000 - index,
			bzip2EvaluatorMs: 300_000 - index,
			blowfishWallMs: 400_000 - index,
			bzip2WallMs: 500_000 - index,
		}));
		assert.deepEqual(
			selectProxyCascadeCandidates(changedEveryForbiddenInput).map((item) => item.ordinal),
			[2, 3, 4],
		);
	});

	it("computes the complete strict two-task Pareto frontier", () => {
		const candidates = [candidate(1, 10, 100), candidate(2, 11, 90), candidate(3, 12, 110), candidate(4, 10, 100)];
		assert.deepEqual(
			proxyCascadeParetoFrontier(candidates).map((item) => item.ordinal),
			[1, 2, 4],
		);
	});

	it("selects the qualification trajectory without deferred-task, timing, manifest, job, or frontier fields", async () => {
		const result = analyzeCompilerGymProxyCascadeHeadroom(await sourcesPromise);
		const baseline = selectProxyCascadeQualificationTrajectory(result.trajectories);
		const mutated = structuredClone(result.trajectories);
		for (const trajectory of mutated) {
			trajectory.paretoFrontierOrdinals = [99];
			trajectory.paretoFrontierJobIds = ["changed_frontier"];
			trajectory.paretoFrontierRetained = false;
			for (const [index, item] of trajectory.candidates.entries()) {
				item.jobId = `changed_job_${index}`;
				item.manifestDigest = `${index + 40}`.padStart(64, "0");
				item.candidateByteLength = 1_000 + index;
				item.candidateActionCount = 2_000 + index;
				item.bzip2Ir = 900_000 - index;
				item.blowfishEvaluatorMs = 800_000 - index;
				item.bzip2EvaluatorMs = 700_000 - index;
				item.blowfishWallMs = 600_000 - index;
				item.bzip2WallMs = 500_000 - index;
			}
		}
		const afterMutation = selectProxyCascadeQualificationTrajectory(mutated);
		assert.equal(afterMutation.selected.ledgerPath, baseline.selected.ledgerPath);
		assert.deepEqual(afterMutation.eligibleLedgerPaths, baseline.eligibleLedgerPaths);
	});

	it("fails closed on pinned ledger drift", async () => {
		const sources = await sourcesPromise;
		const ledgers = sources.ledgers.map((source) => ({ ...source }));
		ledgers[0] = { ...ledgers[0]!, contents: `${ledgers[0]!.contents} ` };
		assert.throws(
			() => analyzeCompilerGymProxyCascadeHeadroom({ ...sources, ledgers }),
			/pinned ledger hash drifted/,
		);
	});

	it("fails closed on candidate artifact content or mode drift", async () => {
		const sources = await sourcesPromise;
		const ledgers = sources.ledgers.map((source) => ({
			...source,
			artifacts: Object.fromEntries(
				Object.entries(source.artifacts).map(([digest, artifact]) => [digest, { ...artifact }]),
			),
		}));
		const target = ledgers.find(
			(source) => source.path === "stock-interface-pair-screen/2026-08-28-block-v1/stock/evaluation/evidence.jsonl",
		);
		assert.ok(target);
		const digest = Object.keys(target.artifacts)[0];
		assert.ok(digest);
		target.artifacts[digest] = { ...target.artifacts[digest]!, contents: `${target.artifacts[digest]!.contents} ` };
		assert.throws(
			() => analyzeCompilerGymProxyCascadeHeadroom({ ...sources, ledgers }),
			/candidate artifact hash drifted/,
		);
		target.artifacts[digest] = {
			...sources.ledgers.find((source) => source.path === target.path)!.artifacts[digest]!,
			mode: 0o644,
		};
		assert.throws(
			() => analyzeCompilerGymProxyCascadeHeadroom({ ...sources, ledgers }),
			/candidate artifact must be a regular mode-0600 file/,
		);
	});

	it("is byte-for-byte deterministic as typed JSON data", async () => {
		const sources = await sourcesPromise;
		assert.equal(
			JSON.stringify(analyzeCompilerGymProxyCascadeHeadroom(sources)),
			JSON.stringify(analyzeCompilerGymProxyCascadeHeadroom(sources)),
		);
	});
});

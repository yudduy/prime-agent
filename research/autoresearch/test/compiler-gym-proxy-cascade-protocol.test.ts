import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
	buildCompilerGymProxyCascadePhasePlan,
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
	COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY,
	COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES,
	type CompilerGymProxyCascadeReplayLedgerSource,
	type CompilerGymProxyCascadeTaskPoint,
	compilerGymProxyCascadeParetoFrontierOrdinals,
	projectCompilerGymProxyCascadeReplay,
	replayCompilerGymProxyCascade,
	selectCompilerGymProxyCascadeOrdinals,
	selectCompilerGymProxyCascadeTrajectory,
} from "../src/compiler-gym-proxy-cascade-protocol.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

async function frozenSources(): Promise<CompilerGymProxyCascadeReplayLedgerSource[]> {
	return Promise.all(
		COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES.map(async (source) => ({
			path: source.path,
			contents: await readFile(resolve(REPO_ROOT, ".autoresearch", source.path), "utf8"),
		})),
	);
}

function point(
	benchmarkId: typeof COMPILER_GYM_PROXY_CASCADE_BLOWFISH | typeof COMPILER_GYM_PROXY_CASCADE_BZIP2,
	irInstructionCount: number,
): CompilerGymProxyCascadeTaskPoint {
	return { benchmarkId, irInstructionCount, objectTextSizeBytes: irInstructionCount * 10, evaluatorRuntimeMicros: 1 };
}

describe("CompilerGym proxy-cascade protocol", () => {
	it("strictly replays the frozen 13 natural trajectories and preserves every historical frontier", async () => {
		const replay = replayCompilerGymProxyCascade(await frozenSources());
		assert.equal(replay.gate.passed, true);
		assert.equal(replay.gate.allTrajectoryFrontiersRetained, true);
		assert.equal(replay.gate.savingThresholdPassed, true);
		assert.deepEqual(replay.summary, {
			trajectoryCount: 13,
			candidateCount: 52,
			uniqueCandidateDigestCount: 51,
			selectedCandidateCount: 34,
			omittedCandidateCount: 18,
			frontierCandidateCount: 16,
			retainedFrontierCandidateCount: 16,
			twoCandidateTrajectoryCount: 5,
			tieExpandedTrajectoryCount: 8,
			totalEvaluatorRuntimeMicros: "947686128",
			retainedEvaluatorRuntimeMicros: "677427105",
			omittedBzip2EvaluatorRuntimeMicros: "270259023",
			savingFraction: { numerator: "270259023", denominator: "947686128" },
		});
		assert.equal(replay.classification, "retrospective-development-only-not-a-causal-counterfactual");
		assert.equal(replay.gate.claimLimits.prospectivePolicyEvidence, false);
		assert.equal(replay.gate.claimLimits.causalTimingEvidence, false);
		assert.equal(replay.gate.claimLimits.independentTrajectoryAssumption, false);
	});

	it("retains every candidate in the two best distinct proxy tiers, including all boundary ties", () => {
		assert.deepEqual(
			selectCompilerGymProxyCascadeOrdinals([
				{ ordinal: 1, blowfishIrInstructionCount: 10 },
				{ ordinal: 2, blowfishIrInstructionCount: 8 },
				{ ordinal: 3, blowfishIrInstructionCount: 8 },
				{ ordinal: 4, blowfishIrInstructionCount: 7 },
			]),
			{ proxyTiersAscending: [7, 8, 10], selectedOrdinals: [2, 3, 4], omittedOrdinals: [1] },
		);
		assert.deepEqual(
			selectCompilerGymProxyCascadeOrdinals([
				{ ordinal: 1, blowfishIrInstructionCount: 8 },
				{ ordinal: 2, blowfishIrInstructionCount: 8 },
				{ ordinal: 3, blowfishIrInstructionCount: 8 },
				{ ordinal: 4, blowfishIrInstructionCount: 8 },
			]),
			{ proxyTiersAscending: [8], selectedOrdinals: [1, 2, 3, 4], omittedOrdinals: [] },
		);
		assert.throws(
			() =>
				selectCompilerGymProxyCascadeOrdinals([
					{ ordinal: 1, blowfishIrInstructionCount: 8 },
					{ ordinal: 1, blowfishIrInstructionCount: 7 },
				]),
			/invalid/,
		);
		const cleanLiveInputs = [
			{ ordinal: 1, blowfishIrInstructionCount: 10 },
			{ ordinal: 2, blowfishIrInstructionCount: 8 },
			{ ordinal: 3, blowfishIrInstructionCount: 7 },
			{ ordinal: 4, blowfishIrInstructionCount: 9 },
		];
		const forbiddenFieldContamination = cleanLiveInputs.map((candidate) => ({
			...candidate,
			candidateDigest: "forbidden",
			candidateByteLength: 1,
			candidateActionCount: 1,
			freshBlowfishObjectTextSizeBytes: 1,
			freshBzip2Ir: 1,
			evaluatorRuntime: 1,
			slurmJobId: "1",
			frontier: true,
			champion: true,
		}));
		assert.deepEqual(
			selectCompilerGymProxyCascadeOrdinals(forbiddenFieldContamination),
			selectCompilerGymProxyCascadeOrdinals(cleanLiveInputs),
		);
	});

	it("uses weak no-worse plus one strict improvement for the complete raw-IR frontier", () => {
		const candidates = [
			{
				ordinal: 1,
				blowfish: point(COMPILER_GYM_PROXY_CASCADE_BLOWFISH, 10),
				bzip2: point(COMPILER_GYM_PROXY_CASCADE_BZIP2, 10),
			},
			{
				ordinal: 2,
				blowfish: point(COMPILER_GYM_PROXY_CASCADE_BLOWFISH, 9),
				bzip2: point(COMPILER_GYM_PROXY_CASCADE_BZIP2, 10),
			},
			{
				ordinal: 3,
				blowfish: point(COMPILER_GYM_PROXY_CASCADE_BLOWFISH, 8),
				bzip2: point(COMPILER_GYM_PROXY_CASCADE_BZIP2, 12),
			},
			{
				ordinal: 4,
				blowfish: point(COMPILER_GYM_PROXY_CASCADE_BLOWFISH, 9),
				bzip2: point(COMPILER_GYM_PROXY_CASCADE_BZIP2, 9),
			},
		];
		assert.deepEqual(compilerGymProxyCascadeParetoFrontierOrdinals(candidates), [3, 4]);
	});

	it("selects the ASCII-first untied whole trajectory through a projection with no leaked fields", async () => {
		const replay = replayCompilerGymProxyCascade(await frozenSources());
		const projections = projectCompilerGymProxyCascadeReplay(replay);
		for (const projection of projections) {
			assert.deepEqual(Object.keys(projection).sort(), [
				"candidates",
				"distinctProxyScores",
				"eligibleForUntiedQualification",
				"path",
				"uniqueCandidateDigests",
			]);
			for (const candidate of projection.candidates) {
				assert.deepEqual(Object.keys(candidate).sort(), [
					"blowfishIrInstructionCount",
					"candidateSha256",
					"ordinal",
					"proxyAccepted",
				]);
			}
		}
		const selected = selectCompilerGymProxyCascadeTrajectory(replay);
		assert.equal(selected.path, COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY.selectedTrajectoryPath);
		assert.equal(selected.ledgerSha256, COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY.selectedTrajectoryLedgerSha256);
		assert.equal(
			selected.terminalEventHash,
			COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY.selectedTrajectoryTerminalEventHash,
		);
		assert.deepEqual(selected.selectedOrdinals, [2, 3]);
		assert.deepEqual(selected.omittedOrdinals, [1, 4]);
		const mutated = structuredClone(replay);
		for (const trajectory of mutated.trajectories) {
			trajectory.ledgerSha256 = "f".repeat(64);
			trajectory.terminalEventHash = "e".repeat(64);
			trajectory.model = "forbidden-model-mutation";
			trajectory.frontierOrdinals.reverse();
			trajectory.championOrdinal = trajectory.championOrdinal === 1 ? 4 : 1;
			for (const candidate of trajectory.candidates) {
				candidate.jobId = "forbidden-job-mutation";
				candidate.candidateByteLength += 10_000;
				candidate.measurementPayloadSha256 = "d".repeat(64);
				candidate.bzip2.irInstructionCount += 100_000;
				candidate.bzip2.objectTextSizeBytes += 100_000;
				candidate.bzip2.evaluatorRuntimeMicros += 100_000;
				candidate.blowfish.objectTextSizeBytes += 100_000;
				candidate.blowfish.evaluatorRuntimeMicros += 100_000;
			}
		}
		const mutatedSelected = selectCompilerGymProxyCascadeTrajectory(mutated);
		assert.equal(mutatedSelected.path, selected.path);
		assert.equal(mutatedSelected.restrictedProjectionSha256, selected.restrictedProjectionSha256);
	});

	it("freezes the exact four-plus-two-plus-two phase barrier plan", async () => {
		const selected = selectCompilerGymProxyCascadeTrajectory(replayCompilerGymProxyCascade(await frozenSources()));
		const plan = buildCompilerGymProxyCascadePhasePlan(selected);
		assert.equal(plan.allocations.length, 8);
		assert.deepEqual(
			plan.allocations.map((allocation) => [
				allocation.allocationOrdinal,
				allocation.phase,
				allocation.candidateOrdinal,
				allocation.benchmarkId,
				allocation.requiresRemoteLock,
			]),
			[
				[1, "proxy-blowfish", 1, COMPILER_GYM_PROXY_CASCADE_BLOWFISH, "global"],
				[2, "proxy-blowfish", 2, COMPILER_GYM_PROXY_CASCADE_BLOWFISH, "global"],
				[3, "proxy-blowfish", 3, COMPILER_GYM_PROXY_CASCADE_BLOWFISH, "global"],
				[4, "proxy-blowfish", 4, COMPILER_GYM_PROXY_CASCADE_BLOWFISH, "global"],
				[5, "selected-bzip2", 2, COMPILER_GYM_PROXY_CASCADE_BZIP2, "selection"],
				[6, "selected-bzip2", 3, COMPILER_GYM_PROXY_CASCADE_BZIP2, "selection"],
				[7, "omitted-bzip2-audit", 1, COMPILER_GYM_PROXY_CASCADE_BZIP2, "cascade"],
				[8, "omitted-bzip2-audit", 4, COMPILER_GYM_PROXY_CASCADE_BZIP2, "cascade"],
			],
		);
		assert.equal(plan.allocations[6]?.visibility, "audit-only-agent-inaccessible");
		assert.deepEqual(plan.phaseCounts, { proxyBlowfish: 4, selectedBzip2: 2, omittedBzip2Audit: 2, total: 8 });
	});

	it("fails closed on source omission, addition, or byte tampering", async () => {
		const sources = await frozenSources();
		assert.throws(() => replayCompilerGymProxyCascade(sources.slice(1)), /source mismatch/);
		assert.throws(
			() => replayCompilerGymProxyCascade([...sources, { path: "extra/evidence.jsonl", contents: "" }]),
			/source mismatch/,
		);
		const tampered = structuredClone(sources);
		tampered[0]!.contents = `${tampered[0]!.contents} `;
		assert.throws(() => replayCompilerGymProxyCascade(tampered), /SHA-256 drifted/);
	});
});

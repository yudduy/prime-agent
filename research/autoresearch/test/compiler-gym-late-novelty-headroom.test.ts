import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, sha256Json, toJsonValue } from "../src/canonical-json.js";
import {
	analyzeCompilerGymLateNoveltyHeadroom,
	type CompilerGymLateNoveltyLedgerSource,
	diceLcsSimilarity,
	loadCompilerGymLateNoveltySources,
	reconstructOrdinalFourTransition,
} from "../src/compiler-gym-late-novelty-headroom.js";

function cloneSource(source: CompilerGymLateNoveltyLedgerSource): CompilerGymLateNoveltyLedgerSource {
	return { path: source.path, contents: source.contents, artifacts: { ...source.artifacts } };
}

function rewriteLedger(
	source: CompilerGymLateNoveltyLedgerSource,
	mutate: (event: Record<string, unknown>, index: number) => void,
): CompilerGymLateNoveltyLedgerSource {
	const values = source.contents
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	let previousHash: string | null = null;
	const lines = values.map((value, index) => {
		mutate(value, index);
		const body = {
			schemaVersion: value.schemaVersion,
			sequence: value.sequence,
			recordedAt: value.recordedAt,
			kind: value.kind,
			previousHash,
			payload: value.payload,
		};
		const event = { ...body, hash: sha256Json(body) };
		previousHash = event.hash;
		return canonicalJson(toJsonValue(event));
	});
	return { ...cloneSource(source), contents: `${lines.join("\n")}\n` };
}

const sourcesPromise = loadCompilerGymLateNoveltySources();

describe("CompilerGym late structural-novelty headroom", () => {
	it("reconstructs the exact frozen cohort and passes only the faux-prompt eligibility gates", async () => {
		const result = analyzeCompilerGymLateNoveltyHeadroom(await sourcesPromise);
		assert.equal(result.verifiedTransitionCount, 14);
		assert.deepEqual(result.overall, {
			low: { total: 7, dominates: 5, improvesNeither: 0, tradeoff: 2 },
			high: { total: 7, dominates: 2, improvesNeither: 4, tradeoff: 1 },
		});
		assert.deepEqual(result.strata, {
			"stock-interface-pair-screen": {
				low: { total: 3, dominates: 2, improvesNeither: 0, tradeoff: 1 },
				high: { total: 4, dominates: 0, improvesNeither: 3, tradeoff: 1 },
			},
			"remaining-protocols": {
				low: { total: 4, dominates: 3, improvesNeither: 0, tradeoff: 1 },
				high: { total: 3, dominates: 2, improvesNeither: 1, tradeoff: 0 },
			},
		});
		assert.equal(result.gates.exactReconstruction14Of14, true);
		assert.equal(result.gates.exactSevenSevenSplit, true);
		assert.equal(result.gates.overallDominationGapAtLeast30Points, true);
		assert.equal(result.gates.stockInterfacePairGapStrictlyPositive, true);
		assert.equal(result.gates.remainingProtocolsGapStrictlyPositive, true);
		assert.equal(result.gates.promptDeltaBudgetBytes, 128);
		assert.equal(result.eligibleForFauxPromptPilot, true);
		assert.deepEqual(result.authorizations, {
			provider: false,
			paid: false,
			treatment: false,
			promotion: false,
			gpu: false,
		});
	});

	it("uses the exact Dice-LCS threshold and assigns S=0.80 to the high band", () => {
		assert.deepEqual(diceLcsSimilarity(["a", "b", "c"], ["a", "b"]), {
			lcsLength: 2,
			numerator: 4,
			denominator: 5,
			similarity: 0.8,
			band: "high",
		});
		assert.equal(diceLcsSimilarity(["a", "b", "c"], ["a", "d"]).band, "low");
	});

	it("fails closed on pinned ledger hash drift", async () => {
		const sources = await sourcesPromise;
		const ledgers = sources.ledgers.map(cloneSource);
		ledgers[0] = { ...ledgers[0], contents: `${ledgers[0]!.contents} ` };
		assert.throws(() => analyzeCompilerGymLateNoveltyHeadroom({ ...sources, ledgers }), /pinned ledger hash drifted/);
	});

	it("fails closed on candidate artifact drift", async () => {
		const sources = await sourcesPromise;
		const included = sources.ledgers.find((source) => source.path.includes("feedback-projection-screen/full"));
		assert.ok(included);
		const artifacts = { ...included.artifacts };
		for (const digest of Object.keys(artifacts)) artifacts[digest] = `${artifacts[digest]} `;
		assert.throws(
			() => reconstructOrdinalFourTransition({ ...included, artifacts }),
			/candidate artifact hash drifted/,
		);
	});

	it("fails closed on ordinal-4 parent drift", async () => {
		const sources = await sourcesPromise;
		const included = sources.ledgers.find((source) => source.path.includes("stock-interface-parity/2026-08-28-v1"));
		assert.ok(included);
		let proposalOrdinal = 0;
		const drifted = rewriteLedger(included, (event) => {
			if (event.kind !== "proposal") return;
			proposalOrdinal++;
			if (proposalOrdinal !== 4) return;
			const payload = event.payload as { proposal: { parentJobIds: string[] } };
			payload.proposal.parentJobIds[0] = "job_missing_parent";
		});
		assert.throws(
			() => reconstructOrdinalFourTransition(drifted),
			/first parent is not an earlier proposal in the same branch/,
		);
	});

	it("fails closed on malformed accepted-task metrics", async () => {
		const sources = await sourcesPromise;
		const included = sources.ledgers.find((source) => source.path.includes("stock-interface-parity/2026-08-28-v2"));
		assert.ok(included);
		let measurementOrdinal = 0;
		const drifted = rewriteLedger(included, (event) => {
			if (event.kind !== "measurement") return;
			measurementOrdinal++;
			if (measurementOrdinal !== 4) return;
			const payload = event.payload as { tasks: Array<{ metrics: { IrInstructionCount: number } }> };
			payload.tasks[0]!.metrics.IrInstructionCount = 1.5;
		});
		assert.throws(
			() => reconstructOrdinalFourTransition(drifted),
			/IrInstructionCount must be a nonnegative safe integer/,
		);
	});

	it("is byte-for-byte deterministic as typed JSON data", async () => {
		const sources = await sourcesPromise;
		const first = analyzeCompilerGymLateNoveltyHeadroom(sources);
		const second = analyzeCompilerGymLateNoveltyHeadroom(sources);
		assert.equal(JSON.stringify(first), JSON.stringify(second));
	});
});

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { checkConstruction, compareScores, improvesBaseline } from "./overlap.js";

const flat = checkConstruction([".5", ".5"]);
assert.deepEqual(flat, {
	valid: true,
	score: 0.5,
	scoreNumerator: "1",
	scoreDenominator: "2",
	maxShift: 0,
	bins: 2,
});
assert.deepEqual(checkConstruction(["1", "0"]), {
	valid: true,
	score: 1,
	scoreNumerator: "1",
	scoreDenominator: "1",
	maxShift: 1,
	bins: 2,
});
assert.equal(checkConstruction(["0", "1"]).maxShift, -1);
assert.equal(checkConstruction([".5", ".5", ".5"]).score, 0.5);

const values = [".9", ".4", ".2", ".5"];
const known = checkConstruction(values);
assert.deepEqual(known, {
	valid: true,
	score: 0.48,
	scoreNumerator: "12",
	scoreDenominator: "25",
	maxShift: 1,
	bins: 4,
});
assert.equal(compareScores(known, checkConstruction([...values].reverse())), 0);
assert.equal(checkConstruction([...values].reverse()).maxShift, -1);
assert.equal(compareScores(known, checkConstruction([".1", ".6", ".8", ".5"])), 0);
assert.equal(compareScores(known, checkConstruction(values.flatMap((value) => [value, value]))), 0);
assert.equal(checkConstruction(values.flatMap((value) => [value, value])).maxShift, 2);
assert.equal(compareScores(known, flat), 1);
assert.equal(compareScores(flat, known), -1);
assert.equal(compareScores(known, checkConstruction([])), 1);
assert.equal(compareScores(checkConstruction([]), known), -1);
assert.equal(compareScores(checkConstruction([]), checkConstruction(null)), 0);
assert.equal(improvesBaseline(known, flat, ".02"), true);
assert.equal(improvesBaseline(known, flat, ".0200000000000000000000000000000000000001"), false);
assert.equal(improvesBaseline(known, flat, "1e-9"), true);
assert.equal(improvesBaseline(flat, flat, "1e-9"), false);
assert.equal(improvesBaseline(checkConstruction([]), flat, "1e-9"), false);
assert.throws(() => improvesBaseline(known, flat, "0"));
assert.throws(() => improvesBaseline(known, flat, "-1e-9"));

for (const invalid of [
	null,
	{},
	[],
	["1"],
	Array(4097).fill(".5"),
	[".4", ".5"],
	["0", "0"],
	["1", "1"],
	["-1e-60", "1"],
	["1.000000000000000000000000000000000000000000000000000000000001", "0"],
	[".500000000000000000000000000000000000000000000000000000000001", ".5"],
	["0e61", "1"],
	["1e-61", "1"],
	["0e999999999999999999999", "1"],
	["0".repeat(81), "1"],
	["0.5", true],
	[0.5, 0.5],
	["NaN", "1"],
	[Infinity, "0"],
	["1/2", ".5"],
	[" .5", ".5"],
])
	assert.equal(checkConstruction(invalid).valid, false, JSON.stringify(invalid));
assert.equal(compareScores(checkConstruction(["5e-1", "+.50"]), flat), 0);
assert.equal(checkConstruction(["-0", "1e0"]).valid, true);

// Independent integration of pairwise interval intersections at quarter-bin shifts.
// Lengths are integer quarter-bins, values integer tenths; no floating tolerance enters this check.
const tenths = [9n, 4n, 2n, 5n];
let largestQuarterOverlap = 0n;
for (let quarterShift = -16; quarterShift <= 16; quarterShift++) {
	let directOverlap = 0n;
	for (let first = 0; first < 4; first++) {
		for (let second = 0; second < 4; second++) {
			const length = Math.max(
				0,
				Math.min(4 * first + 4, 4 * second + 4 - quarterShift) - Math.max(4 * first, 4 * second - quarterShift),
			);
			directOverlap += BigInt(length) * tenths[first] * (10n - tenths[second]);
		}
	}
	if (directOverlap > largestQuarterOverlap) largestQuarterOverlap = directOverlap;
}
// Each quarter-bin has physical length 1/8, and each product's denominator is 100.
assert.equal(largestQuarterOverlap * 25n, 12n * 800n);

const tinyAbove = `.5${"0".repeat(58)}1`;
const tinyBelow = `.4${"9".repeat(59)}`;
assert.equal(checkConstruction([tinyAbove, tinyBelow]).valid, true);
const started = performance.now();
const large = checkConstruction(Array.from({ length: 4096 }, (_, index) => (index % 2 === 0 ? tinyAbove : tinyBelow)));
const elapsedMs = performance.now() - started;
assert.equal(large.valid, true);
assert(elapsedMs < 10_000, `Maximum-size, 60-place check exceeded 10 seconds: ${elapsedMs}`);
console.log(
	JSON.stringify({
		passed: true,
		maxBins: 4096,
		maxPlaces: 60,
		elapsedMs,
		largeScore: large.score,
	}),
);

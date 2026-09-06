import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { checkConstruction } from "./overlap.js";

if (!process.argv[2]) throw new Error("Provide the prepared baseline JSON path.");
const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
const started = performance.now();
const check = checkConstruction(baseline.values);
for (const field of ["valid", "bins", "maxShift", "scoreNumerator", "scoreDenominator"] as const) {
	assert.equal(check[field], baseline.check[field]);
}
assert(check.score !== null && Number.isFinite(check.score));
console.log(
	JSON.stringify({
		passed: true,
		elapsedMs: performance.now() - started,
		check,
	}),
);

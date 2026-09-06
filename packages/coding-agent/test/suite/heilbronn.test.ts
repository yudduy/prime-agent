import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { checkConstruction, compareScores, exceedsScore, type Point } from "../../examples/sdk/heilbronn.js";
import { createHarness } from "./harness.js";

// For (k/20, k²/200), a triple a < b < c has determinant (b-a)(c-a)(c-b)/4000.
const parabola: Point[] = [
	["0", "0"],
	[".05", ".005"],
	[".1", ".02"],
	[".15", ".045"],
	[".2", ".08"],
	[".25", ".125"],
	[".3", ".18"],
	[".35", ".245"],
	[".4", ".32"],
	[".45", ".405"],
	[".5", ".5"],
];

function withFirstPoint(point: unknown): unknown[] {
	return [point, ...parabola.slice(1)];
}

describe("exact Heilbronn construction checks", () => {
	it("matches an independently calculated normalized area and reduces the fraction", () => {
		expect(checkConstruction(parabola)).toEqual({
			valid: true,
			score: 0.0005,
			scoreNumerator: "1",
			scoreDenominator: "2000",
			minimumTriangle: [0, 1, 2],
		});
	});

	it("preserves scores under permutation and reflection", () => {
		const expected = checkConstruction(parabola);
		const permuted = checkConstruction([...parabola].reverse());
		const reflected = checkConstruction(parabola.map(([x, y]) => [y, x]));
		expect(compareScores(permuted, expected)).toBe(0);
		expect(compareScores(reflected, expected)).toBe(0);
		expect(reflected.minimumTriangle).toEqual(expected.minimumTriangle);
	});

	it("checks the final triple even when every earlier triangle has positive area", () => {
		const points: Point[] = [...parabola.slice(0, 10), [".5", ".49"]];
		expect(checkConstruction(points)).toMatchObject({
			valid: true,
			score: 0,
			minimumTriangle: [8, 9, 10],
		});
	});

	it("accepts exact boundaries and rejects violations lost by floating-point addition", () => {
		expect(checkConstruction(withFirstPoint(["0.1", "0.9"])).valid).toBe(true);
		expect(checkConstruction(withFirstPoint(["1", "0"])).valid).toBe(true);
		expect(checkConstruction(withFirstPoint(["0", "1"])).valid).toBe(true);
		expect(Number("0.500000000000000000000000000000000000000000000000000000000001") + 0.5).toBe(1);
		for (const point of [
			["0.500000000000000000000000000000000000000000000000000000000001", "0.5"],
			["-1e-60", "0"],
			["0", "-1e-60"],
			["1.000000000000000000000000000000000000000000000000000000000001", "0"],
		]) {
			expect(checkConstruction(withFirstPoint(point))).toMatchObject({ valid: false, score: null });
		}
	});

	it("treats repeated or collinear points as valid zero-area constructions", () => {
		const duplicate = checkConstruction(withFirstPoint(parabola[1]));
		const collinear = checkConstruction(Array.from({ length: 11 }, (_, index) => [index / 10, 0]));
		for (const result of [duplicate, collinear]) {
			expect(result).toMatchObject({ valid: true, score: 0, scoreNumerator: "0", scoreDenominator: "1" });
			expect(exceedsScore(result, "0")).toBe(false);
		}
	});

	it.each([null, {}, [], parabola.slice(1), [...parabola, [0, 0]], withFirstPoint([0]), withFirstPoint([0, 0, 0])])(
		"rejects malformed constructions: %j",
		(value) => expect(checkConstruction(value)).toMatchObject({ valid: false, score: null }),
	);

	it.each([true, false, null, undefined, NaN, Infinity, -Infinity, {}, [], "NaN", "Infinity", "1/2", " 0", "0x0"])(
		"rejects non-decimal coordinates: %s",
		(value) => expect(checkConstruction(withFirstPoint([value, 0]))).toMatchObject({ valid: false, score: null }),
	);

	it.each(["1e-61", "0e9999999999999999", `0.${"0".repeat(60)}1`, "0".repeat(81), "0e+61"])(
		"bounds decimal precision and parser work: %s",
		(value) => expect(checkConstruction(withFirstPoint([value, 0]))).toMatchObject({ valid: false, score: null }),
	);

	it("handles mixed decimal exponents and numbers without changing their exact decimal score", () => {
		const mixed: Point[] = parabola.map(([x, y]) => [Number(x), Number(y)]);
		mixed[1] = ["5e-2", "5E-3"];
		mixed[2] = ["+1e-1", "2e-2"];
		mixed[0] = ["-0", "0e60"];
		expect(compareScores(checkConstruction(mixed), checkConstruction(parabola))).toBe(0);
	});

	it("retains the maximum allowed coordinate precision in the exact score", () => {
		const first: Point[] = parabola.map(([x, y]) => [x, `${y}e-57`]);
		const second: Point[] = parabola.map(([x, y]) => [x, `${y}e-56`]);
		const smaller = checkConstruction(first);
		const larger = checkConstruction(second);
		expect(smaller).toMatchObject({
			valid: true,
			scoreNumerator: "1",
			scoreDenominator: `2${"0".repeat(60)}`,
		});
		expect(compareScores(smaller, larger)).toBe(-1);
		expect(compareScores(larger, smaller)).toBe(1);
	});

	it("distinguishes construction scores that round to the same display value", () => {
		const points: Point[] = [...parabola];
		points[1] = [".05", ".0050000000000000000000000000000000000001"];
		const original = checkConstruction(parabola);
		const changed = checkConstruction(points);
		expect(changed.score).toBe(original.score);
		expect(compareScores(changed, original)).toBe(-1);
		expect(compareScores(original, changed)).toBe(1);
	});

	it("does not round an apparent improvement into an exact threshold pass", () => {
		const result = checkConstruction(parabola);
		const below = "0.000499999999999999999999999999999999999999999999999999999999";
		const above = "0.000500000000000000000000000000000000000000000000000000000001";
		expect(Number(below)).toBe(result.score);
		expect(Number(above)).toBe(result.score);
		expect(exceedsScore(result, below)).toBe(true);
		expect(exceedsScore(result, "0.0005")).toBe(false);
		expect(exceedsScore(result, above)).toBe(false);
		expect(() => exceedsScore(result, "not a number")).toThrow();
	});

	it("ranks valid constructions above invalid ones", () => {
		const valid = checkConstruction(parabola);
		const invalid = checkConstruction([]);
		expect(compareScores(valid, invalid)).toBe(1);
		expect(compareScores(invalid, valid)).toBe(-1);
		expect(compareScores(invalid, invalid)).toBe(0);
		expect(exceedsScore(invalid, "0")).toBe(false);
	});

	it("keeps model claims separate from the score returned by the host", async () => {
		const harness = await createHarness({
			tools: [
				{
					name: "check_construction",
					label: "Check construction",
					description: "Check a construction exactly.",
					parameters: Type.Object({ points: Type.Array(Type.Array(Type.String())) }),
					async execute(_id, params) {
						if (!params || typeof params !== "object" || !("points" in params)) {
							throw new Error("Expected construction points.");
						}
						const result = checkConstruction(params.points);
						return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
					},
				},
			],
		});
		try {
			harness.setResponses([
				fauxAssistantMessage(
					[
						{ type: "text", text: "My construction scores 0.1." },
						fauxToolCall("check_construction", { points: parabola }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("The host score is 0.0005."),
			]);
			await harness.session.prompt("Check the claimed construction.");
			const receipt = harness.eventsOfType("tool_execution_end")[0];
			expect(receipt.result.details).toMatchObject({ valid: true, scoreNumerator: "1", scoreDenominator: "2000" });
		} finally {
			harness.cleanup();
		}
	});
});

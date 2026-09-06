export type Point = [number | string, number | string];

export interface ConstructionCheck {
	valid: boolean;
	score: number | null;
	scoreNumerator?: string;
	scoreDenominator?: string;
	minimumTriangle?: number[];
	error?: string;
}

interface Decimal {
	numerator: bigint;
	places: number;
}

function readDecimal(value: unknown): Decimal {
	if (
		(typeof value !== "string" && typeof value !== "number") ||
		(typeof value === "number" && !Number.isFinite(value))
	) {
		throw new Error("Coordinates must be finite decimal numbers or strings.");
	}
	const text = String(value);
	if (text.length > 80) throw new Error("A decimal may contain at most 80 characters.");
	const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
	if (!match) throw new Error("Invalid decimal representation.");
	const fraction = match[3] ?? match[4] ?? "";
	const exponent = Number(match[5] ?? 0);
	const places = fraction.length - exponent;
	if (fraction.length > 60 || Math.abs(exponent) > 60 || places > 60) {
		throw new Error("Decimals support at most 60 decimal places and an exponent from -60 to 60.");
	}
	let numerator = BigInt(`${match[1] === "-" ? "-" : ""}${match[2] ?? "0"}${fraction}`);
	if (places < 0) numerator *= 10n ** BigInt(-places);
	return { numerator, places: Math.max(0, places) };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	while (right !== 0n) [left, right] = [right, left % right];
	return left;
}

export function checkConstruction(value: unknown): ConstructionCheck {
	try {
		if (!Array.isArray(value) || value.length !== 11)
			throw new Error("A construction must contain exactly 11 points.");
		const decimals = value.map((point): [Decimal, Decimal] => {
			if (!Array.isArray(point) || point.length !== 2)
				throw new Error("Each point must contain exactly two coordinates.");
			return [readDecimal(point[0]), readDecimal(point[1])];
		});
		const places = Math.max(...decimals.flatMap((point) => point.map((coordinate) => coordinate.places)));
		const denominator = 10n ** BigInt(places);
		const points = decimals.map(([x, y]): [bigint, bigint] => [
			x.numerator * 10n ** BigInt(places - x.places),
			y.numerator * 10n ** BigInt(places - y.places),
		]);
		for (const [index, [x, y]] of points.entries()) {
			if (x < 0n || y < 0n || x + y > denominator) {
				throw new Error(`Point ${index} is outside x >= 0, y >= 0, x + y <= 1.`);
			}
		}
		let minimum: bigint | undefined;
		let minimumTriangle: number[] = [];
		for (let first = 0; first < points.length - 2; first++) {
			for (let second = first + 1; second < points.length - 1; second++) {
				for (let third = second + 1; third < points.length; third++) {
					const [ax, ay] = points[first];
					const [bx, by] = points[second];
					const [cx, cy] = points[third];
					const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
					const area = determinant < 0n ? -determinant : determinant;
					if (minimum === undefined || area < minimum) {
						minimum = area;
						minimumTriangle = [first, second, third];
					}
				}
			}
		}
		if (minimum === undefined) throw new Error("No triangle was evaluated.");
		// The containing simplex has area 1/2, so its normalized triangle area is the absolute determinant.
		const scoreDenominator = denominator * denominator;
		const divisor = greatestCommonDivisor(minimum, scoreDenominator);
		return {
			valid: true,
			score: Number(minimum) / Number(scoreDenominator),
			scoreNumerator: String(minimum / divisor),
			scoreDenominator: String(scoreDenominator / divisor),
			minimumTriangle,
		};
	} catch (error) {
		return { valid: false, score: null, error: error instanceof Error ? error.message : String(error) };
	}
}

function exactScore(result: ConstructionCheck): [bigint, bigint] {
	if (!result.valid || result.scoreNumerator === undefined || result.scoreDenominator === undefined) {
		throw new Error("An exact score requires a valid checked construction.");
	}
	return [BigInt(result.scoreNumerator), BigInt(result.scoreDenominator)];
}

export function compareScores(left: ConstructionCheck, right: ConstructionCheck): number {
	if (!left.valid || !right.valid) return Number(left.valid) - Number(right.valid);
	const [leftNumerator, leftDenominator] = exactScore(left);
	const [rightNumerator, rightDenominator] = exactScore(right);
	const difference = leftNumerator * rightDenominator - rightNumerator * leftDenominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function exceedsScore(result: ConstructionCheck, decimalThreshold: string): boolean {
	const threshold = readDecimal(decimalThreshold);
	if (!result.valid) return false;
	const [numerator, denominator] = exactScore(result);
	return numerator * 10n ** BigInt(threshold.places) > threshold.numerator * denominator;
}

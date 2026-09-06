export interface ConstructionCheck {
	valid: boolean;
	score: number | null;
	scoreNumerator?: string;
	scoreDenominator?: string;
	maxShift?: number;
	bins?: number;
	error?: string;
}

interface Decimal {
	numerator: bigint;
	places: number;
}

function readDecimal(value: unknown): Decimal {
	if (typeof value !== "string") throw new Error("Values must be explicit decimal strings.");
	if (value.length > 80) throw new Error("A decimal may contain at most 80 characters.");
	const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
	if (!match) throw new Error("Invalid decimal representation.");
	const fraction = match[3] ?? match[4] ?? "";
	const exponent = Number(match[5] ?? 0);
	const places = fraction.length - exponent;
	if (fraction.length > 60 || Math.abs(exponent) > 60 || places > 60) {
		throw new Error("Decimals support at most 60 places and an exponent from -60 to 60.");
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
		if (!Array.isArray(value) || value.length < 2 || value.length > 4096) {
			throw new Error("A construction must contain between 2 and 4096 bins.");
		}
		const decimals = value.map(readDecimal);
		const places = Math.max(...decimals.map((decimal) => decimal.places));
		const denominator = 10n ** BigInt(places);
		const values = decimals.map((decimal) => decimal.numerator * 10n ** BigInt(places - decimal.places));
		let sum = 0n;
		for (const [index, numerator] of values.entries()) {
			if (numerator < 0n || numerator > denominator) throw new Error(`Bin ${index} is outside [0,1].`);
			sum += numerator;
		}
		if (2n * sum !== BigInt(values.length) * denominator) throw new Error("The bin values must sum to N/2 exactly.");
		const complements = values.map((numerator) => denominator - numerator);
		let maximum = -1n;
		let maxShift = 0;
		// Both functions vanish outside [-1,1]. At shift 2k/N, only pairs j=i+k contribute.
		// Between grid shifts every interval overlap is affine; the continuous maximum is attained on this grid.
		for (let shift = 1 - values.length; shift < values.length; shift++) {
			let overlap = 0n;
			const end = Math.min(values.length, values.length - shift);
			for (let index = Math.max(0, -shift); index < end; index++) {
				overlap += values[index] * complements[index + shift];
			}
			if (overlap > maximum) {
				maximum = overlap;
				maxShift = shift;
			}
		}
		const scoreNumerator = 2n * maximum;
		const scoreDenominator = BigInt(values.length) * denominator * denominator;
		const divisor = greatestCommonDivisor(scoreNumerator, scoreDenominator);
		return {
			valid: true,
			score: Number(scoreNumerator) / Number(scoreDenominator),
			scoreNumerator: String(scoreNumerator / divisor),
			scoreDenominator: String(scoreDenominator / divisor),
			maxShift,
			bins: values.length,
		};
	} catch (error) {
		return {
			valid: false,
			score: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function exactScore(result: ConstructionCheck): [bigint, bigint] {
	if (!result.valid || result.scoreNumerator === undefined || result.scoreDenominator === undefined) {
		throw new Error("An exact score requires a valid checked construction.");
	}
	return [BigInt(result.scoreNumerator), BigInt(result.scoreDenominator)];
}

/** Positive means the left result is better: its upper bound is lower, or only it is valid. */
export function compareScores(left: ConstructionCheck, right: ConstructionCheck): number {
	if (!left.valid || !right.valid) return Number(left.valid) - Number(right.valid);
	const [leftNumerator, leftDenominator] = exactScore(left);
	const [rightNumerator, rightDenominator] = exactScore(right);
	const gain = rightNumerator * leftDenominator - leftNumerator * rightDenominator;
	return gain < 0n ? -1 : gain > 0n ? 1 : 0;
}

export function improvesBaseline(result: ConstructionCheck, baseline: ConstructionCheck, minGain: string): boolean {
	const threshold = readDecimal(minGain);
	if (threshold.numerator <= 0n) throw new Error("The minimum improvement must be positive.");
	if (!result.valid || !baseline.valid) return false;
	const [numerator, denominator] = exactScore(result);
	const [baselineNumerator, baselineDenominator] = exactScore(baseline);
	const gain = baselineNumerator * denominator - numerator * baselineDenominator;
	return gain * 10n ** BigInt(threshold.places) >= threshold.numerator * denominator * baselineDenominator;
}

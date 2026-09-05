export interface MinimizationParetoPoint {
	id: string;
	vector: readonly number[];
}

export interface ParetoVectorGroup {
	vector: readonly number[];
	pointIds: readonly string[];
}

export interface ParetoDominanceWitness {
	source: ParetoVectorGroup;
	target: ParetoVectorGroup;
	strictObjectiveIndexes: readonly number[];
}

export interface ParetoSetCoverage {
	sourceVectorCount: number;
	targetVectorCount: number;
	coveredTargetVectorCount: number;
	fraction: number | null;
	complete: boolean;
	witnesses: readonly ParetoDominanceWitness[];
	uncoveredTargets: readonly ParetoVectorGroup[];
}

export type ParetoCoverageClassification =
	| "left-covers"
	| "right-covers"
	| "equivalent"
	| "incomparable"
	| "not-comparable";

export interface ParetoCoverageComparison {
	objectiveCount: number | null;
	leftFrontier: readonly ParetoVectorGroup[];
	rightFrontier: readonly ParetoVectorGroup[];
	leftCoversRight: ParetoSetCoverage;
	rightCoversLeft: ParetoSetCoverage;
	classification: ParetoCoverageClassification;
}

function validatePoints(points: readonly MinimizationParetoPoint[], side: string): number | null {
	let objectiveCount: number | null = null;
	const ids = new Set<string>();
	for (const [pointIndex, point] of points.entries()) {
		if (!point.id.trim()) throw new Error(`${side}[${pointIndex}].id must be a non-empty string`);
		if (ids.has(point.id)) throw new Error(`${side} contains duplicate point ID ${point.id}`);
		ids.add(point.id);
		if (point.vector.length === 0) throw new Error(`${side}[${pointIndex}].vector must not be empty`);
		objectiveCount ??= point.vector.length;
		if (point.vector.length !== objectiveCount) {
			throw new Error(
				`${side}[${pointIndex}].vector has ${point.vector.length} objectives, expected ${objectiveCount}`,
			);
		}
		for (const [objectiveIndex, value] of point.vector.entries()) {
			if (!Number.isFinite(value)) {
				throw new Error(`${side}[${pointIndex}].vector[${objectiveIndex}] must be finite`);
			}
		}
	}
	return objectiveCount;
}

function compareVectors(left: readonly number[], right: readonly number[]): number {
	for (let index = 0; index < left.length; index++) {
		const order = left[index] - right[index];
		if (order !== 0) return order;
	}
	return 0;
}

function weaklyDominates(source: readonly number[], target: readonly number[]): boolean {
	return source.every((value, index) => value <= target[index]);
}

function strictlyDominates(source: readonly number[], target: readonly number[]): boolean {
	return weaklyDominates(source, target) && source.some((value, index) => value < target[index]);
}

function vectorGroups(points: readonly MinimizationParetoPoint[]): ParetoVectorGroup[] {
	const groups = new Map<string, { vector: number[]; pointIds: string[] }>();
	for (const point of points) {
		const vector = [...point.vector];
		const key = JSON.stringify(vector);
		const existing = groups.get(key);
		if (existing) existing.pointIds.push(point.id);
		else groups.set(key, { vector, pointIds: [point.id] });
	}
	return [...groups.values()]
		.map((group) => ({ vector: group.vector, pointIds: group.pointIds.sort() }))
		.sort((left, right) => compareVectors(left.vector, right.vector));
}

function paretoFrontier(points: readonly MinimizationParetoPoint[]): ParetoVectorGroup[] {
	const groups = vectorGroups(points);
	return groups.filter(
		(candidate) => !groups.some((other) => other !== candidate && strictlyDominates(other.vector, candidate.vector)),
	);
}

function coverage(source: readonly ParetoVectorGroup[], target: readonly ParetoVectorGroup[]): ParetoSetCoverage {
	const witnesses: ParetoDominanceWitness[] = [];
	const uncoveredTargets: ParetoVectorGroup[] = [];
	let coveredTargetVectorCount = 0;
	for (const targetGroup of target) {
		const coveringSources = source.filter((sourceGroup) => weaklyDominates(sourceGroup.vector, targetGroup.vector));
		if (coveringSources.length === 0) {
			uncoveredTargets.push(targetGroup);
			continue;
		}
		coveredTargetVectorCount++;
		for (const sourceGroup of coveringSources) {
			witnesses.push({
				source: sourceGroup,
				target: targetGroup,
				strictObjectiveIndexes: sourceGroup.vector.flatMap((value, index) =>
					value < targetGroup.vector[index] ? [index] : [],
				),
			});
		}
	}
	return {
		sourceVectorCount: source.length,
		targetVectorCount: target.length,
		coveredTargetVectorCount,
		fraction: target.length === 0 ? null : coveredTargetVectorCount / target.length,
		complete: target.length > 0 && coveredTargetVectorCount === target.length,
		witnesses,
		uncoveredTargets,
	};
}

export function compareParetoCoverage(
	left: readonly MinimizationParetoPoint[],
	right: readonly MinimizationParetoPoint[],
): ParetoCoverageComparison {
	const leftObjectiveCount = validatePoints(left, "left");
	const rightObjectiveCount = validatePoints(right, "right");
	if (leftObjectiveCount !== null && rightObjectiveCount !== null && leftObjectiveCount !== rightObjectiveCount) {
		throw new Error(
			`Pareto sets have different objective counts: left=${leftObjectiveCount}, right=${rightObjectiveCount}`,
		);
	}
	const leftFrontier = paretoFrontier(left);
	const rightFrontier = paretoFrontier(right);
	const leftCoversRight = coverage(leftFrontier, rightFrontier);
	const rightCoversLeft = coverage(rightFrontier, leftFrontier);
	let classification: ParetoCoverageClassification;
	if (leftFrontier.length === 0 || rightFrontier.length === 0) classification = "not-comparable";
	else if (leftCoversRight.complete && rightCoversLeft.complete) classification = "equivalent";
	else if (leftCoversRight.complete) classification = "left-covers";
	else if (rightCoversLeft.complete) classification = "right-covers";
	else classification = "incomparable";
	return {
		objectiveCount: leftObjectiveCount ?? rightObjectiveCount,
		leftFrontier,
		rightFrontier,
		leftCoversRight,
		rightCoversLeft,
		classification,
	};
}

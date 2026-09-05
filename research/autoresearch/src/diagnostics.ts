import type { TaskMeasurement } from "./types.js";

export interface RemovalDelta {
	benchmarkId: string;
	parentIrInstructionCount: number;
	candidateIrInstructionCount: number;
	delta: number;
}

export type RemovalOutcome =
	| "strictly-better-removal"
	| "exact-no-op-removal"
	| "necessary-component"
	| "mixed-tradeoff"
	| "invalid";

export function parseLlvmPassSequence(content: string): string[] {
	const value: unknown = JSON.parse(content);
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error("LLVM pass sequence must be a JSON string array");
	}
	return [...value];
}

export function findSingleRemoval(
	parent: readonly string[],
	candidate: readonly string[],
): { removedIndex: number; removedAction: string } | null {
	if (candidate.length !== parent.length - 1) return null;
	for (let index = 0; index < parent.length; index++) {
		const withoutIndex = [...parent.slice(0, index), ...parent.slice(index + 1)];
		if (withoutIndex.every((action, candidateIndex) => action === candidate[candidateIndex])) {
			return { removedIndex: index, removedAction: parent[index] };
		}
	}
	return null;
}

export function classifyRemoval(
	parentTasks: readonly TaskMeasurement[],
	candidateTasks: readonly TaskMeasurement[],
): { outcome: RemovalOutcome; deltas: RemovalDelta[] } {
	const parentByTask = new Map(parentTasks.map((task) => [task.benchmarkId, task]));
	if (
		candidateTasks.length !== parentTasks.length ||
		candidateTasks.some((task) => task.status !== "accepted" || !task.verifier.passed)
	) {
		return { outcome: "invalid", deltas: [] };
	}
	const deltas: RemovalDelta[] = [];
	for (const task of candidateTasks) {
		const parent = parentByTask.get(task.benchmarkId);
		const parentCount = parent?.metrics.IrInstructionCount;
		const candidateCount = task.metrics.IrInstructionCount;
		if (
			!parent ||
			parent.status !== "accepted" ||
			!parent.verifier.passed ||
			parentCount === undefined ||
			candidateCount === undefined
		) {
			return { outcome: "invalid", deltas: [] };
		}
		deltas.push({
			benchmarkId: task.benchmarkId,
			parentIrInstructionCount: parentCount,
			candidateIrInstructionCount: candidateCount,
			delta: candidateCount - parentCount,
		});
	}
	const values = deltas.map((delta) => delta.delta);
	if (values.every((value) => value === 0)) return { outcome: "exact-no-op-removal", deltas };
	if (values.every((value) => value <= 0)) return { outcome: "strictly-better-removal", deltas };
	if (values.every((value) => value >= 0)) return { outcome: "necessary-component", deltas };
	return { outcome: "mixed-tradeoff", deltas };
}

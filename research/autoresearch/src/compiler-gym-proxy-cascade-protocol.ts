import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import {
	COMPILER_GYM_LATENCY_EXPECTED_HARDWARE,
	COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE,
} from "./compiler-gym-latency-analysis.js";
import { type LedgerEvent, verifyLedgerContentsStrict } from "./ledger.js";

export const COMPILER_GYM_PROXY_CASCADE_PROTOCOL = "compiler-gym-blowfish-proxy-cascade-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_REPLAY_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-retrospective-replay-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_SELECTION_PROTOCOL =
	"compiler-gym-blowfish-two-best-distinct-tiers-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_PHASE_PLAN_PROTOCOL =
	"compiler-gym-blowfish-proxy-cascade-eight-allocation-audit-v1" as const;

export const COMPILER_GYM_PROXY_CASCADE_BLOWFISH = "benchmark://cbench-v1/blowfish" as const;
export const COMPILER_GYM_PROXY_CASCADE_BZIP2 = "benchmark://cbench-v1/bzip2" as const;
export const COMPILER_GYM_PROXY_CASCADE_TASKS = [
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
] as const;

export const COMPILER_GYM_PROXY_CASCADE_REPLAY_SAVING_THRESHOLD = {
	numerator: 1,
	denominator: 4,
	comparison: "greater-than-or-equal",
	basis: "sum-evaluator-runtime-microseconds",
} as const;

export const COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES = [
	{
		path: "cpu-pilots/R-2026-08-28-v2-smoke/evidence.jsonl",
		sha256: "790a34942688d9286358d02e641d25ad90bc5599a2a5a3ce5974c2b358d5901a",
		eventCount: 26,
		terminalEventHash: "5a3f768e418c32d7ce07e4b35e28a0809e658bebc4ce9f5c84e04161c722cf9c",
	},
	{
		path: "feedback-projection-screen/concise/evaluation/evidence.jsonl",
		sha256: "a4b55abf4a8bd8b42c5809a8f2c351eaa357d8e48d2ecdbecb288d37d1a06bd0",
		eventCount: 26,
		terminalEventHash: "518a31ff3c547aa9826a7cae5514c640fe6c4055a9048b88b0d2b721b40fd2c1",
	},
	{
		path: "feedback-projection-screen/full/evaluation/evidence.jsonl",
		sha256: "a51ab5259e248775636edb84271a519a9b1d806ccbf7c8babf890dcf58580cf2",
		eventCount: 26,
		terminalEventHash: "35341b0b3ea42ca95bb86a728a289f0ce2f1be022fd731b3594269ff17cbeab3",
	},
	{
		path: "stock-cpu-baseline/2026-08-28-v3-v2-sealed/evaluation/evidence.jsonl",
		sha256: "49bafd401fb9e023fd3ddb2bc2f1a12f63cc501ff3933bb4f334b193fdcdd600",
		eventCount: 26,
		terminalEventHash: "aa5352827ad4e0ea6f4be049fad5d93077827ea1ee7dfeff63f3bffc5208aa6f",
	},
	{
		path: "stock-interface-pair-screen/2026-08-28-block-v1/stock/evaluation/evidence.jsonl",
		sha256: "8aa3fa969338a280dd7f4630187924b230b31d71a7277107bd4556a465e6a91b",
		eventCount: 26,
		terminalEventHash: "7f712478deb1788b97c291c6af33e75f252082bbae267f1b930650a635387c67",
	},
	{
		path: "stock-interface-pair-screen/2026-08-28-block-v1/typed/evaluation/evidence.jsonl",
		sha256: "12c7aa0a51877b4d7a1d535965883d9a3eda8d249cd4d2be3214ee401cf4d462",
		eventCount: 26,
		terminalEventHash: "289e8e37e6adc6c8a24529bbb6ea1d5811a8edc6cff7a851d310b8daa63d23b1",
	},
	{
		path: "stock-interface-pair-screen/2026-08-28-block-v2/stock/evaluation/evidence.jsonl",
		sha256: "31f34f1c78a7213bc3eb852e82f56943c4ecd23f310fafe8f6b6f53c018d02f9",
		eventCount: 26,
		terminalEventHash: "48c9c5816a79723b97dc2a367bafdb4b205fea05328e42b41759ed4a76cc1bbe",
	},
	{
		path: "stock-interface-pair-screen/2026-08-28-block-v3/stock/evaluation/evidence.jsonl",
		sha256: "eae3865423af45a1c3396772601d53019d1f3b47fca4f9ec228e461c0be2d440",
		eventCount: 26,
		terminalEventHash: "1a5817119dbd2907b8c3e57b8c6641bf98e2853b48ef0acf53d9b050ea091f38",
	},
	{
		path: "stock-interface-pair-screen/2026-08-28-block-v3/typed/evaluation/evidence.jsonl",
		sha256: "8f75d979c0eb9a3d9ad420c3a45988e2decd5ad080223cef97761a1aaf323c80",
		eventCount: 26,
		terminalEventHash: "978b2792022986fd5abfadf13fdc3f13b17cc45ed13fb2b3fc9d6704f6e635af",
	},
	{
		path: "stock-interface-pair-screen/2026-08-28-block-v4/stock/evaluation/evidence.jsonl",
		sha256: "d02a0e9c99633580442813ddfe4fe4ac3991b7cf85f92bffaa2ba643123cacb9",
		eventCount: 26,
		terminalEventHash: "836c23384c731610d0835bf1893572110b2ce46ff196f3e3b5e3b999897b5d42",
	},
	{
		path: "stock-interface-pair-screen/2026-08-28-block-v4/typed/evaluation/evidence.jsonl",
		sha256: "6dfd45ff80326618c8a3d6753c6da1c5610f8a16aa61f3c07e82c4cda2eaa1e1",
		eventCount: 26,
		terminalEventHash: "200c6ef95875c9f4affe1f06dbc538defcb76981070f54ec6ae4ed6c3df56dc3",
	},
	{
		path: "stock-interface-parity/2026-08-28-v1/evaluation/evidence.jsonl",
		sha256: "bc8696690ebcff5f178f5d9ac945e7b01ca4024c8c802298e0ca07492b60201e",
		eventCount: 26,
		terminalEventHash: "d1fd7fdb346a74c3dcadb78d3b0768536a245b0ce6cd6154701952a5512e9964",
	},
	{
		path: "stock-interface-parity/2026-08-28-v2/evaluation/evidence.jsonl",
		sha256: "fe0cbb23998ec2efcf9392492396d31f7f92655fde5a5eb5ace2a022a8bd6d10",
		eventCount: 26,
		terminalEventHash: "1d3ae6d3f353c47dc76feb0dc1168a856411f4a3612e7a9fa482e7c0dcefa3eb",
	},
] as const;

export const COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY = {
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
	selectedTrajectoryPath: "stock-interface-pair-screen/2026-08-28-block-v1/stock/evaluation/evidence.jsonl",
	selectedTrajectoryLedgerSha256: "8aa3fa969338a280dd7f4630187924b230b31d71a7277107bd4556a465e6a91b",
	selectedTrajectoryTerminalEventHash: "7f712478deb1788b97c291c6af33e75f252082bbae267f1b930650a635387c67",
	selectedOrdinals: [2, 3],
	omittedOrdinals: [1, 4],
} as const;

const SHA256 = /^[0-9a-f]{64}$/;
const CANDIDATE_MEDIA_TYPE = "application/vnd.prime.llvm-pass-sequence";
const BLOWFISH_CALIBRATION_IR = 3_898;
const BZIP2_CALIBRATION_IR = 28_748;

export interface CompilerGymProxyCascadeReplayLedgerSource {
	path: string;
	contents: string;
}

export interface CompilerGymProxyCascadeTaskPoint {
	benchmarkId: (typeof COMPILER_GYM_PROXY_CASCADE_TASKS)[number];
	irInstructionCount: number;
	objectTextSizeBytes: number;
	evaluatorRuntimeMicros: number;
}

export interface CompilerGymProxyCascadeCandidate {
	ordinal: number;
	jobId: string;
	candidateSha256: string;
	candidateByteLength: number;
	candidateMediaType: typeof CANDIDATE_MEDIA_TYPE;
	proposalEventSequence: number;
	measurementEventSequence: number;
	measurementPayloadSha256: string;
	blowfish: CompilerGymProxyCascadeTaskPoint;
	bzip2: CompilerGymProxyCascadeTaskPoint;
}

export interface CompilerGymProxyCascadeTrajectoryReplay {
	path: string;
	ledgerSha256: string;
	terminalEventHash: string;
	model: string;
	candidates: CompilerGymProxyCascadeCandidate[];
	proxyTiersAscending: number[];
	selectedOrdinals: number[];
	omittedOrdinals: number[];
	frontierOrdinals: number[];
	championOrdinal: number;
	frontierRetained: boolean;
	selectionExpandedByTies: boolean;
	totalEvaluatorRuntimeMicros: string;
	omittedBzip2EvaluatorRuntimeMicros: string;
}

export interface CompilerGymProxyCascadeReplayResult {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_REPLAY_PROTOCOL;
	selectionProtocol: typeof COMPILER_GYM_PROXY_CASCADE_SELECTION_PROTOCOL;
	classification: "retrospective-development-only-not-a-causal-counterfactual";
	inputManifest: Array<{
		path: string;
		sha256: string;
		eventCount: number;
		measurementCount: 4;
		terminalEventHash: string;
	}>;
	trajectories: CompilerGymProxyCascadeTrajectoryReplay[];
	summary: {
		trajectoryCount: number;
		candidateCount: number;
		uniqueCandidateDigestCount: number;
		selectedCandidateCount: number;
		omittedCandidateCount: number;
		frontierCandidateCount: number;
		retainedFrontierCandidateCount: number;
		twoCandidateTrajectoryCount: number;
		tieExpandedTrajectoryCount: number;
		totalEvaluatorRuntimeMicros: string;
		retainedEvaluatorRuntimeMicros: string;
		omittedBzip2EvaluatorRuntimeMicros: string;
		savingFraction: { numerator: string; denominator: string };
	};
	gate: {
		allTrajectoryFrontiersRetained: boolean;
		savingThresholdPassed: boolean;
		passed: boolean;
		threshold: typeof COMPILER_GYM_PROXY_CASCADE_REPLAY_SAVING_THRESHOLD;
		claimLimits: {
			prospectivePolicyEvidence: false;
			causalTimingEvidence: false;
			independentTrajectoryAssumption: false;
		};
	};
}

export interface CompilerGymProxyCascadeRestrictedCandidateProjection {
	ordinal: number;
	candidateSha256: string;
	proxyAccepted: true;
	blowfishIrInstructionCount: number;
}

export interface CompilerGymProxyCascadeRestrictedTrajectoryProjection {
	path: string;
	candidates: CompilerGymProxyCascadeRestrictedCandidateProjection[];
	uniqueCandidateDigests: boolean;
	distinctProxyScores: boolean;
	eligibleForUntiedQualification: boolean;
}

export interface CompilerGymProxyCascadeSelectedTrajectory {
	selectionMethod: "ascii-path-first-over-restricted-eligible-projection";
	path: string;
	ledgerSha256: string;
	terminalEventHash: string;
	selectedOrdinals: number[];
	omittedOrdinals: number[];
	candidates: CompilerGymProxyCascadeCandidate[];
	restrictedProjectionSha256: string;
}

export type CompilerGymProxyCascadePhaseId = "proxy-blowfish" | "selected-bzip2" | "omitted-bzip2-audit";

export interface CompilerGymProxyCascadeAllocationSpec {
	allocationOrdinal: number;
	phase: CompilerGymProxyCascadePhaseId;
	candidateOrdinal: number;
	benchmarkId: (typeof COMPILER_GYM_PROXY_CASCADE_TASKS)[number];
	visibility: "cascade-evidence" | "audit-only-agent-inaccessible";
	requiresRemoteLock: "global" | "selection" | "cascade";
}

export interface CompilerGymProxyCascadePhasePlan {
	protocol: typeof COMPILER_GYM_PROXY_CASCADE_PHASE_PLAN_PROTOCOL;
	allocations: CompilerGymProxyCascadeAllocationSpec[];
	selectedOrdinals: number[];
	omittedOrdinals: number[];
	phaseCounts: { proxyBlowfish: 4; selectedBzip2: 2; omittedBzip2Audit: 2; total: 8 };
	counterfactualCascadeAllocationCount: 6;
	actualQualificationAllocationCount: 8;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function nonemptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${path} must be a positive safe integer`);
	}
	return value;
}

function exactJson(actual: unknown, expected: unknown, path: string): void {
	if (canonicalJson(toJsonValue(actual)) !== canonicalJson(toJsonValue(expected))) {
		throw new Error(`${path} differs from its frozen value`);
	}
}

function taskPoint(value: unknown, path: string): CompilerGymProxyCascadeTaskPoint {
	const task = record(value, path);
	const benchmarkId = nonemptyString(task.benchmarkId, `${path}.benchmarkId`);
	if (benchmarkId !== COMPILER_GYM_PROXY_CASCADE_BLOWFISH && benchmarkId !== COMPILER_GYM_PROXY_CASCADE_BZIP2) {
		throw new Error(`${path}.benchmarkId is outside the frozen task pair`);
	}
	if (task.status !== "accepted") throw new Error(`${path}.status must be accepted`);
	const verifier = record(task.verifier, `${path}.verifier`);
	if (verifier.passed !== true) throw new Error(`${path}.verifier.passed must be true`);
	if (Array.isArray(verifier.errors) && verifier.errors.length !== 0) {
		throw new Error(`${path}.verifier.errors must be empty`);
	}
	const metrics = record(task.metrics, `${path}.metrics`);
	const evaluatorRuntimeMs = metrics.evaluatorRuntimeMs;
	if (typeof evaluatorRuntimeMs !== "number" || !Number.isFinite(evaluatorRuntimeMs) || evaluatorRuntimeMs <= 0) {
		throw new Error(`${path}.metrics.evaluatorRuntimeMs must be finite and positive`);
	}
	const evaluatorRuntimeMicros = Math.round(evaluatorRuntimeMs * 1_000);
	if (Math.abs(evaluatorRuntimeMs * 1_000 - evaluatorRuntimeMicros) > 1e-6) {
		throw new Error(`${path}.metrics.evaluatorRuntimeMs exceeds microsecond precision`);
	}
	return {
		benchmarkId,
		irInstructionCount: positiveSafeInteger(metrics.IrInstructionCount, `${path}.metrics.IrInstructionCount`),
		objectTextSizeBytes: positiveSafeInteger(metrics.ObjectTextSizeBytes, `${path}.metrics.ObjectTextSizeBytes`),
		evaluatorRuntimeMicros,
	};
}

function proposalForJob(events: readonly LedgerEvent[], jobId: string, path: string): LedgerEvent {
	const matches = events.filter((event) => {
		if (event.kind !== "proposal" || !isRecord(event.payload)) return false;
		return event.payload.jobId === jobId;
	});
	if (matches.length !== 1) throw new Error(`${path} must contain exactly one proposal for ${jobId}`);
	return matches[0]!;
}

function parseCandidate(
	events: readonly LedgerEvent[],
	measurement: LedgerEvent,
	ordinal: number,
	path: string,
): CompilerGymProxyCascadeCandidate {
	const payload = record(measurement.payload, `${path}:measurement[${ordinal}]`);
	const jobId = nonemptyString(payload.jobId, `${path}:measurement[${ordinal}].jobId`);
	const proposal = proposalForJob(events, jobId, path);
	if (proposal.sequence >= measurement.sequence) throw new Error(`${path}:${jobId} measurement precedes its proposal`);
	const proposalPayload = record(proposal.payload, `${path}:${jobId}:proposal`);
	const proposalManifestDigest = nonemptyString(
		proposalPayload.manifestDigest,
		`${path}:${jobId}:proposal.manifestDigest`,
	);
	if (!SHA256.test(proposalManifestDigest))
		throw new Error(`${path}:${jobId} proposal manifest digest is not SHA-256`);
	if (payload.manifestDigest !== proposalManifestDigest) {
		throw new Error(`${path}:${jobId} measurement is not bound to its proposal manifest`);
	}
	const candidate = record(proposalPayload.candidate, `${path}:${jobId}:proposal.candidate`);
	const candidateSha256 = nonemptyString(candidate.digest, `${path}:${jobId}:candidate.digest`);
	if (!SHA256.test(candidateSha256)) throw new Error(`${path}:${jobId} candidate digest is not SHA-256`);
	const candidateMediaType = nonemptyString(candidate.mediaType, `${path}:${jobId}:candidate.mediaType`);
	if (candidateMediaType !== CANDIDATE_MEDIA_TYPE) throw new Error(`${path}:${jobId} candidate media type drifted`);
	if (Object.hasOwn(payload, "reuse")) throw new Error(`${path}:${jobId} is reused evidence`);
	if (payload.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		throw new Error(`${path}:${jobId} verifier epoch drifted`);
	}
	exactJson(payload.hardware, COMPILER_GYM_LATENCY_EXPECTED_HARDWARE, `${path}:${jobId}.hardware`);
	exactJson(payload.provenance, COMPILER_GYM_LATENCY_EXPECTED_PROVENANCE, `${path}:${jobId}.provenance`);
	if (!Array.isArray(payload.tasks) || payload.tasks.length !== 2) {
		throw new Error(`${path}:${jobId} must contain exactly two task measurements`);
	}
	const tasks = payload.tasks.map((task, index) => taskPoint(task, `${path}:${jobId}.tasks[${index}]`));
	const taskById = new Map(tasks.map((task) => [task.benchmarkId, task]));
	if (taskById.size !== 2) throw new Error(`${path}:${jobId} contains duplicate task IDs`);
	const blowfish = taskById.get(COMPILER_GYM_PROXY_CASCADE_BLOWFISH);
	const bzip2 = taskById.get(COMPILER_GYM_PROXY_CASCADE_BZIP2);
	if (!blowfish || !bzip2) throw new Error(`${path}:${jobId} does not cover the frozen task pair`);
	return {
		ordinal,
		jobId,
		candidateSha256,
		candidateByteLength: positiveSafeInteger(candidate.byteLength, `${path}:${jobId}:candidate.byteLength`),
		candidateMediaType: CANDIDATE_MEDIA_TYPE,
		proposalEventSequence: proposal.sequence,
		measurementEventSequence: measurement.sequence,
		measurementPayloadSha256: sha256Json(payload),
		blowfish,
		bzip2,
	};
}

function dominates(left: CompilerGymProxyCascadeCandidate, right: CompilerGymProxyCascadeCandidate): boolean {
	return (
		left.blowfish.irInstructionCount <= right.blowfish.irInstructionCount &&
		left.bzip2.irInstructionCount <= right.bzip2.irInstructionCount &&
		(left.blowfish.irInstructionCount < right.blowfish.irInstructionCount ||
			left.bzip2.irInstructionCount < right.bzip2.irInstructionCount)
	);
}

export function selectCompilerGymProxyCascadeOrdinals(
	candidates: readonly { ordinal: number; blowfishIrInstructionCount: number }[],
): { proxyTiersAscending: number[]; selectedOrdinals: number[]; omittedOrdinals: number[] } {
	if (candidates.length === 0) throw new Error("Proxy-cascade selection requires at least one candidate");
	if (
		new Set(candidates.map((candidate) => candidate.ordinal)).size !== candidates.length ||
		candidates.some(
			(candidate) =>
				!Number.isSafeInteger(candidate.ordinal) ||
				candidate.ordinal < 1 ||
				!Number.isSafeInteger(candidate.blowfishIrInstructionCount) ||
				candidate.blowfishIrInstructionCount < 1,
		)
	) {
		throw new Error("Proxy-cascade selection candidates are invalid");
	}
	const proxyTiersAscending = [...new Set(candidates.map((candidate) => candidate.blowfishIrInstructionCount))].sort(
		(left, right) => left - right,
	);
	const retainedTiers = new Set(proxyTiersAscending.slice(0, 2));
	return {
		proxyTiersAscending,
		selectedOrdinals: candidates
			.filter((candidate) => retainedTiers.has(candidate.blowfishIrInstructionCount))
			.map((candidate) => candidate.ordinal)
			.sort((left, right) => left - right),
		omittedOrdinals: candidates
			.filter((candidate) => !retainedTiers.has(candidate.blowfishIrInstructionCount))
			.map((candidate) => candidate.ordinal)
			.sort((left, right) => left - right),
	};
}

export function compilerGymProxyCascadeParetoFrontierOrdinals(
	candidates: readonly Pick<CompilerGymProxyCascadeCandidate, "ordinal" | "blowfish" | "bzip2">[],
): number[] {
	return candidates
		.filter(
			(candidate) =>
				!candidates.some(
					(other) =>
						other !== candidate &&
						other.blowfish.irInstructionCount <= candidate.blowfish.irInstructionCount &&
						other.bzip2.irInstructionCount <= candidate.bzip2.irInstructionCount &&
						(other.blowfish.irInstructionCount < candidate.blowfish.irInstructionCount ||
							other.bzip2.irInstructionCount < candidate.bzip2.irInstructionCount),
				),
		)
		.map((candidate) => candidate.ordinal)
		.sort((left, right) => left - right);
}

function compareRatio(
	leftNumerator: number,
	leftDenominator: number,
	rightNumerator: number,
	rightDenominator: number,
) {
	const difference =
		BigInt(leftNumerator) * BigInt(rightDenominator) - BigInt(rightNumerator) * BigInt(leftDenominator);
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function compareChampionCandidates(
	left: CompilerGymProxyCascadeCandidate,
	right: CompilerGymProxyCascadeCandidate,
): number {
	const leftRatios = [
		{ numerator: left.blowfish.irInstructionCount, denominator: BLOWFISH_CALIBRATION_IR },
		{ numerator: left.bzip2.irInstructionCount, denominator: BZIP2_CALIBRATION_IR },
	].sort((a, b) => -compareRatio(a.numerator, a.denominator, b.numerator, b.denominator));
	const rightRatios = [
		{ numerator: right.blowfish.irInstructionCount, denominator: BLOWFISH_CALIBRATION_IR },
		{ numerator: right.bzip2.irInstructionCount, denominator: BZIP2_CALIBRATION_IR },
	].sort((a, b) => -compareRatio(a.numerator, a.denominator, b.numerator, b.denominator));
	for (let index = 0; index < leftRatios.length; index++) {
		const leftRatio = leftRatios[index]!;
		const rightRatio = rightRatios[index]!;
		const order = compareRatio(
			leftRatio.numerator,
			leftRatio.denominator,
			rightRatio.numerator,
			rightRatio.denominator,
		);
		if (order !== 0) return order;
	}
	for (const task of ["blowfish", "bzip2"] as const) {
		const order = left[task].irInstructionCount - right[task].irInstructionCount;
		if (order !== 0) return order;
	}
	const digestOrder =
		left.candidateSha256 < right.candidateSha256 ? -1 : left.candidateSha256 > right.candidateSha256 ? 1 : 0;
	return digestOrder === 0 ? left.ordinal - right.ordinal : digestOrder;
}

function replayTrajectory(
	source: CompilerGymProxyCascadeReplayLedgerSource,
	expected: (typeof COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES)[number],
): CompilerGymProxyCascadeTrajectoryReplay {
	if (sha256Text(source.contents) !== expected.sha256) throw new Error(`${source.path} ledger SHA-256 drifted`);
	const events = verifyLedgerContentsStrict(source.contents);
	if (events.length !== expected.eventCount) throw new Error(`${source.path} event count drifted`);
	if (events.at(-1)?.hash !== expected.terminalEventHash) throw new Error(`${source.path} terminal event drifted`);
	const start = events[0];
	if (!start || start.kind !== "run_manifest") throw new Error(`${source.path} lacks its start run manifest`);
	const model = nonemptyString(record(start.payload, `${source.path}:start`).model, `${source.path}:start.model`);
	const measurements = events.filter((event) => event.kind === "measurement");
	if (measurements.length !== 4) throw new Error(`${source.path} must contain exactly four measurements`);
	const candidates = measurements.map((measurement, index) =>
		parseCandidate(events, measurement, index + 1, source.path),
	);
	for (let index = 1; index < candidates.length; index++) {
		if (candidates[index]!.proposalEventSequence <= candidates[index - 1]!.measurementEventSequence) {
			throw new Error(`${source.path} does not preserve the observed sequential full-feedback trajectory`);
		}
	}
	const selection = selectCompilerGymProxyCascadeOrdinals(
		candidates.map((candidate) => ({
			ordinal: candidate.ordinal,
			blowfishIrInstructionCount: candidate.blowfish.irInstructionCount,
		})),
	);
	const selected = candidates.filter((candidate) => selection.selectedOrdinals.includes(candidate.ordinal));
	const omitted = candidates.filter((candidate) => selection.omittedOrdinals.includes(candidate.ordinal));
	const frontier = candidates.filter(
		(candidate) => !candidates.some((other) => other !== candidate && dominates(other, candidate)),
	);
	const selectedOrdinals = selected.map((candidate) => candidate.ordinal);
	const frontierOrdinals = compilerGymProxyCascadeParetoFrontierOrdinals(candidates);
	const frontierRetained = frontierOrdinals.every((ordinal) => selectedOrdinals.includes(ordinal));
	const champion = [...frontier].sort(compareChampionCandidates)[0];
	if (!champion) throw new Error(`${source.path} has no authoritative champion`);
	const totalEvaluatorRuntimeMicros = candidates.reduce(
		(total, candidate) =>
			total + BigInt(candidate.blowfish.evaluatorRuntimeMicros + candidate.bzip2.evaluatorRuntimeMicros),
		0n,
	);
	const omittedBzip2EvaluatorRuntimeMicros = omitted.reduce(
		(total, candidate) => total + BigInt(candidate.bzip2.evaluatorRuntimeMicros),
		0n,
	);
	return {
		path: source.path,
		ledgerSha256: expected.sha256,
		terminalEventHash: expected.terminalEventHash,
		model,
		candidates,
		proxyTiersAscending: selection.proxyTiersAscending,
		selectedOrdinals,
		omittedOrdinals: omitted.map((candidate) => candidate.ordinal),
		frontierOrdinals,
		championOrdinal: champion.ordinal,
		frontierRetained,
		selectionExpandedByTies: selected.length > 2,
		totalEvaluatorRuntimeMicros: totalEvaluatorRuntimeMicros.toString(10),
		omittedBzip2EvaluatorRuntimeMicros: omittedBzip2EvaluatorRuntimeMicros.toString(10),
	};
}

function assertFrozenReplayOutcome(result: CompilerGymProxyCascadeReplayResult): void {
	const expected = COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY;
	for (const key of [
		"trajectoryCount",
		"candidateCount",
		"uniqueCandidateDigestCount",
		"selectedCandidateCount",
		"omittedCandidateCount",
		"frontierCandidateCount",
		"retainedFrontierCandidateCount",
		"twoCandidateTrajectoryCount",
		"tieExpandedTrajectoryCount",
		"totalEvaluatorRuntimeMicros",
		"retainedEvaluatorRuntimeMicros",
		"omittedBzip2EvaluatorRuntimeMicros",
	] as const) {
		if (result.summary[key] !== expected[key]) {
			throw new Error(`Frozen proxy-cascade replay ${key} drifted`);
		}
	}
	if (!result.gate.passed) throw new Error("Frozen proxy-cascade replay gate did not pass");
}

export function replayCompilerGymProxyCascade(
	sources: readonly CompilerGymProxyCascadeReplayLedgerSource[],
): CompilerGymProxyCascadeReplayResult {
	const sourceByPath = new Map<string, CompilerGymProxyCascadeReplayLedgerSource>();
	for (const source of sources) {
		if (sourceByPath.has(source.path)) throw new Error(`Duplicate proxy-cascade source: ${source.path}`);
		sourceByPath.set(source.path, source);
	}
	const expectedPaths = new Set<string>(COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES.map((source) => source.path));
	const missing = [...expectedPaths].filter((path) => !sourceByPath.has(path));
	const extra = [...sourceByPath.keys()].filter((path) => !expectedPaths.has(path));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(`Proxy-cascade replay source mismatch: missing=${missing.join(",")} extra=${extra.join(",")}`);
	}
	const trajectories = COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES.map((expected) => {
		const source = sourceByPath.get(expected.path);
		if (!source) throw new Error(`Missing proxy-cascade source after validation: ${expected.path}`);
		return replayTrajectory(source, expected);
	});
	const candidates = trajectories.flatMap((trajectory) => trajectory.candidates);
	const selectedCandidateCount = trajectories.reduce(
		(total, trajectory) => total + trajectory.selectedOrdinals.length,
		0,
	);
	const frontierCandidateCount = trajectories.reduce(
		(total, trajectory) => total + trajectory.frontierOrdinals.length,
		0,
	);
	const retainedFrontierCandidateCount = trajectories.reduce(
		(total, trajectory) =>
			total + trajectory.frontierOrdinals.filter((ordinal) => trajectory.selectedOrdinals.includes(ordinal)).length,
		0,
	);
	const totalEvaluatorRuntimeMicros = trajectories.reduce(
		(total, trajectory) => total + BigInt(trajectory.totalEvaluatorRuntimeMicros),
		0n,
	);
	const omittedBzip2EvaluatorRuntimeMicros = trajectories.reduce(
		(total, trajectory) => total + BigInt(trajectory.omittedBzip2EvaluatorRuntimeMicros),
		0n,
	);
	const retainedEvaluatorRuntimeMicros = totalEvaluatorRuntimeMicros - omittedBzip2EvaluatorRuntimeMicros;
	const allTrajectoryFrontiersRetained = trajectories.every((trajectory) => trajectory.frontierRetained);
	const savingThresholdPassed =
		omittedBzip2EvaluatorRuntimeMicros * BigInt(COMPILER_GYM_PROXY_CASCADE_REPLAY_SAVING_THRESHOLD.denominator) >=
		totalEvaluatorRuntimeMicros * BigInt(COMPILER_GYM_PROXY_CASCADE_REPLAY_SAVING_THRESHOLD.numerator);
	const result: CompilerGymProxyCascadeReplayResult = {
		schemaVersion: 1,
		protocol: COMPILER_GYM_PROXY_CASCADE_REPLAY_PROTOCOL,
		selectionProtocol: COMPILER_GYM_PROXY_CASCADE_SELECTION_PROTOCOL,
		classification: "retrospective-development-only-not-a-causal-counterfactual",
		inputManifest: COMPILER_GYM_PROXY_CASCADE_FROZEN_REPLAY_SOURCES.map((source) => ({
			...source,
			measurementCount: 4,
		})),
		trajectories,
		summary: {
			trajectoryCount: trajectories.length,
			candidateCount: candidates.length,
			uniqueCandidateDigestCount: new Set(candidates.map((candidate) => candidate.candidateSha256)).size,
			selectedCandidateCount,
			omittedCandidateCount: candidates.length - selectedCandidateCount,
			frontierCandidateCount,
			retainedFrontierCandidateCount,
			twoCandidateTrajectoryCount: trajectories.filter((trajectory) => trajectory.selectedOrdinals.length === 2)
				.length,
			tieExpandedTrajectoryCount: trajectories.filter((trajectory) => trajectory.selectionExpandedByTies).length,
			totalEvaluatorRuntimeMicros: totalEvaluatorRuntimeMicros.toString(10),
			retainedEvaluatorRuntimeMicros: retainedEvaluatorRuntimeMicros.toString(10),
			omittedBzip2EvaluatorRuntimeMicros: omittedBzip2EvaluatorRuntimeMicros.toString(10),
			savingFraction: {
				numerator: omittedBzip2EvaluatorRuntimeMicros.toString(10),
				denominator: totalEvaluatorRuntimeMicros.toString(10),
			},
		},
		gate: {
			allTrajectoryFrontiersRetained,
			savingThresholdPassed,
			passed: allTrajectoryFrontiersRetained && savingThresholdPassed,
			threshold: COMPILER_GYM_PROXY_CASCADE_REPLAY_SAVING_THRESHOLD,
			claimLimits: {
				prospectivePolicyEvidence: false,
				causalTimingEvidence: false,
				independentTrajectoryAssumption: false,
			},
		},
	};
	assertFrozenReplayOutcome(result);
	return result;
}

export function projectCompilerGymProxyCascadeReplay(
	replay: CompilerGymProxyCascadeReplayResult,
): CompilerGymProxyCascadeRestrictedTrajectoryProjection[] {
	if (!replay.gate.passed) throw new Error("Proxy-cascade replay must pass before trajectory projection");
	return replay.trajectories.map((trajectory) => {
		const candidates = trajectory.candidates.map((candidate) => ({
			ordinal: candidate.ordinal,
			candidateSha256: candidate.candidateSha256,
			proxyAccepted: true as const,
			blowfishIrInstructionCount: candidate.blowfish.irInstructionCount,
		}));
		const uniqueCandidateDigests = new Set(candidates.map((candidate) => candidate.candidateSha256)).size === 4;
		const distinctProxyScores =
			new Set(candidates.map((candidate) => candidate.blowfishIrInstructionCount)).size === 4;
		return {
			path: trajectory.path,
			candidates,
			uniqueCandidateDigests,
			distinctProxyScores,
			eligibleForUntiedQualification: uniqueCandidateDigests && distinctProxyScores,
		};
	});
}

function asciiCompare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function selectCompilerGymProxyCascadeTrajectory(
	replay: CompilerGymProxyCascadeReplayResult,
): CompilerGymProxyCascadeSelectedTrajectory {
	const projections = projectCompilerGymProxyCascadeReplay(replay);
	const selectedProjection = [...projections]
		.filter((projection) => projection.eligibleForUntiedQualification)
		.sort((left, right) => asciiCompare(left.path, right.path))[0];
	if (!selectedProjection) throw new Error("Proxy-cascade replay has no untied qualification trajectory");
	if (selectedProjection.path !== COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY.selectedTrajectoryPath) {
		throw new Error("Proxy-cascade restricted trajectory selection drifted");
	}
	const selection = selectCompilerGymProxyCascadeOrdinals(selectedProjection.candidates);
	const selectedOrdinals = selection.selectedOrdinals;
	const omittedOrdinals = selection.omittedOrdinals;
	exactJson(selectedOrdinals, COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY.selectedOrdinals, "selected ordinals");
	exactJson(omittedOrdinals, COMPILER_GYM_PROXY_CASCADE_EXPECTED_REPLAY.omittedOrdinals, "omitted ordinals");
	const trajectory = replay.trajectories.find((candidate) => candidate.path === selectedProjection.path);
	if (!trajectory) throw new Error("Proxy-cascade selected trajectory disappeared after restricted projection");
	return {
		selectionMethod: "ascii-path-first-over-restricted-eligible-projection",
		path: trajectory.path,
		ledgerSha256: trajectory.ledgerSha256,
		terminalEventHash: trajectory.terminalEventHash,
		selectedOrdinals,
		omittedOrdinals,
		candidates: structuredClone(trajectory.candidates),
		restrictedProjectionSha256: sha256Json(selectedProjection),
	};
}

export function buildCompilerGymProxyCascadePhasePlan(
	selected: CompilerGymProxyCascadeSelectedTrajectory,
): CompilerGymProxyCascadePhasePlan {
	if (selected.candidates.length !== 4) throw new Error("Proxy-cascade phase plan requires four candidates");
	if (selected.selectedOrdinals.length !== 2 || selected.omittedOrdinals.length !== 2) {
		throw new Error("Proxy-cascade phase plan requires an exact two/two split");
	}
	const allocations: CompilerGymProxyCascadeAllocationSpec[] = [];
	for (const candidate of [...selected.candidates].sort((left, right) => left.ordinal - right.ordinal)) {
		allocations.push({
			allocationOrdinal: allocations.length + 1,
			phase: "proxy-blowfish",
			candidateOrdinal: candidate.ordinal,
			benchmarkId: COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
			visibility: "cascade-evidence",
			requiresRemoteLock: "global",
		});
	}
	for (const candidateOrdinal of selected.selectedOrdinals) {
		allocations.push({
			allocationOrdinal: allocations.length + 1,
			phase: "selected-bzip2",
			candidateOrdinal,
			benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
			visibility: "cascade-evidence",
			requiresRemoteLock: "selection",
		});
	}
	for (const candidateOrdinal of selected.omittedOrdinals) {
		allocations.push({
			allocationOrdinal: allocations.length + 1,
			phase: "omitted-bzip2-audit",
			candidateOrdinal,
			benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
			visibility: "audit-only-agent-inaccessible",
			requiresRemoteLock: "cascade",
		});
	}
	return {
		protocol: COMPILER_GYM_PROXY_CASCADE_PHASE_PLAN_PROTOCOL,
		allocations,
		selectedOrdinals: [...selected.selectedOrdinals],
		omittedOrdinals: [...selected.omittedOrdinals],
		phaseCounts: { proxyBlowfish: 4, selectedBzip2: 2, omittedBzip2Audit: 2, total: 8 },
		counterfactualCascadeAllocationCount: 6,
		actualQualificationAllocationCount: 8,
	};
}

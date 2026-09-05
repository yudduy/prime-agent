import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import {
	COMPILER_GYM_LATE_NOVELTY_ANALYSIS_PATH as PINNED_LATENCY_ANALYSIS_PATH,
	COMPILER_GYM_LATE_NOVELTY_ANALYSIS_SHA256 as PINNED_LATENCY_ANALYSIS_SHA256,
} from "./compiler-gym-late-novelty-headroom.js";
import { type LedgerEvent, verifyLedgerContentsStrict } from "./ledger.js";

export const COMPILER_GYM_PROXY_CASCADE_ANALYSIS_ID = "compiler-gym-proxy-cascade-headroom-v1" as const;
export const COMPILER_GYM_PROXY_CASCADE_EXPECTED_TRAJECTORIES = 13;
export const COMPILER_GYM_PROXY_CASCADE_MIN_EVALUATOR_TIME_SAVING = 0.25;
export const COMPILER_GYM_PROXY_CASCADE_EXCLUDED_SCRIPTED_LEDGER =
	"r-resurrection-qualification/2026-08-28-v1/evidence.jsonl" as const;
export const COMPILER_GYM_PROXY_CASCADE_QUALIFICATION_LEDGER_PATH =
	"stock-interface-pair-screen/2026-08-28-block-v1/stock/evaluation/evidence.jsonl" as const;

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const BLOWFISH = "benchmark://cbench-v1/blowfish" as const;
const BZIP2 = "benchmark://cbench-v1/bzip2" as const;
const TASKS = [BLOWFISH, BZIP2] as const;
const EXPECTED_INPUT_LEDGER_COUNT = 21;
const ROUNDING_DECIMALS = 3;
const FRACTION_DECIMALS = 6;

type TaskId = (typeof TASKS)[number];

interface PinnedLedger {
	path: string;
	sha256: string;
	eventCount: number;
	measurementCount: number;
	terminalEventHash: string;
}

interface ProposalBinding {
	ordinal: number;
	jobId: string;
	manifestDigest: string;
	candidateDigest: string;
	candidateByteLength: number;
	candidateMediaType: string;
}

export interface CompilerGymProxyCascadeCandidate {
	ordinal: number;
	jobId: string;
	manifestDigest: string;
	candidateDigest: string;
	candidateByteLength: number;
	candidateActionCount: number;
	blowfishIr: number;
	bzip2Ir: number;
	blowfishEvaluatorMs: number;
	bzip2EvaluatorMs: number;
	blowfishWallMs: number;
	bzip2WallMs: number;
}

export interface CompilerGymProxyCascadeLedgerSource {
	path: string;
	contents: string;
	artifacts: Readonly<
		Record<
			string,
			{
				contents: string;
				mode: number;
				regularFile: boolean;
			}
		>
	>;
}

export interface CompilerGymProxyCascadeSources {
	latencyAnalysisContents: string;
	ledgers: readonly CompilerGymProxyCascadeLedgerSource[];
}

export interface CompilerGymProxyCascadeTrajectory {
	ledgerPath: string;
	candidateCount: 4;
	proxyRule: "two-lowest-distinct-blowfish-ir-tiers-including-all-ties";
	selectedProxyTiers: number[];
	selectedOrdinals: number[];
	selectedJobIds: string[];
	paretoFrontierOrdinals: number[];
	paretoFrontierJobIds: string[];
	paretoFrontierRetained: boolean;
	skippedBzip2Evaluations: number;
	fullTaskAllocations: number;
	cascadeTaskAllocations: number;
	fullEvaluatorMs: number;
	cascadeEvaluatorMs: number;
	evaluatorTimeSavedMs: number;
	evaluatorTimeSavingFraction: number;
	observedCoRunCriticalWallMs: number;
	sequentialStagedWallProxyMs: number;
	optimisticFanoutWallProxyMs: number;
	sequentialStagedVsObservedFraction: number;
	optimisticFanoutSavingFraction: number;
	candidates: CompilerGymProxyCascadeCandidate[];
}

export interface CompilerGymProxyCascadeAggregate {
	trajectoryCount: number;
	allParetoFrontiersRetained: boolean;
	skippedBzip2Evaluations: number;
	fullTaskAllocations: number;
	cascadeTaskAllocations: number;
	taskAllocationReductionFraction: number;
	fullEvaluatorMs: number;
	cascadeEvaluatorMs: number;
	evaluatorTimeSavedMs: number;
	evaluatorTimeSavingFraction: number;
	observedCoRunCriticalWallMs: number;
	sequentialStagedWallProxyMs: number;
	optimisticFanoutWallProxyMs: number;
	sequentialStagedVsObservedFraction: number;
	optimisticFanoutSavingFraction: number;
}

export interface CompilerGymProxyCascadeQualificationSelection {
	eligibleLedgerPaths: string[];
	selected: CompilerGymProxyCascadeTrajectory;
}

export interface CompilerGymProxyCascadeHeadroomResult {
	schemaVersion: 1;
	analysisId: typeof COMPILER_GYM_PROXY_CASCADE_ANALYSIS_ID;
	classification: "development-informed-retrospective-headroom-not-treatment-evidence";
	pinnedLatencyAnalysis: {
		path: typeof PINNED_LATENCY_ANALYSIS_PATH;
		sha256: typeof PINNED_LATENCY_ANALYSIS_SHA256;
	};
	policy: {
		proxyTask: typeof BLOWFISH;
		deferredTask: typeof BZIP2;
		selection: "two-lowest-distinct-proxy-tiers-including-all-ties";
		tiePolicy: "retain-all-ties";
		orderingField: "candidate-ordinal";
		selectionInputs: readonly ["blowfishIr", "ordinal"];
		forbiddenSelectionInputs: readonly [
			"jobId",
			"manifestDigest",
			"candidateDigest",
			"candidateByteLength",
			"candidateActionCount",
			"bzip2Ir",
			"blowfishEvaluatorMs",
			"bzip2EvaluatorMs",
			"blowfishWallMs",
			"bzip2WallMs",
		];
		frontier: "two-task-strict-pareto-lower-is-better";
		timing: "sum-of-recorded-evaluator-runtime-ms";
	};
	inclusion: {
		inputLedgerCount: 21;
		requireExactlyFourProposalsAndMeasurements: true;
		requirePopulatedRunManifestModel: true;
		requireCanonicalMode0600CandidateArtifacts: true;
		excludeScriptedQualificationLedger: typeof COMPILER_GYM_PROXY_CASCADE_EXCLUDED_SCRIPTED_LEDGER;
		rationale: "four-candidate-agent-or-model-trajectories-only";
	};
	inputLedgers: PinnedLedger[];
	trajectories: CompilerGymProxyCascadeTrajectory[];
	aggregate: CompilerGymProxyCascadeAggregate;
	sensitivityIncludingScriptedQualification: {
		classification: "all-four-candidate-ledgers";
		trajectories: CompilerGymProxyCascadeTrajectory[];
		aggregate: CompilerGymProxyCascadeAggregate;
	};
	modelFreeQualificationCandidateSet: {
		classification: "known-happy-path-apparatus-only";
		selection: "ascii-lexicographically-first-agent-trajectory-with-four-unique-candidate-digests-and-four-distinct-blowfish-ir-values";
		selectionInputs: readonly ["ledgerPath", "candidateDigest", "blowfishIr"];
		forbiddenSelectionInputs: readonly [
			"jobId",
			"manifestDigest",
			"candidateByteLength",
			"candidateActionCount",
			"bzip2Ir",
			"blowfishEvaluatorMs",
			"bzip2EvaluatorMs",
			"blowfishWallMs",
			"bzip2WallMs",
			"paretoFrontier",
		];
		eligibleLedgerPaths: string[];
		selectedLedgerPath: typeof COMPILER_GYM_PROXY_CASCADE_QUALIFICATION_LEDGER_PATH;
		candidates: Array<{
			ordinal: number;
			candidateDigest: string;
			candidateByteLength: number;
			candidateActionCount: number;
			historicalBlowfishIr: number;
		}>;
		historicalSelectedOrdinals: number[];
	};
	limitations: {
		policySelectedRetrospectivelyOnSameCohort: true;
		historicalLaterCandidatesSawDeferredTaskFeedback: true;
		evaluatorTimeSavingIsNotFeedbackLatency: true;
		stagedWallModelsAreRetrospectiveAndNoncausal: true;
		sequentialStagedWallProxyIsSlower: true;
		optimisticFanoutSavingBelow25Percent: true;
	};
	gates: {
		exactThirteenAgentTrajectories: boolean;
		allThirteenParetoFrontiersRetained: boolean;
		evaluatorTimeSavingAtLeast25Percent: boolean;
	};
	eligibleForModelFreeSystemsQualification: boolean;
	authorizations: {
		modelFreeSystemsQualification: boolean;
		feedbackLatencyImprovement: false;
		provider: false;
		paid: false;
		harnessTreatment: false;
		gpu: false;
		nanogpt: false;
		defaultPromotion: false;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function nonemptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
	return value;
}

function sha256(value: unknown, path: string): string {
	const parsed = nonemptyString(value, path);
	if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`${path} must be a lowercase SHA-256`);
	return parsed;
}

function nonnegativeSafeInteger(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative safe integer`);
	}
	return value;
}

function nonnegativeFiniteNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${path} must be a nonnegative finite number`);
	}
	return value;
}

function rounded(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

function asciiCompare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(value: unknown, path: string): string {
	const parsed = nonemptyString(value, path);
	if (
		parsed.startsWith("/") ||
		parsed.includes("\\") ||
		parsed.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
	) {
		throw new Error(`${path} must be a normalized portable relative path`);
	}
	return parsed;
}

function parsePinnedAnalysis(contents: string): { ledgerRoot: string; inputLedgers: PinnedLedger[] } {
	if (sha256Text(contents) !== PINNED_LATENCY_ANALYSIS_SHA256) {
		throw new Error("Pinned CompilerGym latency analysis hash drifted");
	}
	const root = record(JSON.parse(contents) as unknown, "latency analysis");
	if (root.schemaVersion !== 1 || root.analysisId !== "compiler-gym-allocation-latency-v1") {
		throw new Error("Pinned CompilerGym latency analysis identity drifted");
	}
	const ledgerRoot = portablePath(root.ledgerRoot, "latency analysis.ledgerRoot");
	if (ledgerRoot !== ".autoresearch") throw new Error("Pinned CompilerGym latency ledger root drifted");
	if (!Array.isArray(root.inputLedgers) || root.inputLedgers.length !== EXPECTED_INPUT_LEDGER_COUNT) {
		throw new Error(`Pinned latency analysis must contain ${EXPECTED_INPUT_LEDGER_COUNT} input ledgers`);
	}
	const paths = new Set<string>();
	const inputLedgers = root.inputLedgers.map((value, index): PinnedLedger => {
		const input = record(value, `latency analysis.inputLedgers[${index}]`);
		const path = portablePath(input.path, `latency analysis.inputLedgers[${index}].path`);
		if (paths.has(path)) throw new Error(`Pinned latency analysis repeats ${path}`);
		paths.add(path);
		return {
			path,
			sha256: sha256(input.sha256, `${path}.sha256`),
			eventCount: nonnegativeSafeInteger(input.eventCount, `${path}.eventCount`),
			measurementCount: nonnegativeSafeInteger(input.measurementCount, `${path}.measurementCount`),
			terminalEventHash: sha256(input.terminalEventHash, `${path}.terminalEventHash`),
		};
	});
	return { ledgerRoot, inputLedgers };
}

function parseProposal(event: LedgerEvent, ledgerPath: string, ordinal: number): ProposalBinding {
	const payload = record(event.payload, `${ledgerPath}:proposal[${ordinal}]`);
	const candidate = record(payload.candidate, `${ledgerPath}:proposal[${ordinal}].candidate`);
	const candidateDigest = sha256(candidate.digest, `${ledgerPath}:proposal[${ordinal}].candidate.digest`);
	const candidateByteLength = nonnegativeSafeInteger(
		candidate.byteLength,
		`${ledgerPath}:proposal[${ordinal}].candidate.byteLength`,
	);
	const candidateMediaType = nonemptyString(
		candidate.mediaType,
		`${ledgerPath}:proposal[${ordinal}].candidate.mediaType`,
	);
	return {
		ordinal,
		jobId: nonemptyString(payload.jobId, `${ledgerPath}:proposal[${ordinal}].jobId`),
		manifestDigest: sha256(payload.manifestDigest, `${ledgerPath}:proposal[${ordinal}].manifestDigest`),
		candidateDigest,
		candidateByteLength,
		candidateMediaType,
	};
}

function verifyCandidateArtifact(
	artifact: CompilerGymProxyCascadeLedgerSource["artifacts"][string] | undefined,
	proposal: ProposalBinding,
	ledgerPath: string,
): number {
	if (!artifact) throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact is missing`);
	if (!artifact.regularFile || artifact.mode !== 0o600) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact must be a regular mode-0600 file`);
	}
	if (proposal.candidateMediaType !== "application/vnd.prime.llvm-pass-sequence") {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate media type drifted`);
	}
	if (sha256Text(artifact.contents) !== proposal.candidateDigest) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact hash drifted`);
	}
	if (Buffer.byteLength(artifact.contents) !== proposal.candidateByteLength) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact byte length drifted`);
	}
	const parsed: unknown = JSON.parse(artifact.contents);
	if (
		!Array.isArray(parsed) ||
		parsed.length === 0 ||
		parsed.length > 256 ||
		!parsed.every((value) => typeof value === "string" && /^-[a-z0-9-]+$/.test(value))
	) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact is not a bounded LLVM action array`);
	}
	if (JSON.stringify(parsed) !== artifact.contents) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact is not canonical compact JSON`);
	}
	return parsed.length;
}

function parseTask(
	value: unknown,
	ledgerPath: string,
	jobId: string,
): { taskId: TaskId; ir: number; evaluatorMs: number; wallMs: number } {
	const task = record(value, `${ledgerPath}:${jobId}.task`);
	const benchmarkId = nonemptyString(task.benchmarkId, `${ledgerPath}:${jobId}.task.benchmarkId`);
	if (benchmarkId !== BLOWFISH && benchmarkId !== BZIP2) {
		throw new Error(`${ledgerPath}:${jobId} has unexpected task ${benchmarkId}`);
	}
	if (task.status !== "accepted") throw new Error(`${ledgerPath}:${jobId}:${benchmarkId} is not accepted`);
	const verifier = record(task.verifier, `${ledgerPath}:${jobId}:${benchmarkId}.verifier`);
	if (verifier.passed !== true) throw new Error(`${ledgerPath}:${jobId}:${benchmarkId} verifier did not pass`);
	const metrics = record(task.metrics, `${ledgerPath}:${jobId}:${benchmarkId}.metrics`);
	return {
		taskId: benchmarkId,
		ir: nonnegativeSafeInteger(
			metrics.IrInstructionCount,
			`${ledgerPath}:${jobId}:${benchmarkId}.IrInstructionCount`,
		),
		evaluatorMs: nonnegativeFiniteNumber(
			metrics.evaluatorRuntimeMs,
			`${ledgerPath}:${jobId}:${benchmarkId}.evaluatorRuntimeMs`,
		),
		wallMs: nonnegativeFiniteNumber(
			metrics.schedulerAndEvaluatorWallMs,
			`${ledgerPath}:${jobId}:${benchmarkId}.schedulerAndEvaluatorWallMs`,
		),
	};
}

function parseCandidate(
	event: LedgerEvent,
	proposal: ProposalBinding,
	ledgerPath: string,
): Omit<CompilerGymProxyCascadeCandidate, "candidateActionCount"> {
	const payload = record(event.payload, `${ledgerPath}:measurement[${proposal.ordinal}]`);
	if (Object.hasOwn(payload, "reuse"))
		throw new Error(`${ledgerPath}:${proposal.jobId} is reused measurement evidence`);
	const jobId = nonemptyString(payload.jobId, `${ledgerPath}:measurement.jobId`);
	const manifestDigest = sha256(payload.manifestDigest, `${ledgerPath}:${jobId}.manifestDigest`);
	if (jobId !== proposal.jobId || manifestDigest !== proposal.manifestDigest) {
		throw new Error(`${ledgerPath}:proposal/measurement binding drifted at ordinal ${proposal.ordinal}`);
	}
	if (!Array.isArray(payload.tasks) || payload.tasks.length !== TASKS.length) {
		throw new Error(`${ledgerPath}:${jobId} must contain exactly two task measurements`);
	}
	const byTask = new Map<TaskId, { ir: number; evaluatorMs: number; wallMs: number }>();
	for (const taskValue of payload.tasks) {
		const task = parseTask(taskValue, ledgerPath, jobId);
		if (byTask.has(task.taskId)) throw new Error(`${ledgerPath}:${jobId} repeats ${task.taskId}`);
		byTask.set(task.taskId, { ir: task.ir, evaluatorMs: task.evaluatorMs, wallMs: task.wallMs });
	}
	const blowfish = byTask.get(BLOWFISH);
	const bzip2 = byTask.get(BZIP2);
	if (!blowfish || !bzip2) throw new Error(`${ledgerPath}:${jobId} task coverage drifted`);
	return {
		ordinal: proposal.ordinal,
		jobId,
		manifestDigest,
		candidateDigest: proposal.candidateDigest,
		candidateByteLength: proposal.candidateByteLength,
		blowfishIr: blowfish.ir,
		bzip2Ir: bzip2.ir,
		blowfishEvaluatorMs: blowfish.evaluatorMs,
		bzip2EvaluatorMs: bzip2.evaluatorMs,
		blowfishWallMs: blowfish.wallMs,
		bzip2WallMs: bzip2.wallMs,
	};
}

export function selectProxyCascadeCandidates(
	candidates: readonly CompilerGymProxyCascadeCandidate[],
): CompilerGymProxyCascadeCandidate[] {
	if (candidates.length === 0) throw new Error("Proxy cascade requires at least one candidate");
	const ordinals = new Set<number>();
	for (const candidate of candidates) {
		if (!Number.isSafeInteger(candidate.ordinal) || candidate.ordinal < 1 || ordinals.has(candidate.ordinal)) {
			throw new Error("Proxy cascade candidate ordinals must be unique positive safe integers");
		}
		if (!Number.isSafeInteger(candidate.blowfishIr) || candidate.blowfishIr < 0) {
			throw new Error("Proxy cascade blowfish IR values must be nonnegative safe integers");
		}
		ordinals.add(candidate.ordinal);
	}
	const selectedTiers = [...new Set(candidates.map((candidate) => candidate.blowfishIr))]
		.sort((left, right) => left - right)
		.slice(0, 2);
	const selectedTierSet = new Set(selectedTiers);
	return candidates
		.filter((candidate) => selectedTierSet.has(candidate.blowfishIr))
		.sort((left, right) => left.ordinal - right.ordinal);
}

function dominates(left: CompilerGymProxyCascadeCandidate, right: CompilerGymProxyCascadeCandidate): boolean {
	return (
		left.blowfishIr <= right.blowfishIr &&
		left.bzip2Ir <= right.bzip2Ir &&
		(left.blowfishIr < right.blowfishIr || left.bzip2Ir < right.bzip2Ir)
	);
}

export function proxyCascadeParetoFrontier(
	candidates: readonly CompilerGymProxyCascadeCandidate[],
): CompilerGymProxyCascadeCandidate[] {
	return candidates
		.filter(
			(candidate) => !candidates.some((other) => other.jobId !== candidate.jobId && dominates(other, candidate)),
		)
		.sort((left, right) => left.ordinal - right.ordinal);
}

export function selectProxyCascadeQualificationTrajectory(
	trajectories: readonly CompilerGymProxyCascadeTrajectory[],
): CompilerGymProxyCascadeQualificationSelection {
	const eligible = trajectories
		.filter(
			(trajectory) =>
				trajectory.candidates.length === 4 &&
				new Set(trajectory.candidates.map((candidate) => candidate.candidateDigest)).size === 4 &&
				new Set(trajectory.candidates.map((candidate) => candidate.blowfishIr)).size === 4,
		)
		.sort((left, right) => asciiCompare(left.ledgerPath, right.ledgerPath));
	const selected = eligible[0];
	if (!selected) throw new Error("No proxy-cascade trajectory qualifies for the model-free apparatus check");
	return { eligibleLedgerPaths: eligible.map((trajectory) => trajectory.ledgerPath), selected };
}

function reconstructTrajectory(source: CompilerGymProxyCascadeLedgerSource): CompilerGymProxyCascadeTrajectory | null {
	const events = verifyLedgerContentsStrict(source.contents);
	const proposalEvents = events.filter((event) => event.kind === "proposal");
	const measurementEvents = events.filter((event) => event.kind === "measurement");
	if (proposalEvents.length !== 4 && measurementEvents.length !== 4) return null;
	if (proposalEvents.length !== 4 || measurementEvents.length !== 4) {
		throw new Error(`${source.path}:four-candidate trajectory has mismatched proposal and measurement counts`);
	}
	const proposals = proposalEvents.map((event, index) => parseProposal(event, source.path, index + 1));
	if (new Set(proposals.map((proposal) => proposal.jobId)).size !== proposals.length) {
		throw new Error(`${source.path}:proposal job IDs are not unique`);
	}
	const expectedArtifactDigests = [...new Set(proposals.map((proposal) => proposal.candidateDigest))].sort(
		asciiCompare,
	);
	const observedArtifactDigests = Object.keys(source.artifacts).sort(asciiCompare);
	if (JSON.stringify(observedArtifactDigests) !== JSON.stringify(expectedArtifactDigests)) {
		throw new Error(`${source.path}:candidate artifact set differs from the four proposals`);
	}
	const actionCountByDigest = new Map(
		proposals.map((proposal) => [
			proposal.candidateDigest,
			verifyCandidateArtifact(source.artifacts[proposal.candidateDigest], proposal, source.path),
		]),
	);
	const measurementByJobId = new Map<string, LedgerEvent>();
	for (const event of measurementEvents) {
		const payload = record(event.payload, `${source.path}:measurement`);
		const jobId = nonemptyString(payload.jobId, `${source.path}:measurement.jobId`);
		if (measurementByJobId.has(jobId)) throw new Error(`${source.path}:measurement job IDs are not unique`);
		measurementByJobId.set(jobId, event);
	}
	const proposalByJobId = new Map(proposals.map((proposal) => [proposal.jobId, proposal]));
	const candidates = measurementEvents.map((event, index) => {
		const payload = record(event.payload, `${source.path}:measurement[${index + 1}]`);
		const jobId = nonemptyString(payload.jobId, `${source.path}:measurement[${index + 1}].jobId`);
		const proposal = proposalByJobId.get(jobId);
		if (!proposal) throw new Error(`${source.path}:${jobId} lacks a proposal`);
		const candidate = parseCandidate(event, { ...proposal, ordinal: index + 1 }, source.path);
		const candidateActionCount = actionCountByDigest.get(proposal.candidateDigest);
		if (candidateActionCount === undefined) throw new Error(`${source.path}:${jobId} lost its action count`);
		return { ...candidate, candidateActionCount };
	});
	if (measurementByJobId.size !== candidates.length)
		throw new Error(`${source.path}:measurement set exceeds proposal set`);
	const selected = selectProxyCascadeCandidates(candidates);
	const frontier = proxyCascadeParetoFrontier(candidates);
	const selectedIds = new Set(selected.map((candidate) => candidate.jobId));
	const fullEvaluatorMs = candidates.reduce(
		(total, candidate) => total + candidate.blowfishEvaluatorMs + candidate.bzip2EvaluatorMs,
		0,
	);
	const cascadeEvaluatorMs =
		candidates.reduce((total, candidate) => total + candidate.blowfishEvaluatorMs, 0) +
		selected.reduce((total, candidate) => total + candidate.bzip2EvaluatorMs, 0);
	const evaluatorTimeSavedMs = fullEvaluatorMs - cascadeEvaluatorMs;
	const observedCoRunCriticalWallMs = candidates.reduce(
		(total, candidate) => total + Math.max(candidate.blowfishWallMs, candidate.bzip2WallMs),
		0,
	);
	const blowfishStageWallMs = candidates.reduce((total, candidate) => total + candidate.blowfishWallMs, 0);
	const sequentialStagedWallProxyMs =
		blowfishStageWallMs + selected.reduce((total, candidate) => total + candidate.bzip2WallMs, 0);
	const optimisticFanoutWallProxyMs =
		blowfishStageWallMs + Math.max(...selected.map((candidate) => candidate.bzip2WallMs));
	if (!(fullEvaluatorMs > 0) || !(observedCoRunCriticalWallMs > 0)) {
		throw new Error(`${source.path}:proxy-cascade timing denominators must be positive`);
	}
	const selectedProxyTiers = [...new Set(selected.map((candidate) => candidate.blowfishIr))].sort(
		(left, right) => left - right,
	);
	return {
		ledgerPath: source.path,
		candidateCount: 4,
		proxyRule: "two-lowest-distinct-blowfish-ir-tiers-including-all-ties",
		selectedProxyTiers,
		selectedOrdinals: selected.map((candidate) => candidate.ordinal),
		selectedJobIds: selected.map((candidate) => candidate.jobId),
		paretoFrontierOrdinals: frontier.map((candidate) => candidate.ordinal),
		paretoFrontierJobIds: frontier.map((candidate) => candidate.jobId),
		paretoFrontierRetained: frontier.every((candidate) => selectedIds.has(candidate.jobId)),
		skippedBzip2Evaluations: candidates.length - selected.length,
		fullTaskAllocations: candidates.length * 2,
		cascadeTaskAllocations: candidates.length + selected.length,
		fullEvaluatorMs: rounded(fullEvaluatorMs, ROUNDING_DECIMALS),
		cascadeEvaluatorMs: rounded(cascadeEvaluatorMs, ROUNDING_DECIMALS),
		evaluatorTimeSavedMs: rounded(evaluatorTimeSavedMs, ROUNDING_DECIMALS),
		evaluatorTimeSavingFraction: rounded(evaluatorTimeSavedMs / fullEvaluatorMs, FRACTION_DECIMALS),
		observedCoRunCriticalWallMs: rounded(observedCoRunCriticalWallMs, ROUNDING_DECIMALS),
		sequentialStagedWallProxyMs: rounded(sequentialStagedWallProxyMs, ROUNDING_DECIMALS),
		optimisticFanoutWallProxyMs: rounded(optimisticFanoutWallProxyMs, ROUNDING_DECIMALS),
		sequentialStagedVsObservedFraction: rounded(
			(sequentialStagedWallProxyMs - observedCoRunCriticalWallMs) / observedCoRunCriticalWallMs,
			FRACTION_DECIMALS,
		),
		optimisticFanoutSavingFraction: rounded(
			(observedCoRunCriticalWallMs - optimisticFanoutWallProxyMs) / observedCoRunCriticalWallMs,
			FRACTION_DECIMALS,
		),
		candidates,
	};
}

function aggregate(trajectories: readonly CompilerGymProxyCascadeTrajectory[]): CompilerGymProxyCascadeAggregate {
	if (trajectories.length === 0) throw new Error("Cannot aggregate an empty proxy-cascade cohort");
	const fullTaskAllocations = trajectories.reduce((total, trajectory) => total + trajectory.fullTaskAllocations, 0);
	const cascadeTaskAllocations = trajectories.reduce(
		(total, trajectory) => total + trajectory.cascadeTaskAllocations,
		0,
	);
	const fullEvaluatorMs = trajectories.reduce((total, trajectory) => total + trajectory.fullEvaluatorMs, 0);
	const cascadeEvaluatorMs = trajectories.reduce((total, trajectory) => total + trajectory.cascadeEvaluatorMs, 0);
	const evaluatorTimeSavedMs = fullEvaluatorMs - cascadeEvaluatorMs;
	const observedCoRunCriticalWallMs = trajectories.reduce(
		(total, trajectory) => total + trajectory.observedCoRunCriticalWallMs,
		0,
	);
	const sequentialStagedWallProxyMs = trajectories.reduce(
		(total, trajectory) => total + trajectory.sequentialStagedWallProxyMs,
		0,
	);
	const optimisticFanoutWallProxyMs = trajectories.reduce(
		(total, trajectory) => total + trajectory.optimisticFanoutWallProxyMs,
		0,
	);
	if (!(fullEvaluatorMs > 0) || !(observedCoRunCriticalWallMs > 0)) {
		throw new Error("Proxy-cascade aggregate timing denominators must be positive");
	}
	return {
		trajectoryCount: trajectories.length,
		allParetoFrontiersRetained: trajectories.every((trajectory) => trajectory.paretoFrontierRetained),
		skippedBzip2Evaluations: trajectories.reduce(
			(total, trajectory) => total + trajectory.skippedBzip2Evaluations,
			0,
		),
		fullTaskAllocations,
		cascadeTaskAllocations,
		taskAllocationReductionFraction: rounded(
			(fullTaskAllocations - cascadeTaskAllocations) / fullTaskAllocations,
			FRACTION_DECIMALS,
		),
		fullEvaluatorMs: rounded(fullEvaluatorMs, ROUNDING_DECIMALS),
		cascadeEvaluatorMs: rounded(cascadeEvaluatorMs, ROUNDING_DECIMALS),
		evaluatorTimeSavedMs: rounded(evaluatorTimeSavedMs, ROUNDING_DECIMALS),
		evaluatorTimeSavingFraction: rounded(evaluatorTimeSavedMs / fullEvaluatorMs, FRACTION_DECIMALS),
		observedCoRunCriticalWallMs: rounded(observedCoRunCriticalWallMs, ROUNDING_DECIMALS),
		sequentialStagedWallProxyMs: rounded(sequentialStagedWallProxyMs, ROUNDING_DECIMALS),
		optimisticFanoutWallProxyMs: rounded(optimisticFanoutWallProxyMs, ROUNDING_DECIMALS),
		sequentialStagedVsObservedFraction: rounded(
			(sequentialStagedWallProxyMs - observedCoRunCriticalWallMs) / observedCoRunCriticalWallMs,
			FRACTION_DECIMALS,
		),
		optimisticFanoutSavingFraction: rounded(
			(observedCoRunCriticalWallMs - optimisticFanoutWallProxyMs) / observedCoRunCriticalWallMs,
			FRACTION_DECIMALS,
		),
	};
}

function hasPopulatedStartRunManifestModel(contents: string): boolean {
	const startManifests = verifyLedgerContentsStrict(contents).filter((event) => {
		if (event.kind !== "run_manifest") return false;
		const payload = record(event.payload, "run_manifest");
		return payload.phase === "start";
	});
	if (startManifests.length !== 1 || startManifests[0]?.sequence !== 0) {
		throw new Error("Four-candidate ledger must contain exactly one sequence-zero start run manifest");
	}
	const payload = record(startManifests[0].payload, "start run_manifest");
	return typeof payload.model === "string" && payload.model.trim().length > 0;
}

export function analyzeCompilerGymProxyCascadeHeadroom(
	sources: CompilerGymProxyCascadeSources,
): CompilerGymProxyCascadeHeadroomResult {
	const pinned = parsePinnedAnalysis(sources.latencyAnalysisContents);
	const sourceByPath = new Map(sources.ledgers.map((source) => [source.path, source]));
	if (sourceByPath.size !== sources.ledgers.length) throw new Error("Duplicate proxy-cascade ledger source");
	if (
		sourceByPath.size !== pinned.inputLedgers.length ||
		[...sourceByPath.keys()].some((path) => !pinned.inputLedgers.some((input) => input.path === path))
	) {
		throw new Error("Proxy-cascade ledger sources differ from the pinned latency cohort");
	}
	const allFourCandidateTrajectories: Array<{
		trajectory: CompilerGymProxyCascadeTrajectory;
		hasRunManifestModel: boolean;
	}> = [];
	for (const input of pinned.inputLedgers) {
		const source = sourceByPath.get(input.path);
		if (!source) throw new Error(`Missing pinned proxy-cascade ledger ${input.path}`);
		if (sha256Text(source.contents) !== input.sha256) throw new Error(`${input.path}:pinned ledger hash drifted`);
		const events = verifyLedgerContentsStrict(source.contents);
		if (
			events.length !== input.eventCount ||
			events.filter((event) => event.kind === "measurement").length !== input.measurementCount ||
			events.at(-1)?.hash !== input.terminalEventHash
		) {
			throw new Error(`${input.path}:pinned ledger chain summary drifted`);
		}
		const trajectory = reconstructTrajectory(source);
		if (trajectory) {
			allFourCandidateTrajectories.push({
				trajectory,
				hasRunManifestModel: hasPopulatedStartRunManifestModel(source.contents),
			});
		}
	}
	allFourCandidateTrajectories.sort((left, right) =>
		asciiCompare(left.trajectory.ledgerPath, right.trajectory.ledgerPath),
	);
	const trajectories = allFourCandidateTrajectories
		.filter((entry) => entry.hasRunManifestModel)
		.map((entry) => entry.trajectory);
	const scriptedEntries = allFourCandidateTrajectories.filter((entry) => !entry.hasRunManifestModel);
	if (
		scriptedEntries.length !== 1 ||
		scriptedEntries[0]?.trajectory.ledgerPath !== COMPILER_GYM_PROXY_CASCADE_EXCLUDED_SCRIPTED_LEDGER
	) {
		throw new Error("The declared scripted sensitivity ledger is absent from the four-candidate cohort");
	}
	const sensitivityTrajectories = allFourCandidateTrajectories.map((entry) => entry.trajectory);
	const mainAggregate = aggregate(trajectories);
	const sensitivityAggregate = aggregate(sensitivityTrajectories);
	const qualificationSelection = selectProxyCascadeQualificationTrajectory(trajectories);
	if (qualificationSelection.selected.ledgerPath !== COMPILER_GYM_PROXY_CASCADE_QUALIFICATION_LEDGER_PATH) {
		throw new Error("Pinned proxy-cascade model-free qualification candidate selection drifted");
	}
	const qualificationSelectedCandidates = selectProxyCascadeCandidates(qualificationSelection.selected.candidates);
	if (qualificationSelectedCandidates.length !== 2) {
		throw new Error("Pinned proxy-cascade model-free qualification set must select exactly two candidates");
	}
	if (mainAggregate.sequentialStagedVsObservedFraction <= 0 || mainAggregate.optimisticFanoutSavingFraction >= 0.25) {
		throw new Error("Pinned proxy-cascade retrospective wall-time caveat drifted");
	}
	const gates = {
		exactThirteenAgentTrajectories: trajectories.length === COMPILER_GYM_PROXY_CASCADE_EXPECTED_TRAJECTORIES,
		allThirteenParetoFrontiersRetained:
			trajectories.length === COMPILER_GYM_PROXY_CASCADE_EXPECTED_TRAJECTORIES &&
			mainAggregate.allParetoFrontiersRetained,
		evaluatorTimeSavingAtLeast25Percent:
			mainAggregate.evaluatorTimeSavingFraction >= COMPILER_GYM_PROXY_CASCADE_MIN_EVALUATOR_TIME_SAVING,
	};
	const eligibleForModelFreeSystemsQualification = Object.values(gates).every(Boolean);
	return {
		schemaVersion: 1,
		analysisId: COMPILER_GYM_PROXY_CASCADE_ANALYSIS_ID,
		classification: "development-informed-retrospective-headroom-not-treatment-evidence",
		pinnedLatencyAnalysis: {
			path: PINNED_LATENCY_ANALYSIS_PATH,
			sha256: PINNED_LATENCY_ANALYSIS_SHA256,
		},
		policy: {
			proxyTask: BLOWFISH,
			deferredTask: BZIP2,
			selection: "two-lowest-distinct-proxy-tiers-including-all-ties",
			tiePolicy: "retain-all-ties",
			orderingField: "candidate-ordinal",
			selectionInputs: ["blowfishIr", "ordinal"],
			forbiddenSelectionInputs: [
				"jobId",
				"manifestDigest",
				"candidateDigest",
				"candidateByteLength",
				"candidateActionCount",
				"bzip2Ir",
				"blowfishEvaluatorMs",
				"bzip2EvaluatorMs",
				"blowfishWallMs",
				"bzip2WallMs",
			],
			frontier: "two-task-strict-pareto-lower-is-better",
			timing: "sum-of-recorded-evaluator-runtime-ms",
		},
		inclusion: {
			inputLedgerCount: EXPECTED_INPUT_LEDGER_COUNT,
			requireExactlyFourProposalsAndMeasurements: true,
			requirePopulatedRunManifestModel: true,
			requireCanonicalMode0600CandidateArtifacts: true,
			excludeScriptedQualificationLedger: COMPILER_GYM_PROXY_CASCADE_EXCLUDED_SCRIPTED_LEDGER,
			rationale: "four-candidate-agent-or-model-trajectories-only",
		},
		inputLedgers: pinned.inputLedgers,
		trajectories,
		aggregate: mainAggregate,
		sensitivityIncludingScriptedQualification: {
			classification: "all-four-candidate-ledgers",
			trajectories: sensitivityTrajectories,
			aggregate: sensitivityAggregate,
		},
		modelFreeQualificationCandidateSet: {
			classification: "known-happy-path-apparatus-only",
			selection:
				"ascii-lexicographically-first-agent-trajectory-with-four-unique-candidate-digests-and-four-distinct-blowfish-ir-values",
			selectionInputs: ["ledgerPath", "candidateDigest", "blowfishIr"],
			forbiddenSelectionInputs: [
				"jobId",
				"manifestDigest",
				"candidateByteLength",
				"candidateActionCount",
				"bzip2Ir",
				"blowfishEvaluatorMs",
				"bzip2EvaluatorMs",
				"blowfishWallMs",
				"bzip2WallMs",
				"paretoFrontier",
			],
			eligibleLedgerPaths: qualificationSelection.eligibleLedgerPaths,
			selectedLedgerPath: COMPILER_GYM_PROXY_CASCADE_QUALIFICATION_LEDGER_PATH,
			candidates: qualificationSelection.selected.candidates.map((candidate) => ({
				ordinal: candidate.ordinal,
				candidateDigest: candidate.candidateDigest,
				candidateByteLength: candidate.candidateByteLength,
				candidateActionCount: candidate.candidateActionCount,
				historicalBlowfishIr: candidate.blowfishIr,
			})),
			historicalSelectedOrdinals: qualificationSelectedCandidates.map((candidate) => candidate.ordinal),
		},
		limitations: {
			policySelectedRetrospectivelyOnSameCohort: true,
			historicalLaterCandidatesSawDeferredTaskFeedback: true,
			evaluatorTimeSavingIsNotFeedbackLatency: true,
			stagedWallModelsAreRetrospectiveAndNoncausal: true,
			sequentialStagedWallProxyIsSlower: true,
			optimisticFanoutSavingBelow25Percent: true,
		},
		gates,
		eligibleForModelFreeSystemsQualification,
		authorizations: {
			modelFreeSystemsQualification: eligibleForModelFreeSystemsQualification,
			feedbackLatencyImprovement: false,
			provider: false,
			paid: false,
			harnessTreatment: false,
			gpu: false,
			nanogpt: false,
			defaultPromotion: false,
		},
	};
}

export async function loadCompilerGymProxyCascadeSources(
	repoRoot = DEFAULT_REPO_ROOT,
): Promise<CompilerGymProxyCascadeSources> {
	const latencyAnalysisContents = await readFile(resolve(repoRoot, PINNED_LATENCY_ANALYSIS_PATH), "utf8");
	const pinned = parsePinnedAnalysis(latencyAnalysisContents);
	const ledgers = await Promise.all(
		pinned.inputLedgers.map(async (input): Promise<CompilerGymProxyCascadeLedgerSource> => {
			const ledgerPath = resolve(repoRoot, pinned.ledgerRoot, input.path);
			const contents = await readFile(ledgerPath, "utf8");
			const events = verifyLedgerContentsStrict(contents);
			const proposals = events
				.filter((event) => event.kind === "proposal")
				.map((event, index) => parseProposal(event, input.path, index + 1));
			const artifacts: Record<string, { contents: string; mode: number; regularFile: boolean }> = {};
			await Promise.all(
				[...new Set(proposals.map((proposal) => proposal.candidateDigest))].map(async (digest) => {
					const artifactPath = join(
						dirname(ledgerPath),
						"artifacts",
						"sha256",
						digest.slice(0, 2),
						digest.slice(2),
					);
					const [artifactContents, artifactStat] = await Promise.all([
						readFile(artifactPath, "utf8"),
						lstat(artifactPath),
					]);
					artifacts[digest] = {
						contents: artifactContents,
						mode: artifactStat.mode & 0o777,
						regularFile: artifactStat.isFile() && !artifactStat.isSymbolicLink(),
					};
				}),
			);
			return { path: input.path, contents, artifacts };
		}),
	);
	return { latencyAnalysisContents, ledgers };
}

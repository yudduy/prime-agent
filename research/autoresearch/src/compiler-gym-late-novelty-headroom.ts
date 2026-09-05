import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import {
	COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
	COMPILER_GYM_LATE_NOVELTY_THRESHOLD,
	diceLcsSimilarity,
} from "./compiler-gym-late-novelty-guidance.js";
import { type LedgerEvent, verifyLedgerContentsStrict } from "./ledger.js";

export {
	COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
	COMPILER_GYM_LATE_NOVELTY_THRESHOLD,
	diceLcsSimilarity,
	longestCommonSubsequenceLength,
} from "./compiler-gym-late-novelty-guidance.js";

export const COMPILER_GYM_LATE_NOVELTY_ANALYSIS_PATH =
	".autoresearch/compiler-gym-latency-audit/analysis-v1.json" as const;
export const COMPILER_GYM_LATE_NOVELTY_ANALYSIS_SHA256 =
	"08d50b4fdd32c8e435f9549c79030419d814a7ebaf3cb72e214e2fde0d583d73" as const;

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const TASKS = ["benchmark://cbench-v1/blowfish", "benchmark://cbench-v1/bzip2"] as const;
const EXPECTED_LEDGER_COUNT = 21;
const EXPECTED_TRANSITION_COUNT = 14;
const EXPECTED_BAND_COUNT = 7;
const MIN_DOMINATION_GAP_PERCENTAGE_POINTS = 30;

type TaskId = (typeof TASKS)[number];
export type NoveltyBand = "low" | "high";
export type NoveltyOutcome = "dominates" | "improves-neither" | "tradeoff";
export type NoveltyStratum = "stock-interface-pair-screen" | "remaining-protocols";

interface PinnedLedger {
	path: string;
	sha256: string;
	eventCount: number;
	terminalEventHash: string;
}

interface Proposal {
	jobId: string;
	manifestDigest: string;
	branchId: string;
	parentJobIds: string[];
	candidate: {
		digest: string;
		byteLength: number;
		mediaType: string;
	};
}

interface Measurement {
	jobId: string;
	manifestDigest: string;
	vector: readonly [number, number];
}

export interface CompilerGymLateNoveltyLedgerSource {
	path: string;
	contents: string;
	artifacts: Readonly<Record<string, string>>;
}

export interface CompilerGymLateNoveltySources {
	latencyAnalysisContents: string;
	ledgers: readonly CompilerGymLateNoveltyLedgerSource[];
}

export interface CompilerGymLateNoveltyTransition {
	ledgerPath: string;
	stratum: NoveltyStratum;
	childJobId: string;
	childOrdinal: 4;
	parentJobId: string;
	parentBinding: "first-declared-parent";
	parentActionCount: number;
	childActionCount: number;
	lcsLength: number;
	similarityNumerator: number;
	similarityDenominator: number;
	similarity: number;
	band: NoveltyBand;
	parentVector: readonly [number, number];
	childVector: readonly [number, number];
	outcome: NoveltyOutcome;
}

export interface NoveltyBandCounts {
	total: number;
	dominates: number;
	improvesNeither: number;
	tradeoff: number;
}

export interface NoveltyTable {
	low: NoveltyBandCounts;
	high: NoveltyBandCounts;
}

export interface CompilerGymLateNoveltyHeadroomResult {
	schemaVersion: 1;
	analysisId: "compiler-gym-late-structural-novelty-headroom-v1";
	classification: "development-informed-retrospective-headroom-audit-not-treatment-evidence";
	latencyAnalysisSha256: typeof COMPILER_GYM_LATE_NOVELTY_ANALYSIS_SHA256;
	inputLedgerCount: 21;
	verifiedTransitionCount: number;
	threshold: typeof COMPILER_GYM_LATE_NOVELTY_THRESHOLD;
	promptDeltaBudgetBytes: typeof COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES;
	transitions: CompilerGymLateNoveltyTransition[];
	overall: NoveltyTable;
	strata: Record<NoveltyStratum, NoveltyTable>;
	gates: {
		exactReconstruction14Of14: boolean;
		exactSevenSevenSplit: boolean;
		overallDominationGapPercentagePoints: number;
		overallDominationGapAtLeast30Points: boolean;
		stockInterfacePairGapStrictlyPositive: boolean;
		remainingProtocolsGapStrictlyPositive: boolean;
		promptDeltaBudgetBytes: 128;
	};
	eligibleForFauxPromptPilot: boolean;
	authorizations: {
		provider: false;
		paid: false;
		treatment: false;
		promotion: false;
		gpu: false;
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

function parsePinnedAnalysis(contents: string): { ledgerRoot: string; inputLedgers: PinnedLedger[] } {
	if (sha256Text(contents) !== COMPILER_GYM_LATE_NOVELTY_ANALYSIS_SHA256) {
		throw new Error("Pinned CompilerGym latency analysis hash drifted");
	}
	const root = record(JSON.parse(contents) as unknown, "latency analysis");
	if (root.schemaVersion !== 1 || root.analysisId !== "compiler-gym-allocation-latency-v1") {
		throw new Error("Pinned CompilerGym latency analysis identity drifted");
	}
	const ledgerRoot = nonemptyString(root.ledgerRoot, "latency analysis.ledgerRoot");
	if (ledgerRoot !== ".autoresearch") throw new Error("Pinned CompilerGym latency ledger root drifted");
	if (!Array.isArray(root.inputLedgers) || root.inputLedgers.length !== EXPECTED_LEDGER_COUNT) {
		throw new Error(`Pinned CompilerGym latency analysis must contain ${EXPECTED_LEDGER_COUNT} ledgers`);
	}
	const paths = new Set<string>();
	const inputLedgers = root.inputLedgers.map((value, index): PinnedLedger => {
		const item = record(value, `latency analysis.inputLedgers[${index}]`);
		const path = nonemptyString(item.path, `latency analysis.inputLedgers[${index}].path`);
		if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === "" || part === "..")) {
			throw new Error(`latency analysis.inputLedgers[${index}].path is not portable`);
		}
		if (paths.has(path)) throw new Error(`Duplicate pinned ledger path: ${path}`);
		paths.add(path);
		return {
			path,
			sha256: sha256(item.sha256, `latency analysis.inputLedgers[${index}].sha256`),
			eventCount: nonnegativeSafeInteger(item.eventCount, `latency analysis.inputLedgers[${index}].eventCount`),
			terminalEventHash: sha256(item.terminalEventHash, `latency analysis.inputLedgers[${index}].terminalEventHash`),
		};
	});
	return { ledgerRoot, inputLedgers };
}

function parseProposal(event: LedgerEvent, ledgerPath: string): Proposal {
	const payload = record(event.payload, `${ledgerPath}:proposal`);
	const details = record(payload.proposal, `${ledgerPath}:proposal.proposal`);
	if (!Array.isArray(details.parentJobIds) || !details.parentJobIds.every((value) => typeof value === "string")) {
		throw new Error(`${ledgerPath}:proposal.parentJobIds must be a string array`);
	}
	const candidate = record(payload.candidate, `${ledgerPath}:proposal.candidate`);
	return {
		jobId: nonemptyString(payload.jobId, `${ledgerPath}:proposal.jobId`),
		manifestDigest: sha256(payload.manifestDigest, `${ledgerPath}:proposal.manifestDigest`),
		branchId: nonemptyString(payload.branchId, `${ledgerPath}:proposal.branchId`),
		parentJobIds: [...details.parentJobIds],
		candidate: {
			digest: sha256(candidate.digest, `${ledgerPath}:proposal.candidate.digest`),
			byteLength: nonnegativeSafeInteger(candidate.byteLength, `${ledgerPath}:proposal.candidate.byteLength`),
			mediaType: nonemptyString(candidate.mediaType, `${ledgerPath}:proposal.candidate.mediaType`),
		},
	};
}

function parseMeasurement(event: LedgerEvent, ledgerPath: string): Measurement {
	const payload = record(event.payload, `${ledgerPath}:measurement`);
	if (Object.hasOwn(payload, "reuse")) throw new Error(`${ledgerPath}:measurement must be fresh`);
	if (!Array.isArray(payload.tasks) || payload.tasks.length !== TASKS.length) {
		throw new Error(`${ledgerPath}:measurement.tasks must contain exactly two tasks`);
	}
	const byTask = new Map<TaskId, number>();
	for (const [index, value] of payload.tasks.entries()) {
		const task = record(value, `${ledgerPath}:measurement.tasks[${index}]`);
		const benchmarkId = nonemptyString(task.benchmarkId, `${ledgerPath}:measurement.tasks[${index}].benchmarkId`);
		if (benchmarkId !== TASKS[0] && benchmarkId !== TASKS[1]) {
			throw new Error(`${ledgerPath}:measurement contains an unexpected task ${benchmarkId}`);
		}
		if (task.status !== "accepted") throw new Error(`${ledgerPath}:${benchmarkId} is not accepted`);
		const verifier = record(task.verifier, `${ledgerPath}:${benchmarkId}.verifier`);
		if (verifier.passed !== true) throw new Error(`${ledgerPath}:${benchmarkId} verifier did not pass`);
		const metrics = record(task.metrics, `${ledgerPath}:${benchmarkId}.metrics`);
		if (byTask.has(benchmarkId)) throw new Error(`${ledgerPath}:measurement contains duplicate task ${benchmarkId}`);
		byTask.set(
			benchmarkId,
			nonnegativeSafeInteger(metrics.IrInstructionCount, `${ledgerPath}:${benchmarkId}.IrInstructionCount`),
		);
	}
	const blowfish = byTask.get(TASKS[0]);
	const bzip2 = byTask.get(TASKS[1]);
	if (blowfish === undefined || bzip2 === undefined)
		throw new Error(`${ledgerPath}:measurement task coverage drifted`);
	return {
		jobId: nonemptyString(payload.jobId, `${ledgerPath}:measurement.jobId`),
		manifestDigest: sha256(payload.manifestDigest, `${ledgerPath}:measurement.manifestDigest`),
		vector: [blowfish, bzip2],
	};
}

function parseActions(contents: string, proposal: Proposal, ledgerPath: string): string[] {
	if (sha256Text(contents) !== proposal.candidate.digest) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact hash drifted`);
	}
	if (Buffer.byteLength(contents) !== proposal.candidate.byteLength) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact length drifted`);
	}
	if (proposal.candidate.mediaType !== "application/vnd.prime.llvm-pass-sequence") {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate media type drifted`);
	}
	const parsed: unknown = JSON.parse(contents);
	if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((value) => typeof value === "string")) {
		throw new Error(`${ledgerPath}:${proposal.jobId} candidate artifact must be a non-empty string array`);
	}
	return [...parsed];
}

function classifyOutcome(parent: readonly [number, number], child: readonly [number, number]): NoveltyOutcome {
	const dominates =
		child.every((value, index) => value <= parent[index]) && child.some((value, index) => value < parent[index]);
	if (dominates) return "dominates";
	if (child.every((value, index) => value >= parent[index])) return "improves-neither";
	return "tradeoff";
}

export function reconstructOrdinalFourTransition(
	source: CompilerGymLateNoveltyLedgerSource,
): CompilerGymLateNoveltyTransition | null {
	const events = verifyLedgerContentsStrict(source.contents);
	const proposals = events
		.filter((event) => event.kind === "proposal")
		.map((event) => parseProposal(event, source.path));
	if (proposals.length !== 4) return null;
	const proposalByJobId = new Map<string, Proposal>();
	for (const proposal of proposals) {
		if (proposalByJobId.has(proposal.jobId))
			throw new Error(`${source.path}:duplicate proposal job ${proposal.jobId}`);
		proposalByJobId.set(proposal.jobId, proposal);
	}
	const child = proposals[3];
	const parentJobId = child.parentJobIds[0];
	if (!parentJobId) throw new Error(`${source.path}:ordinal-4 proposal lacks a first declared parent`);
	const parent = proposalByJobId.get(parentJobId);
	if (!parent || proposals.indexOf(parent) >= 3 || parent.branchId !== child.branchId) {
		throw new Error(`${source.path}:ordinal-4 first parent is not an earlier proposal in the same branch`);
	}

	const measurementByJobId = new Map<string, Measurement>();
	for (const event of events.filter((candidate) => candidate.kind === "measurement")) {
		const measurement = parseMeasurement(event, source.path);
		if (measurementByJobId.has(measurement.jobId)) {
			throw new Error(`${source.path}:duplicate measurement job ${measurement.jobId}`);
		}
		measurementByJobId.set(measurement.jobId, measurement);
	}
	const parentMeasurement = measurementByJobId.get(parent.jobId);
	const childMeasurement = measurementByJobId.get(child.jobId);
	if (!parentMeasurement || !childMeasurement)
		throw new Error(`${source.path}:ordinal-4 transition lacks measurements`);
	if (
		parentMeasurement.manifestDigest !== parent.manifestDigest ||
		childMeasurement.manifestDigest !== child.manifestDigest
	) {
		throw new Error(`${source.path}:ordinal-4 proposal/measurement manifest mismatch`);
	}
	const parentArtifact = source.artifacts[parent.candidate.digest];
	const childArtifact = source.artifacts[child.candidate.digest];
	if (parentArtifact === undefined || childArtifact === undefined) {
		throw new Error(`${source.path}:ordinal-4 transition lacks a candidate artifact`);
	}
	const parentActions = parseActions(parentArtifact, parent, source.path);
	const childActions = parseActions(childArtifact, child, source.path);
	const dice = diceLcsSimilarity(parentActions, childActions);
	return {
		ledgerPath: source.path,
		stratum: source.path.startsWith("stock-interface-pair-screen/")
			? "stock-interface-pair-screen"
			: "remaining-protocols",
		childJobId: child.jobId,
		childOrdinal: 4,
		parentJobId: parent.jobId,
		parentBinding: "first-declared-parent",
		parentActionCount: parentActions.length,
		childActionCount: childActions.length,
		lcsLength: dice.lcsLength,
		similarityNumerator: dice.numerator,
		similarityDenominator: dice.denominator,
		similarity: dice.similarity,
		band: dice.band,
		parentVector: parentMeasurement.vector,
		childVector: childMeasurement.vector,
		outcome: classifyOutcome(parentMeasurement.vector, childMeasurement.vector),
	};
}

function emptyCounts(): NoveltyBandCounts {
	return { total: 0, dominates: 0, improvesNeither: 0, tradeoff: 0 };
}

function table(transitions: readonly CompilerGymLateNoveltyTransition[]): NoveltyTable {
	const result: NoveltyTable = { low: emptyCounts(), high: emptyCounts() };
	for (const transition of transitions) {
		const counts = result[transition.band];
		counts.total++;
		if (transition.outcome === "dominates") counts.dominates++;
		else if (transition.outcome === "improves-neither") counts.improvesNeither++;
		else counts.tradeoff++;
	}
	return result;
}

function positiveDominationGap(value: NoveltyTable): boolean {
	return value.low.dominates * value.high.total > value.high.dominates * value.low.total;
}

export function analyzeCompilerGymLateNoveltyHeadroom(
	sources: CompilerGymLateNoveltySources,
): CompilerGymLateNoveltyHeadroomResult {
	const pinned = parsePinnedAnalysis(sources.latencyAnalysisContents);
	const sourceByPath = new Map(sources.ledgers.map((source) => [source.path, source]));
	if (sourceByPath.size !== sources.ledgers.length) throw new Error("Duplicate novelty ledger source");
	if (
		sourceByPath.size !== pinned.inputLedgers.length ||
		[...sourceByPath.keys()].some((path) => !pinned.inputLedgers.some((ledger) => ledger.path === path))
	) {
		throw new Error("Novelty ledger source set differs from the pinned latency cohort");
	}
	const transitions: CompilerGymLateNoveltyTransition[] = [];
	for (const input of pinned.inputLedgers) {
		const source = sourceByPath.get(input.path);
		if (!source) throw new Error(`Missing pinned novelty ledger ${input.path}`);
		if (sha256Text(source.contents) !== input.sha256) throw new Error(`${input.path}:pinned ledger hash drifted`);
		const events = verifyLedgerContentsStrict(source.contents);
		if (events.length !== input.eventCount || events.at(-1)?.hash !== input.terminalEventHash) {
			throw new Error(`${input.path}:pinned ledger chain summary drifted`);
		}
		const transition = reconstructOrdinalFourTransition(source);
		if (transition) transitions.push(transition);
	}

	const overall = table(transitions);
	const strata: Record<NoveltyStratum, NoveltyTable> = {
		"stock-interface-pair-screen": table(
			transitions.filter((transition) => transition.stratum === "stock-interface-pair-screen"),
		),
		"remaining-protocols": table(transitions.filter((transition) => transition.stratum === "remaining-protocols")),
	};
	const exactReconstruction14Of14 = transitions.length === EXPECTED_TRANSITION_COUNT;
	const exactSevenSevenSplit = overall.low.total === EXPECTED_BAND_COUNT && overall.high.total === EXPECTED_BAND_COUNT;
	const overallGap =
		overall.low.total === 0 || overall.high.total === 0
			? Number.NaN
			: (100 * overall.low.dominates) / overall.low.total - (100 * overall.high.dominates) / overall.high.total;
	const overallDominationGapAtLeast30Points =
		overall.low.total > 0 &&
		overall.high.total > 0 &&
		100 * (overall.low.dominates * overall.high.total - overall.high.dominates * overall.low.total) >=
			MIN_DOMINATION_GAP_PERCENTAGE_POINTS * overall.low.total * overall.high.total;
	const stockInterfacePairGapStrictlyPositive = positiveDominationGap(strata["stock-interface-pair-screen"]);
	const remainingProtocolsGapStrictlyPositive = positiveDominationGap(strata["remaining-protocols"]);
	const gates = {
		exactReconstruction14Of14,
		exactSevenSevenSplit,
		overallDominationGapPercentagePoints: overallGap,
		overallDominationGapAtLeast30Points,
		stockInterfacePairGapStrictlyPositive,
		remainingProtocolsGapStrictlyPositive,
		promptDeltaBudgetBytes: COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
	};
	return {
		schemaVersion: 1,
		analysisId: "compiler-gym-late-structural-novelty-headroom-v1",
		classification: "development-informed-retrospective-headroom-audit-not-treatment-evidence",
		latencyAnalysisSha256: COMPILER_GYM_LATE_NOVELTY_ANALYSIS_SHA256,
		inputLedgerCount: EXPECTED_LEDGER_COUNT,
		verifiedTransitionCount: transitions.length,
		threshold: COMPILER_GYM_LATE_NOVELTY_THRESHOLD,
		promptDeltaBudgetBytes: COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
		transitions,
		overall,
		strata,
		gates,
		eligibleForFauxPromptPilot:
			exactReconstruction14Of14 &&
			exactSevenSevenSplit &&
			overallDominationGapAtLeast30Points &&
			stockInterfacePairGapStrictlyPositive &&
			remainingProtocolsGapStrictlyPositive,
		authorizations: { provider: false, paid: false, treatment: false, promotion: false, gpu: false },
	};
}

export async function loadCompilerGymLateNoveltySources(
	repoRoot = DEFAULT_REPO_ROOT,
): Promise<CompilerGymLateNoveltySources> {
	const latencyAnalysisContents = await readFile(resolve(repoRoot, COMPILER_GYM_LATE_NOVELTY_ANALYSIS_PATH), "utf8");
	const pinned = parsePinnedAnalysis(latencyAnalysisContents);
	const ledgers = await Promise.all(
		pinned.inputLedgers.map(async (input): Promise<CompilerGymLateNoveltyLedgerSource> => {
			const ledgerPath = resolve(repoRoot, pinned.ledgerRoot, input.path);
			const contents = await readFile(ledgerPath, "utf8");
			const events = verifyLedgerContentsStrict(contents);
			const digests = new Set(
				events
					.filter((event) => event.kind === "proposal")
					.map((event) =>
						sha256(
							record(record(event.payload, "proposal").candidate, "proposal.candidate").digest,
							"proposal.candidate.digest",
						),
					),
			);
			const artifacts: Record<string, string> = {};
			await Promise.all(
				[...digests].map(async (digest) => {
					artifacts[digest] = await readFile(
						join(dirname(ledgerPath), "artifacts", "sha256", digest.slice(0, 2), digest.slice(2)),
						"utf8",
					);
				}),
			);
			return { path: input.path, contents, artifacts };
		}),
	);
	return { latencyAnalysisContents, ledgers };
}

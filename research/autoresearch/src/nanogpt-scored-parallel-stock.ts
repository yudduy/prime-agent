import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { ResearchController } from "./controller.js";
import { validateNanoGptScoredCandidatePatch } from "./nanogpt-scored-adapter.js";
import {
	NanoGptScoredParallelAdapter,
	nanoGptScoredParallelApparatusAttemptBoundaryCondition,
	nanoGptScoredParallelBudgetClass,
	parseNanoGptScoredParallelApparatusAttempt,
} from "./nanogpt-scored-parallel-adapter.js";
import {
	NANOGPT_SCORED_PARALLEL_AMENDMENT,
	NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
} from "./nanogpt-scored-parallel-amendment.js";
import {
	buildNanoGptScoredParallelStageRequest,
	type NanoGptScoredParallelMode,
	type NanoGptScoredParallelPins,
	nanoGptScoredParallelBenchmarkIds,
	nanoGptScoredParallelBoundaryConditions,
	nanoGptScoredParallelStageIdentity,
	nanoGptScoredParallelVerifierEpoch,
} from "./nanogpt-scored-parallel-protocol.js";
import {
	DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
	loadNanoGptScoredParallelPins,
	NANOGPT_SCORED_PARALLEL_CHILD_TIMES,
	NANOGPT_SCORED_PARALLEL_REMOTE_ROOT,
	SshNanoGptScoredParallelTransport,
} from "./nanogpt-scored-parallel-transport.js";
import {
	acquireNanoGptScoredStockPidLock,
	NANOGPT_STOCK_CANDIDATE_SHA256,
	NANOGPT_STOCK_IDENTITY_PATCH_SHA256,
	NANOGPT_STOCK_SCORED_BRANCH,
	NANOGPT_STOCK_SCORED_TREATMENT,
} from "./nanogpt-scored-stock.js";
import { loadNanoGptScoredVerifierPins } from "./nanogpt-scored-transport.js";
import type { ArtifactRef, JobView, SubmitRequest } from "./types.js";

export const NANOGPT_STOCK_PARALLEL_BRANCH = "nanogpt-stock-scored-parallel-v2" as const;
export const NANOGPT_STOCK_PARALLEL_TREATMENT = "stock-anchor-parallel-v2" as const;
export const NANOGPT_STOCK_PARALLEL_MAX_APPARATUS_ATTEMPTS_PER_MODE = 2 as const;

const SOURCE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SOURCE_PATH), "../../..");
const OUTPUT_PARENT = join(REPOSITORY_ROOT, ".autoresearch", "nanogpt-scored");
const DEFAULT_V1_OUTPUT_DIR = join(OUTPUT_PARENT, "stock-v1");
const STOCK_PATCH_PATH = fileURLToPath(new URL("../fixtures/nanogpt/stock-identity.patch", import.meta.url));
const MODES = ["smoke-10", "score-3", "replay-8"] as const;

export const NANOGPT_STOCK_PARALLEL_MAX_SUBMISSIONS =
	MODES.length * NANOGPT_STOCK_PARALLEL_MAX_APPARATUS_ATTEMPTS_PER_MODE;
export const NANOGPT_STOCK_PARALLEL_MAX_TASK_EVALUATIONS =
	MODES.reduce((total, mode) => total + nanoGptScoredParallelBenchmarkIds(mode).length, 0) *
	NANOGPT_STOCK_PARALLEL_MAX_APPARATUS_ATTEMPTS_PER_MODE;

type StockCommand = "readiness" | "submit-and-wait" | "reconcile";

export interface NanoGptScoredParallelStockCliOptions {
	readonly outputDir: string;
	readonly v1OutputDir: string;
	readonly mode: NanoGptScoredParallelMode;
	readonly command: StockCommand;
}

const PROPOSAL_TEXT: Readonly<
	Record<NanoGptScoredParallelMode, { readonly hypothesis: string; readonly predictedOutcome: string }>
> = {
	"smoke-10": {
		hypothesis: "The additive v2 one-child path preserves the byte-exact stock NanoGPT candidate for ten steps.",
		predictedOutcome:
			"One unscored fixed-seed child completes with exact worker, scheduler, log, and allocation evidence.",
	},
	"score-3": {
		hypothesis:
			"After the exact v1 score-1 gate and v2 smoke, three fresh independent stock seeds clear the fixed mean-loss threshold.",
		predictedOutcome:
			"The exact integer aggregate over three fresh children is strictly below 3.278590000 without reusing v1 measurements.",
	},
	"replay-8": {
		hypothesis: "The stock candidate reproduces the fixed threshold over eight fresh independent one-L40S children.",
		predictedOutcome:
			"The full exact eight-seed integer aggregate clears the threshold with no partial or cross-protocol aggregation.",
	},
};

function validateChildOutputDir(outputDir: string): void {
	if (resolve(outputDir) !== outputDir) throw new Error("--output-dir must be absolute and normalized");
	const route = relative(OUTPUT_PARENT, outputDir);
	if (!route || route.startsWith("..") || resolve(OUTPUT_PARENT, route) !== outputDir) {
		throw new Error(`--output-dir must be a child of ${OUTPUT_PARENT}`);
	}
}

function validateV1OutputDir(outputDir: string): void {
	if (resolve(outputDir) !== outputDir) throw new Error("--v1-output-dir must be absolute and normalized");
	const route = relative(OUTPUT_PARENT, outputDir);
	if (!route || route.startsWith("..") || resolve(OUTPUT_PARENT, route) !== outputDir) {
		throw new Error(`--v1-output-dir must be a child of ${OUTPUT_PARENT}`);
	}
}

export function parseNanoGptScoredParallelStockArgs(argv: readonly string[]): NanoGptScoredParallelStockCliOptions {
	let outputDir: string | null = null;
	let v1OutputDir = DEFAULT_V1_OUTPUT_DIR;
	let mode: NanoGptScoredParallelMode | null = null;
	let command: StockCommand | null = null;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--output-dir") {
			outputDir = argv[++index] ?? null;
			continue;
		}
		if (argument === "--v1-output-dir") {
			v1OutputDir = argv[++index] ?? "";
			continue;
		}
		if (argument === "--mode") {
			const candidate = argv[++index];
			if (!MODES.includes(candidate as NanoGptScoredParallelMode))
				throw new Error(`Unsupported --mode: ${candidate}`);
			mode = candidate as NanoGptScoredParallelMode;
			continue;
		}
		if (argument === "--readiness" || argument === "--submit-and-wait" || argument === "--reconcile") {
			if (command !== null) throw new Error("Choose exactly one NanoGPT parallel stock command");
			command = argument.slice(2) as StockCommand;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (!outputDir || !mode || !command) {
		throw new Error(
			"Usage: --output-dir ABSOLUTE [--v1-output-dir ABSOLUTE] --mode smoke-10|score-3|replay-8 --readiness|--submit-and-wait|--reconcile",
		);
	}
	validateChildOutputDir(outputDir);
	validateV1OutputDir(v1OutputDir);
	if (outputDir === v1OutputDir)
		throw new Error("NanoGPT parallel v2 output must be isolated from the immutable v1 output");
	return { outputDir, v1OutputDir, mode, command };
}

function modeOf(job: JobView): NanoGptScoredParallelMode | null {
	for (const mode of MODES) {
		const expected = nanoGptScoredParallelBenchmarkIds(mode);
		if (
			job.proposal.benchmarkIds.length === expected.length &&
			job.proposal.benchmarkIds.every((id, index) => id === expected[index])
		) {
			return mode;
		}
	}
	return null;
}

function apparatusAttemptOf(job: JobView, pins: NanoGptScoredParallelPins): number {
	return parseNanoGptScoredParallelApparatusAttempt(job.proposal.proposal.boundaryConditions, pins);
}

function isAccepted(job: JobView): boolean {
	return (
		job.state.status === "succeeded" &&
		job.measurement !== null &&
		job.measurement.tasks.length === job.proposal.benchmarkIds.length &&
		job.measurement.tasks.every((task) => task.status === "accepted" && task.verifier.passed)
	);
}

function isActive(job: JobView): boolean {
	return ["accepted", "queued", "running"].includes(job.state.status);
}

function stockJobs(jobs: readonly JobView[], patchDigest: string, verifierEpoch?: string): JobView[] {
	return jobs.filter(
		(job) =>
			job.proposal.branchId === NANOGPT_STOCK_PARALLEL_BRANCH &&
			job.proposal.treatment === NANOGPT_STOCK_PARALLEL_TREATMENT &&
			job.proposal.lane === "nanogpt" &&
			job.proposal.candidate.digest === patchDigest &&
			(verifierEpoch === undefined ||
				(job.proposal.proposal.boundaryConditions.includes(`verifierEpoch=${verifierEpoch}`) &&
					(job.measurement === null || job.measurement.verifierEpoch === verifierEpoch))),
	);
}

export function selectNanoGptScoredParallelStockAttempt(
	mode: NanoGptScoredParallelMode,
	jobs: readonly JobView[],
	pins: NanoGptScoredParallelPins,
	patchDigest: string = NANOGPT_STOCK_IDENTITY_PATCH_SHA256,
): JobView | null {
	const attempts = stockJobs(jobs, patchDigest, nanoGptScoredParallelVerifierEpoch(pins)).filter(
		(job) => modeOf(job) === mode,
	);
	const attemptNumbers = attempts.map((job) => apparatusAttemptOf(job, pins));
	if (new Set(attemptNumbers).size !== attemptNumbers.length) {
		throw new Error(`NanoGPT parallel ${mode} contains duplicate apparatus attempts`);
	}
	const accepted = attempts.filter(isAccepted);
	const active = attempts.filter(isActive);
	if (accepted.length > 1 || active.length > 1 || (accepted.length === 1 && active.length === 1)) {
		throw new Error(`NanoGPT parallel ${mode} has conflicting accepted or active attempts`);
	}
	if (accepted[0]) return accepted[0];
	if (active[0]) return active[0];
	return (
		[...attempts].sort(
			(left, right) =>
				apparatusAttemptOf(right, pins) - apparatusAttemptOf(left, pins) ||
				right.state.statusAt.localeCompare(left.state.statusAt),
		)[0] ?? null
	);
}

export function selectNanoGptScoredParallelParentJobIds(
	mode: NanoGptScoredParallelMode,
	jobs: readonly JobView[],
	pins: NanoGptScoredParallelPins,
	patchDigest: string = NANOGPT_STOCK_IDENTITY_PATCH_SHA256,
): string[] {
	if (mode === "smoke-10") return [];
	const previousMode = mode === "score-3" ? "smoke-10" : "score-3";
	const accepted = stockJobs(jobs, patchDigest, nanoGptScoredParallelVerifierEpoch(pins)).filter(
		(job) => modeOf(job) === previousMode && isAccepted(job),
	);
	if (accepted.length !== 1)
		throw new Error(`NanoGPT parallel ${mode} requires exactly one accepted v2 ${previousMode}`);
	if (previousMode === "score-3" && accepted[0].measurement?.provenance.thresholdPassed !== "true") {
		throw new Error("NanoGPT parallel replay-8 cannot widen because v2 score-3 missed the threshold");
	}
	return [accepted[0].proposal.jobId];
}

export function buildNanoGptScoredParallelStockSubmitRequest(
	mode: NanoGptScoredParallelMode,
	pins: NanoGptScoredParallelPins,
	stockPatch: string,
	parentJobIds: readonly string[],
	apparatusAttempt = 0,
): SubmitRequest {
	if (sha256Text(stockPatch) !== NANOGPT_STOCK_IDENTITY_PATCH_SHA256) {
		throw new Error("Stock identity patch bytes changed");
	}
	return {
		branchId: NANOGPT_STOCK_PARALLEL_BRANCH,
		lane: "nanogpt",
		benchmarkIds: [...nanoGptScoredParallelBenchmarkIds(mode)],
		budgetClass: nanoGptScoredParallelBudgetClass(mode),
		treatment: NANOGPT_STOCK_PARALLEL_TREATMENT,
		proposal: {
			hypothesis: PROPOSAL_TEXT[mode].hypothesis,
			mechanism:
				"Run every fixed seed as a fresh independent one-L40S/world-size-one/no-requeue child, with at most four concurrent children and full exact-set host aggregation.",
			predictedOutcome: PROPOSAL_TEXT[mode].predictedOutcome,
			boundaryConditions: [
				...nanoGptScoredParallelBoundaryConditions(pins),
				nanoGptScoredParallelApparatusAttemptBoundaryCondition(apparatusAttempt),
			],
			parentJobIds: [...parentJobIds],
		},
		candidate: { format: "unified-diff", content: stockPatch },
		requireFreshMeasurement: true,
	};
}

export function buildNanoGptScoredParallelStockRunManifest(input: {
	readonly command: StockCommand;
	readonly mode: NanoGptScoredParallelMode;
	readonly pins: NanoGptScoredParallelPins;
	readonly stockPatch: string;
	readonly apparatusAttempt: number;
	readonly v1OutputDir: string;
}): Record<string, unknown> {
	const trials = nanoGptScoredParallelBenchmarkIds(input.mode).length as 1 | 3 | 8;
	const body = {
		type: "nanogpt_scored_parallel_stock_invocation_v2",
		schemaVersion: 1,
		command: input.command,
		mode: input.mode,
		apparatusAttempt: input.apparatusAttempt,
		maxApparatusAttemptsPerMode: NANOGPT_STOCK_PARALLEL_MAX_APPARATUS_ATTEMPTS_PER_MODE,
		branchId: NANOGPT_STOCK_PARALLEL_BRANCH,
		treatment: NANOGPT_STOCK_PARALLEL_TREATMENT,
		parallelAmendmentSha256: NANOGPT_SCORED_PARALLEL_AMENDMENT_SHA256,
		parallelAmendment: NANOGPT_SCORED_PARALLEL_AMENDMENT,
		verifierEpoch: nanoGptScoredParallelVerifierEpoch(input.pins),
		pins: input.pins,
		candidatePatchSha256: sha256Text(input.stockPatch),
		candidateSha256: NANOGPT_STOCK_CANDIDATE_SHA256,
		v1Gate: {
			outputDir: input.v1OutputDir,
			branchId: NANOGPT_STOCK_SCORED_BRANCH,
			treatment: NANOGPT_STOCK_SCORED_TREATMENT,
			mode: "score-1",
			numericMeasurementsReused: false,
		},
		remoteRoot: NANOGPT_SCORED_PARALLEL_REMOTE_ROOT,
		resources: {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			children: trials,
			maxConcurrentChildren: input.mode === "smoke-10" ? 1 : input.mode === "score-3" ? 3 : 4,
			gpusPerChild: 1,
			worldSizePerChild: 1,
			cpusPerChild: 8,
			memoryPerChild: "32G",
			wallTimePerChild: NANOGPT_SCORED_PARALLEL_CHILD_TIMES[input.mode],
			noRequeue: true,
		},
		accounting: [
			"wallClockMs",
			"queueWaitMsSum",
			"childRuntimeMsSum",
			"gpuMilliseconds",
			"gpuHours",
			"requested",
			"allocated",
		],
	};
	return { ...body, manifestDigest: sha256Json(body) };
}

async function buildReadinessRequest(
	pins: NanoGptScoredParallelPins,
	stockPatch: string,
): Promise<ReturnType<typeof buildNanoGptScoredParallelStageRequest>> {
	const staticEvidence = await validateNanoGptScoredCandidatePatch(stockPatch);
	if (staticEvidence.candidateSha256 !== NANOGPT_STOCK_CANDIDATE_SHA256) {
		throw new Error("Stock identity patch no longer materializes the byte-exact baseline");
	}
	const candidatePatch: ArtifactRef = {
		digest: sha256Text(stockPatch),
		byteLength: Buffer.byteLength(stockPatch),
		mediaType: "text/x-diff",
	};
	const verifierEpoch = nanoGptScoredParallelVerifierEpoch(pins);
	const stageIdentity = nanoGptScoredParallelStageIdentity({
		branchId: NANOGPT_STOCK_PARALLEL_BRANCH,
		treatment: NANOGPT_STOCK_PARALLEL_TREATMENT,
		verifierEpoch,
		candidatePatchSha256: candidatePatch.digest,
		candidateSha256: staticEvidence.candidateSha256,
	});
	const manifestDigest = sha256Json({ purpose: "nanogpt-parallel-readiness-v2", stageIdentity, pins });
	return buildNanoGptScoredParallelStageRequest({
		stageIdentity,
		mode: "smoke-10",
		jobId: `readiness_${manifestDigest.slice(0, 24)}`,
		manifestDigest,
		branchId: NANOGPT_STOCK_PARALLEL_BRANCH,
		treatment: NANOGPT_STOCK_PARALLEL_TREATMENT,
		candidatePatch,
		staticEvidence,
		benchmarkIds: nanoGptScoredParallelBenchmarkIds("smoke-10"),
		v1Bridge: null,
		priorStage: null,
		pins,
	});
}

function assertAccepted(mode: NanoGptScoredParallelMode, job: JobView | null): asserts job is JobView {
	if (!job || modeOf(job) !== mode || !isAccepted(job)) {
		throw new Error(
			`NanoGPT parallel ${mode} run was not scientifically accepted; observed ${job?.state.status ?? "missing"}`,
		);
	}
}

async function run(options: NanoGptScoredParallelStockCliOptions): Promise<Record<string, unknown>> {
	const lock = await acquireNanoGptScoredStockPidLock(options.outputDir);
	try {
		const stockPatch = await readFile(STOCK_PATCH_PATH, "utf8");
		const transportConfig = {
			...DEFAULT_NANOGPT_SCORED_PARALLEL_TRANSPORT_CONFIG,
			localEvidenceDir: join(options.outputDir, "transport-evidence"),
		};
		const [pins, v1Pins] = await Promise.all([
			loadNanoGptScoredParallelPins(transportConfig),
			loadNanoGptScoredVerifierPins(),
		]);
		const transport = new SshNanoGptScoredParallelTransport(transportConfig);
		if (options.command === "readiness") {
			const request = await buildReadinessRequest(pins, stockPatch);
			const readiness = await transport.readiness(request, new AbortController().signal);
			return {
				schemaVersion: 1,
				status: "ready",
				mode: options.mode,
				verifierEpoch: request.verifierEpoch,
				parallelAmendmentSha256: request.parallelAmendmentSha256,
				pins: readiness.pins,
				environmentDirectory: readiness.environmentDirectory,
				datasetDirectory: readiness.datasetDirectory,
			};
		}
		const adapter = new NanoGptScoredParallelAdapter({
			stateDir: join(options.outputDir, "parallel-state"),
			pins,
			transport,
			v1Gate: {
				stateDir: join(options.v1OutputDir, "scored-state"),
				transportEvidenceDir: join(options.v1OutputDir, "transport-evidence"),
				branchId: NANOGPT_STOCK_SCORED_BRANCH,
				treatment: NANOGPT_STOCK_SCORED_TREATMENT,
				pins: v1Pins,
			},
		});
		const controller = await ResearchController.open({
			ledgerPath: join(options.outputDir, "evidence.jsonl"),
			artifactDir: join(options.outputDir, "artifacts"),
			adapters: [adapter],
			metrics: {
				"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
				kernelbench: { name: "fast_at_1", direction: "maximize" },
				nanogpt: { name: "verified_steps", direction: "minimize" },
			},
			allowedBenchmarks: {
				"compiler-gym": [],
				kernelbench: [],
				nanogpt: [...new Set(MODES.flatMap((mode) => nanoGptScoredParallelBenchmarkIds(mode)))],
			},
			allowedTreatments: [NANOGPT_STOCK_PARALLEL_TREATMENT],
			maxInflight: { nanogpt: 1 },
			maxGpuInflight: 4,
			maxSubmissionsPerBranch: NANOGPT_STOCK_PARALLEL_MAX_SUBMISSIONS,
			maxTaskEvaluationsPerBranch: NANOGPT_STOCK_PARALLEL_MAX_TASK_EVALUATIONS,
		});
		const branchJobs = controller.statusForBranch(NANOGPT_STOCK_PARALLEL_BRANCH);
		const existing = stockJobs(branchJobs, sha256Text(stockPatch), nanoGptScoredParallelVerifierEpoch(pins)).filter(
			(job) => modeOf(job) === options.mode,
		);
		const current = selectNanoGptScoredParallelStockAttempt(options.mode, existing, pins, sha256Text(stockPatch));
		let jobId: string | null = null;
		let apparatusAttempt: number;
		let submitRequest: SubmitRequest | null = null;
		if (options.command === "reconcile") {
			if (!current) throw new Error(`--reconcile requires a durable NanoGPT parallel ${options.mode} attempt`);
			jobId = current.proposal.jobId;
			apparatusAttempt = apparatusAttemptOf(current, pins);
		} else if (current && (isAccepted(current) || isActive(current))) {
			jobId = current.proposal.jobId;
			apparatusAttempt = apparatusAttemptOf(current, pins);
		} else {
			apparatusAttempt =
				existing.length === 0 ? 0 : Math.max(...existing.map((job) => apparatusAttemptOf(job, pins))) + 1;
			if (apparatusAttempt >= NANOGPT_STOCK_PARALLEL_MAX_APPARATUS_ATTEMPTS_PER_MODE) {
				throw new Error(`NanoGPT parallel ${options.mode} exhausted its explicit whole-stage apparatus attempts`);
			}
			const parents = selectNanoGptScoredParallelParentJobIds(
				options.mode,
				branchJobs,
				pins,
				sha256Text(stockPatch),
			);
			submitRequest = buildNanoGptScoredParallelStockSubmitRequest(
				options.mode,
				pins,
				stockPatch,
				parents,
				apparatusAttempt,
			);
		}
		await controller.appendRunManifest(
			buildNanoGptScoredParallelStockRunManifest({
				command: options.command,
				mode: options.mode,
				pins,
				stockPatch,
				apparatusAttempt,
				v1OutputDir: options.v1OutputDir,
			}),
		);
		if (submitRequest !== null) jobId = (await controller.submit(submitRequest)).jobId;
		if (jobId === null) throw new Error("NanoGPT parallel invocation lost its controller job identity");
		await controller.waitForIdle();
		controller.verifyLedger();
		const selected = controller.status([jobId])[0] ?? null;
		assertAccepted(options.mode, selected);
		return {
			schemaVersion: 1,
			mode: options.mode,
			jobId,
			status: selected.state.status,
			externalHandle: selected.state.externalJobId,
			verifierEpoch: selected.measurement?.verifierEpoch ?? nanoGptScoredParallelVerifierEpoch(pins),
			requestDigest: selected.measurement?.provenance.requestDigest ?? null,
			resultDigest: selected.measurement?.provenance.resultDigest ?? null,
			receiptDigest: selected.measurement?.provenance.receiptDigest ?? null,
			thresholdPassed: selected.measurement?.provenance.thresholdPassed ?? null,
			gpuMilliseconds: selected.measurement?.provenance.gpuMilliseconds ?? null,
			wallClockMs: selected.measurement?.provenance.wallClockMs ?? null,
		};
	} finally {
		await lock.release();
	}
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const result = await run(parseNanoGptScoredParallelStockArgs(argv));
	process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === SOURCE_PATH) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

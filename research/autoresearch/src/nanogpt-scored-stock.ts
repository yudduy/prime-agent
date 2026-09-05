import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { ResearchController } from "./controller.js";
import {
	NanoGptScoredAdapter,
	nanoGptScoredApparatusAttemptBoundaryCondition,
	parseNanoGptScoredApparatusAttemptBoundaryCondition,
	validateNanoGptScoredCandidatePatch,
} from "./nanogpt-scored-adapter.js";
import {
	NANOGPT_SCORED_AMENDMENT,
	NANOGPT_SCORED_AMENDMENT_SHA256,
	NANOGPT_SCORED_PARENT_CAMPAIGN_SHA256,
} from "./nanogpt-scored-amendment.js";
import {
	buildNanoGptScoredRequest,
	inferNanoGptScoredMode,
	type NanoGptScoredMode,
	type NanoGptScoredRequest,
	type NanoGptScoredVerifierPins,
	nanoGptScoredBenchmarkIds,
	nanoGptScoredBoundaryConditions,
	nanoGptScoredBudgetClass,
	nanoGptScoredPreviousMode,
	nanoGptScoredStageIdentity,
	nanoGptScoredVerifierEpoch,
} from "./nanogpt-scored-protocol.js";
import {
	DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
	loadNanoGptScoredVerifierPins,
	NANOGPT_SCORED_DATA_MANIFEST_SHA256,
	NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
	NANOGPT_SCORED_ENVIRONMENT_SHA256,
	NANOGPT_SCORED_REMOTE_ROOT,
	NANOGPT_SCORED_SLURM_TIMES,
	NANOGPT_SCORED_STATIC_EVALUATOR_SHA256,
	SshNanoGptScoredTransport,
} from "./nanogpt-scored-transport.js";
import type { ArtifactRef, JobView, SubmitRequest } from "./types.js";

export const NANOGPT_STOCK_SCORED_BRANCH = "nanogpt-stock-scored-v1" as const;
export const NANOGPT_STOCK_SCORED_TREATMENT = "stock-anchor" as const;
export const NANOGPT_STOCK_IDENTITY_PATCH_SHA256 =
	"5c9649e5fcdc8a98f078c726764610fbb0a9f764a1d9dc51ef2ae1e3d2a0b8d5" as const;
export const NANOGPT_STOCK_CANDIDATE_SHA256 =
	"219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e" as const;
export const NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE = 2 as const;

const SOURCE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SOURCE_PATH), "../../..");
const OUTPUT_PARENT = join(REPOSITORY_ROOT, ".autoresearch", "nanogpt-scored");
const STOCK_PATCH_PATH = fileURLToPath(new URL("../fixtures/nanogpt/stock-identity.patch", import.meta.url));
const MODES = ["smoke-10", "score-1", "score-3", "replay-8"] as const;
export const NANOGPT_STOCK_MAX_SUBMISSIONS = MODES.length * NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE;
export const NANOGPT_STOCK_MAX_TASK_EVALUATIONS =
	MODES.reduce((total, mode) => total + nanoGptScoredBenchmarkIds(mode).length, 0) *
	NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE;

type StockCommand = "readiness" | "submit-and-wait" | "reconcile";

export interface NanoGptScoredStockCliOptions {
	readonly outputDir: string;
	readonly mode: NanoGptScoredMode;
	readonly command: StockCommand;
}

interface HeldPidLock {
	readonly path: string;
	release(): Promise<void>;
}

const PROPOSAL_TEXT: Readonly<
	Record<NanoGptScoredMode, { readonly hypothesis: string; readonly predictedOutcome: string }>
> = {
	"smoke-10": {
		hypothesis:
			"The byte-exact stock NanoGPT candidate compiles and completes ten optimizer steps under the scored verifier epoch.",
		predictedOutcome:
			"One fixed-seed infrastructure trial completes with exact source, count, hardware, and log evidence; no score or frontier claim is made.",
	},
	"score-1": {
		hypothesis:
			"The byte-exact 3,290-step stock NanoGPT candidate clears the fixed validation-loss threshold on the first preregistered seed.",
		predictedOutcome:
			"The one-seed mean validation loss is strictly below 3.27859, permitting a three-seed screen but no frontier claim.",
	},
	"score-3": {
		hypothesis:
			"The byte-exact 3,290-step stock NanoGPT candidate clears the fixed validation-loss threshold over the first three preregistered seeds.",
		predictedOutcome:
			"The three-seed mean validation loss is strictly below 3.27859, permitting a clean eight-seed replay but no frontier claim.",
	},
	"replay-8": {
		hypothesis:
			"The byte-exact 3,290-step stock NanoGPT candidate reproduces the fixed threshold over all eight preregistered seeds on FarmShare L40S.",
		predictedOutcome:
			"The clean eight-seed mean validation loss is strictly below 3.27859, establishing a verified stock anchor that is not record eligible at 3,290 steps.",
	},
};

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function processIsAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid < 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
	}
}

function validateOutputDir(outputDir: string): void {
	if (resolve(outputDir) !== outputDir) throw new Error("--output-dir must be absolute and normalized");
	const route = relative(OUTPUT_PARENT, outputDir);
	if (!route || route.startsWith("..") || resolve(OUTPUT_PARENT, route) !== outputDir) {
		throw new Error(`--output-dir must be a child of ${OUTPUT_PARENT}`);
	}
}

export async function acquireNanoGptScoredStockPidLock(outputDir: string): Promise<HeldPidLock> {
	validateOutputDir(outputDir);
	await mkdir(outputDir, { recursive: true, mode: 0o700 });
	const path = join(outputDir, ".controller.lock");
	const token = randomUUID();
	const source = `${canonicalJson({ schemaVersion: 1, pid: process.pid, token })}\n`;
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const handle = await open(path, "wx", 0o600);
			try {
				await handle.writeFile(source, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			return {
				path,
				async release(): Promise<void> {
					let observed: string;
					try {
						observed = await readFile(path, "utf8");
					} catch (error) {
						if (isMissing(error)) return;
						throw error;
					}
					if (observed !== source) throw new Error("NanoGPT scored controller lock ownership changed");
					await unlink(path);
				},
			};
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
			let ownerPid = 0;
			try {
				const value: unknown = JSON.parse(await readFile(path, "utf8"));
				if (typeof value === "object" && value !== null && "pid" in value && Number.isSafeInteger(value.pid)) {
					ownerPid = Number(value.pid);
				}
			} catch {
				ownerPid = 0;
			}
			if (processIsAlive(ownerPid)) {
				throw new Error(`NanoGPT scored output is locked by active process ${ownerPid}`);
			}
			await unlink(path).catch((unlinkError: unknown) => {
				if (!isMissing(unlinkError)) throw unlinkError;
			});
		}
	}
	throw new Error("Could not acquire the NanoGPT scored controller lock");
}

export function parseNanoGptScoredStockArgs(argv: readonly string[]): NanoGptScoredStockCliOptions {
	let outputDir: string | null = null;
	let mode: NanoGptScoredMode | null = null;
	let command: StockCommand | null = null;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--output-dir") {
			outputDir = argv[++index] ?? null;
			continue;
		}
		if (argument === "--mode") {
			const candidate = argv[++index];
			if (!MODES.includes(candidate as NanoGptScoredMode)) throw new Error(`Unsupported --mode: ${candidate}`);
			mode = candidate as NanoGptScoredMode;
			continue;
		}
		if (argument === "--readiness" || argument === "--submit-and-wait" || argument === "--reconcile") {
			if (command !== null) throw new Error("Choose exactly one NanoGPT scored command");
			command = argument.slice(2) as StockCommand;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (!outputDir || !mode || !command) {
		throw new Error(
			"Usage: --output-dir ABSOLUTE --mode smoke-10|score-1|score-3|replay-8 --readiness|--submit-and-wait|--reconcile",
		);
	}
	validateOutputDir(outputDir);
	return { outputDir, mode, command };
}

function modeOf(job: JobView): NanoGptScoredMode | null {
	try {
		return inferNanoGptScoredMode(job.proposal.benchmarkIds);
	} catch {
		return null;
	}
}

function stockJobs(jobs: readonly JobView[], patchDigest: string): JobView[] {
	return jobs.filter(
		(job) =>
			job.proposal.branchId === NANOGPT_STOCK_SCORED_BRANCH &&
			job.proposal.treatment === NANOGPT_STOCK_SCORED_TREATMENT &&
			job.proposal.lane === "nanogpt" &&
			job.proposal.candidate.digest === patchDigest,
	);
}

function apparatusAttemptOf(job: JobView): number {
	const encoded = job.proposal.proposal.boundaryConditions.at(-1) ?? "";
	return parseNanoGptScoredApparatusAttemptBoundaryCondition(encoded);
}

function isScientificallyAccepted(job: JobView): boolean {
	return (
		job.state.status === "succeeded" &&
		job.measurement !== null &&
		job.measurement.tasks.length === job.proposal.benchmarkIds.length &&
		job.measurement.tasks.every((task) => task.status === "accepted" && task.verifier.passed)
	);
}

function isActive(job: JobView): boolean {
	return job.state.status === "accepted" || job.state.status === "queued" || job.state.status === "running";
}

export function selectNanoGptScoredStockAttempt(
	mode: NanoGptScoredMode,
	jobs: readonly JobView[],
	patchDigest: string = NANOGPT_STOCK_IDENTITY_PATCH_SHA256,
): JobView | null {
	const attempts = stockJobs(jobs, patchDigest).filter((job) => modeOf(job) === mode);
	const attemptNumbers = attempts.map(apparatusAttemptOf);
	if (new Set(attemptNumbers).size !== attemptNumbers.length) {
		throw new Error(`NanoGPT ${mode} contains duplicate apparatus attempt identities`);
	}
	const succeeded = attempts.filter(isScientificallyAccepted);
	if (succeeded.length > 1) {
		throw new Error(`NanoGPT ${mode} contains multiple scientifically accepted attempts`);
	}
	const active = attempts.filter(isActive);
	if (active.length > 1 || (active.length === 1 && succeeded.length === 1)) {
		throw new Error(`NanoGPT ${mode} contains a parallel active apparatus attempt`);
	}
	if (succeeded[0]) return succeeded[0];
	if (active[0]) return active[0];
	return (
		[...attempts].sort(
			(left, right) =>
				apparatusAttemptOf(right) - apparatusAttemptOf(left) ||
				right.state.statusAt.localeCompare(left.state.statusAt) ||
				right.proposal.jobId.localeCompare(left.proposal.jobId),
		)[0] ?? null
	);
}

export function assertNanoGptScoredStockRunAccepted(
	mode: NanoGptScoredMode,
	selected: JobView | null,
): asserts selected is JobView {
	const status = selected?.state.status ?? "missing";
	if (selected === null || modeOf(selected) !== mode || !isScientificallyAccepted(selected)) {
		throw new Error(`NanoGPT ${mode} selected run was not scientifically accepted; observed ${status}`);
	}
}

export function selectNanoGptStockParentJobIds(
	mode: NanoGptScoredMode,
	jobs: readonly JobView[],
	patchDigest: string = NANOGPT_STOCK_IDENTITY_PATCH_SHA256,
): string[] {
	const previousMode = nanoGptScoredPreviousMode(mode);
	if (previousMode === null) return [];
	const accepted = stockJobs(jobs, patchDigest).filter(
		(job) => modeOf(job) === previousMode && isScientificallyAccepted(job),
	);
	if (accepted.length !== 1) {
		throw new Error(`NanoGPT ${mode} requires exactly one scientifically accepted ${previousMode} stock attempt`);
	}
	const parent = accepted[0];
	const measurement = parent.measurement;
	if (!measurement) throw new Error(`NanoGPT ${mode} accepted parent lost its measurement`);
	if (previousMode !== "smoke-10" && measurement.provenance.thresholdPassed !== "true") {
		throw new Error(`NanoGPT ${mode} cannot widen because ${previousMode} did not pass the fixed threshold`);
	}
	return [parent.proposal.jobId];
}

export function buildNanoGptStockSubmitRequest(
	mode: NanoGptScoredMode,
	pins: NanoGptScoredVerifierPins,
	stockPatch: string,
	parentJobIds: readonly string[],
	apparatusAttempt = 0,
): SubmitRequest {
	if (sha256Text(stockPatch) !== NANOGPT_STOCK_IDENTITY_PATCH_SHA256) {
		throw new Error("Stock identity patch bytes changed");
	}
	return {
		branchId: NANOGPT_STOCK_SCORED_BRANCH,
		lane: "nanogpt",
		benchmarkIds: [...nanoGptScoredBenchmarkIds(mode)],
		budgetClass: nanoGptScoredBudgetClass(mode),
		treatment: NANOGPT_STOCK_SCORED_TREATMENT,
		proposal: {
			hypothesis: PROPOSAL_TEXT[mode].hypothesis,
			mechanism:
				"Run the byte-exact stock candidate on one FarmShare L40S at world size one with fresh sequential fixed-seed trials.",
			predictedOutcome: PROPOSAL_TEXT[mode].predictedOutcome,
			boundaryConditions: [
				...nanoGptScoredBoundaryConditions(pins),
				nanoGptScoredApparatusAttemptBoundaryCondition(apparatusAttempt),
			],
			parentJobIds: [...parentJobIds],
		},
		candidate: { format: "unified-diff", content: stockPatch },
		requireFreshMeasurement: true,
	};
}

async function buildReadinessRequest(
	mode: NanoGptScoredMode,
	pins: NanoGptScoredVerifierPins,
	stockPatch: string,
): Promise<NanoGptScoredRequest> {
	const staticEvidence = await validateNanoGptScoredCandidatePatch(stockPatch);
	if (staticEvidence.candidateSha256 !== NANOGPT_STOCK_CANDIDATE_SHA256) {
		throw new Error("Stock identity patch no longer materializes the byte-exact baseline");
	}
	const candidatePatch: ArtifactRef = {
		digest: sha256Text(stockPatch),
		byteLength: Buffer.byteLength(stockPatch),
		mediaType: "text/x-diff",
	};
	const verifierEpoch = nanoGptScoredVerifierEpoch(pins);
	const stageIdentity = nanoGptScoredStageIdentity({
		branchId: NANOGPT_STOCK_SCORED_BRANCH,
		treatment: NANOGPT_STOCK_SCORED_TREATMENT,
		verifierEpoch,
		candidatePatchSha256: candidatePatch.digest,
		candidateSha256: staticEvidence.candidateSha256,
	});
	const manifestDigest = sha256Json({
		purpose: "nanogpt-scored-stock-readiness-v1",
		mode,
		stageIdentity,
		pins,
		campaignAmendmentSha256: NANOGPT_SCORED_AMENDMENT_SHA256,
	});
	return buildNanoGptScoredRequest({
		stageIdentity,
		mode,
		jobId: `readiness_${manifestDigest.slice(0, 24)}`,
		manifestDigest,
		branchId: NANOGPT_STOCK_SCORED_BRANCH,
		treatment: NANOGPT_STOCK_SCORED_TREATMENT,
		candidatePatch,
		staticEvidence,
		benchmarkIds: nanoGptScoredBenchmarkIds(mode),
		priorStage: null,
		pins,
	});
}

export function buildNanoGptStockRunManifest(input: {
	readonly command: StockCommand;
	readonly mode: NanoGptScoredMode;
	readonly pins: NanoGptScoredVerifierPins;
	readonly stockPatch: string;
	readonly apparatusAttempt: number;
}): Record<string, unknown> {
	const body = {
		type: "nanogpt_scored_stock_invocation_v1",
		schemaVersion: 1,
		command: input.command,
		mode: input.mode,
		apparatusAttempt: input.apparatusAttempt,
		maxApparatusAttemptsPerMode: NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE,
		branchId: NANOGPT_STOCK_SCORED_BRANCH,
		treatment: NANOGPT_STOCK_SCORED_TREATMENT,
		parentCampaignConfigSha256: NANOGPT_SCORED_PARENT_CAMPAIGN_SHA256,
		campaignAmendmentSha256: NANOGPT_SCORED_AMENDMENT_SHA256,
		campaignAmendment: NANOGPT_SCORED_AMENDMENT,
		verifierEpoch: nanoGptScoredVerifierEpoch(input.pins),
		pins: input.pins,
		candidatePatchSha256: sha256Text(input.stockPatch),
		candidatePatchByteLength: Buffer.byteLength(input.stockPatch),
		candidateSha256: NANOGPT_STOCK_CANDIDATE_SHA256,
		remoteRoot: NANOGPT_SCORED_REMOTE_ROOT,
		resources: {
			cluster: "Stanford FarmShare",
			gpu: "NVIDIA L40S",
			gpus: 1,
			worldSize: 1,
			cpus: 8,
			memory: "32G",
			wallTime: NANOGPT_SCORED_SLURM_TIMES[input.mode],
		},
		completionReconcileTimeout: null,
	};
	return { ...body, manifestDigest: sha256Json(body) };
}

async function summarize(
	selected: JobView,
	transport: SshNanoGptScoredTransport,
	mode: NanoGptScoredMode,
	pins: NanoGptScoredVerifierPins,
): Promise<Record<string, unknown>> {
	let archivedLogs: readonly {
		readonly requestDigest: string;
		readonly logSha256: string;
		readonly byteLength: number;
		readonly path: string;
	}[] = [];
	const requestDigest = selected.measurement?.provenance.requestDigest;
	if (requestDigest) archivedLogs = await transport.readArchivedTrialLogs(requestDigest);
	return {
		schemaVersion: 1,
		mode,
		jobId: selected.proposal.jobId,
		manifestDigest: selected.proposal.manifestDigest,
		status: selected.state.status,
		accepted: true,
		apparatusAttempt: apparatusAttemptOf(selected),
		externalHandle: selected.state.externalJobId,
		slurmJobId: selected.measurement?.hardware.slurmJobId ?? null,
		verifierEpoch: selected.measurement?.verifierEpoch ?? nanoGptScoredVerifierEpoch(pins),
		requestDigest: requestDigest ?? null,
		resultDigest: selected.measurement?.provenance.resultDigest ?? null,
		receiptDigest: selected.measurement?.provenance.receiptDigest ?? null,
		thresholdPassed: selected.measurement?.provenance.thresholdPassed ?? null,
		frontierEligible: selected.measurement?.provenance.frontierEligible ?? null,
		recordEligible: selected.measurement?.provenance.recordEligible ?? null,
		archivedLogs,
	};
}

async function run(options: NanoGptScoredStockCliOptions): Promise<Record<string, unknown>> {
	const lock = await acquireNanoGptScoredStockPidLock(options.outputDir);
	try {
		const stockPatch = await readFile(STOCK_PATCH_PATH, "utf8");
		const transportConfig = {
			...DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
			localEvidenceDir: join(options.outputDir, "transport-evidence"),
		};
		const pins = await loadNanoGptScoredVerifierPins(transportConfig);
		if (
			pins.staticEvaluatorSha256 !== NANOGPT_SCORED_STATIC_EVALUATOR_SHA256 ||
			pins.environmentSha256 !== NANOGPT_SCORED_ENVIRONMENT_SHA256 ||
			pins.environmentSealSha256 !== NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256 ||
			pins.datasetManifestSha256 !== NANOGPT_SCORED_DATA_MANIFEST_SHA256
		) {
			throw new Error("NanoGPT scored verifier pins differ from the production contract");
		}
		const transport = new SshNanoGptScoredTransport(transportConfig);
		if (options.command === "readiness") {
			const request = await buildReadinessRequest("smoke-10", pins, stockPatch);
			const readiness = await transport.readiness(request, new AbortController().signal);
			return {
				schemaVersion: 1,
				status: "ready",
				mode: options.mode,
				verifierEpoch: request.verifierEpoch,
				campaignAmendmentSha256: request.campaignAmendmentSha256,
				pins: readiness.pins,
				environmentDirectory: readiness.environment.directory,
				datasetDirectory: readiness.dataset.directory,
				datasetFiles: readiness.dataset.files.length,
			};
		}

		const adapter = new NanoGptScoredAdapter({
			stateDir: join(options.outputDir, "scored-state"),
			pins,
			transport,
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
				nanogpt: [...new Set(MODES.flatMap((mode) => nanoGptScoredBenchmarkIds(mode)))],
			},
			allowedTreatments: [NANOGPT_STOCK_SCORED_TREATMENT],
			maxInflight: { nanogpt: 1 },
			maxGpuInflight: 1,
			maxSubmissionsPerBranch: NANOGPT_STOCK_MAX_SUBMISSIONS,
			maxTaskEvaluationsPerBranch: NANOGPT_STOCK_MAX_TASK_EVALUATIONS,
		});
		const branchJobs = controller.statusForBranch(NANOGPT_STOCK_SCORED_BRANCH);
		const existing = stockJobs(branchJobs, sha256Text(stockPatch)).filter((job) => modeOf(job) === options.mode);
		const current = selectNanoGptScoredStockAttempt(options.mode, existing, sha256Text(stockPatch));
		let submitRequest: SubmitRequest | null = null;
		let selectedJobId: string;
		let apparatusAttempt: number;
		if (options.command === "reconcile") {
			if (!current) throw new Error(`--reconcile requires a durable ${options.mode} apparatus attempt`);
			selectedJobId = current.proposal.jobId;
			apparatusAttempt = apparatusAttemptOf(current);
		} else if (current && (isScientificallyAccepted(current) || isActive(current))) {
			selectedJobId = current.proposal.jobId;
			apparatusAttempt = apparatusAttemptOf(current);
		} else {
			apparatusAttempt =
				existing.length === 0 ? 0 : Math.max(...existing.map((attempt) => apparatusAttemptOf(attempt))) + 1;
			if (apparatusAttempt >= NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE) {
				throw new Error(
					`NanoGPT ${options.mode} exhausted its ${NANOGPT_STOCK_MAX_APPARATUS_ATTEMPTS_PER_MODE} explicit apparatus attempts`,
				);
			}
			const parents = selectNanoGptStockParentJobIds(options.mode, branchJobs, sha256Text(stockPatch));
			submitRequest = buildNanoGptStockSubmitRequest(options.mode, pins, stockPatch, parents, apparatusAttempt);
			selectedJobId = "";
		}
		await controller.appendRunManifest(
			buildNanoGptStockRunManifest({
				command: options.command,
				mode: options.mode,
				pins,
				stockPatch,
				apparatusAttempt,
			}),
		);
		if (submitRequest) selectedJobId = (await controller.submit(submitRequest)).jobId;
		await controller.waitForIdle();
		controller.verifyLedger();
		const selected = controller.status([selectedJobId])[0] ?? null;
		assertNanoGptScoredStockRunAccepted(options.mode, selected);
		return summarize(selected, transport, options.mode, pins);
	} finally {
		await lock.release();
	}
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const result = await run(parseNanoGptScoredStockArgs(argv));
	process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === SOURCE_PATH) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}

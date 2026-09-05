import { chmod, lstat, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactStore } from "./artifact-store.js";
import { FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import {
	buildReducedCpuCandidateEvidence,
	buildReducedCpuChampionValidationEvidence,
	classifyReducedCpuCandidateTwo,
	deriveReducedCpuSinglePassInsertion,
	maybeBuildReducedCpuRetestDirective,
	parseReducedCpuCandidateRequest,
	REDUCED_CPU_ALL_TASKS,
	REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM,
	REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM,
	REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM,
	REDUCED_CPU_SEARCH_TASKS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	REDUCED_CPU_VALIDATION_TASK,
	type ReducedCpuCalibration,
	type ReducedCpuCandidateEvidence,
	type ReducedCpuCandidateRequest,
	type ReducedCpuChampionValidationEnvelope,
	type ReducedCpuStudyArm,
	type ReducedCpuStudyEvaluationEnvelope,
	reducedCpuSearchTreatment,
	reducedCpuValidationTreatment,
	type SealedReducedCpuRetestDirective,
	sealReducedCpuRetestDirective,
	selectReducedCpuChampion,
} from "./reduced-cpu-study-protocol.js";
import type { EvaluationAdapter, JobView } from "./types.js";

export interface OpenReducedCpuStudyControllerOptions {
	outputDir: string;
	arm: ReducedCpuStudyArm;
	adapter?: EvaluationAdapter;
}

export interface SubmitReducedCpuSearchCandidateOptions {
	controller: ResearchController;
	outputDir: string;
	arm: ReducedCpuStudyArm;
	branchId: string;
	calibration: ReducedCpuCalibration;
	request: ReducedCpuCandidateRequest | unknown;
	sealedRetestDirective?: SealedReducedCpuRetestDirective;
	signal?: AbortSignal;
}

export interface SubmitReducedCpuChampionValidationOptions {
	controller: ResearchController;
	outputDir: string;
	arm: ReducedCpuStudyArm;
	branchId: string;
	calibration: ReducedCpuCalibration;
	signal?: AbortSignal;
}

export function assertReducedCpuFreshSettledJob(job: JobView, label: string): void {
	if (job.state.status !== "succeeded" && job.state.status !== "invalid" && job.state.status !== "failed") {
		throw new Error(`${label} did not reach an exact measured terminal state: ${job.state.status}`);
	}
	if (job.measurement === null) throw new Error(`${label} reached terminal state without a durable measurement`);
	if (job.measurement.jobId !== job.proposal.jobId || job.measurement.manifestDigest !== job.proposal.manifestDigest) {
		throw new Error(`${label} durable measurement identity mismatch`);
	}
	if (job.proposal.requireFreshMeasurement !== true || job.measurement.reuse !== undefined) {
		throw new Error(`${label} violated the fresh-measurement contract`);
	}
}

async function waitForReducedCpuJobSettlement(
	controller: ResearchController,
	jobId: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const cancel = (): void => controller.requestJobCancellation(jobId);
	if (signal?.aborted) cancel();
	else signal?.addEventListener("abort", cancel, { once: true });
	try {
		await controller.waitForIdle();
	} finally {
		signal?.removeEventListener("abort", cancel);
	}
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	try {
		const metadata = await lstat(path);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error(`Private path is not a real directory: ${path}`);
		}
	} catch (error) {
		if (!isMissing(error)) throw error;
		await mkdir(path, { recursive: true, mode: 0o700 });
	}
	await chmod(path, 0o700);
}

export async function prepareReducedCpuStudyOutput(outputDir: string): Promise<{
	outputDir: string;
	artifactDir: string;
	ledgerPath: string;
}> {
	const absoluteOutputDir = resolve(outputDir);
	const artifactDir = join(absoluteOutputDir, "artifacts");
	await ensurePrivateDirectory(absoluteOutputDir);
	await ensurePrivateDirectory(artifactDir);
	return { outputDir: absoluteOutputDir, artifactDir, ledgerPath: join(absoluteOutputDir, "evidence.jsonl") };
}

export async function verifyReducedCpuStudyLedgerStrict(
	controller: ResearchController,
	outputDir: string,
): Promise<void> {
	controller.verifyLedger();
	const ledgerPath = join(resolve(outputDir), "evidence.jsonl");
	const contents = await readFile(ledgerPath, "utf8");
	verifyLedgerContentsStrict(contents);
	await chmod(ledgerPath, 0o600);
}

export async function openReducedCpuStudyController(
	options: OpenReducedCpuStudyControllerOptions,
): Promise<ResearchController> {
	const paths = await prepareReducedCpuStudyOutput(options.outputDir);
	const adapter = options.adapter ?? new FarmShareCompilerGymAdapter();
	if (adapter.lane !== "compiler-gym") throw new Error("Reduced CPU study requires a CompilerGym adapter");
	const controller = await ResearchController.open({
		ledgerPath: paths.ledgerPath,
		artifactDir: paths.artifactDir,
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: { "compiler-gym": REDUCED_CPU_ALL_TASKS, kernelbench: [], nanogpt: [] },
		allowedTreatments: [reducedCpuSearchTreatment(options.arm), reducedCpuValidationTreatment(options.arm)],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: REDUCED_CPU_MAX_SUBMISSIONS_PER_ARM,
		maxTaskEvaluationsPerBranch: REDUCED_CPU_MAX_TASK_EVALUATIONS_PER_ARM,
	});
	await verifyReducedCpuStudyLedgerStrict(controller, paths.outputDir);
	return controller;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((item, index) => item === right[index]);
}

function searchJobsForArm(jobs: readonly JobView[], arm: ReducedCpuStudyArm): JobView[] {
	const searchTreatment = reducedCpuSearchTreatment(arm);
	const validationTreatment = reducedCpuValidationTreatment(arm);
	for (const job of jobs) {
		if (job.proposal.treatment !== searchTreatment && job.proposal.treatment !== validationTreatment) {
			throw new Error(`Branch contains an unexpected treatment: ${job.proposal.treatment}`);
		}
	}
	return jobs.filter((job) => job.proposal.treatment === searchTreatment);
}

function orderSearchJobs(jobs: readonly JobView[]): JobView[] {
	const remaining = new Map(jobs.map((job) => [job.proposal.jobId, job]));
	const ordered: JobView[] = [];
	let parentJobId: string | null = null;
	while (remaining.size > 0) {
		const expectedParents: string[] = parentJobId === null ? [] : [parentJobId];
		const matches: JobView[] = [...remaining.values()].filter((job) =>
			sameStrings(job.proposal.proposal.parentJobIds, expectedParents),
		);
		if (matches.length !== 1) throw new Error("Search branch is not one exact unambiguous lineage chain");
		const next: JobView = matches[0];
		ordered.push(next);
		remaining.delete(next.proposal.jobId);
		parentJobId = next.proposal.jobId;
	}
	return ordered;
}

export async function loadReducedCpuSearchEvidence(input: {
	controller: ResearchController;
	outputDir: string;
	arm: ReducedCpuStudyArm;
	branchId: string;
	calibration: ReducedCpuCalibration;
}): Promise<ReducedCpuCandidateEvidence[]> {
	await verifyReducedCpuStudyLedgerStrict(input.controller, input.outputDir);
	const branchJobs = input.controller.statusForBranch(input.branchId);
	const ordered = orderSearchJobs(searchJobsForArm(branchJobs, input.arm));
	if (ordered.length > REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM) {
		throw new Error("Search branch exceeds the four-candidate contract");
	}
	const recalled = await input.controller.recallWithCandidateContent(input.branchId, { limit: 20 });
	const contentByJobId = new Map(recalled.map((job) => [job.proposal.jobId, job.candidateContent]));
	return ordered.map((job, index) => {
		const candidateContent = contentByJobId.get(job.proposal.jobId);
		if (candidateContent === undefined) throw new Error(`Missing candidate artifact for ${job.proposal.jobId}`);
		return buildReducedCpuCandidateEvidence({
			job,
			candidateContent,
			arm: input.arm,
			branchId: input.branchId,
			ordinal: index + 1,
			priorJobId: index === 0 ? null : ordered[index - 1].proposal.jobId,
			calibration: input.calibration,
		});
	});
}

export async function prepareReducedCpuRetestDirective(input: {
	controller: ResearchController;
	outputDir: string;
	branchId: string;
	calibration: ReducedCpuCalibration;
}): Promise<SealedReducedCpuRetestDirective | null> {
	const candidates = await loadReducedCpuSearchEvidence({ ...input, arm: "M+R" });
	if (candidates.length !== 3) throw new Error("A retest directive is prepared only after exactly three candidates");
	const classification = classifyReducedCpuCandidateTwo(candidates[0], candidates[1]);
	const directive = maybeBuildReducedCpuRetestDirective(classification, candidates[2]);
	return directive === null ? null : sealReducedCpuRetestDirective(directive);
}

export async function submitReducedCpuSearchCandidate(
	options: SubmitReducedCpuSearchCandidateOptions,
): Promise<ReducedCpuStudyEvaluationEnvelope> {
	if (options.signal?.aborted) throw new Error("Search evaluation was aborted before submission");
	const request = parseReducedCpuCandidateRequest(options.request);
	const existing = await loadReducedCpuSearchEvidence(options);
	if (
		options.controller
			.statusForBranch(options.branchId)
			.some((job) => job.proposal.treatment === reducedCpuValidationTreatment(options.arm))
	) {
		throw new Error("Search submissions are closed after champion validation");
	}
	const ordinal = existing.length + 1;
	if (ordinal > REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM) throw new Error("Search submission budget is exhausted");
	if (ordinal === 2 && deriveReducedCpuSinglePassInsertion(existing[0].actions, request.actions) === null) {
		throw new Error("Candidate 2 must be candidate 1 plus exactly one unambiguous pass insertion");
	}
	let directiveSha256: string | null = null;
	if (options.arm === "M+R" && ordinal === 4) {
		const classification = classifyReducedCpuCandidateTwo(existing[0], existing[1]);
		const expectedDirective = maybeBuildReducedCpuRetestDirective(classification, existing[2]);
		if (expectedDirective !== null) {
			if (!options.sealedRetestDirective)
				throw new Error("M+R candidate 4 requires the eligible host retest directive");
			const expected = sealReducedCpuRetestDirective(expectedDirective);
			if (
				expected.directiveSha256 !== options.sealedRetestDirective.directiveSha256 ||
				!sameStrings(expected.directive.actions, request.actions)
			) {
				throw new Error("M+R candidate 4 does not match the ledger-derived sealed retest directive");
			}
			directiveSha256 = expected.directiveSha256;
		} else if (options.sealedRetestDirective) {
			throw new Error("A retest directive was supplied although R is dormant");
		}
	} else if (options.sealedRetestDirective) {
		throw new Error("Retest directives are accepted only for M+R candidate 4");
	}
	const parentJobIds = existing.length === 0 ? [] : [existing.at(-1)?.jobId ?? ""];
	const submitted = await options.controller.submit({
		branchId: options.branchId,
		lane: "compiler-gym",
		benchmarkIds: [...REDUCED_CPU_SEARCH_TASKS],
		budgetClass: "smoke",
		treatment: reducedCpuSearchTreatment(options.arm),
		proposal: {
			hypothesis: request.hypothesis,
			mechanism: request.mechanism,
			predictedOutcome: request.predictedOutcome,
			boundaryConditions: request.boundaryConditions,
			parentJobIds,
		},
		candidate: { format: "llvm-pass-sequence", content: JSON.stringify(request.actions) },
		requireFreshMeasurement: true,
	});
	if (submitted.duplicate) throw new Error(`Fresh search submission unexpectedly deduplicated: ${submitted.jobId}`);
	await waitForReducedCpuJobSettlement(options.controller, submitted.jobId, options.signal);
	await verifyReducedCpuStudyLedgerStrict(options.controller, options.outputDir);
	const jobs = options.controller.statusForBranch(options.branchId, [submitted.jobId]);
	if (jobs.length !== 1) throw new Error("Submitted search job is missing");
	const job = jobs[0];
	assertReducedCpuFreshSettledJob(job, "Search evaluator");
	return {
		schemaVersion: 1,
		type: "reduced_cpu_study_search_evaluation",
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		arm: options.arm,
		branchId: options.branchId,
		ordinal: ordinal as 1 | 2 | 3 | 4,
		request,
		submitted,
		job,
		budget: options.controller.budgetStatus(options.branchId),
		retestDirectiveSha256: directiveSha256,
	};
}

export async function submitReducedCpuChampionValidation(
	options: SubmitReducedCpuChampionValidationOptions,
): Promise<ReducedCpuChampionValidationEnvelope> {
	if (options.signal?.aborted) throw new Error("Champion validation was aborted before submission");
	const candidates = await loadReducedCpuSearchEvidence(options);
	if (candidates.length !== REDUCED_CPU_SEARCH_CANDIDATES_PER_ARM) {
		throw new Error("Champion validation requires exactly four search candidates");
	}
	const selection = selectReducedCpuChampion(options.arm, candidates, options.calibration);
	const champion = candidates.find((candidate) => candidate.jobId === selection.selectedJobId);
	if (!champion) throw new Error("No verifier-valid search champion is available for dijkstra validation");
	if (
		options.controller
			.statusForBranch(options.branchId)
			.some((job) => job.proposal.treatment === reducedCpuValidationTreatment(options.arm))
	) {
		throw new Error("Champion validation may be submitted only once");
	}
	const content = JSON.stringify(champion.actions);
	const submitted = await options.controller.submit({
		branchId: options.branchId,
		lane: "compiler-gym",
		benchmarkIds: [REDUCED_CPU_VALIDATION_TASK],
		budgetClass: "confirm",
		treatment: reducedCpuValidationTreatment(options.arm),
		proposal: {
			hypothesis: "The deterministic search champion transfers to the held-out dijkstra task",
			mechanism: "Evaluate identical content-addressed champion bytes under the same verifier epoch",
			predictedOutcome: "A fresh accepted dijkstra measurement without search-task leakage",
			boundaryConditions: [
				"host-selected champion",
				"one held-out task",
				"fresh measurement only",
				"no retry or measurement reuse",
			],
			parentJobIds: [champion.jobId],
		},
		candidate: { format: "llvm-pass-sequence", content },
		requireFreshMeasurement: true,
	});
	if (submitted.duplicate) throw new Error(`Fresh validation unexpectedly deduplicated: ${submitted.jobId}`);
	await waitForReducedCpuJobSettlement(options.controller, submitted.jobId, options.signal);
	await verifyReducedCpuStudyLedgerStrict(options.controller, options.outputDir);
	const jobs = options.controller.statusForBranch(options.branchId, [submitted.jobId]);
	if (jobs.length !== 1) throw new Error("Submitted champion validation is missing");
	const job = jobs[0];
	assertReducedCpuFreshSettledJob(job, "Champion validation");
	const validation = buildReducedCpuChampionValidationEvidence({
		job,
		candidateContent: content,
		arm: options.arm,
		branchId: options.branchId,
		searchChampion: champion,
		calibration: options.calibration,
	});
	return {
		schemaVersion: 1,
		type: "reduced_cpu_study_champion_validation",
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		arm: options.arm,
		branchId: options.branchId,
		championSelection: selection,
		submitted,
		job,
		validation,
		budget: options.controller.budgetStatus(options.branchId),
	};
}

export async function verifyReducedCpuStudyArtifacts(input: {
	controller: ResearchController;
	outputDir: string;
	branchId: string;
}): Promise<{ verifiedArtifactRefs: number }> {
	await verifyReducedCpuStudyLedgerStrict(input.controller, input.outputDir);
	const store = new ArtifactStore(join(resolve(input.outputDir), "artifacts"));
	let verifiedArtifactRefs = 0;
	for (const job of input.controller.statusForBranch(input.branchId)) {
		await store.readString(job.proposal.candidate);
		verifiedArtifactRefs++;
		if (job.measurement?.stdout) {
			await store.readString(job.measurement.stdout);
			verifiedArtifactRefs++;
		}
		if (job.measurement?.stderr) {
			await store.readString(job.measurement.stderr);
			verifiedArtifactRefs++;
		}
	}
	return { verifiedArtifactRefs };
}

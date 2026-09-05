import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import {
	COMPILER_GYM_CBENCH_PATCH_SHA256,
	COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	COMPILER_GYM_LIBTINFO_SHA256,
	COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	COMPILER_GYM_VERIFIER_EPOCH,
	DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
} from "./compiler-gym-adapter.js";
import type { JobView, SubmitRequest } from "./types.js";

export type RResurrectionCellId = "A" | "A+X" | "A+E" | "A+E+X";

interface RResurrectionCandidateDefinition {
	readonly cellId: RResurrectionCellId;
	readonly treatment: string;
	readonly actions: readonly string[];
	readonly candidateContent: string;
	readonly candidateSha256: string;
	readonly parentCellIds: readonly RResurrectionCellId[];
	readonly hypothesis: string;
	readonly mechanism: string;
	readonly predictedOutcome: string;
}

export interface RResurrectionCellObservation {
	cellId: RResurrectionCellId;
	treatment: string;
	jobId: string | null;
	manifestDigest: string | null;
	candidateSha256: string | null;
	state: string | null;
	verifierValid: boolean;
	metrics: Record<string, number | null>;
	errors: string[];
}

export interface RResurrectionTaskEffect {
	benchmarkId: string;
	a: number | null;
	aPlusX: number | null;
	aPlusE: number | null;
	aPlusEPlusX: number | null;
	xDeltaOnA: number | null;
	xDeltaAfterE: number | null;
	xNonImprovingOnA: boolean;
	xNonWorseAfterE: boolean;
	xStrictlyImprovesAfterE: boolean;
}

export interface RResurrectionQualificationDecision {
	schemaVersion: 1;
	protocol: typeof R_RESURRECTION_PROTOCOL;
	outcome: "passed" | "mechanism-not-demonstrated" | "invalid";
	gatePassed: boolean;
	allVerifierValid: boolean;
	compatibilityPassed: boolean;
	compatibilityDigest: string | null;
	verifierEpoch: string | null;
	hardwareSha256: string | null;
	provenanceSha256: string | null;
	taskSetSha256: string;
	integrityErrors: string[];
	mechanismFailures: string[];
	criteria: {
		xNonImprovingOnAForBothTasks: boolean;
		xNonWorseAfterEForBothTasks: boolean;
		xStrictlyImprovesAfterEOnAtLeastOneTask: boolean;
	};
	observations: RResurrectionCellObservation[];
	effects: RResurrectionTaskEffect[];
}

export const R_RESURRECTION_PROTOCOL = "compiler-gym-r-resurrection-2x2-v1" as const;
export const R_RESURRECTION_BRANCH_ID = "r-resurrection-qualification-v1" as const;
export const R_RESURRECTION_TASKS = ["benchmark://cbench-v1/blowfish", "benchmark://cbench-v1/bzip2"] as const;
export const R_RESURRECTION_MAX_SUBMISSIONS = 4 as const;
export const R_RESURRECTION_MAX_TASK_EVALUATIONS = 8 as const;
export const R_RESURRECTION_EVALUATOR_SHA256 =
	"1e78543b47d2142fd18f6bc8b66ebde8134700f73032290e78b279d02ef67266" as const;

const BOUNDARY_CONDITIONS = [
	"evaluator-only qualification; no model API",
	"exact blowfish and bzip2 task set",
	`exact verifier epoch ${COMPILER_GYM_VERIFIER_EPOCH}`,
	"raw IrInstructionCount after all 20 semantic callbacks pass",
	"four frozen candidates and no adaptive substitutions",
] as const;

export const R_RESURRECTION_CANDIDATES = [
	{
		cellId: "A",
		treatment: "R-resurrection:A",
		actions: ["-mem2reg", "-instcombine"],
		candidateContent: '["-mem2reg","-instcombine"]',
		candidateSha256: "91e4c427c8ec067146d930f5215b4833cfeea597c1e79ee508364b951d4ccd6d",
		parentCellIds: [],
		hypothesis: "A is the fixed context-free reference stack for testing X",
		mechanism: "mem2reg and instcombine expose the baseline simplification opportunities",
		predictedOutcome: "A establishes accepted task-local IR counts for both programs",
	},
	{
		cellId: "A+X",
		treatment: "R-resurrection:A+X",
		actions: ["-mem2reg", "-instcombine", "-adce"],
		candidateContent: '["-mem2reg","-instcombine","-adce"]',
		candidateSha256: "44831213a043c5bf27aecfbddcb4ac07aac02892e5535ef24c22352b728b4e6c",
		parentCellIds: ["A"],
		hypothesis: "X is dormant or harmful in the A context",
		mechanism: "adce has no enabling sroa transformation before it",
		predictedOutcome: "A+X does not reduce IR count relative to A on either task",
	},
	{
		cellId: "A+E",
		treatment: "R-resurrection:A+E",
		actions: ["-sroa", "-mem2reg", "-instcombine"],
		candidateContent: '["-sroa","-mem2reg","-instcombine"]',
		candidateSha256: "8277400df3c0f4c1704d3da1ddb70061bd8464b568c1abfed31b98ad7c83a83c",
		parentCellIds: ["A"],
		hypothesis: "E changes the optimization context available to X",
		mechanism: "sroa exposes scalarized code before mem2reg and instcombine",
		predictedOutcome: "A+E establishes the enabled-context reference for testing X",
	},
	{
		cellId: "A+E+X",
		treatment: "R-resurrection:A+E+X",
		actions: ["-sroa", "-mem2reg", "-instcombine", "-adce"],
		candidateContent: '["-sroa","-mem2reg","-instcombine","-adce"]',
		candidateSha256: "95e69820546695075027b31db6027c04d76303fef98d9d8567410c0214e5f9fe",
		parentCellIds: ["A+X", "A+E"],
		hypothesis: "E resurrects X by exposing dead code that adce can remove",
		mechanism: "sroa changes the program so adce becomes conditionally useful",
		predictedOutcome: "A+E+X is non-worse than A+E on both tasks and strictly better on at least one",
	},
] as const satisfies readonly RResurrectionCandidateDefinition[];

export const R_RESURRECTION_CANDIDATE_DEFINITIONS_SHA256 =
	"b793ea1fcd7eeaf3db14a8a537455d927db86fc261a1aa1ebf26bd8eba08c0ac" as const;

export const R_RESURRECTION_EXPECTED_HARDWARE = {
	cluster: "Stanford FarmShare",
	partition: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.partition,
	cpuConstraint: DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG.cpuConstraint,
} as const;

export const R_RESURRECTION_EXPECTED_PROVENANCE = {
	adapter: "farmshare-compiler-gym",
	evaluatorSha256: R_RESURRECTION_EVALUATOR_SHA256,
	environmentSpecSha256: COMPILER_GYM_ENVIRONMENT_SPEC_SHA256,
	cbenchPatchSha256: COMPILER_GYM_CBENCH_PATCH_SHA256,
	upstreamCbenchSourceSha256: COMPILER_GYM_UPSTREAM_CBENCH_SHA256,
	installedCbenchSourceSha256: COMPILER_GYM_INSTALLED_CBENCH_SHA256,
	distributionManifestSha256: COMPILER_GYM_DISTRIBUTION_MANIFEST_SHA256,
	compatibilityTreeManifestSha256: COMPILER_GYM_COMPATIBILITY_TREE_SHA256,
	libtinfoSha256: COMPILER_GYM_LIBTINFO_SHA256,
	compilerGym: "0.2.5",
	llvm: "10.0.0",
} as const;

export const R_RESURRECTION_QUALIFICATION_CONFIG = {
	schemaVersion: 1,
	type: "compiler_gym_r_resurrection_qualification",
	protocol: R_RESURRECTION_PROTOCOL,
	campaignId: FROZEN_CAMPAIGN.id,
	campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
	branchId: R_RESURRECTION_BRANCH_ID,
	lane: "compiler-gym",
	usesModelApi: false,
	tasks: R_RESURRECTION_TASKS,
	budgetClass: "smoke",
	metric: { name: "IrInstructionCount", direction: "minimize" },
	verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
	hardware: R_RESURRECTION_EXPECTED_HARDWARE,
	provenance: R_RESURRECTION_EXPECTED_PROVENANCE,
	hardBudgets: {
		maxSubmissions: R_RESURRECTION_MAX_SUBMISSIONS,
		maxLogicalTaskEvaluations: R_RESURRECTION_MAX_TASK_EVALUATIONS,
		maxInflightSubmissions: 4,
		maxParallelTasksPerSubmission: 1,
	},
	candidateDefinitionsSha256: R_RESURRECTION_CANDIDATE_DEFINITIONS_SHA256,
	candidates: R_RESURRECTION_CANDIDATES,
	compatibilityPolicy: {
		requireSameVerifierEpoch: true,
		requireSameHardware: true,
		requireSameProvenance: true,
		requireExactTaskSet: true,
		crossEpochAggregation: "forbidden",
	},
	mechanismGate: {
		xNonImprovingOnAForBothTasks: true,
		xNonWorseAfterEForBothTasks: true,
		xStrictlyImprovesAfterEOnAtLeastOneTask: true,
		allVerifierValid: true,
	},
} as const;

export const R_RESURRECTION_QUALIFICATION_CONFIG_SHA256 =
	"d97a173b515ff22cdd647ffbdd27ced728f3ba80e57e3e004545091aacc245bf" as const;

const DEFINITION_BY_CELL = new Map<RResurrectionCellId, RResurrectionCandidateDefinition>(
	R_RESURRECTION_CANDIDATES.map((definition) => [definition.cellId, definition]),
);

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedStrings(values: readonly string[]): string[] {
	return [...values].sort();
}

function candidateDefinition(cellId: RResurrectionCellId): RResurrectionCandidateDefinition {
	const definition = DEFINITION_BY_CELL.get(cellId);
	if (!definition) throw new Error(`Missing R resurrection candidate definition for ${cellId}`);
	return definition;
}

export function assertRResurrectionQualificationPins(): void {
	for (const definition of R_RESURRECTION_CANDIDATES) {
		if (definition.candidateContent !== JSON.stringify(definition.actions)) {
			throw new Error(`${definition.cellId} candidate content is not the canonical action-array encoding`);
		}
		const digest = sha256Text(definition.candidateContent);
		if (digest !== definition.candidateSha256) {
			throw new Error(
				`${definition.cellId} candidate SHA-256 mismatch: expected ${definition.candidateSha256}, got ${digest}`,
			);
		}
	}
	const definitionsDigest = sha256Json(R_RESURRECTION_CANDIDATES);
	if (definitionsDigest !== R_RESURRECTION_CANDIDATE_DEFINITIONS_SHA256) {
		throw new Error(
			`R resurrection candidate-definition SHA-256 mismatch: expected ${R_RESURRECTION_CANDIDATE_DEFINITIONS_SHA256}, got ${definitionsDigest}`,
		);
	}
	const configDigest = sha256Json(R_RESURRECTION_QUALIFICATION_CONFIG);
	if (configDigest !== R_RESURRECTION_QUALIFICATION_CONFIG_SHA256) {
		throw new Error(
			`R resurrection config SHA-256 mismatch: expected ${R_RESURRECTION_QUALIFICATION_CONFIG_SHA256}, got ${configDigest}`,
		);
	}
}

export function buildRResurrectionSubmitRequest(
	cellId: RResurrectionCellId,
	parentJobIds: readonly string[],
): SubmitRequest {
	const definition = candidateDefinition(cellId);
	if (parentJobIds.length !== definition.parentCellIds.length) {
		throw new Error(`${cellId} requires ${definition.parentCellIds.length} parent job IDs`);
	}
	return {
		branchId: R_RESURRECTION_BRANCH_ID,
		lane: "compiler-gym",
		benchmarkIds: [...R_RESURRECTION_TASKS],
		budgetClass: "smoke",
		treatment: definition.treatment,
		proposal: {
			hypothesis: definition.hypothesis,
			mechanism: definition.mechanism,
			predictedOutcome: definition.predictedOutcome,
			boundaryConditions: [...BOUNDARY_CONDITIONS],
			parentJobIds: [...parentJobIds],
		},
		candidate: { format: "llvm-pass-sequence", content: definition.candidateContent },
	};
}

function compatibilityDigest(job: JobView): string | null {
	const measurement = job.measurement;
	if (!measurement) return null;
	return sha256Json({
		policy: "candidate-paired-v1",
		lane: "compiler-gym",
		verifierEpoch: measurement.verifierEpoch,
		benchmarkIds: sortedStrings(measurement.tasks.map((task) => task.benchmarkId)),
		budgetClass: job.proposal.budgetClass,
		candidateFormat: job.proposal.candidateFormat,
		hardware: measurement.hardware,
		provenance: measurement.provenance,
	});
}

function expectedParentJobIds(
	definition: RResurrectionCandidateDefinition,
	jobsByCell: ReadonlyMap<RResurrectionCellId, JobView>,
): string[] | null {
	const result: string[] = [];
	for (const parentCellId of definition.parentCellIds) {
		const parent = jobsByCell.get(parentCellId);
		if (!parent) return null;
		result.push(parent.proposal.jobId);
	}
	return result;
}

function expectedManifestDigest(request: SubmitRequest, job: JobView): string {
	return sha256Json({
		branchId: request.branchId,
		lane: request.lane,
		benchmarkIds: sortedStrings(request.benchmarkIds),
		budgetClass: request.budgetClass,
		treatment: request.treatment,
		proposal: request.proposal,
		candidate: job.proposal.candidate,
		candidateFormat: request.candidate.format,
	});
}

function observeCell(
	definition: RResurrectionCandidateDefinition,
	job: JobView | undefined,
	jobsByCell: ReadonlyMap<RResurrectionCellId, JobView>,
): RResurrectionCellObservation {
	const errors: string[] = [];
	const metrics = Object.fromEntries(R_RESURRECTION_TASKS.map((task) => [task, null])) as Record<
		string,
		number | null
	>;
	if (!job) {
		errors.push(`missing job for cell ${definition.cellId}`);
		return {
			cellId: definition.cellId,
			treatment: definition.treatment,
			jobId: null,
			manifestDigest: null,
			candidateSha256: null,
			state: null,
			verifierValid: false,
			metrics,
			errors,
		};
	}

	if (job.proposal.branchId !== R_RESURRECTION_BRANCH_ID) errors.push("branch ID mismatch");
	if (job.proposal.lane !== "compiler-gym") errors.push("lane mismatch");
	if (job.proposal.budgetClass !== "smoke") errors.push("budget class mismatch");
	if (job.proposal.treatment !== definition.treatment) errors.push("treatment mismatch");
	if (job.proposal.candidateFormat !== "llvm-pass-sequence") errors.push("candidate format mismatch");
	if (!sameStringArray(sortedStrings(job.proposal.benchmarkIds), sortedStrings(R_RESURRECTION_TASKS))) {
		errors.push("proposal task set mismatch");
	}
	if (job.proposal.candidate.digest !== definition.candidateSha256) errors.push("candidate SHA-256 mismatch");
	if (job.proposal.candidate.byteLength !== Buffer.byteLength(definition.candidateContent)) {
		errors.push("candidate byte length mismatch");
	}
	if (job.proposal.candidate.mediaType !== "application/vnd.prime.llvm-pass-sequence") {
		errors.push("candidate media type mismatch");
	}

	const parentJobIds = expectedParentJobIds(definition, jobsByCell);
	if (parentJobIds === null) {
		errors.push("expected parent job is missing");
	} else {
		const expectedRequest = buildRResurrectionSubmitRequest(definition.cellId, parentJobIds);
		if (sha256Json(job.proposal.proposal) !== sha256Json(expectedRequest.proposal)) {
			errors.push("proposal definition or lineage mismatch");
		}
		const manifestDigest = expectedManifestDigest(expectedRequest, job);
		if (job.proposal.manifestDigest !== manifestDigest) errors.push("proposal manifest digest mismatch");
		if (job.proposal.jobId !== `job_${manifestDigest.slice(0, 24)}`) errors.push("job ID mismatch");
	}

	if (job.state.jobId !== job.proposal.jobId) errors.push("job state identity mismatch");
	if (job.state.status !== "succeeded") errors.push(`job status is ${job.state.status}, not succeeded`);
	const measurement = job.measurement;
	if (!measurement) {
		errors.push("measurement is missing");
	} else {
		if (measurement.jobId !== job.proposal.jobId) errors.push("measurement job identity mismatch");
		if (measurement.manifestDigest !== job.proposal.manifestDigest) {
			errors.push("measurement manifest digest mismatch");
		}
		if (measurement.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) errors.push("verifier epoch mismatch");
		if (sha256Json(measurement.hardware) !== sha256Json(R_RESURRECTION_EXPECTED_HARDWARE)) {
			errors.push("hardware provenance does not match the pinned contract");
		}
		if (sha256Json(measurement.provenance) !== sha256Json(R_RESURRECTION_EXPECTED_PROVENANCE)) {
			errors.push("evaluator provenance does not match the pinned contract");
		}
		const measuredTasks = sortedStrings(measurement.tasks.map((task) => task.benchmarkId));
		if (
			new Set(measuredTasks).size !== measuredTasks.length ||
			!sameStringArray(measuredTasks, sortedStrings(R_RESURRECTION_TASKS))
		) {
			errors.push("measurement task set mismatch");
		}
		for (const benchmarkId of R_RESURRECTION_TASKS) {
			const task = measurement.tasks.find((candidate) => candidate.benchmarkId === benchmarkId);
			if (!task) continue;
			if (task.status !== "accepted") errors.push(`${benchmarkId} status is ${task.status}, not accepted`);
			if (!task.verifier.passed) errors.push(`${benchmarkId} verifier failed`);
			const value = task.metrics.IrInstructionCount;
			if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
				errors.push(`${benchmarkId} has an invalid IrInstructionCount`);
			} else {
				metrics[benchmarkId] = value;
			}
		}
	}

	return {
		cellId: definition.cellId,
		treatment: definition.treatment,
		jobId: job.proposal.jobId,
		manifestDigest: job.proposal.manifestDigest,
		candidateSha256: job.proposal.candidate.digest,
		state: job.state.status,
		verifierValid: errors.length === 0,
		metrics,
		errors,
	};
}

export function decideRResurrectionQualification(jobs: readonly JobView[]): RResurrectionQualificationDecision {
	const jobsByTreatment = new Map<string, JobView>();
	const duplicateTreatments = new Set<string>();
	for (const job of jobs) {
		const treatment = job.proposal.treatment;
		if (jobsByTreatment.has(treatment)) duplicateTreatments.add(treatment);
		else jobsByTreatment.set(treatment, job);
	}
	const jobsByCell = new Map<RResurrectionCellId, JobView>();
	for (const definition of R_RESURRECTION_CANDIDATES) {
		const job = jobsByTreatment.get(definition.treatment);
		if (job) jobsByCell.set(definition.cellId, job);
	}

	const observations = R_RESURRECTION_CANDIDATES.map((definition) =>
		observeCell(definition, jobsByCell.get(definition.cellId), jobsByCell),
	);
	const integrityErrors: string[] = [];
	if (jobs.length !== R_RESURRECTION_MAX_SUBMISSIONS) {
		integrityErrors.push(`expected exactly ${R_RESURRECTION_MAX_SUBMISSIONS} jobs, received ${jobs.length}`);
	}
	for (const treatment of [...duplicateTreatments].sort()) {
		integrityErrors.push(`duplicate treatment job: ${treatment}`);
	}
	const allowedTreatments = new Set<string>(R_RESURRECTION_CANDIDATES.map((definition) => definition.treatment));
	for (const treatment of [...jobsByTreatment.keys()].filter((value) => !allowedTreatments.has(value)).sort()) {
		integrityErrors.push(`unexpected treatment job: ${treatment}`);
	}
	for (const observation of observations) {
		for (const error of observation.errors) integrityErrors.push(`${observation.cellId}: ${error}`);
	}

	const candidateJobs = [...jobsByCell.values()];
	const verifierEpochs = new Set(
		candidateJobs
			.map((job) => job.measurement?.verifierEpoch)
			.filter((value): value is string => value !== undefined),
	);
	const hardwareDigests = new Set(
		candidateJobs.map((job) => job.measurement && sha256Json(job.measurement.hardware)).filter(Boolean),
	);
	const provenanceDigests = new Set(
		candidateJobs.map((job) => job.measurement && sha256Json(job.measurement.provenance)).filter(Boolean),
	);
	const compatibilityDigests = new Set(
		candidateJobs.map(compatibilityDigest).filter((value): value is string => !!value),
	);
	if (verifierEpochs.size !== 1) integrityErrors.push("cells do not share exactly one verifier epoch");
	if (hardwareDigests.size !== 1) integrityErrors.push("cells do not share identical hardware provenance");
	if (provenanceDigests.size !== 1) integrityErrors.push("cells do not share identical evaluator provenance");
	if (compatibilityDigests.size !== 1) integrityErrors.push("cells do not share one controller compatibility stratum");

	const observationByCell = new Map(observations.map((observation) => [observation.cellId, observation]));
	const value = (cellId: RResurrectionCellId, benchmarkId: string): number | null =>
		observationByCell.get(cellId)?.metrics[benchmarkId] ?? null;
	const effects = R_RESURRECTION_TASKS.map((benchmarkId): RResurrectionTaskEffect => {
		const a = value("A", benchmarkId);
		const aPlusX = value("A+X", benchmarkId);
		const aPlusE = value("A+E", benchmarkId);
		const aPlusEPlusX = value("A+E+X", benchmarkId);
		const xDeltaOnA = a === null || aPlusX === null ? null : aPlusX - a;
		const xDeltaAfterE = aPlusE === null || aPlusEPlusX === null ? null : aPlusEPlusX - aPlusE;
		return {
			benchmarkId,
			a,
			aPlusX,
			aPlusE,
			aPlusEPlusX,
			xDeltaOnA,
			xDeltaAfterE,
			xNonImprovingOnA: xDeltaOnA !== null && xDeltaOnA >= 0,
			xNonWorseAfterE: xDeltaAfterE !== null && xDeltaAfterE <= 0,
			xStrictlyImprovesAfterE: xDeltaAfterE !== null && xDeltaAfterE < 0,
		};
	});
	const allVerifierValid = observations.every((observation) => observation.verifierValid);
	const compatibilityPassed =
		candidateJobs.length === R_RESURRECTION_MAX_SUBMISSIONS &&
		verifierEpochs.size === 1 &&
		hardwareDigests.size === 1 &&
		provenanceDigests.size === 1 &&
		compatibilityDigests.size === 1;
	const criteria = {
		xNonImprovingOnAForBothTasks: effects.every((effect) => effect.xNonImprovingOnA),
		xNonWorseAfterEForBothTasks: effects.every((effect) => effect.xNonWorseAfterE),
		xStrictlyImprovesAfterEOnAtLeastOneTask: effects.some((effect) => effect.xStrictlyImprovesAfterE),
	};
	const mechanismFailures: string[] = [];
	if (integrityErrors.length === 0) {
		if (!criteria.xNonImprovingOnAForBothTasks) mechanismFailures.push("X improves A on at least one task");
		if (!criteria.xNonWorseAfterEForBothTasks) mechanismFailures.push("X worsens A+E on at least one task");
		if (!criteria.xStrictlyImprovesAfterEOnAtLeastOneTask) {
			mechanismFailures.push("X does not strictly improve A+E on either task");
		}
	}
	const gatePassed = integrityErrors.length === 0 && mechanismFailures.length === 0;
	const outcome = integrityErrors.length > 0 ? "invalid" : gatePassed ? "passed" : "mechanism-not-demonstrated";

	return {
		schemaVersion: 1,
		protocol: R_RESURRECTION_PROTOCOL,
		outcome,
		gatePassed,
		allVerifierValid,
		compatibilityPassed,
		compatibilityDigest: compatibilityDigests.size === 1 ? ([...compatibilityDigests][0] ?? null) : null,
		verifierEpoch: verifierEpochs.size === 1 ? ([...verifierEpochs][0] ?? null) : null,
		hardwareSha256: hardwareDigests.size === 1 ? ([...hardwareDigests][0] ?? null) : null,
		provenanceSha256: provenanceDigests.size === 1 ? ([...provenanceDigests][0] ?? null) : null,
		taskSetSha256: sha256Json(sortedStrings(R_RESURRECTION_TASKS)),
		integrityErrors,
		mechanismFailures,
		criteria,
		observations,
		effects,
	};
}

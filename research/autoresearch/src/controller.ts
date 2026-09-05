import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, type JsonValue, sha256Json } from "./canonical-json.js";
import {
	EVALUATION_ADAPTER_OUTPUT_ERROR_PROTOCOL,
	EvaluationAdapterOutputError,
} from "./evaluation-adapter-output-error.js";
import { EvidenceLedger } from "./ledger.js";
import type {
	ArtifactRef,
	BenchmarkLane,
	BranchBudgetStatus,
	ComparisonResult,
	DeterministicMeasurementReuseContract,
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	JobStateRecord,
	JobStatus,
	JobView,
	LaneMetric,
	MeasurementRecord,
	MeasurementReuseProvenance,
	ProposalDetails,
	ProposalRecord,
	RecallQuery,
	SubmitRequest,
	SubmitResult,
	TaskMeasurement,
} from "./types.js";

export interface ControllerOptions {
	ledgerPath: string;
	artifactDir: string;
	adapters: EvaluationAdapter[];
	metrics: Record<BenchmarkLane, LaneMetric>;
	allowedBenchmarks: Record<BenchmarkLane, readonly string[]>;
	maxInflight?: Partial<Record<BenchmarkLane, number>>;
	maxGpuInflight?: number;
	allowedTreatments?: readonly string[];
	maxSubmissionsPerBranch?: number;
	maxTaskEvaluationsPerBranch?: number;
	now?: () => Date;
}

interface InternalJob {
	proposal: ProposalRecord;
	state: JobStateRecord;
	measurement: MeasurementRecord | null;
	measurementEventHash: string | null;
	acceptedAt: string;
}

interface CandidateEvidence {
	job: InternalJob;
	verifierEpoch: string;
	compatibilityDigest: string;
	benchmarkIds: string[];
	values: Map<string, number>;
	aggregate: number;
}

const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "invalid", "failed", "cancelled"]);
const GPU_LANES = new Set<BenchmarkLane>(["kernelbench", "nanogpt"]);
const FARMSHARE_GPU_QOS_LIMIT = 4;
const VALID_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
	accepted: ["queued", "failed", "cancelled"],
	queued: ["running", "failed", "cancelled"],
	running: ["succeeded", "invalid", "failed", "cancelled"],
	succeeded: [],
	invalid: [],
	failed: [],
	cancelled: [],
};

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: JsonValue, path: string): { [key: string]: JsonValue } {
	if (!isRecord(value)) throw new Error(`Expected object at ${path}`);
	return value;
}

function expectString(value: JsonValue | undefined, path: string): string {
	if (typeof value !== "string") throw new Error(`Expected string at ${path}`);
	return value;
}

function expectNumber(value: JsonValue | undefined, path: string): number {
	if (typeof value !== "number") throw new Error(`Expected number at ${path}`);
	return value;
}

function expectBoolean(value: JsonValue | undefined, path: string): boolean {
	if (typeof value !== "boolean") throw new Error(`Expected boolean at ${path}`);
	return value;
}

function expectNullableString(value: JsonValue | undefined, path: string): string | null {
	if (value === null) return null;
	return expectString(value, path);
}

function expectStringArray(value: JsonValue | undefined, path: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`Expected string array at ${path}`);
	}
	return [...value];
}

function expectStringRecord(value: JsonValue | undefined, path: string): Record<string, string> {
	const record = value === undefined ? undefined : expectRecord(value, path);
	if (!record) throw new Error(`Expected object at ${path}`);
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(record)) result[key] = expectString(item, `${path}.${key}`);
	return result;
}

function expectNumberRecord(value: JsonValue | undefined, path: string): Record<string, number> {
	const record = value === undefined ? undefined : expectRecord(value, path);
	if (!record) throw new Error(`Expected object at ${path}`);
	const result: Record<string, number> = {};
	for (const [key, item] of Object.entries(record)) result[key] = expectNumber(item, `${path}.${key}`);
	return result;
}

function copyStringRecord(value: Readonly<Record<string, string>>, path: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") throw new Error(`Expected string at ${path}.${key}`);
		result[key] = item;
	}
	return result;
}

function parseArtifact(value: JsonValue | undefined, path: string): ArtifactRef {
	const record = value === undefined ? undefined : expectRecord(value, path);
	if (!record) throw new Error(`Expected artifact at ${path}`);
	return {
		digest: expectString(record.digest, `${path}.digest`),
		byteLength: expectNumber(record.byteLength, `${path}.byteLength`),
		mediaType: expectString(record.mediaType, `${path}.mediaType`),
	};
}

function parseNullableArtifact(value: JsonValue | undefined, path: string): ArtifactRef | null {
	if (value === null) return null;
	return parseArtifact(value, path);
}

function parseProposalDetails(value: JsonValue | undefined, path: string): ProposalDetails {
	const record = value === undefined ? undefined : expectRecord(value, path);
	if (!record) throw new Error(`Expected proposal details at ${path}`);
	return {
		hypothesis: expectString(record.hypothesis, `${path}.hypothesis`),
		mechanism: expectString(record.mechanism, `${path}.mechanism`),
		predictedOutcome: expectString(record.predictedOutcome, `${path}.predictedOutcome`),
		boundaryConditions: expectStringArray(record.boundaryConditions, `${path}.boundaryConditions`),
		parentJobIds: expectStringArray(record.parentJobIds, `${path}.parentJobIds`),
	};
}

function parseLane(value: JsonValue | undefined, path: string): BenchmarkLane {
	const lane = expectString(value, path);
	if (lane !== "compiler-gym" && lane !== "kernelbench" && lane !== "nanogpt") {
		throw new Error(`Invalid benchmark lane at ${path}: ${lane}`);
	}
	return lane;
}

function parseStatus(value: JsonValue | undefined, path: string): JobStatus {
	const status = expectString(value, path);
	if (!(status in VALID_TRANSITIONS)) throw new Error(`Invalid job status at ${path}: ${status}`);
	return status as JobStatus;
}

function parseProposal(value: JsonValue): ProposalRecord {
	const record = expectRecord(value, "proposal");
	const budgetClass = expectString(record.budgetClass, "proposal.budgetClass");
	if (budgetClass !== "smoke" && budgetClass !== "screen" && budgetClass !== "confirm") {
		throw new Error(`Invalid budget class: ${budgetClass}`);
	}
	const candidateFormat = expectString(record.candidateFormat, "proposal.candidateFormat");
	if (
		candidateFormat !== "llvm-pass-sequence" &&
		candidateFormat !== "python-source" &&
		candidateFormat !== "unified-diff"
	) {
		throw new Error(`Invalid candidate format: ${candidateFormat}`);
	}
	const proposal: ProposalRecord = {
		jobId: expectString(record.jobId, "proposal.jobId"),
		manifestDigest: expectString(record.manifestDigest, "proposal.manifestDigest"),
		branchId: expectString(record.branchId, "proposal.branchId"),
		lane: parseLane(record.lane, "proposal.lane"),
		benchmarkIds: expectStringArray(record.benchmarkIds, "proposal.benchmarkIds"),
		budgetClass,
		treatment: expectString(record.treatment, "proposal.treatment"),
		proposal: parseProposalDetails(record.proposal, "proposal.proposal"),
		candidate: parseArtifact(record.candidate, "proposal.candidate"),
		candidateFormat,
	};
	if (record.requireFreshMeasurement !== undefined) {
		if (expectBoolean(record.requireFreshMeasurement, "proposal.requireFreshMeasurement") !== true) {
			throw new Error("proposal.requireFreshMeasurement must be true when present");
		}
		proposal.requireFreshMeasurement = true;
	}
	return proposal;
}

function parseState(value: JsonValue): JobStateRecord {
	const record = expectRecord(value, "job_state");
	return {
		jobId: expectString(record.jobId, "job_state.jobId"),
		status: parseStatus(record.status, "job_state.status"),
		statusAt: expectString(record.statusAt, "job_state.statusAt"),
		externalJobId: expectNullableString(record.externalJobId, "job_state.externalJobId"),
		reason: expectNullableString(record.reason, "job_state.reason"),
	};
}

function parseTaskMeasurement(value: JsonValue, path: string): TaskMeasurement {
	const record = expectRecord(value, path);
	const status = expectString(record.status, `${path}.status`);
	if (status !== "accepted" && status !== "rejected" && status !== "failed") {
		throw new Error(`Invalid task status at ${path}.status`);
	}
	const verifier = expectRecord(record.verifier ?? null, `${path}.verifier`);
	return {
		benchmarkId: expectString(record.benchmarkId, `${path}.benchmarkId`),
		status,
		metrics: expectNumberRecord(record.metrics, `${path}.metrics`),
		verifier: {
			passed: expectBoolean(verifier.passed, `${path}.verifier.passed`),
			checks: expectStringArray(verifier.checks, `${path}.verifier.checks`),
			errors: expectStringArray(verifier.errors, `${path}.verifier.errors`),
		},
		runtimeMs: expectNumber(record.runtimeMs, `${path}.runtimeMs`),
	};
}

function parseMeasurementReuse(value: JsonValue | undefined): MeasurementReuseProvenance {
	const record = value === undefined ? undefined : expectRecord(value, "measurement.reuse");
	if (!record) throw new Error("Expected object at measurement.reuse");
	const policy = expectString(record.policy, "measurement.reuse.policy");
	if (policy !== "deterministic-verified-measurement-v1") {
		throw new Error(`Invalid measurement reuse policy: ${policy}`);
	}
	return {
		policy,
		contractKey: expectString(record.contractKey, "measurement.reuse.contractKey"),
		compatibilityDigest: expectString(record.compatibilityDigest, "measurement.reuse.compatibilityDigest"),
		sourceJobId: expectString(record.sourceJobId, "measurement.reuse.sourceJobId"),
		sourceManifestDigest: expectString(record.sourceManifestDigest, "measurement.reuse.sourceManifestDigest"),
		sourceMeasurementDigest: expectString(
			record.sourceMeasurementDigest,
			"measurement.reuse.sourceMeasurementDigest",
		),
		sourceMeasurementEventHash: expectString(
			record.sourceMeasurementEventHash,
			"measurement.reuse.sourceMeasurementEventHash",
		),
		reusedMetricNames: expectStringArray(record.reusedMetricNames, "measurement.reuse.reusedMetricNames"),
	};
}

function parseMeasurement(value: JsonValue): MeasurementRecord {
	const record = expectRecord(value, "measurement");
	if (!Array.isArray(record.tasks)) throw new Error("Expected array at measurement.tasks");
	const measurement: MeasurementRecord = {
		jobId: expectString(record.jobId, "measurement.jobId"),
		manifestDigest: expectString(record.manifestDigest, "measurement.manifestDigest"),
		verifierEpoch: expectString(record.verifierEpoch, "measurement.verifierEpoch"),
		measuredAt: expectString(record.measuredAt, "measurement.measuredAt"),
		tasks: record.tasks.map((task, index) => parseTaskMeasurement(task, `measurement.tasks[${index}]`)),
		hardware: expectStringRecord(record.hardware, "measurement.hardware"),
		provenance: expectStringRecord(record.provenance, "measurement.provenance"),
		stdout: parseNullableArtifact(record.stdout, "measurement.stdout"),
		stderr: parseNullableArtifact(record.stderr, "measurement.stderr"),
	};
	if (record.reuse !== undefined) measurement.reuse = parseMeasurementReuse(record.reuse);
	return measurement;
}

function candidateMediaType(lane: BenchmarkLane): string {
	switch (lane) {
		case "compiler-gym":
			return "application/vnd.prime.llvm-pass-sequence";
		case "kernelbench":
			return "text/x-python";
		case "nanogpt":
			return "text/x-diff";
	}
}

function expectedCandidateFormat(lane: BenchmarkLane): SubmitRequest["candidate"]["format"] {
	switch (lane) {
		case "compiler-gym":
			return "llvm-pass-sequence";
		case "kernelbench":
			return "python-source";
		case "nanogpt":
			return "unified-diff";
	}
}

function finalStatusForMeasurement(measurement: MeasurementRecord): JobStatus {
	if (measurement.tasks.some((task) => task.status === "failed")) return "failed";
	if (
		measurement.tasks.length === 0 ||
		measurement.tasks.some((task) => task.status === "rejected" || !task.verifier.passed)
	) {
		return "invalid";
	}
	return "succeeded";
}

function mean(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sortedTaskIds(taskIds: readonly string[]): string[] {
	return [...taskIds].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameJson(left: unknown, right: unknown): boolean {
	return sha256Json(left) === sha256Json(right);
}

function reuseCompatibilityDigest(
	proposal: ProposalRecord,
	contractKey: string,
	verifierEpoch: string,
	hardware: Readonly<Record<string, string>>,
	provenance: Readonly<Record<string, string>>,
	reusedMetricNames: readonly string[],
): string {
	return sha256Json({
		policy: "deterministic-verified-measurement-v1",
		contractKey,
		candidateDigest: proposal.candidate.digest,
		lane: proposal.lane,
		benchmarkIds: sortedTaskIds(proposal.benchmarkIds),
		budgetClass: proposal.budgetClass,
		candidateFormat: proposal.candidateFormat,
		verifierEpoch,
		hardware,
		provenance,
		reusedMetricNames: [...reusedMetricNames].sort(),
	});
}

export class ResearchController {
	private readonly artifacts: ArtifactStore;
	private readonly adapters = new Map<BenchmarkLane, EvaluationAdapter>();
	private readonly reuseContracts = new Map<BenchmarkLane, DeterministicMeasurementReuseContract>();
	private readonly jobs = new Map<string, InternalJob>();
	private readonly jobIdByManifest = new Map<string, string>();
	private readonly queues = new Map<BenchmarkLane, string[]>();
	private readonly running = new Map<BenchmarkLane, number>();
	private readonly maxInflight: Record<BenchmarkLane, number>;
	private readonly maxGpuInflight: number;
	private mutationTail: Promise<void> = Promise.resolve();
	private readonly abortControllers = new Map<string, AbortController>();
	private readonly cancellationRequests = new Set<string>();
	private readonly settlementFailures: Error[] = [];
	private readonly idleWaiters: Array<() => void> = [];

	private constructor(
		private readonly ledger: EvidenceLedger,
		private readonly options: ControllerOptions,
	) {
		this.artifacts = new ArtifactStore(options.artifactDir);
		for (const adapter of options.adapters) {
			if (this.adapters.has(adapter.lane)) throw new Error(`Duplicate adapter for ${adapter.lane}`);
			this.adapters.set(adapter.lane, adapter);
			const contract = adapter.deterministicMeasurementReuse;
			if (contract) {
				if (contract.policy !== "deterministic-verified-measurement-v1") {
					throw new Error(`Unsupported deterministic measurement reuse policy for ${adapter.lane}`);
				}
				if (contract.lane !== adapter.lane) {
					throw new Error(`Deterministic measurement reuse contract lane mismatch for ${adapter.lane}`);
				}
				if (!contract.verifierEpoch.trim()) {
					throw new Error(`Deterministic measurement reuse verifier epoch is empty for ${adapter.lane}`);
				}
				if (!contract.contractKey.trim() || contract.contractKey.length > 256) {
					throw new Error(`Deterministic measurement reuse contract key is invalid for ${adapter.lane}`);
				}
				if (
					contract.reusableMetricNames.length === 0 ||
					new Set(contract.reusableMetricNames).size !== contract.reusableMetricNames.length ||
					contract.reusableMetricNames.some((name) => !name.trim())
				) {
					throw new Error(`Deterministic measurement reuse metrics are invalid for ${adapter.lane}`);
				}
				this.reuseContracts.set(adapter.lane, {
					policy: contract.policy,
					contractKey: contract.contractKey,
					lane: contract.lane,
					verifierEpoch: contract.verifierEpoch,
					hardware: copyStringRecord(contract.hardware, `${adapter.lane}.reuse.hardware`),
					provenance: copyStringRecord(contract.provenance, `${adapter.lane}.reuse.provenance`),
					reusableMetricNames: [...contract.reusableMetricNames].sort(),
				});
			}
		}
		this.maxInflight = {
			"compiler-gym": options.maxInflight?.["compiler-gym"] ?? 1,
			kernelbench: options.maxInflight?.kernelbench ?? 4,
			nanogpt: options.maxInflight?.nanogpt ?? 4,
		};
		this.maxGpuInflight = options.maxGpuInflight ?? FARMSHARE_GPU_QOS_LIMIT;
		if (
			!Number.isInteger(this.maxGpuInflight) ||
			this.maxGpuInflight < 1 ||
			this.maxGpuInflight > FARMSHARE_GPU_QOS_LIMIT
		) {
			throw new Error(`maxGpuInflight must be an integer between 1 and ${FARMSHARE_GPU_QOS_LIMIT}`);
		}
		for (const lane of ["compiler-gym", "kernelbench", "nanogpt"] as const) {
			if (!Number.isInteger(this.maxInflight[lane]) || this.maxInflight[lane] < 1) {
				throw new Error(`maxInflight for ${lane} must be a positive integer`);
			}
			this.queues.set(lane, []);
			this.running.set(lane, 0);
		}
		for (const [name, value] of [
			["maxSubmissionsPerBranch", options.maxSubmissionsPerBranch],
			["maxTaskEvaluationsPerBranch", options.maxTaskEvaluationsPerBranch],
		] as const) {
			if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
				throw new Error(`${name} must be a positive integer`);
			}
		}
	}

	static async open(options: ControllerOptions): Promise<ResearchController> {
		const ledger = await EvidenceLedger.open(options.ledgerPath);
		const controller = new ResearchController(ledger, options);
		controller.rebuildFromLedger();
		await controller.recoverIncompleteJobs();
		return controller;
	}

	private now(): string {
		return (this.options.now?.() ?? new Date()).toISOString();
	}

	private async mutate<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutationTail.then(operation);
		this.mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private rebuildFromLedger(): void {
		for (const event of this.ledger.getEvents()) {
			if (event.kind === "proposal") {
				const proposal = parseProposal(event.payload);
				if (this.jobs.has(proposal.jobId)) throw new Error(`Duplicate proposal for ${proposal.jobId}`);
				const placeholder: JobStateRecord = {
					jobId: proposal.jobId,
					status: "accepted",
					statusAt: event.recordedAt,
					externalJobId: null,
					reason: null,
				};
				this.jobs.set(proposal.jobId, {
					proposal,
					state: placeholder,
					measurement: null,
					measurementEventHash: null,
					acceptedAt: event.recordedAt,
				});
				this.jobIdByManifest.set(proposal.manifestDigest, proposal.jobId);
				continue;
			}
			if (event.kind === "job_state") {
				const state = parseState(event.payload);
				const job = this.jobs.get(state.jobId);
				if (!job) throw new Error(`State without proposal for ${state.jobId}`);
				if (state.status === "accepted") job.acceptedAt = state.statusAt;
				job.state = state;
				continue;
			}
			if (event.kind === "measurement") {
				const measurement = parseMeasurement(event.payload);
				const job = this.jobs.get(measurement.jobId);
				if (!job) throw new Error(`Measurement without proposal for ${measurement.jobId}`);
				if (measurement.manifestDigest !== job.proposal.manifestDigest) {
					throw new Error(`Measurement manifest mismatch for ${measurement.jobId}`);
				}
				if (measurement.reuse) this.verifyDurableReuse(job, measurement);
				job.measurement = measurement;
				job.measurementEventHash = event.hash;
			}
		}
	}

	private verifyDurableReuse(target: InternalJob, measurement: MeasurementRecord): void {
		const reuse = measurement.reuse;
		if (!reuse) return;
		if (reuse.sourceJobId === target.proposal.jobId) {
			throw new Error(`Measurement reuse cannot reference itself for ${target.proposal.jobId}`);
		}
		const source = this.jobs.get(reuse.sourceJobId);
		if (!source?.measurement) {
			throw new Error(`Measurement reuse source is unavailable for ${target.proposal.jobId}`);
		}
		if (source.state.status !== "succeeded") {
			throw new Error(`Measurement reuse source is not succeeded for ${target.proposal.jobId}`);
		}
		if (source.proposal.manifestDigest !== reuse.sourceManifestDigest) {
			throw new Error(`Measurement reuse source manifest mismatch for ${target.proposal.jobId}`);
		}
		if (sha256Json(source.measurement) !== reuse.sourceMeasurementDigest) {
			throw new Error(`Measurement reuse source digest mismatch for ${target.proposal.jobId}`);
		}
		if (source.measurementEventHash !== reuse.sourceMeasurementEventHash) {
			throw new Error(`Measurement reuse source event hash mismatch for ${target.proposal.jobId}`);
		}
		if (!this.isReusableSource(target.proposal, source, source.measurement)) {
			throw new Error(`Measurement reuse compatibility mismatch for ${target.proposal.jobId}`);
		}
		const reusedMetricNames = [...reuse.reusedMetricNames].sort();
		if (
			reusedMetricNames.length === 0 ||
			new Set(reusedMetricNames).size !== reusedMetricNames.length ||
			!sameStrings(reusedMetricNames, reuse.reusedMetricNames)
		) {
			throw new Error(`Measurement reuse metric names are invalid for ${target.proposal.jobId}`);
		}
		const expectedCompatibility = reuseCompatibilityDigest(
			target.proposal,
			reuse.contractKey,
			source.measurement.verifierEpoch,
			source.measurement.hardware,
			source.measurement.provenance,
			reusedMetricNames,
		);
		if (expectedCompatibility !== reuse.compatibilityDigest) {
			throw new Error(`Measurement reuse digest mismatch for ${target.proposal.jobId}`);
		}
		for (const field of ["verifierEpoch", "hardware", "provenance"] as const) {
			if (!sameJson(measurement[field], source.measurement[field])) {
				throw new Error(`Reused measurement ${field} differs from its source for ${target.proposal.jobId}`);
			}
		}
		if (measurement.stdout !== null || measurement.stderr !== null) {
			throw new Error(`Reused measurement must not claim source execution logs for ${target.proposal.jobId}`);
		}
		const targetTaskIds = sortedTaskIds(target.proposal.benchmarkIds);
		const measurementTaskIds = sortedTaskIds(measurement.tasks.map((task) => task.benchmarkId));
		if (
			new Set(measurementTaskIds).size !== measurementTaskIds.length ||
			!sameStrings(measurementTaskIds, targetTaskIds)
		) {
			throw new Error(`Reused measurement task set is invalid for ${target.proposal.jobId}`);
		}
		for (const task of measurement.tasks) {
			const sourceTask = source.measurement.tasks.find((candidate) => candidate.benchmarkId === task.benchmarkId);
			if (!sourceTask) throw new Error(`Reused measurement source task is missing for ${target.proposal.jobId}`);
			if (task.status !== "accepted" || task.runtimeMs !== 0 || !sameJson(task.verifier, sourceTask.verifier)) {
				throw new Error(`Reused measurement task metadata is invalid for ${target.proposal.jobId}`);
			}
			if (!sameStrings(Object.keys(task.metrics).sort(), reusedMetricNames)) {
				throw new Error(`Reused measurement metric set is invalid for ${target.proposal.jobId}`);
			}
			for (const metricName of reusedMetricNames) {
				if (task.metrics[metricName] !== sourceTask.metrics[metricName]) {
					throw new Error(`Reused measurement metric differs from its source for ${target.proposal.jobId}`);
				}
			}
		}
	}

	private isReusableSource(
		target: ProposalRecord,
		source: InternalJob,
		measurement: MeasurementRecord,
		contract?: DeterministicMeasurementReuseContract,
	): boolean {
		if (source.state.status !== "succeeded") return false;
		if (source.proposal.branchId !== target.branchId) return false;
		if (source.measurement?.reuse !== undefined) return false;
		if (target.requireFreshMeasurement === true) return false;
		if (target.budgetClass === "confirm") return false;
		if (measurement.jobId !== source.proposal.jobId) return false;
		if (measurement.manifestDigest !== source.proposal.manifestDigest) return false;
		if (source.proposal.lane !== target.lane) return false;
		if (source.proposal.candidate.digest !== target.candidate.digest) return false;
		if (source.proposal.budgetClass !== target.budgetClass) return false;
		if (source.proposal.candidateFormat !== target.candidateFormat) return false;
		const targetTasks = sortedTaskIds(target.benchmarkIds);
		const sourceTasks = sortedTaskIds(source.proposal.benchmarkIds);
		const measuredTasks = sortedTaskIds(measurement.tasks.map((task) => task.benchmarkId));
		if (new Set(measuredTasks).size !== measuredTasks.length) return false;
		if (!sameStrings(sourceTasks, targetTasks) || !sameStrings(measuredTasks, targetTasks)) return false;
		if (measurement.tasks.some((task) => task.status !== "accepted" || !task.verifier.passed)) return false;
		if (contract) {
			if (measurement.verifierEpoch !== contract.verifierEpoch) return false;
			if (!sameJson(measurement.hardware, contract.hardware)) return false;
			if (!sameJson(measurement.provenance, contract.provenance)) return false;
			if (
				measurement.tasks.some((task) =>
					contract.reusableMetricNames.some((metricName) => task.metrics[metricName] === undefined),
				)
			) {
				return false;
			}
		}
		return true;
	}

	private async recoverIncompleteJobs(): Promise<void> {
		for (const job of this.jobs.values()) {
			if (TERMINAL_STATUSES.has(job.state.status)) {
				if (job.state.status === "succeeded" && job.measurement?.tasks.some((task) => !task.verifier.passed)) {
					const correctedStatus = job.measurement.tasks.some((task) => task.status === "failed")
						? "failed"
						: "invalid";
					await this.correctLegacyVerifierFailure(job.proposal.jobId, correctedStatus);
				}
				continue;
			}
			if (job.state.status === "running") {
				if (job.measurement) {
					await this.transition(
						job.proposal.jobId,
						finalStatusForMeasurement(job.measurement),
						"Recovered durable measurement after controller restart",
					);
					continue;
				}
				const adapter = this.adapters.get(job.proposal.lane);
				if (job.state.externalJobId !== null && adapter?.resume) {
					this.queues.get(job.proposal.lane)?.push(job.proposal.jobId);
					continue;
				}
				await this.transition(
					job.proposal.jobId,
					"failed",
					job.state.externalJobId === null
						? "Controller restarted before a durable external job handle was recorded"
						: "Evaluator adapter cannot resume a durable external job",
				);
				continue;
			}
			this.queues.get(job.proposal.lane)?.push(job.proposal.jobId);
		}
		this.pumpAll();
	}

	private async correctLegacyVerifierFailure(jobId: string, status: "invalid" | "failed"): Promise<void> {
		await this.mutate(async () => {
			const job = this.jobs.get(jobId);
			if (!job) throw new Error(`Unknown job: ${jobId}`);
			const state: JobStateRecord = {
				...job.state,
				status,
				statusAt: this.now(),
				reason: "Corrected legacy success whose durable measurement contains a failed verifier",
			};
			await this.ledger.append("job_state", state, state.statusAt);
			job.state = state;
		});
	}

	private validateSubmit(request: SubmitRequest): void {
		if (!request.branchId.trim()) throw new Error("branchId must not be empty");
		if (!request.treatment.trim() || request.treatment.length > 128) throw new Error("Invalid treatment name");
		if (request.requireFreshMeasurement !== undefined && typeof request.requireFreshMeasurement !== "boolean") {
			throw new Error("requireFreshMeasurement must be a boolean");
		}
		if (this.options.allowedTreatments && !this.options.allowedTreatments.includes(request.treatment)) {
			throw new Error(`Treatment not allowed: ${request.treatment}`);
		}
		if (request.benchmarkIds.length === 0) throw new Error("At least one benchmarkId is required");
		if (new Set(request.benchmarkIds).size !== request.benchmarkIds.length) {
			throw new Error("benchmarkIds must be unique");
		}
		const allowlist = new Set(this.options.allowedBenchmarks[request.lane]);
		for (const benchmarkId of request.benchmarkIds) {
			if (!allowlist.has(benchmarkId)) throw new Error(`Benchmark not allowed for ${request.lane}: ${benchmarkId}`);
		}
		if (request.candidate.format !== expectedCandidateFormat(request.lane)) {
			throw new Error(`Candidate format ${request.candidate.format} is invalid for ${request.lane}`);
		}
		if (!request.candidate.content || Buffer.byteLength(request.candidate.content) > 1_048_576) {
			throw new Error("Candidate content must be between 1 byte and 1 MiB");
		}
		for (const value of [
			request.proposal.hypothesis,
			request.proposal.mechanism,
			request.proposal.predictedOutcome,
		]) {
			if (!value.trim()) throw new Error("Proposal text fields must not be empty");
		}
		for (const parentJobId of request.proposal.parentJobIds) {
			const parent = this.jobs.get(parentJobId);
			if (!parent) throw new Error(`Unknown parent job: ${parentJobId}`);
			if (parent.proposal.branchId !== request.branchId) {
				throw new Error(`Parent job belongs to another branch: ${parentJobId}`);
			}
		}
		if (!this.adapters.has(request.lane)) throw new Error(`No evaluator adapter configured for ${request.lane}`);
	}

	async submit(request: SubmitRequest): Promise<SubmitResult> {
		return this.mutate(async () => {
			this.validateSubmit(request);
			const candidate = await this.artifacts.putString(request.candidate.content, candidateMediaType(request.lane));
			const manifestBody: Omit<ProposalRecord, "jobId" | "manifestDigest"> = {
				branchId: request.branchId,
				lane: request.lane,
				benchmarkIds: [...request.benchmarkIds].sort(),
				budgetClass: request.budgetClass,
				treatment: request.treatment,
				proposal: request.proposal,
				candidate,
				candidateFormat: request.candidate.format,
			};
			if (request.requireFreshMeasurement === true) manifestBody.requireFreshMeasurement = true;
			const manifestDigest = sha256Json(manifestBody);
			const existingJobId = this.jobIdByManifest.get(manifestDigest);
			if (existingJobId) {
				const existing = this.jobs.get(existingJobId);
				if (!existing) throw new Error(`Manifest index points to missing job ${existingJobId}`);
				return {
					jobId: existingJobId,
					acceptedAt: existing.acceptedAt,
					manifestDigest,
					duplicate: true,
				};
			}
			const budget = this.budgetStatus(request.branchId);
			if (budget.remainingSubmissions !== null && budget.remainingSubmissions < 1) {
				throw new Error(`Submission budget exhausted for branch ${request.branchId}`);
			}
			if (
				budget.remainingTaskEvaluations !== null &&
				budget.remainingTaskEvaluations < request.benchmarkIds.length
			) {
				throw new Error(`Task-evaluation budget exhausted for branch ${request.branchId}`);
			}

			const jobId = `job_${manifestDigest.slice(0, 24)}`;
			const proposal: ProposalRecord = { jobId, manifestDigest, ...manifestBody };
			const acceptedAt = this.now();
			const state: JobStateRecord = {
				jobId,
				status: "accepted",
				statusAt: acceptedAt,
				externalJobId: null,
				reason: null,
			};
			await this.ledger.append("proposal", proposal, acceptedAt);
			await this.ledger.append("job_state", state, acceptedAt);
			this.jobs.set(jobId, { proposal, state, measurement: null, measurementEventHash: null, acceptedAt });
			this.jobIdByManifest.set(manifestDigest, jobId);
			this.queues.get(request.lane)?.push(jobId);
			queueMicrotask(() => this.pump(request.lane));
			return { jobId, acceptedAt, manifestDigest, duplicate: false };
		});
	}

	private async transition(jobId: string, status: JobStatus, reason: string | null): Promise<void> {
		await this.mutate(async () => {
			const job = this.jobs.get(jobId);
			if (!job) throw new Error(`Unknown job: ${jobId}`);
			if (!VALID_TRANSITIONS[job.state.status].includes(status)) {
				throw new Error(`Invalid transition for ${jobId}: ${job.state.status} -> ${status}`);
			}
			const state: JobStateRecord = {
				jobId,
				status,
				statusAt: this.now(),
				externalJobId: job.state.externalJobId,
				reason,
			};
			await this.ledger.append("job_state", state, state.statusAt);
			job.state = state;
		});
	}

	private async recordExternalJobId(jobId: string, externalJobId: string): Promise<void> {
		if (!externalJobId.trim() || externalJobId.length > 512 || /[\u0000-\u001f\u007f]/.test(externalJobId)) {
			throw new Error("External job ID must be a non-empty printable string of at most 512 characters");
		}
		await this.mutate(async () => {
			const job = this.jobs.get(jobId);
			if (!job) throw new Error(`Unknown job: ${jobId}`);
			if (job.state.status !== "running") {
				throw new Error(`Cannot record an external job ID while ${jobId} is ${job.state.status}`);
			}
			if (job.state.externalJobId === externalJobId) return;
			if (job.state.externalJobId !== null) {
				throw new Error(`External job ID is already fixed for ${jobId}`);
			}
			const state: JobStateRecord = {
				...job.state,
				statusAt: this.now(),
				externalJobId,
			};
			await this.ledger.append("job_state", state, state.statusAt);
			job.state = state;
		});
	}

	private pumpAll(): void {
		for (const lane of ["compiler-gym", "kernelbench", "nanogpt"] as const) this.pump(lane);
	}

	private pump(lane: BenchmarkLane): void {
		const queue = this.queues.get(lane);
		if (!queue) return;
		let running = this.running.get(lane) ?? 0;
		while (
			queue.length > 0 &&
			running < this.maxInflight[lane] &&
			(!GPU_LANES.has(lane) || this.runningGpuJobs() < this.maxGpuInflight)
		) {
			const jobId = queue.shift();
			if (!jobId) break;
			running++;
			this.running.set(lane, running);
			void (async () => {
				try {
					await this.runJob(jobId);
				} catch (error) {
					try {
						await this.containRunJobFailure(jobId, error);
					} catch (containmentError) {
						this.settlementFailures.push(
							new AggregateError(
								[error, containmentError],
								`Failed to durably contain evaluator failure for ${jobId}`,
							),
						);
					}
				} finally {
					this.cancellationRequests.delete(jobId);
					this.running.set(lane, Math.max(0, (this.running.get(lane) ?? 1) - 1));
					if (GPU_LANES.has(lane)) this.pumpAll();
					else this.pump(lane);
					this.resolveIdleWaitersIfIdle();
				}
			})().catch((error: unknown) => {
				this.settlementFailures.push(error instanceof Error ? error : new Error(String(error)));
				this.resolveIdleWaitersIfIdle();
			});
		}
		this.resolveIdleWaitersIfIdle();
	}

	private async containRunJobFailure(jobId: string, error: unknown): Promise<void> {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(`Cannot contain failure for missing job ${jobId}`);
		if (TERMINAL_STATUSES.has(job.state.status)) return;
		const reason = `controller evaluator settlement failure: ${error instanceof Error ? error.message : String(error)}`;
		await this.transition(jobId, "failed", reason);
	}

	private runningGpuJobs(): number {
		return (this.running.get("kernelbench") ?? 0) + (this.running.get("nanogpt") ?? 0);
	}

	private createReusedMeasurement(
		target: InternalJob,
		contract: DeterministicMeasurementReuseContract,
	): MeasurementRecord | null {
		if (target.proposal.requireFreshMeasurement === true || target.proposal.budgetClass === "confirm") return null;
		for (const source of this.jobs.values()) {
			const sourceMeasurement = source.measurement;
			if (!sourceMeasurement || !source.measurementEventHash) continue;
			if (!this.isReusableSource(target.proposal, source, sourceMeasurement, contract)) continue;
			const reusedMetricNames = [...contract.reusableMetricNames].sort();
			const sourceTasks = new Map(sourceMeasurement.tasks.map((task) => [task.benchmarkId, task]));
			const tasks = target.proposal.benchmarkIds.map((benchmarkId) => {
				const sourceTask = sourceTasks.get(benchmarkId);
				if (!sourceTask) throw new Error(`Reusable source is missing task ${benchmarkId}`);
				const metrics: Record<string, number> = {};
				for (const metricName of reusedMetricNames) {
					const value = sourceTask.metrics[metricName];
					if (value === undefined) throw new Error(`Reusable source is missing metric ${metricName}`);
					metrics[metricName] = value;
				}
				return {
					benchmarkId,
					status: "accepted" as const,
					metrics,
					verifier: structuredClone(sourceTask.verifier),
					runtimeMs: 0,
				};
			});
			return {
				jobId: target.proposal.jobId,
				manifestDigest: target.proposal.manifestDigest,
				verifierEpoch: sourceMeasurement.verifierEpoch,
				measuredAt: this.now(),
				tasks,
				hardware: { ...sourceMeasurement.hardware },
				provenance: { ...sourceMeasurement.provenance },
				stdout: null,
				stderr: null,
				reuse: {
					policy: contract.policy,
					contractKey: contract.contractKey,
					compatibilityDigest: reuseCompatibilityDigest(
						target.proposal,
						contract.contractKey,
						sourceMeasurement.verifierEpoch,
						sourceMeasurement.hardware,
						sourceMeasurement.provenance,
						reusedMetricNames,
					),
					sourceJobId: source.proposal.jobId,
					sourceManifestDigest: source.proposal.manifestDigest,
					sourceMeasurementDigest: sha256Json(sourceMeasurement),
					sourceMeasurementEventHash: source.measurementEventHash,
					reusedMetricNames,
				},
			};
		}
		return null;
	}

	private async recordMeasurement(jobId: string, measurement: MeasurementRecord): Promise<void> {
		await this.mutate(async () => {
			const event = await this.ledger.append("measurement", measurement, measurement.measuredAt);
			const current = this.jobs.get(jobId);
			if (!current) throw new Error(`Unknown job: ${jobId}`);
			current.measurement = measurement;
			current.measurementEventHash = event.hash;
		});
	}

	private async recordAdapterOutputErrorEvidence(
		job: ProposalRecord,
		error: EvaluationAdapterOutputError,
	): Promise<void> {
		const [hostEvidenceArtifact, stdoutArtifact, stderrArtifact] = await Promise.all([
			this.artifacts.putString(`${canonicalJson(error.hostEvidence)}\n`, "application/json"),
			error.stdout === undefined ? Promise.resolve(null) : this.artifacts.putString(error.stdout, "text/plain"),
			error.stderr === undefined ? Promise.resolve(null) : this.artifacts.putString(error.stderr, "text/plain"),
		]);
		const recordedAt = this.now();
		await this.mutate(() =>
			this.ledger.append(
				"run_manifest",
				{
					type: "evaluation_adapter_output_error",
					protocol: EVALUATION_ADAPTER_OUTPUT_ERROR_PROTOCOL,
					jobId: job.jobId,
					manifestDigest: job.manifestDigest,
					lane: job.lane,
					code: error.code,
					sanitizedMessage: error.message,
					hostEvidenceArtifact,
					stdoutArtifact,
					stderrArtifact,
				},
				recordedAt,
			),
		);
	}

	private async runJob(jobId: string): Promise<void> {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(`Unknown job: ${jobId}`);
		const adapter = this.adapters.get(job.proposal.lane);
		if (!adapter) throw new Error(`Missing adapter for ${job.proposal.lane}`);
		if (job.state.status === "accepted") await this.transition(jobId, "queued", null);
		if (job.state.status === "queued") await this.transition(jobId, "running", null);
		if (job.state.status !== "running") {
			throw new Error(`Cannot evaluate ${jobId} while it is ${job.state.status}`);
		}
		const reuseContract = this.reuseContracts.get(job.proposal.lane);
		if (reuseContract) {
			const reusedMeasurement = this.createReusedMeasurement(job, reuseContract);
			if (reusedMeasurement) {
				await this.recordMeasurement(jobId, reusedMeasurement);
				await this.transition(jobId, "succeeded", null);
				return;
			}
		}

		const abortController = new AbortController();
		this.abortControllers.set(jobId, abortController);
		if (this.cancellationRequests.has(jobId)) abortController.abort();
		const context: EvaluationContext = {
			signal: abortController.signal,
			recordExternalJobId: (externalJobId) => this.recordExternalJobId(jobId, externalJobId),
		};
		let outcome: EvaluationOutcome;
		try {
			const candidateContent = await this.artifacts.readString(job.proposal.candidate);
			const evaluationJob: EvaluationJob = { ...job.proposal, candidateContent };
			if (job.state.externalJobId !== null) {
				if (!adapter.resume) throw new Error(`Evaluator adapter cannot resume ${job.state.externalJobId}`);
				outcome = await adapter.resume(evaluationJob, job.state.externalJobId, context);
			} else {
				outcome = await adapter.evaluate(evaluationJob, context);
			}
			if (abortController.signal.aborted) {
				throw new Error("Evaluation cancellation was requested before durable adapter settlement");
			}
		} catch (error) {
			let message = error instanceof Error ? error.message : String(error);
			if (error instanceof EvaluationAdapterOutputError) {
				try {
					await this.recordAdapterOutputErrorEvidence(job.proposal, error);
				} catch {
					message = `${error.message}; host failure evidence could not be persisted`;
				}
			}
			outcome = {
				verifierEpoch: "adapter-error",
				tasks: job.proposal.benchmarkIds.map((benchmarkId) => ({
					benchmarkId,
					status: "failed",
					metrics: {},
					verifier: { passed: false, checks: [], errors: [message] },
					runtimeMs: 0,
				})),
				hardware: {},
				provenance: { adapter: adapter.lane },
				stderr: message,
			};
		} finally {
			this.abortControllers.delete(jobId);
		}

		const stdout = outcome.stdout === undefined ? null : await this.artifacts.putString(outcome.stdout, "text/plain");
		const stderr = outcome.stderr === undefined ? null : await this.artifacts.putString(outcome.stderr, "text/plain");
		const measurement: MeasurementRecord = {
			jobId,
			manifestDigest: job.proposal.manifestDigest,
			verifierEpoch: outcome.verifierEpoch,
			measuredAt: this.now(),
			tasks: outcome.tasks,
			hardware: outcome.hardware,
			provenance: outcome.provenance,
			stdout,
			stderr,
		};

		await this.recordMeasurement(jobId, measurement);
		await this.transition(jobId, finalStatusForMeasurement(measurement), null);
	}

	status(jobIds?: readonly string[]): JobView[] {
		const ids = jobIds ?? [...this.jobs.keys()];
		return ids.map((jobId) => {
			const job = this.jobs.get(jobId);
			if (!job) throw new Error(`Unknown job: ${jobId}`);
			return { proposal: job.proposal, state: job.state, measurement: job.measurement };
		});
	}

	statusForBranch(branchId: string, jobIds?: readonly string[]): JobView[] {
		if (!jobIds) {
			return [...this.jobs.values()]
				.filter((job) => job.proposal.branchId === branchId)
				.map((job) => ({ proposal: job.proposal, state: job.state, measurement: job.measurement }));
		}
		const jobs = this.status(jobIds);
		for (const job of jobs) {
			if (job.proposal.branchId !== branchId) {
				throw new Error(`Job does not belong to branch ${branchId}: ${job.proposal.jobId}`);
			}
		}
		return jobs;
	}

	requestJobCancellation(jobId: string): void {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(`Unknown job: ${jobId}`);
		if (TERMINAL_STATUSES.has(job.state.status)) return;
		this.cancellationRequests.add(jobId);
		this.abortControllers.get(jobId)?.abort();
	}

	budgetStatus(branchId: string): BranchBudgetStatus {
		const branchJobs = [...this.jobs.values()].filter((job) => job.proposal.branchId === branchId);
		const submissions = branchJobs.length;
		const taskEvaluations = branchJobs.reduce((total, job) => total + job.proposal.benchmarkIds.length, 0);
		const actualTaskEvaluations = branchJobs.reduce(
			(total, job) => total + (job.measurement && !job.measurement.reuse ? job.proposal.benchmarkIds.length : 0),
			0,
		);
		const reusedTaskEvaluations = branchJobs.reduce(
			(total, job) => total + (job.measurement?.reuse ? job.proposal.benchmarkIds.length : 0),
			0,
		);
		const unevaluatedTaskEvaluations = taskEvaluations - actualTaskEvaluations - reusedTaskEvaluations;
		const maxSubmissions = this.options.maxSubmissionsPerBranch ?? null;
		const maxTaskEvaluations = this.options.maxTaskEvaluationsPerBranch ?? null;
		return {
			branchId,
			submissions,
			taskEvaluations,
			actualTaskEvaluations,
			reusedTaskEvaluations,
			unevaluatedTaskEvaluations,
			maxSubmissions,
			maxTaskEvaluations,
			remainingSubmissions: maxSubmissions === null ? null : Math.max(0, maxSubmissions - submissions),
			remainingTaskEvaluations:
				maxTaskEvaluations === null ? null : Math.max(0, maxTaskEvaluations - taskEvaluations),
		};
	}

	recall(branchId: string, query: RecallQuery = {}): JobView[] {
		const statuses = query.statuses ? new Set(query.statuses) : null;
		const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
		return [...this.jobs.values()]
			.filter((job) => job.proposal.branchId === branchId)
			.filter((job) => query.lane === undefined || job.proposal.lane === query.lane)
			.filter((job) => query.treatment === undefined || job.proposal.treatment === query.treatment)
			.filter((job) => statuses === null || statuses.has(job.state.status))
			.sort((left, right) => Date.parse(right.state.statusAt) - Date.parse(left.state.statusAt))
			.slice(0, limit)
			.map((job) => ({ proposal: job.proposal, state: job.state, measurement: job.measurement }));
	}

	async recallWithCandidateContent(
		branchId: string,
		query: RecallQuery = {},
		maxTotalBytes = 65_536,
	): Promise<Array<JobView & { candidateContent: string }>> {
		const jobs = this.recall(branchId, query);
		let totalBytes = 0;
		const results: Array<JobView & { candidateContent: string }> = [];
		for (const job of jobs) {
			const candidateContent = await this.artifacts.readString(job.proposal.candidate);
			totalBytes += Buffer.byteLength(candidateContent);
			if (totalBytes > maxTotalBytes) {
				throw new Error(`Recalled candidate content exceeds ${maxTotalBytes} bytes`);
			}
			results.push({ ...job, candidateContent });
		}
		return results;
	}

	compare(
		branchId: string,
		lane: BenchmarkLane,
		leftTreatment: string,
		rightTreatment: string,
		verifierEpoch?: string,
		compatibilityDigest?: string,
	): ComparisonResult {
		const metric = this.options.metrics[lane];
		const candidateEvidence: CandidateEvidence[] = [];
		for (const job of this.jobs.values()) {
			if (
				job.proposal.branchId !== branchId ||
				job.proposal.lane !== lane ||
				(job.proposal.treatment !== leftTreatment && job.proposal.treatment !== rightTreatment) ||
				job.state.status !== "succeeded" ||
				!job.measurement ||
				job.measurement.tasks.length === 0
			) {
				continue;
			}

			const measurement = job.measurement;
			if (measurement.tasks.some((task) => task.status !== "accepted" || !task.verifier.passed)) continue;
			const benchmarkIds = measurement.tasks.map((task) => task.benchmarkId).sort();
			if (new Set(benchmarkIds).size !== benchmarkIds.length) continue;
			const proposedBenchmarkIds = [...job.proposal.benchmarkIds].sort();
			if (
				benchmarkIds.length !== proposedBenchmarkIds.length ||
				benchmarkIds.some((benchmarkId, index) => benchmarkId !== proposedBenchmarkIds[index])
			) {
				continue;
			}
			const values = new Map<string, number>();
			for (const task of measurement.tasks) {
				const value = task.metrics[metric.name];
				if (value !== undefined) values.set(task.benchmarkId, value);
			}
			if (values.size !== benchmarkIds.length) continue;
			const aggregate = mean([...values.values()]);
			if (aggregate === null) continue;
			candidateEvidence.push({
				job,
				verifierEpoch: measurement.verifierEpoch,
				compatibilityDigest: sha256Json({
					policy: "candidate-paired-v1",
					lane,
					verifierEpoch: measurement.verifierEpoch,
					benchmarkIds,
					budgetClass: job.proposal.budgetClass,
					candidateFormat: job.proposal.candidateFormat,
					hardware: measurement.hardware,
					provenance: measurement.provenance,
				}),
				benchmarkIds,
				values,
				aggregate,
			});
		}

		const availableEpochs = [...new Set(candidateEvidence.map((candidate) => candidate.verifierEpoch))].sort();
		if (verifierEpoch === undefined && availableEpochs.length > 1) {
			throw new Error(
				`Comparison spans multiple verifier epochs (${availableEpochs.join(", ")}); specify verifierEpoch explicitly`,
			);
		}
		const selectedEpoch = verifierEpoch ?? availableEpochs[0] ?? null;
		if (selectedEpoch === null) {
			throw new Error("Comparison has no deployable candidate evidence with a passed verifier");
		}
		const epochEvidence = candidateEvidence.filter((candidate) => candidate.verifierEpoch === selectedEpoch);
		const leftEvidence = epochEvidence.filter((candidate) => candidate.job.proposal.treatment === leftTreatment);
		const rightEvidence = epochEvidence.filter((candidate) => candidate.job.proposal.treatment === rightTreatment);
		const rightCompatibility = new Set(rightEvidence.map((candidate) => candidate.compatibilityDigest));
		const sharedCompatibility = [
			...new Set(
				leftEvidence
					.map((candidate) => candidate.compatibilityDigest)
					.filter((digest) => rightCompatibility.has(digest)),
			),
		].sort();
		if (compatibilityDigest !== undefined && !sharedCompatibility.includes(compatibilityDigest)) {
			throw new Error(`No paired candidate evidence matches compatibility digest ${compatibilityDigest}`);
		}
		if (compatibilityDigest === undefined && sharedCompatibility.length > 1) {
			throw new Error(
				`Comparison spans multiple compatible evidence strata (${sharedCompatibility.join(", ")}); specify compatibilityDigest explicitly`,
			);
		}
		const selectedCompatibility = compatibilityDigest ?? sharedCompatibility[0];
		if (!selectedCompatibility) {
			throw new Error(
				"Comparison has no candidate pair with the same task set, budget, verifier epoch, hardware, and provenance",
			);
		}

		const compareCandidates = (left: CandidateEvidence, right: CandidateEvidence): number => {
			const objectiveOrder =
				metric.direction === "maximize" ? right.aggregate - left.aggregate : left.aggregate - right.aggregate;
			return (
				objectiveOrder ||
				left.job.proposal.candidate.digest.localeCompare(right.job.proposal.candidate.digest) ||
				left.job.proposal.jobId.localeCompare(right.job.proposal.jobId)
			);
		};
		const selectCandidate = (candidates: readonly CandidateEvidence[]): CandidateEvidence => {
			const selected = candidates
				.filter((candidate) => candidate.compatibilityDigest === selectedCompatibility)
				.sort(compareCandidates)[0];
			if (!selected) throw new Error("Missing candidate in selected compatibility stratum");
			return selected;
		};
		const left = selectCandidate(leftEvidence);
		const right = selectCandidate(rightEvidence);
		if (
			left.benchmarkIds.length !== right.benchmarkIds.length ||
			left.benchmarkIds.some((benchmarkId, index) => benchmarkId !== right.benchmarkIds[index])
		) {
			throw new Error("Selected candidate evidence does not have an identical task set");
		}
		const paired = left.benchmarkIds.map((benchmarkId) => {
			const leftValue = left.values.get(benchmarkId);
			const rightValue = right.values.get(benchmarkId);
			if (leftValue === undefined || rightValue === undefined) throw new Error("Missing paired metric");
			return {
				benchmarkId,
				left: leftValue,
				right: rightValue,
				orientedDelta: metric.direction === "maximize" ? leftValue - rightValue : rightValue - leftValue,
			};
		});

		return {
			comparisonPolicy: "candidate-paired-v1",
			lane,
			metric: metric.name,
			direction: metric.direction,
			verifierEpoch: selectedEpoch,
			compatibilityDigest: selectedCompatibility,
			leftTreatment,
			rightTreatment,
			leftJobId: left.job.proposal.jobId,
			rightJobId: right.job.proposal.jobId,
			leftManifestDigest: left.job.proposal.manifestDigest,
			rightManifestDigest: right.job.proposal.manifestDigest,
			leftCandidateDigest: left.job.proposal.candidate.digest,
			rightCandidateDigest: right.job.proposal.candidate.digest,
			benchmarkIds: [...left.benchmarkIds],
			pairedTaskCount: paired.length,
			leftMean: mean(paired.map((item) => item.left)),
			rightMean: mean(paired.map((item) => item.right)),
			orientedMeanDelta: mean(paired.map((item) => item.orientedDelta)),
			paired,
		};
	}

	async appendRunManifest(manifest: unknown): Promise<void> {
		await this.ledger.append("run_manifest", manifest, this.now());
	}

	verifyLedger(): void {
		this.ledger.verify();
	}

	async waitForIdle(): Promise<void> {
		if (!this.isIdle()) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
		if (this.settlementFailures.length > 0) {
			throw new AggregateError([...this.settlementFailures], "Controller evaluator settlement was not durable");
		}
	}

	private isIdle(): boolean {
		for (const queue of this.queues.values()) if (queue.length > 0) return false;
		for (const count of this.running.values()) if (count > 0) return false;
		return true;
	}

	private resolveIdleWaitersIfIdle(): void {
		if (!this.isIdle()) return;
		for (const resolve of this.idleWaiters.splice(0)) resolve();
	}
}

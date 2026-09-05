export type BenchmarkLane = "compiler-gym" | "kernelbench" | "nanogpt";
export type BudgetClass = "smoke" | "screen" | "confirm";
export type CandidateFormat = "llvm-pass-sequence" | "python-source" | "unified-diff";
export type MetricDirection = "maximize" | "minimize";
export type JobStatus = "accepted" | "queued" | "running" | "succeeded" | "invalid" | "failed" | "cancelled";
export type TaskMeasurementStatus = "accepted" | "rejected" | "failed";

export interface ArtifactRef {
	digest: string;
	byteLength: number;
	mediaType: string;
}

export interface CandidateMaterial {
	format: CandidateFormat;
	content: string;
}

export interface ProposalDetails {
	hypothesis: string;
	mechanism: string;
	predictedOutcome: string;
	boundaryConditions: string[];
	parentJobIds: string[];
}

export interface SubmitRequest {
	branchId: string;
	lane: BenchmarkLane;
	benchmarkIds: string[];
	budgetClass: BudgetClass;
	treatment: string;
	proposal: ProposalDetails;
	candidate: CandidateMaterial;
	requireFreshMeasurement?: boolean;
}

export interface ProposalRecord {
	jobId: string;
	manifestDigest: string;
	branchId: string;
	lane: BenchmarkLane;
	benchmarkIds: string[];
	budgetClass: BudgetClass;
	treatment: string;
	proposal: ProposalDetails;
	candidate: ArtifactRef;
	candidateFormat: CandidateFormat;
	requireFreshMeasurement?: true;
}

export interface JobStateRecord {
	jobId: string;
	status: JobStatus;
	statusAt: string;
	externalJobId: string | null;
	reason: string | null;
}

export interface VerifierResult {
	passed: boolean;
	checks: string[];
	errors: string[];
}

export interface TaskMeasurement {
	benchmarkId: string;
	status: TaskMeasurementStatus;
	metrics: Record<string, number>;
	verifier: VerifierResult;
	runtimeMs: number;
}

export interface MeasurementRecord {
	jobId: string;
	manifestDigest: string;
	verifierEpoch: string;
	measuredAt: string;
	tasks: TaskMeasurement[];
	hardware: Record<string, string>;
	provenance: Record<string, string>;
	stdout: ArtifactRef | null;
	stderr: ArtifactRef | null;
	reuse?: MeasurementReuseProvenance;
}

export interface MeasurementReuseProvenance {
	policy: "deterministic-verified-measurement-v1";
	contractKey: string;
	compatibilityDigest: string;
	sourceJobId: string;
	sourceManifestDigest: string;
	sourceMeasurementDigest: string;
	sourceMeasurementEventHash: string;
	reusedMetricNames: string[];
}

export interface EvaluationOutcome {
	verifierEpoch: string;
	tasks: TaskMeasurement[];
	hardware: Record<string, string>;
	provenance: Record<string, string>;
	stdout?: string;
	stderr?: string;
}

export interface EvaluationJob extends ProposalRecord {
	candidateContent: string;
}

export interface EvaluationContext {
	readonly signal: AbortSignal;
	recordExternalJobId(externalJobId: string): Promise<void>;
}

export interface DeterministicMeasurementReuseContract {
	policy: "deterministic-verified-measurement-v1";
	contractKey: string;
	lane: BenchmarkLane;
	verifierEpoch: string;
	hardware: Readonly<Record<string, string>>;
	provenance: Readonly<Record<string, string>>;
	reusableMetricNames: readonly string[];
}

export interface EvaluationAdapter {
	readonly lane: BenchmarkLane;
	readonly deterministicMeasurementReuse?: DeterministicMeasurementReuseContract;
	evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome>;
	resume?(job: EvaluationJob, externalJobId: string, context: EvaluationContext): Promise<EvaluationOutcome>;
}

export interface SubmitResult {
	jobId: string;
	acceptedAt: string;
	manifestDigest: string;
	duplicate: boolean;
}

export interface JobView {
	proposal: ProposalRecord;
	state: JobStateRecord;
	measurement: MeasurementRecord | null;
}

export interface RecallQuery {
	lane?: BenchmarkLane;
	treatment?: string;
	statuses?: JobStatus[];
	limit?: number;
}

export interface LaneMetric {
	name: string;
	direction: MetricDirection;
}

export interface ComparisonResult {
	comparisonPolicy: "candidate-paired-v1";
	lane: BenchmarkLane;
	metric: string;
	direction: MetricDirection;
	verifierEpoch: string;
	compatibilityDigest: string;
	leftTreatment: string;
	rightTreatment: string;
	leftJobId: string;
	rightJobId: string;
	leftManifestDigest: string;
	rightManifestDigest: string;
	leftCandidateDigest: string;
	rightCandidateDigest: string;
	benchmarkIds: string[];
	pairedTaskCount: number;
	leftMean: number | null;
	rightMean: number | null;
	orientedMeanDelta: number | null;
	paired: Array<{
		benchmarkId: string;
		left: number;
		right: number;
		orientedDelta: number;
	}>;
}

export interface BranchBudgetStatus {
	branchId: string;
	submissions: number;
	taskEvaluations: number;
	actualTaskEvaluations: number;
	reusedTaskEvaluations: number;
	unevaluatedTaskEvaluations: number;
	maxSubmissions: number | null;
	maxTaskEvaluations: number | null;
	remainingSubmissions: number | null;
	remainingTaskEvaluations: number | null;
}

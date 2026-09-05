import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, type JsonValue, sha256Text, toJsonValue } from "./canonical-json.js";
import { parseLlvmPassSequence } from "./diagnostics.js";
import { EvidenceLedger, type LedgerEvent } from "./ledger.js";
import type { ArtifactRef } from "./types.js";

const ANALYSIS_PROTOCOL = "compiler-gym-cpu-smoke-analysis-v1";
const IR_METRIC = "IrInstructionCount";

type AnalysisRole = "primary" | "sensitivity" | "operational";
type ContrastSide = "control" | "treatment" | "operational";

interface RunConfig {
	id: string;
	path: string;
	role: AnalysisRole;
	contrastId: string | null;
	side: ContrastSide;
}

interface ContrastConfig {
	id: string;
	feature: string;
	role: Exclude<AnalysisRole, "operational">;
	controlRunIds: string[];
	treatmentRunIds: string[];
}

interface TransferRunConfig {
	id: string;
	path: string;
}

interface AnalysisConfig {
	schemaVersion: 1;
	analysisId: string;
	searchTasks: string[];
	calibrationRun: string;
	runs: RunConfig[];
	contrasts: ContrastConfig[];
	transfer: {
		task: string;
		calibrationRun: string;
		validationRuns: TransferRunConfig[];
	};
}

interface ParsedTask {
	benchmarkId: string;
	status: string;
	verifierPassed: boolean;
	irInstructionCount: number | null;
	objectTextSizeBytes: number | null;
	runtimeMs: number;
}

interface ParsedProposal {
	sequence: number;
	recordedAt: string;
	jobId: string;
	manifestDigest: string;
	branchId: string;
	treatment: string;
	benchmarkIds: string[];
	candidateRef: ArtifactRef;
	candidateContent: string;
	hypothesis: string;
	mechanism: string;
	predictedOutcome: string;
	boundaryConditions: string[];
	parentJobIds: string[];
}

interface ParsedMeasurement {
	sequence: number;
	recordedAt: string;
	jobId: string;
	manifestDigest: string;
	verifierEpoch: string;
	tasks: ParsedTask[];
}

interface EvidenceDirectory {
	directory: string;
	ledgerPath: string;
	ledgerFileSha256: string;
	terminalEventHash: string;
	eventCount: number;
	maxRecordedAt: string;
	verifiedArtifactDigests: string[];
	proposals: ParsedProposal[];
	measurements: Map<string, ParsedMeasurement>;
	finalStates: Map<string, string>;
	events: readonly LedgerEvent[];
}

interface FrontierSnapshot {
	jobId: string;
	terminalAt: string;
	cumulativeTaskEvaluations: number;
	cumulativeOutputTokens: number;
	cumulativeAgentActiveMs: number;
	cumulativeEvaluatorWaitMs: number;
	cumulativeCalendarMs: number;
}

interface RunManifest {
	arm: string;
	outcome: string;
	error: string | null;
	promptProtocolVersion: string;
	transport: string;
	providerMaxRetries: number | null;
	startedAt: string;
	finishedAt: string;
	championJobId: string | null;
	iterationsRequested: number;
	iterationsCompleted: number;
	taskEvaluations: number;
	outputTokens: number;
	inputTokens: number;
	cacheReadTokens: number;
	totalTokens: number;
	modeledCost: number;
	agentActiveMs: number;
	evaluatorWaitMs: number;
	calendarMs: number;
	protocolDeviationCount: number;
	providerCalls: number | null;
	blockedProviderCalls: number | null;
	compactionCount: number;
	sealedContextCheckCount: number;
	toolExecutions: {
		submit: { succeeded: number; failed: number };
		status: { succeeded: number; failed: number };
		recall: { succeeded: number; failed: number };
	};
	rDiagnostic: JsonValue;
	snapshots: Map<string, FrontierSnapshot>;
}

export interface SelectionCandidate {
	stableId: string;
	candidateDigest: string;
	passCount: number;
	taskRatios: Readonly<Record<string, number>>;
}

interface Experiment extends SelectionCandidate {
	runId: string;
	role: AnalysisRole;
	contrastId: string | null;
	side: ContrastSide;
	proposal: ParsedProposal;
	measurement: ParsedMeasurement | null;
	finalState: string | null;
	eligible: boolean;
	selectorMaxRatio: number | null;
	selectorMeanRatio: number | null;
	taskCounts: Readonly<Record<string, number>>;
	snapshot: FrontierSnapshot | null;
}

interface LoadedRun {
	config: RunConfig;
	evidence: EvidenceDirectory;
	manifest: RunManifest;
	experiments: Experiment[];
	selected: Experiment | null;
}

interface GroupResources {
	taskEvaluations: number;
	outputTokens: number;
	inputTokens: number;
	cacheReadTokens: number;
	totalTokens: number;
	modeledCost: number;
	agentActiveSeconds: number;
	evaluatorWaitSeconds: number;
	aggregateCalendarSeconds: number;
	criticalPathCalendarSeconds: number;
}

interface FrontierRow {
	role: "primary" | "sensitivity";
	contrastId: string;
	feature: string;
	side: "control" | "treatment";
	checkpoint: number;
	checkpointPolicy: "ordinal-barrier";
	benchmarkId: string;
	selectedJobId: string;
	selectedCandidateDigest: string;
	irInstructionCount: number;
	calibratedRemainingRatio: number;
	admittedTaskEvaluations: number;
	outputTokens: number;
	activeAgentSeconds: number;
	evaluatorWaitSeconds: number;
	calendarSeconds: number;
}

interface ContrastTaskRow {
	role: "primary" | "sensitivity";
	contrastId: string;
	feature: string;
	benchmarkId: string;
	calibrationIr: number;
	controlJobId: string;
	controlDigest: string;
	controlIr: number;
	controlRatio: number;
	treatmentJobId: string;
	treatmentDigest: string;
	treatmentIr: number;
	treatmentRatio: number;
	treatmentMinusControlIr: number;
	treatmentMinusControlRatio: number;
	controlResources: GroupResources;
	treatmentResources: GroupResources;
}

interface TransferEvidence {
	id: string;
	candidateDigest: string;
	candidateContent: string;
	passCount: number;
	irInstructionCount: number;
	calibratedRemainingRatio: number;
	verifierEpoch: string;
	matchedSearchRunIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function requireString(value: unknown, path: string): string {
	if (typeof value !== "string") throw new Error(`${path} must be a string`);
	return value;
}

function requireNullableString(value: unknown, path: string): string | null {
	if (value === null) return null;
	return requireString(value, path);
}

function requireNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
	return value;
}

function optionalNumber(value: unknown, path: string): number | null {
	if (value === null || value === undefined) return null;
	return requireNumber(value, path);
}

function requireArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
	return value;
}

function executionCount(
	value: unknown,
	tool: "submit" | "status" | "recall",
	field: "succeeded" | "failed",
	path: string,
): number {
	if (!isRecord(value)) return 0;
	const toolRecord = value[tool];
	if (!isRecord(toolRecord)) return 0;
	const count = toolRecord[field];
	return count === undefined ? 0 : requireNumber(count, `${path}.${tool}.${field}`);
}

function requireStringArray(value: unknown, path: string): string[] {
	return requireArray(value, path).map((item, index) => requireString(item, `${path}[${index}]`));
}

function requireRole(value: unknown, path: string): AnalysisRole {
	if (value === "primary" || value === "sensitivity" || value === "operational") return value;
	throw new Error(`${path} must be primary, sensitivity, or operational`);
}

function requireSide(value: unknown, path: string): ContrastSide {
	if (value === "control" || value === "treatment" || value === "operational") return value;
	throw new Error(`${path} must be control, treatment, or operational`);
}

function parseArtifactRef(value: unknown, path: string): ArtifactRef {
	const record = requireRecord(value, path);
	const digest = requireString(record.digest, `${path}.digest`);
	if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${path}.digest is not a SHA-256 digest`);
	return {
		digest,
		byteLength: requireNumber(record.byteLength, `${path}.byteLength`),
		mediaType: requireString(record.mediaType, `${path}.mediaType`),
	};
}

function parseConfig(value: unknown): AnalysisConfig {
	const root = requireRecord(value, "config");
	if (root.schemaVersion !== 1) throw new Error("config.schemaVersion must be 1");
	const runs = requireArray(root.runs, "config.runs").map((item, index): RunConfig => {
		const record = requireRecord(item, `config.runs[${index}]`);
		return {
			id: requireString(record.id, `config.runs[${index}].id`),
			path: requireString(record.path, `config.runs[${index}].path`),
			role: requireRole(record.role, `config.runs[${index}].role`),
			contrastId: requireNullableString(record.contrastId, `config.runs[${index}].contrastId`),
			side: requireSide(record.side, `config.runs[${index}].side`),
		};
	});
	const contrasts = requireArray(root.contrasts, "config.contrasts").map((item, index): ContrastConfig => {
		const record = requireRecord(item, `config.contrasts[${index}]`);
		const role = requireRole(record.role, `config.contrasts[${index}].role`);
		if (role === "operational") throw new Error("Operational runs cannot define efficacy contrasts");
		return {
			id: requireString(record.id, `config.contrasts[${index}].id`),
			feature: requireString(record.feature, `config.contrasts[${index}].feature`),
			role,
			controlRunIds: requireStringArray(record.controlRunIds, `config.contrasts[${index}].controlRunIds`),
			treatmentRunIds: requireStringArray(record.treatmentRunIds, `config.contrasts[${index}].treatmentRunIds`),
		};
	});
	const transfer = requireRecord(root.transfer, "config.transfer");
	const validationRuns = requireArray(transfer.validationRuns, "config.transfer.validationRuns").map(
		(item, index): TransferRunConfig => {
			const record = requireRecord(item, `config.transfer.validationRuns[${index}]`);
			return {
				id: requireString(record.id, `config.transfer.validationRuns[${index}].id`),
				path: requireString(record.path, `config.transfer.validationRuns[${index}].path`),
			};
		},
	);
	const config: AnalysisConfig = {
		schemaVersion: 1,
		analysisId: requireString(root.analysisId, "config.analysisId"),
		searchTasks: requireStringArray(root.searchTasks, "config.searchTasks"),
		calibrationRun: requireString(root.calibrationRun, "config.calibrationRun"),
		runs,
		contrasts,
		transfer: {
			task: requireString(transfer.task, "config.transfer.task"),
			calibrationRun: requireString(transfer.calibrationRun, "config.transfer.calibrationRun"),
			validationRuns,
		},
	};
	validateConfig(config);
	return config;
}

function validateConfig(config: AnalysisConfig): void {
	if (config.searchTasks.length === 0 || new Set(config.searchTasks).size !== config.searchTasks.length) {
		throw new Error("config.searchTasks must be a non-empty unique list");
	}
	const runIds = new Set<string>();
	for (const run of config.runs) {
		if (runIds.has(run.id)) throw new Error(`Duplicate run id ${run.id}`);
		runIds.add(run.id);
		if (run.role === "operational" && (run.contrastId !== null || run.side !== "operational")) {
			throw new Error(`Operational run ${run.id} must not belong to a contrast`);
		}
	}
	const contrastIds = new Set<string>();
	for (const contrast of config.contrasts) {
		if (contrastIds.has(contrast.id)) throw new Error(`Duplicate contrast id ${contrast.id}`);
		contrastIds.add(contrast.id);
		for (const runId of [...contrast.controlRunIds, ...contrast.treatmentRunIds]) {
			const run = config.runs.find((candidate) => candidate.id === runId);
			if (!run) throw new Error(`Contrast ${contrast.id} references missing run ${runId}`);
			if (run.contrastId !== contrast.id || run.role !== contrast.role) {
				throw new Error(`Run ${runId} is not scoped to ${contrast.role} contrast ${contrast.id}`);
			}
		}
	}
}

function parseTask(value: unknown, path: string): ParsedTask {
	const record = requireRecord(value, path);
	const metrics = requireRecord(record.metrics, `${path}.metrics`);
	const verifier = requireRecord(record.verifier, `${path}.verifier`);
	return {
		benchmarkId: requireString(record.benchmarkId, `${path}.benchmarkId`),
		status: requireString(record.status, `${path}.status`),
		verifierPassed: verifier.passed === true,
		irInstructionCount: optionalNumber(metrics[IR_METRIC], `${path}.metrics.${IR_METRIC}`),
		objectTextSizeBytes: optionalNumber(metrics.ObjectTextSizeBytes, `${path}.metrics.ObjectTextSizeBytes`),
		runtimeMs: requireNumber(record.runtimeMs, `${path}.runtimeMs`),
	};
}

async function parseProposal(
	event: LedgerEvent,
	store: ArtifactStore,
	verifiedDigests: Set<string>,
): Promise<ParsedProposal> {
	const record = requireRecord(event.payload, `ledger[${event.sequence}].payload`);
	const candidate = parseArtifactRef(record.candidate, `ledger[${event.sequence}].payload.candidate`);
	const candidateContent = await store.readString(candidate);
	verifiedDigests.add(candidate.digest);
	const proposal = requireRecord(record.proposal, `ledger[${event.sequence}].payload.proposal`);
	return {
		sequence: event.sequence,
		recordedAt: event.recordedAt,
		jobId: requireString(record.jobId, `ledger[${event.sequence}].payload.jobId`),
		manifestDigest: requireString(record.manifestDigest, `ledger[${event.sequence}].payload.manifestDigest`),
		branchId: requireString(record.branchId, `ledger[${event.sequence}].payload.branchId`),
		treatment: requireString(record.treatment, `ledger[${event.sequence}].payload.treatment`),
		benchmarkIds: requireStringArray(record.benchmarkIds, `ledger[${event.sequence}].payload.benchmarkIds`),
		candidateRef: candidate,
		candidateContent,
		hypothesis: requireString(proposal.hypothesis, `ledger[${event.sequence}].payload.proposal.hypothesis`),
		mechanism: requireString(proposal.mechanism, `ledger[${event.sequence}].payload.proposal.mechanism`),
		predictedOutcome: requireString(
			proposal.predictedOutcome,
			`ledger[${event.sequence}].payload.proposal.predictedOutcome`,
		),
		boundaryConditions: requireStringArray(
			proposal.boundaryConditions,
			`ledger[${event.sequence}].payload.proposal.boundaryConditions`,
		),
		parentJobIds: requireStringArray(
			proposal.parentJobIds,
			`ledger[${event.sequence}].payload.proposal.parentJobIds`,
		),
	};
}

async function parseMeasurement(
	event: LedgerEvent,
	store: ArtifactStore,
	verifiedDigests: Set<string>,
): Promise<ParsedMeasurement> {
	const record = requireRecord(event.payload, `ledger[${event.sequence}].payload`);
	for (const key of ["stdout", "stderr"] as const) {
		if (record[key] !== null && record[key] !== undefined) {
			const ref = parseArtifactRef(record[key], `ledger[${event.sequence}].payload.${key}`);
			await store.readString(ref);
			verifiedDigests.add(ref.digest);
		}
	}
	return {
		sequence: event.sequence,
		recordedAt: event.recordedAt,
		jobId: requireString(record.jobId, `ledger[${event.sequence}].payload.jobId`),
		manifestDigest: requireString(record.manifestDigest, `ledger[${event.sequence}].payload.manifestDigest`),
		verifierEpoch: requireString(record.verifierEpoch, `ledger[${event.sequence}].payload.verifierEpoch`),
		tasks: requireArray(record.tasks, `ledger[${event.sequence}].payload.tasks`).map((task, index) =>
			parseTask(task, `ledger[${event.sequence}].payload.tasks[${index}]`),
		),
	};
}

async function loadEvidenceDirectory(directory: string): Promise<EvidenceDirectory> {
	const ledgerPath = join(directory, "evidence.jsonl");
	const ledgerContents = await readFile(ledgerPath, "utf8");
	const ledger = await EvidenceLedger.open(ledgerPath);
	ledger.verify();
	const events = ledger.getEvents();
	if (events.length === 0) throw new Error(`Empty evidence ledger: ${ledgerPath}`);
	const store = new ArtifactStore(join(directory, "artifacts"));
	const verifiedDigests = new Set<string>();
	const proposals: ParsedProposal[] = [];
	const measurements = new Map<string, ParsedMeasurement>();
	const finalStates = new Map<string, string>();
	for (const event of events) {
		if (event.kind === "proposal") {
			const proposal = await parseProposal(event, store, verifiedDigests);
			if (proposals.some((candidate) => candidate.jobId === proposal.jobId)) {
				throw new Error(`Duplicate proposal ${proposal.jobId} in ${ledgerPath}`);
			}
			proposals.push(proposal);
		} else if (event.kind === "measurement") {
			const measurement = await parseMeasurement(event, store, verifiedDigests);
			if (measurements.has(measurement.jobId)) throw new Error(`Duplicate measurement ${measurement.jobId}`);
			measurements.set(measurement.jobId, measurement);
		} else if (event.kind === "job_state") {
			const record = requireRecord(event.payload, `ledger[${event.sequence}].payload`);
			finalStates.set(
				requireString(record.jobId, `ledger[${event.sequence}].payload.jobId`),
				requireString(record.status, `ledger[${event.sequence}].payload.status`),
			);
		}
	}
	for (const [jobId, measurement] of measurements) {
		const proposal = proposals.find((candidate) => candidate.jobId === jobId);
		if (!proposal) throw new Error(`Measurement ${jobId} has no proposal in ${ledgerPath}`);
		if (proposal.manifestDigest !== measurement.manifestDigest) {
			throw new Error(`Manifest digest mismatch for ${jobId} in ${ledgerPath}`);
		}
	}
	return {
		directory,
		ledgerPath,
		ledgerFileSha256: sha256Text(ledgerContents),
		terminalEventHash: events.at(-1)?.hash ?? "",
		eventCount: events.length,
		maxRecordedAt: events.reduce(
			(maximum, event) => (Date.parse(event.recordedAt) > Date.parse(maximum) ? event.recordedAt : maximum),
			events[0].recordedAt,
		),
		verifiedArtifactDigests: [...verifiedDigests].sort(),
		proposals: proposals.sort((left, right) => left.sequence - right.sequence),
		measurements,
		finalStates,
		events,
	};
}

function findRunManifestEvent(evidence: EvidenceDirectory, phase: "start" | "end"): LedgerEvent {
	const matches = evidence.events.filter((event) => {
		if (event.kind !== "run_manifest") return false;
		const payload = requireRecord(event.payload, `ledger[${event.sequence}].payload`);
		return payload.phase === phase;
	});
	if (matches.length !== 1) throw new Error(`${evidence.ledgerPath} must contain exactly one ${phase} run manifest`);
	return matches[0];
}

function parseSnapshots(value: unknown, path: string): Map<string, FrontierSnapshot> {
	const snapshots = new Map<string, FrontierSnapshot>();
	for (const [index, item] of requireArray(value, path).entries()) {
		const record = requireRecord(item, `${path}[${index}]`);
		const usage = requireRecord(
			record.cumulativeKnownAssistantUsage,
			`${path}[${index}].cumulativeKnownAssistantUsage`,
		);
		const snapshot: FrontierSnapshot = {
			jobId: requireString(record.jobId, `${path}[${index}].jobId`),
			terminalAt: requireString(record.terminalAt, `${path}[${index}].terminalAt`),
			cumulativeTaskEvaluations: requireNumber(
				record.cumulativeAdmittedTaskEvaluations,
				`${path}[${index}].cumulativeAdmittedTaskEvaluations`,
			),
			cumulativeOutputTokens: requireNumber(usage.output, `${path}[${index}].cumulativeKnownAssistantUsage.output`),
			cumulativeAgentActiveMs: requireNumber(
				record.cumulativeAgentActiveMs,
				`${path}[${index}].cumulativeAgentActiveMs`,
			),
			cumulativeEvaluatorWaitMs: requireNumber(
				record.cumulativeEvaluatorWaitMs,
				`${path}[${index}].cumulativeEvaluatorWaitMs`,
			),
			cumulativeCalendarMs: requireNumber(record.cumulativeCalendarMs, `${path}[${index}].cumulativeCalendarMs`),
		};
		if (snapshots.has(snapshot.jobId)) throw new Error(`Duplicate frontier snapshot for ${snapshot.jobId}`);
		snapshots.set(snapshot.jobId, snapshot);
	}
	return snapshots;
}

function parseRunManifest(evidence: EvidenceDirectory): RunManifest {
	const startEvent = findRunManifestEvent(evidence, "start");
	const endEvent = findRunManifestEvent(evidence, "end");
	const start = requireRecord(startEvent.payload, `ledger[${startEvent.sequence}].payload`);
	const end = requireRecord(endEvent.payload, `ledger[${endEvent.sequence}].payload`);
	const usage = requireRecord(end.knownUsage, `ledger[${endEvent.sequence}].payload.knownUsage`);
	const cost = requireRecord(usage.cost, `ledger[${endEvent.sequence}].payload.knownUsage.cost`);
	const branchBudget = requireRecord(end.branchBudget, `ledger[${endEvent.sequence}].payload.branchBudget`);
	const providerBudgetTracker = isRecord(end.providerBudgetTracker) ? end.providerBudgetTracker : null;
	const toolExecutions = end.toolExecutions;
	return {
		arm: requireString(end.arm, `ledger[${endEvent.sequence}].payload.arm`),
		outcome: requireString(end.outcome, `ledger[${endEvent.sequence}].payload.outcome`),
		error: typeof end.error === "string" ? end.error : null,
		promptProtocolVersion: requireString(
			end.promptProtocolVersion,
			`ledger[${endEvent.sequence}].payload.promptProtocolVersion`,
		),
		transport:
			typeof end.transport === "string"
				? end.transport
				: typeof start.transport === "string"
					? start.transport
					: "unrecorded",
		providerMaxRetries:
			end.providerMaxRetries === undefined
				? null
				: requireNumber(end.providerMaxRetries, `ledger[${endEvent.sequence}].payload.providerMaxRetries`),
		startedAt: requireString(start.startedAt, `ledger[${startEvent.sequence}].payload.startedAt`),
		finishedAt: endEvent.recordedAt,
		championJobId:
			end.championJobId === undefined
				? null
				: requireNullableString(end.championJobId, `ledger[${endEvent.sequence}].payload.championJobId`),
		iterationsRequested: requireNumber(
			end.iterationsRequested,
			`ledger[${endEvent.sequence}].payload.iterationsRequested`,
		),
		iterationsCompleted: requireNumber(
			end.iterationsCompleted,
			`ledger[${endEvent.sequence}].payload.iterationsCompleted`,
		),
		taskEvaluations: requireNumber(
			branchBudget.taskEvaluations,
			`ledger[${endEvent.sequence}].payload.branchBudget.taskEvaluations`,
		),
		outputTokens: requireNumber(usage.output, `ledger[${endEvent.sequence}].payload.knownUsage.output`),
		inputTokens: requireNumber(usage.input, `ledger[${endEvent.sequence}].payload.knownUsage.input`),
		cacheReadTokens: requireNumber(usage.cacheRead, `ledger[${endEvent.sequence}].payload.knownUsage.cacheRead`),
		totalTokens: requireNumber(usage.totalTokens, `ledger[${endEvent.sequence}].payload.knownUsage.totalTokens`),
		modeledCost: requireNumber(cost.total, `ledger[${endEvent.sequence}].payload.knownUsage.cost.total`),
		agentActiveMs: requireNumber(end.agentActiveMs, `ledger[${endEvent.sequence}].payload.agentActiveMs`),
		evaluatorWaitMs: requireNumber(end.evaluatorWaitMs, `ledger[${endEvent.sequence}].payload.evaluatorWaitMs`),
		calendarMs: requireNumber(end.calendarMs, `ledger[${endEvent.sequence}].payload.calendarMs`),
		protocolDeviationCount: requireArray(
			end.protocolDeviations,
			`ledger[${endEvent.sequence}].payload.protocolDeviations`,
		).length,
		providerCalls:
			providerBudgetTracker === null
				? null
				: requireNumber(
						providerBudgetTracker.providerCalls,
						`ledger[${endEvent.sequence}].payload.providerBudgetTracker.providerCalls`,
					),
		blockedProviderCalls:
			providerBudgetTracker === null
				? null
				: requireNumber(
						providerBudgetTracker.blockedProviderCalls,
						`ledger[${endEvent.sequence}].payload.providerBudgetTracker.blockedProviderCalls`,
					),
		compactionCount: requireNumber(end.compactionCount ?? 0, `ledger[${endEvent.sequence}].payload.compactionCount`),
		sealedContextCheckCount: requireNumber(
			end.sealedContextCheckCount ?? 0,
			`ledger[${endEvent.sequence}].payload.sealedContextCheckCount`,
		),
		toolExecutions: {
			submit: {
				succeeded: executionCount(toolExecutions, "submit", "succeeded", "toolExecutions"),
				failed: executionCount(toolExecutions, "submit", "failed", "toolExecutions"),
			},
			status: {
				succeeded: executionCount(toolExecutions, "status", "succeeded", "toolExecutions"),
				failed: executionCount(toolExecutions, "status", "failed", "toolExecutions"),
			},
			recall: {
				succeeded: executionCount(toolExecutions, "recall", "succeeded", "toolExecutions"),
				failed: executionCount(toolExecutions, "recall", "failed", "toolExecutions"),
			},
		},
		rDiagnostic: end.rDiagnostic === undefined ? null : toJsonValue(end.rDiagnostic),
		snapshots: parseSnapshots(end.frontierSnapshots, `ledger[${endEvent.sequence}].payload.frontierSnapshots`),
	};
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const rightSet = new Set(right);
	return left.every((value) => rightSet.has(value));
}

function selectorScores(candidate: SelectionCandidate, expectedTasks: readonly string[]): [number, number] {
	const ratios = expectedTasks.map((task) => candidate.taskRatios[task]);
	if (ratios.some((ratio) => ratio === undefined || !Number.isFinite(ratio))) {
		throw new Error(`Candidate ${candidate.stableId} lacks a finite ratio for every expected task`);
	}
	return [Math.max(...ratios), ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length];
}

export function compareSelectionCandidates(
	left: SelectionCandidate,
	right: SelectionCandidate,
	expectedTasks: readonly string[],
): number {
	const [leftMax, leftMean] = selectorScores(left, expectedTasks);
	const [rightMax, rightMean] = selectorScores(right, expectedTasks);
	return (
		leftMax - rightMax ||
		leftMean - rightMean ||
		left.passCount - right.passCount ||
		left.candidateDigest.localeCompare(right.candidateDigest) ||
		left.stableId.localeCompare(right.stableId)
	);
}

export function selectCandidate<T extends SelectionCandidate>(
	candidates: readonly T[],
	expectedTasks: readonly string[],
): T | null {
	return [...candidates].sort((left, right) => compareSelectionCandidates(left, right, expectedTasks))[0] ?? null;
}

export function synchronizeCheckpointGroups<T>(branches: readonly (readonly T[])[]): T[][] {
	if (branches.length === 0) throw new Error("Cannot synchronize an empty branch set");
	const checkpointCount = branches[0].length;
	if (branches.some((branch) => branch.length !== checkpointCount)) {
		throw new Error("Synchronized frontier branches must have equal checkpoint counts");
	}
	return Array.from({ length: checkpointCount }, (_, checkpoint) =>
		branches.map((branch) => {
			const item = branch[checkpoint];
			if (item === undefined) throw new Error(`Missing synchronized checkpoint ${checkpoint + 1}`);
			return item;
		}),
	);
}

function experimentFromProposal(
	run: RunConfig,
	proposal: ParsedProposal,
	evidence: EvidenceDirectory,
	manifest: RunManifest,
	calibration: Readonly<Record<string, number>>,
	expectedTasks: readonly string[],
): Experiment {
	const measurement = evidence.measurements.get(proposal.jobId) ?? null;
	const finalState = evidence.finalStates.get(proposal.jobId) ?? null;
	const tasks = measurement?.tasks ?? [];
	const eligible =
		finalState === "succeeded" &&
		sameStringSet(proposal.benchmarkIds, expectedTasks) &&
		sameStringSet(
			tasks.map((task) => task.benchmarkId),
			expectedTasks,
		) &&
		tasks.every(
			(task) =>
				task.status === "accepted" &&
				task.verifierPassed &&
				task.irInstructionCount !== null &&
				Number.isFinite(task.irInstructionCount),
		);
	const taskCounts: Record<string, number> = {};
	const taskRatios: Record<string, number> = {};
	if (eligible) {
		for (const task of expectedTasks) {
			const measured = tasks.find((candidate) => candidate.benchmarkId === task);
			const count = measured?.irInstructionCount;
			const baseline = calibration[task];
			if (count === null || count === undefined || baseline === undefined || baseline <= 0) {
				throw new Error(`Missing calibrated measurement for ${proposal.jobId} on ${task}`);
			}
			taskCounts[task] = count;
			taskRatios[task] = count / baseline;
		}
	}
	const passCount = parseLlvmPassSequence(proposal.candidateContent).length;
	const base: SelectionCandidate = {
		stableId: `${run.id}:${proposal.jobId}`,
		candidateDigest: proposal.candidateRef.digest,
		passCount,
		taskRatios,
	};
	const [selectorMaxRatio, selectorMeanRatio] = eligible ? selectorScores(base, expectedTasks) : [null, null];
	return {
		...base,
		runId: run.id,
		role: run.role,
		contrastId: run.contrastId,
		side: run.side,
		proposal,
		measurement,
		finalState,
		eligible,
		selectorMaxRatio,
		selectorMeanRatio,
		taskCounts,
		snapshot: manifest.snapshots.get(proposal.jobId) ?? null,
	};
}

async function calibrationCounts(
	directory: string,
	tasks: readonly string[],
): Promise<{
	evidence: EvidenceDirectory;
	counts: Readonly<Record<string, number>>;
}> {
	const evidence = await loadEvidenceDirectory(directory);
	if (evidence.proposals.length !== 1 || evidence.measurements.size !== 1) {
		throw new Error(`Calibration ${directory} must contain exactly one proposal and one measurement`);
	}
	const proposal = evidence.proposals[0];
	const measurement = evidence.measurements.get(proposal.jobId);
	if (!measurement || evidence.finalStates.get(proposal.jobId) !== "succeeded") {
		throw new Error(`Calibration ${directory} did not succeed`);
	}
	const counts: Record<string, number> = {};
	for (const taskId of tasks) {
		const task = measurement.tasks.find((candidate) => candidate.benchmarkId === taskId);
		if (!task || task.status !== "accepted" || !task.verifierPassed || task.irInstructionCount === null) {
			throw new Error(`Calibration ${directory} lacks a verifier-valid ${IR_METRIC} for ${taskId}`);
		}
		counts[taskId] = task.irInstructionCount;
	}
	return { evidence, counts };
}

async function loadRun(
	config: RunConfig,
	repoRoot: string,
	calibration: Readonly<Record<string, number>>,
	expectedTasks: readonly string[],
): Promise<LoadedRun> {
	const evidence = await loadEvidenceDirectory(resolve(repoRoot, config.path));
	const manifest = parseRunManifest(evidence);
	const experiments = evidence.proposals.map((proposal) =>
		experimentFromProposal(config, proposal, evidence, manifest, calibration, expectedTasks),
	);
	const selected = selectCandidate(
		experiments.filter((experiment) => experiment.eligible),
		expectedTasks,
	);
	return { config, evidence, manifest, experiments, selected };
}

function resourcesForGroup(runs: readonly LoadedRun[]): GroupResources {
	if (runs.length === 0) throw new Error("Cannot account an empty run group");
	const earliestStart = Math.min(...runs.map((run) => Date.parse(run.manifest.startedAt)));
	const latestFinish = Math.max(...runs.map((run) => Date.parse(run.manifest.finishedAt)));
	return {
		taskEvaluations: runs.reduce((sum, run) => sum + run.manifest.taskEvaluations, 0),
		outputTokens: runs.reduce((sum, run) => sum + run.manifest.outputTokens, 0),
		inputTokens: runs.reduce((sum, run) => sum + run.manifest.inputTokens, 0),
		cacheReadTokens: runs.reduce((sum, run) => sum + run.manifest.cacheReadTokens, 0),
		totalTokens: runs.reduce((sum, run) => sum + run.manifest.totalTokens, 0),
		modeledCost: runs.reduce((sum, run) => sum + run.manifest.modeledCost, 0),
		agentActiveSeconds: runs.reduce((sum, run) => sum + run.manifest.agentActiveMs, 0) / 1000,
		evaluatorWaitSeconds: runs.reduce((sum, run) => sum + run.manifest.evaluatorWaitMs, 0) / 1000,
		aggregateCalendarSeconds: runs.reduce((sum, run) => sum + run.manifest.calendarMs, 0) / 1000,
		criticalPathCalendarSeconds: (latestFinish - earliestStart) / 1000,
	};
}

function runsByIds(allRuns: readonly LoadedRun[], ids: readonly string[]): LoadedRun[] {
	return ids.map((id) => {
		const run = allRuns.find((candidate) => candidate.config.id === id);
		if (!run) throw new Error(`Loaded run ${id} is missing`);
		return run;
	});
}

function selectFromRuns(runs: readonly LoadedRun[], expectedTasks: readonly string[]): Experiment {
	const selected = selectCandidate(
		runs.flatMap((run) => run.experiments).filter((experiment) => experiment.eligible),
		expectedTasks,
	);
	if (!selected) throw new Error(`No eligible candidate in ${runs.map((run) => run.config.id).join(", ")}`);
	return selected;
}

function buildContrastRows(
	contrasts: readonly ContrastConfig[],
	runs: readonly LoadedRun[],
	calibration: Readonly<Record<string, number>>,
	tasks: readonly string[],
): ContrastTaskRow[] {
	return contrasts.flatMap((contrast) => {
		const controlRuns = runsByIds(runs, contrast.controlRunIds);
		const treatmentRuns = runsByIds(runs, contrast.treatmentRunIds);
		const control = selectFromRuns(controlRuns, tasks);
		const treatment = selectFromRuns(treatmentRuns, tasks);
		const controlResources = resourcesForGroup(controlRuns);
		const treatmentResources = resourcesForGroup(treatmentRuns);
		return tasks.map((benchmarkId): ContrastTaskRow => {
			const calibrationIr = calibration[benchmarkId];
			const controlIr = control.taskCounts[benchmarkId];
			const treatmentIr = treatment.taskCounts[benchmarkId];
			if (calibrationIr === undefined || controlIr === undefined || treatmentIr === undefined) {
				throw new Error(`Missing task-local contrast value for ${contrast.id} ${benchmarkId}`);
			}
			return {
				role: contrast.role,
				contrastId: contrast.id,
				feature: contrast.feature,
				benchmarkId,
				calibrationIr,
				controlJobId: control.proposal.jobId,
				controlDigest: control.candidateDigest,
				controlIr,
				controlRatio: controlIr / calibrationIr,
				treatmentJobId: treatment.proposal.jobId,
				treatmentDigest: treatment.candidateDigest,
				treatmentIr,
				treatmentRatio: treatmentIr / calibrationIr,
				treatmentMinusControlIr: treatmentIr - controlIr,
				treatmentMinusControlRatio: (treatmentIr - controlIr) / calibrationIr,
				controlResources,
				treatmentResources,
			};
		});
	});
}

function buildFrontierRows(
	contrasts: readonly ContrastConfig[],
	runs: readonly LoadedRun[],
	tasks: readonly string[],
	calibration: Readonly<Record<string, number>>,
): FrontierRow[] {
	const rows: FrontierRow[] = [];
	for (const contrast of contrasts) {
		for (const side of ["control", "treatment"] as const) {
			const group = runsByIds(runs, side === "control" ? contrast.controlRunIds : contrast.treatmentRunIds);
			const earliestStart = Math.min(...group.map((run) => Date.parse(run.manifest.startedAt)));
			const branches = group.map((run) =>
				run.experiments
					.filter((experiment) => experiment.snapshot !== null)
					.map((experiment) => ({ run, experiment, snapshot: experiment.snapshot as FrontierSnapshot }))
					.sort(
						(left, right) =>
							left.snapshot.cumulativeTaskEvaluations - right.snapshot.cumulativeTaskEvaluations ||
							left.experiment.proposal.sequence - right.experiment.proposal.sequence,
					),
			);
			const checkpoints = synchronizeCheckpointGroups(branches);
			const seen: Experiment[] = [];
			for (const [checkpointIndex, checkpoint] of checkpoints.entries()) {
				for (const event of checkpoint) {
					if (event.experiment.eligible) seen.push(event.experiment);
				}
				const selected = selectCandidate(seen, tasks);
				if (!selected) continue;
				const snapshots = checkpoint.map((event) => event.snapshot);
				const taskEvaluations = snapshots.reduce((sum, snapshot) => sum + snapshot.cumulativeTaskEvaluations, 0);
				const outputTokens = snapshots.reduce((sum, snapshot) => sum + snapshot.cumulativeOutputTokens, 0);
				const activeSeconds = snapshots.reduce((sum, snapshot) => sum + snapshot.cumulativeAgentActiveMs, 0) / 1000;
				const evaluatorSeconds =
					snapshots.reduce((sum, snapshot) => sum + snapshot.cumulativeEvaluatorWaitMs, 0) / 1000;
				const releasedAt = Math.max(...snapshots.map((snapshot) => Date.parse(snapshot.terminalAt)));
				const calendarSeconds =
					group.length === 1 ? snapshots[0].cumulativeCalendarMs / 1000 : (releasedAt - earliestStart) / 1000;
				for (const benchmarkId of tasks) {
					const ir = selected.taskCounts[benchmarkId];
					const baseline = calibration[benchmarkId];
					if (ir === undefined || baseline === undefined)
						throw new Error(`Incomplete frontier for ${benchmarkId}`);
					rows.push({
						role: contrast.role,
						contrastId: contrast.id,
						feature: contrast.feature,
						side,
						checkpoint: checkpointIndex + 1,
						checkpointPolicy: "ordinal-barrier",
						benchmarkId,
						selectedJobId: selected.proposal.jobId,
						selectedCandidateDigest: selected.candidateDigest,
						irInstructionCount: ir,
						calibratedRemainingRatio: ir / baseline,
						admittedTaskEvaluations: taskEvaluations,
						outputTokens,
						activeAgentSeconds: activeSeconds,
						evaluatorWaitSeconds: evaluatorSeconds,
						calendarSeconds,
					});
				}
			}
		}
	}
	return rows;
}

function csvCell(value: string | number | null): string {
	if (value === null) return "";
	const text = typeof value === "number" ? formatNumber(value) : value;
	return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
	return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function formatNumber(value: number, digits = 6): string {
	if (Number.isInteger(value)) return String(value);
	return value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function shortTask(benchmarkId: string): string {
	return benchmarkId.split("/").at(-1) ?? benchmarkId;
}

function shortDigest(digest: string): string {
	return digest.slice(0, 12);
}

function deterministicJson(value: unknown): string {
	return `${JSON.stringify(JSON.parse(canonicalJson(toJsonValue(value))), null, 2)}\n`;
}

function buildRunsCsv(runs: readonly LoadedRun[], tasks: readonly string[]): string {
	const headers = [
		"role",
		"run_id",
		"contrast_id",
		"side",
		"arm",
		"outcome",
		"failure_reason",
		"prompt_protocol",
		"transport",
		"provider_max_retries",
		"proposals",
		"eligible_candidates",
		"manifest_champion_job_id",
		"selector_champion_job_id",
		"selector_champion_digest",
		"selector_pass_count",
		"selector_max_ratio_tiebreak",
		"selector_mean_ratio_tiebreak",
		...tasks.flatMap((task) => [`${shortTask(task)}_ir`, `${shortTask(task)}_remaining_ratio`]),
		"task_evaluations",
		"output_tokens",
		"input_tokens",
		"cache_read_tokens",
		"total_tokens",
		"modeled_cost",
		"agent_active_seconds",
		"evaluator_wait_seconds",
		"calendar_seconds",
		"protocol_deviations",
		"provider_calls",
		"blocked_provider_calls",
		"compaction_count",
		"sealed_context_checks",
		"submit_succeeded",
		"submit_failed",
		"status_succeeded",
		"status_failed",
		"recall_succeeded",
		"recall_failed",
		"ledger_events",
		"ledger_terminal_hash",
		"verified_artifacts",
	];
	const rows = runs.map((run) => {
		const selected = run.selected;
		return [
			run.config.role,
			run.config.id,
			run.config.contrastId,
			run.config.side,
			run.manifest.arm,
			run.manifest.outcome,
			run.manifest.error,
			run.manifest.promptProtocolVersion,
			run.manifest.transport,
			run.manifest.providerMaxRetries,
			run.experiments.length,
			run.experiments.filter((experiment) => experiment.eligible).length,
			run.manifest.championJobId,
			selected?.proposal.jobId ?? null,
			selected?.candidateDigest ?? null,
			selected?.passCount ?? null,
			selected?.selectorMaxRatio ?? null,
			selected?.selectorMeanRatio ?? null,
			...tasks.flatMap((task) => [selected?.taskCounts[task] ?? null, selected?.taskRatios[task] ?? null]),
			run.manifest.taskEvaluations,
			run.manifest.outputTokens,
			run.manifest.inputTokens,
			run.manifest.cacheReadTokens,
			run.manifest.totalTokens,
			run.manifest.modeledCost,
			run.manifest.agentActiveMs / 1000,
			run.manifest.evaluatorWaitMs / 1000,
			run.manifest.calendarMs / 1000,
			run.manifest.protocolDeviationCount,
			run.manifest.providerCalls,
			run.manifest.blockedProviderCalls,
			run.manifest.compactionCount,
			run.manifest.sealedContextCheckCount,
			run.manifest.toolExecutions.submit.succeeded,
			run.manifest.toolExecutions.submit.failed,
			run.manifest.toolExecutions.status.succeeded,
			run.manifest.toolExecutions.status.failed,
			run.manifest.toolExecutions.recall.succeeded,
			run.manifest.toolExecutions.recall.failed,
			run.evidence.eventCount,
			run.evidence.terminalEventHash,
			run.evidence.verifiedArtifactDigests.length,
		] satisfies (string | number | null)[];
	});
	return csv(headers, rows);
}

function buildExperimentsJsonl(runs: readonly LoadedRun[], tasks: readonly string[]): string {
	return `${runs
		.flatMap((run) => run.experiments)
		.map((experiment) =>
			canonicalJson(
				toJsonValue({
					schemaVersion: 1,
					role: experiment.role,
					contrastId: experiment.contrastId,
					side: experiment.side,
					runId: experiment.runId,
					proposalSequence: experiment.proposal.sequence,
					proposedAt: experiment.proposal.recordedAt,
					jobId: experiment.proposal.jobId,
					branchId: experiment.proposal.branchId,
					treatment: experiment.proposal.treatment,
					parentJobIds: experiment.proposal.parentJobIds,
					hypothesis: experiment.proposal.hypothesis,
					mechanism: experiment.proposal.mechanism,
					predictedOutcome: experiment.proposal.predictedOutcome,
					boundaryConditions: experiment.proposal.boundaryConditions,
					candidate: {
						digest: experiment.candidateDigest,
						content: experiment.proposal.candidateContent,
						passCount: experiment.passCount,
					},
					finalState: experiment.finalState,
					measurementSequence: experiment.measurement?.sequence ?? null,
					measuredAt: experiment.measurement?.recordedAt ?? null,
					verifierEpoch: experiment.measurement?.verifierEpoch ?? null,
					eligible: experiment.eligible,
					selector: experiment.eligible
						? {
								policy: "min max calibrated remaining ratio, then mean, pass count, digest",
								maxRatio: experiment.selectorMaxRatio,
								meanRatio: experiment.selectorMeanRatio,
							}
						: null,
					tasks: tasks.map((benchmarkId) => {
						const measured = experiment.measurement?.tasks.find((task) => task.benchmarkId === benchmarkId);
						return {
							benchmarkId,
							status: measured?.status ?? "missing",
							verifierPassed: measured?.verifierPassed ?? false,
							irInstructionCount: measured?.irInstructionCount ?? null,
							objectTextSizeBytes: measured?.objectTextSizeBytes ?? null,
							calibratedRemainingRatio: experiment.taskRatios[benchmarkId] ?? null,
						};
					}),
				}),
			),
		)
		.join("\n")}\n`;
}

function buildFrontierCsv(rows: readonly FrontierRow[]): string {
	return csv(
		[
			"role",
			"contrast_id",
			"feature",
			"side",
			"checkpoint",
			"checkpoint_policy",
			"benchmark_id",
			"selected_job_id",
			"selected_candidate_digest",
			"ir_instruction_count",
			"calibrated_remaining_ratio",
			"admitted_task_evaluations",
			"output_tokens",
			"active_agent_seconds",
			"evaluator_wait_seconds",
			"calendar_seconds",
		],
		rows.map((row) => [
			row.role,
			row.contrastId,
			row.feature,
			row.side,
			row.checkpoint,
			row.checkpointPolicy,
			row.benchmarkId,
			row.selectedJobId,
			row.selectedCandidateDigest,
			row.irInstructionCount,
			row.calibratedRemainingRatio,
			row.admittedTaskEvaluations,
			row.outputTokens,
			row.activeAgentSeconds,
			row.evaluatorWaitSeconds,
			row.calendarSeconds,
		]),
	);
}

function buildContrastsCsv(rows: readonly ContrastTaskRow[]): string {
	return csv(
		[
			"role",
			"contrast_id",
			"feature",
			"benchmark_id",
			"calibration_ir",
			"control_job_id",
			"control_digest",
			"control_ir",
			"control_remaining_ratio",
			"treatment_job_id",
			"treatment_digest",
			"treatment_ir",
			"treatment_remaining_ratio",
			"treatment_minus_control_ir",
			"treatment_minus_control_ratio",
			"control_task_evaluations",
			"treatment_task_evaluations",
			"control_output_tokens",
			"treatment_output_tokens",
			"control_input_tokens",
			"treatment_input_tokens",
			"control_total_tokens",
			"treatment_total_tokens",
			"control_modeled_cost",
			"treatment_modeled_cost",
			"control_active_agent_seconds",
			"treatment_active_agent_seconds",
			"control_critical_path_seconds",
			"treatment_critical_path_seconds",
		],
		rows.map((row) => [
			row.role,
			row.contrastId,
			row.feature,
			row.benchmarkId,
			row.calibrationIr,
			row.controlJobId,
			row.controlDigest,
			row.controlIr,
			row.controlRatio,
			row.treatmentJobId,
			row.treatmentDigest,
			row.treatmentIr,
			row.treatmentRatio,
			row.treatmentMinusControlIr,
			row.treatmentMinusControlRatio,
			row.controlResources.taskEvaluations,
			row.treatmentResources.taskEvaluations,
			row.controlResources.outputTokens,
			row.treatmentResources.outputTokens,
			row.controlResources.inputTokens,
			row.treatmentResources.inputTokens,
			row.controlResources.totalTokens,
			row.treatmentResources.totalTokens,
			row.controlResources.modeledCost,
			row.treatmentResources.modeledCost,
			row.controlResources.agentActiveSeconds,
			row.treatmentResources.agentActiveSeconds,
			row.controlResources.criticalPathCalendarSeconds,
			row.treatmentResources.criticalPathCalendarSeconds,
		]),
	);
}

function xmlEscape(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function buildSvg(task: string, rows: readonly FrontierRow[]): string {
	const taskRows = rows.filter((row) => row.role === "primary" && row.benchmarkId === task);
	const width = 960;
	const height = 560;
	const left = 90;
	const right = 30;
	const top = 72;
	const bottom = 120;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const xMax = Math.max(2, ...taskRows.map((row) => row.admittedTaskEvaluations));
	const ratios = taskRows.map((row) => row.calibratedRemainingRatio);
	const yMin = Math.max(0, Math.floor((Math.min(...ratios) - 0.04) * 20) / 20);
	const yMax = Math.min(1, Math.ceil((Math.max(...ratios) + 0.04) * 20) / 20);
	const safeYMax = yMax <= yMin ? yMin + 0.05 : yMax;
	const x = (value: number) => left + (value / xMax) * plotWidth;
	const y = (value: number) => top + ((safeYMax - value) / (safeYMax - yMin)) * plotHeight;
	const colors = ["#6b7280", "#7c3aed", "#2563eb", "#0891b2", "#b45309", "#dc2626"] as const;
	const series = [
		...new Map(
			taskRows.map((row) => {
				const key = `${row.contrastId}:${row.side}`;
				return [
					key,
					{ contrastId: row.contrastId, side: row.side, label: `${row.contrastId} ${row.side}` },
				] as const;
			}),
		).values(),
	].map((item, index) => ({ ...item, color: colors[index % colors.length] }));
	const yTicks = Array.from({ length: 6 }, (_, index) => yMin + ((safeYMax - yMin) * index) / 5);
	const xTicks = Array.from({ length: Math.floor(xMax / 2) + 1 }, (_, index) => index * 2);
	const parts = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		'<rect width="100%" height="100%" fill="#ffffff"/>',
		`<text x="${left}" y="34" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#111827">${xmlEscape(shortTask(task))}: verifier-valid CPU smoke frontier</text>`,
		`<text x="${left}" y="56" font-family="system-ui, sans-serif" font-size="13" fill="#4b5563">Task-local LLVM IR remaining; multi-branch checkpoints use ordinal barriers; lower is better</text>`,
	];
	for (const tick of yTicks) {
		parts.push(
			`<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5e7eb"/>`,
			`<text x="${left - 12}" y="${y(tick) + 4}" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" fill="#6b7280">${formatNumber(tick * 100, 1)}%</text>`,
		);
	}
	for (const tick of xTicks) {
		parts.push(
			`<line x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}" stroke="#f3f4f6"/>`,
			`<text x="${x(tick)}" y="${height - bottom + 24}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#6b7280">${tick}</text>`,
		);
	}
	parts.push(
		`<line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" stroke="#111827"/>`,
		`<line x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" stroke="#111827"/>`,
		`<text x="${left + plotWidth / 2}" y="${height - bottom + 40}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#111827">Admitted task evaluations across the arm</text>`,
	);
	for (const [seriesIndex, item] of series.entries()) {
		const points = taskRows
			.filter((row) => row.contrastId === item.contrastId && row.side === item.side)
			.sort(
				(leftRow, rightRow) =>
					leftRow.admittedTaskEvaluations - rightRow.admittedTaskEvaluations ||
					leftRow.checkpoint - rightRow.checkpoint,
			);
		if (points.length > 0) {
			parts.push(
				`<polyline fill="none" stroke="${item.color}" stroke-width="2.5" points="${points
					.map((point) => `${x(point.admittedTaskEvaluations)},${y(point.calibratedRemainingRatio)}`)
					.join(" ")}"/>`,
			);
			for (const point of points) {
				parts.push(
					`<circle cx="${x(point.admittedTaskEvaluations)}" cy="${y(point.calibratedRemainingRatio)}" r="4" fill="${item.color}"/>`,
				);
			}
		}
		const legendX = left + (seriesIndex % 3) * 245;
		const legendY = height - 48 + Math.floor(seriesIndex / 3) * 19;
		parts.push(
			`<line x1="${legendX}" x2="${legendX + 25}" y1="${legendY}" y2="${legendY}" stroke="${item.color}" stroke-width="3"/>`,
			`<text x="${legendX + 32}" y="${legendY + 4}" font-family="system-ui, sans-serif" font-size="12" fill="#374151">${xmlEscape(item.label)}</text>`,
		);
	}
	parts.push("</svg>");
	return `${parts.join("\n")}\n`;
}

async function loadTransferEvidence(
	config: AnalysisConfig["transfer"],
	repoRoot: string,
	searchExperiments: readonly Experiment[],
): Promise<{
	calibrationEvidence: EvidenceDirectory;
	calibrationIr: number;
	validationEvidence: EvidenceDirectory[];
	validations: TransferEvidence[];
}> {
	const calibration = await calibrationCounts(resolve(repoRoot, config.calibrationRun), [config.task]);
	const calibrationIr = calibration.counts[config.task];
	if (calibrationIr === undefined) throw new Error(`Missing transfer calibration for ${config.task}`);
	const validationEvidence: EvidenceDirectory[] = [];
	const validations: TransferEvidence[] = [];
	for (const input of config.validationRuns) {
		const evidence = await loadEvidenceDirectory(resolve(repoRoot, input.path));
		validationEvidence.push(evidence);
		if (evidence.proposals.length !== 1 || evidence.measurements.size !== 1) {
			throw new Error(`Transfer validation ${input.id} must contain one proposal and measurement`);
		}
		const proposal = evidence.proposals[0];
		const measurement = evidence.measurements.get(proposal.jobId);
		const task = measurement?.tasks.find((candidate) => candidate.benchmarkId === config.task);
		if (
			!measurement ||
			evidence.finalStates.get(proposal.jobId) !== "succeeded" ||
			!task ||
			task.status !== "accepted" ||
			!task.verifierPassed ||
			task.irInstructionCount === null
		) {
			throw new Error(`Transfer validation ${input.id} is not verifier-valid`);
		}
		validations.push({
			id: input.id,
			candidateDigest: proposal.candidateRef.digest,
			candidateContent: proposal.candidateContent,
			passCount: parseLlvmPassSequence(proposal.candidateContent).length,
			irInstructionCount: task.irInstructionCount,
			calibratedRemainingRatio: task.irInstructionCount / calibrationIr,
			verifierEpoch: measurement.verifierEpoch,
			matchedSearchRunIds: [
				...new Set(
					searchExperiments
						.filter((experiment) => experiment.candidateDigest === proposal.candidateRef.digest)
						.map((experiment) => experiment.runId),
				),
			].sort(),
		});
	}
	return { calibrationEvidence: calibration.evidence, calibrationIr, validationEvidence, validations };
}

function signedPercentChange(treatment: number, control: number): string {
	if (control === 0) return treatment === 0 ? "0%" : "not defined";
	const change = ((treatment - control) / control) * 100;
	return `${change >= 0 ? "+" : ""}${formatNumber(change, 1)}%`;
}

function buildReport(
	config: AnalysisConfig,
	runs: readonly LoadedRun[],
	contrastRows: readonly ContrastTaskRow[],
	transferCalibrationIr: number,
	transfer: readonly TransferEvidence[],
	reproduce: { configPath: string; outputDir: string },
): string {
	const primary = contrastRows.filter((row) => row.role === "primary");
	const sensitivity = contrastRows.filter((row) => row.role === "sensitivity");
	const operational = runs.filter((run) => run.config.role === "operational");
	const primaryContrasts = config.contrasts.filter((contrast) => contrast.role === "primary");
	const primaryRuns = runs.filter((run) => run.config.role === "primary");
	const interpretation = primaryContrasts.flatMap((contrast) => {
		const rows = primary.filter((row) => row.contrastId === contrast.id);
		const representative = rows[0];
		if (!representative) throw new Error(`Missing primary rows for ${contrast.id}`);
		const qualityTied = rows.every((row) => row.treatmentMinusControlIr === 0);
		const candidateTied = rows.every((row) => row.controlDigest === row.treatmentDigest);
		const quality = qualityTied
			? `selected ${candidateTied ? "the identical candidate and " : "candidates that "}tied every task-local IR result`
			: `changed task-local IR by ${rows.map((row) => `${shortTask(row.benchmarkId)} ${row.treatmentMinusControlIr >= 0 ? "+" : ""}${row.treatmentMinusControlIr}`).join(", ")}`;
		return [
			`- ${contrast.id} (${contrast.feature}) ${quality}. Treatment versus control: task evaluations ${representative.treatmentResources.taskEvaluations} vs ${representative.controlResources.taskEvaluations}; output tokens ${signedPercentChange(representative.treatmentResources.outputTokens, representative.controlResources.outputTokens)}; total tokens ${signedPercentChange(representative.treatmentResources.totalTokens, representative.controlResources.totalTokens)}; modeled cost ${signedPercentChange(representative.treatmentResources.modeledCost, representative.controlResources.modeledCost)}.`,
			qualityTied &&
			representative.treatmentResources.taskEvaluations >= representative.controlResources.taskEvaluations
				? `- ${contrast.id} does not pass promotion: it produced no task-local quality gain and no evaluator-call reduction.`
				: `- ${contrast.id} remains a smoke result; one trajectory per side cannot establish a causal effect.`,
		];
	});
	const lines = [
		`# ${config.analysisId}`,
		"",
		"## Status",
		"",
		`This is a verifier-valid smoke-stage systems result over ${primaryContrasts.length} primary matched contrast${primaryContrasts.length === 1 ? "" : "s"}. It is not a causal confirmation and it does not combine the two benchmark tasks into a single score. No tested feature is promoted from this evidence.`,
		"",
		"## Evidence and selection",
		"",
		`The analyzer verified every source ledger's hash chain and re-read every candidate, stdout, and stderr reference from its content-addressed store. It did not use \`result.json\` as evidence. Candidates were eligible only after all expected search tasks passed the frozen verifier and exposed raw \`${IR_METRIC}\`.`,
		"",
		"The selector minimizes the worst task-local remaining ratio to the empty-pass calibration, then mean ratio, pass count, candidate digest, and stable identity. Task results remain separate throughout.",
		"",
		"## Primary task-local results",
		"",
		"| Contrast | Task | Calibration IR | Control IR | Treatment IR | Treatment - control |",
		"|---|---:|---:|---:|---:|---:|",
		...primary.map(
			(row) =>
				`| ${row.contrastId} | ${shortTask(row.benchmarkId)} | ${row.calibrationIr} | ${row.controlIr} (${formatNumber(row.controlRatio * 100, 2)}%) | ${row.treatmentIr} (${formatNumber(row.treatmentRatio * 100, 2)}%) | ${row.treatmentMinusControlIr >= 0 ? "+" : ""}${row.treatmentMinusControlIr} |`,
		),
		"",
		"Lower raw IR and lower remaining ratio are better. Solid frontier points contain only candidates that passed both task verifiers.",
		"",
		"## Resource accounting",
		"",
		"| Contrast | Side | Task evals | Input | Output | Cache read | Total tokens | Modeled cost | Agent s | Eval wait s | Critical path s |",
		"|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
		...primaryContrasts.flatMap((contrast) => {
			const row = primary.find((candidate) => candidate.contrastId === contrast.id);
			if (!row) throw new Error(`Missing primary row for ${contrast.id}`);
			return [
				`| ${contrast.id} | control | ${row.controlResources.taskEvaluations} | ${row.controlResources.inputTokens} | ${row.controlResources.outputTokens} | ${row.controlResources.cacheReadTokens} | ${row.controlResources.totalTokens} | ${formatNumber(row.controlResources.modeledCost, 6)} | ${formatNumber(row.controlResources.agentActiveSeconds, 3)} | ${formatNumber(row.controlResources.evaluatorWaitSeconds, 3)} | ${formatNumber(row.controlResources.criticalPathCalendarSeconds, 3)} |`,
				`| ${contrast.id} | treatment | ${row.treatmentResources.taskEvaluations} | ${row.treatmentResources.inputTokens} | ${row.treatmentResources.outputTokens} | ${row.treatmentResources.cacheReadTokens} | ${row.treatmentResources.totalTokens} | ${formatNumber(row.treatmentResources.modeledCost, 6)} | ${formatNumber(row.treatmentResources.agentActiveSeconds, 3)} | ${formatNumber(row.treatmentResources.evaluatorWaitSeconds, 3)} | ${formatNumber(row.treatmentResources.criticalPathCalendarSeconds, 3)} |`,
			];
		}),
		"",
		"Provider dispatches are hard-capped before transport. Output-token and time ceilings are checkpointed after each completed call because the ChatGPT Codex subscription endpoint rejects `max_output_tokens`; they are not claimed as hard per-response caps.",
		"",
		"## Tool, compaction, and transport integrity",
		"",
		"| Run | Outcome | Transport/retries | Provider calls/blocked | Compactions/sealed checks | Submit | Status | Recall | Protocol deviations |",
		"|---|---|---|---:|---:|---:|---:|---:|---:|",
		...primaryRuns.map(
			(run) =>
				`| ${run.config.id} | ${run.manifest.outcome} | ${run.manifest.transport}/${run.manifest.providerMaxRetries ?? "unrecorded"} | ${run.manifest.providerCalls ?? "unrecorded"}/${run.manifest.blockedProviderCalls ?? "unrecorded"} | ${run.manifest.compactionCount}/${run.manifest.sealedContextCheckCount} | ${run.manifest.toolExecutions.submit.succeeded}/${run.manifest.toolExecutions.submit.failed} | ${run.manifest.toolExecutions.status.succeeded}/${run.manifest.toolExecutions.status.failed} | ${run.manifest.toolExecutions.recall.succeeded}/${run.manifest.toolExecutions.recall.failed} | ${run.manifest.protocolDeviationCount} |`,
		),
		"",
		"Tool columns are succeeded/failed. Sealed checks assert that pre-compaction job IDs, manifests, and candidate bytes are absent from rebuilt model context. Typed recall remains branch-local; the append-only session and evidence ledgers retain the underlying history.",
		"",
		"## Held-out dijkstra transfer evidence",
		"",
		`The empty-pass dijkstra calibration is ${transferCalibrationIr} IR instructions. These measurements are held-out transfer evidence and never enter the search frontier.`,
		"",
		"| Candidate | Passes | Dijkstra IR | Remaining | Search-run matches |",
		"|---|---:|---:|---:|---|",
		...transfer.map(
			(item) =>
				`| ${shortDigest(item.candidateDigest)} | ${item.passCount} | ${item.irInstructionCount} | ${formatNumber(item.calibratedRemainingRatio * 100, 2)}% | ${item.matchedSearchRunIds.join(", ")} |`,
		),
		"",
		"## Sensitivity and operational evidence",
		"",
		...(sensitivity.length > 0
			? [
					"| Contrast | Task | Control IR | Treatment IR | Treatment - control |",
					"|---|---:|---:|---:|---:|",
					...sensitivity.map(
						(row) =>
							`| ${row.contrastId} | ${shortTask(row.benchmarkId)} | ${row.controlIr} | ${row.treatmentIr} | ${row.treatmentMinusControlIr >= 0 ? "+" : ""}${row.treatmentMinusControlIr} |`,
					),
				]
			: ["No sensitivity contrast is pooled with this sealed primary pair."]),
		"",
		...operational.map((run) => {
			const error = run.manifest.error?.split("\n")[0]?.replaceAll("`", "'");
			return `- ${run.config.id}: ${run.experiments.length} proposals, ${run.experiments.filter((experiment) => experiment.eligible).length} selector-eligible candidates, outcome \`${run.manifest.outcome}\`${error ? `; retained error: \`${error}\`` : ""}.`;
		}),
		"",
		"## Interpretation and next gate",
		"",
		...interpretation,
		"- Successful tool use and compaction continuity establish mechanism viability, not research-performance benefit. A GPU transfer or additional paid M replication is not justified until a CPU treatment shows a task-local quality gain or a predeclared equal-quality evaluator-efficiency gain.",
		"",
		"## Reproduce",
		"",
		"```bash",
		`npm run autoresearch:analyze-cpu-smoke -- --config ${reproduce.configPath} --output-dir ${reproduce.outputDir}`,
		"```",
		"",
		"The analysis manifest pins every ledger terminal hash, raw ledger-file hash, verified artifact digest set, analyzer hash, config hash, and output hash.",
		"",
	];
	return lines.join("\n");
}

function parseCli(
	argv: readonly string[],
	repoRoot: string,
	defaultConfig: string,
	defaultOutput: string,
): { configPath: string; outputDir: string } {
	let configPath = defaultConfig;
	let outputDir = defaultOutput;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--config") {
			const value = argv[++index];
			if (!value) throw new Error("--config requires a path");
			configPath = resolve(repoRoot, value);
		} else if (argument === "--output-dir") {
			const value = argv[++index];
			if (!value) throw new Error("--output-dir requires a path");
			outputDir = resolve(repoRoot, value);
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return { configPath, outputDir };
}

export async function analyzeCpuSmoke(configPath: string, outputDir: string): Promise<void> {
	const sourcePath = fileURLToPath(import.meta.url);
	const repoRoot = resolve(dirname(sourcePath), "../../..");
	const configContents = await readFile(configPath, "utf8");
	const config = parseConfig(JSON.parse(configContents));
	const calibration = await calibrationCounts(resolve(repoRoot, config.calibrationRun), config.searchTasks);
	const runs: LoadedRun[] = [];
	for (const runConfig of config.runs) {
		runs.push(await loadRun(runConfig, repoRoot, calibration.counts, config.searchTasks));
	}
	const contrastRows = buildContrastRows(config.contrasts, runs, calibration.counts, config.searchTasks);
	const frontierRows = buildFrontierRows(config.contrasts, runs, config.searchTasks, calibration.counts);
	const allExperiments = runs.flatMap((run) => run.experiments);
	const transfer = await loadTransferEvidence(config.transfer, repoRoot, allExperiments);
	const report = buildReport(config, runs, contrastRows, transfer.calibrationIr, transfer.validations, {
		configPath: relative(repoRoot, configPath),
		outputDir: relative(repoRoot, outputDir),
	});
	const outputs = new Map<string, string>([
		["runs.csv", buildRunsCsv(runs, config.searchTasks)],
		["experiments.jsonl", buildExperimentsJsonl(runs, config.searchTasks)],
		["frontier.csv", buildFrontierCsv(frontierRows)],
		["contrasts.csv", buildContrastsCsv(contrastRows)],
		["report.md", report],
		[`frontier-${shortTask(config.searchTasks[0])}.svg`, buildSvg(config.searchTasks[0], frontierRows)],
		[`frontier-${shortTask(config.searchTasks[1])}.svg`, buildSvg(config.searchTasks[1], frontierRows)],
	]);
	await mkdir(outputDir, { recursive: true });
	for (const [name, contents] of outputs) await writeFile(join(outputDir, name), contents, "utf8");
	const allEvidence = [
		calibration.evidence,
		...runs.map((run) => run.evidence),
		transfer.calibrationEvidence,
		...transfer.validationEvidence,
	];
	const maxRecordedAt = allEvidence.reduce(
		(maximum, evidence) =>
			Date.parse(evidence.maxRecordedAt) > Date.parse(maximum) ? evidence.maxRecordedAt : maximum,
		allEvidence[0].maxRecordedAt,
	);
	const manifest = {
		schemaVersion: 1,
		analysisId: config.analysisId,
		analysisProtocol: ANALYSIS_PROTOCOL,
		generatedFromRecordedAt: maxRecordedAt,
		config: {
			path: relative(repoRoot, configPath),
			sha256: sha256Text(configContents),
		},
		analyzer: {
			path: relative(repoRoot, sourcePath),
			sha256: sha256Text(await readFile(sourcePath, "utf8")),
		},
		selectionPolicy: {
			eligibility: "all expected tasks accepted with verifier pass and finite raw IrInstructionCount",
			ordering: [
				"minimum maximum calibrated remaining ratio",
				"minimum mean calibrated remaining ratio",
				"minimum LLVM pass count",
				"lexicographic candidate digest",
			],
			reporting: "task-local results only; dijkstra is transfer evidence and excluded from frontiers",
			frontierCheckpoints:
				"ordinal barriers; multi-branch checkpoint k is emitted only after candidate k terminates on every branch",
		},
		inputs: allEvidence
			.map((evidence) => ({
				ledgerPath: relative(repoRoot, evidence.ledgerPath),
				ledgerFileSha256: evidence.ledgerFileSha256,
				terminalEventHash: evidence.terminalEventHash,
				eventCount: evidence.eventCount,
				verifiedArtifactDigests: evidence.verifiedArtifactDigests,
			}))
			.sort((left, right) => left.ledgerPath.localeCompare(right.ledgerPath)),
		outputs: [...outputs.entries()]
			.map(([path, contents]) => ({ path, byteLength: Buffer.byteLength(contents), sha256: sha256Text(contents) }))
			.sort((left, right) => left.path.localeCompare(right.path)),
	};
	await writeFile(join(outputDir, "analysis-manifest.json"), deterministicJson(manifest), "utf8");
}

async function main(): Promise<void> {
	const sourcePath = fileURLToPath(import.meta.url);
	const repoRoot = resolve(dirname(sourcePath), "../../..");
	const defaults = {
		configPath: join(repoRoot, "research/autoresearch/cpu-smoke-v5.analysis.json"),
		outputDir: join(repoRoot, ".autoresearch/cpu-analysis/v5"),
	};
	const options = parseCli(process.argv.slice(2), repoRoot, defaults.configPath, defaults.outputDir);
	await analyzeCpuSmoke(options.configPath, options.outputDir);
	process.stdout.write(`${options.outputDir}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	});
}

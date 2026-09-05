import { readFile } from "node:fs/promises";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import {
	buildCompilerGymWarmPilotTiming,
	type CompilerGymWarmPilotBlockMarks,
	type CompilerGymWarmPilotCandidateMarks,
	type CompilerGymWarmPilotEvidenceRecord,
	type CompilerGymWarmPilotOutcome,
	type CompilerGymWarmPilotTimingSnapshot,
	type CompilerGymWarmPilotTransportMarks,
	compilerGymWarmPilotEvidenceRecord,
	verifyCompilerGymWarmPilotEvidence,
} from "./compiler-gym-warm-pilot-evidence.js";
import {
	type CompilerGymWarmPilotRecordEvidence,
	type CompilerGymWarmPilotRecordEvidenceProvider,
	materializeCompilerGymWarmPilotRecordEvidence,
} from "./compiler-gym-warm-pilot-record-evidence.js";
import {
	COMPILER_GYM_WARM_TASKS,
	type CompilerGymWarmCleanupVerification,
	type CompilerGymWarmCloseVerification,
	type CompilerGymWarmEvaluationInput,
	type CompilerGymWarmEvaluationResult,
	type CompilerGymWarmPreparedEvaluation,
	type CompilerGymWarmTransport,
} from "./compiler-gym-warm-transport.js";
import { ResearchController } from "./controller.js";
import type {
	ArtifactRef,
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	JobView,
} from "./types.js";

export const COMPILER_GYM_WARM_PILOT_TREATMENT = "compiler-gym-warm-pilot-fixed-v1" as const;

export interface CompilerGymWarmPilotClock {
	nowNs(): bigint;
}

export interface CompilerGymWarmPilotAdapter extends EvaluationAdapter {
	closeAndVerify(): Promise<CompilerGymWarmCleanupVerification | undefined>;
}

export interface CompilerGymWarmPilotCandidate {
	candidateId: string;
	actions: readonly string[];
	candidateSha256: string;
}

export interface CompilerGymWarmPilotOptions {
	blockId: string;
	arm: string;
	branchId: string;
	ledgerPath: string;
	artifactDir: string;
	candidates: readonly CompilerGymWarmPilotCandidate[];
	allowRepeatedCandidates?: boolean;
	createTransport(): Promise<CompilerGymWarmTransport> | CompilerGymWarmTransport;
	recordEvidenceProvider: CompilerGymWarmPilotRecordEvidenceProvider;
	createAdapter?(transport: CompilerGymWarmTransport): CompilerGymWarmPilotAdapter;
	clock?: CompilerGymWarmPilotClock;
	now?: () => Date;
	signal?: AbortSignal;
	persistEvidence?(controller: ResearchController, record: CompilerGymWarmPilotEvidenceRecord): Promise<void>;
}

export interface CompilerGymWarmPilotResult {
	blockId: string;
	arm: string;
	jobs: readonly JobView[];
	outcome: "succeeded";
	cleanup: CompilerGymWarmCloseVerification;
	recordEvidence: CompilerGymWarmPilotRecordEvidence;
	timing: CompilerGymWarmPilotTimingSnapshot;
	evidence: readonly CompilerGymWarmPilotEvidenceRecord[];
	trials: readonly CompilerGymWarmPilotTrialRecord[];
	blockRecord: CompilerGymWarmPilotBlockRecord;
}

export interface CompilerGymWarmPilotBlockRecord {
	block: string;
	arm: string;
	poolDigest: string;
	slurmId: string;
	serviceSpan: CompilerGymWarmPilotTimingSnapshot["candidates"][number]["candidateWall"];
	closeCall: CompilerGymWarmPilotTimingSnapshot["candidates"][number]["candidateWall"];
	blockOperational: CompilerGymWarmPilotTimingSnapshot["candidates"][number]["candidateWall"];
	schedulerAbsentAtHostNs: string;
	cleanup: CompilerGymWarmPilotRecordEvidence["cleanup"];
	accounting: CompilerGymWarmPilotRecordEvidence["accounting"];
}

export interface CompilerGymWarmPilotTrialRecord {
	block: string;
	arm: string;
	position: number;
	candidateDigest: string;
	jobId: string;
	manifestDigest: string;
	firstWarmRequest: boolean;
	candidateWall: CompilerGymWarmPilotTimingSnapshot["candidates"][number]["candidateWall"];
	poolAcquire: CompilerGymWarmPilotRecordEvidence["acquisition"] | null;
	evaluationExcludingAcquireNs: string;
	tasks: Array<{
		benchmarkId: string;
		status: string;
		verifierPassed: boolean;
		irInstructionCount: number | null;
		objectTextSizeBytes: number | null;
		evaluatorReportedTotalNs: string | null;
		stdoutRef: ArtifactRef | null;
		stderrRef: ArtifactRef | null;
		slurmJobId: string;
	}>;
}

export interface CompilerGymWarmPilotProcessSignalTarget {
	on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
	off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface CompilerGymWarmPilotSignalScope {
	signal: AbortSignal;
	receivedSignal(): "SIGINT" | "SIGTERM" | null;
	dispose(): void;
}

export class CompilerGymWarmPilotAbortError extends Error {
	constructor(
		readonly signalName: "SIGINT" | "SIGTERM" | "external",
		options: { cause?: unknown } = {},
	) {
		super(`CompilerGym warm-pilot block aborted by ${signalName}`, options);
		this.name = "CompilerGymWarmPilotAbortError";
	}
}

export class CompilerGymWarmPilotPhaseError extends Error {
	constructor(
		readonly phase: string,
		cause: unknown,
	) {
		super(`CompilerGym warm-pilot ${phase} failed: ${errorMessage(cause)}`, { cause });
		this.name = "CompilerGymWarmPilotPhaseError";
	}
}

class StrictMonotonicClock {
	private previous: bigint | undefined;

	constructor(private readonly clock: CompilerGymWarmPilotClock) {}

	mark(label: string): bigint {
		const observed = this.clock.nowNs();
		if (typeof observed !== "bigint" || observed < 0n) {
			throw new Error(`${label} monotonic time must be a non-negative bigint`);
		}
		if (this.previous !== undefined && observed <= this.previous) {
			throw new Error(`${label} monotonic time did not strictly increase`);
		}
		this.previous = observed;
		return observed;
	}
}

class InstrumentedCompilerGymWarmTransport implements CompilerGymWarmTransport {
	readonly marks: CompilerGymWarmPilotTransportMarks[] = [];

	constructor(
		private readonly delegate: CompilerGymWarmTransport,
		private readonly clock: StrictMonotonicClock,
	) {}

	get allocationAttempted(): boolean {
		return this.marks.length > 0;
	}

	get allocationAcquired(): boolean {
		return this.marks.some((marks) => marks.preparedNs !== undefined);
	}

	async prepareEvaluation(
		input: CompilerGymWarmEvaluationInput,
		signal: AbortSignal,
	): Promise<CompilerGymWarmPreparedEvaluation> {
		if (this.marks.length >= 4) throw new Error("Warm pilot permits at most four prepared requests per block");
		const marks: CompilerGymWarmPilotTransportMarks = {
			prepareStartedNs: this.clock.mark("transport prepare start"),
		};
		this.marks.push(marks);
		const prepared = await this.delegate.prepareEvaluation(input, signal);
		marks.preparedNs = this.clock.mark("transport prepared");
		return prepared;
	}

	async publishAndWait(
		prepared: CompilerGymWarmPreparedEvaluation,
		signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult> {
		const marks = this.marks.at(-1);
		if (!marks?.preparedNs || marks.publishStartedNs !== undefined) {
			throw new Error("Warm pilot publish does not match one prepared request");
		}
		marks.publishStartedNs = this.clock.mark("transport publish start");
		const result = await this.delegate.publishAndWait(prepared, signal);
		marks.resultsReceivedNs = this.clock.mark("transport results received");
		return result;
	}

	resumeEvaluation(
		_input: CompilerGymWarmEvaluationInput,
		_handle: string,
		_signal: AbortSignal,
	): Promise<CompilerGymWarmEvaluationResult> {
		return Promise.reject(new Error("A fresh warm-pilot block cannot resume a prior request"));
	}

	closeAndVerify(): Promise<CompilerGymWarmCleanupVerification | undefined> {
		return this.delegate.closeAndVerify();
	}
}

class SignalBoundCompilerGymWarmAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	constructor(
		private readonly delegate: CompilerGymWarmPilotAdapter,
		private readonly blockSignal: AbortSignal,
	) {}

	evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		return this.withLinkedSignal(context, (linked) => this.delegate.evaluate(job, linked));
	}

	resume(job: EvaluationJob, externalJobId: string, context: EvaluationContext): Promise<EvaluationOutcome> {
		if (!this.delegate.resume) return Promise.reject(new Error("Warm-pilot adapter cannot resume"));
		return this.withLinkedSignal(
			context,
			(linked) => this.delegate.resume?.(job, externalJobId, linked) as Promise<EvaluationOutcome>,
		);
	}

	private async withLinkedSignal(
		context: EvaluationContext,
		operation: (context: EvaluationContext) => Promise<EvaluationOutcome>,
	): Promise<EvaluationOutcome> {
		const linked = linkedAbortSignal([context.signal, this.blockSignal]);
		try {
			return await operation({ ...context, signal: linked.signal });
		} finally {
			linked.dispose();
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function linkedAbortSignal(signals: readonly AbortSignal[]): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		const listener = (): void => controller.abort(signal.reason);
		signal.addEventListener("abort", listener, { once: true });
		listeners.push({ signal, listener });
	}
	return {
		signal: controller.signal,
		dispose() {
			for (const item of listeners) item.signal.removeEventListener("abort", item.listener);
		},
	};
}

function abortedError(signal: AbortSignal): CompilerGymWarmPilotAbortError {
	const reason = signal.reason;
	if (reason instanceof CompilerGymWarmPilotAbortError) return reason;
	return new CompilerGymWarmPilotAbortError("external", { cause: reason });
}

function phaseError(phase: string, error: unknown): CompilerGymWarmPilotPhaseError {
	return error instanceof CompilerGymWarmPilotPhaseError ? error : new CompilerGymWarmPilotPhaseError(phase, error);
}

function terminalOutcome(job: JobView, signal: AbortSignal): CompilerGymWarmPilotOutcome {
	if (signal.aborted) return "aborted";
	return job.state.status === "succeeded" ? "succeeded" : "failed";
}

function validateTerminalJob(job: JobView): void {
	if (job.proposal.requireFreshMeasurement !== true)
		throw new Error("Warm-pilot proposal did not require a fresh measurement");
	if (!job.measurement) throw new Error("Warm-pilot evaluation has no durable measurement");
	if (job.measurement.reuse !== undefined) throw new Error("Warm-pilot evaluation reused an earlier measurement");
	if (job.measurement.manifestDigest !== job.proposal.manifestDigest) {
		throw new Error("Warm-pilot measurement does not bind the proposal manifest");
	}
}

function terminalFailure(job: JobView): Error {
	const errors = job.measurement?.tasks.flatMap((task) => task.verifier.errors).filter(Boolean) ?? [];
	const suffix = errors.length === 0 ? "" : `: ${errors.join("; ")}`;
	return new Error(`Warm-pilot evaluation ended ${job.state.status}${suffix}`);
}

async function assertFreshLedger(path: string): Promise<void> {
	try {
		const contents = await readFile(path, "utf8");
		if (contents.length !== 0) throw new Error(`Warm-pilot ledger must be new or empty: ${path}`);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
}

function defaultClock(): CompilerGymWarmPilotClock {
	return { nowNs: () => process.hrtime.bigint() };
}

function defaultAdapter(transport: CompilerGymWarmTransport): CompilerGymWarmPilotAdapter {
	return new FarmShareCompilerGymAdapter(undefined, { warmTransport: transport });
}

function validCleanup(
	verification: CompilerGymWarmCleanupVerification | undefined,
	allocationAttempted: boolean,
	allocationAcquired: boolean,
): CompilerGymWarmCleanupVerification | null {
	if (!allocationAttempted) {
		if (verification !== undefined)
			throw new Error("Cleanup returned scheduler evidence before any allocation attempt");
		return null;
	}
	if (!verification) throw new Error("Cleanup did not return verified scheduler absence after an allocation attempt");
	if (verification.schedulerAbsent !== true) throw new Error("Cleanup did not verify scheduler absence");
	if (!/^[0-9a-f]{64}$/.test(verification.poolDigest)) {
		throw new Error("Cleanup verification identity is invalid");
	}
	if (verification.mode === "acquisition") {
		if (allocationAcquired) throw new Error("Acquisition-only cleanup proof followed a completed pool acquisition");
		return verification;
	}
	if (!allocationAcquired) throw new Error("Scheduler close proof exists without a completed pool acquisition");
	if (!/^[1-9][0-9]*$/.test(verification.slurmId)) throw new Error("Cleanup verification SLURM ID is invalid");
	return verification;
}

function addError(errors: unknown[], error: unknown, phase: string): void {
	errors.push(phaseError(phase, error));
}

function throwErrors(errors: readonly unknown[]): never {
	if (errors.length === 1) throw errors[0];
	throw new AggregateError(errors, "CompilerGym warm-pilot block failed in multiple phases");
}

function buildTrialRecords(
	block: string,
	arm: string,
	candidates: readonly { candidateSha256: string; position: number }[],
	jobs: readonly JobView[],
	timing: CompilerGymWarmPilotTimingSnapshot,
	recordEvidence: CompilerGymWarmPilotRecordEvidence,
): CompilerGymWarmPilotTrialRecord[] {
	return jobs.map((job, position) => {
		const candidate = candidates[position];
		const candidateTiming = timing.candidates[position];
		if (!candidate || !candidateTiming || !job.measurement) {
			throw new Error(`Cannot materialize warm-pilot trial ${position}`);
		}
		return {
			block,
			arm,
			position,
			candidateDigest: candidate.candidateSha256,
			jobId: job.proposal.jobId,
			manifestDigest: job.proposal.manifestDigest,
			firstWarmRequest: position === 0,
			candidateWall: candidateTiming.candidateWall,
			poolAcquire: position === 0 ? recordEvidence.acquisition : null,
			evaluationExcludingAcquireNs: candidateTiming.evaluationExcludingAcquireNs,
			tasks: job.measurement.tasks.map((task) => {
				const evaluatorRuntimeMs = task.metrics.evaluatorRuntimeMs;
				const evaluatorReportedTotalNs =
					evaluatorRuntimeMs === undefined
						? null
						: Number.isFinite(evaluatorRuntimeMs) && evaluatorRuntimeMs >= 0
							? BigInt(Math.round(evaluatorRuntimeMs * 1_000_000)).toString(10)
							: null;
				return {
					benchmarkId: task.benchmarkId,
					status: task.status,
					verifierPassed: task.verifier.passed,
					irInstructionCount: task.metrics.IrInstructionCount ?? null,
					objectTextSizeBytes: task.metrics.ObjectTextSizeBytes ?? null,
					evaluatorReportedTotalNs,
					stdoutRef: job.measurement?.stdout ?? null,
					stderrRef: job.measurement?.stderr ?? null,
					slurmJobId: recordEvidence.cleanup.slurmId,
				};
			}),
		};
	});
}

function hostInterval(startedNs: string, finishedNs: string): CompilerGymWarmPilotTrialRecord["candidateWall"] {
	const durationNs = BigInt(finishedNs) - BigInt(startedNs);
	if (durationNs <= 0n) throw new Error("Host interval must strictly increase");
	return {
		clockId: "host-monotonic-v1",
		source: "process.hrtime.bigint",
		startedNs,
		finishedNs,
		durationNs: durationNs.toString(10),
	};
}

function buildBlockRecord(
	block: string,
	arm: string,
	timing: CompilerGymWarmPilotTimingSnapshot,
	recordEvidence: CompilerGymWarmPilotRecordEvidence,
): CompilerGymWarmPilotBlockRecord {
	return {
		block,
		arm,
		poolDigest: recordEvidence.cleanup.poolDigest,
		slurmId: recordEvidence.cleanup.slurmId,
		serviceSpan: hostInterval(timing.timepointsNs.submitStarted, timing.timepointsNs.evaluationTerminal),
		closeCall: hostInterval(timing.timepointsNs.cleanupStarted, timing.timepointsNs.cleanupVerified),
		blockOperational: hostInterval(timing.timepointsNs.submitStarted, recordEvidence.schedulerAbsentAtHostNs),
		schedulerAbsentAtHostNs: recordEvidence.schedulerAbsentAtHostNs,
		cleanup: recordEvidence.cleanup,
		accounting: recordEvidence.accounting,
	};
}

export function createCompilerGymWarmPilotProcessSignalScope(
	target: CompilerGymWarmPilotProcessSignalTarget = process,
): CompilerGymWarmPilotSignalScope {
	const controller = new AbortController();
	let received: "SIGINT" | "SIGTERM" | null = null;
	const onSigint = (): void => {
		if (received !== null) return;
		received = "SIGINT";
		controller.abort(new CompilerGymWarmPilotAbortError("SIGINT"));
	};
	const onSigterm = (): void => {
		if (received !== null) return;
		received = "SIGTERM";
		controller.abort(new CompilerGymWarmPilotAbortError("SIGTERM"));
	};
	target.on("SIGINT", onSigint);
	target.on("SIGTERM", onSigterm);
	let disposed = false;
	return {
		signal: controller.signal,
		receivedSignal: () => received,
		dispose() {
			if (disposed) return;
			disposed = true;
			target.off("SIGINT", onSigint);
			target.off("SIGTERM", onSigterm);
		},
	};
}

export async function runCompilerGymWarmPilotBlock(
	options: CompilerGymWarmPilotOptions,
): Promise<CompilerGymWarmPilotResult> {
	await assertFreshLedger(options.ledgerPath);
	if (!options.arm.trim() || options.arm.length > 128) throw new Error("Warm-pilot arm is invalid");
	if (!Array.isArray(options.candidates) || options.candidates.length < 1 || options.candidates.length > 4) {
		throw new Error("Warm-pilot block requires an ordered array of one through four candidates");
	}
	const candidates = options.candidates.map((candidate, position) => {
		if (!candidate.candidateId.trim() || candidate.candidateId.length > 128) {
			throw new Error(`Warm-pilot candidateId is invalid at position ${position}`);
		}
		if (
			!Array.isArray(candidate.actions) ||
			!candidate.actions.every((action: unknown) => typeof action === "string")
		) {
			throw new Error(`Warm-pilot actions must be a string array at position ${position}`);
		}
		if (candidate.actions.length > 256) {
			throw new Error(`Warm-pilot candidate may contain at most 256 actions at position ${position}`);
		}
		const content = JSON.stringify([...candidate.actions]);
		const candidateSha256 = sha256Text(content);
		if (candidateSha256 !== candidate.candidateSha256) {
			throw new Error(
				`Warm-pilot fixed candidate hash mismatch at position ${position}: expected ${candidate.candidateSha256}, received ${candidateSha256}`,
			);
		}
		return { candidateId: candidate.candidateId, candidateSha256, content, position };
	});
	if (
		!options.allowRepeatedCandidates &&
		new Set(candidates.map((candidate) => candidate.candidateSha256)).size !== candidates.length
	) {
		throw new Error("Warm-pilot candidate digests must be distinct unless allowRepeatedCandidates is true");
	}
	if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
		throw new Error("Warm-pilot candidate IDs must be distinct within a block");
	}
	const candidateManifest = candidates.map(({ candidateId, candidateSha256, position }) => ({
		candidateId,
		candidateSha256,
		position,
	}));
	const candidateSetSha256 = sha256Json(candidateManifest);

	const clock = new StrictMonotonicClock(options.clock ?? defaultClock());
	const blockStartedNs = clock.mark("block start");
	const startRecord = compilerGymWarmPilotEvidenceRecord(options.blockId, 0, "block-started", blockStartedNs, {
		arm: options.arm,
		candidateCount: candidates.length,
		candidateSetSha256,
		candidates: candidateManifest,
		maxInflight: 1,
		requireFreshMeasurement: true,
	});
	const signal = options.signal ?? new AbortController().signal;
	const evidence: CompilerGymWarmPilotEvidenceRecord[] = [];
	const errors: unknown[] = [];
	let evidenceHealthy = true;
	let transport: InstrumentedCompilerGymWarmTransport | undefined;
	let adapter: CompilerGymWarmPilotAdapter | undefined;
	let controller: ResearchController | undefined;
	let resourcesReadyNs: bigint | undefined;
	let controllerReadyNs: bigint | undefined;
	let submitStartedNs: bigint | undefined;
	let submittedNs: bigint | undefined;
	let evaluationTerminalNs: bigint | undefined;
	let cleanupStartedNs: bigint | undefined;
	let cleanupVerifiedNs: bigint | undefined;
	const terminalJobs: JobView[] = [];
	const candidateMarks: CompilerGymWarmPilotCandidateMarks[] = [];
	let outcome: CompilerGymWarmPilotOutcome | undefined;
	let cleanup: CompilerGymWarmCleanupVerification | null | undefined;
	let recordEvidence: CompilerGymWarmPilotRecordEvidence | undefined;

	const persist = async (record: CompilerGymWarmPilotEvidenceRecord, requireEnd = false): Promise<void> => {
		if (!controller) throw new Error("Cannot persist warm-pilot evidence before controller creation");
		const proposed = [...evidence, record];
		verifyCompilerGymWarmPilotEvidence(proposed, { requireEnd });
		await (options.persistEvidence?.(controller, record) ?? controller.appendRunManifest(record));
		evidence.push(record);
	};

	try {
		const rawTransport = await options.createTransport();
		transport = new InstrumentedCompilerGymWarmTransport(rawTransport, clock);
		adapter = (options.createAdapter ?? defaultAdapter)(transport);
		if (adapter.lane !== "compiler-gym") throw new Error("Warm-pilot adapter lane must be compiler-gym");
		resourcesReadyNs = clock.mark("resources ready");
		controller = await ResearchController.open({
			ledgerPath: options.ledgerPath,
			artifactDir: options.artifactDir,
			adapters: [new SignalBoundCompilerGymWarmAdapter(adapter, signal)],
			metrics: {
				"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
				kernelbench: { name: "fastAtOne", direction: "maximize" },
				nanogpt: { name: "trainSteps", direction: "minimize" },
			},
			allowedBenchmarks: {
				"compiler-gym": [...COMPILER_GYM_WARM_TASKS],
				kernelbench: [],
				nanogpt: [],
			},
			allowedTreatments: [COMPILER_GYM_WARM_PILOT_TREATMENT],
			maxInflight: { "compiler-gym": 1 },
			maxSubmissionsPerBranch: candidates.length,
			maxTaskEvaluationsPerBranch: candidates.length * COMPILER_GYM_WARM_TASKS.length,
			now: options.now,
		});
		controllerReadyNs = clock.mark("controller ready");
		if (controller.status().length !== 0)
			throw new Error("Warm-pilot controller did not open on an empty block ledger");
		await persist(startRecord);
		if (signal.aborted) throw abortedError(signal);

		for (const candidate of candidates) {
			const candidateSubmitStartedNs = clock.mark(`candidate ${candidate.position} submit start`);
			submitStartedNs ??= candidateSubmitStartedNs;
			const submitted = await controller.submit({
				branchId: options.branchId,
				lane: "compiler-gym",
				benchmarkIds: [...COMPILER_GYM_WARM_TASKS],
				budgetClass: "smoke",
				treatment: COMPILER_GYM_WARM_PILOT_TREATMENT,
				proposal: {
					hypothesis: "One trajectory-scoped allocation reduces repeated admission overhead",
					mechanism: "Reuse only a fixed two-slot allocation while retaining a fresh evaluator process per task",
					predictedOutcome: "The fixed candidate remains verifier-valid with lower allocation overhead",
					boundaryConditions: [
						"No model calls",
						"Exactly one controller job is in flight",
						"Every candidate measurement is fresh",
						`Ordered block position ${candidate.position}`,
						`Frozen candidate ${candidate.candidateId}`,
					],
					parentJobIds: terminalJobs.at(-1) ? [terminalJobs.at(-1)?.proposal.jobId as string] : [],
				},
				candidate: { format: "llvm-pass-sequence", content: candidate.content },
				requireFreshMeasurement: true,
			});
			const candidateSubmittedNs = clock.mark(`candidate ${candidate.position} submitted`);
			submittedNs ??= candidateSubmittedNs;
			if (submitted.duplicate) {
				throw new Error(`Warm-pilot candidate ${candidate.position} was unexpectedly deduplicated`);
			}
			await controller.waitForIdle();
			const candidateTerminalNs = clock.mark(`candidate ${candidate.position} terminal`);
			evaluationTerminalNs = candidateTerminalNs;
			const candidateTransportMarks = transport.marks[candidate.position];
			if (!candidateTransportMarks)
				throw new Error(`Warm-pilot transport lost candidate ${candidate.position} timing`);
			candidateMarks.push({
				position: candidate.position,
				firstWarmRequest: candidate.position === 0,
				submitStartedNs: candidateSubmitStartedNs,
				submittedNs: candidateSubmittedNs,
				evaluationTerminalNs: candidateTerminalNs,
				transport: candidateTransportMarks,
			});
			const terminalJob = controller.status([submitted.jobId])[0];
			if (!terminalJob) throw new Error(`Warm-pilot controller lost ${submitted.jobId}`);
			validateTerminalJob(terminalJob);
			terminalJobs.push(terminalJob);
			const candidateOutcome = terminalOutcome(terminalJob, signal);
			outcome = candidateOutcome;
			await persist(
				compilerGymWarmPilotEvidenceRecord(
					options.blockId,
					evidence.length,
					"evaluation-terminal",
					candidateTerminalNs,
					{
						candidateId: candidate.candidateId,
						candidatePosition: candidate.position,
						firstWarmRequest: candidate.position === 0,
						jobId: terminalJob.proposal.jobId,
						manifestDigest: terminalJob.proposal.manifestDigest,
						measurementDigest: sha256Json(terminalJob.measurement),
						outcome: candidateOutcome,
						stateStatus: terminalJob.state.status,
					},
				),
			);
			if (candidateOutcome === "aborted") throw abortedError(signal);
			if (candidateOutcome === "failed") throw terminalFailure(terminalJob);
			controller.verifyLedger();
		}
		outcome = "succeeded";
	} catch (error) {
		addError(errors, error, signal.aborted ? "abort" : "run");
	} finally {
		if (transport || adapter) {
			try {
				cleanupStartedNs = clock.mark("cleanup start");
				if (
					evidenceHealthy &&
					(evidence.at(-1)?.kind === "block-started" || evidence.at(-1)?.kind === "evaluation-terminal")
				) {
					try {
						await persist(
							compilerGymWarmPilotEvidenceRecord(
								options.blockId,
								evidence.length,
								"cleanup-started",
								cleanupStartedNs,
								{ allocationAttempted: transport?.allocationAttempted ?? false },
							),
						);
					} catch (error) {
						evidenceHealthy = false;
						addError(errors, error, "cleanup-start evidence persistence");
					}
				}
				const rawVerification = adapter ? await adapter.closeAndVerify() : await transport?.closeAndVerify();
				cleanup = validCleanup(
					rawVerification,
					transport?.allocationAttempted ?? false,
					transport?.allocationAcquired ?? false,
				);
				cleanupVerifiedNs = clock.mark("cleanup verified");
				if (cleanup && cleanup.mode !== "acquisition") {
					const recordEvidenceInput = await options.recordEvidenceProvider.collect(cleanup);
					recordEvidence = await materializeCompilerGymWarmPilotRecordEvidence(
						recordEvidenceInput,
						cleanup,
						cleanupVerifiedNs,
						options.artifactDir,
					);
				}
				if (evidenceHealthy && evidence.at(-1)?.kind === "cleanup-started") {
					try {
						await persist(
							compilerGymWarmPilotEvidenceRecord(
								options.blockId,
								evidence.length,
								"cleanup-verified",
								cleanupVerifiedNs,
								{
									allocationAttempted: transport?.allocationAttempted ?? false,
									recordEvidence: recordEvidence ?? null,
									verification: cleanup,
								},
							),
						);
					} catch (error) {
						evidenceHealthy = false;
						addError(errors, error, "cleanup evidence persistence");
					}
				}
			} catch (error) {
				addError(errors, error, "cleanup");
				if (cleanupStartedNs !== undefined && evidenceHealthy && evidence.at(-1)?.kind === "cleanup-started") {
					try {
						const cleanupFailedNs = clock.mark("cleanup failed");
						await persist(
							compilerGymWarmPilotEvidenceRecord(
								options.blockId,
								evidence.length,
								"cleanup-failed",
								cleanupFailedNs,
								{
									allocationAttempted: transport?.allocationAttempted ?? false,
									error: errorMessage(error),
								},
							),
						);
					} catch (persistenceError) {
						evidenceHealthy = false;
						addError(errors, persistenceError, "cleanup-failure evidence persistence");
					}
				}
			}
		}
	}

	let timing: CompilerGymWarmPilotTimingSnapshot | undefined;
	let trials: CompilerGymWarmPilotTrialRecord[] | undefined;
	let blockRecord: CompilerGymWarmPilotBlockRecord | undefined;
	if (
		evidenceHealthy &&
		cleanupVerifiedNs !== undefined &&
		resourcesReadyNs !== undefined &&
		controllerReadyNs !== undefined &&
		submitStartedNs !== undefined &&
		submittedNs !== undefined &&
		evaluationTerminalNs !== undefined &&
		cleanupStartedNs !== undefined &&
		terminalJobs.length > 0 &&
		evidence.filter((record) => record.kind === "evaluation-terminal").length === terminalJobs.length &&
		outcome !== undefined &&
		controller !== undefined &&
		evidence.at(-1)?.kind === "cleanup-verified" &&
		cleanup?.mode !== "acquisition" &&
		recordEvidence !== undefined
	) {
		try {
			const blockEndedNs = clock.mark("block end");
			const blockMarks: CompilerGymWarmPilotBlockMarks = {
				blockStartedNs,
				resourcesReadyNs,
				controllerReadyNs,
				submitStartedNs,
				submittedNs,
				evaluationTerminalNs,
				cleanupStartedNs,
				cleanupVerifiedNs,
				blockEndedNs,
			};
			timing = buildCompilerGymWarmPilotTiming(
				blockMarks,
				candidateMarks,
				BigInt(recordEvidence?.acquisition.durationNs ?? "0"),
			);
			if (!recordEvidence) throw new Error("Record evidence is missing after verified cleanup");
			trials = buildTrialRecords(options.blockId, options.arm, candidates, terminalJobs, timing, recordEvidence);
			blockRecord = buildBlockRecord(options.blockId, options.arm, timing, recordEvidence);
			const endRecord = compilerGymWarmPilotEvidenceRecord(
				options.blockId,
				evidence.length,
				"block-ended",
				blockEndedNs,
				{
					blockRecord,
					candidateSetSha256,
					completedJobIds: terminalJobs.map((job) => job.proposal.jobId),
					outcome,
					timing,
					timingSha256: sha256Json(timing),
					trials,
				},
			);
			await persist(endRecord, true);
			controller.verifyLedger();
		} catch (error) {
			addError(errors, error, "end-manifest persistence");
		}
	}

	if (errors.length > 0) throwErrors(errors);
	if (
		terminalJobs.length !== candidates.length ||
		outcome !== "succeeded" ||
		!cleanup ||
		cleanup.mode === "acquisition" ||
		!recordEvidence ||
		!timing ||
		!trials ||
		!blockRecord
	) {
		throw new Error("Warm-pilot block did not reach a verified successful terminal state");
	}
	return {
		blockId: options.blockId,
		arm: options.arm,
		jobs: terminalJobs.slice(),
		outcome,
		cleanup,
		recordEvidence,
		timing,
		evidence: evidence.slice(),
		trials,
		blockRecord,
	};
}

export async function runCompilerGymWarmPilotBlockWithProcessSignals(
	options: Omit<CompilerGymWarmPilotOptions, "signal"> & { signal?: AbortSignal },
	target: CompilerGymWarmPilotProcessSignalTarget = process,
): Promise<CompilerGymWarmPilotResult> {
	const processScope = createCompilerGymWarmPilotProcessSignalScope(target);
	const combined = linkedAbortSignal(
		options.signal === undefined ? [processScope.signal] : [processScope.signal, options.signal],
	);
	try {
		return await runCompilerGymWarmPilotBlock({ ...options, signal: combined.signal });
	} finally {
		combined.dispose();
		processScope.dispose();
	}
}

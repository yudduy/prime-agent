import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "./artifact-store.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import { prepareReducedCpuStudyOutput, verifyReducedCpuStudyLedgerStrict } from "./reduced-cpu-study-controller.js";
import {
	parseReducedCpuCalibration,
	REDUCED_CPU_ALL_TASKS,
	REDUCED_CPU_CALIBRATION_BRANCH_ID,
	REDUCED_CPU_CALIBRATION_TREATMENT,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	type ReducedCpuCalibration,
	type ReducedCpuCalibrationEnvelope,
} from "./reduced-cpu-study-protocol.js";
import type { EvaluationAdapter, JobView, SubmitResult } from "./types.js";

export const REDUCED_CPU_CALIBRATION_DEADLINE_MS = 420_000 as const;

export interface RunReducedCpuCalibrationOptions {
	outputDir: string;
	adapter?: EvaluationAdapter;
}

export interface ReducedCpuCalibrationAttemptIdentity {
	type: "reduced_cpu_calibration_attempt_identity";
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	outputDir: string;
	branchId: typeof REDUCED_CPU_CALIBRATION_BRANCH_ID;
	tasks: readonly string[];
	maxSubmissions: 1;
	maxTaskEvaluations: number;
	retryPolicy: "never-retry-or-replace";
}

export interface ReducedCpuCalibrationTerminalResult {
	schemaVersion: 1;
	type: "reduced_cpu_study_calibration_terminal";
	protocolVersion: typeof REDUCED_CPU_STUDY_PROTOCOL_VERSION;
	outcome: "success" | "apparatus-invalid";
	attemptId: string;
	attemptIdentitySha256: string;
	startedAt: string;
	finishedAt: string;
	deadlineMs: typeof REDUCED_CPU_CALIBRATION_DEADLINE_MS;
	submitted: SubmitResult | null;
	externalJobIdentities: Array<{ jobId: string; externalJobId: string | null; status: string }>;
	knownJobs: JobView[];
	knownLedgerState: {
		path: string;
		exists: boolean;
		byteLength: number | null;
		sha256: string | null;
		eventCount: number | null;
		strictVerificationPassed: boolean;
		error: string | null;
	};
	ledgerTerminalManifestError: string | null;
	calibrationPath: string | null;
	verifiedArtifactRefs: number;
	error: { name: string; message: string; stack: string | null } | null;
}

export interface RunReducedCpuCalibrationResult {
	envelope: ReducedCpuCalibrationEnvelope;
	calibration: ReducedCpuCalibration;
	resultPath: string;
	terminalResultPath: string;
	verifiedArtifactRefs: number;
	terminal: ReducedCpuCalibrationTerminalResult;
}

interface CalibrationSuccess {
	envelope: ReducedCpuCalibrationEnvelope;
	calibration: ReducedCpuCalibration;
	calibrationPath: string;
	verifiedArtifactRefs: number;
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function serializedError(error: unknown): ReducedCpuCalibrationTerminalResult["error"] {
	if (error === null || error === undefined) return null;
	if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack ?? null };
	return { name: "NonErrorThrown", message: String(error), stack: null };
}

async function createFreshOutputNamespace(outputDir: string): Promise<void> {
	await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 });
	try {
		await mkdir(outputDir, { mode: 0o700 });
	} catch (error) {
		if (isAlreadyExists(error)) {
			throw new Error(
				`Calibration requires a caller-provided fresh output namespace; path already exists: ${outputDir}`,
			);
		}
		throw error;
	}
	await chmod(outputDir, 0o700);
	const entries = await readdir(outputDir);
	if (entries.length !== 0) {
		throw new Error(`Fresh calibration namespace was contaminated before attempt lock: ${entries.sort().join(",")}`);
	}
}

async function writeDurablePrivateJson(path: string, value: unknown): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(path, 0o600);
}

async function assertExpectedPreControllerContents(outputDir: string): Promise<void> {
	const expected = ["attempt.lock", "start-intent.json"];
	const actual = (await readdir(outputDir)).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Calibration namespace contamination before controller open: ${actual.join(",")}`);
	}
	for (const name of expected) {
		const metadata = await lstat(join(outputDir, name));
		if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
			throw new Error(`Calibration attempt file is not a private regular file: ${name}`);
		}
	}
}

async function openCalibrationController(outputDir: string, adapter?: EvaluationAdapter): Promise<ResearchController> {
	const paths = await prepareReducedCpuStudyOutput(outputDir);
	const selectedAdapter = adapter ?? new FarmShareCompilerGymAdapter();
	if (selectedAdapter.lane !== "compiler-gym") throw new Error("Calibration requires a CompilerGym adapter");
	const controller = await ResearchController.open({
		ledgerPath: paths.ledgerPath,
		artifactDir: paths.artifactDir,
		adapters: [selectedAdapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: { "compiler-gym": REDUCED_CPU_ALL_TASKS, kernelbench: [], nanogpt: [] },
		allowedTreatments: [REDUCED_CPU_CALIBRATION_TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: 1,
		maxTaskEvaluationsPerBranch: REDUCED_CPU_ALL_TASKS.length,
	});
	await verifyReducedCpuStudyLedgerStrict(controller, paths.outputDir);
	return controller;
}

export async function waitForReducedCpuCalibrationIdleWithDeadline(
	waitForIdle: () => Promise<void>,
	deadlineMs: number,
): Promise<void> {
	if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error("Calibration deadline must be positive");
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			waitForIdle(),
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() =>
						reject(
							new Error(
								`Calibration evaluator deadline exceeded after ${deadlineMs}ms; attempt is terminal and must not be retried`,
							),
						),
					deadlineMs,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function inspectKnownLedgerState(
	outputDir: string,
): Promise<ReducedCpuCalibrationTerminalResult["knownLedgerState"]> {
	const path = join(outputDir, "evidence.jsonl");
	try {
		const contents = await readFile(path, "utf8");
		try {
			const events = verifyLedgerContentsStrict(contents);
			return {
				path,
				exists: true,
				byteLength: Buffer.byteLength(contents),
				sha256: sha256Text(contents),
				eventCount: events.length,
				strictVerificationPassed: true,
				error: null,
			};
		} catch (error) {
			return {
				path,
				exists: true,
				byteLength: Buffer.byteLength(contents),
				sha256: sha256Text(contents),
				eventCount: null,
				strictVerificationPassed: false,
				error: errorMessage(error),
			};
		}
	} catch (error) {
		if (!isMissing(error)) throw error;
		return {
			path,
			exists: false,
			byteLength: null,
			sha256: null,
			eventCount: null,
			strictVerificationPassed: false,
			error: "ledger does not exist",
		};
	}
}

function knownJobs(controller: ResearchController | null): JobView[] {
	if (!controller) return [];
	try {
		return controller.statusForBranch(REDUCED_CPU_CALIBRATION_BRANCH_ID);
	} catch {
		return [];
	}
}

async function verifyCalibrationArtifacts(outputDir: string, job: JobView): Promise<number> {
	const store = new ArtifactStore(join(outputDir, "artifacts"));
	let verifiedArtifactRefs = 0;
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
	return verifiedArtifactRefs;
}

export async function runReducedCpuCalibration(
	options: RunReducedCpuCalibrationOptions,
): Promise<RunReducedCpuCalibrationResult> {
	const outputDir = resolve(options.outputDir);
	await createFreshOutputNamespace(outputDir);
	const attemptIdentity: ReducedCpuCalibrationAttemptIdentity = {
		type: "reduced_cpu_calibration_attempt_identity",
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		outputDir,
		branchId: REDUCED_CPU_CALIBRATION_BRANCH_ID,
		tasks: [...REDUCED_CPU_ALL_TASKS],
		maxSubmissions: 1,
		maxTaskEvaluations: REDUCED_CPU_ALL_TASKS.length,
		retryPolicy: "never-retry-or-replace",
	};
	const attemptId = randomUUID();
	const attemptIdentitySha256 = sha256Json(attemptIdentity);
	const startedAt = new Date().toISOString();
	const attemptLock = {
		schemaVersion: 1,
		type: "reduced_cpu_calibration_attempt_lock",
		attemptId,
		attemptIdentitySha256,
		attemptIdentity,
		startedAt,
	};
	const startIntent = {
		schemaVersion: 1,
		type: "reduced_cpu_calibration_start_intent",
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		attemptId,
		attemptIdentitySha256,
		startedAt,
		deadlineMs: REDUCED_CPU_CALIBRATION_DEADLINE_MS,
		retryPolicy: "never-retry-or-replace",
	};
	let controller: ResearchController | null = null;
	let submitted: SubmitResult | null = null;
	let success: CalibrationSuccess | null = null;
	let failure: unknown = null;
	let terminal: ReducedCpuCalibrationTerminalResult | null = null;
	const terminalResultPath = join(outputDir, "result.json");
	try {
		await writeDurablePrivateJson(join(outputDir, "attempt.lock"), attemptLock);
		await writeDurablePrivateJson(join(outputDir, "start-intent.json"), startIntent);
		await assertExpectedPreControllerContents(outputDir);
		controller = await openCalibrationController(outputDir, options.adapter);
		if (controller.statusForBranch(REDUCED_CPU_CALIBRATION_BRANCH_ID).length !== 0) {
			throw new Error("Fresh calibration namespace unexpectedly contains a submission");
		}
		await controller.appendRunManifest(startIntent);
		await verifyReducedCpuStudyLedgerStrict(controller, outputDir);
		submitted = await controller.submit({
			branchId: REDUCED_CPU_CALIBRATION_BRANCH_ID,
			lane: "compiler-gym",
			benchmarkIds: [...REDUCED_CPU_ALL_TASKS],
			budgetClass: "smoke",
			treatment: REDUCED_CPU_CALIBRATION_TREATMENT,
			proposal: {
				hypothesis: "The empty LLVM pass sequence establishes the four-task normalization anchor",
				mechanism: "Measure raw IR and object size without optimization actions",
				predictedOutcome: "One accepted current-epoch record for every study task",
				boundaryConditions: [
					"exact four-task panel",
					"empty pass sequence",
					"fresh measurement only",
					"no retry or reuse",
				],
				parentJobIds: [],
			},
			candidate: { format: "llvm-pass-sequence", content: "[]" },
			requireFreshMeasurement: true,
		});
		if (submitted.duplicate) throw new Error("Fresh calibration unexpectedly deduplicated");
		await waitForReducedCpuCalibrationIdleWithDeadline(
			() => controller?.waitForIdle() ?? Promise.reject(new Error("Calibration controller disappeared")),
			REDUCED_CPU_CALIBRATION_DEADLINE_MS,
		);
		await verifyReducedCpuStudyLedgerStrict(controller, outputDir);
		const jobs = controller.statusForBranch(REDUCED_CPU_CALIBRATION_BRANCH_ID, [submitted.jobId]);
		if (jobs.length !== 1) throw new Error("Calibration job is missing");
		const envelope: ReducedCpuCalibrationEnvelope = {
			schemaVersion: 1,
			type: "reduced_cpu_study_calibration",
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			branchId: REDUCED_CPU_CALIBRATION_BRANCH_ID,
			submitted,
			job: jobs[0],
		};
		const calibration = parseReducedCpuCalibration(envelope);
		const verifiedArtifactRefs = await verifyCalibrationArtifacts(outputDir, jobs[0]);
		const calibrationPath = join(outputDir, "calibration.json");
		await writeDurablePrivateJson(calibrationPath, envelope);
		success = { envelope, calibration, calibrationPath, verifiedArtifactRefs };
	} catch (error) {
		failure = error;
	} finally {
		const jobsBeforeTerminalManifest = knownJobs(controller);
		let ledgerTerminalManifestError: string | null = null;
		if (controller) {
			try {
				await controller.appendRunManifest({
					schemaVersion: 1,
					type: "reduced_cpu_calibration_terminal_intent",
					protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
					attemptId,
					attemptIdentitySha256,
					outcome: success && failure === null ? "success" : "apparatus-invalid",
					externalJobIdentities: jobsBeforeTerminalManifest.map((job) => ({
						jobId: job.proposal.jobId,
						externalJobId: job.state.externalJobId,
						status: job.state.status,
					})),
					finishedAt: new Date().toISOString(),
				});
				await verifyReducedCpuStudyLedgerStrict(controller, outputDir);
			} catch (error) {
				ledgerTerminalManifestError = errorMessage(error);
				failure ??= new Error(`Calibration terminal ledger manifest failed: ${ledgerTerminalManifestError}`);
			}
		}
		const jobsAtTerminal = knownJobs(controller);
		let knownLedgerState: ReducedCpuCalibrationTerminalResult["knownLedgerState"];
		try {
			knownLedgerState = await inspectKnownLedgerState(outputDir);
		} catch (error) {
			knownLedgerState = {
				path: join(outputDir, "evidence.jsonl"),
				exists: false,
				byteLength: null,
				sha256: null,
				eventCount: null,
				strictVerificationPassed: false,
				error: errorMessage(error),
			};
		}
		if (!knownLedgerState.strictVerificationPassed) {
			failure ??= new Error(`Calibration terminal ledger inspection failed: ${knownLedgerState.error ?? "unknown"}`);
		}
		terminal = {
			schemaVersion: 1,
			type: "reduced_cpu_study_calibration_terminal",
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			outcome: success && failure === null ? "success" : "apparatus-invalid",
			attemptId,
			attemptIdentitySha256,
			startedAt,
			finishedAt: new Date().toISOString(),
			deadlineMs: REDUCED_CPU_CALIBRATION_DEADLINE_MS,
			submitted,
			externalJobIdentities: jobsAtTerminal.map((job) => ({
				jobId: job.proposal.jobId,
				externalJobId: job.state.externalJobId,
				status: job.state.status,
			})),
			knownJobs: jobsAtTerminal,
			knownLedgerState,
			ledgerTerminalManifestError,
			calibrationPath: success?.calibrationPath ?? null,
			verifiedArtifactRefs: success?.verifiedArtifactRefs ?? 0,
			error: serializedError(failure),
		};
		try {
			await writeDurablePrivateJson(terminalResultPath, terminal);
		} catch (terminalError) {
			failure = failure
				? new AggregateError(
						[failure, terminalError],
						"Calibration failed and terminal evidence could not be written",
					)
				: terminalError;
		}
	}
	if (failure) throw failure;
	if (!success || !terminal) throw new Error("Calibration ended without success or terminal evidence");
	return {
		envelope: success.envelope,
		calibration: success.calibration,
		resultPath: success.calibrationPath,
		terminalResultPath,
		verifiedArtifactRefs: success.verifiedArtifactRefs,
		terminal,
	};
}

function parseOutputDir(argv: readonly string[]): string {
	if (argv.length === 2 && argv[0] === "--output-dir" && argv[1]) return resolve(argv[1]);
	throw new Error("Usage: reduced-cpu-study-calibration --output-dir <fresh-nonexistent-path>");
}

async function main(): Promise<void> {
	const outputDir = parseOutputDir(process.argv.slice(2));
	const result = await runReducedCpuCalibration({ outputDir });
	console.log(
		JSON.stringify({
			type: "reduced_cpu_study_calibration_complete",
			protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
			resultPath: result.resultPath,
			terminalResultPath: result.terminalResultPath,
			calibration: result.calibration,
			verifiedArtifactRefs: result.verifiedArtifactRefs,
		}),
	);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === resolve(fileURLToPath(import.meta.url))) await main();

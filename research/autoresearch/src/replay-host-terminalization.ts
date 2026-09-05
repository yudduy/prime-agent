import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "./artifact-store.js";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256 } from "./compiler-gym-adapter.js";
import { assessHostOwnedTerminalization, HOST_OWNED_TERMINALIZATION_POLICY } from "./host-owned-terminalization.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import {
	parseStockCpuCalibration,
	type StockCpuChampionSelection,
	type StockCpuCompletionGate,
} from "./stock-cpu-protocol.js";
import type { ArtifactRef, JobView } from "./types.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_SCREEN_DIR = resolve(REPOSITORY_ROOT, ".autoresearch/stock-interface-pair-screen");
const DEFAULT_CALIBRATION_PATH = resolve(
	REPOSITORY_ROOT,
	".autoresearch/cpu-calibration/2026-08-28-v2-stock/result.json",
);
const TYPED_TOOL_NAME = "autoresearch_evaluate";

interface HistoricalTrace {
	callCount: number;
	duplicateCount: number;
}

interface HistoricalArmResult {
	ok: boolean;
	failure: string | null;
	finishedAt: string;
	sessionFile: string;
	jobs: JobView[];
	completionGate: StockCpuCompletionGate;
	championSelection: StockCpuChampionSelection;
	championReportLine: string | null;
	sourceIntegrityPassed: boolean;
	repositoryIntegrityPassed?: boolean;
	primeCoreIntegrityPassed?: boolean;
	trace?: HistoricalTrace;
	submittedJobIds?: string[];
}

interface SummaryArm {
	resultSha256: string;
	ledgerSha256: string;
	terminalEventHash: string;
	sessionSha256: string;
}

interface SummaryBlock {
	id: string;
	stock: SummaryArm;
	typed: SummaryArm | "not-run";
}

interface ScreenSummary {
	frozenInputs: {
		calibrationSha256: string;
		evaluatorSha256: string;
		verifierEpoch: string;
	};
	blocks: SummaryBlock[];
}

interface ScreenSummaryCorrection {
	corrects: { path: string; sha256: string };
	corrections: Array<{ jsonPointer: string; recordedValue: string; correctValue: string }>;
}

interface ArmDescriptor {
	blockId: string;
	arm: "stock" | "typed";
}

interface SessionToolCall {
	id: string;
	name: string;
	code: string | null;
	timestampMs: number;
}

interface SessionAnalysis {
	evaluatorDispatches: number;
	postTerminalEvaluatorDispatches: number;
	providerDispatchesAfterTerminalMeasurement: number;
	blockedProviderRequestsAfterTerminalMeasurement: number;
	readOnlyDeviationEvents: string[];
	forbiddenBoundaryEvents: string[];
	assistantReportText: string | null;
}

const ARM_DESCRIPTORS: readonly ArmDescriptor[] = [
	{ blockId: "2026-08-28-block-v1", arm: "stock" },
	{ blockId: "2026-08-28-block-v1", arm: "typed" },
	{ blockId: "2026-08-28-block-v2", arm: "stock" },
	{ blockId: "2026-08-28-block-v3", arm: "typed" },
	{ blockId: "2026-08-28-block-v3", arm: "stock" },
	{ blockId: "2026-08-28-block-v4", arm: "typed" },
	{ blockId: "2026-08-28-block-v4", arm: "stock" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson<T>(path: string): Promise<{ value: T; contents: string; sha256: string }> {
	const contents = await readFile(path, "utf8");
	return { value: JSON.parse(contents) as T, contents, sha256: sha256Text(contents) };
}

function messageRecord(record: unknown): Record<string, unknown> | null {
	if (!isRecord(record) || record.type !== "message" || !isRecord(record.message)) return null;
	return record.message;
}

function contentItems(message: Record<string, unknown>): readonly unknown[] {
	return Array.isArray(message.content) ? message.content : [];
}

function textContent(message: Record<string, unknown>): string {
	return contentItems(message)
		.flatMap((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []))
		.join("\n")
		.trim();
}

function toolCalls(records: readonly unknown[]): SessionToolCall[] {
	const calls: SessionToolCall[] = [];
	for (const record of records) {
		if (!isRecord(record) || typeof record.timestamp !== "string") continue;
		const message = messageRecord(record);
		if (!message || message.role !== "assistant") continue;
		for (const item of contentItems(message)) {
			if (!isRecord(item) || item.type !== "toolCall") continue;
			if (typeof item.id !== "string" || typeof item.name !== "string") continue;
			const argumentsRecord = isRecord(item.arguments) ? item.arguments : null;
			calls.push({
				id: item.id,
				name: item.name,
				code: argumentsRecord && typeof argumentsRecord.code === "string" ? argumentsRecord.code : null,
				timestampMs: Date.parse(record.timestamp),
			});
		}
	}
	return calls;
}

function toolResultText(records: readonly unknown[]): Map<string, string> {
	const results = new Map<string, string>();
	for (const record of records) {
		const message = messageRecord(record);
		if (!message || message.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
		results.set(message.toolCallId, textContent(message));
	}
	return results;
}

function isWorkspaceReadOnlyInspection(code: string | null): boolean {
	if (code === null) return false;
	const normalized = code
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n");
	return normalized === "import os, json, subprocess\nos.getcwd(), os.listdir('.')";
}

function analyzeSession(contents: string, jobs: readonly JobView[]): SessionAnalysis {
	const records = contents
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as unknown);
	const terminalMeasurementMs = Math.max(
		...jobs.map((job) => {
			assert.ok(job.measurement, `Missing measurement for ${job.proposal.jobId}`);
			return Date.parse(job.measurement.measuredAt);
		}),
	);
	const results = toolResultText(records);
	let evaluatorDispatches = 0;
	let postTerminalEvaluatorDispatches = 0;
	const readOnlyDeviationEvents: string[] = [];
	const forbiddenBoundaryEvents: string[] = [];
	for (const call of toolCalls(records)) {
		const result = results.get(call.id) ?? "";
		const isTypedEvaluation = call.name === TYPED_TOOL_NAME;
		const isStockEvaluation = call.name === "ipython" && result.includes("stock_prime_compiler_gym_evaluation");
		if (isTypedEvaluation || isStockEvaluation) {
			evaluatorDispatches += 1;
			if (call.timestampMs > terminalMeasurementMs) postTerminalEvaluatorDispatches += 1;
			continue;
		}
		if (call.name === "ipython" && isWorkspaceReadOnlyInspection(call.code)) {
			readOnlyDeviationEvents.push("read-only inspection of the empty arm workspace");
			continue;
		}
		forbiddenBoundaryEvents.push(`${call.name} call ${call.id}`);
	}

	let providerDispatchesAfterTerminalMeasurement = 0;
	let blockedProviderRequestsAfterTerminalMeasurement = 0;
	let assistantReportText: string | null = null;
	for (const record of records) {
		if (!isRecord(record) || typeof record.timestamp !== "string") continue;
		if (Date.parse(record.timestamp) <= terminalMeasurementMs) continue;
		const message = messageRecord(record);
		if (!message || message.role !== "assistant") continue;
		if (typeof message.responseId === "string") {
			providerDispatchesAfterTerminalMeasurement += 1;
			const text = textContent(message);
			if (text.length > 0) assistantReportText = text;
		} else if (message.stopReason === "aborted") {
			blockedProviderRequestsAfterTerminalMeasurement += 1;
		}
	}

	return {
		evaluatorDispatches,
		postTerminalEvaluatorDispatches,
		providerDispatchesAfterTerminalMeasurement,
		blockedProviderRequestsAfterTerminalMeasurement,
		readOnlyDeviationEvents,
		forbiddenBoundaryEvents,
		assistantReportText,
	};
}

function expectedSummaryArm(summary: ScreenSummary, descriptor: ArmDescriptor): SummaryArm {
	const block = summary.blocks.find((candidate) => candidate.id === descriptor.blockId);
	assert.ok(block, `Missing summary block ${descriptor.blockId}`);
	const arm = block[descriptor.arm];
	assert.notEqual(arm, "not-run", `${descriptor.blockId}/${descriptor.arm} was not run`);
	return arm as SummaryArm;
}

function correctedExpectedSessionSha256(
	expected: SummaryArm,
	descriptor: ArmDescriptor,
	correction: ScreenSummaryCorrection,
): string {
	if (descriptor.blockId !== "2026-08-28-block-v2" || descriptor.arm !== "stock") {
		return expected.sessionSha256;
	}
	const entry = correction.corrections.find((candidate) => candidate.jsonPointer === "/blocks/1/stock/sessionSha256");
	assert.ok(entry, "Missing V2 session-hash correction");
	assert.equal(entry.recordedValue, expected.sessionSha256);
	return entry.correctValue;
}

function artifactRefs(jobs: readonly JobView[]): ArtifactRef[] {
	return jobs.flatMap((job) => {
		const refs = [job.proposal.candidate];
		if (job.measurement?.stdout) refs.push(job.measurement.stdout);
		if (job.measurement?.stderr) refs.push(job.measurement.stderr);
		return refs;
	});
}

async function verifyArtifacts(armDir: string, jobs: readonly JobView[]): Promise<number> {
	const refs = artifactRefs(jobs);
	const store = new ArtifactStore(join(armDir, "evaluation", "artifacts"));
	for (const ref of refs) await store.readString(ref);
	return refs.length;
}

function vectorFor(selection: StockCpuChampionSelection): [number, number] | null {
	const selected = selection.eligibleCandidates.find((candidate) => candidate.jobId === selection.selectedJobId);
	if (!selected) return null;
	const values = Object.values(selected.irInstructionCounts);
	assert.equal(values.length, 2);
	return [values[0], values[1]];
}

function markdownReport(report: {
	policy: typeof HOST_OWNED_TERMINALIZATION_POLICY;
	arms: Array<{
		blockId: string;
		arm: string;
		historicalOperationalValid: boolean;
		measurementQualified: boolean;
		terminalizationRuntimeConformant: boolean;
		hostSelectedJobId: string | null;
		vector: [number, number] | null;
		assistantReportStatus: string;
		deviations: string[];
	}>;
	aggregate: Record<string, number>;
}): string {
	const rows = report.arms.map((arm) => {
		const vector = arm.vector ? `${arm.vector[0]} / ${arm.vector[1]}` : "none";
		return `| ${arm.blockId} | ${arm.arm} | ${arm.historicalOperationalValid ? "valid" : "invalid"} | ${arm.measurementQualified ? "yes" : "no"} | ${arm.terminalizationRuntimeConformant ? "yes" : "no"} | ${vector} | ${arm.assistantReportStatus} |`;
	});
	return [
		"# Host-owned terminalization replay v1",
		"",
		"This is a derived, read-only sensitivity replay. Historical result files, sessions, ledgers, and artifacts were not rewritten.",
		"",
		"| Block | Arm | Historical operational status | Measurement-qualified | Zero post-terminal provider dispatch | Host champion IR (blowfish / bzip2) | Assistant report |",
		"|---|---|---|---:|---:|---:|---|",
		...rows,
		"",
		`All ${report.aggregate.arms} arms preserve their recorded completion and champion selections. ${report.aggregate.measurementQualifiedArms} are measurement-qualified; the historically invalid block remains historically invalid but its four verified measurements qualify under the sensitivity policy.`,
		"",
		`Verified ${report.aggregate.ledgerEvents} ledger events, ${report.aggregate.artifacts} content-addressed artifacts, ${report.aggregate.evaluatorDispatches} evaluator dispatches, and ${report.aggregate.freshTaskEvaluations} fresh task measurements.`,
		"",
		"Assistant CHAMPION prose is advisory. Source, evaluator, artifact, ledger, core, verifier, boundary, duplicate, and exact-budget failures remain hard failures.",
		"",
	].join("\n");
}

async function main(): Promise<void> {
	const screenDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SCREEN_DIR;
	const summaryPath = join(screenDir, "summary-v1.json");
	const summaryInput = await readJson<ScreenSummary>(summaryPath);
	const summaryCorrectionPath = join(screenDir, "summary-v1-correction.json");
	const summaryCorrectionInput = await readJson<ScreenSummaryCorrection>(summaryCorrectionPath);
	assert.equal(summaryCorrectionInput.value.corrects.sha256, summaryInput.sha256);
	const calibrationInput = await readJson<unknown>(DEFAULT_CALIBRATION_PATH);
	assert.equal(calibrationInput.sha256, summaryInput.value.frozenInputs.calibrationSha256);
	assert.equal(COMPILER_GYM_EVALUATOR_SHA256, summaryInput.value.frozenInputs.evaluatorSha256);
	const calibration = parseStockCpuCalibration(
		calibrationInput.value,
		sha256Json(FROZEN_CAMPAIGN),
		COMPILER_GYM_EVALUATOR_SHA256,
	);

	const arms = [];
	for (const descriptor of ARM_DESCRIPTORS) {
		const armDir = join(screenDir, descriptor.blockId, descriptor.arm);
		const resultPath = join(armDir, "result.json");
		const ledgerPath = join(armDir, "evaluation", "evidence.jsonl");
		const historicalInput = await readJson<HistoricalArmResult>(resultPath);
		const historical = historicalInput.value;
		assert.equal(historical.jobs.length, 4, `${descriptor.blockId}/${descriptor.arm} job count`);
		const sessionContents = await readFile(historical.sessionFile, "utf8");
		const sessionSha256 = sha256Text(sessionContents);
		const session = analyzeSession(sessionContents, historical.jobs);
		const ledgerContents = await readFile(ledgerPath, "utf8");
		const ledgerSha256 = sha256Text(ledgerContents);
		const events = verifyLedgerContentsStrict(ledgerContents);
		const expected = expectedSummaryArm(summaryInput.value, descriptor);
		assert.equal(historicalInput.sha256, expected.resultSha256);
		assert.equal(ledgerSha256, expected.ledgerSha256);
		assert.equal(sessionSha256, correctedExpectedSessionSha256(expected, descriptor, summaryCorrectionInput.value));
		assert.equal(events.at(-1)?.hash, expected.terminalEventHash);

		const uniqueJobIds = new Set(historical.jobs.map((job) => job.proposal.jobId));
		const traceDuplicateCount = historical.trace?.duplicateCount ?? 0;
		const duplicateDispatches = Math.max(traceDuplicateCount, session.evaluatorDispatches - uniqueJobIds.size);
		if (historical.trace) assert.equal(historical.trace.callCount, session.evaluatorDispatches);
		if (historical.submittedJobIds) assert.equal(historical.submittedJobIds.length, session.evaluatorDispatches);
		assert.equal(session.evaluatorDispatches, historical.jobs.length);

		const artifactCount = await verifyArtifacts(armDir, historical.jobs);
		const evaluatorIntegrityPassed = historical.jobs.every(
			(job) =>
				job.measurement?.provenance.evaluatorSha256 === COMPILER_GYM_EVALUATOR_SHA256 &&
				job.measurement.verifierEpoch === summaryInput.value.frozenInputs.verifierEpoch,
		);
		const coreIntegrityPassed =
			descriptor.arm === "typed"
				? historical.repositoryIntegrityPassed === true
				: historical.primeCoreIntegrityPassed === true;
		const firstJob = historical.jobs[0];
		assert.ok(firstJob);
		const assessment = assessHostOwnedTerminalization(
			historical.jobs,
			calibration,
			{
				evaluatorDispatches: session.evaluatorDispatches,
				postTerminalEvaluatorDispatches: session.postTerminalEvaluatorDispatches,
				duplicateDispatches,
				providerDispatchesAfterTerminalMeasurement: session.providerDispatchesAfterTerminalMeasurement,
				blockedProviderRequestsAfterTerminalMeasurement: session.blockedProviderRequestsAfterTerminalMeasurement,
				intentionalHostTerminalizationStops: 0,
				ledgerIntegrityPassed: true,
				artifactIntegrityPassed: true,
				sourceIntegrityPassed: historical.sourceIntegrityPassed,
				evaluatorIntegrityPassed,
				coreIntegrityPassed,
				forbiddenBoundaryEvents: session.forbiddenBoundaryEvents,
				readOnlyDeviationEvents: session.readOnlyDeviationEvents,
				assistantReportText: session.assistantReportText,
			},
			{
				branchId: firstJob.proposal.branchId,
				treatment: firstJob.proposal.treatment,
				requireFreshMeasurements: true,
			},
		);
		assert.deepEqual(assessment.completionGate, historical.completionGate);
		assert.deepEqual(assessment.championSelection, historical.championSelection);

		arms.push({
			blockId: descriptor.blockId,
			arm: descriptor.arm,
			historicalOperationalValid: historical.ok,
			historicalFailure: historical.failure,
			resultSha256: historicalInput.sha256,
			ledgerSha256,
			ledgerTerminalHash: events.at(-1)?.hash ?? null,
			sessionSha256,
			ledgerEvents: events.length,
			artifacts: artifactCount,
			evaluatorDispatches: session.evaluatorDispatches,
			freshTaskEvaluations: historical.jobs.reduce((total, job) => total + (job.measurement?.tasks.length ?? 0), 0),
			duplicateDispatches,
			providerDispatchesAfterTerminalMeasurement: session.providerDispatchesAfterTerminalMeasurement,
			blockedProviderRequestsAfterTerminalMeasurement: session.blockedProviderRequestsAfterTerminalMeasurement,
			readOnlyDeviationEvents: session.readOnlyDeviationEvents,
			forbiddenBoundaryEvents: session.forbiddenBoundaryEvents,
			hostSelectedJobId: assessment.hostSelectedJobId,
			vector: vectorFor(assessment.championSelection),
			completionDigest: sha256Json(assessment.completionGate),
			selectionDigest: sha256Json(assessment.championSelection),
			completionUnchanged: true,
			selectionUnchanged: true,
			assistantReportStatus: assessment.assistantReport.status,
			measurementQualified: assessment.measurementQualified,
			terminalizationRuntimeConformant: assessment.terminalizationRuntimeConformant,
			hardFailures: assessment.hardFailures,
			deviations: assessment.deviations,
			finishedAt: historical.finishedAt,
		});
	}

	const report = {
		schemaVersion: 1,
		claimClass: "read-only-host-terminalization-sensitivity-replay",
		causalClaimAllowed: false,
		historicalStatusMutationAllowed: false,
		gpuPromotionAllowed: false,
		replayedThrough: [...arms].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt)).at(-1)
			?.finishedAt,
		policy: HOST_OWNED_TERMINALIZATION_POLICY,
		sourceInputs: {
			screenSummaryPath: relative(REPOSITORY_ROOT, summaryPath),
			screenSummarySha256: summaryInput.sha256,
			screenSummaryCorrectionPath: relative(REPOSITORY_ROOT, summaryCorrectionPath),
			screenSummaryCorrectionSha256: summaryCorrectionInput.sha256,
			calibrationPath: relative(REPOSITORY_ROOT, DEFAULT_CALIBRATION_PATH),
			calibrationSha256: calibrationInput.sha256,
		},
		arms,
		aggregate: {
			arms: arms.length,
			historicalOperationalValidArms: arms.filter((arm) => arm.historicalOperationalValid).length,
			historicalOperationalInvalidArms: arms.filter((arm) => !arm.historicalOperationalValid).length,
			measurementQualifiedArms: arms.filter((arm) => arm.measurementQualified).length,
			terminalizationRuntimeConformantArms: arms.filter((arm) => arm.terminalizationRuntimeConformant).length,
			unchangedSelections: arms.filter((arm) => arm.selectionUnchanged).length,
			unchangedCompletionGates: arms.filter((arm) => arm.completionUnchanged).length,
			ledgerEvents: arms.reduce((total, arm) => total + arm.ledgerEvents, 0),
			artifacts: arms.reduce((total, arm) => total + arm.artifacts, 0),
			evaluatorDispatches: arms.reduce((total, arm) => total + arm.evaluatorDispatches, 0),
			freshTaskEvaluations: arms.reduce((total, arm) => total + arm.freshTaskEvaluations, 0),
			duplicateDispatches: arms.reduce((total, arm) => total + arm.duplicateDispatches, 0),
			forbiddenBoundaryEvents: arms.reduce((total, arm) => total + arm.forbiddenBoundaryEvents.length, 0),
			readOnlyDeviationEvents: arms.reduce((total, arm) => total + arm.readOnlyDeviationEvents.length, 0),
			providerDispatchesAfterTerminalMeasurement: arms.reduce(
				(total, arm) => total + arm.providerDispatchesAfterTerminalMeasurement,
				0,
			),
			blockedProviderRequestsAfterTerminalMeasurement: arms.reduce(
				(total, arm) => total + arm.blockedProviderRequestsAfterTerminalMeasurement,
				0,
			),
		},
		decision: {
			replayGatePassed: arms.every(
				(arm) => arm.measurementQualified && arm.selectionUnchanged && arm.completionUnchanged,
			),
			historicalInvalidArmPreserved: arms.some(
				(arm) => arm.blockId === "2026-08-28-block-v2" && !arm.historicalOperationalValid,
			),
			nextStep:
				"qualify host-owned terminalization with deterministic tests and piggyback the first live exercise on the next orthogonal CPU hypothesis",
			gpuPromotion: false,
		},
	};
	assert.equal(report.aggregate.arms, 7);
	assert.equal(report.aggregate.historicalOperationalValidArms, 6);
	assert.equal(report.aggregate.historicalOperationalInvalidArms, 1);
	assert.equal(report.aggregate.measurementQualifiedArms, 7);
	assert.equal(report.aggregate.ledgerEvents, 182);
	assert.equal(report.aggregate.artifacts, 84);
	assert.equal(report.aggregate.evaluatorDispatches, 28);
	assert.equal(report.aggregate.freshTaskEvaluations, 56);
	assert.equal(report.aggregate.duplicateDispatches, 0);
	assert.equal(report.aggregate.forbiddenBoundaryEvents, 0);
	assert.equal(report.decision.replayGatePassed, true);
	assert.equal(report.decision.historicalInvalidArmPreserved, true);

	const jsonPath = join(screenDir, "host-terminalization-replay-v1.json");
	const markdownPath = join(screenDir, "host-terminalization-replay-v1.md");
	await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, markdownReport(report), "utf8");
	const jsonContents = await readFile(jsonPath, "utf8");
	const markdownContents = await readFile(markdownPath, "utf8");
	process.stdout.write(
		`${JSON.stringify({
			ok: true,
			jsonPath,
			jsonSha256: sha256Text(jsonContents),
			markdownPath,
			markdownSha256: sha256Text(markdownContents),
			aggregate: report.aggregate,
			decision: report.decision,
		})}\n`,
	);
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
	process.exitCode = 1;
});

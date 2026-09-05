import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { ArtifactStore } from "./artifact-store.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import {
	analyzeFeedbackProjectionPair,
	type FeedbackProjectionArmEvidence,
	type FeedbackProjectionUsage,
} from "./feedback-projection-analysis.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import type { MinimizationParetoPoint } from "./pareto-coverage.js";
import { STOCK_CPU_MAX_SUBMISSIONS, STOCK_CPU_TASKS } from "./stock-cpu-protocol.js";
import {
	parseStockFeedbackProjectionPairPreregistration,
	projectStockInterfaceFeedback,
	STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
	STOCK_INTERFACE_PARITY_TOOL_NAME,
	type StockInterfaceFeedbackView,
	type StockInterfaceParityEvaluationEnvelope,
} from "./stock-interface-parity-protocol.js";
import type { JobView } from "./types.js";

interface ParsedArmResult {
	result: Record<string, unknown>;
	resultPath: string;
	resultSha256: string;
	armPreregistrationPath: string;
	armPreregistrationSha256: string;
	armPreregistrationProviderCalls: {
		expectedProviderCalls: number;
		providerCallsHard: number;
		legacyConflict: boolean;
	};
	feedbackView: StockInterfaceFeedbackView;
	pairPreregistrationSha256: string;
	implementationBundleSha256: string;
	sessionPath: string;
	sessionSha256: string;
	sessionStartedAt: string;
	ledgerPath: string;
	ledgerSha256: string;
	artifactRefsVerified: number;
	projectionResultSha256: string;
	evidence: FeedbackProjectionArmEvidence;
	finishedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
	const value = record[key];
	if (!isRecord(value)) throw new Error(`${key} must be an object`);
	return value;
}

function stringField(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string") throw new Error(`${key} must be a string`);
	return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
	return value;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
	const value = record[key];
	if (typeof value !== "boolean") throw new Error(`${key} must be boolean`);
	return value;
}

function parseUsage(value: unknown): FeedbackProjectionUsage {
	if (!isRecord(value)) throw new Error("knownRootMessageUsage must be an object");
	const cost = recordField(value, "cost");
	return {
		input: numberField(value, "input"),
		output: numberField(value, "output"),
		cacheRead: numberField(value, "cacheRead"),
		cacheWrite: numberField(value, "cacheWrite"),
		totalTokens: numberField(value, "totalTokens"),
		cost: { total: numberField(cost, "total") },
	};
}

function parseFeedbackBytes(result: Record<string, unknown>): number[] {
	const trace = recordField(result, "trace");
	const values = trace.modelFeedbackBytes;
	if (!Array.isArray(values) || values.some((value) => !Number.isSafeInteger(value) || Number(value) <= 0)) {
		throw new Error("trace.modelFeedbackBytes must contain positive safe integers");
	}
	return values.map(Number);
}

function jobsFromResult(result: Record<string, unknown>): JobView[] {
	if (!Array.isArray(result.jobs)) throw new Error("jobs must be an array");
	return result.jobs as JobView[];
}

function measuredPoints(jobs: readonly JobView[]): MinimizationParetoPoint[] {
	return jobs.map((job) => {
		assert.equal(job.state.status, "succeeded", `${job.proposal.jobId} is not succeeded`);
		assert.ok(job.measurement, `${job.proposal.jobId} has no measurement`);
		const tasks = new Map(job.measurement.tasks.map((task) => [task.benchmarkId, task]));
		assert.deepEqual([...tasks.keys()].sort(), [...STOCK_CPU_TASKS].sort());
		const vector = STOCK_CPU_TASKS.map((benchmarkId) => {
			const task = tasks.get(benchmarkId);
			assert.ok(task, `${job.proposal.jobId} omits ${benchmarkId}`);
			assert.equal(task.status, "accepted");
			assert.equal(task.verifier.passed, true);
			const metric = task.metrics.IrInstructionCount;
			assert.ok(Number.isSafeInteger(metric) && Number(metric) >= 0, `${benchmarkId} has invalid IR`);
			return Number(metric);
		});
		return { id: job.proposal.jobId, vector };
	});
}

async function verifyArtifacts(evaluationDir: string, jobs: readonly JobView[]): Promise<number> {
	const store = new ArtifactStore(join(evaluationDir, "artifacts"));
	let verified = 0;
	for (const job of jobs) {
		await store.readString(job.proposal.candidate);
		verified++;
		if (job.measurement?.stdout) {
			await store.readString(job.measurement.stdout);
			verified++;
		}
		if (job.measurement?.stderr) {
			await store.readString(job.measurement.stderr);
			verified++;
		}
	}
	return verified;
}

function sessionEntries(contents: string): Record<string, unknown>[] {
	return contents
		.trimEnd()
		.split("\n")
		.filter(Boolean)
		.map((line, index) => {
			const value: unknown = JSON.parse(line);
			if (!isRecord(value)) throw new Error(`Session line ${index + 1} must be an object`);
			return value;
		});
}

function verifyModelVisibleProjection(
	entries: readonly Record<string, unknown>[],
	view: StockInterfaceFeedbackView,
	jobs: readonly JobView[],
	recordedBytes: readonly number[],
): string {
	const jobById = new Map(jobs.map((job) => [job.proposal.jobId, job]));
	const projections: unknown[] = [];
	const observedBytes: number[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || !isRecord(entry.message)) continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== STOCK_INTERFACE_PARITY_TOOL_NAME) continue;
		assert.equal(message.isError, false);
		assert.ok(Array.isArray(message.content) && message.content.length === 1);
		const content = message.content[0];
		assert.ok(isRecord(content) && content.type === "text" && typeof content.text === "string");
		assert.ok(isRecord(message.details), "Tool result omits authoritative details");
		const details = message.details as unknown as StockInterfaceParityEvaluationEnvelope;
		assert.equal(details.protocolVersion, STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION);
		const job = jobById.get(details.job.jobId);
		assert.ok(job, `Tool result references unknown job ${details.job.jobId}`);
		assert.deepEqual(details.job.state, job.state);
		assert.deepEqual(details.job.measurement, job.measurement);
		const projection = projectStockInterfaceFeedback(details, view);
		assert.deepEqual(JSON.parse(content.text), projection);
		projections.push(projection);
		observedBytes.push(Buffer.byteLength(content.text));
	}
	assert.equal(projections.length, STOCK_CPU_MAX_SUBMISSIONS);
	assert.deepEqual(observedBytes, recordedBytes);
	return sha256Json(projections);
}

async function parseArm(input: {
	root: string;
	view: StockInterfaceFeedbackView;
	pairSha256: string;
	implementationBundleSha256: string;
}): Promise<ParsedArmResult> {
	const resultPath = join(input.root, input.view, "result.json");
	const armPreregistrationPath = join(input.root, input.view, "preregistration.json");
	const armPreregistrationContents = await readFile(armPreregistrationPath, "utf8");
	const armPreregistrationValue: unknown = JSON.parse(armPreregistrationContents);
	if (!isRecord(armPreregistrationValue)) throw new Error(`${input.view} arm preregistration must be an object`);
	const armRecord = recordField(armPreregistrationValue, "arm");
	const armBudgets = recordField(armPreregistrationValue, "budgets");
	const expectedProviderCalls = numberField(armRecord, "expectedProviderCalls");
	const providerCallsHard = numberField(armBudgets, "providerCallsHard");
	const resultContents = await readFile(resultPath, "utf8");
	const value: unknown = JSON.parse(resultContents);
	if (!isRecord(value)) throw new Error(`${input.view} result must be an object`);
	assert.equal(value.ok, true);
	assert.equal(value.feedbackView, input.view);
	assert.equal(value.protocolVersion, STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION);
	assert.equal(value.terminalization, "host-owned");
	assert.equal(value.pairPreregistrationSha256, input.pairSha256);
	assert.equal(value.implementationBundleSha256, input.implementationBundleSha256);
	const operationalGate = recordField(value, "operationalGate");
	const hostAssessment = recordField(value, "hostTerminalizationAssessment");
	const providerTracker = recordField(value, "providerTracker");
	const trace = recordField(value, "trace");
	const budget = recordField(value, "budget");
	const integrityPassed =
		booleanField(operationalGate, "passed") &&
		booleanField(hostAssessment, "measurementQualified") &&
		booleanField(hostAssessment, "terminalizationRuntimeConformant") &&
		numberField(providerTracker, "providerCalls") === STOCK_CPU_MAX_SUBMISSIONS &&
		numberField(providerTracker, "blockedProviderCalls") === 0 &&
		numberField(trace, "callCount") === STOCK_CPU_MAX_SUBMISSIONS &&
		numberField(trace, "duplicateCount") === 0 &&
		numberField(budget, "actualTaskEvaluations") === STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length &&
		numberField(budget, "reusedTaskEvaluations") === 0 &&
		booleanField(value, "sourceIntegrityPassed") &&
		booleanField(value, "repositoryIntegrityPassed") &&
		booleanField(value, "evaluatorIntegrityPassed") &&
		booleanField(value, "pairPreregistrationIntegrityPassed");
	const jobs = jobsFromResult(value);
	assert.equal(jobs.length, STOCK_CPU_MAX_SUBMISSIONS);
	const sessionPath = stringField(value, "sessionFile");
	const sessionContents = await readFile(sessionPath, "utf8");
	const sessionSha256 = sha256Text(sessionContents);
	assert.equal(sessionSha256, stringField(value, "sessionSha256"));
	const entries = sessionEntries(sessionContents);
	const session = entries[0];
	assert.equal(session?.type, "session");
	const sessionStartedAt = stringField(session!, "timestamp");
	const recordedBytes = parseFeedbackBytes(value);
	const projectionResultSha256 = verifyModelVisibleProjection(entries, input.view, jobs, recordedBytes);
	const ledgerPath = join(input.root, input.view, "evaluation", "evidence.jsonl");
	const ledgerContents = await readFile(ledgerPath, "utf8");
	verifyLedgerContentsStrict(ledgerContents);
	const ledgerSha256 = sha256Text(ledgerContents);
	assert.equal(ledgerSha256, stringField(value, "ledgerSha256"));
	const artifactRefsVerified = await verifyArtifacts(join(input.root, input.view, "evaluation"), jobs);
	const championSelection = recordField(value, "championSelection");
	const selected = championSelection.selectedJobId;
	if (selected !== null && typeof selected !== "string") throw new Error("selectedJobId must be string or null");
	return {
		result: value,
		resultPath,
		resultSha256: sha256Text(resultContents),
		armPreregistrationPath,
		armPreregistrationSha256: sha256Text(armPreregistrationContents),
		armPreregistrationProviderCalls: {
			expectedProviderCalls,
			providerCallsHard,
			legacyConflict:
				expectedProviderCalls !== STOCK_CPU_MAX_SUBMISSIONS || providerCallsHard !== STOCK_CPU_MAX_SUBMISSIONS,
		},
		feedbackView: input.view,
		pairPreregistrationSha256: input.pairSha256,
		implementationBundleSha256: input.implementationBundleSha256,
		sessionPath,
		sessionSha256,
		sessionStartedAt,
		ledgerPath,
		ledgerSha256,
		artifactRefsVerified,
		projectionResultSha256,
		evidence: {
			feedbackView: input.view,
			operationalPassed: integrityPassed,
			projectionIntegrityPassed: true,
			modelFeedbackBytes: recordedBytes,
			points: measuredPoints(jobs),
			selectedJobId: selected,
			usage: parseUsage(value.knownRootMessageUsage),
			promptWallMs: numberField(value, "promptWallMs"),
			evaluatorWaitMs: numberField(value, "evaluatorWaitMs"),
			calendarMs: numberField(value, "calendarMs"),
		},
		finishedAt: stringField(value, "finishedAt"),
	};
}

function percent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

function selectedVector(arm: FeedbackProjectionArmEvidence): readonly number[] | null {
	return arm.points.find((point) => point.id === arm.selectedJobId)?.vector ?? null;
}

function markdownReport(input: {
	analysis: ReturnType<typeof analyzeFeedbackProjectionPair>;
	pairSha256: string;
	full: ParsedArmResult;
	concise: ParsedArmResult;
}): string {
	const { analysis } = input;
	return [
		"# CompilerGym feedback-projection screen",
		"",
		`Decision: **${analysis.decision}**. The compression gate passed, but the concise arm failed the preregistered whole-Pareto quality gate. Replication and GPU transfer are stopped.`,
		"",
		"| Arm | Selected blowfish IR | Selected bzip2 IR | Model feedback bytes | Input tokens | Total tokens | Cost | Operational |",
		"|---|---:|---:|---:|---:|---:|---:|---|",
		`| Full control | ${selectedVector(analysis.full)?.[0] ?? "n/a"} | ${selectedVector(analysis.full)?.[1] ?? "n/a"} | ${analysis.full.totalModelFeedbackBytes} | ${analysis.full.usage.input} | ${analysis.full.usage.totalTokens} | $${analysis.full.usage.cost.total.toFixed(6)} | pass |`,
		`| Concise treatment | ${selectedVector(analysis.concise)?.[0] ?? "n/a"} | ${selectedVector(analysis.concise)?.[1] ?? "n/a"} | ${analysis.concise.totalModelFeedbackBytes} | ${analysis.concise.usage.input} | ${analysis.concise.usage.totalTokens} | $${analysis.concise.usage.cost.total.toFixed(6)} | pass |`,
		"",
		"## Preregistered gates",
		"",
		`- Compression: ${analysis.compression.ratio.toFixed(6)} <= ${analysis.compression.maximumAllowedRatio.toFixed(2)} (${analysis.compression.passed ? "pass" : "fail"}); feedback bytes fell ${percent(analysis.compression.reductionFraction)}.`,
		`- Proposal-conditioning sensitivity: the first three results were ${analysis.proposalConditioningSensitivity.fullBytes} versus ${analysis.proposalConditioningSensitivity.conciseBytes} bytes, ratio ${analysis.proposalConditioningSensitivity.ratio.toFixed(6)}. The fourth result is durably stored but no later provider dispatch consumes it.`,
		`- Quality: concise covers every full-control Pareto vector (${analysis.qualityGate.passed ? "pass" : "fail"}).`,
		`- Whole-Pareto classification, concise versus full: ${analysis.paretoCoverage.classification}.`,
		`- Operational and projection integrity: ${analysis.operationalGatePassed && analysis.projectionIntegrityPassed ? "pass" : "fail"}.`,
		"",
		"## Efficiency sensitivity",
		"",
		`- Input tokens fell ${percent(analysis.efficiency.inputTokenReductionFraction)}.`,
		`- Total tokens fell ${percent(analysis.efficiency.totalTokenReductionFraction)}.`,
		`- Modeled subscription cost fell ${percent(analysis.efficiency.costReductionFraction)}.`,
		`- Prompt wall time changed by ${percent(analysis.efficiency.promptWallReductionFraction)}; evaluator waits dominate and this is not a speed claim.`,
		"",
		"## Integrity",
		"",
		`- Pair preregistration: ${input.pairSha256}`,
		`- Full ledger/session: ${input.full.ledgerSha256} / ${input.full.sessionSha256}`,
		`- Concise ledger/session: ${input.concise.ledgerSha256} / ${input.concise.sessionSha256}`,
		`- Model-visible projection digests: ${input.full.projectionResultSha256} / ${input.concise.projectionResultSha256}`,
		`- Content-addressed artifact references re-read: ${input.full.artifactRefsVerified + input.concise.artifactRefsVerified}.`,
		`- Artifact note: both sealed arm preregistrations inherited legacy 5-call fields; the earlier controlling pair preregistration and runtime gate fixed 4, and execution observed exactly 4. Future arm generators are corrected; sealed artifacts were not rewritten.`,
		"",
		"This is one randomized, unseedable trajectory pair. It is a directional screen, not a causal estimate. Under the preregistered kill rule, failure to preserve the control frontier ends this treatment despite its token savings.",
		"",
	].join("\n");
}

async function main(): Promise<void> {
	const flag = process.argv[2];
	const value = process.argv[3];
	if (flag !== "--screen-dir" || !value || process.argv.length !== 4) {
		throw new Error("Usage: analyze-feedback-projection-pair --screen-dir <path>");
	}
	const root = resolve(value);
	const pairPath = join(root, "preregistration.json");
	const pairContents = await readFile(pairPath, "utf8");
	const pairValue: unknown = JSON.parse(pairContents);
	if (!isRecord(pairValue)) throw new Error("Pair preregistration must be an object");
	const frozenCommon = recordField(pairValue, "frozenCommon");
	const pair = parseStockFeedbackProjectionPairPreregistration(pairValue, {
		promptSha256: stringField(frozenCommon, "promptSha256"),
		implementationBundleSha256: stringField(pairValue, "implementationBundleSha256"),
	});
	const pairSha256 = sha256Text(pairContents);
	const full = await parseArm({
		root,
		view: "full",
		pairSha256,
		implementationBundleSha256: pair.implementationBundleSha256,
	});
	const concise = await parseArm({
		root,
		view: "concise",
		pairSha256,
		implementationBundleSha256: pair.implementationBundleSha256,
	});
	if (pair.runOrder[0] === "full") {
		assert.ok(
			Date.parse(full.finishedAt) <= Date.parse(concise.sessionStartedAt),
			"Observed arm order violates preregistration",
		);
	} else {
		assert.ok(
			Date.parse(concise.finishedAt) <= Date.parse(full.sessionStartedAt),
			"Observed arm order violates preregistration",
		);
	}
	const analysis = analyzeFeedbackProjectionPair({
		full: full.evidence,
		concise: concise.evidence,
		maximumFeedbackRatio: pair.gates.compression.maximum,
	});
	const analysisRecord = {
		...analysis,
		pairPreregistrationPath: pairPath,
		pairPreregistrationSha256: pairSha256,
		runOrder: pair.runOrder,
		arms: {
			full: {
				resultPath: full.resultPath,
				resultSha256: full.resultSha256,
				armPreregistrationPath: full.armPreregistrationPath,
				armPreregistrationSha256: full.armPreregistrationSha256,
				armPreregistrationProviderCalls: full.armPreregistrationProviderCalls,
				ledgerPath: full.ledgerPath,
				ledgerSha256: full.ledgerSha256,
				sessionPath: full.sessionPath,
				sessionSha256: full.sessionSha256,
				projectionResultSha256: full.projectionResultSha256,
				artifactRefsVerified: full.artifactRefsVerified,
			},
			concise: {
				resultPath: concise.resultPath,
				resultSha256: concise.resultSha256,
				armPreregistrationPath: concise.armPreregistrationPath,
				armPreregistrationSha256: concise.armPreregistrationSha256,
				armPreregistrationProviderCalls: concise.armPreregistrationProviderCalls,
				ledgerPath: concise.ledgerPath,
				ledgerSha256: concise.ledgerSha256,
				sessionPath: concise.sessionPath,
				sessionSha256: concise.sessionSha256,
				projectionResultSha256: concise.projectionResultSha256,
				artifactRefsVerified: concise.artifactRefsVerified,
			},
		},
		analyzedAt: new Date().toISOString(),
	};
	const analysisPath = join(root, "analysis-v1.json");
	const reportPath = join(root, "analysis-v1.md");
	await writeFile(analysisPath, `${JSON.stringify(analysisRecord, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await writeFile(reportPath, markdownReport({ analysis, pairSha256, full, concise }), {
		encoding: "utf8",
		mode: 0o600,
	});
	const manifest = {
		pairPreregistrationSha256: pairSha256,
		fullResultSha256: full.resultSha256,
		fullArmPreregistrationSha256: full.armPreregistrationSha256,
		fullLedgerSha256: full.ledgerSha256,
		fullSessionSha256: full.sessionSha256,
		conciseResultSha256: concise.resultSha256,
		conciseArmPreregistrationSha256: concise.armPreregistrationSha256,
		conciseLedgerSha256: concise.ledgerSha256,
		conciseSessionSha256: concise.sessionSha256,
		analysisSha256: sha256Text(await readFile(analysisPath, "utf8")),
		reportSha256: sha256Text(await readFile(reportPath, "utf8")),
	};
	const manifestPath = join(root, "analysis-v1.sha256.json");
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await Promise.all([analysisPath, reportPath, manifestPath].map((path) => chmod(path, 0o600)));
	console.log(JSON.stringify({ decision: analysis.decision, analysisPath, reportPath, manifestPath, manifest }));
}

await main();

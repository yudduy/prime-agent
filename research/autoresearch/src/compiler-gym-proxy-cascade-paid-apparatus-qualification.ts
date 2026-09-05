import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	type CompilerGymCanonicalOneTaskPreparationEvidence,
	type CompilerGymCanonicalOneTaskSemanticResultAggregate,
	DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
	FarmShareCompilerGymIrDeltaScreenAdapter,
	parseCompilerGymCanonicalOneTaskSemanticResultAggregate,
} from "./compiler-gym-ir-delta-screen-adapter.js";
import { COMPILER_GYM_PROXY_CASCADE_BZIP2 } from "./compiler-gym-proxy-cascade-protocol.js";
import { ResearchController } from "./controller.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import type { EvaluationAdapter, EvaluationContext, EvaluationJob, EvaluationOutcome, JobView } from "./types.js";

export const COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_QUALIFICATION_PROTOCOL =
	"compiler-gym-proxy-cascade-paid-apparatus-qualification-v1" as const;

const BRANCH_ID = "proxy-cascade-paid-apparatus-qualification";
const TREATMENTS = [
	"proxy-cascade-paid-apparatus:hidden-audit-a",
	"proxy-cascade-paid-apparatus:hidden-audit-b",
] as const;
const CANDIDATES = [["-mem2reg"], ["-mem2reg", "-instcombine"]] as const;

class CanonicalBzip2QualificationAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	constructor(private readonly delegate: FarmShareCompilerGymIrDeltaScreenAdapter) {}

	evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
		return this.delegate.evaluateCanonicalOneTaskSemanticResult(job, context);
	}
}

function parseOutputDir(argv: readonly string[]): string {
	if (argv.length === 2 && argv[0] === "--output-dir" && argv[1]) return resolve(argv[1]);
	throw new Error("Usage: compiler-gym-proxy-cascade-paid-apparatus-qualification --output-dir <fresh-path>");
}

async function createFreshPrivateDirectory(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await mkdir(path, { recursive: false, mode: 0o700 });
	await chmod(path, 0o700);
}

async function writePrivateCanonicalJson(path: string, value: unknown): Promise<string> {
	const contents = `${canonicalJson(toJsonValue(value))}\n`;
	const handle = await open(
		path,
		fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	const readback = await readFile(path, "utf8");
	if (readback !== contents) throw new Error(`Private canonical JSON readback drifted: ${path}`);
	return sha256Text(contents);
}

function terminalAggregate(
	job: JobView,
	artifactStore: ArtifactStore,
): Promise<CompilerGymCanonicalOneTaskSemanticResultAggregate> {
	assert.equal(job.state.status, "succeeded", `${job.proposal.jobId} did not succeed`);
	assert.ok(job.state.externalJobId, `${job.proposal.jobId} lacks a durable Slurm ID`);
	assert.ok(job.measurement?.stdout, `${job.proposal.jobId} lacks a durable evaluator aggregate`);
	assert.equal(job.measurement.reuse, undefined, `${job.proposal.jobId} reused a measurement`);
	assert.equal(job.measurement.tasks.length, 1);
	assert.equal(job.measurement.tasks[0]?.benchmarkId, COMPILER_GYM_PROXY_CASCADE_BZIP2);
	assert.equal(job.measurement.tasks[0]?.status, "accepted");
	assert.equal(job.measurement.tasks[0]?.verifier.passed, true);
	return artifactStore
		.readString(job.measurement.stdout)
		.then((contents) => parseCompilerGymCanonicalOneTaskSemanticResultAggregate(contents));
}

function intervalsOverlap(aggregates: readonly CompilerGymCanonicalOneTaskSemanticResultAggregate[]): boolean {
	const intervals = aggregates.map((aggregate) => {
		const root = aggregate.tasks[0].accountingRows.root;
		return { start: Date.parse(root.startAt), end: Date.parse(root.endAt) };
	});
	return (
		Math.max(...intervals.map((interval) => interval.start)) <= Math.min(...intervals.map((interval) => interval.end))
	);
}

async function main(): Promise<void> {
	const outputDir = parseOutputDir(process.argv.slice(2));
	await createFreshPrivateDirectory(outputDir);
	const ledgerPath = join(outputDir, "evidence.jsonl");
	const artifactDir = join(outputDir, "artifacts");
	await mkdir(artifactDir, { recursive: false, mode: 0o700 });
	await chmod(artifactDir, 0o700);
	const artifactStore = new ArtifactStore(artifactDir);
	const qualificationId = randomUUID();
	const startedAt = new Date().toISOString();
	const config = {
		...DEFAULT_FARMSHARE_COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_CONFIG,
		accountingMode: "required" as const,
		accountingEvidenceVersion: "exact-three-row-v1" as const,
	};
	const evaluator = new FarmShareCompilerGymIrDeltaScreenAdapter(config);
	let controller: ResearchController | null = null;
	try {
		const preparation: CompilerGymCanonicalOneTaskPreparationEvidence = await evaluator.prepareCanonicalOneTask(
			new AbortController().signal,
		);
		controller = await ResearchController.open({
			ledgerPath,
			artifactDir,
			adapters: [new CanonicalBzip2QualificationAdapter(evaluator)],
			metrics: {
				"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
				kernelbench: { name: "fastAtOne", direction: "maximize" },
				nanogpt: { name: "trainSteps", direction: "minimize" },
			},
			allowedBenchmarks: {
				"compiler-gym": [COMPILER_GYM_PROXY_CASCADE_BZIP2],
				kernelbench: [],
				nanogpt: [],
			},
			allowedTreatments: TREATMENTS,
			maxInflight: { "compiler-gym": 2 },
			maxSubmissionsPerBranch: 2,
			maxTaskEvaluationsPerBranch: 2,
		});
		await chmod(ledgerPath, 0o600);
		await controller.appendRunManifest({
			protocol: COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_QUALIFICATION_PROTOCOL,
			type: "qualification_started",
			qualificationId,
			startedAt,
			classification: "model-free-apparatus-qualification-only",
			model: null,
			providerCalls: 0,
			agentSessions: 0,
			benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
			requestedConcurrency: 2,
			preparation,
		});
		const submissions = await Promise.all(
			CANDIDATES.map((actions, index) =>
				controller!.submit({
					branchId: BRANCH_ID,
					lane: "compiler-gym",
					benchmarkIds: [COMPILER_GYM_PROXY_CASCADE_BZIP2],
					budgetClass: "smoke",
					treatment: TREATMENTS[index]!,
					proposal: {
						hypothesis: `Fixed apparatus candidate ${index + 1} produces a complete canonical result`,
						mechanism: "Exercise the exact concurrent canonical bzip2 allocation and accounting path",
						predictedOutcome: "Twenty semantic callbacks and exact root, extern, and evaluator-step evidence",
						boundaryConditions: [
							"Model-free apparatus qualification only",
							"No result is eligible for scientific comparison or model feedback",
						],
						parentJobIds: [],
					},
					candidate: { format: "llvm-pass-sequence", content: JSON.stringify(actions) },
					requireFreshMeasurement: true,
				}),
			),
		);
		assert.ok(submissions.every((submission) => !submission.duplicate));
		await controller.waitForIdle();
		const jobs = controller.statusForBranch(
			BRANCH_ID,
			submissions.map((submission) => submission.jobId),
		);
		const aggregates = await Promise.all(jobs.map((job) => terminalAggregate(job, artifactStore)));
		assert.equal(new Set(jobs.map((job) => job.state.externalJobId)).size, 2);
		assert.equal(new Set(aggregates.map((aggregate) => aggregate.tasks[0].transientCache)).size, 2);
		assert.equal(new Set(aggregates.map((aggregate) => aggregate.tasks[0].jobName)).size, 2);
		assert.equal(intervalsOverlap(aggregates), true, "The two qualification allocations did not overlap");
		for (const aggregate of aggregates) {
			const task = aggregate.tasks[0];
			assert.equal(task.slurmId, jobs.find((job) => job.proposal.jobId === aggregate.jobId)?.state.externalJobId);
			assert.equal(task.accountingRows.step.allocCpus, 2);
			assert.equal(task.accountingRows.step.nTasks, 1);
			assert.equal(task.accountingRows.extern.state.replace(/\+$/, ""), "COMPLETED");
			assert.equal(task.accountingRows.extern.exitCode, "0:0");
		}
		const finishedAt = new Date().toISOString();
		const terminalSummary = {
			protocol: COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_QUALIFICATION_PROTOCOL,
			type: "qualification_terminal",
			qualificationId,
			startedAt,
			finishedAt,
			outcome: "passed",
			classification: "model-free-apparatus-qualification-only",
			scientificEvidenceEligible: false,
			model: null,
			providerCalls: 0,
			agentSessions: 0,
			allocationCount: aggregates.length,
			maximumConfiguredConcurrency: 2,
			observedAllocationIntervalsOverlap: true,
			externalJobIds: aggregates.map((aggregate) => aggregate.tasks[0].slurmId).sort(),
			stepCpuSeconds: aggregates.map((aggregate) => aggregate.tasks[0].accountingRows.step.cpuTimeRawSeconds),
			externMinusRootElapsedSeconds: aggregates.map(
				(aggregate) =>
					aggregate.tasks[0].accountingRows.extern.elapsedRawSeconds -
					aggregate.tasks[0].accountingRows.root.elapsedRawSeconds,
			),
			jobs,
		};
		await controller.appendRunManifest(terminalSummary);
		controller.verifyLedger();
		const ledgerContents = await readFile(ledgerPath, "utf8");
		const ledgerEvents = verifyLedgerContentsStrict(ledgerContents);
		const ledgerTerminalHash = ledgerEvents.at(-1)?.hash;
		assert.ok(ledgerTerminalHash);
		const result = {
			ok: true,
			...terminalSummary,
			ledgerPath,
			ledgerSha256: sha256Text(ledgerContents),
			ledgerTerminalHash,
		};
		const resultPath = join(outputDir, "result.json");
		const resultSha256 = await writePrivateCanonicalJson(resultPath, result);
		await writePrivateCanonicalJson(join(outputDir, "seal.json"), {
			protocol: COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_QUALIFICATION_PROTOCOL,
			qualificationId,
			resultPath,
			resultSha256,
			ledgerPath,
			ledgerSha256: result.ledgerSha256,
			ledgerTerminalHash,
		});
		process.stdout.write(`${canonicalJson(toJsonValue({ ...result, resultPath, resultSha256 }))}\n`);
	} catch (error) {
		const failedAt = new Date().toISOString();
		const failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
		try {
			await controller?.appendRunManifest({
				protocol: COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_QUALIFICATION_PROTOCOL,
				type: "qualification_terminal",
				qualificationId,
				startedAt,
				failedAt,
				outcome: "failed",
				classification: "model-free-apparatus-qualification-only",
				scientificEvidenceEligible: false,
				model: null,
				providerCalls: 0,
				agentSessions: 0,
				failure,
			});
			controller?.verifyLedger();
			await writePrivateCanonicalJson(join(outputDir, "result.json"), {
				ok: false,
				protocol: COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_QUALIFICATION_PROTOCOL,
				qualificationId,
				startedAt,
				failedAt,
				classification: "model-free-apparatus-qualification-only",
				scientificEvidenceEligible: false,
				model: null,
				providerCalls: 0,
				agentSessions: 0,
				failure,
			});
		} catch {
			// Preserve the primary qualification failure.
		}
		throw error;
	}
}

await main();

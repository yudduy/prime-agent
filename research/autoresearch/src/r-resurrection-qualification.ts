import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import { DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG, FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";
import {
	assertRResurrectionQualificationPins,
	buildRResurrectionSubmitRequest,
	decideRResurrectionQualification,
	R_RESURRECTION_BRANCH_ID,
	R_RESURRECTION_CANDIDATES,
	R_RESURRECTION_EVALUATOR_SHA256,
	R_RESURRECTION_MAX_SUBMISSIONS,
	R_RESURRECTION_MAX_TASK_EVALUATIONS,
	R_RESURRECTION_PROTOCOL,
	R_RESURRECTION_QUALIFICATION_CONFIG,
	R_RESURRECTION_QUALIFICATION_CONFIG_SHA256,
	R_RESURRECTION_TASKS,
	type RResurrectionCellId,
	type RResurrectionQualificationDecision,
} from "./r-resurrection-protocol.js";
import type { ComparisonResult, SubmitResult } from "./types.js";

interface CliOptions {
	outputDir: string;
	submit: boolean;
}

interface ControllerComparisons {
	baselineX: ComparisonResult;
	enabledX: ComparisonResult;
}

function parseOptions(argv: readonly string[]): CliOptions {
	let outputDir: string | null = null;
	let submit = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--output-dir") {
			const value = argv[index + 1];
			if (!value) throw new Error("--output-dir requires a path");
			if (outputDir !== null) throw new Error("--output-dir may be specified only once");
			outputDir = resolve(value);
			index++;
			continue;
		}
		if (argument === "--submit") {
			if (submit) throw new Error("--submit may be specified only once");
			submit = true;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (outputDir === null) {
		throw new Error("Usage: r-resurrection-qualify --output-dir <new-durable-path> [--submit]");
	}
	return { outputDir, submit };
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
	await chmod(path, 0o600);
}

async function verifyLocalEvaluatorPin(): Promise<void> {
	const path = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
	const digest = sha256Text(await readFile(path, "utf8"));
	if (digest !== R_RESURRECTION_EVALUATOR_SHA256) {
		throw new Error(
			`CompilerGym evaluator SHA-256 mismatch: expected ${R_RESURRECTION_EVALUATOR_SHA256}, got ${digest}`,
		);
	}
}

function treatment(cellId: RResurrectionCellId): string {
	const definition = R_RESURRECTION_CANDIDATES.find((candidate) => candidate.cellId === cellId);
	if (!definition) throw new Error(`Missing treatment for ${cellId}`);
	return definition.treatment;
}

function assertComparisonMatchesDecision(
	comparison: ComparisonResult,
	decision: RResurrectionQualificationDecision,
	leftCellId: RResurrectionCellId,
	rightCellId: RResurrectionCellId,
): void {
	if (comparison.compatibilityDigest !== decision.compatibilityDigest) {
		throw new Error(`${leftCellId}/${rightCellId} controller compatibility digest differs from the pure decision`);
	}
	for (const effect of decision.effects) {
		const pair = comparison.paired.find((candidate) => candidate.benchmarkId === effect.benchmarkId);
		if (!pair) throw new Error(`${leftCellId}/${rightCellId} comparison is missing ${effect.benchmarkId}`);
		const expectedDelta = leftCellId === "A" ? effect.xDeltaOnA : effect.xDeltaAfterE;
		if (expectedDelta === null || pair.orientedDelta !== expectedDelta) {
			throw new Error(`${leftCellId}/${rightCellId} comparison disagrees on ${effect.benchmarkId}`);
		}
	}
}

function controllerComparisons(
	controller: ResearchController,
	decision: RResurrectionQualificationDecision,
): ControllerComparisons | null {
	if (decision.integrityErrors.length > 0 || !decision.verifierEpoch || !decision.compatibilityDigest) return null;
	const baselineX = controller.compare(
		R_RESURRECTION_BRANCH_ID,
		"compiler-gym",
		treatment("A"),
		treatment("A+X"),
		decision.verifierEpoch,
		decision.compatibilityDigest,
	);
	const enabledX = controller.compare(
		R_RESURRECTION_BRANCH_ID,
		"compiler-gym",
		treatment("A+E"),
		treatment("A+E+X"),
		decision.verifierEpoch,
		decision.compatibilityDigest,
	);
	assertComparisonMatchesDecision(baselineX, decision, "A", "A+X");
	assertComparisonMatchesDecision(enabledX, decision, "A+E", "A+E+X");
	return { baselineX, enabledX };
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	assertRResurrectionQualificationPins();
	await verifyLocalEvaluatorPin();
	const runId = `${R_RESURRECTION_PROTOCOL}-${R_RESURRECTION_QUALIFICATION_CONFIG_SHA256.slice(0, 16)}`;
	if (!options.submit) {
		console.log(
			JSON.stringify(
				{
					status:
						"dry-run; pass --submit to create the immutable output directory and dispatch four CPU submissions",
					runId,
					qualificationConfigSha256: R_RESURRECTION_QUALIFICATION_CONFIG_SHA256,
					qualificationConfig: R_RESURRECTION_QUALIFICATION_CONFIG,
				},
				null,
				2,
			),
		);
		return;
	}

	await mkdir(dirname(options.outputDir), { recursive: true, mode: 0o700 });
	await mkdir(options.outputDir, { mode: 0o700 });
	await chmod(options.outputDir, 0o700);
	const artifactDir = join(options.outputDir, "artifacts");
	await mkdir(artifactDir, { mode: 0o700 });
	await chmod(artifactDir, 0o700);
	const ledgerPath = join(options.outputDir, "evidence.jsonl");
	const controller = await ResearchController.open({
		ledgerPath,
		artifactDir,
		adapters: [
			new FarmShareCompilerGymAdapter({
				...DEFAULT_FARMSHARE_COMPILER_GYM_CONFIG,
				maxParallelTasks: 1,
			}),
		],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": R_RESURRECTION_TASKS,
			kernelbench: [],
			nanogpt: [],
		},
		allowedTreatments: R_RESURRECTION_CANDIDATES.map((candidate) => candidate.treatment),
		maxInflight: { "compiler-gym": 4 },
		maxSubmissionsPerBranch: R_RESURRECTION_MAX_SUBMISSIONS,
		maxTaskEvaluationsPerBranch: R_RESURRECTION_MAX_TASK_EVALUATIONS,
	});
	await chmod(ledgerPath, 0o600);
	const startedAt = new Date().toISOString();
	const startManifest = {
		schemaVersion: 1,
		type: "compiler_gym_r_resurrection_qualification",
		phase: "start",
		runId,
		startedAt,
		qualificationConfigSha256: R_RESURRECTION_QUALIFICATION_CONFIG_SHA256,
		qualificationConfig: R_RESURRECTION_QUALIFICATION_CONFIG,
	};
	await controller.appendRunManifest(startManifest);
	await writePrivateJson(join(options.outputDir, "qualification-config.json"), R_RESURRECTION_QUALIFICATION_CONFIG);
	await writePrivateJson(join(options.outputDir, "manifest-start.json"), startManifest);

	try {
		const submissions = new Map<RResurrectionCellId, SubmitResult>();
		for (const definition of R_RESURRECTION_CANDIDATES) {
			const parentJobIds = definition.parentCellIds.map((parentCellId) => {
				const parent = submissions.get(parentCellId);
				if (!parent) throw new Error(`${definition.cellId} parent ${parentCellId} has not been submitted`);
				return parent.jobId;
			});
			const submitted = await controller.submit(buildRResurrectionSubmitRequest(definition.cellId, parentJobIds));
			if (submitted.duplicate)
				throw new Error(`${definition.cellId} unexpectedly deduplicated in a new qualification run`);
			submissions.set(definition.cellId, submitted);
		}
		await controller.waitForIdle();
		controller.verifyLedger();
		const jobIds = R_RESURRECTION_CANDIDATES.map((definition) => {
			const submitted = submissions.get(definition.cellId);
			if (!submitted) throw new Error(`Missing submission result for ${definition.cellId}`);
			return submitted.jobId;
		});
		const jobs = controller.statusForBranch(R_RESURRECTION_BRANCH_ID, jobIds);
		const budget = controller.budgetStatus(R_RESURRECTION_BRANCH_ID);
		if (
			budget.submissions !== R_RESURRECTION_MAX_SUBMISSIONS ||
			budget.taskEvaluations !== R_RESURRECTION_MAX_TASK_EVALUATIONS ||
			budget.remainingSubmissions !== 0 ||
			budget.remainingTaskEvaluations !== 0
		) {
			throw new Error(`Qualification budget accounting mismatch: ${JSON.stringify(budget)}`);
		}
		const decision = decideRResurrectionQualification(jobs);
		const comparisons = controllerComparisons(controller, decision);
		const endedAt = new Date().toISOString();
		const endManifest = {
			schemaVersion: 1,
			type: "compiler_gym_r_resurrection_qualification",
			phase: "end",
			runId,
			startedAt,
			endedAt,
			outcome: decision.outcome,
			qualificationConfigSha256: R_RESURRECTION_QUALIFICATION_CONFIG_SHA256,
			budget,
			submissions: R_RESURRECTION_CANDIDATES.map((definition) => ({
				cellId: definition.cellId,
				...submissions.get(definition.cellId)!,
			})),
			decision,
			controllerComparisons: comparisons,
		};
		await controller.appendRunManifest(endManifest);
		controller.verifyLedger();
		await writePrivateJson(join(options.outputDir, "manifest-end.json"), endManifest);
		const result = {
			ok: decision.outcome !== "invalid",
			gatePassed: decision.gatePassed,
			...endManifest,
			jobs,
		};
		await writePrivateJson(join(options.outputDir, "result.json"), result);
		console.log(JSON.stringify(result));
		if (!decision.gatePassed) process.exitCode = 1;
	} catch (error) {
		const failedAt = new Date().toISOString();
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		const failureManifest = {
			schemaVersion: 1,
			type: "compiler_gym_r_resurrection_qualification",
			phase: "end",
			runId,
			startedAt,
			failedAt,
			outcome: "failed",
			qualificationConfigSha256: R_RESURRECTION_QUALIFICATION_CONFIG_SHA256,
			error: message,
		};
		try {
			await controller.appendRunManifest(failureManifest);
			controller.verifyLedger();
			await writePrivateJson(join(options.outputDir, "manifest-failure.json"), failureManifest);
			await writePrivateJson(join(options.outputDir, "result.json"), {
				ok: false,
				gatePassed: false,
				...failureManifest,
			});
		} catch {
			// Preserve the primary qualification failure if failure evidence cannot also be recorded.
		}
		throw error;
	}
}

await main();

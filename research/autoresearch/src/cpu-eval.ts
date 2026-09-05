import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json } from "./canonical-json.js";
import { FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";

interface CliRequest {
	branchId: string;
	treatment: string;
	benchmarks: string[];
	actions: string[];
	hypothesis: string;
	mechanism: string;
	predictedOutcome: string;
	boundaryConditions: string[];
	parentJobIds: string[];
}

const REQUEST_KEYS = new Set([
	"branchId",
	"treatment",
	"benchmarks",
	"actions",
	"hypothesis",
	"mechanism",
	"predictedOutcome",
	"boundaryConditions",
	"parentJobIds",
]);

function parseOutputDir(argv: readonly string[]): string {
	if (argv.length === 2 && argv[0] === "--output-dir") return resolve(argv[1]);
	throw new Error("Usage: npm run autoresearch:cpu-eval -- --output-dir <path>");
}

function stringField(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
	return value;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
	const value = record[key];
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${key} must be a string array`);
	}
	return [...value];
}

async function parseRequest(): Promise<CliRequest> {
	const chunks: Buffer[] = [];
	let inputBytes = 0;
	for await (const chunk of process.stdin) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		inputBytes += buffer.byteLength;
		if (inputBytes > 64 * 1024) throw new Error("Request exceeds 64 KiB");
		chunks.push(buffer);
	}
	const input = Buffer.concat(chunks).toString("utf8");
	const value: unknown = JSON.parse(input);
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Request must be an object");
	const record = value as Record<string, unknown>;
	const unknown = Object.keys(record).filter((key) => !REQUEST_KEYS.has(key));
	const missing = [...REQUEST_KEYS].filter((key) => !(key in record));
	if (unknown.length > 0 || missing.length > 0) {
		throw new Error(`Request keys mismatch: missing=${missing.join(",")} unknown=${unknown.join(",")}`);
	}
	return {
		branchId: stringField(record, "branchId"),
		treatment: stringField(record, "treatment"),
		benchmarks: stringArrayField(record, "benchmarks"),
		actions: stringArrayField(record, "actions"),
		hypothesis: stringField(record, "hypothesis"),
		mechanism: stringField(record, "mechanism"),
		predictedOutcome: stringField(record, "predictedOutcome"),
		boundaryConditions: stringArrayField(record, "boundaryConditions"),
		parentJobIds: stringArrayField(record, "parentJobIds"),
	};
}

async function main(): Promise<void> {
	const outputDir = parseOutputDir(process.argv.slice(2));
	const request = await parseRequest();
	const trustedTasks = [
		...FROZEN_CAMPAIGN.lanes.compilerGym.devTasks,
		...FROZEN_CAMPAIGN.lanes.compilerGym.holdoutTasks,
	];
	const controller = await ResearchController.open({
		ledgerPath: resolve(outputDir, "evidence.jsonl"),
		artifactDir: resolve(outputDir, "artifacts"),
		adapters: [new FarmShareCompilerGymAdapter()],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": trustedTasks,
			kernelbench: FROZEN_CAMPAIGN.lanes.kernelBench.panelTasks,
			nanogpt: ["frontier-automated-speedrun"],
		},
	});
	const submitted = await controller.submit({
		branchId: request.branchId,
		lane: "compiler-gym",
		benchmarkIds: request.benchmarks,
		budgetClass: "smoke",
		treatment: request.treatment,
		proposal: {
			hypothesis: request.hypothesis,
			mechanism: request.mechanism,
			predictedOutcome: request.predictedOutcome,
			boundaryConditions: request.boundaryConditions,
			parentJobIds: request.parentJobIds,
		},
		candidate: { format: "llvm-pass-sequence", content: JSON.stringify(request.actions) },
	});
	await controller.waitForIdle();
	controller.verifyLedger();
	const result = {
		type: "compiler_gym_evaluation",
		campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
		request,
		submitted,
		job: controller.status([submitted.jobId])[0],
	};
	const resultPath = resolve(outputDir, "result.json");
	await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(resultPath, 0o600);
	console.log(JSON.stringify(result));
}

await main();

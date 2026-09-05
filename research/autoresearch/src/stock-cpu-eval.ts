import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { openStockCpuController } from "./stock-cpu-controller.js";
import { buildStockCpuEvaluationEnvelope } from "./stock-cpu-evaluation-envelope.js";
import {
	latestStockParent,
	parseStockCpuEvaluationRequest,
	STOCK_CPU_BRANCH_ID,
	STOCK_CPU_TASKS,
	STOCK_CPU_TREATMENT,
} from "./stock-cpu-protocol.js";

function parseOptions(argv: readonly string[]): { outputDir: string; requireFreshMeasurement: boolean } {
	if (argv.length === 2 && argv[0] === "--output-dir") {
		return { outputDir: resolve(argv[1]), requireFreshMeasurement: false };
	}
	if (argv.length === 3 && argv[0] === "--output-dir" && argv[2] === "--require-fresh") {
		return { outputDir: resolve(argv[1]), requireFreshMeasurement: true };
	}
	throw new Error("Usage: stock-cpu-eval --output-dir <path> [--require-fresh]");
}

async function readRequest(): Promise<unknown> {
	const chunks: Buffer[] = [];
	let inputBytes = 0;
	for await (const chunk of process.stdin) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		inputBytes += buffer.byteLength;
		if (inputBytes > 64 * 1024) throw new Error("Request exceeds 64 KiB");
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function main(): Promise<void> {
	const { outputDir, requireFreshMeasurement } = parseOptions(process.argv.slice(2));
	const request = parseStockCpuEvaluationRequest(await readRequest());
	const controller = await openStockCpuController(outputDir);
	const existing = controller.statusForBranch(STOCK_CPU_BRANCH_ID);
	const submitted = await controller.submit({
		branchId: STOCK_CPU_BRANCH_ID,
		lane: "compiler-gym",
		benchmarkIds: [...STOCK_CPU_TASKS],
		budgetClass: "smoke",
		treatment: STOCK_CPU_TREATMENT,
		proposal: {
			hypothesis: request.hypothesis,
			mechanism: request.mechanism,
			predictedOutcome: request.predictedOutcome,
			boundaryConditions: request.boundaryConditions,
			parentJobIds: latestStockParent(existing),
		},
		candidate: { format: "llvm-pass-sequence", content: JSON.stringify(request.actions) },
		requireFreshMeasurement,
	});
	await controller.waitForIdle();
	controller.verifyLedger();
	await chmod(resolve(outputDir, "evidence.jsonl"), 0o600);
	console.log(
		JSON.stringify(
			buildStockCpuEvaluationEnvelope({
				request,
				submitted,
				job: controller.status([submitted.jobId])[0],
				budget: controller.budgetStatus(STOCK_CPU_BRANCH_ID),
			}),
		),
	);
}

await main();

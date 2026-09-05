import { resolve } from "node:path";
import { FarmShareCompilerGymAdapter } from "./compiler-gym-adapter.js";
import { ResearchController } from "./controller.js";
import { STOCK_CPU_MAX_SUBMISSIONS, STOCK_CPU_TASKS, STOCK_CPU_TREATMENT } from "./stock-cpu-protocol.js";

export async function openStockCpuController(outputDir: string): Promise<ResearchController> {
	return ResearchController.open({
		ledgerPath: resolve(outputDir, "evidence.jsonl"),
		artifactDir: resolve(outputDir, "artifacts"),
		adapters: [new FarmShareCompilerGymAdapter()],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": STOCK_CPU_TASKS,
			kernelbench: [],
			nanogpt: [],
		},
		allowedTreatments: [STOCK_CPU_TREATMENT],
		maxInflight: { "compiler-gym": 1 },
		maxSubmissionsPerBranch: STOCK_CPU_MAX_SUBMISSIONS,
		maxTaskEvaluationsPerBranch: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
	});
}

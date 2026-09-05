/** Run a task with a fresh strategic review after each bounded work step. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runWithStrategy, type StrategyRunOptions } from "../../src/index.js";

const usage = `Usage: npx tsx --tsconfig ../../tsconfig.json examples/sdk/14-strategy.ts \\
  --objective "Improve the parser" --success-criteria "Existing checks pass and the slow path is faster"

Options:
  --cwd <directory>             Working directory (default: current directory)
  --max-steps <count>           Maximum work steps (default: 5)
  --output-dir <directory>      Parent directory for saved runs
  --help                       Show this help

Uses Prime's configured model and authentication. Each run creates a new output directory.`;

export function parseStrategyArgs(args: string[]): StrategyRunOptions | undefined {
	const { values } = parseArgs({
		args,
		options: {
			objective: { type: "string" },
			"success-criteria": { type: "string" },
			cwd: { type: "string" },
			"max-steps": { type: "string" },
			"output-dir": { type: "string" },
			help: { type: "boolean" },
		},
	});
	if (values.help) return undefined;
	if (!values.objective?.trim() || !values["success-criteria"]?.trim()) {
		throw new Error("Provide --objective and --success-criteria. Use --help for an example.");
	}
	const maxSteps = values["max-steps"];
	if (
		maxSteps !== undefined &&
		(!/^\d+$/.test(maxSteps) || !Number.isSafeInteger(Number(maxSteps)) || Number(maxSteps) < 1)
	) {
		throw new Error("--max-steps must be a positive integer.");
	}
	return {
		objective: values.objective,
		successCriteria: values["success-criteria"],
		cwd: values.cwd,
		outputDir: values["output-dir"],
		limits: maxSteps === undefined ? undefined : { maxSteps: Number(maxSteps) },
	};
}

async function main(): Promise<void> {
	const options = parseStrategyArgs(process.argv.slice(2));
	if (!options) {
		console.log(usage);
		return;
	}
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	try {
		const result = await runWithStrategy({
			...options,
			signal: controller.signal,
			onEvent(event) {
				if (event.type === "session_started" && event.role === "strategist") {
					console.error("Reviewing strategy...");
				} else if (event.type === "decision") {
					console.error(`${event.decision.action}: ${event.decision.reason}`);
				} else if (event.type === "step_started") {
					console.error(`Step ${event.step}: ${event.assignment}`);
				} else if (event.type === "step_finished") {
					console.error(`Step ${event.result.step}: ${event.result.status}`);
				}
			},
		});
		console.log(`${result.assessment}\nStop reason: ${result.stopReason}\nSaved run: ${result.outputDir}`);
		process.exitCode = result.stopReason === "error" ? 1 : result.stopReason === "cancelled" ? 130 : 0;
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, toJsonValue } from "./canonical-json.js";
import { runCompilerGymActionSpaceVisibilityFirstProposalPair } from "./compiler-gym-action-space-visibility-first-proposal-runner.js";
import { writeCompilerGymActionSpaceVisibilityPreregistration } from "./compiler-gym-action-space-visibility-preregistration.js";

interface VisibilityCliArguments {
	mode: "preregister" | "run";
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string;
}

function parseArguments(argv: readonly string[]): VisibilityCliArguments {
	if (
		argv.length !== 7 ||
		(argv[0] !== "preregister" && argv[0] !== "run") ||
		argv[1] !== "--repo-root" ||
		argv[3] !== "--preregistration" ||
		argv[5] !== "--output-dir" ||
		!argv[2] ||
		!argv[4] ||
		!argv[6]
	) {
		throw new Error(
			"Usage: <preregister|run> --repo-root <path> --preregistration <path> --output-dir <absent-path>",
		);
	}
	return {
		mode: argv[0],
		repoRoot: resolve(argv[2]),
		preregistrationPath: resolve(argv[4]),
		outputDir: resolve(argv[6]),
	};
}

export async function runCompilerGymActionSpaceVisibilityCli(argv: readonly string[]): Promise<unknown> {
	const parsed = parseArguments(argv);
	if (parsed.mode === "preregister") {
		const written = await writeCompilerGymActionSpaceVisibilityPreregistration({
			repoRoot: parsed.repoRoot,
			path: parsed.preregistrationPath,
			outputDir: parsed.outputDir,
		});
		return {
			mode: parsed.mode,
			path: written.path,
			sha256: written.sha256,
			sampledArmOrder: written.record.executionOrder.armOrder,
			runArgv: written.record.launch.runArgv,
		};
	}
	return runCompilerGymActionSpaceVisibilityFirstProposalPair({
		repoRoot: parsed.repoRoot,
		preregistrationPath: parsed.preregistrationPath,
		outputDir: parsed.outputDir,
	});
}

const isEntrypoint =
	process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
	runCompilerGymActionSpaceVisibilityCli(process.argv.slice(2))
		.then((result) => process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`))
		.catch((error: unknown) => {
			const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
			process.stderr.write(`${message}\n`);
			process.exitCode = 1;
		});
}

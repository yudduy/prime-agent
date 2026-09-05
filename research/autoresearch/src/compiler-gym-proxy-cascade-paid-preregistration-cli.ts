import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { canonicalJson, toJsonValue } from "./canonical-json.js";
import { writeCompilerGymProxyCascadePaidPreregistration } from "./compiler-gym-proxy-cascade-paid-preregistration.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

interface CliOptions {
	repoRoot: string;
	preregistrationPath: string;
	outputDir: string | undefined;
}

function parseCli(argv: readonly string[]): CliOptions {
	let repoRoot = DEFAULT_REPO_ROOT;
	let preregistrationPath: string | undefined;
	let outputDir: string | undefined;
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!value) throw new Error(`Missing value for ${String(flag)}`);
		if (flag === "--repo-root") repoRoot = resolve(value);
		else if (flag === "--output") preregistrationPath = resolve(value);
		else if (flag === "--output-dir") outputDir = resolve(value);
		else throw new Error(`Unknown argument: ${String(flag)}`);
	}
	if (!preregistrationPath) {
		throw new Error(
			"Usage: compiler-gym-proxy-cascade-paid-preregistration-cli --output <path> [--output-dir <path>] [--repo-root <path>]",
		);
	}
	return { repoRoot, preregistrationPath, outputDir };
}

async function main(): Promise<void> {
	const options = parseCli(process.argv.slice(2));
	const written = await writeCompilerGymProxyCascadePaidPreregistration({
		repoRoot: options.repoRoot,
		path: options.preregistrationPath,
		...(options.outputDir ? { outputDir: options.outputDir } : {}),
	});
	process.stdout.write(
		`${canonicalJson(
			toJsonValue({
				path: written.path,
				sha256: written.sha256,
				scientificIdentitySha256: written.record.scientificIdentitySha256,
				armOrder: written.record.randomization.armOrder,
				classification: written.record.classification,
			}),
		)}\n`,
	);
}

await main();

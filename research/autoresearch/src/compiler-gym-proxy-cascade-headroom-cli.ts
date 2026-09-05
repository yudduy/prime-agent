import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import {
	checkCompilerGymProxyCascadeBundle,
	resolveCompilerGymProxyCascadeBundlePaths,
	writeCompilerGymProxyCascadeBundleCreateOnly,
} from "./compiler-gym-proxy-cascade-bundle.js";
import {
	analyzeCompilerGymProxyCascadeHeadroom,
	loadCompilerGymProxyCascadeSources,
} from "./compiler-gym-proxy-cascade-headroom.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_RESULT_PATH =
	".autoresearch/compiler-gym-proxy-cascade-headroom/2026-08-29-v1/replay-result.json" as const;
const DEFAULT_MANIFEST_PATH =
	".autoresearch/compiler-gym-proxy-cascade-headroom/2026-08-29-v1/replay-result.sha256" as const;

interface CliOptions {
	mode: "--write" | "--check";
	repoRoot: string;
	resultPath: string;
	manifestPath: string;
}

function parseCli(argv: readonly string[]): CliOptions {
	const mode = argv[0];
	if (mode !== "--write" && mode !== "--check") {
		throw new Error(
			"Usage: compiler-gym-proxy-cascade-headroom-cli (--write|--check) [--repo-root <path>] [--result <path>] [--manifest <path>]",
		);
	}
	let repoRoot = DEFAULT_REPO_ROOT;
	let resultPath: string = DEFAULT_RESULT_PATH;
	let manifestPath: string = DEFAULT_MANIFEST_PATH;
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!value) throw new Error(`Missing value for ${String(flag)}`);
		if (flag === "--repo-root") repoRoot = resolve(value);
		else if (flag === "--result") resultPath = value;
		else if (flag === "--manifest") manifestPath = value;
		else throw new Error(`Unknown argument: ${String(flag)}`);
	}
	return { mode, repoRoot, resultPath, manifestPath };
}

function portableRepoPath(repoRoot: string, path: string): string {
	return relative(repoRoot, path).replaceAll("\\", "/");
}

async function main(): Promise<void> {
	const options = parseCli(process.argv.slice(2));
	const sources = await loadCompilerGymProxyCascadeSources(options.repoRoot);
	const result = analyzeCompilerGymProxyCascadeHeadroom(sources);
	const resultContents = `${JSON.stringify(result, null, 2)}\n`;
	const paths = resolveCompilerGymProxyCascadeBundlePaths({
		repoRoot: options.repoRoot,
		resultPath: options.resultPath,
		manifestPath: options.manifestPath,
	});
	const manifestEntries = [
		{ path: result.pinnedLatencyAnalysis.path, sha256: result.pinnedLatencyAnalysis.sha256 },
		...result.inputLedgers.map((ledger) => ({ path: `.autoresearch/${ledger.path}`, sha256: ledger.sha256 })),
		{ path: portableRepoPath(options.repoRoot, paths.resultPath), sha256: sha256Text(resultContents) },
	].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const manifestContents = `${manifestEntries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`;
	const bundle = { ...paths, resultContents, manifestContents };
	if (options.mode === "--write") {
		await writeCompilerGymProxyCascadeBundleCreateOnly(bundle);
	} else {
		await checkCompilerGymProxyCascadeBundle(bundle);
	}
	console.log(
		JSON.stringify({
			mode: options.mode,
			resultPath: paths.resultPath,
			manifestPath: paths.manifestPath,
			trajectoryCount: result.aggregate.trajectoryCount,
			allParetoFrontiersRetained: result.aggregate.allParetoFrontiersRetained,
			skippedBzip2Evaluations: result.aggregate.skippedBzip2Evaluations,
			evaluatorTimeSavingFraction: result.aggregate.evaluatorTimeSavingFraction,
			eligibleForModelFreeSystemsQualification: result.eligibleForModelFreeSystemsQualification,
		}),
	);
}

await main();

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import {
	analyzeCompilerGymLatency,
	parseCompilerGymLatencyConfig,
	renderCompilerGymLatencyMarkdown,
} from "./compiler-gym-latency-analysis.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_CONFIG_PATH = "research/autoresearch/compiler-gym-latency-v1.analysis.json";
const ANALYSIS_FILENAME = "analysis-v1.json";
const REPORT_FILENAME = "analysis-v1.md";
const SHA_MANIFEST_FILENAME = "analysis-v1.sha256";

interface CliOptions {
	repoRoot: string;
	configPath: string;
}

function parseCli(argv: readonly string[]): CliOptions {
	let repoRoot = DEFAULT_REPO_ROOT;
	let configPath = DEFAULT_CONFIG_PATH;
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!value) {
			throw new Error("Usage: analyze-compiler-gym-latency [--repo-root <path>] [--config <path>]");
		}
		if (flag === "--repo-root") repoRoot = resolve(value);
		else if (flag === "--config") configPath = value;
		else throw new Error(`Unknown argument: ${flag}`);
	}
	return { repoRoot, configPath };
}

function resolveFromRepo(repoRoot: string, path: string): string {
	return isAbsolute(path) ? resolve(path) : resolve(repoRoot, path);
}

function portableRepoPath(repoRoot: string, path: string): string {
	return relative(repoRoot, path).replaceAll("\\", "/");
}

async function main(): Promise<void> {
	const options = parseCli(process.argv.slice(2));
	const configPath = resolveFromRepo(options.repoRoot, options.configPath);
	const configContents = await readFile(configPath, "utf8");
	const configValue: unknown = JSON.parse(configContents);
	const config = parseCompilerGymLatencyConfig(configValue);
	const ledgerRoot = resolve(options.repoRoot, config.ledgerRoot);
	const sources = await Promise.all(
		config.ledgerPaths.map(async (path) => ({
			path,
			contents: await readFile(join(ledgerRoot, path), "utf8"),
		})),
	);
	const analysis = analyzeCompilerGymLatency(config, sources);
	const analysisContents = `${JSON.stringify(analysis, null, 2)}\n`;
	const reportContents = renderCompilerGymLatencyMarkdown(analysis);
	const outputDirectory = resolve(options.repoRoot, config.outputDirectory);
	const analysisPath = join(outputDirectory, ANALYSIS_FILENAME);
	const reportPath = join(outputDirectory, REPORT_FILENAME);
	const shaManifestPath = join(outputDirectory, SHA_MANIFEST_FILENAME);
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(analysisPath, analysisContents, { encoding: "utf8", mode: 0o600 });
	await writeFile(reportPath, reportContents, { encoding: "utf8", mode: 0o600 });

	const hashEntries = [
		{
			path: portableRepoPath(options.repoRoot, configPath),
			sha256: sha256Text(configContents),
		},
		...analysis.inputLedgers.map((ledger) => ({
			path: `${config.ledgerRoot}/${ledger.path}`,
			sha256: ledger.sha256,
		})),
		{
			path: portableRepoPath(options.repoRoot, analysisPath),
			sha256: sha256Text(analysisContents),
		},
		{
			path: portableRepoPath(options.repoRoot, reportPath),
			sha256: sha256Text(reportContents),
		},
	].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const shaManifestContents = `${hashEntries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`;
	await writeFile(shaManifestPath, shaManifestContents, { encoding: "utf8", mode: 0o600 });
	await Promise.all([analysisPath, reportPath, shaManifestPath].map((path) => chmod(path, 0o600)));

	console.log(
		JSON.stringify({
			analysisPath,
			reportPath,
			shaManifestPath,
			rowCount: analysis.cohort.summary.rowCount,
			bzip2CriticalCount: analysis.cohort.summary.bzip2CriticalCount,
			medianOptimisticFusionSavingMs: analysis.cohort.summary.medianOptimisticFusionSavingMs,
			sensitivityMedianOptimisticFusionSavingMs: analysis.sensitivity.summary.medianOptimisticFusionSavingMs,
			warmMultiCandidateLedgerCount: analysis.warmAllocationHeadroom.multiCandidateLedgerCount,
			warmPostFirstCandidateCount: analysis.warmAllocationHeadroom.postFirstCandidateCount,
			warmMedianTrajectoryOptimisticFraction: analysis.warmAllocationHeadroom.medianTrajectoryOptimisticFraction,
		}),
	);
}

await main();

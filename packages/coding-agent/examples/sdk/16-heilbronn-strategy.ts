/** A bounded comparison on the open eleven-point Heilbronn construction problem. */
import { execFileSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Type } from "typebox";
import {
	AuthStorage,
	DefaultResourceLoader,
	defineTool,
	ModelBudget,
	ModelRegistry,
	runWithStrategy,
	SettingsManager,
} from "../../src/index.js";
import { checkConstruction, compareScores, exceedsScore } from "./heilbronn.js";
import { startResearchContainer } from "./research-container.js";
import { runControl } from "./strategy-controls.js";

const limits = { maxSteps: 20, maxWorkerTurns: 8, maxReviewTurns: 3, stepTimeoutMs: 180_000, runTimeoutMs: 1_200_000 };
const modelLimits = { maxRequests: 80, maxInputBytes: 4_000_000, maxReportedTokens: 300_000 };
const improvementThreshold = "0.03652989988004";
const settings = { compaction: { enabled: false }, retry: { enabled: false }, autoRefine: { enabled: false } };
const objective =
	"Discover a better construction for the open eleven-point Heilbronn triangle problem. " +
	"Place exactly 11 points in the right simplex x>=0, y>=0, x+y<=1. Maximize the minimum absolute " +
	"determinant over all 165 point triples. This is triangle area divided by the containing triangle's area, " +
	"so it equals the area score in a unit-area triangle. Start from the supplied published AlphaEvolve construction. " +
	`Seek a host-verified score above ${improvementThreshold}, then improve it further within your budget. ` +
	"You may choose and revise any mathematical representation, construction, or search algorithm. " +
	"A local optimizer's failure is evidence about that search, not proof that the construction is optimal.";
const initialContext =
	"Work only through run_command inside /app, an offline Linux container with Python, NumPy 2.3.3 and SciPy 1.16.3. " +
	"seed.json contains an exactly feasible published construction; seed-source.json contains its provenance. " +
	"score.py provides a floating exploratory score. submit_candidate performs the authoritative host check using exact " +
	"decimal arithmetic and preserves your submitted coordinates outside the container. Supply decimal strings when " +
	"precision matters. Boundary constraints have no tolerance. Only submitted constructions count in the final result. " +
	"All work processes are killed after each command; files persist. Each command has 60 seconds, one CPU, and 2 GiB. " +
	"Save progress during long searches and split them into commands. No background work survives a command. " +
	"The full attempt has 20 minutes, 80 model requests, 4,000,000 cumulative input bytes, and a 300,000 reported-token " +
	"threshold including repeated/cached input. The first limit reached stops work; one response can overshoot the token threshold. " +
	"Return report_result after each bounded step, with needsReview=true when work remains. Stop only if further pursuit " +
	"is not worthwhile or you are finished. Report failed searches and conflicting evidence. The starting score is not a discovery.";
const scoreScript = `import itertools, json, sys
import numpy as np

def score(points):
    points = np.asarray(points, dtype=float)
    if points.shape != (11, 2) or not np.isfinite(points).all():
        raise ValueError("Expected eleven finite coordinate pairs")
    if (points < 0).any() or (points.sum(axis=1) > 1).any():
        raise ValueError("Point outside the simplex")
    areas = []
    for i, j, k in itertools.combinations(range(11), 3):
        a, b = points[j] - points[i], points[k] - points[i]
        areas.append(abs(a[0] * b[1] - a[1] * b[0]))
    return float(min(areas))

if __name__ == "__main__":
    with open(sys.argv[1]) as stream:
        value = json.load(stream)
    print(json.dumps({"exploratory_score": score(value.get("points") if isinstance(value, dict) else value)}))
`;

function hash(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			"seed-file": { type: "string" },
			image: { type: "string" },
			"output-dir": { type: "string" },
			model: { type: "string", default: "gpt-5.5" },
			"preflight-only": { type: "boolean" },
			help: { type: "boolean" },
		},
	});
	if (values.help) {
		console.log(
			"Usage: npx tsx --tsconfig ../../tsconfig.json examples/sdk/16-heilbronn-strategy.ts --seed-file /path/to/published-points.json --image sha256:IMAGE_ID --output-dir /path/to/runs [--model gpt-5.5] [--preflight-only]",
		);
		return;
	}
	if (!values["seed-file"] || !values.image || !values["output-dir"])
		throw new Error("Provide seed, image, and output directory.");
	const seedSource = await readFile(resolve(values["seed-file"]), "utf8");
	const seed: unknown = JSON.parse(seedSource);
	if (!seed || typeof seed !== "object" || !("points" in seed)) throw new Error("Seed source must contain points.");
	const seedPoints: unknown = seed.points;
	const baseline = checkConstruction(seedPoints);
	if (!baseline.valid || !exceedsScore(baseline, "0.03652988987") || exceedsScore(baseline, "0.03652988989"))
		throw new Error("Seed does not reproduce the published starting construction.");
	await mkdir(resolve(values["output-dir"]), { recursive: true });
	const outputDir = await mkdtemp(join(resolve(values["output-dir"]), "heilbronn-"));
	const filesDir = join(outputDir, "input");
	await mkdir(filesDir);
	await writeFile(join(filesDir, "seed.json"), JSON.stringify(seedPoints, null, 2));
	await writeFile(join(filesDir, "seed-source.json"), seedSource);
	await writeFile(join(filesDir, "score.py"), scoreScript);
	const save = (directory: string, name: string, value: unknown) =>
		writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
	const order = [1, 2].flatMap((pair) =>
		(randomInt(2) ? ["strategy", "continuous"] : ["continuous", "strategy"]).map((mode) => ({ pair, mode })),
	);
	const sourceDir = fileURLToPath(new URL(".", import.meta.url));
	const sourceFiles = [
		"16-heilbronn-strategy.ts",
		"heilbronn.ts",
		"research-container.ts",
		"strategy-controls.ts",
		"terminal-bench.ts",
		"heilbronn.Dockerfile",
		"../../src/core/strategy/index.ts",
		"../../src/core/strategy/budget.ts",
		"../../src/core/strategy/session.ts",
	];
	const sourceHashes = Object.fromEntries(
		await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(join(sourceDir, file)))])),
	);
	await save(outputDir, "config.json", {
		createdAt: new Date().toISOString(),
		objective,
		initialContext,
		image: values.image,
		seedHash: hash(seedSource),
		baseline,
		improvementThreshold,
		model: { provider: "openai-codex", id: values.model, thinkingLevel: "high", serviceTier: "default" },
		limitsPerAttempt: limits,
		modelLimitsPerAttempt: modelLimits,
		order,
		sourceHashes,
		commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceDir, encoding: "utf8" }).trim(),
		interpretation:
			"Two attempts per condition on one open problem. Measures this entire strategy loop against continuous work; does not isolate fresh context, prove general superiority, or certify global optimality. No improvement means no observed discovery within this budget. No automatic expansion.",
		source: "https://math.tejstead.com/heilbronn/triangle/11/points.json",
		preflightOnly: values["preflight-only"] ?? false,
	});
	const cancellation = new AbortController();
	const cancel = () => cancellation.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	let progress: () => object = () => ({ state: "preflight" });
	const writeStatus = () => {
		writeFileSync(
			join(outputDir, "status.json.tmp"),
			JSON.stringify({ ...progress(), updatedAt: new Date().toISOString(), pid: process.pid }),
		);
		renameSync(join(outputDir, "status.json.tmp"), join(outputDir, "status.json"));
	};
	writeStatus();
	const heartbeat = setInterval(writeStatus, 5_000);
	console.log(`Saved experiment: ${outputDir}`);
	try {
		const preflightDir = join(outputDir, "preflight");
		const container = await startResearchContainer({
			image: values.image,
			name: `prime-heilbronn-${randomUUID()}`,
			outputDir: preflightDir,
			filesDir,
			signal: cancellation.signal,
		});
		try {
			const check = await container.execute(
				"python score.py seed.json && python -c 'import scipy; print(scipy.__version__)'",
			);
			if (check.exitCode !== 0) throw new Error(`Container preflight failed: ${check.stderr}`);
			const floatingScore: unknown = JSON.parse(check.stdout.split("\n")[0]);
			if (
				!floatingScore ||
				typeof floatingScore !== "object" ||
				!("exploratory_score" in floatingScore) ||
				typeof floatingScore.exploratory_score !== "number" ||
				Math.abs(floatingScore.exploratory_score - (baseline.score ?? 0)) > 1e-14
			)
				throw new Error("Floating and exact seed checks disagree.");
			await container.snapshot(join(preflightDir, "artifacts"));
			await save(preflightDir, "result.json", { passed: true, baseline, check });
		} finally {
			await container.dispose();
		}
		if (values["preflight-only"]) {
			progress = () => ({ state: "preflight_passed" });
			return;
		}
		const authStorage = AuthStorage.create();
		const modelRegistry = ModelRegistry.create(authStorage);
		const model = (await modelRegistry.getExecutableModels()).find(
			(candidate) => candidate.provider === "openai-codex" && candidate.id === values.model,
		);
		if (!model) throw new Error("Selected Codex model is not executable for this account.");
		for (const [index, { pair, mode }] of order.entries()) {
			cancellation.signal.throwIfAborted();
			const trialDir = join(outputDir, `${index + 1}-pair-${pair}-${mode}`);
			const workAbort = new AbortController();
			const signal = AbortSignal.any([cancellation.signal, workAbort.signal]);
			const container = await startResearchContainer({
				image: values.image,
				name: `prime-heilbronn-${randomUUID()}`,
				outputDir: trialDir,
				filesDir,
				signal: cancellation.signal,
			});
			let submissions = 0;
			let best = baseline;
			let bestId = "baseline";
			let firstImprovementMs: number | null = null;
			const modelBudget = new ModelBudget(modelLimits);
			const started = Date.now();
			const timer = setTimeout(() => workAbort.abort(), limits.runTimeoutMs);
			const remaining = () => ({
				milliseconds: Math.max(0, limits.runTimeoutMs - (Date.now() - started)),
				requests: Math.max(0, modelLimits.maxRequests - modelBudget.usage.requests),
				reportedTokens: Math.max(0, modelLimits.maxReportedTokens - modelBudget.usage.reportedTokens),
			});
			const update = () => {
				progress = () => ({
					state: "running",
					attempt: index + 1,
					totalAttempts: order.length,
					pair,
					mode,
					trialDir,
					elapsedMs: Date.now() - started,
					best,
					bestId,
					submissions,
					modelBudget: modelBudget.usage,
				});
				writeStatus();
			};
			update();
			console.log(`Running pair ${pair}: ${mode}`);
			try {
				const candidateDir = join(trialDir, "candidates");
				await mkdir(candidateDir);
				await save(candidateDir, "baseline.json", { points: seedPoints, check: baseline });
				const runCommand = defineTool({
					name: "run_command",
					label: "Run command",
					description:
						"Run a command in the offline research container for at most 60 seconds. All processes end when the command returns; files persist.",
					parameters: Type.Object({ command: Type.String({ minLength: 1 }) }),
					async execute(_id, params, toolSignal) {
						const result = await container.execute(params.command, toolSignal).catch(async (error: unknown) => {
							await appendFile(
								join(trialDir, "commands.jsonl"),
								`${JSON.stringify({ elapsedMs: Date.now() - started, command: params.command, error: error instanceof Error ? error.message : String(error) })}\n`,
							);
							throw error;
						});
						await appendFile(
							join(trialDir, "commands.jsonl"),
							`${JSON.stringify({ elapsedMs: Date.now() - started, command: params.command, result })}\n`,
						);
						update();
						return {
							content: [{ type: "text", text: JSON.stringify({ ...result, remaining: remaining() }) }],
							details: result,
						};
					},
				});
				const submitCandidate = defineTool({
					name: "submit_candidate",
					label: "Submit construction",
					description:
						"Check and preserve eleven points with exact decimal arithmetic on the host. Supply decimal strings for precision. This is the authoritative score, and only submitted candidates count.",
					parameters: Type.Object({
						points: Type.Array(
							Type.Array(Type.Union([Type.Number(), Type.String({ maxLength: 80 })]), {
								minItems: 2,
								maxItems: 2,
							}),
							{ minItems: 11, maxItems: 11 },
						),
						note: Type.String({ maxLength: 2000 }),
					}),
					async execute(_id, params, toolSignal) {
						toolSignal?.throwIfAborted();
						signal.throwIfAborted();
						const check = checkConstruction(params.points);
						const id = `candidate-${++submissions}`;
						const elapsedMs = Date.now() - started;
						await save(candidateDir, `${id}.json`, { id, elapsedMs, ...params, check });
						if (compareScores(check, best) > 0) {
							best = check;
							bestId = id;
						}
						if (firstImprovementMs === null && exceedsScore(check, improvementThreshold))
							firstImprovementMs = elapsedMs;
						const result = {
							id,
							check,
							best,
							bestId,
							meaningfulImprovement: exceedsScore(check, improvementThreshold),
							remaining: remaining(),
						};
						await appendFile(
							join(trialDir, "submissions.jsonl"),
							`${JSON.stringify({ elapsedMs, ...result })}\n`,
						);
						update();
						return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
					},
				});
				const cwd = join(trialDir, "workspace");
				const agentDir = join(trialDir, "agent");
				await mkdir(cwd);
				const resourceLoader = new DefaultResourceLoader({
					cwd,
					agentDir,
					settingsManager: SettingsManager.inMemory(settings),
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					agentsFilesOverride: () => ({ agentsFiles: [] }),
					systemPromptOverride: () =>
						"You research a mathematical construction using the supplied tools in an isolated CPU container. Preserve observations and distinguish conjectures from verified results.",
				});
				await resourceLoader.reload();
				const customTools = [runCommand, submitCandidate];
				const context = `${initialContext}\nFor reproducible computational searches use seed ${2026090600 + pair} and record any changes to it.\nStarting points: ${JSON.stringify(seedPoints)}`;
				const sessionOptions = {
					cwd,
					agentDir,
					authStorage,
					modelRegistry,
					model,
					resourceLoader,
					thinkingLevel: "high" as const,
					serviceTier: "default" as const,
					tools: customTools.map((tool) => tool.name),
					allowedToolNames: customTools.map((tool) => tool.name),
					customTools,
				};
				const result =
					mode === "strategy"
						? await runWithStrategy({
								...sessionOptions,
								task: {
									objective,
									successCriteria: `A submitted exactly feasible construction scores above ${improvementThreshold}.`,
									initialContext: context,
									tools: [],
									createTools: () => customTools,
								},
								settings,
								limits,
								modelBudget,
								outputDir: trialDir,
								signal,
								onEvent: () => update(),
							})
						: await runControl({
								mode: "continuous",
								sessionOptions,
								objective,
								initialContext: context,
								modelBudget,
								outputDir: trialDir,
								signal,
								maxSteps: limits.maxSteps,
								maxTurns: limits.maxWorkerTurns,
								stepTimeoutMs: limits.stepTimeoutMs,
							});
				clearTimeout(timer);
				await save(trialDir, "agent-result.json", result);
				await copyFile(join(candidateDir, `${bestId}.json`), join(trialDir, "best.json"));
				await container.snapshot(join(trialDir, "artifacts"));
				const runtimeError =
					result.stopReason === "error" ||
					(modelBudget.usage.unreportedRequests > 0 && !workAbort.signal.aborted && !cancellation.signal.aborted);
				const summary = {
					pair,
					mode,
					status: runtimeError ? "runtime_error" : cancellation.signal.aborted ? "cancelled" : "completed",
					best,
					bestId,
					meaningfulImprovement: exceedsScore(best, improvementThreshold),
					firstImprovementMs,
					submissions,
					elapsedMs: Date.now() - started,
					stopReason: result.stopReason,
					timeLimitReached: workAbort.signal.aborted,
					modelBudget: modelBudget.usage,
					usageComplete: modelBudget.usage.unreportedRequests === 0,
					usage: result.usage,
					trialDir,
				};
				await save(trialDir, "result.json", summary);
				await appendFile(join(outputDir, "results.jsonl"), `${JSON.stringify(summary)}\n`);
				console.log(JSON.stringify(summary));
				if (runtimeError) throw new Error("Runtime or usage accounting failed; remaining attempts stopped.");
				cancellation.signal.throwIfAborted();
			} finally {
				clearTimeout(timer);
				await container.dispose();
			}
		}
		progress = () => ({ state: "completed", attempts: order.length });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		progress = () => ({ state: cancellation.signal.aborted ? "cancelled" : "error", error: message });
		await save(outputDir, "failure.json", { message });
		throw error;
	} finally {
		clearInterval(heartbeat);
		writeStatus();
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

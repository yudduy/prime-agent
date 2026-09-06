/** One bounded comparison starting from a saved minimum-overlap construction. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { startResearchContainer } from "../../../packages/coding-agent/examples/sdk/research-container.js";
import { runControl } from "../../../packages/coding-agent/examples/sdk/strategy-controls.js";
import { runProcess } from "../../../packages/coding-agent/examples/sdk/terminal-bench.js";
import {
	AuthStorage,
	DefaultResourceLoader,
	defineTool,
	ModelBudget,
	ModelRegistry,
	runWithStrategy,
	SettingsManager,
} from "../../../packages/coding-agent/src/index.js";
import { createHarness } from "../../../packages/coding-agent/test/suite/harness.js";
import { checkConstruction, compareScores, improvesBaseline } from "./checker/overlap.js";
import { loadCodexAccount } from "./codex-account.js";

export const overlapLimits = {
	maxSteps: 3,
	maxWorkerTurns: 4,
	maxReviewTurns: 3,
	stepTimeoutMs: 480_000,
	runTimeoutMs: 480_000,
};
const modelLimits = {
	maxRequests: 12,
	maxInputBytes: 1_200_000,
	maxReportedTokens: 150_000,
};
const minimumGain = "0.000000001";
const settings = {
	compaction: { enabled: false },
	retry: { enabled: false },
	autoRefine: { enabled: false },
};
const objective =
	"Improve the supplied construction for the open Erdos minimum overlap problem. " +
	"For N equal bins on [-1,1], choose heights a_i in [0,1] with sum(a_i)=N/2 exactly. " +
	"Minimize Q=(2/N)*max_k sum_{i:0<=i,i+k<N} a_i*(1-a_{i+k}), over ALL signed shifts k=-(N-1)..N-1. " +
	"This finite maximum equals the continuous supremum for this step function, since overlap is linear between grid shifts. " +
	"Start from the supplied independently checked 3584-cell construction from public submission 2507 by CodexProLong. " +
	"Seek an exactly valid submitted Q at least 1e-9 below its frozen starting score. N may be any integer 2..4096. " +
	"You may revise representations and algorithms. Failure of a numerical search does not prove optimality.";
const initialContext =
	"Use run_command inside /app, an offline container with Python, NumPy 2.3.3 and SciPy 1.16.3. " +
	"seed.json contains decimal strings for the exactly admissible baseline; seed-source.json records its provenance and tiny mass repair. " +
	"score.py provides floating exploratory scores and save_candidate(values,path), which balances mass errors up to 1e-6 and writes decimal strings. " +
	"Host checking neither clips nor normalizes: candidates must satisfy box and mass constraints exactly. " +
	"submit_candidate accepts a JSON filename in /app, reads the saved vector after work is stopped, and checks exact arithmetic on the host. " +
	"Only submitted candidates count. Each command has 60 seconds, one CPU and 2 GiB. Processes stop afterwards; files persist. " +
	"Each arm has 8 minutes, 12 model requests,1,200,000 cumulative input bytes and 150,000 reported tokens INCLUDING review and cached input. " +
	"One response may overshoot the token threshold. Each work step allows 4 completed assistant turns; up to 3 steps. " +
	"Call report_result within the step, needsReview=true if work remains. Preserve failed experiments and distinguish observations from conjectures. " +
	"The baseline is an existing artifact, not a new discovery; no global record or optimum claim follows from a small improvement.";
const scoreScript = `import json, sys
from decimal import Decimal, localcontext
import numpy as np

def score(values):
    a = np.asarray(values, dtype=float)
    if a.ndim != 1 or not 2 <= len(a) <= 4096 or not np.isfinite(a).all():
        raise ValueError("Expected 2..4096 finite values")
    q = float(2 / len(a) * np.correlate(a, 1-a, mode='full').max())
    return {"exploratory_score": q, "mass_error": float(a.sum()-len(a)/2), "minimum": float(a.min()), "maximum": float(a.max())}

def save_candidate(values, path="candidate.json"):
    with localcontext() as ctx:
        ctx.prec = 90
        a = [Decimal(x) if isinstance(x, str) else Decimal(format(float(x), '.17g')) for x in values]
        if not 2 <= len(a) <= 4096 or any(not x.is_finite() or x<0 or x>1 for x in a):
            raise ValueError("Invalid box values; no clipping performed")
        residual = Decimal(len(a))/2-sum(a)
        if abs(residual)>Decimal("0.000001"):
            raise ValueError("Mass error exceeds 1e-6; repair feasibility before saving")
        for i in range(len(a)):
            change = min(residual, 1-a[i]) if residual>=0 else max(residual, -a[i])
            a[i] += change
            residual -= change
            if residual == 0: break
        if residual != 0 or sum(a) != Decimal(len(a))/2:
            raise ValueError("Could not satisfy exact mass")
        result = [format(x, 'f') for x in a]
    with open(path, 'w') as stream: json.dump(result, stream)
    return score(result)

if __name__ == '__main__':
    with open(sys.argv[1]) as stream: value=json.load(stream)
    print(json.dumps(score(value)))
`;

function hash(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

async function readCandidate(
	trialDir: string,
	filename: string,
	destination: string,
	signal?: AbortSignal,
): Promise<unknown> {
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*[.]json$/.test(filename) || filename.length > 120)
		throw new Error("Use a simple JSON filename in /app.");
	const metadata = JSON.parse(await readFile(join(trialDir, "container.json"), "utf8")) as { id: string };
	if (!/^[a-f0-9]{64}$/.test(metadata.id)) throw new Error("Missing owned container ID");
	const copied = await runProcess(
		process.env.DOCKER ?? "/usr/local/bin/docker",
		["cp", `${metadata.id}:/app/${filename}`, destination],
		{ timeoutMs: 10_000, signal },
	);
	if (copied.exitCode !== 0) throw new Error(`Candidate copy failed: ${copied.stderr}`);
	const info = await lstat(destination);
	if (!info.isFile() || info.size > 524_288) throw new Error("Candidate must be a regular JSON file below 512 KiB.");
	return JSON.parse(await readFile(destination, "utf8"));
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			"seed-file": { type: "string" },
			image: { type: "string" },
			"output-dir": { type: "string" },
			model: { type: "string", default: "gpt-5.5" },
			"codex-auth-file": { type: "string" },
			"preflight-only": { type: "boolean" },
			"dry-run": { type: "boolean" },
			help: { type: "boolean" },
		},
	});
	if (values.help) {
		console.log(
			"Usage: npx tsx --tsconfig /path/to/prime/tsconfig.json research/strategy/minimum-overlap/run.mts --seed-file /path/to/prepared-baseline.json --image sha256:IMAGE_ID --output-dir /path/to/runs [--model gpt-5.5] [--codex-auth-file /path/to/codex/auth.json] [--preflight-only | --dry-run]",
		);
		return;
	}
	if (!values["seed-file"] || !values.image || !values["output-dir"])
		throw new Error("Provide seed, image, and output directory.");
	const seedSource = await readFile(resolve(values["seed-file"]), "utf8");
	const seed: unknown = JSON.parse(seedSource);
	if (!seed || typeof seed !== "object" || !("values" in seed)) throw new Error("Seed source must contain values.");
	const seedValues: unknown = seed.values;
	const baseline = checkConstruction(seedValues);
	if (!baseline.valid || baseline.score === null || baseline.score < 0.38085857485 || baseline.score > 0.38085857487)
		throw new Error("Seed does not reproduce the independently checked source construction.");
	await mkdir(resolve(values["output-dir"]), { recursive: true });
	const outputDir = await mkdtemp(join(resolve(values["output-dir"]), "overlap-"));
	const filesDir = join(outputDir, "input");
	await mkdir(filesDir);
	await writeFile(join(filesDir, "seed.json"), JSON.stringify(seedValues, null, 2));
	await writeFile(join(filesDir, "seed-source.json"), seedSource);
	await writeFile(join(filesDir, "score.py"), scoreScript);
	const save = (directory: string, name: string, value: unknown) =>
		writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, {
			flag: "wx",
		});
	const order = [1].flatMap((pair) =>
		(randomInt(2) ? ["strategy", "continuous"] : ["continuous", "strategy"]).map((mode) => ({ pair, mode })),
	);
	const sourceDir = fileURLToPath(new URL("../../../", import.meta.url));
	const sourceFiles = [
		fileURLToPath(import.meta.url),
		fileURLToPath(new URL("./checker/overlap.ts", import.meta.url)),
		fileURLToPath(new URL("./codex-account.ts", import.meta.url)),
		...["index.ts", "budget.ts", "session.ts", "evidence.ts"].map((name) =>
			join(sourceDir, "packages/coding-agent/src/core/strategy", name),
		),
		...["research-container.ts", "strategy-controls.ts", "terminal-bench.ts"].map((name) =>
			join(sourceDir, "packages/coding-agent/examples/sdk", name),
		),
	];
	const sourceHashes = Object.fromEntries(
		await Promise.all(sourceFiles.map(async (file) => [file, hash(await readFile(file))])),
	);

	await save(outputDir, "config.json", {
		createdAt: new Date().toISOString(),
		protocolVersion: 1,
		protocolChange: "One new problem with a current public construction; unchanged production strategy policy.",
		objective,
		initialContext,
		image: values.image,
		seedHash: hash(seedSource),
		baseline,
		minimumGain,
		authenticationSource: values["dry-run"]
			? "faux"
			: values["preflight-only"]
				? "none"
				: values["codex-auth-file"]
					? "selected_codex_account"
					: "prime_configuration",
		model: {
			provider: "openai-codex",
			id: values.model,
			thinkingLevel: "high",
			serviceTier: "default",
		},
		limitsPerAttempt: overlapLimits,
		modelLimitsPerAttempt: modelLimits,
		order,
		sourceHashes,
		commit: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: sourceDir,
			encoding: "utf8",
		}).trim(),
		interpretation:
			"One attempt per condition on one open problem. Measures the full production strategy policy including review overhead against continuous work. No causal claim about review alone, general superiority, or global optimality. No improvement means no observed discovery within this allocation. No retries or automatic expansion.",
		source: "https://einsteinarena.com/api/solutions/best?problem_id=1&agent_name=CodexProLong&limit=1",
		preflightOnly: values["preflight-only"] ?? false,
		dryRun: values["dry-run"] ?? false,
	});
	const cancellation = new AbortController();
	const cancel = () => cancellation.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	let progress: () => object = () => ({ state: "preflight" });
	const writeStatus = () => {
		writeFileSync(
			join(outputDir, "status.json.tmp"),
			JSON.stringify({
				...progress(),
				updatedAt: new Date().toISOString(),
				pid: process.pid,
			}),
		);
		renameSync(join(outputDir, "status.json.tmp"), join(outputDir, "status.json"));
	};
	writeStatus();
	const heartbeat = setInterval(writeStatus, 5_000);
	console.log(`Saved experiment: ${outputDir}`);
	let harness: Awaited<ReturnType<typeof createHarness>> | undefined;
	try {
		const preflightDir = join(outputDir, "preflight");
		const container = await startResearchContainer({
			image: values.image,
			name: `prime-overlap-${randomUUID()}`,
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
			const extracted = await readCandidate(
				preflightDir,
				"seed.json",
				join(preflightDir, "extracted.json"),
				cancellation.signal,
			);
			if (JSON.stringify(extracted) !== JSON.stringify(seedValues))
				throw new Error("Extracted seed differs from input.");
			await container.snapshot(join(preflightDir, "artifacts"));
			await save(preflightDir, "result.json", {
				passed: true,
				baseline,
				check,
			});
		} finally {
			await container.dispose();
		}
		if (values["preflight-only"]) {
			progress = () => ({ state: "preflight_passed" });
			return;
		}
		harness = values["dry-run"] ? await createHarness() : undefined;
		const authStorage =
			harness?.authStorage ??
			(values["codex-auth-file"]
				? await loadCodexAccount(values["codex-auth-file"], Date.now() + 2 * overlapLimits.runTimeoutMs + 120_000)
				: AuthStorage.create());
		const modelRegistry =
			harness?.session.modelRegistry ??
			(values["codex-auth-file"] ? ModelRegistry.inMemory(authStorage) : ModelRegistry.create(authStorage));
		const model =
			harness?.getModel() ??
			(await modelRegistry.getExecutableModels()).find(
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
				name: `prime-overlap-${randomUUID()}`,
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
			const timer = setTimeout(() => workAbort.abort(), overlapLimits.runTimeoutMs);
			const remaining = () => ({
				milliseconds: Math.max(0, overlapLimits.runTimeoutMs - (Date.now() - started)),
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
				await save(candidateDir, "baseline.json", {
					values: seedValues,
					check: baseline,
				});
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
							content: [
								{
									type: "text",
									text: JSON.stringify({ ...result, remaining: remaining() }),
								},
							],
							details: result,
						};
					},
				});
				const submitCandidate = defineTool({
					name: "submit_candidate",
					label: "Submit construction",
					description:
						"Read a JSON vector from a simple filename in /app and preserve its exact host check. File must contain 2..4096 decimal values, with exact sum=N/2 and all values in [0,1]. Lower Q is better. Only submitted files count.",
					parameters: Type.Object({
						filename: Type.String({
							pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]*[.]json$",
							maxLength: 120,
						}),
						note: Type.String({ maxLength: 2000 }),
					}),
					async execute(_id, params, toolSignal) {
						toolSignal?.throwIfAborted();
						signal.throwIfAborted();
						const id = `candidate-${++submissions}`;
						const candidateValues = await readCandidate(
							trialDir,
							params.filename,
							join(candidateDir, `${id}.values.json`),
							toolSignal,
						);
						const check = checkConstruction(candidateValues);
						const requireActiveAllocation = () => {
							toolSignal?.throwIfAborted();
							signal.throwIfAborted();
							if (Date.now() - started >= overlapLimits.runTimeoutMs)
								throw new Error("The allocation deadline passed before candidate acceptance.");
						};
						requireActiveAllocation();
						await save(candidateDir, `${id}.json`, {
							id,
							checkedElapsedMs: Date.now() - started,
							...params,
							values: candidateValues,
							check,
						});
						requireActiveAllocation();
						const elapsedMs = Date.now() - started;
						if (compareScores(check, best) > 0) {
							best = check;
							bestId = id;
						}
						if (firstImprovementMs === null && improvesBaseline(check, baseline, minimumGain))
							firstImprovementMs = elapsedMs;
						const result = {
							id,
							check,
							best,
							bestId,
							meaningfulImprovement: improvesBaseline(check, baseline, minimumGain),
							remaining: remaining(),
						};
						await appendFile(
							join(trialDir, "submissions.jsonl"),
							`${JSON.stringify({ elapsedMs, ...result })}\n`,
						);
						update();
						return {
							content: [{ type: "text", text: JSON.stringify(result) }],
							details: result,
						};
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
				const context = `${initialContext}\nFor reproducible computational searches use seed ${2026090600 + pair} and record any changes to it.\nThe full seed vector is in /app/seed.json; frozen score=${baseline.score}.`;
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
				if (harness) {
					const report = {
						changes: "Fixture only",
						observations: ["No mathematical improvement"],
						artifacts: ["fixture.json"],
						unresolved: [],
						needsReview: false,
						evidenceIds: [],
					};
					const responses = [
						fauxAssistantMessage(
							fauxToolCall("run_command", {
								command:
									'python -c \'import json; from score import save_candidate; save_candidate(json.load(open("seed.json")),"fixture.json")\'',
							}),
							{ stopReason: "toolUse" },
						),
						fauxAssistantMessage(
							fauxToolCall("submit_candidate", {
								filename: "fixture.json",
								note: "Fixture seed re-submission",
							}),
							{ stopReason: "toolUse" },
						),
						fauxAssistantMessage(
							[
								fauxToolCall("report_result", report),
								fauxToolCall("run_command", {
									command: "touch forbidden-after-report",
								}),
							],
							{ stopReason: "toolUse" },
						),
					];
					harness.setResponses(
						mode === "strategy"
							? [
									fauxAssistantMessage(
										fauxToolCall("choose_strategy", {
											action: "start",
											approach: "Fixture",
											reason: "Fixture",
											nextStep: "Run the fixture and report",
											expectedEvidence: "Fixture receipt",
											reviewWhen: "After fixture",
											alternative: "Another fixture",
											concern: "Not research",
											evidenceIds: [],
										}),
										{ stopReason: "toolUse" },
									),
									...responses,
									fauxAssistantMessage(
										fauxToolCall("choose_strategy", {
											action: "stop",
											reason: "Fixture done",
											evidenceIds: [],
										}),
										{ stopReason: "toolUse" },
									),
								]
							: responses,
					);
				}
				const result =
					mode === "strategy"
						? await runWithStrategy({
								...sessionOptions,
								task: {
									objective,
									successCriteria: `A submitted exactly feasible construction improves the frozen baseline by at least ${minimumGain}; lower Q is better.`,
									initialContext: context,
									tools: [],
									createTools: () => customTools,
								},
								settings,
								limits: overlapLimits,
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
								maxSteps: overlapLimits.maxSteps,
								maxTurns: overlapLimits.maxWorkerTurns,
								stepTimeoutMs: overlapLimits.stepTimeoutMs,
							});
				clearTimeout(timer);
				await save(trialDir, "agent-result.json", result);
				await copyFile(join(candidateDir, `${bestId}.json`), join(trialDir, "best.json"));
				await container.snapshot(join(trialDir, "artifacts"));
				if (harness) {
					assert.equal(harness.getPendingResponseCount(), 0);
					assert.equal(submissions, 1);
					assert.equal(compareScores(best, baseline), 0);
					assert.equal(modelBudget.usage.unreportedRequests, 0);
					await assert.rejects(lstat(join(trialDir, "artifacts/forbidden-after-report")));
				}
				const runtimeError = result.stopReason === "error" || modelBudget.usage.unreportedRequests > 0;
				const summary = {
					pair,
					mode,
					status: runtimeError ? "runtime_error" : cancellation.signal.aborted ? "cancelled" : "completed",
					best,
					bestId,
					meaningfulImprovement: improvesBaseline(best, baseline, minimumGain),
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
		progress = () => ({
			state: cancellation.signal.aborted ? "cancelled" : "error",
			error: message,
		});
		await save(outputDir, "failure.json", { message });
		throw error;
	} finally {
		harness?.cleanup();
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

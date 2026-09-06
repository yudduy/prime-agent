/** A capped local pilot using official Terminal-Bench assets, without Harbor. */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Type } from "typebox";
import { getAgentDir } from "../../src/config.js";
import {
	AuthStorage,
	DefaultResourceLoader,
	defineTool,
	ModelBudget,
	ModelRegistry,
	runWithStrategy,
	SettingsManager,
} from "../../src/index.js";
import { runControl } from "./strategy-controls.js";
import { runProcess, startTask } from "./terminal-bench.js";

const revision = "7131e4375048a0e408a8fb404b5f499d726b695b";
const tasks = [
	{
		name: "log-summary-date-ranges",
		image: "alexgshaw/log-summary-date-ranges@sha256:cbeb6ba905c2fec294f16cd5e16e3ea7f2e04d38ac2484d51a11de262aa7dc51",
	},
	{
		name: "cancel-async-tasks",
		image: "alexgshaw/cancel-async-tasks@sha256:84c7fae6b256dcc56a350790e2a9715eefc7dad662a9d8e8a472363aa71ef18d",
	},
];
const modelLimits = { maxRequests: 12, maxInputBytes: 400_000, maxReportedTokens: 30_000 };
const limits = { maxSteps: 3, maxWorkerTurns: 4, maxReviewTurns: 2, stepTimeoutMs: 90_000, runTimeoutMs: 180_000 };
const settings = { compaction: { enabled: false }, retry: { enabled: false }, autoRefine: { enabled: false } };
const initialContext =
	"Use run_command to run shell commands in the isolated task container. Work in /app. " +
	"Each command has a 30-second limit. Network access is disabled during work. Do not start background jobs. " +
	"Use only the task instructions and files available inside the container. You may write and run your own checks. " +
	"The independent final verifier is unavailable during work. Report claims honestly, including failed checks. " +
	"Return report_result with needsReview=true if more work remains; false only when you believe the task is complete.";

async function fileHashes(directory: string, relative = ""): Promise<Record<string, string>> {
	const hashes: Record<string, string> = {};
	for (const item of await readdir(join(directory, relative), { withFileTypes: true })) {
		const path = join(relative, item.name);
		if (item.isDirectory()) Object.assign(hashes, await fileHashes(directory, path));
		else if (item.isFile())
			hashes[path] = createHash("sha256")
				.update(await readFile(join(directory, path)))
				.digest("hex");
	}
	return hashes;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			"tasks-dir": { type: "string" },
			"output-dir": { type: "string" },
			"preflight-only": { type: "boolean" },
			help: { type: "boolean" },
		},
	});
	if (values.help) {
		console.log(
			"Usage: npx tsx --tsconfig ../../tsconfig.json examples/sdk/15-strategy-pilot.ts --tasks-dir /path/to/terminal-bench-2-1/tasks --output-dir /path/to/results [--preflight-only]",
		);
		return;
	}
	if (!values["tasks-dir"] || !values["output-dir"]) throw new Error("Provide --tasks-dir and --output-dir.");
	const tasksDir = resolve(values["tasks-dir"]);
	const currentRevision = execFileSync("git", ["-C", tasksDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	if (currentRevision !== revision) throw new Error(`Task source must be pinned to ${revision}.`);
	execFileSync("git", ["-C", tasksDir, "diff", "--exit-code", "HEAD", "--", ...tasks.map((task) => task.name)]);
	const parentDir = resolve(values["output-dir"]);
	await mkdir(parentDir, { recursive: true });
	const outputDir = await mkdtemp(join(parentDir, "pilot-"));
	const cancellation = new AbortController();
	const cancel = () => cancellation.abort();
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	const save = (name: string, value: unknown) =>
		writeFile(join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
	console.log(`Saved pilot: ${outputDir}`);
	const configured = SettingsManager.create(process.cwd(), getAgentDir());
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find(configured.getDefaultProvider() ?? "", configured.getDefaultModel() ?? "");
	if (!values["preflight-only"] && (!model || model.provider !== "openai-codex")) {
		throw new Error("This pilot requires a configured Codex model; its SSE retry accounting is covered by tests.");
	}
	try {
		await save("config.json", {
			revision,
			tasks: await Promise.all(
				tasks.map(async (task) => ({ ...task, files: await fileHashes(join(tasksDir, task.name)) })),
			),
			model: model ? { provider: model.provider, id: model.id } : undefined,
			thinkingLevel: "low",
			serviceTier: "default",
			modelLimits,
			limits,
			conditions: ["continuous", "fresh", "strategy"],
			initialContext,
			interpretation:
				"One attempt per condition on two tasks. Operational pilot only; no efficiency or strategy-superiority inference.",
			protocolChanges: [
				"180-second agent cap",
				"Network disabled during solving",
				"Direct Docker driver instead of Harbor",
				"Fresh control resets after each bounded step, possibly before four turns when it reports early",
			],
			oracleSetup:
				"The log oracle's redundant apt installation is replaced by checking that grep and date exist. Solution logic and final tests are unchanged.",
		});
		for (const task of tasks) {
			for (const kind of ["blank", "oracle"] as const) {
				cancellation.signal.throwIfAborted();
				console.log(`Preflight ${task.name}: ${kind}`);
				const trialDir = join(outputDir, `${task.name}-${kind}`);
				const containerName = `prime-pilot-${randomUUID()}`;
				const container = await startTask({
					...task,
					taskDir: join(tasksDir, task.name),
					name: containerName,
					outputDir: trialDir,
					signal: cancellation.signal,
				});
				try {
					if (kind === "oracle") {
						const solution = (await readFile(join(tasksDir, task.name, "solution", "solve.sh"), "utf8")).replace(
							"apt-get update && apt-get install -y grep coreutils",
							"command -v grep && command -v date",
						);
						const applied = await runProcess(
							process.env.DOCKER ?? "/usr/local/bin/docker",
							["exec", containerName, "/bin/bash", "-c", solution],
							{ timeoutMs: 180_000, signal: cancellation.signal, logFile: join(trialDir, "oracle.log") },
						);
						await writeFile(join(trialDir, "oracle.json"), JSON.stringify(applied));
						if (applied.exitCode !== 0) throw new Error(`Oracle failed to execute for ${task.name}.`);
					}
					const verified = await container.verify();
					await writeFile(join(trialDir, "result.json"), JSON.stringify(verified));
					if (verified.passed !== (kind === "oracle"))
						throw new Error(`Preflight ${kind} produced an unexpected verdict for ${task.name}.`);
				} finally {
					await container.dispose();
				}
			}
		}
		if (values["preflight-only"]) return;
		for (const [taskIndex, task] of tasks.entries()) {
			// Rotate order once; this small pilot makes no statistical comparison.
			const modes =
				taskIndex === 0
					? (["continuous", "fresh", "strategy"] as const)
					: (["strategy", "fresh", "continuous"] as const);
			for (const mode of modes) {
				cancellation.signal.throwIfAborted();
				console.log(`Running ${task.name}: ${mode}`);
				const trialDir = join(outputDir, `${task.name}-${mode}`);
				const container = await startTask({
					...task,
					taskDir: join(tasksDir, task.name),
					name: `prime-pilot-${randomUUID()}`,
					outputDir: trialDir,
					signal: cancellation.signal,
				});
				const workAbort = new AbortController();
				const signal = AbortSignal.any([workAbort.signal, cancellation.signal]);
				const timer = setTimeout(() => workAbort.abort(), limits.runTimeoutMs);
				const started = Date.now();
				try {
					const cwd = join(trialDir, "workspace");
					const agentDir = join(trialDir, "agent");
					await mkdir(cwd, { recursive: true });
					const resourceLoader = new DefaultResourceLoader({
						cwd,
						agentDir,
						settingsManager: SettingsManager.inMemory(settings),
						noExtensions: true,
						noSkills: true,
						noPromptTemplates: true,
						agentsFilesOverride: () => ({ agentsFiles: [] }),
						systemPromptOverride: () =>
							"You solve tasks inside an isolated Linux container using the supplied tools.",
					});
					await resourceLoader.reload();
					const modelBudget = new ModelBudget(modelLimits);
					let toolCalls = 0;
					const tool = defineTool({
						name: "run_command",
						label: "Run command",
						description: "Run a shell command in the task container; return stdout, stderr, and exit code.",
						parameters: Type.Object({ command: Type.String({ minLength: 1 }) }),
						async execute(_id, params, toolSignal) {
							toolCalls++;
							const result = await container.execute(params.command, toolSignal);
							await appendFile(
								join(trialDir, "commands.jsonl"),
								`${JSON.stringify({ command: params.command, result })}\n`,
							);
							return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
						},
					});
					const sessionOptions = {
						cwd,
						agentDir,
						authStorage,
						modelRegistry,
						model,
						resourceLoader,
						thinkingLevel: "low" as const,
						serviceTier: "default" as const,
						tools: ["run_command"],
						allowedToolNames: ["run_command"],
						customTools: [tool],
					};
					const result =
						mode === "strategy"
							? await runWithStrategy({
									...sessionOptions,
									task: {
										objective: container.instruction,
										successCriteria:
											"The requested artifact meets every requirement in the task instructions.",
										initialContext,
										tools: [],
										createTools: () => [tool],
									},
									settings,
									limits,
									modelBudget,
									outputDir: trialDir,
									signal,
								})
							: await runControl({
									mode,
									sessionOptions,
									objective: container.instruction,
									initialContext,
									modelBudget,
									outputDir: trialDir,
									signal,
									maxSteps: limits.maxSteps,
									maxTurns: limits.maxWorkerTurns,
									stepTimeoutMs: limits.stepTimeoutMs,
								});
					clearTimeout(timer);
					const agentTimeMs = Date.now() - started;
					await writeFile(join(trialDir, "agent-result.json"), JSON.stringify(result, null, 2));
					if (cancellation.signal.aborted) cancellation.signal.throwIfAborted();
					const verified = await container.verify();
					const summary = {
						task: task.name,
						mode,
						passed: verified.passed,
						agentTimeMs,
						toolCalls,
						usage: result.usage,
						modelBudget: modelBudget.usage,
						stopReason: result.stopReason,
						timedOut: workAbort.signal.aborted,
						trialDir,
					};
					await appendFile(join(outputDir, "results.jsonl"), `${JSON.stringify(summary)}\n`);
					console.log(JSON.stringify(summary));
					if (result.stopReason === "error" || modelBudget.usage.unreportedRequests > 0)
						throw new Error("Runtime or usage accounting failed; remaining pilot attempts stopped.");
				} finally {
					clearTimeout(timer);
					await container.dispose();
				}
			}
		}
	} catch (error) {
		await save("failure.json", { message: error instanceof Error ? error.message : String(error) });
		throw error;
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

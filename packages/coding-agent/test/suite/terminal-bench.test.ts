import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CommandResult,
	type ProcessOptions,
	type ProcessRunner,
	runProcess,
	startTask,
	type TerminalBenchTask,
} from "../../examples/sdk/terminal-bench.js";
import { createHarness, type Harness } from "./harness.js";

const containerId = "a".repeat(64);
const image = `example/task@sha256:${"b".repeat(64)}`;
const success = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
const testReport = (passed = true) => ({
	results: {
		summary: { tests: 1, passed: Number(passed), failed: Number(!passed), skipped: 0, pending: 0, other: 0 },
		tests: [{ status: passed ? "passed" : "failed", ...(passed ? {} : { raw_status: "call_failed" }) }],
	},
});
interface ProcessCall {
	binary: string;
	args: string[];
	options: ProcessOptions;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("Terminal-Bench container driver", () => {
	const harnesses: Harness[] = [];
	const tasks: TerminalBenchTask[] = [];
	afterEach(async () => {
		await Promise.allSettled(tasks.splice(0).map((task) => task.dispose()));
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(handler?: (call: ProcessCall) => Promise<CommandResult | undefined>) {
		const harness = await createHarness();
		harnesses.push(harness);
		const taskDir = join(harness.tempDir, "task");
		const outputDir = join(harness.tempDir, "output");
		await mkdir(join(taskDir, "tests"), { recursive: true });
		await writeFile(join(taskDir, "instruction.md"), "Complete the task using /app input files.");
		await writeFile(join(taskDir, "tests", "test.sh"), "hidden verifier");
		const calls: ProcessCall[] = [];
		const runner: ProcessRunner = async (binary, args, options) => {
			const call = { binary, args, options };
			calls.push(call);
			const result = await handler?.(call);
			if (result) return result;
			if (args[0] === "create") return success(containerId);
			if (args[0] === "cp" && args[1].includes("/logs/verifier")) {
				await writeFile(join(args[2], "reward.txt"), "1\n");
				await writeFile(join(args[2], "ctrf.json"), JSON.stringify(testReport()));
			}
			if (options.logFile) await writeFile(options.logFile, "raw verifier output\n");
			return success("ok\n");
		};
		return {
			harness,
			calls,
			options: { taskDir, outputDir, image, name: "prime-pilot-test", docker: "test-docker", runProcess: runner },
		};
	}
	async function start(options: Parameters<typeof startTask>[0]) {
		const task = await startTask(options);
		tasks.push(task);
		return task;
	}

	it("exposes only the instruction and an isolated container to a faux worker", async () => {
		const { calls, options } = await setup();
		const task = await start(options);
		const terminalParameters = Type.Object({ command: Type.String() });
		const harness = await createHarness({
			tools: [
				{
					name: "terminal",
					label: "Terminal",
					description: "Run a task command",
					parameters: terminalParameters,
					async execute(_id, args, signal) {
						if (!Check(terminalParameters, args)) throw new Error("Invalid terminal arguments");
						const result = await task.execute(args.command, signal);
						return { content: [{ type: "text", text: result.stdout }], details: result };
					},
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("terminal", { command: "printf task-work" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Finished."),
		]);
		await harness.session.prompt(task.instruction);
		const create = calls.find((call) => call.args[0] === "create")!;
		expect(create.args).toEqual(
			expect.arrayContaining(["--platform", "linux/amd64", "--network", "none", "--cpus", "1", "--memory", "2g"]),
		);
		expect(create.args).not.toEqual(expect.arrayContaining(["--volume", "-v", "--env", "--mount"]));
		expect(calls.every((call) => call.binary === "test-docker")).toBe(true);
		expect(calls.some((call) => call.args[0] === "cp" || call.args[0] === "network")).toBe(false);
		expect(calls.find((call) => call.args.at(-1) === "printf task-work")?.options.timeoutMs).toBe(30_000);
	});

	it("stops worker processes before verification and never permits further work", async () => {
		const { calls, options } = await setup();
		const task = await start(options);
		await task.execute("printf before-review");
		const result = await task.verify();
		expect(result.passed).toBe(true);
		expect(await readFile(join(options.outputDir, "verifier.log"), "utf8")).toBe("raw verifier output\n");
		const stopIndex = calls.findIndex((call) => call.args[0] === "stop");
		const networkIndex = calls.findIndex((call) => call.args[0] === "network");
		const artifactCopyIndex = calls.findIndex((call) => call.args[0] === "cp" && call.args[1].includes(":/app"));
		const testCopyIndex = calls.findIndex((call) => call.args[0] === "cp" && call.args[2].endsWith(":/tests"));
		expect(stopIndex).toBeLessThan(networkIndex);
		expect(stopIndex).toBeLessThan(artifactCopyIndex);
		expect(artifactCopyIndex).toBeLessThan(networkIndex);
		expect(networkIndex).toBeLessThan(testCopyIndex);
		await expect(task.execute("must never execute")).rejects.toThrow("closed");
		expect(await task.verify()).toEqual(result);
		await task.dispose();
		await task.dispose();
		expect(calls.filter((call) => call.args[0] === "rm").map((call) => call.args)).toEqual([
			["rm", "--force", containerId],
		]);
		await expect(task.verify()).rejects.toThrow("disposed");
	});

	it("awaits process settlement and container shutdown after tool cancellation", async () => {
		const started = deferred<void>();
		const settleExecution = deferred<void>();
		const settleStop = deferred<void>();
		const { calls, options } = await setup(async ({ args, options: processOptions }) => {
			if (args.at(-1) === "long command") {
				started.resolve();
				await new Promise<void>((resolveAbort) =>
					processOptions.signal!.addEventListener("abort", () => resolveAbort(), { once: true }),
				);
				await settleExecution.promise;
				throw new Error("Command cancelled");
			}
			if (args[0] === "stop") await settleStop.promise;
			return undefined;
		});
		const task = await start(options);
		const cancel = new AbortController();
		let finished = false;
		const execution = task.execute("long command", cancel.signal).finally(() => {
			finished = true;
		});
		const rejected = expect(execution).rejects.toThrow("cancelled");
		await started.promise;
		cancel.abort();
		settleExecution.resolve();
		await new Promise((resolveTurn) => setImmediate(resolveTurn));
		expect(calls.some((call) => call.args[0] === "stop")).toBe(true);
		expect(finished).toBe(false);
		settleStop.resolve();
		await rejected;
		await expect(task.execute("no independent continuation")).rejects.toThrow("closed");
	});

	it("waits for active work to settle before injecting tests", async () => {
		const started = deferred<void>();
		const release = deferred<void>();
		const { calls, options } = await setup(async ({ args }) => {
			if (args.at(-1) === "active work") {
				started.resolve();
				await release.promise;
				throw new Error("Command cancelled");
			}
			return undefined;
		});
		const task = await start(options);
		const rejected = expect(task.execute("active work")).rejects.toThrow("cancelled");
		await started.promise;
		const verification = task.verify();
		await new Promise((resolveTurn) => setImmediate(resolveTurn));
		expect(calls.some((call) => call.args[0] === "cp")).toBe(false);
		release.resolve();
		await rejected;
		expect((await verification).passed).toBe(true);
	});

	it("stops idle background work when the run is cancelled", async () => {
		const { calls, options } = await setup();
		const controller = new AbortController();
		const task = await start({ ...options, signal: controller.signal });
		await task.execute("background job &");
		controller.abort();
		await task.dispose();
		expect(calls.some((call) => call.args[0] === "stop")).toBe(true);
		await expect(task.execute("another job")).rejects.toThrow("closed");
	});

	it("distinguishes task failure from an invalid verifier result", async () => {
		const { options } = await setup(async ({ args }) => {
			if (args[0] === "cp" && args[1].includes("/logs/verifier")) {
				await writeFile(join(args[2], "reward.txt"), "0\n");
				await writeFile(join(args[2], "ctrf.json"), JSON.stringify(testReport(false)));
				return success();
			}
			return undefined;
		});
		expect((await (await start(options)).verify()).passed).toBe(false);
		const invalid = await setup(async ({ args }) => {
			if (args[0] === "cp" && args[1].includes("/logs/verifier")) {
				await writeFile(join(args[2], "reward.txt"), "not a result\n");
				return success();
			}
			return undefined;
		});
		await expect((await start(invalid.options)).verify()).rejects.toThrow("valid result");
	});

	it.each(["empty", "skipped", "setup failure", "missing", "reward mismatch"])(
		"rejects %s verifier reports as apparatus failures",
		async (kind) => {
			const { options } = await setup(async ({ args }) => {
				if (args[0] !== "cp" || !args[1].includes("/logs/verifier")) return undefined;
				await writeFile(join(args[2], "reward.txt"), kind === "reward mismatch" ? "1\n" : "0\n");
				if (kind === "missing") return success();
				const report = testReport(false);
				if (kind === "empty") {
					report.results.summary.tests = 0;
					report.results.summary.failed = 0;
					report.results.tests = [];
				} else if (kind === "skipped") {
					report.results.summary.skipped = 1;
				} else if (kind === "setup failure") {
					delete report.results.tests[0].raw_status;
				}
				await writeFile(join(args[2], "ctrf.json"), JSON.stringify(report));
				return success();
			});
			await expect((await start(options)).verify()).rejects.toThrow();
		},
	);

	it("bounds output in bytes and closes execution when a command times out", async () => {
		const { calls, options } = await setup(async ({ args }) => {
			if (args.at(-1) === "verbose") return success("é".repeat(30_000));
			if (args.at(-1) === "slow") throw new Error("Command exceeded 30000 ms");
			return undefined;
		});
		const task = await start(options);
		const result = await task.execute("verbose");
		expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(20_000);
		expect(result.stderr).toContain("truncated");
		await expect(task.execute("slow")).rejects.toThrow("exceeded");
		expect(calls.some((call) => call.args[0] === "stop")).toBe(true);
	});

	it("does not remove an existing container after a name collision", async () => {
		const { calls, options } = await setup(async ({ args }) => {
			if (args[0] === "create") return { stdout: "", stderr: "name already in use", exitCode: 1 };
			if (args[0] === "inspect") return success(`${containerId} another-owner`);
			return undefined;
		});
		await expect(startTask(options)).rejects.toThrow("name already in use");
		expect(calls.some((call) => call.args[0] === "rm" || call.args[0] === "stop")).toBe(false);
	});

	it("cleans up its own container when startup fails", async () => {
		let owner = "";
		const { calls, options } = await setup(async ({ args }) => {
			if (args[0] === "create") owner = args[args.indexOf("--label") + 1].split("=")[1];
			if (args[0] === "start") throw new Error("Startup failed");
			if (args[0] === "inspect") return success(`${containerId} ${owner}`);
			return undefined;
		});
		await expect(startTask(options)).rejects.toThrow("Startup failed");
		expect(calls.filter((call) => call.args[0] === "rm").map((call) => call.args)).toEqual([
			["rm", "--force", containerId],
		]);
	});

	it("requires pinned images before touching Docker", async () => {
		const { calls, options } = await setup();
		await expect(startTask({ ...options, image: "example/task:latest" })).rejects.toThrow("pinned");
		expect(calls).toHaveLength(0);
	});

	it("streams complete process logs while bounding returned output", async () => {
		const { harness } = await setup();
		const logFile = join(harness.tempDir, "raw.log");
		const result = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(50000))"], {
			timeoutMs: 2_000,
			logFile,
		});
		expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(20_000);
		expect((await readFile(logFile)).length).toBe(50_000);
		expect(result.exitCode).toBe(0);
	});

	it("settles real child processes on timeout and cancellation without Docker", async () => {
		await expect(
			runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 10 }),
		).rejects.toThrow("exceeded");
		const controller = new AbortController();
		const result = runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
			timeoutMs: 2_000,
			signal: controller.signal,
		});
		controller.abort();
		await expect(result).rejects.toThrow("cancelled");
	});
});

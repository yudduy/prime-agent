import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { type ResearchContainer, startResearchContainer } from "../../examples/sdk/research-container.js";
import type { CommandResult, ProcessOptions, ProcessRunner } from "../../examples/sdk/terminal-bench.js";
import { createHarness, type Harness } from "./harness.js";

const containerId = "a".repeat(64);
const image = `example/research@sha256:${"b".repeat(64)}`;
const success = (stdout = ""): CommandResult => ({ stdout, stderr: "", exitCode: 0 });
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

const nextTurn = () => new Promise((resolveTurn) => setImmediate(resolveTurn));

describe("CPU research container", () => {
	const harnesses: Harness[] = [];
	const containers: ResearchContainer[] = [];
	afterEach(async () => {
		await Promise.allSettled(containers.splice(0).map((container) => container.dispose()));
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(handler?: (call: ProcessCall) => Promise<CommandResult | undefined>) {
		const harness = await createHarness();
		harnesses.push(harness);
		const filesDir = join(harness.tempDir, "files");
		const outputDir = join(harness.tempDir, "output");
		await mkdir(filesDir);
		await writeFile(join(filesDir, "candidate.json"), "[]\n");
		const calls: ProcessCall[] = [];
		const runner: ProcessRunner = async (binary, args, options) => {
			const call = { binary, args, options };
			calls.push(call);
			const result = await handler?.(call);
			if (result) return result;
			if (args[0] === "create") return success(containerId);
			return success("ok\n");
		};
		return {
			harness,
			calls,
			options: {
				filesDir,
				outputDir,
				image,
				name: "prime-research-test",
				docker: "test-docker",
				runProcess: runner,
			},
		};
	}
	async function start(options: Parameters<typeof startResearchContainer>[0]) {
		const container = await startResearchContainer(options);
		containers.push(container);
		return container;
	}

	it("provides a faux worker with bounded CPU-only execution and copied input files", async () => {
		const { calls, options } = await setup();
		const container = await start(options);
		const parameters = Type.Object({ command: Type.String() });
		const harness = await createHarness({
			tools: [
				{
					name: "terminal",
					label: "Terminal",
					description: "Run a bounded CPU command",
					parameters,
					async execute(_id, args, signal) {
						if (!Check(parameters, args)) throw new Error("Invalid command");
						const result = await container.execute(args.command, signal);
						return { content: [{ type: "text", text: result.stdout }], details: result };
					},
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("terminal", { command: "python solve.py" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Reported the candidate."),
		]);
		await harness.session.prompt("Find a better construction in /app.");
		const create = calls.find((call) => call.args[0] === "create")!;
		expect(create.args).toEqual(
			expect.arrayContaining([
				"--pull",
				"never",
				"--network",
				"none",
				"--cpus",
				"1",
				"--memory",
				"2g",
				"--pids-limit",
				"128",
			]),
		);
		expect(create.args).not.toEqual(expect.arrayContaining(["--volume", "-v", "--env", "--mount", "--gpus"]));
		expect(calls.every((call) => call.binary === "test-docker")).toBe(true);
		expect(calls.find((call) => call.args[0] === "cp")?.args).toEqual([
			"cp",
			`${options.filesDir}/.`,
			`${containerId}:/app`,
		]);
		const execution = calls.find((call) => call.args[0] === "exec")!;
		expect(execution.args).toEqual(["exec", "--workdir", "/app", containerId, "/bin/sh", "-c", "python solve.py"]);
		expect(execution.options.timeoutMs).toBe(60_000);
	});

	it("stops all processes between commands and restarts the same files for the next call", async () => {
		const { calls, options } = await setup();
		const container = await start(options);
		calls.length = 0;
		await container.execute("background job &");
		await container.execute("read candidate.json");
		expect(calls.map((call) => call.args[0])).toEqual(["start", "exec", "stop", "start", "exec", "stop"]);
		expect(calls.filter((call) => call.args[0] === "stop").every((call) => call.args.at(-1) === containerId)).toBe(
			true,
		);
	});

	it("bounds output by bytes and permits another command after a cleaned-up timeout", async () => {
		const { calls, options } = await setup(async ({ args }) => {
			if (args.at(-1) === "verbose") return success("é".repeat(30_000));
			if (args.at(-1) === "slow") throw new Error("Command exceeded 60000 ms");
			return undefined;
		});
		const container = await start(options);
		const result = await container.execute("verbose");
		expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(20_000);
		expect(result.stdout).not.toContain("�");
		expect(result.stderr).toContain("truncated");
		calls.length = 0;
		await expect(container.execute("slow")).rejects.toThrow("exceeded");
		await container.execute("next command");
		expect(calls.map((call) => call.args[0])).toEqual(["start", "exec", "stop", "start", "exec", "stop"]);
	});

	it("rejects concurrent work and awaits cancelled execution and shutdown before returning", async () => {
		const started = deferred<void>();
		const settleExecution = deferred<void>();
		const settleStop = deferred<void>();
		let blockStop = false;
		const { options } = await setup(async ({ args, options: processOptions }) => {
			if (args.at(-1) === "long command") {
				started.resolve();
				await new Promise<void>((resolveAbort) =>
					processOptions.signal!.addEventListener("abort", () => resolveAbort(), { once: true }),
				);
				await settleExecution.promise;
				throw new Error("Command cancelled");
			}
			if (args[0] === "stop" && blockStop) await settleStop.promise;
			return undefined;
		});
		const container = await start(options);
		blockStop = true;
		const controller = new AbortController();
		let finished = false;
		const execution = container.execute("long command", controller.signal).finally(() => {
			finished = true;
		});
		const rejected = expect(execution).rejects.toThrow("cancelled");
		await started.promise;
		await expect(container.execute("second command")).rejects.toThrow("already running");
		controller.abort();
		settleExecution.resolve();
		await nextTurn();
		expect(finished).toBe(false);
		settleStop.resolve();
		await rejected;
		await expect(container.execute("next host-dispatched step")).resolves.toEqual(success("ok\n"));
	});

	it("permanently closes active work on run cancellation and awaits cleanup", async () => {
		const started = deferred<void>();
		const releaseStop = deferred<void>();
		let blockStop = false;
		const { calls, options } = await setup(async ({ args, options: processOptions }) => {
			if (args.at(-1) === "active work") {
				started.resolve();
				await new Promise<void>((resolveAbort) =>
					processOptions.signal!.addEventListener("abort", () => resolveAbort(), { once: true }),
				);
				throw new Error("Command cancelled");
			}
			if (args[0] === "stop" && blockStop) await releaseStop.promise;
			return undefined;
		});
		const controller = new AbortController();
		const container = await start({ ...options, signal: controller.signal });
		blockStop = true;
		let finished = false;
		const execution = container.execute("active work").finally(() => {
			finished = true;
		});
		const rejected = expect(execution).rejects.toThrow("cancelled");
		await started.promise;
		controller.abort();
		await nextTurn();
		expect(finished).toBe(false);
		await expect(container.execute("another step")).rejects.toThrow("closed");
		releaseStop.resolve();
		await rejected;
		await container.dispose();
		expect(calls.at(-1)?.args).toEqual(["rm", "--force", containerId]);
	});

	it("records container ownership before starting work", async () => {
		let outputDir = "";
		let savedRecord: unknown;
		const { calls, options } = await setup(async ({ args }) => {
			if (args[0] === "start") savedRecord = JSON.parse(await readFile(join(outputDir, "container.json"), "utf8"));
			return undefined;
		});
		outputDir = options.outputDir;
		await start(options);
		const create = calls.find((call) => call.args[0] === "create")!;
		const [label, owner] = create.args[create.args.indexOf("--label") + 1].split("=");
		expect(savedRecord).toEqual({ id: containerId, name: options.name, owner, label, image });
	});

	it("closes idle work on run cancellation without another tool call", async () => {
		const { calls, options } = await setup();
		const controller = new AbortController();
		const container = await start({ ...options, signal: controller.signal });
		controller.abort();
		await expect(container.execute("new work")).rejects.toThrow("closed");
		await container.dispose();
		expect(calls.at(-1)?.args).toEqual(["rm", "--force", containerId]);
	});

	it("awaits active work before taking a terminal snapshot and disposing", async () => {
		const started = deferred<void>();
		const releaseExecution = deferred<void>();
		const copying = deferred<void>();
		const releaseCopy = deferred<void>();
		const { calls, harness, options } = await setup(async ({ args }) => {
			if (args.at(-1) === "active work") {
				started.resolve();
				await releaseExecution.promise;
				throw new Error("Command cancelled");
			}
			if (args[0] === "cp" && args[1].includes(":/app")) {
				copying.resolve();
				await releaseCopy.promise;
			}
			return undefined;
		});
		const container = await start(options);
		const execution = container.execute("active work");
		const rejected = expect(execution).rejects.toThrow("cancelled");
		await started.promise;
		calls.length = 0;
		const destination = join(harness.tempDir, "snapshot");
		const snapshot = container.snapshot(destination);
		expect(container.snapshot(destination)).toBe(snapshot);
		await expect(container.snapshot(join(harness.tempDir, "different"))).rejects.toThrow("already set");
		await nextTurn();
		expect(calls.some((call) => call.args[0] === "cp")).toBe(false);
		await expect(container.execute("after snapshot")).rejects.toThrow("closed");
		releaseExecution.resolve();
		await rejected;
		await copying.promise;
		const disposal = container.dispose();
		await nextTurn();
		expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
		releaseCopy.resolve();
		await snapshot;
		await disposal;
		await container.dispose();
		expect(calls.map((call) => call.args[0])).toEqual(["stop", "stop", "cp", "rm"]);
		expect(calls.find((call) => call.args[0] === "cp")?.args).toEqual(["cp", `${containerId}:/app/.`, destination]);
		await expect(container.snapshot(destination)).rejects.toThrow("disposed");
	});

	it("fails closed when process cleanup fails and still permits owned container removal", async () => {
		let failStop = false;
		const { calls, options } = await setup(async ({ args }) => {
			if (args[0] === "stop" && failStop) throw new Error("Docker stop failed");
			return undefined;
		});
		const container = await start(options);
		failStop = true;
		await expect(container.execute("command")).rejects.toThrow("stop failed");
		await expect(container.execute("another command")).rejects.toThrow("closed");
		await container.dispose();
		expect(calls.at(-1)?.args).toEqual(["rm", "--force", containerId]);
	});

	it("never removes a preexisting container after a name collision", async () => {
		const { calls, options } = await setup(async ({ args }) => {
			if (args[0] === "create") return { stdout: "", stderr: "name already in use", exitCode: 1 };
			if (args[0] === "inspect") return success(`${containerId} another-owner`);
			return undefined;
		});
		await expect(startResearchContainer(options)).rejects.toThrow("name already in use");
		expect(calls.some((call) => call.args[0] === "rm" || call.args[0] === "stop")).toBe(false);
	});

	it("cleans up its own container after an interrupted startup", async () => {
		let owner = "";
		const { calls, options } = await setup(async ({ args }) => {
			if (args[0] === "create") owner = args[args.indexOf("--label") + 1].split("=")[1];
			if (args[0] === "cp") throw new Error("Startup cancelled");
			if (args[0] === "inspect") return success(`${containerId} ${owner}`);
			return undefined;
		});
		await expect(startResearchContainer(options)).rejects.toThrow("Startup cancelled");
		expect(calls.at(-1)?.args).toEqual(["rm", "--force", containerId]);
	});

	it("accepts immutable image IDs and rejects mutable images before touching Docker", async () => {
		const { calls, options } = await setup();
		await expect(startResearchContainer({ ...options, image: "example/research:latest" })).rejects.toThrow("pinned");
		expect(calls).toHaveLength(0);
		await start({ ...options, image: `sha256:${"b".repeat(64)}` });
		expect(calls.some((call) => call.args[0] === "create")).toBe(true);
	});
});

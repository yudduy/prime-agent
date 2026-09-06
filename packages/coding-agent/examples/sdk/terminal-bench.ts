import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";

const outputLimit = 20_000;
const commandTimeoutMs = 30_000;
const ownerLabel = "prime.strategy.container-owner";
const verifierReportSchema = Type.Object({
	results: Type.Object({
		summary: Type.Object({
			tests: Type.Integer({ minimum: 1 }),
			passed: Type.Integer({ minimum: 0 }),
			failed: Type.Integer({ minimum: 0 }),
			skipped: Type.Literal(0),
			pending: Type.Literal(0),
			other: Type.Literal(0),
			errors: Type.Optional(Type.Literal(0)),
		}),
		tests: Type.Array(
			Type.Object({
				status: Type.Union([Type.Literal("passed"), Type.Literal("failed")]),
				raw_status: Type.Optional(Type.Union([Type.Literal("call_failed"), Type.Literal("call_passed")])),
			}),
		),
	}),
});

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ProcessOptions {
	timeoutMs: number;
	signal?: AbortSignal;
	logFile?: string;
}

/** A runner must settle only after its process has exited, including on cancellation. */
export type ProcessRunner = (binary: string, args: string[], options: ProcessOptions) => Promise<CommandResult>;

export interface TerminalBenchOptions {
	taskDir: string;
	image: string;
	name: string;
	outputDir: string;
	signal?: AbortSignal;
	docker?: string;
	runProcess?: ProcessRunner;
}

export interface TerminalBenchTask {
	instruction: string;
	execute(command: string, signal?: AbortSignal): Promise<CommandResult>;
	/** Permanently closes execution before revealing the final verifier. */
	verify(): Promise<{ passed: boolean; output: string }>;
	dispose(): Promise<void>;
}

function truncate(text: string, bytes: number): string {
	return Buffer.from(text)
		.subarray(0, bytes)
		.toString("utf8")
		.replace(/\uFFFD$/, "");
}

function limitOutput(result: CommandResult): CommandResult {
	if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= outputLimit) return result;
	const notice = "\n[output truncated]";
	const stdout = truncate(result.stdout, outputLimit - notice.length);
	const stderr = truncate(result.stderr, outputLimit - notice.length - Buffer.byteLength(stdout)) + notice;
	return { stdout, stderr, exitCode: result.exitCode };
}

/** Captures bounded tool output while streaming the complete verifier output to disk. */
export const runProcess: ProcessRunner = async (binary, args, options) => {
	options.signal?.throwIfAborted();
	const log = options.logFile ? openSync(options.logFile, "wx") : undefined;
	return new Promise<CommandResult>((resolveResult, reject) => {
		const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let savedBytes = 0;
		let truncated = false;
		let failure: Error | undefined;
		const stop = (error: Error) => {
			failure ??= error;
			child.kill("SIGKILL");
		};
		const cancel = () => stop(new Error("Command cancelled"));
		const timeout = setTimeout(() => stop(new Error(`Command exceeded ${options.timeoutMs} ms`)), options.timeoutMs);
		const collect = (target: Buffer[], data: Buffer) => {
			if (log !== undefined) {
				try {
					writeSync(log, data);
				} catch (error) {
					stop(error instanceof Error ? error : new Error(String(error)));
				}
			}
			const kept = data.subarray(0, Math.max(0, outputLimit - savedBytes));
			if (kept.length > 0) target.push(kept);
			savedBytes += kept.length;
			truncated ||= kept.length < data.length;
		};
		child.stdout.on("data", (data: Buffer) => collect(stdout, data));
		child.stderr.on("data", (data: Buffer) => collect(stderr, data));
		child.on("error", (error) => {
			failure ??= error;
		});
		options.signal?.addEventListener("abort", cancel, { once: true });
		if (options.signal?.aborted) cancel();
		child.once("close", (exitCode) => {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", cancel);
			if (log !== undefined) closeSync(log);
			if (failure) {
				reject(failure);
				return;
			}
			resolveResult(
				limitOutput({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8") + (truncated ? "\n[output truncated]" : ""),
					exitCode: exitCode ?? 1,
				}),
			);
		});
	});
};

export async function startTask(options: TerminalBenchOptions): Promise<TerminalBenchTask> {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(options.name)) throw new Error("Invalid container name");
	if (!/@sha256:[a-f0-9]{64}$/.test(options.image)) throw new Error("Use a Docker image pinned by SHA-256 digest");
	options.signal?.throwIfAborted();
	const instruction = await readFile(join(options.taskDir, "instruction.md"), "utf8");
	const outputDir = resolve(options.outputDir);
	await mkdir(outputDir, { recursive: true });
	const docker = options.docker ?? process.env.DOCKER ?? "/usr/local/bin/docker";
	const runner = options.runProcess ?? runProcess;
	const owner = randomUUID();
	const shutdown = new AbortController();
	const disposal = new AbortController();
	let containerId: string | undefined;
	let active: Promise<CommandResult> | undefined;
	let stopping: Promise<void> | undefined;
	let verification: Promise<{ passed: boolean; output: string }> | undefined;
	let disposing: Promise<void> | undefined;
	let workClosed = false;

	const command = (args: string[], processOptions: Partial<ProcessOptions> = {}) =>
		runner(docker, args, { timeoutMs: commandTimeoutMs, signal: disposal.signal, ...processOptions });
	const checked = async (args: string[], processOptions: Partial<ProcessOptions> = {}) => {
		const result = await command(args, processOptions);
		if (result.exitCode !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr || result.stdout}`);
		return result;
	};
	const stopWork = (): Promise<void> => {
		stopping ??= checked(["stop", "--time", "0", containerId!], { signal: undefined }).then(() => undefined);
		return stopping;
	};
	const cancel = () => {
		workClosed = true;
		shutdown.abort();
		void stopWork().catch(() => {});
	};
	const dispose = (): Promise<void> => {
		if (disposing) return disposing;
		workClosed = true;
		options.signal?.removeEventListener("abort", cancel);
		shutdown.abort();
		disposal.abort();
		disposing = (async () => {
			if (!containerId) return;
			try {
				await stopWork();
			} finally {
				await Promise.allSettled([active, verification]);
				await checked(["rm", "--force", containerId], { signal: undefined });
			}
		})();
		return disposing;
	};

	try {
		const created = await checked([
			"create",
			"--pull",
			"never",
			"--platform",
			"linux/amd64",
			"--name",
			options.name,
			"--label",
			`${ownerLabel}=${owner}`,
			"--network",
			"none",
			"--cpus",
			"1",
			"--memory",
			"2g",
			"--pids-limit",
			"128",
			"--entrypoint",
			"/bin/sh",
			options.image,
			"-c",
			"while :; do sleep 3600; done",
		]);
		containerId = created.stdout.trim();
		if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("Docker did not return a container ID");
		await checked(["start", containerId]);
		options.signal?.addEventListener("abort", cancel, { once: true });
		if (options.signal?.aborted) {
			cancel();
			options.signal.throwIfAborted();
		}
	} catch (error) {
		// A cancelled Docker client can leave a created container behind. Never remove a name we do not own.
		options.signal?.removeEventListener("abort", cancel);
		await Promise.allSettled([stopping]);
		const found = await command([
			"inspect",
			"--format",
			`{{.Id}} {{index .Config.Labels "${ownerLabel}"}}`,
			options.name,
		]);
		const [id, label] = found.stdout.trim().split(" ");
		if (found.exitCode === 0 && label === owner && /^[a-f0-9]{64}$/.test(id)) {
			await checked(["rm", "--force", id]);
		}
		throw error;
	}

	const execute = (shellCommand: string, signal?: AbortSignal): Promise<CommandResult> => {
		if (workClosed) return Promise.reject(new Error("Task execution is closed"));
		if (active) return Promise.reject(new Error("A task command is already running"));
		const signals = [shutdown.signal, ...(signal ? [signal] : []), ...(options.signal ? [options.signal] : [])];
		const combinedSignal = AbortSignal.any(signals);
		if (combinedSignal.aborted) return Promise.reject(new Error("Command cancelled"));
		active = (async () => {
			try {
				return limitOutput(
					await command(["exec", containerId!, "/bin/sh", "-c", shellCommand], { signal: combinedSignal }),
				);
			} catch (error) {
				workClosed = true;
				await stopWork();
				throw error;
			} finally {
				active = undefined;
			}
		})();
		return active;
	};

	const verify = (): Promise<{ passed: boolean; output: string }> => {
		if (disposing) return Promise.reject(new Error("Task has been disposed"));
		if (verification) return verification;
		workClosed = true;
		options.signal?.removeEventListener("abort", cancel);
		shutdown.abort();
		verification = (async () => {
			await stopWork();
			await Promise.allSettled([active]);
			disposal.signal.throwIfAborted();
			const artifactsDir = join(outputDir, "artifacts");
			await mkdir(artifactsDir);
			await checked(["cp", `${containerId}:/app/.`, artifactsDir]);
			await checked(["start", containerId!]);
			stopping = undefined;
			try {
				await checked(["network", "disconnect", "none", containerId!]);
				await checked(["network", "connect", "bridge", containerId!]);
				await checked([
					"exec",
					containerId!,
					"/bin/sh",
					"-c",
					"rm -rf /tests /logs/verifier && mkdir -p /tests /logs/verifier",
				]);
				await checked(["cp", `${resolve(options.taskDir, "tests")}/.`, `${containerId}:/tests`]);
				const result = await command(["exec", containerId!, "/bin/bash", "/tests/test.sh"], {
					timeoutMs: 180_000,
					logFile: join(outputDir, "verifier.log"),
				});
				const verifierDir = join(outputDir, "verifier");
				await mkdir(verifierDir);
				await checked(["cp", `${containerId}:/logs/verifier/.`, verifierDir]);
				const reward = (await readFile(join(verifierDir, "reward.txt"), "utf8")).trim();
				if (result.exitCode !== 0 || !["0", "1"].includes(reward))
					throw new Error("Verifier did not produce a valid result");
				const report: unknown = JSON.parse(await readFile(join(verifierDir, "ctrf.json"), "utf8"));
				if (!Check(verifierReportSchema, report)) throw new Error("Verifier did not run a complete test suite");
				const { summary, tests } = report.results;
				if (tests.some((test) => test.status === "failed" && test.raw_status !== "call_failed"))
					throw new Error("Verifier failed outside a test call");
				const passed = tests.filter((test) => test.status === "passed").length;
				const failed = tests.filter((test) => test.status === "failed").length;
				if (
					summary.tests !== tests.length ||
					passed !== summary.passed ||
					failed !== summary.failed ||
					(reward === "1") !== (failed === 0)
				)
					throw new Error("Verifier reward and test report disagree");
				const output = limitOutput(result);
				return { passed: reward === "1", output: output.stdout + output.stderr };
			} finally {
				await stopWork();
			}
		})();
		return verification;
	};
	return { instruction, execute, verify, dispose };
}

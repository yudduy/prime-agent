import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type CommandResult, type ProcessOptions, type ProcessRunner, runProcess } from "./terminal-bench.js";

const commandTimeoutMs = 60_000;
const outputLimit = 20_000;
const ownerLabel = "prime.strategy.container-owner";

export interface ResearchContainerOptions {
	image: string;
	name: string;
	outputDir: string;
	filesDir: string;
	signal?: AbortSignal;
	docker?: string;
	runProcess?: ProcessRunner;
}

export interface ResearchContainer {
	execute(command: string, signal?: AbortSignal): Promise<CommandResult>;
	/** Permanently closes work and copies files from the stopped container into a new directory. */
	snapshot(destination: string): Promise<void>;
	dispose(): Promise<void>;
}

function limitOutput(result: CommandResult): CommandResult {
	if (Buffer.byteLength(result.stdout + result.stderr) <= outputLimit) return result;
	const notice = "\n[output truncated]";
	const truncate = (text: string, bytes: number) =>
		Buffer.from(text)
			.subarray(0, bytes)
			.toString("utf8")
			.replace(/\uFFFD$/, "");
	const stdout = truncate(result.stdout, outputLimit - notice.length);
	const stderr = truncate(result.stderr, outputLimit - notice.length - Buffer.byteLength(stdout)) + notice;
	return { stdout, stderr, exitCode: result.exitCode };
}

export async function startResearchContainer(options: ResearchContainerOptions): Promise<ResearchContainer> {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(options.name)) throw new Error("Invalid container name");
	if (!/(?:^|@)sha256:[a-f0-9]{64}$/.test(options.image))
		throw new Error("Use a Docker image pinned by SHA-256 digest or immutable image ID");
	options.signal?.throwIfAborted();
	await mkdir(resolve(options.outputDir), { recursive: true });
	const docker = options.docker ?? process.env.DOCKER ?? "/usr/local/bin/docker";
	const runner = options.runProcess ?? runProcess;
	const owner = randomUUID();
	const shutdown = new AbortController();
	let containerId: string | undefined;
	let active: Promise<CommandResult> | undefined;
	let snapshotting: Promise<void> | undefined;
	let snapshotPath: string | undefined;
	let disposing: Promise<void> | undefined;
	let workClosed = false;

	const command = (args: string[], processOptions: Partial<ProcessOptions> = {}) =>
		runner(docker, args, { timeoutMs: commandTimeoutMs, ...processOptions });
	const checked = async (args: string[], processOptions: Partial<ProcessOptions> = {}) => {
		const result = await command(args, processOptions);
		if (result.exitCode !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr || result.stdout}`);
		return result;
	};
	const stop = () => checked(["stop", "--time", "0", containerId!]);
	const closeWork = () => {
		workClosed = true;
		shutdown.abort();
	};
	const dispose = (): Promise<void> => {
		if (disposing) return disposing;
		closeWork();
		options.signal?.removeEventListener("abort", closeWork);
		disposing = (async () => {
			await Promise.allSettled([active, snapshotting]);
			if (containerId) await checked(["rm", "--force", containerId]);
		})();
		return disposing;
	};

	try {
		const created = await checked(
			[
				"create",
				"--pull",
				"never",
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
				"--memory-swap",
				"2g",
				"--pids-limit",
				"128",
				"--workdir",
				"/app",
				"--entrypoint",
				"/bin/sh",
				options.image,
				"-c",
				"while :; do sleep 3600; done",
			],
			{ signal: options.signal },
		);
		containerId = created.stdout.trim();
		if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("Docker did not return a container ID");
		await writeFile(
			resolve(options.outputDir, "container.json"),
			`${JSON.stringify({ id: containerId, name: options.name, owner, label: ownerLabel, image: options.image }, null, 2)}\n`,
			{ flag: "wx" },
		);
		await checked(["start", containerId], { signal: options.signal });
		await checked(["cp", `${resolve(options.filesDir)}/.`, `${containerId}:/app`], { signal: options.signal });
		await stop();
		options.signal?.throwIfAborted();
		options.signal?.addEventListener("abort", closeWork, { once: true });
	} catch (error) {
		// A failed create request may still have created a container. Remove only this invocation's owner label.
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
		if (workClosed) return Promise.reject(new Error("Research container execution is closed"));
		if (active) return Promise.reject(new Error("A research command is already running"));
		const combinedSignal = AbortSignal.any([shutdown.signal, ...(signal ? [signal] : [])]);
		if (combinedSignal.aborted) return Promise.reject(new Error("Command cancelled"));
		const stopAfterCommand = async () => {
			try {
				// Stopping after every command also kills detached children; files survive the next start.
				await stop();
			} catch (error) {
				closeWork();
				throw error;
			} finally {
				active = undefined;
			}
		};
		active = (async () => {
			try {
				await checked(["start", containerId!], { signal: combinedSignal });
				combinedSignal.throwIfAborted();
				const result = await command(["exec", "--workdir", "/app", containerId!, "/bin/sh", "-c", shellCommand], {
					signal: combinedSignal,
				});
				combinedSignal.throwIfAborted();
				return limitOutput(result);
			} finally {
				await stopAfterCommand();
			}
		})();
		return active;
	};

	const snapshot = (destination: string): Promise<void> => {
		if (disposing) return Promise.reject(new Error("Research container has been disposed"));
		const path = resolve(destination);
		if (snapshotting) {
			if (path !== snapshotPath) return Promise.reject(new Error("Snapshot destination is already set"));
			return snapshotting;
		}
		closeWork();
		snapshotPath = path;
		snapshotting = (async () => {
			await Promise.allSettled([active]);
			await stop();
			await mkdir(path);
			await checked(["cp", `${containerId}:/app/.`, path]);
		})();
		return snapshotting;
	};
	return { execute, snapshot, dispose };
}

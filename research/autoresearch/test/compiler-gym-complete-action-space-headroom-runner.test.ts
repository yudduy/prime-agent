import assert from "node:assert/strict";
import { access, lstat, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../src/artifact-store.js";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	buildCompilerGymCompleteActionSpaceProtocol,
	type CompilerGymCompleteActionSpaceProtocol,
	loadCompilerGymCompleteActionSpaceSources,
} from "../src/compiler-gym-complete-action-space-headroom.js";
import {
	CompilerGymCompleteActionSpaceHeadroomRunner,
	type CompilerGymCompleteActionSpaceHeadroomRunnerClock,
	DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS,
} from "../src/compiler-gym-complete-action-space-headroom-runner.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
	CompilerGymWarmCommandRunner,
	CompilerGymWarmRemoteFileSystem,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";
import { completeActionSpaceValidResult } from "./helpers/compiler-gym-complete-action-space-fixture.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PROBE_OUTPUT = `${canonicalJson(
	toJsonValue({
		bitcodeFiles: 23,
		bitcodeManifestBytes: 1901,
		bitcodeTreeManifestSha256: "3447f0794f8e981ff72305cc4efd8e891bb3f348aeb25d189fb0915a39a322cb",
		cbenchValidationInputs: 20,
		compatibilityTreeEntries: 2749,
		compatibilityTreeManifestBytes: 215462,
		compatibilityTreeManifestSha256: "c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1",
		compilerGymVersion: "0.2.5",
		distributionCount: 30,
		distributionManifestSha256: "4b84dea7461512ef8fdadb99a992066484119fc91b7d8f0d3b33b5598fa870dd",
		installedCbenchSourceSha256: "6e38fd10d4bfd7816dbe6f959ff8ae97a3c10ab94cadde883926d83c0db521ed",
		libtinfoSha256: "d82654b2615eb347e8f15a63862c9234f452187250b75d36dce8bd964541f02e",
		pass: true,
		protocol: "compiler-gym-farmshare-environment-probe-v1",
		pythonVersion: "3.10.19",
		runtimeFiles: 571,
		runtimeManifestBytes: 54171,
		runtimeTreeManifestSha256: "238784ee2032baa43e65a47aa00b13cc805430ffec70952b3dcaa4466a04c8c6",
	}),
)}\n`;

function successAccounting(protocol: CompilerGymCompleteActionSpaceProtocol): string {
	const name = protocol.execution.jobName;
	return [
		`12345|${name}|COMPLETED|0:0|2||13|26|barley-01|2026-08-29T18:00:00|2026-08-29T18:00:13|`,
		"12345.extern|extern|COMPLETED|0:0|2|1|13|26|barley-01|2026-08-29T18:00:00|2026-08-29T18:00:13|",
		"12345.0|python|COMPLETED|0:0|1|1|12|12|barley-01|2026-08-29T18:00:00|2026-08-29T18:00:12|",
	].join("\n");
}

function pendingAccounting(protocol: CompilerGymCompleteActionSpaceProtocol): string {
	const name = protocol.execution.jobName;
	return [
		`12345|${name}|COMPLETING|0:0|2||0|0|barley-01|2026-08-29T18:00:00|Unknown|`,
		"12345.extern|extern|COMPLETING|0:0|2|1|0|0|barley-01|2026-08-29T18:00:00|Unknown|",
		"12345.0|python|COMPLETING|0:0|1|1|0|0|barley-01|2026-08-29T18:00:00|Unknown|",
	].join("\n");
}

function ok(stdout = ""): CompilerGymWarmCommandResult {
	return { exitCode: 0, stdout, stderr: "", wallMs: 1 };
}

class FastClock implements CompilerGymCompleteActionSpaceHeadroomRunnerClock {
	private nanoseconds = 0n;

	now(): Date {
		return new Date(Date.UTC(2026, 7, 29) + Number(this.nanoseconds / 1_000_000n));
	}

	monotonicNs(): bigint {
		this.nanoseconds += 1_000_000n;
		return this.nanoseconds;
	}

	sleep(_ms: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) return Promise.reject(signal.reason);
		this.nanoseconds += 120_000_000_000n;
		return Promise.resolve();
	}
}

class LocalSealGuard {
	private dispatchBoundaryReached = false;
	private preExistingLockCount = 0;

	constructor(
		readonly preregistrationPath: string,
		readonly outputPath: string,
		public lockRoot: string,
	) {}

	async assertBeforeRemote(): Promise<void> {
		await access(this.preregistrationPath);
		assert.equal(
			(await readdir(this.lockRoot)).filter((name) => name.endsWith(".lock")).length,
			this.preExistingLockCount + (this.dispatchBoundaryReached ? 1 : 0),
		);
		await assert.rejects(access(this.outputPath));
	}

	markDispatchBoundary(): void {
		this.dispatchBoundaryReached = true;
	}

	useLockRoot(path: string, preExistingLockCount: number): void {
		this.lockRoot = path;
		this.preExistingLockCount = preExistingLockCount;
	}
}

class FauxRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	readonly files = new Map<string, string>();
	readonly installed: string[] = [];
	readonly readbacks: string[] = [];
	readonly directories: string[] = [];

	constructor(private readonly guard: LocalSealGuard) {}

	async ensurePrivateDirectory(path: string): Promise<void> {
		await this.guard.assertBeforeRemote();
		this.directories.push(path);
	}

	async createPrivateDirectory(path: string): Promise<void> {
		await this.ensurePrivateDirectory(path);
	}

	async installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
	): Promise<void> {
		await this.guard.assertBeforeRemote();
		assert.equal(sha256Text(content), expectedSha256);
		assert.equal(mode, 0o600);
		assert.equal(allowExistingExact, true);
		const existing = this.files.get(path);
		if (existing !== undefined) assert.equal(existing, content);
		this.files.set(path, content);
		this.installed.push(path);
	}

	async linkImmutableFile(): Promise<void> {
		throw new Error("Unexpected immutable link");
	}

	async readTrustedFile(
		path: string,
		options: { maxBytes: number; mode: number; expectedSha256?: string },
	): Promise<string> {
		await this.guard.assertBeforeRemote();
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`Missing faux remote file ${path}`);
		assert.equal(options.mode, 0o600);
		assert.equal(options.maxBytes, Buffer.byteLength(content));
		if (options.expectedSha256) assert.equal(sha256Text(content), options.expectedSha256);
		this.readbacks.push(path);
		return content;
	}

	async exists(path: string): Promise<boolean> {
		await this.guard.assertBeforeRemote();
		return this.files.has(path);
	}
}

type Scenario =
	| "success"
	| "timeout-cleanup"
	| "preexisting"
	| "historical"
	| "probe-failure"
	| "budget-exhausted"
	| "duplicate-json";

class FauxCommandRunner implements CompilerGymWarmCommandRunner {
	readonly requests: CompilerGymWarmCommandRequest[] = [];
	srunAttempts = 0;
	scancelCalls = 0;
	private successAccountingCalls = 0;
	private cleanupSqueueCalls = 0;
	private cleanupAccountingCalls = 0;
	private cancelled = false;

	constructor(
		private readonly protocol: CompilerGymCompleteActionSpaceProtocol,
		private readonly guard: LocalSealGuard,
		private readonly scenario: Scenario,
	) {}

	async run(request: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		const remote = request.argv.at(-1) ?? "";
		if (remote.includes("'/usr/bin/srun'")) this.guard.markDispatchBoundary();
		await this.guard.assertBeforeRemote();
		this.requests.push(request);
		if (remote.includes("'/usr/bin/srun'")) {
			this.srunAttempts++;
			assert.deepEqual(remote, this.expectedOuterRemoteCommand());
			if (this.scenario === "timeout-cleanup") throw new Error("simulated srun timeout");
			const result = completeActionSpaceValidResult(this.protocol);
			if (this.scenario === "budget-exhausted") {
				result.ok = false;
				result.status = "budget_exhausted";
				result.apparatus_completed = false;
				const passGate = result.pass_gate as Record<string, unknown>;
				passGate.passed = false;
				const budget = result.budget as Record<string, unknown>;
				budget.cpu_seconds_observed = 540;
				budget.soft_limit_exhausted = true;
				const timings = result.timings_seconds as Record<string, unknown>;
				timings.cpu = 540;
			}
			if (this.scenario === "duplicate-json") return ok('{"schema_version":1,"schema_version":1}\n');
			const output = JSON.stringify(result).replace('"cpu_seconds_observed":12.5', '"cpu_seconds_observed":1.25e1');
			return ok(`${output}\n`);
		}
		if (remote.includes("compiler_gym_env_probe.py")) {
			return this.scenario === "probe-failure" ? { ...ok(), exitCode: 1, stderr: "probe failed" } : ok(PROBE_OUTPUT);
		}
		if (remote.includes("'/usr/bin/squeue'")) return this.squeue();
		if (remote.includes("'/usr/bin/scancel'")) {
			this.scancelCalls++;
			this.cancelled = true;
			return ok();
		}
		if (remote.includes("'/usr/bin/sacct'") && remote.includes("'--name'")) return this.accountingByName();
		if (remote.includes("'/usr/bin/sacct'")) {
			this.successAccountingCalls++;
			return ok(
				this.successAccountingCalls === 1
					? `${pendingAccounting(this.protocol)}\n`
					: `${successAccounting(this.protocol)}\n`,
			);
		}
		throw new Error(`Unexpected faux command: ${remote}`);
	}

	private expectedOuterRemoteCommand(): string {
		return this.protocol.execution.argv.map((value) => `'${value.replaceAll("'", `'"'"'`)}'`).join(" ");
	}

	private squeue(): CompilerGymWarmCommandResult {
		if (this.scenario === "preexisting" && this.srunAttempts === 0) {
			return ok(`777|${this.protocol.execution.jobName}|PENDING\n`);
		}
		if (this.scenario !== "timeout-cleanup" || this.srunAttempts === 0 || this.cancelled) return ok();
		this.cleanupSqueueCalls++;
		return this.cleanupSqueueCalls === 1 ? ok() : ok(`777|${this.protocol.execution.jobName}|PENDING\n`);
	}

	private accountingByName(): CompilerGymWarmCommandResult {
		if (this.scenario === "historical" && this.srunAttempts === 0) {
			return ok(`888|${this.protocol.execution.jobName}|COMPLETED|0:0\n`);
		}
		if (this.srunAttempts > 0 && (this.scenario === "budget-exhausted" || this.scenario === "duplicate-json")) {
			return ok(`12345|${this.protocol.execution.jobName}|COMPLETED|0:0\n`);
		}
		if (this.scenario !== "timeout-cleanup" || this.srunAttempts === 0) return ok();
		this.cleanupAccountingCalls++;
		if (this.cancelled) {
			return ok(`777|${this.protocol.execution.jobName}|CANCELLED by 123|0:15\n`);
		}
		return this.cleanupAccountingCalls === 1 ? ok() : ok(`777|${this.protocol.execution.jobName}|PENDING|0:0\n`);
	}
}

async function harness(
	scenario: Scenario,
	root: string,
): Promise<{
	runner: CompilerGymCompleteActionSpaceHeadroomRunner;
	commands: FauxCommandRunner;
	remote: FauxRemoteFileSystem;
	guard: LocalSealGuard;
	protocol: CompilerGymCompleteActionSpaceProtocol;
}> {
	const protocol = buildCompilerGymCompleteActionSpaceProtocol(
		await loadCompilerGymCompleteActionSpaceSources(REPO_ROOT),
	);
	const guard = new LocalSealGuard(join(root, "prereg.json"), join(root, "result.json"), join(root, "locks"));
	const commands = new FauxCommandRunner(protocol, guard, scenario);
	const remote = new FauxRemoteFileSystem(guard);
	return {
		protocol,
		guard,
		commands,
		remote,
		runner: new CompilerGymCompleteActionSpaceHeadroomRunner(
			{
				repoRoot: REPO_ROOT,
				preregistrationPath: guard.preregistrationPath,
				outputPath: guard.outputPath,
				dispatchLockRoot: guard.lockRoot,
				...DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS,
			},
			{ commandRunner: commands, remoteFileSystem: remote, clock: new FastClock() },
		),
	};
}

describe("complete action-space one-shot runner", () => {
	it("admits one sealed run, preserves raw streams, and blocks a retry", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-headroom-runner-"));
		const first = await harness("success", root);
		const result = await first.runner.run();
		assert.equal(first.commands.srunAttempts, 1);
		assert.equal(result.disposition, "headroom-demonstrated");
		assert.equal(result.assessment.status, "passed");
		assert.equal(result.modelCalls, 0);
		assert.equal(result.providerCalls, 0);
		assert.equal(result.gpuAllocations, 0);
		assert.equal(result.evaluatorTasks, 1);
		assert.equal(result.cpusPerTask, 1);
		assert.equal(result.schedulerLogicalCpusPerAllocation, 2);
		assert.equal(result.allocation.accounting.root.allocCpus, 2);
		assert.equal(result.allocation.accounting.root.nTasks, null);
		assert.equal(result.allocation.accounting.step.allocCpus, 1);
		assert.equal(result.allocation.accounting.step.nTasks, 1);
		assert.ok(result.allocation.remoteArgv.includes("--export=NONE"));
		assert.ok(result.allocation.remoteArgv.includes(`--job-name=${first.protocol.execution.jobName}`));
		assert.equal(first.remote.installed.length, 3);
		assert.equal(first.remote.readbacks.length, 3);
		const preregistration = JSON.parse(await readFile(first.guard.preregistrationPath, "utf8")) as Record<
			string,
			unknown
		>;
		const scientificDispatchSha256 = String(preregistration.scientificDispatchSha256);
		assert.match(scientificDispatchSha256, /^[a-f0-9]{64}$/);
		assert.ok((await readdir(first.guard.lockRoot))[0]?.includes(scientificDispatchSha256));

		const outputMetadata = await lstat(first.guard.outputPath);
		assert.equal(outputMetadata.mode & 0o777, 0o600);
		const ledger = verifyLedgerContentsStrict(await readFile(result.ledger.path, "utf8"));
		assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).phase, "complete");
		assert.equal(ledger.at(-1)?.hash, result.ledger.terminalEventHash);
		const artifacts = new ArtifactStore(join(dirname(result.ledger.path), "artifacts"));
		const rawStdout = await artifacts.readString(result.allocation.stdout);
		assert.match(rawStdout, /"cpu_seconds_observed":1\.25e1/);
		assert.equal(await artifacts.readString(result.allocation.stderr), "");

		const retryRoot = await mkdtemp(join(tmpdir(), "prime-headroom-retry-"));
		const retry = await harness("success", retryRoot);
		const sharedLockRunner = new CompilerGymCompleteActionSpaceHeadroomRunner(
			{
				repoRoot: REPO_ROOT,
				preregistrationPath: retry.guard.preregistrationPath,
				outputPath: retry.guard.outputPath,
				dispatchLockRoot: first.guard.lockRoot,
				...DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS,
			},
			{ commandRunner: retry.commands, remoteFileSystem: retry.remote, clock: new FastClock() },
		);
		retry.guard.useLockRoot(first.guard.lockRoot, 1);
		await assert.rejects(sharedLockRunner.run(), /EEXIST/);
		assert.equal(retry.commands.srunAttempts, 0);
		await assert.rejects(access(retry.guard.outputPath));
	});

	it("does not consume the scientific lock on zero-dispatch preflight failure", async () => {
		const failedRoot = await mkdtemp(join(tmpdir(), "prime-headroom-preflight-failed-"));
		const failed = await harness("probe-failure", failedRoot);
		await assert.rejects(failed.runner.run(), /FarmShare environment probe failed/);
		assert.equal(failed.commands.srunAttempts, 0);
		assert.deepEqual(await readdir(failed.guard.lockRoot), []);

		const retryRoot = await mkdtemp(join(tmpdir(), "prime-headroom-preflight-retry-"));
		const retry = await harness("success", retryRoot);
		const sharedLockRunner = new CompilerGymCompleteActionSpaceHeadroomRunner(
			{
				repoRoot: REPO_ROOT,
				preregistrationPath: retry.guard.preregistrationPath,
				outputPath: retry.guard.outputPath,
				dispatchLockRoot: failed.guard.lockRoot,
				...DEFAULT_COMPILER_GYM_COMPLETE_ACTION_SPACE_HEADROOM_RUNNER_LIMITS,
			},
			{ commandRunner: retry.commands, remoteFileSystem: retry.remote, clock: new FastClock() },
		);
		retry.guard.useLockRoot(failed.guard.lockRoot, 0);
		const result = await sharedLockRunner.run();
		assert.equal(retry.commands.srunAttempts, 1);
		assert.equal(result.disposition, "headroom-demonstrated");
		assert.equal((await readdir(failed.guard.lockRoot)).filter((name) => name.endsWith(".lock")).length, 1);
	});

	it("discovers a delayed timed-out allocation, cancels it, and admits no output", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-headroom-cleanup-"));
		const test = await harness("timeout-cleanup", root);
		await assert.rejects(test.runner.run(), /simulated srun timeout/);
		assert.equal(test.commands.srunAttempts, 1);
		assert.equal(test.commands.scancelCalls, 1);
		await assert.rejects(access(test.guard.outputPath));
		const ledger = verifyLedgerContentsStrict(
			await readFile(`${test.guard.outputPath}.evidence/evidence.jsonl`, "utf8"),
		);
		const cleanup = ledger.find(
			(event) => (event.payload as Record<string, unknown>).type === "complete_action_space_failure_cleanup",
		);
		assert.equal((cleanup?.payload as Record<string, unknown>).status, "cleanup-proved");
		assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).phase, "failed");
		assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).cleanupProofPassed, true);
	});

	it("refuses a pre-existing exact-name job before any srun", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-headroom-preexisting-"));
		const test = await harness("preexisting", root);
		await assert.rejects(test.runner.run(), /already active before dispatch/);
		assert.equal(test.commands.srunAttempts, 0);
		assert.equal(test.commands.scancelCalls, 0);
		await assert.rejects(access(test.guard.outputPath));
	});

	it("refuses historical exact-name accounting before any srun", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-headroom-historical-"));
		const test = await harness("historical", root);
		await assert.rejects(test.runner.run(), /already has accounting history/);
		assert.equal(test.commands.srunAttempts, 0);
		assert.equal(test.commands.scancelCalls, 0);
		assert.deepEqual(await readdir(test.guard.lockRoot), []);
		await assert.rejects(access(test.guard.outputPath));
	});

	it("rejects inconclusive budget evidence and duplicate-key JSON with terminal cleanup proof", async () => {
		for (const scenario of ["budget-exhausted", "duplicate-json"] as const) {
			const root = await mkdtemp(join(tmpdir(), `prime-headroom-${scenario}-`));
			const test = await harness(scenario, root);
			await assert.rejects(
				test.runner.run(),
				scenario === "budget-exhausted" ? /terminally admissible/ : /duplicate object key/,
			);
			assert.equal(test.commands.srunAttempts, 1);
			assert.equal(test.commands.scancelCalls, 0);
			await assert.rejects(access(test.guard.outputPath));
			const ledger = verifyLedgerContentsStrict(
				await readFile(`${test.guard.outputPath}.evidence/evidence.jsonl`, "utf8"),
			);
			assert.equal((ledger.at(-1)?.payload as Record<string, unknown>).cleanupProofPassed, true);
		}
	});
});

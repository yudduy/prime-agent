import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	COMPILER_GYM_JOB_STEP_C1_FIXTURE,
	COMPILER_GYM_JOB_STEP_C1_TASKS,
} from "../src/compiler-gym-job-step-c1-fixture.js";
import { COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL } from "../src/compiler-gym-job-step-qualification.js";
import { buildCompilerGymJobStepSourceBootstrap } from "../src/compiler-gym-job-step-source-bootstrap.js";

const PYTHON_PATH = "/usr/bin/python3";
const ROOT_JOB_ID = "987654322";
const STEP_ID = "8";

interface ChildCompletion {
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

function collectChild(child: ChildProcess): Promise<ChildCompletion> {
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (exitCode, signalCode) => {
			resolve({
				exitCode,
				signalCode,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		try {
			await access(path);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			throw error;
		}
		if (Date.now() >= deadline) throw new Error(`Process ${pid} survived job-step worker cleanup`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

async function assertPathMissing(path: string): Promise<void> {
	await assert.rejects(access(path), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
}

function killEvaluatorGroup(pid: number | undefined): void {
	if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) return;
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

describe("CompilerGym job-step worker signal cleanup", () => {
	it("kills evaluator descendants without publishing", { timeout: 15_000 }, async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-job-step-worker-signal-"));
		let worker: ChildProcess | undefined;
		let workerCompletion: Promise<ChildCompletion> | undefined;
		let evaluatorPid: number | undefined;
		try {
			const workerSourcePath = fileURLToPath(
				new URL("../evaluators/compiler_gym_job_step_worker.py", import.meta.url),
			);
			const requestPath = join(root, "request.json");
			const evaluatorPidPath = join(root, "evaluator.pid");
			const descendantPidPath = join(root, "descendant.pid");
			const escapedSentinelPath = join(root, "descendant-escaped");
			const workerSource = await readFile(workerSourcePath, "utf8");
			const evaluatorSource = `#!/usr/bin/env python3
import os
import signal
import subprocess
import sys
import time

signal.signal(signal.SIGINT, signal.SIG_IGN)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
with open(${JSON.stringify(evaluatorPidPath)}, "w", encoding="utf-8") as stream:
    stream.write(str(os.getpid()))
    stream.flush()
    os.fsync(stream.fileno())
descendant_source = '''
import os
import signal
import sys
import time
signal.signal(signal.SIGINT, signal.SIG_IGN)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
with open(sys.argv[1], "w", encoding="utf-8") as stream:
    stream.write(str(os.getpid()))
    stream.flush()
    os.fsync(stream.fileno())
time.sleep(1)
with open(sys.argv[2], "w", encoding="utf-8") as stream:
    stream.write("escaped")
time.sleep(60)
'''
subprocess.Popen([
    sys.executable,
    "-c",
    descendant_source,
    ${JSON.stringify(descendantPidPath)},
    ${JSON.stringify(escapedSentinelPath)},
])
deadline = time.monotonic() + 5
while not os.path.exists(${JSON.stringify(descendantPidPath)}):
    if time.monotonic() >= deadline:
        raise RuntimeError("descendant did not start")
    time.sleep(0.01)
time.sleep(60)
`;
			const workerSha256 = sha256Text(workerSource);
			const evaluatorSha256 = sha256Text(evaluatorSource);
			const bootstrap = buildCompilerGymJobStepSourceBootstrap({
				workerSource,
				workerSha256,
				evaluatorSource,
				evaluatorSha256,
			});
			const request = {
				protocol: COMPILER_GYM_JOB_STEP_REQUEST_PROTOCOL,
				candidateId: "C1",
				requestSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.requestSha256,
				actionsSha256: COMPILER_GYM_JOB_STEP_C1_FIXTURE.actionsSha256,
				actions: [...COMPILER_GYM_JOB_STEP_C1_FIXTURE.request.actions],
				tasks: [...COMPILER_GYM_JOB_STEP_C1_TASKS],
				workerSha256,
				evaluatorSha256,
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				createdAt: "2026-08-28T00:00:00.000Z",
			};
			const requestContent = `${canonicalJson(toJsonValue(request))}\n`;
			await writeFile(requestPath, requestContent, { encoding: "utf8", mode: 0o600 });
			await chmod(requestPath, 0o600);

			worker = spawn(
				PYTHON_PATH,
				[
					"-c",
					bootstrap.pythonSource,
					"--request",
					requestPath,
					"--request-file-sha256",
					sha256Text(requestContent),
					"--worker-sha256",
					workerSha256,
					"--evaluator-sha256",
					evaluatorSha256,
					"--python",
					PYTHON_PATH,
					"--expected-root-job-id",
					ROOT_JOB_ID,
				],
				{
					env: {
						...process.env,
						SLURM_JOB_ID: ROOT_JOB_ID,
						SLURM_STEP_ID: STEP_ID,
						SLURM_PROCID: "0",
						SLURM_CPUS_PER_TASK: "2",
					},
				},
			);
			workerCompletion = collectChild(worker);
			await Promise.race([
				Promise.all([waitForFile(evaluatorPidPath), waitForFile(descendantPidPath)]),
				workerCompletion.then((completed) => {
					throw new Error(
						`worker exited before the evaluator fixture was ready: ${completed.exitCode}: ${completed.stderr}${completed.stdout}`,
					);
				}),
			]);
			evaluatorPid = Number.parseInt((await readFile(evaluatorPidPath, "utf8")).trim(), 10);
			const descendantPid = Number.parseInt((await readFile(descendantPidPath, "utf8")).trim(), 10);
			assert.ok(Number.isSafeInteger(evaluatorPid) && evaluatorPid > 0);
			assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);

			assert.equal(worker.kill("SIGTERM"), true);
			await new Promise((resolve) => setTimeout(resolve, 25));
			assert.equal(worker.kill("SIGINT"), true);
			const completed = await workerCompletion;
			assert.equal(completed.exitCode, 143, completed.stderr);
			assert.equal(completed.signalCode, null);
			assert.equal(completed.stdout, "", "cancelled workers must not publish a result record");
			assert.match(completed.stderr, /compiler-gym-job-step-worker:signal:worker received SIGTERM/);
			await Promise.all([waitForProcessExit(evaluatorPid), waitForProcessExit(descendantPid)]);
			await new Promise((resolve) => setTimeout(resolve, 1_100));
			await assertPathMissing(escapedSentinelPath);
			const taskDigest = sha256Text(COMPILER_GYM_JOB_STEP_C1_TASKS[0]).slice(0, 12);
			await assertPathMissing(`/tmp/prime-autoresearch-job-step-${ROOT_JOB_ID}-${STEP_ID}-0-${taskDigest}`);
		} finally {
			if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
			killEvaluatorGroup(evaluatorPid);
			if (workerCompletion) await workerCompletion.catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		}
	});
});

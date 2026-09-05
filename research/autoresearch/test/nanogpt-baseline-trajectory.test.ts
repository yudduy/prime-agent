import assert from "node:assert/strict";
import type { ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256Text } from "../src/canonical-json.js";
import {
	createNanoGptBaselineNonce,
	NANOGPT_BASELINE_DURATION_MS,
	NANOGPT_BASELINE_MODEL,
	NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT,
	prepareNanoGptBaselineWorkspace,
	readExactNanoGptBaselineProgram,
} from "../src/nanogpt-baseline-protocol.js";
import type { NanoGptBaselineControllerOwner } from "../src/nanogpt-baseline-proxy.js";
import {
	type NanoGptBaselineAgentSession,
	NanoGptBaselineTrajectory,
	type NanoGptBaselineTrajectoryProxy,
	runNanoGptBaselineHarness,
} from "../src/nanogpt-baseline-trajectory.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class FauxProxy implements NanoGptBaselineTrajectoryProxy {
	readonly closeReasons: string[] = [];
	jobs: string[] = [];

	closeAdmission(reason: string): Promise<void> {
		this.closeReasons.push(reason);
		return Promise.resolve();
	}

	activeJobIds(): readonly string[] {
		return this.jobs;
	}

	completedResults() {
		return [];
	}

	champion() {
		return null;
	}
}

class FauxHarnessOwner implements NanoGptBaselineControllerOwner {
	readonly gpuCapacity = 4 as const;
	readonly agentFacingConcurrency = 1 as const;
	private counter = 0;
	private readonly modes = new Map<string, "smoke-10" | "score-1" | "score-3" | "replay-8">();

	submitStage(input: Parameters<NanoGptBaselineControllerOwner["submitStage"]>[0]): Promise<string> {
		const jobId = `job_harness_${this.counter++}_${input.mode}`;
		this.modes.set(jobId, input.mode);
		return Promise.resolve(jobId);
	}

	waitForStage(jobId: string) {
		const mode = this.modes.get(jobId);
		if (!mode) throw new Error(`unknown faux harness job ${jobId}`);
		return Promise.resolve({
			mode,
			jobId,
			status: "succeeded" as const,
			trainSteps: mode === "smoke-10" ? 3290 : 3200,
			meanValidationLoss: mode === "smoke-10" ? null : 3.2,
			thresholdPassed: mode === "smoke-10" ? null : true,
			recordEligible: mode === "replay-8",
		});
	}

	activeJobIds(): readonly string[] {
		return [];
	}
}

class FauxSession implements NanoGptBaselineAgentSession {
	readonly sessionId = "session-faux";
	readonly sessionFile = "/tmp/session-faux.jsonl";
	readonly provider = NANOGPT_BASELINE_MODEL.provider;
	readonly modelId = NANOGPT_BASELINE_MODEL.id;
	readonly thinkingLevel = NANOGPT_BASELINE_MODEL.thinkingLevel;
	readonly serviceTier = NANOGPT_BASELINE_MODEL.serviceTier;
	readonly activeToolNames = ["ipython"] as const;
	readonly prompts: string[] = [];
	readonly persistedUserMessages: string[] = [];
	aborted = false;
	disposed = false;
	output = 0;
	outputAfterPrompt = 0;
	private listeners = new Set<() => void>();

	async promptAndWait(prompt: string): Promise<void> {
		this.prompts.push(prompt);
		this.persistedUserMessages.push(prompt);
		this.output = this.outputAfterPrompt;
		for (const listener of this.listeners) listener();
	}

	waitForRlmQuiescence(): Promise<void> {
		return Promise.resolve();
	}

	abort(): Promise<void> {
		this.aborted = true;
		return Promise.resolve();
	}

	dispose(): Promise<void> {
		this.disposed = true;
		return Promise.resolve();
	}

	outputTokens(): number {
		return this.output;
	}

	userMessages(): readonly string[] {
		return this.persistedUserMessages;
	}

	subscribeUsage(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

function execText(command: string, args: readonly string[], cwd: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			command,
			args,
			{ cwd, encoding: "utf8", maxBuffer: 1024 * 1024 },
			(error: ExecFileException | null, stdout, stderr) => {
				if (error) {
					reject(new Error(`${command} failed: ${error.message}; ${stderr.trim()}`));
					return;
				}
				resolvePromise(stdout);
			},
		);
	});
}

async function fixture(now: Date) {
	const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-baseline-trajectory-"));
	temporaryDirectories.push(root);
	const workspace = await prepareNanoGptBaselineWorkspace({
		workspaceDir: join(root, "workspace"),
		socketPath: join(root, "proxy.sock"),
		nonce: createNanoGptBaselineNonce(),
	});
	const proxy = new FauxProxy();
	const sessions: FauxSession[] = [];
	const options = {
		stateDir: join(root, "state"),
		runId: "baseline-run-test",
		branchId: "baseline-branch-test",
		workspace,
		proxy,
		sessionFactory: () => {
			const session = new FauxSession();
			sessions.push(session);
			return Promise.resolve(session);
		},
		now: () => now,
	};
	return { root, workspace, proxy, sessions, options };
}

describe("NanoGPT stock Prime trajectory", () => {
	it("composes the sealed shims, local socket, proxy owner, and sole prompt without live services", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-baseline-harness-"));
		temporaryDirectories.push(root);
		let runLogPath = "";
		let verifyOutput = "";
		const result = await runNanoGptBaselineHarness({
			rootDir: root,
			runId: "model-free-harness-test",
			branchId: "model-free-harness-branch",
			owner: new FauxHarnessOwner(),
			staticGate: async (patch) => ({
				contract: "nanogpt-track3-static-contract-v1",
				repositoryCommit: "38e258afefb1ce206dd7595aa71d7740da405742",
				programSha256: "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08",
				evaluatorSha256: "1".repeat(64),
				baselineSha256: "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e",
				patchSha256: sha256Text(patch),
				candidateSha256: "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e",
				trainSteps: 3290,
				frozenSegmentSha256: ["2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(64)],
				editableSegmentSha256: ["6".repeat(64), "7".repeat(64), "8".repeat(64)],
			}),
			sessionFactory: async ({ workspaceDir }) => {
				const session = new FauxSession();
				const originalPrompt = session.promptAndWait.bind(session);
				session.promptAndWait = async (prompt) => {
					await originalPrompt(prompt);
					runLogPath = (await execText("bash", ["run.sh"], workspaceDir)).trim();
					verifyOutput = (await execText("python3", ["verify.py", runLogPath], workspaceDir)).trim();
				};
				return session;
			},
		});
		assert.match(runLogPath, /^logs\/[0-9a-f]{32}\.txt$/);
		assert.match(verifyOutput, /^verified score-1 job_harness_/);
		assert.equal(result.initialUserMessageCount, 1);
		assert.equal(result.completedOperationCount, 1);
		assert.equal(result.stopReason, "agent-returned");
	});

	it("delivers exact program.md once and records the stock runtime contract", async () => {
		const test = await fixture(new Date("2026-08-30T10:00:00.000Z"));
		const trajectory = await NanoGptBaselineTrajectory.open(test.options);
		const result = await trajectory.run();
		assert.equal(test.sessions.length, 1);
		assert.deepEqual(test.sessions[0].prompts, [await readExactNanoGptBaselineProgram()]);
		assert.equal(result.initialUserMessageCount, 1);
		assert.equal(result.stopReason, "agent-returned");
		assert.equal(result.phase, "finished");
		assert.equal(result.runtimePolicy.defaultPrimeSystemPrompt, true);
		assert.equal(result.runtimePolicy.nativeCompaction, true);
		assert.equal(result.runtimePolicy.nativeRlmLifecycle, true);
		assert.deepEqual(result.runtimePolicy.activeTools, ["ipython"]);
		assert.deepEqual(test.proxy.closeReasons, ["agent-returned"]);
		assert.equal(test.sessions[0].aborted, false);
		assert.equal(test.sessions[0].disposed, true);

		const reopened = await NanoGptBaselineTrajectory.open(test.options);
		assert.equal((await reopened.run()).initialUserMessageCount, 1);
		assert.equal(test.sessions.length, 1, "a finished trajectory must not create or reprompt a session");
	});

	it("preserves the original deadline across restart and closes admission before any late prompt", async () => {
		const startedAt = new Date("2026-08-30T10:00:00.000Z");
		const test = await fixture(startedAt);
		const initial = await NanoGptBaselineTrajectory.open(test.options);
		const initialState = initial.getState();
		assert.equal(
			Date.parse(initialState.deadlineAt) - Date.parse(initialState.startedAt),
			NANOGPT_BASELINE_DURATION_MS,
		);

		const afterDeadline = new Date(startedAt.getTime() + NANOGPT_BASELINE_DURATION_MS + 1);
		const restarted = await NanoGptBaselineTrajectory.open({ ...test.options, now: () => afterDeadline });
		const result = await restarted.run();
		assert.equal(result.startedAt, initialState.startedAt);
		assert.equal(result.deadlineAt, initialState.deadlineAt);
		assert.equal(result.stopReason, "calendar-checkpoint");
		assert.equal(test.sessions[0].prompts.length, 0);
		assert.equal(test.sessions[0].aborted, true);
		assert.deepEqual(test.proxy.closeReasons, ["calendar-checkpoint"]);
	});

	it("recovers a session-persisted initial prompt without sending a duplicate after a host crash", async () => {
		const test = await fixture(new Date("2026-08-30T10:00:00.000Z"));
		const initial = await NanoGptBaselineTrajectory.open(test.options);
		assert.equal(initial.getState().initialUserMessageCount, 0);
		const program = await readExactNanoGptBaselineProgram();
		test.options.sessionFactory = () => {
			const session = new FauxSession();
			session.persistedUserMessages.push(program);
			test.sessions.push(session);
			return Promise.resolve(session);
		};
		const result = await (await NanoGptBaselineTrajectory.open(test.options)).run();
		assert.equal(test.sessions[0].prompts.length, 0);
		assert.deepEqual(test.sessions[0].persistedUserMessages, [program]);
		assert.equal(result.initialUserMessageCount, 1);
	});

	it("checkpoints attributed root-and-child output and aborts with the honest compaction caveat", async () => {
		const test = await fixture(new Date("2026-08-30T10:00:00.000Z"));
		test.options.sessionFactory = () => {
			const session = new FauxSession();
			session.outputAfterPrompt = NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT + 7;
			test.sessions.push(session);
			return Promise.resolve(session);
		};
		const result = await (await NanoGptBaselineTrajectory.open(test.options)).run();
		assert.equal(result.stopReason, "output-token-checkpoint");
		assert.equal(result.observedAttributedOutputTokens, NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT + 7);
		assert.match(result.outputAccounting, /native compaction usage unavailable/);
		assert.match(result.limitations.outputTokens, /already admitted provider response may overshoot/);
		assert.equal(test.sessions[0].aborted, true);
	});

	it("persists outstanding evaluator IDs while acknowledging cancellation is unsupported", async () => {
		const test = await fixture(new Date("2026-08-30T10:00:00.000Z"));
		test.proxy.jobs = ["job_pending_score_1"];
		const result = await (await NanoGptBaselineTrajectory.open(test.options)).run();
		assert.deepEqual(result.pendingJobIds, ["job_pending_score_1"]);
		assert.equal(result.outstandingEvaluatorCancellation, "unsupported");
		assert.match(result.limitations.calendar, /remain outstanding/);
	});

	it("durably records a session bootstrap failure before any provider turn", async () => {
		const test = await fixture(new Date("2026-08-30T10:00:00.000Z"));
		test.options.sessionFactory = () => Promise.reject(new Error("faux auth unavailable"));
		const result = await (await NanoGptBaselineTrajectory.open(test.options)).run();
		assert.equal(result.phase, "failed");
		assert.equal(result.stopReason, "session-failed");
		assert.equal(result.initialUserMessageCount, 0);
		assert.match(result.failures[0]?.message ?? "", /faux auth unavailable/);
		assert.deepEqual(test.proxy.closeReasons, ["session-failed"]);
	});
});

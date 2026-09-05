import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { sha256Text } from "../src/canonical-json.js";
import {
	createNanoGptBaselineNonce,
	NANOGPT_BASELINE_SCORE_ONE_TIMEOUT,
	prepareNanoGptBaselineWorkspace,
} from "../src/nanogpt-baseline-protocol.js";
import {
	type NanoGptBaselineControllerOwner,
	NanoGptBaselineProxy,
	NanoGptBaselineProxyServer,
	type NanoGptBaselineStageSubmission,
	ResearchControllerNanoGptBaselineOwner,
} from "../src/nanogpt-baseline-proxy.js";
import {
	NANOGPT_BASELINE_SHA256,
	NANOGPT_CONTRACT_ID,
	NANOGPT_PROGRAM_SHA256,
	NANOGPT_SPEEDRUN_COMMIT,
} from "../src/nanogpt-contract.js";
import {
	inferNanoGptScoredMode,
	type NanoGptScoredMode,
	type NanoGptScoredStaticEvidence,
	type NanoGptScoredVerifierPins,
} from "../src/nanogpt-scored-protocol.js";
import type { EvaluationAdapter, EvaluationJob, EvaluationOutcome } from "../src/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fauxStaticGate(candidatePatch: string): Promise<NanoGptScoredStaticEvidence> {
	return Promise.resolve({
		contract: NANOGPT_CONTRACT_ID,
		repositoryCommit: NANOGPT_SPEEDRUN_COMMIT,
		programSha256: NANOGPT_PROGRAM_SHA256,
		evaluatorSha256: sha256Text("faux-static-evaluator"),
		baselineSha256: NANOGPT_BASELINE_SHA256,
		patchSha256: sha256Text(candidatePatch),
		candidateSha256: NANOGPT_BASELINE_SHA256,
		trainSteps: 3290,
		frozenSegmentSha256: [0, 1, 2, 3].map((index) => sha256Text(`frozen-${index}`)),
		editableSegmentSha256: [0, 1, 2].map((index) => sha256Text(`editable-${index}`)),
	});
}

const FAUX_PINS: NanoGptScoredVerifierPins = {
	staticEvaluatorSha256: sha256Text("faux-static-evaluator"),
	environmentSha256: sha256Text("faux-environment"),
	environmentSealSha256: sha256Text("faux-environment-seal"),
	datasetManifestSha256: sha256Text("faux-dataset"),
	workerSha256: sha256Text("faux-worker"),
	transportSha256: sha256Text("faux-transport"),
};

class FauxControllerAdapter implements EvaluationAdapter {
	readonly lane = "nanogpt" as const;

	async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
		const mode = inferNanoGptScoredMode(job.benchmarkIds);
		return {
			verifierEpoch: "faux-baseline-owner-v1",
			tasks: job.benchmarkIds.map((benchmarkId) => {
				const metrics: Record<string, number> =
					mode === "replay-8" ? { verified_steps: 3200 } : { validation_loss: 3.2 };
				return {
					benchmarkId,
					status: "accepted" as const,
					metrics,
					verifier: { passed: true, checks: ["faux"], errors: [] },
					runtimeMs: 1,
				};
			}),
			hardware: { gpu: "faux-L40S" },
			provenance: {
				mode,
				trainSteps: mode === "smoke-10" ? "3290" : "3200",
				meanValidationLoss: mode === "smoke-10" ? "not-scored" : "3.2",
				thresholdPassed: mode === "smoke-10" ? "not-scored" : "true",
				recordEligible: String(mode === "replay-8"),
			},
		};
	}
}

class FauxOwner implements NanoGptBaselineControllerOwner {
	readonly gpuCapacity = 4 as const;
	readonly agentFacingConcurrency = 1 as const;
	readonly submissions: Array<NanoGptBaselineStageSubmission & { readonly jobId: string }> = [];
	readonly modes = new Map<string, NanoGptScoredMode>();
	waitFailureCount = 0;
	active = 0;
	maxActive = 0;
	private counter = 0;

	async submitStage(input: NanoGptBaselineStageSubmission): Promise<string> {
		const jobId = `job_${this.counter++}_${input.mode}`;
		this.submissions.push({ ...input, jobId });
		this.modes.set(jobId, input.mode);
		this.active++;
		this.maxActive = Math.max(this.maxActive, this.active);
		return jobId;
	}

	async waitForStage(jobId: string) {
		if (this.waitFailureCount > 0) {
			this.waitFailureCount--;
			throw new Error("simulated owner crash after durable controller submission");
		}
		await delay(2);
		this.active = Math.max(0, this.active - 1);
		const mode = this.modes.get(jobId) ?? inferMode(jobId);
		return {
			mode,
			jobId,
			status: "succeeded" as const,
			trainSteps: mode === "smoke-10" ? 3290 : 3200,
			meanValidationLoss: mode === "smoke-10" ? null : 3.2,
			thresholdPassed: mode === "smoke-10" ? null : true,
			recordEligible: mode === "replay-8",
		};
	}

	activeJobIds(): readonly string[] {
		return this.active > 0 ? [this.submissions.at(-1)?.jobId ?? "job_recovered"] : [];
	}
}

function inferMode(jobId: string): NanoGptScoredMode {
	for (const mode of ["smoke-10", "score-1", "score-3", "replay-8"] as const) {
		if (jobId.endsWith(mode)) return mode;
	}
	throw new Error(`cannot infer mode from ${jobId}`);
}

async function fixture(owner: FauxOwner) {
	const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-baseline-proxy-"));
	temporaryDirectories.push(root);
	const nonce = createNanoGptBaselineNonce();
	const socketPath = join(root, "proxy.sock");
	const workspace = await prepareNanoGptBaselineWorkspace({
		workspaceDir: join(root, "workspace"),
		socketPath,
		nonce,
	});
	const options = {
		stateDir: join(root, "state"),
		branchId: "stock-trajectory-test",
		workspace,
		owner,
		staticGate: fauxStaticGate,
	} as const;
	return { root, nonce, socketPath, workspace, options, proxy: await NanoGptBaselineProxy.open(options) };
}

function ipc(socketPath: string, request: unknown): Promise<Record<string, unknown>> {
	return new Promise((resolvePromise, reject) => {
		const socket = createConnection(socketPath);
		let source = "";
		socket.setEncoding("utf8");
		socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
		socket.on("data", (chunk: string) => {
			source += chunk;
		});
		socket.on("error", reject);
		socket.on("end", () => resolvePromise(JSON.parse(source) as Record<string, unknown>));
	});
}

describe("NanoGPT baseline sealed run proxy", () => {
	it("owns one durable generic controller configured for four NanoGPT GPU slots", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-baseline-owner-"));
		temporaryDirectories.push(root);
		const owner = await ResearchControllerNanoGptBaselineOwner.open({
			ledgerPath: join(root, "evidence.jsonl"),
			artifactDir: join(root, "artifacts"),
			adapter: new FauxControllerAdapter(),
			pins: FAUX_PINS,
			branchId: "baseline-owner-test",
			scoreOneTransportTimeout: NANOGPT_BASELINE_SCORE_ONE_TIMEOUT,
		});
		const candidatePatch = await readFile(
			join(import.meta.dirname, "../fixtures/nanogpt/stock-identity.patch"),
			"utf8",
		);
		const smokeJobId = await owner.submitStage({ candidatePatch, mode: "smoke-10", parentJobId: null });
		assert.equal((await owner.waitForStage(smokeJobId)).status, "succeeded");
		const scoreJobId = await owner.submitStage({
			candidatePatch,
			mode: "score-1",
			parentJobId: smokeJobId,
		});
		assert.equal((await owner.waitForStage(scoreJobId)).thresholdPassed, true);
		assert.equal(owner.gpuCapacity, 4);
		assert.equal(owner.agentFacingConcurrency, 1);
		assert.deepEqual(owner.activeJobIds(), []);
	});

	it("serializes concurrent agent requests despite provisioning controller capacity four", async () => {
		const owner = new FauxOwner();
		const { proxy } = await fixture(owner);
		const [left, right] = await Promise.all([proxy.run("0".repeat(32), 1), proxy.run("1".repeat(32), 1)]);
		assert.equal(left.reachedRequestedStage, true);
		assert.equal(right.reachedRequestedStage, true);
		assert.equal(owner.maxActive, 1);
		assert.deepEqual(
			owner.submissions.map((submission) => submission.mode),
			["smoke-10", "score-1", "smoke-10", "score-1"],
		);
	});

	it("binds each widening stage to its exact candidate-specific parent", async () => {
		const owner = new FauxOwner();
		const { proxy } = await fixture(owner);
		const outcome = await proxy.run("2".repeat(32), 8);
		assert.equal(outcome.reachedRequestedStage, true);
		assert.deepEqual(
			owner.submissions.map(({ mode, parentJobId }) => ({ mode, parentJobId })),
			[
				{ mode: "smoke-10", parentJobId: null },
				{ mode: "score-1", parentJobId: "job_0_smoke-10" },
				{ mode: "score-3", parentJobId: "job_1_score-1" },
				{ mode: "replay-8", parentJobId: "job_2_score-3" },
			],
		);
	});

	it("recovers a crash after the durable job binding without a duplicate stage submission", async () => {
		const firstOwner = new FauxOwner();
		firstOwner.waitFailureCount = 1;
		const test = await fixture(firstOwner);
		await assert.rejects(test.proxy.run("3".repeat(32), 1), /simulated owner crash/);
		assert.equal(firstOwner.submissions.length, 1);
		await test.proxy.closeAdmission("calendar-checkpoint");

		const recoveredOwner = new FauxOwner();
		recoveredOwner.modes.set(firstOwner.submissions[0].jobId, "smoke-10");
		const recovered = await NanoGptBaselineProxy.open({ ...test.options, owner: recoveredOwner });
		const outcome = await recovered.run("3".repeat(32), 1);
		assert.equal(outcome.reachedRequestedStage, true);
		assert.deepEqual(
			recoveredOwner.submissions.map((submission) => submission.mode),
			["score-1"],
		);
		await assert.rejects(recovered.run("7".repeat(32), 1), /admission is closed/);
	});

	it("returns an already terminal operation after restart and verifies only its host-bound log", async () => {
		const owner = new FauxOwner();
		const test = await fixture(owner);
		const operationId = "4".repeat(32);
		const first = await test.proxy.run(operationId, 1);
		const restartedOwner = new FauxOwner();
		const restarted = await NanoGptBaselineProxy.open({ ...test.options, owner: restartedOwner });
		const second = await restarted.run(operationId, 1);
		assert.deepEqual(second, first);
		assert.equal(restartedOwner.submissions.length, 0);
		assert.match(await restarted.verifyLog(first.result.logPath), /^verified score-1/);
		await writeFile(join(test.workspace.workspaceDir, first.result.logPath), "tampered\n", "utf8");
		await assert.rejects(restarted.verifyLog(first.result.logPath), /digest does not match/);
	});

	it("requires the workspace nonce on its local Unix socket", async () => {
		const owner = new FauxOwner();
		const test = await fixture(owner);
		const server = new NanoGptBaselineProxyServer({
			socketPath: test.socketPath,
			nonce: test.nonce,
			proxy: test.proxy,
		});
		await server.start();
		try {
			const duplicate = new NanoGptBaselineProxyServer({
				socketPath: test.socketPath,
				nonce: test.nonce,
				proxy: test.proxy,
			});
			await assert.rejects(duplicate.start(), /already listening/);
			const rejected = await ipc(test.socketPath, {
				schemaVersion: 1,
				kind: "verify",
				nonce: "0".repeat(64),
				logPath: `logs/${"0".repeat(32)}.txt`,
			});
			assert.equal(rejected.ok, false);
			assert.match(String(rejected.error), /nonce mismatch/);
		} finally {
			await server.close();
		}
	});

	it("runs the production static contract before accepting a candidate snapshot", async () => {
		const owner = new FauxOwner();
		const test = await fixture(owner);
		const proxy = await NanoGptBaselineProxy.open({
			stateDir: join(test.root, "production-static-state"),
			branchId: test.options.branchId,
			workspace: test.workspace,
			owner,
		});
		const result = await proxy.run("5".repeat(32), 1);
		assert.equal(result.reachedRequestedStage, true);
		assert.equal(result.result.candidateSha256, NANOGPT_BASELINE_SHA256);
	});

	it("generates the one-allowed-file diff before an injected static gate", async () => {
		const owner = new FauxOwner();
		const test = await fixture(owner);
		let observedPatch = "";
		const proxy = await NanoGptBaselineProxy.open({
			...test.options,
			stateDir: join(test.root, "independent-state"),
			staticGate: async (patch) => {
				observedPatch = patch;
				return fauxStaticGate(patch);
			},
		});
		await proxy.run("6".repeat(32), 1);
		assert.match(observedPatch, /^--- a\/train_gpt_simple\.py/m);
		assert.equal(
			sha256Text(await readFile(join(test.workspace.workspaceDir, "train_gpt_simple.py"), "utf8")),
			NANOGPT_BASELINE_SHA256,
		);
	});
});

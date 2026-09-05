import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sha256Text } from "../src/canonical-json.js";
import {
	buildNanoGptBaselineValidationPlan,
	createNanoGptBaselineNonce,
	NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION,
	NANOGPT_BASELINE_PROGRAM_BYTES,
	NANOGPT_BASELINE_RUNTIME_POLICY,
	NANOGPT_BASELINE_SCORE_ONE_TIMEOUT,
	nanoGptBaselineStageSequence,
	prepareNanoGptBaselineWorkspace,
	readExactNanoGptBaselineProgram,
	selectNanoGptBaselineChampion,
	verifyNanoGptBaselineWorkspaceFrozen,
} from "../src/nanogpt-baseline-protocol.js";
import { NANOGPT_PROGRAM_SHA256 } from "../src/nanogpt-contract.js";
import { NANOGPT_SCORED_SLURM_TIMES } from "../src/nanogpt-scored-transport.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("NanoGPT exact-prompt baseline protocol", () => {
	it("pins the exact 5,713-byte program as the sole benchmark prompt", async () => {
		const program = await readExactNanoGptBaselineProgram();
		assert.equal(Buffer.byteLength(program), NANOGPT_BASELINE_PROGRAM_BYTES);
		assert.equal(sha256Text(program), NANOGPT_PROGRAM_SHA256);
		assert.equal(program.startsWith("# program.md — autonomous optimizer speedrun\n"), true);
		assert.equal(program.endsWith("Everything else is up to you.\n"), true);
	});

	it("keeps the prompt's serial policy while recording the L40S timeout adaptation", () => {
		assert.equal(NANOGPT_BASELINE_RUNTIME_POLICY.defaultPrimeSystemPrompt, true);
		assert.equal(NANOGPT_BASELINE_RUNTIME_POLICY.nativeCompaction, true);
		assert.equal(NANOGPT_BASELINE_RUNTIME_POLICY.nativeRlmLifecycle, true);
		assert.deepEqual(NANOGPT_BASELINE_RUNTIME_POLICY.activeTools, ["ipython"]);
		assert.equal(NANOGPT_BASELINE_RUNTIME_POLICY.webTools, false);
		assert.equal(NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION.agentFacingPolicy, "strictly-sequential-as-prompted");
		assert.equal(NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION.scoreOneTimeout, NANOGPT_BASELINE_SCORE_ONE_TIMEOUT);
		assert.equal(NANOGPT_BASELINE_SCORE_ONE_TIMEOUT, NANOGPT_SCORED_SLURM_TIMES["score-1"]);
		assert.equal(NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION.shimTimeout, "none-do-not-apply-prompt-default-2h");
		assert.match(NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION.runtimeSemantics, /not-byte-exact/);
	});

	it("materializes and then fail-closes frozen workspace assets", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-nanogpt-baseline-workspace-"));
		temporaryDirectories.push(root);
		const workspace = join(root, "workspace");
		const manifest = await prepareNanoGptBaselineWorkspace({
			workspaceDir: workspace,
			socketPath: join(root, "proxy.sock"),
			nonce: createNanoGptBaselineNonce(),
		});
		await verifyNanoGptBaselineWorkspaceFrozen(manifest);
		assert.equal(manifest.frozenAssets.length, 4);
		assert.deepEqual(await readFile(join(workspace, "program.md"), "utf8"), await readExactNanoGptBaselineProgram());
		assert.equal(manifest.compatibilityAdaptation.scoreOneTimeout, "06:00:00");

		await chmod(join(workspace, "run.sh"), 0o755);
		await assert.rejects(verifyNanoGptBaselineWorkspaceFrozen(manifest), /Frozen baseline asset integrity failed/);
		await chmod(join(workspace, "run.sh"), 0o555);
		await writeFile(join(workspace, "public-winning-traces.json"), "{}\n", "utf8");
		await assert.rejects(verifyNanoGptBaselineWorkspaceFrozen(manifest), /Unexpected top-level/);
	});

	it("maps run.sh widening onto candidate-specific smoke, 1, 3, and 8 stages", () => {
		assert.deepEqual(nanoGptBaselineStageSequence(1), ["smoke-10", "score-1"]);
		assert.deepEqual(nanoGptBaselineStageSequence(3), ["smoke-10", "score-1", "score-3"]);
		assert.deepEqual(nanoGptBaselineStageSequence(8), ["smoke-10", "score-1", "score-3", "replay-8"]);
	});

	it("seals the deterministic lowest-step champion and plans a separate clean replay branch", () => {
		const common = {
			trials: 8 as const,
			candidatePatchSha256: "b".repeat(64),
			stages: [],
			logPath: "logs/00000000000000000000000000000000.txt",
			logSha256: "c".repeat(64),
		};
		const results = [
			{
				...common,
				operationId: "0".repeat(32),
				candidateSha256: "f".repeat(64),
				terminalStage: {
					mode: "replay-8" as const,
					jobId: "job_slow",
					status: "succeeded" as const,
					trainSteps: 3200,
					meanValidationLoss: 3.2,
					thresholdPassed: true,
					recordEligible: true,
				},
			},
			{
				...common,
				operationId: "1".repeat(32),
				candidateSha256: "a".repeat(64),
				terminalStage: {
					mode: "replay-8" as const,
					jobId: "job_fast",
					status: "succeeded" as const,
					trainSteps: 3100,
					meanValidationLoss: 3.25,
					thresholdPassed: true,
					recordEligible: true,
				},
			},
		];
		const champion = selectNanoGptBaselineChampion(results);
		assert.equal(champion?.sourceJobId, "job_fast");
		assert.ok(champion);
		const plan = buildNanoGptBaselineValidationPlan("trajectory-a", champion);
		assert.equal(plan.branchId, "trajectory-a-post-terminal-validation");
		assert.deepEqual(plan.stages, ["smoke-10", "score-1", "score-3", "replay-8"]);
		assert.deepEqual(plan.prerequisiteLineageStages, ["smoke-10", "score-1"]);
		assert.deepEqual(plan.requestedConfirmationStages, ["score-3", "replay-8"]);
		assert.match(plan.cleanReplayMeaning, /not statistically unseen seeds/);
	});
});

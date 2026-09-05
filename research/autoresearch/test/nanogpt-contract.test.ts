import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	NANOGPT_BASELINE_FIXTURE,
	NANOGPT_BASELINE_SHA256,
	NANOGPT_BASELINE_TRAIN_STEPS,
	runNanoGptContract,
} from "../src/nanogpt-contract.js";

const STOCK_IDENTITY_PATCH = fileURLToPath(new URL("../fixtures/nanogpt/stock-identity.patch", import.meta.url));

describe("NanoGPT static contract gate", () => {
	let directory = "";
	let baseline = "";

	before(async () => {
		directory = await mkdtemp(join(tmpdir(), "prime-nanogpt-contract-"));
		baseline = await readFile(NANOGPT_BASELINE_FIXTURE, "utf8");
	});

	after(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	async function candidate(name: string, source: string): Promise<string> {
		const target = join(directory, name);
		await writeFile(target, source, { encoding: "utf8", mode: 0o600 });
		return target;
	}

	it("accepts the exact pinned baseline only when baseline steps are explicitly allowed", async () => {
		const result = await runNanoGptContract({
			candidatePath: NANOGPT_BASELINE_FIXTURE,
			allowBaselineSteps: true,
		});
		assert.equal(result.ok, true);
		assert.equal(result.baselineSha256, NANOGPT_BASELINE_SHA256);
		assert.equal(result.candidateSha256, NANOGPT_BASELINE_SHA256);
		assert.equal(result.trainSteps, NANOGPT_BASELINE_TRAIN_STEPS);
		assert.deepEqual(result.errors, []);
		assert.equal(result.frozenSegmentSha256.length, 4);
		assert.equal(result.editableSegmentSha256.length, 3);
	});

	it("accepts a literal step reduction supplied as a one-file unified patch", async () => {
		const patchPath = join(directory, "reduce-steps.patch");
		await writeFile(
			patchPath,
			[
				"--- a/train_gpt_simple.py",
				"+++ b/train_gpt_simple.py",
				"@@ -281 +281 @@",
				"-    train_steps = 3290",
				"+    train_steps = 3289",
				"",
			].join("\n"),
			"utf8",
		);
		const result = await runNanoGptContract({ patchPath });
		assert.equal(result.ok, true);
		assert.equal(result.trainSteps, 3289);
		assert.match(result.patchSha256 ?? "", /^[0-9a-f]{64}$/);
		assert.notEqual(result.candidateSha256, NANOGPT_BASELINE_SHA256);
	});

	it("represents the stock anchor as a nonempty candidate-specific identity patch", async () => {
		const patch = await readFile(STOCK_IDENTITY_PATCH, "utf8");
		assert.ok(patch.length > 0);
		const result = await runNanoGptContract({ patchPath: STOCK_IDENTITY_PATCH, allowBaselineSteps: true });
		assert.equal(result.ok, true);
		assert.equal(result.trainSteps, NANOGPT_BASELINE_TRAIN_STEPS);
		assert.equal(result.candidateSha256, NANOGPT_BASELINE_SHA256);
		assert.match(result.patchSha256 ?? "", /^[0-9a-f]{64}$/);
	});

	it("rejects edits to frozen training infrastructure", async () => {
		const source = baseline.replace("batch_size = 8 * 64 * 1024", "batch_size = 1 * 64 * 1024");
		const result = await runNanoGptContract({ candidatePath: await candidate("frozen-edit.py", source) });
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((error) => error.code === "FROZEN_SEGMENT_CHANGED"));
	});

	it("rejects extra imports, reseeding, and backward calls in editable sections", async () => {
		const source = baseline
			.replace("def zeropower_via_newtonschulz5", "import requests\n\ndef zeropower_via_newtonschulz5")
			.replace(
				"    train_steps = 3290",
				"    train_steps = 3289\n    torch.manual_seed(7)\n    torch.tensor(1.0, requires_grad=True).backward()",
			);
		const result = await runNanoGptContract({ candidatePath: await candidate("forbidden.py", source) });
		assert.equal(result.ok, false);
		const codes = new Set(result.errors.map((error) => error.code));
		assert.ok(codes.has("EDITABLE_IMPORT"));
		assert.ok(codes.has("FORBIDDEN_CALL"));
		assert.ok(codes.has("BACKWARD_COUNT"));
	});

	it("rejects dynamic or non-record train_steps", async () => {
		const dynamic = baseline.replace("    train_steps = 3290", "    train_steps = BASELINE_TRAIN_STEPS - 1");
		const dynamicResult = await runNanoGptContract({ candidatePath: await candidate("dynamic.py", dynamic) });
		assert.equal(dynamicResult.ok, false);
		assert.ok(dynamicResult.errors.some((error) => error.code === "TRAIN_STEPS_LITERAL"));

		const unchangedResult = await runNanoGptContract({ candidatePath: NANOGPT_BASELINE_FIXTURE });
		assert.equal(unchangedResult.ok, false);
		assert.ok(unchangedResult.errors.some((error) => error.code === "TRAIN_STEPS_RANGE"));
	});

	it("rejects a patch that targets more than the one permitted file", async () => {
		const patchPath = join(directory, "multi-file.patch");
		await writeFile(
			patchPath,
			[
				"diff --git a/train_gpt_simple.py b/train_gpt_simple.py",
				"--- a/train_gpt_simple.py",
				"+++ b/train_gpt_simple.py",
				"@@ -281 +281 @@",
				"-    train_steps = 3290",
				"+    train_steps = 3289",
				"diff --git a/run.sh b/run.sh",
				"--- a/run.sh",
				"+++ b/run.sh",
				"@@ -1 +1 @@",
				"-safe",
				"+unsafe",
				"",
			].join("\n"),
			"utf8",
		);
		const result = await runNanoGptContract({ patchPath });
		assert.equal(result.ok, false);
		assert.equal(result.errors[0]?.code, "INPUT_INVALID");
	});
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MANIFEST_PATH = fileURLToPath(new URL("../farmshare/nanogpt-smoke-data.json", import.meta.url));
const BOOTSTRAP_PATH = fileURLToPath(new URL("../farmshare/bootstrap-nanogpt-smoke-data.sh", import.meta.url));
const MANIFEST_SHA256 = "21e5ec359d94b274cc5dcd072b99bf5fa9132b4a34a414d062f151dc8cbdfd40";
const BOOTSTRAP_SHA256 = "aaaddcfe160fb5723e001cc082f59ac26a1da12e7d809fb364442a2a009648dc";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

describe("NanoGPT smoke data seal", () => {
	it("pins exactly one 100M-token train shard and one 100M-token validation shard", async () => {
		const source = await readFile(MANIFEST_PATH, "utf8");
		assert.equal(sha256(source), MANIFEST_SHA256);
		assert.deepEqual(JSON.parse(source), {
			schemaVersion: 1,
			dataset: "kjj0/fineweb10B-gpt2",
			revision: "889765ea1f903759787add96995d81171b632d0c",
			purpose: "nanogpt-track3-cuda-smoke-10",
			files: [
				{
					path: "fineweb_val_000000.bin",
					size: 200001024,
					sha256: "5b95c8e0966f0861685b307b23dc5ae42b228ef74b28cb499784ae021f201640",
				},
				{
					path: "fineweb_train_000001.bin",
					size: 200001024,
					sha256: "771fa4a99b9fe0946ffb6e848b4ba5c6a9b0fe87860ebf03bc2c1c7e45f8178e",
				},
			],
		});
	});

	it("binds the bootstrap to the manifest before publishing read-only data", async () => {
		const source = await readFile(BOOTSTRAP_PATH, "utf8");
		assert.equal(sha256(source), BOOTSTRAP_SHA256);
		assert.match(source, new RegExp(`EXPECTED_MANIFEST_SHA256=${MANIFEST_SHA256}`));
		assert.match(source, /NanoGPT smoke data manifest hash changed/);
		assert.match(source, /metadata must be a regular non-symlink file/);
		assert.ok(
			source.indexOf('mv "$DATASET_STAGE/fineweb10B" "$DATASET_DIR"') <
				source.indexOf('chmod -R a-w "$DATASET_DIR"'),
		);
		await execFileAsync("bash", ["-n", BOOTSTRAP_PATH]);
	});
});

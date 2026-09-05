import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../src/canonical-json.js";

const MANIFEST_PATH = fileURLToPath(new URL("../farmshare/nanogpt-scored-data.json", import.meta.url));
const BOOTSTRAP_PATH = fileURLToPath(new URL("../farmshare/bootstrap-nanogpt-scored-data.sh", import.meta.url));
const MANIFEST_SHA256 = "373bd25f990880b62f16e7b91d969fc7f5ca0802ff8208b4fa1d08ff0a52593a";
const GLOBAL_BATCH_TOKENS = 524_288;
const BASELINE_TRAIN_STEPS = 3_290;

interface DataFile {
	readonly path: string;
	readonly size: number;
	readonly sha256: string;
	readonly magic: number;
	readonly version: number;
	readonly tokens: number;
}

interface ScoredDataManifest {
	readonly schemaVersion: number;
	readonly dataset: string;
	readonly revision: string;
	readonly purpose: string;
	readonly globalBatchTokensWorldSizeOne: number;
	readonly usableStepsPerTrainShard: number;
	readonly totalUsableTrainSteps: number;
	readonly files: readonly DataFile[];
}

describe("NanoGPT scored dataset seal", () => {
	it("pins the smallest shard prefix that can complete the 3,290-step stock recipe", async () => {
		const source = await readFile(MANIFEST_PATH, "utf8");
		const manifest = JSON.parse(source) as ScoredDataManifest;
		assert.equal(sha256Text(source), MANIFEST_SHA256);
		assert.deepEqual(Object.keys(manifest).sort(), [
			"dataset",
			"files",
			"globalBatchTokensWorldSizeOne",
			"purpose",
			"revision",
			"schemaVersion",
			"totalUsableTrainSteps",
			"usableStepsPerTrainShard",
		]);
		assert.equal(manifest.schemaVersion, 1);
		assert.equal(manifest.dataset, "kjj0/fineweb10B-gpt2");
		assert.equal(manifest.revision, "889765ea1f903759787add96995d81171b632d0c");
		assert.equal(manifest.purpose, "nanogpt-track3-scored-v1-minimal-3290");
		assert.equal(manifest.globalBatchTokensWorldSizeOne, GLOBAL_BATCH_TOKENS);
		assert.equal(manifest.files.length, 19);
		assert.deepEqual(
			manifest.files.map((file) => file.path),
			[
				"fineweb_val_000000.bin",
				...Array.from({ length: 18 }, (_, index) => `fineweb_train_${String(index + 1).padStart(6, "0")}.bin`),
			],
		);
		for (const file of manifest.files) {
			assert.deepEqual(Object.keys(file).sort(), ["magic", "path", "sha256", "size", "tokens", "version"]);
			assert.equal(file.size, 200_001_024);
			assert.match(file.sha256, /^[0-9a-f]{64}$/);
			assert.equal(file.magic, 20_240_520);
			assert.equal(file.version, 1);
			assert.equal(file.tokens, 100_000_000);
		}
		const trainFiles = manifest.files.filter((file) => file.path.startsWith("fineweb_train_"));
		const usableStepsPerShard = Math.floor((trainFiles[0].tokens - 2) / GLOBAL_BATCH_TOKENS);
		assert.equal(usableStepsPerShard, 190);
		assert.equal(manifest.usableStepsPerTrainShard, usableStepsPerShard);
		assert.equal(manifest.totalUsableTrainSteps, trainFiles.length * usableStepsPerShard);
		assert.ok(manifest.totalUsableTrainSteps >= BASELINE_TRAIN_STEPS);
		assert.ok((trainFiles.length - 1) * usableStepsPerShard < BASELINE_TRAIN_STEPS);
	});

	it("bootstraps through a locked immutable stage and verifies every published byte", async () => {
		const source = await readFile(BOOTSTRAP_PATH, "utf8");
		assert.match(source, new RegExp(`EXPECTED_MANIFEST_SHA256=${MANIFEST_SHA256}`));
		assert.match(source, /flock 9/);
		assert.match(source, /mktemp -d/);
		assert.match(source, /huggingface\.co\/datasets/);
		assert.match(source, /manifest\['revision'\]/);
		assert.match(source, /content verification failed/);
		assert.match(source, /header changed/);
		assert.match(source, /mkdir -p "\$\(dirname "\$DATASET_DIR"\)"/);
		assert.match(source, /mv "\$DATASET_STAGE\/fineweb10B" "\$DATASET_DIR"/);
		assert.ok(
			source.indexOf('mkdir -p "$(dirname "$DATASET_DIR")"') < source.indexOf('mv "$DATASET_STAGE/fineweb10B"'),
		);
		assert.ok(source.indexOf("content verification failed") < source.indexOf('mv "$DATASET_STAGE/fineweb10B"'));
		assert.match(source, /chmod -R a-w "\$DATASET_DIR"/);
	});
});

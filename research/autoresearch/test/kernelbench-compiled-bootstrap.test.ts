import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../src/canonical-json.js";
import {
	KERNELBENCH_COMPILED_BOOTSTRAP_REMOTE,
	KERNELBENCH_COMPILED_ENVIRONMENT_SHA256,
} from "../src/kernelbench-compiled-qualification-adapter.js";

const BOOTSTRAP_PATH = fileURLToPath(new URL("../farmshare/bootstrap-kernelbench-compiled.sh", import.meta.url));
const ENVIRONMENT_PATH = fileURLToPath(new URL("../farmshare/kernelbench-compiled-environment.lock", import.meta.url));

describe("compiled KernelBench bootstrap asset routing", () => {
	it("keeps the compiled script and compiled lock under matching remote filenames", async () => {
		const [bootstrap, environment] = await Promise.all([
			readFile(BOOTSTRAP_PATH, "utf8"),
			readFile(ENVIRONMENT_PATH, "utf8"),
		]);
		assert.equal(sha256Text(environment), KERNELBENCH_COMPILED_ENVIRONMENT_SHA256);
		assert.match(bootstrap, /LOCK_FILE="\$SCRIPT_DIR\/kernelbench-compiled-environment\.lock"/);
		assert.match(KERNELBENCH_COMPILED_BOOTSTRAP_REMOTE, /bootstrap-kernelbench-compiled\.sh/);
		assert.match(KERNELBENCH_COMPILED_BOOTSTRAP_REMOTE, /kernelbench-compiled-environment\.lock/);
	});
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	checkCompilerGymProxyCascadeBundle,
	resolveCompilerGymProxyCascadeBundlePaths,
	writeCompilerGymProxyCascadeBundleCreateOnly,
} from "../src/compiler-gym-proxy-cascade-bundle.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function bundle() {
	const repoRoot = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-bundle-"));
	temporaryDirectories.push(repoRoot);
	const paths = resolveCompilerGymProxyCascadeBundlePaths({
		repoRoot,
		resultPath: ".autoresearch/proxy/v1/result.json",
		manifestPath: ".autoresearch/proxy/v1/result.sha256",
	});
	return { ...paths, resultContents: "result\n", manifestContents: "manifest\n" };
}

describe("CompilerGym proxy-cascade replay bundle", () => {
	it("publishes both files in one exclusive directory claim and checks exact bytes", async () => {
		const input = await bundle();
		await writeCompilerGymProxyCascadeBundleCreateOnly(input);
		await checkCompilerGymProxyCascadeBundle(input);
		assert.equal((await stat(input.bundleDirectory)).mode & 0o777, 0o700);
		assert.equal((await stat(input.resultPath)).mode & 0o777, 0o600);
		assert.equal((await stat(input.manifestPath)).mode & 0o777, 0o600);
	});

	it("rejects a second write without changing the first bundle", async () => {
		const input = await bundle();
		await writeCompilerGymProxyCascadeBundleCreateOnly(input);
		await assert.rejects(() => writeCompilerGymProxyCascadeBundleCreateOnly(input), /EEXIST/);
		assert.equal(await readFile(input.resultPath, "utf8"), input.resultContents);
		assert.equal(await readFile(input.manifestPath, "utf8"), input.manifestContents);
	});

	it("removes its exclusive directory when the second file is rejected before creation", async () => {
		const input = await bundle();
		await assert.rejects(
			() =>
				writeCompilerGymProxyCascadeBundleCreateOnly(input, {
					beforeFileWrite: async (_path, ordinal) => {
						if (ordinal === 2) throw new Error("injected second-file failure");
					},
				}),
			/injected second-file failure/,
		);
		await assert.rejects(() => stat(input.bundleDirectory), /ENOENT/);
	});

	it("rejects aliased, split-directory, and out-of-repo targets", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-paths-"));
		temporaryDirectories.push(repoRoot);
		assert.throws(
			() =>
				resolveCompilerGymProxyCascadeBundlePaths({
					repoRoot,
					resultPath: "same",
					manifestPath: "same",
				}),
			/distinct/,
		);
		assert.throws(
			() =>
				resolveCompilerGymProxyCascadeBundlePaths({
					repoRoot,
					resultPath: "one/result.json",
					manifestPath: "two/result.sha256",
				}),
			/one exclusive bundle directory/,
		);
		assert.throws(
			() =>
				resolveCompilerGymProxyCascadeBundlePaths({
					repoRoot,
					resultPath: "../outside.json",
					manifestPath: "../outside.sha256",
				}),
			/inside the repository root/,
		);
	});
});

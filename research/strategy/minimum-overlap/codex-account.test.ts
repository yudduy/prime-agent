import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCodexAccount } from "./codex-account.js";

const directory = await mkdtemp(join(tmpdir(), "codex-account-test-"));
const filename = join(directory, "login.json");
const tokenWithExpiry = (exp: number) =>
	`fixture.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.fixture`;
const validUntil = Date.now() + 1_080_000;
try {
	const token = tokenWithExpiry(Math.ceil(validUntil / 1000) + 60);
	const source = JSON.stringify({ tokens: { access_token: token, refresh_token: "unused-fixture" } });
	await writeFile(filename, source);
	const authStorage = await loadCodexAccount(filename, validUntil);
	assert.equal(await authStorage.getApiKey("openai-codex"), token);
	assert.equal(authStorage.get("openai-codex"), undefined);
	authStorage.reload();
	assert.equal(await authStorage.getApiKey("openai-codex"), token);
	assert.equal(await readFile(filename, "utf8"), source);
	assert.deepEqual(await readdir(directory), ["login.json"]);
	for (const invalid of [
		"{unparseable-private-fixture",
		JSON.stringify({ tokens: {} }),
		JSON.stringify({ tokens: { access_token: "malformed-private-fixture" } }),
		JSON.stringify({ tokens: { access_token: tokenWithExpiry(1) } }),
		JSON.stringify({ tokens: { access_token: tokenWithExpiry(validUntil / 1000) } }),
	]) {
		await writeFile(filename, invalid);
		await assert.rejects(loadCodexAccount(filename, validUntil), (error: unknown) => {
			assert(error instanceof Error);
			assert(!error.message.includes("private-fixture"));
			assert(!error.message.includes("fixture."));
			return true;
		});
	}
	await assert.rejects(loadCodexAccount(join(directory, "missing.json"), validUntil));
	console.log("Codex account tests passed; no provider requests or persistent credentials.");
} finally {
	await rm(directory, { recursive: true, force: true });
}

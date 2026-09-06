import { readFile } from "node:fs/promises";
import { AuthStorage } from "../../../packages/coding-agent/src/core/auth-storage.js";

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reads only the access token; the selected login and Prime credentials are never written. */
export async function loadCodexAccount(filename: string, validUntil: number): Promise<AuthStorage> {
	let data: unknown;
	try {
		data = JSON.parse(await readFile(filename, "utf8"));
	} catch {
		throw new Error("Cannot read the selected Codex login as JSON.");
	}
	if (!isObject(data) || !isObject(data.tokens) || typeof data.tokens.access_token !== "string") {
		throw new Error("The selected Codex login has no access token.");
	}
	const token = data.tokens.access_token;
	let claims: unknown;
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
	} catch {
		throw new Error("The selected Codex access token is malformed.");
	}
	if (
		!isObject(claims) ||
		typeof claims.exp !== "number" ||
		!Number.isFinite(claims.exp) ||
		!Number.isFinite(validUntil) ||
		claims.exp * 1000 <= validUntil
	) {
		throw new Error("The selected Codex login expires before this run can finish. Refresh it in Codex first.");
	}
	const authStorage = AuthStorage.inMemory({}, { usePrimeCliConfig: false });
	authStorage.setRuntimeApiKey("openai-codex", token);
	return authStorage;
}

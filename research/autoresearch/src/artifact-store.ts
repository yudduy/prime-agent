import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256Text } from "./canonical-json.js";
import type { ArtifactRef } from "./types.js";

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export class ArtifactStore {
	constructor(private readonly rootDir: string) {}

	private pathForDigest(digest: string): string {
		if (!/^[a-f0-9]{64}$/.test(digest)) {
			throw new Error(`Invalid SHA-256 digest: ${digest}`);
		}
		return join(this.rootDir, "sha256", digest.slice(0, 2), digest.slice(2));
	}

	async putString(content: string, mediaType: string): Promise<ArtifactRef> {
		const digest = sha256Text(content);
		const path = this.pathForDigest(digest);
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });

		try {
			const handle = await open(path, "wx", 0o600);
			try {
				await handle.writeFile(content, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
			const existing = await readFile(path, "utf8");
			if (existing !== content) {
				throw new Error(`Artifact digest collision at ${digest}`);
			}
		}

		return {
			digest,
			byteLength: Buffer.byteLength(content),
			mediaType,
		};
	}

	async readString(ref: ArtifactRef): Promise<string> {
		const content = await readFile(this.pathForDigest(ref.digest), "utf8");
		if (sha256Text(content) !== ref.digest) {
			throw new Error(`Artifact hash mismatch for ${ref.digest}`);
		}
		if (Buffer.byteLength(content) !== ref.byteLength) {
			throw new Error(`Artifact size mismatch for ${ref.digest}`);
		}
		return content;
	}
}

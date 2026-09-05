import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson, type JsonValue, sha256Json, toJsonValue } from "./canonical-json.js";

export type LedgerEventKind = "proposal" | "job_state" | "measurement" | "claim" | "run_manifest";

export interface LedgerEvent {
	schemaVersion: 1;
	sequence: number;
	recordedAt: string;
	kind: LedgerEventKind;
	previousHash: string | null;
	payload: JsonValue;
	hash: string;
}

const LEDGER_EVENT_KINDS = new Set<LedgerEventKind>(["proposal", "job_state", "measurement", "claim", "run_manifest"]);
const LEDGER_EVENT_KEYS = ["hash", "kind", "payload", "previousHash", "recordedAt", "schemaVersion", "sequence"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLedgerEventKind(value: unknown): value is LedgerEventKind {
	return typeof value === "string" && LEDGER_EVENT_KINDS.has(value as LedgerEventKind);
}

function eventBody(event: Omit<LedgerEvent, "hash">): JsonValue {
	return toJsonValue(event);
}

function parseEvent(value: unknown, line: number): LedgerEvent {
	if (!isRecord(value)) throw new Error(`Ledger line ${line} is not an object`);
	if (value.schemaVersion !== 1) throw new Error(`Ledger line ${line} has an unsupported schema version`);
	if (!Number.isInteger(value.sequence) || Number(value.sequence) < 0) {
		throw new Error(`Ledger line ${line} has an invalid sequence`);
	}
	if (typeof value.recordedAt !== "string" || !Number.isFinite(Date.parse(value.recordedAt))) {
		throw new Error(`Ledger line ${line} has an invalid timestamp`);
	}
	if (!isLedgerEventKind(value.kind)) throw new Error(`Ledger line ${line} has an invalid kind`);
	if (
		value.previousHash !== null &&
		(typeof value.previousHash !== "string" || !/^[a-f0-9]{64}$/.test(value.previousHash))
	) {
		throw new Error(`Ledger line ${line} has an invalid previous hash`);
	}
	if (typeof value.hash !== "string" || !/^[a-f0-9]{64}$/.test(value.hash)) {
		throw new Error(`Ledger line ${line} has an invalid hash`);
	}

	return {
		schemaVersion: 1,
		sequence: Number(value.sequence),
		recordedAt: value.recordedAt,
		kind: value.kind,
		previousHash: value.previousHash,
		payload: toJsonValue(value.payload),
		hash: value.hash,
	};
}

function verifyEvents(events: readonly LedgerEvent[]): void {
	let previousHash: string | null = null;
	for (let index = 0; index < events.length; index++) {
		const event = events[index];
		if (event.sequence !== index) throw new Error(`Ledger sequence mismatch at ${index}`);
		if (event.previousHash !== previousHash) throw new Error(`Ledger chain mismatch at ${index}`);
		const { hash, ...body } = event;
		const expectedHash = sha256Json(eventBody(body));
		if (hash !== expectedHash) throw new Error(`Ledger hash mismatch at ${index}`);
		previousHash = hash;
	}
}

export function verifyLedgerContentsStrict(contents: string): readonly LedgerEvent[] {
	if (contents.length === 0) return [];
	if (!contents.endsWith("\n")) throw new Error("Strict ledger must end with one newline");
	const body = contents.slice(0, -1);
	if (body.length === 0) return [];
	const lines = body.split("\n");
	if (lines.some((line) => line.length === 0)) throw new Error("Strict ledger contains an empty line");
	const events = lines.map((line, index) => {
		const value: unknown = JSON.parse(line);
		if (!isRecord(value)) throw new Error(`Ledger line ${index + 1} is not an object`);
		const keys = Object.keys(value).sort();
		if (JSON.stringify(keys) !== JSON.stringify(LEDGER_EVENT_KEYS)) {
			throw new Error(`Ledger line ${index + 1} has unknown or missing envelope keys`);
		}
		const event = parseEvent(value, index + 1);
		if (canonicalJson(toJsonValue(event)) !== line) {
			throw new Error(`Ledger line ${index + 1} is not canonical JSON`);
		}
		return event;
	});
	verifyEvents(events);
	for (let index = 1; index < events.length; index++) {
		if (Date.parse(events[index].recordedAt) < Date.parse(events[index - 1].recordedAt)) {
			throw new Error(`Ledger timestamp decreased at sequence ${index}`);
		}
	}
	return events;
}

export class EvidenceLedger {
	private writeTail: Promise<void> = Promise.resolve();

	private constructor(
		readonly path: string,
		private readonly events: LedgerEvent[],
	) {}

	static async open(path: string): Promise<EvidenceLedger> {
		await mkdir(dirname(path), { recursive: true });
		let contents = "";
		try {
			contents = await readFile(path, "utf8");
		} catch (error) {
			const isMissing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
			if (!isMissing) throw error;
			const handle = await open(path, "a", 0o600);
			await handle.close();
		}

		const events = contents
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line, index) => parseEvent(JSON.parse(line), index + 1));
		verifyEvents(events);
		return new EvidenceLedger(path, events);
	}

	getEvents(): readonly LedgerEvent[] {
		return this.events.slice();
	}

	async append(kind: LedgerEventKind, payload: unknown, recordedAt = new Date().toISOString()): Promise<LedgerEvent> {
		const operation = this.writeTail.then(async () => {
			const body: Omit<LedgerEvent, "hash"> = {
				schemaVersion: 1,
				sequence: this.events.length,
				recordedAt,
				kind,
				previousHash: this.events.at(-1)?.hash ?? null,
				payload: toJsonValue(payload),
			};
			const event: LedgerEvent = { ...body, hash: sha256Json(eventBody(body)) };
			const handle = await open(this.path, "a", 0o600);
			try {
				await handle.writeFile(`${canonicalJson(toJsonValue(event))}\n`, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			this.events.push(event);
			return event;
		});
		this.writeTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	verify(): void {
		verifyEvents(this.events);
	}
}

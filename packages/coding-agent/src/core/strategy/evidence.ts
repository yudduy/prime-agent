import { readFile } from "node:fs/promises";
import type { AgentToolResult } from "../extensions/types.js";
import type { Evidence } from "./types.js";

interface ToolRecord {
	id: string;
	tool: string;
	isError: boolean;
	arguments: unknown;
	result: AgentToolResult<unknown>["content"];
}

type ToolRecordExcerpt = Pick<ToolRecord, "id" | "tool" | "isError"> & { excerpt: string };

function serializedBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value));
}

function shortenRecord(record: ToolRecord, maxBytes: number): ToolRecord | ToolRecordExcerpt | undefined {
	if (serializedBytes(record) <= maxBytes) return record;
	const content = JSON.stringify({ arguments: record.arguments, result: record.result });
	const excerpt = (characters: number): ToolRecordExcerpt => ({
		id: record.id,
		tool: record.tool,
		isError: record.isError,
		excerpt: [
			content.slice(0, Math.ceil(characters / 2)).replace(/[\uD800-\uDBFF]$/u, ""),
			"[Middle omitted; use read_evidence for the full saved record.]",
			content.slice(content.length - Math.floor(characters / 2)).replace(/^[\uDC00-\uDFFF]/u, ""),
		].join("\n"),
	});
	if (serializedBytes(excerpt(0)) > maxBytes) return undefined;
	let low = 0;
	let high = content.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (serializedBytes(excerpt(middle)) <= maxBytes) low = middle;
		else high = middle - 1;
	}
	return excerpt(low);
}

/** Bound the serialized addition to review context, including JSON escaping and metadata. */
export async function readLatestToolRecords(evidence: readonly Evidence[]) {
	const tools = evidence.filter((record) => record.source === "tool");
	if (!tools.length) return undefined;
	const records = await Promise.all(
		tools.map(async (record): Promise<ToolRecord> => {
			const saved: { arguments: unknown; result: AgentToolResult<unknown> } = JSON.parse(
				await readFile(record.path, "utf8"),
			);
			return {
				id: record.id,
				tool: record.toolName,
				isError: record.isError,
				arguments: saved.arguments,
				result: saved.result.content.filter((part) => part.type === "text"),
			};
		}),
	);
	const presentation = {
		note: "Latest-step tool arguments and text results. Machine details and non-text content remain in saved records. Shortened records show the beginning and end with an omission marker. Omitted records remain in the evidence list. Use read_evidence for complete saved JSON; excerpt offsets do not apply to saved records.",
		omittedRecords: records.length,
		records: [] as (ToolRecord | ToolRecordExcerpt)[],
	};
	let remainingBytes = 40_000 - serializedBytes(presentation);
	const ordered = records
		.map((record, index) => ({ record, index, bytes: serializedBytes(record) }))
		.sort((a, b) => a.bytes - b.bytes);
	const included = new Map<number, ToolRecord | ToolRecordExcerpt>();
	for (const [index, entry] of ordered.entries()) {
		// Small records leave their unused share for larger ones; restore execution order below.
		const share = Math.floor(remainingBytes / (ordered.length - index)) - 1;
		const record = shortenRecord(entry.record, share);
		if (!record) continue;
		included.set(entry.index, record);
		remainingBytes -= serializedBytes(record) + 1;
	}
	presentation.records = [...included.entries()].sort(([a], [b]) => a - b).map(([, record]) => record);
	presentation.omittedRecords -= presentation.records.length;
	return presentation;
}

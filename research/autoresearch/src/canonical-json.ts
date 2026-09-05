import { createHash } from "node:crypto";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function toJsonValue(value: unknown, path = "$"): JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "string") {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error(`Non-finite number at ${path}`);
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
	}
	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error(`Unsupported object at ${path}`);
		}
		const result: { [key: string]: JsonValue } = {};
		for (const [key, item] of Object.entries(value)) {
			if (item === undefined) {
				throw new Error(`Undefined value at ${path}.${key}`);
			}
			result[key] = toJsonValue(item, `${path}.${key}`);
		}
		return result;
	}
	throw new Error(`Unsupported JSON value at ${path}: ${typeof value}`);
}

export function canonicalJson(value: JsonValue): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
		.join(",")}}`;
}

export function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value: unknown): string {
	return sha256Text(canonicalJson(toJsonValue(value)));
}

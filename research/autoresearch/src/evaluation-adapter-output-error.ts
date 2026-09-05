import type { JsonValue } from "./canonical-json.js";

export const EVALUATION_ADAPTER_OUTPUT_ERROR_PROTOCOL = "evaluation-adapter-output-error-v1" as const;

export interface EvaluationAdapterOutputErrorInput {
	code: string;
	message: string;
	hostEvidence: JsonValue;
	stdout?: string;
	stderr?: string;
}

export class EvaluationAdapterOutputError extends Error {
	readonly code: string;
	readonly hostEvidence: JsonValue;
	readonly stdout: string | undefined;
	readonly stderr: string | undefined;

	constructor(input: EvaluationAdapterOutputErrorInput) {
		if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(input.code)) {
			throw new Error("Evaluation adapter output error code is invalid");
		}
		if (!input.message.trim() || input.message.length > 512 || /[\u0000-\u001f\u007f]/.test(input.message)) {
			throw new Error("Evaluation adapter output error message is invalid");
		}
		super(input.message);
		this.name = "EvaluationAdapterOutputError";
		this.code = input.code;
		this.hostEvidence = structuredClone(input.hostEvidence);
		this.stdout = input.stdout;
		this.stderr = input.stderr;
	}
}

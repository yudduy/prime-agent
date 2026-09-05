import type { ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NANOGPT_CONTRACT_ID = "nanogpt-track3-static-contract-v1" as const;
export const NANOGPT_SPEEDRUN_REPOSITORY = "https://github.com/PrimeIntellect-ai/frontier-automated-speedrun" as const;
export const NANOGPT_SPEEDRUN_COMMIT = "38e258afefb1ce206dd7595aa71d7740da405742" as const;
export const NANOGPT_BASELINE_SHA256 = "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e" as const;
export const NANOGPT_PROGRAM_SHA256 = "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08" as const;
export const NANOGPT_BASELINE_TRAIN_STEPS = 3290 as const;
export const NANOGPT_CONTRACT_EVALUATOR = fileURLToPath(new URL("../evaluators/nanogpt_contract.py", import.meta.url));
export const NANOGPT_BASELINE_FIXTURE = fileURLToPath(
	new URL("../fixtures/nanogpt/train_gpt_simple.py", import.meta.url),
);

export interface NanoGptContractError {
	readonly code: string;
	readonly message: string;
}

export interface NanoGptContractResult {
	readonly schemaVersion: 1;
	readonly contract: typeof NANOGPT_CONTRACT_ID;
	readonly ok: boolean;
	readonly repository: typeof NANOGPT_SPEEDRUN_REPOSITORY;
	readonly commit: typeof NANOGPT_SPEEDRUN_COMMIT;
	readonly programSha256: typeof NANOGPT_PROGRAM_SHA256;
	readonly evaluatorSha256: string;
	readonly baselineSha256: string | null;
	readonly candidateSha256: string | null;
	readonly patchSha256: string | null;
	readonly trainSteps: number | null;
	readonly allowBaselineSteps: boolean;
	readonly frozenSegmentSha256: readonly string[];
	readonly editableSegmentSha256: readonly string[];
	readonly errors: readonly NanoGptContractError[];
	readonly caveats: readonly string[];
}

export type NanoGptCandidateInput =
	| { readonly candidatePath: string; readonly patchPath?: never }
	| { readonly patchPath: string; readonly candidatePath?: never };

export type NanoGptContractOptions = NanoGptCandidateInput & {
	readonly baselinePath?: string;
	readonly allowBaselineSteps?: boolean;
	readonly pythonExecutable?: string;
};

function isHexSha256(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isContractError(value: unknown): value is NanoGptContractError {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "code") === "string" &&
		typeof Reflect.get(value, "message") === "string"
	);
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseNanoGptContractResult(stdout: string): NanoGptContractResult {
	const value: unknown = JSON.parse(stdout);
	if (typeof value !== "object" || value === null) throw new Error("NanoGPT contract result must be an object");
	const get = (key: string): unknown => Reflect.get(value, key);
	const nullableShaKeys = ["baselineSha256", "candidateSha256", "patchSha256"] as const;
	if (
		get("schemaVersion") !== 1 ||
		get("contract") !== NANOGPT_CONTRACT_ID ||
		get("repository") !== NANOGPT_SPEEDRUN_REPOSITORY ||
		get("commit") !== NANOGPT_SPEEDRUN_COMMIT ||
		get("programSha256") !== NANOGPT_PROGRAM_SHA256 ||
		typeof get("ok") !== "boolean" ||
		!isHexSha256(get("evaluatorSha256")) ||
		!nullableShaKeys.every((key) => get(key) === null || isHexSha256(get(key))) ||
		!(get("trainSteps") === null || Number.isSafeInteger(get("trainSteps"))) ||
		typeof get("allowBaselineSteps") !== "boolean" ||
		!isStringArray(get("frozenSegmentSha256")) ||
		!isStringArray(get("editableSegmentSha256")) ||
		!Array.isArray(get("errors")) ||
		!(get("errors") as unknown[]).every(isContractError) ||
		!isStringArray(get("caveats"))
	) {
		throw new Error("NanoGPT contract result failed schema validation");
	}
	return value as NanoGptContractResult;
}

export function runNanoGptContract(options: NanoGptContractOptions): Promise<NanoGptContractResult> {
	const args = [NANOGPT_CONTRACT_EVALUATOR, "--baseline", options.baselinePath ?? NANOGPT_BASELINE_FIXTURE];
	if (typeof options.candidatePath === "string") args.push("--candidate", options.candidatePath);
	else if (typeof options.patchPath === "string") args.push("--patch", options.patchPath);
	else throw new Error("NanoGPT contract requires exactly one candidatePath or patchPath");
	if (options.allowBaselineSteps) args.push("--allow-baseline-steps");

	return new Promise((resolve, reject) => {
		execFile(
			options.pythonExecutable ?? "python3",
			args,
			{ encoding: "utf8", maxBuffer: 512 * 1024 },
			(error: ExecFileException | null, stdout, stderr) => {
				let result: NanoGptContractResult;
				try {
					result = parseNanoGptContractResult(stdout);
				} catch (parseError) {
					reject(
						new Error(
							`NanoGPT contract evaluator returned invalid output: ${parseError instanceof Error ? parseError.message : String(parseError)}; stderr=${stderr.trim()}`,
						),
					);
					return;
				}
				if (error && error.code !== 2) {
					reject(new Error(`NanoGPT contract evaluator failed: ${error.message}; stderr=${stderr.trim()}`));
					return;
				}
				if (Boolean(error) === result.ok) {
					reject(new Error("NanoGPT contract evaluator exit status disagrees with its result"));
					return;
				}
				resolve(result);
			},
		);
	});
}

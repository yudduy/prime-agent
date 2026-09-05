import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Text, toJsonValue } from "./canonical-json.js";
import { NANOGPT_BASELINE_FIXTURE, NANOGPT_BASELINE_SHA256, NANOGPT_PROGRAM_SHA256 } from "./nanogpt-contract.js";
import type { NanoGptScoredMode } from "./nanogpt-scored-protocol.js";

export const NANOGPT_BASELINE_TRAJECTORY_PROTOCOL = "nanogpt-stock-exact-prompt-trajectory-v1" as const;
export const NANOGPT_BASELINE_PROGRAM_BYTES = 5_713 as const;
export const NANOGPT_BASELINE_DURATION_MS = 24 * 60 * 60 * 1_000;
export const NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT = 300_000 as const;
export const NANOGPT_BASELINE_GPU_CAPACITY = 4 as const;
export const NANOGPT_BASELINE_AGENT_EXPERIMENT_CONCURRENCY = 1 as const;
export const NANOGPT_BASELINE_SCORE_ONE_TIMEOUT = "06:00:00" as const;
export const NANOGPT_BASELINE_PROGRAM_FIXTURE = fileURLToPath(
	new URL("../fixtures/nanogpt/program.md", import.meta.url),
);
export const NANOGPT_BASELINE_RUN_SH_FIXTURE = fileURLToPath(
	new URL("../fixtures/nanogpt/baseline-shims/run.sh", import.meta.url),
);
export const NANOGPT_BASELINE_VERIFY_PY_FIXTURE = fileURLToPath(
	new URL("../fixtures/nanogpt/baseline-shims/verify.py", import.meta.url),
);
export const NANOGPT_BASELINE_PROXY_CLIENT_FIXTURE = fileURLToPath(
	new URL("../fixtures/nanogpt/baseline-shims/run_proxy_client.py", import.meta.url),
);

export const NANOGPT_BASELINE_MODEL = {
	provider: "openai-codex",
	id: "gpt-5.6-luna",
	thinkingLevel: "xhigh",
	serviceTier: "priority",
} as const;

export const NANOGPT_BASELINE_RUNTIME_POLICY = {
	defaultPrimeSystemPrompt: true,
	nativeCompaction: true,
	nativeRlmLifecycle: true,
	activeTools: ["ipython"],
	customTools: [],
	extensions: false,
	skills: false,
	promptTemplates: false,
	themes: false,
	contextFiles: false,
	goals: false,
	webTools: false,
	publicWinningTracesMaterialized: false,
	initialUserMessages: 1,
} as const;

export const NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION = {
	promptBytes: "exact-pinned-program-md",
	runtimeSemantics: "l40s-compatibility-adaptation-not-byte-exact-benchmark-runtime",
	gpuExecution: "one-L40S-world-size-one-per-scored-stage",
	agentFacingPolicy: "strictly-sequential-as-prompted",
	scoreOneTimeout: NANOGPT_BASELINE_SCORE_ONE_TIMEOUT,
	shimTimeout: "none-do-not-apply-prompt-default-2h",
	originalPromptClaim: "run.sh uses one 8-GPU node with RUN_TIMEOUT default 2h",
} as const;

export const NANOGPT_BASELINE_LIMITATIONS = {
	outputTokens:
		"Admission closes when attributed root-and-child output reaches 300000. One already admitted provider response may overshoot, and native compaction usage is unavailable, so this is not exact total-output accounting.",
	calendar:
		"At 24 hours the host closes new admission and aborts the root and native RLM children. Already submitted evaluator jobs remain outstanding because durable external cancellation receipts are not implemented.",
	network:
		"Web tools, skills, context, and public traces are excluded and frozen source is verified after use. The Python kernel is not an OS network sandbox, so no-network is tool isolation rather than a proof of denied connectivity.",
	parallelism:
		"The controller is provisioned for four one-GPU jobs, but the byte-exact benchmark prompt requires one run at a time; agent-facing submissions are therefore serialized.",
	runtimeCompatibility:
		"The prompt bytes are exact, but run.sh is an L40S compatibility shim: one L40S/world-size one, with the scored transport's 6h score-1 cap and no shim-level 2h cancellation. Runtime semantics are not byte-exact to the prompt's 8-GPU/2h description.",
} as const;

export type NanoGptBaselineTrials = 1 | 3 | 8;
export type NanoGptBaselineStopReason =
	| "agent-returned"
	| "calendar-checkpoint"
	| "output-token-checkpoint"
	| "session-failed";

export interface NanoGptBaselineFrozenAsset {
	readonly relativePath: string;
	readonly sha256: string;
	readonly byteLength: number;
	readonly mode: number;
}

export interface NanoGptBaselineWorkspaceManifest {
	readonly schemaVersion: 1;
	readonly protocol: typeof NANOGPT_BASELINE_TRAJECTORY_PROTOCOL;
	readonly workspaceDir: string;
	readonly programSha256: typeof NANOGPT_PROGRAM_SHA256;
	readonly programByteLength: typeof NANOGPT_BASELINE_PROGRAM_BYTES;
	readonly initialCandidateSha256: typeof NANOGPT_BASELINE_SHA256;
	readonly frozenAssets: readonly NanoGptBaselineFrozenAsset[];
	readonly topLevelAllowlist: readonly string[];
	readonly compatibilityAdaptation: typeof NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION;
}

export interface NanoGptBaselineStageEvidence {
	readonly mode: NanoGptScoredMode;
	readonly jobId: string;
	readonly status: "succeeded" | "invalid" | "failed" | "cancelled";
	readonly trainSteps: number | null;
	readonly meanValidationLoss: number | null;
	readonly thresholdPassed: boolean | null;
	readonly recordEligible: boolean;
}

export interface NanoGptBaselineOperationResult {
	readonly operationId: string;
	readonly trials: NanoGptBaselineTrials;
	readonly candidateSha256: string;
	readonly candidatePatchSha256: string;
	readonly stages: readonly NanoGptBaselineStageEvidence[];
	readonly terminalStage: NanoGptBaselineStageEvidence;
	readonly logPath: string;
	readonly logSha256: string;
}

export interface NanoGptBaselineChampion {
	readonly operationId: string;
	readonly candidateSha256: string;
	readonly candidatePatchSha256: string;
	readonly sourceJobId: string;
	readonly trainSteps: number;
	readonly meanValidationLoss: number;
	readonly thresholdPassed: boolean;
	readonly recordEligible: boolean;
}

export interface NanoGptBaselineValidationPlan {
	readonly branchId: string;
	readonly treatment: "stock-prime-exact-prompt-post-terminal-validation";
	readonly sourceOperationId: string;
	readonly candidateSha256: string;
	readonly candidatePatchSha256: string;
	readonly stages: readonly ["smoke-10", "score-1", "score-3", "replay-8"];
	readonly prerequisiteLineageStages: readonly ["smoke-10", "score-1"];
	readonly requestedConfirmationStages: readonly ["score-3", "replay-8"];
	readonly cleanReplayMeaning: "fresh evaluator materialization and job directory over the official fixed seeds, not statistically unseen seeds";
}

const TOP_LEVEL_ALLOWLIST = [
	".baseline",
	"logs",
	"program.md",
	"run.sh",
	"scratchpad",
	"train_gpt_simple.py",
	"verify.py",
] as const;

const FROZEN_ASSETS = [
	{ relativePath: "program.md", fixturePath: NANOGPT_BASELINE_PROGRAM_FIXTURE, mode: 0o444 },
	{ relativePath: "run.sh", fixturePath: NANOGPT_BASELINE_RUN_SH_FIXTURE, mode: 0o555 },
	{ relativePath: "verify.py", fixturePath: NANOGPT_BASELINE_VERIFY_PY_FIXTURE, mode: 0o555 },
	{
		relativePath: ".baseline/run_proxy_client.py",
		fixturePath: NANOGPT_BASELINE_PROXY_CLIENT_FIXTURE,
		mode: 0o555,
	},
] as const;

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
}

async function assertRegularFile(path: string): Promise<void> {
	const status = await lstat(path);
	if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Baseline path must be a regular file: ${path}`);
}

async function installOrVerify(path: string, contents: string, mode: number): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	if (await exists(path)) {
		await assertRegularFile(path);
		if ((await readFile(path, "utf8")) !== contents) throw new Error(`Frozen baseline asset changed: ${path}`);
	} else {
		await writeFile(path, contents, { encoding: "utf8", mode, flag: "wx" });
	}
	await chmod(path, mode);
}

export async function readExactNanoGptBaselineProgram(): Promise<string> {
	const program = await readFile(NANOGPT_BASELINE_PROGRAM_FIXTURE, "utf8");
	if (
		Buffer.byteLength(program, "utf8") !== NANOGPT_BASELINE_PROGRAM_BYTES ||
		sha256Text(program) !== NANOGPT_PROGRAM_SHA256
	) {
		throw new Error("Pinned NanoGPT program.md fixture bytes changed");
	}
	return program;
}

export function nanoGptBaselineTargetMode(trials: NanoGptBaselineTrials): Exclude<NanoGptScoredMode, "smoke-10"> {
	switch (trials) {
		case 1:
			return "score-1";
		case 3:
			return "score-3";
		case 8:
			return "replay-8";
	}
}

export function nanoGptBaselineStageSequence(trials: NanoGptBaselineTrials): readonly NanoGptScoredMode[] {
	const all = ["smoke-10", "score-1", "score-3", "replay-8"] as const;
	return all.slice(0, all.indexOf(nanoGptBaselineTargetMode(trials)) + 1);
}

export function createNanoGptBaselineNonce(): string {
	return randomBytes(32).toString("hex");
}

export async function prepareNanoGptBaselineWorkspace(input: {
	readonly workspaceDir: string;
	readonly socketPath: string;
	readonly nonce: string;
}): Promise<NanoGptBaselineWorkspaceManifest> {
	const workspaceDir = resolve(input.workspaceDir);
	if (workspaceDir !== input.workspaceDir) throw new Error("Baseline workspace path must be absolute and normalized");
	if (!/^[0-9a-f]{64}$/.test(input.nonce)) throw new Error("Baseline proxy nonce must be 32 random bytes");
	if (resolve(input.socketPath) !== input.socketPath) throw new Error("Baseline proxy socket path must be absolute");
	await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
	await chmod(workspaceDir, 0o700);
	const topLevel = await readdir(workspaceDir);
	for (const name of topLevel) {
		if (!TOP_LEVEL_ALLOWLIST.includes(name as (typeof TOP_LEVEL_ALLOWLIST)[number])) {
			throw new Error(`Unexpected top-level baseline workspace entry: ${name}`);
		}
	}
	await mkdir(join(workspaceDir, "scratchpad"), { recursive: true, mode: 0o700 });
	await mkdir(join(workspaceDir, "logs"), { recursive: true, mode: 0o700 });
	await mkdir(join(workspaceDir, ".baseline"), { recursive: true, mode: 0o700 });

	const program = await readExactNanoGptBaselineProgram();
	const baseline = await readFile(NANOGPT_BASELINE_FIXTURE, "utf8");
	if (sha256Text(baseline) !== NANOGPT_BASELINE_SHA256) throw new Error("Pinned NanoGPT baseline fixture changed");
	const candidatePath = join(workspaceDir, "train_gpt_simple.py");
	if (await exists(candidatePath)) await assertRegularFile(candidatePath);
	else await writeFile(candidatePath, baseline, { encoding: "utf8", mode: 0o600, flag: "wx" });

	const frozenAssets: NanoGptBaselineFrozenAsset[] = [];
	for (const asset of FROZEN_ASSETS) {
		const contents = asset.relativePath === "program.md" ? program : await readFile(asset.fixturePath, "utf8");
		const destination = join(workspaceDir, asset.relativePath);
		await installOrVerify(destination, contents, asset.mode);
		frozenAssets.push({
			relativePath: asset.relativePath,
			sha256: sha256Text(contents),
			byteLength: Buffer.byteLength(contents, "utf8"),
			mode: asset.mode,
		});
	}
	const proxyConfig = `${canonicalJson(
		toJsonValue({ schemaVersion: 1, socketPath: input.socketPath, nonce: input.nonce }),
	)}\n`;
	await writeDurableJsonBytes(join(workspaceDir, ".baseline", "proxy.json"), proxyConfig, 0o400);

	return {
		schemaVersion: 1,
		protocol: NANOGPT_BASELINE_TRAJECTORY_PROTOCOL,
		workspaceDir,
		programSha256: NANOGPT_PROGRAM_SHA256,
		programByteLength: NANOGPT_BASELINE_PROGRAM_BYTES,
		initialCandidateSha256: NANOGPT_BASELINE_SHA256,
		frozenAssets,
		topLevelAllowlist: TOP_LEVEL_ALLOWLIST,
		compatibilityAdaptation: NANOGPT_BASELINE_COMPATIBILITY_ADAPTATION,
	};
}

export async function verifyNanoGptBaselineWorkspaceFrozen(manifest: NanoGptBaselineWorkspaceManifest): Promise<void> {
	const observedTopLevel = await readdir(manifest.workspaceDir);
	for (const name of observedTopLevel) {
		if (!manifest.topLevelAllowlist.includes(name)) {
			throw new Error(`Unexpected top-level baseline workspace entry: ${name}`);
		}
	}
	for (const asset of manifest.frozenAssets) {
		const path = join(manifest.workspaceDir, asset.relativePath);
		await assertRegularFile(path);
		const contents = await readFile(path, "utf8");
		const status = await stat(path);
		if (
			sha256Text(contents) !== asset.sha256 ||
			Buffer.byteLength(contents, "utf8") !== asset.byteLength ||
			(status.mode & 0o777) !== asset.mode
		) {
			throw new Error(`Frozen baseline asset integrity failed: ${asset.relativePath}`);
		}
	}
}

export async function writeDurableJson(path: string, value: unknown, mode = 0o600): Promise<void> {
	await writeDurableJsonBytes(path, `${canonicalJson(toJsonValue(value))}\n`, mode);
}

export async function writeNanoGptBaselineDurableText(path: string, contents: string, mode = 0o600): Promise<void> {
	await writeDurableJsonBytes(path, contents, mode);
}

async function writeDurableJsonBytes(path: string, contents: string, mode: number): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = join(dirname(path), `.${randomBytes(12).toString("hex")}.tmp`);
	const handle = await open(temporary, "wx", mode);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, path);
	await chmod(path, mode);
	const directory = await open(dirname(path), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

export async function readJsonFileIfPresent(path: string): Promise<unknown | null> {
	try {
		const source = await readFile(path, "utf8");
		if (!source.endsWith("\n")) throw new Error(`Durable JSON is not newline terminated: ${path}`);
		return JSON.parse(source);
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
}

export function selectNanoGptBaselineChampion(
	results: readonly NanoGptBaselineOperationResult[],
): NanoGptBaselineChampion | null {
	const candidates = results
		.map((result) => ({ result, stage: result.terminalStage }))
		.filter(
			(item) =>
				item.stage.status === "succeeded" &&
				item.stage.trainSteps !== null &&
				item.stage.meanValidationLoss !== null &&
				item.stage.thresholdPassed === true,
		)
		.sort((left, right) => {
			const stepDelta =
				(left.stage.trainSteps ?? Number.POSITIVE_INFINITY) - (right.stage.trainSteps ?? Number.POSITIVE_INFINITY);
			if (stepDelta !== 0) return stepDelta;
			const lossDelta =
				(left.stage.meanValidationLoss ?? Number.POSITIVE_INFINITY) -
				(right.stage.meanValidationLoss ?? Number.POSITIVE_INFINITY);
			if (lossDelta !== 0) return lossDelta;
			return left.result.candidateSha256.localeCompare(right.result.candidateSha256);
		});
	const selected = candidates[0];
	if (!selected || selected.stage.trainSteps === null || selected.stage.meanValidationLoss === null) return null;
	return {
		operationId: selected.result.operationId,
		candidateSha256: selected.result.candidateSha256,
		candidatePatchSha256: selected.result.candidatePatchSha256,
		sourceJobId: selected.stage.jobId,
		trainSteps: selected.stage.trainSteps,
		meanValidationLoss: selected.stage.meanValidationLoss,
		thresholdPassed: true,
		recordEligible: selected.stage.recordEligible,
	};
}

export function buildNanoGptBaselineValidationPlan(
	trajectoryBranchId: string,
	champion: NanoGptBaselineChampion,
): NanoGptBaselineValidationPlan {
	return {
		branchId: `${trajectoryBranchId}-post-terminal-validation`,
		treatment: "stock-prime-exact-prompt-post-terminal-validation",
		sourceOperationId: champion.operationId,
		candidateSha256: champion.candidateSha256,
		candidatePatchSha256: champion.candidatePatchSha256,
		stages: ["smoke-10", "score-1", "score-3", "replay-8"],
		prerequisiteLineageStages: ["smoke-10", "score-1"],
		requestedConfirmationStages: ["score-3", "replay-8"],
		cleanReplayMeaning:
			"fresh evaluator materialization and job directory over the official fixed seeds, not statistically unseen seeds",
	};
}

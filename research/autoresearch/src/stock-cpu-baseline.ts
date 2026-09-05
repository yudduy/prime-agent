import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "./artifact-store.js";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { sha256Json, sha256Text } from "./canonical-json.js";
import {
	assessHostOwnedTerminalization,
	createHostOwnedTerminalizationRuntimeTracker,
	HOST_OWNED_STOCK_CPU_PROTOCOL_VERSION,
	type HostOwnedTerminalizationRuntimeTracker,
	recordHostOwnedProviderDispatch,
	recordHostOwnedToolExecution,
	recordIntentionalHostTerminalizationStop,
	shouldHostOwnTerminalization,
} from "./host-owned-terminalization.js";
import { openStockCpuController } from "./stock-cpu-controller.js";
import {
	assessStockCpuCompletion,
	parseStockChampionReport,
	parseStockCpuCalibration,
	STOCK_CPU_BRANCH_ID,
	STOCK_CPU_CHAMPION_POLICY,
	STOCK_CPU_MAX_SUBMISSIONS,
	STOCK_CPU_PROTOCOL_VERSION,
	STOCK_CPU_TASKS,
	STOCK_CPU_TREATMENT,
	type StockCpuCalibration,
	type StockCpuTaskEvidence,
	selectStockCpuChampion,
} from "./stock-cpu-protocol.js";
import type { JobView } from "./types.js";

interface CliOptions {
	outputDir: string;
	calibrationResultPath: string;
	coreIntegrity: CoreIntegrityMode;
	runtimeProfile: RuntimeProfile;
}

type CoreIntegrityMode = "frozen-clean" | "snapshot";
type RuntimeProfile = "historical" | "host-terminalized" | "matched-screen";

interface PrimeCoreSnapshot {
	integrityMode: CoreIntegrityMode;
	head: string;
	coreTreeHashes: Record<string, string>;
	coreWorktreeStatus: string;
	trackedDiffSha256: string;
	untrackedFileHashes: Record<string, string>;
	coreWorktreeDigest: string;
}

interface ProviderBudgetTracker {
	outputTokens: number;
	providerCalls: number;
	blockedProviderCalls: number;
	blockedReasons: Array<"output-token-checkpoint" | "provider-call-limit">;
}

const OUTPUT_TOKEN_LIMIT = 32_000;
const ACTIVE_SECONDS_LIMIT = 600;
const CALENDAR_SECONDS_LIMIT = 900;
const MAX_HOST_TURNS = 5;

const ACTION_GUIDE = [
	"-mem2reg",
	"-sroa",
	"-instcombine",
	"-simplifycfg",
	"-reassociate",
	"-gvn",
	"-newgvn",
	"-sccp",
	"-ipsccp",
	"-adce",
	"-dce",
	"-bdce",
	"-dse",
	"-deadargelim",
	"-globalopt",
	"-globaldce",
	"-constmerge",
	"-constprop",
	"-jump-threading",
	"-licm",
	"-loop-rotate",
	"-loop-unroll",
	"-loop-vectorize",
	"-slp-vectorizer",
	"-tailcallelim",
	"-mergereturn",
] as const;

function parseOptions(argv: readonly string[]): CliOptions {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || value === undefined) {
			throw new Error(
				"Usage: stock-cpu-baseline --output-dir <path> --calibration-result <path> [--core-integrity <frozen-clean|snapshot>] [--runtime-profile <historical|matched-screen|host-terminalized>]",
			);
		}
		if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
		values.set(flag, value);
	}
	for (const flag of values.keys()) {
		if (
			flag !== "--output-dir" &&
			flag !== "--calibration-result" &&
			flag !== "--core-integrity" &&
			flag !== "--runtime-profile"
		) {
			throw new Error(`Unknown option: ${flag}`);
		}
	}
	const outputDir = values.get("--output-dir");
	const calibrationResultPath = values.get("--calibration-result");
	if (!outputDir || !calibrationResultPath) throw new Error("Both output paths are required");
	const coreIntegrity = values.get("--core-integrity") ?? "frozen-clean";
	if (coreIntegrity !== "frozen-clean" && coreIntegrity !== "snapshot") {
		throw new Error("--core-integrity must be frozen-clean or snapshot");
	}
	const runtimeProfile = values.get("--runtime-profile") ?? "historical";
	if (
		runtimeProfile !== "historical" &&
		runtimeProfile !== "matched-screen" &&
		runtimeProfile !== "host-terminalized"
	) {
		throw new Error("--runtime-profile must be historical, matched-screen, or host-terminalized");
	}
	if (runtimeProfile !== "historical" && coreIntegrity !== "snapshot") {
		throw new Error(`--runtime-profile ${runtimeProfile} requires --core-integrity snapshot`);
	}
	return {
		outputDir: resolve(outputDir),
		calibrationResultPath: resolve(calibrationResultPath),
		coreIntegrity,
		runtimeProfile,
	};
}

async function loadCalibration(
	path: string,
	expectedEvaluatorSha256: string,
): Promise<StockCpuCalibration & { sha256: string }> {
	const contents = await readFile(path, "utf8");
	const value: unknown = JSON.parse(contents);
	return {
		...parseStockCpuCalibration(value, sha256Json(FROZEN_CAMPAIGN), expectedEvaluatorSha256),
		sha256: sha256Text(contents),
	};
}

function sumUsage(usages: readonly Usage[]): Usage {
	return usages.reduce<Usage>(
		(total, usage) => ({
			input: total.input + usage.input,
			output: total.output + usage.output,
			cacheRead: total.cacheRead + usage.cacheRead,
			cacheWrite: total.cacheWrite + usage.cacheWrite,
			totalTokens: total.totalTokens + usage.totalTokens,
			cost: {
				input: total.cost.input + usage.cost.input,
				output: total.cost.output + usage.cost.output,
				cacheRead: total.cost.cacheRead + usage.cost.cacheRead,
				cacheWrite: total.cost.cacheWrite + usage.cost.cacheWrite,
				total: total.cost.total + usage.cost.total,
			},
		}),
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	);
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerBudgetExtension(
	tracker: ProviderBudgetTracker,
	hostTracker: HostOwnedTerminalizationRuntimeTracker | null,
) {
	return (pi: ExtensionAPI): void => {
		const toolArgs = new Map<string, unknown>();
		if (hostTracker) {
			pi.on("tool_execution_start", (event) => {
				toolArgs.set(event.toolCallId, event.args);
			});
			pi.on("tool_execution_end", (event) => {
				recordHostOwnedToolExecution(hostTracker, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: toolArgs.get(event.toolCallId),
					result: event.result,
					isError: event.isError,
				});
				toolArgs.delete(event.toolCallId);
			});
		}
		pi.on("before_provider_request", (event, ctx) => {
			assert.ok(isRecord(event.payload), "Provider payload must be an object for stock budget enforcement");
			if (hostTracker && shouldHostOwnTerminalization(hostTracker)) {
				recordIntentionalHostTerminalizationStop(hostTracker);
				ctx.abort();
				return event.payload;
			}
			const blockedReason =
				tracker.outputTokens >= OUTPUT_TOKEN_LIMIT
					? "output-token-checkpoint"
					: tracker.providerCalls >= 5
						? "provider-call-limit"
						: null;
			if (blockedReason) {
				tracker.blockedProviderCalls++;
				tracker.blockedReasons.push(blockedReason);
				ctx.abort();
				return event.payload;
			}
			tracker.providerCalls++;
			if (hostTracker) recordHostOwnedProviderDispatch(hostTracker);
			return event.payload;
		});
	};
}

function evaluatorWaitMs(jobs: readonly JobView[]): number {
	return jobs.reduce((total, job) => {
		const taskWaits = job.measurement?.tasks.map((task) => task.metrics.schedulerAndEvaluatorWallMs ?? 0) ?? [];
		return total + Math.max(0, ...taskWaits);
	}, 0);
}

const PRIME_CORE_PATHS = ["packages/ai", "packages/agent", "packages/coding-agent", "packages/tui"] as const;

function sha256Bytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function verifyPinnedPrimeCore(repoRoot: string, integrityMode: CoreIntegrityMode): PrimeCoreSnapshot {
	const headResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
	if (headResult.status !== 0) throw new Error(`Unable to resolve Prime Agent HEAD: ${headResult.stderr}`);
	const head = headResult.stdout.trim();
	if (head !== FROZEN_CAMPAIGN.repositories.primeAgent.commit) {
		throw new Error(`Prime Agent HEAD ${head} does not match the frozen commit`);
	}
	const diffResult = spawnSync(
		"git",
		["diff", "--binary", "--no-ext-diff", FROZEN_CAMPAIGN.repositories.primeAgent.commit, "--", ...PRIME_CORE_PATHS],
		{ cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
	if (diffResult.status !== 0) throw new Error(`Unable to inspect Prime Agent core diff: ${diffResult.stderr}`);
	const statusResult = spawnSync(
		"git",
		["status", "--porcelain=v1", "--untracked-files=all", "--", ...PRIME_CORE_PATHS],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	if (statusResult.status !== 0) throw new Error(`Unable to inspect Prime Agent core status: ${statusResult.stderr}`);
	const coreChanges = statusResult.stdout.trim();
	if (integrityMode === "frozen-clean" && coreChanges) {
		throw new Error(`Prime Agent core packages contain tracked or untracked changes:\n${coreChanges}`);
	}
	const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...PRIME_CORE_PATHS], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	if (untrackedResult.status !== 0)
		throw new Error(`Unable to inspect untracked Prime Agent core: ${untrackedResult.stderr}`);
	const untrackedPaths = untrackedResult.stdout
		.split("\n")
		.map((path) => path.trim())
		.filter(Boolean)
		.sort();
	const untrackedFileHashes = Object.fromEntries(
		untrackedPaths.map((path) => [path, sha256Bytes(readFileSync(join(repoRoot, path)))]),
	);
	const coreTreeHashes: Record<string, string> = {};
	for (const path of PRIME_CORE_PATHS) {
		const treeResult = spawnSync("git", ["rev-parse", `HEAD:${path}`], { cwd: repoRoot, encoding: "utf8" });
		if (treeResult.status !== 0) throw new Error(`Unable to resolve tree hash for ${path}`);
		coreTreeHashes[path] = treeResult.stdout.trim();
	}
	const trackedDiffSha256 = sha256Text(diffResult.stdout);
	const coreWorktreeDigest = sha256Json({
		coreWorktreeStatus: coreChanges,
		trackedDiffSha256,
		untrackedFileHashes,
	});
	return {
		integrityMode,
		head,
		coreTreeHashes,
		coreWorktreeStatus: coreChanges,
		trackedDiffSha256,
		untrackedFileHashes,
		coreWorktreeDigest,
	};
}

function primeCoreSnapshotsMatch(left: PrimeCoreSnapshot, right: PrimeCoreSnapshot): boolean {
	return sha256Json(left) === sha256Json(right);
}

function buildPrompt(
	calibration: readonly StockCpuTaskEvidence[],
	evaluatorArgv: readonly string[],
	hostOwnsTerminalization: boolean,
): string {
	return [
		"Optimize the two fixed CompilerGym/cBench programs below with the stock Prime Agent runtime.",
		"Your objective is to reduce raw LLVM IR instruction count on both tasks while all 20 semantic callbacks pass.",
		"This is a bounded research trajectory: make exactly four measured candidate evaluations, one mechanistic proposal at a time.",
		"Do not use web search, public winning traces, credentials, or any measurement other than the calibration and evaluator output.",
		"Do not inspect or modify the evaluator, evidence ledger, artifacts, or files outside this empty workspace.",
		`Tasks: ${JSON.stringify(STOCK_CPU_TASKS)}.`,
		`Authoritative empty-pass calibration: ${JSON.stringify(calibration)}.`,
		`Useful LLVM 10 flags include: ${ACTION_GUIDE.join(", ")}. Repetition and order are allowed.`,
		"Use the native persistent Python tool. For each experiment, call subprocess.run with the exact argv below, pass one JSON request on stdin, require exit code zero, and parse its single JSON stdout line.",
		`Evaluator argv: ${JSON.stringify(evaluatorArgv)}.`,
		'Every request must contain exactly: {"actions": string[], "hypothesis": string, "mechanism": string, "predictedOutcome": string, "boundaryConditions": string[]}.',
		"The host fixes tasks, treatment, lineage, verifier, and the four-submission/eight-task budget. A queued or predicted result is never evidence.",
		`After the fourth result, the host applies this declared champion policy: ${JSON.stringify(STOCK_CPU_CHAMPION_POLICY)}.`,
		hostOwnsTerminalization
			? "The host closes the branch immediately after the fourth verified result and selects the champion from the ledger. Do not attempt a fifth evaluation. No final CHAMPION response is required."
			: "Only fully accepted CompilerGym v2 candidates are eligible. The host recomputes this selection from the ledger and rejects a mismatched report.",
		...(hostOwnsTerminalization
			? []
			: [
					"End your response with exactly one line: CHAMPION <job-id>, or CHAMPION NONE if no submitted candidate succeeded.",
				]),
	].join("\n");
}

async function promptWithDeadline(session: AgentSession, prompt: string, deadlineMs: number): Promise<number> {
	const remainingMs = deadlineMs - Date.now();
	if (remainingMs <= 0) throw new Error("Stock baseline calendar budget expired before the next turn");
	let watchdogFired = false;
	const watchdog = setTimeout(() => {
		watchdogFired = true;
		session.requestAbort();
	}, remainingMs);
	const startedAt = Date.now();
	try {
		await session.promptAndWait(prompt);
		await session.waitForRlmQuiescence();
	} finally {
		clearTimeout(watchdog);
	}
	if (watchdogFired) throw new Error("Stock baseline calendar budget expired during a model turn");
	return Date.now() - startedAt;
}

function jsonSafe(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

async function verifyStockJobArtifacts(
	evaluationDir: string,
	jobs: readonly JobView[],
): Promise<{ passed: boolean; verifiedRefs: number; error: string | null }> {
	const store = new ArtifactStore(join(evaluationDir, "artifacts"));
	let verifiedRefs = 0;
	try {
		for (const job of jobs) {
			await store.readString(job.proposal.candidate);
			verifiedRefs++;
			if (job.measurement?.stdout) {
				await store.readString(job.measurement.stdout);
				verifiedRefs++;
			}
			if (job.measurement?.stderr) {
				await store.readString(job.measurement.stderr);
				verifiedRefs++;
			}
		}
		return { passed: true, verifiedRefs, error: null };
	} catch (error) {
		return { passed: false, verifiedRefs, error: error instanceof Error ? error.message : String(error) };
	}
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const boundedRuntime = options.runtimeProfile !== "historical";
	const hostOwnsTerminalization = options.runtimeProfile === "host-terminalized";
	const protocolVersion = hostOwnsTerminalization ? HOST_OWNED_STOCK_CPU_PROTOCOL_VERSION : STOCK_CPU_PROTOCOL_VERSION;
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const pinnedCore = verifyPinnedPrimeCore(repoRoot, options.coreIntegrity);
	const startedAtMs = Date.now();
	const deadlineMs = startedAtMs + CALENDAR_SECONDS_LIMIT * 1000;
	const evaluationDir = join(options.outputDir, "evaluation");
	const sessionDir = join(options.outputDir, "sessions");
	const workspace = join(options.outputDir, "workspace");
	await mkdir(dirname(options.outputDir), { recursive: true, mode: 0o700 });
	await mkdir(options.outputDir, { mode: 0o700 });
	await chmod(options.outputDir, 0o700);
	await mkdir(evaluationDir, { mode: 0o700 });
	await mkdir(sessionDir, { mode: 0o700 });
	await mkdir(workspace, { mode: 0o700 });

	const require = createRequire(import.meta.url);
	const tsxLoader = require.resolve("tsx");
	const evaluatorCliScript = fileURLToPath(new URL("./stock-cpu-eval.ts", import.meta.url));
	const trustedEvaluatorScript = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
	const trustedEvaluatorSha256 = sha256Text(await readFile(trustedEvaluatorScript, "utf8"));
	const calibration = await loadCalibration(options.calibrationResultPath, trustedEvaluatorSha256);
	const evaluatorArgv = [
		process.execPath,
		"--import",
		tsxLoader,
		evaluatorCliScript,
		"--output-dir",
		evaluationDir,
		...(boundedRuntime ? ["--require-fresh"] : []),
	];
	const prompt = buildPrompt(calibration.tasks, evaluatorArgv, hostOwnsTerminalization);
	const sourcePaths = [
		fileURLToPath(import.meta.url),
		evaluatorCliScript,
		fileURLToPath(new URL("./stock-cpu-controller.ts", import.meta.url)),
		fileURLToPath(new URL("./stock-cpu-protocol.ts", import.meta.url)),
		fileURLToPath(new URL("./host-owned-terminalization.ts", import.meta.url)),
		fileURLToPath(new URL("./artifact-store.ts", import.meta.url)),
		fileURLToPath(new URL("./campaign.ts", import.meta.url)),
		fileURLToPath(new URL("./canonical-json.ts", import.meta.url)),
		fileURLToPath(new URL("./compiler-gym-adapter.ts", import.meta.url)),
		fileURLToPath(new URL("./controller.ts", import.meta.url)),
		fileURLToPath(new URL("./ledger.ts", import.meta.url)),
		fileURLToPath(new URL("./types.ts", import.meta.url)),
		trustedEvaluatorScript,
	];
	const sourceHashesBefore = Object.fromEntries(
		await Promise.all(sourcePaths.map(async (path) => [path, sha256Text(await readFile(path, "utf8"))] as const)),
	);

	const initialController = await openStockCpuController(evaluationDir);
	await initialController.appendRunManifest({
		type: "stock_prime_compiler_gym_trajectory",
		phase: "start",
		protocolVersion,
		campaignId: FROZEN_CAMPAIGN.id,
		campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
		primeAgentCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
		actualPrimeAgentHead: pinnedCore.head,
		coreIntegrityMode: options.coreIntegrity,
		primeCoreTreeHashes: pinnedCore.coreTreeHashes,
		primeCoreWorktreeDigest: pinnedCore.coreWorktreeDigest,
		model: `${FROZEN_CAMPAIGN.model.provider}/${FROZEN_CAMPAIGN.model.id}`,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		requestedServiceTier: FROZEN_CAMPAIGN.model.serviceTier,
		activeTools: ["ipython"],
		customTools: [],
		defaultSystemPrompt: true,
		resourceIsolation: "extensions, skills, goals, prompt templates, themes, and context files disabled",
		runtimeProfile: options.runtimeProfile,
		runtimeClassification:
			options.runtimeProfile === "matched-screen"
				? "native stock Prime tool interface on a hash-snapshotted shared runtime; directional matched screen only"
				: hostOwnsTerminalization
					? "future-only stock interface with host-owned closure and ledger-authoritative champion selection"
					: "stock Prime core with isolated benchmark resources; descriptive baseline only",
		evaluatorBoundary: "canonical ledger and source integrity are enforced post hoc; OS-level sandboxing is absent",
		promptSha256: sha256Text(prompt),
		calibrationResultPath: options.calibrationResultPath,
		calibrationResultSha256: calibration.sha256,
		calibrationJobId: calibration.jobId,
		calibrationManifestDigest: calibration.manifestDigest,
		calibrationProvenance: calibration.provenance,
		championPolicy: STOCK_CPU_CHAMPION_POLICY,
		tasks: STOCK_CPU_TASKS,
		treatment: STOCK_CPU_TREATMENT,
		budgets: {
			maxSubmissions: STOCK_CPU_MAX_SUBMISSIONS,
			maxTaskEvaluations: STOCK_CPU_MAX_SUBMISSIONS * STOCK_CPU_TASKS.length,
			outputTokens: OUTPUT_TOKEN_LIMIT,
			activeAgentSeconds: ACTIVE_SECONDS_LIMIT,
			calendarSeconds: CALENDAR_SECONDS_LIMIT,
		},
		sourceHashes: sourceHashesBefore,
		startedAt: new Date(startedAtMs).toISOString(),
	});

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const registeredModel = modelRegistry.find(FROZEN_CAMPAIGN.model.provider, FROZEN_CAMPAIGN.model.id);
	if (!registeredModel) throw new Error("openai-codex/gpt-5.6-luna is not registered");
	if (!modelRegistry.hasConfiguredAuth(registeredModel)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for Prime Agent");
	}
	const model = registeredModel;
	const providerTracker: ProviderBudgetTracker = {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
	};
	const hostTerminalizationTracker = hostOwnsTerminalization ? createHostOwnedTerminalizationRuntimeTracker() : null;
	const settingsManager = boundedRuntime
		? SettingsManager.inMemory({
				transport: "sse",
				compaction: { enabled: false, agentCallable: false, reserveTokens: 4096, keepRecentTokens: 1 },
				autoRefine: { enabled: false },
				retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 120_000 } },
			})
		: SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: boundedRuntime ? [providerBudgetExtension(providerTracker, hostTerminalizationTracker)] : [],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
	});
	await resourceLoader.reload();
	const sessionManager = SessionManager.create(workspace, sessionDir);
	sessionManager.flushNow();
	const { session } = await createAgentSession({
		cwd: workspace,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: FROZEN_CAMPAIGN.model.thinkingLevel,
		serviceTier: FROZEN_CAMPAIGN.model.serviceTier,
		settingsManager,
		sessionManager,
		resourceLoader,
		includeGoals: false,
		...(boundedRuntime ? { includeCompactSkill: false } : {}),
	});
	assert.equal(session.model?.provider, FROZEN_CAMPAIGN.model.provider);
	assert.equal(session.model?.id, FROZEN_CAMPAIGN.model.id);
	assert.equal(session.thinkingLevel, FROZEN_CAMPAIGN.model.thinkingLevel);
	assert.equal(session.serviceTier, FROZEN_CAMPAIGN.model.serviceTier);
	assert.deepEqual(session.getActiveToolNames(), ["ipython"]);
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("Stock baseline session is not persistent");
	await chmod(sessionFile, 0o600);

	const events: AgentSessionEvent[] = [];
	const usages: Usage[] = [];
	const assistantMessages: AssistantMessage[] = [];
	let promptWallMs = 0;
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			usages.push(structuredClone(message.usage));
			assistantMessages.push(structuredClone(message));
			providerTracker.outputTokens += message.usage.output;
		}
	});

	let outcome: "succeeded" | "budget-stopped" | "failed" = "failed";
	let failure: string | null = null;
	let budgetStopReason: "output-tokens" | "active-agent-seconds" | "calendar-seconds" | null = null;
	const observedBudgetStop = (jobs: readonly JobView[]): typeof budgetStopReason => {
		if (session.getSessionStats().tokens.output >= OUTPUT_TOKEN_LIMIT) return "output-tokens";
		if (Math.max(0, promptWallMs - evaluatorWaitMs(jobs)) / 1000 >= ACTIVE_SECONDS_LIMIT) {
			return "active-agent-seconds";
		}
		if (Date.now() >= deadlineMs) return "calendar-seconds";
		return null;
	};
	try {
		const maxHostTurns = boundedRuntime ? 1 : MAX_HOST_TURNS;
		for (let turn = 0; turn < maxHostTurns; turn++) {
			const controller = await openStockCpuController(evaluationDir);
			const currentJobs = controller.statusForBranch(STOCK_CPU_BRANCH_ID);
			const completed = currentJobs.length;
			budgetStopReason = observedBudgetStop(currentJobs);
			if (budgetStopReason || completed >= STOCK_CPU_MAX_SUBMISSIONS) break;
			const turnPrompt =
				turn === 0
					? prompt
					: `Continue the same stock trajectory. You have completed ${completed} of ${STOCK_CPU_MAX_SUBMISSIONS} allowed evaluations. Use the exact evaluator protocol already given, then end with the required CHAMPION line after the fourth result.`;
			promptWallMs += await promptWithDeadline(session, turnPrompt, deadlineMs);
		}

		const completedController = await openStockCpuController(evaluationDir);
		const jobs = completedController.statusForBranch(STOCK_CPU_BRANCH_ID);
		budgetStopReason ??= observedBudgetStop(jobs);
		if (jobs.length === STOCK_CPU_MAX_SUBMISSIONS && !budgetStopReason) {
			const completionGate = assessStockCpuCompletion(jobs, calibration);
			if (!completionGate.passed) {
				throw new Error(
					`Stock trajectory completion gate failed: terminal=${completionGate.terminalJobs}/${completionGate.requiredJobs} durable=${completionGate.durableMeasurementJobs}/${completionGate.requiredJobs} acceptedV2Tasks=${completionGate.acceptedV2TaskRecords}/${completionGate.requiredAcceptedV2TaskRecords}`,
				);
			}
			const latestText = assistantMessages.at(-1) ? assistantText(assistantMessages.at(-1)!) : "";
			if (
				options.runtimeProfile === "historical" &&
				!/^CHAMPION (?:NONE|job_[a-f0-9]{24})$/.test(latestText.split("\n").at(-1) ?? "")
			) {
				promptWallMs += await promptWithDeadline(
					session,
					"Do not run another evaluation. Reply with exactly one line selecting from the four measured jobs: CHAMPION <job-id>, or CHAMPION NONE.",
					deadlineMs,
				);
			}
			budgetStopReason ??= observedBudgetStop(jobs);
			outcome = budgetStopReason ? "budget-stopped" : "succeeded";
		} else if (budgetStopReason) {
			outcome = "budget-stopped";
		} else {
			throw new Error(
				`Stock trajectory requires exactly ${STOCK_CPU_MAX_SUBMISSIONS} evaluations, observed ${jobs.length}`,
			);
		}
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		if (message.includes("calendar budget expired")) {
			budgetStopReason = "calendar-seconds";
			outcome = "budget-stopped";
		} else {
			failure = message;
			outcome = "failed";
		}
	} finally {
		unsubscribe();
	}

	try {
		const finalController = await openStockCpuController(evaluationDir);
		finalController.verifyLedger();
		const jobs = finalController.statusForBranch(STOCK_CPU_BRANCH_ID);
		const submittedJobIds = jobs.map((job) => job.proposal.jobId);
		const latestAssistantText = assistantMessages.at(-1) ? assistantText(assistantMessages.at(-1)!) : "";
		const completionGate = assessStockCpuCompletion(jobs, calibration);
		if (outcome === "succeeded" && !completionGate.passed) {
			failure ??= `Stock trajectory completion gate failed: terminal=${completionGate.terminalJobs}/${completionGate.requiredJobs} durable=${completionGate.durableMeasurementJobs}/${completionGate.requiredJobs} acceptedV2Tasks=${completionGate.acceptedV2TaskRecords}/${completionGate.requiredAcceptedV2TaskRecords}`;
			outcome = "failed";
		}
		const championSelection = selectStockCpuChampion(jobs, calibration);
		const championJobId = championSelection.selectedJobId;
		let reportedChampionJobId: string | null = null;
		let championReportLine: string | null = null;
		let championReportMatched: boolean | null = null;
		try {
			const report = parseStockChampionReport(latestAssistantText, submittedJobIds);
			reportedChampionJobId = report.jobId;
			championReportLine = report.line;
			championReportMatched = reportedChampionJobId === championJobId;
		} catch (error) {
			if (!hostOwnsTerminalization && jobs.length === STOCK_CPU_MAX_SUBMISSIONS) {
				failure ??= error instanceof Error ? error.message : String(error);
				outcome = "failed";
			}
		}
		if (!hostOwnsTerminalization && jobs.length === STOCK_CPU_MAX_SUBMISSIONS && championReportMatched !== true) {
			failure ??= `Assistant champion report does not match deterministic host selection ${championJobId ?? "NONE"}`;
			outcome = "failed";
		}
		if (jobs.some((job) => job.state.status === "succeeded") && championSelection.eligibleCandidates.length === 0) {
			failure ??=
				"Succeeded ledger jobs exist, but none satisfy the fully accepted CompilerGym v2 champion contract";
			outcome = "failed";
		}
		const matchedRuntimeChecks =
			options.runtimeProfile === "matched-screen"
				? {
						singleUserPrompt: session.getSessionStats().userMessages === 1,
						exactAssistantResponses: assistantMessages.length === 5,
						exactProviderCalls: providerTracker.providerCalls === 5,
						providerBudgetUnblocked: providerTracker.blockedProviderCalls === 0,
						exactToolCalls:
							events.filter(
								(event) =>
									event.type === "tool_execution_end" &&
									event.toolName === "ipython" &&
									event.isError === false,
							).length === STOCK_CPU_MAX_SUBMISSIONS,
						noCompaction:
							events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end")
								.length === 0,
						freshMeasurements: jobs.every(
							(job) => job.proposal.requireFreshMeasurement === true && job.measurement?.reuse === undefined,
						),
						transport: settingsManager.getTransport() === "sse",
						zeroProviderRetries: settingsManager.getProviderRetrySettings().maxRetries === 0,
					}
				: null;
		if (matchedRuntimeChecks && Object.values(matchedRuntimeChecks).some((passed) => !passed)) {
			failure ??= `Matched runtime gate failed: ${Object.entries(matchedRuntimeChecks)
				.filter(([, passed]) => !passed)
				.map(([name]) => name)
				.join(", ")}`;
			outcome = "failed";
		}
		const sourceHashesAfter = Object.fromEntries(
			await Promise.all(sourcePaths.map(async (path) => [path, sha256Text(await readFile(path, "utf8"))] as const)),
		);
		const trustedSourceHashesPassed = JSON.stringify(sourceHashesAfter) === JSON.stringify(sourceHashesBefore);
		let finalPrimeCore: PrimeCoreSnapshot | null = null;
		let primeCoreIntegrityFailure: string | null = null;
		try {
			finalPrimeCore = verifyPinnedPrimeCore(repoRoot, options.coreIntegrity);
			if (!primeCoreSnapshotsMatch(pinnedCore, finalPrimeCore)) {
				throw new Error("Final Prime Agent HEAD or core tree hashes differ from the start snapshot");
			}
		} catch (error) {
			primeCoreIntegrityFailure = error instanceof Error ? error.message : String(error);
		}
		const primeCoreIntegrityPassed = primeCoreIntegrityFailure === null;
		const sourceIntegrityPassed = trustedSourceHashesPassed && primeCoreIntegrityPassed;
		if (!sourceIntegrityPassed) {
			failure ??= primeCoreIntegrityFailure ?? "Stock trajectory changed trusted evaluator/controller source";
			outcome = "failed";
		}
		const artifactIntegrity = await verifyStockJobArtifacts(evaluationDir, jobs);
		if (!artifactIntegrity.passed) {
			failure ??= artifactIntegrity.error ?? "Stock trajectory artifact integrity failed";
			outcome = "failed";
		}
		const hostTerminalizationAssessment =
			hostOwnsTerminalization && hostTerminalizationTracker
				? assessHostOwnedTerminalization(jobs, calibration, {
						evaluatorDispatches: hostTerminalizationTracker.evaluatorToolCalls,
						postTerminalEvaluatorDispatches: hostTerminalizationTracker.postTerminalEvaluatorToolCalls,
						duplicateDispatches: Math.max(
							0,
							hostTerminalizationTracker.evaluatorToolCalls - new Set(submittedJobIds).size,
						),
						providerDispatchesAfterTerminalMeasurement: hostTerminalizationTracker.postTerminalProviderDispatches,
						blockedProviderRequestsAfterTerminalMeasurement: 0,
						intentionalHostTerminalizationStops: hostTerminalizationTracker.terminalizationStops,
						ledgerIntegrityPassed: true,
						artifactIntegrityPassed: artifactIntegrity.passed,
						sourceIntegrityPassed,
						evaluatorIntegrityPassed: jobs.every(
							(job) => job.measurement?.provenance.evaluatorSha256 === trustedEvaluatorSha256,
						),
						coreIntegrityPassed: primeCoreIntegrityPassed,
						forbiddenBoundaryEvents: hostTerminalizationTracker.forbiddenBoundaryEvents,
						readOnlyDeviationEvents: hostTerminalizationTracker.readOnlyDeviationEvents,
						assistantReportText: latestAssistantText,
					})
				: null;
		const successfulAssistantResponses = assistantMessages.filter(
			(message) => message.stopReason !== "aborted",
		).length;
		const hostTerminalizationChecks =
			hostOwnsTerminalization && hostTerminalizationTracker && hostTerminalizationAssessment
				? {
						singleUserPrompt: session.getSessionStats().userMessages === 1,
						providerTrackerConsistent:
							providerTracker.providerCalls === hostTerminalizationTracker.providerDispatches &&
							successfulAssistantResponses === providerTracker.providerCalls,
						preterminalProviderCallsWithinCap:
							providerTracker.providerCalls >= STOCK_CPU_MAX_SUBMISSIONS &&
							providerTracker.providerCalls <= STOCK_CPU_MAX_SUBMISSIONS + 1,
						providerBudgetUnblocked: providerTracker.blockedProviderCalls === 0,
						exactHostTerminalizationStop: hostTerminalizationTracker.terminalizationStops === 1,
						zeroPostTerminalProviderDispatch:
							hostTerminalizationTracker.postTerminalProviderDispatches === 0 &&
							hostTerminalizationTracker.providerDispatchesAtTerminal === providerTracker.providerCalls,
						exactEvaluatorCalls:
							hostTerminalizationTracker.evaluatorToolCalls === STOCK_CPU_MAX_SUBMISSIONS &&
							hostTerminalizationTracker.postTerminalEvaluatorToolCalls === 0,
						atMostOneReadOnlyInspection: hostTerminalizationTracker.readOnlyDeviationEvents.length <= 1,
						noForbiddenBoundaryEvents: hostTerminalizationTracker.forbiddenBoundaryEvents.length === 0,
						noCompaction:
							events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end")
								.length === 0,
						freshMeasurements: jobs.every(
							(job) => job.proposal.requireFreshMeasurement === true && job.measurement?.reuse === undefined,
						),
						transport: settingsManager.getTransport() === "sse",
						zeroProviderRetries: settingsManager.getProviderRetrySettings().maxRetries === 0,
						measurementQualified: hostTerminalizationAssessment.measurementQualified,
						terminalizationRuntimeConformant: hostTerminalizationAssessment.terminalizationRuntimeConformant,
					}
				: null;
		if (hostTerminalizationChecks && Object.values(hostTerminalizationChecks).some((passed) => !passed)) {
			failure ??= `Host terminalization gate failed: ${Object.entries(hostTerminalizationChecks)
				.filter(([, passed]) => !passed)
				.map(([name]) => name)
				.join(", ")}`;
			outcome = "failed";
		}
		const finishedAtMs = Date.now();
		const knownRootMessageUsage = sumUsage(usages);
		const sessionStats = session.getSessionStats();
		const evaluatorWallMs = evaluatorWaitMs(jobs);
		await finalController.appendRunManifest({
			type: "stock_prime_compiler_gym_trajectory",
			phase: "end",
			outcome,
			failure,
			protocolVersion,
			coreIntegrityMode: options.coreIntegrity,
			runtimeProfile: options.runtimeProfile,
			campaignId: FROZEN_CAMPAIGN.id,
			campaignConfigSha256: sha256Json(FROZEN_CAMPAIGN),
			model: `${model.provider}/${model.id}`,
			thinkingLevel: session.thinkingLevel,
			requestedAndLocallyEffectiveServiceTier: session.serviceTier,
			upstreamServiceTierAcknowledgement: "not exposed by current provider response API",
			activeTools: session.getActiveToolNames(),
			customTools: [],
			defaultSystemPrompt: true,
			sessionId: session.sessionId,
			sessionFile,
			promptSha256: sha256Text(prompt),
			knownRootMessageUsage,
			providerTracker,
			transport: settingsManager.getTransport(),
			providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
			attributedSessionTokens: sessionStats.tokens,
			outputTokenBudgetAccounting:
				"checkpointed after quiescent turns; an in-flight subscription response may overshoot",
			submittedJobIds,
			championJobId,
			reportedChampionJobId,
			championReportLine,
			championReportMatched,
			championSelection,
			completionGate,
			matchedRuntimeChecks,
			hostTerminalizationTracker,
			hostTerminalizationAssessment,
			hostTerminalizationChecks,
			artifactIntegrity,
			branchBudget: finalController.budgetStatus(STOCK_CPU_BRANCH_ID),
			budgetStopReason,
			promptWallMs,
			evaluatorWallMs,
			estimatedNonEvaluatorWallMs: Math.max(0, promptWallMs - evaluatorWallMs),
			activeTimeCaveat:
				"native ipython keeps evaluator waits inside model-turn wall time; per-job parallel task maximum is subtracted",
			calendarMs: finishedAtMs - startedAtMs,
			sourceHashesBefore,
			sourceHashesAfter,
			trustedSourceHashesPassed,
			primeCoreAtStart: pinnedCore,
			primeCoreAtEnd: finalPrimeCore,
			primeCoreIntegrityPassed,
			primeCoreIntegrityFailure,
			sourceIntegrityPassed,
			eventCounts: Object.fromEntries(
				[...new Set(events.map((event) => event.type))]
					.sort()
					.map((type) => [type, events.filter((event) => event.type === type).length]),
			),
			sessionStats: jsonSafe(sessionStats),
			finishedAt: new Date(finishedAtMs).toISOString(),
		});

		const result = {
			ok: outcome === "succeeded",
			outcome,
			failure,
			outputDir: options.outputDir,
			evaluationDir,
			coreIntegrityMode: options.coreIntegrity,
			runtimeProfile: options.runtimeProfile,
			model: `${model.provider}/${model.id}`,
			thinkingLevel: session.thinkingLevel,
			requestedAndLocallyEffectiveServiceTier: session.serviceTier,
			sessionId: session.sessionId,
			sessionFile,
			knownRootMessageUsage,
			providerTracker,
			transport: settingsManager.getTransport(),
			providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries,
			attributedSessionTokens: sessionStats.tokens,
			submittedJobIds,
			championJobId,
			reportedChampionJobId,
			championReportLine,
			championReportMatched,
			championSelection,
			completionGate,
			matchedRuntimeChecks,
			hostTerminalizationTracker,
			hostTerminalizationAssessment,
			hostTerminalizationChecks,
			artifactIntegrity,
			jobs,
			budgetStopReason,
			promptWallMs,
			evaluatorWallMs,
			calendarMs: finishedAtMs - startedAtMs,
			trustedSourceHashesPassed,
			primeCoreAtStart: pinnedCore,
			primeCoreAtEnd: finalPrimeCore,
			primeCoreIntegrityPassed,
			primeCoreIntegrityFailure,
			sourceIntegrityPassed,
			finishedAt: new Date(finishedAtMs).toISOString(),
		};
		const resultPath = join(options.outputDir, "result.json");
		await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(resultPath, 0o600);
		console.log(JSON.stringify(result));
		if (!result.ok) process.exitCode = 1;
	} finally {
		await session.disposeAsync();
	}
}

await main();

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentSession, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import {
	buildCompilerGymIrDeltaScreenPreregistration,
	COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS,
	COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
	parseCompilerGymIrDeltaScreenPreregistration,
} from "../src/compiler-gym-ir-delta-screen-preregistration.js";
import {
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
	COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
	CompilerGymIrDeltaScreenEvaluationSchema,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	createCompilerGymIrDeltaScreenProviderVisibilityPairState,
	createCompilerGymIrDeltaScreenProviderVisibilityRuntime,
	validateCompilerGymIrDeltaScreenResolvedModelSnapshot,
} from "../src/compiler-gym-ir-delta-screen-runner.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	captureStockInterfaceParityResolvedModelSnapshot,
	createStockInterfaceParityProviderBudgetExtension,
	type ProviderBudgetTracker,
	type StockInterfaceParityResolvedModelSnapshot,
} from "../src/stock-interface-parity.js";
import { STOCK_INTERFACE_PARITY_TOOL_NAME } from "../src/stock-interface-parity-protocol.js";

const PROVIDER_SESSION_ID = "paid-screen-resolved-model-test";
const SYNTHETIC_ACCESS = "synthetic-oauth-access-must-never-be-evidence";
const SYNTHETIC_REFRESH = "synthetic-oauth-refresh-must-never-be-evidence";
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUNTIME_WORKTREE_SNAPSHOT = capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT);

function captureExtensionHandlers(extension: ExtensionFactory): Map<string, (...args: unknown[]) => unknown> {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const api = {
		on(eventName: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(eventName, handler);
		},
	};
	extension(api as unknown as Parameters<ExtensionFactory>[0]);
	return handlers;
}

async function exactResolvedModelSnapshot(): Promise<StockInterfaceParityResolvedModelSnapshot> {
	const authStorage = AuthStorage.inMemory({
		"openai-codex": {
			type: "oauth",
			access: SYNTHETIC_ACCESS,
			refresh: SYNTHETIC_REFRESH,
			expires: Date.now() + 60_000,
		},
	});
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const model = modelRegistry.find("openai-codex", "gpt-5.6-luna");
	assert.ok(model, "generated Luna model must be registered");
	return captureStockInterfaceParityResolvedModelSnapshot({
		authStorage,
		modelRegistry,
		session: { model } as AgentSession,
		provider: "openai-codex",
		modelId: "gpt-5.6-luna",
	});
}

function providerPayload(normalizedSystemPrompt: string): Record<string, unknown> {
	return {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		prompt_cache_key: PROVIDER_SESSION_ID,
		service_tier: "priority",
		tool_choice: "auto",
		parallel_tool_calls: true,
		instructions: normalizedSystemPrompt,
		input: [
			{
				role: "user",
				content: [{ type: "input_text", text: buildCompilerGymIrDeltaScreenPrompt() }],
			},
		],
		tools: [
			{
				type: "function",
				name: STOCK_INTERFACE_PARITY_TOOL_NAME,
				parameters: CompilerGymIrDeltaScreenEvaluationSchema,
				strict: null,
			},
		],
		text: { verbosity: "low" },
		reasoning: { effort: "xhigh", summary: "auto" },
	};
}

function providerTracker(): ProviderBudgetTracker {
	return {
		outputTokens: 0,
		providerCalls: 0,
		blockedProviderCalls: 0,
		blockedReasons: [],
		apparatusGateFailures: [],
	};
}

describe("CompilerGym paid-screen resolved model gate", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("captures the exact built-in Luna subscription route without credential values", async () => {
		const snapshot = await exactResolvedModelSnapshot();
		assert.deepEqual(snapshot.registryModel, {
			provider: "openai-codex",
			id: "gpt-5.6-luna",
			api: "openai-codex-responses",
			baseUrl: "https://chatgpt.com/backend-api",
			headerNames: [],
		});
		assert.deepEqual(snapshot.sessionModel, snapshot.registryModel);
		assert.equal(snapshot.registryLoadErrorPresent, false);
		assert.equal(snapshot.storedCredentialType, "oauth");
		assert.equal(snapshot.oauthProviderRegistered, true);
		assert.equal(snapshot.requestAuthResolved, true);
		assert.equal(snapshot.apiKeyPresent, true);
		assert.equal(snapshot.selectedAuthSource, "stored");
		assert.deepEqual(snapshot.resolvedRequestHeaderNames, []);
		assert.deepEqual(validateCompilerGymIrDeltaScreenResolvedModelSnapshot(snapshot), []);
		const evidenceText = JSON.stringify(snapshot);
		assert.equal(evidenceText.includes(SYNTHETIC_ACCESS), false);
		assert.equal(evidenceText.includes(SYNTHETIC_REFRESH), false);
	});

	it("freezes the route/auth policy and all runtime-critical resolution sources in preregistration", () => {
		const closure = COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS.map((relativePath) => ({
			relativePath,
			sha256: sha256Text(relativePath),
		}));
		const preregistration = buildCompilerGymIrDeltaScreenPreregistration({
			createdAt: "2026-08-29T01:00:00.000Z",
			drawHex: "00".repeat(16),
			implementationClosure: closure,
			runtimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
		});
		assert.deepEqual(
			preregistration.frozenCommon.resolvedModelPolicy,
			COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
		);
		for (const path of [
			"packages/ai/src/models.generated.ts",
			"packages/ai/src/models.ts",
			"packages/ai/src/oauth.ts",
			"packages/ai/src/utils/oauth/openai-codex.ts",
			"packages/coding-agent/src/config.ts",
			"packages/coding-agent/src/core/auth-storage.ts",
			"packages/coding-agent/src/core/model-registry.ts",
			"packages/coding-agent/src/core/resolve-config-value.ts",
		]) {
			assert.equal(
				(COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS as readonly string[]).includes(path),
				true,
				path,
			);
		}
		const mutated: unknown = structuredClone(preregistration);
		(
			mutated as {
				frozenCommon: { resolvedModelPolicy: { baseUrl: string } };
			}
		).frozenCommon.resolvedModelPolicy.baseUrl = "https://chatgpt.com/backend-api/";
		assert.throws(() => parseCompilerGymIrDeltaScreenPreregistration(mutated, closure, RUNTIME_WORKTREE_SNAPSHOT));
	});

	it("rejects endpoint, API, header, registry, and non-subscription auth drift", async () => {
		const baseline = await exactResolvedModelSnapshot();
		const mutations: Array<{
			name: string;
			pattern: RegExp;
			mutate: (snapshot: StockInterfaceParityResolvedModelSnapshot) => void;
		}> = [
			{
				name: "provider",
				pattern: /provider drifted/,
				mutate: (snapshot) => {
					if (snapshot.registryModel) snapshot.registryModel.provider = "openai";
				},
			},
			{
				name: "api",
				pattern: /API drifted/,
				mutate: (snapshot) => {
					if (snapshot.sessionModel) snapshot.sessionModel.api = "openai-responses";
				},
			},
			{
				name: "model ID",
				pattern: /model ID drifted/,
				mutate: (snapshot) => {
					if (snapshot.registryModel) snapshot.registryModel.id = "gpt-5.6-sol";
				},
			},
			{
				name: "trailing slash endpoint",
				pattern: /base URL (?:drifted|violates)/,
				mutate: (snapshot) => {
					if (snapshot.registryModel) snapshot.registryModel.baseUrl += "/";
				},
			},
			{
				name: "model headers",
				pattern: /unexpected header names/,
				mutate: (snapshot) => {
					if (snapshot.registryModel) snapshot.registryModel.headerNames = ["x-route-override"];
				},
			},
			{
				name: "registry error",
				pattern: /registry reported/,
				mutate: (snapshot) => {
					snapshot.registryLoadErrorPresent = true;
				},
			},
			{
				name: "API key credential",
				pattern: /stored OAuth subscription/,
				mutate: (snapshot) => {
					snapshot.storedCredentialType = "api_key";
				},
			},
			{
				name: "OAuth provider registration",
				pattern: /OAuth provider is not registered/,
				mutate: (snapshot) => {
					snapshot.oauthProviderRegistered = false;
				},
			},
			{
				name: "auth resolution",
				pattern: /authentication did not resolve/,
				mutate: (snapshot) => {
					snapshot.requestAuthResolved = false;
				},
			},
			{
				name: "access token presence",
				pattern: /access token is absent/,
				mutate: (snapshot) => {
					snapshot.apiKeyPresent = false;
				},
			},
			{
				name: "models json fallback",
				pattern: /stored OAuth authentication source|models\.json API-key fallback/,
				mutate: (snapshot) => {
					snapshot.selectedAuthSource = "models_json_key";
				},
			},
			{
				name: "resolved request headers",
				pattern: /authentication has unexpected header names/,
				mutate: (snapshot) => {
					snapshot.resolvedRequestHeaderNames = ["authorization"];
				},
			},
		];
		for (const mutation of mutations) {
			const changed = structuredClone(baseline);
			mutation.mutate(changed);
			assert.match(
				validateCompilerGymIrDeltaScreenResolvedModelSnapshot(changed).join("; "),
				mutation.pattern,
				mutation.name,
			);
		}
	});

	it("rechecks every dispatch and blocks route drift before simulated transport", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-resolved-model-gate-"));
		tempDirs.push(root);
		const pairState = createCompilerGymIrDeltaScreenProviderVisibilityPairState({
			providerRequestAnchorPath: join(root, "provider-request-anchor.json"),
			preregistrationSha256: "a".repeat(64),
			expectedRuntimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
			runtimeWorktreeSnapshotProvider: () => structuredClone(RUNTIME_WORKTREE_SNAPSHOT),
		});
		const runtime = createCompilerGymIrDeltaScreenProviderVisibilityRuntime({
			arm: "hidden-control",
			providerSessionId: PROVIDER_SESSION_ID,
			pairState,
			resolvedModelPolicy: COMPILER_GYM_IR_DELTA_SCREEN_RESOLVED_MODEL_POLICY,
		});
		const visibilityHandlers = captureExtensionHandlers(runtime.extensionFactory);
		const beforeAgentStart = visibilityHandlers.get("before_agent_start");
		assert.ok(beforeAgentStart);
		const actualWorkspace = join(root, "hidden-control", "workspace");
		const actualConversationLog = join(root, "hidden-control", "sessions", "session.jsonl");
		const systemPrompt = `Workspace: ${actualWorkspace}\nConversation log: ${actualConversationLog}`;
		const normalizedResult = (await beforeAgentStart(
			{
				systemPrompt,
				systemPromptOptions: {
					cwd: actualWorkspace,
					messagesPath: actualConversationLog,
					selectedTools: [STOCK_INTERFACE_PARITY_TOOL_NAME],
					contextFiles: [],
					skills: [],
				},
			},
			{},
		)) as { systemPrompt: string };
		assert.equal(
			normalizedResult.systemPrompt.includes(COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_WORKSPACE),
			true,
		);
		assert.equal(
			normalizedResult.systemPrompt.includes(COMPILER_GYM_IR_DELTA_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG),
			true,
		);
		const exactSnapshot = await exactResolvedModelSnapshot();
		const driftedSnapshot = structuredClone(exactSnapshot);
		if (!driftedSnapshot.registryModel) throw new Error("registry model snapshot is absent");
		driftedSnapshot.registryModel.baseUrl += "/";
		let snapshotCalls = 0;
		const snapshots = [exactSnapshot, driftedSnapshot];
		const tracker = providerTracker();
		const budgetHandlers = captureExtensionHandlers(
			createStockInterfaceParityProviderBudgetExtension(
				tracker,
				null,
				4,
				false,
				runtime.providerRequestGate,
				async () => {
					const snapshot = snapshots[snapshotCalls++];
					if (!snapshot) throw new Error("unexpected resolved-model snapshot request");
					return structuredClone(snapshot);
				},
			),
		);
		const beforeProviderRequest = budgetHandlers.get("before_provider_request");
		assert.ok(beforeProviderRequest);
		const payload = providerPayload(normalizedResult.systemPrompt);
		let firstAborted = false;
		await beforeProviderRequest({ payload }, { abort: () => (firstAborted = true) });
		assert.equal(firstAborted, false);
		let simulatedTransportCalls = firstAborted ? 0 : 1;
		let secondAborted = false;
		await beforeProviderRequest({ payload }, { abort: () => (secondAborted = true) });
		if (!secondAborted) simulatedTransportCalls++;
		assert.equal(secondAborted, true);
		assert.equal(simulatedTransportCalls, 1);
		assert.equal(snapshotCalls, 2);
		assert.equal(tracker.providerCalls, 1);
		assert.equal(tracker.blockedProviderCalls, 1);
		assert.deepEqual(tracker.blockedReasons, ["apparatus-gate"]);
		assert.match(tracker.apparatusGateFailures?.[0] ?? "", /base URL/);
		assert.equal(runtime.evidence.resolvedModelSnapshots?.length, 2);
		assert.equal(runtime.evidence.firstResolvedModelMatchedPairAnchor, false);
		const anchor = JSON.parse(await readFile(pairState.providerRequestAnchorPath, "utf8")) as Record<string, unknown>;
		assert.equal(anchor.resolvedModelSnapshotSha256, sha256Json(exactSnapshot));
		assert.deepEqual(anchor.resolvedModelSnapshot, exactSnapshot);
		const anchorText = JSON.stringify(anchor);
		assert.equal(anchorText.includes(SYNTHETIC_ACCESS), false);
		assert.equal(anchorText.includes(SYNTHETIC_REFRESH), false);
	});

	it("captures a complete temp runtime and blocks a transitive stream mutation before transport", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-runtime-worktree-gate-"));
		tempDirs.push(root);
		const files = {
			"packages/ai/src/stream.ts": "export const streamVersion = 'preregistered';\n",
			"packages/agent/src/agent.ts": "export const agentVersion = 'preregistered';\n",
			"packages/coding-agent/src/index.ts": "export const codingAgentVersion = 'preregistered';\n",
			"packages/tui/src/index.ts": "export const tuiVersion = 'preregistered';\n",
		};
		for (const [relativePath, contents] of Object.entries(files)) {
			const absolutePath = join(root, relativePath);
			await mkdir(join(absolutePath, ".."), { recursive: true });
			await writeFile(absolutePath, contents, "utf8");
		}
		execFileSync("git", ["init", "--quiet"], { cwd: root });
		execFileSync("git", ["add", "--all"], { cwd: root });
		execFileSync("git", ["commit", "--quiet", "-m", "fixture"], {
			cwd: root,
			env: {
				...process.env,
				GIT_AUTHOR_EMAIL: "fixture@example.invalid",
				GIT_AUTHOR_NAME: "Fixture",
				GIT_COMMITTER_EMAIL: "fixture@example.invalid",
				GIT_COMMITTER_NAME: "Fixture",
			},
		});
		const expectedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
		const captureFixture = () => capturePrimeRuntimeWorktreeSnapshot(root, { expectedHead });
		const preregisteredSnapshot = captureFixture();
		const streamPath = join(root, "packages/ai/src/stream.ts");
		const pairState = createCompilerGymIrDeltaScreenProviderVisibilityPairState({
			providerRequestAnchorPath: join(root, "provider-request-anchor.json"),
			preregistrationSha256: "b".repeat(64),
			expectedRuntimeWorktreeSnapshot: preregisteredSnapshot,
			runtimeWorktreeSnapshotProvider: captureFixture,
		});
		const runtime = createCompilerGymIrDeltaScreenProviderVisibilityRuntime({
			arm: "hidden-control",
			providerSessionId: PROVIDER_SESSION_ID,
			pairState,
		});
		const visibilityHandlers = captureExtensionHandlers(runtime.extensionFactory);
		const beforeAgentStart = visibilityHandlers.get("before_agent_start");
		assert.ok(beforeAgentStart);
		const actualWorkspace = join(root, "arm-workspace");
		const actualConversationLog = join(root, "arm-sessions", "session.jsonl");
		const normalizedResult = (await beforeAgentStart(
			{
				systemPrompt: `Workspace: ${actualWorkspace}\nConversation log: ${actualConversationLog}`,
				systemPromptOptions: {
					cwd: actualWorkspace,
					messagesPath: actualConversationLog,
					selectedTools: [STOCK_INTERFACE_PARITY_TOOL_NAME],
					contextFiles: [],
					skills: [],
				},
			},
			{},
		)) as { systemPrompt: string };
		const tracker = providerTracker();
		const budgetHandlers = captureExtensionHandlers(
			createStockInterfaceParityProviderBudgetExtension(tracker, null, 4, false, runtime.providerRequestGate),
		);
		const beforeProviderRequest = budgetHandlers.get("before_provider_request");
		assert.ok(beforeProviderRequest);
		const payload = providerPayload(normalizedResult.systemPrompt);
		let simulatedTransportCalls = 0;
		let firstAborted = false;
		await beforeProviderRequest({ payload }, { abort: () => (firstAborted = true) });
		if (!firstAborted) simulatedTransportCalls++;
		assert.equal(firstAborted, false);
		assert.equal(simulatedTransportCalls, 1);
		assert.deepEqual(runtime.evidence.runtimeWorktreeSnapshotMatchesPreregistration, [true]);
		try {
			await writeFile(streamPath, "export const streamVersion = 'mutated-transitive-dispatch-bytes';\n", "utf8");
			const driftedSnapshot = captureFixture();
			assert.notEqual(driftedSnapshot.trackedDiffSha256, preregisteredSnapshot.trackedDiffSha256);
			assert.notEqual(sha256Json(driftedSnapshot), sha256Json(preregisteredSnapshot));
			let secondAborted = false;
			await beforeProviderRequest({ payload }, { abort: () => (secondAborted = true) });
			if (!secondAborted) simulatedTransportCalls++;
			assert.equal(secondAborted, true);
			assert.equal(simulatedTransportCalls, 1, "runtime drift crossed the provider transport boundary");
			assert.equal(tracker.providerCalls, 1);
			assert.equal(tracker.blockedProviderCalls, 1);
			assert.deepEqual(tracker.blockedReasons, ["apparatus-gate"]);
			assert.match(tracker.apparatusGateFailures?.[0] ?? "", /runtime worktree snapshot differs/);
			assert.deepEqual(runtime.evidence.runtimeWorktreeSnapshotMatchesPreregistration, [true, false]);
			const driftAnchor = runtime.evidence.runtimeWorktreeDispatchAnchors[1];
			assert.ok(driftAnchor);
			assert.equal((await stat(driftAnchor.path)).mode & 0o777, 0o600);
			const driftAnchorText = await readFile(driftAnchor.path, "utf8");
			const driftAnchorRecord = JSON.parse(driftAnchorText) as Record<string, unknown>;
			assert.equal(driftAnchorRecord.matchedPreregistration, false);
			assert.equal(driftAnchorRecord.runtimeWorktreeSnapshotSha256, sha256Json(driftedSnapshot));
			assert.equal(driftAnchorText.includes("mutated-transitive-dispatch-bytes"), false);
		} finally {
			await writeFile(streamPath, files["packages/ai/src/stream.ts"], "utf8");
		}
		assert.deepEqual(captureFixture(), preregisteredSnapshot);
	});
});

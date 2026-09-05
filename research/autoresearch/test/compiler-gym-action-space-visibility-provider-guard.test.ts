import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
	buildCompilerGymActionSpaceVisibilityPrompts,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
	type CompilerGymActionSpaceVisibilityArm,
	reconstructCompilerGymActionSpaceVisibilityGuides,
} from "../src/compiler-gym-action-space-visibility-protocol.js";
import {
	buildCompilerGymActionSpaceVisibilityProviderSpec,
	createCompilerGymActionSpaceVisibilityProviderGuard,
	validateCompilerGymActionSpaceVisibilityProviderPayload,
} from "../src/compiler-gym-action-space-visibility-provider-guard.js";
import type { RepositorySnapshot, StockInterfaceParityResolvedModelSnapshot } from "../src/stock-interface-parity.js";

const EVALUATOR_PATH = fileURLToPath(new URL("../evaluators/compiler_gym_eval.py", import.meta.url));
const PROVIDER_SESSION_ID = "visibility-paid-pair";
const PROVIDER_WORKSPACE = "/prime-agent-autoresearch/isolated-workspace";
const PROVIDER_CONVERSATION_LOG = "/prime-agent-autoresearch/session.jsonl";
const SNAPSHOT: RepositorySnapshot = {
	head: "a".repeat(40),
	coreTreeHashes: { "packages/ai": "b".repeat(64) },
	coreWorktreeStatus: "",
	trackedDiffSha256: "c".repeat(64),
	untrackedFileHashes: {},
	coreWorktreeDigest: "d".repeat(64),
};

function exactResolvedModel(): StockInterfaceParityResolvedModelSnapshot {
	const descriptor = {
		provider: "openai-codex",
		id: "gpt-5.6-luna",
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		headerNames: [],
	};
	return {
		registryModel: structuredClone(descriptor),
		sessionModel: structuredClone(descriptor),
		registryLoadErrorPresent: false,
		storedCredentialType: "oauth",
		oauthProviderRegistered: true,
		requestAuthResolved: true,
		apiKeyPresent: true,
		selectedAuthSource: "stored",
		resolvedRequestHeaderNames: [],
	};
}

function captureExtensionHandlers(extension: ExtensionFactory): Map<string, (...args: unknown[]) => unknown> {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	extension({
		on(eventName: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(eventName, handler);
		},
	} as unknown as Parameters<ExtensionFactory>[0]);
	return handlers;
}

function payload(input: {
	arm: CompilerGymActionSpaceVisibilityArm;
	systemPrompt: string;
	spec: ReturnType<typeof buildCompilerGymActionSpaceVisibilityProviderSpec>;
}): Record<string, unknown> {
	return {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		prompt_cache_key: input.spec.providerSessionId,
		service_tier: "priority",
		tool_choice: "auto",
		parallel_tool_calls: true,
		instructions: input.systemPrompt,
		input: [
			{
				role: "user",
				content: [{ type: "input_text", text: input.spec.promptByArm[input.arm] }],
			},
		],
		tools: [
			{
				type: "function",
				name: input.spec.tool.name,
				description: input.spec.tool.description,
				parameters: input.spec.tool.parameters,
				strict: null,
			},
		],
		text: { verbosity: "low" },
		reasoning: { effort: "xhigh", summary: "auto" },
		include: ["reasoning.encrypted_content"],
	};
}

async function visibilityFixture(root: string) {
	const evaluator = await readFile(EVALUATOR_PATH, "utf8");
	const guides = reconstructCompilerGymActionSpaceVisibilityGuides(evaluator);
	const prompts = buildCompilerGymActionSpaceVisibilityPrompts(guides);
	const agentDir = join(root, "agent");
	const spec = buildCompilerGymActionSpaceVisibilityProviderSpec({
		prompts,
		providerSessionId: PROVIDER_SESSION_ID,
		providerVisibleWorkspace: PROVIDER_WORKSPACE,
		providerVisibleConversationLog: PROVIDER_CONVERSATION_LOG,
		agentDir,
	});
	const guard = createCompilerGymActionSpaceVisibilityProviderGuard({
		spec,
		preregistrationSha256: "e".repeat(64),
		providerRequestAnchorPath: join(root, "provider-request-anchor.json"),
		activeAgentDir: agentDir,
		expectedRuntimeWorktreeSnapshot: SNAPSHOT,
		runtimeWorktreeSnapshotProvider: () => structuredClone(SNAPSHOT),
	});
	return { guides, prompts, spec, guard };
}

async function prepareArm(
	root: string,
	arm: CompilerGymActionSpaceVisibilityArm,
	guard: Awaited<ReturnType<typeof visibilityFixture>>["guard"],
) {
	const runtime = guard.runtimeForArm(arm);
	const beforeAgentStart = captureExtensionHandlers(runtime.extensionFactory).get("before_agent_start");
	assert.ok(beforeAgentStart);
	const workspace = join(root, arm, "workspace");
	const conversationLog = join(root, arm, "sessions", "session.jsonl");
	const result = (await beforeAgentStart(
		{
			systemPrompt: `Workspace: ${workspace}\nConversation log: ${conversationLog}`,
			systemPromptOptions: {
				cwd: workspace,
				messagesPath: conversationLog,
				selectedTools: [guard.spec.tool.name],
				contextFiles: [],
				skills: [],
			},
		},
		{},
	)) as { systemPrompt: string };
	return { runtime, systemPrompt: result.systemPrompt, workspace, conversationLog };
}

describe("CompilerGym action-space visibility provider guard", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	for (const order of [
		COMPILER_GYM_ACTION_SPACE_VISIBILITY_ARMS,
		[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM, COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM] as const,
	]) {
		it(`admits only the exact guide delta in ${order[0]}-first order and seals every request before transport`, async () => {
			const root = await mkdtemp(join(tmpdir(), "prime-visibility-provider-"));
			tempDirs.push(root);
			const fixture = await visibilityFixture(root);
			const runtimes = [];
			for (const arm of order) {
				const prepared = await prepareArm(root, arm, fixture.guard);
				const result = await prepared.runtime.providerRequestGate({
					payload: payload({ arm, systemPrompt: prepared.systemPrompt, spec: fixture.spec }),
					providerDispatchOrdinal: 1,
					resolvedModel: exactResolvedModel(),
				});
				assert.deepEqual(result, { allowed: true, reason: null });
				runtimes.push(prepared.runtime);
				assert.equal(prepared.runtime.evidence.guideReplacementCount, 1);
				assert.equal(prepared.runtime.evidence.runtimeWorktreeMatchedPreregistration, true);
				assert.equal(prepared.runtime.evidence.providerRequestMatchedPairAnchor, true);
				assert.equal((await stat(prepared.runtime.evidence.runtimeWorktreeAnchorPath!)).mode & 0o777, 0o600);
				assert.equal(
					(await stat(prepared.runtime.evidence.providerRequestTranscriptAnchorPath!)).mode & 0o777,
					0o600,
				);
			}
			assert.notEqual(
				runtimes[0]?.evidence.providerRequestBodySha256,
				runtimes[1]?.evidence.providerRequestBodySha256,
			);
			assert.equal(
				runtimes[0]?.evidence.normalizedProviderRequestBodySha256,
				runtimes[1]?.evidence.normalizedProviderRequestBodySha256,
			);
			assert.equal(
				runtimes[0]?.evidence.normalizedSystemPromptSha256,
				runtimes[1]?.evidence.normalizedSystemPromptSha256,
			);
			assert.deepEqual(fixture.guard.pairEvidence.completedArms, [...order]);
			assert.equal(new Set(fixture.guard.pairEvidence.actualWorkspaces).size, 2);
			assert.equal(new Set(fixture.guard.pairEvidence.actualConversationLogs).size, 2);
			assert.equal((await stat(fixture.guard.pairEvidence.providerRequestAnchorPath)).mode & 0o777, 0o600);
			const durable = JSON.parse(
				await readFile(fixture.guard.pairEvidence.providerRequestAnchorPath, "utf8"),
			) as Record<string, unknown>;
			assert.equal(durable.providerSessionId, PROVIDER_SESSION_ID);
			assert.equal(durable.normalizedRequestBodySha256, fixture.guard.pairEvidence.normalizedRequestBodySha256);
			assert.equal(fixture.guard.pairEvidence.failures.length, 0);
		});
	}

	it("revalidates the durable pair anchor before admitting the second arm", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-visibility-anchor-tamper-"));
		tempDirs.push(root);
		const fixture = await visibilityFixture(root);
		const control = await prepareArm(root, COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM, fixture.guard);
		const first = await control.runtime.providerRequestGate({
			payload: payload({
				arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
				systemPrompt: control.systemPrompt,
				spec: fixture.spec,
			}),
			providerDispatchOrdinal: 1,
			resolvedModel: exactResolvedModel(),
		});
		assert.deepEqual(first, { allowed: true, reason: null });
		await writeFile(fixture.guard.pairEvidence.providerRequestAnchorPath, "{}\n", "utf8");

		const treatment = await prepareArm(root, COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM, fixture.guard);
		const second = await treatment.runtime.providerRequestGate({
			payload: payload({
				arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
				systemPrompt: treatment.systemPrompt,
				spec: fixture.spec,
			}),
			providerDispatchOrdinal: 1,
			resolvedModel: exactResolvedModel(),
		});
		assert.equal(second.allowed, false);
		assert.match(second.reason ?? "", /pair anchor revalidation failed.*hash drifted/);
		assert.equal(treatment.runtime.evidence.providerRequestTranscriptAnchorPath, null);
	});

	it("rejects schema, history, non-guide prompt, and second-dispatch mutations", async () => {
		const mutations: Array<{ name: string; pattern: RegExp; mutate: (value: Record<string, unknown>) => void }> = [
			{
				name: "schema enumeration",
				pattern: /tool schema drifted/,
				mutate: (value) => {
					const tools = value.tools as Array<{ parameters: { properties: { actions: { items: object } } } }>;
					tools[0]!.parameters.properties.actions.items = { type: "string", enum: ["-mem2reg"] };
				},
			},
			{
				name: "history",
				pattern: /no history/,
				mutate: (value) => {
					(value.input as unknown[]).push({ type: "message", role: "assistant", content: [] });
				},
			},
			{
				name: "prompt leakage",
				pattern: /exact arm prompt|held-out benchmark/,
				mutate: (value) => {
					const input = value.input as Array<{ content: Array<{ text: string }> }>;
					input[0]!.content[0]!.text += "\nPrior dijkstra result.";
				},
			},
			{
				name: "plain headroom leakage",
				pattern: /exact arm prompt|prior headroom protocol/,
				mutate: (value) => {
					const input = value.input as Array<{ content: Array<{ text: string }> }>;
					input[0]!.content[0]!.text += "\nPrior headroom result.";
				},
			},
		];
		for (const mutation of mutations) {
			const root = await mkdtemp(join(tmpdir(), `prime-visibility-${mutation.name.replace(/ /g, "-")}-`));
			tempDirs.push(root);
			const fixture = await visibilityFixture(root);
			const prepared = await prepareArm(root, COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM, fixture.guard);
			const changed = payload({
				arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
				systemPrompt: prepared.systemPrompt,
				spec: fixture.spec,
			});
			mutation.mutate(changed);
			const result = await prepared.runtime.providerRequestGate({
				payload: changed,
				providerDispatchOrdinal: 1,
				resolvedModel: exactResolvedModel(),
			});
			assert.equal(result.allowed, false, mutation.name);
			assert.match(result.reason ?? "", mutation.pattern, mutation.name);
			assert.equal(prepared.runtime.evidence.providerRequestTranscriptAnchorPath, null);
		}
		const root = await mkdtemp(join(tmpdir(), "prime-visibility-second-dispatch-"));
		tempDirs.push(root);
		const fixture = await visibilityFixture(root);
		const prepared = await prepareArm(root, COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM, fixture.guard);
		const exactPayload = payload({
			arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
			systemPrompt: prepared.systemPrompt,
			spec: fixture.spec,
		});
		assert.equal(
			(
				await prepared.runtime.providerRequestGate({
					payload: exactPayload,
					providerDispatchOrdinal: 1,
					resolvedModel: exactResolvedModel(),
				})
			).allowed,
			true,
		);
		const second = await prepared.runtime.providerRequestGate({
			payload: exactPayload,
			providerDispatchOrdinal: 2,
			resolvedModel: exactResolvedModel(),
		});
		assert.equal(second.allowed, false);
		assert.match(second.reason ?? "", /more than one provider request/);
	});

	it("blocks runtime, system-prompt flag, and models.json drift before request admission", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-visibility-runtime-drift-"));
		tempDirs.push(root);
		const evaluator = await readFile(EVALUATOR_PATH, "utf8");
		const guides = reconstructCompilerGymActionSpaceVisibilityGuides(evaluator);
		const prompts = buildCompilerGymActionSpaceVisibilityPrompts(guides);
		const agentDir = join(root, "agent");
		const spec = buildCompilerGymActionSpaceVisibilityProviderSpec({
			prompts,
			providerSessionId: PROVIDER_SESSION_ID,
			providerVisibleWorkspace: PROVIDER_WORKSPACE,
			providerVisibleConversationLog: PROVIDER_CONVERSATION_LOG,
			agentDir,
		});
		const drifted = structuredClone(SNAPSHOT);
		drifted.trackedDiffSha256 = "f".repeat(64);
		const guard = createCompilerGymActionSpaceVisibilityProviderGuard({
			spec,
			preregistrationSha256: "e".repeat(64),
			providerRequestAnchorPath: join(root, "provider-request-anchor.json"),
			activeAgentDir: agentDir,
			expectedRuntimeWorktreeSnapshot: SNAPSHOT,
			runtimeWorktreeSnapshotProvider: () => drifted,
		});
		const prepared = await prepareArm(root, COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM, guard);
		const result = await prepared.runtime.providerRequestGate({
			payload: payload({
				arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
				systemPrompt: prepared.systemPrompt,
				spec,
			}),
			providerDispatchOrdinal: 1,
			resolvedModel: exactResolvedModel(),
		});
		assert.equal(result.allowed, false);
		assert.match(result.reason ?? "", /runtime worktree differs/);
		assert.equal(prepared.runtime.evidence.providerRequestTranscriptAnchorPath, null);

		const modelsRoot = await mkdtemp(join(tmpdir(), "prime-visibility-models-drift-"));
		tempDirs.push(modelsRoot);
		const modelsFixture = await visibilityFixture(modelsRoot);
		await mkdir(modelsFixture.spec.agentRegistry.agentDir, { recursive: true });
		await writeFile(modelsFixture.spec.agentRegistry.modelsJsonPath, "{}\n", { mode: 0o600 });
		const modelsPrepared = await prepareArm(
			modelsRoot,
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
			modelsFixture.guard,
		);
		const modelsResult = await modelsPrepared.runtime.providerRequestGate({
			payload: payload({
				arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
				systemPrompt: modelsPrepared.systemPrompt,
				spec: modelsFixture.spec,
			}),
			providerDispatchOrdinal: 1,
			resolvedModel: exactResolvedModel(),
		});
		assert.equal(modelsResult.allowed, false);
		assert.match(modelsResult.reason ?? "", /models\.json appeared/);
		assert.equal(modelsPrepared.runtime.evidence.providerRequestTranscriptAnchorPath, null);

		const leakedRoot = await mkdtemp(join(tmpdir(), "prime-visibility-system-leak-"));
		tempDirs.push(leakedRoot);
		const leakedFixture = await visibilityFixture(leakedRoot);
		const runtime = leakedFixture.guard.runtimeForArm(COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM);
		const beforeAgentStart = captureExtensionHandlers(runtime.extensionFactory).get("before_agent_start");
		assert.ok(beforeAgentStart);
		const workspace = join(leakedRoot, "workspace");
		const conversationLog = join(leakedRoot, "session.jsonl");
		await beforeAgentStart(
			{
				systemPrompt: `Workspace: ${workspace}\nConversation log: ${conversationLog}\nSecret hint: -early-cse\nPrior headroom note`,
				systemPromptOptions: {
					cwd: workspace,
					messagesPath: conversationLog,
					selectedTools: [leakedFixture.spec.tool.name],
					contextFiles: [],
					skills: [],
				},
			},
			{},
		);
		assert.match(runtime.evidence.failures.join("; "), /leaks LLVM action flags/);
		assert.match(runtime.evidence.failures.join("; "), /prior headroom protocol/);

		const validated = validateCompilerGymActionSpaceVisibilityProviderPayload({
			payload: payload({
				arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
				systemPrompt: "normalized-system",
				spec: leakedFixture.spec,
			}),
			arm: COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
			providerDispatchOrdinal: 1,
			normalizedSystemPrompt: "normalized-system",
			spec: leakedFixture.spec,
		});
		assert.deepEqual(validated.failures, []);
	});
});

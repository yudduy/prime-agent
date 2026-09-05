import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { sha256Json, sha256Text } from "../src/canonical-json.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
	type CompilerGymPaidLiveEnvironmentGateEvidence,
} from "../src/compiler-gym-paid-live-environment-gate.js";
import {
	buildCompilerGymProxyCascadePaidProviderSpec,
	COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
	type CompilerGymProxyCascadePaidProviderArm,
	createCompilerGymProxyCascadePaidProviderGuard,
	validateCompilerGymProxyCascadePaidProviderPayload,
	validateCompilerGymProxyCascadePaidProviderSpec,
} from "../src/compiler-gym-proxy-cascade-paid-provider.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "../src/compiler-gym-proxy-cascade-protocol.js";
import type { RepositorySnapshot, StockInterfaceParityResolvedModelSnapshot } from "../src/stock-interface-parity.js";

const PROVIDER_SESSION_ID = "paid-directional-pair";
const PROVIDER_WORKSPACE = "/prime-agent-autoresearch/isolated-workspace";
const PROVIDER_CONVERSATION_LOG = "/prime-agent-autoresearch/session.jsonl";
const PROMPT = "Propose one mechanistic LLVM pass-sequence candidate, then call the evaluator exactly once.";
const TOOL = {
	name: "autoresearch_evaluate",
	description: "Evaluate one proposed LLVM pass sequence.",
	parameters: {
		type: "object",
		properties: {
			actions: { type: "array", items: { type: "string" } },
			hypothesis: { type: "string" },
		},
		required: ["actions", "hypothesis"],
		additionalProperties: false,
	},
} as const;
const SNAPSHOT: RepositorySnapshot = {
	head: "a".repeat(40),
	coreTreeHashes: { "packages/ai": "b".repeat(64) },
	coreWorktreeStatus: "",
	trackedDiffSha256: "c".repeat(64),
	untrackedFileHashes: {},
	coreWorktreeDigest: "d".repeat(64),
};

function resolvedModel(): StockInterfaceParityResolvedModelSnapshot {
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

function liveEnvironment(wallMs: number): CompilerGymPaidLiveEnvironmentGateEvidence {
	return {
		protocol: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
		probeSourceSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
		expectedResultSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
		commandSha256: "e".repeat(64),
		stdoutSha256: "f".repeat(64),
		wallMs,
		pass: true,
	};
}

function request(ordinal: number) {
	return {
		actions: [`-pass-${ordinal}`, "-verify"],
		hypothesis: `candidate ${ordinal} should improve instruction count`,
	};
}

function artifact(seed: string) {
	return { digest: sha256Text(seed), byteLength: Buffer.byteLength(seed), mediaType: "application/json" };
}

function evaluation(input: {
	ordinal: number;
	benchmarkId: string;
	outcome?: "verified" | "complete-semantic-rejection";
}) {
	const candidateSha256 = sha256Json(request(input.ordinal).actions);
	const manifestDigest = sha256Json({ candidateSha256, benchmarkId: input.benchmarkId, ordinal: input.ordinal });
	const jobId = `job_${manifestDigest.slice(0, 24)}`;
	const accepted = input.outcome !== "complete-semantic-rejection";
	return {
		candidateOrdinal: input.ordinal,
		benchmarkId: input.benchmarkId,
		submitted: { jobId, manifestDigest, duplicate: false },
		job: {
			jobId,
			manifestDigest,
			candidateSha256,
			state: {
				jobId,
				status: accepted ? "succeeded" : "invalid",
				statusAt: "2026-08-30T09:00:00.000Z",
				externalJobId: null,
				reason: accepted ? null : "complete semantic rejection",
			},
			measurement: {
				jobId,
				manifestDigest,
				verifierEpoch: "compiler-gym-fixture-v1",
				measuredAt: "2026-08-30T09:00:00.000Z",
				tasks: [
					{
						benchmarkId: input.benchmarkId,
						status: accepted ? "accepted" : "rejected",
						metrics: accepted ? { IrInstructionCount: 100 + input.ordinal } : {},
						verifier: {
							passed: accepted,
							checks: ["semantic"],
							errors: accepted ? [] : ["semantic mismatch"],
						},
						runtimeMs: 1_000,
					},
				],
				hardware: { cluster: "FarmShare" },
				provenance: { adapter: "canonical-one-task" },
				stdout: artifact(`stdout-${input.ordinal}-${input.benchmarkId}`),
				stderr: null,
			},
		},
	};
}

function envelope(
	arm: CompilerGymProxyCascadePaidProviderArm,
	ordinal: number,
	rejectionOrdinal: number | null = null,
) {
	const outcome = rejectionOrdinal === ordinal ? "complete-semantic-rejection" : "verified";
	const evaluations = [evaluation({ ordinal, benchmarkId: COMPILER_GYM_PROXY_CASCADE_BLOWFISH, outcome })];
	if (arm === "full-control") {
		evaluations.push(evaluation({ ordinal, benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2, outcome }));
	}
	return {
		submissionOrdinal: ordinal,
		request: request(ordinal),
		evaluations,
		cascadeSelection: null,
		budget: { completedSubmissions: ordinal, maximumSubmissions: 4 },
	};
}

function providerPayload(input: {
	arm: CompilerGymProxyCascadePaidProviderArm;
	providerDispatchOrdinal: number;
	systemPrompt: string;
	spec: ReturnType<typeof buildCompilerGymProxyCascadePaidProviderSpec>;
	rejectionOrdinal?: number | null;
}): Record<string, unknown> {
	const history: unknown[] = [];
	for (let ordinal = 1; ordinal < input.providerDispatchOrdinal; ordinal++) {
		const callId = `call-${ordinal}`;
		history.push(
			{
				type: "function_call",
				id: `fc-${ordinal}`,
				call_id: callId,
				name: input.spec.tool.name,
				arguments: JSON.stringify(request(ordinal)),
			},
			{
				type: "function_call_output",
				call_id: callId,
				output: JSON.stringify(envelope(input.arm, ordinal, input.rejectionOrdinal ?? null)),
			},
		);
	}
	return {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		prompt_cache_key: input.spec.providerSessionId,
		service_tier: "priority",
		tool_choice: "auto",
		parallel_tool_calls: true,
		instructions: input.systemPrompt,
		input: [{ role: "user", content: [{ type: "input_text", text: input.spec.prompt }] }, ...history],
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

function captureExtensionHandlers(extension: ExtensionFactory): Map<string, (...args: unknown[]) => unknown> {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	extension({
		on(eventName: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(eventName, handler);
		},
	} as unknown as Parameters<ExtensionFactory>[0]);
	return handlers;
}

async function fixture(
	root: string,
	options: { snapshot?: RepositorySnapshot; environment?: () => CompilerGymPaidLiveEnvironmentGateEvidence } = {},
) {
	const agentDir = join(root, "agent");
	const spec = buildCompilerGymProxyCascadePaidProviderSpec({
		runnerProtocol: "compiler-gym-proxy-cascade-paid-runner-v1",
		pairId: "compiler-gym-paid-directional-pair-v1",
		arms: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
		prompt: PROMPT,
		tool: TOOL,
		providerSessionId: PROVIDER_SESSION_ID,
		providerVisibleWorkspace: PROVIDER_WORKSPACE,
		providerVisibleConversationLog: PROVIDER_CONVERSATION_LOG,
		agentRegistry: {
			agentDir,
			modelsJsonPath: join(agentDir, "models.json"),
			modelsJsonPresent: false,
		},
	});
	let environmentCall = 0;
	const guard = createCompilerGymProxyCascadePaidProviderGuard({
		spec,
		preregistrationSha256: "9".repeat(64),
		providerRequestAnchorPath: join(root, "provider-request-anchor.json"),
		activeAgentDir: agentDir,
		expectedRuntimeWorktreeSnapshot: SNAPSHOT,
		runtimeWorktreeSnapshotProvider: () => structuredClone(options.snapshot ?? SNAPSHOT),
		liveEnvironmentEvidenceProvider: () => options.environment?.() ?? liveEnvironment(++environmentCall),
	});
	return { spec, guard };
}

async function prepareArm(
	root: string,
	arm: CompilerGymProxyCascadePaidProviderArm,
	guard: Awaited<ReturnType<typeof fixture>>["guard"],
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
	return { runtime, systemPrompt: result.systemPrompt };
}

describe("CompilerGym proxy-cascade paid provider guard", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("admits exactly four pre-transport requests per arm and seals a global transcript chain", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-provider-"));
		tempDirs.push(root);
		const { spec, guard } = await fixture(root);
		const allTranscriptHashes: string[] = [];
		for (const arm of COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS) {
			const prepared = await prepareArm(root, arm, guard);
			for (let providerDispatchOrdinal = 1; providerDispatchOrdinal <= 4; providerDispatchOrdinal++) {
				const result = await prepared.runtime.providerRequestGate({
					payload: providerPayload({ arm, providerDispatchOrdinal, systemPrompt: prepared.systemPrompt, spec }),
					providerDispatchOrdinal,
					resolvedModel: resolvedModel(),
				});
				assert.deepEqual(result, { allowed: true, reason: null });
			}
			assert.equal(prepared.runtime.evidence.providerRequestAttempts, 4);
			assert.deepEqual(
				prepared.runtime.evidence.historyByDispatch.map((history) => history.observedPriorResultCount),
				[0, 1, 2, 3],
			);
			assert.equal(prepared.runtime.evidence.runtimeWorktreeDispatchAnchors.length, 4);
			assert.equal(prepared.runtime.evidence.liveEnvironmentDispatchAnchors.length, 4);
			assert.equal(prepared.runtime.evidence.providerRequestTranscriptAnchors.length, 4);
			assert.equal(prepared.runtime.evidence.firstProviderRequestBodyMatchedPairAnchor, true);
			assert.deepEqual(prepared.runtime.evidence.failures, []);
			for (const anchor of [
				...prepared.runtime.evidence.runtimeWorktreeDispatchAnchors,
				...prepared.runtime.evidence.liveEnvironmentDispatchAnchors,
				...prepared.runtime.evidence.providerRequestTranscriptAnchors,
			]) {
				assert.equal((await stat(anchor.path)).mode & 0o777, 0o600);
			}
			allTranscriptHashes.push(
				...prepared.runtime.evidence.providerRequestTranscriptAnchors.map((anchor) => anchor.sha256),
			);
		}
		assert.deepEqual(guard.pairEvidence.completedArms, [...COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS]);
		assert.equal(new Set(guard.pairEvidence.actualWorkspaces).size, 2);
		assert.equal(new Set(guard.pairEvidence.actualConversationLogs).size, 2);
		assert.equal(guard.pairEvidence.failures.length, 0);
		assert.equal(guard.pairEvidence.previousTranscriptAnchorSha256, allTranscriptHashes.at(-1));
		const durablePair = JSON.parse(await readFile(guard.pairEvidence.providerRequestAnchorPath, "utf8")) as {
			firstProviderRequestBodySha256: string;
		};
		assert.equal(durablePair.firstProviderRequestBodySha256, guard.pairEvidence.firstProviderRequestBodySha256);
	});

	it("allows complete semantic rejections while enforcing exact arm-local visible task sets", () => {
		const root = "/tmp/proxy-cascade-payload-fixture";
		const spec = buildCompilerGymProxyCascadePaidProviderSpec({
			runnerProtocol: "compiler-gym-proxy-cascade-paid-runner-v1",
			pairId: "compiler-gym-paid-directional-pair-v1",
			arms: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
			prompt: PROMPT,
			tool: TOOL,
			providerSessionId: PROVIDER_SESSION_ID,
			providerVisibleWorkspace: PROVIDER_WORKSPACE,
			providerVisibleConversationLog: PROVIDER_CONVERSATION_LOG,
			agentRegistry: {
				agentDir: join(root, "agent"),
				modelsJsonPath: join(root, "agent", "models.json"),
				modelsJsonPresent: false,
			},
		});
		for (const arm of COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS) {
			const validated = validateCompilerGymProxyCascadePaidProviderPayload({
				payload: providerPayload({
					arm,
					providerDispatchOrdinal: 4,
					systemPrompt: "normalized system prompt",
					spec,
					rejectionOrdinal: 2,
				}),
				arm,
				providerDispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized system prompt",
				spec,
			});
			assert.deepEqual(validated.failures, []);
			assert.equal(validated.history.results.length, 3);
			assert.ok(
				validated.history.results[1]?.semanticOutcomes.every(
					(outcome) => outcome === "complete-semantic-rejection",
				),
			);
			assert.deepEqual(
				validated.history.results.map((result) => result.benchmarkIds),
				arm === "full-control"
					? [
							[COMPILER_GYM_PROXY_CASCADE_BLOWFISH, COMPILER_GYM_PROXY_CASCADE_BZIP2],
							[COMPILER_GYM_PROXY_CASCADE_BLOWFISH, COMPILER_GYM_PROXY_CASCADE_BZIP2],
							[COMPILER_GYM_PROXY_CASCADE_BLOWFISH, COMPILER_GYM_PROXY_CASCADE_BZIP2],
						]
					: [
							[COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
							[COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
							[COMPILER_GYM_PROXY_CASCADE_BLOWFISH],
						],
			);
		}
	});

	it("allows multiple exact reasoning items in one history turn and rejects reasoning shape drift", () => {
		const root = "/tmp/proxy-cascade-multiple-reasoning-fixture";
		const spec = buildCompilerGymProxyCascadePaidProviderSpec({
			runnerProtocol: "compiler-gym-proxy-cascade-paid-runner-v1",
			pairId: "compiler-gym-paid-directional-pair-v1",
			arms: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
			prompt: PROMPT,
			tool: TOOL,
			providerSessionId: PROVIDER_SESSION_ID,
			providerVisibleWorkspace: PROVIDER_WORKSPACE,
			providerVisibleConversationLog: PROVIDER_CONVERSATION_LOG,
			agentRegistry: {
				agentDir: join(root, "agent"),
				modelsJsonPath: join(root, "agent", "models.json"),
				modelsJsonPresent: false,
			},
		});
		const payload = providerPayload({
			arm: "full-control",
			providerDispatchOrdinal: 3,
			systemPrompt: "normalized system prompt",
			spec,
		});
		const reasoningItems = [1, 2].map((index) => ({
			type: "reasoning",
			id: `rs-turn-2-${index}`,
			content: [],
			encrypted_content: `encrypted-turn-2-${index}`,
			summary: [{ type: "summary_text", text: `reasoning ${index}` }],
		}));
		(payload.input as unknown[]).splice(3, 0, ...reasoningItems);
		const validated = validateCompilerGymProxyCascadePaidProviderPayload({
			payload,
			arm: "full-control",
			providerDispatchOrdinal: 3,
			normalizedSystemPrompt: "normalized system prompt",
			spec,
		});
		assert.deepEqual(validated.failures, []);
		assert.equal(validated.history.observedPriorResultCount, 2);

		const drifted = structuredClone(payload);
		const driftedReasoning = (drifted.input as Array<Record<string, unknown>>)[3]!;
		driftedReasoning.unexpected = true;
		assert.match(
			validateCompilerGymProxyCascadePaidProviderPayload({
				payload: drifted,
				arm: "full-control",
				providerDispatchOrdinal: 3,
				normalizedSystemPrompt: "normalized system prompt",
				spec,
			}).failures.join("; "),
			/history turn 2 reasoning item shape drifted/,
		);
	});

	it("rejects future result history, cascade bzip2 leakage, mismatched candidates, arm labels, and guidance", () => {
		const root = "/tmp/proxy-cascade-payload-mutations";
		const spec = buildCompilerGymProxyCascadePaidProviderSpec({
			runnerProtocol: "compiler-gym-proxy-cascade-paid-runner-v1",
			pairId: "compiler-gym-paid-directional-pair-v1",
			arms: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
			prompt: PROMPT,
			tool: TOOL,
			providerSessionId: PROVIDER_SESSION_ID,
			providerVisibleWorkspace: PROVIDER_WORKSPACE,
			providerVisibleConversationLog: PROVIDER_CONVERSATION_LOG,
			agentRegistry: {
				agentDir: join(root, "agent"),
				modelsJsonPath: join(root, "agent", "models.json"),
				modelsJsonPresent: false,
			},
		});
		const base = providerPayload({
			arm: "proxy-cascade",
			providerDispatchOrdinal: 4,
			systemPrompt: "normalized system prompt",
			spec,
		});
		const mutations: Array<{ pattern: RegExp; mutate(value: Record<string, unknown>): void }> = [
			{
				pattern: /trailing or future result history/,
				mutate: (value) => {
					(value.input as unknown[]).push(
						{
							type: "function_call",
							id: "fc-4",
							call_id: "call-4",
							name: TOOL.name,
							arguments: JSON.stringify(request(4)),
						},
						{
							type: "function_call_output",
							call_id: "call-4",
							output: JSON.stringify(envelope("proxy-cascade", 4)),
						},
					);
				},
			},
			{
				pattern: /visible evaluation count drifted/,
				mutate: (value) => {
					const output = (value.input as Array<Record<string, unknown>>)[2]!;
					const parsed = JSON.parse(String(output.output)) as ReturnType<typeof envelope>;
					parsed.evaluations.push(evaluation({ ordinal: 1, benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2 }));
					output.output = JSON.stringify(parsed);
				},
			},
			{
				pattern: /candidate.*binding drifted/,
				mutate: (value) => {
					const output = (value.input as Array<Record<string, unknown>>)[2]!;
					const parsed = JSON.parse(String(output.output)) as ReturnType<typeof envelope>;
					parsed.evaluations[0]!.job.candidateSha256 = "0".repeat(64);
					output.output = JSON.stringify(parsed);
				},
			},
			{
				pattern: /arm label/,
				mutate: (value) => {
					const output = (value.input as Array<Record<string, unknown>>)[2]!;
					const parsed = JSON.parse(String(output.output)) as ReturnType<typeof envelope>;
					parsed.budget = { note: "proxy-cascade" } as unknown as typeof parsed.budget;
					output.output = JSON.stringify(parsed);
				},
			},
			{
				pattern: /late-novelty guidance/,
				mutate: (value) => {
					const output = (value.input as Array<Record<string, unknown>>)[2]!;
					const parsed = JSON.parse(String(output.output)) as ReturnType<typeof envelope> & {
						call4Guidance?: string;
					};
					parsed.call4Guidance = "hidden treatment";
					output.output = JSON.stringify(parsed);
				},
			},
		];
		for (const testCase of mutations) {
			const value = structuredClone(base);
			testCase.mutate(value);
			const validated = validateCompilerGymProxyCascadePaidProviderPayload({
				payload: value,
				arm: "proxy-cascade",
				providerDispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized system prompt",
				spec,
			});
			assert.match(validated.failures.join("; "), testCase.pattern);
		}

		const reusedControl = providerPayload({
			arm: "full-control",
			providerDispatchOrdinal: 2,
			systemPrompt: "normalized system prompt",
			spec,
		});
		const reusedOutput = (reusedControl.input as Array<Record<string, unknown>>)[2]!;
		const reusedEnvelope = JSON.parse(String(reusedOutput.output)) as ReturnType<typeof envelope>;
		const firstEvaluation = reusedEnvelope.evaluations[0]!;
		const secondEvaluation = reusedEnvelope.evaluations[1]!;
		secondEvaluation.submitted.jobId = firstEvaluation.submitted.jobId;
		secondEvaluation.submitted.manifestDigest = firstEvaluation.submitted.manifestDigest;
		secondEvaluation.job.jobId = firstEvaluation.job.jobId;
		secondEvaluation.job.manifestDigest = firstEvaluation.job.manifestDigest;
		secondEvaluation.job.state.jobId = firstEvaluation.job.jobId;
		secondEvaluation.job.measurement.jobId = firstEvaluation.job.jobId;
		secondEvaluation.job.measurement.manifestDigest = firstEvaluation.job.manifestDigest;
		reusedOutput.output = JSON.stringify(reusedEnvelope);
		assert.match(
			validateCompilerGymProxyCascadePaidProviderPayload({
				payload: reusedControl,
				arm: "full-control",
				providerDispatchOrdinal: 2,
				normalizedSystemPrompt: "normalized system prompt",
				spec,
			}).failures.join("; "),
			/reuses an evaluator job or manifest identity/,
		);

		const reusedAcrossCalls = structuredClone(base);
		const firstOutput = (reusedAcrossCalls.input as Array<Record<string, unknown>>)[2]!;
		const secondOutput = (reusedAcrossCalls.input as Array<Record<string, unknown>>)[4]!;
		const firstEnvelope = JSON.parse(String(firstOutput.output)) as ReturnType<typeof envelope>;
		const secondEnvelope = JSON.parse(String(secondOutput.output)) as ReturnType<typeof envelope>;
		secondEnvelope.evaluations[0]!.submitted.jobId = firstEnvelope.evaluations[0]!.submitted.jobId;
		secondEnvelope.evaluations[0]!.submitted.manifestDigest = firstEnvelope.evaluations[0]!.submitted.manifestDigest;
		secondEnvelope.evaluations[0]!.job.jobId = firstEnvelope.evaluations[0]!.job.jobId;
		secondEnvelope.evaluations[0]!.job.manifestDigest = firstEnvelope.evaluations[0]!.job.manifestDigest;
		secondEnvelope.evaluations[0]!.job.state.jobId = firstEnvelope.evaluations[0]!.job.jobId;
		secondEnvelope.evaluations[0]!.job.measurement.jobId = firstEnvelope.evaluations[0]!.job.jobId;
		secondEnvelope.evaluations[0]!.job.measurement.manifestDigest = firstEnvelope.evaluations[0]!.job.manifestDigest;
		secondOutput.output = JSON.stringify(secondEnvelope);
		assert.match(
			validateCompilerGymProxyCascadePaidProviderPayload({
				payload: reusedAcrossCalls,
				arm: "proxy-cascade",
				providerDispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized system prompt",
				spec,
			}).failures.join("; "),
			/provider request history reuses an evaluator (job|manifest) identity/,
		);
	});

	it("fails closed before transport on registry, runtime, environment, auth, and fifth-dispatch drift", async () => {
		const cases: Array<{
			name: string;
			pattern: RegExp;
			prepare(root: string): Promise<{
				fixture: Awaited<ReturnType<typeof fixture>>;
				model: StockInterfaceParityResolvedModelSnapshot;
			}>;
		}> = [
			{
				name: "runtime",
				pattern: /runtime worktree differs/,
				prepare: async (root) => {
					const drifted = structuredClone(SNAPSHOT);
					drifted.trackedDiffSha256 = "0".repeat(64);
					return { fixture: await fixture(root, { snapshot: drifted }), model: resolvedModel() };
				},
			},
			{
				name: "environment",
				pattern: /live environment evidence differs/,
				prepare: async (root) => {
					let call = 0;
					return {
						fixture: await fixture(root, {
							environment: () => ({ ...liveEnvironment(++call), expectedResultSha256: "0".repeat(64) }),
						}),
						model: resolvedModel(),
					};
				},
			},
			{
				name: "auth",
				pattern: /not stored OAuth/,
				prepare: async (root) => {
					const model = resolvedModel();
					model.storedCredentialType = "api_key";
					return { fixture: await fixture(root), model };
				},
			},
		];
		for (const testCase of cases) {
			const root = await mkdtemp(join(tmpdir(), `prime-proxy-cascade-${testCase.name}-`));
			tempDirs.push(root);
			const preparedCase = await testCase.prepare(root);
			const arm = await prepareArm(root, "full-control", preparedCase.fixture.guard);
			const result = await arm.runtime.providerRequestGate({
				payload: providerPayload({
					arm: "full-control",
					providerDispatchOrdinal: 1,
					systemPrompt: arm.systemPrompt,
					spec: preparedCase.fixture.spec,
				}),
				providerDispatchOrdinal: 1,
				resolvedModel: preparedCase.model,
			});
			assert.equal(result.allowed, false, testCase.name);
			assert.match(result.reason ?? "", testCase.pattern, testCase.name);
			assert.equal(arm.runtime.evidence.providerRequestTranscriptAnchors.length, 0);
		}

		const modelsRoot = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-models-"));
		tempDirs.push(modelsRoot);
		const modelsFixture = await fixture(modelsRoot);
		await mkdir(modelsFixture.spec.agentRegistry.agentDir, { recursive: true });
		await writeFile(modelsFixture.spec.agentRegistry.modelsJsonPath, "{}\n", { mode: 0o600 });
		const modelsArm = await prepareArm(modelsRoot, "full-control", modelsFixture.guard);
		const modelsResult = await modelsArm.runtime.providerRequestGate({
			payload: providerPayload({
				arm: "full-control",
				providerDispatchOrdinal: 1,
				systemPrompt: modelsArm.systemPrompt,
				spec: modelsFixture.spec,
			}),
			providerDispatchOrdinal: 1,
			resolvedModel: resolvedModel(),
		});
		assert.equal(modelsResult.allowed, false);
		assert.match(modelsResult.reason ?? "", /models\.json appeared/);

		const capRoot = await mkdtemp(join(tmpdir(), "prime-proxy-cascade-cap-"));
		tempDirs.push(capRoot);
		const capFixture = await fixture(capRoot);
		const capArm = await prepareArm(capRoot, "full-control", capFixture.guard);
		for (let ordinal = 1; ordinal <= 4; ordinal++) {
			assert.equal(
				(
					await capArm.runtime.providerRequestGate({
						payload: providerPayload({
							arm: "full-control",
							providerDispatchOrdinal: ordinal,
							systemPrompt: capArm.systemPrompt,
							spec: capFixture.spec,
						}),
						providerDispatchOrdinal: ordinal,
						resolvedModel: resolvedModel(),
					})
				).allowed,
				true,
			);
		}
		const fifth = await capArm.runtime.providerRequestGate({
			payload: {},
			providerDispatchOrdinal: 5,
			resolvedModel: resolvedModel(),
		});
		assert.equal(fifth.allowed, false);
		assert.match(fifth.reason ?? "", /exceeded four/);
		assert.equal(capArm.runtime.evidence.providerRequestTranscriptAnchors.length, 4);
	});

	it("rejects provider-visible arm labels and guidance in the frozen spec", () => {
		const root = "/tmp/proxy-cascade-spec-mutation";
		const valid = buildCompilerGymProxyCascadePaidProviderSpec({
			runnerProtocol: "compiler-gym-proxy-cascade-paid-runner-v1",
			pairId: "compiler-gym-paid-directional-pair-v1",
			arms: COMPILER_GYM_PROXY_CASCADE_PAID_PROVIDER_ARMS,
			prompt: PROMPT,
			tool: TOOL,
			providerSessionId: PROVIDER_SESSION_ID,
			providerVisibleWorkspace: PROVIDER_WORKSPACE,
			providerVisibleConversationLog: PROVIDER_CONVERSATION_LOG,
			agentRegistry: {
				agentDir: join(root, "agent"),
				modelsJsonPath: join(root, "agent", "models.json"),
				modelsJsonPresent: false,
			},
		});
		const label = structuredClone(valid);
		label.prompt = `${label.prompt} proxy-cascade`;
		label.promptSha256 = sha256Text(label.prompt);
		assert.throws(() => validateCompilerGymProxyCascadePaidProviderSpec(label), /arm label/);
		const guidance = { ...structuredClone(valid), guidance: { field: "call4Guidance" } };
		assert.throws(
			() => validateCompilerGymProxyCascadePaidProviderSpec(guidance as typeof valid),
			/provider spec keys drifted/,
		);
	});
});

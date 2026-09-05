import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
	type CompilerGymHardenedPaidProviderRuntime,
	createCompilerGymHardenedPaidProviderGuard,
	validateCompilerGymHardenedPaidProviderPayload,
	validateCompilerGymHardenedPaidResolvedModelSnapshot,
} from "../src/compiler-gym-hardened-paid-provider.js";
import {
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
} from "../src/compiler-gym-late-novelty-guidance.js";
import {
	buildCompilerGymLateNoveltyScreenPreregistration,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_CALIBRATION,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_HISTORICAL_MOTIVATION,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
	captureCompilerGymLateNoveltyProviderRegistryClosure,
	collectCompilerGymLateNoveltyScreenImplementationClosure,
	computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle,
	parseCompilerGymLateNoveltyScreenPreregistration,
	writeCompilerGymLateNoveltyScreenPreregistration,
} from "../src/compiler-gym-late-novelty-screen-preregistration.js";
import {
	assessCompilerGymLateNoveltyScreenPair,
	type CompilerGymLateNoveltyScreenArmResult,
} from "../src/compiler-gym-late-novelty-screen-protocol.js";
import {
	assessCompilerGymLateNoveltyAccounting,
	claimCompilerGymLateNoveltyGlobalAttempt,
	compilerGymLateNoveltyGlobalAttemptLockPath,
	computeCompilerGymLateNoveltyResultBinding,
	prepareCompilerGymLateNoveltyScreenRun,
} from "../src/compiler-gym-late-novelty-screen-runner.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	type StockInterfaceParityResolvedModelSnapshot,
	stockInterfaceParityImplementationSourcePaths,
} from "../src/stock-interface-parity.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUNTIME_SNAPSHOT = capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT);
const IMPLEMENTATION_CLOSURE = COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS.map(
	(relativePath, index) => ({ relativePath, sha256: (index + 1).toString(16).padStart(64, "0") }),
);
const STOCK_TRAJECTORY_BUNDLE_SHA256 = "f".repeat(64);
const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeSourceClosureFixtureFile(root: string, relativePath: string, contents: string): Promise<void> {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
}

async function seedSourceClosureFixture(root: string): Promise<void> {
	for (const relativePath of COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS) {
		await writeSourceClosureFixtureFile(root, relativePath, "export {};\n");
	}
}

async function preregistrationFixture() {
	const agentDir = await mkdtemp(join(tmpdir(), "prime-late-novelty-registry-"));
	tempDirectories.push(agentDir);
	const providerRegistryClosure = await captureCompilerGymLateNoveltyProviderRegistryClosure(agentDir);
	return buildCompilerGymLateNoveltyScreenPreregistration({
		createdAt: "2026-08-29T03:00:00.000Z",
		drawHex: "00".repeat(16),
		implementationClosure: IMPLEMENTATION_CLOSURE,
		stockTrajectoryImplementationBundleSha256: STOCK_TRAJECTORY_BUNDLE_SHA256,
		runtimeWorktreeSnapshot: RUNTIME_SNAPSHOT,
		providerRegistryClosure,
	});
}

function initializeProviderRuntime(
	runtime: CompilerGymHardenedPaidProviderRuntime<"unchanged-control" | "late-novelty-treatment">,
	toolName: string,
	root: string,
): void {
	type BeforeAgentStart = (event: {
		systemPrompt: string;
		systemPromptOptions: {
			customPrompt: undefined;
			selectedTools: string[];
			contextFiles: never[];
			skills: never[];
			cwd: string;
			messagesPath: string;
		};
	}) => unknown;
	const captured: { handler: BeforeAgentStart | null } = { handler: null };
	const pi = {
		on(name: string, candidate: unknown) {
			if (name === "before_agent_start") captured.handler = candidate as BeforeAgentStart;
		},
	} as unknown as ExtensionAPI;
	runtime.extensionFactory(pi);
	assert.ok(captured.handler);
	const cwd = join(root, "workspace");
	const messagesPath = join(root, "sessions", "session.jsonl");
	captured.handler({
		systemPrompt: `Working directory: ${cwd}\nConversation log: ${messagesPath}`,
		systemPromptOptions: {
			customPrompt: undefined,
			selectedTools: [toolName],
			contextFiles: [],
			skills: [],
			cwd,
			messagesPath,
		},
	});
}

function armResult(input: {
	arm: CompilerGymLateNoveltyScreenArmResult["arm"];
	treatmentDelivered: boolean;
	parent: { actions: string[]; blowfishIr: number; bzip2Ir: number };
	child: { actions: string[]; blowfishIr: number; bzip2Ir: number };
}): CompilerGymLateNoveltyScreenArmResult {
	return {
		arm: input.arm,
		treatmentDelivered: input.treatmentDelivered,
		calls: [
			{ callIndex: 1, actions: ["-sroa"], outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
			{ callIndex: 2, actions: ["-gvn"], outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
			{ callIndex: 3, outcome: "verified", ...input.parent },
			{ callIndex: 4, outcome: "verified", ...input.child },
		],
	};
}

function priorTurn(index: number, output: Record<string, unknown>): Record<string, unknown>[] {
	const callId = `call_${index}`;
	return [
		{
			type: "reasoning",
			id: `rs_${index}`,
			content: [],
			encrypted_content: `encrypted-${index}`,
			summary: [],
		},
		{
			type: "function_call",
			id: `fc_${index}`,
			call_id: callId,
			name: "autoresearch_evaluate",
			arguments: "{}",
		},
		{ type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
	];
}

function acceptedResultThree(withGuidance: boolean): Record<string, unknown> {
	return {
		job: {
			state: { status: "succeeded" },
			measurement: {
				tasks: [
					{
						benchmarkId: "benchmark://cbench-v1/blowfish",
						status: "accepted",
						verifier: { passed: true },
					},
					{
						benchmarkId: "benchmark://cbench-v1/bzip2",
						status: "accepted",
						verifier: { passed: true },
					},
				],
			},
		},
		...(withGuidance ? { [COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD]: COMPILER_GYM_LATE_NOVELTY_GUIDANCE } : {}),
	};
}

function payloadFixture(input: {
	prompt: string;
	tool: { name: string; description: string; parameters: unknown };
	sessionId: string;
	dispatchOrdinal: 1 | 2 | 3 | 4;
	guidanceOnThirdOutput?: boolean;
}): Record<string, unknown> {
	const history = Array.from({ length: input.dispatchOrdinal - 1 }, (_, index) =>
		priorTurn(
			index + 1,
			input.guidanceOnThirdOutput && index === 2 ? acceptedResultThree(true) : { result: index + 1 },
		),
	).flat();
	return {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		instructions: "normalized-system-prompt",
		input: [{ role: "user", content: [{ type: "input_text", text: input.prompt }] }, ...history],
		text: { verbosity: "low" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: input.sessionId,
		tool_choice: "auto",
		parallel_tool_calls: true,
		service_tier: "priority",
		tools: [{ type: "function", ...input.tool, strict: null }],
		reasoning: { effort: "xhigh", summary: "auto" },
	};
}

const RESOLVED_MODEL: StockInterfaceParityResolvedModelSnapshot = {
	registryModel: {
		provider: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.provider,
		id: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.id,
		api: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.api,
		baseUrl: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.baseUrl,
		headerNames: [],
	},
	sessionModel: {
		provider: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.provider,
		id: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.id,
		api: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.api,
		baseUrl: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY.baseUrl,
		headerNames: [],
	},
	registryLoadErrorPresent: false,
	storedCredentialType: "oauth",
	oauthProviderRegistered: true,
	requestAuthResolved: true,
	apiKeyPresent: true,
	selectedAuthSource: "stored",
	resolvedRequestHeaderNames: [],
};

describe("CompilerGym prospective late-novelty paid screen", () => {
	it("freezes one randomized directional pair without causal, replication, or GPU claims", async () => {
		const preregistration = await preregistrationFixture();
		assert.equal(preregistration.providerSpec.runnerProtocol, COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL);
		assert.deepEqual(preregistration.randomization.armOrder, ["unchanged-control", "late-novelty-treatment"]);
		assert.deepEqual(preregistration.authorization, {
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			paid: true,
			treatmentExecution: true,
			maximumActualProviderDispatches: 8,
			perArmActualProviderDispatches: 4,
			authorizedOnlyAfterAllPreDispatchIntegrityGatesPass: true,
			compactionOrAuxiliaryModelCallsAuthorized: false,
		});
		assert.equal(preregistration.causalClaimAllowed, false);
		assert.equal(preregistration.replicationClaimAllowed, false);
		assert.equal(preregistration.gpuPromotionAllowed, false);
		assert.equal(preregistration.frozenCommon.latchForbiddenToolExecutionWithinResponse, true);
		assert.equal(preregistration.treatment.serializedFieldBytes, 128);
		assert.deepEqual(
			parseCompilerGymLateNoveltyScreenPreregistration(
				structuredClone(preregistration),
				IMPLEMENTATION_CLOSURE,
				STOCK_TRAJECTORY_BUNDLE_SHA256,
				RUNTIME_SNAPSHOT,
				preregistration.providerRegistryClosure,
			),
			preregistration,
		);

		const drifted = structuredClone(preregistration);
		drifted.providerSpec.runnerProtocol = "attacker-selected-runner";
		assert.throws(
			() =>
				parseCompilerGymLateNoveltyScreenPreregistration(
					drifted,
					IMPLEMENTATION_CLOSURE,
					STOCK_TRAJECTORY_BUNDLE_SHA256,
					RUNTIME_SNAPSHOT,
					preregistration.providerRegistryClosure,
				),
			/does not match the frozen protocol/,
		);
	});

	it("seals a sorted transitive closure and catches a warm-backend mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-late-novelty-source-closure-"));
		tempDirectories.push(root);
		await seedSourceClosureFixture(root);
		const adapterPath = "research/autoresearch/src/compiler-gym-ir-delta-screen-adapter.ts";
		const warmBackendPath = "research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts";
		const canonicalEvaluatorPath = "research/autoresearch/evaluators/compiler_gym_eval.py";
		const irDeltaEvaluatorPath = "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py";
		await writeSourceClosureFixtureFile(
			root,
			adapterPath,
			'import { warmBackendVersion } from "./compiler-gym-warm-farmshare-backend.js";\nexport { warmBackendVersion };\n',
		);
		await writeSourceClosureFixtureFile(root, warmBackendPath, 'export const warmBackendVersion = "before";\n');

		const before = await collectCompilerGymLateNoveltyScreenImplementationClosure(root);
		assert.deepEqual(
			before.map((record) => record.relativePath),
			before.map((record) => record.relativePath).sort(),
		);
		assert.ok(
			before.every((record) => !record.relativePath.startsWith("../") && !record.relativePath.includes("\\")),
		);
		const beforeWarm = before.find((record) => record.relativePath === warmBackendPath);
		const beforeCanonicalEvaluator = before.find((record) => record.relativePath === canonicalEvaluatorPath);
		const beforeIrDeltaEvaluator = before.find((record) => record.relativePath === irDeltaEvaluatorPath);
		assert.ok(beforeWarm);
		assert.ok(beforeCanonicalEvaluator);
		assert.ok(beforeIrDeltaEvaluator);

		const agentDir = join(root, "agent");
		const providerRegistryClosure = await captureCompilerGymLateNoveltyProviderRegistryClosure(agentDir);
		const sealed = buildCompilerGymLateNoveltyScreenPreregistration({
			createdAt: "2026-08-29T03:30:00.000Z",
			drawHex: "00".repeat(16),
			implementationClosure: before,
			stockTrajectoryImplementationBundleSha256: STOCK_TRAJECTORY_BUNDLE_SHA256,
			runtimeWorktreeSnapshot: RUNTIME_SNAPSHOT,
			providerRegistryClosure,
		});

		await writeSourceClosureFixtureFile(root, warmBackendPath, 'export const warmBackendVersion = "after";\n');
		const after = await collectCompilerGymLateNoveltyScreenImplementationClosure(root);
		const afterWarm = after.find((record) => record.relativePath === warmBackendPath);
		assert.ok(afterWarm);
		assert.deepEqual(
			after.map((record) => record.relativePath),
			before.map((record) => record.relativePath),
		);
		assert.notEqual(afterWarm.sha256, beforeWarm.sha256);
		assert.throws(
			() =>
				parseCompilerGymLateNoveltyScreenPreregistration(
					sealed,
					after,
					STOCK_TRAJECTORY_BUNDLE_SHA256,
					RUNTIME_SNAPSHOT,
					providerRegistryClosure,
				),
			/does not match the frozen protocol/,
		);

		await writeSourceClosureFixtureFile(root, canonicalEvaluatorPath, "# canonical evaluator drift\n");
		const afterCanonicalEvaluatorMutation = await collectCompilerGymLateNoveltyScreenImplementationClosure(root);
		assert.notEqual(
			afterCanonicalEvaluatorMutation.find((record) => record.relativePath === canonicalEvaluatorPath)?.sha256,
			beforeCanonicalEvaluator.sha256,
		);
		assert.throws(
			() =>
				parseCompilerGymLateNoveltyScreenPreregistration(
					sealed,
					afterCanonicalEvaluatorMutation,
					STOCK_TRAJECTORY_BUNDLE_SHA256,
					RUNTIME_SNAPSHOT,
					providerRegistryClosure,
				),
			/does not match the frozen protocol/,
		);
	});

	it("fails closed on unresolved and out-of-repository local imports", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-late-novelty-source-boundary-"));
		tempDirectories.push(root);
		await seedSourceClosureFixture(root);
		const adapterPath = "research/autoresearch/src/compiler-gym-ir-delta-screen-adapter.ts";
		await writeSourceClosureFixtureFile(root, adapterPath, 'export { missing } from "./missing.js";\n');
		await assert.rejects(
			collectCompilerGymLateNoveltyScreenImplementationClosure(root),
			/local import could not be resolved/,
		);

		await writeSourceClosureFixtureFile(root, adapterPath, 'export { escaped } from "../../../../outside.js";\n');
		await assert.rejects(
			collectCompilerGymLateNoveltyScreenImplementationClosure(root),
			/resolved outside the repository/,
		);
	});

	it("rejects canonical evaluator drift in preflight before claiming the global attempt", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-late-novelty-preflight-source-"));
		tempDirectories.push(root);
		const sandboxRepo = join(root, "repo");
		execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", REPO_ROOT, sandboxRepo]);
		execFileSync("git", ["checkout", "--quiet", "--detach", RUNTIME_SNAPSHOT.head], { cwd: sandboxRepo });
		await cp(join(REPO_ROOT, "research"), join(sandboxRepo, "research"), { recursive: true });

		const implementationClosure = await collectCompilerGymLateNoveltyScreenImplementationClosure(sandboxRepo);
		const stockBundle = await computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle(sandboxRepo);
		const providerRegistryClosure = await captureCompilerGymLateNoveltyProviderRegistryClosure(getAgentDir());
		const preregistration = buildCompilerGymLateNoveltyScreenPreregistration({
			createdAt: "2026-08-29T03:45:00.000Z",
			drawHex: "03".repeat(16),
			implementationClosure,
			stockTrajectoryImplementationBundleSha256: stockBundle.sha256,
			runtimeWorktreeSnapshot: capturePrimeRuntimeWorktreeSnapshot(sandboxRepo),
			providerRegistryClosure,
		});
		const preregistrationPath = join(root, "preregistration.json");
		await writeCompilerGymLateNoveltyScreenPreregistration(preregistrationPath, preregistration);
		await writeFile(
			join(sandboxRepo, "research/autoresearch/evaluators/compiler_gym_eval.py"),
			"# canonical evaluator drift before paid dispatch\n",
			"utf8",
		);

		await assert.rejects(
			prepareCompilerGymLateNoveltyScreenRun({ preregistrationPath, repoRoot: sandboxRepo }),
			/does not match the frozen protocol/,
		);
		await assert.rejects(
			readFile(compilerGymLateNoveltyGlobalAttemptLockPath(sandboxRepo), "utf8"),
			(error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
		);
	});

	it("uses exact integer-ratio comparisons and serializes ratio terms as decimal strings", () => {
		const control = armResult({
			arm: "unchanged-control",
			treatmentDelivered: false,
			parent: { actions: ["-a", "-b", "-c"], blowfishIr: 100, bzip2Ir: 200 },
			child: { actions: ["-a", "-b", "-c", "-d"], blowfishIr: 110, bzip2Ir: 210 },
		});
		const treatment = armResult({
			arm: "late-novelty-treatment",
			treatmentDelivered: true,
			parent: { actions: ["-a", "-b", "-c"], blowfishIr: 100, bzip2Ir: 200 },
			child: { actions: ["-x"], blowfishIr: 90, bzip2Ir: 180 },
		});
		const assessment = assessCompilerGymLateNoveltyScreenPair({ control, treatment });
		assert.equal(assessment.decision, "directional-win-promising");
		assert.equal(assessment.nextGate, "one-fresh-randomized-replication");
		assert.deepEqual(assessment.control.normalizedMinimaxParentRatio, {
			numerator: "110",
			denominator: "100",
			value: 1.1,
		});
		assert.deepEqual(assessment.treatment.normalizedMinimaxParentRatio, {
			numerator: "90",
			denominator: "100",
			value: 0.9,
		});
	});

	it("requires exact provider payload keys, transcript grammar, and treatment guidance location", async () => {
		const preregistration = await preregistrationFixture();
		const spec = preregistration.providerSpec;
		const treatment = payloadFixture({
			prompt: spec.prompt,
			tool: spec.tool,
			sessionId: spec.providerSessionId,
			dispatchOrdinal: 4,
			guidanceOnThirdOutput: true,
		});
		assert.deepEqual(
			validateCompilerGymHardenedPaidProviderPayload({
				payload: treatment,
				arm: "late-novelty-treatment",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}),
			[],
		);

		const multipleReasoning = structuredClone(treatment);
		assert.ok(Array.isArray(multipleReasoning.input));
		const secondTurnReasoningIndex = multipleReasoning.input.findIndex(
			(item) => typeof item === "object" && item !== null && "id" in item && item.id === "rs_2",
		);
		assert.ok(secondTurnReasoningIndex > 0);
		multipleReasoning.input.splice(secondTurnReasoningIndex + 1, 0, {
			type: "reasoning",
			id: "rs_2_continued",
			content: [],
			encrypted_content: "encrypted-2-continued",
			summary: [{ type: "summary_text", text: "continued reasoning" }],
		});
		assert.deepEqual(
			validateCompilerGymHardenedPaidProviderPayload({
				payload: multipleReasoning,
				arm: "late-novelty-treatment",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}),
			[],
		);

		const malformedReasoning = structuredClone(multipleReasoning);
		assert.ok(Array.isArray(malformedReasoning.input));
		const continuedReasoning = malformedReasoning.input[secondTurnReasoningIndex + 1];
		assert.ok(typeof continuedReasoning === "object" && continuedReasoning !== null);
		continuedReasoning.unexpected = true;
		assert.match(
			validateCompilerGymHardenedPaidProviderPayload({
				payload: malformedReasoning,
				arm: "late-novelty-treatment",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}).join("; "),
			/reasoning item shape drifted/,
		);

		const extraTopLevel = { ...treatment, max_output_tokens: 16_384 };
		assert.match(
			validateCompilerGymHardenedPaidProviderPayload({
				payload: extraTopLevel,
				arm: "late-novelty-treatment",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}).join("; "),
			/payload keys drifted/,
		);

		const leakedControl = structuredClone(treatment);
		assert.match(
			validateCompilerGymHardenedPaidProviderPayload({
				payload: leakedControl,
				arm: "unchanged-control",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}).join("; "),
			/guidance leaked/,
		);

		const trailingItem = structuredClone(treatment);
		assert.ok(Array.isArray(trailingItem.input));
		trailingItem.input.push({ role: "user", content: [] });
		assert.match(
			validateCompilerGymHardenedPaidProviderPayload({
				payload: trailingItem,
				arm: "late-novelty-treatment",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}).join("; "),
			/unexpected trailing items/,
		);
	});

	it("requires the exact resolved Luna/OAuth snapshot and an absent active models.json", async () => {
		assert.deepEqual(validateCompilerGymHardenedPaidResolvedModelSnapshot(RESOLVED_MODEL), []);
		assert.match(
			validateCompilerGymHardenedPaidResolvedModelSnapshot({
				...RESOLVED_MODEL,
				selectedAuthSource: "models.json",
			}).join("; "),
			/did not select stored OAuth/,
		);

		const agentDir = await mkdtemp(join(tmpdir(), "prime-late-novelty-models-"));
		tempDirectories.push(agentDir);
		const closure = await captureCompilerGymLateNoveltyProviderRegistryClosure(agentDir);
		assert.deepEqual(closure, {
			agentDir: resolve(agentDir),
			modelsJsonPath: resolve(agentDir, "models.json"),
			modelsJsonPresent: false,
		});
		await writeFile(closure.modelsJsonPath, "{}\n", { encoding: "utf8", mode: 0o600 });
		await assert.rejects(
			captureCompilerGymLateNoveltyProviderRegistryClosure(agentDir),
			/forbids an active models\.json/,
		);
	});

	it("allows treatment call four without guidance only when result three was not accepted", async () => {
		const preregistration = await preregistrationFixture();
		const spec = preregistration.providerSpec;
		const payload = payloadFixture({
			prompt: spec.prompt,
			tool: spec.tool,
			sessionId: spec.providerSessionId,
			dispatchOrdinal: 4,
		});
		assert.deepEqual(
			validateCompilerGymHardenedPaidProviderPayload({
				payload,
				arm: "late-novelty-treatment",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}),
			[],
		);
		assert.ok(Array.isArray(payload.input));
		const thirdOutput = payload.input.at(-1);
		assert.ok(typeof thirdOutput === "object" && thirdOutput !== null && !Array.isArray(thirdOutput));
		thirdOutput.output = JSON.stringify({
			result: 3,
			[COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD]: COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
		});
		assert.match(
			validateCompilerGymHardenedPaidProviderPayload({
				payload,
				arm: "late-novelty-treatment",
				dispatchOrdinal: 4,
				normalizedSystemPrompt: "normalized-system-prompt",
				spec,
			}).join("; "),
			/guidance leaked outside accepted-result-three/,
		);
	});

	it("revalidates the durable first-request anchor before the randomized second arm", async () => {
		const preregistration = await preregistrationFixture();
		const anchorPath = join(preregistration.providerRegistryClosure.agentDir, "provider-anchor.json");
		const guard = createCompilerGymHardenedPaidProviderGuard({
			spec: preregistration.providerSpec,
			preregistrationSha256: "a".repeat(64),
			providerRequestAnchorPath: anchorPath,
			activeAgentDir: preregistration.providerRegistryClosure.agentDir,
			expectedRuntimeWorktreeSnapshot: RUNTIME_SNAPSHOT,
			runtimeWorktreeSnapshotProvider: () => structuredClone(RUNTIME_SNAPSHOT),
		});
		const normalizedSystemPrompt = `Working directory: ${preregistration.providerSpec.providerVisibleWorkspace}\nConversation log: ${preregistration.providerSpec.providerVisibleConversationLog}`;
		const firstPayload = payloadFixture({
			prompt: preregistration.providerSpec.prompt,
			tool: preregistration.providerSpec.tool,
			sessionId: preregistration.providerSpec.providerSessionId,
			dispatchOrdinal: 1,
		});
		firstPayload.instructions = normalizedSystemPrompt;
		const control = guard.runtimeForArm("unchanged-control");
		initializeProviderRuntime(
			control,
			preregistration.providerSpec.tool.name,
			join(preregistration.providerRegistryClosure.agentDir, "control"),
		);
		assert.deepEqual(
			await control.providerRequestGate({
				payload: firstPayload,
				providerDispatchOrdinal: 1,
				resolvedModel: RESOLVED_MODEL,
			}),
			{ allowed: true, reason: null },
		);
		const anchor = JSON.parse(await readFile(anchorPath, "utf8")) as Record<string, unknown>;
		anchor.pairId = "tampered-pair";
		await writeFile(anchorPath, `${JSON.stringify(anchor)}\n`, { encoding: "utf8", mode: 0o600 });
		const treatment = guard.runtimeForArm("late-novelty-treatment");
		initializeProviderRuntime(
			treatment,
			preregistration.providerSpec.tool.name,
			join(preregistration.providerRegistryClosure.agentDir, "treatment"),
		);
		const rejected = await treatment.providerRequestGate({
			payload: structuredClone(firstPayload),
			providerDispatchOrdinal: 1,
			resolvedModel: RESOLVED_MODEL,
		});
		assert.equal(rejected.allowed, false);
		assert.match(rejected.reason ?? "", /pair anchor (?:hash|claims) drifted/);
	});

	it("makes a claimed preregistration permanently non-restartable before any provider call", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-late-novelty-preflight-"));
		tempDirectories.push(root);
		const sandboxRepo = join(root, "repo");
		execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", REPO_ROOT, sandboxRepo]);
		execFileSync("git", ["checkout", "--quiet", "--detach", RUNTIME_SNAPSHOT.head], { cwd: sandboxRepo });
		await cp(join(REPO_ROOT, "research"), join(sandboxRepo, "research"), { recursive: true });
		for (const prerequisite of [
			COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.preregistration,
			COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.result,
			COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.ledger,
			COMPILER_GYM_LATE_NOVELTY_SCREEN_CALIBRATION,
			COMPILER_GYM_LATE_NOVELTY_SCREEN_HISTORICAL_MOTIVATION,
		]) {
			const destination = join(sandboxRepo, prerequisite.path);
			await mkdir(dirname(destination), { recursive: true });
			await cp(join(REPO_ROOT, prerequisite.path), destination, { preserveTimestamps: true });
		}
		const runtimeWorktreeSnapshot = capturePrimeRuntimeWorktreeSnapshot(sandboxRepo);
		const implementationClosure = await collectCompilerGymLateNoveltyScreenImplementationClosure(sandboxRepo);
		const stockBundle = await computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle(sandboxRepo);
		const providerRegistryClosure = await captureCompilerGymLateNoveltyProviderRegistryClosure(getAgentDir());
		const preregistration = buildCompilerGymLateNoveltyScreenPreregistration({
			createdAt: "2026-08-29T04:00:00.000Z",
			drawHex: "01".repeat(16),
			implementationClosure,
			stockTrajectoryImplementationBundleSha256: stockBundle.sha256,
			runtimeWorktreeSnapshot,
			providerRegistryClosure,
		});
		const copiedPreregistrationPath = join(root, "copied-preregistration.json");
		const alternatePreregistrationPath = join(root, "alternate-preregistration.json");
		const preregistrationPath = join(root, "preregistration.json");
		await writeCompilerGymLateNoveltyScreenPreregistration(preregistrationPath, preregistration);
		await writeCompilerGymLateNoveltyScreenPreregistration(copiedPreregistrationPath, preregistration);
		const alternatePreregistration = buildCompilerGymLateNoveltyScreenPreregistration({
			createdAt: "2026-08-29T04:00:02.000Z",
			drawHex: "02".repeat(16),
			implementationClosure,
			stockTrajectoryImplementationBundleSha256: stockBundle.sha256,
			runtimeWorktreeSnapshot,
			providerRegistryClosure,
		});
		await writeCompilerGymLateNoveltyScreenPreregistration(alternatePreregistrationPath, alternatePreregistration);
		const preflight = await prepareCompilerGymLateNoveltyScreenRun({ preregistrationPath, repoRoot: sandboxRepo });
		assert.doesNotThrow(() =>
			stockInterfaceParityImplementationSourcePaths({
				evaluatorScriptPath: preflight.evaluatorScriptPath,
				additionalSourcePaths: preflight.additionalSourcePaths,
			}),
		);
		const copiedPreflight = await prepareCompilerGymLateNoveltyScreenRun({
			preregistrationPath: copiedPreregistrationPath,
			repoRoot: sandboxRepo,
		});
		const alternatePreflight = await prepareCompilerGymLateNoveltyScreenRun({
			preregistrationPath: alternatePreregistrationPath,
			repoRoot: sandboxRepo,
		});
		assert.equal(preflight.stockTrajectoryImplementationBundleSha256, stockBundle.sha256);
		assert.equal(copiedPreflight.preregistrationSha256, preflight.preregistrationSha256);
		assert.equal(copiedPreflight.globalAttemptLockPath, preflight.globalAttemptLockPath);
		assert.equal(alternatePreflight.globalAttemptLockPath, preflight.globalAttemptLockPath);
		let testClaimedGlobalLock = false;
		try {
			await claimCompilerGymLateNoveltyGlobalAttempt({
				preflight,
				outputDir: join(root, "execution"),
				firstArm: preregistration.randomization.armOrder[0],
				createdAt: "2026-08-29T04:00:01.000Z",
			});
			testClaimedGlobalLock = true;
			await assert.rejects(
				claimCompilerGymLateNoveltyGlobalAttempt({
					preflight: copiedPreflight,
					outputDir: join(root, "copied-execution"),
					firstArm: preregistration.randomization.armOrder[0],
					createdAt: "2026-08-29T04:00:03.000Z",
				}),
				/EEXIST/,
			);
			for (const path of [preregistrationPath, copiedPreregistrationPath, alternatePreregistrationPath]) {
				await assert.rejects(
					prepareCompilerGymLateNoveltyScreenRun({ preregistrationPath: path, repoRoot: sandboxRepo }),
					/already attempted/,
				);
			}
		} finally {
			if (testClaimedGlobalLock) await rm(preflight.globalAttemptLockPath);
		}
	});

	it("keeps a rejected third proposal as complete scientific-prefix accounting", () => {
		const base = {
			policyPrefixKind: "schema-rejected-local-abort",
			providerCalls: 3,
			blockedProviderCalls: 1,
			blockedReasons: ["forbidden-tool-execution"],
			evaluatorCalls: 2,
			requestCount: 2,
			jobIdCount: 2,
			feedbackCount: 2,
			jobCount: 2,
			submissions: 2,
			taskEvaluations: 4,
			actualTaskEvaluations: 4,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 0,
			duplicateCount: 0,
			assistantResponseCount: 4,
			syntheticPolicyAbortCount: 1,
		} as const;
		assert.deepEqual(assessCompilerGymLateNoveltyAccounting(base), {
			complete: true,
			mode: "scientific-policy-prefix",
		});
		assert.equal(assessCompilerGymLateNoveltyAccounting({ ...base, syntheticPolicyAbortCount: 0 }).complete, false);
		assert.equal(
			assessCompilerGymLateNoveltyAccounting({
				...base,
				policyPrefixKind: "multiple-tool-local-abort",
				providerCalls: 4,
				evaluatorCalls: 4,
				requestCount: 4,
				jobIdCount: 4,
				feedbackCount: 4,
				jobCount: 4,
				submissions: 4,
				taskEvaluations: 8,
				actualTaskEvaluations: 8,
				assistantResponseCount: 5,
			}).complete,
			true,
		);
		const binding = computeCompilerGymLateNoveltyResultBinding({ pairId: "pair", resultBindingSha256: "ignored" });
		assert.equal(binding, computeCompilerGymLateNoveltyResultBinding({ pairId: "pair" }));
		assert.notEqual(binding, computeCompilerGymLateNoveltyResultBinding({ pairId: "changed" }));
	});
});

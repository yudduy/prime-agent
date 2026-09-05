import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	getLatestCompactionEntry,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ResearchController } from "./controller.js";
import { createResearchTools } from "./tools.js";
import type { EvaluationAdapter, EvaluationJob, EvaluationOutcome } from "./types.js";

class CanaryAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;
	calls = 0;

	async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
		this.calls++;
		assert.deepEqual(job.benchmarkIds, ["canary/tool-loop"]);
		assert.equal(job.candidateContent, "-mem2reg");
		return {
			verifierEpoch: "canary-v1",
			tasks: [
				{
					benchmarkId: "canary/tool-loop",
					status: "accepted",
					metrics: { IrInstructionCount: 346 },
					verifier: { passed: true, checks: ["typed-round-trip"], errors: [] },
					runtimeMs: 1,
				},
			],
			hardware: { host: "local-canary" },
			provenance: { adapter: "deterministic-canary" },
			stdout: "canary measurement accepted",
		};
	}
}

function parseOutputDir(argv: readonly string[]): string {
	if (argv.length === 0) {
		const stamp = new Date().toISOString().replaceAll(":", "-");
		return resolve(".autoresearch", "live-canary", stamp);
	}
	if (argv.length === 2 && argv[0] === "--output-dir") return resolve(argv[1]);
	throw new Error("Usage: npm run autoresearch:canary -- [--output-dir <path>]");
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

async function main(): Promise<void> {
	const outputDir = parseOutputDir(process.argv.slice(2));
	const sessionDir = join(outputDir, "sessions");
	const ledgerPath = join(outputDir, "evidence.jsonl");
	await mkdir(sessionDir, { recursive: true, mode: 0o700 });
	await chmod(sessionDir, 0o700);

	const adapter = new CanaryAdapter();
	const controller = await ResearchController.open({
		ledgerPath,
		artifactDir: join(outputDir, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "fastAtOne", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": ["canary/tool-loop"],
			kernelbench: [],
			nanogpt: [],
		},
		maxInflight: { "compiler-gym": 1 },
	});
	await chmod(ledgerPath, 0o600);

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find("openai-codex", "gpt-5.6-luna");
	if (!model) throw new Error("openai-codex/gpt-5.6-luna is not registered");
	if (!modelRegistry.hasConfiguredAuth(model)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for Prime Agent");
	}

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false, agentCallable: false, reserveTokens: 4096, keepRecentTokens: 1 },
		autoRefine: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0 } },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
		systemPrompt:
			"You are a deterministic live integration canary. Call only the explicitly requested autoresearch tool exactly once, then return the exact requested one-line answer.",
	});
	await resourceLoader.reload();

	const sessionManager = SessionManager.create(process.cwd(), sessionDir);
	sessionManager.flushNow();
	const researchTools = createResearchTools(controller, { enableCompare: false }).filter(
		(tool) => tool.name === "autoresearch_submit" || tool.name === "autoresearch_recall",
	);
	const { session } = await createAgentSession({
		cwd: process.cwd(),
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: "xhigh",
		serviceTier: "priority",
		settingsManager,
		sessionManager,
		resourceLoader,
		tools: researchTools.map((tool) => tool.name),
		customTools: researchTools,
		includeGoals: false,
		includeCompactSkill: false,
	});
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("Canary session is not persistent");
	await chmod(sessionFile, 0o600);
	assert.deepEqual(session.getActiveToolNames().sort(), ["autoresearch_recall", "autoresearch_submit"]);
	assert.equal(session.serviceTier, "priority");

	const events: AgentSessionEvent[] = [];
	const usages: Usage[] = [];
	const assistantMessages: AssistantMessage[] = [];
	const unsubscribe = session.subscribe((event) => {
		events.push(event);
		if (event.type === "message_end" && event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			usages.push(structuredClone(message.usage));
			assistantMessages.push(structuredClone(message));
		}
	});

	const nonce = randomUUID();
	try {
		const submitArguments = {
			lane: "compiler-gym",
			benchmarkIds: ["canary/tool-loop"],
			budgetClass: "smoke",
			treatment: "live-canary",
			proposal: {
				hypothesis: `typed tool round trip ${nonce}`,
				mechanism: "deterministic local evaluator",
				predictedOutcome: "one accepted job with one durable measurement",
				boundaryConditions: ["canary only"],
				parentJobIds: [],
			},
			candidate: { format: "llvm-pass-sequence", content: "-mem2reg" },
		};
		await session.promptAndWait(
			`Call autoresearch_submit exactly once with this exact JSON argument: ${JSON.stringify(submitArguments)}. After the tool result, reply exactly: SUBMITTED ${nonce}`,
		);
		await controller.waitForIdle();
		const jobs = controller.status();
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].state.status, "succeeded");

		const compaction = await session.compact(
			`Preserve the canary nonce ${nonce}, job ID ${jobs[0].proposal.jobId}, manifest digest ${jobs[0].proposal.manifestDigest}, and the fact that its measurement succeeded.`,
		);
		assert.ok(compaction.summary.includes(nonce) || compaction.summary.includes(jobs[0].proposal.jobId));

		await session.promptAndWait(
			`Call autoresearch_recall exactly once with {"statuses":["succeeded"],"limit":5}. Use its measured result, then reply exactly: RECALLED ${nonce} ${jobs[0].proposal.jobId}`,
		);

		const submitStarts = events.filter(
			(event) => event.type === "tool_execution_start" && event.toolName === "autoresearch_submit",
		);
		const submitEnds = events.filter(
			(event) => event.type === "tool_execution_end" && event.toolName === "autoresearch_submit",
		);
		const recallStarts = events.filter(
			(event) => event.type === "tool_execution_start" && event.toolName === "autoresearch_recall",
		);
		const recallEnds = events.filter(
			(event) => event.type === "tool_execution_end" && event.toolName === "autoresearch_recall",
		);
		assert.equal(submitStarts.length, 1);
		assert.equal(submitEnds.length, 1);
		assert.equal(recallStarts.length, 1);
		assert.equal(recallEnds.length, 1);
		assert.equal(submitEnds[0].type === "tool_execution_end" && submitEnds[0].isError, false);
		assert.equal(recallEnds[0].type === "tool_execution_end" && recallEnds[0].isError, false);
		assert.equal(events.filter((event) => event.type === "compaction_start").length, 1);
		const compactionEnds = events.filter((event) => event.type === "compaction_end");
		assert.equal(compactionEnds.length, 1);
		assert.equal(compactionEnds[0].type === "compaction_end" && compactionEnds[0].errorMessage, undefined);
		assert.equal(adapter.calls, 1);
		controller.verifyLedger();

		const finalText = assistantMessages.map(assistantText).filter(Boolean).at(-1) ?? "";
		assert.equal(finalText, `RECALLED ${nonce} ${jobs[0].proposal.jobId}`);
		const knownUsage = sumUsage(usages);
		assert.ok(knownUsage.totalTokens > 0);

		await controller.appendRunManifest({
			type: "live_canary",
			nonce,
			model: `${model.provider}/${model.id}`,
			thinkingLevel: "xhigh",
			requestedServiceTier: "priority",
			knownUsage,
			compactionUsageAccounting: "not exposed by current Prime Agent public API",
			sessionId: session.sessionId,
			sessionFile,
			jobId: jobs[0].proposal.jobId,
			manifestDigest: jobs[0].proposal.manifestDigest,
		});
	} finally {
		unsubscribe();
		await session.disposeAsync();
	}

	const reopenedManager = await SessionManager.openAsync(sessionFile, undefined, process.cwd());
	const reopenedBranch = reopenedManager.getBranch();
	const persistedToolResults = reopenedBranch.filter(
		(entry) => entry.type === "message" && entry.message.role === "toolResult",
	);
	assert.equal(persistedToolResults.length, 2);
	assert.ok(getLatestCompactionEntry(reopenedBranch));
	controller.verifyLedger();

	const summary = {
		ok: true,
		outputDir,
		sessionFile,
		model: `${model.provider}/${model.id}`,
		thinkingLevel: "xhigh",
		requestedAndLocallyEffectiveServiceTier: "priority",
		upstreamServiceTierAcknowledgement: "not exposed by current provider response API",
		knownAssistantUsage: sumUsage(usages),
		compactionUsageAccounting: "not exposed by current Prime Agent public API",
		toolExecutions: events.filter((event) => event.type === "tool_execution_end").length,
		compactions: events.filter((event) => event.type === "compaction_end").length,
		persistedToolResults: persistedToolResults.length,
		adapterDispatches: adapter.calls,
		jobs: controller.status().map((job) => ({
			jobId: job.proposal.jobId,
			manifestDigest: job.proposal.manifestDigest,
			status: job.state.status,
		})),
	};
	const resultPath = join(outputDir, "result.json");
	await writeFile(resultPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(resultPath, 0o600);
	console.log(JSON.stringify(summary));
}

await main();

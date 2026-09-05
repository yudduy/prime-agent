import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getLatestCompactionEntry,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "../src/artifact-store.js";
import { ResearchController } from "../src/controller.js";
import { EvidenceLedger } from "../src/ledger.js";
import { createResearchTools } from "../src/tools.js";
import type {
	EvaluationAdapter,
	EvaluationContext,
	EvaluationJob,
	EvaluationOutcome,
	JobView,
	ProposalRecord,
	SubmitRequest,
} from "../src/types.js";

describe("RLM canary resumable compaction seam", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("reopens a compacted parent while one no-GPU job has an outstanding durable handle", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-rlm-resumable-compaction-"));
		tempDirs.push(root);
		const sessionDir = join(root, "sessions");
		const sessionManager = SessionManager.create(root, sessionDir);
		sessionManager.flushNow();
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Faux parent session is not persistent");

		sessionManager.appendMessage({ role: "user", content: "Submit the local resumable canary", timestamp: 1 });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "Submitted one durable local job" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "faux",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});
		const keptEntryId = sessionManager.appendMessage({
			role: "user",
			content: "Checkpoint the outstanding handle before restart",
			timestamp: 3,
		});
		const externalJobId = "local-gate:job_compaction_resume";
		const jobId = "job_compaction_resume";
		const compactionSummary = `One evaluator job remains outstanding. Resume ${jobId} through ${externalJobId}; do not dispatch it again.`;
		sessionManager.appendCompaction(compactionSummary, keptEntryId, 15, {
			outstandingJobId: jobId,
			externalJobId,
		});
		sessionManager.flushNow();

		const artifactDir = join(root, "artifacts");
		const candidate = await new ArtifactStore(artifactDir).putString(
			'["-mem2reg"]',
			"application/vnd.prime.llvm-pass-sequence",
		);
		const proposal: ProposalRecord = {
			jobId,
			manifestDigest: "manifest-compaction-resume",
			branchId: sessionManager.getSessionId(),
			lane: "compiler-gym",
			benchmarkIds: ["canary/local-resume"],
			budgetClass: "smoke",
			treatment: "local-resumable-canary",
			proposal: {
				hypothesis: "A durable local gate survives parent compaction",
				mechanism: "The controller resumes a recorded external handle",
				predictedOutcome: "One resume call and zero fresh evaluator dispatches",
				boundaryConditions: ["faux test", "no model", "no GPU"],
				parentJobIds: [],
			},
			candidate,
			candidateFormat: "llvm-pass-sequence",
		};
		const ledgerPath = join(root, "evidence.jsonl");
		const ledger = await EvidenceLedger.open(ledgerPath);
		await ledger.append("proposal", proposal, "2026-08-27T00:00:00.000Z");
		for (const [status, at, handle] of [
			["accepted", "2026-08-27T00:00:01.000Z", null],
			["queued", "2026-08-27T00:00:02.000Z", null],
			["running", "2026-08-27T00:00:03.000Z", externalJobId],
		] as const) {
			await ledger.append("job_state", { jobId, status, statusAt: at, externalJobId: handle, reason: null }, at);
		}

		class LocalGateResumeAdapter implements EvaluationAdapter {
			readonly lane = "compiler-gym" as const;
			evaluateCalls = 0;
			resumeCalls: string[] = [];

			async evaluate(): Promise<EvaluationOutcome> {
				this.evaluateCalls++;
				throw new Error("Recovery must not make a fresh evaluator call");
			}

			async resume(job: EvaluationJob, handle: string, context: EvaluationContext): Promise<EvaluationOutcome> {
				context.signal.throwIfAborted();
				this.resumeCalls.push(handle);
				assert.equal(job.jobId, jobId);
				assert.equal(handle, externalJobId);
				return {
					verifierEpoch: "local-gate-v1",
					tasks: [
						{
							benchmarkId: "canary/local-resume",
							status: "accepted",
							metrics: { score: 1 },
							verifier: { passed: true, checks: ["local-gate"], errors: [] },
							runtimeMs: 1,
						},
					],
					hardware: { host: "local", accelerator: "none" },
					provenance: { adapter: "faux-local-gate" },
				};
			}
		}

		const reopenedSession = await SessionManager.openAsync(sessionFile, sessionDir, root);
		const compaction = getLatestCompactionEntry(reopenedSession.getBranch());
		assert.ok(compaction);
		assert.equal(compaction.firstKeptEntryId, keptEntryId);
		assert.equal(compaction.summary, compactionSummary);
		assert.deepEqual(compaction.details, { outstandingJobId: jobId, externalJobId });

		const adapter = new LocalGateResumeAdapter();
		const controller = await ResearchController.open({
			ledgerPath,
			artifactDir,
			adapters: [adapter],
			metrics: {
				"compiler-gym": { name: "score", direction: "maximize" },
				kernelbench: { name: "fastAtOne", direction: "maximize" },
				nanogpt: { name: "trainSteps", direction: "minimize" },
			},
			allowedBenchmarks: {
				"compiler-gym": ["canary/local-resume"],
				kernelbench: [],
				nanogpt: [],
			},
			allowedTreatments: ["local-resumable-canary"],
			maxInflight: { "compiler-gym": 1 },
		});
		await controller.waitForIdle();

		assert.equal(adapter.evaluateCalls, 0);
		assert.deepEqual(adapter.resumeCalls, [externalJobId]);
		const recovered = controller.status([jobId])[0];
		assert.equal(recovered.state.status, "succeeded");
		assert.equal(recovered.state.externalJobId, externalJobId);
		assert.equal(recovered.measurement?.provenance.adapter, "faux-local-gate");
		controller.verifyLedger();
	});

	it("recovers decision-critical branch evidence only through typed recall after destructive compaction", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-destructive-recall-gate-"));
		tempDirs.push(root);
		const sessionDir = join(root, "sessions");
		const sessionManager = SessionManager.create(root, sessionDir);
		sessionManager.flushNow();
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Destructive recall gate requires a persistent session");

		const earlyChampionSentinel = "EARLY_CHAMPION_SENTINEL_50_50";
		const earlyFailureSentinel = "EARLY_FAILURE_SENTINEL_REJECTED";
		const laterInferiorSentinel = "LATER_INFERIOR_SENTINEL_60_60";
		const foreignBranchSentinel = "FOREIGN_BRANCH_SENTINEL_1_1";

		class RecallGateAdapter implements EvaluationAdapter {
			readonly lane = "compiler-gym" as const;
			evaluateCalls = 0;

			async evaluate(job: EvaluationJob, context: EvaluationContext): Promise<EvaluationOutcome> {
				context.signal.throwIfAborted();
				this.evaluateCalls++;
				const failure = job.candidateContent.includes(earlyFailureSentinel);
				const score = job.candidateContent.includes(earlyChampionSentinel)
					? 50
					: job.candidateContent.includes(laterInferiorSentinel)
						? 60
						: job.candidateContent.includes(foreignBranchSentinel)
							? 1
							: 0;
				return {
					verifierEpoch: "destructive-recall-gate-v1",
					tasks: job.benchmarkIds.map((benchmarkId) => ({
						benchmarkId,
						status: failure ? "failed" : "accepted",
						metrics: { score },
						verifier: failure
							? { passed: false, checks: [], errors: [earlyFailureSentinel] }
							: { passed: true, checks: ["deterministic-gate"], errors: [] },
						runtimeMs: 1,
					})),
					hardware: { host: "local", accelerator: "none" },
					provenance: { adapter: "destructive-recall-gate" },
				};
			}
		}

		const ledgerPath = join(root, "evidence.jsonl");
		const artifactDir = join(root, "artifacts");
		const controllerOptions = (adapter: RecallGateAdapter) => ({
			ledgerPath,
			artifactDir,
			adapters: [adapter],
			metrics: {
				"compiler-gym": { name: "score", direction: "minimize" as const },
				kernelbench: { name: "fastAtOne", direction: "maximize" as const },
				nanogpt: { name: "trainSteps", direction: "minimize" as const },
			},
			allowedBenchmarks: {
				"compiler-gym": ["gate/a", "gate/b"],
				kernelbench: [],
				nanogpt: [],
			},
			allowedTreatments: ["M-gate"],
			maxInflight: { "compiler-gym": 1 },
		});
		const request = (branchId: string, sentinel: string): SubmitRequest => ({
			branchId,
			lane: "compiler-gym",
			benchmarkIds: ["gate/a", "gate/b"],
			budgetClass: "smoke",
			treatment: "M-gate",
			proposal: {
				hypothesis: `${sentinel} changes both deterministic task scores`,
				mechanism: "Hermetic destructive-compaction recall gate",
				predictedOutcome: "The typed ledger preserves the exact terminal outcome",
				boundaryConditions: ["faux adapter", "no provider", "no accelerator"],
				parentJobIds: [],
			},
			candidate: { format: "llvm-pass-sequence", content: JSON.stringify([sentinel]) },
		});

		const initialAdapter = new RecallGateAdapter();
		const initialController = await ResearchController.open(controllerOptions(initialAdapter));
		const branchId = sessionManager.getSessionId();
		const earlyChampion = await initialController.submit(request(branchId, earlyChampionSentinel));
		const earlyFailure = await initialController.submit(request(branchId, earlyFailureSentinel));
		const laterInferior = await initialController.submit(request(branchId, laterInferiorSentinel));
		const foreign = await initialController.submit(request("foreign-branch", foreignBranchSentinel));
		await initialController.waitForIdle();
		assert.equal(initialAdapter.evaluateCalls, 4);

		const earlyContext = JSON.stringify({
			earlyChampion: initialController.status([earlyChampion.jobId])[0],
			earlyFailure: initialController.status([earlyFailure.jobId])[0],
			foreign: initialController.status([foreign.jobId])[0],
		});
		sessionManager.appendMessage({ role: "user", content: "Record the early measured evidence", timestamp: 1 });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: earlyContext }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "faux",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		});
		const neutralMarkerId = sessionManager.appendMessage({
			role: "user",
			content: "Neutral compaction boundary with no experiment evidence",
			timestamp: 3,
		});
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "BOUNDARY_RECORDED" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "faux",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 4,
		});
		sessionManager.appendCompaction(
			"The early transcript was intentionally removed. Use only retained context or an authorized typed tool.",
			neutralMarkerId,
			100,
			{ gate: "destructive-recall-v1" },
		);
		const laterJob = initialController.status([laterInferior.jobId])[0];
		sessionManager.appendMessage({ role: "user", content: "Record the only visible result", timestamp: 5 });
		sessionManager.appendMessage({
			role: "assistant",
			content: [
				{
					type: "text",
					text: `${laterInferiorSentinel} ${laterJob.proposal.jobId} metrics=60/60 status=succeeded`,
				},
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "faux",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 6,
		});
		sessionManager.flushNow();

		const reopenedSession = await SessionManager.openAsync(sessionFile, sessionDir, root);
		const rebuiltContext = JSON.stringify(reopenedSession.buildSessionContext().messages);
		assert.ok(rebuiltContext.includes(laterInferiorSentinel));
		for (const removedSentinel of [earlyChampionSentinel, earlyFailureSentinel, foreignBranchSentinel]) {
			assert.equal(rebuiltContext.includes(removedSentinel), false, `${removedSentinel} leaked through compaction`);
		}
		for (const removedJobId of [earlyChampion.jobId, earlyFailure.jobId, foreign.jobId]) {
			assert.equal(rebuiltContext.includes(removedJobId), false, `${removedJobId} leaked through compaction`);
		}

		const reopenedAdapter = new RecallGateAdapter();
		const reopenedController = await ResearchController.open(controllerOptions(reopenedAdapter));
		await reopenedController.waitForIdle();
		assert.equal(reopenedAdapter.evaluateCalls, 0, "Restart must not redispatch terminal evaluator jobs");
		const controlTools = createResearchTools(reopenedController, {
			enableRecall: false,
			enableCompare: false,
		});
		assert.equal(
			controlTools.some((tool) => tool.name === "autoresearch_recall"),
			false,
		);
		const recall = createResearchTools(reopenedController, {
			enableRecall: true,
			enableCompare: false,
			includeRecallCandidateContent: true,
		}).find((tool) => tool.name === "autoresearch_recall");
		assert.ok(recall);

		const faux = registerFauxProvider({
			provider: `faux-destructive-recall-${process.pid}`,
			models: [{ id: "faux-1", reasoning: false }],
		});
		const model = faux.getModel();
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(model.provider, "faux-key");
		const modelRegistry = ModelRegistry.inMemory(authStorage);
		modelRegistry.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			apiKey: "faux-key",
			api: faux.api,
			models: faux.models.map((registeredModel) => ({
				id: registeredModel.id,
				name: registeredModel.name,
				api: registeredModel.api,
				reasoning: registeredModel.reasoning,
				input: registeredModel.input,
				cost: registeredModel.cost,
				contextWindow: registeredModel.contextWindow,
				maxTokens: registeredModel.maxTokens,
				baseUrl: registeredModel.baseUrl,
			})),
		});
		const settingsManager = SettingsManager.inMemory({
			compaction: { enabled: false, agentCallable: false },
			autoRefine: { enabled: false },
			retry: { enabled: false, provider: { maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 5_000 } },
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir: join(root, "agent"),
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			bundledSkillsDir: null,
			systemPrompt: "Use the typed recall tool to recover evidence that is absent from compacted context.",
		});
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: root,
			authStorage,
			modelRegistry,
			model,
			thinkingLevel: "off",
			serviceTier: "default",
			settingsManager,
			sessionManager: reopenedSession,
			resourceLoader,
			tools: [recall.name],
			customTools: [recall],
			includeGoals: false,
			includeCompactSkill: false,
		});
		const events: AgentSessionEvent[] = [];
		const unsubscribe = session.subscribe((event) => events.push(event));
		faux.setResponses([
			(context) => {
				const providerContext = JSON.stringify(context);
				assert.ok(providerContext.includes(laterInferiorSentinel));
				for (const removedSentinel of [earlyChampionSentinel, earlyFailureSentinel, foreignBranchSentinel]) {
					assert.equal(providerContext.includes(removedSentinel), false);
				}
				return fauxAssistantMessage(
					fauxToolCall("autoresearch_recall", {
						lane: "compiler-gym",
						statuses: ["succeeded", "invalid", "failed"],
						limit: 50,
					}),
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				const providerContext = JSON.stringify(context);
				assert.ok(providerContext.includes(earlyChampionSentinel));
				assert.ok(providerContext.includes(earlyFailureSentinel));
				assert.equal(providerContext.includes(foreignBranchSentinel), false);
				return fauxAssistantMessage("RECALL_COMPLETE");
			},
		]);

		try {
			await session.promptAndWait("Recover all branch-local terminal evidence, then reply RECALL_COMPLETE.");
		} finally {
			unsubscribe();
			await session.disposeAsync();
			faux.unregister();
		}
		assert.equal(faux.state.callCount, 2);
		const recallEnds = events.filter(
			(event): event is Extract<AgentSessionEvent, { type: "tool_execution_end" }> =>
				event.type === "tool_execution_end" && event.toolName === "autoresearch_recall",
		);
		assert.equal(recallEnds.length, 1);
		assert.equal(recallEnds[0].isError, false);
		assert.ok(recallEnds[0].result && "details" in recallEnds[0].result);
		const recalled = recallEnds[0].result.details as Array<JobView & { candidateContent: string }>;
		assert.equal(recalled.length, 3);
		assert.equal(
			recalled.some((job) => job.proposal.jobId === foreign.jobId),
			false,
		);
		assert.deepEqual(
			recalled.map((job) => job.proposal.jobId).sort(),
			[earlyChampion.jobId, earlyFailure.jobId, laterInferior.jobId].sort(),
		);
		const recalledChampion = recalled.find((job) => job.proposal.jobId === earlyChampion.jobId);
		const recalledFailure = recalled.find((job) => job.proposal.jobId === earlyFailure.jobId);
		assert.ok(recalledChampion);
		assert.ok(recalledChampion.candidateContent.includes(earlyChampionSentinel));
		assert.deepEqual(
			recalledChampion.measurement?.tasks.map((task) => task.metrics.score),
			[50, 50],
		);
		assert.ok(recalledFailure);
		assert.ok(recalledFailure.candidateContent.includes(earlyFailureSentinel));
		assert.ok(
			recalledFailure.measurement?.tasks.every((task) => task.verifier.errors.includes(earlyFailureSentinel)),
		);

		const selectBest = (jobs: readonly JobView[]): JobView => {
			const eligible = jobs.filter(
				(job) =>
					job.state.status === "succeeded" &&
					job.measurement?.tasks.every(
						(task) => task.status === "accepted" && task.verifier.passed && task.metrics.score !== undefined,
					),
			);
			assert.ok(eligible.length > 0);
			return [...eligible].sort((left, right) => {
				const total = (job: JobView) =>
					job.measurement?.tasks.reduce(
						(sum, task) => sum + (task.metrics.score ?? Number.POSITIVE_INFINITY),
						0,
					) ?? Number.POSITIVE_INFINITY;
				return total(left) - total(right);
			})[0];
		};
		assert.equal(selectBest([laterJob]).proposal.jobId, laterInferior.jobId);
		assert.equal(selectBest(recalled).proposal.jobId, earlyChampion.jobId);
		const finalAssistant = events
			.filter(
				(event): event is Extract<AgentSessionEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "assistant",
			)
			.map((event) => event.message as AssistantMessage)
			.at(-1);
		assert.ok(finalAssistant?.content.some((block) => block.type === "text" && block.text === "RECALL_COMPLETE"));
		reopenedController.verifyLedger();
	});
});

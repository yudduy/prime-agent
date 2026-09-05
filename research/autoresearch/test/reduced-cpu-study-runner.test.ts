import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { sha256Text } from "../src/canonical-json.js";
import type { ResearchController } from "../src/controller.js";
import {
	type ArmGuardState,
	accountReducedCpuCompactionAttempt,
	appendReducedCpuArmTerminalManifest,
	auditReducedCpuCampaignJobIdentities,
	buildReducedCpuContinuationPrompt,
	consumeReducedCpuAssistantMessageEnd,
	createReducedCpuArmOutputTokenCounter,
	expectedReducedCpuProviderGraph,
	enforceReducedCpuCandidateContinuation,
	failReducedCpuProviderWatchdog,
	inspectReducedCpuCompactionPayload,
	type ProviderTracker,
	reducedCpuActiveTools,
	reducedCpuDispatchBudgetReason,
	reducedCpuEvaluationDeadlineDelay,
	reducedCpuEvaluationAllowed,
	reducedCpuProviderWatchdogDelay,
	runReducedCpuProviderGate,
	serializeReducedCpuProviderCandidateMeasurement,
	trackReducedCpuEvaluatorPromise,
	waitForReducedCpuEvaluatorSettlements,
} from "../src/reduced-cpu-study.js";
import { REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT } from "../src/reduced-cpu-study-preregistration.js";
import type {
	ReducedCpuCalibration,
	ReducedCpuCandidateEvidence,
	ReducedCpuStudyArm,
} from "../src/reduced-cpu-study-protocol.js";
import { REDUCED_CPU_STUDY_PROTOCOL_VERSION } from "../src/reduced-cpu-study-protocol.js";
import { REDUCED_CPU_SEARCH_TASKS } from "../src/reduced-cpu-study-protocol.js";
import type { JobView } from "../src/types.js";

function tracker(): ProviderTracker {
	return {
		accepted: 0,
		compactionCalls: 0,
		intentionalBlocked: 0,
		unexpectedBlocked: 0,
		outputTokens: 0,
		activeMs: 0,
		compactionUsage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		blockedReasons: [],
	};
}

function state(arm: ReducedCpuStudyArm): ArmGuardState {
	return {
		arm,
		outputDir: "/unused",
		branchId: `branch-${arm}`,
		preregistrationSha256: "a".repeat(64),
		calibrationSha256: "b".repeat(64),
		deadlineMs: Date.now() + 10_000,
		studyStartedAtMs: Date.now(),
		phase: "prefix",
		stopAfterToolFailure: false,
		recallCompleted: false,
		currentProviderOrdinal: 0,
		sealedRetest: null,
		toolDispatches: [],
		eventSequence: 0,
		fatalGateErrors: [],
		toolArgs: new Map(),
		providerRequests: [],
		providerRequestStartedAtMs: null,
		providerWatchdog: null,
		expectedBlockedAssistantEnds: 0,
		evaluatorSettlements: new Set(),
		evaluatorSettlementErrors: [],
		compactionPreparation: null,
	};
}

function payload(toolNames: string[] = ["autoresearch_evaluate"]): Record<string, unknown> {
	return {
		model: "gpt-5.6-luna",
		service_tier: "priority",
		reasoning: { effort: "xhigh" },
		tools: toolNames.map((name) => ({ name })),
	};
}

const calibration = {} as ReducedCpuCalibration;
const evidence = {} as ReducedCpuCandidateEvidence;

function compactionMessage(stopReason: "error" | "aborted", output: number): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		usage: {
			input: 10,
			output,
			cacheRead: 3,
			cacheWrite: 2,
			totalTokens: 15 + output,
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
		},
		stopReason,
		timestamp: 1,
	};
}

function apparatusInvalidCandidate(ordinal: 1 | 2 | 3 | 4): ReducedCpuCandidateEvidence {
	return {
		ordinal,
		arm: "stock",
		branchId: "branch-stock",
		jobId: `job-${ordinal}`,
		manifestDigest: `${ordinal}`.repeat(64),
		candidateDigest: `${ordinal + 4}`.repeat(64),
		actions: ["-mem2reg"],
		parentJobIds: ordinal === 1 ? [] : [`job-${ordinal - 1}`],
		verifierValid: false,
		tasks: [],
		invalidReasons: ["measurement hardware differs from calibration"],
	};
}

describe("reduced CPU runner guards", () => {
	it("binds the exact paid provider graph and tool registry", () => {
		assert.deepEqual(expectedReducedCpuProviderGraph({ arm: "stock", retestActive: false }), {
			paidCalls: 5,
			intentionalBlocked: 2,
			modelEvaluationCalls: 4,
			recallCalls: 0,
			compactionCalls: 1,
		});
		assert.equal(expectedReducedCpuProviderGraph({ arm: "M", retestActive: false }).paidCalls, 6);
		assert.equal(expectedReducedCpuProviderGraph({ arm: "M+R", retestActive: true }).paidCalls, 5);
		assert.equal(expectedReducedCpuProviderGraph({ arm: "M+R", retestActive: false }).paidCalls, 6);
		assert.deepEqual(reducedCpuActiveTools("stock"), ["autoresearch_evaluate"]);
		assert.deepEqual(reducedCpuActiveTools("M"), ["autoresearch_evaluate", "autoresearch_recall"]);
	});

	it("requires recall before M candidate 3 but not before Stock candidate 3", () => {
		assert.equal(reducedCpuEvaluationAllowed({ arm: "M", phase: "post-compaction", recallCompleted: false }), false);
		assert.equal(reducedCpuEvaluationAllowed({ arm: "M+R", phase: "post-compaction", recallCompleted: true }), true);
		assert.equal(
			reducedCpuEvaluationAllowed({ arm: "stock", phase: "post-compaction", recallCompleted: false }),
			true,
		);
	});

	it("keeps M and M+R provider-visible continuation contracts identical through candidate 3", () => {
		assert.equal(buildReducedCpuContinuationPrompt("M"), buildReducedCpuContinuationPrompt("M+R"));
		assert.equal(buildReducedCpuContinuationPrompt("M"), REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT);
		assert.doesNotMatch(buildReducedCpuContinuationPrompt("M+R"), /retest|host may close|M\+R/i);
		assert.deepEqual(reducedCpuActiveTools("M"), reducedCpuActiveTools("M+R"));
	});

	it("projects identical measured evidence without arm or branch metadata", () => {
		const base = {
			ordinal: 1,
			arm: "stock",
			branchId: "branch-stock-secret",
			jobId: "job-stock-secret",
			manifestDigest: "1".repeat(64),
			candidateDigest: "2".repeat(64),
			actions: ["-mem2reg"],
			parentJobIds: [],
			verifierValid: true,
			tasks: [],
			invalidReasons: [],
		} as ReducedCpuCandidateEvidence;
		const variants = [
			base,
			{ ...base, arm: "M", branchId: "branch-m-secret", jobId: "job-m-secret", manifestDigest: "3".repeat(64) },
			{
				...base,
				arm: "M+R",
				branchId: "branch-mr-secret",
				jobId: "job-mr-secret",
				manifestDigest: "4".repeat(64),
			},
		] as ReducedCpuCandidateEvidence[];
		const serialized = variants.map(serializeReducedCpuProviderCandidateMeasurement);
		assert.equal(new Set(serialized).size, 1);
		for (const forbidden of ["stock", "branch-", "job-", "manifestDigest", "output", "treatment"]) {
			assert.doesNotMatch(serialized[0], new RegExp(forbidden, "i"));
		}
	});

	it("stops an apparatus-invalid model candidate but admits a measured verifier rejection", () => {
		const armState = state("stock");
		assert.throws(
			() => enforceReducedCpuCandidateContinuation(armState, apparatusInvalidCandidate(1), "model-tool"),
			/apparatus-invalid evidence/,
		);
		assert.equal(armState.phase, "terminal");
		assert.equal(armState.stopAfterToolFailure, true);

		const semanticRejection = {
			...apparatusInvalidCandidate(1),
			tasks: REDUCED_CPU_SEARCH_TASKS.map((benchmarkId, index) => ({
				benchmarkId,
				irInstructionCount: index === 0 ? null : 10,
				objectTextSizeBytes: index === 0 ? null : 20,
				status: index === 0 ? "rejected" : "accepted",
				verifierPassed: index !== 0,
			})),
			invalidReasons: [`${REDUCED_CPU_SEARCH_TASKS[0]} is not verifier-valid measured evidence`],
		};
		const semanticState = state("stock");
		assert.doesNotThrow(() => enforceReducedCpuCandidateContinuation(semanticState, semanticRejection, "model-tool"));
		assert.equal(semanticState.phase, "prefix");
	});

	it("stops an apparatus-invalid host candidate 4 before a validation claim", () => {
		const armState = state("M+R");
		armState.phase = "post-compaction";
		let laterValidationClaims = 0;
		assert.throws(() => {
			enforceReducedCpuCandidateContinuation(armState, apparatusInvalidCandidate(4), "host-candidate-4");
			laterValidationClaims++;
		}, /host-candidate-4 candidate 4 has apparatus-invalid evidence/);
		assert.equal(laterValidationClaims, 0);
		assert.equal(armState.phase, "terminal");
	});

	it("audits compaction payload fields structurally", () => {
		assert.deepEqual(
			inspectReducedCpuCompactionPayload({ service_tier: "standard", input: '{"service_tier":"priority"}' }),
			{ priority: false, toolsAbsent: true },
		);
		assert.deepEqual(inspectReducedCpuCompactionPayload({ service_tier: "priority", tools: [] }), {
			priority: true,
			toolsAbsent: false,
		});
	});

	it("fails closed when a provider gate dependency throws", async () => {
		const armState = state("stock");
		const providerTracker = tracker();
		let aborts = 0;
		await runReducedCpuProviderGate({
			payload: payload(),
			state: armState,
			tracker: providerTracker,
			calibration,
			studyStartedAtMs: Date.now(),
			armStartedAtMs: Date.now(),
			armActiveMs: 0,
			armOutputTokens: 0,
			abort: () => aborts++,
			loadEvidence: () => Promise.reject(new Error("injected gate failure")),
		});
		assert.equal(aborts, 1);
		assert.equal(providerTracker.accepted, 0);
		assert.equal(providerTracker.unexpectedBlocked, 1);
		assert.match(armState.fatalGateErrors[0], /injected gate failure/);
	});

	it("excludes intentionally blocked assistant ends and fails closed on an unpaired completion", () => {
		const armState = state("stock");
		const providerTracker = tracker();
		armState.expectedBlockedAssistantEnds = 1;
		assert.deepEqual(
			consumeReducedCpuAssistantMessageEnd({
				state: armState,
				tracker: providerTracker,
				nowMs: 100,
				stopReason: "aborted",
			}),
			{ disposition: "expected-blocked", activeMs: 0 },
		);
		assert.equal(armState.fatalGateErrors.length, 0);
		assert.equal(providerTracker.unexpectedBlocked, 0);

		assert.deepEqual(
			consumeReducedCpuAssistantMessageEnd({
				state: armState,
				tracker: providerTracker,
				nowMs: 101,
				stopReason: "stop",
			}),
			{ disposition: "unexpected-unpaired", activeMs: 0 },
		);
		assert.equal(armState.phase, "terminal");
		assert.equal(providerTracker.unexpectedBlocked, 1);
		assert.match(armState.fatalGateErrors[0], /without a matching accepted or blocked provider request/);

		armState.providerRequestStartedAtMs = 200;
		assert.deepEqual(
			consumeReducedCpuAssistantMessageEnd({
				state: armState,
				tracker: providerTracker,
				nowMs: 250,
				stopReason: "stop",
			}),
			{ disposition: "accepted", activeMs: 50 },
		);
	});

	it("accepts cold jobs with null external IDs only when all durable identity claims match", () => {
		const arms = ["stock", "M", "M+R"] as const;
		const operations = ["candidate-1", "candidate-2", "candidate-3", "candidate-4", "champion-validation"] as const;
		const jobs = Array.from(
			{ length: 15 },
			(_, index) =>
				({
					proposal: {
						jobId: `job-${index}`,
						manifestDigest: `manifest-${index}`,
						branchId: `branch-${arms[Math.floor(index / operations.length)]}`,
					},
					state: { externalJobId: null },
				}) as JobView,
		);
		const dispatchClaimPairs = jobs.map((job, index) => {
			const arm = arms[Math.floor(index / operations.length)];
			const operation = operations[index % operations.length];
			const branchId = `branch-${arm}`;
			const intentText = `${JSON.stringify(
				{
					type: "reduced_cpu_dispatch_intent",
					protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
					arm,
					branchId,
					operation,
				},
				null,
				2,
			)}\n`;
			const resultText = `${JSON.stringify(
				{
					type: "reduced_cpu_dispatch_result",
					protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
					arm,
					branchId,
					operation,
					intentSha256: sha256Text(intentText),
					jobId: job.proposal.jobId,
					manifestDigest: job.proposal.manifestDigest,
				},
				null,
				2,
			)}\n`;
			return { arm, branchId, operation, intentText, resultText };
		});
		assert.equal(auditReducedCpuCampaignJobIdentities({ jobs, dispatchClaimPairs }).passed, true);
		assert.equal(
			auditReducedCpuCampaignJobIdentities({ jobs, dispatchClaimPairs: dispatchClaimPairs.slice(1) }).passed,
			false,
		);
		assert.equal(
			auditReducedCpuCampaignJobIdentities({
				jobs: jobs.map((job, index) =>
					index === 1
						? ({
								...job,
								proposal: { ...job.proposal, manifestDigest: jobs[0].proposal.manifestDigest },
							} as JobView)
						: job,
				),
				dispatchClaimPairs,
			}).passed,
			false,
		);
		const jobsWithDuplicateExternalId = jobs.map(
			(job, index) =>
				({ ...job, state: { ...job.state, externalJobId: index < 2 ? "same-attempt" : null } }) as JobView,
		);
		assert.equal(
			auditReducedCpuCampaignJobIdentities({ jobs: jobsWithDuplicateExternalId, dispatchClaimPairs }).passed,
			false,
		);
		const corruptPair = { ...dispatchClaimPairs[0], intentText: `${dispatchClaimPairs[0].intentText} ` };
		assert.equal(
			auditReducedCpuCampaignJobIdentities({
				jobs,
				dispatchClaimPairs: [corruptPair, ...dispatchClaimPairs.slice(1)],
			}).passed,
			false,
		);
	});

	it("counts compaction output in the per-arm continuation budget gate", async () => {
		const armState = state("stock");
		armState.phase = "post-compaction";
		const providerTracker = tracker();
		const counter = createReducedCpuArmOutputTokenCounter();
		counter.record(31_999);
		counter.record(2);
		let aborts = 0;
		await runReducedCpuProviderGate({
			payload: payload(),
			state: armState,
			tracker: providerTracker,
			calibration,
			studyStartedAtMs: Date.now(),
			armStartedAtMs: Date.now(),
			armActiveMs: 0,
			armOutputTokens: counter.current(),
			abort: () => aborts++,
			loadEvidence: () => Promise.resolve([evidence, evidence]),
		});
		assert.equal(counter.current(), 32_001);
		assert.equal(aborts, 1);
		assert.equal(providerTracker.accepted, 0);
		assert.equal(providerTracker.unexpectedBlocked, 1);
		assert.match(armState.fatalGateErrors[0], /output-tokens/);
	});

	it("blocks a paid compaction or continuation at the active-time boundary", () => {
		const providerTracker = tracker();
		providerTracker.activeMs = 600_000;
		assert.equal(
			reducedCpuDispatchBudgetReason({
				tracker: providerTracker,
				armOutputTokens: 0,
				armActiveMs: 600_000,
				armStartedAtMs: 1,
				studyStartedAtMs: 1,
				nowMs: 2,
			}),
			"active-seconds",
		);
	});

	it("caps only accepted provider activity and fails a timed-out request closed", () => {
		assert.equal(reducedCpuProviderWatchdogDelay(300_000, 0), 120_000);
		assert.equal(reducedCpuProviderWatchdogDelay(50_000, 0), 50_000);
		assert.equal(reducedCpuProviderWatchdogDelay(50_000, 60_000), 0);
		const armState = state("stock");
		const providerTracker = tracker();
		armState.providerRequestStartedAtMs = 1;
		assert.equal(failReducedCpuProviderWatchdog(armState, providerTracker), true);
		assert.equal(armState.phase, "terminal");
		assert.equal(armState.stopAfterToolFailure, true);
		assert.equal(providerTracker.unexpectedBlocked, 1);
		assert.match(armState.fatalGateErrors[0], /provider-active watchdog/);
	});

	it("uses the remaining arm calendar time for evaluator cancellation", () => {
		assert.equal(reducedCpuEvaluationDeadlineDelay(900_000, 100_000), 800_000);
		assert.equal(reducedCpuEvaluationDeadlineDelay(100_000, 100_001), 0);
	});

	it("does not permit terminalization before a detached evaluator settles", async () => {
		const armState = state("stock");
		const deferred: { release?: () => void } = {};
		const underlying = new Promise<void>((resolve) => {
			deferred.release = resolve;
		});
		const tracked = trackReducedCpuEvaluatorPromise(armState, underlying);
		let terminalized = false;
		const terminalization = waitForReducedCpuEvaluatorSettlements(armState).then(() => {
			terminalized = true;
		});
		await Promise.resolve();
		assert.equal(terminalized, false);
		assert.ok(deferred.release);
		deferred.release();
		await tracked;
		await terminalization;
		assert.equal(terminalized, true);
	});

	for (const stopReason of ["error", "aborted"] as const) {
		it(`accounts ${stopReason} compaction callback usage and active time exactly once`, () => {
			const providerTracker = tracker();
			let armActiveMs = 0;
			let armOutputTokens = 0;
			accountReducedCpuCompactionAttempt({
				tracker: providerTracker,
				messages: [compactionMessage(stopReason, 7)],
				activeMs: 25,
				recordArmActiveMs: (delta) => {
					armActiveMs += delta;
				},
				recordArmOutputTokens: (tokens) => {
					armOutputTokens += tokens;
				},
			});
			assert.equal(providerTracker.activeMs, 25);
			assert.equal(armActiveMs, 25);
			assert.equal(providerTracker.outputTokens, 7);
			assert.equal(armOutputTokens, 7);
			assert.equal(providerTracker.compactionUsage.output, 7);
			assert.equal(providerTracker.compactionUsage.totalTokens, 22);
		});
	}

	it("blocks after candidate 2 and never accepts a later terminal request", async () => {
		const armState = state("stock");
		const providerTracker = tracker();
		let aborts = 0;
		const invoke = (items: ReducedCpuCandidateEvidence[]) =>
			runReducedCpuProviderGate({
				payload: payload(),
				state: armState,
				tracker: providerTracker,
				calibration,
				studyStartedAtMs: Date.now(),
				armStartedAtMs: Date.now(),
				armActiveMs: 0,
				armOutputTokens: 0,
				abort: () => aborts++,
				loadEvidence: () => Promise.resolve(items),
			});
		await invoke([evidence, evidence]);
		assert.equal(armState.phase, "terminal");
		assert.equal(providerTracker.intentionalBlocked, 1);
		assert.equal(providerTracker.accepted, 0);
		await invoke([]);
		assert.equal(aborts, 2);
		assert.equal(providerTracker.accepted, 0);
		assert.equal(providerTracker.intentionalBlocked, 1);
	});

	it("reopens and verifies a fresh controller for the arm terminal manifest", async () => {
		const armState = state("stock");
		const calls: string[] = [];
		const fresh = {
			appendRunManifest: async () => {
				calls.push("append:fresh");
			},
		} as unknown as ResearchController;
		await appendReducedCpuArmTerminalManifest({
			state: armState,
			manifest: { type: "terminal" },
			openController: async () => {
				calls.push("open:fresh");
				return fresh;
			},
			verifyLedger: async (controller) => {
				assert.equal(controller, fresh);
				calls.push("verify:fresh");
			},
		});
		assert.deepEqual(calls, ["open:fresh", "append:fresh", "verify:fresh"]);
	});
});

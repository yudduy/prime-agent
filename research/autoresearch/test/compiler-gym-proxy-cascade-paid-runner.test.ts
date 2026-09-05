import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { ArtifactStore } from "../src/artifact-store.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import {
	COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
	COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
	type CompilerGymCanonicalOneTaskPreparationEvidence,
	type CompilerGymCanonicalOneTaskSemanticResultAggregate,
} from "../src/compiler-gym-ir-delta-screen-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
	type CompilerGymPaidLiveEnvironmentGateEvidence,
} from "../src/compiler-gym-paid-live-environment-gate.js";
import {
	type CompilerGymProxyCascadePaidPreregistration,
	canonicalCompilerGymProxyCascadePaidPreregistration,
	writeCompilerGymProxyCascadePaidPreregistration,
} from "../src/compiler-gym-proxy-cascade-paid-preregistration.js";
import {
	COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY,
	COMPILER_GYM_PROXY_CASCADE_PAID_TOOL,
	type CompilerGymProxyCascadePaidArm,
	type CompilerGymProxyCascadePaidCallOrdinal,
} from "../src/compiler-gym-proxy-cascade-paid-protocol.js";
import type {
	CompilerGymProxyCascadePaidProviderArmEvidence,
	CompilerGymProxyCascadePaidProviderGuard,
	CompilerGymProxyCascadePaidProviderPairEvidence,
} from "../src/compiler-gym-proxy-cascade-paid-provider.js";
import {
	type CompilerGymProxyCascadePaidAgentRuntime,
	type CompilerGymProxyCascadePaidOneTaskEvaluator,
	type CompilerGymProxyCascadePaidReconstructedClosure,
	type CompilerGymProxyCascadePaidRunnerDependencies,
	runCompilerGymProxyCascadePaidPair,
} from "../src/compiler-gym-proxy-cascade-paid-runner.js";
import {
	COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
	COMPILER_GYM_PROXY_CASCADE_BZIP2,
} from "../src/compiler-gym-proxy-cascade-protocol.js";
import type { CompilerGymWarmRemoteFileSystem } from "../src/compiler-gym-warm-farmshare-backend.js";
import { EvaluationAdapterOutputError } from "../src/evaluation-adapter-output-error.js";
import { verifyLedgerContentsStrict } from "../src/ledger.js";
import type { EvaluationContext, EvaluationJob, EvaluationOutcome } from "../src/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FIXED_NOW = new Date("2026-08-30T12:00:00.000Z");
const tempRoots: string[] = [];

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

interface RemoteFile {
	content: string;
	sha256: string;
	mode: number;
}

class FauxRemoteFileSystem implements CompilerGymWarmRemoteFileSystem {
	readonly files = new Map<string, RemoteFile>();
	failInstallPath: string | null = null;

	seed(path: string, content: string, mode = 0o600): void {
		this.files.set(path, { content, sha256: sha256Text(content), mode });
	}

	async ensurePrivateDirectory(): Promise<void> {}

	async createPrivateDirectory(): Promise<void> {
		throw new Error("unexpected remote createPrivateDirectory");
	}

	async installImmutableFile(
		path: string,
		content: string,
		expectedSha256: string,
		mode: number,
		allowExistingExact: boolean,
	): Promise<void> {
		if (path === this.failInstallPath) throw new Error(`faux remote install failure: ${path}`);
		const existing = this.files.get(path);
		if (existing) {
			if (
				allowExistingExact &&
				existing.content === content &&
				existing.sha256 === expectedSha256 &&
				existing.mode === mode
			) {
				return;
			}
			const error = new Error(`remote create-only path exists: ${path}`) as Error & { code: string };
			error.code = "EEXIST";
			throw error;
		}
		assert.equal(sha256Text(content), expectedSha256);
		this.files.set(path, { content, sha256: expectedSha256, mode });
	}

	async linkImmutableFile(): Promise<void> {
		throw new Error("unexpected remote linkImmutableFile");
	}

	async readTrustedFile(
		path: string,
		options: { maxBytes: number; mode: number; expectedSha256?: string },
	): Promise<string> {
		const file = this.files.get(path);
		if (!file) throw new Error(`unknown remote file: ${path}`);
		assert.equal(file.mode, options.mode);
		assert.ok(Buffer.byteLength(file.content) <= options.maxBytes);
		if (options.expectedSha256) assert.equal(file.sha256, options.expectedSha256);
		return file.content;
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}
}

class FauxMonotonicClock {
	private value = 1_000_000;

	now = (): number => this.value;

	advance(microseconds: number): void {
		this.value += microseconds;
	}
}

function accountingRow(input: {
	jobIdRaw: string;
	jobName: string;
	state: "COMPLETED" | "FAILED";
	exitCode: "0:0" | "5:0";
	allocCpus: number;
	nTasks: number | null;
	elapsedRawSeconds: number;
	startAt?: string;
	endAt?: string;
}) {
	return {
		jobIdRaw: input.jobIdRaw,
		jobName: input.jobName,
		state: input.state,
		exitCode: input.exitCode,
		allocCpus: input.allocCpus,
		nTasks: input.nTasks,
		elapsedRawSeconds: input.elapsedRawSeconds,
		cpuTimeRawSeconds: input.allocCpus * input.elapsedRawSeconds,
		nodeList: "barley-01",
		startAt: input.startAt ?? "2026-08-30T12:00:00",
		endAt: input.endAt ?? "2026-08-30T12:00:03",
	};
}

function metricFor(benchmarkId: string, ordinal: CompilerGymProxyCascadePaidCallOrdinal) {
	if (ordinal === 1) {
		return COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[
			benchmarkId as keyof typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS
		];
	}
	return benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH
		? { irInstructionCount: 1_970 - ordinal * 20, objectTextSizeBytes: 21_000 - ordinal }
		: { irInstructionCount: 13_838 - ordinal * 100, objectTextSizeBytes: 166_000 - ordinal };
}

class FauxOneTaskEvaluator implements CompilerGymProxyCascadePaidOneTaskEvaluator {
	readonly calls: Array<{
		arm: CompilerGymProxyCascadePaidArm;
		candidateOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
		benchmarkId: string;
		rejected: boolean;
	}> = [];
	prepareCalls = 0;
	active = 0;
	maximumActive = 0;
	failureTriggered = false;
	completedAfterFailure = 0;

	constructor(
		private readonly preregistration: CompilerGymProxyCascadePaidPreregistration,
		private readonly clock: FauxMonotonicClock,
		private readonly options: {
			rejectTreatmentOrdinal: CompilerGymProxyCascadePaidCallOrdinal | null;
			failEvaluations: readonly {
				arm: CompilerGymProxyCascadePaidArm;
				candidateOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
				benchmarkId: string;
			}[];
		},
	) {}

	async prepareCanonicalOneTask(): Promise<CompilerGymCanonicalOneTaskPreparationEvidence> {
		this.prepareCalls++;
		const sourceDirectory = posix.join(
			this.preregistration.frozenCommon.environment.remoteSourceRoot,
			this.preregistration.frozenCommon.evaluatorSourceBundleSha256,
		);
		return {
			sourceBundleSha256: this.preregistration.frozenCommon.evaluatorSourceBundleSha256,
			sourceDirectory,
			canonicalRemoteEvaluatorPath: posix.join(sourceDirectory, "compiler_gym_eval.py"),
			irDeltaRemoteEvaluatorPath: posix.join(sourceDirectory, "compiler_gym_ir_delta_eval.py"),
		};
	}

	async evaluateCanonicalOneTaskSemanticResult(
		job: EvaluationJob,
		context: EvaluationContext,
	): Promise<EvaluationOutcome> {
		context.signal.throwIfAborted();
		const match = /^proxy-cascade-paid:(full-control|proxy-cascade):candidate-([1-4])$/.exec(job.treatment);
		assert.ok(match);
		const arm = match[1] as CompilerGymProxyCascadePaidArm;
		const candidateOrdinal = Number(match[2]) as CompilerGymProxyCascadePaidCallOrdinal;
		const benchmarkId = job.benchmarkIds[0];
		assert.ok(
			benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH || benchmarkId === COMPILER_GYM_PROXY_CASCADE_BZIP2,
		);
		const rejected =
			arm === "proxy-cascade" &&
			benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH &&
			candidateOrdinal === this.options.rejectTreatmentOrdinal;
		this.calls.push({ arm, candidateOrdinal, benchmarkId, rejected });
		const allocationOrdinal = this.calls.length;
		this.active++;
		this.maximumActive = Math.max(this.maximumActive, this.active);
		try {
			const slurmId = String(1_900_000 + allocationOrdinal);
			await context.recordExternalJobId(slurmId);
			const shouldFail = this.options.failEvaluations.some(
				(failure) =>
					failure.arm === arm &&
					failure.candidateOrdinal === candidateOrdinal &&
					failure.benchmarkId === benchmarkId,
			);
			if (shouldFail) {
				this.failureTriggered = true;
				const stdout = canonicalLine({ arm, candidateOrdinal, benchmarkId, slurmId, partial: true });
				const stderr = `faux evaluator accounting failure for ${slurmId}\n`;
				throw new EvaluationAdapterOutputError({
					code: "faux-evaluator-accounting-failure",
					message: `Faux evaluator accounting failure for candidate ${candidateOrdinal}`,
					hostEvidence: toJsonValue({ arm, candidateOrdinal, benchmarkId, slurmId }),
					stdout,
					stderr,
				});
			}
			await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, this.failureTriggered ? 80 : 20));
			if (this.failureTriggered) this.completedAfterFailure++;
			context.signal.throwIfAborted();
			this.clock.advance(arm === "full-control" ? 5_000_000 : 2_000_000);
			const actions = JSON.parse(job.candidateContent) as string[];
			const metric = metricFor(benchmarkId, candidateOrdinal);
			const jobName = `pcp-test-${allocationOrdinal}`;
			const state = rejected ? "FAILED" : "COMPLETED";
			const exitCode = rejected ? "5:0" : "0:0";
			const numericExitCode = rejected ? 5 : 0;
			const root = accountingRow({
				jobIdRaw: slurmId,
				jobName,
				state,
				exitCode,
				allocCpus: 2,
				nTasks: null,
				elapsedRawSeconds: 3,
			});
			const accountingRows = {
				contract: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_PROTOCOL,
				interpretation: COMPILER_GYM_IR_DELTA_SCREEN_ACCOUNTING_ROWS_INTERPRETATION,
				root,
				extern: accountingRow({
					jobIdRaw: `${slurmId}.extern`,
					jobName: "extern",
					state: "COMPLETED",
					exitCode: "0:0",
					allocCpus: 2,
					nTasks: 1,
					elapsedRawSeconds: 3,
				}),
				step: accountingRow({
					jobIdRaw: `${slurmId}.0`,
					jobName,
					state,
					exitCode,
					allocCpus: 2,
					nTasks: 1,
					elapsedRawSeconds: 2,
					endAt: "2026-08-30T12:00:02",
				}),
			};
			const rawStdout = canonicalLine({ validation: { inputs_completed: 20 } });
			const sourceDirectory = posix.join(
				this.preregistration.frozenCommon.environment.remoteSourceRoot,
				this.preregistration.frozenCommon.evaluatorSourceBundleSha256,
			);
			const aggregate: CompilerGymCanonicalOneTaskSemanticResultAggregate = {
				contract: COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_ADAPTER_OUTPUT_PROTOCOL,
				jobId: job.jobId,
				manifestDigest: job.manifestDigest,
				candidateSha256: job.candidate.digest,
				actionsSha256: sha256Json(actions),
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
				measurementReuse: false,
				sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
				sourceDirectory,
				remoteEvaluatorPath: posix.join(sourceDirectory, "compiler_gym_eval.py"),
				tasks: [
					{
						benchmarkId,
						requestSha256: sha256Text(canonicalLine({ benchmark: benchmarkId, actions })),
						evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
						exitCode: numericExitCode,
						wallMs: 3_000,
						stdout: rawStdout,
						stdoutSha256: sha256Text(rawStdout),
						stderr: "",
						stderrSha256: sha256Text(""),
						slurmId,
						transientCache: `/tmp/pcp-test-${allocationOrdinal}`,
						jobName,
						accounting: root,
						accountingRows,
					},
				],
			};
			return {
				verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
				tasks: [
					{
						benchmarkId,
						status: rejected ? "rejected" : "accepted",
						metrics: {
							IrInstructionCount: metric.irInstructionCount,
							ObjectTextSizeBytes: metric.objectTextSizeBytes,
							evaluatorRuntimeMs: 1_000,
							schedulerAndEvaluatorWallMs: 3_000,
						},
						verifier: {
							passed: !rejected,
							checks: ["canonical-faux-paid-runner"],
							errors: rejected ? ["complete semantic rejection"] : [],
						},
						runtimeMs: 3_000,
					},
				],
				hardware: { cluster: "faux", node: "barley-01" },
				provenance: { ...COMPILER_GYM_CANONICAL_ONE_TASK_SEMANTIC_RESULT_EXPECTED_PROVENANCE },
				stdout: canonicalLine(aggregate),
				stderr: "",
			};
		} finally {
			this.active--;
		}
	}
}

function emptyArmEvidence(
	arm: CompilerGymProxyCascadePaidArm,
	preregistration: CompilerGymProxyCascadePaidPreregistration,
): CompilerGymProxyCascadePaidProviderArmEvidence {
	return {
		arm,
		specSha256: preregistration.providerSpecSha256,
		systemPromptEvents: 1,
		workingDirectoryReplacements: 1,
		conversationLogReplacements: 1,
		normalizedSystemPromptSha256: preregistration.frozenCommon.promptSha256,
		normalizedSystemPromptMatchedPairAnchor: true,
		actualWorkspace: preregistration.providerSpec.providerVisibleWorkspace,
		actualConversationLog: preregistration.providerSpec.providerVisibleConversationLog,
		providerRequestAttempts: 0,
		providerRequestBodySha256s: [],
		firstProviderRequestBodyMatchedPairAnchor: true,
		resolvedModelSnapshotSha256s: [],
		resolvedModelMatchedPairAnchor: [],
		historyByDispatch: [],
		runtimeWorktreeDispatchAnchors: [],
		liveEnvironmentDispatchAnchors: [],
		providerRequestTranscriptAnchors: [],
		providerRequestAnchorPath: preregistration.launchPaths.providerRequestAnchorPath,
		providerRequestAnchorSha256: "a".repeat(64),
		failures: [],
	};
}

function fauxProviderGuard(
	preregistration: CompilerGymProxyCascadePaidPreregistration,
	preregistrationSha256: string,
): CompilerGymProxyCascadePaidProviderGuard {
	const pairEvidence: CompilerGymProxyCascadePaidProviderPairEvidence = {
		specSha256: preregistration.providerSpecSha256,
		preregistrationSha256,
		normalizedSystemPromptSha256: preregistration.frozenCommon.promptSha256,
		firstProviderRequestBodySha256: "b".repeat(64),
		resolvedModelSnapshotSha256: "c".repeat(64),
		liveEnvironmentNormalizedEvidenceSha256: "d".repeat(64),
		anchorArm: preregistration.randomization.armOrder[0],
		completedArms: [],
		providerRequestAnchorPath: preregistration.launchPaths.providerRequestAnchorPath,
		providerRequestAnchorSha256: "a".repeat(64),
		previousTranscriptAnchorPath: null,
		previousTranscriptAnchorSha256: null,
		actualWorkspaces: [],
		actualConversationLogs: [],
		failures: [],
	};
	const arms = new Map<CompilerGymProxyCascadePaidArm, CompilerGymProxyCascadePaidProviderArmEvidence>();
	return {
		spec: preregistration.providerSpec,
		specSha256: preregistration.providerSpecSha256,
		pairEvidence,
		runtimeForArm(arm) {
			const evidence = arms.get(arm) ?? emptyArmEvidence(arm, preregistration);
			arms.set(arm, evidence);
			return {
				evidence,
				extensionFactory: () => {},
				providerRequestGate: async (request) => {
					evidence.providerRequestAttempts++;
					evidence.historyByDispatch.push({
						providerDispatchOrdinal: request.providerDispatchOrdinal,
						expectedPriorResultCount: request.providerDispatchOrdinal - 1,
						observedPriorResultCount: request.providerDispatchOrdinal - 1,
						results: [],
					});
					if (request.providerDispatchOrdinal === 4 && !pairEvidence.completedArms.includes(arm)) {
						pairEvidence.completedArms.push(arm);
					}
					return { allowed: true, reason: null };
				},
			};
		},
	};
}

function requestsFor(preregistration: CompilerGymProxyCascadePaidPreregistration) {
	const actions = preregistration.frozenCommon.authoritativeActions;
	return [
		structuredClone(preregistration.frozenCommon.firstRequest),
		{
			actions: [actions[0]!],
			hypothesis: "Candidate two should improve the frozen anchor.",
			mechanism: "Apply one distinct authoritative LLVM pass.",
			predictedOutcome: "Lower IR on at least one task.",
			boundaryConditions: ["Preserve all twenty callbacks."],
		},
		{
			actions: [actions[1]!],
			hypothesis: "Candidate three should improve candidate two.",
			mechanism: "Apply a second distinct authoritative LLVM pass.",
			predictedOutcome: "Lower the two-task vector.",
			boundaryConditions: ["Preserve all twenty callbacks."],
		},
		{
			actions: [actions[0]!, actions[1]!],
			hypothesis: "Candidate four should retain the best measured effects.",
			mechanism: "Compose the two measured authoritative passes.",
			predictedOutcome: "Produce the best complete vector.",
			boundaryConditions: ["Preserve all twenty callbacks."],
		},
	];
}

interface PreparedRun {
	root: string;
	input: { repoRoot: string; preregistrationPath: string; outputDir: string };
	preregistration: CompilerGymProxyCascadePaidPreregistration;
	closure: CompilerGymProxyCascadePaidReconstructedClosure;
	remote: FauxRemoteFileSystem;
	evaluator: FauxOneTaskEvaluator;
	providerTransportCalls: Map<CompilerGymProxyCascadePaidArm, number>;
	environmentGateCalls: number;
	dependencies: CompilerGymProxyCascadePaidRunnerDependencies;
}

async function prepareRun(input: {
	drawHex: string;
	rejectTreatmentOrdinal?: CompilerGymProxyCascadePaidCallOrdinal;
	invalidTreatmentCallOrdinal?: CompilerGymProxyCascadePaidCallOrdinal;
	failEvaluation?: {
		arm: CompilerGymProxyCascadePaidArm;
		candidateOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
		benchmarkId: string;
	};
	failEvaluations?: readonly {
		arm: CompilerGymProxyCascadePaidArm;
		candidateOrdinal: CompilerGymProxyCascadePaidCallOrdinal;
		benchmarkId: string;
	}[];
	failRemoteTerminalLock?: boolean;
}): Promise<PreparedRun> {
	const root = await mkdtemp(join(REPO_ROOT, ".autoresearch/proxy-cascade-paid-runner-test-"));
	tempRoots.push(root);
	const preregistrationPath = join(root, "preregistration.json");
	const outputDir = join(root, "execution");
	const written = await writeCompilerGymProxyCascadePaidPreregistration({
		repoRoot: REPO_ROOT,
		path: preregistrationPath,
		outputDir,
		createdAt: FIXED_NOW.toISOString(),
		drawHex: input.drawHex,
	});
	const preregistration = structuredClone(written.record);
	preregistration.localAttemptLock.path = join(root, "attempt-lock", "attempt.lock");
	const preregistrationContents = canonicalCompilerGymProxyCascadePaidPreregistration(preregistration);
	const closure: CompilerGymProxyCascadePaidReconstructedClosure = {
		preregistration,
		preregistrationContents,
		preregistrationSha256: sha256Text(preregistrationContents),
	};
	const remote = new FauxRemoteFileSystem();
	if (input.failRemoteTerminalLock) remote.failInstallPath = preregistration.remoteLocks.terminalPath;
	const sourceRoot = posix.join(
		preregistration.frozenCommon.environment.remoteSourceRoot,
		preregistration.frozenCommon.evaluatorSourceBundleSha256,
	);
	remote.seed(
		posix.join(sourceRoot, "compiler_gym_eval.py"),
		await readFile(resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py"), "utf8"),
	);
	remote.seed(
		posix.join(sourceRoot, "compiler_gym_ir_delta_eval.py"),
		await readFile(resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py"), "utf8"),
	);
	const clock = new FauxMonotonicClock();
	const evaluator = new FauxOneTaskEvaluator(preregistration, clock, {
		rejectTreatmentOrdinal: input.rejectTreatmentOrdinal ?? null,
		failEvaluations: input.failEvaluations ?? (input.failEvaluation ? [input.failEvaluation] : []),
	});
	const providerTransportCalls = new Map<CompilerGymProxyCascadePaidArm, number>();
	let environmentGateCalls = 0;
	let timestampOrdinal = 0;
	const dependencies: CompilerGymProxyCascadePaidRunnerDependencies = {
		testOnlyInjectedRuntime: true,
		reconstructPreregistration: async () => structuredClone(closure),
		remoteFileSystem: remote,
		evaluator,
		environmentGate: async (signal) => {
			signal.throwIfAborted();
			environmentGateCalls++;
			return {
				protocol: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
				probeSourceSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
				expectedResultSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
				commandSha256: sha256Text("faux-live-environment-command"),
				stdoutSha256: sha256Text("faux-live-environment-stdout"),
				wallMs: 1,
				pass: true,
			} satisfies CompilerGymPaidLiveEnvironmentGateEvidence;
		},
		providerGuardFactory: ({ preregistration: record, preregistrationSha256 }) =>
			fauxProviderGuard(record, preregistrationSha256),
		agentRuntimeFactory: async (arm, record): Promise<CompilerGymProxyCascadePaidAgentRuntime> => {
			const faux = registerFauxProvider({
				api: `faux-paid-runner-${arm}-${root.split("/").at(-1)}`,
				provider: record.frozenCommon.provider,
				models: [{ id: record.frozenCommon.model, reasoning: true, maxTokens: 32_000 }],
			});
			faux.setResponses(
				requestsFor(record).map((request, index) =>
					fauxAssistantMessage(
						fauxToolCall(
							COMPILER_GYM_PROXY_CASCADE_PAID_TOOL.name,
							arm === "proxy-cascade" && input.invalidTreatmentCallOrdinal === index + 1
								? { ...structuredClone(request), actions: ["-unsupported-paid-test-action"] }
								: structuredClone(request),
							{
								id: `${arm}-paid-tool-${index + 1}`,
							},
						),
						{ stopReason: "toolUse" },
					),
				),
			);
			const model = faux.getModel();
			const authStorage = AuthStorage.inMemory();
			authStorage.setRuntimeApiKey(model.provider, "faux-paid-runner-key");
			const modelRegistry = ModelRegistry.inMemory(authStorage);
			modelRegistry.registerProvider(model.provider, {
				baseUrl: model.baseUrl,
				apiKey: "faux-paid-runner-key",
				api: faux.api,
				models: faux.models,
			});
			return {
				authStorage,
				modelRegistry,
				model,
				agentDir: record.providerRegistryClosure.agentDir,
				dispose: () => {
					providerTransportCalls.set(arm, faux.state.callCount);
					faux.unregister();
				},
			};
		},
		now: () => new Date(FIXED_NOW.getTime() + timestampOrdinal++ * 1_000),
		monotonicNowMicros: clock.now,
	};
	return {
		root,
		input: { repoRoot: REPO_ROOT, preregistrationPath, outputDir },
		preregistration,
		closure,
		remote,
		evaluator,
		providerTransportCalls,
		get environmentGateCalls() {
			return environmentGateCalls;
		},
		dependencies,
	};
}

function outputEnvelope(value: unknown): Record<string, unknown> {
	assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
	return value as Record<string, unknown>;
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CompilerGym proxy-cascade isolated paid pair runner", () => {
	it("runs a control-first accepted faux pair with exact calls, schedule, lineage, persistence, and hidden audit", async () => {
		const run = await prepareRun({ drawHex: "00".repeat(16) });
		const result = await runCompilerGymProxyCascadePaidPair(run.input, run.dependencies);
		assert.equal(result.ok, true, result.failure ?? "");
		assert.equal(result.runtimeMode, "test-only-injected-runtime");
		assert.equal(result.liveScientificEvidenceEligible, false);
		assert.equal(outputEnvelope(result.localAttemptLock.value).outputReadinessProbePassed, true);
		assert.match(
			String(outputEnvelope(result.localAttemptLock.value).postLockPersistenceAtomicityLimit),
			/attempt-lock-as-sole-durable-evidence/,
		);
		assert.equal(result.terminalClassification, COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.directionalWin);
		assert.deepEqual(result.armExecutionOrder, ["full-control", "proxy-cascade"]);
		assert.equal(result.allocations.length, 16);
		assert.equal(result.evaluationAttemptCount, 16);
		assert.equal(result.externalAllocationCount, 16);
		assert.equal(result.terminalMeasurementCount, 16);
		assert.deepEqual(result.failedEvaluations, []);
		assert.equal(result.assessment?.accounting.controlOnlineTaskEvaluations, 8);
		assert.equal(result.assessment?.accounting.treatmentOnlineTaskEvaluations, 6);
		assert.equal(result.assessment?.accounting.treatmentHiddenAuditEvaluations, 2);
		assert.equal(result.maximumObservedEvaluatorConcurrency, 2);
		assert.equal(run.evaluator.maximumActive, 2);
		assert.equal(run.evaluator.prepareCalls, 1);
		assert.equal(run.environmentGateCalls, 8);
		assert.deepEqual(Object.fromEntries(run.providerTransportCalls), {
			"full-control": 4,
			"proxy-cascade": 4,
		});
		for (const arm of ["full-control", "proxy-cascade"] as const) {
			const evidence = result.arms[arm]!;
			assert.deepEqual(evidence.policyFailures, []);
			assert.deepEqual(evidence.apparatusFailures, []);
			assert.equal(evidence.observation.actualProviderDispatches, 4);
			assert.equal(evidence.observation.actualToolCalls, 4);
			assert.equal(evidence.observation.blockedProviderDispatchesAfterTerminal, 1);
			assert.equal(evidence.observation.abortedContinuationPersisted, true);
			assert.equal(evidence.observation.abortedContinuationUsageTokens, 0);
			assert.equal(evidence.observation.abortedContinuationTransportDispatches, 0);
			assert.equal(evidence.observation.terminalToolOutputsPersistedBeforeNextRequest, true);
			assert.equal(evidence.eventCounts.compaction_start ?? 0, 0);
			assert.equal(evidence.sessionSha256AfterHiddenAudits, evidence.sessionSha256AtOnlineTerminal);
		}
		assert.equal(result.hiddenAuditsStartedAfterBothOnlineArmsTerminal, true);
		assert.equal(result.hiddenAuditEvidenceWasAgentInaccessible, true);
		const treatmentToolFour = outputEnvelope(result.arms["proxy-cascade"]!.toolOutputs[3]);
		assert.equal((treatmentToolFour.evaluations as unknown[]).length, 1);
		assert.equal(outputEnvelope(treatmentToolFour.budget).freshOnlineTaskEvaluationsUsed, 6);
		const control = result.allocations.filter(
			(allocation) => allocation.arm === "full-control" && allocation.phase === "online-tool-result",
		);
		for (const ordinal of [1, 2, 3, 4] as const) {
			const current = control.filter((allocation) => allocation.candidateOrdinal === ordinal);
			const parents =
				ordinal === 1
					? []
					: control
							.filter((allocation) => allocation.candidateOrdinal === ordinal - 1)
							.map((allocation) => allocation.job.proposal.jobId)
							.sort();
			for (const allocation of current) {
				assert.deepEqual([...allocation.job.proposal.proposal.parentJobIds].sort(), parents);
			}
		}
		const treatmentBlowfish = result.allocations.filter(
			(allocation) =>
				allocation.arm === "proxy-cascade" &&
				allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH &&
				allocation.phase === "online-tool-result",
		);
		for (const allocation of treatmentBlowfish) {
			const prior = treatmentBlowfish.find(
				(candidate) => candidate.candidateOrdinal === allocation.candidateOrdinal - 1,
			);
			assert.deepEqual(
				allocation.job.proposal.proposal.parentJobIds,
				allocation.candidateOrdinal === 1 ? [] : [prior!.job.proposal.jobId],
			);
		}
		const selected = result.allocations.filter(
			(allocation) => allocation.phase === "online-agent-inaccessible-selected-confirmation",
		);
		const allBlowfishParents = treatmentBlowfish.map((allocation) => allocation.job.proposal.jobId).sort();
		for (const allocation of selected) {
			assert.deepEqual([...allocation.job.proposal.proposal.parentJobIds].sort(), allBlowfishParents);
		}
		const hiddenParents = [
			...allBlowfishParents,
			...selected.map((allocation) => allocation.job.proposal.jobId),
		].sort();
		for (const allocation of result.allocations.filter(
			(allocation) => allocation.phase === "post-terminal-agent-inaccessible-hidden-audit",
		)) {
			assert.deepEqual([...allocation.job.proposal.proposal.parentJobIds].sort(), hiddenParents);
		}
		assert.equal(new Set(result.allocations.map((allocation) => allocation.job.proposal.jobId)).size, 16);
		assert.equal(new Set(result.allocations.map((allocation) => allocation.job.proposal.manifestDigest)).size, 16);
		assert.equal(new Set(result.allocations.map((allocation) => allocation.aggregate.tasks[0].slurmId)).size, 16);
		const terminalSeal = result.localSeals.find((seal) => seal.kind === "terminal");
		assert.ok(terminalSeal);
		assert.match(JSON.stringify(terminalSeal.value), /preTerminalDisposition/);
		assert.doesNotMatch(JSON.stringify(terminalSeal.value), /"terminalClassification"/);
	});

	it("continues after one canonical cascade semantic rejection without retry and runs hidden audit only after control", async () => {
		const run = await prepareRun({ drawHex: `01${"00".repeat(15)}`, rejectTreatmentOrdinal: 2 });
		const result = await runCompilerGymProxyCascadePaidPair(run.input, run.dependencies);
		assert.equal(result.ok, true, result.failure ?? "");
		assert.deepEqual(result.armExecutionOrder, ["proxy-cascade", "full-control"]);
		assert.equal(result.allocations.length, 15);
		assert.equal(result.assessment?.accounting.controlOnlineTaskEvaluations, 8);
		assert.equal(result.assessment?.accounting.treatmentOnlineTaskEvaluations, 6);
		assert.equal(result.assessment?.accounting.treatmentHiddenAuditEvaluations, 1);
		assert.equal(run.environmentGateCalls, 8);
		assert.deepEqual(Object.fromEntries(run.providerTransportCalls), {
			"proxy-cascade": 4,
			"full-control": 4,
		});
		const treatment = result.arms["proxy-cascade"]!;
		assert.equal(treatment.candidates[1]!.blowfish.outcome, "complete-semantic-rejection");
		assert.equal(treatment.candidates[1]!.bzip2, null);
		assert.deepEqual(result.assessment?.selection.expectedSelectedOrdinals, [4, 3]);
		assert.equal(
			result.allocations.filter(
				(allocation) =>
					allocation.arm === "proxy-cascade" &&
					allocation.candidateOrdinal === 2 &&
					allocation.benchmarkId === COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
			).length,
			1,
		);
		const firstHidden = result.allocations.findIndex(
			(allocation) => allocation.phase === "post-terminal-agent-inaccessible-hidden-audit",
		);
		const lastControl = result.allocations.reduce(
			(last, allocation, index) => (allocation.arm === "full-control" ? index : last),
			-1,
		);
		assert.ok(firstHidden > lastControl);
		assert.equal(treatment.observation.providerRetries, 0);
		assert.equal(treatment.observation.providerReplacements, 0);
		assert.equal(treatment.observation.measurementReuseCount, 0);
	});

	it("rejects partial dependency injection before preregistration or dispatch", async () => {
		await assert.rejects(
			() =>
				runCompilerGymProxyCascadePaidPair(
					{ repoRoot: REPO_ROOT, preregistrationPath: "/unused/preregistration", outputDir: "/unused/output" },
					{ environmentGate: async () => Promise.reject(new Error("must not run")) },
				),
			/Paid-pilot dependency injection must be explicitly test-only/,
		);
	});

	it("drains a delayed sibling after an immediate evaluator failure and leaves ledger and result stable", async () => {
		const run = await prepareRun({
			drawHex: "00".repeat(16),
			failEvaluation: {
				arm: "full-control",
				candidateOrdinal: 1,
				benchmarkId: COMPILER_GYM_PROXY_CASCADE_BLOWFISH,
			},
		});
		const result = await runCompilerGymProxyCascadePaidPair(run.input, run.dependencies);
		assert.equal(result.ok, false);
		assert.equal(result.terminalClassification, COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid);
		assert.equal(result.allocations.length, 1);
		assert.equal(result.evaluationAttemptCount, 2);
		assert.equal(result.externalAllocationCount, 2);
		assert.equal(result.terminalMeasurementCount, 1);
		assert.equal(result.failedEvaluations.length, 1);
		const failedEvaluation = result.failedEvaluations[0]!;
		assert.match(failedEvaluation.externalJobId ?? "", /^190000[12]$/);
		const failedExternalJobId = failedEvaluation.externalJobId!;
		assert.equal(failedEvaluation.error.code, "faux-evaluator-accounting-failure");
		assert.ok(failedEvaluation.error.stdout);
		assert.ok(failedEvaluation.error.stderr);
		const artifactStore = new ArtifactStore(join(run.input.outputDir, "artifacts"));
		assert.match(await artifactStore.readString(failedEvaluation.error.stdout), /"partial":true/);
		assert.equal(
			await artifactStore.readString(failedEvaluation.error.stderr),
			`faux evaluator accounting failure for ${failedExternalJobId}\n`,
		);
		const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
		const failedStates = events.filter(
			(event) =>
				event.kind === "job_state" &&
				outputEnvelope(event.payload).status === "failed" &&
				outputEnvelope(event.payload).externalJobId === failedExternalJobId,
		);
		assert.equal(failedStates.length, 1);
		assert.equal(
			events.filter(
				(event) =>
					event.kind === "run_manifest" &&
					outputEnvelope(event.payload).type === "proxy_cascade_paid_evaluation_failed",
			).length,
			1,
		);
		assert.match(result.failure ?? "", new RegExp(failedExternalJobId));
		assert.equal(run.evaluator.failureTriggered, true);
		assert.equal(run.evaluator.completedAfterFailure, 1);
		assert.equal(run.providerTransportCalls.get("full-control"), 1);
		assert.equal(run.providerTransportCalls.has("proxy-cascade"), false);
		const resultPath = join(run.input.outputDir, "result.json");
		const [ledgerBefore, resultBefore] = await Promise.all([
			readFile(result.ledgerPath, "utf8"),
			readFile(resultPath, "utf8"),
		]);
		await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 120));
		assert.equal(await readFile(result.ledgerPath, "utf8"), ledgerBefore);
		assert.equal(await readFile(resultPath, "utf8"), resultBefore);
		assert.ok(result.localSeals.some((seal) => seal.kind === "terminal"));
		assert.ok(result.remoteLocks.some((lock) => lock.kind === "terminal"));
	});

	it("persists both concurrent hidden-audit failures and seals unchanged sessions", async () => {
		const run = await prepareRun({
			drawHex: "00".repeat(16),
			failEvaluations: [
				{
					arm: "proxy-cascade",
					candidateOrdinal: 1,
					benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
				},
				{
					arm: "proxy-cascade",
					candidateOrdinal: 2,
					benchmarkId: COMPILER_GYM_PROXY_CASCADE_BZIP2,
				},
			],
		});
		const result = await runCompilerGymProxyCascadePaidPair(run.input, run.dependencies);
		assert.equal(result.ok, false);
		assert.equal(result.terminalClassification, COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid);
		assert.equal(result.assessment, null);
		assert.equal(result.evaluationAttemptCount, 16);
		assert.equal(result.externalAllocationCount, 16);
		assert.equal(result.terminalMeasurementCount, 14);
		assert.equal(result.failedEvaluations.length, 2);
		assert.deepEqual(result.failedEvaluations.map((failure) => failure.externalJobId).sort(), ["1900015", "1900016"]);
		assert.ok(result.failedEvaluations.every((failure) => failure.error.stdout && failure.error.stderr));
		assert.match(result.failure ?? "", /1900015/);
		assert.match(result.failure ?? "", /1900016/);
		assert.equal(result.hiddenAuditsStartedAfterBothOnlineArmsTerminal, true);
		assert.equal(result.hiddenAuditEvidenceWasAgentInaccessible, true);
		for (const arm of ["full-control", "proxy-cascade"] as const) {
			assert.equal(
				result.arms[arm]?.sessionSha256AfterHiddenAudits,
				result.arms[arm]?.sessionSha256AtOnlineTerminal,
			);
		}
		const hiddenSeal = result.localSeals.find((seal) => seal.kind === "hidden-audit");
		assert.ok(hiddenSeal);
		assert.equal(outputEnvelope(hiddenSeal.value).outcome, "apparatus-failure");
		assert.equal(outputEnvelope(hiddenSeal.value).hiddenAuditAttemptCount, 2);
		assert.equal(outputEnvelope(hiddenSeal.value).hiddenAuditAllocationCount, 0);
		assert.equal(outputEnvelope(hiddenSeal.value).sessionHashesUnchanged, true);
		assert.ok(result.remoteLocks.some((lock) => lock.kind === "hidden-audit"));
		const events = verifyLedgerContentsStrict(await readFile(result.ledgerPath, "utf8"));
		assert.equal(
			events.filter((event) => event.kind === "job_state" && outputEnvelope(event.payload).status === "failed")
				.length,
			2,
		);
		assert.equal(
			events.filter(
				(event) =>
					event.kind === "run_manifest" &&
					outputEnvelope(event.payload).type === "proxy_cascade_paid_evaluation_failed",
			).length,
			2,
		);
	});

	it("stops after a malformed second treatment call without a later transport, allocation, or control arm", async () => {
		const run = await prepareRun({
			drawHex: `01${"00".repeat(15)}`,
			invalidTreatmentCallOrdinal: 2,
		});
		const result = await runCompilerGymProxyCascadePaidPair(run.input, run.dependencies);
		assert.equal(result.ok, false);
		assert.equal(
			result.terminalClassification,
			COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.policyNonconformance,
		);
		assert.equal(result.allocations.length, 1);
		assert.equal(run.providerTransportCalls.get("proxy-cascade"), 2);
		assert.equal(run.providerTransportCalls.has("full-control"), false);
		assert.equal(run.environmentGateCalls, 2);
		assert.equal(result.arms["proxy-cascade"]?.observation.actualToolCalls, 1);
		assert.equal(result.arms["proxy-cascade"]?.apparatusFailures.length, 0);
		assert.ok((result.arms["proxy-cascade"]?.policyFailures.length ?? 0) > 0);
	});

	it("keeps a provisional local terminal seal noncontradictory when the remote terminal lock fails", async () => {
		const run = await prepareRun({ drawHex: "00".repeat(16), failRemoteTerminalLock: true });
		const result = await runCompilerGymProxyCascadePaidPair(run.input, run.dependencies);
		assert.equal(result.ok, false);
		assert.equal(result.terminalClassification, COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid);
		assert.match(result.failure ?? "", /remote terminal lock failed|faux remote install failure/);
		const terminalSeal = result.localSeals.find((seal) => seal.kind === "terminal");
		assert.ok(terminalSeal);
		assert.match(JSON.stringify(terminalSeal.value), /preTerminalDisposition/);
		assert.doesNotMatch(JSON.stringify(terminalSeal.value), /"terminalClassification"/);
		assert.equal(
			result.remoteLocks.some((lock) => lock.kind === "terminal"),
			false,
		);
	});
});

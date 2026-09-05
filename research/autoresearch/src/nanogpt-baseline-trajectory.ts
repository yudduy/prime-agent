import assert from "node:assert/strict";
import { chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { sha256Text } from "./canonical-json.js";
import {
	buildNanoGptBaselineValidationPlan,
	createNanoGptBaselineNonce,
	NANOGPT_BASELINE_DURATION_MS,
	NANOGPT_BASELINE_LIMITATIONS,
	NANOGPT_BASELINE_MODEL,
	NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT,
	NANOGPT_BASELINE_RUNTIME_POLICY,
	NANOGPT_BASELINE_TRAJECTORY_PROTOCOL,
	type NanoGptBaselineChampion,
	type NanoGptBaselineOperationResult,
	type NanoGptBaselineStopReason,
	type NanoGptBaselineValidationPlan,
	type NanoGptBaselineWorkspaceManifest,
	prepareNanoGptBaselineWorkspace,
	readExactNanoGptBaselineProgram,
	readJsonFileIfPresent,
	writeDurableJson,
} from "./nanogpt-baseline-protocol.js";
import {
	type NanoGptBaselineControllerOwner,
	NanoGptBaselineProxy,
	NanoGptBaselineProxyServer,
} from "./nanogpt-baseline-proxy.js";
import type { NanoGptScoredStaticEvidence } from "./nanogpt-scored-protocol.js";
export interface NanoGptBaselineTrajectoryProxy {
	closeAdmission(reason: string): Promise<void>;
	activeJobIds(): readonly string[];
	completedResults(): readonly NanoGptBaselineOperationResult[];
	champion(): NanoGptBaselineChampion | null;
}

export type NanoGptBaselineTrajectoryPhase =
	| "prepared"
	| "running"
	| "admission-closed"
	| "champion-sealed"
	| "finished"
	| "failed";

export interface NanoGptBaselineTrajectoryState {
	readonly schemaVersion: 1;
	readonly protocol: typeof NANOGPT_BASELINE_TRAJECTORY_PROTOCOL;
	readonly revision: number;
	readonly runId: string;
	readonly branchId: string;
	readonly phase: NanoGptBaselineTrajectoryPhase;
	readonly startedAt: string;
	readonly deadlineAt: string;
	readonly updatedAt: string;
	readonly programSha256: string;
	readonly initialUserMessageCount: 0 | 1;
	readonly sessionId: string | null;
	readonly sessionFile: string | null;
	readonly observedAttributedOutputTokens: number;
	readonly outputTokenCheckpoint: typeof NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT;
	readonly outputAccounting: "root-and-child attributed output at quiescent/message checkpoints; native compaction usage unavailable";
	readonly pendingJobIds: readonly string[];
	readonly completedOperationCount: number;
	readonly champion: NanoGptBaselineChampion | null;
	readonly postTerminalValidationPlan: NanoGptBaselineValidationPlan | null;
	readonly stopReason: NanoGptBaselineStopReason | null;
	readonly stoppedAt: string | null;
	readonly outstandingEvaluatorCancellation: "unsupported";
	readonly failures: readonly { readonly recordedAt: string; readonly message: string }[];
	readonly runtimePolicy: typeof NANOGPT_BASELINE_RUNTIME_POLICY;
	readonly limitations: typeof NANOGPT_BASELINE_LIMITATIONS;
	readonly workspaceManifest: NanoGptBaselineWorkspaceManifest;
}

export interface NanoGptBaselineAgentSession {
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly provider: string;
	readonly modelId: string;
	readonly thinkingLevel: string;
	readonly serviceTier: string | null | undefined;
	readonly activeToolNames: readonly string[];
	promptAndWait(prompt: string): Promise<void>;
	waitForRlmQuiescence(): Promise<void>;
	abort(): Promise<void>;
	dispose(): Promise<void>;
	outputTokens(): number;
	userMessages(): readonly string[];
	subscribeUsage(listener: () => void): () => void;
}

export interface NanoGptBaselineSessionFactoryInput {
	readonly workspaceDir: string;
	readonly sessionDir: string;
	readonly previousSessionFile: string | null;
}

export type NanoGptBaselineSessionFactory = (
	input: NanoGptBaselineSessionFactoryInput,
) => Promise<NanoGptBaselineAgentSession>;

export interface NanoGptBaselineTrajectoryOptions {
	readonly stateDir: string;
	readonly runId: string;
	readonly branchId: string;
	readonly workspace: NanoGptBaselineWorkspaceManifest;
	readonly proxy: NanoGptBaselineTrajectoryProxy;
	readonly sessionFactory: NanoGptBaselineSessionFactory;
	readonly now?: () => Date;
	readonly setDeadlineTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	readonly clearDeadlineTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface NanoGptBaselineHarnessOptions {
	readonly rootDir: string;
	readonly runId: string;
	readonly branchId: string;
	readonly owner: NanoGptBaselineControllerOwner;
	readonly sessionFactory: NanoGptBaselineSessionFactory;
	readonly socketPath?: string;
	readonly staticGate?: (candidatePatch: string) => Promise<NanoGptScoredStaticEvidence>;
	readonly now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: unknown, options: NanoGptBaselineTrajectoryOptions): NanoGptBaselineTrajectoryState {
	if (!isRecord(value)) throw new Error("Baseline trajectory state must be an object");
	if (
		value.schemaVersion !== 1 ||
		value.protocol !== NANOGPT_BASELINE_TRAJECTORY_PROTOCOL ||
		value.runId !== options.runId ||
		value.branchId !== options.branchId ||
		!Number.isSafeInteger(value.revision) ||
		typeof value.startedAt !== "string" ||
		typeof value.deadlineAt !== "string" ||
		!Number.isFinite(Date.parse(value.startedAt)) ||
		!Number.isFinite(Date.parse(value.deadlineAt)) ||
		Date.parse(value.deadlineAt) !== Date.parse(value.startedAt) + NANOGPT_BASELINE_DURATION_MS
	) {
		throw new Error("Baseline trajectory state identity, schema, or durable deadline changed");
	}
	return value as unknown as NanoGptBaselineTrajectoryState;
}

class TrajectoryStateStore {
	private state!: NanoGptBaselineTrajectoryState;
	private mutationTail: Promise<void> = Promise.resolve();

	private constructor(
		private readonly path: string,
		private readonly options: NanoGptBaselineTrajectoryOptions,
	) {}

	static async open(options: NanoGptBaselineTrajectoryOptions): Promise<TrajectoryStateStore> {
		const path = join(options.stateDir, "trajectory-state.json");
		const store = new TrajectoryStateStore(path, options);
		const loaded = await readJsonFileIfPresent(path);
		if (loaded === null) {
			const startedAt = store.now();
			store.state = {
				schemaVersion: 1,
				protocol: NANOGPT_BASELINE_TRAJECTORY_PROTOCOL,
				revision: 0,
				runId: options.runId,
				branchId: options.branchId,
				phase: "prepared",
				startedAt,
				deadlineAt: new Date(Date.parse(startedAt) + NANOGPT_BASELINE_DURATION_MS).toISOString(),
				updatedAt: startedAt,
				programSha256: options.workspace.programSha256,
				initialUserMessageCount: 0,
				sessionId: null,
				sessionFile: null,
				observedAttributedOutputTokens: 0,
				outputTokenCheckpoint: NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT,
				outputAccounting:
					"root-and-child attributed output at quiescent/message checkpoints; native compaction usage unavailable",
				pendingJobIds: [],
				completedOperationCount: 0,
				champion: null,
				postTerminalValidationPlan: null,
				stopReason: null,
				stoppedAt: null,
				outstandingEvaluatorCancellation: "unsupported",
				failures: [],
				runtimePolicy: NANOGPT_BASELINE_RUNTIME_POLICY,
				limitations: NANOGPT_BASELINE_LIMITATIONS,
				workspaceManifest: options.workspace,
			};
			await writeDurableJson(path, store.state);
		} else {
			store.state = parseState(loaded, options);
		}
		return store;
	}

	private now(): string {
		return (this.options.now?.() ?? new Date()).toISOString();
	}

	get(): NanoGptBaselineTrajectoryState {
		return structuredClone(this.state);
	}

	async update(
		change: (state: NanoGptBaselineTrajectoryState) => Omit<NanoGptBaselineTrajectoryState, "revision" | "updatedAt">,
	): Promise<NanoGptBaselineTrajectoryState> {
		const operation = this.mutationTail.then(async () => {
			const next = {
				...change(this.state),
				revision: this.state.revision + 1,
				updatedAt: this.now(),
			} satisfies NanoGptBaselineTrajectoryState;
			await writeDurableJson(this.path, next);
			this.state = next;
		});
		this.mutationTail = operation.then(
			() => undefined,
			() => undefined,
		);
		await operation;
		return this.get();
	}
}

function wrapPrimeSession(session: AgentSession): NanoGptBaselineAgentSession {
	const sessionFile = session.sessionFile;
	if (!sessionFile) throw new Error("NanoGPT baseline requires a persistent Prime session");
	return {
		sessionId: session.sessionId,
		sessionFile,
		provider: session.model?.provider ?? "",
		modelId: session.model?.id ?? "",
		thinkingLevel: session.thinkingLevel,
		serviceTier: session.serviceTier,
		activeToolNames: session.getActiveToolNames(),
		promptAndWait: (prompt) => session.promptAndWait(prompt),
		waitForRlmQuiescence: () => session.waitForRlmQuiescence(),
		abort: () => session.abort(),
		dispose: () => session.disposeAsync(),
		outputTokens: () => session.getSessionStats().tokens.output,
		userMessages: () => session.getUserMessagesForForking().map((message) => message.text),
		subscribeUsage: (listener) =>
			session.subscribe((event) => {
				if (event.type === "message_end" && event.message.role === "assistant") {
					const message = event.message as AssistantMessage;
					if (message.usage.output >= 0) listener();
				}
			}),
	};
}

export async function createPrimeNanoGptBaselineSession(
	input: NanoGptBaselineSessionFactoryInput,
): Promise<NanoGptBaselineAgentSession> {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = modelRegistry.find(NANOGPT_BASELINE_MODEL.provider, NANOGPT_BASELINE_MODEL.id);
	if (!model) throw new Error("openai-codex/gpt-5.6-luna is not registered");
	if (!modelRegistry.hasConfiguredAuth(model)) {
		throw new Error("OpenAI Codex subscription authentication is not configured for Prime Agent");
	}
	const settingsManager = SettingsManager.inMemory();
	assert.equal(settingsManager.getCompactionEnabled(), true);
	const resourceLoader = new DefaultResourceLoader({
		cwd: input.workspaceDir,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories: [],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		bundledSkillsDir: null,
	});
	await resourceLoader.reload();
	const sessionManager = input.previousSessionFile
		? await SessionManager.openAsync(input.previousSessionFile, input.sessionDir, input.workspaceDir)
		: SessionManager.create(input.workspaceDir, input.sessionDir);
	sessionManager.flushNow();
	const { session } = await createAgentSession({
		cwd: input.workspaceDir,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: NANOGPT_BASELINE_MODEL.thinkingLevel,
		serviceTier: NANOGPT_BASELINE_MODEL.serviceTier,
		settingsManager,
		sessionManager,
		resourceLoader,
		includeGoals: false,
	});
	assert.equal(session.model?.provider, NANOGPT_BASELINE_MODEL.provider);
	assert.equal(session.model?.id, NANOGPT_BASELINE_MODEL.id);
	assert.equal(session.thinkingLevel, NANOGPT_BASELINE_MODEL.thinkingLevel);
	assert.equal(session.serviceTier, NANOGPT_BASELINE_MODEL.serviceTier);
	assert.deepEqual(session.getActiveToolNames(), ["ipython"]);
	if (!session.sessionFile) throw new Error("NanoGPT baseline session is not persistent");
	await chmod(session.sessionFile, 0o600);
	return wrapPrimeSession(session);
}

export class NanoGptBaselineTrajectory {
	private constructor(
		private readonly options: NanoGptBaselineTrajectoryOptions,
		private readonly store: TrajectoryStateStore,
	) {}

	static async open(options: NanoGptBaselineTrajectoryOptions): Promise<NanoGptBaselineTrajectory> {
		if (resolve(options.stateDir) !== options.stateDir)
			throw new Error("Baseline trajectory stateDir must be absolute");
		await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
		return new NanoGptBaselineTrajectory(options, await TrajectoryStateStore.open(options));
	}

	getState(): NanoGptBaselineTrajectoryState {
		return this.store.get();
	}

	private nowMs(): number {
		return (this.options.now?.() ?? new Date()).getTime();
	}

	private async syncEvidence(session: NanoGptBaselineAgentSession): Promise<void> {
		const outputTokens = session.outputTokens();
		await this.store.update((state) => ({
			...state,
			observedAttributedOutputTokens: Math.max(state.observedAttributedOutputTokens, outputTokens),
			pendingJobIds: [...this.options.proxy.activeJobIds()],
			completedOperationCount: this.options.proxy.completedResults().length,
		}));
	}

	private async closeAdmission(
		session: NanoGptBaselineAgentSession,
		reason: NanoGptBaselineStopReason,
	): Promise<void> {
		const state = this.store.get();
		if (state.stopReason !== null) return;
		await this.options.proxy.closeAdmission(reason);
		await this.store.update((current) => ({
			...current,
			phase: "admission-closed",
			stopReason: reason,
			stoppedAt: new Date(this.nowMs()).toISOString(),
			pendingJobIds: [...this.options.proxy.activeJobIds()],
		}));
		if (reason !== "agent-returned") await session.abort();
	}

	private async sealAndFinish(): Promise<NanoGptBaselineTrajectoryState> {
		const champion = this.options.proxy.champion();
		const validationPlan = champion ? buildNanoGptBaselineValidationPlan(this.options.branchId, champion) : null;
		await this.store.update((current) => ({
			...current,
			phase: "champion-sealed",
			champion,
			postTerminalValidationPlan: validationPlan,
			pendingJobIds: [...this.options.proxy.activeJobIds()],
			completedOperationCount: this.options.proxy.completedResults().length,
		}));
		return await this.store.update((current) => ({ ...current, phase: "finished" }));
	}

	async run(): Promise<NanoGptBaselineTrajectoryState> {
		let state = this.store.get();
		if (state.phase === "finished" || state.phase === "failed") return state;
		const sessionDir = join(this.options.stateDir, "sessions");
		await mkdir(sessionDir, { recursive: true, mode: 0o700 });
		let session: NanoGptBaselineAgentSession;
		try {
			session = await this.options.sessionFactory({
				workspaceDir: this.options.workspace.workspaceDir,
				sessionDir,
				previousSessionFile: state.sessionFile,
			});
			if (
				session.provider !== NANOGPT_BASELINE_MODEL.provider ||
				session.modelId !== NANOGPT_BASELINE_MODEL.id ||
				session.thinkingLevel !== NANOGPT_BASELINE_MODEL.thinkingLevel ||
				session.serviceTier !== NANOGPT_BASELINE_MODEL.serviceTier ||
				JSON.stringify(session.activeToolNames) !== JSON.stringify(["ipython"])
			) {
				await session.dispose();
				throw new Error("Prime baseline session runtime differs from the frozen model/tool contract");
			}
		} catch (error) {
			const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
			await this.options.proxy.closeAdmission("session-failed");
			return await this.store.update((current) => ({
				...current,
				phase: "failed",
				stopReason: "session-failed",
				stoppedAt: new Date(this.nowMs()).toISOString(),
				failures: [...current.failures, { recordedAt: new Date(this.nowMs()).toISOString(), message }],
				pendingJobIds: [...this.options.proxy.activeJobIds()],
			}));
		}

		state = await this.store.update((current) => ({
			...current,
			phase: "running",
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
		}));
		const setTimer = this.options.setDeadlineTimer ?? setTimeout;
		const clearTimer = this.options.clearDeadlineTimer ?? clearTimeout;
		let stopTail: Promise<void> = Promise.resolve();
		const requestStop = (reason: NanoGptBaselineStopReason): void => {
			stopTail = stopTail.then(() => this.closeAdmission(session, reason));
		};
		const remainingMs = Date.parse(state.deadlineAt) - this.nowMs();
		const timer = setTimer(() => requestStop("calendar-checkpoint"), Math.max(0, remainingMs));
		const usageUnsubscribe = session.subscribeUsage(() => {
			void this.syncEvidence(session).then(() => {
				if (session.outputTokens() >= NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT) {
					requestStop("output-token-checkpoint");
				}
			});
		});

		try {
			const program = await readExactNanoGptBaselineProgram();
			const persistedUserMessages = session.userMessages();
			if (
				persistedUserMessages.length > 1 ||
				(persistedUserMessages.length === 1 && persistedUserMessages[0] !== program)
			) {
				throw new Error("Persistent Prime session does not contain exactly the pinned initial prompt");
			}
			if (state.initialUserMessageCount === 1 && persistedUserMessages.length === 0) {
				throw new Error("Trajectory state claims an initial prompt that the persistent session does not contain");
			}
			if (state.initialUserMessageCount === 0 && persistedUserMessages.length === 1) {
				state = await this.store.update((current) => ({ ...current, initialUserMessageCount: 1 }));
			}
			if (remainingMs <= 0) {
				requestStop("calendar-checkpoint");
			} else if (persistedUserMessages.length === 0) {
				await session.promptAndWait(program);
				if (session.userMessages().length !== 1 || session.userMessages()[0] !== program) {
					throw new Error("Prime session did not durably record the exact initial prompt");
				}
				await this.store.update((current) => ({ ...current, initialUserMessageCount: 1 }));
			}
			await session.waitForRlmQuiescence();
			await this.syncEvidence(session);
			if (session.outputTokens() >= NANOGPT_BASELINE_OUTPUT_TOKEN_CHECKPOINT) {
				requestStop("output-token-checkpoint");
			} else if (this.nowMs() >= Date.parse(this.store.get().deadlineAt)) {
				requestStop("calendar-checkpoint");
			} else if (this.store.get().stopReason === null) {
				requestStop("agent-returned");
			}
			await stopTail;
			return await this.sealAndFinish();
		} catch (error) {
			const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
			requestStop("session-failed");
			await stopTail.catch(() => undefined);
			if (
				this.store.get().stopReason === "calendar-checkpoint" ||
				this.store.get().stopReason === "output-token-checkpoint"
			) {
				await this.syncEvidence(session).catch(() => undefined);
				return await this.sealAndFinish();
			}
			return await this.store.update((current) => ({
				...current,
				phase: "failed",
				failures: [...current.failures, { recordedAt: new Date(this.nowMs()).toISOString(), message }],
				pendingJobIds: [...this.options.proxy.activeJobIds()],
			}));
		} finally {
			clearTimer(timer);
			usageUnsubscribe();
			await session.dispose();
		}
	}
}

interface DurableProxyConnection {
	readonly schemaVersion: 1;
	readonly protocol: typeof NANOGPT_BASELINE_TRAJECTORY_PROTOCOL;
	readonly socketPath: string;
	readonly nonce: string;
}

function parseProxyConnection(value: unknown): DurableProxyConnection {
	if (
		!isRecord(value) ||
		value.schemaVersion !== 1 ||
		value.protocol !== NANOGPT_BASELINE_TRAJECTORY_PROTOCOL ||
		typeof value.socketPath !== "string" ||
		resolve(value.socketPath) !== value.socketPath ||
		typeof value.nonce !== "string" ||
		!/^[0-9a-f]{64}$/.test(value.nonce)
	) {
		throw new Error("Durable baseline proxy connection identity changed");
	}
	return value as unknown as DurableProxyConnection;
}

export async function runNanoGptBaselineHarness(
	options: NanoGptBaselineHarnessOptions,
): Promise<NanoGptBaselineTrajectoryState> {
	const rootDir = resolve(options.rootDir);
	if (rootDir !== options.rootDir) throw new Error("Baseline harness rootDir must be absolute and normalized");
	const hostStateDir = join(rootDir, "host-state");
	const connectionPath = join(hostStateDir, "proxy-connection.json");
	await mkdir(hostStateDir, { recursive: true, mode: 0o700 });
	const loadedConnection = await readJsonFileIfPresent(connectionPath);
	const defaultSocketPath = join(tmpdir(), `prime-ng-${sha256Text(rootDir).slice(0, 24)}.sock`);
	const connection =
		loadedConnection === null
			? {
					schemaVersion: 1 as const,
					protocol: NANOGPT_BASELINE_TRAJECTORY_PROTOCOL,
					socketPath: resolve(options.socketPath ?? defaultSocketPath),
					nonce: createNanoGptBaselineNonce(),
				}
			: parseProxyConnection(loadedConnection);
	if (options.socketPath !== undefined && resolve(options.socketPath) !== connection.socketPath) {
		throw new Error("Requested baseline socket path differs from the durable connection identity");
	}
	if (loadedConnection === null) await writeDurableJson(connectionPath, connection, 0o600);
	const workspace = await prepareNanoGptBaselineWorkspace({
		workspaceDir: join(rootDir, "workspace"),
		socketPath: connection.socketPath,
		nonce: connection.nonce,
	});
	const proxy = await NanoGptBaselineProxy.open({
		stateDir: join(hostStateDir, "proxy"),
		branchId: options.branchId,
		workspace,
		owner: options.owner,
		staticGate: options.staticGate,
		now: options.now,
	});
	const server = new NanoGptBaselineProxyServer({
		socketPath: connection.socketPath,
		nonce: connection.nonce,
		proxy,
	});
	await server.start();
	try {
		const trajectory = await NanoGptBaselineTrajectory.open({
			stateDir: join(hostStateDir, "trajectory"),
			runId: options.runId,
			branchId: options.branchId,
			workspace,
			proxy,
			sessionFactory: options.sessionFactory,
			now: options.now,
		});
		return await trajectory.run();
	} finally {
		await server.close({ destroyConnections: proxy.activeJobIds().length > 0 });
	}
}

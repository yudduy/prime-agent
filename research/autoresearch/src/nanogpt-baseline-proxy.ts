import type { ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import { ResearchController } from "./controller.js";
import {
	NANOGPT_BASELINE_SCORE_ONE_TIMEOUT,
	NANOGPT_BASELINE_TRAJECTORY_PROTOCOL,
	type NanoGptBaselineOperationResult,
	type NanoGptBaselineStageEvidence,
	type NanoGptBaselineTrials,
	type NanoGptBaselineWorkspaceManifest,
	nanoGptBaselineStageSequence,
	readJsonFileIfPresent,
	selectNanoGptBaselineChampion,
	verifyNanoGptBaselineWorkspaceFrozen,
	writeDurableJson,
	writeNanoGptBaselineDurableText,
} from "./nanogpt-baseline-protocol.js";
import { NANOGPT_BASELINE_FIXTURE, NANOGPT_BASELINE_SHA256 } from "./nanogpt-contract.js";
import {
	nanoGptScoredApparatusAttemptBoundaryCondition,
	validateNanoGptScoredCandidatePatch,
} from "./nanogpt-scored-adapter.js";
import {
	inferNanoGptScoredMode,
	type NanoGptScoredMode,
	type NanoGptScoredStaticEvidence,
	type NanoGptScoredVerifierPins,
	nanoGptScoredBenchmarkIds,
	nanoGptScoredBoundaryConditions,
	nanoGptScoredBudgetClass,
} from "./nanogpt-scored-protocol.js";
import type { EvaluationAdapter, JobStatus, JobView, SubmitRequest } from "./types.js";

const STOCK_IDENTITY_PATCH_FIXTURE = fileURLToPath(
	new URL("../fixtures/nanogpt/stock-identity.patch", import.meta.url),
);
const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TERMINAL_STATUSES = new Set<JobStatus>(["succeeded", "invalid", "failed", "cancelled"]);
const MAX_IPC_REQUEST_BYTES = 64 * 1024;
const BASELINE_TREATMENT = "stock-prime-exact-prompt" as const;
type BaselineTreatment = typeof BASELINE_TREATMENT | "stock-prime-exact-prompt-post-terminal-validation";

export interface NanoGptBaselineStageSubmission {
	readonly candidatePatch: string;
	readonly mode: NanoGptScoredMode;
	readonly parentJobId: string | null;
}

export interface NanoGptBaselineControllerOwner {
	readonly gpuCapacity: 4;
	readonly agentFacingConcurrency: 1;
	submitStage(input: NanoGptBaselineStageSubmission): Promise<string>;
	waitForStage(jobId: string): Promise<NanoGptBaselineStageEvidence>;
	activeJobIds(): readonly string[];
}

export interface ResearchControllerNanoGptBaselineOwnerOptions {
	readonly ledgerPath: string;
	readonly artifactDir: string;
	readonly adapter: EvaluationAdapter;
	readonly pins: NanoGptScoredVerifierPins;
	readonly branchId: string;
	readonly treatment?: BaselineTreatment;
	readonly scoreOneTransportTimeout: typeof NANOGPT_BASELINE_SCORE_ONE_TIMEOUT;
}

export class ResearchControllerNanoGptBaselineOwner implements NanoGptBaselineControllerOwner {
	readonly gpuCapacity = 4 as const;
	readonly agentFacingConcurrency = 1 as const;

	private constructor(
		private readonly controller: ResearchController,
		private readonly pins: NanoGptScoredVerifierPins,
		private readonly branchId: string,
		private readonly treatment: BaselineTreatment,
	) {}

	static async open(
		options: ResearchControllerNanoGptBaselineOwnerOptions,
	): Promise<ResearchControllerNanoGptBaselineOwner> {
		if (options.scoreOneTransportTimeout !== NANOGPT_BASELINE_SCORE_ONE_TIMEOUT) {
			throw new Error("Baseline owner requires the authoritative 6h score-1 transport cap");
		}
		const allowed = [
			...new Set(
				(["smoke-10", "score-1", "score-3", "replay-8"] as const).flatMap((mode) =>
					nanoGptScoredBenchmarkIds(mode),
				),
			),
		];
		const controller = await ResearchController.open({
			ledgerPath: options.ledgerPath,
			artifactDir: options.artifactDir,
			adapters: [options.adapter],
			metrics: {
				"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
				kernelbench: { name: "fast_at_1", direction: "maximize" },
				nanogpt: { name: "verified_steps", direction: "minimize" },
			},
			allowedBenchmarks: { "compiler-gym": [], kernelbench: [], nanogpt: allowed },
			allowedTreatments: [options.treatment ?? BASELINE_TREATMENT],
			maxInflight: { nanogpt: 4 },
			maxGpuInflight: 4,
		});
		return new ResearchControllerNanoGptBaselineOwner(
			controller,
			options.pins,
			options.branchId,
			options.treatment ?? BASELINE_TREATMENT,
		);
	}

	async submitStage(input: NanoGptBaselineStageSubmission): Promise<string> {
		const request: SubmitRequest = {
			branchId: this.branchId,
			lane: "nanogpt",
			benchmarkIds: [...nanoGptScoredBenchmarkIds(input.mode)],
			budgetClass: nanoGptScoredBudgetClass(input.mode),
			treatment: this.treatment,
			proposal: {
				hypothesis: `The exact candidate snapshot ${sha256Text(input.candidatePatch)} can improve the fixed NanoGPT objective.`,
				mechanism:
					"Model-authored changes are restricted to optimizer, optimizer hyperparameters, schedule, and initialization by the static contract.",
				predictedOutcome: `The candidate remains valid and competitive through ${input.mode}.`,
				boundaryConditions: [
					...nanoGptScoredBoundaryConditions(this.pins),
					nanoGptScoredApparatusAttemptBoundaryCondition(0),
				],
				parentJobIds: input.parentJobId === null ? [] : [input.parentJobId],
			},
			candidate: { format: "unified-diff", content: input.candidatePatch },
			requireFreshMeasurement: true,
		};
		return (await this.controller.submit(request)).jobId;
	}

	async waitForStage(jobId: string): Promise<NanoGptBaselineStageEvidence> {
		await this.controller.waitForIdle();
		const job = this.controller.statusForBranch(this.branchId, [jobId])[0];
		if (!job || !TERMINAL_STATUSES.has(job.state.status)) {
			throw new Error(`NanoGPT stage did not reach a terminal state: ${jobId}`);
		}
		return stageEvidence(job);
	}

	activeJobIds(): readonly string[] {
		return this.controller
			.statusForBranch(this.branchId)
			.filter((job) => !TERMINAL_STATUSES.has(job.state.status))
			.map((job) => job.proposal.jobId);
	}
}

interface DurableOperation {
	readonly operationId: string;
	readonly trials: NanoGptBaselineTrials;
	readonly acceptedAt: string;
	readonly candidateSha256: string;
	readonly candidatePatchSha256: string;
	readonly candidateSnapshotPath: string;
	readonly candidatePatchPath: string;
	readonly stageJobIds: Partial<Record<NanoGptScoredMode, string>>;
	readonly stageEvidence: readonly NanoGptBaselineStageEvidence[];
	readonly result: NanoGptBaselineOperationResult | null;
	readonly failure: string | null;
}

interface DurableProxyState {
	readonly schemaVersion: 1;
	readonly protocol: typeof NANOGPT_BASELINE_TRAJECTORY_PROTOCOL;
	readonly revision: number;
	readonly updatedAt: string;
	readonly branchId: string;
	readonly admissionOpen: boolean;
	readonly admissionClosedAt: string | null;
	readonly admissionCloseReason: string | null;
	readonly controllerCapacity: 4;
	readonly agentFacingConcurrency: 1;
	readonly outstandingEvaluatorCancellation: "unsupported";
	readonly operations: readonly DurableOperation[];
}

export interface NanoGptBaselineProxyOptions {
	readonly stateDir: string;
	readonly branchId: string;
	readonly workspace: NanoGptBaselineWorkspaceManifest;
	readonly owner: NanoGptBaselineControllerOwner;
	readonly staticGate?: (candidatePatch: string) => Promise<NanoGptScoredStaticEvidence>;
	readonly now?: () => Date;
}

export interface NanoGptBaselineRunOutcome {
	readonly reachedRequestedStage: boolean;
	readonly result: NanoGptBaselineOperationResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProxyState(value: unknown, branchId: string): DurableProxyState {
	if (!isRecord(value)) throw new Error("Baseline proxy state must be an object");
	if (
		value.schemaVersion !== 1 ||
		value.protocol !== NANOGPT_BASELINE_TRAJECTORY_PROTOCOL ||
		value.branchId !== branchId ||
		!Number.isSafeInteger(value.revision) ||
		typeof value.updatedAt !== "string" ||
		typeof value.admissionOpen !== "boolean" ||
		value.controllerCapacity !== 4 ||
		value.agentFacingConcurrency !== 1 ||
		value.outstandingEvaluatorCancellation !== "unsupported" ||
		!Array.isArray(value.operations)
	) {
		throw new Error("Baseline proxy state identity or schema changed");
	}
	for (const operation of value.operations) {
		if (
			!isRecord(operation) ||
			typeof operation.operationId !== "string" ||
			!OPERATION_ID_PATTERN.test(operation.operationId) ||
			(operation.trials !== 1 && operation.trials !== 3 && operation.trials !== 8)
		) {
			throw new Error("Baseline proxy state contains an invalid operation");
		}
	}
	return value as unknown as DurableProxyState;
}

function stageEvidence(job: JobView): NanoGptBaselineStageEvidence {
	const mode = inferNanoGptScoredMode(job.proposal.benchmarkIds);
	if (job.measurement?.provenance.mode !== undefined && job.measurement.provenance.mode !== mode)
		throw new Error(`NanoGPT job mode provenance changed: ${job.proposal.jobId}`);
	const numeric = (key: string): number | null => {
		const value = job.measurement?.provenance[key];
		if (value === undefined || value === "not-scored") return null;
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) throw new Error(`NanoGPT ${key} provenance is invalid`);
		return parsed;
	};
	const boolean = (key: string): boolean | null => {
		const value = job.measurement?.provenance[key];
		if (value === undefined || value === "not-scored") return null;
		if (value === "true") return true;
		if (value === "false") return false;
		throw new Error(`NanoGPT ${key} provenance is invalid`);
	};
	return {
		mode,
		jobId: job.proposal.jobId,
		status: job.state.status as NanoGptBaselineStageEvidence["status"],
		trainSteps: numeric("trainSteps"),
		meanValidationLoss: numeric("meanValidationLoss"),
		thresholdPassed: boolean("thresholdPassed"),
		recordEligible: boolean("recordEligible") === true,
	};
}

async function createCandidatePatch(candidatePath: string): Promise<string> {
	const [baseline, candidate] = await Promise.all([
		readFile(NANOGPT_BASELINE_FIXTURE, "utf8"),
		readFile(candidatePath, "utf8"),
	]);
	if (sha256Text(baseline) !== NANOGPT_BASELINE_SHA256) throw new Error("Pinned NanoGPT baseline changed");
	if (candidate === baseline) return readFile(STOCK_IDENTITY_PATCH_FIXTURE, "utf8");
	return new Promise((resolvePromise, reject) => {
		execFile(
			"diff",
			[
				"-u",
				"--label",
				"a/train_gpt_simple.py",
				"--label",
				"b/train_gpt_simple.py",
				NANOGPT_BASELINE_FIXTURE,
				candidatePath,
			],
			{ encoding: "utf8", maxBuffer: 256 * 1024 },
			(error: ExecFileException | null, stdout, stderr) => {
				if (error && error.code !== 1) {
					reject(new Error(`Unable to create NanoGPT candidate diff: ${error.message}; ${stderr.trim()}`));
					return;
				}
				if (!stdout) {
					reject(new Error("NanoGPT candidate diff was unexpectedly empty"));
					return;
				}
				resolvePromise(stdout);
			},
		);
	});
}

async function installContentAddressed(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	try {
		const existing = await readFile(path, "utf8");
		if (existing !== contents) throw new Error(`Content-addressed collision at ${path}`);
		return;
	} catch (error) {
		if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
	}
	await writeNanoGptBaselineDurableText(path, contents);
}

export class NanoGptBaselineProxy {
	private readonly statePath: string;
	private readonly staticGate: (candidatePatch: string) => Promise<NanoGptScoredStaticEvidence>;
	private state!: DurableProxyState;
	private operationTail: Promise<void> = Promise.resolve();

	private constructor(private readonly options: NanoGptBaselineProxyOptions) {
		this.statePath = join(options.stateDir, "proxy-state.json");
		this.staticGate = options.staticGate ?? validateNanoGptScoredCandidatePatch;
	}

	static async open(options: NanoGptBaselineProxyOptions): Promise<NanoGptBaselineProxy> {
		if (resolve(options.stateDir) !== options.stateDir) throw new Error("Baseline proxy stateDir must be absolute");
		if (options.owner.gpuCapacity !== 4 || options.owner.agentFacingConcurrency !== 1) {
			throw new Error("Baseline owner must provision four GPUs while serializing exact-prompt submissions");
		}
		const proxy = new NanoGptBaselineProxy(options);
		const loaded = await readJsonFileIfPresent(proxy.statePath);
		proxy.state =
			loaded === null
				? {
						schemaVersion: 1,
						protocol: NANOGPT_BASELINE_TRAJECTORY_PROTOCOL,
						revision: 0,
						updatedAt: proxy.now(),
						branchId: options.branchId,
						admissionOpen: true,
						admissionClosedAt: null,
						admissionCloseReason: null,
						controllerCapacity: 4,
						agentFacingConcurrency: 1,
						outstandingEvaluatorCancellation: "unsupported",
						operations: [],
					}
				: parseProxyState(loaded, options.branchId);
		if (loaded === null) await proxy.persist(proxy.state);
		return proxy;
	}

	private now(): string {
		return (this.options.now?.() ?? new Date()).toISOString();
	}

	private async persist(next: DurableProxyState): Promise<void> {
		await writeDurableJson(this.statePath, next);
		this.state = next;
	}

	private async replaceOperation(operation: DurableOperation): Promise<void> {
		const operations = this.state.operations.filter((item) => item.operationId !== operation.operationId);
		operations.push(operation);
		await this.persist({
			...this.state,
			revision: this.state.revision + 1,
			updatedAt: this.now(),
			operations,
		});
	}

	async closeAdmission(reason: string): Promise<void> {
		if (!this.state.admissionOpen) return;
		await this.persist({
			...this.state,
			revision: this.state.revision + 1,
			updatedAt: this.now(),
			admissionOpen: false,
			admissionClosedAt: this.now(),
			admissionCloseReason: reason,
		});
	}

	getState(): DurableProxyState {
		return structuredClone(this.state);
	}

	activeJobIds(): readonly string[] {
		return this.options.owner.activeJobIds();
	}

	completedResults(): readonly NanoGptBaselineOperationResult[] {
		return this.state.operations.flatMap((operation) => (operation.result ? [operation.result] : []));
	}

	champion() {
		return selectNanoGptBaselineChampion(this.completedResults());
	}

	async run(operationId: string, trials: NanoGptBaselineTrials): Promise<NanoGptBaselineRunOutcome> {
		const operation = this.operationTail.then(() => this.runSerialized(operationId, trials));
		this.operationTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private async runSerialized(operationId: string, trials: NanoGptBaselineTrials): Promise<NanoGptBaselineRunOutcome> {
		if (!OPERATION_ID_PATTERN.test(operationId))
			throw new Error("Baseline operationId must be 32 lowercase hex digits");
		let durable = this.state.operations.find((operation) => operation.operationId === operationId);
		if (durable && durable.trials !== trials)
			throw new Error("Baseline operationId was reused with another trial count");
		if (durable?.result) {
			return {
				reachedRequestedStage:
					durable.result.terminalStage.mode === nanoGptBaselineStageSequence(trials).at(-1) &&
					durable.result.terminalStage.status === "succeeded" &&
					durable.result.terminalStage.thresholdPassed === true,
				result: durable.result,
			};
		}
		if (!this.state.admissionOpen && !durable) throw new Error("Baseline trajectory admission is closed");
		await verifyNanoGptBaselineWorkspaceFrozen(this.options.workspace);

		if (!durable) {
			const candidatePath = join(this.options.workspace.workspaceDir, "train_gpt_simple.py");
			const candidate = await readFile(candidatePath, "utf8");
			const candidatePatch = await createCandidatePatch(candidatePath);
			const staticEvidence = await this.staticGate(candidatePatch);
			const candidateSha256 = sha256Text(candidate);
			const candidatePatchSha256 = sha256Text(candidatePatch);
			if (
				staticEvidence.candidateSha256 !== candidateSha256 ||
				staticEvidence.patchSha256 !== candidatePatchSha256
			) {
				throw new Error("NanoGPT static gate evidence is not bound to the workspace candidate snapshot");
			}
			const candidateSnapshotPath = join(this.options.stateDir, "candidates", `${candidateSha256}.py`);
			const candidatePatchPath = join(this.options.stateDir, "patches", `${candidatePatchSha256}.patch`);
			await Promise.all([
				installContentAddressed(candidateSnapshotPath, candidate),
				installContentAddressed(candidatePatchPath, candidatePatch),
			]);
			durable = {
				operationId,
				trials,
				acceptedAt: this.now(),
				candidateSha256,
				candidatePatchSha256,
				candidateSnapshotPath,
				candidatePatchPath,
				stageJobIds: {},
				stageEvidence: [],
				result: null,
				failure: null,
			};
			await this.replaceOperation(durable);
		}

		const candidatePatch = await readFile(durable.candidatePatchPath, "utf8");
		if (sha256Text(candidatePatch) !== durable.candidatePatchSha256) {
			throw new Error("Durable NanoGPT candidate patch changed");
		}
		for (const mode of nanoGptBaselineStageSequence(trials)) {
			let evidence: NanoGptBaselineStageEvidence | undefined = durable.stageEvidence.find(
				(stage) => stage.mode === mode,
			);
			if (!evidence) {
				const parent = durable.stageEvidence.at(-1)?.jobId ?? null;
				let jobId: string | undefined = durable.stageJobIds[mode];
				if (!jobId) {
					jobId = await this.options.owner.submitStage({ candidatePatch, mode, parentJobId: parent });
					durable = {
						...durable,
						stageJobIds: { ...durable.stageJobIds, [mode]: jobId },
					};
					await this.replaceOperation(durable);
				}
				evidence = await this.options.owner.waitForStage(jobId);
				durable = { ...durable, stageEvidence: [...durable.stageEvidence, evidence] };
				await this.replaceOperation(durable);
			}
			if (evidence.status !== "succeeded" || (mode !== "smoke-10" && evidence.thresholdPassed !== true)) break;
		}

		const terminalStage = durable.stageEvidence.at(-1);
		if (!terminalStage) throw new Error("Baseline operation produced no terminal stage evidence");
		const logPath = `logs/${operationId}.txt`;
		const log = `${JSON.stringify(
			{
				schemaVersion: 1,
				operationId,
				trials,
				candidateSha256: durable.candidateSha256,
				candidatePatchSha256: durable.candidatePatchSha256,
				stages: durable.stageEvidence,
			},
			null,
			2,
		)}\n`;
		await writeNanoGptBaselineDurableText(join(this.options.workspace.workspaceDir, logPath), log);
		const result: NanoGptBaselineOperationResult = {
			operationId,
			trials,
			candidateSha256: durable.candidateSha256,
			candidatePatchSha256: durable.candidatePatchSha256,
			stages: durable.stageEvidence,
			terminalStage,
			logPath,
			logSha256: sha256Text(log),
		};
		const requestedMode = nanoGptBaselineStageSequence(trials).at(-1);
		const reachedRequestedStage =
			terminalStage.mode === requestedMode &&
			terminalStage.status === "succeeded" &&
			terminalStage.thresholdPassed === true;
		durable = {
			...durable,
			result,
			failure: reachedRequestedStage ? null : `Candidate stopped at ${terminalStage.mode} (${terminalStage.status})`,
		};
		await this.replaceOperation(durable);
		return { reachedRequestedStage, result };
	}

	async verifyLog(logPath: string): Promise<string> {
		if (!/^logs\/[0-9a-f]{32}\.txt$/.test(logPath)) throw new Error("Baseline log path is invalid");
		const operationId = logPath.slice("logs/".length, -".txt".length);
		const result = this.state.operations.find((operation) => operation.operationId === operationId)?.result;
		if (!result || result.logPath !== logPath) throw new Error("Baseline log has no durable terminal operation");
		const source = await readFile(join(this.options.workspace.workspaceDir, logPath), "utf8");
		if (sha256Text(source) !== result.logSha256) throw new Error("Baseline log digest does not match host evidence");
		return `verified ${result.terminalStage.mode} ${result.terminalStage.jobId}`;
	}
}

export interface NanoGptBaselineProxyServerOptions {
	readonly socketPath: string;
	readonly nonce: string;
	readonly proxy: NanoGptBaselineProxy;
}

export class NanoGptBaselineProxyServer {
	private server: Server | null = null;
	private readonly sockets = new Set<Socket>();

	constructor(private readonly options: NanoGptBaselineProxyServerOptions) {
		if (resolve(options.socketPath) !== options.socketPath) throw new Error("Baseline socket path must be absolute");
		if (Buffer.byteLength(options.socketPath) > 100) throw new Error("Baseline Unix socket path exceeds 100 bytes");
		if (!SHA256_PATTERN.test(options.nonce)) throw new Error("Baseline proxy nonce must be 32 random bytes");
	}

	async start(): Promise<void> {
		if (this.server) throw new Error("Baseline proxy server is already started");
		await mkdir(dirname(this.options.socketPath), { recursive: true, mode: 0o700 });
		try {
			const status = await lstat(this.options.socketPath);
			if (!status.isSocket()) throw new Error("Refusing to replace a non-socket baseline IPC path");
			if (await socketIsAcceptingConnections(this.options.socketPath)) {
				throw new Error("Another baseline proxy owner is already listening on the IPC socket");
			}
			await rm(this.options.socketPath, { force: true });
		} catch (error) {
			if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
		}
		const server = createServer((socket) => this.accept(socket));
		this.server = server;
		await new Promise<void>((resolvePromise, reject) => {
			server.once("error", reject);
			server.listen(this.options.socketPath, () => {
				server.off("error", reject);
				resolvePromise();
			});
		});
		await chmod(this.options.socketPath, 0o600);
	}

	async close(options: { readonly destroyConnections?: boolean } = {}): Promise<void> {
		const server = this.server;
		if (!server) return;
		this.server = null;
		if (options.destroyConnections) {
			for (const socket of this.sockets) socket.destroy();
		}
		await new Promise<void>((resolvePromise, reject) => {
			server.close((error) => (error ? reject(error) : resolvePromise()));
		});
		await rm(this.options.socketPath, { force: true });
	}

	private accept(socket: Socket): void {
		this.sockets.add(socket);
		socket.once("close", () => this.sockets.delete(socket));
		let source = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			source += chunk;
			if (Buffer.byteLength(source) > MAX_IPC_REQUEST_BYTES) socket.destroy(new Error("IPC request too large"));
			if (!source.endsWith("\n")) return;
			socket.pause();
			void this.respond(socket, source);
		});
	}

	private async respond(socket: Socket, source: string): Promise<void> {
		try {
			if (source.slice(0, -1).includes("\n")) throw new Error("IPC accepts exactly one request line");
			const request: unknown = JSON.parse(source);
			if (!isRecord(request) || request.schemaVersion !== 1 || typeof request.nonce !== "string") {
				throw new Error("Baseline IPC request schema changed");
			}
			const expected = Buffer.from(this.options.nonce, "utf8");
			const observed = Buffer.from(request.nonce, "utf8");
			if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) {
				throw new Error("Baseline IPC nonce mismatch");
			}
			if (request.kind === "run") {
				if (
					typeof request.operationId !== "string" ||
					(request.trials !== 1 && request.trials !== 3 && request.trials !== 8)
				) {
					throw new Error("Baseline run request is invalid");
				}
				const outcome = await this.options.proxy.run(request.operationId, request.trials);
				if (outcome.reachedRequestedStage) {
					this.send(socket, { ok: true, terminal: true, logPath: outcome.result.logPath });
				} else {
					this.send(socket, {
						ok: false,
						terminal: true,
						error: `candidate stopped at ${outcome.result.terminalStage.mode}`,
					});
				}
				return;
			}
			if (request.kind === "verify" && typeof request.logPath === "string") {
				this.send(socket, { ok: true, summary: await this.options.proxy.verifyLog(request.logPath) });
				return;
			}
			throw new Error("Unknown baseline IPC request kind");
		} catch (error) {
			this.send(socket, {
				ok: false,
				terminal: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private send(socket: Socket, response: unknown): void {
		socket.end(`${JSON.stringify(response)}\n`);
	}
}

function socketIsAcceptingConnections(path: string): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const socket = createConnection(path);
		let settled = false;
		const finish = (result: boolean): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolvePromise(result);
		};
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

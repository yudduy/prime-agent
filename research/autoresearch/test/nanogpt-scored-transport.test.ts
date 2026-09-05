import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { sha256Text } from "../src/canonical-json.js";
import type {
	CompilerGymWarmCommandRequest,
	CompilerGymWarmCommandResult,
} from "../src/compiler-gym-warm-farmshare-backend.js";
import {
	NANOGPT_BASELINE_SHA256,
	NANOGPT_CONTRACT_ID,
	NANOGPT_PROGRAM_SHA256,
	NANOGPT_SPEEDRUN_COMMIT,
} from "../src/nanogpt-contract.js";
import {
	buildNanoGptScoredRequest,
	type NanoGptScoredMode,
	type NanoGptScoredPreviousMode,
	type NanoGptScoredRequest,
	type NanoGptScoredVerifierPins,
	nanoGptScoredBenchmarkIds,
	nanoGptScoredExternalHandle,
	nanoGptScoredStageIdentity,
	nanoGptScoredVerifierEpoch,
} from "../src/nanogpt-scored-protocol.js";
import {
	buildNanoGptScoredJobScript,
	DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
	loadNanoGptScoredVerifierPins,
	NANOGPT_SCORED_DATA_MANIFEST_SHA256,
	NANOGPT_SCORED_DATASET_ROOT,
	NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE,
	NANOGPT_SCORED_ENVIRONMENT_DIR,
	NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
	NANOGPT_SCORED_ENVIRONMENT_SHA256,
	NANOGPT_SCORED_FETCH_TRIAL_LOG_REMOTE,
	NANOGPT_SCORED_POLL_REMOTE,
	NANOGPT_SCORED_PREPARE_REMOTE,
	NANOGPT_SCORED_READINESS_REMOTE,
	NANOGPT_SCORED_REMOTE_ROOT,
	NANOGPT_SCORED_SLURM_TIMES,
	type NanoGptScoredCommandRunner,
	NanoGptScoredReconcileTimeoutError,
	type NanoGptScoredTransportConfig,
	nanoGptScoredRemoteJobDir,
	SshNanoGptScoredTransport,
} from "../src/nanogpt-scored-transport.js";

const ENVIRONMENT_MANIFEST =
	'{"environmentSpecSha256": "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b", "kernelBenchVerifiedCommit": "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e", "numpy": "2.5.2", "pip": "25.2", "python": "3.12.3", "schemaVersion": 1, "torch": "2.11.0+cu128", "torchCuda": "12.8"}\n';
const ENVIRONMENT_SEAL =
	'{"environmentManifestSha256": "71ddfe105be64b7122d7b6d143ea1a6c26a5b9de30cc414a9cbd9df7cd314de8", "environmentSpecSha256": "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b", "pipFreezeSha256": "b85ceb87080994284c997e0ea3742246df1a12d4fc2551a9d8412d87160766d9", "schemaVersion": 1}\n';
const SLURM_JOB_ID = "1704321";
const CANDIDATE_PATCH = "--- a/train_gpt.py\n+++ b/train_gpt.py\n@@ -1 +1 @@\n-old\n+new\n";
const CANDIDATE_SHA256 = sha256Text("materialized-candidate-source");

let temporaryRoot = "";
let datasetManifest = "";
let pins: NanoGptScoredVerifierPins;

function sha256Bytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function ok(stdout: string): CompilerGymWarmCommandResult {
	return { exitCode: 0, stdout, stderr: "", wallMs: 1 };
}

function previousMode(mode: NanoGptScoredMode): NanoGptScoredPreviousMode | null {
	if (mode === "smoke-10") return null;
	if (mode === "score-1") return "smoke-10";
	if (mode === "score-3") return "score-1";
	return "score-3";
}

function request(mode: NanoGptScoredMode = "smoke-10", requestPins = pins): NanoGptScoredRequest {
	const stageIdentity = nanoGptScoredStageIdentity({
		branchId: "branch_scored_transport",
		treatment: "transport-faux",
		verifierEpoch: nanoGptScoredVerifierEpoch(requestPins),
		candidatePatchSha256: sha256Text(CANDIDATE_PATCH),
		candidateSha256: CANDIDATE_SHA256,
	});
	const prior = previousMode(mode);
	return buildNanoGptScoredRequest({
		stageIdentity,
		mode,
		jobId: `job_${mode.replaceAll("-", "_")}`,
		manifestDigest: sha256Text(`manifest-${mode}`),
		branchId: "branch_scored_transport",
		treatment: "transport-faux",
		candidatePatch: {
			digest: sha256Text(CANDIDATE_PATCH),
			byteLength: Buffer.byteLength(CANDIDATE_PATCH),
			mediaType: "text/x-diff",
		},
		staticEvidence: {
			contract: NANOGPT_CONTRACT_ID,
			repositoryCommit: NANOGPT_SPEEDRUN_COMMIT,
			programSha256: NANOGPT_PROGRAM_SHA256,
			evaluatorSha256: requestPins.staticEvaluatorSha256,
			baselineSha256: NANOGPT_BASELINE_SHA256,
			patchSha256: sha256Text(CANDIDATE_PATCH),
			candidateSha256: CANDIDATE_SHA256,
			trainSteps: 3_289,
			frozenSegmentSha256: [0, 1, 2, 3].map((index) => sha256Text(`frozen-${index}`)),
			editableSegmentSha256: [0, 1, 2].map((index) => sha256Text(`editable-${index}`)),
		},
		benchmarkIds: nanoGptScoredBenchmarkIds(mode),
		priorStage:
			prior === null
				? null
				: {
						mode: prior,
						jobId: `job_${prior.replaceAll("-", "_")}`,
						requestDigest: sha256Text(`prior-request-${prior}`),
						resultDigest: sha256Text(`prior-result-${prior}`),
						receiptDigest: sha256Text(`prior-receipt-${prior}`),
					},
		pins: requestPins,
	});
}

interface ResultFixture {
	readonly value: Record<string, unknown>;
	readonly logs: ReadonlyMap<string, Buffer>;
}

function resultFixture(scoredRequest: NanoGptScoredRequest): ResultFixture {
	const logs = new Map<string, Buffer>();
	const trials = scoredRequest.seeds.map((seed, index) => {
		const log = Buffer.from(`trial ${index} seed ${seed}\nvalidation loss 3.2${index}\n`, "utf8");
		logs.set(`trial-${String(index).padStart(3, "0")}.log`, log);
		const started = new Date(Date.UTC(2026, 7, 30, 8, index * 2, 0)).toISOString();
		const finished = new Date(Date.UTC(2026, 7, 30, 8, index * 2 + 1, 0)).toISOString();
		return {
			index,
			seed,
			startedAt: started,
			finishedAt: finished,
			finalValidationLoss: 3.2 + index / 100,
			optimizerSteps: scoredRequest.effectiveTrainSteps,
			peakVramMb: 20_000 + index,
			runtimeMs: 60_000,
			logSha256: sha256Bytes(log),
		};
	});
	return {
		logs,
		value: {
			schemaVersion: 1,
			contract: scoredRequest.contract,
			ok: true,
			requestDigest: scoredRequest.requestDigest,
			externalHandle: nanoGptScoredExternalHandle(scoredRequest.requestDigest),
			slurmJobId: SLURM_JOB_ID,
			mode: scoredRequest.mode,
			candidateSha256: scoredRequest.staticEvidence.candidateSha256,
			trainSteps: scoredRequest.staticEvidence.trainSteps,
			effectiveTrainSteps: scoredRequest.effectiveTrainSteps,
			trials,
			startedAt: "2026-08-30T07:59:00.000Z",
			finishedAt: new Date(Date.UTC(2026, 7, 30, 8, trials.length * 2, 0)).toISOString(),
			hardware: {
				cluster: "Stanford FarmShare",
				gpu: "NVIDIA L40S",
				gpuUuid: "GPU-faux-l40s",
				gpus: 1,
				worldSize: 1,
			},
			execution: {
				trialExecution: "sequential",
				cleanJobDirectory: true,
				freshCandidateMaterialization: true,
				priorMeasurementsReused: false,
			},
			sourceIntegrity: {
				preRunCandidateSha256: scoredRequest.staticEvidence.candidateSha256,
				postRunCandidateSha256: scoredRequest.staticEvidence.candidateSha256,
			},
			pins: scoredRequest.pins,
			failure: null,
		},
	};
}

function readinessSource(): string {
	const manifest = JSON.parse(datasetManifest) as { readonly files: readonly Record<string, unknown>[] };
	return JSON.stringify({
		schemaVersion: 1,
		environmentDirectory: NANOGPT_SCORED_ENVIRONMENT_DIR,
		environmentManifest: ENVIRONMENT_MANIFEST,
		environmentManifestSha256: NANOGPT_SCORED_ENVIRONMENT_SHA256,
		environmentSeal: ENVIRONMENT_SEAL,
		environmentSealSha256: NANOGPT_SCORED_ENVIRONMENT_SEAL_SHA256,
		runtime: {
			python: "3.12.3",
			pip: "25.2",
			torch: "2.11.0+cu128",
			torchCuda: "12.8",
			numpy: "2.5.2",
		},
		executables: {
			python: {
				path: `${NANOGPT_SCORED_ENVIRONMENT_DIR}/bin/python`,
				linkTarget: "python3",
				python3LinkTarget: "/usr/bin/python3",
				resolvedPath: "/usr/bin/python3.12",
				sha256: "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118",
				size: 8_020_928,
			},
			torchrun: {
				path: `${NANOGPT_SCORED_ENVIRONMENT_DIR}/bin/torchrun`,
				sha256: "7ff57f7f5ee11cc74839fda7b12e2a97fd2808dd00ae1eafd05f302df5def748",
				size: 367,
				mode: 0o555,
			},
		},
		datasetDirectory: NANOGPT_SCORED_DATASET_ROOT,
		datasetManifest,
		datasetManifestSha256: NANOGPT_SCORED_DATA_MANIFEST_SHA256,
		dataFiles: manifest.files,
	});
}

function resultPoll(
	fixture: ResultFixture,
	mutateRaw?: (value: Record<string, unknown>) => void,
): Record<string, unknown> {
	const value = structuredClone(fixture.value);
	mutateRaw?.(value);
	const raw = Buffer.from(JSON.stringify(value), "utf8");
	return {
		kind: "result",
		resultBase64: raw.toString("base64"),
		resultByteLength: raw.byteLength,
		resultSha256: sha256Bytes(raw),
		log: "slurm output\n",
		trialLogs: [...fixture.logs].map(([name, bytes]) => ({
			name,
			byteLength: bytes.byteLength,
			sha256: sha256Bytes(bytes),
		})),
		scheduler: {
			slurmJobId: SLURM_JOB_ID,
			jobName: `pngs-${fixture.value.requestDigest?.toString().slice(0, 24)}`,
			workDir: nanoGptScoredRemoteJobDir(fixture.value.requestDigest?.toString() ?? ""),
			state: "COMPLETED",
			exitCode: "0:0",
		},
	};
}

class FauxFarmShare implements NanoGptScoredCommandRunner {
	readonly requests: CompilerGymWarmCommandRequest[] = [];
	readonly preparedPayloads: Record<string, unknown>[] = [];
	readonly pollQueue: Record<string, unknown>[] = [];
	sbatchCount = 0;
	submitted = false;
	tamperResultDigest = false;
	tamperFetchedLog = false;
	schedulerIdentityFailureOnPoll = false;
	abortOnPendingPoll: AbortController | null = null;

	constructor(
		readonly scoredRequest: NanoGptScoredRequest,
		readonly fixture: ResultFixture = resultFixture(scoredRequest),
	) {}

	private remoteCommand(request: CompilerGymWarmCommandRequest): string {
		return request.argv.at(-1) ?? "";
	}

	private remoteSource(remoteCommand: string): string {
		for (const match of remoteCommand.matchAll(/'([A-Za-z0-9+/=]{100,})'/g)) {
			const decoded = Buffer.from(match[1], "base64").toString("utf8");
			if (decoded.includes("import ") || decoded.includes("from ")) return decoded;
		}
		return "";
	}

	async run(command: CompilerGymWarmCommandRequest): Promise<CompilerGymWarmCommandResult> {
		this.requests.push(command);
		const remote = this.remoteCommand(command);
		const source = this.remoteSource(remote);
		if (source.includes("sealed scored environment is missing")) return ok(readinessSource());
		if (source.includes("prepared NanoGPT scored asset set changed")) {
			const payload = JSON.parse(command.input ?? "null") as Record<string, unknown>;
			this.preparedPayloads.push(payload);
			return ok(
				JSON.stringify({
					prepared: nanoGptScoredRemoteJobDir(this.scoredRequest.requestDigest),
					requestDigest: this.scoredRequest.requestDigest,
				}),
			);
		}
		if (source.includes("dispatch-intent.json")) {
			if (!this.submitted) {
				this.submitted = true;
				this.sbatchCount++;
			}
			return ok(JSON.stringify({ kind: "submitted", slurmJobId: SLURM_JOB_ID }));
		}
		if (source.includes("terminal-result-visibility-grace")) {
			if (this.schedulerIdentityFailureOnPoll) {
				return {
					exitCode: 1,
					stdout: "",
					stderr: "NANOGPT_SCHEDULER_IDENTITY: root sacct row escaped the NanoGPT scored job identity\n",
					wallMs: 1,
				};
			}
			const response = this.pollQueue.shift() ?? resultPoll(this.fixture);
			if (this.tamperResultDigest && response.kind === "result") response.resultSha256 = "0".repeat(64);
			if (response.kind === "pending") this.abortOnPendingPoll?.abort(new Error("simulated controller stop"));
			return ok(JSON.stringify(response));
		}
		if (source.includes("unsafe NanoGPT scored trial log name")) {
			const entry = [...this.fixture.logs].find(([name]) => remote.includes(`'${name}'`));
			if (!entry) throw new Error(`Faux runner cannot identify fetched log in: ${remote.slice(-300)}`);
			const [name, original] = entry;
			const bytes = this.tamperFetchedLog ? Buffer.from(`${original.toString("utf8")}tampered`) : original;
			return ok(
				JSON.stringify({
					name,
					byteLength: original.byteLength,
					sha256: sha256Bytes(original),
					contentBase64: bytes.toString("base64"),
				}),
			);
		}
		throw new Error(`Unexpected faux FarmShare command: ${remote.slice(0, 200)}`);
	}
}

function config(evidenceDir: string): NanoGptScoredTransportConfig {
	return {
		...DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG,
		localEvidenceDir: evidenceDir,
		pollIntervalMs: 1,
		commandTimeoutMs: 1_000,
		readinessTimeoutMs: 1_000,
		dispatchVisibilityGraceMs: 1,
		resultVisibilityGraceMs: 1,
		reconcileTimeoutMs: {
			"smoke-10": null,
			"score-1": null,
			"score-3": null,
			"replay-8": null,
		},
	};
}

function commandCount(runner: FauxFarmShare, marker: string): number {
	return runner.requests.filter((item) => {
		const remote = item.argv.at(-1) ?? "";
		return [...remote.matchAll(/'([A-Za-z0-9+/=]{100,})'/g)].some((match) =>
			Buffer.from(match[1], "base64").toString("utf8").includes(marker),
		);
	}).length;
}

before(async () => {
	temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "prime-nanogpt-scored-transport-test-")));
	datasetManifest = await readFile(DEFAULT_NANOGPT_SCORED_TRANSPORT_CONFIG.localDatasetManifestPath, "utf8");
	pins = await loadNanoGptScoredVerifierPins(config(join(temporaryRoot, "pin-load-evidence")));
});

after(async () => {
	await rm(temporaryRoot, { recursive: true, force: true });
});

describe("NanoGPT scored SSH/SLURM transport", () => {
	it("pins one L40S, eight CPUs, 32G, clean environment, and mode-specific FarmShare limits", () => {
		assert.deepEqual(NANOGPT_SCORED_SLURM_TIMES, {
			"smoke-10": "00:30:00",
			"score-1": "06:00:00",
			"score-3": "18:00:00",
			"replay-8": "48:00:00",
		});
		for (const mode of ["smoke-10", "score-1", "score-3", "replay-8"] as const) {
			const source = buildNanoGptScoredJobScript(request(mode), config(join(temporaryRoot, `job-${mode}`)));
			assert.match(source, /#SBATCH --gres=gpu:1/);
			assert.match(source, /#SBATCH --cpus-per-task=8/);
			assert.match(source, /#SBATCH --mem=32G/);
			assert.match(source, new RegExp(`#SBATCH --time=${NANOGPT_SCORED_SLURM_TIMES[mode]}`));
			assert.match(source, /#SBATCH --no-requeue/);
			assert.match(source, /#SBATCH --export=NONE/);
			assert.match(source, /exec env -i/);
			assert.match(source, /\/bin\/python' -I/);
			assert.match(source, /--candidate-patch/);
			assert.match(source, /--trial-log-dir/);
			assert.match(source, /--dataset-root/);
			assert.match(source, /--environment-seal/);
			assert.doesNotMatch(source, /WANDB|TOKEN|API_KEY|SSH_AUTH_SOCK/);
			assert.doesNotMatch(source, /mkdir -p[^\n]*trial-logs/);
		}
		assert.match(NANOGPT_SCORED_POLL_REMOTE, /"sacct", "--noheader", "-X"/);
		assert.match(NANOGPT_SCORED_POLL_REMOTE, /RESULT_VISIBILITY_GRACE/);
		assert.match(NANOGPT_SCORED_POLL_REMOTE, /JobIDRaw,JobName,WorkDir,State,ExitCode/);
		assert.match(NANOGPT_SCORED_PREPARE_REMOTE, /remote_root \/ "jobs" \/ request_digest/);
		assert.match(NANOGPT_SCORED_READINESS_REMOTE, /len\(files\) != 19/);
		assert.match(NANOGPT_SCORED_FETCH_TRIAL_LOG_REMOTE, /bytes changed after result publication/);
		assert.match(NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE, /os\.fsync/);
		assert.match(NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE, /os\.O_NOFOLLOW/);
		assert.match(NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE, /"--no-requeue"/);
		assert.equal(NANOGPT_SCORED_REMOTE_ROOT, "/scratch/users/duynguy/prime-autoresearch/nanogpt/scored-v1");
		for (const [name, source] of [
			["readiness", NANOGPT_SCORED_READINESS_REMOTE],
			["prepare", NANOGPT_SCORED_PREPARE_REMOTE],
			["dispatch", NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE],
			["poll", NANOGPT_SCORED_POLL_REMOTE],
			["fetch-log", NANOGPT_SCORED_FETCH_TRIAL_LOG_REMOTE],
		] as const) {
			const compiled = spawnSync(
				"python3",
				["-I", "-c", "import sys; compile(sys.stdin.read(), '<remote>', 'exec')"],
				{ input: source, encoding: "utf8" },
			);
			assert.equal(compiled.status, 0, `${name} Python syntax failed: ${compiled.stderr}`);
		}
	});

	it("holds a terminal sacct row in result-visibility grace before declaring a missing result", async () => {
		const scoredRequest = request();
		const remoteJobDir = join(temporaryRoot, "terminal-grace-remote");
		const commandDir = join(temporaryRoot, "terminal-grace-bin");
		await mkdir(remoteJobDir, { recursive: true });
		await mkdir(commandDir, { recursive: true });
		await writeFile(join(remoteJobDir, "slurm-job-id"), `${SLURM_JOB_ID}\n`, "utf8");
		const jobName = `pngs-${scoredRequest.requestDigest.slice(0, 24)}`;
		await writeFile(join(commandDir, "squeue"), "#!/bin/sh\nexit 0\n", "utf8");
		await writeFile(
			join(commandDir, "sacct"),
			`#!/bin/sh\nprintf '%s\\n' '${SLURM_JOB_ID}|${jobName}|${remoteJobDir}|COMPLETED|0:0'\n`,
			"utf8",
		);
		await chmod(join(commandDir, "squeue"), 0o700);
		await chmod(join(commandDir, "sacct"), 0o700);
		const environment = { ...process.env, PATH: `${commandDir}:/usr/bin:/bin` };
		const first = spawnSync("python3", ["-I", "-c", NANOGPT_SCORED_POLL_REMOTE, remoteJobDir, jobName, "60"], {
			encoding: "utf8",
			env: environment,
		});
		assert.equal(first.status, 0, first.stderr);
		assert.match(first.stdout, /"kind": "pending"/);
		assert.match(first.stdout, /RESULT_VISIBILITY_GRACE/);
		const afterGrace = spawnSync("python3", ["-I", "-c", NANOGPT_SCORED_POLL_REMOTE, remoteJobDir, jobName, "0"], {
			encoding: "utf8",
			env: environment,
		});
		assert.equal(afterGrace.status, 0, afterGrace.stderr);
		assert.match(afterGrace.stdout, /"kind": "failed"/);
		assert.match(afterGrace.stdout, /COMPLETED\|0:0/);
	});

	it("accepts result bytes only after the exact root sacct row is COMPLETED with ExitCode 0:0", async () => {
		const scoredRequest = request();
		const remoteJobDir = join(temporaryRoot, "authoritative-result-remote");
		const commandDir = join(temporaryRoot, "authoritative-result-bin");
		await mkdir(remoteJobDir, { recursive: true });
		await mkdir(commandDir, { recursive: true });
		await writeFile(join(remoteJobDir, "slurm-job-id"), `${SLURM_JOB_ID}\n`, "utf8");
		await writeFile(join(remoteJobDir, "result.json"), '{"trials":[]}\n', "utf8");
		const jobName = `pngs-${scoredRequest.requestDigest.slice(0, 24)}`;
		await writeFile(
			join(commandDir, "squeue"),
			`#!/bin/sh\nprintf '%s\\n' '${SLURM_JOB_ID}|${jobName}|${remoteJobDir}|RUNNING'\n`,
			"utf8",
		);
		await writeFile(
			join(commandDir, "sacct"),
			`#!/bin/sh\nprintf '%s\\n' '${SLURM_JOB_ID}|${jobName}|${remoteJobDir}|COMPLETED|1:0'\n`,
			"utf8",
		);
		await chmod(join(commandDir, "squeue"), 0o700);
		await chmod(join(commandDir, "sacct"), 0o700);
		const environment = { ...process.env, PATH: `${commandDir}:/usr/bin:/bin` };
		const running = spawnSync("python3", ["-I", "-c", NANOGPT_SCORED_POLL_REMOTE, remoteJobDir, jobName, "0"], {
			encoding: "utf8",
			env: environment,
		});
		assert.equal(running.status, 0, running.stderr);
		assert.match(running.stdout, /"kind": "pending"/);
		assert.match(running.stdout, /"schedulerState": "RUNNING"/);
		assert.doesNotMatch(running.stdout, /"kind": "result"/);

		await writeFile(join(commandDir, "squeue"), "#!/bin/sh\nexit 0\n", "utf8");
		const nonzero = spawnSync("python3", ["-I", "-c", NANOGPT_SCORED_POLL_REMOTE, remoteJobDir, jobName, "0"], {
			encoding: "utf8",
			env: environment,
		});
		assert.equal(nonzero.status, 0, nonzero.stderr);
		assert.match(nonzero.stdout, /"kind": "failed"/);
		assert.match(nonzero.stdout, /refusing any durable result/);
		assert.match(nonzero.stdout, /COMPLETED\|1:0/);

		await writeFile(
			join(commandDir, "sacct"),
			`#!/bin/sh\nprintf '%s\\n' '${SLURM_JOB_ID}|${jobName}|${remoteJobDir}|COMPLETED|0:0'\n`,
			"utf8",
		);
		const completed = spawnSync("python3", ["-I", "-c", NANOGPT_SCORED_POLL_REMOTE, remoteJobDir, jobName, "0"], {
			encoding: "utf8",
			env: environment,
		});
		assert.equal(completed.status, 0, completed.stderr);
		const envelope = JSON.parse(completed.stdout) as Record<string, unknown>;
		assert.equal(envelope.kind, "result");
		assert.deepEqual(envelope.scheduler, {
			slurmJobId: SLURM_JOB_ID,
			jobName,
			workDir: remoteJobDir,
			state: "COMPLETED",
			exitCode: "0:0",
		});
	});

	it("fsyncs the one-attempt dispatch journal and never submits the same digest twice", async () => {
		const requestDigest = "a".repeat(64);
		const remoteRoot = join(temporaryRoot, "dispatch-journal-root");
		const remoteJobDir = join(remoteRoot, "jobs", requestDigest);
		const commandDir = join(temporaryRoot, "dispatch-journal-bin");
		const submitCount = join(temporaryRoot, "dispatch-journal-sbatch-count");
		await mkdir(remoteJobDir, { recursive: true, mode: 0o700 });
		await chmod(remoteJobDir, 0o700);
		await mkdir(commandDir, { recursive: true });
		await writeFile(join(remoteJobDir, "job.sh"), "#!/bin/sh\n", "utf8");
		await writeFile(join(commandDir, "squeue"), "#!/bin/sh\nexit 0\n", "utf8");
		await writeFile(join(commandDir, "sacct"), "#!/bin/sh\nexit 0\n", "utf8");
		await writeFile(
			join(commandDir, "sbatch"),
			`#!/bin/sh\nprintf x >> '${submitCount}'\nprintf '1704999\\n'\n`,
			"utf8",
		);
		for (const command of ["squeue", "sacct", "sbatch"]) await chmod(join(commandDir, command), 0o700);
		const jobName = `pngs-${requestDigest.slice(0, 24)}`;
		const args = [
			"-I",
			"-c",
			NANOGPT_SCORED_ENSURE_SUBMITTED_REMOTE,
			remoteJobDir,
			remoteRoot,
			requestDigest,
			jobName,
			"1",
			"1000",
		];
		const environment = { ...process.env, PATH: `${commandDir}:/usr/bin:/bin` };
		const first = spawnSync("python3", args, { encoding: "utf8", env: environment });
		assert.equal(first.status, 0, first.stderr);
		assert.match(first.stdout, /"slurmJobId": "1704999"/);
		const second = spawnSync("python3", args, { encoding: "utf8", env: environment });
		assert.equal(second.status, 0, second.stderr);
		assert.match(second.stdout, /"slurmJobId": "1704999"/);
		assert.equal(await readFile(submitCount, "utf8"), "x");
		assert.equal(await readFile(join(remoteJobDir, "slurm-job-id"), "utf8"), "1704999\n");
		const intent = JSON.parse(await readFile(join(remoteJobDir, "dispatch-intent.json"), "utf8")) as Record<
			string,
			unknown
		>;
		assert.equal(intent.submissionAttempts, 1);
		assert.equal(intent.requestDigest, requestDigest);
	});

	it("resumes from a handle recorded before remote materialization and submits at most once per digest", async () => {
		const scoredRequest = request();
		const runner = new FauxFarmShare(scoredRequest);
		runner.pollQueue.push({ kind: "pending", schedulerState: "RESULT_VISIBILITY_GRACE:COMPLETED|0:0" });
		const transport = new SshNanoGptScoredTransport(config(join(temporaryRoot, "resume-first")), {
			commandRunner: runner,
		});
		const first = await transport.resume(
			scoredRequest,
			CANDIDATE_PATCH,
			nanoGptScoredExternalHandle(scoredRequest.requestDigest),
			new AbortController().signal,
		);
		assert.equal(first.requestDigest, scoredRequest.requestDigest);
		assert.equal(first.scheduler.state, "COMPLETED");
		assert.equal(first.scheduler.exitCode, "0:0");
		assert.equal(first.workerResult.requestDigest, scoredRequest.requestDigest);
		assert.equal(first.jobScriptSha256.length, 64);
		assert.equal(first.archive.manifestSha256, sha256Text(first.archive.canonicalManifest));
		assert.equal(commandCount(runner, "prepared NanoGPT scored asset set changed"), 1);
		assert.equal(commandCount(runner, "dispatch-intent.json"), 1);
		assert.equal(runner.sbatchCount, 1);
		const second = await transport.execute(scoredRequest, CANDIDATE_PATCH, new AbortController().signal);
		assert.deepEqual(second, first);
		assert.equal(runner.sbatchCount, 1);
		assert.equal(runner.preparedPayloads.length, 2);
		assert.deepEqual(runner.preparedPayloads[1], runner.preparedPayloads[0]);
		const prepared = runner.preparedPayloads[0] as { readonly files: readonly { readonly path: string }[] };
		assert.deepEqual(prepared.files.map((asset) => asset.path).sort(), [
			"candidate.patch",
			"dataset-manifest.json",
			"environment-seal.json",
			"environment.json",
			"job.sh",
			"nanogpt_contract.py",
			"request.json",
			"train_gpt_simple.py",
			"worker.py",
		]);
		assert.equal(
			nanoGptScoredRemoteJobDir(scoredRequest.requestDigest),
			`${NANOGPT_SCORED_REMOTE_ROOT}/jobs/${scoredRequest.requestDigest}`,
		);
	});

	it("verifies result bytes and protocol request binding before accepting them", async () => {
		const scoredRequest = request();
		const digestRunner = new FauxFarmShare(scoredRequest);
		digestRunner.tamperResultDigest = true;
		const digestTransport = new SshNanoGptScoredTransport(config(join(temporaryRoot, "result-digest")), {
			commandRunner: digestRunner,
		});
		await assert.rejects(
			digestTransport.execute(scoredRequest, CANDIDATE_PATCH, new AbortController().signal),
			/fetched NanoGPT scored result bytes failed/i,
		);

		const bindingRunner = new FauxFarmShare(scoredRequest);
		bindingRunner.pollQueue.push(
			resultPoll(bindingRunner.fixture, (value) => {
				value.requestDigest = "0".repeat(64);
			}),
		);
		const bindingTransport = new SshNanoGptScoredTransport(config(join(temporaryRoot, "result-binding")), {
			commandRunner: bindingRunner,
		});
		await assert.rejects(
			bindingTransport.execute(scoredRequest, CANDIDATE_PATCH, new AbortController().signal),
			/not bound to the exact request/,
		);
	});

	it("fetches, verifies, and atomically archives every per-trial log by request and log digest", async () => {
		const scoredRequest = request("score-3");
		const baseFixture = resultFixture(scoredRequest);
		const auxiliaryLog = Buffer.from("raw subprocess stdout\n", "utf8");
		const fixture: ResultFixture = {
			value: baseFixture.value,
			logs: new Map([...baseFixture.logs, ["trial-000.stdout.log", auxiliaryLog]]),
		};
		const runner = new FauxFarmShare(scoredRequest, fixture);
		const evidenceDir = join(temporaryRoot, "archive-success");
		const transport = new SshNanoGptScoredTransport(config(evidenceDir), { commandRunner: runner });
		await transport.execute(scoredRequest, CANDIDATE_PATCH, new AbortController().signal);
		const archived = await transport.readArchivedTrialLogs(scoredRequest.requestDigest);
		assert.equal(archived.length, 4);
		for (const item of archived) {
			const bytes = await readFile(item.path);
			assert.equal(bytes.byteLength, item.byteLength);
			assert.equal(sha256Bytes(bytes), item.logSha256);
			assert.match(item.path, new RegExp(`${scoredRequest.requestDigest}/logs/${item.logSha256}\\.log$`));
		}
		assert.equal(commandCount(runner, "unsafe NanoGPT scored trial log name"), 4);
	});

	it("rejects missing or changed trial-log bytes instead of persisting hash-only evidence", async () => {
		const scoredRequest = request();
		const missingRunner = new FauxFarmShare(scoredRequest);
		const missingPoll = resultPoll(missingRunner.fixture);
		missingPoll.trialLogs = [];
		missingRunner.pollQueue.push(missingPoll);
		const missingTransport = new SshNanoGptScoredTransport(config(join(temporaryRoot, "missing-log")), {
			commandRunner: missingRunner,
		});
		await assert.rejects(
			missingTransport.execute(scoredRequest, CANDIDATE_PATCH, new AbortController().signal),
			/missing or changed per-trial log/,
		);

		const tamperRunner = new FauxFarmShare(scoredRequest);
		tamperRunner.tamperFetchedLog = true;
		const tamperTransport = new SshNanoGptScoredTransport(config(join(temporaryRoot, "tampered-log")), {
			commandRunner: tamperRunner,
		});
		await assert.rejects(
			tamperTransport.execute(scoredRequest, CANDIDATE_PATCH, new AbortController().signal),
			/trial-log bytes failed SHA-256 or length verification/,
		);
	});

	it("leaves pending work resumable on abort and has no aggregate production deadline", async () => {
		const scoredRequest = request();
		const runner = new FauxFarmShare(scoredRequest);
		const controller = new AbortController();
		runner.abortOnPendingPoll = controller;
		runner.pollQueue.push({ kind: "pending", schedulerState: "PENDING" });
		const transportConfig = config(join(temporaryRoot, "abort-resume"));
		assert.deepEqual(transportConfig.reconcileTimeoutMs, {
			"smoke-10": null,
			"score-1": null,
			"score-3": null,
			"replay-8": null,
		});
		const transport = new SshNanoGptScoredTransport(transportConfig, { commandRunner: runner });
		await assert.rejects(transport.execute(scoredRequest, CANDIDATE_PATCH, controller.signal), (error) => {
			assert.ok(!(error instanceof NanoGptScoredReconcileTimeoutError));
			return /simulated controller stop/.test(String(error));
		});
		assert.equal(runner.sbatchCount, 1);
		assert.equal(
			runner.requests.some((item) => /scancel/.test(item.argv.at(-1) ?? "")),
			false,
		);
		const resumed = await transport.resume(
			scoredRequest,
			CANDIDATE_PATCH,
			nanoGptScoredExternalHandle(scoredRequest.requestDigest),
			new AbortController().signal,
		);
		assert.equal(resumed.scheduler.slurmJobId, SLURM_JOB_ID);
		assert.equal(runner.sbatchCount, 1);
	});

	it("does not retry deterministic scheduler-identity violations", async () => {
		const scoredRequest = request();
		const runner = new FauxFarmShare(scoredRequest);
		runner.schedulerIdentityFailureOnPoll = true;
		const transportConfig = config(join(temporaryRoot, "scheduler-identity"));
		const transport = new SshNanoGptScoredTransport(
			{
				...transportConfig,
				reconcileTimeoutMs: { ...transportConfig.reconcileTimeoutMs, "smoke-10": 20 },
			},
			{ commandRunner: runner },
		);
		await assert.rejects(
			transport.execute(scoredRequest, CANDIDATE_PATCH, new AbortController().signal),
			/NANOGPT_SCHEDULER_IDENTITY/,
		);
		assert.equal(commandCount(runner, "terminal-result-visibility-grace"), 1);
	});

	it("rejects a symlink in any local evidence ancestor before reading or writing archives", async () => {
		const scoredRequest = request();
		const target = join(temporaryRoot, "evidence-symlink-target");
		const evidenceDir = join(temporaryRoot, "evidence-symlink");
		await mkdir(target, { recursive: true });
		await symlink(target, evidenceDir, "dir");
		const transport = new SshNanoGptScoredTransport(config(evidenceDir), {
			commandRunner: new FauxFarmShare(scoredRequest),
		});
		await assert.rejects(
			transport.readArchivedTrialLogs(scoredRequest.requestDigest),
			/evidence ancestor is not a regular directory/,
		);
	});

	it("fails closed on local pin drift and foreign durable handles before dispatch", async () => {
		const wrongPins = { ...pins, environmentSha256: sha256Text("wrong environment") };
		const wrongRequest = request("smoke-10", wrongPins);
		const pinRunner = new FauxFarmShare(wrongRequest);
		const transport = new SshNanoGptScoredTransport(config(join(temporaryRoot, "pin-drift")), {
			commandRunner: pinRunner,
		});
		await assert.rejects(
			transport.execute(wrongRequest, CANDIDATE_PATCH, new AbortController().signal),
			/environment pin is not the exact sealed environment manifest/,
		);
		assert.equal(pinRunner.requests.length, 0);

		const scoredRequest = request();
		const handleRunner = new FauxFarmShare(scoredRequest);
		const handleTransport = new SshNanoGptScoredTransport(config(join(temporaryRoot, "handle-drift")), {
			commandRunner: handleRunner,
		});
		await assert.rejects(
			handleTransport.resume(
				scoredRequest,
				CANDIDATE_PATCH,
				nanoGptScoredExternalHandle("f".repeat(64)),
				new AbortController().signal,
			),
			/does not belong to this exact request digest/,
		);
		assert.equal(handleRunner.requests.length, 0);
	});
});

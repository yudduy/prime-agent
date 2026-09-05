import { execFile } from "node:child_process";
import { access, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalJson, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import {
	type CompilerGymWarmCommandRunner,
	compilerGymWarmSshArgv,
	DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG,
	FarmShareCompilerGymWarmBackend,
	SpawnCompilerGymWarmCommandRunner,
} from "./compiler-gym-warm-farmshare-backend.js";
import {
	type CompilerGymWarmPilotResult,
	createCompilerGymWarmPilotProcessSignalScope,
	runCompilerGymWarmPilotBlock,
} from "./compiler-gym-warm-pilot.js";
import { createFarmShareCompilerGymWarmPilotRecordEvidenceProvider } from "./compiler-gym-warm-pilot-record-evidence.js";
import {
	COMPILER_GYM_WARM_LAUNCH_CONTRACT,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
	COMPILER_GYM_WARM_TASKS,
	ProtocolCompilerGymWarmTransport,
} from "./compiler-gym-warm-transport.js";
import { EvidenceLedger, verifyLedgerContentsStrict } from "./ledger.js";

const execFileAsync = promisify(execFile);
const MODULE_PATH = fileURLToPath(import.meta.url);
const ENVIRONMENT_PROBE_PATH = fileURLToPath(new URL("../evaluators/compiler_gym_env_probe.py", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_PREREGISTRATION_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/compiler-gym-warm-reuse-pilot/preregistration-v1.json",
);
const DEFAULT_RUNTIME_MANIFEST_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/compiler-gym-warm-reuse-pilot/runtime-manifest-v1.json",
);
const DEFAULT_OUTPUT_ROOT = join(REPOSITORY_ROOT, ".autoresearch/compiler-gym-warm-reuse-pilot/execution-v6");
const REMOTE_ENVIRONMENT_PROBE_PROTOCOL = "compiler-gym-farmshare-environment-probe-v1" as const;
const REMOTE_UTILITY_PATHS = [
	"/usr/bin/env",
	"/usr/bin/sbatch",
	"/usr/bin/sacct",
	"/usr/bin/scancel",
	"/usr/bin/scontrol",
	"/usr/bin/squeue",
	"/usr/bin/srun",
	"/usr/bin/sleep",
	"/usr/bin/python3",
	"/usr/bin/test",
] as const;

export type CompilerGymAllocationReuseArm = "fresh-allocation-control" | "persistent-allocation-treatment";

export interface FrozenCompilerGymCandidate {
	id: string;
	sha256: string;
	actions: string[];
	expected: Record<(typeof COMPILER_GYM_WARM_TASKS)[number], { irInstructions: number; objectTextBytes: number }>;
}

export interface CompilerGymAllocationRunSpec {
	allocationId: string;
	arm: CompilerGymAllocationReuseArm;
	branchId: string;
	candidates: readonly FrozenCompilerGymCandidate[];
}

export interface CompilerGymAllocationObservation {
	allocationId: string;
	arm: CompilerGymAllocationReuseArm;
	result: CompilerGymWarmPilotResult;
}

export type CompilerGymAllocationRunner = (
	spec: CompilerGymAllocationRunSpec,
) => Promise<CompilerGymAllocationObservation>;

export interface CompilerGymAllocationArmObservation {
	arm: CompilerGymAllocationReuseArm;
	allocations: CompilerGymAllocationObservation[];
	trials: CompilerGymWarmPilotResult["trials"];
	armOperational: {
		clockId: "host-monotonic-v1";
		source: "process.hrtime.bigint";
		startedNs: string;
		finishedNs: string;
		durationNs: string;
	};
	candidateWallSumNs: string;
	allocationOperationalSumNs: string;
	acquisitionSumNs: string;
	rootCpuTimeRawSeconds: number;
}

export interface CompilerGymAllocationPair {
	candidateDigest: string;
	controlDurationNs: string;
	treatmentDurationNs: string;
	savingNs: string;
	fractionalSaving: number;
	treatmentWon: boolean;
	treatmentMoreThanTenPercentSlower: boolean;
}

export interface CompilerGymAllocationMatchedBlockAnalysis {
	blockId: string;
	candidateOrder: string[];
	control: CompilerGymAllocationArmObservation;
	treatment: CompilerGymAllocationArmObservation;
	pairs: CompilerGymAllocationPair[];
	treatmentWins: number;
	treatmentCandidateWallSumLower: boolean;
	treatmentArmOperationalLower: boolean;
	anyTreatmentMoreThanTenPercentSlower: boolean;
	integrityPassed: true;
	b1Kill: boolean;
}

interface PreregisteredCandidate {
	id: string;
	sha256: string;
	actionCount: number;
	expected: {
		blowfish: { irInstructions: number; objectTextBytes: number };
		bzip2: { irInstructions: number; objectTextBytes: number };
	};
}

interface PreregisteredBlock {
	id: string;
	armOrder: CompilerGymAllocationReuseArm[];
	candidateOrder: string[];
}

interface CompilerGymAllocationReusePreregistration {
	schemaVersion: 1;
	campaign: string;
	status: string;
	executionEpoch: string;
	pins: Record<string, string>;
	candidates: PreregisteredCandidate[];
	smoke: {
		candidateOrder: string[];
		armOrder: CompilerGymAllocationReuseArm[];
		requiredCandidateEvaluations: number;
		requiredFreshTaskEvaluations: number;
		requiredRootAllocations: number;
	};
	main: {
		blocks: PreregisteredBlock[];
		requiredCandidateEvaluations: number;
		requiredFreshTaskEvaluations: number;
		requiredRootAllocations: number;
	};
}

export interface CompilerGymAllocationReuseLocalPreflight {
	preregistration: CompilerGymAllocationReusePreregistration;
	preregistrationPath: string;
	preregistrationSha256: string;
	runtimeManifestPath: string;
	runtimeManifestSha256: string;
	sourceLedgerEventCount: number;
	sourceLedgerTerminalEventSha256: string;
	driverSha256: string;
	candidates: FrozenCompilerGymCandidate[];
}

interface CompilerGymAllocationReuseRuntimeManifest {
	protocol: "compiler-gym-allocation-reuse-runtime-manifest-v1";
	sealedAt: string;
	preregistrationSha256: string;
	launchContractSha256: string;
	verifierEpoch: string;
	files: Array<{ path: string; sha256: string }>;
}

export interface CompilerGymAllocationReuseRemoteObservation {
	label: string;
	argv: string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	stdoutSha256: string;
	stderrSha256: string;
	wallMs: number;
}

export interface CompilerGymAllocationReuseRemotePreflight {
	protocol: "compiler-gym-allocation-reuse-remote-preflight-v1";
	capturedAt: string;
	host: string;
	user: string;
	pass: boolean;
	observations: CompilerGymAllocationReuseRemoteObservation[];
	failure: string | null;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function requiredSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new Error(`${label} must be a non-negative safe integer`);
	return Number(value);
}

function parseArm(value: unknown, label: string): CompilerGymAllocationReuseArm {
	if (value !== "fresh-allocation-control" && value !== "persistent-allocation-treatment") {
		throw new Error(`${label} is not a registered allocation arm`);
	}
	return value;
}

function parseStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		throw new Error(`${label} must be a string array`);
	}
	return [...value];
}

function parseExpectedMetric(value: unknown, label: string): { irInstructions: number; objectTextBytes: number } {
	const record = objectRecord(value, label);
	return {
		irInstructions: requiredSafeInteger(record.irInstructions, `${label}.irInstructions`),
		objectTextBytes: requiredSafeInteger(record.objectTextBytes, `${label}.objectTextBytes`),
	};
}

function parsePreregistration(value: unknown): CompilerGymAllocationReusePreregistration {
	const root = objectRecord(value, "preregistration");
	if (root.schemaVersion !== 1) throw new Error("Unsupported allocation-reuse preregistration schema");
	const pinsInput = objectRecord(root.pins, "preregistration.pins");
	const pins: Record<string, string> = {};
	for (const [key, item] of Object.entries(pinsInput)) pins[key] = requiredString(item, `pins.${key}`);
	if (!Array.isArray(root.candidates) || root.candidates.length !== 4) {
		throw new Error("The allocation-reuse preregistration must pin four candidates");
	}
	const candidates = root.candidates.map((candidate, index): PreregisteredCandidate => {
		const record = objectRecord(candidate, `candidates[${index}]`);
		const expected = objectRecord(record.expected, `candidates[${index}].expected`);
		return {
			id: requiredString(record.id, `candidates[${index}].id`),
			sha256: requiredString(record.sha256, `candidates[${index}].sha256`),
			actionCount: requiredSafeInteger(record.actionCount, `candidates[${index}].actionCount`),
			expected: {
				blowfish: parseExpectedMetric(expected.blowfish, `candidates[${index}].expected.blowfish`),
				bzip2: parseExpectedMetric(expected.bzip2, `candidates[${index}].expected.bzip2`),
			},
		};
	});
	const smoke = objectRecord(root.smoke, "preregistration.smoke");
	const main = objectRecord(root.main, "preregistration.main");
	if (!Array.isArray(main.blocks) || main.blocks.length !== 2) throw new Error("Main phase must contain two blocks");
	return {
		schemaVersion: 1,
		campaign: requiredString(root.campaign, "preregistration.campaign"),
		status: requiredString(root.status, "preregistration.status"),
		executionEpoch: requiredString(root.executionEpoch, "preregistration.executionEpoch"),
		pins,
		candidates,
		smoke: {
			candidateOrder: parseStringArray(smoke.candidateOrder, "smoke.candidateOrder"),
			armOrder: parseStringArray(smoke.armOrder, "smoke.armOrder").map((arm, index) =>
				parseArm(arm, `smoke.armOrder[${index}]`),
			),
			requiredCandidateEvaluations: requiredSafeInteger(
				smoke.requiredCandidateEvaluations,
				"smoke.requiredCandidateEvaluations",
			),
			requiredFreshTaskEvaluations: requiredSafeInteger(
				smoke.requiredFreshTaskEvaluations,
				"smoke.requiredFreshTaskEvaluations",
			),
			requiredRootAllocations: requiredSafeInteger(smoke.requiredRootAllocations, "smoke.requiredRootAllocations"),
		},
		main: {
			blocks: main.blocks.map((block, index): PreregisteredBlock => {
				const record = objectRecord(block, `main.blocks[${index}]`);
				return {
					id: requiredString(record.id, `main.blocks[${index}].id`),
					armOrder: parseStringArray(record.armOrder, `main.blocks[${index}].armOrder`).map((arm, armIndex) =>
						parseArm(arm, `main.blocks[${index}].armOrder[${armIndex}]`),
					),
					candidateOrder: parseStringArray(record.candidateOrder, `main.blocks[${index}].candidateOrder`),
				};
			}),
			requiredCandidateEvaluations: requiredSafeInteger(
				main.requiredCandidateEvaluations,
				"main.requiredCandidateEvaluations",
			),
			requiredFreshTaskEvaluations: requiredSafeInteger(
				main.requiredFreshTaskEvaluations,
				"main.requiredFreshTaskEvaluations",
			),
			requiredRootAllocations: requiredSafeInteger(main.requiredRootAllocations, "main.requiredRootAllocations"),
		},
	};
}

function parseRuntimeManifest(value: unknown): CompilerGymAllocationReuseRuntimeManifest {
	const root = objectRecord(value, "runtime manifest");
	if (root.protocol !== "compiler-gym-allocation-reuse-runtime-manifest-v1") {
		throw new Error("Unsupported allocation-reuse runtime manifest protocol");
	}
	const sealedAt = requiredString(root.sealedAt, "runtimeManifest.sealedAt");
	if (!Number.isFinite(Date.parse(sealedAt))) throw new Error("runtimeManifest.sealedAt is not an ISO timestamp");
	if (!Array.isArray(root.files) || root.files.length < 1) throw new Error("Runtime manifest has no sealed files");
	const files = root.files.map((value, index) => {
		const record = objectRecord(value, `runtimeManifest.files[${index}]`);
		const path = requiredString(record.path, `runtimeManifest.files[${index}].path`);
		const sha256 = requiredString(record.sha256, `runtimeManifest.files[${index}].sha256`);
		if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`Unsafe sealed runtime path ${path}`);
		if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Invalid sealed runtime digest for ${path}`);
		return { path, sha256 };
	});
	if (new Set(files.map((file) => file.path)).size !== files.length) {
		throw new Error("Runtime manifest repeats a sealed file path");
	}
	return {
		protocol: root.protocol,
		sealedAt,
		preregistrationSha256: requiredString(root.preregistrationSha256, "runtimeManifest.preregistrationSha256"),
		launchContractSha256: requiredString(root.launchContractSha256, "runtimeManifest.launchContractSha256"),
		verifierEpoch: requiredString(root.verifierEpoch, "runtimeManifest.verifierEpoch"),
		files,
	};
}

function artifactPathForDigest(sourceLedgerPath: string, digest: string): string {
	if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`Invalid candidate artifact digest ${digest}`);
	return join(dirname(sourceLedgerPath), "artifacts", "sha256", digest.slice(0, 2), digest.slice(2));
}

function sourceFilePins(preregistration: CompilerGymAllocationReusePreregistration): Array<{
	label: string;
	path: string;
	expected: string;
}> {
	return [
		{
			label: "worker",
			path: join(REPOSITORY_ROOT, "research/autoresearch/evaluators/compiler_gym_warm_worker.py"),
			expected: preregistration.pins.workerSha256,
		},
		{
			label: "evaluator",
			path: join(REPOSITORY_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py"),
			expected: preregistration.pins.evaluatorSha256,
		},
		{
			label: "environment probe",
			path: join(REPOSITORY_ROOT, "research/autoresearch/evaluators/compiler_gym_env_probe.py"),
			expected: preregistration.pins.environmentProbeSha256,
		},
		{
			label: "environment requirements",
			path: join(REPOSITORY_ROOT, "research/autoresearch/environments/compiler-gym-farmshare-v2.requirements.txt"),
			expected: preregistration.pins.environmentRequirementsSha256,
		},
		{
			label: "dataset bootstrap",
			path: join(REPOSITORY_ROOT, "research/autoresearch/evaluators/compiler_gym_dataset_bootstrap.py"),
			expected: preregistration.pins.datasetBootstrapSha256,
		},
		{
			label: "site-data lock",
			path: join(REPOSITORY_ROOT, "research/autoresearch/environments/compiler-gym-site-data-v2.lock"),
			expected: preregistration.pins.siteDataLockSha256,
		},
		{
			label: "warm transport",
			path: join(REPOSITORY_ROOT, "research/autoresearch/src/compiler-gym-warm-transport.ts"),
			expected: preregistration.pins.warmTransportSourceSha256,
		},
		{
			label: "warm backend",
			path: join(REPOSITORY_ROOT, "research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts"),
			expected: preregistration.pins.warmBackendSourceSha256,
		},
		{
			label: "warm pilot",
			path: join(REPOSITORY_ROOT, "research/autoresearch/src/compiler-gym-warm-pilot.ts"),
			expected: preregistration.pins.warmPilotSourceSha256,
		},
	];
}

function taskMetricFromLedger(
	measurement: Record<string, unknown>,
	benchmarkId: (typeof COMPILER_GYM_WARM_TASKS)[number],
): { irInstructions: number; objectTextBytes: number } {
	if (!Array.isArray(measurement.tasks)) throw new Error("Pinned measurement tasks are missing");
	const task = measurement.tasks
		.map((value, index) => objectRecord(value, `measurement.tasks[${index}]`))
		.find((value) => value.benchmarkId === benchmarkId);
	if (!task) throw new Error(`Pinned measurement is missing ${benchmarkId}`);
	const verifier = objectRecord(task.verifier, `measurement ${benchmarkId} verifier`);
	if (task.status !== "accepted" || verifier.passed !== true) {
		throw new Error(`Pinned measurement for ${benchmarkId} is not verifier-accepted`);
	}
	const metrics = objectRecord(task.metrics, `measurement ${benchmarkId} metrics`);
	return {
		irInstructions: requiredSafeInteger(metrics.IrInstructionCount, `${benchmarkId}.IrInstructionCount`),
		objectTextBytes: requiredSafeInteger(metrics.ObjectTextSizeBytes, `${benchmarkId}.ObjectTextSizeBytes`),
	};
}

export async function loadCompilerGymAllocationReuseLocalPreflight(
	preregistrationPath = DEFAULT_PREREGISTRATION_PATH,
	runtimeManifestPath = DEFAULT_RUNTIME_MANIFEST_PATH,
): Promise<CompilerGymAllocationReuseLocalPreflight> {
	const preregistrationContents = await readFile(preregistrationPath, "utf8");
	const preregistration = parsePreregistration(JSON.parse(preregistrationContents));
	const preregistrationSha256 = sha256Text(preregistrationContents);
	if (preregistration.status !== "preregistered-before-dispatch") {
		throw new Error("Allocation-reuse experiment is not sealed as preregistered-before-dispatch");
	}
	if (preregistration.pins.evaluatorSha256 !== COMPILER_GYM_EVALUATOR_SHA256) {
		throw new Error("Preregistered evaluator hash differs from the active strict verifier epoch");
	}
	const runtimeManifestContents = await readFile(runtimeManifestPath, "utf8");
	const runtimeManifest = parseRuntimeManifest(JSON.parse(runtimeManifestContents));
	if (runtimeManifest.preregistrationSha256 !== preregistrationSha256) {
		throw new Error("Runtime manifest does not bind the active preregistration bytes");
	}
	if (runtimeManifest.launchContractSha256 !== COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256) {
		throw new Error("Runtime manifest launch contract differs from the compiled allocation contract");
	}
	if (runtimeManifest.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		throw new Error("Runtime manifest verifier epoch differs from the compiled strict verifier");
	}
	for (const file of runtimeManifest.files) {
		const observed = sha256Text(await readFile(join(REPOSITORY_ROOT, file.path), "utf8"));
		if (observed !== file.sha256) throw new Error(`Sealed runtime file drifted: ${file.path}`);
	}
	for (const pin of sourceFilePins(preregistration)) {
		const observed = sha256Text(await readFile(pin.path, "utf8"));
		if (observed !== pin.expected) throw new Error(`${pin.label} source hash drifted: ${observed}`);
	}
	const { stdout: commitStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT });
	if (commitStdout.trim() !== preregistration.pins.primeAgentCommit) {
		throw new Error(`Prime Agent commit drifted from ${preregistration.pins.primeAgentCommit}`);
	}
	const sourceLedgerPath = join(REPOSITORY_ROOT, preregistration.pins.sourceLedger);
	const sourceLedgerContents = await readFile(sourceLedgerPath, "utf8");
	if (sha256Text(sourceLedgerContents) !== preregistration.pins.sourceLedgerSha256) {
		throw new Error("Pinned source ledger bytes drifted");
	}
	const events = verifyLedgerContentsStrict(sourceLedgerContents);
	if (events.at(-1)?.hash !== preregistration.pins.sourceLedgerTerminalEventSha256) {
		throw new Error("Pinned source ledger terminal event drifted");
	}
	const proposals = events.filter((event) => event.kind === "proposal");
	const measurements = events.filter((event) => event.kind === "measurement");
	if (proposals.length !== 4 || measurements.length !== 4) {
		throw new Error("Pinned source ledger must contain exactly four proposals and four measurements");
	}
	const candidates: FrozenCompilerGymCandidate[] = [];
	for (const [index, pinned] of preregistration.candidates.entries()) {
		const proposal = objectRecord(proposals[index]?.payload, `proposal[${index}]`);
		const candidateRef = objectRecord(proposal.candidate, `proposal[${index}].candidate`);
		if (candidateRef.digest !== pinned.sha256) throw new Error(`Pinned ${pinned.id} proposal digest drifted`);
		const manifestDigest = requiredString(proposal.manifestDigest, `proposal[${index}].manifestDigest`);
		const measurement = objectRecord(measurements[index]?.payload, `measurement[${index}]`);
		if (measurement.manifestDigest !== manifestDigest)
			throw new Error(`Pinned ${pinned.id} measurement route drifted`);
		const artifactContents = await readFile(artifactPathForDigest(sourceLedgerPath, pinned.sha256), "utf8");
		if (sha256Text(artifactContents) !== pinned.sha256) throw new Error(`Pinned ${pinned.id} artifact hash drifted`);
		const actionsValue: unknown = JSON.parse(artifactContents);
		if (!Array.isArray(actionsValue) || !actionsValue.every((action) => typeof action === "string")) {
			throw new Error(`Pinned ${pinned.id} artifact is not a string action array`);
		}
		const actions = [...actionsValue];
		if (actions.length !== pinned.actionCount) throw new Error(`Pinned ${pinned.id} action count drifted`);
		const expected = {
			[COMPILER_GYM_WARM_TASKS[0]]: { ...pinned.expected.blowfish },
			[COMPILER_GYM_WARM_TASKS[1]]: { ...pinned.expected.bzip2 },
		};
		for (const benchmarkId of COMPILER_GYM_WARM_TASKS) {
			const observed = taskMetricFromLedger(measurement, benchmarkId);
			if (
				observed.irInstructions !== expected[benchmarkId].irInstructions ||
				observed.objectTextBytes !== expected[benchmarkId].objectTextBytes
			) {
				throw new Error(`Pinned ${pinned.id} ${benchmarkId} metric vector drifted`);
			}
		}
		candidates.push({ id: pinned.id, sha256: pinned.sha256, actions, expected });
	}
	return {
		preregistration,
		preregistrationPath,
		preregistrationSha256,
		runtimeManifestPath,
		runtimeManifestSha256: sha256Text(runtimeManifestContents),
		sourceLedgerEventCount: events.length,
		sourceLedgerTerminalEventSha256: events.at(-1)?.hash ?? "",
		driverSha256: sha256Text(await readFile(MODULE_PATH, "utf8")),
		candidates,
	};
}

function bigintInterval(startedNs: string, finishedNs: string): CompilerGymAllocationArmObservation["armOperational"] {
	const started = BigInt(startedNs);
	const finished = BigInt(finishedNs);
	if (finished <= started) throw new Error("Allocation-reuse arm interval did not strictly increase");
	return {
		clockId: "host-monotonic-v1",
		source: "process.hrtime.bigint",
		startedNs,
		finishedNs,
		durationNs: (finished - started).toString(10),
	};
}

function sumDecimalBigints(values: readonly string[]): string {
	return values.reduce((sum, value) => sum + BigInt(value), 0n).toString(10);
}

export function compilerGymAllocationReuseExecutionNamespace(
	runtimeManifestSha256: string,
	executionEpoch: string,
	outputRoot: string,
): string {
	if (!/^[0-9a-f]{64}$/.test(runtimeManifestSha256)) {
		throw new Error("Allocation-reuse runtime manifest digest must be a SHA-256 digest");
	}
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(executionEpoch)) {
		throw new Error("Allocation-reuse execution epoch must be a lowercase route segment");
	}
	return sha256Text(
		canonicalJson({
			protocol: "compiler-gym-allocation-reuse-execution-namespace-v1",
			runtimeManifestSha256,
			executionEpoch,
			outputRoot: resolve(outputRoot),
		}),
	);
}

function assertAllocationObservation(
	observation: CompilerGymAllocationObservation,
	spec: CompilerGymAllocationRunSpec,
): void {
	if (observation.allocationId !== spec.allocationId || observation.arm !== spec.arm) {
		throw new Error("Allocation runner returned the wrong immutable route");
	}
	if (observation.result.outcome !== "succeeded") throw new Error(`${spec.allocationId} did not succeed`);
	if (observation.result.trials.length !== spec.candidates.length) {
		throw new Error(`${spec.allocationId} returned the wrong candidate count`);
	}
	if (observation.result.blockRecord.slurmId !== observation.result.cleanup.slurmId) {
		throw new Error(`${spec.allocationId} cleanup identity drifted`);
	}
	const cleanup = observation.result.cleanup;
	const recordCleanup = observation.result.recordEvidence.cleanup;
	const blockCleanup = observation.result.blockRecord.cleanup;
	const accounting = observation.result.recordEvidence.accounting;
	const blockAccounting = observation.result.blockRecord.accounting;
	if (
		cleanup.mode !== "shutdown" ||
		cleanup.accountingState !== "COMPLETED" ||
		cleanup.acknowledgedRanks.length !== 2 ||
		cleanup.acknowledgedRanks[0] !== 0 ||
		cleanup.acknowledgedRanks[1] !== 1 ||
		recordCleanup.mode !== "shutdown" ||
		recordCleanup.poolDigest !== cleanup.poolDigest ||
		recordCleanup.slurmId !== cleanup.slurmId ||
		recordCleanup.acknowledgedRanks.length !== 2 ||
		recordCleanup.acknowledgedRanks[0] !== 0 ||
		recordCleanup.acknowledgedRanks[1] !== 1 ||
		canonicalJson(toJsonValue(blockCleanup)) !== canonicalJson(toJsonValue(recordCleanup)) ||
		accounting.jobIdRaw !== cleanup.slurmId ||
		accounting.allocCpus !== 4 ||
		accounting.state !== "COMPLETED" ||
		accounting.exitCode !== "0:0" ||
		canonicalJson(toJsonValue(blockAccounting)) !== canonicalJson(toJsonValue(accounting))
	) {
		throw new Error(`${spec.allocationId} did not complete through the preregistered graceful shutdown path`);
	}
	for (const [index, trial] of observation.result.trials.entries()) {
		if (trial.candidateDigest !== spec.candidates[index]?.sha256) {
			throw new Error(`${spec.allocationId} candidate order drifted at ${index}`);
		}
	}
}

export async function executeCompilerGymAllocationReuseArm(
	executionNamespace: string,
	phase: string,
	blockId: string,
	arm: CompilerGymAllocationReuseArm,
	candidates: readonly FrozenCompilerGymCandidate[],
	runAllocation: CompilerGymAllocationRunner,
): Promise<CompilerGymAllocationArmObservation> {
	if (!/^[0-9a-f]{64}$/.test(executionNamespace)) {
		throw new Error("Allocation-reuse execution namespace must be a SHA-256 digest");
	}
	if (candidates.length < 1 || candidates.length > 4)
		throw new Error("Allocation-reuse arm requires one through four candidates");
	const specs: CompilerGymAllocationRunSpec[] =
		arm === "persistent-allocation-treatment"
			? [
					{
						allocationId: `${phase}-${blockId}-persistent`,
						arm,
						branchId: `compiler-gym-allocation-reuse-v1:${executionNamespace}:${phase}:${blockId}:persistent`,
						candidates,
					},
				]
			: candidates.map((candidate, index) => ({
					allocationId: `${phase}-${blockId}-fresh-${index}-${candidate.id}`,
					arm,
					branchId: `compiler-gym-allocation-reuse-v1:${executionNamespace}:${phase}:${blockId}:fresh:${index}:${candidate.id}`,
					candidates: [candidate],
				}));
	const allocations: CompilerGymAllocationObservation[] = [];
	for (const spec of specs) {
		const observation = await runAllocation(spec);
		assertAllocationObservation(observation, spec);
		allocations.push(observation);
	}
	const trials = allocations.flatMap((allocation) => allocation.result.trials);
	if (trials.length !== candidates.length) throw new Error(`${arm} lost a trial while aggregating allocations`);
	const slurmIds = allocations.map((allocation) => allocation.result.blockRecord.slurmId);
	if (new Set(slurmIds).size !== slurmIds.length) throw new Error(`${arm} reused a root allocation unexpectedly`);
	const firstTrial = trials[0];
	const lastAllocation = allocations.at(-1);
	if (!firstTrial || !lastAllocation) throw new Error(`${arm} has no timing boundary`);
	return {
		arm,
		allocations,
		trials,
		armOperational: bigintInterval(
			firstTrial.candidateWall.startedNs,
			lastAllocation.result.blockRecord.schedulerAbsentAtHostNs,
		),
		candidateWallSumNs: sumDecimalBigints(trials.map((trial) => trial.candidateWall.durationNs)),
		allocationOperationalSumNs: sumDecimalBigints(
			allocations.map((allocation) => allocation.result.blockRecord.blockOperational.durationNs),
		),
		acquisitionSumNs: sumDecimalBigints(
			allocations.map((allocation) => allocation.result.recordEvidence.acquisition.durationNs),
		),
		rootCpuTimeRawSeconds: allocations.reduce(
			(sum, allocation) => sum + allocation.result.recordEvidence.accounting.cpuTimeRawSeconds,
			0,
		),
	};
}

function verifyTrialMetrics(
	arm: CompilerGymAllocationReuseArm,
	trials: CompilerGymWarmPilotResult["trials"],
	candidates: readonly FrozenCompilerGymCandidate[],
): void {
	for (const [index, trial] of trials.entries()) {
		const candidate = candidates[index];
		if (!candidate || trial.candidateDigest !== candidate.sha256)
			throw new Error(`${arm} candidate ${index} drifted`);
		if (trial.tasks.length !== COMPILER_GYM_WARM_TASKS.length)
			throw new Error(`${arm} candidate ${index} lost a task`);
		for (const benchmarkId of COMPILER_GYM_WARM_TASKS) {
			const task = trial.tasks.find((item) => item.benchmarkId === benchmarkId);
			const expected = candidate.expected[benchmarkId];
			if (
				!task ||
				task.status !== "accepted" ||
				task.verifierPassed !== true ||
				task.irInstructionCount !== expected.irInstructions ||
				task.objectTextSizeBytes !== expected.objectTextBytes
			) {
				throw new Error(`${arm} ${candidate.id} ${benchmarkId} failed exact metric equivalence`);
			}
		}
	}
}

export function analyzeCompilerGymAllocationReuseMatchedBlock(
	blockId: string,
	candidates: readonly FrozenCompilerGymCandidate[],
	control: CompilerGymAllocationArmObservation,
	treatment: CompilerGymAllocationArmObservation,
): CompilerGymAllocationMatchedBlockAnalysis {
	if (control.arm !== "fresh-allocation-control" || treatment.arm !== "persistent-allocation-treatment") {
		throw new Error("Matched block arms are reversed or mislabeled");
	}
	verifyTrialMetrics(control.arm, control.trials, candidates);
	verifyTrialMetrics(treatment.arm, treatment.trials, candidates);
	const controlCandidateWallSumNs = sumDecimalBigints(control.trials.map((trial) => trial.candidateWall.durationNs));
	const treatmentCandidateWallSumNs = sumDecimalBigints(
		treatment.trials.map((trial) => trial.candidateWall.durationNs),
	);
	if (
		control.candidateWallSumNs !== controlCandidateWallSumNs ||
		treatment.candidateWallSumNs !== treatmentCandidateWallSumNs
	) {
		throw new Error("Matched block candidate-wall aggregate does not close against its trial evidence");
	}
	const allSlurmIds = [...control.allocations, ...treatment.allocations].map(
		(allocation) => allocation.result.blockRecord.slurmId,
	);
	if (new Set(allSlurmIds).size !== allSlurmIds.length)
		throw new Error("Matched block contains a reused root allocation");
	const pairs = candidates.map((candidate, index): CompilerGymAllocationPair => {
		const controlTrial = control.trials[index];
		const treatmentTrial = treatment.trials[index];
		if (!controlTrial || !treatmentTrial) throw new Error(`Matched pair ${candidate.id} is incomplete`);
		const controlDuration = BigInt(controlTrial.candidateWall.durationNs);
		const treatmentDuration = BigInt(treatmentTrial.candidateWall.durationNs);
		if (controlDuration <= 0n || treatmentDuration <= 0n)
			throw new Error(`Matched pair ${candidate.id} has invalid timing`);
		const saving = controlDuration - treatmentDuration;
		return {
			candidateDigest: candidate.sha256,
			controlDurationNs: controlDuration.toString(10),
			treatmentDurationNs: treatmentDuration.toString(10),
			savingNs: saving.toString(10),
			fractionalSaving: Number(saving) / Number(controlDuration),
			treatmentWon: saving > 0n,
			treatmentMoreThanTenPercentSlower: treatmentDuration * 10n > controlDuration * 11n,
		};
	});
	const treatmentWins = pairs.filter((pair) => pair.treatmentWon).length;
	const treatmentCandidateWallSumLower = BigInt(treatmentCandidateWallSumNs) < BigInt(controlCandidateWallSumNs);
	const treatmentArmOperationalLower =
		BigInt(treatment.armOperational.durationNs) < BigInt(control.armOperational.durationNs);
	const anyTreatmentMoreThanTenPercentSlower = pairs.some((pair) => pair.treatmentMoreThanTenPercentSlower);
	return {
		blockId,
		candidateOrder: candidates.map((candidate) => candidate.id),
		control,
		treatment,
		pairs,
		treatmentWins,
		treatmentCandidateWallSumLower,
		treatmentArmOperationalLower,
		anyTreatmentMoreThanTenPercentSlower,
		integrityPassed: true,
		b1Kill: !treatmentCandidateWallSumLower || treatmentWins < 3 || anyTreatmentMoreThanTenPercentSlower,
	};
}

function compareFractions(
	left: { numerator: bigint; denominator: bigint },
	right: { numerator: bigint; denominator: bigint },
): number {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function finalCompilerGymAllocationReuseDecision(blocks: readonly CompilerGymAllocationMatchedBlockAnalysis[]): {
	decision: "promote-to-stock-cold-transport" | "discard-allocation-reuse";
	treatmentWins: number;
	medianAbsoluteSavingNs: number;
	medianFractionalSaving: number;
	candidateWallSumLowerInBothBlocks: boolean;
	armOperationalLowerInBothBlocks: boolean;
	noTreatmentMoreThanTenPercentSlower: boolean;
} {
	if (blocks.length !== 2) throw new Error("Final allocation-reuse decision requires exactly two matched blocks");
	const pairs = blocks.flatMap((block) => block.pairs);
	if (pairs.length !== 8) throw new Error("Final allocation-reuse decision requires exactly eight matched pairs");
	const sortedSavings = pairs.map((pair) => BigInt(pair.savingNs)).sort((left, right) => (left < right ? -1 : 1));
	const medianAbsoluteTwice = sortedSavings[3] + sortedSavings[4];
	const fractions = pairs
		.map((pair) => ({ numerator: BigInt(pair.savingNs), denominator: BigInt(pair.controlDurationNs) }))
		.sort(compareFractions);
	const lower = fractions[3];
	const upper = fractions[4];
	const medianFractionalAtLeastTenPercent =
		5n * (lower.numerator * upper.denominator + upper.numerator * lower.denominator) >=
		lower.denominator * upper.denominator;
	const medianFractionalSaving =
		(Number(lower.numerator) / Number(lower.denominator) + Number(upper.numerator) / Number(upper.denominator)) / 2;
	const treatmentWins = pairs.filter((pair) => pair.treatmentWon).length;
	const candidateWallSumLowerInBothBlocks = blocks.every((block) => block.treatmentCandidateWallSumLower);
	const armOperationalLowerInBothBlocks = blocks.every((block) => block.treatmentArmOperationalLower);
	const noTreatmentMoreThanTenPercentSlower = blocks.every((block) => !block.anyTreatmentMoreThanTenPercentSlower);
	const promote =
		treatmentWins >= 7 &&
		medianAbsoluteTwice >= 4_000_000_000n &&
		medianFractionalAtLeastTenPercent &&
		noTreatmentMoreThanTenPercentSlower &&
		candidateWallSumLowerInBothBlocks;
	return {
		decision: promote ? "promote-to-stock-cold-transport" : "discard-allocation-reuse",
		treatmentWins,
		medianAbsoluteSavingNs: Number(medianAbsoluteTwice) / 2,
		medianFractionalSaving,
		candidateWallSumLowerInBothBlocks,
		armOperationalLowerInBothBlocks,
		noTreatmentMoreThanTenPercentSlower,
	};
}

async function writeCanonicalExclusive(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(value))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function assertAbsent(path: string): Promise<void> {
	try {
		await access(path);
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	throw new Error(`Refusing to replace an existing record-eligible output: ${path}`);
}

function errorText(error: unknown): string {
	if (error instanceof AggregateError) {
		return `${error.name}: ${error.message}: ${error.errors.map(errorText).join(" | ")}`;
	}
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function captureCompilerGymAllocationReuseRemotePreflight(
	runner: CompilerGymWarmCommandRunner = new SpawnCompilerGymWarmCommandRunner(),
): Promise<CompilerGymAllocationReuseRemotePreflight> {
	const config = DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG;
	const environmentProbeSource = await readFile(ENVIRONMENT_PROBE_PATH, "utf8");
	const environmentProbeEncoded = Buffer.from(environmentProbeSource, "utf8").toString("base64");
	const environmentProbeCommand =
		`import base64;source=base64.b64decode("${environmentProbeEncoded}");` +
		'exec(compile(source,"compiler_gym_env_probe.py","exec"))';
	const observations: CompilerGymAllocationReuseRemoteObservation[] = [];
	const commands: Array<{ label: string; argv: [string, ...string[]] }> = [
		{ label: "identity", argv: ["/usr/bin/id", "-un"] },
		{ label: "sbatch-version", argv: ["/usr/bin/sbatch", "--version"] },
		{ label: "srun-version", argv: ["/usr/bin/srun", "--version"] },
		{
			label: "user-queue",
			argv: ["/usr/bin/squeue", "--noheader", "--user", config.user, "--format=%A|%T|%P|%j|%R"],
		},
		{
			label: "pinned-python-executable",
			argv: ["/usr/bin/test", "-x", COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath],
		},
		{
			label: "compiler-gym-cache-directory",
			argv: ["/usr/bin/test", "-d", COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache],
		},
		{
			label: "compiler-gym-site-data-directory",
			argv: ["/usr/bin/test", "-d", COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData],
		},
		{
			label: "compatibility-library-directory",
			argv: ["/usr/bin/test", "-d", COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath],
		},
		{
			label: "environment-seal",
			argv: [
				"/usr/bin/env",
				"-i",
				"PATH=/usr/bin:/bin",
				"LANG=C.UTF-8",
				`LD_LIBRARY_PATH=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath}`,
				`COMPILER_GYM_CACHE=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache}`,
				`COMPILER_GYM_SITE_DATA=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData}`,
				`PYTHONWARNINGS=${COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonWarnings}`,
				COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
				"-c",
				environmentProbeCommand,
			],
		},
		...REMOTE_UTILITY_PATHS.map((path): { label: string; argv: [string, ...string[]] } => ({
			label: `executable-${path.slice(path.lastIndexOf("/") + 1)}`,
			argv: ["/usr/bin/test", "-x", path],
		})),
	];
	let failure: string | null = null;
	for (const command of commands) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(new Error("Remote preflight timed out")), 30_000);
		try {
			const result = await runner.run({
				argv: compilerGymWarmSshArgv(config.host, command.argv),
				signal: controller.signal,
				timeoutMs: 30_000,
				maxOutputBytes: 1024 * 1024,
			});
			observations.push({
				label: command.label,
				argv: [...command.argv],
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				stdoutSha256: sha256Text(result.stdout),
				stderrSha256: sha256Text(result.stderr),
				wallMs: result.wallMs,
			});
			if (result.exitCode !== 0) {
				failure = `${command.label} exited ${String(result.exitCode)}`;
				break;
			}
		} catch (error) {
			failure = `${command.label}: ${errorText(error)}`;
			break;
		} finally {
			clearTimeout(timeout);
		}
	}
	if (failure === null && observations[0]?.stdout.trim() !== config.user) {
		failure = `FarmShare identity is ${observations[0]?.stdout.trim() || "missing"}`;
	}
	const queueObservation = observations.find((observation) => observation.label === "user-queue");
	if (failure === null && queueObservation?.stdout.trim()) {
		failure = "FarmShare user queue was not empty before the sealed phase";
	}
	const environmentObservation = observations.find((observation) => observation.label === "environment-seal");
	if (failure === null) {
		try {
			const environmentSeal = objectRecord(
				JSON.parse(environmentObservation?.stdout.trim() ?? ""),
				"remote environment seal",
			);
			if (environmentSeal.protocol !== REMOTE_ENVIRONMENT_PROBE_PROTOCOL || environmentSeal.pass !== true) {
				failure = "FarmShare environment seal did not match the pinned probe protocol";
			}
		} catch (error) {
			failure = `FarmShare environment seal was invalid: ${errorText(error)}`;
		}
	}
	return {
		protocol: "compiler-gym-allocation-reuse-remote-preflight-v1",
		capturedAt: new Date().toISOString(),
		host: config.host,
		user: config.user,
		pass: failure === null && observations.length === commands.length,
		observations,
		failure,
	};
}

function productionAllocationRunner(
	phaseRoot: string,
	preflight: CompilerGymAllocationReuseLocalPreflight,
	signal: AbortSignal,
): CompilerGymAllocationRunner {
	return async (spec) => {
		const allocationRoot = join(phaseRoot, "allocations", spec.allocationId);
		await assertAbsent(allocationRoot);
		const backend = new FarmShareCompilerGymWarmBackend();
		const transport = new ProtocolCompilerGymWarmTransport(backend, {
			workerSha256: preflight.preregistration.pins.workerSha256,
			evaluatorSha256: COMPILER_GYM_EVALUATOR_SHA256,
			launchContractSha256: COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
			cleanupTimeoutMs: DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG.cleanupTimeoutMs,
		});
		const result = await runCompilerGymWarmPilotBlock({
			blockId: spec.allocationId,
			arm: spec.arm,
			branchId: spec.branchId,
			ledgerPath: join(allocationRoot, "evidence.jsonl"),
			artifactDir: join(allocationRoot, "artifacts"),
			candidates: spec.candidates.map((candidate) => ({
				candidateId: candidate.id,
				actions: candidate.actions,
				candidateSha256: candidate.sha256,
			})),
			createTransport: () => transport,
			recordEvidenceProvider: createFarmShareCompilerGymWarmPilotRecordEvidenceProvider(backend),
			signal,
		});
		return { allocationId: spec.allocationId, arm: spec.arm, result };
	};
}

function candidatesInOrder(
	allCandidates: readonly FrozenCompilerGymCandidate[],
	order: readonly string[],
): FrozenCompilerGymCandidate[] {
	return order.map((id) => {
		const candidate = allCandidates.find((item) => item.id === id);
		if (!candidate) throw new Error(`Preregistered candidate order references missing ${id}`);
		return candidate;
	});
}

async function runMatchedBlock(
	executionNamespace: string,
	phase: string,
	block: PreregisteredBlock,
	candidates: readonly FrozenCompilerGymCandidate[],
	runner: CompilerGymAllocationRunner,
	ledger: EvidenceLedger,
): Promise<CompilerGymAllocationMatchedBlockAnalysis> {
	const observations = new Map<CompilerGymAllocationReuseArm, CompilerGymAllocationArmObservation>();
	for (const arm of block.armOrder) {
		await ledger.append("run_manifest", {
			protocol: "compiler-gym-allocation-reuse-campaign-v1",
			kind: "arm-started",
			phase,
			blockId: block.id,
			arm,
			candidateOrder: candidates.map((candidate) => candidate.id),
		});
		const observation = await executeCompilerGymAllocationReuseArm(
			executionNamespace,
			phase,
			block.id,
			arm,
			candidates,
			runner,
		);
		observations.set(arm, observation);
		await ledger.append("run_manifest", {
			protocol: "compiler-gym-allocation-reuse-campaign-v1",
			kind: "arm-completed",
			phase,
			blockId: block.id,
			arm,
			observation,
		});
	}
	const control = observations.get("fresh-allocation-control");
	const treatment = observations.get("persistent-allocation-treatment");
	if (!control || !treatment) throw new Error(`${block.id} did not execute both registered arms`);
	const analysis = analyzeCompilerGymAllocationReuseMatchedBlock(block.id, candidates, control, treatment);
	await ledger.append("run_manifest", {
		protocol: "compiler-gym-allocation-reuse-campaign-v1",
		kind: "block-analyzed",
		phase,
		analysis,
	});
	return analysis;
}

async function executeSmoke(
	phaseRoot: string,
	preflight: CompilerGymAllocationReuseLocalPreflight,
	executionNamespace: string,
	signal: AbortSignal,
	ledger: EvidenceLedger,
): Promise<unknown> {
	const candidates = candidatesInOrder(preflight.candidates, preflight.preregistration.smoke.candidateOrder);
	const block: PreregisteredBlock = {
		id: "smoke",
		armOrder: preflight.preregistration.smoke.armOrder,
		candidateOrder: candidates.map((candidate) => candidate.id),
	};
	const analysis = await runMatchedBlock(
		executionNamespace,
		"smoke",
		block,
		candidates,
		productionAllocationRunner(phaseRoot, preflight, signal),
		ledger,
	);
	const candidateEvaluations = analysis.control.trials.length + analysis.treatment.trials.length;
	const freshTaskEvaluations = candidateEvaluations * COMPILER_GYM_WARM_TASKS.length;
	const rootAllocations = analysis.control.allocations.length + analysis.treatment.allocations.length;
	const pass =
		candidateEvaluations === preflight.preregistration.smoke.requiredCandidateEvaluations &&
		freshTaskEvaluations === preflight.preregistration.smoke.requiredFreshTaskEvaluations &&
		rootAllocations === preflight.preregistration.smoke.requiredRootAllocations;
	if (!pass) throw new Error("Smoke accounting did not match its preregistered totals");
	return {
		protocol: "compiler-gym-allocation-reuse-smoke-result-v1",
		pass: true,
		preregistrationSha256: preflight.preregistrationSha256,
		runtimeManifestSha256: preflight.runtimeManifestSha256,
		driverSha256: preflight.driverSha256,
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		executionNamespace,
		interpretation: "Operational equivalence only; the one-candidate arms are intentionally identical.",
		candidateEvaluations,
		freshTaskEvaluations,
		rootAllocations,
		analysis,
	};
}

async function executeMain(
	phaseRoot: string,
	preflight: CompilerGymAllocationReuseLocalPreflight,
	executionNamespace: string,
	signal: AbortSignal,
	ledger: EvidenceLedger,
): Promise<unknown> {
	const runner = productionAllocationRunner(phaseRoot, preflight, signal);
	const analyses: CompilerGymAllocationMatchedBlockAnalysis[] = [];
	for (const [index, block] of preflight.preregistration.main.blocks.entries()) {
		const candidates = candidatesInOrder(preflight.candidates, block.candidateOrder);
		const analysis = await runMatchedBlock(executionNamespace, "main", block, candidates, runner, ledger);
		analyses.push(analysis);
		if (index === 0 && analysis.b1Kill) {
			return {
				protocol: "compiler-gym-allocation-reuse-main-result-v1",
				executionNamespace,
				decision: "discard-after-b1",
				reason: "The preregistered sequential kill rule fired; B2 was not dispatched.",
				analyses,
			};
		}
	}
	const decision = finalCompilerGymAllocationReuseDecision(analyses);
	const candidateEvaluations = analyses.reduce(
		(sum, analysis) => sum + analysis.control.trials.length + analysis.treatment.trials.length,
		0,
	);
	const freshTaskEvaluations = candidateEvaluations * COMPILER_GYM_WARM_TASKS.length;
	const rootAllocations = analyses.reduce(
		(sum, analysis) => sum + analysis.control.allocations.length + analysis.treatment.allocations.length,
		0,
	);
	if (
		candidateEvaluations !== preflight.preregistration.main.requiredCandidateEvaluations ||
		freshTaskEvaluations !== preflight.preregistration.main.requiredFreshTaskEvaluations ||
		rootAllocations !== preflight.preregistration.main.requiredRootAllocations
	) {
		throw new Error("Main accounting did not match its preregistered totals");
	}
	const allRootIds = analyses.flatMap((analysis) =>
		[...analysis.control.allocations, ...analysis.treatment.allocations].map(
			(allocation) => allocation.result.blockRecord.slurmId,
		),
	);
	if (new Set(allRootIds).size !== allRootIds.length) {
		throw new Error("Main phase reused a root allocation across matched blocks");
	}
	return {
		protocol: "compiler-gym-allocation-reuse-main-result-v1",
		executionNamespace,
		...decision,
		candidateEvaluations,
		freshTaskEvaluations,
		rootAllocations,
		analyses,
	};
}

async function requirePassingSmoke(
	outputRoot: string,
	preflight: CompilerGymAllocationReuseLocalPreflight,
): Promise<void> {
	const executionNamespace = compilerGymAllocationReuseExecutionNamespace(
		preflight.runtimeManifestSha256,
		preflight.preregistration.executionEpoch,
		outputRoot,
	);
	const smokePath = join(outputRoot, "smoke", "result.json");
	const smokeContents = await readFile(smokePath, "utf8");
	const root = objectRecord(JSON.parse(smokeContents), "smoke result");
	if (
		root.protocol !== "compiler-gym-allocation-reuse-smoke-result-v1" ||
		root.pass !== true ||
		root.preregistrationSha256 !== preflight.preregistrationSha256 ||
		root.runtimeManifestSha256 !== preflight.runtimeManifestSha256 ||
		root.driverSha256 !== preflight.driverSha256 ||
		root.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
		root.executionNamespace !== executionNamespace
	) {
		throw new Error("Main phase requires a verified passing smoke result");
	}
	const ledgerContents = await readFile(join(outputRoot, "smoke", "campaign-evidence.jsonl"), "utf8");
	const events = verifyLedgerContentsStrict(ledgerContents);
	const manifests = events.map((event, index) => objectRecord(event.payload, `smoke campaign event ${index}`));
	const starts = manifests.filter((manifest) => manifest.kind === "phase-started");
	const completions = manifests.filter((manifest) => manifest.kind === "phase-completed");
	if (
		starts.length !== 1 ||
		completions.length !== 1 ||
		manifests.some((manifest) => manifest.kind === "phase-failed")
	) {
		throw new Error("Smoke campaign ledger does not contain one clean completed phase");
	}
	const start = starts[0];
	const completion = completions[0];
	const remote = objectRecord(start?.remotePreflight, "smoke remote preflight");
	if (
		start?.phase !== "smoke" ||
		start.preregistrationSha256 !== preflight.preregistrationSha256 ||
		start.runtimeManifestSha256 !== preflight.runtimeManifestSha256 ||
		start.driverSha256 !== preflight.driverSha256 ||
		start.verifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH ||
		start.executionNamespace !== executionNamespace ||
		remote.pass !== true ||
		completion?.phase !== "smoke" ||
		canonicalJson(toJsonValue(completion.result)) !== canonicalJson(toJsonValue(root))
	) {
		throw new Error("Smoke campaign ledger is not bound to the active sealed runtime and exact result");
	}
}

async function executeRemotePhase(
	phase: "smoke" | "main",
	preflight: CompilerGymAllocationReuseLocalPreflight,
	outputRoot: string,
): Promise<unknown> {
	const executionNamespace = compilerGymAllocationReuseExecutionNamespace(
		preflight.runtimeManifestSha256,
		preflight.preregistration.executionEpoch,
		outputRoot,
	);
	const remote = await captureCompilerGymAllocationReuseRemotePreflight();
	const preflightAttemptPath = join(
		outputRoot,
		"remote-preflight-attempts",
		`${remote.capturedAt.replaceAll(":", "-")}.json`,
	);
	await writeCanonicalExclusive(preflightAttemptPath, remote);
	if (!remote.pass) throw new Error(`FarmShare remote preflight failed: ${remote.failure ?? "unknown failure"}`);
	if (phase === "main") await requirePassingSmoke(outputRoot, preflight);
	const phaseRoot = join(outputRoot, phase);
	await assertAbsent(phaseRoot);
	await mkdir(phaseRoot, { recursive: true });
	const campaignLedger = await EvidenceLedger.open(join(phaseRoot, "campaign-evidence.jsonl"));
	const signalScope = createCompilerGymWarmPilotProcessSignalScope();
	await campaignLedger.append("run_manifest", {
		protocol: "compiler-gym-allocation-reuse-campaign-v1",
		kind: "phase-started",
		phase,
		preregistrationSha256: preflight.preregistrationSha256,
		runtimeManifestSha256: preflight.runtimeManifestSha256,
		driverSha256: preflight.driverSha256,
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		executionEpoch: preflight.preregistration.executionEpoch,
		executionNamespace,
		remotePreflight: remote,
	});
	try {
		const result =
			phase === "smoke"
				? await executeSmoke(phaseRoot, preflight, executionNamespace, signalScope.signal, campaignLedger)
				: await executeMain(phaseRoot, preflight, executionNamespace, signalScope.signal, campaignLedger);
		await campaignLedger.append("run_manifest", {
			protocol: "compiler-gym-allocation-reuse-campaign-v1",
			kind: "phase-completed",
			phase,
			result,
		});
		campaignLedger.verify();
		await writeCanonicalExclusive(join(phaseRoot, "result.json"), result);
		return result;
	} catch (error) {
		await campaignLedger.append("run_manifest", {
			protocol: "compiler-gym-allocation-reuse-campaign-v1",
			kind: "phase-failed",
			phase,
			error: errorText(error),
		});
		campaignLedger.verify();
		await writeCanonicalExclusive(join(phaseRoot, "failure.json"), {
			protocol: "compiler-gym-allocation-reuse-failure-v1",
			phase,
			error: errorText(error),
		});
		throw error;
	} finally {
		signalScope.dispose();
	}
}

function cliArgument(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
	const phase = cliArgument("phase") ?? "local-preflight";
	const preregistrationPath = cliArgument("preregistration") ?? DEFAULT_PREREGISTRATION_PATH;
	const runtimeManifestPath = cliArgument("runtime-manifest") ?? DEFAULT_RUNTIME_MANIFEST_PATH;
	const outputRoot = cliArgument("output-root") ?? DEFAULT_OUTPUT_ROOT;
	const preflight = await loadCompilerGymAllocationReuseLocalPreflight(preregistrationPath, runtimeManifestPath);
	const executionNamespace = compilerGymAllocationReuseExecutionNamespace(
		preflight.runtimeManifestSha256,
		preflight.preregistration.executionEpoch,
		outputRoot,
	);
	if (phase === "local-preflight") {
		process.stdout.write(
			`${canonicalJson(
				toJsonValue({
					protocol: "compiler-gym-allocation-reuse-local-preflight-v1",
					pass: true,
					preregistrationSha256: preflight.preregistrationSha256,
					runtimeManifestSha256: preflight.runtimeManifestSha256,
					sourceLedgerEventCount: preflight.sourceLedgerEventCount,
					sourceLedgerTerminalEventSha256: preflight.sourceLedgerTerminalEventSha256,
					driverSha256: preflight.driverSha256,
					executionEpoch: preflight.preregistration.executionEpoch,
					executionNamespace,
					candidateDigests: preflight.candidates.map((candidate) => candidate.sha256),
				}),
			)}\n`,
		);
		return;
	}
	if (phase === "remote-preflight") {
		const remote = await captureCompilerGymAllocationReuseRemotePreflight();
		const path = join(outputRoot, "remote-preflight-attempts", `${remote.capturedAt.replaceAll(":", "-")}.json`);
		await writeCanonicalExclusive(path, remote);
		process.stdout.write(`${canonicalJson(toJsonValue({ ...remote, outputPath: path }))}\n`);
		if (!remote.pass) process.exitCode = 2;
		return;
	}
	if (phase !== "smoke" && phase !== "main") {
		throw new Error(`Unknown phase ${phase}; expected local-preflight, remote-preflight, smoke, or main`);
	}
	const result = await executeRemotePhase(phase, preflight, outputRoot);
	process.stdout.write(`${canonicalJson(toJsonValue(result))}\n`);
}

if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)) === MODULE_PATH) {
	main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

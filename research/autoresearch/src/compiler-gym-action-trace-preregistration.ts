import { execFile } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_ACTION_TRACE_MEDIAN_OVERHEAD_LIMIT,
	COMPILER_GYM_ACTION_TRACE_PER_CASE_OVERHEAD_LIMIT,
	COMPILER_GYM_ACTION_TRACE_PROJECTION_BYTE_LIMIT,
	COMPILER_GYM_ACTION_TRACE_PROJECTION_RATIO_LIMIT,
	COMPILER_GYM_ACTION_TRACE_PROTOCOL,
} from "./compiler-gym-action-trace-protocol.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import { COMPILER_GYM_WARM_LAUNCH_CONTRACT } from "./compiler-gym-warm-transport.js";

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL =
	"compiler-gym-action-trace-preregistration-v3" as const;
export const COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID = "stock-cold-action-trace-v3" as const;
export const COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_PROTOCOL =
	"compiler-gym-farmshare-environment-probe-v1" as const;
export const COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH =
	"research/autoresearch/evaluators/compiler_gym_env_probe.py" as const;
export const COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT = {
	bitcodeFiles: 23,
	bitcodeManifestBytes: 1901,
	bitcodeTreeManifestSha256: "3447f0794f8e981ff72305cc4efd8e891bb3f348aeb25d189fb0915a39a322cb",
	cbenchValidationInputs: 20,
	compatibilityTreeEntries: 2749,
	compatibilityTreeManifestBytes: 215462,
	compatibilityTreeManifestSha256: "c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1",
	compilerGymVersion: "0.2.5",
	distributionCount: 30,
	distributionManifestSha256: "4b84dea7461512ef8fdadb99a992066484119fc91b7d8f0d3b33b5598fa870dd",
	installedCbenchSourceSha256: "6e38fd10d4bfd7816dbe6f959ff8ae97a3c10ab94cadde883926d83c0db521ed",
	libtinfoSha256: "d82654b2615eb347e8f15a63862c9234f452187250b75d36dce8bd964541f02e",
	pass: true,
	protocol: COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_PROTOCOL,
	pythonVersion: "3.10.19",
	runtimeFiles: 571,
	runtimeManifestBytes: 54171,
	runtimeTreeManifestSha256: "238784ee2032baa43e65a47aa00b13cc805430ffec70952b3dcaa4466a04c8c6",
} as const;
export type CompilerGymActionTraceEnvironmentProbeResult =
	typeof COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT;
export const COMPILER_GYM_ACTION_TRACE_ARMS = ["authoritative", "shadow-trace"] as const;
export type CompilerGymActionTraceArm = (typeof COMPILER_GYM_ACTION_TRACE_ARMS)[number];

export const COMPILER_GYM_ACTION_TRACE_BENCHMARKS = [
	"benchmark://cbench-v1/blowfish",
	"benchmark://cbench-v1/bzip2",
] as const;

export const COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS = [
	"-globalopt",
	"-globaldce",
	"-deadargelim",
	"-mem2reg",
	"-sroa",
	"-instcombine",
	"-simplifycfg",
	"-gvn",
	"-sccp",
	"-instcombine",
	"-simplifycfg",
	"-adce",
] as const;

export const COMPILER_GYM_ACTION_TRACE_LONG_ACTIONS = [
	"-mem2reg",
	"-sroa",
	"-instcombine",
	"-simplifycfg",
	"-sccp",
	"-ipsccp",
	"-gvn",
	"-adce",
	"-dce",
	"-dse",
	"-deadargelim",
	"-globalopt",
	"-globaldce",
	"-instcombine",
	"-simplifycfg",
	"-sccp",
	"-reassociate",
	"-jump-threading",
	"-newgvn",
	"-bdce",
	"-adce",
	"-dce",
	"-dse",
	"-constprop",
	"-constmerge",
	"-deadargelim",
	"-globaldce",
	"-simplifycfg",
	"-instcombine",
	"-loop-rotate",
	"-licm",
	"-tailcallelim",
	"-mergereturn",
	"-jump-threading",
	"-simplifycfg",
	"-instcombine",
	"-sccp",
	"-newgvn",
	"-bdce",
	"-adce",
	"-dce",
	"-dse",
	"-globalopt",
	"-globaldce",
	"-simplifycfg",
	"-instcombine",
] as const;

export const COMPILER_GYM_ACTION_TRACE_CANDIDATES = [
	{
		candidateId: "S12",
		actions: [...COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS],
		expectedDigest: "60df17de77999363e6547b8447140c70e253859ec0eb42caa6e60ab41f62e042",
		expectedMetrics: {
			"benchmark://cbench-v1/blowfish": { irInstructionCount: 1970, objectTextSizeBytes: 21501 },
			"benchmark://cbench-v1/bzip2": { irInstructionCount: 13838, objectTextSizeBytes: 166545 },
		},
		sourceEvidence: {
			ledgerPath: ".autoresearch/stock-cpu-baseline/2026-08-28-v3-v2-sealed/evaluation/evidence.jsonl",
			ledgerSha256: "49bafd401fb9e023fd3ddb2bc2f1a12f63cc501ff3933bb4f334b193fdcdd600",
			proposalEventSha256: "9331fa33cbf12a76648a813ac0d1ca64fcd7caeba6587869cf162c4cf9203360",
			measurementEventSha256: "0344e15cc4d83de68e7c81edc00f1c5ddd2412f38c0dd4a1d7f782d4e9dcc8fe",
			jobId: "job_fdea2188e6952dc80604e3d1",
			manifestDigest: "fdea2188e6952dc80604e3d1573accf04b575789caf70bfaed4b170a12d09a49",
		},
	},
	{
		candidateId: "L46",
		actions: [...COMPILER_GYM_ACTION_TRACE_LONG_ACTIONS],
		expectedDigest: "9c79e07358780e187d0a63ea9fa0c049307dc399308cc2080841095d2f8ff751",
		expectedMetrics: {
			"benchmark://cbench-v1/blowfish": { irInstructionCount: 1981, objectTextSizeBytes: 23028 },
			"benchmark://cbench-v1/bzip2": { irInstructionCount: 14059, objectTextSizeBytes: 172887 },
		},
		sourceEvidence: {
			ledgerPath: ".autoresearch/stock-interface-pair-screen/2026-08-28-block-v2/stock/evaluation/evidence.jsonl",
			ledgerSha256: "31f34f1c78a7213bc3eb852e82f56943c4ecd23f310fafe8f6b6f53c018d02f9",
			proposalEventSha256: "f5e767285cb59954e97c0922b5835babfd81b83a256be6f2b70d36f8e4517def",
			measurementEventSha256: "e674824e93c9720c3500d53330403b070025bf1fa212c9469838f99858537523",
			jobId: "job_f7a1af05a531f8d55637a1b3",
			manifestDigest: "f7a1af05a531f8d55637a1b37d1e1a889883400e73d4b929c94877eba6be338d",
		},
	},
] as const;

export interface CompilerGymActionTraceExecutionSpec {
	allocationOrdinal: number;
	caseId: string;
	candidateId: string;
	benchmarkId: string;
	arm: CompilerGymActionTraceArm;
}

function pairedSpecs(
	candidateId: string,
	benchmarkId: string,
	arms: readonly [CompilerGymActionTraceArm, CompilerGymActionTraceArm],
): Omit<CompilerGymActionTraceExecutionSpec, "allocationOrdinal">[] {
	const caseId = `${candidateId}:${benchmarkId.split("/").at(-1)}`;
	return arms.map((arm) => ({ caseId, candidateId, benchmarkId, arm }));
}

// A/B is canonical/trace. The Latin-square order balances arm order across both
// sequence length and benchmark while every observation remains a fresh allocation.
export const COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN: readonly CompilerGymActionTraceExecutionSpec[] = [
	...pairedSpecs("S12", COMPILER_GYM_ACTION_TRACE_BENCHMARKS[0], ["authoritative", "shadow-trace"]),
	...pairedSpecs("S12", COMPILER_GYM_ACTION_TRACE_BENCHMARKS[1], ["shadow-trace", "authoritative"]),
	...pairedSpecs("L46", COMPILER_GYM_ACTION_TRACE_BENCHMARKS[1], ["authoritative", "shadow-trace"]),
	...pairedSpecs("L46", COMPILER_GYM_ACTION_TRACE_BENCHMARKS[0], ["shadow-trace", "authoritative"]),
].map((spec, index) => ({ ...spec, allocationOrdinal: index + 1 }));

export const COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL = "prime-native-ipython-json-value-v1" as const;
export const COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE = [
	"import json as _prime_action_trace_json",
	"_prime_action_trace_value = _prime_action_trace_json.loads(__CANONICAL_STDOUT_JSON__)",
	"_prime_action_trace_value",
].join("\n");

export interface CompilerGymActionTraceQualificationEnvironment {
	host: string;
	partition: string;
	cpuConstraint: string;
	pythonPath: string;
	remoteSourceRoot: string;
	compilerGymCache: string;
	compilerGymSiteData: string;
	compatibilityLibraryDir: string;
	pythonWarnings: string;
	timeLimit: string;
	memory: string;
	cpusPerTask: 2;
	acceptedRootAllocCpus: [2, 4];
}

export const DEFAULT_COMPILER_GYM_ACTION_TRACE_ENVIRONMENT: CompilerGymActionTraceQualificationEnvironment = {
	host: COMPILER_GYM_WARM_LAUNCH_CONTRACT.clusterHost,
	partition: COMPILER_GYM_WARM_LAUNCH_CONTRACT.partition,
	cpuConstraint: COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpuConstraint,
	pythonPath: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
	remoteSourceRoot: "/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-action-trace-v3/sources",
	compilerGymCache: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache,
	compilerGymSiteData: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData,
	compatibilityLibraryDir: COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath,
	pythonWarnings: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonWarnings,
	timeLimit: "00:05:00",
	memory: COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory,
	cpusPerTask: COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpusPerTask,
	acceptedRootAllocCpus: [2, 4],
};

export const COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS = [
	"research/autoresearch/src/compiler-gym-action-trace-preregistration.ts",
	"research/autoresearch/src/compiler-gym-action-trace-protocol.ts",
	"research/autoresearch/src/compiler-gym-action-trace-qualification-runner.ts",
	"research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
	"research/autoresearch/src/compiler-gym-warm-transport.ts",
	"research/autoresearch/src/compiler-gym-adapter.ts",
	"research/autoresearch/src/artifact-store.ts",
	"research/autoresearch/src/canonical-json.ts",
	"research/autoresearch/src/ledger.ts",
	"research/autoresearch/src/campaign.ts",
	"research/autoresearch/src/stock-cpu-evaluation-envelope.ts",
	"research/autoresearch/src/stock-cpu-eval.ts",
	"research/autoresearch/src/stock-cpu-protocol.ts",
	"research/autoresearch/src/types.ts",
	"packages/coding-agent/src/core/tools/ipython.ts",
	"packages/coding-agent/src/core/kernel/boot-gate.ts",
	"packages/coding-agent/src/core/kernel/bootstrap.ts",
	"packages/coding-agent/src/core/kernel/index.ts",
	"packages/coding-agent/src/core/kernel/repl-manager.ts",
	"packages/coding-agent/src/core/kernel/shared.ts",
	"packages/coding-agent/src/core/kernel/state-snapshot.ts",
	"packages/coding-agent/src/core/orphan-process-journal.ts",
	"packages/coding-agent/src/core/session-lease.ts",
	"packages/coding-agent/src/core/tools/tool-definition-wrapper.ts",
	"packages/coding-agent/src/config.ts",
	"packages/coding-agent/src/utils/child-process.ts",
	"packages/coding-agent/src/utils/daemon-socket-path.ts",
	"packages/coding-agent/src/utils/mime.ts",
	"packages/coding-agent/src/utils/semaphore.ts",
	"packages/coding-agent/src/utils/shell.ts",
	"packages/coding-agent/package.json",
	"prime-agent-runtime/src/rlm/__init__.py",
	"prime-agent-runtime/src/rlm/_winjob.py",
	"prime-agent-runtime/src/rlm/bash.py",
	"prime-agent-runtime/src/rlm/harness.py",
	"prime-agent-runtime/src/rlm/mcp.py",
	"prime-agent-runtime/src/rlm/mcp_base.py",
	"prime-agent-runtime/src/rlm/repl.py",
	"prime-agent-runtime/src/rlm/skill.py",
	"prime-agent-runtime/pyproject.toml",
	"prime-agent-runtime/uv.lock",
	"package.json",
	"package-lock.json",
] as const;

export interface CompilerGymActionTraceImplementationSource {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymActionTracePreregistration {
	protocol: typeof COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL;
	qualificationId: typeof COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID;
	status: "pre-dispatch";
	createdAt: string;
	primeAgentCommit: string;
	claim: string;
	design: {
		modelCalls: 0;
		measurementReuse: false;
		causalTreatmentClaimAllowed: false;
		qualificationScope: "instrumentation-cost-and-equivalence-only";
		dispatchAttempts: 1;
		allocationRetries: 0;
		replacementAllocations: 0;
		failureDisposition: "terminal-infrastructure-invalid-not-treatment-result";
		allocationCount: 8;
		caseCount: 4;
		transport: "independent-stock-cold-ssh-srun";
		forbiddenMechanisms: string[];
	};
	environment: CompilerGymActionTraceQualificationEnvironment;
	sources: {
		canonicalPath: string;
		canonicalSha256: string;
		tracePath: string;
		traceSha256: string;
		environmentProbePath: string;
		environmentProbeSha256: string;
		combinedSha256: string;
	};
	environmentProbe: {
		protocol: typeof COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_PROTOCOL;
		expectedResult: CompilerGymActionTraceEnvironmentProbeResult;
	};
	implementationClosure: CompilerGymActionTraceImplementationSource[];
	renderer: {
		protocol: typeof COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL;
		cellTemplateSha256: string;
		denominator: string;
	};
	expectedVerifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
	candidates: Array<{
		candidateId: string;
		actions: string[];
		actionCount: number;
		actionsSha256: string;
		expectedMetrics: Record<string, { irInstructionCount: number; objectTextSizeBytes: number }>;
		sourceEvidence: {
			ledgerPath: string;
			ledgerSha256: string;
			proposalEventSha256: string;
			measurementEventSha256: string;
			jobId: string;
			manifestDigest: string;
		};
	}>;
	benchmarks: string[];
	executionPlan: CompilerGymActionTraceExecutionSpec[];
	assessment: {
		protocol: typeof COMPILER_GYM_ACTION_TRACE_PROTOCOL;
		medianOverheadLimit: number;
		perCaseOverheadLimit: number;
		projectionRatioLimit: number;
		projectionByteLimit: number;
		killDecision: "kill-action-trace";
		qualifyDecision: "qualify-agent-facing-trace-screen";
	};
}

export interface BuildCompilerGymActionTracePreregistrationInput {
	createdAt: string;
	primeAgentCommit: string;
	canonicalPath: string;
	canonicalSource: string;
	tracePath: string;
	traceSource: string;
	environmentProbePath: string;
	environmentProbeSource: string;
	implementationClosure: CompilerGymActionTraceImplementationSource[];
	environment?: CompilerGymActionTraceQualificationEnvironment;
}

function requireSha256(value: string, name: string): void {
	if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be a lowercase SHA-256 digest`);
}

function assertFrozenDesign(): void {
	if (COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS.length !== 12) throw new Error("Short sequence drifted");
	if (COMPILER_GYM_ACTION_TRACE_LONG_ACTIONS.length !== 46) throw new Error("Long sequence drifted");
	if (
		sha256Text(JSON.stringify(COMPILER_GYM_ACTION_TRACE_SHORT_ACTIONS)) !==
		COMPILER_GYM_ACTION_TRACE_CANDIDATES[0].expectedDigest
	) {
		throw new Error("S12 candidate digest drifted");
	}
	if (
		sha256Text(JSON.stringify(COMPILER_GYM_ACTION_TRACE_LONG_ACTIONS)) !==
		COMPILER_GYM_ACTION_TRACE_CANDIDATES[1].expectedDigest
	) {
		throw new Error("L46 candidate digest drifted");
	}
	if (COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN.length !== 8) throw new Error("Execution plan must have 8 allocations");
	const pairs = new Map<string, CompilerGymActionTraceArm[]>();
	for (const spec of COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN) {
		const arms = pairs.get(spec.caseId) ?? [];
		arms.push(spec.arm);
		pairs.set(spec.caseId, arms);
	}
	if (pairs.size !== 4 || [...pairs.values()].some((arms) => new Set(arms).size !== 2)) {
		throw new Error("Every qualification case must contain one fresh allocation per arm");
	}
}

export function buildCompilerGymActionTracePreregistration(
	input: BuildCompilerGymActionTracePreregistrationInput,
): CompilerGymActionTracePreregistration {
	assertFrozenDesign();
	if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO timestamp");
	if (
		!/^[0-9a-f]{40}$/.test(input.primeAgentCommit) ||
		input.primeAgentCommit !== FROZEN_CAMPAIGN.repositories.primeAgent.commit
	) {
		throw new Error("Prime Agent commit must equal the pinned campaign Git commit");
	}
	const canonicalSha256 = sha256Text(input.canonicalSource);
	if (canonicalSha256 !== COMPILER_GYM_EVALUATOR_SHA256) {
		throw new Error("Canonical evaluator source differs from the pinned verifier");
	}
	const traceSha256 = sha256Text(input.traceSource);
	const environmentProbeSha256 = sha256Text(input.environmentProbeSource);
	const combinedSha256 = sha256Json({ canonicalSha256, environmentProbeSha256, traceSha256 });
	if (
		input.implementationClosure.length !== COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS.length ||
		input.implementationClosure.some(
			(source, index) =>
				source.relativePath !== COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS[index] ||
				!SHA256_PATTERN.test(source.sha256),
		)
	) {
		throw new Error("Implementation closure does not contain the exact ordered qualification sources");
	}
	return {
		protocol: COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL,
		qualificationId: COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID,
		status: "pre-dispatch",
		createdAt: input.createdAt,
		primeAgentCommit: input.primeAgentCommit,
		claim: "A verifier-separated per-action IR/no-effect trace can preserve authoritative terminal results while adding at most 15% median and 25% per-case intrinsic runtime overhead, and its compact projection adds at most 25% and 2500 projected agent-facing bytes to a native-rendered stock-interface envelope.",
		design: {
			modelCalls: 0,
			measurementReuse: false,
			causalTreatmentClaimAllowed: false,
			qualificationScope: "instrumentation-cost-and-equivalence-only",
			dispatchAttempts: 1,
			allocationRetries: 0,
			replacementAllocations: 0,
			failureDisposition: "terminal-infrastructure-invalid-not-treatment-result",
			allocationCount: 8,
			caseCount: 4,
			transport: "independent-stock-cold-ssh-srun",
			forbiddenMechanisms: ["held-root-allocation", "job-step", "allocation-reuse", "warm-worker", "provider-call"],
		},
		environment: structuredClone(input.environment ?? DEFAULT_COMPILER_GYM_ACTION_TRACE_ENVIRONMENT),
		sources: {
			canonicalPath: resolve(input.canonicalPath),
			canonicalSha256,
			tracePath: resolve(input.tracePath),
			traceSha256,
			environmentProbePath: resolve(input.environmentProbePath),
			environmentProbeSha256,
			combinedSha256,
		},
		environmentProbe: {
			protocol: COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_PROTOCOL,
			expectedResult: structuredClone(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT),
		},
		implementationClosure: structuredClone(input.implementationClosure),
		renderer: {
			protocol: COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL,
			cellTemplateSha256: sha256Text(COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE),
			denominator:
				"Control bytes are the UTF-8 bytes of the sole text block returned by the built-in createIpythonTool path for the full stock-cpu-eval host envelope reconstructed from each shadow result with trace measured and stored host-side but hidden; treatment bytes use the same renderer for that full envelope plus exactly one typed actionTrace field; incremental bytes equal treatment bytes minus control bytes",
		},
		expectedVerifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		candidates: COMPILER_GYM_ACTION_TRACE_CANDIDATES.map((candidate) => ({
			candidateId: candidate.candidateId,
			actions: [...candidate.actions],
			actionCount: candidate.actions.length,
			actionsSha256: sha256Text(JSON.stringify(candidate.actions)),
			expectedMetrics: structuredClone(candidate.expectedMetrics),
			sourceEvidence: structuredClone(candidate.sourceEvidence),
		})),
		benchmarks: [...COMPILER_GYM_ACTION_TRACE_BENCHMARKS],
		executionPlan: COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN.map((spec) => ({ ...spec })),
		assessment: {
			protocol: COMPILER_GYM_ACTION_TRACE_PROTOCOL,
			medianOverheadLimit: COMPILER_GYM_ACTION_TRACE_MEDIAN_OVERHEAD_LIMIT,
			perCaseOverheadLimit: COMPILER_GYM_ACTION_TRACE_PER_CASE_OVERHEAD_LIMIT,
			projectionRatioLimit: COMPILER_GYM_ACTION_TRACE_PROJECTION_RATIO_LIMIT,
			projectionByteLimit: COMPILER_GYM_ACTION_TRACE_PROJECTION_BYTE_LIMIT,
			killDecision: "kill-action-trace",
			qualifyDecision: "qualify-agent-facing-trace-screen",
		},
	};
}

export function parseCompilerGymActionTracePreregistration(
	value: unknown,
	expected?: CompilerGymActionTracePreregistration,
): CompilerGymActionTracePreregistration {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Preregistration must be an object");
	}
	const record = value as Record<string, unknown>;
	if (record.protocol !== COMPILER_GYM_ACTION_TRACE_PREREGISTRATION_PROTOCOL) {
		throw new Error("Unexpected action-trace preregistration protocol");
	}
	if (record.qualificationId !== COMPILER_GYM_ACTION_TRACE_QUALIFICATION_ID || record.status !== "pre-dispatch") {
		throw new Error("Preregistration is not the frozen pre-dispatch qualification");
	}
	const parsed = structuredClone(value) as CompilerGymActionTracePreregistration;
	const candidates = parsed.candidates;
	if (
		!Array.isArray(candidates) ||
		sha256Json(candidates) !==
			sha256Json(
				COMPILER_GYM_ACTION_TRACE_CANDIDATES.map((candidate) => ({
					candidateId: candidate.candidateId,
					actions: [...candidate.actions],
					actionCount: candidate.actions.length,
					actionsSha256: candidate.expectedDigest,
					expectedMetrics: candidate.expectedMetrics,
					sourceEvidence: candidate.sourceEvidence,
				})),
			)
	) {
		throw new Error("Preregistration candidates differ from the frozen sequences");
	}
	if (sha256Json(parsed.executionPlan) !== sha256Json(COMPILER_GYM_ACTION_TRACE_EXECUTION_PLAN)) {
		throw new Error("Preregistration execution plan differs from the frozen AB/BA plan");
	}
	if (sha256Json(parsed.benchmarks) !== sha256Json(COMPILER_GYM_ACTION_TRACE_BENCHMARKS)) {
		throw new Error("Preregistration benchmarks differ from the frozen task pair");
	}
	if (parsed.sources.canonicalSha256 !== COMPILER_GYM_EVALUATOR_SHA256) {
		throw new Error("Preregistration canonical evaluator hash is not pinned");
	}
	if (
		!Array.isArray(parsed.implementationClosure) ||
		parsed.implementationClosure.length !== COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS.length ||
		parsed.implementationClosure.some(
			(source, index) =>
				source.relativePath !== COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS[index] ||
				!SHA256_PATTERN.test(source.sha256),
		)
	) {
		throw new Error("Preregistration implementation closure is invalid");
	}
	if (parsed.expectedVerifierEpoch !== COMPILER_GYM_VERIFIER_EPOCH) {
		throw new Error("Preregistration verifier epoch is not pinned");
	}
	requireSha256(parsed.sources.traceSha256, "Trace evaluator hash");
	requireSha256(parsed.sources.environmentProbeSha256, "Environment probe hash");
	if (
		parsed.environmentProbe.protocol !== COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_PROTOCOL ||
		canonicalJson(toJsonValue(parsed.environmentProbe.expectedResult)) !==
			canonicalJson(toJsonValue(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT))
	) {
		throw new Error("Preregistration environment probe result is not exactly pinned");
	}
	if (
		parsed.sources.combinedSha256 !==
		sha256Json({
			canonicalSha256: parsed.sources.canonicalSha256,
			environmentProbeSha256: parsed.sources.environmentProbeSha256,
			traceSha256: parsed.sources.traceSha256,
		})
	) {
		throw new Error("Preregistration combined source hash is invalid");
	}
	if (
		parsed.renderer.protocol !== COMPILER_GYM_ACTION_TRACE_NATIVE_RENDERER_PROTOCOL ||
		parsed.renderer.cellTemplateSha256 !== sha256Text(COMPILER_GYM_ACTION_TRACE_NATIVE_RENDER_CELL_TEMPLATE)
	) {
		throw new Error("Preregistration renderer differs from the native IPython denominator");
	}
	if (
		parsed.design.modelCalls !== 0 ||
		parsed.design.measurementReuse !== false ||
		parsed.design.causalTreatmentClaimAllowed !== false ||
		parsed.design.qualificationScope !== "instrumentation-cost-and-equivalence-only" ||
		parsed.design.dispatchAttempts !== 1 ||
		parsed.design.allocationRetries !== 0 ||
		parsed.design.replacementAllocations !== 0 ||
		parsed.design.failureDisposition !== "terminal-infrastructure-invalid-not-treatment-result" ||
		parsed.design.allocationCount !== 8 ||
		parsed.design.caseCount !== 4 ||
		parsed.design.transport !== "independent-stock-cold-ssh-srun"
	) {
		throw new Error("Preregistration design is not the zero-model stock-cold design");
	}
	if (
		canonicalJson(toJsonValue(parsed.environment)) !==
			canonicalJson(toJsonValue(DEFAULT_COMPILER_GYM_ACTION_TRACE_ENVIRONMENT)) ||
		parsed.environment.cpusPerTask !== 2 ||
		JSON.stringify(parsed.environment.acceptedRootAllocCpus) !== JSON.stringify([2, 4])
	) {
		throw new Error("Preregistration FarmShare environment is not frozen");
	}
	if (parsed.assessment.protocol !== COMPILER_GYM_ACTION_TRACE_PROTOCOL) {
		throw new Error("Preregistration assessment protocol is invalid");
	}
	if (expected && canonicalJson(toJsonValue(parsed)) !== canonicalJson(toJsonValue(expected))) {
		throw new Error("Preregistration differs from the fully reconstructed sealed design");
	}
	return parsed;
}

export async function writeCompilerGymActionTracePreregistration(
	path: string,
	preregistration: CompilerGymActionTracePreregistration,
): Promise<void> {
	parseCompilerGymActionTracePreregistration(preregistration);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(preregistration))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function generateCompilerGymActionTracePreregistration(input: {
	outputPath: string;
	repoRoot: string;
	createdAt?: string;
}): Promise<CompilerGymActionTracePreregistration> {
	const canonicalPath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const tracePath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_action_trace_eval.py");
	const environmentProbePath = resolve(input.repoRoot, COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_RELATIVE_PATH);
	const [{ stdout }, canonicalSource, traceSource, environmentProbeSource, implementationClosure] = await Promise.all([
		execFileAsync("git", ["rev-parse", "HEAD"], { cwd: input.repoRoot, encoding: "utf8" }),
		readFile(canonicalPath, "utf8"),
		readFile(tracePath, "utf8"),
		readFile(environmentProbePath, "utf8"),
		Promise.all(
			COMPILER_GYM_ACTION_TRACE_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
				relativePath,
				sha256: sha256Text(await readFile(resolve(input.repoRoot, relativePath), "utf8")),
			})),
		),
	]);
	const preregistration = buildCompilerGymActionTracePreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		primeAgentCommit: stdout.trim(),
		canonicalPath,
		canonicalSource,
		tracePath,
		traceSource,
		environmentProbePath,
		environmentProbeSource,
		implementationClosure,
	});
	await writeCompilerGymActionTracePreregistration(resolve(input.outputPath), preregistration);
	return preregistration;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 2 || args[0] !== "--output") {
		throw new Error("Usage: compiler-gym-action-trace-preregistration --output <path>");
	}
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	const result = await generateCompilerGymActionTracePreregistration({ outputPath: args[1], repoRoot });
	console.log(canonicalJson(toJsonValue(result)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main();
}

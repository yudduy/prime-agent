import { execFile } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import {
	COMPILER_GYM_IR_DELTA_SMOKE_MEDIAN_RATIO_LIMIT,
	COMPILER_GYM_IR_DELTA_SMOKE_PER_BLOCK_RATIO_LIMIT,
	COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL,
	COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
	COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
} from "./compiler-gym-ir-delta-smoke-protocol.js";
import { COMPILER_GYM_WARM_LAUNCH_CONTRACT } from "./compiler-gym-warm-transport.js";

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const COMPILER_GYM_IR_DELTA_SMOKE_PREREGISTRATION_PROTOCOL =
	"compiler-gym-one-env-ir-delta-smoke-preregistration-v1" as const;
export const COMPILER_GYM_IR_DELTA_SMOKE_ID = "stock-cold-one-env-ir-delta-cost-smoke-v1" as const;
export const COMPILER_GYM_IR_DELTA_EVALUATOR_SHA256 =
	"8faef0a05667ad84e0695fb91e782659217bcc9703153b9eec546c2617903a97" as const;
export const COMPILER_GYM_IR_DELTA_TREATMENT_CONTRACT = "compiler-gym-v0.2.5-single-environment-ir-delta-v1" as const;
export const COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256 =
	"117951542f86c3634053f2601ebb7559323baa606a497dc6d6aebdcf236e324c" as const;
export const COMPILER_GYM_IR_DELTA_V3_PREREGISTRATION_SHA256 =
	"a4956d205b7b0ec548e289958bf15a7c290de1c3ba7723b14d31ca42a56609ca" as const;
export const COMPILER_GYM_IR_DELTA_V3_LEDGER_SHA256 =
	"5b97f945005709276459eb9f344a3f63ce315d599fad3bb4642a6710d2d9f688" as const;

export const COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT = {
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
	protocol: "compiler-gym-farmshare-environment-probe-v1",
	pythonVersion: "3.10.19",
	runtimeFiles: 571,
	runtimeManifestBytes: 54171,
	runtimeTreeManifestSha256: "238784ee2032baa43e65a47aa00b13cc805430ffec70952b3dcaa4466a04c8c6",
} as const;

export const COMPILER_GYM_IR_DELTA_LONG_ACTIONS = [
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

export const COMPILER_GYM_IR_DELTA_CANDIDATE = {
	candidateId: "L46",
	actions: [...COMPILER_GYM_IR_DELTA_LONG_ACTIONS],
	actionsSha256: "9c79e07358780e187d0a63ea9fa0c049307dc399308cc2080841095d2f8ff751",
	expectedMetrics: { irInstructionCount: 1981, objectTextSizeBytes: 23028 },
	sourceEvidence: {
		ledgerPath: ".autoresearch/stock-interface-pair-screen/2026-08-28-block-v2/stock/evaluation/evidence.jsonl",
		ledgerSha256: "31f34f1c78a7213bc3eb852e82f56943c4ecd23f310fafe8f6b6f53c018d02f9",
		proposalEventSha256: "f5e767285cb59954e97c0922b5835babfd81b83a256be6f2b70d36f8e4517def",
		measurementEventSha256: "e674824e93c9720c3500d53330403b070025bf1fa212c9469838f99858537523",
		jobId: "job_f7a1af05a531f8d55637a1b3",
		manifestDigest: "f7a1af05a531f8d55637a1b37d1e1a889883400e73d4b929c94877eba6be338d",
	},
} as const;

export const COMPILER_GYM_IR_DELTA_BENCHMARK = "benchmark://cbench-v1/blowfish" as const;
export const COMPILER_GYM_IR_DELTA_ARMS = ["canonical", "one-env-ir-delta"] as const;
export type CompilerGymIrDeltaSmokeArm = (typeof COMPILER_GYM_IR_DELTA_ARMS)[number];

export interface CompilerGymIrDeltaSmokeExecutionSpec {
	allocationOrdinal: 1 | 2 | 3 | 4;
	blockId: "r1" | "r2";
	arm: CompilerGymIrDeltaSmokeArm;
	candidateId: "L46";
	benchmarkId: typeof COMPILER_GYM_IR_DELTA_BENCHMARK;
}

export const COMPILER_GYM_IR_DELTA_EXECUTION_PLAN: readonly CompilerGymIrDeltaSmokeExecutionSpec[] = [
	{
		allocationOrdinal: 1,
		blockId: "r1",
		arm: "canonical",
		candidateId: "L46",
		benchmarkId: COMPILER_GYM_IR_DELTA_BENCHMARK,
	},
	{
		allocationOrdinal: 2,
		blockId: "r1",
		arm: "one-env-ir-delta",
		candidateId: "L46",
		benchmarkId: COMPILER_GYM_IR_DELTA_BENCHMARK,
	},
	{
		allocationOrdinal: 3,
		blockId: "r2",
		arm: "one-env-ir-delta",
		candidateId: "L46",
		benchmarkId: COMPILER_GYM_IR_DELTA_BENCHMARK,
	},
	{
		allocationOrdinal: 4,
		blockId: "r2",
		arm: "canonical",
		candidateId: "L46",
		benchmarkId: COMPILER_GYM_IR_DELTA_BENCHMARK,
	},
];

export interface CompilerGymIrDeltaSmokeEnvironment {
	host: string;
	partition: string;
	cpuConstraint: string;
	pythonPath: string;
	remoteSourceRoot: string;
	compilerGymCache: string;
	compilerGymSiteData: string;
	compatibilityLibraryDir: string;
	pythonWarnings: string;
	timeLimit: "00:05:00";
	memory: string;
	cpusPerTask: 2;
	acceptedRootAllocCpus: [2, 4];
}

export const DEFAULT_COMPILER_GYM_IR_DELTA_SMOKE_ENVIRONMENT: CompilerGymIrDeltaSmokeEnvironment = {
	host: COMPILER_GYM_WARM_LAUNCH_CONTRACT.clusterHost,
	partition: COMPILER_GYM_WARM_LAUNCH_CONTRACT.partition,
	cpuConstraint: COMPILER_GYM_WARM_LAUNCH_CONTRACT.cpuConstraint,
	pythonPath: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonPath,
	remoteSourceRoot: "/scratch/users/duynguy/prime-autoresearch-private/compiler-gym-ir-delta-smoke-v1/sources",
	compilerGymCache: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymCache,
	compilerGymSiteData: COMPILER_GYM_WARM_LAUNCH_CONTRACT.compilerGymSiteData,
	compatibilityLibraryDir: COMPILER_GYM_WARM_LAUNCH_CONTRACT.ldLibraryPath,
	pythonWarnings: COMPILER_GYM_WARM_LAUNCH_CONTRACT.pythonWarnings,
	timeLimit: "00:05:00",
	memory: COMPILER_GYM_WARM_LAUNCH_CONTRACT.memory,
	cpusPerTask: 2,
	acceptedRootAllocCpus: [2, 4],
};

export const COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS = [
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-preregistration.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-protocol.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-runner.ts",
	"research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
	"research/autoresearch/src/compiler-gym-warm-transport.ts",
	"research/autoresearch/src/compiler-gym-adapter.ts",
	"research/autoresearch/src/artifact-store.ts",
	"research/autoresearch/src/canonical-json.ts",
	"research/autoresearch/src/ledger.ts",
	"research/autoresearch/src/campaign.ts",
	"research/autoresearch/src/types.ts",
	"package.json",
	"package-lock.json",
] as const;

export interface CompilerGymIrDeltaImplementationSource {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymIrDeltaSmokePreregistration {
	protocol: typeof COMPILER_GYM_IR_DELTA_SMOKE_PREREGISTRATION_PROTOCOL;
	smokeId: typeof COMPILER_GYM_IR_DELTA_SMOKE_ID;
	status: "pre-dispatch";
	createdAt: string;
	primeAgentCommit: string;
	claim: string;
	design: {
		scope: "cost-and-equivalence-screen-only";
		modelCalls: 0;
		measurementReuse: false;
		causalTreatmentClaimAllowed: false;
		lunaAuthorized: false;
		allocationCount: 4;
		blockCount: 2;
		scientificCaseCount: 1;
		dispatchAttempts: 1;
		allocationRetries: 0;
		replacementAllocations: 0;
		transport: "independent-stock-cold-ssh-srun";
		forbiddenMechanisms: string[];
	};
	v3NonAdmission: {
		preregistrationSha256: typeof COMPILER_GYM_IR_DELTA_V3_PREREGISTRATION_SHA256;
		ledgerSha256: typeof COMPILER_GYM_IR_DELTA_V3_LEDGER_SHA256;
		terminalDisposition: "terminal-infrastructure-invalid-not-treatment-result";
		v3MeasurementsAdmitted: false;
		v3MeasurementsUsedInAssessment: false;
	};
	environment: CompilerGymIrDeltaSmokeEnvironment;
	environmentProbe: {
		protocol: "compiler-gym-farmshare-environment-probe-v1";
		expectedResult: typeof COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT;
	};
	sources: {
		canonicalPath: string;
		canonicalSha256: typeof COMPILER_GYM_EVALUATOR_SHA256;
		treatmentPath: string;
		treatmentSha256: typeof COMPILER_GYM_IR_DELTA_EVALUATOR_SHA256;
		environmentProbePath: string;
		environmentProbeSha256: typeof COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256;
		combinedSha256: string;
	};
	implementationClosure: CompilerGymIrDeltaImplementationSource[];
	expectedVerifierEpoch: typeof COMPILER_GYM_VERIFIER_EPOCH;
	trace: {
		contract: typeof COMPILER_GYM_IR_DELTA_TRACE_CONTRACT;
		prefixConditional: true;
		intermediateSemanticStatus: "unverified";
		terminalSemanticStatus: "canonical-20-input-verifier";
		zeroDeltaSemantics: typeof COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS;
		recordCount: 46;
		telescopingRequired: true;
	};
	candidate: typeof COMPILER_GYM_IR_DELTA_CANDIDATE;
	benchmark: typeof COMPILER_GYM_IR_DELTA_BENCHMARK;
	executionPlan: CompilerGymIrDeltaSmokeExecutionSpec[];
	assessment: {
		protocol: typeof COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL;
		numerator: "one-env-ir-delta timings_seconds.total";
		denominator: "paired canonical timings_seconds.total";
		medianRatioLimit: typeof COMPILER_GYM_IR_DELTA_SMOKE_MEDIAN_RATIO_LIMIT;
		perBlockRatioLimit: typeof COMPILER_GYM_IR_DELTA_SMOKE_PER_BLOCK_RATIO_LIMIT;
		passDecision: "promote-to-full-ir-delta-qualification";
		failDecision: "kill-current-one-env-ir-delta-evaluator";
		apparatusFailure: "terminal-apparatus-invalid";
		nextGate: "eight-fresh-allocation-model-free-ir-delta-qualification";
	};
}

export interface BuildCompilerGymIrDeltaSmokePreregistrationInput {
	createdAt: string;
	primeAgentCommit: string;
	canonicalPath: string;
	canonicalSource: string;
	treatmentPath: string;
	treatmentSource: string;
	environmentProbePath: string;
	environmentProbeSource: string;
	implementationClosure: CompilerGymIrDeltaImplementationSource[];
}

function assertFrozenDesign(): void {
	if (COMPILER_GYM_IR_DELTA_LONG_ACTIONS.length !== 46) throw new Error("L46 action count drifted");
	if (
		sha256Text(JSON.stringify(COMPILER_GYM_IR_DELTA_LONG_ACTIONS)) !== COMPILER_GYM_IR_DELTA_CANDIDATE.actionsSha256
	) {
		throw new Error("L46 action bytes drifted");
	}
	if (
		COMPILER_GYM_IR_DELTA_EXECUTION_PLAN.map((item) => item.arm).join(",") !==
		"canonical,one-env-ir-delta,one-env-ir-delta,canonical"
	) {
		throw new Error("ABBA execution plan drifted");
	}
}

export function buildCompilerGymIrDeltaSmokePreregistration(
	input: BuildCompilerGymIrDeltaSmokePreregistrationInput,
): CompilerGymIrDeltaSmokePreregistration {
	assertFrozenDesign();
	if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("createdAt must be an ISO timestamp");
	if (input.primeAgentCommit !== FROZEN_CAMPAIGN.repositories.primeAgent.commit) {
		throw new Error("Prime Agent commit differs from the frozen campaign commit");
	}
	const canonicalSha256 = sha256Text(input.canonicalSource);
	const treatmentSha256 = sha256Text(input.treatmentSource);
	const environmentProbeSha256 = sha256Text(input.environmentProbeSource);
	if (canonicalSha256 !== COMPILER_GYM_EVALUATOR_SHA256) throw new Error("Canonical evaluator bytes drifted");
	if (treatmentSha256 !== COMPILER_GYM_IR_DELTA_EVALUATOR_SHA256) throw new Error("Treatment evaluator bytes drifted");
	if (environmentProbeSha256 !== COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256)
		throw new Error("Environment probe bytes drifted");
	if (
		input.implementationClosure.length !== COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS.length ||
		input.implementationClosure.some(
			(item, index) =>
				item.relativePath !== COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS[index] ||
				!SHA256_PATTERN.test(item.sha256),
		)
	) {
		throw new Error("Implementation closure differs from the exact ordered source list");
	}
	return {
		protocol: COMPILER_GYM_IR_DELTA_SMOKE_PREREGISTRATION_PROTOCOL,
		smokeId: COMPILER_GYM_IR_DELTA_SMOKE_ID,
		status: "pre-dispatch",
		createdAt: input.createdAt,
		primeAgentCommit: input.primeAgentCommit,
		claim: "A one-environment, IR-delta-only evaluator preserves the canonical L46/blowfish terminal result and verifier while keeping the median paired intrinsic-total runtime ratio at or below 1.12 and each paired ratio at or below 1.25.",
		design: {
			scope: "cost-and-equivalence-screen-only",
			modelCalls: 0,
			measurementReuse: false,
			causalTreatmentClaimAllowed: false,
			lunaAuthorized: false,
			allocationCount: 4,
			blockCount: 2,
			scientificCaseCount: 1,
			dispatchAttempts: 1,
			allocationRetries: 0,
			replacementAllocations: 0,
			transport: "independent-stock-cold-ssh-srun",
			forbiddenMechanisms: [
				"provider-request",
				"model-call",
				"held-root-allocation",
				"job-step",
				"allocation-reuse",
				"warm-worker",
				"retry",
				"replacement",
			],
		},
		v3NonAdmission: {
			preregistrationSha256: COMPILER_GYM_IR_DELTA_V3_PREREGISTRATION_SHA256,
			ledgerSha256: COMPILER_GYM_IR_DELTA_V3_LEDGER_SHA256,
			terminalDisposition: "terminal-infrastructure-invalid-not-treatment-result",
			v3MeasurementsAdmitted: false,
			v3MeasurementsUsedInAssessment: false,
		},
		environment: structuredClone(DEFAULT_COMPILER_GYM_IR_DELTA_SMOKE_ENVIRONMENT),
		environmentProbe: {
			protocol: "compiler-gym-farmshare-environment-probe-v1",
			expectedResult: structuredClone(COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_EXPECTED_RESULT),
		},
		sources: {
			canonicalPath: resolve(input.canonicalPath),
			canonicalSha256: COMPILER_GYM_EVALUATOR_SHA256,
			treatmentPath: resolve(input.treatmentPath),
			treatmentSha256: COMPILER_GYM_IR_DELTA_EVALUATOR_SHA256,
			environmentProbePath: resolve(input.environmentProbePath),
			environmentProbeSha256: COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256,
			combinedSha256: sha256Json({ canonicalSha256, treatmentSha256, environmentProbeSha256 }),
		},
		implementationClosure: structuredClone(input.implementationClosure),
		expectedVerifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		trace: {
			contract: COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
			prefixConditional: true,
			intermediateSemanticStatus: "unverified",
			terminalSemanticStatus: "canonical-20-input-verifier",
			zeroDeltaSemantics: COMPILER_GYM_IR_DELTA_ZERO_SEMANTICS,
			recordCount: 46,
			telescopingRequired: true,
		},
		candidate: structuredClone(COMPILER_GYM_IR_DELTA_CANDIDATE),
		benchmark: COMPILER_GYM_IR_DELTA_BENCHMARK,
		executionPlan: COMPILER_GYM_IR_DELTA_EXECUTION_PLAN.map((item) => ({ ...item })),
		assessment: {
			protocol: COMPILER_GYM_IR_DELTA_SMOKE_PROTOCOL,
			numerator: "one-env-ir-delta timings_seconds.total",
			denominator: "paired canonical timings_seconds.total",
			medianRatioLimit: COMPILER_GYM_IR_DELTA_SMOKE_MEDIAN_RATIO_LIMIT,
			perBlockRatioLimit: COMPILER_GYM_IR_DELTA_SMOKE_PER_BLOCK_RATIO_LIMIT,
			passDecision: "promote-to-full-ir-delta-qualification",
			failDecision: "kill-current-one-env-ir-delta-evaluator",
			apparatusFailure: "terminal-apparatus-invalid",
			nextGate: "eight-fresh-allocation-model-free-ir-delta-qualification",
		},
	};
}

export function parseCompilerGymIrDeltaSmokePreregistration(
	value: unknown,
	expected?: CompilerGymIrDeltaSmokePreregistration,
): CompilerGymIrDeltaSmokePreregistration {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Preregistration must be an object");
	const parsed = structuredClone(value) as CompilerGymIrDeltaSmokePreregistration;
	if (
		parsed.protocol !== COMPILER_GYM_IR_DELTA_SMOKE_PREREGISTRATION_PROTOCOL ||
		parsed.smokeId !== COMPILER_GYM_IR_DELTA_SMOKE_ID ||
		parsed.status !== "pre-dispatch"
	)
		throw new Error("Unexpected IR-delta smoke preregistration identity");
	if (
		parsed.sources.canonicalSha256 !== COMPILER_GYM_EVALUATOR_SHA256 ||
		parsed.sources.treatmentSha256 !== COMPILER_GYM_IR_DELTA_EVALUATOR_SHA256 ||
		parsed.sources.environmentProbeSha256 !== COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256
	) {
		throw new Error("Preregistration source hashes are not pinned");
	}
	if (sha256Json(parsed.executionPlan) !== sha256Json(COMPILER_GYM_IR_DELTA_EXECUTION_PLAN))
		throw new Error("Preregistration ABBA plan drifted");
	if (sha256Json(parsed.candidate) !== sha256Json(COMPILER_GYM_IR_DELTA_CANDIDATE))
		throw new Error("Preregistration candidate drifted");
	if (
		canonicalJson(toJsonValue(parsed.environment)) !==
		canonicalJson(toJsonValue(DEFAULT_COMPILER_GYM_IR_DELTA_SMOKE_ENVIRONMENT))
	)
		throw new Error("Preregistration environment drifted");
	if (
		!Array.isArray(parsed.implementationClosure) ||
		parsed.implementationClosure.length !== COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS.length ||
		parsed.implementationClosure.some(
			(item, index) =>
				item.relativePath !== COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS[index] ||
				!SHA256_PATTERN.test(item.sha256),
		)
	)
		throw new Error("Preregistration implementation closure is invalid");
	if (
		parsed.v3NonAdmission.preregistrationSha256 !== COMPILER_GYM_IR_DELTA_V3_PREREGISTRATION_SHA256 ||
		parsed.v3NonAdmission.ledgerSha256 !== COMPILER_GYM_IR_DELTA_V3_LEDGER_SHA256 ||
		parsed.v3NonAdmission.v3MeasurementsAdmitted !== false ||
		parsed.v3NonAdmission.v3MeasurementsUsedInAssessment !== false
	)
		throw new Error("V3 non-admission disclosure drifted");
	if (expected && canonicalJson(toJsonValue(parsed)) !== canonicalJson(toJsonValue(expected)))
		throw new Error("Preregistration differs from its fully reconstructed sealed design");
	return parsed;
}

export async function writeCompilerGymIrDeltaSmokePreregistration(
	path: string,
	preregistration: CompilerGymIrDeltaSmokePreregistration,
): Promise<void> {
	parseCompilerGymIrDeltaSmokePreregistration(preregistration);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(`${canonicalJson(toJsonValue(preregistration))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function generateCompilerGymIrDeltaSmokePreregistration(input: {
	outputPath: string;
	repoRoot: string;
	createdAt?: string;
}): Promise<CompilerGymIrDeltaSmokePreregistration> {
	const canonicalPath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py");
	const treatmentPath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const environmentProbePath = resolve(input.repoRoot, "research/autoresearch/evaluators/compiler_gym_env_probe.py");
	const [{ stdout }, canonicalSource, treatmentSource, environmentProbeSource, implementationClosure] =
		await Promise.all([
			execFileAsync("git", ["rev-parse", "HEAD"], { cwd: input.repoRoot, encoding: "utf8" }),
			readFile(canonicalPath, "utf8"),
			readFile(treatmentPath, "utf8"),
			readFile(environmentProbePath, "utf8"),
			Promise.all(
				COMPILER_GYM_IR_DELTA_IMPLEMENTATION_PATHS.map(async (relativePath) => ({
					relativePath,
					sha256: sha256Text(await readFile(resolve(input.repoRoot, relativePath), "utf8")),
				})),
			),
		]);
	const preregistration = buildCompilerGymIrDeltaSmokePreregistration({
		createdAt: input.createdAt ?? new Date().toISOString(),
		primeAgentCommit: stdout.trim(),
		canonicalPath,
		canonicalSource,
		treatmentPath,
		treatmentSource,
		environmentProbePath,
		environmentProbeSource,
		implementationClosure,
	});
	await writeCompilerGymIrDeltaSmokePreregistration(resolve(input.outputPath), preregistration);
	return preregistration;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length !== 2 || args[0] !== "--output")
		throw new Error("Usage: compiler-gym-ir-delta-smoke-preregistration --output <path>");
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	console.log(
		canonicalJson(
			toJsonValue(await generateCompilerGymIrDeltaSmokePreregistration({ outputPath: args[1], repoRoot })),
		),
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

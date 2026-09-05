import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import { COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT } from "./compiler-gym-action-trace-preregistration.js";
import {
	type CompilerGymIrDeltaQualificationEnvironment,
	DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT,
} from "./compiler-gym-ir-delta-qualification-preregistration.js";
import { COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256 } from "./compiler-gym-ir-delta-smoke-preregistration.js";
import {
	type CompilerGymWarmCommandRunner,
	compilerGymWarmSshArgv,
	SpawnCompilerGymWarmCommandRunner,
} from "./compiler-gym-warm-farmshare-backend.js";

export const COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL = "compiler-gym-paid-live-environment-gate-v1" as const;
export const COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_RELATIVE_PATH =
	"research/autoresearch/evaluators/compiler_gym_env_probe.py" as const;
export const COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256 = COMPILER_GYM_IR_DELTA_ENVIRONMENT_PROBE_SHA256;
export const COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256 = sha256Json(
	COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT,
);
export const COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_STDOUT = `${canonicalJson(
	toJsonValue(COMPILER_GYM_ACTION_TRACE_ENVIRONMENT_PROBE_EXPECTED_RESULT),
)}\n`;

const COMMAND_TIMEOUT_MS = 2 * 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface CompilerGymPaidLiveEnvironmentGateEvidence {
	protocol: typeof COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL;
	probeSourceSha256: typeof COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256;
	expectedResultSha256: string;
	commandSha256: string;
	stdoutSha256: string;
	wallMs: number;
	pass: true;
}

export interface CompilerGymPaidLiveEnvironmentGateInput {
	repoRoot: string;
	commandRunner?: CompilerGymWarmCommandRunner;
	environment?: CompilerGymIrDeltaQualificationEnvironment;
	signal?: AbortSignal;
}

function assertFrozenEnvironment(environment: CompilerGymIrDeltaQualificationEnvironment): void {
	if (
		canonicalJson(toJsonValue(environment)) !==
		canonicalJson(toJsonValue(DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT))
	) {
		throw new Error("Paid live environment gate requires the frozen IR-delta qualification environment");
	}
}

function environmentProbeArgv(
	environment: CompilerGymIrDeltaQualificationEnvironment,
	probeSource: string,
): [string, ...string[]] {
	const encodedSource = Buffer.from(probeSource, "utf8").toString("base64");
	const executeSource =
		`import base64;source=base64.b64decode("${encodedSource}");` +
		'exec(compile(source,"compiler_gym_env_probe.py","exec"))';
	const remoteArgv = [
		"/usr/bin/env",
		"-i",
		"PATH=/usr/bin:/bin",
		"LANG=C.UTF-8",
		`LD_LIBRARY_PATH=${environment.compatibilityLibraryDir}`,
		`COMPILER_GYM_CACHE=${environment.compilerGymCache}`,
		`COMPILER_GYM_SITE_DATA=${environment.compilerGymSiteData}`,
		"PYTHONDONTWRITEBYTECODE=1",
		`PYTHONWARNINGS=${environment.pythonWarnings}`,
		environment.pythonPath,
		"-c",
		executeSource,
	] as [string, ...string[]];
	if (remoteArgv.some((value) => value.includes("srun") || value.includes("sbatch"))) {
		throw new Error("Paid live environment gate must not dispatch Slurm work");
	}
	return compilerGymWarmSshArgv(environment.host, remoteArgv);
}

export async function runCompilerGymPaidLiveEnvironmentGate(
	input: CompilerGymPaidLiveEnvironmentGateInput,
): Promise<CompilerGymPaidLiveEnvironmentGateEvidence> {
	const environment = input.environment ?? DEFAULT_COMPILER_GYM_IR_DELTA_QUALIFICATION_ENVIRONMENT;
	assertFrozenEnvironment(environment);
	const probePath = resolve(input.repoRoot, COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_RELATIVE_PATH);
	const probeSource = await readFile(probePath, "utf8");
	if (sha256Text(probeSource) !== COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256) {
		throw new Error("Paid live environment probe source differs from the frozen seal");
	}
	const argv = environmentProbeArgv(environment, probeSource);
	const result = await (input.commandRunner ?? new SpawnCompilerGymWarmCommandRunner()).run({
		argv,
		signal: input.signal,
		timeoutMs: COMMAND_TIMEOUT_MS,
		maxOutputBytes: MAX_OUTPUT_BYTES,
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Paid live environment probe failed with exit ${result.exitCode ?? "signal"}: ${result.stderr.trim()}`,
		);
	}
	if (result.stderr !== "") throw new Error("Paid live environment probe emitted stderr");
	if (result.stdout !== COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_STDOUT) {
		throw new Error("Paid live environment probe does not exactly match the frozen seal");
	}
	return {
		protocol: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
		probeSourceSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
		expectedResultSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
		commandSha256: sha256Json(argv),
		stdoutSha256: sha256Text(result.stdout),
		wallMs: result.wallMs,
		pass: true,
	};
}

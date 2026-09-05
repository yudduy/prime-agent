import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sha256Json, sha256Text } from "./canonical-json.js";
import { COMPILER_GYM_EVALUATOR_SHA256, COMPILER_GYM_VERIFIER_EPOCH } from "./compiler-gym-adapter.js";
import {
	compilerGymWarmSshArgv,
	DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG,
	SpawnCompilerGymWarmCommandRunner,
} from "./compiler-gym-warm-farmshare-backend.js";
import {
	COMPILER_GYM_WARM_LAUNCH_CONTRACT,
	COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256,
} from "./compiler-gym-warm-transport.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import {
	runStockInterfaceTransportPair,
	STOCK_INTERFACE_TRANSPORT_EXPECTED,
	STOCK_INTERFACE_TRANSPORT_FARMSHARE_CONFIG,
	STOCK_INTERFACE_TRANSPORT_PAIR_PROTOCOL,
	STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_DENOMINATOR,
	STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_NUMERATOR,
	STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256,
	type StockInterfaceTransportArm,
} from "./stock-interface-transport-pair.js";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_PREREGISTRATION_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/stock-interface-transport-pair/preregistration-v1.json",
);
const DEFAULT_RUNTIME_MANIFEST_PATH = join(
	REPOSITORY_ROOT,
	".autoresearch/stock-interface-transport-pair/runtime-manifest-v1.json",
);
const EXPECTED_OUTPUT_PATH = ".autoresearch/stock-interface-transport-pair/execution-v1" as const;
const EXPECTED_EXECUTION_EPOCH = "execution-v1" as const;
const EXPECTED_CONFIG_SHA256 = "dbf9aafe01ba585c3207d198748a2ab68a57475a95a1d496c1737e0816e44324" as const;
const EXPECTED_PRIME_COMMIT = "bc0fa7606abb3b7af0f765319518d255e6ae553d" as const;
const RUNTIME_PROTOCOL = "compiler-gym-stock-interface-transport-pair-runtime-v1" as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DRAW_PATTERN = /^[a-f0-9]{32}$/;

const REQUIRED_RUNTIME_PATHS = [
	"research/autoresearch/environments/compiler-gym-farmshare-v2.requirements.txt",
	"research/autoresearch/environments/compiler-gym-site-data-v2.lock",
	"research/autoresearch/evaluators/compiler_gym_dataset_bootstrap.py",
	"research/autoresearch/evaluators/compiler_gym_env_probe.py",
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_warm_worker.py",
	"research/autoresearch/farmshare/compiler-gym-environment.lock",
	"research/autoresearch/src/artifact-store.ts",
	"research/autoresearch/src/canonical-json.ts",
	"research/autoresearch/src/compiler-gym-adapter.ts",
	"research/autoresearch/src/compiler-gym-warm-farmshare-backend.ts",
	"research/autoresearch/src/compiler-gym-warm-pilot-record-evidence.ts",
	"research/autoresearch/src/compiler-gym-warm-transport.ts",
	"research/autoresearch/src/controller.ts",
	"research/autoresearch/src/evaluation-adapter-output-error.ts",
	"research/autoresearch/src/ledger.ts",
	"research/autoresearch/src/stock-cpu-protocol.ts",
	"research/autoresearch/src/stock-interface-parity-protocol.ts",
	"research/autoresearch/src/stock-interface-transport-pair-sealed.ts",
	"research/autoresearch/src/stock-interface-transport-pair.ts",
	"research/autoresearch/src/types.ts",
] as const;

export interface SealedStockInterfaceTransportPair {
	preregistrationPath: string;
	preregistrationSha256: string;
	runtimeManifestPath: string;
	runtimeManifestSha256: string;
	outputDir: string;
	branchId: string;
	armOrder: readonly [StockInterfaceTransportArm, StockInterfaceTransportArm];
	workerSha256: string;
}

interface DispatchPreflightObservation {
	label: string;
	argv: string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	stdoutSha256: string;
	stderrSha256: string;
	wallMs: number;
}

interface DispatchPreflight {
	protocol: "compiler-gym-stock-interface-transport-pair-dispatch-preflight-v1";
	capturedAt: string;
	pass: true;
	observations: DispatchPreflightObservation[];
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

function requiredInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
	return value as number;
}

function requiredSha256(value: unknown, label: string): string {
	const digest = requiredString(value, label);
	if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256`);
	return digest;
}

function resolveInsideRepository(path: string, label: string): string {
	if (isAbsolute(path)) throw new Error(`${label} must be repository-relative`);
	const resolved = resolve(REPOSITORY_ROOT, path);
	const relativePath = relative(REPOSITORY_ROOT, resolved);
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
		throw new Error(`${label} escapes the repository`);
	}
	return resolved;
}

function parseArmOrder(
	value: unknown,
	drawHex: string,
): readonly [StockInterfaceTransportArm, StockInterfaceTransportArm] {
	if (!Array.isArray(value) || value.length !== 2) throw new Error("Preregistered arm order must have two entries");
	const observed = value.map((arm) => requiredString(arm, "arm order entry"));
	const expected: readonly [StockInterfaceTransportArm, StockInterfaceTransportArm] =
		Number.parseInt(drawHex.slice(0, 2), 16) % 2 === 0
			? ["stock-cold-control", "stock-warm-treatment"]
			: ["stock-warm-treatment", "stock-cold-control"];
	assert.deepEqual(observed, expected, "Preregistered arm order does not match the sealed draw");
	return expected;
}

async function verifyRuntimeFiles(value: unknown): Promise<void> {
	if (!Array.isArray(value)) throw new Error("Runtime manifest files must be an array");
	const files = value.map((entry, index) => {
		const record = objectRecord(entry, `runtime files[${index}]`);
		return {
			path: requiredString(record.path, `runtime files[${index}].path`),
			sha256: requiredSha256(record.sha256, `runtime files[${index}].sha256`),
		};
	});
	assert.deepEqual(
		files.map((file) => file.path).sort(),
		[...REQUIRED_RUNTIME_PATHS].sort(),
		"Runtime manifest file set is incomplete or contains extra files",
	);
	for (const file of files) {
		const contents = await readFile(resolveInsideRepository(file.path, `runtime file ${file.path}`), "utf8");
		assert.equal(sha256Text(contents), file.sha256, `Sealed runtime file drifted: ${file.path}`);
	}
}

export async function loadSealedStockInterfaceTransportPair(
	preregistrationPath = DEFAULT_PREREGISTRATION_PATH,
	runtimeManifestPath = DEFAULT_RUNTIME_MANIFEST_PATH,
): Promise<SealedStockInterfaceTransportPair> {
	const [preregistrationContents, runtimeManifestContents] = await Promise.all([
		readFile(preregistrationPath, "utf8"),
		readFile(runtimeManifestPath, "utf8"),
	]);
	const preregistrationSha256 = sha256Text(preregistrationContents);
	const runtimeManifestSha256 = sha256Text(runtimeManifestContents);
	const preregistration = objectRecord(JSON.parse(preregistrationContents) as unknown, "preregistration");
	const runtimeManifest = objectRecord(JSON.parse(runtimeManifestContents) as unknown, "runtime manifest");

	assert.equal(preregistration.schemaVersion, 1);
	assert.equal(preregistration.protocol, STOCK_INTERFACE_TRANSPORT_PAIR_PROTOCOL);
	assert.equal(preregistration.executionEpoch, EXPECTED_EXECUTION_EPOCH);
	assert.equal(preregistration.claimClass, "directional-operational-integration-screen");
	assert.equal(preregistration.causalClaimAllowed, false);
	assert.equal(preregistration.modelCalls, 0);
	assert.equal(preregistration.gpuTransferAllowed, false);
	const randomization = objectRecord(preregistration.randomization, "preregistration.randomization");
	assert.equal(randomization.method, "cryptographic-byte-parity-v1");
	const drawHex = requiredString(randomization.drawHex, "randomization.drawHex");
	if (!DRAW_PATTERN.test(drawHex)) throw new Error("Randomization draw must be 16 lowercase hexadecimal bytes");
	const armOrder = parseArmOrder(randomization.armOrder, drawHex);

	const execution = objectRecord(preregistration.execution, "preregistration.execution");
	const outputPath = requiredString(execution.outputDir, "execution.outputDir");
	assert.equal(outputPath, EXPECTED_OUTPUT_PATH);
	const branchId = requiredString(execution.branchId, "execution.branchId");
	if (!/^[A-Za-z0-9._:-]{1,128}$/.test(branchId)) throw new Error("Preregistered branch ID is unsafe");
	assert.equal(execution.controllerLifetime, "one-controller-one-ledger-four-sequential-calls-v1");
	assert.equal(execution.concurrentArms, false);

	const pins = objectRecord(preregistration.pins, "preregistration.pins");
	assert.equal(pins.primeAgentCommit, EXPECTED_PRIME_COMMIT);
	assert.equal(pins.requestSetSha256, STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256);
	assert.equal(pins.configSha256, EXPECTED_CONFIG_SHA256);
	assert.equal(sha256Json(STOCK_INTERFACE_TRANSPORT_FARMSHARE_CONFIG), EXPECTED_CONFIG_SHA256);
	assert.equal(pins.evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
	assert.equal(pins.launchContractSha256, COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256);
	assert.equal(pins.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
	const workerSha256 = requiredSha256(pins.workerSha256, "pins.workerSha256");
	const sourceLedgerPath = resolveInsideRepository(
		requiredString(pins.sourceLedger, "pins.sourceLedger"),
		"pins.sourceLedger",
	);
	const sourceLedgerContents = await readFile(sourceLedgerPath, "utf8");
	assert.equal(sha256Text(sourceLedgerContents), pins.sourceLedgerSha256, "Pinned source ledger bytes drifted");
	const sourceEvents = verifyLedgerContentsStrict(sourceLedgerContents);
	assert.equal(
		sourceEvents.at(-1)?.hash,
		pins.sourceLedgerTerminalEventSha256,
		"Pinned source ledger terminal event drifted",
	);
	assert.deepEqual(preregistration.candidates, STOCK_INTERFACE_TRANSPORT_EXPECTED);

	const budgets = objectRecord(preregistration.budgets, "preregistration.budgets");
	assert.equal(requiredInteger(budgets.arms, "budgets.arms"), 2);
	assert.equal(requiredInteger(budgets.candidates, "budgets.candidates"), 8);
	assert.equal(requiredInteger(budgets.freshTaskEvaluations, "budgets.freshTaskEvaluations"), 16);
	assert.equal(requiredInteger(budgets.providerCalls, "budgets.providerCalls"), 0);
	assert.equal(requiredInteger(budgets.gpuHours, "budgets.gpuHours"), 0);
	const gate = objectRecord(preregistration.gate, "preregistration.gate");
	assert.equal(gate.integrityFirst, true);
	assert.equal(gate.warmRatioNumerator, Number(STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_NUMERATOR));
	assert.equal(gate.coldRatioDenominator, Number(STOCK_INTERFACE_TRANSPORT_PAIR_RATIO_DENOMINATOR));
	assert.equal(gate.passDecision, "promote-to-agent-facing-cpu-screen");
	assert.equal(gate.failDecision, "keep-stock-cold");

	assert.equal(runtimeManifest.schemaVersion, 1);
	assert.equal(runtimeManifest.protocol, RUNTIME_PROTOCOL);
	assert.equal(runtimeManifest.preregistrationSha256, preregistrationSha256);
	assert.equal(runtimeManifest.primeAgentCommit, EXPECTED_PRIME_COMMIT);
	assert.equal(runtimeManifest.requestSetSha256, STOCK_INTERFACE_TRANSPORT_REQUEST_SET_SHA256);
	assert.equal(runtimeManifest.workerSha256, workerSha256);
	assert.equal(runtimeManifest.evaluatorSha256, COMPILER_GYM_EVALUATOR_SHA256);
	assert.equal(runtimeManifest.launchContractSha256, COMPILER_GYM_WARM_LAUNCH_CONTRACT_SHA256);
	assert.equal(runtimeManifest.verifierEpoch, COMPILER_GYM_VERIFIER_EPOCH);
	await verifyRuntimeFiles(runtimeManifest.files);

	const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT });
	assert.equal(stdout.trim(), EXPECTED_PRIME_COMMIT, "Prime Agent commit drifted from the preregistration");
	return {
		preregistrationPath,
		preregistrationSha256,
		runtimeManifestPath,
		runtimeManifestSha256,
		outputDir: resolveInsideRepository(outputPath, "execution.outputDir"),
		branchId,
		armOrder,
		workerSha256,
	};
}

async function assertOutputAbsent(path: string): Promise<void> {
	try {
		await access(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	throw new Error(`Sealed execution output already exists: ${path}`);
}

async function captureDispatchPreflight(): Promise<DispatchPreflight> {
	const runner = new SpawnCompilerGymWarmCommandRunner();
	const backendConfig = DEFAULT_FARMSHARE_COMPILER_GYM_WARM_BACKEND_CONFIG;
	const probePath = fileURLToPath(new URL("../evaluators/compiler_gym_env_probe.py", import.meta.url));
	const probeSource = await readFile(probePath, "utf8");
	const probeEncoded = Buffer.from(probeSource, "utf8").toString("base64");
	const probeCommand =
		`import base64;source=base64.b64decode("${probeEncoded}");` +
		'exec(compile(source,"compiler_gym_env_probe.py","exec"))';
	const commands: Array<{ label: string; argv: [string, ...string[]] }> = [
		{ label: "identity", argv: ["/usr/bin/id", "-un"] },
		{
			label: "user-queue",
			argv: ["/usr/bin/squeue", "--noheader", "--user", backendConfig.user, "--format=%A|%T|%P|%j|%R"],
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
				probeCommand,
			],
		},
	];
	const observations: DispatchPreflightObservation[] = [];
	for (const command of commands) {
		const result = await runner.run({
			argv: compilerGymWarmSshArgv(backendConfig.host, command.argv),
			timeoutMs: 30_000,
			maxOutputBytes: 1024 * 1024,
		});
		const observation = {
			label: command.label,
			argv: [...command.argv],
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			stdoutSha256: sha256Text(result.stdout),
			stderrSha256: sha256Text(result.stderr),
			wallMs: result.wallMs,
		};
		observations.push(observation);
		if (result.exitCode !== 0) throw new Error(`Dispatch preflight ${command.label} exited ${result.exitCode}`);
	}
	assert.equal(observations[0]?.stdout.trim(), backendConfig.user, "FarmShare identity drifted");
	assert.equal(observations[1]?.stdout.trim(), "", "FarmShare user queue was not empty before dispatch");
	const environmentSeal = objectRecord(
		JSON.parse(observations[2]?.stdout.trim() ?? "") as unknown,
		"remote environment seal",
	);
	assert.equal(environmentSeal.protocol, "compiler-gym-farmshare-environment-probe-v1");
	assert.equal(environmentSeal.pass, true);
	return {
		protocol: "compiler-gym-stock-interface-transport-pair-dispatch-preflight-v1",
		capturedAt: new Date().toISOString(),
		pass: true,
		observations,
	};
}

function errorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function main(): Promise<void> {
	const sealed = await loadSealedStockInterfaceTransportPair();
	await assertOutputAbsent(sealed.outputDir);
	const dispatchPreflight = await captureDispatchPreflight();
	const startedAt = new Date().toISOString();
	let dispatched = false;
	try {
		dispatched = true;
		const result = await runStockInterfaceTransportPair({
			outputDir: sealed.outputDir,
			branchId: sealed.branchId,
			armOrder: sealed.armOrder,
			workerSha256: sealed.workerSha256,
		});
		const resultPath = join(sealed.outputDir, "result.json");
		const resultSha256 = sha256Text(await readFile(resultPath, "utf8"));
		const executionManifest = {
			protocol: "compiler-gym-stock-interface-transport-pair-execution-v1",
			status: "completed",
			startedAt,
			finishedAt: new Date().toISOString(),
			preregistrationPath: relative(REPOSITORY_ROOT, sealed.preregistrationPath),
			preregistrationSha256: sealed.preregistrationSha256,
			runtimeManifestPath: relative(REPOSITORY_ROOT, sealed.runtimeManifestPath),
			runtimeManifestSha256: sealed.runtimeManifestSha256,
			resultSha256,
			decision: result.analysis.decision,
			dispatchPreflight,
		};
		await writeFile(
			join(sealed.outputDir, "execution-manifest.json"),
			`${JSON.stringify(executionManifest, null, 2)}\n`,
			{
				encoding: "utf8",
				mode: 0o600,
			},
		);
		process.stdout.write(`${JSON.stringify(executionManifest)}\n`);
	} catch (error) {
		if (dispatched) {
			await mkdir(dirname(join(sealed.outputDir, "failure.json")), { recursive: true, mode: 0o700 });
			await writeFile(
				join(sealed.outputDir, "failure.json"),
				`${JSON.stringify(
					{
						protocol: "compiler-gym-stock-interface-transport-pair-execution-v1",
						status: "failed",
						startedAt,
						finishedAt: new Date().toISOString(),
						preregistrationSha256: sealed.preregistrationSha256,
						runtimeManifestSha256: sealed.runtimeManifestSha256,
						dispatchPreflight,
						error: errorText(error),
					},
					null,
					2,
				)}\n`,
				{ encoding: "utf8", mode: 0o600 },
			);
		}
		throw error;
	}
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
	main().catch((error: unknown) => {
		process.stderr.write(`${errorText(error)}\n`);
		process.exitCode = 1;
	});
}

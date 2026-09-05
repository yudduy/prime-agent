import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { openReducedCpuStudyController, submitReducedCpuSearchCandidate } from "./reduced-cpu-study-controller.js";
import {
	parseReducedCpuCalibration,
	parseSealedReducedCpuRetestDirective,
	REDUCED_CPU_STUDY_ARMS,
	type ReducedCpuStudyArm,
	type SealedReducedCpuRetestDirective,
} from "./reduced-cpu-study-protocol.js";

export const REDUCED_CPU_IPYTHON_SUBPROCESS_PROTOCOL = "prime-native-ipython-subprocess-reduced-cpu-v1" as const;

export interface ReducedCpuStudyEvaluatorCliOptions {
	outputDir: string;
	arm: ReducedCpuStudyArm;
	branchId: string;
	calibrationPath: string;
	retestDirectivePath: string | null;
}

export function buildReducedCpuStudyEvaluatorArgv(input: {
	nodeExecutable: string;
	tsxLoader: string;
	evaluatorCliPath: string;
	options: ReducedCpuStudyEvaluatorCliOptions;
}): string[] {
	return [
		input.nodeExecutable,
		"--import",
		input.tsxLoader,
		input.evaluatorCliPath,
		"--output-dir",
		resolve(input.options.outputDir),
		"--arm",
		input.options.arm,
		"--branch-id",
		input.options.branchId,
		"--calibration",
		resolve(input.options.calibrationPath),
		...(input.options.retestDirectivePath ? ["--retest-directive", resolve(input.options.retestDirectivePath)] : []),
	];
}

function parseArm(value: string): ReducedCpuStudyArm {
	if (!REDUCED_CPU_STUDY_ARMS.includes(value as ReducedCpuStudyArm)) throw new Error(`Unknown study arm: ${value}`);
	return value as ReducedCpuStudyArm;
}

export function parseReducedCpuStudyEvaluatorOptions(argv: readonly string[]): ReducedCpuStudyEvaluatorCliOptions {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key || !value || !key.startsWith("--")) throw new Error("Evaluator CLI arguments must be name/value pairs");
		if (values.has(key)) throw new Error(`Duplicate evaluator option: ${key}`);
		if (!["--output-dir", "--arm", "--branch-id", "--calibration", "--retest-directive"].includes(key)) {
			throw new Error(`Unknown evaluator option: ${key}`);
		}
		values.set(key, value);
	}
	for (const key of ["--output-dir", "--arm", "--branch-id", "--calibration"]) {
		if (!values.has(key)) throw new Error(`Missing evaluator option: ${key}`);
	}
	const branchId = values.get("--branch-id") ?? "";
	if (!/^[A-Za-z0-9._:-]{1,160}$/.test(branchId)) throw new Error("Branch ID contains unsupported characters");
	return {
		outputDir: resolve(values.get("--output-dir") ?? ""),
		arm: parseArm(values.get("--arm") ?? ""),
		branchId,
		calibrationPath: resolve(values.get("--calibration") ?? ""),
		retestDirectivePath: values.has("--retest-directive") ? resolve(values.get("--retest-directive") ?? "") : null,
	};
}

async function readPrivateJson(path: string, label: string): Promise<unknown> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
	if ((metadata.mode & 0o077) !== 0) throw new Error(`${label} must not grant group or other permissions`);
	if (metadata.size > 4 * 1024 * 1024) throw new Error(`${label} exceeds 4 MiB`);
	return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readRequest(): Promise<unknown> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	for await (const chunk of process.stdin) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		totalBytes += buffer.byteLength;
		if (totalBytes > 64 * 1024) throw new Error("Evaluator request exceeds 64 KiB");
		chunks.push(buffer);
	}
	if (chunks.length === 0) throw new Error("Evaluator request is empty");
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function writeReceipt(outputDir: string, ordinal: number, value: unknown): Promise<string> {
	const receiptDir = join(outputDir, "receipts");
	await mkdir(receiptDir, { recursive: true, mode: 0o700 });
	await chmod(receiptDir, 0o700);
	const path = join(receiptDir, `candidate-${ordinal}.json`);
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
		flag: "wx",
	});
	await chmod(path, 0o600);
	return path;
}

export async function runReducedCpuStudyEvaluation(
	options: ReducedCpuStudyEvaluatorCliOptions,
	request: unknown,
): Promise<{ receiptPath: string; envelope: Awaited<ReturnType<typeof submitReducedCpuSearchCandidate>> }> {
	const calibration = parseReducedCpuCalibration(await readPrivateJson(options.calibrationPath, "calibration"));
	let sealedRetestDirective: SealedReducedCpuRetestDirective | undefined;
	if (options.retestDirectivePath) {
		sealedRetestDirective = parseSealedReducedCpuRetestDirective(
			await readPrivateJson(options.retestDirectivePath, "retest directive"),
		);
	}
	const controller = await openReducedCpuStudyController({ outputDir: options.outputDir, arm: options.arm });
	const envelope = await submitReducedCpuSearchCandidate({
		controller,
		outputDir: options.outputDir,
		arm: options.arm,
		branchId: options.branchId,
		calibration,
		request,
		sealedRetestDirective,
	});
	const receiptPath = await writeReceipt(options.outputDir, envelope.ordinal, envelope);
	return { receiptPath, envelope };
}

async function main(): Promise<void> {
	const options = parseReducedCpuStudyEvaluatorOptions(process.argv.slice(2));
	const result = await runReducedCpuStudyEvaluation(options, await readRequest());
	console.log(
		JSON.stringify({
			protocol: REDUCED_CPU_IPYTHON_SUBPROCESS_PROTOCOL,
			receiptPath: result.receiptPath,
			...result.envelope,
		}),
	);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === resolve(fileURLToPath(import.meta.url))) await main();

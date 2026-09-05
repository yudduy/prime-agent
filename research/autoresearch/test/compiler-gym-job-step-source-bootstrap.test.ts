import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sha256Text } from "../src/canonical-json.js";
import {
	buildCompilerGymJobStepSourceBootstrap,
	COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL,
} from "../src/compiler-gym-job-step-source-bootstrap.js";

const execFileAsync = promisify(execFile);
const PYTHON_PATH = "/usr/bin/python3";
const BOOTSTRAP_PREFIX = "exec(compile(";
const BOOTSTRAP_SUFFIX = ', "<sealed-source-bootstrap>", "exec"))';
const WORKER_SOURCE = `import json
print(json.dumps({
    "workerSha256": __sealed_worker_sha256__,
    "evaluatorSource": __sealed_evaluator_source__,
    "evaluatorSha256": __sealed_evaluator_sha256__,
}, sort_keys=True, separators=(",", ":")))
`;
const EVALUATOR_SOURCE = "print('sealed evaluator')\n";

function fixture() {
	return buildCompilerGymJobStepSourceBootstrap({
		workerSource: WORKER_SOURCE,
		workerSha256: sha256Text(WORKER_SOURCE),
		evaluatorSource: EVALUATOR_SOURCE,
		evaluatorSha256: sha256Text(EVALUATOR_SOURCE),
	});
}

function unpackBootstrap(pythonSource: string): string {
	assert.ok(pythonSource.startsWith(BOOTSTRAP_PREFIX));
	assert.ok(pythonSource.endsWith(BOOTSTRAP_SUFFIX));
	return JSON.parse(pythonSource.slice(BOOTSTRAP_PREFIX.length, -BOOTSTRAP_SUFFIX.length)) as string;
}

function packBootstrap(pythonBody: string): string {
	return `${BOOTSTRAP_PREFIX}${JSON.stringify(pythonBody)}${BOOTSTRAP_SUFFIX}`;
}

async function assertBootstrapFailure(pythonSource: string, pattern: RegExp, args: string[] = []): Promise<void> {
	await assert.rejects(execFileAsync(PYTHON_PATH, ["-c", pythonSource, ...args]), (error: unknown) => {
		const stderr = (error as { stderr?: string }).stderr ?? "";
		assert.match(stderr, pattern);
		return true;
	});
}

describe("CompilerGym job-step source bootstrap", () => {
	it("builds deterministic compressed source and injects only verified globals", async () => {
		const first = fixture();
		const second = fixture();
		assert.deepEqual(first, second);
		assert.equal(first.protocol, COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL);
		assert.equal(first.pythonSourceSha256, sha256Text(first.pythonSource));
		assert.doesNotMatch(first.pythonSource, /[\0\r\n]/);
		assert.equal(first.workerSourceBytes, Buffer.byteLength(WORKER_SOURCE));
		assert.equal(first.evaluatorSourceBytes, Buffer.byteLength(EVALUATOR_SOURCE));
		const { stdout, stderr } = await execFileAsync(PYTHON_PATH, ["-c", first.pythonSource]);
		assert.equal(stderr, "");
		assert.deepEqual(JSON.parse(stdout), {
			workerSha256: sha256Text(WORKER_SOURCE),
			evaluatorSource: EVALUATOR_SOURCE,
			evaluatorSha256: sha256Text(EVALUATOR_SOURCE),
		});
	});

	it("rejects source/hash mismatches before building", () => {
		assert.throws(
			() =>
				buildCompilerGymJobStepSourceBootstrap({
					workerSource: WORKER_SOURCE,
					workerSha256: "0".repeat(64),
					evaluatorSource: EVALUATOR_SOURCE,
					evaluatorSha256: sha256Text(EVALUATOR_SOURCE),
				}),
			/workerSource SHA-256 mismatch/,
		);
	});

	it("makes the worker reject direct execution without sealed globals", async () => {
		const workerSource = await readFile(
			fileURLToPath(new URL("../evaluators/compiler_gym_job_step_worker.py", import.meta.url)),
			"utf8",
		);
		const workerSha256 = sha256Text(workerSource);
		await assertBootstrapFailure(workerSource, /sealed source globals are required/, [
			"--request",
			"/tmp/prime-autoresearch-missing-request.json",
			"--request-file-sha256",
			"0".repeat(64),
			"--worker-sha256",
			workerSha256,
			"--evaluator-sha256",
			"1".repeat(64),
			"--python",
			PYTHON_PATH,
			"--expected-root-job-id",
			"1",
		]);
	});

	it("fails closed on invalid base64, compressed bytes, size, and digest", async () => {
		const bootstrap = fixture();
		const pythonBody = unpackBootstrap(bootstrap.pythonSource);
		const invalidBase64 = packBootstrap(pythonBody.replace('_WORKER_SOURCE_B64 = "', '_WORKER_SOURCE_B64 = "!'));
		await assertBootstrapFailure(invalidBase64, /worker base64 decode failed/);

		const invalidCompressed = packBootstrap(
			pythonBody.replace(
				/_WORKER_SOURCE_B64 = "[^"]+"/,
				`_WORKER_SOURCE_B64 = ${JSON.stringify(Buffer.from("not-deflate").toString("base64"))}`,
			),
		);
		await assertBootstrapFailure(invalidCompressed, /worker decompression failed/);
		const workerPayload = pythonBody.match(/_WORKER_SOURCE_B64 = "([^"]+)"/)?.[1];
		assert.ok(workerPayload);
		const trailingCompressedByte = packBootstrap(
			pythonBody.replace(
				`_WORKER_SOURCE_B64 = ${JSON.stringify(workerPayload)}`,
				`_WORKER_SOURCE_B64 = ${JSON.stringify(Buffer.concat([Buffer.from(workerPayload, "base64"), Buffer.of(0)]).toString("base64"))}`,
			),
		);
		await assertBootstrapFailure(trailingCompressedByte, /worker compressed stream framing mismatch/);

		const wrongSize = packBootstrap(
			pythonBody.replace(
				`_EVALUATOR_SOURCE_BYTES = ${bootstrap.evaluatorSourceBytes}`,
				`_EVALUATOR_SOURCE_BYTES = ${bootstrap.evaluatorSourceBytes + 1}`,
			),
		);
		await assertBootstrapFailure(wrongSize, /evaluator byte length mismatch/);

		const wrongHash = packBootstrap(
			pythonBody.replace(
				`_EVALUATOR_SOURCE_SHA256 = ${JSON.stringify(sha256Text(EVALUATOR_SOURCE))}`,
				`_EVALUATOR_SOURCE_SHA256 = ${JSON.stringify("0".repeat(64))}`,
			),
		);
		await assertBootstrapFailure(wrongHash, /evaluator SHA-256 mismatch/);
	});
});

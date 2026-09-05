import { deflateRawSync, constants as zlibConstants } from "node:zlib";
import { sha256Text } from "./canonical-json.js";

export const COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL = "compiler-gym-job-step-source-bootstrap-v1" as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_WORKER_SOURCE_BYTES = 1024 * 1024;
const MAX_EVALUATOR_SOURCE_BYTES = 8 * 1024 * 1024;

export interface CompilerGymJobStepSourceBootstrapInput {
	workerSource: string;
	workerSha256: string;
	evaluatorSource: string;
	evaluatorSha256: string;
}

export interface CompilerGymJobStepSourceBootstrap {
	protocol: typeof COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL;
	pythonSource: string;
	pythonSourceSha256: string;
	workerSourceBytes: number;
	evaluatorSourceBytes: number;
}

function validateSource(label: string, source: string, expectedSha256: string, maxBytes: number): Buffer {
	if (!SHA256_PATTERN.test(expectedSha256)) throw new Error(`${label} SHA-256 must be lowercase hexadecimal`);
	const sourceBytes = Buffer.from(source, "utf8");
	if (sourceBytes.length === 0 || sourceBytes.length > maxBytes) {
		throw new Error(`${label} must contain between 1 and ${maxBytes} UTF-8 bytes`);
	}
	if (sha256Text(source) !== expectedSha256) throw new Error(`${label} SHA-256 mismatch`);
	return sourceBytes;
}

function compressedBase64(source: Buffer): string {
	return deflateRawSync(source, {
		level: zlibConstants.Z_BEST_COMPRESSION,
		strategy: zlibConstants.Z_FIXED,
	}).toString("base64");
}

export function buildCompilerGymJobStepSourceBootstrap(
	input: CompilerGymJobStepSourceBootstrapInput,
): CompilerGymJobStepSourceBootstrap {
	const workerBytes = validateSource("workerSource", input.workerSource, input.workerSha256, MAX_WORKER_SOURCE_BYTES);
	const evaluatorBytes = validateSource(
		"evaluatorSource",
		input.evaluatorSource,
		input.evaluatorSha256,
		MAX_EVALUATOR_SOURCE_BYTES,
	);
	const workerPayload = compressedBase64(workerBytes);
	const evaluatorPayload = compressedBase64(evaluatorBytes);
	const pythonBody = `import base64 as _base64
import binascii as _binascii
import hashlib as _hashlib
import zlib as _zlib

_WORKER_SOURCE_B64 = ${JSON.stringify(workerPayload)}
_WORKER_SOURCE_BYTES = ${workerBytes.length}
_WORKER_SOURCE_SHA256 = ${JSON.stringify(input.workerSha256)}
_EVALUATOR_SOURCE_B64 = ${JSON.stringify(evaluatorPayload)}
_EVALUATOR_SOURCE_BYTES = ${evaluatorBytes.length}
_EVALUATOR_SOURCE_SHA256 = ${JSON.stringify(input.evaluatorSha256)}

def _sealed_source(label, encoded, expected_bytes, expected_sha256):
    try:
        compressed = _base64.b64decode(encoded, validate=True)
    except (_binascii.Error, ValueError) as error:
        raise SystemExit(f"{label} base64 decode failed: {error}") from error
    try:
        decompressor = _zlib.decompressobj(-_zlib.MAX_WBITS)
        source_bytes = decompressor.decompress(compressed, expected_bytes + 1)
    except _zlib.error as error:
        raise SystemExit(f"{label} decompression failed: {error}") from error
    if decompressor.unconsumed_tail:
        raise SystemExit(f"{label} byte length mismatch")
    try:
        source_bytes += decompressor.flush()
    except _zlib.error as error:
        raise SystemExit(f"{label} decompression failed: {error}") from error
    if not decompressor.eof or decompressor.unused_data:
        raise SystemExit(f"{label} compressed stream framing mismatch")
    if len(source_bytes) != expected_bytes:
        raise SystemExit(f"{label} byte length mismatch")
    if _hashlib.sha256(source_bytes).hexdigest() != expected_sha256:
        raise SystemExit(f"{label} SHA-256 mismatch")
    try:
        return source_bytes.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise SystemExit(f"{label} UTF-8 decode failed: {error}") from error

_worker_source = _sealed_source(
    "worker",
    _WORKER_SOURCE_B64,
    _WORKER_SOURCE_BYTES,
    _WORKER_SOURCE_SHA256,
)
_evaluator_source = _sealed_source(
    "evaluator",
    _EVALUATOR_SOURCE_B64,
    _EVALUATOR_SOURCE_BYTES,
    _EVALUATOR_SOURCE_SHA256,
)
_worker_globals = {
    "__name__": "__main__",
    "__sealed_worker_sha256__": _WORKER_SOURCE_SHA256,
    "__sealed_evaluator_source__": _evaluator_source,
    "__sealed_evaluator_sha256__": _EVALUATOR_SOURCE_SHA256,
}
exec(compile(_worker_source, "<sealed-compiler-gym-job-step-worker>", "exec"), _worker_globals, _worker_globals)
`;
	const pythonSource = `exec(compile(${JSON.stringify(pythonBody)}, "<sealed-source-bootstrap>", "exec"))`;
	return {
		protocol: COMPILER_GYM_JOB_STEP_SOURCE_BOOTSTRAP_PROTOCOL,
		pythonSource,
		pythonSourceSha256: sha256Text(pythonSource),
		workerSourceBytes: workerBytes.length,
		evaluatorSourceBytes: evaluatorBytes.length,
	};
}

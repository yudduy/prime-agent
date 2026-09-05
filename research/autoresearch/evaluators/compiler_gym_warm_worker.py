#!/usr/bin/env python3
"""Durable two-slot spool worker for CompilerGym warm-allocation pilots.

The allocation is warm; the evaluator is not. Each claimed request launches the
unchanged content-addressed evaluator in a fresh child process with an isolated
transient cache. This worker never parses or weakens evaluator output.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, NoReturn, Optional, Sequence


PROTOCOL = "compiler-gym-warm-allocation-v1"
TASKS = (
    "benchmark://cbench-v1/blowfish",
    "benchmark://cbench-v1/bzip2",
)
CPUS_PER_TASK = 2
MAX_REQUESTS = 4
DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
DEFAULT_CHILD_TERMINATION_GRACE_SECONDS = 1.0
HASH_PATTERN = re.compile(r"[0-9a-f]{64}")
SLURM_ID_PATTERN = re.compile(r"[1-9][0-9]*")
JOB_ID_PATTERN = re.compile(r"[A-Za-z0-9._:-]{1,160}")
_termination_signal: Optional[int] = None


class WorkerFailure(RuntimeError):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


class WorkerCancellation(RuntimeError):
    def __init__(self, signum: int) -> None:
        super().__init__(f"worker received {signal.Signals(signum).name}")
        self.signum = signum


def request_termination(signum: int, _frame: object) -> None:
    global _termination_signal
    if _termination_signal is None:
        _termination_signal = signum


def install_termination_handlers() -> None:
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, request_termination)


def raise_if_termination_requested() -> None:
    if _termination_signal is not None:
        raise WorkerCancellation(_termination_signal)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_value(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reject_duplicate_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise WorkerFailure("contract", f"duplicate JSON key: {key}")
        result[key] = value
    return result


def expect_record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise WorkerFailure("contract", f"{label} must be an object")
    return value


def expect_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise WorkerFailure(
            "contract",
            f"{label} keys mismatch: missing={sorted(expected - set(value))}, "
            f"extra={sorted(set(value) - expected)}",
        )


def expect_string(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise WorkerFailure("contract", f"{label} must be a string")
    return value


def expect_hash(value: object, label: str) -> str:
    digest = expect_string(value, label)
    if HASH_PATTERN.fullmatch(digest) is None:
        raise WorkerFailure("contract", f"{label} must be a lowercase SHA-256")
    return digest


def expect_timestamp(value: object, label: str) -> str:
    observed = expect_string(value, label)
    try:
        dt.datetime.fromisoformat(observed.replace("Z", "+00:00"))
    except ValueError as error:
        raise WorkerFailure("contract", f"{label} must be an ISO timestamp") from error
    return observed


def expect_equal(observed: object, expected: object, label: str) -> None:
    if observed != expected:
        raise WorkerFailure(
            "contract",
            f"{label} mismatch: expected {expected!r}, received {observed!r}",
        )


def inspect_directory(path: Path, label: str) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise WorkerFailure("filesystem", f"cannot inspect {label}: {error}") from error
    if path.is_symlink() or not stat.S_ISDIR(metadata.st_mode):
        raise WorkerFailure("filesystem", f"{label} must be a non-symlink directory")
    if metadata.st_uid != os.getuid():
        raise WorkerFailure("filesystem", f"{label} must be owned by the worker user")
    if stat.S_IMODE(metadata.st_mode) != 0o700:
        raise WorkerFailure("filesystem", f"{label} mode must be 0700")


def inspect_owned_directory(path: Path, label: str) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise WorkerFailure("filesystem", f"cannot inspect {label}: {error}") from error
    if path.is_symlink() or not stat.S_ISDIR(metadata.st_mode):
        raise WorkerFailure("filesystem", f"{label} must be a non-symlink directory")
    if metadata.st_uid != os.getuid():
        raise WorkerFailure("filesystem", f"{label} must be owned by the worker user")


def inspect_regular_file(path: Path, label: str, required_mode: Optional[int] = None) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise WorkerFailure("filesystem", f"cannot inspect {label}: {error}") from error
    if path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise WorkerFailure("filesystem", f"{label} must be a regular non-symlink file")
    if metadata.st_uid != os.getuid():
        raise WorkerFailure("filesystem", f"{label} must be owned by the worker user")
    if required_mode is not None and stat.S_IMODE(metadata.st_mode) != required_mode:
        raise WorkerFailure("filesystem", f"{label} mode must be {required_mode:04o}")


def inspect_python_executable(path: Path) -> None:
    if not path.is_absolute():
        raise WorkerFailure("filesystem", "python path must be absolute")
    try:
        resolved = path.resolve(strict=True)
        metadata = resolved.stat()
    except OSError as error:
        raise WorkerFailure("filesystem", f"cannot inspect python executable: {error}") from error
    if not stat.S_ISREG(metadata.st_mode) or not os.access(resolved, os.X_OK):
        raise WorkerFailure("filesystem", "python path must resolve to an executable regular file")


def read_json(path: Path, label: str, max_bytes: int = 1024 * 1024) -> dict[str, Any]:
    inspect_regular_file(path, label, 0o600)
    metadata = path.stat()
    if metadata.st_size > max_bytes:
        raise WorkerFailure("filesystem", f"{label} exceeds {max_bytes} bytes")
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_pairs,
        )
    except WorkerFailure:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise WorkerFailure("filesystem", f"cannot parse {label}: {error}") from error
    return expect_record(value, label)


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_immutable_json(path: Path, value: object) -> None:
    payload = canonical_bytes(value) + b"\n"
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as error:
            raise WorkerFailure("replay", f"immutable file already exists: {path.name}") from error
        fsync_directory(path.parent)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def validate_pool(
    value: dict[str, Any],
    spool: Path,
    pool_digest: str,
    branch_digest: str,
    slurm_id: str,
    job_name: str,
    worker_sha256: str,
    evaluator_sha256: str,
    launch_contract_sha256: str,
) -> dict[str, Any]:
    expect_exact_keys(
        value,
        {
            "protocol",
            "poolDigest",
            "branchDigest",
            "slurmId",
            "jobName",
            "workDir",
            "workerSha256",
            "evaluatorSha256",
            "launchContractSha256",
            "createdAt",
        },
        "pool",
    )
    expect_equal(value.get("protocol"), PROTOCOL, "pool.protocol")
    expect_equal(expect_hash(value.get("poolDigest"), "pool.poolDigest"), pool_digest, "pool.poolDigest")
    expect_equal(
        expect_hash(value.get("branchDigest"), "pool.branchDigest"),
        branch_digest,
        "pool.branchDigest",
    )
    expect_equal(expect_string(value.get("slurmId"), "pool.slurmId"), slurm_id, "pool.slurmId")
    expect_equal(expect_string(value.get("jobName"), "pool.jobName"), job_name, "pool.jobName")
    expect_equal(expect_string(value.get("workDir"), "pool.workDir"), str(spool), "pool.workDir")
    expect_equal(
        expect_hash(value.get("workerSha256"), "pool.workerSha256"),
        worker_sha256,
        "pool.workerSha256",
    )
    expect_equal(
        expect_hash(value.get("evaluatorSha256"), "pool.evaluatorSha256"),
        evaluator_sha256,
        "pool.evaluatorSha256",
    )
    expect_equal(
        expect_hash(value.get("launchContractSha256"), "pool.launchContractSha256"),
        launch_contract_sha256,
        "pool.launchContractSha256",
    )
    expect_timestamp(value.get("createdAt"), "pool.createdAt")
    return value


def validate_request(
    value: dict[str, Any],
    pool_digest: str,
    expected_sequence: int,
) -> dict[str, Any]:
    expect_exact_keys(
        value,
        {
            "protocol",
            "poolDigest",
            "sequence",
            "jobId",
            "manifestDigest",
            "requestDigest",
            "actionsDigest",
            "actions",
            "tasks",
            "publishedAt",
        },
        "request",
    )
    expect_equal(value.get("protocol"), PROTOCOL, "request.protocol")
    expect_equal(expect_hash(value.get("poolDigest"), "request.poolDigest"), pool_digest, "request.poolDigest")
    expect_equal(value.get("sequence"), expected_sequence, "request.sequence")
    job_id = expect_string(value.get("jobId"), "request.jobId")
    if JOB_ID_PATTERN.fullmatch(job_id) is None:
        raise WorkerFailure("contract", "request.jobId is not a bounded safe identifier")
    expect_hash(value.get("manifestDigest"), "request.manifestDigest")
    request_digest = expect_hash(value.get("requestDigest"), "request.requestDigest")
    actions_digest = expect_hash(value.get("actionsDigest"), "request.actionsDigest")
    actions = value.get("actions")
    if (
        not isinstance(actions, list)
        or len(actions) > 256
        or any(not isinstance(action, str) for action in actions)
    ):
        raise WorkerFailure("contract", "request.actions must be a string array of at most 256 entries")
    if sha256_value(actions) != actions_digest:
        raise WorkerFailure("contract", "request.actionsDigest mismatch")
    tasks = value.get("tasks")
    if tasks != list(TASKS):
        raise WorkerFailure("contract", "request.tasks must be the ordered fixed task pair")
    expect_timestamp(value.get("publishedAt"), "request.publishedAt")
    body = {
        "protocol": value["protocol"],
        "poolDigest": value["poolDigest"],
        "sequence": value["sequence"],
        "jobId": value["jobId"],
        "manifestDigest": value["manifestDigest"],
        "actionsDigest": value["actionsDigest"],
        "actions": value["actions"],
        "tasks": value["tasks"],
    }
    if sha256_value(body) != request_digest:
        raise WorkerFailure("contract", "request.requestDigest mismatch")
    return value


def validate_shutdown(value: dict[str, Any], pool_digest: str) -> None:
    expect_exact_keys(value, {"protocol", "poolDigest", "requestedAt"}, "shutdown")
    expect_equal(value.get("protocol"), PROTOCOL, "shutdown.protocol")
    expect_equal(expect_hash(value.get("poolDigest"), "shutdown.poolDigest"), pool_digest, "shutdown.poolDigest")
    expect_timestamp(value.get("requestedAt"), "shutdown.requestedAt")


def check_lease(spool: Path, pool_digest: str, lease_timeout_seconds: float) -> None:
    if lease_timeout_seconds <= 0:
        return
    lease_path = spool / "lease.json"
    if not lease_path.exists():
        raise WorkerFailure("lease", "warm-allocation lease is missing")
    lease = read_json(lease_path, "lease")
    expect_exact_keys(lease, {"protocol", "poolDigest", "expiresAt"}, "lease")
    expect_equal(lease.get("protocol"), PROTOCOL, "lease.protocol")
    expect_equal(expect_hash(lease.get("poolDigest"), "lease.poolDigest"), pool_digest, "lease.poolDigest")
    expires_at = expect_timestamp(lease.get("expiresAt"), "lease.expiresAt")
    expiry = dt.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if expiry <= dt.datetime.now(dt.timezone.utc):
        raise WorkerFailure("lease", "warm-allocation lease expired")
    if expiry > dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=lease_timeout_seconds * 2):
        raise WorkerFailure("lease", "warm-allocation lease extends beyond the bounded horizon")


def signal_process_group(
    process_group_id: int,
    signum: int,
    *,
    allow_darwin_reaped_group: bool = False,
) -> None:
    try:
        os.killpg(process_group_id, signum)
    except ProcessLookupError:
        pass
    except PermissionError:
        # Darwin transiently reports EPERM for a just-reaped process group.
        # The Linux/Slurm target remains fail-closed on permission errors.
        if not (allow_darwin_reaped_group and sys.platform == "darwin"):
            raise


def wait_for_process_group_absence(process_group_id: int, timeout_seconds: float) -> None:
    deadline = time.monotonic() + max(timeout_seconds, 0.1)
    while True:
        try:
            os.killpg(process_group_id, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            if sys.platform == "darwin":
                return
            raise
        if time.monotonic() >= deadline:
            raise WorkerFailure("process", f"evaluator process group {process_group_id} survived SIGKILL")
        time.sleep(0.01)


def terminate_process_group(process: subprocess.Popen[bytes], grace_seconds: float) -> None:
    process_group_id = process.pid
    if process.poll() is None:
        signal_process_group(process_group_id, signal.SIGTERM)
    deadline = time.monotonic() + grace_seconds
    while process.poll() is None and time.monotonic() < deadline:
        time.sleep(0.01)
    if process.poll() is None:
        signal_process_group(process_group_id, signal.SIGKILL)
    try:
        process.wait(timeout=max(grace_seconds, 0.1))
    except subprocess.TimeoutExpired:
        signal_process_group(process_group_id, signal.SIGKILL)
        process.wait()
    signal_process_group(
        process_group_id,
        signal.SIGKILL,
        allow_darwin_reaped_group=True,
    )
    wait_for_process_group_absence(process_group_id, grace_seconds)


def bounded_utf8(raw: bytes, max_bytes: int) -> str:
    if max_bytes <= 0:
        return ""
    text = raw.decode("utf-8", errors="replace")
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


def bounded_child_output(
    stdout: bytes,
    stderr: bytes,
    diagnostics: list[str],
    max_output_bytes: int,
) -> tuple[str, str]:
    diagnostic_suffix = ""
    if diagnostics:
        diagnostic_suffix = f"\n[warm-worker] {'; '.join(diagnostics)}\n"
    suffix_bytes = len(diagnostic_suffix.encode("utf-8"))
    content_budget = max(0, max_output_bytes - suffix_bytes)
    stdout_text = bounded_utf8(stdout, content_budget)
    content_budget -= len(stdout_text.encode("utf-8"))
    stderr_text = bounded_utf8(stderr, content_budget)
    if diagnostic_suffix:
        if not stderr_text:
            diagnostic_suffix = diagnostic_suffix.removeprefix("\n")
        stderr_text = f"{stderr_text}{diagnostic_suffix}"
    if len(stdout_text.encode("utf-8")) + len(stderr_text.encode("utf-8")) > max_output_bytes:
        raise WorkerFailure("output", "bounded evaluator output exceeded its byte contract")
    return stdout_text, stderr_text


def transient_cache_path(job_id: str, benchmark_id: str) -> Path:
    benchmark_digest = hashlib.sha256(benchmark_id.encode("utf-8")).hexdigest()[:12]
    return Path("/tmp") / f"prime-autoresearch-{job_id}-{benchmark_digest}"


def prepare_transient_directory(job_id: str, benchmark_id: str) -> Path:
    transient_cache = transient_cache_path(job_id, benchmark_id)
    transient_cache.mkdir(exist_ok=False, mode=0o700)
    os.chmod(transient_cache, 0o700)
    return transient_cache


def cleanup_transient_directory(
    transient_cache: Path,
    job_id: str,
    benchmark_id: str,
) -> None:
    if transient_cache != transient_cache_path(job_id, benchmark_id):
        raise WorkerFailure("filesystem", "refusing to clean an untrusted transient path")
    try:
        metadata = transient_cache.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISDIR(metadata.st_mode) and not transient_cache.is_symlink():
        shutil.rmtree(transient_cache)
    else:
        transient_cache.unlink()
    fsync_directory(transient_cache.parent)


def launch_evaluator(
    python_path: Path,
    evaluator_path: Path,
    spool: Path,
    compiler_gym_cache: str,
    compiler_gym_site_data: str,
    ld_library_path: str,
    python_warnings: str,
    transient_cache: Path,
    benchmark_id: str,
    actions: list[str],
    max_output_bytes: int,
    child_timeout_seconds: float,
    child_termination_grace_seconds: float,
) -> tuple[Optional[int], str, str, float]:
    environment = {
        key: value
        for key in ("HOME", "LANG", "LC_ALL", "LOGNAME", "PATH", "TZ", "USER")
        if (value := os.environ.get(key)) is not None
    }
    environment.update(
        {
            "COMPILER_GYM_CACHE": compiler_gym_cache,
            "COMPILER_GYM_SITE_DATA": compiler_gym_site_data,
            "COMPILER_GYM_TRANSIENT_CACHE": str(transient_cache),
            "LD_LIBRARY_PATH": ld_library_path,
            "PYTHONWARNINGS": python_warnings,
            "SLURM_CPUS_PER_TASK": str(CPUS_PER_TASK),
        }
    )
    request = canonical_bytes({"benchmark": benchmark_id, "actions": actions}) + b"\n"
    started = time.monotonic()
    output_limit_exceeded = False
    timed_out = False
    process: Optional[subprocess.Popen[bytes]] = None
    with tempfile.TemporaryFile(dir=spool) as stdout_file, tempfile.TemporaryFile(dir=spool) as stderr_file:
        try:
            raise_if_termination_requested()
            process = subprocess.Popen(
                [str(python_path), str(evaluator_path)],
                stdin=subprocess.PIPE,
                stdout=stdout_file,
                stderr=stderr_file,
                cwd=transient_cache,
                env=environment,
                start_new_session=True,
            )
            raise_if_termination_requested()
            assert process.stdin is not None
            process.stdin.write(request)
            process.stdin.close()
            while process.poll() is None:
                if _termination_signal is not None:
                    terminate_process_group(process, child_termination_grace_seconds)
                    raise_if_termination_requested()
                elapsed = time.monotonic() - started
                stdout_size = os.fstat(stdout_file.fileno()).st_size
                stderr_size = os.fstat(stderr_file.fileno()).st_size
                if stdout_size + stderr_size > max_output_bytes:
                    output_limit_exceeded = True
                    terminate_process_group(process, child_termination_grace_seconds)
                    break
                if elapsed > child_timeout_seconds:
                    timed_out = True
                    terminate_process_group(process, child_termination_grace_seconds)
                    break
                time.sleep(0.01)
            exit_code = process.wait()
            terminate_process_group(process, child_termination_grace_seconds)
            raise_if_termination_requested()
            wall_ms = (time.monotonic() - started) * 1000
            stdout_file.seek(0)
            stderr_file.seek(0)
            stdout = stdout_file.read(max_output_bytes + 1)
            remaining = max(0, max_output_bytes + 1 - len(stdout))
            stderr = stderr_file.read(remaining)
        finally:
            if process is not None:
                terminate_process_group(process, child_termination_grace_seconds)
    if len(stdout) + len(stderr) > max_output_bytes:
        output_limit_exceeded = True
        combined = stdout + stderr
        stdout = combined[:max_output_bytes]
        stderr = b""
    diagnostics: list[str] = []
    if output_limit_exceeded:
        diagnostics.append(f"warm worker killed evaluator after exceeding {max_output_bytes} output bytes")
    if timed_out:
        diagnostics.append(f"warm worker killed evaluator after {child_timeout_seconds:.3f}s timeout")
    stdout_text, stderr_text = bounded_child_output(stdout, stderr, diagnostics, max_output_bytes)
    return (
        exit_code,
        stdout_text,
        stderr_text,
        wall_ms,
    )


def claim_record(
    request: dict[str, Any],
    rank: int,
    slurm_id: str,
    worker_sha256: str,
    evaluator_sha256: str,
) -> dict[str, object]:
    return {
        "protocol": PROTOCOL,
        "poolDigest": request["poolDigest"],
        "sequence": request["sequence"],
        "jobId": request["jobId"],
        "requestDigest": request["requestDigest"],
        "rank": rank,
        "benchmarkId": request["tasks"][rank],
        "slurmId": slurm_id,
        "workerSha256": worker_sha256,
        "evaluatorSha256": evaluator_sha256,
    }


def acknowledge_shutdown(spool: Path, pool_digest: str, rank: int, slurm_id: str) -> None:
    ack_path = spool / f"shutdown-ack-rank-{rank}.json"
    if ack_path.exists():
        return
    write_immutable_json(
        ack_path,
        {
            "protocol": PROTOCOL,
            "poolDigest": pool_digest,
            "rank": rank,
            "slurmId": slurm_id,
            "acknowledgedAt": utc_now(),
        },
    )


def worker_main(args: argparse.Namespace) -> int:
    install_termination_handlers()
    raise_if_termination_requested()
    spool = Path(args.spool)
    if not spool.is_absolute() or spool != Path(os.path.normpath(str(spool))):
        raise WorkerFailure("filesystem", "spool path must be absolute and normalized")
    inspect_directory(spool, "spool")
    expect_hash(args.pool_digest, "--pool-digest")
    expect_hash(args.branch_digest, "--branch-digest")
    expect_hash(args.worker_sha256, "--worker-sha256")
    expect_hash(args.evaluator_sha256, "--evaluator-sha256")
    expect_hash(args.launch_contract_sha256, "--launch-contract-sha256")
    if SLURM_ID_PATTERN.fullmatch(args.slurm_id) is None:
        raise WorkerFailure("contract", "--slurm-id must be a positive numeric ID")
    if args.rank not in (0, 1):
        raise WorkerFailure("contract", "--rank must be 0 or 1")
    if args.cpus_per_task != CPUS_PER_TASK:
        raise WorkerFailure("contract", f"--cpus-per-task must be {CPUS_PER_TASK}")
    if os.environ.get("SLURM_CPUS_PER_TASK", str(args.cpus_per_task)) != str(CPUS_PER_TASK):
        raise WorkerFailure("contract", f"SLURM_CPUS_PER_TASK must be {CPUS_PER_TASK}")
    worker_path = Path(__file__)
    inspect_regular_file(worker_path, "worker")
    evaluator_path = Path(args.evaluator)
    python_path = Path(args.python)
    inspect_regular_file(evaluator_path, "evaluator")
    inspect_python_executable(python_path)
    for label, value in (
        ("compiler gym cache", args.compiler_gym_cache),
        ("compiler gym site data", args.compiler_gym_site_data),
        ("LD library path", args.ld_library_path),
    ):
        path = Path(value)
        if not path.is_absolute() or path != Path(os.path.normpath(str(path))):
            raise WorkerFailure("filesystem", f"{label} must be absolute and normalized")
    if args.python_warnings != "ignore::FutureWarning":
        raise WorkerFailure("contract", "--python-warnings must be ignore::FutureWarning")
    expect_equal(sha256_file(worker_path), args.worker_sha256, "worker SHA-256")
    expect_equal(sha256_file(evaluator_path), args.evaluator_sha256, "evaluator SHA-256")
    pool = validate_pool(
        read_json(spool / "pool.json", "pool"),
        spool,
        args.pool_digest,
        args.branch_digest,
        args.slurm_id,
        args.job_name,
        args.worker_sha256,
        args.evaluator_sha256,
        args.launch_contract_sha256,
    )
    ready_path = spool / f"ready-rank-{args.rank}.json"
    if ready_path.exists():
        raise WorkerFailure("replay", f"ready record already exists for rank {args.rank}")
    write_immutable_json(
        ready_path,
        {
            "protocol": PROTOCOL,
            "poolDigest": pool["poolDigest"],
            "rank": args.rank,
            "slurmId": args.slurm_id,
            "cpusPerTask": CPUS_PER_TASK,
            "workerSha256": args.worker_sha256,
            "evaluatorSha256": args.evaluator_sha256,
            "readyAt": utc_now(),
        },
    )
    idle_deadline = time.monotonic() + args.idle_timeout_seconds
    next_sequence = 0
    while True:
        raise_if_termination_requested()
        shutdown_path = spool / "shutdown.json"
        if shutdown_path.exists():
            validate_shutdown(read_json(shutdown_path, "shutdown"), args.pool_digest)
            acknowledge_shutdown(spool, args.pool_digest, args.rank, args.slurm_id)
            return 0
        check_lease(spool, args.pool_digest, args.lease_timeout_seconds)
        if next_sequence >= MAX_REQUESTS:
            if time.monotonic() >= idle_deadline:
                raise WorkerFailure("timeout", "shutdown was not published after the fixed request budget")
            time.sleep(args.poll_seconds)
            continue
        request_path = spool / f"request-{next_sequence:04d}.json"
        if not request_path.exists():
            if time.monotonic() >= idle_deadline:
                raise WorkerFailure("timeout", f"request {next_sequence} was not published before the idle timeout")
            time.sleep(args.poll_seconds)
            continue
        request = validate_request(read_json(request_path, "request"), args.pool_digest, next_sequence)
        claim_path = spool / f"claim-{next_sequence:04d}-rank-{args.rank}.json"
        result_path = spool / f"result-{next_sequence:04d}-rank-{args.rank}.json"
        if result_path.exists():
            raise WorkerFailure("replay", f"result already exists for request {next_sequence} rank {args.rank}")
        if claim_path.exists():
            raise WorkerFailure(
                "ambiguous",
                f"claim exists without result for request {next_sequence} rank {args.rank}; refusing rerun",
            )
        expect_equal(sha256_file(evaluator_path), args.evaluator_sha256, "evaluator SHA-256 before child launch")
        claim = claim_record(
            request,
            args.rank,
            args.slurm_id,
            args.worker_sha256,
            args.evaluator_sha256,
        )
        write_immutable_json(claim_path, claim)
        benchmark_id = request["tasks"][args.rank]
        transient_cache = prepare_transient_directory(request["jobId"], benchmark_id)
        try:
            exit_code, stdout, stderr, wall_ms = launch_evaluator(
                python_path,
                evaluator_path,
                spool,
                args.compiler_gym_cache,
                args.compiler_gym_site_data,
                args.ld_library_path,
                args.python_warnings,
                transient_cache,
                benchmark_id,
                request["actions"],
                args.max_output_bytes,
                args.child_timeout_seconds,
                args.child_termination_grace_seconds,
            )
            write_immutable_json(
                result_path,
                {
                    **claim,
                    "childExitCode": exit_code,
                    "stdout": stdout,
                    "stderr": stderr,
                    "wallMs": wall_ms,
                    "completedAt": utc_now(),
                },
            )
        finally:
            cleanup_transient_directory(transient_cache, request["jobId"], benchmark_id)
        next_sequence += 1
        idle_deadline = time.monotonic() + args.idle_timeout_seconds


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spool", required=True)
    parser.add_argument("--rank", required=True, type=int)
    parser.add_argument("--slurm-id", required=True)
    parser.add_argument("--pool-digest", required=True)
    parser.add_argument("--branch-digest", required=True)
    parser.add_argument("--job-name", required=True)
    parser.add_argument("--worker-sha256", required=True)
    parser.add_argument("--evaluator-sha256", required=True)
    parser.add_argument("--launch-contract-sha256", required=True)
    parser.add_argument("--evaluator", required=True)
    parser.add_argument("--python", required=True)
    parser.add_argument("--compiler-gym-cache", required=True)
    parser.add_argument("--compiler-gym-site-data", required=True)
    parser.add_argument("--ld-library-path", required=True)
    parser.add_argument("--python-warnings", required=True)
    parser.add_argument("--cpus-per-task", type=int, default=CPUS_PER_TASK)
    parser.add_argument("--poll-seconds", type=float, default=0.05)
    parser.add_argument("--idle-timeout-seconds", type=float, default=300.0)
    parser.add_argument("--lease-timeout-seconds", type=float, default=0.0)
    parser.add_argument("--child-timeout-seconds", type=float, default=300.0)
    parser.add_argument(
        "--child-termination-grace-seconds",
        type=float,
        default=DEFAULT_CHILD_TERMINATION_GRACE_SECONDS,
    )
    parser.add_argument("--max-output-bytes", type=int, default=DEFAULT_MAX_OUTPUT_BYTES)
    args = parser.parse_args(argv)
    if args.poll_seconds <= 0:
        parser.error("--poll-seconds must be positive")
    if args.idle_timeout_seconds <= 0:
        parser.error("--idle-timeout-seconds must be positive")
    if args.lease_timeout_seconds < 0:
        parser.error("--lease-timeout-seconds must be nonnegative")
    if args.child_timeout_seconds <= 0:
        parser.error("--child-timeout-seconds must be positive")
    if args.child_termination_grace_seconds <= 0:
        parser.error("--child-termination-grace-seconds must be positive")
    if args.max_output_bytes < 1024:
        parser.error("--max-output-bytes must be at least 1024")
    if args.max_output_bytes > DEFAULT_MAX_OUTPUT_BYTES:
        parser.error(f"--max-output-bytes must not exceed {DEFAULT_MAX_OUTPUT_BYTES}")
    return args


def fail(error: BaseException) -> NoReturn:
    if isinstance(error, WorkerFailure):
        print(f"compiler-gym-warm-worker:{error.kind}:{error}", file=sys.stderr, flush=True)
        raise SystemExit(2)
    print(f"compiler-gym-warm-worker:unhandled:{type(error).__name__}:{error}", file=sys.stderr, flush=True)
    raise SystemExit(3)


if __name__ == "__main__":
    try:
        raise SystemExit(worker_main(parse_args()))
    except SystemExit:
        raise
    except WorkerCancellation as error:
        print(f"compiler-gym-warm-worker:signal:{error}", file=sys.stderr, flush=True)
        raise SystemExit(128 + error.signum)
    except BaseException as error:
        fail(error)

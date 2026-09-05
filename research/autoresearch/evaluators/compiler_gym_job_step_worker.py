#!/usr/bin/env python3

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time


PROTOCOL = "compiler-gym-job-step-result-v1"
REQUEST_PROTOCOL = "compiler-gym-job-step-request-v1"
TASKS = (
    "benchmark://cbench-v1/blowfish",
    "benchmark://cbench-v1/bzip2",
)
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
CHILD_TIMEOUT_SECONDS = 300
CHILD_TERMINATION_GRACE_SECONDS = 1
SHA256_PATTERN_LENGTH = 64
_active_child: subprocess.Popen[bytes] | None = None
_cleanup_in_progress = False
_launch_in_progress = False
_termination_signal: int | None = None


class WorkerCancellation(RuntimeError):
    def __init__(self, signum: int) -> None:
        super().__init__(f"worker received {signal.Signals(signum).name}")
        self.signum = signum


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
        if not (allow_darwin_reaped_group and sys.platform == "darwin"):
            raise


def request_termination(signum: int, _frame: object) -> None:
    global _termination_signal
    first_signal = _termination_signal is None
    if first_signal:
        _termination_signal = signum
    child = _active_child
    if child is not None:
        signal_process_group(child.pid, signal.SIGTERM if first_signal else signal.SIGKILL)
    if first_signal and not _cleanup_in_progress and not _launch_in_progress:
        raise WorkerCancellation(signum)


def install_termination_handlers() -> None:
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, request_termination)


def raise_if_termination_requested() -> None:
    if _termination_signal is not None:
        raise WorkerCancellation(_termination_signal)


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def require_sha256(value: str, label: str) -> str:
    if len(value) != SHA256_PATTERN_LENGTH or any(character not in "0123456789abcdef" for character in value):
        fail(f"{label} must be a lowercase SHA-256")
    return value


def require_sealed_sources(expected_worker_sha256: str, expected_evaluator_sha256: str) -> str:
    namespace = globals()
    required = {
        "__sealed_worker_sha256__",
        "__sealed_evaluator_source__",
        "__sealed_evaluator_sha256__",
    }
    if not required.issubset(namespace):
        fail("sealed source globals are required")
    injected_worker_sha256 = namespace["__sealed_worker_sha256__"]
    injected_evaluator_source = namespace["__sealed_evaluator_source__"]
    injected_evaluator_sha256 = namespace["__sealed_evaluator_sha256__"]
    if not isinstance(injected_worker_sha256, str) or not isinstance(injected_evaluator_sha256, str):
        fail("sealed source hashes must be strings")
    require_sha256(injected_worker_sha256, "sealed worker SHA-256")
    require_sha256(injected_evaluator_sha256, "sealed evaluator SHA-256")
    if injected_worker_sha256 != expected_worker_sha256:
        fail("sealed worker SHA-256 mismatch")
    if injected_evaluator_sha256 != expected_evaluator_sha256:
        fail("sealed evaluator SHA-256 mismatch")
    if not isinstance(injected_evaluator_source, str):
        fail("sealed evaluator source must be a string")
    evaluator_bytes = injected_evaluator_source.encode("utf-8", errors="strict")
    if len(evaluator_bytes) == 0 or len(evaluator_bytes) > 8 * 1024 * 1024:
        fail("sealed evaluator source byte length is invalid")
    if sha256_bytes(evaluator_bytes) != expected_evaluator_sha256:
        fail("sealed evaluator source SHA-256 mismatch")
    return injected_evaluator_source


def open_owned_regular(path: pathlib.Path, mode: int) -> int:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if nofollow == 0:
        fail("descriptor no-follow support is required")
    descriptor = os.open(path, os.O_RDONLY | nofollow)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            fail(f"{path} is not a regular file")
        if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != mode:
            fail(f"{path} owner or mode mismatch")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def read_regular_descriptor(descriptor: int, path: pathlib.Path, max_bytes: int) -> bytes:
    os.lseek(descriptor, 0, os.SEEK_SET)
    payload = bytearray()
    while True:
        chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1 - len(payload)))
        if not chunk:
            os.lseek(descriptor, 0, os.SEEK_SET)
            return bytes(payload)
        payload.extend(chunk)
        if len(payload) > max_bytes:
            fail(f"{path} exceeds the byte limit")


def read_owned_regular(path: pathlib.Path, mode: int, max_bytes: int) -> bytes:
    descriptor = open_owned_regular(path, mode)
    try:
        return read_regular_descriptor(descriptor, path, max_bytes)
    finally:
        os.close(descriptor)


def exact_object(value: object, expected_keys: set[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    if set(value) != expected_keys:
        fail(f"{label} keys mismatch")
    return value


def parse_request(payload: bytes, expected_file_sha256: str) -> dict[str, object]:
    if sha256_bytes(payload) != expected_file_sha256:
        fail("request file SHA-256 mismatch")
    try:
        raw = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"request is not valid UTF-8 JSON: {error}")
    request = exact_object(
        raw,
        {
            "actions",
            "actionsSha256",
            "candidateId",
            "createdAt",
            "evaluatorSha256",
            "protocol",
            "requestSha256",
            "tasks",
            "verifierEpoch",
            "workerSha256",
        },
        "request",
    )
    if request["protocol"] != REQUEST_PROTOCOL:
        fail("request protocol mismatch")
    if request["candidateId"] != "C1":
        fail("only frozen candidate C1 is allowed")
    if request["tasks"] != list(TASKS):
        fail("request task order mismatch")
    actions = request["actions"]
    if not isinstance(actions, list) or len(actions) > 256 or not all(isinstance(action, str) for action in actions):
        fail("request actions must be a bounded string array")
    actions_bytes = json.dumps(actions, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if sha256_bytes(actions_bytes) != require_sha256(str(request["actionsSha256"]), "actionsSha256"):
        fail("request actions SHA-256 mismatch")
    for field in ("evaluatorSha256", "requestSha256", "workerSha256"):
        require_sha256(str(request[field]), field)
    if not isinstance(request["verifierEpoch"], str) or not request["verifierEpoch"]:
        fail("request verifier epoch is invalid")
    if not isinstance(request["createdAt"], str) or not request["createdAt"]:
        fail("request timestamp is invalid")
    return request


def wait_for_process_group_absence(process_group_id: int) -> None:
    deadline = time.monotonic() + CHILD_TERMINATION_GRACE_SECONDS
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
            raise RuntimeError(f"evaluator process group {process_group_id} survived SIGKILL")
        time.sleep(0.01)


def terminate_process_group(child: subprocess.Popen[bytes]) -> None:
    process_group_id = child.pid
    signal_process_group(process_group_id, signal.SIGTERM)
    deadline = time.monotonic() + CHILD_TERMINATION_GRACE_SECONDS
    while child.poll() is None and time.monotonic() < deadline:
        time.sleep(0.01)
    if child.poll() is None:
        signal_process_group(process_group_id, signal.SIGKILL)
    try:
        child.wait(timeout=CHILD_TERMINATION_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        signal_process_group(process_group_id, signal.SIGKILL)
        child.wait()
    signal_process_group(
        process_group_id,
        signal.SIGKILL,
        allow_darwin_reaped_group=True,
    )
    wait_for_process_group_absence(process_group_id)


def run_child(
    python_path: pathlib.Path,
    evaluator_source: str,
    benchmark_id: str,
    actions: list[str],
    transient_cache: pathlib.Path,
) -> tuple[int | None, bytes, bytes, int, int]:
    global _active_child, _cleanup_in_progress, _launch_in_progress
    child_environment = dict(os.environ)
    child_environment["COMPILER_GYM_TRANSIENT_CACHE"] = str(transient_cache)
    child_input = (json.dumps({"benchmark": benchmark_id, "actions": actions}, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )
    started_ns = time.monotonic_ns()
    child: subprocess.Popen[bytes] | None = None
    timed_out = False
    try:
        raise_if_termination_requested()
        _launch_in_progress = True
        try:
            child = subprocess.Popen(
                [str(python_path), "-c", evaluator_source],
                cwd=transient_cache,
                env=child_environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
            )
            _active_child = child
        finally:
            _launch_in_progress = False
        raise_if_termination_requested()
        try:
            stdout, stderr = child.communicate(input=child_input, timeout=CHILD_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            timed_out = True
    finally:
        if child is not None:
            _cleanup_in_progress = True
            try:
                terminate_process_group(child)
            finally:
                _active_child = None
                _cleanup_in_progress = False
    if timed_out:
        assert child is not None
        stdout, stderr = child.communicate()
        stderr += b"\ncompiler-gym job-step child timed out"
    raise_if_termination_requested()
    finished_ns = time.monotonic_ns()
    if len(stdout) + len(stderr) > MAX_OUTPUT_BYTES:
        fail("child output exceeds the byte limit")
    return child.returncode, stdout, stderr, started_ns, finished_ns


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--request-file-sha256", required=True)
    parser.add_argument("--worker-sha256", required=True)
    parser.add_argument("--evaluator-sha256", required=True)
    parser.add_argument("--python", required=True)
    parser.add_argument("--expected-root-job-id", required=True)
    arguments = parser.parse_args()

    wrapper_started_at = utc_now()
    wrapper_started_ns = time.monotonic_ns()
    request_path = pathlib.Path(arguments.request)
    python_path = pathlib.Path(arguments.python)
    if not request_path.is_absolute() or not python_path.is_absolute():
        fail("worker paths must be absolute")
    expected_worker_sha256 = require_sha256(arguments.worker_sha256, "worker SHA-256")
    expected_evaluator_sha256 = require_sha256(arguments.evaluator_sha256, "evaluator SHA-256")
    expected_request_file_sha256 = require_sha256(arguments.request_file_sha256, "request file SHA-256")
    evaluator_source = require_sealed_sources(expected_worker_sha256, expected_evaluator_sha256)
    request = parse_request(read_owned_regular(request_path, 0o600, 1024 * 1024), expected_request_file_sha256)
    if request["workerSha256"] != expected_worker_sha256 or request["evaluatorSha256"] != expected_evaluator_sha256:
        fail("request asset hashes mismatch")

    root_job_id = os.environ.get("SLURM_JOB_ID", "")
    step_id = os.environ.get("SLURM_STEP_ID", "")
    rank_text = os.environ.get("SLURM_PROCID", "")
    cpus_per_task = os.environ.get("SLURM_CPUS_PER_TASK", "")
    if root_job_id != arguments.expected_root_job_id or not root_job_id.isdecimal() or root_job_id.startswith("0"):
        fail("SLURM root job ID mismatch")
    if not step_id.isdecimal():
        fail("SLURM step ID is invalid")
    if rank_text not in ("0", "1"):
        fail("SLURM rank must be 0 or 1")
    if cpus_per_task != "2":
        fail("SLURM CPUs per task must be exactly 2")
    rank = int(rank_text)
    benchmark_id = TASKS[rank]
    actions = request["actions"]
    if not isinstance(actions, list) or not all(isinstance(action, str) for action in actions):
        fail("validated actions changed type")
    task_digest = hashlib.sha256(benchmark_id.encode("utf-8")).hexdigest()[:12]
    transient_cache = pathlib.Path(f"/tmp/prime-autoresearch-job-step-{root_job_id}-{step_id}-{rank}-{task_digest}")
    transient_cache.mkdir(mode=0o700)
    try:
        exit_code, stdout, stderr, child_started_ns, child_finished_ns = run_child(
            python_path,
            evaluator_source,
            benchmark_id,
            actions,
            transient_cache,
        )
    finally:
        shutil.rmtree(transient_cache)

    wrapper_finished_ns = time.monotonic_ns()
    raise_if_termination_requested()
    result = {
        "benchmarkId": benchmark_id,
        "childExitCode": exit_code,
        "childFinishedNs": str(child_finished_ns),
        "childStartedNs": str(child_started_ns),
        "childWallNs": str(child_finished_ns - child_started_ns),
        "completedAt": utc_now(),
        "evaluatorSha256": expected_evaluator_sha256,
        "hostname": socket.gethostname(),
        "protocol": PROTOCOL,
        "rank": rank,
        "requestFileSha256": expected_request_file_sha256,
        "requestSha256": request["requestSha256"],
        "rootJobId": root_job_id,
        "startedAt": wrapper_started_at,
        "stderr": stderr.decode("utf-8", errors="strict"),
        "stdout": stdout.decode("utf-8", errors="strict"),
        "stepId": step_id,
        "workerSha256": expected_worker_sha256,
        "wrapperFinishedNs": str(wrapper_finished_ns),
        "wrapperStartedNs": str(wrapper_started_ns),
        "wrapperWallNs": str(wrapper_finished_ns - wrapper_started_ns),
    }
    raise_if_termination_requested()
    print(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    install_termination_handlers()
    try:
        main()
    except SystemExit:
        raise
    except WorkerCancellation as error:
        print(f"compiler-gym-job-step-worker:signal:{error}", file=sys.stderr, flush=True)
        raise SystemExit(128 + error.signum)

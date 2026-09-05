#!/usr/bin/env python3
"""Trusted KernelBench-Verified qualification evaluator.

This evaluator deliberately accepts only the identity candidate used to qualify the
verifier and FarmShare lane. It does not generate kernels or call a model API.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import traceback
from types import ModuleType
from typing import Any, Callable

import torch


PINNED_COMMIT = "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e"
VERIFIER_EPOCH_PREFIX = "kernelbench-verified-qualification-v1:"
EXPECTED_TASKS = ("level1/1", "level2/2", "level3/1")
IDENTITY_CANDIDATE = "ModelNew = Model"
WRONG_OUTPUT_CANDIDATE = """class ModelNew(Model):
    def forward(self, *args, **kwargs):
        output = super().forward(*args, **kwargs)
        return torch.where(output >= 0, -torch.ones_like(output), torch.ones_like(output))
"""
TASK_PATHS = {
    "level1/1": "KernelBench/level1/1_Square_matrix_multiplication_.py",
    "level2/2": "KernelBench/level2/2_ConvTranspose2d_BiasAdd_Clamp_Scaling_Clamp_Divide.py",
    "level3/1": "KernelBench/level3/1_MLP.py",
}
HIDDEN_PATHS = {
    "level1/1": "hidden_tests/level1/1_hidden.py",
    "level2/2": "hidden_tests/level2/2_hidden.py",
    "level3/1": "hidden_tests/level3/1_hidden.py",
}
EXPECTED_INPUT_HASHES = {
    "level1/1": {
        "taskSha256": "2d349d77a97fd1a6f29365553275729685ab1cfff57ca4458bb6a8c09b88e91d",
        "hiddenTestSha256": "9377caa50e3653ea38e6d35c3189a4cbdad1753d0c8dd17eb8ae2f70eba74f85",
    },
    "level2/2": {
        "taskSha256": "31f49a84239cb24383e84ea78c778d9fc047455a12df3e2eb269ce6deedaf808",
        "hiddenTestSha256": "5a951a50e3d2e23f3a977005e6508ae3f37974e1bf08b2fdb0f004619f46e6f0",
    },
    "level3/1": {
        "taskSha256": "d78f9c39c087a74f2e924bcd8a0bb73972763094f2de096bec1337ab8836553a",
        "hiddenTestSha256": "5652c2d43ca0d146fbef0e1c7d14220dc01c4077ceb413e885691f104c452f04",
    },
}
EXPECTED_PYTHON = "3.12.3"
EXPECTED_PIP = "25.2"
EXPECTED_TORCH = "2.11.0"
EXPECTED_TORCH_CUDA = "12.8"
COMPILE_CANARY_SPEC = {
    "backend": "inductor",
    "fullgraph": True,
    "dynamic": False,
    "device": "cuda",
    "dtype": "float32",
    "shape": [256],
}
ATOL = 1e-3
RTOL = 1e-3
WARMUPS = 3
TRIALS = 10
SEED = 1729


class QualificationFailure(RuntimeError):
    failure_kind = "infrastructure"


class ReferenceFailure(QualificationFailure):
    failure_kind = "reference"


class CandidateFailure(QualificationFailure):
    failure_kind = "candidate"


class VerifierFailure(QualificationFailure):
    failure_kind = "negative-control"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def load_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise QualificationFailure("request must be a JSON object")
    return value


def git_output(checkout: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(checkout), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def validate_checkout(checkout: Path) -> None:
    revision = git_output(checkout, "rev-parse", "HEAD")
    if revision != PINNED_COMMIT:
        raise QualificationFailure(f"checkout revision mismatch: {revision}")
    dirty = git_output(checkout, "status", "--porcelain", "--untracked-files=no")
    if dirty:
        raise QualificationFailure("pinned checkout has modified tracked files")
    for benchmark_id in EXPECTED_TASKS:
        task_digest = sha256_file(checkout / TASK_PATHS[benchmark_id])
        hidden_digest = sha256_file(checkout / HIDDEN_PATHS[benchmark_id])
        expected = EXPECTED_INPUT_HASHES[benchmark_id]
        if task_digest != expected["taskSha256"] or hidden_digest != expected["hiddenTestSha256"]:
            raise QualificationFailure(f"pinned task inputs changed for {benchmark_id}")


def load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise QualificationFailure(f"cannot load module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def set_seed(seed: int) -> None:
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def to_device(value: Any, device: torch.device) -> Any:
    if not isinstance(value, torch.Tensor):
        return value
    if value.is_floating_point():
        return value.to(device=device, dtype=torch.float32)
    return value.to(device=device)


def require_tensor(value: Any, label: str) -> torch.Tensor:
    if not isinstance(value, torch.Tensor):
        raise QualificationFailure(f"{label} returned a non-tensor output")
    return value


def call_reference(model: torch.nn.Module, inputs: list[Any], label: str) -> torch.Tensor:
    try:
        with torch.inference_mode():
            output = require_tensor(model(*inputs), label)
        torch.cuda.synchronize()
        return output
    except Exception as error:
        raise ReferenceFailure(f"reference failed on {label}: {error}") from error


def call_candidate(model: torch.nn.Module, inputs: list[Any], label: str) -> torch.Tensor:
    try:
        with torch.inference_mode():
            output = require_tensor(model(*inputs), label)
        torch.cuda.synchronize()
        return output
    except Exception as error:
        raise CandidateFailure(f"candidate failed on {label}: {error}") from error


def time_model(
    call: Callable[[torch.nn.Module, list[Any], str], torch.Tensor],
    model: torch.nn.Module,
    inputs: list[Any],
    label: str,
) -> list[float]:
    for _ in range(WARMUPS):
        output = call(model, inputs, label)
        del output
    samples: list[float] = []
    for _ in range(TRIALS):
        start = torch.cuda.Event(enable_timing=True)
        end = torch.cuda.Event(enable_timing=True)
        start.record()
        output = call(model, inputs, label)
        end.record()
        torch.cuda.synchronize()
        samples.append(float(start.elapsed_time(end)))
        del output
    if len(samples) != TRIALS or any(not math.isfinite(value) or value <= 0 for value in samples):
        raise QualificationFailure(f"invalid timing samples for {label}")
    return samples


def measure_peak_memory(
    call: Callable[[torch.nn.Module, list[Any], str], torch.Tensor],
    model: torch.nn.Module,
    inputs: list[Any],
    label: str,
) -> tuple[int, int]:
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    before = int(torch.cuda.memory_allocated())
    output = call(model, inputs, label)
    peak = int(torch.cuda.max_memory_allocated())
    del output
    return peak, max(0, peak - before)


def run_compile_canary(device: torch.device) -> dict[str, Any]:
    result: dict[str, Any] = {
        **COMPILE_CANARY_SPEC,
        "passed": False,
        "maxAbsError": None,
        "error": None,
    }
    try:
        def canary(value: torch.Tensor) -> torch.Tensor:
            return torch.sin(value) + value * value

        compiled = torch.compile(
            canary,
            backend=COMPILE_CANARY_SPEC["backend"],
            fullgraph=COMPILE_CANARY_SPEC["fullgraph"],
            dynamic=COMPILE_CANARY_SPEC["dynamic"],
        )
        inputs = torch.linspace(-1.0, 1.0, COMPILE_CANARY_SPEC["shape"][0], device=device, dtype=torch.float32)
        expected = canary(inputs)
        actual = compiled(inputs)
        torch.cuda.synchronize()
        shape_matches = actual.shape == expected.shape
        finite = bool(torch.isfinite(expected).all().item() and torch.isfinite(actual).all().item())
        max_abs_error = float(torch.max(torch.abs(expected - actual)).item()) if shape_matches else math.inf
        passed = shape_matches and finite and bool(torch.allclose(expected, actual, atol=ATOL, rtol=RTOL))
        result["maxAbsError"] = max_abs_error
        result["passed"] = passed
        if not passed:
            raise QualificationFailure("torch.compile/Inductor CUDA canary produced an invalid result")
        return result
    except Exception as error:
        result["error"] = str(error)
        if isinstance(error, QualificationFailure):
            raise
        raise QualificationFailure(f"torch.compile/Inductor CUDA canary failed: {error}") from error


def geometric_mean(values: list[float]) -> float:
    if not values or any(value <= 0 or not math.isfinite(value) for value in values):
        raise QualificationFailure("cannot compute geometric mean from invalid values")
    return math.exp(sum(math.log(value) for value in values) / len(values))


def failed_task(
    benchmark_id: str,
    failure_kind: str,
    error: str,
    checkout: Path,
    started_at: str,
) -> dict[str, Any]:
    task_path = checkout / TASK_PATHS[benchmark_id]
    hidden_path = checkout / HIDDEN_PATHS[benchmark_id]
    return {
        "benchmarkId": benchmark_id,
        "status": "failed",
        "failureKind": failure_kind,
        "errors": [error],
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "taskPath": TASK_PATHS[benchmark_id],
        "hiddenTestPath": HIDDEN_PATHS[benchmark_id],
        "taskSha256": sha256_file(task_path) if task_path.is_file() else None,
        "hiddenTestSha256": sha256_file(hidden_path) if hidden_path.is_file() else None,
        "hiddenConfigs": [],
        "metrics": {},
    }


def evaluate_task(
    checkout: Path,
    benchmark_id: str,
    candidate_source: str,
    device: torch.device,
) -> dict[str, Any]:
    started_at = utc_now()
    task_path = checkout / TASK_PATHS[benchmark_id]
    hidden_path = checkout / HIDDEN_PATHS[benchmark_id]
    if not task_path.is_file() or not hidden_path.is_file():
        raise QualificationFailure(f"missing task or hidden test for {benchmark_id}")

    task_module = load_module(task_path, f"kbv_task_{benchmark_id.replace('/', '_')}")
    model_class = getattr(task_module, "Model", None)
    get_init_inputs = getattr(task_module, "get_init_inputs", None)
    if not isinstance(model_class, type) or not callable(get_init_inputs):
        raise QualificationFailure(f"invalid task interface for {benchmark_id}")

    if candidate_source.strip() != IDENTITY_CANDIDATE:
        raise QualificationFailure("qualification candidate must be exactly `ModelNew = Model`")
    namespace = vars(task_module)
    exec(compile(candidate_source, "<trusted-qualification-candidate>", "exec"), namespace)
    candidate_class = namespace.get("ModelNew")
    if candidate_class is not model_class:
        raise QualificationFailure("trusted identity candidate did not resolve to Model")
    exec(compile(WRONG_OUTPUT_CANDIDATE, "<trusted-wrong-output-candidate>", "exec"), namespace)
    wrong_candidate_class = namespace.get("ModelNew")
    if not isinstance(wrong_candidate_class, type) or wrong_candidate_class is model_class:
        raise QualificationFailure("trusted wrong-output ModelNew did not resolve")

    init_inputs = get_init_inputs()
    if not isinstance(init_inputs, (list, tuple)):
        raise QualificationFailure(f"get_init_inputs returned an invalid value for {benchmark_id}")
    set_seed(SEED)
    reference = model_class(*init_inputs).to(device=device, dtype=torch.float32).eval()
    set_seed(SEED)
    candidate = candidate_class(*init_inputs).to(device=device, dtype=torch.float32).eval()
    candidate.load_state_dict(reference.state_dict(), strict=True)
    set_seed(SEED)
    wrong_candidate = wrong_candidate_class(*init_inputs).to(device=device, dtype=torch.float32).eval()
    wrong_candidate.load_state_dict(reference.state_dict(), strict=True)

    set_seed(SEED)
    hidden_module = load_module(hidden_path, f"kbv_hidden_{benchmark_id.replace('/', '_')}")
    get_hidden_inputs = getattr(hidden_module, "get_hidden_inputs", None)
    if not callable(get_hidden_inputs):
        raise QualificationFailure(f"hidden test has no get_hidden_inputs for {benchmark_id}")
    raw_configs = get_hidden_inputs()
    if not isinstance(raw_configs, list) or len(raw_configs) != 4:
        raise QualificationFailure(f"{benchmark_id} must provide exactly four hidden configs")

    hidden_results: list[dict[str, Any]] = []
    reference_samples: list[float] = []
    candidate_samples: list[float] = []
    speedups: list[float] = []
    reference_peaks: list[int] = []
    candidate_peaks: list[int] = []
    for index, raw_inputs in enumerate(raw_configs, start=1):
        if not isinstance(raw_inputs, (list, tuple)):
            raise QualificationFailure(f"hidden config {index} is not an input list for {benchmark_id}")
        inputs = [to_device(value, device) for value in raw_inputs]
        label = f"{benchmark_id}/hidden-{index}"

        expected = call_reference(reference, inputs, label)
        if not bool(torch.isfinite(expected).all().item()):
            del expected
            raise ReferenceFailure(f"reference produced non-finite output on {label}")
        actual = call_candidate(candidate, inputs, label)
        candidate_shape_matches = actual.shape == expected.shape
        candidate_finite = bool(torch.isfinite(actual).all().item())
        candidate_passed = candidate_shape_matches and candidate_finite and bool(
            torch.allclose(expected, actual, atol=ATOL, rtol=RTOL, equal_nan=False)
        )
        wrong_output = call_candidate(wrong_candidate, inputs, f"{label}/wrong-output-control")
        wrong_shape_matches = wrong_output.shape == expected.shape
        wrong_finite = bool(torch.isfinite(wrong_output).all().item())
        negative_matched = wrong_shape_matches and wrong_finite and bool(
            torch.allclose(expected, wrong_output, atol=ATOL, rtol=RTOL, equal_nan=False)
        )
        del actual, wrong_output
        if not candidate_passed:
            del expected
            raise CandidateFailure(f"identity candidate failed correctness on {label}")
        if negative_matched:
            del expected
            raise VerifierFailure(f"trusted wrong-output control passed on {label}")
        del expected

        reference_peak, reference_delta = measure_peak_memory(call_reference, reference, inputs, label)
        candidate_peak, candidate_delta = measure_peak_memory(call_candidate, candidate, inputs, label)
        ref_times = time_model(call_reference, reference, inputs, label)
        candidate_times = time_model(call_candidate, candidate, inputs, label)
        ref_mean = sum(ref_times) / len(ref_times)
        candidate_mean = sum(candidate_times) / len(candidate_times)
        speedup = ref_mean / candidate_mean
        reference_samples.extend(ref_times)
        candidate_samples.extend(candidate_times)
        speedups.append(speedup)
        reference_peaks.append(reference_peak)
        candidate_peaks.append(candidate_peak)
        hidden_results.append(
            {
                "index": index,
                "candidatePassed": True,
                "wrongOutputRejected": True,
                "referenceSamplesMs": ref_times,
                "candidateSamplesMs": candidate_times,
                "referencePeakMemoryBytes": reference_peak,
                "candidatePeakMemoryBytes": candidate_peak,
                "referencePeakDeltaBytes": reference_delta,
                "candidatePeakDeltaBytes": candidate_delta,
                "speedup": speedup,
            }
        )
        del inputs
        torch.cuda.empty_cache()

    metrics = {
        "qualified": 1.0,
        "hiddenConfigsPassed": 4.0,
        "wrongOutputsRejected": 4.0,
        "referenceMeanMs": sum(reference_samples) / len(reference_samples),
        "candidateMeanMs": sum(candidate_samples) / len(candidate_samples),
        "speedupGeomean": geometric_mean(speedups),
        "fastAtOne": 1.0 if all(speedup > 1.0 for speedup in speedups) else 0.0,
        "referencePeakMemoryBytes": float(max(reference_peaks)),
        "candidatePeakMemoryBytes": float(max(candidate_peaks)),
    }
    del reference, candidate, wrong_candidate
    torch.cuda.empty_cache()
    return {
        "benchmarkId": benchmark_id,
        "status": "accepted",
        "failureKind": None,
        "errors": [],
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "taskPath": TASK_PATHS[benchmark_id],
        "hiddenTestPath": HIDDEN_PATHS[benchmark_id],
        "taskSha256": sha256_file(task_path),
        "hiddenTestSha256": sha256_file(hidden_path),
        "hiddenConfigs": hidden_results,
        "metrics": metrics,
    }


def hardware_record(device: torch.device) -> dict[str, Any]:
    properties = torch.cuda.get_device_properties(device)
    return {
        "cluster": "Stanford FarmShare",
        "hostname": socket.gethostname(),
        "gpuName": properties.name,
        "gpuComputeCapability": f"{properties.major}.{properties.minor}",
        "gpuTotalMemoryBytes": int(properties.total_memory),
        "torchVersion": torch.__version__,
        "torchCudaVersion": torch.version.cuda,
        "slurmJobId": os.environ.get("SLURM_JOB_ID", ""),
        "cudaVisibleDevices": os.environ.get("CUDA_VISIBLE_DEVICES", ""),
    }


def validate_request(request: dict[str, Any]) -> tuple[str, str, str, str, str]:
    expected_keys = {
        "schemaVersion",
        "jobId",
        "taskIds",
        "candidateSource",
        "checkoutCommit",
        "environmentSpecSha256",
        "expectedVerifierEpoch",
        "verifierContractDigest",
    }
    if set(request) != expected_keys:
        raise QualificationFailure("request keys do not match the qualification schema")
    if request["schemaVersion"] != 1:
        raise QualificationFailure("unsupported request schema")
    if request["checkoutCommit"] != PINNED_COMMIT:
        raise QualificationFailure("request checkout commit mismatch")
    if request["taskIds"] != list(EXPECTED_TASKS):
        raise QualificationFailure("qualification task list mismatch")
    job_id = request["jobId"]
    candidate_source = request["candidateSource"]
    environment_digest = request["environmentSpecSha256"]
    expected_verifier_epoch = request["expectedVerifierEpoch"]
    verifier_contract_digest = request["verifierContractDigest"]
    if not isinstance(job_id, str) or not job_id:
        raise QualificationFailure("invalid jobId")
    if not isinstance(candidate_source, str) or candidate_source.strip() != IDENTITY_CANDIDATE:
        raise QualificationFailure("invalid qualification candidate")
    if not isinstance(environment_digest, str) or len(environment_digest) != 64:
        raise QualificationFailure("invalid environment spec digest")
    if (
        not isinstance(expected_verifier_epoch, str)
        or not expected_verifier_epoch.startswith(VERIFIER_EPOCH_PREFIX)
        or not isinstance(verifier_contract_digest, str)
        or len(verifier_contract_digest) != 64
        or expected_verifier_epoch != VERIFIER_EPOCH_PREFIX + verifier_contract_digest
    ):
        raise QualificationFailure("invalid controller-bound verifier contract")
    return job_id, candidate_source, environment_digest, expected_verifier_epoch, verifier_contract_digest


def validate_environment(environment_digest: str) -> tuple[str, str, str, str, str, str]:
    environment_manifest = Path(sys.prefix) / "environment.json"
    pip_freeze = Path(sys.prefix) / "pip-freeze.txt"
    environment_seal = Path(sys.prefix) / "environment-seal.json"
    if not environment_manifest.is_file() or not pip_freeze.is_file() or not environment_seal.is_file():
        raise QualificationFailure("content-addressed environment manifests are missing")
    manifest_text = environment_manifest.read_text(encoding="utf-8")
    freeze_text = pip_freeze.read_text(encoding="utf-8")
    seal_text = environment_seal.read_text(encoding="utf-8")
    manifest = json.loads(manifest_text)
    if not isinstance(manifest, dict):
        raise QualificationFailure("environment manifest must be a JSON object")
    if set(manifest) != {
        "schemaVersion",
        "environmentSpecSha256",
        "kernelBenchVerifiedCommit",
        "pip",
        "python",
        "torch",
        "torchCuda",
    }:
        raise QualificationFailure("environment manifest keys do not match the pinned schema")
    if manifest.get("schemaVersion") != 1:
        raise QualificationFailure("environment manifest schema mismatch")
    if manifest.get("environmentSpecSha256") != environment_digest:
        raise QualificationFailure("environment manifest digest does not match the request")
    if manifest.get("kernelBenchVerifiedCommit") != PINNED_COMMIT:
        raise QualificationFailure("environment manifest commit does not match the verifier")
    actual_python = platform.python_version()
    actual_pip = importlib.metadata.version("pip")
    actual_torch = torch.__version__
    actual_torch_cuda = torch.version.cuda
    if (
        actual_python != EXPECTED_PYTHON
        or actual_pip != EXPECTED_PIP
        or actual_torch.split("+")[0] != EXPECTED_TORCH
        or actual_torch_cuda != EXPECTED_TORCH_CUDA
    ):
        raise QualificationFailure("runtime Python, pip, torch, or CUDA version does not match the pinned environment")
    if (
        manifest.get("python") != actual_python
        or manifest.get("pip") != actual_pip
        or manifest.get("torch") != actual_torch
        or manifest.get("torchCuda") != actual_torch_cuda
    ):
        raise QualificationFailure("environment manifest does not match the actual runtime")
    freeze_lines = set(freeze_text.splitlines())
    if f"pip=={EXPECTED_PIP}" not in freeze_lines or not any(
        line.startswith(f"torch=={EXPECTED_TORCH}") for line in freeze_lines
    ):
        raise QualificationFailure("pip freeze does not contain the pinned pip and torch versions")
    manifest_digest = sha256_file(environment_manifest)
    freeze_digest = sha256_file(pip_freeze)
    seal = json.loads(seal_text)
    if seal != {
        "schemaVersion": 1,
        "environmentSpecSha256": environment_digest,
        "environmentManifestSha256": manifest_digest,
        "pipFreezeSha256": freeze_digest,
    }:
        raise QualificationFailure("environment seal does not bind the runtime manifests")
    return manifest_digest, freeze_digest, sha256_file(environment_seal), manifest_text, freeze_text, seal_text


def build_verifier_manifest(
    checkout: Path,
    environment_digest: str,
    environment_manifest_digest: str,
    pip_freeze_digest: str,
    environment_seal_digest: str,
) -> dict[str, Any]:
    task_inputs = {
        benchmark_id: {
            "taskSha256": sha256_file(checkout / TASK_PATHS[benchmark_id]),
            "hiddenTestSha256": sha256_file(checkout / HIDDEN_PATHS[benchmark_id]),
        }
        for benchmark_id in EXPECTED_TASKS
    }
    return {
        "schemaVersion": 1,
        "checkoutCommit": PINNED_COMMIT,
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "environmentSpecSha256": environment_digest,
        "environmentManifestSha256": environment_manifest_digest,
        "pipFreezeSha256": pip_freeze_digest,
        "environmentSealSha256": environment_seal_digest,
        "candidateSha256": sha256_bytes(IDENTITY_CANDIDATE.encode("utf-8")),
        "negativeControlSha256": sha256_bytes(WRONG_OUTPUT_CANDIDATE.encode("utf-8")),
        "precision": {
            "dtype": "float32",
            "matmulPrecision": "high",
            "matmulAllowTf32": True,
            "cudnnAllowTf32": True,
            "atol": ATOL,
            "rtol": RTOL,
        },
        "timing": {"warmups": WARMUPS, "trials": TRIALS, "unit": "milliseconds"},
        "compileCanary": COMPILE_CANARY_SPEC,
        "taskInputs": task_inputs,
    }


def manifest_epoch(manifest: dict[str, Any]) -> str:
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    return VERIFIER_EPOCH_PREFIX + sha256_bytes(canonical.encode("utf-8"))


def run(checkout: Path, request_path: Path, output_path: Path) -> int:
    started_at = utc_now()
    request: dict[str, Any] = {}
    tasks: list[dict[str, Any]] = []
    fatal_error: str | None = None
    fatal_kind: str | None = None
    hardware: dict[str, Any] = {}
    job_id = ""
    candidate_source = ""
    environment_digest = ""
    environment_manifest_digest = ""
    pip_freeze_digest = ""
    environment_seal_digest = ""
    environment_manifest_text = ""
    pip_freeze_text = ""
    environment_seal_text = ""
    request_digest = sha256_file(request_path) if request_path.is_file() else ""
    verifier_manifest: dict[str, Any] = {}
    verifier_epoch = VERIFIER_EPOCH_PREFIX + "unresolved"
    compile_canary: dict[str, Any] = {
        **COMPILE_CANARY_SPEC,
        "passed": False,
        "maxAbsError": None,
        "error": "not run",
    }
    try:
        request = load_json_object(request_path)
        job_id, candidate_source, environment_digest, expected_verifier_epoch, verifier_contract_digest = (
            validate_request(request)
        )
        (
            environment_manifest_digest,
            pip_freeze_digest,
            environment_seal_digest,
            environment_manifest_text,
            pip_freeze_text,
            environment_seal_text,
        ) = validate_environment(environment_digest)
        validate_checkout(checkout)
        verifier_manifest = build_verifier_manifest(
            checkout,
            environment_digest,
            environment_manifest_digest,
            pip_freeze_digest,
            environment_seal_digest,
        )
        verifier_epoch = manifest_epoch(verifier_manifest)
        if verifier_epoch != expected_verifier_epoch or sha256_bytes(
            json.dumps(verifier_manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ) != verifier_contract_digest:
            raise QualificationFailure("controller-bound verifier contract does not match the evaluator")
        if not torch.cuda.is_available():
            raise QualificationFailure("CUDA is required for KernelBench qualification")
        device = torch.device("cuda", 0)
        torch.cuda.set_device(device)
        torch.set_default_dtype(torch.float32)
        torch.set_float32_matmul_precision("high")
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        hardware = hardware_record(device)
        try:
            compile_canary = run_compile_canary(device)
        except QualificationFailure as error:
            compile_canary["error"] = str(error)
            raise

        for index, benchmark_id in enumerate(EXPECTED_TASKS):
            task_started = utc_now()
            try:
                tasks.append(evaluate_task(checkout, benchmark_id, candidate_source, device))
            except QualificationFailure as error:
                fatal_error = str(error)
                fatal_kind = error.failure_kind
                tasks.append(failed_task(benchmark_id, fatal_kind, fatal_error, checkout, task_started))
                for remaining in EXPECTED_TASKS[index + 1 :]:
                    tasks.append(
                        failed_task(
                            remaining,
                            "not-run-after-fatal",
                            f"not run after fatal {fatal_kind} failure on {benchmark_id}",
                            checkout,
                            utc_now(),
                        )
                    )
                break
    except Exception as error:
        fatal_error = str(error)
        fatal_kind = error.failure_kind if isinstance(error, QualificationFailure) else "infrastructure"
        completed = {task["benchmarkId"] for task in tasks}
        for benchmark_id in EXPECTED_TASKS:
            if benchmark_id not in completed:
                tasks.append(failed_task(benchmark_id, fatal_kind, fatal_error, checkout, utc_now()))
        traceback.print_exc(file=sys.stderr)

    ok = fatal_error is None and len(tasks) == len(EXPECTED_TASKS) and all(task["status"] == "accepted" for task in tasks)
    candidate_digest = sha256_bytes(candidate_source.encode("utf-8")) if candidate_source else ""
    result = {
        "schemaVersion": 1,
        "ok": ok,
        "verifierEpoch": verifier_epoch,
        "verifierManifest": verifier_manifest,
        "jobId": job_id,
        "requestSha256": request_digest,
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "checkoutCommit": PINNED_COMMIT,
        "candidateSha256": candidate_digest,
        "negativeControlSha256": sha256_bytes(WRONG_OUTPUT_CANDIDATE.encode("utf-8")),
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "environmentSpecSha256": environment_digest,
        "environmentManifestSha256": environment_manifest_digest,
        "pipFreezeSha256": pip_freeze_digest,
        "environmentSealSha256": environment_seal_digest,
        "environmentManifest": environment_manifest_text,
        "pipFreeze": pip_freeze_text,
        "environmentSeal": environment_seal_text,
        "precision": {
            "dtype": "float32",
            "matmulPrecision": "high",
            "matmulAllowTf32": True,
            "cudnnAllowTf32": True,
            "atol": ATOL,
            "rtol": RTOL,
        },
        "timing": {"warmups": WARMUPS, "trials": TRIALS, "unit": "milliseconds"},
        "compileCanary": compile_canary,
        "hardware": hardware,
        "fatalKind": fatal_kind,
        "fatalError": fatal_error,
        "tasks": tasks,
    }
    atomic_write_json(output_path, result)
    print(json.dumps({"ok": ok, "output": str(output_path), "tasks": len(tasks)}, sort_keys=True))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return run(args.checkout.resolve(), args.request.resolve(), args.output.resolve())


if __name__ == "__main__":
    raise SystemExit(main())

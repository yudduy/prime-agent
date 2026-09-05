#!/usr/bin/env python3
"""Allowlisted qualification for one compiled KernelBench candidate.

This evaluator executes no model API and accepts only the frozen level2/2
positive and wrong-output sources whose byte hashes are pinned below.
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
import time
import traceback
from types import ModuleType
from typing import Any, Callable

import numpy
import torch


PINNED_COMMIT = "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e"
VERIFIER_EPOCH_PREFIX = "kernelbench-verified-compiled-qualification-v1:"
BENCHMARK_ID = "level2/2"
TASK_PATH = "KernelBench/level2/2_ConvTranspose2d_BiasAdd_Clamp_Scaling_Clamp_Divide.py"
HIDDEN_PATH = "hidden_tests/level2/2_hidden.py"
EXPECTED_TASK_SHA256 = "31f49a84239cb24383e84ea78c778d9fc047455a12df3e2eb269ce6deedaf808"
EXPECTED_HIDDEN_SHA256 = "5a951a50e3d2e23f3a977005e6508ae3f37974e1bf08b2fdb0f004619f46e6f0"
EXPECTED_ENVIRONMENT_SHA256 = "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b"
POSITIVE_CANDIDATE_SHA256 = "6ab0b1895809346077b6b5c88ccd0e4953c00791164336de886e0533c0028af3"
WRONG_CANDIDATE_SHA256 = "fe5cbcc2a924f2819f1df65b05945881e9d55aa1e78722e616b74d07868d6c33"
POSITIVE_CANDIDATE = """class ModelNew(Model):
    @torch.compile(backend="inductor", fullgraph=True, dynamic=False)
    def forward(self, x):
        x = self.conv_transpose(x)
        x = x + self.bias
        x = torch.clamp(x, min=0.0, max=1.0)
        x = x * self.scaling_factor
        x = torch.clamp(x, min=0.0, max=1.0)
        return x / self.scaling_factor
"""
WRONG_CANDIDATE = """class ModelNew(Model):
    @torch.compile(backend="inductor", fullgraph=True, dynamic=False)
    def forward(self, x):
        x = self.conv_transpose(x)
        x = x + self.bias
        x = torch.clamp(x, min=0.0, max=1.0)
        x = x * self.scaling_factor
        x = torch.clamp(x, min=0.0, max=1.0)
        x = x / self.scaling_factor
        return torch.where(x >= 0, -torch.ones_like(x), torch.ones_like(x))
"""
EXPECTED_PYTHON = "3.12.3"
EXPECTED_PIP = "25.2"
EXPECTED_TORCH = "2.11.0"
EXPECTED_TORCH_CUDA = "12.8"
EXPECTED_NUMPY = "2.5.2"
PRECISION_SPEC = {
    "dtype": "float32",
    "matmulPrecision": "high",
    "matmulAllowTf32": True,
    "cudnnAllowTf32": True,
    "atol": 1e-3,
    "rtol": 1e-3,
}
TIMING_SPEC = {
    "warmups": 3,
    "trials": 10,
    "unit": "milliseconds",
    "coldFirstInvocationSeparate": True,
}
COMPILATION_SPEC = {
    "backend": "inductor",
    "fullgraph": True,
    "dynamic": False,
}
WARMUPS = 3
TRIALS = 10
ATOL = 1e-3
RTOL = 1e-3
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
    if git_output(checkout, "status", "--porcelain", "--untracked-files=no"):
        raise QualificationFailure("pinned checkout has modified tracked files")
    if sha256_file(checkout / TASK_PATH) != EXPECTED_TASK_SHA256:
        raise QualificationFailure("pinned level2/2 task changed")
    if sha256_file(checkout / HIDDEN_PATH) != EXPECTED_HIDDEN_SHA256:
        raise QualificationFailure("pinned level2/2 hidden fixture changed")


def load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise QualificationFailure(f"cannot load module from {path}")
    if name in sys.modules:
        raise QualificationFailure(f"module name already registered: {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
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


def first_invocation(
    model: torch.nn.Module,
    inputs: list[Any],
    label: str,
) -> tuple[torch.Tensor, float]:
    started = time.perf_counter()
    output = call_candidate(model, inputs, label)
    elapsed_ms = (time.perf_counter() - started) * 1000
    if not math.isfinite(elapsed_ms) or elapsed_ms <= 0:
        del output
        raise QualificationFailure(f"invalid first-invocation latency for {label}")
    return output, elapsed_ms


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


def geometric_mean(values: list[float]) -> float:
    if not values or any(value <= 0 or not math.isfinite(value) for value in values):
        raise QualificationFailure("cannot compute geometric mean from invalid values")
    return math.exp(sum(math.log(value) for value in values) / len(values))


def compile_candidate(source: str, task_module: ModuleType, label: str) -> type[torch.nn.Module]:
    namespace = dict(vars(task_module))
    exec(compile(source, f"<allowlisted-{label}-candidate>", "exec"), namespace)
    candidate_class = namespace.get("ModelNew")
    model_class = getattr(task_module, "Model", None)
    if not isinstance(candidate_class, type) or not isinstance(model_class, type):
        raise QualificationFailure(f"{label} ModelNew did not resolve")
    if candidate_class is model_class or not issubclass(candidate_class, model_class):
        raise QualificationFailure(f"{label} ModelNew is not a distinct Model subclass")
    return candidate_class


def evaluate_task(checkout: Path, device: torch.device) -> dict[str, Any]:
    started_at = utc_now()
    task_path = checkout / TASK_PATH
    hidden_path = checkout / HIDDEN_PATH
    task_module = load_module(task_path, "kbv_compiled_level2_2")
    model_class = getattr(task_module, "Model", None)
    get_init_inputs = getattr(task_module, "get_init_inputs", None)
    if not isinstance(model_class, type) or not callable(get_init_inputs):
        raise QualificationFailure("invalid level2/2 task interface")
    positive_class = compile_candidate(POSITIVE_CANDIDATE, task_module, "positive")
    wrong_class = compile_candidate(WRONG_CANDIDATE, task_module, "wrong")
    init_inputs = get_init_inputs()
    if not isinstance(init_inputs, (list, tuple)):
        raise QualificationFailure("get_init_inputs returned an invalid value for level2/2")

    set_seed(SEED)
    reference = model_class(*init_inputs).to(device=device, dtype=torch.float32).eval()
    set_seed(SEED)
    positive = positive_class(*init_inputs).to(device=device, dtype=torch.float32).eval()
    positive.load_state_dict(reference.state_dict(), strict=True)
    set_seed(SEED)
    wrong = wrong_class(*init_inputs).to(device=device, dtype=torch.float32).eval()
    wrong.load_state_dict(reference.state_dict(), strict=True)

    set_seed(SEED)
    hidden_module = load_module(hidden_path, "kbv_compiled_hidden_level2_2")
    get_hidden_inputs = getattr(hidden_module, "get_hidden_inputs", None)
    if not callable(get_hidden_inputs):
        raise QualificationFailure("level2/2 hidden fixture has no get_hidden_inputs")
    raw_configs = get_hidden_inputs()
    if not isinstance(raw_configs, list) or len(raw_configs) != 4:
        raise QualificationFailure("level2/2 must provide exactly four hidden configs")

    hidden_results: list[dict[str, Any]] = []
    reference_samples: list[float] = []
    positive_samples: list[float] = []
    speedups: list[float] = []
    first_invocations: list[float] = []
    for index, raw_inputs in enumerate(raw_configs, start=1):
        if not isinstance(raw_inputs, (list, tuple)):
            raise QualificationFailure(f"hidden config {index} is not an input list")
        inputs = [to_device(value, device) for value in raw_inputs]
        label = f"{BENCHMARK_ID}/hidden-{index}"
        expected = call_reference(reference, inputs, label)
        if not bool(torch.isfinite(expected).all().item()):
            del expected
            raise ReferenceFailure(f"reference produced non-finite output on {label}")

        actual, first_invocation_ms = first_invocation(positive, inputs, label)
        positive_passed = (
            actual.shape == expected.shape
            and bool(torch.isfinite(actual).all().item())
            and bool(torch.allclose(expected, actual, atol=ATOL, rtol=RTOL, equal_nan=False))
        )
        wrong_output = call_candidate(wrong, inputs, f"{label}/wrong-output-control")
        wrong_matched = (
            wrong_output.shape == expected.shape
            and bool(torch.isfinite(wrong_output).all().item())
            and bool(torch.allclose(expected, wrong_output, atol=ATOL, rtol=RTOL, equal_nan=False))
        )
        del actual, wrong_output, expected
        if not positive_passed:
            raise CandidateFailure(f"allowlisted compiled candidate failed correctness on {label}")
        if wrong_matched:
            raise VerifierFailure(f"allowlisted wrong-output candidate passed on {label}")

        ref_times = time_model(call_reference, reference, inputs, label)
        compiled_times = time_model(call_candidate, positive, inputs, label)
        ref_mean = sum(ref_times) / len(ref_times)
        compiled_mean = sum(compiled_times) / len(compiled_times)
        speedup = ref_mean / compiled_mean
        reference_samples.extend(ref_times)
        positive_samples.extend(compiled_times)
        speedups.append(speedup)
        first_invocations.append(first_invocation_ms)
        hidden_results.append(
            {
                "index": index,
                "positivePassed": True,
                "wrongCandidateRejected": True,
                "positiveFirstInvocationMs": first_invocation_ms,
                "referenceSamplesMs": ref_times,
                "positiveSamplesMs": compiled_times,
                "speedup": speedup,
            }
        )
        del inputs
        torch.cuda.empty_cache()

    if len(hidden_results) != 4 or not all(item["positivePassed"] for item in hidden_results):
        raise CandidateFailure("positive candidate did not pass all four hidden configs")
    if not all(item["wrongCandidateRejected"] for item in hidden_results):
        raise VerifierFailure("wrong candidate was not rejected on all four hidden configs")
    metrics = {
        "qualified": 1.0,
        "hiddenConfigsPassed": 4.0,
        "wrongCandidatesRejected": 4.0,
        "coldCompileMs": first_invocations[0],
        "firstInvocationMeanMs": sum(first_invocations) / len(first_invocations),
        "referenceMeanMs": sum(reference_samples) / len(reference_samples),
        "positiveMeanMs": sum(positive_samples) / len(positive_samples),
        "speedupGeomean": geometric_mean(speedups),
        "fastAtOne": 1.0 if all(speedup > 1.0 for speedup in speedups) else 0.0,
    }
    del reference, positive, wrong
    torch.cuda.empty_cache()
    return {
        "benchmarkId": BENCHMARK_ID,
        "status": "accepted",
        "failureKind": None,
        "errors": [],
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "taskPath": TASK_PATH,
        "hiddenTestPath": HIDDEN_PATH,
        "taskSha256": sha256_file(task_path),
        "hiddenTestSha256": sha256_file(hidden_path),
        "hiddenConfigs": hidden_results,
        "metrics": metrics,
    }


def failed_task(failure_kind: str, error: str, checkout: Path, started_at: str) -> dict[str, Any]:
    task_path = checkout / TASK_PATH
    hidden_path = checkout / HIDDEN_PATH
    return {
        "benchmarkId": BENCHMARK_ID,
        "status": "failed",
        "failureKind": failure_kind,
        "errors": [error],
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "taskPath": TASK_PATH,
        "hiddenTestPath": HIDDEN_PATH,
        "taskSha256": sha256_file(task_path) if task_path.is_file() else None,
        "hiddenTestSha256": sha256_file(hidden_path) if hidden_path.is_file() else None,
        "hiddenConfigs": [],
        "metrics": {},
    }


def validate_request(request: dict[str, Any]) -> tuple[str, str, str]:
    expected_keys = {
        "schemaVersion",
        "jobId",
        "taskId",
        "positiveCandidateSource",
        "wrongCandidateSource",
        "positiveCandidateSha256",
        "wrongCandidateSha256",
        "checkoutCommit",
        "environmentSpecSha256",
        "expectedVerifierEpoch",
        "verifierContractDigest",
    }
    if set(request) != expected_keys:
        raise QualificationFailure("request keys do not match the compiled qualification schema")
    if request["schemaVersion"] != 1:
        raise QualificationFailure("unsupported request schema")
    if request["checkoutCommit"] != PINNED_COMMIT or request["taskId"] != BENCHMARK_ID:
        raise QualificationFailure("request task or checkout mismatch")
    job_id = request["jobId"]
    if not isinstance(job_id, str) or not job_id:
        raise QualificationFailure("invalid jobId")
    positive_source = request["positiveCandidateSource"]
    wrong_source = request["wrongCandidateSource"]
    if not isinstance(positive_source, str) or positive_source != POSITIVE_CANDIDATE:
        raise QualificationFailure("positive candidate is not the exact allowlisted source")
    if not isinstance(wrong_source, str) or wrong_source != WRONG_CANDIDATE:
        raise QualificationFailure("wrong candidate is not the exact allowlisted source")
    if (
        sha256_bytes(positive_source.encode("utf-8")) != POSITIVE_CANDIDATE_SHA256
        or request["positiveCandidateSha256"] != POSITIVE_CANDIDATE_SHA256
        or sha256_bytes(wrong_source.encode("utf-8")) != WRONG_CANDIDATE_SHA256
        or request["wrongCandidateSha256"] != WRONG_CANDIDATE_SHA256
    ):
        raise QualificationFailure("candidate SHA-256 allowlist mismatch")
    environment_digest = request["environmentSpecSha256"]
    if environment_digest != EXPECTED_ENVIRONMENT_SHA256:
        raise QualificationFailure("compiled environment lock digest mismatch")
    expected_epoch = request["expectedVerifierEpoch"]
    contract_digest = request["verifierContractDigest"]
    if (
        not isinstance(expected_epoch, str)
        or not expected_epoch.startswith(VERIFIER_EPOCH_PREFIX)
        or not isinstance(contract_digest, str)
        or len(contract_digest) != 64
        or expected_epoch != VERIFIER_EPOCH_PREFIX + contract_digest
    ):
        raise QualificationFailure("invalid controller-bound verifier contract")
    return job_id, expected_epoch, contract_digest


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
    if not isinstance(manifest, dict) or set(manifest) != {
        "schemaVersion",
        "environmentSpecSha256",
        "kernelBenchVerifiedCommit",
        "numpy",
        "pip",
        "python",
        "torch",
        "torchCuda",
    }:
        raise QualificationFailure("environment manifest keys do not match the compiled schema")
    actual_python = platform.python_version()
    actual_pip = importlib.metadata.version("pip")
    actual_torch = torch.__version__
    actual_torch_cuda = torch.version.cuda
    actual_numpy = numpy.__version__
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("environmentSpecSha256") != environment_digest
        or manifest.get("kernelBenchVerifiedCommit") != PINNED_COMMIT
        or actual_python != EXPECTED_PYTHON
        or actual_pip != EXPECTED_PIP
        or actual_torch.split("+")[0] != EXPECTED_TORCH
        or actual_torch_cuda != EXPECTED_TORCH_CUDA
        or actual_numpy != EXPECTED_NUMPY
        or manifest.get("python") != actual_python
        or manifest.get("pip") != actual_pip
        or manifest.get("torch") != actual_torch
        or manifest.get("torchCuda") != actual_torch_cuda
        or manifest.get("numpy") != actual_numpy
    ):
        raise QualificationFailure("runtime does not match the frozen compiled environment")
    freeze_lines = set(freeze_text.splitlines())
    if (
        f"pip=={EXPECTED_PIP}" not in freeze_lines
        or f"numpy=={EXPECTED_NUMPY}" not in freeze_lines
        or not any(line.startswith(f"torch=={EXPECTED_TORCH}") for line in freeze_lines)
    ):
        raise QualificationFailure("pip freeze does not contain the pinned compiled dependencies")
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
    environment_digest: str,
    environment_manifest_digest: str,
    pip_freeze_digest: str,
    environment_seal_digest: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "qualificationLane": "compiled-level2-2",
        "checkoutCommit": PINNED_COMMIT,
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "environmentSpecSha256": environment_digest,
        "environmentManifestSha256": environment_manifest_digest,
        "pipFreezeSha256": pip_freeze_digest,
        "environmentSealSha256": environment_seal_digest,
        "taskSha256": EXPECTED_TASK_SHA256,
        "hiddenTestSha256": EXPECTED_HIDDEN_SHA256,
        "positiveCandidateSha256": POSITIVE_CANDIDATE_SHA256,
        "wrongCandidateSha256": WRONG_CANDIDATE_SHA256,
        "precision": PRECISION_SPEC,
        "timing": TIMING_SPEC,
        "compilation": COMPILATION_SPEC,
    }


def manifest_epoch(manifest: dict[str, Any]) -> str:
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
    return VERIFIER_EPOCH_PREFIX + sha256_bytes(canonical.encode("utf-8"))


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
        "numpyVersion": numpy.__version__,
        "slurmJobId": os.environ.get("SLURM_JOB_ID", ""),
        "cudaVisibleDevices": os.environ.get("CUDA_VISIBLE_DEVICES", ""),
    }


def run(checkout: Path, request_path: Path, output_path: Path) -> int:
    started_at = utc_now()
    request_digest = sha256_file(request_path) if request_path.is_file() else ""
    job_id = ""
    environment_digest = ""
    environment_manifest_digest = ""
    pip_freeze_digest = ""
    environment_seal_digest = ""
    environment_manifest_text = ""
    pip_freeze_text = ""
    environment_seal_text = ""
    verifier_manifest: dict[str, Any] = {}
    verifier_epoch = VERIFIER_EPOCH_PREFIX + "unresolved"
    hardware: dict[str, Any] = {}
    tasks: list[dict[str, Any]] = []
    fatal_error: str | None = None
    fatal_kind: str | None = None
    task_started = utc_now()
    try:
        request = load_json_object(request_path)
        job_id, expected_epoch, contract_digest = validate_request(request)
        environment_digest = request["environmentSpecSha256"]
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
            environment_digest,
            environment_manifest_digest,
            pip_freeze_digest,
            environment_seal_digest,
        )
        verifier_epoch = manifest_epoch(verifier_manifest)
        canonical_manifest = json.dumps(verifier_manifest, sort_keys=True, separators=(",", ":"))
        if (
            verifier_epoch != expected_epoch
            or sha256_bytes(canonical_manifest.encode("utf-8")) != contract_digest
        ):
            raise QualificationFailure("controller-bound verifier contract does not match the evaluator")
        if not torch.cuda.is_available():
            raise QualificationFailure("CUDA is required for compiled KernelBench qualification")
        device = torch.device("cuda", 0)
        torch.cuda.set_device(device)
        properties = torch.cuda.get_device_properties(device)
        if (properties.major, properties.minor) != (8, 9) or "l40s" not in properties.name.lower():
            raise QualificationFailure("compiled qualification requires one FarmShare L40S")
        if not os.environ.get("SLURM_JOB_ID", "").isdigit():
            raise QualificationFailure("compiled qualification requires a SLURM job identity")
        torch.set_default_dtype(torch.float32)
        torch.set_float32_matmul_precision("high")
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        hardware = hardware_record(device)
        tasks.append(evaluate_task(checkout, device))
    except Exception as error:
        fatal_error = str(error)
        fatal_kind = error.failure_kind if isinstance(error, QualificationFailure) else "infrastructure"
        tasks = [failed_task(fatal_kind, fatal_error, checkout, task_started)]
        traceback.print_exc(file=sys.stderr)

    ok = fatal_error is None and len(tasks) == 1 and tasks[0]["status"] == "accepted"
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
        "taskSha256": EXPECTED_TASK_SHA256,
        "hiddenTestSha256": EXPECTED_HIDDEN_SHA256,
        "positiveCandidateSha256": POSITIVE_CANDIDATE_SHA256,
        "wrongCandidateSha256": WRONG_CANDIDATE_SHA256,
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "environmentSpecSha256": environment_digest,
        "environmentManifestSha256": environment_manifest_digest,
        "pipFreezeSha256": pip_freeze_digest,
        "environmentSealSha256": environment_seal_digest,
        "environmentManifest": environment_manifest_text,
        "pipFreeze": pip_freeze_text,
        "environmentSeal": environment_seal_text,
        "precision": PRECISION_SPEC,
        "timing": TIMING_SPEC,
        "compilation": COMPILATION_SPEC,
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

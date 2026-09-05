#!/usr/bin/env python3
"""Sealed one-trial FarmShare worker for the stock NanoGPT CUDA smoke.

This worker is intentionally infrastructure-only. It accepts only the exact
stock fixture already admitted by the G1 runtime contract and never emits a
candidate-quality or record claim.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import struct
import subprocess
import sys
import traceback
from typing import Any, Optional, Sequence


SCHEMA_VERSION = 1
CONTRACT = "nanogpt-farmshare-stock-cuda-smoke-v1"
EVIDENCE_CLASS = "infrastructure-only-stock-smoke"
RUNTIME_CONTRACT = "nanogpt-track3-runtime-contract-v2"
RUNTIME_CLAIM_SCOPE = (
    "Only the byte-exact pinned stock fixture may be claimed to have compiled and completed 10 "
    "training steps in cuda-smoke-10 mode with seed 0xC0FFEE; no candidate-quality, score, or "
    "record claim is permitted."
)
EXPECTED_ENVIRONMENT_SPEC_SHA256 = (
    "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b"
)
EXPECTED_ENVIRONMENT_DIR = Path(
    "/scratch/users/duynguy/prime-autoresearch/kernelbench-compiled/envs/"
    + EXPECTED_ENVIRONMENT_SPEC_SHA256
)
EXPECTED_KERNELBENCH_COMMIT = "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e"
EXPECTED_PYTHON = "3.12.3"
EXPECTED_PIP = "25.2"
EXPECTED_TORCH = "2.11.0+cu128"
EXPECTED_TORCH_CUDA = "12.8"
EXPECTED_NUMPY = "2.5.2"
EXPECTED_ENVIRONMENT_MANIFEST_SHA256 = (
    "71ddfe105be64b7122d7b6d143ea1a6c26a5b9de30cc414a9cbd9df7cd314de8"
)
EXPECTED_PIP_FREEZE_SHA256 = (
    "b85ceb87080994284c997e0ea3742246df1a12d4fc2551a9d8412d87160766d9"
)
EXPECTED_ENVIRONMENT_SEAL_SHA256 = (
    "c3016d0d77837dad553847c6db0ae96cd1cd4fdce5ba2144306550a8f7b9d576"
)
EXPECTED_ENVIRONMENT_EXECUTABLES = {
    "python": {
        "path": str(EXPECTED_ENVIRONMENT_DIR / "bin/python"),
        "linkTarget": "python3",
        "python3LinkTarget": "/usr/bin/python3",
        "resolvedPath": "/usr/bin/python3.12",
        "sha256": "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118",
        "size": 8020928,
    },
    "torchrun": {
        "path": str(EXPECTED_ENVIRONMENT_DIR / "bin/torchrun"),
        "sha256": "7ff57f7f5ee11cc74839fda7b12e2a97fd2808dd00ae1eafd05f302df5def748",
        "size": 367,
        "mode": 0o555,
    },
}
EXPECTED_BASELINE_SHA256 = "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e"
EXPECTED_RUNTIME_SHA256 = "318afff0bf5f1e815ce2b93ebbb90dd50d898a19bc9d7c77d03694cb05fa6be7"
EXPECTED_MANIFEST_SHA256 = "79f238c695fb18fc3d578bb72606b3876931cd60aebdac88fb10c6fe54bbb67a"
EXPECTED_RUNTIME_EVALUATOR_SHA256 = (
    "332ca9680087fa43fa93f75219716ea78dbb339441cdda5d64986efce766b5f5"
)
EXPECTED_STATIC_EVALUATOR_SHA256 = (
    "007dd1ef186f003906828f05369974e1096619f1e1f74617fce6d8ce6da20c4c"
)
EXPECTED_DATASET_MANIFEST_SHA256 = (
    "21e5ec359d94b274cc5dcd072b99bf5fa9132b4a34a414d062f151dc8cbdfd40"
)
EXPECTED_DATASET_FILES = (
    {
        "path": "fineweb_val_000000.bin",
        "size": 200001024,
        "sha256": "5b95c8e0966f0861685b307b23dc5ae42b228ef74b28cb499784ae021f201640",
    },
    {
        "path": "fineweb_train_000001.bin",
        "size": 200001024,
        "sha256": "771fa4a99b9fe0946ffb6e848b4ba5c6a9b0fe87860ebf03bc2c1c7e45f8178e",
    },
)
EXPECTED_DATASET_HEADERS = (
    {"path": "fineweb_val_000000.bin", "magic": 20240520, "version": 1, "tokens": 100000000},
    {"path": "fineweb_train_000001.bin", "magic": 20240520, "version": 1, "tokens": 100000000},
)
EXPECTED_DATASET_CONSUMPTION = {
    "validationTokens": 10485760,
    "trainingTokensForTenSteps": 5242880,
}
FORBIDDEN_ENVIRONMENT = ("WANDB_API_KEY", "WANDB_MODE", "WANDB_ENTITY")
LAUNCH_ENVIRONMENT_KEYS = (
    "CUDA_DEVICE_ORDER",
    "CUDA_VISIBLE_DEVICES",
    "HOME",
    "LC_ALL",
    "PATH",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONNOUSERSITE",
    "PYTHON_EXEC",
    "SLURM_JOB_ID",
    "TMPDIR",
    "TORCHINDUCTOR_CACHE_DIR",
)
FIXED_TORCHRUN_ARGS = (
    "--standalone",
    "--nnodes=1",
    "--nproc-per-node=1",
    "train_gpt_runtime.py",
    "1",
)
FIXED_RUNTIME_PROCESS_ARGS = (
    "-I",
    str(EXPECTED_ENVIRONMENT_DIR / "bin/torchrun"),
    *FIXED_TORCHRUN_ARGS,
)
EXPECTED_ISOLATED_PYTHON_SHA256 = (
    "bc258dfc14cba20e8bfc23d4428e93f7a307df83c3b7887b1065a67d53c2586f"
)
HASH_PATTERN = re.compile(r"[0-9a-f]{64}")
JOB_KEY_PATTERN = re.compile(r"[0-9a-f]{64}")


class WorkerFailure(RuntimeError):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: object) -> str:
    return sha256_bytes(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )


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


def expect_sha256(value: object, label: str) -> str:
    digest = expect_string(value, label)
    if HASH_PATTERN.fullmatch(digest) is None:
        raise WorkerFailure("contract", f"{label} must be a lowercase SHA-256")
    return digest


def regular_file(path: Path, label: str) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise WorkerFailure("asset", f"cannot inspect {label}: {error}") from error
    if not stat.S_ISREG(mode) or path.is_symlink():
        raise WorkerFailure("asset", f"{label} must be a regular non-symlink file")


def read_json_object(path: Path, label: str) -> dict[str, Any]:
    regular_file(path, label)
    try:
        return expect_record(json.loads(path.read_text(encoding="utf-8")), label)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise WorkerFailure("asset", f"cannot parse {label}: {error}") from error


def validate_job_root(job_root: Path, job_key: str) -> None:
    if job_root != job_root.resolve() or job_root.is_symlink() or not job_root.is_dir():
        raise WorkerFailure("contract", "job root must be an existing normalized non-symlink directory")
    if job_root.name != job_key or job_root.parent.name != "jobs":
        raise WorkerFailure("contract", "fresh job root is not bound to the execution-seal key")
    if not str(job_root).startswith("/scratch/users/duynguy/prime-autoresearch/nanogpt/jobs/"):
        raise WorkerFailure("contract", "job root is outside the sealed NanoGPT scratch root")
    if Path.cwd().resolve() != job_root:
        raise WorkerFailure("contract", "worker must start in its fresh per-job directory")


def validate_request(request_path: Path, job_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    request = read_json_object(request_path, "request")
    expect_exact_keys(
        request,
        {
            "schemaVersion",
            "contract",
            "evidenceClass",
            "jobKey",
            "executionSeal",
            "jobScriptSha256",
        },
        "request",
    )
    if (
        request.get("schemaVersion") != SCHEMA_VERSION
        or request.get("contract") != CONTRACT
        or request.get("evidenceClass") != EVIDENCE_CLASS
    ):
        raise WorkerFailure("contract", "request identity mismatch")
    job_key = expect_sha256(request.get("jobKey"), "request.jobKey")
    execution_seal = expect_record(request.get("executionSeal"), "request.executionSeal")
    if canonical_sha256(execution_seal) != job_key:
        raise WorkerFailure("contract", "execution seal does not match the job key")
    validate_job_root(job_root, job_key)
    job_script_sha256 = expect_sha256(
        request.get("jobScriptSha256"), "request.jobScriptSha256"
    )
    if sha256_file(job_root / "job.sh") != job_script_sha256:
        raise WorkerFailure("asset", "job script hash mismatch")
    return request, execution_seal


def validate_execution_seal(job_root: Path, seal: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    expect_exact_keys(
        seal,
        {
            "schemaVersion",
            "contract",
            "evidenceClass",
            "workerSha256",
            "bundle",
            "environment",
            "dataset",
            "launch",
            "slurm",
        },
        "executionSeal",
    )
    if (
        seal.get("schemaVersion") != SCHEMA_VERSION
        or seal.get("contract") != CONTRACT
        or seal.get("evidenceClass") != EVIDENCE_CLASS
    ):
        raise WorkerFailure("contract", "execution seal identity mismatch")
    worker_sha256 = expect_sha256(seal.get("workerSha256"), "executionSeal.workerSha256")
    if sha256_file(Path(__file__).resolve()) != worker_sha256:
        raise WorkerFailure("asset", "worker source hash mismatch")

    bundle = expect_record(seal.get("bundle"), "executionSeal.bundle")
    expect_exact_keys(
        bundle,
        {
            "runtimeContract",
            "claimScope",
            "mode",
            "trials",
            "manifestSha256",
            "candidateSha256",
            "runtimeSha256",
            "runtimeEvaluatorSha256",
            "staticEvaluatorSha256",
            "baselineSha256",
        },
        "executionSeal.bundle",
    )
    if (
        bundle.get("runtimeContract") != RUNTIME_CONTRACT
        or bundle.get("claimScope") != RUNTIME_CLAIM_SCOPE
        or bundle.get("mode") != "cuda-smoke-10"
        or bundle.get("trials") != 1
        or bundle.get("candidateSha256") != EXPECTED_BASELINE_SHA256
        or bundle.get("baselineSha256") != EXPECTED_BASELINE_SHA256
        or bundle.get("runtimeSha256") != EXPECTED_RUNTIME_SHA256
        or bundle.get("manifestSha256") != EXPECTED_MANIFEST_SHA256
        or bundle.get("runtimeEvaluatorSha256") != EXPECTED_RUNTIME_EVALUATOR_SHA256
        or bundle.get("staticEvaluatorSha256") != EXPECTED_STATIC_EVALUATOR_SHA256
    ):
        raise WorkerFailure("contract", "execution seal is not the exact stock one-trial G1 smoke")
    for key in (
        "manifestSha256",
        "candidateSha256",
        "runtimeSha256",
        "runtimeEvaluatorSha256",
        "staticEvaluatorSha256",
        "baselineSha256",
    ):
        expect_sha256(bundle.get(key), f"executionSeal.bundle.{key}")

    environment = expect_record(seal.get("environment"), "executionSeal.environment")
    expect_exact_keys(
        environment,
        {
            "source",
            "directory",
            "environmentSpecSha256",
            "environmentManifestSha256",
            "pipFreezeSha256",
            "environmentSealSha256",
            "executables",
            "python",
            "pip",
            "torch",
            "torchCuda",
            "numpy",
        },
        "executionSeal.environment",
    )
    if (
        environment.get("source") != "reused-kernelbench-compiled-environment"
        or environment.get("directory") != str(EXPECTED_ENVIRONMENT_DIR)
        or environment.get("environmentSpecSha256") != EXPECTED_ENVIRONMENT_SPEC_SHA256
        or environment.get("python") != EXPECTED_PYTHON
        or environment.get("pip") != EXPECTED_PIP
        or environment.get("torch") != EXPECTED_TORCH
        or environment.get("torchCuda") != EXPECTED_TORCH_CUDA
        or environment.get("numpy") != EXPECTED_NUMPY
        or environment.get("executables") != EXPECTED_ENVIRONMENT_EXECUTABLES
    ):
        raise WorkerFailure("environment", "execution seal does not name the reused exact environment")
    for key in ("environmentManifestSha256", "pipFreezeSha256", "environmentSealSha256"):
        expect_sha256(environment.get(key), f"executionSeal.environment.{key}")
    slurm = expect_record(seal.get("slurm"), "executionSeal.slurm")
    if slurm != {
        "partition": "gpu",
        "constraint": "GPU_SKU:L40S",
        "nodes": 1,
        "tasks": 1,
        "gpus": 1,
        "cpus": 8,
        "memory": "32G",
        "time": "00:30:00",
        "export": "NONE",
    }:
        raise WorkerFailure("launch", "SLURM seal is not the exact one-L40S allocation")
    return bundle, environment


def validate_environment(environment: dict[str, Any]) -> dict[str, Any]:
    if sys.flags.isolated != 1:
        raise WorkerFailure("environment", "worker Python must run in isolated mode")
    if Path(sys.prefix).resolve() != EXPECTED_ENVIRONMENT_DIR:
        raise WorkerFailure("environment", "worker is not running from the sealed environment")
    manifest_path = EXPECTED_ENVIRONMENT_DIR / "environment.json"
    freeze_path = EXPECTED_ENVIRONMENT_DIR / "pip-freeze.txt"
    seal_path = EXPECTED_ENVIRONMENT_DIR / "environment-seal.json"
    for path, label in (
        (manifest_path, "environment manifest"),
        (freeze_path, "pip freeze"),
        (seal_path, "environment seal"),
    ):
        regular_file(path, label)
    observed_hashes = {
        "environmentManifestSha256": sha256_file(manifest_path),
        "pipFreezeSha256": sha256_file(freeze_path),
        "environmentSealSha256": sha256_file(seal_path),
    }
    if observed_hashes != {
        "environmentManifestSha256": EXPECTED_ENVIRONMENT_MANIFEST_SHA256,
        "pipFreezeSha256": EXPECTED_PIP_FREEZE_SHA256,
        "environmentSealSha256": EXPECTED_ENVIRONMENT_SEAL_SHA256,
    }:
        raise WorkerFailure("environment", "pinned environment evidence hashes changed")
    for key, observed in observed_hashes.items():
        if environment.get(key) != observed:
            raise WorkerFailure("environment", f"{key} does not match the execution seal")

    manifest = read_json_object(manifest_path, "environment manifest")
    expect_exact_keys(
        manifest,
        {
            "schemaVersion",
            "environmentSpecSha256",
            "kernelBenchVerifiedCommit",
            "numpy",
            "pip",
            "python",
            "torch",
            "torchCuda",
        },
        "environment manifest",
    )
    import torch

    actual = {
        "python": platform.python_version(),
        "pip": importlib.metadata.version("pip"),
        "torch": torch.__version__,
        "torchCuda": torch.version.cuda,
        "numpy": importlib.metadata.version("numpy"),
    }
    if manifest != {
        "schemaVersion": 1,
        "environmentSpecSha256": EXPECTED_ENVIRONMENT_SPEC_SHA256,
        "kernelBenchVerifiedCommit": EXPECTED_KERNELBENCH_COMMIT,
        **actual,
    }:
        raise WorkerFailure("environment", "environment manifest or live versions changed")
    if actual != {
        "python": EXPECTED_PYTHON,
        "pip": EXPECTED_PIP,
        "torch": EXPECTED_TORCH,
        "torchCuda": EXPECTED_TORCH_CUDA,
        "numpy": EXPECTED_NUMPY,
    }:
        raise WorkerFailure("environment", "live runtime does not match the exact version seal")

    freeze_lines = set(freeze_path.read_text(encoding="utf-8").splitlines())
    if (
        f"pip=={EXPECTED_PIP}" not in freeze_lines
        or f"numpy=={EXPECTED_NUMPY}" not in freeze_lines
        or f"torch=={EXPECTED_TORCH}" not in freeze_lines
    ):
        raise WorkerFailure("environment", "pip freeze is missing an exact required package")
    seal = read_json_object(seal_path, "environment seal")
    if seal != {
        "schemaVersion": 1,
        "environmentSpecSha256": EXPECTED_ENVIRONMENT_SPEC_SHA256,
        "environmentManifestSha256": observed_hashes["environmentManifestSha256"],
        "pipFreezeSha256": observed_hashes["pipFreezeSha256"],
    }:
        raise WorkerFailure("environment", "environment seal does not bind the exact evidence")

    python_launcher = EXPECTED_ENVIRONMENT_DIR / "bin/python"
    python3_launcher = EXPECTED_ENVIRONMENT_DIR / "bin/python3"
    torchrun = EXPECTED_ENVIRONMENT_DIR / "bin/torchrun"
    if (
        not python_launcher.is_symlink()
        or os.readlink(python_launcher) != "python3"
        or not python3_launcher.is_symlink()
        or os.readlink(python3_launcher) != "/usr/bin/python3"
    ):
        raise WorkerFailure("environment", "sealed Python launcher chain changed")
    python_resolved = python_launcher.resolve(strict=True)
    regular_file(python_resolved, "resolved Python executable")
    regular_file(torchrun, "torchrun executable")
    executables = {
        "python": {
            "path": str(python_launcher),
            "linkTarget": os.readlink(python_launcher),
            "python3LinkTarget": os.readlink(python3_launcher),
            "resolvedPath": str(python_resolved),
            "sha256": sha256_file(python_resolved),
            "size": python_resolved.stat().st_size,
        },
        "torchrun": {
            "path": str(torchrun),
            "sha256": sha256_file(torchrun),
            "size": torchrun.stat().st_size,
            "mode": stat.S_IMODE(torchrun.lstat().st_mode),
        },
    }
    if executables != EXPECTED_ENVIRONMENT_EXECUTABLES or environment.get("executables") != executables:
        raise WorkerFailure("environment", "sealed Python or torchrun executable bytes changed")

    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise WorkerFailure("hardware", "the sealed smoke requires exactly one visible CUDA device")
    properties = torch.cuda.get_device_properties(0)
    if (
        "l40s" not in properties.name.lower()
        or (properties.major, properties.minor) != (8, 9)
        or int(properties.total_memory) < 40_000_000_000
    ):
        raise WorkerFailure("hardware", "the sealed smoke requires one FarmShare L40S")
    return {
        **observed_hashes,
        **actual,
        "executables": executables,
        "gpu": properties.name,
        "gpuComputeCapability": f"{properties.major}.{properties.minor}",
        "gpuTotalMemoryBytes": int(properties.total_memory),
    }


def validate_dataset(job_root: Path, seal: dict[str, Any]) -> dict[str, Any]:
    dataset = expect_record(seal.get("dataset"), "executionSeal.dataset")
    expect_exact_keys(
        dataset,
        {"directory", "manifestSha256", "files", "headers", "consumption"},
        "executionSeal.dataset",
    )
    if dataset.get("manifestSha256") != EXPECTED_DATASET_MANIFEST_SHA256:
        raise WorkerFailure("dataset", "dataset manifest is not the exact two-file smoke manifest")
    dataset_dir = Path(expect_string(dataset.get("directory"), "executionSeal.dataset.directory"))
    expected_dataset_dir = (
        job_root.parents[1]
        / "data"
        / EXPECTED_DATASET_MANIFEST_SHA256
        / "fineweb10B"
    )
    if dataset_dir != expected_dataset_dir or dataset_dir.is_symlink() or not dataset_dir.is_dir():
        raise WorkerFailure("dataset", "dataset directory is not the sealed content-addressed path")
    if dataset.get("files") != list(EXPECTED_DATASET_FILES):
        raise WorkerFailure("dataset", "dataset file set is not the exact two-file manifest")
    if (
        dataset.get("headers") != list(EXPECTED_DATASET_HEADERS)
        or dataset.get("consumption") != EXPECTED_DATASET_CONSUMPTION
    ):
        raise WorkerFailure("dataset", "dataset header or ten-step consumption seal changed")

    local_manifest = job_root / "dataset-manifest.json"
    remote_manifest = dataset_dir / "dataset-manifest.json"
    ready = dataset_dir / "READY"
    for path, label in (
        (local_manifest, "job dataset manifest"),
        (remote_manifest, "remote dataset manifest"),
        (ready, "dataset READY marker"),
    ):
        regular_file(path, label)
    local_bytes = local_manifest.read_bytes()
    if (
        sha256_bytes(local_bytes) != EXPECTED_DATASET_MANIFEST_SHA256
        or remote_manifest.read_bytes() != local_bytes
        or ready.read_text(encoding="utf-8").strip() != EXPECTED_DATASET_MANIFEST_SHA256
    ):
        raise WorkerFailure("dataset", "dataset manifest bytes or READY marker changed")
    manifest = expect_record(json.loads(local_bytes), "dataset manifest")
    if manifest.get("files") != list(EXPECTED_DATASET_FILES):
        raise WorkerFailure("dataset", "dataset manifest records changed")
    headers: list[dict[str, Any]] = []
    for item, expected_header in zip(EXPECTED_DATASET_FILES, EXPECTED_DATASET_HEADERS):
        path = dataset_dir / str(item["path"])
        regular_file(path, f"dataset file {item['path']}")
        if path.stat().st_size != item["size"] or sha256_file(path) != item["sha256"]:
            raise WorkerFailure("dataset", f"dataset content changed: {item['path']}")
        with path.open("rb") as stream:
            prefix = stream.read(12)
        if len(prefix) != 12:
            raise WorkerFailure("dataset", f"dataset header is truncated: {item['path']}")
        magic, version, tokens = struct.unpack("<iii", prefix)
        observed_header = {
            "path": item["path"],
            "magic": magic,
            "version": version,
            "tokens": tokens,
        }
        if observed_header != expected_header:
            raise WorkerFailure("dataset", f"dataset header semantics changed: {item['path']}")
        headers.append(observed_header)
    return {
        "directory": str(dataset_dir),
        "manifestSha256": EXPECTED_DATASET_MANIFEST_SHA256,
        "files": list(EXPECTED_DATASET_FILES),
        "headers": headers,
        "consumption": EXPECTED_DATASET_CONSUMPTION,
    }


def validate_launch_environment(job_root: Path, seal: dict[str, Any]) -> dict[str, str]:
    launch = expect_record(seal.get("launch"), "executionSeal.launch")
    expect_exact_keys(
        launch,
        {
            "executable",
            "args",
            "worldSize",
            "gpus",
            "cwdPolicy",
            "environmentKeys",
            "forbiddenEnvironment",
        },
        "executionSeal.launch",
    )
    if (
        launch.get("executable") != str(EXPECTED_ENVIRONMENT_DIR / "bin" / "python")
        or launch.get("args") != list(FIXED_RUNTIME_PROCESS_ARGS)
        or launch.get("worldSize") != 1
        or launch.get("gpus") != 1
        or launch.get("cwdPolicy") != "fresh-job-directory"
        or launch.get("environmentKeys") != list(LAUNCH_ENVIRONMENT_KEYS)
        or launch.get("forbiddenEnvironment") != list(FORBIDDEN_ENVIRONMENT)
    ):
        raise WorkerFailure("launch", "launch seal is not the exact one-GPU G1 command")
    observed_keys = set(os.environ)
    if observed_keys != set(LAUNCH_ENVIRONMENT_KEYS):
        raise WorkerFailure(
            "launch",
            f"worker environment is not the explicit allowlist: {sorted(observed_keys)}",
        )
    if any(name in os.environ for name in FORBIDDEN_ENVIRONMENT):
        raise WorkerFailure("launch", "forbidden W&B environment reached the worker")
    expected_values = {
        "HOME": str(job_root / "home"),
        "LC_ALL": "C.UTF-8",
        "TMPDIR": str(job_root / "tmp"),
        "TORCHINDUCTOR_CACHE_DIR": str(job_root / "torchinductor-cache"),
        "PATH": f"{EXPECTED_ENVIRONMENT_DIR / 'bin'}:/usr/bin:/bin",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "PYTHON_EXEC": str(job_root / "isolated-python"),
        "CUDA_DEVICE_ORDER": "PCI_BUS_ID",
    }
    for key, expected in expected_values.items():
        if os.environ.get(key) != expected:
            raise WorkerFailure("launch", f"unexpected launch environment value for {key}")
    cuda_visible = os.environ.get("CUDA_VISIBLE_DEVICES", "")
    slurm_job_id = os.environ.get("SLURM_JOB_ID", "")
    if not cuda_visible or "," in cuda_visible or not slurm_job_id.isdigit():
        raise WorkerFailure("launch", "SLURM did not provide one GPU and a numeric job identity")
    wrapper = job_root / "isolated-python"
    immutable_file_evidence(
        job_root,
        "isolated-python",
        EXPECTED_ISOLATED_PYTHON_SHA256,
        0o500,
    )
    probe = subprocess.run(
        [
            str(wrapper),
            "-c",
            "import sys; raise SystemExit(0 if sys.flags.isolated == 1 else 1)",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=dict(os.environ),
        timeout=30,
    )
    if probe.returncode != 0:
        raise WorkerFailure(
            "launch",
            f"isolated Python wrapper probe failed: {probe.stderr}",
        )
    return {key: os.environ[key] for key in LAUNCH_ENVIRONMENT_KEYS}


def immutable_file_evidence(
    root: Path,
    relative: str,
    expected_sha256: str,
    expected_mode: int,
) -> dict[str, Any]:
    path = root / relative
    regular_file(path, relative)
    observed_mode = stat.S_IMODE(path.lstat().st_mode)
    observed_sha256 = sha256_file(path)
    observed_stat = path.stat()
    if (
        observed_mode != expected_mode
        or observed_sha256 != expected_sha256
        or observed_stat.st_uid != os.getuid()
        or observed_stat.st_nlink != 1
    ):
        raise WorkerFailure(
            "asset",
            f"immutable asset changed: {relative} "
            f"mode={oct(observed_mode)} sha256={observed_sha256}",
        )
    return {
        "path": relative,
        "size": path.stat().st_size,
        "sha256": observed_sha256,
        "mode": observed_mode,
    }


def snapshot_job_assets(
    job_root: Path,
    bundle: dict[str, Any],
    request: dict[str, Any],
    execution_seal: dict[str, Any],
    request_sha256: str,
) -> dict[str, Any]:
    assets = (
        ("bundle/candidate.source.py", bundle["candidateSha256"], 0o400),
        ("bundle/runtime-manifest.json", bundle["manifestSha256"], 0o400),
        ("bundle/train_gpt_runtime.py", bundle["runtimeSha256"], 0o400),
        ("dataset-manifest.json", EXPECTED_DATASET_MANIFEST_SHA256, 0o400),
        ("gate/evaluators/nanogpt_contract.py", bundle["staticEvaluatorSha256"], 0o400),
        ("gate/evaluators/nanogpt_runtime.py", bundle["runtimeEvaluatorSha256"], 0o400),
        ("gate/fixtures/nanogpt/train_gpt_simple.py", bundle["baselineSha256"], 0o400),
        ("isolated-python", EXPECTED_ISOLATED_PYTHON_SHA256, 0o500),
        ("job.sh", request["jobScriptSha256"], 0o500),
        ("request.json", request_sha256, 0o400),
        ("worker.py", execution_seal["workerSha256"], 0o500),
    )
    files = [
        immutable_file_evidence(job_root, relative, expected, mode)
        for relative, expected, mode in assets
    ]
    return {"files": files, "sha256": canonical_sha256(files)}


def copy_regular_file(source: Path, destination: Path, expected_sha256: str) -> None:
    regular_file(source, str(source))
    source_stat = source.stat()
    if source_stat.st_nlink != 1:
        raise WorkerFailure("asset", f"source must have exactly one hard link: {source}")
    completed = subprocess.run(
        ["cp", "--reflink=auto", "--", str(source), str(destination)],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        if destination.exists():
            destination.unlink()
        shutil.copyfile(source, destination)
    regular_file(destination, str(destination))
    os.chmod(destination, 0o444)
    destination_stat = destination.stat()
    if destination_stat.st_nlink != 1 or (destination_stat.st_dev, destination_stat.st_ino) == (
        source_stat.st_dev,
        source_stat.st_ino,
    ):
        raise WorkerFailure("asset", f"staged input is not an independent regular file: {destination}")
    if sha256_file(destination) != expected_sha256 or sha256_file(source) != expected_sha256:
        raise WorkerFailure("dataset", f"staged regular file hash mismatch: {source.name}")


def stage_fresh_run(job_root: Path, dataset_dir: Path) -> Path:
    run_dir = job_root / "run"
    run_dir.mkdir(mode=0o700, exist_ok=False)
    bundle_hashes = {
        "candidate.source.py": EXPECTED_BASELINE_SHA256,
        "train_gpt_runtime.py": sha256_file(job_root / "bundle/train_gpt_runtime.py"),
        "runtime-manifest.json": sha256_file(job_root / "bundle/runtime-manifest.json"),
    }
    for name, expected_sha256 in bundle_hashes.items():
        source = job_root / "bundle" / name
        destination = run_dir / name
        copy_regular_file(source, destination, expected_sha256)
    data_root = run_dir / "data/fineweb10B"
    data_root.mkdir(mode=0o700, parents=True)
    for item in EXPECTED_DATASET_FILES:
        copy_regular_file(dataset_dir / str(item["path"]), data_root / str(item["path"]), str(item["sha256"]))
    copy_regular_file(
        dataset_dir / "dataset-manifest.json",
        data_root / "dataset-manifest.json",
        EXPECTED_DATASET_MANIFEST_SHA256,
    )
    (data_root / "READY").write_text(EXPECTED_DATASET_MANIFEST_SHA256 + "\n", encoding="utf-8")
    os.chmod(data_root / "READY", 0o444)
    return run_dir


def snapshot_staged_inputs(run_dir: Path) -> dict[str, Any]:
    ready_sha256 = sha256_bytes(
        (EXPECTED_DATASET_MANIFEST_SHA256 + "\n").encode("utf-8")
    )
    assets: list[tuple[str, str, int]] = [
        ("candidate.source.py", EXPECTED_BASELINE_SHA256, 0o444),
        ("runtime-manifest.json", EXPECTED_MANIFEST_SHA256, 0o444),
        ("train_gpt_runtime.py", EXPECTED_RUNTIME_SHA256, 0o444),
        (
            "data/fineweb10B/dataset-manifest.json",
            EXPECTED_DATASET_MANIFEST_SHA256,
            0o444,
        ),
        ("data/fineweb10B/READY", ready_sha256, 0o444),
    ]
    assets.extend(
        (
            f"data/fineweb10B/{item['path']}",
            str(item["sha256"]),
            0o444,
        )
        for item in EXPECTED_DATASET_FILES
    )
    files = [
        immutable_file_evidence(run_dir, relative, expected, mode)
        for relative, expected, mode in assets
    ]
    return {"files": files, "sha256": canonical_sha256(files)}


def integrity_snapshot(
    job_root: Path,
    run_dir: Path,
    bundle: dict[str, Any],
    environment: dict[str, Any],
    request: dict[str, Any],
    execution_seal: dict[str, Any],
    request_sha256: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, str]]:
    launch_environment = validate_launch_environment(job_root, execution_seal)
    environment_evidence = validate_environment(environment)
    dataset_evidence = validate_dataset(job_root, execution_seal)
    snapshot = {
        "jobAssets": snapshot_job_assets(job_root, bundle, request, execution_seal, request_sha256),
        "stagedInputs": snapshot_staged_inputs(run_dir),
        "environment": environment_evidence,
        "dataset": dataset_evidence,
        "launchEnvironment": launch_environment,
    }
    return snapshot, environment_evidence, dataset_evidence, launch_environment


def run_gate(
    evaluator: Path,
    args: Sequence[str],
    environment: dict[str, str],
) -> tuple[int, dict[str, Any], str]:
    driver = (
        "import runpy,sys; evaluator=sys.argv[1]; evaluator_dir=sys.argv[2]; "
        "sys.path.insert(0,evaluator_dir); sys.argv=[evaluator,*sys.argv[3:]]; "
        "runpy.run_path(evaluator,run_name='__main__')"
    )
    completed = subprocess.run(
        [sys.executable, "-I", "-c", driver, str(evaluator), str(evaluator.parent), *args],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
        timeout=120,
    )
    try:
        value = expect_record(json.loads(completed.stdout), "G1 result")
    except (json.JSONDecodeError, WorkerFailure) as error:
        raise WorkerFailure(
            "gate",
            f"G1 returned invalid JSON (exit {completed.returncode}): {error}; stderr={completed.stderr}",
        ) from error
    if bool(completed.returncode == 0) != bool(value.get("ok")):
        raise WorkerFailure("gate", "G1 exit status disagrees with its JSON result")
    return completed.returncode, value, completed.stderr


def validate_g1_verify(value: dict[str, Any], bundle: dict[str, Any]) -> None:
    if (
        value.get("schemaVersion") != 1
        or value.get("contract") != RUNTIME_CONTRACT
        or value.get("operation") != "verify"
        or value.get("ok") is not True
        or value.get("errors") != []
    ):
        raise WorkerFailure("gate", "G1 did not verify the staged runtime bundle")
    manifest = expect_record(value.get("manifest"), "G1 verified manifest")
    candidate = expect_record(manifest.get("candidate"), "G1 candidate descriptor")
    runtime = expect_record(manifest.get("runtime"), "G1 runtime descriptor")
    evaluators = expect_record(manifest.get("evaluators"), "G1 evaluator descriptor")
    acceptance = expect_record(manifest.get("acceptance"), "G1 acceptance descriptor")
    if (
        value.get("manifestSha256") != bundle["manifestSha256"]
        or manifest.get("mode") != "cuda-smoke-10"
        or manifest.get("expectedTrials") != 1
        or manifest.get("effectiveTrainSteps") != 10
        or manifest.get("expectedSeeds") != [0xC0FFEE]
        or manifest.get("claimScope") != RUNTIME_CLAIM_SCOPE
        or candidate.get("sha256") != bundle["candidateSha256"]
        or runtime.get("sha256") != bundle["runtimeSha256"]
        or evaluators.get("runtimeSha256") != bundle["runtimeEvaluatorSha256"]
        or evaluators.get("staticSha256") != bundle["staticEvaluatorSha256"]
        or acceptance
        != {
            "candidatePolicy": "byte-exact-pinned-stock-fixture-only",
            "requiredMode": "cuda-smoke-10",
            "requiredTrials": 1,
            "requiredSeed": 0xC0FFEE,
            "requiredDeclaredTrainSteps": 3290,
            "requiredEffectiveTrainSteps": 10,
            "scoredEligible": False,
            "recordEligible": False,
            "partialCurvesAccepted": False,
        }
    ):
        raise WorkerFailure("gate", "G1 verified manifest does not match the execution seal")


def validate_g1_extract(value: dict[str, Any], bundle: dict[str, Any]) -> dict[str, Any]:
    if (
        value.get("schemaVersion") != 1
        or value.get("contract") != RUNTIME_CONTRACT
        or value.get("operation") != "extract"
        or value.get("ok") is not True
        or value.get("errors") != []
    ):
        raise WorkerFailure("gate", "G1 did not accept the complete runtime log")
    metrics = expect_record(value.get("metrics"), "G1 metrics")
    runtime_environment = expect_record(metrics.get("environment"), "G1 metrics environment")
    if (
        metrics.get("mode") != "cuda-smoke-10"
        or metrics.get("candidateSha256") != bundle["candidateSha256"]
        or metrics.get("runtimeSha256") != bundle["runtimeSha256"]
        or metrics.get("effectiveTrainSteps") != 10
        or metrics.get("trials") != 1
        or metrics.get("seeds") != [0xC0FFEE]
        or metrics.get("optimizerSteps") != [10]
        or metrics.get("backwardCalls") != [80]
        or metrics.get("recordEligible") is not False
        or metrics.get("recordPassed") is not None
        or metrics.get("claimScope") != RUNTIME_CLAIM_SCOPE
        or metrics.get("scoredEligible") is not False
        or runtime_environment.get("pytorch") != EXPECTED_TORCH
        or runtime_environment.get("cuda") != EXPECTED_TORCH_CUDA
        or "l40s" not in str(runtime_environment.get("gpu", "")).lower()
        or runtime_environment.get("worldSize") != 1
    ):
        raise WorkerFailure("gate", "G1 metrics do not prove the exact stock infrastructure smoke")
    return metrics


def durable_create_json(path: Path, value: dict[str, Any]) -> None:
    content = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    temporary = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o400)
        os.link(temporary, path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def execute(job_root: Path, request_path: Path, output_path: Path) -> tuple[dict[str, Any], int]:
    started_at = utc_now()
    request_sha256 = ""
    job_key = job_root.name
    slurm_job_id = os.environ.get("SLURM_JOB_ID", "")
    execution_seal: dict[str, Any] = {}
    environment_evidence: dict[str, Any] = {}
    dataset_evidence: dict[str, Any] = {}
    launch_environment: dict[str, str] = {}
    gate_verification: Optional[dict[str, Any]] = None
    gate_extraction: Optional[dict[str, Any]] = None
    runtime_exit_code: Optional[int] = None
    integrity_evidence: dict[str, Any] = {
        "preRun": None,
        "preRunSha256": None,
        "postRun": None,
        "postRunSha256": None,
        "stable": False,
    }
    failure: Optional[dict[str, str]] = None
    ok = False
    try:
        regular_file(request_path, "request")
        request_sha256 = sha256_file(request_path)
        request, execution_seal = validate_request(request_path, job_root)
        job_key = expect_sha256(request.get("jobKey"), "request.jobKey")
        bundle, environment = validate_execution_seal(job_root, execution_seal)
        validate_launch_environment(job_root, execution_seal)
        validate_environment(environment)
        dataset_evidence = validate_dataset(job_root, execution_seal)
        snapshot_job_assets(job_root, bundle, request, execution_seal, request_sha256)
        run_dir = stage_fresh_run(job_root, Path(dataset_evidence["directory"]))
        (
            pre_run,
            environment_evidence,
            dataset_evidence,
            launch_environment,
        ) = integrity_snapshot(
            job_root,
            run_dir,
            bundle,
            environment,
            request,
            execution_seal,
            request_sha256,
        )
        integrity_evidence["preRun"] = pre_run
        integrity_evidence["preRunSha256"] = canonical_sha256(pre_run)

        evaluator = job_root / "gate/evaluators/nanogpt_runtime.py"
        verify_code, gate_verification, verify_stderr = run_gate(
            evaluator,
            ["verify", "--bundle", str(run_dir)],
            launch_environment,
        )
        if verify_code != 0:
            raise WorkerFailure("gate", f"G1 bundle verification failed: {verify_stderr}")
        validate_g1_verify(gate_verification, bundle)

        stdout_path = job_root / "torchrun.stdout.log"
        stderr_path = job_root / "torchrun.stderr.log"
        with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            completed = subprocess.run(
                [sys.executable, *FIXED_RUNTIME_PROCESS_ARGS],
                cwd=run_dir,
                env=launch_environment,
                check=False,
                stdout=stdout,
                stderr=stderr,
                timeout=1200,
            )
            stdout.flush()
            stderr.flush()
            os.fsync(stdout.fileno())
            os.fsync(stderr.fileno())
        os.chmod(stdout_path, 0o400)
        os.chmod(stderr_path, 0o400)
        runtime_exit_code = completed.returncode

        extract_code, gate_extraction, extract_stderr = run_gate(
            evaluator,
            [
                "extract",
                "--bundle",
                str(run_dir),
                "--log",
                str(run_dir / "logs/nanogpt-runtime.log"),
                "--exit-code",
                str(runtime_exit_code),
            ],
            launch_environment,
        )
        if extract_code != 0:
            raise WorkerFailure("gate", f"G1 metric extraction failed: {extract_stderr}")
        validate_g1_extract(gate_extraction, bundle)
        if runtime_exit_code != 0:
            raise WorkerFailure("runtime", f"torchrun exited with status {runtime_exit_code}")

        (
            post_run,
            post_environment_evidence,
            post_dataset_evidence,
            post_launch_environment,
        ) = integrity_snapshot(
            job_root,
            run_dir,
            bundle,
            environment,
            request,
            execution_seal,
            request_sha256,
        )
        integrity_evidence["postRun"] = post_run
        integrity_evidence["postRunSha256"] = canonical_sha256(post_run)
        integrity_evidence["stable"] = pre_run == post_run
        if not integrity_evidence["stable"]:
            raise WorkerFailure("integrity", "sealed inputs changed between pre-run and post-run checks")
        environment_evidence = post_environment_evidence
        dataset_evidence = post_dataset_evidence
        launch_environment = post_launch_environment
        ok = True
    except Exception as error:
        kind = error.kind if isinstance(error, WorkerFailure) else "worker"
        failure = {"kind": kind, "message": str(error)}
        traceback.print_exc(file=sys.stderr)

    result = {
        "schemaVersion": SCHEMA_VERSION,
        "contract": CONTRACT,
        "evidenceClass": EVIDENCE_CLASS,
        "ok": ok,
        "jobKey": job_key,
        "requestSha256": request_sha256,
        "workerSha256": sha256_file(Path(__file__).resolve()),
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "slurmJobId": slurm_job_id,
        "executionSeal": execution_seal,
        "environmentEvidence": environment_evidence,
        "datasetEvidence": dataset_evidence,
        "launchEnvironmentKeys": sorted(launch_environment),
        "runtimeExitCode": runtime_exit_code,
        "gateVerification": gate_verification,
        "gateExtraction": gate_extraction,
        "integrityEvidence": integrity_evidence,
        "failure": failure,
    }
    durable_create_json(output_path, result)
    print(json.dumps({"ok": ok, "output": str(output_path), "jobKey": job_key}, sort_keys=True))
    return result, 0 if ok else 1


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-root", type=Path, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    job_root = args.job_root
    request_path = args.request
    output_path = args.output
    if not job_root.is_absolute() or job_root != Path(os.path.normpath(str(job_root))):
        raise SystemExit("job root must be an absolute normalized path")
    if request_path != job_root / "request.json" or output_path != job_root / "result.json":
        raise SystemExit("request and output must be direct children of the job root")
    if output_path.exists():
        raise SystemExit("refusing to overwrite an existing durable result")
    _, exit_code = execute(job_root, request_path, output_path)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

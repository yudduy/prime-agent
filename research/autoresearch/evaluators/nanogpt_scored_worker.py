#!/usr/bin/env python3
"""Execute a pinned NanoGPT scored stage on one FarmShare L40S.

The host owns promotion and threshold decisions. This worker only validates a
content-addressed request, applies the admitted patch with nanogpt_contract.py,
and emits fresh sequential measurements for the request's fixed seed prefix.
"""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import runpy
import shutil
import shlex
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import traceback
from typing import Any, Optional, Sequence


SCHEMA_VERSION = 1
CONTRACT = "nanogpt-track3-scored-confirmatory-v1"
CAMPAIGN_AMENDMENT_SHA256 = (
    "0aece581a2cc9e49672f598129a9f298353114368962a4fca0e09b0f7e9751ab"
)
STATIC_CONTRACT = "nanogpt-track3-static-contract-v1"
PINNED_REPOSITORY = "https://github.com/PrimeIntellect-ai/frontier-automated-speedrun"
PINNED_COMMIT = "38e258afefb1ce206dd7595aa71d7740da405742"
PINNED_PROGRAM_SHA256 = (
    "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08"
)
PINNED_BASELINE_SHA256 = (
    "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e"
)
BASELINE_TRAIN_STEPS = 3290
MEAN_LOSS_EXCLUSIVE_UPPER_BOUND = 3.27859
HANDLE_PREFIX = "nanogpt-scored-v1:"
TRIAL_SEEDS = tuple(0xC0FFEE + index for index in range(8))
MAX_SAFE_INTEGER = 2**53 - 1
MAX_SOURCE_BYTES = 256 * 1024
MAX_PATCH_BYTES = 128 * 1024

MODE_SPEC = {
    "smoke-10": {"trials": 1, "previous": None, "stage": "smoke-10"},
    "score-1": {"trials": 1, "previous": "smoke-10", "stage": "score"},
    "score-3": {"trials": 3, "previous": "score-1", "stage": "score"},
    "replay-8": {"trials": 8, "previous": "score-3", "stage": "replay-8"},
}

EXPECTED_DATASET_KEYS = {
    "schemaVersion",
    "dataset",
    "revision",
    "purpose",
    "globalBatchTokensWorldSizeOne",
    "usableStepsPerTrainShard",
    "totalUsableTrainSteps",
    "files",
}
EXPECTED_DATASET_FILE_KEYS = {"path", "size", "sha256", "magic", "version", "tokens"}
EXPECTED_DATASET_PATHS = (
    "fineweb_val_000000.bin",
    *(f"fineweb_train_{index:06d}.bin" for index in range(1, 19)),
)
EXPECTED_DATASET = "kjj0/fineweb10B-gpt2"
EXPECTED_DATASET_REVISION = "889765ea1f903759787add96995d81171b632d0c"
EXPECTED_DATASET_PURPOSE = "nanogpt-track3-scored-v1-minimal-3290"
GLOBAL_BATCH_TOKENS = 524288
USABLE_STEPS_PER_TRAIN_SHARD = 190
TOTAL_USABLE_TRAIN_STEPS = 3420
VALIDATION_TOKENS = 20 * 524288

EXPECTED_ENVIRONMENT_KEYS = {
    "schemaVersion",
    "environmentSpecSha256",
    "kernelBenchVerifiedCommit",
    "numpy",
    "pip",
    "python",
    "torch",
    "torchCuda",
}
LIVE_ENVIRONMENT_KEYS = {"python", "pip", "torch", "torchCuda", "numpy"}
FORBIDDEN_ENVIRONMENT = ("WANDB_API_KEY", "WANDB_MODE", "WANDB_ENTITY")
EXPECTED_ENVIRONMENT_SPEC_SHA256 = (
    "3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b"
)
EXPECTED_ENVIRONMENT_MANIFEST_SHA256 = (
    "71ddfe105be64b7122d7b6d143ea1a6c26a5b9de30cc414a9cbd9df7cd314de8"
)
EXPECTED_ENVIRONMENT_SEAL_SHA256 = (
    "c3016d0d77837dad553847c6db0ae96cd1cd4fdce5ba2144306550a8f7b9d576"
)
EXPECTED_PIP_FREEZE_SHA256 = (
    "b85ceb87080994284c997e0ea3742246df1a12d4fc2551a9d8412d87160766d9"
)
EXPECTED_KERNELBENCH_COMMIT = "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e"
EXPECTED_ENVIRONMENT_DIR = Path(
    "/scratch/users/duynguy/prime-autoresearch/kernelbench-compiled/envs/"
    + EXPECTED_ENVIRONMENT_SPEC_SHA256
)
EXPECTED_ENVIRONMENT_EXECUTABLES = {
    "python": {
        "path": str(EXPECTED_ENVIRONMENT_DIR / "bin/python"),
        "linkTarget": "python3",
        "python3LinkTarget": "/usr/bin/python3",
        "resolvedPath": "/usr/bin/python3.12",
        "sha256": "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118",
        "size": 8_020_928,
    },
    "torchrun": {
        "path": str(EXPECTED_ENVIRONMENT_DIR / "bin/torchrun"),
        "sha256": "7ff57f7f5ee11cc74839fda7b12e2a97fd2808dd00ae1eafd05f302df5def748",
        "size": 367,
        "mode": 0o555,
    },
}
REPORTABLE_FAILURE_KINDS = frozenset({"oom", "runtime", "timeout"})

RUNTIME_CONTRACT = "nanogpt-track3-scored-runtime-v1"
RUNTIME_PROGRAM_NAME = "train_gpt_scored.py"
RUNTIME_CANDIDATE_NAME = "candidate.source.py"
RUNTIME_LOG_NAME = "nanogpt-scored.log"
RUNTIME_RESERVED_PREFIX = "_prime_nanogpt_scored_"
RUNTIME_MARKER_PREFIX = "PRIME_NANOGPT_SCORED_"
LOGFILE_ANCHOR = '    logfile = f"logs/{uuid.uuid4()}.txt"\n'
SEED_ANCHOR = "    seed = 0xC0FFEE + trial_idx\n"
BACKWARD_ANCHOR = (
    "            model(inputs[i*mbs:(i+1)*mbs], targets[i*mbs:(i+1)*mbs]).backward()\n"
)
OPTIMIZER_STEP_ANCHOR = "        for opt in optimizers:\n            opt.step()\n"
TRIAL_RESULT_ANCHOR = "\n    if wandb_run is not None:\n"
COMPLETE_ANCHOR = "\ndist.destroy_process_group()\n"
ENVIRONMENT_LINE = re.compile(
    r"^Running PyTorch (?P<pytorch>\S+) compiled for CUDA (?P<cuda>\S+) "
    r"on (?P<gpu>.+) with world_size (?P<world_size>\d+)$"
)
FINAL_VALIDATION_LINE = re.compile(
    r"^step:(?P<step>\d+)/(?P<total>\d+) val_loss:(?P<loss>\d+(?:\.\d+)?) "
    r"train_time:(?P<train_time>\d+(?:\.\d+)?)s(?:\s|$)"
)
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


class WorkerFailure(RuntimeError):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def utc_now() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: object) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def canonical_sha256(value: object) -> str:
    return sha256_text(canonical_json(value))


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number {value} is forbidden")


def _object_without_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _validate_unicode_scalars(value: object, label: str) -> None:
    if isinstance(value, str):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            raise WorkerFailure(
                "contract", f"{label} contains an unpaired Unicode surrogate"
            )
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_unicode_scalars(item, f"{label}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            _validate_unicode_scalars(key, f"{label} key")
            _validate_unicode_scalars(item, f"{label}.{key}")


def parse_json_bytes(value: bytes, label: str) -> object:
    try:
        source = value.decode("utf-8")
        parsed = json.loads(
            source,
            parse_constant=_reject_constant,
            object_pairs_hook=_object_without_duplicates,
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise WorkerFailure("contract", f"cannot parse {label}: {error}") from error
    _validate_unicode_scalars(parsed, label)
    return parsed


def regular_file(path: Path, label: str, *, single_link: bool = True) -> os.stat_result:
    try:
        observed = path.lstat()
    except OSError as error:
        raise WorkerFailure("asset", f"cannot inspect {label}: {error}") from error
    if not stat.S_ISREG(observed.st_mode) or path.is_symlink():
        raise WorkerFailure("asset", f"{label} must be a regular non-symlink file")
    if single_link and observed.st_nlink != 1:
        raise WorkerFailure("asset", f"{label} must have exactly one hard link")
    return observed


def read_file_bytes(
    path: Path, label: str, maximum_bytes: Optional[int] = None
) -> bytes:
    regular_file(path, label)
    try:
        value = path.read_bytes()
    except OSError as error:
        raise WorkerFailure("asset", f"cannot read {label}: {error}") from error
    if maximum_bytes is not None and len(value) > maximum_bytes:
        raise WorkerFailure(
            "asset", f"{label} is {len(value)} bytes; limit is {maximum_bytes}"
        )
    return value


def read_json_file(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    source = read_file_bytes(path, label)
    value = parse_json_bytes(source, label)
    return source, expect_record(value, label)


def expect_record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise WorkerFailure("contract", f"{label} must be an object")
    return value


def expect_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    observed = set(value)
    if observed != expected:
        raise WorkerFailure(
            "contract",
            f"{label} keys mismatch: missing={sorted(expected - observed)}, extra={sorted(observed - expected)}",
        )


def expect_string(value: object, label: str) -> str:
    if not isinstance(value, str) or len(value) == 0:
        raise WorkerFailure("contract", f"{label} must be a non-empty string")
    return value


def expect_sha256(value: object, label: str) -> str:
    digest = expect_string(value, label)
    if SHA256_PATTERN.fullmatch(digest) is None:
        raise WorkerFailure("contract", f"{label} must be a lowercase SHA-256")
    return digest


def expect_integer(value: object, label: str) -> int:
    if type(value) is not int or abs(value) > MAX_SAFE_INTEGER:
        raise WorkerFailure("contract", f"{label} must be a safe integer")
    return value


def expect_finite(value: object, label: str) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise WorkerFailure("contract", f"{label} must be a finite number")
    return float(value)


def mode_benchmark_ids(mode: str) -> list[str]:
    spec = MODE_SPEC.get(mode)
    if spec is None:
        raise WorkerFailure("contract", f"unsupported NanoGPT scored mode: {mode}")
    return [
        f"nanogpt/track3/{spec['stage']}/seed-{seed:x}"
        for seed in TRIAL_SEEDS[: int(spec["trials"])]
    ]


def verifier_epoch(pins: dict[str, Any]) -> str:
    return (
        "nanogpt-scored-v1-"
        + canonical_sha256(
            {
                "contract": CONTRACT,
                "campaignAmendmentSha256": CAMPAIGN_AMENDMENT_SHA256,
                "staticContract": STATIC_CONTRACT,
                "programSha256": PINNED_PROGRAM_SHA256,
                "speedrunCommit": PINNED_COMMIT,
                "pins": pins,
            }
        )[:24]
    )


def stage_identity(request: dict[str, Any]) -> str:
    evidence = expect_record(request.get("staticEvidence"), "request.staticEvidence")
    patch = expect_record(request.get("candidatePatch"), "request.candidatePatch")
    return canonical_sha256(
        {
            "contract": CONTRACT,
            "branchId": request.get("branchId"),
            "treatment": request.get("treatment"),
            "verifierEpoch": request.get("verifierEpoch"),
            "candidatePatchSha256": patch.get("digest"),
            "candidateSha256": evidence.get("candidateSha256"),
        }
    )


def verify_request_document(request: dict[str, Any]) -> None:
    _validate_unicode_scalars(request, "request")
    expect_exact_keys(
        request,
        {
            "schemaVersion",
            "contract",
            "verifierEpoch",
            "campaignAmendmentSha256",
            "stageIdentity",
            "mode",
            "jobId",
            "manifestDigest",
            "branchId",
            "treatment",
            "candidatePatch",
            "staticEvidence",
            "benchmarkIds",
            "trials",
            "seeds",
            "effectiveTrainSteps",
            "priorStage",
            "launch",
            "acceptance",
            "pins",
            "requestDigest",
        },
        "request",
    )
    if (
        type(request.get("schemaVersion")) is not int
        or request.get("schemaVersion") != SCHEMA_VERSION
    ):
        raise WorkerFailure("contract", "NanoGPT scored request schema version changed")
    if request.get("contract") != CONTRACT:
        raise WorkerFailure("contract", "NanoGPT scored request identity changed")
    request_digest = expect_sha256(
        request.get("requestDigest"), "request.requestDigest"
    )
    body = {key: value for key, value in request.items() if key != "requestDigest"}
    if canonical_sha256(body) != request_digest:
        raise WorkerFailure("contract", "NanoGPT scored request digest mismatch")

    pins = expect_record(request.get("pins"), "request.pins")
    expect_exact_keys(
        pins,
        {
            "staticEvaluatorSha256",
            "environmentSha256",
            "environmentSealSha256",
            "datasetManifestSha256",
            "workerSha256",
            "transportSha256",
        },
        "request.pins",
    )
    for key, value in pins.items():
        expect_sha256(value, f"request.pins.{key}")
    if (
        pins.get("environmentSha256") != EXPECTED_ENVIRONMENT_MANIFEST_SHA256
        or pins.get("environmentSealSha256") != EXPECTED_ENVIRONMENT_SEAL_SHA256
    ):
        raise WorkerFailure(
            "contract", "NanoGPT scored request environment evidence changed"
        )
    if request.get("verifierEpoch") != verifier_epoch(pins):
        raise WorkerFailure(
            "contract", "NanoGPT scored request verifier epoch mismatch"
        )
    if request.get("campaignAmendmentSha256") != CAMPAIGN_AMENDMENT_SHA256:
        raise WorkerFailure(
            "contract", "NanoGPT scored request campaign amendment mismatch"
        )

    for key in ("jobId", "branchId", "treatment"):
        expect_string(request.get(key), f"request.{key}")
    if not str(request["branchId"]).strip() or not str(request["treatment"]).strip():
        raise WorkerFailure(
            "contract", "NanoGPT scored stage identity requires branch and treatment"
        )
    expect_sha256(request.get("manifestDigest"), "request.manifestDigest")

    candidate_patch = expect_record(
        request.get("candidatePatch"), "request.candidatePatch"
    )
    expect_exact_keys(
        candidate_patch, {"digest", "byteLength", "mediaType"}, "request.candidatePatch"
    )
    expect_sha256(candidate_patch.get("digest"), "request.candidatePatch.digest")
    if (
        candidate_patch.get("mediaType") != "text/x-diff"
        or expect_integer(
            candidate_patch.get("byteLength"), "request.candidatePatch.byteLength"
        )
        < 1
    ):
        raise WorkerFailure(
            "contract", "NanoGPT scored request candidate artifact is invalid"
        )

    evidence = expect_record(request.get("staticEvidence"), "request.staticEvidence")
    expect_exact_keys(
        evidence,
        {
            "contract",
            "repositoryCommit",
            "programSha256",
            "evaluatorSha256",
            "baselineSha256",
            "patchSha256",
            "candidateSha256",
            "trainSteps",
            "frozenSegmentSha256",
            "editableSegmentSha256",
        },
        "request.staticEvidence",
    )
    train_steps = expect_integer(
        evidence.get("trainSteps"), "request.staticEvidence.trainSteps"
    )
    if (
        evidence.get("contract") != STATIC_CONTRACT
        or evidence.get("repositoryCommit") != PINNED_COMMIT
        or evidence.get("programSha256") != PINNED_PROGRAM_SHA256
        or evidence.get("baselineSha256") != PINNED_BASELINE_SHA256
        or evidence.get("patchSha256") != candidate_patch.get("digest")
        or evidence.get("evaluatorSha256") != pins.get("staticEvaluatorSha256")
        or not 1 <= train_steps <= BASELINE_TRAIN_STEPS
    ):
        raise WorkerFailure(
            "contract", "NanoGPT scored request static evidence is invalid"
        )
    for key in ("evaluatorSha256", "patchSha256", "candidateSha256"):
        expect_sha256(evidence.get(key), f"request.staticEvidence.{key}")
    frozen = evidence.get("frozenSegmentSha256")
    editable = evidence.get("editableSegmentSha256")
    if (
        not isinstance(frozen, list)
        or not isinstance(editable, list)
        or len(frozen) != 4
        or len(editable) != 3
    ):
        raise WorkerFailure(
            "contract", "NanoGPT scored request static segment evidence is incomplete"
        )
    for group_name, values in (
        ("frozenSegmentSha256", frozen),
        ("editableSegmentSha256", editable),
    ):
        for index, digest in enumerate(values):
            expect_sha256(digest, f"request.staticEvidence.{group_name}[{index}]")

    mode = expect_string(request.get("mode"), "request.mode")
    spec = MODE_SPEC.get(mode)
    if spec is None:
        raise WorkerFailure("contract", "NanoGPT scored request mode changed")
    expected_trials = int(spec["trials"])
    expected_seeds = list(TRIAL_SEEDS[:expected_trials])
    expected_effective_steps = 10 if mode == "smoke-10" else train_steps
    if (
        expect_integer(request.get("trials"), "request.trials") != expected_trials
        or request.get("seeds") != expected_seeds
        or request.get("benchmarkIds") != mode_benchmark_ids(mode)
        or expect_integer(
            request.get("effectiveTrainSteps"), "request.effectiveTrainSteps"
        )
        != expected_effective_steps
    ):
        raise WorkerFailure(
            "contract", "NanoGPT scored request mode, seed, or task contract changed"
        )

    previous = spec["previous"]
    prior = request.get("priorStage")
    if previous is None:
        if prior is not None:
            raise WorkerFailure(
                "contract", "NanoGPT smoke request must not have a prior stage"
            )
    else:
        prior_record = expect_record(prior, "request.priorStage")
        expect_exact_keys(
            prior_record,
            {"mode", "jobId", "requestDigest", "resultDigest", "receiptDigest"},
            "request.priorStage",
        )
        if prior_record.get("mode") != previous:
            raise WorkerFailure(
                "contract", "NanoGPT scored request prior-stage mode changed"
            )
        expect_string(prior_record.get("jobId"), "request.priorStage.jobId")
        for key in ("requestDigest", "resultDigest", "receiptDigest"):
            expect_sha256(prior_record.get(key), f"request.priorStage.{key}")

    launch = expect_record(request.get("launch"), "request.launch")
    expect_exact_keys(
        launch,
        {"cluster", "gpu", "gpus", "worldSize", "trialExecution", "jobDirectory"},
        "request.launch",
    )
    acceptance = expect_record(request.get("acceptance"), "request.acceptance")
    expect_exact_keys(
        acceptance,
        {
            "meanValidationLossExclusiveUpperBound",
            "partialTrialsAccepted",
            "recordTrialCount",
            "recordRequiresStrictlyFewerStepsThan",
        },
        "request.acceptance",
    )
    if (
        launch.get("cluster") != "Stanford FarmShare"
        or launch.get("gpu") != "NVIDIA L40S"
        or expect_integer(launch.get("gpus"), "request.launch.gpus") != 1
        or expect_integer(launch.get("worldSize"), "request.launch.worldSize") != 1
        or launch.get("trialExecution") != "sequential"
        or launch.get("jobDirectory") != "fresh-per-stage"
        or expect_finite(
            acceptance.get("meanValidationLossExclusiveUpperBound"),
            "request.acceptance.meanValidationLossExclusiveUpperBound",
        )
        != MEAN_LOSS_EXCLUSIVE_UPPER_BOUND
        or type(acceptance.get("partialTrialsAccepted")) is not bool
        or acceptance.get("partialTrialsAccepted") is not False
        or expect_integer(
            acceptance.get("recordTrialCount"), "request.acceptance.recordTrialCount"
        )
        != 8
        or expect_integer(
            acceptance.get("recordRequiresStrictlyFewerStepsThan"),
            "request.acceptance.recordRequiresStrictlyFewerStepsThan",
        )
        != BASELINE_TRAIN_STEPS
    ):
        raise WorkerFailure(
            "contract", "NanoGPT scored launch or acceptance policy changed"
        )
    if request.get("stageIdentity") != stage_identity(request):
        raise WorkerFailure(
            "contract", "NanoGPT scored request stage identity mismatch"
        )


def validate_request_file(path: Path) -> dict[str, Any]:
    _, request = read_json_file(path, "request")
    verify_request_document(request)
    return request


def _normalize_direct_child(path: Path, root: Path, name: str) -> None:
    if not path.is_absolute() or path != Path(os.path.normpath(str(path))):
        raise WorkerFailure("contract", f"{name} must be an absolute normalized path")
    if path.parent != root:
        raise WorkerFailure(
            "contract", f"{name} must be a direct child of the fresh stage root"
        )


def validate_request_identity_path(args: argparse.Namespace) -> Path:
    request_path = args.request
    root = request_path.parent
    if (
        not root.is_absolute()
        or root != root.resolve()
        or root.is_symlink()
        or not root.is_dir()
    ):
        raise WorkerFailure(
            "contract",
            "request parent must be an existing normalized non-symlink stage root",
        )
    _normalize_direct_child(request_path, root, "request")
    if request_path.name != "request.json":
        raise WorkerFailure("contract", "request must be named request.json")
    observed = regular_file(request_path, "request")
    if stat.S_IMODE(observed.st_mode) != 0o400 or observed.st_uid != os.getuid():
        raise WorkerFailure("asset", "request must be evaluator-owned mode 0400")
    if Path.cwd().resolve() != root:
        raise WorkerFailure("contract", "worker must start in the fresh stage root")
    return root


def validate_paths(args: argparse.Namespace, root: Path) -> None:
    expected_names = {
        "request": "request.json",
        "candidate_patch": "candidate.patch",
        "baseline": "train_gpt_simple.py",
        "static_evaluator": "nanogpt_contract.py",
        "environment_manifest": "environment.json",
        "environment_seal": "environment-seal.json",
        "dataset_manifest": "dataset-manifest.json",
        "output": "result.json",
    }
    for attribute, expected_name in expected_names.items():
        path = getattr(args, attribute)
        _normalize_direct_child(path, root, attribute.replace("_", " "))
        if path.name != expected_name:
            raise WorkerFailure(
                "contract",
                f"{attribute.replace('_', ' ')} must be named {expected_name}",
            )
        if attribute not in {"output"}:
            observed = regular_file(path, attribute.replace("_", " "))
            if (
                stat.S_IMODE(observed.st_mode) != 0o400
                or observed.st_uid != os.getuid()
            ):
                raise WorkerFailure(
                    "asset",
                    f"{attribute.replace('_', ' ')} must be evaluator-owned mode 0400",
                )
    if args.trial_log_dir != root / "trial-logs":
        raise WorkerFailure(
            "contract", "trial log directory must be the fresh stage trial-logs path"
        )
    if os.path.lexists(args.output):
        raise WorkerFailure("asset", "refusing to overwrite an existing durable result")
    if os.path.lexists(args.trial_log_dir):
        raise WorkerFailure(
            "asset", "trial log directory already exists; stage is not fresh"
        )


def load_static_contract(path: Path, expected_sha256: str) -> dict[str, Any]:
    source = read_file_bytes(path, "static evaluator", MAX_SOURCE_BYTES)
    if sha256_bytes(source) != expected_sha256:
        raise WorkerFailure("asset", "static evaluator hash does not match request pin")
    try:
        namespace = runpy.run_path(str(path))
    except Exception as error:
        raise WorkerFailure(
            "gate", f"cannot load pinned static evaluator: {error}"
        ) from error
    expected_constants = {
        "CONTRACT_ID": STATIC_CONTRACT,
        "PINNED_REPOSITORY": PINNED_REPOSITORY,
        "PINNED_COMMIT": PINNED_COMMIT,
        "PINNED_PROGRAM_SHA256": PINNED_PROGRAM_SHA256,
        "PINNED_BASELINE_SHA256": PINNED_BASELINE_SHA256,
        "BASELINE_TRAIN_STEPS": BASELINE_TRAIN_STEPS,
    }
    if any(namespace.get(key) != value for key, value in expected_constants.items()):
        raise WorkerFailure(
            "gate", "static evaluator constants do not match the scored contract"
        )
    for name in ("apply_unified_patch", "validate_candidate"):
        if not callable(namespace.get(name)):
            raise WorkerFailure("gate", f"static evaluator is missing {name}")
    return namespace


def apply_and_validate_candidate(
    static_contract: dict[str, Any],
    baseline: str,
    patch: str,
    patch_sha256: str,
) -> tuple[str, dict[str, Any]]:
    apply_patch = static_contract["apply_unified_patch"]
    validate_candidate = static_contract["validate_candidate"]
    try:
        candidate = apply_patch(baseline, patch)
        if len(candidate.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise ValueError(f"patched candidate exceeds {MAX_SOURCE_BYTES} bytes")
        validation = validate_candidate(
            baseline,
            candidate,
            allow_baseline_steps=True,
            patch_sha256=patch_sha256,
        )
    except Exception as error:
        raise WorkerFailure(
            "gate", f"candidate patch application failed: {error}"
        ) from error
    if not isinstance(validation, dict) or validation.get("ok") is not True:
        errors = validation.get("errors") if isinstance(validation, dict) else None
        raise WorkerFailure("gate", f"candidate failed the static contract: {errors}")
    return candidate, validation


def validate_static_evidence(
    validation: dict[str, Any], request: dict[str, Any]
) -> None:
    evidence = request["staticEvidence"]
    expected = {
        "contract": validation.get("contract"),
        "repositoryCommit": validation.get("commit"),
        "programSha256": validation.get("programSha256"),
        "evaluatorSha256": validation.get("evaluatorSha256"),
        "baselineSha256": validation.get("baselineSha256"),
        "patchSha256": validation.get("patchSha256"),
        "candidateSha256": validation.get("candidateSha256"),
        "trainSteps": validation.get("trainSteps"),
        "frozenSegmentSha256": validation.get("frozenSegmentSha256"),
        "editableSegmentSha256": validation.get("editableSegmentSha256"),
    }
    if expected != evidence:
        raise WorkerFailure(
            "gate", "rederived static evidence does not match the exact request"
        )


def validate_candidate_assets(
    args: argparse.Namespace,
    request: dict[str, Any],
) -> tuple[dict[str, Any], str, str, str]:
    pins = request["pins"]
    if sha256_file(Path(__file__).resolve()) != pins["workerSha256"]:
        raise WorkerFailure("asset", "worker source hash does not match request pin")
    static_contract = load_static_contract(
        args.static_evaluator, pins["staticEvaluatorSha256"]
    )
    baseline_bytes = read_file_bytes(
        args.baseline, "baseline fixture", MAX_SOURCE_BYTES
    )
    if sha256_bytes(baseline_bytes) != PINNED_BASELINE_SHA256:
        raise WorkerFailure(
            "asset", "baseline fixture does not match the pinned source"
        )
    patch_bytes = read_file_bytes(
        args.candidate_patch, "candidate patch", MAX_PATCH_BYTES
    )
    patch_artifact = request["candidatePatch"]
    if (
        len(patch_bytes) != patch_artifact["byteLength"]
        or sha256_bytes(patch_bytes) != patch_artifact["digest"]
    ):
        raise WorkerFailure(
            "asset", "candidate patch bytes do not match request artifact"
        )
    try:
        baseline = baseline_bytes.decode("utf-8")
        patch = patch_bytes.decode("utf-8")
    except UnicodeError as error:
        raise WorkerFailure(
            "asset", f"candidate inputs must be UTF-8: {error}"
        ) from error
    candidate, validation = apply_and_validate_candidate(
        static_contract,
        baseline,
        patch,
        patch_artifact["digest"],
    )
    validate_static_evidence(validation, request)
    if sha256_text(candidate) != request["staticEvidence"]["candidateSha256"]:
        raise WorkerFailure(
            "gate", "patched candidate hash does not match static evidence"
        )
    return static_contract, baseline, patch, candidate


def validate_environment_manifest(path: Path, expected_sha256: str) -> dict[str, Any]:
    source, manifest = read_json_file(path, "environment manifest")
    if (
        expected_sha256 != EXPECTED_ENVIRONMENT_MANIFEST_SHA256
        or sha256_bytes(source) != expected_sha256
    ):
        raise WorkerFailure(
            "environment", "environment manifest hash does not match request pin"
        )
    expect_exact_keys(manifest, EXPECTED_ENVIRONMENT_KEYS, "environment manifest")
    if (
        type(manifest.get("schemaVersion")) is not int
        or manifest.get("schemaVersion") != 1
        or manifest.get("environmentSpecSha256") != EXPECTED_ENVIRONMENT_SPEC_SHA256
        or manifest.get("kernelBenchVerifiedCommit") != EXPECTED_KERNELBENCH_COMMIT
    ):
        raise WorkerFailure("environment", "environment manifest identity changed")
    for key in LIVE_ENVIRONMENT_KEYS:
        expect_string(manifest.get(key), f"environment manifest.{key}")
    return manifest


def validate_environment_seal(
    path: Path,
    expected_sha256: str,
    expected_manifest_sha256: str,
) -> dict[str, Any]:
    source, seal = read_json_file(path, "environment seal")
    if (
        expected_sha256 != EXPECTED_ENVIRONMENT_SEAL_SHA256
        or sha256_bytes(source) != expected_sha256
    ):
        raise WorkerFailure(
            "environment", "environment seal hash does not match request pin"
        )
    expect_exact_keys(
        seal,
        {
            "schemaVersion",
            "environmentSpecSha256",
            "environmentManifestSha256",
            "pipFreezeSha256",
        },
        "environment seal",
    )
    if seal != {
        "schemaVersion": 1,
        "environmentSpecSha256": EXPECTED_ENVIRONMENT_SPEC_SHA256,
        "environmentManifestSha256": expected_manifest_sha256,
        "pipFreezeSha256": EXPECTED_PIP_FREEZE_SHA256,
    }:
        raise WorkerFailure(
            "environment", "environment seal does not bind the exact runtime evidence"
        )
    return seal


def _probe_environment_variables() -> dict[str, str]:
    return {
        "LC_ALL": "C",
        "PATH": f"{EXPECTED_ENVIRONMENT_DIR / 'bin'}:/usr/bin:/bin",
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
    }


def _safe_probe_environment() -> dict[str, str]:
    source = (
        "import importlib.metadata,json,platform,torch;"
        "print(json.dumps({'python':platform.python_version(),'pip':importlib.metadata.version('pip'),"
        "'torch':torch.__version__,'torchCuda':torch.version.cuda,"
        "'numpy':importlib.metadata.version('numpy')},sort_keys=True))"
    )
    completed = subprocess.run(
        [str(EXPECTED_ENVIRONMENT_DIR / "bin/python"), "-I", "-c", source],
        check=False,
        capture_output=True,
        text=True,
        env=_probe_environment_variables(),
        timeout=60,
    )
    if completed.returncode != 0:
        raise WorkerFailure(
            "environment", f"live environment probe failed: {completed.stderr.strip()}"
        )
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise WorkerFailure(
            "environment", f"live environment probe returned invalid JSON: {error}"
        ) from error
    observed = expect_record(value, "live environment")
    expect_exact_keys(observed, LIVE_ENVIRONMENT_KEYS, "live environment")
    return {
        key: expect_string(observed.get(key), f"live environment.{key}")
        for key in LIVE_ENVIRONMENT_KEYS
    }


def _safe_probe_pip_list() -> bytes:
    completed = subprocess.run(
        [
            str(EXPECTED_ENVIRONMENT_DIR / "bin/python"),
            "-I",
            "-m",
            "pip",
            "list",
            "--format=freeze",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=_probe_environment_variables(),
        timeout=120,
    )
    if completed.returncode != 0:
        raise WorkerFailure(
            "environment",
            f"live pip inventory probe failed: {completed.stderr.strip()}",
        )
    lines = completed.stdout.splitlines()
    if not lines or any(not line.strip() or line != line.strip() for line in lines):
        raise WorkerFailure(
            "environment", "live pip inventory is empty or non-canonical"
        )
    return ("\n".join(sorted(lines)) + "\n").encode("utf-8")


def validate_environment_artifacts(
    manifest: dict[str, Any],
    seal: dict[str, Any],
) -> bytes:
    environment_root = EXPECTED_ENVIRONMENT_DIR
    if (
        not environment_root.is_absolute()
        or environment_root != Path(os.path.normpath(str(environment_root)))
        or environment_root.is_symlink()
        or not environment_root.is_dir()
    ):
        raise WorkerFailure(
            "environment",
            "sealed environment root is missing, non-normalized, or a symlink",
        )
    ready_path = environment_root / "READY"
    manifest_path = environment_root / "environment.json"
    seal_path = environment_root / "environment-seal.json"
    freeze_path = environment_root / "pip-freeze.txt"
    for path, label in (
        (ready_path, "sealed environment READY"),
        (manifest_path, "sealed environment manifest"),
        (seal_path, "sealed environment seal"),
        (freeze_path, "sealed environment pip freeze"),
    ):
        regular_file(path, label)
    if read_file_bytes(ready_path, "sealed environment READY").decode(
        "utf-8"
    ).strip() != (EXPECTED_ENVIRONMENT_SPEC_SHA256):
        raise WorkerFailure("environment", "sealed environment READY changed")
    manifest_source, root_manifest = read_json_file(
        manifest_path, "sealed environment manifest"
    )
    seal_source, root_seal = read_json_file(seal_path, "sealed environment seal")
    freeze_source = read_file_bytes(freeze_path, "sealed environment pip freeze")
    if (
        sha256_bytes(manifest_source) != EXPECTED_ENVIRONMENT_MANIFEST_SHA256
        or sha256_bytes(seal_source) != EXPECTED_ENVIRONMENT_SEAL_SHA256
        or sha256_bytes(freeze_source) != EXPECTED_PIP_FREEZE_SHA256
        or root_manifest != manifest
        or root_seal != seal
    ):
        raise WorkerFailure("environment", "sealed environment evidence bytes changed")

    python_launcher = environment_root / "bin/python"
    python3_launcher = environment_root / "bin/python3"
    torchrun = environment_root / "bin/torchrun"
    try:
        python_link = os.readlink(python_launcher)
        python3_link = os.readlink(python3_launcher)
        python_resolved = python_launcher.resolve(strict=True)
    except OSError as error:
        raise WorkerFailure(
            "environment", f"sealed Python launcher chain is invalid: {error}"
        ) from error
    if not python_launcher.is_symlink() or not python3_launcher.is_symlink():
        raise WorkerFailure(
            "environment", "sealed Python launchers must remain symlinks"
        )
    regular_file(python_resolved, "resolved Python executable")
    torchrun_stat = regular_file(torchrun, "torchrun executable")
    executables = {
        "python": {
            "path": str(python_launcher),
            "linkTarget": python_link,
            "python3LinkTarget": python3_link,
            "resolvedPath": str(python_resolved),
            "sha256": sha256_file(python_resolved),
            "size": python_resolved.stat().st_size,
        },
        "torchrun": {
            "path": str(torchrun),
            "sha256": sha256_file(torchrun),
            "size": torchrun_stat.st_size,
            "mode": stat.S_IMODE(torchrun_stat.st_mode),
        },
    }
    if executables != EXPECTED_ENVIRONMENT_EXECUTABLES:
        raise WorkerFailure(
            "environment", "sealed Python or torchrun executable bytes changed"
        )
    return freeze_source


def validate_live_environment(manifest: dict[str, Any], seal: dict[str, Any]) -> None:
    if sys.flags.isolated != 1:
        raise WorkerFailure("environment", "worker Python must run with -I")
    if Path(sys.prefix) != EXPECTED_ENVIRONMENT_DIR:
        raise WorkerFailure(
            "environment", "worker is not running from the sealed environment root"
        )
    freeze_source = validate_environment_artifacts(manifest, seal)
    observed = _safe_probe_environment()
    expected = {key: manifest[key] for key in LIVE_ENVIRONMENT_KEYS}
    if observed != expected:
        raise WorkerFailure(
            "environment",
            f"live environment does not match pinned manifest: {observed}",
        )
    if _safe_probe_pip_list() != freeze_source:
        raise WorkerFailure(
            "environment", "live pip inventory does not match the sealed pip freeze"
        )


def validate_dataset_manifest_document(
    manifest: dict[str, Any],
) -> list[dict[str, Any]]:
    expect_exact_keys(manifest, EXPECTED_DATASET_KEYS, "dataset manifest")
    if (
        type(manifest.get("schemaVersion")) is not int
        or manifest.get("schemaVersion") != 1
        or manifest.get("dataset") != EXPECTED_DATASET
        or manifest.get("revision") != EXPECTED_DATASET_REVISION
        or manifest.get("purpose") != EXPECTED_DATASET_PURPOSE
        or manifest.get("globalBatchTokensWorldSizeOne") != GLOBAL_BATCH_TOKENS
        or manifest.get("usableStepsPerTrainShard") != USABLE_STEPS_PER_TRAIN_SHARD
        or manifest.get("totalUsableTrainSteps") != TOTAL_USABLE_TRAIN_STEPS
    ):
        raise WorkerFailure(
            "dataset", "dataset manifest identity or capacity fields changed"
        )
    raw_files = manifest.get("files")
    if not isinstance(raw_files, list) or len(raw_files) != len(EXPECTED_DATASET_PATHS):
        raise WorkerFailure(
            "dataset", "dataset manifest must contain the exact 19-file scored set"
        )
    files: list[dict[str, Any]] = []
    for index, raw_item in enumerate(raw_files):
        item = expect_record(raw_item, f"dataset manifest.files[{index}]")
        expect_exact_keys(
            item, EXPECTED_DATASET_FILE_KEYS, f"dataset manifest.files[{index}]"
        )
        path = expect_string(item.get("path"), f"dataset manifest.files[{index}].path")
        size = expect_integer(item.get("size"), f"dataset manifest.files[{index}].size")
        tokens = expect_integer(
            item.get("tokens"), f"dataset manifest.files[{index}].tokens"
        )
        if (
            path != EXPECTED_DATASET_PATHS[index]
            or size != 256 * 4 + tokens * 2
            or expect_integer(
                item.get("magic"), f"dataset manifest.files[{index}].magic"
            )
            != 20240520
            or expect_integer(
                item.get("version"), f"dataset manifest.files[{index}].version"
            )
            != 1
            or tokens != 100_000_000
        ):
            raise WorkerFailure(
                "dataset", f"dataset manifest file {index} changed identity or header"
            )
        expect_sha256(item.get("sha256"), f"dataset manifest.files[{index}].sha256")
        files.append(item)
    derived_steps = sum(
        (int(item["tokens"]) - 2) // GLOBAL_BATCH_TOKENS for item in files[1:]
    )
    if derived_steps != TOTAL_USABLE_TRAIN_STEPS or VALIDATION_TOKENS + 1 >= int(
        files[0]["tokens"]
    ):
        raise WorkerFailure(
            "dataset", "dataset manifest does not cover the fixed scored schedule"
        )
    return files


def validate_dataset(
    manifest_path: Path,
    dataset_root: Path,
    expected_sha256: str,
    effective_train_steps: int,
) -> dict[str, Any]:
    source, manifest = read_json_file(manifest_path, "dataset manifest")
    if sha256_bytes(source) != expected_sha256:
        raise WorkerFailure(
            "dataset", "dataset manifest hash does not match request pin"
        )
    files = validate_dataset_manifest_document(manifest)
    if effective_train_steps > TOTAL_USABLE_TRAIN_STEPS:
        raise WorkerFailure(
            "dataset", "dataset capacity is below the requested effective train steps"
        )
    if (
        not dataset_root.is_absolute()
        or dataset_root != dataset_root.resolve()
        or dataset_root.is_symlink()
        or not dataset_root.is_dir()
    ):
        raise WorkerFailure(
            "dataset",
            "dataset root must be an absolute normalized non-symlink directory",
        )
    root_manifest = dataset_root / "dataset-manifest.json"
    ready = dataset_root / "READY"
    if read_file_bytes(root_manifest, "sealed dataset manifest") != source:
        raise WorkerFailure("dataset", "sealed dataset manifest bytes changed")
    if (
        read_file_bytes(ready, "sealed dataset READY").decode("utf-8").strip()
        != expected_sha256
    ):
        raise WorkerFailure(
            "dataset", "sealed dataset READY does not match the manifest pin"
        )
    observed_files: list[dict[str, object]] = []
    for item in files:
        path = dataset_root / str(item["path"])
        observed = regular_file(path, f"dataset file {item['path']}")
        if stat.S_IMODE(observed.st_mode) & 0o222:
            raise WorkerFailure("dataset", f"dataset file is writable: {item['path']}")
        if observed.st_size != item["size"] or sha256_file(path) != item["sha256"]:
            raise WorkerFailure(
                "dataset", f"dataset file hash or size mismatch: {item['path']}"
            )
        with path.open("rb") as stream:
            prefix = stream.read(12)
        if len(prefix) != 12 or struct.unpack("<iii", prefix) != (
            item["magic"],
            item["version"],
            item["tokens"],
        ):
            raise WorkerFailure(
                "dataset", f"dataset file header mismatch: {item['path']}"
            )
        observed_files.append(
            {"path": item["path"], "size": observed.st_size, "sha256": item["sha256"]}
        )
    observed_globs = sorted(
        path.name
        for pattern in ("fineweb_val_*.bin", "fineweb_train_*.bin")
        for path in dataset_root.glob(pattern)
    )
    if observed_globs != sorted(EXPECTED_DATASET_PATHS):
        raise WorkerFailure(
            "dataset", "dataset root contains an unmanifested NanoGPT shard"
        )
    return {"manifestSha256": expected_sha256, "files": observed_files}


def validate_launch_and_probe_hardware() -> tuple[str, str]:
    if any(name in os.environ for name in FORBIDDEN_ENVIRONMENT):
        raise WorkerFailure("launch", "forbidden W&B environment reached the worker")
    slurm_job_id = os.environ.get("SLURM_JOB_ID", "")
    cuda_visible = os.environ.get("CUDA_VISIBLE_DEVICES", "")
    if not slurm_job_id.isdigit():
        raise WorkerFailure("launch", "SLURM_JOB_ID must be numeric")
    if not cuda_visible or "," in cuda_visible:
        raise WorkerFailure(
            "launch", "CUDA_VISIBLE_DEVICES must select exactly one GPU"
        )
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi is None:
        raise WorkerFailure("hardware", "nvidia-smi is unavailable")
    completed = subprocess.run(
        [
            nvidia_smi,
            f"--id={cuda_visible}",
            "--query-gpu=uuid,name",
            "--format=csv,noheader",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if completed.returncode != 0 or len(lines) != 1:
        raise WorkerFailure(
            "hardware", f"expected exactly one visible GPU: {completed.stderr.strip()}"
        )
    gpu_uuid, separator, gpu_name = lines[0].partition(",")
    gpu_uuid = gpu_uuid.strip()
    gpu_name = gpu_name.strip()
    if separator == "" or not gpu_uuid or "l40s" not in gpu_name.lower():
        raise WorkerFailure(
            "hardware", f"visible GPU is not one NVIDIA L40S: {lines[0]}"
        )
    return slurm_job_id, gpu_uuid


def _replace_once(source: str, anchor: str, replacement: str, label: str) -> str:
    count = source.count(anchor)
    if count != 1:
        raise WorkerFailure(
            "gate", f"expected exactly one intact {label} anchor, found {count}"
        )
    return source.replace(anchor, replacement, 1)


def _train_steps_end_line(source: str) -> int:
    try:
        tree = ast.parse(source, filename=RUNTIME_CANDIDATE_NAME)
    except SyntaxError as error:
        raise WorkerFailure(
            "gate", f"validated candidate no longer parses: {error}"
        ) from error
    assignments: list[ast.Assign] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name) and target.id == "train_steps":
            assignments.append(node)
    if len(assignments) != 1 or not isinstance(assignments[0].end_lineno, int):
        raise WorkerFailure(
            "gate",
            "validated candidate no longer has one stable train_steps assignment",
        )
    return assignments[0].end_lineno


def instrument_candidate(
    candidate: str,
    request: dict[str, Any],
    trial_index: int,
) -> str:
    if RUNTIME_RESERVED_PREFIX in candidate or RUNTIME_MARKER_PREFIX in candidate:
        raise WorkerFailure(
            "gate", "candidate contains an evaluator-reserved runtime identifier"
        )
    candidate_sha256 = request["staticEvidence"]["candidateSha256"]
    declared_steps = request["staticEvidence"]["trainSteps"]
    effective_steps = request["effectiveTrainSteps"]
    seed = request["seeds"][trial_index]
    lines = candidate.splitlines(keepends=True)
    end_line = _train_steps_end_line(candidate)
    if not 1 <= end_line <= len(lines):
        raise WorkerFailure("gate", "train_steps source boundary is invalid")
    initialization = [
        f"    {RUNTIME_RESERVED_PREFIX}declared_train_steps = train_steps\n",
        f"    train_steps = {effective_steps}\n",
        f"    {RUNTIME_RESERVED_PREFIX}optimizer_steps = 0\n",
        f"    {RUNTIME_RESERVED_PREFIX}backward_calls = 0\n",
        "    torch.cuda.reset_peak_memory_stats()\n",
        "    print0(\n",
        f'        f"{RUNTIME_MARKER_PREFIX}CONTRACT|contract={RUNTIME_CONTRACT}'
        f"|request_digest={request['requestDigest']}|candidate_sha256={candidate_sha256}"
        f"|mode={request['mode']}|index={trial_index}|seed={{seed}}"
        f"|declared_train_steps={{{RUNTIME_RESERVED_PREFIX}declared_train_steps}}"
        '|effective_train_steps={train_steps}",\n',
        "        console=True,\n",
        "    )\n",
    ]
    lines[end_line:end_line] = initialization
    runtime_source = "".join(lines)
    runtime_source = _replace_once(
        runtime_source,
        LOGFILE_ANCHOR,
        f'    logfile = "logs/{RUNTIME_LOG_NAME}"\n',
        "runtime log",
    )
    runtime_source = _replace_once(
        runtime_source,
        SEED_ANCHOR,
        f"    seed = {seed}\n",
        "fixed seed",
    )
    runtime_source = _replace_once(
        runtime_source,
        BACKWARD_ANCHOR,
        f"            {RUNTIME_RESERVED_PREFIX}backward_calls += 1\n" + BACKWARD_ANCHOR,
        "training backward",
    )
    runtime_source = _replace_once(
        runtime_source,
        OPTIMIZER_STEP_ANCHOR,
        f"        {RUNTIME_RESERVED_PREFIX}optimizer_steps += 1\n"
        + OPTIMIZER_STEP_ANCHOR,
        "optimizer step",
    )
    result = (
        "\n"
        f"    {RUNTIME_RESERVED_PREFIX}expected_backward_calls = (\n"
        "        train_steps * (batch_size // dist.get_world_size() // 1024 // mbs)\n"
        "    )\n"
        f"    if {RUNTIME_RESERVED_PREFIX}optimizer_steps != train_steps:\n"
        "        raise RuntimeError(\n"
        f'            f"optimizer-step contract failed: {{{RUNTIME_RESERVED_PREFIX}optimizer_steps}} != {{train_steps}}"\n'
        "        )\n"
        f"    if {RUNTIME_RESERVED_PREFIX}backward_calls != {RUNTIME_RESERVED_PREFIX}expected_backward_calls:\n"
        "        raise RuntimeError(\n"
        f'            f"backward-call contract failed: {{{RUNTIME_RESERVED_PREFIX}backward_calls}} != '
        f'{{{RUNTIME_RESERVED_PREFIX}expected_backward_calls}}"\n'
        "        )\n"
        "    print0(\n"
        f'        f"{RUNTIME_MARKER_PREFIX}RESULT|index={trial_index}|seed={{seed}}'
        f"|declared_train_steps={{{RUNTIME_RESERVED_PREFIX}declared_train_steps}}"
        "|effective_train_steps={train_steps}|final_val_loss={val_loss.item():.9f}"
        f"|optimizer_steps={{{RUNTIME_RESERVED_PREFIX}optimizer_steps}}"
        f"|backward_calls={{{RUNTIME_RESERVED_PREFIX}backward_calls}}"
        '|peak_vram_mb={torch.cuda.max_memory_allocated() / 1048576:.3f}",\n'
        "        console=True,\n"
        "    )\n"
    )
    runtime_source = _replace_once(
        runtime_source,
        TRIAL_RESULT_ANCHOR,
        result + TRIAL_RESULT_ANCHOR,
        "trial result",
    )
    completion = (
        f'\nprint0(f"{RUNTIME_MARKER_PREFIX}COMPLETE|trials={{num_trials}}", console=True)\n'
        "dist.destroy_process_group()\n"
    )
    runtime_source = _replace_once(
        runtime_source, COMPLETE_ANCHOR, completion, "runtime completion"
    )
    try:
        compile(runtime_source, RUNTIME_PROGRAM_NAME, "exec")
    except SyntaxError as error:
        raise WorkerFailure(
            "gate", f"instrumented runtime is invalid: {error}"
        ) from error
    if declared_steps != request["staticEvidence"]["trainSteps"]:
        raise WorkerFailure("gate", "declared steps changed during instrumentation")
    return runtime_source


def _write_immutable(path: Path, value: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        raise
    os.chmod(path, 0o400)


def materialize_trial(
    trial_log_dir: Path,
    static_contract: dict[str, Any],
    baseline: str,
    patch: str,
    request: dict[str, Any],
    trial_index: int,
    dataset_root: Path,
) -> tuple[Path, str]:
    trial_dir = trial_log_dir / f"materialized-{trial_index:03d}"
    trial_dir.mkdir(mode=0o700, exist_ok=False)
    candidate, validation = apply_and_validate_candidate(
        static_contract,
        baseline,
        patch,
        request["candidatePatch"]["digest"],
    )
    validate_static_evidence(validation, request)
    runtime_source = instrument_candidate(candidate, request, trial_index)
    candidate_path = trial_dir / RUNTIME_CANDIDATE_NAME
    runtime_path = trial_dir / RUNTIME_PROGRAM_NAME
    _write_immutable(candidate_path, candidate.encode("utf-8"))
    _write_immutable(runtime_path, runtime_source.encode("utf-8"))
    if sha256_file(candidate_path) != request["staticEvidence"]["candidateSha256"]:
        raise WorkerFailure(
            "integrity", f"trial {trial_index} candidate pre-run hash changed"
        )
    data_parent = trial_dir / "data"
    data_root = data_parent / "fineweb10B"
    data_root.mkdir(mode=0o700, parents=True)
    for name in EXPECTED_DATASET_PATHS:
        os.symlink(dataset_root / name, data_root / name)
    os.chmod(data_root, 0o500)
    os.chmod(data_parent, 0o500)
    return trial_dir, runtime_source


def _parse_marker(line: str, kind: str, expected_keys: set[str]) -> dict[str, str]:
    prefix = f"{RUNTIME_MARKER_PREFIX}{kind}|"
    if not line.startswith(prefix):
        raise WorkerFailure("runtime", f"line is not a {kind} marker")
    fields: dict[str, str] = {}
    for part in line[len(prefix) :].split("|"):
        key, separator, value = part.partition("=")
        if separator == "" or key == "" or key in fields:
            raise WorkerFailure("runtime", f"malformed {kind} marker")
        fields[key] = value
    if set(fields) != expected_keys:
        raise WorkerFailure("runtime", f"{kind} marker fields changed")
    return fields


def _parse_nonnegative_int(value: str, label: str) -> int:
    if re.fullmatch(r"0|[1-9][0-9]*", value) is None:
        raise WorkerFailure(
            "runtime", f"{label} must be a canonical non-negative integer"
        )
    return int(value)


def _parse_finite(value: str, label: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise WorkerFailure("runtime", f"{label} must be finite") from error
    if not math.isfinite(parsed):
        raise WorkerFailure("runtime", f"{label} must be finite")
    return parsed


def parse_trial_log(
    log_path: Path,
    runtime_source: str,
    request: dict[str, Any],
    trial_index: int,
    environment_manifest: dict[str, Any],
) -> tuple[float, int, float]:
    regular_file(log_path, f"trial {trial_index} runtime log")
    try:
        log = log_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise WorkerFailure(
            "runtime", f"cannot read trial {trial_index} log: {error}"
        ) from error
    boundary = runtime_source + "\n" + "=" * 100 + "\n"
    if not log.startswith(boundary):
        raise WorkerFailure(
            "runtime",
            f"trial {trial_index} log does not begin with exact runtime source",
        )
    tail = log[len(boundary) :]
    if "Traceback (most recent call last):" in tail or "CUDA out of memory" in tail:
        raise WorkerFailure(
            "runtime", f"trial {trial_index} log contains a fatal runtime failure"
        )
    lines = tail.splitlines()
    environment_matches = [
        match for line in lines if (match := ENVIRONMENT_LINE.fullmatch(line))
    ]
    if len(environment_matches) != 1:
        raise WorkerFailure(
            "runtime", f"trial {trial_index} must log one environment identity"
        )
    environment = environment_matches[0].groupdict()
    if (
        environment["world_size"] != "1"
        or "l40s" not in environment["gpu"].lower()
        or environment["pytorch"] != environment_manifest["torch"]
        or environment["cuda"] != environment_manifest["torchCuda"]
    ):
        raise WorkerFailure(
            "runtime", f"trial {trial_index} runtime environment changed"
        )
    contract_lines = [
        line for line in lines if line.startswith(f"{RUNTIME_MARKER_PREFIX}CONTRACT|")
    ]
    result_lines = [
        line for line in lines if line.startswith(f"{RUNTIME_MARKER_PREFIX}RESULT|")
    ]
    complete_lines = [
        line for line in lines if line.startswith(f"{RUNTIME_MARKER_PREFIX}COMPLETE|")
    ]
    if len(contract_lines) != 1 or len(result_lines) != 1 or len(complete_lines) != 1:
        raise WorkerFailure("runtime", f"trial {trial_index} marker counts changed")
    contract = _parse_marker(
        contract_lines[0],
        "CONTRACT",
        {
            "contract",
            "request_digest",
            "candidate_sha256",
            "mode",
            "index",
            "seed",
            "declared_train_steps",
            "effective_train_steps",
        },
    )
    result = _parse_marker(
        result_lines[0],
        "RESULT",
        {
            "index",
            "seed",
            "declared_train_steps",
            "effective_train_steps",
            "final_val_loss",
            "optimizer_steps",
            "backward_calls",
            "peak_vram_mb",
        },
    )
    complete = _parse_marker(complete_lines[0], "COMPLETE", {"trials"})
    expected_seed = request["seeds"][trial_index]
    declared_steps = request["staticEvidence"]["trainSteps"]
    effective_steps = request["effectiveTrainSteps"]
    if contract != {
        "contract": RUNTIME_CONTRACT,
        "request_digest": request["requestDigest"],
        "candidate_sha256": request["staticEvidence"]["candidateSha256"],
        "mode": request["mode"],
        "index": str(trial_index),
        "seed": str(expected_seed),
        "declared_train_steps": str(declared_steps),
        "effective_train_steps": str(effective_steps),
    }:
        raise WorkerFailure("runtime", f"trial {trial_index} contract marker changed")
    if (
        _parse_nonnegative_int(result["index"], "result index") != trial_index
        or _parse_nonnegative_int(result["seed"], "result seed") != expected_seed
        or _parse_nonnegative_int(result["declared_train_steps"], "declared steps")
        != declared_steps
        or _parse_nonnegative_int(result["effective_train_steps"], "effective steps")
        != effective_steps
        or _parse_nonnegative_int(complete["trials"], "completed trials") != 1
    ):
        raise WorkerFailure("runtime", f"trial {trial_index} result identity changed")
    optimizer_steps = _parse_nonnegative_int(
        result["optimizer_steps"], "optimizer steps"
    )
    backward_calls = _parse_nonnegative_int(result["backward_calls"], "backward calls")
    if optimizer_steps != effective_steps or backward_calls != effective_steps * 8:
        raise WorkerFailure("runtime", f"trial {trial_index} execution counts changed")
    seed_lines = [line for line in lines if re.fullmatch(r"seed:\d+", line)]
    if seed_lines != [f"seed:{expected_seed}"]:
        raise WorkerFailure("runtime", f"trial {trial_index} seed log changed")
    environment_index = next(
        index for index, line in enumerate(lines) if ENVIRONMENT_LINE.fullmatch(line)
    )
    seed_index = lines.index(seed_lines[0])
    contract_index = lines.index(contract_lines[0])
    result_index = lines.index(result_lines[0])
    complete_index = lines.index(complete_lines[0])
    if (
        not environment_index
        < seed_index
        < contract_index
        < result_index
        < complete_index
    ):
        raise WorkerFailure("runtime", f"trial {trial_index} markers are out of order")
    final_matches = []
    for line in lines[contract_index + 1 : result_index]:
        match = FINAL_VALIDATION_LINE.match(line)
        if (
            match
            and int(match.group("step")) == effective_steps
            and int(match.group("total")) == effective_steps
        ):
            final_matches.append(match)
    if len(final_matches) != 1:
        raise WorkerFailure(
            "runtime", f"trial {trial_index} must log one final validation metric"
        )
    printed_loss = _parse_finite(
        final_matches[0].group("loss"), "printed final validation loss"
    )
    precise_loss = _parse_finite(
        result["final_val_loss"], "precise final validation loss"
    )
    peak_vram_mb = _parse_finite(result["peak_vram_mb"], "peak VRAM")
    if (
        printed_loss <= 0
        or precise_loss <= 0
        or abs(printed_loss - precise_loss) > 0.0000051
    ):
        raise WorkerFailure(
            "runtime", f"trial {trial_index} final validation metrics disagree"
        )
    if peak_vram_mb < 0:
        raise WorkerFailure("runtime", f"trial {trial_index} peak VRAM is negative")
    return precise_loss, optimizer_steps, peak_vram_mb


def runtime_environment(trial_dir: Path) -> dict[str, str]:
    home = trial_dir / "home"
    temporary = trial_dir / "tmp"
    cache = trial_dir / "torchinductor-cache"
    for path in (home, temporary, cache):
        path.mkdir(mode=0o700)
    wrapper = trial_dir / "isolated-python"
    wrapper_source = (
        "#!/bin/sh\n"
        f'exec {shlex.quote(str(EXPECTED_ENVIRONMENT_DIR / "bin/python"))} -I "$@"\n'
    ).encode("utf-8")
    descriptor = os.open(wrapper, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o500)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(wrapper_source)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(wrapper, 0o500)
    environment = {
        "CUDA_DEVICE_ORDER": "PCI_BUS_ID",
        "CUDA_VISIBLE_DEVICES": os.environ["CUDA_VISIBLE_DEVICES"],
        "HOME": str(home),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "PATH": os.environ.get("PATH", f"{Path(sys.prefix) / 'bin'}:/usr/bin:/bin"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "PYTHON_EXEC": str(wrapper),
        "SLURM_JOB_ID": os.environ["SLURM_JOB_ID"],
        "TMPDIR": str(temporary),
        "TORCHINDUCTOR_CACHE_DIR": str(cache),
    }
    return environment


def _publish_log(source: Path, destination: Path) -> None:
    regular_file(source, str(source))
    _write_immutable(destination, source.read_bytes())


def _wait_for_process_group(
    process: subprocess.Popen[bytes],
    timeout_seconds: int,
    trial_index: int,
) -> int:
    try:
        return process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as timeout_error:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired as reap_error:
            raise WorkerFailure(
                "worker",
                f"trial {trial_index} timed out and its torchrun process group could not be reaped",
            ) from reap_error
        raise WorkerFailure(
            "timeout",
            f"trial {trial_index} exceeded {timeout_seconds} seconds; torchrun process group terminated",
        ) from timeout_error


def _verify_materialized_sources(
    trial_dir: Path,
    runtime_source: str,
    candidate_sha256: str,
    trial_index: int,
) -> None:
    candidate_path = trial_dir / RUNTIME_CANDIDATE_NAME
    runtime_path = trial_dir / RUNTIME_PROGRAM_NAME
    if sha256_file(candidate_path) != candidate_sha256 or sha256_text(
        runtime_source
    ) != sha256_file(runtime_path):
        raise WorkerFailure(
            "integrity", f"trial {trial_index} source changed during execution"
        )


def run_trial(
    args: argparse.Namespace,
    static_contract: dict[str, Any],
    baseline: str,
    patch: str,
    request: dict[str, Any],
    trial_index: int,
    environment_manifest: dict[str, Any],
) -> dict[str, object]:
    started_at = utc_now()
    started_clock = time.perf_counter()
    trial_dir, runtime_source = materialize_trial(
        args.trial_log_dir,
        static_contract,
        baseline,
        patch,
        request,
        trial_index,
        args.dataset_root,
    )
    stdout_path = args.trial_log_dir / f"trial-{trial_index:03d}.stdout.log"
    stderr_path = args.trial_log_dir / f"trial-{trial_index:03d}.stderr.log"
    final_log_path = args.trial_log_dir / f"trial-{trial_index:03d}.log"
    torchrun = EXPECTED_ENVIRONMENT_DIR / "bin" / "torchrun"
    timeout_seconds = 1200 if request["mode"] == "smoke-10" else 18_000
    process_failure: Optional[WorkerFailure] = None
    runtime_exit_code: Optional[int] = None
    with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
        try:
            process = subprocess.Popen(
                [
                    str(EXPECTED_ENVIRONMENT_DIR / "bin/python"),
                    "-I",
                    str(torchrun),
                    "--standalone",
                    "--nnodes=1",
                    "--nproc-per-node=1",
                    RUNTIME_PROGRAM_NAME,
                    "1",
                ],
                cwd=trial_dir,
                env=runtime_environment(trial_dir),
                stdout=stdout,
                stderr=stderr,
                start_new_session=True,
            )
            try:
                runtime_exit_code = _wait_for_process_group(
                    process, timeout_seconds, trial_index
                )
            except WorkerFailure as error:
                process_failure = error
        finally:
            stdout.flush()
            stderr.flush()
            os.fsync(stdout.fileno())
            os.fsync(stderr.fileno())
    os.chmod(stdout_path, 0o400)
    os.chmod(stderr_path, 0o400)
    _verify_materialized_sources(
        trial_dir,
        runtime_source,
        request["staticEvidence"]["candidateSha256"],
        trial_index,
    )
    if process_failure is not None:
        raise process_failure
    if runtime_exit_code is None:
        raise WorkerFailure(
            "worker", f"trial {trial_index} torchrun exit status was not captured"
        )
    runtime_log_path = trial_dir / "logs" / RUNTIME_LOG_NAME
    if runtime_log_path.exists():
        _publish_log(runtime_log_path, final_log_path)
    if runtime_exit_code != 0:
        stderr_tail = stderr_path.read_text(encoding="utf-8", errors="replace")[-4000:]
        kind = "oom" if "out of memory" in stderr_tail.lower() else "runtime"
        raise WorkerFailure(
            kind,
            f"trial {trial_index} torchrun exited {runtime_exit_code}: {stderr_tail}",
        )
    if not final_log_path.exists():
        raise WorkerFailure(
            "runtime", f"trial {trial_index} did not produce its deterministic log"
        )
    final_loss, optimizer_steps, peak_vram_mb = parse_trial_log(
        final_log_path,
        runtime_source,
        request,
        trial_index,
        environment_manifest,
    )
    _verify_materialized_sources(
        trial_dir,
        runtime_source,
        request["staticEvidence"]["candidateSha256"],
        trial_index,
    )
    finished_at = utc_now()
    runtime_ms = max(0.0, (time.perf_counter() - started_clock) * 1000)
    return {
        "index": trial_index,
        "seed": request["seeds"][trial_index],
        "startedAt": started_at,
        "finishedAt": finished_at,
        "finalValidationLoss": final_loss,
        "optimizerSteps": optimizer_steps,
        "peakVramMb": peak_vram_mb,
        "runtimeMs": round(runtime_ms, 3),
        "logSha256": sha256_file(final_log_path),
    }


def build_result(
    request: dict[str, Any],
    *,
    ok: bool,
    trials: list[dict[str, object]],
    started_at: str,
    slurm_job_id: str,
    gpu_uuid: str,
    failure: Optional[dict[str, str]],
) -> dict[str, object]:
    if not slurm_job_id.isdigit() or not gpu_uuid:
        raise WorkerFailure(
            "worker",
            "verified SLURM and GPU identities are required for a worker result",
        )
    evidence = request["staticEvidence"]
    candidate_sha256 = evidence["candidateSha256"]
    request_digest = request["requestDigest"]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": CONTRACT,
        "ok": ok,
        "requestDigest": request_digest,
        "externalHandle": HANDLE_PREFIX + request_digest,
        "slurmJobId": slurm_job_id,
        "mode": request["mode"],
        "candidateSha256": candidate_sha256,
        "trainSteps": evidence["trainSteps"],
        "effectiveTrainSteps": request["effectiveTrainSteps"],
        "trials": trials,
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "hardware": {
            "cluster": "Stanford FarmShare",
            "gpu": "NVIDIA L40S",
            "gpuUuid": gpu_uuid,
            "gpus": 1,
            "worldSize": 1,
        },
        "execution": {
            "trialExecution": "sequential",
            "cleanJobDirectory": True,
            "freshCandidateMaterialization": True,
            "priorMeasurementsReused": False,
        },
        "sourceIntegrity": {
            "preRunCandidateSha256": candidate_sha256,
            "postRunCandidateSha256": candidate_sha256,
        },
        "pins": request["pins"],
        "failure": failure,
    }


def parse_utc_timestamp(value: object, label: str) -> dt.datetime:
    timestamp = expect_string(value, label)
    if not timestamp.endswith("Z"):
        raise WorkerFailure("worker", f"{label} must be a UTC ISO timestamp")
    try:
        parsed = dt.datetime.fromisoformat(timestamp.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise WorkerFailure("worker", f"{label} must be a UTC ISO timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise WorkerFailure("worker", f"{label} must be a UTC ISO timestamp")
    return parsed


def validate_result_document(result: dict[str, Any], request: dict[str, Any]) -> None:
    expect_exact_keys(
        result,
        {
            "schemaVersion",
            "contract",
            "ok",
            "requestDigest",
            "externalHandle",
            "slurmJobId",
            "mode",
            "candidateSha256",
            "trainSteps",
            "effectiveTrainSteps",
            "trials",
            "startedAt",
            "finishedAt",
            "hardware",
            "execution",
            "sourceIntegrity",
            "pins",
            "failure",
        },
        "worker result",
    )
    if (
        type(result.get("schemaVersion")) is not int
        or result.get("schemaVersion") != SCHEMA_VERSION
    ):
        raise WorkerFailure("worker", "worker result schema version changed")
    if type(result.get("ok")) is not bool:
        raise WorkerFailure("worker", "worker result ok must be boolean")
    started_at = parse_utc_timestamp(result.get("startedAt"), "worker result.startedAt")
    finished_at = parse_utc_timestamp(
        result.get("finishedAt"), "worker result.finishedAt"
    )
    if finished_at < started_at:
        raise WorkerFailure("worker", "worker result timestamps are out of order")
    hardware = expect_record(result.get("hardware"), "worker result.hardware")
    expect_exact_keys(
        hardware,
        {"cluster", "gpu", "gpuUuid", "gpus", "worldSize"},
        "worker result.hardware",
    )
    execution = expect_record(result.get("execution"), "worker result.execution")
    expect_exact_keys(
        execution,
        {
            "trialExecution",
            "cleanJobDirectory",
            "freshCandidateMaterialization",
            "priorMeasurementsReused",
        },
        "worker result.execution",
    )
    source_integrity = expect_record(
        result.get("sourceIntegrity"), "worker result.sourceIntegrity"
    )
    expect_exact_keys(
        source_integrity,
        {"preRunCandidateSha256", "postRunCandidateSha256"},
        "worker result.sourceIntegrity",
    )
    pins = expect_record(result.get("pins"), "worker result.pins")
    expect_exact_keys(
        pins,
        {
            "staticEvaluatorSha256",
            "environmentSha256",
            "environmentSealSha256",
            "datasetManifestSha256",
            "workerSha256",
            "transportSha256",
        },
        "worker result.pins",
    )
    fixed = build_result(
        request,
        ok=bool(result["ok"]),
        trials=result["trials"],
        started_at=result["startedAt"],
        slurm_job_id=result["slurmJobId"],
        gpu_uuid=hardware["gpuUuid"],
        failure=result["failure"],
    )
    for key in (
        "schemaVersion",
        "contract",
        "requestDigest",
        "externalHandle",
        "mode",
        "candidateSha256",
        "trainSteps",
        "effectiveTrainSteps",
        "hardware",
        "execution",
        "sourceIntegrity",
        "pins",
    ):
        if result.get(key) != fixed.get(key):
            raise WorkerFailure("worker", f"worker result {key} is not request-bound")
    if not re.fullmatch(
        r"\d+", expect_string(result.get("slurmJobId"), "worker result.slurmJobId")
    ):
        raise WorkerFailure("worker", "worker result SLURM job id must be numeric")
    expect_string(hardware.get("gpuUuid"), "worker result.hardware.gpuUuid")
    if (
        expect_integer(result.get("trainSteps"), "worker result.trainSteps")
        != request["staticEvidence"]["trainSteps"]
        or expect_integer(
            result.get("effectiveTrainSteps"), "worker result.effectiveTrainSteps"
        )
        != request["effectiveTrainSteps"]
        or expect_integer(hardware.get("gpus"), "worker result.hardware.gpus") != 1
        or expect_integer(hardware.get("worldSize"), "worker result.hardware.worldSize")
        != 1
        or type(execution.get("cleanJobDirectory")) is not bool
        or type(execution.get("freshCandidateMaterialization")) is not bool
        or type(execution.get("priorMeasurementsReused")) is not bool
    ):
        raise WorkerFailure(
            "worker", "worker result numeric or execution fields changed type"
        )
    expect_sha256(result.get("candidateSha256"), "worker result.candidateSha256")
    expect_sha256(
        source_integrity.get("preRunCandidateSha256"),
        "worker result.sourceIntegrity.preRunCandidateSha256",
    )
    expect_sha256(
        source_integrity.get("postRunCandidateSha256"),
        "worker result.sourceIntegrity.postRunCandidateSha256",
    )
    trials = result.get("trials")
    if not isinstance(trials, list) or len(trials) > request["trials"]:
        raise WorkerFailure("worker", "worker result trial prefix is invalid")
    for index, trial_value in enumerate(trials):
        trial = expect_record(trial_value, f"worker result.trials[{index}]")
        expect_exact_keys(
            trial,
            {
                "index",
                "seed",
                "startedAt",
                "finishedAt",
                "finalValidationLoss",
                "optimizerSteps",
                "peakVramMb",
                "runtimeMs",
                "logSha256",
            },
            f"worker result.trials[{index}]",
        )
        if (
            expect_integer(trial.get("index"), f"worker result.trials[{index}].index")
            != index
            or expect_integer(trial.get("seed"), f"worker result.trials[{index}].seed")
            != request["seeds"][index]
            or expect_integer(
                trial.get("optimizerSteps"),
                f"worker result.trials[{index}].optimizerSteps",
            )
            != request["effectiveTrainSteps"]
            or expect_finite(trial.get("finalValidationLoss"), "trial loss") <= 0
            or expect_finite(trial.get("peakVramMb"), "trial peak VRAM") < 0
            or expect_finite(trial.get("runtimeMs"), "trial runtime") < 0
        ):
            raise WorkerFailure(
                "worker", f"worker result trial {index} violates the fixed contract"
            )
        expect_sha256(
            trial.get("logSha256"), f"worker result.trials[{index}].logSha256"
        )
        trial_started_at = parse_utc_timestamp(
            trial.get("startedAt"),
            f"worker result.trials[{index}].startedAt",
        )
        trial_finished_at = parse_utc_timestamp(
            trial.get("finishedAt"),
            f"worker result.trials[{index}].finishedAt",
        )
        if trial_finished_at < trial_started_at:
            raise WorkerFailure(
                "worker", f"worker result trial {index} timestamps are out of order"
            )
        if index > 0 and trial_started_at < parse_utc_timestamp(
            trials[index - 1]["finishedAt"],
            f"worker result.trials[{index - 1}].finishedAt",
        ):
            raise WorkerFailure("worker", "worker result trials overlap")
        if trial_started_at < started_at or trial_finished_at > finished_at:
            raise WorkerFailure(
                "worker", f"worker result trial {index} escapes its envelope"
            )
    failure = result.get("failure")
    if result["ok"]:
        if failure is not None or len(trials) != request["trials"]:
            raise WorkerFailure(
                "worker",
                "successful worker result must contain all trials and no failure",
            )
    else:
        failure_record = expect_record(failure, "worker result.failure")
        expect_exact_keys(failure_record, {"kind", "message"}, "worker result.failure")
        expect_string(failure_record.get("kind"), "worker result.failure.kind")
        expect_string(failure_record.get("message"), "worker result.failure.message")


def durable_create_json(path: Path, value: dict[str, object]) -> None:
    content = canonical_json(value).encode("utf-8") + b"\n"
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.tmp.", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
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


def execute(args: argparse.Namespace) -> tuple[dict[str, object], int]:
    started_at = utc_now()
    root = validate_request_identity_path(args)
    request = validate_request_file(args.request)
    validate_paths(args, root)
    trials: list[dict[str, object]] = []
    static_contract, baseline, patch, _ = validate_candidate_assets(args, request)
    environment_manifest = validate_environment_manifest(
        args.environment_manifest,
        request["pins"]["environmentSha256"],
    )
    environment_seal = validate_environment_seal(
        args.environment_seal,
        request["pins"]["environmentSealSha256"],
        request["pins"]["environmentSha256"],
    )
    validate_live_environment(environment_manifest, environment_seal)
    validate_dataset(
        args.dataset_manifest,
        args.dataset_root,
        request["pins"]["datasetManifestSha256"],
        request["effectiveTrainSteps"],
    )
    slurm_job_id, gpu_uuid = validate_launch_and_probe_hardware()
    args.trial_log_dir.mkdir(mode=0o700, exist_ok=False)
    stage_error: Optional[Exception] = None
    try:
        for trial_index in range(request["trials"]):
            trials.append(
                run_trial(
                    args,
                    static_contract,
                    baseline,
                    patch,
                    request,
                    trial_index,
                    environment_manifest,
                )
            )
    except Exception as error:
        stage_error = error

    _, _, _, post_candidate = validate_candidate_assets(args, request)
    if sha256_text(post_candidate) != request["staticEvidence"]["candidateSha256"]:
        raise WorkerFailure(
            "integrity", "candidate assets changed after the scored stage"
        )
    post_environment_manifest = validate_environment_manifest(
        args.environment_manifest,
        request["pins"]["environmentSha256"],
    )
    post_environment_seal = validate_environment_seal(
        args.environment_seal,
        request["pins"]["environmentSealSha256"],
        request["pins"]["environmentSha256"],
    )
    if (
        post_environment_manifest != environment_manifest
        or post_environment_seal != environment_seal
    ):
        raise WorkerFailure(
            "integrity", "environment evidence changed after the scored stage"
        )
    validate_live_environment(post_environment_manifest, post_environment_seal)
    validate_dataset(
        args.dataset_manifest,
        args.dataset_root,
        request["pins"]["datasetManifestSha256"],
        request["effectiveTrainSteps"],
    )
    post_slurm_job_id, post_gpu_uuid = validate_launch_and_probe_hardware()
    if post_slurm_job_id != slurm_job_id or post_gpu_uuid != gpu_uuid:
        raise WorkerFailure(
            "integrity", "SLURM or GPU identity changed during the scored stage"
        )

    failure: Optional[dict[str, str]] = None
    ok = stage_error is None
    if stage_error is not None:
        if (
            not isinstance(stage_error, WorkerFailure)
            or stage_error.kind not in REPORTABLE_FAILURE_KINDS
        ):
            raise stage_error
        failure = {
            "kind": stage_error.kind,
            "message": str(stage_error) or type(stage_error).__name__,
        }
        traceback.print_exception(stage_error, file=sys.stderr)
    result = build_result(
        request,
        ok=ok,
        trials=trials,
        started_at=started_at,
        slurm_job_id=slurm_job_id,
        gpu_uuid=gpu_uuid,
        failure=failure,
    )
    try:
        validate_result_document(result, request)
    except Exception as error:
        if ok:
            failure = {
                "kind": "worker",
                "message": f"result validation failed: {error}",
            }
            result = build_result(
                request,
                ok=False,
                trials=trials,
                started_at=started_at,
                slurm_job_id=slurm_job_id,
                gpu_uuid=gpu_uuid,
                failure=failure,
            )
            validate_result_document(result, request)
        else:
            raise
    durable_create_json(args.output, result)
    print(
        canonical_json(
            {
                "ok": result["ok"],
                "output": str(args.output),
                "requestDigest": result["requestDigest"],
            }
        )
    )
    # A schema-valid, durably published result is a successful evaluator process
    # even when the measured trial itself failed. The host preserves that typed
    # failure and exits nonzero; early failures that cannot produce this envelope
    # still escape execute() and fail the SLURM batch directly.
    return result, 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--candidate-patch", required=True, type=Path)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--static-evaluator", required=True, type=Path)
    parser.add_argument("--environment-manifest", required=True, type=Path)
    parser.add_argument("--environment-seal", required=True, type=Path)
    parser.add_argument("--dataset-manifest", required=True, type=Path)
    parser.add_argument("--dataset-root", required=True, type=Path)
    parser.add_argument("--trial-log-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    _, exit_code = execute(args)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

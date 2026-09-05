#!/usr/bin/env python3
"""Execute one verifier-bound NanoGPT parallel child on one FarmShare L40S."""

from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
import hashlib
import json
import math
import os
from pathlib import Path
import re
import runpy
import stat
import tempfile
import time
import traceback
from typing import Any, Optional, Sequence


SCHEMA_VERSION = 1
CONTRACT = "nanogpt-track3-scored-parallel-confirmatory-v2"
PARALLEL_AMENDMENT_SHA256 = (
    "86faf36c6060d6861dccbe2d6e72810a2983b0f4709fbd5d0f475634ced6f2c5"
)
V1_CONTRACT = "nanogpt-track3-scored-confirmatory-v1"
V1_CAMPAIGN_AMENDMENT_SHA256 = (
    "0aece581a2cc9e49672f598129a9f298353114368962a4fca0e09b0f7e9751ab"
)
STATIC_CONTRACT = "nanogpt-track3-static-contract-v1"
PINNED_COMMIT = "38e258afefb1ce206dd7595aa71d7740da405742"
PINNED_PROGRAM_SHA256 = (
    "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08"
)
PINNED_BASELINE_SHA256 = (
    "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e"
)
BASELINE_TRAIN_STEPS = 3290
MEAN_LOSS_EXCLUSIVE_UPPER_BOUND = 3.27859
TRIAL_SEEDS = tuple(0xC0FFEE + index for index in range(8))
MAX_SAFE_INTEGER = 2**53 - 1
MAX_SOURCE_BYTES = 256 * 1024
MAX_PATCH_BYTES = 128 * 1024
MAX_LOG_BYTES = 16 * 1024 * 1024
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
V1_EPOCH_PATTERN = re.compile(r"nanogpt-scored-v1-[0-9a-f]{24}")
ISO_TIMESTAMP_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")
LOSS_DECIMAL_PATTERN = re.compile(r"([0-9]+)\.([0-9]{9})")

PIN_KEYS = {
    "staticEvaluatorSha256",
    "environmentSha256",
    "environmentSealSha256",
    "datasetManifestSha256",
    "parallelWorkerSha256",
    "baseWorkerSha256",
    "parallelTransportSha256",
    "hostAggregationSha256",
}
STATIC_EVIDENCE_KEYS = {
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
}
CHILD_SPEC_BODY_KEYS = {
    "schemaVersion",
    "contract",
    "verifierEpoch",
    "stageIdentity",
    "mode",
    "index",
    "seed",
    "effectiveTrainSteps",
    "candidateSha256",
}
STAGE_REQUEST_KEYS = {
    "schemaVersion",
    "contract",
    "verifierEpoch",
    "parallelAmendmentSha256",
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
    "v1Bridge",
    "priorStage",
    "children",
    "launch",
    "acceptance",
    "lossEncoding",
    "measurementEncoding",
    "pins",
    "requestDigest",
}
CHILD_REQUEST_KEYS = {
    "schemaVersion",
    "contract",
    "verifierEpoch",
    "parallelAmendmentSha256",
    "stageIdentity",
    "stageRequestDigest",
    "childSpec",
    "childSpecDigest",
    "candidatePatch",
    "staticEvidence",
    "launch",
    "lossEncoding",
    "measurementEncoding",
    "pins",
    "childRequestDigest",
}
RESULT_KEYS = {
    "schemaVersion",
    "contract",
    "ok",
    "verifierEpoch",
    "stageIdentity",
    "stageRequestDigest",
    "childRequestDigest",
    "childSpecDigest",
    "mode",
    "index",
    "seed",
    "candidateSha256",
    "effectiveTrainSteps",
    "validationLossDecimal",
    "validationLossNanounits",
    "optimizerSteps",
    "peakVramMb",
    "runtimeMs",
    "startedAt",
    "finishedAt",
    "observed",
    "execution",
    "sourceIntegrity",
    "pins",
    "failure",
}

LOSS_ENCODING = {
    "decimalPlaces": 9,
    "nanounitsPerUnit": 1_000_000_000,
    "rounding": "half-even",
    "thresholdDecimal": "3.278590000",
    "thresholdNanounits": 3_278_590_000,
}
MEASUREMENT_ENCODING = {
    "runtimeMsRounding": "half-even-to-nearest-integer",
    "peakVramMbRounding": "ceil-to-whole-MiB",
}
MODE_SPEC = {
    "smoke-10": {"trials": 1, "previous": None, "maxConcurrentChildren": 1},
    "score-3": {"trials": 3, "previous": "smoke-10", "maxConcurrentChildren": 3},
    "replay-8": {"trials": 8, "previous": "score-3", "maxConcurrentChildren": 4},
}


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
    return sha256_bytes(canonical_json(value).encode("utf-8"))


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
            raise WorkerFailure("contract", f"{label} contains an unpaired surrogate")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _validate_unicode_scalars(item, f"{label}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            _validate_unicode_scalars(key, f"{label} key")
            _validate_unicode_scalars(item, f"{label}.{key}")


def parse_json_bytes(value: bytes, label: str) -> dict[str, Any]:
    try:
        parsed = json.loads(
            value.decode("utf-8"),
            parse_constant=_reject_constant,
            object_pairs_hook=_object_without_duplicates,
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise WorkerFailure("contract", f"cannot parse {label}: {error}") from error
    _validate_unicode_scalars(parsed, label)
    return expect_record(parsed, label)


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
        raise WorkerFailure("asset", f"{label} exceeds {maximum_bytes} bytes")
    return value


def read_json_file(path: Path, label: str) -> tuple[bytes, dict[str, Any]]:
    source = read_file_bytes(path, label)
    return source, parse_json_bytes(source, label)


def expect_record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise WorkerFailure("contract", f"{label} must be an object")
    return value


def expect_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    observed = set(value)
    if observed != expected:
        raise WorkerFailure(
            "contract",
            f"{label} keys mismatch: missing={sorted(expected - observed)}, "
            f"extra={sorted(observed - expected)}",
        )


def expect_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
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


def expect_bool(value: object, expected: bool, label: str) -> None:
    if type(value) is not bool or value is not expected:
        raise WorkerFailure("contract", f"{label} must be {str(expected).lower()}")


def expect_timestamp(value: object, label: str) -> dt.datetime:
    timestamp = expect_string(value, label)
    if ISO_TIMESTAMP_PATTERN.fullmatch(timestamp) is None:
        raise WorkerFailure("worker", f"{label} must be a UTC ISO timestamp")
    try:
        parsed = dt.datetime.fromisoformat(timestamp[:-1] + "+00:00")
    except ValueError as error:
        raise WorkerFailure("worker", f"{label} must be a UTC ISO timestamp") from error
    if parsed.utcoffset() != dt.timedelta(0):
        raise WorkerFailure("worker", f"{label} must be a UTC ISO timestamp")
    return parsed


def verify_pins(value: object, label: str = "request.pins") -> dict[str, Any]:
    pins = expect_record(value, label)
    expect_exact_keys(pins, PIN_KEYS, label)
    for key, digest in pins.items():
        expect_sha256(digest, f"{label}.{key}")
    return pins


def verifier_epoch(pins: dict[str, Any]) -> str:
    return (
        "nanogpt-scored-parallel-v2-"
        + canonical_sha256(
            {
                "contract": CONTRACT,
                "parallelAmendmentSha256": PARALLEL_AMENDMENT_SHA256,
                "staticContract": STATIC_CONTRACT,
                "programSha256": PINNED_PROGRAM_SHA256,
                "speedrunCommit": PINNED_COMMIT,
                "seedSchedule": list(TRIAL_SEEDS),
                "lossEncoding": LOSS_ENCODING,
                "measurementEncoding": MEASUREMENT_ENCODING,
                "pins": pins,
            }
        )[:24]
    )


def stage_identity(request: dict[str, Any]) -> str:
    evidence = expect_record(request.get("staticEvidence"), "request.staticEvidence")
    artifact = expect_record(request.get("candidatePatch"), "request.candidatePatch")
    return canonical_sha256(
        {
            "contract": CONTRACT,
            "branchId": request.get("branchId"),
            "treatment": request.get("treatment"),
            "verifierEpoch": request.get("verifierEpoch"),
            "candidatePatchSha256": artifact.get("digest"),
            "candidateSha256": evidence.get("candidateSha256"),
        }
    )


def mode_seeds(mode: str) -> list[int]:
    spec = MODE_SPEC.get(mode)
    if spec is None:
        raise WorkerFailure("contract", "NanoGPT parallel mode changed")
    return list(TRIAL_SEEDS[: int(spec["trials"])])


def mode_benchmark_ids(mode: str) -> list[str]:
    return [
        f"nanogpt/track3/parallel-v2/{mode}/seed-{seed:x}" for seed in mode_seeds(mode)
    ]


def verify_artifact(value: object, label: str) -> dict[str, Any]:
    artifact = expect_record(value, label)
    expect_exact_keys(artifact, {"digest", "byteLength", "mediaType"}, label)
    expect_sha256(artifact.get("digest"), f"{label}.digest")
    if (
        artifact.get("mediaType") != "text/x-diff"
        or expect_integer(artifact.get("byteLength"), f"{label}.byteLength") < 1
    ):
        raise WorkerFailure("contract", f"{label} is not a nonempty diff artifact")
    return artifact


def verify_static_evidence(
    value: object, artifact: dict[str, Any], pins: dict[str, Any], label: str
) -> dict[str, Any]:
    evidence = expect_record(value, label)
    expect_exact_keys(evidence, STATIC_EVIDENCE_KEYS, label)
    train_steps = expect_integer(evidence.get("trainSteps"), f"{label}.trainSteps")
    if (
        evidence.get("contract") != STATIC_CONTRACT
        or evidence.get("repositoryCommit") != PINNED_COMMIT
        or evidence.get("programSha256") != PINNED_PROGRAM_SHA256
        or evidence.get("baselineSha256") != PINNED_BASELINE_SHA256
        or evidence.get("evaluatorSha256") != pins.get("staticEvaluatorSha256")
        or evidence.get("patchSha256") != artifact.get("digest")
        or not 1 <= train_steps <= BASELINE_TRAIN_STEPS
    ):
        raise WorkerFailure("contract", "NanoGPT parallel static evidence changed")
    for key in ("evaluatorSha256", "patchSha256", "candidateSha256"):
        expect_sha256(evidence.get(key), f"{label}.{key}")
    for key, length in (("frozenSegmentSha256", 4), ("editableSegmentSha256", 3)):
        values = evidence.get(key)
        if not isinstance(values, list) or len(values) != length:
            raise WorkerFailure("contract", f"{label}.{key} changed")
        for index, digest in enumerate(values):
            expect_sha256(digest, f"{label}.{key}[{index}]")
    return evidence


def child_spec_body(stage: dict[str, Any], index: int, seed: int) -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": CONTRACT,
        "verifierEpoch": stage["verifierEpoch"],
        "stageIdentity": stage["stageIdentity"],
        "mode": stage["mode"],
        "index": index,
        "seed": seed,
        "effectiveTrainSteps": stage["effectiveTrainSteps"],
        "candidateSha256": stage["staticEvidence"]["candidateSha256"],
    }


def verify_v1_bridge(value: object, stage: dict[str, Any]) -> dict[str, Any]:
    bridge = expect_record(value, "request.v1Bridge")
    expect_exact_keys(
        bridge,
        {
            "contract",
            "mode",
            "verifierEpoch",
            "stageIdentity",
            "requestDigest",
            "resultDigest",
            "receiptDigest",
            "candidateSha256",
            "trainSteps",
            "meanValidationLossExclusiveUpperBound",
            "accepted",
            "thresholdPassed",
            "numericMeasurementsReused",
        },
        "request.v1Bridge",
    )
    bound = bridge.get("meanValidationLossExclusiveUpperBound")
    if (
        bridge.get("contract") != V1_CONTRACT
        or bridge.get("mode") != "score-1"
        or V1_EPOCH_PATTERN.fullmatch(str(bridge.get("verifierEpoch"))) is None
        or bridge.get("candidateSha256") != stage["staticEvidence"]["candidateSha256"]
        or expect_integer(bridge.get("trainSteps"), "request.v1Bridge.trainSteps")
        != stage["staticEvidence"]["trainSteps"]
        or isinstance(bound, bool)
        or not isinstance(bound, (int, float))
        or not math.isfinite(float(bound))
        or float(bound) != MEAN_LOSS_EXCLUSIVE_UPPER_BOUND
    ):
        raise WorkerFailure("contract", "NanoGPT parallel v1 bridge changed")
    for key in (
        "stageIdentity",
        "requestDigest",
        "resultDigest",
        "receiptDigest",
        "candidateSha256",
    ):
        expect_sha256(bridge.get(key), f"request.v1Bridge.{key}")
    expect_bool(bridge.get("accepted"), True, "request.v1Bridge.accepted")
    expect_bool(bridge.get("thresholdPassed"), True, "request.v1Bridge.thresholdPassed")
    expect_bool(
        bridge.get("numericMeasurementsReused"),
        False,
        "request.v1Bridge.numericMeasurementsReused",
    )
    return bridge


def verify_prior_stage(value: object, stage: dict[str, Any]) -> None:
    prior = expect_record(value, "request.priorStage")
    expect_exact_keys(
        prior,
        {
            "mode",
            "stageIdentity",
            "requestDigest",
            "resultDigest",
            "receiptDigest",
            "accepted",
            "thresholdPassed",
            "fullExactSet",
            "numericMeasurementsReused",
            "v1BridgeDigest",
        },
        "request.priorStage",
    )
    expected_mode = MODE_SPEC[stage["mode"]]["previous"]
    expected_threshold = None if expected_mode == "smoke-10" else True
    expected_bridge_digest = (
        canonical_sha256(stage["v1Bridge"]) if expected_mode == "score-3" else None
    )
    if (
        prior.get("mode") != expected_mode
        or prior.get("stageIdentity") != stage["stageIdentity"]
        or prior.get("thresholdPassed") is not expected_threshold
        or prior.get("v1BridgeDigest") != expected_bridge_digest
    ):
        raise WorkerFailure("contract", "NanoGPT parallel prior stage changed")
    for key in ("stageIdentity", "requestDigest", "resultDigest", "receiptDigest"):
        expect_sha256(prior.get(key), f"request.priorStage.{key}")
    expect_bool(prior.get("accepted"), True, "request.priorStage.accepted")
    expect_bool(prior.get("fullExactSet"), True, "request.priorStage.fullExactSet")
    expect_bool(
        prior.get("numericMeasurementsReused"),
        False,
        "request.priorStage.numericMeasurementsReused",
    )


def verify_stage_request(stage: dict[str, Any]) -> None:
    _validate_unicode_scalars(stage, "request")
    expect_exact_keys(stage, STAGE_REQUEST_KEYS, "request")
    body = {key: value for key, value in stage.items() if key != "requestDigest"}
    if (
        expect_integer(stage.get("schemaVersion"), "request.schemaVersion")
        != SCHEMA_VERSION
        or stage.get("contract") != CONTRACT
        or stage.get("parallelAmendmentSha256") != PARALLEL_AMENDMENT_SHA256
        or stage.get("mode") not in MODE_SPEC
    ):
        raise WorkerFailure("contract", "NanoGPT parallel request identity changed")
    if canonical_sha256(body) != expect_sha256(
        stage.get("requestDigest"), "request.requestDigest"
    ):
        raise WorkerFailure("contract", "NanoGPT parallel request digest mismatch")
    pins = verify_pins(stage.get("pins"))
    if stage.get("verifierEpoch") != verifier_epoch(pins):
        raise WorkerFailure("contract", "NanoGPT parallel verifier epoch mismatch")
    for key in ("jobId", "branchId", "treatment"):
        expect_string(stage.get(key), f"request.{key}")
    expect_sha256(stage.get("manifestDigest"), "request.manifestDigest")
    artifact = verify_artifact(stage.get("candidatePatch"), "request.candidatePatch")
    evidence = verify_static_evidence(
        stage.get("staticEvidence"), artifact, pins, "request.staticEvidence"
    )
    if stage.get("stageIdentity") != stage_identity(stage):
        raise WorkerFailure("contract", "NanoGPT parallel stage identity mismatch")
    mode = str(stage["mode"])
    spec = MODE_SPEC[mode]
    seeds = mode_seeds(mode)
    effective_steps = 10 if mode == "smoke-10" else evidence["trainSteps"]
    expected_children = []
    for index, seed in enumerate(seeds):
        child = child_spec_body(stage, index, seed)
        expected_children.append({**child, "childSpecDigest": canonical_sha256(child)})
    if (
        expect_integer(stage.get("trials"), "request.trials") != spec["trials"]
        or stage.get("seeds") != seeds
        or stage.get("benchmarkIds") != mode_benchmark_ids(mode)
        or expect_integer(
            stage.get("effectiveTrainSteps"), "request.effectiveTrainSteps"
        )
        != effective_steps
        or stage.get("children") != expected_children
    ):
        raise WorkerFailure("contract", "NanoGPT parallel child or seed set changed")
    if mode == "smoke-10":
        if stage.get("v1Bridge") is not None or stage.get("priorStage") is not None:
            raise WorkerFailure("contract", "NanoGPT v2 smoke must be fresh")
    else:
        verify_v1_bridge(stage.get("v1Bridge"), stage)
        verify_prior_stage(stage.get("priorStage"), stage)
    launch = expect_record(stage.get("launch"), "request.launch")
    expect_exact_keys(
        launch,
        {
            "cluster",
            "gpu",
            "gpusPerChild",
            "worldSizePerChild",
            "maxConcurrentChildren",
            "noRequeue",
            "jobDirectory",
            "priorNumericMeasurementsReused",
        },
        "request.launch",
    )
    acceptance = expect_record(stage.get("acceptance"), "request.acceptance")
    expect_exact_keys(
        acceptance,
        {
            "thresholdNanounits",
            "comparison",
            "partialChildrenAccepted",
            "recordTrialCount",
            "recordRequiresStrictlyFewerStepsThan",
        },
        "request.acceptance",
    )
    expected_launch = {
        "cluster": "Stanford FarmShare",
        "gpu": "NVIDIA L40S",
        "gpusPerChild": 1,
        "worldSizePerChild": 1,
        "maxConcurrentChildren": spec["maxConcurrentChildren"],
        "noRequeue": True,
        "jobDirectory": "fresh-per-child",
        "priorNumericMeasurementsReused": False,
    }
    expected_acceptance = {
        "thresholdNanounits": 3_278_590_000,
        "comparison": "sum-loss-nanounits<trials*threshold-nanounits",
        "partialChildrenAccepted": False,
        "recordTrialCount": 8,
        "recordRequiresStrictlyFewerStepsThan": BASELINE_TRAIN_STEPS,
    }
    if (
        launch != expected_launch
        or acceptance != expected_acceptance
        or stage.get("lossEncoding") != LOSS_ENCODING
        or stage.get("measurementEncoding") != MEASUREMENT_ENCODING
    ):
        raise WorkerFailure(
            "contract", "NanoGPT parallel launch or loss policy changed"
        )


def verify_child_request(child: dict[str, Any], stage: dict[str, Any]) -> None:
    verify_stage_request(stage)
    _validate_unicode_scalars(child, "childRequest")
    expect_exact_keys(child, CHILD_REQUEST_KEYS, "childRequest")
    body = {key: value for key, value in child.items() if key != "childRequestDigest"}
    if canonical_sha256(body) != expect_sha256(
        child.get("childRequestDigest"), "childRequest.childRequestDigest"
    ):
        raise WorkerFailure("contract", "NanoGPT parallel child digest mismatch")
    spec = expect_record(child.get("childSpec"), "childRequest.childSpec")
    expect_exact_keys(spec, CHILD_SPEC_BODY_KEYS, "childRequest.childSpec")
    index = expect_integer(spec.get("index"), "childRequest.childSpec.index")
    expected = stage["children"][index] if 0 <= index < len(stage["children"]) else None
    digest = canonical_sha256(spec)
    if (
        child.get("schemaVersion") != SCHEMA_VERSION
        or child.get("contract") != CONTRACT
        or child.get("verifierEpoch") != stage["verifierEpoch"]
        or child.get("parallelAmendmentSha256") != PARALLEL_AMENDMENT_SHA256
        or child.get("stageIdentity") != stage["stageIdentity"]
        or child.get("stageRequestDigest") != stage["requestDigest"]
        or child.get("childSpecDigest") != digest
        or expected is None
        or expected != {**spec, "childSpecDigest": digest}
        or child.get("candidatePatch") != stage["candidatePatch"]
        or child.get("staticEvidence") != stage["staticEvidence"]
        or child.get("pins") != stage["pins"]
        or child.get("lossEncoding") != LOSS_ENCODING
        or child.get("measurementEncoding") != MEASUREMENT_ENCODING
    ):
        raise WorkerFailure("contract", "NanoGPT child is not bound to its stage")
    launch = expect_record(child.get("launch"), "childRequest.launch")
    expect_exact_keys(
        launch,
        {"cluster", "gpu", "gpus", "worldSize", "noRequeue", "jobDirectory"},
        "childRequest.launch",
    )
    if launch != {
        "cluster": "Stanford FarmShare",
        "gpu": "NVIDIA L40S",
        "gpus": 1,
        "worldSize": 1,
        "noRequeue": True,
        "jobDirectory": "fresh-per-child",
    }:
        raise WorkerFailure("contract", "NanoGPT child launch contract changed")


def load_requests(
    stage_path: Path, child_path: Path
) -> tuple[dict[str, Any], dict[str, Any]]:
    _, stage = read_json_file(stage_path, "stage request")
    _, child = read_json_file(child_path, "child request")
    verify_child_request(child, stage)
    return stage, child


def _normalize_direct_child(path: Path, root: Path, label: str) -> None:
    if not path.is_absolute() or path != Path(os.path.normpath(str(path))):
        raise WorkerFailure("contract", f"{label} must be an absolute normalized path")
    if path.parent != root:
        raise WorkerFailure(
            "contract", f"{label} must be a direct child of the job root"
        )


def validate_paths(args: argparse.Namespace) -> tuple[Path, Path]:
    root = args.stage_request.parent
    if (
        not root.is_absolute()
        or root != root.resolve()
        or root.is_symlink()
        or not root.is_dir()
        or Path.cwd().resolve() != root
    ):
        raise WorkerFailure(
            "contract", "worker must start in the normalized fresh job root"
        )
    expected_names = {
        "stage_request": "stage-request.json",
        "child_request": "child-request.json",
        "candidate_patch": "candidate.patch",
        "baseline": "train_gpt_simple.py",
        "static_evaluator": "nanogpt_contract.py",
        "base_worker": "base-worker.py",
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
                "contract", f"{attribute} must be named {expected_name}"
            )
        if attribute != "output":
            observed = regular_file(path, attribute.replace("_", " "))
            if (
                stat.S_IMODE(observed.st_mode) != 0o400
                or observed.st_uid != os.getuid()
            ):
                raise WorkerFailure(
                    "asset", f"{attribute} must be evaluator-owned mode 0400"
                )
    worker_path = Path(__file__).resolve()
    if worker_path != root / "worker.py":
        raise WorkerFailure("contract", "parallel worker must be staged as worker.py")
    worker_stat = regular_file(worker_path, "parallel worker")
    if stat.S_IMODE(worker_stat.st_mode) != 0o400 or worker_stat.st_uid != os.getuid():
        raise WorkerFailure(
            "asset", "parallel worker must be evaluator-owned mode 0400"
        )
    if args.trial_log_dir != root / "trial-logs":
        raise WorkerFailure(
            "contract", "trial log directory must be job-root/trial-logs"
        )
    runtime_root = root / "runtime-work"
    for path, label in (
        (args.output, "durable output"),
        (args.trial_log_dir, "trial log directory"),
        (runtime_root, "runtime work directory"),
    ):
        if os.path.lexists(path):
            raise WorkerFailure(
                "asset", f"{label} already exists; child job is not fresh"
            )
    return root, runtime_root


def load_base_worker(path: Path, pins: dict[str, Any]) -> dict[str, Any]:
    if sha256_file(Path(__file__).resolve()) != pins["parallelWorkerSha256"]:
        raise WorkerFailure("asset", "parallel worker hash does not match its pin")
    if sha256_file(path) != pins["baseWorkerSha256"]:
        raise WorkerFailure("asset", "base worker hash does not match its pin")
    try:
        base = runpy.run_path(str(path))
    except Exception as error:
        raise WorkerFailure(
            "asset", f"cannot load pinned base worker: {error}"
        ) from error
    constants = {
        "SCHEMA_VERSION": 1,
        "CONTRACT": V1_CONTRACT,
        "CAMPAIGN_AMENDMENT_SHA256": V1_CAMPAIGN_AMENDMENT_SHA256,
        "STATIC_CONTRACT": STATIC_CONTRACT,
        "PINNED_COMMIT": PINNED_COMMIT,
        "PINNED_PROGRAM_SHA256": PINNED_PROGRAM_SHA256,
        "PINNED_BASELINE_SHA256": PINNED_BASELINE_SHA256,
        "BASELINE_TRAIN_STEPS": BASELINE_TRAIN_STEPS,
        "TRIAL_SEEDS": TRIAL_SEEDS,
    }
    if any(base.get(name) != value for name, value in constants.items()):
        raise WorkerFailure("asset", "base worker contract constants changed")
    callables = (
        "load_static_contract",
        "read_file_bytes",
        "sha256_bytes",
        "sha256_text",
        "apply_and_validate_candidate",
        "validate_static_evidence",
        "validate_environment_manifest",
        "validate_environment_seal",
        "validate_live_environment",
        "validate_dataset",
        "validate_launch_and_probe_hardware",
        "run_trial",
    )
    if any(not callable(base.get(name)) for name in callables):
        raise WorkerFailure("asset", "base worker interface changed")
    if pins["environmentSha256"] != base.get(
        "EXPECTED_ENVIRONMENT_MANIFEST_SHA256"
    ) or pins["environmentSealSha256"] != base.get("EXPECTED_ENVIRONMENT_SEAL_SHA256"):
        raise WorkerFailure(
            "environment", "parallel request changed the sealed environment"
        )
    return base


def validate_candidate_assets(
    base: dict[str, Any], args: argparse.Namespace, child: dict[str, Any]
) -> tuple[dict[str, Any], str, str, str]:
    pins = child["pins"]
    static_contract = base["load_static_contract"](
        args.static_evaluator, pins["staticEvaluatorSha256"]
    )
    baseline_bytes = base["read_file_bytes"](
        args.baseline, "baseline fixture", MAX_SOURCE_BYTES
    )
    if base["sha256_bytes"](baseline_bytes) != PINNED_BASELINE_SHA256:
        raise WorkerFailure("asset", "baseline fixture changed")
    patch_bytes = base["read_file_bytes"](
        args.candidate_patch, "candidate patch", MAX_PATCH_BYTES
    )
    artifact = child["candidatePatch"]
    if (
        len(patch_bytes) != artifact["byteLength"]
        or base["sha256_bytes"](patch_bytes) != artifact["digest"]
    ):
        raise WorkerFailure("asset", "candidate patch bytes do not match the request")
    try:
        baseline = baseline_bytes.decode("utf-8")
        patch = patch_bytes.decode("utf-8")
    except UnicodeError as error:
        raise WorkerFailure(
            "asset", f"candidate inputs must be UTF-8: {error}"
        ) from error
    candidate, validation = base["apply_and_validate_candidate"](
        static_contract, baseline, patch, artifact["digest"]
    )
    base["validate_static_evidence"](validation, child)
    if base["sha256_text"](candidate) != child["staticEvidence"]["candidateSha256"]:
        raise WorkerFailure(
            "gate", "patched candidate hash does not match static evidence"
        )
    return static_contract, baseline, patch, candidate


def runtime_request(child: dict[str, Any]) -> dict[str, Any]:
    spec = child["childSpec"]
    return {
        "requestDigest": child["childRequestDigest"],
        "mode": spec["mode"],
        "candidatePatch": child["candidatePatch"],
        "staticEvidence": child["staticEvidence"],
        "seeds": list(TRIAL_SEEDS),
        "effectiveTrainSteps": spec["effectiveTrainSteps"],
    }


def encode_loss(value: object) -> tuple[str, int]:
    if isinstance(value, bool):
        raise WorkerFailure("worker", "validation loss must be numeric")
    try:
        decimal = Decimal(str(value))
        quantized = decimal.quantize(Decimal("0.000000001"), rounding=ROUND_HALF_EVEN)
    except (InvalidOperation, ValueError) as error:
        raise WorkerFailure("worker", "validation loss is not finite") from error
    if not quantized.is_finite() or quantized <= 0:
        raise WorkerFailure("worker", "validation loss must be positive and finite")
    text = format(quantized, ".9f")
    nanounits = int(quantized * LOSS_ENCODING["nanounitsPerUnit"])
    if nanounits < 1 or nanounits > MAX_SAFE_INTEGER:
        raise WorkerFailure("worker", "validation loss is outside the exact range")
    return text, nanounits


def integer_measurement(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WorkerFailure("worker", f"{label} must be numeric")
    try:
        decimal = Decimal(str(value))
        rounded_decimal = decimal.quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
    except (InvalidOperation, ValueError) as error:
        raise WorkerFailure("worker", f"{label} must be finite") from error
    if not decimal.is_finite() or decimal < 0:
        raise WorkerFailure("worker", f"{label} must be nonnegative and finite")
    rounded = int(rounded_decimal)
    if rounded > MAX_SAFE_INTEGER:
        raise WorkerFailure("worker", f"{label} exceeds the safe integer range")
    return rounded


def peak_vram_measurement(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WorkerFailure("worker", "peak VRAM must be numeric")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise WorkerFailure("worker", "peak VRAM must be nonnegative and finite")
    rounded = math.ceil(number)
    if rounded > MAX_SAFE_INTEGER:
        raise WorkerFailure("worker", "peak VRAM exceeds the safe integer range")
    return rounded


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


def publish_child_log(
    args: argparse.Namespace,
    runtime_root: Path,
    index: int,
    failure: Optional[dict[str, str]],
) -> tuple[str, int, str]:
    remote_name = f"trial-{index:03d}.log"
    destination = args.trial_log_dir / remote_name
    source = runtime_root / remote_name
    if source.exists():
        content = read_file_bytes(source, "base worker child log", MAX_LOG_BYTES)
    else:
        if failure is None:
            raise WorkerFailure("worker", "successful child did not produce its log")
        content = (canonical_json({"failure": failure}) + "\n").encode("utf-8")
    if len(content) > MAX_LOG_BYTES:
        raise WorkerFailure("worker", "child log exceeds its byte bound")
    _write_immutable(destination, content)
    return remote_name, len(content), sha256_bytes(content)


def normalize_failure(error: BaseException) -> dict[str, str]:
    kind = getattr(error, "kind", "worker")
    if not isinstance(kind, str) or not kind:
        kind = "worker"
    message = str(error) or type(error).__name__
    return {"kind": kind, "message": message}


def build_result(
    child: dict[str, Any],
    *,
    ok: bool,
    trial: Optional[dict[str, object]],
    started_at: str,
    finished_at: str,
    runtime_ms: int,
    slurm_job_id: str,
    gpu_uuid: str,
    log: tuple[str, int, str],
    failure: Optional[dict[str, str]],
) -> dict[str, object]:
    spec = child["childSpec"]
    loss_decimal: Optional[str] = None
    loss_nanounits: Optional[int] = None
    optimizer_steps: Optional[int] = None
    peak_vram_mb: Optional[int] = None
    if ok:
        if trial is None:
            raise WorkerFailure("worker", "successful child is missing its measurement")
        if trial.get("index") != spec["index"] or trial.get("seed") != spec["seed"]:
            raise WorkerFailure(
                "worker", "base worker returned the wrong child measurement"
            )
        loss_decimal, loss_nanounits = encode_loss(trial["finalValidationLoss"])
        optimizer_steps = expect_integer(trial["optimizerSteps"], "optimizer steps")
        peak_vram_mb = peak_vram_measurement(trial["peakVramMb"])
    remote_name, byte_length, log_sha256 = log
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": CONTRACT,
        "ok": ok,
        "verifierEpoch": child["verifierEpoch"],
        "stageIdentity": child["stageIdentity"],
        "stageRequestDigest": child["stageRequestDigest"],
        "childRequestDigest": child["childRequestDigest"],
        "childSpecDigest": child["childSpecDigest"],
        "mode": spec["mode"],
        "index": spec["index"],
        "seed": spec["seed"],
        "candidateSha256": spec["candidateSha256"],
        "effectiveTrainSteps": spec["effectiveTrainSteps"],
        "validationLossDecimal": loss_decimal,
        "validationLossNanounits": loss_nanounits,
        "optimizerSteps": optimizer_steps,
        "peakVramMb": peak_vram_mb,
        "runtimeMs": runtime_ms,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "observed": {
            "slurmJobId": slurm_job_id,
            "hardware": {
                "cluster": "Stanford FarmShare",
                "gpu": "NVIDIA L40S",
                "gpuUuid": gpu_uuid,
                "gpus": 1,
                "worldSize": 1,
            },
            "log": {
                "remoteName": remote_name,
                "byteLength": byte_length,
                "sha256": log_sha256,
            },
        },
        "execution": {
            "cleanJobDirectory": True,
            "freshCandidateMaterialization": True,
            "priorMeasurementsReused": False,
        },
        "sourceIntegrity": {
            "preRunCandidateSha256": spec["candidateSha256"],
            "postRunCandidateSha256": spec["candidateSha256"],
        },
        "pins": child["pins"],
        "failure": failure,
    }


def validate_result(
    result: dict[str, Any],
    child: dict[str, Any],
    stage: dict[str, Any],
    trial_log_dir: Path,
) -> None:
    verify_child_request(child, stage)
    expect_exact_keys(result, RESULT_KEYS, "childWorkerResult")
    if type(result.get("ok")) is not bool:
        raise WorkerFailure("worker", "childWorkerResult.ok must be Boolean")
    started = expect_timestamp(result.get("startedAt"), "childWorkerResult.startedAt")
    finished = expect_timestamp(
        result.get("finishedAt"), "childWorkerResult.finishedAt"
    )
    if finished < started:
        raise WorkerFailure("worker", "child worker timestamps are out of order")
    runtime_ms = expect_integer(result.get("runtimeMs"), "childWorkerResult.runtimeMs")
    if runtime_ms < 0:
        raise WorkerFailure("worker", "child worker runtime is negative")
    spec = child["childSpec"]
    fixed = {
        "schemaVersion": SCHEMA_VERSION,
        "contract": CONTRACT,
        "verifierEpoch": child["verifierEpoch"],
        "stageIdentity": child["stageIdentity"],
        "stageRequestDigest": stage["requestDigest"],
        "childRequestDigest": child["childRequestDigest"],
        "childSpecDigest": child["childSpecDigest"],
        "mode": spec["mode"],
        "index": spec["index"],
        "seed": spec["seed"],
        "candidateSha256": spec["candidateSha256"],
        "effectiveTrainSteps": spec["effectiveTrainSteps"],
        "pins": child["pins"],
    }
    for key, expected in fixed.items():
        if result.get(key) != expected:
            raise WorkerFailure(
                "worker", f"childWorkerResult.{key} is not request-bound"
            )
    observed = expect_record(result.get("observed"), "childWorkerResult.observed")
    expect_exact_keys(
        observed, {"slurmJobId", "hardware", "log"}, "childWorkerResult.observed"
    )
    if (
        re.fullmatch(r"\d+", expect_string(observed.get("slurmJobId"), "slurmJobId"))
        is None
    ):
        raise WorkerFailure("worker", "observed SLURM job ID must be numeric")
    hardware = expect_record(
        observed.get("hardware"), "childWorkerResult.observed.hardware"
    )
    expect_exact_keys(
        hardware, {"cluster", "gpu", "gpuUuid", "gpus", "worldSize"}, "hardware"
    )
    if hardware != {
        "cluster": "Stanford FarmShare",
        "gpu": "NVIDIA L40S",
        "gpuUuid": expect_string(hardware.get("gpuUuid"), "hardware.gpuUuid"),
        "gpus": 1,
        "worldSize": 1,
    }:
        raise WorkerFailure("worker", "child hardware evidence changed")
    log = expect_record(observed.get("log"), "childWorkerResult.observed.log")
    expect_exact_keys(log, {"remoteName", "byteLength", "sha256"}, "observed.log")
    remote_name = expect_string(log.get("remoteName"), "observed.log.remoteName")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", remote_name) is None or any(
        part in {"", ".", ".."} for part in remote_name.split("/")
    ):
        raise WorkerFailure("worker", "child log name is unsafe")
    log_path = trial_log_dir.joinpath(*remote_name.split("/"))
    content = read_file_bytes(log_path, "published child log", MAX_LOG_BYTES)
    if expect_integer(log.get("byteLength"), "observed.log.byteLength") != len(
        content
    ) or expect_sha256(log.get("sha256"), "observed.log.sha256") != sha256_bytes(
        content
    ):
        raise WorkerFailure("worker", "published child log evidence changed")
    execution = expect_record(result.get("execution"), "childWorkerResult.execution")
    expect_exact_keys(
        execution,
        {
            "cleanJobDirectory",
            "freshCandidateMaterialization",
            "priorMeasurementsReused",
        },
        "execution",
    )
    if execution != {
        "cleanJobDirectory": True,
        "freshCandidateMaterialization": True,
        "priorMeasurementsReused": False,
    }:
        raise WorkerFailure("worker", "child execution evidence changed")
    source = expect_record(
        result.get("sourceIntegrity"), "childWorkerResult.sourceIntegrity"
    )
    expect_exact_keys(
        source, {"preRunCandidateSha256", "postRunCandidateSha256"}, "sourceIntegrity"
    )
    if source != {
        "preRunCandidateSha256": spec["candidateSha256"],
        "postRunCandidateSha256": spec["candidateSha256"],
    }:
        raise WorkerFailure("worker", "child source integrity changed")
    verify_pins(result.get("pins"), "childWorkerResult.pins")
    loss_decimal = result.get("validationLossDecimal")
    loss_nanounits = result.get("validationLossNanounits")
    optimizer_steps = result.get("optimizerSteps")
    peak_vram_mb = result.get("peakVramMb")
    failure = result.get("failure")
    if result["ok"]:
        if (
            not isinstance(loss_decimal, str)
            or LOSS_DECIMAL_PATTERN.fullmatch(loss_decimal) is None
        ):
            raise WorkerFailure("worker", "successful loss must have nine decimals")
        encoded = int(loss_decimal.split(".")[0]) * 1_000_000_000 + int(
            loss_decimal.split(".")[1]
        )
        if (
            expect_integer(loss_nanounits, "validationLossNanounits") != encoded
            or encoded < 1
            or expect_integer(optimizer_steps, "optimizerSteps")
            != spec["effectiveTrainSteps"]
            or expect_integer(peak_vram_mb, "peakVramMb") < 0
            or failure is not None
        ):
            raise WorkerFailure("worker", "successful child result is incomplete")
    else:
        if (
            loss_decimal is not None
            or loss_nanounits is not None
            or optimizer_steps is not None
            or peak_vram_mb is not None
        ):
            raise WorkerFailure(
                "worker", "failed child result must not claim measurements"
            )
        failure_record = expect_record(failure, "childWorkerResult.failure")
        expect_exact_keys(
            failure_record, {"kind", "message"}, "childWorkerResult.failure"
        )
        expect_string(failure_record.get("kind"), "childWorkerResult.failure.kind")
        expect_string(
            failure_record.get("message"), "childWorkerResult.failure.message"
        )


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
    started_clock = time.perf_counter()
    _, runtime_root = validate_paths(args)
    stage, child = load_requests(args.stage_request, args.child_request)
    pins = child["pins"]
    base = load_base_worker(args.base_worker, pins)
    static_contract, baseline, patch, candidate = validate_candidate_assets(
        base, args, child
    )
    candidate_sha256 = base["sha256_text"](candidate)
    if candidate_sha256 != child["childSpec"]["candidateSha256"]:
        raise WorkerFailure("gate", "candidate does not match the selected child")
    slurm_job_id, gpu_uuid = base["validate_launch_and_probe_hardware"]()
    runtime_root.mkdir(mode=0o700, exist_ok=False)
    args.trial_log_dir.mkdir(mode=0o700, exist_ok=False)

    trial: Optional[dict[str, object]] = None
    stage_error: Optional[Exception] = None
    environment_manifest: Optional[dict[str, Any]] = None
    environment_seal: Optional[dict[str, Any]] = None
    dataset_validated = False
    runtime_args = argparse.Namespace(
        trial_log_dir=runtime_root,
        dataset_root=args.dataset_root,
    )
    try:
        environment_manifest = base["validate_environment_manifest"](
            args.environment_manifest, pins["environmentSha256"]
        )
        environment_seal = base["validate_environment_seal"](
            args.environment_seal,
            pins["environmentSealSha256"],
            pins["environmentSha256"],
        )
        base["validate_live_environment"](environment_manifest, environment_seal)
        base["validate_dataset"](
            args.dataset_manifest,
            args.dataset_root,
            pins["datasetManifestSha256"],
            child["childSpec"]["effectiveTrainSteps"],
        )
        dataset_validated = True
        trial = base["run_trial"](
            runtime_args,
            static_contract,
            baseline,
            patch,
            runtime_request(child),
            child["childSpec"]["index"],
            environment_manifest,
        )
    except Exception as error:
        stage_error = error

    try:
        _, _, _, post_candidate = validate_candidate_assets(base, args, child)
        if base["sha256_text"](post_candidate) != candidate_sha256:
            raise WorkerFailure(
                "integrity", "candidate assets changed during the child run"
            )
        post_stage, post_child = load_requests(args.stage_request, args.child_request)
        if post_stage != stage or post_child != child:
            raise WorkerFailure(
                "integrity", "request assets changed during the child run"
            )
        if sha256_file(Path(__file__).resolve()) != pins["parallelWorkerSha256"]:
            raise WorkerFailure(
                "integrity", "parallel worker changed during the child run"
            )
        if sha256_file(args.base_worker) != pins["baseWorkerSha256"]:
            raise WorkerFailure("integrity", "base worker changed during the child run")
        if environment_manifest is not None and environment_seal is not None:
            post_manifest = base["validate_environment_manifest"](
                args.environment_manifest, pins["environmentSha256"]
            )
            post_seal = base["validate_environment_seal"](
                args.environment_seal,
                pins["environmentSealSha256"],
                pins["environmentSha256"],
            )
            if post_manifest != environment_manifest or post_seal != environment_seal:
                raise WorkerFailure("integrity", "environment evidence changed")
            base["validate_live_environment"](post_manifest, post_seal)
        if dataset_validated:
            base["validate_dataset"](
                args.dataset_manifest,
                args.dataset_root,
                pins["datasetManifestSha256"],
                child["childSpec"]["effectiveTrainSteps"],
            )
        post_slurm_job_id, post_gpu_uuid = base["validate_launch_and_probe_hardware"]()
        if post_slurm_job_id != slurm_job_id or post_gpu_uuid != gpu_uuid:
            raise WorkerFailure("integrity", "SLURM or GPU identity changed")
    except Exception as error:
        stage_error = error

    failure = normalize_failure(stage_error) if stage_error is not None else None
    ok = failure is None
    if stage_error is not None:
        traceback.print_exception(stage_error, file=os.sys.stderr)
    log = publish_child_log(
        args,
        runtime_root,
        child["childSpec"]["index"],
        failure,
    )
    finished_at = utc_now()
    runtime_ms = integer_measurement(
        (time.perf_counter() - started_clock) * 1000,
        "child runtime",
    )
    result = build_result(
        child,
        ok=ok,
        trial=trial,
        started_at=started_at,
        finished_at=finished_at,
        runtime_ms=runtime_ms,
        slurm_job_id=slurm_job_id,
        gpu_uuid=gpu_uuid,
        log=log,
        failure=failure,
    )
    validate_result(result, child, stage, args.trial_log_dir)
    durable_create_json(args.output, result)
    print(
        canonical_json(
            {
                "ok": result["ok"],
                "output": str(args.output),
                "childRequestDigest": result["childRequestDigest"],
            }
        )
    )
    return result, 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-request", required=True, type=Path)
    parser.add_argument("--child-request", required=True, type=Path)
    parser.add_argument("--candidate-patch", required=True, type=Path)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--static-evaluator", required=True, type=Path)
    parser.add_argument("--base-worker", required=True, type=Path)
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

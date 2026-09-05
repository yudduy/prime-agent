#!/usr/bin/env python3
"""Materialize and verify the deterministic stock-only NanoGPT CUDA smoke."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from typing import Optional, Sequence

import nanogpt_contract as static_contract


SCHEMA_VERSION = 1
RUNTIME_CONTRACT_ID = "nanogpt-track3-runtime-contract-v2"
RUNTIME_CANDIDATE_NAME = "candidate.source.py"
RUNTIME_PROGRAM_NAME = "train_gpt_runtime.py"
RUNTIME_MANIFEST_NAME = "runtime-manifest.json"
SMOKE_MODE = "cuda-smoke-10"
SMOKE_STEPS = 10
STOCK_DECLARED_TRAIN_STEPS = 3290
STOCK_TRIALS = 1
TRIAL_SEED_BASE = 0xC0FFEE
STOCK_CANDIDATE_POLICY = "byte-exact-pinned-stock-fixture-only"
STOCK_SMOKE_CLAIM_SCOPE = (
    "Only the byte-exact pinned stock fixture may be claimed to have compiled and completed "
    "10 training steps in cuda-smoke-10 mode with seed 0xC0FFEE; no candidate-quality, "
    "score, or record claim is permitted."
)
RUNTIME_RESERVED_PREFIX = "_prime_nanogpt_runtime_"
RUNTIME_MARKER_PREFIX = "PRIME_NANOGPT_RUNTIME_"

LOGFILE_ANCHOR = '    logfile = f"logs/{uuid.uuid4()}.txt"\n'
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


class RuntimeContractError(ValueError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_exact_utf8(path: Path, maximum_bytes: int) -> tuple[bytes, str]:
    value = path.read_bytes()
    if len(value) > maximum_bytes:
        raise RuntimeContractError(f"{path.name} is {len(value)} bytes; limit is {maximum_bytes}")
    return value, value.decode("utf-8")


def runtime_evaluator_sha256() -> str:
    return sha256_file(Path(__file__).resolve())


def baseline_fixture() -> Path:
    return Path(__file__).resolve().parents[1] / "fixtures" / "nanogpt" / "train_gpt_simple.py"


def _replace_once(source: str, anchor: str, replacement: str, label: str) -> str:
    count = source.count(anchor)
    if count != 1:
        raise RuntimeContractError(f"expected exactly one intact {label} anchor, found {count}")
    return source.replace(anchor, replacement, 1)


def _train_steps_end_line(source: str) -> int:
    tree = ast.parse(source, filename=RUNTIME_CANDIDATE_NAME)
    assignments: list[ast.Assign] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name) and target.id == "train_steps":
            assignments.append(node)
    if len(assignments) != 1:
        raise RuntimeContractError("validated candidate no longer has exactly one train_steps assignment")
    end_line = assignments[0].end_lineno
    if not isinstance(end_line, int):
        raise RuntimeContractError("train_steps assignment has no stable source boundary")
    return end_line


def instrument_candidate(
    candidate: str,
    *,
    candidate_sha256: str,
) -> str:
    if RUNTIME_RESERVED_PREFIX in candidate or RUNTIME_MARKER_PREFIX in candidate:
        raise RuntimeContractError("candidate contains an evaluator-reserved runtime identifier")
    pinned_bytes, pinned_stock = read_exact_utf8(
        baseline_fixture(), static_contract.MAX_SOURCE_BYTES
    )
    if (
        candidate != pinned_stock
        or candidate_sha256 != static_contract.PINNED_BASELINE_SHA256
        or sha256_bytes(pinned_bytes) != static_contract.PINNED_BASELINE_SHA256
    ):
        raise RuntimeContractError("runtime instrumentation accepts only the byte-exact pinned stock fixture")
    lines = candidate.splitlines(keepends=True)
    train_steps_end_line = _train_steps_end_line(candidate)
    if train_steps_end_line < 1 or train_steps_end_line > len(lines):
        raise RuntimeContractError("train_steps assignment source boundary is invalid")

    initialization = [
        f"    {RUNTIME_RESERVED_PREFIX}declared_train_steps = train_steps\n",
        f"    train_steps = {SMOKE_STEPS}\n",
        f"    {RUNTIME_RESERVED_PREFIX}optimizer_steps = 0\n",
        f"    {RUNTIME_RESERVED_PREFIX}backward_calls = 0\n",
        "    torch.cuda.reset_peak_memory_stats()\n",
        "    print0(\n",
        f'        f"{RUNTIME_MARKER_PREFIX}CONTRACT|contract={RUNTIME_CONTRACT_ID}'
        f"|candidate_sha256={candidate_sha256}|mode={SMOKE_MODE}"
        f'|trial={{trial_idx}}|seed={{seed}}|declared_train_steps={{{RUNTIME_RESERVED_PREFIX}declared_train_steps}}'
        f'|effective_train_steps={{train_steps}}",\n',
        "        console=True,\n",
        "    )\n",
    ]
    lines[train_steps_end_line:train_steps_end_line] = initialization
    runtime_source = "".join(lines)

    runtime_source = _replace_once(
        runtime_source,
        LOGFILE_ANCHOR,
        '    logfile = "logs/nanogpt-runtime.log"\n',
        "runtime log",
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
        f"        {RUNTIME_RESERVED_PREFIX}optimizer_steps += 1\n" + OPTIMIZER_STEP_ANCHOR,
        "optimizer step",
    )

    result_instrumentation = (
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
        f'        f"{RUNTIME_MARKER_PREFIX}RESULT|trial={{trial_idx}}|seed={{seed}}'
        f'|declared_train_steps={{{RUNTIME_RESERVED_PREFIX}declared_train_steps}}'
        "|effective_train_steps={train_steps}|final_val_loss={val_loss.item():.9f}"
        f'|optimizer_steps={{{RUNTIME_RESERVED_PREFIX}optimizer_steps}}'
        f'|backward_calls={{{RUNTIME_RESERVED_PREFIX}backward_calls}}'
        '|peak_vram_mb={torch.cuda.max_memory_allocated() / 1048576:.3f}",\n'
        "        console=True,\n"
        "    )\n"
    )
    runtime_source = _replace_once(
        runtime_source,
        TRIAL_RESULT_ANCHOR,
        result_instrumentation + TRIAL_RESULT_ANCHOR,
        "trial result",
    )
    completion = (
        f'\nprint0(f"{RUNTIME_MARKER_PREFIX}COMPLETE|trials={{num_trials}}", console=True)\n'
        "dist.destroy_process_group()\n"
    )
    runtime_source = _replace_once(
        runtime_source,
        COMPLETE_ANCHOR,
        completion,
        "runtime completion",
    )
    compile(runtime_source, RUNTIME_PROGRAM_NAME, "exec")
    return runtime_source


def _read_candidate(args: argparse.Namespace) -> tuple[str, str, Optional[str], dict[str, object]]:
    if args.patch is not None:
        raise RuntimeContractError("the stock-only runtime epoch does not accept patch inputs")
    pinned_bytes, pinned_stock = read_exact_utf8(
        baseline_fixture(), static_contract.MAX_SOURCE_BYTES
    )
    if sha256_bytes(pinned_bytes) != static_contract.PINNED_BASELINE_SHA256:
        raise RuntimeContractError("the evaluator-owned stock fixture does not match its pinned SHA-256")
    baseline_bytes, baseline = read_exact_utf8(
        args.baseline or baseline_fixture(), static_contract.MAX_SOURCE_BYTES
    )
    if baseline_bytes != pinned_bytes:
        raise RuntimeContractError("runtime baseline must be the byte-exact pinned stock fixture")
    candidate_bytes, candidate = read_exact_utf8(args.candidate, static_contract.MAX_SOURCE_BYTES)
    if candidate_bytes != pinned_bytes:
        raise RuntimeContractError("runtime candidate must be the byte-exact pinned stock fixture")
    validation = static_contract.validate_candidate(
        baseline,
        candidate,
        allow_baseline_steps=True,
        patch_sha256=None,
    )
    if not validation["ok"]:
        errors = validation.get("errors", [])
        summary = "; ".join(
            f"{error.get('code', 'UNKNOWN')}: {error.get('message', '')}"
            for error in errors
            if isinstance(error, dict)
        )
        raise RuntimeContractError(f"candidate failed the static contract: {summary}")
    train_steps = validation.get("trainSteps")
    if train_steps != STOCK_DECLARED_TRAIN_STEPS:
        raise RuntimeContractError("stock validation did not rederive the fixed 3290 declared steps")
    if validation.get("candidateSha256") != static_contract.PINNED_BASELINE_SHA256:
        raise RuntimeContractError("stock validation did not rederive the pinned candidate SHA-256")
    return baseline, candidate, None, validation


def _validate_mode(mode: str, trials: int) -> None:
    if mode != SMOKE_MODE:
        raise RuntimeContractError(
            f"the stock-only runtime epoch supports only {SMOKE_MODE}, not {mode}"
        )
    if trials != STOCK_TRIALS:
        raise RuntimeContractError("the stock-only 10-step CUDA smoke must run exactly one trial")


def _manifest(
    candidate: str,
    runtime_source: str,
    validation: dict[str, object],
    *,
    mode: str,
    trials: int,
) -> dict[str, object]:
    declared_train_steps = validation["trainSteps"]
    if declared_train_steps != STOCK_DECLARED_TRAIN_STEPS:
        raise RuntimeContractError("validated stock train_steps is not the fixed 3290")
    _validate_mode(mode, trials)
    candidate_sha256 = sha256_text(candidate)
    if candidate_sha256 != static_contract.PINNED_BASELINE_SHA256:
        raise RuntimeContractError("manifest candidate is not the pinned stock source")
    if validation.get("patchSha256") is not None:
        raise RuntimeContractError("stock-only source integrity cannot include a patch")
    runtime_sha256 = sha256_text(runtime_source)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": RUNTIME_CONTRACT_ID,
        "repository": static_contract.PINNED_REPOSITORY,
        "commit": static_contract.PINNED_COMMIT,
        "programSha256": static_contract.PINNED_PROGRAM_SHA256,
        "staticContract": static_contract.CONTRACT_ID,
        "mode": mode,
        "declaredTrainSteps": declared_train_steps,
        "effectiveTrainSteps": SMOKE_STEPS,
        "expectedTrials": trials,
        "expectedSeeds": [TRIAL_SEED_BASE],
        "claimScope": STOCK_SMOKE_CLAIM_SCOPE,
        "candidate": {
            "path": RUNTIME_CANDIDATE_NAME,
            "sha256": candidate_sha256,
        },
        "runtime": {
            "path": RUNTIME_PROGRAM_NAME,
            "sha256": runtime_sha256,
        },
        "evaluators": {
            "staticSha256": validation["evaluatorSha256"],
            "runtimeSha256": runtime_evaluator_sha256(),
        },
        "sourceIntegrity": {
            "baselineSha256": validation["baselineSha256"],
            "patchSha256": validation["patchSha256"],
            "frozenSegmentSha256": validation["frozenSegmentSha256"],
            "editableSegmentSha256": validation["editableSegmentSha256"],
        },
        "launch": {
            "executable": "torchrun",
            "args": [
                "--standalone",
                "--nnodes=1",
                "--nproc-per-node=1",
                RUNTIME_PROGRAM_NAME,
                str(trials),
            ],
            "worldSize": 1,
            "gpus": 1,
            "cwdPolicy": "fresh-job-directory",
            "runtimeLog": "logs/nanogpt-runtime.log",
            "requiredDataGlobs": [
                "data/fineweb10B/fineweb_val_*.bin",
                "data/fineweb10B/fineweb_train_*.bin",
            ],
            "forbiddenEnvironment": ["WANDB_API_KEY", "WANDB_MODE", "WANDB_ENTITY"],
        },
        "acceptance": {
            "candidatePolicy": STOCK_CANDIDATE_POLICY,
            "requiredMode": SMOKE_MODE,
            "requiredTrials": STOCK_TRIALS,
            "requiredSeed": TRIAL_SEED_BASE,
            "requiredDeclaredTrainSteps": STOCK_DECLARED_TRAIN_STEPS,
            "requiredEffectiveTrainSteps": SMOKE_STEPS,
            "scoredEligible": False,
            "recordEligible": False,
            "partialCurvesAccepted": False,
        },
        "externalPrerequisites": [
            "A frozen CUDA/PyTorch environment manifest must be verified before launch.",
            "Every FineWeb shard must match an evaluator-owned content manifest before launch.",
            "The worker must stage this bundle in a fresh directory and reject forbidden W&B environment variables.",
        ],
    }


def _write_bundle(output: Path, candidate: str, runtime_source: str, manifest: dict[str, object]) -> None:
    if os.path.lexists(output):
        raise RuntimeContractError(f"output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        os.chmod(temporary, 0o700)
        candidate_path = temporary / RUNTIME_CANDIDATE_NAME
        runtime_path = temporary / RUNTIME_PROGRAM_NAME
        manifest_path = temporary / RUNTIME_MANIFEST_NAME
        candidate_path.write_text(candidate, encoding="utf-8")
        runtime_path.write_text(runtime_source, encoding="utf-8")
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        for path in (candidate_path, runtime_path, manifest_path):
            os.chmod(path, 0o444)
        temporary.rename(output)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def _regular_file(path: Path, label: str) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise RuntimeContractError(f"cannot inspect {label}: {error}") from error
    if not stat.S_ISREG(mode) or path.is_symlink():
        raise RuntimeContractError(f"{label} must be a regular non-symlink file")


def _expect_exact_keys(value: dict[str, object], expected: set[str], label: str) -> None:
    observed = set(value)
    if observed != expected:
        raise RuntimeContractError(
            f"{label} keys mismatch: missing={sorted(expected - observed)}, extra={sorted(observed - expected)}"
        )


def _expect_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise RuntimeContractError(f"{label} must be a lowercase SHA-256")
    return value


def _load_manifest(bundle: Path) -> dict[str, object]:
    manifest_path = bundle / RUNTIME_MANIFEST_NAME
    _regular_file(manifest_path, "runtime manifest")
    try:
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeContractError(f"runtime manifest is invalid: {error}") from error
    if not isinstance(value, dict):
        raise RuntimeContractError("runtime manifest must be an object")
    return value


def verify_bundle(bundle: Path) -> tuple[dict[str, object], str, str]:
    if bundle.is_symlink() or not bundle.is_dir():
        raise RuntimeContractError("bundle must be a non-symlink directory")
    manifest = _load_manifest(bundle)
    required_top_level = {
        "schemaVersion",
        "contract",
        "repository",
        "commit",
        "programSha256",
        "staticContract",
        "mode",
        "declaredTrainSteps",
        "effectiveTrainSteps",
        "expectedTrials",
        "expectedSeeds",
        "claimScope",
        "candidate",
        "runtime",
        "evaluators",
        "sourceIntegrity",
        "launch",
        "acceptance",
        "externalPrerequisites",
    }
    _expect_exact_keys(manifest, required_top_level, "runtime manifest")
    if (
        manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("contract") != RUNTIME_CONTRACT_ID
        or manifest.get("repository") != static_contract.PINNED_REPOSITORY
        or manifest.get("commit") != static_contract.PINNED_COMMIT
        or manifest.get("programSha256") != static_contract.PINNED_PROGRAM_SHA256
        or manifest.get("staticContract") != static_contract.CONTRACT_ID
    ):
        raise RuntimeContractError("runtime manifest identity does not match the pinned contract")

    mode = manifest.get("mode")
    trials = manifest.get("expectedTrials")
    if not isinstance(mode, str) or type(trials) is not int:
        raise RuntimeContractError("runtime mode and expectedTrials are invalid")
    _validate_mode(mode, trials)
    declared_train_steps = manifest.get("declaredTrainSteps")
    effective_train_steps = manifest.get("effectiveTrainSteps")
    if (
        declared_train_steps != STOCK_DECLARED_TRAIN_STEPS
        or effective_train_steps != SMOKE_STEPS
    ):
        raise RuntimeContractError("runtime train-step fields are not the fixed stock smoke values")
    if manifest.get("expectedSeeds") != [TRIAL_SEED_BASE]:
        raise RuntimeContractError("runtime expected seeds do not match the fixed trial schedule")
    if manifest.get("claimScope") != STOCK_SMOKE_CLAIM_SCOPE:
        raise RuntimeContractError("runtime claim scope is not the fixed infrastructure-only claim")

    candidate_descriptor = manifest.get("candidate")
    runtime_descriptor = manifest.get("runtime")
    evaluator_descriptor = manifest.get("evaluators")
    if not isinstance(candidate_descriptor, dict) or not isinstance(runtime_descriptor, dict):
        raise RuntimeContractError("candidate and runtime descriptors must be objects")
    if not isinstance(evaluator_descriptor, dict):
        raise RuntimeContractError("evaluator descriptor must be an object")
    _expect_exact_keys(candidate_descriptor, {"path", "sha256"}, "candidate descriptor")
    _expect_exact_keys(runtime_descriptor, {"path", "sha256"}, "runtime descriptor")
    _expect_exact_keys(evaluator_descriptor, {"staticSha256", "runtimeSha256"}, "evaluator descriptor")
    if candidate_descriptor.get("path") != RUNTIME_CANDIDATE_NAME:
        raise RuntimeContractError("candidate path is not the fixed runtime path")
    if runtime_descriptor.get("path") != RUNTIME_PROGRAM_NAME:
        raise RuntimeContractError("runtime path is not the fixed runtime path")

    candidate_path = bundle / RUNTIME_CANDIDATE_NAME
    runtime_path = bundle / RUNTIME_PROGRAM_NAME
    _regular_file(candidate_path, "candidate source")
    _regular_file(runtime_path, "runtime source")
    candidate_bytes, candidate = read_exact_utf8(candidate_path, static_contract.MAX_SOURCE_BYTES)
    runtime_bytes, runtime_source = read_exact_utf8(
        runtime_path, static_contract.MAX_SOURCE_BYTES * 2
    )
    candidate_sha256 = _expect_sha256(candidate_descriptor.get("sha256"), "candidate SHA-256")
    runtime_sha256 = _expect_sha256(runtime_descriptor.get("sha256"), "runtime SHA-256")
    if sha256_bytes(candidate_bytes) != candidate_sha256:
        raise RuntimeContractError("candidate source hash does not match the runtime manifest")
    if sha256_bytes(runtime_bytes) != runtime_sha256:
        raise RuntimeContractError("runtime source hash does not match the runtime manifest")
    pinned_bytes, baseline = read_exact_utf8(
        baseline_fixture(), static_contract.MAX_SOURCE_BYTES
    )
    if candidate_bytes != pinned_bytes or candidate_sha256 != static_contract.PINNED_BASELINE_SHA256:
        raise RuntimeContractError("bundle candidate is not the byte-exact pinned stock fixture")

    static_sha256 = _expect_sha256(evaluator_descriptor.get("staticSha256"), "static evaluator SHA-256")
    runtime_evaluator = _expect_sha256(
        evaluator_descriptor.get("runtimeSha256"), "runtime evaluator SHA-256"
    )
    if static_sha256 != static_contract.evaluator_sha256():
        raise RuntimeContractError("static evaluator hash does not match this verifier epoch")
    if runtime_evaluator != runtime_evaluator_sha256():
        raise RuntimeContractError("runtime evaluator hash does not match this verifier epoch")

    validation = static_contract.validate_candidate(
        baseline,
        candidate,
        allow_baseline_steps=True,
        patch_sha256=None,
    )
    if (
        not validation["ok"]
        or validation["trainSteps"] != STOCK_DECLARED_TRAIN_STEPS
        or validation["candidateSha256"] != static_contract.PINNED_BASELINE_SHA256
    ):
        raise RuntimeContractError("candidate no longer passes the pinned static contract")
    source_integrity = manifest.get("sourceIntegrity")
    if not isinstance(source_integrity, dict):
        raise RuntimeContractError("sourceIntegrity must be an object")
    expected_integrity = {
        "baselineSha256": validation["baselineSha256"],
        "patchSha256": validation["patchSha256"],
        "frozenSegmentSha256": validation["frozenSegmentSha256"],
        "editableSegmentSha256": validation["editableSegmentSha256"],
    }
    if source_integrity != expected_integrity:
        raise RuntimeContractError("source-integrity evidence does not match revalidation")
    expected_runtime = instrument_candidate(
        candidate,
        candidate_sha256=candidate_sha256,
    )
    if runtime_source != expected_runtime:
        raise RuntimeContractError("runtime source is not the deterministic instrumentation of the candidate")

    expected_manifest = _manifest(
        candidate,
        runtime_source,
        validation,
        mode=mode,
        trials=trials,
    )
    if manifest != expected_manifest:
        raise RuntimeContractError("runtime manifest is not the deterministic manifest for this candidate")
    return manifest, candidate, runtime_source


def _parse_marker(line: str, kind: str, expected_keys: set[str]) -> dict[str, str]:
    prefix = f"{RUNTIME_MARKER_PREFIX}{kind}|"
    if not line.startswith(prefix):
        raise RuntimeContractError(f"line is not a {kind} runtime marker")
    fields: dict[str, str] = {}
    for part in line[len(prefix) :].split("|"):
        key, separator, value = part.partition("=")
        if separator == "" or key == "" or key in fields:
            raise RuntimeContractError(f"malformed {kind} runtime marker")
        fields[key] = value
    if set(fields) != expected_keys:
        raise RuntimeContractError(f"{kind} runtime marker fields do not match the contract")
    return fields


def _parse_int(value: str, label: str) -> int:
    if re.fullmatch(r"0|[1-9][0-9]*", value) is None:
        raise RuntimeContractError(f"{label} must be a canonical non-negative integer")
    return int(value)


def _parse_float(value: str, label: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise RuntimeContractError(f"{label} must be a finite number") from error
    if not math.isfinite(parsed):
        raise RuntimeContractError(f"{label} must be a finite number")
    return parsed


def extract_metrics(bundle: Path, log_path: Path, exit_code: int) -> dict[str, object]:
    manifest, _, runtime_source = verify_bundle(bundle)
    if exit_code != 0:
        raise RuntimeContractError(f"runtime process exited with non-zero status {exit_code}")
    _regular_file(log_path, "runtime log")
    try:
        log = log_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise RuntimeContractError(f"cannot read runtime log: {error}") from error
    source_boundary = runtime_source + "\n" + "=" * 100 + "\n"
    if not log.startswith(source_boundary):
        raise RuntimeContractError("runtime log does not begin with the exact instrumented source")
    tail = log[len(source_boundary) :]
    if "Traceback (most recent call last):" in tail or "CUDA out of memory" in tail:
        raise RuntimeContractError("runtime log contains a fatal Python or CUDA failure")
    lines = tail.splitlines()
    environments = [match for line in lines if (match := ENVIRONMENT_LINE.fullmatch(line)) is not None]
    if len(environments) != 1:
        raise RuntimeContractError("runtime log must contain exactly one environment identity line")
    environment = environments[0].groupdict()
    if environment["world_size"] != "1":
        raise RuntimeContractError("runtime world size must be exactly one")

    trials = manifest["expectedTrials"]
    declared_steps = manifest["declaredTrainSteps"]
    effective_steps = manifest["effectiveTrainSteps"]
    mode = manifest["mode"]
    candidate_descriptor = manifest["candidate"]
    if (
        type(trials) is not int
        or type(declared_steps) is not int
        or type(effective_steps) is not int
        or not isinstance(mode, str)
        or not isinstance(candidate_descriptor, dict)
    ):
        raise RuntimeContractError("verified manifest fields changed type")
    candidate_sha256 = candidate_descriptor.get("sha256")
    if candidate_sha256 != static_contract.PINNED_BASELINE_SHA256:
        raise RuntimeContractError("verified candidate is not the pinned stock source")
    if (
        trials != STOCK_TRIALS
        or declared_steps != STOCK_DECLARED_TRAIN_STEPS
        or effective_steps != SMOKE_STEPS
        or mode != SMOKE_MODE
    ):
        raise RuntimeContractError("verified manifest is not the fixed stock smoke schedule")

    contract_lines = [line for line in lines if line.startswith(f"{RUNTIME_MARKER_PREFIX}CONTRACT|")]
    result_lines = [line for line in lines if line.startswith(f"{RUNTIME_MARKER_PREFIX}RESULT|")]
    completion_lines = [line for line in lines if line.startswith(f"{RUNTIME_MARKER_PREFIX}COMPLETE|")]
    if len(contract_lines) != trials or len(result_lines) != trials or len(completion_lines) != 1:
        raise RuntimeContractError("runtime marker counts do not match the expected trial count")
    completion = _parse_marker(completion_lines[0], "COMPLETE", {"trials"})
    if _parse_int(completion["trials"], "completed trials") != trials:
        raise RuntimeContractError("completion marker trial count is incorrect")
    completion_index = lines.index(completion_lines[0])

    expected_seeds = manifest["expectedSeeds"]
    if expected_seeds != [TRIAL_SEED_BASE]:
        raise RuntimeContractError("verified seed schedule is not the fixed stock seed")
    seed_lines = [line for line in lines if re.fullmatch(r"seed:\d+", line)]
    observed_seed_lines = [_parse_int(line.removeprefix("seed:"), "seed") for line in seed_lines]
    if observed_seed_lines != expected_seeds:
        raise RuntimeContractError("logged seed sequence does not match the fixed trial schedule")
    environment_index = next(
        index for index, line in enumerate(lines) if ENVIRONMENT_LINE.fullmatch(line) is not None
    )
    seed_index = lines.index(seed_lines[0])

    final_losses: list[float] = []
    runtime_losses: list[float] = []
    peak_vram_mb: list[float] = []
    optimizer_steps: list[int] = []
    backward_calls: list[int] = []
    expected_backward_calls = SMOKE_STEPS * 8
    for trial in range(trials):
        contract_fields = _parse_marker(
            contract_lines[trial],
            "CONTRACT",
            {
                "contract",
                "candidate_sha256",
                "mode",
                "trial",
                "seed",
                "declared_train_steps",
                "effective_train_steps",
            },
        )
        result_fields = _parse_marker(
            result_lines[trial],
            "RESULT",
            {
                "trial",
                "seed",
                "declared_train_steps",
                "effective_train_steps",
                "final_val_loss",
                "optimizer_steps",
                "backward_calls",
                "peak_vram_mb",
            },
        )
        expected_seed = expected_seeds[trial]
        if (
            contract_fields["contract"] != RUNTIME_CONTRACT_ID
            or contract_fields["candidate_sha256"] != candidate_sha256
            or contract_fields["mode"] != mode
            or _parse_int(contract_fields["trial"], "contract trial") != trial
            or _parse_int(contract_fields["seed"], "contract seed") != expected_seed
            or _parse_int(contract_fields["declared_train_steps"], "declared train steps")
            != declared_steps
            or _parse_int(contract_fields["effective_train_steps"], "effective train steps")
            != effective_steps
        ):
            raise RuntimeContractError(f"trial {trial} contract marker does not match the manifest")
        if (
            _parse_int(result_fields["trial"], "result trial") != trial
            or _parse_int(result_fields["seed"], "result seed") != expected_seed
            or _parse_int(result_fields["declared_train_steps"], "result declared train steps")
            != declared_steps
            or _parse_int(result_fields["effective_train_steps"], "result effective train steps")
            != effective_steps
        ):
            raise RuntimeContractError(f"trial {trial} result marker does not match the manifest")
        observed_optimizer_steps = _parse_int(result_fields["optimizer_steps"], "optimizer steps")
        observed_backward_calls = _parse_int(result_fields["backward_calls"], "backward calls")
        if observed_optimizer_steps != effective_steps or observed_backward_calls != expected_backward_calls:
            raise RuntimeContractError(f"trial {trial} execution counts violate the one-step contract")

        contract_index = lines.index(contract_lines[trial])
        result_index = lines.index(result_lines[trial])
        if not environment_index < seed_index < contract_index < result_index < completion_index:
            raise RuntimeContractError("stock runtime identity, trial, result, and completion are out of order")
        final_matches = []
        for line in lines[contract_index + 1 : result_index]:
            match = FINAL_VALIDATION_LINE.match(line)
            if match is None:
                continue
            if int(match.group("step")) == effective_steps and int(match.group("total")) == effective_steps:
                final_matches.append(match)
        if len(final_matches) != 1:
            raise RuntimeContractError(f"trial {trial} must contain exactly one final validation metric")
        printed_loss = _parse_float(final_matches[0].group("loss"), "printed final validation loss")
        runtime_loss = _parse_float(result_fields["final_val_loss"], "runtime final validation loss")
        if printed_loss <= 0 or runtime_loss <= 0 or abs(printed_loss - runtime_loss) > 0.0000051:
            raise RuntimeContractError(f"trial {trial} final validation metrics disagree")
        peak = _parse_float(result_fields["peak_vram_mb"], "peak VRAM")
        if peak < 0:
            raise RuntimeContractError("peak VRAM cannot be negative")
        final_losses.append(printed_loss)
        runtime_losses.append(runtime_loss)
        peak_vram_mb.append(peak)
        optimizer_steps.append(observed_optimizer_steps)
        backward_calls.append(observed_backward_calls)

    if len(final_losses) != STOCK_TRIALS:
        raise RuntimeContractError("stock smoke did not produce exactly one accepted loss")
    mean_validation_loss = final_losses[0]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": RUNTIME_CONTRACT_ID,
        "ok": True,
        "mode": mode,
        "candidateSha256": candidate_sha256,
        "runtimeSha256": manifest["runtime"]["sha256"],
        "declaredTrainSteps": declared_steps,
        "effectiveTrainSteps": effective_steps,
        "trials": trials,
        "seeds": expected_seeds,
        "finalValidationLosses": final_losses,
        "runtimeValidationLosses": runtime_losses,
        "meanValidationLoss": mean_validation_loss,
        "optimizerSteps": optimizer_steps,
        "backwardCalls": backward_calls,
        "peakVramMb": peak_vram_mb,
        "environment": {
            "pytorch": environment["pytorch"],
            "cuda": environment["cuda"],
            "gpu": environment["gpu"],
            "worldSize": 1,
        },
        "claimScope": STOCK_SMOKE_CLAIM_SCOPE,
        "scoredEligible": False,
        "recordEligible": False,
        "recordPassed": None,
    }


def success_result(operation: str, **payload: object) -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": RUNTIME_CONTRACT_ID,
        "operation": operation,
        "ok": True,
        "errors": [],
        **payload,
    }


def failure_result(operation: str, code: str, message: str) -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": RUNTIME_CONTRACT_ID,
        "operation": operation,
        "ok": False,
        "errors": [{"code": code, "message": message}],
    }


def materialize(args: argparse.Namespace) -> dict[str, object]:
    _validate_mode(args.mode, args.trials)
    _, candidate, _, validation = _read_candidate(args)
    candidate_sha256 = sha256_text(candidate)
    declared_train_steps = validation["trainSteps"]
    if declared_train_steps != STOCK_DECLARED_TRAIN_STEPS:
        raise RuntimeContractError("validated train_steps is not the fixed stock value")
    runtime_source = instrument_candidate(
        candidate,
        candidate_sha256=candidate_sha256,
    )
    manifest = _manifest(candidate, runtime_source, validation, mode=args.mode, trials=args.trials)
    _write_bundle(args.output, candidate, runtime_source, manifest)
    verified_manifest, _, _ = verify_bundle(args.output)
    if verified_manifest != manifest:
        raise RuntimeContractError("materialized manifest changed during verification")
    return success_result(
        "materialize",
        bundlePath=str(args.output.resolve()),
        manifestSha256=sha256_file(args.output / RUNTIME_MANIFEST_NAME),
        manifest=manifest,
    )


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="operation", required=True)

    materialize_parser = subparsers.add_parser("materialize")
    materialize_parser.add_argument("--baseline", type=Path)
    source = materialize_parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--candidate", type=Path)
    source.add_argument("--patch", type=Path)
    materialize_parser.add_argument("--output", required=True, type=Path)
    materialize_parser.add_argument("--mode", required=True)
    materialize_parser.add_argument("--trials", type=int, default=1)
    materialize_parser.add_argument("--allow-baseline-steps", action="store_true")

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--bundle", required=True, type=Path)

    extract_parser = subparsers.add_parser("extract")
    extract_parser.add_argument("--bundle", required=True, type=Path)
    extract_parser.add_argument("--log", required=True, type=Path)
    extract_parser.add_argument("--exit-code", required=True, type=int)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        if args.operation == "materialize":
            result = materialize(args)
        elif args.operation == "verify":
            manifest, _, _ = verify_bundle(args.bundle)
            result = success_result(
                "verify",
                bundlePath=str(args.bundle.resolve()),
                manifestSha256=sha256_file(args.bundle / RUNTIME_MANIFEST_NAME),
                manifest=manifest,
            )
        elif args.operation == "extract":
            metrics = extract_metrics(args.bundle, args.log, args.exit_code)
            result = success_result("extract", metrics=metrics)
        else:
            raise RuntimeContractError(f"unknown operation: {args.operation}")
    except (OSError, UnicodeError, ValueError, RuntimeContractError, static_contract.PatchError) as error:
        result = failure_result(args.operation, "RUNTIME_CONTRACT_FAILED", str(error))
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

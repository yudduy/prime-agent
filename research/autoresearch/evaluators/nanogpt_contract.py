#!/usr/bin/env python3
"""Fail-closed static contract gate for the pinned NanoGPT Track 3 program."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional, Sequence


SCHEMA_VERSION = 1
CONTRACT_ID = "nanogpt-track3-static-contract-v1"
PINNED_REPOSITORY = "https://github.com/PrimeIntellect-ai/frontier-automated-speedrun"
PINNED_COMMIT = "38e258afefb1ce206dd7595aa71d7740da405742"
PINNED_BASELINE_SHA256 = "219769694f76b7a58de2f59d5aa0e4390854f41030dbbb2fd3284242f7c2091e"
PINNED_PROGRAM_SHA256 = "8af050630fa1deeef63a61da8d7ae1ec36b3925603f333c16572f5e30b53af08"
BASELINE_TRAIN_STEPS = 3290
MAX_SOURCE_BYTES = 256 * 1024
MAX_PATCH_BYTES = 128 * 1024

OPTIMIZER_HEADER = """########################################
#              Optimizer               #
########################################

"""
SETUP_HEADER = """
########################################
#                Setup                 #
########################################
"""
INIT_HEADER = """    ########################################
    #       Init & Optim Hyperparams       #
    ########################################

"""
WANDB_ANCHOR = "    # W&B run for this trial (fixed logging infra; no-op if W&B unconfigured)\n"
SCHEDULE_ANCHOR = "    # learning rate schedule: stable then decay\n"
TRAINING_HEADER = """
    ########################################
    #        Training and Validation       #
    ########################################
"""

FORBIDDEN_NAMES = frozenset(
    {
        "Path",
        "__builtins__",
        "__import__",
        "breakpoint",
        "builtins",
        "code",
        "compile",
        "delattr",
        "eval",
        "exec",
        "getattr",
        "globals",
        "input",
        "locals",
        "logfile",
        "mbs",
        "num_trials",
        "open",
        "os",
        "print0",
        "setattr",
        "sys",
        "time",
        "train_loader",
        "trial_idx",
        "uuid",
        "val_inputs",
        "val_loss",
        "val_targets",
        "vars",
        "wandb",
        "wandb_run",
        "_wandb_on",
    }
)
PROTECTED_ASSIGNMENT_ROOTS = frozenset(
    {
        "F",
        "Tensor",
        "batch_size",
        "dist",
        "model",
        "nn",
        "torch",
    }
)
FORBIDDEN_DOTTED_PREFIXES = (
    "builtins.",
    "http.",
    "importlib.",
    "marshal.",
    "os.",
    "pathlib.",
        "pickle.",
    "requests.",
    "shutil.",
    "socket.",
    "subprocess.",
    "sys.",
    "torch.autograd.",
    "torch.distributed.rpc",
    "torch.hub.",
    "torch.package.",
    "urllib.",
)
FORBIDDEN_CALL_SUFFIXES = (
    ".backward",
    ".grad",
    ".load",
    ".manual_seed",
    ".manual_seed_all",
    ".register_backward_hook",
    ".register_forward_hook",
    ".register_full_backward_hook",
    ".register_hook",
    ".save",
    ".seed",
    ".set_rng_state",
    ".set_rng_state_all",
)


@dataclass(frozen=True)
class Finding:
    code: str
    message: str

    def as_json(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@dataclass(frozen=True)
class SourceLayout:
    frozen: tuple[str, str, str, str]
    editable: tuple[str, str, str]
    editable_line_ranges: tuple[tuple[int, int], tuple[int, int], tuple[int, int]]


class PatchError(ValueError):
    pass


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def evaluator_sha256() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def read_utf8(path: Path, maximum_bytes: int) -> str:
    size = path.stat().st_size
    if size > maximum_bytes:
        raise ValueError(f"{path.name} is {size} bytes; limit is {maximum_bytes}")
    return path.read_text(encoding="utf-8")


def _unique_index(source: str, marker: str, label: str, start: int = 0) -> int:
    if source.count(marker) != 1:
        raise ValueError(f"expected exactly one intact {label} marker")
    index = source.find(marker, start)
    if index < start:
        raise ValueError(f"{label} marker is out of order")
    return index


def _line_range(source: str, start: int, end: int) -> tuple[int, int]:
    start_line = source.count("\n", 0, start) + 1
    if end <= start:
        return (start_line, start_line - 1)
    end_line = source.count("\n", 0, end - 1) + 1
    return (start_line, end_line)


def split_source(source: str) -> SourceLayout:
    optimizer_start = _unique_index(source, OPTIMIZER_HEADER, "optimizer header") + len(OPTIMIZER_HEADER)
    setup_start = _unique_index(source, SETUP_HEADER, "setup header", optimizer_start)
    init_start = _unique_index(source, INIT_HEADER, "init header", setup_start) + len(INIT_HEADER)
    wandb_start = _unique_index(source, WANDB_ANCHOR, "fixed W&B anchor", init_start)
    schedule_start = _unique_index(source, SCHEDULE_ANCHOR, "schedule anchor", wandb_start) + len(
        SCHEDULE_ANCHOR
    )
    training_start = _unique_index(source, TRAINING_HEADER, "training header", schedule_start)
    if not optimizer_start < setup_start < init_start < wandb_start < schedule_start < training_start:
        raise ValueError("contract markers are out of order")
    return SourceLayout(
        frozen=(
            source[:optimizer_start],
            source[setup_start:init_start],
            source[wandb_start:schedule_start],
            source[training_start:],
        ),
        editable=(
            source[optimizer_start:setup_start],
            source[init_start:wandb_start],
            source[schedule_start:training_start],
        ),
        editable_line_ranges=(
            _line_range(source, optimizer_start, setup_start),
            _line_range(source, init_start, wandb_start),
            _line_range(source, schedule_start, training_start),
        ),
    )


def _path_from_header(line: str, prefix: str) -> str:
    raw = line[len(prefix) :].split("\t", 1)[0].strip()
    if raw.startswith("a/") or raw.startswith("b/"):
        raw = raw[2:]
    return raw


def apply_unified_patch(baseline: str, patch: str) -> str:
    if "GIT binary patch" in patch or "Binary files " in patch:
        raise PatchError("binary patches are forbidden")
    lines = patch.splitlines(keepends=True)
    diff_headers = [line for line in lines if line.startswith("diff --git ")]
    if len(diff_headers) > 1:
        raise PatchError("patch must modify exactly one file")
    if diff_headers:
        parts = diff_headers[0].strip().split()
        if len(parts) != 4 or parts[2] != "a/train_gpt_simple.py" or parts[3] != "b/train_gpt_simple.py":
            raise PatchError("diff header must target only train_gpt_simple.py")

    old_headers = [index for index, line in enumerate(lines) if line.startswith("--- ")]
    new_headers = [index for index, line in enumerate(lines) if line.startswith("+++ ")]
    if len(old_headers) != 1 or len(new_headers) != 1 or new_headers[0] != old_headers[0] + 1:
        raise PatchError("patch must contain one adjacent ---/+++ file header pair")
    header_index = old_headers[0]
    old_path = _path_from_header(lines[header_index], "--- ")
    new_path = _path_from_header(lines[header_index + 1], "+++ ")
    if old_path != "train_gpt_simple.py" or new_path != "train_gpt_simple.py":
        raise PatchError("patch must modify train_gpt_simple.py in place")
    if any(line.startswith(("rename ", "copy ", "new file ", "deleted file ")) for line in lines[:header_index]):
        raise PatchError("rename, copy, create, and delete metadata are forbidden")

    hunk_pattern = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)\n?$")
    source_lines = baseline.splitlines(keepends=True)
    output: list[str] = []
    old_cursor = 0
    index = header_index + 2
    hunk_count = 0
    while index < len(lines):
        match = hunk_pattern.match(lines[index])
        if match is None:
            raise PatchError(f"unsupported patch content at line {index + 1}")
        hunk_count += 1
        old_start = int(match.group(1))
        old_count = int(match.group(2) or "1")
        new_count = int(match.group(4) or "1")
        target = old_start - 1
        if target < old_cursor or target > len(source_lines):
            raise PatchError("overlapping or out-of-range hunk")
        output.extend(source_lines[old_cursor:target])
        index += 1
        old_used = 0
        new_used = 0
        while index < len(lines) and not lines[index].startswith("@@ "):
            line = lines[index]
            if line.startswith(("--- ", "+++ ", "diff --git ")):
                raise PatchError("patch must modify exactly one file")
            if line.startswith("\\ No newline at end of file"):
                raise PatchError("no-newline patch markers are unsupported")
            if not line or line[0] not in " +-":
                raise PatchError(f"invalid hunk line at patch line {index + 1}")
            payload = line[1:]
            source_index = target + old_used
            if line[0] in " -":
                if source_index >= len(source_lines) or source_lines[source_index] != payload:
                    raise PatchError(f"hunk context mismatch at source line {source_index + 1}")
                old_used += 1
            if line[0] in " +":
                output.append(payload)
                new_used += 1
            index += 1
        if old_used != old_count or new_used != new_count:
            raise PatchError(
                f"hunk count mismatch: declared -{old_count}/+{new_count}, observed -{old_used}/+{new_used}"
            )
        old_cursor = target + old_used
    if hunk_count == 0:
        raise PatchError("patch contains no hunks")
    output.extend(source_lines[old_cursor:])
    return "".join(output)


def _dotted_name(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return None


def _ends_with_member(value: str, suffix: str) -> bool:
    member = suffix.removeprefix(".")
    return value == member or value.endswith(suffix)


def _in_ranges(node: ast.AST, ranges: Sequence[tuple[int, int]]) -> bool:
    line = getattr(node, "lineno", None)
    return isinstance(line, int) and any(start <= line <= end for start, end in ranges)


def _assignment_roots(node: ast.AST) -> Iterable[str]:
    if isinstance(node, ast.Name):
        yield node.id
    elif isinstance(node, (ast.Attribute, ast.Subscript)):
        dotted = _dotted_name(node.value)
        if dotted:
            yield dotted.split(".", 1)[0]
    elif isinstance(node, (ast.Tuple, ast.List)):
        for element in node.elts:
            yield from _assignment_roots(element)


def inspect_ast(source: str, ranges: Sequence[tuple[int, int]], allow_baseline_steps: bool) -> tuple[list[Finding], Optional[int]]:
    findings: list[Finding] = []
    try:
        tree = ast.parse(source, filename="train_gpt_simple.py")
    except SyntaxError as error:
        return [Finding("PYTHON_SYNTAX_ERROR", f"{error.msg} at line {error.lineno}")], None

    assignments: list[ast.AST] = []
    for node in ast.walk(tree):
        if not _in_ranges(node, ranges):
            continue
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            findings.append(Finding("EDITABLE_IMPORT", f"imports are forbidden in editable sections at line {node.lineno}"))
        if isinstance(node, (ast.Global, ast.Nonlocal)):
            findings.append(Finding("GLOBAL_MUTATION", f"global/nonlocal mutation is forbidden at line {node.lineno}"))
        if isinstance(node, (ast.Break, ast.Continue)) and node.lineno >= ranges[1][0]:
            findings.append(Finding("OUTER_CONTROL_FLOW", f"break/continue is forbidden in trial setup at line {node.lineno}"))
        if isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            findings.append(Finding("FORBIDDEN_NAME", f"{node.id} is forbidden in editable sections at line {node.lineno}"))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in FORBIDDEN_NAMES:
            findings.append(
                Finding("FORBIDDEN_DEFINITION", f"{node.name} cannot be redefined in editable sections at line {node.lineno}")
            )
        if isinstance(node, ast.arg) and node.arg == "train_steps":
            findings.append(Finding("TRAIN_STEPS_SHADOWED", f"train_steps cannot be a parameter at line {node.lineno}"))
        if isinstance(node, ast.Call):
            dotted = _dotted_name(node.func)
            if dotted == "model" or (dotted and _ends_with_member(dotted, ".forward")):
                findings.append(Finding("EXTRA_MODEL_EVALUATION", f"model evaluation is forbidden at line {node.lineno}"))
            if dotted and (
                dotted in FORBIDDEN_NAMES
                or dotted.startswith(FORBIDDEN_DOTTED_PREFIXES)
                or any(_ends_with_member(dotted, suffix) for suffix in FORBIDDEN_CALL_SUFFIXES)
            ):
                findings.append(Finding("FORBIDDEN_CALL", f"{dotted} is forbidden at line {node.lineno}"))
        if isinstance(node, ast.Attribute):
            dotted = _dotted_name(node)
            if dotted and dotted.startswith(FORBIDDEN_DOTTED_PREFIXES):
                findings.append(Finding("FORBIDDEN_ATTRIBUTE", f"{dotted} is forbidden at line {node.lineno}"))
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
            if isinstance(node, ast.Assign):
                targets: Sequence[ast.AST] = node.targets
            else:
                targets = (node.target,)
            roots = {root for target in targets for root in _assignment_roots(target)}
            protected = sorted(roots.intersection(PROTECTED_ASSIGNMENT_ROOTS))
            if protected:
                findings.append(
                    Finding(
                        "PROTECTED_ASSIGNMENT",
                        f"cannot assign through protected root(s) {', '.join(protected)} at line {node.lineno}",
                    )
                )
            if "train_steps" in roots:
                assignments.append(node)

    train_steps: Optional[int] = None
    if len(assignments) != 1:
        findings.append(Finding("TRAIN_STEPS_ASSIGNMENT", "candidate must contain exactly one editable train_steps assignment"))
    else:
        assignment = assignments[0]
        if not (
            isinstance(assignment, ast.Assign)
            and len(assignment.targets) == 1
            and isinstance(assignment.targets[0], ast.Name)
            and assignment.targets[0].id == "train_steps"
            and isinstance(assignment.value, ast.Constant)
            and type(assignment.value.value) is int
        ):
            findings.append(Finding("TRAIN_STEPS_LITERAL", "train_steps must be assigned one integer literal"))
        else:
            train_steps = assignment.value.value
            upper_bound = BASELINE_TRAIN_STEPS if allow_baseline_steps else BASELINE_TRAIN_STEPS - 1
            if not 1 <= train_steps <= upper_bound:
                relation = "at most" if allow_baseline_steps else "strictly below"
                findings.append(
                    Finding(
                        "TRAIN_STEPS_RANGE",
                        f"train_steps must be positive and {relation} the {BASELINE_TRAIN_STEPS}-step baseline",
                    )
                )

    backward_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and _ends_with_member(_dotted_name(node.func) or "", ".backward")
    ]
    if len(backward_calls) != 1:
        findings.append(Finding("BACKWARD_COUNT", f"expected exactly one syntactic backward call, found {len(backward_calls)}"))
    return findings, train_steps


def validate_candidate(
    baseline: str,
    candidate: str,
    *,
    allow_baseline_steps: bool,
    expected_baseline_sha256: str = PINNED_BASELINE_SHA256,
    patch_sha256: Optional[str] = None,
) -> dict[str, object]:
    findings: list[Finding] = []
    baseline_hash = sha256_text(baseline)
    candidate_hash = sha256_text(candidate)
    baseline_layout: Optional[SourceLayout] = None
    candidate_layout: Optional[SourceLayout] = None
    train_steps: Optional[int] = None

    if baseline_hash != expected_baseline_sha256:
        findings.append(
            Finding(
                "BASELINE_HASH_MISMATCH",
                f"baseline SHA-256 {baseline_hash} does not match pinned {expected_baseline_sha256}",
            )
        )
    try:
        baseline_layout = split_source(baseline)
    except ValueError as error:
        findings.append(Finding("BASELINE_LAYOUT_INVALID", str(error)))
    try:
        candidate_layout = split_source(candidate)
    except ValueError as error:
        findings.append(Finding("CANDIDATE_LAYOUT_INVALID", str(error)))

    if baseline_layout and candidate_layout:
        for index, (expected, observed) in enumerate(zip(baseline_layout.frozen, candidate_layout.frozen)):
            if expected != observed:
                findings.append(
                    Finding(
                        "FROZEN_SEGMENT_CHANGED",
                        f"frozen segment {index} changed ({sha256_text(expected)} != {sha256_text(observed)})",
                    )
                )
        ast_findings, train_steps = inspect_ast(
            candidate,
            candidate_layout.editable_line_ranges,
            allow_baseline_steps,
        )
        findings.extend(ast_findings)

    unique_findings = {(finding.code, finding.message): finding for finding in findings}
    ordered = sorted(unique_findings.values(), key=lambda finding: (finding.code, finding.message))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": CONTRACT_ID,
        "ok": not ordered,
        "repository": PINNED_REPOSITORY,
        "commit": PINNED_COMMIT,
        "programSha256": PINNED_PROGRAM_SHA256,
        "evaluatorSha256": evaluator_sha256(),
        "baselineSha256": baseline_hash,
        "candidateSha256": candidate_hash,
        "patchSha256": patch_sha256,
        "trainSteps": train_steps,
        "allowBaselineSteps": allow_baseline_steps,
        "frozenSegmentSha256": (
            [sha256_text(segment) for segment in candidate_layout.frozen] if candidate_layout else []
        ),
        "editableSegmentSha256": (
            [sha256_text(segment) for segment in candidate_layout.editable] if candidate_layout else []
        ),
        "errors": [finding.as_json() for finding in ordered],
        "caveats": [
            "Static source validation cannot prove runtime correctness, compile compatibility, or absence of semantically hidden extra work.",
            "CUDA smoke and evaluator-owned runtime instrumentation remain mandatory before any scored run.",
        ],
    }


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--candidate", type=Path)
    source.add_argument("--patch", type=Path)
    parser.add_argument("--allow-baseline-steps", action="store_true")
    return parser.parse_args(argv)


def failure_result(code: str, message: str) -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contract": CONTRACT_ID,
        "ok": False,
        "repository": PINNED_REPOSITORY,
        "commit": PINNED_COMMIT,
        "programSha256": PINNED_PROGRAM_SHA256,
        "evaluatorSha256": evaluator_sha256(),
        "baselineSha256": None,
        "candidateSha256": None,
        "patchSha256": None,
        "trainSteps": None,
        "allowBaselineSteps": False,
        "frozenSegmentSha256": [],
        "editableSegmentSha256": [],
        "errors": [{"code": code, "message": message}],
        "caveats": [],
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        baseline = read_utf8(args.baseline, MAX_SOURCE_BYTES)
        patch_sha256: Optional[str] = None
        if args.candidate:
            candidate = read_utf8(args.candidate, MAX_SOURCE_BYTES)
        else:
            patch = read_utf8(args.patch, MAX_PATCH_BYTES)
            patch_sha256 = sha256_text(patch)
            candidate = apply_unified_patch(baseline, patch)
            if len(candidate.encode("utf-8")) > MAX_SOURCE_BYTES:
                raise ValueError(f"patched candidate exceeds {MAX_SOURCE_BYTES} bytes")
        result = validate_candidate(
            baseline,
            candidate,
            allow_baseline_steps=args.allow_baseline_steps,
            patch_sha256=patch_sha256,
        )
    except (OSError, UnicodeError, ValueError, PatchError) as error:
        result = failure_result("INPUT_INVALID", str(error))
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

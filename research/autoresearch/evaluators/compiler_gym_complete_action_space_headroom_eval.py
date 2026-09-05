#!/usr/bin/env python3
"""Zero-model headroom gate for LLVM flags omitted from the stock prompt guide.

The request is an exact, frozen protocol object. In one single-CPU Slurm
allocation, this evaluator measures the fixed dijkstra scaffold, inserts each
of the 98 omitted legal flags at the same position, and uses raw
``IrInstructionCount`` as a cheap prefilter. Only candidates improving by at
least ``max(3 instructions, 0.5%)`` receive the authoritative 20-input cBench
semantic verifier. The gate passes only when at least two distinct omitted
flags survive that verifier.

``compiler_gym_eval`` remains authoritative for the environment seal, LLVM
action-space identity, raw observations, callback selection, and callback
execution. This module does not call a model and cannot accept arbitrary
benchmarks, flags, thresholds, or commands from stdin.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import resource
import sys
from time import perf_counter
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

import compiler_gym_eval as authoritative


SCHEMA_VERSION = 1
PROTOCOL = "compiler-gym-complete-action-space-headroom-v1"
EVALUATOR_CONTRACT = "compiler-gym-complete-action-space-headroom-eval-v1"
BENCHMARK = "benchmark://cbench-v1/dijkstra"

SHOWN_FLAGS: Tuple[str, ...] = (
    "-mem2reg",
    "-sroa",
    "-instcombine",
    "-simplifycfg",
    "-reassociate",
    "-gvn",
    "-newgvn",
    "-sccp",
    "-ipsccp",
    "-adce",
    "-dce",
    "-bdce",
    "-dse",
    "-deadargelim",
    "-globalopt",
    "-globaldce",
    "-constmerge",
    "-constprop",
    "-jump-threading",
    "-licm",
    "-loop-rotate",
    "-loop-unroll",
    "-loop-vectorize",
    "-slp-vectorizer",
    "-tailcallelim",
    "-mergereturn",
)
SHOWN_FLAG_SET = frozenset(SHOWN_FLAGS)
OMITTED_FLAGS: Tuple[str, ...] = tuple(
    flag
    for flag in authoritative.PINNED_LLVM_PASS_FLAGS
    if flag not in SHOWN_FLAG_SET
)

SCAFFOLD_WITHOUT_X: Tuple[str, ...] = (
    "-mem2reg",
    "-sroa",
    "-instcombine",
    "-simplifycfg",
    "-adce",
    "-dce",
)
INSERTION_INDEX = 2
MINIMUM_ABSOLUTE_IMPROVEMENT = 3
MINIMUM_FRACTION_NUMERATOR = 1
MINIMUM_FRACTION_DENOMINATOR = 200
MINIMUM_VERIFIED_FLAGS = 2

ALLOCATION_COUNT = 1
CPUS_PER_TASK = 1
ALLOCATION_TIME_LIMIT = "00:10:00"
# FarmShare reserves one two-thread core for this one-CPU task. This cap applies
# only to evaluator process+children CPU usage; the 10-minute Slurm wall cap can
# account up to 20 allocated logical-CPU-minutes at the root allocation.
EVALUATOR_CPU_MINUTES_LIMIT = 10
TASK_WALL_MINUTES_LIMIT = 10
SCHEDULER_LOGICAL_CPUS_PER_ALLOCATION = 2
SCHEDULER_LOGICAL_CPU_MINUTES_MAXIMUM = 20
# Leave room to serialize a conclusive negative before the hard allocation cap.
CPU_SECONDS_SOFT_LIMIT = 540.0
WALL_SECONDS_SOFT_LIMIT = 540.0

ALLOWED_FLAGS_SHA256 = "9af00634caf10684e371d135cc89d49d03549d47d5577930dab0b21bb8f0c8bf"
SHOWN_FLAGS_SHA256 = "d0df5c3f5780ad4deb9c13ef868c22805242efa3a916bbb8908335ff591d7cc4"
OMITTED_FLAGS_SHA256 = "38e3302fe1a338887cc467aef313e8d053b939ab9f12bd9d3fe74c9ec1e54b85"
REQUEST_SHA256 = "1d9d4c9ea0b4cc76aa4b184df01d17a35cf15c9c4cfed2356421b8b463f345b7"


def _sha256_json(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _assert_frozen_design() -> None:
    allowed = authoritative.PINNED_LLVM_PASS_FLAGS
    if len(allowed) != 124 or len(frozenset(allowed)) != 124:
        raise RuntimeError("Pinned LLVM action space must contain 124 unique flags")
    if len(SHOWN_FLAGS) != 26 or len(SHOWN_FLAG_SET) != 26:
        raise RuntimeError("Stock prompt guide must contain 26 unique flags")
    if not SHOWN_FLAG_SET.issubset(frozenset(allowed)):
        raise RuntimeError("Stock prompt guide contains a non-authoritative flag")
    if len(OMITTED_FLAGS) != 98 or len(frozenset(OMITTED_FLAGS)) != 98:
        raise RuntimeError("Complete action-space complement must contain 98 flags")
    if _sha256_json(list(allowed)) != ALLOWED_FLAGS_SHA256:
        raise RuntimeError("Pinned LLVM action-space digest drifted")
    if _sha256_json(list(SHOWN_FLAGS)) != SHOWN_FLAGS_SHA256:
        raise RuntimeError("Stock prompt-guide digest drifted")
    if _sha256_json(list(OMITTED_FLAGS)) != OMITTED_FLAGS_SHA256:
        raise RuntimeError("Omitted LLVM action-space digest drifted")


_assert_frozen_design()


def expected_request() -> Dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "protocol": PROTOCOL,
        "benchmark": BENCHMARK,
        "allowed_flags_sha256": ALLOWED_FLAGS_SHA256,
        "shown_flags_sha256": SHOWN_FLAGS_SHA256,
        "omitted_flags": list(OMITTED_FLAGS),
        "omitted_flags_sha256": OMITTED_FLAGS_SHA256,
        "scaffold_without_x": list(SCAFFOLD_WITHOUT_X),
        "insertion_index": INSERTION_INDEX,
        "prefilter": {
            "metric": "IrInstructionCount",
            "minimum_absolute_improvement": MINIMUM_ABSOLUTE_IMPROVEMENT,
            "minimum_fraction_numerator": MINIMUM_FRACTION_NUMERATOR,
            "minimum_fraction_denominator": MINIMUM_FRACTION_DENOMINATOR,
        },
        "pass_gate": {
            "minimum_distinct_verified_omitted_flags": MINIMUM_VERIFIED_FLAGS,
        },
    }


if _sha256_json(expected_request()) != REQUEST_SHA256:
    raise RuntimeError("Frozen complete-action-space request digest drifted")


def _invalid_request(
    code: str, message: str, details: Optional[Mapping[str, object]] = None
) -> authoritative.EvaluatorFailure:
    return authoritative.EvaluatorFailure(
        code=code,
        message=message,
        phase="request_validation",
        exit_code=authoritative.EXIT_INVALID_REQUEST,
        details=details,
    )


def _validate_request_value(value: object) -> Dict[str, object]:
    expected = expected_request()
    if not isinstance(value, dict):
        raise _invalid_request(
            "invalid_request_shape", "Request must be a JSON object"
        )
    if value != expected:
        raise _invalid_request(
            "request_not_frozen_protocol",
            "Request differs from the frozen complete-action-space protocol",
            {
                "expected_sha256": _sha256_json(expected),
                "received_sha256": _sha256_json(value),
            },
        )
    return dict(value)


def _parse_request() -> Dict[str, object]:
    payload = sys.stdin.buffer.read(authoritative.MAX_REQUEST_BYTES + 1)
    if len(payload) > authoritative.MAX_REQUEST_BYTES:
        raise _invalid_request(
            "request_too_large",
            f"Request exceeds {authoritative.MAX_REQUEST_BYTES} bytes",
        )
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise _invalid_request(
            "request_not_utf8", "Request must be UTF-8 JSON", {"error": str(error)}
        ) from None
    if not text.strip():
        raise _invalid_request("empty_request", "Expected one JSON request object")
    try:
        value = json.loads(
            text,
            object_pairs_hook=authoritative._object_without_duplicate_keys,
            parse_constant=authoritative._reject_json_constant,
        )
    except authoritative.EvaluatorFailure:
        raise
    except (json.JSONDecodeError, ValueError) as error:
        raise _invalid_request(
            "invalid_json", "Request is not valid JSON", {"error": str(error)}
        ) from None
    return _validate_request_value(value)


def _cpu_seconds() -> float:
    self_usage = resource.getrusage(resource.RUSAGE_SELF)
    child_usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    return float(
        self_usage.ru_utime
        + self_usage.ru_stime
        + child_usage.ru_utime
        + child_usage.ru_stime
    )


def _soft_budget_exhausted(cpu_started: float, wall_started: float) -> bool:
    return (
        _cpu_seconds() - cpu_started >= CPU_SECONDS_SOFT_LIMIT
        or perf_counter() - wall_started >= WALL_SECONDS_SOFT_LIMIT
    )


def _verify_single_cpu_slurm_allocation() -> Dict[str, str]:
    slurm_job_id = os.environ.get("SLURM_JOB_ID")
    slurm_cpus = os.environ.get("SLURM_CPUS_PER_TASK")
    slurm_tasks = os.environ.get("SLURM_NTASKS")
    if (
        not slurm_job_id
        or not slurm_job_id.isdigit()
        or slurm_job_id.startswith("0")
        or slurm_cpus != str(CPUS_PER_TASK)
        or slurm_tasks != "1"
    ):
        raise authoritative.EvaluatorFailure(
            code="allocation_contract_mismatch",
            message="Headroom gate requires one single-CPU Slurm task",
            phase="allocation_contract",
            exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            details={
                "slurm_job_id": slurm_job_id,
                "slurm_cpus_per_task": slurm_cpus,
                "slurm_ntasks": slurm_tasks,
            },
        )
    return {
        "slurm_job_id": slurm_job_id,
        "slurm_cpus_per_task": slurm_cpus,
        "slurm_ntasks": slurm_tasks,
    }


def _nonnegative_ir(value: object, phase: str) -> int:
    try:
        return authoritative._nonnegative_integer(value, "IrInstructionCount")
    except (TypeError, ValueError) as error:
        raise authoritative.EvaluatorFailure(
            code="invalid_ir_observation",
            message="CompilerGym returned an invalid raw IR instruction count",
            phase=phase,
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={"error": str(error)},
        ) from None


def _raw_episode(
    env: object,
    actions: Sequence[str],
    action_indices: Sequence[int],
) -> Tuple[int, bool, Mapping[str, object], str]:
    getattr(env, "reset")(benchmark=BENCHMARK)
    canonical_benchmark = str(getattr(env, "benchmark"))
    if canonical_benchmark != BENCHMARK:
        raise authoritative.EvaluatorFailure(
            code="benchmark_canonicalization_mismatch",
            message="CompilerGym resolved a different benchmark URI",
            phase="prefilter",
            exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            details={"requested": BENCHMARK, "resolved": canonical_benchmark},
        )
    response = getattr(env, "multistep")(
        list(action_indices), observation_spaces=["IrInstructionCount"]
    )
    if not isinstance(response, (list, tuple)) or len(response) != 4:
        raise authoritative.EvaluatorFailure(
            code="invalid_prefilter_response",
            message="CompilerGym returned an unexpected raw-IR response",
            phase="prefilter",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={"response_type": type(response).__name__},
        )
    observations, _, done, info = response
    if type(done) is not bool or not isinstance(info, Mapping):
        raise authoritative.EvaluatorFailure(
            code="invalid_prefilter_response",
            message="CompilerGym returned malformed termination or info data",
            phase="prefilter",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
        )
    if not isinstance(observations, (list, tuple)) or len(observations) != 1:
        raise authoritative.EvaluatorFailure(
            code="invalid_prefilter_response",
            message="CompilerGym returned an unexpected raw-IR observation vector",
            phase="prefilter",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
        )
    return (
        _nonnegative_ir(observations[0], "prefilter"),
        done,
        info,
        str(getattr(env, "commandline")()),
    )


def _validated_callbacks(value: object) -> Sequence[object]:
    expected = authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS
    if not isinstance(value, (list, tuple)) or len(value) != expected:
        raise authoritative.EvaluatorFailure(
            code="base_callback_count_mismatch",
            message="Authoritative verifier did not select exactly 20 callbacks",
            phase="validation_setup",
            exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            details={
                "expected": expected,
                "observed": len(value) if isinstance(value, (list, tuple)) else None,
            },
        )
    return value


def _validated_outcomes(value: object) -> List[Dict[str, object]]:
    expected = authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS
    if not isinstance(value, (list, tuple)) or len(value) != expected:
        raise authoritative.EvaluatorFailure(
            code="validation_outcome_count_mismatch",
            message="Authoritative verifier did not return exactly 20 outcomes",
            phase="semantic_validation",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
        )
    outcomes: List[Dict[str, object]] = []
    for expected_index, item in enumerate(value, start=1):
        if not isinstance(item, Mapping):
            raise authoritative.EvaluatorFailure(
                code="invalid_validation_outcome",
                message="Authoritative verifier returned a non-object outcome",
                phase="semantic_validation",
                exit_code=authoritative.EXIT_EVALUATION_ERROR,
            )
        completed = item.get("completed")
        errors = item.get("errors")
        passed = item.get("passed")
        if (
            item.get("input_index") != expected_index
            or type(completed) is not bool
            or type(passed) is not bool
            or not isinstance(errors, list)
            or passed != (completed and len(errors) == 0)
        ):
            raise authoritative.EvaluatorFailure(
                code="invalid_validation_outcome",
                message="Authoritative verifier outcome violates its ordered schema",
                phase="semantic_validation",
                exit_code=authoritative.EXIT_EVALUATION_ERROR,
                details={"expected_input_index": expected_index},
            )
        outcomes.append(dict(item))
    return outcomes


def _verification_record(env: object, cbench: object) -> Dict[str, object]:
    callbacks, group_size, excluded_sanitizers = authoritative._select_base_callbacks(
        env, cbench, BENCHMARK
    )
    callbacks = _validated_callbacks(callbacks)
    outcomes, workers, worker_source = authoritative._run_full_validation(
        env, callbacks
    )
    outcomes = _validated_outcomes(outcomes)
    incomplete = [item for item in outcomes if not bool(item["completed"])]
    if incomplete:
        raise authoritative.EvaluatorFailure(
            code="semantic_validation_incomplete",
            message="Authoritative verifier did not complete all 20 callbacks",
            phase="semantic_validation",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={
                "inputs_expected": authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS,
                "inputs_completed": len(outcomes) - len(incomplete),
            },
        )
    if group_size != 5 or excluded_sanitizers != 80:
        raise authoritative.EvaluatorFailure(
            code="callback_layout_mismatch",
            message="Dijkstra verifier metadata differs from the pinned Linux layout",
            phase="validation_setup",
            exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            details={
                "registered_callback_group_size": group_size,
                "sanitizer_callbacks_excluded": excluded_sanitizers,
            },
        )
    if workers != CPUS_PER_TASK or worker_source != "SLURM_CPUS_PER_TASK":
        raise authoritative.EvaluatorFailure(
            code="validation_worker_contract_mismatch",
            message="Semantic verification escaped the single-CPU Slurm contract",
            phase="semantic_validation",
            exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            details={"workers": workers, "worker_count_source": worker_source},
        )
    semantic_errors = [
        error for item in outcomes for error in item.get("errors", [])
    ]
    passed = not semantic_errors
    return {
        "passed": passed,
        "inputs_expected": authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS,
        "inputs_completed": sum(
            1 for item in outcomes if bool(item["completed"])
        ),
        "base_callbacks_selected": len(callbacks),
        "sanitizer_callbacks_selected": 0,
        "sanitizer_callbacks_excluded": excluded_sanitizers,
        "registered_callback_group_size": group_size,
        "workers": workers,
        "worker_count_source": worker_source,
        "semantic_errors": semantic_errors,
        "inputs": outcomes,
    }


def _minimum_improvement(baseline_ir: int) -> int:
    fraction_threshold = (
        baseline_ir * MINIMUM_FRACTION_NUMERATOR
        + MINIMUM_FRACTION_DENOMINATOR
        - 1
    ) // MINIMUM_FRACTION_DENOMINATOR
    return max(MINIMUM_ABSOLUTE_IMPROVEMENT, fraction_threshold)


def _evaluate(_request: Mapping[str, object]) -> Tuple[Dict[str, object], int]:
    wall_started = perf_counter()
    cpu_started = _cpu_seconds()
    allocation = _verify_single_cpu_slurm_allocation()

    compiler_gym, cbench, ci_shortcut_neutralized = (
        authoritative._load_pinned_compiler_gym()
    )
    environment_seal = authoritative._verify_farmshare_environment(cbench)

    env = None
    try:
        env = compiler_gym.make(authoritative.ENVIRONMENT_ID)
        service_version = str(getattr(env, "version"))
        compiler_version = str(getattr(env, "compiler_version"))
        if service_version != authoritative.PINNED_COMPILER_GYM_VERSION:
            raise authoritative.EvaluatorFailure(
                code="service_version_mismatch",
                message="CompilerGym client and service versions do not match",
                phase="environment_create",
                exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            )
        if not (
            compiler_version == authoritative.PINNED_LLVM_VERSION
            or compiler_version.startswith(authoritative.PINNED_LLVM_VERSION + " ")
        ):
            raise authoritative.EvaluatorFailure(
                code="llvm_version_mismatch",
                message="CompilerGym service is not backed by pinned LLVM 10.0.0",
                phase="environment_create",
                exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            )

        runtime_flags = tuple(getattr(getattr(env, "action_space"), "flags"))
        if runtime_flags != authoritative.PINNED_LLVM_PASS_FLAGS:
            raise authoritative.EvaluatorFailure(
                code="action_space_mismatch",
                message="Runtime PassesAll action space differs from the pin",
                phase="environment_create",
                exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            )
        flag_to_index = {flag: index for index, flag in enumerate(runtime_flags)}

        scaffold_indices = [flag_to_index[action] for action in SCAFFOLD_WITHOUT_X]
        baseline_ir, baseline_done, baseline_info, baseline_commandline = _raw_episode(
            env, SCAFFOLD_WITHOUT_X, scaffold_indices
        )
        if baseline_done:
            raise authoritative.EvaluatorFailure(
                code="baseline_episode_terminated",
                message="LLVM terminated while applying the fixed scaffold",
                phase="prefilter",
                exit_code=authoritative.EXIT_EVALUATION_ERROR,
                details={"info": authoritative._json_safe(baseline_info)},
            )
        required_improvement = _minimum_improvement(baseline_ir)

        candidates: List[Dict[str, object]] = []
        budget_exhausted = False
        for flag in OMITTED_FLAGS:
            if _soft_budget_exhausted(cpu_started, wall_started):
                budget_exhausted = True
                break
            actions = list(SCAFFOLD_WITHOUT_X)
            actions.insert(INSERTION_INDEX, flag)
            action_indices = [flag_to_index[action] for action in actions]
            final_ir, done, info, commandline = _raw_episode(
                env, actions, action_indices
            )
            improvement = baseline_ir - final_ir
            qualified = not done and improvement >= required_improvement
            candidates.append(
                {
                    "flag": flag,
                    "actions": actions,
                    "action_indices": action_indices,
                    "commandline": commandline,
                    "prefilter": {
                        "status": "episode_terminated" if done else "measured",
                        "final_ir_instruction_count": final_ir,
                        "improvement_instructions": improvement,
                        "required_improvement_instructions": required_improvement,
                        "qualified": qualified,
                        "info": authoritative._json_safe(info),
                    },
                    "verification_status": (
                        "pending-verification" if qualified else "not-qualified"
                    ),
                    "terminal_object_text_size_bytes": None,
                    "verification": None,
                    "verified": False,
                }
            )

        verified_pass_count = 0
        if len(candidates) == len(OMITTED_FLAGS):
            for candidate in candidates:
                if candidate["verification_status"] != "pending-verification":
                    continue
                if verified_pass_count >= MINIMUM_VERIFIED_FLAGS:
                    candidate["verification_status"] = (
                        "not-needed-after-positive-gate"
                    )
                    continue
                if _soft_budget_exhausted(cpu_started, wall_started):
                    budget_exhausted = True
                    break
                actions = candidate["actions"]
                action_indices = candidate["action_indices"]
                if not isinstance(actions, list) or not isinstance(
                    action_indices, list
                ):
                    raise RuntimeError("Internal candidate action binding is invalid")
                replay_ir, replay_done, replay_info, replay_commandline = _raw_episode(
                    env, actions, action_indices
                )
                prefilter = candidate["prefilter"]
                if not isinstance(prefilter, dict):
                    raise RuntimeError("Internal candidate prefilter is invalid")
                if (
                    replay_done
                    or replay_ir != prefilter["final_ir_instruction_count"]
                    or replay_commandline != candidate["commandline"]
                ):
                    raise authoritative.EvaluatorFailure(
                        code="qualified_candidate_replay_mismatch",
                        message="Qualified candidate changed during terminal replay",
                        phase="semantic_validation",
                        exit_code=authoritative.EXIT_EVALUATION_ERROR,
                        details={
                            "flag": candidate["flag"],
                            "prefilter_ir": prefilter[
                                "final_ir_instruction_count"
                            ],
                            "replay_ir": replay_ir,
                            "replay_done": replay_done,
                            "replay_info": authoritative._json_safe(replay_info),
                        },
                    )
                observation = getattr(env, "observation")
                observed_ir = _nonnegative_ir(
                    observation["IrInstructionCount"], "semantic_validation"
                )
                if observed_ir != replay_ir:
                    raise authoritative.EvaluatorFailure(
                        code="prefilter_terminal_ir_mismatch",
                        message="Raw prefilter IR changed before semantic validation",
                        phase="semantic_validation",
                        exit_code=authoritative.EXIT_EVALUATION_ERROR,
                        details={"prefilter": replay_ir, "observed": observed_ir},
                    )
                candidate["terminal_object_text_size_bytes"] = (
                    authoritative._nonnegative_integer(
                        observation["ObjectTextSizeBytes"], "ObjectTextSizeBytes"
                    )
                )
                verification = _verification_record(env, cbench)
                candidate["verification"] = verification
                candidate["verification_status"] = "verified"
                candidate["verified"] = bool(verification["passed"])
                if candidate["verified"]:
                    verified_pass_count += 1

        for candidate in candidates:
            if candidate["verification_status"] == "pending-verification":
                candidate["verification_status"] = "not-run-budget-exhausted"

        action_space_name = str(getattr(getattr(env, "action_space"), "name", ""))
        try:
            env.close()
        except Exception as error:
            raise authoritative.EvaluatorFailure(
                code="environment_close_failed",
                message="CompilerGym environment failed to close cleanly",
                phase="environment_close",
                exit_code=authoritative.EXIT_EVALUATION_ERROR,
                details={
                    "exception_type": type(error).__name__,
                    "error": str(error),
                },
            ) from None
        env = None

        sweep_complete = len(candidates) == len(OMITTED_FLAGS)
        verified_flags = [
            str(candidate["flag"])
            for candidate in candidates
            if bool(candidate["verified"])
        ]
        qualified_count = sum(
            1
            for candidate in candidates
            if isinstance(candidate["prefilter"], dict)
            and bool(candidate["prefilter"]["qualified"])
        )
        verified_qualifier_count = sum(
            1
            for candidate in candidates
            if candidate["verification_status"] == "verified"
        )
        not_needed_after_positive_count = sum(
            1
            for candidate in candidates
            if candidate["verification_status"]
            == "not-needed-after-positive-gate"
        )
        not_run_budget_exhausted_count = sum(
            1
            for candidate in candidates
            if candidate["verification_status"] == "not-run-budget-exhausted"
        )
        negative_verification_complete = (
            sweep_complete and qualified_count == verified_qualifier_count
        )
        cpu_seconds = _cpu_seconds() - cpu_started
        wall_seconds = perf_counter() - wall_started
        within_cpu_cap = cpu_seconds <= EVALUATOR_CPU_MINUTES_LIMIT * 60
        within_wall_cap = wall_seconds <= TASK_WALL_MINUTES_LIMIT * 60
        soft_limit_exhausted = (
            budget_exhausted
            or cpu_seconds >= CPU_SECONDS_SOFT_LIMIT
            or wall_seconds >= WALL_SECONDS_SOFT_LIMIT
        )
        gate_passed = (
            sweep_complete
            and not soft_limit_exhausted
            and within_cpu_cap
            and within_wall_cap
            and len(verified_flags) >= MINIMUM_VERIFIED_FLAGS
        )
        apparatus_completed = (
            sweep_complete
            and not soft_limit_exhausted
            and within_cpu_cap
            and within_wall_cap
            and (gate_passed or negative_verification_complete)
        )
        status = (
            "passed"
            if gate_passed
            else "headroom_not_demonstrated"
            if apparatus_completed
            else "budget_exhausted"
        )
        result: Dict[str, object] = {
            "schema_version": SCHEMA_VERSION,
            "contract": EVALUATOR_CONTRACT,
            "protocol": PROTOCOL,
            "terminal_verifier_contract": authoritative.EVALUATOR_CONTRACT,
            "ok": gate_passed,
            "status": status,
            "apparatus_completed": apparatus_completed,
            "benchmark": BENCHMARK,
            "request_sha256": REQUEST_SHA256,
            "cohort": {
                "allowed_flag_count": len(runtime_flags),
                "allowed_flags_sha256": ALLOWED_FLAGS_SHA256,
                "shown_flag_count": len(SHOWN_FLAGS),
                "shown_flags_sha256": SHOWN_FLAGS_SHA256,
                "omitted_flag_count": len(OMITTED_FLAGS),
                "omitted_flags_sha256": OMITTED_FLAGS_SHA256,
            },
            "baseline": {
                "actions": list(SCAFFOLD_WITHOUT_X),
                "action_indices": scaffold_indices,
                "commandline": baseline_commandline,
                "ir_instruction_count": baseline_ir,
                "semantic_status": "raw-prefilter-only",
            },
            "prefilter": {
                "metric": "IrInstructionCount",
                "minimum_absolute_improvement": MINIMUM_ABSOLUTE_IMPROVEMENT,
                "minimum_fraction_numerator": MINIMUM_FRACTION_NUMERATOR,
                "minimum_fraction_denominator": MINIMUM_FRACTION_DENOMINATOR,
                "required_improvement_instructions": required_improvement,
                "semantic_status": "unverified-unless-qualified",
            },
            "candidates": candidates,
            "sweep_complete": sweep_complete,
            "verified_omitted_flags": verified_flags,
            "verifier_schedule": {
                "order": "qualified-candidates-in-omitted-flag-order",
                "policy": "stop-after-two-verified-passes-else-verify-all-qualifiers",
                "qualified_flag_count": qualified_count,
                "verified_qualifier_count": verified_qualifier_count,
                "not_needed_after_positive_count": not_needed_after_positive_count,
                "not_run_budget_exhausted_count": not_run_budget_exhausted_count,
                "early_positive_stop": not_needed_after_positive_count > 0,
                "negative_verification_complete": negative_verification_complete,
            },
            "pass_gate": {
                "minimum_distinct_verified_omitted_flags": MINIMUM_VERIFIED_FLAGS,
                "observed_distinct_verified_omitted_flags": len(verified_flags),
                "passed": gate_passed,
            },
            "budget": {
                "model_calls": 0,
                "allocation_count": ALLOCATION_COUNT,
                "cpus_per_task": CPUS_PER_TASK,
                "evaluator_cpu_minutes_limit": EVALUATOR_CPU_MINUTES_LIMIT,
                "task_wall_minutes_limit": TASK_WALL_MINUTES_LIMIT,
                "scheduler_logical_cpus_per_allocation": SCHEDULER_LOGICAL_CPUS_PER_ALLOCATION,
                "scheduler_logical_cpu_minutes_maximum": SCHEDULER_LOGICAL_CPU_MINUTES_MAXIMUM,
                "cpu_seconds_soft_limit": CPU_SECONDS_SOFT_LIMIT,
                "wall_seconds_soft_limit": WALL_SECONDS_SOFT_LIMIT,
                "allocation_time_limit": ALLOCATION_TIME_LIMIT,
                "cpu_seconds_observed": cpu_seconds,
                "wall_seconds_observed": wall_seconds,
                "within_cpu_cap": within_cpu_cap,
                "within_wall_cap": within_wall_cap,
                "soft_limit_exhausted": soft_limit_exhausted,
            },
            "environment": {
                **allocation,
                "python_version": platform.python_version(),
                "compiler_gym_version": authoritative.PINNED_COMPILER_GYM_VERSION,
                "compiler_gym_service_version": service_version,
                "llvm_compiler_version": compiler_version,
                "environment_id": authoritative.ENVIRONMENT_ID,
                "action_space": action_space_name,
                "seal": environment_seal,
            },
            "provenance": {
                "compiler_gym_release": authoritative.PINNED_COMPILER_GYM_RELEASE,
                "contract_upstream_commit": authoritative.PINNED_COMPILER_GYM_COMMIT,
                "upstream_cbench_source_sha256": authoritative.UPSTREAM_CBENCH_SOURCE_SHA256,
                "cbench_patch_sha256": authoritative.PINNED_CBENCH_PATCH_SHA256,
                "ci_two_input_shortcut_neutralized": ci_shortcut_neutralized,
                "terminal_validation_contract": (
                    "first non-sanitized callback from each known 20-input group"
                ),
            },
            "timings_seconds": {
                "wall": wall_seconds,
                "cpu": cpu_seconds,
            },
        }
    except Exception:
        if env is not None:
            try:
                env.close()
            except Exception:
                pass
        raise

    return result, authoritative.EXIT_OK


def _failure_result(
    failure: authoritative.EvaluatorFailure,
    total_seconds: float,
) -> Dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "contract": EVALUATOR_CONTRACT,
        "protocol": PROTOCOL,
        "ok": False,
        "status": "error",
        "error": {
            "code": failure.code,
            "message": failure.message,
            "phase": failure.phase,
            "details": authoritative._json_safe(failure.details),
        },
        "timings_seconds": {"total": total_seconds},
    }


def main() -> int:
    started = perf_counter()
    try:
        request = _parse_request()
        with authoritative._redirect_process_stdout_to_stderr():
            result, exit_code = _evaluate(request)
    except authoritative.EvaluatorFailure as failure:
        result = _failure_result(failure, perf_counter() - started)
        exit_code = failure.exit_code
    except Exception as error:
        failure = authoritative.EvaluatorFailure(
            code="unhandled_headroom_evaluation_error",
            message="Complete-action-space headroom evaluation failed",
            phase="evaluation",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={"exception_type": type(error).__name__, "error": str(error)},
        )
        result = _failure_result(failure, perf_counter() - started)
        exit_code = failure.exit_code
    print(
        json.dumps(
            authoritative._json_safe(result),
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ),
        flush=True,
    )
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

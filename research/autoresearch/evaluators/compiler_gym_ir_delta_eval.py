#!/usr/bin/env python3
"""Run the trusted cBench verifier while collecting same-environment IR deltas.

This evaluator preserves ``compiler_gym_eval`` as the source of truth for the
environment seal, terminal raw metrics, and all 20 semantic callbacks. The only
execution change is that actions are applied one at a time in the authoritative
environment so each step can return ``IrInstructionCount``. Intermediate
observations are diagnostic and receive no semantic verification.
"""

from __future__ import annotations

import json
import os
import platform
import sys
from time import perf_counter
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

import compiler_gym_eval as authoritative


EVALUATOR_CONTRACT = "compiler-gym-v0.2.5-single-environment-ir-delta-v1"
ACTION_TRACE_CONTRACT = "compiler-gym-single-environment-ir-delta-trace-v1"
ZERO_DELTA_SEMANTICS = (
    "A zero delta means only that the observed IrInstructionCount was unchanged "
    "across this action; it does not imply that LLVM IR, module state, or program "
    "semantics were unchanged."
)
INTERMEDIATE_SEMANTIC_STATUS = "unverified"
TERMINAL_SEMANTIC_STATUS = "canonical-20-input-verifier"


def _action_failure(
    code: str,
    message: str,
    details: Optional[Mapping[str, object]] = None,
) -> authoritative.EvaluatorFailure:
    return authoritative.EvaluatorFailure(
        code=code,
        message=message,
        phase="actions",
        exit_code=authoritative.EXIT_EVALUATION_ERROR,
        details=details,
    )


def _step_response(
    value: object, position: int
) -> Tuple[object, object, bool, Mapping[str, object]]:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise _action_failure(
            "invalid_step_response",
            "CompilerGym returned an unexpected step response",
            {"position": position, "response_type": type(value).__name__},
        )
    observations, reward, done, info = value
    if type(done) is not bool:
        raise _action_failure(
            "invalid_step_termination",
            "CompilerGym returned a non-boolean termination signal",
            {
                "position": position,
                "observed": authoritative._json_safe(done),
            },
        )
    if not isinstance(info, Mapping):
        raise _action_failure(
            "invalid_step_info",
            "CompilerGym returned a non-object step info value",
            {"position": position, "response_type": type(info).__name__},
        )
    return observations, reward, done, info


def _step_ir_observation(value: object, position: int) -> int:
    if not isinstance(value, (list, tuple)) or len(value) != 1:
        raise _action_failure(
            "invalid_ir_observation",
            "CompilerGym returned an unexpected IR observation",
            {"position": position, "response_type": type(value).__name__},
        )
    try:
        return authoritative._nonnegative_integer(
            value[0], authoritative.RAW_METRIC_NAMES[0]
        )
    except (TypeError, ValueError) as error:
        raise _action_failure(
            "invalid_ir_observation",
            "CompilerGym returned an invalid IR instruction count",
            {
                "position": position,
                "observed": authoritative._json_safe(value[0]),
                "error": str(error),
            },
        ) from None


def _final_step_observations(value: object, position: int) -> Dict[str, int]:
    if not isinstance(value, (list, tuple)) or len(value) != len(
        authoritative.RAW_METRIC_NAMES
    ):
        raise _action_failure(
            "invalid_final_observation",
            "CompilerGym returned unexpected terminal metric observations",
            {"position": position, "response_type": type(value).__name__},
        )
    try:
        return {
            name: authoritative._nonnegative_integer(observation, name)
            for name, observation in zip(authoritative.RAW_METRIC_NAMES, value)
        }
    except (TypeError, ValueError) as error:
        raise _action_failure(
            "invalid_final_observation",
            "CompilerGym returned an invalid terminal metric observation",
            {
                "position": position,
                "observed": authoritative._json_safe(value),
                "error": str(error),
            },
        ) from None


def _apply_actions_with_ir_deltas(
    env: object,
    actions: Sequence[str],
    action_indices: Sequence[int],
    initial_ir: int,
) -> Tuple[Dict[str, int], List[Dict[str, object]]]:
    if len(actions) != len(action_indices):
        raise _action_failure(
            "action_binding_mismatch",
            "Action and action-index lengths differ",
            {"actions": len(actions), "action_indices": len(action_indices)},
        )

    if not actions:
        raise _action_failure(
            "empty_action_trace",
            "IR-delta action application requires a non-empty action sequence",
        )

    previous_ir = initial_ir
    final_metrics: Optional[Dict[str, int]] = None
    records: List[Dict[str, object]] = []
    for position, (action, action_index) in enumerate(zip(actions, action_indices)):
        is_final_action = position == len(actions) - 1
        observation_spaces = (
            list(authoritative.RAW_METRIC_NAMES)
            if is_final_action
            else [authoritative.RAW_METRIC_NAMES[0]]
        )
        response = getattr(env, "step")(
            action_index,
            observation_spaces=observation_spaces,
        )
        observations, _, done, info = _step_response(response, position)
        if done:
            raise _action_failure(
                "compiler_episode_terminated",
                "LLVM terminated while applying the action sequence",
                {"position": position, "info": authoritative._json_safe(info)},
            )
        if is_final_action:
            final_metrics = _final_step_observations(observations, position)
            current_ir = final_metrics[authoritative.RAW_METRIC_NAMES[0]]
        else:
            current_ir = _step_ir_observation(observations, position)
        records.append(
            {
                "index": position,
                "action": action,
                "action_index": action_index,
                "delta_from_previous": current_ir - previous_ir,
            }
        )
        previous_ir = current_ir
    if final_metrics is None:
        raise _action_failure(
            "missing_final_observation",
            "CompilerGym did not return terminal metric observations",
        )
    return final_metrics, records


def _action_trace(
    benchmark: str,
    actions: Sequence[str],
    action_indices: Sequence[int],
    initial_ir: int,
    records: Sequence[Mapping[str, object]],
) -> Dict[str, object]:
    return {
        "contract": ACTION_TRACE_CONTRACT,
        "prefix_conditional": True,
        "intermediate_semantic_status": INTERMEDIATE_SEMANTIC_STATUS,
        "terminal_semantic_status": TERMINAL_SEMANTIC_STATUS,
        "zero_delta_semantics": ZERO_DELTA_SEMANTICS,
        "benchmark": benchmark,
        "actions": list(actions),
        "action_indices": list(action_indices),
        "initial_ir_instruction_count": initial_ir,
        "records": [dict(record) for record in records],
    }


def _validated_callbacks(value: object) -> Sequence[object]:
    if not isinstance(value, (list, tuple)) or len(
        value
    ) != authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS:
        raise authoritative.EvaluatorFailure(
            code="base_callback_count_mismatch",
            message="Terminal verifier did not select exactly 20 base callbacks",
            phase="validation_setup",
            exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
            details={
                "expected": authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS,
                "observed": len(value) if isinstance(value, (list, tuple)) else None,
                "observed_type": type(value).__name__,
            },
        )
    return value


def _validated_outcomes(value: object) -> List[Dict[str, object]]:
    expected_count = authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS
    if not isinstance(value, (list, tuple)) or len(value) != expected_count:
        raise authoritative.EvaluatorFailure(
            code="validation_outcome_count_mismatch",
            message="Terminal verifier did not return exactly 20 outcomes",
            phase="semantic_validation",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={
                "expected": expected_count,
                "observed": len(value) if isinstance(value, (list, tuple)) else None,
                "observed_type": type(value).__name__,
            },
        )

    outcomes: List[Dict[str, object]] = []
    for expected_index, item in enumerate(value, start=1):
        if not isinstance(item, Mapping):
            raise authoritative.EvaluatorFailure(
                code="invalid_validation_outcome",
                message="Terminal verifier returned a non-object outcome",
                phase="semantic_validation",
                exit_code=authoritative.EXIT_EVALUATION_ERROR,
                details={
                    "expected_input_index": expected_index,
                    "observed_type": type(item).__name__,
                },
            )
        input_index = item.get("input_index")
        completed = item.get("completed")
        passed = item.get("passed")
        errors = item.get("errors")
        if (
            type(input_index) is not int
            or input_index != expected_index
            or type(completed) is not bool
            or type(passed) is not bool
            or not isinstance(errors, list)
        ):
            raise authoritative.EvaluatorFailure(
                code="invalid_validation_outcome",
                message="Terminal verifier outcome violates the ordered result schema",
                phase="semantic_validation",
                exit_code=authoritative.EXIT_EVALUATION_ERROR,
                details={
                    "expected_input_index": expected_index,
                    "observed_input_index": authoritative._json_safe(input_index),
                    "completed": authoritative._json_safe(completed),
                    "passed": authoritative._json_safe(passed),
                    "errors_type": type(errors).__name__,
                },
            )
        expected_passed = completed and len(errors) == 0
        if passed != expected_passed:
            raise authoritative.EvaluatorFailure(
                code="contradictory_validation_outcome",
                message="Terminal verifier outcome has contradictory status fields",
                phase="semantic_validation",
                exit_code=authoritative.EXIT_EVALUATION_ERROR,
                details={
                    "input_index": input_index,
                    "completed": completed,
                    "passed": passed,
                    "error_count": len(errors),
                    "expected_passed": expected_passed,
                },
            )
        outcomes.append(dict(item))
    return outcomes


def _evaluate(request: Mapping[str, object]) -> Tuple[Dict[str, object], int]:
    timings: Dict[str, float] = {}

    started = perf_counter()
    compiler_gym, cbench, ci_shortcut_neutralized = (
        authoritative._load_pinned_compiler_gym()
    )
    timings["dependency_import"] = authoritative._seconds(started)
    started = perf_counter()
    environment_seal = authoritative._verify_farmshare_environment(cbench)
    timings["environment_seal"] = authoritative._seconds(started)

    env = None
    try:
        started = perf_counter()
        env = compiler_gym.make(authoritative.ENVIRONMENT_ID)
        timings["environment_create"] = authoritative._seconds(started)

        service_version = str(getattr(env, "version"))
        compiler_version = str(getattr(env, "compiler_version"))
        if service_version != authoritative.PINNED_COMPILER_GYM_VERSION:
            raise authoritative.EvaluatorFailure(
                code="service_version_mismatch",
                message="CompilerGym client and service versions do not match the pin",
                phase="environment_create",
                exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
                details={"service_version": service_version},
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
                details={"compiler_version": compiler_version},
            )

        benchmark = str(request["benchmark"])
        actions = list(request["actions"])
        started = perf_counter()
        env.reset(benchmark=benchmark)
        timings["reset"] = authoritative._seconds(started)
        canonical_benchmark = str(getattr(env, "benchmark"))
        if canonical_benchmark != benchmark:
            raise authoritative.EvaluatorFailure(
                code="benchmark_canonicalization_mismatch",
                message="CompilerGym resolved a different benchmark URI",
                phase="reset",
                exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
                details={"requested": benchmark, "resolved": canonical_benchmark},
            )

        runtime_flags = tuple(getattr(getattr(env, "action_space"), "flags"))
        if runtime_flags != authoritative.PINNED_LLVM_PASS_FLAGS:
            raise authoritative.EvaluatorFailure(
                code="action_space_mismatch",
                message="Runtime PassesAll action space differs from the pinned allowlist",
                phase="reset",
                exit_code=authoritative.EXIT_ENVIRONMENT_ERROR,
                details={
                    "expected_count": len(authoritative.PINNED_LLVM_PASS_FLAGS),
                    "runtime_count": len(runtime_flags),
                },
            )
        flag_to_index = {flag: index for index, flag in enumerate(runtime_flags)}
        action_indices = [flag_to_index[action] for action in actions]
        bound_actions = [runtime_flags[index] for index in action_indices]
        if bound_actions != actions:
            raise _action_failure(
                "action_binding_mismatch",
                "Runtime action binding differs from the parsed request",
                {"requested": actions, "bound": bound_actions},
            )

        started = perf_counter()
        initial_metrics = authoritative._read_raw_metrics(env)
        timings["initial_observations"] = authoritative._seconds(started)

        started = perf_counter()
        if action_indices:
            final_metrics, records = _apply_actions_with_ir_deltas(
                env,
                actions,
                action_indices,
                initial_metrics[authoritative.RAW_METRIC_NAMES[0]],
            )
        else:
            final_metrics = dict(initial_metrics)
            records = []
        timings["actions_and_final_observations"] = authoritative._seconds(started)
        commandline = str(env.commandline())

        started = perf_counter()
        callbacks, callback_group_size, excluded_sanitizer_callbacks = (
            authoritative._select_base_callbacks(env, cbench, benchmark)
        )
        callbacks = _validated_callbacks(callbacks)
        timings["validation_setup"] = authoritative._seconds(started)

        started = perf_counter()
        validation_inputs, workers, worker_source = authoritative._run_full_validation(
            env, callbacks
        )
        validation_inputs = _validated_outcomes(validation_inputs)
        timings["semantic_validation"] = authoritative._seconds(started)

        incomplete_inputs = [
            item for item in validation_inputs if not bool(item["completed"])
        ]
        semantic_errors = [
            error for item in validation_inputs for error in item.get("errors", [])
        ]
        validation_passed = not incomplete_inputs and not semantic_errors

        result: Dict[str, object] = {
            "schema_version": authoritative.SCHEMA_VERSION,
            "contract": EVALUATOR_CONTRACT,
            "terminal_verifier_contract": authoritative.EVALUATOR_CONTRACT,
            "ok": validation_passed,
            "status": (
                "passed"
                if validation_passed
                else (
                    "validation_incomplete"
                    if incomplete_inputs
                    else "semantic_validation_failed"
                )
            ),
            "benchmark": canonical_benchmark,
            "request": {
                "benchmark": canonical_benchmark,
                "actions": actions,
            },
            "action_indices": action_indices,
            "commandline": commandline,
            "metrics": authoritative._derived_metrics(
                initial_metrics, final_metrics
            ),
            "validation": {
                "passed": validation_passed,
                "inputs_expected": authoritative.EXPECTED_CBENCH_VALIDATION_INPUTS,
                "inputs_completed": sum(
                    1 for item in validation_inputs if bool(item["completed"])
                ),
                "base_callbacks_selected": len(callbacks),
                "sanitizer_callbacks_selected": 0,
                "sanitizer_callbacks_excluded": excluded_sanitizer_callbacks,
                "registered_callback_group_size": callback_group_size,
                "workers": workers,
                "worker_count_source": worker_source,
                "semantic_errors": semantic_errors,
                "inputs": validation_inputs,
            },
            "environment": {
                "python_version": platform.python_version(),
                "platform": sys.platform,
                "platform_release": platform.release(),
                "machine": platform.machine(),
                "compiler_gym_version": authoritative.PINNED_COMPILER_GYM_VERSION,
                "compiler_gym_service_version": service_version,
                "llvm_compiler_version": compiler_version,
                "environment_id": authoritative.ENVIRONMENT_ID,
                "action_space": str(
                    getattr(getattr(env, "action_space"), "name", "")
                ),
                "slurm_job_id": os.environ.get("SLURM_JOB_ID"),
                "slurm_cpus_per_task": os.environ.get("SLURM_CPUS_PER_TASK"),
                "seal": environment_seal,
            },
            "provenance": {
                "compiler_gym_release": authoritative.PINNED_COMPILER_GYM_RELEASE,
                "contract_upstream_commit": authoritative.PINNED_COMPILER_GYM_COMMIT,
                "contract_upstream_source": authoritative.PINNED_COMPILER_GYM_SOURCE_URL,
                "upstream_cbench_source_sha256": (
                    authoritative.UPSTREAM_CBENCH_SOURCE_SHA256
                ),
                "cbench_patch_sha256": authoritative.PINNED_CBENCH_PATCH_SHA256,
                "pinned_installed_cbench_source_sha256": (
                    authoritative.PINNED_INSTALLED_CBENCH_SOURCE_SHA256
                ),
                "installed_cbench_source_sha256": environment_seal[
                    "installed_cbench_source_sha256"
                ],
                "installed_cbench_source_matches_pin": True,
                "farmshare_environment_seal_passed": True,
                "cbench_dataset": "benchmark://cbench-v1",
                "cbench_manifest_sha256": authoritative._CBENCH_MANIFEST_SHA256,
                "cbench_bitcode_archive_sha256": (
                    authoritative._CBENCH_BITCODE_SHA256[sys.platform]
                ),
                "cbench_runtime_data_sha256": (
                    authoritative._CBENCH_RUNTIME_DATA_SHA256
                ),
                "cbench_bitcode_llvm_version": authoritative.PINNED_LLVM_VERSION,
                "metric_contract": "raw CompilerGym observations; lower is better",
                "validation_contract": (
                    "first non-sanitized callback from each known 20-input group"
                ),
                "ci_two_input_shortcut_neutralized": ci_shortcut_neutralized,
                "allowed_benchmark_count": len(
                    authoritative.ALLOWED_CBENCH_BENCHMARKS
                ),
                "allowed_action_count": len(authoritative.PINNED_LLVM_PASS_FLAGS),
            },
            "step_info": {
                "retained": False,
                "reason": (
                    "Pass-reported per-step modification metadata is outside the "
                    "verifier contract."
                ),
            },
            "timings_seconds": timings,
        }
        if validation_passed:
            result["action_trace"] = _action_trace(
                canonical_benchmark,
                actions,
                action_indices,
                initial_metrics[authoritative.RAW_METRIC_NAMES[0]],
                records,
            )

        if incomplete_inputs:
            exit_code = authoritative.EXIT_EVALUATION_ERROR
        elif semantic_errors:
            exit_code = authoritative.EXIT_SEMANTIC_VALIDATION_FAILED
        else:
            exit_code = authoritative.EXIT_OK
    except Exception:
        if env is not None:
            close_started = perf_counter()
            try:
                env.close()
            except Exception:
                pass
            timings["environment_close"] = authoritative._seconds(close_started)
        raise

    close_started = perf_counter()
    try:
        env.close()
    except Exception as error:
        raise authoritative.EvaluatorFailure(
            code="environment_close_failed",
            message="CompilerGym environment failed to close cleanly",
            phase="environment_close",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={"exception_type": type(error).__name__, "error": str(error)},
        ) from None
    timings["environment_close"] = authoritative._seconds(close_started)
    return result, exit_code


def _failure_result(
    failure: authoritative.EvaluatorFailure,
    total_seconds: float,
    request: Optional[Mapping[str, object]],
) -> Dict[str, object]:
    result = authoritative._failure_result(failure, total_seconds, request)
    result["contract"] = EVALUATOR_CONTRACT
    result["terminal_verifier_contract"] = authoritative.EVALUATOR_CONTRACT
    return result


def main() -> int:
    process_started = perf_counter()
    request: Optional[Dict[str, object]] = None
    try:
        parse_started = perf_counter()
        request = authoritative._parse_request()
        parse_seconds = authoritative._seconds(parse_started)
        with authoritative._redirect_process_stdout_to_stderr():
            result, exit_code = _evaluate(request)
        timings = result.get("timings_seconds")
        if isinstance(timings, dict):
            timings["request_parse"] = parse_seconds
            timings["total"] = authoritative._seconds(process_started)
    except authoritative.EvaluatorFailure as failure:
        result = _failure_result(
            failure, authoritative._seconds(process_started), request
        )
        exit_code = failure.exit_code
    except Exception as error:
        failure = authoritative.EvaluatorFailure(
            code="unhandled_ir_delta_evaluation_error",
            message="CompilerGym IR-delta evaluation failed",
            phase="evaluation",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={"exception_type": type(error).__name__, "error": str(error)},
        )
        result = _failure_result(
            failure, authoritative._seconds(process_started), request
        )
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

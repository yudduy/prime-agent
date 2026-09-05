#!/usr/bin/env python3
"""Add a verifier-separated, prefix-conditional action trace to CompilerGym.

The existing ``compiler_gym_eval`` module remains the sole authority for the
terminal metrics and semantic validation. After that evaluator accepts a
candidate, this wrapper creates a second fresh environment and replays the same
actions one at a time. Intermediate IR observations are diagnostic only and
are never semantically verified or admitted as candidate measurements.
"""

from __future__ import annotations

import json
import sys
from time import perf_counter
from typing import Dict, List, Mapping, Optional, Tuple

import compiler_gym_eval as authoritative


ACTION_TRACE_CONTRACT = "compiler-gym-shadow-action-trace-v1"
INTERMEDIATE_SEMANTIC_STATUS = "unverified"
TERMINAL_SEMANTIC_STATUS = "authoritative-final-verifier-only"


def _shadow_failure(
    code: str,
    message: str,
    details: Optional[Mapping[str, object]] = None,
) -> authoritative.EvaluatorFailure:
    return authoritative.EvaluatorFailure(
        code=code,
        message=message,
        phase="shadow_action_trace",
        exit_code=authoritative.EXIT_EVALUATION_ERROR,
        details=details,
    )


def _mapping(value: object, field: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise _shadow_failure(
            "authoritative_result_invalid",
            f"Authoritative result field {field} is not an object",
            {"field": field, "observed_type": type(value).__name__},
        )
    return value


def _string_list(value: object, field: str) -> List[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise _shadow_failure(
            "authoritative_result_invalid",
            f"Authoritative result field {field} is not a string array",
            {"field": field, "observed_type": type(value).__name__},
        )
    return list(value)


def _integer_list(value: object, field: str) -> List[int]:
    if not isinstance(value, list):
        raise _shadow_failure(
            "authoritative_result_invalid",
            f"Authoritative result field {field} is not an integer array",
            {"field": field, "observed_type": type(value).__name__},
        )
    result: List[int] = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, int) or item < 0:
            raise _shadow_failure(
                "authoritative_result_invalid",
                f"Authoritative result field {field}[{index}] is not a nonnegative integer",
                {"field": field, "index": index, "value": authoritative._json_safe(item)},
            )
        result.append(item)
    return result


def _authoritative_binding(
    request: Mapping[str, object], result: Mapping[str, object]
) -> Tuple[str, List[str], List[int], str, int, int, int]:
    canonical_request = _mapping(result.get("request"), "request")
    benchmark = canonical_request.get("benchmark")
    if not isinstance(benchmark, str):
        raise _shadow_failure(
            "authoritative_result_invalid",
            "Authoritative result request benchmark is not a string",
        )
    actions = _string_list(canonical_request.get("actions"), "request.actions")
    action_indices = _integer_list(result.get("action_indices"), "action_indices")
    commandline = result.get("commandline")
    if not isinstance(commandline, str):
        raise _shadow_failure(
            "authoritative_result_invalid",
            "Authoritative result commandline is not a string",
        )
    metrics = _mapping(result.get("metrics"), "metrics")
    initial_metrics = _mapping(metrics.get("initial"), "metrics.initial")
    final_metrics = _mapping(metrics.get("final"), "metrics.final")
    initial_ir = authoritative._nonnegative_integer(
        initial_metrics.get("IrInstructionCount"), "IrInstructionCount"
    )
    final_ir = authoritative._nonnegative_integer(
        final_metrics.get("IrInstructionCount"), "IrInstructionCount"
    )
    final_object = authoritative._nonnegative_integer(
        final_metrics.get("ObjectTextSizeBytes"), "ObjectTextSizeBytes"
    )

    requested_benchmark = request.get("benchmark")
    requested_actions = request.get("actions")
    if benchmark != requested_benchmark or actions != requested_actions:
        raise _shadow_failure(
            "shadow_action_trace_mismatch",
            "Authoritative result request differs from the parsed request",
            {
                "expected_benchmark": requested_benchmark,
                "observed_benchmark": benchmark,
                "expected_actions": authoritative._json_safe(requested_actions),
                "observed_actions": actions,
            },
        )
    if len(actions) != len(action_indices):
        raise _shadow_failure(
            "authoritative_result_invalid",
            "Authoritative action and action-index lengths differ",
            {"actions": len(actions), "action_indices": len(action_indices)},
        )
    return (
        benchmark,
        actions,
        action_indices,
        commandline,
        initial_ir,
        final_ir,
        final_object,
    )


def _step_ir_observation(value: object, position: int) -> int:
    if not isinstance(value, (list, tuple)) or len(value) != 1:
        raise _shadow_failure(
            "shadow_ir_observation_invalid",
            "CompilerGym shadow step returned an unexpected IR observation",
            {"position": position, "observed_type": type(value).__name__},
        )
    return authoritative._nonnegative_integer(value[0], "IrInstructionCount")


def _shadow_action_trace(
    request: Mapping[str, object], result: Mapping[str, object]
) -> Dict[str, object]:
    (
        benchmark,
        authoritative_actions,
        authoritative_action_indices,
        authoritative_commandline,
        authoritative_initial_ir,
        authoritative_final_ir,
        authoritative_final_object,
    ) = _authoritative_binding(request, result)

    compiler_gym, _, _ = authoritative._load_pinned_compiler_gym()
    env = None
    try:
        env = compiler_gym.make(authoritative.ENVIRONMENT_ID)
        service_version = str(getattr(env, "version"))
        compiler_version = str(getattr(env, "compiler_version"))
        if service_version != authoritative.PINNED_COMPILER_GYM_VERSION:
            raise _shadow_failure(
                "shadow_service_version_mismatch",
                "Shadow CompilerGym service version differs from the pin",
                {
                    "expected": authoritative.PINNED_COMPILER_GYM_VERSION,
                    "observed": service_version,
                },
            )
        if not (
            compiler_version == authoritative.PINNED_LLVM_VERSION
            or compiler_version.startswith(authoritative.PINNED_LLVM_VERSION + " ")
        ):
            raise _shadow_failure(
                "shadow_llvm_version_mismatch",
                "Shadow CompilerGym service is not backed by pinned LLVM",
                {"observed": compiler_version},
            )

        env.reset(benchmark=benchmark)
        shadow_benchmark = str(getattr(env, "benchmark"))
        if shadow_benchmark != benchmark:
            raise _shadow_failure(
                "shadow_action_trace_mismatch",
                "Shadow environment resolved a different benchmark",
                {"expected": benchmark, "observed": shadow_benchmark},
            )

        runtime_flags = tuple(getattr(getattr(env, "action_space"), "flags"))
        if runtime_flags != authoritative.PINNED_LLVM_PASS_FLAGS:
            raise _shadow_failure(
                "shadow_action_space_mismatch",
                "Shadow PassesAll action space differs from the pinned allowlist",
                {
                    "expected_count": len(authoritative.PINNED_LLVM_PASS_FLAGS),
                    "observed_count": len(runtime_flags),
                },
            )
        flag_to_index = {flag: index for index, flag in enumerate(runtime_flags)}
        shadow_action_indices = [flag_to_index[action] for action in authoritative_actions]
        shadow_actions = [runtime_flags[index] for index in shadow_action_indices]
        if (
            shadow_actions != authoritative_actions
            or shadow_action_indices != authoritative_action_indices
        ):
            raise _shadow_failure(
                "shadow_action_trace_mismatch",
                "Shadow actions differ from the authoritative action binding",
                {
                    "expected_actions": authoritative_actions,
                    "observed_actions": shadow_actions,
                    "expected_action_indices": authoritative_action_indices,
                    "observed_action_indices": shadow_action_indices,
                },
            )

        observation = getattr(env, "observation")
        initial_ir = authoritative._nonnegative_integer(
            observation["IrInstructionCount"], "IrInstructionCount"
        )
        if initial_ir != authoritative_initial_ir:
            raise _shadow_failure(
                "shadow_action_trace_mismatch",
                "Shadow initial IR differs from the authoritative evaluator",
                {
                    "initial_IrInstructionCount": {
                        "authoritative": authoritative_initial_ir,
                        "shadow": initial_ir,
                    }
                },
            )
        previous_ir = initial_ir
        records: List[Dict[str, object]] = []
        for position, (action, action_index) in enumerate(
            zip(shadow_actions, shadow_action_indices)
        ):
            observations, _, done, info = env.step(
                action_index,
                observation_spaces=["IrInstructionCount"],
            )
            if done:
                raise _shadow_failure(
                    "shadow_compiler_episode_terminated",
                    "LLVM terminated during shadow action replay",
                    {"position": position, "info": authoritative._json_safe(info)},
                )
            current_ir = _step_ir_observation(observations, position)
            if not isinstance(info, Mapping):
                raise _shadow_failure(
                    "shadow_step_info_invalid",
                    "CompilerGym shadow step info is not an object",
                    {"position": position, "observed_type": type(info).__name__},
                )
            action_had_no_effect = info.get("action_had_no_effect")
            if type(action_had_no_effect) is not bool:
                raise _shadow_failure(
                    "shadow_action_had_no_effect_invalid",
                    "CompilerGym did not return an exact boolean action_had_no_effect",
                    {
                        "position": position,
                        "observed": authoritative._json_safe(action_had_no_effect),
                    },
                )
            records.append(
                {
                    "index": position,
                    "action": action,
                    "action_index": action_index,
                    "ir_instruction_count": current_ir,
                    "delta_from_previous": current_ir - previous_ir,
                    "action_had_no_effect": action_had_no_effect,
                }
            )
            previous_ir = current_ir

        final_ir = previous_ir
        final_object = authoritative._nonnegative_integer(
            observation["ObjectTextSizeBytes"], "ObjectTextSizeBytes"
        )
        commandline = str(env.commandline())
        mismatches: Dict[str, object] = {}
        if final_ir != authoritative_final_ir:
            mismatches["IrInstructionCount"] = {
                "authoritative": authoritative_final_ir,
                "shadow": final_ir,
            }
        if final_object != authoritative_final_object:
            mismatches["ObjectTextSizeBytes"] = {
                "authoritative": authoritative_final_object,
                "shadow": final_object,
            }
        if commandline != authoritative_commandline:
            mismatches["commandline"] = {
                "authoritative": authoritative_commandline,
                "shadow": commandline,
            }
        if mismatches:
            raise _shadow_failure(
                "shadow_action_trace_mismatch",
                "Shadow terminal state differs from the authoritative evaluator",
                mismatches,
            )

        trace: Dict[str, object] = {
            "contract": ACTION_TRACE_CONTRACT,
            "prefix_conditional": True,
            "intermediate_semantic_status": INTERMEDIATE_SEMANTIC_STATUS,
            "terminal_semantic_status": TERMINAL_SEMANTIC_STATUS,
            "benchmark": benchmark,
            "actions": shadow_actions,
            "action_indices": shadow_action_indices,
            "initial_ir_instruction_count": initial_ir,
            "records": records,
            "final": {
                "IrInstructionCount": final_ir,
                "ObjectTextSizeBytes": final_object,
            },
            "commandline": commandline,
        }
    except Exception:
        if env is not None:
            try:
                env.close()
            except Exception:
                pass
        raise

    try:
        env.close()
    except Exception as error:
        raise _shadow_failure(
            "shadow_environment_close_failed",
            "Shadow CompilerGym environment failed to close cleanly",
            {"exception_type": type(error).__name__, "error": str(error)},
        ) from None
    return trace


def _failed_closed_result(
    result: Dict[str, object], failure: authoritative.EvaluatorFailure
) -> Dict[str, object]:
    result.pop("action_trace", None)
    result["ok"] = False
    result["status"] = "error"
    result["error"] = {
        "code": failure.code,
        "message": failure.message,
        "phase": failure.phase,
        "details": authoritative._json_safe(failure.details),
    }
    return result


def _evaluate_with_shadow(
    request: Mapping[str, object]
) -> Tuple[Dict[str, object], int]:
    result, exit_code = authoritative._evaluate(request)
    if exit_code != authoritative.EXIT_OK:
        return result, exit_code

    shadow_started = perf_counter()
    try:
        trace = _shadow_action_trace(request, result)
    except authoritative.EvaluatorFailure as failure:
        timings = result.get("timings_seconds")
        if isinstance(timings, dict):
            timings["shadow_action_trace"] = authoritative._seconds(shadow_started)
        return _failed_closed_result(result, failure), failure.exit_code
    except Exception as error:
        failure = _shadow_failure(
            "shadow_action_trace_failed",
            "Unexpected failure while constructing the shadow action trace",
            {"exception_type": type(error).__name__, "error": str(error)},
        )
        timings = result.get("timings_seconds")
        if isinstance(timings, dict):
            timings["shadow_action_trace"] = authoritative._seconds(shadow_started)
        return _failed_closed_result(result, failure), failure.exit_code

    timings = result.get("timings_seconds")
    if isinstance(timings, dict):
        timings["shadow_action_trace"] = authoritative._seconds(shadow_started)
    result["action_trace"] = trace
    return result, exit_code


def main() -> int:
    process_started = perf_counter()
    request: Optional[Dict[str, object]] = None
    try:
        parse_started = perf_counter()
        request = authoritative._parse_request()
        parse_seconds = authoritative._seconds(parse_started)
        with authoritative._redirect_process_stdout_to_stderr():
            result, exit_code = _evaluate_with_shadow(request)
        timings = result.get("timings_seconds")
        if isinstance(timings, dict):
            timings["request_parse"] = parse_seconds
            timings["total"] = authoritative._seconds(process_started)
    except authoritative.EvaluatorFailure as failure:
        result = authoritative._failure_result(
            failure, authoritative._seconds(process_started), request
        )
        exit_code = failure.exit_code
    except Exception as error:
        failure = authoritative.EvaluatorFailure(
            code="unhandled_action_trace_error",
            message="CompilerGym action-trace evaluation failed",
            phase="evaluation",
            exit_code=authoritative.EXIT_EVALUATION_ERROR,
            details={"exception_type": type(error).__name__, "error": str(error)},
        )
        result = authoritative._failure_result(
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

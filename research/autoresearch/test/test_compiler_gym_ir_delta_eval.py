from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Dict, List, Mapping, Sequence
from unittest.mock import patch


EVALUATOR_DIR = Path(__file__).resolve().parents[1] / "evaluators"
sys.path.insert(0, str(EVALUATOR_DIR))

import compiler_gym_ir_delta_eval as ir_delta  # noqa: E402


BENCHMARK = "benchmark://cbench-v1/blowfish"
ACTIONS = ["-mem2reg", "-sroa"]
ACTION_INDICES = [
    ir_delta.authoritative.PINNED_LLVM_PASS_FLAGS.index(action) for action in ACTIONS
]
COMMANDLINE = "opt -mem2reg -sroa input.bc -o output.bc"


class FakeObservation:
    def __init__(self, env: "FakeEnvironment") -> None:
        self.env = env

    def __getitem__(self, name: str) -> object:
        self.env.direct_observations.append(name)
        if name == "IrInstructionCount":
            return self.env.initial_ir
        if name == "ObjectTextSizeBytes":
            if self.env.position:
                return self.env.final_object_size
            return self.env.initial_object_size
        raise KeyError(name)


class FakeActionSpace:
    flags = ir_delta.authoritative.PINNED_LLVM_PASS_FLAGS
    name = "PassesAll"


class FakeEnvironment:
    version = ir_delta.authoritative.PINNED_COMPILER_GYM_VERSION
    compiler_version = ir_delta.authoritative.PINNED_LLVM_VERSION
    action_space = FakeActionSpace()

    def __init__(
        self,
        ir_values: Sequence[object] = (90, 90),
        final_object_size: object = 77,
        step_responses: Sequence[object] | None = None,
    ) -> None:
        self.initial_ir = 100
        self.initial_object_size = 60
        self.ir_values = list(ir_values)
        self.final_object_size = final_object_size
        self.step_responses = list(step_responses) if step_responses is not None else None
        self.position = 0
        self.benchmark = ""
        self.closed = False
        self.direct_observations: List[str] = []
        self.step_observation_spaces: List[List[str]] = []
        self.step_infos = [
            {"action_had_no_effect": True},
            {"action_had_no_effect": False},
        ]
        self.observation = FakeObservation(self)

    def reset(self, benchmark: str) -> None:
        self.benchmark = benchmark
        self.position = 0

    def step(self, action_index: int, observation_spaces: List[str]) -> object:
        self.step_observation_spaces.append(list(observation_spaces))
        if action_index != ACTION_INDICES[self.position]:
            raise AssertionError("unexpected action index")
        response_index = self.position
        self.position += 1
        if self.step_responses is not None:
            return self.step_responses[response_index]
        observations = [self.ir_values[response_index]]
        if observation_spaces == list(ir_delta.authoritative.RAW_METRIC_NAMES):
            observations.append(self.final_object_size)
        return (
            observations,
            None,
            False,
            self.step_infos[response_index],
        )

    def multistep(
        self, action_indices: Sequence[int], observation_spaces: List[str]
    ) -> object:
        if list(action_indices) != ACTION_INDICES:
            raise AssertionError("unexpected canonical action indices")
        if observation_spaces != list(ir_delta.authoritative.RAW_METRIC_NAMES):
            raise AssertionError("unexpected canonical observation spaces")
        self.position = len(action_indices)
        return (
            [self.ir_values[-1], self.final_object_size],
            None,
            False,
            {"action_had_no_effect": [False, True]},
        )

    def commandline(self) -> str:
        return COMMANDLINE

    def close(self) -> None:
        self.closed = True


class FakeCompilerGym:
    def __init__(self, env: FakeEnvironment, events: List[str]) -> None:
        self.env = env
        self.events = events
        self.make_calls = 0

    def make(self, environment_id: str) -> FakeEnvironment:
        self.events.append("make")
        self.make_calls += 1
        if environment_id != ir_delta.authoritative.ENVIRONMENT_ID:
            raise AssertionError("unexpected environment id")
        return self.env


def validation_outcomes(
    *, incomplete: bool = False, semantic_error: bool = False
) -> List[Dict[str, object]]:
    outcomes: List[Dict[str, object]] = []
    for index in range(1, 21):
        completed = not (incomplete and index == 20)
        errors: List[Dict[str, object]] = []
        if semantic_error and index == 20:
            errors.append({"input_index": 20, "type": "Mismatch", "data": {}})
        outcomes.append(
            {
                "input_index": index,
                "completed": completed,
                "passed": completed and not errors,
                "errors": errors,
                "walltime_seconds": 0.0,
            }
        )
    return outcomes


def contains_key(value: object, key: str) -> bool:
    if isinstance(value, Mapping):
        return key in value or any(contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(contains_key(item, key) for item in value)
    return False


class CompilerGymIrDeltaEvaluatorTest(unittest.TestCase):
    def evaluate(
        self,
        env: FakeEnvironment | None = None,
        outcomes: object | None = None,
        actions: Sequence[str] = ACTIONS,
        callbacks: Sequence[object] | None = None,
    ):
        fake_env = env or FakeEnvironment()
        events: List[str] = []
        compiler_gym = FakeCompilerGym(fake_env, events)
        selected_callbacks = (
            [object() for _ in range(20)] if callbacks is None else callbacks
        )
        selected_outcomes = validation_outcomes() if outcomes is None else outcomes

        def load_runtime():
            events.append("load")
            return compiler_gym, object(), False

        def verify_environment(_cbench):
            events.append("seal")
            return {"installed_cbench_source_sha256": "fixture"}

        def select_callbacks(candidate_env, _cbench, benchmark):
            events.append("select")
            self.assertIs(candidate_env, fake_env)
            self.assertEqual(benchmark, BENCHMARK)
            return selected_callbacks, 5, 80

        def run_validation(candidate_env, callbacks):
            events.append("validate")
            self.assertIs(candidate_env, fake_env)
            self.assertIs(callbacks, selected_callbacks)
            return selected_outcomes, 4, "fixture"

        with patch.object(
            ir_delta.authoritative,
            "_load_pinned_compiler_gym",
            side_effect=load_runtime,
        ), patch.object(
            ir_delta.authoritative,
            "_verify_farmshare_environment",
            side_effect=verify_environment,
        ), patch.object(
            ir_delta.authoritative,
            "_select_base_callbacks",
            side_effect=select_callbacks,
        ), patch.object(
            ir_delta.authoritative,
            "_run_full_validation",
            side_effect=run_validation,
        ):
            result, exit_code = ir_delta._evaluate(
                {"benchmark": BENCHMARK, "actions": list(actions)}
            )
        return result, exit_code, fake_env, compiler_gym, events

    def test_uses_one_environment_and_preserves_canonical_terminal_contract(self) -> None:
        result, exit_code, env, compiler_gym, events = self.evaluate()

        self.assertEqual(exit_code, ir_delta.authoritative.EXIT_OK)
        self.assertEqual(events, ["load", "seal", "make", "select", "validate"])
        self.assertEqual(compiler_gym.make_calls, 1)
        self.assertTrue(env.closed)
        self.assertEqual(
            env.direct_observations,
            ["IrInstructionCount", "ObjectTextSizeBytes"],
        )
        self.assertEqual(
            env.step_observation_spaces,
            [
                ["IrInstructionCount"],
                ["IrInstructionCount", "ObjectTextSizeBytes"],
            ],
        )
        self.assertEqual(result["contract"], ir_delta.EVALUATOR_CONTRACT)
        self.assertNotEqual(result["contract"], ir_delta.authoritative.EVALUATOR_CONTRACT)
        self.assertEqual(
            result["terminal_verifier_contract"],
            ir_delta.authoritative.EVALUATOR_CONTRACT,
        )
        self.assertEqual(result["request"], {"benchmark": BENCHMARK, "actions": ACTIONS})
        self.assertEqual(result["action_indices"], ACTION_INDICES)
        self.assertEqual(result["commandline"], COMMANDLINE)
        self.assertEqual(
            result["metrics"],
            {
                "initial": {"IrInstructionCount": 100, "ObjectTextSizeBytes": 60},
                "final": {"IrInstructionCount": 90, "ObjectTextSizeBytes": 77},
                "delta_final_minus_initial": {
                    "IrInstructionCount": -10,
                    "ObjectTextSizeBytes": 17,
                },
                "improvement_fraction": {
                    "IrInstructionCount": 0.1,
                    "ObjectTextSizeBytes": -17 / 60,
                },
            },
        )
        self.assertTrue(result["validation"]["passed"])
        self.assertEqual(result["validation"]["inputs_completed"], 20)

        trace = result["action_trace"]
        self.assertEqual(trace["contract"], ir_delta.ACTION_TRACE_CONTRACT)
        self.assertEqual(trace["initial_ir_instruction_count"], 100)
        self.assertEqual(
            trace["records"],
            [
                {
                    "index": 0,
                    "action": "-mem2reg",
                    "action_index": ACTION_INDICES[0],
                    "delta_from_previous": -10,
                },
                {
                    "index": 1,
                    "action": "-sroa",
                    "action_index": ACTION_INDICES[1],
                    "delta_from_previous": 0,
                },
            ],
        )
        self.assertEqual(trace["zero_delta_semantics"], ir_delta.ZERO_DELTA_SEMANTICS)
        self.assertIn("only", trace["zero_delta_semantics"])
        self.assertIn("does not imply", trace["zero_delta_semantics"])
        self.assertFalse(contains_key(result, "action_had_no_effect"))

    def test_zero_delta_ignores_conflicting_pass_reported_metadata(self) -> None:
        env = FakeEnvironment(ir_values=(100, 100))
        env.step_infos = [
            {"action_had_no_effect": False, "extra": "discard me"},
            {"action_had_no_effect": True},
        ]
        result, exit_code, _, _, _ = self.evaluate(env=env)

        self.assertEqual(exit_code, ir_delta.authoritative.EXIT_OK)
        self.assertEqual(
            [record["delta_from_previous"] for record in result["action_trace"]["records"]],
            [0, 0],
        )
        self.assertFalse(contains_key(result, "action_had_no_effect"))
        self.assertEqual(result["step_info"]["retained"], False)

    def test_fails_closed_for_malformed_step_observations(self) -> None:
        malformed = {
            "not-sequence": None,
            "empty": [],
            "multiple": [90, 91],
            "bool": [True],
            "negative": [-1],
            "string": ["90"],
        }
        for name, observation in malformed.items():
            with self.subTest(name=name):
                env = FakeEnvironment(
                    step_responses=[
                        (observation, None, False, {}),
                        ([90], None, False, {}),
                    ]
                )
                with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
                    self.evaluate(env=env)
                self.assertEqual(raised.exception.code, "invalid_ir_observation")
                self.assertEqual(raised.exception.phase, "actions")
                self.assertTrue(env.closed)

    def test_fails_closed_for_malformed_step_tuple_and_done_signal(self) -> None:
        cases = {
            "tuple-shape": ([90], None, False),
            "done-integer": ([90], None, 0, {}),
            "info-list": ([90], None, False, []),
        }
        expected_codes = {
            "tuple-shape": "invalid_step_response",
            "done-integer": "invalid_step_termination",
            "info-list": "invalid_step_info",
        }
        for name, response in cases.items():
            with self.subTest(name=name):
                env = FakeEnvironment(step_responses=[response, ([90], None, False, {})])
                with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
                    self.evaluate(env=env)
                self.assertEqual(raised.exception.code, expected_codes[name])
                self.assertTrue(env.closed)

    def test_fails_closed_when_episode_terminates(self) -> None:
        env = FakeEnvironment(
            step_responses=[
                ([90], None, True, {"reason": "service ended"}),
                ([90], None, False, {}),
            ]
        )
        with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
            self.evaluate(env=env)
        self.assertEqual(raised.exception.code, "compiler_episode_terminated")
        self.assertEqual(raised.exception.details["position"], 0)
        self.assertTrue(env.closed)

    def test_rejects_malformed_terminal_object_size(self) -> None:
        env = FakeEnvironment(final_object_size=True)
        with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
            self.evaluate(env=env)
        self.assertEqual(raised.exception.code, "invalid_final_observation")
        self.assertTrue(env.closed)

    def test_rejects_malformed_terminal_observation_arity(self) -> None:
        cases = {
            "missing-object": [90],
            "extra-value": [90, 77, 1],
        }
        for name, observations in cases.items():
            with self.subTest(name=name):
                env = FakeEnvironment(
                    step_responses=[
                        ([90], None, False, {}),
                        (observations, None, False, {}),
                    ]
                )
                with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
                    self.evaluate(env=env)
                self.assertEqual(raised.exception.code, "invalid_final_observation")
                self.assertEqual(raised.exception.details["position"], 1)
                self.assertTrue(env.closed)

    def test_rejects_non_twenty_validation_outcome_counts(self) -> None:
        valid = validation_outcomes()
        twenty_first = {
            "input_index": 21,
            "completed": True,
            "passed": True,
            "errors": [],
        }
        cases = {
            "empty": [],
            "nineteen": valid[:19],
            "twenty-one": [*valid, twenty_first],
        }
        for name, outcomes in cases.items():
            with self.subTest(name=name):
                env = FakeEnvironment()
                with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
                    self.evaluate(env=env, outcomes=outcomes)
                self.assertEqual(
                    raised.exception.code, "validation_outcome_count_mismatch"
                )
                self.assertTrue(env.closed)

    def test_rejects_duplicate_or_out_of_order_validation_indices(self) -> None:
        outcomes = validation_outcomes()
        outcomes[10]["input_index"] = 10
        env = FakeEnvironment()
        with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
            self.evaluate(env=env, outcomes=outcomes)
        self.assertEqual(raised.exception.code, "invalid_validation_outcome")
        self.assertEqual(raised.exception.details["expected_input_index"], 11)
        self.assertTrue(env.closed)

    def test_rejects_malformed_validation_outcomes(self) -> None:
        def malformed_item(value: object) -> List[object]:
            outcomes: List[object] = validation_outcomes()
            outcomes[0] = value
            return outcomes

        malformed_cases = {
            "non-object": malformed_item("invalid"),
            "boolean-index": malformed_item(
                {"input_index": True, "completed": True, "passed": True, "errors": []}
            ),
            "integer-completed": malformed_item(
                {"input_index": 1, "completed": 1, "passed": True, "errors": []}
            ),
            "integer-passed": malformed_item(
                {"input_index": 1, "completed": True, "passed": 1, "errors": []}
            ),
            "non-array-errors": malformed_item(
                {"input_index": 1, "completed": True, "passed": True, "errors": ()}
            ),
        }
        for name, outcomes in malformed_cases.items():
            with self.subTest(name=name):
                env = FakeEnvironment()
                with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
                    self.evaluate(env=env, outcomes=outcomes)
                self.assertEqual(raised.exception.code, "invalid_validation_outcome")
                self.assertTrue(env.closed)

    def test_rejects_contradictory_validation_status(self) -> None:
        cases: List[List[Dict[str, object]]] = []

        passed_false_without_failure = validation_outcomes()
        passed_false_without_failure[0]["passed"] = False
        cases.append(passed_false_without_failure)

        passed_true_when_incomplete = validation_outcomes()
        passed_true_when_incomplete[0]["completed"] = False
        cases.append(passed_true_when_incomplete)

        passed_true_with_errors = validation_outcomes()
        passed_true_with_errors[0]["errors"] = [{"type": "Mismatch"}]
        cases.append(passed_true_with_errors)

        for outcomes in cases:
            with self.subTest(outcome=outcomes[0]):
                env = FakeEnvironment()
                with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
                    self.evaluate(env=env, outcomes=outcomes)
                self.assertEqual(
                    raised.exception.code, "contradictory_validation_outcome"
                )
                self.assertTrue(env.closed)

    def test_rejects_non_twenty_callback_selection(self) -> None:
        for count in (0, 19, 21):
            with self.subTest(count=count):
                env = FakeEnvironment()
                with self.assertRaises(ir_delta.authoritative.EvaluatorFailure) as raised:
                    self.evaluate(env=env, callbacks=[object() for _ in range(count)])
                self.assertEqual(raised.exception.code, "base_callback_count_mismatch")
                self.assertTrue(env.closed)

    def test_semantic_rejection_keeps_canonical_status_and_withholds_trace(self) -> None:
        result, exit_code, env, compiler_gym, _ = self.evaluate(
            outcomes=validation_outcomes(semantic_error=True)
        )
        self.assertEqual(
            exit_code, ir_delta.authoritative.EXIT_SEMANTIC_VALIDATION_FAILED
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "semantic_validation_failed")
        self.assertFalse(result["validation"]["passed"])
        self.assertNotIn("action_trace", result)
        self.assertEqual(compiler_gym.make_calls, 1)
        self.assertTrue(env.closed)

    def test_incomplete_validation_keeps_canonical_status_and_withholds_trace(self) -> None:
        result, exit_code, _, _, _ = self.evaluate(
            outcomes=validation_outcomes(incomplete=True)
        )
        self.assertEqual(exit_code, ir_delta.authoritative.EXIT_EVALUATION_ERROR)
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "validation_incomplete")
        self.assertNotIn("action_trace", result)

    def test_empty_action_sequence_matches_canonical_noop_metrics(self) -> None:
        env = FakeEnvironment()
        result, exit_code, _, compiler_gym, _ = self.evaluate(env=env, actions=[])
        self.assertEqual(exit_code, ir_delta.authoritative.EXIT_OK)
        self.assertEqual(compiler_gym.make_calls, 1)
        self.assertEqual(env.step_observation_spaces, [])
        self.assertEqual(
            env.direct_observations,
            ["IrInstructionCount", "ObjectTextSizeBytes"],
        )
        self.assertEqual(result["metrics"]["initial"], result["metrics"]["final"])
        self.assertEqual(result["action_trace"]["records"], [])

    def test_json_output_has_no_pass_reported_noop_field(self) -> None:
        result, _, _, _, _ = self.evaluate()
        encoded = json.dumps(result, sort_keys=True)
        self.assertNotIn('"action_had_no_effect"', encoded)

    def test_failure_result_uses_treatment_and_terminal_verifier_contracts(self) -> None:
        failure = ir_delta.authoritative.EvaluatorFailure(
            code="fixture_failure",
            message="fixture",
            phase="request_parse",
            exit_code=ir_delta.authoritative.EXIT_INVALID_REQUEST,
        )
        result = ir_delta._failure_result(failure, 0.25, None)
        self.assertEqual(result["contract"], ir_delta.EVALUATOR_CONTRACT)
        self.assertEqual(
            result["terminal_verifier_contract"],
            ir_delta.authoritative.EVALUATOR_CONTRACT,
        )

    def test_main_serializes_positive_timing_without_shadow_subtraction(self) -> None:
        env = FakeEnvironment()
        events: List[str] = []
        compiler_gym = FakeCompilerGym(env, events)
        callbacks = [object() for _ in range(20)]

        with patch.object(
            ir_delta.authoritative,
            "_parse_request",
            return_value={"benchmark": BENCHMARK, "actions": list(ACTIONS)},
        ), patch.object(
            ir_delta.authoritative,
            "_redirect_process_stdout_to_stderr",
            return_value=contextlib.nullcontext(),
        ), patch.object(
            ir_delta.authoritative,
            "_load_pinned_compiler_gym",
            return_value=(compiler_gym, object(), False),
        ), patch.object(
            ir_delta.authoritative,
            "_verify_farmshare_environment",
            return_value={"installed_cbench_source_sha256": "fixture"},
        ), patch.object(
            ir_delta.authoritative,
            "_select_base_callbacks",
            return_value=(callbacks, 5, 80),
        ), patch.object(
            ir_delta.authoritative,
            "_run_full_validation",
            return_value=(validation_outcomes(), 4, "fixture"),
        ), patch.object(
            ir_delta.authoritative,
            "_seconds",
            return_value=0.001,
        ):
            output = io.StringIO()
            with redirect_stdout(output):
                exit_code = ir_delta.main()

        self.assertEqual(exit_code, ir_delta.authoritative.EXIT_OK)
        self.assertEqual(compiler_gym.make_calls, 1)
        self.assertTrue(env.closed)
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        parsed = json.loads(output.getvalue())
        timings = parsed["timings_seconds"]
        self.assertGreater(timings["request_parse"], 0)
        self.assertGreater(timings["total"], 0)
        self.assertIn("actions_and_final_observations", timings)
        self.assertNotIn("shadow_action_trace", timings)
        self.assertNotIn("shadow_action_trace", output.getvalue())
        self.assertEqual(
            env.step_observation_spaces,
            [
                ["IrInstructionCount"],
                ["IrInstructionCount", "ObjectTextSizeBytes"],
            ],
        )

    def test_matches_canonical_terminal_state_except_declared_trace_metadata(self) -> None:
        canonical_env = FakeEnvironment()
        canonical_events: List[str] = []
        canonical_compiler_gym = FakeCompilerGym(canonical_env, canonical_events)
        callbacks = [object() for _ in range(20)]
        outcomes = validation_outcomes()

        with patch.object(
            ir_delta.authoritative,
            "_load_pinned_compiler_gym",
            return_value=(canonical_compiler_gym, object(), False),
        ), patch.object(
            ir_delta.authoritative,
            "_verify_farmshare_environment",
            return_value={"installed_cbench_source_sha256": "fixture"},
        ), patch.object(
            ir_delta.authoritative,
            "_select_base_callbacks",
            return_value=(callbacks, 5, 80),
        ), patch.object(
            ir_delta.authoritative,
            "_run_full_validation",
            return_value=(outcomes, 4, "fixture"),
        ):
            canonical_result, canonical_exit = ir_delta.authoritative._evaluate(
                {"benchmark": BENCHMARK, "actions": list(ACTIONS)}
            )

        treatment_result, treatment_exit, treatment_env, treatment_runtime, _ = (
            self.evaluate()
        )
        self.assertEqual(canonical_exit, treatment_exit)
        self.assertEqual(canonical_compiler_gym.make_calls, 1)
        self.assertEqual(treatment_runtime.make_calls, 1)
        self.assertTrue(canonical_env.closed)
        self.assertTrue(treatment_env.closed)

        allowed_differences = {
            "contract",
            "terminal_verifier_contract",
            "action_trace",
            "step_info",
            "timings_seconds",
        }
        canonical_core = {
            key: value
            for key, value in canonical_result.items()
            if key not in allowed_differences
        }
        treatment_core = {
            key: value
            for key, value in treatment_result.items()
            if key not in allowed_differences
        }
        self.assertEqual(treatment_core, canonical_core)
        self.assertEqual(treatment_result["request"], canonical_result["request"])
        self.assertEqual(
            treatment_result["action_indices"], canonical_result["action_indices"]
        )
        self.assertEqual(treatment_result["commandline"], canonical_result["commandline"])
        self.assertEqual(treatment_result["metrics"], canonical_result["metrics"])
        self.assertEqual(treatment_result["status"], canonical_result["status"])
        self.assertEqual(
            treatment_result["validation"], canonical_result["validation"]
        )
        self.assertEqual(
            treatment_result["environment"]["seal"],
            canonical_result["environment"]["seal"],
        )
        self.assertEqual(
            treatment_result["provenance"], canonical_result["provenance"]
        )
        self.assertEqual(
            treatment_result["terminal_verifier_contract"],
            canonical_result["contract"],
        )


if __name__ == "__main__":
    unittest.main()

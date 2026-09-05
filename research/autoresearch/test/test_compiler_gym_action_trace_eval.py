from __future__ import annotations

import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Dict, List
from unittest.mock import patch


EVALUATOR_DIR = Path(__file__).resolve().parents[1] / "evaluators"
sys.path.insert(0, str(EVALUATOR_DIR))

import compiler_gym_action_trace_eval as action_trace  # noqa: E402


BENCHMARK = "benchmark://cbench-v1/blowfish"
ACTIONS = ["-mem2reg", "-sroa"]
ACTION_INDICES = [
    action_trace.authoritative.PINNED_LLVM_PASS_FLAGS.index(action)
    for action in ACTIONS
]
COMMANDLINE = "opt -mem2reg -sroa input.bc -o output.bc"


class FakeObservation:
    def __init__(self, env: "FakeEnvironment") -> None:
        self.env = env

    def __getitem__(self, name: str) -> int:
        self.env.direct_observations.append(name)
        if name == "IrInstructionCount":
            return self.env.ir_values[self.env.position]
        if name == "ObjectTextSizeBytes":
            return self.env.final_object_size
        raise KeyError(name)


class FakeActionSpace:
    flags = action_trace.authoritative.PINNED_LLVM_PASS_FLAGS


class FakeEnvironment:
    version = action_trace.authoritative.PINNED_COMPILER_GYM_VERSION
    compiler_version = action_trace.authoritative.PINNED_LLVM_VERSION
    action_space = FakeActionSpace()

    def __init__(
        self,
        ir_values: List[int] | None = None,
        final_object_size: int = 77,
        no_effect: List[object] | None = None,
        commandline: str = COMMANDLINE,
    ) -> None:
        self.ir_values = ir_values or [100, 90, 90]
        self.final_object_size = final_object_size
        self.no_effect = no_effect or [False, True]
        self.expected_commandline = commandline
        self.position = 0
        self.benchmark = ""
        self.closed = False
        self.direct_observations: List[str] = []
        self.step_observation_spaces: List[List[str]] = []
        self.observation = FakeObservation(self)

    def reset(self, benchmark: str) -> None:
        self.benchmark = benchmark
        self.position = 0

    def step(self, action_index: int, observation_spaces: List[str]):
        self.step_observation_spaces.append(list(observation_spaces))
        if action_index != ACTION_INDICES[self.position]:
            raise AssertionError("unexpected action index")
        self.position += 1
        return (
            [self.ir_values[self.position]],
            None,
            False,
            {"action_had_no_effect": self.no_effect[self.position - 1]},
        )

    def commandline(self) -> str:
        return self.expected_commandline

    def close(self) -> None:
        self.closed = True


class FakeCompilerGym:
    def __init__(self, env: FakeEnvironment, events: List[str]) -> None:
        self.env = env
        self.events = events

    def make(self, environment_id: str) -> FakeEnvironment:
        self.events.append("shadow_make")
        if environment_id != action_trace.authoritative.ENVIRONMENT_ID:
            raise AssertionError("unexpected environment id")
        return self.env


def canonical_result() -> Dict[str, object]:
    return {
        "schema_version": 2,
        "contract": action_trace.authoritative.EVALUATOR_CONTRACT,
        "ok": True,
        "status": "passed",
        "benchmark": BENCHMARK,
        "request": {"benchmark": BENCHMARK, "actions": list(ACTIONS)},
        "action_indices": list(ACTION_INDICES),
        "commandline": COMMANDLINE,
        "metrics": {
            "initial": {"IrInstructionCount": 100, "ObjectTextSizeBytes": 60},
            "final": {"IrInstructionCount": 90, "ObjectTextSizeBytes": 77},
        },
        "validation": {"passed": True, "inputs_completed": 20},
        "environment": {"seal": {"fixture": True}},
        "provenance": {"fixture": "canonical"},
        "step_info": {"action_had_no_effect": False},
        "timings_seconds": {"semantic_validation": 1.0},
    }


class CompilerGymActionTraceEvaluatorTest(unittest.TestCase):
    def evaluate(
        self,
        canonical: Dict[str, object] | None = None,
        env: FakeEnvironment | None = None,
    ):
        events: List[str] = []
        shadow_env = env or FakeEnvironment()
        compiler_gym = FakeCompilerGym(shadow_env, events)

        def authoritative_evaluate(request):
            events.append("authoritative")
            self.assertEqual(request, {"benchmark": BENCHMARK, "actions": ACTIONS})
            return copy.deepcopy(canonical or canonical_result()), 0

        def load_runtime():
            events.append("shadow_load")
            return compiler_gym, object(), False

        with patch.object(
            action_trace.authoritative, "_evaluate", side_effect=authoritative_evaluate
        ), patch.object(
            action_trace.authoritative,
            "_load_pinned_compiler_gym",
            side_effect=load_runtime,
        ):
            result, exit_code = action_trace._evaluate_with_shadow(
                {"benchmark": BENCHMARK, "actions": ACTIONS}
            )
        return result, exit_code, shadow_env, events

    def test_preserves_authoritative_result_and_adds_exact_prefix_trace(self) -> None:
        result, exit_code, env, events = self.evaluate()
        self.assertEqual(exit_code, 0)
        self.assertTrue(result["ok"])
        self.assertEqual(events, ["authoritative", "shadow_load", "shadow_make"])
        self.assertTrue(env.closed)
        self.assertEqual(
            env.direct_observations,
            ["IrInstructionCount", "ObjectTextSizeBytes"],
        )
        self.assertEqual(
            env.step_observation_spaces,
            [["IrInstructionCount"], ["IrInstructionCount"]],
        )
        self.assertEqual(result["validation"], canonical_result()["validation"])
        self.assertEqual(result["provenance"], canonical_result()["provenance"])
        self.assertEqual(result["contract"], action_trace.authoritative.EVALUATOR_CONTRACT)
        trace = result["action_trace"]
        self.assertEqual(
            trace,
            {
                "contract": action_trace.ACTION_TRACE_CONTRACT,
                "prefix_conditional": True,
                "intermediate_semantic_status": "unverified",
                "terminal_semantic_status": "authoritative-final-verifier-only",
                "benchmark": BENCHMARK,
                "actions": ACTIONS,
                "action_indices": ACTION_INDICES,
                "initial_ir_instruction_count": 100,
                "records": [
                    {
                        "index": 0,
                        "action": "-mem2reg",
                        "action_index": ACTION_INDICES[0],
                        "ir_instruction_count": 90,
                        "delta_from_previous": -10,
                        "action_had_no_effect": False,
                    },
                    {
                        "index": 1,
                        "action": "-sroa",
                        "action_index": ACTION_INDICES[1],
                        "ir_instruction_count": 90,
                        "delta_from_previous": 0,
                        "action_had_no_effect": True,
                    },
                ],
                "final": {
                    "IrInstructionCount": 90,
                    "ObjectTextSizeBytes": 77,
                },
                "commandline": COMMANDLINE,
            },
        )
        self.assertIn("shadow_action_trace", result["timings_seconds"])

    def test_fails_closed_and_retains_canonical_fields_on_every_binding_mismatch(
        self,
    ) -> None:
        cases = {
            "ir": lambda value: value["metrics"]["final"].__setitem__(
                "IrInstructionCount", 89
            ),
            "object": lambda value: value["metrics"]["final"].__setitem__(
                "ObjectTextSizeBytes", 78
            ),
            "commandline": lambda value: value.__setitem__(
                "commandline", "opt -sroa -mem2reg input.bc -o output.bc"
            ),
            "actions": lambda value: value["request"].__setitem__(
                "actions", list(reversed(ACTIONS))
            ),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                canonical = canonical_result()
                mutate(canonical)
                result, exit_code, env, _ = self.evaluate(canonical=canonical)
                self.assertEqual(exit_code, action_trace.authoritative.EXIT_EVALUATION_ERROR)
                self.assertFalse(result["ok"])
                self.assertEqual(result["status"], "error")
                self.assertEqual(result["error"]["code"], "shadow_action_trace_mismatch")
                self.assertNotIn("action_trace", result)
                self.assertEqual(result["validation"], canonical["validation"])
                self.assertEqual(result["metrics"], canonical["metrics"])
                self.assertTrue(env.closed or name == "actions")

    def test_fails_closed_before_replay_when_initial_ir_differs(self) -> None:
        canonical = canonical_result()
        canonical["metrics"]["initial"]["IrInstructionCount"] = 101
        result, exit_code, env, _ = self.evaluate(canonical=canonical)
        self.assertEqual(exit_code, action_trace.authoritative.EXIT_EVALUATION_ERROR)
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"]["code"], "shadow_action_trace_mismatch")
        self.assertEqual(
            result["error"]["details"],
            {
                "initial_IrInstructionCount": {
                    "authoritative": 101,
                    "shadow": 100,
                }
            },
        )
        self.assertNotIn("action_trace", result)
        self.assertEqual(result["metrics"], canonical["metrics"])
        self.assertEqual(env.direct_observations, ["IrInstructionCount"])
        self.assertEqual(env.step_observation_spaces, [])
        self.assertTrue(env.closed)

    def test_rejects_nonboolean_compiler_no_effect_signal(self) -> None:
        env = FakeEnvironment(no_effect=[False, 1])
        result, exit_code, env, _ = self.evaluate(env=env)
        self.assertEqual(exit_code, action_trace.authoritative.EXIT_EVALUATION_ERROR)
        self.assertFalse(result["ok"])
        self.assertEqual(
            result["error"]["code"], "shadow_action_had_no_effect_invalid"
        )
        self.assertNotIn("action_trace", result)
        self.assertTrue(env.closed)

    def test_skips_shadow_replay_when_authoritative_verification_rejects(self) -> None:
        rejected = canonical_result()
        rejected["ok"] = False
        rejected["status"] = "semantic_validation_failed"
        events: List[str] = []

        def authoritative_evaluate(_request):
            events.append("authoritative")
            return copy.deepcopy(rejected), action_trace.authoritative.EXIT_SEMANTIC_VALIDATION_FAILED

        with patch.object(
            action_trace.authoritative, "_evaluate", side_effect=authoritative_evaluate
        ), patch.object(
            action_trace.authoritative,
            "_load_pinned_compiler_gym",
            side_effect=AssertionError("shadow must not start"),
        ):
            result, exit_code = action_trace._evaluate_with_shadow(
                {"benchmark": BENCHMARK, "actions": ACTIONS}
            )
        self.assertEqual(
            exit_code, action_trace.authoritative.EXIT_SEMANTIC_VALIDATION_FAILED
        )
        self.assertEqual(result, rejected)
        self.assertEqual(events, ["authoritative"])

    def test_cli_emits_one_canonical_json_line_for_invalid_input(self) -> None:
        evaluator = EVALUATOR_DIR / "compiler_gym_action_trace_eval.py"
        completed = subprocess.run(
            [sys.executable, str(evaluator)],
            input=json.dumps({"benchmark": BENCHMARK, "actions": ["-not-allowed"]}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(completed.returncode, action_trace.authoritative.EXIT_INVALID_REQUEST)
        self.assertEqual(len(completed.stdout.splitlines()), 1)
        parsed = json.loads(completed.stdout)
        self.assertEqual(parsed["error"]["code"], "action_not_allowed")
        canonical = json.dumps(
            parsed,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        self.assertEqual(completed.stdout, canonical + "\n")


if __name__ == "__main__":
    unittest.main()

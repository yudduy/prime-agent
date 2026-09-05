from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path
from typing import Dict, List, Mapping, Sequence
from unittest.mock import patch


EVALUATOR_DIR = Path(__file__).resolve().parents[1] / "evaluators"
sys.path.insert(0, str(EVALUATOR_DIR))

import compiler_gym_complete_action_space_headroom_eval as headroom  # noqa: E402


class FakeActionSpace:
    flags = headroom.authoritative.PINNED_LLVM_PASS_FLAGS
    name = "PassesAll"


class FakeObservation:
    def __init__(self, env: "FakeEnvironment") -> None:
        self.env = env

    def __getitem__(self, name: str) -> int:
        if name == "IrInstructionCount":
            return self.env.current_ir
        if name == "ObjectTextSizeBytes":
            return 100 + self.env.current_ir
        raise KeyError(name)


class FakeEnvironment:
    version = headroom.authoritative.PINNED_COMPILER_GYM_VERSION
    compiler_version = headroom.authoritative.PINNED_LLVM_VERSION
    action_space = FakeActionSpace()

    def __init__(self, improvements: Mapping[str, int]) -> None:
        self.improvements = dict(improvements)
        self.benchmark = ""
        self.current_ir = 1000
        self.current_flag: str | None = None
        self.closed = False
        self.episodes: List[List[str]] = []
        self.observation = FakeObservation(self)

    def reset(self, benchmark: str) -> None:
        if benchmark != headroom.BENCHMARK:
            raise AssertionError("unexpected benchmark")
        self.benchmark = benchmark
        self.current_ir = 1000
        self.current_flag = None

    def multistep(self, action_indices: Sequence[int], observation_spaces: List[str]):
        if observation_spaces != ["IrInstructionCount"]:
            raise AssertionError("headroom prefilter requested a non-IR metric")
        actions = [self.action_space.flags[index] for index in action_indices]
        self.episodes.append(actions)
        if actions == list(headroom.SCAFFOLD_WITHOUT_X):
            self.current_ir = 1000
        else:
            expected = list(headroom.SCAFFOLD_WITHOUT_X)
            if len(actions) != len(expected) + 1:
                raise AssertionError("unexpected candidate length")
            self.current_flag = actions[headroom.INSERTION_INDEX]
            expected.insert(headroom.INSERTION_INDEX, self.current_flag)
            if actions != expected:
                raise AssertionError("candidate changed the fixed scaffold")
            self.current_ir = 1000 - self.improvements.get(self.current_flag, 0)
        return [self.current_ir], None, False, {"fixture": True}

    def commandline(self) -> str:
        return "opt fixture.bc -o fixture.out"

    def close(self) -> None:
        self.closed = True


class FakeCompilerGym:
    def __init__(self, env: FakeEnvironment) -> None:
        self.env = env
        self.make_calls = 0

    def make(self, environment_id: str) -> FakeEnvironment:
        if environment_id != headroom.authoritative.ENVIRONMENT_ID:
            raise AssertionError("unexpected CompilerGym environment")
        self.make_calls += 1
        return self.env


def validation_outcomes(passed: bool) -> List[Dict[str, object]]:
    outcomes: List[Dict[str, object]] = []
    for index in range(1, 21):
        errors: List[Dict[str, object]] = []
        if not passed and index == 20:
            errors.append({"input_index": index, "type": "Mismatch", "data": {}})
        outcomes.append(
            {
                "input_index": index,
                "completed": True,
                "passed": not errors,
                "errors": errors,
                "walltime_seconds": 0.0,
            }
        )
    return outcomes


class CompilerGymCompleteActionSpaceHeadroomEvaluatorTest(unittest.TestCase):
    def evaluate(
        self,
        improvements: Mapping[str, int],
        verification_failures: Sequence[str] = (),
    ):
        env = FakeEnvironment(improvements)
        compiler_gym = FakeCompilerGym(env)
        selected_flags: List[str] = []
        failed = frozenset(verification_failures)

        def select_callbacks(candidate_env, _cbench, benchmark):
            self.assertIs(candidate_env, env)
            self.assertEqual(benchmark, headroom.BENCHMARK)
            self.assertIsNotNone(env.current_flag)
            selected_flags.append(str(env.current_flag))
            return [object() for _ in range(20)], 5, 80

        def run_validation(candidate_env, callbacks):
            self.assertIs(candidate_env, env)
            self.assertEqual(len(callbacks), 20)
            return validation_outcomes(str(env.current_flag) not in failed), 1, "SLURM_CPUS_PER_TASK"

        with patch.dict(
            headroom.os.environ,
            {
                "SLURM_JOB_ID": "12345",
                "SLURM_CPUS_PER_TASK": "1",
                "SLURM_NTASKS": "1",
            },
            clear=False,
        ), patch.object(
            headroom.authoritative,
            "_load_pinned_compiler_gym",
            return_value=(compiler_gym, object(), False),
        ), patch.object(
            headroom.authoritative,
            "_verify_farmshare_environment",
            return_value={"installed_cbench_source_sha256": "fixture"},
        ), patch.object(
            headroom.authoritative,
            "_select_base_callbacks",
            side_effect=select_callbacks,
        ), patch.object(
            headroom.authoritative,
            "_run_full_validation",
            side_effect=run_validation,
        ):
            result, exit_code = headroom._evaluate(headroom.expected_request())
        return result, exit_code, env, compiler_gym, selected_flags

    def test_reconstructs_exact_124_26_98_complement(self) -> None:
        self.assertEqual(len(headroom.authoritative.PINNED_LLVM_PASS_FLAGS), 124)
        self.assertEqual(len(headroom.SHOWN_FLAGS), 26)
        self.assertEqual(len(headroom.OMITTED_FLAGS), 98)
        self.assertEqual(len(set(headroom.OMITTED_FLAGS)), 98)
        self.assertTrue(set(headroom.SHOWN_FLAGS).isdisjoint(headroom.OMITTED_FLAGS))
        self.assertEqual(
            set(headroom.SHOWN_FLAGS) | set(headroom.OMITTED_FLAGS),
            set(headroom.authoritative.PINNED_LLVM_PASS_FLAGS),
        )

    def test_runs_all_raw_prefilters_but_only_two_qualifying_verifiers(self) -> None:
        first, second, third = headroom.OMITTED_FLAGS[:3]
        result, exit_code, env, compiler_gym, selected_flags = self.evaluate(
            {first: 5, second: 6, third: 7}
        )

        self.assertEqual(exit_code, headroom.authoritative.EXIT_OK)
        self.assertEqual(compiler_gym.make_calls, 1)
        self.assertTrue(env.closed)
        self.assertEqual(len(env.episodes), 101)
        self.assertEqual(env.episodes[0], list(headroom.SCAFFOLD_WITHOUT_X))
        self.assertEqual(selected_flags, [first, second])
        self.assertEqual(len(result["candidates"]), 98)
        self.assertEqual(result["prefilter"]["required_improvement_instructions"], 5)
        self.assertEqual(result["verified_omitted_flags"], [first, second])
        self.assertTrue(result["sweep_complete"])
        self.assertTrue(result["pass_gate"]["passed"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["budget"]["model_calls"], 0)
        self.assertEqual(result["budget"]["allocation_count"], 1)
        self.assertEqual(result["budget"]["cpus_per_task"], 1)
        self.assertEqual(result["budget"]["evaluator_cpu_minutes_limit"], 10)
        self.assertEqual(result["budget"]["task_wall_minutes_limit"], 10)
        self.assertEqual(result["budget"]["scheduler_logical_cpus_per_allocation"], 2)
        self.assertEqual(result["budget"]["scheduler_logical_cpu_minutes_maximum"], 20)
        self.assertEqual(result["budget"]["cpu_seconds_soft_limit"], 540)
        self.assertEqual(result["budget"]["wall_seconds_soft_limit"], 540)
        self.assertTrue(result["budget"]["within_wall_cap"])
        self.assertTrue(result["verifier_schedule"]["early_positive_stop"])
        self.assertEqual(
            result["verifier_schedule"]["not_needed_after_positive_count"], 1
        )

        candidates = result["candidates"]
        self.assertIsNotNone(candidates[0]["verification"])
        self.assertIsNotNone(candidates[1]["verification"])
        self.assertIsNone(candidates[2]["verification"])
        self.assertTrue(candidates[2]["prefilter"]["qualified"])
        self.assertEqual(
            candidates[2]["verification_status"],
            "not-needed-after-positive-gate",
        )

    def test_requires_two_distinct_verified_flags_not_two_prefilter_hits(self) -> None:
        first, second = headroom.OMITTED_FLAGS[:2]
        result, exit_code, _, _, selected_flags = self.evaluate(
            {first: 5, second: 6}, verification_failures=[second]
        )

        self.assertEqual(exit_code, headroom.authoritative.EXIT_OK)
        self.assertEqual(selected_flags, [first, second])
        self.assertEqual(result["verified_omitted_flags"], [first])
        self.assertFalse(result["pass_gate"]["passed"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "headroom_not_demonstrated")

    def test_never_runs_callbacks_for_below_threshold_candidates(self) -> None:
        first = headroom.OMITTED_FLAGS[0]
        result, _, _, _, selected_flags = self.evaluate({first: 4})
        self.assertEqual(selected_flags, [])
        self.assertEqual(result["verified_omitted_flags"], [])
        self.assertFalse(result["pass_gate"]["passed"])

    def test_incomplete_callback_is_apparatus_invalid_not_negative_evidence(self) -> None:
        outcomes = validation_outcomes(True)
        outcomes[0] = {
            "input_index": 1,
            "completed": False,
            "passed": False,
            "errors": [],
            "exception": {"type": "TimeoutError", "message": "fixture"},
            "walltime_seconds": 0.0,
        }
        with patch.object(
            headroom.authoritative,
            "_select_base_callbacks",
            return_value=([object() for _ in range(20)], 5, 80),
        ), patch.object(
            headroom.authoritative,
            "_run_full_validation",
            return_value=(outcomes, 1, "SLURM_CPUS_PER_TASK"),
        ):
            with self.assertRaisesRegex(
                headroom.authoritative.EvaluatorFailure,
                "did not complete all 20 callbacks",
            ):
                headroom._verification_record(object(), object())

    def test_accepts_only_the_exact_frozen_request(self) -> None:
        expected = headroom.expected_request()
        self.assertEqual(headroom._sha256_json(expected), headroom.REQUEST_SHA256)
        self.assertEqual(headroom._validate_request_value(copy.deepcopy(expected)), expected)
        drifted = copy.deepcopy(expected)
        drifted["benchmark"] = "benchmark://cbench-v1/blowfish"
        with self.assertRaisesRegex(
            headroom.authoritative.EvaluatorFailure, "frozen complete-action-space protocol"
        ):
            headroom._validate_request_value(drifted)

    def test_requires_one_single_cpu_slurm_task(self) -> None:
        with patch.dict(
            headroom.os.environ,
            {
                "SLURM_JOB_ID": "12345",
                "SLURM_CPUS_PER_TASK": "2",
                "SLURM_NTASKS": "1",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(
                headroom.authoritative.EvaluatorFailure, "single-CPU Slurm task"
            ):
                headroom._verify_single_cpu_slurm_allocation()

        with patch.dict(
            headroom.os.environ,
            {
                "SLURM_JOB_ID": "12345",
                "SLURM_CPUS_PER_TASK": "1",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(
                headroom.authoritative.EvaluatorFailure, "single-CPU Slurm task"
            ):
                headroom._verify_single_cpu_slurm_allocation()

    def test_soft_stop_guards_cpu_and_wall_before_the_hard_slurm_cap(self) -> None:
        with patch.object(headroom, "_cpu_seconds", return_value=640.0), patch.object(
            headroom, "perf_counter", return_value=100.0
        ):
            self.assertTrue(headroom._soft_budget_exhausted(100.0, 100.0))
        with patch.object(headroom, "_cpu_seconds", return_value=100.0), patch.object(
            headroom, "perf_counter", return_value=640.0
        ):
            self.assertTrue(headroom._soft_budget_exhausted(100.0, 100.0))
        with patch.object(headroom, "_cpu_seconds", return_value=639.9), patch.object(
            headroom, "perf_counter", return_value=639.9
        ):
            self.assertFalse(headroom._soft_budget_exhausted(100.0, 100.0))


if __name__ == "__main__":
    unittest.main()

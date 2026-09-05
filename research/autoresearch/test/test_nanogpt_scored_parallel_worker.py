from __future__ import annotations

import argparse
from contextlib import redirect_stderr
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import runpy
import stat
import tempfile
import unittest
from unittest import mock


WORKER_PATH = (
    Path(__file__).parents[1] / "evaluators" / "nanogpt_scored_parallel_worker.py"
)
BASE_WORKER_PATH = Path(__file__).parents[1] / "evaluators" / "nanogpt_scored_worker.py"
SPEC = importlib.util.spec_from_file_location(
    "nanogpt_scored_parallel_worker", WORKER_PATH
)
assert SPEC is not None and SPEC.loader is not None
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def pins() -> dict[str, str]:
    return {
        "staticEvaluatorSha256": "1" * 64,
        "environmentSha256": "2" * 64,
        "environmentSealSha256": "3" * 64,
        "datasetManifestSha256": "4" * 64,
        "parallelWorkerSha256": "5" * 64,
        "baseWorkerSha256": "6" * 64,
        "parallelTransportSha256": "7" * 64,
        "hostAggregationSha256": "8" * 64,
    }


def static_evidence(
    request_pins: dict[str, str],
    patch_digest: str,
    *,
    candidate_sha256: str = digest("candidate"),
    train_steps: int = 3200,
) -> dict[str, object]:
    return {
        "contract": worker.STATIC_CONTRACT,
        "repositoryCommit": worker.PINNED_COMMIT,
        "programSha256": worker.PINNED_PROGRAM_SHA256,
        "evaluatorSha256": request_pins["staticEvaluatorSha256"],
        "baselineSha256": worker.PINNED_BASELINE_SHA256,
        "patchSha256": patch_digest,
        "candidateSha256": candidate_sha256,
        "trainSteps": train_steps,
        "frozenSegmentSha256": [digest(f"frozen-{index}") for index in range(4)],
        "editableSegmentSha256": [digest(f"editable-{index}") for index in range(3)],
    }


def build_stage(
    mode: str = "smoke-10",
    *,
    request_pins: dict[str, str] | None = None,
    candidate_sha256: str = digest("candidate"),
    train_steps: int = 3200,
) -> dict[str, object]:
    selected_pins = copy.deepcopy(request_pins or pins())
    patch = b"--- a/train_gpt_simple.py\n+++ b/train_gpt_simple.py\n"
    patch_digest = hashlib.sha256(patch).hexdigest()
    evidence = static_evidence(
        selected_pins,
        patch_digest,
        candidate_sha256=candidate_sha256,
        train_steps=train_steps,
    )
    stage: dict[str, object] = {
        "schemaVersion": 1,
        "contract": worker.CONTRACT,
        "verifierEpoch": worker.verifier_epoch(selected_pins),
        "parallelAmendmentSha256": worker.PARALLEL_AMENDMENT_SHA256,
        "stageIdentity": "",
        "mode": mode,
        "jobId": f"parallel-{mode}",
        "manifestDigest": digest(f"manifest-{mode}"),
        "branchId": "parallel-test",
        "treatment": "candidate-a",
        "candidatePatch": {
            "digest": patch_digest,
            "byteLength": len(patch),
            "mediaType": "text/x-diff",
        },
        "staticEvidence": evidence,
        "benchmarkIds": worker.mode_benchmark_ids(mode),
        "trials": worker.MODE_SPEC[mode]["trials"],
        "seeds": worker.mode_seeds(mode),
        "effectiveTrainSteps": 10 if mode == "smoke-10" else train_steps,
        "v1Bridge": None,
        "priorStage": None,
        "children": [],
        "launch": {
            "cluster": "Stanford FarmShare",
            "gpu": "NVIDIA L40S",
            "gpusPerChild": 1,
            "worldSizePerChild": 1,
            "maxConcurrentChildren": worker.MODE_SPEC[mode]["maxConcurrentChildren"],
            "noRequeue": True,
            "jobDirectory": "fresh-per-child",
            "priorNumericMeasurementsReused": False,
        },
        "acceptance": {
            "thresholdNanounits": 3_278_590_000,
            "comparison": "sum-loss-nanounits<trials*threshold-nanounits",
            "partialChildrenAccepted": False,
            "recordTrialCount": 8,
            "recordRequiresStrictlyFewerStepsThan": 3290,
        },
        "lossEncoding": copy.deepcopy(worker.LOSS_ENCODING),
        "measurementEncoding": copy.deepcopy(worker.MEASUREMENT_ENCODING),
        "pins": selected_pins,
    }
    stage["stageIdentity"] = worker.stage_identity(stage)
    if mode != "smoke-10":
        bridge = {
            "contract": worker.V1_CONTRACT,
            "mode": "score-1",
            "verifierEpoch": f"nanogpt-scored-v1-{'a' * 24}",
            "stageIdentity": digest("v1-stage"),
            "requestDigest": digest("v1-request"),
            "resultDigest": digest("v1-result"),
            "receiptDigest": digest("v1-receipt"),
            "candidateSha256": candidate_sha256,
            "trainSteps": train_steps,
            "meanValidationLossExclusiveUpperBound": 3.27859,
            "accepted": True,
            "thresholdPassed": True,
            "numericMeasurementsReused": False,
        }
        previous = worker.MODE_SPEC[mode]["previous"]
        stage["v1Bridge"] = bridge
        stage["priorStage"] = {
            "mode": previous,
            "stageIdentity": stage["stageIdentity"],
            "requestDigest": digest(f"{previous}-request"),
            "resultDigest": digest(f"{previous}-result"),
            "receiptDigest": digest(f"{previous}-receipt"),
            "accepted": True,
            "thresholdPassed": None if previous == "smoke-10" else True,
            "fullExactSet": True,
            "numericMeasurementsReused": False,
            "v1BridgeDigest": (
                worker.canonical_sha256(bridge) if previous == "score-3" else None
            ),
        }
    children = []
    for index, seed in enumerate(worker.mode_seeds(mode)):
        body = worker.child_spec_body(stage, index, seed)
        children.append({**body, "childSpecDigest": worker.canonical_sha256(body)})
    stage["children"] = children
    stage["requestDigest"] = worker.canonical_sha256(stage)
    return stage


def build_child(stage: dict[str, object], index: int) -> dict[str, object]:
    selected = copy.deepcopy(stage["children"][index])
    spec_digest = selected.pop("childSpecDigest")
    body = {
        "schemaVersion": 1,
        "contract": worker.CONTRACT,
        "verifierEpoch": stage["verifierEpoch"],
        "parallelAmendmentSha256": worker.PARALLEL_AMENDMENT_SHA256,
        "stageIdentity": stage["stageIdentity"],
        "stageRequestDigest": stage["requestDigest"],
        "childSpec": selected,
        "childSpecDigest": spec_digest,
        "candidatePatch": copy.deepcopy(stage["candidatePatch"]),
        "staticEvidence": copy.deepcopy(stage["staticEvidence"]),
        "launch": {
            "cluster": "Stanford FarmShare",
            "gpu": "NVIDIA L40S",
            "gpus": 1,
            "worldSize": 1,
            "noRequeue": True,
            "jobDirectory": "fresh-per-child",
        },
        "lossEncoding": copy.deepcopy(worker.LOSS_ENCODING),
        "measurementEncoding": copy.deepcopy(worker.MEASUREMENT_ENCODING),
        "pins": copy.deepcopy(stage["pins"]),
    }
    return {**body, "childRequestDigest": worker.canonical_sha256(body)}


def resign_stage(stage: dict[str, object]) -> None:
    body = {key: value for key, value in stage.items() if key != "requestDigest"}
    stage["requestDigest"] = worker.canonical_sha256(body)


def resign_child(child: dict[str, object]) -> None:
    body = {key: value for key, value in child.items() if key != "childRequestDigest"}
    child["childRequestDigest"] = worker.canonical_sha256(body)


class RequestContractTest(unittest.TestCase):
    def test_python_epoch_matches_typescript_fixture(self) -> None:
        self.assertEqual(
            worker.verifier_epoch(pins()),
            "nanogpt-scored-parallel-v2-a656390bb6a248d6b7e024b7",
        )
        self.assertEqual(
            worker.PARALLEL_AMENDMENT_SHA256,
            "86faf36c6060d6861dccbe2d6e72810a2983b0f4709fbd5d0f475634ced6f2c5",
        )

    def test_exact_requests_bind_every_mode_and_selected_child(self) -> None:
        for mode, trials in (("smoke-10", 1), ("score-3", 3), ("replay-8", 8)):
            with self.subTest(mode=mode):
                stage = build_stage(mode)
                worker.verify_stage_request(stage)
                self.assertEqual(len(stage["children"]), trials)
                for index in range(trials):
                    child = build_child(stage, index)
                    worker.verify_child_request(child, stage)
                    self.assertEqual(child["childSpec"]["index"], index)
                    self.assertEqual(child["childSpec"]["seed"], 0xC0FFEE + index)

    def test_request_mutations_fail_closed_after_resigning(self) -> None:
        cases: list[tuple[str, dict[str, object], dict[str, object]]] = []

        stage = build_stage()
        child = build_child(stage, 0)
        stage["unexpected"] = True
        resign_stage(stage)
        cases.append(("unknown stage key", stage, child))

        stage = build_stage()
        child = build_child(stage, 0)
        stage["seeds"] = [0xC0FFEF]
        resign_stage(stage)
        cases.append(("wrong seed prefix", stage, child))

        stage = build_stage("score-3")
        child = build_child(stage, 1)
        child["parallelAmendmentSha256"] = "0" * 64
        resign_child(child)
        cases.append(("wrong amendment", stage, child))

        stage = build_stage("score-3")
        child = build_child(stage, 1)
        child["pins"] = {**child["pins"], "hostAggregationSha256": "9" * 64}
        resign_child(child)
        cases.append(("child pin drift", stage, child))

        stage = build_stage("score-3")
        child = build_child(stage, 1)
        child["childSpec"]["index"] = 7
        child["childSpecDigest"] = worker.canonical_sha256(child["childSpec"])
        resign_child(child)
        cases.append(("out of stage index", stage, child))

        for label, mutated_stage, mutated_child in cases:
            with self.subTest(label=label):
                with self.assertRaises(worker.WorkerFailure):
                    worker.verify_child_request(mutated_child, mutated_stage)

    def test_widening_bridge_and_predecessor_are_exact(self) -> None:
        score3 = build_stage("score-3")
        score3["priorStage"]["thresholdPassed"] = True
        resign_stage(score3)
        with self.assertRaisesRegex(worker.WorkerFailure, "prior stage"):
            worker.verify_stage_request(score3)

        replay8 = build_stage("replay-8")
        replay8["priorStage"]["v1BridgeDigest"] = None
        resign_stage(replay8)
        with self.assertRaisesRegex(worker.WorkerFailure, "prior stage"):
            worker.verify_stage_request(replay8)


class BaseWorkerSeamTest(unittest.TestCase):
    def test_loads_only_the_hash_bound_v1_worker_interface(self) -> None:
        base_namespace = runpy.run_path(str(BASE_WORKER_PATH))
        selected_pins = pins()
        selected_pins.update(
            {
                "parallelWorkerSha256": worker.sha256_file(WORKER_PATH),
                "baseWorkerSha256": worker.sha256_file(BASE_WORKER_PATH),
                "environmentSha256": base_namespace[
                    "EXPECTED_ENVIRONMENT_MANIFEST_SHA256"
                ],
                "environmentSealSha256": base_namespace[
                    "EXPECTED_ENVIRONMENT_SEAL_SHA256"
                ],
            }
        )
        loaded = worker.load_base_worker(BASE_WORKER_PATH, selected_pins)
        self.assertEqual(loaded["CONTRACT"], worker.V1_CONTRACT)
        self.assertEqual(loaded["TRIAL_SEEDS"], worker.TRIAL_SEEDS)
        self.assertTrue(callable(loaded["run_trial"]))

        changed = copy.deepcopy(selected_pins)
        changed["baseWorkerSha256"] = "0" * 64
        with self.assertRaisesRegex(worker.WorkerFailure, "base worker hash"):
            worker.load_base_worker(BASE_WORKER_PATH, changed)


class MeasurementAndResultTest(unittest.TestCase):
    def test_half_even_loss_encoding_is_exact(self) -> None:
        self.assertEqual(
            worker.encode_loss("3.0000000005"), ("3.000000000", 3_000_000_000)
        )
        self.assertEqual(
            worker.encode_loss("3.0000000015"), ("3.000000002", 3_000_000_002)
        )
        self.assertEqual(worker.integer_measurement(42.5, "runtime"), 42)
        self.assertEqual(worker.integer_measurement(43.5, "runtime"), 44)
        self.assertEqual(worker.peak_vram_measurement(123.001), 124)
        with self.assertRaises(worker.WorkerFailure):
            worker.encode_loss("NaN")

    def _execute_with_fake_base(
        self,
        mode: str,
        index: int,
        run_trial: object,
    ) -> tuple[dict[str, object], Path, list[int], tempfile.TemporaryDirectory[str]]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        runtime_root = root / "runtime-work"
        trial_log_dir = root / "trial-logs"
        output = root / "result.json"
        base_worker = root / "base-worker.py"
        base_worker.write_bytes(b"# pinned test base worker\n")
        base_worker.chmod(0o400)
        candidate = "candidate source"
        selected_pins = pins()
        selected_pins.update(
            {
                "parallelWorkerSha256": worker.sha256_file(WORKER_PATH),
                "baseWorkerSha256": worker.sha256_file(base_worker),
            }
        )
        stage = build_stage(
            mode,
            request_pins=selected_pins,
            candidate_sha256=digest(candidate),
            train_steps=123,
        )
        child = build_child(stage, index)
        calls: list[int] = []

        def fake_hardware() -> tuple[str, str]:
            return "1800001", "GPU-test-L40S"

        def fake_run(*arguments: object) -> dict[str, object]:
            calls.append(int(arguments[5]))
            return run_trial(*arguments)

        fake_base = {
            "sha256_text": lambda value: digest(value),
            "validate_launch_and_probe_hardware": fake_hardware,
            "validate_environment_manifest": lambda *_: {"environment": "exact"},
            "validate_environment_seal": lambda *_: {"seal": "exact"},
            "validate_live_environment": lambda *_: None,
            "validate_dataset": lambda *_: None,
            "run_trial": fake_run,
        }
        args = argparse.Namespace(
            stage_request=root / "stage-request.json",
            child_request=root / "child-request.json",
            candidate_patch=root / "candidate.patch",
            baseline=root / "train_gpt_simple.py",
            static_evaluator=root / "nanogpt_contract.py",
            base_worker=base_worker,
            environment_manifest=root / "environment.json",
            environment_seal=root / "environment-seal.json",
            dataset_manifest=root / "dataset-manifest.json",
            dataset_root=root / "dataset",
            trial_log_dir=trial_log_dir,
            output=output,
        )
        with (
            mock.patch.object(
                worker, "validate_paths", return_value=(root, runtime_root)
            ),
            mock.patch.object(worker, "load_requests", return_value=(stage, child)),
            mock.patch.object(worker, "load_base_worker", return_value=fake_base),
            mock.patch.object(
                worker,
                "validate_candidate_assets",
                return_value=({}, "baseline", "patch", candidate),
            ),
            redirect_stderr(io.StringIO()),
        ):
            result, exit_code = worker.execute(args)
        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(output.read_text(encoding="utf-8")), result)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o400)
        return result, trial_log_dir, calls, temporary

    def test_execute_runs_exactly_one_selected_child_and_publishes_one_log(
        self,
    ) -> None:
        def successful_run(*arguments: object) -> dict[str, object]:
            runtime_args = arguments[0]
            request = arguments[4]
            index = int(arguments[5])
            worker._write_immutable(
                runtime_args.trial_log_dir / f"trial-{index:03d}.log",
                b"authoritative child log\n",
            )
            return {
                "index": index,
                "seed": request["seeds"][index],
                "finalValidationLoss": "3.1234567895",
                "optimizerSteps": request["effectiveTrainSteps"],
                "peakVramMb": 123.6,
                "runtimeMs": 42.4,
            }

        result, trial_log_dir, calls, temporary = self._execute_with_fake_base(
            "score-3", 2, successful_run
        )
        self.addCleanup(temporary.cleanup)
        self.assertEqual(calls, [2])
        self.assertTrue(result["ok"])
        self.assertEqual(result["index"], 2)
        self.assertEqual(result["seed"], 0xC0FFEE + 2)
        self.assertEqual(result["validationLossDecimal"], "3.123456790")
        self.assertEqual(result["validationLossNanounits"], 3_123_456_790)
        self.assertEqual(result["peakVramMb"], 124)
        self.assertEqual(
            [path.name for path in trial_log_dir.rglob("*.log")],
            ["trial-002.log"],
        )
        observed = result["observed"]["log"]
        content = (trial_log_dir / observed["remoteName"]).read_bytes()
        self.assertEqual(observed["byteLength"], len(content))
        self.assertEqual(observed["sha256"], hashlib.sha256(content).hexdigest())

    def test_runtime_failure_is_a_schema_valid_child_result(self) -> None:
        class OomFailure(RuntimeError):
            kind = "oom"

        def failed_run(*_arguments: object) -> dict[str, object]:
            raise OomFailure("synthetic out of memory")

        result, trial_log_dir, calls, temporary = self._execute_with_fake_base(
            "smoke-10", 0, failed_run
        )
        self.addCleanup(temporary.cleanup)
        self.assertEqual(calls, [0])
        self.assertFalse(result["ok"])
        self.assertEqual(
            result["failure"], {"kind": "oom", "message": "synthetic out of memory"}
        )
        for key in (
            "validationLossDecimal",
            "validationLossNanounits",
            "optimizerSteps",
            "peakVramMb",
        ):
            self.assertIsNone(result[key])
        logs = list(trial_log_dir.rglob("*.log"))
        self.assertEqual(len(logs), 1)
        self.assertIn(b"synthetic out of memory", logs[0].read_bytes())


if __name__ == "__main__":
    unittest.main()

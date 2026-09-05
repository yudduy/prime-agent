from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import os
import signal
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


RESEARCH_ROOT = Path(__file__).resolve().parents[1]
WORKER_PATH = RESEARCH_ROOT / "evaluators" / "nanogpt_scored_worker.py"
STATIC_EVALUATOR_PATH = RESEARCH_ROOT / "evaluators" / "nanogpt_contract.py"
BASELINE_PATH = RESEARCH_ROOT / "fixtures" / "nanogpt" / "train_gpt_simple.py"
DATASET_MANIFEST_PATH = RESEARCH_ROOT / "farmshare" / "nanogpt-scored-data.json"

SPEC = importlib.util.spec_from_file_location(
    "nanogpt_scored_worker_under_test", WORKER_PATH
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load NanoGPT scored worker")
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


PATCH = """--- a/train_gpt_simple.py
+++ b/train_gpt_simple.py
@@ -281 +281 @@
-    train_steps = 3290
+    train_steps = 3200
"""

STOCK_PATCH = """--- a/train_gpt_simple.py
+++ b/train_gpt_simple.py
@@ -281 +281 @@
-    train_steps = 3290
+    train_steps = 3290
"""

ENVIRONMENT = {
    "schemaVersion": 1,
    "environmentSpecSha256": worker.EXPECTED_ENVIRONMENT_SPEC_SHA256,
    "kernelBenchVerifiedCommit": "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e",
    "numpy": "2.5.2",
    "pip": "25.2",
    "python": "3.12.3",
    "torch": "2.11.0+cu128",
    "torchCuda": "12.8",
}
ENVIRONMENT_SOURCE = (json.dumps(ENVIRONMENT, sort_keys=True) + "\n").encode("utf-8")
ENVIRONMENT_SEAL = {
    "schemaVersion": 1,
    "environmentSpecSha256": worker.EXPECTED_ENVIRONMENT_SPEC_SHA256,
    "environmentManifestSha256": worker.EXPECTED_ENVIRONMENT_MANIFEST_SHA256,
    "pipFreezeSha256": worker.EXPECTED_PIP_FREEZE_SHA256,
}
ENVIRONMENT_SEAL_SOURCE = (json.dumps(ENVIRONMENT_SEAL, sort_keys=True) + "\n").encode(
    "utf-8"
)


def source_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


def build_request(mode: str = "smoke-10") -> dict[str, object]:
    static_contract = worker.load_static_contract(
        STATIC_EVALUATOR_PATH,
        worker.sha256_file(STATIC_EVALUATOR_PATH),
    )
    baseline = BASELINE_PATH.read_text(encoding="utf-8")
    candidate, validation = worker.apply_and_validate_candidate(
        static_contract,
        baseline,
        PATCH,
        worker.sha256_text(PATCH),
    )
    evidence = {
        "contract": validation["contract"],
        "repositoryCommit": validation["commit"],
        "programSha256": validation["programSha256"],
        "evaluatorSha256": validation["evaluatorSha256"],
        "baselineSha256": validation["baselineSha256"],
        "patchSha256": validation["patchSha256"],
        "candidateSha256": worker.sha256_text(candidate),
        "trainSteps": validation["trainSteps"],
        "frozenSegmentSha256": validation["frozenSegmentSha256"],
        "editableSegmentSha256": validation["editableSegmentSha256"],
    }
    pins = {
        "staticEvaluatorSha256": worker.sha256_file(STATIC_EVALUATOR_PATH),
        "environmentSha256": worker.EXPECTED_ENVIRONMENT_MANIFEST_SHA256,
        "environmentSealSha256": worker.EXPECTED_ENVIRONMENT_SEAL_SHA256,
        "datasetManifestSha256": worker.sha256_file(DATASET_MANIFEST_PATH),
        "workerSha256": worker.sha256_file(WORKER_PATH),
        "transportSha256": worker.sha256_text("transport-under-test"),
    }
    trials = worker.MODE_SPEC[mode]["trials"]
    previous = worker.MODE_SPEC[mode]["previous"]
    body: dict[str, object] = {
        "schemaVersion": 1,
        "contract": worker.CONTRACT,
        "verifierEpoch": worker.verifier_epoch(pins),
        "campaignAmendmentSha256": worker.CAMPAIGN_AMENDMENT_SHA256,
        "stageIdentity": "pending",
        "mode": mode,
        "jobId": f"job-{mode}",
        "manifestDigest": worker.sha256_text(f"manifest:{mode}"),
        "branchId": "scored-worker-test-雪",
        "treatment": "candidate-a",
        "candidatePatch": {
            "digest": worker.sha256_text(PATCH),
            "byteLength": len(PATCH.encode("utf-8")),
            "mediaType": "text/x-diff",
        },
        "staticEvidence": evidence,
        "benchmarkIds": worker.mode_benchmark_ids(mode),
        "trials": trials,
        "seeds": list(worker.TRIAL_SEEDS[:trials]),
        "effectiveTrainSteps": 10 if mode == "smoke-10" else 3200,
        "priorStage": (
            None
            if previous is None
            else {
                "mode": previous,
                "jobId": f"job-{previous}",
                "requestDigest": worker.sha256_text(f"request:{previous}"),
                "resultDigest": worker.sha256_text(f"result:{previous}"),
                "receiptDigest": worker.sha256_text(f"receipt:{previous}"),
            }
        ),
        "launch": {
            "cluster": "Stanford FarmShare",
            "gpu": "NVIDIA L40S",
            "gpus": 1,
            "worldSize": 1,
            "trialExecution": "sequential",
            "jobDirectory": "fresh-per-stage",
        },
        "acceptance": {
            "meanValidationLossExclusiveUpperBound": 3.27859,
            "partialTrialsAccepted": False,
            "recordTrialCount": 8,
            "recordRequiresStrictlyFewerStepsThan": 3290,
        },
        "pins": pins,
    }
    body["stageIdentity"] = worker.stage_identity(body)
    return {**body, "requestDigest": worker.canonical_sha256(body)}


def prepare_stage(root: Path, request: dict[str, object]) -> argparse.Namespace:
    dataset = root / "sealed-dataset"
    dataset.mkdir()
    paths = {
        "request": root / "request.json",
        "candidate_patch": root / "candidate.patch",
        "baseline": root / "train_gpt_simple.py",
        "static_evaluator": root / "nanogpt_contract.py",
        "environment_manifest": root / "environment.json",
        "environment_seal": root / "environment-seal.json",
        "dataset_manifest": root / "dataset-manifest.json",
        "dataset_root": dataset,
        "trial_log_dir": root / "trial-logs",
        "output": root / "result.json",
    }
    paths["request"].write_bytes(source_bytes(request))
    paths["candidate_patch"].write_text(PATCH, encoding="utf-8")
    shutil.copyfile(BASELINE_PATH, paths["baseline"])
    shutil.copyfile(STATIC_EVALUATOR_PATH, paths["static_evaluator"])
    paths["environment_manifest"].write_bytes(ENVIRONMENT_SOURCE)
    paths["environment_seal"].write_bytes(ENVIRONMENT_SEAL_SOURCE)
    shutil.copyfile(DATASET_MANIFEST_PATH, paths["dataset_manifest"])
    for name in (
        "request",
        "candidate_patch",
        "baseline",
        "static_evaluator",
        "environment_manifest",
        "environment_seal",
        "dataset_manifest",
    ):
        paths[name].chmod(0o400)
    return argparse.Namespace(**paths)


class NanoGptScoredWorkerTest(unittest.TestCase):
    def test_canonical_json_matches_typescript_unicode_vector(self) -> None:
        value = {
            "emoji": "雪🚀",
            "nested": {"z": 3.27859, "a": [12648430, False, None]},
            "slash": "a/b",
            "quote": '"',
        }
        self.assertEqual(
            worker.canonical_json(value),
            '{"emoji":"雪🚀","nested":{"a":[12648430,false,null],"z":3.27859},"quote":"\\"","slash":"a/b"}',
        )
        self.assertEqual(
            worker.canonical_sha256(value),
            "872567954f7380a7289abcf7231e55107e6d7870ff2d630561a96ea2db2b2825",
        )

    def test_validates_all_modes_and_rejects_exact_key_or_digest_drift(self) -> None:
        for mode in worker.MODE_SPEC:
            with self.subTest(mode=mode):
                request = build_request(mode)
                worker.verify_request_document(request)

        request = build_request("score-3")
        with self.assertRaisesRegex(worker.WorkerFailure, "keys mismatch"):
            worker.verify_request_document({**request, "unexpected": True})
        forged = {**request, "requestDigest": "0" * 64}
        with self.assertRaisesRegex(worker.WorkerFailure, "digest mismatch"):
            worker.verify_request_document(forged)
        wrong_seeds = {**request, "seeds": list(reversed(request["seeds"]))}
        wrong_seeds["requestDigest"] = worker.canonical_sha256(
            {key: value for key, value in wrong_seeds.items() if key != "requestDigest"}
        )
        with self.assertRaisesRegex(worker.WorkerFailure, "mode, seed, or task"):
            worker.verify_request_document(wrong_seeds)
        boolean_schema = {**request, "schemaVersion": True}
        boolean_schema["requestDigest"] = worker.canonical_sha256(
            {
                key: value
                for key, value in boolean_schema.items()
                if key != "requestDigest"
            }
        )
        with self.assertRaisesRegex(worker.WorkerFailure, "schema version"):
            worker.verify_request_document(boolean_schema)
        wrong_amendment = {**request, "campaignAmendmentSha256": "0" * 64}
        wrong_amendment["requestDigest"] = worker.canonical_sha256(
            {
                key: value
                for key, value in wrong_amendment.items()
                if key != "requestDigest"
            }
        )
        with self.assertRaisesRegex(worker.WorkerFailure, "campaign amendment"):
            worker.verify_request_document(wrong_amendment)

    def test_rejects_unpaired_surrogates_before_canonical_hashing(self) -> None:
        parsed = worker.parse_json_bytes(
            b'{"emoji":"\\ud83d\\ude80"}', "paired request"
        )
        self.assertEqual(parsed, {"emoji": "🚀"})
        for source in (b'{"value":"\\ud800"}', b'{"\\udfff":true}'):
            with self.subTest(source=source):
                with self.assertRaisesRegex(
                    worker.WorkerFailure, "unpaired Unicode surrogate"
                ):
                    worker.parse_json_bytes(source, "request")

    def test_reapplies_patch_and_rejects_forged_static_evidence(self) -> None:
        request = build_request()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            static_path = root / "nanogpt_contract.py"
            baseline_path = root / "train_gpt_simple.py"
            patch_path = root / "candidate.patch"
            shutil.copyfile(STATIC_EVALUATOR_PATH, static_path)
            shutil.copyfile(BASELINE_PATH, baseline_path)
            patch_path.write_text(PATCH, encoding="utf-8")
            args = argparse.Namespace(
                static_evaluator=static_path,
                baseline=baseline_path,
                candidate_patch=patch_path,
            )
            _, _, _, candidate = worker.validate_candidate_assets(args, request)
            self.assertEqual(
                worker.sha256_text(candidate),
                request["staticEvidence"]["candidateSha256"],
            )

            forged = json.loads(json.dumps(request))
            forged["staticEvidence"]["editableSegmentSha256"][0] = "0" * 64
            with self.assertRaisesRegex(
                worker.WorkerFailure, "rederived static evidence"
            ):
                worker.validate_candidate_assets(args, forged)

    def test_nonempty_identity_patch_materializes_the_stock_candidate(self) -> None:
        static_contract = worker.load_static_contract(
            STATIC_EVALUATOR_PATH,
            worker.sha256_file(STATIC_EVALUATOR_PATH),
        )
        baseline = BASELINE_PATH.read_text(encoding="utf-8")
        candidate, validation = worker.apply_and_validate_candidate(
            static_contract,
            baseline,
            STOCK_PATCH,
            worker.sha256_text(STOCK_PATCH),
        )
        self.assertEqual(candidate, baseline)
        self.assertEqual(validation["candidateSha256"], worker.PINNED_BASELINE_SHA256)
        self.assertEqual(validation["trainSteps"], 3290)

    def test_scored_dataset_manifest_has_exact_order_headers_and_capacity(self) -> None:
        manifest = json.loads(DATASET_MANIFEST_PATH.read_text(encoding="utf-8"))
        files = worker.validate_dataset_manifest_document(manifest)
        self.assertEqual(
            [item["path"] for item in files], list(worker.EXPECTED_DATASET_PATHS)
        )
        self.assertEqual(manifest["totalUsableTrainSteps"], 3420)
        self.assertGreaterEqual(manifest["totalUsableTrainSteps"], 3290)

        reordered = json.loads(json.dumps(manifest))
        reordered["files"][1], reordered["files"][2] = (
            reordered["files"][2],
            reordered["files"][1],
        )
        with self.assertRaisesRegex(worker.WorkerFailure, "changed identity or header"):
            worker.validate_dataset_manifest_document(reordered)

    def test_materializes_fresh_smoke_runtime_and_extracts_precise_trial(self) -> None:
        request = build_request("smoke-10")
        static_contract = worker.load_static_contract(
            STATIC_EVALUATOR_PATH,
            request["pins"]["staticEvaluatorSha256"],
        )
        baseline = BASELINE_PATH.read_text(encoding="utf-8")
        candidate, _ = worker.apply_and_validate_candidate(
            static_contract,
            baseline,
            PATCH,
            request["candidatePatch"]["digest"],
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            logs = root / "trial-logs"
            logs.mkdir()
            dataset = root / "dataset"
            dataset.mkdir()
            trial_dir, runtime_source = worker.materialize_trial(
                logs,
                static_contract,
                baseline,
                PATCH,
                request,
                0,
                dataset,
            )
            self.assertEqual(
                worker.sha256_file(trial_dir / worker.RUNTIME_CANDIDATE_NAME),
                request["staticEvidence"]["candidateSha256"],
            )
            self.assertIn("    train_steps = 10\n", runtime_source)
            self.assertIn(f"    seed = {worker.TRIAL_SEEDS[0]}\n", runtime_source)
            self.assertNotEqual(runtime_source, candidate)

            log_path = root / "trial-000.log"
            contract_line = (
                f"{worker.RUNTIME_MARKER_PREFIX}CONTRACT|contract={worker.RUNTIME_CONTRACT}"
                f"|request_digest={request['requestDigest']}"
                f"|candidate_sha256={request['staticEvidence']['candidateSha256']}"
                "|mode=smoke-10|index=0|seed=12648430"
                "|declared_train_steps=3200|effective_train_steps=10"
            )
            result_line = (
                f"{worker.RUNTIME_MARKER_PREFIX}RESULT|index=0|seed=12648430"
                "|declared_train_steps=3200|effective_train_steps=10"
                "|final_val_loss=3.200000001|optimizer_steps=10|backward_calls=80|peak_vram_mb=30123.500"
            )
            content = (
                runtime_source
                + "\n"
                + "=" * 100
                + "\n"
                + "\n".join(
                    [
                        "Running PyTorch 2.11.0+cu128 compiled for CUDA 12.8 on NVIDIA L40S with world_size 1",
                        "seed:12648430",
                        contract_line,
                        "step:10/10 val_loss:3.20000 train_time:1.000s step_avg:100.00ms",
                        result_line,
                        f"{worker.RUNTIME_MARKER_PREFIX}COMPLETE|trials=1",
                        "",
                    ]
                )
            )
            log_path.write_text(content, encoding="utf-8")
            loss, steps, peak = worker.parse_trial_log(
                log_path, runtime_source, request, 0, ENVIRONMENT
            )
            self.assertEqual(loss, 3.200000001)
            self.assertEqual(steps, 10)
            self.assertEqual(peak, 30123.5)

    def test_path_freshness_is_checked_only_after_request_identity(self) -> None:
        request = build_request("smoke-10")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            args = prepare_stage(root, request)
            args.output.write_text("existing durable evidence\n", encoding="utf-8")
            previous_cwd = Path.cwd()
            try:
                os.chdir(root)
                with mock.patch.object(
                    worker,
                    "validate_request_file",
                    wraps=worker.validate_request_file,
                ) as validate_request:
                    with self.assertRaisesRegex(
                        worker.WorkerFailure, "refusing to overwrite"
                    ):
                        worker.execute(args)
                validate_request.assert_called_once_with(args.request)
            finally:
                os.chdir(previous_cwd)
            self.assertEqual(
                args.output.read_text(encoding="utf-8"), "existing durable evidence\n"
            )

    def test_rehashes_environment_freeze_seal_and_executables(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            bin_dir = root / "bin"
            bin_dir.mkdir()
            resolved_python = root / "python-real"
            resolved_python.write_bytes(b"sealed-python")
            resolved_python.chmod(0o555)
            (bin_dir / "python3").symlink_to(resolved_python)
            (bin_dir / "python").symlink_to("python3")
            torchrun = bin_dir / "torchrun"
            torchrun.write_bytes(b"sealed-torchrun")
            torchrun.chmod(0o555)
            freeze_source = b"numpy==2.5.2\npip==25.2\ntorch==2.11.0+cu128\n"
            manifest_source = ENVIRONMENT_SOURCE
            manifest_sha256 = worker.sha256_bytes(manifest_source)
            freeze_sha256 = worker.sha256_bytes(freeze_source)
            seal = {
                "schemaVersion": 1,
                "environmentSpecSha256": worker.EXPECTED_ENVIRONMENT_SPEC_SHA256,
                "environmentManifestSha256": manifest_sha256,
                "pipFreezeSha256": freeze_sha256,
            }
            seal_source = (json.dumps(seal, sort_keys=True) + "\n").encode("utf-8")
            (root / "READY").write_text(
                worker.EXPECTED_ENVIRONMENT_SPEC_SHA256 + "\n", encoding="utf-8"
            )
            (root / "environment.json").write_bytes(manifest_source)
            (root / "environment-seal.json").write_bytes(seal_source)
            freeze_path = root / "pip-freeze.txt"
            freeze_path.write_bytes(freeze_source)
            executables = {
                "python": {
                    "path": str(bin_dir / "python"),
                    "linkTarget": "python3",
                    "python3LinkTarget": str(resolved_python),
                    "resolvedPath": str(resolved_python),
                    "sha256": worker.sha256_file(resolved_python),
                    "size": resolved_python.stat().st_size,
                },
                "torchrun": {
                    "path": str(torchrun),
                    "sha256": worker.sha256_file(torchrun),
                    "size": torchrun.stat().st_size,
                    "mode": 0o555,
                },
            }
            with (
                mock.patch.object(worker, "EXPECTED_ENVIRONMENT_DIR", root),
                mock.patch.object(
                    worker, "EXPECTED_ENVIRONMENT_MANIFEST_SHA256", manifest_sha256
                ),
                mock.patch.object(
                    worker,
                    "EXPECTED_ENVIRONMENT_SEAL_SHA256",
                    worker.sha256_bytes(seal_source),
                ),
                mock.patch.object(worker, "EXPECTED_PIP_FREEZE_SHA256", freeze_sha256),
                mock.patch.object(
                    worker, "EXPECTED_ENVIRONMENT_EXECUTABLES", executables
                ),
            ):
                self.assertEqual(
                    worker.validate_environment_artifacts(ENVIRONMENT, seal),
                    freeze_source,
                )
                freeze_path.write_bytes(freeze_source + b"unsealed==1\n")
                with self.assertRaisesRegex(
                    worker.WorkerFailure, "evidence bytes changed"
                ):
                    worker.validate_environment_artifacts(ENVIRONMENT, seal)

    def test_timeout_terminates_and_reaps_the_torchrun_process_group(self) -> None:
        process = mock.Mock()
        process.pid = 4242
        process.wait.side_effect = [
            subprocess.TimeoutExpired(cmd="torchrun", timeout=3),
            -signal.SIGTERM,
            -signal.SIGTERM,
        ]
        with mock.patch.object(worker.os, "killpg") as killpg:
            with self.assertRaisesRegex(
                worker.WorkerFailure, "process group terminated"
            ) as raised:
                worker._wait_for_process_group(process, 3, 0)
        self.assertEqual(raised.exception.kind, "timeout")
        self.assertEqual(
            killpg.call_args_list,
            [mock.call(4242, signal.SIGTERM), mock.call(4242, signal.SIGKILL)],
        )

    def test_verified_runtime_failure_remains_request_bound_and_schema_valid(
        self,
    ) -> None:
        request = build_request("smoke-10")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            args = prepare_stage(root, request)
            previous_cwd = Path.cwd()
            try:
                os.chdir(root)
                with (
                    mock.patch.object(worker, "validate_live_environment"),
                    mock.patch.object(worker, "validate_dataset", return_value={}),
                    mock.patch.object(
                        worker,
                        "validate_launch_and_probe_hardware",
                        side_effect=[
                            ("1703000", "GPU-verified"),
                            ("1703000", "GPU-verified"),
                        ],
                    ),
                    mock.patch.object(
                        worker,
                        "run_trial",
                        side_effect=worker.WorkerFailure(
                            "runtime", "torchrun exited 1"
                        ),
                    ),
                    contextlib.redirect_stdout(io.StringIO()),
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    result, exit_code = worker.execute(args)
            finally:
                os.chdir(previous_cwd)
            self.assertEqual(exit_code, 0)
            self.assertFalse(result["ok"])
            self.assertEqual(result["requestDigest"], request["requestDigest"])
            self.assertEqual(result["hardware"]["gpuUuid"], "GPU-verified")
            self.assertEqual(
                result["failure"], {"kind": "runtime", "message": "torchrun exited 1"}
            )
            worker.validate_result_document(result, request)
            self.assertEqual(
                json.loads(args.output.read_text(encoding="utf-8")), result
            )

    def test_early_hardware_failure_emits_no_unverified_positive_result(self) -> None:
        request = build_request("smoke-10")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            args = prepare_stage(root, request)
            previous_cwd = Path.cwd()
            try:
                os.chdir(root)
                with (
                    mock.patch.object(worker, "validate_live_environment"),
                    mock.patch.object(worker, "validate_dataset", return_value={}),
                    mock.patch.object(
                        worker,
                        "validate_launch_and_probe_hardware",
                        side_effect=worker.WorkerFailure(
                            "hardware", "GPU UUID probe failed"
                        ),
                    ),
                    mock.patch.dict(
                        os.environ,
                        {"SLURM_JOB_ID": "1702999", "CUDA_VISIBLE_DEVICES": "0"},
                        clear=False,
                    ),
                ):
                    with (
                        contextlib.redirect_stdout(io.StringIO()),
                        contextlib.redirect_stderr(io.StringIO()),
                    ):
                        with self.assertRaisesRegex(
                            worker.WorkerFailure, "GPU UUID probe failed"
                        ):
                            worker.execute(args)
            finally:
                os.chdir(previous_cwd)
            self.assertFalse(args.output.exists())


if __name__ == "__main__":
    unittest.main()

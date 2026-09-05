#!/usr/bin/env python3
"""Install and seal the pinned CompilerGym cBench dataset in a fresh site root."""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import platform
from pathlib import Path


PROTOCOL = "compiler-gym-cbench-dataset-bootstrap-v1"
PINNED_SITE_ROOT = Path(
    "/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2"
)
PINNED_PYTHON_VERSION = "3.10.19"
PINNED_COMPILER_GYM_VERSION = "0.2.5"
PINNED_TAR_SHA256 = (
    "601fff3944c866f6617e653b6eb5c1521382c935f56ca1f36a9f5cf1a49f3de5"
)
PINNED_MANIFEST_SHA256 = (
    "eeffd7593aeb696a160fd22e6b0c382198a65d0918b8440253ea458cfe927741"
)
PINNED_RUNTIME_ARCHIVE_SHA256 = (
    "a1b5b5d6b115e5809ccaefc2134434494271d184da67e2ee43d7f84d07329055"
)
EXPECTED_BENCHMARKS = 23
PINNED_BITCODE_TREE_MANIFEST_SHA256 = (
    "3447f0794f8e981ff72305cc4efd8e891bb3f348aeb25d189fb0915a39a322cb"
)
PINNED_BITCODE_FILES = 23
PINNED_BITCODE_MANIFEST_BYTES = 1901
PINNED_RUNTIME_TREE_MANIFEST_SHA256 = (
    "238784ee2032baa43e65a47aa00b13cc805430ffec70952b3dcaa4466a04c8c6"
)
PINNED_RUNTIME_FILES = 571
PINNED_RUNTIME_MANIFEST_BYTES = 54171


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def content_tree_manifest(root: Path) -> tuple[str, int, int]:
    paths = sorted(
        (path for path in root.rglob("*") if path.is_file() and not path.is_symlink()),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    rows = [
        f"{path.relative_to(root).as_posix()}\t{path.stat().st_size}\t{file_sha256(path)}\n"
        for path in paths
    ]
    manifest = "".join(rows).encode("utf-8")
    return hashlib.sha256(manifest).hexdigest(), len(paths), len(manifest)


def require_equal(label: str, observed: object, expected: object) -> None:
    if observed != expected:
        raise RuntimeError(
            f"{label} mismatch: expected {expected!r}, observed {observed!r}"
        )


def main() -> None:
    require_equal("Python version", platform.python_version(), PINNED_PYTHON_VERSION)
    site_root = Path(os.environ.get("COMPILER_GYM_SITE_DATA", ""))
    require_equal("COMPILER_GYM_SITE_DATA", site_root, PINNED_SITE_ROOT)
    compiler_gym = importlib.import_module("compiler_gym")
    require_equal(
        "CompilerGym version",
        getattr(compiler_gym, "__version__", None),
        PINNED_COMPILER_GYM_VERSION,
    )

    cbench = importlib.import_module("compiler_gym.envs.llvm.datasets.cbench")
    runfiles = importlib.import_module("compiler_gym.util.runfiles_path")
    dataset = cbench.CBenchDataset(site_data_base=runfiles.site_data_path("llvm-v0"))
    require_equal("dataset tar hash", dataset.tar_sha256, PINNED_TAR_SHA256)
    require_equal("dataset manifest hash", dataset.manifest_sha256, PINNED_MANIFEST_SHA256)
    require_equal("runtime archive hash", cbench._CBENCH_RUNTOME_DATA[1], PINNED_RUNTIME_ARCHIVE_SHA256)
    dataset.install()

    benchmark_uris = list(dataset.benchmark_uris())
    require_equal("benchmark manifest size", len(benchmark_uris), EXPECTED_BENCHMARKS)
    if len(set(benchmark_uris)) != len(benchmark_uris):
        raise RuntimeError("cBench benchmark manifest contains duplicate URIs")
    for uri in benchmark_uris:
        benchmark = uri.rsplit("/", 1)[-1]
        path = dataset.dataset_root / f"{benchmark}.bc"
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f"Missing sealed cBench bitcode: {path}")

    runtime_root = runfiles.site_data_path(
        "llvm-v0/cbench-v1-runtime-data/runtime_data"
    )
    if not runtime_root.is_dir():
        raise RuntimeError(f"Missing cBench runtime-data root: {runtime_root}")
    bitcode_sha256, bitcode_files, bitcode_manifest_bytes = content_tree_manifest(
        dataset.dataset_root
    )
    runtime_sha256, runtime_files, runtime_manifest_bytes = content_tree_manifest(
        runtime_root
    )
    require_equal(
        "bitcode tree manifest",
        bitcode_sha256,
        PINNED_BITCODE_TREE_MANIFEST_SHA256,
    )
    require_equal("bitcode file count", bitcode_files, PINNED_BITCODE_FILES)
    require_equal(
        "bitcode manifest bytes",
        bitcode_manifest_bytes,
        PINNED_BITCODE_MANIFEST_BYTES,
    )
    require_equal(
        "runtime tree manifest",
        runtime_sha256,
        PINNED_RUNTIME_TREE_MANIFEST_SHA256,
    )
    require_equal("runtime file count", runtime_files, PINNED_RUNTIME_FILES)
    require_equal(
        "runtime manifest bytes",
        runtime_manifest_bytes,
        PINNED_RUNTIME_MANIFEST_BYTES,
    )
    print(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "pass": True,
                "siteRoot": str(site_root),
                "benchmarkCount": len(benchmark_uris),
                "bitcodeFiles": bitcode_files,
                "bitcodeManifestBytes": bitcode_manifest_bytes,
                "bitcodeTreeManifestSha256": bitcode_sha256,
                "runtimeFiles": runtime_files,
                "runtimeManifestBytes": runtime_manifest_bytes,
                "runtimeTreeManifestSha256": runtime_sha256,
            },
            sort_keys=True,
            separators=(",", ":"),
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

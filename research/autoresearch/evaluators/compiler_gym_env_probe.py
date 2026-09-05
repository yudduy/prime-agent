"""Read-only FarmShare CompilerGym environment seal for host preflight."""

from __future__ import annotations

import hashlib
import importlib
import importlib.metadata
import json
import os
import platform
import stat
from pathlib import Path


PROTOCOL = "compiler-gym-farmshare-environment-probe-v1"
PINNED_PYTHON_VERSION = "3.10.19"
PINNED_COMPILER_GYM_VERSION = "0.2.5"
PINNED_INSTALLED_CBENCH_SOURCE_SHA256 = (
    "6e38fd10d4bfd7816dbe6f959ff8ae97a3c10ab94cadde883926d83c0db521ed"
)
PINNED_DISTRIBUTION_MANIFEST_SHA256 = (
    "4b84dea7461512ef8fdadb99a992066484119fc91b7d8f0d3b33b5598fa870dd"
)
PINNED_LD_LIBRARY_PATH = (
    "/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib"
)
PINNED_LIBTINFO_SHA256 = (
    "d82654b2615eb347e8f15a63862c9234f452187250b75d36dce8bd964541f02e"
)
PINNED_COMPATIBILITY_TREE_MANIFEST_SHA256 = (
    "c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1"
)
PINNED_COMPATIBILITY_TREE_ENTRIES = 2749
PINNED_COMPATIBILITY_TREE_MANIFEST_BYTES = 215462
PINNED_COMPILER_GYM_CACHE = (
    "/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache"
)
PINNED_COMPILER_GYM_SITE_DATA = (
    "/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2"
)
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
EXPECTED_CBENCH_VALIDATION_INPUTS = 20


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def distribution_manifest() -> tuple[str, int]:
    rows = set()
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if not isinstance(name, str) or not name:
            raise RuntimeError("installed distribution has no Name metadata")
        rows.add(f"{name}=={distribution.version}")
    manifest = "\n".join(sorted(rows, key=str.casefold)) + "\n"
    return hashlib.sha256(manifest.encode("utf-8")).hexdigest(), len(rows)


def compatibility_tree_manifest(root: Path) -> tuple[str, int, int]:
    paths = [path for path in root.rglob("*") if path.is_symlink() or path.is_file()]
    paths.sort(key=lambda path: path.relative_to(root).as_posix())
    rows: list[str] = []
    for path in paths:
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        mode = format(stat.S_IMODE(metadata.st_mode), "o")
        if path.is_symlink():
            rows.append(f"L\t{mode}\t{relative}\t{os.readlink(path)}\n")
        else:
            rows.append(
                f"F\t{mode}\t{relative}\t{metadata.st_size}\t{file_sha256(path)}\n"
            )
    manifest = "".join(rows).encode("utf-8")
    return hashlib.sha256(manifest).hexdigest(), len(paths), len(manifest)


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
        raise RuntimeError(f"{label} mismatch: expected {expected!r}, observed {observed!r}")


def main() -> None:
    require_equal("Python version", platform.python_version(), PINNED_PYTHON_VERSION)
    os.environ.pop("CI", None)
    compiler_gym = importlib.import_module("compiler_gym")
    cbench = importlib.import_module("compiler_gym.envs.llvm.datasets.cbench")
    require_equal("CompilerGym version", getattr(compiler_gym, "__version__", None), PINNED_COMPILER_GYM_VERSION)
    require_equal("cBench callback count", getattr(cbench, "NUM_DATASETS", None), EXPECTED_CBENCH_VALIDATION_INPUTS)
    cbench_path = Path(str(getattr(cbench, "__file__", "")))
    require_equal("installed cBench source", file_sha256(cbench_path), PINNED_INSTALLED_CBENCH_SOURCE_SHA256)
    distributions_sha256, distribution_count = distribution_manifest()
    require_equal("distribution manifest", distributions_sha256, PINNED_DISTRIBUTION_MANIFEST_SHA256)
    require_equal("LD_LIBRARY_PATH", os.environ.get("LD_LIBRARY_PATH"), PINNED_LD_LIBRARY_PATH)
    compatibility_root = Path(PINNED_LD_LIBRARY_PATH).parent
    libtinfo_sha256 = file_sha256(Path(PINNED_LD_LIBRARY_PATH) / "libtinfo.so.5.9")
    require_equal("libtinfo", libtinfo_sha256, PINNED_LIBTINFO_SHA256)
    tree_sha256, tree_entries, tree_bytes = compatibility_tree_manifest(compatibility_root)
    require_equal("compatibility tree", tree_sha256, PINNED_COMPATIBILITY_TREE_MANIFEST_SHA256)
    require_equal("compatibility tree entries", tree_entries, PINNED_COMPATIBILITY_TREE_ENTRIES)
    require_equal("compatibility tree bytes", tree_bytes, PINNED_COMPATIBILITY_TREE_MANIFEST_BYTES)
    require_equal("COMPILER_GYM_CACHE", os.environ.get("COMPILER_GYM_CACHE"), PINNED_COMPILER_GYM_CACHE)
    require_equal(
        "COMPILER_GYM_SITE_DATA",
        os.environ.get("COMPILER_GYM_SITE_DATA"),
        PINNED_COMPILER_GYM_SITE_DATA,
    )
    for value in (PINNED_COMPILER_GYM_CACHE, PINNED_COMPILER_GYM_SITE_DATA):
        if not Path(value).is_dir():
            raise RuntimeError(f"Pinned CompilerGym directory is not readable: {value}")
    site_root = Path(PINNED_COMPILER_GYM_SITE_DATA)
    bitcode_root = site_root / "llvm-v0/benchmark/cbench-v1/contents/cBench-v1"
    runtime_root = site_root / "llvm-v0/cbench-v1-runtime-data/runtime_data"
    bitcode_sha256, bitcode_files, bitcode_bytes = content_tree_manifest(bitcode_root)
    runtime_sha256, runtime_files, runtime_bytes = content_tree_manifest(runtime_root)
    require_equal("bitcode tree", bitcode_sha256, PINNED_BITCODE_TREE_MANIFEST_SHA256)
    require_equal("bitcode files", bitcode_files, PINNED_BITCODE_FILES)
    require_equal("bitcode manifest bytes", bitcode_bytes, PINNED_BITCODE_MANIFEST_BYTES)
    require_equal("runtime tree", runtime_sha256, PINNED_RUNTIME_TREE_MANIFEST_SHA256)
    require_equal("runtime files", runtime_files, PINNED_RUNTIME_FILES)
    require_equal("runtime manifest bytes", runtime_bytes, PINNED_RUNTIME_MANIFEST_BYTES)
    print(
        json.dumps(
            {
                "protocol": PROTOCOL,
                "pass": True,
                "pythonVersion": platform.python_version(),
                "compilerGymVersion": getattr(compiler_gym, "__version__", None),
                "cbenchValidationInputs": getattr(cbench, "NUM_DATASETS", None),
                "installedCbenchSourceSha256": file_sha256(cbench_path),
                "distributionManifestSha256": distributions_sha256,
                "distributionCount": distribution_count,
                "libtinfoSha256": libtinfo_sha256,
                "compatibilityTreeManifestSha256": tree_sha256,
                "compatibilityTreeEntries": tree_entries,
                "compatibilityTreeManifestBytes": tree_bytes,
                "bitcodeTreeManifestSha256": bitcode_sha256,
                "bitcodeFiles": bitcode_files,
                "bitcodeManifestBytes": bitcode_bytes,
                "runtimeTreeManifestSha256": runtime_sha256,
                "runtimeFiles": runtime_files,
                "runtimeManifestBytes": runtime_bytes,
            },
            sort_keys=True,
            separators=(",", ":"),
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

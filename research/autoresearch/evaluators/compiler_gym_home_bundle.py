#!/usr/bin/env python3
"""Build and verify the immutable FarmShare CompilerGym home bundle.

The bootstrap is additive: it refuses existing staging or final paths, copies
the repaired v2 payload without preserving hardlinks, relocates absolute
prefixes, seals every payload subtree, and publishes with one rename.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import tarfile
from pathlib import Path
from typing import Iterable, Mapping, Sequence


PROTOCOL = "compiler-gym-home-bundle-v3"
MANIFEST_SCHEMA = "sorted-relative-path-type-mode-size-digest-or-target-v1"
SOURCE_ROOT = Path("/scratch/users/duynguy/prime-autoresearch")
STAGE_ROOT = Path(
    "/home/users/duynguy/farmshare-work/prime-autoresearch/environments/"
    ".compiler-gym-v3-home-v1.staging"
)
FINAL_ROOT = Path(
    "/home/users/duynguy/farmshare-work/prime-autoresearch/environments/"
    "compiler-gym-v3-home-v1"
)
PYTHON_RELATIVE_ROOT = Path("python/cpython-3.10.19-linux-x86_64-gnu")
VENV_RELATIVE_ROOT = Path("venv")
CACHE_RELATIVE_ROOT = Path("cache")
SITE_RELATIVE_ROOT = Path("site")
COMPAT_RELATIVE_ROOT = Path("compat")
PAYLOAD_ROOTS = (
    PYTHON_RELATIVE_ROOT,
    VENV_RELATIVE_ROOT,
    CACHE_RELATIVE_ROOT,
    SITE_RELATIVE_ROOT,
    COMPAT_RELATIVE_ROOT,
)

SOURCE_PYTHON_ROOT = SOURCE_ROOT / "uv-python/cpython-3.10.19-linux-x86_64-gnu"
SOURCE_VENV_ROOT = SOURCE_ROOT / "compiler-gym-venv-v2"
SOURCE_CACHE_ROOT = SOURCE_ROOT / "compiler-gym-cache"
SOURCE_SITE_ROOT = SOURCE_ROOT / "compiler-gym-site-v2"
SOURCE_COMPAT_ROOT = SOURCE_ROOT / "compiler-gym-libs"
SOURCE_COMPAT_ARCHIVE = SOURCE_ROOT / "micromamba/pkgs/ncurses-5.9-10.tar.bz2"

EXPECTED_SOURCE_GYM_MANIFEST = {
    "sha256": "4d43033d3bf77c06576d39a958445624944b23e7b7195c766e563af8b1a1426e",
    "files": 113,
    "manifestBytes": 10798,
}
EXPECTED_SOURCE_COMPILER_GYM_MANIFEST = {
    "sha256": "120da44770df98efdbb15bcbaec9bc0ef42769774558d4160c2d23877bd088f4",
    "files": 170,
    "manifestBytes": 16892,
}
EXPECTED_SOURCE_SITE_MANIFEST = {
    "sha256": "ff5d71b25a9bfb05fedc29209c54171d009568cf7eae8b4fbc7e4ee251187e67",
    "entries": 616,
    "manifestBytes": 88252,
}
EXPECTED_SOURCE_CACHE_MANIFEST = {
    "sha256": "d388d0ac4f46c52563ca25975772867836d4918f0fe6fe0fa5acbe6f8574142e",
    "entries": 10,
    "manifestBytes": 1428,
}
EXPECTED_SOURCE_COMPAT_MANIFEST = {
    "sha256": "c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1",
    "entries": 2749,
    "manifestBytes": 215462,
}
EXPECTED_COMPAT_ARCHIVE_SHA256 = (
    "8651c96bdb2eb0cc5505c03bbd1df0c86d5f8c3184ca8c9a87914b288272a508"
)
EXPECTED_CACHE_ARCHIVES = {
    "59c3f328efd51994a11168ca15e43a8d422233796c6bc167c9eb771c7bd6b57e",
    "601fff3944c866f6617e653b6eb5c1521382c935f56ca1f36a9f5cf1a49f3de5",
    "a1b5b5d6b115e5809ccaefc2134434494271d184da67e2ee43d7f84d07329055",
    "eeffd7593aeb696a160fd22e6b0c382198a65d0918b8440253ea458cfe927741",
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_contains(path: Path, needle: bytes) -> bool:
    """Search a file without loading large cached archives into memory."""
    overlap = max(len(needle) - 1, 0)
    previous = b""
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            window = previous + chunk
            if needle in window:
                return True
            previous = window[-overlap:] if overlap else b""
    return False


def typed_tree_manifest(root: Path) -> dict[str, object]:
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
                f"F\t{mode}\t{relative}\t{metadata.st_size}\t"
                f"{file_sha256(path)}\n"
            )
    manifest = "".join(rows).encode("utf-8")
    return {
        "schema": MANIFEST_SCHEMA,
        "sha256": hashlib.sha256(manifest).hexdigest(),
        "entries": len(paths),
        "manifestBytes": len(manifest),
    }


def content_tree_manifest(
    root: Path,
    *,
    python_only: bool = False,
) -> dict[str, object]:
    paths = sorted(
        (
            path
            for path in root.rglob("*")
            if path.is_file()
            and not path.is_symlink()
            and "__pycache__" not in path.parts
            and not path.name.endswith((".pyc", ".pyo"))
            and (not python_only or path.suffix == ".py")
        ),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    rows = [
        f"{path.relative_to(root).as_posix()}\t{path.stat().st_size}\t"
        f"{file_sha256(path)}\n"
        for path in paths
    ]
    manifest = "".join(rows).encode("utf-8")
    return {
        "sha256": hashlib.sha256(manifest).hexdigest(),
        "files": len(paths),
        "manifestBytes": len(manifest),
    }


def require_manifest(
    label: str,
    observed: Mapping[str, object],
    expected: Mapping[str, object],
) -> None:
    for key, expected_value in expected.items():
        observed_value = observed.get(key)
        if observed_value != expected_value:
            raise RuntimeError(
                f"{label} {key} mismatch: expected {expected_value!r}, "
                f"observed {observed_value!r}"
            )


def assert_source_payload() -> None:
    source_paths = (
        SOURCE_PYTHON_ROOT,
        SOURCE_VENV_ROOT,
        SOURCE_CACHE_ROOT,
        SOURCE_SITE_ROOT,
        SOURCE_COMPAT_ROOT,
        SOURCE_COMPAT_ARCHIVE,
    )
    for path in source_paths:
        if not path.exists():
            raise RuntimeError(f"Missing repaired v2 source payload: {path}")
    gym_root = SOURCE_VENV_ROOT / "lib/python3.10/site-packages/gym"
    compiler_gym_root = SOURCE_VENV_ROOT / "lib/python3.10/site-packages/compiler_gym"
    require_manifest(
        "Gym source tree",
        content_tree_manifest(gym_root, python_only=True),
        EXPECTED_SOURCE_GYM_MANIFEST,
    )
    require_manifest(
        "CompilerGym source tree",
        content_tree_manifest(compiler_gym_root),
        EXPECTED_SOURCE_COMPILER_GYM_MANIFEST,
    )
    require_manifest(
        "site-data tree",
        typed_tree_manifest(SOURCE_SITE_ROOT),
        EXPECTED_SOURCE_SITE_MANIFEST,
    )
    require_manifest(
        "cache tree",
        typed_tree_manifest(SOURCE_CACHE_ROOT),
        EXPECTED_SOURCE_CACHE_MANIFEST,
    )
    require_manifest(
        "compatibility tree",
        typed_tree_manifest(SOURCE_COMPAT_ROOT),
        EXPECTED_SOURCE_COMPAT_MANIFEST,
    )
    if file_sha256(SOURCE_COMPAT_ARCHIVE) != EXPECTED_COMPAT_ARCHIVE_SHA256:
        raise RuntimeError("Pinned ncurses compatibility archive hash mismatch")
    downloads = SOURCE_CACHE_ROOT / "downloads"
    for digest in EXPECTED_CACHE_ARCHIVES:
        path = downloads / digest
        if not path.is_file() or file_sha256(path) != digest:
            raise RuntimeError(f"Pinned CompilerGym cache archive mismatch: {digest}")


def run_rsync(source: Path, destination: Path, *, exclude_python_cache: bool) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    argv = ["/usr/bin/rsync", "-aS"]
    if exclude_python_cache:
        argv.extend(("--exclude=__pycache__/", "--exclude=*.py[co]"))
    argv.extend((f"{source}/", f"{destination}/"))
    subprocess.run(argv, check=True)


def parse_has_prefix() -> list[tuple[bytes, str, Path]]:
    with tarfile.open(SOURCE_COMPAT_ARCHIVE, "r:bz2") as archive:
        member = archive.extractfile("info/has_prefix")
        if member is None:
            raise RuntimeError("Pinned ncurses archive has no info/has_prefix")
        lines = member.read().decode("utf-8").splitlines()
    parsed: list[tuple[bytes, str, Path]] = []
    for line in lines:
        placeholder, mode, relative = line.split(" ", 2)
        if mode not in {"binary", "text"}:
            raise RuntimeError(f"Unsupported conda prefix mode: {mode}")
        parsed.append((placeholder.encode("utf-8"), mode, Path(relative)))
    return parsed


def replace_binary_prefix(
    content: bytes,
    old_prefix: bytes,
    new_prefix: bytes,
    placeholder: bytes,
) -> bytes:
    if len(new_prefix) > len(placeholder):
        raise RuntimeError("Destination compatibility prefix exceeds conda placeholder")
    old_slot = old_prefix + (b"\0" * (len(placeholder) - len(old_prefix)))
    new_slot = new_prefix + (b"\0" * (len(placeholder) - len(new_prefix)))
    if old_slot not in content:
        raise RuntimeError("Expected relocated binary prefix slot is absent")
    return content.replace(old_slot, new_slot)


def replace_text_prefix(path: Path, replacements: Sequence[tuple[bytes, bytes]]) -> None:
    content = path.read_bytes()
    updated = content
    for old_prefix, new_prefix in replacements:
        updated = updated.replace(old_prefix, new_prefix)
    if updated != content:
        path.write_bytes(updated)


def relocate_bundle(stage_root: Path, final_root: Path) -> None:
    old_python = SOURCE_PYTHON_ROOT.as_posix().encode("utf-8")
    new_python = (final_root / PYTHON_RELATIVE_ROOT).as_posix().encode("utf-8")
    old_venv = SOURCE_VENV_ROOT.as_posix().encode("utf-8")
    new_venv = (final_root / VENV_RELATIVE_ROOT).as_posix().encode("utf-8")
    old_cache = SOURCE_CACHE_ROOT.as_posix().encode("utf-8")
    new_cache = (final_root / CACHE_RELATIVE_ROOT).as_posix().encode("utf-8")
    old_site = SOURCE_SITE_ROOT.as_posix().encode("utf-8")
    new_site = (final_root / SITE_RELATIVE_ROOT).as_posix().encode("utf-8")
    old_compat = SOURCE_COMPAT_ROOT.as_posix().encode("utf-8")
    new_compat = (final_root / COMPAT_RELATIVE_ROOT).as_posix().encode("utf-8")

    compat_root = stage_root / COMPAT_RELATIVE_ROOT
    for placeholder, mode, relative in parse_has_prefix():
        path = compat_root / relative
        content = path.read_bytes()
        if mode == "binary":
            updated = replace_binary_prefix(content, old_compat, new_compat, placeholder)
        else:
            if old_compat not in content:
                raise RuntimeError(f"Expected compatibility text prefix is absent: {relative}")
            updated = content.replace(old_compat, new_compat)
        path.write_bytes(updated)

    replacements = (
        (old_python, new_python),
        (old_venv, new_venv),
        (old_cache, new_cache),
        (old_site, new_site),
        (old_compat, new_compat),
    )
    for relative_root in PAYLOAD_ROOTS:
        for path in (stage_root / relative_root).rglob("*"):
            if path.is_file() and not path.is_symlink():
                matching = [
                    old_prefix
                    for old_prefix, _ in replacements
                    if file_contains(path, old_prefix)
                ]
                if matching:
                    if file_contains(path, b"\0"):
                        raise RuntimeError(f"Unclassified binary prefix reference: {path}")
                    replace_text_prefix(path, replacements)

    python_link = stage_root / VENV_RELATIVE_ROOT / "bin/python"
    python_link.unlink()
    python_link.symlink_to("../../python/cpython-3.10.19-linux-x86_64-gnu/bin/python3.10")


def assert_no_hardlinks(root: Path) -> None:
    hardlinks = [
        path
        for path in root.rglob("*")
        if path.is_file() and not path.is_symlink() and path.stat().st_nlink != 1
    ]
    if hardlinks:
        raise RuntimeError(f"Bundle contains hardlinked files: {hardlinks[:5]}")


def assert_symlinks_resolve(root: Path) -> None:
    broken = [path for path in root.rglob("*") if path.is_symlink() and not path.exists()]
    if broken:
        raise RuntimeError(f"Bundle contains broken symlinks: {broken[:5]}")


def assert_no_scratch_references(root: Path) -> None:
    needle = b"/scratch/users/duynguy/prime-autoresearch"
    matches: list[Path] = []
    for path in root.rglob("*"):
        if path.is_symlink():
            has_reference = needle.decode("utf-8") in os.readlink(path)
        else:
            has_reference = path.is_file() and file_contains(path, needle)
        if has_reference:
            matches.append(path)
            if len(matches) == 5:
                break
    if matches:
        raise RuntimeError(f"Bundle retains scratch-prefix references: {matches}")


def make_payload_read_only(root: Path) -> None:
    """Make the sealed runtime immutable; request-local caches live elsewhere."""
    for relative_root in PAYLOAD_ROOTS:
        payload_root = root / relative_root
        paths = sorted(payload_root.rglob("*"), key=lambda path: len(path.parts), reverse=True)
        for path in paths:
            if not path.is_symlink():
                path.chmod(stat.S_IMODE(path.stat().st_mode) & ~0o222)
        payload_root.chmod(stat.S_IMODE(payload_root.stat().st_mode) & ~0o222)


def selected_payload_manifests(root: Path) -> dict[str, object]:
    venv_site = root / VENV_RELATIVE_ROOT / "lib/python3.10/site-packages"
    return {
        "gymPythonSources": content_tree_manifest(venv_site / "gym", python_only=True),
        "compilerGymPayload": content_tree_manifest(venv_site / "compiler_gym"),
    }


def build_seal(root: Path) -> dict[str, object]:
    payloads = {
        relative.as_posix(): typed_tree_manifest(root / relative)
        for relative in PAYLOAD_ROOTS
    }
    selected = selected_payload_manifests(root)
    body = {
        "protocol": PROTOCOL,
        "manifestSchema": MANIFEST_SCHEMA,
        "root": FINAL_ROOT.as_posix(),
        "payloads": payloads,
        "selected": selected,
        "sourcePins": {
            "compatibilityArchiveSha256": EXPECTED_COMPAT_ARCHIVE_SHA256,
            "cacheArchiveSha256": sorted(EXPECTED_CACHE_ARCHIVES),
        },
    }
    digest = hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()
    return {**body, "bundleSha256": digest}


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":"))


def write_seal_exclusive(root: Path, seal: Mapping[str, object]) -> None:
    path = root / "bundle-seal.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(canonical_json(seal) + "\n")
            output.flush()
            os.fsync(output.fileno())
    except Exception:
        raise


def verify_bundle(root: Path, *, require_final_root: bool = True) -> dict[str, object]:
    if require_final_root and root != FINAL_ROOT:
        raise RuntimeError(f"Verifier requires the exact final root: {FINAL_ROOT}")
    seal_path = root / "bundle-seal.json"
    seal = json.loads(seal_path.read_text(encoding="utf-8"))
    observed = build_seal(root)
    if canonical_json(seal) != canonical_json(observed):
        raise RuntimeError("CompilerGym home bundle seal mismatch")
    assert_no_hardlinks(root)
    assert_symlinks_resolve(root)
    assert_no_scratch_references(root)
    return observed


def bootstrap() -> dict[str, object]:
    if STAGE_ROOT.exists() or STAGE_ROOT.is_symlink():
        raise RuntimeError(f"Refusing existing staging path: {STAGE_ROOT}")
    if FINAL_ROOT.exists() or FINAL_ROOT.is_symlink():
        raise RuntimeError(f"Refusing existing final path: {FINAL_ROOT}")
    assert_source_payload()
    STAGE_ROOT.parent.mkdir(parents=True, exist_ok=True)
    STAGE_ROOT.mkdir(mode=0o755)
    run_rsync(SOURCE_PYTHON_ROOT, STAGE_ROOT / PYTHON_RELATIVE_ROOT, exclude_python_cache=True)
    run_rsync(SOURCE_VENV_ROOT, STAGE_ROOT / VENV_RELATIVE_ROOT, exclude_python_cache=True)
    run_rsync(SOURCE_CACHE_ROOT, STAGE_ROOT / CACHE_RELATIVE_ROOT, exclude_python_cache=False)
    run_rsync(SOURCE_SITE_ROOT, STAGE_ROOT / SITE_RELATIVE_ROOT, exclude_python_cache=False)
    run_rsync(SOURCE_COMPAT_ROOT, STAGE_ROOT / COMPAT_RELATIVE_ROOT, exclude_python_cache=False)
    relocate_bundle(STAGE_ROOT, FINAL_ROOT)
    assert_no_hardlinks(STAGE_ROOT)
    assert_symlinks_resolve(STAGE_ROOT)
    assert_no_scratch_references(STAGE_ROOT)
    make_payload_read_only(STAGE_ROOT)
    seal = build_seal(STAGE_ROOT)
    write_seal_exclusive(STAGE_ROOT, seal)
    STAGE_ROOT.chmod(0o555)
    verify_bundle(STAGE_ROOT, require_final_root=False)
    os.rename(STAGE_ROOT, FINAL_ROOT)
    return verify_bundle(FINAL_ROOT)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("bootstrap", "source-check", "verify"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "bootstrap":
        result = bootstrap()
    elif args.command == "source-check":
        assert_source_payload()
        result = {"protocol": PROTOCOL, "sourceCheck": True}
    else:
        result = verify_bundle(FINAL_ROOT)
    print(canonical_json(result), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

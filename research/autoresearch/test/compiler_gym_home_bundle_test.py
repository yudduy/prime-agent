from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "evaluators"
    / "compiler_gym_home_bundle.py"
)
SPEC = importlib.util.spec_from_file_location("compiler_gym_home_bundle", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load CompilerGym home bundle module")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompilerGymHomeBundleTest(unittest.TestCase):
    def test_typed_tree_manifest_binds_files_modes_and_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = root / "payload.txt"
            payload.write_text("payload\n", encoding="utf-8")
            payload.chmod(0o640)
            (root / "payload-link").symlink_to("payload.txt")

            first = MODULE.typed_tree_manifest(root)
            second = MODULE.typed_tree_manifest(root)

            self.assertEqual(first, second)
            self.assertEqual(first["entries"], 2)
            payload.write_text("changed\n", encoding="utf-8")
            self.assertNotEqual(MODULE.typed_tree_manifest(root)["sha256"], first["sha256"])

    def test_binary_prefix_relocation_preserves_slot_size(self) -> None:
        placeholder = b"/placeholder_" + (b"x" * 64)
        old_prefix = b"/scratch/old"
        new_prefix = b"/home/new/environment"
        old_slot = old_prefix + (b"\0" * (len(placeholder) - len(old_prefix)))
        content = b"before" + old_slot + b"after"

        relocated = MODULE.replace_binary_prefix(
            content,
            old_prefix,
            new_prefix,
            placeholder,
        )

        self.assertEqual(len(relocated), len(content))
        self.assertNotIn(old_prefix, relocated)
        self.assertIn(new_prefix, relocated)

    def test_hardlink_and_scratch_reference_checks_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "original"
            original.write_text("safe", encoding="utf-8")
            linked = root / "linked"
            os.link(original, linked)
            with self.assertRaisesRegex(RuntimeError, "hardlinked"):
                MODULE.assert_no_hardlinks(root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "reference").write_text(
                "/scratch/users/duynguy/prime-autoresearch/compiler-gym-site-v2",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "scratch-prefix"):
                MODULE.assert_no_scratch_references(root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "reference-link").symlink_to(
                "/scratch/users/duynguy/prime-autoresearch/compiler-gym-cache"
            )
            with self.assertRaisesRegex(RuntimeError, "scratch-prefix"):
                MODULE.assert_no_scratch_references(root)

    def test_streaming_search_finds_a_boundary_spanning_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "archive"
            needle = b"scratch-prefix"
            path.write_bytes((b"x" * (1024 * 1024 - 4)) + needle + b"tail")

            self.assertTrue(MODULE.file_contains(path, needle))
            self.assertFalse(MODULE.file_contains(path, b"not-present"))

    def test_payload_permissions_are_made_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative_root in MODULE.PAYLOAD_ROOTS:
                payload_root = root / relative_root
                payload_root.mkdir(parents=True)
                executable = payload_root / "entry"
                executable.write_text("payload", encoding="utf-8")
                executable.chmod(0o755)

            MODULE.make_payload_read_only(root)

            for relative_root in MODULE.PAYLOAD_ROOTS:
                payload_root = root / relative_root
                self.assertEqual(payload_root.stat().st_mode & 0o222, 0)
                executable = payload_root / "entry"
                self.assertEqual(executable.stat().st_mode & 0o222, 0)
                self.assertNotEqual(executable.stat().st_mode & 0o111, 0)


if __name__ == "__main__":
    unittest.main()

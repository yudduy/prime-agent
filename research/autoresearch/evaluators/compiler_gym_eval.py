#!/usr/bin/env python3
"""Strict CompilerGym v0.2.5 evaluator for the trusted cBench screen.

Input is one JSON object on stdin::

    {"benchmark":"benchmark://cbench-v1/crc32","actions":["-mem2reg"]}

The evaluator accepts no paths or command strings. Benchmarks and LLVM pass
flags must exactly match the pinned allowlists below. It emits exactly one JSON
object on stdout; CompilerGym output is redirected to stderr.

CompilerGym v0.2.5 registers cBench validation callbacks in groups: a base
semantic callback followed by sanitizer variants. This evaluator verifies the
known group layout and runs only the first (non-sanitized) callback for every
one of the 20 cBench inputs. Any upstream layout drift is a hard failure.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib
import importlib.metadata
import json
import math
import operator
import os
import platform
import stat
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from time import perf_counter
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


SCHEMA_VERSION = 2
EVALUATOR_CONTRACT = (
    "compiler-gym-v0.2.5-farmshare-cbench-ldpath-base20-raw-v2"
)
ENVIRONMENT_ID = "llvm-v0"
PINNED_PYTHON_VERSION = "3.10.19"
PINNED_COMPILER_GYM_VERSION = "0.2.5"
PINNED_LLVM_VERSION = "10.0.0"
PINNED_COMPILER_GYM_RELEASE = "v0.2.5"
PINNED_COMPILER_GYM_COMMIT = "64bdd6cd39967d3d2fe5e6c72deb15e830b838bb"
PINNED_COMPILER_GYM_SOURCE_URL = (
    "https://github.com/facebookresearch/CompilerGym/tree/"
    "64bdd6cd39967d3d2fe5e6c72deb15e830b838bb"
)
UPSTREAM_CBENCH_SOURCE_SHA256 = (
    "e6337c70f9a3e83abc8f54d9b4193e7ba51fe853a555fa78e472b2fc87920d88"
)
PINNED_CBENCH_PATCH_SHA256 = (
    "259956ea61364336dbc3e326cd27c7b6a0342fadbeba32b6c29da7024a4ccc00"
)
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
EXPECTED_CBENCH_VALIDATION_INPUTS = 20
MAX_ACTIONS = 256
MAX_REQUEST_BYTES = 64 * 1024
RAW_METRIC_NAMES = ("IrInstructionCount", "ObjectTextSizeBytes")

# These are the cBench-v1 programs with exactly 20 base callbacks and an
# actual stdout or output-file comparison in CompilerGym v0.2.5.
ALLOWED_CBENCH_BENCHMARKS: Tuple[str, ...] = (
    "benchmark://cbench-v1/blowfish",
    "benchmark://cbench-v1/bzip2",
    "benchmark://cbench-v1/crc32",
    "benchmark://cbench-v1/dijkstra",
    "benchmark://cbench-v1/gsm",
    "benchmark://cbench-v1/jpeg-c",
    "benchmark://cbench-v1/jpeg-d",
    "benchmark://cbench-v1/patricia",
    "benchmark://cbench-v1/qsort",
    "benchmark://cbench-v1/stringsearch",
    "benchmark://cbench-v1/susan",
    "benchmark://cbench-v1/tiff2bw",
    "benchmark://cbench-v1/tiff2rgba",
    "benchmark://cbench-v1/tiffdither",
    "benchmark://cbench-v1/tiffmedian",
)
ALLOWED_CBENCH_BENCHMARK_SET = frozenset(ALLOWED_CBENCH_BENCHMARKS)

# The remaining 8 programs in the pinned 23-program cBench manifest are
# intentionally outside causal scoring. In v0.2.5, SHA's validation hook return
# is ignored; bitcount and stringsearch2 do not cover 20 inputs; the other five
# have no enabled validators.
EXCLUDED_CBENCH_BENCHMARKS: Mapping[str, str] = {
    "benchmark://cbench-v1/adpcm": "no enabled semantic callbacks",
    "benchmark://cbench-v1/bitcount": "only two fixed argument callbacks",
    "benchmark://cbench-v1/ghostscript": "no enabled semantic callbacks",
    "benchmark://cbench-v1/ispell": "no enabled semantic callbacks",
    "benchmark://cbench-v1/lame": "no enabled semantic callbacks",
    "benchmark://cbench-v1/rijndael": "no enabled semantic callbacks",
    "benchmark://cbench-v1/sha": (
        "v0.2.5 ignores validate_sha_output()'s returned error"
    ),
    "benchmark://cbench-v1/stringsearch2": "only one input callback",
}

# validator() appends the base callback first, followed by sanitizer callbacks.
# Linux gets ASAN/TSAN/MSAN/UBSAN except jpeg-c, which enables TSAN/UBSAN only.
_LINUX_CALLBACK_GROUP_SIZE: Mapping[str, int] = {
    benchmark: (3 if benchmark.endswith("/jpeg-c") else 5)
    for benchmark in ALLOWED_CBENCH_BENCHMARKS
}

# Exact PassesAll action space generated from LLVM 10.0.0 actions.csv at the
# pinned CompilerGym commit. Exact-string membership prevents shell fragments,
# path operands, opt options, and parameterized flags from crossing the CLI.
PINNED_LLVM_PASS_FLAGS: Tuple[str, ...] = tuple(
    """-add-discriminators
-adce
-aggressive-instcombine
-alignment-from-assumptions
-always-inline
-argpromotion
-attributor
-barrier
-bdce
-break-crit-edges
-simplifycfg
-callsite-splitting
-called-value-propagation
-canonicalize-aliases
-consthoist
-constmerge
-constprop
-coro-cleanup
-coro-early
-coro-elide
-coro-split
-correlated-propagation
-cross-dso-cfi
-deadargelim
-dce
-die
-dse
-reg2mem
-div-rem-pairs
-early-cse-memssa
-early-cse
-elim-avail-extern
-ee-instrument
-flattencfg
-float2int
-forceattrs
-inline
-insert-gcov-profiling
-gvn-hoist
-gvn
-globaldce
-globalopt
-globalsplit
-guard-widening
-hotcoldsplit
-ipconstprop
-ipsccp
-indvars
-irce
-infer-address-spaces
-inferattrs
-inject-tli-mappings
-instsimplify
-instcombine
-instnamer
-jump-threading
-lcssa
-licm
-libcalls-shrinkwrap
-load-store-vectorizer
-loop-data-prefetch
-loop-deletion
-loop-distribute
-loop-fusion
-loop-guard-widening
-loop-idiom
-loop-instsimplify
-loop-interchange
-loop-load-elim
-loop-predication
-loop-reroll
-loop-rotate
-loop-simplifycfg
-loop-simplify
-loop-sink
-loop-reduce
-loop-unroll-and-jam
-loop-unroll
-loop-unswitch
-loop-vectorize
-loop-versioning-licm
-loop-versioning
-loweratomic
-lower-constant-intrinsics
-lower-expect
-lower-guard-intrinsic
-lowerinvoke
-lower-matrix-intrinsics
-lowerswitch
-lower-widenable-condition
-memcpyopt
-mergefunc
-mergeicmps
-mldst-motion
-sancov
-name-anon-globals
-nary-reassociate
-newgvn
-pgo-memop-opt
-partial-inliner
-partially-inline-libcalls
-post-inline-ee-instrument
-functionattrs
-mem2reg
-prune-eh
-reassociate
-redundant-dbg-inst-elim
-rpo-functionattrs
-rewrite-statepoints-for-gc
-sccp
-slp-vectorizer
-sroa
-scalarizer
-separate-const-offset-from-gep
-simple-loop-unswitch
-sink
-speculative-execution
-slsr
-strip-dead-prototypes
-strip-debug-declare
-strip-nondebug
-strip
-tailcallelim
-mergereturn""".splitlines()
)
PINNED_LLVM_PASS_FLAG_SET = frozenset(PINNED_LLVM_PASS_FLAGS)

_CBENCH_MANIFEST_SHA256 = (
    "eeffd7593aeb696a160fd22e6b0c382198a65d0918b8440253ea458cfe927741"
)
_CBENCH_RUNTIME_DATA_SHA256 = (
    "a1b5b5d6b115e5809ccaefc2134434494271d184da67e2ee43d7f84d07329055"
)
_CBENCH_BITCODE_SHA256 = {
    "darwin": "90b312b40317d9ee9ed09b4b57d378879f05e8970bb6de80dc8581ad0e36c84f",
    "linux": "601fff3944c866f6617e653b6eb5c1521382c935f56ca1f36a9f5cf1a49f3de5",
}

EXIT_OK = 0
EXIT_INVALID_REQUEST = 2
EXIT_ENVIRONMENT_ERROR = 3
EXIT_EVALUATION_ERROR = 4
EXIT_SEMANTIC_VALIDATION_FAILED = 5


class EvaluatorFailure(Exception):
    """A controlled failure that is safe to serialize to the result line."""

    def __init__(
        self,
        code: str,
        message: str,
        phase: str,
        exit_code: int,
        details: Optional[Mapping[str, object]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.phase = phase
        self.exit_code = exit_code
        self.details = dict(details or {})


def _seconds(start: float) -> float:
    return round(perf_counter() - start, 6)


@contextlib.contextmanager
def _redirect_process_stdout_to_stderr() -> Iterable[None]:
    """Keep Python and inherited child-process output off the JSON channel."""
    sys.stdout.flush()
    saved_stdout_fd = os.dup(sys.stdout.fileno())
    try:
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        sys.stderr.flush()
        os.dup2(saved_stdout_fd, sys.stdout.fileno())
        os.close(saved_stdout_fd)


def _reject_json_constant(value: str) -> object:
    raise EvaluatorFailure(
        code="invalid_json_constant",
        message=f"Non-finite JSON constant is not allowed: {value}",
        phase="request_parse",
        exit_code=EXIT_INVALID_REQUEST,
    )


def _object_without_duplicate_keys(
    pairs: Sequence[Tuple[str, object]],
) -> Dict[str, object]:
    result: Dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise EvaluatorFailure(
                code="duplicate_json_key",
                message=f"Duplicate JSON key is not allowed: {key}",
                phase="request_parse",
                exit_code=EXIT_INVALID_REQUEST,
            )
        result[key] = value
    return result


def _parse_request() -> Dict[str, object]:
    payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(payload) > MAX_REQUEST_BYTES:
        raise EvaluatorFailure(
            code="request_too_large",
            message=f"Request exceeds {MAX_REQUEST_BYTES} bytes",
            phase="request_parse",
            exit_code=EXIT_INVALID_REQUEST,
        )
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise EvaluatorFailure(
            code="request_not_utf8",
            message="Request must be UTF-8 JSON",
            phase="request_parse",
            exit_code=EXIT_INVALID_REQUEST,
            details={"decode_error": str(error)},
        ) from None
    if not text.strip():
        raise EvaluatorFailure(
            code="empty_request",
            message="Expected one JSON request object on stdin",
            phase="request_parse",
            exit_code=EXIT_INVALID_REQUEST,
        )
    try:
        value = json.loads(
            text,
            object_pairs_hook=_object_without_duplicate_keys,
            parse_constant=_reject_json_constant,
        )
    except EvaluatorFailure:
        raise
    except (json.JSONDecodeError, ValueError) as error:
        raise EvaluatorFailure(
            code="invalid_json",
            message="Request is not valid JSON",
            phase="request_parse",
            exit_code=EXIT_INVALID_REQUEST,
            details={"parse_error": str(error)},
        ) from None
    if not isinstance(value, dict):
        raise EvaluatorFailure(
            code="invalid_request_shape",
            message="Request must be a JSON object",
            phase="request_validation",
            exit_code=EXIT_INVALID_REQUEST,
        )

    unknown_keys = sorted(set(value) - {"benchmark", "actions"})
    missing_keys = sorted({"benchmark", "actions"} - set(value))
    if unknown_keys or missing_keys:
        raise EvaluatorFailure(
            code="invalid_request_keys",
            message="Request must contain exactly 'benchmark' and 'actions'",
            phase="request_validation",
            exit_code=EXIT_INVALID_REQUEST,
            details={"missing": missing_keys, "unknown": unknown_keys},
        )

    benchmark = value["benchmark"]
    if not isinstance(benchmark, str):
        raise EvaluatorFailure(
            code="invalid_benchmark_type",
            message="'benchmark' must be a string",
            phase="request_validation",
            exit_code=EXIT_INVALID_REQUEST,
        )
    if benchmark not in ALLOWED_CBENCH_BENCHMARK_SET:
        details: Dict[str, object] = {
            "benchmark": benchmark,
            "allowed_benchmarks": list(ALLOWED_CBENCH_BENCHMARKS),
        }
        if benchmark in EXCLUDED_CBENCH_BENCHMARKS:
            details["excluded_reason"] = EXCLUDED_CBENCH_BENCHMARKS[benchmark]
        raise EvaluatorFailure(
            code="benchmark_not_allowed",
            message="Benchmark is not in the trusted 20-input cBench allowlist",
            phase="request_validation",
            exit_code=EXIT_INVALID_REQUEST,
            details=details,
        )

    actions = value["actions"]
    if not isinstance(actions, list):
        raise EvaluatorFailure(
            code="invalid_actions_type",
            message="'actions' must be a JSON array of LLVM pass flags",
            phase="request_validation",
            exit_code=EXIT_INVALID_REQUEST,
        )
    if len(actions) > MAX_ACTIONS:
        raise EvaluatorFailure(
            code="too_many_actions",
            message=f"At most {MAX_ACTIONS} actions are allowed",
            phase="request_validation",
            exit_code=EXIT_INVALID_REQUEST,
            details={"received": len(actions)},
        )
    for index, action in enumerate(actions):
        if not isinstance(action, str):
            raise EvaluatorFailure(
                code="invalid_action_type",
                message=f"Action {index} must be a string",
                phase="request_validation",
                exit_code=EXIT_INVALID_REQUEST,
            )
        if action not in PINNED_LLVM_PASS_FLAG_SET:
            raise EvaluatorFailure(
                code="action_not_allowed",
                message=f"Action {index} is not a pinned LLVM pass flag",
                phase="request_validation",
                exit_code=EXIT_INVALID_REQUEST,
                details={"index": index, "action": action},
            )

    return {"benchmark": benchmark, "actions": list(actions)}


def _load_pinned_compiler_gym() -> Tuple[object, object, bool]:
    # cbench.py decides between 2 and 20 callbacks at import time based on CI.
    # This process-local removal is restored immediately after import.
    had_ci = "CI" in os.environ
    original_ci = os.environ.get("CI")
    os.environ.pop("CI", None)
    try:
        try:
            compiler_gym = importlib.import_module("compiler_gym")
            cbench = importlib.import_module("compiler_gym.envs.llvm.datasets.cbench")
        except (ImportError, ModuleNotFoundError) as error:
            raise EvaluatorFailure(
                code="compiler_gym_unavailable",
                message="compiler_gym==0.2.5 and its dependencies are required",
                phase="dependency_import",
                exit_code=EXIT_ENVIRONMENT_ERROR,
                details={"exception_type": type(error).__name__, "error": str(error)},
            ) from None
        except Exception as error:
            raise EvaluatorFailure(
                code="compiler_gym_import_failed",
                message="Failed to import the pinned CompilerGym runtime",
                phase="dependency_import",
                exit_code=EXIT_ENVIRONMENT_ERROR,
                details={"exception_type": type(error).__name__, "error": str(error)},
            ) from None
    finally:
        if had_ci and original_ci is not None:
            os.environ["CI"] = original_ci
        else:
            os.environ.pop("CI", None)

    version = getattr(compiler_gym, "__version__", None)
    if version != PINNED_COMPILER_GYM_VERSION:
        raise EvaluatorFailure(
            code="compiler_gym_version_mismatch",
            message=(
                f"Expected compiler_gym=={PINNED_COMPILER_GYM_VERSION}, "
                f"received {version!r}"
            ),
            phase="dependency_import",
            exit_code=EXIT_ENVIRONMENT_ERROR,
        )
    registered_inputs = getattr(cbench, "NUM_DATASETS", None)
    if registered_inputs != EXPECTED_CBENCH_VALIDATION_INPUTS:
        raise EvaluatorFailure(
            code="incomplete_cbench_callback_registration",
            message="CompilerGym did not register all 20 cBench inputs",
            phase="dependency_import",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={"registered_inputs": registered_inputs},
        )
    return compiler_gym, cbench, original_ci == "1"


def _loaded_module_sha256(module: object) -> Optional[str]:
    """Hash a loaded module's own file; the path never comes from the request."""
    module_path = getattr(module, "__file__", None)
    if not isinstance(module_path, str):
        return None
    digest = hashlib.sha256()
    try:
        with open(module_path, "rb") as module_file:
            for chunk in iter(lambda: module_file.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _distribution_manifest() -> Tuple[str, int]:
    rows = set()
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if not isinstance(name, str) or not name:
            raise ValueError("installed distribution has no Name metadata")
        rows.add(f"{name}=={distribution.version}")
    manifest = "\n".join(sorted(rows, key=str.casefold)) + "\n"
    return hashlib.sha256(manifest.encode("utf-8")).hexdigest(), len(rows)


def _compatibility_tree_manifest(root: Path) -> Tuple[str, int, int]:
    paths = [path for path in root.rglob("*") if path.is_symlink() or path.is_file()]
    paths.sort(key=lambda path: path.relative_to(root).as_posix())
    rows: List[str] = []
    for path in paths:
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        mode = format(stat.S_IMODE(metadata.st_mode), "o")
        if path.is_symlink():
            rows.append(f"L\t{mode}\t{relative}\t{os.readlink(path)}\n")
        elif path.is_file():
            rows.append(
                f"F\t{mode}\t{relative}\t{metadata.st_size}\t{_file_sha256(path)}\n"
            )
        else:
            raise ValueError(f"unsupported compatibility-tree entry: {relative}")
    manifest = "".join(rows).encode("utf-8")
    return hashlib.sha256(manifest).hexdigest(), len(paths), len(manifest)


def _verify_farmshare_environment(cbench: object) -> Dict[str, object]:
    python_version = platform.python_version()
    if python_version != PINNED_PYTHON_VERSION:
        raise EvaluatorFailure(
            code="python_version_mismatch",
            message="FarmShare Python runtime differs from the verifier epoch pin",
            phase="environment_seal",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={"expected": PINNED_PYTHON_VERSION, "observed": python_version},
        )

    installed_cbench_source_sha256 = _loaded_module_sha256(cbench)
    if installed_cbench_source_sha256 != PINNED_INSTALLED_CBENCH_SOURCE_SHA256:
        raise EvaluatorFailure(
            code="cbench_source_mismatch",
            message="Installed cBench source differs from the explicit FarmShare patch pin",
            phase="environment_seal",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={
                "expected": PINNED_INSTALLED_CBENCH_SOURCE_SHA256,
                "observed": installed_cbench_source_sha256,
            },
        )

    distribution_manifest_sha256, distribution_count = _distribution_manifest()
    if distribution_manifest_sha256 != PINNED_DISTRIBUTION_MANIFEST_SHA256:
        raise EvaluatorFailure(
            code="distribution_manifest_mismatch",
            message="Installed Python distributions differ from the FarmShare environment pin",
            phase="environment_seal",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={
                "expected": PINNED_DISTRIBUTION_MANIFEST_SHA256,
                "observed": distribution_manifest_sha256,
                "distribution_count": distribution_count,
            },
        )

    ld_library_path = os.environ.get("LD_LIBRARY_PATH")
    if ld_library_path != PINNED_LD_LIBRARY_PATH:
        raise EvaluatorFailure(
            code="ld_library_path_mismatch",
            message="LD_LIBRARY_PATH differs from the pinned compatibility environment",
            phase="environment_seal",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={"expected": PINNED_LD_LIBRARY_PATH, "observed": ld_library_path},
        )

    compatibility_root = Path(PINNED_LD_LIBRARY_PATH).parent
    libtinfo_path = Path(PINNED_LD_LIBRARY_PATH) / "libtinfo.so.5.9"
    try:
        libtinfo_sha256 = _file_sha256(libtinfo_path)
        tree_sha256, tree_entries, tree_bytes = _compatibility_tree_manifest(
            compatibility_root
        )
    except OSError as error:
        raise EvaluatorFailure(
            code="compatibility_tree_unreadable",
            message="Pinned FarmShare compatibility tree could not be read",
            phase="environment_seal",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={"error": str(error)},
        ) from None
    if libtinfo_sha256 != PINNED_LIBTINFO_SHA256:
        raise EvaluatorFailure(
            code="libtinfo_hash_mismatch",
            message="Compatibility libtinfo differs from the pinned ncurses artifact",
            phase="environment_seal",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={"expected": PINNED_LIBTINFO_SHA256, "observed": libtinfo_sha256},
        )
    if (
        tree_sha256 != PINNED_COMPATIBILITY_TREE_MANIFEST_SHA256
        or tree_entries != PINNED_COMPATIBILITY_TREE_ENTRIES
        or tree_bytes != PINNED_COMPATIBILITY_TREE_MANIFEST_BYTES
    ):
        raise EvaluatorFailure(
            code="compatibility_tree_mismatch",
            message="FarmShare compatibility tree differs from the pinned canonical manifest",
            phase="environment_seal",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={
                "expected_sha256": PINNED_COMPATIBILITY_TREE_MANIFEST_SHA256,
                "observed_sha256": tree_sha256,
                "expected_entries": PINNED_COMPATIBILITY_TREE_ENTRIES,
                "observed_entries": tree_entries,
                "expected_bytes": PINNED_COMPATIBILITY_TREE_MANIFEST_BYTES,
                "observed_bytes": tree_bytes,
            },
        )
    return {
        "python_version": python_version,
        "distribution_manifest_sha256": distribution_manifest_sha256,
        "distribution_count": distribution_count,
        "upstream_cbench_source_sha256": UPSTREAM_CBENCH_SOURCE_SHA256,
        "cbench_patch_sha256": PINNED_CBENCH_PATCH_SHA256,
        "installed_cbench_source_sha256": installed_cbench_source_sha256,
        "ld_library_path": ld_library_path,
        "libtinfo_sha256": libtinfo_sha256,
        "compatibility_tree_manifest_sha256": tree_sha256,
        "compatibility_tree_entries": tree_entries,
        "compatibility_tree_manifest_bytes": tree_bytes,
    }


def _nonnegative_integer(value: object, metric_name: str) -> int:
    if isinstance(value, bool):
        raise TypeError(f"{metric_name} returned bool instead of an integer")
    try:
        result = operator.index(value)
    except TypeError:
        raise TypeError(
            f"{metric_name} returned {type(value).__name__}, expected an integer"
        ) from None
    if result < 0:
        raise ValueError(f"{metric_name} returned a negative value: {result}")
    return int(result)


def _read_raw_metrics(env: object) -> Dict[str, int]:
    observation = getattr(env, "observation")
    return {
        name: _nonnegative_integer(observation[name], name) for name in RAW_METRIC_NAMES
    }


def _metrics_from_multistep_observations(values: object) -> Dict[str, int]:
    if not isinstance(values, (list, tuple)) or len(values) != len(RAW_METRIC_NAMES):
        raise EvaluatorFailure(
            code="invalid_observation_response",
            message="CompilerGym returned an unexpected observation response",
            phase="actions",
            exit_code=EXIT_EVALUATION_ERROR,
            details={"response_type": type(values).__name__},
        )
    return {
        name: _nonnegative_integer(value, name)
        for name, value in zip(RAW_METRIC_NAMES, values)
    }


def _select_base_callbacks(
    env: object, cbench: object, benchmark: str
) -> Tuple[List[Callable[[object], Iterable[object]]], int, int]:
    if sys.platform == "darwin":
        group_size = 1
    elif sys.platform.startswith("linux"):
        group_size = _LINUX_CALLBACK_GROUP_SIZE[benchmark]
    else:
        raise EvaluatorFailure(
            code="unsupported_platform",
            message="Pinned cBench artifacts support only Linux and macOS",
            phase="validation_setup",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={"platform": sys.platform},
        )

    benchmark_object = getattr(env, "benchmark")
    attached = list(benchmark_object.validation_callbacks())
    registry = getattr(cbench, "VALIDATORS")
    registered = list(registry.get(benchmark, []))
    expected_total = EXPECTED_CBENCH_VALIDATION_INPUTS * group_size
    if len(attached) != expected_total or len(registered) != expected_total:
        raise EvaluatorFailure(
            code="callback_layout_mismatch",
            message="Pinned cBench callback count does not match the known layout",
            phase="validation_setup",
            exit_code=EXIT_ENVIRONMENT_ERROR,
            details={
                "attached": len(attached),
                "registered": len(registered),
                "expected": expected_total,
                "group_size": group_size,
            },
        )
    if any(attached[index] is not registered[index] for index in range(expected_total)):
        raise EvaluatorFailure(
            code="callback_identity_mismatch",
            message="Attached cBench callbacks differ from the pinned registry",
            phase="validation_setup",
            exit_code=EXIT_ENVIRONMENT_ERROR,
        )

    base_callbacks = [
        attached[input_index * group_size]
        for input_index in range(EXPECTED_CBENCH_VALIDATION_INPUTS)
    ]
    if len(base_callbacks) != EXPECTED_CBENCH_VALIDATION_INPUTS:
        raise EvaluatorFailure(
            code="base_callback_selection_failed",
            message="Failed to select exactly 20 base callbacks",
            phase="validation_setup",
            exit_code=EXIT_ENVIRONMENT_ERROR,
        )
    return base_callbacks, group_size, expected_total - len(base_callbacks)


def _validation_worker_count() -> Tuple[int, str]:
    slurm_cpus = os.environ.get("SLURM_CPUS_PER_TASK")
    if slurm_cpus:
        try:
            cpu_count = int(slurm_cpus)
        except ValueError:
            cpu_count = 0
        if cpu_count > 0:
            return min(
                EXPECTED_CBENCH_VALIDATION_INPUTS, cpu_count
            ), "SLURM_CPUS_PER_TASK"
    cpu_count = os.cpu_count() or 1
    return min(EXPECTED_CBENCH_VALIDATION_INPUTS, cpu_count), "os.cpu_count"


def _json_safe(value: object, depth: int = 0) -> object:
    if depth > 8:
        return "<maximum serialization depth reached>"
    if value is None or isinstance(value, (bool, int, str)):
        if isinstance(value, str) and len(value) > 16384:
            return value[:16384] + "<truncated>"
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else repr(value)
    if isinstance(value, bytes):
        return _json_safe(value.decode("utf-8", errors="replace"), depth + 1)
    if isinstance(value, Mapping):
        return {
            str(key): _json_safe(item, depth + 1)
            for key, item in list(value.items())[:256]
        }
    if isinstance(value, (list, tuple)):
        return [_json_safe(item, depth + 1) for item in value[:256]]
    try:
        return _json_safe(os.fspath(value), depth + 1)
    except TypeError:
        return _json_safe(repr(value), depth + 1)


def _validation_error_record(error: object, input_index: int) -> Dict[str, object]:
    return {
        "input_index": input_index,
        "type": str(getattr(error, "type", type(error).__name__)),
        "data": _json_safe(getattr(error, "data", {})),
    }


def _run_one_callback(
    input_index: int,
    callback: Callable[[object], Iterable[object]],
    env: object,
) -> Dict[str, object]:
    started = perf_counter()
    try:
        errors = list(callback(env))
        return {
            "input_index": input_index,
            "completed": True,
            "passed": not errors,
            "errors": [
                _validation_error_record(error, input_index) for error in errors
            ],
            "walltime_seconds": _seconds(started),
        }
    except Exception as error:  # A callback exception means validation is incomplete.
        return {
            "input_index": input_index,
            "completed": False,
            "passed": False,
            "errors": [],
            "exception": {
                "type": type(error).__name__,
                "message": str(error),
            },
            "walltime_seconds": _seconds(started),
        }


def _run_full_validation(
    env: object,
    callbacks: Sequence[Callable[[object], Iterable[object]]],
) -> Tuple[List[Dict[str, object]], int, str]:
    workers, worker_source = _validation_worker_count()
    outcomes: List[Dict[str, object]] = []
    with ThreadPoolExecutor(
        max_workers=workers, thread_name_prefix="cbench-base-validator"
    ) as executor:
        future_to_input = {
            executor.submit(_run_one_callback, index, callback, env): index
            for index, callback in enumerate(callbacks, start=1)
        }
        for future in as_completed(future_to_input):
            outcomes.append(future.result())
    outcomes.sort(key=lambda outcome: int(outcome["input_index"]))
    return outcomes, workers, worker_source


def _derived_metrics(
    initial: Mapping[str, int], final: Mapping[str, int]
) -> Dict[str, object]:
    delta = {name: final[name] - initial[name] for name in RAW_METRIC_NAMES}
    improvement_fraction = {
        name: ((initial[name] - final[name]) / initial[name] if initial[name] else None)
        for name in RAW_METRIC_NAMES
    }
    return {
        "initial": dict(initial),
        "final": dict(final),
        "delta_final_minus_initial": delta,
        "improvement_fraction": improvement_fraction,
    }


def _evaluate(request: Mapping[str, object]) -> Tuple[Dict[str, object], int]:
    timings: Dict[str, float] = {}

    started = perf_counter()
    compiler_gym, cbench, ci_shortcut_neutralized = _load_pinned_compiler_gym()
    timings["dependency_import"] = _seconds(started)
    started = perf_counter()
    environment_seal = _verify_farmshare_environment(cbench)
    timings["environment_seal"] = _seconds(started)

    env = None
    try:
        started = perf_counter()
        env = compiler_gym.make(ENVIRONMENT_ID)
        timings["environment_create"] = _seconds(started)

        service_version = str(getattr(env, "version"))
        compiler_version = str(getattr(env, "compiler_version"))
        if service_version != PINNED_COMPILER_GYM_VERSION:
            raise EvaluatorFailure(
                code="service_version_mismatch",
                message="CompilerGym client and service versions do not match the pin",
                phase="environment_create",
                exit_code=EXIT_ENVIRONMENT_ERROR,
                details={"service_version": service_version},
            )
        if not (
            compiler_version == PINNED_LLVM_VERSION
            or compiler_version.startswith(PINNED_LLVM_VERSION + " ")
        ):
            raise EvaluatorFailure(
                code="llvm_version_mismatch",
                message="CompilerGym service is not backed by pinned LLVM 10.0.0",
                phase="environment_create",
                exit_code=EXIT_ENVIRONMENT_ERROR,
                details={"compiler_version": compiler_version},
            )

        benchmark = str(request["benchmark"])
        actions = list(request["actions"])
        started = perf_counter()
        env.reset(benchmark=benchmark)
        timings["reset"] = _seconds(started)
        canonical_benchmark = str(getattr(env, "benchmark"))
        if canonical_benchmark != benchmark:
            raise EvaluatorFailure(
                code="benchmark_canonicalization_mismatch",
                message="CompilerGym resolved a different benchmark URI",
                phase="reset",
                exit_code=EXIT_ENVIRONMENT_ERROR,
                details={"requested": benchmark, "resolved": canonical_benchmark},
            )

        runtime_flags = tuple(getattr(getattr(env, "action_space"), "flags"))
        if runtime_flags != PINNED_LLVM_PASS_FLAGS:
            raise EvaluatorFailure(
                code="action_space_mismatch",
                message="Runtime PassesAll action space differs from the pinned allowlist",
                phase="reset",
                exit_code=EXIT_ENVIRONMENT_ERROR,
                details={
                    "expected_count": len(PINNED_LLVM_PASS_FLAGS),
                    "runtime_count": len(runtime_flags),
                },
            )
        flag_to_index = {flag: index for index, flag in enumerate(runtime_flags)}
        action_indices = [flag_to_index[action] for action in actions]

        started = perf_counter()
        initial_metrics = _read_raw_metrics(env)
        timings["initial_observations"] = _seconds(started)

        step_info: object = {"action_had_no_effect": []}
        started = perf_counter()
        if action_indices:
            observations, _, done, step_info = env.multistep(
                action_indices,
                observation_spaces=list(RAW_METRIC_NAMES),
            )
            if done:
                raise EvaluatorFailure(
                    code="compiler_episode_terminated",
                    message="LLVM terminated while applying the action sequence",
                    phase="actions",
                    exit_code=EXIT_EVALUATION_ERROR,
                    details={"info": _json_safe(step_info)},
                )
            final_metrics = _metrics_from_multistep_observations(observations)
        else:
            final_metrics = dict(initial_metrics)
        timings["actions_and_final_observations"] = _seconds(started)
        commandline = str(env.commandline())

        started = perf_counter()
        callbacks, callback_group_size, excluded_sanitizer_callbacks = (
            _select_base_callbacks(env, cbench, benchmark)
        )
        timings["validation_setup"] = _seconds(started)

        started = perf_counter()
        validation_inputs, workers, worker_source = _run_full_validation(env, callbacks)
        timings["semantic_validation"] = _seconds(started)

        incomplete_inputs = [
            item for item in validation_inputs if not bool(item["completed"])
        ]
        semantic_errors = [
            error for item in validation_inputs for error in item.get("errors", [])
        ]
        validation_passed = not incomplete_inputs and not semantic_errors

        result: Dict[str, object] = {
            "schema_version": SCHEMA_VERSION,
            "contract": EVALUATOR_CONTRACT,
            "ok": validation_passed,
            "status": (
                "passed"
                if validation_passed
                else (
                    "validation_incomplete"
                    if incomplete_inputs
                    else "semantic_validation_failed"
                )
            ),
            "benchmark": canonical_benchmark,
            "request": {
                "benchmark": canonical_benchmark,
                "actions": actions,
            },
            "action_indices": action_indices,
            "commandline": commandline,
            "metrics": _derived_metrics(initial_metrics, final_metrics),
            "validation": {
                "passed": validation_passed,
                "inputs_expected": EXPECTED_CBENCH_VALIDATION_INPUTS,
                "inputs_completed": sum(
                    1 for item in validation_inputs if bool(item["completed"])
                ),
                "base_callbacks_selected": len(callbacks),
                "sanitizer_callbacks_selected": 0,
                "sanitizer_callbacks_excluded": excluded_sanitizer_callbacks,
                "registered_callback_group_size": callback_group_size,
                "workers": workers,
                "worker_count_source": worker_source,
                "semantic_errors": semantic_errors,
                "inputs": validation_inputs,
            },
            "environment": {
                "python_version": platform.python_version(),
                "platform": sys.platform,
                "platform_release": platform.release(),
                "machine": platform.machine(),
                "compiler_gym_version": PINNED_COMPILER_GYM_VERSION,
                "compiler_gym_service_version": service_version,
                "llvm_compiler_version": compiler_version,
                "environment_id": ENVIRONMENT_ID,
                "action_space": str(getattr(getattr(env, "action_space"), "name", "")),
                "slurm_job_id": os.environ.get("SLURM_JOB_ID"),
                "slurm_cpus_per_task": os.environ.get("SLURM_CPUS_PER_TASK"),
                "seal": environment_seal,
            },
            "provenance": {
                "compiler_gym_release": PINNED_COMPILER_GYM_RELEASE,
                "contract_upstream_commit": PINNED_COMPILER_GYM_COMMIT,
                "contract_upstream_source": PINNED_COMPILER_GYM_SOURCE_URL,
                "upstream_cbench_source_sha256": UPSTREAM_CBENCH_SOURCE_SHA256,
                "cbench_patch_sha256": PINNED_CBENCH_PATCH_SHA256,
                "pinned_installed_cbench_source_sha256": (
                    PINNED_INSTALLED_CBENCH_SOURCE_SHA256
                ),
                "installed_cbench_source_sha256": environment_seal[
                    "installed_cbench_source_sha256"
                ],
                "installed_cbench_source_matches_pin": True,
                "farmshare_environment_seal_passed": True,
                "cbench_dataset": "benchmark://cbench-v1",
                "cbench_manifest_sha256": _CBENCH_MANIFEST_SHA256,
                "cbench_bitcode_archive_sha256": _CBENCH_BITCODE_SHA256[sys.platform],
                "cbench_runtime_data_sha256": _CBENCH_RUNTIME_DATA_SHA256,
                "cbench_bitcode_llvm_version": PINNED_LLVM_VERSION,
                "metric_contract": "raw CompilerGym observations; lower is better",
                "validation_contract": (
                    "first non-sanitized callback from each known 20-input group"
                ),
                "ci_two_input_shortcut_neutralized": ci_shortcut_neutralized,
                "allowed_benchmark_count": len(ALLOWED_CBENCH_BENCHMARKS),
                "allowed_action_count": len(PINNED_LLVM_PASS_FLAGS),
            },
            "step_info": _json_safe(step_info),
            "timings_seconds": timings,
        }

        if incomplete_inputs:
            exit_code = EXIT_EVALUATION_ERROR
        elif semantic_errors:
            exit_code = EXIT_SEMANTIC_VALIDATION_FAILED
        else:
            exit_code = EXIT_OK
    except Exception:
        if env is not None:
            close_started = perf_counter()
            try:
                env.close()
            except Exception:
                pass
            timings["environment_close"] = _seconds(close_started)
        raise

    close_started = perf_counter()
    try:
        env.close()
    except Exception as error:
        raise EvaluatorFailure(
            code="environment_close_failed",
            message="CompilerGym environment failed to close cleanly",
            phase="environment_close",
            exit_code=EXIT_EVALUATION_ERROR,
            details={"exception_type": type(error).__name__, "error": str(error)},
        ) from None
    timings["environment_close"] = _seconds(close_started)
    return result, exit_code


def _failure_result(
    failure: EvaluatorFailure,
    total_seconds: float,
    request: Optional[Mapping[str, object]],
) -> Dict[str, object]:
    result: Dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "contract": EVALUATOR_CONTRACT,
        "ok": False,
        "status": "error",
        "error": {
            "code": failure.code,
            "message": failure.message,
            "phase": failure.phase,
            "details": _json_safe(failure.details),
        },
        "timings_seconds": {"total": round(total_seconds, 6)},
    }
    if request is not None and isinstance(request.get("benchmark"), str):
        result["benchmark"] = request["benchmark"]
    return result


def main() -> int:
    process_started = perf_counter()
    request: Optional[Dict[str, object]] = None
    try:
        parse_started = perf_counter()
        request = _parse_request()
        parse_seconds = _seconds(parse_started)
        with _redirect_process_stdout_to_stderr():
            result, exit_code = _evaluate(request)
        timings = result.get("timings_seconds")
        if isinstance(timings, dict):
            timings["request_parse"] = parse_seconds
            timings["total"] = _seconds(process_started)
    except EvaluatorFailure as failure:
        result = _failure_result(failure, _seconds(process_started), request)
        exit_code = failure.exit_code
    except Exception as error:
        failure = EvaluatorFailure(
            code="unhandled_evaluation_error",
            message="CompilerGym evaluation failed",
            phase="evaluation",
            exit_code=EXIT_EVALUATION_ERROR,
            details={"exception_type": type(error).__name__, "error": str(error)},
        )
        result = _failure_result(failure, _seconds(process_started), request)
        exit_code = failure.exit_code

    print(
        json.dumps(
            _json_safe(result),
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

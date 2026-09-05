#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LOCK_FILE="$SCRIPT_DIR/kernelbench-compiled-environment.lock"
SCRATCH_ROOT=${1:-/scratch/users/duynguy/prime-autoresearch/kernelbench-compiled}
PINNED_COMMIT=3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e
REPOSITORY=https://github.com/facebookresearch/kernel_bench_verified.git

case "$SCRATCH_ROOT" in
	/scratch/users/duynguy/*) ;;
	*) echo "scratch root must be below /scratch/users/duynguy" >&2; exit 2 ;;
esac
case "$SCRATCH_ROOT/" in
	*"/../"*|*"/./"*|*"//"*) echo "scratch root must be an absolute normalized path" >&2; exit 2 ;;
esac

EXPECTED_PYTHON=$(awk -F= '$1 == "python" { print $2 }' "$LOCK_FILE")
EXPECTED_PIP=$(awk -F= '$1 == "pip" { print $2 }' "$LOCK_FILE")
EXPECTED_TORCH=$(awk -F= '$1 == "torch" { print $2 }' "$LOCK_FILE")
EXPECTED_TORCH_CUDA=$(awk -F= '$1 == "torch-cuda" { print $2 }' "$LOCK_FILE")
TORCH_INDEX=$(awk -F= '$1 == "torch-index-url" { sub(/^[^=]*=/, ""); print }' "$LOCK_FILE")
EXPECTED_NUMPY=$(awk -F= '$1 == "numpy" { print $2 }' "$LOCK_FILE")
NUMPY_WHEEL_URL=$(awk -F= '$1 == "numpy-wheel-url" { sub(/^[^=]*=/, ""); print }' "$LOCK_FILE")
NUMPY_WHEEL_SHA256=$(awk -F= '$1 == "numpy-wheel-sha256" { print $2 }' "$LOCK_FILE")
FREEZE_FORMAT=$(awk -F= '$1 == "freeze-format" { print $2 }' "$LOCK_FILE")
ENVIRONMENT_DIGEST=$(sha256sum "$LOCK_FILE" | awk '{ print $1 }')
REPOSITORY_DIR="$SCRATCH_ROOT/repos/$PINNED_COMMIT"
ENVIRONMENT_DIR="$SCRATCH_ROOT/envs/$ENVIRONMENT_DIGEST"

test "$ENVIRONMENT_DIGEST" = 3f30aa083e7563eba4eb813e2fcd43fea1736488f84c75f68b7b68deb61aac6b
test "$NUMPY_WHEEL_SHA256" = 3cdec01fa790a186d430433fdd4d4ffb70eed6f0eeb4bf05c8dbe2dce0a9bcb8
test "$FREEZE_FORMAT" = pip-list-freeze-sorted-v1

mkdir -p "$SCRATCH_ROOT/repos" "$SCRATCH_ROOT/envs"
exec 9>"$SCRATCH_ROOT/bootstrap.lock"
flock 9

if [[ ! -f "$REPOSITORY_DIR/READY" ]]; then
	if [[ -e "$REPOSITORY_DIR" ]]; then
		mv "$REPOSITORY_DIR" "$REPOSITORY_DIR.incomplete.$(date -u +%Y%m%dT%H%M%SZ)"
	fi
	REPOSITORY_STAGE=$(mktemp -d "$SCRATCH_ROOT/repos/.build-$PINNED_COMMIT.XXXXXX")
	git clone --quiet --no-checkout "$REPOSITORY" "$REPOSITORY_STAGE"
	git -C "$REPOSITORY_STAGE" checkout --quiet --detach "$PINNED_COMMIT"
	test "$(git -C "$REPOSITORY_STAGE" rev-parse HEAD)" = "$PINNED_COMMIT"
	test -z "$(git -C "$REPOSITORY_STAGE" status --porcelain --untracked-files=no)"
	printf '%s\n' "$PINNED_COMMIT" > "$REPOSITORY_STAGE/READY"
	chmod -R a-w "$REPOSITORY_STAGE"
	mv "$REPOSITORY_STAGE" "$REPOSITORY_DIR"
fi

test "$(cat "$REPOSITORY_DIR/READY")" = "$PINNED_COMMIT"
test "$(git -C "$REPOSITORY_DIR" rev-parse HEAD)" = "$PINNED_COMMIT"
test -z "$(git -C "$REPOSITORY_DIR" status --porcelain --untracked-files=no)"

if [[ ! -f "$ENVIRONMENT_DIR/READY" ]]; then
	if [[ -e "$ENVIRONMENT_DIR" ]]; then
		mv "$ENVIRONMENT_DIR" "$ENVIRONMENT_DIR.incomplete.$(date -u +%Y%m%dT%H%M%SZ)"
	fi
	ACTUAL_PYTHON=$(python3 -c 'import platform; print(platform.python_version())')
	if [[ "$ACTUAL_PYTHON" != "$EXPECTED_PYTHON" ]]; then
		echo "python mismatch: expected $EXPECTED_PYTHON, got $ACTUAL_PYTHON" >&2
		exit 3
	fi
	ENVIRONMENT_STAGE=$(mktemp -d "$SCRATCH_ROOT/envs/.build-$ENVIRONMENT_DIGEST.XXXXXX")
	python3 -m venv "$ENVIRONMENT_STAGE"
	"$ENVIRONMENT_STAGE/bin/python" -m pip install --quiet --upgrade "pip==$EXPECTED_PIP"
	"$ENVIRONMENT_STAGE/bin/python" -m pip install --quiet --index-url "$TORCH_INDEX" "torch==$EXPECTED_TORCH"
	NUMPY_WHEEL_NAME=${NUMPY_WHEEL_URL##*/}
	case "$NUMPY_WHEEL_NAME" in
		numpy-2.5.2-*.whl) ;;
		*) echo "unexpected NumPy wheel filename" >&2; exit 4 ;;
	esac
	NUMPY_WHEEL="$ENVIRONMENT_STAGE/$NUMPY_WHEEL_NAME"
	"$ENVIRONMENT_STAGE/bin/python" - "$NUMPY_WHEEL_URL" "$NUMPY_WHEEL_SHA256" "$NUMPY_WHEEL" <<'PY'
import hashlib
from pathlib import Path
import sys
import urllib.request

content = urllib.request.urlopen(sys.argv[1], timeout=120).read()
if hashlib.sha256(content).hexdigest() != sys.argv[2]:
    raise SystemExit("NumPy wheel SHA-256 mismatch")
Path(sys.argv[3]).write_bytes(content)
PY
	"$ENVIRONMENT_STAGE/bin/python" -m pip install --quiet --no-deps "$NUMPY_WHEEL"
	rm "$NUMPY_WHEEL"
	LC_ALL=C "$ENVIRONMENT_STAGE/bin/python" -m pip list --format=freeze | LC_ALL=C sort > "$ENVIRONMENT_STAGE/pip-freeze.txt"
	"$ENVIRONMENT_STAGE/bin/python" - "$ENVIRONMENT_DIGEST" "$PINNED_COMMIT" > "$ENVIRONMENT_STAGE/environment.json" <<'PY'
import importlib.metadata
import json
import platform
import sys
import torch

print(json.dumps({
    "schemaVersion": 1,
    "environmentSpecSha256": sys.argv[1],
    "kernelBenchVerifiedCommit": sys.argv[2],
    "numpy": importlib.metadata.version("numpy"),
    "pip": importlib.metadata.version("pip"),
    "python": platform.python_version(),
    "torch": torch.__version__,
    "torchCuda": torch.version.cuda,
}, sort_keys=True))
PY
	"$ENVIRONMENT_STAGE/bin/python" - "$ENVIRONMENT_DIGEST" "$ENVIRONMENT_STAGE/environment.json" "$ENVIRONMENT_STAGE/pip-freeze.txt" > "$ENVIRONMENT_STAGE/environment-seal.json" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

print(json.dumps({
    "schemaVersion": 1,
    "environmentSpecSha256": sys.argv[1],
    "environmentManifestSha256": sha256(sys.argv[2]),
    "pipFreezeSha256": sha256(sys.argv[3]),
}, sort_keys=True))
PY
	printf '%s\n' "$ENVIRONMENT_DIGEST" > "$ENVIRONMENT_STAGE/READY"
	chmod -R a-w "$ENVIRONMENT_STAGE"
	mv "$ENVIRONMENT_STAGE" "$ENVIRONMENT_DIR"
fi

test "$(cat "$ENVIRONMENT_DIR/READY")" = "$ENVIRONMENT_DIGEST"
"$ENVIRONMENT_DIR/bin/python" - "$EXPECTED_PYTHON" "$EXPECTED_PIP" "$EXPECTED_TORCH" "$EXPECTED_TORCH_CUDA" "$EXPECTED_NUMPY" <<'PY'
import importlib.metadata
import platform
import sys
import torch

assert platform.python_version() == sys.argv[1]
assert importlib.metadata.version("pip") == sys.argv[2]
assert torch.__version__.split("+")[0] == sys.argv[3]
assert torch.version.cuda == sys.argv[4]
assert importlib.metadata.version("numpy") == sys.argv[5]
PY

printf '{"checkout":"%s","environment":"%s","environmentSpecSha256":"%s"}\n' \
	"$REPOSITORY_DIR" "$ENVIRONMENT_DIR" "$ENVIRONMENT_DIGEST"

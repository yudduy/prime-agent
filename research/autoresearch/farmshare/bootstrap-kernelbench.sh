#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LOCK_FILE="$SCRIPT_DIR/kernelbench-environment.lock"
SCRATCH_ROOT=${1:-/scratch/users/duynguy/prime-autoresearch/kernelbench}
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
ENVIRONMENT_DIGEST=$(sha256sum "$LOCK_FILE" | awk '{ print $1 }')
REPOSITORY_DIR="$SCRATCH_ROOT/repos/$PINNED_COMMIT"
ENVIRONMENT_DIR="$SCRATCH_ROOT/envs/$ENVIRONMENT_DIGEST"

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
	"$ENVIRONMENT_STAGE/bin/python" -m pip freeze --all > "$ENVIRONMENT_STAGE/pip-freeze.txt"
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
"$ENVIRONMENT_DIR/bin/python" - "$EXPECTED_PYTHON" "$EXPECTED_PIP" "$EXPECTED_TORCH" "$EXPECTED_TORCH_CUDA" <<'PY'
import importlib.metadata
import platform
import sys
import torch

assert platform.python_version() == sys.argv[1]
assert importlib.metadata.version("pip") == sys.argv[2]
assert torch.__version__.split("+")[0] == sys.argv[3]
assert torch.version.cuda == sys.argv[4]
PY

printf '{"checkout":"%s","environment":"%s","environmentSpecSha256":"%s"}\n' \
	"$REPOSITORY_DIR" "$ENVIRONMENT_DIR" "$ENVIRONMENT_DIGEST"

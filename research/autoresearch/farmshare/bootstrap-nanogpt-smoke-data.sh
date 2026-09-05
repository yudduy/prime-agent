#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MANIFEST_FILE="$SCRIPT_DIR/nanogpt-smoke-data.json"
SCRATCH_ROOT=${1:-/scratch/users/duynguy/prime-autoresearch/nanogpt}
EXPECTED_MANIFEST_SHA256=21e5ec359d94b274cc5dcd072b99bf5fa9132b4a34a414d062f151dc8cbdfd40

NORMALIZED_SCRATCH_ROOT=$(realpath -m -- "$SCRATCH_ROOT")
if [[ "$NORMALIZED_SCRATCH_ROOT" != "$SCRATCH_ROOT" ]]; then
	echo "scratch root must be an absolute normalized path" >&2
	exit 2
fi
case "$NORMALIZED_SCRATCH_ROOT" in
	/scratch/users/duynguy/*) ;;
	*) echo "scratch root must be below /scratch/users/duynguy" >&2; exit 2 ;;
esac

MANIFEST_SHA256=$(sha256sum "$MANIFEST_FILE" | awk '{ print $1 }')
if [[ "$MANIFEST_SHA256" != "$EXPECTED_MANIFEST_SHA256" ]]; then
	echo "NanoGPT smoke data manifest hash changed" >&2
	exit 2
fi
DATASET_DIR="$SCRATCH_ROOT/data/$MANIFEST_SHA256/fineweb10B"
READY_FILE="$DATASET_DIR/READY"

mkdir -p "$SCRATCH_ROOT/data"
exec 9>"$SCRATCH_ROOT/data-bootstrap.lock"
flock 9

if [[ -L "$DATASET_DIR" ]]; then
	echo "NanoGPT smoke dataset path must not be a symlink" >&2
	exit 2
fi
if [[ ! -f "$READY_FILE" ]]; then
	if [[ -e "$DATASET_DIR" ]]; then
		mv "$DATASET_DIR" "$DATASET_DIR.incomplete.$(date -u +%Y%m%dT%H%M%SZ)"
	fi
	DATASET_STAGE=$(mktemp -d "$SCRATCH_ROOT/data/.build-$MANIFEST_SHA256.XXXXXX")
	mkdir -p "$DATASET_STAGE/fineweb10B"
	python3 - "$MANIFEST_FILE" "$DATASET_STAGE/fineweb10B" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.request

manifest_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
if set(manifest) != {"schemaVersion", "dataset", "revision", "purpose", "files"}:
    raise SystemExit("NanoGPT smoke data manifest keys changed")
if manifest["schemaVersion"] != 1 or manifest["purpose"] != "nanogpt-track3-cuda-smoke-10":
    raise SystemExit("NanoGPT smoke data manifest identity changed")
if manifest["dataset"] != "kjj0/fineweb10B-gpt2":
    raise SystemExit("NanoGPT smoke dataset changed")
revision = manifest["revision"]
if revision != "889765ea1f903759787add96995d81171b632d0c":
    raise SystemExit("NanoGPT smoke dataset revision changed")
files = manifest["files"]
if not isinstance(files, list) or [item.get("path") for item in files] != [
    "fineweb_val_000000.bin",
    "fineweb_train_000001.bin",
]:
    raise SystemExit("NanoGPT smoke data file set changed")
for item in files:
    if set(item) != {"path", "size", "sha256"}:
        raise SystemExit("NanoGPT smoke data file record changed")
    name = item["path"]
    expected_size = item["size"]
    expected_sha256 = item["sha256"]
    if not isinstance(expected_size, int) or expected_size <= 0:
        raise SystemExit(f"invalid size for {name}")
    if not isinstance(expected_sha256, str) or re.fullmatch(r"[0-9a-f]{64}", expected_sha256) is None:
        raise SystemExit(f"invalid SHA-256 for {name}")
    url = f"https://huggingface.co/datasets/{manifest['dataset']}/resolve/{revision}/{name}"
    destination = output_dir / name
    digest = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(url, timeout=120) as response, destination.open("wb") as stream:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            stream.write(chunk)
    if size != expected_size or digest.hexdigest() != expected_sha256:
        raise SystemExit(f"content verification failed for {name}")
PY
	cp "$MANIFEST_FILE" "$DATASET_STAGE/fineweb10B/dataset-manifest.json"
	printf '%s\n' "$MANIFEST_SHA256" > "$DATASET_STAGE/fineweb10B/READY"
	mkdir -p "$(dirname "$DATASET_DIR")"
	mv "$DATASET_STAGE/fineweb10B" "$DATASET_DIR"
	chmod -R a-w "$DATASET_DIR"
	rmdir "$DATASET_STAGE"
fi

for metadata_file in "$READY_FILE" "$DATASET_DIR/dataset-manifest.json"; do
	if [[ ! -f "$metadata_file" || -L "$metadata_file" ]]; then
		echo "NanoGPT smoke metadata must be a regular non-symlink file: $metadata_file" >&2
		exit 2
	fi
done
test "$(cat "$READY_FILE")" = "$MANIFEST_SHA256"
python3 - "$MANIFEST_FILE" "$DATASET_DIR" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

manifest_path = Path(sys.argv[1])
dataset_dir = Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
if (dataset_dir / "dataset-manifest.json").read_bytes() != manifest_path.read_bytes():
    raise SystemExit("remote NanoGPT smoke manifest bytes changed")
def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
for item in manifest["files"]:
    path = dataset_dir / item["path"]
    if not path.is_file() or path.is_symlink():
        raise SystemExit(f"missing regular data file: {item['path']}")
    if path.stat().st_size != item["size"] or sha256(path) != item["sha256"]:
        raise SystemExit(f"remote data verification failed: {item['path']}")
PY

printf '{"datasetDir":"%s","manifestSha256":"%s","status":"ready"}\n' "$DATASET_DIR" "$MANIFEST_SHA256"

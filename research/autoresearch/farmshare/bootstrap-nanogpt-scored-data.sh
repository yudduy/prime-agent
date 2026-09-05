#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MANIFEST_FILE="$SCRIPT_DIR/nanogpt-scored-data.json"
SCRATCH_ROOT=${1:-/scratch/users/duynguy/prime-autoresearch/nanogpt}
EXPECTED_MANIFEST_SHA256=373bd25f990880b62f16e7b91d969fc7f5ca0802ff8208b4fa1d08ff0a52593a
SMOKE_MANIFEST_SHA256=21e5ec359d94b274cc5dcd072b99bf5fa9132b4a34a414d062f151dc8cbdfd40

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
	echo "NanoGPT scored data manifest hash changed" >&2
	exit 2
fi
DATASET_DIR="$SCRATCH_ROOT/data/$MANIFEST_SHA256/fineweb10B"
READY_FILE="$DATASET_DIR/READY"
REUSE_DIR="$SCRATCH_ROOT/data/$SMOKE_MANIFEST_SHA256/fineweb10B"

mkdir -p "$SCRATCH_ROOT/data"
exec 9>"$SCRATCH_ROOT/scored-data-bootstrap.lock"
flock 9

if [[ -L "$DATASET_DIR" ]]; then
	echo "NanoGPT scored dataset path must not be a symlink" >&2
	exit 2
fi
if [[ ! -f "$READY_FILE" ]]; then
	if [[ -e "$DATASET_DIR" ]]; then
		mv "$DATASET_DIR" "$DATASET_DIR.incomplete.$(date -u +%Y%m%dT%H%M%SZ)"
	fi
	DATASET_STAGE=$(mktemp -d "$SCRATCH_ROOT/data/.build-$MANIFEST_SHA256.XXXXXX")
	trap 'rm -rf -- "$DATASET_STAGE"' EXIT
	mkdir -p "$DATASET_STAGE/fineweb10B"
	python3 - "$MANIFEST_FILE" "$DATASET_STAGE/fineweb10B" "$REUSE_DIR" <<'PY'
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import sys
import urllib.request

manifest_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
reuse_dir = Path(sys.argv[3])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
expected_keys = {
    "schemaVersion",
    "dataset",
    "revision",
    "purpose",
    "globalBatchTokensWorldSizeOne",
    "usableStepsPerTrainShard",
    "totalUsableTrainSteps",
    "files",
}
if set(manifest) != expected_keys:
    raise SystemExit("NanoGPT scored data manifest keys changed")
if manifest["schemaVersion"] != 1:
    raise SystemExit("NanoGPT scored data manifest schema changed")
if manifest["dataset"] != "kjj0/fineweb10B-gpt2":
    raise SystemExit("NanoGPT scored dataset changed")
if manifest["revision"] != "889765ea1f903759787add96995d81171b632d0c":
    raise SystemExit("NanoGPT scored dataset revision changed")
if manifest["purpose"] != "nanogpt-track3-scored-v1-minimal-3290":
    raise SystemExit("NanoGPT scored dataset purpose changed")
if (
    manifest["globalBatchTokensWorldSizeOne"] != 524288
    or manifest["usableStepsPerTrainShard"] != 190
    or manifest["totalUsableTrainSteps"] != 3420
):
    raise SystemExit("NanoGPT scored dataset capacity contract changed")
expected_names = ["fineweb_val_000000.bin"] + [
    f"fineweb_train_{index:06d}.bin" for index in range(1, 19)
]
files = manifest["files"]
if not isinstance(files, list) or [item.get("path") for item in files] != expected_names:
    raise SystemExit("NanoGPT scored data file set changed")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, item: dict[str, object]) -> bool:
    if not path.is_file() or path.is_symlink():
        return False
    if path.stat().st_size != item["size"] or sha256(path) != item["sha256"]:
        return False
    with path.open("rb") as stream:
        magic, version, tokens = struct.unpack("<iii", stream.read(12))
    return (magic, version, tokens) == (item["magic"], item["version"], item["tokens"])


def materialize(item: dict[str, object]) -> None:
    if set(item) != {"path", "size", "sha256", "magic", "version", "tokens"}:
        raise RuntimeError("NanoGPT scored data file record changed")
    name = item["path"]
    expected_size = item["size"]
    expected_sha256 = item["sha256"]
    if not isinstance(name, str) or re.fullmatch(r"fineweb_(val|train)_\d{6}\.bin", name) is None:
        raise RuntimeError("invalid NanoGPT scored data path")
    if not isinstance(expected_size, int) or expected_size <= 0:
        raise RuntimeError(f"invalid size for {name}")
    if not isinstance(expected_sha256, str) or re.fullmatch(r"[0-9a-f]{64}", expected_sha256) is None:
        raise RuntimeError(f"invalid SHA-256 for {name}")
    destination = output_dir / name
    reusable = reuse_dir / name
    if verify_file(reusable, item):
        shutil.copyfile(reusable, destination)
    else:
        url = (
            f"https://huggingface.co/datasets/{manifest['dataset']}/resolve/"
            f"{manifest['revision']}/{name}?download=true"
        )
        partial = destination.with_suffix(".partial")
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(url, timeout=180) as response, partial.open("wb") as stream:
            while True:
                chunk = response.read(4 * 1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                size += len(chunk)
                stream.write(chunk)
        if size != expected_size or digest.hexdigest() != expected_sha256:
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"content verification failed for {name}")
        partial.rename(destination)
    if not verify_file(destination, item):
        raise RuntimeError(f"materialized data verification failed for {name}")


with ThreadPoolExecutor(max_workers=4) as executor:
    list(executor.map(materialize, files))
PY
	cp "$MANIFEST_FILE" "$DATASET_STAGE/fineweb10B/dataset-manifest.json"
	printf '%s\n' "$MANIFEST_SHA256" > "$DATASET_STAGE/fineweb10B/READY"
	mkdir -p "$(dirname "$DATASET_DIR")"
	mv "$DATASET_STAGE/fineweb10B" "$DATASET_DIR"
	chmod -R a-w "$DATASET_DIR"
	rmdir "$DATASET_STAGE"
	trap - EXIT
fi

python3 - "$MANIFEST_FILE" "$DATASET_DIR" "$MANIFEST_SHA256" <<'PY'
import hashlib
import json
from pathlib import Path
import struct
import sys

manifest_path = Path(sys.argv[1])
dataset_dir = Path(sys.argv[2])
manifest_sha256 = sys.argv[3]
manifest_bytes = manifest_path.read_bytes()
if (dataset_dir / "dataset-manifest.json").read_bytes() != manifest_bytes:
    raise SystemExit("remote NanoGPT scored manifest bytes changed")
if (dataset_dir / "READY").read_text(encoding="utf-8").strip() != manifest_sha256:
    raise SystemExit("remote NanoGPT scored READY marker changed")
expected_names = {item["path"] for item in json.loads(manifest_bytes)["files"]}
observed_names = {path.name for path in dataset_dir.iterdir()} - {"READY", "dataset-manifest.json"}
if observed_names != expected_names:
    raise SystemExit("remote NanoGPT scored data file set changed")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


for item in json.loads(manifest_bytes)["files"]:
    path = dataset_dir / item["path"]
    if not path.is_file() or path.is_symlink():
        raise SystemExit(f"missing regular data file: {item['path']}")
    if path.stat().st_size != item["size"] or sha256(path) != item["sha256"]:
        raise SystemExit(f"remote data verification failed: {item['path']}")
    with path.open("rb") as stream:
        header = struct.unpack("<iii", stream.read(12))
    if header != (item["magic"], item["version"], item["tokens"]):
        raise SystemExit(f"remote data header changed: {item['path']}")
PY

printf '{"datasetDir":"%s","manifestSha256":"%s","status":"ready"}\n' "$DATASET_DIR" "$MANIFEST_SHA256"

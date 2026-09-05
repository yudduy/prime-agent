#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import socket
import sys
import uuid
from pathlib import Path
from typing import Any


MAX_RESPONSE_BYTES = 1024 * 1024


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def write_json_atomic(path: Path, value: object) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("x", encoding="utf-8") as handle:
        handle.write(canonical_json(value) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def exchange(socket_path: str, request: object) -> dict[str, Any]:
    payload = (canonical_json(request) + "\n").encode("utf-8")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(socket_path)
        client.sendall(payload)
        chunks: list[bytes] = []
        received = 0
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            received += len(chunk)
            if received > MAX_RESPONSE_BYTES:
                raise ValueError("baseline proxy response exceeded 1 MiB")
            if b"\n" in chunk:
                break
    source = b"".join(chunks)
    if not source.endswith(b"\n") or source.count(b"\n") != 1:
        raise ValueError("baseline proxy returned a malformed response")
    value = json.loads(source.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("baseline proxy response must be an object")
    return value


def main() -> int:
    workspace = Path(__file__).resolve().parent.parent
    baseline_dir = workspace / ".baseline"
    config = load_json(baseline_dir / "proxy.json")
    if set(config) != {"nonce", "schemaVersion", "socketPath"} or config.get("schemaVersion") != 1:
        raise ValueError("baseline proxy configuration has changed")
    socket_path = config.get("socketPath")
    nonce = config.get("nonce")
    if not isinstance(socket_path, str) or not isinstance(nonce, str):
        raise ValueError("baseline proxy configuration is invalid")

    if len(sys.argv) < 2:
        print("usage: run_proxy_client.py <run|verify> ...", file=sys.stderr)
        return 2
    command = sys.argv[1]
    if command == "run":
        if len(sys.argv) != 3 or sys.argv[2] not in {"1", "3", "8"}:
            print("usage: bash run.sh [1|3|8]", file=sys.stderr)
            return 2
        trials = int(sys.argv[2])
        pending_path = baseline_dir / "pending-run.json"
        if pending_path.exists():
            pending = load_json(pending_path)
            if pending.get("trials") != trials or not isinstance(pending.get("operationId"), str):
                raise ValueError("a different run is already pending; recover it before changing trial count")
        else:
            pending = {"operationId": uuid.uuid4().hex, "trials": trials}
            write_json_atomic(pending_path, pending)
        request = {
            "kind": "run",
            "nonce": nonce,
            "operationId": pending["operationId"],
            "schemaVersion": 1,
            "trials": trials,
        }
        response = exchange(socket_path, request)
        if response.get("terminal") is True:
            pending_path.unlink(missing_ok=True)
        if response.get("ok") is not True:
            print(str(response.get("error", "baseline run failed")), file=sys.stderr)
            return 1
        print(str(response["logPath"]))
        return 0

    if command == "verify":
        if len(sys.argv) != 3:
            print("usage: python verify.py logs/<uuid>.txt", file=sys.stderr)
            return 2
        response = exchange(
            socket_path,
            {
                "kind": "verify",
                "logPath": sys.argv[2],
                "nonce": nonce,
                "schemaVersion": 1,
            },
        )
        if response.get("ok") is not True:
            print(str(response.get("error", "verification failed")), file=sys.stderr)
            return 1
        print(str(response["summary"]))
        return 0

    print(f"unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

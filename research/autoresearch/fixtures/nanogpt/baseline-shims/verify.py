#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python verify.py logs/<uuid>.txt", file=sys.stderr)
        return 2
    workspace = Path(__file__).resolve().parent
    return subprocess.run(
        [sys.executable, str(workspace / ".baseline" / "run_proxy_client.py"), "verify", sys.argv[1]],
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())

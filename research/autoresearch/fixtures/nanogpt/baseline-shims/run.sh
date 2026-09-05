#!/usr/bin/env bash
set -euo pipefail

readonly workspace_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${workspace_dir}/.baseline/run_proxy_client.py" run "${1:-1}"

#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
args=()
if [[ -f "$root/.env" ]]; then args+=("--env-file=$root/.env"); fi
exec node "${args[@]}" "$root/research/runtime-lab/start-lab.mjs"

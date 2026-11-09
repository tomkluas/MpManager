#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo '未找到 Node.js。请先安装 Node.js 22.19.0 或更高版本并运行 bash ./setup.sh。' >&2; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<19))process.exit(1)" || { echo "Node.js 版本过低：$(node --version)。需要 22.19.0 或更高版本。" >&2; exit 1; }
[[ -f "$root/app/node_modules/openclaw/openclaw.mjs" ]] || { echo '项目依赖尚未安装，请先运行 bash ./setup.sh。' >&2; exit 1; }

args=("--dns-result-order=ipv4first")
if [[ -f "$root/.env" ]]; then args+=("--env-file=$root/.env"); fi
exec node "${args[@]}" "$root/app/src/server.mjs"

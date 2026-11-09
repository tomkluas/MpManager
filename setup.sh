#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
include_paperclip=false
if [[ "${1:-}" == "--paperclip" ]]; then include_paperclip=true; fi

command -v node >/dev/null 2>&1 || { echo '未找到 Node.js。请先安装 Node.js 22.19.0 或更高版本。' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo '未找到 npm。请重新安装包含 npm 的 Node.js。' >&2; exit 1; }
node -e "const [a,b,c]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&(b<19||(b===19&&c<0))))process.exit(1)" || { echo "Node.js 版本过低：$(node --version)。需要 22.19.0 或更高版本。" >&2; exit 1; }

npm --prefix "$root/app" ci
if [[ ! -f "$root/app/node_modules/openclaw/openclaw.mjs" ]]; then
  npm --prefix "$root/app" install --no-save --package-lock=false openclaw@2026.6.10
fi

if [[ "$include_paperclip" == true ]]; then
  node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<24||(a===24&&b<11))process.exit(1)" || { echo "Paperclip 需要 Node.js 24.11 或更高版本，当前为 $(node --version)。主工作台仍可使用。" >&2; exit 1; }
  npm --prefix "$root/research/runtime-lab" ci
fi

if [[ ! -f "$root/.env" ]]; then
  cp "$root/.env.example" "$root/.env"
  echo '已创建 .env。请填写模型密钥后运行 bash ./start.sh。'
else
  echo '.env 已存在，未覆盖。'
fi
echo "安装完成。Node.js $(node --version)"

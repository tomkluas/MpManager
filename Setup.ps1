param([switch]$IncludePaperclip)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw '未找到 Node.js。请先安装 Node.js 22.19.0 或更高版本。' }
$versionText = (& $node.Source --version).TrimStart('v')
if ([version]$versionText -lt [version]'22.19.0') { throw "Node.js 版本过低：$versionText。需要 22.19.0 或更高版本。" }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw '未找到 npm.cmd。请重新安装包含 npm 的 Node.js。' }
& $npm.Source --prefix (Join-Path $root 'app') ci
if ($LASTEXITCODE -ne 0) { throw '主程序依赖安装失败。' }
$openClaw = Join-Path $root 'app/node_modules/openclaw/openclaw.mjs'
if (-not (Test-Path -LiteralPath $openClaw)) {
  & $npm.Source --prefix (Join-Path $root 'app') install --no-save --package-lock=false openclaw@2026.6.10
  if ($LASTEXITCODE -ne 0) { throw 'OpenClaw 2026.6.10 安装失败，请检查 npm 网络后重试。' }
}
if ($IncludePaperclip) {
  if ([version]$versionText -lt [version]'24.11.0') { throw "Paperclip 需要 Node.js 24.11 或更高版本，当前为 $versionText。主工作台仍可使用。" }
  & $npm.Source --prefix (Join-Path $root 'research/runtime-lab') ci
  if ($LASTEXITCODE -ne 0) { throw 'Paperclip 依赖安装失败。' }
}
$envPath = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  Copy-Item -LiteralPath (Join-Path $root '.env.example') -Destination $envPath
  Write-Host '已创建 .env。请填写模型密钥后运行 ./Start.ps1。'
} else {
  Write-Host '.env 已存在，未覆盖。'
}
Write-Host "安装完成。Node.js $versionText"

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw '未找到 Node.js。请先安装 Node.js 22.19.0 或更高版本并运行 ./Setup.ps1。' }
$versionText = (& $node.Source --version).TrimStart('v')
if ([version]$versionText -lt [version]'22.19.0') { throw "Node.js 版本过低：$versionText。需要 22.19.0 或更高版本。" }
$openClaw = Join-Path $root 'app/node_modules/openclaw/openclaw.mjs'
if (-not (Test-Path -LiteralPath $openClaw)) { throw '项目依赖尚未安装，请先运行 ./Setup.ps1。' }
$server = Join-Path $root 'app/src/server.mjs'
$envFile = Join-Path $root '.env'
$arguments = @('--dns-result-order=ipv4first')
if (Test-Path -LiteralPath $envFile) { $arguments += "--env-file=$envFile" }
$arguments += $server
& $node.Source @arguments
if ($LASTEXITCODE -ne 0) { throw "工作台异常退出，代码：$LASTEXITCODE" }

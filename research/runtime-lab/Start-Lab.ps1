$ErrorActionPreference = 'Stop'
$labRoot = $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw '未找到 Node.js。Paperclip 需要 Node.js 24.11 或更高版本。' }
$versionText = (& $node.Source --version).TrimStart('v')
if ([version]$versionText -lt [version]'24.11.0') { throw "Paperclip 需要 Node.js 24.11 或更高版本，当前为 $versionText。" }
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $labRoot '../..'))
$envFile = Join-Path $projectRoot '.env'
$arguments = @()
if (Test-Path -LiteralPath $envFile) { $arguments += "--env-file=$envFile" }
$arguments += (Join-Path $labRoot 'start-lab.mjs')
& $node.Source @arguments
if ($LASTEXITCODE -ne 0) { throw "Paperclip 异常退出，代码：$LASTEXITCODE" }

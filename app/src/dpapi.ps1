$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.operation -eq 'encrypt') {
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.value)
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($result))
  } elseif ($request.operation -eq 'decrypt') {
    $bytes = [Convert]::FromBase64String([string]$request.value)
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($result))
  } else { exit 1 }
} catch { [Console]::Error.Write('Credential operation failed'); exit 1 }

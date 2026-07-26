# secrets-guard: block commit/push of obvious secrets
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$fail = $false
$patterns = @(
  '\.env$',
  'deploy/\.env$',
  'repo\.env$',
  'deploy_key',
  '\.pem$',
  'github\.token'
)

$tracked = git ls-files
foreach ($f in $tracked) {
  foreach ($p in $patterns) {
    if ($f -match $p) {
      Write-Host "FAIL: sensitive path tracked: $f"
      $fail = $true
    }
  }
}

$staged = git diff --cached --name-only
$contentFiles = @($staged) + @(git diff --name-only)
$contentFiles = $contentFiles | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
foreach ($f in $contentFiles) {
  if ($f -match 'check-secrets\.ps1$' -or $f -match '\.env\.example$') { continue }
  $text = Get-Content -Raw -LiteralPath $f -ErrorAction SilentlyContinue
  if (-not $text) { continue }
  if ($text -match 'ghp_[A-Za-z0-9]{20,}' -or $text -match 'AKIA[0-9A-Z]{16}' -or $text -match 'sk-[A-Za-z0-9]{20,}') {
    Write-Host "FAIL: possible secret token in $f"
    $fail = $true
  }
}

if ($fail) {
  Write-Host "secrets-guard: FAILED"
  exit 1
}
Write-Host "secrets-guard: OK"
exit 0

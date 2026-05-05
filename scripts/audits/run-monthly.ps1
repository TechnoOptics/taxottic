# Wrapper invoked by Windows Task Scheduler on day 28 of each month.
# Runs the audit pipeline against the local checkout, logs to OneDrive.

$ErrorActionPreference = 'Stop'

$repo = 'C:\Users\abelm\Documents\Techno Optics LLc\taxottic'
$compliance = 'C:\Users\abelm\OneDrive - technooptics.org\Group Of Compannies\Taxottic\Documents for Plaid\Compliance'
$logDir = Join-Path $compliance '_run-logs'

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$logFile = Join-Path $logDir "audit-run-$stamp.log"

Set-Location $repo

# Tee output to both the log file and the host so a manual run from a
# console also shows progress. -ExitCode honours the runner's exit so
# Task Scheduler reports failures correctly.
& npm run audits:monthly *>&1 | Tee-Object -FilePath $logFile
$code = $LASTEXITCODE
exit $code

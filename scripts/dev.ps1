[CmdletBinding()]
param([switch]$Follow)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot ".dev-logs"
$stdoutLog = Join-Path $logDir "tauri.stdout.log"
$stderrLog = Join-Path $logDir "tauri.stderr.log"
$stateFile = Join-Path $logDir "dev-process.json"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

Get-Process -Name "shaderlab" -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path $stateFile) {
    $previous = Get-Content $stateFile -Raw | ConvertFrom-Json
    if (Get-Process -Id $previous.pid -ErrorAction SilentlyContinue) {
        Stop-Process -Id $previous.pid -Force
        Wait-Process -Id $previous.pid -ErrorAction SilentlyContinue
    }
}

Set-Content -Path $stdoutLog -Value ""
Set-Content -Path $stderrLog -Value ""
$previousBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
try {
    $process = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "tauri", "dev") `
        -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
} finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArgs
}

@{ pid = $process.Id; startedAt = (Get-Date).ToString("o"); stdout = $stdoutLog; stderr = $stderrLog; cdpPort = 9222 } |
    ConvertTo-Json | Set-Content -Path $stateFile
Write-Host "shaderlab dev lancé, PID $($process.Id)."
Write-Host "Logs: $logDir"
Write-Host "Suivi: npm run dev:monitor"
if ($Follow) { & (Join-Path $PSScriptRoot "monitor.ps1") }

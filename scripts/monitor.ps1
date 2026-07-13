[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot ".dev-logs"
$stateFile = Join-Path $logDir "dev-process.json"
$browserLog = Join-Path $logDir "browser-console.log"
$browserErrorLog = Join-Path $logDir "browser-console.error.log"
if (-not (Test-Path $stateFile)) { throw "Aucune session dev. Lance d'abord: npm run dev:debug" }

$state = Get-Content $stateFile -Raw | ConvertFrom-Json
if (-not (Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) {
    throw "Le processus dev PID $($state.pid) n'est plus actif. Relance: npm run dev:debug"
}

Set-Content -Path $browserLog -Value ""
Set-Content -Path $browserErrorLog -Value ""
$consoleProcess = Start-Process -FilePath "node.exe" `
    -ArgumentList @((Join-Path $PSScriptRoot "cdp-console.mjs"), "9222") `
    -WorkingDirectory $repoRoot -RedirectStandardOutput $browserLog `
    -RedirectStandardError $browserErrorLog -WindowStyle Hidden -PassThru
Write-Host "Suivi Tauri/Vite/WebView2. Ctrl+C arrête le suivi, pas l'app."
try {
    Get-Content -Path @($state.stdout, $state.stderr, $browserLog, $browserErrorLog) -Tail 80 -Wait
} finally {
    if (-not $consoleProcess.HasExited) { Stop-Process -Id $consoleProcess.Id -Force }
}

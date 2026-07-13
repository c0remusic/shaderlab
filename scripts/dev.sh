#!/usr/bin/env bash
# Kill any lingering shaderlab.exe (locks target/debug/shaderlab.exe and
# makes cargo's rebuild fail with "Accès refusé") and relaunch `tauri dev`
# with WebView2's CDP remote-debugging port enabled, so a fresh session can
# always attach for console/DOM debugging without re-deriving this each time.
#
# NEVER put --remote-debugging-port in tauri.conf.json's additionalBrowserArgs —
# that leaks the debug port into production builds and drops wry's default
# args (--disable-features=msWebOOUI,...). Env var, dev-launch only.
set -e
cd "$(dirname "$0")/.."

powershell -Command "Get-Process shaderlab -ErrorAction SilentlyContinue | Stop-Process -Force" 2>/dev/null || true

echo "Launching shaderlab dev (CDP on :9222)..."
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev

# ORBI Architecture (Local) - Windows Convenience Launcher
$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"
$nodeModules = Join-Path $frontendDir "node_modules"

if (-not (Test-Path $pythonExe)) {
    Write-Error "Backend venv not found at $pythonExe. Please create the venv first (see README.md)."
    exit 1
}
if (-not (Test-Path $nodeModules)) {
    Write-Error "Frontend node_modules not found at $nodeModules. Please run npm ci first in $frontendDir."
    exit 1
}

Write-Host "Starting ORBI Local Backend (127.0.0.1:8000)..." -ForegroundColor Cyan
$backendProc = Start-Process -FilePath $pythonExe `
    -ArgumentList "-m", "uvicorn", "orbi.server:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $backendDir -PassThru

Write-Host "============================================================" -ForegroundColor Green
Write-Host " ORBI ARCHITECTURE (LOCAL) ENGINE READY" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Backend:  http://127.0.0.1:8000 (PID: $($backendProc.Id))" -ForegroundColor Cyan
Write-Host " Frontend: http://127.0.0.1:5173" -ForegroundColor Cyan
Write-Host " IMPORTANT: Open http://127.0.0.1:5173 in your browser (NOT localhost)." -ForegroundColor Yellow
Write-Host " Starting Vite frontend... Press Ctrl+C to stop both servers." -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green

try {
    Set-Location $frontendDir
    npm run dev
} finally {
    if ($backendProc -and -not $backendProc.HasExited) {
        Write-Host "`nStopping ORBI backend (PID: $($backendProc.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
}

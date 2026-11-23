param(
    [switch]$UseConfiguredLLM,
    [ValidateRange(1, 65535)]
    [int]$BackendPort = 8000,
    [ValidateRange(1, 65535)]
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $projectRoot "backend"
$frontendDirectory = Join-Path $projectRoot "frontend"
$pythonPath = Join-Path $backendDirectory ".venv\Scripts\python.exe"
$dataDirectory = Join-Path $projectRoot ".data"
$databasePath = Join-Path $dataDirectory "shipmind-local-demo.db"
$backendOutputLog = Join-Path $dataDirectory "shipmind-backend.out.log"
$backendErrorLog = Join-Path $dataDirectory "shipmind-backend.err.log"
$frontendOutputLog = Join-Path $dataDirectory "shipmind-frontend.out.log"
$frontendErrorLog = Join-Path $dataDirectory "shipmind-frontend.err.log"

if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw "backend/.venv not found. Create a virtual environment and install backend/requirements.txt first."
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDirectory "node_modules") -PathType Container)) {
    throw "frontend/node_modules not found. Run npm install in the frontend directory first."
}

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

$databaseUrlPath = $databasePath.Replace("\", "/")
$env:DATABASE_URL = "sqlite:///$databaseUrlPath"
$env:MILVUS_ENABLED = "false"
$env:EMBEDDING_PROVIDER = "deterministic"
$env:EMBEDDING_MODEL = "deterministic-demo"
$env:EMBEDDING_DIMENSIONS = "128"
$env:AUTO_SYNC_ENABLED = "false"
$env:DEMO_MODE = "true"
$env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:$BackendPort"
$env:PYTHONPATH = $backendDirectory

if (-not $UseConfiguredLLM) {
    $env:LLM_API_KEY = ""
    $env:RAG_LLM_ENABLED = "false"
    $env:RAGAS_ENABLED = "false"
}

$backendProcess = $null
$frontendProcess = $null

try {
    $backendProcess = Start-Process `
        -FilePath $pythonPath `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
        -WorkingDirectory $backendDirectory `
        -RedirectStandardOutput $backendOutputLog `
        -RedirectStandardError $backendErrorLog `
        -WindowStyle Hidden `
        -PassThru

    $backendReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        if ($backendProcess.HasExited) {
            throw "The backend process exited early; check $backendErrorLog."
        }
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/health" -TimeoutSec 2 | Out-Null
            $backendReady = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $backendReady) {
        throw "The backend was not ready within 30 seconds; check $backendErrorLog."
    }

    Push-Location $backendDirectory
    try {
        & $pythonPath (Join-Path $projectRoot "scripts\seed_demo_data.py")
        if ($LASTEXITCODE -ne 0) {
            throw "Demo data initialization failed."
        }
    }
    finally {
        Pop-Location
    }

    $demoRepositories = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/api/repos" -TimeoutSec 5
    $demoRepository = $demoRepositories | Where-Object { $_.full_name -eq "shipmind-demo/shipmind-sample-api" } | Select-Object -First 1
    if (-not $demoRepository) {
        throw "The initialized demo repository was not found."
    }
    Invoke-RestMethod `
        -Method Patch `
        -Uri "http://127.0.0.1:$BackendPort/api/rag/repositories/$($demoRepository.id)/config" `
        -ContentType "application/json" `
        -Body '{"retrieval_method":"hybrid","score_threshold_enabled":false}' `
        -TimeoutSec 10 | Out-Null

    $frontendProcess = Start-Process `
        -FilePath "npm.cmd" `
        -ArgumentList @("run", "dev", "--", "-p", "$FrontendPort") `
        -WorkingDirectory $frontendDirectory `
        -RedirectStandardOutput $frontendOutputLog `
        -RedirectStandardError $frontendErrorLog `
        -WindowStyle Hidden `
        -PassThru

    $frontendReady = $false
    for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
        if ($frontendProcess.HasExited) {
            throw "The frontend process exited early; check $frontendErrorLog."
        }
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$FrontendPort" -TimeoutSec 2 | Out-Null
            $frontendReady = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $frontendReady) {
        throw "The frontend was not ready within 60 seconds; check $frontendErrorLog."
    }

    Write-Host "ShipMind local demo started:"
    Write-Host "  Frontend: http://127.0.0.1:$FrontendPort"
    Write-Host "  Backend: http://127.0.0.1:$BackendPort"
    Write-Host "  Backend PID: $($backendProcess.Id)"
    Write-Host "  Frontend PID: $($frontendProcess.Id)"
    Write-Host "  Stop with: Stop-Process -Id $($backendProcess.Id),$($frontendProcess.Id)"
    Write-Host "Note: this script disables Milvus and the demo knowledge base's score threshold. It is only for demoing pages, structured data and keyword search; vector search status will show degraded."
}
catch {
    if ($frontendProcess -and -not $frontendProcess.HasExited) {
        Stop-Process -Id $frontendProcess.Id
    }
    if ($backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id
    }
    throw
}

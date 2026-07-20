param(
  [ValidateSet("start", "stop", "status", "run-one", "run-50-pages", "report")]
  [string]$Action = "status",
  [int]$UserIndex = 1,
  [string]$RunId = "",
  [string]$AccountRunId = "",
  [int]$ExpectedCount = 50
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StatePath = Join-Path ([System.IO.Path]::GetTempPath()) "birdora-browser50-current.json"

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

function Invoke-DirectHttpGet {
  param(
    [string]$Url,
    [int]$TimeoutMs = 3000
  )

  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs)
  $response = $null
  try {
    $response = $client.GetAsync($Url).GetAwaiter().GetResult()
    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
  } finally {
    if ($response) {
      $response.Dispose()
    }
    $client.Dispose()
    $handler.Dispose()
  }
}

function Wait-Url {
  param(
    [string]$Url,
    [int]$TimeoutMs = 20000
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $lastError = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-DirectHttpGet -Url $Url -TimeoutMs 3000
      $statusCode = $response.StatusCode
      if ($statusCode -ge 200 -and $statusCode -lt 500) {
        return
      }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Timed out waiting for $Url. Last error: $lastError"
}

function Read-State {
  if (!(Test-Path $StatePath)) {
    throw "Harness state not found: $StatePath. Run start first."
  }
  try {
    return Get-Content -Path $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Harness state is unreadable or stale: $StatePath. Run start to refresh it. Parse error: $($_.Exception.Message)"
  }
}

function Stop-RecordedProcess {
  param([object]$ProcessId)
  if (!$ProcessId) {
    return
  }
  Stop-Process -Id ([int]$ProcessId) -Force -ErrorAction SilentlyContinue
}

function Initialize-IsolatedDatabase {
  param(
    [string]$TempDir,
    [string]$DatabaseFile
  )

  $dbInitScriptPath = Join-Path $TempDir "init-browser50-db.cjs"
  @"
const path = require("path");
const { getDatabase } = require(process.cwd() + "/app/db/database");

const databaseFile = process.env.DATABASE_FILE || "";
const resolvedDatabaseFile = path.resolve(databaseFile);
const parentDirName = path.basename(path.dirname(resolvedDatabaseFile));

if (!databaseFile) {
  throw new Error("DATABASE_FILE is required for browser50 database initialization.");
}

if (path.basename(resolvedDatabaseFile) !== "browser50.sqlite") {
  throw new Error("Refusing to initialize unexpected browser50 database file: " + resolvedDatabaseFile);
}

if (!parentDirName.startsWith("browser50-")) {
  throw new Error("Refusing to initialize database outside a browser50 temp run directory: " + resolvedDatabaseFile);
}

const db = getDatabase();
const row = db
  .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
  .get("table", "users");

if (!row) {
  throw new Error("users table was not created.");
}
"@ | Set-Content -Path $dbInitScriptPath -Encoding UTF8

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $dbInitOutput = & node --no-warnings $dbInitScriptPath 2>&1
  $dbInitExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($dbInitExitCode -ne 0) {
    throw "Failed to initialize isolated SQLite database at $DatabaseFile. $dbInitOutput"
  }
}

function Start-Harness {
  Set-Location $ProjectRoot

  if (Test-Path $StatePath) {
    try {
      $oldState = Read-State
      Stop-RecordedProcess $oldState.webPid
      Stop-RecordedProcess $oldState.apiPid
      Start-Sleep -Milliseconds 500
    } catch {
      Write-Warning "Could not stop previous harness state cleanly: $($_.Exception.Message)"
    }
  }

  if (!$RunId) {
    $RunId = "browser50-agents-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  }

  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) $RunId
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

  $webPort = Get-FreePort
  $apiPort = Get-FreePort
  $webBaseUrl = "http://127.0.0.1:$webPort"
  $apiBaseUrl = "http://127.0.0.1:$apiPort"
  $resultDir = Join-Path $ProjectRoot ("docs\browser-50-agent-results\" + $RunId)
  $databaseFile = Join-Path $tempDir "browser50.sqlite"
  $communityUploadDir = Join-Path $tempDir "community-uploads"
  $observationUploadDir = Join-Path $tempDir "observation-uploads"
  New-Item -ItemType Directory -Force -Path $resultDir | Out-Null

  $env:PUBLIC_HOST = "127.0.0.1"
  $env:PUBLIC_PORT = [string]$webPort
  $web = Start-Process -FilePath "node" -ArgumentList @("scripts/static-server.js") -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden

  $env:NODE_ENV = "test"
  $env:PORT = [string]$apiPort
  $env:CORS_ORIGIN = $webBaseUrl
  $env:DATABASE_FILE = $databaseFile
  $env:COMMUNITY_UPLOAD_DIR = $communityUploadDir
  $env:OBSERVATION_UPLOAD_DIR = $observationUploadDir
  $env:JWT_SECRET = "browser-50-agent-local-secret-with-more-than-32-characters"
  $env:AUTH_RATE_LIMIT = "100000"
  $env:COMMUNITY_WRITE_RATE_LIMIT = "100000"
  $env:AUTH_TIMING_HEADERS = "1"

  Initialize-IsolatedDatabase -TempDir $tempDir -DatabaseFile $databaseFile
  $api = Start-Process -FilePath "node" -ArgumentList @("server.js") -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden

  Wait-Url "$webBaseUrl/index.html"
  Wait-Url "$apiBaseUrl/api/health"

  $state = [ordered]@{
    runId = $RunId
    webBaseUrl = $webBaseUrl
    apiBaseUrl = $apiBaseUrl
    webPid = $web.Id
    apiPid = $api.Id
    tempDir = $tempDir
    resultDir = $resultDir
    statePath = $StatePath
    expectedCount = $ExpectedCount
  }
  $state | ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8
  $state | ConvertTo-Json

  Write-Host ""
  Write-Host "Sub-agent command template:"
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 run-one -UserIndex <1-50>"
  Write-Host ""
  Write-Host "After all agents finish:"
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 report"
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 stop"
  Write-Host ""
  Write-Host "Strict simultaneous browser pressure option:"
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 run-50-pages"
}

function Stop-Harness {
  $state = Read-State
  Stop-RecordedProcess $state.webPid
  Stop-RecordedProcess $state.apiPid
  Start-Sleep -Milliseconds 500

  $checks = @()
  foreach ($url in @($state.webBaseUrl + "/index.html", $state.apiBaseUrl + "/api/health")) {
    try {
      Invoke-DirectHttpGet -Url $url -TimeoutMs 2000 | Out-Null
      $checks += "$url still listening"
    } catch {
      $checks += "$url stopped"
    }
  }
  $checks -join "`n"
}

function Show-Status {
  try {
    $state = Read-State
  } catch {
    [ordered]@{
      state = "not-ready"
      statePath = $StatePath
      message = $_.Exception.Message
    } | ConvertTo-Json
    return
  }
  $count = 0
  if (Test-Path $state.resultDir) {
    $count = (Get-ChildItem -Path $state.resultDir -Filter "agent-*.json" | Measure-Object).Count
  }

  $health = "unknown"
  try {
    $response = Invoke-DirectHttpGet -Url ($state.apiBaseUrl + "/api/health") -TimeoutMs 3000
    $health = $response.Content
  } catch {
    $health = "not reachable: $($_.Exception.Message)"
  }

  [ordered]@{
    runId = $state.runId
    webBaseUrl = $state.webBaseUrl
    apiBaseUrl = $state.apiBaseUrl
    resultDir = $state.resultDir
    resultFiles = $count
    expectedCount = $state.expectedCount
    apiHealth = $health
  } | ConvertTo-Json
}

function Run-One {
  if ($UserIndex -lt 1 -or $UserIndex -gt 50) {
    throw "UserIndex must be between 1 and 50."
  }

  $state = Read-State
  Set-Location $ProjectRoot
  $env:WEB_BASE_URL = $state.webBaseUrl
  $env:E2E_API_BASE_URL = $state.apiBaseUrl
  $env:BIRDORA_BROWSER_RUN_ID = $state.runId
  $env:BIRDORA_BROWSER_RESULT_DIR = $state.resultDir
  $env:BIRDORA_BROWSER_USER_INDEX = [string]$UserIndex
  $env:BIRDORA_BROWSER_FLOW_TIMEOUT_MS = "120000"
  $env:BIRDORA_BROWSER_RECOGNITION_TIMEOUT_MS = "180000"
  if ($AccountRunId) {
    $env:BIRDORA_BROWSER_ACCOUNT_RUN_ID = $AccountRunId
  } else {
    Remove-Item Env:\BIRDORA_BROWSER_ACCOUNT_RUN_ID -ErrorAction SilentlyContinue
  }

  pnpm test:browser:user-flow
}

function Write-Report {
  $state = Read-State
  Set-Location $ProjectRoot
  $env:BIRDORA_BROWSER_RESULT_DIR = $state.resultDir
  $env:BIRDORA_BROWSER_RUN_ID = $state.runId
  $env:BIRDORA_BROWSER_EXPECTED_COUNT = [string]$ExpectedCount
  $env:BIRDORA_BROWSER_REPORT_JSON = Join-Path $ProjectRoot "docs\browser-50-agent-flow-report.json"
  $env:BIRDORA_BROWSER_REPORT_MD = Join-Path $ProjectRoot "docs\browser-50-agent-flow-report.md"
  pnpm test:browser:agents:report
}

function Run-FiftyPages {
  $state = Read-State
  Set-Location $ProjectRoot
  $env:BIRDORA_BROWSER_STATE_PATH = $StatePath
  $env:BIRDORA_BROWSER_EXPECTED_COUNT = [string]$ExpectedCount
  pnpm test:browser:50-pages
}

switch ($Action) {
  "start" { Start-Harness }
  "stop" { Stop-Harness }
  "status" { Show-Status }
  "run-one" { Run-One }
  "run-50-pages" { Run-FiftyPages }
  "report" { Write-Report }
}

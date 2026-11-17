$ErrorActionPreference = 'Stop'

function Stop-PortProcesses {
  param([int]$Port)

  $processIds = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($processId in $processIds) {
    if ($processId -and $processId -ne $PID) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-ProjectServerProcesses {
  $projectServerProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'Finsense_ai_Copy[\\/]server[\\/]server\.js' }

  foreach ($process in $projectServerProcesses) {
    if ($process.ProcessId -and $process.ProcessId -ne $PID) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientPath = Join-Path $projectRoot 'client'

Stop-ProjectServerProcesses
Stop-PortProcesses -Port 5000
Stop-PortProcesses -Port 5173

$serverCommand = "Set-Location '$projectRoot'; npm run server"
Start-Process powershell -ArgumentList @('-NoExit', '-Command', $serverCommand)

$deadline = (Get-Date).AddSeconds(15)
$serverReady = $false

while (-not $serverReady -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500

  try {
    Invoke-WebRequest -UseBasicParsing http://localhost:5000/ | Out-Null
    $serverReady = $true
  } catch {
  }
}

Set-Location $clientPath
npm run dev:5173

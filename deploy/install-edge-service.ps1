# Install the CommunityGate edge as a Windows auto-start service.
#
# Registers a Scheduled Task that runs the gate controller at system startup as
# SYSTEM, restarting on crash/reboot so a gate survives power loss -- the Windows
# equivalent of deploy/communitygate-edge.service (systemd) on Linux/Pi. Uses
# only built-in Windows tooling (Task Scheduler) -- no NSSM or other binaries.
#
# Run once, from an elevated PowerShell, on the gate's Windows PC:
#   .\deploy\install-edge-service.ps1 -PythonExe C:\path\to\venv\Scripts\python.exe
#
# Provide config in the env file (default C:\ProgramData\CommunityGate\edge.env),
# one KEY=VALUE per line: USE_C3_MOCK, USE_C3_PUSH, C3_PUSH_PORT, C3_SERIAL,
# GATE_ID, COMMUNITY_ID, DEVICE_TOKEN, CLOUD_API_URL, MQTT_BROKER, and so on.
#Requires -RunAsAdministrator
param(
  [string]$PythonExe = "python",
  [string]$RepoDir   = (Split-Path -Parent $PSScriptRoot),
  [string]$EnvFile   = (Join-Path $env:ProgramData "CommunityGate\edge.env"),
  [string]$TaskName  = "CommunityGateEdge"
)
$ErrorActionPreference = "Stop"

# 1. Persistent state dir (offline whitelist cache + event queue).
$stateDir = Join-Path $env:ProgramData "CommunityGate"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

# 2. Resolve python + the launcher to absolute paths the task can invoke.
$py     = (Get-Command $PythonExe -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot "run-edge.ps1"
if (-not (Test-Path $runner)) { throw "run-edge.ps1 not found next to this script: $runner" }

# 3. Register the scheduled task: at startup, as SYSTEM, auto-restart, no time limit.
$argline = '-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '"' +
           ' -PythonExe "' + $py + '"' +
           ' -RepoDir "' + $RepoDir + '"' +
           ' -EnvFile "' + $EnvFile + '"'
$action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argline
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
             -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName':"
Write-Host "  python:    $py"
Write-Host "  repo dir:  $RepoDir"
Write-Host "  state dir: $stateDir"
Write-Host "  env file:  $EnvFile"
if (-not (Test-Path $EnvFile)) {
  Write-Warning "Env file does not exist yet - create it (GATE_ID, COMMUNITY_ID, DEVICE_TOKEN, ...) before starting."
}
Write-Host "Start now:  Start-ScheduledTask -TaskName $TaskName"
Write-Host ("Remove:     Unregister-ScheduledTask -TaskName " + $TaskName + " -Confirm:" + '$false')

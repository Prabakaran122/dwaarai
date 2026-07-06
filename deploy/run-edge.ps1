# CommunityGate edge launcher (Windows).
# Loads the edge env file, then runs the gate controller, restarting it if it
# ever exits -- mirrors systemd Restart=always on the Linux/Pi unit. Registered
# to run at startup by install-edge-service.ps1; not usually run by hand.
param(
  [Parameter(Mandatory=$true)] [string]$PythonExe,
  [Parameter(Mandatory=$true)] [string]$RepoDir,
  [string]$EnvFile = (Join-Path $env:ProgramData "CommunityGate\edge.env")
)
$ErrorActionPreference = "Stop"

# Load KEY=VALUE lines from the env file into this process's environment.
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#") -or -not $t.Contains("=")) { continue }
    $i = $t.IndexOf("=")
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    [Environment]::SetEnvironmentVariable($k, $v, "Process")
  }
} else {
  Write-Warning "Env file not found: $EnvFile - relying on machine/user environment."
}

Set-Location $RepoDir
while ($true) {
  & $PythonExe -m edge.gate_controller
  Write-Warning "edge.gate_controller exited (code $LASTEXITCODE) - restarting in 5s"
  Start-Sleep -Seconds 5
}

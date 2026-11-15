# Keeps Agent Hub running in the background: compiles the web app, starts the hub, restarts it 15s after any exit.
# Single instance only. Logs go to ..\logs.
$dir = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $dir 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs 'supervisor.log'

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\AgentHubSupervisor', [ref]$created)
if (-not $created) { exit 0 }

function Log($m) { "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m" | Add-Content -Path $log -Encoding utf8 }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$web = Join-Path $dir 'web'
$vite = Join-Path $web 'node_modules\vite\bin\vite.js'
if (-not (Test-Path (Join-Path $dir 'node_modules\tsx'))) { Log 'node_modules missing - run "npm install" in the agent-hub folder first'; exit 1 }

while ($true) {
  if (Test-Path (Join-Path $dir 'supervisor.disabled')) { Log 'supervisor.disabled found - stopping'; break }
  try {
    # Build the React app (web/ -> web/dist). If the build fails the hub keeps serving the previous build.
    if (Test-Path $vite) {
      $b = Start-Process -FilePath $node -ArgumentList "`"$vite`" build" -WorkingDirectory $web -WindowStyle Hidden -PassThru -Wait `
           -RedirectStandardOutput (Join-Path $logs 'build.log') -RedirectStandardError (Join-Path $logs 'build-error.log')
      if ($b.ExitCode -ne 0) { Log 'web build failed (see logs\build.log and logs\build-error.log); serving the previous build' }
    } else { Log 'web\node_modules missing - run "npm install" in the agent-hub folder' }

    Log "starting: $node --import tsx hub/index.ts"
    $env:AGENT_HUB_SUPERVISED = '1'
    $p = Start-Process -FilePath $node -ArgumentList '--import tsx hub/index.ts' -WorkingDirectory $dir -WindowStyle Hidden -PassThru `
         -RedirectStandardOutput (Join-Path $logs 'hub.log') -RedirectStandardError (Join-Path $logs 'hub-error.log')
    $p.Id | Set-Content -Path (Join-Path $logs 'hub.pid')
    $p.WaitForExit()
    Log "hub exited (code $($p.ExitCode)) - restarting in 15s"
  } catch { Log "failed to start: $_ - retrying in 15s" }
  Start-Sleep -Seconds 15
}

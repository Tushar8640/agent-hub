# Stops the supervisor first (so it will not restart the hub), then the hub process.
$dir = Split-Path -Parent $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*agent-hub*supervisor.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$pidFile = Join-Path $dir 'logs\hub.pid'
if (Test-Path $pidFile) {
  $id = [int](Get-Content $pidFile)
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { taskkill /PID $id /T /F | Out-Null }
  Remove-Item $pidFile
}
Write-Output 'Agent Hub stopped. Run scripts\start.bat to start it again.'

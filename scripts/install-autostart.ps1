# Starts Agent Hub automatically 30 seconds after you log in to Windows.
# Run once:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# If it says "Access is denied", run the same command in PowerShell opened as administrator.
# To undo:   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
#            (or: Unregister-ScheduledTask -TaskName 'Agent Hub Supervisor' -Confirm:$false)
param([switch]$Remove)

$name = 'Agent Hub Supervisor'
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue

if ($Remove) {
  if ($existing) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Output 'Removed.'
  } else {
    Write-Output 'Not installed.'
  }
  exit 0
}

$vbs = Join-Path $PSScriptRoot 'supervisor.vbs'
if ($existing -and $existing.Actions[0].Arguments -like "*$vbs*") {
  Write-Output 'Already installed.'
  exit 0
}

try {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $trigger.Delay = 'PT30S'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Keeps Agent Hub running in the background.' -Force | Out-Null
  Write-Output "Done. Agent Hub will start 30 seconds after you log in. (Task: '$name')"
} catch {
  Write-Output "Failed: $_"
  exit 1
}

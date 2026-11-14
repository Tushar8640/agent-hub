# Starts Agent Hub automatically 30 seconds after you log in to Windows.
# Run once:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# If it says "Access is denied", run the same command in PowerShell opened as administrator.
# To undo:   Unregister-ScheduledTask -TaskName 'Agent Hub Supervisor' -Confirm:$false
$vbs = Join-Path $PSScriptRoot 'supervisor.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Agent Hub Supervisor' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Keeps Agent Hub running in the background.' -Force | Out-Null
Write-Output "Done. Agent Hub will start 30 seconds after you log in. (Task: 'Agent Hub Supervisor')"

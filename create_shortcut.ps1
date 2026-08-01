# Creates the PackLab 3D desktop shortcut.
# Target must exist first (run build_all.bat / build_frontend.bat).

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetExe = Join-Path $Root "release\PackLab3D.exe"
$ReleaseDir = Split-Path -Parent $TargetExe
$Desktop = [Environment]::GetFolderPath("DesktopDirectory")
$ShortcutPath = Join-Path $Desktop "PackLab 3D.lnk"
$WorkingDirectory = $ReleaseDir

if (-not (Test-Path -LiteralPath $TargetExe)) {
    Write-Error "[create_shortcut] Target not found: $TargetExe. Build the app first."
    exit 1
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetExe
$Shortcut.WorkingDirectory = $WorkingDirectory
$Shortcut.IconLocation = "$TargetExe,0"
$Shortcut.Description = "PackLab 3D - Precision Packaging Design."
$Shortcut.Save()

Write-Host "[create_shortcut] Created: $ShortcutPath -> $TargetExe"

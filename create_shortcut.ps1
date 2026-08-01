# Creates the PackLab 3D desktop shortcut.
# Target must exist first (run build_all.bat / build_frontend.bat).

$ErrorActionPreference = "Stop"

$TargetExe = "C:\Users\sekip\Desktop\PackLab 3D\release\PackLab3D.exe"
$ShortcutPath = "C:\Users\sekip\Desktop\PackLab 3D.lnk"
$WorkingDirectory = "C:\Users\sekip\Desktop\PackLab 3D"

if (-not (Test-Path $TargetExe)) {
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

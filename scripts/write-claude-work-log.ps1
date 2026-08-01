param(
    [ValidateSet("INFO", "SUCCESS", "WARNING", "ERROR")]
    [string]$Level = "INFO",
    [string]$Action = "",
    [string]$Files = "",
    [string]$Command = "",
    [string]$Result = ""
)

$ErrorActionPreference = "Stop"
$Desktop = [Environment]::GetFolderPath("Desktop")
$LogPath = Join-Path $Desktop "PackLab 3D - Claude Work Log.txt"
$Now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$Entry = @"
[$Now] [$Level]
Action: $Action
Files: $Files
Command: $Command
Result: $Result
"@

Add-Content -LiteralPath $LogPath -Value $Entry -Encoding UTF8
Write-Output $LogPath

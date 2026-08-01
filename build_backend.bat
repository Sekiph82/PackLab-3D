@echo off
REM Packages the FastAPI backend (packlab3d/backend) into a standalone .exe
REM using PyInstaller, then stages it for electron-builder's extraResources.
REM Requires: packlab3d/backend/api/main.py (Stage 2) to exist.

setlocal

set ROOT=%~dp0
set BACKEND_DIR=%ROOT%packlab3d\backend
set ENTRY=%BACKEND_DIR%\api\main.py
set DIST_DIR=%BACKEND_DIR%\dist
set BUILD_DIR=%BACKEND_DIR%\build
set STAGE_DIR=%ROOT%packlab3d\frontend\resources\backend

if not exist "%ENTRY%" (
    echo [build_backend] ERROR: %ENTRY% not found.
    echo [build_backend] Backend API ^(Stage 2^) must be built before packaging.
    exit /b 1
)

set PYINSTALLER=
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$cmd = Get-Command pyinstaller -ErrorAction SilentlyContinue; if ($cmd) { $cmd.Source }"`) do set PYINSTALLER=%%I

if "%PYINSTALLER%"=="" (
    for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$root = Join-Path $env:LOCALAPPDATA 'Programs\Python'; if (Test-Path $root) { Get-ChildItem -Path $root -Recurse -Filter pyinstaller.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }"`) do set PYINSTALLER=%%I
)

if "%PYINSTALLER%"=="" (
    echo [build_backend] ERROR: pyinstaller not found. Run: pip install pyinstaller
    exit /b 1
)

for /f %%P in ('powershell -NoProfile -Command "Get-Process PackLab3DBackend -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"') do (
    echo [build_backend] ERROR: PackLab3DBackend.exe is running as PID %%P. Close it before building.
    exit /b 1
)

if exist "%DIST_DIR%" rmdir /S /Q "%DIST_DIR%"
if exist "%BUILD_DIR%" rmdir /S /Q "%BUILD_DIR%"
if exist "%STAGE_DIR%" rmdir /S /Q "%STAGE_DIR%"

echo [build_backend] Running PyInstaller onedir...
"%PYINSTALLER%" --noconfirm --onedir --distpath "%DIST_DIR%" --workpath "%BUILD_DIR%" --name PackLab3DBackend --hidden-import pygltflib --add-data "%ROOT%packlab3d\backend\i18n;packlab3d\backend\i18n" "%ENTRY%"
if errorlevel 1 (
    echo [build_backend] ERROR: PyInstaller build failed.
    exit /b 1
)

echo [build_backend] Staging backend runtime for electron-builder...
if not exist "%STAGE_DIR%" mkdir "%STAGE_DIR%"
robocopy "%DIST_DIR%\PackLab3DBackend" "%STAGE_DIR%" /E /NFL /NDL /NJH /NJS
if errorlevel 8 (
    echo [build_backend] ERROR: backend staging failed.
    exit /b 1
)

echo [build_backend] Done: %STAGE_DIR%\PackLab3DBackend.exe
endlocal

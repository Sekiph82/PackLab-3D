@echo off
REM Packages the FastAPI backend (packlab3d/backend) into a standalone .exe
REM using PyInstaller, then stages it for electron-builder's extraResources.
REM Requires: packlab3d/backend/api/main.py (Stage 2) to exist.

setlocal

set ROOT=%~dp0
set BACKEND_DIR=%ROOT%packlab3d\backend
set ENTRY=%BACKEND_DIR%\api\main.py
set DIST_DIR=%BACKEND_DIR%\dist
set STAGE_DIR=%ROOT%packlab3d\frontend\resources\backend

if not exist "%ENTRY%" (
    echo [build_backend] ERROR: %ENTRY% not found.
    echo [build_backend] Backend API ^(Stage 2^) must be built before packaging.
    exit /b 1
)

where pyinstaller >nul 2>nul
if errorlevel 1 (
    echo [build_backend] ERROR: pyinstaller not found on PATH. Run: pip install pyinstaller
    exit /b 1
)

echo [build_backend] Running PyInstaller...
pyinstaller --noconfirm --onefile --distpath "%DIST_DIR%" --name PackLab3DBackend "%ENTRY%"
if errorlevel 1 (
    echo [build_backend] ERROR: PyInstaller build failed.
    exit /b 1
)

echo [build_backend] Staging backend exe for electron-builder...
if not exist "%STAGE_DIR%" mkdir "%STAGE_DIR%"
copy /Y "%DIST_DIR%\PackLab3DBackend.exe" "%STAGE_DIR%\PackLab3DBackend.exe" >nul

echo [build_backend] Done: %STAGE_DIR%\PackLab3DBackend.exe
endlocal

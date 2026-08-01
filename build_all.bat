@echo off
REM Full production build: backend (PyInstaller) -> frontend (electron-builder NSIS)
REM -> desktop shortcut. Each step requires its corresponding roadmap stage to be built:
REM   build_backend.bat  requires Stage 2 (packlab3d/backend/api/main.py)   [done]
REM   build_frontend.bat requires Stage 8 (packlab3d/frontend/electron/main.js) [not yet built]

setlocal
set ROOT=%~dp0

echo ===== PackLab 3D build: backend =====
call "%ROOT%build_backend.bat"
if errorlevel 1 (
    echo [build_all] Backend build failed. Aborting.
    exit /b 1
)

echo ===== PackLab 3D build: frontend =====
call "%ROOT%build_frontend.bat"
if errorlevel 1 (
    echo [build_all] Frontend build failed. Aborting.
    exit /b 1
)

if not exist "%ROOT%release\PackLab3D.exe" (
    echo [build_all] ERROR: %ROOT%release\PackLab3D.exe not found after build.
    exit /b 1
)

echo ===== PackLab 3D build: packaged smoke test =====
pushd "%ROOT%packlab3d\frontend"
call npm run smoke:packaged
if errorlevel 1 (
    popd
    echo [build_all] Packaged smoke test failed.
    exit /b 1
)
popd

echo ===== PackLab 3D build: desktop shortcut =====
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%create_shortcut.ps1"
if errorlevel 1 (
    echo [build_all] Shortcut creation failed.
    exit /b 1
)

echo [build_all] Done. %ROOT%release\PackLab3D.exe
endlocal

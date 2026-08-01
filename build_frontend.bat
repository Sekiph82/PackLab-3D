@echo off
REM Builds the Electron production app via electron-builder (dir target ??? no
REM installer, no self-extracting portable wrapper). Flattens the resulting
REM win-unpacked/ output directly into release/, so release\PackLab3D.exe runs
REM straight from disk with no TEMP extraction step.
REM Requires: packlab3d/frontend/electron/main.js (Stage 8) to exist.
REM Requires: packlab3d/frontend/resources/backend/PackLab3DBackend.exe to exist (run build_backend.bat first).

setlocal

set ROOT=%~dp0
set FRONTEND_DIR=%ROOT%packlab3d\frontend
set RELEASE_DIR=%ROOT%release

if not exist "%FRONTEND_DIR%\electron\main.js" (
    echo [build_frontend] ERROR: %FRONTEND_DIR%\electron\main.js not found.
    echo [build_frontend] Electron UI ^(Stage 8^) must be built before packaging.
    exit /b 1
)

for /f %%P in ('powershell -NoProfile -Command "Get-Process PackLab3D -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"') do (
    echo [build_frontend] ERROR: PackLab3D.exe is running as PID %%P. Close it before building.
    exit /b 1
)

for /f %%P in ('powershell -NoProfile -Command "Get-Process PackLab3DBackend -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"') do (
    echo [build_frontend] ERROR: PackLab3DBackend.exe is running as PID %%P. Close it before building.
    exit /b 1
)

if not exist "%FRONTEND_DIR%\resources\backend\PackLab3DBackend.exe" (
    echo [build_frontend] ERROR: backend exe not staged. Run build_backend.bat first.
    exit /b 1
)

if not exist "%FRONTEND_DIR%\build\icon.png" (
    echo [build_frontend] Copying app icon from logo pack...
    if not exist "%FRONTEND_DIR%\build" mkdir "%FRONTEND_DIR%\build"
    copy /Y "%ROOT%PackLab 3D logo pack\512x512 px.png" "%FRONTEND_DIR%\build\icon.png" >nul
)

REM Clear any previous build output so nothing stale lingers in release\.
if exist "%RELEASE_DIR%" rmdir /S /Q "%RELEASE_DIR%"
if exist "%FRONTEND_DIR%\dist" rmdir /S /Q "%FRONTEND_DIR%\dist"
if exist "%FRONTEND_DIR%\electron\renderer\dist" rmdir /S /Q "%FRONTEND_DIR%\electron\renderer\dist"

pushd "%FRONTEND_DIR%"

if not exist "%FRONTEND_DIR%\node_modules" (
    if exist "%FRONTEND_DIR%\package-lock.json" (
        echo [build_frontend] Installing dependencies with npm ci...
        call npm ci
    ) else (
        echo [build_frontend] Installing dependencies with npm install...
        call npm install
    )
    if errorlevel 1 (
        echo [build_frontend] ERROR: dependency installation failed.
        popd
        exit /b 1
    )
)

echo [build_frontend] Running frontend tests...
call npm test -- --runInBand
if errorlevel 1 (
    echo [build_frontend] ERROR: frontend tests failed.
    popd
    exit /b 1
)

echo [build_frontend] Running electron-builder (Windows/dir)...
call npm run build:win
if errorlevel 1 (
    echo [build_frontend] ERROR: electron-builder build failed.
    popd
    exit /b 1
)

popd

if not exist "%RELEASE_DIR%\win-unpacked" (
    echo [build_frontend] ERROR: expected %RELEASE_DIR%\win-unpacked not found after build.
    exit /b 1
)

echo [build_frontend] Flattening win-unpacked\ into release\...
robocopy "%RELEASE_DIR%\win-unpacked" "%RELEASE_DIR%" /E /MOVE /NFL /NDL /NJH /NJS
if errorlevel 8 (
    echo [build_frontend] ERROR: robocopy failed while flattening the build output.
    exit /b 1
)
if exist "%RELEASE_DIR%\win-unpacked" rmdir /S /Q "%RELEASE_DIR%\win-unpacked"

REM electron-builder always names the main exe after productName ("PackLab 3D.exe",
REM with a space) ??? rename to the exact path the shortcut and this script's callers expect.
if exist "%RELEASE_DIR%\PackLab 3D.exe" (
    move /Y "%RELEASE_DIR%\PackLab 3D.exe" "%RELEASE_DIR%\PackLab3D.exe" >nul
)

if not exist "%RELEASE_DIR%\PackLab3D.exe" (
    echo [build_frontend] ERROR: %RELEASE_DIR%\PackLab3D.exe not found after flattening/rename.
    exit /b 1
)

echo [build_frontend] Verifying release contents...
pushd "%FRONTEND_DIR%"
call npm run verify:release
if errorlevel 1 (
    popd
    echo [build_frontend] ERROR: release verification failed.
    exit /b 1
)
popd

echo [build_frontend] Done. Output: %RELEASE_DIR%\PackLab3D.exe
endlocal

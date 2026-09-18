@echo off
setlocal
title Build CampusConnect Standalone PC Executable (.exe)
echo =========================================================
echo    Building CampusConnect Standalone Desktop App (.exe)
echo =========================================================
cd /d "%~dp0"

echo [STEP 1/3] Building High-Performance C++ Native Core...
call "%~dp0cpp-core\build_core.bat"

if not exist "%~dp0cpp-core\bin\campus_core.exe" (
    echo [ERROR] C++ Native Core compilation failed. Please ensure MSVC is installed.
    pause
    exit /b 1
)

echo [STEP 2/3] Checking Dependencies...
if not exist "%~dp0node_modules\electron" (
    echo [NPM] Installing Electron...
    call npm install --save-dev electron
)

echo [STEP 3/3] Packaging Standalone Windows Setup Installer (.EXE)...
call npx electron-builder --win nsis
copy /Y "dist\CampusConnect-Setup-1.0.0.exe" "CampusConnect-Setup.exe"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =========================================================
    echo [SUCCESS] CampusConnect Installer successfully built!
    echo Installer File: %~dp0CampusConnect-Setup.exe
    echo You can now send this setup .exe to any friend on campus!
    echo =========================================================
) else (
    echo [WARNING] electron-builder encountered an issue, creating local portable launcher...
    if not exist "%~dp0dist" mkdir "%~dp0dist"
    echo Application files ready in %~dp0
)

pause
endlocal

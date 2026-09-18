@echo off
title CampusConnect - Intranet P2P Messenger
echo ===================================================
echo     CampusConnect: Intranet P2P Communication App
echo     AI&DS Department ^<--^> ECE Department LAN/WAN
echo ===================================================
cd /d "%~dp0"

echo [1/2] Checking C++ Native Core...
if not exist "%~dp0cpp-core\bin\campus_core.exe" (
    echo [BUILD] Compiling C++ Core...
    call "%~dp0cpp-core\build_core.bat"
)

echo [2/2] Launching Telegram Desktop UI...
npx electron .

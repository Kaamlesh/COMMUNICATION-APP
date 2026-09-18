@echo off
setlocal
echo [BUILD] Initializing MSVC Environment...
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

if not exist "%~dp0bin" mkdir "%~dp0bin"
cd /d "%~dp0"

echo [BUILD] Compiling C++ Intranet Native Core...
cl /EHsc /std:c++20 /O2 /W3 /I"%~dp0include" ^
   src\campus_engine.cpp src\main.cpp ^
   /Fe"%~dp0bin\campus_core.exe" ^
   /link ws2_32.lib crypt32.lib iphlpapi.lib advapi32.lib

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] campus_core.exe compiled successfully!
) else (
    echo [ERROR] Compilation failed with code %ERRORLEVEL%
)

echo [BUILD] Compiling C++ Intranet Shared DLL...
cl /LD /EHsc /std:c++20 /O2 /I"%~dp0include" ^
   src\campus_engine.cpp ^
   /Fe"%~dp0bin\campus_core.dll" ^
   /link ws2_32.lib crypt32.lib iphlpapi.lib advapi32.lib

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] campus_core.dll compiled successfully!
) else (
    echo [ERROR] DLL compilation failed with code %ERRORLEVEL%
)

endlocal

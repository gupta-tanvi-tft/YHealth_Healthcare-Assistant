@echo off
setlocal enabledelayedexpansion
title ESP-IDF Flash and Monitor

set PORT=%1
if "%PORT%"=="" (
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-CimInstance Win32_SerialPort | Select-Object -ExpandProperty DeviceID | Select-Object -First 1)"') do set PORT=%%i
)
if "%PORT%"=="" set PORT=COM3

echo ===================================================
echo Target Port: %PORT%
echo ===================================================

:: Only activate ESP-IDF if idf.py is not already available
where idf.py >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ESP-IDF not found in PATH. Activating v5.5.5...
    call C:\esp\v5.5.5\esp-idf\export.bat
) else (
    echo [FAST] ESP-IDF already active in this session. Skipping activation.
)

echo.
echo Flashing and opening monitor on %PORT%...
idf.py -p %PORT% flash monitor

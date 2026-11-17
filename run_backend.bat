@echo off
title YHealth Voice Assistant Backend (Port 8008)
cd /d "%~dp0backend"

echo ===================================================
echo Freeing port 8008 from any stale instances...
echo ===================================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8008" ^| findstr "LISTENING"') do (
    echo Terminating stale process %%a on port 8008...
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo ===================================================
echo Starting YHealth Voice Assistant Server on Port 8008...
echo ===================================================
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" server.py
) else (
    python server.py
)
pause


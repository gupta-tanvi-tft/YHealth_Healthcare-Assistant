@echo off
title YHealth Full System Launcher
color 0b

echo =====================================================================
echo           STARTING YHEALTH ASSISTANT & FLEET ECOSYSTEM
echo =====================================================================
echo.

echo [1/3] Starting Voice AI WebSocket Backend (Port 8008)...
start "YHealth Voice Backend :8008" cmd /k "cd /d "%~dp0speaker-backend" && if exist ".venv\Scripts\python.exe" (".venv\Scripts\python.exe" server.py) else (python server.py)"

echo [2/3] Starting Fleet Dashboard API (Port 8010)...
start "YHealth Fleet Backend :8010" cmd /k "cd /d "%~dp0web-dashboard\backend" && python app.py"

echo [3/3] Starting Frontend Dev Server (Port 5173)...
start "YHealth Frontend :5173" cmd /k "cd /d "%~dp0web-dashboard\frontend" && npm run dev"

timeout /t 3 /nobreak >nul
start http://localhost:5173

echo.
echo =====================================================================
echo  All servers launched in separate windows:
echo   - Voice AI WebSocket: ws://localhost:8008/ws
echo   - Fleet Dashboard API: http://localhost:8010
echo   - Web Interface:      http://localhost:5173
echo =====================================================================
echo.

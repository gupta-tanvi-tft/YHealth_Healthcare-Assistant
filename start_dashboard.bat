@echo off
title YHealth Fleet Management & Healthcare Assistant Dashboard
color 0b

echo =====================================================================
echo           YHEALTH HEALTHCARE ASSISTANT & FLEET DASHBOARD
echo =====================================================================
echo.
echo [1/3] Starting Fleet Backend (Port 8010) with Zero-Trust Security...
start "YHealth Fleet Backend :8010" cmd /k "cd /d "%~dp0\fleet-dashboard\backend" && python app.py"

echo [2/3] Starting Frontend Dev Server (Port 5173)...
start "YHealth Fleet Frontend :5173" cmd /k "cd /d "%~dp0\fleet-dashboard\frontend" && npm run dev"

echo [3/3] Opening Web Dashboard in Browser...
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo.
echo =====================================================================
echo   Dashboard is running!
echo   URL: http://localhost:5173
echo   Protected with Zero-Trust Authentication and Brute-Force Shield
echo =====================================================================
echo.

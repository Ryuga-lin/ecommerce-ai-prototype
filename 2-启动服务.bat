@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Step 2: Start server
echo ============================================
echo.
echo Server will run at http://localhost:3000
echo Keep this window OPEN while using the app.
echo Press Ctrl+C to stop the server.
echo.
node server.js
pause

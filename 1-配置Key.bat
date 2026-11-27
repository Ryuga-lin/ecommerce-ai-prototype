@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Step 1: Configure API Key
echo ============================================
if not exist .env.local (
  copy /Y .env.example .env.local >nul
  echo Created .env.local from template.
) else (
  echo .env.local already exists. Keeping your current settings.
)
echo.
echo Opening .env.local in Notepad...
echo.
echo Please replace: sk-...your-key-here
echo with your real DeepSeek API Key.
echo Then SAVE and CLOSE Notepad.
echo.
notepad .env.local
echo.
echo After saving, double-click 2-Start.bat to launch the app.
pause

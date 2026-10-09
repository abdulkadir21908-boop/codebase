@echo off
REM ==========================================================
REM  Apex Velocity - one click launcher
REM  Starts the local server and opens the game.
REM ==========================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required but was not found.
  echo   Install the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting Apex Velocity on http://localhost:5173 ...
echo   Keep this window open while you play. Press Ctrl+C to stop.
echo.

REM Open the browser from a detached process that waits for the port to be
REM listening, so the first page load cannot beat the server and show
REM "connection refused". serve.mjs stays in the foreground below, which keeps
REM this window open while playing and stops the server on Ctrl+C.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:5173'"
node serve.mjs

endlocal

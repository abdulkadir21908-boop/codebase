@echo off
title Aurora OS (USB)
cd /d "%~dp0AuroraOS"
where python >nul 2>nul
if errorlevel 1 (
  echo Aurora OS needs Python 3.10+ from python.org
  echo Install it, then double-click Start_Aurora again.
  pause
  exit /b 1
)
start "" /min python -c "from server import ThreadingHTTPServer, AuroraHandler; s=ThreadingHTTPServer(('127.0.0.1',8081), AuroraHandler); s.serve_forever()" 2>nul
timeout /t 3 /nobreak >nul
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" --kiosk http://localhost:8081/ --edge-kiosk-type=fullscreen
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk http://localhost:8081/ --edge-kiosk-type=fullscreen
) else (
  start "" "http://localhost:8081/"
)

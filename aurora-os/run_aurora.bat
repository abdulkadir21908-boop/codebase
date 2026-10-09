@echo off
title Aurora OS
cd /d "C:\Users\Abdul Kadir\codebase\aurora-os"
start "" /min python -c "from server import ThreadingHTTPServer, AuroraHandler; s=ThreadingHTTPServer(('127.0.0.1',8081), AuroraHandler); s.serve_forever()" 2>nul
timeout /t 2 /nobreak >nul
start "" "http://localhost:8081/"

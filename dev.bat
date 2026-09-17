@echo off
title VaultKey Dev

start "VaultKey Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && python run.py"
timeout /t 2 /nobreak >nul
start "VaultKey Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo   Backend  ^> http://localhost:8000
echo   Frontend ^> http://localhost:5173
echo.
pause >nul

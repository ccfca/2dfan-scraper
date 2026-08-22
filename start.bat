@echo off
cd /d "%~dp0"
set XDG_CONFIG_HOME=%~dp0.config
start "" "http://localhost:3456"
where node >nul 2>nul
if %errorlevel%==0 (
    node server.mjs
) else (
    echo [ERROR] Node.js not found! Please install Node.js first.
    echo Download: https://nodejs.org/
    pause
)

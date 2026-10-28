@echo off
title AMAPP - Adaptive Multi-Agent Pathfinding Simulator
cd /d "%~dp0"

echo ========================================================================
echo       AMAPP: Adaptive Multi-Agent Pathfinding & Priority
echo       Starting Django Channels Backend & Vite Frontend...
echo ========================================================================

python start.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] An error occurred while running start.py.
    echo Please make sure Python 3.11+ and Node.js are installed and in your PATH.
    pause
)


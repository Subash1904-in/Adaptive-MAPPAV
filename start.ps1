# AMAPP PowerShell Startup Script
# Starts both Django Channels backend and Vite React frontend

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "     AMAPP: Adaptive Multi-Agent Pathfinding & Priority" -ForegroundColor Cyan
Write-Host "     Starting Django Channels Backend & Vite Frontend..." -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

python start.py


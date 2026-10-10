@echo off
title SharpMD Local
cd /d "%~dp0"
where node >NUL 2>NUL
if errorlevel 1 (
  echo   Node.js 22 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
node bin\sharpmd-local.js %*
if errorlevel 1 pause

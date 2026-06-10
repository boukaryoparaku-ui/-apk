@echo off
REM ============================================================
REM  Fashion Inventory - install as Windows service (NSSM)
REM  ** Right-click and "Run as administrator" **
REM ============================================================
setlocal

set "PROJ=C:\Users\17553\Documents\dooker-copy-20260525-204407"
set "NSSM=%PROJ%\tools\nssm.exe"
set "NODE=C:\Program Files\nodejs\node.exe"
set "SVC=FashionInventory"

echo.
echo Installing service %SVC% ...
echo.

REM Remove existing service with same name (ignore errors)
"%NSSM%" stop "%SVC%" >nul 2>&1
"%NSSM%" remove "%SVC%" confirm >nul 2>&1

REM Install: node --env-file=.env dist\server\index.js
"%NSSM%" install "%SVC%" "%NODE%" "--env-file=.env dist\server\index.js"

REM Working directory (.env and SQLite path are relative to it)
"%NSSM%" set "%SVC%" AppDirectory "%PROJ%"

REM Display name / description (ASCII only to avoid codepage issues)
"%NSSM%" set "%SVC%" DisplayName "Fashion Inventory"
"%NSSM%" set "%SVC%" Description "Fashion inventory web app, SQLite, auto-start on boot"

REM Auto start on boot
"%NSSM%" set "%SVC%" Start SERVICE_AUTO_START

REM Restart on crash
"%NSSM%" set "%SVC%" AppExit Default Restart
"%NSSM%" set "%SVC%" AppRestartDelay 3000

REM Logs
if not exist "%PROJ%\logs" mkdir "%PROJ%\logs"
"%NSSM%" set "%SVC%" AppStdout "%PROJ%\logs\service.out.log"
"%NSSM%" set "%SVC%" AppStderr "%PROJ%\logs\service.err.log"
"%NSSM%" set "%SVC%" AppRotateFiles 1
"%NSSM%" set "%SVC%" AppRotateOnline 1
"%NSSM%" set "%SVC%" AppRotateBytes 10485760

echo.
echo Starting service ...
"%NSSM%" start "%SVC%"

echo.
echo ============================================================
echo  Done. Service name: %SVC%
echo  URL:    http://localhost:3000
echo  Status: sc query %SVC%
echo  Logs:   logs\service.out.log / logs\service.err.log
echo ============================================================
echo.
pause

@echo off
REM ============================================================
REM  Uninstall Fashion Inventory Windows service
REM  ** Right-click and "Run as administrator" **
REM ============================================================
setlocal
set "PROJ=C:\Users\17553\Documents\dooker-copy-20260525-204407"
set "NSSM=%PROJ%\tools\nssm.exe"
set "SVC=FashionInventory"

echo Stopping and removing service %SVC% ...
"%NSSM%" stop "%SVC%"
"%NSSM%" remove "%SVC%" confirm

echo.
echo Removed. Database file prisma\data.db is NOT affected.
echo.
pause

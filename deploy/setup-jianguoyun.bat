@echo off
chcp 65001 >nul
REM One-time setup: create a rclone remote for Jianguoyun (Nutstore) WebDAV.
REM Run this ONCE. It writes the remote into tools\rclone.conf (project-local).

cd /d "%~dp0\.."

set "RCLONE=tools\rclone.exe"
set "RCONF=tools\rclone.conf"

if not exist "%RCLONE%" (
  echo [ERROR] %RCLONE% not found.
  exit /b 1
)

echo.
echo === Configure Jianguoyun (Nutstore) WebDAV remote ===
echo Email: your Jianguoyun login email
echo Password: NOT your login password. Generate an app password at:
echo   Jianguoyun web - account info - security - add application password
echo.

set /p JGY_USER=Jianguoyun email:
set /p JGY_PASS=Jianguoyun app password:

"%RCLONE%" --config "%RCONF%" config create jianguoyun webdav ^
  url=https://dav.jianguoyun.com/dav/ ^
  vendor=other ^
  user="%JGY_USER%" ^
  pass="%JGY_PASS%"

echo.
echo === Test connection (should list your Jianguoyun top-level folders) ===
"%RCLONE%" --config "%RCONF%" lsd jianguoyun:

echo.
echo If you see folders above, the remote works.
echo Next: create a backup folder, e.g.
echo   "%RCLONE%" --config "%RCONF%" mkdir jianguoyun:fashion-backup
echo Then enable the upload line in deploy\backup.bat.

@echo off
chcp 65001 >nul
REM Auto DB backup - entry for Windows Task Scheduler
REM Point a scheduled task action at this .bat. See deploy\BACKUP_WINDOWS.md

cd /d "%~dp0\.."

REM ===== backup params (edit as needed) =====
set "DB_FILE=./prisma/data.db"
set "BACKUP_DIR=./backups"
set "KEEP_DAYS=14"

REM ===== upload: pick one, leave the other empty =====
REM Route A (sync folder): write into a cloud client's local sync folder (OneDrive etc.)
REM set "BACKUP_SYNC_DIR=C:\Users\17553\OneDrive\fashion-backup"

REM Route B (rclone): Jianguoyun WebDAV / S3 / OSS etc.
REM Run deploy\setup-jianguoyun.bat ONCE first, then uncomment the next 3 lines.
set "RCLONE_BIN=%~dp0\..\tools\rclone.exe"
set "RCLONE_CONFIG=%~dp0\..\tools\rclone.conf"
set "RCLONE_REMOTE=jianguoyun:fashion-backup"

if not exist logs mkdir logs
node scripts\backup-db.mjs >> logs\backup.log 2>&1
echo [%date% %time%] backup.bat exit=%errorlevel% >> logs\backup.log

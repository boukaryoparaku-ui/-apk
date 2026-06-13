@echo off
echo 正在重启应用...

echo 停止现有进程...
taskkill /F /IM node.exe 2>/dev/null
timeout /t 2 /nobreak >/dev/null

echo 重新构建项目...
call npm run build

echo 启动应用...
start npm start

echo 应用已启动！

#!/bin/bash

echo "正在重启应用..."

# 查找并停止正在运行的进程
echo "停止现有进程..."
pkill -f "node.*dist/server/index.js" || true
pkill -f "tsx.*server/index.ts" || true
sleep 2

# 重新构建
echo "重新构建项目..."
npm run build

# 启动应用
echo "启动应用..."
npm start

#!/bin/sh
set -e

# 确保 SQLite 数据文件目录和 session 目录存在（挂载卷首次为空）
mkdir -p /data/sessions

# 按 schema 同步 SQLite 表结构（首次会创建 data.db）
npx prisma db push --skip-generate

node dist/server/index.js

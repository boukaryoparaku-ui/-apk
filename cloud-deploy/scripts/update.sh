#!/bin/bash
# Git update script - pull latest code, rebuild image, restart service.
#
# Usage:
#   bash cloud-deploy/scripts/update.sh
# Optional:
#   PROJECT_DIR=/opt/fashion-inventory BRANCH=main bash cloud-deploy/scripts/update.sh

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/fashion-inventory}"
BRANCH="${BRANCH:-main}"
DEPLOY_DIR="$PROJECT_DIR/cloud-deploy"
ENV_FILE="$PROJECT_DIR/.env"
HOST_PORT="3001"
if [ -f "$ENV_FILE" ]; then
    ENV_HOST_PORT="$(grep -E '^HOST_PORT=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$ENV_HOST_PORT" ]; then
        HOST_PORT="$ENV_HOST_PORT"
    fi
fi

echo "=========================================="
echo "  更新服装供销存系统"
echo "=========================================="
echo ""

cd "$PROJECT_DIR"

# 检查是否为 git 仓库
if [ -d ".git" ]; then
    echo "📥 拉取最新代码..."
    if [ -n "$(git status --porcelain)" ]; then
        echo "❌ 服务器工作区有未提交改动，为避免覆盖，已停止更新："
        git status --short
        echo ""
        echo "如这些改动不需要保留，请先处理后再运行本脚本。"
        exit 1
    fi
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git pull --ff-only origin "$BRANCH"
    echo "✅ 代码更新完成"
else
    echo "❌ 当前不是 git 仓库。请先用 bootstrap-git.sh 首次部署。"
    exit 1
fi

echo ""
echo "🔨 重新构建并启动服务..."
docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE" up -d --build

echo ""
echo "⏳ 等待服务启动..."
sleep 10

# 健康检查
echo "🔍 健康检查..."
if curl -sf "http://127.0.0.1:${HOST_PORT}/api/healthz" >/dev/null; then
    echo "✅ 服务更新成功，运行正常"
else
    echo "❌ 健康检查失败"
    echo ""
    echo "查看日志："
    docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE" logs --tail=50
    exit 1
fi

echo ""
echo "=========================================="
echo "  ✅ 更新完成"
echo "=========================================="
echo ""
echo "查看完整日志: docker compose -f $DEPLOY_DIR/docker-compose.prod.yml --env-file $ENV_FILE logs -f"
echo ""

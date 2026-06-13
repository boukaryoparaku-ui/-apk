#!/bin/bash
# 一键部署脚本 - Docker Compose 方式
#
# 用法: sudo bash deploy.sh

set -e

echo "=========================================="
echo "  服装供销存系统 - 一键部署脚本"
echo "=========================================="
echo ""

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then
    echo "❌ 请使用 root 权限运行此脚本"
    echo "   sudo bash deploy.sh"
    exit 1
fi

# 检查 Docker
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ Docker 未安装"
    echo ""
    echo "是否现在安装 Docker？[y/N]"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "📦 安装 Docker..."
        curl -fsSL https://get.docker.com | sh
        usermod -aG docker $SUDO_USER
        echo "✅ Docker 安装完成"
        echo "⚠️  请退出并重新登录以使 Docker 组权限生效"
        echo "   然后再次运行本脚本"
        exit 0
    else
        echo "部署中止"
        exit 1
    fi
fi

# 检查 docker compose
if ! docker compose version >/dev/null 2>&1; then
    echo "❌ Docker Compose 未安装"
    exit 1
fi

echo "✅ Docker 已安装"
echo ""

# 设置项目目录
PROJECT_DIR="/opt/fashion-inventory"
DEPLOY_DIR="$PROJECT_DIR/cloud-deploy"

# 检查当前目录
if [ ! -f "cloud-deploy/README.md" ]; then
    echo "❌ 请在项目根目录运行此脚本"
    exit 1
fi

# 创建项目目录
echo "📁 创建项目目录: $PROJECT_DIR"
mkdir -p "$PROJECT_DIR"

# 复制文件
echo "📋 复制项目文件..."
rsync -av --exclude 'node_modules' --exclude '.git' --exclude 'dist' ./ "$PROJECT_DIR/"
echo "✅ 文件复制完成"
echo ""

# 配置环境变量
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "🔐 配置环境变量..."
    cp "$PROJECT_DIR/cloud-deploy/.env.production.example" "$ENV_FILE"

    # 生成随机密钥
    SESSION_SECRET=$(openssl rand -hex 32)
    AI_CONFIG_SECRET=$(openssl rand -hex 32)

    # 替换密钥
    sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" "$ENV_FILE"
    sed -i "s/AI_CONFIG_SECRET=.*/AI_CONFIG_SECRET=$AI_CONFIG_SECRET/" "$ENV_FILE"

    echo "✅ 已生成随机密钥"
    echo ""
    echo "⚠️  重要：请立即修改管理员密码！"
    echo "   编辑文件: $ENV_FILE"
    echo "   修改 ADMIN_PASSWORD 行"
    echo ""
    echo "按 Enter 键继续，或 Ctrl+C 取消..."
    read -r
else
    echo "✅ 环境变量文件已存在: $ENV_FILE"
fi

# 启动服务
echo "🚀 启动服务..."
cd "$PROJECT_DIR"
docker compose -f cloud-deploy/docker-compose.prod.yml up -d --build

echo ""
echo "⏳ 等待服务启动..."
sleep 10

# 健康检查
echo "🔍 健康检查..."
if curl -sf http://127.0.0.1:3001/api/healthz >/dev/null; then
    echo "✅ 服务运行正常"
else
    echo "⚠️  健康检查失败，请查看日志："
    echo "   docker compose -f $DEPLOY_DIR/docker-compose.prod.yml logs"
fi

# 显示访问信息
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "访问地址: http://$SERVER_IP:3001"
echo "管理账号: admin"
echo "管理密码: 在 $ENV_FILE 中查看"
echo ""
echo "常用命令："
echo "  查看日志: docker compose -f $DEPLOY_DIR/docker-compose.prod.yml logs -f"
echo "  重启服务: docker compose -f $DEPLOY_DIR/docker-compose.prod.yml restart"
echo "  停止服务: docker compose -f $DEPLOY_DIR/docker-compose.prod.yml down"
echo ""
echo "⚠️  安全提示："
echo "  1. 立即修改 .env 中的 ADMIN_PASSWORD"
echo "  2. 建议配置 HTTPS（见 $DEPLOY_DIR/README.md）"
echo "  3. 设置自动备份（见 $DEPLOY_DIR/README.md）"
echo ""

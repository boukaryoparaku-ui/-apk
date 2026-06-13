# Cloud Deploy - 云服务器部署方案包

本目录包含将服装供销存系统部署到云服务器的完整方案。

## 快速开始

```bash
# 1. 进入部署目录
cd cloud-deploy

# 2. 阅读快速开始指南
cat 开始部署.md

# 3. 或直接阅读主文档
cat README.md
```

## 目录结构

```
cloud-deploy/
├── 开始部署.md              ⭐ 从这里开始 - 快速导航
├── README.md                 📖 主文档 - 完整部署方案
├── 文件清单.md               📋 所有文件说明
│
├── docker-compose.prod.yml   🐳 Docker 生产配置
├── Dockerfile                🐳 镜像构建文件
├── docker-entrypoint.sh      🐳 容器启动脚本
├── .env.production.example   🔐 环境变量模板
│
├── nginx.conf                🌐 Nginx 反向代理配置
├── caddy.conf                🌐 Caddy 反向代理配置
│
├── scripts/                  🛠️ 维护脚本
│   ├── backup.sh            💾 数据库备份
│   ├── deploy.sh            🚀 一键部署
│   └── update.sh            🔄 更新脚本
│
├── systemd/                  🖥️ 裸机部署
│   ├── fashion-inventory.service
│   ├── backup.sh
│   └── deploy-systemd.md
│
└── docs/                     📚 详细文档
    ├── 快速开始.md           ⚡ 5分钟部署指南
    ├── Docker部署.md         🐳 Docker 详细文档
    └── 安全加固.md           🔒 安全配置指南
```

## 两种部署方式

### 🐳 Docker 部署（推荐）
- 适合大多数场景
- 环境隔离、易于迁移
- 需要 1GB+ 内存

### 🖥️ systemd 裸机部署
- 适合小内存服务器（512MB）
- 资源占用低
- 配置相对复杂

## 使用流程

1. **选择方案** → 阅读 `开始部署.md`
2. **快速部署** → 阅读 `docs/快速开始.md`（5分钟）
3. **详细了解** → 阅读 `README.md` 或 `docs/Docker部署.md`
4. **安全加固** → 阅读 `docs/安全加固.md`（必读）

## 文档亮点

- ✅ 完整的部署步骤说明
- ✅ Docker 和 systemd 两种方案
- ✅ 自动备份脚本
- ✅ HTTPS 配置示例（Nginx/Caddy）
- ✅ 详细的故障排查指南
- ✅ 安全加固检查清单
- ✅ 一键部署和更新脚本

## 核心特性

- 📦 开箱即用的生产配置
- 🔐 安全密钥自动生成
- 💾 数据持久化和备份
- 🔄 服务自动重启
- 📊 健康检查
- 🔒 安全加固建议

## 最小服务器要求

- **CPU**: 1核
- **内存**: 1GB（推荐）或 512MB（systemd）
- **磁盘**: 20GB
- **系统**: Ubuntu 22.04 / Debian 12

## 支持的功能

- ✅ SQLite 数据库（无需额外安装）
- ✅ 自动数据库初始化
- ✅ 会话持久化
- ✅ 健康检查端点
- ✅ 日志轮转
- ✅ 资源限制
- ✅ 自动重启

## 快速命令参考

```bash
# Docker 部署
docker compose -f cloud-deploy/docker-compose.prod.yml up -d --build
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f
docker compose -f cloud-deploy/docker-compose.prod.yml restart

# systemd 部署
sudo systemctl start fashion-inventory
journalctl -u fashion-inventory -f
sudo systemctl restart fashion-inventory

# 备份
bash cloud-deploy/scripts/backup.sh docker    # Docker
bash cloud-deploy/scripts/backup.sh systemd   # systemd
```

## 获取帮助

- 📖 部署问题 → `README.md`
- 🐳 Docker 问题 → `docs/Docker部署.md`
- 🔒 安全问题 → `docs/安全加固.md`
- 📁 文件说明 → `文件清单.md`

## 贡献

欢迎提交问题和改进建议！

---

**开始部署**: 阅读 [开始部署.md](开始部署.md) 或 [docs/快速开始.md](docs/快速开始.md)

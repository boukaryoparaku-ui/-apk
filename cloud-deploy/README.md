# 云服务器部署方案

本目录包含将服装供销存系统部署到云服务器的完整方案和所需文件。

## 📦 目录结构

```
cloud-deploy/
├── README.md                    # 本文档 - 部署指南
├── docker-compose.prod.yml      # Docker Compose 生产配置
├── Dockerfile                   # Docker 镜像构建文件
├── docker-entrypoint.sh         # 容器启动脚本
├── .env.production.example      # 生产环境变量模板
├── nginx.conf                   # Nginx 反向代理配置示例
├── caddy.conf                   # Caddy 反向代理配置示例
├── systemd/                     # systemd 裸机部署方案
│   ├── fashion-inventory.service
│   └── deploy-systemd.md
├── scripts/                     # 维护脚本
│   ├── backup.sh               # 数据库备份脚本
│   ├── deploy.sh               # 一键部署脚本
│   └── update.sh               # 更新脚本
└── docs/                        # 详细文档
    ├── 快速开始.md
    ├── Docker部署.md
    ├── 裸机部署.md
    └── 安全加固.md
```

## 🚀 快速开始

### 方案选择

**推荐：Docker Compose 部署**
- ✅ 环境隔离，迁移简单
- ✅ 数据自动持久化
- ✅ 适合大多数云服务器（1核1G起）

**备选：systemd 裸机部署**
- ✅ 资源占用更低
- ⚠️ 需要手动安装 Node.js
- ⚠️ 配置相对复杂

### 最小服务器要求

- **CPU**: 1核 (推荐2核)
- **内存**: 1GB (推荐2GB)
- **磁盘**: 20GB
- **系统**: Ubuntu 22.04/24.04 或 Debian 12
- **网络**: 公网IP或域名（可选）

## 📋 部署前准备

### 1. 上传部署包

将整个 `cloud-deploy` 目录上传到服务器：

```bash
# 方法1: 使用 scp
scp -r cloud-deploy/ user@your-server:/tmp/

# 方法2: 使用 rsync
rsync -avz cloud-deploy/ user@your-server:/tmp/cloud-deploy/

# 方法3: 在服务器上用 git
ssh user@your-server
cd /opt
sudo git clone https://github.com/your-repo/project.git fashion-inventory
```

### 2. 生成安全密钥

在服务器上生成随机密钥：

```bash
# 生成 SESSION_SECRET
openssl rand -hex 32

# 生成 AI_CONFIG_SECRET
openssl rand -hex 32
```

记下这两个密钥，稍后配置环境变量时使用。

## 🐳 Docker Compose 部署（推荐）

### 第一步：安装 Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

退出并重新登录使权限生效。

### 第二步：准备项目

```bash
# 创建项目目录
sudo mkdir -p /opt/fashion-inventory
sudo chown -R $USER:$USER /opt/fashion-inventory

# 上传完整项目代码到此目录
cd /opt/fashion-inventory
```

### 第三步：配置环境变量

```bash
# 复制环境变量模板
cp cloud-deploy/.env.production.example .env

# 编辑配置（修改密钥和密码）
nano .env
```

**必须修改的配置项**：
- `SESSION_SECRET`: 改成第一个随机密钥
- `AI_CONFIG_SECRET`: 改成第二个随机密钥
- `ADMIN_PASSWORD`: 改成强密码

### 第四步：启动服务

```bash
# 使用部署包中的配置启动
docker compose -f cloud-deploy/docker-compose.prod.yml up -d --build

# 查看日志
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f
```

### 第五步：验证部署

```bash
# 健康检查
curl http://127.0.0.1:3001/api/healthz

# 应该返回：{"ok":true,"db":"up"}
```

访问: `http://服务器IP:3001`

### 常用维护命令

```bash
# 查看状态
docker compose -f cloud-deploy/docker-compose.prod.yml ps

# 重启服务
docker compose -f cloud-deploy/docker-compose.prod.yml restart

# 停止服务
docker compose -f cloud-deploy/docker-compose.prod.yml down

# 更新代码后重新构建
git pull
docker compose -f cloud-deploy/docker-compose.prod.yml up -d --build
```

## 🖥️ systemd 裸机部署

适合内存极小的服务器或不想使用 Docker 的场景。

详细步骤请查看: [systemd/deploy-systemd.md](systemd/deploy-systemd.md)

## 🔒 配置 HTTPS（推荐）

### 使用 Caddy（最简单）

```bash
# 安装 Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# 使用部署包中的配置
sudo cp cloud-deploy/caddy.conf /etc/caddy/Caddyfile

# 修改域名
sudo nano /etc/caddy/Caddyfile
# 将 your-domain.com 改成你的域名

# 重启 Caddy
sudo systemctl reload caddy
```

Caddy 会自动申请和续期 Let's Encrypt 证书。

### 使用 Nginx

```bash
# 安装 Nginx 和 Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# 使用部署包中的配置
sudo cp cloud-deploy/nginx.conf /etc/nginx/sites-available/fashion-inventory
sudo ln -s /etc/nginx/sites-available/fashion-inventory /etc/nginx/sites-enabled/

# 修改域名
sudo nano /etc/nginx/sites-available/fashion-inventory
# 将 your-domain.com 改成你的域名

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx

# 申请 SSL 证书
sudo certbot --nginx -d your-domain.com
```

## 💾 数据备份

### Docker 部署的备份

```bash
# 手动备份
bash cloud-deploy/scripts/backup.sh docker

# 设置自动备份（每天凌晨2点）
crontab -e
# 添加这一行：
0 2 * * * /opt/fashion-inventory/cloud-deploy/scripts/backup.sh docker >> /var/log/fashion-backup.log 2>&1
```

### systemd 部署的备份

```bash
# 手动备份
bash cloud-deploy/scripts/backup.sh systemd

# 设置自动备份
crontab -e
# 添加这一行：
0 2 * * * /opt/fashion-inventory/cloud-deploy/scripts/backup.sh systemd >> /var/log/fashion-backup.log 2>&1
```

**重要**: 务必将备份同步到服务器外的位置（对象存储/NAS/网盘）。

## 🔧 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f

# 检查配置
docker compose -f cloud-deploy/docker-compose.prod.yml config
```

### 数据库连接失败

```bash
# 进入容器检查
docker compose -f cloud-deploy/docker-compose.prod.yml exec app sh
ls -la /data/
cat /data/data.db
```

### 端口被占用

```bash
# 查看 3001 端口占用情况
sudo netstat -tulpn | grep 3001

# 或修改 docker-compose.prod.yml 中的端口映射
```

### 内存不足

```bash
# 查看容器资源占用
docker stats

# 如需限制内存，在 docker-compose.prod.yml 中添加：
# services:
#   app:
#     deploy:
#       resources:
#         limits:
#           memory: 512M
```

## 📊 监控和日志

### 查看应用日志

```bash
# Docker
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f app

# systemd
journalctl -u fashion-inventory -f
```

### 健康检查

```bash
# 添加到监控系统
curl -f http://127.0.0.1:3001/api/healthz || exit 1
```

## 🔐 安全检查清单

部署完成后，请确认以下安全措施：

- [ ] `SESSION_SECRET` 已改为随机长字符串
- [ ] `AI_CONFIG_SECRET` 已改为随机长字符串
- [ ] `ADMIN_PASSWORD` 已改为强密码
- [ ] 已配置 HTTPS（公网访问时必需）
- [ ] 已配置防火墙，只开放必要端口
- [ ] 已设置自动备份
- [ ] 备份已同步到服务器外
- [ ] 已测试数据恢复流程
- [ ] 服务器已启用自动安全更新

## 📚 更多文档

- [Docker 部署详细说明](docs/Docker部署.md)
- [systemd 裸机部署详细说明](docs/裸机部署.md)
- [安全加固指南](docs/安全加固.md)
- [性能优化建议](docs/性能优化.md)

## 🆘 获取帮助

如遇问题，请检查：
1. 服务器系统日志
2. 应用日志（见上方"监控和日志"章节）
3. 数据库文件是否存在且有写权限
4. 环境变量是否正确配置

## 📝 版本记录

- 2026-06-13: 创建初始部署方案包

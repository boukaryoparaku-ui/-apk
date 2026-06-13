# Docker 部署详细说明

本文档详细介绍如何使用 Docker Compose 将系统部署到云服务器。

## 目录

- [为什么选择 Docker](#为什么选择-docker)
- [服务器要求](#服务器要求)
- [详细部署步骤](#详细部署步骤)
- [配置说明](#配置说明)
- [数据持久化](#数据持久化)
- [日常维护](#日常维护)
- [故障排查](#故障排查)

## 为什么选择 Docker

✅ **优势**：
- 环境一致性：开发、测试、生产完全一致
- 快速部署：一条命令启动所有服务
- 易于迁移：打包整个应用环境
- 资源隔离：不影响宿主机其他服务
- 自动重启：服务异常自动恢复

⚠️ **注意**：
- 需要额外的内存开销（约50-100MB）
- 需要安装 Docker 环境

## 服务器要求

### 最低配置
- **CPU**: 1核
- **内存**: 1GB
- **磁盘**: 20GB
- **系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+

### 推荐配置
- **CPU**: 2核
- **内存**: 2GB
- **磁盘**: 40GB
- **系统**: Ubuntu 22.04 LTS

### 网络要求
- 开放端口 3001（应用访问）
- 开放端口 80/443（HTTPS，可选）
- 能够访问 Docker Hub（或配置国内镜像）

## 详细部署步骤

### 第一步：安装 Docker

#### Ubuntu/Debian

```bash
# 更新包索引
sudo apt update

# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 将当前用户加入 docker 组
sudo usermod -aG docker $USER

# 验证安装
docker --version
docker compose version
```

**重要**：执行 `usermod` 后需要退出并重新登录才能生效。

#### CentOS/RHEL

```bash
# 安装 Docker
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker

# 加入用户组
sudo usermod -aG docker $USER
```

#### 配置国内镜像加速（可选）

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://registry.docker-cn.com"
  ]
}
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
```

### 第二步：上传项目文件

#### 方法1：使用 Git（推荐）

```bash
# 在服务器上
cd /opt
sudo git clone https://github.com/your-repo/project.git fashion-inventory
sudo chown -R $USER:$USER fashion-inventory
cd fashion-inventory
```

#### 方法2：使用 scp

```bash
# 在本地机器上
cd /path/to/project
scp -r . user@your-server:/tmp/fashion-inventory

# 在服务器上
sudo mv /tmp/fashion-inventory /opt/
sudo chown -R $USER:$USER /opt/fashion-inventory
```

#### 方法3：使用 rsync

```bash
# 在本地机器上
rsync -avz --exclude 'node_modules' --exclude '.git' \
  . user@your-server:/opt/fashion-inventory/
```

### 第三步：配置环境变量

```bash
cd /opt/fashion-inventory

# 复制环境变量模板
cp cloud-deploy/.env.production.example .env

# 生成随机密钥
openssl rand -hex 32  # 第一个密钥
openssl rand -hex 32  # 第二个密钥

# 编辑配置文件
nano .env
```

**必须修改的配置**：

```env
# 用第一个生成的密钥替换
SESSION_SECRET=你生成的第一个随机密钥

# 用第二个生成的密钥替换
AI_CONFIG_SECRET=你生成的第二个随机密钥

# 修改为强密码
ADMIN_PASSWORD=你的强密码
```

**可选配置**：

```env
# 修改时区
TZ=Asia/Shanghai

# 修改端口（如果 3001 被占用）
HOST_PORT=3001

# 管理员用户名（默认 admin）
ADMIN_USERNAME=admin
```

### 第四步：启动服务

```bash
cd /opt/fashion-inventory

# 构建并启动服务
docker compose -f cloud-deploy/docker-compose.prod.yml up -d --build

# 查看启动日志
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f
```

看到类似输出表示成功：

```
fashion-inventory  | Server running on http://0.0.0.0:3000
fashion-inventory  | Database connected
```

按 `Ctrl+C` 退出日志查看（服务继续运行）。

### 第五步：验证部署

```bash
# 健康检查
curl http://127.0.0.1:3001/api/healthz

# 应该返回：
# {"ok":true,"db":"up"}
```

浏览器访问：`http://服务器IP:3001`

使用 `admin` 和你设置的密码登录。

## 配置说明

### docker-compose.prod.yml 详解

```yaml
services:
  app:
    build:
      context: ..                           # 构建上下文：项目根目录
      dockerfile: cloud-deploy/Dockerfile   # Dockerfile 位置

    environment:
      DATABASE_URL: file:/data/data.db      # 数据库文件路径
      SESSION_SECRET: ${SESSION_SECRET}     # 从 .env 读取
      # ... 其他环境变量

    ports:
      - "3001:3000"        # 宿主机3001 -> 容器3000

    volumes:
      - app_data:/data     # 持久化卷

    restart: unless-stopped  # 异常自动重启

    healthcheck:           # 健康检查
      test: ["CMD", "wget", "--spider", "http://localhost:3000/api/healthz"]
      interval: 30s        # 每30秒检查一次

    deploy:
      resources:
        limits:
          memory: 512M     # 内存限制
```

### 修改端口

编辑 `.env` 文件：

```env
# 改成其他端口
HOST_PORT=8080
```

重启服务：

```bash
docker compose -f cloud-deploy/docker-compose.prod.yml up -d
```

### 修改内存限制

编辑 `cloud-deploy/docker-compose.prod.yml`：

```yaml
deploy:
  resources:
    limits:
      memory: 1G      # 改成 1GB
    reservations:
      memory: 512M    # 保留内存
```

## 数据持久化

### 数据存储位置

所有数据（数据库、会话）存储在 Docker volume `app_data` 中。

查看 volume：

```bash
docker volume ls
docker volume inspect fashion-inventory_app_data
```

### 数据位置

实际数据存储在宿主机的：

```
/var/lib/docker/volumes/fashion-inventory_app_data/_data/
```

**不要直接修改此目录**，使用 Docker 命令操作。

### 查看数据

```bash
# 列出数据文件
docker run --rm -v fashion-inventory_app_data:/data alpine ls -lh /data/

# 输出：
# drwxr-xr-x    2 node     node        4.0K Jun 13 10:00 sessions
# -rw-r--r--    1 node     node      122.0K Jun 13 10:30 data.db
```

## 日常维护

### 查看服务状态

```bash
# 查看容器状态
docker compose -f cloud-deploy/docker-compose.prod.yml ps

# 查看资源占用
docker stats fashion-inventory

# 查看日志（最近100行）
docker compose -f cloud-deploy/docker-compose.prod.yml logs --tail=100

# 实时查看日志
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f
```

### 重启服务

```bash
cd /opt/fashion-inventory

# 重启
docker compose -f cloud-deploy/docker-compose.prod.yml restart

# 停止
docker compose -f cloud-deploy/docker-compose.prod.yml stop

# 启动
docker compose -f cloud-deploy/docker-compose.prod.yml start
```

### 更新代码

```bash
cd /opt/fashion-inventory

# 拉取最新代码
git pull

# 重新构建并启动
docker compose -f cloud-deploy/docker-compose.prod.yml up -d --build

# 查看日志确认
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f
```

或使用更新脚本：

```bash
bash cloud-deploy/scripts/update.sh
```

### 备份数据

```bash
# 手动备份
bash cloud-deploy/scripts/backup.sh docker

# 设置定时备份（每天凌晨2点）
crontab -e
# 添加：
0 2 * * * /opt/fashion-inventory/cloud-deploy/scripts/backup.sh docker >> /var/log/fashion-backup.log 2>&1
```

备份文件位置：`/opt/fashion-inventory/backups/`

### 恢复数据

```bash
# 停止服务
docker compose -f cloud-deploy/docker-compose.prod.yml down

# 解压备份
gunzip /opt/fashion-inventory/backups/data-YYYY-MM-DD_HHMM.db.gz

# 恢复到 volume
docker run --rm \
  -v fashion-inventory_app_data:/data \
  -v /opt/fashion-inventory/backups:/backup \
  alpine sh -c "cp /backup/data-YYYY-MM-DD_HHMM.db /data/data.db"

# 重新启动
docker compose -f cloud-deploy/docker-compose.prod.yml up -d
```

### 清理旧镜像

```bash
# 清理未使用的镜像
docker image prune -a

# 清理所有未使用的资源
docker system prune -a
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker compose -f cloud-deploy/docker-compose.prod.yml logs -f

# 查看容器状态
docker compose -f cloud-deploy/docker-compose.prod.yml ps -a

# 检查配置文件
docker compose -f cloud-deploy/docker-compose.prod.yml config
```

### 端口冲突

```bash
# 查看端口占用
sudo netstat -tulpn | grep 3001

# 解决方法1：修改端口
# 编辑 .env，改 HOST_PORT=3002

# 解决方法2：停止占用进程
sudo kill <PID>
```

### 内存不足

```bash
# 查看内存使用
docker stats

# 降低内存限制
# 编辑 docker-compose.prod.yml
#   memory: 512M  -> 384M
```

### 数据库文件损坏

```bash
# 使用备份恢复（见上方"恢复数据"）

# 或者重新初始化（会丢失所有数据）
docker compose -f cloud-deploy/docker-compose.prod.yml down -v
docker compose -f cloud-deploy/docker-compose.prod.yml up -d
```

### 无法访问服务

```bash
# 检查容器是否运行
docker ps | grep fashion-inventory

# 检查健康状态
docker inspect fashion-inventory | grep -A 5 Health

# 检查防火墙
sudo ufw status
sudo ufw allow 3001

# 检查网络连通性
curl http://127.0.0.1:3001/api/healthz
```

### 构建失败

```bash
# 清理构建缓存
docker builder prune

# 强制重新构建
docker compose -f cloud-deploy/docker-compose.prod.yml build --no-cache

# 检查 npm 镜像
# 编辑 cloud-deploy/Dockerfile
# 取消注释 npm 镜像配置
```

## 性能优化

### 调整资源限制

根据实际使用情况调整：

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'      # CPU 限制
      memory: 1G       # 内存限制
    reservations:
      cpus: '0.5'      # CPU 预留
      memory: 512M     # 内存预留
```

### 日志轮转

已默认配置：

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"    # 单文件最大 10MB
    max-file: "3"      # 保留 3 个文件
```

### 使用多阶段构建

`Dockerfile` 已使用多阶段构建，最终镜像大小约 150MB。

## 安全建议

1. **修改默认密码**：部署后立即修改 `ADMIN_PASSWORD`
2. **配置 HTTPS**：使用 Caddy 或 Nginx 反向代理（见主文档）
3. **限制端口访问**：仅开放必要端口，使用防火墙
4. **定期备份**：每天自动备份并同步到远程
5. **定期更新**：及时拉取安全更新
6. **监控日志**：定期检查异常访问

## 下一步

- [配置 HTTPS](../README.md#配置-https推荐)
- [设置自动备份](../README.md#数据备份)
- [性能优化](性能优化.md)
- [安全加固](安全加固.md)

# systemd 裸机部署详细说明

本文档详细介绍如何在不使用 Docker 的情况下直接部署到云服务器。

## 适用场景

- 内存非常小的服务器（512MB）
- 不想安装 Docker
- 需要直接控制所有进程
- 对容器化不熟悉

## 服务器要求

### 最低配置
- **CPU**: 1核
- **内存**: 512MB
- **磁盘**: 10GB
- **系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+

### 推荐配置
- **CPU**: 1核
- **内存**: 1GB
- **磁盘**: 20GB

## 详细部署步骤

### 第一步：安装 Node.js

#### Ubuntu/Debian

```bash
# 使用 NodeSource 仓库安装 Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v  # 应该显示 v24.x.x
npm -v
```

#### CentOS/RHEL

```bash
# 安装 Node.js 24
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo yum install -y nodejs

# 验证
node -v
npm -v
```

### 第二步：上传项目文件

```bash
# 创建项目目录
sudo mkdir -p /opt/fashion-inventory
sudo chown -R $USER:$USER /opt/fashion-inventory

# 方法1: Git（推荐）
cd /opt/fashion-inventory
git clone https://github.com/your-repo/project.git .

# 方法2: scp 上传
# 在本地执行：
# scp -r . user@server:/opt/fashion-inventory/
```

### 第三步：安装依赖

```bash
cd /opt/fashion-inventory

# 安装生产依赖
npm ci --omit=dev

# 如果网络慢，可以使用国内镜像
npm config set registry https://registry.npmmirror.com
npm ci --omit=dev
```

### 第四步：配置环境变量

```bash
cd /opt/fashion-inventory

# 复制环境变量模板
cp .env.example .env

# 生成随机密钥
openssl rand -hex 32  # 用于 SESSION_SECRET
openssl rand -hex 32  # 用于 AI_CONFIG_SECRET

# 编辑配置
nano .env
```

配置内容：

```env
NODE_ENV=production
PORT=3000
TZ=Asia/Shanghai

# SQLite 数据库路径（相对于 prisma/ 目录）
DATABASE_URL=file:./data.db

# 会话存储目录
SESSION_STORE_DIR=./sessions

# 随机密钥（用上面生成的）
SESSION_SECRET=你的第一个随机密钥
AI_CONFIG_SECRET=你的第二个随机密钥

# 管理员账号
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码
```

### 第五步：初始化和构建

```bash
cd /opt/fashion-inventory

# 一键初始化（生成 Prisma 客户端、创建数据库、构建前端）
npm run prod:init
```

这个命令会执行：
1. `prisma generate` - 生成数据库客户端
2. `prisma db push` - 创建数据库表
3. `npm run build` - 构建前端资源

### 第六步：测试启动

```bash
# 前台启动测试
npm run prod:start

# 看到类似输出表示成功：
# Server running on http://0.0.0.0:3000
# Database connected
```

按 `Ctrl+C` 停止，继续配置 systemd。

### 第七步：配置 systemd 服务

#### 创建专用用户

```bash
# 创建系统用户（无登录权限）
sudo useradd --system --no-create-home --shell /usr/sbin/nologin fashion

# 修改项目目录权限
sudo chown -R fashion:fashion /opt/fashion-inventory
```

#### 确认 Node 路径

```bash
which node
# 通常是 /usr/bin/node
# 如果不同，记下路径，稍后需要修改服务文件
```

#### 复制并配置服务文件

```bash
# 复制服务文件
sudo cp /opt/fashion-inventory/cloud-deploy/systemd/fashion-inventory.service /etc/systemd/system/

# 如果 node 不在 /usr/bin/node，编辑服务文件
sudo nano /etc/systemd/system/fashion-inventory.service
# 修改 ExecStart 行的路径
```

服务文件内容：

```ini
[Unit]
Description=Fashion Inventory (服装供销存系统)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/fashion-inventory
EnvironmentFile=/opt/fashion-inventory/.env
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=3

User=fashion
Group=fashion

# 内存限制（小服务器可以降低）
MemoryMax=512M

# 安全加固
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

#### 启动服务

```bash
# 重载 systemd 配置
sudo systemctl daemon-reload

# 设置开机自启
sudo systemctl enable fashion-inventory

# 启动服务
sudo systemctl start fashion-inventory

# 查看状态
sudo systemctl status fashion-inventory
```

#### 查看日志

```bash
# 实时日志
journalctl -u fashion-inventory -f

# 最近100行
journalctl -u fashion-inventory -n 100

# 今天的日志
journalctl -u fashion-inventory --since today
```

### 第八步：验证部署

```bash
# 健康检查
curl http://127.0.0.1:3000/api/healthz

# 应该返回：
# {"ok":true,"db":"up"}
```

浏览器访问：`http://服务器IP:3000`

## 日常维护

### 重启服务

```bash
sudo systemctl restart fashion-inventory
```

### 停止服务

```bash
sudo systemctl stop fashion-inventory
```

### 查看状态

```bash
sudo systemctl status fashion-inventory
```

### 更新代码

```bash
# 停止服务
sudo systemctl stop fashion-inventory

# 切换到 fashion 用户更新
cd /opt/fashion-inventory
sudo -u fashion git pull
sudo -u fashion npm ci --omit=dev
sudo -u fashion npm run build

# 如果更新了数据库结构
sudo -u fashion npx prisma db push

# 启动服务
sudo systemctl start fashion-inventory
```

### 数据备份

```bash
# 手动备份
sudo -u fashion bash cloud-deploy/scripts/backup.sh systemd

# 设置定时备份
sudo crontab -e -u fashion
# 添加这一行（每天凌晨2点）：
0 2 * * * /opt/fashion-inventory/cloud-deploy/scripts/backup.sh systemd >> /var/log/fashion-backup.log 2>&1
```

## 数据库说明

### 数据库文件位置

```bash
/opt/fashion-inventory/prisma/data.db
```

这是 SQLite 数据库文件，包含所有业务数据。

### 备份数据库

使用脚本（推荐）：

```bash
sudo -u fashion bash cloud-deploy/scripts/backup.sh systemd
```

手动备份：

```bash
# 使用 sqlite3（在线备份，更安全）
sqlite3 /opt/fashion-inventory/prisma/data.db ".backup '/tmp/backup.db'"
gzip /tmp/backup.db

# 或直接复制（建议在低峰期）
cp /opt/fashion-inventory/prisma/data.db /tmp/backup.db
gzip /tmp/backup.db
```

### 恢复数据库

```bash
# 停止服务
sudo systemctl stop fashion-inventory

# 解压备份
gunzip /path/to/backup.db.gz

# 恢复文件
sudo cp /path/to/backup.db /opt/fashion-inventory/prisma/data.db
sudo chown fashion:fashion /opt/fashion-inventory/prisma/data.db

# 启动服务
sudo systemctl start fashion-inventory
```

## 配置反向代理

裸机部署默认监听 3000 端口，建议使用 Nginx 或 Caddy 反向代理。

### Nginx 配置

```bash
# 安装 Nginx
sudo apt install -y nginx

# 复制配置文件
sudo cp /opt/fashion-inventory/cloud-deploy/nginx.conf /etc/nginx/sites-available/fashion-inventory

# 编辑配置，修改域名和端口
sudo nano /etc/nginx/sites-available/fashion-inventory
# 将 3001 改为 3000（裸机部署的端口）

# 启用站点
sudo ln -s /etc/nginx/sites-available/fashion-inventory /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx

# 申请 SSL 证书
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Caddy 配置

```bash
# 安装 Caddy（见主文档）
# 复制配置
sudo cp /opt/fashion-inventory/cloud-deploy/caddy.conf /etc/caddy/Caddyfile

# 编辑配置，修改端口
sudo nano /etc/caddy/Caddyfile
# 将 127.0.0.1:3001 改为 127.0.0.1:3000

# 重启 Caddy
sudo systemctl reload caddy
```

## 性能优化

### 调整内存限制

编辑服务文件：

```bash
sudo nano /etc/systemd/system/fashion-inventory.service
```

修改内存限制：

```ini
# 1GB 内存服务器
MemoryMax=768M

# 512MB 内存服务器
MemoryMax=384M
```

重载并重启：

```bash
sudo systemctl daemon-reload
sudo systemctl restart fashion-inventory
```

### Node.js 内存优化

在 `.env` 中添加：

```env
NODE_OPTIONS=--max-old-space-size=384
```

### 启用 Swap（小内存服务器）

```bash
# 创建 2GB swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 持久化
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 故障排查

### 服务无法启动

```bash
# 查看详细错误
journalctl -u fashion-inventory -n 50 --no-pager

# 常见问题：
# 1. 端口被占用
sudo netstat -tulpn | grep 3000

# 2. 权限问题
ls -la /opt/fashion-inventory/prisma/data.db
sudo chown fashion:fashion /opt/fashion-inventory/prisma/data.db

# 3. Node 路径错误
which node
sudo nano /etc/systemd/system/fashion-inventory.service
```

### 数据库连接失败

```bash
# 检查数据库文件
ls -la /opt/fashion-inventory/prisma/data.db

# 重新初始化数据库
cd /opt/fashion-inventory
sudo -u fashion npx prisma db push
```

### 内存不足

```bash
# 查看内存使用
free -h
sudo systemctl status fashion-inventory | grep Memory

# 降低内存限制或启用 swap（见上方）
```

### 构建失败

```bash
# 清理并重新构建
cd /opt/fashion-inventory
sudo -u fashion rm -rf node_modules dist
sudo -u fashion npm ci --omit=dev
sudo -u fashion npm run prod:init
```

## 与 Docker 部署的对比

| 特性 | systemd 裸机 | Docker |
|------|-------------|--------|
| 内存占用 | 低（~200MB） | 中（~300MB） |
| 部署复杂度 | 中 | 低 |
| 迁移便利性 | 低 | 高 |
| 隔离性 | 无 | 好 |
| 适用场景 | 小内存服务器 | 通用 |

## 安全加固

1. **限制用户权限**：已使用专用的 `fashion` 用户
2. **配置防火墙**：
   ```bash
   sudo ufw allow 3000
   sudo ufw allow 80
   sudo ufw allow 443
   sudo ufw enable
   ```
3. **定期更新系统**：
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
4. **启用 fail2ban**（防止暴力破解）：
   ```bash
   sudo apt install -y fail2ban
   ```

## 下一步

- [配置 HTTPS](../README.md#配置-https推荐)
- [设置自动备份](../README.md#数据备份)
- [安全加固指南](安全加固.md)

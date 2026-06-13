# 服务器部署指南

本文档用于把本项目部署到 Linux 服务器。项目是 React/Vite 前端 + Express 后端 + Prisma + SQLite，生产环境不需要单独安装数据库服务。

## 方案选择

推荐优先使用 Docker Compose：

- 隔离好，迁移简单。
- 数据统一保存在 Docker volume 中。
- 适合大多数云服务器。

如果服务器内存很小，或者不想安装 Docker，可以使用 systemd 裸机部署：

- 占用更低。
- 数据库文件默认在 `prisma/data.db`。
- 需要自己安装 Node.js 和配置 systemd。

## 一、Docker Compose 部署

### 1. 准备服务器

服务器建议：

- Ubuntu 22.04 / 24.04 或 Debian 12
- 至少 1 核 1G 内存
- 已安装 Docker 和 Docker Compose

开放端口：

- 直接访问：开放 `3001`
- 使用反向代理：开放 `80` / `443`，应用端口只给本机或内网访问

### 2. 上传代码

把项目放到服务器，例如：

```bash
sudo mkdir -p /opt/fashion-inventory
sudo chown -R "$USER":"$USER" /opt/fashion-inventory
cd /opt/fashion-inventory
```

可以用 `git clone`，也可以用 `scp` / SFTP 上传当前项目文件。

### 3. 修改生产配置

编辑 `docker-compose.yml` 中的环境变量，至少修改这几项：

```yaml
SESSION_SECRET: 改成随机长字符串
AI_CONFIG_SECRET: 改成另一串随机长字符串
ADMIN_PASSWORD: 改成强密码
```

生成随机密钥：

```bash
openssl rand -hex 32
```

如果服务器没有 `openssl`，也可以用 Node：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. 启动

```bash
cd /opt/fashion-inventory
docker compose up -d --build
```

访问：

```text
http://服务器IP:3001
```

健康检查：

```bash
curl http://127.0.0.1:3001/api/healthz
```

看到 `ok:true` 且 `db:"up"` 表示正常。

### 5. 常用维护命令

```bash
docker compose ps
docker compose logs -f app
docker compose restart app
docker compose down
```

更新代码后：

```bash
cd /opt/fashion-inventory
git pull
docker compose up -d --build
```

## 二、systemd 裸机部署

### 1. 安装 Node.js

建议使用 Node.js 22 LTS 或 24。

验证：

```bash
node -v
npm -v
```

### 2. 上传代码并安装依赖

```bash
sudo mkdir -p /opt/fashion-inventory
sudo chown -R "$USER":"$USER" /opt/fashion-inventory
cd /opt/fashion-inventory
npm ci
```

### 3. 配置环境变量

```bash
cp .env.example .env
nano .env
```

必须修改：

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=file:./data.db
SESSION_SECRET=用随机长字符串替换
AI_CONFIG_SECRET=用另一串随机长字符串替换
ADMIN_USERNAME=admin
ADMIN_PASSWORD=改成强密码
```

注意：`DATABASE_URL=file:./data.db` 对应的实际文件是 `prisma/data.db`。

### 4. 初始化和构建

```bash
npm run prod:init
```

这个命令会执行：

- `prisma generate`
- `prisma db push`
- `npm run build`

本地验证启动：

```bash
npm run prod:start
```

另开一个终端检查：

```bash
curl http://127.0.0.1:3000/api/healthz
```

确认正常后按 `Ctrl+C` 停止，继续配置 systemd。

### 5. 配置 systemd

创建专用用户：

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin fashion
sudo chown -R fashion:fashion /opt/fashion-inventory
```

确认 Node 路径：

```bash
which node
```

复制服务文件：

```bash
sudo cp /opt/fashion-inventory/deploy/fashion-inventory.service /etc/systemd/system/fashion-inventory.service
```

如果 `which node` 不是 `/usr/bin/node`，编辑服务文件里的 `ExecStart`：

```bash
sudo nano /etc/systemd/system/fashion-inventory.service
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable fashion-inventory
sudo systemctl start fashion-inventory
sudo systemctl status fashion-inventory
```

查看日志：

```bash
journalctl -u fashion-inventory -f
```

更新代码后：

```bash
cd /opt/fashion-inventory
sudo systemctl stop fashion-inventory
sudo -u fashion npm ci
sudo -u fashion npm run build
sudo systemctl start fashion-inventory
```

如果改过 Prisma 表结构，启动前再执行：

```bash
sudo -u fashion npx prisma db push
```

## 三、绑定域名和 HTTPS

如果只在内网使用，可以先不配置 HTTPS，直接访问 `http://服务器IP:3001` 或 `http://服务器IP:3000`。

如果要公网访问，建议加反向代理和 HTTPS。

### Caddy 示例

安装 Caddy 后，编辑 `/etc/caddy/Caddyfile`：

```caddyfile
your-domain.com {
  reverse_proxy 127.0.0.1:3001
}
```

如果是裸机 systemd 部署，端口改为：

```caddyfile
your-domain.com {
  reverse_proxy 127.0.0.1:3000
}
```

重载：

```bash
sudo systemctl reload caddy
```

### Nginx 示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

裸机 systemd 部署时把 `3001` 改成 `3000`。

## 四、备份

SQLite 数据库是一个文件。务必每天自动备份，并把备份同步到另一台机器、NAS、网盘或对象存储。

### Docker Compose 备份

查看 volume 名称：

```bash
docker volume ls
```

本项目默认 volume 通常类似：

```text
fashion-inventory_app_data
```

手动备份：

```bash
mkdir -p /opt/fashion-inventory/backups
docker run --rm \
  -v fashion-inventory_app_data:/data:ro \
  -v /opt/fashion-inventory/backups:/backup \
  alpine sh -c "cp /data/data.db /backup/data-$(date +%F_%H%M).db"
gzip /opt/fashion-inventory/backups/data-*.db
```

恢复时先停服务：

```bash
docker compose down
gunzip -c /opt/fashion-inventory/backups/data-YYYY-MM-DD_HHMM.db.gz > /tmp/data.db
docker run --rm \
  -v fashion-inventory_app_data:/data \
  -v /tmp:/restore \
  alpine sh -c "cp /restore/data.db /data/data.db"
docker compose up -d
```

### 裸机 systemd 备份

仓库已提供脚本：

```bash
chmod +x /opt/fashion-inventory/deploy/backup.sh
/opt/fashion-inventory/deploy/backup.sh
```

加入定时任务：

```bash
crontab -e
```

每天凌晨 2 点备份：

```cron
0 2 * * * /opt/fashion-inventory/deploy/backup.sh >> /var/log/fashion-backup.log 2>&1
```

## 五、上线检查清单

- `SESSION_SECRET` 已修改为随机长字符串。
- `AI_CONFIG_SECRET` 已修改并妥善保存，后续不要随意更换。
- `ADMIN_PASSWORD` 已改为强密码。
- `http://服务器地址/api/healthz` 返回 `ok:true` 和 `db:"up"`。
- 重启应用后数据仍然存在。
- 重启服务器后应用能自动启动。
- 已配置每日备份。
- 备份已同步到服务器之外的位置。
- 公网访问时已配置 HTTPS。

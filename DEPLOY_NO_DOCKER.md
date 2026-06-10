# 不用 Docker 部署（裸机运行）

本文档说明如何脱离 Docker，直接在 **Windows** 或 **Linux** 上运行本系统。
适用场景：2-3 人内网小范围使用，目标是稳定运行 + 低内存占用。

数据库用 **SQLite**：就是一个文件，跟着应用一起跑，**不需要安装/连接独立的数据库服务**。

---

## 0. 为什么脱离 Docker + 用 SQLite

- Windows 上 Docker Desktop / WSL2 本身就吃 1.5–3GB 内存，停掉它省得最多。
- SQLite 没有独立数据库进程，整个系统就是**一个 Node 进程**，内存最省、运维最简单。
- 真正保证「稳定运行」的不是 Docker，而是**进程守护**（崩溃自启、开机自启）+ **定时备份**。

脱离 Docker 后大致内存占用：

| 组成 | 大概内存 |
|---|---:|
| Node 应用 + Prisma + SQLite | ~150–300 MB |

> 数据库就是一个 `.db` 文件，备份 = 复制这个文件；搬迁 = 把文件拷到新机器。

---

## 1. 公共准备（Windows / Linux 都要）

### 1.1 安装 Node.js

装 **Node.js 22 LTS 或 24**。验证：

```bash
node -v
npm -v
```

> 不需要安装 PostgreSQL，也不需要任何数据库服务。SQLite 引擎已由 Prisma 自带。

### 1.2 配置 .env

复制 `.env.example` 为 `.env`，按注释填好。重点几项：

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=file:./data.db
SESSION_SECRET=用 openssl rand -hex 32 生成
AI_CONFIG_SECRET=再生成一串，和上面不同
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的初始密码
```

随机串生成（任选一种）：

```bash
openssl rand -hex 32
# 或 node 一行：
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `DATABASE_URL` 是数据库文件路径。Prisma 解析 `file:` 相对路径时基准是 `prisma/` 目录，
> 所以 `file:./data.db` 实际生成在 `prisma/data.db`。会话文件默认放在 `./sessions`，可用 `SESSION_STORE_DIR` 改。

### 1.3 安装依赖 + 首次初始化

在项目目录执行：

```bash
npm ci
npm run prod:init
```

`prod:init` 做三件事：`prisma generate` + `prisma db push`（按 schema 创建 SQLite 库和表）+ `npm run build`（编译前后端到 dist/）。

> **只在首次部署、或改过数据库表结构后**才需要跑 `prod:init`（含 db push）。
> 平时日常启动只用 `prod:start`。

### 1.4 验证能跑起来

```bash
npm run prod:start
```

> `prod:start` 用 Node 自带的 `--env-file=.env` 加载配置（Node 20.6+ 内置，无需额外依赖），
> 所以必须先有 `.env` 文件，且在项目根目录运行。

浏览器打开 `http://localhost:3000`，用 `.env` 里的 admin 账号登录。
健康检查：访问 `http://localhost:3000/api/healthz`，应返回 `{"ok":true,"db":"up",...}`。

确认没问题后按 Ctrl+C 停掉，下面配置常驻运行。

---

## 2. 从旧 PostgreSQL 迁移数据（仅老用户需要）

如果你之前用的是 PostgreSQL 版本、库里有要保留的数据，用仓库自带脚本迁移一次：

前置：旧 PostgreSQL 能连上（把原来的 docker compose 的 postgres 起起来即可），且已按上面 1.3 跑过 `prod:init` 生成了空的 SQLite 库。

```bash
# Linux / macOS
SRC_DATABASE_URL="postgresql://fashion:fashion_pass@127.0.0.1:5433/fashion_inventory" \
DATABASE_URL="file:./data.db" \
node scripts/migrate-pg-to-sqlite.mjs
```

```powershell
# Windows PowerShell
$env:SRC_DATABASE_URL="postgresql://fashion:fashion_pass@127.0.0.1:5433/fashion_inventory"
$env:DATABASE_URL="file:./data.db"
node scripts/migrate-pg-to-sqlite.mjs
```

脚本会按外键顺序把各业务表导入 SQLite，自增 id 原样保留。**session 表不迁移**，迁完所有人重新登录一次即可。脚本是「清空+重灌」的，可反复运行。

---

## 3. Linux 云服务器：用 systemd 常驻

推荐放在 `/opt/fashion-inventory`。

### 3.1 建专用用户（可选但推荐）

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin fashion
sudo chown -R fashion:fashion /opt/fashion-inventory
```

> 注意：跑服务的用户要对项目目录（尤其 `prisma/` 数据库文件和 `sessions/`）有读写权限。

### 3.2 安装 systemd 服务

仓库里已带示例：`deploy/fashion-inventory.service`。

```bash
sudo cp /opt/fashion-inventory/deploy/fashion-inventory.service /etc/systemd/system/
# 确认 node 路径，nvm 装的可能不在 /usr/bin
which node
# 如果不是 /usr/bin/node，编辑 service 文件里的 ExecStart 改成实际路径
sudo nano /etc/systemd/system/fashion-inventory.service

sudo systemctl daemon-reload
sudo systemctl enable fashion-inventory   # 开机自启
sudo systemctl start fashion-inventory
sudo systemctl status fashion-inventory
```

看日志：

```bash
journalctl -u fashion-inventory -f
```

### 3.3 更新代码后怎么重启

```bash
cd /opt/fashion-inventory
git pull                 # 或手动覆盖文件
npm ci
npm run build            # 没改表结构就只 build，不用 db push
sudo systemctl restart fashion-inventory
```

改过表结构时，build 前先 `npx prisma db push`。

---

## 4. Windows：用 PM2 或 NSSM 常驻

两种都行，二选一。

### 方案 A：PM2（简单）

```bash
npm install -g pm2
cd 项目目录
# 走 prod:start，自动带 --env-file=.env 读取配置
pm2 start npm --name fashion-inventory -- run prod:start
pm2 save
```

常用命令：

```bash
pm2 status
pm2 logs fashion-inventory
pm2 restart fashion-inventory
```

> PM2 在 Windows 上做「开机自启」比较麻烦（pm2-startup 对 Windows 支持不稳）。
> 如果一定要关机重启后也能自动拉起，用下面的 NSSM 更可靠。

### 方案 B：NSSM（做成真正的 Windows 服务，推荐用于开机自启）

1. 下载 NSSM（nssm.cc），把 `nssm.exe` 放到 PATH 里。
2. 注册服务：

```bash
nssm install FashionInventory
```

弹出的图形界面里填：

- **Path**：node 的完整路径（`where node` 查）
- **Startup directory**：项目目录（必须，`--env-file=.env` 和 SQLite 文件路径都相对这个目录）
- **Arguments**：`--env-file=.env dist/server/index.js`

3. 启动并设为自动：

```bash
nssm start FashionInventory
nssm set FashionInventory Start SERVICE_AUTO_START
```

> 用 `--env-file=.env` + 正确的 Startup directory，服务就能读到配置，
> 不用再手动往 NSSM 的 Environment 里抄变量。

---

## 5. 定时备份（最重要）

SQLite 数据库就是一个文件，备份 = 复制这个文件。务必做自动备份。

### Linux（crontab + 自带脚本）

仓库带了 `deploy/backup.sh`，每天备份并清理 14 天前的旧备份（优先用 `sqlite3 .backup`，没装 sqlite3 命令时退化为文件复制）：

```bash
# 先改 backup.sh 里的 DB_FILE / BACKUP_DIR 为实际路径
chmod +x /opt/fashion-inventory/deploy/backup.sh
crontab -e
# 加一行：每天凌晨 2 点备份
0 2 * * * /opt/fashion-inventory/deploy/backup.sh >> /var/log/fashion-backup.log 2>&1
```

恢复：先停服务，把备份的 `.db.gz` 解压覆盖回 `DATABASE_URL` 指向的文件，再启动：

```bash
sudo systemctl stop fashion-inventory
gunzip -c backups/data-2026-06-10_0200.db.gz > prisma/data.db
sudo systemctl start fashion-inventory
```

### Windows（复制文件 + 任务计划）

最简单：停服务后直接复制 `prisma\data.db` 到备份目录，写成 .bat 用「任务计划程序」每天定时跑。
（运行中复制低并发场景一般也没问题，但低峰期或停服务时复制最稳妥。）

> 不管哪种，强烈建议把备份再同步一份到**另一台机器 / NAS / 网盘 / 对象存储**。
> 备份和数据库在同一块磁盘上，磁盘坏了等于没备份。

### 应用内备份

系统里「数据备份」页可以一键导出业务数据 JSON（不含 AI Key），作为额外的轻量备份手段，但它**不能替代**对 `.db` 文件的完整备份。

---

## 6. 稳定运行检查清单

部署完照着过一遍：

- [ ] `http://服务器:3000/api/healthz` 返回 `ok:true`
- [ ] 杀掉 Node 进程后，PM2 / systemd 能自动拉起
- [ ] 重启整台机器后，应用能自动起来
- [ ] `.env` 里 SESSION_SECRET / AI_CONFIG_SECRET / ADMIN_PASSWORD 都改成了自己的值
- [ ] 服务用户对 `.db` 文件和 `sessions/` 目录有读写权限
- [ ] 每日备份任务已配置，且确认生成了备份文件
- [ ] 备份有异地副本
- [ ] 给每位同事建了独立账号（设置 → 账号管理）

---

## 7. 常见问题

**Q：改了 .env 里的 ADMIN_PASSWORD，admin 密码没变？**
A：`ADMIN_PASSWORD` 只在首次创建 admin 时生效。已存在后改这里无效，请到「设置 → 账号管理」里改密码。

**Q：换了 SESSION_SECRET 后，AI 识图报「解密失败」？**
A：AI Key 的加密用独立的 `AI_CONFIG_SECRET`，请单独设置且设定后别再改。如果已经踩坑，到设置页重新保存一次 AI API Key 即可。

**Q：数据库文件放哪了？怎么搬到新机器？**
A：就是 `DATABASE_URL` 指向的那个 `.db` 文件（默认 `prisma/data.db`）。搬迁时停服务、把这个文件拷到新机器同样位置即可，数据原样带走。

**Q：SQLite 支持几个人同时用？**
A：2-3 人完全没问题。SQLite 适合中低并发；如果以后并发明显变大（比如几十人同时频繁写入），再考虑回到 PostgreSQL。

**Q：要不要上 HTTPS / 反向代理？**
A：内网 2-3 人用可以先不上。若以后要从外网访问，再在前面加 Caddy（自动 HTTPS 最省事）或 Nginx，并把应用只监听 127.0.0.1。

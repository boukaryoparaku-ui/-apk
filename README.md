# 服装供销存系统

一个服装供销存 Web 管理后台，包含登录、账号管理、SKU 管理、采购入库、销售开单、销售出库、库存查询、库存流水、AI 识图入库/开单和数据备份。

## 技术栈

- 前端：React + TypeScript + Vite
- 后端：Node.js + Express + TypeScript
- ORM：Prisma
- 数据库：SQLite（单文件，无需独立数据库服务）
- 会话：session-file-store（持久化到本地文件，纯 JS 无原生编译）
- 部署：支持 Docker Compose，也支持脱离 Docker 裸机运行

## 启动方式一：Docker Compose

适合快速本地测试：

```bash
docker compose up -d --build
```

访问地址：

```text
http://localhost:3001
```

默认管理员：

```text
admin / admin123
```

> 正式使用前请改强密码，并设置随机的 `SESSION_SECRET` 和 `AI_CONFIG_SECRET`。

常用命令：

```bash
docker compose ps
docker compose logs app
docker compose down
```

数据保存在 Docker volume `app_data` 里（容器内 `/data`），包含 SQLite 数据库文件和会话文件。已不再需要独立的 PostgreSQL 服务。

## 启动方式二：脱离 Docker 裸机运行

适合 Windows 本地长期运行或 Linux 云服务器低内存运行。详见：

```text
DEPLOY_NO_DOCKER.md
```

核心命令：

```bash
npm ci
npm run prod:init
npm run prod:start
```

其中：

- `prod:init`：首次部署或改表结构后执行，包含 `prisma generate`、`prisma db push` 和构建。
- `prod:start`：日常启动，使用 Node 内置 `--env-file=.env` 读取配置后启动服务。

健康检查：

```text
http://localhost:3000/api/healthz
```

返回 `ok:true` 且 `db:"up"` 表示应用和数据库正常。

## 账号管理

系统支持多账号。登录后进入：

```text
设置 → 账号管理
```

可以添加同事账号、重置密码、删除不再使用的账号。库存流水会记录操作人，方便追溯是谁入库、出库或改库存。

## 业务规则

- 库存按 `款号 + 颜色 + 尺码` 管理。
- 采购入库会增加库存，并写入库存流水。
- 销售出库会扣减库存，并写入库存流水。
- 销售开单支持多款号同单录入，保存后会立即生成出库单、扣减库存并写入库存流水；历史待发货订单仍可点击发货扣库存。
- 系统允许负库存，库存查询页会用红色标记负库存。
- 多账号共享同一套业务数据，库存流水会记录当前登录账号作为操作人。
- 入库页和销售开单页支持 AI 识别表格图片/文字并预填矩阵；API 地址、Key 和模型名可保存到当前登录账户，兼容 Chat Completions 格式的视觉模型接口。
- AI API Key 加密保存在数据库中，前端只显示是否已绑定，不会回显 Key。
- 建议单独设置 `AI_CONFIG_SECRET`，不要依赖 `SESSION_SECRET` 加密 AI Key，避免以后轮换登录密钥导致已保存的 AI Key 无法解密。

## 生产/长期运行建议

- 脱离 Docker 运行时使用 `.env` 管理配置，参考 `.env.example`。
- Windows 可用 PM2 或 NSSM 做后台服务；Linux 推荐 systemd。
- 数据库是单个 SQLite 文件，备份就是复制该 `.db` 文件（见 `deploy/backup.sh`），并把备份同步到另一台机器、NAS、网盘或对象存储。
- 从旧 PostgreSQL 迁移数据用 `scripts/migrate-pg-to-sqlite.mjs`，详见 `DEPLOY_NO_DOCKER.md`。

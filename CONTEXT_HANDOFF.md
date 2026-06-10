# 服装供销存系统上下文交接

## 项目位置

- 当前项目目录：`C:\Users\17553\Documents\dooker-copy-20260525-204407`
- 默认访问地址：Docker 方式 `http://localhost:3001`；裸机方式 `http://localhost:3000`
- 默认管理员：`admin / admin123`（正式使用请改强密码）
- 运行方式：Docker Compose，或脱离 Docker 裸机运行（见 `DEPLOY_NO_DOCKER.md`）

## 技术栈

- 前端：React + TypeScript + Vite
- 后端：Node.js + Express + TypeScript
- ORM：Prisma
- 数据库：SQLite（单文件，无独立数据库服务）
- 会话：session-file-store（持久化到 ./sessions，纯 JS）
- 容器：Docker Compose（可选）

## 关键文件

- `src/main.tsx`：前端页面、表单、库存矩阵、入库/出库逻辑、账号管理面板
- `src/styles.css`：页面样式（极简中性 SaaS 风，CSS 变量集中管理配色）
- `server/index.ts`：后端 API、库存增减、SKU 创建、账号管理、健康检查
- `prisma/schema.prisma`：数据库模型
- `docker-compose.yml`：app/postgres 服务定义
- `Dockerfile`：生产镜像构建
- `docker-entrypoint.sh`：Docker 启动时执行 `prisma db push` 并启动服务
- `.env.example`：环境变量模板（DATABASE_URL 为 SQLite file:）
- `DEPLOY_NO_DOCKER.md`：脱离 Docker 的部署文档（Windows/Linux）
- `deploy/fashion-inventory.service`：Linux systemd 单元示例
- `deploy/backup.sh`：每日 SQLite 文件备份脚本
- `scripts/migrate-pg-to-sqlite.mjs`：旧 PostgreSQL → SQLite 一次性数据迁移脚本

## 当前主要功能

- 登录
- 账号管理（多账号，每人独立账号）
- 库存查询
- 添加新款
- SKU 管理
- 库存入库
- 库存出库
- 销售开单与保存即扣库存
- 库存流水
- 数据备份

## 当前业务逻辑

- 库存按 `款号 + 颜色 + 尺码` 管理。
- 允许负库存。
- 款号现在带 `supplier` 字段，一个款号对应一个供应商。
- 库存查询按颜色行、尺码列展示，并显示库存总计和已销售数量。
- 出库选择已有款号后，按颜色 x 尺码矩阵填写出库数量。
- 销售开单支持一个单据录入多个款号/颜色行，按尺码横排填写数量；保存后立即创建出库单、扣减库存并写入流水。历史待发货订单仍可点击发货扣库存。
- 销售开单保存订单级收款快照：微信、现金、支付宝、刷卡、扫码付、汇款、应收、已收、未付和结余；暂不做跨订单客户欠款核销。
- 添加新款页面用于创建款号、供应商、颜色、尺码 SKU，初始库存为 0。
- 入库页面选择已有款号后，会自动填充供应商、款号、商品名、颜色、尺码。
- 入库页面中原先没有 SKU 的空格也可以填写数量，提交后后端会自动创建缺失 SKU 并入库。
- 入库页新增 AI 识图预填：上传表格截图/照片，使用当前登录账户保存的 Chat Completions 兼容 API 地址、API Key 和模型名，后端 `/api/ai/inbound-table` 调用视觉模型解析后回填入库矩阵。配置通过 `/api/ai/config` 保存，Key 加密落库且不回显。
- 多账号：每位同事用独立账号登录，库存流水按 `operatorId` 记录操作人。任何登录账号都能在「设置 → 账号管理」添加/改密/删除账号，不分角色。删除账号会保留其历史流水（操作人显示为空），并级联清除其 AI 配置；不能删自己、不能删到一个不剩。

## 最近修正点

- 之前入库页一度只允许已有 SKU 格子入库，导致截图中显示 `-` 的格子不能补货。
- 已修正为：入库页重新使用可编辑的 `QuickSkuMatrix`，提交时调用 `collectQuickItems`，由后端 `findOrCreateSku` 自动创建缺失 SKU。
- 已验证：测试款号只有 `L` 码时，入库填写不存在的 `M` 码后，系统自动创建 `M` 码 SKU，库存增加成功。
- 2026-05-25：新增 AI 表格识别入库预填，并支持按登录账户保存 API 配置。已通过 `npm run build`、`prisma db push`、Docker 重建和浏览器渲染检查。
- 2026-06-10：客户开单改造为商陆花式销售开单台，支持多款号同单、订单级收款汇总、本机挂单草稿和保存即扣库存；历史待发货订单保留发货兼容逻辑。
- 2026-06-10：界面改版为极简中性 SaaS 风格，`src/styles.css` 用 CSS 变量集中管理配色（浅色侧栏 + 近白背景 + 靛蓝强调色），class 名未变、功能未动。
- 2026-06-10：新增多账号管理。后端加 `GET/POST /api/users`、`POST /api/users/:id/password`、`DELETE /api/users/:id`；前端「设置」页加账号管理面板。`npm run build` 和 13 个测试通过。
- 2026-06-10：新增脱离 Docker 的裸机运行支持。`server/index.ts` 加 `GET /api/healthz`（免登录、探测数据库）；`package.json` 加 `prod:init` 和 `prod:start`（`prod:start` 用 Node 内置 `--env-file=.env` 读配置，无新依赖）；新增 `.env.example`、`DEPLOY_NO_DOCKER.md`、`deploy/fashion-inventory.service`、`deploy/backup.sh`。业务逻辑零改动。
- 2026-06-10：数据库从 PostgreSQL 切换到 **SQLite**。schema provider 改 sqlite、去掉所有 `@db.*` 原生类型、两个 enum（MovementType/CustomerOrderStatus）改为 String、删除 Session model；session 存储从 connect-pg-simple 换成 **session-file-store**（持久化到 ./sessions，纯 JS 免原生编译，因 Windows 无 VS 无法编译 sqlite3/connect-sqlite3）；删除 9 处 `mode:"insensitive"`（SQLite 不支持，中文/款号搜索不受影响）；`server/index.ts` 的 MovementType 改为本地字符串字面量类型。已实测 healthz、登录、持久化 session、账号 CRUD、SKU/入库/销售开单的 Decimal 金额计算（599.97 等）全部正确，库存扣减和流水操作人正常；`npm run build` 和 13 个测试通过。Docker 方式改为单 app 服务 + `app_data` 卷存 `/data`，去掉 postgres 服务。迁移老数据用 `scripts/migrate-pg-to-sqlite.mjs`。

## 常用命令

Docker 方式：

```powershell
docker compose build app
docker compose up -d app
docker compose ps
docker compose logs app --tail=80
```

裸机方式（详见 `DEPLOY_NO_DOCKER.md`）：

```bash
npm ci
npm run prod:init      # 首次部署或改表结构后
npm run prod:start     # 日常启动（--env-file=.env）
# 健康检查：GET http://localhost:3000/api/healthz
```

## 数据库说明

- 数据库是 **SQLite 单文件**，由 `.env` 的 `DATABASE_URL=file:...` 指定（裸机默认 `prisma/data.db`，Docker 在卷里的 `/data/data.db`）。会话文件在 `SESSION_STORE_DIR`（默认 `./sessions`）。
- Docker 启动时 `docker-entrypoint.sh` 会执行 `npx prisma db push --skip-generate` 同步表结构；裸机方式由 `npm run prod:init` 里的 `prisma db push` 完成，平时启动不再 push。
- Docker 方式只有一个 `app` 服务，数据在 volume `app_data`（容器内 `/data`），已无 postgres 服务和 5433 端口。
- 备份 = 复制 `.db` 文件（见 `deploy/backup.sh`）。迁移旧 PostgreSQL 数据用 `scripts/migrate-pg-to-sqlite.mjs`。
- `database/fashion_inventory_dump.sql` 是旧 PostgreSQL 的快照，仅供迁移/参考，新库不再使用它。

## 注意事项

- SQLite 适合本项目的 2-3 人中低并发；并发明显变大时再考虑回到 PostgreSQL。
- SQLite 限制（已适配）：不支持 enum（用 String）、不支持 `@db.*` 原生类型、不支持 `mode:"insensitive"`、不支持 Json 字段。新增字段时注意别用这些。
- Windows 上 `sqlite3`/`connect-sqlite3` 需要 Visual Studio 才能编译，本项目刻意改用纯 JS 的 session-file-store 规避；不要因为"用了 SQLite"就去装 connect-sqlite3。
- 当前源码文件里部分历史中文字符串在某些 PowerShell 输出中可能显示乱码，但浏览器页面实际中文通常正常。
- 若要继续优化，建议下一步把"添加新款""入库""出库"的矩阵组件抽成更清晰的独立组件，减少回归风险。
- 裸机运行：`ADMIN_PASSWORD` 只在首次创建 admin 时生效，之后改密码请用「设置 → 账号管理」；`AI_CONFIG_SECRET` 设定后不要更改，否则已加密的 AI Key 无法解密。

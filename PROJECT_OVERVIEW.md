# 项目总览 · 服装供销存系统 + 安卓客户端

> 这份文件用于在新对话/新窗口里**快速理解整个项目**。一句话：一个给 2~3 人小团队用的服装「进销存」Web 管理后台，配了一个安卓壳 App。

## 1. 这是什么

- **业务**：服装店/批发的供销存(进货、销售、库存)管理后台。
- **用户规模**：2~3 人多账号共用一套数据，中低并发。
- **核心维度**：库存按 `款号(styleNo) + 颜色(color) + 尺码(size)` 三要素管理。
- **形态**：① 浏览器访问的 Web 后台；② 安卓 App(只是个壳，内部加载同一个 Web 页面)。

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + TypeScript + Vite 6(单文件 `src/main.tsx`) |
| 后端 | Node.js + Express 4 + TypeScript(单文件 `server/index.ts`) |
| ORM | Prisma 5 |
| 数据库 | **SQLite 单文件**(无独立 DB 服务) |
| 会话 | session-file-store(cookie 认证，存到 `./sessions`，纯 JS 免编译) |
| 安卓 | Capacitor 6 远程壳(`mobile/`)，GitHub Actions 云构建 APK |

> 历史：曾用 PostgreSQL，2026-06-10 切到 SQLite。迁移脚本 `scripts/migrate-pg-to-sqlite.mjs`。

## 3. 目录结构(关键文件)

```
├─ src/
│  ├─ main.tsx            前端全部页面/表单/库存矩阵/入库出库/账号管理（核心，约2000行）
│  ├─ styles.css          样式（CSS变量配色 + 响应式断点 860px/480px）
│  ├─ inventoryLogic.ts   库存计算纯函数（有单测）
│  ├─ matrixComponents.tsx 颜色×尺码矩阵组件
│  └─ types.ts            前端类型
├─ server/
│  ├─ index.ts            后端全部 API、库存增减、健康检查（核心）
│  ├─ prisma.ts           Prisma client
│  ├─ seed.ts             首次创建 admin
│  └─ assets/fonts/simhei.ttf  PDF 打印用中文字体
├─ prisma/schema.prisma   数据模型（见第5节）
├─ mobile/                安卓 Capacitor 壳（见第7节）
├─ .github/workflows/android.yml  云构建 APK
├─ DEPLOY_NO_DOCKER.md    裸机部署详解
├─ CONTEXT_HANDOFF.md     历史交接笔记（更细的演进记录）
└─ docker-compose.yml / Dockerfile  Docker 方式
```

## 4. 功能模块

登录 · 账号管理(多账号、改密、删号) · 库存查询(颜色行×尺码列矩阵，负库存红标) · 添加新款 · SKU 管理 · 入库(选款自动带出信息，缺失 SKU 自动创建) · 出库 · **销售开单**(多款号同单、保存即扣库存、订单级收款汇总、本机挂单草稿) · 库存流水(记录操作人) · **AI 识图入库**(上传表格图，视觉模型解析回填) · 数据备份(导出) · 销售单 PDF 打印。

## 5. 数据模型(Prisma)

```
User ─┬─ StockMovement(operatorId 记录操作人)
      └─ UserAiConfig(每账号一套加密的 AI API 配置)

Product(款号 styleNo 唯一, supplier 供应商)
  └─ Sku(color+size, 唯一约束 [productId,color,size], 可选 retailPrice)
       ├─ InventoryBalance(quantity 当前库存, 允许负数)
       ├─ InboundOrderItem  ← InboundOrder(进货单)
       ├─ OutboundOrderItem ← OutboundOrder(出库单)
       ├─ CustomerOrderItem ← CustomerOrder(销售单, 含多种收款字段)
       └─ StockMovement(每次增减一条流水, type/quantityChange/balanceAfter)

CustomerOrder ──(1:1)── OutboundOrder   销售单确认发货后关联出库单
```

收款字段(CustomerOrder)：`amountDue/paidAmount/unpaidAmount/changeAmount` + 微信/现金/支付宝/刷卡/扫码/汇款 6 种 payment*。

## 6. API 路由(全部在 server/index.ts，前缀 /api，除 healthz 外均需登录)

- 认证：`POST /auth/login`、`POST /auth/logout`、`GET /auth/me`
- 健康：`GET /healthz`(免登录，探测 DB)
- 账号：`GET/POST /users`、`POST /users/:id/password`、`DELETE /users/:id`
- 商品/款号：`GET/POST /products`、`PATCH /products/:id`
- SKU：`GET/POST /skus`、`PATCH /skus/:id`
- 库存：`GET /inventory`、`GET /stock-movements`
- 入库：`POST/GET /inbound-orders`、`GET /inbound-orders/:id`
- 出库：`POST/GET /outbound-orders`、`GET /outbound-orders/:id`
- 销售单：`GET/POST /customer-orders`、`POST /customer-orders/:id/ship`(发货扣库存)、`DELETE /customer-orders/:id`、`POST /customer-orders/:id/print-pdf`
- AI：`GET/PUT /ai/config`(Key 加密落库、不回显)、`POST /ai/inbound-table`(识图)
- 备份：`GET /backup/export`
- 兜底：`GET *` 返回前端 index.html(SPA)

## 7. 安卓客户端(mobile/)

- **原理**：Capacitor「远程壳」。App 本身不含业务代码，启动后让用户填服务器地址(如 `http://192.168.1.10:3000`)，用内置 WebView 加载现有 Web 系统。**后端零改动**。
- **认证**：沿用 Web 的 session cookie(`secure:false`/`sameSite:lax`，局域网 http 可用)。
- **换服务器 IP**：App 内重填即可，**不用重打 APK**；地址存手机 localStorage。
- **构建**：推到 GitHub → Actions「Build Android APK」自动出 debug APK → Artifacts 下载。
- **关键文件**：`mobile/capacitor.config.json`(含 `cleartext:true` 允许明文 http、`allowNavigation:["*"]` 防止跳系统浏览器)、`mobile/www/index.html`(启动配置页)、`mobile/README.md`(完整使用/构建说明)。
- **GitHub 仓库**：`https://github.com/boukaryoparaku-ui/-apk`(分支 main)。

## 8. 如何运行

### 裸机(推荐，Windows/Linux 通用)
```bash
npm ci
npm run prod:init     # 首次或改表结构后：prisma generate + db push + build
npm run prod:start    # 日常启动（Node --env-file=.env 读配置）
# 默认 http://localhost:3000  健康检查 /api/healthz
```

### 开发
```bash
npm run dev           # tsx watch 起后端 + Vite 前端（前端代理 /api → :3000）
npm test              # vitest（库存逻辑等单测）
```

### Docker
```bash
docker compose up -d --build   # 默认 http://localhost:3001，数据在卷 app_data
```

默认管理员 `admin / admin123`(正式用务必改强密码 + 设随机 `SESSION_SECRET`、`AI_CONFIG_SECRET`)。

## 9. 部署/数据/安全要点

- 数据库 = 单个 `.db` 文件，路径由 `.env` 的 `DATABASE_URL=file:...` 指定(裸机默认 `prisma/data.db`)。**备份 = 复制该 .db 文件**(`deploy/backup.sh`)。
- `database/*.sql`(旧 PG 转储，含真实业务数据)和 `.env` 已 **gitignore**，不入库、勿外泄。
- `AI_CONFIG_SECRET` 一旦设定**不要改**，否则已加密的 AI Key 无法解密。
- `ADMIN_PASSWORD` 只在首次建 admin 时生效，之后改密走「设置 → 账号管理」。

## 10. SQLite 适配约束(改 schema 时注意)

不支持 enum(用 String)、不支持 `@db.*` 原生类型、不支持 `mode:"insensitive"`、不支持 Json 字段。Windows 上刻意用纯 JS 的 session-file-store(不要装需要编译的 connect-sqlite3)。

## 11. 当前进度 / 待办

- ✅ 安卓远程壳已跑通，APK 可装可用(已修「点保存跳系统浏览器」问题)。
- ✅ Web 端已加 `≤480px` 手机断点(放大点击区到 44px、输入框 16px 防缩放、收紧留白、表格横滑优化)。改 CSS 后需在服务器重新 `npm run build` + 重启，App 下拉刷新即可见，**APK 不用重打**。
- ⏳ 可选未做：手机上**宽数据表格仍需左右滑**(库存表 760px、入库矩阵 1040px、出库 980px)。彻底解决需把表格在手机上改成**卡片式竖排**，会动 `main.tsx` 渲染逻辑，有回归风险，建议按页面逐个改。
- 💡 历史建议：把「添加新款/入库/出库」的矩阵组件抽成更清晰的独立组件，降低回归风险。

---

更细的演进历史见 `CONTEXT_HANDOFF.md`；裸机部署细节见 `DEPLOY_NO_DOCKER.md`；安卓使用/构建见 `mobile/README.md`。

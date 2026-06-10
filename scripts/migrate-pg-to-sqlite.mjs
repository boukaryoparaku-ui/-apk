// PostgreSQL -> SQLite 一次性数据迁移脚本
//
// 用途：把旧 PostgreSQL 数据库里的业务数据导入新的 SQLite 库。
// session 表不迁移（换了存储方式，迁过去也没用，迁完大家重新登录一次即可）。
//
// 前置条件：
//   1. 旧 PostgreSQL 必须能连上（比如先把原来的 docker compose 的 postgres 起起来）。
//   2. 已经按新 schema 用 SQLite 跑过 `prisma db push`，生成了空的 SQLite 库。
//   3. 已 `npm install`（需要 pg 和 @prisma/client）。
//
// 运行（PowerShell / bash 都可，注意换成你自己的连接串）：
//   SRC_DATABASE_URL="postgresql://fashion:fashion_pass@127.0.0.1:5433/fashion_inventory" \
//   DATABASE_URL="file:./prisma/dev.db" \
//   node scripts/migrate-pg-to-sqlite.mjs
//
//   Windows PowerShell 写法：
//   $env:SRC_DATABASE_URL="postgresql://fashion:fashion_pass@127.0.0.1:5433/fashion_inventory"
//   $env:DATABASE_URL="file:./prisma/dev.db"
//   node scripts/migrate-pg-to-sqlite.mjs
//
// 脚本是幂等的「清空+重灌」：每次运行会先清空 SQLite 里的业务表再重新导入，
// 方便反复试。导入顺序按外键依赖排好，自增 id 原样保留。

import pg from "pg";
import { PrismaClient } from "@prisma/client";

const SRC = process.env.SRC_DATABASE_URL;
if (!SRC) {
  console.error("缺少 SRC_DATABASE_URL（旧 PostgreSQL 连接串）");
  process.exit(1);
}
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith("file:")) {
  console.error("DATABASE_URL 必须指向 SQLite，例如 file:./prisma/dev.db");
  process.exit(1);
}

const src = new pg.Client({ connectionString: SRC });
const prisma = new PrismaClient();

// 按外键依赖从「父」到「子」的顺序导入；删除时反过来。
const TABLES = [
  "users",
  "products",
  "skus",
  "inventory_balances",
  "inbound_orders",
  "inbound_order_items",
  "outbound_orders",
  "outbound_order_items",
  "customer_orders",
  "customer_order_items",
  "stock_movements",
  "user_ai_configs"
];

// 每张表对应的 Prisma delegate（用于写入 SQLite）
const DELEGATE = {
  users: () => prisma.user,
  products: () => prisma.product,
  skus: () => prisma.sku,
  inventory_balances: () => prisma.inventoryBalance,
  inbound_orders: () => prisma.inboundOrder,
  inbound_order_items: () => prisma.inboundOrderItem,
  outbound_orders: () => prisma.outboundOrder,
  outbound_order_items: () => prisma.outboundOrderItem,
  customer_orders: () => prisma.customerOrder,
  customer_order_items: () => prisma.customerOrderItem,
  stock_movements: () => prisma.stockMovement,
  user_ai_configs: () => prisma.userAiConfig
};

// PostgreSQL 列名(snake_case 已是表内真实列) -> Prisma 字段名(camelCase) 的映射。
// 这里直接按各表逐一列出需要 rename 的列，未列出的列名保持不变。
const FIELD_MAP = {
  users: { password_hash: "passwordHash", created_at: "createdAt" },
  products: { created_at: "createdAt", updated_at: "updatedAt" },
  skus: {
    product_id: "productId",
    retail_price: "retailPrice",
    is_active: "isActive",
    created_at: "createdAt",
    updated_at: "updatedAt"
  },
  inventory_balances: { sku_id: "skuId", updated_at: "updatedAt" },
  inbound_orders: { inbound_date: "inboundDate", created_at: "createdAt" },
  inbound_order_items: {
    inbound_order_id: "inboundOrderId",
    sku_id: "skuId",
    unit_cost: "unitCost"
  },
  outbound_orders: { outbound_date: "outboundDate", created_at: "createdAt" },
  outbound_order_items: {
    outbound_order_id: "outboundOrderId",
    sku_id: "skuId",
    unit_price: "unitPrice"
  },
  customer_orders: {
    order_no: "orderNo",
    order_date: "orderDate",
    shipped_at: "shippedAt",
    outbound_order_id: "outboundOrderId",
    amount_due: "amountDue",
    paid_amount: "paidAmount",
    unpaid_amount: "unpaidAmount",
    change_amount: "changeAmount",
    payment_wechat: "paymentWechat",
    payment_cash: "paymentCash",
    payment_alipay: "paymentAlipay",
    payment_card: "paymentCard",
    payment_scan: "paymentScan",
    payment_transfer: "paymentTransfer",
    created_at: "createdAt",
    updated_at: "updatedAt"
  },
  customer_order_items: {
    customer_order_id: "customerOrderId",
    sku_id: "skuId",
    unit_price: "unitPrice"
  },
  stock_movements: {
    sku_id: "skuId",
    quantity_change: "quantityChange",
    balance_after: "balanceAfter",
    inbound_order_id: "inboundOrderId",
    outbound_order_id: "outboundOrderId",
    operator_id: "operatorId",
    created_at: "createdAt"
  },
  user_ai_configs: {
    user_id: "userId",
    api_url: "apiUrl",
    api_key_cipher: "apiKeyCipher",
    api_key_iv: "apiKeyIv",
    api_key_auth_tag: "apiKeyAuthTag",
    created_at: "createdAt",
    updated_at: "updatedAt"
  }
};

function mapRow(table, row) {
  const map = FIELD_MAP[table] || {};
  const out = {};
  for (const [col, value] of Object.entries(row)) {
    const key = map[col] || col;
    out[key] = value;
  }
  return out;
}

async function main() {
  await src.connect();
  console.log("已连接源 PostgreSQL");

  // 先清空 SQLite 业务表（反向顺序，避开外键约束）
  for (const table of [...TABLES].reverse()) {
    await DELEGATE[table]().deleteMany({});
  }
  console.log("已清空目标 SQLite 业务表");

  let grandTotal = 0;
  for (const table of TABLES) {
    let rows;
    try {
      const result = await src.query(`SELECT * FROM "${table}" ORDER BY id ASC`);
      rows = result.rows;
    } catch (err) {
      console.warn(`跳过表 ${table}（源库读取失败：${err.message}）`);
      continue;
    }
    const delegate = DELEGATE[table]();
    let n = 0;
    for (const row of rows) {
      await delegate.create({ data: mapRow(table, row) });
      n++;
    }
    grandTotal += n;
    console.log(`导入 ${table}: ${n} 行`);
  }

  console.log(`\n迁移完成，共导入 ${grandTotal} 行。session 表已按设计跳过，迁移后请重新登录。`);
}

main()
  .catch((err) => {
    console.error("迁移失败：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await src.end().catch(() => {});
    await prisma.$disconnect();
  });

import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import compression from "compression";
import sessionFileStore from "session-file-store";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import PDFDocument from "pdfkit";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { seedAdmin } from "./seed.js";

// SQLite 没有原生 enum，库表里用字符串存。这里保留与原 enum 一致的取值，便于全局类型约束。
type MovementType = "INBOUND" | "OUTBOUND";

const app = express();
const port = Number(process.env.PORT || 3000);
const FileStore = sessionFileStore(session);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "../client");
// session 持久化到文件，目录可用 SESSION_STORE_DIR 覆盖，默认 ./sessions
const sessionStoreDir = process.env.SESSION_STORE_DIR || "./sessions";
const aiKeySecret = crypto.createHash("sha256").update(process.env.AI_CONFIG_SECRET || process.env.SESSION_SECRET || "dev-secret").digest();
const skuInclude = {
  product: true,
  inventoryBalance: true,
  outboundItems: { select: { quantity: true } },
  inboundItems: {
    select: {
      inboundOrder: { select: { supplier: true, createdAt: true } }
    },
    orderBy: { inboundOrder: { createdAt: "desc" } },
    take: 1
  }
} as const;

// gzip 压缩文本类响应（HTML/JS/CSS/JSON），对低带宽云服务器明显省流量、提速。
// compression 默认跳过已压缩内容（图片/PDF）和带 Cache-Control: no-transform 的响应。
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    store: new FileStore({
      path: sessionStoreDir,
      ttl: 60 * 60 * 12,
      retries: 1,
      logFn: () => {}
    }) as session.Store,
    name: "fashion.sid",
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

type RecognizedInboundItem = {
  styleNo?: string;
  productName?: string;
  supplier?: string;
  color: string;
  size: string;
  quantity: number;
  unitCost?: string | number;
};

type StoredAiConfig = {
  apiUrl: string;
  model: string;
  apiKey: string;
};

type PrintTemplateSettings = {
  title?: string;
  paperWidthMm?: string;
  paperHeightMm?: string;
  marginMm?: string;
  customerLabel?: string;
  amountLabel?: string;
  customerFontSizePx?: string;
  amountFontSizePx?: string;
  titleFontSizePx?: string;
  qrImageUrl?: string;
  qrLabel?: string;
  qrSizeMm?: string;
  showMatrix?: boolean;
  extraContent?: string;
};

type FormattedCustomerOrder = {
  id: number;
  customer: string;
  orderNo: string;
  channel: string;
  orderDate: Date | string;
  note: string;
  status: "PENDING" | "SHIPPED";
  shippedAt?: Date | string | null;
  outboundOrderId?: number | null;
  createdAt: Date | string;
  amountDue: string;
  paidAmount: string;
  unpaidAmount: string;
  changeAmount: string;
  paymentWechat: string;
  paymentCash: string;
  paymentAlipay: string;
  paymentCard: string;
  paymentScan: string;
  paymentTransfer: string;
  items: Array<{
    id: number;
    skuId: number;
    quantity: number;
    unitPrice: string;
    styleNo: string;
    productName: string;
    color: string;
    size: string;
  }>;
};

const defaultPrintTemplate: Required<PrintTemplateSettings> = {
  title: "客户订单",
  paperWidthMm: "100",
  paperHeightMm: "100",
  marginMm: "3",
  customerLabel: "客户信息",
  amountLabel: "商品金额",
  customerFontSizePx: "48",
  amountFontSizePx: "44",
  titleFontSizePx: "20",
  qrImageUrl: "",
  qrLabel: "微信二维码",
  qrSizeMm: "24",
  showMatrix: true,
  extraContent: ""
};
const footerContactText = "电话：18698509889  永兴路52-1";

const orderRecognitionPrompt = `
# 订单识别提示词

请把订单图片或文字整理成表格数据，按以下规则输出：

1. 输出格式固定为四列：颜色、尺码、数量、款号。
2. 每个“颜色 + 尺码”单独一行，只输出数量大于 0 的项。
3. 数量识别规则（非常重要，务必严格执行）：
   - 当尺码后面紧跟 ✖️ / × / x / X / * 等乘号再跟一个数字 N 时，表示“该尺码的件数 = N”。例如：
     · 105✖️2 → 尺码 105（即 M）数量 2
     · 110×3  → 尺码 110（即 L）数量 3
     · 125x2  → 尺码 125（即 3XL）数量 2
   - 当尺码后面紧跟数字或中文数字 + “件 / 条 / 套 / 双”等量词时，量词前的数字就是件数。例如：
     · 185二件 → 尺码 185（即 3XL）数量 2
     · 170两件 → 尺码 170（即 L）数量 2
     · 180 3件 → 尺码 180（即 2XL）数量 3
     · 175一件 → 尺码 175（即 XL）数量 1
     中文数字对应：一/壹=1，二/两/贰=2，三/叁=3，四/肆=4，五/伍=5，六=6，七=7，八=8，九=9，十=10。
   - 当尺码后面没有任何数量标记（没有乘号也没有“件/条/套/双”等量词）时，该尺码记为 1 件。
   - 同一颜色出现多次相同尺码时（含拆分写在多行的情况），把所有数量相加合并为一行。
4. 颜色识别规则：
   - 一行如果只写颜色名（“白色”“黑色”“浅灰”等），它是后续若干行尺码列表的“当前颜色”，直到出现下一个颜色名或文本结束。
   - 颜色名前后可能有空格、换行、标点，请忽略并继续解析后面的尺码序列。
5. 不需要记录品名、商品描述、建议体重、单价、金额等信息。
6. 尺码统一换算为字母码：105 = 165 = M；110 = 170 = L；115 = 175 = XL；120 = 180 = 2XL；125 = 185 = 3XL；130 = 190 = 4XL；135 = 195 = 5XL。
7. 如果图片里是横向尺码表，请按颜色逐行读取各尺码数量，再转成竖向明细。
8. 如果同一款号、同一颜色、同一尺码出现多次，请合并数量。
9. 图片中的“共 xx”“合计 xx”只作为校验总数，不作为单独明细行。
10. 颜色名称按用户习惯统一：雾霾蓝 = 雾蓝。
11. 如果图片里款号是 7262，输出款号写成 T262。
12. 看不清的内容不要硬猜，在 notes 里标注不确定项。
13. 合计数只用于核对。如果表格明细相加与图片合计不一致，需要在 notes 里说明哪里可能看错。

# 完整示例 1（乘号 ✖️/× 写法）

输入：
2651
白色
105✖️2  125  110
115
黑色
105✖️4  125✖️2
110✖️3  115  130

正确解析（合并、换算、汇总后）：
- 白色 M ×2（来自 105✖️2）
- 白色 3XL ×1（来自 125）
- 白色 L ×1（来自 110）
- 白色 XL ×1（来自 115）
- 黑色 M ×4（来自 105✖️4）
- 黑色 3XL ×2（来自 125✖️2）
- 黑色 L ×3（来自 110✖️3）
- 黑色 XL ×1（来自 115）
- 黑色 4XL ×1（来自 130）
款号一律为 2651。白色合计 5，黑色合计 11，总计 16。

# 完整示例 2（“数字 + 件”、多颜色横排写法）

输入：
2608 枣红180 185二件 170二件 黑色190 175 棕色175 180 紫色190 185 草绿180 墨绿190 185

颜色解析顺序：枣红 → 黑色 → 棕色 → 紫色 → 草绿 → 墨绿，每个颜色名“接管”后续的尺码序列直到出现下一个颜色名。

正确解析：
- 枣红 2XL ×1（来自 180）
- 枣红 3XL ×2（来自 185二件）
- 枣红 L ×2（来自 170二件）
- 黑色 4XL ×1（来自 190）
- 黑色 XL ×1（来自 175）
- 棕色 XL ×1（来自 175）
- 棕色 2XL ×1（来自 180）
- 紫色 4XL ×1（来自 190）
- 紫色 3XL ×1（来自 185）
- 草绿 2XL ×1（来自 180）
- 墨绿 4XL ×1（来自 190）
- 墨绿 3XL ×1（来自 185）
款号一律为 2608。总计 14。
`.trim();

const asyncHandler =
  (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res, next).catch(next);

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  next();
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(value: unknown) {
  const normalized = text(value);
  return normalized ? normalized : null;
}

function positiveInt(value: unknown, field: string) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw Object.assign(new Error(`${field} 必须是大于 0 的整数`), { status: 400 });
  }
  return numberValue;
}

function decimalInput(value: unknown, field: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw Object.assign(new Error(`${field} 必须是非负数字`), { status: 400 });
  }
  return new Prisma.Decimal(numberValue.toFixed(2));
}

function orderItems(body: any) {
  const rawItems = Array.isArray(body.items) ? body.items : body.item ? [body.item] : [];
  if (!rawItems.length) {
    throw Object.assign(new Error("至少需要一条商品明细"), { status: 400 });
  }
  return rawItems;
}

function paymentSnapshot(body: any, amountDue: Prisma.Decimal) {
  const paymentWechat = decimalInput(body.paymentWechat ?? 0, "微信收款");
  const paymentCash = decimalInput(body.paymentCash ?? 0, "现金收款");
  const paymentAlipay = decimalInput(body.paymentAlipay ?? 0, "支付宝收款");
  const paymentCard = decimalInput(body.paymentCard ?? 0, "刷卡收款");
  const paymentScan = decimalInput(body.paymentScan ?? 0, "扫码付收款");
  const paymentTransfer = decimalInput(body.paymentTransfer ?? 0, "汇款收款");
  const paidAmount = paymentWechat.plus(paymentCash).plus(paymentAlipay).plus(paymentCard).plus(paymentScan).plus(paymentTransfer);
  return {
    amountDue,
    paidAmount,
    unpaidAmount: Prisma.Decimal.max(amountDue.minus(paidAmount), new Prisma.Decimal(0)),
    changeAmount: Prisma.Decimal.max(paidAmount.minus(amountDue), new Prisma.Decimal(0)),
    paymentWechat,
    paymentCash,
    paymentAlipay,
    paymentCard,
    paymentScan,
    paymentTransfer
  };
}

function cleanBaseUrl(value: unknown) {
  const apiUrl = text(value);
  if (!apiUrl) {
    throw Object.assign(new Error("API 地址必填"), { status: 400 });
  }
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol");
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (normalizedPath === "" || normalizedPath === "/v1") {
      url.pathname = `${normalizedPath || "/v1"}/chat/completions`;
    }
    return url.toString();
  } catch {
    throw Object.assign(new Error("API 地址格式不正确"), { status: 400 });
  }
}

function extractJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || content;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw Object.assign(new Error("AI 返回内容不是有效 JSON"), { status: 502 });
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw Object.assign(new Error("AI 返回内容无法解析为 JSON，请确认模型支持按 JSON 输出"), { status: 502 });
  }
}

export function normalizeRecognizedSize(value: string) {
  const normalized = value.toUpperCase().replace(/\s+/g, "");
  const sizeMap: Record<string, string> = {
    "105": "M",
    "165": "M",
    M: "M",
    "110": "L",
    "170": "L",
    L: "L",
    "115": "XL",
    "175": "XL",
    XL: "XL",
    "120": "2XL",
    "180": "2XL",
    XXL: "2XL",
    "2XL": "2XL",
    "125": "3XL",
    "185": "3XL",
    XXXL: "3XL",
    "3XL": "3XL",
    "130": "4XL",
    "190": "4XL",
    XXXXL: "4XL",
    "4XL": "4XL",
    "135": "5XL",
    "195": "5XL",
    XXXXXL: "5XL",
    "5XL": "5XL"
  };
  return sizeMap[normalized] || value;
}

export function normalizeRecognizedColor(value: string) {
  return value.replace(/雾霾蓝/g, "雾蓝");
}

export function normalizeRecognizedStyleNo(value: string) {
  return value === "7262" ? "T262" : value;
}

// 兼容 AI 返回的数量既可能是数字（2）也可能是字符串（"2"）。
// 旧实现用 text() 处理，数字类型会被当成非字符串丢弃，导致数量全部回退成 1。
export function parseQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 1; // 模型没给数量时默认 1 件
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : NaN;
  }
  // undefined / null / 其它类型：视为未提供，默认 1 件
  if (value === undefined || value === null) return 1;
  return NaN;
}

// 单价同样兼容数字和字符串；空/未提供返回 undefined。
function parseUnitCost(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  const trimmed = text(value);
  return trimmed ? trimmed : undefined;
}

export function normalizeRecognizedItems(value: unknown): RecognizedInboundItem[] {
  const payload = value as { items?: unknown };
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  return rawItems.flatMap((item) => {
    const row = item as Record<string, unknown>;
    const color = normalizeRecognizedColor(text(row.color));
    const size = normalizeRecognizedSize(text(row.size));
    const quantity = parseQuantity(row.quantity);
    if (!color || !size || !Number.isInteger(quantity) || quantity <= 0) return [];
    return [
      {
        styleNo: optionalText(row.styleNo) ? normalizeRecognizedStyleNo(text(row.styleNo)) : undefined,
        productName: optionalText(row.productName) ?? undefined,
        supplier: optionalText(row.supplier) ?? undefined,
        color,
        size,
        quantity,
        unitCost: parseUnitCost(row.unitCost)
      }
    ];
  });
}

export function extractDefaultQuantityItemsFromText(
  value: string,
  context: { productName?: string; supplier?: string } = {}
): RecognizedInboundItem[] {
  const itemsByKey = new Map<string, RecognizedInboundItem>();
  const pattern =
    /([A-Za-z]?\d{3,5})\s*[-_/]?\s*([\u4e00-\u9fa5]{1,12}?)(105|110|115|120|125|130|135|165|170|175|180|185|190|195|5XL|4XL|3XL|2XL|XXXL|XXL|XL|L|M)(?=$|[^\dA-Za-z])/gi;

  for (const match of value.matchAll(pattern)) {
    const styleNo = normalizeRecognizedStyleNo(text(match[1]));
    const color = normalizeRecognizedColor(text(match[2]));
    const size = normalizeRecognizedSize(text(match[3]));
    if (!styleNo || !color || !size) continue;

    const key = `${styleNo}|${color}|${size}`;
    const existing = itemsByKey.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    const item: RecognizedInboundItem = {
      styleNo,
      color,
      size,
      quantity: 1
    };
    const productName = optionalText(context.productName);
    const supplier = optionalText(context.supplier);
    if (productName) item.productName = productName;
    if (supplier) item.supplier = supplier;
    itemsByKey.set(key, item);
  }

  return Array.from(itemsByKey.values());
}

function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aiKeySecret, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    apiKeyCipher: encrypted.toString("base64"),
    apiKeyIv: iv.toString("base64"),
    apiKeyAuthTag: cipher.getAuthTag().toString("base64")
  };
}

function decryptSecret(config: { apiKeyCipher: string; apiKeyIv: string; apiKeyAuthTag: string }) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", aiKeySecret, Buffer.from(config.apiKeyIv, "base64"));
  decipher.setAuthTag(Buffer.from(config.apiKeyAuthTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(config.apiKeyCipher, "base64")), decipher.final()]).toString("utf8");
}

async function getStoredAiConfig(userId: number): Promise<StoredAiConfig> {
  const config = await prisma.userAiConfig.findUnique({ where: { userId } });
  if (!config) {
    throw Object.assign(new Error("请先保存 AI API 配置"), { status: 400 });
  }
  return {
    apiUrl: config.apiUrl,
    model: config.model,
    apiKey: decryptSecret(config)
  };
}

function formatSku(sku: any) {
  const soldQuantity = Array.isArray(sku.outboundItems)
    ? sku.outboundItems.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0)
    : 0;
  const supplier = sku.product.supplier || (Array.isArray(sku.inboundItems) ? sku.inboundItems[0]?.inboundOrder?.supplier ?? "" : "");

  return {
    id: sku.id,
    productId: sku.productId,
    styleNo: sku.product.styleNo,
    productName: sku.product.name,
    supplier,
    category: sku.product.category,
    brand: sku.product.brand,
    color: sku.color,
    size: sku.size,
    barcode: sku.barcode,
    retailPrice: sku.retailPrice?.toString() ?? "",
    isActive: sku.isActive,
    quantity: sku.inventoryBalance?.quantity ?? 0,
    soldQuantity,
    updatedAt: sku.updatedAt
  };
}

async function findOrCreateSku(payload: any, tx: Prisma.TransactionClient) {
  if (payload.skuId) {
    const sku = await tx.sku.findUnique({ where: { id: Number(payload.skuId) } });
    if (!sku) {
      throw Object.assign(new Error("SKU 不存在"), { status: 404 });
    }
    return sku.id;
  }

  const styleNo = text(payload.styleNo);
  const productName = text(payload.productName);
  const color = text(payload.color);
  const size = text(payload.size);

  if (!styleNo || !productName || !color || !size) {
    throw Object.assign(new Error("创建 SKU 需要款号、商品名称、颜色和尺码"), { status: 400 });
  }

  const product = await tx.product.upsert({
    where: { styleNo },
    create: {
      styleNo,
      name: productName,
      supplier: optionalText(payload.supplier),
      category: optionalText(payload.category),
      brand: optionalText(payload.brand),
      note: optionalText(payload.productNote)
    },
    update: {
      name: productName,
      supplier: optionalText(payload.supplier) ?? undefined,
      category: optionalText(payload.category),
      brand: optionalText(payload.brand),
      note: optionalText(payload.productNote)
    }
  });

  const retailPrice =
    payload.retailPrice === undefined || payload.retailPrice === "" ? null : decimalInput(payload.retailPrice, "零售价");

  const sku = await tx.sku.upsert({
    where: {
      productId_color_size: {
        productId: product.id,
        color,
        size
      }
    },
    create: {
      productId: product.id,
      color,
      size,
      barcode: optionalText(payload.barcode),
      retailPrice
    },
    update: {
      barcode: optionalText(payload.barcode),
      retailPrice: retailPrice ?? undefined,
      isActive: true
    }
  });

  await tx.inventoryBalance.upsert({
    where: { skuId: sku.id },
    create: { skuId: sku.id, quantity: 0 },
    update: {}
  });

  return sku.id;
}

async function adjustStock(
  tx: Prisma.TransactionClient,
  skuId: number,
  quantityChange: number,
  type: MovementType,
  orderId: number | null,
  operatorId?: number
) {
  const balance = await tx.inventoryBalance.upsert({
    where: { skuId },
    create: { skuId, quantity: quantityChange },
    update: { quantity: { increment: quantityChange } }
  });

  await tx.stockMovement.create({
    data: {
      skuId,
      type,
      quantityChange,
      balanceAfter: balance.quantity,
      inboundOrderId: type === "INBOUND" ? orderId : null,
      outboundOrderId: type === "OUTBOUND" ? orderId : null,
      operatorId: operatorId ?? null
    }
  });
}

function formatCustomerOrder(order: any) {
  const itemAmount = order.items.reduce(
    (sum: number, item: any) => sum + item.quantity * Number(item.unitPrice?.toString?.() ?? item.unitPrice ?? 0),
    0
  );
  const amountDue = Number(order.amountDue?.toString?.() ?? order.amountDue ?? 0) > 0 ? decimalToString(order.amountDue) : itemAmount.toFixed(2);
  return {
    id: order.id,
    customer: order.customer,
    customerId: order.customerId ?? null,
    orderNo: order.orderNo ?? "",
    channel: order.channel ?? "",
    orderDate: order.orderDate,
    note: order.note ?? "",
    status: order.status,
    shippedAt: order.shippedAt,
    printedAt: order.printedAt ?? null,
    outboundOrderId: order.outboundOrderId,
    createdAt: order.createdAt,
    amountDue,
    paidAmount: decimalToString(order.paidAmount) || "0",
    unpaidAmount: decimalToString(order.unpaidAmount) || "0",
    changeAmount: decimalToString(order.changeAmount) || "0",
    paymentWechat: decimalToString(order.paymentWechat) || "0",
    paymentCash: decimalToString(order.paymentCash) || "0",
    paymentAlipay: decimalToString(order.paymentAlipay) || "0",
    paymentCard: decimalToString(order.paymentCard) || "0",
    paymentScan: decimalToString(order.paymentScan) || "0",
    paymentTransfer: decimalToString(order.paymentTransfer) || "0",
    items: order.items.map((item: any) => ({
      id: item.id,
      skuId: item.skuId,
      quantity: item.quantity,
      unitPrice: item.unitPrice?.toString?.() ?? String(item.unitPrice),
      styleNo: item.sku.product.styleNo,
      productName: item.sku.product.name,
      color: item.sku.color,
      size: item.sku.size
    }))
  };
}

function decimalToString(value: unknown) {
  return value && typeof (value as { toString?: () => string }).toString === "function" ? (value as { toString: () => string }).toString() : "";
}

function mmToPt(value: number) {
  return (value * 72) / 25.4;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function firstExistingPath(paths: string[]) {
  return paths.find((candidate) => fs.existsSync(candidate)) || "";
}

function pdfFontPath() {
  return firstExistingPath([
    process.env.PDF_FONT_PATH || "",
    path.resolve(__dirname, "../../server/assets/fonts/simhei.ttf"),
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc"
  ]);
}

function normalizePrintTemplate(value: unknown): Required<PrintTemplateSettings> {
  const input = (value && typeof value === "object" ? value : {}) as PrintTemplateSettings;
  return {
    ...defaultPrintTemplate,
    ...input,
    showMatrix: input.showMatrix === false ? false : true
  };
}

function formatMoney(value: number) {
  return value.toFixed(2).replace(/\.00$/, "");
}

function stripBuiltInFooterContact(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("18698509889") && !line.includes("永兴路52-1"))
    .join("\n");
}

function fitPdfFontSize(doc: PDFKit.PDFDocument, text: string, maxSize: number, minSize: number, width: number) {
  let size = maxSize;
  while (size > minSize) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= width) return size;
    size -= 1;
  }
  return minSize;
}

function formatShanghaiDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(new Date(value));
}

function formatShanghaiDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

const sizeOrder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "XXXXL", "4XL", "5XL"];

function compareSizes(a: string, b: string) {
  const numberA = Number(a);
  const numberB = Number(b);
  if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB;

  const orderA = sizeOrder.indexOf(a.toUpperCase());
  const orderB = sizeOrder.indexOf(b.toUpperCase());
  if (orderA >= 0 && orderB >= 0) return orderA - orderB;
  if (orderA >= 0) return -1;
  if (orderB >= 0) return 1;
  return a.localeCompare(b, "zh-CN", { numeric: true });
}

function customerOrderMatrix(order: FormattedCustomerOrder) {
  const sizeSet = new Set<string>();
  const rows = new Map<
    string,
    {
      styleNo: string;
      productName: string;
      color: string;
      unitPrice: string;
      sizes: Record<string, number>;
      total: number;
      subtotal: number;
    }
  >();

  for (const item of order.items) {
    sizeSet.add(item.size);
    const key = [item.styleNo, item.productName, item.color, item.unitPrice].join("::");
    const row =
      rows.get(key) ||
      ({
        styleNo: item.styleNo,
        productName: item.productName,
        color: item.color,
        unitPrice: item.unitPrice,
        sizes: {} as Record<string, number>,
        total: 0,
        subtotal: 0
      } satisfies {
        styleNo: string;
        productName: string;
        color: string;
        unitPrice: string;
        sizes: Record<string, number>;
        total: number;
        subtotal: number;
      });
    row.sizes[item.size] = (row.sizes[item.size] || 0) + item.quantity;
    row.total += item.quantity;
    row.subtotal += item.quantity * Number(item.unitPrice || 0);
    rows.set(key, row);
  }

  const sizes = Array.from(sizeSet).sort(compareSizes);
  const matrixRows = Array.from(rows.values()).sort((a, b) => {
    const style = a.styleNo.localeCompare(b.styleNo, "zh-CN", { numeric: true });
    return style || a.color.localeCompare(b.color, "zh-CN", { numeric: true });
  });
  const sizeTotals = Object.fromEntries(sizes.map((size) => [size, matrixRows.reduce((sum, row) => sum + (row.sizes[size] || 0), 0)]));
  const total = matrixRows.reduce((sum, row) => sum + row.total, 0);
  return { sizes, rows: matrixRows, sizeTotals, total };
}

type PdfLayout = {
  template: ReturnType<typeof normalizePrintTemplate>;
  paperWidth: number;
  paperHeight: number;
  margin: number;
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  compact: boolean;
  fontPath: string | null;
};

function buildPdfLayout(templateInput: unknown): PdfLayout {
  const template = normalizePrintTemplate(templateInput);
  const paperWidth = clampNumber(template.paperWidthMm, Number(defaultPrintTemplate.paperWidthMm), 40, 420);
  const paperHeight = clampNumber(template.paperHeightMm, Number(defaultPrintTemplate.paperHeightMm), 30, 420);
  const margin = mmToPt(clampNumber(template.marginMm, Number(defaultPrintTemplate.marginMm), 0, 30));
  const pageWidth = mmToPt(paperWidth);
  const pageHeight = mmToPt(paperHeight);
  const contentWidth = pageWidth - margin * 2;
  const compact = paperWidth <= 120 || paperHeight <= 90;
  const fontPath = pdfFontPath();
  return { template, paperWidth, paperHeight, margin, pageWidth, pageHeight, contentWidth, compact, fontPath };
}

// 在已创建的文档上绘制单张订单的内容（不创建文档、不结束文档、不负责翻页到下一单）
function drawCustomerOrderToDoc(doc: PDFKit.PDFDocument, order: FormattedCustomerOrder, layout: PdfLayout) {
  const { template, paperWidth, paperHeight, margin, pageWidth, pageHeight, contentWidth, compact, fontPath } = layout;
  const matrix = customerOrderMatrix(order);
  const orderAmount = Number(order.amountDue || 0);

  if (fontPath) doc.font("cn");

  const titleFontSize = clampNumber(template.titleFontSizePx, compact ? 17 : 24, 10, 96);
  const customerFontSize = clampNumber(template.customerFontSizePx, compact ? 28 : 42, 12, 120);
  const amountFontSize = clampNumber(template.amountFontSizePx, compact ? 26 : 38, 12, 120);
  const qrSize = mmToPt(clampNumber(template.qrSizeMm, Number(defaultPrintTemplate.qrSizeMm), 12, 80));
  const bodySize = compact ? 8 : 10;
  const leftWidth = Math.max(80, contentWidth - qrSize - 12);
  const top = margin;
  const footerReserved = compact ? 18 : 24;
  const tableBottomY = () => pageHeight - margin - footerReserved;
  const drawPdfFooter = () => {
    const watermarkWidth = Math.min(contentWidth * 0.62, mmToPt(58));
    const watermarkX = pageWidth - margin - watermarkWidth;
    const watermarkY = pageHeight - margin - (compact ? 15 : 19);
    doc
      .fontSize(compact ? 6 : 7)
      .fillColor("#111827")
      .opacity(0.9)
      .text(`打印时间：${formatShanghaiDateTime(new Date())}`, watermarkX, watermarkY, {
        width: watermarkWidth,
        height: compact ? 7 : 8,
        align: "right",
        lineBreak: false
      });
    doc.text(`合计数量：${matrix.total}  订单金额：${formatMoney(orderAmount)}`, watermarkX, watermarkY + (compact ? 7 : 8), {
      width: watermarkWidth,
      height: compact ? 7 : 8,
      align: "right",
      lineBreak: false
    });
    doc
      .opacity(1)
      .fontSize(compact ? 8 : 10)
      .fillColor("#111827")
      .text(footerContactText, margin, pageHeight - margin - (compact ? 6 : 8), {
        width: contentWidth,
        height: compact ? 8 : 10,
        align: "center",
        lineBreak: false
      });
  };

  doc.fontSize(titleFontSize).fillColor("#111827").text(template.title || defaultPrintTemplate.title, margin, top, { width: leftWidth, align: "center", lineBreak: false });
  let y = top + titleFontSize + (compact ? 1 : 3);
  const heroIndent = compact ? 4 : 8;
  const heroGap = compact ? 8 : 14;
  const heroColWidth = (leftWidth - heroGap) / 2;
  const amountX = margin + heroColWidth + heroGap;
  doc.fontSize(compact ? 7 : 9).fillColor("#4b5563").text(template.customerLabel || defaultPrintTemplate.customerLabel, margin, y, { width: heroColWidth, lineBreak: false });
  doc.text(template.amountLabel || defaultPrintTemplate.amountLabel, amountX, y, { width: heroColWidth, lineBreak: false });
  y += compact ? 7 : 9;
  const heroTextWidth = heroColWidth - heroIndent;
  const fittedCustomerFontSize = fitPdfFontSize(doc, order.customer, customerFontSize, compact ? 16 : 20, heroTextWidth);
  const fittedAmountFontSize = fitPdfFontSize(doc, formatMoney(orderAmount), amountFontSize, compact ? 16 : 20, heroTextWidth);
  doc.fontSize(fittedCustomerFontSize).fillColor("#111827").text(order.customer, margin + heroIndent, y, { width: heroTextWidth, lineGap: 0, lineBreak: false });
  doc.fontSize(fittedAmountFontSize).fillColor("#111827").text(formatMoney(orderAmount), amountX + heroIndent, y, { width: heroTextWidth, lineGap: 0, lineBreak: false });
  const heroBottom = y + Math.max(fittedCustomerFontSize, fittedAmountFontSize);

  const sideX = pageWidth - margin - qrSize;
  doc.rect(sideX, top, qrSize, qrSize).strokeColor("#111827").stroke();
  if (template.qrImageUrl?.startsWith("data:image/")) {
    const [, base64 = ""] = template.qrImageUrl.split(",");
    try {
      doc.image(Buffer.from(base64, "base64"), sideX + 1, top + 1, {
        cover: [qrSize - 2, qrSize - 2],
        align: "center",
        valign: "center"
      });
    } catch {
      doc.fontSize(compact ? 7 : 8).fillColor("#6b7280").text(template.qrLabel, sideX + 4, top + qrSize / 2 - 8, { width: qrSize - 8, align: "center" });
    }
  } else {
    doc.fontSize(compact ? 7 : 8).fillColor("#6b7280").text(template.qrLabel, sideX + 4, top + qrSize / 2 - 8, { width: qrSize - 8, align: "center" });
  }
  doc.fontSize(compact ? 7 : 8).fillColor("#111827").text(template.qrLabel, sideX, top + qrSize + 3, { width: qrSize, align: "center" });

  const metaY = Math.max(heroBottom + (compact ? 3 : 5), top + qrSize + (compact ? 11 : 15));
  doc.moveTo(margin, metaY).lineTo(pageWidth - margin, metaY).strokeColor("#111827").lineWidth(1).stroke();
  doc.fontSize(bodySize).fillColor("#111827");
  let tableY = metaY + (compact ? 5 : 8);
  const extraContent = stripBuiltInFooterContact(template.extraContent);
  if (extraContent) {
    doc.text(extraContent, margin, tableY, { width: contentWidth });
    tableY += compact ? 18 : 24;
  }

  if (template.showMatrix) {
    const headers = ["款号", "商品", "颜色", ...matrix.sizes, "SKU数量", "商品单价", "小计"];
    const rowHeight = compact ? 14 : 17;
    const tableFontSize = compact ? 6.4 : 7.6;
    const columnDefs = [
      { weight: 1.2, align: "center" as const },
      { weight: 1.45, align: "left" as const },
      { weight: 1.15, align: "center" as const },
      ...matrix.sizes.map(() => ({ weight: 0.82, align: "center" as const })),
      { weight: 1.15, align: "center" as const },
      { weight: 1.2, align: "center" as const },
      { weight: 1.1, align: "center" as const }
    ];
    const totalColumnWeight = columnDefs.reduce((sum, column) => sum + column.weight, 0);
    const columns = columnDefs.map((column) => ({
      width: (contentWidth * column.weight) / totalColumnWeight,
      align: column.align
    }));
    const drawRow = (values: Array<string | number>, rowY: number, fill?: string) => {
      let x = margin;
      values.forEach((value, index) => {
        const column = columns[index] || columns[columns.length - 1];
        const text = String(value || "-");
        const textX = x + 1.5;
        const textY = rowY + 3.5;
        const textOptions = {
          width: column.width - 3,
          height: rowHeight - 4,
          ellipsis: true,
          align: column.align
        };
        if (fill) doc.rect(x, rowY, column.width, rowHeight).fillAndStroke(fill, "#2f3a45");
        else doc.rect(x, rowY, column.width, rowHeight).strokeColor("#2f3a45").stroke();
        doc.fillColor("#111827").fontSize(tableFontSize).text(text, textX, textY, textOptions);
        doc.text(text, textX + 0.18, textY, textOptions);
        x += column.width;
      });
    };
    const drawHeader = () => {
      drawRow(headers, tableY, "#eef2f5");
      tableY += rowHeight;
    };
    drawHeader();
    for (const row of matrix.rows) {
      if (tableY + rowHeight > tableBottomY()) {
        drawPdfFooter();
        doc.addPage({ size: [pageWidth, pageHeight], margin });
        if (fontPath) doc.font("cn");
        tableY = margin;
        drawHeader();
      }
      drawRow(
        [
          row.styleNo,
          row.productName,
          row.color,
          ...matrix.sizes.map((size) => row.sizes[size] || ""),
          row.total,
          formatMoney(Number(row.unitPrice || 0)),
          formatMoney(row.subtotal)
        ],
        tableY
      );
      tableY += rowHeight;
    }
    if (tableY + rowHeight > tableBottomY()) {
      drawPdfFooter();
      doc.addPage({ size: [pageWidth, pageHeight], margin });
      if (fontPath) doc.font("cn");
      tableY = margin;
      drawHeader();
    }
    drawRow(["合计", "", "", ...matrix.sizes.map((size) => matrix.sizeTotals[size] || ""), matrix.total, "", formatMoney(orderAmount)], tableY, "#fff7dc");
    tableY += rowHeight + 6;
  }

  drawPdfFooter();
}

function collectPdfBuffer(doc: PDFKit.PDFDocument) {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

async function customerOrderPdfBuffer(order: FormattedCustomerOrder, templateInput: unknown) {
  const layout = buildPdfLayout(templateInput);
  const doc = new PDFDocument({ size: [layout.pageWidth, layout.pageHeight], margin: layout.margin, autoFirstPage: true });
  if (layout.fontPath) doc.registerFont("cn", layout.fontPath);
  const done = collectPdfBuffer(doc);
  drawCustomerOrderToDoc(doc, order, layout);
  doc.end();
  return done;
}

// 多张订单合成一个 PDF：每张订单从新的一页开始
async function customerOrdersPdfBuffer(orders: FormattedCustomerOrder[], templateInput: unknown) {
  const layout = buildPdfLayout(templateInput);
  const doc = new PDFDocument({ size: [layout.pageWidth, layout.pageHeight], margin: layout.margin, autoFirstPage: true });
  if (layout.fontPath) doc.registerFont("cn", layout.fontPath);
  const done = collectPdfBuffer(doc);
  orders.forEach((order, index) => {
    if (index > 0) doc.addPage({ size: [layout.pageWidth, layout.pageHeight], margin: layout.margin });
    drawCustomerOrderToDoc(doc, order, layout);
  });
  doc.end();
  return done;
}

function formatOrderSku(sku: any) {
  return {
    id: sku.id,
    productId: sku.productId,
    styleNo: sku.product.styleNo,
    productName: sku.product.name,
    supplier: sku.product.supplier ?? "",
    category: sku.product.category ?? "",
    brand: sku.product.brand ?? "",
    color: sku.color,
    size: sku.size,
    barcode: sku.barcode ?? "",
    retailPrice: sku.retailPrice?.toString() ?? "",
    isActive: sku.isActive
  };
}

async function createOutboundShipment(
  tx: Prisma.TransactionClient,
  payload: {
    customer: string;
    channel?: string | null;
    outboundDate?: string;
    note?: string | null;
    items: Array<{ skuId: number; quantity: number; unitPrice: Prisma.Decimal }>;
  },
  operatorId?: number
) {
  const created = await tx.outboundOrder.create({
    data: {
      customer: payload.customer,
      channel: payload.channel,
      outboundDate: payload.outboundDate ? new Date(payload.outboundDate) : new Date(),
      note: payload.note,
      items: { create: payload.items }
    },
    include: { items: true }
  });

  for (const item of payload.items) {
    await adjustStock(tx, item.skuId, -item.quantity, "OUTBOUND", created.id, operatorId);
  }

  return created;
}

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const username = text(req.body.username);
    const password = text(req.body.password);
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: "用户名或密码错误" });
      return;
    }

    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username });
  })
);

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("fashion.sid");
    res.json({ ok: true });
  });
});

app.get(
  "/api/auth/me",
  asyncHandler(async (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ error: "请先登录" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    res.json(user ? { id: user.id, username: user.username } : null);
  })
);

app.get(
  "/api/healthz",
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: "up", time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, db: "down", time: new Date().toISOString() });
    }
  })
);

app.use("/api", requireAuth);

function validatePassword(value: unknown) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 4) {
    throw Object.assign(new Error("密码至少需要 4 位"), { status: 400 });
  }
  return password;
}

app.get(
  "/api/users",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, createdAt: true },
      orderBy: { id: "asc" }
    });
    res.json(users);
  })
);

app.post(
  "/api/users",
  asyncHandler(async (req, res) => {
    const username = text(req.body.username);
    if (!username) {
      res.status(400).json({ error: "用户名必填" });
      return;
    }
    const password = validatePassword(req.body.password);
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ error: "用户名已存在" });
      return;
    }
    const user = await prisma.user.create({
      data: { username, passwordHash: await bcrypt.hash(password, 10) },
      select: { id: true, username: true, createdAt: true }
    });
    res.status(201).json(user);
  })
);

app.post(
  "/api/users/:id/password",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const password = validatePassword(req.body.password);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: "用户不存在" });
      return;
    }
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) }
    });
    res.json({ id: user.id, username: user.username });
  })
);

app.delete(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.session.userId) {
      res.status(400).json({ error: "不能删除当前登录的账号" });
      return;
    }
    const total = await prisma.user.count();
    if (total <= 1) {
      res.status(400).json({ error: "至少保留一个账号" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: "用户不存在" });
      return;
    }
    await prisma.user.delete({ where: { id } });
    res.json({ id });
  })
);

app.get(
  "/api/backup/export",
  asyncHandler(async (req, res) => {
    const [products, skuRecords, inboundOrders, outboundOrders, customerOrders, movements, user] = await Promise.all([
      prisma.product.findMany({
        include: { skus: { include: { inventoryBalance: true } } },
        orderBy: { styleNo: "asc" }
      }),
      prisma.sku.findMany({
        include: { product: true, inventoryBalance: true, outboundItems: { select: { quantity: true } } },
        orderBy: [{ product: { styleNo: "asc" } }, { color: "asc" }, { size: "asc" }]
      }),
      prisma.inboundOrder.findMany({
        include: { items: { include: { sku: { include: { product: true } } } } },
        orderBy: { createdAt: "desc" }
      }),
      prisma.outboundOrder.findMany({
        include: { items: { include: { sku: { include: { product: true } } } } },
        orderBy: { createdAt: "desc" }
      }),
      prisma.customerOrder.findMany({
        include: { items: { include: { sku: { include: { product: true } } } } },
        orderBy: { createdAt: "desc" }
      }),
      prisma.stockMovement.findMany({
        include: {
          sku: { include: { product: true } },
          operator: { select: { username: true } }
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.user.findUnique({ where: { id: req.session.userId! } })
    ]);

    const skuSnapshot = skuRecords.map((sku) => {
      const soldQuantity = sku.outboundItems.reduce((sum, item) => sum + item.quantity, 0);
      return {
        id: sku.id,
        productId: sku.productId,
        styleNo: sku.product.styleNo,
        productName: sku.product.name,
        supplier: sku.product.supplier ?? "",
        category: sku.product.category ?? "",
        brand: sku.product.brand ?? "",
        color: sku.color,
        size: sku.size,
        barcode: sku.barcode ?? "",
        retailPrice: sku.retailPrice?.toString() ?? "",
        isActive: sku.isActive,
        quantity: sku.inventoryBalance?.quantity ?? 0,
        soldQuantity,
        createdAt: sku.createdAt,
        updatedAt: sku.updatedAt
      };
    });
    const payload = {
      schemaVersion: "fashion-inventory-backup/v1",
      exportedAt: new Date().toISOString(),
      exportedBy: user?.username ?? "",
      source: {
        app: "dooker-fashion-inventory",
        database: "postgresql"
      },
      counts: {
        products: products.length,
        skus: skuSnapshot.length,
        inboundOrders: inboundOrders.length,
        outboundOrders: outboundOrders.length,
        customerOrders: customerOrders.length,
        stockMovements: movements.length
      },
      inventory: {
        totalQuantity: skuSnapshot.reduce((sum, sku) => sum + sku.quantity, 0),
        totalSoldQuantity: skuSnapshot.reduce((sum, sku) => sum + sku.soldQuantity, 0),
        negativeSkuCount: skuSnapshot.filter((sku) => sku.quantity < 0).length,
        skus: skuSnapshot
      },
      catalog: {
        products: products.map((product) => ({
          id: product.id,
          styleNo: product.styleNo,
          name: product.name,
          supplier: product.supplier ?? "",
          category: product.category ?? "",
          brand: product.brand ?? "",
          note: product.note ?? "",
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          skus: product.skus.map((sku) => ({
            id: sku.id,
            productId: sku.productId,
            color: sku.color,
            size: sku.size,
            barcode: sku.barcode ?? "",
            retailPrice: sku.retailPrice?.toString() ?? "",
            isActive: sku.isActive,
            quantity: sku.inventoryBalance?.quantity ?? 0,
            createdAt: sku.createdAt,
            updatedAt: sku.updatedAt
          }))
        }))
      },
      orders: {
        inbound: inboundOrders.map((order) => ({
          id: order.id,
          supplier: order.supplier,
          inboundDate: order.inboundDate,
          note: order.note ?? "",
          createdAt: order.createdAt,
          items: order.items.map((item) => ({
            id: item.id,
            skuId: item.skuId,
            quantity: item.quantity,
            unitCost: decimalToString(item.unitCost),
            sku: formatOrderSku(item.sku)
          }))
        })),
        outbound: outboundOrders.map((order) => ({
          id: order.id,
          customer: order.customer,
          channel: order.channel ?? "",
          outboundDate: order.outboundDate,
          note: order.note ?? "",
          createdAt: order.createdAt,
          items: order.items.map((item) => ({
            id: item.id,
            skuId: item.skuId,
            quantity: item.quantity,
            unitPrice: decimalToString(item.unitPrice),
            sku: formatOrderSku(item.sku)
          }))
        })),
        customer: customerOrders.map(formatCustomerOrder)
      },
      stockMovements: movements.map((movement) => ({
        id: movement.id,
        skuId: movement.skuId,
        type: movement.type,
        quantityChange: movement.quantityChange,
        balanceAfter: movement.balanceAfter,
        inboundOrderId: movement.inboundOrderId,
        outboundOrderId: movement.outboundOrderId,
        operator: movement.operator?.username ?? "",
        createdAt: movement.createdAt,
        sku: formatOrderSku(movement.sku)
      }))
    };

    const filename = `fashion-inventory-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(payload);
  })
);

app.get(
  "/api/products",
  asyncHandler(async (req, res) => {
    const q = text(req.query.q);
    const products = await prisma.product.findMany({
      where: q
        ? {
            OR: [
              { styleNo: { contains: q } },
              { name: { contains: q } },
              { supplier: { contains: q } },
              { category: { contains: q } },
              { brand: { contains: q } }
            ]
          }
        : undefined,
      orderBy: { updatedAt: "desc" }
    });
    res.json(products);
  })
);

app.post(
  "/api/products",
  asyncHandler(async (req, res) => {
    const styleNo = text(req.body.styleNo);
    const name = text(req.body.name);
    if (!styleNo || !name) {
      res.status(400).json({ error: "款号和商品名称必填" });
      return;
    }
    const product = await prisma.product.create({
      data: {
        styleNo,
        name,
        supplier: optionalText(req.body.supplier),
        category: optionalText(req.body.category),
        brand: optionalText(req.body.brand),
        note: optionalText(req.body.note)
      }
    });
    res.status(201).json(product);
  })
);

app.patch(
  "/api/products/:id",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.update({
      where: { id: Number(req.params.id) },
      data: {
        name: text(req.body.name),
        supplier: optionalText(req.body.supplier),
        category: optionalText(req.body.category),
        brand: optionalText(req.body.brand),
        note: optionalText(req.body.note)
      }
    });
    res.json(product);
  })
);

app.get(
  "/api/skus",
  asyncHandler(async (req, res) => {
    const q = text(req.query.q);
    const skus = await prisma.sku.findMany({
      where: q
        ? {
            OR: [
              { color: { contains: q } },
              { size: { contains: q } },
              { barcode: { contains: q } },
              { product: { styleNo: { contains: q } } },
              { product: { name: { contains: q } } }
            ]
          }
        : undefined,
      include: skuInclude,
      orderBy: { updatedAt: "desc" }
    });
    res.json(skus.map(formatSku));
  })
);

app.post(
  "/api/skus",
  asyncHandler(async (req, res) => {
    const sku = await prisma.$transaction(async (tx) => {
      const skuId = await findOrCreateSku(req.body, tx);
      return tx.sku.findUniqueOrThrow({
        where: { id: skuId },
        include: skuInclude
      });
    });
    res.status(201).json(formatSku(sku));
  })
);

app.patch(
  "/api/skus/:id",
  asyncHandler(async (req, res) => {
    const sku = await prisma.sku.update({
      where: { id: Number(req.params.id) },
      data: {
        color: text(req.body.color),
        size: text(req.body.size),
        barcode: optionalText(req.body.barcode),
        retailPrice: req.body.retailPrice === "" ? null : decimalInput(req.body.retailPrice, "零售价"),
        isActive: Boolean(req.body.isActive)
      },
      include: { product: true, inventoryBalance: true }
    });
    res.json(formatSku(sku));
  })
);

app.get(
  "/api/inventory",
  asyncHandler(async (req, res) => {
    const q = text(req.query.q);
    const skus = await prisma.sku.findMany({
      where: q
        ? {
            OR: [
              { color: { contains: q } },
              { size: { contains: q } },
              { product: { styleNo: { contains: q } } },
              { product: { name: { contains: q } } }
            ]
          }
        : undefined,
      include: skuInclude,
      orderBy: [{ product: { styleNo: "asc" } }, { color: "asc" }, { size: "asc" }]
    });
    res.json(skus.map(formatSku));
  })
);

app.get(
  "/api/ai/config",
  asyncHandler(async (req, res) => {
    const config = await prisma.userAiConfig.findUnique({ where: { userId: req.session.userId! } });
    res.json(
      config
        ? {
            apiUrl: config.apiUrl,
            model: config.model,
            hasApiKey: true,
            updatedAt: config.updatedAt
          }
        : {
            apiUrl: "https://api.openai.com/v1/chat/completions",
            model: "gpt-4.1-mini",
            hasApiKey: false,
            updatedAt: null
          }
    );
  })
);

app.put(
  "/api/ai/config",
  asyncHandler(async (req, res) => {
    const apiUrl = cleanBaseUrl(req.body.apiUrl);
    const model = text(req.body.model);
    const apiKey = text(req.body.apiKey);
    const existing = await prisma.userAiConfig.findUnique({ where: { userId: req.session.userId! } });

    if (!model) {
      res.status(400).json({ error: "模型名必填" });
      return;
    }
    if (!apiKey && !existing) {
      res.status(400).json({ error: "API Key 必填" });
      return;
    }

    const encrypted = apiKey
      ? encryptSecret(apiKey)
      : {
          apiKeyCipher: existing!.apiKeyCipher,
          apiKeyIv: existing!.apiKeyIv,
          apiKeyAuthTag: existing!.apiKeyAuthTag
        };
    const config = await prisma.userAiConfig.upsert({
      where: { userId: req.session.userId! },
      create: {
        userId: req.session.userId!,
        apiUrl,
        model,
        ...encrypted
      },
      update: {
        apiUrl,
        model,
        ...encrypted
      }
    });

    res.json({ apiUrl: config.apiUrl, model: config.model, hasApiKey: true, updatedAt: config.updatedAt });
  })
);

app.post(
  "/api/ai/inbound-table",
  asyncHandler(async (req, res) => {
    const config = await getStoredAiConfig(req.session.userId!);
    const apiUrl = cleanBaseUrl(config.apiUrl);
    const apiKey = config.apiKey;
    const model = config.model;
    const imageDataUrl = text(req.body.imageDataUrl);
    const textContent = text(req.body.textContent);
    const styleNo = text(req.body.styleNo);
    const productName = text(req.body.productName);
    const supplier = text(req.body.supplier);
    const sizesText = text(req.body.sizesText);
    const colorsText = text(req.body.colorsText);

    if (!imageDataUrl.startsWith("data:image/") && !textContent) {
      res.status(400).json({ error: "请上传图片或文字文件" });
      return;
    }

    const prompt = [
      "你是服装订单/库存表格识别助手。请识别用户上传的图片或文字表格，把数量转换为结构化 JSON。",
      "请严格使用以下订单识别提示词作为识别规则：",
      orderRecognitionPrompt,
      "只返回 JSON，不要 Markdown，不要解释。",
      "JSON 格式必须是：{\"items\":[{\"styleNo\":\"\",\"productName\":\"\",\"supplier\":\"\",\"color\":\"\",\"size\":\"\",\"quantity\":1,\"unitCost\":\"\"}],\"notes\":[\"\"]}",
      "JSON 输出补充规则：",
      "1. 只输出数量大于 0 的格子。",
      "2. 如果表格是颜色行、尺码列，请展开为多条 color/size/quantity。",
      "3. 数量必须是整数；无法确认的格子不要输出。",
      "4. 如果图片里没有款号、商品名、供应商，可以使用用户提供的上下文。",
      "5. 最终不要输出纯文本表格，必须把识别出的四列转换到 JSON items 中：颜色=color，尺码=size，数量=quantity，款号=styleNo。",
      "6. 尺码映射提示：M=105=165，L=110=170，XL=115=175，2XL=120=180，3XL=125=185，4XL=130=190，5XL=135=195。图片中出现 105/165 等数字尺码时，请统一输出对应字母尺码，例如 105 或 165 输出 M，120 或 180 输出 2XL。",
      `用户上下文：款号=${styleNo || "未提供"}；商品名=${productName || "未提供"}；供应商=${supplier || "未提供"}；已有尺码=${sizesText || "未提供"}；已有颜色=${colorsText || "未提供"}。`,
      textContent ? `用户上传文字内容：\n${textContent.slice(0, 12000)}` : ""
    ].join("\n");
    const messageContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
      { type: "text", text: prompt }
    ];
    if (imageDataUrl.startsWith("data:image/")) {
      messageContent.push({ type: "image_url", image_url: { url: imageDataUrl } });
    }

    let aiResponse: globalThis.Response;
    try {
      aiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: messageContent
            }
          ]
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知网络错误";
      res.status(502).json({
        error: `AI 接口连接失败：${message}。请检查 API 地址是否可从 Docker 容器访问；如果使用本机代理，请把 localhost/127.0.0.1 改为 host.docker.internal。`
      });
      return;
    }

    if (!aiResponse.ok) {
      const detail = await aiResponse.text().catch(() => "");
      res.status(502).json({ error: `AI 接口调用失败：${aiResponse.status}${detail ? ` ${detail.slice(0, 200)}` : ""}` });
      return;
    }

    const contentType = aiResponse.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const detail = await aiResponse.text().catch(() => "");
      const looksLikeHtml = detail.trimStart().startsWith("<");
      res.status(502).json({
        error: looksLikeHtml
          ? "AI 接口返回了网页 HTML，不是 JSON。请检查 API 地址是否为 Chat Completions 接口，例如 https://api.openai.com/v1/chat/completions，而不是控制台/首页地址。"
          : `AI 接口返回格式不是 JSON：${contentType || "未知格式"}`
      });
      return;
    }

    let aiBody: any;
    try {
      aiBody = await aiResponse.json();
    } catch {
      res.status(502).json({ error: "AI 接口响应不是有效 JSON，请检查 API 地址和模型服务返回格式" });
      return;
    }
    const content = aiBody?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      res.status(502).json({ error: "AI 接口返回格式不符合 Chat Completions 规范" });
      return;
    }

    const parsed = extractJsonObject(content);
    const normalizedItems = normalizeRecognizedItems(parsed);
    const fallbackItems = normalizedItems.length
      ? []
      : extractDefaultQuantityItemsFromText(textContent, { productName, supplier });
    const notes = Array.isArray(parsed.notes) ? parsed.notes.map((note: unknown) => text(note)).filter(Boolean) : [];
    if (!normalizedItems.length && fallbackItems.length) {
      notes.push("文字中未提供数量的明细已按每条 1 件预填，请人工核对。");
    }
    res.json({
      items: normalizedItems.length ? normalizedItems : fallbackItems,
      notes
    });
  })
);

app.post(
  "/api/inbound-orders",
  asyncHandler(async (req, res) => {
    const supplier = text(req.body.supplier);
    if (!supplier) {
      res.status(400).json({ error: "供应商必填" });
      return;
    }
    const rawItems = orderItems(req.body);

    const order = await prisma.$transaction(async (tx) => {
      const items = [];
      for (const item of rawItems) {
        const skuId = await findOrCreateSku(item, tx);
        const quantity = positiveInt(item.quantity, "入库数量");
        const unitCost = decimalInput(item.unitCost, "入库单价");
        items.push({ skuId, quantity, unitCost });
      }

      const created = await tx.inboundOrder.create({
        data: {
          supplier,
          inboundDate: req.body.inboundDate ? new Date(req.body.inboundDate) : new Date(),
          note: optionalText(req.body.note),
          items: { create: items }
        },
        include: { items: true }
      });

      for (const item of items) {
        await adjustStock(tx, item.skuId, item.quantity, "INBOUND", created.id, req.session.userId);
      }
      return created;
    });

    res.status(201).json(order);
  })
);

app.get(
  "/api/inbound-orders",
  asyncHandler(async (_req, res) => {
    const orders = await prisma.inboundOrder.findMany({
      include: { items: { include: { sku: { include: { product: true } } } } },
      orderBy: { createdAt: "desc" }
    });
    res.json(orders);
  })
);

app.get(
  "/api/inbound-orders/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.inboundOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { include: { sku: { include: { product: true } } } } }
    });
    res.json(order);
  })
);

app.get(
  "/api/customers",
  asyncHandler(async (req, res) => {
    const q = text(req.query.q);
    const customers = await prisma.customer.findMany({
      where: q ? { name: { contains: q } } : undefined,
      orderBy: { name: "asc" },
      take: 200,
      include: { _count: { select: { orders: true } } }
    });
    const ranked = q
      ? customers
          .map((c) => ({ c, rank: c.name.startsWith(q) ? 0 : 1 }))
          .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name, "zh-CN"))
          .map((entry) => entry.c)
      : customers;
    res.json(
      ranked.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? "",
        note: c.note ?? "",
        orderCount: c._count.orders,
        createdAt: c.createdAt
      }))
    );
  })
);

app.post(
  "/api/customers",
  asyncHandler(async (req, res) => {
    const name = text(req.body.name);
    if (!name) {
      res.status(400).json({ error: "客户名称必填" });
      return;
    }
    const existing = await prisma.customer.findUnique({ where: { name } });
    if (existing) {
      res.status(409).json({ error: "客户名称已存在" });
      return;
    }
    const customer = await prisma.customer.create({
      data: { name, phone: optionalText(req.body.phone), note: optionalText(req.body.note) }
    });
    res.status(201).json({ id: customer.id, name: customer.name, phone: customer.phone ?? "", note: customer.note ?? "", orderCount: 0, createdAt: customer.createdAt });
  })
);

app.patch(
  "/api/customers/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const name = text(req.body.name);
    if (!name) {
      res.status(400).json({ error: "客户名称必填" });
      return;
    }
    const clash = await prisma.customer.findFirst({ where: { name, id: { not: id } } });
    if (clash) {
      res.status(409).json({ error: "客户名称已存在" });
      return;
    }
    const customer = await prisma.customer.update({
      where: { id },
      data: { name, phone: optionalText(req.body.phone), note: optionalText(req.body.note) }
    });
    res.json({ id: customer.id, name: customer.name, phone: customer.phone ?? "", note: customer.note ?? "" });
  })
);

app.delete(
  "/api/customers/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx) => {
      await tx.customerOrder.updateMany({ where: { customerId: id }, data: { customerId: null } });
      await tx.customer.delete({ where: { id } });
    });
    res.json({ id });
  })
);

app.get(
  "/api/customers/:id/orders",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      res.status(404).json({ error: "客户不存在" });
      return;
    }
    // 同时按 customerId 和历史单的客户名匹配，兼容关联前保存的旧单
    const orders = await prisma.customerOrder.findMany({
      where: { OR: [{ customerId: id }, { customer: customer.name }] },
      include: { items: { include: { sku: { include: { product: true } } } } },
      orderBy: { createdAt: "desc" }
    });
    res.json(orders.map(formatCustomerOrder));
  })
);

app.get(
  "/api/customer-orders",
  asyncHandler(async (req, res) => {
    const status = text(req.query.status);
    const orders = await prisma.customerOrder.findMany({
      where: status === "PENDING" || status === "SHIPPED" ? { status } : undefined,
      include: { items: { include: { sku: { include: { product: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json(orders.map(formatCustomerOrder));
  })
);

app.post(
  "/api/customer-orders/:id/print-pdf",
  asyncHandler(async (req, res) => {
    const order = await prisma.customerOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { include: { sku: { include: { product: true } } } } }
    });
    if (!order) {
      res.status(404).json({ error: "客户订单不存在" });
      return;
    }

    const formatted = formatCustomerOrder(order);
    const pdf = await customerOrderPdfBuffer(formatted, req.body?.template);
    const filename = `${formatted.customer}-${formatted.orderNo || `订单${formatted.id}`}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(pdf);
  })
);

app.post(
  "/api/customer-orders/print-pdf",
  asyncHandler(async (req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids)
      ? req.body.ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)
      : [];
    if (!ids.length) {
      res.status(400).json({ error: "请提供要打印的订单 ID" });
      return;
    }
    const orders = await prisma.customerOrder.findMany({
      where: { id: { in: ids } },
      include: { items: { include: { sku: { include: { product: true } } } } }
    });
    if (!orders.length) {
      res.status(404).json({ error: "未找到对应的客户订单" });
      return;
    }
    // 按传入 ids 的顺序排列，保持与勾选顺序一致
    type LoadedOrder = (typeof orders)[number];
    const orderById = new Map<number, LoadedOrder>(orders.map((order) => [order.id, order] as [number, LoadedOrder]));
    const ordered = ids
      .map((id: number) => orderById.get(id))
      .filter((order): order is LoadedOrder => Boolean(order));
    const formatted = ordered.map((order) => formatCustomerOrder(order));
    const pdf = await customerOrdersPdfBuffer(formatted, req.body?.template);
    const filename = `批量打印-${formatted.length}单.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(pdf);
  })
);

app.post(
  "/api/customer-orders/mark-printed",
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)
      : [];
    if (!ids.length) {
      res.status(400).json({ error: "请提供要标记的订单 ID" });
      return;
    }
    const printedAt = new Date();
    const result = await prisma.customerOrder.updateMany({
      where: { id: { in: ids } },
      data: { printedAt }
    });
    res.json({ updated: result.count, printedAt });
  })
);

app.post(
  "/api/customer-orders",
  asyncHandler(async (req, res) => {
    const customer = text(req.body.customer);
    if (!customer) {
      res.status(400).json({ error: "客户必填" });
      return;
    }
    const rawItems = orderItems(req.body);

    const order = await prisma.$transaction(async (tx) => {
      const items = [];
      let amountDue = new Prisma.Decimal(0);
      for (const item of rawItems) {
        const skuId = await findOrCreateSku(item, tx);
        const quantity = positiveInt(item.quantity, "客户订单数量");
        const unitPrice = decimalInput(item.unitPrice, "销售单价");
        amountDue = amountDue.plus(unitPrice.mul(quantity));
        items.push({ skuId, quantity, unitPrice });
      }
      const payments = paymentSnapshot(req.body, amountDue);

      const customerRecord = await tx.customer.upsert({
        where: { name: customer },
        update: req.body.customerPhone != null ? { phone: optionalText(req.body.customerPhone) } : {},
        create: { name: customer, phone: optionalText(req.body.customerPhone) }
      });

      const created = await tx.customerOrder.create({
        data: {
          customer,
          customerId: customerRecord.id,
          orderNo: optionalText(req.body.orderNo),
          channel: optionalText(req.body.channel),
          orderDate: req.body.orderDate ? new Date(req.body.orderDate) : new Date(),
          note: optionalText(req.body.note),
          status: "SHIPPED",
          shippedAt: new Date(),
          ...payments,
          items: { create: items }
        },
        include: { items: { include: { sku: { include: { product: true } } } } }
      });

      const outbound = await createOutboundShipment(
        tx,
        {
          customer,
          channel: optionalText(req.body.channel),
          outboundDate: req.body.orderDate,
          note: optionalText(req.body.note) || `销售开单${created.orderNo ? `：${created.orderNo}` : ""}`,
          items
        },
        req.session.userId
      );

      return tx.customerOrder.update({
        where: { id: created.id },
        data: { outboundOrderId: outbound.id },
        include: { items: { include: { sku: { include: { product: true } } } } }
      });
    });

    res.status(201).json(formatCustomerOrder(order));
  })
);

app.post(
  "/api/customer-orders/:id/ship",
  asyncHandler(async (req, res) => {
    const shipped = await prisma.$transaction(async (tx) => {
      const order = await tx.customerOrder.findUnique({
        where: { id: Number(req.params.id) },
        include: { items: true }
      });
      if (!order) {
        throw Object.assign(new Error("客户订单不存在"), { status: 404 });
      }
      if (order.status === "SHIPPED") {
        throw Object.assign(new Error("该客户订单已发货，不能重复扣库存"), { status: 409 });
      }
      if (!order.items.length) {
        throw Object.assign(new Error("客户订单没有明细"), { status: 400 });
      }

      const outbound = await createOutboundShipment(
        tx,
        {
          customer: order.customer,
          channel: order.channel,
          outboundDate: req.body.outboundDate,
          note: optionalText(req.body.note) || `客户订单发货${order.orderNo ? `：${order.orderNo}` : ""}`,
          items: order.items.map((item) => ({
            skuId: item.skuId,
            quantity: item.quantity,
            unitPrice: item.unitPrice
          }))
        },
        req.session.userId
      );

      return tx.customerOrder.update({
        where: { id: order.id },
        data: {
          status: "SHIPPED",
          shippedAt: new Date(),
          outboundOrderId: outbound.id
        },
        include: { items: { include: { sku: { include: { product: true } } } } }
      });
    });

    res.json(formatCustomerOrder(shipped));
  })
);

app.delete(
  "/api/customer-orders/:id",
  asyncHandler(async (req, res) => {
    const deleted = await prisma.$transaction(async (tx) => {
      const order = await tx.customerOrder.findUnique({
        where: { id: Number(req.params.id) },
        include: { items: true }
      });
      if (!order) {
        throw Object.assign(new Error("客户订单不存在"), { status: 404 });
      }

      const shouldRestoreStock = order.status === "SHIPPED" || Boolean(order.outboundOrderId);
      if (shouldRestoreStock) {
        for (const item of order.items) {
          await adjustStock(tx, item.skuId, item.quantity, "INBOUND", null, req.session.userId);
        }
      }

      const outboundOrderId = order.outboundOrderId;
      await tx.customerOrder.delete({ where: { id: order.id } });
      if (outboundOrderId) {
        await tx.outboundOrder.delete({ where: { id: outboundOrderId } }).catch((error) => {
          if (error?.code !== "P2025") throw error;
        });
      }

      return {
        id: order.id,
        restoredStock: shouldRestoreStock,
        restoredQuantity: shouldRestoreStock ? order.items.reduce((sum, item) => sum + item.quantity, 0) : 0
      };
    });

    res.json(deleted);
  })
);

app.post(
  "/api/outbound-orders",
  asyncHandler(async (req, res) => {
    const customer = text(req.body.customer);
    if (!customer) {
      res.status(400).json({ error: "客户/渠道必填" });
      return;
    }
    const rawItems = orderItems(req.body);

    const order = await prisma.$transaction(async (tx) => {
      const items = [];
      for (const item of rawItems) {
        const skuId = await findOrCreateSku(item, tx);
        const quantity = positiveInt(item.quantity, "出库数量");
        const unitPrice = decimalInput(item.unitPrice, "出库单价");
        items.push({ skuId, quantity, unitPrice });
      }

      return createOutboundShipment(
        tx,
        {
          customer,
          channel: optionalText(req.body.channel),
          outboundDate: req.body.outboundDate,
          note: optionalText(req.body.note),
          items
        },
        req.session.userId
      );
    });

    res.status(201).json(order);
  })
);

app.get(
  "/api/outbound-orders",
  asyncHandler(async (_req, res) => {
    const orders = await prisma.outboundOrder.findMany({
      include: { items: { include: { sku: { include: { product: true } } } } },
      orderBy: { createdAt: "desc" }
    });
    res.json(orders);
  })
);

app.get(
  "/api/outbound-orders/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.outboundOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { include: { sku: { include: { product: true } } } } }
    });
    res.json(order);
  })
);

app.get(
  "/api/stock-movements",
  asyncHandler(async (req, res) => {
    const type = text(req.query.type);
    const q = text(req.query.q);
    const from = text(req.query.from);
    const to = text(req.query.to);

    const movements = await prisma.stockMovement.findMany({
      where: {
        type: type === "INBOUND" || type === "OUTBOUND" ? type : undefined,
        createdAt: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(`${to}T23:59:59`) : undefined
        },
        sku: q
          ? {
              OR: [
                { color: { contains: q } },
                { size: { contains: q } },
                { product: { styleNo: { contains: q } } },
                { product: { name: { contains: q } } }
              ]
            }
          : undefined
      },
      include: {
        sku: { include: { product: true } },
        operator: { select: { username: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    res.json(
      movements.map((movement) => ({
        id: movement.id,
        type: movement.type,
        quantityChange: movement.quantityChange,
        balanceAfter: movement.balanceAfter,
        createdAt: movement.createdAt,
        operator: movement.operator?.username ?? "",
        sku: {
          styleNo: movement.sku.product.styleNo,
          productName: movement.sku.product.name,
          color: movement.sku.color,
          size: movement.sku.size
        }
      }))
    );
  })
);

app.use(express.static(clientDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error.code === "P2002") {
    res.status(409).json({ error: "数据已存在，请检查唯一字段" });
    return;
  }
  const status = error.status || 500;
  res.status(status).json({ error: error.message || "服务器错误" });
});

if (process.env.NODE_ENV !== "test") {
  seedAdmin()
    .then(() => {
      app.listen(port, () => {
        console.log(`Fashion inventory app listening on ${port}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

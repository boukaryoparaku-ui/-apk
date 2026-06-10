import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  buildInboundFormFromStyle,
  buildStyleOptions,
  compareSizes,
  collectExistingSkuItems,
  collectNewStyleSkus,
  collectQuickItems,
  collectSalesOrderItems,
  createEmptySalesOrderLine,
  createSalesOrderLineFromSkus,
  createQuickSkuForm,
  inboundDefaultSizes,
  knownColorsForStyle,
  mergeRecognizedInboundItems,
  mergeRecognizedSalesItems,
  remapRecognizedItemColors,
  salesLineQuantity,
  salesLineSubtotal,
  salesOrderSizes,
  salesPaymentKeys,
  summarizeSalesOrder,
  supplierFromStyle
} from "./inventoryLogic";
import { InventoryMatrix, QuickSkuMatrix, SkuQuantityMatrix } from "./matrixComponents";
import type { CustomerOrder, ManagedUser, Movement, QuickSkuForm, RecognizedInboundItem, SalesOrderLine, SalesOrderPayments, Sku, User } from "./types";
import "./styles.css";

const appBuildLabel = "FE 2026-06-10 delete-order-rollback-v6";

type ApiError = { error?: string };
type AiParseResponse = { items: RecognizedInboundItem[]; notes: string[] };
type AiConfigResponse = {
  apiUrl: string;
  model: string;
  hasApiKey: boolean;
  updatedAt: string | null;
};
type AiConfigState = {
  apiUrl: string;
  apiKey: string;
  model: string;
  hasApiKey: boolean;
};

const emptySkuForm = {
  styleNo: "",
  productName: "",
  category: "",
  brand: "",
  color: "",
  size: "",
  barcode: "",
  retailPrice: ""
};

type PrintTemplateSettings = {
  title: string;
  paperWidthMm: string;
  paperHeightMm: string;
  marginMm: string;
  extraContent: string;
  customerLabel: string;
  amountLabel: string;
  customerFontSizePx: string;
  amountFontSizePx: string;
  titleFontSizePx: string;
  qrImageUrl: string;
  qrLabel: string;
  qrSizeMm: string;
  showMatrix: boolean;
  compactLayout: boolean;
  showPrintFooter: boolean;
  customCss: string;
};

const printTemplateStorageKey = "customerOrderPrintTemplate";
const salesOrderDraftStorageKey = "salesOrderDrafts";
const salesOrderAutosaveStorageKey = "salesOrderAutosave";
const defaultPrintTemplate: PrintTemplateSettings = {
  title: "客户订单",
  paperWidthMm: "100",
  paperHeightMm: "100",
  marginMm: "3",
  extraContent: "",
  customerLabel: "客户信息",
  amountLabel: "商品金额",
  customerFontSizePx: "48",
  amountFontSizePx: "44",
  titleFontSizePx: "20",
  qrImageUrl: "",
  qrLabel: "微信二维码",
  qrSizeMm: "24",
  showMatrix: true,
  compactLayout: true,
  showPrintFooter: false,
  customCss: ""
};
const footerContactText = "电话：18698509889　永兴路52-1";

const emptySalesPayments: SalesOrderPayments = {
  paymentWechat: "",
  paymentCash: "",
  paymentAlipay: "",
  paymentCard: "",
  paymentScan: "",
  paymentTransfer: ""
};

const emptySalesOrder = {
  customer: "",
  orderNo: "",
  channel: "",
  orderDate: today(),
  note: "",
  ...emptySalesPayments
};

type SalesOrderDraft = {
  id: string;
  savedAt: string;
  order: typeof emptySalesOrder;
  lines: SalesOrderLine[];
  customer: string;
  totalQuantity: number;
  amountDue: number;
};

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(body.error || "请求失败");
    }
    const text = await response.text().catch(() => "");
    throw new Error(text.trimStart().startsWith("<") ? "服务器返回了网页而不是 JSON，请确认后端 API 正常运行且端口代理正确。" : "服务器返回格式异常");
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new Error(text.trimStart().startsWith("<") ? "服务器返回了网页而不是 JSON，请确认后端 API 正常运行且端口代理正确。" : "服务器返回格式异常");
  }

  return response.json() as Promise<T>;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "未命名";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function customerOrderFilename(order: CustomerOrder, extension: string) {
  const orderNo = order.orderNo || `订单${order.id}`;
  return `${safeFilename(order.customer)}-${safeFilename(orderNo)}-待发货.${extension}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlWithBreaks(value: unknown) {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function stripBuiltInFooterContact(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("18698509889") && !line.includes("永兴路52-1"))
    .join("\n");
}

function clampNumber(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function loadPrintTemplateSettings() {
  try {
    const stored = window.localStorage.getItem(printTemplateStorageKey);
    if (!stored) return defaultPrintTemplate;
    return { ...defaultPrintTemplate, ...JSON.parse(stored) } as PrintTemplateSettings;
  } catch {
    return defaultPrintTemplate;
  }
}

function loadSalesDrafts() {
  try {
    const stored = window.localStorage.getItem(salesOrderDraftStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? (parsed as SalesOrderDraft[]) : [];
  } catch {
    return [];
  }
}

function loadSalesAutosave() {
  try {
    const stored = window.localStorage.getItem(salesOrderAutosaveStorageKey);
    return stored ? (JSON.parse(stored) as { order: typeof emptySalesOrder; lines: SalesOrderLine[] }) : null;
  } catch {
    return null;
  }
}

function formatMoneyValue(value: string | number) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return "0";
  return numberValue.toFixed(2).replace(/\.00$/, "");
}

function hasSalesDraftContent(order: typeof emptySalesOrder, lines: SalesOrderLine[]) {
  return Boolean(
    order.customer.trim() ||
      order.orderNo.trim() ||
      order.channel.trim() ||
      order.note.trim() ||
      salesPaymentKeys.some((key) => order[key].trim()) ||
      lines.some((line) => line.styleNo.trim() || line.productName.trim() || line.color.trim() || salesLineQuantity(line) > 0)
  );
}

function customerOrderRows(order: CustomerOrder) {
  return order.items.map((item) => ({
    styleNo: item.styleNo,
    productName: item.productName,
    color: item.color,
    size: item.size,
    quantity: item.quantity,
    unitPrice: item.unitPrice
  }));
}

function buildCustomerOrderMatrix(order: CustomerOrder) {
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
    }
  >();

  customerOrderRows(order).forEach((item) => {
    sizeSet.add(item.size);
    const key = [item.styleNo, item.productName, item.color, item.unitPrice].join("::");
    const row =
      rows.get(key) ||
      ({
        styleNo: item.styleNo,
        productName: item.productName,
        color: item.color,
        unitPrice: item.unitPrice,
        sizes: {},
        total: 0
      } satisfies {
        styleNo: string;
        productName: string;
        color: string;
        unitPrice: string;
        sizes: Record<string, number>;
        total: number;
      });
    row.sizes[item.size] = (row.sizes[item.size] || 0) + item.quantity;
    row.total += item.quantity;
    rows.set(key, row);
  });

  const sizes = Array.from(sizeSet).sort(compareSizes);
  const matrixRows = Array.from(rows.values()).sort((a, b) => {
    const style = a.styleNo.localeCompare(b.styleNo, "zh-CN", { numeric: true });
    return style || a.color.localeCompare(b.color, "zh-CN", { numeric: true });
  });
  const sizeTotals = sizes.reduce<Record<string, number>>((totals, size) => {
    totals[size] = matrixRows.reduce((sum, row) => sum + (row.sizes[size] || 0), 0);
    return totals;
  }, {});
  const total = matrixRows.reduce((sum, row) => sum + row.total, 0);
  return { sizes, rows: matrixRows, sizeTotals, total };
}

function exportCustomerOrderCsv(order: CustomerOrder) {
  const matrix = buildCustomerOrderMatrix(order);
  const csvRows = [
    ["客户", order.customer],
    ["客户订单", order.orderNo || ""],
    ["开单日期", new Date(order.orderDate).toLocaleDateString()],
    ["应收金额", formatMoneyValue(order.amountDue)],
    ["已收金额", formatMoneyValue(order.paidAmount)],
    ["未付金额", formatMoneyValue(order.unpaidAmount)],
    ["结余金额", formatMoneyValue(order.changeAmount)],
    [],
    ["款号", "商品名称", "颜色", "单价", ...matrix.sizes, "数量"],
    ...matrix.rows.map((row) => [
      row.styleNo,
      row.productName,
      row.color,
      row.unitPrice,
      ...matrix.sizes.map((size) => (row.sizes[size] ? String(row.sizes[size]) : "")),
      String(row.total)
    ]),
    ["合计", "", "", "", ...matrix.sizes.map((size) => (matrix.sizeTotals[size] ? String(matrix.sizeTotals[size]) : "")), String(matrix.total)]
  ];
  const csv = csvRows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), customerOrderFilename(order, "csv"));
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function exportCustomerOrderImage(order: CustomerOrder) {
  const matrix = buildCustomerOrderMatrix(order);
  const leftColumns = [
    { title: "款号", width: 120 },
    { title: "商品名称", width: 190 },
    { title: "颜色", width: 130 },
    { title: "单价", width: 90 }
  ];
  const sizeColumns = matrix.sizes.map((size) => ({ title: size, width: Math.max(74, Math.min(104, 38 + size.length * 12)) }));
  const columns = [...leftColumns, ...sizeColumns, { title: "数量", width: 90 }];
  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const width = Math.max(1080, tableWidth + 144);
  const padding = 44;
  const titleHeight = 112;
  const metaHeight = 58;
  const rowHeight = 44;
  const headerHeight = 48;
  const footerHeight = 62;
  const height = padding * 2 + titleHeight + metaHeight + headerHeight + rowHeight * Math.max(matrix.rows.length, 1) + footerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持导出图片");
  ctx.scale(2, 2);
  ctx.fillStyle = "#f4f7f8";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, padding, padding, width - padding * 2, height - padding * 2, 8);
  ctx.fill();

  ctx.fillStyle = "#183c49";
  ctx.font = '700 30px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText(order.status === "SHIPPED" ? "销售开单" : "待发货客户订单", padding + 28, padding + 52);
  ctx.fillStyle = "#53606f";
  ctx.font = '16px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillText(`客户：${order.customer}`, padding + 28, padding + 86);
  ctx.fillText(`客户订单：${order.orderNo || "-"}`, padding + 270, padding + 86);
  ctx.fillText(`开单日期：${new Date(order.orderDate).toLocaleDateString()}`, padding + 560, padding + 86);
  ctx.fillText(`应收：${formatMoneyValue(order.amountDue)}  已收：${formatMoneyValue(order.paidAmount)}  未付：${formatMoneyValue(order.unpaidAmount)}  结余：${formatMoneyValue(order.changeAmount)}`, padding + 28, padding + 110);

  const tableX = padding + 28;
  const tableY = padding + titleHeight + metaHeight;

  ctx.fillStyle = "#e6edf0";
  roundedRect(ctx, tableX, tableY, tableWidth, headerHeight, 6);
  ctx.fill();
  ctx.font = '700 16px "Microsoft YaHei", "Segoe UI", sans-serif';
  ctx.fillStyle = "#2a3b45";
  let x = tableX;
  columns.forEach((column) => {
    ctx.fillText(column.title, x + 14, tableY + 30);
    x += column.width;
  });

  ctx.font = '15px "Microsoft YaHei", "Segoe UI", sans-serif';
  matrix.rows.forEach((row, index) => {
    const y = tableY + headerHeight + index * rowHeight;
    ctx.fillStyle = index % 2 === 0 ? "#ffffff" : "#f8fafb";
    ctx.fillRect(tableX, y, tableWidth, rowHeight);
    ctx.fillStyle = "#1c2430";
    const values = [
      row.styleNo,
      row.productName,
      row.color,
      row.unitPrice,
      ...matrix.sizes.map((size) => (row.sizes[size] ? String(row.sizes[size]) : "")),
      String(row.total)
    ];
    let cellX = tableX;
    values.forEach((value, valueIndex) => {
      ctx.fillText(value || "-", cellX + 14, y + 28, columns[valueIndex].width - 24);
      cellX += columns[valueIndex].width;
    });
  });

  const footerY = tableY + headerHeight + rowHeight * Math.max(matrix.rows.length, 1);
  ctx.fillStyle = "#fff2cf";
  ctx.fillRect(tableX, footerY, tableWidth, footerHeight - 16);
  ctx.fillStyle = "#8a4b00";
  ctx.font = '700 18px "Microsoft YaHei", "Segoe UI", sans-serif';
  const summaryValues = ["合计", "", "", "", ...matrix.sizes.map((size) => (matrix.sizeTotals[size] ? String(matrix.sizeTotals[size]) : "")), String(matrix.total)];
  let summaryX = tableX;
  summaryValues.forEach((value, index) => {
    if (value) ctx.fillText(value, summaryX + 14, footerY + 30, columns[index].width - 24);
    summaryX += columns[index].width;
  });

  canvas.toBlob((blob) => {
    if (!blob) throw new Error("图片生成失败");
    downloadBlob(blob, customerOrderFilename(order, "png"));
  }, "image/png");
}

function printCustomerOrder(order: CustomerOrder, template: PrintTemplateSettings) {
  const matrix = buildCustomerOrderMatrix(order);
  const orderAmount = Number(order.amountDue || 0);
  const headers = ["款号", "商品名称", "颜色", "单价", ...matrix.sizes, "数量"];
  const rows = matrix.rows.map((row) => [
    row.styleNo,
    row.productName,
    row.color,
    row.unitPrice,
    ...matrix.sizes.map((size) => (row.sizes[size] ? String(row.sizes[size]) : "")),
    String(row.total)
  ]);
  const summary = ["合计", "", "", "", ...matrix.sizes.map((size) => (matrix.sizeTotals[size] ? String(matrix.sizeTotals[size]) : "")), String(matrix.total)];
  const paperWidth = clampNumber(template.paperWidthMm, Number(defaultPrintTemplate.paperWidthMm), 40, 420);
  const paperHeight = clampNumber(template.paperHeightMm, Number(defaultPrintTemplate.paperHeightMm), 30, 420);
  const margin = clampNumber(template.marginMm, Number(defaultPrintTemplate.marginMm), 0, 30);
  const compact = paperWidth <= 120 || paperHeight <= 90;
  const bodyFontSize = compact ? 9 : 12;
  const tableFontSize = compact ? 11 : 14;
  const titleFontSize = clampNumber(template.titleFontSizePx, compact ? 17 : 24, 10, 96);
  const customerFontSize = clampNumber(template.customerFontSizePx, compact ? 28 : 42, 12, 120);
  const amountFontSize = clampNumber(template.amountFontSizePx, compact ? 26 : 38, 12, 120);
  const cellPadding = compact ? "3px 4px" : "7px 6px";
  const templateTitle = template.title.trim() || defaultPrintTemplate.title;
  const extraContent = stripBuiltInFooterContact(template.extraContent);
  const customerLabel = template.customerLabel.trim() || defaultPrintTemplate.customerLabel;
  const amountLabel = template.amountLabel.trim() || defaultPrintTemplate.amountLabel;
  const qrImageUrl = template.qrImageUrl.trim();
  const qrLabel = template.qrLabel.trim() || defaultPrintTemplate.qrLabel;
  const qrSizeMm = clampNumber(template.qrSizeMm, Number(defaultPrintTemplate.qrSizeMm), 12, 80);
  const customCss = template.customCss.trim();
  const matrixHtml = template.showMatrix
    ? `
  <table class="order-matrix">
    <thead>
      <tr>${headers.map((header, index) => `<th class="${index === 1 ? "left" : ""}">${escapeHtml(header)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${rows
        .map((row) => `<tr>${row.map((value, index) => `<td class="${index === 1 ? "left" : ""}">${escapeHtml(value || "-")}</td>`).join("")}</tr>`)
        .join("")}
    </tbody>
    <tfoot>
      <tr>${summary.map((value, index) => `<td class="${index === 1 ? "left" : ""}">${escapeHtml(value || "")}</td>`).join("")}</tr>
    </tfoot>
  </table>`
    : "";
  const printWindow = window.open("", "_blank", "width=1120,height=760");
  if (!printWindow) {
    window.alert("浏览器拦截了打印窗口，请允许弹窗后重试。");
    return;
  }

  printWindow.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(order.customer)}-${escapeHtml(order.orderNo || `订单${order.id}`)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: ${margin}mm;
      color: #111827;
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      background: #fff;
      font-size: ${bodyFontSize}px;
    }
    .print-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: flex-start;
      justify-content: space-between;
      gap: ${compact ? 7 : 12}px;
      margin-bottom: ${compact ? 5 : 9}px;
      border-bottom: 2px solid #111827;
      padding-bottom: ${compact ? 4 : 7}px;
    }
    .main-panel {
      min-width: 0;
    }
    h1 {
      margin: 0 0 ${compact ? 2 : 4}px;
      font-size: ${titleFontSize}px;
      line-height: 1.05;
      text-align: center;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: ${compact ? 10 : 18}px;
      align-items: start;
      margin: 0;
    }
    .hero-block {
      min-width: 0;
      overflow: hidden;
    }
    .hero-label {
      color: #4b5563;
      font-size: ${compact ? 7 : 10}px;
      font-weight: 700;
      line-height: 1.05;
    }
    .customer-name {
      margin-top: 0;
      padding-left: ${compact ? 3 : 6}px;
      font-size: ${customerFontSize}px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
    }
    .order-amount {
      margin-top: 0;
      padding-left: ${compact ? 3 : 6}px;
      font-size: ${amountFontSize}px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
    }
    .side-panel {
      display: grid;
      gap: ${compact ? 2 : 4}px;
      justify-items: center;
    }
    .qr-box {
      width: ${qrSizeMm}mm;
      min-height: ${qrSizeMm}mm;
      display: grid;
      place-items: center;
      border: 1px solid #111827;
      background: #fff;
      overflow: hidden;
    }
    .qr-box img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .qr-placeholder {
      padding: 3px;
      color: #6b7280;
      font-size: ${compact ? 8 : 10}px;
      line-height: 1.25;
      text-align: center;
    }
    .qr-label {
      max-width: ${qrSizeMm}mm;
      color: #111827;
      font-size: ${compact ? 8 : 10}px;
      font-weight: 700;
      text-align: center;
      word-break: break-word;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: ${compact ? 3 : 6}px ${compact ? 10 : 22}px;
      font-size: ${compact ? 9 : 13}px;
    }
    .extra {
      margin-top: ${compact ? 5 : 10}px;
      color: #111827;
      font-size: ${compact ? 9 : 13}px;
      line-height: 1.45;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: ${tableFontSize}px;
    }
    th, td {
      border: 1px solid #2f3a45;
      padding: ${cellPadding};
      text-align: center;
      vertical-align: middle;
      word-break: break-word;
      font-weight: 700;
    }
    th {
      background: #eef2f5;
      font-weight: 800;
    }
    td.left, th.left {
      text-align: left;
    }
    tfoot td {
      background: #fff7dc;
      font-weight: 700;
    }
    .footer {
      position: fixed;
      left: ${margin}mm;
      right: ${margin}mm;
      bottom: ${compact ? 1.2 : 1.8}mm;
      height: ${compact ? 10 : 14}mm;
      color: #4b5563;
      font-size: ${compact ? 9 : 12}px;
      pointer-events: none;
    }
    .watermark {
      position: absolute;
      right: 0;
      bottom: ${compact ? 4.3 : 5.8}mm;
      color: #111827;
      font-size: ${compact ? 7 : 9}px;
      font-weight: 800;
      line-height: 1.2;
      text-align: right;
      opacity: 0.92;
    }
    .address {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      color: #111827;
      font-weight: 800;
      text-align: center;
    }
    .order-matrix {
      margin-bottom: ${compact ? 11 : 15}mm;
    }
    @page { size: ${paperWidth}mm ${paperHeight}mm; margin: ${margin}mm; }
    @media print {
      body { padding: 0; }
    }
    ${customCss}
  </style>
</head>
<body>
  <section class="print-header">
    <div class="main-panel">
      <h1>${escapeHtml(templateTitle)}</h1>
      <div class="hero">
        <div class="hero-block customer-block">
          <div class="hero-label">${escapeHtml(customerLabel)}</div>
          <div class="customer-name fit-text" data-max-font="${customerFontSize}" data-min-font="${compact ? 16 : 20}">${escapeHtml(order.customer)}</div>
        </div>
        <div class="hero-block amount-block">
          <div class="hero-label">${escapeHtml(amountLabel)}</div>
          <div class="order-amount fit-text" data-max-font="${amountFontSize}" data-min-font="${compact ? 16 : 20}">${escapeHtml(formatMoneyValue(orderAmount))}</div>
        </div>
      </div>
      ${extraContent ? `<div class="extra">${escapeHtmlWithBreaks(extraContent)}</div>` : ""}
    </div>
    <div class="side-panel">
      <div class="qr-box">
        ${qrImageUrl ? `<img src="${escapeHtml(qrImageUrl)}" alt="${escapeHtml(qrLabel)}" />` : `<div class="qr-placeholder">${escapeHtml(qrLabel)}</div>`}
      </div>
      <div class="qr-label">${escapeHtml(qrLabel)}</div>
    </div>
  </section>
  ${matrixHtml}
  <div class="footer">
    <div class="watermark">
      <div>打印时间：${escapeHtml(new Date().toLocaleString())}</div>
      <div>合计数量：${escapeHtml(matrix.total)}　订单金额：${escapeHtml(formatMoneyValue(orderAmount))}</div>
    </div>
    <div class="address">${escapeHtml(footerContactText)}</div>
  </div>
  <script>
    function fitTextToBox() {
      document.querySelectorAll(".fit-text").forEach((element) => {
        const max = Number(element.dataset.maxFont || 48);
        const min = Number(element.dataset.minFont || 18);
        let size = max;
        element.style.fontSize = size + "px";
        element.style.maxWidth = "100%";
        while (size > min && element.scrollWidth > element.clientWidth) {
          size -= 1;
          element.style.fontSize = size + "px";
        }
      });
    }
    window.onload = () => {
      fitTextToBox();
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`);
  printWindow.document.close();
}

async function printCustomerOrderPdf(order: CustomerOrder, template: PrintTemplateSettings) {
  const response = await fetch(`/api/customer-orders/${order.id}/print-pdf`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template })
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const message = contentType.includes("application/json")
      ? ((await response.json().catch(() => ({}))) as ApiError).error
      : await response.text().catch(() => "");
    window.alert(message || "PDF 生成失败");
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "width=1120,height=760");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const user = await api<User>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      onLogin(user);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div>
          <p className="eyebrow">Fashion Inventory</p>
          <h1>服装供销存系统</h1>
        </div>
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          密码
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">
          登录
        </button>
      </form>
    </main>
  );
}

function SkuFields({
  value,
  onChange
}: {
  value: typeof emptySkuForm;
  onChange: (next: typeof emptySkuForm) => void;
}) {
  const set = (key: keyof typeof emptySkuForm, fieldValue: string) => onChange({ ...value, [key]: fieldValue });

  return (
    <div className="grid two">
      <label>
        款号
        <input value={value.styleNo} onChange={(event) => set("styleNo", event.target.value)} required />
      </label>
      <label>
        商品名称
        <input value={value.productName} onChange={(event) => set("productName", event.target.value)} required />
      </label>
      <label>
        品类
        <input value={value.category} onChange={(event) => set("category", event.target.value)} />
      </label>
      <label>
        品牌
        <input value={value.brand} onChange={(event) => set("brand", event.target.value)} />
      </label>
      <label>
        颜色
        <input value={value.color} onChange={(event) => set("color", event.target.value)} required />
      </label>
      <label>
        尺码
        <input value={value.size} onChange={(event) => set("size", event.target.value)} required />
      </label>
      <label>
        条码
        <input value={value.barcode} onChange={(event) => set("barcode", event.target.value)} />
      </label>
      <label>
        零售价
        <input type="number" min="0" step="0.01" value={value.retailPrice} onChange={(event) => set("retailPrice", event.target.value)} />
      </label>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("inventory");
  const [skus, setSkus] = useState<Sku[]>([]);
  const [allSkus, setAllSkus] = useState<Sku[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [skuForm, setSkuForm] = useState(emptySkuForm);
  const [newStyleForm, setNewStyleForm] = useState<QuickSkuForm>(() => createQuickSkuForm(inboundDefaultSizes));
  const [inbound, setInbound] = useState({ supplier: "", inboundDate: today(), unitCost: "0", note: "" });
  const [outbound, setOutbound] = useState({ customer: "", channel: "", outboundDate: today(), unitPrice: "0", note: "" });
  const [customerOrder, setCustomerOrder] = useState(() => ({ ...emptySalesOrder, orderDate: today() }));
  const [inboundMatrix, setInboundMatrix] = useState<QuickSkuForm>(() => createQuickSkuForm(inboundDefaultSizes));
  const [selectedInboundStyle, setSelectedInboundStyle] = useState("");
  const [selectedOutboundStyle, setSelectedOutboundStyle] = useState("");
  const [customerOrderLines, setCustomerOrderLines] = useState<SalesOrderLine[]>([]);
  const [selectedCustomerOrderStyle, setSelectedCustomerOrderStyle] = useState("");
  const [salesDrafts, setSalesDrafts] = useState<SalesOrderDraft[]>(() => loadSalesDrafts());
  const [outboundQuantities, setOutboundQuantities] = useState<Record<string, string>>({});
  const [movementFilters, setMovementFilters] = useState({ q: "", type: "", from: "", to: "" });
  const [aiConfig, setAiConfig] = useState<AiConfigState>({
    apiUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4.1-mini",
    hasApiKey: false
  });
  const [aiImage, setAiImage] = useState<File | null>(null);
  const [aiTextContent, setAiTextContent] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiParseResponse | null>(null);
  const [customerOrderAiImage, setCustomerOrderAiImage] = useState<File | null>(null);
  const [customerOrderAiTextContent, setCustomerOrderAiTextContent] = useState("");
  const [customerOrderAiLoading, setCustomerOrderAiLoading] = useState(false);
  const [customerOrderAiResult, setCustomerOrderAiResult] = useState<AiParseResponse | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [newUserForm, setNewUserForm] = useState({ username: "", password: "" });
  const [printTemplate, setPrintTemplate] = useState<PrintTemplateSettings>(() => loadPrintTemplateSettings());

  useEffect(() => {
    api<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) {
      refreshAll();
      loadAiConfig();
      loadUsers();
    }
  }, [user]);

  useEffect(() => {
    window.localStorage.setItem(printTemplateStorageKey, JSON.stringify(printTemplate));
  }, [printTemplate]);

  useEffect(() => {
    window.localStorage.setItem(salesOrderDraftStorageKey, JSON.stringify(salesDrafts));
  }, [salesDrafts]);

  useEffect(() => {
    if (hasSalesDraftContent(customerOrder, customerOrderLines)) {
      window.localStorage.setItem(salesOrderAutosaveStorageKey, JSON.stringify({ order: customerOrder, lines: customerOrderLines }));
    }
  }, [customerOrder, customerOrderLines]);

  async function refreshAll() {
    await Promise.all([loadSkus(), loadAllSkus(), loadMovements(), loadCustomerOrders()]);
  }

  async function loadSkus(search = query) {
    const data = await api<Sku[]>(`/api/inventory?q=${encodeURIComponent(search)}`);
    setSkus(data);
  }

  async function loadAllSkus() {
    const data = await api<Sku[]>("/api/inventory");
    setAllSkus(data);
  }

  async function loadMovements() {
    const params = new URLSearchParams();
    Object.entries(movementFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const data = await api<Movement[]>(`/api/stock-movements?${params.toString()}`);
    setMovements(data);
  }

  async function loadCustomerOrders() {
    const data = await api<CustomerOrder[]>("/api/customer-orders");
    setCustomerOrders(data);
  }

  async function loadAiConfig() {
    try {
      const config = await api<AiConfigResponse>("/api/ai/config");
      setAiConfig((current) => ({
        ...current,
        apiUrl: config.apiUrl,
        model: config.model,
        apiKey: "",
        hasApiKey: config.hasApiKey
      }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadUsers() {
    try {
      const data = await api<ManagedUser[]>("/api/users");
      setManagedUsers(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify(newUserForm)
      });
      setNewUserForm({ username: "", password: "" });
      setMessage("已添加账号");
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function resetUserPassword(target: ManagedUser) {
    const password = window.prompt(`为「${target.username}」设置新密码（至少 4 位）`);
    if (password === null) return;
    setError("");
    setMessage("");
    try {
      await api(`/api/users/${target.id}/password`, {
        method: "POST",
        body: JSON.stringify({ password })
      });
      setMessage(`已重置「${target.username}」的密码`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteUser(target: ManagedUser) {
    if (!window.confirm(`确定删除账号「${target.username}」？该账号的历史库存流水会保留，但不再显示操作人。`)) return;
    setError("");
    setMessage("");
    try {
      await api(`/api/users/${target.id}`, { method: "DELETE" });
      setMessage(`已删除账号「${target.username}」`);
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitWithFeedback(action: () => Promise<void>, success: string) {
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await refreshAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function createSalesLineId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function resetSalesOrderForm() {
    setCustomerOrder({ ...emptySalesOrder, orderDate: today() });
    setSelectedCustomerOrderStyle("");
    setCustomerOrderLines([]);
    setCustomerOrderAiResult(null);
    setCustomerOrderAiTextContent("");
    window.localStorage.removeItem(salesOrderAutosaveStorageKey);
  }

  function addCustomerOrderStyleLine(styleNo = selectedCustomerOrderStyle) {
    const styleSkus = allSkus.filter((sku) => sku.styleNo === styleNo);
    const line = styleSkus.length
      ? createSalesOrderLineFromSkus(styleSkus, createSalesLineId())
      : createEmptySalesOrderLine(createSalesLineId());
    setCustomerOrderLines((current) => [...current, line]);
  }

  function hangCustomerOrderDraft() {
    if (!hasSalesDraftContent(customerOrder, customerOrderLines)) {
      setError("当前没有可挂单内容");
      return;
    }
    const summary = summarizeSalesOrder(customerOrderLines, customerOrder);
    const draft: SalesOrderDraft = {
      id: createSalesLineId(),
      savedAt: new Date().toISOString(),
      order: customerOrder,
      lines: customerOrderLines,
      customer: customerOrder.customer || "未填客户",
      totalQuantity: summary.totalQuantity,
      amountDue: summary.amountDue
    };
    setSalesDrafts((current) => [draft, ...current].slice(0, 30));
    resetSalesOrderForm();
    setMessage("已挂单到本机草稿");
  }

  function restoreCustomerOrderDraft() {
    const autosave = loadSalesAutosave();
    const candidates: SalesOrderDraft[] = [
      ...(autosave
        ? [
            {
              id: "autosave",
              savedAt: new Date().toISOString(),
              order: autosave.order,
              lines: autosave.lines,
              customer: autosave.order.customer || "未保存草稿",
              totalQuantity: summarizeSalesOrder(autosave.lines, autosave.order).totalQuantity,
              amountDue: summarizeSalesOrder(autosave.lines, autosave.order).amountDue
            }
          ]
        : []),
      ...salesDrafts
    ];
    if (!candidates.length) {
      setError("暂无可恢复草稿");
      return;
    }
    const choice =
      candidates.length === 1
        ? "1"
        : window.prompt(
            candidates
              .map((draft, index) => `${index + 1}. ${draft.customer} / ${draft.totalQuantity}件 / ${formatMoneyValue(draft.amountDue)} / ${new Date(draft.savedAt).toLocaleString()}`)
              .join("\n"),
            "1"
          );
    if (!choice) return;
    const draft = candidates[Number(choice) - 1];
    if (!draft) {
      setError("草稿序号不存在");
      return;
    }
    setCustomerOrder({ ...emptySalesOrder, ...draft.order });
    setCustomerOrderLines(draft.lines || []);
    if (draft.id !== "autosave") setSalesDrafts((current) => current.filter((item) => item.id !== draft.id));
    setMessage("已恢复本机草稿");
  }

  async function createSku(event: React.FormEvent) {
    event.preventDefault();
    await submitWithFeedback(async () => {
      await api<Sku>("/api/skus", { method: "POST", body: JSON.stringify(skuForm) });
      setSkuForm(emptySkuForm);
    }, "SKU 已保存");
  }

  async function createNewStyle(event: React.FormEvent) {
    event.preventDefault();
    await submitWithFeedback(async () => {
      const items = collectNewStyleSkus(newStyleForm);
      for (const item of items) {
        await api<Sku>("/api/skus", { method: "POST", body: JSON.stringify(item) });
      }
      setNewStyleForm(createQuickSkuForm(inboundDefaultSizes));
      setTab("inbound");
    }, "新款已添加，可在库存入库中选择该款号补货");
  }

  async function createInbound(event: React.FormEvent) {
    event.preventDefault();
    await submitWithFeedback(async () => {
      await api("/api/inbound-orders", {
        method: "POST",
        body: JSON.stringify({
          ...inbound,
          items: collectQuickItems(inboundMatrix, "unitCost", inbound.unitCost)
        })
      });
      setInbound({ supplier: "", inboundDate: today(), unitCost: "0", note: "" });
      setInboundMatrix(createQuickSkuForm(inboundDefaultSizes));
      setSelectedInboundStyle("");
    }, "库存入库已完成");
  }

  async function recognizeInboundImage(file = aiImage) {
    setError("");
    setMessage("");
    setAiResult(null);
    if (!file) {
      setError("请先上传入库表格图片");
      return;
    }
    if (!aiConfig.hasApiKey) {
      setError("请先保存 AI API 配置");
      return;
    }
    setAiLoading(true);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const result = await api<AiParseResponse>("/api/ai/inbound-table", {
        method: "POST",
        body: JSON.stringify({
          imageDataUrl,
          styleNo: inboundMatrix.styleNo,
          productName: inboundMatrix.productName,
          supplier: inbound.supplier || inboundMatrix.supplier,
          colorsText: inboundMatrix.colorsText,
          sizesText: inboundMatrix.sizesText
        })
      });
      setAiResult(result);
      setMessage(`AI 已识别 ${result.items.length} 条可入库明细`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  async function recognizeInboundText(textContent = aiTextContent) {
    setError("");
    setMessage("");
    setAiResult(null);
    const trimmedText = textContent.trim();
    if (!trimmedText) {
      setError("请先输入或粘贴入库文字内容");
      return;
    }
    if (!aiConfig.hasApiKey) {
      setError("请先到设置保存 AI API 配置");
      return;
    }
    setAiLoading(true);
    try {
      const result = await api<AiParseResponse>("/api/ai/inbound-table", {
        method: "POST",
        body: JSON.stringify({
          textContent: trimmedText,
          styleNo: inboundMatrix.styleNo,
          productName: inboundMatrix.productName,
          supplier: inbound.supplier || inboundMatrix.supplier,
          colorsText: inboundMatrix.colorsText,
          sizesText: inboundMatrix.sizesText
        })
      });
      setAiResult(result);
      setMessage(`AI 已识别 ${result.items.length} 条可入库明细`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  async function recognizeCustomerOrderImage(file = customerOrderAiImage) {
    setError("");
    setMessage("");
    setCustomerOrderAiResult(null);
    if (!file) {
      setError("请先上传客户订单表格图片");
      return;
    }
    if (!aiConfig.hasApiKey) {
      setError("请先保存 AI API 配置");
      return;
    }
    setCustomerOrderAiLoading(true);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const contextForm = selectedCustomerOrderStyle
        ? buildInboundFormFromStyle(allSkus.filter((sku) => sku.styleNo === selectedCustomerOrderStyle))
        : createQuickSkuForm(inboundDefaultSizes);
      const result = await api<AiParseResponse>("/api/ai/inbound-table", {
        method: "POST",
        body: JSON.stringify({
          imageDataUrl,
          styleNo: contextForm.styleNo,
          productName: contextForm.productName,
          supplier: contextForm.supplier,
          colorsText: contextForm.colorsText,
          sizesText: contextForm.sizesText
        })
      });
      setCustomerOrderAiResult(result);
      setMessage(`AI 已识别 ${result.items.length} 条客户订单明细`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCustomerOrderAiLoading(false);
    }
  }

  async function recognizeCustomerOrderText(textContent = customerOrderAiTextContent) {
    setError("");
    setMessage("");
    setCustomerOrderAiResult(null);
    const trimmedText = textContent.trim();
    if (!trimmedText) {
      setError("请先输入或粘贴客户订单文字内容");
      return;
    }
    if (!aiConfig.hasApiKey) {
      setError("请先到设置保存 AI API 配置");
      return;
    }
    setCustomerOrderAiLoading(true);
    try {
      const contextForm = selectedCustomerOrderStyle
        ? buildInboundFormFromStyle(allSkus.filter((sku) => sku.styleNo === selectedCustomerOrderStyle))
        : createQuickSkuForm(inboundDefaultSizes);
      const result = await api<AiParseResponse>("/api/ai/inbound-table", {
        method: "POST",
        body: JSON.stringify({
          textContent: trimmedText,
          styleNo: contextForm.styleNo,
          productName: contextForm.productName,
          supplier: contextForm.supplier,
          colorsText: contextForm.colorsText,
          sizesText: contextForm.sizesText
        })
      });
      setCustomerOrderAiResult(result);
      setMessage(`AI 已识别 ${result.items.length} 条客户订单明细`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCustomerOrderAiLoading(false);
    }
  }

  async function saveAiConfig() {
    setError("");
    setMessage("");
    try {
      const config = await api<AiConfigResponse>("/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({
          apiUrl: aiConfig.apiUrl,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey
        })
      });
      setAiConfig((current) => ({
        ...current,
        apiUrl: config.apiUrl,
        model: config.model,
        apiKey: "",
        hasApiKey: config.hasApiKey
      }));
      setMessage("AI API 配置已保存到当前账户");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function applyAiResult() {
    if (!aiResult?.items.length) {
      setError("没有可应用的识别结果");
      return;
    }
    const firstWithMeta = aiResult.items.find((item) => item.styleNo || item.productName || item.supplier || item.unitCost);
    const targetStyleNo = inboundMatrix.styleNo || firstWithMeta?.styleNo || "";
    const knownColors = knownColorsForStyle(allSkus, targetStyleNo);
    const knownColorSet = new Set(knownColors);
    const recognizedColors = Array.from(new Set(aiResult.items.map((item) => item.color.trim()).filter(Boolean)));
    const unknownColors = knownColors.length ? recognizedColors.filter((color) => !knownColorSet.has(color)) : [];
    const colorMap: Record<string, string> = {};

    for (const color of unknownColors) {
      const answer = window.prompt(
        `AI 识别到颜色“${color}”，但款号 ${targetStyleNo} 的原有库存颜色里没有这个颜色。\n原有颜色：${knownColors.join("、")}\n请确认实际颜色；保留默认值将作为新颜色入库，留空则跳过该颜色。`,
        color
      );
      if (answer === null) {
        setMessage("已取消应用 AI 识别结果");
        return;
      }
      colorMap[color] = answer.trim();
    }

    const confirmedItems = remapRecognizedItemColors(aiResult.items, colorMap);
    if (!confirmedItems.length) {
      setError("确认颜色后没有可应用的识别结果");
      return;
    }
    const nextMatrix = mergeRecognizedInboundItems(inboundMatrix, confirmedItems);
    setInboundMatrix({
      ...nextMatrix,
      styleNo: nextMatrix.styleNo || firstWithMeta?.styleNo || "",
      productName: nextMatrix.productName || firstWithMeta?.productName || "",
      supplier: nextMatrix.supplier || firstWithMeta?.supplier || ""
    });
    setInbound((current) => ({
      ...current,
      supplier: current.supplier || firstWithMeta?.supplier || nextMatrix.supplier,
      unitCost: current.unitCost !== "0" ? current.unitCost : firstWithMeta?.unitCost ? String(firstWithMeta.unitCost) : current.unitCost
    }));
    setMessage(`已预填 ${confirmedItems.length} 条识别结果，请核对后确认入库`);
  }

  function applyCustomerOrderAiResult() {
    if (!customerOrderAiResult?.items.length) {
      setError("没有可应用的识别结果");
      return;
    }
    const items = customerOrderAiResult.items.map((item) => ({
      ...item,
      styleNo: item.styleNo || selectedCustomerOrderStyle || undefined
    }));
    setCustomerOrderLines((current) => mergeRecognizedSalesItems(current, items, allSkus, createSalesLineId, "0"));
    setMessage(`已预填 ${customerOrderAiResult.items.length} 条销售明细，请核对后保存并扣库存`);
  }

  async function createOutbound(event: React.FormEvent) {
    event.preventDefault();
    await submitWithFeedback(async () => {
      await api("/api/outbound-orders", {
        method: "POST",
        body: JSON.stringify({
          ...outbound,
          items: collectExistingSkuItems(
            allSkus.filter((sku) => sku.styleNo === selectedOutboundStyle),
            outboundQuantities,
            "unitPrice",
            outbound.unitPrice,
            "出库"
          )
        })
      });
      setOutbound({ customer: "", channel: "", outboundDate: today(), unitPrice: "0", note: "" });
      setSelectedOutboundStyle("");
      setOutboundQuantities({});
    }, "库存出库已完成");
  }

  async function createCustomerOrder(event: React.FormEvent) {
    event.preventDefault();
    await submitWithFeedback(async () => {
      await api<CustomerOrder>("/api/customer-orders", {
        method: "POST",
        body: JSON.stringify({
          ...customerOrder,
          items: collectSalesOrderItems(customerOrderLines)
        })
      });
      resetSalesOrderForm();
    }, "销售开单已保存，库存已扣减");
  }

  async function shipCustomerOrder(order: CustomerOrder) {
    if (!window.confirm(`确认发货并扣减库存？客户：${order.customer}${order.orderNo ? `，订单：${order.orderNo}` : ""}`)) return;
    await submitWithFeedback(async () => {
      await api<CustomerOrder>(`/api/customer-orders/${order.id}/ship`, {
        method: "POST",
        body: JSON.stringify({ outboundDate: today() })
      });
    }, "客户订单已发货，库存已扣减");
  }

  async function deleteCustomerOrder(order: CustomerOrder) {
    const total = order.items.reduce((sum, item) => sum + item.quantity, 0);
    const rollbackHint = order.status === "SHIPPED" ? `\n该订单已扣库存，删除后会自动回退 ${total} 件库存。` : "";
    if (!window.confirm(`确认删除销售订单？客户：${order.customer}${order.orderNo ? `，订单：${order.orderNo}` : ""}${rollbackHint}`)) return;
    await submitWithFeedback(async () => {
      await api<{ id: number; restoredStock: boolean; restoredQuantity: number }>(`/api/customer-orders/${order.id}`, {
        method: "DELETE"
      });
    }, order.status === "SHIPPED" ? "销售订单已删除，库存已回退" : "销售订单已删除");
  }

  async function toggleSku(sku: Sku) {
    await submitWithFeedback(async () => {
      await api(`/api/skus/${sku.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...sku, isActive: !sku.isActive })
      });
    }, sku.isActive ? "SKU 已停用" : "SKU 已启用");
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  async function exportBackup() {
    setError("");
    setMessage("");
    setBackupLoading(true);
    try {
      const response = await fetch("/api/backup/export", { credentials: "include" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error || "备份导出失败");
      }
      const blob = await response.blob();
      downloadBlob(blob, `fashion-inventory-backup-${today()}.json`);
      setMessage("数据备份包已生成并下载");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBackupLoading(false);
    }
  }

  const stats = useMemo(() => {
    const total = skus.reduce((sum, sku) => sum + sku.quantity, 0);
    const soldTotal = skus.reduce((sum, sku) => sum + (sku.soldQuantity || 0), 0);
    const negative = skus.filter((sku) => sku.quantity < 0).length;
    return { total, soldTotal, negative, skuCount: skus.length };
  }, [skus]);
  const styleOptions = useMemo(() => buildStyleOptions(allSkus), [allSkus]);
  const selectedOutboundSkus = useMemo(
    () => allSkus.filter((sku) => sku.styleNo === selectedOutboundStyle),
    [allSkus, selectedOutboundStyle]
  );
  const salesSizes = useMemo(() => salesOrderSizes(customerOrderLines), [customerOrderLines]);
  if (loading) return <main className="loading">加载中</main>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Dooker</p>
          <h1>服装供销存</h1>
        </div>
        <nav>
          {[
            ["inventory", "库存查询"],
            ["new-style", "添加新款"],
            ["sku", "SKU 管理"],
            ["inbound", "库存入库"],
            ["customer-orders", "销售开单"],
            ["settings", "设置"],
            ["outbound", "库存出库"],
            ["movements", "库存流水"],
            ["backup", "数据备份"]
          ].map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={logout}>
          退出 {user.username}
        </button>
        <div className="build-badge">{appBuildLabel}</div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="metric">
            <span>SKU</span>
            <strong>{stats.skuCount}</strong>
          </div>
          <div className="metric">
            <span>库存总计</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="metric">
            <span>已销售数量</span>
            <strong>{stats.soldTotal}</strong>
          </div>
          <div className={stats.negative ? "metric danger" : "metric"}>
            <span>负库存款数</span>
            <strong>{stats.negative}</strong>
          </div>
        </header>

        {(message || error) && <div className={error ? "notice error" : "notice"}>{error || message}</div>}

        {tab === "inventory" && (
          <Panel title="商品库存查询 - 尺码横排显示">
            <div className="toolbar">
              <input
                placeholder="搜索款号、商品名称、颜色、尺码"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadSkus();
                }}
              />
              <button className="primary" onClick={() => loadSkus()}>
                查询
              </button>
            </div>
            <InventoryMatrix skus={skus} />
          </Panel>
        )}

        {tab === "sku" && (
          <Panel title="SKU 管理">
            <form onSubmit={createSku} className="form-block">
              <SkuFields value={skuForm} onChange={setSkuForm} />
              <button className="primary" type="submit">
                保存 SKU
              </button>
            </form>
            <SkuTable skus={skus} onToggle={toggleSku} showActions />
          </Panel>
        )}

        {tab === "new-style" && (
          <Panel title="添加新款 - 建立款号与颜色尺码">
            <form onSubmit={createNewStyle} className="form-block">
              <QuickSkuMatrix value={newStyleForm} onChange={setNewStyleForm} showQuantities={false} />
              <p className="hint">添加新款只建立款号、供应商和颜色尺码 SKU，不增加库存数量；保存后到库存入库页面选择该款号补货。</p>
              <button className="primary" type="submit">
                保存新款
              </button>
            </form>
          </Panel>
        )}

        {tab === "inbound" && (
          <Panel title="库存入库 - 选择款号快捷入库">
            <form onSubmit={createInbound} className="form-block">
              <div className="grid two">
                <label>
                  选择款号
                  <select
                    value={selectedInboundStyle}
                    onChange={(event) => {
                      const styleNo = event.target.value;
                      const styleSkus = allSkus.filter((sku) => sku.styleNo === styleNo);
                      setSelectedInboundStyle(styleNo);
                      setInboundMatrix(
                        styleNo ? buildInboundFormFromStyle(styleSkus) : createQuickSkuForm(inboundDefaultSizes)
                      );
                      setInbound((current) => ({ ...current, supplier: styleNo ? supplierFromStyle(styleSkus) : "" }));
                    }}
                    required
                  >
                    <option value="">请选择已有款号</option>
                    {styleOptions.map((option) => (
                      <option key={option.styleNo} value={option.styleNo}>
                        {option.styleNo} / {option.productName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  供应商
                  <input value={inbound.supplier} onChange={(event) => setInbound({ ...inbound, supplier: event.target.value })} required />
                </label>
                <label>
                  入库日期
                  <input type="date" value={inbound.inboundDate} onChange={(event) => setInbound({ ...inbound, inboundDate: event.target.value })} />
                </label>
                <label>
                  入库单价
                  <input type="number" min="0" step="0.01" value={inbound.unitCost} onChange={(event) => setInbound({ ...inbound, unitCost: event.target.value })} />
                </label>
              </div>
              <div className="ai-prefill">
                <div className="ai-prefill-header">
                  <div>
                    <h3>AI 识图预填</h3>
                    <p className="hint">
                      {aiConfig.hasApiKey ? "上传图片或文字后自动识别并预填矩阵。" : "请先到设置中保存 AI API 配置。"}
                    </p>
                  </div>
                  <div className="ai-upload-actions">
                    <label className={aiLoading ? "upload-button disabled" : "upload-button"}>
                      {aiLoading ? "识别中" : "上传图片"}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={aiLoading}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setAiImage(file);
                          void recognizeInboundImage(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <button className={aiLoading ? "upload-button disabled" : "upload-button"} type="button" onClick={() => void recognizeInboundText()} disabled={aiLoading}>
                      文字上传
                    </button>
                  </div>
                </div>
                <textarea
                  className="ai-text-input"
                  value={aiTextContent}
                  onChange={(event) => setAiTextContent(event.target.value)}
                  placeholder="粘贴入库表格文字，例如：颜色、尺码、数量、款号等内容"
                  disabled={aiLoading}
                />
                {aiResult && (
                  <div className="ai-result">
                    <div className="ai-result-summary">
                      <strong>{aiResult.items.length}</strong>
                      <span>条识别明细</span>
                      <button className="small" type="button" onClick={applyAiResult}>
                        应用到矩阵
                      </button>
                    </div>
                    {!!aiResult.notes.length && <p className="hint">{aiResult.notes.join("；")}</p>}
                    <div className="table-wrap ai-result-table-wrap">
                      <table className="ai-result-table">
                        <thead>
                          <tr>
                            <th>颜色</th>
                            <th>尺码</th>
                            <th>数量</th>
                            <th>款号</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiResult.items.slice(0, 12).map((item, index) => (
                            <tr key={`${item.color}-${item.size}-${index}`}>
                              <td>{item.color}</td>
                              <td>{item.size}</td>
                              <td>{item.quantity}</td>
                              <td>{item.styleNo || inboundMatrix.styleNo || "-"}</td>
                            </tr>
                          ))}
                          {!aiResult.items.length && (
                            <tr>
                              <td colSpan={4} className="empty">
                                暂无可应用明细
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <QuickSkuMatrix value={inboundMatrix} onChange={setInboundMatrix} />
              <p className="hint">已自动填充该款号供应商、颜色和尺码；原先没有 SKU 的空格也可以填写数量，提交后会自动创建并入库。</p>
              <button className="primary" type="submit">
                确认入库
              </button>
            </form>
          </Panel>
        )}

        {tab === "outbound" && (
          <Panel title="库存出库 - 按款号快捷出库">
            <form onSubmit={createOutbound} className="form-block">
              <div className="grid two">
                <label>
                  选择款号
                  <select
                    value={selectedOutboundStyle}
                    onChange={(event) => {
                      setSelectedOutboundStyle(event.target.value);
                      setOutboundQuantities({});
                    }}
                    required
                  >
                    <option value="">请选择款号</option>
                    {styleOptions.map((option) => (
                      <option key={option.styleNo} value={option.styleNo}>
                        {option.styleNo} / {option.productName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  客户
                  <input value={outbound.customer} onChange={(event) => setOutbound({ ...outbound, customer: event.target.value })} required />
                </label>
                <label>
                  渠道
                  <input value={outbound.channel} onChange={(event) => setOutbound({ ...outbound, channel: event.target.value })} />
                </label>
                <label>
                  出库日期
                  <input type="date" value={outbound.outboundDate} onChange={(event) => setOutbound({ ...outbound, outboundDate: event.target.value })} />
                </label>
                <label>
                  出库单价
                  <input type="number" min="0" step="0.01" value={outbound.unitPrice} onChange={(event) => setOutbound({ ...outbound, unitPrice: event.target.value })} />
                </label>
              </div>
              <SkuQuantityMatrix
                skus={selectedOutboundSkus}
                quantities={outboundQuantities}
                onChange={setOutboundQuantities}
                title="出库数量填写"
                emptyText="请选择款号后填写出库数量"
              />
              <p className="hint">库存不足也会允许出库，库存查询中会用红色标记负库存。</p>
              <button className="primary" type="submit">
                确认出库
              </button>
            </form>
          </Panel>
        )}

        {tab === "customer-orders" && (
          <Panel title="销售开单 - 保存即扣库存">
            <form onSubmit={createCustomerOrder} className="form-block sales-order-form">
              <div className="sales-actions">
                <button className="primary" type="submit">
                  保存并扣库存
                </button>
                <button className="small" type="button" onClick={hangCustomerOrderDraft}>
                  挂单
                </button>
                <button className="small" type="button" onClick={restoreCustomerOrderDraft}>
                  取未保存
                </button>
                <button className="ghost" type="button" onClick={resetSalesOrderForm}>
                  清空
                </button>
                <span className="hint">本机草稿 {salesDrafts.length} 单</span>
              </div>

              <div className="sales-header-grid">
                <label>
                  客户
                  <input value={customerOrder.customer} onChange={(event) => setCustomerOrder({ ...customerOrder, customer: event.target.value })} required />
                </label>
                <label>
                  店员
                  <input value={user.username} readOnly />
                </label>
                <label>
                  客户订单
                  <input value={customerOrder.orderNo} onChange={(event) => setCustomerOrder({ ...customerOrder, orderNo: event.target.value })} placeholder="客户订单号或平台单号" />
                </label>
                <label>
                  渠道
                  <input value={customerOrder.channel} onChange={(event) => setCustomerOrder({ ...customerOrder, channel: event.target.value })} />
                </label>
                <label>
                  日期
                  <input type="date" value={customerOrder.orderDate} onChange={(event) => setCustomerOrder({ ...customerOrder, orderDate: event.target.value })} />
                </label>
                <label>
                  备注
                  <input value={customerOrder.note} onChange={(event) => setCustomerOrder({ ...customerOrder, note: event.target.value })} />
                </label>
              </div>

              <div className="sales-add-row">
                <label>
                  选择款号
                  <select
                    value={selectedCustomerOrderStyle}
                    onChange={(event) => {
                      setSelectedCustomerOrderStyle(event.target.value);
                      setCustomerOrderAiResult(null);
                    }}
                  >
                    <option value="">请选择款号</option>
                    {styleOptions.map((option) => (
                      <option key={option.styleNo} value={option.styleNo}>
                        {option.styleNo} / {option.productName}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="small" type="button" onClick={() => addCustomerOrderStyleLine()} disabled={!selectedCustomerOrderStyle}>
                  货品+
                </button>
                <button className="small" type="button" onClick={() => addCustomerOrderStyleLine("")}>
                  空白行
                </button>
              </div>

              <div className="ai-prefill">
                <div className="ai-prefill-header">
                  <div>
                    <h3>AI 识图预填</h3>
                    <p className="hint">
                      {aiConfig.hasApiKey ? "上传图片或文字后自动识别并预填销售行。" : "请先到设置中保存 AI API 配置。"}
                    </p>
                  </div>
                  <div className="ai-upload-actions">
                    <label className={customerOrderAiLoading ? "upload-button disabled" : "upload-button"}>
                      {customerOrderAiLoading ? "识别中" : "上传图片"}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={customerOrderAiLoading}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setCustomerOrderAiImage(file);
                          void recognizeCustomerOrderImage(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      className={customerOrderAiLoading ? "upload-button disabled" : "upload-button"}
                      type="button"
                      onClick={() => void recognizeCustomerOrderText()}
                      disabled={customerOrderAiLoading}
                    >
                      文字上传
                    </button>
                  </div>
                </div>
                <textarea
                  className="ai-text-input"
                  value={customerOrderAiTextContent}
                  onChange={(event) => setCustomerOrderAiTextContent(event.target.value)}
                  placeholder="粘贴客户订单文字，例如：客户订单表格、颜色、尺码、数量、款号等内容"
                  disabled={customerOrderAiLoading}
                />
                {customerOrderAiResult && (
                  <div className="ai-result">
                    <div className="ai-result-summary">
                      <strong>{customerOrderAiResult.items.length}</strong>
                      <span>条识别明细</span>
                      <button className="small" type="button" onClick={applyCustomerOrderAiResult}>
                        应用到销售行
                      </button>
                    </div>
                    {!!customerOrderAiResult.notes.length && <p className="hint">{customerOrderAiResult.notes.join("；")}</p>}
                    <div className="table-wrap ai-result-table-wrap">
                      <table className="ai-result-table">
                        <thead>
                          <tr>
                            <th>颜色</th>
                            <th>尺码</th>
                            <th>数量</th>
                            <th>款号</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerOrderAiResult.items.slice(0, 12).map((item, index) => (
                            <tr key={`${item.color}-${item.size}-${index}`}>
                              <td>{item.color}</td>
                              <td>{item.size}</td>
                              <td>{item.quantity}</td>
                              <td>{item.styleNo || selectedCustomerOrderStyle || "-"}</td>
                            </tr>
                          ))}
                          {!customerOrderAiResult.items.length && (
                            <tr>
                              <td colSpan={4} className="empty">
                                暂无可应用明细
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <SalesOrderLineTable sizes={salesSizes} lines={customerOrderLines} setLines={setCustomerOrderLines} />
              <p className="hint">保存销售开单会立即创建出库单、扣减库存并写入库存流水；历史待发货订单仍可在列表中发货扣库存。</p>
            </form>
            <CustomerOrderTable orders={customerOrders} onShip={shipCustomerOrder} onDelete={deleteCustomerOrder} printTemplate={printTemplate} />
          </Panel>
        )}

        {tab === "settings" && (
          <Panel title="设置">
            <UserPanel
              users={managedUsers}
              currentUserId={user.id}
              form={newUserForm}
              setForm={setNewUserForm}
              onCreate={createUser}
              onResetPassword={resetUserPassword}
              onDelete={deleteUser}
            />
            <AiConfigPanel aiConfig={aiConfig} setAiConfig={setAiConfig} onSave={saveAiConfig} />
            <PrintTemplatePanel printTemplate={printTemplate} setPrintTemplate={setPrintTemplate} />
          </Panel>
        )}

        {tab === "movements" && (
          <Panel title="库存流水">
            <div className="toolbar wrap">
              <input
                placeholder="搜索 SKU"
                value={movementFilters.q}
                onChange={(event) => setMovementFilters({ ...movementFilters, q: event.target.value })}
              />
              <select value={movementFilters.type} onChange={(event) => setMovementFilters({ ...movementFilters, type: event.target.value })}>
                <option value="">全部类型</option>
                <option value="INBOUND">入库</option>
                <option value="OUTBOUND">出库</option>
              </select>
              <input type="date" value={movementFilters.from} onChange={(event) => setMovementFilters({ ...movementFilters, from: event.target.value })} />
              <input type="date" value={movementFilters.to} onChange={(event) => setMovementFilters({ ...movementFilters, to: event.target.value })} />
              <button className="primary" onClick={loadMovements}>
                筛选
              </button>
            </div>
            <MovementTable movements={movements} />
          </Panel>
        )}

        {tab === "backup" && (
          <Panel title="数据备份">
            <div className="backup-panel">
              <div>
                <h3>一键打包业务数据</h3>
                <p className="hint">备份包包含库存快照、商品/SKU、入库单、出库单、销售开单和库存流水，不包含已保存的 AI API Key。</p>
              </div>
              <button className="primary" type="button" onClick={exportBackup} disabled={backupLoading}>
                {backupLoading ? "正在打包" : "下载备份包"}
              </button>
            </div>
            <div className="backup-grid">
              <div className="backup-card">
                <strong>库存</strong>
                <span>当前库存、负库存、已销售数量</span>
              </div>
              <div className="backup-card">
                <strong>SKU</strong>
                <span>款号、颜色、尺码、价格和启用状态</span>
              </div>
              <div className="backup-card">
                <strong>开单</strong>
                <span>客户订单、待发货/已发货状态和明细</span>
              </div>
              <div className="backup-card">
                <strong>流水</strong>
                <span>入库、出库和库存变动记录</span>
              </div>
            </div>
          </Panel>
        )}
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function UserPanel({
  users,
  currentUserId,
  form,
  setForm,
  onCreate,
  onResetPassword,
  onDelete
}: {
  users: ManagedUser[];
  currentUserId: number;
  form: { username: string; password: string };
  setForm: React.Dispatch<React.SetStateAction<{ username: string; password: string }>>;
  onCreate: (event: React.FormEvent) => void;
  onResetPassword: (target: ManagedUser) => void;
  onDelete: (target: ManagedUser) => void;
}) {
  return (
    <div className="print-template-panel">
      <div className="print-template-header">
        <div>
          <h3>账号管理</h3>
          <p className="hint">每位同事用独立账号登录，库存流水会记录是谁操作的。任何账号都可以在这里添加或管理其他账号。</p>
        </div>
      </div>
      <form onSubmit={onCreate} className="sales-add-row">
        <label>
          用户名
          <input
            value={form.username}
            onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
            placeholder="例如 xiaowang"
            required
          />
        </label>
        <label>
          初始密码
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="至少 4 位"
            required
          />
        </label>
        <button className="primary" type="submit">
          添加账号
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>用户名</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">
                  暂无账号
                </td>
              </tr>
            )}
            {users.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.username}
                  {item.id === currentUserId && <span className="sku-dot" style={{ marginLeft: 8 }}>当前</span>}
                </td>
                <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                <td>
                  <div className="order-actions">
                    <button className="small" type="button" onClick={() => onResetPassword(item)}>
                      改密码
                    </button>
                    <button
                      className="small danger-button"
                      type="button"
                      onClick={() => onDelete(item)}
                      disabled={item.id === currentUserId}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiConfigPanel({
  aiConfig,
  setAiConfig,
  onSave
}: {
  aiConfig: AiConfigState;
  setAiConfig: React.Dispatch<React.SetStateAction<AiConfigState>>;
  onSave: () => void;
}) {
  return (
    <div className="print-template-panel">
      <div className="print-template-header">
        <div>
          <h3>AI 识别设置</h3>
          <p className="hint">库存入库和销售开单共用同一套 AI API 配置，保存后上传图片或文字即可识别。</p>
        </div>
        <span className={aiConfig.hasApiKey ? "success-text" : "hint"}>{aiConfig.hasApiKey ? "已绑定当前账户" : "尚未保存 API Key"}</span>
      </div>
      <div className="grid two">
        <label>
          API 地址
          <input value={aiConfig.apiUrl} onChange={(event) => setAiConfig({ ...aiConfig, apiUrl: event.target.value })} />
          <span className="hint">本机代理请用 host.docker.internal，不要用 localhost。</span>
        </label>
        <label>
          模型名
          <input value={aiConfig.model} onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })} />
        </label>
        <label>
          API Key
          <input
            type="password"
            value={aiConfig.apiKey}
            onChange={(event) => setAiConfig({ ...aiConfig, apiKey: event.target.value })}
            placeholder={aiConfig.hasApiKey ? "已保存，重新输入可替换" : "保存到当前账户"}
          />
        </label>
      </div>
      <div className="ai-actions">
        <button className="small" type="button" onClick={onSave}>
          保存 AI API 配置
        </button>
      </div>
    </div>
  );
}

function PrintTemplatePanel({
  printTemplate,
  setPrintTemplate
}: {
  printTemplate: PrintTemplateSettings;
  setPrintTemplate: React.Dispatch<React.SetStateAction<PrintTemplateSettings>>;
}) {
  return (
    <div className="print-template-panel">
      <div className="print-template-header">
        <div>
          <h3>打印模板设置</h3>
          <p className="hint">纸张尺寸按毫米设置，保存于当前浏览器；打印时使用这台电脑连接的打印机。</p>
        </div>
        <button className="small" type="button" onClick={() => setPrintTemplate(defaultPrintTemplate)}>
          恢复默认
        </button>
      </div>
      <div className="grid two">
        <label>
          模板标题
          <input value={printTemplate.title} onChange={(event) => setPrintTemplate({ ...printTemplate, title: event.target.value })} />
        </label>
        <label>
          标题字号 px
          <input
            type="number"
            min="10"
            max="96"
            value={printTemplate.titleFontSizePx}
            onChange={(event) => setPrintTemplate({ ...printTemplate, titleFontSizePx: event.target.value })}
          />
        </label>
        <label>
          客户标签
          <input value={printTemplate.customerLabel} onChange={(event) => setPrintTemplate({ ...printTemplate, customerLabel: event.target.value })} />
        </label>
        <label>
          客户姓名字号 px
          <input
            type="number"
            min="12"
            max="120"
            value={printTemplate.customerFontSizePx}
            onChange={(event) => setPrintTemplate({ ...printTemplate, customerFontSizePx: event.target.value })}
          />
        </label>
        <label>
          金额标签
          <input value={printTemplate.amountLabel} onChange={(event) => setPrintTemplate({ ...printTemplate, amountLabel: event.target.value })} />
        </label>
        <label>
          订单金额字号 px
          <input
            type="number"
            min="12"
            max="120"
            value={printTemplate.amountFontSizePx}
            onChange={(event) => setPrintTemplate({ ...printTemplate, amountFontSizePx: event.target.value })}
          />
        </label>
        <label>
          纸张宽度 mm
          <input
            type="number"
            min="40"
            max="420"
            value={printTemplate.paperWidthMm}
            onChange={(event) => setPrintTemplate({ ...printTemplate, paperWidthMm: event.target.value })}
          />
        </label>
        <label>
          纸张高度 mm
          <input
            type="number"
            min="30"
            max="420"
            value={printTemplate.paperHeightMm}
            onChange={(event) => setPrintTemplate({ ...printTemplate, paperHeightMm: event.target.value })}
          />
        </label>
        <label>
          页面边距 mm
          <input
            type="number"
            min="0"
            max="30"
            value={printTemplate.marginMm}
            onChange={(event) => setPrintTemplate({ ...printTemplate, marginMm: event.target.value })}
          />
        </label>
        <label>
          微信二维码图片地址
          <input value={printTemplate.qrImageUrl} onChange={(event) => setPrintTemplate({ ...printTemplate, qrImageUrl: event.target.value })} />
        </label>
        <label>
          上传微信二维码
          <input
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setPrintTemplate({ ...printTemplate, qrImageUrl: await fileToDataUrl(file) });
              event.target.value = "";
            }}
          />
        </label>
        <label>
          二维码尺寸 mm
          <input
            type="number"
            min="12"
            max="80"
            value={printTemplate.qrSizeMm}
            onChange={(event) => setPrintTemplate({ ...printTemplate, qrSizeMm: event.target.value })}
          />
        </label>
      </div>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={printTemplate.showMatrix}
          onChange={(event) => setPrintTemplate({ ...printTemplate, showMatrix: event.target.checked })}
        />
        打印商品明细矩阵
      </label>
      <label>
        附加内容
        <textarea
          value={printTemplate.extraContent}
          onChange={(event) => setPrintTemplate({ ...printTemplate, extraContent: event.target.value })}
          placeholder="如：全品类电商供货、联系电话、微信、发货备注等"
        />
      </label>
      <label>
        自定义打印 CSS
        <textarea
          className="code-textarea"
          value={printTemplate.customCss}
          onChange={(event) => setPrintTemplate({ ...printTemplate, customCss: event.target.value })}
          placeholder=".customer-name { font-size: 56px; text-align: center; }"
        />
      </label>
    </div>
  );
}

function SkuTable({ skus, onToggle, showActions }: { skus: Sku[]; onToggle: (sku: Sku) => void; showActions: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>款号</th>
            <th>商品名称</th>
            <th>颜色</th>
            <th>尺码</th>
            <th>库存</th>
            <th>状态</th>
            {showActions && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {skus.map((sku) => (
            <tr key={sku.id} className={sku.quantity < 0 ? "negative-row" : ""}>
              <td>{sku.styleNo}</td>
              <td>{sku.productName}</td>
              <td>{sku.color}</td>
              <td>{sku.size}</td>
              <td>
                <span className={sku.quantity < 0 ? "stock negative" : "stock"}>{sku.quantity}</span>
              </td>
              <td>{sku.isActive ? "启用" : "停用"}</td>
              {showActions && (
                <td>
                  <button className="small" onClick={() => onToggle(sku)}>
                    {sku.isActive ? "停用" : "启用"}
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!skus.length && (
            <tr>
              <td colSpan={showActions ? 7 : 6} className="empty">
                暂无数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SalesOrderLineTable({
  sizes,
  lines,
  setLines
}: {
  sizes: string[];
  lines: SalesOrderLine[];
  setLines: React.Dispatch<React.SetStateAction<SalesOrderLine[]>>;
}) {
  const visibleSizes = sizes.length ? sizes : parseFallbackSizes();

  function parseFallbackSizes() {
    return inboundDefaultSizes.split(",").map((size) => size.trim());
  }

  function updateLine(id: string, patch: Partial<SalesOrderLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function updateQuantity(line: SalesOrderLine, size: string, quantity: string) {
    setLines((current) =>
      current.map((item) =>
        item.id === line.id
          ? {
              ...item,
              sizes: item.sizes.includes(size) ? item.sizes : [...item.sizes, size].sort(compareSizes),
              quantities: { ...item.quantities, [size]: quantity }
            }
          : item
      )
    );
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((line) => line.id !== id));
  }

  return (
    <div className="table-wrap sales-lines-wrap">
      <table className="sales-lines-table">
        <colgroup>
          <col className="sales-index-col" />
          <col className="sales-product-col" />
          <col className="sales-color-col" />
          {visibleSizes.map((size) => (
            <col key={size} className="sales-size-col" />
          ))}
          <col className="sales-total-col" />
          <col className="sales-price-col" />
          <col className="sales-subtotal-col" />
          <col className="sales-note-col" />
          <col className="sales-action-col" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>货品</th>
            <th>颜色</th>
            {visibleSizes.map((size) => (
              <th key={size}>{size}</th>
            ))}
            <th>总数</th>
            <th>单价</th>
            <th>小计</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {lines.length ? (
            lines.map((line, index) => (
              <tr key={line.id}>
                <td className="number-cell">{index + 1}</td>
                <td className="sales-product-cell">
                  <div className="sales-product-fields">
                    <input value={line.styleNo} onChange={(event) => updateLine(line.id, { styleNo: event.target.value })} placeholder="款号" />
                    <input value={line.productName} onChange={(event) => updateLine(line.id, { productName: event.target.value })} placeholder="商品名称" />
                  </div>
                </td>
                <td>
                  <input value={line.color} onChange={(event) => updateLine(line.id, { color: event.target.value })} placeholder="颜色" />
                </td>
                {visibleSizes.map((size) => (
                  <td key={size}>
                    <input
                      className="matrix-input"
                      type="number"
                      min="0"
                      value={line.quantities[size] || ""}
                      onChange={(event) => updateQuantity(line, size, event.target.value)}
                    />
                  </td>
                ))}
                <td className="number-cell">{salesLineQuantity(line) || ""}</td>
                <td>
                  <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })} />
                </td>
                <td className="number-cell">{salesLineSubtotal(line) ? formatMoneyValue(salesLineSubtotal(line)) : ""}</td>
                <td>
                  <input value={line.note} onChange={(event) => updateLine(line.id, { note: event.target.value })} />
                </td>
                <td>
                  <button className="small danger-button" type="button" onClick={() => removeLine(line.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={visibleSizes.length + 8} className="empty">
                请选择款号后点击货品+，或通过粘贴/AI 识别生成销售明细
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CustomerOrderTable({
  orders,
  onShip,
  onDelete,
  printTemplate
}: {
  orders: CustomerOrder[];
  onShip: (order: CustomerOrder) => void;
  onDelete: (order: CustomerOrder) => void;
  printTemplate: PrintTemplateSettings;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>状态</th>
            <th>客户</th>
            <th>客户订单</th>
            <th>日期</th>
            <th>明细</th>
            <th>数量</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const total = order.items.reduce((sum, item) => sum + item.quantity, 0);
            return (
              <tr key={order.id}>
                <td>
                  <span className={order.status === "SHIPPED" ? "status-pill shipped" : "status-pill"}>{order.status === "SHIPPED" ? "已扣库存" : "待发货"}</span>
                </td>
                <td>{order.customer}</td>
                <td>{order.orderNo || "-"}</td>
                <td>{new Date(order.orderDate).toLocaleDateString()}</td>
                <td>
                  {order.items.slice(0, 3).map((item) => (
                    <div key={item.id}>
                      {item.styleNo} / {item.color} / {item.size} x {item.quantity}
                    </div>
                  ))}
                  {order.items.length > 3 && <span className="hint">等 {order.items.length} 项</span>}
                </td>
                <td className="number-cell">{total}</td>
                <td>
                  {order.status === "PENDING" ? (
                    <div className="order-actions">
                      <button className="small" onClick={() => exportCustomerOrderCsv(order)}>
                        导出表格
                      </button>
                      <button className="small" onClick={() => exportCustomerOrderImage(order)}>
                        导出图片
                      </button>
                      <button className="small" onClick={() => printCustomerOrder(order, printTemplate)}>
                        打印订单
                      </button>
                      <button className="small" onClick={() => printCustomerOrderPdf(order, printTemplate)}>
                        PDF打印
                      </button>
                      <button className="small" onClick={() => onShip(order)}>
                        发货扣库存
                      </button>
                      <button className="small danger-button" onClick={() => onDelete(order)}>
                        删除订单
                      </button>
                    </div>
                  ) : (
                    <div className="order-actions">
                      <button className="small" onClick={() => exportCustomerOrderCsv(order)}>
                        导出表格
                      </button>
                      <button className="small" onClick={() => exportCustomerOrderImage(order)}>
                        导出图片
                      </button>
                      <button className="small" onClick={() => printCustomerOrder(order, printTemplate)}>
                        打印订单
                      </button>
                      <button className="small" onClick={() => printCustomerOrderPdf(order, printTemplate)}>
                        PDF打印
                      </button>
                      <span className="hint">出库单 #{order.outboundOrderId}</span>
                      <button className="small danger-button" onClick={() => onDelete(order)}>
                        删除订单
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {!orders.length && (
            <tr>
              <td colSpan={7} className="empty">
                暂无销售单
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MovementTable({ movements }: { movements: Movement[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>SKU</th>
            <th>变化</th>
            <th>结存</th>
            <th>操作人</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id}>
              <td>{new Date(movement.createdAt).toLocaleString()}</td>
              <td>{movement.type === "INBOUND" ? "入库" : "出库"}</td>
              <td>
                {movement.sku.styleNo} / {movement.sku.productName} / {movement.sku.color} / {movement.sku.size}
              </td>
              <td className={movement.quantityChange < 0 ? "danger-text" : "success-text"}>{movement.quantityChange}</td>
              <td>{movement.balanceAfter}</td>
              <td>{movement.operator}</td>
            </tr>
          ))}
          {!movements.length && (
            <tr>
              <td colSpan={6} className="empty">
                暂无流水
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

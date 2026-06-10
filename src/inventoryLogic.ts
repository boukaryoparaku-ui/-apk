import type { InventoryRow, QuickSkuForm, RecognizedInboundItem, SalesOrderLine, SalesOrderPayments, Sku } from "./types";

export const defaultSizes = "S, M, L, XL, XXL";
export const inboundDefaultSizes = "M, L, XL, 2XL, 3XL, 4XL, 5XL";
export const salesPaymentKeys: Array<keyof SalesOrderPayments> = [
  "paymentWechat",
  "paymentCash",
  "paymentAlipay",
  "paymentCard",
  "paymentScan",
  "paymentTransfer"
];

const sizeOrder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "XXXXL", "4XL", "5XL"];

export function createQuickSkuForm(sizesText = defaultSizes): QuickSkuForm {
  return {
    styleNo: "",
    productName: "",
    supplier: "",
    category: "",
    brand: "",
    retailPrice: "",
    colorsText: "",
    sizesText,
    quantities: {}
  };
}

export function compareSizes(a: string, b: string) {
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

export function parseList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,，;；]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function matrixKey(color: string, size: string) {
  return `${color}::${size}`;
}

function inferAxisFromQuantities(quantities: Record<string, string>, axis: "color" | "size") {
  return Array.from(
    new Set(
      Object.keys(quantities)
        .map((key) => key.split("::")[axis === "color" ? 0 : 1])
        .filter(Boolean)
    )
  );
}

export function migrateQuickSkuAxis(form: QuickSkuForm, axis: "color" | "size", nextText: string): QuickSkuForm {
  const currentColors = parseList(form.colorsText);
  const currentSizes = parseList(form.sizesText).sort(compareSizes);
  const previousColors = currentColors.length ? currentColors : inferAxisFromQuantities(form.quantities, "color");
  const previousSizes = currentSizes.length ? currentSizes : inferAxisFromQuantities(form.quantities, "size").sort(compareSizes);
  const nextColors = axis === "color" ? parseList(nextText) : previousColors;
  const nextSizes = axis === "size" ? parseList(nextText).sort(compareSizes) : previousSizes;
  const textKey = axis === "color" ? "colorsText" : "sizesText";

  if ((axis === "color" && !nextColors.length) || (axis === "size" && !nextSizes.length)) {
    return { ...form, [textKey]: nextText };
  }

  const quantities: Record<string, string> = {};
  previousColors.forEach((previousColor, colorIndex) => {
    previousSizes.forEach((previousSize, sizeIndex) => {
      const quantity = form.quantities[matrixKey(previousColor, previousSize)];
      if (!quantity) return;
      const nextColor = nextColors[colorIndex] || previousColor;
      const nextSize = nextSizes[sizeIndex] || previousSize;
      quantities[matrixKey(nextColor, nextSize)] = quantity;
    });
  });

  return { ...form, [textKey]: nextText, quantities };
}

export function buildInventoryMatrix(skus: Sku[]) {
  const rows = new Map<string, InventoryRow>();
  const sizeSet = new Set<string>();

  skus.forEach((sku) => {
    sizeSet.add(sku.size);
    const key = [sku.styleNo, sku.productName, sku.color, sku.retailPrice || ""].join("::");
    const row =
      rows.get(key) ||
      ({
        key,
        styleNo: sku.styleNo,
        productName: sku.productName,
        unit: "件",
        color: sku.color,
        retailPrice: sku.retailPrice || "-",
        total: 0,
        soldQuantity: 0,
        sizes: {},
        hasNegative: false
      } satisfies InventoryRow);

    row.sizes[sku.size] = (row.sizes[sku.size] || 0) + sku.quantity;
    row.total += sku.quantity;
    row.soldQuantity += sku.soldQuantity || 0;
    row.hasNegative = row.hasNegative || sku.quantity < 0 || row.total < 0;
    rows.set(key, row);
  });

  return {
    sizes: Array.from(sizeSet).sort(compareSizes),
    rows: Array.from(rows.values()).sort((a, b) => {
      const style = a.styleNo.localeCompare(b.styleNo, "zh-CN", { numeric: true });
      return style || a.color.localeCompare(b.color, "zh-CN", { numeric: true });
    })
  };
}

export function collectQuickItems(form: QuickSkuForm, priceKey: "unitCost" | "unitPrice", priceValue: string) {
  const styleNo = form.styleNo.trim();
  const productName = form.productName.trim();
  const colors = parseList(form.colorsText);
  const sizes = parseList(form.sizesText).sort(compareSizes);

  if (!styleNo || !productName) throw new Error("款号和商品名称必填");
  if (!colors.length) throw new Error("至少填写一个颜色");
  if (!sizes.length) throw new Error("至少填写一个尺码");

  const items = [];
  for (const color of colors) {
    for (const size of sizes) {
      const rawQuantity = form.quantities[matrixKey(color, size)];
      if (!rawQuantity) continue;
      const quantity = Number(rawQuantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`${color} / ${size} 的数量必须是大于 0 的整数`);
      }
      items.push({
        styleNo,
        productName,
        supplier: form.supplier,
        category: form.category,
        brand: form.brand,
        retailPrice: form.retailPrice,
        color,
        size,
        quantity,
        [priceKey]: priceValue || "0"
      });
    }
  }

  if (!items.length) throw new Error("请至少在一个颜色尺码格子里填写数量");
  return items;
}

export function collectNewStyleSkus(form: QuickSkuForm) {
  const styleNo = form.styleNo.trim();
  const productName = form.productName.trim();
  const colors = parseList(form.colorsText);
  const sizes = parseList(form.sizesText).sort(compareSizes);

  if (!styleNo || !productName) throw new Error("款号和商品名称必填");
  if (!form.supplier.trim()) throw new Error("供应商必填");
  if (!colors.length) throw new Error("至少填写一个颜色");
  if (!sizes.length) throw new Error("至少填写一个尺码");

  return colors.flatMap((color) =>
    sizes.map((size) => ({
      styleNo,
      productName,
      supplier: form.supplier,
      category: form.category,
      brand: form.brand,
      retailPrice: form.retailPrice,
      color,
      size
    }))
  );
}

export function collectExistingSkuItems(
  skus: Sku[],
  quantities: Record<string, string>,
  priceKey: "unitCost" | "unitPrice",
  priceValue: string,
  actionName: string
) {
  if (!skus.length) throw new Error(`请先选择${actionName}款号`);

  const items = skus.flatMap((sku) => {
    const rawQuantity = quantities[String(sku.id)];
    if (!rawQuantity) return [];
    const quantity = Number(rawQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`${sku.color} / ${sku.size} 的${actionName}数量必须是大于 0 的整数`);
    }
    return [{ skuId: sku.id, quantity, [priceKey]: priceValue || "0" }];
  });

  if (!items.length) throw new Error(`请至少填写一个颜色尺码的${actionName}数量`);
  return items;
}

export function createSalesOrderLineFromSkus(
  skus: Sku[],
  id: string,
  fallbackSizes = inboundDefaultSizes
): SalesOrderLine {
  const firstSku = skus[0];
  return {
    id,
    styleNo: firstSku?.styleNo || "",
    productName: firstSku?.productName || "",
    supplier: supplierFromStyle(skus),
    category: firstSku?.category || "",
    brand: firstSku?.brand || "",
    retailPrice: firstSku?.retailPrice || "",
    color: firstSku?.color || "",
    unitPrice: firstSku?.retailPrice || "0",
    note: "",
    sizes: Array.from(new Set([...parseList(fallbackSizes), ...skus.map((sku) => sku.size)])).sort(compareSizes),
    quantities: {}
  };
}

export function createEmptySalesOrderLine(id: string, fallbackSizes = inboundDefaultSizes): SalesOrderLine {
  return {
    id,
    styleNo: "",
    productName: "",
    supplier: "",
    category: "",
    brand: "",
    retailPrice: "",
    color: "",
    unitPrice: "0",
    note: "",
    sizes: parseList(fallbackSizes).sort(compareSizes),
    quantities: {}
  };
}

export function salesOrderSizes(lines: SalesOrderLine[]) {
  return Array.from(new Set(lines.flatMap((line) => line.sizes))).sort(compareSizes);
}

export function salesLineQuantity(line: SalesOrderLine) {
  return Object.values(line.quantities).reduce((sum, value) => {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity > 0 ? sum + quantity : sum;
  }, 0);
}

export function salesLineSubtotal(line: SalesOrderLine) {
  const unitPrice = Number(line.unitPrice || 0);
  return salesLineQuantity(line) * (Number.isFinite(unitPrice) ? unitPrice : 0);
}

export function summarizeSalesOrder(lines: SalesOrderLine[], payments: SalesOrderPayments) {
  const totalQuantity = lines.reduce((sum, line) => sum + salesLineQuantity(line), 0);
  const amountDue = lines.reduce((sum, line) => sum + salesLineSubtotal(line), 0);
  const paidAmount = salesPaymentKeys.reduce((sum, key) => {
    const amount = Number(payments[key] || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  return {
    totalQuantity,
    amountDue,
    paidAmount,
    unpaidAmount: Math.max(amountDue - paidAmount, 0),
    changeAmount: Math.max(paidAmount - amountDue, 0)
  };
}

export function collectSalesOrderItems(lines: SalesOrderLine[]) {
  const items = [];
  for (const line of lines) {
    const styleNo = line.styleNo.trim();
    const productName = line.productName.trim();
    const color = line.color.trim();
    if (!styleNo && !productName && !color && !salesLineQuantity(line)) continue;
    if (!styleNo || !productName || !color) throw new Error("销售开单每行都需要款号、商品名称和颜色");
    const unitPrice = Number(line.unitPrice || 0);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`${styleNo} / ${color} 的单价必须是非负数字`);
    for (const size of [...line.sizes].sort(compareSizes)) {
      const rawQuantity = line.quantities[size];
      if (!rawQuantity) continue;
      const quantity = Number(rawQuantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`${styleNo} / ${color} / ${size} 的数量必须是大于 0 的整数`);
      }
      items.push({
        styleNo,
        productName,
        supplier: line.supplier,
        category: line.category,
        brand: line.brand,
        retailPrice: line.retailPrice,
        color,
        size,
        quantity,
        unitPrice: line.unitPrice || "0"
      });
    }
  }
  if (!items.length) throw new Error("请至少填写一条销售明细");
  return items;
}

function normalizedPrice(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function defaultRetailPriceForStyle(styleSkus: Sku[], matchedSku?: Sku) {
  return normalizedPrice(matchedSku?.retailPrice) || normalizedPrice(styleSkus.find((sku) => normalizedPrice(sku.retailPrice))?.retailPrice);
}

function recognizedSalesUnitPrice(item: RecognizedInboundItem, styleSkus: Sku[], matchedSku: Sku | undefined, fallbackUnitPrice: string) {
  return normalizedPrice(item.unitCost) || defaultRetailPriceForStyle(styleSkus, matchedSku) || fallbackUnitPrice;
}

function shouldBackfillSalesUnitPrice(value: string, fallbackUnitPrice: string) {
  const normalized = normalizedPrice(value);
  return !normalized || normalized === fallbackUnitPrice;
}

export function mergeRecognizedSalesItems(
  lines: SalesOrderLine[],
  recognizedItems: RecognizedInboundItem[],
  skus: Sku[],
  createId: () => string,
  fallbackUnitPrice = "0"
) {
  const nextLines = lines.map((line) => ({ ...line, sizes: [...line.sizes], quantities: { ...line.quantities } }));
  for (const item of recognizedItems) {
    const styleNo = item.styleNo?.trim() || "";
    const color = item.color.trim();
    const size = item.size.trim();
    const quantity = Number(item.quantity);
    if (!styleNo || !color || !size || !Number.isInteger(quantity) || quantity <= 0) continue;

    const styleSkus = skus.filter((sku) => sku.styleNo === styleNo);
    const matchedSku = styleSkus.find((sku) => sku.color === color && sku.size === size) || styleSkus[0];
    const unitPrice = recognizedSalesUnitPrice(item, styleSkus, matchedSku, fallbackUnitPrice);
    let target = nextLines.find((line) => line.styleNo === styleNo && line.color === color);
    if (!target) {
      target = {
        id: createId(),
        styleNo,
        productName: item.productName?.trim() || matchedSku?.productName || "",
        supplier: item.supplier?.trim() || supplierFromStyle(styleSkus),
        category: matchedSku?.category || "",
        brand: matchedSku?.brand || "",
        retailPrice: matchedSku?.retailPrice || "",
        color,
        unitPrice,
        note: "",
        sizes: Array.from(new Set([...parseList(inboundDefaultSizes), ...styleSkus.map((sku) => sku.size), size])).sort(compareSizes),
        quantities: {}
      };
      nextLines.push(target);
    } else if (shouldBackfillSalesUnitPrice(target.unitPrice, fallbackUnitPrice) && unitPrice !== fallbackUnitPrice) {
      target.unitPrice = unitPrice;
    }
    if (!target.sizes.includes(size)) target.sizes = [...target.sizes, size].sort(compareSizes);
    target.quantities[size] = String(Number(target.quantities[size] || 0) + quantity);
  }
  return nextLines;
}

export function buildStyleOptions(skus: Sku[]) {
  const options = new Map<string, { styleNo: string; productName: string }>();
  skus.forEach((sku) => {
    if (!options.has(sku.styleNo)) {
      options.set(sku.styleNo, { styleNo: sku.styleNo, productName: sku.productName });
    }
  });
  return Array.from(options.values()).sort((a, b) => a.styleNo.localeCompare(b.styleNo, "zh-CN", { numeric: true }));
}

export function buildInboundFormFromStyle(skus: Sku[], fallbackSizes = inboundDefaultSizes): QuickSkuForm {
  const firstSku = skus[0];
  if (!firstSku) return createQuickSkuForm(fallbackSizes);

  return {
    styleNo: firstSku.styleNo,
    productName: firstSku.productName,
    supplier: supplierFromStyle(skus),
    category: firstSku.category || "",
    brand: firstSku.brand || "",
    retailPrice: firstSku.retailPrice || "",
    colorsText: Array.from(new Set(skus.map((sku) => sku.color))).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true })).join(", "),
    sizesText: Array.from(new Set([...parseList(fallbackSizes), ...skus.map((sku) => sku.size)])).sort(compareSizes).join(", "),
    quantities: {}
  };
}

export function supplierFromStyle(skus: Sku[]) {
  return skus.find((sku) => sku.supplier)?.supplier || "";
}

export function knownColorsForStyle(skus: Sku[], styleNo: string) {
  const normalizedStyleNo = styleNo.trim();
  if (!normalizedStyleNo) return [];
  return Array.from(new Set(skus.filter((sku) => sku.styleNo === normalizedStyleNo).map((sku) => sku.color))).sort((a, b) =>
    a.localeCompare(b, "zh-CN", { numeric: true })
  );
}

export function remapRecognizedItemColors(items: RecognizedInboundItem[], colorMap: Record<string, string>) {
  return items.flatMap((item) => {
    const originalColor = item.color.trim();
    const mappedColor = colorMap[originalColor] ?? originalColor;
    if (!mappedColor.trim()) return [];
    return [{ ...item, color: mappedColor.trim() }];
  });
}

export function mergeRecognizedInboundItems(form: QuickSkuForm, items: RecognizedInboundItem[]) {
  const colors = new Set(parseList(form.colorsText));
  const sizes = new Set(parseList(form.sizesText));
  const quantities = { ...form.quantities };

  items.forEach((item) => {
    const color = item.color.trim();
    const size = item.size.trim();
    const quantity = Number(item.quantity);
    if (!color || !size || !Number.isInteger(quantity) || quantity <= 0) return;
    colors.add(color);
    sizes.add(size);
    const key = matrixKey(color, size);
    quantities[key] = String(Number(quantities[key] || 0) + quantity);
  });

  return {
    ...form,
    colorsText: Array.from(colors).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true })).join(", "),
    sizesText: Array.from(sizes).sort(compareSizes).join(", "),
    quantities
  };
}

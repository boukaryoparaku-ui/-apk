import { describe, expect, it } from "vitest";
import {
  buildStockDocuments,
  collectSalesOrderItems,
  createQuickSkuForm,
  filterStockDocuments,
  filterStyleOptions,
  mergeRecognizedSalesItems,
  knownColorsForStyle,
  matrixKey,
  mergeRecognizedInboundItems,
  migrateQuickSkuAxis,
  rankCustomerMatches,
  remapRecognizedItemColors,
  summarizeSalesOrder
} from "./inventoryLogic";

describe("inventory matrix helpers", () => {
  it("merges recognized AI rows into the editable matrix", () => {
    const form = createQuickSkuForm("M, L");
    form.colorsText = "黑色";
    form.quantities[matrixKey("黑色", "M")] = "2";

    const next = mergeRecognizedInboundItems(form, [
      { color: "黑色", size: "M", quantity: 3 },
      { color: "白色", size: "L", quantity: 4 },
      { color: "", size: "L", quantity: 9 }
    ]);

    expect(next.colorsText).toBe("白色, 黑色");
    expect(next.sizesText).toBe("M, L");
    expect(next.quantities[matrixKey("黑色", "M")]).toBe("5");
    expect(next.quantities[matrixKey("白色", "L")]).toBe("4");
  });

  it("preserves quantities while renaming colors by row position", () => {
    const form = createQuickSkuForm("M, L");
    form.colorsText = "黑色, 白色";
    form.quantities = {
      [matrixKey("黑色", "M")]: "1",
      [matrixKey("白色", "L")]: "2"
    };

    const next = migrateQuickSkuAxis(form, "color", "藏青, 米白");

    expect(next.quantities[matrixKey("藏青", "M")]).toBe("1");
    expect(next.quantities[matrixKey("米白", "L")]).toBe("2");
  });

  it("does not drop quantities when an axis is cleared before retyping", () => {
    const form = createQuickSkuForm("M, L");
    form.colorsText = "黑色";
    form.quantities = { [matrixKey("黑色", "M")]: "7" };

    const cleared = migrateQuickSkuAxis(form, "color", "");
    const retyped = migrateQuickSkuAxis(cleared, "color", "藏青");

    expect(cleared.quantities[matrixKey("黑色", "M")]).toBe("7");
    expect(retyped.quantities[matrixKey("藏青", "M")]).toBe("7");
  });

  it("detects known colors for a selected style and remaps AI colors", () => {
    const skus = [
      { styleNo: "T262", color: "黑色" },
      { styleNo: "T262", color: "白色" },
      { styleNo: "A100", color: "红色" }
    ] as Array<any>;

    expect(knownColorsForStyle(skus, "T262")).toEqual(["白色", "黑色"]);
    expect(
      remapRecognizedItemColors(
        [
          { color: "灰色", size: "M", quantity: 1 },
          { color: "蓝色", size: "L", quantity: 2 }
        ],
        { 灰色: "黑色", 蓝色: "" }
      )
    ).toEqual([{ color: "黑色", size: "M", quantity: 1 }]);
  });

  it("collects multi-style sales order rows", () => {
    const items = collectSalesOrderItems([
      {
        id: "1",
        styleNo: "2605",
        productName: "卫衣",
        supplier: "A",
        category: "",
        brand: "",
        retailPrice: "",
        color: "浅灰",
        unitPrice: "10",
        note: "",
        sizes: ["L", "M", "2XL"],
        quantities: { M: "1", L: "2" }
      },
      {
        id: "2",
        styleNo: "2608",
        productName: "卫裤",
        supplier: "B",
        category: "",
        brand: "",
        retailPrice: "",
        color: "紫色",
        unitPrice: "12",
        note: "",
        sizes: ["XL"],
        quantities: { XL: "3" }
      }
    ]);

    expect(items).toEqual([
      expect.objectContaining({ styleNo: "2605", color: "浅灰", size: "M", quantity: 1, unitPrice: "10" }),
      expect.objectContaining({ styleNo: "2605", color: "浅灰", size: "L", quantity: 2, unitPrice: "10" }),
      expect.objectContaining({ styleNo: "2608", color: "紫色", size: "XL", quantity: 3, unitPrice: "12" })
    ]);
  });

  it("summarizes sales order payments", () => {
    const summary = summarizeSalesOrder(
      [
        {
          id: "1",
          styleNo: "2605",
          productName: "卫衣",
          supplier: "",
          category: "",
          brand: "",
          retailPrice: "",
          color: "浅灰",
          unitPrice: "20",
          note: "",
          sizes: ["M", "L"],
          quantities: { M: "1", L: "2" }
        }
      ],
      {
        paymentWechat: "30",
        paymentCash: "10",
        paymentAlipay: "",
        paymentCard: "",
        paymentScan: "",
        paymentTransfer: ""
      }
    );

    expect(summary).toEqual({ totalQuantity: 3, amountDue: 60, paidAmount: 40, unpaidAmount: 20, changeAmount: 0 });
  });

  it("merges AI items into multi-style sales rows with stable size order", () => {
    const skus = [
      { styleNo: "2605", productName: "卫衣", color: "浅灰", size: "M", retailPrice: "10" },
      { styleNo: "2608", productName: "卫裤", color: "紫色", size: "L", retailPrice: "12" }
    ] as Array<any>;

    const lines = mergeRecognizedSalesItems(
      [],
      [
        { styleNo: "2605", color: "浅灰", size: "M", quantity: 1 },
        { styleNo: "2608", color: "紫色", size: "L", quantity: 1 }
      ],
      skus,
      () => `id-${Math.random()}`
    );

    expect(lines.map((line) => [line.styleNo, line.productName, line.color, line.quantities])).toEqual([
      ["2605", "卫衣", "浅灰", expect.objectContaining({ M: "1" })],
      ["2608", "卫裤", "紫色", expect.objectContaining({ L: "1" })]
    ]);
    expect(lines.map((line) => [line.styleNo, line.unitPrice])).toEqual([
      ["2605", "10"],
      ["2608", "12"]
    ]);
    expect(lines[0].sizes.slice(0, 5)).toEqual(["M", "L", "XL", "2XL", "3XL"]);
  });

  it("uses the style default price when AI sales price is blank", () => {
    const skus = [{ styleNo: "2605", productName: "卫衣", color: "浅灰", size: "M", retailPrice: "26" }] as Array<any>;

    const lines = mergeRecognizedSalesItems(
      [],
      [{ styleNo: "2605", color: "浅灰", size: "M", quantity: 1, unitCost: "" }],
      skus,
      () => "id-1"
    );

    expect(lines[0].unitPrice).toBe("26");
    expect(lines[0].quantities.M).toBe("1");
  });

  it("falls back to another SKU price in the same style and preserves manual prices", () => {
    const skus = [
      { styleNo: "2605", productName: "卫衣", color: "浅灰", size: "M", retailPrice: "" },
      { styleNo: "2605", productName: "卫衣", color: "深灰", size: "L", retailPrice: "29" }
    ] as Array<any>;

    const filled = mergeRecognizedSalesItems(
      [],
      [{ styleNo: "2605", color: "浅灰", size: "M", quantity: 1 }],
      skus,
      () => "id-1"
    );
    expect(filled[0].unitPrice).toBe("29");

    const preserved = mergeRecognizedSalesItems(
      [
        {
          id: "manual",
          styleNo: "2605",
          productName: "卫衣",
          supplier: "",
          category: "",
          brand: "",
          retailPrice: "",
          color: "浅灰",
          unitPrice: "18",
          note: "",
          sizes: ["M"],
          quantities: {}
        }
      ],
      [{ styleNo: "2605", color: "浅灰", size: "M", quantity: 2 }],
      skus,
      () => "id-2"
    );

    expect(preserved[0].unitPrice).toBe("18");
    expect(preserved[0].quantities.M).toBe("2");
  });
});

describe("filterStyleOptions", () => {
  const options = [
    { styleNo: "2605", productName: "圆领卫衣" },
    { styleNo: "2610", productName: "连帽卫衣" },
    { styleNo: "A100", productName: "牛仔裤" }
  ];

  it("returns all when query empty", () => {
    expect(filterStyleOptions(options, "")).toHaveLength(3);
  });

  it("matches by styleNo prefix first", () => {
    const result = filterStyleOptions(options, "26");
    expect(result.map((o) => o.styleNo)).toEqual(["2605", "2610"]);
  });

  it("matches by product name", () => {
    const result = filterStyleOptions(options, "卫衣");
    expect(result.map((o) => o.styleNo).sort()).toEqual(["2605", "2610"]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterStyleOptions(options, "zzz")).toEqual([]);
  });
});

describe("rankCustomerMatches", () => {
  const customers = [
    { name: "张三" },
    { name: "张三丰" },
    { name: "李四" },
    { name: "小张" }
  ];

  it("prefix (首字) matches rank before substring", () => {
    const result = rankCustomerMatches(customers, "张").map((c) => c.name);
    expect(result[0]).toBe("张三");
    expect(result).toContain("小张");
    // 前缀命中应排在子串命中之前
    expect(result.indexOf("张三")).toBeLessThan(result.indexOf("小张"));
  });

  it("returns all when query empty", () => {
    expect(rankCustomerMatches(customers, "")).toHaveLength(4);
  });
});

describe("buildStockDocuments / filterStockDocuments", () => {
  const inbound = [
    {
      id: 1,
      supplier: "供应商A",
      inboundDate: "2026-06-10T00:00:00.000Z",
      note: "补货",
      createdAt: "2026-06-10T00:00:00.000Z",
      items: [
        { id: 1, quantity: 3, unitCost: "20", sku: { color: "红", size: "M", product: { styleNo: "2605", name: "卫衣" } } },
        { id: 2, quantity: 2, unitCost: "20", sku: { color: "蓝", size: "L", product: { styleNo: "2605", name: "卫衣" } } }
      ]
    }
  ];
  const outbound = [
    {
      id: 9,
      customer: "张三",
      channel: "门店",
      outboundDate: "2026-06-11T00:00:00.000Z",
      note: "",
      createdAt: "2026-06-11T00:00:00.000Z",
      items: [{ id: 5, quantity: 4, unitPrice: "50", sku: { color: "红", size: "M", product: { styleNo: "A100", name: "牛仔裤" } } }]
    }
  ];

  it("merges and sorts by date desc with totals", () => {
    const docs = buildStockDocuments(inbound, outbound);
    expect(docs).toHaveLength(2);
    expect(docs[0].kind).toBe("OUTBOUND"); // 6/11 在前
    expect(docs[0].totalQuantity).toBe(4);
    expect(docs[0].totalAmount).toBe(200);
    expect(docs[0].party).toBe("张三（门店）");
    expect(docs[1].kind).toBe("INBOUND");
    expect(docs[1].totalQuantity).toBe(5);
    expect(docs[1].totalAmount).toBe(100);
  });

  it("filters by kind", () => {
    const docs = buildStockDocuments(inbound, outbound);
    expect(filterStockDocuments(docs, { kind: "INBOUND" })).toHaveLength(1);
    expect(filterStockDocuments(docs, { kind: "OUTBOUND" })[0].id).toBe(9);
  });

  it("filters by keyword across party and items", () => {
    const docs = buildStockDocuments(inbound, outbound);
    expect(filterStockDocuments(docs, { q: "牛仔" })).toHaveLength(1);
    expect(filterStockDocuments(docs, { q: "供应商A" })).toHaveLength(1);
    expect(filterStockDocuments(docs, { q: "不存在" })).toHaveLength(0);
  });

  it("filters by date range", () => {
    const docs = buildStockDocuments(inbound, outbound);
    expect(filterStockDocuments(docs, { from: "2026-06-11", to: "2026-06-11" })).toHaveLength(1);
  });
});

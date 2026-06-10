import { describe, expect, it } from "vitest";
import {
  collectSalesOrderItems,
  createQuickSkuForm,
  mergeRecognizedSalesItems,
  knownColorsForStyle,
  matrixKey,
  mergeRecognizedInboundItems,
  migrateQuickSkuAxis,
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

import { describe, expect, it } from "vitest";
import {
  extractDefaultQuantityItemsFromText,
  normalizeRecognizedColor,
  normalizeRecognizedItems,
  normalizeRecognizedSize,
  normalizeRecognizedStyleNo
} from "./index";

describe("AI recognition normalization", () => {
  it("normalizes numeric size hints into letter sizes", () => {
    expect(normalizeRecognizedSize("105")).toBe("M");
    expect(normalizeRecognizedSize("165")).toBe("M");
    expect(normalizeRecognizedSize("120")).toBe("2XL");
    expect(normalizeRecognizedSize("180")).toBe("2XL");
    expect(normalizeRecognizedSize("xxxl")).toBe("3XL");
  });

  it("normalizes customer-specific color and style aliases", () => {
    expect(normalizeRecognizedColor("雾霾蓝")).toBe("雾蓝");
    expect(normalizeRecognizedStyleNo("7262")).toBe("T262");
  });

  it("defaults missing recognized quantity to one", () => {
    expect(
      normalizeRecognizedItems({
        items: [{ styleNo: "2605", color: "浅灰", size: "165" }]
      })
    ).toEqual([{ styleNo: "2605", color: "浅灰", size: "M", quantity: 1 }]);
  });

  it("extracts compact text items with default quantity", () => {
    expect(extractDefaultQuantityItemsFromText("2605-浅灰165、2608-紫色170")).toEqual([
      { styleNo: "2605", color: "浅灰", size: "M", quantity: 1 },
      { styleNo: "2608", color: "紫色", size: "L", quantity: 1 }
    ]);
  });
});

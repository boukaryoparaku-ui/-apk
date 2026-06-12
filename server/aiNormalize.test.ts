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

  it("keeps numeric quantity from AI JSON (regression: number type was reset to 1)", () => {
    expect(
      normalizeRecognizedItems({
        items: [
          { styleNo: "2651", color: "白色", size: "105", quantity: 2 },
          { styleNo: "2651", color: "黑色", size: "105", quantity: 4 },
          { styleNo: "2651", color: "黑色", size: "110", quantity: 3 }
        ]
      })
    ).toEqual([
      { styleNo: "2651", color: "白色", size: "M", quantity: 2 },
      { styleNo: "2651", color: "黑色", size: "M", quantity: 4 },
      { styleNo: "2651", color: "黑色", size: "L", quantity: 3 }
    ]);
  });

  it("accepts quantity given as a string", () => {
    expect(
      normalizeRecognizedItems({
        items: [{ styleNo: "2608", color: "枣红", size: "185", quantity: "2" }]
      })
    ).toEqual([{ styleNo: "2608", color: "枣红", size: "3XL", quantity: 2 }]);
  });

  it("drops rows with non-positive or invalid quantity", () => {
    expect(
      normalizeRecognizedItems({
        items: [
          { color: "白色", size: "105", quantity: 0 },
          { color: "白色", size: "110", quantity: -3 },
          { color: "白色", size: "115", quantity: "abc" }
        ]
      })
    ).toEqual([]);
  });

  it("extracts compact text items with default quantity", () => {
    expect(extractDefaultQuantityItemsFromText("2605-浅灰165、2608-紫色170")).toEqual([
      { styleNo: "2605", color: "浅灰", size: "M", quantity: 1 },
      { styleNo: "2608", color: "紫色", size: "L", quantity: 1 }
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { formatControlValue, parseControlValue } from "../../src/ui/formatValue";

describe("formatControlValue", () => {
  it("keeps compact integers", () => expect(formatControlValue(42, 1)).toBe("42"));
  it("uses the precision implied by step", () => expect(formatControlValue(0.5, 0.05)).toBe("0.50"));
  it("uses three decimals for millisteps", () => expect(formatControlValue(0.125, 0.001)).toBe("0.125"));
});

describe("parseControlValue", () => {
  it("accepts a displayed unit and snaps the value to the control step", () => {
    expect(parseControlValue("506 px", 2, 800, 1)).toBe(506);
    expect(parseControlValue("0,52", 0, 1, 0.05)).toBe(0.5);
  });

  it("clamps values to the declared slider range", () => {
    expect(parseControlValue("-20", 0, 100, 1)).toBe(0);
    expect(parseControlValue("150", 0, 100, 1)).toBe(100);
  });

  it("rejects text that does not contain a numeric value", () => {
    expect(parseControlValue("aucune valeur", 0, 100, 1)).toBeNull();
  });
});

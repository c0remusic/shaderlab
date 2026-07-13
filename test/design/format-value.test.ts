import { describe, expect, it } from "vitest";
import { formatControlValue } from "../../src/ui/formatValue";

describe("formatControlValue", () => {
  it("keeps compact integers", () => expect(formatControlValue(42, 1)).toBe("42"));
  it("uses the precision implied by step", () => expect(formatControlValue(0.5, 0.05)).toBe("0.50"));
  it("uses three decimals for millisteps", () => expect(formatControlValue(0.125, 0.001)).toBe("0.125"));
});

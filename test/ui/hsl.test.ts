import { describe, expect, it } from "vitest";
import { hslToHex, hexToHsl } from "../../src/ui/hsl";

describe("hexToHsl", () => {
  it("converts pure black", () => {
    expect(hexToHsl("#000000")).toEqual({ hue: 0, saturation: 0, lightness: 0 });
  });

  it("converts pure white", () => {
    expect(hexToHsl("#ffffff")).toEqual({ hue: 0, saturation: 0, lightness: 1 });
  });

  it("converts a pure gray (s=0, hue undefined -> 0)", () => {
    expect(hexToHsl("#808080")).toEqual({ hue: 0, saturation: 0, lightness: expect.closeTo(0.502, 2) });
  });

  it("converts pure red", () => {
    const { hue, saturation, lightness } = hexToHsl("#ff0000");
    expect(hue).toBeCloseTo(0, 0);
    expect(saturation).toBeCloseTo(1, 2);
    expect(lightness).toBeCloseTo(0.5, 2);
  });

  it("round-trips through hslToHex for a sample of colors", () => {
    const samples = ["#ff8800", "#00ff88", "#8800ff", "#336699", "#deadbe"];
    for (const hex of samples) {
      const { hue, saturation, lightness } = hexToHsl(hex);
      const roundTripped = hslToHex(hue, saturation, lightness);
      expect(roundTripped).toBe(hex);
    }
  });

  it("accepts hex without a leading #", () => {
    expect(hexToHsl("ff0000").hue).toBeCloseTo(0, 0);
  });
});

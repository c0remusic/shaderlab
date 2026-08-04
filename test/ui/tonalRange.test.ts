import { describe, expect, it } from "vitest";
import { clampTonalHandle, tonalCurvePath, tonalMembership } from "../../src/ui/tonalRange";

const values = { shadowsMin: 0, shadowsMax: 0.33, highlightsMin: 0.66, highlightsMax: 1, tolerance: 0.1 };

describe("tonal range UI model", () => {
  it("reproduit deux fenêtres tonales continues", () => {
    expect(tonalMembership(values, 0.15)).toBeGreaterThan(0.9);
    expect(tonalMembership(values, 0.5)).toBeLessThan(0.1);
    expect(tonalMembership(values, 0.82)).toBeGreaterThan(0.9);
  });

  it("produit un chemin borné et déterministe", () => {
    const path = tonalCurvePath(values, 240, 64, 8);
    expect(path.startsWith("M0.00,")).toBe(true);
    expect(path.split(" L")).toHaveLength(9);
    expect(path).not.toMatch(/NaN|Infinity/);
  });

  it("empêche les poignées min/max de se croiser", () => {
    expect(clampTonalHandle(values, "shadowsMin", 0.8)).toBe(values.shadowsMax);
    expect(clampTonalHandle(values, "highlightsMax", 0.2)).toBe(values.highlightsMin);
  });
});

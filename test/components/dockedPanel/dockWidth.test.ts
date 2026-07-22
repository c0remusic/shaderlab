import { describe, it, expect } from "vitest";
import { clampDockWidth, DOCK_WIDTH_MIN, DOCK_WIDTH_MAX } from "../../../src/components/dockedPanel/dockWidth";

describe("clampDockWidth", () => {
  it("valeur dans les bornes -> inchangée", () => {
    expect(clampDockWidth(320)).toBe(320);
  });
  it("valeur sous le minimum -> clampée au minimum", () => {
    expect(clampDockWidth(100)).toBe(DOCK_WIDTH_MIN);
  });
  it("valeur au-dessus du maximum -> clampée au maximum", () => {
    expect(clampDockWidth(999)).toBe(DOCK_WIDTH_MAX);
  });
  it("valeur exactement au minimum -> inchangée", () => {
    expect(clampDockWidth(DOCK_WIDTH_MIN)).toBe(DOCK_WIDTH_MIN);
  });
  it("valeur exactement au maximum -> inchangée", () => {
    expect(clampDockWidth(DOCK_WIDTH_MAX)).toBe(DOCK_WIDTH_MAX);
  });
});

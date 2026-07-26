import { describe, expect, it } from "vitest";
import { presetsDiffer } from "../../src/presets/presetsDiffer";
import type { PresetLayer } from "../../src/presets/presetTypes";

function layer(overrides: Partial<PresetLayer> = {}): PresetLayer {
  return { effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal", ...overrides };
}

describe("presetsDiffer", () => {
  it("returns false for two structurally identical single-layer arrays", () => {
    expect(presetsDiffer([layer()], [layer()])).toBe(false);
  });

  it("returns true when a param value changed", () => {
    expect(presetsDiffer([layer()], [layer({ params: { intensity: 0.9 } })])).toBe(true);
  });

  it("returns true when the layer order changed", () => {
    const a = [layer({ effectId: "glow" }), layer({ effectId: "grain" })];
    const b = [layer({ effectId: "grain" }), layer({ effectId: "glow" })];
    expect(presetsDiffer(a, b)).toBe(true);
  });

  it("returns true when the layer count changed", () => {
    expect(presetsDiffer([layer()], [layer(), layer()])).toBe(true);
  });

  it("returns true when opacity, blendMode, or enabled changed", () => {
    expect(presetsDiffer([layer()], [layer({ opacity: 0.5 })])).toBe(true);
    expect(presetsDiffer([layer()], [layer({ blendMode: "screen" })])).toBe(true);
    expect(presetsDiffer([layer()], [layer({ enabled: false })])).toBe(true);
  });
});

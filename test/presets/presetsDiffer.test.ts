import { describe, expect, it } from "vitest";
import { presetsDiffer, presetStructureDiffers } from "../../src/presets/presetsDiffer";
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

// Final-review fix (Critique 1) : presetStructureDiffers decides whether an
// undo/redo severs the link to the active preset — see its doc comment in
// presetsDiffer.ts and usePresets.reconcileActiveAfterHistoryChange for the
// bug it fixes (undoing a preset application could otherwise leave
// activePresetId pointing at a snapshot that no longer matches reality,
// letting "Mettre à jour" overwrite the preset file with an undone,
// possibly-empty stack).
describe("presetStructureDiffers", () => {
  it("returns false when only a param value changed (same layers, same effects)", () => {
    // The case that must NOT clear the active preset: undoing a plain param
    // tweak should let the (full-value) dirty banner comparison handle it,
    // not sever activePresetId outright.
    expect(presetStructureDiffers([layer()], [layer({ params: { intensity: 0.9 } })])).toBe(false);
  });

  it("returns false when opacity/blendMode/enabled changed but the effect sequence is the same", () => {
    expect(presetStructureDiffers([layer()], [layer({ opacity: 0.2 })])).toBe(false);
    expect(presetStructureDiffers([layer()], [layer({ blendMode: "screen" })])).toBe(false);
    expect(presetStructureDiffers([layer()], [layer({ enabled: false })])).toBe(false);
  });

  it("returns true when the layer count changed (e.g. undo back to an empty stack)", () => {
    expect(presetStructureDiffers([], [layer()])).toBe(true);
    expect(presetStructureDiffers([layer()], [])).toBe(true);
  });

  it("returns true when the effectId sequence changed", () => {
    const a = [layer({ effectId: "glow" }), layer({ effectId: "grain" })];
    const b = [layer({ effectId: "grain" }), layer({ effectId: "glow" })];
    expect(presetStructureDiffers(a, b)).toBe(true);
  });

  it("returns false for two structurally identical single-layer arrays", () => {
    expect(presetStructureDiffers([layer()], [layer()])).toBe(false);
  });
});

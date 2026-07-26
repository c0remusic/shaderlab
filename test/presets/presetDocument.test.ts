import { describe, expect, it } from "vitest";
import { capture, apply, migratePresetDocument, PRESET_SCHEMA_VERSION } from "../../src/presets/presetDocument";
import type { PresetDocument } from "../../src/presets/presetTypes";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";
import type { EffectParam } from "../../src/render/effects/types";

function layer(overrides: Partial<LayerState> = {}): LayerState {
  return {
    id: "layer-1",
    effectId: "glow",
    params: { intensity: 0.5 },
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

const GLOW_PARAMS: EffectParam[] = [
  { name: "intensity", label: "Intensité", min: 0, max: 1, default: 0.3, step: 0.01 },
];

function effectExists(id: string): boolean {
  return id === "glow";
}

function effectParams(id: string): EffectParam[] | null {
  return id === "glow" ? GLOW_PARAMS : null;
}

describe("capture", () => {
  it("captures effectId/params/enabled/opacity/blendMode, in stack order, without id/mask", () => {
    const layers = [
      layer({ id: "layer-1", effectId: "glow", opacity: 0.8 }),
      layer({ id: "layer-2", effectId: "grain", params: { amount: 0.2 }, blendMode: "screen" }),
    ];
    const { preset, skipped } = capture(layers, "Mon preset");
    expect(skipped).toEqual([]);
    expect(preset.name).toBe("Mon preset");
    expect(preset.schemaVersion).toBe(PRESET_SCHEMA_VERSION);
    expect(preset.layers).toEqual([
      { effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 0.8, blendMode: "normal" },
      { effectId: "grain", params: { amount: 0.2 }, enabled: true, opacity: 1, blendMode: "screen" },
    ]);
    expect(preset.id).not.toBe("");
    expect(preset.createdAt).toBe(preset.updatedAt);
  });

  it("excludes a photo layer (imageSource present) and reports a photo-layer SkipNotice", () => {
    const layers = [
      layer({ id: "layer-1", effectId: "passthrough", imageSource: { sourceId: "src-1" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
      layer({ id: "layer-2", effectId: "glow" }),
    ];
    const { preset, skipped } = capture(layers, "Avec photo");
    expect(preset.layers).toHaveLength(1);
    expect(preset.layers[0].effectId).toBe("glow");
    expect(skipped).toEqual([{ reason: "photo-layer", layerIndex: 0 }]);
  });

  it("reports each excluded layer's index in `layers`, in original order (not the compacted output index)", () => {
    const layers = [
      layer({ id: "layer-1", effectId: "glow" }),
      layer({ id: "layer-2", effectId: "passthrough", imageSource: { sourceId: "src-1" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
      layer({ id: "layer-3", effectId: "grain" }),
      layer({ id: "layer-4", effectId: "passthrough", imageSource: { sourceId: "src-2" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
    ];
    const { skipped } = capture(layers, "Deux photos");
    expect(skipped).toEqual([
      { reason: "photo-layer", layerIndex: 1 },
      { reason: "photo-layer", layerIndex: 3 },
    ]);
  });
});

describe("apply", () => {
  const basePreset: PresetDocument = {
    schemaVersion: PRESET_SCHEMA_VERSION,
    id: "preset-1",
    name: "Test",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    layers: [{ effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal" }],
  };

  it("rebuilds LayerState with a fresh id, default mask, no imageSource/transform", () => {
    let counter = 0;
    const { layers, warnings } = apply(basePreset, effectExists, effectParams, () => `fresh-${++counter}`);
    expect(warnings).toEqual([]);
    expect(layers).toEqual([
      { id: "fresh-1", effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() },
    ]);
  });

  it("clamps a param outside the registry's current min/max bounds", () => {
    const preset: PresetDocument = { ...basePreset, layers: [{ ...basePreset.layers[0], params: { intensity: 5 } }] };
    const { layers } = apply(preset, effectExists, effectParams, () => "fresh-1");
    expect(layers[0].params.intensity).toBe(1); // clamped to GLOW_PARAMS max
  });

  it("skips a layer whose effect no longer exists and pushes an ApplyWarning, without throwing", () => {
    const preset: PresetDocument = { ...basePreset, layers: [...basePreset.layers, { effectId: "vanished-effect", params: {}, enabled: true, opacity: 1, blendMode: "normal" }] };
    const { layers, warnings } = apply(preset, effectExists, effectParams, () => "fresh-1");
    expect(layers).toHaveLength(1); // only the glow layer survives
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/vanished-effect/);
  });

  it("refuses a schemaVersion newer than PRESET_SCHEMA_VERSION", () => {
    const future: PresetDocument = { ...basePreset, schemaVersion: PRESET_SCHEMA_VERSION + 1 };
    expect(() => apply(future, effectExists, effectParams, () => "fresh-1")).toThrow(/schemaVersion/);
  });
});

describe("migratePresetDocument", () => {
  it("is a no-op on the current (only) schema version", () => {
    const doc: PresetDocument = {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id: "p1",
      name: "n",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      layers: [],
    };
    expect(migratePresetDocument(doc)).toEqual(doc);
  });
});

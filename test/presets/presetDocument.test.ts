import { describe, expect, it } from "vitest";
import { capture, apply, migratePresetDocument, PRESET_SCHEMA_VERSION } from "../../src/presets/presetDocument";
import type { PresetDocument } from "../../src/presets/presetTypes";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";
import type { EffectParam } from "../../src/render/effects/types";
import { curves } from "../../src/render/effects/curves";

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

/** Calque PHOTO à l'index `index` de la pile (l'index sert aussi d'id, pour
 *  que l'assertion sur `layerIndex` reste lisible). */
function photo(sourceId: string, index: number): LayerState {
  return layer({
    id: `layer-${index}`,
    effectId: "passthrough",
    imageSource: { sourceId },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  });
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
      photo("src-fond", 0),
      layer({ id: "layer-2", effectId: "glow" }),
      photo("src-import", 2),
    ];
    const { preset, skipped } = capture(layers, "Avec photo");
    expect(preset.layers).toHaveLength(1);
    expect(preset.layers[0].effectId).toBe("glow");
    expect(skipped).toEqual([
      { reason: "photo-layer", layerIndex: 0 },
      { reason: "photo-layer", layerIndex: 2 },
    ]);
  });

  it("reports each excluded layer's index in `layers`, in original order (not the compacted output index)", () => {
    const layers = [
      layer({ id: "layer-1", effectId: "glow" }),
      layer({ id: "layer-2", effectId: "passthrough", imageSource: { sourceId: "src-1" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }),
      layer({ id: "layer-3", effectId: "grain" }),
      layer({ id: "layer-4", effectId: "passthrough", imageSource: { sourceId: "src-2" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }),
    ];
    const { skipped } = capture(layers, "Deux photos");
    expect(skipped).toEqual([
      { reason: "photo-layer", layerIndex: 1 },
      { reason: "photo-layer", layerIndex: 3 },
    ]);
  });
});

// T5 (design 2026-07-28 §2.3). Depuis T1 la photo d'ouverture EST un calque :
// l'avis « photo-layer » se déclenchait sur TOUT document ouvert, donc sur le
// cas nominal. Un avertissement qui apparaît toujours n'avertit plus de rien.
// Frontière retenue : l'avis se déclenche quand le document contient une photo
// AUTRE que sa photo d'ouverture — exactement le prédicat qui décide déjà du
// round-trip (`hasImportedPhotoLayer`, layers/photoLayer.ts), et non une
// seconde définition concurrente de « la photo du document ».
describe("capture — frontière de l'avis photo (T5)", () => {
  it("n'émet AUCUN avis quand la seule photo est la photo d'ouverture (cas nominal)", () => {
    const { skipped } = capture([photo("src-fond", 0), layer({ id: "layer-1", effectId: "glow" })], "Nominal");
    expect(skipped).toEqual([]);
  });

  it("exclut quand même la photo d'ouverture du preset — l'avis se tait, le contrat ne change pas", () => {
    const { preset } = capture([photo("src-fond", 0), layer({ id: "layer-1", effectId: "glow" })], "Nominal");
    expect(preset.layers).toEqual([
      { effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal" },
    ]);
  });

  it("émet un avis dès qu'une photo est importée — et énumère TOUTES les photos exclues", () => {
    // Le dialogue énumère les calques exclus : en taire un rendrait
    // l'énumération fausse. La frontière porte sur le DÉCLENCHEMENT de l'avis,
    // pas sur un filtrage de sa liste.
    const { skipped } = capture(
      [photo("src-fond", 0), layer({ id: "layer-1", effectId: "glow" }), photo("src-import", 2)],
      "Double exposure"
    );
    expect(skipped).toEqual([
      { reason: "photo-layer", layerIndex: 0 },
      { reason: "photo-layer", layerIndex: 2 },
    ]);
  });

  it("émet un avis quand l'unique photo n'est plus en bas de pile", () => {
    // Elle n'est plus la matière sous tout le reste (ADR-0004, sens causal) :
    // le preset restitué ne se posera pas sur elle comme au moment de la
    // capture, son absence est une information réelle.
    const { skipped } = capture([layer({ id: "layer-0", effectId: "glow" }), photo("src-photo", 1)], "Photo au-dessus");
    expect(skipped).toEqual([{ reason: "photo-layer", layerIndex: 1 }]);
  });

  it("n'émet aucun avis sur un document sans aucune photo", () => {
    expect(capture([layer({ id: "layer-1", effectId: "glow" })], "Effets seuls").skipped).toEqual([]);
    expect(capture([], "Pile vide").skipped).toEqual([]);
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

  // Garantie STRUCTURELLE derrière le plafond `MAX_PHOTO_LAYERS` : quoi qu'il
  // y ait dans le fichier de preset (y compris un preset importé de
  // l'extérieur), `apply` ne peut pas fabriquer de calque photo — donc
  // appliquer un preset ne peut jamais faire monter le compte de photos.
  it("ne produit JAMAIS de calque photo, même si le fichier en porte les champs", () => {
    const forged = {
      ...basePreset,
      layers: [{ ...basePreset.layers[0], imageSource: { sourceId: "src-forge" }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }],
    } as PresetDocument;
    const { layers } = apply(forged, effectExists, effectParams, () => "fresh-1");
    expect(layers.every((l) => l.imageSource === undefined && l.transform === undefined)).toBe(true);
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

describe("preset Courbes", () => {
  it("reste un JSON numérique transportable, sans photo ni migration spéciale", () => {
    const params = Object.fromEntries(curves.params.map((param) => [param.name, param.default]));
    params.masterPoint1X = 0.35;
    params.masterPoint1Y = 0.22;
    const source = layer({ id: "curve-layer", effectId: "curves", params });
    const { preset } = capture([photo("photo-document", 0), source], "Courbe douce");
    const serialized = JSON.stringify(preset);
    const parsed = JSON.parse(serialized) as PresetDocument;
    const result = apply(parsed, (id) => id === "curves", (id) => id === "curves" ? curves.params : null, () => "curve-fresh");

    expect(parsed.schemaVersion).toBe(PRESET_SCHEMA_VERSION);
    expect(parsed.layers).toHaveLength(1);
    expect(Object.values(parsed.layers[0].params).every((value) => typeof value === "number")).toBe(true);
    expect(result.layers[0]).toMatchObject({ id: "curve-fresh", effectId: "curves", params });
    expect(result.layers[0].imageSource).toBeUndefined();
  });
});

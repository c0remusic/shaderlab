import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { getMaskSourceModule } from "../../src/mask/sources/registry";

describe("LayerStack", () => {
  it("adds a layer with default params and enabled=true", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.layers).toHaveLength(1);
    expect(stack.layers[0]).toMatchObject({ id, effectId: "glow", enabled: true });
  });

  it("removes a layer by id", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.removeLayer(id);
    expect(stack.layers).toHaveLength(0);
  });

  it("reorders a layer to a new index", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    const b = stack.addLayer("grain");
    stack.reorderLayer(a, 1);
    expect(stack.layers.map((l) => l.id)).toEqual([b, a]);
  });

  it("toggles a layer's enabled flag", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.toggleLayer(id);
    expect(stack.layers[0].enabled).toBe(false);
  });

  it("updates a layer's params by merging", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateParams(id, { intensity: 0.5 });
    expect(stack.layers[0].params.intensity).toBe(0.5);
  });

  it("clone() produces a deep copy independent of the original", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const copy = stack.clone();
    copy.updateParams(id, { intensity: 0.9 });
    expect(stack.layers[0].params.intensity).not.toBe(0.9);
  });

  it("addLayer initialise opacity=1 et blendMode='normal'", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("grain");
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.opacity).toBe(1);
    expect(layer.blendMode).toBe("normal");
  });
});

describe("LayerStack mask model", () => {
  it("addLayer starts with an empty, enabled, non-inverted mask", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.sources).toEqual([]);
    expect(layer.mask.enabled).toBe(true);
    expect(layer.mask.invert).toBe(false);
  });

  it("updateBrushMask creates a brush source on first call", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const raster = new Uint8Array([255, 0, 128]);
    stack.updateBrushMask(id, raster);
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.sources).toHaveLength(1);
    expect(layer.mask.sources[0].type).toBe("brush");
    expect(layer.mask.sources[0].raster).toEqual(raster);
    expect(layer.mask.sources[0].raster).not.toBe(raster); // fresh copy
  });

  it("updateBrushMask replaces the existing brush source's raster on later calls", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    const firstSourceId = stack.layers.find((l) => l.id === id)!.mask.sources[0].id;
    stack.updateBrushMask(id, new Uint8Array([4, 5, 6]));
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.sources).toHaveLength(1); // still one source, not two
    expect(layer.mask.sources[0].id).toBe(firstSourceId); // same source id, stable
    expect(layer.mask.sources[0].raster).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("setMaskInvert/setMaskEnabled flip the flags without touching sources", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1]));
    stack.setMaskInvert(id, true);
    stack.setMaskEnabled(id, false);
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.invert).toBe(true);
    expect(layer.mask.enabled).toBe(false);
    expect(layer.mask.sources).toHaveLength(1);
  });

  it("clone() shares source rasters by reference but deep-copies containers", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2]));
    const original = stack.layers.find((l) => l.id === id)!;

    const copy = stack.clone();
    const copied = copy.layers.find((l) => l.id === id)!;

    expect(copied.mask.sources[0].raster).toBe(original.mask.sources[0].raster); // shared
    copy.setMaskInvert(id, true);
    expect(original.mask.invert).toBe(false); // container not shared
  });
});

describe("LayerStack — sources de masque paramétriques", () => {
  it("addMaskSource crée une source avec les defaultParams du module, combineMode=add, enabled=true", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const layer = stack.layers.find((l) => l.id === layerId)!;
    const source = layer.mask.sources.find((s) => s.id === sourceId)!;
    expect(source.type).toBe("gradient");
    expect(source.combineMode).toBe("add");
    expect(source.enabled).toBe(true);
    expect(source.params).toEqual(getMaskSourceModule("gradient").defaultParams);
  });

  it("removeMaskSource retire uniquement la source visée", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const a = stack.addMaskSource(layerId, "gradient");
    const b = stack.addMaskSource(layerId, "luminosity");
    stack.removeMaskSource(layerId, a);
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.sources.map((s) => s.id)).toEqual([b]);
  });

  it("updateMaskSourceParams remplace params sans muter l'ancienne référence (immutabilité)", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const layer = stack.layers.find((l) => l.id === layerId)!;
    const before = layer.mask.sources.find((s) => s.id === sourceId)!.params;
    stack.updateMaskSourceParams(layerId, sourceId, { ...before!, feather: 0.5 });
    const after = layer.mask.sources.find((s) => s.id === sourceId)!.params;
    expect(after).not.toBe(before);
    expect(after!.feather).toBe(0.5);
  });

  it("setMaskSourceCombineMode change le mode d'UNE source", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    stack.setMaskSourceCombineMode(layerId, sourceId, "subtract");
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.sources.find((s) => s.id === sourceId)!.combineMode).toBe("subtract");
  });

  it("setMaskInvert / setMaskEnabled changent le conteneur mask, pas une source", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    stack.setMaskInvert(layerId, true);
    stack.setMaskEnabled(layerId, false);
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.invert).toBe(true);
    expect(layer.mask.enabled).toBe(false);
  });

  it("updateRefineEdge merge partiellement sans écraser les autres champs", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    stack.updateRefineEdge(layerId, { feather: 3 });
    stack.updateRefineEdge(layerId, { edgeAware: true });
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.refineEdge.feather).toBe(3);
    expect(layer.mask.refineEdge.edgeAware).toBe(true);
  });
});

describe("LayerStack — setMaskSourceEnabled", () => {
  it("flips enabled on the matching source and returns true", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const result = stack.setMaskSourceEnabled(layerId, sourceId, false);
    expect(result).toBe(true);
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.sources.find((s) => s.id === sourceId)!.enabled).toBe(false);
  });

  it("touches only the matching source, others untouched", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const a = stack.addMaskSource(layerId, "gradient");
    const b = stack.addMaskSource(layerId, "luminosity");
    stack.setMaskSourceEnabled(layerId, a, false);
    const layer = stack.layers.find((l) => l.id === layerId)!;
    expect(layer.mask.sources.find((s) => s.id === a)!.enabled).toBe(false);
    expect(layer.mask.sources.find((s) => s.id === b)!.enabled).toBe(true);
  });

  it("returns false and mutates nothing when the source does not exist", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const before = stack.layers.find((l) => l.id === layerId)!.mask.sources;
    const result = stack.setMaskSourceEnabled(layerId, "missing", false);
    expect(result).toBe(false);
    expect(stack.layers.find((l) => l.id === layerId)!.mask.sources).toBe(before);
  });

  it("returns false when the value does not change (no-op)", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const result = stack.setMaskSourceEnabled(layerId, sourceId, true); // already true
    expect(result).toBe(false);
  });

  it("returns false when the layer does not exist", () => {
    const stack = new LayerStack();
    expect(stack.setMaskSourceEnabled("missing-layer", "missing-source", false)).toBe(false);
  });
});

describe("LayerStack — mutation outcomes (Task 3)", () => {
  it("reorderLayer returns false for an absent id, without mutating the array", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    const before = stack.layers;
    expect(stack.reorderLayer("missing", 0)).toBe(false);
    expect(stack.layers).toBe(before);
  });

  it("reorderLayer returns false for an out-of-bounds index, without mutating the array", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    stack.addLayer("grain");
    const before = stack.layers;
    expect(stack.reorderLayer(a, -1)).toBe(false);
    expect(stack.reorderLayer(a, 5)).toBe(false);
    expect(stack.layers).toBe(before);
  });

  it("reorderLayer returns false when newIndex equals the current index (no-op)", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    stack.addLayer("grain");
    const before = stack.layers;
    expect(stack.reorderLayer(a, 0)).toBe(false);
    expect(stack.layers).toBe(before);
  });

  it("reorderLayer returns true and reorders for a valid, different index", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    const b = stack.addLayer("grain");
    expect(stack.reorderLayer(a, 1)).toBe(true);
    expect(stack.layers.map((l) => l.id)).toEqual([b, a]);
  });

  it("removeLayer returns false for an absent id, without mutating the array", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    const before = stack.layers;
    expect(stack.removeLayer("missing")).toBe(false);
    expect(stack.layers).toBe(before);
  });

  it("removeLayer returns true and removes for an existing id", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.removeLayer(id)).toBe(true);
    expect(stack.layers).toHaveLength(0);
  });

  it("toggleLayer returns false for an absent id", () => {
    const stack = new LayerStack();
    expect(stack.toggleLayer("missing")).toBe(false);
  });

  it("toggleLayer returns true for an existing id", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.toggleLayer(id)).toBe(true);
  });

  it("updateBrushMask returns false for an absent id", () => {
    const stack = new LayerStack();
    expect(stack.updateBrushMask("missing", new Uint8Array([1]))).toBe(false);
  });

  it("updateBrushMask returns true for an existing id", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.updateBrushMask(id, new Uint8Array([1]))).toBe(true);
  });

  it("removeMaskSource returns false when the layer is absent", () => {
    const stack = new LayerStack();
    expect(stack.removeMaskSource("missing-layer", "missing-source")).toBe(false);
  });

  it("removeMaskSource returns false when the source is absent, without mutating sources", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const before = stack.layers.find((l) => l.id === layerId)!.mask.sources;
    expect(stack.removeMaskSource(layerId, "missing-source")).toBe(false);
    expect(stack.layers.find((l) => l.id === layerId)!.mask.sources).toBe(before);
  });

  it("removeMaskSource returns true when the source exists", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    expect(stack.removeMaskSource(layerId, sourceId)).toBe(true);
  });

  it("updateMaskSourceParams returns false when the layer is absent", () => {
    const stack = new LayerStack();
    expect(stack.updateMaskSourceParams("missing-layer", "missing-source", {})).toBe(false);
  });

  it("updateMaskSourceParams returns false when the source is absent, without mutating sources", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const before = stack.layers.find((l) => l.id === layerId)!.mask.sources;
    expect(stack.updateMaskSourceParams(layerId, "missing-source", {})).toBe(false);
    expect(stack.layers.find((l) => l.id === layerId)!.mask.sources).toBe(before);
  });

  it("updateMaskSourceParams returns false when params are unchanged (no-op), without mutating sources", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const current = stack.layers.find((l) => l.id === layerId)!.mask.sources.find((s) => s.id === sourceId)!.params!;
    const before = stack.layers.find((l) => l.id === layerId)!.mask.sources;
    expect(stack.updateMaskSourceParams(layerId, sourceId, { ...current })).toBe(false);
    expect(stack.layers.find((l) => l.id === layerId)!.mask.sources).toBe(before);
  });

  it("updateMaskSourceParams returns true when a param value actually changes", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    const current = stack.layers.find((l) => l.id === layerId)!.mask.sources.find((s) => s.id === sourceId)!.params!;
    expect(stack.updateMaskSourceParams(layerId, sourceId, { ...current, feather: (current.feather as number) + 1 })).toBe(true);
  });

  it("setMaskSourceCombineMode returns false when the source is absent", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    expect(stack.setMaskSourceCombineMode(layerId, "missing-source", "subtract")).toBe(false);
  });

  it("setMaskSourceCombineMode returns false when the mode is unchanged (no-op)", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient"); // default combineMode is "add"
    const before = stack.layers.find((l) => l.id === layerId)!.mask.sources;
    expect(stack.setMaskSourceCombineMode(layerId, sourceId, "add")).toBe(false);
    expect(stack.layers.find((l) => l.id === layerId)!.mask.sources).toBe(before);
  });

  it("setMaskSourceCombineMode returns true when the mode actually changes", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const sourceId = stack.addMaskSource(layerId, "gradient");
    expect(stack.setMaskSourceCombineMode(layerId, sourceId, "subtract")).toBe(true);
  });

  it("updateRefineEdge returns false for an absent layer", () => {
    const stack = new LayerStack();
    expect(stack.updateRefineEdge("missing", { feather: 3 })).toBe(false);
  });

  it("updateRefineEdge returns false when the patch matches current values (no-op), without mutating the mask", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    const before = stack.layers.find((l) => l.id === layerId)!.mask;
    expect(stack.updateRefineEdge(layerId, { feather: before.refineEdge.feather })).toBe(false);
    expect(stack.layers.find((l) => l.id === layerId)!.mask).toBe(before);
  });

  it("updateRefineEdge returns true when a field actually changes", () => {
    const stack = new LayerStack();
    const layerId = stack.addLayer("grain");
    expect(stack.updateRefineEdge(layerId, { feather: 7 })).toBe(true);
  });

  it("setMaskInvert returns false for an absent id and when unchanged (no-op)", () => {
    const stack = new LayerStack();
    expect(stack.setMaskInvert("missing", true)).toBe(false);
    const id = stack.addLayer("glow");
    const before = stack.layers.find((l) => l.id === id)!.mask;
    expect(stack.setMaskInvert(id, false)).toBe(false); // already false
    expect(stack.layers.find((l) => l.id === id)!.mask).toBe(before);
  });

  it("setMaskInvert returns true when the value actually changes", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.setMaskInvert(id, true)).toBe(true);
  });

  it("setMaskEnabled returns false for an absent id and when unchanged (no-op)", () => {
    const stack = new LayerStack();
    expect(stack.setMaskEnabled("missing", true)).toBe(false);
    const id = stack.addLayer("glow");
    const before = stack.layers.find((l) => l.id === id)!.mask;
    expect(stack.setMaskEnabled(id, true)).toBe(false); // already true
    expect(stack.layers.find((l) => l.id === id)!.mask).toBe(before);
  });

  it("setMaskEnabled returns true when the value actually changes", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.setMaskEnabled(id, false)).toBe(true);
  });

  it("updateParams returns false for an absent id", () => {
    const stack = new LayerStack();
    expect(stack.updateParams("missing", { intensity: 0.5 })).toBe(false);
  });

  it("updateParams returns false when the merged params are unchanged (no-op)", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateParams(id, { intensity: 0.5 });
    expect(stack.updateParams(id, { intensity: 0.5 })).toBe(false);
  });

  it("updateParams returns true when a param value actually changes", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.updateParams(id, { intensity: 0.5 })).toBe(true);
  });
});

describe("LayerStack photo layers", () => {
  it("addPhotoLayer crée un calque avec imageSource/transform et effectId=passthrough", () => {
    const stack = new LayerStack();
    const transform = { x: 100, y: 50, scale: 1, rotation: 0 };
    const id = stack.addPhotoLayer("photo-1", transform);
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.effectId).toBe("passthrough");
    expect(layer.imageSource).toEqual({ sourceId: "photo-1" });
    expect(layer.transform).toEqual(transform);
    expect(layer.opacity).toBe(1);
    expect(layer.blendMode).toBe("normal");
  });

  it("updateLayerTransform remplace le transform d'un calque photo existant", () => {
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    const changed = stack.updateLayerTransform(id, { x: 10, y: 20, scale: 1.5, rotation: 0.2 });
    expect(changed).toBe(true);
    expect(stack.layers[0].transform).toEqual({ x: 10, y: 20, scale: 1.5, rotation: 0.2 });
  });

  it("updateLayerTransform est un no-op (retourne false) si le transform n'a pas changé", () => {
    const stack = new LayerStack();
    const t = { x: 0, y: 0, scale: 1, rotation: 0 };
    const id = stack.addPhotoLayer("photo-1", t);
    expect(stack.updateLayerTransform(id, { ...t })).toBe(false);
  });

  it("updateLayerTransform retourne false pour un calque sans imageSource", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.updateLayerTransform(id, { x: 0, y: 0, scale: 1, rotation: 0 })).toBe(false);
  });

  it("updateLayerTransform retourne false pour un id absent", () => {
    const stack = new LayerStack();
    expect(stack.updateLayerTransform("no-such-id", { x: 0, y: 0, scale: 1, rotation: 0 })).toBe(false);
  });

  it("clone() préserve imageSource/transform d'un calque photo", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("photo-1", { x: 5, y: 5, scale: 2, rotation: 1 });
    const copy = stack.clone();
    expect(copy.layers[0].imageSource).toEqual({ sourceId: "photo-1" });
    expect(copy.layers[0].transform).toEqual({ x: 5, y: 5, scale: 2, rotation: 1 });
  });
});

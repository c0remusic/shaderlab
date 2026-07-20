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

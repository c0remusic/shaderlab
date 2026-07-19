import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";

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

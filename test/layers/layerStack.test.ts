import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";

describe("LayerStack", () => {
  it("adds a layer with default params and enabled=true", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.layers).toHaveLength(1);
    expect(stack.layers[0]).toMatchObject({ id, effectId: "glow", enabled: true, maskData: null });
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

  it("updateMask replaces a layer's maskData with a copy", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const mask = new Uint8Array([1, 2, 3]);
    stack.updateMask(id, mask);
    expect(stack.layers[0].maskData).toEqual(mask);
    mask[0] = 99;
    expect(stack.layers[0].maskData![0]).not.toBe(99); // stored a copy, not the same reference
  });

  it("clone() produces a deep copy independent of the original", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const copy = stack.clone();
    copy.updateParams(id, { intensity: 0.9 });
    expect(stack.layers[0].params.intensity).not.toBe(0.9);
  });

  it("clone() shares maskData references (masks are immutable snapshots)", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateMask(id, new Uint8Array([1, 2, 3]));
    const copy = stack.clone();
    // Partage volontaire : updateMask remplace toujours la référence par une
    // copie fraîche, donc partager le buffer entre clones est sûr et rend
    // clone() indépendant de la taille des masques.
    expect(copy.layers[0].maskData).toBe(stack.layers[0].maskData);
  });

  it("updateMask on a clone does not affect the original (replace, never mutate)", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateMask(id, new Uint8Array([1, 2, 3]));
    const copy = stack.clone();
    copy.updateMask(id, new Uint8Array([9, 9, 9]));
    expect(stack.layers[0].maskData![0]).toBe(1);
  });

  it("addLayer initialise opacity=1 et blendMode='normal'", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("grain");
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.opacity).toBe(1);
    expect(layer.blendMode).toBe("normal");
  });
});

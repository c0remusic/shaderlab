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
});

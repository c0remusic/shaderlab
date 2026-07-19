import { describe, it, expect } from "vitest";
import { toDisplayLayers } from "../../src/layers/displayProjection";
import { LayerStack } from "../../src/layers/layerStack";

describe("toDisplayLayers", () => {
  it("returns layers unchanged by identity when no source has a raster", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    const projected = toDisplayLayers(stack.layers);
    expect(projected[0]).toBe(stack.layers[0]);
  });

  it("strips raster from every source, keeping other mask fields", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    stack.setMaskInvert(id, true);
    const [projected] = toDisplayLayers(stack.layers);
    expect(projected.mask.sources[0].raster).toBeNull();
    expect(projected.mask.sources[0].type).toBe("brush");
    expect(projected.mask.invert).toBe(true);
    // original untouched
    expect(stack.layers[0].mask.sources[0].raster).not.toBeNull();
  });
});

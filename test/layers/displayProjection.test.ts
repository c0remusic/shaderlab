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

  it("strips raster DATA from every source, keeping other mask fields", () => {
    // Depuis l'union discriminée (Task 1, mask-integrity), une source "brush"
    // ne peut plus avoir raster: null (invariant "valide par construction") —
    // le vidage se fait via un Uint8Array VIDE, pas null. Ce qui compte pour
    // le fix crash 24MP (buffer hors state React), c'est l'absence de DONNÉES,
    // pas la nullité littérale.
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    stack.setMaskInvert(id, true);
    const [projected] = toDisplayLayers(stack.layers);
    expect(projected.mask.sources[0].raster).not.toBeNull();
    expect(projected.mask.sources[0].raster!.length).toBe(0);
    expect(projected.mask.sources[0].type).toBe("brush");
    expect(projected.mask.invert).toBe(true);
    // original untouched
    expect(stack.layers[0].mask.sources[0].raster!.length).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import { getBrushRaster } from "../../src/mask/brushSource";
import { defaultLayerMask, createBrushSource } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

function layerWith(mask = defaultLayerMask()): LayerState {
  return { id: "l1", effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask };
}

describe("getBrushRaster", () => {
  it("returns null when the layer has no brush source", () => {
    expect(getBrushRaster(layerWith())).toBeNull();
  });

  it("returns the brush source's raster when present", () => {
    const raster = new Uint8Array([9, 9]);
    const mask = defaultLayerMask();
    mask.sources.push(createBrushSource("l1-brush", raster));
    expect(getBrushRaster(layerWith(mask))).toBe(raster);
  });
});

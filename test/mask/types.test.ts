import { describe, it, expect } from "vitest";
import { defaultLayerMask, defaultRefineEdge, createBrushSource } from "../../src/mask/types";

describe("defaultRefineEdge", () => {
  it("is a no-op (identity) refine-edge configuration", () => {
    const r = defaultRefineEdge();
    expect(r).toEqual({
      feather: 0,
      contract: 0,
      smooth: 0,
      edgeAware: false,
      edgeRadius: 10,
      edgeStrength: 1,
    });
  });
});

describe("defaultLayerMask", () => {
  it("starts with no sources, not inverted, enabled", () => {
    const m = defaultLayerMask();
    expect(m.sources).toEqual([]);
    expect(m.invert).toBe(false);
    expect(m.enabled).toBe(true);
    expect(m.refineEdge).toEqual(defaultRefineEdge());
  });

  it("returns a fresh object each call (no shared mutable default)", () => {
    const a = defaultLayerMask();
    const b = defaultLayerMask();
    a.sources.push(createBrushSource("x", new Uint8Array(1)));
    expect(b.sources).toEqual([]);
  });
});

describe("createBrushSource", () => {
  it("builds an enabled brush source with combineMode add", () => {
    const raster = new Uint8Array([1, 2, 3]);
    const s = createBrushSource("layer-1-brush", raster);
    expect(s).toEqual({
      id: "layer-1-brush",
      type: "brush",
      combineMode: "add",
      enabled: true,
      params: null,
      raster,
    });
  });
});

import { describe, it, expect } from "vitest";
import { buildMorphologyWgsl, buildSmoothWgsl } from "../../src/mask/refineEdgeWgsl";

describe("refine edge WGSL passes", () => {
  it("buildMorphologyWgsl('dilate') prend le max du voisinage", () => {
    const wgsl = buildMorphologyWgsl("dilate");
    expect(wgsl).toContain("fn fs_morphology(");
    expect(wgsl).toContain("max(");
  });

  it("buildMorphologyWgsl('erode') prend le min du voisinage", () => {
    const wgsl = buildMorphologyWgsl("erode");
    expect(wgsl).toContain("fn fs_morphology(");
    expect(wgsl).toContain("min(");
  });

  it("buildMorphologyWgsl expose un radius en uniform (px signé -> passes converties par l'appelant)", () => {
    expect(buildMorphologyWgsl("dilate")).toContain("var<uniform> radius: f32");
  });

  it("buildSmoothWgsl est un box-blur simple (réutilisable pour feather ET smooth)", () => {
    const wgsl = buildSmoothWgsl();
    expect(wgsl).toContain("fn fs_smooth(");
    expect(wgsl).toContain("var<uniform> radius: f32");
  });
});

import { describe, it, expect } from "vitest";
import {
  buildLuminanceWgsl,
  buildPackWgsl,
  buildSquareCorrWgsl,
  buildBoxFilterHWgsl,
  buildBoxFilterVWgsl,
  buildComputeABWgsl,
  buildCompositeWgsl,
} from "../../src/mask/edgeAwareWgsl";

describe("edge-aware WGSL passes", () => {
  it("buildLuminanceWgsl échantillonne colorTexture et sort une luminance r8", () => {
    const wgsl = buildLuminanceWgsl();
    expect(wgsl).toContain("var colorTexture: texture_2d<f32>");
    expect(wgsl).toContain("fn fs_luminance(");
    // coefficients Rec. 709 (cohérent avec un pipeline linéaire strict).
    expect(wgsl).toMatch(/0\.2126/);
  });

  it("buildPackWgsl empaquette I (r) et p (g) dans une texture rg8", () => {
    const wgsl = buildPackWgsl();
    expect(wgsl).toContain("var srcI: texture_2d<f32>");
    expect(wgsl).toContain("var srcP: texture_2d<f32>");
    expect(wgsl).toContain("fn fs_pack(");
  });

  it("buildSquareCorrWgsl calcule I*I (r) et I*p (g)", () => {
    const wgsl = buildSquareCorrWgsl();
    expect(wgsl).toContain("fn fs_squareCorr(");
    expect(wgsl).toContain("i * i");
    expect(wgsl).toContain("i * p");
  });

  it("les box filters H/V acceptent 1 ou 2 canaux et exposent un radius uniform", () => {
    for (const channels of [1, 2] as const) {
      const h = buildBoxFilterHWgsl(channels);
      const v = buildBoxFilterVWgsl(channels);
      expect(h).toContain("var<uniform> radius: f32");
      expect(v).toContain("var<uniform> radius: f32");
      expect(h).toContain("fn fs_boxH(");
      expect(v).toContain("fn fs_boxV(");
    }
  });

  it("buildComputeABWgsl calcule a/b et sort en rg16float (pas de clamp)", () => {
    const wgsl = buildComputeABWgsl();
    expect(wgsl).toContain("fn fs_computeAB(");
    expect(wgsl).not.toContain("clamp(");
  });

  it("buildCompositeWgsl expose edgeStrength en uniform et clamp la sortie", () => {
    const wgsl = buildCompositeWgsl();
    expect(wgsl).toContain("var<uniform> edgeStrength: f32");
    expect(wgsl).toContain("fn fs_composite(");
    expect(wgsl).toContain("clamp(");
  });
});

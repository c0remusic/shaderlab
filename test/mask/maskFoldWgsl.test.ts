import { describe, it, expect } from "vitest";
import { buildCombineWgsl, buildInvertWgsl } from "../../src/mask/maskFoldWgsl";

describe("buildCombineWgsl", () => {
  it("add = max(a, b)", () => {
    expect(buildCombineWgsl("add")).toContain("max(a, b)");
  });
  it("subtract = clamp(a - b, 0.0, 1.0)", () => {
    expect(buildCombineWgsl("subtract")).toContain("clamp(a - b, 0.0, 1.0)");
  });
  it("intersect = min(a, b)", () => {
    expect(buildCombineWgsl("intersect")).toContain("min(a, b)");
  });
  it("every mode declares two texture bindings (srcA, srcB) and a sampler", () => {
    for (const mode of ["add", "subtract", "intersect"] as const) {
      const wgsl = buildCombineWgsl(mode);
      expect(wgsl).toContain("var srcA: texture_2d<f32>");
      expect(wgsl).toContain("var srcB: texture_2d<f32>");
      expect(wgsl).toContain("var maskSampler: sampler");
      expect(wgsl).toContain("fn fs_combine(");
    }
  });
});

describe("buildInvertWgsl", () => {
  it("declares one texture binding and inverts (1.0 - a)", () => {
    const wgsl = buildInvertWgsl();
    expect(wgsl).toContain("var srcA: texture_2d<f32>");
    expect(wgsl).not.toContain("srcB");
    expect(wgsl).toContain("1.0 - a");
    expect(wgsl).toContain("fn fs_invert(");
  });
});

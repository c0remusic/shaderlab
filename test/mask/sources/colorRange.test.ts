import { describe, it, expect } from "vitest";
import { colorRangeSource, MAX_COLOR_RANGE_SAMPLES } from "../../../src/mask/sources/colorRange";

describe("colorRange source module", () => {
  it("defaultParams inclut tolerance/hardness/invert/samples (samples = [] par défaut)", () => {
    expect(colorRangeSource.defaultParams.tolerance).toBeTypeOf("number");
    expect(colorRangeSource.defaultParams.hardness).toBeTypeOf("number");
    expect(colorRangeSource.defaultParams.samples).toEqual([]);
  });

  it("MAX_COLOR_RANGE_SAMPLES borne le nombre d'échantillons cumulables (tableau uniform fixe, pas de storage buffer)", () => {
    expect(MAX_COLOR_RANGE_SAMPLES).toBeGreaterThan(0);
  });

  it("le wgsl calcule une distance colorimétrique minimale aux échantillons", () => {
    expect(colorRangeSource.wgsl).toContain("fn fs_generate(");
    expect(colorRangeSource.wgsl).toContain("distance(");
    expect(colorRangeSource.wgsl).toContain("smoothstep(");
  });
});

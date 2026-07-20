import { describe, it, expect } from "vitest";
import { gradientSource } from "../../../src/mask/sources/gradient";

describe("gradient source module", () => {
  it("id = gradient, defaultParams inclut angle/startX/startY/endX/endY/feather/invert", () => {
    expect(gradientSource.id).toBe("gradient");
    for (const key of ["angle", "startX", "startY", "endX", "endY", "feather", "invert"]) {
      expect(gradientSource.defaultParams).toHaveProperty(key);
    }
  });

  it("le wgsl calcule une projection linéaire le long du gradient", () => {
    expect(gradientSource.wgsl).toContain("fn fs_generate(");
    expect(gradientSource.wgsl).toContain("dot(");
  });
});

import { describe, it, expect } from "vitest";
import { luminositySource } from "../../../src/mask/sources/luminosity";

describe("luminosity source module", () => {
  it("defaultParams couvre shadowsMin/shadowsMax/highlightsMin/highlightsMax/tolerance/invert", () => {
    for (const key of ["shadowsMin", "shadowsMax", "highlightsMin", "highlightsMax", "tolerance", "invert"]) {
      expect(luminositySource.defaultParams).toHaveProperty(key);
    }
  });

  it("le wgsl calcule une luminance Rec.709 en espace linéaire", () => {
    expect(luminositySource.wgsl).toContain("fn fs_generate(");
    expect(luminositySource.wgsl).toMatch(/0\.2126/);
  });

  it("le wgsl utilise smoothstep pour un masque continu (pas un seuil binaire)", () => {
    expect(luminositySource.wgsl).toContain("smoothstep(");
  });
});

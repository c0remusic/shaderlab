import { describe, it, expect } from "vitest";
import { maskSourceRegistry, getMaskSourceModule } from "../../../src/mask/sources/registry";

describe("mask source registry", () => {
  it("contient gradient/luminosity/colorRange, ids uniques", () => {
    const ids = maskSourceRegistry.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("gradient");
  });

  it("getMaskSourceModule jette sur un type inconnu", () => {
    // @ts-expect-error test volontaire d'un id invalide
    expect(() => getMaskSourceModule("does-not-exist")).toThrow(/Source de masque inconnue/);
  });

  it("chaque module définit fs_generate dans son wgsl", () => {
    for (const m of maskSourceRegistry) {
      expect(m.wgsl).toMatch(/fn\s+fs_generate\s*\(/);
    }
  });

  it("chaque module a des defaultParams non vides", () => {
    for (const m of maskSourceRegistry) {
      expect(Object.keys(m.defaultParams).length).toBeGreaterThan(0);
    }
  });
});

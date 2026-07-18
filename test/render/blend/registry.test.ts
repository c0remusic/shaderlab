import { describe, it, expect } from "vitest";
import { blendRegistry, getBlendMode } from "../../../src/render/blend/registry";

describe("blend registry", () => {
  it("contient le mode normal", () => {
    expect(blendRegistry.find((m) => m.id === "normal")).toBeDefined();
  });

  it("getBlendMode retourne le module par id", () => {
    expect(getBlendMode("multiply").id).toBe("multiply");
  });

  it("getBlendMode jette sur un id inconnu", () => {
    expect(() => getBlendMode("does-not-exist")).toThrow(/Mode de fusion inconnu/);
  });

  it("chaque module définit une fonction blend dans son wgsl", () => {
    for (const m of blendRegistry) {
      expect(m.wgsl).toMatch(/fn\s+blend\s*\(/);
    }
  });

  it("chaque module a un id et un name non vides et un id unique", () => {
    const ids = new Set<string>();
    for (const m of blendRegistry) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.name.length).toBeGreaterThan(0);
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
    }
  });

  it("le mode normal renvoie top (identité de compositing)", () => {
    expect(getBlendMode("normal").wgsl).toMatch(/return\s+top\s*;/);
  });
});

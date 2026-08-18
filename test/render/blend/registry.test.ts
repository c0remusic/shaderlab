import { describe, it, expect } from "vitest";
import { blendRegistry, getBlendMode } from "../../../src/render/blend/registry";
import { composeShader } from "../../../src/render/shaderCompose";
import { effectRegistry } from "../../../src/render/effects/registry";

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

  it("les six modes du ticket 12 sont au registre", () => {
    for (const id of ["difference", "subtract", "hue", "saturation", "color", "luminosity"]) {
      expect(getBlendMode(id).id).toBe(id);
    }
  });

  it("chaque module ne déclare qu'UNE fonction blend", () => {
    for (const m of blendRegistry) {
      expect(m.wgsl.match(/^fn\s+blend\s*\(/gm) ?? [], m.id).toHaveLength(1);
    }
  });

  // POURQUOI CE TEST (2026-08-18). Les quatre modes non séparables montent leur
  // corps sur des helpers PARTAGÉS (`blend_lum`, `blend_set_sat`, …), injectés
  // dans le shader composé aux côtés de ceux de shaderCompose et de l'effet.
  // Une collision de nom ne se voit ni au type-check ni à l'exécution des tests
  // unitaires : elle ne rougirait qu'au compilateur WGSL, donc en CI seulement
  // par `test:wgsl` (qui exige naga installé) ou, en local, par le GPU.
  it("aucun mode n'introduit un nom de fonction déjà pris dans le shader composé", () => {
    const support = effectRegistry.find((e) => e.id === "grain");
    if (!support) throw new Error("effet `grain` introuvable : choisir un autre support");
    for (const m of blendRegistry) {
      const source = composeShader(support.wgsl, {
        applyMask: true, hasPrevPass: false, blendWgsl: m.wgsl,
      });
      const noms = [...source.matchAll(/^fn\s+(\w+)\s*\(/gm)].map((x) => x[1]);
      const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
      expect(doublons, `mode ${m.id}`).toEqual([]);
    }
  });
});

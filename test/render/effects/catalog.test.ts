import { describe, expect, it } from "vitest";
import { buildEffectCatalog, effectCategoryById } from "../../../src/render/effects/catalog";
import { effectRegistry } from "../../../src/render/effects/registry";

describe("effect catalog", () => {
  it("classe exhaustivement chaque effet du registre une seule fois", () => {
    const groups = buildEffectCatalog(effectRegistry);
    const ids = groups.flatMap((group) => group.effects.map((effect) => effect.id));
    expect(ids).toHaveLength(effectRegistry.length);
    expect(new Set(ids).size).toBe(effectRegistry.length);
    expect(Object.keys(effectCategoryById)).toHaveLength(effectRegistry.length);
  });

  it("filtre par nom sans perdre les catégories", () => {
    expect(buildEffectCatalog(effectRegistry, "blur").flatMap((g) => g.effects.map((e) => e.name)))
      .toEqual(expect.arrayContaining(["Lens blur", "Motion blur"]));
  });

  it("échoue bruyamment lorsqu'un effet n'est pas déclaré", () => {
    expect(() => buildEffectCatalog([...effectRegistry, { ...effectRegistry[0], id: "nouveau" }]))
      .toThrow(/sans catégorie: nouveau/);
  });
});

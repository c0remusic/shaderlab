import { describe, it, expect } from "vitest";
import { toDisplayLayers } from "../../src/layers/displayProjection";
import { LayerStack } from "../../src/layers/layerStack";

describe("toDisplayLayers", () => {
  it("returns layers unchanged by identity when no source has a raster", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    const projected = toDisplayLayers(stack.layers);
    expect(projected[0]).toBe(stack.layers[0]);
  });

  it("strips raster DATA from every source, keeping other mask fields", () => {
    // Depuis l'union discriminée (Task 1, mask-integrity), une source "brush"
    // ne peut plus avoir raster: null (invariant "valide par construction") —
    // le vidage se fait via un Uint8Array VIDE, pas null. Ce qui compte pour
    // le fix crash 24MP (buffer hors state React), c'est l'absence de DONNÉES,
    // pas la nullité littérale.
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    stack.setMaskInvert(id, true);
    const [projected] = toDisplayLayers(stack.layers);
    expect(projected.mask.sources[0].raster).not.toBeNull();
    expect(projected.mask.sources[0].raster!.length).toBe(0);
    expect(projected.mask.sources[0].type).toBe("brush");
    expect(projected.mask.invert).toBe(true);
    // original untouched
    expect(stack.layers[0].mask.sources[0].raster!.length).toBe(3);
  });

  // Identité du TABLEAU (2026-07-30). Avant le fix, `layers.map(...)` rendait un
  // tableau neuf à chaque appel : `setLayers()` voyait toujours une valeur
  // différente, donc React re-rendait l'arbre entier même quand rien n'avait
  // bougé, et toute mémoïsation en aval était inopérante par construction.
  it("rend le MÊME tableau sur deux appels successifs sans changement (sans raster)", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(toDisplayLayers(stack.layers)).toBe(toDisplayLayers(stack.layers));
  });

  it("rend le MÊME tableau sur deux appels successifs sans changement (avec raster)", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    const first = toDisplayLayers(stack.layers);
    const second = toDisplayLayers(stack.layers);
    expect(second).toBe(first);
    // et le vidage reste bien fait (la stabilité ne doit pas se payer en
    // laissant entrer le raster dans le state React — invariant e3c7584)
    expect(second[0].mask.sources[0].raster!.length).toBe(0);
  });

  it("rend un tableau NEUF quand un seul calque change d'identité, en préservant celle des autres", () => {
    const stack = new LayerStack();
    const first = stack.addLayer("glow");
    stack.addLayer("grain");
    stack.updateBrushMask(first, new Uint8Array([1, 2, 3]));
    const before = toDisplayLayers(stack.layers);

    // Exactement ce que fait un chemin vivant de drag (App.handleParamChange) :
    // un objet frais pour le seul calque touché, les autres par référence.
    const next = stack.layers.map((l) => (l.id === first ? { ...l, opacity: 0.5 } : l));
    const after = toDisplayLayers(next);

    expect(after).not.toBe(before);
    expect(after[0]).not.toBe(before[0]);
    expect(after[0].opacity).toBe(0.5);
    expect(after[1]).toBe(before[1]); // le calque intact garde son identité
  });
});

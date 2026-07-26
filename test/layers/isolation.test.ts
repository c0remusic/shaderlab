import { describe, it, expect } from "vitest";
import {
  eyeClickOutcome,
  isLayerVisible,
  projectIsolation,
  reconcileIsolation,
} from "../../src/layers/isolation";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask, createBrushSource } from "../../src/mask/types";

function makeLayer(id: string, enabled: boolean, mask = defaultLayerMask()): LayerState {
  return { id, effectId: "glow", params: {}, enabled, opacity: 1, blendMode: "normal", mask };
}

describe("isLayerVisible", () => {
  it("rend la valeur stockée hors isolation", () => {
    expect(isLayerVisible(makeLayer("a", true), null)).toBe(true);
    expect(isLayerVisible(makeLayer("a", false), null)).toBe(false);
  });

  it("ne rend visible que le calque isolé", () => {
    expect(isLayerVisible(makeLayer("a", true), "a")).toBe(true);
    expect(isLayerVisible(makeLayer("b", true), "a")).toBe(false);
  });

  it("force la visibilité du calque isolé même s'il était masqué", () => {
    expect(isLayerVisible(makeLayer("a", false), "a")).toBe(true);
  });
});

describe("projectIsolation", () => {
  it("rend le tableau PAR IDENTITÉ hors isolation", () => {
    const layers = [makeLayer("a", true), makeLayer("b", false)];
    expect(projectIsolation(layers, null)).toBe(layers);
  });

  it("masque tous les autres calques", () => {
    const layers = [makeLayer("a", true), makeLayer("b", true), makeLayer("c", true)];
    expect(projectIsolation(layers, "b").map((l) => l.enabled)).toEqual([false, true, false]);
  });

  it("ne mute jamais les calques d'origine (état antérieur intact)", () => {
    const layers = [makeLayer("a", true), makeLayer("b", false)];
    projectIsolation(layers, "b");
    expect(layers.map((l) => l.enabled)).toEqual([true, false]);
  });

  it("restitue exactement l'état antérieur au retour, calque déjà masqué compris", () => {
    const layers = [makeLayer("a", true), makeLayer("b", false), makeLayer("c", true)];
    const isolated = projectIsolation(layers, "a");
    expect(isolated.map((l) => l.enabled)).toEqual([true, false, false]);
    // Sortie d'isolation = repasser à null sur la MÊME source de vérité.
    expect(projectIsolation(layers, null).map((l) => l.enabled)).toEqual([true, false, true]);
  });

  it("garde par identité les calques dont la visibilité effective ne change pas", () => {
    const layers = [makeLayer("a", true), makeLayer("b", false)];
    const projected = projectIsolation(layers, "a");
    expect(projected[0]).toBe(layers[0]); // isolé et déjà enabled -> inchangé
    expect(projected[1]).toBe(layers[1]); // déjà masqué -> inchangé
  });

  it("partage le raster de masque par référence (jamais de copie de gros buffer)", () => {
    const raster = new Uint8Array(16);
    const mask = { ...defaultLayerMask(), sources: [createBrushSource("a-brush", raster)] };
    const layers = [makeLayer("a", true, mask), makeLayer("b", true)];
    const projected = projectIsolation(layers, "b");
    expect(projected[0].mask.sources[0].raster).toBe(raster);
  });
});

describe("reconcileIsolation", () => {
  it("garde l'isolation tant que le calque existe", () => {
    expect(reconcileIsolation("a", ["a", "b"])).toBe("a");
  });

  it("abandonne l'isolation quand le calque isolé est supprimé", () => {
    expect(reconcileIsolation("a", ["b", "c"])).toBeNull();
  });

  it("abandonne l'isolation sur un document vide (changement de document)", () => {
    expect(reconcileIsolation("a", [])).toBeNull();
  });

  it("reste null quand rien n'est isolé", () => {
    expect(reconcileIsolation(null, ["a"])).toBeNull();
  });
});

describe("eyeClickOutcome", () => {
  it("Alt+clic isole le calque, sans toucher au modèle", () => {
    expect(eyeClickOutcome(null, "a", true)).toEqual({ isolatedLayerId: "a", toggleEnabled: false });
  });

  it("Alt+clic sur le calque déjà isolé rétablit l'état antérieur", () => {
    expect(eyeClickOutcome("a", "a", true)).toEqual({ isolatedLayerId: null, toggleEnabled: false });
  });

  it("Alt+clic sur un autre calque déplace l'isolation", () => {
    expect(eyeClickOutcome("a", "b", true)).toEqual({ isolatedLayerId: "b", toggleEnabled: false });
  });

  it("clic simple hors isolation bascule la visibilité", () => {
    expect(eyeClickOutcome(null, "a", false)).toEqual({ isolatedLayerId: null, toggleEnabled: true });
  });

  it("clic simple pendant l'isolation en sort SANS basculer la visibilité", () => {
    expect(eyeClickOutcome("a", "b", false)).toEqual({ isolatedLayerId: null, toggleEnabled: false });
    expect(eyeClickOutcome("a", "a", false)).toEqual({ isolatedLayerId: null, toggleEnabled: false });
  });
});

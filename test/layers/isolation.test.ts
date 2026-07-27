import { describe, it, expect } from "vitest";
import {
  eyeButtonLabels,
  eyeClickOutcome,
  isLayerVisible,
  isolationRole,
  isolationVisibleIds,
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

  it("ne rend visible que ce que le set d'isolation contient", () => {
    expect(isLayerVisible(makeLayer("a", true), new Set(["a"]))).toBe(true);
    expect(isLayerVisible(makeLayer("b", true), new Set(["a"]))).toBe(false);
  });

  it("force la visibilité du calque isolé même s'il était masqué", () => {
    expect(isLayerVisible(makeLayer("a", false), new Set(["a"]))).toBe(true);
  });
});

describe("isolationVisibleIds (écrêtage × isolation, §3.5)", () => {
  function photo(id: string, enabled = true): LayerState {
    return {
      ...makeLayer(id, enabled),
      effectId: "passthrough",
      imageSource: { sourceId: `src-${id}` },
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    };
  }
  const clipped = (id: string, enabled = true): LayerState => ({ ...makeLayer(id, enabled), clipToBelow: true });

  it("rend null hors isolation", () => {
    expect(isolationVisibleIds([makeLayer("a", true)], null)).toBeNull();
  });

  it("le calque isolé seul quand il n'est pas écrêté", () => {
    const layers = [photo("P"), makeLayer("E", true)];
    expect(isolationVisibleIds(layers, "E")).toEqual(new Set(["E"]));
  });

  it("isoler un écrêté ACTIF rend aussi visible sa base photo (jamais d'écran vide)", () => {
    const layers = [photo("P"), clipped("C")];
    expect(isolationVisibleIds(layers, "C")).toEqual(new Set(["C", "P"]));
  });

  it("tire la base photo même si elle est masquée dans le modèle", () => {
    const layers = [photo("P", false), clipped("C")];
    expect(isolationVisibleIds(layers, "C")).toEqual(new Set(["C", "P"]));
  });

  it("isoler un écrêté INERTE ne tire rien (la base n'est pas une photo)", () => {
    const layers = [photo("P"), makeLayer("X", true), clipped("C")];
    expect(isolationVisibleIds(layers, "C")).toEqual(new Set(["C"]));
  });

  it("isoler le 2e d'une chaîne tire la base photo, PAS le 1er écrêté", () => {
    const layers = [photo("P"), clipped("C1"), clipped("C2")];
    expect(isolationVisibleIds(layers, "C2")).toEqual(new Set(["C2", "P"]));
  });

  it("isoler la PHOTO ne tire pas les écrêtés au-dessus (extension vers le bas seulement)", () => {
    const layers = [photo("P"), clipped("C")];
    expect(isolationVisibleIds(layers, "P")).toEqual(new Set(["P"]));
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

describe("isolationRole", () => {
  it("rend « none » hors isolation", () => {
    expect(isolationRole("a", null)).toBe("none");
  });

  it("distingue le calque isolé des autres", () => {
    expect(isolationRole("a", "a")).toBe("isolated");
    expect(isolationRole("b", "a")).toBe("other");
  });
});

describe("eyeButtonLabels", () => {
  it("hors isolation, annonce la bascule de visibilité et l'entrée en isolation", () => {
    expect(eyeButtonLabels(true, "none")).toEqual({
      label: "Masquer le calque",
      tooltip: "Masquer le calque · Alt+clic : isoler ce calque",
    });
    expect(eyeButtonLabels(false, "none")).toEqual({
      label: "Afficher le calque",
      tooltip: "Afficher le calque · Alt+clic : isoler ce calque",
    });
  });

  // Le défaut corrigé : sur le calque ISOLÉ, l'Alt+clic QUITTE l'isolation
  // (eyeClickOutcome("a","a",true) -> null), donc l'infobulle ne doit surtout
  // pas y annoncer « isoler ce calque ».
  it("sur le calque isolé, n'annonce QUE la sortie d'isolation", () => {
    expect(eyeButtonLabels(true, "isolated")).toEqual({
      label: "Quitter l'isolation",
      tooltip: "Quitter l'isolation",
    });
    expect(eyeButtonLabels(true, "isolated").tooltip).not.toContain("isoler ce calque");
  });

  it("sur un autre calque, annonce la sortie et le déplacement de l'isolation", () => {
    expect(eyeButtonLabels(false, "other")).toEqual({
      label: "Quitter l'isolation",
      tooltip: "Quitter l'isolation · Alt+clic : isoler ce calque",
    });
  });

  it("l'infobulle décrit toujours ce que l'Alt+clic fait réellement", () => {
    for (const [role, layerId, isolated] of [
      ["none", "a", null],
      ["isolated", "a", "a"],
      ["other", "b", "a"],
    ] as const) {
      const annonceIsolation = eyeButtonLabels(true, role).tooltip.includes("Alt+clic : isoler ce calque");
      const isoleVraiment = eyeClickOutcome(isolated, layerId, true).isolatedLayerId === layerId;
      expect(annonceIsolation).toBe(isoleVraiment);
    }
  });
});

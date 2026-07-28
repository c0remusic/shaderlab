import { describe, it, expect } from "vitest";
import { layerControlsModel, formatOpacityPercent, opacityToPercent, parseOpacityPercent } from "../../src/components/layerControlsModel";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask } from "../../src/mask/types";

function layer(overrides: Partial<LayerState> & { id: string }): LayerState {
  return {
    effectId: "glow",
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    params: {},
    mask: defaultLayerMask(),
    ...overrides,
  };
}

describe("layerControlsModel", () => {
  it("sans sélection, l'en-tête est désactivé et n'emprunte aucune valeur à la pile", () => {
    const model = layerControlsModel([layer({ id: "a", opacity: 0.2, blendMode: "screen" })], null);
    expect(model).toEqual({ enabled: false, layerId: null, opacity: 1, blendMode: null, effectId: null });
  });

  it("sur pile vide, l'en-tête est désactivé", () => {
    expect(layerControlsModel([], null).enabled).toBe(false);
  });

  it("reflète le calque sélectionné, pas le premier de la pile", () => {
    const layers = [
      layer({ id: "a", effectId: "glow", opacity: 1, blendMode: "normal" }),
      layer({ id: "b", effectId: "grain", opacity: 0.4, blendMode: "screen" }),
    ];
    expect(layerControlsModel(layers, "b")).toEqual({
      enabled: true,
      layerId: "b",
      opacity: 0.4,
      blendMode: "screen",
      effectId: "grain",
    });
  });

  it("un selectedId périmé (calque supprimé) retombe sur l'état désactivé", () => {
    const model = layerControlsModel([layer({ id: "a" })], "disparu");
    expect(model.enabled).toBe(false);
    expect(model.layerId).toBeNull();
  });
});

describe("formatOpacityPercent", () => {
  it("rend un pourcentage entier", () => {
    expect(formatOpacityPercent(1)).toBe("100 %");
    expect(formatOpacityPercent(0)).toBe("0 %");
    expect(formatOpacityPercent(0.64)).toBe("64 %");
  });

  it("arrondit au plus proche plutôt que de tronquer", () => {
    expect(formatOpacityPercent(0.635)).toBe("64 %");
    expect(formatOpacityPercent(0.634)).toBe("63 %");
  });

  it("borne les valeurs hors plage au lieu d'afficher un pourcentage impossible", () => {
    expect(formatOpacityPercent(1.5)).toBe("100 %");
    expect(formatOpacityPercent(-0.2)).toBe("0 %");
  });
});

describe("opacityToPercent", () => {
  it("convertit l'opacité du modèle en pourcentage entier", () => {
    expect(opacityToPercent(0)).toBe(0);
    expect(opacityToPercent(0.6)).toBe(60);
    expect(opacityToPercent(1)).toBe(100);
  });

  it("borne, pour ne jamais afficher un pourcentage impossible", () => {
    expect(opacityToPercent(-1)).toBe(0);
    expect(opacityToPercent(4)).toBe(100);
  });
});

// Contrat de SAISIE du champ d'opacité de l'en-tête. Le champ lui-même n'est pas
// testable ici (aucun test de ce projet ne rend de composant React) : c'est
// cette fonction pure qui porte le contrat, et le composant ne fait que
// l'appeler.
describe("parseOpacityPercent", () => {
  it("accepte le nombre nu", () => {
    expect(parseOpacityPercent("60")).toBe(60);
  });

  it("accepte l'unité, collée ou espacée, et les espaces autour", () => {
    expect(parseOpacityPercent("60 %")).toBe(60);
    expect(parseOpacityPercent("60%")).toBe(60);
    expect(parseOpacityPercent("  60 %  ")).toBe(60);
  });

  it("accepte la virgule décimale et arrondit à l'entier", () => {
    expect(parseOpacityPercent("60,4")).toBe(60);
    expect(parseOpacityPercent("60.6")).toBe(61);
  });

  it("borne à 0..100 au lieu de laisser passer une valeur hors plage", () => {
    expect(parseOpacityPercent("250")).toBe(100);
    expect(parseOpacityPercent("-30")).toBe(0);
  });

  it("rend null sur une saisie sans nombre — l'appelant revient à la valeur précédente, jamais un NaN", () => {
    expect(parseOpacityPercent("")).toBeNull();
    expect(parseOpacityPercent("   ")).toBeNull();
    expect(parseOpacityPercent("abc")).toBeNull();
    expect(parseOpacityPercent("%")).toBeNull();
  });
});

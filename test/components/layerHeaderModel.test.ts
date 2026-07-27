import { describe, it, expect } from "vitest";
import { layerHeaderModel, formatOpacityPercent } from "../../src/components/layerHeaderModel";
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

describe("layerHeaderModel", () => {
  it("sans sélection, l'en-tête est désactivé et n'emprunte aucune valeur à la pile", () => {
    const model = layerHeaderModel([layer({ id: "a", opacity: 0.2, blendMode: "screen" })], null);
    expect(model).toEqual({ enabled: false, layerId: null, opacity: 1, blendMode: null, effectId: null });
  });

  it("sur pile vide, l'en-tête est désactivé", () => {
    expect(layerHeaderModel([], null).enabled).toBe(false);
  });

  it("reflète le calque sélectionné, pas le premier de la pile", () => {
    const layers = [
      layer({ id: "a", effectId: "glow", opacity: 1, blendMode: "normal" }),
      layer({ id: "b", effectId: "grain", opacity: 0.4, blendMode: "screen" }),
    ];
    expect(layerHeaderModel(layers, "b")).toEqual({
      enabled: true,
      layerId: "b",
      opacity: 0.4,
      blendMode: "screen",
      effectId: "grain",
    });
  });

  it("un selectedId périmé (calque supprimé) retombe sur l'état désactivé", () => {
    const model = layerHeaderModel([layer({ id: "a" })], "disparu");
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

import { describe, expect, it } from "vitest";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask } from "../../src/mask/types";
import { propertiesPanelTitle } from "../../src/components/PropertiesPanel";

function effect(): LayerState {
  return {
    id: "E",
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
  };
}

describe("propertiesPanelTitle", () => {
  it("nomme l'effet et la facette masque", () => {
    const layer = effect();
    expect(propertiesPanelTitle({ kind: "effect", layerId: "E" }, layer)).toBe("Propriétés · Glow");
    expect(propertiesPanelTitle({ kind: "mask", layerId: "E" }, layer)).toBe("Propriétés · Glow · Masque");
  });

  it("préfère le nom du calque photo", () => {
    const layer = {
      ...effect(),
      name: "Portrait",
      imageSource: { sourceId: "source" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    expect(propertiesPanelTitle({ kind: "photo", layerId: "E" }, layer)).toBe("Propriétés · Portrait");
  });

  it("retombe sur le titre neutre pour une cible absente ou incohérente", () => {
    expect(propertiesPanelTitle(null, effect())).toBe("Propriétés");
    expect(propertiesPanelTitle({ kind: "effect", layerId: "autre" }, effect())).toBe("Propriétés");
  });
});


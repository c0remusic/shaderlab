import { describe, it, expect } from "vitest";
import { toDisplayLayers } from "../../src/layers/displayProjection";
import type { LayerState } from "../../src/layers/types";

function layer(id: string, maskData: Uint8Array | null): LayerState {
  return { id, effectId: "grain", params: { intensity: 0.5 }, enabled: true, maskData };
}

describe("toDisplayLayers", () => {
  it("retire le buffer maskData (le remplace par null)", () => {
    const mask = new Uint8Array([1, 2, 3]);
    const [d] = toDisplayLayers([layer("layer-1", mask)]);
    expect(d.maskData).toBeNull();
  });

  it("préserve tous les autres champs", () => {
    const [d] = toDisplayLayers([layer("layer-1", new Uint8Array([9]))]);
    expect(d.id).toBe("layer-1");
    expect(d.effectId).toBe("grain");
    expect(d.params).toEqual({ intensity: 0.5 });
    expect(d.enabled).toBe(true);
  });

  it("ne mute PAS le calque d'origine (maskData intact sur la source)", () => {
    const mask = new Uint8Array([1, 2, 3]);
    const original = layer("layer-1", mask);
    toDisplayLayers([original]);
    expect(original.maskData).toBe(mask);
  });

  it("renvoie un calque SANS masque par identité (pas de nouvelle allocation)", () => {
    const original = layer("layer-1", null);
    const [d] = toDisplayLayers([original]);
    expect(d).toBe(original);
  });

  it("renvoie un NOUVEL objet pour un calque masqué (copie, pas la source)", () => {
    const original = layer("layer-1", new Uint8Array([1]));
    const [d] = toDisplayLayers([original]);
    expect(d).not.toBe(original);
  });

  it("préserve l'ordre et le nombre de calques", () => {
    const out = toDisplayLayers([
      layer("a", new Uint8Array([1])),
      layer("b", null),
      layer("c", new Uint8Array([2])),
    ]);
    expect(out.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(out.map((l) => l.maskData)).toEqual([null, null, null]);
  });
});

import { describe, expect, it } from "vitest";
import type { LayerState } from "../../src/layers/types";
import {
  createBrushSource,
  createParametricSource,
  defaultLayerMask,
} from "../../src/mask/types";
import { toPileRows } from "../../src/components/pileModel";

function effect(id: string): LayerState {
  return {
    id,
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
  };
}

function photo(id: string): LayerState {
  return {
    ...effect(id),
    effectId: "passthrough",
    imageSource: { sourceId: `src-${id}` },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

describe("toPileRows", () => {
  it("préserve exactement ordre et rattachement de layerTree", () => {
    const rows = toPileRows([photo("P"), effect("A"), photo("Q"), effect("B")], null);
    expect(rows.map((row) => [row.layer.id, row.depth, row.parentId])).toEqual([
      ["P", 0, null],
      ["A", 1, "P"],
      ["Q", 0, null],
      ["B", 1, "Q"],
    ]);
  });

  it("la cible principale suit la nature de chaque ligne", () => {
    const rows = toPileRows([photo("P"), effect("E")], null);
    expect(rows.map((row) => row.primaryTarget)).toEqual([
      { kind: "photo", layerId: "P" },
      { kind: "effect", layerId: "E" },
    ]);
  });

  it("distingue la sélection principale de la vignette de masque", () => {
    const layers = [photo("P"), effect("E")];
    expect(toPileRows(layers, { kind: "effect", layerId: "E" }).map((row) => row.selectedFacet)).toEqual([null, "primary"]);
    expect(toPileRows(layers, { kind: "mask", layerId: "E" }).map((row) => row.selectedFacet)).toEqual([null, "mask"]);
  });

  it("résume les sources sans lire le contenu du raster", () => {
    const layer = effect("E");
    const disabled = createParametricSource("lum", "luminosity", { min: 0.2 });
    disabled.enabled = false;
    layer.mask = {
      ...layer.mask,
      sources: [createBrushSource("brush", new Uint8Array([0, 255])), disabled],
      enabled: false,
      invert: true,
    };
    expect(toPileRows([layer], null)[0].mask).toEqual({
      present: true,
      sourceCount: 2,
      enabledSourceCount: 1,
      enabled: false,
      invert: true,
    });
  });

  it("un masque sans source est absent, y compris sur une photo", () => {
    expect(toPileRows([photo("P")], null)[0].mask).toMatchObject({
      present: false,
      sourceCount: 0,
      enabledSourceCount: 0,
    });
  });
});


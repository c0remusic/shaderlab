import { describe, expect, it } from "vitest";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask } from "../../src/mask/types";
import {
  layerTarget,
  reconcilePropertiesTarget,
  targetForLayerId,
  targetKeepsMaskSession,
  targetMask,
} from "../../src/ui/propertiesTarget";

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
    imageSource: { sourceId: `source-${id}` },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

describe("propertiesTarget — cible principale d'une ligne", () => {
  it("distingue une photo d'un effet depuis le modèle, sans liste d'ids", () => {
    expect(layerTarget(photo("P"))).toEqual({ kind: "photo", layerId: "P" });
    expect(layerTarget(effect("E"))).toEqual({ kind: "effect", layerId: "E" });
  });

  it("un id absent ou null ne laisse aucun inspecteur périmé", () => {
    const layers = [photo("P")];
    expect(targetForLayerId(layers, null)).toBeNull();
    expect(targetForLayerId(layers, "absent")).toBeNull();
  });
});

describe("propertiesTarget — le masque est une facette du calque", () => {
  it("cible le masque d'un effet", () => {
    expect(targetMask([effect("E")], "E")).toEqual({ kind: "mask", layerId: "E" });
  });

  it("cible aussi le masque d'une photo de double exposition", () => {
    expect(targetMask([photo("P")], "P")).toEqual({ kind: "mask", layerId: "P" });
  });

  it("refuse une vignette dont le calque n'existe plus", () => {
    expect(targetMask([], "supprime")).toBeNull();
  });
});

describe("propertiesTarget — réconciliation structurelle", () => {
  it("supprime la cible avec son calque", () => {
    expect(reconcilePropertiesTarget({ kind: "effect", layerId: "E" }, [])).toBeNull();
  });

  it("la facette principale suit un changement de nature", () => {
    expect(
      reconcilePropertiesTarget({ kind: "effect", layerId: "X" }, [photo("X")]),
    ).toEqual({ kind: "photo", layerId: "X" });
    expect(
      reconcilePropertiesTarget({ kind: "photo", layerId: "X" }, [effect("X")]),
    ).toEqual({ kind: "effect", layerId: "X" });
  });

  it("le masque reste la cible tant que son calque existe", () => {
    const target = { kind: "mask", layerId: "E" } as const;
    expect(reconcilePropertiesTarget(target, [effect("E")])).toEqual(target);
  });
});

describe("propertiesTarget — session peinture", () => {
  it("ne survit que sur le masque du même calque", () => {
    expect(targetKeepsMaskSession({ kind: "mask", layerId: "E" }, "E")).toBe(true);
    expect(targetKeepsMaskSession({ kind: "effect", layerId: "E" }, "E")).toBe(false);
    expect(targetKeepsMaskSession({ kind: "mask", layerId: "F" }, "E")).toBe(false);
    expect(targetKeepsMaskSession(null, "E")).toBe(false);
  });
});


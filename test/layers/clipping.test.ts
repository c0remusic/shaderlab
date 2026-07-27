import { describe, it, expect } from "vitest";
import { clipBaseId, resolveClipping } from "../../src/layers/clipping";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask } from "../../src/mask/types";

function effectLayer(id: string, overrides: Partial<LayerState> = {}): LayerState {
  return {
    id,
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

function photoLayer(id: string, overrides: Partial<LayerState> = {}): LayerState {
  return effectLayer(id, {
    effectId: "passthrough",
    imageSource: { sourceId: `src-${id}` },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    ...overrides,
  });
}

const allRendered = (layers: LayerState[]) => new Set(layers.map((l) => l.id));

describe("clipBaseId (attachement structurel)", () => {
  it("rend null pour un calque non écrêté", () => {
    const layers = [photoLayer("P"), effectLayer("E")];
    expect(clipBaseId(layers, "E")).toBeNull();
  });

  it("rend la photo juste en dessous", () => {
    const layers = [photoLayer("P"), effectLayer("E", { clipToBelow: true })];
    expect(clipBaseId(layers, "E")).toBe("P");
  });

  it("traverse les écrêtés consécutifs jusqu'à la photo (chaîne)", () => {
    const layers = [
      photoLayer("P"),
      effectLayer("E1", { clipToBelow: true }),
      effectLayer("E2", { clipToBelow: true }),
    ];
    expect(clipBaseId(layers, "E2")).toBe("P");
    expect(clipBaseId(layers, "E1")).toBe("P");
  });

  it("s'arrête au premier calque NON écrêté (base non-photo)", () => {
    const layers = [photoLayer("P"), effectLayer("X"), effectLayer("E", { clipToBelow: true })];
    expect(clipBaseId(layers, "E")).toBe("X");
  });

  it("rend null en bas de pile", () => {
    const layers = [effectLayer("E", { clipToBelow: true })];
    expect(clipBaseId(layers, "E")).toBeNull();
  });

  it("s'arrête à un calque photo MÊME s'il porte clipToBelow (photo terminale)", () => {
    // Cas rendu inatteignable par `LayerStack.setLayerClip`, mais la descente
    // ne s'appuie pas sur cette garde : elle est terminale par elle-même.
    const layers = [
      photoLayer("P0"),
      photoLayer("P1", { clipToBelow: true }),
      effectLayer("E", { clipToBelow: true }),
    ];
    expect(clipBaseId(layers, "E")).toBe("P1");
  });

  it("ne regarde JAMAIS `enabled` (invariance par projection)", () => {
    const layers = [photoLayer("P", { enabled: false }), effectLayer("E", { clipToBelow: true })];
    expect(clipBaseId(layers, "E")).toBe("P");
  });

  it("un calque masqué INTERCALÉ ne réattache pas ce qui est au-dessus", () => {
    const layers = [
      photoLayer("P"),
      effectLayer("X", { enabled: false }),
      effectLayer("E", { clipToBelow: true }),
    ];
    expect(clipBaseId(layers, "E")).toBe("X");
  });

  it("rend null pour un id absent", () => {
    expect(clipBaseId([photoLayer("P")], "absent")).toBeNull();
  });

  it("suit le réordonnancement : le même calque change de base", () => {
    const clipped = effectLayer("E", { clipToBelow: true });
    expect(clipBaseId([photoLayer("P"), clipped], "E")).toBe("P");
    expect(clipBaseId([clipped, photoLayer("P")], "E")).toBeNull();
  });
});

describe("resolveClipping (effectivité)", () => {
  it("none pour un calque non écrêté", () => {
    const layers = [photoLayer("P"), effectLayer("E")];
    expect(resolveClipping(layers, allRendered(layers)).get("E")).toEqual({ kind: "none" });
  });

  it("active quand la base photo est rendue", () => {
    const layers = [photoLayer("P"), effectLayer("E", { clipToBelow: true })];
    expect(resolveClipping(layers, allRendered(layers)).get("E")).toEqual({
      kind: "active",
      baseLayerId: "P",
    });
  });

  it("active pour toute une chaîne d'écrêtés sur la même photo", () => {
    const layers = [
      photoLayer("P"),
      effectLayer("E1", { clipToBelow: true }),
      effectLayer("E2", { clipToBelow: true }),
    ];
    const resolved = resolveClipping(layers, allRendered(layers));
    expect(resolved.get("E1")).toEqual({ kind: "active", baseLayerId: "P" });
    expect(resolved.get("E2")).toEqual({ kind: "active", baseLayerId: "P" });
  });

  it("inert quand la base attachée n'est pas une photo", () => {
    const layers = [photoLayer("P"), effectLayer("X"), effectLayer("E", { clipToBelow: true })];
    expect(resolveClipping(layers, allRendered(layers)).get("E")).toEqual({ kind: "inert" });
  });

  it("inert en bas de pile (aucune base)", () => {
    const layers = [effectLayer("E", { clipToBelow: true })];
    expect(resolveClipping(layers, allRendered(layers)).get("E")).toEqual({ kind: "inert" });
  });

  it("suppressed quand la base photo n'est pas rendue", () => {
    const layers = [photoLayer("P"), effectLayer("E", { clipToBelow: true })];
    expect(resolveClipping(layers, new Set(["E"])).get("E")).toEqual({
      kind: "suppressed",
      baseLayerId: "P",
    });
  });

  it("suppressed se propage à toute la chaîne écrêtée sur la base masquée", () => {
    const layers = [
      photoLayer("P"),
      effectLayer("E1", { clipToBelow: true }),
      effectLayer("E2", { clipToBelow: true }),
    ];
    const resolved = resolveClipping(layers, new Set(["E1", "E2"]));
    expect(resolved.get("E1")).toEqual({ kind: "suppressed", baseLayerId: "P" });
    expect(resolved.get("E2")).toEqual({ kind: "suppressed", baseLayerId: "P" });
  });

  it("rend une entrée pour chaque calque de la pile", () => {
    const layers = [photoLayer("P"), effectLayer("E", { clipToBelow: true })];
    const resolved = resolveClipping(layers, allRendered(layers));
    expect([...resolved.keys()].sort()).toEqual(["E", "P"]);
  });
});

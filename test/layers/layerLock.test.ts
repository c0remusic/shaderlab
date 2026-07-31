import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";

/**
 * VERROU DE CALQUE — arbitrage n°2 du design
 * `docs/superpowers/specs/2026-07-28-shaderlab-fond-comme-calque-design.md` §7,
 * tranché par Antoine le 2026-07-28 : « 1 mais il faut l'option cadenas
 * visible ». Le verrou est une propriété de calque ORDINAIRE, posable sur
 * n'importe quel calque — pas un statut d'arrière-plan.
 *
 * Ce fichier teste UNE opération refusée par test : la liste des opérations
 * bloquées est le contrat, et un contrat vérifié en bloc ne dit pas laquelle
 * a cédé quand il tombe. La liste et ses justifications vivent sur
 * `LayerStack.isLocked` (src/layers/layerStack.ts).
 */

function lockedStack(): { stack: LayerStack; id: string } {
  const stack = new LayerStack();
  const id = stack.addLayer("glow");
  expect(stack.setLayerLocked(id, true)).toBe(true);
  return { stack, id };
}

function lockedPhotoStack(): { stack: LayerStack; id: string } {
  const stack = new LayerStack();
  const id = stack.addPhotoLayer("source-1", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, "plage.jpg");
  expect(stack.setLayerLocked(id, true)).toBe(true);
  return { stack, id };
}

describe("setLayerLocked", () => {
  it("pose et retire le verrou, et rend false sur un no-op", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.layers[0].locked).toBeUndefined(); // défaut : non verrouillé
    expect(stack.setLayerLocked(id, true)).toBe(true);
    expect(stack.layers[0].locked).toBe(true);
    expect(stack.setLayerLocked(id, true)).toBe(false); // déjà verrouillé
    expect(stack.setLayerLocked(id, false)).toBe(true);
    expect(stack.layers[0].locked).toBe(false);
  });

  it("rend false sur un id absent (pas d'entrée d'historique vide)", () => {
    const stack = new LayerStack();
    expect(stack.setLayerLocked("fantome", true)).toBe(false);
  });

  // Le seul mutateur qui ne consulte PAS le verrou : sinon il serait
  // irréversible et le cadenas deviendrait un piège.
  it("DÉVERROUILLER reste possible sur un calque verrouillé", () => {
    const { stack, id } = lockedStack();
    expect(stack.setLayerLocked(id, false)).toBe(true);
    expect(stack.layers[0].locked).toBe(false);
  });

  it("survit à clone() — le verrou fait partie de l'état d'historique", () => {
    const { stack } = lockedStack();
    expect(stack.clone().layers[0].locked).toBe(true);
  });
});

describe("opérations REFUSÉES sur un calque verrouillé", () => {
  it("setLayerEffect", () => {
    const { stack, id } = lockedStack();
    expect(stack.setLayerEffect(id, "grain")).toBe(false);
    expect(stack.layers[0].effectId).toBe("glow");
  });

  it("setLayerClip", () => {
    const { stack, id } = lockedStack();
    expect(stack.setLayerClip(id, true)).toBe(false);
    expect(stack.layers[0].clipToBelow).toBeUndefined();
  });

  it("updateLayerTransform", () => {
    const { stack, id } = lockedPhotoStack();
    expect(stack.updateLayerTransform(id, { x: 50, y: 50, scaleX: 2, scaleY: 2, rotation: 1 })).toBe(false);
    expect(stack.layers[0].transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it("removeLayer", () => {
    const { stack, id } = lockedStack();
    expect(stack.removeLayer(id)).toBe(false);
    expect(stack.layers).toHaveLength(1);
  });

  it("reorderLayer", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    stack.addLayer("grain");
    expect(stack.setLayerLocked(a, true)).toBe(true);
    expect(stack.reorderLayer(a, 1)).toBe(false);
    expect(stack.layers.map((l) => l.id)).toEqual([a, stack.layers[1].id]);
    expect(stack.layers[0].id).toBe(a);
  });

  it("updateParams", () => {
    const { stack, id } = lockedStack();
    expect(stack.updateParams(id, { intensity: 0.9 })).toBe(false);
    expect(stack.layers[0].params).toEqual({});
  });

  it("updateBrushMask", () => {
    const { stack, id } = lockedStack();
    expect(stack.updateBrushMask(id, new Uint8Array([255, 255]))).toBe(false);
    expect(stack.layers[0].mask.sources).toHaveLength(0);
  });

  // `addMaskSource` refuse en LEVANT, pas en no-op : elle rend un id et n'a
  // aucun canal d'échec (elle lève déjà sur un calque introuvable). L'UI ne
  // peut pas l'atteindre — `MaskPanel` désactive « Ajouter une source » sur un
  // calque verrouillé.
  it("addMaskSource (par levée, pas par no-op)", () => {
    const { stack, id } = lockedStack();
    expect(() => stack.addMaskSource(id, "gradient")).toThrow(/verrouill/i);
    expect(stack.layers[0].mask.sources).toHaveLength(0);
  });

  it("removeMaskSource", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const sourceId = stack.addMaskSource(id, "gradient");
    expect(stack.setLayerLocked(id, true)).toBe(true);
    expect(stack.removeMaskSource(id, sourceId)).toBe(false);
    expect(stack.layers[0].mask.sources).toHaveLength(1);
  });

  it("updateMaskSourceParams", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const sourceId = stack.addMaskSource(id, "gradient");
    const before = stack.layers[0].mask.sources[0];
    expect(before.type).not.toBe("brush");
    const params = before.type === "brush" ? {} : { ...before.params, angle: 123 };
    expect(stack.setLayerLocked(id, true)).toBe(true);
    expect(stack.updateMaskSourceParams(id, sourceId, params)).toBe(false);
  });

  it("setMaskSourceCombineMode", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const sourceId = stack.addMaskSource(id, "gradient");
    expect(stack.setLayerLocked(id, true)).toBe(true);
    expect(stack.setMaskSourceCombineMode(id, sourceId, "subtract")).toBe(false);
    expect(stack.layers[0].mask.sources[0].combineMode).toBe("add");
  });

  it("setMaskSourceEnabled", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const sourceId = stack.addMaskSource(id, "gradient");
    expect(stack.setLayerLocked(id, true)).toBe(true);
    expect(stack.setMaskSourceEnabled(id, sourceId, false)).toBe(false);
    expect(stack.layers[0].mask.sources[0].enabled).toBe(true);
  });

  it("updateRefineEdge", () => {
    const { stack, id } = lockedStack();
    const before = { ...stack.layers[0].mask.refineEdge };
    expect(stack.updateRefineEdge(id, { feather: 0.75 })).toBe(false);
    expect(stack.layers[0].mask.refineEdge).toEqual(before);
  });

  it("setMaskInvert", () => {
    const { stack, id } = lockedStack();
    expect(stack.setMaskInvert(id, true)).toBe(false);
    expect(stack.layers[0].mask.invert).toBe(false);
  });

  it("setMaskEnabled", () => {
    const { stack, id } = lockedStack();
    const before = stack.layers[0].mask.enabled;
    expect(stack.setMaskEnabled(id, !before)).toBe(false);
    expect(stack.layers[0].mask.enabled).toBe(before);
  });
});

describe("opérations AUTORISÉES sur un calque verrouillé", () => {
  // Masquer n'est pas modifier : c'est un confort de lecture de la pile,
  // réversible et sans effet sur le travail du calque. Verrouiller la
  // visibilité rendrait le verrou hostile.
  it("toggleLayer (visibilité) reste possible", () => {
    const { stack, id } = lockedStack();
    expect(stack.toggleLayer(id)).toBe(true);
    expect(stack.layers[0].enabled).toBe(false);
  });

  // `duplicateLayer` LIT la source, il ne la mute pas. La copie HÉRITE du
  // verrou : un garde-fou ne doit pas disparaître silencieusement à la
  // duplication, et le retirer sur la copie reste à un clic.
  it("duplicateLayer reste possible, et la copie hérite du verrou", () => {
    const { stack, id } = lockedStack();
    const copyId = stack.duplicateLayer(id);
    expect(copyId).not.toBeNull();
    expect(stack.layers).toHaveLength(2);
    expect(stack.layers[1].locked).toBe(true);
  });

  // Un ajout insère À CÔTÉ, il ne touche pas le calque verrouillé.
  it("addLayer à côté d'un calque verrouillé reste possible", () => {
    const { stack, id } = lockedStack();
    const added = stack.addLayer("grain", id);
    expect(stack.layers.map((l) => l.id)).toEqual([id, added]);
  });

  // LIMITE ASSUMÉE, testée pour qu'elle ne soit pas prise pour un défaut :
  // le verrou empêche de déplacer LE calque verrouillé, pas de déplacer un
  // AUTRE calque au travers de lui — ce second geste est une mutation de
  // l'autre calque, dont l'index du verrouillé n'est qu'une conséquence.
  it("un AUTRE calque peut être réordonné au travers du calque verrouillé", () => {
    const stack = new LayerStack();
    const a = stack.addLayer("glow");
    const b = stack.addLayer("grain");
    expect(stack.setLayerLocked(a, true)).toBe(true);
    expect(stack.reorderLayer(b, 0)).toBe(true);
    expect(stack.layers.map((l) => l.id)).toEqual([b, a]);
  });
});

describe("un calque NON verrouillé n'est pas affecté", () => {
  it("les mêmes opérations passent sur son voisin libre", () => {
    const stack = new LayerStack();
    const locked = stack.addLayer("glow");
    const free = stack.addLayer("grain");
    expect(stack.setLayerLocked(locked, true)).toBe(true);
    expect(stack.setLayerEffect(free, "warp")).toBe(true);
    expect(stack.updateParams(free, { intensity: 0.5 })).toBe(true);
    expect(stack.setMaskInvert(free, true)).toBe(true);
    expect(stack.removeLayer(free)).toBe(true);
    expect(stack.layers.map((l) => l.id)).toEqual([locked]);
  });
});

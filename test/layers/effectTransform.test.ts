import { describe, expect, it } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { History } from "../../src/layers/history";
import { DocumentSession } from "../../src/application/documentSession";

/**
 * L'ÉTIREMENT DU RENDU D'UN CALQUE D'EFFET PLACÉ (ticket 24, voie B).
 *
 * `effectTransform` est un champ scalaire de `LayerState`, distinct de
 * `transform` (photo). Ces cas gardent : le mutateur et son no-op, le verrou de
 * POSITION qui le gèle (sur les DEUX chemins — mutateur ET `replaceLiveLayers`,
 * la porte que les gardes ne couvraient pas), et la survie au snapshot/undo.
 */

function pileAvecEffet() {
  const stack = new LayerStack();
  const id = stack.addLayer("lightLeak");
  return { stack, id };
}

describe("LayerStack.setEffectTransform", () => {
  it("pose l'étirement et rend true", () => {
    const { stack, id } = pileAvecEffet();
    expect(stack.setEffectTransform(id, { scaleX: 1, scaleY: 0.4 })).toBe(true);
    expect(stack.layers.find((l) => l.id === id)!.effectTransform).toEqual({ scaleX: 1, scaleY: 0.4 });
  });

  it("no-op (false) sur une valeur identique — pas d'entrée d'historique vide", () => {
    const { stack, id } = pileAvecEffet();
    stack.setEffectTransform(id, { scaleX: 2, scaleY: 0.5 });
    expect(stack.setEffectTransform(id, { scaleX: 2, scaleY: 0.5 })).toBe(false);
  });

  it("false sur un id inconnu", () => {
    const { stack } = pileAvecEffet();
    expect(stack.setEffectTransform("inexistant", { scaleX: 2, scaleY: 1 })).toBe(false);
  });

  it("objet FRAIS : muter l'argument après coup ne touche pas le calque", () => {
    const { stack, id } = pileAvecEffet();
    const arg = { scaleX: 2, scaleY: 0.5 };
    stack.setEffectTransform(id, arg);
    arg.scaleX = 9;
    expect(stack.layers.find((l) => l.id === id)!.effectTransform).toEqual({ scaleX: 2, scaleY: 0.5 });
  });

  it("REFUSE quand la position est verrouillée (partiel)", () => {
    const { stack, id } = pileAvecEffet();
    stack.setLayerLock(id, "position", true);
    expect(stack.setEffectTransform(id, { scaleX: 2, scaleY: 0.5 })).toBe(false);
    expect(stack.layers.find((l) => l.id === id)!.effectTransform).toBeUndefined();
  });

  it("REFUSE quand tout est verrouillé (all implique position)", () => {
    const { stack, id } = pileAvecEffet();
    stack.setLayerLock(id, "all", true);
    expect(stack.setEffectTransform(id, { scaleX: 2, scaleY: 0.5 })).toBe(false);
  });

  it("le verrou MASQUE ne gèle PAS l'étirement (c'est un verrou de position)", () => {
    const { stack, id } = pileAvecEffet();
    stack.setLayerLock(id, "mask", true);
    expect(stack.setEffectTransform(id, { scaleX: 2, scaleY: 0.5 })).toBe(true);
  });

  it("duplicateLayer copie l'étirement, en objet FRAIS", () => {
    const { stack, id } = pileAvecEffet();
    stack.setEffectTransform(id, { scaleX: 2, scaleY: 0.5 });
    const copie = stack.duplicateLayer(id)!;
    const original = stack.layers.find((l) => l.id === id)!;
    const dup = stack.layers.find((l) => l.id === copie)!;
    expect(dup.effectTransform).toEqual({ scaleX: 2, scaleY: 0.5 });
    expect(dup.effectTransform).not.toBe(original.effectTransform);
  });
});

describe("effectTransform — survie au snapshot et à l'undo", () => {
  it("clone() porte le champ (scalaire, aucun traitement spécial requis)", () => {
    const { stack, id } = pileAvecEffet();
    stack.setEffectTransform(id, { scaleX: 3, scaleY: 0.2 });
    const copie = stack.clone();
    expect(copie.layers.find((l) => l.id === id)!.effectTransform).toEqual({ scaleX: 3, scaleY: 0.2 });
  });

  it("un undo restaure l'étirement d'avant", () => {
    const { stack, id } = pileAvecEffet();
    const history = new History(stack.clone());
    stack.setEffectTransform(id, { scaleX: 2, scaleY: 0.4 });
    history.push(stack.clone());
    const precedent = history.undo()!;
    expect(precedent.layers.find((l) => l.id === id)!.effectTransform).toBeUndefined();
    const suivant = history.redo()!;
    expect(suivant.layers.find((l) => l.id === id)!.effectTransform).toEqual({ scaleX: 2, scaleY: 0.4 });
  });
});

describe("effectTransform — la porte vivante replaceLiveLayers", () => {
  it("un calque à position verrouillée RETIENT son étirement poussé en direct", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("lightLeak");
    stack.setEffectTransform(id, { scaleX: 1, scaleY: 1 });
    stack.setLayerLock(id, "position", true);
    const session = new DocumentSession(stack);
    session.replaceLiveLayers(
      session.layers().map((l) => (l.id === id ? { ...l, effectTransform: { scaleX: 3, scaleY: 0.2 } } : l)),
    );
    expect(session.layers().find((l) => l.id === id)!.effectTransform).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it("un calque NON verrouillé laisse passer son étirement", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("lightLeak");
    const session = new DocumentSession(stack);
    session.replaceLiveLayers(
      session.layers().map((l) => (l.id === id ? { ...l, effectTransform: { scaleX: 2, scaleY: 0.5 } } : l)),
    );
    expect(session.layers().find((l) => l.id === id)!.effectTransform).toEqual({ scaleX: 2, scaleY: 0.5 });
  });
});

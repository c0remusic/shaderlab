import { describe, it, expect } from "vitest";
import { computeInsertIndex } from "../../src/ui/dragReorder";

// computeInsertIndex traduit "poser AVANT/APRÈS la ligne hoverIndex" (ce que
// l'utilisateur choisit visuellement) vers le newIndex attendu par
// LayerStack.reorderLayer, qui insère DANS LE TABLEAU DÉJÀ AMPUTÉ du calque
// déplacé — pas le même référentiel qu'un index dans le tableau d'origine.
// Logique pure, aucun DOM/GPU : testable directement (contrairement au reste
// du pipeline pointer-events de LayerPanel, qui reste vérifié par checkpoint
// visuel humain, voir CLAUDE.md).
describe("computeInsertIndex", () => {
  it("moving item 0 after item 2 in [A,B,C,D] places it right after C", () => {
    // [A,B,C,D], from=0, hover=2, after -> [B,C,A,D]
    expect(computeInsertIndex(0, 2, "after")).toBe(2);
  });

  it("moving item 3 before item 1 in [A,B,C,D] places it right before B", () => {
    // [A,B,C,D], from=3, hover=1, before -> [A,D,B,C]
    expect(computeInsertIndex(3, 1, "before")).toBe(1);
  });

  it("moving item 3 after item 1 in [A,B,C,D] places it right after B", () => {
    // [A,B,C,D], from=3, hover=1, after -> [A,B,D,C]
    expect(computeInsertIndex(3, 1, "after")).toBe(2);
  });

  it("dropping an item immediately before its next neighbor is a no-op", () => {
    // [A,B,...], from=0, hover=1, before -> newIndex === fromIndex (0)
    expect(computeInsertIndex(0, 1, "before")).toBe(0);
  });

  it("dropping an item immediately after its previous neighbor is a no-op", () => {
    // [A,B,...], from=1, hover=0, after -> newIndex === fromIndex (1)
    expect(computeInsertIndex(1, 0, "after")).toBe(1);
  });

  it("dropping an item before itself (hoverIndex === fromIndex) is a no-op", () => {
    expect(computeInsertIndex(2, 2, "before")).toBe(2);
  });

  it("hoverIndex === fromIndex with position 'after' is a degenerate case never reached in practice", () => {
    // Contrairement au cas "before" (no-op réel, testé ci-dessus), "after
    // soi-même" retourne fromIndex+1 — PAS un no-op si on l'appliquait tel
    // quel (ça décalerait l'élément après son voisin suivant). Mais
    // LayerPanel ne calcule JAMAIS dropPosition pour la ligne en cours de
    // drag (voir LayerRow : dropPosition exclut draggedId === layer.id) —
    // ce cas n'est donc jamais exercé par un vrai geste utilisateur.
    // Documenté ici pour ne pas surprendre un futur lecteur de la fonction
    // isolément de son appelant.
    expect(computeInsertIndex(2, 2, "after")).toBe(3);
  });
});

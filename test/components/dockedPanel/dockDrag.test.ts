import { describe, it, expect } from "vitest";
import { hasExceededDragThreshold, DRAG_THRESHOLD_PX } from "../../../src/components/dockedPanel/dockDrag";

describe("hasExceededDragThreshold", () => {
  it("pointeur immobile -> pas de drag", () => {
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  it("micro-tremblement sous le seuil -> pas de drag", () => {
    // 3px en X, 2px en Y => hypoténuse ~3.6px, sous les 4px du seuil.
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false);
  });

  it("déplacement horizontal franc -> drag", () => {
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(true);
  });

  it("déplacement vertical franc -> drag", () => {
    expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 10, y: 4 })).toBe(true);
  });

  it("distance EXACTEMENT au seuil -> drag (comparaison >=)", () => {
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: DRAG_THRESHOLD_PX, y: 0 })).toBe(true);
  });

  it("micro-tremblement diagonal sous le seuil -> pas de drag", () => {
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  it("juste sous le seuil -> pas de drag", () => {
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: DRAG_THRESHOLD_PX - 0.01, y: 0 })).toBe(false);
  });

  it("mesure une DISTANCE, pas un axe : la diagonale franchit le seuil que ni X ni Y ne franchit seul", () => {
    // 3px sur chaque axe : aucun axe n'atteint 4, mais la distance vaut ~4.24.
    // Une implémentation en Math.abs(dx) >= t || Math.abs(dy) >= t rendrait false ici.
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  });

  it("le sens du déplacement est indifférent (valeurs négatives)", () => {
    expect(hasExceededDragThreshold({ x: 100, y: 100 }, { x: 94, y: 100 })).toBe(true);
    expect(hasExceededDragThreshold({ x: 100, y: 100 }, { x: 98, y: 100 })).toBe(false);
  });

  it("seuil surchargeable par l'appelant", () => {
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: 5, y: 0 }, 20)).toBe(false);
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: 25, y: 0 }, 20)).toBe(true);
  });

  it("le seuil par défaut est celui du module", () => {
    const origin = { x: 0, y: 0 };
    const juste = { x: DRAG_THRESHOLD_PX, y: 0 };
    expect(hasExceededDragThreshold(origin, juste)).toBe(
      hasExceededDragThreshold(origin, juste, DRAG_THRESHOLD_PX),
    );
  });
});

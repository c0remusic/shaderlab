import { describe, it, expect } from "vitest";
import { computeListboxPlacement } from "../../src/ui/selectPlacement";
import type { TriggerRect } from "../../src/ui/selectPlacement";

const GAP = 4;
const MAX_HEIGHT = 240;

function trigger(top: number, bottom: number, left = 0, width = 200): TriggerRect {
  return { top, bottom, left, width };
}

describe("computeListboxPlacement", () => {
  it("assez de place en dessous -> ouvre vers le bas, hauteur pleine", () => {
    const result = computeListboxPlacement(trigger(100, 132), 800, GAP, MAX_HEIGHT);
    expect(result.top).toBe(132 + GAP);
    expect(result.bottom).toBeUndefined();
    expect(result.maxHeight).toBe(MAX_HEIGHT);
  });

  it("pas assez de place en dessous mais assez au-dessus -> retourne vers le haut", () => {
    // viewport 800, trigger proche du bas : spaceBelow=800-750=50 (<244), spaceAbove=700 (>50)
    const result = computeListboxPlacement(trigger(700, 750), 800, GAP, MAX_HEIGHT);
    expect(result.bottom).toBe(800 - 700 + GAP);
    expect(result.top).toBeUndefined();
    expect(result.maxHeight).toBe(MAX_HEIGHT);
  });

  it("ni haut ni bas n'ont 240px -> reste du côté le plus spacieux, hauteur bornée à l'espace réel (pas de débordement)", () => {
    // viewport 200, trigger au milieu : spaceAbove=90, spaceBelow=90 (égalité -> pas de flip, cf. needsFlip strict >)
    const result = computeListboxPlacement(trigger(90, 110), 200, GAP, MAX_HEIGHT);
    expect(result.top).toBe(110 + GAP);
    expect(result.maxHeight).toBe(90 - GAP); // borné à l'espace en dessous, jamais 240
    expect(result.maxHeight).toBeLessThan(MAX_HEIGHT);
  });

  it("espace strictement égal des deux côtés (sous le seuil) -> pas de flip (égalité stricte, > pas >=)", () => {
    // viewport 400, trigger(200,200) (hauteur 0) : spaceAbove=200, spaceBelow=200, égalité exacte.
    // Régression possible testée ici : si `>` devenait `>=`, ce cas basculerait à tort en flip.
    const result = computeListboxPlacement(trigger(200, 200), 400, GAP, MAX_HEIGHT);
    expect(result.top).toBe(200 + GAP);
    expect(result.bottom).toBeUndefined();
    expect(result.maxHeight).toBe(200 - GAP);
  });

  it("espace disponible négatif des deux côtés (trigger plus grand que le viewport) -> maxHeight jamais négatif", () => {
    // viewport 50, trigger(-50,200) couvre tout le viewport et déborde des deux côtés :
    // spaceAbove=-50, spaceBelow=50-200=-150 -> côté le "moins négatif" choisi (au-dessus),
    // mais availableSpace(-50-4=-54) reste négatif -> exerce réellement Math.max(0, ...).
    const result = computeListboxPlacement(trigger(-50, 200), 50, GAP, MAX_HEIGHT);
    expect(result.bottom).toBeDefined();
    expect(result.maxHeight).toBe(0);
  });

  it("conserve toujours left/width du trigger", () => {
    const result = computeListboxPlacement(trigger(10, 30, 55, 288), 800, GAP, MAX_HEIGHT);
    expect(result.left).toBe(55);
    expect(result.width).toBe(288);
  });
});

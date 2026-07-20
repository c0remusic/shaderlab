import { describe, it, expect } from "vitest";
import { computeInsertIndex, reorderById } from "../../src/ui/dragReorder";

describe("computeInsertIndex", () => {
  it("avant un index après soi -> décale d'un cran vers le bas", () => {
    expect(computeInsertIndex(0, 2, "before")).toBe(1);
  });
  it("après un index après soi -> décale de deux crans vers le bas", () => {
    expect(computeInsertIndex(0, 2, "after")).toBe(2);
  });
  it("avant son voisin immédiat suivant -> no-op (retourne fromIndex)", () => {
    expect(computeInsertIndex(0, 1, "before")).toBe(0);
  });
  it("après son voisin immédiat précédent -> no-op (retourne fromIndex)", () => {
    expect(computeInsertIndex(2, 1, "after")).toBe(2);
  });
  it("déplacement vers le haut, avant une ligne antérieure", () => {
    expect(computeInsertIndex(3, 1, "before")).toBe(1);
  });
});

describe("reorderById", () => {
  const items = ["a", "b", "c", "d"];
  const getId = (x: string) => x;

  it("déplace un élément vers une position ultérieure", () => {
    expect(reorderById(items, getId, "a", 2)).toEqual(["b", "c", "a", "d"]);
  });
  it("déplace un élément vers une position antérieure", () => {
    expect(reorderById(items, getId, "d", 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("id introuvable -> retourne le tableau inchangé (référence égale non garantie, mais mêmes éléments)", () => {
    expect(reorderById(items, getId, "z", 1)).toEqual(items);
  });
});

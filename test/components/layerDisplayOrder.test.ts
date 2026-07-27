import { describe, expect, it } from "vitest";
import { displayInsertToModelInsert, displayRowToModelIndex, toDisplayOrder } from "../../src/components/layerDisplayOrder";
import { computeInsertIndex, reorderById, type DropPosition } from "../../src/ui/dragReorder";

interface Item {
  id: string;
}

const model = (...ids: string[]): Item[] => ids.map((id) => ({ id }));
const ids = (items: Item[]): string[] => items.map((i) => i.id);

/**
 * Rejoue la CHAÎNE COMPLÈTE d'un dépôt, exactement comme le composant :
 * l'utilisateur voit la liste affichée, saisit `draggedId`, survole la ligne
 * affichée `hoverDisplayRow` et relâche dans sa moitié haute (`before`) ou
 * basse (`after`). Retourne la pile MODÈLE résultante.
 *
 * Reproduit AUSSI les deux gardes de `handlePointerUp` (`src/ui/dragReorder.ts`),
 * sans lesquelles ce banc testerait des états que le geste réel ne peut pas
 * produire : survoler SA PROPRE ligne n'est pas un dépôt, et un dépôt qui
 * retombe sur sa propre position ne réordonne pas.
 */
function drop(layers: Item[], draggedId: string, hoverDisplayRow: number, position: DropPosition): string[] {
  const display = toDisplayOrder(layers);
  const fromDisplay = display.findIndex((i) => i.id === draggedId);
  if (fromDisplay === hoverDisplayRow) return ids(layers);
  const displayInsert = computeInsertIndex(fromDisplay, hoverDisplayRow, position);
  if (displayInsert === fromDisplay) return ids(layers);
  const modelInsert = displayInsertToModelInsert(displayInsert, layers.length);
  return ids(reorderById(layers, (i) => i.id, draggedId, modelInsert));
}

describe("toDisplayOrder", () => {
  it("rend le bas de pile en DERNIÈRE ligne (convention Photoshop)", () => {
    expect(ids(toDisplayOrder(model("bas", "milieu", "haut")))).toEqual(["haut", "milieu", "bas"]);
  });

  it("ne mute jamais le tableau du modèle", () => {
    const layers = model("a", "b", "c");
    toDisplayOrder(layers);
    expect(ids(layers)).toEqual(["a", "b", "c"]);
  });

  it("supporte la pile vide et la pile à un calque", () => {
    expect(toDisplayOrder([])).toEqual([]);
    expect(ids(toDisplayOrder(model("seul")))).toEqual(["seul"]);
  });
});

describe("displayRowToModelIndex", () => {
  it("est le miroir exact de la pile", () => {
    expect(displayRowToModelIndex(0, 3)).toBe(2);
    expect(displayRowToModelIndex(1, 3)).toBe(1);
    expect(displayRowToModelIndex(2, 3)).toBe(0);
  });

  it("est une involution : l'appliquer deux fois redonne l'index de départ", () => {
    for (const n of [1, 2, 5, 8]) {
      for (let i = 0; i < n; i++) {
        expect(displayRowToModelIndex(displayRowToModelIndex(i, n), n)).toBe(i);
      }
    }
  });

  it("correspond à l'index réel dans le tableau affiché", () => {
    const layers = model("a", "b", "c", "d");
    const display = toDisplayOrder(layers);
    display.forEach((item, row) => {
      expect(layers[displayRowToModelIndex(row, layers.length)].id).toBe(item.id);
    });
  });
});

describe("displayInsertToModelInsert", () => {
  it("couvre tout le domaine d'insertion (0..length-1) dans les deux sens", () => {
    expect(displayInsertToModelInsert(0, 4)).toBe(3);
    expect(displayInsertToModelInsert(3, 4)).toBe(0);
  });

  it("est une involution sur son domaine", () => {
    for (const n of [2, 3, 6]) {
      for (let d = 0; d <= n - 1; d++) {
        expect(displayInsertToModelInsert(displayInsertToModelInsert(d, n), n)).toBe(d);
      }
    }
  });
});

/**
 * Le cœur du risque de l'inversion : ce que l'utilisateur VOIT après un dépôt.
 * Chaque cas est écrit en ordre AFFICHÉ (haut de liste → bas de liste), et
 * l'attendu est reconverti pour être comparé à la pile modèle.
 */
describe("chaîne de dépôt complète (affichage → modèle)", () => {
  // Modèle [A, B, C] ⇒ liste affichée [C, B, A].
  const layers = model("A", "B", "C");

  it("déposer A (bas de pile, dernière ligne) AVANT C (première ligne) l'envoie en haut de pile", () => {
    expect(drop(layers, "A", 0, "before")).toEqual(["B", "C", "A"]);
    expect(ids(toDisplayOrder(model("B", "C", "A")))).toEqual(["A", "C", "B"]);
  });

  it("déposer C (haut de pile, première ligne) APRÈS A (dernière ligne) l'envoie en bas de pile", () => {
    expect(drop(layers, "C", 2, "after")).toEqual(["C", "A", "B"]);
    expect(ids(toDisplayOrder(model("C", "A", "B")))).toEqual(["B", "A", "C"]);
  });

  it("déposer la première ligne AVANT elle-même ne change rien", () => {
    expect(drop(layers, "C", 0, "before")).toEqual(["A", "B", "C"]);
  });

  it("déposer B AVANT C le fait passer au-dessus de C", () => {
    // Liste [C, B, A] → [B, C, A] ; modèle [A, B, C] → [A, C, B].
    expect(drop(layers, "B", 0, "before")).toEqual(["A", "C", "B"]);
  });

  it("déposer B APRÈS A le fait passer sous A", () => {
    // Liste [C, B, A] → [C, A, B] ; modèle [A, B, C] → [B, A, C].
    expect(drop(layers, "B", 2, "after")).toEqual(["B", "A", "C"]);
  });

  it("un dépôt reste une PERMUTATION : aucun calque perdu ni dupliqué, sur toutes les cibles", () => {
    const five = model("A", "B", "C", "D", "E");
    for (const dragged of ["A", "B", "C", "D", "E"]) {
      for (let row = 0; row < five.length; row++) {
        for (const position of ["before", "after"] as DropPosition[]) {
          const result = drop(five, dragged, row, position);
          expect(result.slice().sort()).toEqual(["A", "B", "C", "D", "E"]);
        }
      }
    }
  });

  it("l'index de modèle produit reste toujours dans les bornes du tableau", () => {
    const five = model("A", "B", "C", "D", "E");
    const display = toDisplayOrder(five);
    for (let from = 0; from < display.length; from++) {
      for (let row = 0; row < display.length; row++) {
        // `handlePointerUp` écarte le survol de sa propre ligne AVANT
        // `computeInsertIndex` : sans cette garde, « après sa propre dernière
        // ligne » produirait un index d'insertion hors domaine (mesuré : -1).
        if (from === row) continue;
        for (const position of ["before", "after"] as DropPosition[]) {
          const modelInsert = displayInsertToModelInsert(computeInsertIndex(from, row, position), five.length);
          expect(modelInsert).toBeGreaterThanOrEqual(0);
          expect(modelInsert).toBeLessThanOrEqual(five.length - 1);
        }
      }
    }
  });
});

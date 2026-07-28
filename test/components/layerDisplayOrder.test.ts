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

/** Où se retrouve `id` dans la LISTE après un dépôt — c'est la seule chose que
 *  l'utilisateur juge. Reconverti depuis le modèle par la frontière testée. */
const rowOf = (modelIds: string[], id: string): number => toDisplayOrder(modelIds).indexOf(id);

describe("toDisplayOrder", () => {
  it("rend le premier calque appliqué en PREMIÈRE ligne (sens causal, ADR-0004)", () => {
    expect(ids(toDisplayOrder(model("premier", "puis", "enfin")))).toEqual(["premier", "puis", "enfin"]);
  });

  it("ne mute jamais le tableau du modèle et n'en partage pas l'identité", () => {
    const layers = model("a", "b", "c");
    const display = toDisplayOrder(layers);
    display.reverse();
    expect(ids(layers)).toEqual(["a", "b", "c"]);
  });

  it("supporte la pile vide et la pile à un calque", () => {
    expect(toDisplayOrder([])).toEqual([]);
    expect(ids(toDisplayOrder(model("seul")))).toEqual(["seul"]);
  });
});

describe("displayRowToModelIndex", () => {
  it("suit l'ordre direct du tableau", () => {
    expect(displayRowToModelIndex(0, 3)).toBe(0);
    expect(displayRowToModelIndex(1, 3)).toBe(1);
    expect(displayRowToModelIndex(2, 3)).toBe(2);
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
    expect(displayInsertToModelInsert(0, 4)).toBe(0);
    expect(displayInsertToModelInsert(3, 4)).toBe(3);
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
 * LES SIX DÉPLACEMENTS. Le cœur du risque de tout changement de sens : ce que
 * l'utilisateur VOIT après un dépôt. Un calque qui atterrit au mauvais endroit
 * est pire que pas de changement de sens du tout (ADR-0003, reconduit par
 * l'ADR-0004) — chaque cas vérifie donc DEUX choses : la pile modèle obtenue
 * (l'ordre d'exécution) ET la ligne où le calque atterrit (ce qui est jugé).
 *
 * Modèle [A, B, C, D] ⇒ liste affichée [A, B, C, D] : A ouvre la liste (appliqué
 * en premier), D la ferme.
 *
 * QUATRE calques, pas trois, et ce n'est pas un détail : sur une pile de trois,
 * l'insertion médiane est un POINT FIXE de l'ancienne formule miroir
 * (`length - 1 - d` vaut 1 pour d = 1). Les cas 3 et 5 passaient donc au vert
 * avec la conversion cassée — mesuré au témoin le 2026-07-28. À quatre, aucun
 * des six ne survit à l'inversion.
 */
describe("les six déplacements (affichage → modèle)", () => {
  const layers = model("A", "B", "C", "D");

  it("1. VERS LE HAUT — D (dernière ligne) déposé avant A (première ligne) ouvre la liste", () => {
    const after = drop(layers, "D", 0, "before");
    expect(after).toEqual(["D", "A", "B", "C"]);
    expect(rowOf(after, "D")).toBe(0);
  });

  it("2. VERS LE BAS — A (première ligne) déposé après D (dernière ligne) ferme la liste", () => {
    const after = drop(layers, "A", 3, "after");
    expect(after).toEqual(["B", "C", "D", "A"]);
    expect(rowOf(after, "A")).toBe(3);
  });

  it("3. DEPUIS LE SOMMET — A quitte la première ligne pour la deuxième", () => {
    const after = drop(layers, "A", 1, "after");
    expect(after).toEqual(["B", "A", "C", "D"]);
    expect(rowOf(after, "A")).toBe(1);
  });

  it("4. VERS LE SOMMET — B monte d'un cran et prend la première ligne", () => {
    const after = drop(layers, "B", 0, "before");
    expect(after).toEqual(["B", "A", "C", "D"]);
    expect(rowOf(after, "B")).toBe(0);
  });

  it("5. DEPUIS LE BAS — D quitte la dernière ligne pour l'avant-dernière", () => {
    const after = drop(layers, "D", 2, "before");
    expect(after).toEqual(["A", "B", "D", "C"]);
    expect(rowOf(after, "D")).toBe(2);
  });

  it("6. VERS LE BAS DE LA LISTE — C descend et prend la dernière ligne", () => {
    const after = drop(layers, "C", 3, "after");
    expect(after).toEqual(["A", "B", "D", "C"]);
    expect(rowOf(after, "C")).toBe(3);
  });

  it("déposer la première ligne AVANT elle-même ne change rien", () => {
    expect(drop(layers, "A", 0, "before")).toEqual(["A", "B", "C", "D"]);
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
        // ligne » produirait un index d'insertion hors domaine.
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

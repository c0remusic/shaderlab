import { describe, expect, it } from "vitest";
import { layerParentIds, toLayerTreeRows } from "../../src/components/layerTree";
import { displayInsertToModelInsert, toDisplayOrder } from "../../src/components/layerDisplayOrder";
import { computeInsertIndex, reorderById, type DropPosition } from "../../src/ui/dragReorder";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

function effect(id: string, overrides: Partial<LayerState> = {}): LayerState {
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

function photo(id: string, overrides: Partial<LayerState> = {}): LayerState {
  return effect(id, {
    effectId: "passthrough",
    imageSource: { sourceId: `src-${id}` },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    ...overrides,
  });
}

/** Résumé lisible d'une ligne : `id` préfixé de son indentation. */
const shape = (layers: LayerState[]): string[] =>
  toLayerTreeRows(layers).map((row) => `${"  ".repeat(row.depth)}${row.layer.id}`);

const parents = (layers: LayerState[]): Array<string | null> =>
  toLayerTreeRows(layers).map((row) => row.parentId);

/**
 * RATTACHEMENT SEUL, en espace MODÈLE. Ces cas sont écrits dans l'ordre du
 * tableau `layers` (indice 0 = appliqué en premier, donc bas de pile) et ne
 * font AUCUNE référence au sens d'affichage : ils resteraient vrais mot pour
 * mot si la liste était un jour rendue dans l'autre sens.
 */
describe("layerParentIds — espace modèle, indépendant du sens d'affichage", () => {
  it("rend un parent par calque, dans l'ordre du TABLEAU", () => {
    const layers = [photo("P"), effect("A"), photo("Q"), effect("B")];
    expect(layerParentIds(layers)).toEqual([null, "P", null, null]);
  });

  it("« en dessous » veut dire indice INFÉRIEUR dans le tableau, jamais une position à l'écran", () => {
    // A est à l'indice 0 : rien n'est appliqué avant lui, donc aucune photo
    // « en dessous » — même s'il sera rendu en BAS de la liste (ADR-0003).
    const layers = [effect("A"), photo("P")];
    expect(layerParentIds(layers)).toEqual([null, null]);
  });

  it("un écrêté nomme sa base photo quel que soit le nombre de photos plus bas", () => {
    expect(layerParentIds([photo("P"), photo("Q"), effect("A", { clipToBelow: true })])).toEqual([null, null, "Q"]);
  });
});

describe("toLayerTreeRows — ordre d'affichage", () => {
  it("rend EXACTEMENT l'ordre de toDisplayOrder : l'imbrication est un affichage, pas un tri", () => {
    // Invariant porteur du glisser-déposer : `data-layer-row-index` reste
    // l'index dans `toDisplayOrder(layers)`, donc `displayInsertToModelInsert`
    // reste valide avec des lignes imbriquées.
    const layers = [photo("P"), effect("A", { clipToBelow: true }), effect("B"), photo("Q"), effect("C")];
    expect(toLayerTreeRows(layers).map((r) => r.layer.id)).toEqual(toDisplayOrder(layers).map((l) => l.id));
  });

  it("supporte la pile vide", () => {
    expect(toLayerTreeRows([])).toEqual([]);
  });

  it("ne mute jamais le tableau du modèle", () => {
    const layers = [photo("P"), effect("A")];
    toLayerTreeRows(layers);
    expect(layers.map((l) => l.id)).toEqual(["P", "A"]);
  });
});

describe("toLayerTreeRows — 0 photo", () => {
  it("laisse tous les effets à plat : il n'y a aucune photo sous laquelle imbriquer", () => {
    expect(shape([effect("A"), effect("B"), effect("C")])).toEqual(["C", "B", "A"]);
    expect(parents([effect("A"), effect("B"), effect("C")])).toEqual([null, null, null]);
  });

  it("un effet ÉCRÊTÉ sans aucune photo reste à plat (écrêtage inerte)", () => {
    // `resolveClipping` rend ce cas `inert` : le calque rend LINÉAIREMENT.
    // L'imbriquer désignerait une base qui n'existe pas.
    expect(shape([effect("A", { clipToBelow: true }), effect("B")])).toEqual(["B", "A"]);
  });
});

describe("toLayerTreeRows — une seule photo", () => {
  it("imbrique tous les effets au-dessus d'elle, écrêtés ou non", () => {
    const layers = [photo("P"), effect("A"), effect("B", { clipToBelow: true }), effect("C")];
    expect(shape(layers)).toEqual(["  C", "  B", "  A", "P"]);
    expect(parents(layers)).toEqual(["P", "P", "P", null]);
  });

  it("laisse à plat les effets situés SOUS l'unique photo (aucune photo en dessous d'eux)", () => {
    const layers = [effect("A"), photo("P"), effect("B")];
    expect(shape(layers)).toEqual(["  B", "P", "A"]);
    expect(parents(layers)).toEqual(["P", null, null]);
  });

  it("une photo est toujours une ligne racine, jamais imbriquée sous une autre", () => {
    const layers = [photo("P"), photo("Q")];
    expect(shape(layers)).toEqual(["Q", "P"]);
  });

  it("marque la première et la dernière ligne enfant (bornes du filet vertical)", () => {
    const rows = toLayerTreeRows([photo("P"), effect("A"), effect("B"), effect("C")]);
    // Affichage : C, B, A, P — C est la PREMIÈRE ligne enfant, A la dernière
    // (celle qui touche la photo parente, juste en dessous d'elle).
    expect(rows.map((r) => [r.layer.id, r.firstChild, r.lastChild])).toEqual([
      ["C", true, false],
      ["B", false, false],
      ["A", false, true],
      ["P", false, false],
    ]);
  });

  it("un enfant unique est à la fois premier et dernier", () => {
    const rows = toLayerTreeRows([photo("P"), effect("A")]);
    expect(rows[0]).toMatchObject({ firstChild: true, lastChild: true });
  });
});

describe("toLayerTreeRows — deux photos", () => {
  it("un effet NON écrêté au-dessus de DEUX photos reste à plat : il dépend du composite entier", () => {
    const layers = [photo("P"), photo("Q"), effect("A")];
    expect(shape(layers)).toEqual(["A", "Q", "P"]);
    expect(parents(layers)).toEqual([null, null, null]);
  });

  it("des effets de part et d'autre : celui du bas s'imbrique, celui du haut reste à plat", () => {
    const layers = [photo("P"), effect("A"), photo("Q"), effect("B")];
    expect(shape(layers)).toEqual(["B", "Q", "  A", "P"]);
    expect(parents(layers)).toEqual([null, null, "P", null]);
  });

  it("un effet ÉCRÊTÉ s'imbrique même quand DEUX photos sont sous lui", () => {
    // C'est la différence de fond entre les deux règles : l'écrêtage nomme sa
    // base, le non-écrêté ne fait que la déduire quand elle est unique.
    const layers = [photo("P"), photo("Q"), effect("A", { clipToBelow: true })];
    expect(shape(layers)).toEqual(["  A", "Q", "P"]);
    expect(parents(layers)).toEqual(["Q", null, null]);
  });

  it("effet écrêté sous la photo du HAUT alors qu'une autre photo existe plus bas", () => {
    // Pile : P (bas) · B (libre, 1 photo dessous → enfant de P) · Q · A (écrêté
    // → enfant de Q). Deux groupes distincts, aucun effet à plat.
    const layers = [photo("P"), effect("B"), photo("Q"), effect("A", { clipToBelow: true })];
    expect(shape(layers)).toEqual(["  A", "Q", "  B", "P"]);
    expect(parents(layers)).toEqual(["Q", null, "P", null]);
  });

  it("les bornes du filet sont calculées par GROUPE, pas globalement", () => {
    const layers = [photo("P"), effect("B"), photo("Q"), effect("A", { clipToBelow: true })];
    const rows = toLayerTreeRows(layers);
    expect(rows.map((r) => [r.layer.id, r.firstChild, r.lastChild])).toEqual([
      ["A", true, true],
      ["Q", false, false],
      ["B", true, true],
      ["P", false, false],
    ]);
  });
});

describe("toLayerTreeRows — chaînes d'écrêtage", () => {
  it("une chaîne d'effets écrêtés consécutifs pointe toute entière vers la même photo", () => {
    // `clipBaseId` traverse les écrêtés consécutifs jusqu'à la photo.
    const layers = [photo("P"), effect("A", { clipToBelow: true }), effect("B", { clipToBelow: true })];
    expect(parents(layers)).toEqual(["P", "P", null]);
  });

  it("un écrêté dont la base résolue n'est PAS une photo retombe sur la règle du non-écrêté", () => {
    // Base résolue = A (non écrêté, non photo) → `resolveClipping` dit `inert`.
    // Il reste néanmoins UNE seule photo sous B, donc B s'imbrique sous elle.
    const layers = [photo("P"), effect("A"), effect("B", { clipToBelow: true })];
    expect(parents(layers)).toEqual(["P", "P", null]);
  });

  it("un écrêté inerte au-dessus de DEUX photos reste à plat", () => {
    const layers = [photo("P"), photo("Q"), effect("A"), effect("B", { clipToBelow: true })];
    // Base résolue de B = A (non photo) → inerte → règle du non-écrêté → 2
    // photos dessous → racine.
    expect(parents(layers)).toEqual([null, null, null, null]);
  });

  it("un calque PHOTO portant clipToBelow reste racine (l'attribut y est interdit par LayerStack)", () => {
    const layers = [photo("P"), photo("Q", { clipToBelow: true })];
    expect(shape(layers)).toEqual(["Q", "P"]);
  });
});

describe("toLayerTreeRows — aucun marquage inventé", () => {
  it("une ligne n'expose que profondeur, parent et bornes de filet — rien d'autre", () => {
    const rows = toLayerTreeRows([photo("P"), effect("A")]);
    expect(Object.keys(rows[0]).sort()).toEqual(["depth", "firstChild", "lastChild", "layer", "parentId"]);
  });

  it("un effet à plat touchant plusieurs photos ne porte AUCUN parent ni indentation", () => {
    const rows = toLayerTreeRows([photo("P"), photo("Q"), effect("A")]);
    expect(rows[0]).toMatchObject({ depth: 0, parentId: null, firstChild: false, lastChild: false });
  });
});

/**
 * GLISSER-DÉPOSER avec des lignes imbriquées. L'imbrication ne touche ni le
 * modèle ni l'ordre d'exécution : rejoue la chaîne complète d'un dépôt sur une
 * pile qui produit des groupes, et vérifie que le modèle obtenu est exactement
 * celui qu'un affichage plat aurait produit.
 */
describe("glisser-déposer sur une pile imbriquée", () => {
  const layers = [photo("P"), effect("A"), photo("Q"), effect("B")];

  /** Rejoue un dépôt en partant des lignes ARBORESCENTES (ce que l'utilisateur voit). */
  function dropFromTree(draggedId: string, hoverRow: number, position: DropPosition): string[] {
    const rows = toLayerTreeRows(layers);
    const fromRow = rows.findIndex((r) => r.layer.id === draggedId);
    if (fromRow === hoverRow) return layers.map((l) => l.id);
    const displayInsert = computeInsertIndex(fromRow, hoverRow, position);
    if (displayInsert === fromRow) return layers.map((l) => l.id);
    const modelInsert = displayInsertToModelInsert(displayInsert, layers.length);
    return reorderById(layers, (l) => l.id, draggedId, modelInsert).map((l) => l.id);
  }

  it("l'index de ligne d'un dépôt est le même avec ou sans imbrication", () => {
    const tree = toLayerTreeRows(layers).map((r) => r.layer.id);
    const flat = toDisplayOrder(layers).map((l) => l.id);
    expect(tree).toEqual(flat);
  });

  it("déposer A (imbriqué sous P) au-dessus de la première ligne l'envoie en haut de pile", () => {
    // Affichage : [B, Q, A(enfant de P), P]. A monte avant B.
    expect(dropFromTree("A", 0, "before")).toEqual(["P", "Q", "B", "A"]);
  });

  it("déposer B (racine) sous la dernière ligne l'envoie en bas de pile", () => {
    expect(dropFromTree("B", 3, "after")).toEqual(["B", "P", "A", "Q"]);
  });

  it("tout dépôt reste une PERMUTATION du modèle, sur toutes les cibles", () => {
    for (const dragged of ["P", "A", "Q", "B"]) {
      for (let row = 0; row < layers.length; row++) {
        for (const position of ["before", "after"] as DropPosition[]) {
          expect(dropFromTree(dragged, row, position).slice().sort()).toEqual(["A", "B", "P", "Q"]);
        }
      }
    }
  });
});

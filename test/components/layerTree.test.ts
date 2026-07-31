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
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
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
    expect(layerParentIds(layers)).toEqual([null, "P", null, "Q"]);
  });

  it("« en dessous » veut dire indice INFÉRIEUR dans le tableau, jamais une position à l'écran", () => {
    // A est à l'indice 0 : rien n'est appliqué avant lui, donc aucune photo
    // « en dessous ». Ce fait n'a pas bougé quand le sens d'affichage a été
    // renversé (ADR-0003 le rendait en bas de liste, l'ADR-0004 en haut).
    const layers = [effect("A"), photo("P")];
    expect(layerParentIds(layers)).toEqual([null, null]);
  });

  it("un écrêté nomme sa base photo quel que soit le nombre de photos plus bas", () => {
    expect(layerParentIds([photo("P"), photo("Q"), effect("A", { clipToBelow: true })])).toEqual([null, null, "Q"]);
  });
});

/**
 * PROXIMITÉ (2026-07-29) — la règle en vigueur. Un effet appartient à la photo
 * qui le PRÉCÈDE dans la chaîne : parent de `layers[i]` = photo d'indice le plus
 * élevé strictement inférieur à `i`. Remplace la règle de VÉRITÉ LITTÉRALE
 * (« une seule photo en dessous, sinon racine »), abandonnée parce qu'elle
 * laissait à plat presque toute la pile.
 */
describe("layerParentIds — règle de PROXIMITÉ", () => {
  it("la photo la PLUS PROCHE en dessous gagne, même quand plusieurs photos existent", () => {
    // Sous l'ancienne règle A restait racine (deux photos sous lui).
    const layers = [photo("P"), photo("Q"), effect("A")];
    expect(layerParentIds(layers)).toEqual([null, null, "Q"]);
  });

  it("chaque photo OUVRE son groupe : les effets suivants lui appartiennent jusqu'à la photo suivante", () => {
    const layers = [photo("P"), effect("A"), effect("B"), photo("Q"), effect("C")];
    expect(layerParentIds(layers)).toEqual([null, "P", "P", null, "Q"]);
  });
});

/**
 * LE FOND EST UN CALQUE (tranche T1 du design 2026-07-28). Il vit dans
 * `layers` comme n'importe quelle photo : la règle de proximité le trouve
 * seule, et le paramètre `backgroundId`/`BACKGROUND_LAYER_ID` a disparu avec la
 * ligne d'arrière-plan dérivée qu'il servait. Ce bloc vérifie que le
 * rattachement d'ADR-0005 est PRÉSERVÉ par ce changement de représentation :
 * les effets posés sur la photo d'ouverture lui restent rattachés, exactement
 * comme ils l'étaient à l'id conventionnel.
 */
describe("layerParentIds — le fond, désormais calque photo ordinaire", () => {
  it("les effets posés sur la photo d'ouverture lui sont rattachés", () => {
    const layers = [photo("fond"), effect("A"), effect("B")];
    expect(layerParentIds(layers)).toEqual([null, "fond", "fond"]);
  });

  it("un effet placé SOUS toute photo reste racine : il ne traite que la toile vide", () => {
    // Rendu possible par T1 — le fond se déplace, donc un effet peut passer
    // dessous. Il ne rend rien de visible tant que le fond couvre la toile
    // (design §3.1), et il ne désigne aucune photo parente.
    const layers = [effect("A"), photo("fond"), effect("B")];
    expect(layerParentIds(layers)).toEqual([null, null, "fond"]);
  });

  it("un calque photo reste racine : il est la matière, pas un traitement", () => {
    expect(layerParentIds([photo("P")])).toEqual([null]);
  });
});

/**
 * LE DOCUMENT D'ANTOINE, tel qu'observé sur la vraie fenêtre le 2026-07-29 :
 * fond `DSCF5160.JPG` + Glow + Grain + photo importée `DSCF5160-edited.JPG` +
 * Chromatic bleed écrêté. Une seule ligne sur quatre était indentée.
 *
 * MISE À JOUR T1 : le fond est maintenant une LIGNE de la pile, en tête. Le
 * rattachement des quatre autres lignes est inchangé — c'est ce que ce bloc
 * verrouille.
 */
describe("toLayerTreeRows — le document constaté à l'écran", () => {
  const document = [
    photo("fond"),
    effect("glow"),
    effect("grain"),
    photo("edited"),
    effect("bleed", { clipToBelow: true }),
  ];

  it("rattache les quatre effets : deux au fond, une à la photo importée", () => {
    expect(shape(document)).toEqual(["fond", "  glow", "  grain", "edited", "  bleed"]);
    expect(parents(document)).toEqual([null, "fond", "fond", null, "edited"]);
  });

  it("le groupe du FOND commence juste sous sa ligne : son filet remonte jusqu'à elle", () => {
    const rows = toLayerTreeRows(document);
    expect(rows.map((r) => [r.layer.id, r.firstChild, r.lastChild])).toEqual([
      ["fond", false, false],
      ["glow", true, false],
      ["grain", false, true],
      ["edited", false, false],
      ["bleed", true, true],
    ]);
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
    expect(shape([effect("A"), effect("B"), effect("C")])).toEqual(["A", "B", "C"]);
    expect(parents([effect("A"), effect("B"), effect("C")])).toEqual([null, null, null]);
  });

  it("un effet ÉCRÊTÉ sans aucune photo reste à plat (écrêtage inerte)", () => {
    // `resolveClipping` rend ce cas `inert` : le calque rend LINÉAIREMENT.
    // L'imbriquer désignerait une base qui n'existe pas.
    expect(shape([effect("A", { clipToBelow: true }), effect("B")])).toEqual(["A", "B"]);
  });
});

describe("toLayerTreeRows — une seule photo", () => {
  it("imbrique tous les effets appliqués après elle, écrêtés ou non", () => {
    const layers = [photo("P"), effect("A"), effect("B", { clipToBelow: true }), effect("C")];
    expect(shape(layers)).toEqual(["P", "  A", "  B", "  C"]);
    expect(parents(layers)).toEqual([null, "P", "P", "P"]);
  });

  it("laisse à plat les effets appliqués AVANT l'unique photo (aucune photo en dessous d'eux)", () => {
    const layers = [effect("A"), photo("P"), effect("B")];
    expect(shape(layers)).toEqual(["A", "P", "  B"]);
    expect(parents(layers)).toEqual([null, null, "P"]);
  });

  it("une photo est toujours une ligne racine, jamais imbriquée sous une autre", () => {
    const layers = [photo("P"), photo("Q")];
    expect(shape(layers)).toEqual(["P", "Q"]);
  });

  it("marque la première et la dernière ligne enfant (bornes du filet vertical)", () => {
    const rows = toLayerTreeRows([photo("P"), effect("A"), effect("B"), effect("C")]);
    // Affichage : P, A, B, C — A est la PREMIÈRE ligne enfant, celle qui touche
    // la photo parente juste AU-DESSUS d'elle (sens causal, ADR-0004) ; C est la
    // dernière, et son filet n'a plus rien à relier en dessous.
    expect(rows.map((r) => [r.layer.id, r.firstChild, r.lastChild])).toEqual([
      ["P", false, false],
      ["A", true, false],
      ["B", false, false],
      ["C", false, true],
    ]);
  });

  it("un enfant unique est à la fois premier et dernier", () => {
    const rows = toLayerTreeRows([photo("P"), effect("A")]);
    expect(rows[1]).toMatchObject({ layer: { id: "A" }, firstChild: true, lastChild: true });
  });
});

describe("toLayerTreeRows — deux photos", () => {
  it("un effet NON écrêté au-dessus de DEUX photos rejoint la PLUS PROCHE", () => {
    // Ancienne règle (abandonnée le 2026-07-29) : il restait à plat, parce
    // qu'il s'applique en réalité au composite entier. Voir l'en-tête de
    // src/components/layerTree.ts — la lisibilité du groupe l'emporte
    // désormais sur l'exactitude littérale.
    const layers = [photo("P"), photo("Q"), effect("A")];
    expect(shape(layers)).toEqual(["P", "Q", "  A"]);
    expect(parents(layers)).toEqual([null, null, "Q"]);
  });

  it("des effets de part et d'autre : chacun rejoint la photo qui le précède", () => {
    const layers = [photo("P"), effect("A"), photo("Q"), effect("B")];
    expect(shape(layers)).toEqual(["P", "  A", "Q", "  B"]);
    expect(parents(layers)).toEqual([null, "P", null, "Q"]);
  });

  it("un effet ÉCRÊTÉ s'imbrique même quand DEUX photos sont sous lui", () => {
    // C'est la différence de fond entre les deux règles : l'écrêtage nomme sa
    // base, le non-écrêté ne fait que la déduire quand elle est unique.
    const layers = [photo("P"), photo("Q"), effect("A", { clipToBelow: true })];
    expect(shape(layers)).toEqual(["P", "Q", "  A"]);
    expect(parents(layers)).toEqual([null, null, "Q"]);
  });

  it("effet écrêté sous la photo du HAUT alors qu'une autre photo existe plus bas", () => {
    // Pile : P (bas) · B (libre, 1 photo dessous → enfant de P) · Q · A (écrêté
    // → enfant de Q). Deux groupes distincts, aucun effet à plat.
    const layers = [photo("P"), effect("B"), photo("Q"), effect("A", { clipToBelow: true })];
    expect(shape(layers)).toEqual(["P", "  B", "Q", "  A"]);
    expect(parents(layers)).toEqual([null, "P", null, "Q"]);
  });

  it("les bornes du filet sont calculées par GROUPE, pas globalement", () => {
    const layers = [photo("P"), effect("B"), photo("Q"), effect("A", { clipToBelow: true })];
    const rows = toLayerTreeRows(layers, null);
    expect(rows.map((r) => [r.layer.id, r.firstChild, r.lastChild])).toEqual([
      ["P", false, false],
      ["B", true, true],
      ["Q", false, false],
      ["A", true, true],
    ]);
  });
});

describe("toLayerTreeRows — chaînes d'écrêtage", () => {
  it("une chaîne d'effets écrêtés consécutifs pointe toute entière vers la même photo", () => {
    // `clipBaseId` traverse les écrêtés consécutifs jusqu'à la photo.
    const layers = [photo("P"), effect("A", { clipToBelow: true }), effect("B", { clipToBelow: true })];
    expect(parents(layers)).toEqual([null, "P", "P"]);
  });

  it("un écrêté dont la base résolue n'est PAS une photo retombe sur la règle du non-écrêté", () => {
    // Base résolue = A (non écrêté, non photo) → `resolveClipping` dit `inert`.
    // Il reste néanmoins UNE seule photo sous B, donc B s'imbrique sous elle.
    const layers = [photo("P"), effect("A"), effect("B", { clipToBelow: true })];
    expect(parents(layers)).toEqual([null, "P", "P"]);
  });

  it("un écrêté INERTE retombe sur la règle de proximité, y compris avec deux photos", () => {
    const layers = [photo("P"), photo("Q"), effect("A"), effect("B", { clipToBelow: true })];
    // Base résolue de B = A (non photo) → `resolveClipping` dit `inert` → on
    // retombe sur la proximité, qui désigne Q. Une ligne ne désigne jamais une
    // base d'écrêtage inexistante ; elle rejoint son groupe comme un effet
    // ordinaire.
    expect(parents(layers)).toEqual([null, null, "Q", "Q"]);
  });

  it("un calque PHOTO portant clipToBelow reste racine (l'attribut y est interdit par LayerStack)", () => {
    const layers = [photo("P"), photo("Q", { clipToBelow: true })];
    expect(shape(layers)).toEqual(["P", "Q"]);
  });
});

describe("toLayerTreeRows — aucun marquage inventé", () => {
  it("une ligne n'expose que profondeur, parent et bornes de filet — rien d'autre", () => {
    const rows = toLayerTreeRows([photo("P"), effect("A")]);
    expect(Object.keys(rows[0]).sort()).toEqual(["depth", "firstChild", "lastChild", "layer", "parentId"]);
  });

  it("un effet appliqué AVANT toute photo, sans fond fourni, ne porte AUCUN parent ni indentation", () => {
    const rows = toLayerTreeRows([effect("A"), photo("P")], null);
    expect(rows[0]).toMatchObject({ layer: { id: "A" }, depth: 0, parentId: null, firstChild: false, lastChild: false });
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

  it("déposer A (imbriqué sous P) avant la première ligne l'envoie en tête de pile", () => {
    // Affichage : [P, A(enfant de P), Q, B]. A remonte avant P et perd son
    // parent : plus aucune photo n'est appliquée avant lui.
    expect(dropFromTree("A", 0, "before")).toEqual(["A", "P", "Q", "B"]);
  });

  it("déposer P (première ligne) après la dernière l'envoie en fin de pile", () => {
    expect(dropFromTree("P", 3, "after")).toEqual(["A", "Q", "B", "P"]);
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

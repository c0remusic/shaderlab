import { describe, expect, it } from "vitest";
import {
  applyCollapse,
  EMPTY_COLLAPSE_STATE,
  reconcileCollapse,
  toggleGroup,
  visibleInsertToModelInsert,
  type CollapseState,
} from "../../src/components/pileCollapse";
import { toPileRows } from "../../src/components/pileModel";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

/**
 * REPLI DES GROUPES — règles pures.
 *
 * Ce fichier couvre ce qu'aucune story ne peut voir : la conversion d'index du
 * glisser-déposer (qui n'a pas de trace visuelle quand elle se trompe) et la
 * mémoire de sélection (qui ne se lit qu'après un aller-retour).
 */

function calque(id: string, extra: Partial<LayerState> = {}): LayerState {
  return {
    id,
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...extra,
  };
}

function photo(id: string): LayerState {
  return calque(id, {
    effectId: "passthrough",
    imageSource: { sourceId: `s-${id}` },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  });
}

/** Pile de référence : deux groupes, deux effets chacun.
 *  Ordre modèle = ordre d'affichage (ADR-0004). */
const pile: LayerState[] = [
  photo("P1"),
  calque("A1"),
  calque("A2"),
  photo("P2"),
  calque("B1"),
  calque("B2"),
];

function rows(layers: LayerState[] = pile) {
  return toPileRows(layers, null);
}

function etat(collapsed: string[], memoire: Array<[string, string]> = []): CollapseState {
  return { collapsed: new Set(collapsed), rememberedChild: new Map(memoire) };
}

describe("applyCollapse", () => {
  it("laisse la pile intacte quand rien n'est replié", () => {
    const sortie = applyCollapse(rows(), EMPTY_COLLAPSE_STATE);
    expect(sortie.map((r) => r.layer.id)).toEqual(["P1", "A1", "A2", "P2", "B1", "B2"]);
    expect(sortie.every((r) => !r.collapsed)).toBe(true);
    expect(sortie.every((r) => r.hiddenCount === 0)).toBe(true);
  });

  it("retire les enfants du groupe replié, et eux seuls", () => {
    const sortie = applyCollapse(rows(), etat(["P1"]));
    expect(sortie.map((r) => r.layer.id)).toEqual(["P1", "P2", "B1", "B2"]);
  });

  it("annonce sur le parent combien d'enfants sont MASQUÉS", () => {
    const sortie = applyCollapse(rows(), etat(["P1"]));
    const p1 = sortie.find((r) => r.layer.id === "P1")!;
    expect(p1.collapsed).toBe(true);
    expect(p1.hiddenCount).toBe(2);
    // Le groupe ouvert ne compte rien : la pastille dit ce qu'on NE VOIT PAS,
    // pas ce que le groupe contient.
    expect(sortie.find((r) => r.layer.id === "P2")!.hiddenCount).toBe(0);
  });

  it("ne rend repliable qu'une ligne qui ouvre un groupe NON VIDE", () => {
    const sortie = applyCollapse(toPileRows([photo("seule"), photo("P1"), calque("A1")], null), EMPTY_COLLAPSE_STATE);
    expect(sortie.find((r) => r.layer.id === "seule")!.collapsible).toBe(false);
    expect(sortie.find((r) => r.layer.id === "P1")!.collapsible).toBe(true);
    // Un effet n'ouvre jamais de groupe : la relation ne se compose pas.
    expect(sortie.find((r) => r.layer.id === "A1")!.collapsible).toBe(false);
  });

  it("replie les deux groupes indépendamment", () => {
    const sortie = applyCollapse(rows(), etat(["P1", "P2"]));
    expect(sortie.map((r) => r.layer.id)).toEqual(["P1", "P2"]);
  });

  it("ne réordonne jamais — l'ordre reçu est l'ordre rendu, amputé", () => {
    const avant = rows().map((r) => r.layer.id);
    const apres = applyCollapse(rows(), etat(["P2"])).map((r) => r.layer.id);
    expect(apres).toEqual(avant.filter((id) => !["B1", "B2"].includes(id)));
  });
});

describe("toggleGroup — la sélection", () => {
  it("remonte au parent quand la sélection est DANS le groupe qu'on replie", () => {
    const out = toggleGroup(EMPTY_COLLAPSE_STATE, "P1", pile, "A2");
    expect(out.selectedId).toBe("P1");
    expect(out.state.collapsed.has("P1")).toBe(true);
    expect(out.state.rememberedChild.get("P1")).toBe("A2");
  });

  it("ne touche pas une sélection posée AILLEURS", () => {
    const out = toggleGroup(EMPTY_COLLAPSE_STATE, "P1", pile, "B1");
    expect(out.selectedId).toBe("B1");
    expect(out.state.rememberedChild.has("P1")).toBe(false);
  });

  it("rend la sélection à l'enfant quitté au dépliage", () => {
    const replie = toggleGroup(EMPTY_COLLAPSE_STATE, "P1", pile, "A2");
    const deplie = toggleGroup(replie.state, "P1", pile, replie.selectedId);
    expect(deplie.selectedId).toBe("A2");
    expect(deplie.state.collapsed.has("P1")).toBe(false);
    // La mémoire est consommée : un second aller-retour sans sélection dedans
    // ne doit pas ressusciter un choix vieux de deux gestes.
    expect(deplie.state.rememberedChild.has("P1")).toBe(false);
  });

  it("NE reprend PAS une sélection que l'utilisateur a posée entre-temps", () => {
    const replie = toggleGroup(EMPTY_COLLAPSE_STATE, "P1", pile, "A2");
    // L'utilisateur clique ailleurs pendant que le groupe est replié.
    const deplie = toggleGroup(replie.state, "P1", pile, "B2");
    expect(deplie.selectedId).toBe("B2");
  });

  it("ne rend pas un enfant disparu de la pile", () => {
    const replie = toggleGroup(EMPTY_COLLAPSE_STATE, "P1", pile, "A2");
    const ampute = pile.filter((l) => l.id !== "A2");
    const deplie = toggleGroup(replie.state, "P1", ampute, "P1");
    expect(deplie.selectedId).toBe("P1");
  });

  it("supporte une sélection nulle", () => {
    const out = toggleGroup(EMPTY_COLLAPSE_STATE, "P1", pile, null);
    expect(out.selectedId).toBeNull();
    expect(out.state.collapsed.has("P1")).toBe(true);
  });
});

describe("reconcileCollapse", () => {
  it("rend la MÊME référence quand rien ne doit bouger", () => {
    const avant = etat(["P1"], [["P1", "A1"]]);
    expect(reconcileCollapse(avant, pile.map((l) => l.id))).toBe(avant);
  });

  it("oublie un groupe dont la photo a disparu", () => {
    const apres = reconcileCollapse(etat(["P1", "P2"]), ["P2", "B1"]);
    expect([...apres.collapsed]).toEqual(["P2"]);
  });

  it("oublie une mémoire dont l'enfant a disparu", () => {
    const apres = reconcileCollapse(etat(["P1"], [["P1", "A1"]]), ["P1", "A2"]);
    expect(apres.rememberedChild.has("P1")).toBe(false);
    // Le groupe, lui, reste replié : c'est l'enfant qui est parti, pas la photo.
    expect(apres.collapsed.has("P1")).toBe(true);
  });
});

/**
 * LA CONVERSION D'INDEX — la partie qui casserait SILENCIEUSEMENT.
 *
 * Sans elle, un dépôt sur une pile à groupe replié atterrit ailleurs que là où
 * on l'a lâché, d'autant plus loin que le groupe replié est gros. Rien ne
 * rougirait : le calque bouge, juste pas au bon endroit.
 */
describe("visibleInsertToModelInsert", () => {
  const modele = ["P1", "A1", "A2", "P2", "B1", "B2"];

  it("est l'identité quand tout est visible", () => {
    for (let i = 0; i <= modele.length - 1; i++) {
      expect(visibleInsertToModelInsert(modele, modele, "B2", i)).toBe(i);
    }
  });

  it("saute PAR-DESSUS les enfants masqués d'un groupe replié", () => {
    // P1 replié : A1/A2 n'existent plus à l'écran.
    const visibles = ["P1", "P2", "B1", "B2"];
    // Lâcher juste sous P1 (position 1 des visibles amputés de B2) place le
    // calque avant P2 dans le modèle — donc APRÈS tout le groupe de P1.
    expect(visibleInsertToModelInsert(modele, visibles, "B2", 1)).toBe(3);
  });

  it("place à la fin du MODÈLE quand on lâche après la dernière ligne visible", () => {
    const visibles = ["P1", "P2"]; // les deux groupes repliés
    // Sans ce cas, un groupe replié en queue de pile avalerait l'insertion.
    expect(visibleInsertToModelInsert(modele, visibles, "P1", 1)).toBe(5);
  });

  it("retombe sur la fin plutôt que sur -1 quand l'ancre est introuvable", () => {
    // Appel incohérent : des visibles qui ne sont pas un sous-ensemble du
    // modèle. Rendre -1 insérerait silencieusement au mauvais bout.
    expect(visibleInsertToModelInsert(modele, ["fantome"], "A1", 0)).toBe(5);
  });

  it("ampute les DEUX tableaux du calque déplacé", () => {
    const visibles = ["P1", "A1", "A2", "P2"];
    // A1 est déplacé : il ne compte plus comme ancre possible.
    expect(visibleInsertToModelInsert(modele, visibles, "A1", 1)).toBe(1); // avant A2
  });
});

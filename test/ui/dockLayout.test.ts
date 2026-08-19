import { describe, expect, it } from "vitest";
import {
  getDockDropTarget,
  isPanelShown,
  migrateDockLayout,
  movePanelInDock,
  resolveDockDragCommit,
  setActiveTab,
  setGroupCollapsed,
  singleGroup,
  toFullDockTarget,
  visibleDockLayout,
  type DockLayout,
} from "../../src/ui/dockLayout";

/** Raccourci : une colonne de groupes d'UN onglet chacun — la forme qu'avait
 *  tout le dock avant les groupes (2026-08-19). La plupart des cas ci-dessous
 *  ne parlent pas d'onglets et n'ont aucune raison de s'alourdir de la forme
 *  complète ; ceux qui en parlent construisent leurs groupes à la main. */
const col = (...ids: string[]) => ids.map(singleGroup);

const layout: DockLayout = [col("history"), col("layers", "params")];

describe("movePanelInDock", () => {
  it("moves a card above another card in its column", () => {
    expect(movePanelInDock(layout, "params", { kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" }))
      .toEqual([col("history"), col("params", "layers")]);
  });

  it("moves a card into a new column on the left", () => {
    expect(movePanelInDock(layout, "params", { kind: "horizontal", columnIndex: 1, position: "left" }))
      .toEqual([col("history"), col("params"), col("layers")]);
  });

  it("moves a card into a new column on the right", () => {
    expect(movePanelInDock(layout, "layers", { kind: "horizontal", columnIndex: 0, position: "right" }))
      .toEqual([col("history"), col("layers"), col("params")]);
  });

  it("removes an empty source column after a horizontal move", () => {
    expect(movePanelInDock([col("layers"), col("params")], "layers", { kind: "horizontal", columnIndex: 1, position: "right" }))
      .toEqual([col("params"), col("layers")]);
  });

  it("keeps a single-card column unchanged when dropped on itself", () => {
    const singleCards: DockLayout = [col("layers"), col("params")];
    expect(movePanelInDock(singleCards, "layers", { kind: "vertical", columnIndex: 0, rowIndex: 0, position: "before" }))
      .toBe(singleCards);
    expect(movePanelInDock(singleCards, "layers", { kind: "horizontal", columnIndex: 0, position: "right" }))
      .toBe(singleCards);
  });

  it("keeps adjacent vertical drops unchanged", () => {
    const stack: DockLayout = [col("layers", "params")];
    expect(movePanelInDock(stack, "layers", { kind: "vertical", columnIndex: 0, rowIndex: 1, position: "before" })).toBe(stack);
    expect(movePanelInDock(stack, "params", { kind: "vertical", columnIndex: 0, rowIndex: 0, position: "after" })).toBe(stack);
  });

  it("returns the original layout when the panel id is absent", () => {
    expect(movePanelInDock(layout, "missing", { kind: "horizontal", columnIndex: 0, position: "left" })).toBe(layout);
  });

  // --- Groupes à onglets (2026-08-19) ---

  it("fait REJOINDRE un groupe et porte le panneau déposé au premier plan", () => {
    // Le panneau déposé devient l'onglet actif : on vient de le lâcher là, donc
    // c'est lui qu'on veut voir. Il rejoint la FIN de la barre, comme Photoshop.
    expect(movePanelInDock(layout, "history", { kind: "tab", columnIndex: 1, rowIndex: 0 }))
      .toEqual([[{ tabs: ["layers", "history"], active: "history", collapsed: false }, singleGroup("params")]]);
  });

  it("DÉPLIE le groupe rejoint — sinon le panneau déposé disparaîtrait", () => {
    const replie: DockLayout = [col("history"), [{ tabs: ["layers"], active: "layers", collapsed: true }]];
    const apres = movePanelInDock(replie, "history", { kind: "tab", columnIndex: 1, rowIndex: 0 });
    expect(apres[0][0].collapsed).toBe(false);
  });

  it("ne change rien quand on redépose un panneau sur SON propre groupe", () => {
    expect(movePanelInDock(layout, "layers", { kind: "tab", columnIndex: 1, rowIndex: 0 })).toBe(layout);
  });

  it("SORT un onglet de son groupe vers une nouvelle ligne", () => {
    const groupe: DockLayout = [[{ tabs: ["layers", "params"], active: "layers", collapsed: false }]];
    expect(movePanelInDock(groupe, "params", { kind: "vertical", columnIndex: 0, rowIndex: 0, position: "after" }))
      .toEqual([[singleGroup("layers"), singleGroup("params")]]);
  });

  it("SORT un onglet de son groupe vers une nouvelle colonne", () => {
    const groupe: DockLayout = [[{ tabs: ["layers", "params"], active: "params", collapsed: false }]];
    expect(movePanelInDock(groupe, "params", { kind: "horizontal", columnIndex: 0, position: "right" }))
      .toEqual([[singleGroup("layers")], [singleGroup("params")]]);
  });

  it("réattribue l'onglet ACTIF quand celui qui part l'était", () => {
    // Sans ça le groupe garderait un actif absent de ses onglets et ne rendrait
    // plus aucun contenu — carte vide, sans erreur nulle part.
    const groupe: DockLayout = [[{ tabs: ["a", "b", "c"], active: "b", collapsed: false }]];
    const apres = movePanelInDock(groupe, "b", { kind: "horizontal", columnIndex: 0, position: "right" });
    expect(apres[0][0].tabs).toEqual(["a", "c"]);
    // Le voisin de DROITE prend sa place, c'est l'onglet qui glisse là où il était.
    expect(apres[0][0].active).toBe("c");
  });
});

describe("getDockDropTarget", () => {
  it("reserves the left edge and inner right edges for horizontal docking", () => {
    expect(getDockDropTarget(1, 0, 0.14, 0.5)).toEqual({ kind: "horizontal", columnIndex: 1, position: "left" });
    expect(getDockDropTarget(1, 0, 0.86, 0.5)).toEqual({ kind: "horizontal", columnIndex: 1, position: "right" });
  });

  it("does not offer a new column beyond the rightmost dock column", () => {
    expect(getDockDropTarget(1, 0, 0.86, 0.1, true)).toEqual({ kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" });
  });

  it("donne les BANDES HAUTE et BASSE à l'insertion d'une nouvelle ligne", () => {
    expect(getDockDropTarget(1, 0, 0.5, 0.1)).toEqual({ kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" });
    expect(getDockDropTarget(1, 0, 0.5, 0.9)).toEqual({ kind: "vertical", columnIndex: 1, rowIndex: 0, position: "after" });
  });

  it("donne le MILIEU au groupement en onglet", () => {
    // La moitié centrale, parce que grouper est le geste le plus courant une
    // fois le dock arrangé — et parce que Photoshop groupe de la même façon,
    // en déposant dans le corps du panneau visé.
    expect(getDockDropTarget(1, 0, 0.5, 0.5)).toEqual({ kind: "tab", columnIndex: 1, rowIndex: 0 });
  });
});

describe("resolveDockDragCommit", () => {
  const target = { kind: "vertical", columnIndex: 0, rowIndex: 1, position: "before" } as const;
  const earlierTarget = { kind: "horizontal", columnIndex: 0, position: "left" } as const;

  it("commits the LATEST target recorded before release, not an earlier one", () => {
    // Simule le pattern ref-sync : le ref est mis à jour à chaque pointermove
    // (dernier appel = earlierTarget puis target), le release doit prendre
    // le dernier état lu, pas un état capturé plus tôt dans le geste.
    const dragAfterFirstMove = { draggedId: "layers", pointerId: 7, target: earlierTarget };
    const dragAfterLatestMove = { draggedId: "layers", pointerId: 7, target };
    // Un ancien snapshot ne doit jamais être ce qui est commité.
    expect(resolveDockDragCommit(dragAfterFirstMove, 7, true)).not.toEqual(
      resolveDockDragCommit(dragAfterLatestMove, 7, true)
    );
    expect(resolveDockDragCommit(dragAfterLatestMove, 7, true)).toEqual({ draggedId: "layers", target });
  });

  it("returns null when releasing a pointer id that does not match the drag", () => {
    expect(resolveDockDragCommit({ draggedId: "layers", pointerId: 7, target }, 9, true)).toBeNull();
  });

  it("returns null on cancel (commit=false) even with a valid target", () => {
    expect(resolveDockDragCommit({ draggedId: "layers", pointerId: 7, target }, 7, false)).toBeNull();
  });

  it("returns null when there is no drop target yet", () => {
    expect(resolveDockDragCommit({ draggedId: "layers", pointerId: 7, target: null }, 7, true)).toBeNull();
  });

  it("returns null when there is no drag in progress", () => {
    expect(resolveDockDragCommit(null, 7, true)).toBeNull();
  });
});

describe("visibleDockLayout", () => {
  const layout: DockLayout = [col("params"), col("layers", "mask")];

  it("laisse le layout intact quand tout est visible", () => {
    expect(visibleDockLayout(layout, () => true)).toEqual([col("params"), col("layers", "mask")]);
  });

  it("retire la colonne devenue vide, pas seulement le panneau masqué", () => {
    // C'est le défaut corrigé : sans le filtre de colonne, la colonne de
    // `params` gardait sa largeur (flex-basis) et laissait un trou.
    expect(visibleDockLayout(layout, (id) => id !== "params")).toEqual([col("layers", "mask")]);
  });

  it("retire un panneau sans toucher à sa colonne quand il reste un voisin", () => {
    expect(visibleDockLayout(layout, (id) => id !== "layers")).toEqual([col("params"), col("mask")]);
  });

  it("rend un layout vide quand plus rien n'est visible", () => {
    expect(visibleDockLayout(layout, () => false)).toEqual([]);
  });

  it("recalcule l'onglet ACTIF quand il est masqué", () => {
    // Un groupe dont l'actif est caché doit montrer un de ses onglets restants,
    // pas un contenu vide.
    const groupe: DockLayout = [[{ tabs: ["presets", "properties"], active: "presets", collapsed: false }]];
    expect(visibleDockLayout(groupe, (id) => id !== "presets"))
      .toEqual([[{ tabs: ["properties"], active: "properties", collapsed: false }]]);
  });

  it("retire le groupe entier quand tous ses onglets sont masqués", () => {
    const groupe: DockLayout = [[{ tabs: ["a", "b"], active: "a", collapsed: false }, singleGroup("c")]];
    expect(visibleDockLayout(groupe, (id) => id === "c")).toEqual([col("c")]);
  });
});

describe("toFullDockTarget", () => {
  const full: DockLayout = [col("params"), col("layers", "mask")];

  it("décale l'index de colonne quand une colonne masquée précède la cible", () => {
    const visible = visibleDockLayout(full, (id) => id !== "params"); // [["layers","mask"]]
    // Dans le repère VISIBLE la colonne est 0 ; dans le repère COMPLET c'est 1.
    expect(toFullDockTarget(full, visible, { kind: "horizontal", columnIndex: 0, position: "left" }))
      .toEqual({ kind: "horizontal", columnIndex: 1, position: "left" });
  });

  it("retrouve la ligne réelle quand un panneau masqué la précède dans la colonne", () => {
    const visible = visibleDockLayout(full, (id) => id !== "layers"); // [["params"],["mask"]]
    // "mask" est en ligne 0 du repère visible, mais en ligne 1 du complet.
    expect(toFullDockTarget(full, visible, { kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" }))
      .toEqual({ kind: "vertical", columnIndex: 1, rowIndex: 1, position: "before" });
  });

  it("traduit aussi une cible d'ONGLET", () => {
    const visible = visibleDockLayout(full, (id) => id !== "layers");
    expect(toFullDockTarget(full, visible, { kind: "tab", columnIndex: 1, rowIndex: 0 }))
      .toEqual({ kind: "tab", columnIndex: 1, rowIndex: 1 });
  });

  it("laisse la cible inchangée quand rien n'est masqué", () => {
    const target = { kind: "vertical", columnIndex: 1, rowIndex: 1, position: "after" } as const;
    expect(toFullDockTarget(full, full, target)).toEqual(target);
  });

  it("rend la cible telle quelle plutôt que d'inventer une position quand elle ne correspond à rien", () => {
    // Colonne hors bornes de la projection visible (layout muté entre le
    // dernier pointermove et le relâchement).
    const target = { kind: "vertical", columnIndex: 9, rowIndex: 0, position: "before" } as const;
    expect(toFullDockTarget(full, [col("layers", "mask")], target)).toEqual(target);
  });
});

describe("setActiveTab", () => {
  const groupe: DockLayout = [[{ tabs: ["presets", "properties"], active: "presets", collapsed: false }]];

  it("porte l'onglet demandé au premier plan", () => {
    expect(setActiveTab(groupe, "properties")[0][0].active).toBe("properties");
  });

  it("DÉPLIE le groupe, parce que cliquer un onglet doit révéler son panneau", () => {
    // Sans le dépliage, le clic n'aurait d'autre effet visible qu'un changement
    // de surbrillance et se lirait comme un onglet qui ne répond pas.
    const replie: DockLayout = [[{ tabs: ["a", "b"], active: "a", collapsed: true }]];
    const apres = setActiveTab(replie, "b");
    expect(apres[0][0]).toEqual({ tabs: ["a", "b"], active: "b", collapsed: false });
  });

  it("ne réordonne PAS les onglets", () => {
    // Des onglets qui sautent à chaque clic seraient impossibles à viser.
    expect(setActiveTab(groupe, "properties")[0][0].tabs).toEqual(["presets", "properties"]);
  });

  it("rend le layout inchangé quand l'onglet est déjà actif et déplié", () => {
    expect(setActiveTab(groupe, "presets")).toBe(groupe);
  });

  it("rend le layout inchangé pour un id absent", () => {
    expect(setActiveTab(groupe, "missing")).toBe(groupe);
  });
});

describe("setGroupCollapsed", () => {
  const groupe: DockLayout = [[{ tabs: ["a", "b"], active: "a", collapsed: false }], col("c")];

  it("replie le GROUPE qui contient l'id, pas seulement ce panneau", () => {
    const apres = setGroupCollapsed(groupe, "b", true);
    expect(apres[0][0].collapsed).toBe(true);
    // Le groupe voisin n'a pas bougé.
    expect(apres[1][0].collapsed).toBe(false);
  });

  it("rend le layout inchangé quand le groupe est déjà dans cet état", () => {
    expect(setGroupCollapsed(groupe, "a", false)).toBe(groupe);
  });
});

describe("isPanelShown", () => {
  const groupe: DockLayout = [[{ tabs: ["presets", "properties"], active: "properties", collapsed: false }]];

  it("est vrai pour l'onglet actif d'un groupe déplié", () => {
    expect(isPanelShown(groupe, "properties")).toBe(true);
  });

  it("est faux pour un onglet qui n'est pas au premier plan", () => {
    // C'est la façon de ne pas être visible que l'ancien `!propertiesFolded`
    // ignorait : le panneau n'est pas replié, il est derrière.
    expect(isPanelShown(groupe, "presets")).toBe(false);
  });

  it("est faux quand le groupe est replié, même pour l'onglet actif", () => {
    const replie: DockLayout = [[{ tabs: ["presets", "properties"], active: "properties", collapsed: true }]];
    expect(isPanelShown(replie, "properties")).toBe(false);
  });

  it("est faux pour un panneau absent du layout", () => {
    expect(isPanelShown(groupe, "missing")).toBe(false);
  });
});

describe("migrateDockLayout", () => {
  it("convertit l'ANCIEN format en groupes d'un onglet", () => {
    // La disposition est persistée : une valeur écrite avant le 2026-08-19 se
    // relit sous l'ancienne forme, et la laisser passer ferait planter le rendu
    // sur `group.tabs` indéfini.
    expect(migrateDockLayout([["presets", "layers"], ["properties"]]))
      .toEqual([col("presets", "layers"), col("properties")]);
  });

  it("laisse passer une disposition DÉJÀ au nouveau format — l'appel est idempotent", () => {
    const neuf = [[{ tabs: ["a", "b"], active: "b", collapsed: true }]];
    expect(migrateDockLayout(neuf)).toEqual(neuf);
  });

  it("REVALIDE un onglet actif qui n'est plus dans son groupe", () => {
    // Un actif hors du groupe ne rendrait aucun contenu — carte vide, sans erreur.
    expect(migrateDockLayout([[{ tabs: ["a"], active: "disparu", collapsed: false }]]))
      .toEqual([[{ tabs: ["a"], active: "a", collapsed: false }]]);
  });

  it("jette les groupes vides et les colonnes qui n'en gardent aucun", () => {
    expect(migrateDockLayout([[{ tabs: [], active: "x", collapsed: false }], ["a"]]))
      .toEqual([col("a")]);
  });

  it("rend null sur une valeur qui n'est pas une disposition", () => {
    expect(migrateDockLayout(null)).toBeNull();
    expect(migrateDockLayout("nope")).toBeNull();
    expect(migrateDockLayout([["a"], 3])).toBeNull();
    expect(migrateDockLayout([[{ tabs: [1, 2] }]])).toBeNull();
  });
});

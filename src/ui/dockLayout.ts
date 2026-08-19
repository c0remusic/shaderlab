/**
 * Disposition du dock — colonnes de GROUPES, un groupe étant plusieurs
 * panneaux qui partagent une barre d'ONGLETS.
 *
 * MODÈLE PHOTOSHOP, adopté le 2026-08-19 (arbitrage d'Antoine, relevé
 * `.scratch/hybride-lightroom-photoshop/research/02-la-colonne-trop-haute.md`).
 * Un groupe montre ses panneaux en onglets, un seul visible à la fois, et les
 * groupes s'empilent dans la colonne. On groupe en tirant un panneau dans le
 * CORPS d'un groupe, on dégroupe en le tirant sur le BORD (ce qui ouvre une
 * nouvelle ligne) — les mêmes deux zones de dépôt que Photoshop.
 *
 * POURQUOI DES ONGLETS ET PAS UN REPLI. Le problème résolu est qu'à
 * 1280 × 720, sur un document de sept calques, la somme des planchers dépassait
 * la hauteur disponible de 194 px et la colonne retombait sur son
 * `overflow-y: auto` — ce qu'ADR-0001 interdit. Deux mécanismes le fermaient :
 * replier une carte, ou mettre les panneaux en onglets. Le second est celui de
 * Photoshop, et il gagne pour une raison qui n'est pas esthétique : **avec un
 * onglet on VOIT que l'autre panneau existe, et il est à un clic**. Un repli le
 * cache et en demande deux. Un « solo mode » à la Lightroom a été construit
 * puis retiré le même jour : il tenait la colonne, mais rendait Pile et
 * Propriétés mutuellement exclusives alors qu'on les lit ensemble.
 *
 * Ce module est PUR : aucune référence à React ni au DOM, pour que les
 * trente-et-quelques cas de `test/ui/dockLayout.test.ts` s'exécutent sans rendu.
 */

/** Un GROUPE de panneaux partageant une barre d'onglets. */
export interface DockGroup {
  /** Ordre des onglets, STABLE : sélectionner un onglet ne le réordonne pas.
   *  Photoshop garde ses onglets en place quand on passe de l'un à l'autre, et
   *  des onglets qui sautent à chaque clic seraient impossibles à viser. */
  tabs: string[];
  /** Onglet visible. Invariant tenu par toutes les fonctions de ce module :
   *  `tabs.includes(active)` dès que `tabs` n'est pas vide. */
  active: string;
  /** Le groupe ENTIER est replié : seule sa barre d'onglets se rend. Le repli
   *  est une propriété du groupe et non d'un panneau — dans un groupe, un
   *  panneau non actif n'est pas « replié », il est simplement pas au premier
   *  plan, et confondre les deux était le défaut du modèle précédent. */
  collapsed: boolean;
}

/** Colonnes de groupes. */
export type DockLayout = DockGroup[][];

export type DockDropTarget =
  /** Nouvelle ligne, avant ou après le groupe visé. */
  | { kind: "vertical"; columnIndex: number; rowIndex: number; position: "before" | "after" }
  /** Nouvelle colonne, à gauche ou à droite. */
  | { kind: "horizontal"; columnIndex: number; position: "left" | "right" }
  /** REJOINDRE le groupe visé, en onglet. */
  | { kind: "tab"; columnIndex: number; rowIndex: number };

const HORIZONTAL_DOCK_SNAP_RATIO = 0.15;

/** Hauteur des bandes HAUTE et BASSE d'un groupe qui ouvrent une nouvelle
 *  ligne. Entre les deux, on rejoint le groupe en onglet.
 *
 *  Un quart de part et d'autre laisse la moitié centrale au groupement, qui est
 *  le geste le plus courant une fois le dock arrangé, tout en gardant des
 *  bandes de bord assez épaisses pour être visées sans précision. */
const TAB_DOCK_SNAP_RATIO = 0.25;

/** Construit un groupe d'un seul panneau, déplié. */
export function singleGroup(id: string): DockGroup {
  return { tabs: [id], active: id, collapsed: false };
}

/**
 * Convertit une disposition de l'ANCIEN modèle (`string[][]`, une ligne = un
 * panneau) vers le nouveau. Chaque panneau y devient son propre groupe, ce qui
 * reproduit exactement l'affichage d'avant.
 *
 * Nécessaire parce que la disposition est PERSISTÉE : une valeur écrite avant
 * le 2026-08-19 se relit sous l'ancienne forme, et la laisser passer telle
 * quelle ferait planter le rendu sur `group.tabs` indéfini. Une disposition
 * déjà au nouveau format traverse inchangée, donc l'appel est idempotent.
 */
export function migrateDockLayout(raw: unknown): DockLayout | null {
  if (!Array.isArray(raw)) return null;
  const layout: DockLayout = [];
  for (const column of raw) {
    if (!Array.isArray(column)) return null;
    const groupes: DockGroup[] = [];
    for (const entry of column) {
      if (typeof entry === "string") {
        groupes.push(singleGroup(entry));
        continue;
      }
      if (entry === null || typeof entry !== "object") return null;
      const candidate = entry as Partial<DockGroup>;
      if (!Array.isArray(candidate.tabs) || candidate.tabs.some((t) => typeof t !== "string")) return null;
      if (candidate.tabs.length === 0) continue;
      const tabs = candidate.tabs as string[];
      // `active` est REVALIDÉ et pas seulement lu : une disposition persistée
      // peut citer un panneau qui n'existe plus dans son groupe, et un actif
      // hors du groupe ne rendrait aucun contenu — carte vide, sans erreur.
      const active = typeof candidate.active === "string" && tabs.includes(candidate.active)
        ? candidate.active
        : tabs[0];
      groupes.push({ tabs, active, collapsed: candidate.collapsed === true });
    }
    if (groupes.length > 0) layout.push(groupes);
  }
  return layout;
}

export function getDockDropTarget(
  columnIndex: number,
  rowIndex: number,
  relativeX: number,
  relativeY: number,
  isRightmostColumn = false,
): DockDropTarget {
  if (relativeX < HORIZONTAL_DOCK_SNAP_RATIO) {
    return { kind: "horizontal", columnIndex, position: "left" };
  }
  if (!isRightmostColumn && relativeX > 1 - HORIZONTAL_DOCK_SNAP_RATIO) {
    return { kind: "horizontal", columnIndex, position: "right" };
  }
  if (relativeY < TAB_DOCK_SNAP_RATIO) {
    return { kind: "vertical", columnIndex, rowIndex, position: "before" };
  }
  if (relativeY > 1 - TAB_DOCK_SNAP_RATIO) {
    return { kind: "vertical", columnIndex, rowIndex, position: "after" };
  }
  return { kind: "tab", columnIndex, rowIndex };
}

/** Où vit le panneau `id` : sa colonne, son groupe, son rang dans le groupe. */
function findPanel(layout: DockLayout, id: string): { columnIndex: number; rowIndex: number; tabIndex: number } | null {
  for (let columnIndex = 0; columnIndex < layout.length; columnIndex += 1) {
    const column = layout[columnIndex];
    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const tabIndex = column[rowIndex].tabs.indexOf(id);
      if (tabIndex !== -1) return { columnIndex, rowIndex, tabIndex };
    }
  }
  return null;
}

/**
 * Retire `id` de son groupe, puis les groupes et colonnes devenus vides.
 *
 * Si le panneau retiré était l'ONGLET ACTIF, l'actif passe au voisin — sans
 * quoi le groupe garderait un actif absent de ses onglets et ne rendrait plus
 * aucun contenu. Le voisin de DROITE d'abord (l'onglet qui prend visuellement
 * sa place), à défaut celui de gauche.
 */
function removePanel(layout: DockLayout, id: string): DockLayout {
  return layout
    .map((column) =>
      column
        .map((group) => {
          const tabIndex = group.tabs.indexOf(id);
          if (tabIndex === -1) return group;
          const tabs = group.tabs.filter((tab) => tab !== id);
          if (tabs.length === 0) return null;
          const active = group.active === id ? (tabs[tabIndex] ?? tabs[tabIndex - 1] ?? tabs[0]) : group.active;
          return { ...group, tabs, active };
        })
        .filter((group): group is DockGroup => group !== null),
    )
    .filter((column) => column.length > 0);
}

export function isNoOpDockDrop(layout: DockLayout, id: string, target: DockDropTarget): boolean {
  const source = findPanel(layout, id);
  if (!source) return true;

  if (target.kind === "horizontal") {
    // Sortir en colonne n'est un no-op que si le panneau EST déjà seul dans sa
    // propre colonne — donc seul dans son groupe ET seul groupe de la colonne.
    return (
      source.columnIndex === target.columnIndex &&
      layout[source.columnIndex].length === 1 &&
      layout[source.columnIndex][0].tabs.length === 1
    );
  }

  if (target.kind === "tab") {
    // Rejoindre le groupe où l'on est déjà ne change rien.
    return source.columnIndex === target.columnIndex && source.rowIndex === target.rowIndex;
  }

  if (source.columnIndex !== target.columnIndex) return false;
  // Ouvrir une ligne depuis un groupe où l'on n'est PAS seul est toujours un
  // vrai déplacement : le panneau quitte son groupe, même si la ligne obtenue
  // est adjacente à celle d'où il vient.
  if (layout[source.columnIndex][source.rowIndex].tabs.length > 1) return false;
  return target.position === "before"
    ? target.rowIndex === source.rowIndex || target.rowIndex === source.rowIndex + 1
    : target.rowIndex === source.rowIndex || target.rowIndex === source.rowIndex - 1;
}

/** Sous-ensemble de l'état de drag de `PanelColumn` pertinent pour décider
 *  d'un commit — pas le type complet (pas besoin de grabOffset/pointerPosition/
 *  targetBounds ici), pour ne pas coupler cette logique pure au composant. */
export interface DockDragCommitCandidate {
  draggedId: string;
  pointerId: number;
  target: DockDropTarget | null;
}

/**
 * Décide ce qui doit être commité au relâchement/annulation d'un drag de
 * panneau docké — logique pure extraite de `PanelColumn.finishDrag` pour
 * être testable sans rendu React. `drag` doit être l'état le PLUS RÉCENT
 * connu au moment de l'appel (le composant le lit depuis un ref synchronisé
 * par le setter fonctionnel de state, pas depuis une fermeture figée) —
 * sinon un relâchement rapide après le dernier pointermove risquerait de
 * commiter une cible périmée plutôt que celle sous le curseur à l'instant du
 * relâchement.
 */
export function resolveDockDragCommit(
  drag: DockDragCommitCandidate | null,
  releasePointerId: number,
  commit: boolean
): { draggedId: string; target: DockDropTarget } | null {
  if (!drag || releasePointerId !== drag.pointerId) return null;
  if (!commit || !drag.target) return null;
  return { draggedId: drag.draggedId, target: drag.target };
}

/**
 * Retire des colonnes les panneaux actuellement masqués, PUIS les groupes et
 * colonnes devenus vides. Sans ça, `.panel-column__stack` (flex: 0 0 largeur du
 * dock) garde ses 320px et laisse un trou dans le dock quand le seul panneau
 * d'une colonne est masqué depuis le rail.
 *
 * Le layout COMPLET reste la source de vérité (il mémorise la place d'un
 * panneau masqué, qui la retrouve quand il réapparaît) ; celui-ci n'est que la
 * projection affichée. C'est pourquoi une cible de drop calculée sur cette
 * projection doit être retraduite avant mutation — voir `toFullDockTarget`.
 *
 * L'ONGLET ACTIF est recalculé quand il est masqué : un groupe dont l'actif est
 * caché doit montrer un de ses onglets restants, pas un contenu vide.
 */
export function visibleDockLayout(layout: DockLayout, isVisible: (id: string) => boolean): DockLayout {
  return layout
    .map((column) =>
      column
        .map((group) => {
          const tabs = group.tabs.filter(isVisible);
          if (tabs.length === 0) return null;
          return { ...group, tabs, active: tabs.includes(group.active) ? group.active : tabs[0] };
        })
        .filter((group): group is DockGroup => group !== null),
    )
    .filter((column) => column.length > 0);
}

/**
 * Traduit une cible de drop exprimée dans les index de la projection VISIBLE
 * (ce que `PanelColumn` voit et rapporte) vers les index du layout COMPLET (ce
 * que `movePanelInDock` mute). Sans cette traduction, masquer un panneau
 * décale silencieusement toutes les colonnes suivantes et un glisser-déposer
 * déplace la carte dans la mauvaise colonne.
 *
 * L'ancrage se fait par IDENTITÉ de panneau, pas par arithmétique d'index :
 * `rowIndex` désigne toujours un groupe réellement rendu, donc on retrouve sa
 * position réelle en cherchant l'un de ses onglets. Une cible qui ne correspond
 * à rien (layout modifié entre le pointermove et le relâchement) retombe sur la
 * cible telle quelle plutôt que d'inventer une position.
 */
export function toFullDockTarget(full: DockLayout, visible: DockLayout, target: DockDropTarget): DockDropTarget {
  const visibleColumn = visible[target.columnIndex];
  if (!visibleColumn) return target;

  // Une colonne visible correspond à la colonne complète qui contient ses
  // panneaux — on la retrouve par le premier onglet de son premier groupe,
  // seul lien stable entre les deux repères.
  const ancreColonne = visibleColumn[0].tabs[0];
  const fullColumnIndex = full.findIndex((column) => column.some((group) => group.tabs.includes(ancreColonne)));
  if (fullColumnIndex === -1) return target;

  if (target.kind === "horizontal") return { ...target, columnIndex: fullColumnIndex };

  const ancreGroupe = visibleColumn[target.rowIndex]?.tabs[0];
  const fullRowIndex = ancreGroupe === undefined
    ? -1
    : full[fullColumnIndex].findIndex((group) => group.tabs.includes(ancreGroupe));
  // La colonne, elle, EST résolue : la rendre traduite même si la ligne ne
  // l'est pas. Rendre `target` tel quel jetterait un index de colonne correct
  // pour en garder un exprimé dans l'autre repère — donc faux dès qu'une
  // colonne masquée précède. Inatteignable en pratique (les ids sont uniques
  // par layout, l'ancre vient d'une carte réellement rendue), mais un repli ne
  // doit pas être moins juste que ce qu'il remplace.
  if (fullRowIndex === -1) return { ...target, columnIndex: fullColumnIndex };
  return { ...target, columnIndex: fullColumnIndex, rowIndex: fullRowIndex };
}

export function movePanelInDock(layout: DockLayout, id: string, target: DockDropTarget): DockLayout {
  const source = findPanel(layout, id);
  if (!source || isNoOpDockDrop(layout, id, target)) return layout;

  const sourceGroup = layout[source.columnIndex][source.rowIndex];
  // Une colonne disparaît quand le panneau déplacé en était le SEUL occupant —
  // seul de son groupe, et ce groupe seul de la colonne.
  const videraLaColonne = layout[source.columnIndex].length === 1 && sourceGroup.tabs.length === 1;
  const withoutPanel = removePanel(layout, id);
  const removedColumnBeforeTarget = source.columnIndex < target.columnIndex && videraLaColonne;
  const columnIndex = target.columnIndex - (removedColumnBeforeTarget ? 1 : 0);

  if (target.kind === "horizontal") {
    const insertionIndex = columnIndex + (target.position === "right" ? 1 : 0);
    return [...withoutPanel.slice(0, insertionIndex), [singleGroup(id)], ...withoutPanel.slice(insertionIndex)];
  }

  const column = withoutPanel[columnIndex];
  if (!column) return layout;

  // Le groupe visé a pu perdre une ligne au-dessus de lui si le panneau retiré
  // y était seul — même correction d'index que pour les colonnes.
  const videraLeGroupe = sourceGroup.tabs.length === 1;
  const decalageLigne = source.columnIndex === target.columnIndex && videraLeGroupe && source.rowIndex < target.rowIndex ? 1 : 0;
  const targetRow = target.rowIndex - decalageLigne;

  if (target.kind === "tab") {
    const groupe = column[targetRow];
    if (!groupe) return layout;
    // Le panneau déposé devient l'onglet ACTIF : on vient de le lâcher là, donc
    // c'est lui qu'on veut voir. Il rejoint la fin de la barre, comme Photoshop.
    const fusionne: DockGroup = { ...groupe, tabs: [...groupe.tabs, id], active: id, collapsed: false };
    return [
      ...withoutPanel.slice(0, columnIndex),
      [...column.slice(0, targetRow), fusionne, ...column.slice(targetRow + 1)],
      ...withoutPanel.slice(columnIndex + 1),
    ];
  }

  const insertionIndex = targetRow + (target.position === "after" ? 1 : 0);
  return [
    ...withoutPanel.slice(0, columnIndex),
    [...column.slice(0, insertionIndex), singleGroup(id), ...column.slice(insertionIndex)],
    ...withoutPanel.slice(columnIndex + 1),
  ];
}

/**
 * Porte l'onglet `id` au premier plan de son groupe, et DÉPLIE ce groupe.
 *
 * Le dépliage n'est pas un effet de bord : cliquer un onglet, chez Photoshop,
 * révèle ce panneau. Laisser le groupe replié rendrait le clic sans effet
 * visible autre qu'un changement de surbrillance — l'utilisateur conclurait que
 * l'onglet ne répond pas.
 */
export function setActiveTab(layout: DockLayout, id: string): DockLayout {
  const found = findPanel(layout, id);
  if (!found) return layout;
  const groupe = layout[found.columnIndex][found.rowIndex];
  if (groupe.active === id && !groupe.collapsed) return layout;
  return layout.map((column, columnIndex) =>
    columnIndex !== found.columnIndex
      ? column
      : column.map((group, rowIndex) => (rowIndex === found.rowIndex ? { ...group, active: id, collapsed: false } : group)),
  );
}

/** Replie ou déplie le GROUPE qui contient `id`. */
export function setGroupCollapsed(layout: DockLayout, id: string, collapsed: boolean): DockLayout {
  const found = findPanel(layout, id);
  if (!found) return layout;
  if (layout[found.columnIndex][found.rowIndex].collapsed === collapsed) return layout;
  return layout.map((column, columnIndex) =>
    columnIndex !== found.columnIndex
      ? column
      : column.map((group, rowIndex) => (rowIndex === found.rowIndex ? { ...group, collapsed } : group)),
  );
}

/**
 * Le panneau `id` montre-t-il son CONTENU ?
 *
 * Trois façons de ne pas le montrer, et elles ne se valent pas : absent du
 * layout, pas l'onglet actif de son groupe, ou groupe replié. Les appelants
 * n'ont besoin que du résultat — c'est ce qui remplace l'ancien
 * `!propertiesFolded`, qui ne connaissait que la troisième.
 */
export function isPanelShown(layout: DockLayout, id: string): boolean {
  const found = findPanel(layout, id);
  if (!found) return false;
  const groupe = layout[found.columnIndex][found.rowIndex];
  return !groupe.collapsed && groupe.active === id;
}

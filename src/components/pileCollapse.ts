import type { LayerState } from "../layers/types";
import { layerParentIds } from "./layerTree";
import type { PileRow } from "./pileModel";

/**
 * REPLI DES GROUPES DE LA PILE — règles pures, sans React ni DOM.
 *
 * Forme tranchée par Antoine le 2026-08-15 sur trois wireframes
 * (`docs/wireframes/pile-longue*.html`) : au-delà de cinq lignes la carte
 * déborde, et la réponse retenue est de replier les GROUPES — une photo et les
 * effets qui la traitent — plutôt que de rogner la ligne, de paginer ou
 * d'agrandir la carte. Douze calques tiennent alors dans les cinq lignes
 * existantes tant qu'un seul groupe est ouvert, ce qui est le cas normal : on
 * n'édite qu'un groupe à la fois.
 *
 * ── OÙ VIT L'ÉTAT, ET POURQUOI PAS DANS LE MODÈLE ───────────────────────────
 *
 * Arbitrage d'Antoine du 2026-08-16, pris sur mesure et non sur intuition
 * (`.scratch/prochain-palier/issues/20-ou-vit-l-etat-de-repli-de-la-pile.md`) :
 * le repli est un état d'INTERFACE, comme `isolatedLayerId`. Jamais un champ de
 * `LayerState`.
 *
 * La question posée opposait « persisté » à « perdu à la réouverture ». **Les
 * deux branches perdaient** : le projet n'a AUCUNE persistance de document —
 * ses commandes IPC couvrent les images, les textures et les presets, aucune
 * n'écrit une pile de calques. Ce qui sépare réellement les deux options est
 * l'ANNULABILITÉ : `History.push` snapshotte la pile entière, donc un champ de
 * `LayerState` est rejoué par l'undo — replier un groupe puis annuler un coup
 * de pinceau ROUVRIRAIT le groupe. Un repli annulable par Ctrl+Z est un défaut,
 * pas une fonctionnalité.
 *
 * ── LE REPLI EST UNE PROJECTION, PAS UNE DONNÉE ─────────────────────────────
 *
 * `layerTree.ts` calcule déjà `depth`/`parentId`/`firstChild`/`lastChild` par la
 * règle de proximité. Le groupe EXISTE donc, dérivé de la pile ; replier n'est
 * qu'un filtre par-dessus. Ce module ne stocke aucune structure d'arbre — il
 * relit celle de `layerTree` à chaque appel, exactement comme `pileModel`.
 */

/** Ce que le repli AJOUTE à une ligne de pile. Les champs de `PileRow` sont
 *  inchangés : replier ne réordonne rien et ne re-rattache rien. */
export interface CollapsiblePileRow extends PileRow {
  /** Cette ligne ouvre-t-elle un groupe non vide ? C'est la seule condition du
   *  chevron : une photo sans effet rattaché n'a rien à replier, et un chevron
   *  qui ne fait rien est pire qu'un chevron absent. */
  collapsible: boolean;
  /** Ce groupe est-il replié ? Toujours faux sur une ligne non repliable. */
  collapsed: boolean;
  /** Nombre d'enfants MASQUÉS par le repli — le compte de la pastille. Vaut 0
   *  sur un groupe déplié : la pastille annonce ce qu'on ne voit pas, pas ce
   *  que contient le groupe. */
  hiddenCount: number;
}

/** L'état de repli, en deux morceaux qui ne se déduisent pas l'un de l'autre. */
export interface CollapseState {
  /** Ids des photos dont le groupe est replié. */
  collapsed: ReadonlySet<string>;
  /**
   * Dernier enfant SÉLECTIONNÉ quitté par un repli, par groupe.
   *
   * Second arbitrage d'Antoine du 2026-08-16 : replier fait remonter la
   * sélection au parent, et déplier la REND à l'enfant quitté. Sans cette
   * mémoire, un aller-retour de repli fait perdre la ligne sur laquelle on
   * travaillait — le ticket 20 le signalait comme le piège de la réponse
   * « évidente » (remonter au parent) prise seule.
   */
  rememberedChild: ReadonlyMap<string, string>;
}

export const EMPTY_COLLAPSE_STATE: CollapseState = {
  collapsed: new Set(),
  rememberedChild: new Map(),
};

/**
 * Applique le repli à une projection de pile : retire les lignes enfants des
 * groupes repliés, et annote les lignes qui restent.
 *
 * L'ORDRE des lignes rendues est celui reçu, amputé — jamais retrié. C'est ce
 * qui laisse `layerTree` seul maître du rattachement et `layerDisplayOrder`
 * seul maître du sens.
 */
export function applyCollapse(
  rows: readonly PileRow[],
  state: CollapseState,
): CollapsiblePileRow[] {
  // Un groupe existe dès qu'une ligne s'y rattache. Compté sur les lignes
  // reçues et non sur `layers` : ce module ne voit que ce que la projection lui
  // donne, et il n'a pas à savoir comment le rattachement a été décidé.
  const childCount = new Map<string, number>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    childCount.set(row.parentId, (childCount.get(row.parentId) ?? 0) + 1);
  }

  const sortie: CollapsiblePileRow[] = [];
  for (const row of rows) {
    // Une ligne enfant d'un groupe replié disparaît, purement et simplement.
    if (row.parentId !== null && state.collapsed.has(row.parentId)) continue;

    const enfants = childCount.get(row.layer.id) ?? 0;
    const collapsed = enfants > 0 && state.collapsed.has(row.layer.id);
    sortie.push({
      ...row,
      collapsible: enfants > 0,
      collapsed,
      hiddenCount: collapsed ? enfants : 0,
    });
  }
  return sortie;
}

/** Résultat d'une bascule : le nouvel état, et la sélection qu'elle impose. */
export interface CollapseToggle {
  state: CollapseState;
  /** Sélection APRÈS la bascule. Vaut celle reçue quand rien ne l'oblige à
   *  bouger — l'appelant peut la pousser sans condition. */
  selectedId: string | null;
}

/**
 * Bascule le repli du groupe `parentId`, sélection comprise.
 *
 * REPLIER, quand la sélection est DANS le groupe : elle remonte au parent, et
 * l'enfant quitté est mémorisé. Laisser la sélection sur une ligne devenue
 * invisible ramènerait exactement le défaut corrigé le 2026-08-14 — on éditait
 * les propriétés d'un calque qu'on ne voyait pas.
 *
 * DÉPLIER : la sélection revient à l'enfant mémorisé, s'il existe encore ET si
 * la sélection est restée sur le parent. Si l'utilisateur a sélectionné autre
 * chose entre-temps, on ne la lui reprend pas — un dépliage qui déplace une
 * sélection posée ailleurs serait un effet surprise.
 */
export function toggleGroup(
  state: CollapseState,
  parentId: string,
  // Non `readonly` : `layerParentIds` prend un tableau mutable, et l'aligner
  // ici vaut mieux qu'une copie défensive à chaque bascule.
  layers: LayerState[],
  selectedId: string | null,
): CollapseToggle {
  const collapsed = new Set(state.collapsed);
  const rememberedChild = new Map(state.rememberedChild);

  if (collapsed.has(parentId)) {
    collapsed.delete(parentId);
    const memorise = rememberedChild.get(parentId);
    rememberedChild.delete(parentId);
    const existeEncore = memorise !== undefined && layers.some((l) => l.id === memorise);
    // La sélection n'est rendue que si elle est restée sur le parent : c'est le
    // seul cas où l'utilisateur n'a rien choisi depuis le repli.
    const selection = existeEncore && selectedId === parentId ? memorise : selectedId;
    return { state: { collapsed, rememberedChild }, selectedId: selection };
  }

  collapsed.add(parentId);
  const parents = layerParentIds(layers);
  const indexSelection = selectedId === null ? -1 : layers.findIndex((l) => l.id === selectedId);
  const selectionDansLeGroupe = indexSelection >= 0 && parents[indexSelection] === parentId;
  if (selectionDansLeGroupe && selectedId !== null) {
    rememberedChild.set(parentId, selectedId);
    return { state: { collapsed, rememberedChild }, selectedId: parentId };
  }
  return { state: { collapsed, rememberedChild }, selectedId };
}

/**
 * Garde structurel, même forme que `reconcileIsolation` : une photo repliée
 * peut disparaître (suppression, undo, changement de document), et un enfant
 * mémorisé aussi. Sans ce nettoyage, l'état grossirait indéfiniment et un id
 * recyclé rouvrirait un groupe au hasard.
 *
 * Rend la MÊME référence quand rien ne doit bouger — c'est ce qui en fait un
 * no-op React dans le cas courant.
 */
export function reconcileCollapse(state: CollapseState, layerIds: readonly string[]): CollapseState {
  const vivants = new Set(layerIds);
  const collapsedMorts = [...state.collapsed].filter((id) => !vivants.has(id));
  const memoiresMortes = [...state.rememberedChild].filter(
    ([parent, enfant]) => !vivants.has(parent) || !vivants.has(enfant),
  );
  if (collapsedMorts.length === 0 && memoiresMortes.length === 0) return state;

  const collapsed = new Set(state.collapsed);
  for (const id of collapsedMorts) collapsed.delete(id);
  const rememberedChild = new Map(state.rememberedChild);
  for (const [parent] of memoiresMortes) rememberedChild.delete(parent);
  return { collapsed, rememberedChild };
}

/**
 * INDEX D'INSERTION MODÈLE depuis un index d'insertion parmi les lignes
 * VISIBLES — la pièce sans laquelle le repli casserait silencieusement le
 * glisser-déposer.
 *
 * POURQUOI ELLE EXISTE. `displayInsertToModelInsert` (layerDisplayOrder.ts) est
 * l'identité, et elle a le droit de l'être : elle suppose que la liste affichée
 * est la pile ENTIÈRE. Le repli rompt cette hypothèse — avec un groupe replié,
 * la position 2 de la liste n'est plus l'indice 2 du modèle. Rien n'aurait
 * rougi : le calque serait simplement atterri ailleurs que là où on l'a lâché,
 * d'autant plus loin que le groupe replié est gros.
 *
 * La conversion passe par les IDENTITÉS, jamais par une arithmétique d'indices :
 * insérer en position `d` des visibles veut dire « juste avant la ligne visible
 * qui s'y trouve », et cette ligne a un id dont le modèle connaît la place.
 *
 * ⚠️ CONSÉQUENCE VOULUE sur un groupe replié : lâcher juste sous sa photo place
 * le calque APRÈS tout le groupe, puisque la prochaine ligne VISIBLE est de
 * l'autre côté des enfants masqués. C'est ce qu'annonce l'écran — un groupe
 * replié est un bloc unique, et on ne peut pas viser l'intérieur de ce qu'on ne
 * voit pas.
 *
 * Les deux tableaux sont amputés du calque déplacé, sémantique de
 * `computeInsertIndex`/`reorderById` (`src/ui/dragReorder.ts`).
 */
export function visibleInsertToModelInsert(
  modelIds: readonly string[],
  visibleIds: readonly string[],
  draggedId: string,
  visibleInsert: number,
): number {
  const modeleAmpute = modelIds.filter((id) => id !== draggedId);
  const visiblesAmputes = visibleIds.filter((id) => id !== draggedId);

  // Au-delà de la dernière ligne visible : la fin du modèle, et pas la fin des
  // visibles — sinon un groupe replié en queue de pile avalerait l'insertion.
  if (visibleInsert >= visiblesAmputes.length) return modeleAmpute.length;

  const ancre = visiblesAmputes[visibleInsert];
  const index = modeleAmpute.indexOf(ancre);
  // Une ancre introuvable ne peut venir que d'un appel incohérent (visibles qui
  // ne sont pas un sous-ensemble du modèle) : on retombe sur la fin plutôt que
  // de rendre -1, qui insérerait silencieusement au mauvais bout.
  return index === -1 ? modeleAmpute.length : index;
}

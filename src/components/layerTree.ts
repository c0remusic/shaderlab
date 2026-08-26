import type { LayerState } from "../layers/types";
import { toDisplayOrder } from "./layerDisplayOrder";

/**
 * IMBRICATION DES EFFETS SOUS LEUR PHOTO — conversion pure
 * `pile modèle → lignes arborescentes`.
 *
 * DIVERGENCE ASSUMÉE d'avec Photoshop. La référence observée
 * (`docs/design-system/photoshop-web-observations-2026-07-27.md` §5ter)
 * n'indente RIEN, pas même un calque écrêté : elle se contente d'une flèche
 * coudée. Décision d'Antoine du 2026-07-28, prise en connaissance de cette
 * observation : shaderlab indente, parce que sa pile est une CHAÎNE DE
 * TRAITEMENT et que « quel effet s'applique à quelle photo » est la question
 * que l'utilisateur se pose. Ne pas « corriger » cette divergence vers
 * Photoshop.
 *
 * RÈGLE EN VIGUEUR (2026-07-29) — PROXIMITÉ, et depuis le 2026-08-21 elle est
 * la SEULE. **Un effet appartient à la photo qui le précède dans la chaîne.**
 * Une photo OUVRE son groupe ; tous les effets qui suivent lui appartiennent
 * jusqu'à la photo suivante. En espace modèle (indice supérieur = calque du
 * dessus) : le parent de `layers[i]` est la photo d'indice le plus élevé
 * strictement inférieur à `i`.
 *
 *  - Le FOND DU DOCUMENT est un calque photo COMME LES AUTRES depuis la tranche
 *    T1 (design 2026-07-28 §1.1) : il vit dans `layers`, la proximité le trouve
 *    toute seule, et ce module n'a plus rien à recevoir de l'extérieur. Le
 *    paramètre `backgroundId` et son id conventionnel `BACKGROUND_LAYER_ID` ont
 *    été RETIRÉS avec la ligne d'arrière-plan dérivée qu'ils servaient — ne pas
 *    les réintroduire : un id de fond hors modèle est précisément le statut
 *    spécial que cette tranche supprime.
 *  - Un effet placé SOUS toute photo (désormais possible : le fond se déplace)
 *    reste une ligne RACINE. Il ne traite aucune photo — il compose sur la
 *    toile vide, littéralement rien.
 *  - ⚠️ **L'ÉCRÊTAGE avait la priorité ici, et il est RETIRÉ** (ADR-0020,
 *    2026-08-21). Un effet écrêté nommait explicitement sa base par
 *    `clipBaseId`, et ce rattachement l'emportait sur la proximité — sauf
 *    écrêtage inerte, où l'on retombait déjà sur elle. La proximité était donc
 *    le cas général, elle est maintenant le seul cas : le retrait n'a rien
 *    laissé sans rattachement.
 *  - Un calque PHOTO est toujours une ligne racine.
 *
 * NUANCE ASSUMÉE, À NE PAS « CORRIGER ». Un effet NON écrêté s'applique en
 * réalité à TOUT le composite sous lui, pas à cette seule photo — l'imbrication
 * dit donc un peu plus que ce que le pipeline fait. C'est délibéré : l'affichage
 * privilégie la LISIBILITÉ DU GROUPE sur l'exactitude littérale. Décision
 * d'Antoine du 2026-07-29, prise après avoir vu la limite illustrée sur son
 * propre document. La règle précédente — n'imbriquer que quand la relation est
 * littéralement vraie, donc seulement s'il n'y a qu'UNE photo sous l'effet —
 * était exacte et illisible : sur un document réel (fond + Glow + Grain + photo
 * importée + un quatrième effet), une seule ligne sur quatre était indentée, les
 * deux effets posés sur le fond n'ayant aucune photo sous eux. Ne pas re-litiger
 * ce point dans le code ; le rouvrir demande de rouvrir la décision.
 *
 * SÉPARATION STRICTE rattachement / sens d'affichage. Le RATTACHEMENT
 * (`layerParentIds`) raisonne exclusivement en espace MODÈLE : indices du
 * tableau `layers`, où l'indice supérieur est le calque du DESSUS
 * (`src/layers/layerStack.ts`). Il ne sait rien du sens vertical de la liste.
 * Le SENS reste entièrement l'affaire de `layerDisplayOrder.ts`, appliqué ici
 * en une seule ligne. Cette séparation a déjà servi : le 2026-07-28 l'ADR-0004
 * a renversé le sens fixé la veille par l'ADR-0003, et ce module n'a eu à
 * changer que ses commentaires. Le sens en vigueur est CAUSAL — la photo
 * parente OUVRE son groupe par le haut, ses effets rattachés sont EN DESSOUS
 * d'elle, dans l'ordre où ils la traitent.
 *
 * L'ORDRE des lignes est EXACTEMENT `toDisplayOrder(layers)` — l'imbrication est
 * une profondeur portée par la ligne, jamais un tri. C'est ce qui garantit que
 * `data-layer-row-index` reste l'index d'affichage attendu par
 * `displayInsertToModelInsert` : le glisser-déposer, le modèle et l'ordre
 * d'exécution sont inchangés (test/components/layerTree.test.ts).
 *
 * Cette invariance n'est pas fortuite : la règle de proximité découpe la pile en
 * TRANCHES contiguës — chaque photo ouvre la sienne et la garde jusqu'à la photo
 * suivante — et le groupe du fond est la tranche qui précède la première photo.
 * Aucun groupe ne peut donc être discontinu, et comparer au voisin immédiat
 * suffit pour en trouver les bornes.
 */
export interface LayerTreeRow {
  layer: LayerState;
  /** 0 = ligne racine · 1 = ligne imbriquée sous une photo. Un seul niveau : la
   *  relation modélisée est « effet → photo », elle ne se compose pas. */
  depth: 0 | 1;
  /** Id de la photo parente (`depth === 1`), sinon `null`. */
  parentId: string | null;
  /** Bornes du groupe en ordre d'AFFICHAGE, pour le filet vertical. Ce sont des
   *  bornes de POSITION dans la liste, pas des rôles : `firstChild` est la
   *  ligne enfant la plus HAUTE, `lastChild` la plus BASSE, quel que soit le
   *  sens en vigueur. Depuis l'ADR-0004 la photo parente est AU-DESSUS de son
   *  groupe, donc c'est `firstChild` qui la touche et dont le filet doit
   *  remonter jusqu'à elle (voir `.layer-panel__rail--first`, LayerPanel.css).
   *  Calculées ici plutôt que devinées en CSS — `:has()` ne sait pas exprimer
   *  « même parent que la ligne précédente ». */
  firstChild: boolean;
  lastChild: boolean;
}

/**
 * RATTACHEMENT, en espace MODÈLE uniquement. Pour chaque `layers[i]`, l'id de
 * la photo à laquelle il appartient, ou `null`. Aucune notion de haut/bas de
 * LISTE ici : « en dessous » veut dire « d'indice inférieur dans `layers` »,
 * c'est-à-dire appliqué plus tôt dans le pipeline.
 *
 * Exportée et testée seule (test/components/layerTree.test.ts) pour que le sens
 * d'affichage puisse changer sans toucher à cette décision.
 */
export function layerParentIds(layers: LayerState[]): Array<string | null> {
  return layers.map((_, index) => resolveParentId(layers, index));
}

/** Photo à laquelle `layers[index]` appartient, ou `null`. */
function resolveParentId(layers: LayerState[], index: number): string | null {
  const layer = layers[index];
  // Une photo n'est jamais imbriquée : elle est le contenu, pas un traitement.
  // Elle n'est pas non plus rattachée au fond — elle OUVRE son propre groupe.
  if (layer.imageSource !== undefined) return null;

  // PROXIMITÉ : la première photo rencontrée en descendant, c'est-à-dire celle
  // d'indice le plus élevé strictement inférieur à `index`.
  for (let i = index - 1; i >= 0; i--) {
    if (layers[i].imageSource !== undefined) return layers[i].id;
  }
  // Aucun calque photo avant lui : il n'y a que la toile vide en dessous —
  // aucun parent à désigner, la ligne reste racine.
  return null;
}

/** Lignes de la liste des effets, dans l'ordre d'AFFICHAGE, chacune portant sa
 *  profondeur et son rattachement. Ne mute jamais `layers`.
 *
 *  UNIQUE point où le rattachement (espace modèle) rencontre le sens
 *  d'affichage : le `toDisplayOrder` ci-dessous. Les bornes de filet
 *  (`firstChild`/`lastChild`) sont volontairement calculées APRÈS, en espace
 *  d'affichage — ce sont des bornes VISUELLES, elles doivent suivre le sens de
 *  la liste si celui-ci change. */
export function toLayerTreeRows(layers: LayerState[]): LayerTreeRow[] {
  const parentByIndex = layerParentIds(layers);
  const display = toDisplayOrder(layers.map((layer, index) => ({ layer, parentId: parentByIndex[index] })));
  return display.map((entry, row) => ({
    layer: entry.layer,
    depth: entry.parentId === null ? 0 : 1,
    parentId: entry.parentId,
    // Un groupe étant contigu, comparer au voisin immédiat suffit. `null`
    // (racine) ne forme jamais de groupe : les deux bornes y sont fausses.
    firstChild: entry.parentId !== null && display[row - 1]?.parentId !== entry.parentId,
    lastChild: entry.parentId !== null && display[row + 1]?.parentId !== entry.parentId,
  }));
}

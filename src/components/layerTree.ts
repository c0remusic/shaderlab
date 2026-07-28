import type { LayerState } from "../layers/types";
import { clipBaseId } from "../layers/clipping";
import { toDisplayOrder } from "./layerDisplayOrder";

/**
 * IMBRICATION DES EFFETS SOUS LEUR PHOTO (2026-07-28) — conversion pure
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
 * Le prix de cette divergence est une règle de VÉRITÉ stricte : une ligne n'est
 * imbriquée que quand la relation « cet effet s'applique à cette photo » est
 * LITTÉRALEMENT vraie.
 *
 *  - Un effet ÉCRÊTÉ (`clipToBelow`) nomme sa base : il ne rend que là où une
 *    photo couvre l'image. Il s'imbrique sous elle, quel que soit le nombre de
 *    photos plus bas. Sauf écrêtage INERTE (aucune base photo sous lui —
 *    `resolveClipping` le fait alors rendre linéairement) : on retombe sur la
 *    règle du non-écrêté, sinon la ligne désignerait une base inexistante.
 *  - Un effet NON écrêté ne dépend d'aucune photo en particulier : il s'applique
 *    à TOUT le composite en dessous. Il ne s'imbrique donc que s'il n'y a
 *    qu'UNE SEULE photo sous lui — auquel cas « tout le composite » ET « cette
 *    photo » désignent la même chose. Deux photos ou plus : il reste à plat.
 *  - Un effet à plat qui touche plusieurs photos ne porte AUCUN marquage. Pas
 *    de filet, pas de badge, pas de libellé de portée : Photoshop ne signale
 *    jamais le cas normal, et nommer « les deux photos » serait une invention.
 *  - Un calque PHOTO est toujours une ligne racine (l'écrêtage lui est interdit,
 *    garde dans `LayerStack.setLayerClip`).
 *
 * SÉPARATION STRICTE rattachement / sens d'affichage. Le RATTACHEMENT
 * (`layerParentIds`) raisonne exclusivement en espace MODÈLE : indices du
 * tableau `layers`, où l'indice supérieur est le calque du DESSUS
 * (`src/layers/layerStack.ts`). Il ne sait rien du sens vertical de la liste.
 * Le SENS reste entièrement l'affaire de `layerDisplayOrder.ts`, appliqué ici
 * en une seule ligne. Si le sens d'affichage était un jour inversé
 * (l'ADR-0003 fixe aujourd'hui le sens Photoshop : la photo de fond FERME la
 * liste par le bas, ses effets rattachés sont AU-DESSUS d'elle), seule cette
 * frontière bougerait — le rattachement survivrait intact.
 *
 * L'ORDRE des lignes est EXACTEMENT `toDisplayOrder(layers)` — l'imbrication est
 * une profondeur portée par la ligne, jamais un tri. C'est ce qui garantit que
 * `data-layer-row-index` reste l'index d'affichage attendu par
 * `displayInsertToModelInsert` : le glisser-déposer, le modèle et l'ordre
 * d'exécution sont inchangés (test/components/layerTree.test.ts).
 *
 * Cette invariance n'est pas fortuite : les enfants d'une photo sont toujours
 * CONTIGUS juste au-dessus d'elle dans le modèle. Entre deux photos, tout effet
 * a la même photo sous lui (donc le même parent) ; au-dessus de la photo la plus
 * haute, tout effet non écrêté en compte au moins deux (donc reste racine).
 */
export interface LayerTreeRow {
  layer: LayerState;
  /** 0 = ligne racine · 1 = ligne imbriquée sous une photo. Un seul niveau : la
   *  relation modélisée est « effet → photo », elle ne se compose pas. */
  depth: 0 | 1;
  /** Id de la photo parente (`depth === 1`), sinon `null`. */
  parentId: string | null;
  /** Bornes du groupe en ordre d'AFFICHAGE, pour le filet vertical : le filet
   *  démarre à la première ligne enfant et descend jusqu'à la photo parente,
   *  qui est juste sous la dernière. Calculées ici plutôt que devinées en CSS —
   *  `:has()` ne sait pas exprimer « même parent que la ligne précédente ». */
  firstChild: boolean;
  lastChild: boolean;
}

/**
 * RATTACHEMENT, en espace MODÈLE uniquement. Pour chaque `layers[i]`, l'id de
 * la photo à laquelle il s'applique littéralement, ou `null`. Aucune notion de
 * haut/bas de LISTE ici : « en dessous » veut dire « d'indice inférieur dans
 * `layers` », c'est-à-dire appliqué plus tôt dans le pipeline.
 *
 * Exportée et testée seule (test/components/layerTree.test.ts) pour que le sens
 * d'affichage puisse changer sans toucher à cette décision.
 */
export function layerParentIds(layers: LayerState[]): Array<string | null> {
  return layers.map((_, index) => resolveParentId(layers, index));
}

/** Photo à laquelle `layers[index]` s'applique LITTÉRALEMENT, ou `null`. */
function resolveParentId(layers: LayerState[], index: number): string | null {
  const layer = layers[index];
  // Une photo n'est jamais imbriquée : elle est le contenu, pas un traitement.
  if (layer.imageSource !== undefined) return null;

  if (layer.clipToBelow) {
    const baseId = clipBaseId(layers, layer.id);
    const base = baseId === null ? undefined : layers.find((l) => l.id === baseId);
    // Base photo trouvée = l'écrêtage est effectif (`active`/`suppressed`).
    // Sinon `inert` : on ne retourne pas ici, on retombe sur la règle ci-dessous.
    if (base?.imageSource !== undefined) return base.id;
  }

  let onlyPhotoId: string | null = null;
  let photoCount = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (layers[i].imageSource === undefined) continue;
    photoCount++;
    if (photoCount > 1) return null;
    onlyPhotoId = layers[i].id;
  }
  return photoCount === 1 ? onlyPhotoId : null;
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

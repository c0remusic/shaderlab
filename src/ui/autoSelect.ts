import type { LayerState } from "../layers/types";
import type { LayerMask, MaskSource } from "../mask/types";
import { compositeUvToPhotoUv, type PixelPoint, type PixelSize } from "./transform";
import type { PhotoSizeLookup } from "./hitTest";
import { planFold } from "../mask/foldPlan";

/**
 * SÉLECTION AUTOMATIQUE AU CLIC (ticket 26) — le calque le plus haut qui COUVRE
 * un pixel de la toile, TOUS genres confondus. C'est l'« Auto-Select » de
 * Photoshop, actif seulement quand la case de la barre du Déplacer est cochée
 * (défaut OFF).
 *
 * ── EN QUOI IL DIFFÈRE DE `hitTestPhotoLayer` (`ui/hitTest.ts`) ──────────────
 *
 * Ce n'est PAS une extension du hit-test de désignation photo, et fondre les
 * deux perdrait ce qui les sépare :
 *
 *  1. **Il voit TOUS les calques**, pas seulement les photos. Un calque d'effet
 *     est couvert là où son MASQUE est non nul — le masque EST le canal alpha
 *     d'un calque d'effet (verrous, 2026-08-19) — et un calque sans masque
 *     couvre partout.
 *  2. **Un calque verrouillé RESTE sélectionnable.** `hitTestPhotoLayer` rend un
 *     verrouillé transparent au clic (règle 3 de son en-tête, 2026-08-17), pour
 *     qu'un fond verrouillé ne vole pas la sélection du travail au-dessus. Ici
 *     l'intention est l'inverse et arbitrée dans le ticket : sélectionner n'est
 *     pas modifier, et le déverrouillage doit rester atteignable — donc les
 *     verrous ne sont PAS consultés. Le MOUVEMENT, lui, reste refusé au calque
 *     verrouillé, mais c'est le geste qui le refuse (App), pas la sélection.
 *
 * Restent communs, parce que ce sont des règles d'usage et non de mécanisme :
 *  - **invisible = non sélectionnable** (œil éteint), on ne désigne pas ce qu'on
 *    ne voit pas ;
 *  - **parcours du HAUT affiché vers le BAS**, premier couvrant gagne (repère
 *    ADR-0004 : `index 0 = bas de pile`, donc de la FIN vers le début).
 *
 * ── CE QUI EST CALCULABLE CÔTÉ CPU, ET CE QUI NE L'EST PAS ───────────────────
 *
 * Seules les sources PINCEAU portent un raster côté CPU (`BrushMaskSource.raster`,
 * dans l'espace de la photo de FOND). Les sources paramétriques (dégradé,
 * luminosité, plage de couleur, forme) sont calculées par une passe GPU : leur
 * alpha au pixel n'est pas lisible ici sans readback. Le choix, conservateur et
 * documenté : un calque dont le fold contient AU MOINS une source paramétrique
 * est traité comme couvrant partout — auto-select doit désigner le calque du
 * dessus visible, pas échouer parce qu'un masque GPU coûte cher à évaluer. Le
 * seul cas où ça sur-sélectionne (un pinceau puis un paramétrique en soustraction,
 * ou une inversion sur un paramétrique seul) est rare et penche du bon côté :
 * sélectionnable plutôt qu'inatteignable.
 *
 * ⚠️ Ce module lit les rasters PINCEAU COMMITTÉS de la pile passée en argument,
 * qui doit donc être la pile COMPLÈTE (`DocumentSession.layers()`), jamais la
 * projection d'affichage — cette dernière vide les rasters (`displayProjection`,
 * invariant anti-OOM). Le raster vivant en cours de trait vit dans `MaskPainter`,
 * mais l'auto-select agit hors peinture (outil Déplacer) : l'état committé est la
 * bonne source, et c'est le seul qui couvre TOUS les calques, pas seulement le
 * sélectionné.
 *
 * Fonction PURE : aucune lecture GPU, aucun état, testable en env Node — même
 * convention que `hitTest.ts`, `effectMove.ts`, `tools.ts`.
 */

/** Valeur 0..255 d'une source pinceau au pixel `(ix, iy)` de la photo de fond.
 *  Un raster absent, vidé (projection d'affichage) ou trop court rend 0 — la
 *  même sémantique qu'« aucune couverture ici », jamais une lecture hors bornes. */
function brushValueAt(source: MaskSource, idx: number): number {
  if (source.type !== "brush") return 0;
  const raster = source.raster;
  if (!raster || idx < 0 || idx >= raster.length) return 0;
  return raster[idx];
}

/**
 * Ce calque d'effet couvre-t-il le pixel `(ix, iy)` (repère de la photo de fond) ?
 *
 * Reproduit le fold du masque tel que le GPU le compose (`foldPlan.planFold`
 * pour l'ordre et le seed, `maskFoldWgsl` pour les opérateurs de combinaison et
 * l'inversion) — sur les seules sources PINCEAU. Voir l'en-tête pour le
 * traitement des sources paramétriques.
 */
function effectCoversAt(mask: LayerMask, idx: number): boolean {
  const sources = planFold(mask);
  // Masque désactivé ou aucune source active : l'effet s'applique pleinement,
  // donc il couvre partout (l'appelant substitue un masque PLEIN, cf. planFold).
  if (sources.length === 0) return true;
  // Au moins une source paramétrique dans le fold : non évaluable au CPU, on
  // penche vers « couvre » (voir l'en-tête).
  if (sources.some((source) => source.type !== "brush")) return true;

  // Fold PINCEAU : la 1ère source est le SEED (son combineMode est ignoré),
  // les suivantes s'appliquent dans l'ordre — mêmes opérateurs que
  // `buildCombineWgsl` : add=max, subtract=clamp(a-b), intersect=min.
  let acc = brushValueAt(sources[0], idx);
  for (let i = 1; i < sources.length; i += 1) {
    const b = brushValueAt(sources[i], idx);
    const mode = sources[i].combineMode;
    acc = mode === "add" ? Math.max(acc, b) : mode === "subtract" ? Math.max(0, acc - b) : Math.min(acc, b);
  }
  if (mask.invert) acc = 255 - acc;
  return acc > 0;
}

/**
 * Calque désigné par un clic quand la Sélection auto est active, ou `null` si le
 * clic tombe dans le vide.
 *
 * `point` est en PIXELS DE LA TOILE (= repère `LayerTransform.x/y` et espace des
 * rasters de masque), ce que rend `Canvas.toImageCoords`. `layers` est la pile
 * COMPLÈTE dans l'ordre du MODÈLE (index 0 = bas de pile), avec ses rasters
 * pinceau — voir l'en-tête.
 */
export function hitTestAutoSelect(
  layers: readonly LayerState[],
  point: PixelPoint,
  bgSize: PixelSize,
  photoSizeOf: PhotoSizeLookup,
): string | null {
  // Mêmes gardes dégénérées que `hitTestPhotoLayer` : une toile nulle ou un
  // point non fini produirait un UV NaN et un faux HIT silencieux.
  if (!(bgSize.width > 0) || !(bgSize.height > 0)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const compositeUv = { u: point.x / bgSize.width, v: point.y / bgSize.height };
  const ix = Math.floor(point.x);
  const iy = Math.floor(point.y);
  const dansToile = ix >= 0 && iy >= 0 && ix < bgSize.width && iy < bgSize.height;
  const idx = dansToile ? iy * bgSize.width + ix : -1;

  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    // Invisible = non sélectionnable (règle commune avec `hitTestPhotoLayer`).
    // Les verrous, eux, ne sont PAS consultés — un verrouillé reste sélectionnable.
    if (!layer.enabled) continue;

    if (layer.imageSource && layer.transform) {
      const photoSize = photoSizeOf(layer.imageSource.sourceId);
      if (!photoSize || !(photoSize.width > 0) || !(photoSize.height > 0)) continue;
      if (compositeUvToPhotoUv(compositeUv, bgSize, layer.transform, photoSize) !== null) {
        return layer.id;
      }
      continue;
    }

    // Calque d'effet : couvert là où le masque est non nul, hors de la toile
    // rien n'est couvert (un clic hors du document ne saisit aucun effet).
    if (dansToile && effectCoversAt(layer.mask, idx)) return layer.id;
  }
  return null;
}

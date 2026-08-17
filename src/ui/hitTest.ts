import type { LayerState } from "../layers/types";
import { compositeUvToPhotoUv, type PixelPoint, type PixelSize } from "./transform";

/** Taille en pixels de la photo SOURCE d'un `sourceId`, ou `null` si elle
 *  n'est pas (encore) connue. L'implémentation réelle est
 *  `PhotoSourceStore.dimensions` (`src/render/`) — passée en paramètre, jamais
 *  importée : c'est ce qui garde ce module pur et testable en Node, sans GPU. */
export type PhotoSizeLookup = (sourceId: string) => PixelSize | null;

/**
 * Calque photo désigné par un clic sur la toile, ou `null` si le clic tombe
 * dans le vide (design `2026-07-29-shaderlab-toile-de-montage-design.md` §2.3
 * et T1).
 *
 * `point` est en PIXELS DE LA TOILE (mêmes coordonnées que
 * `LayerTransform.x/y`, origine haut-gauche) — c'est exactement ce que rend
 * `Canvas.toImageCoords`. `layers` est la pile dans l'ordre du MODÈLE :
 * **index 0 = bas de pile** (même convention que `bottomPhotoSourceId`,
 * `src/layers/photoLayer.ts`), donc le parcours va de la FIN vers le début —
 * du haut vers le bas, comme le regard.
 *
 * Le prédicat « ce clic est-il sur cette image ? » n'est pas réinventé ici :
 * c'est le `null` de `compositeUvToPhotoUv` (`transform.ts:62-64`), la MÊME
 * fonction que le rendu utilise pour décider si un pixel appartient à la
 * photo. Une seule source de vérité pour « dedans/dehors ».
 *
 * Trois règles d'usage, tranchées dans la tranche T1 :
 * 1. **Géométrie stricte.** La couverture sub-pixel du rendu (rampe d'un
 *    demi-pixel, `render/photoLayerInput.ts`) n'ouvre aucune zone de
 *    tolérance : un seuil serait un réglage invisible à l'échelle
 *    d'affichage, et ferait divergemment deux définitions du bord.
 * 2. **Un calque à l'œil éteint n'est pas saisissable** : on ne désigne pas ce
 *    qu'on ne voit pas, et le clic doit atteindre le calque visible en dessous.
 * 3. **Un calque VERROUILLÉ n'est pas saisissable non plus** — corrigé le
 *    2026-08-17 sur signalement d'Antoine (« le lock de calque ne permet pas de
 *    lock la sélection d'un calque/d'une photo »).
 *
 *    ⚠️ CETTE RÈGLE DISAIT L'INVERSE, et sa justification était fausse. Elle
 *    tenait en une phrase : « sélectionner n'est pas muter, et c'est le seul
 *    chemin vers son déverrouillage ». Le second membre ne tient pas — le
 *    bouton de verrou vit dans la LIGNE du panneau de pile (`LayerPanel`), qui
 *    est le chemin normal et le seul que Photoshop offre. Le premier membre est
 *    vrai et hors sujet : le problème n'est pas qu'on mute le calque, c'est
 *    qu'on le SÉLECTIONNE en visant autre chose.
 *
 *    Le cas d'usage que ça casse est exactement celui du verrou : une photo de
 *    fond verrouillée, du travail au-dessus, et chaque clic qui rate son calque
 *    tombe sur le fond — la sélection saute, le panneau change, et il faut
 *    revenir. Un verrou qui laisse ça arriver ne verrouille pas ce pour quoi on
 *    le pose.
 *
 *    Corollaire à ne pas perdre : le clic CONTINUE de descendre la pile. Un
 *    calque verrouillé n'absorbe pas le clic, il devient transparent pour lui —
 *    c'est ce qui permet d'attraper un calque situé DESSOUS un fond verrouillé.
 *
 * Fonction PURE : aucune lecture GPU, aucun raster, aucun état. L'alternative
 * « rendre un buffer d'identifiants au GPU » est écartée (§10.4).
 */
export function hitTestPhotoLayer(
  layers: readonly LayerState[],
  point: PixelPoint,
  bgSize: PixelSize,
  photoSizeOf: PhotoSizeLookup,
): string | null {
  // Toile de taille nulle (aucun document) ou point non fini : sans cette
  // garde, la division produit un UV NaN, dont aucune comparaison de borne
  // n'est vraie — `compositeUvToPhotoUv` rendrait un point NaN, soit un faux
  // HIT silencieux sur le premier calque photo rencontré.
  if (!(bgSize.width > 0) || !(bgSize.height > 0)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const compositeUv = { u: point.x / bgSize.width, v: point.y / bgSize.height };

  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (!layer.imageSource || !layer.transform) continue;
    if (!layer.enabled) continue;
    // Verrouillé : transparent au clic, exactement comme un calque éteint. Voir
    // la règle 3 de l'en-tête — et le `continue` plutôt qu'un `return null` est
    // le point : le clic passe au travers et atteint ce qui est dessous.
    if (layer.locked === true) continue;
    const photoSize = photoSizeOf(layer.imageSource.sourceId);
    // Taille inconnue ou dégénérée : on ne peut pas décider, on n'invente pas
    // un hit — le clic continue de descendre la pile.
    if (!photoSize || !(photoSize.width > 0) || !(photoSize.height > 0)) continue;
    if (compositeUvToPhotoUv(compositeUv, bgSize, layer.transform, photoSize) !== null) {
      return layer.id;
    }
  }
  return null;
}

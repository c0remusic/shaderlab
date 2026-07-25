import type { LayerMask } from "../mask/types";

/** Référence sérialisable vers la texture GPU d'une photo importée (double
 *  exposure, ARCHITECTURE.md §4.2) — ne contient JAMAIS la texture
 *  elle-même. `sourceId` est résolu par `PhotoSourceStore` (src/render/),
 *  hors state React et hors historique. */
export interface ImageSourceRef {
  sourceId: string;
}

/** Position/échelle/rotation d'un calque de photo, en coordonnées PIXELS
 *  de la photo de FOND (origine haut-gauche), pas de la photo elle-même —
 *  `(x, y)` est le centre de la photo transformée. `rotation` en radians. */
export interface LayerTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface LayerState {
  id: string;
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  /** Opacité du calque (0..1). 1 = effet à pleine force. */
  opacity: number;
  /** Id du mode de fusion (registry blend). "normal" = remplacement (compat). */
  blendMode: string;
  /** Masque non-destructif du calque (design.md §3). Les rasters qu'il
   *  contient sont IMMUABLES par convention (toujours REMPLACÉS, jamais
   *  mutés en place) — clone() et l'historique partagent ces références. */
  mask: LayerMask;
  /** Double exposure (2026-07-25). Présent ssi ce calque porte une photo
   *  importée (silhouette) plutôt que de traiter la photo de base du
   *  document. `imageSource`/`transform` sont TOUJOURS présents ensemble ou
   *  absents ensemble (posés une seule fois par `LayerStack.addPhotoLayer`,
   *  jamais l'un sans l'autre). */
  imageSource?: ImageSourceRef;
  transform?: LayerTransform;
}

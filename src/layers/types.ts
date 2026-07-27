import type { LayerMask } from "../mask/types";

/** Référence sérialisable vers la texture GPU d'une photo importée (double
 *  exposure, ARCHITECTURE.md §4.2) — ne contient JAMAIS la texture
 *  elle-même. `sourceId` est résolu par `PhotoSourceStore` (src/render/),
 *  hors state React et hors historique. */
export interface ImageSourceRef {
  sourceId: string;
}

/** Rectangle de recadrage d'un calque photo, en PIXELS de la photo SOURCE
 *  (entiers, origine haut-gauche de la photo). Introduit en T1 parce que
 *  `CanvasMode` (src/ui/canvasMode.ts) doit pouvoir mémoriser le crop
 *  d'entrée de son mode ; le champ `crop` de `LayerTransform` et la
 *  géométrie associée arrivent en T4 (design
 *  `2026-07-26-shaderlab-photo-layer-parity-design.md` §3.1). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  /** Nom affiché du calque (parité calque photo, T1). Générique — pas
   *  réservé aux calques photo : l'affichage retombe sur le nom de l'effet
   *  quand il est absent (`LayerPanel`). Alimenté par le basename du fichier
   *  à l'import d'une photo. Champ SCALAIRE, donc présent dans chaque
   *  snapshot d'historique par construction (survie à l'undo automatique) et
   *  sans risque pour l'invariant OOM. */
  name?: string;
  /** Écrêtage (clipping, 2026-07-27) : cet effet ne s'applique QUE là où le
   *  calque photo situé en dessous couvre l'image. Absent/false =
   *  comportement linéaire (défaut historique : l'effet s'applique au
   *  composite complet en dessous). INTERDIT sur un calque portant
   *  `imageSource` — la garde vit dans `LayerStack.setLayerClip`, unique
   *  chemin d'écriture. Résolution : `layers/clipping.ts`.
   *  Champ SCALAIRE : présent par construction dans chaque snapshot
   *  d'historique, aucun risque pour l'invariant OOM. */
  clipToBelow?: boolean;
}

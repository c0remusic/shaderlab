import type { LayerState } from "./types";

/** Limite dure v1 (PRD "Double exposure") : 2 photos sources max par
 *  document = la photo de fond (toujours 1, hors modèle `LayerState` — elle
 *  vit dans `ImageFrameResources.sourceTexture`) + au plus UNE silhouette
 *  importée comme calque de photo. Garde applicative NOMMÉE et vérifiable,
 *  jamais codée en dur dans `LayerStack` ou le shader — voir
 *  ARCHITECTURE.md §5 "N sources d'image". */
export const MAX_PHOTO_LAYERS = 1;

export function countPhotoLayers(layers: LayerState[]): number {
  return layers.filter((layer) => layer.imageSource !== undefined).length;
}

export function canAddPhotoLayer(layers: LayerState[]): boolean {
  return countPhotoLayers(layers) < MAX_PHOTO_LAYERS;
}

/** Prédicat pur : au moins un calque de photo dans le document — désactive
 *  le round-trip Lightroom pour cet export (ARCHITECTURE.md §4.6, PRD
 *  "Double exposure"). Vit ici (pas dans export/exportImage.ts) pour rester
 *  une seule source de vérité réutilisée par la limite d'import ET par la
 *  bascule d'export. */
export function hasPhotoLayer(layers: LayerState[]): boolean {
  return countPhotoLayers(layers) > 0;
}

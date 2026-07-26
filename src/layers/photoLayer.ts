import type { LayerState } from "./types";

/** Plafond de calques photo par document — la photo de FOND n'en fait pas
 *  partie (elle est hors modèle `LayerState`, elle vit dans
 *  `ImageFrameResources.sourceTexture`). Garde applicative NOMMÉE et
 *  vérifiable, jamais codée en dur dans `LayerStack` ou le shader — voir
 *  ARCHITECTURE.md §5 "N sources d'image".
 *
 *  Valeur retenue : 4. Base factuelle (design
 *  `2026-07-26-shaderlab-photo-layer-parity-design.md` §3.5) : la seule
 *  mesure disponible est ~1280 Mo avec 2 photos 26 MP et 3 calques dont un
 *  calque photo (`.claude/learning-log.md:1060-1072`), sans
 *  `device.lost`, et elle n'est PAS décomposée — aucune extrapolation
 *  linéaire n'est légitime. Ce que le code permet d'affirmer : chaque calque
 *  photo supplémentaire ajoute UNE texture source
 *  (`photoW × photoH × 4` ≈ 96 Mo à 24 MP, `render/photoSourceStore.ts`) et
 *  ZÉRO cible pleine taille supplémentaire, la cible de résolution étant
 *  partagée (`render/photoLayerInput.ts`, invariant d'ordre des passes).
 *  4 est donc un pas mesurable (≈ +3 textures sources sur la mesure
 *  existante), pas une limite théorique.
 *
 *  ⚠️ CRITÈRE DE RÉVISION — mesure VRAM RÉELLE à 4 × 24 MP encore À FAIRE
 *  (elle exige une vraie fenêtre WebView2 avec GPU : impossible en session
 *  headless / test Node). Réviser cette valeur, ET
 *  `MAX_REGISTERED_PHOTO_SOURCES` qui en dérive, dès que la mesure est
 *  relevée, ou si un `device.lost` est observé sous ce plafond. */
export const MAX_PHOTO_LAYERS = 4;

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

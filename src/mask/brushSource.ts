import type { LayerState } from "../layers/types";

/** Le raster de LA source pinceau d'un calque. En Tranche 2, un calque porte
 *  au plus une source `"brush"` (auto-créée à la 1ère touche de pinceau,
 *  `LayerStack.updateBrushMask`) — le modèle admet N sources mais aucune UI
 *  n'existe encore pour en ajouter une 2e (Tranche 4). `null` si le calque
 *  n'a jamais été peint. Point d'accès UNIQUE au raster pinceau, pour que
 *  renderer.ts/App.tsx n'aient qu'un seul endroit à changer si ce mapping
 *  évolue (ex. plusieurs sources pinceau en Tranche 3+). */
export function getBrushRaster(layer: LayerState): Uint8Array | null {
  return layer.mask.sources.find((s) => s.type === "brush")?.raster ?? null;
}

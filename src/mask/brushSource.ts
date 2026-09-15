import type { LayerState } from "../layers/types";

/** Le raster de LA source pinceau d'un calque. En Tranche 2, un calque porte
 *  au plus une source `"brush"` (auto-créée à la 1ère touche de pinceau,
 *  `LayerStack.updateBrushMask`) — le modèle admet N sources mais aucune UI
 *  n'existe encore pour en ajouter une 2e (Tranche 4). `null` si le calque
 *  n'a jamais été peint.
 *
 *  ⚠️ Cet en-tête annonçait un « point d'accès UNIQUE … pour que
 *  renderer.ts/App.tsx n'aient qu'un seul endroit à changer ». Mesuré le
 *  2026-09-15 : `renderer.ts` ne l'importe pas, et il n'a que DEUX sites
 *  d'appel, tous deux dans `App.tsx`. La phrase nommait un consommateur qui
 *  n'a jamais existé. Ce qui reste vrai : un seul endroit sait où trouver le
 *  raster pinceau d'un calque, ce qui vaudra le jour où un calque en portera
 *  plusieurs. */
export function getBrushRaster(layer: LayerState): Uint8Array | null {
  return layer.mask.sources.find((s) => s.type === "brush")?.raster ?? null;
}

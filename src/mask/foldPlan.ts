import type { LayerMask, MaskSource, CombineMode } from "./types";

/**
 * Ordre de fold (design.md §4) : la 1ère source de la liste retournée est le
 * SEED — son `combineMode` doit être IGNORÉ par l'appelant (l'accumulateur
 * ne part pas de 0, sinon une 1ère source en subtract/intersect donnerait un
 * masque nul partout). Les suivantes s'appliquent dans l'ordre avec leur
 * `combineMode` propre. `mask.enabled === false`, ou aucune source
 * `enabled` avec un `raster`, retourne `[]` — l'appelant doit alors
 * substituer un masque PLEIN (255 partout), jamais un masque nul silencieux.
 */
export function planFold(mask: LayerMask): MaskSource[] {
  if (!mask.enabled) return [];
  return mask.sources.filter((s) => s.enabled && s.raster !== null);
}

export interface FoldSourceSnapshot {
  id: string;
  raster: Uint8Array | null;
  combineMode: CombineMode;
}

/**
 * Signature d'invalidation du fold courant, comparable par `foldInputsEqual`.
 * Les rasters sont immuables par convention (toujours remplacés, jamais
 * mutés en place — `LayerStack.updateBrushMask`), donc une comparaison par
 * RÉFÉRENCE suffit à détecter un changement réel, même principe que
 * `syncedFrom === layer.maskData` dans le renderer aujourd'hui.
 */
export function snapshotFoldInputs(mask: LayerMask): FoldSourceSnapshot[] {
  return planFold(mask).map((s) => ({ id: s.id, raster: s.raster, combineMode: s.combineMode }));
}

export function foldInputsEqual(a: FoldSourceSnapshot[], b: FoldSourceSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i].id && s.raster === b[i].raster && s.combineMode === b[i].combineMode);
}

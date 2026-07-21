import type { LayerMask, MaskSource, CombineMode, MaskSourceType, MaskSourceParams } from "./types";

/**
 * Ordre de fold (design.md §4) : la 1ère source de la liste retournée est le
 * SEED — son `combineMode` doit être IGNORÉ par l'appelant (l'accumulateur
 * ne part pas de 0, sinon une 1ère source en subtract/intersect donnerait un
 * masque nul partout). Les suivantes s'appliquent dans l'ordre avec leur
 * `combineMode` propre.
 *
 * Couvre TOUTE source `enabled` — pinceau (raster) ET paramétrique (params),
 * pas seulement celles porteuses d'un `raster`. Avant cette tâche, le filtre
 * excluait `s.raster === null`, ce qui bannissait silencieusement TOUTE
 * source paramétrique du fold (leur `raster` est toujours `null` par
 * construction, voir mask/types.ts) alors que `MaskTextureResolver.resident()`
 * sait déjà les générer — un bug réel, pas une limitation documentée.
 *
 * `mask.enabled === false`, ou aucune source `enabled`, retourne `[]` —
 * l'appelant doit alors substituer un masque PLEIN (255 partout), jamais un
 * masque nul silencieux.
 */
export function planFold(mask: LayerMask): MaskSource[] {
  if (!mask.enabled) return [];
  return mask.sources.filter((s) => s.enabled);
}

export interface FoldSourceSnapshot {
  id: string;
  type: MaskSourceType;
  enabled: boolean;
  combineMode: CombineMode;
  raster: Uint8Array | null;
  params: MaskSourceParams | null;
}

/**
 * Signature d'invalidation du fold courant, comparable par `foldInputsEqual`.
 * Les rasters sont immuables par convention (toujours remplacés, jamais
 * mutés en place — `LayerStack.updateBrushMask`), donc une comparaison par
 * RÉFÉRENCE suffit à détecter un changement réel, même principe que
 * `MaskPainterEntry.syncedFrom` dans `maskPainterSync.ts`. `params` suit la
 * même convention : `LayerStack.updateMaskSourceParams` remplace toujours
 * l'objet (jamais de mutation en place), donc la référence suffit aussi.
 */
export function snapshotFoldInputs(mask: LayerMask): FoldSourceSnapshot[] {
  return planFold(mask).map((s) => ({
    id: s.id,
    type: s.type,
    enabled: s.enabled,
    combineMode: s.combineMode,
    raster: s.raster,
    params: s.params,
  }));
}

export function foldInputsEqual(a: FoldSourceSnapshot[], b: FoldSourceSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      s.id === b[i].id &&
      s.type === b[i].type &&
      s.enabled === b[i].enabled &&
      s.combineMode === b[i].combineMode &&
      s.raster === b[i].raster &&
      s.params === b[i].params
  );
}

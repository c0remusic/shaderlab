export type MaskSourceType = "brush" | "gradient" | "luminosity" | "colorRange";
export type CombineMode = "add" | "subtract" | "intersect";

/** Réglages de refine edge (§4/§4bis du design). En Tranche 2, ce type existe
 *  et voyage dans le modèle, mais AUCUNE passe GPU ne le consomme encore —
 *  `defaultRefineEdge()` est une configuration no-op (identité) pour que la
 *  forme du pipeline ne casse pas quand la Tranche 3 le branchera. */
export interface RefineEdgeParams {
  feather: number;
  contract: number;
  smooth: number;
  edgeAware: boolean;
  edgeRadius: number;
  edgeStrength: number;
}

export function defaultRefineEdge(): RefineEdgeParams {
  return { feather: 0, contract: 0, smooth: 0, edgeAware: false, edgeRadius: 10, edgeStrength: 1 };
}

/** Une source de masque combinable (design.md §3). Seul `type: "brush"` a une
 *  implémentation réelle en Tranche 2 (`raster` peuplé par le pinceau) —
 *  `"gradient"`/`"luminosity"`/`"colorRange"` existent dans l'union de type
 *  (zéro branche morte côté TypeScript) mais n'ont ni générateur de raster ni
 *  UI avant la Tranche 3. `params` reste `null` pour ces types tant qu'ils ne
 *  sont pas implémentés — jamais un objet vide qui laisserait croire à une
 *  config réelle. */
export interface MaskSource {
  id: string;
  type: MaskSourceType;
  combineMode: CombineMode;
  enabled: boolean;
  params: Record<string, number | number[]> | null;
  raster: Uint8Array | null;
}

export function createBrushSource(id: string, raster: Uint8Array): MaskSource {
  return { id, type: "brush", combineMode: "add", enabled: true, params: null, raster };
}

/** Conteneur de masque non-destructif d'un calque (design.md §3). Remplace
 *  l'ancien champ unique de `LayerState` (`Uint8Array | null`). */
export interface LayerMask {
  sources: MaskSource[];
  invert: boolean;
  enabled: boolean;
  refineEdge: RefineEdgeParams;
}

export function defaultLayerMask(): LayerMask {
  return { sources: [], invert: false, enabled: true, refineEdge: defaultRefineEdge() };
}

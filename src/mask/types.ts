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

export type MaskSourceParams = Record<string, number | number[]>;

/** Source pinceau (design.md §3) : `raster` obligatoirement peuplé, `params`
 *  toujours `null` (le pinceau n'a pas de configuration paramétrique — sa
 *  contribution est le buffer peint lui-même). Valide par construction :
 *  impossible en TypeScript d'obtenir une source "brush" sans raster. */
export interface BrushMaskSource {
  id: string;
  type: "brush";
  combineMode: CombineMode;
  enabled: boolean;
  params: null;
  raster: Uint8Array;
}

/** Source paramétrique (dégradé/luminosité/range couleur, design.md §3) :
 *  `params` obligatoirement peuplé, `raster` toujours `null` (sa contribution
 *  est calculée par une passe shader depuis `params`, jamais peinte). Valide
 *  par construction : impossible d'obtenir une source paramétrique sans
 *  `params`, ou avec un `raster`. */
export interface ParametricMaskSource {
  id: string;
  type: Exclude<MaskSourceType, "brush">;
  combineMode: CombineMode;
  enabled: boolean;
  params: MaskSourceParams;
  raster: null;
}

/** Une source de masque combinable (design.md §3), union discriminée sur
 *  `type`/`raster`/`params` — remplace l'ancienne interface permissive où
 *  `raster`/`params` pouvaient être `null` indépendamment du `type`, ce qui
 *  permettait des états impossibles (source "brush" sans raster, source
 *  paramétrique sans params) à passer la compilation. */
export type MaskSource = BrushMaskSource | ParametricMaskSource;

export function createBrushSource(id: string, raster: Uint8Array): BrushMaskSource {
  return { id, type: "brush", combineMode: "add", enabled: true, params: null, raster };
}

export function createParametricSource(
  id: string,
  type: Exclude<MaskSourceType, "brush">,
  params: MaskSourceParams
): ParametricMaskSource {
  return { id, type, combineMode: "add", enabled: true, params, raster: null };
}

/** Garde de type utilisée par les appelants qui doivent distinguer les deux
 *  variantes sans caster (`resident()` du resolver, `ParamPanel`). */
export function isParametricMaskSource(source: MaskSource): source is ParametricMaskSource {
  return source.type !== "brush";
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

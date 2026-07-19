import type { LayerMask } from "../mask/types";

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
}

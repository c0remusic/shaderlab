export interface LayerState {
  id: string;
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  /** Opacité du calque (0..1). 1 = effet à pleine force. */
  opacity: number;
  /** Id du mode de fusion (registry blend). "normal" = remplacement (compat). */
  blendMode: string;
  /** Masque du calque (r8, 1 octet/pixel, taille de l'image), ou null.
   *  IMMUABLE par convention : toujours REMPLACÉ (updateMask stocke une
   *  copie fraîche), jamais muté en place — clone() et l'historique
   *  partagent ces références. */
  maskData: Uint8Array | null;
}

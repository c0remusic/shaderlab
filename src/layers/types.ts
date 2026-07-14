export interface LayerState {
  id: string;
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  /** Masque du calque (r8, 1 octet/pixel, taille de l'image), ou null.
   *  IMMUABLE par convention : toujours REMPLACÉ (updateMask stocke une
   *  copie fraîche), jamais muté en place — clone() et l'historique
   *  partagent ces références. */
  maskData: Uint8Array | null;
}

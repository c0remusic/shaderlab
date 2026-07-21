import type { LayerState } from "./types";

/**
 * Projection d'affichage d'une pile de calques : identique aux calques
 * d'origine SANS les DONNÉES des buffers `raster` des sources de masque.
 *
 * Généralisation du fix crash 24MP (root cause : un gros buffer masque dans
 * le state React fait CRASHER WebView2 au re-render de `setLayers()`, voir
 * `docs/superpowers/specs/2026-07-17-native-wgpu-decision.md`). Avant cette
 * tâche, un seul buffer de masque par calque (l'ancien champ unique de
 * `LayerState`) portait ce risque ; le modèle
 * `LayerMask` généralise à N sources, donc CHAQUE `raster` de CHAQUE source
 * doit être vidé, pas seulement un champ unique.
 *
 * Depuis que `MaskSource` est une union discriminée (Task 1, mask-integrity),
 * une source `"brush"` ne peut PLUS avoir `raster: null` (invariant "valide
 * par construction") : le vidage utilise donc un `Uint8Array` VIDE plutôt que
 * `null` — même effet mémoire (aucune donnée peinte ne survit dans le state
 * React), type valide.
 *
 * Un calque SANS AUCUN raster non-vide est renvoyé PAR IDENTITÉ (même objet)
 * — pas de nouvelle allocation, pour ne pas provoquer de re-render superflu
 * des lignes inchangées (comportement hérité de la version précédente).
 */
export function toDisplayLayers(layers: LayerState[]): LayerState[] {
  return layers.map((l) => {
    const hasRaster = l.mask.sources.some((s) => s.raster !== null && s.raster.length > 0);
    if (!hasRaster) return l;
    return {
      ...l,
      mask: {
        ...l.mask,
        sources: l.mask.sources.map((s) =>
          s.raster && s.raster.length > 0 ? { ...s, raster: new Uint8Array(0) } : s
        ),
      },
    };
  });
}

import type { LayerState } from "./types";

/**
 * Projection d'affichage d'une pile de calques : identique aux calques d'origine
 * SANS le buffer `maskData`.
 *
 * Raison (root cause épinglée par A/B live 2026-07-18, voir
 * `docs/superpowers/specs/2026-07-17-native-wgpu-decision.md`) : un `maskData` r8
 * pleine résolution (~26 Mo à 24MP) placé dans le state React fait CRASHER (hang
 * WebView2, CDP inerte) au re-render déclenché par `setLayers()` en fin de stroke.
 * `setLayers()` SANS masque (ajout de calque) à 24MP ne crashe pas ; AVEC le
 * buffer 26 Mo il crashe ; ne pas appeler `setLayers()` ne crashe pas. Ce n'est
 * donc ni le GPU (le rendu avec le masque complet est OK) ni le re-render en soi,
 * mais le buffer 26 Mo transitant par l'état React.
 *
 * Le fix : la source de vérité COMPLÈTE (avec `maskData`) vit dans un ref, pour le
 * rendu GPU / l'historique / l'export ; le state React ne porte que cette
 * projection. Les panneaux n'affichent jamais les pixels du masque.
 *
 * Un calque sans masque est renvoyé PAR IDENTITÉ (même objet) — pas de nouvelle
 * allocation, pour ne pas provoquer de re-render superflu des lignes inchangées.
 */
export function toDisplayLayers(layers: LayerState[]): LayerState[] {
  return layers.map((l) => (l.maskData ? { ...l, maskData: null } : l));
}

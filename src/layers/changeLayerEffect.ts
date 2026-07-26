import type { LayerStack } from "./layerStack";

/** Effets de bord d'un changement d'effet, injectés par l'appelant (App.tsx :
 *  `presets.clearActive` et `commit`). Extraits ici parce que l'ORDRE entre la
 *  garde no-op et ces effets est l'invariant à protéger, et qu'un handler
 *  React n'est pas testable dans ce projet (aucun rendu de composant, cf.
 *  test/App.test.ts) — même remède que `mask/maskPainterSync.ts`. */
export interface LayerEffectChangeEffects {
  /** Sévère le lien au preset actif : la pile a divergé de son snapshot. */
  clearActivePreset: () => void;
  /** Pousse une entrée d'historique pour la pile mutée. */
  commit: (stack: LayerStack) => void;
}

/** Change l'effet d'un calque existant, avec ses effets de bord d'orchestration.
 *
 *  **La garde no-op passe AVANT tout effet de bord.** `Select` (Base UI,
 *  `components/ui/select.tsx:29-33`) notifie à chaque clic d'item sans tester
 *  l'égalité avec la valeur courante : re-choisir l'effet déjà actif atteint
 *  donc ce chemin. Avec `clearActivePreset()` en tête, ce clic cassait le lien
 *  au preset actif alors qu'aucune mutation n'avait eu lieu et qu'aucune
 *  entrée d'historique ne permettait de revenir en arrière.
 *
 *  Returns `true` iff la pile a réellement changé. */
export function changeLayerEffect(
  stack: LayerStack,
  id: string,
  effectId: string,
  { clearActivePreset, commit }: LayerEffectChangeEffects,
): boolean {
  if (!stack.setLayerEffect(id, effectId)) return false;
  clearActivePreset();
  commit(stack);
  return true;
}

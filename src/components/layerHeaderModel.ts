import type { LayerState } from "../layers/types";

/**
 * Modèle de l'EN-TÊTE du panneau Calques : les contrôles qui étaient répétés
 * sur chaque ligne (opacité, fusion, effet) deviennent UN contrôle unique agissant
 * sur le calque SÉLECTIONNÉ (observation Photoshop web 2026-07-27, §2).
 *
 * Logique pure, sans DOM ni registre d'effets/fusions : c'est la seule partie de
 * l'en-tête qui se teste (Vitest env Node — aucun test ne rend de composant React).
 */
export interface LayerHeaderModel {
  /** false = aucun calque sélectionné : l'en-tête reste AFFICHÉ mais désactivé.
   *  Le masquer ferait sauter la liste en dessous à chaque désélection. */
  enabled: boolean;
  /** Cible des callbacks de mutation. `null` quand `enabled` est false. */
  layerId: string | null;
  /** Valeur affichée par le slider. 1 (opaque) au repos — le slider a besoin
   *  d'un nombre même désactivé, pas d'un `null`. */
  opacity: number;
  /** `null` = le `Select` affiche son placeholder plutôt qu'une valeur
   *  empruntée à un calque qui n'est pas sélectionné. */
  blendMode: string | null;
  effectId: string | null;
}

const EMPTY: LayerHeaderModel = {
  enabled: false,
  layerId: null,
  opacity: 1,
  blendMode: null,
  effectId: null,
};

/**
 * Dérive l'état de l'en-tête depuis la pile et l'id sélectionné. Un `selectedId`
 * périmé (calque supprimé) est traité comme une absence de sélection, jamais
 * comme une erreur : la suppression du calque sélectionné est un geste normal.
 */
export function layerHeaderModel(layers: readonly LayerState[], selectedId: string | null): LayerHeaderModel {
  if (selectedId === null) return EMPTY;
  const layer = layers.find((candidate) => candidate.id === selectedId);
  if (layer === undefined) return EMPTY;
  return {
    enabled: true,
    layerId: layer.id,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    effectId: layer.effectId,
  };
}

/**
 * Opacité en LECTURE SEULE sur la ligne de calque : le slider a quitté les
 * lignes, mais comparer les opacités de la pile d'un coup d'œil (sans
 * sélectionner chaque calque) reste un besoin explicite.
 */
export function formatOpacityPercent(opacity: number): string {
  const clamped = Math.min(1, Math.max(0, opacity));
  return `${Math.round(clamped * 100)} %`;
}

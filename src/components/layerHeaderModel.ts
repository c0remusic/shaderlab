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
  /** Opacité du MODÈLE (0..1) ; l'en-tête l'affiche en pourcentage entier via
   *  `opacityToPercent`. 1 (opaque) au repos — le champ a besoin d'un nombre
   *  même désactivé, pas d'un `null`. */
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
 * Opacité en LECTURE SEULE sur la ligne de calque : le contrôle a quitté les
 * lignes, mais comparer les opacités de la pile d'un coup d'œil (sans
 * sélectionner chaque calque) reste un besoin explicite. Même unité que le
 * champ de l'en-tête (pourcentage entier).
 */
export function formatOpacityPercent(opacity: number): string {
  return `${opacityToPercent(opacity)} %`;
}

/**
 * Opacité du MODÈLE (0..1) vers l'entier de POURCENTAGE affiché par le champ de
 * l'en-tête. Une seule échelle à l'écran : le champ de l'en-tête et la valeur
 * en lecture seule des lignes disent tous deux « 60 % », jamais « 0.6 ».
 */
export function opacityToPercent(opacity: number): number {
  return Math.round(Math.min(1, Math.max(0, opacity)) * 100);
}

/**
 * Saisie clavier du champ d'opacité → pourcentage ENTIER borné à 0..100, ou
 * `null` si la saisie ne contient aucun nombre exploitable (l'appelant revient
 * alors à la valeur précédente ; jamais un `NaN` appliqué au modèle).
 *
 * Accepte « 60 », « 60 % », « 60% », « 60,5 » (virgule décimale) et les espaces
 * autour. Fonction PURE et testée (`test/components/layerHeaderModel.test.ts`) :
 * c'est elle le contrat de saisie, pas le composant qui l'appelle — aucun test
 * de ce projet ne rend de composant React.
 */
export function parseOpacityPercent(raw: string): number | null {
  const match = raw.trim().replace(",", ".").match(/[-+]?\d*\.?\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(Math.min(100, Math.max(0, parsed)));
}

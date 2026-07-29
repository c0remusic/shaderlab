import type { LayerState } from "../layers/types";

/**
 * Modèle de la ZONE DE CONTRÔLES du panneau Calques : les contrôles qui étaient répétés
 * sur chaque ligne (opacité, fusion, effet) deviennent UN contrôle unique agissant
 * sur le calque SÉLECTIONNÉ (observation Photoshop web 2026-07-27, §2).
 *
 * Logique pure, sans DOM ni registre d'effets/fusions : c'est la seule partie de
 * la zone de contrôles qui se teste (Vitest env Node — aucun test ne rend de composant React).
 */
export interface LayerControlsModel {
  /** false = aucun calque sélectionné, OU calque sélectionné VERROUILLÉ : la
   *  zone de contrôles reste AFFICHÉE mais désactivée. Le masquer ferait sauter
   *  la liste en dessous à chaque désélection.
   *
   *  Le cas VERROUILLÉ passe par ici et pas seulement par `LayerStack` parce
   *  que l'opacité et le mode de fusion ne traversent AUCUN mutateur de
   *  `LayerStack` : `App.tsx` les écrit en direct sur la projection de calques
   *  (`handleOpacityChange`/`handleBlendModeChange`). La garde du modèle ne les
   *  couvre donc pas, et un contrôle qui reste actif en ne faisant rien serait
   *  exactement l'échec silencieux que ce dépôt refuse. */
  enabled: boolean;
  /** Le calque sélectionné est-il verrouillé ? Distinct de `!enabled`, qui
   *  vaut aussi quand rien n'est sélectionné : c'est ce booléen qui permet à la
   *  zone de contrôles de DIRE pourquoi elle est inerte plutôt que de la
   *  laisser passer pour une absence de sélection. */
  locked: boolean;
  /** Cible des callbacks de mutation. `null` quand `enabled` est false. */
  layerId: string | null;
  /** Opacité du MODÈLE (0..1) ; la zone de contrôles l'affiche en pourcentage entier via
   *  `opacityToPercent`. 1 (opaque) au repos — le champ a besoin d'un nombre
   *  même désactivé, pas d'un `null`. */
  opacity: number;
  /** `null` = le `Select` affiche son placeholder plutôt qu'une valeur
   *  empruntée à un calque qui n'est pas sélectionné. */
  blendMode: string | null;
  effectId: string | null;
}

const EMPTY: LayerControlsModel = {
  enabled: false,
  locked: false,
  layerId: null,
  opacity: 1,
  blendMode: null,
  effectId: null,
};

/**
 * Dérive l'état de la zone de contrôles depuis la pile et l'id sélectionné. Un `selectedId`
 * périmé (calque supprimé) est traité comme une absence de sélection, jamais
 * comme une erreur : la suppression du calque sélectionné est un geste normal.
 */
export function layerControlsModel(layers: readonly LayerState[], selectedId: string | null): LayerControlsModel {
  if (selectedId === null) return EMPTY;
  const layer = layers.find((candidate) => candidate.id === selectedId);
  if (layer === undefined) return EMPTY;
  const locked = layer.locked === true;
  return {
    // Un calque verrouillé garde ses VALEURS affichées (opacité, fusion, effet
    // restent lisibles) mais ses contrôles sont inertes : le verrou empêche de
    // modifier, pas de consulter.
    enabled: !locked,
    locked,
    layerId: layer.id,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    effectId: layer.effectId,
  };
}

/**
 * Opacité du MODÈLE (0..1) vers l'entier de POURCENTAGE affiché par le champ de
 * la zone de contrôles. Une seule échelle à l'écran : le champ dit « 60 »,
 * jamais « 0.6 ». (L'opacité en lecture seule a quitté la ligne de calque en
 * 88705d6 — elle doublait ce champ, même unité, même valeur.)
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
 * autour. Fonction PURE et testée (`test/components/layerControlsModel.test.ts`) :
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

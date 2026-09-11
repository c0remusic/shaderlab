import type { DevelopSettings } from "../layers/developSettings";

export const PRESET_SCHEMA_VERSION = 1;

/** Sous-ensemble sérialisable de LayerState — délibérément SANS id/mask/
 *  imageSource/transform/effectTransform (design.md §3.1). C'est une LISTE
 *  BLANCHE : `capture`/`apply` recopient champ par champ, donc tout champ absent
 *  d'ici est exclu par construction. `effectTransform` (l'étirement d'un calque
 *  d'effet placé, ticket 24) l'est pour la même raison que `transform` : c'est
 *  un placement de session, pas une recette d'effet. Réversible plus tard par
 *  ajout d'un champ, comme le reste. */
export interface PresetLayer {
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  opacity: number;
  blendMode: string;
}

export interface PresetDocument {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layers: PresetLayer[];
  /** Réglages de l'ÉTAGE DE DÉVELOPPEMENT du document (ticket 03). OPTIONNEL et
   *  ADDITIF : un preset écrit avant l'étage n'a pas ce champ, et `apply` retombe
   *  alors sur les défauts de l'étage (rendu inchangé). `schemaVersion` reste 1 —
   *  l'ajout est rétro-compatible (un champ absent est lu comme « aucun réglage »),
   *  exactement le cas prévu par le versionnement. Un preset Lightroom EST
   *  d'abord ça : un jeu de réglages globaux. */
  develop?: DevelopSettings;
}

/** `layerIndex` names WHICH excluded layer this notice is about (its index in
 *  the ORIGINAL `layers` array passed to `capture`, not in the resulting
 *  `PresetDocument.layers`, which no longer contains it). Needed so a future
 *  confirmation dialog can enumerate the excluded layers by name/position
 *  instead of only reporting a count. */
export interface SkipNotice {
  reason: "missing-effect" | "photo-layer";
  effectId?: string;
  layerIndex: number;
}

export interface ApplyWarning {
  message: string;
}

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

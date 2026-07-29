import type { LayerState } from "../layers/types";
import { hasImportedPhotoLayer } from "../layers/photoLayer";
import { defaultLayerMask } from "../mask/types";
import type { EffectParam } from "../render/effects/types";
import { PRESET_SCHEMA_VERSION, type PresetDocument, type PresetLayer, type SkipNotice, type ApplyWarning } from "./presetTypes";

export { PRESET_SCHEMA_VERSION };

/** Captures the current layer stack into a PresetDocument, in stack order.
 *  A photo layer (imageSource present, double exposure) is ALWAYS excluded —
 *  a preset never captures a source-specific photo reference (design.md §3.1).
 *  Ce contrat-là ne bouge pas.
 *
 *  Ce qui bouge (T5, design 2026-07-28 §2.3) : QUAND cette exclusion mérite
 *  d'être SIGNALÉE. Depuis la tranche T1, la photo d'ouverture est un calque
 *  ordinaire — l'avis « photo-layer » se déclenchait donc sur tout document
 *  ouvert, y compris le cas nominal « juste ma photo ». Un avertissement qui
 *  apparaît toujours n'avertit plus de rien : il apprend à cliquer sans lire.
 *
 *  Frontière retenue : on signale dès que le document contient une photo
 *  AUTRE que sa photo d'ouverture — c'est-à-dire exactement quand
 *  `hasImportedPhotoLayer` est vrai. Ce prédicat est réutilisé plutôt que
 *  redéfini ici : il porte DÉJÀ la définition de « ce document est encore la
 *  retouche de CETTE photo-là » (elle décide du round-trip, layers/
 *  photoLayer.ts §2.8). En écrire une seconde version, c'est se garantir
 *  qu'elles divergeront.
 *
 *  Quand l'avis se déclenche, il énumère TOUTES les photos exclues, fond
 *  compris : le dialogue les liste par nom, en taire une rendrait
 *  l'énumération fausse. La frontière porte sur le déclenchement, pas sur un
 *  filtrage de la liste. */
export function capture(layers: LayerState[], name: string): { preset: PresetDocument; skipped: SkipNotice[] } {
  const skipped: SkipNotice[] = [];
  const presetLayers: PresetLayer[] = [];
  const worthReporting = hasImportedPhotoLayer(layers);

  layers.forEach((layer, layerIndex) => {
    if (layer.imageSource) {
      if (worthReporting) skipped.push({ reason: "photo-layer", layerIndex });
      return;
    }
    presetLayers.push({
      effectId: layer.effectId,
      params: { ...layer.params },
      enabled: layer.enabled,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
    });
  });

  const now = new Date().toISOString();
  return {
    preset: {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      layers: presetLayers,
    },
    skipped,
  };
}

function clampParam(value: number, param: EffectParam): number {
  return Math.min(param.max, Math.max(param.min, value));
}

/** Rebuilds a full LayerState per preset layer: fresh id (via the injected
 *  generator, same counter as LayerStack — see layerStack.ts's exported
 *  freshId), default (empty) mask, no imageSource/transform. A layer whose
 *  effectId no longer resolves is skipped with an ApplyWarning — never a
 *  throw that would abort the rest of the preset (design.md §3.4/§5.5).
 *  Each surviving layer's params are clamped to the CURRENT registry's
 *  min/max, protecting against bound drift between the version of the code
 *  that captured the preset and the version applying it. */
export function apply(
  preset: PresetDocument,
  effectExists: (effectId: string) => boolean,
  effectParams: (effectId: string) => EffectParam[] | null,
  freshId: () => string
): { layers: LayerState[]; warnings: ApplyWarning[] } {
  if (preset.schemaVersion > PRESET_SCHEMA_VERSION) {
    throw new Error(
      `Preset "${preset.name}" a un schemaVersion (${preset.schemaVersion}) plus récent que celui supporté par cette version de l'app (${PRESET_SCHEMA_VERSION}).`
    );
  }
  const migrated = migratePresetDocument(preset);

  const layers: LayerState[] = [];
  const warnings: ApplyWarning[] = [];

  for (const presetLayer of migrated.layers) {
    if (!effectExists(presetLayer.effectId)) {
      warnings.push({ message: `Calque ignoré : l'effet "${presetLayer.effectId}" n'existe plus.` });
      continue;
    }
    const params = effectParams(presetLayer.effectId);
    const clamped: Record<string, number> = {};
    for (const [key, value] of Object.entries(presetLayer.params)) {
      const paramDef = params?.find((p) => p.name === key);
      clamped[key] = paramDef ? clampParam(value, paramDef) : value;
    }
    layers.push({
      id: freshId(),
      effectId: presetLayer.effectId,
      params: clamped,
      enabled: presetLayer.enabled,
      opacity: presetLayer.opacity,
      blendMode: presetLayer.blendMode,
      mask: defaultLayerMask(),
    });
  }

  return { layers, warnings };
}

/** No-op today: PRESET_SCHEMA_VERSION === 1 is the only version that has
 *  ever existed. The chain of `if (doc.schemaVersion === N) doc = migrateN(doc)`
 *  steps this function will grow into is deliberately NOT built ahead of a
 *  second version actually existing (YAGNI, design.md §3.3). */
export function migratePresetDocument(doc: PresetDocument): PresetDocument {
  return doc;
}

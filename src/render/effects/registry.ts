import type { EffectModule } from "./types";
import { validateEffect } from "./validate";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";
import { warp } from "./warp";
import { grain } from "./grain";
import { duotone } from "./duotone";
import { posterize } from "./posterize";
import { gooeyMerge } from "./gooeyMerge";
import { channelMixer } from "./channelMixer";
import { outlines } from "./outlines";
import { PASSTHROUGH_EFFECT } from "../effectPassRunner";

// Ordre d'ajout des trois derniers = ordre de priorité du backlog d'effets
// confirmé par l'utilisateur (design.md du MVP) : Gooey merge, Channel mixer,
// Outlines. Ce tableau alimente le sélecteur « ajouter un effet ».
export const effectRegistry: EffectModule[] = [
  glow,
  chromaticBleed,
  warp,
  grain,
  duotone,
  posterize,
  gooeyMerge,
  channelMixer,
  outlines,
];
effectRegistry.forEach(validateEffect);

/** `"passthrough"` résout vers `PASSTHROUGH_EFFECT` SANS apparaître dans
 *  `effectRegistry` — ce tableau alimente le sélecteur "ajouter un effet"
 *  de LayerPanel, et passthrough n'est pas un effet choisissable par
 *  l'utilisateur : c'est l'effectId par défaut d'un calque de photo (double
 *  exposure), posé par `LayerStack.addPhotoLayer`. */
export function getEffect(id: string): EffectModule {
  if (id === PASSTHROUGH_EFFECT.id) return PASSTHROUGH_EFFECT;
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}

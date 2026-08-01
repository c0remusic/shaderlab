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
import { pixelStretch } from "./pixelStretch";
import { sliceShift } from "./sliceShift";
import { gradientMap } from "./gradientMap";
import { halation } from "./halation";
import { lensBlur } from "./lensBlur";
import { hatching } from "./hatching";
import { PASSTHROUGH_EFFECT } from "../effectPassRunner";

// Les six du milieu suivent l'ordre de priorité du backlog d'effets confirmé par
// l'utilisateur (design.md du MVP § « Backlog d'effets futurs ») : Gooey merge,
// Channel mixer, Outlines, Pixel stretch, Slice shift, Gradient map. Ce backlog
// est ÉPUISÉ depuis le 2026-07-31.
//
// `halation` (2026-08-01) ne vient PAS de ce backlog : il naît du cahier de
// références (`docs/superpowers/specs/2026-08-01-references-effets.md`), qui a
// montré que `glow` confondait deux phénomènes distincts. Posé juste après glow
// parce que c'est là qu'on le cherche — les deux s'empilent sur un rendu film.
//
// `lensBlur` (2026-08-01) vient du même cahier, §6ter : aucun flou n'existait
// ici, et c'était l'absence la plus voyante face à la référence. Posé après les
// deux halos parce qu'il appartient à la même famille — ce que fait l'objectif
// avec la lumière qu'il ne met pas au point.
//
// Ce tableau alimente le sélecteur « ajouter un effet ».
export const effectRegistry: EffectModule[] = [
  glow,
  halation,
  lensBlur,
  chromaticBleed,
  warp,
  grain,
  duotone,
  posterize,
  // `hatching` (2026-08-01) est posé auprès de `posterize` et non à la suite du
  // backlog : les deux appartiennent à la référence d'IMPRESSION, et c'est
  // là qu'on cherche l'un quand on vient de poser l'autre.
  hatching,
  gooeyMerge,
  channelMixer,
  outlines,
  pixelStretch,
  sliceShift,
  gradientMap,
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

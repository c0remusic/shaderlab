import type { EffectModule } from "./types";
import { validateEffect } from "./validate";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";
import { warp } from "./warp";
import { grain } from "./grain";
import { duotone } from "./duotone";
import { posterize } from "./posterize";

export const effectRegistry: EffectModule[] = [glow, chromaticBleed, warp, grain, duotone, posterize];
effectRegistry.forEach(validateEffect);

export function getEffect(id: string): EffectModule {
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}

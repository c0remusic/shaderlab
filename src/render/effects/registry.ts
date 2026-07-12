import type { EffectModule } from "./types";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";

export const effectRegistry: EffectModule[] = [glow, chromaticBleed];

export function getEffect(id: string): EffectModule {
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}

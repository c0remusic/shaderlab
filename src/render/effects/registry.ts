import type { EffectModule } from "./types";
import { glow } from "./glow";

export const effectRegistry: EffectModule[] = [glow];

export function getEffect(id: string): EffectModule {
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}

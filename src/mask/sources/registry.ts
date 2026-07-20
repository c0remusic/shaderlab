import type { MaskSourceModule } from "./types";
import { gradientSource } from "./gradient";
import { luminositySource } from "./luminosity";
import { colorRangeSource } from "./colorRange";

export const maskSourceRegistry: MaskSourceModule[] = [gradientSource, luminositySource, colorRangeSource];

const seen = new Set<string>();
for (const m of maskSourceRegistry) {
  if (seen.has(m.id)) throw new Error(`Source de masque en double: ${m.id}`);
  seen.add(m.id);
}

export function getMaskSourceModule(type: MaskSourceModule["id"]): MaskSourceModule {
  const mod = maskSourceRegistry.find((m) => m.id === type);
  if (!mod) throw new Error(`Source de masque inconnue: ${type}`);
  return mod;
}

import type { BlendMode } from "./types";
import {
  normal, multiply, screen, add, darken, lighten,
  overlay, hardLight, softLight, colorBurn, colorDodge,
} from "./modes";

export const blendRegistry: BlendMode[] = [
  normal, multiply, screen, add, darken, lighten,
  overlay, hardLight, softLight, colorBurn, colorDodge,
];

// Fail-fast : ids uniques (comme validateEffect côté effets).
const seen = new Set<string>();
for (const m of blendRegistry) {
  if (seen.has(m.id)) throw new Error(`Mode de fusion en double: ${m.id}`);
  seen.add(m.id);
}

export function getBlendMode(id: string): BlendMode {
  const mode = blendRegistry.find((m) => m.id === id);
  if (!mode) throw new Error(`Mode de fusion inconnu: ${id}`);
  return mode;
}

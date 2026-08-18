import type { BlendMode } from "./types";
import {
  normal, multiply, screen, add, darken, lighten,
  overlay, hardLight, softLight, colorBurn, colorDodge,
  difference, subtract,
  hue, saturation, color, luminosity,
} from "./modes";

// L'ORDRE EST CELUI DU SÉLECTEUR (`LayerPanel.tsx:177` en dérive ses options),
// et il suit les familles de Photoshop : normal, assombrissants, éclaircissants,
// contraste, comparatifs, composites. Aucun index n'est persisté — `blendMode`
// est une CHAÎNE (`layers/types.ts`) — donc réordonner ne casse aucun preset.
export const blendRegistry: BlendMode[] = [
  normal, multiply, screen, add, darken, lighten,
  overlay, hardLight, softLight, colorBurn, colorDodge,
  difference, subtract,
  hue, saturation, color, luminosity,
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

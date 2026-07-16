import type { LayerState } from "../layers/types";

/**
 * Ids du cache de textures de masque dont le calque n'existe plus dans la
 * pile courante — leurs textures GPU doivent être détruites (sinon fuite
 * VRAM à chaque suppression de calque, ~24 Mo par masque 24MP).
 */
export function staleMaskIds(cachedIds: Iterable<string>, layers: LayerState[]): string[] {
  const alive = new Set(layers.map((l) => l.id));
  return [...cachedIds].filter((id) => !alive.has(id));
}

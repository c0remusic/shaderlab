import type { LayerState } from "./types";

let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}

export class LayerStack {
  layers: LayerState[] = [];

  addLayer(effectId: string): string {
    const id = freshId();
    this.layers.push({ id, effectId, params: {}, enabled: true, maskData: null });
    return id;
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
  }

  reorderLayer(id: string, newIndex: number): void {
    const from = this.layers.findIndex((l) => l.id === id);
    if (from === -1) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(newIndex, 0, layer);
  }

  toggleLayer(id: string): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.enabled = !layer.enabled;
  }

  updateParams(id: string, params: Record<string, number>): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.params = { ...layer.params, ...params };
  }

  updateMask(id: string, maskData: Uint8Array): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.maskData = new Uint8Array(maskData);
  }

  clone(): LayerStack {
    const copy = new LayerStack();
    copy.layers = this.layers.map((l) => ({
      ...l,
      params: { ...l.params },
      // maskData est immuable par convention (updateMask remplace toujours
      // la référence par une copie fraîche, jamais de mutation in place) —
      // le partager rend clone() O(métadonnées) au lieu de O(pixels). Le
      // coût du pinceau (currentStack() par sample) et le comptage mémoire
      // de l'historique (refcount de buffers partagés) en dépendent.
      maskData: l.maskData,
    }));
    return copy;
  }
}

import type { LayerState } from "./types";
import { defaultLayerMask, createBrushSource, createParametricSource } from "../mask/types";
import type { MaskSourceType, CombineMode, RefineEdgeParams, MaskSourceParams } from "../mask/types";
import { getMaskSourceModule } from "../mask/sources/registry";

let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}

export class LayerStack {
  layers: LayerState[] = [];

  addLayer(effectId: string): string {
    const id = freshId();
    this.layers.push({
      id,
      effectId,
      params: {},
      enabled: true,
      opacity: 1,
      blendMode: "normal",
      mask: defaultLayerMask(),
    });
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

  /** Peint/actualise LA source pinceau du calque (au plus une en Tranche 2,
   *  voir `getBrushRaster`). Crée la source à la 1ère touche, sinon remplace
   *  son `raster` par une copie fraîche (immuable par convention, comme
   *  `updateMask` avant elle) — jamais de mutation en place. */
  updateBrushMask(id: string, raster: Uint8Array): void {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    const fresh = new Uint8Array(raster);
    const idx = layer.mask.sources.findIndex((s) => s.type === "brush");
    if (idx === -1) {
      const brush = createBrushSource(`${id}-brush`, fresh);
      layer.mask = { ...layer.mask, sources: [...layer.mask.sources, brush] };
      return;
    }
    const existing = layer.mask.sources[idx];
    if (existing.type !== "brush") throw new Error("Invariant violé: source pinceau attendue");
    const nextSource = { ...existing, raster: fresh };
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? nextSource : s));
    layer.mask = { ...layer.mask, sources: nextSources };
  }

  addMaskSource(layerId: string, type: Exclude<MaskSourceType, "brush">): string {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    const module = getMaskSourceModule(type);
    const id = freshId();
    const source = createParametricSource(id, type, { ...module.defaultParams });
    layer.mask = { ...layer.mask, sources: [...layer.mask.sources, source] };
    return id;
  }

  removeMaskSource(layerId: string, sourceId: string): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = { ...layer.mask, sources: layer.mask.sources.filter((s) => s.id !== sourceId) };
  }

  updateMaskSourceParams(layerId: string, sourceId: string, params: MaskSourceParams): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = {
      ...layer.mask,
      // "brush" n'a pas de params (voir mask/types.ts) : un id de source
      // pinceau ne matche jamais ici, la garde de type est donc un no-op
      // pour ce cas, jamais un comportement observable différent.
      sources: layer.mask.sources.map((s) => (s.id === sourceId && s.type !== "brush" ? { ...s, params } : s)),
    };
  }

  setMaskSourceCombineMode(layerId: string, sourceId: string, mode: CombineMode): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = {
      ...layer.mask,
      sources: layer.mask.sources.map((s) => (s.id === sourceId ? { ...s, combineMode: mode } : s)),
    };
  }

  updateRefineEdge(layerId: string, refineEdge: Partial<RefineEdgeParams>): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    layer.mask = { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, ...refineEdge } };
  }

  setMaskInvert(id: string, invert: boolean): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.mask = { ...layer.mask, invert };
  }

  setMaskEnabled(id: string, enabled: boolean): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.mask = { ...layer.mask, enabled };
  }

  /** Active/désactive UNE source de masque (design.md §3, gap Tranche 3 —
   *  jusqu'ici seul `setMaskEnabled` existait, au niveau du masque entier).
   *  Retourne `true` seulement si la source existait ET que sa valeur a
   *  changé (évite une entrée d'historique vide sur un no-op, cf. `App.tsx`
   *  Task 3). */
  setMaskSourceEnabled(layerId: string, sourceId: string, enabled: boolean): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const idx = layer.mask.sources.findIndex((s) => s.id === sourceId);
    if (idx === -1) return false;
    if (layer.mask.sources[idx].enabled === enabled) return false;
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? { ...s, enabled } : s));
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
  }

  clone(): LayerStack {
    const copy = new LayerStack();
    copy.layers = this.layers.map((l) => ({
      ...l,
      params: { ...l.params },
      // Chaque `raster` de source est IMMUABLE par convention (updateBrushMask
      // remplace toujours la référence, jamais de mutation in place) — le
      // partager rend clone() O(métadonnées) au lieu de O(pixels), comme
      // l'ancien champ unique de LayerState. Les conteneurs (LayerMask, MaskSource, le tableau
      // sources) sont eux toujours des objets FRAIS, pour que muter le clone
      // (ex. setMaskInvert) ne touche jamais l'original.
      mask: {
        ...l.mask,
        refineEdge: { ...l.mask.refineEdge },
        sources: l.mask.sources.map((s) => ({ ...s })),
      },
    }));
    return copy;
  }
}

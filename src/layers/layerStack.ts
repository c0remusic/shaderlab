import type { LayerState, LayerTransform } from "./types";
import { defaultLayerMask, createBrushSource, createParametricSource } from "../mask/types";
import type { MaskSourceType, CombineMode, RefineEdgeParams, MaskSourceParams } from "../mask/types";
import { getMaskSourceModule } from "../mask/sources/registry";

let nextId = 0;
/** Exported so `presetDocument.apply()` (src/presets/) can inject the SAME
 *  counter instead of running a second, independently-seeded id sequence —
 *  two separate generators could otherwise both produce "layer-3" and
 *  silently collide once a preset-applied layer and a manually-added layer
 *  coexist in the same document. */
export function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}

/** Shallow value equality for a params-like record, used by the mutators
 *  below to detect a genuine no-op (same keys, same values) so App.tsx can
 *  skip creating an empty history entry (Task 3). Array values (e.g.
 *  color-range `samples`) are compared element-wise — `Object.is` alone
 *  would treat two structurally identical but distinct arrays as different,
 *  which would defeat the no-op check on every call since callers always
 *  spread into a fresh object/array. */
function paramsEqual(a: object, b: object): boolean {
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  const aKeys = Object.keys(ar);
  const bKeys = Object.keys(br);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const av = ar[key];
    const bv = br[key];
    if (Array.isArray(av) && Array.isArray(bv)) {
      return av.length === bv.length && av.every((v, i) => Object.is(v, bv[i]));
    }
    return Object.is(av, bv);
  });
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

  /** Crée un calque de photo (double exposure) : `effectId` par défaut
   *  "passthrough" (résolu par `getEffect`, voir effects/registry.ts —
   *  n'apparaît pas dans le sélecteur "ajouter un effet" de LayerPanel).
   *  L'appelant reste responsable de vérifier `canAddPhotoLayer` (limite
   *  dure, photoLayer.ts) AVANT d'appeler cette méthode — elle ne l'impose
   *  pas elle-même, comme les autres mutateurs de ce fichier qui ne
   *  connaissent pas les règles produit de plus haut niveau. */
  addPhotoLayer(sourceId: string, transform: LayerTransform): string {
    const id = freshId();
    this.layers.push({
      id,
      effectId: "passthrough",
      params: {},
      enabled: true,
      opacity: 1,
      blendMode: "normal",
      mask: defaultLayerMask(),
      imageSource: { sourceId },
      transform,
    });
    return id;
  }

  /** Remplace l'effet d'un calque DÉJÀ créé, en remettant ses params aux
   *  défauts du nouvel effet. Sans ce mutateur, l'`effectId` posé à la
   *  création était définitif : un calque photo (`addPhotoLayer`, ci-dessus)
   *  restait `passthrough` à vie alors que le moteur sait déjà router la
   *  photo transformée comme ENTRÉE d'effet du calque
   *  (`render/framePipelineExecutor.ts`).
   *
   *  Params remis à `{}` — et pas fusionnés ni conservés : les params sont
   *  indexés par NOM côté state mais par POSITION dans l'uniform du shader
   *  (`effectPassRunner.ts` : `layer.params[p.name] ?? p.default`), donc une
   *  valeur héritée de l'ancien effet atterrirait dans un slot qui n'est pas
   *  le sien, hors de ses bornes min/max. `{}` EST le jeu de défauts du
   *  nouvel effet, exactement comme `addLayer` qui pose déjà `params: {}`.
   *  Le masque, l'opacité, le mode de fusion et l'identité photo
   *  (`imageSource`/`transform`) sont conservés : changer d'effet n'est pas
   *  recréer le calque.
   *
   *  Cette méthode ne valide PAS que `effectId` existe dans le registry —
   *  même contrat que `addLayer`, dont elle est le pendant sur un calque
   *  existant ; c'est `getEffect` qui échoue fail-fast à la résolution.
   *
   *  Returns `true` iff `id` existe ET `effectId` diffère réellement de
   *  l'actuel (même discipline no-op que le reste du fichier : pas d'entrée
   *  d'historique vide, et pas de reset de params sur un faux changement). */
  setLayerEffect(id: string, effectId: string): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (layer.effectId === effectId) return false;
    layer.effectId = effectId;
    layer.params = {};
    return true;
  }

  /** Returns `true` iff `id` existe, porte un `imageSource` (un calque sans
   *  photo n'a pas de transform à changer), et `transform` diffère
   *  réellement du courant (même discipline no-op que le reste du fichier). */
  updateLayerTransform(id: string, transform: LayerTransform): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || !layer.imageSource) return false;
    if (layer.transform && paramsEqual(layer.transform, transform)) return false;
    layer.transform = transform;
    return true;
  }

  /** Returns `true` iff a layer with `id` existed and was removed. Leaves
   *  `this.layers` as the SAME array reference on a no-op (absent id) — the
   *  same "don't touch the reference unless something actually changed"
   *  discipline as the mask-container setters below. */
  removeLayer(id: string): boolean {
    if (!this.layers.some((l) => l.id === id)) return false;
    this.layers = this.layers.filter((l) => l.id !== id);
    return true;
  }

  /** Returns `true` iff `id` exists, `newIndex` is a valid position in the
   *  stack, and it differs from the layer's current index — an absent id,
   *  an out-of-bounds index, or reordering to the same spot are all no-ops
   *  reported as `false` rather than silently clamped or applied as an
   *  empty move (Task 3: the caller uses this to skip an empty history
   *  entry). */
  reorderLayer(id: string, newIndex: number): boolean {
    const from = this.layers.findIndex((l) => l.id === id);
    if (from === -1) return false;
    if (newIndex < 0 || newIndex >= this.layers.length) return false;
    if (newIndex === from) return false;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(newIndex, 0, layer);
    return true;
  }

  /** Returns `true` iff a layer with `id` existed and was toggled. */
  toggleLayer(id: string): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    layer.enabled = !layer.enabled;
    return true;
  }

  /** Returns `true` iff `id` exists and the merge actually changes at least
   *  one param value. */
  updateParams(id: string, params: Record<string, number>): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    const merged = { ...layer.params, ...params };
    if (paramsEqual(layer.params, merged)) return false;
    layer.params = merged;
    return true;
  }

  /** Peint/actualise LA source pinceau du calque (au plus une en Tranche 2,
   *  voir `getBrushRaster`). Crée la source à la 1ère touche, sinon remplace
   *  son `raster` par une copie fraîche (immuable par convention, comme
   *  `updateMask` avant elle) — jamais de mutation en place. Returns `true`
   *  iff `id` exists (a brush stroke is never a no-op — it always carries
   *  fresh painted pixels). */
  updateBrushMask(id: string, raster: Uint8Array): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    const fresh = new Uint8Array(raster);
    const idx = layer.mask.sources.findIndex((s) => s.type === "brush");
    if (idx === -1) {
      const brush = createBrushSource(`${id}-brush`, fresh);
      layer.mask = { ...layer.mask, sources: [...layer.mask.sources, brush] };
      return true;
    }
    const existing = layer.mask.sources[idx];
    if (existing.type !== "brush") throw new Error("Invariant violé: source pinceau attendue");
    const nextSource = { ...existing, raster: fresh };
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? nextSource : s));
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
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

  /** Returns `true` iff `layerId` and `sourceId` both existed and the
   *  source was removed. An absent layer or an absent source id are both
   *  reported as `false` (Task 3: no longer throws — a caller acting on a
   *  stale/already-removed source id is a no-op, not an exceptional state). */
  removeMaskSource(layerId: string, sourceId: string): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const before = layer.mask.sources.length;
    const sources = layer.mask.sources.filter((s) => s.id !== sourceId);
    if (sources.length === before) return false;
    layer.mask = { ...layer.mask, sources };
    return true;
  }

  /** Returns `true` iff `layerId`/`sourceId` both exist, the source isn't
   *  the brush source (which has no params), and `params` actually differs
   *  from the source's current params. */
  updateMaskSourceParams(layerId: string, sourceId: string, params: MaskSourceParams): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const idx = layer.mask.sources.findIndex((s) => s.id === sourceId);
    if (idx === -1) return false;
    const source = layer.mask.sources[idx];
    if (source.type === "brush") return false; // pas de params à comparer/remplacer
    if (paramsEqual(source.params, params)) return false;
    const nextSources = layer.mask.sources.map((s, i) =>
      i === idx && s.type !== "brush" ? { ...s, params } : s
    );
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
  }

  /** Returns `true` iff `layerId`/`sourceId` both exist and `mode` actually
   *  differs from the source's current combine mode. */
  setMaskSourceCombineMode(layerId: string, sourceId: string, mode: CombineMode): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const idx = layer.mask.sources.findIndex((s) => s.id === sourceId);
    if (idx === -1) return false;
    if (layer.mask.sources[idx].combineMode === mode) return false;
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? { ...s, combineMode: mode } : s));
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
  }

  /** Returns `true` iff `layerId` exists and the patch actually changes at
   *  least one refine-edge field. */
  updateRefineEdge(layerId: string, refineEdge: Partial<RefineEdgeParams>): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const merged = { ...layer.mask.refineEdge, ...refineEdge };
    if (paramsEqual(layer.mask.refineEdge, merged)) return false;
    layer.mask = { ...layer.mask, refineEdge: merged };
    return true;
  }

  /** Returns `true` iff `id` exists and `invert` actually differs from the
   *  mask's current value. */
  setMaskInvert(id: string, invert: boolean): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (layer.mask.invert === invert) return false;
    layer.mask = { ...layer.mask, invert };
    return true;
  }

  /** Returns `true` iff `id` exists and `enabled` actually differs from the
   *  mask's current value. */
  setMaskEnabled(id: string, enabled: boolean): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (layer.mask.enabled === enabled) return false;
    layer.mask = { ...layer.mask, enabled };
    return true;
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

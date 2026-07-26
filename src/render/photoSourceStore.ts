import { MAX_PHOTO_LAYERS } from "../layers/photoLayer";
import { assertImageFitsGpu } from "./limits";

/** Plafond de sources photo ENREGISTRÉES (vivantes) dans un même document —
 *  à distinguer de `MAX_PHOTO_LAYERS`, qui plafonne les calques photo
 *  PRÉSENTS dans la pile. Les deux diffèrent parce qu'il n'y a
 *  volontairement pas de refcount : une source n'est jamais libérée au
 *  retrait de son calque (un undo peut le ramener), elle vit jusqu'au
 *  changement de document (`dispose()`). Une boucle importer/annuler fait
 *  donc croître la mémoire sans borne — ce garde est cette borne.
 *
 *  Facteur 4 : pas arbitraire assumé (design
 *  `2026-07-26-shaderlab-photo-layer-parity-design.md` §3.5). Il borne la
 *  fuite sans gêner un usage normal (4 imports annulés par calque autorisé),
 *  et il est révisé par la MÊME mesure VRAM que `MAX_PHOTO_LAYERS` — voir le
 *  critère de révision sur cette constante (`src/layers/photoLayer.ts`).
 *  Posé ICI et pas dans l'UI : `PhotoSourceStore` est le point unique
 *  d'allocation (ARCHITECTURE.md R1 : « si un garde arrive, il se pose dans
 *  `PhotoSourceStore`, pas dispersé »). */
export const MAX_REGISTERED_PHOTO_SOURCES = 4 * MAX_PHOTO_LAYERS;

/**
 * Propriétaire GPU EXCLUSIF des textures de photo importée (double
 * exposure, ARCHITECTURE.md §4.2) — jamais référencée depuis
 * `LayerState`/le state React/un snapshot d'historique (invariant OOM,
 * `e3c7584`). Vit aux côtés d'`ImageFrameResources` dans `render/` (même
 * cycle de vie : créé/vidé avec le document), jamais dans `layers/`, qui ne
 * doit jamais dépendre de WebGPU.
 */
export class PhotoSourceStore {
  private textures = new Map<string, GPUTexture>();
  private sizes = new Map<string, { width: number; height: number }>();
  private nextId = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly maxTextureDimension2D: number,
  ) {}

  /** Nombre de sources actuellement enregistrées (vivantes). Remis à zéro par
   *  `dispose()` — c'est `textures.size` et pas un compteur parallèle, pour
   *  qu'aucune dérive entre les deux ne soit possible. */
  get registeredCount(): number {
    return this.textures.size;
  }

  /** Valide, alloue et uploade une nouvelle source de photo. Retourne un
   *  `sourceId` frais à CHAQUE appel, même pour un bitmap identique — deux
   *  imports distincts de la même photo sont deux sources indépendantes.
   *  Lève AVANT toute allocation si le plafond de sources vivantes est déjà
   *  atteint (fail-fast, ARCHITECTURE.md §2.5 — jamais un état qui se dit
   *  fini sans l'être). */
  register(bitmap: ImageBitmap): string {
    if (this.textures.size >= MAX_REGISTERED_PHOTO_SOURCES) {
      throw new Error(
        `Trop de photos importées dans cette session (${this.textures.size}/${MAX_REGISTERED_PHOTO_SOURCES}) : ` +
          `chaque import garde sa texture en mémoire jusqu'au changement de document, même après annulation. ` +
          `Ouvre à nouveau le document pour libérer la mémoire.`,
      );
    }
    assertImageFitsGpu(bitmap.width, bitmap.height, this.maxTextureDimension2D);
    this.nextId += 1;
    const sourceId = `photo-${this.nextId}`;
    const texture = this.device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height],
    );
    this.textures.set(sourceId, texture);
    this.sizes.set(sourceId, { width: bitmap.width, height: bitmap.height });
    return sourceId;
  }

  get(sourceId: string): GPUTexture | null {
    return this.textures.get(sourceId) ?? null;
  }

  dimensions(sourceId: string): { width: number; height: number } | null {
    return this.sizes.get(sourceId) ?? null;
  }

  /** Détruit toutes les textures possédées — appelé au changement de
   *  document (même discipline que `ImageFrameResources.dispose()`), jamais
   *  au retrait d'un seul calque : PAS de refcount, parce qu'un calque photo
   *  supprimé peut revenir par undo et que libérer sa texture casserait
   *  l'undo. C'est donc aussi le seul point qui rend des jetons sous
   *  `MAX_REGISTERED_PHOTO_SOURCES`, et la sortie que nomme son message
   *  d'erreur. */
  dispose(): void {
    for (const texture of this.textures.values()) texture.destroy();
    this.textures.clear();
    this.sizes.clear();
  }
}

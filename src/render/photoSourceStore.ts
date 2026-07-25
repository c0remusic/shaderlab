import { assertImageFitsGpu } from "./limits";

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

  /** Valide, alloue et uploade une nouvelle source de photo. Retourne un
   *  `sourceId` frais à CHAQUE appel, même pour un bitmap identique — deux
   *  imports distincts de la même photo sont deux sources indépendantes. */
  register(bitmap: ImageBitmap): string {
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
   *  au retrait d'un seul calque (pas de refcount : au plus un calque photo
   *  existe à la fois, `MAX_PHOTO_LAYERS`). */
  dispose(): void {
    for (const texture of this.textures.values()) texture.destroy();
    this.textures.clear();
    this.sizes.clear();
  }
}

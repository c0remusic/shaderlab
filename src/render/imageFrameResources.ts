import { assertImageFitsGpu } from "./limits";

/** Persistent colour textures belonging to one loaded image. */
export class ImageFrameResources {
  private source: GPUTexture | null = null;
  private intermediate: [GPUTexture, GPUTexture] | null = null;
  private exportTarget: GPUTexture | null = null;
  private imageWidth = 0;
  private imageHeight = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly maxTextureDimension2D: number,
  ) {}

  get width(): number { return this.imageWidth; }
  get height(): number { return this.imageHeight; }
  get sourceTexture(): GPUTexture | null { return this.source; }
  get pingPong(): [GPUTexture, GPUTexture] | null { return this.intermediate; }

  /** Validates, allocates, and uploads a new source image. */
  loadImage(bitmap: ImageBitmap): void {
    assertImageFitsGpu(bitmap.width, bitmap.height, this.maxTextureDimension2D);
    this.dispose();
    this.imageWidth = bitmap.width;
    this.imageHeight = bitmap.height;
    this.source = this.device.createTexture({
      size: [this.imageWidth, this.imageHeight],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.clearCanvas(this.source);
    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.source },
      [this.imageWidth, this.imageHeight],
    );
    this.intermediate = [this.createRenderTarget(), this.createRenderTarget()];
  }

  /** Returns the export target, creating it lazily. */
  getExportTexture(): GPUTexture {
    this.requireLoaded();
    if (!this.exportTarget) this.exportTarget = this.createRenderTarget();
    return this.exportTarget;
  }

  dispose(): void {
    this.source?.destroy();
    this.source = null;
    this.intermediate?.[0].destroy();
    this.intermediate?.[1].destroy();
    this.intermediate = null;
    this.exportTarget?.destroy();
    this.exportTarget = null;
    this.imageWidth = 0;
    this.imageHeight = 0;
  }

  /**
   * Efface la TOILE en transparent (`alpha = 0`), jamais en noir opaque.
   *
   * C'est la décision de la tranche T0 du design 2026-07-28 : elle contredit
   * volontairement le §1.2 du même document, qui imposait `alpha = 1`. Cette
   * contrainte-là n'était dictée QUE par l'export (un JPEG n'a pas de canal
   * alpha) ; l'aplatissement explicite de `render/presentPass.ts` la remplace,
   * et une toile transparente est ce qui permet de savoir, par pixel, si un
   * calque couvre — donc d'afficher le damier.
   *
   * AUJOURD'HUI l'upload juste après recouvre intégralement cet effacement :
   * la toile porte encore la photo, il n'existe aucune zone non couverte, et
   * cet appel n'est observable par rien. Il devient porteur à la tranche T1,
   * quand la toile cesse d'être uploadée. Il est posé explicitement plutôt que
   * laissé à l'initialisation-à-zéro garantie par WebGPU pour que l'intention
   * soit lisible et greppable au moment où elle comptera.
   */
  private clearCanvas(texture: GPUTexture): void {
    const encoder = this.device.createCommandEncoder();
    encoder
      .beginRenderPass({
        colorAttachments: [
          {
            view: texture.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      })
      .end();
    this.device.queue.submit([encoder.finish()]);
  }

  private createRenderTarget(): GPUTexture {
    return this.device.createTexture({
      size: [this.imageWidth, this.imageHeight],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  private requireLoaded(): void {
    if (!this.source || !this.intermediate) throw new Error("Aucune image chargée.");
  }
}

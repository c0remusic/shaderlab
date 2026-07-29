import { assertImageFitsGpu } from "./limits";

/**
 * Textures persistantes d'un document : la TOILE et les cibles de rendu.
 *
 * La toile n'est PLUS la photo (tranche T1 du design 2026-07-28, §1.2). Elle
 * est allouée aux dimensions du DOCUMENT, effacée une fois, et **jamais
 * uploadée** : la photo qui ouvre le document est devenue un `LayerState`
 * ordinaire portant `imageSource`, enregistré dans `PhotoSourceStore` comme
 * n'importe quelle photo importée. Ce que la toile apporte au pipeline est un
 * point de départ inconditionnel — l'exécuteur de frame n'a pas à savoir si son
 * premier calque est une photo à couverture pleine (§9.4, information leakage).
 */
export class ImageFrameResources {
  private canvas: GPUTexture | null = null;
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
  get canvasTexture(): GPUTexture | null { return this.canvas; }
  get pingPong(): [GPUTexture, GPUTexture] | null { return this.intermediate; }

  /** Valide, alloue et EFFACE la toile du document — aucun pixel n'y est
   *  uploadé. Prend des DIMENSIONS et non un `ImageBitmap` : c'est la trace
   *  dans la signature que cette classe ne connaît plus d'image du tout. */
  allocateCanvas(width: number, height: number): void {
    assertImageFitsGpu(width, height, this.maxTextureDimension2D);
    this.dispose();
    this.imageWidth = width;
    this.imageHeight = height;
    this.canvas = this.device.createTexture({
      size: [this.imageWidth, this.imageHeight],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.clearCanvas(this.canvas);
    this.intermediate = [this.createRenderTarget(), this.createRenderTarget()];
  }

  /** Returns the export target, creating it lazily. */
  getExportTexture(): GPUTexture {
    this.requireLoaded();
    if (!this.exportTarget) this.exportTarget = this.createRenderTarget();
    return this.exportTarget;
  }

  dispose(): void {
    this.canvas?.destroy();
    this.canvas = null;
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
   * DEPUIS LA TRANCHE T1 cet effacement est le contenu DÉFINITIF de la toile :
   * plus aucun upload ne le recouvre. Une zone que ne couvre aucun calque
   * arrive donc à alpha 0 jusqu'à la passe de présentation, qui l'aplatit sur
   * un damier à l'écran et sur du noir à l'export (`render/presentPass.ts`).
   * Masquer le calque de fond fait apparaître le damier : c'est la preuve
   * observable de toute cette chaîne.
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
    if (!this.canvas || !this.intermediate) throw new Error("Aucune image chargée.");
  }
}

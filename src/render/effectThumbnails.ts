import { initGpu, type GpuContext } from "./gpuContext";
import { Renderer } from "./renderer";
import { openDocument } from "../layers/openedDocument";
import { thumbnailSourceSize, EFFECT_THUMBNAIL_BOX } from "./effectThumbnailCache";
import type { CanvasPixelSize } from "../layers/canvasFormat";
import type { ExportedFrame } from "../export/exportImage";

/**
 * VIGNETTES DE LA GALERIE D'EFFETS — la moitié GPU du chemin (ticket 05).
 *
 * ── LA MINI-PILE, ET POURQUOI CE N'EST PAS LA PILE RÉELLE RÉDUITE ───────────
 *
 * Une vignette rend DEUX calques : la source (le composite du document, déjà
 * réduit, fourni par l'appelant) et le seul effet survolé, à ses défauts. Ce
 * n'est pas un raccourci — réduire la pile RÉELLE bute sur deux choses
 * mesurées au cadrage du 2026-08-26 : un masque peint ne se ré-échantillonne
 * pas (`MaskTextureResolver` suppose un raster exactement `width × height`, et
 * `maskUpload.computeR8UploadRegion` lit `bytesPerRow = width` — un raster
 * pleine taille dans une texture réduite est silencieusement faux), et
 * `allocateDocument` est destructif et monolithique. La mesure du ticket 04
 * autorise ce raccourci : à cette échelle le coût ne dépend PAS de l'effet.
 *
 * ── UN SECOND RENDERER, SUR UN CANVAS DÉTACHÉ ───────────────────────────────
 *
 * Précédent direct : `scripts/render-check.mjs`, où deux `Renderer` coexistent
 * déjà. `initGpu` crée un device NEUF — acceptable ici, la mini-pile n'uploade
 * que la source réduite (~150 Ko) et ne partage aucune texture avec le renderer
 * de l'application. Le canvas, lui, n'est JAMAIS peint : tout passe par
 * `exportFrame`, dont la destination est la texture d'export et non la surface
 * de présentation. Il n'existe que parce qu'un `GpuContext` se construit à
 * partir d'un `GPUCanvasContext`.
 *
 * ── CE QUE LA VIGNETTE NE MONTRE PAS, ET C'EST ASSUMÉ ───────────────────────
 *
 * ⚠️ Aucun catalogue de textures n'est posé sur ce renderer. Un effet qui
 * déclare `libraryTexture` (`texture`, `displacementMap` en source
 * Bibliothèque) rend donc le REPLI 1×1 : sa vignette montre l'effet privé de sa
 * matière. C'est délibéré — charger un scan 8K pour un survol coûterait plus
 * que tout le reste du chemin réuni (887 ms d'IPC + 1125 ms de décodage
 * mesurés le 2026-08-05) — mais ce n'est pas invisible pour autant, et c'est
 * la limite à lever en premier si ces deux vignettes déçoivent.
 * `exportFrame` attend `awaitPending()` : sans catalogue rien n'est en vol,
 * donc cette attente est un no-op et non un blocage.
 */

/** Renderer d'aperçu : possède son device, sa source réduite et rien d'autre.
 *  Créé PARESSEUSEMENT — un utilisateur qui n'ouvre jamais le sélecteur ne paie
 *  aucun device. */
export class EffectThumbnailRenderer {
  private ctx: GpuContext | null = null;
  private renderer: Renderer | null = null;
  /** Source RÉELLEMENT chargée dans le renderer, par identité. Deux appels avec
   *  le même bitmap ne rechargent pas (`loadImage` détruit et réalloue tout). */
  private loaded: ImageBitmap | null = null;

  /** Charge (ou reconnaît) la source réduite. À appeler avant tout `render`. */
  async setSource(bitmap: ImageBitmap): Promise<void> {
    const renderer = await this.ensureRenderer(bitmap);
    if (this.loaded === bitmap) return;
    await renderer.loadImage(bitmap);
    this.loaded = bitmap;
  }

  /**
   * Rend la mini-pile « source + `effectId` aux défauts » et retourne une
   * dataURL PNG.
   *
   * `params: {}` n'est PAS un calque sans réglages : `EffectPassRunner` résout
   * chaque paramètre par `layer.params[nom] ?? p.default`, donc un calque neuf
   * porte exactement les défauts déclarés par le module — la même chose que ce
   * que l'utilisateur obtiendra en cliquant.
   */
  async render(effectId: string): Promise<string> {
    const renderer = this.renderer;
    if (renderer === null || this.loaded === null) {
      throw new Error("Vignette d'effet demandée sans source chargée (appeler setSource d'abord).");
    }
    const { stack } = openDocument(renderer, "aperçu");
    stack.addLayer(effectId);
    return dataUrlFromFrame(await renderer.exportFrame(stack.layers));
  }

  /** Détruit le renderer d'aperçu ET son device. Le device est le vrai enjeu :
   *  il n'est partagé avec personne, donc rien d'autre ne le libérerait. */
  dispose(): void {
    this.renderer?.dispose();
    this.renderer = null;
    this.ctx?.device.destroy();
    this.ctx = null;
    this.loaded = null;
  }

  private async ensureRenderer(bitmap: ImageBitmap): Promise<Renderer> {
    if (this.renderer !== null) return this.renderer;
    const canvas = document.createElement("canvas");
    // Dimensionné sur la source par correction et non par besoin : le canvas
    // n'est jamais la destination d'un rendu ici (voir l'en-tête). Le laisser à
    // son 300 × 150 par défaut ferait mentir toute inspection ultérieure.
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    this.ctx = await initGpu(canvas);
    this.renderer = new Renderer(this.ctx);
    return this.renderer;
  }
}

/**
 * Fabrique la SOURCE d'aperçu à partir d'un frame exporté par le renderer de
 * l'application : le composite entier, réduit.
 *
 * Fidélité tranchée le 2026-08-27 sur images : RÉDUIT, pas un crop 1:1. Une
 * vignette sert à reconnaître, pas à mesurer — en crop l'image est
 * méconnaissable et le bruit natif du JPEG écrase les effets doux.
 *
 * ⚠️ `createImageBitmap(imageData, { resizeWidth… })` et non un canvas 2D
 * intermédiaire : le frame d'un document 26 Mpx fait ~104 Mo, et le recopier
 * dans un `<canvas>` pleine taille pour le rétrécir en doublerait le coût
 * mémoire au pire moment. La `Uint8ClampedArray` est une VUE sur les octets
 * déjà relus, pas une copie.
 */
export async function reduceFrameToBitmap(
  frame: ExportedFrame,
  box: CanvasPixelSize = EFFECT_THUMBNAIL_BOX,
): Promise<ImageBitmap> {
  const size = thumbnailSourceSize({ width: frame.width, height: frame.height }, box);
  const data = imageDataOf(frame);
  return createImageBitmap(data, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" });
}

/** VUE `ImageData` sur les octets déjà relus — jamais une copie. Le
 *  `as ArrayBuffer` reprend le cast de `renderer.ts` (`defaultDecodeTexture`) :
 *  TypeScript type `.buffer` en `ArrayBufferLike`, qui inclut
 *  `SharedArrayBuffer`, et aucune de nos relectures n'en est un. */
function imageDataOf(frame: ExportedFrame): ImageData {
  const view = new Uint8ClampedArray(
    frame.pixels.buffer as ArrayBuffer,
    frame.pixels.byteOffset,
    frame.pixels.byteLength,
  );
  return new ImageData(view, frame.width, frame.height);
}

/** Frame relu → dataURL PNG. Le canvas est à la taille de la VIGNETTE (quelques
 *  dizaines de milliers de pixels), donc `toDataURL` y coûte une fraction de
 *  milliseconde — ce serait un tout autre calcul sur un document. */
function dataUrlFromFrame(frame: ExportedFrame): string {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Contexte 2D indisponible pour la vignette d'effet.");
  context.putImageData(imageDataOf(frame), 0, 0);
  return canvas.toDataURL("image/png");
}

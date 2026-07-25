import { FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";
import type { LayerTransform } from "../layers/types";
import { clampTransformScale } from "../ui/transform";

/**
 * WGSL de la pré-passe de résolution d'entrée d'un calque de photo
 * (ARCHITECTURE.md §4.3, approche C2). Rend photo A transformée dans une
 * texture pleine taille alignée sur le fond : RGB = échantillon de photo A
 * à l'UV inverse-transformée, alpha = couverture (1 dans les bornes de la
 * photo avec un feather ~1px en espace photo, 0 hors bornes — jamais de
 * répétition/clamp de bord visible, barre de qualité : pas de cutoff
 * jaggy). La chaîne existante (passes internes, composite, masque, blend)
 * consomme le résultat comme n'importe quelle texture d'entrée normale, via
 * le binding conditionnel `hasImageSource` de `shaderCompose.ts`.
 */
export const PHOTO_LAYER_INPUT_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var photoTexture: texture_2d<f32>;
@group(0) @binding(1) var photoSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, 8>;

@fragment
fn fs_photo_input(in: VertexOut) -> @location(0) vec4<f32> {
  let x = params[0];
  let y = params[1];
  let scale = params[2];
  let rotation = params[3];
  let bgWidth = params[4];
  let bgHeight = params[5];
  let photoWidth = params[6];
  let photoHeight = params[7];

  let px = in.uv.x * bgWidth;
  let py = in.uv.y * bgHeight;
  let dx = px - x;
  let dy = py - y;
  let c = cos(-rotation);
  let s = sin(-rotation);
  let rx = dx * c - dy * s;
  let ry = dx * s + dy * c;
  let lx = rx / scale;
  let ly = ry / scale;
  let photoPx = lx + photoWidth * 0.5;
  let photoPy = ly + photoHeight * 0.5;
  let photoUv = vec2<f32>(photoPx / photoWidth, photoPy / photoHeight);

  // I2 : edgeDistPx est mesuré en pixels PHOTO (avant application de
  // scale) - un feather de 1 pixel PHOTO ne fait qu'une fraction de pixel
  // ECRAN a scale<1 (bord crenele) et plusieurs pixels ECRAN a scale>1
  // (bord flou). On multiplie par scale pour ramener le feather en espace
  // ecran (1px ecran quel que soit le zoom de la photo).
  let edgeDistPx = min(min(photoPx, photoWidth - photoPx), min(photoPy, photoHeight - photoPy));
  let coverage = clamp(edgeDistPx * scale, 0.0, 1.0);

  let sample = textureSample(photoTexture, photoSampler, photoUv);
  return vec4<f32>(sample.rgb, coverage);
}
`;

export class PhotoLayerInputResolver {
  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  /** I4 : au plus un calque photo existe par document (`MAX_PHOTO_LAYERS`,
   *  `src/layers/photoLayer.ts`) — le resolver possède donc UNE texture
   *  cible persistante, recréée seulement quand la taille du fond change,
   *  au lieu d'une texture bgWidth×bgHeight allouée+détruite à chaque
   *  frame (~96 Mo de churn/frame à 24MP). N'est PAS poussée dans
   *  `pendingDestroy` (elle survit à la frame) — détruite uniquement par
   *  `dispose()` ou par un changement de taille de fond. */
  private cachedTarget: GPUTexture | null = null;
  private cachedWidth = 0;
  private cachedHeight = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly sampler: GPUSampler,
  ) {}

  private ensurePipeline(): { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout } {
    if (this.pipeline && this.bindGroupLayout) return { pipeline: this.pipeline, bindGroupLayout: this.bindGroupLayout };
    const module = this.device.createShaderModule({ code: PHOTO_LAYER_INPUT_WGSL });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_photo_input", targets: [{ format: this.srgbFormat }] },
    });
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    return { pipeline, bindGroupLayout };
  }

  /** Rend photo A transformée dans la texture cible persistante
   *  bgWidth×bgHeight (voir `cachedTarget`) — recréée seulement si la
   *  taille demandée diffère du cache actuel, sinon réutilisée telle
   *  quelle (elle est réécrite en entier par cette passe, `loadOp:
   *  "clear"`, donc aucune fuite de contenu d'une frame à l'autre). La
   *  texture cible N'EST PAS poussée dans `pendingDestroy` par cette
   *  méthode NI par l'appelant — elle survit à la frame, propriété du
   *  resolver, détruite seulement par `dispose()` ou un changement de
   *  taille. Seul le buffer d'uniform transitoire de CETTE passe est
   *  poussé ici. */
  resolve(
    encoder: GPUCommandEncoder,
    photoTexture: GPUTexture,
    photoWidth: number,
    photoHeight: number,
    bgWidth: number,
    bgHeight: number,
    transform: LayerTransform,
    pendingDestroy: (GPUTexture | GPUBuffer)[],
  ): GPUTexture {
    const { pipeline, bindGroupLayout } = this.ensurePipeline();
    if (!this.cachedTarget || this.cachedWidth !== bgWidth || this.cachedHeight !== bgHeight) {
      this.cachedTarget?.destroy();
      this.cachedTarget = this.device.createTexture({
        size: [bgWidth, bgHeight],
        format: this.srgbFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.cachedWidth = bgWidth;
      this.cachedHeight = bgHeight;
    }
    const target = this.cachedTarget;
    // I1 : clampTransformScale/MIN_TRANSFORM_SCALE (src/ui/transform.ts) est
    // la source unique de vérité pour le plancher d'échelle - jamais un
    // clamp dupliqué en WGSL. Sans ce clamp, un scale=0 (atteignable via un
    // futur import de preset, ARCHITECTURE.md R8) produirait `lx = rx /
    // scale` = division par zéro -> UV NaN côté GPU.
    const safeScale = clampTransformScale(transform.scale);
    const paramValues = new Float32Array([
      transform.x, transform.y, safeScale, transform.rotation,
      bgWidth, bgHeight, photoWidth, photoHeight,
    ]);
    const paramBuffer = this.device.createBuffer({ size: paramValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramBuffer, 0, paramValues);
    pendingDestroy.push(paramBuffer);

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: photoTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return target;
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.cachedTarget?.destroy();
    this.cachedTarget = null;
    this.cachedWidth = 0;
    this.cachedHeight = 0;
  }
}

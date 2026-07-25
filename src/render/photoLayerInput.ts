import { FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";
import type { LayerTransform } from "../layers/types";

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

  let edgeDistPx = min(min(photoPx, photoWidth - photoPx), min(photoPy, photoHeight - photoPy));
  let coverage = clamp(edgeDistPx, 0.0, 1.0);

  let sample = textureSample(photoTexture, photoSampler, photoUv);
  return vec4<f32>(sample.rgb, coverage);
}
`;

export class PhotoLayerInputResolver {
  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

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

  /** Rend photo A transformée dans une texture transitoire bgWidth×bgHeight.
   *  La texture cible N'EST PAS poussée dans `pendingDestroy` par cette
   *  méthode — c'est l'appelant (`FramePipelineExecutor`, qui connaît la
   *  durée de vie réelle du reste de la frame) qui décide quand la
   *  détruire, exactement comme pour les textures transitoires des passes
   *  internes d'effet (`runInternalPasses`). Seul le buffer d'uniform
   *  transitoire de CETTE passe est poussé ici. */
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
    const target = this.device.createTexture({
      size: [bgWidth, bgHeight],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const paramValues = new Float32Array([
      transform.x, transform.y, transform.scale, transform.rotation,
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
  }
}

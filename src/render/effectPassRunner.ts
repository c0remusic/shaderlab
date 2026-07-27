import type { LayerState } from "../layers/types";
import { getBlendMode } from "./blend/registry";
import type { EffectModule } from "./effects/types";
import { MAX_EFFECT_PARAMS, composeShader, FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";

export const PASSTHROUGH_EFFECT: EffectModule = {
  id: "passthrough",
  name: "Passthrough",
  params: [],
  wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
};

export const MASK_OVERLAY_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var overlaySrc: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;
@group(0) @binding(2) var overlayMask: texture_2d<f32>;
@group(0) @binding(3) var<uniform> overlayTime: f32;

@fragment
fn fs_overlay(in: VertexOut) -> @location(0) vec4<f32> {
  let img = textureSample(overlaySrc, overlaySampler, in.uv);
  let m = textureSample(overlayMask, overlaySampler, in.uv).r;
  let tint = vec3<f32>(0.791, 0.045, 0.061);
  var rgb = mix(img.rgb, tint, m * 0.28);

  // Contour au seuil 0.5 : bande de ~1.5px via dérivée d'écran, jamais de
  // tracé d'isoligne CPU (design.md, "Contour, pas seuil binaire caché").
  // Pointillés : phase animée le long de la diagonale écran, indépendante
  // du contenu du masque.
  let edgeWidth = fwidth(m) * 1.5 + 0.0001;
  let onContour = 1.0 - smoothstep(0.0, edgeWidth, abs(m - 0.5));
  let dashPhase = fract((in.position.x + in.position.y) * 0.12 - overlayTime * 1.5);
  let dashColor = select(vec3<f32>(0.0), vec3<f32>(1.0), dashPhase > 0.5);
  rgb = mix(rgb, dashColor, onContour);

  return vec4<f32>(rgb, img.a);
}
`;

type PendingDestroy = (GPUTexture | GPUBuffer)[];
type MaskResolver = (
  layer: LayerState,
  encoder: GPUCommandEncoder,
  sourceView: GPUTextureView,
  pendingDestroy: PendingDestroy,
  guideEpoch: number
) => GPUTexture;

/** Encodes stateless colour passes. Frame submission and mask residency remain
 * the caller's responsibility. */
export class EffectPassRunner {
  private readonly pipelineCache = new Map<
    string,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();
  /** Buffer d'uniform réutilisé pour `overlayTime` — créé une fois, mis à
   *  jour par `writeBuffer` à chaque tick (animation OU rendu normal),
   *  jamais recréé/détruit par frame (évite la pression allocateur d'un
   *  buffer jetable à 60fps). Détruit dans `clearPipelines()`. */
  private timeBuffer: GPUBuffer | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly width: number,
    private readonly height: number,
    private readonly sampler: GPUSampler,
    private readonly resolveMask: MaskResolver
  ) {}

  get pipelineCount(): number {
    return this.pipelineCache.size;
  }

  clearPipelines(): void {
    this.pipelineCache.clear();
    this.timeBuffer?.destroy();
    this.timeBuffer = null;
  }

  runInternalPasses(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    pendingDestroy: PendingDestroy
  ): { view: GPUTextureView; texture: GPUTexture } {
    let passInputView = sourceView;
    let prevTexture: GPUTexture | null = null;
    let lastTexture: GPUTexture | null = null;
    for (const pass of effect.passes!) {
      const passTarget = this.device.createTexture({
        size: [Math.max(1, Math.round(this.width * pass.scale)), Math.max(1, Math.round(this.height * pass.scale))],
        format: this.srgbFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const passTargetView = passTarget.createView();
      this.runEffectPass(encoder, { ...effect, wgsl: pass.wgsl }, layer, passInputView, passTargetView, { applyMask: false }, pendingDestroy);
      if (prevTexture) pendingDestroy.push(prevTexture);
      passInputView = passTargetView;
      prevTexture = passTarget;
      lastTexture = passTarget;
    }
    return { view: passInputView, texture: lastTexture! };
  }

  runOverlayPass(encoder: GPUCommandEncoder, src: GPUTexture, mask: GPUTexture, targetView: GPUTextureView, time: number): void {
    let cached = this.pipelineCache.get(MASK_OVERLAY_WGSL);
    if (!cached) {
      const module = this.device.createShaderModule({ code: MASK_OVERLAY_WGSL });
      const bindGroupLayout = this.device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ] });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_overlay", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(MASK_OVERLAY_WGSL, cached);
    }
    if (!this.timeBuffer) {
      this.timeBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.timeBuffer, 0, new Float32Array([time, 0, 0, 0]));
    const bindGroup = this.device.createBindGroup({ layout: cached.bindGroupLayout, entries: [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: mask.createView() },
      { binding: 3, resource: { buffer: this.timeBuffer } },
    ] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  runEffectPass(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null; guideEpoch?: number; imageSourceView?: GPUTextureView | null; clipCoverageView?: GPUTextureView | null } = {},
    pendingDestroy: PendingDestroy = []
  ): void {
    const { applyMask = true, prevPassView = null, guideEpoch = 0, imageSourceView = null, clipCoverageView = null } = options;
    const paramValues = new Float32Array(MAX_EFFECT_PARAMS);
    effect.params.forEach((p, idx) => { paramValues[idx] = layer.params[p.name] ?? p.default; });
    const paramBuffer = this.device.createBuffer({ size: paramValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramBuffer, 0, paramValues);
    pendingDestroy.push(paramBuffer);

    const blendMode = getBlendMode(layer.blendMode ?? "normal");
    const hasImageSource = imageSourceView !== null;
    const clipToCoverage = clipCoverageView !== null;
    // Binding 6 partagé (voir shaderCompose) : la vue vient du calque lui-même
    // (photo) ou de la base photo du DESSOUS (écrêtage). `composeShader` lève
    // si les deux sont posés — assert inatteignable, pas de repli ici.
    const coverageView = imageSourceView ?? clipCoverageView;
    const shaderCode = composeShader(effect.wgsl, { applyMask, hasPrevPass: prevPassView !== null, hasImageSource, clipToCoverage, blendWgsl: applyMask ? blendMode.wgsl : undefined });
    let compositingBuffer: GPUBuffer | null = null;
    if (applyMask) {
      const compositing = new Float32Array([layer.opacity ?? 1, 0, 0, 0]);
      compositingBuffer = this.device.createBuffer({ size: compositing.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(compositingBuffer, 0, compositing);
      pendingDestroy.push(compositingBuffer);
    }

    let cached = this.pipelineCache.get(shaderCode);
    if (!cached) {
      const module = this.device.createShaderModule({ code: shaderCode });
      const layoutEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ];
      if (applyMask) layoutEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (prevPassView) layoutEntries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (applyMask) layoutEntries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
      if (applyMask && coverageView) layoutEntries.push({ binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      const bindGroupLayout = this.device.createBindGroupLayout({ entries: layoutEntries });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_wrapper", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(shaderCode, cached);
    }

    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sourceView },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: paramBuffer } },
    ];
    if (applyMask) entries.push({ binding: 3, resource: this.resolveMask(layer, encoder, sourceView, pendingDestroy, guideEpoch).createView() });
    if (prevPassView) entries.push({ binding: 4, resource: prevPassView });
    if (applyMask && compositingBuffer) entries.push({ binding: 5, resource: { buffer: compositingBuffer } });
    if (applyMask && coverageView) entries.push({ binding: 6, resource: coverageView });
    const bindGroup = this.device.createBindGroup({ layout: cached.bindGroupLayout, entries });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}

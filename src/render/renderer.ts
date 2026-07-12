import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { getEffect } from "./effects/registry";
import type { EffectModule } from "./effects/types";

const FULLSCREEN_VERTEX_WGSL = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(pos[i], 0.0, 1.0);
  out.uv = pos[i] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return out;
}
`;

const PASSTHROUGH_EFFECT: EffectModule = {
  id: "passthrough",
  name: "Passthrough",
  params: [],
  wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
};

/**
 * Multi-pass renderer: ping-pongs between two off-screen render targets, one
 * pass per enabled layer. All off-screen intermediate textures (source,
 * ping-pong pair) are created with `ctx.srgbFormat`, matching Task 2's
 * established pattern (srgbFormat is fine for regular textures — the
 * "no -srgb format" restriction only applies to GPUCanvasContext.configure()).
 * The final pass writes into the canvas via `getSrgbCanvasView`, so the
 * pipeline's fragment target format is always `ctx.srgbFormat`, whether the
 * target is an off-screen texture view or the canvas's sRGB view.
 */
export class Renderer {
  private ctx: GpuContext;
  private sourceTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;
  private pingPong: [GPUTexture, GPUTexture] | null = null;
  private sampler: GPUSampler;

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    this.sampler = ctx.device.createSampler({ magFilter: "linear", minFilter: "linear" });
  }

  async loadImage(bitmap: ImageBitmap): Promise<void> {
    this.width = bitmap.width;
    this.height = bitmap.height;
    const { device, srgbFormat } = this.ctx;

    const makeTarget = () =>
      device.createTexture({
        size: [this.width, this.height],
        format: srgbFormat,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC,
      });

    this.sourceTexture = device.createTexture({
      size: [this.width, this.height],
      format: srgbFormat,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.sourceTexture },
      [this.width, this.height]
    );

    this.pingPong = [makeTarget(), makeTarget()];
  }

  render(layers: LayerState[]): void {
    if (!this.sourceTexture || !this.pingPong) throw new Error("Aucune image chargée.");
    const { device } = this.ctx;

    let readTexture = this.sourceTexture;
    let writeIndex = 0;
    const enabledLayers = layers.filter((l) => l.enabled);

    const encoder = device.createCommandEncoder();

    if (enabledLayers.length === 0) {
      // Nothing to composite — blit the source straight to the canvas.
      this.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        { id: "", effectId: "", params: {}, enabled: true, maskData: null },
        readTexture.createView(),
        getSrgbCanvasView(this.ctx)
      );
      device.queue.submit([encoder.finish()]);
      return;
    }

    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const effect = getEffect(layer.effectId);
      const isLast = i === enabledLayers.length - 1;
      const targetView = isLast
        ? getSrgbCanvasView(this.ctx)
        : this.pingPong[writeIndex].createView();

      this.runEffectPass(encoder, effect, layer, readTexture.createView(), targetView);

      if (!isLast) {
        readTexture = this.pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }

    device.queue.submit([encoder.finish()]);
  }

  private runEffectPass(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView
  ): void {
    const { device, srgbFormat } = this.ctx;
    const paramValues = new Float32Array(8);
    effect.params.forEach((p, idx) => {
      paramValues[idx] = layer.params[p.name] ?? p.default;
    });
    const paramBuffer = device.createBuffer({
      size: paramValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramBuffer, 0, paramValues);

    const shaderCode = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, 8>;
@group(0) @binding(3) var maskTexture: texture_2d<f32>;

${effect.wgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effected = fs_main(in.uv, color);
  let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  return mix(color, effected, maskValue);
}
`;
    const module = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_wrapper", targets: [{ format: srgbFormat }] },
    });
    const maskTexture = this.uploadMask(layer.maskData);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramBuffer } },
        { binding: 3, resource: maskTexture.createView() },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  async readPixels(): Promise<Uint8Array> {
    const { device } = this.ctx;
    if (!this.pingPong) throw new Error("Aucune image chargée.");
    const bytesPerRow = Math.ceil((this.width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    // Read back whichever ping-pong target last held the final off-screen
    // pass output. render() always writes the true final frame straight to
    // the canvas (not an off-screen texture), so for export (Task 10)
    // callers must re-render into an off-screen texture of the same format
    // before calling readPixels — documented here for that task.
    encoder.copyTextureToBuffer(
      { texture: this.pingPong[0] },
      { buffer, bytesPerRow },
      [this.width, this.height]
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    return data;
  }

  /**
   * Uploads a layer's mask into an r8unorm texture. A mask is a linear
   * 0..1 opacity weight, not color data, so it deliberately does NOT use
   * `ctx.srgbFormat` — treating it as sRGB would bias the falloff curve.
   * `maskData === null` (no mask painted) uploads a fully-opaque mask so
   * the effect applies everywhere, matching pre-Task-9 behavior.
   */
  private uploadMask(maskData: Uint8Array | null): GPUTexture {
    const { device } = this.ctx;
    const texture = device.createTexture({
      size: [this.width, this.height],
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const fullMask = maskData ?? new Uint8Array(this.width * this.height).fill(255);
    device.queue.writeTexture(
      { texture },
      fullMask as BufferSource,
      { bytesPerRow: this.width },
      [this.width, this.height]
    );
    return texture;
  }
}

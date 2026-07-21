import { noopDiagnosticLogger, type DiagnosticLogger } from "./diagnostics";

export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  /** Base format the canvas is configured with (non-sRGB — WebGPU forbids
   *  configuring a canvas context directly in an "-srgb" format). Use this
   *  only for the canvas's own configure() call. */
  canvasFormat: GPUTextureFormat;
  /** sRGB view format to request when creating a view of the canvas's
   *  current texture, so the final composite pass still gets automatic
   *  linear→sRGB encoding on write. All OFF-SCREEN intermediate render
   *  targets (ping-pong buffers, mask textures) are created directly with
   *  this format via createTexture() — that restriction only applies to
   *  GPUCanvasContext.configure(), not to regular textures. */
  srgbFormat: GPUTextureFormat;
}

export async function initGpu(
  canvas: HTMLCanvasElement,
  onFatalError?: (message: string) => void,
  diagnosticLogger: DiagnosticLogger = noopDiagnosticLogger
): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU non disponible sur ce navigateur/GPU.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Aucun adaptateur WebGPU trouvé.");
  }
  // Sans requiredLimits, le device retombe aux limites par défaut de la spec
  // (maxTextureDimension2D = 8192) même si le matériel fait mieux — un JPEG
  // panoramique > 8192 px échouerait à createTexture. On demande le maximum
  // que l'adapter supporte réellement.
  const device = await adapter.requestDevice({
    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
  });
  // Debugging-only (see log_diagnostic in lib.rs): this app currently has NO
  // handler for device loss at all — a GPU-side reset/OOM goes completely
  // unobserved. Real crash dumps (2026-07-14/15) show 3 renderer OOM aborts
  // (exception 0xE0000008) during mask painting on a large photo; this
  // handler is here to catch whether device.lost ever actually fires with a
  // reason before that hard abort, or whether the abort preempts it entirely.
  // device.lost is always fatal (the device is gone) — unlike
  // onuncapturederror below, which can fire for recoverable validation
  // errors, this is the one GPU signal that must reach the user, not just
  // the diagnostic log (audit 2026-07-17, finding 1).
  device.lost.then((info) => {
    diagnosticLogger(`GPU device lost: reason=${info.reason} message=${info.message}`);
    onFatalError?.("Le GPU a redémarré ou a manqué de mémoire — rouvre l'image.");
  });
  // Debugging-only (see log_diagnostic in lib.rs): no uncaptured-error
  // handler existed before this — any GPU validation/OOM error the browser
  // itself surfaces (as opposed to a hard renderer-process abort) was going
  // completely unlogged. Added 2026-07-15 to investigate the mask-paint
  // freeze/crash alongside targeted pushErrorScope calls in renderer.ts.
  device.onuncapturederror = (event) => {
    diagnosticLogger(`GPU uncaptured error: ${event.error.constructor.name}: ${event.error.message}`);
  };
  diagnosticLogger(`GPU limits: maxTextureDimension2D=${adapter.limits.maxTextureDimension2D} maxBufferSize=${adapter.limits.maxBufferSize}`);
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  if (!context) {
    throw new Error("Impossible d'obtenir un contexte WebGPU sur le canvas.");
  }
  // navigator.gpu.getPreferredCanvasFormat() returns "bgra8unorm" or
  // "rgba8unorm" — GPUCanvasContext.configure() only accepts these (plus
  // rgba16float), never an "-srgb" variant (confirmed via MDN + Chromium
  // issue tracker after a real runtime error on this exact line).
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  const srgbFormat = `${canvasFormat}-srgb` as GPUTextureFormat;
  context.configure({
    device,
    format: canvasFormat,
    viewFormats: [srgbFormat],
    alphaMode: "opaque",
  });
  return { device, context, canvasFormat, srgbFormat };
}

/** View of the canvas's current texture in the sRGB format, for the final
 *  composite pass to write into (auto linear→sRGB encode on write). */
export function getSrgbCanvasView(ctx: GpuContext): GPUTextureView {
  return ctx.context.getCurrentTexture().createView({ format: ctx.srgbFormat });
}

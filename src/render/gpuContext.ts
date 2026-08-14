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

/** Hard ceiling on the number of recoverable-GPU-error lines a single session
 *  may emit. `onuncapturederror` can fire once per frame; without a ceiling a
 *  single broken pass would fill the journal with the same line at 60 Hz. */
export const GPU_ERROR_MAX_REPORTS = 20;
/** Two identical messages closer together than this only bump a counter; the
 *  count is folded into the next line that does get through. */
export const GPU_ERROR_REPEAT_WINDOW_MS = 5_000;

export interface GpuErrorReporterOptions {
  maxReports?: number;
  repeatWindowMs?: number;
  /** Injectable clock — the debounce is time-based, so tests drive it here
   *  rather than waiting on a real one. */
  now?: () => number;
}

/**
 * Bounded, de-duplicating channel for RECOVERABLE GPU errors.
 *
 * Separate from the fatal channel on purpose (see `device.lost` below): an
 * uncaptured validation error does not mean the device is gone, so routing it
 * to `onFatalError` would tell the user "the GPU restarted" for something it
 * survived. It also fires from the render loop, so the sink must be protected
 * from a per-frame burst.
 *
 * Contract: the first occurrence of a given message is always emitted;
 * identical repeats inside `repeatWindowMs` are counted, not emitted, and the
 * count rides along on the next emission for that message. After
 * `maxReports` emitted lines the reporter emits one final "stopped" line and
 * goes permanently silent — which also bounds its own memory, since a new map
 * entry is only ever created while under the ceiling.
 */
export function createGpuErrorReporter(
  sink: DiagnosticLogger,
  {
    maxReports = GPU_ERROR_MAX_REPORTS,
    repeatWindowMs = GPU_ERROR_REPEAT_WINDOW_MS,
    now = () => Date.now(),
  }: GpuErrorReporterOptions = {}
): (message: string) => void {
  const seen = new Map<string, { windowStart: number; suppressed: number }>();
  let emitted = 0;
  let stopped = false;

  const emit = (line: string): void => {
    if (emitted >= maxReports) {
      stopped = true;
      sink(
        `GPU error reporting stopped after ${maxReports} entries — further recoverable errors are not logged.`
      );
      return;
    }
    emitted += 1;
    sink(line);
  };

  return (message: string): void => {
    if (stopped) return;
    const entry = seen.get(message);
    if (!entry) {
      seen.set(message, { windowStart: now(), suppressed: 0 });
      emit(message);
      return;
    }
    entry.suppressed += 1;
    const elapsed = now() - entry.windowStart;
    if (elapsed < repeatWindowMs) return;
    emit(`${message} (repeated ${entry.suppressed} times in ${elapsed} ms)`);
    entry.windowStart = now();
    entry.suppressed = 0;
  };
}

export async function initGpu(
  canvas: HTMLCanvasElement,
  onFatalError?: (message: string) => void,
  diagnosticLogger: DiagnosticLogger = noopDiagnosticLogger,
  /** Sink for recoverable GPU errors. Distinct from `diagnosticLogger`, which
   *  is expected to be debugging-only (it no-ops outside dev builds, see
   *  `logDiagnostic` in launch.ts): this one must still record in a shipped
   *  build. Falls back to `diagnosticLogger` when the caller has no durable
   *  channel to offer. */
  gpuErrorLogger?: DiagnosticLogger
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
  //
  // `timestamp-query` est demandée SI et SEULEMENT SI l'adapter l'annonce, et
  // son absence n'est jamais une erreur : elle ne sert qu'au chronométrage GPU
  // par passe (`gpuTiming.ts`), un instrument de diagnostic. Une machine qui ne
  // l'a pas doit rendre des images, pas refuser de démarrer. Demander une
  // feature absente ferait rejeter `requestDevice` en bloc.
  const featuresOptionnelles: GPUFeatureName[] = adapter.features.has("timestamp-query")
    ? ["timestamp-query"]
    : [];
  const device = await adapter.requestDevice({
    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
    requiredFeatures: featuresOptionnelles,
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
  // Recoverable GPU errors — any validation/OOM error the browser surfaces
  // itself, as opposed to a hard renderer-process abort. Added 2026-07-15 to
  // investigate the mask-paint freeze/crash.
  //
  // These take a channel of their OWN (`gpuErrorLogger`, bounded + debounced
  // by createGpuErrorReporter) rather than `diagnosticLogger`, which no-ops
  // outside dev builds — so before 2026-07-31 every one of these errors was
  // silent in a shipped build. They deliberately do NOT reach `onFatalError`:
  // the device survived, and claiming otherwise to the user would be false.
  //
  // An earlier version of this comment claimed these were logged "alongside
  // targeted pushErrorScope calls in renderer.ts". No such calls ever
  // existed: `grep -rn 'pushErrorScope|popErrorScope' src/` matches this file
  // only (the two other hits in the repo are in scripts/gpu-shader-check.mjs,
  // the offline shader compiler check, not the app).
  const reportGpuError = createGpuErrorReporter(gpuErrorLogger ?? diagnosticLogger);
  device.onuncapturederror = (event) => {
    reportGpuError(`GPU uncaptured error: ${event.error.constructor.name}: ${event.error.message}`);
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

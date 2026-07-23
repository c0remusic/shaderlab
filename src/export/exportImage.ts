import type { LayerState } from "../layers/types";

/** Input boundary for the application export use case. */
export interface FrameRenderer {
  exportFrame(layers: LayerState[]): Promise<Uint8Array>;
}

/** Output boundary for the application export use case. */
export interface ImageWriter {
  write(path: string, bytes: Uint8Array): Promise<void>;
}

/** Yields `-edited`, `-edited-2`, `-edited-3`, ... candidate copy paths for
 *  `sourcePath`, indefinitely — the single naming rule shared by the
 *  synchronous (`buildCopyPath`, Set-backed, used by callers that already
 *  hold every occupied name in memory) and asynchronous (`resolveExportTargetAsync`,
 *  disk-backed) collision resolvers below, so the two can never drift apart
 *  on what the Nth candidate name actually is. */
function* candidateCopyPaths(sourcePath: string): Generator<string> {
  const lastDot = sourcePath.lastIndexOf(".");
  const base = lastDot === -1 ? sourcePath : sourcePath.slice(0, lastDot);
  const ext = lastDot === -1 ? "" : sourcePath.slice(lastDot);
  yield `${base}-edited${ext}`;
  let counter = 2;
  while (true) {
    yield `${base}-edited-${counter}${ext}`;
    counter += 1;
  }
}

export function buildCopyPath(sourcePath: string, existing: Set<string> = new Set()): string {
  for (const candidate of candidateCopyPaths(sourcePath)) {
    if (!existing.has(candidate)) return candidate;
  }
  /* istanbul ignore next -- candidateCopyPaths never terminates on its own;
   * TS control-flow analysis can't prove that, so this satisfies the
   * "string" return type without ever actually running. */
  throw new Error("unreachable");
}

/** Input boundary the export path resolver uses to ask whether a candidate
 *  path already exists on disk. Backed by the Tauri `path_exists` command in
 *  production (`launch.ts`'s `pathExists`); a Set-backed fake in tests. */
export interface PathAvailability {
  exists(path: string): Promise<boolean>;
}

async function encodeJpeg(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height);
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Decides the write target for an export, enforcing the project's
 * copy-vs-overwrite safety rule:
 *
 * - Normal manual export (image opened via drag&drop or a file picker,
 *   `isLaunchFile: false`): ALWAYS returns a fresh non-colliding path via
 *   `buildCopyPath`. The original file is never touched.
 * - Lightroom round-trip (app launched with a CLI arg, `isLaunchFile: true`
 *   because the open image's path came from `getLaunchPath()`): returns
 *   `sourcePath` unchanged, overwriting it in place. This is intentional —
 *   Lightroom already created its own temp copy upstream before invoking
 *   this app, so overwriting that copy is the correct round-trip contract,
 *   not a violation of the copy-only rule.
 *
 * Callers must derive `isLaunchFile` from whether the currently open image's
 * path came from `getLaunchPath()`, not by comparing strings — a drag&dropped
 * file could coincidentally share a path with a prior launch file across
 * separate opens, so the flag must be tracked alongside the open, not
 * recomputed from the path itself.
 *
 * Checks real disk state via `availability`, not an in-memory set the caller
 * has to keep synced — a candidate that looked free a moment ago (or that no
 * caller ever recorded) is exactly the "manual export overwrites an existing
 * file" bug this replaces. Never probes disk for a launch-file export: the
 * round-trip contract overwrites `sourcePath` unconditionally.
 */
export async function resolveExportTargetAsync(
  sourcePath: string,
  isLaunchFile: boolean,
  availability: PathAvailability
): Promise<string> {
  if (isLaunchFile) return sourcePath;
  for (const candidate of candidateCopyPaths(sourcePath)) {
    if (!(await availability.exists(candidate))) return candidate;
  }
  /* istanbul ignore next -- see the matching comment in buildCopyPath. */
  throw new Error("unreachable");
}

/**
 * Renders the current layer stack and writes the result to `targetPath`.
 * Caller decides `targetPath`: a fresh copy path (manual export, via
 * buildCopyPath) or the exact Lightroom launch path (round-trip export,
 * per the design doc's contract — overwrite in place).
 *
 * Uses `renderer.exportFrame()`, NOT `render()` + a raw ping-pong readback.
 * `render()` writes its final pass straight to the canvas, never into the
 * ping-pong buffers — reading `pingPong[0]` back after `render()` would
 * return stale data from an intermediate pass, not the actual final
 * composited frame (a real bug flagged in Task 5's review). `exportFrame()`
 * reruns the same multi-pass pipeline targeting a dedicated off-screen
 * texture for every pass, including the last one, so its readback is always
 * correct.
 */
export async function exportImage(
  frameRenderer: FrameRenderer,
  imageWriter: ImageWriter,
  layers: LayerState[],
  targetPath: string,
  width: number,
  height: number
): Promise<void> {
  const pixels = await frameRenderer.exportFrame(layers);
  const jpegBytes = await encodeJpeg(pixels, width, height);
  await imageWriter.write(targetPath, jpegBytes);
}

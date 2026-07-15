import type { DirtyRect } from "../mask/maskPainter";

export interface R8UploadRegion {
  origin: { x: number; y: number };
  dataLayout: { offset: number; bytesPerRow: number };
  size: { width: number; height: number };
}

/**
 * Computes the WebGPU `writeTexture` arguments to upload `rect` (or the
 * whole `width`×`height` image when `rect` is omitted) from a
 * tightly-packed r8unorm source buffer of that same `width`×`height`.
 *
 * No sub-buffer copy is needed to address a rectangle smaller than the
 * source: `dataLayout.bytesPerRow` describes the SOURCE buffer's row
 * stride (the full image width), and `dataLayout.offset` points at the
 * rectangle's first byte within it — WebGPU reads `size.width` bytes per
 * row from there, `size.height` rows, each subsequent row starting
 * `bytesPerRow` bytes later in the source.
 *
 * Extracted as a pure function (2026-07-15) so this arithmetic — added to
 * fix a reproducible renderer OOM crash from full-buffer mask uploads at
 * real paint-stroke sampling rates — has real test coverage instead of
 * living untested inside `Renderer`.
 */
export function computeR8UploadRegion(width: number, height: number, rect?: DirtyRect): R8UploadRegion {
  if (!rect) {
    return { origin: { x: 0, y: 0 }, dataLayout: { offset: 0, bytesPerRow: width }, size: { width, height } };
  }
  return {
    origin: { x: rect.x, y: rect.y },
    dataLayout: { offset: rect.y * width + rect.x, bytesPerRow: width },
    size: { width: rect.width, height: rect.height },
  };
}

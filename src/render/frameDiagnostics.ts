import type { DiagnosticLogger } from "./diagnostics";

/** Work completed by one submitted frame. */
export interface FrameStats {
  enabledLayerCount: number;
  churnedResourceCount: number;
}

/** Stable renderer facts included in the periodic frame diagnostic. */
export interface FrameDiagnosticFacts {
  pipelineCacheSize: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * Emits the bounded renderer diagnostic used while investigating GPU memory
 * pressure. It owns cadence and formatting; Renderer supplies measurements
 * and resource facts.
 */
export class FrameDiagnostics {
  private frameCount = 0;

  constructor(
    private readonly logger: DiagnosticLogger,
    private readonly now: () => number = () => performance.now(),
  ) {}

  record(
    frameStartedAtMs: number,
    stats: FrameStats,
    facts: FrameDiagnosticFacts,
  ): void {
    this.frameCount++;
    if (this.frameCount % 15 !== 0) return;

    const elapsedMs = Math.round((this.now() - frameStartedAtMs) * 100) / 100;
    this.logger(
      `frame#${this.frameCount} jsEncodeMs=${elapsedMs} enabledLayers=${stats.enabledLayerCount} ` +
        // `residentMaskTextures` a été RETIRÉ de cette ligne le 2026-09-15 : il
        // imprimait `resolver-owned` EN DUR, donc un champ qui ne mesurait plus
        // rien dans l'outil même qui sert à instruire la pression VRAM. Le
        // compte réel se prend par `MaskTextureResolver.drainDiagnostics`.
        `churnedThisFrame=${stats.churnedResourceCount} ` +
        `pipelineCacheSize=${facts.pipelineCacheSize} imageSize=${facts.imageWidth}x${facts.imageHeight}`,
    );
  }
}

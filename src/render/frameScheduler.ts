/**
 * Coalesce N demandes par frame en UNE exécution au prochain
 * requestAnimationFrame, avec le dernier payload demandé. Les drags de
 * slider et les samples de pinceau émettent un événement par pointer-move
 * (souvent 2-4x plus fréquents que les frames affichables) — sans
 * coalescing, chaque événement paie un pipeline complet full-res.
 * rAF/cancel injectables : testable en env Node (pas de rAF global).
 */
export class FrameScheduler<T> {
  private rafId: number | null = null;
  private pending: T | null = null;

  constructor(
    private readonly run: (payload: T) => void,
    private readonly raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    private readonly caf: (id: number) => void = (id) => cancelAnimationFrame(id)
  ) {}

  request(payload: T): void {
    this.pending = payload;
    if (this.rafId !== null) return;
    this.rafId = this.raf(() => {
      this.rafId = null;
      const latest = this.pending as T;
      this.pending = null;
      this.run(latest);
    });
  }

  cancel(): void {
    if (this.rafId === null) return;
    this.caf(this.rafId);
    this.rafId = null;
    this.pending = null;
  }
}

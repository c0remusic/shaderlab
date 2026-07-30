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

  /**
   * Exécute IMMÉDIATEMENT le payload en attente, et annule la frame qui était
   * programmée pour lui. No-op quand rien n'attend.
   *
   * C'est la sortie de geste : `cancel()` JETTE le dernier payload, donc
   * l'appeler sur un `pointerup` perdrait la dernière position du pointeur —
   * l'état coalescé resterait sur l'avant-dernier échantillon pendant que le
   * reste du monde (rendu GPU, session) a déjà vu le dernier. Même distinction
   * que `Canvas.endStroke` (flush volontaire en fin de trait) vs son cleanup de
   * démontage (annulation sans flush).
   */
  flush(): void {
    if (this.rafId === null) return;
    this.caf(this.rafId);
    this.rafId = null;
    const latest = this.pending as T;
    this.pending = null;
    this.run(latest);
  }

  cancel(): void {
    if (this.rafId === null) return;
    this.caf(this.rafId);
    this.rafId = null;
    this.pending = null;
  }
}

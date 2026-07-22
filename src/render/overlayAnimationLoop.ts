/**
 * Boucle rAF continue et autonome — contrairement à `FrameScheduler`, qui
 * coalesce N requêtes en UNE frame puis s'arrête, celle-ci appelle `cb`
 * à CHAQUE frame tant qu'elle est démarrée. Sert uniquement à faire avancer
 * la phase des pointillés de l'overlay de masque (voir
 * `Renderer.tickOverlayAnimation`) — jamais à déclencher un rendu complet.
 * rAF/cancelAnimationFrame injectables au constructeur : testable en env
 * Node (pas de rAF global), même pattern que `frameScheduler.ts`.
 */
export class OverlayAnimationLoop {
  private rafId: number | null = null;

  constructor(
    private readonly raf: (cb: (timeMs: number) => void) => number = (cb) =>
      requestAnimationFrame(cb),
    private readonly caf: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}

  get running(): boolean {
    return this.rafId !== null;
  }

  start(cb: (timeMs: number) => void): void {
    if (this.rafId !== null) return;
    const tick = (timeMs: number) => {
      cb(timeMs);
      this.rafId = this.raf(tick);
    };
    this.rafId = this.raf(tick);
  }

  stop(): void {
    if (this.rafId === null) return;
    this.caf(this.rafId);
    this.rafId = null;
  }
}

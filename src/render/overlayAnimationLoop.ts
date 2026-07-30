/**
 * Boucle rAF autonome — contrairement à `FrameScheduler`, qui coalesce N
 * requêtes en UNE frame puis s'arrête, celle-ci rappelle `cb` tant qu'elle est
 * démarrée. Sert uniquement à faire avancer la phase des pointillés de
 * l'overlay de masque (voir `Renderer.tickOverlayAnimation`) — jamais à
 * déclencher un rendu complet.
 *
 * Elle n'appelle PAS `cb` à chaque frame d'affichage : chaque appel réencode
 * deux passes plein canvas sur le GPU (~1,3 ms mesurées à 6240×4160), et la
 * fenêtre WebView2 de ce projet tire le rAF à ~166 Hz, soit ~250 ms de GPU
 * consommées par seconde d'inactivité — un tiers d'un geste continu, en
 * permanence, pour une phase de pointillés. Deux garde-fous :
 *
 *  - **Cadence plafonnée** à `OVERLAY_ANIMATION_FPS`. Les pointillés défilent
 *    de 1,5 période par seconde le long de la diagonale écran, et une période
 *    vaut ~8,3 px de canvas (`MASK_OVERLAY_WGSL`, `effectPassRunner.ts`) :
 *    l'animation avance donc de ~12,5 px de canvas par seconde. À 15 images
 *    par seconde, un pas fait moins d'un pixel de canvas — et le canvas est
 *    lui-même affiché réduit. Rien à voir à l'œil, ~90 % de GPU en moins.
 *  - **Rien n'est encodé quand le document est caché** (`visibilityState`) :
 *    `requestAnimationFrame` n'est pas garanti d'être suspendu dans ce cas,
 *    donc on ne peut pas compter dessus pour arrêter le GPU.
 *    ⚠️ MESURÉ le 2026-07-30, à ne pas re-supposer : sur la WebView2 de ce
 *    projet, **minimiser la fenêtre ne rend PAS le document caché**.
 *    `IsIconic` passe à `True` alors que `document.visibilityState` reste
 *    `visible`, le rAF continue de tirer à ~165 Hz et l'overlay continue
 *    d'encoder. Ce garde ne couvre donc pas la fenêtre minimisée ; ce qui
 *    borne ce cas-là, c'est la cadence plafonnée ci-dessus. Le garde reste
 *    parce qu'il est la bonne réponse au signal qu'il nomme, mais il ne faut
 *    pas lui prêter la fenêtre minimisée.
 *
 * Aucun des deux ne peut laisser la boucle définitivement muette : le rAF
 * continue de se réarmer, seul l'appel à `cb` est sauté. Dès que le document
 * redevient visible, ou que l'intervalle est écoulé, la frame suivante encode.
 *
 * rAF/cancelAnimationFrame/visibilité injectables au constructeur : testable
 * en env Node (pas de rAF ni de `document` globaux), même pattern que
 * `frameScheduler.ts`.
 */

/** Cadence maximale de l'animation de pointillés, en images par seconde.
 *  Voir le commentaire de classe pour le calcul qui rend 15 imperceptible. */
export const OVERLAY_ANIMATION_FPS = 15;

export class OverlayAnimationLoop {
  private rafId: number | null = null;
  /** Horodatage rAF du dernier `cb` RÉELLEMENT appelé. `null` = aucun encore,
   *  donc la prochaine frame passe sans attendre — c'est ce qui rend le
   *  redémarrage après `stop()` immédiat plutôt que différé d'un intervalle. */
  private lastCallbackMs: number | null = null;

  constructor(
    private readonly raf: (cb: (timeMs: number) => void) => number = (cb) =>
      requestAnimationFrame(cb),
    private readonly caf: (id: number) => void = (id) => cancelAnimationFrame(id),
    private readonly minIntervalMs: number = 1000 / OVERLAY_ANIMATION_FPS,
    private readonly isDocumentHidden: () => boolean = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden",
  ) {}

  get running(): boolean {
    return this.rafId !== null;
  }

  start(cb: (timeMs: number) => void): void {
    if (this.rafId !== null) return;
    this.lastCallbackMs = null;
    const tick = (timeMs: number) => {
      if (this.shouldEncode(timeMs)) {
        this.lastCallbackMs = timeMs;
        cb(timeMs);
      }
      // `cb` peut avoir appelé `stop()` : ne pas réarmer par-dessus.
      if (this.rafId === null) return;
      this.rafId = this.raf(tick);
    };
    this.rafId = this.raf(tick);
  }

  stop(): void {
    if (this.rafId === null) return;
    this.caf(this.rafId);
    this.rafId = null;
    this.lastCallbackMs = null;
  }

  private shouldEncode(timeMs: number): boolean {
    if (this.isDocumentHidden()) return false;
    if (this.lastCallbackMs === null) return true;
    return timeMs - this.lastCallbackMs >= this.minIntervalMs;
  }
}

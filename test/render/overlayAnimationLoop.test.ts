import { describe, it, expect } from "vitest";
import { OverlayAnimationLoop, OVERLAY_ANIMATION_FPS } from "../../src/render/overlayAnimationLoop";

/** Faux rAF manuel : capture les callbacks (qui reçoivent un timestamp),
 *  `flush(t)` simule une frame à l'instant t. Même pattern que
 *  frameScheduler.test.ts. */
function fakeRaf() {
  const queue = new Map<number, (t: number) => void>();
  let nextId = 1;
  return {
    raf: (cb: (t: number) => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      queue.delete(id);
    },
    flush: (t: number) => {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb(t));
    },
    pending: () => queue.size,
  };
}

/** Les tests de structure (réarmement, stop, running) mesurent la mécanique du
 *  rAF, pas la cadence : ils passent `minIntervalMs = 0` pour que CHAQUE frame
 *  encode. La cadence a son propre bloc plus bas. */
const sansPlafond = (raf: (cb: (t: number) => void) => number, caf: (id: number) => void) =>
  new OverlayAnimationLoop(raf, caf, 0, () => false);

describe("OverlayAnimationLoop", () => {
  it("does not schedule a frame before start()", () => {
    const { pending } = fakeRaf();
    expect(pending()).toBe(0);
  });

  it("schedules a frame on start() and re-arms itself after each tick", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = sansPlafond(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    expect(pending()).toBe(1);
    flush(16);
    expect(ticks).toEqual([16]);
    expect(pending()).toBe(1);
  });

  it("keeps ticking across multiple frames", () => {
    const { raf, caf, flush } = fakeRaf();
    const loop = sansPlafond(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    flush(16);
    flush(32);
    flush(48);
    expect(ticks).toEqual([16, 32, 48]);
  });

  it("start() is a no-op while already running", () => {
    const { raf, caf, pending } = fakeRaf();
    const loop = sansPlafond(raf, caf);
    loop.start(() => {});
    loop.start(() => {});
    expect(pending()).toBe(1);
  });

  it("stop() cancels the pending frame and halts ticking", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = sansPlafond(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    loop.stop();
    expect(pending()).toBe(0);
    flush(16);
    expect(ticks).toEqual([]);
  });

  it("does not re-arm when stop() is called synchronously from within the tick callback", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = sansPlafond(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => {
      ticks.push(t);
      loop.stop();
    });
    flush(16);
    expect(ticks).toEqual([16]);
    expect(pending()).toBe(0);
    flush(32);
    expect(ticks).toEqual([16]);
  });

  it("running reflects the current state", () => {
    const { raf, caf } = fakeRaf();
    const loop = sansPlafond(raf, caf);
    expect(loop.running).toBe(false);
    loop.start(() => {});
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });
});

describe("OverlayAnimationLoop — cadence plafonnée", () => {
  /** Le défaut est le seul chiffre qui atteint la vraie fenêtre : le tester
   *  explicitement évite qu'un plafond retiré par mégarde passe inaperçu
   *  derrière les tests qui injectent leur propre intervalle. */
  it("caps the default cadence at OVERLAY_ANIMATION_FPS", () => {
    const { raf, caf, flush } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf, undefined, () => false);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    // Une seconde de frames à 166 Hz (la cadence rAF mesurée sur la fenêtre
    // WebView2 de ce projet) : le nombre d'encodages doit suivre le plafond,
    // pas le nombre de frames.
    for (let i = 0; i < 166; i++) flush((i * 1000) / 166);
    // Borne haute stricte (le plafond est un plafond) et borne basse à une
    // frame près : l'échéance ne tombe pas pile sur une frame d'affichage, le
    // dernier encodage de la seconde peut donc manquer.
    expect(ticks.length).toBeLessThanOrEqual(OVERLAY_ANIMATION_FPS);
    expect(ticks.length).toBeGreaterThanOrEqual(OVERLAY_ANIMATION_FPS - 1);
  });

  it("skips frames that arrive before the interval, and never stops re-arming", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf, 100, () => false);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    flush(0); // premier tick : immédiat
    flush(50); // trop tôt
    flush(99); // trop tôt
    flush(100); // échéance atteinte
    flush(150); // trop tôt
    flush(210); // échéance atteinte
    expect(ticks).toEqual([0, 100, 210]);
    // La frame sautée ne doit pas éteindre la boucle — sinon l'overlay se fige
    // définitivement à la première frame trop rapprochée.
    expect(pending()).toBe(1);
    expect(loop.running).toBe(true);
  });

  it("encodes immediately on restart instead of waiting out an interval", () => {
    const { raf, caf, flush } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf, 100, () => false);
    const ticks: number[] = [];
    const cb = (t: number) => ticks.push(t);
    loop.start(cb);
    flush(1000);
    loop.stop();
    loop.start(cb);
    // 1010 est à 10 ms du dernier encodage : sans remise à zéro au start(),
    // le premier redessin de l'overlay rouvert serait différé.
    flush(1010);
    expect(ticks).toEqual([1000, 1010]);
  });

  it("encodes nothing while the document is hidden, and resumes when it is shown again", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    let hidden = false;
    const loop = new OverlayAnimationLoop(raf, caf, 0, () => hidden);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    flush(0);
    hidden = true;
    flush(16);
    flush(32);
    expect(ticks).toEqual([0]);
    expect(pending()).toBe(1); // la boucle continue de se réarmer
    hidden = false;
    flush(48);
    expect(ticks).toEqual([0, 48]);
  });
});

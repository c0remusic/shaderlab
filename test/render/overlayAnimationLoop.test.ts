import { describe, it, expect } from "vitest";
import { OverlayAnimationLoop } from "../../src/render/overlayAnimationLoop";

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

describe("OverlayAnimationLoop", () => {
  it("does not schedule a frame before start()", () => {
    const { pending } = fakeRaf();
    expect(pending()).toBe(0);
  });

  it("schedules a frame on start() and re-arms itself after each tick", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    expect(pending()).toBe(1);
    flush(16);
    expect(ticks).toEqual([16]);
    expect(pending()).toBe(1);
  });

  it("keeps ticking across multiple frames", () => {
    const { raf, caf, flush } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    flush(16);
    flush(32);
    flush(48);
    expect(ticks).toEqual([16, 32, 48]);
  });

  it("start() is a no-op while already running", () => {
    const { raf, caf, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    loop.start(() => {});
    loop.start(() => {});
    expect(pending()).toBe(1);
  });

  it("stop() cancels the pending frame and halts ticking", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    loop.stop();
    expect(pending()).toBe(0);
    flush(16);
    expect(ticks).toEqual([]);
  });

  it("does not re-arm when stop() is called synchronously from within the tick callback", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
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
    const loop = new OverlayAnimationLoop(raf, caf);
    expect(loop.running).toBe(false);
    loop.start(() => {});
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });
});

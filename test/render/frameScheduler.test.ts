import { describe, it, expect } from "vitest";
import { FrameScheduler } from "../../src/render/frameScheduler";

/** Faux rAF manuel : capture les callbacks, `flush()` simule la frame. */
function fakeRaf() {
  const queue = new Map<number, () => void>();
  let nextId = 1;
  return {
    raf: (cb: () => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      queue.delete(id);
    },
    flush: () => {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb());
    },
    pending: () => queue.size,
  };
}

describe("FrameScheduler", () => {
  it("coalesces multiple requests within one frame into a single run with the last payload", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    scheduler.request(2);
    scheduler.request(3);
    flush();
    expect(runs).toEqual([3]);
  });

  it("schedules at most one rAF at a time", () => {
    const { raf, caf, pending } = fakeRaf();
    const scheduler = new FrameScheduler<number>(() => {}, raf, caf);
    scheduler.request(1);
    scheduler.request(2);
    expect(pending()).toBe(1);
  });

  it("accepts new requests after a flush", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    flush();
    scheduler.request(2);
    flush();
    expect(runs).toEqual([1, 2]);
  });

  // Fin de geste : c'est ici que se joue « la dernière valeur ne doit JAMAIS
  // être perdue ». Un coalescing sur rAF avale le dernier `pointermove` avant
  // le `pointerup` si la sortie de geste annule au lieu de flusher — l'état
  // React resterait sur l'avant-dernière valeur pendant que la session et le
  // rendu GPU, eux, ont déjà vu la dernière.
  it("flush() runs the pending payload immediately, without waiting for the frame", () => {
    const runs: number[] = [];
    const { raf, caf } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    scheduler.flush();
    expect(runs).toEqual([1]);
  });

  it("flush() keeps the LAST payload of the gesture, never an earlier one", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    scheduler.request(2);
    scheduler.request(3); // dernier pointermove avant le pointerup
    scheduler.flush();
    expect(runs).toEqual([3]);
    // et la frame programmée ne rejoue pas le payload une seconde fois
    flush();
    expect(runs).toEqual([3]);
  });

  it("flush() is a no-op when nothing is pending", () => {
    const runs: number[] = [];
    const { raf, caf } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.flush();
    expect(runs).toEqual([]);
  });

  it("accepts new requests after a flush()", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    scheduler.flush();
    scheduler.request(2);
    flush();
    expect(runs).toEqual([1, 2]);
  });

  it("cancel() drops the pending run", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    scheduler.cancel();
    flush();
    expect(runs).toEqual([]);
  });
});

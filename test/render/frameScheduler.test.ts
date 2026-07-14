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

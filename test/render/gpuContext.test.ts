import { describe, expect, it } from "vitest";
import {
  createGpuErrorReporter,
  GPU_ERROR_MAX_REPORTS,
  GPU_ERROR_REPEAT_WINDOW_MS,
} from "../../src/render/gpuContext";

/**
 * Only the recoverable-GPU-error channel is unit-tested here: `initGpu` itself
 * needs a real `navigator.gpu`, which the `node` test environment does not
 * have. The reporter is the part that carries the decisions — bounded,
 * debounced, and NOT wired to the fatal channel.
 */
function collector() {
  const lines: string[] = [];
  return { lines, sink: (message: string) => void lines.push(message) };
}

describe("createGpuErrorReporter", () => {
  it("emits the first occurrence of a message immediately", () => {
    const { lines, sink } = collector();
    const report = createGpuErrorReporter(sink, { now: () => 0 });

    report("GPU uncaptured error: GPUValidationError: bad bind group");

    expect(lines).toEqual(["GPU uncaptured error: GPUValidationError: bad bind group"]);
  });

  it("counts a per-frame burst instead of writing one line per frame", () => {
    const { lines, sink } = collector();
    let clock = 0;
    const report = createGpuErrorReporter(sink, { now: () => clock });

    // 400 frames at ~60 Hz = 6.4 s of a shader erroring on every frame.
    for (let frame = 0; frame < 400; frame += 1) {
      clock += 16;
      report("boom");
    }

    // The window (5 s) elapses once during the burst, so exactly one summary
    // follows the first line — not 400 lines.
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("boom");
    expect(lines[1]).toMatch(/^boom \(repeated \d+ times in \d+ ms\)$/);
  });

  it("folds the suppressed count into the summary once the window elapses", () => {
    const { lines, sink } = collector();
    let clock = 0;
    const report = createGpuErrorReporter(sink, { now: () => clock });

    report("boom");
    report("boom");
    report("boom");
    clock = GPU_ERROR_REPEAT_WINDOW_MS;
    report("boom");

    expect(lines).toEqual([
      "boom",
      `boom (repeated 3 times in ${GPU_ERROR_REPEAT_WINDOW_MS} ms)`,
    ]);
  });

  it("does not debounce distinct messages against each other", () => {
    const { lines, sink } = collector();
    const report = createGpuErrorReporter(sink, { now: () => 0 });

    report("out of memory");
    report("invalid bind group");

    expect(lines).toEqual(["out of memory", "invalid bind group"]);
  });

  it("stops for good after the ceiling, with one line saying so", () => {
    const { lines, sink } = collector();
    const report = createGpuErrorReporter(sink, { maxReports: 3, now: () => 0 });

    for (let i = 0; i < 50; i += 1) report(`distinct error ${i}`);

    expect(lines).toEqual([
      "distinct error 0",
      "distinct error 1",
      "distinct error 2",
      "GPU error reporting stopped after 3 entries — further recoverable errors are not logged.",
    ]);
  });

  it("keeps a runaway handler bounded at the default ceiling", () => {
    const { lines, sink } = collector();
    let clock = 0;
    const report = createGpuErrorReporter(sink, { now: () => clock });

    for (let i = 0; i < 10_000; i += 1) {
      clock += 16;
      report(`error ${i % 7}`);
    }

    expect(lines.length).toBe(GPU_ERROR_MAX_REPORTS + 1);
    expect(lines.at(-1)).toContain("stopped after");
  });
});

import { describe, expect, it, vi } from "vitest";
import { FrameDiagnostics } from "../../src/render/frameDiagnostics";

describe("FrameDiagnostics", () => {
  it("logs every fifteenth frame with the established diagnostic fields", () => {
    const logger = vi.fn();
    const diagnostics = new FrameDiagnostics(logger, () => 43.456);
    const stats = { enabledLayerCount: 3, churnedResourceCount: 7 };
    const facts = { pipelineCacheSize: 5, imageWidth: 6000, imageHeight: 4000 };

    for (let frame = 0; frame < 14; frame++) diagnostics.record(40, stats, facts);
    expect(logger).not.toHaveBeenCalled();

    diagnostics.record(40, stats, facts);

    expect(logger).toHaveBeenCalledExactlyOnceWith(
      "frame#15 jsEncodeMs=3.46 enabledLayers=3 churnedThisFrame=7 pipelineCacheSize=5 imageSize=6000x4000",
    );
  });

  it("continues its cadence after a diagnostic is emitted", () => {
    const logger = vi.fn();
    const diagnostics = new FrameDiagnostics(logger, () => 10);
    const stats = { enabledLayerCount: 0, churnedResourceCount: 0 };
    const facts = { pipelineCacheSize: 0, imageWidth: 1, imageHeight: 1 };

    for (let frame = 0; frame < 30; frame++) diagnostics.record(8, stats, facts);

    expect(logger.mock.calls.map(([message]) => message)).toEqual([
      "frame#15 jsEncodeMs=2 enabledLayers=0 churnedThisFrame=0 pipelineCacheSize=0 imageSize=1x1",
      "frame#30 jsEncodeMs=2 enabledLayers=0 churnedThisFrame=0 pipelineCacheSize=0 imageSize=1x1",
    ]);
  });
});

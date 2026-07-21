import { describe, expect, it } from "vitest";
import { EffectPassRunner } from "../../src/render/effectPassRunner";

function createRunner(): EffectPassRunner {
  return new EffectPassRunner(
    null as unknown as GPUDevice,
    "bgra8unorm-srgb",
    1,
    1,
    null as unknown as GPUSampler,
    () => null as unknown as GPUTexture
  );
}

describe("EffectPassRunner", () => {
  it("starts with an empty pipeline cache", () => {
    expect(createRunner().pipelineCount).toBe(0);
  });

  it("clears an empty cache without requiring a GPU operation", () => {
    const runner = createRunner();
    runner.clearPipelines();
    expect(runner.pipelineCount).toBe(0);
  });
});

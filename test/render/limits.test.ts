import { describe, it, expect } from "vitest";
import { assertImageFitsGpu } from "../../src/render/limits";

describe("assertImageFitsGpu", () => {
  it("accepts dimensions within the limit", () => {
    expect(() => assertImageFitsGpu(6240, 4160, 16384)).not.toThrow();
  });

  it("rejects a width over the limit with an explicit message", () => {
    expect(() => assertImageFitsGpu(20000, 4000, 16384)).toThrow(/20000.*16384/);
  });

  it("rejects a height over the limit", () => {
    expect(() => assertImageFitsGpu(4000, 20000, 16384)).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { computeR8UploadRegion } from "../../src/render/maskUpload";

describe("computeR8UploadRegion", () => {
  it("covers the whole image when no rect is given", () => {
    expect(computeR8UploadRegion(100, 80)).toEqual({
      origin: { x: 0, y: 0 },
      dataLayout: { offset: 0, bytesPerRow: 100 },
      size: { width: 100, height: 80 },
    });
  });

  it("addresses a sub-rectangle via offset + bytesPerRow into the full-width source buffer", () => {
    const region = computeR8UploadRegion(100, 80, { x: 10, y: 5, width: 20, height: 15 });
    expect(region).toEqual({
      origin: { x: 10, y: 5 },
      // offset = row*width + x = 5*100 + 10
      dataLayout: { offset: 510, bytesPerRow: 100 },
      size: { width: 20, height: 15 },
    });
  });

  it("a rect starting at the image origin has offset 0", () => {
    const region = computeR8UploadRegion(50, 50, { x: 0, y: 0, width: 10, height: 10 });
    expect(region.dataLayout.offset).toBe(0);
  });

  it("bytesPerRow always reflects the FULL source width, not the rect width — this is what lets the region be read directly out of the full buffer without a copy", () => {
    const region = computeR8UploadRegion(200, 200, { x: 5, y: 5, width: 3, height: 3 });
    expect(region.dataLayout.bytesPerRow).toBe(200);
    expect(region.size.width).toBe(3);
  });
});

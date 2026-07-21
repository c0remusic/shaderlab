import { describe, expect, it, vi } from "vitest";
import { FrameReadback, paddedBytesPerRow } from "../../src/render/frameReadback";

vi.stubGlobal("GPUBufferUsage", { COPY_DST: 1, MAP_READ: 2 });
vi.stubGlobal("GPUMapMode", { READ: 1 });

describe("paddedBytesPerRow", () => {
  it("aligns RGBA rows to WebGPU's 256-byte requirement", () => {
    expect(paddedBytesPerRow(1)).toBe(256);
    expect(paddedBytesPerRow(64)).toBe(256);
    expect(paddedBytesPerRow(65)).toBe(512);
  });
});

describe("FrameReadback", () => {
  it("strips padding into tightly packed RGBA rows", () => {
    const readback = new FrameReadback(null as unknown as GPUDevice, 2, 2);
    const padded = new Uint8Array(512);
    padded.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    padded.set([9, 10, 11, 12, 13, 14, 15, 16], 256);

    expect(readback.stripRowPadding(padded)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    );
  });

  it("returns the original buffer when rows are already tight", () => {
    const readback = new FrameReadback(null as unknown as GPUDevice, 64, 1);
    const pixels = new Uint8Array(256);
    expect(readback.stripRowPadding(pixels)).toBe(pixels);
  });

  it("submits a separate copy command and destroys its transient buffer", async () => {
    const buffer = {
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4]).buffer),
      unmap: vi.fn(),
      destroy: vi.fn(),
    };
    const encoder = {
      copyTextureToBuffer: vi.fn(),
      finish: vi.fn().mockReturnValue("command-buffer"),
    };
    const device = {
      createBuffer: vi.fn().mockReturnValue(buffer),
      createCommandEncoder: vi.fn().mockReturnValue(encoder),
      queue: { submit: vi.fn() },
    };
    const texture = {} as GPUTexture;

    await expect(new FrameReadback(device as unknown as GPUDevice, 1, 1).readTextureBytes(texture))
      .resolves.toEqual(new Uint8Array([1, 2, 3, 4]));

    expect(encoder.copyTextureToBuffer).toHaveBeenCalledWith(
      { texture },
      { buffer, bytesPerRow: 256 },
      [1, 1],
    );
    expect(device.queue.submit).toHaveBeenCalledWith(["command-buffer"]);
    expect(buffer.unmap).toHaveBeenCalledOnce();
    expect(buffer.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the transient buffer when mapAsync rejects", async () => {
    const buffer = {
      mapAsync: vi.fn().mockRejectedValue(new Error("device lost")),
      getMappedRange: vi.fn(),
      unmap: vi.fn(),
      destroy: vi.fn(),
    };
    const device = {
      createBuffer: vi.fn().mockReturnValue(buffer),
      createCommandEncoder: vi.fn().mockReturnValue({
        copyTextureToBuffer: vi.fn(),
        finish: vi.fn().mockReturnValue("command-buffer"),
      }),
      queue: { submit: vi.fn() },
    };

    await expect(new FrameReadback(device as unknown as GPUDevice, 1, 1).readTextureBytes({} as GPUTexture))
      .rejects.toThrow("device lost");
    expect(buffer.destroy).toHaveBeenCalledOnce();
    expect(buffer.unmap).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoSourceStore } from "../../src/render/photoSourceStore";

vi.stubGlobal("GPUTextureUsage", {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
});

function texture() {
  return { destroy: vi.fn() };
}

function createStore() {
  const created: ReturnType<typeof texture>[] = [];
  const device = {
    createTexture: vi.fn(() => {
      const t = texture();
      created.push(t);
      return t;
    }),
    queue: { copyExternalImageToTexture: vi.fn() },
  };
  return {
    store: new PhotoSourceStore(device as unknown as GPUDevice, "bgra8unorm-srgb", 8192),
    device,
    created,
  };
}

describe("PhotoSourceStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("register uploads the bitmap and returns a fresh sourceId each time", () => {
    const { store, device } = createStore();
    const bitmap = { width: 40, height: 30 } as ImageBitmap;

    const id1 = store.register(bitmap);
    const id2 = store.register(bitmap);

    expect(id1).not.toBe(id2);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source: bitmap },
      { texture: expect.anything() },
      [40, 30],
    );
  });

  it("get returns the registered texture, null for an unknown id", () => {
    const { store, created } = createStore();
    const id = store.register({ width: 10, height: 10 } as ImageBitmap);
    expect(store.get(id)).toBe(created[0]);
    expect(store.get("no-such-id")).toBeNull();
  });

  it("dimensions returns the registered bitmap size, null for an unknown id", () => {
    const { store } = createStore();
    const id = store.register({ width: 40, height: 30 } as ImageBitmap);
    expect(store.dimensions(id)).toEqual({ width: 40, height: 30 });
    expect(store.dimensions("no-such-id")).toBeNull();
  });

  it("dispose destroys every registered texture and clears the store", () => {
    const { store, created } = createStore();
    const id = store.register({ width: 10, height: 10 } as ImageBitmap);

    store.dispose();

    expect(created[0].destroy).toHaveBeenCalledOnce();
    expect(store.get(id)).toBeNull();
    expect(store.dimensions(id)).toBeNull();
  });

  it("register fails fast before allocating an image beyond the device limit", () => {
    const { store, device } = createStore();
    expect(() => store.register({ width: 20000, height: 10 } as ImageBitmap)).toThrow("trop grande");
    expect(device.createTexture).not.toHaveBeenCalled();
  });
});

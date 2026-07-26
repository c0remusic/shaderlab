import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoSourceStore } from "../../src/render/photoSourceStore";

/** Reposé à CHAQUE test : `vi.unstubAllGlobals()` (afterEach, pour retirer
 *  les doubles d'OffscreenCanvas/URL) retirerait aussi celui-ci s'il n'était
 *  posé qu'une fois au chargement du module. */
function stubGpuTextureUsage() {
  vi.stubGlobal("GPUTextureUsage", {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
  });
}

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

/** Env Node : pas d'`OffscreenCanvas`. On installe un double minimal pour
 *  couvrir le chemin vignette (réduction + object URL), et on le retire pour
 *  vérifier le chemin de repli (`thumbnailUrl` -> null sans jamais faire
 *  échouer `register`). */
function stubThumbnailPipeline() {
  const drawn: Array<[number, number]> = [];
  class FakeOffscreenCanvas {
    constructor(public width: number, public height: number) {
      drawn.push([width, height]);
    }
    getContext() {
      return { drawImage: vi.fn() };
    }
    async convertToBlob() {
      return {} as Blob;
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  let next = 0;
  const revoked: string[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:thumb-${++next}`),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });
  return { drawn, revoked };
}

describe("PhotoSourceStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubGpuTextureUsage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("register uploads the bitmap and returns a fresh sourceId each time", async () => {
    const { store, device } = createStore();
    const bitmap = { width: 40, height: 30 } as ImageBitmap;

    const id1 = await store.register(bitmap);
    const id2 = await store.register(bitmap);

    expect(id1).not.toBe(id2);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source: bitmap },
      { texture: expect.anything() },
      [40, 30],
    );
  });

  it("get returns the registered texture, null for an unknown id", async () => {
    const { store, created } = createStore();
    const id = await store.register({ width: 10, height: 10 } as ImageBitmap);
    expect(store.get(id)).toBe(created[0]);
    expect(store.get("no-such-id")).toBeNull();
  });

  it("dimensions returns the registered bitmap size, null for an unknown id", async () => {
    const { store } = createStore();
    const id = await store.register({ width: 40, height: 30 } as ImageBitmap);
    expect(store.dimensions(id)).toEqual({ width: 40, height: 30 });
    expect(store.dimensions("no-such-id")).toBeNull();
  });

  it("dispose destroys every registered texture and clears the store", async () => {
    const { store, created } = createStore();
    const id = await store.register({ width: 10, height: 10 } as ImageBitmap);

    store.dispose();

    expect(created[0].destroy).toHaveBeenCalledOnce();
    expect(store.get(id)).toBeNull();
    expect(store.dimensions(id)).toBeNull();
  });

  it("register fails fast before allocating an image beyond the device limit", async () => {
    const { store, device } = createStore();
    await expect(store.register({ width: 20000, height: 10 } as ImageBitmap)).rejects.toThrow("trop grande");
    expect(device.createTexture).not.toHaveBeenCalled();
  });

  it("thumbnailUrl rend l'object URL de la vignette, null pour un id inconnu", async () => {
    stubThumbnailPipeline();
    const { store } = createStore();
    const id = await store.register({ width: 40, height: 30 } as ImageBitmap);
    expect(store.thumbnailUrl(id)).toBe("blob:thumb-1");
    expect(store.thumbnailUrl("no-such-id")).toBeNull();
  });

  it("la vignette est réduite sous 64px de côté en conservant le ratio", async () => {
    const { drawn } = stubThumbnailPipeline();
    const { store } = createStore();
    await store.register({ width: 6000, height: 3000 } as ImageBitmap);
    expect(drawn[0]).toEqual([64, 32]);
  });

  it("une photo déjà plus petite que 64px n'est pas agrandie", async () => {
    const { drawn } = stubThumbnailPipeline();
    const { store } = createStore();
    await store.register({ width: 20, height: 10 } as ImageBitmap);
    expect(drawn[0]).toEqual([20, 10]);
  });

  it("dispose révoque toutes les object URL de vignette", async () => {
    const { revoked } = stubThumbnailPipeline();
    const { store } = createStore();
    const id1 = await store.register({ width: 10, height: 10 } as ImageBitmap);
    const id2 = await store.register({ width: 10, height: 10 } as ImageBitmap);

    store.dispose();

    expect(revoked.sort()).toEqual(["blob:thumb-1", "blob:thumb-2"]);
    expect(store.thumbnailUrl(id1)).toBeNull();
    expect(store.thumbnailUrl(id2)).toBeNull();
  });

  it("si convertToBlob rejette, register réussit et la source reste utilisable sans vignette", async () => {
    class FailingOffscreenCanvas {
      constructor(public width: number, public height: number) {}
      getContext() {
        return { drawImage: vi.fn() };
      }
      async convertToBlob(): Promise<Blob> {
        throw new Error("encodage png indisponible");
      }
    }
    vi.stubGlobal("OffscreenCanvas", FailingOffscreenCanvas);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = createStore();

    const id = await store.register({ width: 40, height: 30 } as ImageBitmap);

    expect(store.get(id)).not.toBeNull();
    expect(store.dimensions(id)).toEqual({ width: 40, height: 30 });
    expect(store.thumbnailUrl(id)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("si drawImage jette, register réussit et la source reste utilisable sans vignette", async () => {
    class ThrowingOffscreenCanvas {
      constructor(public width: number, public height: number) {}
      getContext() {
        return {
          drawImage: () => {
            throw new Error("source detachée");
          },
        };
      }
      async convertToBlob(): Promise<Blob> {
        return {} as Blob;
      }
    }
    vi.stubGlobal("OffscreenCanvas", ThrowingOffscreenCanvas);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = createStore();

    const id = await store.register({ width: 40, height: 30 } as ImageBitmap);

    expect(store.get(id)).not.toBeNull();
    expect(store.thumbnailUrl(id)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("sans OffscreenCanvas, register réussit quand même et thumbnailUrl rend null", async () => {
    const { store } = createStore();
    const id = await store.register({ width: 10, height: 10 } as ImageBitmap);
    expect(store.get(id)).not.toBeNull();
    expect(store.thumbnailUrl(id)).toBeNull();
  });
});

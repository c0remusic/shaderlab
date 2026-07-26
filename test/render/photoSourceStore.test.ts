import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_REGISTERED_PHOTO_SOURCES, PhotoSourceStore } from "../../src/render/photoSourceStore";
import { MAX_PHOTO_LAYERS } from "../../src/layers/photoLayer";

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

  // Garde d'allocation prescrit par ARCHITECTURE.md R1 : sans refcount (un
  // calque photo supprimé peut revenir par undo), une boucle
  // importer/annuler ferait croître la mémoire sans borne. Le plafond est
  // ici, au point unique d'allocation, pas dispersé dans l'UI.
  describe("MAX_REGISTERED_PHOTO_SOURCES", () => {
    const bitmap = { width: 10, height: 10 } as ImageBitmap;

    it("vaut 4 × MAX_PHOTO_LAYERS (révisé par la même mesure VRAM)", () => {
      expect(MAX_REGISTERED_PHOTO_SOURCES).toBe(4 * MAX_PHOTO_LAYERS);
    });

    it("laisse enregistrer exactement MAX_REGISTERED_PHOTO_SOURCES sources", () => {
      const { store } = createStore();
      for (let i = 0; i < MAX_REGISTERED_PHOTO_SOURCES; i++) store.register(bitmap);
      expect(store.registeredCount).toBe(MAX_REGISTERED_PHOTO_SOURCES);
    });

    it("échoue explicitement au dépassement, AVANT toute allocation GPU", () => {
      const { store, device } = createStore();
      for (let i = 0; i < MAX_REGISTERED_PHOTO_SOURCES; i++) store.register(bitmap);
      const allocationsBefore = device.createTexture.mock.calls.length;

      expect(() => store.register(bitmap)).toThrow(/Trop de photos importées dans cette session/);
      expect(() => store.register(bitmap)).toThrow(/Ouvre à nouveau le document/);
      expect(device.createTexture).toHaveBeenCalledTimes(allocationsBefore);
      expect(store.registeredCount).toBe(MAX_REGISTERED_PHOTO_SOURCES);
    });

    it("dispose() rend les jetons — c'est la sortie que nomme le message d'erreur", () => {
      const { store } = createStore();
      for (let i = 0; i < MAX_REGISTERED_PHOTO_SOURCES; i++) store.register(bitmap);
      expect(() => store.register(bitmap)).toThrow();

      store.dispose();

      expect(store.registeredCount).toBe(0);
      expect(() => store.register(bitmap)).not.toThrow();
    });

    it("rend toujours un sourceId frais après dispose() (les ids ne sont pas recyclés)", () => {
      const { store } = createStore();
      const before = store.register(bitmap);
      store.dispose();
      expect(store.register(bitmap)).not.toBe(before);
    });
  });
});

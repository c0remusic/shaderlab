import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoLayerInputResolver, PHOTO_LAYER_INPUT_WGSL } from "../../src/render/photoLayerInput";
import { MIN_TRANSFORM_SCALE, compositeUvToPhotoUv } from "../../src/ui/transform";

vi.stubGlobal("GPUShaderStage", { FRAGMENT: 2 });
vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, COPY_DST: 8 });
vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 4 });

function texture() {
  return { createView: vi.fn(() => ({})), destroy: vi.fn() };
}

function createDevice() {
  const created: ReturnType<typeof texture>[] = [];
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const encoder = { beginRenderPass: vi.fn(() => pass) };
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn(() => {
      const t = texture();
      created.push(t);
      return t;
    }),
    createBuffer: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
  };
  return { device, encoder, pass, created };
}

describe("PhotoLayerInputResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a target texture sized to the background and writes the transform uniform", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
    const photoTexture = texture() as unknown as GPUTexture;
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    const target = resolver.resolve(
      encoder as unknown as GPUCommandEncoder,
      photoTexture,
      200,
      100,
      1000,
      800,
      { x: 500, y: 400, scale: 1, rotation: 0 },
      pendingDestroy,
    );

    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ size: [1000, 800] }),
    );
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      new Float32Array([500, 400, 1, 0, 1000, 800, 200, 100]),
    );
    expect(target).toBeDefined();
  });

  it("pushes the transient uniform buffer into pendingDestroy but not the target texture (frame pipeline owns it)", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, pendingDestroy);

    expect(pendingDestroy).toHaveLength(1); // le paramBuffer, pas la texture cible
  });

  it("reuses the same pipeline across multiple resolve() calls", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);

    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, []);
    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, []);

    expect(device.createRenderPipeline).toHaveBeenCalledOnce();
  });

  // I1 — clamp d'échelle minimale perdu (scale=0 → division par zéro en WGSL,
  // `let lx = rx / scale;`). clampTransformScale/MIN_TRANSFORM_SCALE
  // (src/ui/transform.ts) doit être appliqué avant l'écriture de l'uniform.
  it("clamps transform.scale to MIN_TRANSFORM_SCALE before writing the uniform (I1 — division by zero guard)", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);

    resolver.resolve(
      encoder as unknown as GPUCommandEncoder,
      texture() as unknown as GPUTexture,
      200, 100, 1000, 800,
      { x: 500, y: 400, scale: 0, rotation: 0 },
      [],
    );

    expect(device.queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      new Float32Array([500, 400, MIN_TRANSFORM_SCALE, 0, 1000, 800, 200, 100]),
    );
  });

  // I2 — feather de couverture en espace photo au lieu d'espace écran.
  // La largeur réelle du dégradé à l'écran doit valoir 1px quel que soit
  // `scale` — donc edgeDistPx (en pixels PHOTO) doit être multiplié par
  // `scale` avant le clamp, pas utilisé brut.
  it("multiplies edgeDistPx by scale before clamping into coverage (I2 — feather in screen space, not photo space)", () => {
    expect(PHOTO_LAYER_INPUT_WGSL).toContain("clamp(edgeDistPx * scale, 0.0, 1.0)");
    expect(PHOTO_LAYER_INPUT_WGSL).not.toContain("clamp(edgeDistPx, 0.0, 1.0)");
  });

  // I3 — parité maths de transform inverse entre le WGSL de cette pré-passe
  // et compositeUvToPhotoUv (src/ui/transform.ts, référence de géométrie
  // validée Task 3). Réplique manuellement en TS la même formule que le
  // WGSL (params[0..7], lignes 24-46 de PHOTO_LAYER_INPUT_WGSL) et compare
  // au résultat de compositeUvToPhotoUv sur les mêmes points — un futur
  // changement de convention (signe de rotation, pivot) dans l'un des deux
  // fichiers sans l'autre doit faire échouer ce test.
  describe("I3 — WGSL/TS transform math parity", () => {
    function replicateWgslFormula(
      compositeUv: { u: number; v: number },
      bg: { width: number; height: number },
      transform: { x: number; y: number; scale: number; rotation: number },
      photo: { width: number; height: number },
    ): { u: number; v: number } | null {
      const px = compositeUv.u * bg.width;
      const py = compositeUv.v * bg.height;
      const dx = px - transform.x;
      const dy = py - transform.y;
      const c = Math.cos(-transform.rotation);
      const s = Math.sin(-transform.rotation);
      const rx = dx * c - dy * s;
      const ry = dx * s + dy * c;
      const lx = rx / transform.scale;
      const ly = ry / transform.scale;
      const photoPx = lx + photo.width * 0.5;
      const photoPy = ly + photo.height * 0.5;
      if (photoPx < 0 || photoPx >= photo.width || photoPy < 0 || photoPy >= photo.height) return null;
      return { u: photoPx / photo.width, v: photoPy / photo.height };
    }

    const bg = { width: 1000, height: 800 };
    const photo = { width: 200, height: 100 };

    it.each([
      { name: "identity", transform: { x: 500, y: 400, scale: 1, rotation: 0 }, uv: { u: 0.5, v: 0.5 } },
      { name: "rotation 90deg", transform: { x: 500, y: 400, scale: 1, rotation: Math.PI / 2 }, uv: { u: 0.5, v: 0.5 } },
      { name: "scale != 1", transform: { x: 500, y: 400, scale: 2.5, rotation: 0 }, uv: { u: 0.6, v: 0.45 } },
      { name: "translation", transform: { x: 300, y: 250, scale: 1, rotation: 0 }, uv: { u: 0.35, v: 0.3 } },
      { name: "combined", transform: { x: 620, y: 310, scale: 1.7, rotation: 0.9 }, uv: { u: 0.7, v: 0.2 } },
    ])("matches compositeUvToPhotoUv for $name", ({ transform, uv }) => {
      const fromWgslReplica = replicateWgslFormula(uv, bg, transform, photo);
      const fromTs = compositeUvToPhotoUv(uv, bg, transform, photo);
      expect(fromWgslReplica).toEqual(fromTs);
    });
  });

  // I4 — texture pleine taille allouée+détruite à chaque frame. Le resolver
  // doit posséder une texture cible persistante, recréée seulement quand
  // bgWidth/bgHeight changent.
  describe("I4 — persistent target texture cache", () => {
    it("reuses the same target texture across resolve() calls at an unchanged size", () => {
      const { device, encoder } = createDevice();
      const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
      const photoTexture = texture() as unknown as GPUTexture;

      const first = resolver.resolve(encoder as unknown as GPUCommandEncoder, photoTexture, 10, 10, 500, 400, { x: 0, y: 0, scale: 1, rotation: 0 }, []);
      const second = resolver.resolve(encoder as unknown as GPUCommandEncoder, photoTexture, 10, 10, 500, 400, { x: 0, y: 0, scale: 1, rotation: 0 }, []);

      expect(device.createTexture).toHaveBeenCalledOnce();
      expect(second).toBe(first);
    });

    // MAX_PHOTO_LAYERS vaut 4 : deux calques photo de la MÊME frame appellent
    // resolve() sur le MÊME encoder, avec la même taille de fond. Le resolver
    // doit leur rendre le même objet texture (une seule cible pleine taille,
    // pas +96 Mo par calque à 24 MP) — la correction de ce partage tient à
    // l'ordre des passes, assuré côté FramePipelineExecutor.
    it("returns the same target object to two photo layers resolved in one frame", () => {
      const { device, encoder } = createDevice();
      const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
      const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

      const forLayerA = resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 200, 100, 500, 400, { x: 10, y: 20, scale: 1, rotation: 0 }, pendingDestroy);
      const forLayerB = resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 300, 150, 500, 400, { x: 90, y: 80, scale: 2, rotation: 0.5 }, pendingDestroy);

      expect(forLayerB).toBe(forLayerA);
      expect(device.createTexture).toHaveBeenCalledOnce();
      // Chaque calque a bien sa propre passe qui re-clear la cible, et son
      // propre buffer d'uniform transitoire — aucune mutualisation.
      expect(encoder.beginRenderPass).toHaveBeenCalledTimes(2);
      expect(encoder.beginRenderPass.mock.calls[1][0].colorAttachments[0].loadOp).toBe("clear");
      expect(pendingDestroy).toHaveLength(2);
    });

    it("recreates (and destroys the old) target texture when bgWidth/bgHeight changes", () => {
      const { device, encoder } = createDevice();
      const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
      const photoTexture = texture() as unknown as GPUTexture;

      const first = resolver.resolve(encoder as unknown as GPUCommandEncoder, photoTexture, 10, 10, 500, 400, { x: 0, y: 0, scale: 1, rotation: 0 }, []);
      const second = resolver.resolve(encoder as unknown as GPUCommandEncoder, photoTexture, 10, 10, 900, 700, { x: 0, y: 0, scale: 1, rotation: 0 }, []);

      expect(device.createTexture).toHaveBeenCalledTimes(2);
      expect((first as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledOnce();
      expect(second).not.toBe(first);
    });

    it("does not push the cached target texture into pendingDestroy (frame-transient buffer only)", () => {
      const { device, encoder } = createDevice();
      const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
      const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

      const target = resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, pendingDestroy);

      expect(pendingDestroy).not.toContain(target);
    });

    it("destroys the cached target texture on dispose()", () => {
      const { device, encoder } = createDevice();
      const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
      const target = resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, []);

      resolver.dispose();

      expect((target as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledOnce();
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import { TextureThumbnailCache, THUMBNAIL_DECODE_CONCURRENCY } from "../../src/textures/thumbnailCache";
import { encodeThumbnailEnvelope } from "../../src/textures/thumbnailEnvelope";

/** Signature PNG — assez pour que l'enveloppe soit exploitable. Ce banc vérifie
 *  l'ordonnancement et la totalité, pas le rendu d'un aperçu : la fabrication
 *  vit désormais côté Rust (`get_texture_thumbnail`), et ce module n'est plus
 *  qu'un cache mémoire par session. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function envelope(width: number, height: number): Uint8Array {
  return encodeThumbnailEnvelope({ width, height }, PNG);
}

/** Promesse dont on garde la main sur la résolution — sert à immobiliser des
 *  appels pour observer combien tournent en même temps. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("TextureThumbnailCache", () => {
  it("rend les dimensions NATIVES de la source, lues dans l'enveloppe", () => {
    // Pas celles de la vignette : c'est ce qui décide si le scan est seulement
    // importable (`assertImageFitsGpu`, 8192 px).
    const cache = new TextureThumbnailCache({ getThumbnail: async () => envelope(8192, 8192) });
    return cache.load("a.jpg").then((entry) => {
      expect(entry.size).toEqual({ width: 8192, height: 8192 });
      expect(entry.url).not.toBeNull();
      cache.dispose();
    });
  });

  it("est TOTAL : un appel qui échoue ne rejette pas et ne fait pas tomber la grille", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new TextureThumbnailCache({
      getThumbnail: async () => {
        throw new Error("fichier illisible");
      },
    });
    await expect(cache.load("absent.jpg")).resolves.toEqual({ url: null, size: null });
    // L'échec n'est pas silencieux pour autant.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    cache.dispose();
  });

  it("rend url et size NULS ensemble sur une enveloppe inexploitable", async () => {
    // Écriture de cache interrompue côté Rust : pas de demi-succès, la grille
    // affiche un emplacement vide plutôt qu'un aperçu cassé.
    const cache = new TextureThumbnailCache({ getThumbnail: async () => new Uint8Array(4) });
    await expect(cache.load("tronque.jpg")).resolves.toEqual({ url: null, size: null });
    cache.dispose();
  });

  it("n'appelle qu'UNE FOIS par chemin, même demandé par plusieurs rendus", async () => {
    const getThumbnail = vi.fn(async () => envelope(100, 100));
    const cache = new TextureThumbnailCache({ getThumbnail });
    const [a, b] = await Promise.all([cache.load("a.jpg"), cache.load("a.jpg")]);
    expect(getThumbnail).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await cache.load("a.jpg");
    expect(getThumbnail).toHaveBeenCalledTimes(1);
    cache.dispose();
  });

  it("BORNE la concurrence — la grille peut demander quarante vignettes d'un coup", async () => {
    const gates: Array<ReturnType<typeof deferred<Uint8Array>>> = [];
    let inFlight = 0;
    let peak = 0;
    const cache = new TextureThumbnailCache({
      getThumbnail: () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const gate = deferred<Uint8Array>();
        gates.push(gate);
        return gate.promise.finally(() => {
          inFlight -= 1;
        });
      },
    });

    const total = THUMBNAIL_DECODE_CONCURRENCY + 5;
    const all = Promise.all(Array.from({ length: total }, (_, i) => cache.load(`t${i}.jpg`)));

    await Promise.resolve();
    await Promise.resolve();
    expect(gates.length).toBe(THUMBNAIL_DECODE_CONCURRENCY);

    for (let i = 0; i < total; i += 1) {
      while (gates.length <= i) await Promise.resolve();
      gates[i].resolve(envelope(10, 10));
      await Promise.resolve();
      await Promise.resolve();
    }

    await all;
    expect(peak).toBeLessThanOrEqual(THUMBNAIL_DECODE_CONCURRENCY);
    expect(gates.length).toBe(total);
    cache.dispose();
  });

  it("rend le jeton même quand l'appel échoue, sinon le sémaphore se bloque", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new TextureThumbnailCache({
      getThumbnail: async (path) => {
        if (path.startsWith("ko")) throw new Error("illisible");
        return envelope(50, 50);
      },
    });
    // Sature le plafond d'échecs, puis vérifie qu'un appel sain passe encore :
    // sans le `finally` qui relâche, celui-ci n'aboutirait jamais et le test
    // échouerait par timeout.
    await Promise.all(
      Array.from({ length: THUMBNAIL_DECODE_CONCURRENCY + 2 }, (_, i) => cache.load(`ko${i}.jpg`)),
    );
    await expect(cache.load("ok.jpg")).resolves.toMatchObject({ size: { width: 50, height: 50 } });
    warn.mockRestore();
    cache.dispose();
  });

  it("peek ne déclenche rien et ne rend que ce qui est déjà là", async () => {
    const getThumbnail = vi.fn(async () => envelope(20, 20));
    const cache = new TextureThumbnailCache({ getThumbnail });
    expect(cache.peek("a.jpg")).toBeNull();
    expect(getThumbnail).not.toHaveBeenCalled();
    await cache.load("a.jpg");
    expect(cache.peek("a.jpg")?.size).toEqual({ width: 20, height: 20 });
    cache.dispose();
  });

  it("après dispose, une entrée déjà chargée n'est plus servie", async () => {
    const cache = new TextureThumbnailCache({ getThumbnail: async () => envelope(30, 30) });
    await cache.load("a.jpg");
    cache.dispose();
    expect(cache.peek("a.jpg")).toBeNull();
  });

  it("une réponse qui atterrit APRÈS dispose n'entre pas dans le cache", async () => {
    const gate = deferred<Uint8Array>();
    const cache = new TextureThumbnailCache({ getThumbnail: () => gate.promise });
    const pending = cache.load("tardif.jpg");
    cache.dispose();
    gate.resolve(envelope(40, 40));
    await pending;
    // Sinon cette entrée survivrait au changement de dossier, et son object URL
    // échapperait à toute révocation.
    expect(cache.peek("tardif.jpg")).toBeNull();
  });
});

import { decodeThumbnailEnvelope, type ImagePixelSize } from "./thumbnailEnvelope";

/**
 * Vignettes de la bibliothèque de textures — HORS GPU, et désormais hors
 * WebView pour le travail lourd.
 *
 * ⚠️ PREMIÈRE RAISON D'ÊTRE, qui n'est pas évidente : le dépôt a déjà un chemin
 * de vignette, `PhotoSourceStore.register` (`render/photoSourceStore.ts`), et le
 * réutiliser ici serait un défaut grave. `register` alloue une TEXTURE GPU
 * pleine taille et consomme un jeton `MAX_REGISTERED_PHOTO_SOURCES`, qui vaut 20
 * et dont RIEN n'est jamais libéré (aucun refcount, par choix — un undo peut
 * ramener un calque supprimé). Ce budget a été calibré sur des photos, pour un
 * geste rare : on importe quatre photos, on ne les feuillette pas. Vingt clics
 * sur des scans 8K (268 Mo chacun en VRAM) demanderaient 5,4 Go, sur une carte
 * de 6 Go dont le pire cas mesuré est déjà à ~84 %. **La vignette ne touche
 * jamais le GPU.**
 *
 * ⚠️ SECONDE RAISON, arrivée par la mesure : elle ne touche plus non plus le
 * décodeur de la WebView. Le premier jet lisait le fichier par IPC puis
 * appelait `createImageBitmap({ resizeWidth: 128 })`. Mesuré le 2026-08-05 sur
 * la vraie fenêtre, matière 8K de 60 Mo : **887 ms** d'IPC, **1256 ms** de
 * décodage — et le décodage PLEIN sans réduction coûte **1125 ms**, donc
 * `resizeWidth` n'économise rien, il coûte plus cher. Le moteur décode les
 * 67 Mpx puis rétrécit. Résultat : 22,9 s pour remplir 21 cases.
 *
 * Tout ce travail est passé côté Rust (`get_texture_thumbnail`), qui lit le
 * fichier localement, décode, réduit, encode, met en cache, et ne renvoie que
 * l'enveloppe — quelques dizaines de Ko. Ce module n'est plus qu'un cache
 * mémoire par session, avec sa concurrence et sa discipline d'object URL.
 */

/** Appels concurrents au plus. Huit et non trois depuis que le décodage est en
 *  Rust : les commandes Tauri tournent sur un pool de threads, donc la
 *  concurrence occupe des cœurs au lieu de faire la queue devant l'unique
 *  décodeur de la WebView. Reste borné — la grille peut demander quarante
 *  vignettes d'un coup, et rien ne gagne à lancer quarante décodages. */
export const THUMBNAIL_DECODE_CONCURRENCY = 8;

/** Ce que la grille sait d'un fichier après chargement. Les deux champs
 *  viennent de la même enveloppe : une enveloppe illisible les rend tous les
 *  deux nuls, il n'y a pas de demi-succès. */
export interface TextureThumbnail {
  /** Object URL de l'aperçu, ou `null` si rien n'a pu être produit.
   *  Une CHAÎNE et jamais un raster — c'est ce qui autorise le composant à la
   *  garder dans le state React sans rien y faire entrer de lourd (invariant
   *  anti-OOM, `e3c7584`), exactement comme `PhotoSourceStore.thumbnailUrl`. */
  url: string | null;
  /** Dimensions NATIVES du scan, lues dans l'en-tête de l'enveloppe. */
  size: ImagePixelSize | null;
}

/** Unique port d'IO, injecté plutôt qu'importé — patron `export/exportImage.ts`,
 *  qui est le modèle du dépôt pour toute persistance testable. Le câblage réel
 *  passe `getTextureThumbnail` (`launch.ts`). */
export interface TextureThumbnailDeps {
  getThumbnail: (path: string) => Promise<Uint8Array>;
}

/** Object URL affichable à partir des octets d'un PNG.
 *
 *  ⚠️ COPIE dans un buffer à elle, délibérément. Le PNG sort de l'enveloppe par
 *  `subarray` : son `.buffer` est le buffer ENTIER, en-tête de dimensions
 *  compris, et un `new Blob([vue.buffer])` embarquerait huit octets parasites en
 *  tête — un PNG invalide, donc une vignette qui ne s'affiche jamais alors que
 *  tout le reste a l'air correct. La copie fait exactement la longueur de la
 *  vue, ce qui rend le piège impossible. Une trentaine de Ko, sans commune
 *  mesure avec ce qui est en jeu.
 *
 *  Le type MIME est explicite : sans lui le blob est
 *  `application/octet-stream`, qu'un `<img>` refuse d'afficher. */
function objectUrlFromPng(png: Uint8Array): string {
  const owned = new Uint8Array(png.length);
  owned.set(png);
  return URL.createObjectURL(new Blob([owned.buffer], { type: "image/png" }));
}

export class TextureThumbnailCache {
  private readonly entries = new Map<string, TextureThumbnail>();
  private readonly pending = new Map<string, Promise<TextureThumbnail>>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  private disposed = false;

  constructor(private readonly deps: TextureThumbnailDeps) {}

  /** Vignette déjà chargée pour ce chemin, sans rien déclencher. Sert au
   *  composant à rendre ce qu'il a sans relancer un chargement à chaque
   *  passage de la boucle de rendu. */
  peek(path: string): TextureThumbnail | null {
    return this.entries.get(path) ?? null;
  }

  /**
   * Charge (ou rend le cache mémoire) la vignette de `path`. TOTAL : ne rejette
   * jamais. Un fichier illisible ou un format refusé rend
   * `{ url: null, size: null }` — la grille affiche un emplacement vide plutôt
   * que de faire tomber tout le panneau pour une image sur quatre-vingts.
   *
   * Deux appels concurrents sur le même chemin partagent la MÊME promesse : la
   * grille peut demander la même vignette à plusieurs rendus sans payer deux
   * fois, ni créer deux object URL dont une fuirait.
   */
  async load(path: string): Promise<TextureThumbnail> {
    const cached = this.entries.get(path);
    if (cached) return cached;
    const inFlight = this.pending.get(path);
    if (inFlight) return inFlight;

    const promise = this.build(path).then((entry) => {
      this.pending.delete(path);
      if (this.disposed) {
        // Le cache a été vidé pendant le chargement (changement de dossier,
        // démontage). Révoquer TOUT DE SUITE : cette entrée n'entrera jamais
        // dans `entries`, donc `dispose` ne la verra pas et son blob fuiterait
        // pour la durée de vie de la page.
        if (entry.url !== null) URL.revokeObjectURL(entry.url);
        return { url: null, size: entry.size };
      }
      this.entries.set(path, entry);
      return entry;
    });
    this.pending.set(path, promise);
    return promise;
  }

  /** Révoque toutes les object URL et vide le cache mémoire. À appeler au
   *  changement de dossier ET au démontage — sans ça chaque navigation laisse
   *  fuiter un blob par vignette, même discipline que `PhotoSourceStore.dispose`.
   *
   *  Le cache DISQUE, lui, survit : c'est tout son intérêt. Il est borné et
   *  élagué côté Rust (`prune_thumbnail_cache`). */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.url !== null) URL.revokeObjectURL(entry.url);
    }
    this.entries.clear();
  }

  private async build(path: string): Promise<TextureThumbnail> {
    await this.acquire();
    try {
      const envelope = decodeThumbnailEnvelope(await this.deps.getThumbnail(path));
      if (envelope === null) return { url: null, size: null };
      return { url: objectUrlFromPng(envelope.png), size: envelope.size };
    } catch (e) {
      console.warn(`Vignette de texture non produite pour ${path} :`, e);
      return { url: null, size: null };
    } finally {
      this.release();
    }
  }

  /** Sémaphore : au plus `THUMBNAIL_DECODE_CONCURRENCY` appels à la fois. */
  private async acquire(): Promise<void> {
    if (this.running < THUMBNAIL_DECODE_CONCURRENCY) {
      this.running += 1;
      return;
    }
    // Le jeton nous sera TRANSMIS par `release`, qui ne décrémente pas dans ce
    // cas — sans cette passation, `running` serait décrémenté puis
    // réincrémenté, et deux attendants réveillés dans le même tour de boucle
    // passeraient tous les deux la garde.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next !== undefined) {
      next();
      return;
    }
    this.running -= 1;
  }
}

import { assertImageFitsGpu } from "./limits";
import { MipmapGenerator, mipLevelCountFor } from "./mipmapGenerator";

/**
 * Textures GPU de la BIBLIOTHÈQUE, pour l'effet `texture`.
 *
 * Distinct de `PhotoSourceStore`, et ce n'est pas une duplication. Les deux
 * stores ne portent pas la même chose et n'ont pas le même cycle de vie :
 * - `PhotoSourceStore` possède les photos IMPORTÉES d'un document. Une source y
 *   entre par un geste explicite, n'en sort jamais (un undo peut la ramener), et
 *   son plafond de 20 protège un pire cas VRAM mesuré à ~84 %.
 * - Ici, ce sont des scans d'un dossier que l'utilisateur feuillette. Ils
 *   entrent et sortent au gré des paramètres d'effet, et rien ne justifie qu'un
 *   aller-retour sur un curseur consomme un jeton du budget des photos.
 *
 * ⚠️ **L'INDEX EST LE RANG DANS LE CATALOGUE TRIÉ, pas un identifiant de
 * session.** C'est ce qui rend le choix persistable : `LayerState.params` ne
 * porte que des nombres (l'uniform est `array<f32, 48>`), donc un effet ne peut
 * désigner sa texture que par un entier. Un identifiant de session le rendrait
 * insensé au rechargement ; un rang dans la liste triée d'un dossier mémorisé
 * désigne le même fichier d'un lancement à l'autre.
 *
 * Limite assumée et nommée : ajouter un fichier au dossier DÉCALE les rangs
 * suivants, donc un preset enregistré avant peut désigner une autre texture.
 * C'est la même classe de problème que l'exclusion d'`imageSource` des presets,
 * et elle se traite pareil — en le disant, pas en le cachant.
 */

/** Plafond de textures de bibliothèque RÉSIDENTES en VRAM.
 *
 *  Six et non vingt : un document réaliste empile deux ou trois calques de
 *  texture, pas vingt. Le budget est le même que celui des photos — une texture
 *  8192 × 8192 en RGBA8 pèse **268 Mo** — et il est déjà tendu : le pire cas
 *  mesuré du couple (toile 64 Mpx, 5 calques photo) atteint ~84 % de la VRAM
 *  d'une carte de 6 Go (`layers/photoLayer.ts`). Six textures de bibliothèque
 *  ajoutent au pire 1,6 Go par-dessus, ce qui est déjà beaucoup — d'où
 *  l'éviction ci-dessous plutôt qu'une accumulation.
 *
 *  ⚠️ Ce plafond n'est PAS adossé à une mesure, contrairement à
 *  `MAX_PHOTO_LAYERS` et `MAX_CANVAS_PIXELS` qui le sont. C'est une borne de
 *  prudence, à re-mesurer au protocole du dépôt (Total Committed du process GPU
 *  WebView2) avant de la faire bouger dans un sens ou dans l'autre. */
export const MAX_RESIDENT_LIBRARY_TEXTURES = 6;

interface Resident {
  texture: GPUTexture;
  /** Rang d'usage, pour l'éviction du moins récemment servi. */
  lastUsed: number;
}

/**
 * Propriétaire EXCLUSIF des textures GPU de la bibliothèque. Vit dans `render/`
 * aux côtés de `PhotoSourceStore`, jamais dans `layers/` — qui ne doit jamais
 * dépendre de WebGPU.
 *
 * Rien de ce qu'il contient n'est référencé depuis `LayerState`, le state React
 * ou un instantané d'historique : le modèle ne porte qu'un INDEX (invariant
 * anti-OOM, `e3c7584`).
 */
export class TextureLibraryStore {
  /** Catalogue courant : chemins ABSOLUS, dans l'ordre trié rendu par
   *  `list_texture_files`. L'index d'un paramètre d'effet s'y lit. */
  private catalog: readonly string[] = [];
  private readonly resident = new Map<number, Resident>();
  /** Construit la pyramide de chaque scan chargé. Possédé par le store parce
   *  que c'est le seul endroit du projet qui crée une texture multi-niveaux —
   *  les cibles de ping-pong et les masques n'en ont pas l'usage, elles sont
   *  lues à leur résolution propre.
   *
   *  ⚠️ Créé à la PREMIÈRE demande et non en initialiseur de champ : avec
   *  `useDefineForClassFields`, les champs s'initialisent AVANT que les
   *  propriétés de constructeur (`device`, `srgbFormat`) soient affectées, et
   *  un initialiseur ici lirait `undefined`. */
  private mipmapsLazy: MipmapGenerator | null = null;

  private get mipmaps(): MipmapGenerator {
    return (this.mipmapsLazy ??= new MipmapGenerator(this.device, this.srgbFormat));
  }
  private readonly loading = new Map<number, Promise<void>>();
  private placeholder: GPUTexture | null = null;
  private clock = 0;
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly maxTextureDimension: number,
    /** Décode un chemin en bitmap. Injecté plutôt qu'importé : c'est ce qui rend
     *  le store testable sans WebView ni IPC, patron `exportImage.ts`. */
    private readonly decode: (path: string) => Promise<ImageBitmap>,
    /** Prévient qu'une texture vient d'arriver, pour redemander une frame. Sans
     *  ça, une texture chargée après le rendu n'apparaîtrait qu'au prochain
     *  geste — un effet qui se remplit tout seul « plus tard », en silence. */
    private readonly onLoaded: () => void,
  ) {}

  /** Remplace le catalogue. Les textures résidentes dont le CHEMIN change de
   *  rang sont libérées : garder une texture sous un index qui désigne
   *  désormais un autre fichier afficherait la mauvaise matière, sans erreur. */
  setCatalog(paths: readonly string[]): void {
    const before = this.catalog;
    this.catalog = paths;
    for (const [index, entry] of [...this.resident]) {
      if (before[index] !== paths[index]) {
        entry.texture.destroy();
        this.resident.delete(index);
      }
    }
  }

  get catalogSize(): number {
    return this.catalog.length;
  }

  /** Textures réellement en VRAM, et chargements en cours. Point de MESURE :
   *  « l'effet ne fait rien » a trois causes indiscernables à l'œil — catalogue
   *  vide, chargement jamais lancé, chargement échoué — et les trois rendent la
   *  même image inchangée. */
  get diagnostics(): { catalogue: number; residentes: number; enCours: number } {
    return { catalogue: this.catalog.length, residentes: this.resident.size, enCours: this.loading.size };
  }

  /** Chemin du rang `index`, ou `null` hors bornes. Sert au panneau à nommer la
   *  texture choisie sans dupliquer le catalogue. */
  pathAt(index: number): string | null {
    return this.catalog[index] ?? null;
  }

  /**
   * Vue GPU de la texture au rang `index`. **NE REND JAMAIS `null`** : hors
   * bornes, ou pas encore chargée, elle rend une texture 1×1 de repli.
   *
   * ⚠️ C'EST UN CHOIX D'ARCHITECTURE, pas une commodité. Le corps WGSL d'un
   * effet est une chaîne FIXE : s'il échantillonne `libraryTexture`, le binding
   * doit exister à chaque compilation, sinon le shader ne compile pas. Rendre
   * `null` obligerait à composer deux variantes du corps par effet — un
   * `#ifdef` textuel, exactement le genre de branche qui se désynchronise en
   * silence.
   *
   * Le shader distingue les deux cas par `textureDimensions(libraryTexture)` :
   * un côté à 1 signifie « pas de texture », et l'effet rend alors son entrée
   * inchangée. Explicite, sans deviner une couleur neutre — laquelle dépendrait
   * du mode de mélange et serait fausse pour la moitié d'entre eux.
   *
   * NE BLOQUE PAS : le chargement part en arrière-plan et `onLoaded` redemande
   * une frame.
   */
  viewFor(index: number): GPUTextureView {
    if (!Number.isInteger(index) || index < 0 || index >= this.catalog.length) {
      return this.placeholderView();
    }
    const entry = this.resident.get(index);
    if (entry) {
      this.clock += 1;
      entry.lastUsed = this.clock;
      return entry.texture.createView();
    }
    void this.load(index);
    return this.placeholderView();
  }

  /**
   * Attend qu'une texture soit RÉSIDENTE, ou rend la main tout de suite si elle
   * l'est déjà, si l'index est hors bornes, ou si son chargement échoue.
   *
   * ⚠️ CE N'EST PAS UN CONFORT DE TEST. `viewFor` ne bloque pas — c'est
   * délibéré, un rendu à l'écran ne s'arrête pas pour un décodage — mais un
   * EXPORT, lui, ne peut pas se permettre de sortir le repli 1×1 : le fichier
   * écrit serait dépourvu de l'effet, définitivement et sans message. C'est le
   * défaut qu'a révélé le garde de signal du harnais de rendu le 2026-08-05, en
   * mesurant 0,000 % d'écart là où un effet à texture aurait dû tout changer.
   */
  async ensureLoaded(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= this.catalog.length) return;
    if (this.resident.has(index)) return;
    await this.load(index);
  }

  /** Attend TOUS les chargements en cours. Appelé avant un export : à ce
   *  moment-là, les textures dont le rendu a besoin ont déjà été demandées par
   *  la frame précédente, donc les attendre suffit — sans avoir à savoir quels
   *  calques citent quelles textures. */
  async awaitPending(): Promise<void> {
    while (this.loading.size > 0) {
      await Promise.all([...this.loading.values()]);
    }
  }

  /** Texture 1×1 servie tant que la vraie n'est pas là. Créée à la première
   *  demande : un document qui n'utilise aucun effet à texture ne l'alloue
   *  jamais. */
  private placeholderView(): GPUTextureView {
    this.placeholder ??= this.device.createTexture({
      size: [1, 1],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return this.placeholder.createView();
  }

  private load(index: number): Promise<void> {
    const inFlight = this.loading.get(index);
    if (inFlight) return inFlight;
    const path = this.catalog[index];
    const task = (async () => {
      try {
        const bitmap = await this.decode(path);
        // Le catalogue a pu changer pendant le décodage : écrire sous un index
        // qui désigne désormais autre chose afficherait la mauvaise matière.
        if (this.disposed || this.catalog[index] !== path) {
          bitmap.close();
          return;
        }
        assertImageFitsGpu(bitmap.width, bitmap.height, this.maxTextureDimension);
        this.evictIfNeeded();
        // PYRAMIDE COMPLÈTE, et non un seul niveau (défaut jusqu'au 2026-08-14).
        // Un scan 8K échantillonné à l'échelle de l'écran lit un texel sur huit :
        // sans mip, le cache de texture ne sert à rien et l'image scintille.
        // Voir `mipmapGenerator.ts` pour pourquoi aucun test ne pouvait le voir.
        const niveaux = mipLevelCountFor(bitmap.width, bitmap.height);
        const texture = this.device.createTexture({
          size: [bitmap.width, bitmap.height],
          format: this.srgbFormat,
          mipLevelCount: niveaux,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
        bitmap.close();
        // APRÈS l'upload du niveau 0, qui est la source de toute la pyramide.
        this.mipmaps.generate(texture);
        this.clock += 1;
        this.resident.set(index, { texture, lastUsed: this.clock });
        this.onLoaded();
      } catch (e) {
        // TOTAL : un scan illisible ou trop grand pour le GPU laisse l'effet
        // sans texture, il ne fait pas tomber la frame. `assertImageFitsGpu`
        // lève au-delà de 8192 px, et c'est un cas utilisateur ordinaire.
        console.warn(`Texture de bibliothèque non chargée (${path}) :`, e);
      } finally {
        this.loading.delete(index);
      }
    })();
    this.loading.set(index, task);
    return task;
  }

  /** Évince le résident le moins récemment servi si le plafond est atteint. */
  private evictIfNeeded(): void {
    while (this.resident.size >= MAX_RESIDENT_LIBRARY_TEXTURES) {
      let oldestIndex: number | null = null;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [index, entry] of this.resident) {
        if (entry.lastUsed < oldest) {
          oldest = entry.lastUsed;
          oldestIndex = index;
        }
      }
      if (oldestIndex === null) return;
      this.resident.get(oldestIndex)?.texture.destroy();
      this.resident.delete(oldestIndex);
    }
  }

  /** Détruit toutes les textures possédées. Appelé au changement de document,
   *  même discipline que `PhotoSourceStore.dispose`. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.resident.values()) entry.texture.destroy();
    this.resident.clear();
    this.placeholder?.destroy();
    this.placeholder = null;
    this.catalog = [];
  }
}

import { MAX_PHOTO_LAYERS } from "../layers/photoLayer";
import { assertImageFitsGpu } from "./limits";

/** Côté maximal (px) de la vignette de calque produite à l'import. Le
 *  rapport d'aspect de la photo est conservé ; c'est la plus grande
 *  dimension qui est ramenée à cette valeur. */
export const THUMBNAIL_MAX_SIDE = 64;

/** Réduit `bitmap` à une vignette au plus `THUMBNAIL_MAX_SIDE` de côté et
 *  rend une object URL. Isolé du reste, et TOTAL : toute défaillance du
 *  chemin vignette (absence d'`OffscreenCanvas` en env Node/WebView2
 *  ancienne, contexte 2d refusé, `drawImage`/`convertToBlob` qui jettent)
 *  rend `null`. Jamais une exception : elle ferait échouer tout l'import
 *  d'une photo — texture déjà enregistrée comprise — pour une vignette.
 *  L'échec n'est pas silencieux pour autant : il est journalisé en
 *  avertissement (la photo, elle, est bien importée). */
async function buildThumbnailUrl(bitmap: ImageBitmap): Promise<string | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  try {
    const ratio = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn("Vignette de calque non produite (la photo est importée quand même) :", e);
    return null;
  }
}

/** Plafond de sources photo ENREGISTRÉES (vivantes) dans un même document —
 *  à distinguer de `MAX_PHOTO_LAYERS`, qui plafonne les calques photo
 *  PRÉSENTS dans la pile. Les deux diffèrent parce qu'il n'y a
 *  volontairement pas de refcount : une source n'est jamais libérée au
 *  retrait de son calque (un undo peut le ramener), elle vit jusqu'au
 *  changement de document (`dispose()`). Une boucle importer/annuler fait
 *  donc croître la mémoire sans borne — ce garde est cette borne.
 *
 *  Vaut 20 depuis que `MAX_PHOTO_LAYERS` est passé à 5 (arbitrage n°3 du
 *  2026-07-28) : il en DÉRIVE, il ne se pose pas à côté.
 *
 *  Facteur 4 : pas arbitraire assumé (design
 *  `2026-07-26-shaderlab-photo-layer-parity-design.md` §3.5). Il borne la
 *  fuite sans gêner un usage normal (4 imports annulés par calque autorisé),
 *  et il est révisé par la MÊME mesure VRAM que `MAX_PHOTO_LAYERS` — voir le
 *  critère de révision sur cette constante (`src/layers/photoLayer.ts`).
 *  Posé ICI et pas dans l'UI : `PhotoSourceStore` est le point unique
 *  d'allocation (ARCHITECTURE.md R1 : « si un garde arrive, il se pose dans
 *  `PhotoSourceStore`, pas dispersé »). */
export const MAX_REGISTERED_PHOTO_SOURCES = 4 * MAX_PHOTO_LAYERS;

/**
 * Propriétaire EXCLUSIF de tout ce qui n'est pas sérialisable d'une source
 * photo importée (double exposure, ARCHITECTURE.md §4.2) : la texture GPU
 * ET la vignette d'affichage. Rien de tout ça n'est jamais référencé depuis
 * `LayerState`/le state React/un snapshot d'historique (invariant OOM,
 * `e3c7584`) — `LayerState` ne porte qu'un `sourceId`, et la vignette se lit
 * par accesseur (`thumbnailUrl`), symétrique de `dimensions`. Vit aux côtés
 * d'`ImageFrameResources` dans `render/` (même cycle de vie : créé/vidé avec
 * le document), jamais dans `layers/`, qui ne doit jamais dépendre de
 * WebGPU.
 */
export class PhotoSourceStore {
  private textures = new Map<string, GPUTexture>();
  private sizes = new Map<string, { width: number; height: number }>();
  private thumbnails = new Map<string, string>();
  private nextId = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly maxTextureDimension2D: number,
  ) {}

  /** Nombre de sources actuellement enregistrées (vivantes). Remis à zéro par
   *  `dispose()` — c'est `textures.size` et pas un compteur parallèle, pour
   *  qu'aucune dérive entre les deux ne soit possible. */
  get registeredCount(): number {
    return this.textures.size;
  }

  /** Valide, alloue et uploade une nouvelle source de photo, et produit sa
   *  vignette d'affichage à partir du MÊME `ImageBitmap` déjà décodé.
   *  Retourne un `sourceId` frais à CHAQUE appel, même pour un bitmap
   *  identique — deux imports distincts de la même photo sont deux sources
   *  indépendantes.
   *
   *  ASYNC à cause de `convertToBlob`. L'appelant DOIT l'attendre avant
   *  d'ajouter le calque, pour que le re-render qui crée la ligne ait déjà
   *  sa vignette (sinon apparition différée sans re-render). La texture,
   *  elle, est allouée et uploadée AVANT tout `await`, et
   *  `buildThumbnailUrl` est TOTAL (jamais de rejet) : un échec de vignette
   *  ne peut ni faire rejeter `register` ni laisser une source enregistrée
   *  sous un `sourceId` que personne ne recevrait (fuite VRAM).
   *
   *  Fuite assumée et nommée (design §3.3) : un `sourceId` frais par appel
   *  signifie qu'une boucle importer/annuler accumule texture + blob +
   *  object URL jusqu'au changement de document. `MAX_REGISTERED_PHOTO_SOURCES`
   *  borne cette fuite : la garde leve AVANT toute allocation (fail-fast). */
  async register(bitmap: ImageBitmap): Promise<string> {
    if (this.textures.size >= MAX_REGISTERED_PHOTO_SOURCES) {
      throw new Error(
        `Trop de photos importées dans cette session (${this.textures.size}/${MAX_REGISTERED_PHOTO_SOURCES}) : ` +
          `chaque import garde sa texture en mémoire jusqu'au changement de document, même après annulation. ` +
          `Ouvre à nouveau le document pour libérer la mémoire.`,
      );
    }
    assertImageFitsGpu(bitmap.width, bitmap.height, this.maxTextureDimension2D);
    this.nextId += 1;
    const sourceId = `photo-${this.nextId}`;
    const texture = this.device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height],
    );
    this.textures.set(sourceId, texture);
    this.sizes.set(sourceId, { width: bitmap.width, height: bitmap.height });
    const url = await buildThumbnailUrl(bitmap);
    if (url !== null) this.thumbnails.set(sourceId, url);
    return sourceId;
  }

  get(sourceId: string): GPUTexture | null {
    return this.textures.get(sourceId) ?? null;
  }

  dimensions(sourceId: string): { width: number; height: number } | null {
    return this.sizes.get(sourceId) ?? null;
  }

  /** Object URL de la vignette d'affichage — accesseur SYMÉTRIQUE de
   *  `dimensions()`, même contrat : lecture par `sourceId`, `null` si
   *  inconnu. `null` aussi quand la vignette n'a pas pu être produite
   *  (pas d'`OffscreenCanvas`) : l'appelant affiche alors un emplacement
   *  vide, il ne casse pas. Retourne une CHAÎNE, jamais un raster — c'est ce
   *  qui autorise `LayerPanel` à l'afficher sans rien faire entrer dans le
   *  state React (invariant OOM). */
  thumbnailUrl(sourceId: string): string | null {
    return this.thumbnails.get(sourceId) ?? null;
  }

  /** Détruit toutes les textures possédées ET révoque toutes les object URL
   *  de vignette — appelé au changement de document (même discipline que
   *  `ImageFrameResources.dispose()`), jamais au retrait d'un seul calque
   *  (pas de refcount : un calque supprimé peut revenir par undo, libérer sa
   *  source casserait l'undo). Sans la révocation, chaque changement de
   *  document laisserait fuiter un blob par photo importée pour toute la
   *  durée de vie de la page. C'est aussi le seul point qui rend des jetons
   *  sous `MAX_REGISTERED_PHOTO_SOURCES`, et la sortie que nomme son
   *  message d'erreur. */
  dispose(): void {
    for (const texture of this.textures.values()) texture.destroy();
    for (const url of this.thumbnails.values()) URL.revokeObjectURL(url);
    this.textures.clear();
    this.sizes.clear();
    this.thumbnails.clear();
  }
}

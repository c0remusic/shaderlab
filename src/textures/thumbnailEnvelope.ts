/** Dimensions en pixels d'une image. Vit ICI depuis que les dimensions
 *  arrivent par l'enveloppe : elles étaient lues en TypeScript dans l'en-tête
 *  du fichier source (`imageDimensions.ts`, supprimé le 2026-08-05), ce qui
 *  supposait de faire transiter les 60 Mo du scan par l'IPC — exactement la
 *  dépense que le passage du décodage côté Rust a supprimée. */
export interface ImagePixelSize {
  width: number;
  height: number;
}

/**
 * Format d'une entrée du cache disque de vignettes : huit octets d'en-tête
 * (largeur puis hauteur de la texture SOURCE, entiers 32 bits big-endian),
 * suivis du PNG de l'aperçu.
 *
 * POURQUOI UN EN-TÊTE PLUTÔT QUE LE PNG SEUL. La grille affiche deux choses :
 * l'aperçu, et les dimensions NATIVES du scan (8192 × 8192 ou autre), qui
 * décident si la texture est même importable. Or les dimensions du PNG en
 * cache sont celles de la VIGNETTE — 128 px de large. Sans cet en-tête, il
 * faudrait relire le fichier source pour retrouver ses dimensions, c'est-à-dire
 * refaire exactement la lecture de 60 Mo que le cache existe pour éviter.
 *
 * Un seul fichier plutôt qu'un PNG plus un sidecar JSON : deux fichiers, ce
 * sont deux écritures à garder cohérentes et deux lectures à faire échouer
 * séparément.
 *
 * Big-endian, comme les en-têtes PNG et JPEG eux-mêmes, et comme les
 * `to_be_bytes()` qui l'écrivent côté Rust (`build_thumbnail_envelope`) — une
 * seule convention d'octets des deux côtés de l'IPC.
 *
 * PUR : ni DOM ni IPC, testable en Node.
 */
export const THUMBNAIL_ENVELOPE_HEADER_BYTES = 8;

export interface ThumbnailEnvelope {
  /** Dimensions de la texture SOURCE, pas de la vignette. */
  size: ImagePixelSize;
  /** PNG de l'aperçu. */
  png: Uint8Array;
}

export function encodeThumbnailEnvelope(size: ImagePixelSize, png: Uint8Array): Uint8Array {
  const out = new Uint8Array(THUMBNAIL_ENVELOPE_HEADER_BYTES + png.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, size.width, false);
  view.setUint32(4, size.height, false);
  out.set(png, THUMBNAIL_ENVELOPE_HEADER_BYTES);
  return out;
}

/**
 * Décode une entrée de cache, ou rend `null` si elle est inexploitable.
 *
 * `null` et jamais une exception : une entrée tronquée (écriture interrompue,
 * disque plein) doit faire retomber l'appelant sur le chemin complet, pas faire
 * tomber la grille. Une dimension nulle compte comme inexploitable — elle se
 * propagerait dans l'arithmétique de couverture.
 */
export function decodeThumbnailEnvelope(bytes: Uint8Array): ThumbnailEnvelope | null {
  if (bytes.length <= THUMBNAIL_ENVELOPE_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(0, false);
  const height = view.getUint32(4, false);
  if (width <= 0 || height <= 0) return null;
  return { size: { width, height }, png: bytes.subarray(THUMBNAIL_ENVELOPE_HEADER_BYTES) };
}

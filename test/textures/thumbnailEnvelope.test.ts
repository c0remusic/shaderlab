import { describe, it, expect } from "vitest";
import {
  THUMBNAIL_ENVELOPE_HEADER_BYTES,
  decodeThumbnailEnvelope,
  encodeThumbnailEnvelope,
} from "../../src/textures/thumbnailEnvelope";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("enveloppe de vignette", () => {
  it("fait l'aller-retour sur les dimensions de la SOURCE, pas de la vignette", () => {
    const round = decodeThumbnailEnvelope(encodeThumbnailEnvelope({ width: 8192, height: 8192 }, PNG));
    expect(round?.size).toEqual({ width: 8192, height: 8192 });
    expect([...(round?.png ?? [])]).toEqual([...PNG]);
  });

  it("le PNG décodé est une VUE qui ne recouvre pas l'en-tête", () => {
    // Le piège de ce format : `decode` rend un `subarray`, dont `.buffer` est
    // le buffer ENTIER. Un `new Blob([vue.buffer])` embarquerait les huit
    // octets de dimensions en tête du PNG — fichier invalide, vignette qui ne
    // s'affiche jamais, et rien d'autre pour le signaler.
    const bytes = encodeThumbnailEnvelope({ width: 100, height: 200 }, PNG);
    const png = decodeThumbnailEnvelope(bytes)?.png;
    expect(png?.byteOffset).toBe(THUMBNAIL_ENVELOPE_HEADER_BYTES);
    expect(png?.byteLength).toBe(PNG.length);
    expect(png?.buffer.byteLength).toBe(bytes.length); // le buffer, lui, est plus grand
    // Ce que le composant affiche vraiment doit commencer par la signature PNG.
    expect([...(png ?? []).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("supporte des dimensions au-delà de 32767 sans passer en négatif", () => {
    // `setUint32`/`getUint32` et non des décalages binaires : au-delà de
    // 0x7FFFFFFF les opérateurs binaires de JS travaillent en signé.
    const round = decodeThumbnailEnvelope(encodeThumbnailEnvelope({ width: 65535, height: 40000 }, PNG));
    expect(round?.size).toEqual({ width: 65535, height: 40000 });
  });

  it("rend null sur une entrée inexploitable plutôt que de lever", () => {
    // Écriture interrompue, disque plein : l'appelant doit retomber sur le
    // chemin complet, pas faire tomber la grille.
    expect(decodeThumbnailEnvelope(new Uint8Array(0))).toBeNull();
    expect(decodeThumbnailEnvelope(new Uint8Array(THUMBNAIL_ENVELOPE_HEADER_BYTES))).toBeNull();
    // Dimensions nulles : elles se propageraient dans l'arithmétique de
    // couverture, qui les traite comme dégénérées.
    expect(decodeThumbnailEnvelope(encodeThumbnailEnvelope({ width: 0, height: 10 }, PNG))).toBeNull();
  });
});

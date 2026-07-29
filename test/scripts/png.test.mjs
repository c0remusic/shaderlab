import { describe, it, expect } from "vitest";
import { encodePng, decodePng } from "../../scripts/lib/png.mjs";

/** Le harnais de rendu ne compare que des PIXELS. Le PNG n'y est qu'un
 *  conteneur de stockage — mais si son aller-retour perdait ne serait-ce
 *  qu'un LSB, chaque comparaison a une reference porterait cette perte et le
 *  harnais accuserait le rendu d'un defaut qui serait le sien. C'est le seul
 *  invariant qui compte ici, et il se teste sans GPU. */
describe("png", () => {
  const damier = (w, h) => {
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = (x * 7) & 255;
        px[i + 1] = (y * 13) & 255;
        px[i + 2] = ((x ^ y) * 3) & 255;
        px[i + 3] = 255;
      }
    return px;
  };

  it("rend exactement les octets encodes", () => {
    const px = damier(64, 48);
    const out = decodePng(encodePng(px, 64, 48));
    expect(out.width).toBe(64);
    expect(out.height).toBe(48);
    expect(Array.from(out.pixels)).toEqual(Array.from(px));
  });

  it("preserve un canal alpha non opaque", () => {
    const px = new Uint8Array([1, 2, 3, 0, 250, 251, 252, 127, 0, 0, 0, 255, 255, 255, 255, 1]);
    const out = decodePng(encodePng(px, 2, 2));
    expect(Array.from(out.pixels)).toEqual(Array.from(px));
  });

  it("leve si le tampon ne correspond pas aux dimensions", () => {
    expect(() => encodePng(new Uint8Array(10), 4, 4)).toThrow(/4x4/);
  });

  it("leve sur une signature qui n'est pas du PNG", () => {
    expect(() => decodePng(Buffer.alloc(32))).toThrow(/signature/);
  });
});

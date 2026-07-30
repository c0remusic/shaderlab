import { describe, it, expect } from "vitest";
import { MAX_CANVAS_PIXELS, assertCanvasWithinBudget, assertImageFitsGpu } from "../../src/render/limits";

describe("assertImageFitsGpu", () => {
  it("accepts dimensions within the limit", () => {
    expect(() => assertImageFitsGpu(6240, 4160, 16384)).not.toThrow();
  });

  it("rejects a width over the limit with an explicit message", () => {
    expect(() => assertImageFitsGpu(20000, 4000, 16384)).toThrow(/20000.*16384/);
  });

  it("rejects a height over the limit", () => {
    expect(() => assertImageFitsGpu(4000, 20000, 16384)).toThrow();
  });
});

// Borne du BUDGET (surface totale), distincte de la borne de DIMENSION ci-dessus.
// Posée par la tranche T2 (toile de format choisi) : sans elle, une toile
// réglable est un chèque en blanc sur la VRAM.
describe("assertCanvasWithinBudget", () => {
  it("laisse passer une toile ≡ photo de 26 Mpx (le cas d'aujourd'hui)", () => {
    expect(() => assertCanvasWithinBudget(6240, 4160)).not.toThrow();
  });

  it("laisse passer les trois formats nommés dérivés de cette photo", () => {
    for (const [w, h] of [
      [6240, 6240], // carré
      [6240, 4992], // 4:5 orienté paysage
      [4961, 3508], // A3 à 300 dpi
    ]) {
      expect(() => assertCanvasWithinBudget(w, h)).not.toThrow();
    }
  });

  it("refuse au-delà de la borne, en nommant la surface et le budget", () => {
    expect(() => assertCanvasWithinBudget(10000, 10000)).toThrow(/100\.0 Mpx.*64 Mpx/);
  });

  it("une dimension acceptable pour le GPU peut être refusée par le budget", () => {
    // 16000 × 8000 tient sous maxTextureDimension2D = 16384 sur beaucoup de
    // cartes : les deux bornes ne se remplacent pas.
    expect(() => assertImageFitsGpu(16000, 8000, 16384)).not.toThrow();
    expect(() => assertCanvasWithinBudget(16000, 8000)).toThrow();
  });

  it("la borne vaut 64 Mpx (8000 × 8000), valeur calibrée sur les mesures VRAM", () => {
    expect(MAX_CANVAS_PIXELS).toBe(64_000_000);
    expect(() => assertCanvasWithinBudget(8000, 8000)).not.toThrow();
  });
});

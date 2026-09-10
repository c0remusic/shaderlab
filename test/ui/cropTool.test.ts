import { describe, expect, it } from "vitest";
import {
  CROP_HANDLES,
  CROP_RATIOS,
  MIN_CROP_PX,
  applyRatioToRect,
  clampCropToDoc,
  cropRatioValue,
  effectiveCropRatio,
  initialCropRect,
  moveCropRect,
  resizeCropRect,
  type CropRect,
} from "../../src/ui/cropTool";

const DOC = { width: 400, height: 300 };
const handle = (id: string) => CROP_HANDLES.find((h) => h.id === id)!;

describe("cropTool — ratios", () => {
  it("liste les cinq ratios attendus", () => {
    expect(CROP_RATIOS.map((r) => r.id)).toEqual(["free", "original", "square", "4:5", "3:2"]);
  });

  it("Libre n'a pas de ratio", () => {
    expect(cropRatioValue("free", DOC)).toBeNull();
  });

  it("D'origine rend le ratio de la toile", () => {
    expect(cropRatioValue("original", DOC)).toBeCloseTo(400 / 300);
  });

  it("Carré vaut 1", () => {
    expect(cropRatioValue("square", DOC)).toBe(1);
  });

  // ORIENTÉ COMME LA TOILE, même règle qu'ADR-0007 : une toile paysage prend le
  // ratio en paysage (5:4, 3:2) plutôt qu'en portrait.
  it("4:5 et 3:2 sont orientés paysage sur une toile paysage", () => {
    expect(cropRatioValue("4:5", DOC)).toBeCloseTo(5 / 4);
    expect(cropRatioValue("3:2", DOC)).toBeCloseTo(3 / 2);
  });

  it("4:5 et 3:2 sont orientés portrait sur une toile portrait", () => {
    const portrait = { width: 300, height: 400 };
    expect(cropRatioValue("4:5", portrait)).toBeCloseTo(4 / 5);
    expect(cropRatioValue("3:2", portrait)).toBeCloseTo(2 / 3);
  });

  // « Maj contraint au ratio choisi » : en Libre, Maj rabat sur le carré.
  it("effectiveCropRatio : Maj rabat Libre sur le carré", () => {
    expect(effectiveCropRatio("free", DOC, false)).toBeNull();
    expect(effectiveCropRatio("free", DOC, true)).toBe(1);
    expect(effectiveCropRatio("square", DOC, false)).toBe(1);
  });
});

describe("cropTool — bornes et initialisation", () => {
  it("initialCropRect prend la toile entière sans cadre", () => {
    expect(initialCropRect(null, DOC)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("initialCropRect reprend le cadre courant (pour l'agrandir)", () => {
    const cadre = { x: 50, y: 40, width: 100, height: 80 };
    expect(initialCropRect(cadre, DOC)).toEqual(cadre);
  });

  it("clampCropToDoc ramène un rectangle qui déborde dans la toile", () => {
    const out = clampCropToDoc({ x: 380, y: 290, width: 100, height: 100 }, DOC);
    expect(out.x + out.width).toBeLessThanOrEqual(DOC.width);
    expect(out.y + out.height).toBeLessThanOrEqual(DOC.height);
  });

  it("clampCropToDoc respecte la taille minimale", () => {
    const out = clampCropToDoc({ x: 10, y: 10, width: 1, height: 1 }, DOC);
    expect(out.width).toBe(MIN_CROP_PX);
    expect(out.height).toBe(MIN_CROP_PX);
  });
});

describe("cropTool — déplacement", () => {
  const start: CropRect = { x: 100, y: 80, width: 120, height: 90 };

  it("déplace d'un delta en pixels de toile", () => {
    expect(moveCropRect(start, 30, -20, DOC)).toEqual({ x: 130, y: 60, width: 120, height: 90 });
  });

  it("ne sort jamais de la toile", () => {
    const out = moveCropRect(start, 10_000, 10_000, DOC);
    expect(out.x).toBe(DOC.width - start.width);
    expect(out.y).toBe(DOC.height - start.height);
  });
});

describe("cropTool — redimensionnement libre", () => {
  const start: CropRect = { x: 100, y: 80, width: 120, height: 90 };

  it("le coin bas-droit suit le pointeur, largeur/hauteur libres", () => {
    const out = resizeCropRect(start, handle("se"), 40, 20, null, DOC);
    expect(out).toEqual({ x: 100, y: 80, width: 160, height: 110 });
  });

  it("le coin haut-gauche garde le coin opposé fixe", () => {
    const out = resizeCropRect(start, handle("nw"), -30, -10, null, DOC);
    expect(out.x).toBe(70);
    expect(out.y).toBe(70);
    expect(out.x + out.width).toBe(220); // droite inchangée
    expect(out.y + out.height).toBe(170); // bas inchangé
  });

  it("un côté ne touche qu'un axe", () => {
    const out = resizeCropRect(start, handle("e"), 25, 999, null, DOC);
    expect(out.width).toBe(145);
    expect(out.height).toBe(90);
  });

  it("borne au bord de la toile", () => {
    const out = resizeCropRect(start, handle("se"), 10_000, 10_000, null, DOC);
    expect(out.x + out.width).toBeLessThanOrEqual(DOC.width);
    expect(out.y + out.height).toBeLessThanOrEqual(DOC.height);
  });
});

describe("cropTool — redimensionnement contraint", () => {
  const start: CropRect = { x: 100, y: 80, width: 120, height: 90 };

  it("un coin maintient la proportion", () => {
    const out = resizeCropRect(start, handle("se"), 60, 0, 2, DOC);
    expect(out.width / out.height).toBeCloseTo(2);
  });

  it("un côté horizontal étire aussi la hauteur pour tenir la proportion", () => {
    const out = resizeCropRect(start, handle("e"), 40, 0, 1, DOC);
    expect(out.width).toBeCloseTo(out.height);
  });

  it("reste dans la toile en gardant la proportion", () => {
    const out = resizeCropRect(start, handle("se"), 10_000, 0, 1, DOC);
    expect(out.width / out.height).toBeCloseTo(1);
    expect(out.x + out.width).toBeLessThanOrEqual(DOC.width + 1e-6);
    expect(out.y + out.height).toBeLessThanOrEqual(DOC.height + 1e-6);
  });
});

describe("cropTool — changement de ratio", () => {
  it("applyRatioToRect garde le centre et honore la proportion", () => {
    const rect = { x: 100, y: 80, width: 120, height: 90 };
    const out = applyRatioToRect(rect, 1, DOC);
    expect(out.width / out.height).toBeCloseTo(1);
    const cx = out.x + out.width / 2;
    const cy = out.y + out.height / 2;
    expect(cx).toBeCloseTo(160);
    expect(cy).toBeCloseTo(125);
  });

  it("Libre ne touche pas au rectangle (juste borné)", () => {
    const rect = { x: 100, y: 80, width: 120, height: 90 };
    expect(applyRatioToRect(rect, null, DOC)).toEqual(rect);
  });
});

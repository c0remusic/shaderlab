import { describe, expect, it } from "vitest";
import {
  A3_MM,
  A3_PRINT_DPI,
  PHOTO_CANVAS_FORMAT,
  canvasSizeFor,
  parseFreeCanvasRequest,
} from "../../src/layers/canvasFormat";
import { MAX_CANVAS_PIXELS, assertCanvasWithinBudget } from "../../src/render/limits";

/** Photo de référence des mesures VRAM du projet : 6240 × 4160 = 25,96 Mpx. */
const PHOTO_26MP = { width: 6240, height: 4160 };

describe("canvasSizeFor — le défaut ne change rien", () => {
  it("« comme la photo » rend EXACTEMENT les dimensions de la photo", () => {
    expect(canvasSizeFor(PHOTO_CANVAS_FORMAT, PHOTO_26MP)).toEqual(PHOTO_26MP);
  });

  it("le défaut est le format photo — ouvrir sans rien choisir n'a rien à choisir", () => {
    expect(PHOTO_CANVAS_FORMAT).toEqual({ kind: "photo" });
  });

  it("une photo carrée reste carrée, au pixel près", () => {
    expect(canvasSizeFor(PHOTO_CANVAS_FORMAT, { width: 256, height: 256 })).toEqual({
      width: 256,
      height: 256,
    });
  });
});

describe("canvasSizeFor — formats nommés dérivés par CONTENANCE", () => {
  it("« carré » prend le plus grand côté de la photo : la photo tient entière, à 100 %", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "carre" }, PHOTO_26MP)).toEqual({
      width: 6240,
      height: 6240,
    });
  });

  it("« carré » sur une photo portrait prend aussi le plus grand côté", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "carre" }, { width: 3000, height: 4000 })).toEqual({
      width: 4000,
      height: 4000,
    });
  });

  it("« carré » sur une photo déjà carrée ne l'agrandit pas d'un pixel", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "carre" }, { width: 512, height: 512 })).toEqual({
      width: 512,
      height: 512,
    });
  });

  it("« 4:5 » suit l'ORIENTATION de la photo — un paysage rend 5:4, jamais un portrait", () => {
    // Orienter le ratio comme la photo, plutôt que d'imposer le portrait,
    // évite 50 % de surface (donc de VRAM) gagnés uniquement pour tourner le
    // cadre. Ici : 6240 × 4992 = 31,2 Mpx, contre 6240 × 7800 = 48,7 Mpx en
    // portrait forcé.
    expect(canvasSizeFor({ kind: "nomme", format: "quatre-cinq" }, PHOTO_26MP)).toEqual({
      width: 6240,
      height: 4992,
    });
  });

  it("« 4:5 » sur une photo portrait rend bien un portrait 4:5", () => {
    expect(canvasSizeFor({ kind: "nomme", format: "quatre-cinq" }, { width: 4000, height: 4000 })).toEqual({
      width: 4000,
      height: 5000,
    });
  });

  it("« 4:5 » contient toujours la photo à sa résolution native", () => {
    for (const photo of [
      { width: 6240, height: 4160 },
      { width: 4160, height: 6240 },
      { width: 1000, height: 1000 },
      { width: 3, height: 7 },
    ]) {
      const toile = canvasSizeFor({ kind: "nomme", format: "quatre-cinq" }, photo);
      expect(toile.width).toBeGreaterThanOrEqual(photo.width);
      expect(toile.height).toBeGreaterThanOrEqual(photo.height);
    }
  });

  it("« A3 » est ABSOLU : 297 × 420 mm à 300 dpi, indépendant de la photo", () => {
    // 297 / 25,4 × 300 = 3507,87 → 3508 ; 420 / 25,4 × 300 = 4960,63 → 4961.
    const paysage = canvasSizeFor({ kind: "nomme", format: "a3" }, PHOTO_26MP);
    expect(paysage).toEqual({ width: 4961, height: 3508 });
    const portrait = canvasSizeFor({ kind: "nomme", format: "a3" }, { width: 3000, height: 4000 });
    expect(portrait).toEqual({ width: 3508, height: 4961 });
  });

  it("« A3 » peut être PLUS PETIT que la photo — le débordement est assumé", () => {
    // 17,4 Mpx contre 26 Mpx : la photo dépasse. C'est le comportement voulu
    // (`PhotoPanel` : « une photo peut légitimement être positionnée hors du
    // fond ») et la seule alternative serait de trahir le format d'impression.
    const toile = canvasSizeFor({ kind: "nomme", format: "a3" }, PHOTO_26MP);
    expect(toile.width * toile.height).toBeLessThan(PHOTO_26MP.width * PHOTO_26MP.height);
  });

  it("A3 est dérivé des millimètres et du dpi, pas d'un couple de pixels recopié", () => {
    expect(A3_PRINT_DPI).toBe(300);
    expect(A3_MM).toEqual({ short: 297, long: 420 });
  });
});

describe("canvasSizeFor — saisie libre", () => {
  it("rend exactement ce qui est saisi", () => {
    expect(canvasSizeFor({ kind: "libre", width: 1080, height: 1350 }, PHOTO_26MP)).toEqual({
      width: 1080,
      height: 1350,
    });
  });

  it("refuse une dimension non entière plutôt que de l'arrondir en silence", () => {
    expect(() => canvasSizeFor({ kind: "libre", width: 100.5, height: 100 }, PHOTO_26MP)).toThrow(
      /entier/,
    );
  });

  it("refuse une dimension nulle ou négative", () => {
    for (const bad of [0, -1]) {
      expect(() => canvasSizeFor({ kind: "libre", width: bad, height: 100 }, PHOTO_26MP)).toThrow();
      expect(() => canvasSizeFor({ kind: "libre", width: 100, height: bad }, PHOTO_26MP)).toThrow();
    }
  });

  it("refuse NaN / Infinity", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => canvasSizeFor({ kind: "libre", width: bad, height: 100 }, PHOTO_26MP)).toThrow();
    }
  });
});

describe("parseFreeCanvasRequest — validation de la saisie libre", () => {
  it("accepte deux entiers et rend la demande de format", () => {
    expect(parseFreeCanvasRequest("1080", "1350")).toEqual({
      kind: "ok",
      request: { kind: "libre", width: 1080, height: 1350 },
    });
  });

  it("tolère les espaces autour des nombres", () => {
    expect(parseFreeCanvasRequest("  800 ", " 800")).toEqual({
      kind: "ok",
      request: { kind: "libre", width: 800, height: 800 },
    });
  });

  it("un champ vide n'est pas une erreur de pipeline : un message, pas une exception", () => {
    const r = parseFreeCanvasRequest("", "800");
    expect(r.kind).toBe("erreur");
    expect(r.kind === "erreur" && r.message).toMatch(/Largeur et hauteur/);
  });

  it("refuse une décimale — jamais d'arrondi silencieux", () => {
    const r = parseFreeCanvasRequest("100.5", "100");
    expect(r.kind).toBe("erreur");
    expect(r.kind === "erreur" && r.message).toMatch(/entier/);
  });

  it("refuse une saisie non numérique", () => {
    expect(parseFreeCanvasRequest("abc", "100").kind).toBe("erreur");
  });

  it("refuse au-delà du budget, en reprenant le message de la borne", () => {
    const r = parseFreeCanvasRequest("20000", "20000");
    expect(r.kind).toBe("erreur");
    expect(r.kind === "erreur" && r.message).toMatch(/Mpx/);
  });
});

describe("assertCanvasWithinBudget — la borne nommée du budget VRAM", () => {
  it("laisse passer la borne exacte", () => {
    expect(() => assertCanvasWithinBudget(8000, MAX_CANVAS_PIXELS / 8000)).not.toThrow();
  });

  it("refuse un pixel au-dessus, en nommant la borne et la surface demandée", () => {
    const side = Math.ceil(Math.sqrt(MAX_CANVAS_PIXELS)) + 1;
    expect(() => assertCanvasWithinBudget(side, side)).toThrow(/Mpx/);
  });

  it("la borne est celle que le module publie, pas un nombre recopié ailleurs", () => {
    expect(MAX_CANVAS_PIXELS).toBe(64_000_000);
  });

  it("tout format nommé dérivé de la photo de 26 Mpx tient sous la borne", () => {
    // La raison d'être du calibrage : les trois formats proposés à l'ouverture
    // ne doivent pas être refusés sur la photo de référence du projet.
    for (const format of ["carre", "quatre-cinq", "a3"] as const) {
      expect(() => canvasSizeFor({ kind: "nomme", format }, PHOTO_26MP)).not.toThrow();
    }
  });

  it("une saisie libre au-delà de la borne est refusée par le même chemin", () => {
    expect(() => canvasSizeFor({ kind: "libre", width: 20000, height: 20000 }, PHOTO_26MP)).toThrow(
      /Mpx/,
    );
  });

  it("un format nommé qui dépasserait la borne est refusé, pas tronqué", () => {
    // Une photo panoramique très large rend un carré énorme : 9000² = 81 Mpx.
    expect(() => canvasSizeFor({ kind: "nomme", format: "carre" }, { width: 9000, height: 1200 })).toThrow(
      /Mpx/,
    );
  });
});

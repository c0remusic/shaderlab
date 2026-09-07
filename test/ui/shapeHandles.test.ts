import { describe, expect, it } from "vitest";
import { STRETCH_HANDLES, type StretchHandle } from "../../src/ui/effectStretch";
import { nudgeShapeBox, resizeShapeBox, shapeFrame } from "../../src/ui/shapeHandles";
import type { ShapeBox } from "../../src/ui/shapeDraw";

/**
 * LES POIGNÉES DE LA FORME (ticket 13). Module PUR : ces cas gardent le pivot
 * sur le BORD OPPOSÉ (une boîte à deux coins, pas un facteur d'échelle), le
 * cumul depuis l'appui, le carré SUR LA TOILE, et le déplacement clavier borné.
 */

const CARRE: ShapeBox = { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.6 };
const TOILE = { width: 1000, height: 1000 };
const droite = STRETCH_HANDLES.find((h) => h.id === "e")!;
const gauche = STRETCH_HANDLES.find((h) => h.id === "w")!;
const bas = STRETCH_HANDLES.find((h) => h.id === "s")!;
const haut = STRETCH_HANDLES.find((h) => h.id === "n")!;
const coinBasDroit = STRETCH_HANDLES.find((h) => h.id === "se")!;
const coinHautGauche = STRETCH_HANDLES.find((h) => h.id === "nw")!;

describe("shapeFrame", () => {
  it("rend les bords min/max quels que soient l'ordre des coins", () => {
    expect(shapeFrame({ x0: 0.6, y0: 0.7, x1: 0.2, y1: 0.3 })).toEqual({ left: 0.2, right: 0.6, top: 0.3, bottom: 0.7 });
  });
});

describe("resizeShapeBox", () => {
  it("delta nul rend la boîte de départ au bit près (pas de saut à la prise)", () => {
    for (const handle of STRETCH_HANDLES) {
      expect(resizeShapeBox(handle, CARRE, 0, 0, false, TOILE)).toEqual(CARRE);
    }
  });

  it("côté droit : dx écrit x1, le bord GAUCHE (opposé) ne bouge pas", () => {
    const out = resizeShapeBox(droite, CARRE, 0.1, 0.3, false, TOILE);
    expect(out.x1).toBeCloseTo(0.7, 6);
    expect(out.x0).toBeCloseTo(0.2, 6); // bord opposé fixe
    expect(out.y0).toBeCloseTo(0.2, 6); // un côté ne touche qu'un axe
    expect(out.y1).toBeCloseTo(0.6, 6);
  });

  it("côté gauche : dx écrit x0, le bord DROIT reste fixe", () => {
    const out = resizeShapeBox(gauche, CARRE, -0.1, 0, false, TOILE);
    expect(out.x0).toBeCloseTo(0.1, 6);
    expect(out.x1).toBeCloseTo(0.6, 6);
  });

  it("côtés haut/bas écrivent y0/y1", () => {
    expect(resizeShapeBox(bas, CARRE, 0, 0.1, false, TOILE).y1).toBeCloseTo(0.7, 6);
    expect(resizeShapeBox(haut, CARRE, 0, -0.1, false, TOILE).y0).toBeCloseTo(0.1, 6);
  });

  it("un coin écrit les DEUX coins mobiles", () => {
    const out = resizeShapeBox(coinBasDroit, CARRE, 0.1, 0.2, false, TOILE);
    expect(out.x1).toBeCloseTo(0.7, 6);
    expect(out.y1).toBeCloseTo(0.8, 6);
    expect(out.x0).toBeCloseTo(0.2, 6);
    expect(out.y0).toBeCloseTo(0.2, 6);
  });

  it("Maj sur un coin : carré SUR LA TOILE, sur le plus grand côté, autour du coin opposé", () => {
    // Toile carrée, ancre au coin haut-gauche (0,2 ; 0,2). Étendues depuis
    // l'ancre : 0,5 en x (0,2→0,7), 0,7 en y (0,2→0,9). Le plus grand (0,7)
    // impose le côté sur les deux axes → les deux coins mobiles à 0,9.
    const out = resizeShapeBox(coinBasDroit, CARRE, 0.1, 0.3, true, TOILE);
    expect(out.x1 - out.x0).toBeCloseTo(out.y1 - out.y0, 6);
    expect(out.x1).toBeCloseTo(0.9, 6);
    expect(out.y1).toBeCloseTo(0.9, 6);
  });

  it("Maj compte en PIXELS : sur une toile non carrée le carré est carré en pixels, pas en fraction", () => {
    // Toile 2000x1000, boîte {0,1..0,3}, coin bas-droit tiré de 0,2 en x. Étendue
    // x depuis l'ancre = 0,4 (800 px), étendue y = 0,2 (200 px) : le plus grand
    // en PIXELS (800) impose les deux côtés, qui finissent égaux EN PIXELS.
    const toile = { width: 2000, height: 1000 };
    const petite: ShapeBox = { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 };
    const out = resizeShapeBox(coinBasDroit, petite, 0.2, 0.0, true, toile);
    const largeurPx = (out.x1 - out.x0) * toile.width;
    const hauteurPx = (out.y1 - out.y0) * toile.height;
    expect(largeurPx).toBeCloseTo(hauteurPx, 4);
    expect(largeurPx).toBeCloseTo(800, 4);
  });

  it("Maj est IGNORÉ sur un côté (un seul axe, pas de carré)", () => {
    const sansMaj = resizeShapeBox(droite, CARRE, 0.1, 0, false, TOILE);
    const avecMaj = resizeShapeBox(droite, CARRE, 0.1, 0, true, TOILE);
    expect(avecMaj).toEqual(sansMaj);
  });

  it("le bord tiré ne croise jamais le bord opposé (pas de retournement)", () => {
    // Tirer le côté droit très loin vers la gauche : x1 s'arrête à x0 + MIN_COTE.
    const out = resizeShapeBox(droite, CARRE, -10, 0, false, TOILE);
    expect(out.x1).toBeGreaterThan(out.x0);
    expect(out.x1 - out.x0).toBeCloseTo(0.005, 6);
  });

  it("les bords sont bornés à [0, 1] (la source ne sort pas de l'image)", () => {
    const out = resizeShapeBox(coinHautGauche, CARRE, -5, -5, false, TOILE);
    expect(out.x0).toBe(0);
    expect(out.y0).toBe(0);
    const out2 = resizeShapeBox(coinBasDroit, CARRE, 5, 5, false, TOILE);
    expect(out2.x1).toBe(1);
    expect(out2.y1).toBe(1);
  });

  it("cumul depuis l'appui : aller à fond puis revenir ne dérive pas", () => {
    resizeShapeBox(droite, CARRE, 5, 0, false, TOILE); // écrêté au bord
    const retour = resizeShapeBox(droite, CARRE, 0.05, 0, false, TOILE);
    expect(retour.x1).toBeCloseTo(0.65, 6);
  });
});

describe("nudgeShapeBox", () => {
  it("déplace la boîte sans la déformer", () => {
    const out = nudgeShapeBox(CARRE, 0.1, -0.05);
    expect(out.x0).toBeCloseTo(0.3, 6);
    expect(out.x1).toBeCloseTo(0.7, 6);
    expect(out.y0).toBeCloseTo(0.15, 6);
    expect(out.y1).toBeCloseTo(0.55, 6);
    // largeur/hauteur inchangées.
    expect(out.x1 - out.x0).toBeCloseTo(0.4, 6);
    expect(out.y1 - out.y0).toBeCloseTo(0.4, 6);
  });

  it("s'arrête au bord de l'image au lieu de rétrécir", () => {
    const out = nudgeShapeBox(CARRE, 1, 0); // pousse loin à droite
    expect(out.x1).toBeCloseTo(1, 6);
    expect(out.x1 - out.x0).toBeCloseTo(0.4, 6); // largeur préservée
  });

  it("normalise les coins désordonnés avant de déplacer", () => {
    const out = nudgeShapeBox({ x0: 0.6, y0: 0.6, x1: 0.2, y1: 0.2 }, 0.1, 0);
    expect(out.x0).toBeCloseTo(0.3, 6);
    expect(out.x1).toBeCloseTo(0.7, 6);
  });
});

/** Sécurité de type : les huit poignées du socle sont réutilisées telles quelles. */
const _handles: readonly StretchHandle[] = STRETCH_HANDLES;
void _handles;

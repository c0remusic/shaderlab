import { describe, expect, it } from "vitest";
import {
  MAX_EFFECT_SCALE,
  MIN_EFFECT_SCALE,
  STRETCH_HANDLES,
  handlePoint,
  stretchScale,
  transformedFrame,
  type StretchHandle,
} from "../../src/ui/effectStretch";

/**
 * LE GESTE « ÉTIRER / APLATIR » D'UN CALQUE D'EFFET PLACÉ (ticket 24, tranche 3).
 *
 * Module PUR : ces cas gardent le pivot sur l'ANCRE (pas le côté opposé), le
 * cumul depuis l'appui (pas de saut à la prise, pas de dérive aux bornes), les
 * bornes par axe, et la géométrie de la boîte dessinée.
 */

const CENTRE = { x: 0.5, y: 0.5 };
const IDENTITE = { scaleX: 1, scaleY: 1 };
const droite = STRETCH_HANDLES.find((h) => h.id === "e")!;
const bas = STRETCH_HANDLES.find((h) => h.id === "s")!;
const gauche = STRETCH_HANDLES.find((h) => h.id === "w")!;
const haut = STRETCH_HANDLES.find((h) => h.id === "n")!;
const coinBasDroit = STRETCH_HANDLES.find((h) => h.id === "se")!;

describe("stretchScale", () => {
  it("delta nul rend l'échelle de départ au bit près (pas de saut à la prise)", () => {
    const depart = { scaleX: 1.6, scaleY: 0.4 };
    for (const handle of STRETCH_HANDLES) {
      expect(stretchScale(handle, CENTRE, depart, 0, 0)).toEqual(depart);
    }
  });

  it("côté droit : dx > 0 agrandit scaleX, dy est ignoré", () => {
    // Ancre au centre : distance côté→ancre = 0,5, donc sx = 1 + dx/0,5 = 1 + 2·dx.
    const out = stretchScale(droite, CENTRE, IDENTITE, 0.1, 0.3);
    expect(out.scaleX).toBeCloseTo(1.2, 6);
    expect(out.scaleY).toBe(1); // un côté ne touche qu'un axe
  });

  it("côté gauche : signe OPPOSÉ au côté droit (tirer vers l'ancre agrandit)", () => {
    // dx négatif (vers la gauche) agrandit : sx = 1 - dx/0,5 = 1 - 2·dx.
    expect(stretchScale(gauche, CENTRE, IDENTITE, -0.1, 0).scaleX).toBeCloseTo(1.2, 6);
    // dx positif (vers l'ancre) rétrécit.
    expect(stretchScale(gauche, CENTRE, IDENTITE, 0.1, 0).scaleX).toBeCloseTo(0.8, 6);
  });

  it("côté bas aplatit/étire scaleY ; côté haut est de signe opposé", () => {
    expect(stretchScale(bas, CENTRE, IDENTITE, 0, -0.3).scaleY).toBeCloseTo(0.4, 6); // aplatir
    expect(stretchScale(haut, CENTRE, IDENTITE, 0, 0.3).scaleY).toBeCloseTo(0.4, 6);
  });

  it("un coin commande les DEUX axes", () => {
    const out = stretchScale(coinBasDroit, CENTRE, IDENTITE, 0.1, -0.2);
    expect(out.scaleX).toBeCloseTo(1.2, 6);
    expect(out.scaleY).toBeCloseTo(0.6, 6);
  });

  it("l'ancre décentrée change le facteur (distance côté→ancre)", () => {
    // Ancre à 0,25 : distance au côté droit = 0,75, sx = 1 + dx/0,75.
    const out = stretchScale(droite, { x: 0.25, y: 0.5 }, IDENTITE, 0.15, 0);
    expect(out.scaleX).toBeCloseTo(1.2, 6);
  });

  it("borne chaque axe à [MIN, MAX] — pas de valeur négative même au-delà de l'ancre", () => {
    // Tirer le côté droit très loin vers la gauche voudrait une échelle négative :
    // le plancher la ramène à MIN, jamais sous zéro (le miroir n'est pas demandé).
    expect(stretchScale(droite, CENTRE, IDENTITE, -10, 0).scaleX).toBe(MIN_EFFECT_SCALE);
    expect(stretchScale(droite, CENTRE, IDENTITE, 100, 0).scaleX).toBe(MAX_EFFECT_SCALE);
  });

  it("ancre pile sur le bord : le côté qui y colle garde son axe inchangé (pas d'infini)", () => {
    // Ancre en x=1 : le côté droit est à distance nulle de l'ancre, il ne peut
    // pas commander scaleX. On garde l'échelle de départ plutôt que d'écrire ±∞.
    const out = stretchScale(droite, { x: 1, y: 0.5 }, { scaleX: 2, scaleY: 1 }, 0.2, 0);
    expect(out.scaleX).toBe(2);
    expect(Number.isFinite(out.scaleX)).toBe(true);
  });

  it("le cumul depuis l'appui ne dérive pas quand un axe a été écrêté", () => {
    // Aller à fond (écrêté à MIN), puis revenir : comme le calcul part TOUJOURS
    // de `depart` + delta total, revenir au delta 0,05 rend exactement 0,9,
    // là où un cumul incrémental serait resté collé au plancher.
    const depart = IDENTITE;
    stretchScale(droite, CENTRE, depart, -10, 0); // écrêté à MIN
    const retour = stretchScale(droite, CENTRE, depart, -0.05, 0);
    expect(retour.scaleX).toBeCloseTo(0.9, 6);
  });
});

describe("transformedFrame / handlePoint", () => {
  it("à l'identité la boîte épouse la toile", () => {
    expect(transformedFrame(CENTRE, IDENTITE)).toEqual({ left: 0, right: 1, top: 0, bottom: 1 });
  });

  it("étirée autour du centre, la boîte reste symétrique et peut déborder", () => {
    const frame = transformedFrame(CENTRE, { scaleX: 2, scaleY: 0.4 });
    expect(frame.left).toBeCloseTo(-0.5, 6);
    expect(frame.right).toBeCloseTo(1.5, 6);
    expect(frame.top).toBeCloseTo(0.3, 6);
    expect(frame.bottom).toBeCloseTo(0.7, 6);
    // Jamais retournée : right - left = scaleX > 0.
    expect(frame.right - frame.left).toBeGreaterThan(0);
  });

  it("le cadre pivote autour de l'ANCRE, pas du centre", () => {
    // Ancre à gauche (x=0) : le côté gauche ne bouge pas, seul le droit s'étend.
    const frame = transformedFrame({ x: 0, y: 0.5 }, { scaleX: 2, scaleY: 1 });
    expect(frame.left).toBeCloseTo(0, 6);
    expect(frame.right).toBeCloseTo(2, 6);
  });

  it("handlePoint place les côtés au milieu de l'arête et les coins aux angles", () => {
    const frame = transformedFrame(CENTRE, { scaleX: 2, scaleY: 0.4 });
    expect(handlePoint(droite, frame)).toEqual({ x: frame.right, y: (frame.top + frame.bottom) / 2 });
    const nw: StretchHandle = STRETCH_HANDLES[0];
    expect(handlePoint(nw, frame)).toEqual({ x: frame.left, y: frame.top });
  });
});

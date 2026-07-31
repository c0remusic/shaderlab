import { describe, expect, it } from "vitest";
import type { LayerTransform } from "../../src/layers/types";
import {
  SCALE_SNAP_TOLERANCE,
  SNAP_THRESHOLD_SCREEN_PX,
  boundingBox,
  buildSnapTargets,
  snapBox,
  snapScales,
} from "../../src/ui/snap";

const BG = { width: 1000, height: 800 };
const PHOTO = { width: 400, height: 200 };
/** Échelle d'affichage 1 : un pixel du fond vaut un pixel écran, donc le seuil
 *  en pixels du fond vaut exactement `SNAP_THRESHOLD_SCREEN_PX`. */
const SCALE_1 = 1;

/** `y: 250` et NON 400 : 400 est la médiane verticale de la toile, donc l'axe Y
 *  accrocherait dans chaque cas et masquerait ce que les témoins sur X
 *  mesurent. La fixture doit être neutre sur l'axe qu'elle n'examine pas. */
function tf(over: Partial<LayerTransform> = {}): LayerTransform {
  return { x: 500, y: 250, scaleX: 1, scaleY: 1, rotation: 0, ...over };
}

describe("boundingBox", () => {
  it("coïncide avec les coins quand la rotation est nulle", () => {
    const b = boundingBox(tf(), PHOTO);
    expect(b.minX).toBeCloseTo(300, 6);
    expect(b.maxX).toBeCloseTo(700, 6);
    expect(b.minY).toBeCloseTo(150, 6);
    expect(b.maxY).toBeCloseTo(350, 6);
  });

  it("s'élargit sous rotation — c'est bien l'ENGLOBANTE, pas la photo", () => {
    const droite = boundingBox(tf(), PHOTO);
    const tournee = boundingBox(tf({ rotation: Math.PI / 4 }), PHOTO);
    expect(tournee.maxX - tournee.minX).toBeGreaterThan(droite.maxX - droite.minX);
  });

  it("tient compte des DEUX échelles", () => {
    const b = boundingBox(tf({ scaleX: 2, scaleY: 0.5 }), PHOTO);
    expect(b.maxX - b.minX).toBeCloseTo(800, 6);
    expect(b.maxY - b.minY).toBeCloseTo(100, 6);
  });
});

describe("snapBox — accroche de position", () => {
  const targets = buildSnapTargets(BG);

  it("colle un bord au bord de la toile quand il en est proche", () => {
    // Bord gauche à 5 px du bord de toile : sous le seuil de 8.
    const result = snapBox(tf({ x: 205 }), PHOTO, targets, SCALE_1);
    expect(result.dx).toBeCloseTo(-5, 6);
    expect(result.guides).toContainEqual({ axis: "x", value: 0 });
  });

  it("n'accroche RIEN au-delà du seuil — un placement délibérément proche reste possible", () => {
    const result = snapBox(tf({ x: 215 }), PHOTO, targets, SCALE_1);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(0);
  });

  it("colle le CENTRE sur la médiane de la toile", () => {
    const result = snapBox(tf({ x: 496 }), PHOTO, targets, SCALE_1);
    expect(result.dx).toBeCloseTo(4, 6);
    expect(result.guides).toContainEqual({ axis: "x", value: BG.width / 2 });
  });

  it("les deux axes accrochent indépendamment", () => {
    const result = snapBox(tf({ x: 203, y: 103 }), PHOTO, targets, SCALE_1);
    expect(result.dx).toBeCloseTo(-3, 6);
    expect(result.dy).toBeCloseTo(-3, 6);
    expect(result.guides).toHaveLength(2);
  });

  it("le seuil est en pixels ÉCRAN : dézoomé, il couvre PLUS de pixels du fond", () => {
    // À 25 % d'affichage, 8 px écran valent 32 px du fond. Un écart de 20 px du
    // fond n'accroche pas à l'échelle 1 et accroche à 0,25 — pour une même
    // course de souris. C'est tout l'intérêt d'un seuil écran.
    const loin = tf({ x: 220 });
    expect(snapBox(loin, PHOTO, targets, 1).dx).toBe(0);
    expect(snapBox(loin, PHOTO, targets, 0.25).dx).toBeCloseTo(-20, 6);
  });

  it("une échelle d'affichage nulle ou négative n'accroche rien, plutôt qu'un seuil infini", () => {
    expect(snapBox(tf({ x: 205 }), PHOTO, targets, 0).guides).toHaveLength(0);
    expect(snapBox(tf({ x: 205 }), PHOTO, targets, -3).guides).toHaveLength(0);
  });

  it("accroche aussi sur un AUTRE calque photo", () => {
    const voisin = { transform: tf({ x: 800 }), photoSize: PHOTO };
    // Bord gauche du voisin à 600. On place le bord droit du candidat à 604.
    const avecVoisin = buildSnapTargets(BG, [voisin]);
    const result = snapBox(tf({ x: 404 }), PHOTO, avecVoisin, SCALE_1);
    expect(result.dx).toBeCloseTo(-4, 6);
    expect(result.guides).toContainEqual({ axis: "x", value: 600 });
  });

  it("à écart ÉGAL, la toile l'emporte sur un voisin", () => {
    // Voisin dont le bord gauche est à 6 px du bord droit du candidat, et bord
    // de toile à 6 px de l'autre côté : le guide rendu doit être celui de la
    // toile, posée en tête par buildSnapTargets.
    const voisin = { transform: tf({ x: 500 + 400 + 6 + 200 }), photoSize: PHOTO };
    const cible = buildSnapTargets(BG, [voisin]);
    const result = snapBox(tf({ x: 194 }), PHOTO, cible, SCALE_1);
    expect(result.guides).toContainEqual({ axis: "x", value: 0 });
  });

  it("le seuil déclaré est bien celui qui s'applique à l'échelle 1", () => {
    const juste = snapBox(tf({ x: 200 + SNAP_THRESHOLD_SCREEN_PX }), PHOTO, targets, SCALE_1);
    const trop = snapBox(tf({ x: 200 + SNAP_THRESHOLD_SCREEN_PX + 0.001 }), PHOTO, targets, SCALE_1);
    expect(juste.guides.length).toBeGreaterThan(0);
    expect(trop.guides).toHaveLength(0);
  });
});

describe("snapScales — accroche des échelles", () => {
  it("colle sur le pixel natif quand on en est proche", () => {
    expect(snapScales(1.01, 1.01)).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it("n'y touche pas au-delà de la tolérance", () => {
    const loin = 1 + SCALE_SNAP_TOLERANCE * 2;
    expect(snapScales(loin, loin).scaleX).toBe(loin);
  });

  it("colle sur le RATIO D'ORIGINE — c'est ce qui rend « pas déformée » atteignable à la souris", () => {
    const r = snapScales(2.5, 2.51);
    expect(r.scaleY).toBe(r.scaleX);
  });

  it("laisse une photo franchement étirée étirée", () => {
    expect(snapScales(2.5, 1.2)).toEqual({ scaleX: 2.5, scaleY: 1.2 });
  });

  it("les deux accroches sont INDÉPENDANTES : un axe à 100 % n'oblige pas l'autre", () => {
    const r = snapScales(1.005, 2.4);
    expect(r.scaleX).toBe(1);
    expect(r.scaleY).toBe(2.4);
  });
});

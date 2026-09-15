import { describe, expect, it } from "vitest";
import { inputDriver, INPUT_LUMA_WEIGHTS } from "../../../src/render/effects/inputMode";
import { inkIrregularite } from "../../../src/render/effects/inkTexture";

/**
 * Deux jumeaux qui n'avaient NI APPELANT NI TEST, et le test qu'ils annonçaient.
 *
 * `inputDriver` est cité en prose par TROIS modules (`aperture.ts`, `hsl.ts`,
 * `nettete.ts`) plus un commentaire de test, comme le précédent qui fait
 * autorité pour le motif du jumeau TS/WGSL. Relevé le 2026-09-15 : il n'avait
 * jamais été appelé ni exercé une seule fois. Le précédent que trois modules
 * invoquaient n'existait que sur le papier.
 *
 * `inkIrregularite` dit dans son propre JSDoc exister « pour que la propriété
 * qui compte — moyenne nulle — soit prouvée par un test plutôt qu'affirmée par
 * un commentaire ». Sa seule occurrence dans tout le dépôt était sa définition :
 * la propriété est restée affirmée par un commentaire.
 *
 * Les garder plutôt que les supprimer se défend ici parce que leurs CONSTANTES
 * sont déjà partagées avec le WGSL par interpolation (`INPUT_LUMA_WEIGHTS`,
 * `INPUT_MODE_*`, `INK_TAP_RADIUS`) : seule la structure est écrite deux fois, et
 * elle tient en six lignes de chaque côté.
 */

/** Transfert sRGB, celui que le WGSL applique par `linear_to_srgb`. */
const versSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

describe("inputDriver — le jumeau que trois modules citent en autorité", () => {
  const LUMA = 0, LUMA_INVERSE = 1, ALPHA = 2;

  it("rend l'ALPHA tel quel : une couverture n'est pas un ton, aucun transfert à défaire", () => {
    expect(inputDriver([0.2, 0.4, 0.6, 0.37], ALPHA, versSrgb)).toBe(0.37);
  });

  it("rend la luminance BT.709 ENCODÉE, pas la linéaire", () => {
    const lin = INPUT_LUMA_WEIGHTS[0] * 0.2 + INPUT_LUMA_WEIGHTS[1] * 0.4 + INPUT_LUMA_WEIGHTS[2] * 0.6;
    expect(inputDriver([0.2, 0.4, 0.6, 1], LUMA, versSrgb)).toBeCloseTo(versSrgb(lin), 12);
    // Et la distinction n'est pas cosmétique : les deux diffèrent nettement.
    expect(Math.abs(inputDriver([0.2, 0.4, 0.6, 1], LUMA, versSrgb) - lin)).toBeGreaterThan(0.1);
  });

  it("INVERSE dans l'espace encodé, pas dans le linéaire", () => {
    const droit = inputDriver([0.2, 0.4, 0.6, 1], LUMA, versSrgb);
    expect(inputDriver([0.2, 0.4, 0.6, 1], LUMA_INVERSE, versSrgb)).toBeCloseTo(1 - droit, 12);
  });

  it("arrondit le mode : il arrive d'un uniforme f32, jamais d'un entier", () => {
    // `i32(mode + 0.5)` côté WGSL, `Math.round` ici — deux écritures d'une même
    // règle, et c'est la seule chose que ces six lignes ont à tenir d'accord.
    expect(inputDriver([0, 0, 0, 0.5], 1.999, versSrgb)).toBe(0.5);
    expect(inputDriver([0, 0, 0, 0.5], 2.001, versSrgb)).toBe(0.5);
  });

  it("garde le noir à 0 et le blanc à 1", () => {
    expect(inputDriver([0, 0, 0, 1], LUMA, versSrgb)).toBeCloseTo(0, 12);
    expect(inputDriver([1, 1, 1, 1], LUMA, versSrgb)).toBeCloseTo(1, 12);
  });
});

describe("inkIrregularite — la propriété que son JSDoc annonçait sans la prouver", () => {
  it("rend ZÉRO sur un aplat : une encre ne froisse pas ce qui est uniforme", () => {
    expect(inkIrregularite(() => 0.42, 0.5, 0.5, 0.01, 0.01)).toBeCloseTo(0, 12);
  });

  it("rend zéro sur un DÉGRADÉ linéaire — la propriété de moyenne nulle", () => {
    // C'est le cœur de l'affaire : la marque ne doit pas dériver là où le scan
    // varie régulièrement, seulement là où il a du GRAIN. Les quatre voisins
    // d'un plan encadrent exactement le centre, donc leur moyenne l'égale.
    const plan = (u: number, v: number) => 0.1 + 0.7 * u - 0.3 * v;
    for (const [u, v] of [[0.25, 0.25], [0.5, 0.8], [0.9, 0.1]]) {
      expect(inkIrregularite(plan, u, v, 0.01, 0.02)).toBeCloseTo(0, 12);
    }
  });

  it("rend un écart SIGNÉ sur un pic isolé, et son opposé sur un creux", () => {
    const pic = (u: number, v: number) => (Math.abs(u - 0.5) < 1e-9 && Math.abs(v - 0.5) < 1e-9 ? 1 : 0);
    expect(inkIrregularite(pic, 0.5, 0.5, 0.01, 0.01)).toBeCloseTo(1, 12);
    const creux = (u: number, v: number) => 1 - pic(u, v);
    expect(inkIrregularite(creux, 0.5, 0.5, 0.01, 0.01)).toBeCloseTo(-1, 12);
  });

  it("le RAYON change la portée du prélèvement, donc ce qui compte comme grain", () => {
    // Une bosse à un texel disparaît d'un prélèvement à deux texels.
    const bosse = (u: number) => (Math.abs(u - 0.51) < 1e-9 ? 1 : 0);
    const f = (u: number) => bosse(u);
    expect(inkIrregularite((u) => f(u), 0.5, 0.5, 0.01, 0.01, 1)).toBeCloseTo(-0.25, 12);
    expect(inkIrregularite((u) => f(u), 0.5, 0.5, 0.01, 0.01, 2)).toBeCloseTo(0, 12);
  });
});

import { describe, it, expect } from "vitest";
import { colorGrading, colorGradingSpec } from "../../../src/render/effects/colorGrading";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab";

/**
 * `colorGradingSpec` est le jumeau TS du shader du module `colorGrading` de l'étage
 * (même patron qu'`etalonnageSpec` / `hslSpec`). Ces tests portent sur le MÉCANISME
 * — l'identité sans saturation ni luminance, les poids de plage sur la luminance
 * (ombres ≠ tons moyens ≠ hautes lumières), Balance qui bascule, Fusion qui tranche,
 * la roue globale qui teinte toute luminance. Les nombres exacts (rendu GPU) sont
 * verrouillés par les références `developpement-grading-*`.
 *
 * ⚠️ La table (`colorGradingTable.ts`) est PARTIELLEMENT provisoire : les profils
 * Ombres / Hautes lumières, Fusion et Balance sont MODÉLISÉS (non mesurables dans
 * les exports Lightroom — voir l'en-tête de la table). Ces tests éprouvent donc la
 * FORME du modèle, pas une amplitude calée sur Lightroom pour ces plages.
 */

type Vec3 = [number, number, number];

const defauts = (): number[] => colorGrading.params.map((p) => p.default);
const idx = (nom: string): number => {
  const i = colorGrading.params.findIndex((p) => p.name === nom);
  if (i < 0) throw new Error(`paramètre "${nom}" absent de colorGrading`);
  return i;
};
const avec = (modifs: Record<string, number>): number[] => {
  const p = defauts();
  for (const [nom, v] of Object.entries(modifs)) p[idx(nom)] = v;
  return p;
};
const chromaDe = (c: Vec3): number => {
  const lab = linearSrgbToOklab(c);
  return Math.hypot(lab[1], lab[2]);
};
const lDe = (c: Vec3): number => linearSrgbToOklab(c)[0];
const gris = (srgb: number): Vec3 => {
  const l = srgbToLinear(srgb);
  return [l, l, l];
};

describe("colorGrading — jumeau du module de virage tonal", () => {
  it("saturations ET luminances à 0 : identité au bit près (toute teinte/fusion/balance)", () => {
    for (const c of [[0.2, 0.5, 0.8], [0, 0, 0], [1, 1, 1], [0.37, 0.02, 0.91]] as Vec3[]) {
      // Teintes réglées, fusion et balance quelconques : sans saturation ni
      // luminance, rien ne bouge.
      expect(colorGradingSpec(c, avec({ shadowHue: 220, highlightHue: 40, blending: 20, balance: 60 }))).toEqual(c);
    }
  });

  it("virage des ombres : un gris SOMBRE se teinte, un gris MOYEN ne bouge pas", () => {
    const modif = { shadowHue: 220, shadowSat: 60 };
    const sombre = colorGradingSpec(gris(0.12), avec(modif));
    const moyen = colorGradingSpec(gris(0.5), avec(modif));
    expect(chromaDe(sombre)).toBeGreaterThan(0.03);
    expect(chromaDe(moyen)).toBeLessThan(0.01);
  });

  it("virage des hautes lumières : un gris CLAIR se teinte, un gris MOYEN ne bouge pas", () => {
    const modif = { highlightHue: 40, highlightSat: 60 };
    const clair = colorGradingSpec(gris(0.85), avec(modif));
    const moyen = colorGradingSpec(gris(0.5), avec(modif));
    expect(chromaDe(clair)).toBeGreaterThan(0.03);
    expect(chromaDe(moyen)).toBeLessThan(0.01);
  });

  it("virage des tons moyens : un gris MOYEN se teinte, les extrêmes beaucoup moins", () => {
    const modif = { midtoneHue: 120, midtoneSat: 60 };
    const moyen = colorGradingSpec(gris(0.5), avec(modif));
    const sombre = colorGradingSpec(gris(0.06), avec(modif));
    const clair = colorGradingSpec(gris(0.97), avec(modif));
    expect(chromaDe(moyen)).toBeGreaterThan(0.05);
    expect(chromaDe(sombre)).toBeLessThan(chromaDe(moyen) * 0.5);
    expect(chromaDe(clair)).toBeLessThan(chromaDe(moyen) * 0.5);
  });

  it("Balance bascule le point de partage ombres ↔ hautes lumières", () => {
    const modif = { shadowHue: 220, shadowSat: 60 };
    // −100 : « tout est ombre » -> un gris MOYEN prend le virage des ombres.
    const moyenBasOmbre = colorGradingSpec(gris(0.5), avec({ ...modif, balance: -100 }));
    // +100 : « tout est haute lumière » -> le même gris moyen ne le prend plus.
    const moyenHautLum = colorGradingSpec(gris(0.5), avec({ ...modif, balance: 100 }));
    expect(chromaDe(moyenBasOmbre)).toBeGreaterThan(0.02);
    expect(chromaDe(moyenHautLum)).toBeLessThan(0.005);
    expect(chromaDe(moyenBasOmbre)).toBeGreaterThan(chromaDe(moyenHautLum));
  });

  it("Fusion 0 tranche : un ton en marge des ombres reçoit le virage à 100, presque rien à 0", () => {
    const modif = { shadowHue: 220, shadowSat: 60 };
    const marge = gris(0.35); // en marge haute de la plage des ombres
    const fondu = colorGradingSpec(marge, avec({ ...modif, blending: 100 }));
    const tranche = colorGradingSpec(marge, avec({ ...modif, blending: 0 }));
    expect(chromaDe(fondu)).toBeGreaterThan(chromaDe(tranche));
    expect(chromaDe(tranche)).toBeLessThan(0.005);
    expect(chromaDe(fondu)).toBeGreaterThan(0.008);
  });

  it("la roue globale teinte un gris de TOUTE luminance", () => {
    const modif = { globalHue: 200, globalSat: 60 };
    for (const g of [0.15, 0.5, 0.85]) {
      expect(chromaDe(colorGradingSpec(gris(g), avec(modif)))).toBeGreaterThan(0.02);
    }
  });

  it("la luminance d'une roue éclaircit / assombrit sa plage", () => {
    // Luminance des tons moyens +100 éclaircit un gris moyen ; −100 l'assombrit.
    const l0 = lDe(gris(0.5));
    const plus = lDe(colorGradingSpec(gris(0.5), avec({ midtoneLum: 100 })));
    const moins = lDe(colorGradingSpec(gris(0.5), avec({ midtoneLum: -100 })));
    expect(plus).toBeGreaterThan(l0);
    expect(moins).toBeLessThan(l0);
  });

  it("le module déclare 14 paramètres (4 roues × 3 + fusion + balance)", () => {
    expect(colorGrading.params.length).toBe(14);
    expect(colorGrading.params.map((p) => p.name)).toEqual([
      "shadowHue", "shadowSat", "shadowLum",
      "midtoneHue", "midtoneSat", "midtoneLum",
      "highlightHue", "highlightSat", "highlightLum",
      "globalHue", "globalSat", "globalLum",
      "blending", "balance",
    ]);
    expect(colorGrading.params[idx("blending")].default).toBe(50);
  });
});

import { describe, it, expect } from "vitest";
import { hsl, hslSpec } from "../../../src/render/effects/hslDevelop";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab";
import { HSL_BANDES } from "../../../src/render/effects/hslBandes";

const bande = (id: string) => {
  const b = HSL_BANDES.find((x) => x.id === id);
  if (!b) throw new Error(`bande "${id}" absente`);
  return b;
};

/**
 * `hslSpec` est le jumeau TS du shader du module `hsl` de l'étage (même patron
 * qu'`etalonnageSpec` / `reglagesDeBaseSpec`). Ces tests portent sur l'ALGÈBRE
 * par pixel — le poids de bande sans `atan2`, la rotation de teinte, le dosage de
 * chroma/luminance, le passage en Noir et blanc. Les nombres exacts (rendu GPU)
 * sont verrouillés par les références `developpement-hsl-*`.
 *
 * ⚠️ La table de bandes (`hslBandes.ts`) est PROVISOIRE (mesures Lightroom
 * absentes) : ces tests éprouvent le MÉCANISME (un rouge tourne, un bleu se
 * désature, un gris ne bouge pas), pas une amplitude calée sur Lightroom.
 */

type Vec3 = [number, number, number];

const defauts = (): number[] => hsl.params.map((p) => p.default);
const idx = (nom: string): number => {
  const i = hsl.params.findIndex((p) => p.name === nom);
  if (i < 0) throw new Error(`paramètre "${nom}" absent de hsl`);
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
const teinteDeg = (c: Vec3): number => {
  const lab = linearSrgbToOklab(c);
  return (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
};
const lDe = (c: Vec3): number => linearSrgbToOklab(c)[0];

const sl = (r: number, g: number, b: number): Vec3 => [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
const ROUGE: Vec3 = sl(255, 0, 0);
const BLEU: Vec3 = sl(0, 0, 255);
// Couleurs à MARGE DE GAMUT : une primaire pure est un coin du gamut, la tourner
// ou l'éclaircir la pousse dehors et le clamp final masque l'amplitude réelle de
// l'opérateur (un rouge pur ne tourne « que » de 7° parce qu'il ne PEUT pas aller
// plus loin). Ces mires-là gardent la tête hors du gamut et montrent le mécanisme.
const ROUGE_MI: Vec3 = sl(210, 110, 110);
const VERT_MI: Vec3 = sl(90, 180, 90);

describe("hsl — jumeau du module de bande", () => {
  it("mode Couleur, tout à 0 : identité au bit près", () => {
    for (const c of [[0.2, 0.5, 0.8], [0, 0, 0], [1, 1, 1], [0.37, 0.02, 0.91]] as Vec3[]) {
      expect(hslSpec(c, defauts())).toEqual(c);
    }
  });

  it("un gris ne bouge à aucun réglage (porte de chroma)", () => {
    for (const g of [0.1, 0.4, 0.75]) {
      const gris: Vec3 = [g, g, g];
      for (const modif of [{ redHue: 100 }, { blueSat: -100 }, { greenLum: 80 }, { redHue: 100, blueSat: 100, greenLum: -100 }]) {
        const out = hslSpec(gris, avec(modif));
        for (let k = 0; k < 3; k++) expect(Math.abs(out[k] - g)).toBeLessThan(2e-3);
      }
    }
  });

  it("Teinte rouge +100 tourne un rouge pur, sans toucher un bleu pur (< 1 %)", () => {
    const h0 = teinteDeg(ROUGE_MI);
    const rougeTourne = hslSpec(ROUGE_MI, avec({ redHue: 100 }));
    let dh = teinteDeg(rougeTourne) - h0;
    dh = ((dh + 180) % 360) - 180;
    // Propriété calibrée : à +100 sur un rouge quasi pur (poids ≈ 1), la rotation
    // OKLab vaut ≈ `amplitudeDeg` de la bande rouge (lu dans la table, pas un
    // littéral). Sens POSITIF (rouge → orange), amplitude bornée par le poids ≤ 1.
    const redAmp = bande("red").amplitudeDeg;
    expect(dh).toBeGreaterThan(0);
    expect(dh).toBeGreaterThan(redAmp * 0.85);
    expect(dh).toBeLessThan(redAmp * 1.05);

    // Le bleu ne porte aucun curseur de teinte réglé : il ne bouge pas.
    const bleu2 = hslSpec(BLEU, avec({ redHue: 100 }));
    for (let k = 0; k < 3; k++) expect(Math.abs(bleu2[k] - BLEU[k])).toBeLessThan(0.01);
  });

  it("Saturation bleu −100 désature un bleu, laisse un rouge presque intact", () => {
    const c0 = chromaDe(BLEU);
    const bleuDesat = hslSpec(BLEU, avec({ blueSat: -100 }));
    // Propriété calibrée : à −100 la chroma est multipliée par ≈ (1 − satK) de la
    // bande bleue (poids ≈ 1 sur un bleu pur), satK lu dans la table. Lightroom
    // ne désature pas le bleu totalement (satK < 1), la chroma résiduelle le prouve.
    const blueSatK = bande("blue").satK;
    expect(chromaDe(bleuDesat)).toBeLessThan((1 - blueSatK + 0.1) * c0);
    expect(chromaDe(bleuDesat)).toBeGreaterThan((1 - blueSatK - 0.1) * c0);

    const rouge2 = hslSpec(ROUGE, avec({ blueSat: -100 }));
    expect(Math.abs(chromaDe(rouge2) - chromaDe(ROUGE))).toBeLessThan(0.02);
  });

  it("Luminance verte : +100 éclaircit, −100 assombrit, à peu près symétrique", () => {
    const l0 = lDe(VERT_MI);
    const plus = lDe(hslSpec(VERT_MI, avec({ greenLum: 60 })));
    const moins = lDe(hslSpec(VERT_MI, avec({ greenLum: -60 })));
    expect(plus).toBeGreaterThan(l0);
    expect(moins).toBeLessThan(l0);
    // Symétrie approximative des écarts (± même dose).
    expect(Math.abs((plus - l0) - (l0 - moins))).toBeLessThan(0.15 * (plus - moins));
  });

  it("Noir et blanc : chroma nulle, et le mélange change la luminance par teinte", () => {
    const nb = hslSpec(ROUGE, avec({ mode: 1 }));
    // Gris neutre : les trois canaux linéaires égaux.
    expect(Math.abs(nb[0] - nb[1])).toBeLessThan(1e-3);
    expect(Math.abs(nb[1] - nb[2])).toBeLessThan(1e-3);
    expect(chromaDe(nb)).toBeLessThan(1e-3);

    // « Niveau de gris rouge » +100 éclaircit le gris issu du rouge ; −100 l'assombrit.
    const nbClair = hslSpec(ROUGE, avec({ mode: 1, redGray: 100 }));
    const nbSombre = hslSpec(ROUGE, avec({ mode: 1, redGray: -100 }));
    expect(nbClair[0]).toBeGreaterThan(nb[0]);
    expect(nbSombre[0]).toBeLessThan(nb[0]);
    // Un bleu ne réagit pas au « Niveau de gris rouge ».
    const bleuNb = hslSpec(BLEU, avec({ mode: 1 }));
    const bleuNbRedGray = hslSpec(BLEU, avec({ mode: 1, redGray: 100 }));
    expect(Math.abs(bleuNbRedGray[0] - bleuNb[0])).toBeLessThan(2e-3);
  });

  it("les 24 curseurs de couleur sont inertes en Noir et blanc", () => {
    // Le mode N&B ne lit aucun curseur de couleur : changer une teinte/sat/lum ne
    // bouge rien (c'est ce que `--applicabilite` éprouve aussi côté GPU).
    const base = hslSpec(ROUGE, avec({ mode: 1 }));
    for (const modif of [{ mode: 1, redHue: 100 }, { mode: 1, blueSat: -100 }, { mode: 1, greenLum: 100 }]) {
      const out = hslSpec(ROUGE, avec(modif));
      for (let k = 0; k < 3; k++) expect(Math.abs(out[k] - base[k])).toBeLessThan(1e-6);
    }
  });

  it("les 8 curseurs de mélange sont inertes en Couleur", () => {
    // Réciproque : en mode Couleur, un « Niveau de gris » ne fait rien.
    const base = hslSpec(ROUGE, avec({ redSat: 50 }));
    const out = hslSpec(ROUGE, avec({ redSat: 50, redGray: 100 }));
    for (let k = 0; k < 3; k++) expect(Math.abs(out[k] - base[k])).toBeLessThan(1e-6);
  });

  it("le module déclare 33 paramètres, mode + 8×(teinte/sat/lum/gris)", () => {
    expect(hsl.params.length).toBe(33);
    expect(hsl.params[0].name).toBe("mode");
    expect(hsl.params[0].choices).toEqual(["Couleur", "Noir et blanc"]);
  });
});

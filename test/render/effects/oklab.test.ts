import { describe, it, expect } from "vitest";
import {
  OKLAB_WGSL,
  linearSrgbToOklab,
  oklabToLinearSrgb,
  oklabToOklch,
  oklchToOklab,
} from "../../../src/render/effects/oklab";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";

/** Couleur de picker (perceptuelle) -> linéaire, comme le font les effets. */
const fromSrgb = (r: number, g: number, b: number): [number, number, number] => [
  srgbToLinear(r),
  srgbToLinear(g),
  srgbToLinear(b),
];

describe("OKLab — valeurs de référence d'Ottosson", () => {
  // Les trois primaires et le blanc, calculés par la référence. Ces nombres
  // sont la SEULE façon d'attraper une matrice recopiée de travers : à l'œil,
  // une constante fausse ne fait que décaler légèrement une teinte.
  it("place le blanc à L=1, chroma nul", () => {
    const [L, a, b] = linearSrgbToOklab([1, 1, 1]);
    expect(L).toBeCloseTo(1, 5);
    expect(a).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(0, 5);
  });

  it("place le noir à l'origine", () => {
    expect(linearSrgbToOklab([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("rend les coordonnées publiées pour le rouge, le vert et le bleu", () => {
    const rouge = linearSrgbToOklab([1, 0, 0]);
    expect(rouge[0]).toBeCloseTo(0.6279, 3);
    expect(rouge[1]).toBeCloseTo(0.2249, 3);
    expect(rouge[2]).toBeCloseTo(0.1258, 3);

    const vert = linearSrgbToOklab([0, 1, 0]);
    expect(vert[0]).toBeCloseTo(0.8664, 3);
    expect(vert[1]).toBeCloseTo(-0.2338, 3);
    expect(vert[2]).toBeCloseTo(0.1795, 3);

    const bleu = linearSrgbToOklab([0, 0, 1]);
    expect(bleu[0]).toBeCloseTo(0.4520, 3);
    expect(bleu[1]).toBeCloseTo(-0.0324, 3);
    expect(bleu[2]).toBeCloseTo(-0.3115, 3);
  });

  it("garde un gris achromatique (a = b = 0 sur toute l'échelle)", () => {
    for (const v of [0.05, 0.2, 0.5, 0.8, 1]) {
      const [, a, b] = linearSrgbToOklab([v, v, v]);
      expect(a).toBeCloseTo(0, 5);
      expect(b).toBeCloseTo(0, 5);
    }
  });
});

describe("OKLab — réversibilité", () => {
  const couleurs: Array<[number, number, number]> = [
    fromSrgb(0.1, 0.2, 0.8),
    fromSrgb(0.95, 0.55, 0.1),
    fromSrgb(0, 0, 0),
    fromSrgb(1, 1, 1),
    fromSrgb(0.5, 0.5, 0.5),
    fromSrgb(0.03, 0.9, 0.42),
  ];

  it("aller-retour linéaire -> OKLab -> linéaire", () => {
    for (const c of couleurs) {
      const retour = oklabToLinearSrgb(linearSrgbToOklab(c));
      expect(retour[0]).toBeCloseTo(c[0], 6);
      expect(retour[1]).toBeCloseTo(c[1], 6);
      expect(retour[2]).toBeCloseTo(c[2], 6);
    }
  });

  it("aller-retour OKLab -> OKLCH -> OKLab", () => {
    for (const c of couleurs) {
      const lab = linearSrgbToOklab(c);
      const retour = oklchToOklab(oklabToOklch(lab));
      expect(retour[0]).toBeCloseTo(lab[0], 6);
      expect(retour[1]).toBeCloseTo(lab[1], 6);
      expect(retour[2]).toBeCloseTo(lab[2], 6);
    }
  });

  it("reste réversible sur une couleur HORS GAMUT (composante négative)", () => {
    // channelMixer autorise des coefficients négatifs et ne pose qu'un plancher
    // à 0 EN SORTIE : une valeur négative peut traverser une conversion en
    // cours de chaîne. Sans racine cubique signée, elle produirait un NaN qui
    // contaminerait tout le reste de la fusion.
    const horsGamut: [number, number, number] = [-0.15, 0.8, 1.4];
    const lab = linearSrgbToOklab(horsGamut);
    expect(lab.every(Number.isFinite)).toBe(true);
    const retour = oklabToLinearSrgb(lab);
    expect(retour[0]).toBeCloseTo(horsGamut[0], 5);
    expect(retour[1]).toBeCloseTo(horsGamut[1], 5);
    expect(retour[2]).toBeCloseTo(horsGamut[2], 5);
  });
});

describe("OKLab — le jumeau WGSL porte les mêmes constantes", () => {
  // Le shader ne peut pas être exécuté ici (pas de GPU en projet `unit`) : ce
  // qui est vérifiable, c'est que les deux transcriptions portent les MÊMES
  // nombres. Une divergence de matrice entre TS et WGSL rendrait les tests
  // ci-dessus verts pour un shader faux.
  const constantes = [
    "0.4122214708", "0.5363325363", "0.0514459929",
    "0.2119034982", "0.6806995451", "0.1073969566",
    "0.0883024619", "0.2817188376", "0.6299787005",
    "0.2104542553", "0.7936177850", "0.0040720468",
    "1.9779984951", "2.4285922050", "0.4505937099",
    "0.0259040371", "0.7827717662", "0.8086757660",
    "0.3963377774", "0.2158037573",
    "0.1055613458", "0.0638541728",
    "0.0894841775", "1.2914855480",
    "4.0767416621", "3.3077115913", "0.2309699292",
    "1.2684380046", "2.6097574011", "0.3413193965",
    "0.0041960863", "0.7034186147", "1.7076147010",
  ];

  it.each(constantes)("contient %s", (constante) => {
    expect(OKLAB_WGSL).toContain(constante);
  });

  it("utilise une racine cubique SIGNÉE, jamais un pow nu", () => {
    expect(OKLAB_WGSL).toContain("return sign(x) * pow(abs(x), 1.0 / 3.0);");
    // Un `pow(l, 1.0/3.0)` direct sur une composante LMS rendrait NaN sous zéro.
    expect(OKLAB_WGSL).not.toMatch(/pow\(\s*[lms]_?,\s*1\.0\s*\/\s*3\.0\s*\)/);
  });

  it("exprime la teinte en TOURS des deux côtés", () => {
    // 2*PI en dur dans le shader, division par 2*PI côté TS : la même
    // convention, donc `floor(d + 0.5)` suffit à replier le plus court chemin
    // sans constante d'angle à ressaisir (voir blendSpace).
    expect(OKLAB_WGSL).toContain("6.283185307179586");
    const [, , teinte] = oklabToOklch(linearSrgbToOklab([1, 0, 0]));
    expect(teinte).toBeGreaterThanOrEqual(0);
    expect(teinte).toBeLessThan(1);
  });
});

import { describe, it, expect } from "vitest";
import {
  BLEND_SPACE_CHOICES,
  BLEND_SPACE_LINEAR,
  BLEND_SPACE_OKLAB,
  BLEND_SPACE_OKLCH,
  BLEND_SPACE_SRGB,
  MIX_IN_SPACE_WGSL,
  blendSpaceParam,
  mixInSpace,
  mixSrgbInSpace,
} from "../../../src/render/effects/blendSpace";
import { linearSrgbToOklab, oklabToOklch } from "../../../src/render/effects/oklab";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";
import { validateEffect } from "../../../src/render/effects/validate";

const fromSrgb = (r: number, g: number, b: number): [number, number, number] => [
  srgbToLinear(r),
  srgbToLinear(g),
  srgbToLinear(b),
];

const BLEU_PROFOND = fromSrgb(0.1, 0.15, 0.7);
const ORANGE_VIF = fromSrgb(0.95, 0.5, 0.05);
const ROUGE = fromSrgb(0.9, 0.1, 0.1);
const BLANC = fromSrgb(1, 1, 1);

const TOUS = [BLEND_SPACE_LINEAR, BLEND_SPACE_SRGB, BLEND_SPACE_OKLAB, BLEND_SPACE_OKLCH];

const chromaDe = (c: readonly [number, number, number]) => oklabToOklch(linearSrgbToOklab(c))[1];
const teinteDe = (c: readonly [number, number, number]) => oklabToOklch(linearSrgbToOklab(c))[2];

describe("blendSpace — les bouts sont les bouts, dans tous les espaces", () => {
  // Propriété non négociable : quel que soit le chemin, un mélange doit rendre
  // EXACTEMENT ses extrémités en t=0 et t=1. Sans elle, changer d'espace
  // décalerait les couleurs choisies au picker.
  it.each(TOUS)("espace %i : t=0 rend a, t=1 rend b", (space) => {
    const a = mixInSpace(BLEU_PROFOND, ORANGE_VIF, 0, space);
    const b = mixInSpace(BLEU_PROFOND, ORANGE_VIF, 1, space);
    for (let i = 0; i < 3; i++) {
      expect(a[i]).toBeCloseTo(BLEU_PROFOND[i], 5);
      expect(b[i]).toBeCloseTo(ORANGE_VIF[i], 5);
    }
  });
});

describe("blendSpace — l'espace linéaire est le mix nu", () => {
  // Cette égalité est la GARANTIE DE NON-RÉGRESSION du chantier : tout effet
  // qui adopte le paramètre garde son rendu au bit près tant que le contrôle
  // reste sur son défaut (index 0).
  it("rend le même résultat que mix(a, b, t)", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const attendu = BLEU_PROFOND.map((v, i) => v + (ORANGE_VIF[i] - v) * t);
      expect(mixInSpace(BLEU_PROFOND, ORANGE_VIF, t, BLEND_SPACE_LINEAR)).toEqual(attendu);
    }
  });

  it("est le DÉFAUT du paramètre", () => {
    expect(blendSpaceParam().default).toBe(BLEND_SPACE_LINEAR);
    expect(BLEND_SPACE_CHOICES[BLEND_SPACE_LINEAR]).toBe("Linéaire");
  });
});

describe("blendSpace — le creux du milieu, mesuré", () => {
  // Ces tests SONT le tableau de l'en-tête. Ils existent parce que la première
  // rédaction de ce module affirmait qu'OKLab répare le creux de saturation :
  // faux, et mesurable en une ligne.
  const MAGENTA = fromSrgb(0.85, 0.1, 0.75);
  const VERT = fromSrgb(0.1, 0.7, 0.2);

  const chromaMilieu = (a: [number, number, number], b: [number, number, number], space: number) =>
    chromaDe(mixInSpace(a, b, 0.5, space));

  it("OKLCH est le SEUL espace qui tienne le chroma au milieu", () => {
    for (const [a, b] of [
      [BLEU_PROFOND, ORANGE_VIF],
      [MAGENTA, VERT],
      [BLEU_PROFOND, fromSrgb(0.1, 0.75, 0.8)],
    ] as Array<[[number, number, number], [number, number, number]]>) {
      const oklch = chromaMilieu(a, b, BLEND_SPACE_OKLCH);
      expect(oklch).toBeGreaterThan(chromaMilieu(a, b, BLEND_SPACE_LINEAR));
      expect(oklch).toBeGreaterThan(chromaMilieu(a, b, BLEND_SPACE_SRGB));
      expect(oklch).toBeGreaterThan(chromaMilieu(a, b, BLEND_SPACE_OKLAB));
    }
  });

  it("sur des COMPLÉMENTAIRES, OKLCH multiplie le chroma du milieu par plus de 5", () => {
    // magenta -> vert : 0.035 en OKLab, 0.233 en OKLCH. C'est le geste entier
    // du module, et le seul écart qui se voie à l'œil sans mesurer.
    expect(chromaMilieu(MAGENTA, VERT, BLEND_SPACE_OKLCH)).toBeGreaterThan(
      5 * chromaMilieu(MAGENTA, VERT, BLEND_SPACE_OKLAB)
    );
  });

  it("OKLab ne répare PAS le creux des complémentaires — et c'est correct", () => {
    // Une DROITE dans le plan a/b passe près de l'origine quand les deux bouts
    // sont diamétralement opposés. Ce test verrouille un comportement JUSTE
    // contre une « correction » future : quiconque trouve OKLab trop terne sur
    // ces paires cherche OKLCH, pas un rustine dans OKLab.
    expect(chromaMilieu(BLEU_PROFOND, ORANGE_VIF, BLEND_SPACE_OKLAB)).toBeLessThan(
      chromaMilieu(BLEU_PROFOND, ORANGE_VIF, BLEND_SPACE_LINEAR)
    );
  });

  it("OKLab pose la clarté du milieu à la moyenne PERCEPTUELLE des bouts", () => {
    // C'est ça, l'apport d'OKLab — pas le chroma. Le linéaire surélève le
    // milieu (dominé par le bout le plus lumineux), le sRGB l'enfonce.
    const clarte = (c: readonly [number, number, number]) => linearSrgbToOklab(c)[0];
    const attendu = (clarte(BLEU_PROFOND) + clarte(ORANGE_VIF)) / 2;
    const milieu = (space: number) => clarte(mixInSpace(BLEU_PROFOND, ORANGE_VIF, 0.5, space));
    expect(milieu(BLEND_SPACE_OKLAB)).toBeCloseTo(attendu, 6);
    expect(milieu(BLEND_SPACE_LINEAR)).toBeGreaterThan(attendu + 0.03);
    expect(milieu(BLEND_SPACE_SRGB)).toBeLessThan(attendu - 0.03);
  });
});

describe("blendSpace — OKLCH fait TOURNER la teinte", () => {
  it("ne passe pas par l'axe achromatique entre bleu et orange", () => {
    // En OKLab la trajectoire est une droite qui frôle l'origine du plan a/b ;
    // en OKLCH c'est un arc à chroma soutenu. La différence se lit sur le
    // chroma du milieu, seul écart observable entre les deux.
    const arc = chromaDe(mixInSpace(BLEU_PROFOND, ORANGE_VIF, 0.5, BLEND_SPACE_OKLCH));
    expect(arc).toBeGreaterThan(0.02);
  });

  it("un bout ACHROMATIQUE adopte la teinte de l'autre", () => {
    // Sans cette règle, `atan2(0, 0) = 0` donnerait au blanc une teinte
    // arbitraire, et un dégradé rouge -> blanc virerait au jaune puis au vert
    // en chemin. Le milieu doit rester sur la teinte du rouge.
    const milieu = mixInSpace(ROUGE, BLANC, 0.5, BLEND_SPACE_OKLCH);
    expect(teinteDe(milieu)).toBeCloseTo(teinteDe(ROUGE), 3);
  });

  it("prend le PLUS COURT arc, pas le plus long", () => {
    // Deux teintes séparées de plus d'un demi-tour dans le sens croissant : le
    // repli doit faire passer le mélange par l'arc court (en décroissant),
    // jamais par le tour complet.
    const magenta = fromSrgb(0.85, 0.1, 0.75);
    const jaune = fromSrgb(0.95, 0.85, 0.1);
    const hM = teinteDe(magenta);
    const hJ = teinteDe(jaune);
    const milieu = teinteDe(mixInSpace(magenta, jaune, 0.5, BLEND_SPACE_OKLCH));
    // Distance circulaire du milieu à chaque bout : sur l'arc court elles sont
    // égales et valent la moitié de l'écart circulaire des bouts.
    const circulaire = (x: number, y: number) => {
      const d = Math.abs(x - y) % 1;
      return Math.min(d, 1 - d);
    };
    const ecart = circulaire(hM, hJ);
    expect(circulaire(milieu, hM)).toBeCloseTo(ecart / 2, 3);
    expect(circulaire(milieu, hJ)).toBeCloseTo(ecart / 2, 3);
  });
});

describe("blendSpace — le paramètre est chargeable par le registre", () => {
  it("passe validateEffect (bornes accordées à ses choix)", () => {
    expect(() =>
      validateEffect({ id: "test", name: "Test", params: [blendSpaceParam()], wgsl: "" })
    ).not.toThrow();
  });

  it("refuse un défaut hors des choix (garde-fou de la fabrique)", () => {
    expect(() =>
      validateEffect({
        id: "test",
        name: "Test",
        params: [blendSpaceParam({ default: 9 })],
        wgsl: "",
      })
    ).toThrow(/hors de l'intervalle des choix/);
  });
});

describe("blendSpace — le jumeau WGSL suit la même écriture", () => {
  it("branche sur les mêmes index que les constantes TS", () => {
    expect(MIX_IN_SPACE_WGSL).toContain(`if (s == ${BLEND_SPACE_SRGB}) {`);
    expect(MIX_IN_SPACE_WGSL).toContain(`if (s == ${BLEND_SPACE_OKLAB}) {`);
    expect(MIX_IN_SPACE_WGSL).toContain(`if (s == ${BLEND_SPACE_OKLCH}) {`);
  });

  it("replie la teinte avec floor(d + 0.5), pas round(d)", () => {
    // `round` de WGSL arrondit au pair, `Math.round` de JS vers +inf : les deux
    // divergent en d = ±0.5 exactement. Un jumeau qui diverge quelque part
    // n'est plus un jumeau.
    expect(MIX_IN_SPACE_WGSL).toContain("let hue = ha + (d - floor(d + 0.5)) * t;");
    // Assertion portée sur l'EXPRESSION et non sur l'absence du mot « round » :
    // le commentaire du shader nomme lui-même la fonction écartée, et une
    // recherche naïve se serait déclenchée dessus.
    const code = MIX_IN_SPACE_WGSL.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/\bround\(/);
  });

  it("branche en `if` (uniforme) et non en `select` (les 4 chemins)", () => {
    // `select` évaluerait les quatre branches à chaque pixel, dont deux racines
    // cubiques par bout, pour en jeter trois. La condition vient d'un uniforme :
    // le branchement est uniforme sur toute la passe.
    expect(MIX_IN_SPACE_WGSL).not.toMatch(/select\([^)]*mix_in_space/);
    expect(MIX_IN_SPACE_WGSL).toContain("let s = i32(space + 0.5);");
  });

  it("rend le mix nu en dernier recours (index inconnu = linéaire)", () => {
    // Le repli est la DERNIÈRE instruction de `mix_in_space` : la fermeture du
    // dernier `if` suivie du `return`, sans branche intercalée.
    expect(MIX_IN_SPACE_WGSL).toContain("  }\n  return mix(a, b, t);\n}");
    expect(mixInSpace(BLEU_PROFOND, ORANGE_VIF, 0.5, 99)).toEqual(
      mixInSpace(BLEU_PROFOND, ORANGE_VIF, 0.5, BLEND_SPACE_LINEAR)
    );
  });
});

describe("blendSpace — la variante à bouts sRGB est EXACTE sur son propre espace", () => {
  // C'est la garantie de non-régression de `gradientMap` : ses trois arrêts
  // sortent d'un sélecteur, donc en sRGB, et son espace par défaut EST sRGB.
  // Passer par `mixInSpace` les décoderait pour les ré-encoder aussitôt, à
  // l'erreur d'arrondi près — ici le chemin est direct, donc exact.
  const A: [number, number, number] = [0.1, 0.15, 0.7];
  const B: [number, number, number] = [0.95, 0.5, 0.05];

  it("rend srgbToLinear(mix(a, b, t)) sans aller-retour", () => {
    for (const t of [0, 0.3, 0.5, 1]) {
      const attendu = A.map((v, i) => srgbToLinear(v + (B[i] - v) * t));
      expect(mixSrgbInSpace(A, B, t, BLEND_SPACE_SRGB)).toEqual(attendu);
    }
  });

  it("délègue les trois autres espaces après décodage des bouts", () => {
    const decode = (c: [number, number, number]) => c.map(srgbToLinear) as [number, number, number];
    for (const space of [BLEND_SPACE_LINEAR, BLEND_SPACE_OKLAB, BLEND_SPACE_OKLCH]) {
      expect(mixSrgbInSpace(A, B, 0.5, space)).toEqual(mixInSpace(decode(A), decode(B), 0.5, space));
    }
  });

  it("court-circuite le cas sRGB dans le jumeau WGSL aussi", () => {
    expect(MIX_IN_SPACE_WGSL).toContain("return srgb_to_linear3(mix(a, b, t));");
  });
});

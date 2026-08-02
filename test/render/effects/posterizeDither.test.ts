import { describe, it, expect } from "vitest";
import {
  BAYER_4X4,
  BAYER4_WGSL,
  bayerThreshold,
  ditheredQuantize,
} from "../../../src/render/effects/bayer";
import { posterize } from "../../../src/render/effects/posterize";

/** Quantification sèche d'avant le dither — sert de témoin du bug. */
function nakedQuantize(value: number, levels: number): number {
  const stepSize = 1 / (Math.max(levels, 2) - 1);
  return Math.floor(value / stepSize + 0.5) * stepSize;
}

const BLOCK = Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }));

describe("matrice de Bayer 4x4", () => {
  it("est une permutation de 0..15 (répartition uniforme des seuils)", () => {
    expect([...BAYER_4X4].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
  });

  it("produit des seuils dans [-0.5, 0.5) de moyenne nulle", () => {
    const t = BLOCK.map(({ x, y }) => bayerThreshold(x, y));
    for (const v of t) {
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThan(0.5);
    }
    expect(t.reduce((a, b) => a + b, 0) / t.length).toBeCloseTo(0, 12);
  });

  it("ne dépend QUE de la position en pixels, et se répète toutes les 4 (stable dans le temps)", () => {
    for (const { x, y } of BLOCK) {
      expect(bayerThreshold(x, y)).toBe(bayerThreshold(x, y));
      expect(bayerThreshold(x + 4, y + 8)).toBe(bayerThreshold(x, y));
    }
  });
});

describe("quantification dithérée", () => {
  it("le bruit ajouté ne dépasse jamais un demi-palier", () => {
    for (const levels of [2, 5, 16]) {
      const stepSize = 1 / (levels - 1);
      for (const { x, y } of BLOCK) {
        expect(Math.abs(bayerThreshold(x, y) * stepSize)).toBeLessThanOrEqual(stepSize / 2);
      }
    }
  });

  it("casse la bande : une valeur constante dans un palier sort sur DEUX niveaux voisins", () => {
    const levels = 5; // paliers de 0.25
    const value = 0.3;
    const naive = new Set(BLOCK.map(() => nakedQuantize(value, levels)));
    const dithered = new Set(BLOCK.map(({ x, y }) => ditheredQuantize(value, levels, x, y)));
    expect(naive.size).toBe(1); // témoin du bug : aplat franc
    expect(dithered.size).toBe(2);
    expect([...dithered].sort()).toEqual([0.25, 0.5]);
  });

  it("préserve la moyenne locale (l'erreur de quantification devient un motif, pas un décalage)", () => {
    const levels = 5;
    for (const value of [0.05, 0.3, 0.42, 0.61, 0.77]) {
      const mean =
        BLOCK.reduce((acc, { x, y }) => acc + ditheredQuantize(value, levels, x, y), 0) / 16;
      expect(Math.abs(mean - value)).toBeLessThan(0.01);
      // la quantification sèche, elle, dérive jusqu'à un demi-palier.
      expect(Math.abs(mean - value)).toBeLessThan(Math.abs(nakedQuantize(value, levels) - value) + 1e-12);
    }
  });

  it("un dégradé doux ressort avec des frontières de palier diffuses, pas franches", () => {
    const levels = 5;
    // 64 px de dégradé, une ligne par ligne de la matrice : la sortie contient
    // strictement plus de transitions que les 4 marches d'un aplat sec.
    const ramp = Array.from({ length: 64 }, (_, i) => i / 63);
    const transitions = (vals: number[]) =>
      vals.reduce((n, v, i) => (i > 0 && v !== vals[i - 1] ? n + 1 : n), 0);
    const naive = ramp.map((v) => nakedQuantize(v, levels));
    const dith = ramp.map((v, i) => ditheredQuantize(v, levels, i, 0));
    expect(transitions(naive)).toBe(levels - 1);
    expect(transitions(dith)).toBeGreaterThan(transitions(naive));
  });

  it("reste borné à [0,1] aux extrêmes (le demi-palier ne fait pas déborder le blanc)", () => {
    for (const levels of [2, 5, 16]) {
      for (const { x, y } of BLOCK) {
        expect(ditheredQuantize(1, levels, x, y)).toBe(1);
        expect(ditheredQuantize(0, levels, x, y)).toBe(0);
      }
    }
  });
});

describe("WGSL posterize", () => {
  it("embarque la même matrice que la spécification TS", () => {
    expect(posterize.wgsl).toContain(BAYER4_WGSL.trim());
    expect(BAYER4_WGSL).toContain(BAYER_4X4.map((v) => v.toFixed(1)).join(", "));
  });

  it("dithère avant de quantifier, en coordonnées pixel", () => {
    expect(posterize.wgsl).toContain("vec2<u32>(uv * vec2<f32>(textureDimensions(srcTexture)))");
    // Le dither porte sur `v` et non plus sur `color.rgb` depuis le 2026-08-02 :
    // la couleur passe d'abord par l'axe de répartition et la plage d'entrée.
    // Son amplitude reste UN DEMI-PALIER au maximum, modulée par `dither` —
    // c'est ça, la propriété ; le nom de la variable ne l'est pas.
    expect(posterize.wgsl).toContain("v + vec3<f32>(bayerThreshold(px) * stepSize * dither)");
    expect(posterize.wgsl).toContain("let quantized = floor(dithered / stepSize + 0.5) * stepSize;");
    expect(posterize.wgsl).toContain("floor(dithered / stepSize + 0.5) * stepSize");
    expect(posterize.wgsl).toContain("clamp(quantized");
  });

  it("n'introduit aucune source temporelle ou aléatoire (pas de scintillement)", () => {
    // commentaires retirés : ils PARLENT de frames, le code ne doit pas en lire.
    const code = posterize.wgsl.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/time|frame|random|rand\(/i);
    // Cinq paramètres depuis le 2026-08-02 (Antoine : « posterize a très peu de
    // contrôles » — il en avait UN). L'ordre est verrouillé parce que l'index
    // d'un paramètre est PERSISTÉ dans les presets : les nouveaux s'ajoutent à
    // la FIN, jamais au milieu.
    expect(posterize.params.map((p) => p.name)).toEqual([
      "levels", "dither", "blackPoint", "whitePoint", "distribution",
    ]);
  });

  it("laisse intacte la répartition des paliers (stepSize inchangé)", () => {
    expect(posterize.wgsl).toContain("let levels = max(params[0], 2.0);");
    expect(posterize.wgsl).toContain("let stepSize = 1.0 / (levels - 1.0);");
  });
});

describe("posterize — les quatre contrôles du 2026-08-02", () => {
  it("garde son rendu d'avant sur ses défauts", () => {
    // La référence de pixels `effets-glow-posterize` date d'avant ces
    // paramètres et doit rester valable : chaque défaut est donc l'identité.
    const par = Object.fromEntries(posterize.params.map((p) => [p.name, p.default]));
    expect(par.dither).toBe(1); // l'amplitude d'avant, toujours pleine
    expect(par.blackPoint).toBe(0);
    expect(par.whitePoint).toBe(1); // 0/1 = remise à l'échelle identité
    expect(par.distribution).toBe(0); // Linéaire = l'axe d'avant
  });

  it("sait ÉTEINDRE le tramage — c'est le rendu sérigraphie", () => {
    // Le dither existe pour casser la bande sur un dégradé doux ; un aplat
    // d'affiche veut au contraire la frontière FRANCHE. Ne pas pouvoir le
    // couper interdisait le rendu que la référence §5 décrit.
    const dither = posterize.params.find((p) => p.name === "dither");
    expect(dither?.min).toBe(0);
    // Multiplié dans le shader, donc à 0 le décalage est nul : la quantification
    // redevient exactement `floor(v / pas + 0.5) * pas`.
    expect(posterize.wgsl).toContain("bayerThreshold(px) * stepSize * dither");
  });

  it("expose l'axe de répartition que le cahier laissait OUVERT", () => {
    // §5 : « les paliers doivent-ils se répartir sur l'axe linéaire ou
    // perceptuel ? n'est pas tranchée par les sources […] Reste une décision de
    // look, à prendre à l'œil. » Une décision que les sources ne tranchent pas
    // devient un contrôle, elle ne se fige pas dans le code.
    const d = posterize.params.find((p) => p.name === "distribution");
    expect(d?.choices).toEqual(["Linéaire", "Perceptuel"]);
    // Aller ET retour : quantifier sur l'axe perceptuel sans revenir écrirait
    // des valeurs perceptuelles dans une cible linéaire, donc une image deux
    // fois encodée — le défaut exact que `duotone` a déjà payé.
    expect(posterize.wgsl).toContain("select(color.rgb, linear_to_srgb3(color.rgb), perceptual)");
    expect(posterize.wgsl).toContain("select(plat, srgb_to_linear3(plat), perceptual)");
  });

  it("ne divise jamais par zéro sur la plage d'entrée", () => {
    // Point blanc et point noir confondus produiraient du NaN, qui se propage
    // en pixels noirs — un échec silencieux, pas une erreur.
    expect(posterize.wgsl).toContain("let whitePoint = max(params[3], blackPoint + 0.001);");
  });
});

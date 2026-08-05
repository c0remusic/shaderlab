import { describe, it, expect } from "vitest";
import {
  BAYER_4X4,
  BAYER4_WGSL,
  bayerThreshold,
  ditheredQuantize,
} from "../../../src/render/effects/bayer";
import { dither } from "../../../src/render/effects/dither";

/** CE FICHIER S'APPELAIT `posterizeDither.test.ts` jusqu'au 2026-08-03.
 *
 *  `posterize` est sorti du registre (ADR-0012) parce que `dither` le couvre.
 *  Sa moitié WGSL a donc été REPORTÉE sur `dither` plutôt que supprimée : les
 *  propriétés qu'elle vérifiait — dither avant quantification, en coordonnées
 *  pixel, sans source temporelle, sans division par zéro — ne tenaient pas à
 *  l'effet, elles tiennent à l'opération. Les supprimer avec lui aurait rendu
 *  le retrait plus coûteux qu'il n'est.
 *
 *  La première moitié, elle, n'a pas bougé d'une ligne : elle teste `bayer.ts`,
 *  qui survit à `posterize` puisque `dither` s'en sert pour deux de ses six
 *  styles. */

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

describe("WGSL dither — ce que `posterize` vérifiait, reporté sur son successeur", () => {
  it("embarque la même matrice 4x4 que la spécification TS", () => {
    // `dither` la garde pour son style « Bayer fin » : seize seuils au lieu des
    // soixante-quatre de la 8x8, donc une grille plus grosse à taille de
    // cellule égale. C'est le dither d'un écran 8 bits, et c'était celui de
    // `posterize`.
    expect(dither.wgsl).toContain(BAYER4_WGSL.trim());
    expect(BAYER4_WGSL).toContain(BAYER_4X4.map((v) => v.toFixed(1)).join(", "));
  });

  it("trame en coordonnées PIXEL, pas en UV", () => {
    // Une trame doit avoir la même finesse sur les deux axes ; un pas en UV ne
    // le donne pas dès que la photo n'est pas carrée.
    expect(dither.wgsl).toContain("let px = uv * vec2<f32>(textureDimensions(srcTexture));");
    expect(dither.wgsl).toContain("let cell = px / size;");
  });

  it("dithère AVANT de quantifier, et d'au plus un demi-palier", () => {
    // Le seuil de tous les styles est borné à [-0.5, 0.5) par construction ;
    // ajouté au 0.5 de l'arrondi, il déplace donc la décision d'au plus un
    // demi-palier. C'est la propriété, pas le nom des variables.
    expect(dither.wgsl).toContain("floor(v / pas + 0.5 + seuil) * pas");
    expect(dither.wgsl).toContain("let pas = 1.0 / max(levels - 1.0, 1.0);");
  });

  it("n'introduit aucune source temporelle (pas de scintillement)", () => {
    // Commentaires retirés : ils PARLENT de frames, le code ne doit pas en lire.
    // Le hachage de bruit blanc n'est pas une exception — il ne prend que la
    // position de la cellule, donc il est stable d'une image à l'autre.
    const code = dither.wgsl.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\btime\b|\bframe\b|\brandom\b|\brand\(/i);
    expect(dither.wgsl).toContain("hash(floor(cell))");
  });

  it("verrouille l'ORDRE de ses dix-sept paramètres", () => {
    // L'index d'un paramètre est PERSISTÉ dans les presets : un nouveau s'ajoute
    // à la FIN, jamais au milieu.
    expect(dither.params.map((p) => p.name)).toEqual([
      "style", "size", "levels", "mono",
      "blackPoint", "whitePoint",
      "inkHue", "inkSaturation", "inkLightness",
      "paperHue", "paperSaturation", "paperLightness",
      "distribution", "amount",
      // Encre réelle (`inkTexture.ts`), ajoutée à la fin le 2026-08-05.
      "encreRang", "encreForce", "encreEchelle",
    ]);
  });

  it("n'ajoute AUCUNE bavure par défaut — l'adoption de l'encre est invisible", () => {
    // Condition de non-régression : à force nulle, `ink_froisse` rend sa valeur
    // inchangée, donc le rendu est identique au bit près. Le verrou de pixels
    // le vérifie ; ce test dit POURQUOI il passe.
    expect(dither.params.find((p) => p.name === "encreForce")?.default).toBe(0);
    expect(dither.libraryTexture).toEqual({ indexParam: "encreRang" });
    expect(dither.passes ?? []).toHaveLength(0);
  });

  it("sait ÉTEINDRE le tramage — c'est le rendu sérigraphie que faisait `posterize`", () => {
    // Le tramage existe pour casser la bande sur un dégradé doux ; un aplat
    // d'affiche veut au contraire la frontière FRANCHE. C'est l'un des deux
    // contrôles qui font de cet effet un surensemble.
    const amount = dither.params.find((p) => p.name === "amount");
    expect(amount?.min).toBe(0);
    // Multiplié dans le shader, donc à 0 le décalage est nul et la
    // quantification redevient exactement `floor(v / pas + 0.5) * pas`.
    expect(dither.wgsl).toContain("ditherThreshold(cell, style, size) * clamp(params[13], 0.0, 1.0)");
  });

  it("expose l'axe de répartition, et son défaut DIVERGE de celui de `posterize`", () => {
    // Le §5 du cahier laissait la question ouverte (« linéaire ou perceptuel ?
    // […] reste une décision de look »), et une décision que les sources ne
    // tranchent pas devient un contrôle. Mais les deux effets n'ont pas le même
    // défaut, et c'est délibéré : un tramage rend un DÉGRADÉ, donc ses niveaux
    // ont intérêt à être également espacés à l'œil ; un posterize fait des
    // APLATS. Le retrait de `posterize` ne rend donc pas `dither` identique à
    // lui sur ses défauts — il le rend capable de faire la même chose.
    const d = dither.params.find((p) => p.name === "distribution");
    expect(d?.choices).toEqual(["Linéaire", "Perceptuel"]);
    expect(d?.default).toBe(1); // Perceptuel
    // Aller ET retour : quantifier sur l'axe perceptuel sans revenir écrirait
    // des valeurs perceptuelles dans une cible linéaire, donc une image deux
    // fois encodée — le défaut exact que `duotone` a déjà payé.
    expect(dither.wgsl).toContain("mix(color.rgb, linear_to_srgb3(color.rgb), perceptuel)");
  });

  it("ne divise jamais par zéro sur la plage d'entrée", () => {
    // Point blanc et point noir confondus produiraient du NaN, qui se propage
    // en pixels noirs — un échec silencieux, pas une erreur.
    expect(dither.wgsl).toContain("let whitePoint = max(params[5], blackPoint + 0.001);");
  });
});

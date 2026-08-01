import { describe, it, expect } from "vitest";
import { anamorphicStreak } from "../../../src/render/effects/anamorphicStreak";
import { glow } from "../../../src/render/effects/glow";
import { halation } from "../../../src/render/effects/halation";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";

const bright = anamorphicStreak.passes?.[0];
const etalement = anamorphicStreak.passes?.[1];

describe("anamorphicStreak — la teinte vient de l'OBJECTIF, pas de la source", () => {
  it("jette la couleur au bright-pass", () => {
    // Une lampe verte donne une traînée bleue : la teinte vient du traitement
    // anti-reflet, pas de la lumière. Garder la couleur source produirait une
    // traînée arc-en-ciel, ce qu'aucun objectif ne fait. Même raison, et même
    // écriture, que le bright-pass de `halation`.
    expect(bright?.wgsl).toContain("return vec4<f32>(vec3<f32>(e * e), 1.0);");
  });

  it("décode le seuil vers le linéaire", () => {
    expect(bright?.wgsl).toContain("let seuil = srgb_to_linear(clamp(params[0], 0.0, 1.0));");
    expect(srgbToLinear(0.62)).toBeLessThan(0.4);
  });

  it("applique un genou doux et non une bascule", () => {
    // Une coupure franche fait clignoter la traînée quand une haute lumière
    // traverse le seuil d'un cran d'exposition.
    expect(bright?.wgsl).toContain("let e = max(l - seuil, 0.0) / max(1.0 - seuil, 0.0001);");
  });
});

describe("anamorphicStreak — le nombre de taps est LIÉ à la croissance du pas", () => {
  it("échantillonne jusqu'à ±4 pas", () => {
    // Une passe dont les taps vont jusqu'à ±N pas étale sur ±N pas. Si la
    // suivante multiplie le pas par plus de N, elle échantillonne au-delà de ce
    // qui est couvert et laisse un trou. La première version avait ±2 taps pour
    // un facteur 4 : elle perlait en chapelet de billes, et le témoin de rendu
    // l'a montré immédiatement.
    expect(etalement?.wgsl).toContain("for (var i = 1; i <= 4; i = i + 1) {");
  });

  it("fait croître le pas d'un facteur exactement égal à cette portée", () => {
    // 1, 4, 16 : chaque passe multiplie par 4, ce que ±4 taps couvrent
    // exactement. Les deux nombres ne se changent pas l'un sans l'autre.
    const pas = (anamorphicStreak.passes ?? []).slice(1).map((p) => {
      const m = p.wgsl.match(/\* ([\d.]+)\.0\) \/ dims;/);
      return m ? Number(m[1]) : null;
    });
    expect(pas).toEqual([1, 4, 16]);
    for (let i = 1; i < pas.length; i++) {
      expect(pas[i]! / pas[i - 1]!).toBeLessThanOrEqual(4);
    }
  });

  it("pondère par 1/(1+i), sans constante magique par rang", () => {
    expect(etalement?.wgsl).toContain("let poids = 1.0 / (1.0 + f32(i));");
    expect(etalement?.wgsl).toContain("return vec4<f32>(sum / w, 1.0);");
  });

  it("corrige l'aspect, sinon l'angle mentirait", () => {
    expect(etalement?.wgsl).toContain("let dir = vec2<f32>(cos(angle), sin(angle)) / ar;");
  });
});

describe("anamorphicStreak — il ne double ni glow ni halation", () => {
  it("est ADDITIF, comme une lumière parasite", () => {
    expect(anamorphicStreak.wgsl).toContain("return vec4<f32>(color.rgb + tint * energie * intensity, color.a);");
  });

  it("est le seul des trois à porter une ORIENTATION", () => {
    // C'est ce qui le distingue : un objectif anamorphique porte un élément
    // CYLINDRIQUE, donc l'étalement se fait sur un seul axe. glow et halation
    // étalent en disque.
    expect(anamorphicStreak.params.some((p) => p.name === "angle")).toBe(true);
    expect(glow.params.some((p) => p.name === "angle")).toBe(false);
    expect(halation.params.some((p) => p.name === "angle")).toBe(false);
  });

  it("dérive sa dispersion de l'ÉNERGIE et non d'une distance", () => {
    // Même construction que le dégradé de halation, et pour la même raison :
    // une distance géométrique demanderait un second champ et serait fausse dès
    // que deux sources voisines se rejoignent.
    expect(anamorphicStreak.wgsl).toContain("let vire = (1.0 - clamp(energie * 4.0, 0.0, 1.0)) * dispersion;");
  });

  it("est posé entre halation et lensBlur", () => {
    expect(getEffect("anamorphicStreak")).toBe(anamorphicStreak);
    const i = effectRegistry.indexOf(anamorphicStreak);
    expect(effectRegistry[i - 1]).toBe(halation);
  });
});

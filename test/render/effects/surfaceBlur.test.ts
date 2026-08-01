import { describe, it, expect } from "vitest";
import { surfaceBlur } from "../../../src/render/effects/surfaceBlur";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { linearToSrgb } from "../../../src/render/effects/srgbTransfer";

const gather = surfaceBlur.passes?.[0];

describe("surfaceBlur — ce qui le sépare d'un gaussien", () => {
  it("pèse chaque voisin par son ÉCART DE VALEUR, pas seulement par sa distance", () => {
    // C'est tout le filtre. Sans ce poids, il moyennerait sans distinction et
    // effacerait les contours en même temps que le bruit — ce que la référence
    // §6ter reproche au gaussien, et la raison pour laquelle celui-ci entre au
    // registre quand le gaussien reste dehors.
    expect(gather?.wgsl).toContain("let wr = exp(-pow(dl / sigma, stiffness));");
    expect(gather?.wgsl).toContain("let w = ws * wr;");
  });

  it("mesure l'écart sur la LUMINANCE et l'applique au triplet entier", () => {
    // Peser chaque canal séparément ferait dériver la teinte des pixels de bord
    // — le voisin accepté en rouge et refusé en bleu, donc un mélange sans sens
    // colorimétrique.
    expect(gather?.wgsl).toContain("let dl = abs(linear_to_srgb(dot(c.rgb, SURFACE_LUMA)) - centerLuma);");
    expect(gather?.wgsl).toContain("sum = sum + c * w;");
  });

  it("lit le seuil sur l'axe PERCEPTUEL des deux côtés de la comparaison", () => {
    // En lumière linéaire, un même écart ne veut pas dire la même chose dans
    // une ombre et dans une haute lumière : le filtre lisserait les ombres
    // jusqu'à l'aplat et n'oserait rien dans les ciels.
    expect(gather?.wgsl).toContain("let centerLuma = linear_to_srgb(dot(color.rgb, SURFACE_LUMA));");
    expect(linearToSrgb(0.5)).toBeGreaterThan(0.7);
  });

  it("garde un poids SPATIAL gaussien, pas plat", () => {
    // Un poids plat ferait du filtre une moyenne de boîte, dont le noyau se lit
    // en croix sur les aplats.
    expect(gather?.wgsl).toContain("let ws = exp(-2.0 * r * r);");
  });
});

describe("surfaceBlur — la raideur est un vrai réglage", () => {
  it("va de la gaussienne au tout-ou-rien", () => {
    // À raideur maximale les zones se séparent en plages — le rendu
    // « peinture » de Smart Blur. À raideur minimale le lissage reste
    // photographique. Aucun des deux n'est le bon par défaut.
    expect(gather?.wgsl).toContain("let stiffness = mix(8.0, 2.0, clamp(params[2], 0.0, 1.0));");
    const s = surfaceBlur.params.find((p) => p.name === "stiffness");
    expect(s).toMatchObject({ min: 0, max: 1 });
  });

  it("borne le seuil au-dessus de zéro", () => {
    // À zéro, aucun voisin ne passerait jamais : le filtre rendrait la copie de
    // l'image en payant tous ses taps.
    expect(gather?.wgsl).toContain("let sigma = max(params[1], 0.002);");
    expect(surfaceBlur.params.find((p) => p.name === "threshold")?.min).toBeGreaterThan(0);
  });
});

describe("surfaceBlur — les pièges déjà payés ailleurs", () => {
  it("compte le pixel CENTRAL avec un poids de 1", () => {
    // Un pixel isolé dont TOUS les voisins sont hors seuil — un point de
    // poussière, un pixel chaud — n'aurait aucun poids valide et sortirait de
    // la division par un plancher, c'est-à-dire noir. Il doit rester lui-même,
    // pas disparaître.
    expect(gather?.wgsl).toContain("var sum = color * 1.0;");
    expect(gather?.wgsl).toContain("var wsum = 1.0;");
    // Le plancher de division devient donc inutile : wsum vaut au moins 1.
    expect(gather?.wgsl).toContain("return sum / wsum;");
  });

  it("convertit le rayon en TEXELS de la cible de demi-résolution", () => {
    // Le facteur 0.5 ne « tombe pas tout seul » — c'est l'erreur qu'a faite la
    // première version de `lensBlur`, qui floutait au double du rayon réglé.
    expect(gather?.wgsl).toContain("let rt = max(params[0], 0.0) * 0.5;");
  });

  it("fait suivre le nombre de taps à l'AIRE, et tourne la spirale par pixel", () => {
    expect(gather?.wgsl).toContain("let taps = clamp(i32(3.141592653589793 * rt * rt / 3.0), 24, 192);");
    expect(gather?.wgsl).toContain("let jitter = hash(uv * dims) * TAU;");
    expect(gather?.wgsl).toContain("let r = sqrt(t);");
  });

  it("échantillonne en textureSampleLevel (flux de contrôle non uniforme)", () => {
    expect(gather?.wgsl).toContain("textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv + off), 0.0)");
    expect(gather?.wgsl).not.toMatch(/textureSample\(srcTexture/);
  });

  it("reprend le net sous le pixel", () => {
    // Un filtre dont la promesse est de PRÉSERVER ne peut pas se permettre de
    // ramollir ce qu'il ne touche pas via l'aller-retour de résolution.
    expect(surfaceBlur.passes?.[0].scale).toBe(0.5);
    expect(surfaceBlur.wgsl).toContain("let sharpness = smoothstep(0.7, 2.0, radiusPx);");
  });
});

describe("surfaceBlur — registre", () => {
  it("est enregistré et lit ses paramètres dans l'ordre déclaré", () => {
    expect(getEffect("surfaceBlur")).toBe(surfaceBlur);
    expect(effectRegistry).toContain(surfaceBlur);
    expect(surfaceBlur.params.map((p) => p.name)).toEqual(["radius", "threshold", "stiffness"]);
  });

  it("n'introduit PAS de gaussien au registre", () => {
    // La famille des flous est close par ce fichier, et le gaussien en reste
    // volontairement dehors : la référence §6ter dit qu'il lave l'image, et
    // c'est exactement ce qu'un poids de valeur empêche.
    expect(effectRegistry.some((e) => e.id === "gaussianBlur")).toBe(false);
    expect(effectRegistry.some((e) => e.id === "boxBlur")).toBe(false);
  });
});

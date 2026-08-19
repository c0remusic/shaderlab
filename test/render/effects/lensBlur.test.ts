import { describe, it, expect } from "vitest";
import { apertureRadiusSpec, lensBlur } from "../../../src/render/effects/lensBlur";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";

const gather = lensBlur.passes?.[0];

describe("lensBlur — la forme du diaphragme", () => {
  it("rend un disque en dessous de 3 lames", () => {
    for (const blades of [0, 1, 2]) {
      for (const theta of [0, 1, 2.5, 5]) {
        expect(apertureRadiusSpec(theta, blades, 0)).toBe(1);
      }
    }
  });

  it("inscrit le polygone dans le disque unité : sommets à 1, arêtes à cos(pi/n)", () => {
    // C'est LA propriété qui distingue un polygone inscrit d'un circonscrit.
    // Circonscrit, les taches de bokeh déborderaient du rayon réglé — un écart
    // qui se lit comme un choix esthétique et jamais comme un défaut.
    for (const n of [3, 5, 6, 8]) {
      const seg = (2 * Math.PI) / n;
      // Milieu d'arête : k = 0 -> rayon minimal.
      expect(apertureRadiusSpec(seg * 0.5, n, 0)).toBeCloseTo(Math.cos(Math.PI / n), 6);
      // Sommet : k = ±seg/2 -> rayon 1, il touche le cercle.
      expect(apertureRadiusSpec(0, n, 0)).toBeCloseTo(1, 6);
      expect(apertureRadiusSpec(seg, n, 0)).toBeCloseTo(1, 6);
    }
  });

  it("ne sort JAMAIS du disque unité, quel que soit l'angle", () => {
    for (const n of [3, 4, 5, 6, 7, 9, 12]) {
      for (let i = 0; i < 360; i++) {
        const r = apertureRadiusSpec((i / 360) * 2 * Math.PI, n, 0.7);
        expect(r).toBeLessThanOrEqual(1 + 1e-9);
        expect(r).toBeGreaterThanOrEqual(Math.cos(Math.PI / n) - 1e-9);
      }
    }
  });

  it("est périodique d'un secteur — la rotation ne change que l'orientation", () => {
    const n = 6;
    const seg = (2 * Math.PI) / n;
    for (const theta of [0.3, 1.1, 2.7]) {
      expect(apertureRadiusSpec(theta + seg, n, 0)).toBeCloseTo(apertureRadiusSpec(theta, n, 0), 9);
    }
    // Tourner de un secteur = ne rien tourner du tout.
    expect(apertureRadiusSpec(0.4, n, seg)).toBeCloseTo(apertureRadiusSpec(0.4, n, 0), 9);
  });

  it("porte la MÊME formule côté WGSL", () => {
    expect(gather?.wgsl).toContain("let droit = cos(3.141592653589793 / blades) / cos(k);");
    expect(gather?.wgsl).toContain("return mix(droit, 1.0, clamp(curvature, 0.0, 1.0));");
    expect(gather?.wgsl).toContain("let k = a - seg * floor(a / seg) - seg * 0.5;");
    expect(gather?.wgsl).toContain("if (blades < 2.5) {");
  });
});

describe("lensBlur — ce qui le sépare d'un gaussien", () => {
  it("décode le seuil de hautes lumières vers le LINÉAIRE avant comparaison", () => {
    // Précédent : le bright-pass du glow, dont ce décodage manquant rendait le
    // curseur inerte sur 85 % de sa course.
    expect(gather?.wgsl).toContain("let threshold = srgb_to_linear(clamp(params[3], 0.0, 1.0));");
    expect(gather?.wgsl).toMatch(/fn srgb_to_linear\(c: f32\)/);
    // Le défaut à 0.6 perceptuel mord bien en dessous du blanc en linéaire.
    expect(srgbToLinear(0.6)).toBeCloseTo(0.3185, 4);
    expect(srgbToLinear(0.6)).toBeLessThan(0.5);
  });

  it("pondère chaque tap par sa luminance et divise par la somme des poids APPLIQUÉS", () => {
    // Diviser par le nombre de taps ferait fuir l'énergie proportionnellement à
    // la luminosité locale — même piège que la moyenne de Karis du glow.
    expect(gather?.wgsl).toContain("let w = 1.0 + boost * max(0.0, dot(c.rgb, LENS_LUMA) - threshold);");
    expect(gather?.wgsl).toContain("return sum / max(wsum, 0.0001);");
    expect(gather?.wgsl).not.toMatch(/sum\s*\/\s*48/);
  });

  it("expose une intensité de bokeh dont le zéro EST le gaussien", () => {
    const boost = lensBlur.params.find((p) => p.name === "highlightBoost");
    expect(boost?.min).toBe(0);
    // Défaut franchement au-dessus de zéro : un effet dont le défaut est la
    // version dégradée de lui-même ne montre rien quand on le pose.
    expect(boost?.default).toBeGreaterThan(0);
  });
});

describe("lensBlur — l'échantillonnage du disque", () => {
  it("répartit les taps en sqrt du rang (densité constante sur l'aire)", () => {
    // Sans la racine, les taps s'entassent au centre et le BORD du bokeh est
    // sous-échantillonné — c'est-à-dire crénelé, là où il se voit le plus.
    expect(gather?.wgsl).toContain("let r = sqrt(t) * aperture_radius(theta, blades, rotation, curvature);");
  });

  it("fait suivre le NOMBRE de taps à l'aire du disque", () => {
    // Un nombre fixe etait la premiere version : la densite s'effondre quand le
    // rayon monte, et le tirage par pixel decorrele les voisins, donc le disque
    // sort en nuee granuleuse. Attrape par le scenario de rendu
    // « effet-lens-blur-bokeh », que la mire de damier ne pouvait pas voir.
    expect(gather?.wgsl).toContain("let taps = clamp(i32(3.141592653589793 * rt * rt / 3.0), 24, 256);");
    expect(gather?.wgsl).toContain("for (var i = 0; i < taps; i = i + 1) {");
  });

  it("convertit le rayon en TEXELS de la cible de demi-résolution", () => {
    // `step = radiusPx / dims` avec dims en demi-résolution donnait un décalage
    // de radiusPx demi-texels, soit le DOUBLE du rayon réglé. Invisible sur un
    // damier, flagrant sur des points isolés.
    expect(gather?.wgsl).toContain("let rt = radiusPx * 0.5;");
    expect(gather?.wgsl).toContain("let step = rt / dims;");
  });

  it("tourne la spirale d'un angle tiré par pixel", () => {
    expect(gather?.wgsl).toContain("let jitter = hash(uv * dims) * TAU;");
    expect(gather?.wgsl).toContain("let theta = fi * GOLDEN_ANGLE + jitter;");
  });

  it("échantillonne en textureSampleLevel, pas en textureSample", () => {
    // Le court-circuit de rayon nul rend le flux de contrôle NON UNIFORME ;
    // `textureSample` calcule des dérivées implicites et WGSL l'y interdit.
    // Une régression ici ne casserait AUCUN test Node — seulement la
    // compilation du shader sur GPU réel.
    expect(gather?.wgsl).toContain("textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv + off), 0.0)");
    expect(gather?.wgsl).not.toMatch(/textureSample\(srcTexture/);
  });
});

describe("lensBlur — le raccord net/flou", () => {
  it("partage UNE seule définition du champ entre les deux passes", () => {
    // Deux copies dériveraient, et l'écart se lirait comme une frange au
    // raccord — un défaut d'optique apparent qui ne serait qu'un copier-coller
    // (même leçon que `blurChain` entre glow et halation).
    expect(gather?.wgsl).toContain("fn lens_field(uv: vec2<f32>, dims: vec2<f32>) -> f32 {");
    expect(lensBlur.wgsl).toContain("fn lens_field(uv: vec2<f32>, dims: vec2<f32>) -> f32 {");
  });

  it("fait coïncider le seuil de reprise du net avec le court-circuit de la collecte", () => {
    // 0.35 des deux côtés : sous ce rayon la collecte rend déjà la copie du
    // pixel central, donc les deux chemins coïncident et le raccord est
    // invisible par construction plutôt que par réglage.
    expect(gather?.wgsl).toContain("if (radiusPx < 0.35) {");
    expect(lensBlur.wgsl).toContain("let sharpness = smoothstep(0.35, 1.0, radiusPx);");
  });

  it("reprend la couleur PLEINE DÉFINITION sous le seuil", () => {
    // La collecte tourne à 1/2 : sans cette reprise, une zone à rayon nul
    // ressortirait adoucie par le seul aller-retour de résolution.
    expect(lensBlur.passes?.[0].scale).toBe(0.5);
    expect(lensBlur.wgsl).toContain("mix(color.rgb, blurred.rgb, sharpness)");
  });
});

describe("lensBlur — registre et paramètres", () => {
  it("est enregistré et résoluble", () => {
    expect(getEffect("lensBlur")).toBe(lensBlur);
    expect(effectRegistry).toContain(lensBlur);
  });

  it("déclare une géométrie de champ dont le défaut est Uniforme", () => {
    const shape = lensBlur.params.find((p) => p.name === "fieldShape");
    expect(shape?.choices).toEqual(["Uniforme", "Linéaire", "Iris", "Radial"]);
    expect(shape?.default).toBe(0);
  });

  it("lit ses paramètres dans l'ordre exact où il les déclare", () => {
    // Le shader lit `params[i]` : un réordonnancement de la liste sans
    // réécriture des index serait une panne SILENCIEUSE — le shader compile
    // quel que soit i, il lit juste le mauvais curseur. Même verrou que
    // l'index de portée passé en argument dans glow/halation.
    expect(lensBlur.params.map((p) => p.name)).toEqual([
      "radius",
      "blades",
      "bladeRotation",
      "highlightThreshold",
      "highlightBoost",
      "fieldShape",
      "fieldCenterX",
      "fieldCenterY",
      "fieldAngle",
      "fieldRange",
      "fieldFeather",
      // ⚠️ EN FIN DE LISTE ET PAS À SA PLACE LOGIQUE (après `bladeRotation`).
      // Un index de paramètre est persisté dans les presets et gelé par les
      // références de pixels : il s'append, il ne s'insère pas. C'est la section
      // `diaphragme` qui le remet à sa place à l'affichage.
      "bladeCurvature",
    ]);
    expect(gather?.wgsl).toContain("let radiusPx = max(params[0], 0.0) * lens_field(uv, dims);");
    expect(gather?.wgsl).toContain("let blades = params[1];");
    expect(gather?.wgsl).toContain("let boost = max(params[4], 0.0);");
    expect(gather?.wgsl).toContain("let curvature = clamp(params[11], 0.0, 1.0);");
    expect(lensBlur.passes?.[0].wgsl).toContain("let shape = params[5];");
    expect(lensBlur.passes?.[0].wgsl).toContain("let feather = clamp(params[10], 0.0, 1.0);");
  });
});

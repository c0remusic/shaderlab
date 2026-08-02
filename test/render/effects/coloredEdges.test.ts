import { describe, it, expect } from "vitest";
import { coloredEdges } from "../../../src/render/effects/coloredEdges";
import { outlines } from "../../../src/render/effects/outlines";
import { EDGE_GRADIENT_WGSL, SCHARR_NORM } from "../../../src/render/effects/edgeGradient";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";

/** Retire les commentaires : toute assertion NÉGATIVE doit porter sur le code
 *  seul, les shaders de ce dossier citant l'écriture qu'ils écartent. */
const codeSeul = (wgsl: string) =>
  wgsl.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("edgeGradient — le détecteur partagé", () => {
  it("est inclus par les DEUX effets de contour", () => {
    expect(outlines.wgsl).toContain("fn edge_scharr(");
    expect(coloredEdges.wgsl).toContain("fn edge_scharr(");
    // Et il n'existe qu'en un seul endroit : chacun l'inclut, aucun ne le
    // redéfinit. Deux copies dessineraient des bords à des endroits différents.
    expect(EDGE_GRADIENT_WGSL).toContain("fn edge_scharr(");
  });

  it("porte les poids de Scharr et non ceux de Sobel", () => {
    // Sobel (1,2,1) donne une réponse dépendante de l'orientation : une
    // diagonale sort ~10 % plus faible qu'une verticale, donc un même seuil
    // ouvre les traits horizontaux et ferme les obliques.
    expect(EDGE_GRADIENT_WGSL).toContain("(tr * 3.0 + mr * 10.0 + br * 3.0) - (tl * 3.0 + ml * 10.0 + bl * 3.0)");
    expect(EDGE_GRADIENT_WGSL).toContain("(bl * 3.0 + bc * 10.0 + br * 3.0) - (tl * 3.0 + tc * 10.0 + tr * 3.0)");
  });

  it("n'échantillonne PAS le tap central", () => {
    // Ses poids sont nuls dans les deux noyaux : le lire serait une lecture
    // payée pour être multipliée par zéro. Huit taps, pas neuf.
    const taps = [...EDGE_GRADIENT_WGSL.matchAll(/edgeTap\(uv, vec2<f32>\(/g)];
    expect(taps).toHaveLength(8);
    expect(EDGE_GRADIENT_WGSL).not.toContain("edgeTap(uv, vec2<f32>( 0.0,  0.0)");
  });

  it("expose la normalisation du noyau en constante partagée", () => {
    // 32 = réponse de Scharr à une rampe unité sur un écartement de tap. Les
    // deux effets divisent par elle, donc leurs seuils ont le même sens.
    expect(SCHARR_NORM).toBe(32);
    expect(outlines.wgsl).toContain(`/ ${SCHARR_NORM}.0;`);
    expect(coloredEdges.wgsl).toContain(`/ ${SCHARR_NORM}.0;`);
  });
});

describe("coloredEdges — la teinte vient de l'ORIENTATION", () => {
  it("garde la direction du gradient, là où outlines la jette", () => {
    // C'est toute la différence entre les deux effets, et la raison pour
    // laquelle ce n'est pas un doublon d'`outlines` malgré le détecteur commun.
    expect(coloredEdges.wgsl).toContain("let turns = atan2(dirVec.y, dirVec.x) / 6.283185307179586;");
    expect(codeSeul(outlines.wgsl)).not.toContain("atan2");
  });

  it("referme le cercle des teintes avec fract", () => {
    // Un angle fait le tour. Une rampe de teinte qui ne boucle pas poserait une
    // couture visible sur les bords orientés à 180°.
    expect(coloredEdges.wgsl).toContain("let hue = fract(hueOffset + turns * hueSpread);");
  });

  it("fait entrer la chromaticité dans l'ORIENTATION, pas seulement dans la magnitude", () => {
    // Sur un contour isoluminant, le gradient de ton est nul : sa direction
    // serait du bruit et la teinte scintillerait pixel à pixel.
    expect(coloredEdges.wgsl).toContain("let gChroma = vec2<f32>(gx.y + gx.z, gy.y + gy.z);");
    expect(coloredEdges.wgsl).toContain("let dirVec = gTone + chroma * 3.0 * gChroma;");
  });

  it("pèse la chromaticité du MÊME facteur dans les deux usages", () => {
    // Un seul curseur pour une seule notion : si l'orientation et la magnitude
    // pondéraient différemment, un contour pourrait être tracé sans que sa
    // teinte suive, ou l'inverse.
    expect(coloredEdges.wgsl).toContain("let mag = max(toneMag, chroma * 3.0 * chromaMag);");
    expect(coloredEdges.wgsl).toContain("chroma * 3.0 * gChroma");
  });

  it("garde le plancher fwidth d'antialiasing", () => {
    // Un contour COLORÉ crénelé est deux fois plus visible qu'un contour noir :
    // l'escalier y change aussi de teinte.
    expect(coloredEdges.wgsl).toContain("let band = max(max(softness * 0.5, fwidth(mag)), 0.0005);");
  });

  it("construit la couleur du contour en OKLCH, pas en HSL", () => {
    // RENVERSÉ LE 2026-08-02, et c'est la SPEC qui a changé, pas la mesure.
    // Cette ligne exigeait `srgb_to_linear3(hsl2rgb(hue, saturation, lightness))`
    // — un décodage correct d'une couleur construite dans le mauvais espace.
    // HSL n'est pas perceptuel : à saturation et clarté fixées, parcourir la
    // teinte fait varier la clarté PERÇUE. Mesuré sur la référence de rendu,
    // sur les seuls pixels pleinement encrés : étendue de 0,290 sur le tour,
    // pour un unique curseur Clarté. C'est ce que le verdict d'usage appelait
    // « horrible ». En OKLCH la même étendue tombe à 0,018.
    //
    // La garde de non-régression correspondante vit dans
    // `test/scripts/renderRefs.test.mjs` : elle mesure la roue sur les pixels
    // eux-mêmes, là où celle-ci ne peut que lire une chaîne.
    expect(coloredEdges.wgsl).toContain(
      "let edgeColor = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(lightness, saturation * 0.3, hue)));",
    );
    expect(coloredEdges.wgsl).not.toContain("hsl2rgb(hue,");
  });

  it("borne le chroma au gamut sRGB — sinon l'écrêtage rendrait la roue irrégulière par le bas", () => {
    // Sans borne, une teinte hors gamut est écrêtée par la cible, et l'écrêtage
    // ne tombe pas au même endroit selon la teinte : la régularité qu'on vient
    // d'obtenir se reperdrait, par un autre chemin.
    expect(coloredEdges.wgsl).toContain("saturation * 0.3");
  });

  it("borne l'étendue des teintes au-dessus de zéro", () => {
    // À 0 l'effet dégénérerait en `outlines` avec une encre unique — un réglage
    // qui rend un AUTRE effet, donc un doublon atteignable au curseur.
    const spread = coloredEdges.params.find((p) => p.name === "hueSpread");
    expect(spread?.min).toBeGreaterThan(0);
    expect(coloredEdges.wgsl).toContain("let hueSpread = clamp(params[5], 0.05, 1.0);");
  });
});

describe("coloredEdges — registre et paramètres", () => {
  it("est enregistré, et posé juste après outlines", () => {
    expect(getEffect("coloredEdges")).toBe(coloredEdges);
    const i = effectRegistry.indexOf(coloredEdges);
    expect(effectRegistry[i - 1]).toBe(outlines);
  });

  it("lit ses paramètres dans l'ordre exact où il les déclare", () => {
    expect(coloredEdges.params.map((p) => p.name)).toEqual([
      "thickness", "threshold", "softness", "chroma",
      "hueOffset", "hueSpread", "saturation", "lightness", "wash",
      "backgroundHue", "backgroundSaturation", "backgroundLightness", "inputSource",
    ]);
    expect(coloredEdges.wgsl).toContain("edge_spacing(params[0])");
    expect(coloredEdges.wgsl).toContain("let source = params[12];");
  });

  it("a pour fond par défaut le BLANC — le rendu d'avant, au bit près", () => {
    // La couleur de fond remplace un blanc imposé (réf. Figma `Background`).
    // Teinte 0, saturation 0, luminosité 1 = blanc : aucun preset existant ne
    // bouge, et c'est la condition pour poser ce paramètre sur un effet déjà
    // livré.
    const fond = Object.fromEntries(
      coloredEdges.params.filter((p) => p.colorGroup?.key === "background").map((p) => [p.colorGroup!.role, p.default])
    );
    expect(fond).toEqual({ hue: 0, saturation: 0, lightness: 1 });
    expect(coloredEdges.wgsl).toContain("let paper = mix(color.rgb, background, wash);");
  });
});

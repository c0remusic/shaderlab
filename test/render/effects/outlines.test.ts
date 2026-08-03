import { describe, it, expect } from "vitest";
import { outlines } from "../../../src/render/effects/outlines";
import { echoOutlines } from "../../../src/render/effects/echoOutlines";
import { EDGE_GRADIENT_WGSL, SCHARR_NORM } from "../../../src/render/effects/edgeGradient";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";

/** CE FICHIER S'APPELAIT `coloredEdges.test.ts` jusqu'au 2026-08-03.
 *
 *  `coloredEdges` a été absorbé par `outlines` (arbitrage d'Antoine) : ce qui
 *  les séparait — jeter la direction du gradient, ou en faire une teinte — est
 *  devenu le paramètre `inkMode`. Les assertions n'ont pas été supprimées avec
 *  l'effet, elles ont été REPORTÉES sur le mode qui porte désormais la
 *  propriété. Même geste que pour `posterize` -> `dither` le même jour, et pour
 *  la même raison : une propriété rangée dans le fichier d'un effet disparaît
 *  avec lui, en silence. */

describe("edgeGradient — le détecteur partagé", () => {
  it("est inclus par les deux effets de contour qui restent", () => {
    // `outlines` (les deux modes d'encre) et `echoOutlines`. Deux copies du
    // noyau auraient dérivé, et deux effets de contour posés sur la même photo
    // auraient dessiné des bords à des endroits DIFFÉRENTS — ce qui ressemble à
    // un choix esthétique et n'est qu'un copier-coller qui a vieilli.
    expect(outlines.wgsl).toContain("fn edge_scharr(");
    expect(outlines.wgsl).toContain(EDGE_GRADIENT_WGSL.trim());
  });

  it("porte les poids de Scharr et non ceux de Sobel", () => {
    // Sobel (1,2,1) n'est pas isotrope : une diagonale sort ~10 % plus faible
    // qu'une verticale. En mode Roue ce n'est plus un confort mais une
    // CONDITION — une réponse qui dépend de l'orientation ferait varier la
    // teinte avec elle.
    expect(EDGE_GRADIENT_WGSL).toContain("3.0");
    expect(EDGE_GRADIENT_WGSL).toContain("10.0");
  });

  it("n'échantillonne PAS le tap central", () => {
    // Ses poids sont nuls dans les deux noyaux : l'échantillonner serait une
    // lecture payée pour être multipliée par zéro. Huit taps, pas neuf.
    const taps = EDGE_GRADIENT_WGSL.match(/edgeTap\(uv,/g) ?? [];
    expect(taps.length).toBe(8);
    // Et le décalage (0, 0) n'y figure pas : c'est LUI le tap central, et son
    // absence est ce qu'on vérifie. Compter huit appels ne suffirait pas — huit
    // taps dont un central serait un noyau différent, pas une économie.
    expect(EDGE_GRADIENT_WGSL).not.toMatch(/edgeTap\(uv, vec2<f32>\( *0\.0, *0\.0\)/);
  });

  it("expose la normalisation du noyau en constante partagée", () => {
    expect(SCHARR_NORM).toBe(32);
    expect(outlines.wgsl).toContain(`/ ${SCHARR_NORM}.0;`);
  });
});

describe("outlines — la fusion de coloredEdges n'a rien déplacé", () => {
  it("garde les NEUF premiers paramètres d'avant la fusion, dans l'ordre", () => {
    // C'est la garantie de compatibilité, et elle est structurelle : l'index
    // d'un paramètre est PERSISTÉ dans les presets, et les références de pixels
    // `effet-outlines` / `effet-outlines-bruit` doivent rester valables AU BIT.
    // Tout ce qui vient de `coloredEdges` est ajouté à la suite.
    expect(outlines.params.slice(0, 9).map((p) => p.name)).toEqual([
      "thickness", "threshold", "softness", "chroma",
      "inkHue", "inkSaturation", "inkLightness",
      "wash", "inputSource",
    ]);
  });

  it("a pour défaut l'ENCRE UNIQUE — le comportement historique", () => {
    // Si le défaut était la roue, la fusion aurait changé en silence le rendu de
    // tous les presets `outlines` existants et fait rougir ses deux références.
    const mode = outlines.params.find((p) => p.name === "inkMode");
    expect(mode?.default).toBe(0);
    expect(mode?.choices).toEqual(["Encre unique", "Roue d'orientation"]);
  });

  it("a pour fond par défaut le BLANC — le rendu d'avant, au bit près", () => {
    // `outlines` fondait vers `vec3(1.0)` en dur. Le fond devient une couleur,
    // et son défaut (teinte 0, saturation 0, luminosité 1) redonne exactement ce
    // blanc : `srgb_to_linear3(hsl2rgb(0, 0, 1))` vaut `vec3(1.0)`.
    const par = Object.fromEntries(outlines.params.map((p) => [p.name, p.default]));
    expect(par.backgroundHue).toBe(0);
    expect(par.backgroundSaturation).toBe(0);
    expect(par.backgroundLightness).toBe(1);
  });

  it("lit ses dix-neuf paramètres dans l'ordre exact où il les déclare", () => {
    expect(outlines.params.map((p) => p.name)).toEqual([
      "thickness", "threshold", "softness", "chroma",
      "inkHue", "inkSaturation", "inkLightness",
      "wash", "inputSource",
      "inkMode", "hueOffset", "hueSpread",
      "wheelChroma", "wheelLightness",
      "backgroundHue", "backgroundSaturation", "backgroundLightness",
      "detectMode", "fill",
    ]);
    expect(outlines.wgsl).toContain("edge_spacing(params[0])");
    expect(outlines.wgsl).toContain("let source = params[8];");
    expect(outlines.wgsl).toContain("let inkMode = i32(params[9] + 0.5);");
    expect(outlines.wgsl).toContain("params[14] / 360.0, params[15], params[16]");
    expect(outlines.wgsl).toContain("let detectMode = i32(params[17] + 0.5);");
    expect(outlines.wgsl).toContain("let fill = clamp(params[18], 0.0, 1.0);");
  });
});

describe("outlines — le seuil de forme, et pourquoi il rouvre « Luminance inversée »", () => {
  it("a pour défaut la CRÊTE DE GRADIENT — le comportement historique", () => {
    const mode = outlines.params.find((p) => p.name === "detectMode");
    expect(mode?.default).toBe(0);
    expect(mode?.choices).toEqual(["Crête de gradient", "Seuil de forme"]);
  });

  it("convertit l'écart au seuil en PIXELS par la pente mesurée sur l'écartement des taps", () => {
    // `toneMag` se lit comme « écart de pilote sur l'épaisseur du trait » (c'est
    // le sens du /32) : divisé par cette épaisseur, il donne la pente PAR PIXEL.
    // C'est ce qui donne un trait d'épaisseur constante — la doctrine
    // d'`isolines`, et ce qui sépare ce mode d'un posterize suivi d'un
    // détecteur, où la largeur suivrait la pente locale.
    expect(outlines.wgsl).toContain("let pentePx = max(toneMag / max(params[0], 0.5), 0.00001);");
    expect(outlines.wgsl).toContain("let distPx = abs(pilote - threshold) / pentePx;");
    expect(outlines.wgsl).toContain("let demi = max(params[0] * 0.5, 0.5);");
  });

  it("trace sur le pilote LISSÉ, et pas sur le pilote brut", () => {
    // CORRIGÉ LE JOUR MÊME, sur ce que la référence a montré à sa PREMIÈRE
    // exécution : sur le pilote brut, un bord franc rendait un trait POINTILLÉ
    // d'un pixel à 3 px demandés. Un échelon n'a aucune valeur intermédiaire,
    // donc son isoligne n'a nulle part où s'épaissir. Le pilote lissé a une
    // rampe large de l'écartement des taps.
    expect(outlines.wgsl).toContain("let pilote = g.moyenne;");
  });

  it("ne coûte AUCUN tap de plus que la crête", () => {
    // `g.moyenne` est la moyenne des huit taps déjà lus par `edge_scharr` :
    // huit lectures dans les deux modes de détection.
    expect(EDGE_GRADIENT_WGSL).toContain("g.moyenne = (tl.x + tc.x + tr.x + ml.x + mr.x + bl.x + bc.x + br.x) * 0.125;");
    const taps = outlines.wgsl.match(/textureSample\(srcTexture/g) ?? [];
    expect(taps.length).toBe(1); // celui d'`edgeTap`, dans le module partagé
  });

  it("n'utilise AUCUNE dérivée écran pour le seuil de forme", () => {
    // C'est le cœur du correctif, et il mérite d'être opposable : `fwidth` sur
    // un échelon ne mesure pas une pente, il explose — c'est ce qui écrasait la
    // distance calculée et rendait le trait pointillé. La seule dérivée écran
    // qui subsiste est celle de la CRÊTE (`fwidth(mag)`), où elle sert de
    // plancher d'antialiasing et non de mesure.
    const derivees = outlines.wgsl.match(/fwidth\(/g) ?? [];
    expect(derivees.length).toBe(1);
    expect(outlines.wgsl).toContain("fwidth(mag)");
    expect(outlines.wgsl).not.toContain("fwidth(pilote)");
  });

  it("ne remplit QUE dans le mode qui a un intérieur", () => {
    // Une crête n'a pas d'intérieur : le remplissage y serait un contrôle mort.
    expect(outlines.wgsl).toContain("if (detectMode != 0) {");
    // Même pente que le trait, donc même antialiasing : un remplissage à bord
    // franc trahirait le trait qui le borde.
    expect(outlines.wgsl).toContain("let dedans = smoothstep(-pentePx, pentePx, pilote - threshold);");
  });

  it("expose « Luminance inversée » en FIN de vocabulaire, pas au milieu", () => {
    // L'index est persisté : l'insérer à sa place « logique » (entre Luminance
    // et Alpha) aurait transformé tout calque réglé sur Alpha en Luminance
    // inversée, en silence.
    const src = outlines.params.find((p) => p.name === "inputSource");
    expect(src?.choices).toEqual(["Luminance", "Alpha", "Luminance inversée"]);
    expect(src?.max).toBe(2);
  });

  it("le remplissage est ce qui rend l'inversion PORTEUSE et non redondante", () => {
    // Sur un tracé de frontière seul, inverser revient à chercher l'isoligne au
    // niveau 1 − seuil : le contrôle serait redondant avec le curseur de seuil.
    // C'est le remplissage — la seule opération qui distingue les deux côtés —
    // qui le rend irremplaçable. Le lien est donc structurel, et ce test le
    // fige : `fill` doit exister, et son infobulle doit le DIRE, sans quoi
    // personne ne devinera pourquoi l'entrée a trois choix.
    const fill = outlines.params.find((p) => p.name === "fill");
    expect(fill).toBeDefined();
    expect(fill?.default).toBe(0); // neutre : le rendu d'avant est conservé
    expect(fill?.hint).toContain("Luminance inversée");
  });
});

describe("outlines — mode Roue : la teinte vient de l'ORIENTATION", () => {
  it("garde la direction du gradient, là où le mode Encre unique la jette", () => {
    expect(outlines.wgsl).toContain("let turns = atan2(dirVec.y, dirVec.x) / 6.283185307179586;");
  });

  it("referme le cercle des teintes avec fract", () => {
    // Sans lui, les bords orientés à 180° porteraient une couture, là où la
    // rampe de teinte sauterait d'un bout à l'autre de la roue.
    expect(outlines.wgsl).toContain("let hue = fract(params[10] / 360.0 + turns * clamp(params[11], 0.05, 1.0));");
  });

  it("fait entrer la chromaticité dans l'ORIENTATION, pas seulement dans la magnitude", () => {
    // Sur un contour isoluminant, le gradient de ton est nul et sa direction
    // serait du bruit : la teinte scintillerait pixel à pixel.
    expect(outlines.wgsl).toContain("let gChroma = vec2<f32>(gx.y + gx.z, gy.y + gy.z);");
    expect(outlines.wgsl).toContain("let dirVec = gTone + chroma * 3.0 * gChroma;");
  });

  it("pèse la chromaticité du MÊME facteur dans les deux usages", () => {
    // Un seul curseur pour une seule notion : deux facteurs différents
    // rendraient le réglage illisible (le contour se lèverait sans que sa teinte
    // suive, ou l'inverse).
    expect(outlines.wgsl).toContain("let mag = max(toneMag, chroma * 3.0 * chromaMag);");
    expect(outlines.wgsl).toContain("chroma * 3.0 * gChroma");
  });

  it("construit la couleur du contour en OKLCH, pas en HSL", () => {
    // Correctif du 2026-08-02 : en HSL, un unique curseur `Clarté` faisait
    // balayer 0,290 à la clarté PERÇUE selon la seule orientation du bord (bleu
    // 0,534, vert-jaune 0,883). En OKLCH, 0,018 — seize fois moins.
    expect(outlines.wgsl).toContain("oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(");
    expect(outlines.wgsl).not.toContain("hsl2rgb(hue,");
  });

  it("borne le chroma au gamut sRGB — sinon l'écrêtage rendrait la roue irrégulière par le bas", () => {
    // `oklab_to_linear_srgb` ne borne rien (choix documenté d'`oklab.ts` :
    // l'écrêtage appartient à la cible), donc une valeur plus haute ramènerait
    // les teintes néon que la refonte OKLCH vient de retirer.
    expect(outlines.wgsl).toContain("* 0.3");
  });

  it("borne l'étendue des teintes au-dessus de zéro", () => {
    const spread = outlines.params.find((p) => p.name === "hueSpread");
    expect(spread?.min).toBe(0.05);
    expect(outlines.wgsl).toContain("clamp(params[11], 0.05, 1.0)");
  });
});

describe("outlines — la bascule et le flux de contrôle", () => {
  it("garde le plancher fwidth, et rend la bascule RELATIVE au seuil", () => {
    // Corrigé le 2026-08-03 sur les DEUX effets d'origine : `softness * 0.5`
    // valait 0,175 au défaut quand un contour franc ne produit qu'un `mag` de
    // 0,16 — la rampe était plus large que tout le signal utile, donc aucun
    // contour n'atteignait l'encre pleine.
    expect(outlines.wgsl).toContain(
      "let band = max(max(softness * max(threshold, 0.02), fwidth(mag)), 0.0005);",
    );
  });

  it("calcule fwidth AVANT la branche de mode (flux de contrôle uniforme)", () => {
    // Une dérivée écran exige un flux de contrôle uniforme. Le branchement sur
    // `inkMode` est lui-même uniforme (il vient d'un uniforme), mais placer
    // `fwidth` dedans serait fragile à la première refonte — et un contour
    // COLORÉ crénelé serait deux fois plus visible qu'un noir, puisque
    // l'escalier y changerait aussi de teinte.
    const posFwidth = outlines.wgsl.indexOf("fwidth(mag)");
    const posBranch = outlines.wgsl.indexOf("if (inkMode ==");
    expect(posFwidth).toBeGreaterThan(0);
    expect(posBranch).toBeGreaterThan(posFwidth);
  });
});

describe("outlines — registre", () => {
  it("est enregistré, et `coloredEdges` ne l'est plus", () => {
    expect(getEffect("outlines")).toBe(outlines);
    expect(effectRegistry).toContain(outlines);
    // Le retrait est CONSCIENT : réintroduire l'id demande de supprimer cette
    // ligne, donc de relire pourquoi il est parti.
    expect(effectRegistry.some((e) => e.id === "coloredEdges")).toBe(false);
    expect(() => getEffect("coloredEdges")).toThrow();
  });

  it("précède `echoOutlines`, qui reste un effet à part", () => {
    // Les deux répondent à des questions différentes — « où l'image
    // change-t-elle ? » contre « à quelle DISTANCE de la forme suis-je ? ». La
    // fusion des deux est décidée mais BLOQUÉE sur une capacité du pipeline :
    // `echoOutlines` porte neuf passes de pyramide, `outlines` une seule, et
    // `runInternalPasses` les exécute sans condition.
    expect(echoOutlines.passes?.length).toBe(9);
    expect(outlines.passes).toBeUndefined();
    const ids = effectRegistry.map((e) => e.id);
    expect(ids.indexOf("outlines")).toBeLessThan(ids.indexOf("echoOutlines"));
  });
});

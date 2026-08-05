import { describe, it, expect } from "vitest";
import { outlines } from "../../../src/render/effects/outlines";
import { EDGE_GRADIENT_WGSL, SCHARR_NORM } from "../../../src/render/effects/edgeGradient";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { MAX_EFFECT_PARAMS } from "../../../src/render/shaderCompose";
import type { DisplayCondition } from "../../../src/render/effects/types";
import { conditionRemplie } from "../../../src/render/effects/displayCondition";

/** CE FICHIER S'APPELAIT `coloredEdges.test.ts` jusqu'au 2026-08-03.
 *
 *  `coloredEdges` a été absorbé par `outlines` (arbitrage d'Antoine) : ce qui
 *  les séparait — jeter la direction du gradient, ou en faire une teinte — est
 *  devenu le paramètre `inkMode`. Les assertions n'ont pas été supprimées avec
 *  l'effet, elles ont été REPORTÉES sur le mode qui porte désormais la
 *  propriété. Même geste que pour `posterize` -> `dither` le même jour, et pour
 *  la même raison : une propriété rangée dans le fichier d'un effet disparaît
 *  avec lui, en silence.
 *
 *  `echoOutlines` a suivi le même soir (ADR-0015) et il n'avait, lui, AUCUN
 *  fichier de test — ses propriétés ne vivaient que dans son en-tête et dans sa
 *  référence de pixels. Les deux ont donc été rapatriées ici plutôt que perdues
 *  avec le fichier : le prédicat des neuf passes ci-dessous, et la mesure
 *  d'équidistance des anneaux dans `test/scripts/renderRefs.test.mjs`. */

describe("edgeGradient — le détecteur partagé", () => {
  it("est inclus par le seul effet de contour qui reste", () => {
    // Le module est resté PARTAGÉ jusqu'à ce qu'il n'y ait plus qu'un lecteur :
    // deux copies du noyau auraient dérivé, et deux effets de contour posés sur
    // la même photo auraient dessiné des bords à des endroits DIFFÉRENTS — ce
    // qui ressemble à un choix esthétique et n'est qu'un copier-coller qui a
    // vieilli. Il vaut d'être gardé tel quel : le prochain effet qui aura besoin
    // d'un gradient isotrope le trouvera écrit et mesuré.
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

  it("lit ses vingt-six paramètres dans l'ordre exact où il les déclare", () => {
    // Les DIX-NEUF premiers sont ceux d'avant l'absorption d'`echoOutlines`, et
    // c'est la même garantie qu'au-dessus, une couche plus loin : sept
    // références de pixels en dépendent, plus les presets.
    expect(outlines.params.map((p) => p.name)).toEqual([
      "thickness", "threshold", "softness", "chroma",
      "inkHue", "inkSaturation", "inkLightness",
      "wash", "inputSource",
      "inkMode", "hueOffset", "hueSpread",
      "wheelChroma", "wheelLightness",
      "backgroundHue", "backgroundSaturation", "backgroundLightness",
      "detectMode", "fill",
      "smoothing", "spacing", "echoCount", "falloff",
      "endHue", "endSaturation", "endLightness",
    ]);
    expect(outlines.wgsl).toContain("edge_spacing(params[0])");
    expect(outlines.wgsl).toContain("let source = params[8];");
    expect(outlines.wgsl).toContain("let inkMode = i32(params[9] + 0.5);");
    expect(outlines.wgsl).toContain("params[14] / 360.0, params[15], params[16]");
    expect(outlines.wgsl).toContain("let detectMode = i32(params[17] + 0.5);");
    expect(outlines.wgsl).toContain("let fill = clamp(params[18], 0.0, 1.0);");
    // Le lissage est lu par la REMONTÉE pyramidale, pas par le corps final :
    // c'est le seul index que le shader principal ne cite jamais, et c'est
    // exactement pour ça qu'`upsampleWgsl` le reçoit en argument au lieu de le
    // coder en dur.
    expect(outlines.passes?.some((p) => p.wgsl.includes("params[19]"))).toBe(true);
    expect(outlines.wgsl).toContain("params[23] / 360.0, params[24], params[25]");
  });

  it("reste sous le plafond partagé élargi pour la tranche Courbes", () => {
    // Le plafond est passé de 24 à 32 pour cette absorption. La marge visée à
    // chaque élargissement depuis 2026-07-31 est la même : ~6 slots au-dessus
    // du plus gourmand. Ce test la rend visible plutôt que déclarative.
    expect(outlines.params.length).toBe(26);
    expect(MAX_EFFECT_PARAMS - outlines.params.length).toBe(22);
  });
});

describe("outlines — le seuil de forme, et pourquoi il rouvre « Luminance inversée »", () => {
  it("a pour défaut la CRÊTE DE GRADIENT — le comportement historique", () => {
    const mode = outlines.params.find((p) => p.name === "detectMode");
    expect(mode?.default).toBe(0);
    expect(mode?.choices).toEqual(["Crête de gradient", "Seuil de forme", "Échos de la forme"]);
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

  it("a absorbé `echoOutlines`, dont l'id ne résout plus", () => {
    // Même garde que pour `coloredEdges` juste au-dessus, et pour la même
    // raison : le retrait doit rester CONSCIENT. Réintroduire l'id demande de
    // supprimer cette ligne, donc de relire ADR-0015.
    expect(effectRegistry.some((e) => e.id === "echoOutlines")).toBe(false);
    expect(() => getEffect("echoOutlines")).toThrow();
  });

  it("porte les neuf passes de pyramide, toutes conditionnées au mode Échos", () => {
    // C'EST LA CONDITION QUI A DÉBLOQUÉ LA FUSION, donc la chose à verrouiller.
    // Sans le prédicat, les deux modes locaux paieraient une chaîne complète
    // dont ils ne lisent pas un texel — sur 24 Mpx la seule cible à 0,5 pèse
    // 24 Mo, et la VRAM est un risque ouvert.
    expect(outlines.passes).toHaveLength(9);
    const defauts: Record<string, number> = {};
    for (const p of outlines.params) defauts[p.name] = p.default;
    // Au défaut (Crête de gradient), aucune passe ne tourne.
    expect(outlines.passes!.every((p) => p.enabled?.(defauts) === false)).toBe(true);
    // En Seuil de forme non plus : c'est un opérateur LOCAL, pas une pyramide.
    expect(outlines.passes!.every((p) => p.enabled?.({ ...defauts, detectMode: 1 }) === false)).toBe(true);
    // En Échos, les neuf.
    expect(outlines.passes!.every((p) => p.enabled?.({ ...defauts, detectMode: 2 }) === true)).toBe(true);
  });

  it("borne son seuil sur toute l'échelle des tons, pas sur 0,6", () => {
    // DÉFAUT RÉEL, trouvé en préparant l'absorption. Les deux scénarios de rendu
    // du Seuil de forme verrouillaient `threshold: 0.8` — `updateParams` ne
    // borne pas, mais `ParamPanel` borne le curseur à `param.max`, qui valait
    // 0,6. Les références figeaient donc un rendu INACCESSIBLE depuis
    // l'interface. Le plafond était calibré pour un CONTRASTE minimal ; il n'a
    // plus de sens depuis qu'il sert aussi de NIVEAU de seuillage.
    const seuil = outlines.params.find((p) => p.name === "threshold");
    expect(seuil?.max).toBe(1);
  });
});

describe("outlines — les contrôles suivent le mode (2026-08-05)", () => {
  const parNom = new Map(outlines.params.map((p) => [p.name, p]));
  const defauts: Record<string, number> = {};
  for (const p of outlines.params) defauts[p.name] = p.default;

  /** Les onze verdicts de la campagne du 2026-08-05, transcrits. Un `appliesWhen`
   *  de plus ou de moins doit faire rougir ce test : c'est la seule chose qui
   *  rattache le masquage à une MESURE plutôt qu'à une intuition. */
  const MESURÉS: Record<string, DisplayCondition> = {
    chroma: { param: "inputSource", equals: [0, 2] },
    inkMode: { param: "detectMode", equals: [0, 1] },
    hueOffset: { param: "inkMode", equals: 1 },
    hueSpread: { param: "inkMode", equals: 1 },
    wheelChroma: { param: "inkMode", equals: 1 },
    wheelLightness: { param: "inkMode", equals: 1 },
    fill: { param: "detectMode", equals: [1, 2] },
    smoothing: { param: "detectMode", equals: 2 },
    spacing: { param: "detectMode", equals: 2 },
    echoCount: { param: "detectMode", equals: 2 },
    falloff: { param: "detectMode", equals: 2 },
  };

  it("porte les onze déclarations éprouvées, et AUCUNE de plus", () => {
    // « Aucune de plus » est la moitié utile de l'assertion : masquer un curseur
    // ne fait bouger aucun pixel, donc aucune référence de rendu ne peut voir un
    // masquage ajouté au jugement. C'est exactement le scénario que la campagne
    // de mesure existait pour empêcher — et qui a effectivement attrapé une
    // déclaration FAUSSE sur `glass.flat`, un curseur qui déplace la moitié de
    // l'image et que son infobulle disait sans objet.
    const portés = outlines.params.filter((p) => p.appliesWhen).map((p) => p.name);
    expect(portés.sort()).toEqual(Object.keys(MESURÉS).sort());
    for (const [nom, condition] of Object.entries(MESURÉS)) {
      expect(parNom.get(nom)?.appliesWhen).toEqual(condition);
    }
  });

  it("garde les onze infobulles — masquer dit QUE, l'infobulle dit POURQUOI", () => {
    // Porter une déclaration vers `appliesWhen` n'autorise pas à retirer le
    // `hint` : un contrôle absent n'explique rien, et l'utilisateur qui le
    // retrouve en changeant de mode a toujours besoin de savoir ce qu'il fait.
    for (const nom of Object.keys(MESURÉS)) {
      expect(parNom.get(nom)?.hint).toBeTruthy();
    }
  });

  it("ne vise que des paramètres à CHOIX, jamais un seuil sur un curseur", () => {
    // Un seuil sur une valeur continue serait une décision d'affichage cachée
    // dans un nombre, que ni `validateEffect` ni un relecteur ne pourraient
    // rattacher à ce qui la commande. `validateEffect` l'interdit ; ce test le
    // rend visible depuis le fichier de l'effet.
    for (const condition of Object.values(MESURÉS)) {
      expect(parNom.get(condition.param)?.choices).toBeDefined();
    }
  });

  it("range ses vingt-six paramètres, chacun dans une seule section", () => {
    // `validateEffect` interdit qu'un paramètre soit cité DEUX fois ; il
    // n'exige pas qu'il soit cité. Ce test-ci ferme l'autre bord : ajouter un
    // paramètre à cet effet oblige à décider où il se range, au lieu de le
    // laisser tomber en dehors des trois sections sans que rien ne le dise.
    const cités = outlines.sections!.flatMap((s) => s.params);
    expect(cités.length).toBe(26);
    expect([...cités].sort()).toEqual(outlines.params.map((p) => p.name).sort());
  });

  it("ne coupe aucun groupe de couleur en deux sections", () => {
    // `ParamPanel` ancre un groupe de couleur à l'index de son PREMIER membre et
    // rend les trois rôles en un seul contrôle. Une section qui n'en citerait
    // que deux ne déplacerait pas le contrôle, elle le casserait — et le garde
    // de `groupEffectParams` ne lève que sur un groupe incomplet dans TOUT
    // l'effet, pas sur un groupe éclaté entre deux sections.
    const sectionDe = new Map<string, string>();
    for (const section of outlines.sections!) {
      for (const nom of section.params) sectionDe.set(nom, section.id);
    }
    const parClé = new Map<string, Set<string>>();
    for (const p of outlines.params) {
      if (!p.colorGroup) continue;
      const vues = parClé.get(p.colorGroup.key) ?? new Set<string>();
      vues.add(sectionDe.get(p.name)!);
      parClé.set(p.colorGroup.key, vues);
    }
    expect([...parClé.keys()].sort()).toEqual(["background", "dernierEcho", "ink"]);
    for (const [, sections] of parClé) expect(sections.size).toBe(1);
  });

  it("fait de la section Échos le MIROIR du prédicat des neuf passes", () => {
    // LE POINT DE CE CHANTIER SUR CET EFFET. Le contrat de COÛT existait déjà —
    // les neuf passes ne tournent qu'en Échos. Le contrat d'AFFICHAGE dit
    // désormais la même chose au même moment, et les deux sont dérivés d'une
    // SEULE déclaration dans le fichier de l'effet. Deux copies d'un même
    // prédicat ne divergeraient pas bruyamment : une section restée visible là
    // où la pyramide ne tourne plus afficherait des curseurs qui ne peuvent
    // rien, sans qu'aucun test de rendu ne bronche.
    //
    // La condition est évaluée par `conditionRemplie` — l'évaluateur que le
    // panneau utilisera — et non par une copie locale : ce qui est comparé ici
    // est ce qui S'AFFICHERA, face au prédicat que les passes portent de leur
    // côté. Deux mécanismes distincts, donc une vraie mesure d'accord.
    const échos = outlines.sections!.find((s) => s.id === "echos");
    expect(échos?.appliesWhen).toBeDefined();
    for (const mode of [0, 1, 2]) {
      const params = { ...defauts, detectMode: mode };
      const passesTournent = outlines.passes!.every((p) => p.enabled!(params));
      expect(conditionRemplie(échos!.appliesWhen!, params)).toBe(passesTournent);
    }
  });

  it("ne masque QUE l'affichage : ni le shader ni les bornes ne bougent", () => {
    // Masquer ne borne rien. La valeur reste dans le calque, part telle quelle
    // dans les presets, et le shader continue de la lire — un preset écrit à la
    // main ou un `updateParams` programmatique ne passent pas par le panneau.
    // Les clamps des quatre réglages d'échos restent donc dans le corps final.
    expect(outlines.wgsl).toContain("let spacing = max(params[20], 1.0);");
    expect(outlines.wgsl).toContain("let count = max(params[21], 1.0);");
    expect(outlines.wgsl).toContain("let falloff = clamp(params[22], 0.0, 1.0);");
    expect(outlines.wgsl).toContain("let fill = clamp(params[18], 0.0, 1.0);");
  });
});

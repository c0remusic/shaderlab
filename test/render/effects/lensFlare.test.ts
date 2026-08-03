import { describe, it, expect } from "vitest";
import { lensFlare } from "../../../src/render/effects/lensFlare";
import { apertureRadiusSpec, APERTURE_WGSL } from "../../../src/render/effects/aperture";
import { lensBlur } from "../../../src/render/effects/lensBlur";
import { UV_SPACE_WGSL } from "../../../src/render/effects/uvSpace";
import { getEffect, effectRegistry } from "../../../src/render/effects/registry";

/**
 * LENS FLARE — et ce fichier garde surtout les TROIS géométries fausses qui ont
 * précédé la bonne. Les trois compilaient, les trois rendaient quelque chose, et
 * aucune n'aurait été trahie par un test unitaire écrit après coup : ce sont les
 * références de pixels qui les ont montrées, une par une.
 */

const wgsl = lensFlare.wgsl;
const passes = lensFlare.passes ?? [];

describe("lensFlare — le diaphragme est PARTAGÉ, pas recopié", () => {
  it("lit le même rayon d'ouverture que `lensBlur`", () => {
    // Extrait dans `effects/aperture.ts` le jour où ce second consommateur est
    // arrivé. Ici la conséquence d'une copie serait pire qu'ailleurs : le
    // nombre de lames est la SIGNATURE d'un objectif, et deux effets posés sur
    // la même photo qui rendraient un hexagone de bokeh et un heptagone de
    // fantôme ne seraient pas approximativement justes — un objectif n'a qu'un
    // diaphragme.
    expect(lensFlare.passes?.[0].wgsl).toContain(APERTURE_WGSL.trim());
    // ⚠️ Côté `lensBlur`, le diaphragme vit dans une PASSE INTERNE (la collecte)
    // et pas dans son composite : c'est là que la spirale d'ouverture s'en sert.
    // Chercher dans `lensBlur.wgsl` ne trouve rien, et le test passerait pour un
    // défaut de partage alors que le partage est bien là.
    expect(lensBlur.passes?.some((p) => p.wgsl.includes(APERTURE_WGSL.trim()))).toBe(true);
  });

  it("garde le polygone INSCRIT, pas circonscrit", () => {
    // Le seul endroit où l'erreur passerait pour une intention : un polygone
    // circonscrit rendrait des fantômes plus GROS que le rayon réglé.
    //
    // À rotation nulle, `theta = 0` tombe sur un SOMMET (rayon 1) et `pi/n` au
    // milieu d'une arête (rayon cos(pi/n)) — le repli de `k` est centré sur le
    // milieu d'arête, donc décalé d'un demi-secteur. Écrit ici parce que je
    // l'avais posé à l'envers du premier coup.
    const n = 6;
    expect(apertureRadiusSpec(0, n, 0)).toBeCloseTo(1, 6);
    expect(apertureRadiusSpec(Math.PI / n, n, 0)).toBeCloseTo(Math.cos(Math.PI / n), 6);
    // Sous trois lames il n'y a pas de polygone : le diaphragme est circulaire.
    expect(apertureRadiusSpec(1.234, 2, 0)).toBe(1);
  });
});

describe("lensFlare — les trois géométries fausses, et pourquoi elles paraissaient bonnes", () => {
  it("lit les fantômes à distance PROPORTIONNELLE, jamais à pas fixe", () => {
    // Un fantôme est la source réfléchie entre deux faces : il tombe sur la
    // droite source-centre, de l'autre côté, à une distance qui dépend du
    // couple de faces. On ne peut pas le DESSINER (il faudrait connaître toutes
    // les sources), on le LIT — d'où l'échelle négative appliquée à l'écart au
    // centre.
    expect(wgsl).toContain("let s = -1.0 - f32(i) * espacement;");
    expect(wgsl).toContain("let uvS = centre + (uv - centre) * s;");
  });

  it("somme l'anneau AZIMUTALEMENT — sinon c'est un arc, pas un anneau", () => {
    // DEUXIÈME géométrie fausse. Lire le point diamétralement opposé donne bien
    // le même point à tous les pixels d'un même rayon, mais seul le SECTEUR
    // face à la source s'allume : les autres angles ne trouvent rien. L'image
    // l'a montré — un arc en bas à droite, pas un anneau.
    //
    // Un anneau demande que chaque point du tour connaisse l'énergie de TOUT le
    // tour. Huit prélèvements réguliers sur le cercle, leur moyenne peinte sur
    // l'anneau entier.
    expect(wgsl).toContain("for (var k = 0; k < 8; k = k + 1) {");
    expect(wgsl).toContain("energie = energie * 0.125;");
    // Le cercle est centré sur le CENTRE DU CADRE, et c'est le fait optique qui
    // sépare cet anneau d'un halo de diffusion : une face sphérique renvoie sur
    // l'axe, pas sur la source.
    expect(wgsl).toContain("flare_lire(centre + (vec2<f32>(cos(a), sin(a)) * rayon) / ar)");
  });

  it("atténue les fantômes LINÉAIREMENT vers les bords, pas au carré", () => {
    // TROISIÈME. Au carré, le fantôme d'indice 0 — le miroir exact de la source,
    // donc celui qui SIGNE le flare — tombait à 19 % quand les suivants, plus
    // près de l'axe, passaient devant. La chaîne se lisait à l'envers.
    expect(wgsl).toContain("let att = clamp(1.0 - dCentre / dMax, 0.0, 1.0);");
    expect(wgsl).not.toContain("dCentre / dMax, 0.0, 1.0), 2.0)");
  });

  it("ne replie PAS ses lectures hors cadre, contrairement au reste du dossier", () => {
    // Un fantôme lit très loin du pixel courant — c'est sa définition. `mirrorUv`
    // ferait alors RÉAPPARAÎTRE une source réelle par réflexion sur le bord,
    // donc un fantôme de fantôme, à un endroit qu'aucune optique ne justifie.
    // Hors du champ seuillé il n'y a pas de lumière, et le noir le dit.
    expect(wgsl).toContain("return vec3<f32>(0.0);");
    // `mirrorUv` est DÉFINI dans le composite — `UV_SPACE_WGSL` y est inclus
    // pour `aspectScale` — et NOMMÉ dans un commentaire qui explique justement
    // pourquoi on ne l'appelle pas. Compter le nom seul rendrait donc un test
    // qui rougit dès qu'on documente. On compte les APPELS, c'est-à-dire les
    // occurrences suivies d'une parenthèse : celle de la signature, et rien
    // de plus.
    const appels = (s: string) => (s.match(/mirrorUv\(/g) ?? []).length;
    expect(appels(wgsl)).toBe(appels(UV_SPACE_WGSL));
  });
});

describe("lensFlare — la source posée et la source automatique sont UNE machinerie", () => {
  it("injecte le lobe DANS la passe de seuillage", () => {
    // C'est ce qui évite d'écrire deux fois. Tout l'aval traite le lobe comme
    // n'importe quelle haute lumière — et comme il porte la forme du diaphragme,
    // ses copies l'héritent sans qu'aucun polygone ne soit dessiné plus bas.
    const bright = passes[0].wgsl;
    expect(bright).toContain("aperture_radius(theta, params[6], radians(params[7]))");
    expect(bright).toContain("bright = bright + vec3<f32>(intensite * lobe * lobe);");
  });

  it("expose la source comme un MANIPULATEUR sur la toile", () => {
    // L'ADR de `pixelStretch` dit pourquoi une position ne se règle pas aux
    // curseurs. Les bornes débordent le cadre à dessein : une source de flare
    // est le plus souvent HORS champ.
    expect(lensFlare.canvasRegion).toEqual({ centerX: "sourceX", centerY: "sourceY", radius: "sourceRadius" });
    const x = lensFlare.params.find((p) => p.name === "sourceX");
    expect([x?.min, x?.max]).toEqual([-0.5, 1.5]);
  });

  it("laisse la source posée ÉTEINTE par défaut", () => {
    // Sinon poser l'effet peindrait un soleil que personne n'a demandé. Au
    // défaut, le flare ne part que des hautes lumières de la photo.
    expect(lensFlare.params.find((p) => p.name === "sourceIntensity")?.default).toBe(0);
  });

  it("donne au lobe un rayon par défaut qui SURVIT au lissage", () => {
    // Sous ~0,08 le lobe est plus petit que le niveau le plus grossier de la
    // pyramide, et ses arêtes n'y survivent pas : les fantômes sortent ronds,
    // ce qui vide de son sens toute la mécanique d'injection. Trouvé sur pièce.
    expect(lensFlare.params.find((p) => p.name === "sourceRadius")?.default).toBeGreaterThanOrEqual(0.08);
  });
});

describe("lensFlare — le coût, et la garde qui va avec", () => {
  it("porte CINQ passes et non sept — un fantôme n'est pas un bloom", () => {
    // Corrigé sur pièce : à quatre niveaux la chaîne descend au 1/16 et un lobe
    // de diaphragme n'y survit pas. Différence de NATURE avec `glow`, dont le
    // halo EST un flou : ici la pyramide ne sert qu'à ne pas créneler quand le
    // fantôme rétrécit.
    expect(passes).toHaveLength(5);
    expect(passes.map((p) => p.scale)).toEqual([0.5, 0.25, 0.125, 0.25, 0.5]);
  });

  it("saute ses cinq passes quand les trois contributions sont nulles", () => {
    const defauts: Record<string, number> = {};
    for (const p of lensFlare.params) defauts[p.name] = p.default;
    expect(passes.every((p) => p.enabled?.(defauts) === true)).toBe(true);
    const eteint = { ...defauts, ghostIntensity: 0, haloIntensity: 0, veil: 0 };
    expect(passes.every((p) => p.enabled?.(eteint) === false)).toBe(true);
  });

  it("porte le MÊME prédicat en sortie anticipée du composite", () => {
    // ⚠️ CONDITION DE CORRECTION, pas optimisation. Quand les passes sautent,
    // `prevPass` reçoit la texture SOURCE : sans cette sortie, l'effet lirait
    // l'image en croyant lire son champ de hautes lumières, et l'ajouterait à
    // elle-même. C'est l'avertissement porté par `EffectPass.enabled`, et c'est
    // le premier effet du dépôt où il mord.
    expect(wgsl).toContain("if (ghostIntensity <= 0.0 && haloIntensity <= 0.0 && veil <= 0.0) {");
    expect(wgsl).toContain("return color;");
  });
});

describe("lensFlare — ce qui le sépare d'un glow", () => {
  it("compose en ADDITIF, jamais en mélange", () => {
    // Une lumière parasite s'ajoute, elle ne remplace rien. Un flare composé en
    // `mix` masquerait l'image sous lui — le rendu « calque de flare posé
    // par-dessus » que cet effet doit éviter.
    expect(wgsl).toContain("return vec4<f32>(color.rgb + flare, color.a);");
  });

  it("fait du voile une lumière SCALAIRE teintée, pas une copie floutée", () => {
    // Toute la différence : un glow ajoute la couleur LOCALE et redessine les
    // formes en plus clair ; le voile ajoute une lumière uniforme dont seule la
    // QUANTITÉ suit la lumière parasite, et remonte les noirs sans que rien de
    // nouveau n'apparaisse.
    expect(wgsl).toContain("let energie = dot(flare_lire(uv), FLARE_LUMA);");
    expect(wgsl).toContain("flare = flare + teinteRvb * energie * veil;");
  });

  it("fait dériver la teinte de la chaîne en OKLCH", () => {
    // Par permutation de canaux — l'astuce habituelle — la CLARTÉ varierait avec
    // la teinte et la chaîne clignoterait du clair au sombre sous un curseur
    // censé ne régler que la couleur. Même mesure que la roue d'`outlines` :
    // 0,290 d'étendue de clarté perçue sur un tour.
    expect(wgsl).toContain("oklab_to_oklch(linear_srgb_to_oklab(teinteRvb))");
    expect(wgsl).toContain("fract(teinteLch.z + derive * t)");
  });
});

describe("lensFlare — sa place au registre", () => {
  it("rouvre la famille des HALOS à trois, et pas celle de lensDistortion", () => {
    // Un flare n'est pas une DÉFORMATION — l'image derrière ne bouge pas d'un
    // pixel — c'est de la lumière AJOUTÉE. Il répond donc à « que renvoie
    // l'objectif », comme `glow` et `halation`, et non à « que déforme sa
    // forme ». La clôture de la famille à deux portait sur un découpage
    // diffusion / réexposition film ; une RÉFLEXION n'est ni l'un ni l'autre.
    expect(getEffect("lensFlare")).toBe(lensFlare);
    const ids = effectRegistry.map((e) => e.id);
    expect(ids.indexOf("glow")).toBeLessThan(ids.indexOf("lensFlare"));
    expect(ids.indexOf("halation")).toBeLessThan(ids.indexOf("lensFlare"));
    expect(ids.indexOf("lensFlare")).toBeLessThan(ids.indexOf("lensDistortion"));
  });
});

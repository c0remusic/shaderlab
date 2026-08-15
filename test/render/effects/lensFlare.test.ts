import { describe, it, expect } from "vitest";
import { lensFlare, dessinActif } from "../../../src/render/effects/lensFlare";
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
    // ⚠️ Côté `lensFlare` le diaphragme vit dans le COMPOSITE et non dans une
    // passe : depuis que les fantômes de la source posée sont DESSINÉS, c'est là
    // que la forme de l'ouverture sert. Il a vécu dans la passe de seuillage
    // tant qu'un lobe y était injecté ; ce lobe a été déposé.
    expect(wgsl).toContain(APERTURE_WGSL.trim());
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
  it("N'INJECTE PLUS rien dans la passe de seuillage", () => {
    // LE CHEMIN S'EST TROMPÉ TROIS FOIS AVANT D'ARRIVER LÀ, et c'est ce que ce
    // test garde. Tant que fantômes, anneau et voile étaient tous PRÉLEVÉS dans
    // le même champ, il fallait y injecter la source posée. Une fois les
    // fantômes dessinés, ce lobe produisait EN DOUBLE des fantômes prélevés au
    // même endroit et les empâtait. Trois dosages ont été essayés (pleine force,
    // 0,3, 0,08) : aucun ne réglait à la fois l'empâtement et l'effondrement de
    // l'anneau, parce que ce n'était pas un problème de dosage mais de RÔLE.
    //
    // La sortie a été de passer AUSSI l'anneau et le voile en analytique. Le
    // champ ne contient donc plus que les hautes lumières réelles.
    //
    // ⚠️ On assère l'absence du CODE, pas du MOT : le commentaire de la passe
    // explique justement la dépose, donc il contient « lobe ». Chercher le mot
    // ferait rougir le test dès qu'on documente — deuxième fois que ce piège se
    // pose dans ce fichier, après celui de `mirrorUv`.
    const bright = passes[0].wgsl;
    expect(bright).not.toContain("aperture_radius(");
    expect(bright).not.toMatch(/let lobe =/);
    expect(bright).not.toMatch(/bright = bright \+/);
    expect(bright).toContain("return vec4<f32>(color.rgb * (e * e), 1.0);");
  });

  it("dessine ses fantômes depuis la POSITION, donc sans lire de texture", () => {
    // Hullin & al. : un fantôme est « a deformed image of the aperture opening ».
    // Une image de l'OUVERTURE, pas de la source — un prélèvement dans les
    // hautes lumières ne peut donc pas en produire.
    expect(wgsl).toContain("fn ghost_cover(");
    expect(wgsl).toContain("let cover = ghost_cover(p, rayon, versAxe, mordu, douceur);");
  });

  it("coupe le fantôme par un DEMI-PLAN, jamais par un second disque", () => {
    // VERDICT D'USAGE, ET IL EST GÉOMÉTRIQUEMENT IMPARABLE. La première écriture
    // modélisait le fût par un second DISQUE décalé — or l'intersection de deux
    // disques EST une ellipse. « J'aime les fantômes mais pas les ellipses »
    // désignait exactement ça, et aucun réglage d'un disque n'y pouvait rien.
    //
    // Un demi-plan coupe par une DROITE : il reste un polygone à un côté de
    // moins, ce que montrent les photographies de fantômes vignettés.
    expect(wgsl).toContain("let t = dot(p, -versAxe) / max(rayon, 1e-6);");
    expect(wgsl).toContain("let ligne = 1.0 - 2.0 * decoupe;");
    expect(wgsl).toContain("let plein = dansPoly * dansCoupe;");
    // La part mangée croît avec l'éloignement de l'axe : au centre le fût est vu
    // de face et ne mange rien.
    expect(wgsl).toContain("let mordu = decoupe * clamp(dG / dMax, 0.0, 1.0) * 1.5;");
  });

  it("remplit ses fantômes par défaut — une chaîne d'anneaux est un MOTIF", () => {
    // Second verdict d'usage : « l'anneau unique est sympa, c'est plutôt les
    // anneaux en série que je n'aime pas ». La nuance est fine et juste — un
    // anneau creux est le bon rendu pour UN artefact isolé (la famille
    // « anneau » le garde), mais répété cinq fois le long d'un axe il devient un
    // motif, et un motif trahit la synthèse.
    expect(lensFlare.params.find((p) => p.name === "ghostFill")?.default).toBe(0.8);
    expect(wgsl).toContain("let encre = mix(cover.y, cover.x + cover.y * 0.35, remplissage);");
  });

  it("porte la PLUME, et c'est le cœur de l'effet depuis les photos d'Antoine", () => {
    // Cinq photographies prises avec son propre matériel ne montraient NI
    // chapelet NI anneau — toutes la même plume large, fortement teintée et
    // coupée droit. C'est de la diffusion rasante dans le fût, pas de la
    // réflexion entre faces polies.
    expect(lensFlare.params.find((p) => p.name === "plume")?.default).toBe(1);
    // Un CÔNE : la largeur croît le long de l'axe. Un lobe rond ne peut pas.
    expect(wgsl).toContain("let largeur = longueur * (0.08 + evase * clamp(le / longueur, 0.0, 2.0) * 0.6);");
    // Chute latérale GAUSSIENNE : une bascule donnerait deux bords francs sur
    // les côtés et la plume se lirait comme un faisceau de projecteur.
    expect(wgsl).toContain("let lat = exp(-(tr / largeur) * (tr / largeur) * 2.5);");
    // Le SEUL bord franc de l'effet est la coupe, et il est transversal.
    expect(wgsl).toContain("let coupe = smoothstep(0.0, 0.03 * longueur, le - clamp(params[29], 0.0, 1.0) * longueur);");
  });

  it("laisse l'objectif PROPRE au défaut — les stries se demandent", () => {
    // Arbitrage d'Antoine, le même jour et de la même famille que les lames :
    // les stries disent « objectif sale », ce qui est une intention et pas un
    // état de fait. Le défaut d'un effet doit rendre l'objectif propre.
    //
    // Comme pour les lames, le contrôle RESTE et la capacité reste verrouillée
    // ailleurs — `effet-lens-flare-familles` allume les stries.
    expect(lensFlare.params.find((p) => p.name === "scatter")?.default).toBe(0);
    expect(wgsl).toContain("let stries = pow(max(n - 0.60, 0.0) / 0.40, 3.0);");
  });

  it("a pour diaphragme par défaut le CERCLE, pas le polygone", () => {
    // Arbitrage d'Antoine (« je n'aime pas les lames de diaphragme »), et il est
    // conforme à ses références : un objectif moderne à lames arrondies rend des
    // fantômes ronds, et aucune de ses cinq photographies ne montre de polygone.
    //
    // Le contrôle RESTE : il porte une capacité réelle, partagée avec `lensBlur`
    // par `effects/aperture.ts`. Un défaut qui change ne retire pas une
    // capacité, et le scénario `effet-lens-flare-familles` la garde verrouillée.
    expect(lensFlare.params.find((p) => p.name === "blades")?.default).toBe(0);
    // Sous 3 lames, la fonction partagée rend 1 partout — donc un cercle.
    expect(apertureRadiusSpec(1.234, 0, 0)).toBe(1);
  });

  it("a pour teinte par défaut le bleu-violet des revêtements modernes", () => {
    // Trois des cinq photographies de référence sont franchement bleues, deux
    // ambrées. Le défaut suit la majorité — et surtout ce n'est PAS une teinte
    // choisie à l'œil : c'est la couleur que renvoie le traitement anti-reflet.
    const teinte = lensFlare.params.find((p) => p.name === "tintHue");
    expect(teinte?.default).toBe(262);
  });

  it("expose la source comme un MANIPULATEUR sur la toile", () => {
    // L'ADR de `pixelStretch` dit pourquoi une position ne se règle pas aux
    // curseurs. Les bornes débordent le cadre à dessein : une source de flare
    // est le plus souvent HORS champ.
    expect(lensFlare.canvasControls).toEqual([
      { id: "source", kind: "disk", x: "sourceX", y: "sourceY", radius: "sourceRadius", label: "Source" },
    ]);
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

  it("porte DEUX prédicats en sortie anticipée, qui ne disent pas la même chose", () => {
    // ⚠️ CONDITION DE CORRECTION, pas optimisation. Quand les passes sautent,
    // `prevPass` reçoit la texture SOURCE : sans cette sortie, l'effet lirait
    // l'image en croyant lire son champ de hautes lumières, et l'ajouterait à
    // elle-même. C'est l'avertissement porté par `EffectPass.enabled`, et c'est
    // le premier effet du dépôt où il mord.
    //
    // Mais un SEUL prédicat ne suffit plus : tout ce qui part de la source posée
    // est analytique et ne lit aucune texture, donc doit pouvoir rendre même
    // quand la pyramide ne tourne pas. Un flare entièrement posé sur une photo
    // sans la moindre haute lumière est un cas légitime, et c'est le premier qui
    // a cassé quand la sortie ne regardait que le champ.
    expect(wgsl).toContain("let champActif = ghostIntensity > 0.0 || haloIntensity > 0.0 || veil > 0.0;");
    expect(wgsl).toContain("if (!champActif && !dessinActif) {");
    expect(wgsl).toContain("return color;");

    // Le jumeau TS des passes, et celui du dessin, disent bien deux choses.
    // ⚠️ LES INTERRUPTEURS DE PHÉNOMÈNE GARDENT LEUR DÉFAUT ICI, et ce n'est pas
    // une commodité : depuis le 2026-08-14 « tout à zéro » voudrait dire « les
    // trois familles ÉTEINTES », donc ce test mesurerait l'extinction au lieu de
    // la sortie anticipée. Ce qu'on veut décrire est « aucune intensité réglée,
    // mais les trois phénomènes disponibles » — c'est-à-dire l'effet qu'on
    // vient d'ajouter à la pile.
    const zero: Record<string, number> = {};
    for (const p of lensFlare.params) zero[p.name] = p.choices ? p.default : 0;
    const posee = { ...zero, sourceIntensity: 5, scatter: 0.5 };
    // Rien à prélever : les passes doivent sauter…
    expect(passes.every((p) => p.enabled?.(posee) === false)).toBe(true);
    // …et pourtant il y a quelque chose à dessiner.
    expect(dessinActif(posee)).toBe(true);
    expect(dessinActif(zero)).toBe(false);
  });

  it("les trois interrupteurs COUPENT, ils ne font pas que masquer des curseurs", () => {
    // Arbitrage d'Antoine du 2026-08-13 : les trois phénomènes deviennent trois
    // options sélectionnables. Cumulables — un objectif les produit ensemble
    // (ADR-0017) — donc trois interrupteurs et pas un mode.
    //
    // ⚠️ CE QUE CE TEST TIENT : qu'ils agissent sur le RENDU et pas seulement
    // sur l'affichage. Un interrupteur qui ne ferait que masquer des réglages
    // serait un curseur mort de plus, exactement ce que le dépôt appelle un
    // échec silencieux — et rien dans un panneau ne le dirait.
    const defauts: Record<string, number> = {};
    for (const p of lensFlare.params) defauts[p.name] = p.default;

    // Les fantômes commandent les cinq passes de pyramide : les éteindre les
    // fait sauter, alors que le voile de diffusion, lui, les garde.
    expect(passes.every((p) => p.enabled?.(defauts) === true)).toBe(true);
    expect(passes.every((p) => p.enabled?.({ ...defauts, ghostsOn: 0 }) === false)).toBe(false);
    expect(
      passes.every((p) => p.enabled?.({ ...defauts, ghostsOn: 0, diffusionOn: 0 }) === false),
    ).toBe(true);

    // Et chaque famille disparaît du dessin quand son interrupteur tombe.
    const posee = { ...defauts, sourceIntensity: 5 };
    expect(dessinActif(posee)).toBe(true);
    expect(dessinActif({ ...posee, ghostsOn: 0, diffusionOn: 0, sensorOn: 0 })).toBe(false);

    // ⚠️ UN PRESET ÉCRIT AVANT CES TROIS PARAMÈTRES NE LES PORTE PAS. Il doit
    // alors rendre comme avant, donc les trois allumés — jamais éteints par
    // l'absence. C'est le `?? 1` du module, et il se vérifie ici plutôt que de
    // se relire.
    const ancien = { ...defauts, sourceIntensity: 5 };
    delete ancien.ghostsOn;
    delete ancien.diffusionOn;
    delete ancien.sensorOn;
    expect(dessinActif(ancien)).toBe(true);
    expect(passes.every((p) => p.enabled?.(ancien) === true)).toBe(true);
  });

  it("fait marcher la source HORS CADRE, ce qui était un défaut mesuré", () => {
    // L'anneau et le voile étaient PRÉLEVÉS dans le champ, où le lobe de la
    // source est rastérisé — donc ils ne rendaient RIEN hors cadre, alors que le
    // curseur va de −0,5 à 1,5 et que l'infobulle promet ce cas. Mesuré à
    // `sourceX = 1.25` avant correction : fantômes présents, voile réglé à 1,6
    // absent. Le curseur ET l'infobulle mentaient.
    //
    // Ce qui le corrige est la nature du calcul, pas une borne : une décroissance
    // depuis la POSITION vaut à n'importe quelle distance hors champ.
    expect(wgsl).toContain("let sIso = (vec2<f32>(params[2], params[3]) - centre) * ar;");
    expect(wgsl).toContain("flare = flare + teinteRvb * (1.0 / (1.0 + r * r)) * veil * force * 0.12;");
  });

  it("porte les DEUX autres familles, et pas comme des réglages de la première", () => {
    // Elles diffèrent par l'ENDROIT où la lumière se perd, pas par leur
    // apparence : surface sale (stries radiales) et aller-retour capteur
    // (quadrillage régulier). Aucun mécanisme unique ne les produit toutes.
    expect(wgsl).toContain("let stries = pow(max(n - 0.60, 0.0) / 0.40, 3.0);");
    expect(wgsl).toContain("let cellule = fract(g) - vec2<f32>(0.5);");
    // ⚠️ Le quadrillage a sa PROPRE couleur : elle vient de la matrice de Bayer
    // et des microlentilles, pas du revêtement anti-reflet. Lui faire suivre la
    // teinte du traitement serait cohérent à l'œil et faux au fond — le nom que
    // les photographes lui donnent, « red dot », dit que la couleur appartient
    // au phénomène.
    expect(wgsl).toContain("vec3<f32>(1.0, 0.22, 0.16) * point");
    expect(wgsl).not.toContain("teinteRvb * point");
  });

  it("échantillonne le bruit des stries sur la DIRECTION, donc sans couture", () => {
    // Sur l'angle lui-même il y aurait une couture à ±180°, et elle se lirait
    // comme une strie de plus — la pire des coutures, celle qui ressemble à ce
    // qu'on voulait dessiner. Sur la direction unitaire, le bruit est périodique
    // par construction.
    expect(wgsl).toContain("valueNoise(dir * detail)");
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

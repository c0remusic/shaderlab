import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { OKLAB_WGSL } from "./oklab";
import { UV_SPACE_WGSL } from "./uvSpace";
import { INPUT_DRIVER_WGSL, inputModeParam } from "./inputMode";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Isolines — la carte topographique : une ligne partout où le ton franchit un
 * niveau, et des niveaux également espacés.
 *
 * D'OÙ ÇA VIENT. Demandé par Antoine le 2026-08-03, « d'autres effets dans le
 * genre, la même DA », dans la suite d'`echoOutlines` — l'effet qui est devenu
 * depuis le mode « Échos de la forme » d'`outlines` (ADR-0015). Il n'a PAS de
 * fiche de référence, et c'est écrit ici plutôt que sous-entendu : la conception
 * vient de la carte topographique et de la sérigraphie à niveaux, pas d'un
 * catalogue.
 *
 * ─── LE FRÈRE DU MODE ÉCHOS, ET CE QUI LES SÉPARE ───────────────────────────
 *
 * Les deux tracent des lignes équidistantes, et les deux le font en RAMENANT une
 * grandeur en pixels avant de décider. Ce qu'ils mesurent diffère : le mode
 * Échos mesure une distance à UNE forme seuillée et répète cette forme
 * vers l'extérieur ; ici il n'y a aucune forme, seulement le ton, et les lignes
 * suivent ses niveaux — donc elles se referment sur les sommets et se creusent
 * dans les vallées, comme sur une carte.
 *
 * ─── POURQUOI CE N'EST PAS `posterize` + `outlines` EMPILÉS ─────────────────
 *
 * C'est la question qui se pose, et l'empilement produit bien des lignes aux
 * frontières des aplats. Il en produit de MAUVAISES, pour une raison qui est
 * tout le sujet de ce fichier : la largeur du trait d'`outlines` dépend du
 * gradient local. Sur une pente douce — un ciel — la frontière est floue et le
 * trait s'épaissit jusqu'à devenir une bande ; sur une arête franche il se
 * réduit au minimum. Une carte dont l'épaisseur du trait dirait la pente au lieu
 * de dire l'altitude n'est pas une carte.
 *
 * Ici la distance au niveau le plus proche est convertie EN PIXELS avant d'être
 * comparée à l'épaisseur :
 *
 *     distance_px = (écart au niveau, en tons) / (|∇ton| par pixel)
 *
 * — donc le trait fait la largeur demandée partout, quelle que soit la pente. Un
 * ciel très doux donne des lignes espacées mais AUSSI FINES qu'ailleurs, ce qui
 * est exactement ce qu'on attend d'une courbe de niveau.
 *
 * ─── TROIS CHOSES QUI ÉVITENT LE RENDU CHEAP ────────────────────────────────
 *
 * 1. **Le ton est lu sur l'axe PERCEPTUEL.** Des niveaux également espacés en
 *    lumière linéaire se tasseraient tous dans les hautes lumières : les ombres
 *    n'auraient aucune courbe et les clairs en auraient dix. Même correctif que
 *    le seuil d'`outlines` et les bascules de `duotone`.
 * 2. **Le ton est LISSÉ avant d'être découpé**, par une grille gaussienne 5×5.
 *    Sans ça, le grain d'une photo franchit les niveaux des centaines de fois
 *    par centimètre et la carte devient une bouillie. Le curseur de lissage ne
 *    multiplie PAS les taps — il ÉCARTE la grille : à son minimum le grain reste
 *    grené (« ça peut être sympa »), à son maximum la carte devient nette. C'est
 *    le vrai réglage de niveau de détail, et le grain n'y est plus subi mais
 *    optionnel. Les mêmes vingt-cinq lectures servent au ton ET au gradient.
 * 3. **Les courbes se colorent par ALTITUDE, en OKLCH.** C'est la lecture d'une
 *    carte, et la raison de l'espace est celle mesurée sur `coloredEdges` la
 *    veille : en HSL, parcourir la teinte fait varier la clarté perçue de 0,290
 *    alors qu'un seul curseur la règle.
 *
 * COÛT : 25 taps (grille de lissage), une seule passe.
 */
export const isolines: EffectModule = {
  id: "isolines",
  name: "Isolines",
  params: [
    { name: "levels", label: "Niveaux", unit: "none", min: 2, max: 40, default: 12, step: 1, hint: "Nombre de courbes réparties sur la plage tonale — l'équidistance des altitudes d'une carte" },
    { name: "thickness", label: "Épaisseur du trait", unit: "pixels", min: 0.5, max: 12, default: 1.6, step: 0.1, hint: "Largeur d'une courbe, EN PIXELS et donc constante : une pente douce donne des courbes espacées, pas des courbes épaisses" },
    // Écartement des taps : lissage ET base de mesure du gradient, d'un seul
    // geste. Un noyau serré redessinerait le grain ; un noyau large simplifie
    // le relief, ce qui est le réglage qu'on cherche sur une photo.
    { name: "smoothing", label: "Lissage du relief", unit: "pixels", min: 0.5, max: 24, default: 12, step: 0.1, hint: "Simplifie le ton avant d'en tirer les courbes : bas = grené (le grain reste, « ça peut être sympa »), haut = carte nette. Sans lui, le grain franchit les niveaux des centaines de fois et la carte devient une bouillie" },
    inputModeParam({
      hint: "Quel champ porte le relief — la luminance, son inverse (les ombres deviennent les sommets), ou la couverture alpha de la toile",
    }),
    { name: "blackPoint", label: "Point noir", unit: "percent", min: 0, max: 0.95, default: 0.02, step: 0.01, hint: "Ton d'entrée qui reçoit la première courbe — le monter concentre les courbes sur les clairs" },
    { name: "whitePoint", label: "Point blanc", unit: "percent", min: 0.05, max: 1, default: 0.98, step: 0.01, hint: "Ton d'entrée qui reçoit la dernière courbe" },
    // Une courbe sur N mise en valeur : c'est la « courbe maîtresse » d'une
    // carte topographique, celle qui porte l'altitude chiffrée. Sans elle, un
    // faisceau de courbes identiques ne se compte pas à l'œil.
    { name: "majorEvery", label: "Courbe maîtresse", unit: "none", min: 1, max: 12, default: 5, step: 1, hint: "Une courbe sur N est tracée plus épaisse, comme les courbes maîtresses d'une carte — c'est ce qui rend un faisceau comptable à l'œil. À 1, toutes le sont" },
    { name: "majorWidth", label: "Épaisseur de la maîtresse", unit: "none", min: 1, max: 4, default: 2.2, step: 0.1, hint: "Combien de fois plus épaisse qu'une courbe ordinaire" },
    { name: "lowHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 200, step: 1, colorGroup: { key: "bas", role: "hue", label: "Courbes basses" } },
    { name: "lowSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "bas", role: "saturation", label: "Courbes basses" } },
    { name: "lowLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.28, step: 0.01, colorGroup: { key: "bas", role: "lightness", label: "Courbes basses" } },
    { name: "highHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 25, step: 1, colorGroup: { key: "haut", role: "hue", label: "Courbes hautes" } },
    { name: "highSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.7, step: 0.01, colorGroup: { key: "haut", role: "saturation", label: "Courbes hautes" } },
    { name: "highLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "haut", role: "lightness", label: "Courbes hautes" } },
    { name: "wash", label: "Effacement du fond", unit: "percent", min: 0, max: 1, default: 0.72, step: 0.01, hint: "Fait disparaître la photo sous les courbes au profit de la couleur de fond — 0 = courbes sur la photo intacte, 1 = carte seule" },
    { name: "backgroundHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 42, step: 1, colorGroup: { key: "fond", role: "hue", label: "Couleur de fond" } },
    { name: "backgroundSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.22, step: 0.01, colorGroup: { key: "fond", role: "saturation", label: "Couleur de fond" } },
    { name: "backgroundLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.93, step: 0.01, colorGroup: { key: "fond", role: "lightness", label: "Couleur de fond" } },
  ],
  /**
   * QUATRE SECTIONS — quatre questions, dans l'ordre où une carte se fabrique :
   * OÙ passent les courbes, à quoi ressemble un TRAIT, de quelle couleur il est,
   * et ce qu'il reste de la photo dessous.
   *
   * DÉCOUPAGE THÉMATIQUE, PAS PAR MODE, et c'est ce qui le distingue de celui
   * d'`outlines`. Les 18 paramètres sont vivants en permanence : aucun ne porte
   * d'`appliesWhen`, donc aucune section n'en porte non plus. `inputMode` est un
   * choix d'ENTRÉE partagé par tout le registre — il change le champ qui porte le
   * relief, il ne rend aucun autre curseur sans objet. Ce qui manquait ici
   * n'était donc pas du masquage mais des TITRES : dix-huit curseurs de suite ne
   * disent pas que « Niveaux » et « Point noir » répondent à la même question —
   * où tombent les courbes — alors que « Épaisseur du trait », intercalé entre
   * eux, répond à une autre.
   *
   * « Détection » est le titre d'`outlines` pour la même question, et c'est
   * délibéré : les deux effets tracent des lignes et l'utilisateur passe de l'un
   * à l'autre. Deux mots différents pour le même groupe lui feraient réapprendre
   * la carte à chaque changement d'effet.
   *
   * ⚠️ AUCUN INDEX N'A BOUGÉ. Une section cite des NOMS et regroupe des items de
   * RENDU ; `params[]` reste dans son ordre d'origine, où les presets le lisent.
   * La seule différence à l'écran avec la liste plate est que l'épaisseur du
   * trait (index 1) descend de quatre lignes, pour rejoindre les deux réglages
   * de courbe maîtresse qui la déclinent. Les sections sont citées dans l'ordre
   * des index pour que personne n'y lise une intention de tri : l'ordre DANS une
   * section est celui de `params[]`, pas celui de cette liste.
   *
   * ⚠️ LES TROIS GROUPES DE COULEUR RESTENT ENTIERS, chacun dans une seule
   * section : `ParamPanel` ancre un groupe à l'index de son premier rôle, donc
   * une section qui n'en citerait que deux casserait la pastille au lieu de la
   * déplacer. `bas` et `haut` sont les deux bouts d'un même dégradé d'altitude et
   * ne se séparent pas ; `fond` va avec l'effacement qui le fait apparaître, et
   * non avec l'encre.
   *
   * `majorWidth` aurait pu se masquer à `majorEvery` = 1 : toutes les courbes y
   * sont maîtresses, et le multiplicateur y fait double emploi avec l'épaisseur.
   * `appliesWhen` ne sait pas l'exprimer — il compare un index de `choices`,
   * jamais un seuil sur un curseur (`types.ts`). Laissé vivant, donc, plutôt que
   * de tordre le contrat pour un cas ; c'est le même arbitrage que les trois
   * déclarations laissées en prose dans `gradientMap` et `lensFlare`.
   */
  sections: [
    // Ce qui décide OÙ tombent les courbes : combien, sur quelle plage de tons,
    // lues sur quel champ, et à quelle finesse de relief. Le lissage est ici et
    // non dans « Trait » parce qu'il ne touche pas au trait — il simplifie la
    // surface AVANT qu'on la découpe, c'est le vrai réglage de niveau de détail.
    { id: "detection", label: "Détection", params: ["levels", "smoothing", "inputMode", "blackPoint", "whitePoint"], layout: "liste" },
    // À quoi ressemble UNE courbe. Les deux réglages de maîtresse ne sont qu'une
    // déclinaison de l'épaisseur : les tenir loin d'elle obligeait à faire
    // l'aller-retour pour comparer une largeur à son multiple.
    { id: "trait", label: "Trait", params: ["thickness", "majorEvery", "majorWidth"], layout: "liste" },
    // Le dégradé d'altitude, en deux bouts. Une seule question — de quelle
    // couleur est l'encre selon la hauteur — et deux pastilles pour y répondre.
    { id: "couleurs", label: "Couleurs", params: ["lowHue", "lowSaturation", "lowLightness", "highHue", "highSaturation", "highLightness"], layout: "liste" },
    // Ce qu'il reste de la photo sous les courbes. L'effacement et la couleur de
    // fond sont un seul geste en deux curseurs : l'un ne se règle jamais sans
    // regarder l'autre, puisque c'est celui-là qu'on découvre en montant celui-ci.
    { id: "fond", label: "Fond", params: ["wash", "backgroundHue", "backgroundSaturation", "backgroundLightness"], layout: "liste" },
  ],
  wgsl: `
${UV_SPACE_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INPUT_DRIVER_WGSL}${HSL_TO_RGB_WGSL}${OKLAB_WGSL}

/** Couverture d'un trait, comme DIFFÉRENCE DE DEUX BORDS — jamais un
 *  \`smoothstep\` centré, qui rendrait 0,5 pour une largeur nulle, donc un voile
 *  gris là où rien ne doit être tracé. Même écriture, et même raison, que
 *  \`hatching\` et le mode Échos d'\`outlines\` (\`echo_stripe\`). */
fn iso_stripe(d: f32, demi: f32, aa: f32) -> f32 {
  let dedans = clamp((demi + aa - d) / (2.0 * aa), 0.0, 1.0);
  let dehors = clamp((aa - demi - d) / (2.0 * aa), 0.0, 1.0);
  return dedans - dehors;
}

/** Ton perceptuel au point demandé. \`mirrorUv\` : les taps de bord sortent du
 *  cadre, et sans repli le sampler clamp-to-edge rendrait le même texel des deux
 *  côtés — le gradient s'annulerait pile sur le périmètre. */
fn iso_tone(uv: vec2<f32>, mode: f32) -> f32 {
  return input_driver(textureSample(srcTexture, srcSampler, mirrorUv(uv)), mode);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let levels = max(params[0], 2.0);
  let thickness = max(params[1], 0.1);
  let smoothing = max(params[2], 0.5);
  let mode = params[3];
  let blackPoint = clamp(params[4], 0.0, 0.95);
  // Un point blanc sous le point noir inverserait la réponse en silence, avec
  // un dénominateur négatif. Borné juste au-dessus — l'inversion se fait en
  // échangeant les deux curseurs, là où elle se voit.
  let whitePoint = max(params[5], blackPoint + 0.001);
  let majorEvery = max(round(params[6]), 1.0);
  let majorWidth = max(params[7], 1.0);
  let wash = clamp(params[14], 0.0, 1.0);

  let dims = vec2<f32>(textureDimensions(srcTexture));
  // Écartement d'UN pas de grille EN PIXELS : le lissage a la même finesse sur
  // les deux axes, ce qu'un pas en UV ne donnerait pas sur une photo non carrée.
  let pas = smoothing / dims;

  // ── LISSAGE GAUSSIEN 5×5, ET C'EST TOUT LE RÉGLAGE grené ↔ carte propre ──
  //
  // Quatre taps en croix ne moyennent que quatre échantillons : le grain d'une
  // photo n'en ressort atténué que d'un facteur deux (√4), et une carte de
  // niveaux tracée dessus reste un semis de points À TOUS les réglages — mesuré
  // sur photo le 2026-08-21, le lissage au maximum laissait encore le grésillement
  // (retour d'usage « très noisy »). Une grille de vingt-cinq taps le divise par
  // cinq (√25), assez pour une carte nette.
  //
  // Le curseur Lissage n'ajoute AUCUN tap, il ÉCARTE la grille : à son minimum
  // elle est sub-pixel, les vingt-cinq taps retombent sur le même texel et le
  // grain est rendu quasi INTACT — le bruit reste donc disponible (« ça peut être
  // sympa », retour d'Antoine), il ne se subit plus. Une seule lecture par tap,
  // pondérée deux fois : le ton lissé et son gradient, sur le même voisinage
  // (l'invariant du fichier — un gradient pris ailleurs que le ton qu'il
  // accompagne désignerait une pente qui n'est pas celle de la surface découpée).
  let poidsAxe = array<f32, 5>(exp(-2.0), exp(-0.5), 1.0, exp(-0.5), exp(-2.0));
  var tone = 0.0;
  var poids = 0.0;
  // Colonnes / lignes extrêmes, pondérées sur l'axe TRANSVERSE seulement : leur
  // différence est un gradient LISSÉ à l'échelle EXACTE (différence centrée sur
  // une distance connue), et non une dérivée gaussienne approchée dont le facteur
  // d'échelle ferait dériver la largeur du trait (verrouillée par un test).
  var colGauche = 0.0;
  var colDroite = 0.0;
  var ligHaut = 0.0;
  var ligBas = 0.0;
  for (var j = -2; j < 3; j = j + 1) {
    let wj = poidsAxe[j + 2];
    for (var i = -2; i < 3; i = i + 1) {
      let wi = poidsAxe[i + 2];
      let s = iso_tone(uv + vec2<f32>(f32(i) * pas.x, f32(j) * pas.y), mode);
      tone = tone + s * wi * wj;
      poids = poids + wi * wj;
      if (i == -2) { colGauche = colGauche + s * wj; }
      if (i == 2)  { colDroite = colDroite + s * wj; }
      if (j == -2) { ligHaut = ligHaut + s * wi; }
      if (j == 2)  { ligBas = ligBas + s * wi; }
    }
  }
  tone = tone / poids;
  // Somme des poids transverses d'une colonne (le même jeu sur les deux axes).
  let poidsBord = 2.0 * exp(-2.0) + 2.0 * exp(-0.5) + 1.0;

  // Gradient PAR PIXEL : les colonnes extrêmes sont écartées de quatre pas, soit
  // 4 × smoothing pixels. Le plancher évite la division par zéro à smoothing nul.
  let spanColonnesPx = max(4.0 * smoothing, 0.0001);
  let pente = length(vec2<f32>(
    (colDroite - colGauche) / poidsBord,
    (ligBas - ligHaut) / poidsBord,
  )) / spanColonnesPx;

  let etendue = whitePoint - blackPoint;
  let t = clamp((tone - blackPoint) / etendue, 0.0, 1.0);

  // ALTITUDE en niveaux, et écart au niveau le plus proche EN TONS.
  let altitude = t * (levels - 1.0);
  let niveau = round(altitude);
  // Ramené en tons d'entrée : un niveau vaut \`etendue / (levels - 1)\`.
  let ecartTons = abs(altitude - niveau) * etendue / (levels - 1.0);

  // ── LE CŒUR : l'écart passe EN PIXELS avant d'être comparé à l'épaisseur ──
  //
  // C'est ce qui donne au trait une largeur CONSTANTE, et c'est toute la
  // différence avec un posterize suivi d'un détecteur de contours : là-bas,
  // l'épaisseur suit la pente locale — une bande dans un ciel doux, un cheveu
  // sur une arête. Une carte dont l'épaisseur dirait la pente au lieu de
  // l'altitude n'est pas une carte.
  //
  // Le plancher de la pente n'est pas cosmétique : sur un aplat parfait il n'y a
  // AUCUNE courbe à tracer (le ton n'y franchit rien), et la distance doit donc
  // partir à l'infini plutôt que de rendre un trait de largeur indéterminée.
  let ecartPx = ecartTons / max(pente, 0.000001);

  // Antialiasing : un demi-pixel de chaque côté. La grandeur comparée étant
  // déjà en pixels, la largeur de transition est connue sans \`fwidth\`.
  let maitresse = step(abs(niveau - round(niveau / majorEvery) * majorEvery), 0.5);
  let demi = 0.5 * thickness * mix(1.0, majorWidth, maitresse);
  let encrage = iso_stripe(ecartPx, demi, 0.5);

  // COULEUR PAR ALTITUDE, en OKLCH — la lecture d'une carte. \`h - round(h)\`
  // prend le PLUS COURT chemin sur le cercle : sans lui, un dégradé de 350° à
  // 10° ferait tout le tour à l'envers au lieu des 20° qui séparent les deux.
  let a = clamp(niveau / max(levels - 1.0, 1.0), 0.0, 1.0);
  let bas3 = oklab_to_oklch(linear_srgb_to_oklab(srgb_to_linear3(hsl2rgb(params[8] / 360.0, params[9], params[10]))));
  let haut3 = oklab_to_oklch(linear_srgb_to_oklab(srgb_to_linear3(hsl2rgb(params[11] / 360.0, params[12], params[13]))));
  let dh = haut3.z - bas3.z;
  let encre = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(
    mix(bas3.x, haut3.x, a),
    mix(bas3.y, haut3.y, a),
    bas3.z + (dh - round(dh)) * a
  )));

  let fond = srgb_to_linear3(hsl2rgb(params[15] / 360.0, params[16], params[17]));
  let papier = mix(color.rgb, fond, wash);
  return vec4<f32>(mix(papier, encre, clamp(encrage, 0.0, 1.0)), color.a);
}
`,
};

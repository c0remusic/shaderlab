import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { OKLAB_WGSL } from "./oklab";
import { INPUT_DRIVER_WGSL, inputModeParam } from "./inputMode";
import { DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Echo outlines — des contours RÉGULIÈREMENT ESPACÉS qui répètent la forme vers
 * l'extérieur, comme des ondes à la surface de l'eau.
 *
 * ─── POURQUOI CET EFFET EXISTE À CÔTÉ D'`outlines`, ET N'EST PAS SON RÉGLAGE ──
 *
 * La fiche de référence dit, mot pour mot : « This draws a series of evenly
 * spaced outlines that echo your shape outward, like ripples. » Le cahier
 * (§6quinquies, « MÊME NOM, AUTRE EFFET ») en tirait la conclusion qui s'impose
 * et qui n'avait jamais été exécutée : **le leur n'est pas un détecteur de
 * contours**. Notre `outlines` mesure un gradient de Scharr et trace la ligne de
 * crête — il répond à « où l'image change-t-elle ? ». Celui-ci répond à « à
 * quelle DISTANCE de la forme suis-je ? », ce qu'aucun gradient ne sait dire.
 *
 * Antoine l'a signalé à l'usage le 2026-08-03, après un correctif qui rendait
 * `outlines` juste sans le rendre ressemblant : « ça ne ressemble pas du tout ».
 * C'était exact, et aucun réglage n'aurait pu y remédier.
 *
 * CONSÉQUENCE SUR UNE DÉCISION DÉJÀ PRISE, relevée par le cahier lui-même : le
 * §6bis écartait le mode d'entrée « Luminance inversée » SUR PREUVE, parce que
 * |∇(1−x)| = |∇x| — inverser laisse la magnitude d'un gradient inchangée. La
 * preuve reste juste pour `outlines`. Elle ne vaut PAS ici : cet effet cherche
 * une forme par SEUIL, et inverser échange alors le sujet et le fond. Le
 * vocabulaire à trois choix est donc légitime ici et inerte là-bas — même
 * paramètre, deux opérateurs, deux verdicts.
 *
 * ─── COMMENT LA DISTANCE EST OBTENUE, ET CE QUE ÇA COÛTE ────────────────────
 *
 * Des contours ÉQUIDISTANTS demandent une distance, pas une magnitude. La
 * réponse exacte serait une transformée de distance (jump flooding), et elle est
 * hors d'atteinte ici pour une raison matérielle : elle stocke des COORDONNÉES
 * dans ses textures intermédiaires, or les cibles de passe interne de ce dépôt
 * sont en 8 bits `-srgb` (`effectPassRunner`). Un octet ne porte pas une
 * coordonnée.
 *
 * D'où l'estimation au PREMIER ORDRE, qui elle tient dans le budget : on seuille
 * la forme, on la floute largement avec la pyramide déjà partagée
 * (`blurChain.ts`), et la distance signée au bord vaut
 *
 *     dist ≈ (champ − 0,5) / |∇champ| par pixel
 *
 * — la lecture standard d'un champ lissé : la valeur dit de quel côté on est,
 * la pente dit à quelle vitesse on s'en éloigne. Les anneaux tombent ensuite aux
 * multiples entiers de l'espacement, donc VRAIMENT équidistants, et non aux
 * lignes de niveau du flou (qui, elles, se resserrent dans les concavités).
 *
 * LES DEUX LIMITES, écrites plutôt que découvertes :
 *
 * 1. **La portée est celle du flou.** Au-delà, le champ est plat, sa pente tend
 *    vers zéro et la distance estimée part à l'infini. Ce n'est PAS un artefact
 *    à corriger : les anneaux trop lointains sortent simplement au-delà du
 *    compte demandé et ne sont pas tracés. L'effet s'éteint de lui-même là où sa
 *    mesure cesse d'être fiable, ce qui est le comportement qu'on voudrait avoir
 *    codé exprès.
 * 2. **Une forme plus fine que le flou disparaît.** C'est le prix du lissage, et
 *    c'est aussi ce qui empêche le grain d'engendrer des milliers d'anneaux. Le
 *    curseur `Lissage de la forme` est donc le vrai réglage de niveau de détail.
 *
 * ─── CE QUI EMPÊCHE QUE ÇA RENDE CHEAP ──────────────────────────────────────
 *
 * - **Le trait est antialiasé ANALYTIQUEMENT, et sa largeur ne dépend pas de
 *   l'espacement.** La phase vaut `dist / espacement` et `dist` est en pixels :
 *   un pixel de déplacement perpendiculaire change la phase de `1/espacement`,
 *   exactement. La largeur de transition est donc connue sans `fwidth`.
 * - **La couverture d'un trait est une DIFFÉRENCE DE DEUX BORDS**, jamais un
 *   `smoothstep` centré — qui rendrait 0,5 pour une largeur NULLE, donc un voile
 *   gris partout où l'effet ne doit rien tracer. Même écriture, et même raison,
 *   que `hatching`.
 * - **Le dégradé de couleur des anneaux court en OKLCH.** La fiche expose un
 *   dégradé du premier au dernier contour ; le faire en HSL rejouerait
 *   exactement le défaut mesuré sur `coloredEdges` la veille — clarté perçue qui
 *   balaie un tiers de l'échelle selon la teinte, alors qu'un seul curseur la
 *   règle.
 *
 * COÛT : 10 passes internes (une de seuillage-réduction, quatre réductions,
 * quatre remontées), puis 5 taps sur le champ en passe finale.
 */

/** Seuillage de la forme FONDU DANS la première réduction, plutôt qu'en passe
 *  séparée. Deux raisons, et la seconde est la vraie : une passe de plus coûte
 *  une cible pleine résolution (~26 Mo sur une photo 26 Mpx) ; et seuiller les
 *  cinq taps AVANT de les moyenner rend une couverture déjà antialiasée, là où
 *  seuiller après aurait produit un masque binaire à recrénéler ensuite. */
const SHAPE_DOWNSAMPLE_WGSL = `
${LINEAR_TO_SRGB_WGSL}${INPUT_DRIVER_WGSL}
fn shapeAt(uv: vec2<f32>) -> f32 {
  // Bascule ÉTROITE et non binaire : la forme est une couverture, et une
  // couverture binaire perdrait le demi-pixel de bord que toute la mesure de
  // distance exploite ensuite.
  let v = input_driver(textureSample(srcTexture, srcSampler, uv), params[1]);
  return smoothstep(params[0] - 0.02, params[0] + 0.02, v);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let o = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  var sum = shapeAt(uv) * 4.0;
  sum = sum + shapeAt(uv + vec2<f32>(-o.x, -o.y));
  sum = sum + shapeAt(uv + vec2<f32>( o.x, -o.y));
  sum = sum + shapeAt(uv + vec2<f32>(-o.x,  o.y));
  sum = sum + shapeAt(uv + vec2<f32>( o.x,  o.y));
  // La couverture voyage sur les TROIS canaux : la chaîne partagée
  // (\`DOWNSAMPLE_WGSL\`, \`upsampleWgsl\`) travaille en \`.rgb\`, et n'écrire que
  // le rouge ferait lire du noir aux deux autres à la remontée.
  return vec4<f32>(vec3<f32>(sum / 8.0), 1.0);
}
`;

/** Index du paramètre de portée lu par la remontée partagée. En dur ici serait
 *  une panne silencieuse au premier réordonnancement — le shader compilerait. */
const SMOOTHING_PARAM = 2;

export const echoOutlines: EffectModule = {
  id: "echoOutlines",
  name: "Echo outlines",
  params: [
    { name: "threshold", label: "Seuil de la forme", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Où passe le bord du sujet, en tons perceptuels. C'est LUI qui décide de la forme que les contours vont répéter" },
    inputModeParam({
      hint: "Quel champ dessine la forme — Luminance : le sujet est ce qui est clair. Luminance inversée : le sujet est ce qui est sombre (texte noir sur blanc). Alpha : la silhouette d'un élément de montage. Ici l'inversion CHANGE le résultat, contrairement à Outlines qui mesure un gradient",
    }),
    // Portée de la remontée pyramidale : rayon ≈ 62 + 60 × valeur, en pixels
    // pleine résolution. C'est à la fois le niveau de détail conservé sur la
    // forme et la DISTANCE MAXIMALE où l'estimation reste fiable.
    { name: "smoothing", label: "Lissage de la forme", unit: "none", min: 0.5, max: 6, default: 2.5, step: 0.05, hint: "Simplifie la forme avant d'en tirer les contours — et fixe du même geste la portée : au-delà d'environ 62 + 60 × cette valeur pixels, il n'y a plus de contour à tracer" },
    { name: "spacing", label: "Espacement", unit: "pixels", min: 2, max: 200, default: 22, step: 0.5, hint: "Distance entre deux contours successifs, en pixels — c'est la longueur d'onde des ondes" },
    { name: "thickness", label: "Épaisseur du trait", unit: "pixels", min: 0.5, max: 40, default: 3, step: 0.1, hint: "Largeur d'un contour, en pixels. Indépendante de l'espacement : resserrer les ondes n'épaissit pas le trait" },
    { name: "count", label: "Nombre de contours", unit: "none", min: 1, max: 24, default: 6, step: 1, hint: "Combien d'échos avant de s'arrêter. Le contour 0 est le bord de la forme lui-même" },
    { name: "falloff", label: "Atténuation", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "Fait pâlir les contours à mesure qu'ils s'éloignent — 0 = tous à la même force, 1 = le dernier s'éteint complètement" },
    { name: "startHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 210, step: 1, colorGroup: { key: "premier", role: "hue", label: "Premier contour" } },
    { name: "startSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "premier", role: "saturation", label: "Premier contour" } },
    { name: "startLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.22, step: 0.01, colorGroup: { key: "premier", role: "lightness", label: "Premier contour" } },
    { name: "endHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 320, step: 1, colorGroup: { key: "dernier", role: "hue", label: "Dernier contour" } },
    { name: "endSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "dernier", role: "saturation", label: "Dernier contour" } },
    { name: "endLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, colorGroup: { key: "dernier", role: "lightness", label: "Dernier contour" } },
    { name: "wash", label: "Effacement du fond", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Fait disparaître la photo sous les contours au profit de la couleur de fond — 0 = contours sur la photo intacte, 1 = contours seuls" },
    { name: "backgroundHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 0, step: 1, colorGroup: { key: "fond", role: "hue", label: "Couleur de fond" } },
    { name: "backgroundSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "fond", role: "saturation", label: "Couleur de fond" } },
    { name: "backgroundLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, colorGroup: { key: "fond", role: "lightness", label: "Couleur de fond" } },
    // La forme elle-même : remplie de l'encre du premier contour, ou laissée
    // telle quelle. La référence montre les deux usages (silhouette pleine à
    // échos, ou contour creux), et aucun empilement ne remplace celui-ci — la
    // couverture de la forme n'existe qu'ici.
    { name: "fill", label: "Remplir la forme", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, hint: "Peint l'INTÉRIEUR du sujet à la couleur du premier contour. 0 = seuls les traits sont tracés" },
  ],
  passes: [
    // Seuillage + première réduction, fondus (voir SHAPE_DOWNSAMPLE_WGSL).
    { scale: 0.5, wgsl: SHAPE_DOWNSAMPLE_WGSL },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.03125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: upsampleWgsl(SMOOTHING_PARAM) },
    { scale: 0.125, wgsl: upsampleWgsl(SMOOTHING_PARAM) },
    { scale: 0.25, wgsl: upsampleWgsl(SMOOTHING_PARAM) },
    { scale: 0.5, wgsl: upsampleWgsl(SMOOTHING_PARAM) },
  ],
  wgsl: `
${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${HSL_TO_RGB_WGSL}${OKLAB_WGSL}

/** Couverture d'un trait, comme DIFFÉRENCE DE DEUX BORDS. \`h\` est la
 *  demi-largeur et \`aa\` la demi-largeur de transition, en unités de phase.
 *
 *  L'écriture évidente — \`smoothstep(h + aa, h - aa, d)\` — rend 0,5 au centre
 *  quand h vaut 0, donc un voile gris là où rien ne doit être tracé. Ici les
 *  deux termes deviennent égaux quand h s'annule, par construction. Repris de
 *  \`hatching\`, où la même panne avait été évitée pour la même raison. */
fn echo_stripe(d: f32, h: f32, aa: f32) -> f32 {
  let dedans = clamp((h + aa - d) / (2.0 * aa), 0.0, 1.0);
  let dehors = clamp((aa - h - d) / (2.0 * aa), 0.0, 1.0);
  return dedans - dehors;
}

/** LINÉARISATION DU CHAMP, et c'est ce qui rend les échos ÉQUIDISTANTS.
 *
 *  La lecture naïve d'un champ lissé — \`(champ − 0,5) / pente\` — suppose le
 *  champ localement LINÉAIRE. Un échelon flouté ne l'est pas : c'est un
 *  sigmoïde, raide au centre et plat dans les queues. Loin du bord la pente
 *  s'effondre, la distance est donc sur-estimée, et les anneaux d'indice entier
 *  y tombent plus serrés qu'ils ne devraient.
 *
 *  MESURÉ, sur la mire commune à espacement demandé de 18 px : les écarts
 *  allaient de 6 à 20 px, soit 31,9 % de dispersion — et l'écart rétrécissait
 *  systématiquement avec l'éloignement, la signature exacte de ce biais.
 *
 *  Or un échelon logistique est EXACTEMENT une droite dans l'espace logit. Y
 *  mesurer la pente la rend quasi constante d'un bout à l'autre du champ, donc
 *  la distance quasi exacte. Le flou pyramidal n'est pas rigoureusement
 *  logistique, mais il en est bien plus près que de l'affine.
 *
 *  LE CLAMP EST CALCULÉ, PAS CHOISI. Le logit amplifie le bruit d'entrée par
 *  \`1 / (f (1 − f))\`, et le champ est en 8 bits — un LSB vaut 1/255 ≈ 0,004.
 *  À f = 0,002 l'amplification vaut 500, donc un seul LSB déplace le logit de
 *  2,0 : plus du DOUBLE d'un interligne d'anneau, c'est-à-dire du bruit pur.
 *  À f = 0,02 elle vaut 51, soit 0,2 en logit — moins du quart d'un interligne.
 *
 *  Essayé à 0,002 et mesuré : les anneaux proches devenaient justes (moyenne
 *  18,59 px pour 18 demandés, contre 13,42 avant le logit) mais les lointains
 *  partaient de 5 à 31,5 px. C'était exactement cette amplification.
 *
 *  Hors de la plage, la pente logit tombe à zéro et la distance part à l'infini
 *  — comportement voulu : l'effet s'éteint là où il ne mesure plus rien, plutôt
 *  que de tracer des anneaux faux. */
fn echo_logit(f: f32) -> f32 {
  let c = clamp(f, 0.02, 0.98);
  return log(c / (1.0 - c));
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let spacing = max(params[3], 1.0);
  let thickness = max(params[4], 0.1);
  let count = max(params[5], 1.0);
  let falloff = clamp(params[6], 0.0, 1.0);
  let wash = clamp(params[13], 0.0, 1.0);
  let fill = clamp(params[17], 0.0, 1.0);

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let fieldDims = vec2<f32>(textureDimensions(prevPass));
  // Un pixel ÉCRAN vaut cette fraction de texel du champ. Le champ vit en
  // demi-résolution : le facteur est donc ~0,5, mais il est LU et non supposé —
  // une passe finale posée à une autre échelle ne casserait rien.
  let texelsParPixel = fieldDims / dims;

  // Champ de couverture, flouté. La chaîne écrit la même valeur sur les trois
  // canaux ; on en lit un seul.
  let field = textureSample(prevPass, srcSampler, uv).r;

  // PENTE, en unités de champ par PIXEL ÉCRAN, sur une base LARGE.
  //
  // Le pas d'un texel — le plus court qui ait un sens sur une texture
  // bilinéaire — a été essayé et rend des anneaux FRAGMENTÉS. La raison est
  // celle que \`gooeyMerge\` a déjà payée : les cibles de passe interne sont en
  // 8 bits (\`effectPassRunner\`), et sur un champ très lissé deux texels voisins
  // sont souvent IDENTIQUES. La différence rend alors zéro, la pente aussi, et
  // l'anneau disparaît par plaques.
  //
  // ICI C'EST PIRE QUE POUR gooeyMerge, et le pas est donc élargi davantage :
  // là-bas la pente ne servait qu'à donner une DIRECTION, ici elle passe au
  // DÉNOMINATEUR d'une division. Une pente sous-estimée n'incline pas un
  // liseré, elle envoie la distance à l'infini — et le contour avec.
  //
  // Base proportionnelle au lissage : plus le champ est lisse, plus il faut
  // aller loin pour mesurer sa pente au-dessus du bruit de quantification.
  let k = 2.0 + 4.0 * max(params[2], 0.0);
  let gs = k / fieldDims;
  // Tout se mesure dans l'espace LOGIT (voir \`echo_logit\`) : c'est lui qui rend
  // les anneaux équidistants, en redressant le sigmoïde du flou en droite.
  let gCentre = echo_logit(field);
  let dx = echo_logit(textureSample(prevPass, srcSampler, uv + vec2<f32>(gs.x, 0.0)).r)
         - echo_logit(textureSample(prevPass, srcSampler, uv - vec2<f32>(gs.x, 0.0)).r);
  let dy = echo_logit(textureSample(prevPass, srcSampler, uv + vec2<f32>(0.0, gs.y)).r)
         - echo_logit(textureSample(prevPass, srcSampler, uv - vec2<f32>(0.0, gs.y)).r);
  // Le pas vaut 2k texels du champ sur chaque axe, soit \`2k / texelsParPixel\`
  // pixels écran — c'est par ça qu'il faut diviser pour obtenir une pente PAR
  // PIXEL, la seule unité dans laquelle la distance qui suit ait un sens.
  let pasPx = 2.0 * k / texelsParPixel;
  let pente = length(vec2<f32>(dx / pasPx.x, dy / pasPx.y));

  // DISTANCE SIGNÉE au bord. Positive DEDANS. \`gCentre\` s'annule exactement où
  // le champ vaut 0,5, c'est-à-dire sur le bord de la forme.
  //
  // Le plancher n'est pas un garde-fou cosmétique : là où le champ est saturé
  // (loin de la forme), la pente logit tend vers zéro et la distance part à
  // l'infini. C'est le comportement VOULU — la phase dépasse alors le compte
  // demandé et plus aucun contour n'est tracé, donc l'effet s'éteint exactement
  // là où sa mesure cesse d'être fiable, sans qu'aucun anneau parasite ne
  // s'accumule au bord de la zone utile.
  let dist = gCentre / max(pente, 0.000001);

  // PHASE : 0 sur le bord de la forme, 1 au premier écho, 2 au deuxième...
  // Comptée vers l'EXTÉRIEUR (\`-dist\`), comme la référence : « echo your shape
  // outward ».
  let phase = -dist / spacing;
  let anneau = round(phase);
  // Distance au contour le plus proche, en unités de phase.
  let ecart = abs(phase - anneau);

  // Antialiasing ANALYTIQUE : un pixel écran change la phase de 1/espacement,
  // exactement. Aucun \`fwidth\` — il n'apporterait rien et exigerait un flux de
  // contrôle uniforme que rien ne garantit ici.
  let aa = 1.0 / spacing;
  let demi = 0.5 * thickness / spacing;

  // Les contours vont de 0 (le bord de la forme) à \`count\`. Au-delà, rien.
  let dansLeCompte = step(-0.5, anneau) * step(anneau, count + 0.5);
  // \`encrage\` et non \`trait\` : \`trait\` est un mot RÉSERVÉ de WGSL, et le
  // compilateur le refuse comme nom de variable. Même piège exactement que le
  // \`smooth\` de \`pixelStretch\` — attrapé par \`npm run test:gpu-shaders\`,
  // jamais par tsc, qui ne voit qu'une chaîne de caractères.
  let encrage = echo_stripe(ecart, demi, aa) * dansLeCompte;

  // Atténuation avec l'éloignement : le dernier contour s'éteint à \`falloff\` = 1.
  let t = clamp(anneau / max(count, 1.0), 0.0, 1.0);

  // ZONE DE CONFIANCE. Aux abords du clamp de \`echo_logit\`, une des deux
  // lectures de la différence centrale est bornée et l'autre non : la pente
  // n'est alors pas NULLE, elle est FAUSSE, et les anneaux s'y entassent au lieu
  // de disparaître. Mesuré : les deux plus externes tombaient à 5 et 10 px
  // d'écart quand les suivants tenaient 18 à 20.
  //
  // L'encre s'éteint donc AVANT la borne, sur une bande étroite. C'est la
  // différence entre « je ne sais plus mesurer, je me tais » et « je ne sais
  // plus mesurer, je dessine quand même » — et c'est la deuxième qui produit un
  // artefact qu'on prendrait pour une intention.
  //
  // La bande a dû être ÉLARGIE après mesure : à 0,02–0,07, les deux anneaux les
  // plus externes tombaient encore à 5 et 10 px d'écart pour 18 demandés, et
  // s'effilochaient visiblement dans le coin le plus saturé. À 0,06–0,16, ce qui
  // reste tracé est ce qui est mesuré — le reste ne l'était pas.
  let fiable = smoothstep(0.06, 0.16, field) * smoothstep(0.06, 0.16, 1.0 - field);
  let force = encrage * (1.0 - falloff * t) * fiable;

  // DÉGRADÉ DU PREMIER AU DERNIER CONTOUR, en OKLCH. En HSL, il rejouerait le
  // défaut mesuré sur \`coloredEdges\` la veille : à saturation et clarté
  // fixées, parcourir la teinte fait varier la clarté PERÇUE de 0,290 sur le
  // tour. Ici la teinte court d'un bout à l'autre du dégradé — c'est exactement
  // le cas où l'espace compte.
  //
  // \`h - round(h)\` : le PLUS COURT chemin sur le cercle, en tours. Sans lui, un
  // dégradé de 350° à 10° ferait tout le tour à l'envers au lieu des 20° qui
  // séparent les deux.
  let debut = oklab_to_oklch(linear_srgb_to_oklab(srgb_to_linear3(hsl2rgb(params[7] / 360.0, params[8], params[9]))));
  let fin = oklab_to_oklch(linear_srgb_to_oklab(srgb_to_linear3(hsl2rgb(params[10] / 360.0, params[11], params[12]))));
  let dh = fin.z - debut.z;
  let teinte = debut.z + (dh - round(dh)) * t;
  let encre = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(
    mix(debut.x, fin.x, t),
    mix(debut.y, fin.y, t),
    teinte
  )));

  // FOND. Une couleur, pas un blanc imposé — même choix que \`coloredEdges\`, et
  // le défaut (teinte 0, saturation 0, luminosité 1) EST le blanc.
  let fond = srgb_to_linear3(hsl2rgb(params[14] / 360.0, params[15], params[16]));
  var result = mix(color.rgb, fond, wash);

  // Remplissage de la forme, SOUS les traits : la silhouette pleine est un
  // usage de la référence, et la couverture qui la définit n'existe nulle part
  // ailleurs dans le pipeline.
  let dedans = clamp(field * 2.0 - 1.0, 0.0, 1.0);
  let encreDebut = oklab_to_linear_srgb(oklch_to_oklab(debut));
  result = mix(result, encreDebut, fill * dedans);

  return vec4<f32>(mix(result, encre, clamp(force, 0.0, 1.0)), color.a);
}
`,
};

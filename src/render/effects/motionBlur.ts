import type { EffectModule } from "./types";
import { HASH_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * Motion blur — l'intégration d'un mouvement pendant l'ouverture de
 * l'obturateur, en ligne, en rotation ou en zoom.
 *
 * D'OÙ ÇA VIENT. Cahier de références §6ter : la Blur Gallery de Photoshop
 * range **Path Blur** et **Spin Blur** parmi ses cinq outils, et le cahier note
 * qu'ils « relèvent du motion blur, une autre famille — à cadrer avec lui ».
 * C'est ce cadrage. Le flou radial de zoom vient du même geste physique et
 * n'aurait aucune raison d'être un troisième effet : les trois ne diffèrent que
 * par la TRAJECTOIRE le long de laquelle on intègre.
 *
 * CE QUE CE N'EST PAS : un flou. `lensBlur` intègre sur une SURFACE (l'ouverture
 * du diaphragme) à un instant donné ; celui-ci intègre le long d'une COURBE (la
 * trajectoire du sujet) pendant une durée. C'est pour ça qu'il ne partage pas
 * son noyau : un disque de bokeh n'a rien à faire ici, et une traînée n'a pas de
 * forme de diaphragme.
 *
 * QUATRE CHOSES QUI SÉPARENT ÇA D'UN « filtre Photoshop 2005 » :
 *
 * 1. **Le nombre d'échantillons suit la LONGUEUR de la traînée.** À nombre fixe,
 *    une traînée longue se décompose en copies fantômes espacées — le défaut le
 *    plus reconnaissable d'un motion blur raté, et exactement celui que
 *    `lensBlur` a montré avant correction. Un échantillon par texel, plafonné.
 * 2. **Le départ de l'échantillonnage est TIRÉ PAR PIXEL.** Même à densité
 *    correcte, une grille régulière laisse un moirage le long de la traînée ;
 *    le tirage le remplace par une granulation, qu'on ne voit pas.
 * 3. **L'obturateur est décentrable.** Un moteur physique intègre
 *    symétriquement autour de l'instant courant, ce qui fait déborder le sujet
 *    des DEUX côtés. Une photo veut souvent la traînée derrière le sujet et un
 *    bord net devant — c'est ce que fait un obturateur à rideau (second-curtain
 *    sync), et c'est ce que règle « Décentrage ».
 * 4. **La rotation est circulaire en PIXELS, pas en UV.** Sans correction
 *    d'aspect, un « flou de rotation » sur une photo 3:2 décrirait une ellipse,
 *    et le curseur d'angle mentirait sur toute sa course.
 *
 * COÛT : une collecte en demi-résolution (comme `lensBlur`, et pour la même
 * raison — la sortie reste en définition native, c'est une passe interne), puis
 * une passe finale pleine définition qui reprend le net quand la traînée tombe
 * sous le pixel.
 */

/** Étiquettes de la trajectoire. L'index EST la valeur du paramètre. */
const TRAJECTORIES = ["Directionnel", "Rotation", "Zoom"] as const;
const TRAJ_DIRECTIONAL = 0;

/** Plafond du nombre d'échantillons d'UNE passe, qui suit sinon la longueur de
 *  la traînée (environ un par texel). Même arbitrage que `TAPS_MAX` de
 *  `lensBlur`.
 *
 *  ⚠️ Ce plafond ne borne PLUS la longueur utile, depuis le 2026-08-02 : la
 *  collecte est en DEUX ÉTAGES (voir ci-dessous), donc la longueur atteignable
 *  est le produit des deux, soit `2 * SAMPLES_MAX²` pixels — très au-delà de ce
 *  que le curseur propose. */
const SAMPLES_MAX = 192;

/*
 * DEUX ÉTAGES DE COLLECTE — posé le 2026-08-02, sur un retour d'Antoine :
 * « ses paramètres ne sont pas assez extrêmes et on n'a pas assez de contrôle
 * dessus contrairement à Photoshop ». Photoshop va à 2000 px ; on plafonnait à
 * 120.
 *
 * ET MONTER LE MAXIMUM NE SUFFISAIT PAS, c'est même le piège. La collecte
 * prend environ un échantillon par texel, plafonné à `SAMPLES_MAX` : à 2000 px
 * pleine définition (1000 texels de demi-résolution) il en faudrait mille, donc
 * le plafond mordrait et laisserait un échantillon tous les cinq texels — le
 * chapelet de copies fantômes que ce fichier dit précisément vouloir éviter.
 * Étendre la plage sans toucher l'échantillonnage aurait livré un effet cassé
 * sur les trois quarts de son nouveau curseur.
 *
 * LA RÈGLE QUI GOUVERNE, écrite dans `.claude/learning-log.md` (2026-08-01,
 * « le pas et les taps ») : dans une chaîne à pas croissant, une passe dont les
 * taps vont jusqu'à ±N pas n'étale que sur ±N pas ; si la suivante multiplie le
 * pas par plus de N, elle laisse un trou de période égale au nouveau pas.
 *
 * D'où le découpage, qui satisfait la règle À ÉGALITÉ :
 *  - `M` = nombre de segments = ceil(longueur / SAMPLES_MAX), donc 1 tant que la
 *    traînée tient dans une seule passe.
 *  - ÉTAGE 1 (`MOTION_GATHER_WGSL`) intègre UN segment, de longueur
 *    `traînée / M`, centré sur chaque pixel.
 *  - ÉTAGE 2 (`MOTION_STITCH_WGSL`) prend `M` échantillons de l'étage 1, espacés
 *    d'exactement `traînée / M` — soit la largeur que l'étage 1 vient d'étaler.
 *    Aucun trou possible : les segments sont jointifs par construction.
 *
 * L'amortissement vient de là et de nulle part ailleurs : l'étage 2 REUTILISE
 * l'intégration que l'étage 1 a faite pour tous les autres pixels, au lieu de la
 * refaire. Un double boucle dans une seule passe coûterait le produit.
 *
 * `M = 1` EST LE CHEMIN D'AVANT, AU BIT PRÈS. L'étage 1 garde alors exactement
 * son code d'origine (pondération comprise) et l'étage 2 se réduit à un
 * échantillon unique, à la MÊME résolution — d'où `scale: 0.5` sur les deux, et
 * non un palier plus bas qui aurait ramolli tous les réglages courants. C'est ce
 * que la référence de pixels vérifie.
 *
 * QUAND `M > 1`, la pondération (`falloff`, `bias`) passe à l'étage 2 et
 * l'étage 1 devient une boîte plate. C'est le seul placement correct : le poids
 * dépend de la position GLOBALE dans la traînée, que seul l'étage 2 connaît.
 */

/** Facteur entre les dimensions vues par l'étage 2 et la pleine définition.
 *  L'étage 2 lit la sortie de l'étage 1, déclarée à `scale: 0.5` — le lien est
 *  donc ce `2`, et il casse si l'une des deux échelles change. Les trois vivent
 *  côte à côte pour cette raison. */
const STAGE1_SCALE = 0.5;
const STITCH_TO_FULL = 1 / STAGE1_SCALE;

/** Corps partagé par les deux passes : la longueur de traînée d'un pixel, en
 *  UV, selon la trajectoire. Les DEUX passes doivent en lire la même — la
 *  collecte pour savoir combien d'échantillons prendre, la passe finale pour
 *  savoir où reprendre le net. Deux définitions divergentes se verraient comme
 *  une frange au raccord (leçon de `lensBlur`, même remède). */
const TRAIL_WGSL = `
// POSITION d'échantillonnage au paramètre \`t\`, et non plus un vecteur de
// décalage à multiplier par \`t\`. Le changement date du 2026-08-02, quand la
// plage est passée à 2000 : la formulation vectorielle est une approximation au
// PREMIER ORDRE de la rotation, qu'un petit angle rendait invisible.
//
// Ce qu'elle faisait : \`d + perp(d) * θ\`, c'est-à-dire le premier terme du
// développement de la rotation. Le rayon y croît en \`sqrt(1 + θ²)\` — à un
// demi-tour il est multiplié par 3,3, et le « flou de rotation » file en ligne
// droite au lieu de tourner. Mesuré : à 360° les anneaux, qui devraient être
// parfaitement constants, portaient 20 % d'écart-type angulaire.
//
// Directionnel et Zoom étaient EXACTS et le restent : une droite est une droite,
// et l'ancien zoom radial additif se récrit \`d * (1 + t * amount)\`, donc déjà
// multiplicatif. Seule la rotation change.
fn motion_at(uv: vec2<f32>, t: f32, dims: vec2<f32>) -> vec2<f32> {
  let mode = i32(params[0] + 0.5);
  let amount = params[1];
  let angle = params[2] * 0.017453292519943295;
  let center = vec2<f32>(params[3], params[4]);

  if (mode == ${TRAJ_DIRECTIONAL}) {
    // Longueur en PIXELS pleine définition, convertie en UV par les dimensions
    // réelles : l'angle demandé est l'angle obtenu sur les deux axes.
    return uv + vec2<f32>(cos(angle), sin(angle)) * amount * t / dims;
  }

  let ar = aspectScale(dims);
  let d = (uv - center) * ar;
  if (mode == 1) {
    // ROTATION VRAIE. Deux propriétés qu'on ne gagne pas autrement : le rayon
    // est conservé à tout angle, et deux rotations se COMPOSENT en additionnant
    // leurs angles — ce dernier point est ce qui autorise le recoudre en deux
    // étages, l'étage 2 tournant la sortie déjà tournée de l'étage 1.
    let th = t * amount * 0.017453292519943295;
    let c = cos(th);
    let s = sin(th);
    return center + vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c) / ar;
  }
  // ZOOM : homothétie depuis le centre. Le déplacement croît avec la distance,
  // donc le centre reste net sans qu'aucun réglage ne le demande.
  return center + d * (1.0 + t * amount) / ar;
}

// Longueur de la trajectoire en PIXELS pleine définition. Séparée de la
// position parce que les deux étages en ont besoin sans échantillonner : l'un
// pour dimensionner son segment, l'autre pour espacer les siens.
fn motion_len_px(uv: vec2<f32>, dims: vec2<f32>) -> f32 {
  let mode = i32(params[0] + 0.5);
  let amount = params[1];
  let center = vec2<f32>(params[3], params[4]);

  if (mode == ${TRAJ_DIRECTIONAL}) {
    return abs(amount);
  }

  let ar = aspectScale(dims);
  let d = (uv - center) * ar;
  // \`ar\` normalise par sqrt(W*H) : remultiplier y ramène des PIXELS.
  let refPx = sqrt(dims.x * dims.y);
  if (mode == 1) {
    // Longueur d'ARC, donc proportionnelle au rayon — c'est ce qui fait qu'une
    // rotation laisse le centre net par construction.
    return length(d) * abs(amount) * 0.017453292519943295 * refPx;
  }
  return length(d) * abs(amount) * refPx;
}
`;

/** Nombre de SEGMENTS que l'étage 2 recoud, à partir de la longueur de traînée
 *  exprimée dans les texels de l'étage 1. Les deux étages DOIVENT en calculer
 *  exactement le même : l'étage 1 dimensionne son segment dessus, l'étage 2
 *  espace ses échantillons dessus. Deux définitions divergentes rouvriraient
 *  précisément le trou que ce découpage ferme. */
const SEGMENTS_WGSL = `
fn motion_segments(lenTexels: f32) -> f32 {
  return max(1.0, ceil(lenTexels / ${SAMPLES_MAX}.0));
}
`;

/** ÉTAGE 1 — intègre UN segment de la trajectoire, en demi-résolution. */
const MOTION_GATHER_WGSL = `
${UV_SPACE_WGSL}${HASH_WGSL}${TRAIL_WGSL}${SEGMENTS_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let bias = clamp(params[5], -1.0, 1.0);
  let falloff = clamp(params[6], 0.0, 1.0);

  // Longueur en PIXELS pleine définition. Sous un demi-pixel, la collecte
  // rendrait la copie du pixel central : autant ne rien faire.
  let lenTexels = motion_len_px(uv, dims);
  if (lenTexels < 0.5) {
    return color;
  }

  // Découpage en segments. À 1, tout tient dans cette passe et le code
  // ci-dessous EST celui d'avant les deux étages, pondération comprise.
  let segments = motion_segments(lenTexels);
  let single = segments < 1.5;

  // Un échantillon par texel du SEGMENT, plafonné. À nombre fixe, une traînée
  // longue se décompose en copies fantômes espacées.
  let n = clamp(i32(lenTexels / segments), 4, ${SAMPLES_MAX});
  let nf = f32(n);
  // Départ TIRÉ PAR PIXEL : une grille régulière laisse un moirage le long de
  // la traînée, que le tirage remplace par une granulation.
  let jitter = hash(uv * dims);

  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    // \`t\` court sur [-0.5, 0.5] : l'obturateur est centré sur l'instant
    // courant. \`bias\` le décale — à +1 toute la traînée part vers l'avant et
    // le sujet garde un bord net derrière lui.
    let t = (f32(i) + jitter) / nf - 0.5 + bias * 0.5;
    // Pondération : plate (obturateur franc) à \`falloff\` = 0, en cloche à 1.
    // La cloche n'est pas « plus correcte » — un obturateur mécanique EST
    // franc — mais elle donne la traînée qui s'éteint, qu'on attend d'un
    // filé photographique.
    let w = mix(1.0, 1.0 - abs(t) * 2.0, falloff);
    // À plusieurs segments, celui-ci est CENTRÉ sur le pixel et large de
    // \`1/segments\` de la traînée : ni décentrage ni pondération ici, les deux
    // dépendent de la position GLOBALE que seul l'étage 2 connaît. Le poids
    // devient plat et le segment se réduit d'autant.
    let tLocal = select(((f32(i) + jitter) / nf - 0.5) / segments, t, single);
    let wLocal = select(1.0, w, single);
    sum = sum + textureSampleLevel(srcTexture, srcSampler, mirrorUv(motion_at(uv, tLocal, dims)), 0.0) * wLocal;
    wsum = wsum + wLocal;
  }
  return sum / max(wsum, 0.0001);
}
`;

/** ÉTAGE 2 — recoud les segments. Son entrée est la SORTIE de l'étage 1 (les
 *  passes internes sont chaînées), donc ses dimensions valent celles de la
 *  pleine définition multipliées par `STAGE1_SCALE` : d'où la remise à l'échelle
 *  avant tout calcul de trajectoire, sans laquelle un filé directionnel serait
 *  deux fois trop long ici. */
const MOTION_STITCH_WGSL = `
${UV_SPACE_WGSL}${TRAIL_WGSL}${SEGMENTS_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let fullDims = dims * ${STITCH_TO_FULL}.0;
  let bias = clamp(params[5], -1.0, 1.0);
  let falloff = clamp(params[6], 0.0, 1.0);

  let lenTexels = motion_len_px(uv, fullDims);
  let segments = motion_segments(lenTexels);

  // UN SEUL SEGMENT : l'étage 1 a déjà tout fait, et cette passe doit rendre son
  // résultat INTACT. Même résolution des deux côtés (\`scale\` identique), donc
  // l'échantillon retombe au centre du texel et la copie est exacte — c'est ce
  // qui permet à la référence d'avant les deux étages de rester valable.
  if (segments < 1.5) {
    return color;
  }

  let m = i32(min(segments, ${SAMPLES_MAX}.0));
  let mf = f32(m);

  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var k = 0; k < m; k = k + 1) {
    // Centres de \`m\` segments jointifs couvrant [-0.5, 0.5] : l'espacement vaut
    // EXACTEMENT la largeur que l'étage 1 a étalée. C'est l'égalité de la règle
    // « le pas et les taps » — un pas plus grand laisserait un trou périodique.
    let t = (f32(k) + 0.5) / mf - 0.5 + bias * 0.5;
    let w = mix(1.0, 1.0 - abs(t) * 2.0, falloff);
    sum = sum + textureSampleLevel(srcTexture, srcSampler, mirrorUv(motion_at(uv, t, fullDims)), 0.0) * w;
    wsum = wsum + w;
  }
  return sum / max(wsum, 0.0001);
}
`;

export const motionBlur: EffectModule = {
  id: "motionBlur",
  name: "Motion blur",
  params: [
    { name: "trajectory", label: "Trajectoire", unit: "none", min: 0, max: TRAJECTORIES.length - 1, default: TRAJ_DIRECTIONAL, step: 1, choices: [...TRAJECTORIES], hint: "Directionnel : un filé en ligne droite. Rotation : le sujet tourne autour d'un point. Zoom : l'objectif zoome pendant la pose. Les deux dernières laissent le centre net par construction." },
    { name: "amount", label: "Amplitude", unit: "none", min: 0, max: 2000, default: 30, step: 0.5, hint: "Longueur du mouvement — en pixels pour un filé directionnel, en degrés pour une rotation, en fraction de la distance au centre pour un zoom. Va jusqu'à 2000 px comme le flou directionnel de Photoshop : la densité tient sur toute la course, la collecte se faisant en deux étages" },
    { name: "angle", label: "Direction", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "Axe du filé. Sans objet en Rotation et en Zoom, dont la direction vient du centre." },
    { name: "centerX", label: "Centre X", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Point autour duquel tourne ou depuis lequel part le mouvement. Sans objet en Directionnel." },
    { name: "centerY", label: "Centre Y", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Voir Centre X." },
    { name: "bias", label: "Décentrage de l'obturateur", unit: "percent", min: -1, max: 1, default: 0, step: 0.01, hint: "0 = la traînée déborde des deux côtés du sujet, comme une intégration symétrique. ±1 = elle part d'un seul côté et le sujet garde un bord net de l'autre, comme un obturateur à rideau" },
    { name: "falloff", label: "Extinction", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "0 = obturateur franc, toute la traînée à densité égale. 1 = elle s'éteint vers ses extrémités, le filé photographique" },
  ],
  canvasControls: [
    { id: "trajectory", kind: "axis", angle: "angle", length: "amount", label: "Trajectoire", visibleWhen: { param: "trajectory", equals: 0 } },
    { id: "center", kind: "point", x: "centerX", y: "centerY", label: "Centre", visibleWhen: { param: "trajectory", equals: [1, 2] } },
  ],
  passes: [
    { scale: STAGE1_SCALE, wgsl: MOTION_GATHER_WGSL },
    { scale: STAGE1_SCALE, wgsl: MOTION_STITCH_WGSL },
  ],
  wgsl: `
${UV_SPACE_WGSL}${TRAIL_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let lenPx = motion_len_px(uv, dims);
  let blurred = textureSample(prevPass, srcSampler, uv);

  // Reprise du NET sous le pixel. La collecte tourne en demi-résolution : là où
  // la traînée est plus courte qu'un pixel, son résultat est quand même passé
  // par un aller-retour de résolution, donc légèrement mou. C'est visible au
  // CENTRE d'une rotation ou d'un zoom, précisément l'endroit que ces deux
  // trajectoires sont censées laisser intact — un flou de rotation qui ramollit
  // son propre centre a raté ce qui le distingue d'un flou uniforme.
  //
  // Le seuil bas est le même que le court-circuit de la collecte (0.5 texel de
  // demi-résolution = 1 px pleine définition) : les deux chemins y coïncident,
  // donc le raccord est invisible par construction plutôt que par réglage.
  let sharpness = smoothstep(1.0, 2.0, lenPx);
  return vec4<f32>(mix(color.rgb, blurred.rgb, sharpness), color.a);
}
`,
};

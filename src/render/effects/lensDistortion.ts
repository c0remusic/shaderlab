import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { UV_SPACE_WGSL } from "./uvSpace";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Lens distortion — ce que la FORME du verre fait à l'image, par opposition à ce
 * que fait la lumière qu'il ne met pas au point (les flous) ou celle qu'il
 * renvoie (les halos).
 *
 * D'OÙ ÇA VIENT. Fiche Figma §6quater : « fisheye (`Distortion`) + aberration
 * avec trois modes (Lateral / Longitudinal / Anamorphic, "horizontal
 * cinema-lens split") ». Arbitrage d'Antoine du 2026-08-03 : tout va ici, y
 * compris la traînée anamorphique — `anamorphicStreak` est ABSORBÉ et son id
 * disparaît du registre (ADR-0014).
 *
 * SECONDE ABSORPTION LE LENDEMAIN : `chromaticBleed` (ADR-0016). Le recouvrement
 * avec le mode Latérale était déclaré ici dès l'écriture de ce fichier ; il a
 * été MESURÉ avant d'être conclu, et la mesure a dit deux choses au lieu d'une :
 *
 *   les deux effets, même mire, mêmes réglages   ->  0,005 % des canaux d'écart
 *   le tangentiel de l'absorbé vs son radial     ->   23,1 % des canaux d'écart
 *
 * Autrement dit le doublon était réel sur le cas radial — à une dizaine de
 * canaux sur 196 608 — et FAUX sur l'orientation. `chromaticBleed` savait
 * pivoter son décalage jusqu'à ±45°, ce qui donne des franges tangentielles au
 * lieu de radiales : la signature d'un objectif DÉCENTRÉ. Un grandissement
 * dépendant de la longueur d'onde, qui est ce que fait ce mode, ne produit que
 * du radial ; aucun réglage des quatre autres curseurs n'y changeait rien.
 *
 * D'où `aberrationAngle`, ajouté en fin de liste. **Un seul paramètre pour tout
 * un effet** : les quatre autres (`amount` -> `aberration`, `centerFalloff`,
 * `centerPresence`, `asymmetry`) existaient déjà ici sous les mêmes noms et la
 * même algèbre. C'est ce qui rendait le retrait légitime, et c'est la mesure qui
 * l'a établi plutôt qu'une lecture comparée des deux fichiers.
 *
 * ─── LA GÉOMÉTRIE ───────────────────────────────────────────────────────────
 *
 * Un objectif ne projette pas la scène sur un plan par une simple homothétie :
 * le grandissement varie avec la distance à l'axe. C'est le modèle radial
 * classique, `r' = r · (1 + k·r²)`, appliqué DANS L'ESPACE CORRIGÉ DE L'ASPECT.
 * Sans cette correction, la même valeur de `k` déformerait plus en hauteur qu'en
 * largeur sur une photo 3:2 — la distorsion cesserait d'être radiale et le
 * curseur mentirait, exactement le défaut qu'`uvSpace.ts` a été écrit pour
 * empêcher.
 *
 * Le signe compte et il est exposé : positif = barillet (le monde bombe vers
 * l'objectif, c'est le fisheye), négatif = coussinet (les bords rentrent, c'est
 * ce que fait un téléobjectif). Zéro est l'identité EXACTE — pas « visuellement
 * neutre » : `f` vaut alors 1 et l'UV est rendue telle quelle.
 *
 * Le `zoom` existe parce que le barillet DÉCOUVRE les coins : le disque source
 * ne couvre plus le cadre, et sans lui on verrait le bord replié de la mire. Il
 * est laissé à 1 par défaut et pas calculé automatiquement — le recadrage est
 * une décision de cadrage, pas une conséquence.
 *
 * ─── LES TROIS ABERRATIONS, ET CE QUI LES SÉPARE VRAIMENT ───────────────────
 *
 * Elles ne sont pas trois réglages du même phénomène ; ce sont trois phénomènes,
 * et leur signature géométrique diffère :
 *
 * - **Latérale** : le grandissement dépend de la longueur d'onde. Le décalage
 *   est RADIAL et croît du centre vers les coins — donc nul au centre, ce qui
 *   est la signature qu'on vérifie. C'est l'aberration des bords d'image.
 * - **Longitudinale** : c'est le PLAN DE MISE AU POINT qui dépend de la longueur
 *   d'onde. Elle ne déplace rien : elle défocalise différemment chaque canal, et
 *   se voit donc UNIFORMÉMENT sur toute l'image, y compris au centre où la
 *   latérale ne fait rien. C'est le liseré violet/vert des grandes ouvertures.
 *   Rendue par un anneau de quatre taps de rayon différent par canal — le vert
 *   reste net, il sert de référence de mise au point.
 * - **Anamorphique** : le « horizontal cinema-lens split » de la fiche. Le
 *   décalage est purement HORIZONTAL et ne dépend pas du rayon : un anamorphique
 *   comprime un seul axe, donc son verre cylindrique disperse sur cet axe et pas
 *   sur l'autre.
 *
 * Un test de rendu par mode, parce qu'aucun des trois ne se déduit d'un autre.
 *
 * ─── LA TRAÎNÉE, ET POURQUOI ELLE NE COÛTE PLUS RIEN QUAND ELLE EST ÉTEINTE ──
 *
 * Elle vient de `anamorphicStreak`, absorbée sans changer sa physique : un
 * bright-pass qui JETTE la couleur de la source (la traînée prend sa teinte du
 * traitement de l'objectif — une lampe verte donne une traînée bleue), puis
 * trois passes d'étalement directionnel à pas croissants.
 *
 * Ces quatre passes sont désormais CONDITIONNELLES (`EffectPass.enabled`, posé
 * le même jour) : à intensité nulle elles ne tournent pas, et surtout elles
 * n'ALLOUENT pas. C'est ce qui rend l'absorption acceptable — sans ça, poser
 * lensDistortion pour un simple fisheye aurait fait tourner quatre passes de
 * demi-résolution pour rien, soit ~24 Mo empruntés sur une image de 24 Mpx.
 *
 * ⚠️ QUAND LES PASSES SAUTENT, `prevPass` EST LA TEXTURE SOURCE. C'est le piège
 * que le type `EffectPass.enabled` documente. Ici il est neutralisé par
 * construction : l'énergie lue est multipliée par `streakIntensity`, qui vaut
 * alors zéro — la condition du prédicat et celle du composite sont la MÊME
 * expression, et un test le vérifie.
 */

/** Pas de chaque passe d'étalement. Facteur 4 : à 2 il faudrait plus de passes
 *  pour la même portée, à 8 il dépasserait les ±4 pas que couvre une passe et
 *  le peigne reviendrait. Ce facteur est LIÉ au nombre de taps de `streakPass`
 *  — changer l'un sans l'autre ramène le chapelet de billes que le témoin de
 *  rendu a montré sur la première version d'`anamorphicStreak`. */
const STRIDE = [1, 4, 16] as const;

/** Index des paramètres lus par les passes internes. Ils étaient EN DUR dans
 *  `anamorphicStreak`, où la traînée occupait les premiers rangs ; ici elle
 *  vient après la géométrie et l'aberration, donc les corps de passe doivent
 *  connaître leurs index. Déclarés une fois, à côté de la liste de paramètres
 *  qu'ils indexent — c'est la seule façon que le décalage se voie. */
const P_STREAK_THRESHOLD = 7;
const P_STREAK_LENGTH = 8;
const P_STREAK_ANGLE = 9;
const P_STREAK_INTENSITY = 10;

/** Modes d'aberration. ⚠️ L'index est PERSISTÉ dans les presets : on ajoute à la
 *  FIN. `Latérale` est en tête parce que c'est celle que tout le monde connaît
 *  sous le nom d'« aberration chromatique ». */
const ABERRATION_MODES = ["Latérale", "Longitudinale", "Anamorphique"] as const;
const ABERRATION_LATERAL = 0;
const ABERRATION_LONGITUDINAL = 1;

/** Index de l'orientation du décalage latéral. Ajouté À LA FIN de la liste le
 *  2026-08-03 en absorbant `chromaticBleed` (ADR-0016), donc LOIN des autres
 *  réglages d'aberration dans le panneau — l'index est persisté dans les
 *  presets, et le confort de rangement ne vaut pas de déplacer les quinze
 *  autres. */
const P_ABERRATION_ANGLE = 15;

const STREAK_BRIGHT_WGSL = `
${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Seuil DÉCODÉ vers le linéaire : c'est une valeur de curseur, donc
  // perceptuelle, comparée à une luminance qui vient du format -srgb et est
  // donc linéaire. Précédent : le bright-pass du glow, dont ce décodage
  // manquant rendait le curseur inerte sur 85 % de sa course.
  let seuil = srgb_to_linear(clamp(params[${P_STREAK_THRESHOLD}], 0.0, 1.0));
  let l = max(color.r, max(color.g, color.b));
  // Genou doux plutôt que bascule : une coupure franche fait clignoter la
  // traînée quand une haute lumière traverse le seuil d'un cran d'exposition.
  let e = max(l - seuil, 0.0) / max(1.0 - seuil, 0.0001);
  return vec4<f32>(vec3<f32>(e * e), 1.0);
}
`;

/** Une passe d'étalement directionnel. `stride` est baké dans le corps — le pas
 *  DOIT différer d'une passe à l'autre, et `passes` n'a aucun moyen de dire à
 *  une passe quel rang elle occupe. */
const streakPass = (stride: number) => `
${UV_SPACE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let angle = radians(params[${P_STREAK_ANGLE}]);
  // Direction de la traînée, en UV. La correction d'aspect passe par
  // \`aspectScale\` : sans elle, une traînée à 30° sortirait à un autre angle sur
  // une photo 3:2, et le curseur mentirait.
  let ar = aspectScale(dims);
  let dir = vec2<f32>(cos(angle), sin(angle)) / ar;
  // Portée en pixels pleine définition ; la passe tourne à 1/2, d'où le facteur.
  let pas = dir * (max(params[${P_STREAK_LENGTH}], 0.0) * 0.5 * ${stride}.0) / dims;

  // HUIT taps symétriques, jusqu'à ±4 pas — et non ±2. Une passe couvre donc
  // ±4 pas, ce qui est exactement le facteur par lequel la passe suivante
  // multiplie le pas : la couverture est continue, sans trou. À ±2 taps pour un
  // facteur 4, la traînée perle en chapelet de billes.
  var sum = textureSample(srcTexture, srcSampler, uv).rgb;
  var w = 1.0;
  for (var i = 1; i <= 4; i = i + 1) {
    let d = pas * f32(i);
    let poids = 1.0 / (1.0 + f32(i));
    sum = sum + textureSample(srcTexture, srcSampler, mirrorUv(uv + d)).rgb * poids;
    sum = sum + textureSample(srcTexture, srcSampler, mirrorUv(uv - d)).rgb * poids;
    w = w + poids * 2.0;
  }
  return vec4<f32>(sum / w, 1.0);
}
`;

/** La traînée sert-elle ? Une seule expression, partagée par le prédicat des
 *  quatre passes ET par le composite final — c'est ce qui garantit que
 *  `prevPass` n'est jamais lu comme un champ utile quand il porte la source. */
const streakActive = (params: Record<string, number>) => params.streakIntensity > 0;

export const lensDistortion: EffectModule = {
  id: "lensDistortion",
  name: "Lens distortion",
  params: [
    { name: "distortion", label: "Distorsion", unit: "percent", min: -1, max: 1, default: 0, step: 0.01, hint: "Positif = barillet, le monde bombe vers l'objectif (fisheye). Négatif = coussinet, les bords rentrent. 0 = l'identité exacte, pas une approximation" },
    { name: "zoom", label: "Recadrage", unit: "none", min: 0.5, max: 2, default: 1, step: 0.01, hint: "Le barillet DÉCOUVRE les coins : le disque source ne couvre plus le cadre. Monter ce curseur recadre dedans. Laissé à 1 par défaut — un recadrage est une décision, pas une conséquence" },

    { name: "aberration", label: "Aberration", unit: "percent", min: 0, max: 0.2, default: 0, step: 0.001, hint: "Force de la séparation des couleurs. 0 = aucune, donc le mode ci-dessous est sans objet" },
    { name: "aberrationMode", label: "Mode d'aberration", unit: "none", min: 0, max: ABERRATION_MODES.length - 1, default: ABERRATION_LATERAL, step: 1, choices: [...ABERRATION_MODES], hint: "Latérale : le décalage est radial et croît vers les coins — nul au centre. Longitudinale : ce n'est pas un décalage mais une mise au point qui diffère par canal, donc elle se voit PARTOUT, centre compris. Anamorphique : décalage purement horizontal, indépendant du rayon — le verre cylindrique du cinéma" },
    { name: "centerFalloff", label: "Croissance vers les coins", unit: "none", min: 0.5, max: 4, default: 2, step: 0.1, hint: "Vitesse à laquelle le décalage croît du centre vers les coins. Sans objet hors du mode Latérale" },
    { name: "centerPresence", label: "Présence au centre", unit: "percent", min: 0, max: 1, default: 0.2, step: 0.01, hint: "Part du décalage des coins déjà présente au centre — 0 = aberration purement périphérique. Sans objet hors du mode Latérale" },
    { name: "asymmetry", label: "Asymétrie R/B", unit: "none", min: -1, max: 1, default: 0.15, step: 0.01, hint: "Déséquilibre entre la course du rouge et celle du bleu — un verre réel ne disperse pas les deux également" },

    { name: "streakThreshold", label: "Seuil de la traînée", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, hint: "À partir de quel ton une lumière provoque une traînée. Haut = seules les sources franches, ce qui est le cas réel" },
    { name: "streakLength", label: "Longueur", unit: "pixels", min: 4, max: 400, default: 90, step: 1, hint: "Portée de la traînée, en pixels pleine définition" },
    { name: "streakAngle", label: "Orientation", unit: "degrees", min: 0, max: 180, default: 0, step: 1, hint: "0° = horizontale, l'orientation d'un anamorphique de cinéma. L'axe du cylindre de l'objectif" },
    // ⚠️ CE CURSEUR PILOTE AUSSI LE PIPELINE, pas seulement le rendu : à 0 les
    // quatre passes internes ne tournent pas et n'allouent rien. Son défaut est
    // donc 0 — poser cet effet pour un fisheye ne doit rien coûter de plus.
    { name: "streakIntensity", label: "Intensité de la traînée", unit: "none", min: 0, max: 4, default: 0, step: 0.05, hint: "Force du composite additif. C'est une lumière parasite : elle s'AJOUTE, elle ne remplace rien. À 0, les quatre passes internes de la traînée ne tournent PAS — l'effet ne coûte alors que sa géométrie" },
    { name: "streakTintHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 210, step: 1, colorGroup: { key: "tint", role: "hue", label: "Traitement de l'objectif" } },
    { name: "streakTintSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.8, step: 0.01, colorGroup: { key: "tint", role: "saturation", label: "Traitement de l'objectif" } },
    { name: "streakTintLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "tint", role: "lightness", label: "Traitement de l'objectif" } },
    { name: "streakDispersion", label: "Dispersion de la traînée", unit: "percent", min: 0, max: 1, default: 0.25, step: 0.01, hint: "Fait virer la teinte vers les extrémités — le traitement anti-reflet ne filtre pas pareil aux grands angles. 0 = traînée d'un bleu uniforme, ce qu'aucun objectif ne fait" },
    // ── CE QUI VIENT DE `chromaticBleed` (absorption du 2026-08-03) ──────────
    // UN SEUL paramètre : les quatre autres de l'effet retiré (`amount`,
    // `centerFalloff`, `centerPresence`, `asymmetry`) existaient déjà ici sous
    // les mêmes noms et la même algèbre. Mesuré avant le geste, sur la même
    // mire et aux mêmes réglages : les deux effets s'écartaient de 0,005 % des
    // canaux. Celui-ci, lui, manquait — et il vaut 23,1 % d'écart.
    { name: "aberrationAngle", label: "Orientation du décalage", unit: "degrees", min: -45, max: 45, default: 0, step: 1, hint: "0 = décalage purement radial, ce que fait un objectif centré. ±45° = franges TANGENTIELLES, la signature d'un objectif décentré. Sans objet hors du mode Latérale — un décalage longitudinal n'a pas de direction, et l'anamorphique a la sienne" },
  ],
  passes: [
    { scale: 0.5, wgsl: STREAK_BRIGHT_WGSL, enabled: streakActive },
    { scale: 0.5, wgsl: streakPass(STRIDE[0]), enabled: streakActive },
    { scale: 0.5, wgsl: streakPass(STRIDE[1]), enabled: streakActive },
    { scale: 0.5, wgsl: streakPass(STRIDE[2]), enabled: streakActive },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}

/** UV source d'un point du cadre, pour un facteur radial donné.
 *  \`p\` est centré et CORRIGÉ DE L'ASPECT ; \`ar\` ramène en UV. */
fn lensUv(p: vec2<f32>, ar: vec2<f32>, facteur: f32) -> vec2<f32> {
  return mirrorUv(p * facteur / ar + vec2<f32>(0.5));
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let distortion = params[0];
  let zoom = max(params[1], 0.0001);
  let aberration = max(params[2], 0.0);
  let mode = i32(params[3] + 0.5);
  let falloff = max(params[4], 0.0001);
  let centerPresence = clamp(params[5], 0.0, 1.0);
  let asymmetry = params[6];
  let streakIntensity = max(params[${P_STREAK_INTENSITY}], 0.0);
  let angleAberration = radians(params[${P_ABERRATION_ANGLE}]);

  // POINT COURANT, centré et isotrope. Tout le calcul radial vit ici : une même
  // distance y vaut le même nombre de pixels en x et en y, donc le fisheye est
  // rond sur une photo 3:2 au lieu d'être ovale.
  let p = (uv - vec2<f32>(0.5)) * ar;
  let r2 = dot(p, p);

  // GÉOMÉTRIE. \`1 + k·r²\` : à k = 0 le facteur vaut exactement 1, donc l'UV
  // rendue est l'UV reçue et le curseur au repos est l'identité au bit près —
  // ce que la référence de rendu vérifie contre la photo nue.
  let geom = (1.0 + distortion * r2) / zoom;

  // PROFIL RADIAL DE L'ABERRATION LATÉRALE : nul au centre, croissant vers les
  // coins. \`centerPresence\` relève le plancher pour ceux qui veulent la voir
  // partout — mais son défaut bas est ce qui rend la signature lisible.
  let profil = mix(pow(clamp(r2 * 2.0, 0.0, 1.0), falloff * 0.5), 1.0, centerPresence);
  let courseR = aberration * (1.0 + asymmetry);
  let courseB = aberration * (1.0 - asymmetry);

  var uvR = lensUv(p, ar, geom);
  var uvG = lensUv(p, ar, geom);
  var uvB = lensUv(p, ar, geom);
  // Rayon de défocalisation par canal, en UV. Nul hors du mode longitudinal.
  var flouR = 0.0;
  var flouB = 0.0;

  if (mode == ${ABERRATION_LATERAL}) {
    // Le grandissement dépend de la longueur d'onde : c'est une ÉCHELLE, donc
    // elle se compose avec celle de la géométrie au lieu de s'y ajouter.
    uvR = lensUv(p, ar, geom * (1.0 + courseR * profil));
    uvB = lensUv(p, ar, geom * (1.0 - courseB * profil));

    // ORIENTATION DU DÉCALAGE (absorption de \`chromaticBleed\`, 2026-08-03).
    //
    // ⚠️ POURQUOI UNE BRANCHE, ET PAS UNE ROTATION APPLIQUÉE TOUJOURS. Les deux
    // écritures sont algébriquement égales à angle nul, et PAS égales en
    // flottant : \`p·geom·(1+k)\` n'est pas bit pour bit \`p·geom + p·geom·k\`.
    // Or le défaut est 0 et \`effet-lens-distortion-laterale\` fige cette image.
    // La branche garde donc à l'identique le chemin que la référence a verrouillé,
    // et l'écriture par décalage ne sert que là où elle est nécessaire.
    //
    // ⚠️ LA ROTATION SE FAIT DANS L'ESPACE CORRIGÉ DE L'ASPECT, avant la
    // reconversion en UV. La faire après serait une rotation dans un espace
    // anisotrope, c'est-à-dire un cisaillement déguisé sur toute image non
    // carrée — l'effet absorbé portait déjà cet avertissement, il aurait été
    // dommage de le reperdre en le déplaçant.
    if (angleAberration != 0.0) {
      let base = p * geom;
      let ca = cos(angleAberration);
      let sa = sin(angleAberration);
      let dR = base * (courseR * profil);
      let dB = base * (-(courseB * profil));
      uvR = mirrorUv((base + vec2<f32>(dR.x * ca - dR.y * sa, dR.x * sa + dR.y * ca)) / ar + vec2<f32>(0.5));
      uvB = mirrorUv((base + vec2<f32>(dB.x * ca - dB.y * sa, dB.x * sa + dB.y * ca)) / ar + vec2<f32>(0.5));
    }
  } else if (mode == ${ABERRATION_LONGITUDINAL}) {
    // AUCUN déplacement : c'est le plan de mise au point qui diffère. Le vert
    // reste net et sert de référence — c'est lui qu'on met au point dans un
    // viseur, et c'est pour ça que le défaut se lit en liseré violet/vert.
    flouR = courseR * 0.5;
    flouB = courseB * 0.5;
  } else {
    // ANAMORPHIQUE : décalage purement HORIZONTAL et INDÉPENDANT du rayon. Un
    // verre cylindrique ne disperse que sur l'axe qu'il comprime, donc le
    // profil radial n'a rien à y faire — c'est ce qui le distingue du latéral,
    // et pas une question de force.
    let ecart = vec2<f32>(aberration, 0.0);
    uvR = lensUv(p + ecart * (1.0 + asymmetry), ar, geom);
    uvB = lensUv(p - ecart * (1.0 - asymmetry), ar, geom);
  }

  // Défocalisation par canal : anneau de quatre taps. Quatre suffisent parce
  // que le rayon reste petit — au-delà, c'est un flou d'objectif qu'on
  // demande, et il a son propre effet (\`lensBlur\`).
  var r = textureSample(srcTexture, srcSampler, uvR).r;
  var b = textureSample(srcTexture, srcSampler, uvB).b;
  if (flouR > 0.0 || flouB > 0.0) {
    let dR = vec2<f32>(flouR) / ar;
    let dB = vec2<f32>(flouB) / ar;
    r = (r
      + textureSample(srcTexture, srcSampler, mirrorUv(uvR + vec2<f32>(dR.x, 0.0))).r
      + textureSample(srcTexture, srcSampler, mirrorUv(uvR - vec2<f32>(dR.x, 0.0))).r
      + textureSample(srcTexture, srcSampler, mirrorUv(uvR + vec2<f32>(0.0, dR.y))).r
      + textureSample(srcTexture, srcSampler, mirrorUv(uvR - vec2<f32>(0.0, dR.y))).r) * 0.2;
    b = (b
      + textureSample(srcTexture, srcSampler, mirrorUv(uvB + vec2<f32>(dB.x, 0.0))).b
      + textureSample(srcTexture, srcSampler, mirrorUv(uvB - vec2<f32>(dB.x, 0.0))).b
      + textureSample(srcTexture, srcSampler, mirrorUv(uvB + vec2<f32>(0.0, dB.y))).b
      + textureSample(srcTexture, srcSampler, mirrorUv(uvB - vec2<f32>(0.0, dB.y))).b) * 0.2;
  }
  let g = textureSample(srcTexture, srcSampler, uvG);
  var sortie = vec3<f32>(r, g.g, b);

  // TRAÎNÉE, lue à l'UV DÉFORMÉE : elle appartient à l'image, donc elle subit la
  // même géométrie qu'elle. La lire à \`uv\` la laisserait droite sur un fisheye,
  // ce qui trahirait qu'elle est ajoutée après coup.
  //
  // ⚠️ Multipliée par \`streakIntensity\`, qui est la MÊME expression que le
  // prédicat des quatre passes. Quand elles sautent, \`prevPass\` porte la texture
  // source — et ce produit vaut alors zéro, donc rien de cette source ne fuit
  // dans le résultat. C'est le piège documenté sur \`EffectPass.enabled\`,
  // neutralisé par construction plutôt que par prudence.
  let energie = textureSample(prevPass, srcSampler, uvG).r;
  let vire = (1.0 - clamp(energie * 4.0, 0.0, 1.0)) * clamp(params[14], 0.0, 1.0);
  let teinte = fract(params[11] / 360.0 + vire * 0.12);
  let tint = srgb_to_linear3(hsl2rgb(teinte, params[12], params[13]));
  sortie = sortie + tint * energie * streakIntensity;

  // L'alpha suit la GÉOMÉTRIE et non le canal vert : une toile de montage a de
  // vraies régions transparentes, et les déformer sans déformer leur couverture
  // ferait baver la silhouette d'un pixel sur toute la course du fisheye.
  return vec4<f32>(sortie, g.a);
}
`,
};

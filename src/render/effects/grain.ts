import type { EffectModule } from "./types";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { LINEAR_TO_SRGB_WGSL, SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";

/**
 * RÉSOLUTION DE RÉFÉRENCE du grain ARGENTIQUE, en pixels de grand côté.
 *
 * Pourquoi une constante et pas la taille de l'image. Avant le 2026-08-01, la
 * maille valait `size` pixels de l'image SOURCE : `(uv * dims) / size`.
 * Conséquence, mesurée sur le rapport des dimensions : à réglage identique, une
 * photo 24 MP (6000 px de grand côté) recevait 3000 cellules de grain sur sa
 * largeur et une 6 MP (3000 px) n'en recevait que 1500 — soit un grain deux fois
 * plus GROS relativement au cadre. Le curseur prétendait décrire une taille de
 * grain physique et décrivait en fait une taille en pixels de sortie.
 *
 * C'est l'écart que la littérature reproche aux grains procéduraux : le modèle
 * d'IPOL (Newson et al.) est bâti pour être indépendant de la résolution, au
 * point qu'on puisse zoomer jusqu'au grain individuel. Un film n'a pas une
 * granulométrie qui dépend de la taille du scan.
 *
 * ⚠️ Ne s'applique QU'AU mode analogique. Le bruit numérique est délibérément
 * lié au pixel — voir `GRAIN_MODES`.
 *
 * ⚠️ Le code de référence d'IPOL est en GPL v3+ : lu, jamais repris.
 */
export const GRAIN_REFERENCE_EDGE = 3000.0;

/**
 * Compensation d'amplitude du bruit de valeur, pour que les deux modes
 * délivrent la MÊME force à intensité égale.
 *
 * `hash` rend une valeur uniforme sur [0,1) : variance 1/12. `valueNoise`
 * interpole quatre de ces tirages par des poids `smoothstep`, ce qui RÉDUIT sa
 * variance — une moyenne pondérée de variables indépendantes varie moins que
 * chacune d'elles. Le facteur se calcule exactement.
 *
 * En 1D, la valeur vaut (1-s)·X0 + s·X1 avec s = smoothstep(f) = 3f² - 2f³. La
 * variance relative est donc s² + (1-s)², dont la moyenne sur f ∈ [0,1] vaut :
 *   ∫(2s² - 2s + 1) df = 2·(3/5 - 2 + 10/7 ... ) = 0.7429
 *   [∫s df = 1/2 ; ∫s² df = 9/5 - 12/6 + 4/7 = 0.3714]
 * En 2D les deux axes sont indépendants et les poids se multiplient :
 *   0.7429² = 0.5519  ->  écart-type relatif = √0.5519 = 0.743
 *
 * Sans compensation, basculer d'analogique à numérique renforcerait le grain de
 * ~35 % sans qu'aucun curseur ne bouge — et `intensity` cesserait d'être le seul
 * réglage de force, ce qui est exactement le couplage qu'on paie six mois plus
 * tard.
 */
export const GRAIN_VALUE_NOISE_GAIN = 1.0 / 0.743;

/** Étiquettes du sélecteur de mode. L'index EST la valeur du paramètre. */
export const GRAIN_MODES = ["Analogique (argentique)", "Numérique (capteur)"];

export const grain: EffectModule = {
  id: "grain",
  name: "Grain",
  params: [
    // Le mode vient EN PREMIER parce qu'il ne dose rien : il choisit lequel des
    // deux phénomènes on simule. Les curseurs qui suivent se lisent différemment
    // selon sa position, et un réglage qui change le sens des autres se pose
    // au-dessus d'eux.
    //
    // POURQUOI UN CHOIX ET NON UN CURSEUR. `channelMixer.monochrome` est
    // délibérément continu, et l'argument y est juste : c'est le même calcul à
    // deux dosages, les valeurs intermédiaires sont des désaturations partielles
    // réelles. Ici les deux modes ont des RÉPONSES TONALES OPPOSÉES —
    // l'argentique culmine au demi-ton, le numérique dans les ombres.
    // Interpoler entre les deux produirait une courbe qui ne modélise ni un film
    // ni un capteur : une moyenne de deux physiques n'est la physique de rien.
    { name: "mode", label: "Type", unit: "none", min: 0, max: 1, default: 0, step: 1, choices: GRAIN_MODES, hint: "Argentique : cellules irrégulières, maximal au demi-ton, indépendant de la définition. Capteur : bruit blanc par pixel, maximal dans les ombres." },
    { name: "intensity", label: "Intensité", unit: "percent", min: 0, max: 0.4, default: 0.12, step: 0.01 },
    { name: "size", label: "Taille", unit: "pixels", min: 1, max: 8, default: 2, step: 0.5, hint: "Argentique : taille d'une cellule rapportée à une photo de 3000 px de grand côté. Capteur : taille du bloc en pixels réels (1 = un photosite)." },
    // Le grain était strictement monochrome avant le 2026-08-01 : un seul
    // scalaire ajouté aux trois canaux. C'est le tell le plus direct d'un grain
    // numérique — un film COULEUR a trois émulsions superposées, excitées dans
    // des proportions différentes selon la couleur du sujet. La source FilmMatch
    // le formule sans détour : une plaque de grain fixe « paraît juste sur un
    // mur gris et fausse sur un visage ».
    //
    // Utile dans les DEUX modes, et c'est pourquoi c'est un axe séparé du mode :
    // un capteur produit du bruit de chrominance marqué (taches rougeâtres et
    // verdâtres), un film en produit peu. Le mode choisit la texture, celui-ci
    // choisit la couleur, `intensity` choisit la force. Trois axes orthogonaux.
    { name: "chroma", label: "Chrominance", unit: "percent", min: 0, max: 1, default: 0.3, step: 0.01, hint: "0 = les trois canaux bougent ensemble (bruit de luminance pur) ; 1 = trois couches indépendantes, taches colorées" },
    { name: "seed", label: "Graine", unit: "none", min: 0, max: 1000, default: 0, step: 1 },
  ],
  /**
   * DEUX SECTIONS : le CHAMP de bruit, et la façon dont l'image le module.
   *
   * `mode` est le seul paramètre à choix de l'effet, et il ne commande pourtant
   * aucune condition — les quatre curseurs servent dans les deux modes. Le
   * découpage est donc THÉMATIQUE, comme sur les trois autres petits effets de
   * cette passe, et il ne masque rien.
   *
   * OÙ TOMBE LE TYPE, et c'est le seul arbitrage du fichier. Il décide de deux
   * choses à la fois : la structure spatiale du bruit (cellules corrélées contre
   * bruit blanc, et la maille qui va avec) et la COURBE de réponse tonale
   * (maximale au demi-ton pour l'argentique, dans les ombres pour le capteur).
   * Il est rangé avec la réponse parce que c'est la courbe qui décide de ce
   * qu'on VOIT, et parce que c'est elle qui interdit d'en faire un curseur —
   * deux courbes opposées n'ont pas de milieu qui modélise quoi que ce soit
   * (voir l'en-tête du paramètre). Sa maille, elle, se règle dans « Grain » avec
   * la taille.
   *
   * CE QUI REND LA FRONTIÈRE VÉRIFIABLE : l'amplitude du grain à un ton donné
   * vaut exactement `intensity × response(tone)`. La section « Réponse tonale »
   * contient donc les deux termes du produit, et les trois autres paramètres
   * décrivent un champ de bruit qui ne sait rien du ton de l'image.
   *
   * L'ordre affiché suit `params[]`, qui ne bouge pas : le Type ouvre le
   * panneau, ce que l'en-tête de la liste demande déjà — un réglage qui change
   * le sens des autres se pose au-dessus d'eux. Conséquence assumée : le titre
   * qui ouvre la carte est « Réponse tonale » et non « Grain ».
   */
  sections: [
    { id: "reponse", label: "Réponse tonale", layout: "liste", params: ["mode", "intensity"] },
    // Le champ de bruit lui-même : sa maille, sa répartition sur les trois
    // couches, son tirage. Trois réglages de la MATIÈRE, indépendants de ce que
    // l'image contient.
    { id: "grain", label: "Grain", layout: "liste", params: ["size", "chroma", "seed"] },
  ],
  wgsl: `${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${HASH_WGSL}${VALUE_NOISE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let numerique = params[0] >= 0.5;
  let intensity = params[1];
  let size = max(params[2], 0.0001);
  let chroma = clamp(params[3], 0.0, 1.0);
  let seed = params[4];
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let jitter = vec2<f32>(seed * 17.0, seed * 9.0);

  // Décalages des deux autres couches. Volontairement grands et non
  // commensurables entre eux : deux décalages proches feraient trois bruits
  // CORRÉLÉS, c'est-à-dire un grain monochrome déguisé qui coûterait trois fois
  // le prix.
  let offG = vec2<f32>(137.31, 71.79);
  let offB = vec2<f32>(283.17, 359.23);

  // ─── MAILLE ANALOGIQUE : indépendante de la définition ───────────────────
  // Le nombre de cellules sur le grand côté ne dépend que de \`size\`. Le rapport
  // dims/longEdge conserve l'aspect, donc les cellules restent carrées sur une
  // photo non carrée (une maille étirée ferait un grain peigné, très visible sur
  // un ciel).
  let longEdge = max(dims.x, dims.y);
  let cells = ${GRAIN_REFERENCE_EDGE} / size;
  let ap = uv * (dims / longEdge) * cells + jitter;

  // ─── MAILLE NUMÉRIQUE : le photosite ─────────────────────────────────────
  // Liée au PIXEL, et c'est volontaire : un capteur a une grille physique, son
  // bruit ne peut pas être indépendant de la définition. C'est la différence de
  // nature entre les deux modes, pas une incohérence. \`floor\` rend le tirage
  // constant par cellule — sans lui, \`size\` n'aurait aucun effet en numérique.
  let dp = floor(uv * dims / size) + jitter;

  // ─── STRUCTURE SPATIALE ──────────────────────────────────────────────────
  // Argentique : bruit de valeur, donc CORRÉLÉ spatialement — les cristaux
  // d'argent s'agglomèrent et débordent du pixel. Capteur : bruit BLANC, chaque
  // photosite tire indépendamment de ses voisins. La source le dit sans détour :
  // le bruit RAW est gaussien, sans structure spatiale, et c'est précisément
  // cette absence de corrélation qui le rend désagréable à l'œil là où le grain
  // argentique, irrégulier, est plaisant.
  let analogique = vec3<f32>(
    valueNoise(ap) - 0.5,
    valueNoise(ap + offG) - 0.5,
    valueNoise(ap + offB) - 0.5
  ) * ${GRAIN_VALUE_NOISE_GAIN};
  let capteur = vec3<f32>(
    hash(dp) - 0.5,
    hash(dp + offG) - 0.5,
    hash(dp + offB) - 0.5
  );
  let couches = select(analogique, capteur, numerique);

  // ─── CARACTÈRE DE CANAL ──────────────────────────────────────────────────
  // \`nLuma\` est la part COMMUNE aux trois couches — ce que le grain était en
  // entier avant le 2026-08-01.
  let nLuma = (couches.r + couches.g + couches.b) / 3.0;

  // NORMALISATION D'AMPLITUDE, et pourquoi elle n'est pas facultative.
  // \`mix(vec3(nLuma), couches, chroma)\` est la réponse évidente et elle fait
  // varier la FORCE du grain alors que le curseur ne prétend régler que sa
  // couleur. Le calcul : pour trois bruits indépendants de variance s^2,
  //   Var(mix) = s^2 * [ (1-t)^2/3 + t^2 + 2t(1-t)/3 ] = s^2 * [ 1/3 + (2/3)t^2 ]
  // (le terme croisé n'est pas nul — nLuma CONTIENT le bruit du canal). D'où
  // 0.577 s a chroma=0 contre s a chroma=1, soit +73 % de force apparente sur
  // la seule course de ce curseur. On divise par l'écart-type pour que
  // \`intensity\` reste le seul réglage de force.
  let melange = mix(vec3<f32>(nLuma), couches, chroma);
  let noise = melange / sqrt(1.0 / 3.0 + (2.0 / 3.0) * chroma * chroma);

  // ─── RÉPONSE TONALE ──────────────────────────────────────────────────────
  let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let tone = linear_to_srgb(luma);
  // Argentique : maximale au demi-ton, nulle sur le noir et le blanc purs.
  // Conforme à Dehancer — le grain existe dans les ombres ET dans les hautes
  // lumières, mais jamais sur du noir pur ni du blanc pur.
  let reponseArgentique = 4.0 * tone * (1.0 - tone);
  // Capteur : maximale dans les OMBRES et jamais nulle. Le rapport signal/bruit
  // croît avec le signal, donc le bruit RELATIF — celui que l'œil voit — décroît
  // du noir vers le blanc ; et le bruit de lecture reste présent sur un noir
  // pur, ce qui est exactement pourquoi les ombres numériques « grouillent ».
  // C'est l'inverse exact du film, et la source l'énonce comme tel.
  //
  // Note d'histoire : le défaut corrigé en f7b5399 faisait culminer le grain
  // dans les ombres. Il produisait donc, par accident, le comportement d'un
  // capteur — ce qui devient ici un mode assumé au lieu d'un bug.
  //
  // Modèle LINÉAIRE assumé, pas mesuré : la décroissance est monotone et le
  // plancher non nul, ce qui suffit à porter la différence de caractère. Une
  // courbe en 1/sqrt(signal) serait plus fidèle au bruit de photon et diverge au
  // noir ; la fausse précision ne vaut pas la borne à inventer.
  let reponseCapteur = 1.0 - 0.85 * tone;
  let response = select(reponseArgentique, reponseCapteur, numerique);

  // Le décalage se pose sur le ton PERCEPTUEL et c'est la fonction de transfert
  // PARTAGÉE qui le ramène en linéaire (srgbTransfer.ts reste la source unique).
  // Une amplitude linéaire constante ne produit PAS un écart perceptuel
  // constant : la compression sRGB l'amplifie dans les ombres et l'écrase dans
  // les hautes lumières, ce qui faisait culminer le grain au ton 0.19 au lieu de
  // 0.50, à rebours de son propre contrat (corrigé en f7b5399).
  //
  // Le pivot reste le ton de LUMINANCE, commun aux trois canaux : c'est lui qui
  // porte la réponse tonale. Seul le bruit ajouté diffère par canal.
  let base = srgb_to_linear(tone);
  let perturbe = vec3<f32>(
    srgb_to_linear(tone + noise.r * intensity * response),
    srgb_to_linear(tone + noise.g * intensity * response),
    srgb_to_linear(tone + noise.b * intensity * response)
  );
  return vec4<f32>(color.rgb + (perturbe - vec3<f32>(base)), color.a);
}
`,
};

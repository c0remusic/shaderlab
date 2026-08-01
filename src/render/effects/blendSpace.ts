import type { EffectParam } from "./types";
import { linearToSrgb, srgbToLinear } from "./srgbTransfer";
import { linearSrgbToOklab, oklabToLinearSrgb, oklabToOklch, oklchToOklab } from "./oklab";

/**
 * ESPACE DE MÉLANGE — le long de quelle courbe une interpolation de couleur
 * chemine entre ses deux bouts.
 *
 * D'OÙ ÇA VIENT. Cahier de références du 2026-08-01, §6bis : « le choix
 * d'espace de mélange et le mode d'entrée sont des contrôles RÉCURRENTS chez
 * Figma, et absents partout chez nous. À traiter comme une famille plutôt
 * qu'effet par effet. » Ce module est cette famille pour l'espace de mélange ;
 * `inputMode` l'est pour le mode d'entrée.
 *
 * CE QUE LE CHOIX CHANGE — MESURÉ, pas supposé. Chroma et clarté OKLCH du
 * MILIEU d'un mélange, quatre paires, chroma des bouts entre parenthèses. La
 * première rédaction de cet en-tête annonçait autre chose ; les chiffres l'ont
 * corrigée, et ils sont verrouillés par `blendSpace.test.ts`.
 *
 *   paire                            linéaire   sRGB    OKLab   OKLCH
 *   bleu -> orange, complém. (.21/.17)  .114     .070    .058    .194
 *   magenta -> vert, complém. (.26/.20) .039     .038    .035    .233
 *   bleu -> cyan, voisins    (.21/.12)  .121     .143    .144    .168
 *   rouge -> jaune, voisins  (.23/.18)  .157     .170    .166    .205
 *
 * - **Linéaire** : c'est physiquement ce qu'est un mélange de lumières, donc le
 *   bon choix pour tout ce qui EST une lumière (un halo, un spéculaire). Son
 *   défaut mesurable est ailleurs que là où on l'attend : le milieu sort trop
 *   CLAIR, parce qu'il est dominé par le plus lumineux des deux bouts (L=.595
 *   sur bleu->orange, contre .549 attendu à mi-perception).
 * - **sRGB** : l'inverse — le milieu sort trop SOMBRE (L=.503 sur la même
 *   paire). C'est la courbe historique, celle des dégradés faits « à la main »
 *   dans un éditeur 8 bits.
 * - **OKLab** : le seul espace dont la clarté du milieu est EXACTEMENT la
 *   moyenne perceptuelle des bouts. En revanche il ne répare PAS le creux de
 *   saturation des paires complémentaires — il est même légèrement en dessous
 *   du linéaire (.058 contre .114). Ce n'est pas un défaut à corriger : une
 *   DROITE dans le plan a/b passe forcément près de l'origine quand les deux
 *   bouts sont diamétralement opposés. Le test qui le constate est là pour
 *   empêcher qu'on « répare » plus tard ce comportement correct.
 * - **OKLCH** : le seul qui tienne le chroma, et de loin — x6,6 sur
 *   magenta->vert. La raison est structurelle : en polaire, la teinte TOURNE au
 *   lieu de traverser l'axe achromatique, et le chroma est interpolé
 *   directement au lieu d'être la norme de deux composantes interpolées. C'est
 *   la réponse au « milieu boueux », et c'est aussi un chemin plus long et plus
 *   coloré — un choix de look, d'où deux entrées distinctes et non un
 *   remplacement d'OKLab.
 *
 * L'ORDRE DES CHOIX EST UN CONTRAT. La valeur du paramètre est l'INDEX dans ce
 * tableau (voir `EffectParam.choices`), et cet index est lu tel quel par le
 * shader ET persisté dans les presets. Ajouter un espace se fait donc À LA FIN,
 * jamais au milieu : insérer une entrée renommerait silencieusement le réglage
 * de tous les presets déjà écrits sur disque.
 *
 * `Linéaire` est en tête, donc à l'index 0, donc le défaut naturel : c'est le
 * comportement de TOUS les effets existants avant ce module. Un effet qui
 * adopte ce paramètre ne change donc rien à ses rendus déjà produits tant que
 * l'utilisateur ne touche pas au contrôle.
 */
export const BLEND_SPACE_CHOICES = ["Linéaire", "sRGB", "OKLab", "OKLCH"] as const;

export const BLEND_SPACE_LINEAR = 0;
export const BLEND_SPACE_SRGB = 1;
export const BLEND_SPACE_OKLAB = 2;
export const BLEND_SPACE_OKLCH = 3;

/** Fabrique du paramètre à choix. Les bornes ne sont pas décoratives —
 *  `validateEffect` exige `min: 0`, `step: 1` et `max === choices.length - 1` —
 *  donc les poser ici une fois évite qu'un effet les ressaisisse de travers et
 *  ne fasse échouer le chargement du registre. */
export function blendSpaceParam(overrides: Partial<EffectParam> = {}): EffectParam {
  return {
    name: "blendSpace",
    label: "Espace de mélange",
    unit: "none",
    min: 0,
    max: BLEND_SPACE_CHOICES.length - 1,
    default: BLEND_SPACE_LINEAR,
    step: 1,
    choices: [...BLEND_SPACE_CHOICES],
    hint: "Le long de quelle courbe le mélange chemine — linéaire creuse le milieu des dégradés saturés, OKLab le tient, OKLCH fait en plus tourner la teinte",
    ...overrides,
  };
}

/**
 * VOCABULAIRE RESTREINT aux deux courbes de transfert, pour les opérateurs qui
 * ne sont PAS une interpolation entre deux couleurs.
 *
 * `channelMixer` est le cas : c'est une MATRICE, pas un mélange. « Mélanger en
 * OKLab » n'y voudrait rien dire — la matrice recombine des canaux R, G, B, et
 * l'appliquer à un triplet (L, a, b) mélangerait une clarté avec deux
 * coordonnées chromatiques. Ce qui a un sens, en revanche, c'est la COURBE sur
 * laquelle les canaux sont lus : la matrice tourne sur des valeurs linéaires
 * (modèle physique du filtre optique) ou sur des valeurs encodées sRGB (le
 * comportement de Photoshop et de Figma, plus contrasté aux croisements).
 *
 * Même principe que `INPUT_SOURCE_CHOICES` face à `INPUT_MODE_CHOICES` : ce
 * n'est pas un sous-ensemble arbitraire, c'est la même question posée à un
 * opérateur pour lequel les deux autres réponses n'existent pas.
 */
export const TRANSFER_SPACE_CHOICES = ["Linéaire", "sRGB"] as const;

export const TRANSFER_SPACE_LINEAR = 0;
export const TRANSFER_SPACE_SRGB = 1;

export function transferSpaceParam(overrides: Partial<EffectParam> = {}): EffectParam {
  return {
    name: "transferSpace",
    label: "Espace de mélange",
    unit: "none",
    min: 0,
    max: TRANSFER_SPACE_CHOICES.length - 1,
    default: TRANSFER_SPACE_LINEAR,
    step: 1,
    choices: [...TRANSFER_SPACE_CHOICES],
    ...overrides,
  };
}

/**
 * Jumeau WGSL du vocabulaire restreint : encoder AVANT l'opérateur, décoder
 * APRÈS. Aller-retour fermé, donc dans le contrat de `srgbTransfer` (seconde
 * exception). Requiert `LINEAR_TO_SRGB_WGSL`, `LINEAR_TO_SRGB_VEC3_WGSL`,
 * `SRGB_TO_LINEAR_WGSL` et `SRGB_TO_LINEAR_VEC3_WGSL`.
 */
export const TRANSFER_SPACE_WGSL = `
fn to_transfer_space(c: vec3<f32>, space: f32) -> vec3<f32> {
  if (i32(space + 0.5) == ${TRANSFER_SPACE_SRGB}) {
    return linear_to_srgb3(c);
  }
  return c;
}

fn from_transfer_space(c: vec3<f32>, space: f32) -> vec3<f32> {
  if (i32(space + 0.5) == ${TRANSFER_SPACE_SRGB}) {
    return srgb_to_linear3(c);
  }
  return c;
}
`;

/** Repli du PLUS COURT CHEMIN sur le cercle des teintes, en tours.
 *
 *  `floor(d + 0.5)` et non `round(d)` : `Math.round` de JS arrondit la
 *  demi-unité vers +inf, `round` de WGSL vers le pair le plus proche. Les deux
 *  divergent en d = ±0.5 exactement — les deux arcs y sont de même longueur,
 *  donc aucune des deux réponses n'est fausse, mais elles ne sont pas la MÊME,
 *  et un jumeau TS/WGSL qui diverge quelque part n'est plus un jumeau. */
function shortestHueDelta(delta: number): number {
  return delta - Math.floor(delta + 0.5);
}

/** Jumeau TS de `mix_in_space` (même rôle que `channelMixSpec` pour
 *  `channelMixer`) : `a` et `b` sont des couleurs LINÉAIRES, le résultat aussi.
 *  Toute modification de la formule se fait des DEUX côtés. */
export function mixInSpace(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
  space: number
): [number, number, number] {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  switch (Math.round(space)) {
    case BLEND_SPACE_SRGB: {
      const ea = a.map(linearToSrgb) as [number, number, number];
      const eb = b.map(linearToSrgb) as [number, number, number];
      return [
        srgbToLinear(lerp(ea[0], eb[0])),
        srgbToLinear(lerp(ea[1], eb[1])),
        srgbToLinear(lerp(ea[2], eb[2])),
      ];
    }
    case BLEND_SPACE_OKLAB: {
      const la = linearSrgbToOklab(a);
      const lb = linearSrgbToOklab(b);
      return oklabToLinearSrgb([lerp(la[0], lb[0]), lerp(la[1], lb[1]), lerp(la[2], lb[2])]);
    }
    case BLEND_SPACE_OKLCH: {
      const ca = oklabToOklch(linearSrgbToOklab(a));
      const cb = oklabToOklch(linearSrgbToOklab(b));
      // TEINTE D'UN BOUT ACHROMATIQUE. `atan2(0, 0)` vaut 0 : un gris, un noir
      // ou un blanc a une teinte ARBITRAIRE. Interpoler vers elle ferait
      // traverser tout le cercle à un dégradé rouge -> blanc, qui virerait au
      // jaune puis au vert en chemin. Un bout sans chroma adopte donc la teinte
      // de l'autre — il n'a rien à dire sur la question (règle de CSS Color 4).
      const aFlat = ca[1] < 1e-4;
      const bFlat = cb[1] < 1e-4;
      const ha = aFlat && !bFlat ? cb[2] : ca[2];
      const hb = bFlat && !aFlat ? ha : cb[2];
      const hue = ha + shortestHueDelta(hb - ha) * t;
      return oklabToLinearSrgb(oklchToOklab([lerp(ca[0], cb[0]), lerp(ca[1], cb[1]), hue]));
    }
    default:
      return [lerp(a[0], b[0]), lerp(a[1], b[1]), lerp(a[2], b[2])];
  }
}

/** Jumeau TS de `mix_srgb_in_space` : `a` et `b` sont PERCEPTUELS (sortis d'un
 *  sélecteur de couleur), le résultat est LINÉAIRE. */
export function mixSrgbInSpace(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
  space: number
): [number, number, number] {
  if (Math.round(space) === BLEND_SPACE_SRGB) {
    return [
      srgbToLinear(a[0] + (b[0] - a[0]) * t),
      srgbToLinear(a[1] + (b[1] - a[1]) * t),
      srgbToLinear(a[2] + (b[2] - a[2]) * t),
    ];
  }
  return mixInSpace(
    a.map(srgbToLinear) as [number, number, number],
    b.map(srgbToLinear) as [number, number, number],
    t,
    space
  );
}

/**
 * Jumeau WGSL. Requiert `SRGB_TO_LINEAR_WGSL`, `SRGB_TO_LINEAR_VEC3_WGSL`,
 * `LINEAR_TO_SRGB_WGSL`, `LINEAR_TO_SRGB_VEC3_WGSL` et `OKLAB_WGSL`.
 *
 * `if` ET NON `select`, contrairement à ce que fait `gradientMap` sur son arrêt
 * de ton moyen — et pour la raison exactement inverse. Là-bas la condition
 * varie d'un pixel à l'autre, donc les deux branches s'exécutent de toute façon
 * et `select` le dit au lieu de le cacher. Ici la condition vient d'un
 * UNIFORME : elle a la même valeur pour tous les pixels de la passe, le
 * branchement est uniforme et une seule branche s'exécute réellement. Avec
 * `select`, les quatre chemins — dont deux racines cubiques par bout —
 * tourneraient à chaque pixel pour que trois résultats soient jetés.
 */
export const MIX_IN_SPACE_WGSL = `
fn mix_in_space(a: vec3<f32>, b: vec3<f32>, t: f32, space: f32) -> vec3<f32> {
  let s = i32(space + 0.5);
  if (s == ${BLEND_SPACE_SRGB}) {
    return srgb_to_linear3(mix(linear_to_srgb3(a), linear_to_srgb3(b), t));
  }
  if (s == ${BLEND_SPACE_OKLAB}) {
    return oklab_to_linear_srgb(mix(linear_srgb_to_oklab(a), linear_srgb_to_oklab(b), t));
  }
  if (s == ${BLEND_SPACE_OKLCH}) {
    let ca = oklab_to_oklch(linear_srgb_to_oklab(a));
    let cb = oklab_to_oklch(linear_srgb_to_oklab(b));
    // Un bout sans chroma (gris/noir/blanc) a une teinte ARBITRAIRE et adopte
    // celle de l'autre — sinon un dégradé rouge -> blanc traverse le cercle et
    // vire au jaune puis au vert en chemin.
    let aFlat = ca.y < 0.0001;
    let bFlat = cb.y < 0.0001;
    let ha = select(ca.z, cb.z, aFlat && !bFlat);
    let hb = select(cb.z, ha, bFlat && !aFlat);
    // floor(d + 0.5) et non round(d) : \`round\` de WGSL arrondit au pair,
    // \`Math.round\` de JS vers +inf. Le jumeau TS utilise la même écriture.
    let d = hb - ha;
    let hue = ha + (d - floor(d + 0.5)) * t;
    let lch = vec3<f32>(mix(ca.x, cb.x, t), mix(ca.y, cb.y, t), hue);
    return oklab_to_linear_srgb(oklch_to_oklab(lch));
  }
  return mix(a, b, t);
}

// Variante à bouts sRGB, pour les arrêts qui SORTENT d'un sélecteur de couleur
// (\`gradientMap\`, \`duotone\`) : ils sont déjà perceptuels, et l'espace sRGB est
// justement l'un des choix. Le passage par \`mix_in_space\` les décoderait pour
// les ré-encoder aussitôt — deux \`pow\` par composante et par bout, pour
// retrouver la valeur de départ à l'erreur d'arrondi près. Ici le cas sRGB est
// DIRECT (donc exact, et identique au bit près à ce que gradientMap calculait
// avant l'existence de ce paramètre) et les trois autres délèguent.
fn mix_srgb_in_space(a: vec3<f32>, b: vec3<f32>, t: f32, space: f32) -> vec3<f32> {
  if (i32(space + 0.5) == ${BLEND_SPACE_SRGB}) {
    return srgb_to_linear3(mix(a, b, t));
  }
  return mix_in_space(srgb_to_linear3(a), srgb_to_linear3(b), t, space);
}
`;

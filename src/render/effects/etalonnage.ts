import type { EffectModule, EffectSection } from "./types";
import { OKLAB_WGSL, linearSrgbToOklab, oklabToLinearSrgb } from "./oklab";
import { etalonnagePrimaryHueGradient, etalonnagePrimarySatGradient } from "./trackGradients";

/**
 * Étalonnage — portage du panneau « Etalonnage » de Lightroom Classic (ticket 01
 * de `.scratch/lightroom-develop/`, premier effet du chantier « l'éditeur
 * complet de Lightroom »). Sept réglages : une nuance foncée vert↔magenta bornée
 * aux ombres, et pour chacune des trois primaires R, V, B une TEINTE et une
 * SATURATION.
 *
 * CE N'EST PAS UN HSL, et c'est tout l'intérêt. Un HSL déplace les couleurs de
 * l'IMAGE par bande (le rouge de l'image bouge, le reste ne bouge pas).
 * L'étalonnage déplace ce que R, V, B DÉSIGNENT : il retourne le SYSTÈME de
 * couleur sous l'image, donc toute l'image glisse ensemble, en douceur, sans
 * frontière de bande. C'est le mécanisme du « look » global — le teal-and-orange
 * s'obtient en tirant la teinte de la primaire bleue vers le turquoise et en
 * remontant sa saturation, ce qui bascule tous les tons froids d'un coup.
 *
 * L'OPÉRATEUR EST UNE MATRICE 3×3 EN LUMIÈRE LINÉAIRE dont les COLONNES sont les
 * trois primaires ajustées. Une primaire, c'est le vecteur (1,0,0), (0,1,0) ou
 * (0,0,1) : chaque colonne dit « voici la couleur que le rouge (resp. vert,
 * bleu) de l'image doit désormais VALOIR ». Régler la primaire rouge, c'est
 * tourner et doser cette première colonne ; l'image entière est alors relue à
 * travers la nouvelle base.
 *
 * TROIS POINTS QUI NE SE DEVINENT PAS :
 *
 * 1. **La rotation se fait dans le plan chromatique d'OKLab, pas en RGB.** Tourner
 *    une teinte au compas dans l'espace RGB traverse des zones désaturées et n'est
 *    pas perceptuellement régulier ; dans le plan (a,b) d'OKLab la teinte tourne
 *    sur un cercle perçu uniforme et la chroma se dose sans salir. On applique une
 *    rotation 2×2 directe au vecteur (a,b) — a' = a·cosθ − b·sinθ, b' = a·sinθ +
 *    b·cosθ, puis ×k pour la chroma — ce qui est EXACTEMENT la rotation de teinte
 *    OKLCH, mais SANS `atan2` ni `fract`. Ce détour n'est pas cosmétique :
 *    `atan2` de Dawn rend le mauvais signe au troisième quadrant (mesuré sur GPU,
 *    le bleu sortait orange), et le round-trip polaire `oklch↔oklab` cesse alors
 *    d'être l'identité. `effects/oklab.ts` porte les conversions linéaire↔OKLab —
 *    on les RÉUTILISE ; seul le passage en polaire est écarté.
 *
 * 2. **Renormalisation au blanc, sinon l'exposition dérive à chaque curseur.**
 *    Une primaire tournée et dosée ne somme plus à ce qu'elle valait : sans
 *    correction, un blanc (1,1,1) sortirait teinté et plus clair ou plus sombre,
 *    et le réglage deviendrait impilotable — on cherche un virage, on obtient un
 *    changement d'exposition. On divise donc chaque LIGNE de la matrice par sa
 *    somme (= la composante du point blanc M·(1,1,1)). Les deux formulations que
 *    le ticket propose — « diviser chaque ligne par sa somme » et « ajuster les
 *    colonnes pour que M·(1,1,1) = (1,1,1) » — sont LA MÊME opération : la somme
 *    d'une ligne EST la composante du blanc sur cette ligne. Conséquence exacte :
 *    un gris (g,g,g) sort en (g,g,g) à tout réglage, car M'·(g,g,g) = g·M'·(1,1,1)
 *    = (g,g,g). C'est ce qu'une planche montre en premier — les gris ne bougent
 *    pas, seules les couleurs tournent.
 *
 * 3. **Le clamp de gamut est sur la SORTIE, jamais sur les COLONNES.** ⚠️ Le
 *    ticket demandait de borner chaque primaire tournée à [0,1] avant la matrice ;
 *    mesuré sur pièce, cette borne REND L'EFFET INERTE. Une primaire pure est un
 *    COIN du gamut : la tourner l'envoie hors gamut sur son flanc sombre (p. ex.
 *    le bleu tourné donne (−0,08, −0,04, 1,55)), et borner à [0,1] la reprojette
 *    exactement sur elle-même — la colonne redevient la primaire d'origine, la
 *    matrice redevient l'identité, et rien ne bouge (mesuré : 0 % d'écart sur une
 *    peau à Bleu −60/+40). Une matrice de calibration ne borne pas ses colonnes :
 *    on les garde TELLES QUELLES (l'algèbre en lumière tolère le hors-gamut),
 *    on renormalise les lignes au blanc, on applique, et on borne le RÉSULTAT à
 *    [0,1] en linéaire (jamais en gamma). La renormalisation opère donc sur des
 *    colonnes non bornées et le blanc reste blanc exactement ; le seul clamp est
 *    final, sur une valeur déjà normalisée, et un gris n'y arrive jamais hors
 *    bornes. C'est un ÉCART ASSUMÉ au ticket, dont la prémisse (« borner la
 *    colonne préserve l'effet ») est fausse pour une primaire pure.
 *
 * NUANCE FONCÉE. Après la matrice, un décalage vert↔magenta pondéré par
 * `(1 − luminance)²` de l'ENTRÉE : il ne mord que sur les ombres de l'image, et
 * s'éteint proprement sur les tons clairs. Positif = magenta (+R −V +B), négatif
 * = vert, comme Lightroom. C'est le seul réglage qui teinte volontairement un
 * gris — mais un gris SOMBRE, et seulement lui.
 *
 * ⚠️ EXTENSION ASSUMÉE PAR RAPPORT À LIGHTROOM. Dans Lightroom, la Nuance foncée
 * est `blackBias` (clé `ShadowTintCalibration`) : elle tinte le POINT NOIR de la
 * matrice CAMÉRA, une opération RAW qui est INERTE sur un JPEG déjà rendu (mesuré :
 * `etal-nuance ±100` laisse rampe et teinte à 0). Un curseur inerte étant proscrit
 * ici, on la garde ACTIVE — décalage sur les ombres JPEG. C'est un choix produit
 * arbitré « go pour tout » (Antoine, 2026-09-12) ; pièce et verdict dans l'audit
 * binaire `.scratch/lightroom-develop/issues/09-audit-binaire.md` (§ Arbitrages, 3).
 *
 * IDENTITÉ AU BIT PRÈS À 0. Le round-trip OKLab n'est pas exactement réversible
 * (racine cubique), donc à réglages nuls la matrice reconstruite vaudrait
 * « presque » l'identité et non l'identité exacte. Une garde en tête de shader
 * renvoie l'entrée telle quelle quand les sept réglages sont à 0 — c'est ce qui
 * rend la référence témoin bit-pour-bit égale à la source, comme `curves` le fait
 * pour sa propre identité.
 *
 * CALIBRAGE (mesuré sur planche, photos d'Antoine — voir le ticket) :
 *  - `HUE_DEGREES_PER_UNIT` = 0,30 : Lightroom fait ±100 ≈ ±30° de rotation de
 *    teinte, soit 0,30° par unité de curseur.
 *  - `SHADOW_TINT_AMOUNT` = 0,05 : amplitude linéaire du décalage à |100| sur une
 *    ombre pure. Réduit de 0,10 à 0,05 après la planche 01 — à 0,10, +80 lavait
 *    tout le fond sombre d'une photo en magenta, très loin de la subtilité de la
 *    Nuance foncée de Lightroom. À 0,05, +80 sur du noir vaut 0,04. Reste un
 *    candidat à affiner sur la planche avec Antoine.
 */

const HUE_DEGREES_PER_UNIT = 0.3;
const SHADOW_TINT_AMOUNT = 0.05;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

type Vec3 = [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Une primaire linéaire tournée en teinte et dosée en chroma dans le plan
 *  chromatique d'OKLab, puis reconvertie en linéaire et bornée au gamut. Jumeau
 *  exact de `etal_primary` côté WGSL : toute modification se fait des DEUX côtés.
 *
 *  ⚠️ ON TOURNE LE VECTEUR (a,b) PAR UNE MATRICE 2×2, ON NE PASSE PAS PAR OKLCH.
 *  C'est mathématiquement la MÊME rotation de teinte (a = C·cos h, b = C·sin h ;
 *  tourner h de θ donne a' = a·cosθ − b·sinθ, b' = a·sinθ + b·cosθ), mais SANS
 *  `atan2` ni `fract`. La raison n'est pas cosmétique : `atan2` de Dawn rend le
 *  MAUVAIS signe au troisième quadrant (mesuré sur GPU — le bleu, a<0 b<0, sortait
 *  à hue 0,262 au lieu de 0,733), ce qui casse `oklch_to_oklab ∘ oklab_to_oklch`
 *  et retournait un bleu en orange. Les autres effets construisent leur teinte
 *  depuis un PARAMÈTRE et n'exercent jamais l'`atan2` d'une couleur arbitraire ;
 *  celui-ci est le seul à le faire, et la rotation directe l'évite entièrement. */
function ajusterPrimaire(primaire: Vec3, hueUnits: number, satUnits: number): Vec3 {
  const lab = linearSrgbToOklab(primaire);
  const theta = ((hueUnits * HUE_DEGREES_PER_UNIT) / 360) * 2 * Math.PI;
  const k = 1 + satUnits / 100;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const a = lab[1], b = lab[2];
  // PAS de clamp de gamut ici — voir le point 3 de l'en-tête. Une colonne bornée
  // reprojette une primaire pure sur elle-même et la matrice redevient l'identité.
  return oklabToLinearSrgb([lab[0], k * (a * cos - b * sin), k * (a * sin + b * cos)]);
}

/** Twin CPU du shader (même rôle que `channelMixSpec`/`aperture`) : `rgb` est une
 *  couleur LINÉAIRE (ce que rend `textureSample`), `p` le tableau de paramètres
 *  dans l'ordre du uniform, le résultat est linéaire. Les tests verrouillent les
 *  nombres ici. */
export function etalonnageSpec(rgb: Vec3, p: readonly number[]): Vec3 {
  if (p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 0 && p[4] === 0 && p[5] === 0 && p[6] === 0) {
    return [rgb[0], rgb[1], rgb[2]];
  }
  const cR = ajusterPrimaire([1, 0, 0], p[1], p[2]);
  const cG = ajusterPrimaire([0, 1, 0], p[3], p[4]);
  const cB = ajusterPrimaire([0, 0, 1], p[5], p[6]);
  const w: Vec3 = [cR[0] + cG[0] + cB[0], cR[1] + cG[1] + cB[1], cR[2] + cG[2] + cB[2]];
  const mixed: Vec3 = [
    cR[0] * rgb[0] + cG[0] * rgb[1] + cB[0] * rgb[2],
    cR[1] * rgb[0] + cG[1] * rgb[1] + cB[1] * rgb[2],
    cR[2] * rgb[0] + cG[2] * rgb[1] + cB[2] * rgb[2],
  ];
  const graded: Vec3 = [
    mixed[0] / Math.max(w[0], 0.0001),
    mixed[1] / Math.max(w[1], 0.0001),
    mixed[2] / Math.max(w[2], 0.0001),
  ];
  const luma = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];
  const shadow = (1 - luma) * (1 - luma);
  const tint = (p[0] / 100) * SHADOW_TINT_AMOUNT * shadow;
  return [
    clamp01(graded[0] + tint),
    clamp01(graded[1] - tint),
    clamp01(graded[2] + tint),
  ];
}

const RANGE = { unit: "none" as const, min: -100, max: 100, default: 0, step: 1 };

/**
 * UNE SECTION PAR PRIMAIRE : sa teinte, puis sa saturation. C'est le découpage
 * de Lightroom, et il porte le sens — « le rouge primaire » est une unité qu'on
 * règle d'un bloc.
 *
 * La nuance foncée reste HORS section, à sa place en tête (index 0). Elle
 * n'appartient à aucune primaire, et lui inventer une section « Nuance foncée »
 * d'un seul item serait exactement ce qu'ADR-0001 proscrit — un titre pour une
 * ligne. Le design prévoit ce cas : un paramètre qu'aucune section ne cite reste
 * rendu à sa place (voir `mix` de `curves`). Rendue en premier, elle retombe
 * d'ailleurs en haut du panneau, où Lightroom la met.
 */
/** Interpole une constante TS dans le corps WGSL, en huit décimales.
 *
 *  ⚠️ CE N'EST PAS UNE COQUETTERIE. Ces constantes étaient écrites DEUX fois —
 *  une fois pour le twin TS, une fois en dur dans le WGSL, sous un autre nom —
 *  donc rien n'empêchait qu'un réglage n'en corrige qu'une. C'est exactement la
 *  divergence trouvée sur `CG_BLEND_MAP_A` le 2026-09-15 : `0.42857142857142866`
 *  côté TS, `0.42857143` côté WGSL. Sans conséquence en f32, mais c'était la
 *  SEULE constante du Color Grading que le mécanisme d'interpolation ne couvrait
 *  pas, et la seule qui divergeait. Interpolée, la valeur ne peut plus qu'être
 *  la même des deux côtés. Voir la garde `test/render/effects/jumeauxWgsl`.
 */
const fEtal = (x: number): string => x.toFixed(8);

const sections: EffectSection[] = [
  { id: "primaire-rouge", label: "Rouge primaire", params: ["redHue", "redSaturation"], layout: "liste" },
  { id: "primaire-verte", label: "Vert primaire", params: ["greenHue", "greenSaturation"], layout: "liste" },
  { id: "primaire-bleue", label: "Bleu primaire", params: ["blueHue", "blueSaturation"], layout: "liste" },
];

export const etalonnage: EffectModule = {
  id: "etalonnage",
  name: "Étalonnage",
  params: [
    {
      name: "shadowTint",
      label: "Nuance foncée",
      ...RANGE,
      hint: "Vert ↔ magenta dans les OMBRES seules : positif vire au magenta, négatif au vert, et s'éteint sur les tons clairs",
    },
    { name: "redHue", label: "Teinte", ...RANGE, trackGradient: etalonnagePrimaryHueGradient("red"), hint: "Tourne ce que le ROUGE de l'image désigne — toute l'image glisse, ce n'est pas un HSL" },
    { name: "redSaturation", label: "Saturation", ...RANGE, trackGradient: etalonnagePrimarySatGradient("red"), hint: "Dose la chroma de la primaire rouge" },
    { name: "greenHue", label: "Teinte", ...RANGE, trackGradient: etalonnagePrimaryHueGradient("green"), hint: "Tourne ce que le VERT de l'image désigne" },
    { name: "greenSaturation", label: "Saturation", ...RANGE, trackGradient: etalonnagePrimarySatGradient("green"), hint: "Dose la chroma de la primaire verte" },
    { name: "blueHue", label: "Teinte", ...RANGE, trackGradient: etalonnagePrimaryHueGradient("blue"), hint: "Tourne ce que le BLEU de l'image désigne — teinte − et saturation + font le teal-and-orange" },
    { name: "blueSaturation", label: "Saturation", ...RANGE, trackGradient: etalonnagePrimarySatGradient("blue"), hint: "Dose la chroma de la primaire bleue" },
  ],
  sections,
  wgsl: `
${OKLAB_WGSL}
const ETAL_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
const ETAL_HUE_DEG_PER_UNIT = ${fEtal(HUE_DEGREES_PER_UNIT)};
const ETAL_SHADOW_AMOUNT = ${fEtal(SHADOW_TINT_AMOUNT)};

// Une primaire tournee en teinte et dosee en chroma dans le plan (a,b) d'OKLab,
// puis reconvertie en lineaire et bornee au gamut. Jumeau exact de ajusterPrimaire
// cote TS. Le clamp est AVANT la renormalisation au blanc (faite dans fs_main) :
// une primaire hors gamut, bornee apres coup, decalerait le point blanc.
//
// ON TOURNE LE VECTEUR (a,b) PAR UNE MATRICE 2x2, SANS PASSER PAR OKLCH. C'est la
// meme rotation de teinte, mais sans atan2 ni fract : l'atan2 de Dawn rend le
// mauvais signe au 3e quadrant (mesure GPU : le bleu sortait orange par un
// oklch_to_oklab qui n'inversait plus oklab_to_oklch). La rotation directe l'evite.
fn etal_primary(prim: vec3<f32>, hueUnits: f32, satUnits: f32) -> vec3<f32> {
  let lab = linear_srgb_to_oklab(prim);
  let theta = hueUnits * ETAL_HUE_DEG_PER_UNIT / 360.0 * 6.283185307179586;
  let k = 1.0 + satUnits / 100.0;
  let c = cos(theta);
  let s = sin(theta);
  // PAS de clamp de gamut sur la colonne : borner une primaire pure la reprojette
  // sur elle-meme et la matrice redevient l'identite (effet inerte). Le clamp est
  // sur la SORTIE de fs_main. Voir le point 3 de l'en-tete TS.
  return oklab_to_linear_srgb(vec3<f32>(lab.x, k * (lab.y * c - lab.z * s), k * (lab.y * s + lab.z * c)));
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Identite au bit pres : le round-trip OKLab n'est pas exactement reversible,
  // donc la matrice reconstruite a reglages nuls vaut PRESQUE l'identite. On
  // renvoie l'entree telle quelle plutot que d'introduire un ecart d'un LSB sur
  // la reference temoin.
  if (params[0] == 0.0 && params[1] == 0.0 && params[2] == 0.0 && params[3] == 0.0 && params[4] == 0.0 && params[5] == 0.0 && params[6] == 0.0) {
    return color;
  }
  // Colonnes = primaires ajustees. color.rgb est DEJA lineaire (format -srgb),
  // donc toute l'algebre se fait en lumiere, sans aucun gamma manuel.
  let cR = etal_primary(vec3<f32>(1.0, 0.0, 0.0), params[1], params[2]);
  let cG = etal_primary(vec3<f32>(0.0, 1.0, 0.0), params[3], params[4]);
  let cB = etal_primary(vec3<f32>(0.0, 0.0, 1.0), params[5], params[6]);
  // Renormalisation au blanc : chaque ligne divisee par sa somme (= la composante
  // du point blanc M.(1,1,1)). Un gris sort alors gris a tout reglage. Garde au
  // denominateur pour une ligne degeneree (les trois colonnes nulles sur ce
  // canal) : diviser par zero rendrait un pixel infini sans le dire.
  let w = cR + cG + cB;
  let mixed = cR * color.r + cG * color.g + cB * color.b;
  let graded = mixed / max(w, vec3<f32>(0.0001));
  // Nuance foncee : magenta (+R -V +B) si positif, vert si negatif, pondere par
  // (1 - luminance)^2 de l'ENTREE pour ne mordre que sur les ombres de l'image.
  let luma = dot(color.rgb, ETAL_LUMA);
  let shadow = (1.0 - luma) * (1.0 - luma);
  let tint = params[0] / 100.0 * ETAL_SHADOW_AMOUNT * shadow;
  let tinted = graded + tint * vec3<f32>(1.0, -1.0, 1.0);
  return vec4<f32>(clamp(tinted, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
`,
};

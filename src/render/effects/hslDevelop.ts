import type { EffectModule, EffectParam, EffectSection } from "./types";
import { OKLAB_WGSL, linearSrgbToOklab, oklabToLinearSrgb } from "./oklab";
import { srgbToLinear } from "./srgbTransfer";
import { HSL_BANDES, HSL_CHROMA_REF, type HslBande } from "./hslBandes";
import {
  hslBandeHueGradient,
  hslBandeSatGradient,
  hslBandeLumGradient,
  hslBandeGrayGradient,
} from "./trackGradients";

/**
 * HSL / Couleur / Noir et blanc — le module `hsl` de l'ÉTAGE de développement
 * (ticket 05 de `.scratch/lightroom-develop/`). Portage du panneau « Couleur » de
 * Lightroom Classic 14.5.1 : huit bandes (Rouge, Orange, Jaune, Vert, Turquoise,
 * Bleu, Violet, Magenta) × trois curseurs (Teinte, Saturation, Luminance) = 24,
 * plus le mode Noir et blanc (`ConvertToGrayscale`) et ses huit « Niveau de gris »
 * (`GrayMixer*`) = 33 paramètres, UNE passe finale.
 *
 * ⚠️ NOM DE FICHIER. L'id du module est `hsl`, mais le fichier ne peut pas
 * s'appeler `hsl.ts` : ce nom est DÉJÀ pris par le helper de conversion HSL→RGB
 * (`hsl2rgb`, `HSL_TO_RGB_WGSL`), lu par une dizaine d'effets et listé comme
 * helper dans CLAUDE.md. La convention « fichier = id » cède donc ici devant le
 * clash. Le brief du ticket 05 annonçait `hsl.ts` pour le module : prémisse fausse
 * sur pièce, corrigée (le fichier existait). L'id `hsl` reste, lui — aucun effet
 * ni module de l'étage ne le portait.
 *
 * ── LE POIDS DE BANDE, SANS `atan2` ──────────────────────────────────────────
 *
 * Une bande est une DIRECTION unitaire dans le plan chromatique (a,b) d'OKLab,
 * dérivée d'une couleur pure (`HSL_BANDES[i].rgb`, convertie une fois en OKLab —
 * `BANDE_DIR` ci-dessous). Le poids d'un pixel sur une bande est le COSINUS de
 * l'écart angulaire, un simple produit scalaire `(a·ca + b·cb)/|ab|`, passé dans
 * une gaussienne sur l'angle recouvré par `acos`. `acos` est SÛR sur Dawn ; c'est
 * `atan2` qui rend le mauvais signe au 3ᵉ quadrant (ticket 04, mesuré sur GPU —
 * le bleu sortait orange), et il n'apparaît NULLE PART ici : on ne calcule jamais
 * l'angle absolu d'une couleur, seulement l'écart entre deux directions. C'est la
 * seconde option du ticket 05 (« poids calculé SANS angle »), préférée à
 * `atan2_sure`.
 *
 * Le poids est modulé par une PORTE de chroma (`smoothstep(0, HSL_CHROMA_REF,
 * chroma)`) : un gris ne bouge à aucun réglage, une couleur pâle bouge moins
 * qu'une vive — ce que fait Lightroom, mesurable sur la mire.
 *
 * ── LES TROIS OPÉRATEURS, PLAN (a,b) D'OKLAB ─────────────────────────────────
 *
 *  - Teinte : rotation de (a,b) par la matrice 2×2 de l'angle `Σ poids·amplitude`
 *    (chaque bande n'ajoute sa rotation que si SON curseur de teinte est réglé),
 *    puis dosage de chroma et de luminance. Même rotation directe qu'`etalonnage`,
 *    sans OKLCH.
 *  - Saturation : chroma ×= `1 + Σ poids·(sat/100)·satK`.
 *  - Luminance : L ×= `1 + Σ poids·(lum/100)·lumK` (perceptuel, teinte intacte).
 *
 * ── NOIR ET BLANC ────────────────────────────────────────────────────────────
 *
 * `mode` = Noir et blanc : la chroma tombe à 0 et la luminance de sortie est
 * pondérée par bande — `L·(1 + Σ poids·(gray/100)·grayK)`. Un pixel gris (poids
 * nuls) garde sa luminance ; un rouge s'éclaircit ou s'assombrit selon
 * `Niveau de gris rouge`, comme le mélangeur de couches de Photoshop en mono mais
 * PAR TEINTE. Les 24 curseurs de couleur portent `appliesWhen mode == Couleur`,
 * les 8 de mélange `appliesWhen mode == Noir et blanc` — masqués dans l'autre
 * mode, et éprouvés INERTES par `render-check.mjs --applicabilite` (table
 * `applicabilite-table.mjs`).
 *
 * ── IDENTITÉ AU BIT PRÈS ─────────────────────────────────────────────────────
 *
 * Le round-trip OKLab (racine cubique) n'est pas exactement réversible. Une garde
 * en tête — mode Couleur ET les 24 curseurs de couleur à 0 — renvoie l'entrée
 * telle quelle. Elle couvre aussi le cas d'un preset qui règle un `Niveau de gris`
 * en restant en mode Couleur : ces curseurs n'ont alors aucun objet, et le module
 * ne doit rien changer (c'est ce que `--applicabilite` vérifie). Au défaut complet
 * (mode Couleur, tout à 0) l'étage SAUTE le module (`isDevelopModuleAtDefault`) :
 * cette garde n'a donc à couvrir que les états partiels.
 *
 * ── LA TABLE DE BANDES EST CALIBRÉE SUR LIGHTROOM 14.5 ───────────────────────
 *
 * Centres (couleur représentative), largeurs asymétriques (deux σ), amplitudes,
 * satK/lumK/grayK viennent de `hslBandes.ts`, ajustés par moindres carrés sur les
 * 146 mesures du plugin (`research/03-…`, `research/04-hsl-profils-mesures.md`) via
 * `assets/calibrer-hsl.py`. Le poids porte donc DEUX demi-largeurs par bande, le
 * côté choisi au signe du produit vectoriel `a·cb − b·ca` (toujours sans `atan2`).
 * Voir l'en-tête de `hslBandes.ts` pour les réserves (grayK bruité, k de luminance
 * unique alors que Lightroom est asymétrique).
 *
 * ── LE TWIN TS ───────────────────────────────────────────────────────────────
 *
 * `hslSpec` est le jumeau CPU du shader (même rôle qu'`etalonnageSpec` /
 * `reglagesDeBaseSpec`) : couleur LINÉAIRE en entrée, linéaire en sortie, mêmes
 * bandes (`BANDE_DIR`), mêmes constantes. Les tests figent les nombres côté TS.
 */

type Vec3 = [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const deg2rad = (d: number): number => (d * Math.PI) / 180;

/** Direction unitaire (a,b) de chaque bande dans le plan chromatique d'OKLab,
 *  dérivée UNE FOIS de sa couleur pure. Partagée par le twin et par la génération
 *  WGSL (mêmes nombres des deux côtés, par construction). */
const BANDE_DIR: readonly (readonly [number, number])[] = HSL_BANDES.map((band) => {
  const lin: Vec3 = [srgbToLinear(band.rgb[0]), srgbToLinear(band.rgb[1]), srgbToLinear(band.rgb[2])];
  const lab = linearSrgbToOklab(lin);
  const c = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / c, lab[2] / c] as const;
});

/** Vrai quand le module est en mode Couleur et que les 24 curseurs de couleur
 *  sont à 0 (les 8 de mélange N&B n'ont alors aucun objet). */
function auDefautCouleur(p: readonly number[]): boolean {
  if (p[0] !== 0) return false;
  for (let i = 1; i <= 24; i++) if (p[i] !== 0) return false;
  return true;
}

/**
 * Twin CPU du shader. `rgb` LINÉAIRE, `p` les 33 paramètres dans l'ordre du
 * uniform (0 = mode ; 1..8 teinte ; 9..16 saturation ; 17..24 luminance ; 25..32
 * niveau de gris, tous dans l'ordre de `HSL_BANDES`). Résultat linéaire.
 */
export function hslSpec(rgb: Vec3, p: readonly number[]): Vec3 {
  const mode = p[0];
  if (mode === 0 && auDefautCouleur(p)) return [rgb[0], rgb[1], rgb[2]];

  const lab = linearSrgbToOklab(rgb);
  const L = lab[0], a = lab[1], b = lab[2];
  const chroma = Math.hypot(a, b);
  const gate = smoothstep(0, HSL_CHROMA_REF, chroma);

  let rot = 0, satMul = 1, lumMul = 1, grayAdj = 0;
  for (let i = 0; i < HSL_BANDES.length; i++) {
    const band = HSL_BANDES[i];
    const dir = BANDE_DIR[i];
    const cosd = chroma > 1e-5 ? (a * dir[0] + b * dir[1]) / chroma : 0;
    const ang = Math.acos(clamp(cosd, -1, 1));
    // Cote du centre par le SIGNE du produit vectoriel (pas d'atan2) : demi-largeur
    // gauche/droite. Une bande symetrique a sigmaLeftDeg == sigmaRightDeg.
    const cross = a * dir[1] - b * dir[0];
    const sigma = deg2rad(cross >= 0 ? band.sigmaRightDeg : band.sigmaLeftDeg);
    const w = Math.exp(-(ang * ang) / (sigma * sigma)) * gate;
    rot += w * (p[1 + i] / 100) * deg2rad(band.amplitudeDeg);
    satMul += w * (p[9 + i] / 100) * band.satK;
    lumMul += w * (p[17 + i] / 100) * band.lumK;
    grayAdj += w * (p[25 + i] / 100) * band.grayK;
  }

  if (mode === 1) {
    const out = oklabToLinearSrgb([clamp01(L * (1 + grayAdj)), 0, 0]);
    return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
  }

  const c = Math.cos(rot), s = Math.sin(rot);
  const a2 = (a * c - b * s) * satMul;
  const b2 = (a * s + b * c) * satMul;
  const out = oklabToLinearSrgb([L * lumMul, a2, b2]);
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}

// ── DÉCLARATION DU MODULE ────────────────────────────────────────────────────

/** Libellés français mesurés dans les chaînes de Lightroom
 *  (`assets/lr-fr-develop-strings.txt`). L'accord change entre Teinte (« verte »,
 *  « bleue ») et Saturation/Luminance (« du vert », « du bleu »), d'où trois
 *  formes par bande. */
const LIBELLES: Record<HslBande["id"], { hue: string; satlum: string; gray: string }> = {
  red: { hue: "rouge", satlum: "du rouge", gray: "rouge" },
  orange: { hue: "orange", satlum: "du orange", gray: "orange" },
  yellow: { hue: "jaune", satlum: "du jaune", gray: "jaune" },
  green: { hue: "verte", satlum: "du vert", gray: "vert" },
  aqua: { hue: "turquoise", satlum: "du turquoise", gray: "turquoise" },
  blue: { hue: "bleue", satlum: "du bleu", gray: "bleu" },
  purple: { hue: "violette", satlum: "du violet", gray: "violet" },
  magenta: { hue: "magenta", satlum: "du magenta", gray: "magenta" },
};

const R100 = { unit: "none" as const, min: -100, max: 100, default: 0, step: 1 };
const COULEUR = { param: "mode", equals: 0 } as const; // mode == Couleur
const NB = { param: "mode", equals: 1 } as const; // mode == Noir et blanc

const params: EffectParam[] = [
  {
    name: "mode",
    label: "Traitement",
    unit: "none",
    min: 0,
    max: 1,
    default: 0,
    step: 1,
    choices: ["Couleur", "Noir et blanc"],
    hint: "Couleur : les trois familles de curseurs par bande. Noir et blanc : un mélange monochrome par teinte (« Niveau de gris »)",
  },
  ...HSL_BANDES.map((band): EffectParam => ({
    name: `${band.id}Hue`,
    label: `Variation de la teinte ${LIBELLES[band.id].hue}`,
    ...R100,
    appliesWhen: COULEUR,
    trackGradient: hslBandeHueGradient(band.id),
    hint: "Tourne la teinte des pixels de cette bande, pondéré par leur appartenance à la bande et leur chroma",
  })),
  ...HSL_BANDES.map((band): EffectParam => ({
    name: `${band.id}Sat`,
    label: `Variation de la saturation ${LIBELLES[band.id].satlum}`,
    ...R100,
    appliesWhen: COULEUR,
    trackGradient: hslBandeSatGradient(band.id),
    hint: "Dose la chroma des pixels de cette bande ; −100 la désature entièrement",
  })),
  ...HSL_BANDES.map((band): EffectParam => ({
    name: `${band.id}Lum`,
    label: `Variation de la luminance ${LIBELLES[band.id].satlum}`,
    ...R100,
    appliesWhen: COULEUR,
    trackGradient: hslBandeLumGradient(band.id),
    hint: "Éclaircit ou assombrit les pixels de cette bande, teinte intacte",
  })),
  ...HSL_BANDES.map((band): EffectParam => ({
    name: `${band.id}Gray`,
    label: `Niveau de gris ${LIBELLES[band.id].gray}`,
    ...R100,
    appliesWhen: NB,
    trackGradient: hslBandeGrayGradient(band.id),
    hint: "En Noir et blanc : éclaircit ou assombrit les gris issus de cette teinte",
  })),
];

const sections: EffectSection[] = [
  // `mode` reste HORS section, rendu en premier (index 0), comme Lightroom pose
  // le sélecteur Couleur / Noir et blanc en tête — une section « Mode » d'un seul
  // item serait un titre pour une ligne, ce qu'ADR-0001 proscrit.
  { id: "teinte", label: "Teinte", layout: "grille", params: HSL_BANDES.map((b) => `${b.id}Hue`) },
  { id: "saturation", label: "Saturation", layout: "grille", params: HSL_BANDES.map((b) => `${b.id}Sat`) },
  { id: "luminance", label: "Luminance", layout: "grille", params: HSL_BANDES.map((b) => `${b.id}Lum`) },
  // La section de mélange N&B apparaît en mode Noir et blanc. Ses 8 curseurs
  // portent la même condition ; les trois sections de couleur disparaissent
  // d'elles-mêmes quand tous leurs curseurs sont masqués (ParamPanel).
  { id: "melange", label: "Mélange noir et blanc", layout: "grille", appliesWhen: NB, params: HSL_BANDES.map((b) => `${b.id}Gray`) },
];

// ── GÉNÉRATION DU WGSL ───────────────────────────────────────────────────────
// Les blocs par bande sont générés depuis `HSL_BANDES` et `BANDE_DIR` : mêmes
// nombres que le twin, aucune recopie à tenir à jour. Aucun backtick ni symbole
// de substitution dans un COMMENTAIRE de ce corps WGSL — seulement de vraies
// interpolations.
const f = (x: number): string => x.toFixed(8);
const blocsBandes = HSL_BANDES.map((band, i) => {
  const [da, db] = BANDE_DIR[i];
  return `  {
    let w = hsl_weight(a, b, chroma, gate, vec2<f32>(${f(da)}, ${f(db)}), ${f(deg2rad(band.sigmaLeftDeg))}, ${f(deg2rad(band.sigmaRightDeg))});
    rot = rot + w * (params[${1 + i}] / 100.0) * ${f(deg2rad(band.amplitudeDeg))};
    satMul = satMul + w * (params[${9 + i}] / 100.0) * ${f(band.satK)};
    lumMul = lumMul + w * (params[${17 + i}] / 100.0) * ${f(band.lumK)};
    grayAdj = grayAdj + w * (params[${25 + i}] / 100.0) * ${f(band.grayK)};
  }`;
}).join("\n");
// Garde d'identité : mode Couleur (params[0] == 0) ET les 24 curseurs de couleur
// (indices 1..24) à 0.
const gardeIdentite = Array.from({ length: 25 }, (_, i) => `params[${i}] == 0.0`).join(" && ");

export const hsl: EffectModule = {
  id: "hsl",
  name: "TSL / Noir et blanc",
  params,
  sections,
  wgsl: `
${OKLAB_WGSL}

// Poids d'un pixel sur une bande : cosinus de l'ecart angulaire entre sa
// direction chromatique (a,b) et celle de la bande (dir), passe dans une
// gaussienne asymetrique, module par la porte de chroma. AUCUN atan2 : on ne
// compare que des directions, jamais l'angle absolu du pixel (voir l'en-tete).
// Le cote du centre se lit au SIGNE du produit vectoriel a*dir.y - b*dir.x, ce
// qui choisit la demi-largeur gauche ou droite sans jamais calculer d'angle absolu.
fn hsl_weight(a: f32, b: f32, chroma: f32, gate: f32, dir: vec2<f32>, sigmaL: f32, sigmaR: f32) -> f32 {
  var cosd = 0.0;
  if (chroma > 0.00001) {
    cosd = (a * dir.x + b * dir.y) / chroma;
  }
  let ang = acos(clamp(cosd, -1.0, 1.0));
  let cross = a * dir.y - b * dir.x;
  let sigma = select(sigmaL, sigmaR, cross >= 0.0);
  return exp(-(ang * ang) / (sigma * sigma)) * gate;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Identite au bit pres : mode Couleur et les 24 curseurs de couleur a 0. Le
  // round-trip OKLab n'est pas exactement reversible, on renvoie l'entree telle
  // quelle. Couvre aussi un preset qui regle un Niveau de gris en mode Couleur
  // (ces curseurs sont alors sans objet).
  if (${gardeIdentite}) {
    return color;
  }

  // color.rgb est DEJA lineaire (format -srgb).
  let lab = linear_srgb_to_oklab(color.rgb);
  let L = lab.x;
  let a = lab.y;
  let b = lab.z;
  let chroma = sqrt(a * a + b * b);
  let gate = smoothstep(0.0, ${f(HSL_CHROMA_REF)}, chroma);

  var rot = 0.0;
  var satMul = 1.0;
  var lumMul = 1.0;
  var grayAdj = 0.0;
${blocsBandes}

  if (params[0] == 1.0) {
    // NOIR ET BLANC : chroma nulle, luminance ponderee par bande.
    let Lout = clamp(L * (1.0 + grayAdj), 0.0, 1.0);
    let outg = oklab_to_linear_srgb(vec3<f32>(Lout, 0.0, 0.0));
    return vec4<f32>(clamp(outg, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
  }

  // COULEUR : rotation de teinte, puis dosage de chroma et de luminance.
  let c = cos(rot);
  let s = sin(rot);
  let a2 = (a * c - b * s) * satMul;
  let b2 = (a * s + b * c) * satMul;
  let outc = oklab_to_linear_srgb(vec3<f32>(L * lumMul, a2, b2));
  return vec4<f32>(clamp(outc, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
`,
};

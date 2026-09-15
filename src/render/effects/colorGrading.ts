import type { EffectModule, EffectParam, EffectSection } from "./types";
import { OKLAB_WGSL, linearSrgbToOklab, oklabToLinearSrgb } from "./oklab";
import {
  SRGB_TO_LINEAR_WGSL, SRGB_TO_LINEAR_VEC3_WGSL, LINEAR_TO_SRGB_WGSL,
  srgbToLinear, linearToSrgb,
} from "./srgbTransfer";
import { HSL_TO_RGB_WGSL, hsl2rgb } from "./hsl";
import { COLOR_GRADING as CG } from "./colorGradingTable";

/**
 * Color Grading — le module `colorGrading` de l'ÉTAGE de développement (ticket 06
 * de `.scratch/lightroom-develop/`). Portage du panneau « Color Grading » de
 * Lightroom Classic 14.5.1 : QUATRE roues chromatiques (Ombres, Tons moyens,
 * Hautes lumières, Globale) × trois réglages (Teinte, Saturation, Luminance) = 12,
 * plus Fusion (recouvrement des plages) et Balance (bascule ombres ↔ hautes
 * lumières) = 14 paramètres, UNE passe finale.
 *
 * ── LE MÉCANISME : TROIS POIDS SUR LA LUMINANCE, UN VECTEUR DE CHROMA PAR ROUE ──
 *
 * Chaque roue ne REMPLACE pas la couleur, elle AJOUTE un vecteur de chroma dans le
 * plan (a,b) d'OKLab, pondéré par l'appartenance du pixel à sa plage de luminance :
 *
 *   da,db += dir(teinte) · (sat/100) · chromaK · poids_plage(L)
 *   L     += (lum/100)   · lumK    · poids_plage(L)
 *
 * `dir(teinte)` est la DIRECTION unitaire (a,b) de la couleur pure de la teinte —
 * dérivée de `hsl2rgb(teinte, 1, 0.5)` convertie en OKLab, JAMAIS d'un `atan2`
 * (bug Dawn du 3ᵉ quadrant, ticket 04) : on ne calcule jamais l'angle d'une
 * couleur, seulement la direction d'un paramètre. Teinter n'est pas remplacer — le
 * vecteur s'ajoute à la chroma existante, donc un bleu teinté orange dans les
 * ombres devient moins bleu, pas orange.
 *
 * Les trois poids de plage sur la luminance L (OKLab) :
 *  - Ombres : haut à L = 0, retombe à 0 vers `shadowCenter` ;
 *  - Tons moyens : cloche gaussienne centrée sur `midCenter` ;
 *  - Hautes lumières : monte vers 1 à partir de `highCenter`.
 * La roue GLOBALE s'applique partout (poids de chroma 1) ; sa luminance porte une
 * cloche (on ne lève ni le noir pur ni le blanc pur).
 *
 * **Fusion** (`blending`, défaut 50) règle le RECOUVREMENT : 0 tranche (transitions
 * nettes, plages disjointes), 100 fond (transitions larges, plages qui se chevauchent).
 * **Balance** déplace le point de bascule ombres ↔ hautes lumières : −100 « tout est
 * ombre », +100 « tout est haute lumière ».
 *
 * ── CALIBRAGE : DEUX ROUES MESURÉES, DEUX MODÉLISÉES ─────────────────────────
 *
 * ⚠️ Voir l'en-tête de `colorGradingTable.ts` : les teintes Ombres / Hautes
 * lumières, Balance et Fusion NE SONT PAS mesurables dans les exports Lightroom (le
 * plugin a écrit `ColorGradeShadow/HighlightHue`, que Lightroom ignore au profit des
 * clés héritées `SplitToning*`). `chromaK`, `lumK`, `midCenter`, `midSigma` sont
 * CALIBRÉS (médians, global) ; les profils Ombres/Hautes lumières, Balance et Fusion
 * sont MODÉLISÉS et provisoires. `chromaK`/`lumK` valent pour les quatre roues (un
 * seul modèle de mélange). Table isolée, réécrite par `assets/calibrer-grading.py`.
 *
 * ── IDENTITÉ AU BIT PRÈS ─────────────────────────────────────────────────────
 *
 * Le round-trip OKLab (racine cubique) n'est pas exactement réversible. Une garde
 * en tête — les quatre saturations ET les quatre luminances à 0 — renvoie l'entrée
 * telle quelle (la teinte, la fusion et la balance ne font rien sans saturation ni
 * luminance). Au défaut complet l'étage SAUTE le module (`isDevelopModuleAtDefault`).
 *
 * ── LE TWIN TS ───────────────────────────────────────────────────────────────
 *
 * `colorGradingSpec` est le jumeau CPU du shader (même patron qu'`etalonnageSpec` /
 * `hslSpec`) : couleur LINÉAIRE en entrée et sortie, mêmes constantes que la table,
 * mêmes directions. Les tests figent les nombres côté TS ; les références de pixels
 * `developpement-grading-*` figent le rendu GPU et les index du uniform.
 */

type Vec3 = [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** LA CARTE D'ADOBE — `cr_div_map` dans le binaire (RVA 0xc7d600). Une homographie
 *  qui CLOUE LES DEUX BOUTS : f(0)=0, f(1)=1, f(0,5)=a/(a+1), et l'identité à a=1.
 *  Tout champ `*MapAlpha` de son uniforme `UniformsSplitTone` est le `a` d'une de
 *  ces cartes — c'est la forme, elle n'est pas devinée.
 *
 *  ⚠️ CE QUI LA DISTINGUE D'UN SMOOTHSTEP TRANSLATÉ, mesuré et non raisonné : au
 *  ras du noir, le rapport de chroma du duo à Balance +100 sur Balance 0 vaut
 *  0,556 / 0,389 / 0,274 / 0,115 aux niveaux 8 à 20. L'homographie rend 0,585 /
 *  0,425 / 0,284 / 0,157 (écart moyen 0,031) ; un smoothstep translaté rend 0,206
 *  / 0,160 / 0,114 / 0,067 (écart 0,196, facteur 2,7 au premier point). Une
 *  homographie ne peut pas décoller le bout, une translation le déplace, et la
 *  mesure dit que le bout ne bouge pas. */
const divMap = (x: number, a: number): number => (a * x) / (a * x + 1 - x);

/** Le `a` que Lightroom code EN DUR pour remapper Fusion (constante
 *  0x3FDB6DB6DB6DB6DD, soit 3/7) : f(0,5) = 0,300 exactement. Le curseur au défaut
 *  50 vaut donc 0,30 de profondeur, pas 0,50.
 *
 *  ⚠️ Elle était écrite DEUX fois — ici et en dur dans le WGSL, à `0.42857143` —
 *  alors que les huit autres constantes du module partent par `${f(...)}`. La
 *  seule que le mécanisme ne couvrait pas était la seule qui divergeait ; sans
 *  conséquence en f32, mais la coïncidence n'en est pas une. Elle est interpolée
 *  depuis le 2026-09-15. */
const CG_BLEND_MAP_A = 0.42857142857142866;

/** Direction unitaire (a,b) d'OKLab de la teinte pure `hueDeg` (0..360). Jumeau de
 *  `cg_dir` côté WGSL : `hsl2rgb(h,1,0.5)` -> linéaire -> OKLab -> normalisée. Aucun
 *  `atan2` : on ne fait que dériver une direction d'un PARAMÈTRE. */
function dirFromHue(hueDeg: number): [number, number] {
  const [r, g, b] = hsl2rgb((((hueDeg % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  const c = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / c, lab[2] / c];
}

/** Ramène une couleur OKLab dans le gamut sRGB EN PRÉSERVANT SA TEINTE : la
 *  chroma se réduit à L constant jusqu'à ce que les trois canaux rentrent, au
 *  lieu d'écrêter chaque canal séparément.
 *
 *  ⚠️ CE N'EST PAS UN DÉTAIL DE FINITION. Un écrêtage PAR CANAL fait dériver la
 *  teinte exactement là où le virage est le plus fort : il coupe le canal qui
 *  déborde et laisse les deux autres, ce qui tourne la couleur au lieu de la
 *  désaturer. Mesuré sur les treize mesures de virage de Lightroom : écart moyen
 *  7,50 → 6,51 niveaux et pire cas 74,8 → 60,7, sans AUCUNE constante nouvelle.
 *  Le pire cas était le blanc de `st-hl-orange`, que Lightroom rend blanc et que
 *  l'écrêtage par canal rendait jaune.
 *
 *  La bissection tient en seize pas — la chroma admissible est monotone en `s`,
 *  donc seize pas donnent mieux que le pas de quantification 8 bits.
 *
 *  ⚠️ `L` ne sort PLUS de [0,1] depuis qu'`appliqueLum` sature contre les bornes —
 *  ce commentaire a dit le contraire, et citait « une Luminance poussée à fond »
 *  comme le dernier cas où l'écrêtage final agissait encore. L'écrêtage final reste
 *  là pour l'ARRONDI (la bissection s'arrête à `lo`, pas à la limite exacte), pas
 *  pour une luminance hors bornes. */
function clipGamut(lab: Vec3): Vec3 {
  const dedans = (c: Vec3): boolean =>
    c[0] >= -1e-6 && c[0] <= 1 + 1e-6 &&
    c[1] >= -1e-6 && c[1] <= 1 + 1e-6 &&
    c[2] >= -1e-6 && c[2] <= 1 + 1e-6;
  const direct = oklabToLinearSrgb(lab);
  if (dedans(direct)) return [clamp01(direct[0]), clamp01(direct[1]), clamp01(direct[2])];
  let lo = 0, hi = 1;
  for (let i = 0; i < 16; i++) {
    const s = (lo + hi) / 2;
    if (dedans(oklabToLinearSrgb([lab[0], lab[1] * s, lab[2] * s]))) lo = s;
    else hi = s;
  }
  const fin = oklabToLinearSrgb([lab[0], lab[1] * lo, lab[2] * lo]);
  return [clamp01(fin[0]), clamp01(fin[1]), clamp01(fin[2])];
}

/** APPLIQUE LE DÉCALAGE DE LUMINANCE SANS JAMAIS FRANCHIR LE BLANC NI LE NOIR.
 *
 *  Un décalage ADDITIF (`L + dL`, puis écrêtage) avait un défaut mesuré : le poids
 *  des hautes lumières vaut presque 1 au ras du blanc, donc à `Luminance des hautes
 *  lumières` +50 les niveaux 244 à 254 sortaient TOUS à 255 — onze niveaux de détail
 *  écrasés, dix-neuf à +100. Lightroom ne fait jamais ça : sur `cg-hl-lum-p50`, le
 *  niveau 248 sort à 251,3 et le 254 à 255,0, et l'écart RETOMBE à zéro au blanc
 *  (mesuré : +13,0 niveaux au 205, +6,65 au 240, +3,33 au 248, +1,42 au 252). Les
 *  QUATRE mesures de luminance (ombres ±50, moyens +50, hautes +50, globale +50)
 *  rendent `lin_out == lin_in` EXACTEMENT à partir du niveau 248 : les deux bouts
 *  sont cloués, comme les deux bouts de la carte d'Adobe le sont (`divMap`).
 *
 *  La forme retenue est la saturation exponentielle contre la borne : le décalage
 *  consomme une FRACTION de ce qui reste (`h`), donc il se confond avec l'additif
 *  tant que `dL << h` — les tons moyens ne bougent pas — et n'atteint la borne
 *  qu'à l'infini. Coût mesuré sur les cinq mesures de luminance, à `lumK` inchangé :
 *  1,57 → 1,63 niveau d'écart moyen. C'est six centièmes de niveau payés pour onze
 *  niveaux de détail rendus ; et à `lumK` refitté (0,080) le modèle doux vaut 1,56
 *  contre 1,55 à l'additif, donc la forme ne coûte rien, seul le réglage bougerait.
 *
 *  ⚠️ CE N'EST PAS LE PROFIL DE POIDS MESURÉ, et ça ne prétend pas l'être. Le poids
 *  des hautes lumières mesuré CULMINE au niveau 205 puis retombe ; notre `wh` monte
 *  encore. Trois formes qui clouent le blanc par un facteur (`(1−L)`, `(1−lin)`,
 *  `1−L^n`) ont été ajustées sur les cinq mesures et RÉGRESSENT toutes (1,62 → 1,81
 *  au mieux, 2,55 au pire) : le poids à corriger n'est pas un facteur de plus, c'est
 *  la forme de `wh` elle-même, qui porte AUSSI le partage de la chroma (celui-là
 *  mesuré juste). Le défaut de forme reste donc ouvert au ticket 06 ; ce qui est
 *  fermé ici, c'est l'ÉCRASEMENT du blanc. */
function appliqueLum(L: number, dL: number): number {
  const h = dL >= 0 ? 1 - L : L;
  if (h <= 1e-6) return dL >= 0 ? 1 : 0;
  const d = 1 - Math.exp(-Math.abs(dL) / h);
  return dL >= 0 ? L + h * d : L - h * d;
}

/**
 * Twin CPU du shader. `rgb` LINÉAIRE, `p` les 14 paramètres dans l'ordre du uniform
 * (0..2 ombres teinte/sat/lum ; 3..5 tons moyens ; 6..8 hautes lumières ; 9..11
 * global ; 12 fusion ; 13 balance). Résultat linéaire.
 */
export function colorGradingSpec(rgb: Vec3, p: readonly number[]): Vec3 {
  const shSat = p[1], mSat = p[4], hSat = p[7], gSat = p[10];
  const shLum = p[2], mLum = p[5], hLum = p[8], gLum = p[11];
  if (shSat === 0 && mSat === 0 && hSat === 0 && gSat === 0 &&
      shLum === 0 && mLum === 0 && hLum === 0 && gLum === 0) {
    return [rgb[0], rgb[1], rgb[2]];
  }

  const lab = linearSrgbToOklab(rgb);
  const L = lab[0], a = lab[1], b = lab[2];

  const bal = p[13] / 100;
  const beta = p[12] / 100;
  // UNE rampe et son complément : `ws` et `wh` somment à `cov`, jamais deux courbes
  // libres. Tonalité sur l'axe sRGB — sur un gris, L³ EST la luminance linéaire, et
  // cet axe bat celui d'OKLab de 17 % en écart mesuré.
  const sigma = Math.max(0.02, CG.midSigma + CG.midSoft * (beta - 0.5));
  const midC = CG.midCenter - CG.balanceShift * bal;
  const x = clamp01(linearToSrgb(L * L * L));
  const B = clamp(0.5 - CG.balanceMid * bal, 1e-4, 1 - 1e-4);
  const alpha = divMap(x, (1 - B) / B);
  // Fusion CREUSE une bande neutre autour de la bascule — elle n'élargit pas une
  // transition, et son sens est l'inverse de ce que disait notre documentation.
  const cov = 1 - CG.blendDepth * (1 - divMap(beta, CG_BLEND_MAP_A)) * 4 * alpha * (1 - alpha);

  const ws = (1 - alpha) * cov;
  const wh = alpha * cov;
  const wm = Math.exp(-((L - midC) * (L - midC)) / (2 * sigma * sigma));
  const wgL = 4 * L * (1 - L);

  const dSh = dirFromHue(p[0]), dM = dirFromHue(p[3]), dH = dirFromHue(p[6]), dG = dirFromHue(p[9]);
  const da =
    dSh[0] * (shSat / 100) * CG.chromaK * ws +
    dM[0] * (mSat / 100) * CG.chromaK * wm +
    dH[0] * (hSat / 100) * CG.chromaK * wh +
    dG[0] * (gSat / 100) * CG.chromaK;
  const db =
    dSh[1] * (shSat / 100) * CG.chromaK * ws +
    dM[1] * (mSat / 100) * CG.chromaK * wm +
    dH[1] * (hSat / 100) * CG.chromaK * wh +
    dG[1] * (gSat / 100) * CG.chromaK;
  const dL =
    (shLum / 100) * CG.lumK * ws +
    (mLum / 100) * CG.lumK * wm +
    (hLum / 100) * CG.lumK * wh +
    (gLum / 100) * CG.lumK * wgL;

  return clipGamut([appliqueLum(L, dL), a + da, b + db]);
}

// ── DÉCLARATION DU MODULE ────────────────────────────────────────────────────

const HUE = { unit: "none" as const, min: 0, max: 360, default: 0, step: 1 };
const SAT = { unit: "none" as const, min: 0, max: 100, default: 0, step: 1 };
const LUM = { unit: "none" as const, min: -100, max: 100, default: 0, step: 1 };

const params: EffectParam[] = [
  { name: "shadowHue", label: "Teinte des ombres", ...HUE, hint: "Teinte du virage des ombres (roue). Sans effet tant que la saturation des ombres est à 0" },
  { name: "shadowSat", label: "Saturation des ombres", ...SAT, hint: "Intensité du virage des ombres" },
  { name: "shadowLum", label: "Luminance des ombres", ...LUM, hint: "Éclaircit ou assombrit les ombres" },
  { name: "midtoneHue", label: "Teinte des tons moyens", ...HUE, hint: "Teinte du virage des tons moyens (roue)" },
  { name: "midtoneSat", label: "Saturation des tons moyens", ...SAT, hint: "Intensité du virage des tons moyens" },
  { name: "midtoneLum", label: "Luminance des tons moyens", ...LUM, hint: "Éclaircit ou assombrit les tons moyens" },
  { name: "highlightHue", label: "Teinte des hautes lumières", ...HUE, hint: "Teinte du virage des hautes lumières (roue)" },
  { name: "highlightSat", label: "Saturation des hautes lumières", ...SAT, hint: "Intensité du virage des hautes lumières" },
  { name: "highlightLum", label: "Luminance des hautes lumières", ...LUM, hint: "Éclaircit ou assombrit les hautes lumières" },
  { name: "globalHue", label: "Teinte globale", ...HUE, hint: "Teinte du virage appliqué à toute l'image (roue)" },
  { name: "globalSat", label: "Saturation globale", ...SAT, hint: "Intensité du virage global, à toute luminance" },
  { name: "globalLum", label: "Luminance globale", ...LUM, hint: "Éclaircit ou assombrit l'ensemble, cloché sur les tons moyens" },
  { name: "blending", label: "Fusion", unit: "none", min: 0, max: 100, default: 50, step: 1, hint: "Recouvrement des trois plages : 0 tranche, 100 fond les transitions" },
  { name: "balance", label: "Balance", ...LUM, hint: "Bascule ombres ↔ hautes lumières : −100 tout est ombre, +100 tout est haute lumière" },
];

const sections: EffectSection[] = [
  // Les 12 paramètres des quatre roues sont rendus par `colorWheelControls`
  // (déclaré plus bas) et ne passent PAS par une section de curseurs. Seules
  // Fusion et Balance restent des curseurs, groupés sous un titre — comme
  // Lightroom les pose sous la rangée de roues.
  { id: "fusion", label: "Fusion et balance", layout: "paire", params: ["blending", "balance"] },
];

// ── GÉNÉRATION DU WGSL ───────────────────────────────────────────────────────
// Aucun backtick ni symbole de substitution dans un COMMENTAIRE de ce corps WGSL,
// seulement de vraies interpolations. Les constantes viennent de la table (mêmes
// nombres que le twin, par construction).
const f = (x: number): string => x.toFixed(8);

export const colorGrading: EffectModule = {
  id: "colorGrading",
  name: "Color Grading",
  params,
  sections,
  colorWheelControls: [
    { id: "ombres", label: "Ombres", hue: "shadowHue", saturation: "shadowSat", luminance: "shadowLum" },
    { id: "moyens", label: "Tons moyens", hue: "midtoneHue", saturation: "midtoneSat", luminance: "midtoneLum" },
    { id: "hautes", label: "Hautes lumières", hue: "highlightHue", saturation: "highlightSat", luminance: "highlightLum" },
    { id: "globale", label: "Globale", hue: "globalHue", saturation: "globalSat", luminance: "globalLum" },
  ],
  wgsl: `
${OKLAB_WGSL}
${SRGB_TO_LINEAR_WGSL}
${SRGB_TO_LINEAR_VEC3_WGSL}
${LINEAR_TO_SRGB_WGSL}
${HSL_TO_RGB_WGSL}

const CG_CHROMA_K = ${f(CG.chromaK)};
const CG_LUM_K = ${f(CG.lumK)};
const CG_MID_CENTER = ${f(CG.midCenter)};
const CG_MID_SIGMA = ${f(CG.midSigma)};
const CG_MID_SOFT = ${f(CG.midSoft)};
const CG_BALANCE_MID = ${f(CG.balanceMid)};
const CG_BLEND_DEPTH = ${f(CG.blendDepth)};
const CG_BLEND_MAP_A = ${f(CG_BLEND_MAP_A)};
const CG_BALANCE_SHIFT = ${f(CG.balanceShift)};

// Direction unitaire (a,b) d'OKLab de la teinte pure hueDeg. Jumeau de dirFromHue
// cote TS. AUCUN atan2 : on derive une direction d'un PARAMETRE, on ne mesure
// jamais l'angle d'une couleur (bug Dawn du 3e quadrant, ticket 04).
fn cg_div_map(x: f32, a: f32) -> f32 {
  return (a * x) / (a * x + 1.0 - x);
}

fn cg_dedans(c: vec3<f32>) -> bool {
  return all(c >= vec3<f32>(-1e-6)) && all(c <= vec3<f32>(1.000001));
}

fn cg_dir(hueDeg: f32) -> vec2<f32> {
  let lin = srgb_to_linear3(hsl2rgb(fract(hueDeg / 360.0), 1.0, 0.5));
  let lab = linear_srgb_to_oklab(lin);
  let c = max(length(lab.yz), 0.000001);
  return lab.yz / c;
}

// Jumeau d'appliqueLum cote TS : le decalage de luminance consomme une FRACTION de
// ce qui reste jusqu'a la borne, il ne la franchit jamais. Additif tant que dL est
// petit devant h, donc les tons moyens ne bougent pas ; a Luminance des hautes
// lumieres +50 les niveaux 244 a 254 ne sortent plus tous a 255. Justification
// mesuree en tete du twin.
fn cg_lum_apply(L: f32, dL: f32) -> f32 {
  let h = select(L, 1.0 - L, dL >= 0.0);
  if (h <= 1e-6) {
    return select(0.0, 1.0, dL >= 0.0);
  }
  let d = 1.0 - exp(-abs(dL) / h);
  return select(L - h * d, L + h * d, dL >= 0.0);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Identite au bit pres : les quatre saturations ET les quatre luminances a 0.
  // La teinte, la fusion et la balance ne font rien sans saturation ni luminance ;
  // le round-trip OKLab n'est pas exactement reversible, on renvoie l'entree telle
  // quelle.
  if (params[1] == 0.0 && params[4] == 0.0 && params[7] == 0.0 && params[10] == 0.0
      && params[2] == 0.0 && params[5] == 0.0 && params[8] == 0.0 && params[11] == 0.0) {
    return color;
  }

  // color.rgb est DEJA lineaire (format -srgb).
  let lab = linear_srgb_to_oklab(color.rgb);
  let L = lab.x;
  let a = lab.y;
  let b = lab.z;

  let bal = params[13] / 100.0;
  let beta = params[12] / 100.0;
  // UNE rampe et son complement : ws et wh somment a cov (voir le twin).
  let sigma = max(0.02, CG_MID_SIGMA + CG_MID_SOFT * (beta - 0.5));
  let midC = CG_MID_CENTER - CG_BALANCE_SHIFT * bal;
  let x = clamp(linear_to_srgb(L * L * L), 0.0, 1.0);
  let B = clamp(0.5 - CG_BALANCE_MID * bal, 1e-4, 1.0 - 1e-4);
  let alpha = cg_div_map(x, (1.0 - B) / B);
  let cov = 1.0 - CG_BLEND_DEPTH * (1.0 - cg_div_map(beta, CG_BLEND_MAP_A)) * 4.0 * alpha * (1.0 - alpha);

  let ws = (1.0 - alpha) * cov;
  let wh = alpha * cov;
  let dm = L - midC;
  let wm = exp(-(dm * dm) / (2.0 * sigma * sigma));
  let wgL = 4.0 * L * (1.0 - L);

  let dSh = cg_dir(params[0]);
  let dM = cg_dir(params[3]);
  let dH = cg_dir(params[6]);
  let dG = cg_dir(params[9]);

  let vecAB = dSh * (params[1] / 100.0) * CG_CHROMA_K * ws
            + dM * (params[4] / 100.0) * CG_CHROMA_K * wm
            + dH * (params[7] / 100.0) * CG_CHROMA_K * wh
            + dG * (params[10] / 100.0) * CG_CHROMA_K;
  let dL = (params[2] / 100.0) * CG_LUM_K * ws
         + (params[5] / 100.0) * CG_LUM_K * wm
         + (params[8] / 100.0) * CG_LUM_K * wh
         + (params[11] / 100.0) * CG_LUM_K * wgL;

  // Clip qui PRESERVE LA TEINTE, jumeau de clipGamut (voir le twin) : la chroma
  // se reduit a L constant jusqu'a ce que les trois canaux rentrent, au lieu
  // d'ecreter chaque canal separement — un ecretage par canal TOURNE la couleur
  // la ou le virage est le plus fort, il ne la desature pas.
  let labOut = vec3<f32>(cg_lum_apply(L, dL), a + vecAB.x, b + vecAB.y);
  var outc = oklab_to_linear_srgb(labOut);
  if (!cg_dedans(outc)) {
    var lo = 0.0;
    var hi = 1.0;
    for (var i = 0; i < 16; i = i + 1) {
      let s = (lo + hi) * 0.5;
      if (cg_dedans(oklab_to_linear_srgb(vec3<f32>(labOut.x, labOut.y * s, labOut.z * s)))) {
        lo = s;
      } else {
        hi = s;
      }
    }
    outc = oklab_to_linear_srgb(vec3<f32>(labOut.x, labOut.y * lo, labOut.z * lo));
  }
  return vec4<f32>(clamp(outc, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
`,
};

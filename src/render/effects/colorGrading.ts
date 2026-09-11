import type { EffectModule, EffectParam, EffectSection } from "./types";
import { OKLAB_WGSL, linearSrgbToOklab, oklabToLinearSrgb } from "./oklab";
import { SRGB_TO_LINEAR_WGSL, SRGB_TO_LINEAR_VEC3_WGSL, srgbToLinear } from "./srgbTransfer";
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
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Direction unitaire (a,b) d'OKLab de la teinte pure `hueDeg` (0..360). Jumeau de
 *  `cg_dir` côté WGSL : `hsl2rgb(h,1,0.5)` -> linéaire -> OKLab -> normalisée. Aucun
 *  `atan2` : on ne fait que dériver une direction d'un PARAMÈTRE. */
function dirFromHue(hueDeg: number): [number, number] {
  const [r, g, b] = hsl2rgb((((hueDeg % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  const c = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / c, lab[2] / c];
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
  const soft = clamp(CG.softBase + CG.softSpread * (beta - 0.5), 0.03, 0.5);
  const sigma = Math.max(0.02, CG.midSigma + CG.midSoft * (beta - 0.5));
  const shC = CG.shadowCenter - CG.balanceShift * bal;
  const hiC = CG.highCenter - CG.balanceShift * bal;
  const midC = CG.midCenter - CG.balanceShift * bal;

  const ws = 1 - smoothstep(shC - soft, shC + soft, L);
  const wh = smoothstep(hiC - soft, hiC + soft, L);
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

  const out = oklabToLinearSrgb([L + dL, a + da, b + db]);
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
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
${HSL_TO_RGB_WGSL}

const CG_CHROMA_K = ${f(CG.chromaK)};
const CG_LUM_K = ${f(CG.lumK)};
const CG_MID_CENTER = ${f(CG.midCenter)};
const CG_MID_SIGMA = ${f(CG.midSigma)};
const CG_SHADOW_CENTER = ${f(CG.shadowCenter)};
const CG_HIGH_CENTER = ${f(CG.highCenter)};
const CG_SOFT_BASE = ${f(CG.softBase)};
const CG_SOFT_SPREAD = ${f(CG.softSpread)};
const CG_MID_SOFT = ${f(CG.midSoft)};
const CG_BALANCE_SHIFT = ${f(CG.balanceShift)};

// Direction unitaire (a,b) d'OKLab de la teinte pure hueDeg. Jumeau de dirFromHue
// cote TS. AUCUN atan2 : on derive une direction d'un PARAMETRE, on ne mesure
// jamais l'angle d'une couleur (bug Dawn du 3e quadrant, ticket 04).
fn cg_dir(hueDeg: f32) -> vec2<f32> {
  let lin = srgb_to_linear3(hsl2rgb(fract(hueDeg / 360.0), 1.0, 0.5));
  let lab = linear_srgb_to_oklab(lin);
  let c = max(length(lab.yz), 0.000001);
  return lab.yz / c;
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
  let soft = clamp(CG_SOFT_BASE + CG_SOFT_SPREAD * (beta - 0.5), 0.03, 0.5);
  let sigma = max(0.02, CG_MID_SIGMA + CG_MID_SOFT * (beta - 0.5));
  let shC = CG_SHADOW_CENTER - CG_BALANCE_SHIFT * bal;
  let hiC = CG_HIGH_CENTER - CG_BALANCE_SHIFT * bal;
  let midC = CG_MID_CENTER - CG_BALANCE_SHIFT * bal;

  let ws = 1.0 - smoothstep(shC - soft, shC + soft, L);
  let wh = smoothstep(hiC - soft, hiC + soft, L);
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

  let outc = oklab_to_linear_srgb(vec3<f32>(L + dL, a + vecAB.x, b + vecAB.y));
  return vec4<f32>(clamp(outc, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
`,
};

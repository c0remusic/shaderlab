import type { EffectModule, EffectSection, EffectPass } from "./types";
import { DOWNSAMPLE_WGSL } from "./blurChain";
import { SRGB_TO_LINEAR_WGSL, LINEAR_TO_SRGB_WGSL, srgbToLinear, linearToSrgb } from "./srgbTransfer";
import { OKLAB_WGSL, linearSrgbToOklab, oklabToLinearSrgb } from "./oklab";
import { TEMPERATURE_GRADIENT, NUANCE_GRADIENT, RAINBOW_GRADIENT } from "./trackGradients";
import { RB_TABLE } from "./reglagesDeBaseTable";

/**
 * Réglages de base + courbe paramétrique — le module `reglagesDeBase` de l'ÉTAGE
 * de développement (ticket 02 de `.scratch/lightroom-develop/`). Portage du
 * panneau « Réglages de base » de Lightroom Classic 14.5.1 (température, tonalité,
 * présence) PLUS la moitié paramétrique de « Courbe des tonalités » (4 régions +
 * 3 séparations), en UN SEUL effet.
 *
 * POURQUOI UN SEUL EFFET. La mesure `../research/02-huit-bits-mesure.md` : sur
 * une rampe 8 bits, empiler six curseurs de ton comme six effets (texture 8 bits
 * entre chaque) perd 25 % des niveaux et creuse des trous de 7 ; le MÊME ton
 * calculé d'un bloc en flottant, quantifié UNE SEULE FOIS à l'écriture, rend ce
 * que rend Lightroom (132 niveaux, trou 3). Tout ce qui ÉTIRE le ton vit donc
 * ici, dans la passe finale, en flottant, encodé une fois par le format -srgb de
 * la cible. C'est la raison d'être du module, et le test unitaire
 * `reglagesDeBase.test.ts` la prouve (132 niveaux, pas 109).
 *
 * ⚠️ LE COMPTE EST DE 20 CURSEURS CONTINUS, PAS 22. Le « 22 » du ticket compte
 * les 15 LIGNES du panneau Basic de l'inventaire (research/01 § 1) plus les 7 de
 * la courbe. Mais deux de ces lignes ne sont pas des curseurs de ton continus de
 * ce module : `WhiteBalance` (un CHOIX Tel quel/Auto/Perso — en JPEG relatif,
 * Température et Nuance suffisent) et `ConvertToGrayscale` (le traitement N&B, un
 * MODULE séparé, hors ticket 02). Restent 13 curseurs Basic + 7 de courbe = 20.
 *
 * ── L'ORDRE DE LIGHTROOM, EN FLOTTANT, UNE PASSE FINALE ──────────────────────
 *
 * L'ordre d'APPLICATION est celui de Lightroom (PV2012), et il n'est pas l'ordre
 * du panneau : balance des blancs → exposition → contraste → hautes lumières /
 * ombres LOCAUX → blancs / noirs → texture / clarté / voile → vibrance /
 * saturation → courbe paramétrique. Le ton perceptuel (exposition, contraste,
 * hautes lumières, ombres, blancs, noirs, courbe) se calcule en espace sRGB
 * (encode / opère / redécode, aller-retour FERMÉ — jamais un gamma qui quitte
 * l'expression, voir `srgbTransfer.ts`) ; la balance des blancs en lumière
 * linéaire ; vibrance / saturation dans le plan chromatique d'OKLab.
 *
 * ── LES FORMES SONT ANCRÉES, ET CALIBRÉES SUR LES RAMPES MESURÉES ────────────
 *
 * ✅ CALIBRÉ SUR LIGHTROOM 14.5 le 2026-09-12 (Antoine : « contraste et
 * luminosité rendent un peu bizarre »). Les constantes de FORME vivent dans
 * `reglagesDeBaseTable.ts` (`RB_TABLE`), lues ICI par le twin ET interpolées dans
 * le WGSL — un seul point de vérité, réécrit par `assets/calibrer-ton.py` contre
 * les rampes `research/mesures/*.json`. Chaque opérateur de ton TIENT les
 * extrémités (0→0 et 1→1) comme Lightroom : l'ancien contraste effondrait le noir
 * à 128 à −100, ombres/noirs montaient le noir pur — corrigé. ⚠️ ÉCART au ticket :
 * l'EXPOSITION passe d'un gain LINÉAIRE 2^EV à un gamma PERCEPTUEL
 * (`1−(1−s)^γ` / `s^γ`, γ=1 à EV=0) — c'est ce qui reproduit les rampes mesurées ;
 * détail et écart résiduel (blanc pur tenu à −2 IL) dans `reglagesDeBaseTable.ts`.
 *
 * ── LES FLOUS, ET COMMENT ILS ATTEIGNENT LA COMPOSITE ───────────────────────
 *
 * Hautes lumières / Ombres sont LOCAUX (PV2012) : leur poids dépend d'une
 * luminance FLOUTÉE à grand rayon, pas du pixel seul — c'est ce qui les distingue
 * d'une courbe et évite le « HDR sale ». Clarté est un contraste local à ce même
 * rayon ; Correction du voile estime un voile à ce rayon. La chaîne de passes est
 * LINÉAIRE (une seule sortie `prevPass`), donc on ne peut pas transporter
 * plusieurs textures floutées. DÉCISION (notée) : **une seule pyramide** (noyaux
 * partagés de `blurChain`, structure identique à la bande Clarté de `nettete`,
 * descente 1/16 puis remontée) porte le flou MOYEN-LARGE dans `prevPass`, lu par
 * Hautes lumières / Ombres (poids), Clarté (contraste local) et Voile (estimation
 * du voile). La bande FINE de Texture se calcule DANS la passe finale, par une
 * tente 3×3 à un texel sur `srcTexture` (comme l'Accentuation de `nettete`) — pas
 * besoin de pyramide pour elle. Deux rayons donc : fin (Texture) et moyen-large
 * (les trois autres). Écart assumé à Lightroom, qui donne à Clarté un rayon plus
 * serré qu'aux Hautes lumières / Ombres ; en 8 bits et sur ses radis descriptifs
 * (jamais chiffrés), le partage est acceptable et se calibre sur la planche.
 *
 * Les passes de pyramide sont SAUTÉES (`EffectPass.enabled`) quand Hautes
 * lumières, Ombres, Clarté et Voile sont tous à 0 : `prevPass` vaut alors la
 * source, lue seulement par des termes eux-mêmes à 0 — inerte. Et le module
 * ENTIER est sauté par l'étage (`isDevelopModuleAtDefault`) quand tous les
 * curseurs sont au défaut : aucune passe, aucune quantification, rendu de la
 * source au bit près (référence `-temoin` et gate `test:render` zéro écart).
 *
 * ── IDENTITÉ AU BIT PRÈS À 0 ────────────────────────────────────────────────
 *
 * Le round-trip OKLab (racine cubique) n'est pas exactement réversible, donc à
 * réglages nuls le bloc vibrance/saturation rendrait « presque » l'entrée. Une
 * garde en tête (tous les curseurs au défaut, séparations 25/50/75) renvoie
 * l'entrée telle quelle — comme `curves` et `etalonnage` le font pour leur propre
 * identité. Chaque bloc porte en plus sa propre garde (vibrance/saturation,
 * courbe, présence sautés à 0) pour que la rampe de ton ne traverse aucun
 * aller-retour inutile.
 *
 * ── LE TWIN TS ──────────────────────────────────────────────────────────────
 *
 * `reglagesDeBaseSpec` est le jumeau CPU du shader (même rôle que `etalonnageSpec`
 * / `netteteSpec`) : il reçoit la couleur LINÉAIRE, la luminance FLOUTÉE (un
 * paramètre — sur une rampe elle vaut la luminance du pixel) et les paramètres,
 * et rend du linéaire. Il mire les OPÉRATEURS PONCTUELS (tout sauf le flou
 * spatial de Texture/Clarté, que les références de pixels verrouillent). Les
 * tests figent les nombres ici ; toute modification de la formule se fait des
 * DEUX côtés, et `test:render` attrape un oubli.
 */

type Vec3 = [number, number, number];

const LUMA = [0.2126, 0.7152, 0.0722] as const;

// AMPLITUDES DE FORME — lues depuis `RB_TABLE` (une seule source, réécrite par
// `assets/calibrer-ton.py`). Le WGSL interpole les MÊMES valeurs (voir plus bas).
const WB_TEMP_K = RB_TABLE.wbTempK;
const WB_TINT_K = RB_TABLE.wbTintK;
const TEXTURE_AMT = 1.2;  // gain additif linéaire de la bande fine à |100| (flou spatial, hors calibration rampe)
const CLARITY_AMT = 0.9;  // gain additif linéaire de la bande moyenne à |100| (flou spatial, hors calibration rampe)
const DEHAZE_AMT = 0.35;  // amplitude du retrait/ajout de voile à |100| (flou spatial, hors calibration rampe)
const CURVE_AMT = RB_TABLE.curveAmt;   // lift perceptuel maximal d'une région à |100|
const CURVE_WIN = RB_TABLE.curveWin;   // demi-largeur des transitions cosinus entre régions (perceptuel)
const VIB_CHROMA_REF = 0.20; // chroma OKLab au-delà de laquelle la vibrance ne pousse plus (couleur, non fitté)
// Direction « peau/orange » dans le plan (a,b) d'OKLab, normalisée. La vibrance
// s'éteint quand la chroma d'un pixel pointe par là (protection des carnations,
// comme Lightroom). Mesurée sur la carnation de `mirePrimaires` (224,160,128).
const SKIN_DIR: readonly [number, number] = [0.52, 0.854];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lumaOf = (c: Vec3): number => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

/** Cloche bêta normalisée (pic 1 au mode `c`, NULLE en 0 et en 1) — la forme de
 *  région d'Ombres / Hautes lumières / Noirs / Blancs. Jumeau de `rb_bump` WGSL. */
function bump(v: number, c: number, k: number): number {
  const ec = k * c, e1 = k * (1 - c);
  const peak = Math.pow(c, ec) * Math.pow(1 - c, e1);
  const vv = clamp01(v);
  return (Math.pow(vv, ec) * Math.pow(1 - vv, e1)) / Math.max(peak, 1e-6);
}

/** Contraste : gamma double PIVOTÉ, ancré en 0 / pivot / 1. `kC = contraste/100`
 *  (γ = exp(contrastG·kC)) : γ>1 creuse, γ<1 aplatit — les deux sens. Jumeau de
 *  `rb_contrast` WGSL. */
function contrastOp(s: number, kC: number, pv: number): number {
  if (kC === 0) return s;
  const gamma = Math.exp(RB_TABLE.contrastG * kC);
  if (s <= pv) return pv * Math.pow(s / pv, gamma);
  return 1 - (1 - pv) * Math.pow((1 - s) / (1 - pv), gamma);
}

/** Exposition : gamma perceptuel ancré, unifié aux deux signes, identité à EV=0.
 *  `1−(1−s)^γ`, `γ = exp(expoG·EV)`. Jumeau de `rb_expo` WGSL. */
function exposureOp(s: number, ev: number): number {
  if (ev === 0) return s;
  return 1 - Math.pow(1 - s, Math.exp(RB_TABLE.expoG * ev));
}

/** Vrai quand tous les curseurs sont à leur défaut (séparations à 25/50/75). */
function auDefaut(p: readonly number[]): boolean {
  for (let i = 0; i < 17; i++) if (p[i] !== 0) return false;
  return p[17] === 25 && p[18] === 50 && p[19] === 75;
}

/** Courbe paramétrique sur une valeur perceptuelle `s` (0..1). Quatre régions
 *  séparées par les trois séparations, transitions cosinus. Les poids
 *  télescopent (somme = 1) : `1 − t_s`, `t_s − t_m`, `t_m − t_h`, `t_h`. */
function courbeParametrique(
  s: number,
  kShadows: number, kDarks: number, kLights: number, kHigh: number,
  sSplit: number, mSplit: number, hSplit: number,
): number {
  const ts = smoothstep(sSplit - CURVE_WIN, sSplit + CURVE_WIN, s);
  const tm = smoothstep(mSplit - CURVE_WIN, mSplit + CURVE_WIN, s);
  const th = smoothstep(hSplit - CURVE_WIN, hSplit + CURVE_WIN, s);
  const delta =
    kShadows * (1 - ts) + kDarks * (ts - tm) + kLights * (tm - th) + kHigh * th;
  return clamp01(s + CURVE_AMT * delta);
}

/**
 * Twin CPU du shader. `rgb` LINÉAIRE, `blurLuma` la luminance floutée moyenne
 * (sur une rampe = la luminance du pixel), `p` les 20 paramètres dans l'ordre du
 * uniform. Résultat linéaire. Voir l'en-tête pour ce qu'il mire et ce qu'il ne
 * mire pas (le flou spatial de Texture/Clarté).
 */
export function reglagesDeBaseSpec(rgb: Vec3, blurLuma: number, p: readonly number[]): Vec3 {
  if (auDefaut(p)) return [rgb[0], rgb[1], rgb[2]];

  const temperature = p[0], nuance = p[1], exposure = p[2], contrast = p[3];
  const highlights = p[4], shadows = p[5], whites = p[6], blacks = p[7];
  const texture = p[8], clarity = p[9], dehaze = p[10], vibrance = p[11], saturation = p[12];
  const pHigh = p[13], pLights = p[14], pDarks = p[15], pShadows = p[16];
  const sSplit = p[17] / 100, mSplit = p[18] / 100, hSplit = p[19] / 100;

  let c: Vec3 = [rgb[0], rgb[1], rgb[2]];

  // 1. BALANCE DES BLANCS — gains linéaires par canal, renormalisés au blanc
  //    (un gris garde sa luminance). Température : R+ / B−. Nuance : magenta
  //    R+B+ / G−.
  const tU = temperature / 100, nU = nuance / 100;
  let gR = 1 + WB_TEMP_K * tU + WB_TINT_K * nU;
  let gG = 1 - WB_TINT_K * nU;
  let gB = 1 - WB_TEMP_K * tU + WB_TINT_K * nU;
  const norm = LUMA[0] * gR + LUMA[1] * gG + LUMA[2] * gB;
  gR /= norm; gG /= norm; gB /= norm;
  c = [c[0] * gR, c[1] * gG, c[2] * gB];

  // 2-5. TON PERCEPTUEL — exposition (gamma ancré), contraste (sigmoïde ancrée),
  //      hautes lumières / ombres LOCAUX (cloche sur la luminance floutée),
  //      blancs / noirs (cloche ponctuelle). Aller-retour sRGB fermé, par canal.
  //      Toutes les formes tiennent 0 et 1 (voir en-tête et `reglagesDeBaseTable`).
  const sBlur = linearToSrgb(clamp01(blurLuma));
  const wSh = bump(sBlur, RB_TABLE.shadowCenter, RB_TABLE.shadowKappa);
  const wHl = bump(sBlur, RB_TABLE.highlightCenter, RB_TABLE.highlightKappa);
  const kC = contrast / 100, kHl = highlights / 100, kSh = shadows / 100;
  const kWh = whites / 100, kBk = blacks / 100;
  // Amplitude par SIGNE (Lightroom est asymétrique — voir `reglagesDeBaseTable`).
  const shAmt = kSh >= 0 ? RB_TABLE.shadowAmtPos : RB_TABLE.shadowAmtNeg;
  const hlAmt = kHl >= 0 ? RB_TABLE.highlightAmtPos : RB_TABLE.highlightAmtNeg;
  const bkAmt = kBk >= 0 ? RB_TABLE.blackAmtPos : RB_TABLE.blackAmtNeg;
  const whAmt = kWh >= 0 ? RB_TABLE.whiteAmtPos : RB_TABLE.whiteAmtNeg;
  const ton = (lin: number): number => {
    let s = linearToSrgb(clamp01(lin));
    s = exposureOp(s, exposure);                                 // exposition (gamma perceptuel ancré)
    s = contrastOp(s, kC, RB_TABLE.contrastPivot);              // contraste (gamma double pivoté)
    s = clamp01(s);
    s = s + kSh * shAmt * wSh;                                   // ombres locales (cloche sur luminance floutée)
    s = s + kHl * hlAmt * wHl;                                   // hautes lumières locales
    s = clamp01(s);
    s = s + kBk * bkAmt * bump(s, RB_TABLE.blackCenter, RB_TABLE.blackKappa); // noirs (ponctuel)
    s = s + kWh * whAmt * bump(s, RB_TABLE.whiteCenter, RB_TABLE.whiteKappa); // blancs (ponctuel)
    return srgbToLinear(clamp01(s));
  };
  c = [ton(c[0]), ton(c[1]), ton(c[2])];

  // 6. PRÉSENCE — Texture (bande fine), Clarté (bande moyenne), Voile. Additif
  //    en lumière sur la luminance (comme `nettete`), pas multiplicatif (qui
  //    explose dans les ombres). Dans le twin, la bande FINE de Texture est
  //    nulle (pas de flou spatial ici) ; le shader la calcule par une tente.
  if (texture !== 0 || clarity !== 0 || dehaze !== 0) {
    const lp = lumaOf(c);
    const detailMoyen = lp - clamp01(blurLuma);          // bande moyenne (Clarté)
    const gainPresence =
      (texture / 100) * TEXTURE_AMT * 0                   // bande fine = 0 dans le twin
      + (clarity / 100) * CLARITY_AMT * detailMoyen;
    // Voile : le flou moyen sert d'estimation du voile. Positif = retirer le
    // voile (creuser le contraste autour du voile), négatif = en ajouter.
    const voile = (dehaze / 100) * DEHAZE_AMT * (lp - clamp01(blurLuma));
    const g = gainPresence + voile;
    // MULTIPLICATIF sur la luminance, jamais un offset par canal : le binaire de
    // Lightroom fait Texture en log-YCC (etage texture_direct_gf_ycc, filtre
    // guide sur Y) et Clarte par le pipeline LocalContrastY — Y seul, chroma
    // intacte. Y+delta a chroma-LOG constante = rapports R/G/B constants, donc
    // un FACTEUR ici ; l'offset egal aux trois canaux (differences constantes)
    // desaturait en eclaircissant et virait la teinte pres de zero — constat
    // d'Antoine 2026-09-12, et mesure : LR dSat max 0,017 sur le balayage a
    // Texture ±100. Le piedestal 1e-4 borne les noirs purs comme leur log.
    const fPres = Math.max((lp + g + 1e-4) / (lp + 1e-4), 0);
    c = [c[0] * fPres, c[1] * fPres, c[2] * fPres];
  }

  // 7. VIBRANCE / SATURATION — dans le plan (a,b) d'OKLab, sans atan2 (bug Dawn,
  //    voir `etalonnage`). Saturation : facteur uniforme. Vibrance : fort sur les
  //    couleurs peu saturées, faible sur les saturées, éteinte sur la peau.
  if (vibrance !== 0 || saturation !== 0) {
    const lab = linearSrgbToOklab(c);
    const a = lab[1], b = lab[2];
    const chroma = Math.sqrt(a * a + b * b);
    const satFactor = 1 + saturation / 100;
    let skin = 0;
    if (chroma > 1e-4) {
      const dot = (a / chroma) * SKIN_DIR[0] + (b / chroma) * SKIN_DIR[1];
      skin = smoothstep(0.6, 0.95, dot);
    }
    const falloff = clamp(1 - chroma / VIB_CHROMA_REF, 0, 1);
    const vibFactor = 1 + (vibrance / 100) * falloff * (1 - skin);
    const scale = satFactor * vibFactor;
    c = oklabToLinearSrgb([lab[0], a * scale, b * scale]);
  }

  // 8. COURBE PARAMÉTRIQUE — perceptuel, par canal.
  if (pHigh !== 0 || pLights !== 0 || pDarks !== 0 || pShadows !== 0) {
    const kSh2 = pShadows / 100, kDk = pDarks / 100, kLt = pLights / 100, kHi = pHigh / 100;
    const curve = (lin: number): number =>
      srgbToLinear(courbeParametrique(linearToSrgb(clamp01(lin)), kSh2, kDk, kLt, kHi, sSplit, mSplit, hSplit));
    c = [curve(c[0]), curve(c[1]), curve(c[2])];
  }

  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

// ── DÉCLARATION DU MODULE ────────────────────────────────────────────────────

const R100 = { unit: "none" as const, min: -100, max: 100, default: 0, step: 1 };

const sections: EffectSection[] = [
  // Balance des blancs : deux curseurs liés sur une paire, comme Lightroom.
  { id: "balance-des-blancs", label: "Balance des blancs", layout: "paire", params: ["temperature", "nuance"] },
  { id: "tonalite", label: "Tonalité", layout: "liste", params: ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"] },
  { id: "presence", label: "Présence", layout: "liste", params: ["texture", "clarity", "dehaze", "vibrance", "saturation"] },
  // Courbe paramétrique : 4 régions en liste + 3 séparations en grille (2
  // colonnes), pour tenir SOUS 6 lignes visuelles par section (ADR-0001) — 4 en
  // liste, ~2 en grille — plutôt que 7 lignes d'un bloc.
  { id: "courbe-parametrique", label: "Courbe paramétrique", layout: "liste", params: ["paramHighlights", "paramLights", "paramDarks", "paramShadows"] },
  { id: "separations", label: "Séparations", layout: "grille", params: ["shadowSplit", "midtoneSplit", "highlightSplit"] },
];

/** Noyau de remontee a ecartement FIXE (un texel), pour la pyramide de ce module
 *  qui n'expose aucun curseur de rayon. Tente 3x3 canonique (1-2-1/2-4-2/1-2-1,
 *  somme 16) echantillonnee sur l'entree plus petite a la resolution plus grande.
 *  Jumeau de `upsampleWgsl` sans le parametre de portee (voir `blurChain.ts`). */
const UPSAMPLE_FIXED_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let o = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  var sum = textureSample(srcTexture, srcSampler, uv).rgb * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  0.0)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  0.0)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( 0.0, -o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( 0.0,  o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb;
  return vec4<f32>(sum / 16.0, 1.0);
}
`;

const passePyramide: EffectPass[] = (() => {
  // La pyramide ne sert QUE le flou moyen-large (Hautes lumières / Ombres /
  // Clarté / Voile). Sautée quand ces quatre curseurs sont à 0 : `prevPass` vaut
  // alors la source, lue seulement par des termes à 0. Structure identique à la
  // bande Clarté de `nettete`.
  const utile = (params: Record<string, number>) =>
    params.highlights !== 0 || params.shadows !== 0 || params.clarity !== 0 || params.dehaze !== 0;
  return [
    { scale: 0.5, wgsl: DOWNSAMPLE_WGSL, enabled: utile },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL, enabled: utile },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL, enabled: utile },
    { scale: 0.0625, wgsl: DOWNSAMPLE_WGSL, enabled: utile },
    { scale: 0.125, wgsl: UPSAMPLE_FIXED_WGSL, enabled: utile },
    { scale: 0.25, wgsl: UPSAMPLE_FIXED_WGSL, enabled: utile },
    { scale: 0.5, wgsl: UPSAMPLE_FIXED_WGSL, enabled: utile },
  ];
})();

/** Formate un nombre en littéral flottant WGSL (toujours un point décimal). Sert
 *  à interpoler `RB_TABLE` dans le shader — twin et WGSL restent JUMEAUX par
 *  construction, une seule source de vérité. */
const wf = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export const reglagesDeBase: EffectModule = {
  id: "reglagesDeBase",
  name: "Réglages de base",
  params: [
    { name: "temperature", label: "Température", ...R100, trackGradient: TEMPERATURE_GRADIENT, hint: "Balance des blancs relative : positif réchauffe (jaune), négatif refroidit (bleu). Un gris garde sa luminance" },
    { name: "nuance", label: "Nuance", ...R100, trackGradient: NUANCE_GRADIENT, hint: "Balance des blancs relative : positif vire au magenta, négatif au vert" },
    { name: "exposure", label: "Exposition", unit: "none", min: -5, max: 5, default: 0, step: 0.05, hint: "Gain global en indices de lumination (IL), 2^valeur en lumière linéaire" },
    { name: "contrast", label: "Contraste", ...R100, hint: "Pente autour du gris moyen, en espace perceptuel" },
    { name: "highlights", label: "Hautes lumières", ...R100, hint: "Récupère (négatif) ou ouvre (positif) les hautes lumières, pondéré par une luminance FLOUTÉE — local, pas une courbe" },
    { name: "shadows", label: "Ombres", ...R100, hint: "Ouvre (positif) ou ferme (négatif) les ombres, local (luminance floutée)" },
    { name: "whites", label: "Blancs", ...R100, hint: "Déplace le point blanc, poids serré à l'extrémité claire" },
    { name: "blacks", label: "Noirs", ...R100, hint: "Déplace le point noir, poids serré à l'extrémité sombre" },
    { name: "texture", label: "Texture", ...R100, hint: "Contraste local à PETIT rayon (bande fine), sur la luminance" },
    { name: "clarity", label: "Clarté", ...R100, hint: "Contraste local à MOYEN rayon (bande large), sur la luminance" },
    { name: "dehaze", label: "Correction du voile", ...R100, hint: "Retire (positif) ou ajoute (négatif) un voile estimé à grand rayon" },
    { name: "vibrance", label: "Vibrance", ...R100, trackGradient: RAINBOW_GRADIENT, hint: "Dose la chroma NON linéairement : fort sur les couleurs ternes, faible sur les vives, protège les carnations" },
    { name: "saturation", label: "Saturation", ...R100, trackGradient: RAINBOW_GRADIENT, hint: "Dose la chroma uniformément" },
    { name: "paramHighlights", label: "Hautes lumières", ...R100, hint: "Courbe paramétrique : lève ou baisse la région des hautes lumières" },
    { name: "paramLights", label: "Teintes claires", ...R100, hint: "Courbe paramétrique : région des teintes claires" },
    { name: "paramDarks", label: "Teintes sombres", ...R100, hint: "Courbe paramétrique : région des teintes sombres" },
    { name: "paramShadows", label: "Ombres", ...R100, hint: "Courbe paramétrique : région des ombres" },
    { name: "shadowSplit", label: "Séparation ombres", unit: "none", min: 10, max: 70, default: 25, step: 1, hint: "Frontière ombres / teintes sombres de la courbe paramétrique" },
    { name: "midtoneSplit", label: "Séparation tons moyens", unit: "none", min: 20, max: 80, default: 50, step: 1, hint: "Frontière teintes sombres / teintes claires" },
    { name: "highlightSplit", label: "Séparation hautes lumières", unit: "none", min: 30, max: 90, default: 75, step: 1, hint: "Frontière teintes claires / hautes lumières" },
  ],
  passes: passePyramide,
  sections,
  wgsl: `
${SRGB_TO_LINEAR_WGSL}
${LINEAR_TO_SRGB_WGSL}
${OKLAB_WGSL}

const RB_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
const RB_WB_TEMP_K = ${wf(RB_TABLE.wbTempK)};
const RB_WB_TINT_K = ${wf(RB_TABLE.wbTintK)};
const RB_EXPO_G = ${wf(RB_TABLE.expoG)};
const RB_CONTRAST_G = ${wf(RB_TABLE.contrastG)};
const RB_CONTRAST_PIVOT = ${wf(RB_TABLE.contrastPivot)};
const RB_SH_AMT_POS = ${wf(RB_TABLE.shadowAmtPos)};
const RB_SH_AMT_NEG = ${wf(RB_TABLE.shadowAmtNeg)};
const RB_SH_CENTER = ${wf(RB_TABLE.shadowCenter)};
const RB_SH_KAPPA = ${wf(RB_TABLE.shadowKappa)};
const RB_HL_AMT_POS = ${wf(RB_TABLE.highlightAmtPos)};
const RB_HL_AMT_NEG = ${wf(RB_TABLE.highlightAmtNeg)};
const RB_HL_CENTER = ${wf(RB_TABLE.highlightCenter)};
const RB_HL_KAPPA = ${wf(RB_TABLE.highlightKappa)};
const RB_BLACK_AMT_POS = ${wf(RB_TABLE.blackAmtPos)};
const RB_BLACK_AMT_NEG = ${wf(RB_TABLE.blackAmtNeg)};
const RB_BLACK_CENTER = ${wf(RB_TABLE.blackCenter)};
const RB_BLACK_KAPPA = ${wf(RB_TABLE.blackKappa)};
const RB_WHITE_AMT_POS = ${wf(RB_TABLE.whiteAmtPos)};
const RB_WHITE_AMT_NEG = ${wf(RB_TABLE.whiteAmtNeg)};
const RB_WHITE_CENTER = ${wf(RB_TABLE.whiteCenter)};
const RB_WHITE_KAPPA = ${wf(RB_TABLE.whiteKappa)};
const RB_TEXTURE_AMT = 1.2;
const RB_CLARITY_AMT = 0.9;
const RB_DEHAZE_AMT = 0.35;
const RB_CURVE_AMT = ${wf(RB_TABLE.curveAmt)};
const RB_CURVE_WIN = ${wf(RB_TABLE.curveWin)};
const RB_VIB_CHROMA_REF = 0.20;
const RB_SKIN_DIR = vec2<f32>(0.52, 0.854);

// Cloche beta normalisee (pic 1 au mode c, nulle en 0 et 1). Jumeau de bump() TS.
fn rb_bump(v: f32, c: f32, k: f32) -> f32 {
  let ec = k * c;
  let e1 = k * (1.0 - c);
  let peak = pow(c, ec) * pow(1.0 - c, e1);
  let vv = clamp(v, 0.0, 1.0);
  return pow(vv, ec) * pow(1.0 - vv, e1) / max(peak, 1e-6);
}

// Contraste : gamma double pivote, ancre en 0/pivot/1. Jumeau de contrastOp() TS.
fn rb_contrast(s: f32, kC: f32, pv: f32) -> f32 {
  if (kC == 0.0) { return s; }
  let gamma = exp(RB_CONTRAST_G * kC);
  if (s <= pv) { return pv * pow(s / pv, gamma); }
  return 1.0 - (1.0 - pv) * pow((1.0 - s) / (1.0 - pv), gamma);
}

// Exposition : gamma perceptuel ancre, unifie aux deux signes. Jumeau de exposureOp() TS.
fn rb_expo(s: f32, ev: f32) -> f32 {
  if (ev == 0.0) { return s; }
  return 1.0 - pow(1.0 - s, exp(RB_EXPO_G * ev));
}

fn rb_curve(s: f32, kSh: f32, kDk: f32, kLt: f32, kHi: f32, sSplit: f32, mSplit: f32, hSplit: f32) -> f32 {
  let ts = smoothstep(sSplit - RB_CURVE_WIN, sSplit + RB_CURVE_WIN, s);
  let tm = smoothstep(mSplit - RB_CURVE_WIN, mSplit + RB_CURVE_WIN, s);
  let th = smoothstep(hSplit - RB_CURVE_WIN, hSplit + RB_CURVE_WIN, s);
  let delta = kSh * (1.0 - ts) + kDk * (ts - tm) + kLt * (tm - th) + kHi * th;
  return clamp(s + RB_CURVE_AMT * delta, 0.0, 1.0);
}

// Bande FINE de Texture : tente 3x3 a un texel sur srcTexture, luminance seule.
// C'est le seul flou calcule DANS la passe finale ; les autres viennent de la
// pyramide (prevPass). Voir en-tete.
fn rb_fine_luma(uv: vec2<f32>) -> f32 {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  var sum = textureSample(srcTexture, srcSampler, uv).rgb * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-texel.x, 0.0)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( texel.x, 0.0)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(0.0, -texel.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(0.0,  texel.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-texel.x, -texel.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( texel.x, -texel.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-texel.x,  texel.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( texel.x,  texel.y)).rgb;
  return dot(sum / 16.0, RB_LUMA);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Identite au bit pres : tous les curseurs au defaut (separations 25/50/75).
  // Le round-trip OKLab n'etant pas exactement reversible, on renvoie l'entree
  // telle quelle plutot que d'introduire un LSB sur le temoin.
  if (params[0] == 0.0 && params[1] == 0.0 && params[2] == 0.0 && params[3] == 0.0
      && params[4] == 0.0 && params[5] == 0.0 && params[6] == 0.0 && params[7] == 0.0
      && params[8] == 0.0 && params[9] == 0.0 && params[10] == 0.0 && params[11] == 0.0
      && params[12] == 0.0 && params[13] == 0.0 && params[14] == 0.0 && params[15] == 0.0
      && params[16] == 0.0 && params[17] == 25.0 && params[18] == 50.0 && params[19] == 75.0) {
    return color;
  }

  var c = color.rgb; // DEJA lineaire (format -srgb) : aucune conversion sur l'image.

  // 1. BALANCE DES BLANCS — gains lineaires renormalises au blanc.
  let tU = params[0] / 100.0;
  let nU = params[1] / 100.0;
  var gR = 1.0 + RB_WB_TEMP_K * tU + RB_WB_TINT_K * nU;
  var gG = 1.0 - RB_WB_TINT_K * nU;
  var gB = 1.0 - RB_WB_TEMP_K * tU + RB_WB_TINT_K * nU;
  let wbNorm = RB_LUMA.x * gR + RB_LUMA.y * gG + RB_LUMA.z * gB;
  c = c * vec3<f32>(gR, gG, gB) / wbNorm;

  // 2-5. TON PERCEPTUEL — exposition (gamma ancre), contraste (sigmoide ancree),
  //      HL/ombres locaux (cloche sur la luminance floutee de prevPass), blancs/
  //      noirs (cloche ponctuelle). Toutes les formes tiennent 0 et 1.
  let blurLuma = clamp(dot(textureSample(prevPass, srcSampler, uv).rgb, RB_LUMA), 0.0, 1.0);
  let sBlur = linear_to_srgb(blurLuma);
  let wSh = rb_bump(sBlur, RB_SH_CENTER, RB_SH_KAPPA);
  let wHl = rb_bump(sBlur, RB_HL_CENTER, RB_HL_KAPPA);
  let ev = params[2];
  let kC = params[3] / 100.0;
  let kHl = params[4] / 100.0;
  let kSh = params[5] / 100.0;
  let kWh = params[6] / 100.0;
  let kBk = params[7] / 100.0;
  // Amplitude par signe (Lightroom est asymetrique — voir reglagesDeBaseTable).
  let shAmt = select(RB_SH_AMT_NEG, RB_SH_AMT_POS, kSh >= 0.0);
  let hlAmt = select(RB_HL_AMT_NEG, RB_HL_AMT_POS, kHl >= 0.0);
  let bkAmt = select(RB_BLACK_AMT_NEG, RB_BLACK_AMT_POS, kBk >= 0.0);
  let whAmt = select(RB_WHITE_AMT_NEG, RB_WHITE_AMT_POS, kWh >= 0.0);
  for (var i = 0u; i < 3u; i = i + 1u) {
    var s = linear_to_srgb(clamp(c[i], 0.0, 1.0));
    s = rb_expo(s, ev);
    s = rb_contrast(s, kC, RB_CONTRAST_PIVOT);
    s = clamp(s, 0.0, 1.0);
    s = s + kSh * shAmt * wSh;
    s = s + kHl * hlAmt * wHl;
    s = clamp(s, 0.0, 1.0);
    s = s + kBk * bkAmt * rb_bump(s, RB_BLACK_CENTER, RB_BLACK_KAPPA);
    s = s + kWh * whAmt * rb_bump(s, RB_WHITE_CENTER, RB_WHITE_KAPPA);
    c[i] = srgb_to_linear(clamp(s, 0.0, 1.0));
  }

  // 6. PRESENCE — Texture (bande fine, tente locale) + Clarte (bande moyenne,
  //    prevPass) + Voile. Additif en lumiere sur la luminance.
  if (params[8] != 0.0 || params[9] != 0.0 || params[10] != 0.0) {
    let lp = dot(c, RB_LUMA);
    let detailFin = lp - rb_fine_luma(uv);
    let detailMoyen = lp - blurLuma;
    let gainPresence = params[8] / 100.0 * RB_TEXTURE_AMT * detailFin
      + params[9] / 100.0 * RB_CLARITY_AMT * detailMoyen;
    let voile = params[10] / 100.0 * RB_DEHAZE_AMT * (lp - blurLuma);
    // Facteur sur la luminance, rapports de canaux preserves — Lightroom fait
    // Texture et Clarte sur Y seul en log-YCC (voir le twin) ; un offset par
    // canal changeait la saturation et la teinte.
    let fPres = max((lp + gainPresence + voile + 1e-4) / (lp + 1e-4), 0.0);
    c = c * fPres;
  }

  // 7. VIBRANCE / SATURATION — plan (a,b) d'OKLab, sans atan2.
  if (params[11] != 0.0 || params[12] != 0.0) {
    let lab = linear_srgb_to_oklab(c);
    let a = lab.y;
    let b = lab.z;
    let chroma = sqrt(a * a + b * b);
    let satFactor = 1.0 + params[12] / 100.0;
    var skin = 0.0;
    if (chroma > 0.0001) {
      let d = (a / chroma) * RB_SKIN_DIR.x + (b / chroma) * RB_SKIN_DIR.y;
      skin = smoothstep(0.6, 0.95, d);
    }
    let falloff = clamp(1.0 - chroma / RB_VIB_CHROMA_REF, 0.0, 1.0);
    let vibFactor = 1.0 + params[11] / 100.0 * falloff * (1.0 - skin);
    let scale = satFactor * vibFactor;
    c = oklab_to_linear_srgb(vec3<f32>(lab.x, a * scale, b * scale));
  }

  // 8. COURBE PARAMETRIQUE — perceptuel, par canal.
  if (params[13] != 0.0 || params[14] != 0.0 || params[15] != 0.0 || params[16] != 0.0) {
    let kSh2 = params[16] / 100.0;
    let kDk = params[15] / 100.0;
    let kLt = params[14] / 100.0;
    let kHi = params[13] / 100.0;
    let sSplit = params[17] / 100.0;
    let mSplit = params[18] / 100.0;
    let hSplit = params[19] / 100.0;
    for (var j = 0u; j < 3u; j = j + 1u) {
      c[j] = srgb_to_linear(rb_curve(linear_to_srgb(clamp(c[j], 0.0, 1.0)), kSh2, kDk, kLt, kHi, sSplit, mSplit, hSplit));
    }
  }

  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
`,
};

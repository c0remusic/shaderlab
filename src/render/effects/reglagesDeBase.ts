import type { EffectModule, EffectSection, EffectPass } from "./types";
import { DOWNSAMPLE_WGSL } from "./blurChain";
import { SRGB_TO_LINEAR_WGSL, LINEAR_TO_SRGB_WGSL, srgbToLinear, linearToSrgb } from "./srgbTransfer";
import { OKLAB_WGSL, linearSrgbToOklab, oklabToLinearSrgb } from "./oklab";
import { TEMPERATURE_GRADIENT, NUANCE_GRADIENT, RAINBOW_GRADIENT } from "./trackGradients";
import { RB_TABLE, type WbStep } from "./reglagesDeBaseTable";

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
 * ⚠️ PARITÉ LIGHTROOM 02b (2026-09-12, audit binaire 09). Trois divergences
 * prouvées corrigées, toutes calibrées sur les rampes mesurées :
 *  - BALANCE DES BLANCS : plus de renormalisation au blanc. Lightroom règle la WB
 *    en espace CAMÉRA (`ABCtoRGB_local_Temp`) et NE préserve PAS la luminance —
 *    les DEUX extrêmes de Température éclaircissent (mesuré). Gains linéaires par
 *    canal, PAR SIGNE, fittés sur `rampe_rgb` (table `wbTempPos/Neg`, `wbTintPos/Neg`).
 *  - VOILE : une composante GLOBALE par canal (`veilOp`) s'ajoute au contraste
 *    local, qui était inerte sur un ton plat (LR estime un canal sombre —
 *    `dark_channel`). Plus une désaturation des couleurs en ajout (`dehazeDesatK`).
 *  - BLANCS / NOIRS : leurs cloches pèsent sur la luminance FLOUTÉE (`sBlur`),
 *    LOCALES comme LR (`local_whites_blacks`), au lieu du pixel ponctuel. Sur une
 *    rampe `sBlur = s`, donc le fit ne bouge pas ; la localité ne se voit que sur
 *    une vraie image.
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
 * du voile).
 *
 * ⚠️ **TEXTURE EST FAITE DE DEUX BANDES, et elle lit la pyramide elle aussi**
 * (corrigé le 2026-09-16 ; ce paragraphe a dit « pas besoin de pyramide pour
 * elle » et c'était faux). Sa bande FINE est un noyau de treize prélèvements à
 * écartement ABSOLU dans la passe finale ; sa bande MOYENNE est la pyramide. Le
 * calcul exact de la réponse d'un noyau unique le force : quel que soit son
 * écartement, il meurt avant la période 32 px, quand Lightroom tient encore un
 * gain de 1,37 à la période 64. Le binaire nomme d'ailleurs ses DEUX étages de
 * rééchantillonnage (`fResample1a/1b`, `fResample2a/2b`, `conv1`, `conv2`).
 * Mesure, ajustement et écart résiduel :
 * `.scratch/lightroom-develop/research/07-portee-des-operateurs-locaux.md`.
 *
 * ⚠️ **LA PYRAMIDE NE TRANSPORTE PLUS UNE COULEUR** mais
 * `vec3(luminance, sqrt(luminance), 0)` — voir `PREMIER_NIVEAU_WGSL`. Son canal
 * `r` vaut exactement l'ancien `dot(rgb, RB_LUMA)` (flou et produit scalaire sont
 * tous deux linéaires), donc aucune calibration de ton ne bouge ; et `r − g²` est
 * la VARIANCE locale, gratuite, parce que y au carré EST la luminance. C'est elle
 * qui porte l'epsilon du filtre guidé de Texture.
 *
 * Écart assumé à Lightroom, qui donne à Clarté un rayon plus serré qu'aux Hautes
 * lumières / Ombres ; en 8 bits et sur ses radis descriptifs (jamais chiffrés),
 * le partage est acceptable et se calibre sur la planche.
 *
 * ⚠️ **CE QUI RESTE FAUX DANS CLARTÉ, et pourquoi ce n'est pas un réglage.**
 * Mesuré le 2026-09-16 : la portée de la Clarté d'Adobe vaut une FRACTION de
 * chaque dimension de l'image (une pyramide à nombre de niveaux fixe, bien plus
 * profonde que la nôtre), là où la nôtre vaut une quinzaine de pixels. Sur une
 * marche, elle rend un dépassement de −20,7 étalé sur des centaines de pixels
 * quand nous rendons −65 sur une trentaine : nous cernons le bord au lieu de
 * porter la masse. Approfondir la pyramide ne se fait PAS sans casser Texture,
 * dont la bande moyenne a justement besoin de la profondeur actuelle — et la
 * chaîne de passes étant LINÉAIRE, elle ne peut pas transporter deux profondeurs
 * à la fois. C'est une limite de structure, pas une constante à changer.
 *
 * Les passes de pyramide sont SAUTÉES (`EffectPass.enabled`) quand Hautes
 * lumières, Ombres, Blancs, Noirs, Clarté, Voile ET TEXTURE sont tous à 0 :
 * `prevPass` vaut alors la source, lue seulement par des termes eux-mêmes à 0 —
 * inerte. Et le module
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
// TEXTURE — DEUX bandes, et le partage entre elles est ajusté, pas choisi :
// `.scratch/lightroom-develop/assets/fit-texture-deux-bandes.py` les cale sur les
// quatorze gains mesurés de Lightroom, périodes 3 à 256 px — écart moyen 0,006,
// pire 0,013. La bande fine seule ne peut PAS y arriver : le calcul exact de la
// réponse d'un noyau unique (`reponse-noyau.py`) la fait mourir avant la période
// 32, quand Lightroom tient encore 1,37 à 64. Le binaire nomme d'ailleurs ses
// deux étages de rééchantillonnage (`fResample1a/1b`, `fResample2a/2b`).
const TEXTURE_FIN = RB_TABLE.textureFin;     // poids de la bande fine (noyau 13 taps)
const TEXTURE_MOYEN = RB_TABLE.textureMoyen; // poids de la bande moyenne (pyramide)
const TEXTURE_RAYON = RB_TABLE.textureRayon; // écartement du noyau fin, en PIXELS
const TEXTURE_EPS = RB_TABLE.textureEps;     // epsilon du filtre guidé, variance de sqrt(luminance)
const CLARITY_AMT = 0.9;  // gain additif linéaire de la bande moyenne à |100| (flou spatial, hors calibration rampe)
const DEHAZE_AMT = 0.35;  // amplitude du retrait/ajout de voile à |100| (flou spatial, hors calibration rampe)
const CURVE_AMT = RB_TABLE.curveAmt;     // lift perceptuel maximal, PAR RÉGION
const CURVE_KAPPA = RB_TABLE.curveKappa; // étroitesse de la cloche, PAR RÉGION
const CURVE_EDGE = RB_TABLE.curveEdge;   // retrait des bouts pour placer les centres
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

/** LA CARTE D'ADOBE (`cr_div_map` dans le binaire) — une homographie qui CLOUE
 *  les deux bouts : f(0)=0, f(1)=1, et l'identité à a=1. Même fonction que celle
 *  du Color Grading, redite ici plutôt qu'importée : `colorGrading` ne l'exporte
 *  pas, et l'y exporter lierait deux modules qui n'ont rien d'autre en commun.
 *  Jumeau de `rb_carte_adobe` WGSL. */
function carteAdobe(x: number, a: number): number {
  return (a * x) / (a * x + 1 - x);
}

/** LIGNE × POIDS en espace LOG2 — la forme que le binaire de Lightroom nomme
 *  (`uLineShadowScale/Offset` × `uLumWeightShadowScale/Offset`, voir la table).
 *
 *  `ligne` décroît (ombres) ou croît (hautes lumières) jusqu'à s'annuler au-delà
 *  de `lref` : c'est la PORTÉE de l'opérateur. `poids` est une droite clampée à
 *  [0,1] qui l'ÉTEINT à l'autre bout — pour les ombres, c'est lui qui tient le
 *  ras du noir, là où notre ancienne cloche avait une pente infinie.
 *
 *  Rend le décalage en LOG2, à appliquer comme un gain (`lin · 2^delta`). Jumeau
 *  de `rb_ligne_poids` WGSL. */
function ligneFoisPoids(
  lin: number, flare: number, lref: number, wScale: number, wOffset: number, versLeBas: boolean,
): number {
  const L = Math.log2(Math.max(clamp01(lin) + flare, 1e-9));
  const ligne = versLeBas ? Math.max(0, lref - L) : Math.max(0, L - lref);
  if (ligne === 0) return 0;
  return ligne * clamp01(wScale * L + wOffset);
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

/** Voile GLOBAL, par canal en espace sRGB (`s`), `d = dehaze/100`. Composante que
 *  Lightroom porte par un canal sombre et qui DÉPLACE une rampe plate là où notre
 *  contraste local `(lp−blurLuma)` est inerte (audit binaire 09). Identité à d=0.
 *   - d>0 (retrait) : récupération ancrée `s(1−ω)/(1−ω·s)`, `ω = dehazeOmega·d` —
 *     décontraste inverse, creuse les tons, tient 0 et 1.
 *   - d<0 (ajout) : écran vers un airlight `1−(1−a)·(1−s)^g`, `a = dehazeAirlight·|d|`,
 *     `g = 1+(dehazeGamma−1)·|d|` — relève le noir vers l'airlight, tient le blanc.
 *  Jumeau de `rb_veil` WGSL. Formes fittées sur `voile-p100`/`voile-m100`. */
function veilOp(s: number, d: number, sombre = s): number {
  s = clamp01(s);
  if (d > 0) {
    // FORME DE HE ET AL., celle que le binaire nomme (fA, fAReciprocal dans
    // UniformsDehazeTrMConstantAirlightData) : `J = (I − A)/t + A`, avec une
    // transmission `t` tirée du CANAL SOMBRE. Deux propriétés en tombent, et ce
    // sont exactement les deux défauts qu'elle corrige — un POINT FIXE en A, et
    // un GAIN 1/t SUPÉRIEUR à un, donc du contraste local ajouté. L'ancienne
    // forme `s(1−ω)/(1−ω·s)` n'avait ni l'un ni l'autre : elle comprimait.
    const w = RB_TABLE.dehazeOmegaMax * carteAdobe(d, RB_TABLE.dehazeDoseMapPos);
    const a = RB_TABLE.dehazeAirlightPos;
    const t = Math.max(1 - (w * clamp01(sombre)) / a, RB_TABLE.dehazeTMin);
    return clamp01((s - a) / t + a);
  }
  // DOSE passée par la carte d'Adobe : la course était linéaire et le défaut vivait
  // au MILIEU, pas aux bouts (voir `dehazeDoseMapNeg`).
  const dd = carteAdobe(-d, RB_TABLE.dehazeDoseMapNeg);
  const a = RB_TABLE.dehazeAirlight * dd;
  const g = 1 + (RB_TABLE.dehazeGamma - 1) * dd;
  return clamp01(1 - (1 - a) * Math.pow(1 - s, g));
}

/** Gain d'un axe de balance des blancs à la dose `t` (0..1), par interpolation
 *  entre les points de rupture MESURÉS, ancrée à 1 en dose nulle. La loi du
 *  curseur n'est pas proportionnelle à la dose — voir `reglagesDeBaseTable`.
 *  Jumeau de `rb_wb_lerp` WGSL, qui la déroule faute de boucle sûre. */
function wbLerp(steps: readonly WbStep[], i: number, t: number): number {
  if (t <= 0) return 1;
  const d = t * 100;
  let d0 = 0, g0 = 1;
  for (const s of steps) {
    if (d <= s.dose) return g0 + (s.gamma[i] - g0) * ((d - d0) / (s.dose - d0));
    d0 = s.dose; g0 = s.gamma[i];
  }
  return g0;
}

/** Vrai quand tous les curseurs sont à leur défaut (séparations à 25/50/75). */
function auDefaut(p: readonly number[]): boolean {
  for (let i = 0; i < 17; i++) if (p[i] !== 0) return false;
  return p[17] === 25 && p[18] === 50 && p[19] === 75;
}

/** Courbe paramétrique sur une valeur perceptuelle `s` (0..1). Une CLOCHE par
 *  région, centrée sur le milieu de ses bornes — les bornes du noir et du blanc
 *  étant prises à `curveEdge` et `1−curveEdge`. Les séparations déplacent donc
 *  les centres, ce qui est leur rôle.
 *
 *  ⚠️ C'ÉTAIENT QUATRE PLATEAUX TÉLESCOPIQUES à amplitude unique jusqu'au
 *  2026-09-16, et c'est la mesure qui les a défaits : à `Ombres` +100, Lightroom
 *  lève le niveau 50 de +29,7 puis REDESCEND à zéro vers 128 — un plateau tient
 *  jusqu'à la séparation, une cloche retombe. Les quatre amplitudes de pic sont
 *  d'ailleurs toutes différentes (+29,7 / +55,8 / +71,4 / +36,2), ce qu'une
 *  amplitude unique ne peut pas rendre.
 *
 *  Résidu par région, cloche contre mesure : 1,14 / 1,61 / 2,89 / 1,30 niveaux,
 *  là où les plateaux rendaient 8,4 / 13,3 / 16,5 / 6,5. Les centres ne sont PAS
 *  fittés — ils sortent des séparations et de `curveEdge`, et tombent sur les
 *  quatre centres mesurés (0,17 / 0,39 / 0,65 / 0,81) à deux centièmes près. */
function courbeParametrique(
  s: number,
  kShadows: number, kDarks: number, kLights: number, kHigh: number,
  sSplit: number, mSplit: number, hSplit: number,
): number {
  const bornes = [CURVE_EDGE, sSplit, mSplit, hSplit, 1 - CURVE_EDGE];
  const k = [kShadows, kDarks, kLights, kHigh];
  let delta = 0;
  for (let r = 0; r < 4; r++) {
    if (k[r] === 0) continue;
    const centre = clamp(( bornes[r] + bornes[r + 1]) / 2, 0.02, 0.98);
    delta += k[r] * CURVE_AMT[r] * bump(s, centre, CURVE_KAPPA[r]);
  }
  return clamp01(s + delta);
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

  // 1. BALANCE DES BLANCS — un GAMMA ANCRÉ par canal, en espace sRGB. Lightroom
  //    règle la WB en espace CAMÉRA et NE préserve PAS la luminance : les deux
  //    extrêmes de Température éclaircissent (audit 09, mesuré temperature-p100
  //    Δlum +0,19 / m100 +0,23). Un axe à 0 a un exposant de 1 (identité) ; les
  //    deux axes se composent par produit d'exposants, comme deux gammas
  //    successifs.
  //
  //    ⚠️ C'ÉTAIT UN GAIN MULTIPLICATIF EN LUMIÈRE LINÉAIRE, PUIS UN ÉCRÊTAGE,
  //    jusqu'au 2026-09-16 — et c'est ce qu'Antoine voyait sans pouvoir le
  //    nommer : « on ne se retrouve pas avec les résultats qu'on attend ». Un
  //    gain SATURE le canal poussé, et il saturait dès les réglages doux : à
  //    Température −25, notre bleu sortait à 251 au niveau 160 quand Lightroom
  //    rend 199 — cinquante-deux niveaux. Le gamma ancré tient 0 et 1 par
  //    construction, donc il COMPRIME au lieu d'écrêter, comme lui.
  //
  //    Mesuré sur les sept doses de Température : écart moyen **10,96 → 4,01
  //    niveaux** (`assets/verifier-ton.mjs`). Validation croisée par dose —
  //    ajuster sans une dose, la prédire depuis ses voisines : 1,36 / 2,20 /
  //    3,60 niveaux là où la dose a des voisins des deux côtés. Les doses
  //    extrêmes sortent pires (6,7 à 19,5) parce que les prédire est une
  //    EXTRAPOLATION, et parce que `temperature-m50` manque à la branche
  //    négative — trou déjà relevé par la contre-expertise du 2026-09-12.
  //
  //    ⚠️ Deux formes essayées AVANT celle-ci et réfutées par la mesure, toutes
  //    deux consignées au ticket 02 : la renormalisation au blanc (retirée le
  //    2026-09-12, donc pas la cause), et une compression douce contre le blanc
  //    par canal — celle qui avait marché le matin même sur la luminance du
  //    Color Grading — qui fait passer les sept doses de 10,96 à 18,76 parce
  //    qu'elle comprime AUSSI le bas de la rampe, là où Lightroom ne comprime pas.
  const tP = Math.max(temperature / 100, 0), tN = Math.max(-temperature / 100, 0);
  const nP = Math.max(nuance / 100, 0), nN = Math.max(-nuance / 100, 0);
  const wbGamma = (i: number): number =>
    wbLerp(RB_TABLE.wbTempPos, i, tP) * wbLerp(RB_TABLE.wbTempNeg, i, tN) *
    wbLerp(RB_TABLE.wbTintPos, i, nP) * wbLerp(RB_TABLE.wbTintNeg, i, nN);
  // L'aller-retour sRGB est FERMÉ, comme celui du ton plus bas : on encode,
  // on opère, on redécode. La WB vivait en lumière linéaire ; elle rejoint le
  // chemin perceptuel parce que c'est là que la mesure la place.
  c = [0, 1, 2].map((i) => {
    const g = wbGamma(i);
    if (g === 1) return c[i];
    return srgbToLinear(clamp01(1 - Math.pow(1 - linearToSrgb(clamp01(c[i])), g)));
  }) as Vec3;

  // 2-5. TON PERCEPTUEL — exposition (gamma ancré), contraste (sigmoïde ancrée),
  //      hautes lumières / ombres LOCAUX (cloche sur la luminance floutée),
  //      blancs / noirs (cloche ponctuelle). Aller-retour sRGB fermé, par canal.
  //      Toutes les formes tiennent 0 et 1 (voir en-tête et `reglagesDeBaseTable`).
  const sBlur = linearToSrgb(clamp01(blurLuma));
  const kC = contrast / 100, kHl = highlights / 100, kSh = shadows / 100;
  const kWh = whites / 100, kBk = blacks / 100;
  // OMBRES / HAUTES LUMIÈRES : décalage en LOG2, ligne × poids, calculé sur la
  // luminance FLOUTÉE (local) et appliqué au pixel comme un GAIN. Voir la table
  // pour d'où vient la forme — c'est l'uniforme de Lightroom, pas une intuition.
  const dLog = (kSh !== 0 ? kSh * RB_TABLE.shadowAmt * ligneFoisPoids(
    blurLuma, 0, RB_TABLE.shadowLref, RB_TABLE.shadowWeightScale, RB_TABLE.shadowWeightOffset, true) : 0)
    + (kHl !== 0 ? kHl * RB_TABLE.highlightAmt * ligneFoisPoids(
      blurLuma, RB_TABLE.highlightFlare, RB_TABLE.highlightLref,
      RB_TABLE.highlightWeightScale, RB_TABLE.highlightWeightOffset, false) : 0);
  const gainTon = dLog === 0 ? 1 : Math.pow(2, dLog);
  // Amplitude par SIGNE (Lightroom est asymétrique — voir `reglagesDeBaseTable`).
  const bkAmt = kBk >= 0 ? RB_TABLE.blackAmtPos : RB_TABLE.blackAmtNeg;
  const whAmt = kWh >= 0 ? RB_TABLE.whiteAmtPos : RB_TABLE.whiteAmtNeg;
  const ton = (lin: number): number => {
    // Le gain d'ombres / hautes lumières s'applique en LUMIÈRE LINÉAIRE, avant
    // le passage en perceptuel : le noir pur reste noir sans clamp ni cas
    // particulier, parce que `0 × gain = 0`.
    let s = linearToSrgb(clamp01(lin * gainTon));
    s = exposureOp(s, exposure);                                 // exposition (gamma perceptuel ancré)
    s = contrastOp(s, kC, RB_TABLE.contrastPivot);              // contraste (gamma double pivoté)
    s = clamp01(s);
    s = s + kBk * bkAmt * bump(sBlur, RB_TABLE.blackCenter, RB_TABLE.blackKappa); // noirs (local, luminance floutée — comme LR local_whites_blacks)
    s = s + kWh * whAmt * bump(sBlur, RB_TABLE.whiteCenter, RB_TABLE.whiteKappa); // blancs (local, luminance floutée)
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
      // TEXTURE = 0 dans le twin, et c'est désormais le terme ENTIER qui manque,
      // ses deux bandes comprises : la fine demande treize prélèvements de
      // voisinage, la moyenne demande la pyramide, et leur portail commun demande
      // une variance locale — trois choses qu'un twin sans voisinage n'a pas. Les
      // cinq constantes vivent dans `RB_TABLE` et sont interpolées dans le WGSL,
      // donc aucune n'est écrite deux fois (garde `jumeauxWgsl`).
      (texture / 100) * (TEXTURE_FIN + TEXTURE_MOYEN) * 0
      + (clarity / 100) * CLARITY_AMT * detailMoyen;
    // Voile LOCAL : le flou moyen sert d'estimation du contraste de voile (ce que
    // faisait déjà le module). Inerte sur un ton plat — c'est la limite corrigée
    // par le terme GLOBAL ci-dessous.
    // Le terme LOCAL du voile ne vaut plus que pour l'AJOUT : du côté du RETRAIT,
    // la forme de He produit elle-même son contraste local par son gain 1/t.
    const voileLocal = dehaze < 0 ? (dehaze / 100) * DEHAZE_AMT * (lp - clamp01(blurLuma)) : 0;
    const g = gainPresence + voileLocal;
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
    // Voile GLOBAL, par canal en sRGB : la composante de ton que Lightroom porte
    // par un canal sombre et qui agit là où le terme local est inerte (rampe
    // plate). Fittée sur `voile-p100`/`voile-m100`. La désaturation des couleurs
    // (côté ajout) est portée par `dehazeDesatK` dans le bloc OKLab plus bas.
    if (dehaze !== 0) {
      const d = dehaze / 100;
      c = [
        srgbToLinear(veilOp(linearToSrgb(clamp01(c[0])), d)),
        srgbToLinear(veilOp(linearToSrgb(clamp01(c[1])), d)),
        srgbToLinear(veilOp(linearToSrgb(clamp01(c[2])), d)),
      ];
    }
  }

  // 7. VIBRANCE / SATURATION — dans le plan (a,b) d'OKLab, sans atan2 (bug Dawn,
  //    voir `etalonnage`). Saturation : facteur uniforme. Vibrance : fort sur les
  //    couleurs peu saturées, faible sur les saturées, éteinte sur la peau.
  // Le voile en AJOUT (dehaze < 0) désature les couleurs vers l'airlight (LR
  // blanchit les saturées) — porté ici comme un facteur de chroma OKLab.
  const veilChroma = dehaze < 0 ? 1 - RB_TABLE.dehazeDesatK * (-dehaze / 100) : 1;
  if (vibrance !== 0 || saturation !== 0 || veilChroma !== 1) {
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
    const scale = satFactor * vibFactor * veilChroma;
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

/** Premier niveau de la pyramide : la MEME tente 3x3 que les niveaux suivants,
 *  mais elle change ce que la pyramide transporte. Au lieu d'une couleur, elle
 *  emet `vec3(luminance, sqrt(luminance), 0)` — et ces deux nombres suffisent a
 *  tout ce qui lit la pyramide :
 *
 *    - `r` est la luminance floutee, IDENTIQUE a ce que `dot(rgb, RB_LUMA)`
 *      rendait (un flou est lineaire, un produit scalaire aussi, donc les deux
 *      ordres donnent le meme nombre) : Hautes lumieres / Ombres / Blancs /
 *      Noirs / Voile gardent leur calibration au chiffre pres ;
 *    - `g` est la moyenne de y = sqrt(luminance), l'espace ou Texture travaille ;
 *    - et `r - g*g` est la VARIANCE locale de y, parce que y au carre EST la
 *      luminance. La variance ne coute donc aucun canal de plus, aucune passe de
 *      plus et aucune lecture de plus : elle tombe de l'identite `E[y²] = E[l]`.
 *
 *  Cette variance est ce qui manquait aux deux operateurs de presence. Texture
 *  s'en sert comme epsilon de filtre guide (elle s'efface sur un bord franc) ;
 *  Clarte s'en sert a l'envers, comme portail de detail (elle ne fait rien sur
 *  un aplat). Les deux comportements sont mesures chez Lightroom, voir l'en-tete. */
const PREMIER_NIVEAU_WGSL = `
fn rb_pn(uv: vec2<f32>) -> vec2<f32> {
  let l = max(dot(textureSample(srcTexture, srcSampler, uv).rgb, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0);
  return vec2<f32>(l, sqrt(l));
}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let o = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  var sum = rb_pn(uv) * 4.0;
  sum = sum + rb_pn(uv + vec2<f32>(-o.x,  0.0)) * 2.0;
  sum = sum + rb_pn(uv + vec2<f32>( o.x,  0.0)) * 2.0;
  sum = sum + rb_pn(uv + vec2<f32>( 0.0, -o.y)) * 2.0;
  sum = sum + rb_pn(uv + vec2<f32>( 0.0,  o.y)) * 2.0;
  sum = sum + rb_pn(uv + vec2<f32>(-o.x, -o.y));
  sum = sum + rb_pn(uv + vec2<f32>( o.x, -o.y));
  sum = sum + rb_pn(uv + vec2<f32>(-o.x,  o.y));
  sum = sum + rb_pn(uv + vec2<f32>( o.x,  o.y));
  let m = sum / 16.0;
  // TROISIEME CANAL : l ECART-TYPE local de y, sur le support de cette tente.
  // Il ne coute rien — m.x est deja E[l] et y au carre EST l, donc E[y²] = m.x
  // et la variance vaut m.x - m.y². Aucun prelevement, aucune passe de plus.
  //
  // L ECART-TYPE et pas la variance, et ce n est pas cosmetique : les cibles de
  // passe sont en HUIT BITS sRGB (srgbFormat du runner), donc ce canal est
  // quantifie. Une variance de matiere vaut ~0,015 et tomberait sur deux ou trois
  // niveaux ; son ecart-type vaut ~0,12, et l encodage sRGB serre justement ses
  // pas pres de zero, la ou cette grandeur vit.
  //
  // Ce canal est MOYENNE par les niveaux suivants comme les deux autres (ils
  // portent rgb), si bien que la descente le transforme en presence de detail au
  // grand rayon — la grandeur que la mesure de portee designe comme manquante a
  // Clarte (research/07). Personne ne le lit encore.
  return vec4<f32>(m, sqrt(max(m.x - m.y * m.y, 0.0)), 1.0);
}
`;

const passePyramide: EffectPass[] = (() => {
  // La pyramide sert le flou moyen-large lu par Hautes lumières / Ombres / Blancs
  // / Noirs (poids sur la luminance floutée `sBlur`) et par Clarté / Voile local
  // (contraste local). Blancs/Noirs SONT désormais locaux comme Lightroom
  // (`local_whites_blacks`) : ils doivent donc réveiller la pyramide, sinon
  // `prevPass` resterait la source et ils perdraient leur localité. Sautée quand
  // les SIX sont à 0 : `prevPass` vaut alors la source, lue seulement par des
  // termes à 0. Structure identique à la bande Clarté de `nettete`.
  // ⚠️ TEXTURE réveille désormais la pyramide, et c'est une correction, pas un
  // ajout : la mesure du 2026-09-16 montre que la Texture de Lightroom tient un
  // gain de 1,37 à la période 64 px, qu'AUCUN noyau de passe finale ne peut
  // produire sans replier (calcul exact dans `reponse-noyau.py`). Elle est faite
  // de DEUX bandes — le binaire nomme ses deux étages de rééchantillonnage — et
  // la seconde est la pyramide. Sans ce réveil, `prevPass` vaudrait la source et
  // la bande moyenne de Texture lirait du bruit au lieu d'un flou.
  const utile = (params: Record<string, number>) =>
    params.highlights !== 0 || params.shadows !== 0 || params.whites !== 0 ||
    params.blacks !== 0 || params.clarity !== 0 || params.dehaze !== 0 ||
    params.texture !== 0;
  return [
    { scale: 0.5, wgsl: PREMIER_NIVEAU_WGSL, enabled: utile },
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
/** Formate un triplet en littéral `vec3<f32>` WGSL (mêmes valeurs que le twin). */
const wv3 = (a: readonly number[]): string => `vec3<f32>(${wf(a[0])}, ${wf(a[1])}, ${wf(a[2])})`;

/** Jumeau WGSL de `wbLerp`, DÉROULÉ segment par segment. Pas de boucle ni de
 *  tableau indexé dynamiquement : naga et Dawn sont stricts là-dessus, et une
 *  liste de deux à quatre paliers ne vaut pas ce risque. Les `select` vont du
 *  dernier segment au premier pour que la dose la plus basse l'emporte. */
function wbFn(nom: string, steps: readonly WbStep[]): string {
  const lignes: string[] = [];
  let d0 = 0;
  let g0 = "vec3<f32>(1.0)";
  for (const s of steps) {
    const g1 = wv3(s.gamma);
    lignes.push(`  g = select(g, ${g0} + (${g1} - ${g0}) * ((d - ${wf(d0)}) / ${wf(s.dose - d0)}), d <= ${wf(s.dose)});`);
    d0 = s.dose;
    g0 = g1;
  }
  return [
    `fn ${nom}(t: f32) -> vec3<f32> {`,
    `  let d = t * 100.0;`,
    `  var g = ${g0};`,
    ...lignes.reverse(),
    `  return select(g, vec3<f32>(1.0), t <= 0.0);`,
    `}`,
  ].join("\n");
}

/** Quatre constantes TS en un `array<f32, 4>` WGSL — les tables PAR RÉGION de la
 *  courbe paramétrique. Interpolé, jamais recopié : `jumeauxWgsl.test.ts` existe
 *  parce qu'une constante écrite deux fois avait déjà divergé dans ce dépôt. */
function wv4(v: readonly number[]): string {
  return `array<f32, 4>(${v.map((x) => wf(x)).join(", ")})`;
}

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
const fRb = (x: number): string => x.toFixed(8);

export const reglagesDeBase: EffectModule = {
  id: "reglagesDeBase",
  name: "Réglages de base",
  params: [
    { name: "temperature", label: "Température", ...R100, trackGradient: TEMPERATURE_GRADIENT, hint: "Balance des blancs relative : positif réchauffe (jaune), négatif refroidit (bleu). Comme Lightroom, les deux extrêmes éclaircissent l'image" },
    { name: "nuance", label: "Nuance", ...R100, trackGradient: NUANCE_GRADIENT, hint: "Balance des blancs relative : positif vire au magenta, négatif au vert" },
    { name: "exposure", label: "Exposition", unit: "none", min: -5, max: 5, default: 0, step: 0.05, hint: "Gain global en indices de lumination (IL), 2^valeur en lumière linéaire" },
    { name: "contrast", label: "Contraste", ...R100, hint: "Pente autour du gris moyen, en espace perceptuel" },
    { name: "highlights", label: "Hautes lumières", ...R100, hint: "Récupère (négatif) ou ouvre (positif) les hautes lumières, pondéré par une luminance FLOUTÉE — local, pas une courbe" },
    { name: "shadows", label: "Ombres", ...R100, hint: "Ouvre (positif) ou ferme (négatif) les ombres, local (luminance floutée)" },
    { name: "whites", label: "Blancs", ...R100, hint: "Déplace le point blanc, pondéré par une luminance FLOUTÉE (local, comme Lightroom)" },
    { name: "blacks", label: "Noirs", ...R100, hint: "Déplace le point noir, pondéré par une luminance FLOUTÉE (local, comme Lightroom)" },
    { name: "texture", label: "Texture", ...R100, hint: "Contraste local à PETIT rayon (bande fine), sur la luminance" },
    { name: "clarity", label: "Clarté", ...R100, hint: "Contraste local à MOYEN rayon (bande large), sur la luminance" },
    { name: "dehaze", label: "Correction du voile", ...R100, hint: "Retire (positif, contraste) ou ajoute (négatif, brume claire désaturée) un voile — composante globale sur le ton plus contraste local" },
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
${wbFn("rb_wb_temp_pos", RB_TABLE.wbTempPos)}
${wbFn("rb_wb_temp_neg", RB_TABLE.wbTempNeg)}
${wbFn("rb_wb_tint_pos", RB_TABLE.wbTintPos)}
${wbFn("rb_wb_tint_neg", RB_TABLE.wbTintNeg)}
const RB_EXPO_G = ${wf(RB_TABLE.expoG)};
const RB_CONTRAST_G = ${wf(RB_TABLE.contrastG)};
const RB_CONTRAST_PIVOT = ${wf(RB_TABLE.contrastPivot)};
const RB_SH_LREF = ${wf(RB_TABLE.shadowLref)};
const RB_SH_W_SCALE = ${wf(RB_TABLE.shadowWeightScale)};
const RB_SH_W_OFFSET = ${wf(RB_TABLE.shadowWeightOffset)};
const RB_SH_AMT = ${wf(RB_TABLE.shadowAmt)};
const RB_HL_LREF = ${wf(RB_TABLE.highlightLref)};
const RB_HL_W_SCALE = ${wf(RB_TABLE.highlightWeightScale)};
const RB_HL_W_OFFSET = ${wf(RB_TABLE.highlightWeightOffset)};
const RB_HL_AMT = ${wf(RB_TABLE.highlightAmt)};
const RB_HL_FLARE = ${wf(RB_TABLE.highlightFlare)};
const RB_BLACK_AMT_POS = ${wf(RB_TABLE.blackAmtPos)};
const RB_BLACK_AMT_NEG = ${wf(RB_TABLE.blackAmtNeg)};
const RB_BLACK_CENTER = ${wf(RB_TABLE.blackCenter)};
const RB_BLACK_KAPPA = ${wf(RB_TABLE.blackKappa)};
const RB_WHITE_AMT_POS = ${wf(RB_TABLE.whiteAmtPos)};
const RB_WHITE_AMT_NEG = ${wf(RB_TABLE.whiteAmtNeg)};
const RB_WHITE_CENTER = ${wf(RB_TABLE.whiteCenter)};
const RB_WHITE_KAPPA = ${wf(RB_TABLE.whiteKappa)};
const RB_TEXTURE_FIN = ${fRb(TEXTURE_FIN)};
const RB_TEXTURE_MOYEN = ${fRb(TEXTURE_MOYEN)};
const RB_TEXTURE_RAYON = ${fRb(TEXTURE_RAYON)};
const RB_TEXTURE_EPS = ${fRb(TEXTURE_EPS)};
const RB_CLARITY_AMT = ${fRb(CLARITY_AMT)};
const RB_DEHAZE_AMT = ${fRb(DEHAZE_AMT)};
const RB_CURVE_AMT = ${wv4(RB_TABLE.curveAmt)};
const RB_CURVE_KAPPA = ${wv4(RB_TABLE.curveKappa)};
const RB_CURVE_EDGE = ${wf(RB_TABLE.curveEdge)};
const RB_VIB_CHROMA_REF = ${fRb(VIB_CHROMA_REF)};
const RB_SKIN_DIR = vec2<f32>(0.52, 0.854);
const RB_DEHAZE_OMEGA_MAX = ${wf(RB_TABLE.dehazeOmegaMax)};
const RB_DEHAZE_DOSE_MAP_POS = ${wf(RB_TABLE.dehazeDoseMapPos)};
const RB_DEHAZE_AIRLIGHT_POS = ${wf(RB_TABLE.dehazeAirlightPos)};
const RB_DEHAZE_T_MIN = ${wf(RB_TABLE.dehazeTMin)};
const RB_DEHAZE_AIRLIGHT = ${wf(RB_TABLE.dehazeAirlight)};
const RB_DEHAZE_GAMMA = ${wf(RB_TABLE.dehazeGamma)};
const RB_DEHAZE_DOSE_MAP_NEG = ${wf(RB_TABLE.dehazeDoseMapNeg)};
const RB_DEHAZE_DESAT_K = ${wf(RB_TABLE.dehazeDesatK)};

// Cloche beta normalisee (pic 1 au mode c, nulle en 0 et 1). Jumeau de bump() TS.
// LIGNE x POIDS en LOG2 — jumeau de ligneFoisPoids cote TS. La ligne porte la
// PORTEE de l operateur (elle s annule au-dela de lref), le poids clampe l ETEINT
// a l autre bout : pour les ombres, c est lui qui tient le ras du noir. Rend le
// decalage en log2, a appliquer comme un gain.
fn rb_ligne_poids(lin: f32, flare: f32, lref: f32, wScale: f32, wOffset: f32, versLeBas: bool) -> f32 {
  let L = log2(max(clamp(lin, 0.0, 1.0) + flare, 1e-9));
  let ligne = select(max(0.0, L - lref), max(0.0, lref - L), versLeBas);
  return ligne * clamp(wScale * L + wOffset, 0.0, 1.0);
}

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

// Voile GLOBAL par canal, en sRGB. d>0 = recuperation ancree ; d<0 = ecran vers
// airlight. Identite a d=0. Jumeau de veilOp() TS (voir son en-tete).
// LA CARTE D ADOBE (cr_div_map) — homographie qui cloue les deux bouts, identite
// a a=1. Jumeau de carteAdobe cote TS.
fn rb_carte_adobe(x: f32, a: f32) -> f32 {
  return (a * x) / (a * x + 1.0 - x);
}

fn rb_veil(sIn: f32, d: f32, sombre: f32) -> f32 {
  let s = clamp(sIn, 0.0, 1.0);
  if (d > 0.0) {
    // Forme de He et al., celle que le binaire nomme : J = (I - A)/t + A, la
    // transmission t venant du CANAL SOMBRE. Point fixe en A, et gain 1/t
    // superieur a un — les deux proprietes que l ancienne forme n avait pas.
    let w = RB_DEHAZE_OMEGA_MAX * rb_carte_adobe(d, RB_DEHAZE_DOSE_MAP_POS);
    let a = RB_DEHAZE_AIRLIGHT_POS;
    let t = max(1.0 - w * clamp(sombre, 0.0, 1.0) / a, RB_DEHAZE_T_MIN);
    return clamp((s - a) / t + a, 0.0, 1.0);
  }
  if (d < 0.0) {
    // DOSE passee par la carte d Adobe : la course etait lineaire et le defaut
    // vivait au MILIEU, pas aux bouts (voir dehazeDoseMapNeg dans la table).
    let dd = rb_carte_adobe(-d, RB_DEHAZE_DOSE_MAP_NEG);
    let a = RB_DEHAZE_AIRLIGHT * dd;
    let g = 1.0 + (RB_DEHAZE_GAMMA - 1.0) * dd;
    return clamp(1.0 - (1.0 - a) * pow(1.0 - s, g), 0.0, 1.0);
  }
  return s;
}

// Une CLOCHE par region, centree sur le milieu de ses bornes — celles du noir et
// du blanc prises a RB_CURVE_EDGE. Jumeau de courbeParametrique : c etaient quatre
// plateaux telescopiques jusqu au 2026-09-16, et la mesure dit des cloches.
fn rb_curve(s: f32, kSh: f32, kDk: f32, kLt: f32, kHi: f32, sSplit: f32, mSplit: f32, hSplit: f32) -> f32 {
  let bornes = array<f32, 5>(RB_CURVE_EDGE, sSplit, mSplit, hSplit, 1.0 - RB_CURVE_EDGE);
  let k = array<f32, 4>(kSh, kDk, kLt, kHi);
  var delta = 0.0;
  for (var r = 0; r < 4; r = r + 1) {
    let centre = clamp((bornes[r] + bornes[r + 1]) * 0.5, 0.02, 0.98);
    delta = delta + k[r] * RB_CURVE_AMT[r] * rb_bump(s, centre, RB_CURVE_KAPPA[r]);
  }
  return clamp(s + delta, 0.0, 1.0);
}

// Bande FINE de Texture : treize prelevements a ecartement ABSOLU en pixels, sur
// srcTexture, en espace y = sqrt(luminance). C'est le seul flou calcule DANS la
// passe finale ; les autres viennent de la pyramide (prevPass). Voir en-tete.
//
// TREIZE ET PAS NEUF, et les quatre de plus ne coutent rien de ce qu'on croit :
// une tente 3x3 etiree a six pixels laisse des trous entre ses points, donc elle
// REPLIE — un reseau fin passerait entre les mailles. Les quatre taps interieurs
// a mi-ecartement les bouchent. Et surtout les treize memes lectures rendent la
// MOYENNE et la VARIANCE locales : l'epsilon du filtre guide ne coute aucune
// lecture de plus, seulement une multiplication par tap.
//
// L'espace est y = sqrt(luminance) et non la lumiere lineaire. Lightroom fait
// Texture en log-YCC (TextureEncodeLogYCC dans le binaire) : un epsilon pose en
// lumiere lineaire donnerait une dependance au ton MONOTONE (plein gain dans les
// ombres, rien dans les hautes lumieres), alors que la mesure rend une reponse
// presque plate, legerement bombee au milieu — 1,43 · 1,58 · 1,64 · 1,63 · 1,47
// pour des bases de 24 a 232. La racine carree est le compromis mesure : la
// meme forme que le gamma sans son pow, treize fois par pixel.
fn rb_y(uv: vec2<f32>) -> f32 {
  return sqrt(max(dot(textureSample(srcTexture, srcSampler, uv).rgb, RB_LUMA), 0.0));
}

// Rend (moyenne, variance) de y sur le noyau fin.
fn rb_fine_stats(uv: vec2<f32>) -> vec2<f32> {
  let d = RB_TEXTURE_RAYON / vec2<f32>(textureDimensions(srcTexture));
  let h = 0.5 * d;
  var m = 0.0;
  var q = 0.0;
  // 2x2 interieur a mi-ecartement, poids 1/8 chacun (somme 1/2).
  var v = rb_y(uv + vec2<f32>(-h.x, -h.y)); m = m + 0.125 * v; q = q + 0.125 * v * v;
  v = rb_y(uv + vec2<f32>( h.x, -h.y)); m = m + 0.125 * v; q = q + 0.125 * v * v;
  v = rb_y(uv + vec2<f32>(-h.x,  h.y)); m = m + 0.125 * v; q = q + 0.125 * v * v;
  v = rb_y(uv + vec2<f32>( h.x,  h.y)); m = m + 0.125 * v; q = q + 0.125 * v * v;
  // 3x3 exterieur a l ecartement plein, tente 1-2-1/2-4-2/1-2-1 a demi-poids.
  v = rb_y(uv);                          m = m + 0.125 * v;   q = q + 0.125 * v * v;
  v = rb_y(uv + vec2<f32>(-d.x,  0.0));  m = m + 0.0625 * v;  q = q + 0.0625 * v * v;
  v = rb_y(uv + vec2<f32>( d.x,  0.0));  m = m + 0.0625 * v;  q = q + 0.0625 * v * v;
  v = rb_y(uv + vec2<f32>( 0.0, -d.y));  m = m + 0.0625 * v;  q = q + 0.0625 * v * v;
  v = rb_y(uv + vec2<f32>( 0.0,  d.y));  m = m + 0.0625 * v;  q = q + 0.0625 * v * v;
  v = rb_y(uv + vec2<f32>(-d.x, -d.y));  m = m + 0.03125 * v; q = q + 0.03125 * v * v;
  v = rb_y(uv + vec2<f32>( d.x, -d.y));  m = m + 0.03125 * v; q = q + 0.03125 * v * v;
  v = rb_y(uv + vec2<f32>(-d.x,  d.y));  m = m + 0.03125 * v; q = q + 0.03125 * v * v;
  v = rb_y(uv + vec2<f32>( d.x,  d.y));  m = m + 0.03125 * v; q = q + 0.03125 * v * v;
  return vec2<f32>(m, max(q - m * m, 0.0));
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

  // 1. BALANCE DES BLANCS — un GAMMA ANCRE par canal, en espace sRGB (jumeau du
  //    twin). Un axe a 0 rend un exposant de 1 ; les deux axes se composent par
  //    produit d exposants. C etait un gain multiplicatif en lumiere lineaire
  //    puis un ecretage jusqu au 2026-09-16 : un gain SATURE le canal pousse des
  //    les reglages doux, un gamma ancre tient 0 et 1 et comprime, comme LR.
  let tP = max(params[0] / 100.0, 0.0);
  let tN = max(-params[0] / 100.0, 0.0);
  let nP = max(params[1] / 100.0, 0.0);
  let nN = max(-params[1] / 100.0, 0.0);
  let wbG = rb_wb_temp_pos(tP) * rb_wb_temp_neg(tN)
          * rb_wb_tint_pos(nP) * rb_wb_tint_neg(nN);
  let wbS = vec3<f32>(linear_to_srgb(clamp(c.r, 0.0, 1.0)),
                      linear_to_srgb(clamp(c.g, 0.0, 1.0)),
                      linear_to_srgb(clamp(c.b, 0.0, 1.0)));
  let wbOut = vec3<f32>(1.0) - pow(vec3<f32>(1.0) - wbS, wbG);
  c = vec3<f32>(srgb_to_linear(clamp(wbOut.r, 0.0, 1.0)),
                srgb_to_linear(clamp(wbOut.g, 0.0, 1.0)),
                srgb_to_linear(clamp(wbOut.b, 0.0, 1.0)));

  // 2-5. TON PERCEPTUEL — exposition (gamma ancre), contraste (sigmoide ancree),
  //      HL/ombres locaux (cloche sur la luminance floutee de prevPass), blancs/
  //      noirs (cloche ponctuelle). Toutes les formes tiennent 0 et 1.
  // La pyramide transporte (luminance, y = sqrt(luminance)) — voir
  // PREMIER_NIVEAU_WGSL. Le canal r est l'ancien dot(rgb, RB_LUMA) au chiffre
  // pres, et r - g*g est la variance locale de y, gratuite.
  let pyr = textureSample(prevPass, srcSampler, uv).rgb;
  let blurLuma = clamp(pyr.r, 0.0, 1.0);
  let yMoyen = pyr.g;
  let varMoyenne = max(pyr.r - pyr.g * pyr.g, 0.0);
  let sBlur = linear_to_srgb(blurLuma);
  let ev = params[2];
  let kC = params[3] / 100.0;
  let kHl = params[4] / 100.0;
  let kSh = params[5] / 100.0;
  let kWh = params[6] / 100.0;
  let kBk = params[7] / 100.0;
  // OMBRES / HAUTES LUMIERES : decalage en LOG2, ligne x poids, calcule sur la
  // luminance FLOUTEE et applique au pixel comme un GAIN en lumiere lineaire.
  // Le noir pur reste noir sans clamp : zero fois un gain vaut zero. Forme lue
  // dans l uniforme de Lightroom, voir reglagesDeBaseTable.
  let dLogSh = select(0.0, kSh * RB_SH_AMT * rb_ligne_poids(
    blurLuma, 0.0, RB_SH_LREF, RB_SH_W_SCALE, RB_SH_W_OFFSET, true), kSh != 0.0);
  let dLogHl = select(0.0, kHl * RB_HL_AMT * rb_ligne_poids(
    blurLuma, RB_HL_FLARE, RB_HL_LREF, RB_HL_W_SCALE, RB_HL_W_OFFSET, false), kHl != 0.0);
  let gainTon = exp2(dLogSh + dLogHl);
  // Amplitude par signe (Lightroom est asymetrique — voir reglagesDeBaseTable).
  let bkAmt = select(RB_BLACK_AMT_NEG, RB_BLACK_AMT_POS, kBk >= 0.0);
  let whAmt = select(RB_WHITE_AMT_NEG, RB_WHITE_AMT_POS, kWh >= 0.0);
  for (var i = 0u; i < 3u; i = i + 1u) {
    var s = linear_to_srgb(clamp(c[i] * gainTon, 0.0, 1.0));
    s = rb_expo(s, ev);
    s = rb_contrast(s, kC, RB_CONTRAST_PIVOT);
    s = clamp(s, 0.0, 1.0);
    // Blancs / Noirs LOCAUX : cloche sur la luminance floutee (sBlur), comme LR
    // local_whites_blacks — et comme HL/Ombres ci-dessus. Sur une rampe sBlur = s.
    s = s + kBk * bkAmt * rb_bump(sBlur, RB_BLACK_CENTER, RB_BLACK_KAPPA);
    s = s + kWh * whAmt * rb_bump(sBlur, RB_WHITE_CENTER, RB_WHITE_KAPPA);
    c[i] = srgb_to_linear(clamp(s, 0.0, 1.0));
  }

  // 6. PRESENCE — Texture (bande fine, tente locale) + Clarte (bande moyenne,
  //    prevPass) + Voile. Additif en lumiere sur la luminance.
  if (params[8] != 0.0 || params[9] != 0.0 || params[10] != 0.0) {
    let lp = dot(c, RB_LUMA);
    // TEXTURE — bande fine a ecartement ABSOLU, en espace y = sqrt(luminance),
    // et PORTE par l epsilon du filtre guide : la fraction de detail extraite
    // vaut eps/(variance+eps), donc la matiere passe et le bord franc reste.
    // Le retour en lumiere lineaire se fait par la derivee, dy/dl = 1/(2y).
    let y = sqrt(max(lp, 0.0));
    let fin = rb_fine_stats(uv);
    // PORTAIL DE TEXTURE — l epsilon du filtre guide, sur la variance de la
    // PYRAMIDE et non sur celle du noyau fin : la mesure montre que Lightroom
    // freine Texture a la periode 64 autant qu a la periode 16 quand l amplitude
    // monte, ce qu une variance lue sur deux pixels ne pourrait pas voir.
    let porte = RB_TEXTURE_EPS / (varMoyenne + RB_TEXTURE_EPS);
    let dY = params[8] / 100.0 * porte
      * (RB_TEXTURE_FIN * (y - fin.x) + RB_TEXTURE_MOYEN * (y - yMoyen));
    // CLARTE reste LINEAIRE dans le detail, et c est mesure : son gain vaut 1,77
    // pour des amplitudes de 2 a 32 niveaux, contre 1,79 a 1,40 pour Texture sur
    // la meme echelle. Aucun portail ici — un contraste local vaut deja zero sur
    // un aplat, et l ecart a Lightroom n est pas la (voir l en-tete).
    let detailMoyen = lp - blurLuma;
    let gainPresence = 2.0 * y * dY
      + params[9] / 100.0 * RB_CLARITY_AMT * detailMoyen;
    // Le terme LOCAL du voile ne vaut plus que pour l AJOUT de voile. Du cote du
    // RETRAIT, la forme de He le produit elle-meme : son gain 1/t vaut 1,80 a la
    // base 128 pour une dose de 100, ce que la mesure sur reseau fin rend a 1,95.
    // Le garder des deux cotes le compterait deux fois.
    let voileLocal = select(0.0,
      params[10] / 100.0 * RB_DEHAZE_AMT * (lp - blurLuma), params[10] < 0.0);
    // CANAL SOMBRE approche par la MOYENNE locale, et rien de plus. Un
    // raffinement par la variance a ete essaye le meme jour et RETIRE : la
    // variance d un aplat de la mire n est pas nulle — elle porte le repliement
    // de la pyramide — et le retrancher decalait l aplat 128 de quatorze niveaux.
    // La moyenne seule rend exactement la courbe ajustee sur les aplats (ou le
    // minimum EST la moyenne) et le bon gain local sur un reseau (ou elle est
    // constante). Le vrai canal sombre est un minimum spatial ; la moyenne le
    // surestime, donc l operateur creuse un peu moins que Lightroom sur une
    // texture — ecart assume et mesure.
    let sombre = sBlur;
    // Facteur sur la luminance, rapports de canaux preserves — Lightroom fait
    // Texture et Clarte sur Y seul en log-YCC (voir le twin) ; un offset par
    // canal changeait la saturation et la teinte.
    let fPres = max((lp + gainPresence + voileLocal + 1e-4) / (lp + 1e-4), 0.0);
    c = c * fPres;
    // Voile GLOBAL par canal (sRGB) — la composante que le contraste local ne
    // porte pas (rampe plate). Fittee sur voile-p100/m100.
    if (params[10] != 0.0) {
      let d = params[10] / 100.0;
      c = vec3<f32>(
        srgb_to_linear(rb_veil(linear_to_srgb(clamp(c.x, 0.0, 1.0)), d, sombre)),
        srgb_to_linear(rb_veil(linear_to_srgb(clamp(c.y, 0.0, 1.0)), d, sombre)),
        srgb_to_linear(rb_veil(linear_to_srgb(clamp(c.z, 0.0, 1.0)), d, sombre)));
    }
  }

  // 7. VIBRANCE / SATURATION (+ desaturation du VOILE en ajout) — plan (a,b)
  //    d'OKLab, sans atan2.
  let veilChroma = select(1.0, 1.0 - RB_DEHAZE_DESAT_K * (-params[10] / 100.0), params[10] < 0.0);
  if (params[11] != 0.0 || params[12] != 0.0 || veilChroma != 1.0) {
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
    let scale = satFactor * vibFactor * veilChroma;
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
